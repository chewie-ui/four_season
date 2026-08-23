/**
 * Worker de génération.
 *
 * Consomme `generation_jobs`. Peut tourner :
 *   - dans le processus du serveur (WORKER_INLINE=true, pratique en dev),
 *   - ou comme processus séparé : `npm run worker` (recommandé en production).
 *
 * Plusieurs workers peuvent tourner en parallèle sans se marcher dessus :
 * la réservation utilise SELECT ... FOR UPDATE SKIP LOCKED.
 */
import { randomUUID } from 'node:crypto';

import env from './config/env.js';
import { query, transaction } from './db/pool.js';
import { get as lireStockage, put } from './services/storage.js';
import { generateVariant, GeminiError, isConfigured } from './services/gemini.js';
import { filigraner, encoder } from './services/watermark.js';
import { debiterGeneration } from './services/credits.js';
import { assertWithinBudget, record, BudgetExceeded } from './services/budget.js';
import { buildPrompt, sceneById } from './config/scenes.js';
import { construirePromptLibre } from './services/variants.js';

const ID_WORKER = `w-${randomUUID().slice(0, 8)}`;
const TENTATIVES_MAX = 3;
const VERROU_PERIME_MIN = 5;
const PAUSE_VIDE_MS = 2000;

let tourne = false;

/* ------------------------------------------------------- réservation ----- */

/** Réserve un job. Renvoie null si la file est vide. */
async function reserver() {
  return transaction(async (conn) => {
    const [libres] = await conn.execute(
      `SELECT id FROM generation_jobs
        WHERE status = 'queued' AND run_after <= NOW()
        ORDER BY priority ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`
    );
    if (!libres.length) return null;

    const id = libres[0].id;
    await conn.execute(
      `UPDATE generation_jobs
          SET status = 'running', locked_by = :w, locked_at = NOW(), attempts = attempts + 1
        WHERE id = :id`,
      { w: ID_WORKER, id }
    );

    const [details] = await conn.execute(
      `SELECT j.id, j.variant_id, j.agency_id, j.attempts,
              v.scene_id, v.prompt_hash, v.prompt,
              s.storage_key AS source_key, s.mime AS source_mime,
              a.watermark
         FROM generation_jobs j
         JOIN variants v      ON v.id = j.variant_id
         JOIN source_images s ON s.id = v.source_image_id
         JOIN agencies a      ON a.id = j.agency_id
        WHERE j.id = :id`,
      { id }
    );

    await conn.execute("UPDATE variants SET status = 'processing' WHERE id = :v", {
      v: details[0].variant_id,
    });

    return details[0];
  });
}

/** Un worker mort laisse ses jobs verrouillés : on les rend à la file. */
async function libererVerrousPerimes() {
  const res = await query(
    `UPDATE generation_jobs
        SET status = 'queued', locked_by = NULL, locked_at = NULL
      WHERE status = 'running'
        AND locked_at < DATE_SUB(NOW(), INTERVAL :min MINUTE)`,
    { min: VERROU_PERIME_MIN }
  );
  if (res.affectedRows) {
    console.warn(`[worker] ${res.affectedRows} job(s) récupéré(s) après verrou périmé`);
  }
}

/* ---------------------------------------------------------- traitement --- */

async function traiter(job) {
  await assertWithinBudget();

  const source = await lireStockage(job.source_key);

  // Le prompt exact est stocké avec la variante : le worker ne le reconstruit
  // jamais. Modifier scenes.js n'altère donc pas un job déjà en file, et un
  // rendu raté peut être rejoué à l'identique pour comprendre pourquoi.
  const prompt = job.prompt || buildPrompt(job.scene_id);
  if (!prompt) throw new Error(`Aucun prompt pour la variante ${job.variant_id}`);

  const resultat = await generateVariant(source, job.source_mime || 'image/jpeg', job.scene_id, {
    promptComplet: prompt,
  });

  await record(resultat.costMicroEur);

  const finale = job.watermark ? await filigraner(resultat.buffer) : await encoder(resultat.buffer);
  const stocke = await put(finale, 'image/jpeg', 'variants');

  await transaction(async (conn) => {
    await conn.execute(
      `UPDATE variants
          SET status = 'ready', storage_key = :key, bytes = :bytes,
              model = :model, latency_ms = :lat, cost_micro_eur = :cost,
              error_message = NULL, completed_at = NOW()
        WHERE id = :id`,
      {
        key: stocke.key,
        bytes: stocke.bytes,
        model: resultat.model,
        lat: resultat.latencyMs,
        cost: resultat.costMicroEur,
        id: job.variant_id,
      }
    );
    await conn.execute("UPDATE generation_jobs SET status = 'done', last_error = NULL WHERE id = :id", {
      id: job.id,
    });
    await debiterGeneration(conn, job.agency_id, job.variant_id);
  });

  console.log(
    `[worker] ✔ variante ${job.variant_id} « ${job.scene_id} » en ${(resultat.latencyMs / 1000).toFixed(1)} s`
  );
}

async function echouer(job, err) {
  const message = String(err.publicMessage || err.message || err).slice(0, 500);
  const definitif =
    job.attempts >= TENTATIVES_MAX ||
    err instanceof BudgetExceeded ||
    (err instanceof GeminiError && err.status === 422); // refus du modèle : réessayer ne changera rien

  if (definitif) {
    await transaction(async (conn) => {
      await conn.execute("UPDATE variants SET status = 'failed', error_message = :m WHERE id = :id", {
        m: message,
        id: job.variant_id,
      });
      await conn.execute("UPDATE generation_jobs SET status = 'failed', last_error = :m WHERE id = :id", {
        m: message,
        id: job.id,
      });
    });
    console.error(`[worker] ✖ variante ${job.variant_id} abandonnée : ${message}`);
    return;
  }

  // Repli exponentiel : 10 s, puis 40 s.
  const delai = 10 * Math.pow(4, job.attempts - 1);
  await query(
    `UPDATE generation_jobs
        SET status = 'queued', locked_by = NULL, locked_at = NULL,
            last_error = :m, run_after = DATE_ADD(NOW(), INTERVAL :d SECOND)
      WHERE id = :id`,
    { m: message, d: delai, id: job.id }
  );
  await query("UPDATE variants SET status = 'pending' WHERE id = :id", { id: job.variant_id });
  console.warn(`[worker] ↻ variante ${job.variant_id} réessayée dans ${delai} s : ${message}`);
}

/* -------------------------------------------------------------- boucle --- */

async function boucle() {
  let depuisMenage = 0;

  while (tourne) {
    try {
      if (depuisMenage++ % 30 === 0) await libererVerrousPerimes();

      const job = await reserver();
      if (!job) {
        await new Promise((r) => setTimeout(r, PAUSE_VIDE_MS));
        continue;
      }

      try {
        await traiter(job);
      } catch (err) {
        await echouer(job, err);
      }
    } catch (err) {
      // Panne d'infrastructure (base injoignable) : on ralentit sans mourir.
      console.error('[worker] erreur de boucle :', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

/**
 * Démarre N boucles concurrentes.
 *
 * Six ambiances traitées en série, c'est 90 secondes d'attente pour l'agence.
 * En parallèle, c'est le temps d'une seule. La réservation utilisant
 * SKIP LOCKED, deux boucles ne prennent jamais le même job.
 */
export function demarrerWorker(concurrence = env.workerConcurrence) {
  if (tourne) return;
  if (!env.db.configured) {
    console.warn('[worker] base non configurée — worker non démarré');
    return;
  }
  if (!isConfigured()) {
    console.warn('[worker] GEMINI_API_KEY absente — le worker tournera mais tous les jobs échoueront');
  }
  tourne = true;
  const n = Math.max(1, Math.min(12, Number(concurrence) || 1));
  console.log(`[worker] ${ID_WORKER} démarré — ${n} traitement(s) en parallèle`);
  for (let i = 0; i < n; i++) boucle();
}

export function arreterWorker() {
  tourne = false;
}

// Exécution directe : `node src/worker.js`
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  demarrerWorker();
  const stop = () => {
    console.log('\n[worker] arrêt demandé…');
    arreterWorker();
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
