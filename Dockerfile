# syntax=docker/dockerfile:1

# ---- dependances -----------------------------------------------------------
FROM node:24-slim AS deps
WORKDIR /app
COPY package*.json ./
# sharp embarque des binaires natifs : ils doivent etre compiles pour
# la plateforme de l'image, pas pour le poste du developpeur.
RUN npm ci --omit=dev

# ---- image finale ----------------------------------------------------------
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app

# tini : sans lui, le PID 1 ignore SIGTERM et l'arret propre ne se declenche pas
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

# le stockage doit etre un volume : sinon les images generees disparaissent
# au redeploiement, et il faut les repayer
RUN mkdir -p /app/storage && chown -R node:node /app/storage
VOLUME ["/app/storage"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
