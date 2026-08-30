/**
 * Liste les modèles réellement accessibles à VOTRE clé.
 *   npm run gemini:models
 *
 * Utile parce que Google renomme et retire ses modèles régulièrement :
 * plutôt que de deviner ce qu'il faut mettre dans GEMINI_IMAGE_MODEL,
 * on demande. Gratuit, aucun appel de génération.
 */
import env from '../config/env.js';

if (env.gemini.backend !== 'vertex' && !env.gemini.configured) {
  console.error('✖  GEMINI_API_KEY absente du .env');
  process.exit(1);
}

let noms = [];

if (env.gemini.backend === 'vertex') {
  // En mode Vertex, l'API grand public est inaccessible (et souvent bloquée
  // géographiquement) : on interroge le catalogue du projet via le SDK.
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({
    vertexai: true,
    project: env.gemini.project,
    location: env.gemini.location,
  });
  for await (const m of await ai.models.list()) {
    noms.push(String(m.name).replace(/^publishers\/google\/models\//, ''));
  }
} else {
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
  noms = models.map((m) => m.name.replace(/^models\//, ''));
}
const images = noms.filter((n) => /image|imagen|banana/i.test(n));

console.log('');
console.log(`  ${noms.length} modèles accessibles (${env.gemini.backend === 'vertex' ? 'Vertex AI, projet ' + env.gemini.project : 'clé AI Studio'}).`);
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
