import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import env from './src/config/env.js';
import brand from './src/config/brand.js';
import siteRoutes from './src/routes/site.js';
import apiRoutes from './src/routes/api.js';
import embedRoutes from './src/routes/embed.js';
import consoleRoutes from './src/routes/console.js';
import consoleApiRoutes from './src/routes/console-api.js';
import { session } from './src/middleware/session.js';
import compteRoutes from './src/routes/compte.js';
import paiementRoutes, { webhook as stripeWebhook } from './src/routes/paiement.js';
import { ping as dbPing, closePool } from './src/db/pool.js';
import { demarrerWorker, arreterWorker } from './src/worker.js';

const root = dirname(fileURLToPath(import.meta.url));
const app = express();

if (env.trustProxy) app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', join(root, 'src', 'views'));
app.set('x-powered-by', false);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    // Le widget doit pouvoir être chargé depuis les sites de nos clients.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());

// AVANT express.json : Stripe signe le corps brut de la requete.
// Une fois transforme en objet, le corps ne peut plus etre verifie.
app.post('/paiement/webhook', ...stripeWebhook);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use(
  express.static(join(root, 'public'), {
    maxAge: env.isProd ? '7d' : 0,
    etag: true,
  })
);

// Images générées. En production, ce chemin sera servi par un CDN / bucket.
app.use(
  '/media',
  express.static(join(root, env.storage.localPath), {
    maxAge: '30d',
    immutable: true,
    fallthrough: false,
  })
);

// Variables disponibles dans toutes les vues.
app.use((req, res, next) => {
  res.locals.brand = brand;
  res.locals.path = req.path;
  res.locals.baseUrl = env.baseUrl;
  res.locals.year = new Date().getFullYear();
  res.locals.indexable = env.indexable;
  next();
});

app.get('/sante', async (req, res) => {
  res.json({
    ok: true,
    db: env.db.configured ? await dbPing() : 'non configurée',
    gemini: env.gemini.configured ? 'clé présente' : 'non configurée',
    version: '0.1.0',
  });
});

app.use(session);
app.use('/', compteRoutes);
app.use('/paiement', paiementRoutes);
app.use('/console', consoleRoutes);
app.use('/api/console', consoleApiRoutes);
app.use('/', siteRoutes);
app.use('/api/v1', apiRoutes);
app.use('/embed', embedRoutes);

app.use((req, res) => {
  res.status(404).render('pages/404', { title: 'Page introuvable' });
});

app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(err.status || 500);
  if (req.originalUrl.startsWith('/api/')) {
    return res.json({ error: err.publicMessage || 'Erreur interne' });
  }
  // En developpement on montre la pile sur la page : chercher une erreur
  // dans des journaux bufferises fait perdre un temps considerable.
  res.render('pages/500', {
    title: 'Erreur',
    detail: env.isProd ? null : String(err.stack || err).slice(0, 2000),
  });
});

/* ---------------------------------------------------------------------
   Filet de diagnostic.

   Un serveur qui meurt sans un mot est indébogable. Node termine le
   processus sur une promesse rejetée non gérée — et le worker lance ses
   boucles sans les attendre, ce qui est exactement le profil à risque.
   Ici on force une trace complète avant toute sortie.
   --------------------------------------------------------------------- */

process.on('unhandledRejection', (raison, promesse) => {
  console.error('\n[FATAL] promesse rejetée non gérée');
  console.error(raison instanceof Error ? raison.stack : raison);
  console.error('promesse :', promesse);
  // On ne relève pas : un état inconnu vaut moins qu'un redémarrage propre.
  // Le superviseur (pm2 / systemd) relance — voir docs/DEPLOIEMENT.md.
  process.exitCode = 1;
  arretPropre('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  console.error('\n[FATAL] exception non interceptée');
  console.error(err.stack || err);
  process.exitCode = 1;
  arretPropre('uncaughtException');
});

let serveur = null;
let arretEnCours = false;

function arretPropre(cause) {
  if (arretEnCours) return;
  arretEnCours = true;
  console.error(`[arrêt] cause : ${cause}`);
  arreterWorker();
  const forcer = setTimeout(() => process.exit(process.exitCode ?? 0), 8000);
  forcer.unref();
  serveur?.close(() => {
    closePool().finally(() => process.exit(process.exitCode ?? 0));
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[arrêt] ${signal} reçu`);
    arretPropre(signal);
  });
}

if (env.workerInline) demarrerWorker();

serveur = app.listen(env.port, () => {
  console.log(`\n  ${brand.name} — ${brand.tagline}`);
  console.log(`  ▸ ${env.baseUrl}`);
  console.log(`  ▸ base de données : ${env.db.configured ? env.db.database : 'non configurée (site vitrine OK)'}`);
  console.log(`  ▸ Gemini : ${env.gemini.configured ? env.gemini.model : 'clé absente — la démo tourne en mode simulé'}\n`);
});
