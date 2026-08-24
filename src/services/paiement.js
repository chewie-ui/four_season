/**
 * Paiement — Stripe Checkout.
 *
 * Deux principes qui structurent tout ce fichier :
 *
 * 1. **On ne croit jamais le navigateur.** Le retour de l'utilisateur sur
 *    /paiement/succes ne prouve rien : il peut fabriquer cette URL. Seul le
 *    webhook signé par Stripe crédite le compte.
 *
 * 2. **Un webhook peut arriver deux fois.** Stripe rejoue en cas de doute
 *    sur la livraison. La contrainte unique sur `payments.stripe_event_id`
 *    fait qu'un rejeu ne crédite pas une seconde fois.
 *
 * Sans clé Stripe, le module se déclare simplement indisponible : le reste
 * du site continue de fonctionner, seule la page de paiement l'annonce.
 */
import Stripe from 'stripe';
import env from '../config/env.js';
import brand from '../config/brand.js';
import { query, transaction } from '../db/pool.js';
import { mouvement } from './credits.js';

let stripe = null;

export const estActif = () => Boolean(env.stripe.secretKey);

function client() {
  if (!estActif()) return null;
  if (!stripe) stripe = new Stripe(env.stripe.secretKey, { apiVersion: '2025-10-29.clover' });
  return stripe;
}

export class ErreurPaiement extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.publicMessage = message;
  }
}

const offre = (id) => brand.plans.find((p) => p.id === id);

/* ------------------------------------------------------- checkout ------- */

/**
 * Ouvre une session de paiement pour un abonnement mensuel.
 *
 * Le prix est décrit ici (`price_data`) plutôt que pré-créé dans le tableau
 * de bord Stripe : une offre se change dans `brand.js` sans avoir à toucher
 * à deux endroits, et il n'y a rien à configurer avant le premier paiement.
 */
export async function ouvrirPaiement({ agencyId, planId, email }) {
  const s = client();
  if (!s) throw new ErreurPaiement('Le paiement en ligne n’est pas encore activé.', 503);

  const plan = offre(planId);
  if (!plan || typeof plan.price !== 'number' || plan.price <= 0) {
    throw new ErreurPaiement('Cette offre ne se souscrit pas en ligne. Contactez-nous.', 400);
  }

  const agences = await query(
    'SELECT stripe_customer_id, name, billing_email FROM agencies WHERE id = :id',
    { id: agencyId }
  );
  const agence = agences[0];
  if (!agence) throw new ErreurPaiement('Agence introuvable.', 404);

  let clientId = agence.stripe_customer_id;
  if (!clientId) {
    const c = await s.customers.create({
      email: email || agence.billing_email || undefined,
      name: agence.name,
      metadata: { agency_id: String(agencyId) },
    });
    clientId = c.id;
    await query('UPDATE agencies SET stripe_customer_id = :c WHERE id = :id', {
      c: clientId,
      id: agencyId,
    });
  }

  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer: clientId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(plan.price * 100),
          recurring: { interval: 'month' },
          product_data: {
            name: `${brand.name} — offre ${plan.name}`,
            description: `${plan.credits} ambiances par mois`,
          },
        },
      },
    ],
    // L'identifiant d'agence voyage avec la session : le webhook en a besoin
    // pour savoir qui créditer, et il ne doit dépendre d'aucune session web.
    metadata: { agency_id: String(agencyId), plan_id: planId },
    subscription_data: { metadata: { agency_id: String(agencyId), plan_id: planId } },
    success_url: `${env.baseUrl}/console/compte?paiement=succes`,
    cancel_url: `${env.baseUrl}/tarifs?paiement=annule`,
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    automatic_tax: { enabled: false },
  });

  return session.url;
}

/** Portail Stripe : l'agence y gère sa carte, ses factures et sa résiliation. */
export async function ouvrirPortail(agencyId) {
  const s = client();
  if (!s) throw new ErreurPaiement('Le paiement en ligne n’est pas encore activé.', 503);

  const rows = await query('SELECT stripe_customer_id FROM agencies WHERE id = :id', { id: agencyId });
  const clientId = rows[0]?.stripe_customer_id;
  if (!clientId) throw new ErreurPaiement('Aucun abonnement à gérer pour le moment.', 400);

  const portail = await s.billingPortal.sessions.create({
    customer: clientId,
    return_url: `${env.baseUrl}/console/compte`,
  });
  return portail.url;
}

/* -------------------------------------------------------- webhook ------- */

/** Vérifie la signature Stripe. Sans elle, n'importe qui créditerait un compte. */
export function lireEvenement(corpsBrut, signature) {
  const s = client();
  if (!s) throw new ErreurPaiement('Paiement non configuré.', 503);
  if (!env.stripe.webhookSecret) throw new ErreurPaiement('STRIPE_WEBHOOK_SECRET manquant.', 503);
  try {
    return s.webhooks.constructEvent(corpsBrut, signature, env.stripe.webhookSecret);
  } catch (err) {
    throw new ErreurPaiement(`Signature Stripe invalide : ${err.message}`, 400);
  }
}

/**
 * Applique un évènement. Idempotent : rejouer le même évènement ne change rien.
 * @returns {Promise<string>} ce qui a été fait, pour le journal
 */
export async function appliquerEvenement(evt) {
  switch (evt.type) {
    case 'checkout.session.completed':
      return activerAbonnement(evt);

    case 'invoice.paid':
      return crediterFacture(evt);

    case 'invoice.payment_failed':
      return marquerRetard(evt);

    case 'customer.subscription.deleted':
      return annuler(evt);

    default:
      return `ignoré (${evt.type})`;
  }
}

async function agenceDe(objet) {
  const id = objet?.metadata?.agency_id;
  if (id) return Number(id);
  const clientId = objet?.customer;
  if (!clientId) return null;
  const rows = await query('SELECT id FROM agencies WHERE stripe_customer_id = :c LIMIT 1', {
    c: clientId,
  });
  return rows[0]?.id ?? null;
}

async function activerAbonnement(evt) {
  const sess = evt.data.object;
  const agencyId = await agenceDe(sess);
  if (!agencyId) return 'agence introuvable';

  const planId = sess.metadata?.plan_id || 'agence';
  await query(
    `UPDATE agencies
        SET plan_id = :p, stripe_subscription_id = :s, abonnement_statut = 'actif',
            watermark = 0
      WHERE id = :id`,
    { p: planId, s: sess.subscription || null, id: agencyId }
  );
  // Les crédits ne sont pas donnés ici : `invoice.paid` suit immédiatement
  // et c'est lui qui fait foi, y compris pour les renouvellements mensuels.
  return `abonnement ${planId} activé pour l'agence ${agencyId}`;
}

async function crediterFacture(evt) {
  const facture = evt.data.object;
  const agencyId = await agenceDe(facture);
  if (!agencyId) return 'agence introuvable';

  const planId = facture.lines?.data?.[0]?.metadata?.plan_id
    || (await query('SELECT plan_id FROM agencies WHERE id = :id', { id: agencyId }))[0]?.plan_id
    || 'agence';
  const credits = offre(planId)?.credits ?? 0;

  try {
    await transaction(async (conn) => {
      // L'insertion échoue si l'évènement a déjà été traité : c'est le
      // verrou qui rend l'opération idempotente.
      await conn.execute(
        `INSERT INTO payments (agency_id, stripe_event_id, stripe_object, montant_cents, devise, credits, plan_id)
         VALUES (:a, :e, :o, :m, :d, :c, :p)`,
        {
          a: agencyId,
          e: evt.id,
          o: facture.id || null,
          m: facture.amount_paid ?? 0,
          d: (facture.currency || 'eur').toUpperCase(),
          c: credits,
          p: planId,
        }
      );
      if (credits > 0) {
        await mouvement(conn, {
          agencyId,
          delta: credits,
          reason: 'subscription',
          note: `facture ${facture.id}`,
        });
      }
      await conn.execute(
        `UPDATE agencies SET abonnement_statut = 'actif', watermark = 0,
                periode_fin = FROM_UNIXTIME(:fin)
          WHERE id = :id`,
        { fin: facture.period_end || Math.floor(Date.now() / 1000), id: agencyId }
      );
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return `évènement ${evt.id} déjà traité`;
    throw err;
  }

  return `+${credits} crédits pour l'agence ${agencyId}`;
}

async function marquerRetard(evt) {
  const agencyId = await agenceDe(evt.data.object);
  if (!agencyId) return 'agence introuvable';
  await query("UPDATE agencies SET abonnement_statut = 'en_retard' WHERE id = :id", { id: agencyId });
  return `agence ${agencyId} en retard de paiement`;
}

async function annuler(evt) {
  const agencyId = await agenceDe(evt.data.object);
  if (!agencyId) return 'agence introuvable';
  // On ne retire pas les crédits déjà achetés : ils sont payés.
  // Le filigrane revient, l'agence repasse sur l'offre découverte.
  await query(
    `UPDATE agencies
        SET abonnement_statut = 'annule', plan_id = 'decouverte',
            watermark = 1, stripe_subscription_id = NULL
      WHERE id = :id`,
    { id: agencyId }
  );
  return `abonnement de l'agence ${agencyId} annulé`;
}
