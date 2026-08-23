/**
 * Clés d'API.
 *
 * Deux natures, deux menaces différentes :
 *
 *   pk_  « publique » — posée en clair dans le HTML du site client.
 *         Elle EST visible, c'est sa nature. Ce qui la protège est le filtre
 *         par domaine (Origin / Referer) plus la limite de débit, jamais le secret.
 *
 *   sk_  « secrète » — serveur à serveur. Affichée une seule fois à la création,
 *         stockée hachée. Perdue = régénérée, jamais récupérée.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { query } from '../db/pool.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Génère une clé en clair. À ne montrer qu'une fois. */
export function genererCle(kind, env = 'live') {
  const prefixe = kind === 'public' ? 'pk' : 'sk';
  return `${prefixe}_${env}_${randomBytes(24).toString('base64url')}`;
}

export async function creerCle(agencyId, kind, label = null) {
  const cle = genererCle(kind);
  await query(
    `INSERT INTO api_keys (agency_id, kind, label, key_prefix, key_hash)
     VALUES (:agency_id, :kind, :label, :prefix, :hash)`,
    {
      agency_id: agencyId,
      kind,
      label,
      prefix: cle.slice(0, 16),
      hash: sha256(cle),
    }
  );
  return cle; // dernière et unique occasion de la lire
}

/**
 * Retrouve l'agence associée à une clé.
 * @returns {Promise<null | {agencyId, kind, keyId, agency}>}
 */
export async function resoudreCle(cleEnClair) {
  if (typeof cleEnClair !== 'string' || cleEnClair.length < 20 || cleEnClair.length > 128) return null;
  if (!/^(pk|sk)_[a-z]+_[A-Za-z0-9_-]+$/.test(cleEnClair)) return null;

  const rows = await query(
    `SELECT k.id AS key_id, k.kind, k.agency_id, k.key_hash, k.revoked_at,
            a.name, a.plan_id, a.credits_balance, a.watermark, a.status
       FROM api_keys k
       JOIN agencies a ON a.id = k.agency_id
      WHERE k.key_hash = :hash
      LIMIT 1`,
    { hash: sha256(cleEnClair) }
  );

  const row = rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.status !== 'active') return null;

  // La comparaison en temps constant est superflue après un lookup par hash
  // indexé, mais elle ne coûte rien et évite toute régression future.
  const attendu = Buffer.from(row.key_hash, 'hex');
  const fourni = Buffer.from(sha256(cleEnClair), 'hex');
  if (attendu.length !== fourni.length || !timingSafeEqual(attendu, fourni)) return null;

  return {
    keyId: row.key_id,
    kind: row.kind,
    agencyId: row.agency_id,
    agency: {
      id: row.agency_id,
      name: row.name,
      planId: row.plan_id,
      credits: row.credits_balance,
      watermark: Boolean(row.watermark),
    },
  };
}

/** Trace de dernière utilisation, sans bloquer la requête. */
export function toucherCle(keyId) {
  query('UPDATE api_keys SET last_used_at = NOW() WHERE id = :id', { id: keyId }).catch(() => {});
}

/**
 * Le domaine appelant est-il autorisé pour cette agence ?
 * Accepte 'agence.fr' et le joker '*.agence.fr'.
 */
export async function domaineAutorise(agencyId, origine) {
  if (!origine) return false;

  let hote;
  try {
    hote = new URL(origine).hostname.toLowerCase();
  } catch {
    return false;
  }

  const rows = await query(
    'SELECT domain FROM allowed_domains WHERE agency_id = :id',
    { id: agencyId }
  );

  // Aucun domaine déclaré = configuration incomplète. On refuse plutôt que
  // de laisser une clé publique ouverte à tous les vents.
  if (!rows.length) return false;

  return rows.some(({ domain }) => {
    const d = String(domain).toLowerCase().trim();
    if (d.startsWith('*.')) {
      const base = d.slice(2);
      return hote === base || hote.endsWith('.' + base);
    }
    return hote === d;
  });
}

export { sha256 };
