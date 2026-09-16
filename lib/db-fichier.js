"use strict";
/* =========================================================
   Base de données simulée par fichiers JSON (un fichier par
   "modèle"/collection : cabinets.json, comptes.json, etat.json).
   Sert uniquement à tester le MVP en local sans dépendre d'une
   vraie base MongoDB — même interface minimale que le driver
   MongoDB officiel (findOne / find().toArray() / insertOne /
   updateOne avec upsert / deleteOne / createIndex no-op), pour
   que server.js n'ait besoin d'aucune adaptation.

   Chaque écriture (insertOne / updateOne / deleteOne) réécrit
   immédiatement le fichier JSON correspondant sur le disque —
   pas de tampon, pas de délai : ce qui est à l'écran après une
   action est déjà sur le disque.
   ========================================================= */
const fs = require('fs');
const path = require('path');

function correspond(doc, requete){
  return Object.keys(requete || {}).every(cle => {
    return JSON.stringify(doc ? doc[cle] : undefined) === JSON.stringify(requete[cle]);
  });
}

function copie(valeur){ return JSON.parse(JSON.stringify(valeur)); }

class CollectionFichier {
  constructor(cheminFichier){
    this.chemin = cheminFichier;
    this.documents = this._charger();
  }

  _charger(){
    try{
      if(fs.existsSync(this.chemin)){
        const brut = fs.readFileSync(this.chemin, 'utf8');
        return brut.trim() ? JSON.parse(brut) : [];
      }
    }catch(e){
      console.error(`[db-fichier] Lecture impossible de ${this.chemin}, on repart d'une liste vide :`, e.message);
    }
    return [];
  }

  _sauvegarder(){
    fs.mkdirSync(path.dirname(this.chemin), { recursive: true });
    // écriture via un fichier temporaire puis renommage : évite un fichier
    // à moitié écrit si le processus est interrompu pendant la sauvegarde.
    const tmp = `${this.chemin}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(this.documents, null, 2), 'utf8');
    fs.renameSync(tmp, this.chemin);
  }

  async findOne(requete){
    const trouve = this.documents.find(d => correspond(d, requete));
    return trouve ? copie(trouve) : null;
  }

  // Comme le vrai driver MongoDB, find() est SYNCHRONE et renvoie un curseur
  // (ici un simple objet {toArray}) — seul .toArray() est asynchrone. C'est
  // ce que le code appelant (server.js) attend : `await coll.find(q).toArray()`.
  find(requete){
    const resultats = this.documents.filter(d => correspond(d, requete || {})).map(copie);
    return { toArray: async () => resultats };
  }

  async insertOne(doc){
    const enregistre = copie(doc);
    this.documents.push(enregistre);
    this._sauvegarder();
    return { insertedId: enregistre._id, acknowledged: true };
  }

  async updateOne(requete, maj, options){
    options = options || {};
    const idx = this.documents.findIndex(d => correspond(d, requete));
    if(idx === -1){
      if(options.upsert){
        const nouveauDoc = Object.assign({}, requete, (maj && maj.$set) || {});
        this.documents.push(nouveauDoc);
        this._sauvegarder();
        return { matchedCount: 0, modifiedCount: 0, upsertedId: nouveauDoc._id, acknowledged: true };
      }
      return { matchedCount: 0, modifiedCount: 0, acknowledged: true };
    }
    if(maj && maj.$set) Object.assign(this.documents[idx], copie(maj.$set));
    this._sauvegarder();
    return { matchedCount: 1, modifiedCount: 1, acknowledged: true };
  }

  async deleteOne(requete){
    const idx = this.documents.findIndex(d => correspond(d, requete));
    if(idx === -1) return { deletedCount: 0, acknowledged: true };
    this.documents.splice(idx, 1);
    this._sauvegarder();
    return { deletedCount: 1, acknowledged: true };
  }

  // no-op : présent uniquement pour que le code écrit pour le vrai driver
  // MongoDB (qui appelle createIndex au démarrage) fonctionne sans modification.
  async createIndex(){ return 'index-ignore-mode-fichier'; }
}

class DbFichier {
  constructor(dossier){
    this.dossier = dossier;
    this._collections = new Map();
  }
  collection(nom){
    if(!this._collections.has(nom)){
      this._collections.set(nom, new CollectionFichier(path.join(this.dossier, `${nom}.json`)));
    }
    return this._collections.get(nom);
  }
}

module.exports = { DbFichier, CollectionFichier };
