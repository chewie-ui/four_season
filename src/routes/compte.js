/**
 * Inscription, connexion, espace compte.
 *
 * L'espace compte est l'interface qui manquait : jusqu'ici clés et domaines
 * se géraient en ligne de commande sur le serveur.
 */
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';

import env from '../config/env.js';
import brand from '../config/brand.js';
import { exigerSession } from '../middleware/session.js';
import {
  inscrire, connecter, verifierEmail, demanderReinitialisation, reinitialiser,
  validerMotDePasse, ErreurAuth,
} from '../services/auth.js';
import { creerCle, genererCle } from '../services/keys.js';
import { solde } from '../services/credits.js';
import { query } from '../db/pool.js';
import * as courriel from '../services/courriel.js';
import * as paiement from '../services/paiement.js';

const router = Router();

const brider = (limit, minutes = 15) =>
  rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: { error: 'Trop de tentatives. Réessayez plus tard.' },
  });

/* ========================================================= INSCRIPTION === */

const schemaInscription = z.object({
  agence: z.string().trim().min(2, 'Indiquez le nom de votre agence.').max(160),
  nom: z.string().trim().max(160).optional().or(z.literal('')),
  email: z.string().trim().email('Adresse email invalide.').max(190),
  motdepasse: z.string().min(1, 'Choisissez un mot de passe.'),
  cgu: z.literal('on', { message: 'Vous devez accepter les conditions.' }),
  website: z.string().max(0).optional().or(z.literal('')), // piège à robots
});

router.get('/inscription', (req, res) => {
  if (req.session?.agencyId) return res.redirect('/console');
  res.render('pages/inscription', {
    title: `Créer un compte — ${brand.name}`,
    description: 'Ouvrez votre compte et recevez vos clés immédiatement.',
    erreurs: null,
    valeurs: {},
  });
});

router.post('/inscription', brider(6), async (req, res, next) => {
  const rendre = (erreurs, valeurs, code = 400) =>
    res.status(code).render('pages/inscription', {
      title: `Créer un compte — ${brand.name}`,
      description: '',
      erreurs,
      valeurs,
    });

  try {
    const parse = schemaInscription.safeParse(req.body);
    if (!parse.success) {
      const erreurs = {};
      for (const i of parse.error.issues) erreurs[i.path[0]] = i.message;
      return rendre(erreurs, req.body);
    }
    if (parse.data.website) return res.redirect('/console'); // robot

    const faible = validerMotDePasse(parse.data.motdepasse);
    if (faible) return rendre({ motdepasse: faible }, req.body);

    const { agencyId, jetonVerif, credits } = await inscrire({
      agence: parse.data.agence,
      email: parse.data.email,
      motDePasse: parse.data.motdepasse,
      nom: parse.data.nom,
    });

    // Première paire de clés, créée d'office : c'est ce que le client vient
    // chercher. La secrète est affichée une seule fois, juste après.
    const clePublique = await creerCle(agencyId, 'public', 'clé du site');
    const cleSecrete = await creerCle(agencyId, 'secret', 'clé serveur');

    await courriel.bienvenue({
      a: parse.data.email,
      nomAgence: parse.data.agence,
      credits,
      lienVerif: `${env.baseUrl}/verification?jeton=${jetonVerif}`,
    });

    const utilisateurs = await query('SELECT id FROM users WHERE agency_id = :a LIMIT 1', { a: agencyId });
    res.ouvrirSession(agencyId, utilisateurs[0]?.id ?? null);

    res.render('pages/bienvenue', {
      title: `Bienvenue — ${brand.name}`,
      description: '',
      agence: parse.data.agence,
      credits,
      clePublique,
      cleSecrete,
      emailEnvoye: courriel.estActif(),
      email: parse.data.email,
    });
  } catch (err) {
    if (err instanceof ErreurAuth) return rendre({ email: err.publicMessage }, req.body, err.status);
    next(err);
  }
});

/* ============================================================ CONNEXION === */

router.get('/connexion', (req, res) => {
  if (req.session?.agencyId) return res.redirect('/console');
  res.render('pages/connexion', {
    title: `Connexion — ${brand.name}`,
    description: '',
    erreur: req.query.expire ? 'Votre session a expiré. Reconnectez-vous.' : null,
    valeurs: {},
  });
});

router.post('/connexion', brider(10), async (req, res, next) => {
  try {
    const email = String(req.body.email || '');
    const mdp = String(req.body.motdepasse || '');
    const session = await connecter(email, mdp);
    res.ouvrirSession(session.agencyId, session.userId);
    res.redirect(req.body.suite && req.body.suite.startsWith('/') ? req.body.suite : '/console');
  } catch (err) {
    if (err instanceof ErreurAuth) {
      return res.status(err.status).render('pages/connexion', {
        title: `Connexion — ${brand.name}`,
        description: '',
        erreur: err.publicMessage,
        valeurs: { email: req.body.email },
      });
    }
    next(err);
  }
});

router.post('/deconnexion', (req, res) => {
  res.fermerSession();
  res.redirect('/');
});

/* ======================================================== VÉRIFICATION === */

router.get('/verification', async (req, res, next) => {
  try {
    const ok = await verifierEmail(req.query.jeton);
    res.render('pages/verification', {
      title: `Vérification — ${brand.name}`,
      description: '',
      ok: Boolean(ok),
    });
  } catch (err) {
    next(err);
  }
});

/* ==================================================== MOT DE PASSE OUBLIÉ = */

router.get('/mot-de-passe-oublie', (req, res) => {
  res.render('pages/oubli', {
    title: `Mot de passe oublié — ${brand.name}`,
    description: '',
    envoye: false,
    erreur: null,
  });
});

router.post('/mot-de-passe-oublie', brider(5), async (req, res, next) => {
  try {
    const jeton = await demanderReinitialisation(req.body.email || '');
    if (jeton) {
      await courriel.reinitialisation({
        a: String(req.body.email).trim(),
        lien: `${env.baseUrl}/nouveau-mot-de-passe?jeton=${jeton}`,
      });
    }
    // Même écran que l'adresse existe ou non : le formulaire ne doit pas
    // permettre de savoir qui est inscrit.
    res.render('pages/oubli', {
      title: `Mot de passe oublié — ${brand.name}`,
      description: '',
      envoye: true,
      erreur: null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/nouveau-mot-de-passe', (req, res) => {
  res.render('pages/nouveau-mot-de-passe', {
    title: `Nouveau mot de passe — ${brand.name}`,
    description: '',
    jeton: String(req.query.jeton || ''),
    erreur: null,
  });
});

router.post('/nouveau-mot-de-passe', brider(6), async (req, res, next) => {
  const jeton = String(req.body.jeton || '');
  const rendre = (erreur) =>
    res.status(400).render('pages/nouveau-mot-de-passe', {
      title: `Nouveau mot de passe — ${brand.name}`,
      description: '',
      jeton,
      erreur,
    });
  try {
    const faible = validerMotDePasse(req.body.motdepasse);
    if (faible) return rendre(faible);
    await reinitialiser(jeton, req.body.motdepasse);
    res.redirect('/connexion?change=1');
  } catch (err) {
    if (err instanceof ErreurAuth) return rendre(err.publicMessage);
    next(err);
  }
});

/* ========================================================= ESPACE COMPTE = */

router.get('/console/compte', exigerSession, async (req, res, next) => {
  try {
    res.render('pages/compte', await etatCompte(req, { paiement: req.query.paiement || null }));
  } catch (err) {
    next(err);
  }
});

async function etatCompte(req, extra = {}) {
  const a = req.session.agencyId;
  const [agence] = await query(
    `SELECT name, plan_id, credits_balance, watermark, abonnement_statut, periode_fin, billing_email
       FROM agencies WHERE id = :id`,
    { id: a }
  );
  const cles = await query(
    `SELECT id, kind, key_prefix, label, revoked_at, last_used_at, created_at
       FROM api_keys WHERE agency_id = :a ORDER BY kind, id DESC`,
    { a }
  );
  const domaines = await query(
    'SELECT id, domain, created_at FROM allowed_domains WHERE agency_id = :a ORDER BY domain',
    { a }
  );
  const factures = await query(
    `SELECT montant_cents, devise, credits, plan_id, created_at
       FROM payments WHERE agency_id = :a ORDER BY id DESC LIMIT 12`,
    { a }
  );

  return {
    title: `Mon compte — ${brand.name}`,
    description: '',
    agence,
    cles,
    domaines,
    factures,
    credits: await solde(a),
    paiementActif: paiement.estActif(),
    // Ces trois-là doivent exister même quand l'appelant ne les fournit pas :
    // une vue EJS lève sur une variable absente, pas sur une variable nulle.
    paiement: null,
    nouvelleCle: null,
    message: null,
    ...extra,
  };
}

/* --------------------------------------------------------- domaines ----- */

/** Un domaine se déclare sans protocole, sans port, sans chemin. */
function normaliserDomaine(brut) {
  let d = String(brut || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (!d) return null;
  // Autorise le joker de sous-domaine, refuse tout le reste.
  if (!/^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$|^localhost$|^127\.0\.0\.1$|^(\*\.)?localhost$/.test(d)) return null;
  return d;
}

router.post('/console/compte/domaines', exigerSession, async (req, res, next) => {
  try {
    const d = normaliserDomaine(req.body.domaine);
    if (!d) {
      return res.status(400).render('pages/compte', await etatCompte(req, {
        message: { type: 'erreur', texte: 'Domaine invalide. Exemples : mon-agence.fr, *.mon-agence.fr' },
      }));
    }
    await query('INSERT IGNORE INTO allowed_domains (agency_id, domain) VALUES (:a, :d)', {
      a: req.session.agencyId, d,
    });
    res.render('pages/compte', await etatCompte(req, {
      message: { type: 'ok', texte: `« ${d} » est maintenant autorisé. Le widget y fonctionne immédiatement.` },
    }));
  } catch (err) {
    next(err);
  }
});

router.post('/console/compte/domaines/:id/supprimer', exigerSession, async (req, res, next) => {
  try {
    await query('DELETE FROM allowed_domains WHERE id = :id AND agency_id = :a', {
      id: Number(req.params.id) || 0, a: req.session.agencyId,
    });
    res.render('pages/compte', await etatCompte(req, {
      message: { type: 'ok', texte: 'Domaine retiré. Le widget y sera refusé dès maintenant.' },
    }));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------- clés ----- */

router.post('/console/compte/cles', exigerSession, async (req, res, next) => {
  try {
    const kind = req.body.type === 'secret' ? 'secret' : 'public';
    const cle = await creerCle(req.session.agencyId, kind, String(req.body.label || '').slice(0, 120) || null);
    res.render('pages/compte', await etatCompte(req, {
      nouvelleCle: { valeur: cle, kind },
      message: { type: 'ok', texte: 'Clé créée. Elle ne sera plus jamais affichée — copiez-la maintenant.' },
    }));
  } catch (err) {
    next(err);
  }
});

router.post('/console/compte/cles/:id/revoquer', exigerSession, async (req, res, next) => {
  try {
    await query(
      'UPDATE api_keys SET revoked_at = NOW() WHERE id = :id AND agency_id = :a AND revoked_at IS NULL',
      { id: Number(req.params.id) || 0, a: req.session.agencyId }
    );
    res.render('pages/compte', await etatCompte(req, {
      message: { type: 'ok', texte: 'Clé révoquée. Elle est refusée immédiatement, partout.' },
    }));
  } catch (err) {
    next(err);
  }
});

export { etatCompte, genererCle };
export default router;
