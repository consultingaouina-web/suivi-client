"use strict";
/* =========================================================
   Point d'entrée pour un déploiement sur Vercel.

   Vercel ne fait pas tourner un serveur permanent : chaque requête est
   traitée par une fonction, potentiellement sur une instance "froide"
   qui vient de démarrer. On ne peut donc pas se connecter à MongoDB une
   fois pour toutes comme dans coeur-serveur.js (bloc `app.listen`) — il
   faut se connecter à la demande, puis RÉUTILISER cette connexion tant
   que l'instance reste "chaude" (c'est ce que fait `promesseApp`
   ci-dessous, mise en cache au niveau du module).

   IMPORTANT — pourquoi le fichier partagé vit dans lib/coeur-serveur.js
   et non à la racine sous server.js : Vercel scanne automatiquement des
   fichiers Express à la racine du projet (et a tenté, lors des premiers
   essais de déploiement, de déployer TEL QUEL un fichier nommé
   "server.js" puis même "coeur-serveur.js" à la racine — malgré la
   documentation officielle qui ne mentionne que app.js/index.js/
   server.js comme noms scannés) et essaie de le déployer comme
   l'application elle-même (fonctionnalité "zero-config Express"),
   indépendamment de ce fichier api/index.js et de vercel.json. Comme ce
   fichier exporte une fabrique (`creerApp`) et non l'application
   elle-même, Vercel refusait le déploiement avec l'erreur "Invalid export
   found... The default export must be a function or server." Le déplacer
   dans un sous-dossier (lib/) l'exclut de ce scan automatique. Ne
   replacez donc jamais ce fichier à la racine du projet (ni dans src/)
   sans vérifier que cela ne réintroduit pas le même problème.

   Le mode "fichiers JSON" (db-fichier.js) n'est PAS utilisable ici : le
   système de fichiers d'une fonction Vercel n'est ni partagé entre les
   instances, ni garanti d'être conservé d'une requête à l'autre. Sur
   Vercel, MONGODB_URI est donc obligatoire (contrairement au mode local,
   où elle peut être laissée vide) — voir README.md.
   ========================================================= */
const { MongoClient } = require('mongodb');
const { creerApp } = require('../lib/coeur-serveur.js');

let promesseApp = null;

function construireApp(){
  const { SESSION_SECRET, MONGODB_URI } = process.env;
  if(!SESSION_SECRET){
    return Promise.reject(new Error("Variable d'environnement manquante : SESSION_SECRET (à définir dans les réglages du projet Vercel)."));
  }
  if(!MONGODB_URI){
    return Promise.reject(new Error("Variable d'environnement manquante : MONGODB_URI. Sur Vercel, une vraie base MongoDB Atlas est obligatoire (le mode fichiers JSON local ne fonctionne pas sur cette plateforme)."));
  }
  return (async () => {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db('suivi_fiscal_social_cabinets');
    await db.collection('comptes').createIndex({ cabinetId: 1, collaborateurId: 1 });
    return creerApp({ db, sessionSecret: SESSION_SECRET });
  })();
}

function obtenirApp(){
  if(!promesseApp){
    promesseApp = construireApp();
    // si l'initialisation échoue (ex. mauvaise chaîne de connexion), on ne
    // garde pas l'échec en cache : la prochaine requête retentera plutôt
    // que de rester bloquée en échec jusqu'au prochain déploiement.
    promesseApp.catch(() => { promesseApp = null; });
  }
  return promesseApp;
}

module.exports = async (req, res) => {
  try{
    const app = await obtenirApp();
    return app(req, res);
  }catch(e){
    console.error('Erreur de démarrage (Vercel) :', e.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Erreur serveur au démarrage. Vérifiez les variables d’environnement du projet Vercel.' }));
  }
};
