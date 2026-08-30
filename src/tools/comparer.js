/**
 * Comparateur de modèles.
 *
 *   npm run gemini:comparer -- photo.jpg hiver
 *
 * Même photo, même prompt, tous les modèles d'image disponibles. Produit une
 * planche contact et un tableau des durées, et écrit chaque rendu séparément.
 *
 * Choisir un modèle « au ressenti » ou d'après une fiche produit ne veut rien
 * dire ici : ce qui compte est la fidélité architecturale sur VOS photos, et
 * elle ne se mesure qu'en regardant. Le coût de l'essai — moins d'un euro —
 * est sans commune mesure avec celui d'un mauvais choix tenu six mois.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';

import env from '../config/env.js';
import { generateVariant, COST_MICRO_EUR } from '../services/gemini.js';
import { preparer } from '../services/images.js';
import { construire } from '../services/prompt.js';
import { sceneById } from '../config/scenes.js';

const [cheminArg, sceneArg, ...modelesArg] = process.argv.slice(2);
const chemin = resolve(cheminArg || 'public/img/exemple-bien.jpg');
const sceneId = sceneArg || 'hiver';

// À défaut de liste explicite, on interroge le compte pour savoir ce qui est
// réellement accessible : les catalogues changent plus vite que la doc.
const CANDIDATS = modelesArg.length
  ? modelesArg
  : [
      'gemini-2.5-flash-image',
      'gemini-3.1-flash-image',
      'gemini-3-pro-image',
      'gemini-3.1-flash-lite-image',
    ];

if (!sceneById[sceneId]) {
  console.error(`✖  Ambiance inconnue : ${sceneId}`);
  console.error(`   Disponibles : ${Object.keys(sceneById).join(', ')}`);
  process.exit(1);
}

// Un lieu réel : sans lui le prompt reste vague et la comparaison porte
// sur moins de contraintes, donc discrimine moins bien.
const LIEU = { latitude: 45.9, longitude: 6.13, pays: 'FR', orientationFacade: 180 };

const source = await readFile(chemin).catch(() => {
  console.error(`✖  Photo introuvable : ${chemin}`);
  process.exit(1);
});
const prete = await preparer(source);
const prompt = construire(sceneId, { lieu: LIEU });

const dossier = join(env.storage.localPath, 'comparaison');
await mkdir(dossier, { recursive: true });
await writeFile(join(dossier, 'prompt.txt'), prompt, 'utf8');

console.log('');
console.log(`  COMPARAISON DE MODÈLES — ambiance « ${sceneId} »`);
console.log('  ' + '─'.repeat(66));
console.log(`  photo   : ${chemin}`);
console.log(`  prompt  : ${prompt.length} caractères (écrit dans ${dossier}/prompt.txt)`);
console.log(`  modèles : ${CANDIDATS.length}`);
console.log('');

const resultats = [];

for (const modele of CANDIDATS) {
  process.stdout.write(`  ${modele.padEnd(30)} `);
  const t0 = Date.now();
  try {
    const r = await generateVariant(prete.buffer, prete.mime, sceneId, {
      promptComplet: prompt,
      model: modele,
    });
    const fichier = join(dossier, `${sceneId}-${modele}.jpg`);
    const jpeg = await sharp(r.buffer).jpeg({ quality: 92 }).toBuffer();
    await writeFile(fichier, jpeg);
    const meta = await sharp(jpeg).metadata();

    resultats.push({
      modele,
      ok: true,
      secondes: (r.latencyMs / 1000).toFixed(1),
      cout: (COST_MICRO_EUR[modele] ?? null),
      dimensions: `${meta.width}×${meta.height}`,
      poids: Math.round(jpeg.length / 1024),
      fichier,
    });
    console.log(`✔  ${(r.latencyMs / 1000).toFixed(1)} s   ${meta.width}×${meta.height}`);
  } catch (err) {
    resultats.push({ modele, ok: false, erreur: String(err.publicMessage || err.message).slice(0, 90) });
    console.log(`✖  ${String(err.publicMessage || err.message).slice(0, 70)}`);
  }
}

/* ------------------------------------------------------ planche contact -- */

const reussis = resultats.filter((r) => r.ok);
if (reussis.length) {
  const LARGEUR = 640;
  const vignettes = [
    { titre: 'ORIGINAL', buffer: prete.buffer },
    ...(await Promise.all(
      reussis.map(async (r) => ({ titre: r.modele, buffer: await readFile(r.fichier) }))
    )),
  ];

  const colonnes = Math.min(2, vignettes.length);
  const rendues = await Promise.all(
    vignettes.map(async (v) => {
      const img = await sharp(v.buffer).resize({ width: LARGEUR, withoutEnlargement: false }).toBuffer();
      const meta = await sharp(img).metadata();
      const bandeau = Buffer.from(
        `<svg width="${LARGEUR}" height="34" xmlns="http://www.w3.org/2000/svg">
           <rect width="${LARGEUR}" height="34" fill="#0B1220"/>
           <text x="12" y="23" font-family="monospace" font-size="15" fill="#F2C879">${v.titre}</text>
         </svg>`
      );
      return sharp({
        create: { width: LARGEUR, height: meta.height + 34, channels: 3, background: '#0B1220' },
      })
        .composite([{ input: bandeau, top: 0, left: 0 }, { input: img, top: 34, left: 0 }])
        .png()
        .toBuffer();
    })
  );

  const hauteurs = await Promise.all(rendues.map((b) => sharp(b).metadata().then((m) => m.height)));
  const hLigne = Math.max(...hauteurs);
  const lignes = Math.ceil(rendues.length / colonnes);

  const planche = join(dossier, `planche-${sceneId}.jpg`);
  await sharp({
    create: {
      width: LARGEUR * colonnes + 12 * (colonnes + 1),
      height: hLigne * lignes + 12 * (lignes + 1),
      channels: 3,
      background: '#060B14',
    },
  })
    .composite(
      rendues.map((input, i) => ({
        input,
        left: 12 + (i % colonnes) * (LARGEUR + 12),
        top: 12 + Math.floor(i / colonnes) * (hLigne + 12),
      }))
    )
    .jpeg({ quality: 88 })
    .toFile(planche);

  console.log('');
  console.log(`  planche contact : ${planche}`);
}

/* ------------------------------------------------------------ rapport ---- */

console.log('');
console.log('  ' + '─'.repeat(66));
console.log('  ' + 'MODÈLE'.padEnd(30) + 'DURÉE'.padEnd(10) + 'DÉFINITION'.padEnd(14) + 'POIDS');
for (const r of resultats) {
  if (!r.ok) {
    console.log('  ' + r.modele.padEnd(30) + 'indisponible — ' + r.erreur);
    continue;
  }
  console.log(
    '  ' + r.modele.padEnd(30) + `${r.secondes} s`.padEnd(10) + r.dimensions.padEnd(14) + `${r.poids} Ko`
  );
}
console.log('');
console.log('  Ouvrez la planche contact et jugez sur trois critères, dans cet ordre :');
console.log('    1. la maison est-elle la MÊME ? (toit, ouvertures, matériaux, cadrage)');
console.log('    2. la lumière suit-elle la consigne ? (hauteur du soleil, sens des ombres)');
console.log('    3. seulement ensuite : est-ce beau ?');
console.log('');
console.log('  Un modèle plus « joli » qui redessine la maison est inutilisable ici.');
console.log('  Vérifiez aussi les tarifs : https://ai.google.dev/gemini-api/docs/pricing');
console.log('');
