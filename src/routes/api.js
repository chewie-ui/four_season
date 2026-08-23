import { Router } from 'express';
import multer from 'multer';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import sharp from 'sharp';

import env from '../config/env.js';
import brand from '../config/brand.js';
import { SCENES, GROUPS, sceneById } from '../config/scenes.js';
import { generateVariant, isConfigured as geminiReady, GeminiError } from '../services/gemini.js';
import { put } from '../services/storage.js';
import { assertWithinBudget, record, summary } from '../services/budget.js';
import { filigraner } from '../services/watermark.js';
import { authentifier, corsWidget } from '../middleware/auth.js';
import { ingererDepuisUrl, enregistrerSource } from '../services/images.js';
import { obtenirOuCreer, etatVariante } from '../services/variants.js';
import { solde } from '../services/credits.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Formats acceptés : JPEG, PNG ou WebP.'), { status: 415, publicMessage: 'Formats acceptés : JPEG, PNG ou WebP.' }));
  },
});

// ---------------------------------------------------------------- catalogue

router.get('/scenes', (req, res) => {
  res.json({
    groups: GROUPS,
    scenes: SCENES.map(({ id, group, label, short, description, visual }) => ({
      id, group, label, short, description, visual,
    })),
  });
});

router.get('/status', async (req, res) => {
  res.json({
    gemini: geminiReady() ? 'prêt' : 'clé absente',
    model: env.gemini.model,
    budget: await summary(),
  });
});

// ------------------------------------------------------------ démo publique

// La démo est le poste de dépense le plus risqué : on la bride sévèrement.
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Vous avez utilisé vos essais gratuits de l’heure. Écrivez-nous pour une démo complète.',
  },
});

router.post('/demo/generate', demoLimiter, upload.single('photo'), async (req, res, next) => {
  try {
    const sceneId = String(req.body.scene || '');
    const scene = sceneById[sceneId];
    if (!scene) return res.status(400).json({ error: 'Ambiance inconnue.' });
    if (!req.file) return res.status(400).json({ error: 'Aucune photo reçue.' });

    if (!geminiReady()) {
      return res.status(503).json({
        error: 'La génération réelle n’est pas encore activée sur cet environnement.',
        hint: 'Renseignez GEMINI_API_KEY dans .env puis redémarrez.',
      });
    }

    await assertWithinBudget();

    // On réduit avant l'envoi : moins de tokens en entrée, réponse plus rapide,
    // et le rendu final reste largement suffisant pour une annonce web.
    const prepared = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();

    const result = await generateVariant(prepared, 'image/jpeg', sceneId, {
      extra: String(req.body.consigne || '').slice(0, 400),
    });

    await record(result.costMicroEur);

    const finalBuffer = await filigraner(result.buffer);
    const stored = await put(finalBuffer, 'image/jpeg', 'demo');

    res.json({
      scene: { id: scene.id, label: scene.label },
      url: stored.url,
      latencyMs: result.latencyMs,
      model: result.model,
    });
  } catch (err) {
    if (err instanceof GeminiError || err.status) {
      return res.status(err.status || 500).json({ error: err.publicMessage || err.message });
    }
    next(err);
  }
});

/* =====================================================================
   RENDU — l'endpoint appelé par le widget et par les serveurs clients.
   ===================================================================== */

// Placé APRÈS `authentifier` : on compte par agence, pas par IP. Sinon une
// agence dont tous les visiteurs sortent par le même proxy se brimerait elle-même.
// `ipKeyGenerator` normalise l'IPv6 en /64 — sans lui, un visiteur peut changer
// d'adresse dans son propre préfixe et contourner la limite indéfiniment.
const renderLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req, res) =>
    req.auth?.agencyId ? `agence:${req.auth.agencyId}` : ipKeyGenerator(req.ip),
  message: { error: 'Trop de demandes. Ralentissez.' },
});

router.options('/render', corsWidget);
router.options('/render/:jeton', corsWidget);

/**
 * POST /api/v1/render
 *
 * Clé publique (widget)  : { cle: 'pk_…', image: 'https://…', scene: 'hiver' }
 * Clé secrète (serveur)  : Authorization: Bearer sk_…
 *                          { image: 'https://…', scenes: ['hiver','coucher'] }
 *
 * Réponses :
 *   { status:'ready', url }                  — déjà en cache, gratuit
 *   { status:'queued'|'processing', jeton }  — à sonder sur GET /render/:jeton
 *   { variantes: [...] }                     — si plusieurs ambiances demandées
 */
router.post('/render', corsWidget, authentifier, renderLimiter, async (req, res, next) => {
  try {
    const { agencyId, kind } = req.auth;

    const demandees = Array.isArray(req.body.scenes)
      ? req.body.scenes
      : [req.body.scene].filter(Boolean);

    if (!demandees.length) return res.status(400).json({ error: 'Aucune ambiance demandée.' });
    if (demandees.length > 13) return res.status(400).json({ error: 'Treize ambiances au maximum par appel.' });

    // Une clé publique vient d'un navigateur : elle ne peut demander qu'une
    // ambiance à la fois, pour qu'un visiteur ne déclenche pas 13 générations.
    if (kind === 'public' && demandees.length > 1) {
      return res.status(403).json({ error: 'Une seule ambiance par appel avec une clé publique.' });
    }

    const inconnues = demandees.filter((s) => s !== 'libre' && !sceneById[s]);
    if (inconnues.length) {
      return res.status(404).json({ error: `Ambiance inconnue : ${inconnues.join(', ')}` });
    }

    if (!req.body.image) return res.status(400).json({ error: 'Champ « image » manquant.' });

    const source = await ingererDepuisUrl(agencyId, String(req.body.image), {
      propertyId: null,
    });

    const consigne = String(req.body.consigne || '').slice(0, 300);
    // Un visiteur qui attend est prioritaire sur un pré-calcul de nuit.
    const priorite = kind === 'public' ? 1 : 5;

    const resultats = [];
    for (const scene of demandees) {
      const r = await obtenirOuCreer({
        agencyId,
        sourceImageId: source.id,
        sceneId: scene,
        consigne,
        priorite,
      });
      resultats.push({ scene, ...r });
    }

    if (resultats.length === 1) return res.json(resultats[0]);
    res.json({ variantes: resultats });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.publicMessage || err.message });
    next(err);
  }
});

/** Sondage. Pas de clé requise : le jeton est un nanoid, non énumérable. */
router.get('/render/:jeton', corsWidget, async (req, res, next) => {
  try {
    const etat = await etatVariante(req.params.jeton);
    if (!etat) return res.status(404).json({ error: 'Rendu introuvable.' });
    res.set('Cache-Control', etat.status === 'ready' ? 'public, max-age=300' : 'no-store');
    res.json(etat);
  } catch (err) {
    next(err);
  }
});

/** Solde de l'agence — pour l'espace client et les intégrations serveur. */
router.get('/compte', authentifier, async (req, res, next) => {
  try {
    res.json({
      agence: req.auth.agency.name,
      offre: req.auth.agency.planId,
      credits: await solde(req.auth.agencyId),
      filigrane: req.auth.agency.watermark,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
