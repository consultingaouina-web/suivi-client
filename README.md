# Suivi Fiscal & Social — version multi-cabinets (Aouina Consulting)

Version hébergée sur internet de l'application, où **plusieurs cabinets comptables indépendants** peuvent créer leur propre espace (inscription en ligne), chacun avec ses propres clients, collaborateurs et données — totalement séparés des autres cabinets. À l'intérieur d'un même cabinet, deux niveaux d'accès :

- **Superviseur** : voit et gère tout (tous les clients, tous les modules, l'équipe, les paramètres).
- **Agent** : ne voit que les clients qui lui sont attachés (et le suivi fiscal/social, les notes et les tâches qui s'y rapportent). Les comptes agents sont créés par le superviseur depuis le module Collaborateurs.

Un guide complet, pas à pas, est fourni séparément pour le déploiement sur Render.com + MongoDB Atlas. Ce README est un résumé technique.

## Structure du projet

```
suivi-fiscal-social-cabinets/
  server.js          serveur Express (API + fichiers statiques)
  db-fichier.js        base de données simulée en fichiers JSON (mode local, voir plus bas)
  package.json        dépendances Node.js
  .env.example         modèle des variables d'environnement (à copier en .env pour tester en local)
  .gitignore
  public/
    index.html         l'application (inscription, connexion, modules)
  data/                 (créé automatiquement en mode local — un fichier JSON par collection)
```

## Deux modes de stockage

Le serveur choisit automatiquement où stocker les données, selon `.env` :

- **Mode local (fichiers JSON)** — activé automatiquement si `MONGODB_URI` est vide. Idéal pour tester le MVP sans rien installer ni créer de compte cloud : chaque « collection » (`cabinets`, `comptes`, `etat`) devient un fichier JSON dans le dossier `data/`, créé automatiquement au premier lancement. Chaque création, modification ou suppression réécrit immédiatement le fichier JSON concerné sur le disque — les données survivent à un redémarrage du serveur, exactement comme une vraie base. Le dossier `data/` est exclu de Git (`.gitignore`) : ce sont des données de test locales, à ne jamais committer.
- **Mode MongoDB Atlas (cloud)** — activé dès que `MONGODB_URI` est renseignée dans `.env`. C'est le mode à utiliser pour la mise en ligne réelle (voir le guide de déploiement). Vous pouvez forcer le mode fichiers même avec `MONGODB_URI` renseignée en ajoutant `DB_MODE=fichier` dans `.env` (pratique pour continuer à tester en local sans toucher à la vraie base).

Le passage d'un mode à l'autre est purement une question de configuration (`.env`) — aucune ligne de code de `server.js` ne change, et le format des données stockées est identique dans les deux cas.

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
npm start
```

Puis ouvrez `http://localhost:3000` et créez votre premier cabinet depuis l'onglet « Créer un cabinet ». Toutes les données (cabinets, comptes, clients, etc.) sont enregistrées dans des fichiers JSON lisibles dans le dossier `data/` — vous pouvez les ouvrir avec n'importe quel éditeur de texte pour inspecter ce qui a été enregistré. Pour repartir de zéro, supprimez simplement le dossier `data/` et relancez le serveur.

**Avec MongoDB Atlas** (pour tester dans les conditions du déploiement final) : renseignez aussi `MONGODB_URI` dans `.env` avant `npm start`.

## Déploiement

Voir le guide pas à pas fourni séparément : création du compte MongoDB Atlas (gratuit), mise en ligne du code, création du service sur Render.com, configuration des variables d'environnement. En production, `MONGODB_URI` doit être renseignée (le mode fichiers JSON n'a pas vocation à être utilisé en ligne : sur Render, le disque n'est pas conservé entre deux redémarrages).

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
