/**
 * Routes de paiement.
 *
 * Le webhook est monté AVANT le parseur JSON global (voir server.js) :
 * Stripe signe le corps brut, et un corps déjà transformé en objet ne peut
 * plus être vérifié. C'est l'erreur classique sur cette intégration.
 */
import { Router } from 'express';
import express from 'express';

import brand from '../config/brand.js';
import { exigerSession } from '../middleware/session.js';
import * as paiement from '../services/paiement.js';
import { query } from '../db/pool.js';

const router = Router();

/** Souscrire à une offre. */
router.post('/souscrire', exigerSession, async (req, res, next) => {
  try {
    const [u] = await query('SELECT email FROM users WHERE agency_id = :a ORDER BY id LIMIT 1', {
      a: req.session.agencyId,
    });
    const url = await paiement.ouvrirPaiement({
      agencyId: req.session.agencyId,
      planId: String(req.body.offre || 'agence'),
      email: u?.email,
    });
    res.redirect(303, url);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).render('pages/message', {
        title: `Paiement — ${brand.name}`,
        description: '',
        titre: 'Paiement indisponible',
        texte: err.publicMessage,
        lien: { href: '/console/compte', texte: 'Retour à mon compte' },
      });
    }
    next(err);
  }
});

/** Portail Stripe : carte, factures, résiliation. */
router.post('/portail', exigerSession, async (req, res, next) => {
  try {
    res.redirect(303, await paiement.ouvrirPortail(req.session.agencyId));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).render('pages/message', {
        title: `Facturation — ${brand.name}`,
        description: '',
        titre: 'Facturation',
        texte: err.publicMessage,
        lien: { href: '/console/compte', texte: 'Retour à mon compte' },
      });
    }
    next(err);
  }
});

/**
 * Webhook Stripe. `express.raw` est indispensable ici.
 *
 * On répond 200 même sur erreur de traitement métier : un 500 fait rejouer
 * Stripe indéfiniment. Seule une signature invalide mérite un 400 — c'est
 * le seul cas où l'appel n'est pas légitime.
 */
export const webhook = [
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    let evt;
    try {
      evt = paiement.lireEvenement(req.body, req.get('stripe-signature'));
    } catch (err) {
      console.error('[stripe] signature refusée :', err.message);
      return res.status(400).send('signature invalide');
    }

    try {
      const fait = await paiement.appliquerEvenement(evt);
      console.log(`[stripe] ${evt.type} → ${fait}`);
    } catch (err) {
      // On journalise fort : un évènement perdu, c'est un client qui a payé
      // sans être crédité. Il faudra le rattraper à la main.
      console.error(`[stripe] ÉCHEC de traitement pour ${evt.id} (${evt.type}) :`, err.stack || err);
    }

    res.json({ recu: true });
  },
];

export default router;
