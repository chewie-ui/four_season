# Mise en ligne

À lire en entier avant le premier déploiement. Les points marqués **BLOQUANT**
ne sont pas des recommandations : les ignorer expose le service ou la société.

---

## 0. La commande qui vérifie tout

```bash
npm run preflight
```

Elle contrôle mécaniquement l'ensemble des points de ce document : secrets,
garde-fou SSRF, `BASE_URL`, migrations, clé Gemini et existence réelle du modèle,
droits d'écriture sur le stockage, et champs entre crochets restants dans les
pages légales. **Elle sort en code 1 s'il reste un bloquant** — branchez-la dans
votre script de déploiement pour qu'une erreur empêche la mise en ligne.

À lancer sur le serveur, avec le `.env` de production chargé.

---

## Installer MySQL sur le VPS

Les bases MySQL des offres mutualisées (Infomaniak et la plupart des autres)
n'acceptent que les connexions venant de leur propre infrastructure. Depuis un
VPS extérieur, ça ne passe pas — et c'est une bonne chose : faire traverser
Internet à chaque requête SQL ajouterait 20 à 50 ms par requête, soit plusieurs
centaines de millisecondes par page.

**La base va donc sur le VPS, à côté de l'application.**

### ⚠️ MySQL 8, pas MariaDB

Sur Debian, `apt install mysql-server` installe **MariaDB**. Or le schéma utilise
la collation `utf8mb4_0900_ai_ci`, qui n'existe que sur MySQL 8 : la migration
échouerait. `npm run preflight` refuse désormais de valider une base MariaDB.

```bash
# Ubuntu 22.04 / 24.04 — MySQL 8 est dans les dépôts
sudo apt update && sudo apt install -y mysql-server

# Debian 12 — il faut le dépôt officiel Oracle
curl -fsSLO https://dev.mysql.com/get/mysql-apt-config_0.8.33-1_all.deb
sudo dpkg -i mysql-apt-config_0.8.33-1_all.deb   # choisir « MySQL 8.4 LTS »
sudo apt update && sudo apt install -y mysql-server

# vérifier — doit afficher 8.x et NE PAS mentionner MariaDB
mysql --version
```

### Sécuriser et créer la base

```bash
sudo mysql_secure_installation      # mot de passe root, retirer les accès anonymes

sudo mysql <<'SQL'
CREATE DATABASE fourseason CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'fourseason'@'localhost' IDENTIFIED BY 'LE_MOT_DE_PASSE_DU_ENV';
GRANT ALL PRIVILEGES ON fourseason.* TO 'fourseason'@'localhost';
FLUSH PRIVILEGES;
SQL
```

Le mot de passe est celui déjà généré dans `.env.production.example`
(champ `DB_PASSWORD`).

### Ne jamais exposer la base

```bash
# doit valoir 127.0.0.1 — MySQL n'écoute alors que sur la machine
grep -r "^bind-address" /etc/mysql/
```

Si ce n'est pas le cas, l'ajouter dans `/etc/mysql/mysql.conf.d/mysqld.cnf` :

```ini
[mysqld]
bind-address = 127.0.0.1
```

Puis, au niveau du pare-feu OVH :

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable            # le port 3306 reste fermé : c'est voulu
```

### Ce que vous récupérez comme responsabilité

Une base hébergée chez Infomaniak est sauvegardée par eux. Une base sur votre
VPS, **c'est vous**. C'est le seul vrai inconvénient du choix, et il se règle
en une ligne de cron :

```bash
sudo cp deploy/sauvegarde.sh /usr/local/bin/fs-sauvegarde
sudo chmod +x /usr/local/bin/fs-sauvegarde
sudo crontab -e
# tous les jours à 3 h 15
15 3 * * * /usr/local/bin/fs-sauvegarde >> /var/log/fs-sauvegarde.log 2>&1
```

Et **testez la restauration une fois** : une sauvegarde jamais restaurée n'est
pas une sauvegarde.

### Et le mutualisé Infomaniak, alors ?

Il reste utile, et il n'y a aucune raison de le résilier :

- le **nom de domaine** et les DNS (faire pointer un `A` vers l'IP du VPS) ;
- les **boîtes mail** `contact@…` ;
- éventuellement Swiss Backup comme destination de sauvegarde hors-site.

---

## Deux chemins possibles

### A. VPS + pm2 — le plus simple

```bash
git clone <votre-dépôt> /srv/fourseason && cd /srv/fourseason
npm ci --omit=dev
cp .env.production.example .env && nano .env    # remplir GEMINI_API_KEY, BASE_URL…
npm run db:migrate
npm run db:seed                                  # note bien les deux clés affichées
npm run preflight                                # doit être vert
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

Puis nginx en façade : [`deploy/nginx.conf`](../deploy/nginx.conf), et
`certbot --nginx -d votre-domaine`.

### B. Docker Compose — si vous préférez tout isolé

```bash
cp .env.production.example .env && nano .env
docker compose up -d --build
docker compose exec web npm run db:migrate
docker compose exec web npm run db:seed
docker compose exec web npm run preflight
```

Le reverse proxy reste devant, hors du compose : c'est lui qui porte HTTPS.

> ⚠️ Le `Dockerfile` et le `docker-compose.yml` **n'ont pas pu être testés**
> (Docker n'est pas installé sur le poste de développement). Ils sont écrits
> avec soin mais attendez-vous à un ou deux ajustements au premier `build`.
> Le chemin A, lui, correspond à ce qui a été vérifié.

---

## 1. Les bloquants

### BLOQUANT — retirer `ALLOW_PRIVATE_IMAGE_HOSTS`

```bash
# dans le .env de production : cette ligne ne doit PAS exister
ALLOW_PRIVATE_IMAGE_HOSTS=true
```

Ce drapeau désactive le garde-fou SSRF. Il n'existe que pour le développement
local, où le « site client » est `localhost`. En production, il permettrait à
n'importe quel client de nous faire interroger `169.254.169.254` (les
métadonnées de l'hébergeur, donc ses identifiants), une base interne, ou tout
le réseau privé.

Le code refuse déjà le drapeau si `NODE_ENV=production`, mais ne comptez pas
sur cette seule ceinture : supprimez la ligne.

### BLOQUANT — un vrai `SESSION_SECRET`

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

La valeur par défaut est publique (elle est dans le dépôt). Avec elle, n'importe
qui peut forger un cookie de session et entrer dans la console de n'importe
quelle agence. Ce secret sert aussi à hacher les IP des prospects : le changer
plus tard invalide les sessions en cours, ce qui est sans gravité.

### BLOQUANT — compléter les mentions légales

`/mentions-legales` et `/confidentialite` contiennent des champs entre crochets.
Une mention légale incomplète est une infraction à l'article 6-III de la LCEN.
Il faut au minimum : forme juridique, adresse du siège, SIREN, directeur de la
publication, et **l'identité + l'adresse de l'hébergeur**.

Point RGPD à ne pas oublier : les photos partent chez Google, hors UE. Cela doit
figurer noir sur blanc dans les CGU de vos agences clientes, pas seulement dans
les vôtres.

### BLOQUANT — la marque

Vérifier la disponibilité du nom auprès de l'INPI **avant** de déposer le
domaine, d'imprimer quoi que ce soit et de signer un client. Une marque proche
d'une marque existante dans le même secteur se conteste, et le nom vit dans un
seul fichier (`src/config/brand.js`) : en changer coûte trente secondes
aujourd'hui, très cher après.

---

## 2. Ce qu'il faut sur le serveur

L'hébergement mutualisé Infomaniak **ne suffit pas** : il faut un processus
Node qui tourne en continu. Un VPS à ~6 €/mois convient largement pour démarrer.

```bash
# .env de production — le minimum
NODE_ENV=production
PORT=3000
BASE_URL=https://fourseason.fr        # sert à construire les URL d'images
TRUST_PROXY=true                       # si derrière nginx / Caddy

DB_HOST=127.0.0.1
DB_USER=fourseason
DB_PASSWORD=<mot de passe long>
DB_NAME=fourseason

GEMINI_API_KEY=<la clé>
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image

SESSION_SECRET=<48 octets aléatoires>
BUDGET_HARD_LIMIT_EUR=90               # à relever quand le budget augmente

WORKER_INLINE=false                    # le worker tourne à part, voir plus bas
WORKER_CONCURRENCY=4
```

`BASE_URL` est le réglage le plus facile à oublier : c'est lui qui compose les
URL d'images renvoyées aux sites clients. S'il reste sur `localhost`, les
agences afficheront des images cassées sans qu'aucune erreur n'apparaisse.

### Séparer le worker du serveur web

```bash
npm run start     # le serveur HTTP
npm run worker    # le worker, dans un second processus
```

Une génération qui plante ne doit pas emporter le site vitrine. C'est aussi
ce qui permet de multiplier les workers sans multiplier les serveurs web.

### Un superviseur, obligatoirement

Le processus **doit** être relancé automatiquement s'il meurt. Nous avons
observé une sortie inexpliquée (code 4) que nous n'avons pas su reproduire ;
sans superviseur, une occurrence de ce genre est une panne jusqu'à la prochaine
connexion humaine.

```bash
npm install -g pm2
pm2 start server.js       --name fs-web
pm2 start src/worker.js   --name fs-worker
pm2 save && pm2 startup
```

`pm2 logs fs-web` donnera la trace complète : les gestionnaires
`unhandledRejection` et `uncaughtException` du serveur écrivent la pile
avant de rendre la main.

---

## 3. Le stockage des images

En local, tout va dans `./storage`. C'est acceptable pour démarrer, à deux
conditions :

- ce dossier doit être sur un volume **persistant** (pas le disque éphémère
  d'un conteneur, sinon toutes les images générées disparaissent au
  redéploiement — et il faudra les repayer) ;
- il doit être **sauvegardé**.

Dès que le volume grossit, basculer sur un stockage objet (Infomaniak Swiss
Backup, S3). Un seul fichier à changer : `src/services/storage.js`.

Servir `/media` par nginx plutôt que par Node dès qu'il y a du trafic.

---

## 4. Vérifications après mise en ligne

```bash
curl https://fourseason.fr/sante
curl https://fourseason.fr/api/v1/status
```

Puis, à la main :

- [ ] HTTPS actif, redirection HTTP → HTTPS
- [ ] la console `/console` est accessible et la connexion fonctionne
- [ ] une génération complète aboutit et l'image s'affiche via son URL publique
- [ ] les URL renvoyées commencent par `https://fourseason.fr`, pas `localhost`
- [ ] le ZIP se télécharge
- [ ] `/robots.txt` interdit bien `/api/` et `/embed/`
- [ ] la page d'un bien génère un code d'intégration avec les bonnes URL
- [ ] tester le widget depuis un **autre** domaine que le nôtre, après avoir
      déclaré ce domaine dans `allowed_domains` — c'est le seul test qui valide
      vraiment le filtrage par origine

---

## 5. À surveiller ensuite

| Quoi | Où | Pourquoi |
|---|---|---|
| Dépense Gemini | `/api/v1/status` | Le poste de coût. Le plafond coupe, mais mieux vaut le voir venir. |
| Jobs en échec | `SELECT * FROM generation_jobs WHERE status='failed'` | Un pic signale un problème de modèle ou de quota. |
| Taille de `storage/` | `du -sh storage` | Croît sans limite ; prévoir la purge à 30 jours annoncée dans la politique de confidentialité. |
| Solde de crédits par agence | `agencies.credits_balance` | Un solde négatif signalerait un bug de facturation. |

Le nettoyage des images de plus de 30 jours est **annoncé aux clients mais pas
encore implémenté**. C'est une promesse à tenir : à écrire avant le premier
client payant.

---

## Gemini refuse l'IP du serveur

Si la génération échoue avec « User location is not supported for the API use »,
ce n'est pas la clé mais l'adresse IP du serveur. La procédure complète de
bascule vers Vertex AI est dans [GEMINI-IP-REFUSEE.md](GEMINI-IP-REFUSEE.md).
