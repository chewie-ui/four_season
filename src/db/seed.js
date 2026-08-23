/**
 * Crée une agence de développement avec ses clés d'API.
 *   npm run db:seed
 *
 * Les clés ne sont affichées qu'ici, une seule fois : elles sont stockées hachées.
 */
import { nanoid } from 'nanoid';
import env from '../config/env.js';
import { query, transaction, closePool } from './pool.js';
import { creerCle } from '../services/keys.js';
import brand from '../config/brand.js';

if (!env.db.configured) {
  console.error('✖  Base non configurée : renseignez DB_USER / DB_NAME dans .env');
  process.exit(1);
}

const SLUG = 'agence-de-test';

const existante = await query('SELECT id, name FROM agencies WHERE slug = :s', { s: SLUG });

let agencyId;
if (existante.length) {
  agencyId = existante[0].id;
  console.log(`ℹ  Agence « ${existante[0].name} » déjà présente (id ${agencyId}).`);
} else {
  agencyId = await transaction(async (conn) => {
    const [res] = await conn.execute(
      `INSERT INTO agencies (public_id, name, slug, plan_id, credits_balance, billing_email, watermark)
       VALUES (:pid, :name, :slug, 'decouverte', 0, :email, 1)`,
      {
        pid: nanoid(21),
        name: 'Agence de test',
        slug: SLUG,
        email: brand.email,
      }
    );
    const id = res.insertId;

    // 200 crédits d'amorçage, écrits dans le grand livre comme n'importe quel mouvement.
    await conn.execute(
      `INSERT INTO credit_ledger (agency_id, delta, reason, note)
       VALUES (:id, 200, 'adjustment', 'amorçage développement')`,
      { id }
    );
    await conn.execute('UPDATE agencies SET credits_balance = 200 WHERE id = :id', { id });
    return id;
  });
  console.log(`✔  Agence de test créée (id ${agencyId}), 200 crédits.`);
}

// Domaines autorisés pour la clé publique.
for (const domain of ['localhost', '127.0.0.1', '*.localhost']) {
  await query(
    'INSERT IGNORE INTO allowed_domains (agency_id, domain) VALUES (:a, :d)',
    { a: agencyId, d: domain }
  );
}

const publique = await creerCle(agencyId, 'public', 'dev — widget');
const secrete = await creerCle(agencyId, 'secret', 'dev — serveur');

console.log(`
┌───────────────────────────────────────────────────────────────────
│  Clés créées. Elles ne seront PLUS JAMAIS affichées.
│  Copiez-les maintenant.
├───────────────────────────────────────────────────────────────────
│  Publique (widget, visible dans le HTML) :
│    ${publique}
│
│  Secrète (serveur à serveur, JAMAIS dans une page) :
│    ${secrete}
├───────────────────────────────────────────────────────────────────
│  Domaines autorisés : localhost, 127.0.0.1, *.localhost
└───────────────────────────────────────────────────────────────────
`);

await closePool();
