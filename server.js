"use strict";
require('dotenv').config();
/* =========================================================
   Point d'entrée UNIQUE du projet — utilisé par Render, par un
   usage local (`npm start`), ET par Vercel.

   Pourquoi un seul fichier, à la racine, sous ce nom précis :
   Vercel propose une fonctionnalité "zero-config Express" qui
   s'est révélée, à l'usage réel (voir README.md pour l'historique
   complet des trois tentatives), être OBLIGATOIRE pour ce projet :
   Vercel exige de trouver, à la racine du projet (ou dans src/),
   un fichier nommé exactement app.js, index.js ou server.js, qui
   exporte directement l'application Express elle-même (pas une
   fabrique) — sans quoi le déploiement échoue avec "No entrypoint
   found". Un dossier api/ + vercel.json (l'approche "Vercel
   Functions" classique, essayée en premier) n'a pas suffi : ce
   projet semble configuré (ou auto-détecté par Vercel) pour
   utiliser exclusivement cette voie "zero-config Express".

   Le problème : notre application a besoin de se connecter à une
   base de données (MongoDB, ou une base simulée en fichiers JSON
   en local) de façon ASYNCHRONE avant de pouvoir construire ses
   routes (voir lib/coeur-serveur.js, fonction creerApp). Impossible
   donc d'exporter directement un `app` déjà entièrement prêt de
   façon synchrone au chargement du module.

   La solution : ce fichier crée un `app` Express bien réel tout de
   suite (satisfait donc l'exigence de Vercel), mais qui ne fait
   qu'UNE seule chose — attendre que l'application "réelle" (celle
   construite par creerApp, une fois la base de données prête) soit
   disponible, puis lui déléguer chaque requête. La connexion à la
   base est mise en cache au niveau du module (obtenirAppReelle),
   donc elle n'est faite qu'une seule fois par instance/process,
   qu'on soit sur Render (un seul process, en continu) ou sur Vercel
   (une instance serverless, réutilisée tant qu'elle reste "chaude").
   ========================================================= */
const path = require('path');
const express = require('express');
const { creerApp } = require('./lib/coeur-serveur.js');

async function construireAppReelle(){
  const { SESSION_SECRET, MONGODB_URI, DB_MODE, VERCEL } = process.env;
  if(!SESSION_SECRET){
    throw new Error("Variable d'environnement manquante : SESSION_SECRET (voir .env.example, ou les réglages du projet Vercel).");
  }

  // Sur Vercel, le système de fichiers d'une fonction n'est ni partagé entre
  // les instances, ni conservé d'une requête à l'autre : le mode "fichiers
  // JSON" (utile seulement pour tester en local) n'y fonctionnerait pas de
  // façon fiable. On l'interdit donc explicitement sur Vercel (détecté via
  // la variable VERCEL, définie automatiquement par la plateforme).
  if(VERCEL && !MONGODB_URI){
    throw new Error("Variable d'environnement manquante : MONGODB_URI. Sur Vercel, une vraie base MongoDB Atlas est obligatoire (le mode fichiers JSON local ne fonctionne pas sur cette plateforme).");
  }

  // Mode "fichier" (base simulée en fichiers JSON, pour tester en local sans
  // rien installer d'autre) : activé automatiquement si MONGODB_URI n'est pas
  // renseignée, ou explicitement via DB_MODE=fichier même si elle l'est.
  const modeFichier = DB_MODE === 'fichier' || !MONGODB_URI;

  let db;
  if(modeFichier){
    const { DbFichier } = require('./lib/db-fichier');
    // dossier data/ à la racine du projet, à côté de public/ — ce fichier
    // (server.js) vit lui-même à la racine, donc pas de '..' nécessaire ici
    // (contrairement aux chemins internes à lib/coeur-serveur.js).
    const dossierDonnees = path.join(__dirname, 'data');
    db = new DbFichier(dossierDonnees);
    console.log(`Base de données simulée (fichiers JSON) — dossier : ${dossierDonnees}`);
    console.log('Pour utiliser une vraie base MongoDB à la place, renseignez MONGODB_URI dans .env.');
  } else {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('suivi_fiscal_social_cabinets');
    await db.collection('comptes').createIndex({ cabinetId: 1, collaborateurId: 1 });
    console.log('Connecté à MongoDB.');
  }

  return creerApp({ db, sessionSecret: SESSION_SECRET });
}

let promesseAppReelle = null;
function obtenirAppReelle(){
  if(!promesseAppReelle){
    promesseAppReelle = construireAppReelle();
    // si la construction échoue (ex. variable manquante, mauvaise chaîne de
    // connexion), on ne garde pas l'échec en cache : la requête suivante
    // retentera plutôt que de rester bloquée en échec indéfiniment.
    promesseAppReelle.catch(() => { promesseAppReelle = null; });
  }
  return promesseAppReelle;
}

// L'export par défaut DOIT être une véritable application/fonction Express
// (exigence de Vercel, voir la note en tête de fichier) — d'où cette
// coquille, dont l'unique rôle est de déléguer à l'application réelle une
// fois prête.
const app = express();
app.use(async (req, res, next) => {
  try{
    const appReelle = await obtenirAppReelle();
    appReelle(req, res, next);
  }catch(e){
    console.error('Erreur de démarrage du serveur :', e.message);
    res.status(500).json({ error: 'Erreur serveur au démarrage. Vérifiez les variables d’environnement (SESSION_SECRET, MONGODB_URI).' });
  }
});

module.exports = app;

if(require.main === module){
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}.`));
}
