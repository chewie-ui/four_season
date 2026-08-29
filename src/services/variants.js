/**
 * Variantes et file d'attente.
 *
 * Le cache est le modèle économique : la contrainte unique
 * (source_image_id, scene_id, prompt_hash) garantit qu'une même ambiance
 * sur une même photo n'est JAMAIS payée deux fois, quel que soit le nombre
 * de visiteurs qui la demandent.
 */
import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';

import env from '../config/env.js';
import { query, transaction } from '../db/pool.js';
import { sceneById } from '../config/scenes.js';
import { construire } from './prompt.js';
import { verifierSolde } from './credits.js';

const hachePrompt = (p) => createHash('sha256').update(p).digest('hex');

export class ErreurVariante extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.publicMessage = message;
  }
}

/**
 * URL absolue, toujours.
 * Le widget vit sur le site du client : une URL relative s'y résoudrait
 * sur SON domaine et renverrait un 404 chez lui.
 */
const urlPublique = (storageKey) =>
  storageKey ? `${env.baseUrl.replace(/\/+$/, '')}/media/${storageKey}` : null;

/**
 * Trouve la variante demandée, ou la crée et la met en file.
 *
 * Le jeton renvoyé est le `public_id` de la variante (nanoid, 21 caractères),
 * jamais l'identifiant numérique du job : le widget sonde sans clé d'API,
 * un compteur séquentiel serait énumérable par n'importe qui.
 *
 * @returns {Promise<{status:'ready', url:string}
 *                 | {status:'queued'|'processing', jeton:string}>}
 */
export async function obtenirOuCreer({ agencyId, sourceImageId, sceneId, consigne = '', priorite = 5, lieu = null, mois = null }) {
  const scene = sceneById[sceneId];
  const estLibre = sceneId === 'libre';
  if (!scene && !estLibre) throw new ErreurVariante(`Ambiance inconnue : ${sceneId}`, 404);

  // Le prompt intègre la position réelle du soleil quand le bien est localisé.
  // Deux biens à des latitudes différentes produisent donc des prompts
  // différents, donc des empreintes différentes : le cache ne les confond pas.
  const prompt = construire(sceneId, { lieu, mois, consigne });
  const promptHash = hachePrompt(prompt);

  const existantes = await query(
    `SELECT v.id, v.public_id, v.status, v.storage_key, j.id AS job_id
       FROM variants v
       LEFT JOIN generation_jobs j
              ON j.variant_id = v.id AND j.status IN ('queued', 'running')
      WHERE v.source_image_id = :src AND v.scene_id = :scene AND v.prompt_hash = :hash
      LIMIT 1`,
    { src: sourceImageId, scene: sceneId, hash: promptHash }
  );

  const deja = existantes[0];
  if (deja) {
    if (deja.status === 'ready' && deja.storage_key) {
      return { status: 'ready', url: urlPublique(deja.storage_key), jeton: deja.public_id };
    }
    if (deja.status === 'failed') {
      // Un échec précédent ne condamne pas la variante : on la remet en file.
      await query("UPDATE variants SET status = 'pending', error_message = NULL WHERE id = :id", {
        id: deja.id,
      });
      await mettreEnFile(deja.id, agencyId, priorite);
      return { status: 'queued', jeton: deja.public_id };
    }
    if (!deja.job_id) {
      // En attente mais sans job vivant (worker tombé entre-temps) : on réamorce.
      await mettreEnFile(deja.id, agencyId, priorite);
    }
    return {
      status: deja.status === 'processing' ? 'processing' : 'queued',
      jeton: deja.public_id,
    };
  }

  await verifierSolde(agencyId);

  const publicId = nanoid(21);

  return transaction(async (conn) => {
    const [res] = await conn.execute(
      `INSERT INTO variants (source_image_id, agency_id, public_id, scene_id, prompt_hash, prompt, status)
       VALUES (:src, :agency, :public_id, :scene, :hash, :prompt, 'pending')`,
      {
        src: sourceImageId,
        agency: agencyId,
        public_id: publicId,
        scene: sceneId,
        hash: promptHash,
        prompt,
      }
    );
    const variantId = res.insertId;

    await conn.execute(
      `INSERT INTO generation_jobs (variant_id, agency_id, priority) VALUES (:v, :a, :p)`,
      { v: variantId, a: agencyId, p: priorite }
    );

    return { status: 'queued', jeton: publicId };
  });
}

async function mettreEnFile(variantId, agencyId, priorite) {
  const res = await query(
    `INSERT INTO generation_jobs (variant_id, agency_id, priority) VALUES (:v, :a, :p)`,
    { v: variantId, a: agencyId, p: priorite }
  );
  return res.insertId;
}

/**
 * État d'une variante, pour le sondage du widget.
 * Interrogeable sans clé : le jeton est un nanoid, non énumérable.
 */
export async function etatVariante(jeton) {
  if (typeof jeton !== 'string' || !/^[A-Za-z0-9_-]{21}$/.test(jeton)) return null;

  const rows = await query(
    `SELECT v.status, v.storage_key, v.scene_id, v.error_message
       FROM variants v
      WHERE v.public_id = :jeton
      LIMIT 1`,
    { jeton }
  );

  const r = rows[0];
  if (!r) return null;

  if (r.status === 'ready' && r.storage_key) {
    return { status: 'ready', url: urlPublique(r.storage_key), scene: r.scene_id };
  }
  if (r.status === 'failed') {
    return { status: 'failed', error: r.error_message || 'La génération a échoué.' };
  }
  return { status: r.status === 'processing' ? 'processing' : 'queued' };
}
