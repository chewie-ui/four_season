import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCENES, DEMO_ORDER, sceneById } from '../config/scenes.js';
import brand from '../config/brand.js';

const router = Router();
const racine = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Le CSS de la scène, lu une fois, injecté dans les SVG autonomes. */
let cssScene = null;
async function getCssScene() {
  if (cssScene == null) cssScene = await readFile(join(racine, 'public', 'css', 'scene.css'), 'utf8');
  return cssScene;
}

/** Traduit les tokens d'une ambiance en déclarations CSS inline. */
function styleRacine(v) {
  const angle = ((v.lightAngle || 0) * Math.PI) / 180;
  return [
    `--sky-top:${v.skyTop}`, `--sky-bottom:${v.skyBottom}`, `--light:${v.light}`,
    `--wall:${v.wall}`, `--roof:${v.roof}`, `--ground:${v.ground}`,
    `--foliage:${v.foliage}`, `--foliage-alt:${v.foliageAlt}`,
    `--glow:${v.glow}`, `--stars:${v.stars}`, `--rain:${v.rain}`,
    `--snow:${v.snow}`, `--flakes:${v.flakes}`, `--fog:${v.fog}`,
    `--blossom:${v.blossom}`, `--win-lit:${v.windowsLit || 0}`,
    `--sun-x:${((v.sunX ?? 0.5) * 800).toFixed(1)}px`,
    `--sun-y:${(330 - Math.sin(angle) * 285).toFixed(1)}px`,
  ].join(';');
}

/**
 * Une ambiance rendue en SVG autonome (styles inclus dans le fichier).
 * Sert de jeu de « photos » factices pour l'exemple d'intégration :
 * la mécanique du widget devient démontrable sans consommer d'IA.
 */
router.get('/scene/:id.svg', async (req, res, next) => {
  try {
    const scene = sceneById[req.params.id];
    if (!scene) return res.status(404).type('text/plain').send('Ambiance inconnue');

    const inlineCss = await getCssScene();
    const svg = await new Promise((resolve, reject) => {
      res.app.render(
        'partials/scene-standalone',
        { sid: `s-${scene.id}`, rootStyle: styleRacine(scene.visual), inlineCss },
        (err, out) => (err ? reject(err) : resolve(out))
      );
    });

    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(svg);
  } catch (err) {
    next(err);
  }
});

/**
 * Page « faux site client », affichée dans une iframe sur /integration.
 * Volontairement sans notre CSS : on montre le widget tel qu'il arrive chez une agence.
 */
router.get('/exemple', (req, res) => {
  res.render('pages/embed-exemple', {
    title: 'Exemple d’intégration',
    scenes: DEMO_ORDER.map((id) => sceneById[id]),
    brand,
  });
});

router.get('/scenes.json', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(SCENES.map(({ id, group, label, short, visual }) => ({ id, group, label, short, visual })));
});

export default router;
