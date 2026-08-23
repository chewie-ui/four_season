# Four Season

> La même maison. Toutes ses saisons.

Régénère automatiquement les photos d'annonces immobilières dans d'autres saisons,
d'autres météos et d'autres heures — sans jamais modifier l'architecture du bien.
L'acheteur qui dit « je repasserai voir la lumière du soir » n'a plus besoin de revenir.

---

## Démarrer en 2 minutes

```bash
npm install
cp .env.example .env
npm run dev
```

Le site tourne sur <http://localhost:3210>.
**Ni MySQL ni clé Gemini ne sont nécessaires pour démarrer** : le site vitrine
fonctionne seul, et la scène de démonstration est un SVG paramétrique.

Pour le pipeline complet (file d'attente, crédits, widget en mode visiteur) :

```bash
npm run db:migrate   # cree la base et applique les migrations
npm run db:seed      # cree une agence de test + affiche ses cles d'API
```

`db:seed` affiche une clé publique et une clé secrète **une seule fois** —
elles sont stockées hachées. Copiez-les.

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur + worker intégré (`WORKER_INLINE=true`) |
| `npm run worker` | Worker seul — c'est ainsi qu'on le lance en production |
| `npm run db:migrate` | Applique les migrations en attente |
| `npm run db:seed` | Agence de test + clés d'API |
| `npm run gemini:test` | Vérifie la clé Gemini sur une vraie génération (≈ 0,04 €) |
| `npm run gemini:models` | Liste les modèles accessibles à votre clé |
| **`npm run preflight`** | **Contrôle avant mise en ligne — sort en erreur s'il reste un bloquant** |

| Page | Ce qu'on y trouve |
|---|---|
| `/` | Page de vente, avec la visionneuse d'ambiances animée |
| `/console` | **La console agence** — téléverser, cocher, générer, télécharger |
| `/demo` | Envoi d'une vraie photo → génération par IA |
| `/integration` | Documentation du widget + exemple en situation réelle |
| `/tarifs` | Les trois offres |
| `/contact` | Formulaire (anti-robot + limite de débit) |
| `/sante` | État du serveur, de la base et de la clé API |

---

## Décisions techniques, et pourquoi

### Node.js, pas PHP

Le produit n'est pas un site : c'est **une API et un widget embarquable**.
Une génération d'image prend 15 à 40 secondes — impossible à traiter dans un
cycle HTTP classique, il faut une file d'attente et des workers.
Un hébergement mutualisé PHP ne sait pas faire tourner ça correctement.

**Conséquence pratique :** l'hébergement mutualisé Infomaniak ne suffit pas pour l'app.
Gardez-le pour le domaine et les mails, et mettez l'application sur un VPS
(Infomaniak Public Cloud, ~6 €/mois) ou sur Railway / Render / Fly.

### MySQL, pas MongoDB

Les données sont franchement relationnelles : agence → biens → photos → variantes →
crédits consommés → facture. Le jour où l'on facture à l'image, il faut des
transactions et des `SUM()` exacts. Le schéma est dans [`src/db/migrations/`](src/db/migrations/).

Le grand livre de crédits (`credit_ledger`) n'écrase jamais un solde : il ajoute
une ligne. Le solde affiché n'est qu'un cache. C'est ce qui rend la facturation auditable.

### Gemini, et pas un autre modèle

`gemini-2.5-flash-image` est un modèle **d'édition** d'image, pas de génération
à partir de rien. On lui donne la photo réelle et une consigne, et il conserve
l'architecture, le cadrage et la perspective. C'est précisément l'exigence
du produit : le client doit reconnaître **sa** maison.

Coût observé : environ **0,036 € par image**, soit **≈ 2 700 images pour 100 €**.
Il existe `gemini-3-pro-image-preview`, plus fin et ~4 fois plus cher, à réserver
à une éventuelle option « qualité brochure ».

---

## Le fichier le plus important : `src/config/scenes.js`

C'est le cœur métier. Il définit les 13 ambiances et sert **trois usages à la fois** :

1. les boutons du site et du widget,
2. les couleurs de la scène SVG de démonstration,
3. **les prompts envoyés à Gemini**.

La règle du prompt d'édition y est appliquée systématiquement : on décrit
ce qui change, puis on **verrouille explicitement** ce qui ne doit pas changer
(`PRESERVE_CLAUSE`). Sans cette clause, le modèle redessine la maison —
et le produit perd tout son intérêt.

Pour ajouter une ambiance, il suffit d'ajouter un objet dans ce fichier.
Tout le reste suit.

---

## La console agence

`/console` — l'outil de travail quotidien de l'agence, et celui que vous
utiliserez vous-même pour traiter vos premiers clients à la main.

1. Glisser une photo (ou parcourir)
2. Cocher les ambiances — trois préréglages : « Le trio vendeur », « Les 4 saisons », « Tout »
3. Ajouter une demande libre si besoin (« une nuit noire, seules les fenêtres éclairées »)
4. Générer : le coût et la durée sont annoncés **avant** de cliquer
5. Suivre en direct, comparer en plein écran (maintenir « Voir l'originale »)
6. Télécharger le ZIP, ou copier le code d'intégration déjà rempli pour ce bien

**Connexion :** avec la clé secrète `sk_`, saisie une seule fois. Elle est vérifiée
côté serveur puis remplacée par un cookie signé `HttpOnly` — la clé secrète ne
descend jamais dans le navigateur et n'apparaît dans aucun JavaScript.

C'est une authentification provisoire. Quand les comptes existeront (email +
argon2id), seul `src/middleware/session.js` changera : tout le reste lit
déjà `req.session.agencyId`.

**Parallélisme :** `WORKER_CONCURRENCY=4` traite quatre ambiances de front.
Six ambiances en série, ce serait 90 secondes d'attente ; en parallèle, c'est
le temps d'une seule. Monter ce chiffre accélère, mais consomme le quota Gemini
plus vite — 12 est le plafond.

---

## L'API

| Route | Auth | Rôle |
|---|---|---|
| `POST /api/v1/render` | `pk_` (corps) ou `sk_` (Bearer) | Demande un rendu |
| `GET /api/v1/render/:jeton` | aucune | Sonde l'avancement |
| `GET /api/v1/compte` | `sk_` | Solde de crédits |
| `GET /api/v1/scenes` | aucune | Catalogue des ambiances |
| `GET /api/v1/status` | aucune | État Gemini + dépense cumulée |
| `POST /api/v1/demo/generate` | aucune | Démo publique, bridée |

```bash
# depuis un serveur — plusieurs ambiances d'un coup
curl -X POST http://localhost:3210/api/v1/render \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"image":"https://mon-agence.fr/villa.jpg","scenes":["hiver","coucher"]}'
```

Réponses : `{status:"ready", url}` si l'image est déjà en cache (gratuit),
sinon `{status:"queued", jeton}` à sonder toutes les 2 s.

Le **jeton** est le `public_id` de la variante (nanoid), pas l'identifiant du job :
le widget sonde sans clé d'API, un compteur séquentiel serait énumérable.

### Les deux clés

| | Où | Ce qui la protège |
|---|---|---|
| `pk_` | En clair dans le HTML du client | `allowed_domains` (Origin/Referer) + limite de débit. Une seule ambiance par appel. |
| `sk_` | Serveur du client uniquement | Le secret. Refusée si transmise dans le corps d'une requête. |

## Structure

```
server.js                  point d'entrée Express
src/
  config/brand.js          nom, couleurs, polices, offres  ← renommer le produit ici
  config/scenes.js         les 13 ambiances + les prompts Gemini
  config/env.js            lecture du .env
  db/migrations/           001_initial.sql, 002_… — jamais modifiées après coup
  db/migrate.js            npm run db:migrate
  db/seed.js               npm run db:seed
  worker.js                consomme la file de génération
  middleware/auth.js       résolution des clés pk_ / sk_ + CORS widget
  middleware/session.js    session cookie signée de la console
  routes/console.js        pages de la console agence
  routes/console-api.js    téléversement, génération groupée, ZIP
  routes/site.js           pages publiques + formulaire de contact
  routes/api.js            /api/v1 — render, catalogue, démo, état
  routes/embed.js          rendu SVG des ambiances + page d'exemple
  services/gemini.js       appel du modèle d'image
  services/variants.js     cache des variantes + mise en file
  services/biens.js        biens, galerie, extrait d integration
  services/images.js       téléchargement des photos + garde-fou SSRF
  services/keys.js         clés d'API, filtrage par domaine
  services/credits.js      grand livre des crédits
  services/budget.js       garde-fou de dépense  ← protège les 100 €
  services/watermark.js    filigrane « vue simulée »
  services/storage.js      stockage des images (local, S3 plus tard)
  services/leads.js        enregistrement des prospects
  views/                   templates EJS
public/
  fourseason.js                LE WIDGET embarquable (Shadow DOM, zéro dépendance)
  css/scene.css            la scène paramétrique
  css/site.css             le design system
  js/site.js               visionneuse, apparitions, onglets
  js/console.js            console agence
  css/console.css          styles de la console
  img/logo.svg             le signe
```

---

## Activer la génération par IA

1. Créer une clé sur <https://aistudio.google.com/apikey>
   (« Create API key » → choisir un projet Google Cloud → copier la clé `AIza…`).
   Le palier gratuit ne couvre pas toujours les modèles d'image : si l'appel
   échoue en quota, il faut activer la facturation sur le projet.
2. La coller dans `.env` : `GEMINI_API_KEY=AIza…`
3. Vérifier en un appel (≈ 0,04 €) :

```bash
npm run gemini:test
```

Le script distingue clairement clé refusée / quota / modèle inexistant /
refus du modèle, et écrit le rendu dans `storage/`. Avec sa propre photo :

```bash
npm run gemini:test -- ma-photo.jpg coucher
```

4. Puis `/demo` dans le navigateur pour la boucle complète.

**Le garde-fou est actif dès le premier appel.** `BUDGET_HARD_LIMIT_EUR=90`
coupe les générations une fois ce montant cumulé atteint. La démo publique est
en plus limitée à 6 essais par heure et par IP. Un budget de test se brûle
en quelques minutes sans ces deux verrous.

Vérifier la dépense à tout moment :

```bash
curl http://localhost:3210/api/v1/status
```

> ⚠️ Le nom exact du modèle et la forme de la réponse du SDK `@google/genai`
> évoluent. Si le premier appel échoue, comparer `src/services/gemini.js`
> avec <https://ai.google.dev/gemini-api/docs/image-generation>.

---

## Brancher MySQL

```bash
# renseigner DB_USER / DB_PASSWORD / DB_NAME dans .env
npm run db:migrate
```

Tant que la base est absente ou injoignable, les prospects sont écrits dans
`storage/leads.jsonl` et le compteur de dépense dans `storage/spend.json` :
**aucune donnée n'est perdue**, il suffira de les réinjecter.

---

### Règle des migrations

Une migration appliquée n'est **jamais** modifiée. Pour corriger, on ajoute
`003_….sql`. `migrate.js` vérifie l'empreinte de chaque fichier déjà joué et
prévient s'il a changé — sinon vos trois bases divergeraient en silence,
et celle de production avec.

---

## Ce qui reste à faire

Voir [`docs/ROADMAP.md`](docs/ROADMAP.md). Les chantiers restants :

1. **Les comptes clients** — inscription, connexion, espace agence.
   Les tables et les clés d'API existent ; l'interface et l'authentification
   par mot de passe restent à écrire.
2. **Le paiement** — Stripe Billing, à ne brancher qu'après une première
   facture encaissée à la main.
3. **Les connecteurs métier** — Apimo, Hektor, Netty.

Avant toute mise en ligne :

- compléter `/mentions-legales` et `/confidentialite` (champs entre crochets) ;
- **retirer `ALLOW_PRIVATE_IMAGE_HOSTS` du `.env` de production** — c'est un
  contournement délibéré du garde-fou SSRF, réservé au développement local.
# four_season
