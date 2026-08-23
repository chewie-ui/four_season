/**
 * Contrôle avant mise en ligne.
 *   npm run preflight
 *
 * Vérifie mécaniquement ce qui, oublié, expose le service ou la société.
 * Sort en code 1 si un point BLOQUANT échoue — de quoi le brancher dans
 * un script de déploiement pour qu'une erreur empêche la mise en ligne.
 *
 * À exécuter AVEC le .env de production chargé.
 */
import { readFile, access, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import env from '../config/env.js';
import { query, closePool } from '../db/pool.js';

const controles = [];
const ajouter = (niveau, titre, ok, detail = '') => controles.push({ niveau, titre, ok, detail });
const BLOQUANT = 'BLOQUANT';
const AVERTIR = 'à vérifier';

/* ------------------------------------------------------- environnement --- */

ajouter(
  BLOQUANT,
  'NODE_ENV vaut « production »',
  env.nodeEnv === 'production',
  `valeur actuelle : ${env.nodeEnv}`
);

const secretDefaut = 'dev-only-secret-change-me';
ajouter(
  BLOQUANT,
  'SESSION_SECRET propre au serveur',
  env.sessionSecret !== secretDefaut && env.sessionSecret.length >= 32,
  env.sessionSecret === secretDefaut
    ? 'la valeur par défaut est publique : n’importe qui peut forger un cookie de console'
    : `longueur : ${env.sessionSecret.length} (48 recommandés)`
);

ajouter(
  BLOQUANT,
  'garde-fou SSRF actif',
  !env.autoriserHotesPrives,
  env.autoriserHotesPrives
    ? 'ALLOW_PRIVATE_IMAGE_HOSTS est actif : un client pourrait nous faire lire le réseau interne'
    : ''
);

const urlOk = /^https:\/\//.test(env.baseUrl) && !/localhost|127\.0\.0\.1/.test(env.baseUrl);
ajouter(
  BLOQUANT,
  'BASE_URL est le domaine public en HTTPS',
  urlOk,
  `valeur actuelle : ${env.baseUrl}` +
    (urlOk ? '' : ' — les URL d’images envoyées aux agences seraient inutilisables')
);

ajouter(
  AVERTIR,
  'TRUST_PROXY activé si derrière nginx',
  env.trustProxy,
  env.trustProxy ? '' : 'sans lui, la limite de débit voit toutes les requêtes venir du proxy'
);

ajouter(
  AVERTIR,
  'plafond de dépense défini',
  Number.isFinite(env.budgetHardLimitEur) && env.budgetHardLimitEur > 0,
  `BUDGET_HARD_LIMIT_EUR = ${env.budgetHardLimitEur} €`
);

ajouter(
  AVERTIR,
  'worker lancé à part du serveur web',
  !env.workerInline,
  env.workerInline
    ? 'WORKER_INLINE=true : une génération qui plante emporte le site vitrine'
    : ''
);

/* ------------------------------------------------------------- secrets --- */

try {
  const gitignore = await readFile('.gitignore', 'utf8');
  ajouter(
    BLOQUANT,
    '.env exclu du dépôt',
    /^\.env\s*$/m.test(gitignore),
    ''
  );
} catch {
  ajouter(BLOQUANT, '.env exclu du dépôt', false, '.gitignore introuvable');
}

/* ---------------------------------------------------------------- base --- */

if (!env.db.configured) {
  ajouter(BLOQUANT, 'base de données configurée', false, 'DB_USER / DB_NAME manquants');
} else {
  try {
    const migrations = await query('SELECT version FROM schema_migrations ORDER BY version');
    const { readdir } = await import('node:fs/promises');
    const fichiers = (await readdir(new URL('../db/migrations/', import.meta.url)))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, ''))
      .sort();
    const manquantes = fichiers.filter((f) => !migrations.some((m) => m.version === f));

    ajouter(BLOQUANT, 'base joignable', true, `${migrations.length} migration(s) appliquée(s)`);
    ajouter(
      BLOQUANT,
      'toutes les migrations sont appliquées',
      manquantes.length === 0,
      manquantes.length ? `en attente : ${manquantes.join(', ')} — lancez npm run db:migrate` : ''
    );

    // Piège classique : `apt install mysql-server` installe MariaDB sur
    // plusieurs distributions. Or le schéma utilise la collation
    // utf8mb4_0900_ai_ci, qui n'existe que sur MySQL 8 — la migration
    // échouerait, ou pire, passerait avec une collation différente.
    const [{ v }] = await query('SELECT VERSION() AS v');
    const estMariaDB = /mariadb/i.test(v);
    const majeure = parseInt(v, 10);
    ajouter(
      BLOQUANT,
      'le serveur est MySQL 8 (et non MariaDB)',
      !estMariaDB && majeure >= 8,
      estMariaDB
        ? `MariaDB détecté (${v}) : la collation utf8mb4_0900_ai_ci du schéma n’existe pas chez elle`
        : `version : ${v}`
    );

    const agences = await query('SELECT COUNT(*) AS n FROM agencies');
    ajouter(AVERTIR, 'au moins une agence existe', Number(agences[0].n) > 0,
      `${agences[0].n} agence(s) — sinon lancez npm run db:seed`);
  } catch (err) {
    ajouter(BLOQUANT, 'base joignable', false, err.code || err.message);
  }
}

/* -------------------------------------------------------------- Gemini --- */

if (!env.gemini.configured) {
  ajouter(BLOQUANT, 'clé Gemini présente', false, 'GEMINI_API_KEY manquante');
} else {
  ajouter(BLOQUANT, 'clé Gemini présente', true, '');
  try {
    const rep = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' +
        encodeURIComponent(env.gemini.apiKey)
    );
    if (!rep.ok) {
      ajouter(BLOQUANT, 'clé Gemini acceptée', false, `HTTP ${rep.status}`);
    } else {
      const { models = [] } = await rep.json();
      const noms = models.map((m) => m.name.replace(/^models\//, ''));
      ajouter(BLOQUANT, 'clé Gemini acceptée', true, `${noms.length} modèles accessibles`);
      ajouter(
        BLOQUANT,
        `le modèle « ${env.gemini.model} » existe`,
        noms.includes(env.gemini.model),
        noms.includes(env.gemini.model)
          ? ''
          : `introuvable. Disponibles : ${noms.filter((n) => /image/i.test(n)).join(', ')}`
      );
    }
  } catch (err) {
    ajouter(BLOQUANT, 'clé Gemini acceptée', false, err.message);
  }
}

/* ------------------------------------------------------------ stockage --- */

try {
  await mkdir(env.storage.localPath, { recursive: true });
  const temoin = join(env.storage.localPath, '.preflight');
  await writeFile(temoin, 'ok');
  await unlink(temoin);
  ajouter(BLOQUANT, 'dossier de stockage accessible en écriture', true, env.storage.localPath);
} catch (err) {
  ajouter(BLOQUANT, 'dossier de stockage accessible en écriture', false, err.message);
}

ajouter(
  AVERTIR,
  'le stockage est sur un volume persistant',
  false,
  'à confirmer à la main : sur un disque éphémère, toutes les images générées ' +
    'disparaissent au redéploiement — et il faudra les repayer'
);

/* --------------------------------------------------------------- légal --- */

for (const page of ['legal', 'confidentialite']) {
  try {
    const contenu = await readFile(new URL(`../views/pages/${page}.ejs`, import.meta.url), 'utf8');
    // Les gabarits laissent des [champs à compléter] entre crochets.
    const restants = contenu.match(/\[[^\]<>\n]{3,40}\]/g) || [];
    ajouter(
      BLOQUANT,
      `page /${page === 'legal' ? 'mentions-legales' : page} complétée`,
      restants.length === 0,
      restants.length ? `${restants.length} champ(s) à remplir : ${[...new Set(restants)].slice(0, 4).join(' ')}` : ''
    );
  } catch {
    ajouter(BLOQUANT, `page ${page} présente`, false, 'fichier introuvable');
  }
}

try {
  await access('public/robots.txt');
  ajouter(AVERTIR, 'robots.txt présent', true, '');
} catch {
  ajouter(AVERTIR, 'robots.txt présent', false, '');
}

/* ------------------------------------------------------------- rapport --- */

await closePool().catch(() => {});

const large = Math.max(...controles.map((c) => c.titre.length)) + 2;
let bloquants = 0;
let avertissements = 0;

console.log('');
console.log('  CONTRÔLE AVANT MISE EN LIGNE');
console.log('  ' + '─'.repeat(large + 12));

for (const c of controles) {
  const estBloquant = c.niveau === BLOQUANT;
  if (!c.ok) estBloquant ? bloquants++ : avertissements++;
  const marque = c.ok ? '  ok  ' : estBloquant ? ' STOP ' : '  ??  ';
  console.log(`  [${marque}] ${c.titre.padEnd(large)}`);
  if (c.detail) console.log(`            ${c.detail}`);
}

console.log('  ' + '─'.repeat(large + 12));
if (bloquants) {
  console.log(`\n  ✖  ${bloquants} point(s) BLOQUANT(S). Ne mettez pas en ligne en l’état.`);
  console.log('     Détail : docs/DEPLOIEMENT.md\n');
  process.exitCode = 1;
} else if (avertissements) {
  console.log(`\n  ✔  Aucun bloquant. ${avertissements} point(s) à vérifier à la main.\n`);
} else {
  console.log('\n  ✔  Tout est vert.\n');
}
