/**
 * Migrations.
 *   npm run db:migrate
 *
 * Applique dans l'ordre les fichiers de `migrations/` qui n'ont pas encore
 * été joués, et enregistre chacun dans `schema_migrations`.
 *
 * Règle : une migration appliquée n'est JAMAIS modifiée. Pour corriger,
 * on ajoute un fichier suivant. Sinon les bases des trois développeurs
 * divergent silencieusement — et celle de production avec.
 */
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mysql from 'mysql2/promise';
import env from '../config/env.js';

const here = dirname(fileURLToPath(import.meta.url));
const dossier = join(here, 'migrations');

if (!env.db.configured) {
  console.error('✖  DB_USER / DB_NAME manquants dans .env');
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  multipleStatements: true,
  charset: 'utf8mb4',
});

await conn.query(
  `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
);
await conn.query(`USE \`${env.db.database}\``);

await conn.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    VARCHAR(120) NOT NULL,
    checksum   CHAR(64)     NOT NULL,
    applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (version)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

const [deja] = await conn.query('SELECT version, checksum FROM schema_migrations');
const appliquees = new Map(deja.map((r) => [r.version, r.checksum]));

const fichiers = (await readdir(dossier)).filter((f) => f.endsWith('.sql')).sort();

let jouees = 0;
for (const fichier of fichiers) {
  const version = fichier.replace(/\.sql$/, '');
  const sql = await readFile(join(dossier, fichier), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');

  if (appliquees.has(version)) {
    if (appliquees.get(version) !== checksum) {
      console.warn(
        `⚠  ${version} a été modifiée APRÈS avoir été appliquée.\n` +
          '   Les bases vont diverger. Créez plutôt une nouvelle migration.'
      );
    }
    continue;
  }

  process.stdout.write(`→  ${version} … `);
  try {
    await conn.query(sql);
    await conn.execute('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [
      version,
      checksum,
    ]);
    console.log('ok');
    jouees++;
  } catch (err) {
    console.log('ÉCHEC');
    console.error(`\n✖  ${version} : ${err.message}\n`);
    await conn.end();
    process.exit(1);
  }
}

await conn.end();
console.log(
  jouees
    ? `✔  ${jouees} migration(s) appliquée(s) sur « ${env.db.database} »`
    : `✔  « ${env.db.database} » est à jour (${fichiers.length} migration(s))`
);
