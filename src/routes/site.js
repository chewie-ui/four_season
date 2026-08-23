import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import env from '../config/env.js';
import brand from '../config/brand.js';
import { SCENES, GROUPS, DEMO_ORDER, sceneById, scenesByGroup } from '../config/scenes.js';
import { saveLead } from '../services/leads.js';

const router = Router();

const demoScenes = DEMO_ORDER.map((id) => sceneById[id]);

router.get('/', (req, res) => {
  res.render('pages/accueil', {
    title: `${brand.name} — ${brand.tagline}`,
    description: brand.baseline,
    demoScenes,
    groups: GROUPS,
    scenesByGroup,
    totalScenes: SCENES.length,
  });
});

router.get('/demo', (req, res) => {
  res.render('pages/demo', {
    title: `Démo — ${brand.name}`,
    description: 'Testez la génération d’ambiances sur une photo de bien.',
    scenes: SCENES,
    groups: GROUPS,
    scenesByGroup,
  });
});

router.get('/integration', (req, res) => {
  res.render('pages/integration', {
    title: `Intégration — ${brand.name}`,
    description: 'Deux lignes de code pour ajouter Four Season à n’importe quel site.',
    scenes: SCENES,
  });
});

router.get('/tarifs', (req, res) => {
  res.render('pages/tarifs', {
    title: `Tarifs — ${brand.name}`,
    description: 'Des forfaits simples, à l’ambiance générée.',
  });
});

router.get('/contact', (req, res) => {
  res.render('pages/contact', {
    title: `Contact — ${brand.name}`,
    description: 'Parlons de votre agence.',
    plan: req.query.offre || '',
    sent: false,
    errors: null,
    values: {},
  });
});

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans un quart d’heure.' },
});

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Indiquez votre nom.').max(160),
  email: z.string().trim().email('Adresse email invalide.').max(190),
  company: z.string().trim().max(160).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  volume: z.string().trim().max(40).optional().or(z.literal('')),
  message: z.string().trim().max(4000).optional().or(z.literal('')),
  plan_id: z.string().trim().max(32).optional().or(z.literal('')),
  // Champ piège invisible : rempli = robot.
  website: z.string().max(0).optional().or(z.literal('')),
});

router.post('/contact', contactLimiter, async (req, res, next) => {
  const parsed = contactSchema.safeParse(req.body);

  if (!parsed.success) {
    const errors = {};
    for (const issue of parsed.error.issues) errors[issue.path[0]] = issue.message;
    return res.status(400).render('pages/contact', {
      title: `Contact — ${brand.name}`,
      description: 'Parlons de votre agence.',
      plan: req.body.plan_id || '',
      sent: false,
      errors,
      values: req.body,
    });
  }

  // Le robot a mordu : on fait semblant que tout va bien.
  if (parsed.data.website) {
    return res.render('pages/contact', {
      title: `Contact — ${brand.name}`,
      description: 'Parlons de votre agence.',
      plan: '',
      sent: true,
      errors: null,
      values: {},
    });
  }

  try {
    await saveLead({ ...parsed.data, source: req.get('referer') || 'direct', ip: req.ip });
  } catch (err) {
    return next(err);
  }

  res.render('pages/contact', {
    title: `Message envoyé — ${brand.name}`,
    description: 'Merci, nous revenons vers vous très vite.',
    plan: '',
    sent: true,
    errors: null,
    values: {},
  });
});

/**
 * robots.txt dynamique. Tant que SITE_INDEXABLE n'est pas vrai, on interdit
 * tout : un site incomplet indexe par Google est tres long a faire retirer.
 */
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600');

  if (!env.indexable) {
    return res.send('User-agent: *\nDisallow: /\n');
  }

  res.send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /console',
      'Disallow: /embed/',
      '',
      `Sitemap: ${env.baseUrl}/sitemap.xml`,
      '',
    ].join('\n')
  );
});

router.get('/mentions-legales', (req, res) => {
  res.render('pages/legal', { title: `Mentions légales — ${brand.name}`, description: '' });
});

router.get('/confidentialite', (req, res) => {
  res.render('pages/confidentialite', { title: `Confidentialité — ${brand.name}`, description: '' });
});

export default router;
