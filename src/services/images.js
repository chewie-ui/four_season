/**
 * Récupération et enregistrement des photos sources.
 *
 * Ce module télécharge des URL fournies par des tiers. C'est la surface
 * d'attaque la plus exposée du service : sans garde-fou, un client pourrait
 * nous faire interroger `http://169.254.169.254/` (métadonnées cloud) ou une
 * base interne. D'où le contrôle SSRF ci-dessous, appliqué à chaque redirection.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import sharp from 'sharp';

import env from '../config/env.js';

import { query } from '../db/pool.js';
import { put, sha256 } from './storage.js';
import { nanoid } from 'nanoid';

const TAILLE_MAX = 12 * 1024 * 1024; // 12 Mo
const DELAI_MS = 15_000;
const REDIRECTIONS_MAX = 3;
const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class ErreurImage extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.publicMessage = message;
  }
}

/* ------------------------------------------------------------ SSRF ------- */

function estIpPrivee(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const o = ip.split('.').map(Number);
    return (
      o[0] === 0 ||                               // 0.0.0.0/8
      o[0] === 10 ||                              // 10.0.0.0/8
      o[0] === 127 ||                             // boucle locale
      (o[0] === 100 && o[1] >= 64 && o[1] <= 127) || // CGNAT 100.64.0.0/10
      (o[0] === 169 && o[1] === 254) ||           // link-local / métadonnées cloud
      (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
      (o[0] === 192 && o[1] === 168) ||
      (o[0] === 192 && o[1] === 0 && o[2] === 0) ||
      o[0] >= 224                                 // multicast et réservé
    );
  }
  if (v === 6) {
    const ip6 = ip.toLowerCase();
    if (ip6 === '::' || ip6 === '::1') return true;
    if (ip6.startsWith('fe80') || ip6.startsWith('fc') || ip6.startsWith('fd')) return true;
    // IPv4 encapsulée en IPv6 : on revalide la partie v4.
    const m = /::ffff:(\d+\.\d+\.\d+\.\d+)/.exec(ip6);
    if (m) return estIpPrivee(m[1]);
    return false;
  }
  return true; // ni v4 ni v6 : on refuse
}

async function verifierUrl(brute) {
  let url;
  try {
    url = new URL(brute);
  } catch {
    throw new ErreurImage('URL d’image invalide.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ErreurImage('Seules les URL http et https sont acceptées.');
  }

  const cible = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true }).catch(() => {
        throw new ErreurImage('Nom de domaine introuvable.');
      });

  if (!cible.length) throw new ErreurImage('Nom de domaine introuvable.');

  if (cible.some((a) => estIpPrivee(a.address)) && !env.autoriserHotesPrives) {
    throw new ErreurImage('Cette adresse n’est pas autorisée.', 403);
  }
  return url;
}

/* -------------------------------------------------- téléchargement ------- */

async function telecharger(urlBrute) {
  let url = await verifierUrl(urlBrute);

  for (let saut = 0; saut <= REDIRECTIONS_MAX; saut++) {
    const stop = AbortSignal.timeout(DELAI_MS);
    const rep = await fetch(url, {
      redirect: 'manual',
      signal: stop,
      headers: { Accept: 'image/*', 'User-Agent': 'Four Season/0.1 (+https://fourseason.fr)' },
    }).catch((err) => {
      throw new ErreurImage(
        err.name === 'TimeoutError' ? 'Délai dépassé au téléchargement de la photo.' : 'Photo inaccessible.',
        502
      );
    });

    if (rep.status >= 300 && rep.status < 400) {
      const suivant = rep.headers.get('location');
      if (!suivant) throw new ErreurImage('Redirection sans destination.', 502);
      // Chaque saut est revalidé : c'est la redirection vers une IP interne
      // qui constitue l'attaque SSRF classique.
      url = await verifierUrl(new URL(suivant, url).href);
      continue;
    }

    if (!rep.ok) throw new ErreurImage(`Photo inaccessible (HTTP ${rep.status}).`, 502);

    const annonce = Number(rep.headers.get('content-length') || 0);
    if (annonce > TAILLE_MAX) throw new ErreurImage('Photo trop lourde (12 Mo maximum).', 413);

    const buffer = Buffer.from(await rep.arrayBuffer());
    if (buffer.length > TAILLE_MAX) throw new ErreurImage('Photo trop lourde (12 Mo maximum).', 413);
    if (!buffer.length) throw new ErreurImage('Photo vide.', 502);

    return buffer;
  }

  throw new ErreurImage('Trop de redirections.', 502);
}

/* ------------------------------------------------ normalisation ---------- */

/**
 * Réduit et normalise avant envoi au modèle : moins de tokens en entrée,
 * réponse plus rapide, et une définition largement suffisante pour une annonce.
 */
export async function preparer(buffer) {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new ErreurImage('Fichier illisible : ce n’est pas une image valide.', 415);
  }

  const mime = `image/${meta.format === 'jpg' ? 'jpeg' : meta.format}`;
  if (!MIMES.has(mime)) {
    throw new ErreurImage('Formats acceptés : JPEG, PNG ou WebP.', 415);
  }
  if ((meta.width || 0) < 320 || (meta.height || 0) < 240) {
    throw new ErreurImage('Photo trop petite : 320 × 240 pixels minimum.', 422);
  }

  const normalisee = await sharp(buffer)
    .rotate() // applique l'orientation EXIF avant de la perdre
    .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  const infos = await sharp(normalisee).metadata();
  return { buffer: normalisee, mime: 'image/jpeg', width: infos.width, height: infos.height };
}

/* ------------------------------------------------------ persistance ------ */

/**
 * Enregistre une photo source, ou renvoie celle déjà connue.
 * Le dédoublonnage se fait sur le sha256 du binaire normalisé : une agence
 * qui renvoie dix fois la même photo n'occupe qu'une ligne et un fichier.
 */
export async function enregistrerSource(agencyId, buffer, { sourceUrl = null, propertyId = null } = {}) {
  const prete = await preparer(buffer);
  const checksum = sha256(prete.buffer);

  const deja = await query(
    'SELECT id, public_id, storage_key, width, height FROM source_images WHERE agency_id = :a AND checksum = :c LIMIT 1',
    { a: agencyId, c: checksum }
  );
  if (deja.length) return { ...deja[0], mime: 'image/jpeg', reutilisee: true };

  const stocke = await put(prete.buffer, prete.mime, 'sources');
  const publicId = nanoid(21);

  const res = await query(
    `INSERT INTO source_images
       (agency_id, property_id, public_id, storage_key, checksum, mime, width, height, bytes, source_url)
     VALUES (:agency, :property, :public_id, :key, :checksum, :mime, :w, :h, :bytes, :url)`,
    {
      agency: agencyId,
      property: propertyId,
      public_id: publicId,
      key: stocke.key,
      checksum,
      mime: prete.mime,
      w: prete.width,
      h: prete.height,
      bytes: stocke.bytes,
      url: sourceUrl ? String(sourceUrl).slice(0, 1024) : null,
    }
  );

  return {
    id: res.insertId,
    public_id: publicId,
    storage_key: stocke.key,
    width: prete.width,
    height: prete.height,
    mime: prete.mime,
    reutilisee: false,
  };
}

/** Télécharge une URL puis l'enregistre comme source. */
export async function ingererDepuisUrl(agencyId, url, options = {}) {
  const buffer = await telecharger(url);
  return enregistrerSource(agencyId, buffer, { ...options, sourceUrl: url });
}

export { telecharger, verifierUrl };
