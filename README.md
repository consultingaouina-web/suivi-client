# Suivi Fiscal & Social — version multi-cabinets (Aouina Consulting)

Version hébergée sur internet de l'application, où **plusieurs cabinets comptables indépendants** peuvent créer leur propre espace (inscription en ligne), chacun avec ses propres clients, collaborateurs et données — totalement séparés des autres cabinets. À l'intérieur d'un même cabinet, deux niveaux d'accès :

- **Superviseur** : voit et gère tout (tous les clients, tous les modules, l'équipe, les paramètres).
- **Agent** : ne voit que les clients qui lui sont attachés (et le suivi fiscal/social, les notes et les tâches qui s'y rapportent). Les comptes agents sont créés par le superviseur depuis le module Collaborateurs.

Un guide complet, pas à pas, est fourni séparément pour le déploiement sur Render.com + MongoDB Atlas. Ce README est un résumé technique. Un déploiement sur **Vercel** est également possible (voir plus bas) — même base de code, un seul et même fichier serveur pour les deux plateformes.

## Structure du projet

```
suivi-fiscal-social-cabinets/
  server.js                point d'entrée UNIQUE : Render, usage local, ET Vercel
  lib/
    coeur-serveur.js        logique de l'application Express (routes API, sessions, rôles)
    db-fichier.js           base de données simulée en fichiers JSON (mode local, voir plus bas)
  package.json              dépendances Node.js
  .env.example               modèle des variables d'environnement (à copier en .env pour tester en local)
  .gitignore
  public/
    index.html               l'application (inscription, connexion, modules)
  data/                       (créé automatiquement en mode local — un fichier JSON par collection)
```

**`server.js` doit impérativement rester à la racine du projet, sous ce nom.** C'est le point d'entrée que Vercel exige pour son intégration "zero-config Express" (voir la section Vercel plus bas pour l'historique complet — deux tentatives précédentes, avec le fichier ailleurs ou sous un autre nom, ont échoué). Toute la logique métier (routes, sessions, rôles) reste dans `lib/coeur-serveur.js` ; `server.js` n'est qu'une fine coquille qui connecte la base de données puis délègue à cette logique — voir les commentaires en tête de `server.js` pour le détail.

## Deux modes de stockage

Le serveur choisit automatiquement où stocker les données, selon `.env` :

- **Mode local (fichiers JSON)** — activé automatiquement si `MONGODB_URI` est vide. Idéal pour tester le MVP sans rien installer ni créer de compte cloud : chaque « collection » (`cabinets`, `comptes`, `etat`) devient un fichier JSON dans le dossier `data/`, créé automatiquement au premier lancement. Chaque création, modification ou suppression réécrit immédiatement le fichier JSON concerné sur le disque — les données survivent à un redémarrage du serveur, exactement comme une vraie base. Le dossier `data/` est exclu de Git (`.gitignore`) : ce sont des données de test locales, à ne jamais committer. **Ce mode ne fonctionne pas sur Vercel** (voir plus bas) — `server.js` refuse de démarrer en mode fichiers sur Vercel et affiche une erreur claire si `MONGODB_URI` n'y est pas renseignée.
- **Mode MongoDB Atlas (cloud)** — activé dès que `MONGODB_URI` est renseignée dans `.env`. C'est le mode à utiliser pour la mise en ligne réelle (Render ou Vercel, voir le guide de déploiement). Vous pouvez forcer le mode fichiers même avec `MONGODB_URI` renseignée en ajoutant `DB_MODE=fichier` dans `.env` (pratique pour continuer à tester en local sans toucher à la vraie base).

Le passage d'un mode à l'autre est purement une question de configuration (`.env`) — aucune ligne de code de `lib/coeur-serveur.js` ne change, et le format des données stockées est identique dans les deux cas.

## Variables d'environnement

| Variable          | Obligatoire ?  | Rôle                                                              |
|-------------------|----------------|---------------------------------------------------------------------|
| `SESSION_SECRET`  | Oui            | Chaîne aléatoire longue, sert à signer la session de connexion      |
| `MONGODB_URI`     | Oui sur Vercel, sinon non | Chaîne de connexion à votre base MongoDB Atlas. Laissez vide en local/Render pour le mode fichiers JSON — obligatoire sur Vercel. |
| `DB_MODE`         | Non            | Mettez `fichier` pour forcer le mode local même si `MONGODB_URI` est renseignée. |
| `PORT`            | Non            | Render la fournit automatiquement — ne la renseignez pas sur Render/Vercel. |

Il n'y a pas de mot de passe unique d'application (`APP_PASSWORD`) : chaque personne a son propre identifiant (email) et mot de passe.

## Tester en local

**Sans base de données du tout** (le plus rapide, pour un premier essai du MVP) :

```bash
cp .env.example .env
# éditez .env : mettez seulement une chaîne SESSION_SECRET, laissez MONGODB_URI vide
npm install
npm start   # lance server.js
```

Puis ouvrez `http://localhost:3000` et créez votre premier cabinet depuis l'onglet « Créer un cabinet ». Toutes les données (cabinets, comptes, clients, etc.) sont enregistrées dans des fichiers JSON lisibles dans le dossier `data/` — vous pouvez les ouvrir avec n'importe quel éditeur de texte pour inspecter ce qui a été enregistré. Pour repartir de zéro, supprimez simplement le dossier `data/` et relancez le serveur.

**Avec MongoDB Atlas** (pour tester dans les conditions du déploiement final) : renseignez aussi `MONGODB_URI` dans `.env` avant `npm start`.

## Déploiement

### Sur Render.com (guide détaillé fourni séparément)

Voir le guide pas à pas fourni séparément : création du compte MongoDB Atlas (gratuit), mise en ligne du code, création du service sur Render.com, configuration des variables d'environnement. Render fait tourner `server.js` comme un serveur classique (`npm start`), en continu.

### Sur Vercel

Étapes :
1. Déposez le code sur GitHub (comme pour Render, voir le guide).
2. Sur [vercel.com](https://vercel.com), **Add New → Project**, importez le dépôt.
3. Dans les réglages du projet, section **Environment Variables**, ajoutez `SESSION_SECRET` et `MONGODB_URI` (mêmes valeurs que pour Render — voir le guide pour créer le cluster MongoDB Atlas gratuit). **`MONGODB_URI` est obligatoire sur Vercel** : le mode fichiers JSON n'y fonctionne pas (système de fichiers non partagé entre instances, non garanti d'être conservé d'une requête à l'autre).
4. Déployez. Aucune configuration de build n'est nécessaire (pas de `vercel.json`, pas de dossier `api/` — Vercel détecte et déploie automatiquement `server.js`, voir ci-dessous).

**Historique de mise au point — pourquoi l'architecture a changé deux fois avant celle-ci.** Vercel propose une fonctionnalité "zero-config Express" : elle scanne automatiquement `app.js`/`index.js`/`server.js` à la racine du projet (ou dans `src/`) et attend d'y trouver directement l'application Express exportée (pas une fabrique). Trois tentatives ont été nécessaires pour satisfaire cette exigence dans les faits :
1. **1er essai** : le fichier serveur partagé s'appelait `server.js`, à la racine, mais exportait une fabrique (`{ creerApp, ... }`) plutôt que l'application elle-même → échec : *"Invalid export found in module... The default export must be a function or server."*
2. **2e essai** : renommage en `coeur-serveur.js`, toujours à la racine, en misant sur une architecture séparée (`api/index.js` + `vercel.json`, l'approche "Vercel Functions" classique) pour contourner le scan automatique → échec identique, avec le nouveau nom cette fois (`/var/task/coeur-serveur.js`) — preuve que Vercel a bien continué à scanner et déployer ce fichier directement, quel que soit son nom exact et malgré la présence de `api/`+`vercel.json`.
3. **3e essai** : déplacement du fichier dans un sous-dossier `lib/` (hors du périmètre de scan), suppression de `api/`/`vercel.json` entre-temps testée → échec différent cette fois : *"No entrypoint found"*, listant précisément `app.js`/`index.js`/`server.js` (racine et `src/`) comme les seuls emplacements recherchés — confirmant que, pour ce projet, Vercel utilise **exclusivement** ce mécanisme "zero-config Express" (et non l'approche `api/`+`vercel.json`), et qu'un point d'entrée y est strictement obligatoire.

**Architecture actuelle (celle de cette livraison)** : `server.js`, à la racine, exporte directement une véritable application Express (satisfait donc l'exigence de Vercel). Comme la construction de l'application réelle nécessite une connexion asynchrone à la base de données (impossible à faire de façon synchrone au chargement du fichier), `server.js` crée une coquille Express minimale qui délègue chaque requête à l'application réelle une fois celle-ci prête (construite par `creerApp()`, dans `lib/coeur-serveur.js`, réutilisée telle quelle) — la connexion est mise en cache au niveau du module et réutilisée tant que l'instance reste active, que ce soit sur Render (process continu) ou sur Vercel (instance serverless réutilisée entre requêtes rapprochées). Ce même fichier gère aussi le démarrage classique (`app.listen()`) pour Render et l'usage local.

**Conséquence à connaître** : en mode "zero-config Express", Vercel ignore les appels `express.static()` et sert plutôt tout le contenu de `public/**` directement via son CDN — sans configuration supplémentaire de notre part, puisque le dossier s'appelle déjà `public/`. Sur Render et en local, `express.static()` continue de fonctionner normalement (il n'y a pas de CDN qui l'intercepte).

**Limite propre à Vercel** : la protection anti-force-brute sur la connexion (compteur de tentatives) est gardée en mémoire de la fonction — chaque instance serverless a sa propre mémoire, donc cette limite est appliquée par instance plutôt que globalement (contrairement à Render, où un seul processus tourne en continu). Sans conséquence pour un usage normal, mais un attaquant déterminé pourrait en théorie répartir ses tentatives sur plusieurs instances pour contourner partiellement la limite.

**Cette troisième architecture n'a, comme les deux précédentes, pas pu être vérifiée contre un déploiement Vercel réel depuis l'environnement de développement** (aucun accès à un compte Vercel) — seul le contrat exact utilisé par la plateforme (application Express exportée directement, sans `app.listen()`) a pu être testé localement. Si un nouveau message d'erreur apparaît malgré tout au déploiement, il faut le transmettre tel quel : il indique précisément où chercher.

En production (Render ou Vercel), `MONGODB_URI` doit toujours être renseignée — le mode fichiers JSON n'a pas vocation à être utilisé en ligne.

## Fonctionnement

- Chaque cabinet correspond à un document dans MongoDB (collection `etat`), contenant toutes ses données (clients, suivi fiscal, suivi social, collaborateurs, tâches, notes, taxes fiscales, paramètres) — totalement séparé de celui des autres cabinets.
- Les identifiants de connexion (email + mot de passe) sont stockés séparément (collection `comptes`), jamais mêlés aux données métier.
- **Isolation par rôle appliquée côté serveur** (pas seulement dans l'affichage) :
  - `GET /api/data` renvoie, pour un agent, uniquement ses clients attachés (et le suivi fiscal/social/notes associés, et ses propres tâches) ; le superviseur reçoit tout.
  - `PUT /api/data` : pour un agent, seules les entrées qui lui appartiennent sont modifiées côté serveur — le reste du cabinet (clients des autres agents, paramètres, équipe) n'est jamais touché, même si le contenu envoyé était incomplet ou trafiqué. Le superviseur peut tout modifier.
  - Un agent qui tente d'attribuer un client à quelqu'un d'autre se le voit automatiquement réattribué à lui-même par le serveur.
- Le superviseur crée les comptes agents depuis le module **Collaborateurs** (bouton Modifier sur une fiche existante → section « Accès à l'application »). Il peut aussi réinitialiser un mot de passe ou retirer un accès à tout moment (sauf le sien).
- Le bouton **Exporter les données** reste disponible (export JSON). Pour un agent, l'export ne contient que ses propres clients ; pour un superviseur, tout le cabinet.
- Le bouton **Importer les données** remplace les données visibles par l'utilisateur connecté (ses clients pour un agent, tout le cabinet pour un superviseur) par le contenu du fichier JSON importé.

## Sécurité — à savoir

- Chaque personne doit avoir son propre identifiant/mot de passe — ne partagez pas de compte entre plusieurs personnes.
- `SESSION_SECRET` doit être une chaîne longue et aléatoire, générée par exemple avec :
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- Les mots de passe sont hachés (bcrypt) avant stockage — jamais conservés en clair.
- Les sessions de connexion durent 90 jours (cookie). Désactiver un agent depuis Collaborateurs coupe son accès immédiatement, dès sa prochaine requête — sans attendre l'expiration du cookie.
- Les données transitent en HTTPS une fois déployées sur Render ou Vercel (chiffré automatiquement).
- Limite connue : si un superviseur modifie les données du cabinet (import, édition en masse) pendant qu'un agent enregistre au même instant une modification, la version du superviseur l'emporte pour tout ce qui n'est pas propre à cet agent — un usage normal (une personne à la fois par écran) n'est pas concerné.
