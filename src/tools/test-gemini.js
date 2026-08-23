/**
 * Vérification de la clé Gemini, en un appel.
 *
 *   npm run gemini:test
 *   npm run gemini:test -- chemin/vers/photo.jpg hiver
 *
 * Coûte une génération (≈ 0,04 €). C'est le prix d'un diagnostic sans ambiguïté :
 * on saura si le problème vient de la clé, du modèle, du quota ou du prompt.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import env from '../config/env.js';
import { generateVariant, GeminiError } from '../services/gemini.js';
import { preparer } from '../services/images.js';
import { sceneById, buildPrompt } from '../config/scenes.js';

const [cheminArg, sceneArg] = process.argv.slice(2);
const chemin = resolve(cheminArg || 'public/img/exemple-bien.jpg');
const sceneId = sceneArg || 'hiver';

console.log('');
console.log('  Vérification Gemini');
console.log('  ───────────────────────────────────────────────');
console.log(`  modèle  : ${env.gemini.model}`);
console.log(`  photo   : ${chemin}`);
console.log(`  ambiance: ${sceneId}`);
console.log('');

if (!env.gemini.configured) {
  console.error('  ✖  GEMINI_API_KEY est absente du .env');
  console.error('');
  console.error('     1. https://aistudio.google.com/apikey');
  console.error('     2. « Create API key », copier la clé (AIza…)');
  console.error('     3. GEMINI_API_KEY=AIza… dans .env');
  console.error('');
  process.exit(1);
}

if (!sceneById[sceneId]) {
  console.error(`  ✖  Ambiance inconnue : ${sceneId}`);
  console.error(`     Disponibles : ${Object.keys(sceneById).join(', ')}`);
  process.exit(1);
}

let source;
try {
  source = await readFile(chemin);
} catch {
  console.error(`  ✖  Photo introuvable : ${chemin}`);
  console.error('     Passez un chemin : npm run gemini:test -- ma-photo.jpg');
  process.exit(1);
}

const prete = await preparer(source).catch((err) => {
  console.error(`  ✖  ${err.publicMessage || err.message}`);
  process.exit(1);
});

console.log(`  → photo normalisée en ${prete.width} × ${prete.height}`);
console.log('  → appel du modèle, 15 à 40 secondes…');
console.log('');

const debut = Date.now();

try {
  const res = await generateVariant(prete.buffer, prete.mime, sceneId);

  const sortie = resolve(env.storage.localPath, `test-gemini-${sceneId}.jpg`);
  await mkdir(dirname(sortie), { recursive: true });
  await writeFile(sortie, res.buffer);

  console.log('  ✔  ÇA MARCHE');
  console.log('');
  console.log(`     durée   : ${(res.latencyMs / 1000).toFixed(1)} s`);
  console.log(`     coût    : ~${(res.costMicroEur / 1_000_000).toFixed(3)} €`);
  console.log(`     modèle  : ${res.model}`);
  console.log(`     résultat: ${sortie}`);
  console.log('');
  console.log('     Ouvrez le fichier et comparez avec la photo d’origine.');
  console.log('     La question n’est pas « est-ce joli » mais :');
  console.log('       · le toit a-t-il la même forme et la même pente ?');
  console.log('       · les fenêtres sont-elles au même endroit, en même nombre ?');
  console.log('       · le cadrage est-il identique ?');
  console.log('');
  console.log('     Si la réponse est non, le prompt est à retravailler dans');
  console.log('     src/config/scenes.js — pas le code.');
  console.log('');
} catch (err) {
  const secondes = ((Date.now() - debut) / 1000).toFixed(1);
  console.error(`  ✖  ÉCHEC après ${secondes} s`);
  console.error('');
  console.error(`     ${err.publicMessage || err.message}`);
  console.error('');

  if (err instanceof GeminiError) {
    const m = String(err.publicMessage || '');
    if (/invalide|accès/i.test(m)) {
      console.error('     → La clé est refusée. Vérifiez qu’elle est copiée en entier,');
      console.error('       sans espace ni retour à la ligne, et que la facturation est');
      console.error('       activée sur le projet Google Cloud associé.');
    } else if (/quota/i.test(m)) {
      console.error('     → Quota atteint. Le palier gratuit ne couvre pas toujours les');
      console.error('       modèles d’image : activez la facturation dans Google Cloud.');
    } else if (/introuvable|GEMINI_IMAGE_MODEL/i.test(m)) {
      console.error(`     → Le modèle « ${env.gemini.model} » n’existe pas ou n’est pas`);
      console.error('       accessible à votre compte. Les noms changent :');
      console.error('       https://ai.google.dev/gemini-api/docs/image-generation');
      console.error('       Corrigez GEMINI_IMAGE_MODEL dans .env.');
    } else if (/n’a pas produit d’image|pas produit/i.test(m)) {
      console.error('     → Le modèle a répondu du texte au lieu d’une image : filtre de');
      console.error('       sécurité, ou photo mal comprise. Réessayez avec une autre photo.');
    }
  }
  console.error('');
  console.error(`     Prompt envoyé (${buildPrompt(sceneId).length} caractères) :`);
  console.error(`     ${buildPrompt(sceneId).slice(0, 180)}…`);
  console.error('');
  process.exit(1);
}
