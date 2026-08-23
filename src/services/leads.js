import { createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import env from '../config/env.js';
import { query } from '../db/pool.js';

const FALLBACK = join(env.storage.localPath, 'leads.jsonl');

const hashIp = (ip) =>
  ip ? createHash('sha256').update(`${ip}${env.sessionSecret}`).digest('hex') : null;

/**
 * Enregistre une demande de contact.
 * Si MySQL n'est pas encore configuré, on écrit dans storage/leads.jsonl :
 * aucun prospect n'est perdu pendant la phase de démarrage.
 */
export async function saveLead(data) {
  const row = {
    name: data.name,
    email: data.email,
    company: data.company || null,
    phone: data.phone || null,
    volume: data.volume || null,
    message: data.message || null,
    plan_id: data.plan_id || null,
    source: (data.source || '').slice(0, 120) || null,
    ip_hash: hashIp(data.ip),
  };

  if (env.db.configured) {
    try {
      await query(
        `INSERT INTO leads (name, email, company, phone, volume, message, plan_id, source, ip_hash)
         VALUES (:name, :email, :company, :phone, :volume, :message, :plan_id, :source, :ip_hash)`,
        row
      );
      return { stored: 'mysql' };
    } catch (err) {
      // Une base indisponible ne doit JAMAIS faire perdre un prospect :
      // on écrit sur disque et on repassera les lignes en base plus tard.
      console.error('[leads] MySQL indisponible, écriture de secours sur disque :', err.code || err.message);
    }
  }

  await mkdir(dirname(FALLBACK), { recursive: true });
  await appendFile(FALLBACK, JSON.stringify({ ...row, at: new Date().toISOString() }) + '\n', 'utf8');
  return { stored: 'fichier' };
}
