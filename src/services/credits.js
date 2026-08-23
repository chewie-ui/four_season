/**
 * Crédits — grand livre.
 *
 * On n'écrase jamais un solde, on ajoute une ligne. `agencies.credits_balance`
 * n'est qu'un cache de `SUM(credit_ledger.delta)` : en cas de doute il se recalcule.
 * Un solde qu'on écrase directement est un solde qu'on ne peut plus justifier —
 * inacceptable dès lors qu'on facture à l'usage.
 */
import { query } from '../db/pool.js';

export class CreditsInsuffisants extends Error {
  constructor() {
    super('Crédits épuisés.');
    this.name = 'CreditsInsuffisants';
    this.status = 402;
    this.publicMessage = 'Cette agence n’a plus de crédits disponibles.';
  }
}

/**
 * Écrit un mouvement et met à jour le cache de solde.
 * @param {import('mysql2/promise').PoolConnection} conn connexion DANS une transaction
 */
export async function mouvement(conn, { agencyId, delta, reason, variantId = null, note = null }) {
  await conn.execute(
    `INSERT INTO credit_ledger (agency_id, delta, reason, variant_id, note)
     VALUES (:agency, :delta, :reason, :variant, :note)`,
    { agency: agencyId, delta, reason, variant: variantId, note }
  );
  await conn.execute(
    'UPDATE agencies SET credits_balance = credits_balance + :delta WHERE id = :agency',
    { delta, agency: agencyId }
  );
}

/** Débit d'un crédit à la réussite d'une génération. */
export async function debiterGeneration(conn, agencyId, variantId) {
  await mouvement(conn, { agencyId, delta: -1, reason: 'generation', variantId });
}

export async function solde(agencyId) {
  const rows = await query('SELECT credits_balance FROM agencies WHERE id = :id', { id: agencyId });
  return rows.length ? Number(rows[0].credits_balance) : 0;
}

/**
 * Vérifie qu'il reste de quoi générer, AVANT de mettre en file.
 *
 * Compromis assumé : le débit réel a lieu à la réussite, pas ici. Deux requêtes
 * simultanées sur le dernier crédit peuvent donc passer toutes les deux et créer
 * un découvert de 1. C'est préférable à l'inverse — facturer une image jamais
 * livrée — et le solde reste auditable ligne à ligne.
 */
export async function verifierSolde(agencyId) {
  if ((await solde(agencyId)) <= 0) throw new CreditsInsuffisants();
}

/** Recalcule le cache depuis le grand livre. Filet de sécurité, pas une routine. */
export async function reconcilier(agencyId) {
  const rows = await query(
    'SELECT COALESCE(SUM(delta), 0) AS total FROM credit_ledger WHERE agency_id = :id',
    { id: agencyId }
  );
  const total = Number(rows[0].total);
  await query('UPDATE agencies SET credits_balance = :t WHERE id = :id', { t: total, id: agencyId });
  return total;
}
