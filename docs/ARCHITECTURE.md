# Architecture

## Vue d'ensemble

```
   Site de l'agence cliente                    Four Seasons
  ┌────────────────────────┐        ┌─────────────────────────────┐
  │ <img data-fourseason>      │        │  Express (server.js)        │
  │ + fourseason.js            │──POST──▶  /api/v1/render             │
  │   (Shadow DOM)         │        │        │                    │
  └────────────────────────┘        │        ▼                    │
             ▲                      │  variante en cache ? ───oui─┼──▶ URL
             │                      │        │ non               │
             │                      │        ▼                    │
             │                      │  generation_jobs (MySQL)    │
             │                      │        │                    │
             │                      │        ▼                    │
             │                      │  worker ──▶ Gemini          │
             │                      │        │                    │
             └──────sondage─────────┼────────▼                    │
                                    │  storage + débit crédit     │
                                    └─────────────────────────────┘
```

## Les trois surfaces

| Surface | Fichier | Rôle |
|---|---|---|
| Site de vente | `src/views/pages/` | Convertir un visiteur en prospect |
| Widget | `public/fourseason.js` | Vivre chez le client, en Shadow DOM |
| API | `src/routes/api.js` | Servir le widget et les serveurs clients |

## Pourquoi le widget est en Shadow DOM

Le widget est destiné à tourner sur des sites d'agences que nous ne contrôlons pas :
thèmes WordPress anciens, CSS globaux agressifs, frameworks divers. Sans isolation,
un `button { width: 100% }` dans le thème du client casserait notre interface.

Le Shadow DOM garantit les deux sens : leur CSS ne nous atteint pas, le nôtre
ne les atteint pas. Le widget est aussi écrit en ES5, sans dépendance et sans
étape de compilation — un seul fichier à servir, cacheable indéfiniment.

## Le cache est le modèle économique

Contrainte en base :

```sql
UNIQUE KEY uq_variant_scene (source_image_id, scene_id, prompt_hash)
```

Conséquences directes :

- Deux visiteurs qui demandent « hiver » sur la même photo → **une seule génération payée**.
- Une annonce vue 10 000 fois coûte le même prix qu'une annonce vue 3 fois.
- `prompt_hash` permet d'améliorer un prompt sans écraser l'historique :
  un nouveau prompt crée une nouvelle variante, l'ancienne reste servable.

`source_images` porte de son côté un `UNIQUE (agency_id, checksum)` : une agence
qui téléverse deux fois la même photo ne crée pas deux lignes.

## Pourquoi une file d'attente

Une génération prend 15 à 40 secondes. La garder dans le cycle HTTP signifierait :
timeouts de proxy, connexions bloquées, et un plantage du serveur qui perd le travail
déjà payé à Google.

`generation_jobs` porte `locked_by` / `locked_at` : plusieurs workers peuvent tourner
en parallèle sans se marcher dessus, et un worker mort libère ses jobs par expiration
du verrou. `priority` distingue le visiteur qui attend (1) du pré-calcul nocturne (9).

*Exception assumée :* `/api/v1/demo/generate` est synchrone. C'est une page de
démonstration avec un compteur visible, l'attente y est acceptable et le code
reste simple.

## Les crédits, en grand livre

`credit_ledger` n'est jamais mis à jour, seulement complété :

```
+15   signup
-1    generation   (variant_id = 4821)
+400  subscription
```

`agencies.credits_balance` n'est qu'un cache de `SUM(delta)`. En cas de doute,
le solde se recalcule. Un solde qu'on écrase directement est un solde
qu'on ne peut plus auditer — et la facturation à l'usage impose de pouvoir
justifier chaque débit.

## Sécurité des clés

| Type | Préfixe | Où | Protection |
|---|---|---|---|
| Publique | `pk_` | En clair dans la page du client | `allowed_domains` (Origin / Referer) |
| Secrète | `sk_` | Serveur du client uniquement | Hachée en base (sha256), jamais réaffichée |

Une clé publique **est** visible : c'est sa nature. Ce qui la protège, c'est le
filtre par domaine plus la limite de débit, jamais le secret.

## Dégradation

Le principe appliqué partout : **une panne ne doit jamais faire pire que ne rien faire.**

| Panne | Comportement |
|---|---|
| MySQL absent | Site vitrine complet ; prospects écrits dans `storage/leads.jsonl` |
| Clé Gemini absente | Site complet ; `/demo` répond 503 avec un message explicite |
| API injoignable | Le widget laisse la photo d'origine affichée, intacte |
| Budget dépassé | Génération refusée, message clair, site intact |

## Ce qui n'est volontairement pas fait

- **Pas de framework front.** Le site est du rendu serveur EJS et 150 lignes de JS.
  Un SPA pour sept pages statiques serait du poids sans bénéfice.
- **Pas de TypeScript.** À trois, dont un seul développeur, l'étape de compilation
  coûte plus qu'elle ne rapporte à ce stade. Le jour où l'API grossit, la migration
  se fera fichier par fichier.
- **Pas d'ORM.** `mysql2` avec des requêtes nommées suffit et reste lisible.
  Le schéma SQL est la référence, pas un fichier de modèles.
