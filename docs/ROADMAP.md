# Feuille de route

Trois personnes, un seul développeur. La contrainte réelle n'est pas la technique,
c'est le temps de développement. L'ordre ci-dessous privilégie donc systématiquement
**ce qui permet de vendre** sur ce qui est confortable à coder.

---

## Étape 1 — Le site et les fondations ✅ *fait*

- Marque, logo, palette, direction artistique
- Site de vente complet en français (7 pages)
- Catalogue de 13 ambiances + prompts d'édition verrouillés
- Schéma MySQL complet
- Widget embarquable fonctionnel (mode pré-calculé)
- Garde-fou de dépense
- Formulaire de contact avec repli sur fichier

## Étape 1 bis — Le pipeline de génération ✅ *fait*

- `POST /api/v1/render` + sondage par jeton non énumérable
- File d'attente (`FOR UPDATE SKIP LOCKED`), worker, repli exponentiel,
  reprise des verrous laissés par un worker mort
- Cache des variantes : une ambiance n'est jamais payée deux fois
- Clés `pk_` / `sk_`, filtrage par domaine, limite de débit par agence
- Garde-fou SSRF sur le téléchargement des photos
- Grand livre de crédits : débit uniquement à la réussite
- Migrations numérotées avec contrôle d'empreinte

---

## Étape 2 — La génération réelle *(la prochaine)*

**Objectif : voir sa propre maison en hiver, pour de vrai.**

1. Coller `GEMINI_API_KEY` dans `.env`.
2. Tester `/demo` sur **5 photos très différentes** : pavillon, immeuble,
   maison de ville, mas provençal, chalet.
3. Pour chacune, générer `hiver`, `coucher`, `heure-bleue`, `pluie`.
4. **Noter honnêtement les échecs.** Ce qui casse en général :
   - la neige qui ne suit pas la pente du toit,
   - les fenêtres qui changent de nombre ou de position,
   - le cadrage qui se recentre légèrement,
   - les voitures et les personnes qui apparaissent ou disparaissent.
5. Corriger **dans `src/config/scenes.js` uniquement** — c'est là que vivent
   les prompts. Ne pas éparpiller la logique.

**Budget de cette étape : 20 € maximum.** Cela représente déjà ~550 images,
soit largement de quoi caler les 13 prompts.

**Critère de sortie :** sur 20 rendus, au moins 17 sont montrables à un client
sans commentaire gêné. En dessous, le produit n'est pas vendable — il faut
retravailler les prompts avant d'écrire une ligne de code supplémentaire.

---

## Étape 3 — Le premier client réel

Volontairement avant la plateforme. Le but est de valider que **quelqu'un paie**.

- Prendre l'agent immobilier qui est à l'origine de l'idée.
- Traiter ses annonces **à la main** : `/demo`, téléchargement, envoi par mail.
- Lui faire poser les images sur son site avec `data-variantes` — le widget
  fonctionne déjà dans ce mode, sans compte ni clé API.
- Mesurer : est-ce que les visiteurs cliquent ? Est-ce que ça change quelque chose
  au nombre de visites physiques demandées ?

C'est fastidieux, et c'est exactement le but : on n'automatise que ce qu'on a
déjà fait à la main au moins dix fois.

---

## Étape 4 — La plateforme

Dans cet ordre, chaque brique étant utile seule :

1. ~~**File d'attente et worker.**~~ ✅ fait — `src/worker.js`
2. ~~**`POST /api/v1/render`.**~~ ✅ fait — `src/routes/api.js`
3. **Comptes et clés API.** — à moitié fait.
   Les clés `pk_` / `sk_` existent et fonctionnent (`npm run db:seed` en crée).
   Restent l'inscription, la connexion par mot de passe (argon2id) et la
   gestion des domaines autorisés depuis une interface.
4. **Espace agence.**
   Liste des biens, ambiances générées, crédits restants, relance d'un rendu raté.
5. **Paiement.**
   Stripe Billing. À ne brancher qu'une fois qu'un client a payé au moins
   une facture manuelle.

---

## Étape 5 — La distribution

C'est là que le produit devient une entreprise plutôt qu'un outil.

- **Connecteurs métier** : Apimo, Hektor, Netty concentrent l'essentiel des
  agences françaises. Un connecteur = des dizaines d'agences d'un coup.
- **Extension WordPress** pour les agences avec un site sur mesure.
- **Marque blanche** pour les réseaux.

---

## Points de vigilance

**Juridique.** Une image générée qui embellit un bien peut être requalifiée en
pratique commerciale trompeuse. D'où : mention « vue simulée » non désactivable
sur chaque rendu, architecture jamais modifiée, photo d'origine toujours accessible.
Ce n'est pas une précaution cosmétique, c'est la condition de survie du produit.

**RGPD.** Les photos partent chez Google. Cela doit apparaître noir sur blanc
dans les CGU des agences clientes, pas seulement dans les nôtres.

**Coût.** Le cache est le modèle économique. Une ambiance générée une fois est
resservie indéfiniment. Sans le cache, une annonce très consultée coûterait
plus cher que ce qu'elle rapporte. La contrainte unique en base garantit
qu'on ne paie jamais deux fois la même image.

**Dépendance à un fournisseur.** Tout repose sur Gemini. `services/gemini.js`
est volontairement isolé derrière une seule fonction `generateVariant()` :
changer de modèle ne devra toucher qu'un fichier.
