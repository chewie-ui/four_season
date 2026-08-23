/**
 * Liste les modèles réellement accessibles à VOTRE clé.
 *   npm run gemini:models
 *
 * Utile parce que Google renomme et retire ses modèles régulièrement :
 * plutôt que de deviner ce qu'il faut mettre dans GEMINI_IMAGE_MODEL,
 * on demande. Gratuit, aucun appel de génération.
 */
import env from '../config/env.js';

if (!env.gemini.configured) {
  console.error('✖  GEMINI_API_KEY absente du .env');
  process.exit(1);
}

const url =
  'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' +
  encodeURIComponent(env.gemini.apiKey);

const rep = await fetch(url);
if (!rep.ok) {
  console.error(`✖  HTTP ${rep.status}`);
  console.error((await rep.text()).slice(0, 400));
  process.exit(1);
}

const { models = [] } = await rep.json();
const noms = models.map((m) => m.name.replace(/^models\//, ''));
const images = noms.filter((n) => /image|imagen|banana/i.test(n));

console.log('');
console.log(`  ${noms.length} modèles accessibles à cette clé.`);
console.log('');
console.log('  MODÈLES D’IMAGE — candidats pour GEMINI_IMAGE_MODEL');
console.log('  ─────────────────────────────────────────────────────');
for (const n of images) {
  const actuel = n === env.gemini.model ? '  ← actuellement utilisé' : '';
  console.log(`    ${n}${actuel}`);
}
if (!images.length) console.log('    aucun — la clé n’a pas accès aux modèles d’image');

console.log('');
console.log('  Comparez les tarifs avant de changer :');
console.log('  https://ai.google.dev/gemini-api/docs/pricing');
console.log('');
