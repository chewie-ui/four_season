/**
 * Garde-fou budget.
 *
 * Objectif très concret : protéger les 100 € de crédit de départ.
 * Un bug de boucle ou un visiteur malintentionné sur /demo peut brûler
 * le budget en quelques minutes. Ce module coupe le robinet avant.
 *
 * Sans MySQL, le compteur vit dans storage/spend.json — suffisant pour la phase de test.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import env from '../config/env.js';
import { query } from '../db/pool.js';

const FILE = join(env.storage.localPath, 'spend.json');
const today = () => new Date().toISOString().slice(0, 10);

export class BudgetExceeded extends Error {
  constructor(spentEur) {
    super(`Budget de test atteint (${spentEur.toFixed(2)} € / ${env.budgetHardLimitEur} €).`);
    this.name = 'BudgetExceeded';
    this.status = 402;
    this.publicMessage =
      'La démo publique a atteint son plafond de dépense du moment. Écrivez-nous pour un accès démo dédié.';
  }
}

async function readFileState() {
  try {
    return JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    return { totalMicroEur: 0, images: 0, days: {} };
  }
}

/** Dépense cumulée depuis le début, en euros. */
export async function totalSpentEur() {
  if (env.db.configured) {
    try {
      const rows = await query('SELECT COALESCE(SUM(cost_micro_eur),0) AS total FROM spend_daily');
      return Number(rows[0].total) / 1_000_000;
    } catch (err) {
      // Base injoignable : on retombe sur le compteur fichier plutôt que
      // de faire tomber la page. Le garde-fou reste actif.
      console.warn('[budget] MySQL indisponible, bascule sur le compteur fichier :', err.code || err.message);
    }
  }
  const state = await readFileState();
  return state.totalMicroEur / 1_000_000;
}

/** À appeler AVANT chaque génération. Lève BudgetExceeded si le plafond est franchi. */
export async function assertWithinBudget() {
  const spent = await totalSpentEur();
  if (spent >= env.budgetHardLimitEur) throw new BudgetExceeded(spent);
  return spent;
}

/** À appeler APRÈS une génération réussie. */
export async function record(costMicroEur) {
  if (env.db.configured) {
    try {
      await query(
        `INSERT INTO spend_daily (day, images, cost_micro_eur)
         VALUES (:day, 1, :cost)
         ON DUPLICATE KEY UPDATE images = images + 1, cost_micro_eur = cost_micro_eur + :cost`,
        { day: today(), cost: costMicroEur }
      );
      return;
    } catch (err) {
      console.warn('[budget] écriture MySQL impossible, report sur le fichier :', err.code || err.message);
    }
  }
  const state = await readFileState();
  state.totalMicroEur += costMicroEur;
  state.images += 1;
  state.days[today()] = (state.days[today()] || 0) + costMicroEur;
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(state, null, 2), 'utf8');
}

export async function summary() {
  const spent = await totalSpentEur();
  return {
    spentEur: Number(spent.toFixed(4)),
    limitEur: env.budgetHardLimitEur,
    remainingEur: Number(Math.max(0, env.budgetHardLimitEur - spent).toFixed(4)),
  };
}
