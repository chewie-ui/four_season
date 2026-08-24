/**
 * Gestion des clés d'API et des domaines autorisés.
 *
 *   npm run cles                          état de l'agence
 *   npm run cles -- domaine + exemple.fr  autoriser un domaine
 *   npm run cles -- domaine - exemple.fr  le retirer
 *   npm run cles -- nouvelle publique     créer une clé pk_
 *   npm run cles -- nouvelle secrete      créer une clé sk_
 *   npm run cles -- revoquer pk_live_abc  révoquer par préfixe
 *
 * En attendant l'espace agence, c'est ce qui remplace l'interface — et ça
 * évite d'écrire du SQL à la main sur une base de production.
 */
import env from '../config/env.js';
import { query, closePool } from '../db/pool.js';
import { creerCle } from '../services/keys.js';

if (!env.db.configured) {
  console.error('✖  Base non configurée.');
  process.exit(1);
}

const [commande, ...args] = process.argv.slice(2);
const AGENCE = Number(process.env.AGENCE_ID || 1);

const agences = await query('SELECT id, name, plan_id, credits_balance FROM agencies WHERE id = :id', {
  id: AGENCE,
});
if (!agences.length) {
  console.error(`✖  Aucune agence d'identifiant ${AGENCE}. Lancez npm run db:seed.`);
  process.exit(1);
}
const agence = agences[0];

switch (commande) {
  case undefined:
  case 'etat':
    await afficherEtat();
    break;

  case 'domaine': {
    const [signe, domaine] = args;
    if (!domaine || !['+', '-'].includes(signe)) {
      console.error('Usage : npm run cles -- domaine + exemple.fr   (ou -)');
      process.exit(1);
    }
    const propre = normaliser(domaine);
    if (signe === '+') {
      await query('INSERT IGNORE INTO allowed_domains (agency_id, domain) VALUES (:a, :d)', {
        a: agence.id,
        d: propre,
      });
      console.log(`\n✔  « ${propre} » est maintenant autorisé pour ${agence.name}.`);
      console.log('   Le widget y acceptera la clé publique immédiatement.\n');
    } else {
      const r = await query('DELETE FROM allowed_domains WHERE agency_id = :a AND domain = :d', {
        a: agence.id,
        d: propre,
      });
      console.log(r.affectedRows ? `\n✔  « ${propre} » retiré.\n` : `\n⚠  « ${propre} » n'était pas dans la liste.\n`);
    }
    await afficherEtat();
    break;
  }

  case 'nouvelle': {
    const kind = args[0] === 'secrete' ? 'secret' : args[0] === 'publique' ? 'public' : null;
    if (!kind) {
      console.error('Usage : npm run cles -- nouvelle publique   (ou secrete)');
      process.exit(1);
    }
    const cle = await creerCle(agence.id, kind, args[1] || null);
    console.log(`\n┌─────────────────────────────────────────────────────────────`);
    console.log(`│  Clé ${kind === 'public' ? 'PUBLIQUE' : 'SECRÈTE'} créée. Affichée une seule fois.`);
    console.log(`├─────────────────────────────────────────────────────────────`);
    console.log(`│  ${cle}`);
    console.log(`└─────────────────────────────────────────────────────────────`);
    if (kind === 'secret') {
      console.log('\n⚠  Une clé secrète ne doit JAMAIS apparaître dans une page web,');
      console.log('   ni dans une capture d’écran, ni dans une conversation.\n');
    }
    break;
  }

  case 'revoquer': {
    const prefixe = args[0];
    if (!prefixe) {
      console.error('Usage : npm run cles -- revoquer pk_live_abc123');
      process.exit(1);
    }
    const r = await query(
      `UPDATE api_keys SET revoked_at = NOW()
        WHERE agency_id = :a AND revoked_at IS NULL AND key_prefix LIKE :p`,
      { a: agence.id, p: prefixe.slice(0, 16) + '%' }
    );
    console.log(`\n✔  ${r.affectedRows} clé(s) révoquée(s).\n`);
    await afficherEtat();
    break;
  }

  default:
    console.error(`Commande inconnue : ${commande}`);
    console.error('  npm run cles');
    console.error('  npm run cles -- domaine + exemple.fr');
    console.error('  npm run cles -- nouvelle publique');
    console.error('  npm run cles -- revoquer pk_live_abc');
    process.exit(1);
}

await closePool();

/* ------------------------------------------------------------------------ */

/** Un domaine se déclare sans protocole, sans chemin, sans port. */
function normaliser(brut) {
  let d = String(brut).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  return d;
}

async function afficherEtat() {
  const cles = await query(
    `SELECT kind, key_prefix, label, revoked_at, last_used_at
       FROM api_keys WHERE agency_id = :a ORDER BY kind, id`,
    { a: agence.id }
  );
  const domaines = await query('SELECT domain FROM allowed_domains WHERE agency_id = :a ORDER BY domain', {
    a: agence.id,
  });

  console.log('');
  console.log(`  AGENCE : ${agence.name}  (offre ${agence.plan_id}, ${agence.credits_balance} crédits)`);
  console.log('  ' + '─'.repeat(62));
  console.log('  CLÉS');
  for (const c of cles) {
    const etat = c.revoked_at ? 'RÉVOQUÉE' : 'active';
    const vue = c.last_used_at ? `vue le ${new Date(c.last_used_at).toLocaleString('fr-FR')}` : 'jamais utilisée';
    console.log(`    ${c.key_prefix}…  ${c.kind === 'public' ? 'publique' : 'secrète '}  ${etat.padEnd(9)} ${vue}`);
  }
  if (!cles.length) console.log('    aucune');

  console.log('');
  console.log('  DOMAINES AUTORISÉS  (pour les clés publiques)');
  for (const d of domaines) console.log(`    ${d.domain}`);
  if (!domaines.length) {
    console.log('    aucun — toute clé publique sera refusée');
  }
  console.log('');
  console.log('  Un domaine absent de cette liste fait refuser la clé publique.');
  console.log('  C’est le seul rempart : la clé, elle, est visible dans le HTML.');
  console.log('');
}
