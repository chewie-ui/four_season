# « User location is not supported » — Google refuse l'IP du serveur

## Le symptôme

Dans la console, sur `/demo`, ou dans `pm2 logs fs-worker` :

```json
{"error":{"code":400,"message":"User location is not supported for the API use.","status":"FAILED_PRECONDITION"}}
```

Et dans `npm run preflight` :

```
[ STOP ] clé Gemini acceptée
          HTTP 400
```

## Ce n'est pas la clé

C'est **l'adresse IP du serveur**. L'API Gemini grand public (celle des clés
`AIza…`, créées dans AI Studio) est restreinte géographiquement : Google refuse
certaines plages d'IP de datacenter, alors que la même clé fonctionne
parfaitement depuis un poste de travail.

C'est pour cette raison que tout marchait en développement et plus rien en
production, sans avoir touché à la clé.

### Vérifier

```bash
curl -s https://ipinfo.io/json
```

Si le pays affiché n'est pas celui attendu, ou si l'IP est cataloguée comme
hébergement, c'est l'explication.

---

## La solution : Vertex AI

Mêmes modèles, mêmes prompts, mêmes tarifs. Endpoints régionaux explicites et
**aucune restriction sur l'IP appelante**. C'est la voie prévue par Google pour
la production ; l'API grand public vise le prototypage.

Côté code, un seul fichier est concerné (`src/services/gemini.js`) et il gère
déjà les deux routes. Il n'y a que de la configuration à faire.

### 1. Côté Google Cloud

Sur le projet **déjà associé à votre clé** (celui où la facturation est active) :

1. Activer l'API **Vertex AI**
2. Créer un **compte de service** avec le rôle **Utilisateur Vertex AI**
   (`roles/aiplatform.user`)
3. Lui générer une **clé JSON** et la télécharger

### 2. Déposer la clé sur le serveur

Hors du dépôt git, et lisible par le seul utilisateur applicatif :

```bash
sudo mkdir -p /etc/four-season
sudo mv ~/cle-service.json /etc/four-season/vertex.json
sudo chown ubuntu:ubuntu /etc/four-season/vertex.json
chmod 600 /etc/four-season/vertex.json
```

### 3. Basculer le `.env`

```bash
GEMINI_BACKEND=vertex
GOOGLE_CLOUD_PROJECT=votre-id-de-projet
GOOGLE_CLOUD_LOCATION=global
GOOGLE_APPLICATION_CREDENTIALS=/etc/four-season/vertex.json
```

`GEMINI_API_KEY` peut rester : elle est simplement ignorée en mode `vertex`.

### 4. Redémarrer et tester

```bash
pm2 restart fs-web fs-worker --update-env
npm run gemini:test
```

Le `--update-env` est indispensable : sans lui, pm2 relance les processus avec
l'ancien environnement et vous chercherez longtemps pourquoi rien ne change.

---

## Points de vigilance

**La facturation doit être active** sur le projet, exactement comme pour l'API
grand public. Vertex AI ne contourne pas cette exigence.

**Le modèle doit exister dans la région choisie.** `global` couvre le plus
large ; une région européenne précise (`europe-west1`, `europe-west4`) peut ne
pas servir tous les modèles d'image. En cas de `NOT_FOUND`, essayer `global`
d'abord.

**Les noms de modèles peuvent différer légèrement** entre l'API grand public et
Vertex AI. Si `gemini-2.5-flash-image` n'est pas trouvé, consulter la liste des
modèles Vertex de votre projet dans la console Google Cloud.

**RGPD :** choisir une région européenne plutôt que `global` renforce l'argument
de conformité vis-à-vis des agences clientes — les photos de leurs biens ne
quittent alors pas l'Europe. À arbitrer contre la disponibilité des modèles.

---

## Solution de repli

Déplacer l'application vers un datacenter dont l'IP est acceptée. C'est plus
lourd et moins fiable : la liste des zones desservies change sans préavis,
alors que Vertex AI est un engagement contractuel. À ne considérer que si
Vertex AI s'avère impossible.
