/** Pages de la console agence. */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { exigerSession } from '../middleware/session.js';
import { resoudreCle } from '../services/keys.js';
import { solde } from '../services/credits.js';
import { listerBiens } from '../services/biens.js';
import { GROUPS, SCENES, scenesByGroup } from '../config/scenes.js';
import brand from '../config/brand.js';

const router = Router();

const connexionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives.' },
});

router.get('/connexion', (req, res) => {
  if (req.session?.agencyId) return res.redirect('/console');
  res.render('pages/console-connexion', {
    title: `Console — ${brand.name}`,
    description: '',
    erreur: null,
  });
});

router.post('/connexion', connexionLimiter, async (req, res, next) => {
  try {
    const cle = String(req.body.cle || '').trim();
    const resolue = await resoudreCle(cle);

    if (!resolue || resolue.kind !== 'secret') {
      return res.status(401).render('pages/console-connexion', {
        title: `Console — ${brand.name}`,
        description: '',
        erreur: 'Clé secrète invalide. Elle commence par « sk_ ».',
      });
    }

    res.ouvrirSession(resolue.agencyId);
    res.redirect('/console');
  } catch (err) {
    next(err);
  }
});

router.post('/deconnexion', (req, res) => {
  res.fermerSession();
  res.redirect('/console/connexion');
});

router.get('/', exigerSession, async (req, res, next) => {
  try {
    res.render('pages/console', {
      title: `Console — ${brand.name}`,
      description: '',
      groups: GROUPS,
      scenesByGroup,
      scenes: SCENES,
      credits: await solde(req.session.agencyId),
      biens: await listerBiens(req.session.agencyId, 24),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
