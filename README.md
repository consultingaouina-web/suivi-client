# Suivi Fiscal & Social — version multi-cabinets (Aouina Consulting)

Version hébergée sur internet de l'application, où **plusieurs cabinets comptables indépendants** peuvent créer leur propre espace (inscription en ligne), chacun avec ses propres clients, collaborateurs et données — totalement séparés des autres cabinets. À l'intérieur d'un même cabinet, deux niveaux d'accès :

- **Superviseur** : voit et gère tout (tous les clients, tous les modules, l'équipe, les paramètres).
- **Agent** : ne voit que les clients qui lui sont attachés (et le suivi fiscal/social, les notes et les tâches qui s'y rapportent). Les comptes agents sont créés par le superviseur depuis le module Collaborateurs.

Un guide complet, pas à pas, est fourni séparément pour le déploiement sur Render.com + MongoDB Atlas. Ce README est un résumé technique. Un déploiement sur **Vercel** est également possible (voir plus bas) — même base de code, un seul petit fichier d'entrée en plus.

## Structure du projet

```
suivi-fiscal-social-cabinets/
  lib/
    coeur-serveur.js     serveur Express (API + fichiers statiques) — utilisé par Render et en local
    db-fichier.js          base de données simulée en fichiers JSON (mode local, voir plus bas)
  api/
    index.js               point d'entrée utilisé uniquement par Vercel (voir plus bas)
  vercel.json                configuration de routage pour Vercel
  package.json            dépendances Node.js
  .env.example             modèle des variables d'environnement (à copier en .env pour tester en local)
  .gitignore
  public/
    index.html             l'application (inscription, connexion, modules)
  data/                     (créé automatiquement en mode local — un fichier JSON par collection)
```

**Ne déplacez jamais `lib/coeur-serveur.js` à la racine du projet (ni dans un dossier `src/`), quel que soit le nom utilisé.** Vercel scanne automatiquement les fichiers Express présents à la racine (et dans `src/`) pour une fonctionnalité "zero-config Express" et essaie de les déployer tels quels comme l'application — indépendamment de `api/index.js` et de `vercel.json`. Ce fichier exportant une fabrique (`creerApp`) et non l'application elle-même, Vercel échouait avec l'erreur *"Invalid export found in module... The default export must be a function or server."*, d'abord en le nommant `server.js`, puis à nouveau après un simple renommage en `coeur-serveur.js` toujours à la racine — seul le déplacement dans le sous-dossier `lib/` (hors du champ de ce scan automatique) a résolu le problème. Le point d'entrée réellement utilisé par Vercel est `api/index.js`.

## Deux modes de stockage

Le serveur choisit automatiquement où stocker les données, selon `.env` :

- **Mode local (fichiers JSON)** — activé automatiquement si `MONGODB_URI` est vide. Idéal pour tester le MVP sans rien installer ni créer de compte cloud : chaque « collection » (`cabinets`, `comptes`, `etat`) devient un fichier JSON dans le dossier `data/`, créé automatiquement au premier lancement. Chaque création, modification ou suppression réécrit immédiatement le fichier JSON concerné sur le disque — les données survivent à un redémarrage du serveur, exactement comme une vraie base. Le dossier `data/` est exclu de Git (`.gitignore`) : ce sont des données de test locales, à ne jamais committer.
- **Mode MongoDB Atlas (cloud)** — activé dès que `MONGODB_URI` est renseignée dans `.env`. C'est le mode à utiliser pour la mise en ligne réelle (voir le guide de déploiement). Vous pouvez forcer le mode fichiers même avec `MONGODB_URI` renseignée en ajoutant `DB_MODE=fichier` dans `.env` (pratique pour continuer à tester en local sans toucher à la vraie base).

Le passage d'un mode à l'autre est purement une question de configuration (`.env`) — aucune ligne de code de `lib/coeur-serveur.js` ne change, et le format des données stockées est identique dans les deux cas.

## Variables d'environnement

| Variable          | Obligatoire ?  | Rôle                                                              |
|-------------------|----------------|---------------------------------------------------------------------|
| `SESSION_SECRET`  | Oui            | Chaîne aléatoire longue, sert à signer la session de connexion      |
| `MONGODB_URI`     | Non            | Chaîne de connexion à votre base MongoDB Atlas. Laissez vide pour le mode local (fichiers JSON). |
| `DB_MODE`         | Non            | Mettez `fichier` pour forcer le mode local même si `MONGODB_URI` est renseignée. |
| `PORT`            | Non            | Render la fournit automatiquement — ne la renseignez pas sur Render. |

Il n'y a pas de mot de passe unique d'application (`APP_PASSWORD`) : chaque personne a son propre identifiant (email) et mot de passe.

## Tester en local

**Sans base de données du tout** (le plus rapide, pour un premier essai du MVP) :

```bash
cp .env.example .env
# éditez .env : mettez seulement une chaîne SESSION_SECRET, laissez MONGODB_URI vide
npm install
npm start   # lance lib/coeur-serveur.js
```

Puis ouvrez `http://localhost:3000` et créez votre premier cabinet depuis l'onglet « Créer un cabinet ». Toutes les données (cabinets, comptes, clients, etc.) sont enregistrées dans des fichiers JSON lisibles dans le dossier `data/` — vous pouvez les ouvrir avec n'importe quel éditeur de texte pour inspecter ce qui a été enregistré. Pour repartir de zéro, supprimez simplement le dossier `data/` et relancez le serveur.

**Avec MongoDB Atlas** (pour tester dans les conditions du déploiement final) : renseignez aussi `MONGODB_URI` dans `.env` avant `npm start`.

## Déploiement

### Sur Render.com (guide détaillé fourni séparément)

Voir le guide pas à pas fourni séparément : création du compte MongoDB Atlas (gratuit), mise en ligne du code, création du service sur Render.com, configuration des variables d'environnement. Render fait tourner `lib/coeur-serveur.js` comme un serveur classique (`npm start`), en continu.

### Sur Vercel

Vercel ne fait pas tourner de serveur permanent : chaque requête est traitée par une fonction (`api/index.js`), potentiellement sur une instance qui vient de démarrer. `vercel.json` redirige toutes les routes (pages, fichiers de l'application, API) vers cette fonction unique, qui charge `lib/coeur-serveur.js` et se connecte à MongoDB à la demande, en réutilisant la connexion tant que l'instance reste active.

Étapes :
1. Déposez le code sur GitHub (comme pour Render, voir le guide).
2. Sur [vercel.com](https://vercel.com), **Add New → Project**, importez le dépôt.
3. Dans les réglages du projet, section **Environment Variables**, ajoutez `SESSION_SECRET` et `MONGODB_URI` (mêmes valeurs que pour Render — voir le guide pour créer le cluster MongoDB Atlas gratuit).
4. Déployez. Aucune configuration de build n'est nécessaire (pas de framework, pas d'étape de compilation).

**Important — obligatoire sur Vercel : `MONGODB_URI` doit toujours être renseignée.** Le mode fichiers JSON (voir ci-dessous) ne fonctionne pas sur Vercel : le système de fichiers d'une fonction serverless n'est ni partagé entre les instances, ni conservé d'une requête à l'autre (confirmé par la documentation officielle de Vercel, qui recommande un stockage externe pour tout ce qui doit persister). Ce mode reste utilisable uniquement pour tester en local sur votre PC avant de déployer.

**Piège connu (déjà rencontré deux fois et corrigé dans cette livraison)** : Vercel scanne automatiquement les fichiers Express présents à la racine du projet (et dans `src/`) pour une fonctionnalité "zero-config Express", indépendamment de `api/index.js` et de `vercel.json`. Un premier essai avec le serveur partagé nommé `server.js` à la racine a échoué (Vercel l'a détecté et tenté de le déployer tel quel) ; un simple renommage en `coeur-serveur.js`, toujours à la racine, a échoué exactement de la même façon. Le fichier vit maintenant dans `lib/coeur-serveur.js` — hors du champ de ce scan automatique — ce qui résout le problème. **Ne le déplacez pas à la racine (ni dans `src/`)** sans en tenir compte. Notez aussi que `lib/coeur-serveur.js` calcule les chemins vers `public/` et `data/` relativement à son propre dossier (`path.join(__dirname, '..', ...)`) — un futur déplacement de ce fichier doit impérativement s'accompagner d'une vérification de ces chemins.

**Limite propre à Vercel** : la protection anti-force-brute sur la connexion (compteur de tentatives) est gardée en mémoire de la fonction — chaque instance serverless a sa propre mémoire, donc cette limite est appliquée par instance plutôt que globalement (contrairement à Render, où un seul processus tourne en continu). Sans conséquence pour un usage normal, mais un attaquant déterminé pourrait en théorie répartir ses tentatives sur plusieurs instances pour contourner partiellement la limite.

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
- Les données transitent en HTTPS une fois déployées sur Render (chiffré automatiquement).
- Limite connue : si un superviseur modifie les données du cabinet (import, édition en masse) pendant qu'un agent enregistre au même instant une modification, la version du superviseur l'emporte pour tout ce qui n'est pas propre à cet agent — un usage normal (une personne à la fois par écran) n'est pas concerné.
