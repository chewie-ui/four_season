/**
 * Contrôle de la configuration Stripe.
 *
 *   npm run stripe:check
 *
 * Vérifie tout ce qui peut faire échouer un paiement AVANT qu'un client
 * ne se retrouve devant une page cassée : la clé, le compte, la capacité
 * réelle à encaisser, le webhook et ses évènements.
 *
 * N'affiche jamais de secret, seulement des préfixes.
 */
import env from '../config/env.js';
import brand from '../config/brand.js';

const lignes = [];
const ok = (t, d = '') => lignes.push({ etat: 'ok', t, d });
const stop = (t, d = '') => lignes.push({ etat: 'STOP', t, d });
const info = (t, d = '') => lignes.push({ etat: '??', t, d });

if (!env.stripe.secretKey) {
  stop('STRIPE_SECRET_KEY présente', 'absente du .env — le paiement s’annonce inactif sur le site');
} else {
  const k = env.stripe.secretKey;
  const mode = k.startsWith('sk_live_') ? 'live' : k.startsWith('sk_test_') ? 'test' : 'inconnu';
  ok('STRIPE_SECRET_KEY présente', `${k.slice(0, 12)}… — mode ${mode}`);

  if (mode === 'test') {
    info(
      'mode de la clé',
      'clé de TEST : aucun argent réel n’est encaissé. Utilisez les cartes de test ' +
        'de Stripe (4242 4242 4242 4242). Passez en clé live quand la société est vérifiée.'
    );
  } else if (mode === 'inconnu') {
    stop('format de la clé', 'une clé secrète Stripe commence par sk_test_ ou sk_live_');
  }

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(k, { apiVersion: '2025-10-29.clover' });

    const compte = await stripe.accounts.retrieve();
    ok('clé acceptée par Stripe', `compte ${compte.id}${compte.country ? ', ' + compte.country : ''}`);

    // charges_enabled est le seul indicateur qui compte : un compte créé mais
    // non vérifié accepte la clé et refuse les paiements.
    if (compte.charges_enabled) {
      ok('le compte peut encaisser', '');
    } else {
      stop(
        'le compte peut encaisser',
        'charges_enabled = false. Stripe demande encore des informations : ' +
          'identité, société, coordonnées bancaires. Tableau de bord → « Activer le compte ».'
      );
    }

    if (compte.payouts_enabled) ok('les virements vers votre banque sont actifs', '');
    else info('virements vers votre banque', 'pas encore actifs — sans incidence sur l’encaissement');

    // ---- webhook ----
    if (!env.stripe.webhookSecret) {
      stop(
        'STRIPE_WEBHOOK_SECRET présent',
        'absent — sans lui les paiements ne créditent PERSONNE : le client paie et ne reçoit rien'
      );
    } else {
      ok('STRIPE_WEBHOOK_SECRET présent', `${env.stripe.webhookSecret.slice(0, 8)}…`);
    }

    const attendus = [
      'checkout.session.completed',
      'invoice.paid',
      'invoice.payment_failed',
      'customer.subscription.deleted',
    ];
    const cible = `${env.baseUrl.replace(/\/+$/, '')}/paiement/webhook`;

    const { data: points } = await stripe.webhookEndpoints.list({ limit: 50 });
    const notre = points.find((p) => p.url === cible);

    if (!notre) {
      stop(
        'webhook déclaré chez Stripe',
        `aucun point d’entrée sur ${cible}` +
          (points.length ? ` (${points.length} autre(s) déclaré(s))` : '')
      );
    } else {
      ok('webhook déclaré chez Stripe', `${cible} — ${notre.status}`);
      const manquants = attendus.filter(
        (e) => !notre.enabled_events.includes(e) && !notre.enabled_events.includes('*')
      );
      if (manquants.length) {
        stop('évènements du webhook', `manquants : ${manquants.join(', ')}`);
      } else {
        ok('évènements du webhook', `${attendus.length} évènements écoutés`);
      }
      if (notre.status !== 'enabled') stop('webhook actif', `statut : ${notre.status}`);
    }
  } catch (err) {
    stop('clé acceptée par Stripe', String(err.message).slice(0, 160));
  }
}

// ---- offres ----
const payantes = brand.plans.filter((p) => typeof p.price === 'number' && p.price > 0);
if (payantes.length) {
  ok(
    'offres souscriptibles en ligne',
    payantes.map((p) => `${p.name} ${p.price} €/mois → ${p.credits} crédits`).join(', ')
  );
} else {
  stop('offres souscriptibles en ligne', 'aucune offre payante dans src/config/brand.js');
}

if (!/^https:/.test(env.baseUrl)) {
  stop('BASE_URL en HTTPS', `${env.baseUrl} — Stripe refuse les redirections non sécurisées`);
} else {
  ok('BASE_URL en HTTPS', env.baseUrl);
}

/* ------------------------------------------------------------- rapport --- */

const large = Math.max(...lignes.map((l) => l.t.length)) + 2;
let bloquants = 0;

console.log('');
console.log('  CONFIGURATION DU PAIEMENT');
console.log('  ' + '─'.repeat(large + 12));
for (const l of lignes) {
  if (l.etat === 'STOP') bloquants++;
  console.log(`  [ ${l.etat.padEnd(4)} ] ${l.t.padEnd(large)}`);
  if (l.d) console.log(`            ${l.d}`);
}
console.log('  ' + '─'.repeat(large + 12));

if (bloquants) {
  console.log(`\n  ✖  ${bloquants} point(s) bloquant(s). Le paiement ne fonctionnera pas.\n`);
  process.exitCode = 1;
} else {
  console.log('\n  ✔  Le paiement est opérationnel.\n');
}
