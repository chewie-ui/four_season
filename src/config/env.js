import 'dotenv/config';

const bool = (v, d = false) => (v == null ? d : /^(1|true|yes|on)$/i.test(String(v)));
const int = (v, d) => (v == null || v === '' ? d : Number.parseInt(v, 10));

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: int(process.env.PORT, 3000),
  baseUrl: process.env.BASE_URL || `http://localhost:${int(process.env.PORT, 3000)}`,

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || '',
    // Le site vitrine tourne sans base : pratique pour démarrer et pour la démo.
    get configured() {
      return Boolean(this.user && this.database);
    },
  },

  gemini: {
    // 'api'    → API Gemini grand public, clé AIza… Simple, mais restreinte
    //            géographiquement : une IP de datacenter peut être refusée
    //            (« User location is not supported »).
    // 'vertex' → Vertex AI. Mêmes modèles, endpoints régionaux, aucune
    //            restriction sur l'IP appelante. La route de production.
    backend: (process.env.GEMINI_BACKEND || 'api').toLowerCase(),
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
    project: process.env.GOOGLE_CLOUD_PROJECT || '',
    location: process.env.GOOGLE_CLOUD_LOCATION || 'global',
    get configured() {
      return Boolean(this.apiKey);
    },
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },

  // Envoi des emails (verification d'adresse, mot de passe oublie).
  // Sans SMTP configure, les liens sont ecrits dans les journaux du serveur :
  // le service reste utilisable en interne sans dependre d'un fournisseur.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || '',
    get configured() { return Boolean(this.host && this.user); },
  },

  storage: {
    driver: process.env.STORAGE_DRIVER || 'local',
    localPath: process.env.STORAGE_LOCAL_PATH || './storage',
  },

  // Tant que les mentions legales ne sont pas remplies, le site ne doit pas
  // etre indexe : une page incomplete referencee par Google est difficile
  // a faire disparaitre ensuite.
  indexable: bool(process.env.SITE_INDEXABLE, false),

  workerInline: bool(process.env.WORKER_INLINE, false),
  workerConcurrence: int(process.env.WORKER_CONCURRENCY, 4),

  // DÉVELOPPEMENT UNIQUEMENT. Autorise le téléchargement d'images depuis des
  // adresses privées (localhost, 192.168.x.x). En production ce serait une
  // faille SSRF : n'importe quel client pourrait nous faire interroger le
  // réseau interne ou les métadonnées de l'hébergeur.
  autoriserHotesPrives: bool(process.env.ALLOW_PRIVATE_IMAGE_HOSTS, false) && process.env.NODE_ENV !== 'production',

  sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  budgetHardLimitEur: Number(process.env.BUDGET_HARD_LIMIT_EUR || 90),
  trustProxy: bool(process.env.TRUST_PROXY, false),
};

export default env;
