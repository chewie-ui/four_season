/**
 * API de la console agence.
 * Authentifiée par session (cookie signé), jamais par clé dans le navigateur.
 */
import { Router } from 'express';
import multer from 'multer';
import { ZipArchive } from 'archiver'; // archiver 8 est en ESM : plus d'export par défaut

import { exigerSession } from '../middleware/session.js';
import { enregistrerSource } from '../services/images.js';
import { obtenirOuCreer } from '../services/variants.js';
import { creerBien, rattacherSource, lireBien, listerBiens, extraitIntegration } from '../services/biens.js';
import { solde } from '../services/credits.js';
import { get as lireStockage } from '../services/storage.js';
import { sceneById } from '../config/scenes.js';
import { geocoder } from '../services/geocodage.js';
import { apercuSolaire } from '../services/prompt.js';
import { query } from '../db/pool.js';

const router = Router();
router.use(exigerSession);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    /^image\/(jpeg|png|webp)$/.test(file.mimetype)
      ? cb(null, true)
      : cb(Object.assign(new Error('Formats acceptés : JPEG, PNG ou WebP.'), {
          status: 415,
          publicMessage: 'Formats acceptés : JPEG, PNG ou WebP.',
        })),
});

/* --------------------------------------------------------------- biens --- */

router.get('/biens', async (req, res, next) => {
  try {
    res.json({
      biens: await listerBiens(req.session.agencyId),
      credits: await solde(req.session.agencyId),
    });
  } catch (err) {
    next(err);
  }
});

/** Téléversement : crée le bien et enregistre la photo d'origine. */
router.post('/biens', upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucune photo reçue.' });

    const bien = await creerBien(req.session.agencyId, {
      titre: req.body.titre,
      ville: req.body.ville,
      reference: req.body.reference,
    });

    const source = await enregistrerSource(req.session.agencyId, req.file.buffer, {
      propertyId: bien.id,
    });
    // Une photo déjà connue garde son property_id d'origine : on le rebascule
    // sur le bien courant pour que la console affiche ce que l'agent vient de faire.
    await rattacherSource(source.id, bien.id);

    res.json({ bien: await lireBien(req.session.agencyId, bien.publicId) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.publicMessage || err.message });
    next(err);
  }
});

router.get('/biens/:publicId', async (req, res, next) => {
  try {
    const bien = await lireBien(req.session.agencyId, req.params.publicId);
    if (!bien) return res.status(404).json({ error: 'Bien introuvable.' });
    res.json({
      bien,
      credits: await solde(req.session.agencyId),
      soleil: apercuSolaireBien(bien, req.query.mois),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Géocode l'adresse et enregistre la position du bien.
 *
 * C'est ce qui permet de calculer la hauteur réelle du soleil : sans latitude,
 * le prompt ne peut dire que « lumière d'hiver », ce que le modèle interprète
 * au hasard. Avec, il donne des degrés et des longueurs d'ombre.
 */
router.post('/biens/:publicId/localiser', async (req, res, next) => {
  try {
    const bien = await lireBien(req.session.agencyId, req.params.publicId);
    if (!bien) return res.status(404).json({ error: 'Bien introuvable.' });

    const orientationBrute = req.body.orientation;
    const orientation =
      orientationBrute === '' || orientationBrute == null
        ? null
        : Math.round(((Number(orientationBrute) % 360) + 360) % 360);

    if (orientationBrute != null && orientationBrute !== '' && !Number.isFinite(Number(orientationBrute))) {
      return res.status(400).json({ error: 'Orientation de façade invalide.' });
    }

    let position = bien.lieu;

    // L'adresse n'est regéocodée que si elle a changé : inutile de solliciter
    // un service gratuit pour un simple changement d'orientation.
    const adresse = String(req.body.adresse || '').trim();
    if (adresse && adresse !== bien.lieu?.adresse) {
      const g = await geocoder(adresse, String(req.body.pays || '').trim());
      position = {
        adresse: g.adresse,
        latitude: g.latitude,
        longitude: g.longitude,
        pays: g.pays,
        precision: g.precision,
      };
      await query(
        `UPDATE properties
            SET address = :a, latitude = :lat, longitude = :lon,
                country_code = :pays, geocode_precision = :prec, city = COALESCE(:ville, city)
          WHERE id = :id AND agency_id = :ag`,
        {
          a: g.adresse.slice(0, 255),
          lat: g.latitude,
          lon: g.longitude,
          pays: g.pays,
          prec: g.precision,
          ville: g.ville,
          id: bien.id,
          ag: req.session.agencyId,
        }
      );
    }

    await query('UPDATE properties SET facade_orientation = :o WHERE id = :id AND agency_id = :a', {
      o: orientation,
      id: bien.id,
      a: req.session.agencyId,
    });

    const frais = await lireBien(req.session.agencyId, req.params.publicId);
    res.json({ bien: frais, soleil: apercuSolaireBien(frais, req.body.mois) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.publicMessage || err.message });
    next(err);
  }
});

/** Aperçu de la lumière pour chaque ambiance, affiché avant de générer. */
function apercuSolaireBien(bien, mois) {
  if (!bien?.lieu) return null;
  const m = mois ? Number(mois) : null;
  const out = {};
  for (const s of Object.keys(sceneById)) {
    const a = apercuSolaire(s, bien.lieu, m);
    if (a) out[s] = a;
  }
  return out;
}

/**
 * Génération groupée : c'est le geste central de la console.
 * L'agent coche 6 ambiances, un seul appel, 6 jobs en file.
 */
router.post('/biens/:publicId/generer', async (req, res, next) => {
  try {
    const bien = await lireBien(req.session.agencyId, req.params.publicId);
    if (!bien) return res.status(404).json({ error: 'Bien introuvable.' });
    if (!bien.sources.length) return res.status(400).json({ error: 'Ce bien n’a pas de photo.' });

    const scenes = Array.isArray(req.body.scenes) ? req.body.scenes : [];
    const consigne = String(req.body.consigne || '').slice(0, 300);

    // `forcer` : l'agent veut un autre essai d'une ambiance déjà rendue.
    // Sans lui, le cache renvoie l'existante et il a l'impression que le
    // bouton ne fait rien. Avec lui, chaque ambiance cochée est un crédit.
    const forcer = req.body.forcer === true;

    if (!scenes.length && !consigne) {
      return res.status(400).json({ error: 'Cochez au moins une ambiance.' });
    }

    const inconnues = scenes.filter((s) => !sceneById[s]);
    if (inconnues.length) return res.status(404).json({ error: `Ambiance inconnue : ${inconnues.join(', ')}` });

    const dispo = await solde(req.session.agencyId);
    const demandees = scenes.length + (consigne ? 1 : 0);
    if (dispo < demandees) {
      return res.status(402).json({
        error: `Il vous reste ${dispo} crédit(s) pour ${demandees} ambiance(s) demandée(s).`,
      });
    }

    const sourceId = await idSource(bien.sources[0].publicId);
    const lieu = bien.lieu;
    const mois = req.body.mois ? Number(req.body.mois) : null;
    const resultats = [];

    for (const scene of scenes) {
      resultats.push({
        scene,
        ...(await obtenirOuCreer({
          agencyId: req.session.agencyId,
          sourceImageId: sourceId,
          sceneId: scene,
          lieu,
          mois,
          forcer,
          priorite: 3,
        })),
      });
    }

    if (consigne) {
      resultats.push({
        scene: 'libre',
        consigne,
        ...(await obtenirOuCreer({
          agencyId: req.session.agencyId,
          sourceImageId: sourceId,
          sceneId: 'libre',
          consigne,
          lieu,
          mois,
          forcer,
          priorite: 2,
        })),
      });
    }

    // On distingue ce qui part vraiment de ce qui était déjà en cache.
    // Annoncer « 2 générations en cours » quand rien ne part est un mensonge
    // que l'agent découvre en regardant une barre qui n'avance pas.
    const lances = resultats.filter((r) => r.status !== 'ready').length;
    res.json({ lances, deja: resultats.length - lances, resultats });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.publicMessage || err.message });
    next(err);
  }
});

/** Le code d'intégration prêt à copier pour ce bien. */
router.get('/biens/:publicId/integration', async (req, res, next) => {
  try {
    const bien = await lireBien(req.session.agencyId, req.params.publicId);
    if (!bien) return res.status(404).json({ error: 'Bien introuvable.' });

    const cles = await query(
      `SELECT key_prefix FROM api_keys
        WHERE agency_id = :a AND kind = 'public' AND revoked_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      { a: req.session.agencyId }
    );
    // On ne peut pas réafficher la clé (elle est hachée) : on montre son préfixe
    // pour que l'agent reconnaisse laquelle utiliser, et il complète.
    const indice = cles.length ? `${cles[0].key_prefix}…` : 'pk_live_votre_cle';

    res.json(extraitIntegration(bien, indice));
  } catch (err) {
    next(err);
  }
});

/** Téléchargement groupé. Les JPEG sont déjà compressés : archive en « store ». */
router.get('/biens/:publicId/zip', async (req, res, next) => {
  try {
    const bien = await lireBien(req.session.agencyId, req.params.publicId);
    if (!bien) return res.status(404).json({ error: 'Bien introuvable.' });

    const pretes = bien.variantes.filter((v) => v.statut === 'ready');
    if (!pretes.length) return res.status(400).json({ error: 'Aucune ambiance prête.' });

    const nomBase = (bien.titre || 'bien')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'bien';

    res.attachment(`four-season-${nomBase}.zip`);
    // niveau 0 : les JPEG sont déjà compressés, compresser à nouveau ne
    // gagnerait rien et coûterait du CPU sur chaque téléchargement.
    const zip = new ZipArchive({ zlib: { level: 0 } });
    zip.on('error', (err) => next(err));
    zip.pipe(res);

    for (const src of bien.sources) {
      const cle = src.url.split('/media/')[1];
      zip.append(await lireStockage(cle), { name: `${nomBase}/00-photo-origine.jpg` });
    }

    let i = 1;
    for (const v of pretes) {
      const cle = v.url.split('/media/')[1];
      const num = String(i++).padStart(2, '0');
      // Le préfixe numérique suffirait à éviter la collision, mais « -v2 » dit
      // à l'agent laquelle des deux versions il ouvre.
      const suffixe = v.version > 1 ? `-v${v.version}` : '';
      zip.append(await lireStockage(cle), { name: `${nomBase}/${num}-${v.scene}${suffixe}.jpg` });
    }

    await zip.finalize();
  } catch (err) {
    next(err);
  }
});

async function idSource(publicId) {
  const r = await query('SELECT id FROM source_images WHERE public_id = :p LIMIT 1', { p: publicId });
  return r[0]?.id;
}

export default router;
