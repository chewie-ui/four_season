/**
 * pm2 — superviseur de production.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup
 *
 * Deux processus separes volontairement : une generation qui plante ne doit
 * pas emporter le site vitrine, et on peut multiplier les workers sans
 * multiplier les serveurs web.
 */
module.exports = {
  apps: [
    {
      name: 'fs-web',
      script: 'server.js',
      env: { NODE_ENV: 'production', WORKER_INLINE: 'false' },
      instances: 1,
      max_memory_restart: '512M',
      autorestart: true,
      // Un redemarrage en boucle signale un probleme de configuration :
      // on ralentit pour laisser le temps de lire les logs.
      restart_delay: 3000,
      max_restarts: 10,
      error_file: 'logs/web-erreur.log',
      out_file: 'logs/web.log',
      time: true,
    },
    {
      name: 'fs-worker',
      script: 'src/worker.js',
      env: { NODE_ENV: 'production' },
      instances: 1,
      // sharp + libvips consomment de la memoire par image traitee
      max_memory_restart: '1G',
      autorestart: true,
      restart_delay: 5000,
      error_file: 'logs/worker-erreur.log',
      out_file: 'logs/worker.log',
      time: true,
    },
  ],
};
