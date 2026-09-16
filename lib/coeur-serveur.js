"use strict";
require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');

const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/* =========================================================
   Utilitaires génériques (id, session signée, mots de passe)
   ========================================================= */
function genererId(){ return 'id_' + Date.now().toString(36) + '_' + crypto.randomBytes(5).toString('hex'); }

function b64urlEncoder(obj){ return Buffer.from(JSON.stringify(obj)).toString('base64url'); }
function b64urlDecoder(s){ try{ return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); }catch(e){ return null; } }

function signerCharge(secret, charge64){ return crypto.createHmac('sha256', secret).update(charge64).digest('hex'); }

function creerToken(secret, payload){
  const charge = Object.assign({}, payload, { ts: Date.now() });
  const charge64 = b64urlEncoder(charge);
  return `${charge64}.${signerCharge(secret, charge64)}`;
}

function verifierToken(secret, token){
  if(!token || typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if(idx < 0) return null;
  const charge64 = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const attendu = signerCharge(secret, charge64);
  const a = Buffer.from(sig), b = Buffer.from(attendu);
  if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const payload = b64urlDecoder(charge64);
  if(!payload || !payload.ts) return null;
  if(Date.now() - payload.ts > SESSION_MAX_AGE_MS) return null;
  return payload;
}

async function hasherMotDePasse(motDePasse){ return bcrypt.hash(motDePasse, 10); }
async function verifierMotDePasse(motDePasse, hash){ return bcrypt.compare(motDePasse, hash || ''); }

function emailValide(email){ return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()); }

/* =========================================================
   Modèle de données par défaut d'un cabinet (même forme que
   la version autonome — un seul document JSON par cabinet)
   ========================================================= */
function donneesParDefaut(){
  return {
    version: 3,
    clients: [],
    collaborateurs: [],
    taches: [],
    notes: [],
    fiscalMensuel: {},
    fiscalAutres: {},
    social: {},
    parametres: {
      formesJuridiques: ['SARL','SUARL','SA','SNC','Entreprise Individuelle','Association','Autre'],
      typesSociete: [
        { nom:'Personne Morale', regime:'IS' },
        { nom:'Personne Physique', regime:'IRPP' }
      ],
      typesDeclaration: ['Régime Réel','Régime Forfaitaire','Personne Physique (BIC/BNC)','Recette de Finance'],
      taxesFiscales: ['Retenue à la source','TFP','FOPROLOS','Droit de Consommation','TVA','Autres Taxes sur CA','Taxes sur les assurances','Droit de timbre','TCL','Taxe Hôtelière','Droit de licence']
    }
  };
}

/* =========================================================
   Filtrage / fusion par rôle
   ========================================================= */
function idsClientsVisiblesAgent(donnees, collaborateurId){
  return new Set(donnees.clients.filter(c => c.collaborateurId === collaborateurId).map(c => c.id));
}

function filtrerAnnuel(bucket, clientIds){
  const out = {};
  Object.keys(bucket || {}).forEach(annee => {
    const parAnnee = bucket[annee] || {};
    const filtre = {};
    Object.keys(parAnnee).forEach(cid => { if(clientIds.has(cid)) filtre[cid] = parAnnee[cid]; });
    out[annee] = filtre;
  });
  return out;
}

function filtrerDonneesPourAgent(donnees, collaborateurId){
  const clientIds = idsClientsVisiblesAgent(donnees, collaborateurId);
  return {
    version: donnees.version,
    clients: donnees.clients.filter(c => clientIds.has(c.id)),
    collaborateurs: donnees.collaborateurs,
    taches: donnees.taches.filter(t => t.collaborateurId === collaborateurId),
    notes: donnees.notes.filter(n => clientIds.has(n.clientId)),
    fiscalMensuel: filtrerAnnuel(donnees.fiscalMensuel, clientIds),
    fiscalAutres: filtrerAnnuel(donnees.fiscalAutres, clientIds),
    social: filtrerAnnuel(donnees.social, clientIds),
    parametres: donnees.parametres
  };
}

function fusionnerEcritureAgent(donneesActuelles, payload, collaborateurId, nomAgent){
  const d = JSON.parse(JSON.stringify(donneesActuelles));
  const ancienIds = idsClientsVisiblesAgent(d, collaborateurId);
  const nouveauxIds = new Set();

  const clientsPayload = Array.isArray(payload.clients) ? payload.clients : [];
  const clientsAutres = d.clients.filter(c => !ancienIds.has(c.id));
  const clientsAgent = [];
  clientsPayload.forEach(c => {
    const existeDeja = d.clients.some(x => x.id === c.id);
    if(!existeDeja){
      const nc = Object.assign({}, c, { id: c.id || genererId(), collaborateurId, collaborateur: nomAgent });
      clientsAgent.push(nc);
      nouveauxIds.add(nc.id);
    } else if(ancienIds.has(c.id)){
      const nc = Object.assign({}, c, { collaborateurId, collaborateur: nomAgent });
      clientsAgent.push(nc);
      nouveauxIds.add(nc.id);
    }
    // un id appartenant à un autre agent/superviseur est ignoré silencieusement (tentative invalide)
  });
  d.clients = clientsAutres.concat(clientsAgent);

  const notesPayload = Array.isArray(payload.notes) ? payload.notes : [];
  const notesAutres = d.notes.filter(n => !ancienIds.has(n.clientId));
  const notesAgent = notesPayload.filter(n => nouveauxIds.has(n.clientId)).map(n => Object.assign({}, n, { id: n.id || genererId() }));
  d.notes = notesAutres.concat(notesAgent);

  const tachesPayload = Array.isArray(payload.taches) ? payload.taches : [];
  const tachesAutres = d.taches.filter(t => t.collaborateurId !== collaborateurId);
  const tachesAgent = tachesPayload.map(t => Object.assign({}, t, { id: t.id || genererId(), collaborateurId }));
  d.taches = tachesAutres.concat(tachesAgent);

  ['fiscalMensuel','fiscalAutres','social'].forEach(cle => {
    const bucketPayload = payload[cle] || {};
    if(!d[cle]) d[cle] = {};
    Object.keys(bucketPayload).forEach(annee => {
      if(!d[cle][annee]) d[cle][annee] = {};
      const parAnneePayload = bucketPayload[annee] || {};
      Object.keys(parAnneePayload).forEach(cid => {
        if(nouveauxIds.has(cid)) d[cle][annee][cid] = parAnneePayload[cid];
      });
    });
    Object.keys(d[cle]).forEach(annee => {
      Object.keys(d[cle][annee]).forEach(cid => {
        if(ancienIds.has(cid) && !nouveauxIds.has(cid)) delete d[cle][annee][cid];
      });
    });
  });

  // collaborateurs et paramètres : jamais modifiés par un agent
  return d;
}

/* Les comptes de connexion (identifiant / mot de passe) ne sont jamais stockés
   dans le document "donnees" d'un cabinet : ils vivent uniquement dans la
   collection "comptes", et sont réinjectés (identifiant, aCompte) à la lecture
   pour affichage, puis retirés avant toute écriture. Ceci évite toute
   divergence entre les deux et garde les mots de passe hors du flux générique. */
async function enrichirCollaborateursAvecComptes(comptesCollection, cabinetId, collaborateurs){
  const tousComptes = await comptesCollection.find({ cabinetId }).toArray();
  const parCollaborateur = new Map(tousComptes.map(c => [c.collaborateurId, c]));
  return collaborateurs.map(col => {
    const compte = parCollaborateur.get(col.id);
    return Object.assign({}, col, {
      identifiant: compte ? compte._id : '',
      aCompte: !!compte,
      roleCompte: compte ? compte.role : null
    });
  });
}

function retirerChampsComptes(collaborateurs){
  return (collaborateurs || []).map(col => {
    const c = Object.assign({}, col);
    delete c.identifiant; delete c.aCompte; delete c.roleCompte; delete c.motDePasse; delete c.motDePasseHash;
    return c;
  });
}

/* =========================================================
   Application Express (factory — testable sans vraie Mongo)
   ========================================================= */
function creerApp({ db, sessionSecret }){
  if(!sessionSecret) throw new Error('sessionSecret est obligatoire pour créer le serveur.');

  const cabinets = db.collection('cabinets');
  const comptes = db.collection('comptes');
  const etat = db.collection('etat');

  const tentatives = new Map();
  function limiteAtteinte(ip){
    const now = Date.now();
    const entry = tentatives.get(ip);
    if(!entry || now > entry.resetAt){ tentatives.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 }); return false; }
    entry.count++;
    return entry.count > 10;
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '20mb' }));
  app.use(cookieParser());
  // __dirname pointe vers lib/ (ce fichier y vit délibérément, voir la note
  // dans api/index.js) — public/ est un dossier plus haut, à la racine du projet.
  app.use(express.static(path.join(__dirname, '..', 'public')));

  function requireAuth(req, res, next){
    const payload = verifierToken(sessionSecret, req.cookies && req.cookies.session);
    if(!payload){ res.status(401).json({ error: 'Non authentifié.' }); return; }
    req.session = payload; // { cabinetId, collaborateurId, role, ts }
    next();
  }
  function requireSuperviseur(req, res, next){
    if(req.session.role !== 'superviseur'){ res.status(403).json({ error: 'Réservé au superviseur du cabinet.' }); return; }
    next();
  }

  async function chargerDonneesActives(req, res){
    const doc = await etat.findOne({ _id: req.session.cabinetId });
    const donnees = doc ? doc.donnees : donneesParDefaut();
    // vérifie que le collaborateur qui porte cette session existe toujours et est actif
    const soi = donnees.collaborateurs.find(c => c.id === req.session.collaborateurId);
    if(!soi || soi.actif === false){
      res.status(401).json({ error: 'Compte désactivé ou introuvable. Reconnectez-vous.' });
      return null;
    }
    return { doc, donnees, soi };
  }

  /* ---------------- Inscription / connexion ---------------- */

  app.post('/api/inscription', async (req, res) => {
    try{
      const { nomCabinet, nom, email, motDePasse } = req.body || {};
      if(!nomCabinet || !String(nomCabinet).trim()) return res.status(400).json({ error: 'Le nom du cabinet est obligatoire.' });
      if(!nom || !String(nom).trim()) return res.status(400).json({ error: 'Votre nom est obligatoire.' });
      if(!emailValide(email)) return res.status(400).json({ error: 'Adresse email invalide.' });
      if(!motDePasse || String(motDePasse).length < 6) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });

      const emailLower = String(email).trim().toLowerCase();
      const existant = await comptes.findOne({ _id: emailLower });
      if(existant) return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse email.' });

      const cabinetId = genererId();
      const collaborateurId = genererId();
      await cabinets.insertOne({ _id: cabinetId, nom: String(nomCabinet).trim(), creeLe: new Date() });

      const donnees = donneesParDefaut();
      donnees.collaborateurs.push({
        id: collaborateurId, nom: String(nom).trim(), telephone: '', email: emailLower,
        poste: 'Superviseur', photo: '', actif: true
      });
      await etat.insertOne({ _id: cabinetId, donnees, misAJourLe: new Date() });

      const motDePasseHash = await hasherMotDePasse(String(motDePasse));
      await comptes.insertOne({ _id: emailLower, motDePasseHash, cabinetId, collaborateurId, role: 'superviseur', creeLe: new Date() });

      const token = creerToken(sessionSecret, { cabinetId, collaborateurId, role: 'superviseur' });
      res.cookie('session', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: SESSION_MAX_AGE_MS, path: '/' });
      res.json({ ok: true });
    }catch(e){
      console.error('Erreur inscription', e);
      res.status(500).json({ error: "Erreur serveur lors de l'inscription." });
    }
  });

  app.post('/api/connexion', async (req, res) => {
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'inconnu';
    if(limiteAtteinte(ip)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    try{
      const { email, motDePasse } = req.body || {};
      const emailLower = String(email || '').trim().toLowerCase();
      const compte = await comptes.findOne({ _id: emailLower });
      const ok = compte && await verifierMotDePasse(String(motDePasse || ''), compte.motDePasseHash);
      if(!ok){
        return setTimeout(() => res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' }), 400);
      }
      const doc = await etat.findOne({ _id: compte.cabinetId });
      const soi = doc && doc.donnees.collaborateurs.find(c => c.id === compte.collaborateurId);
      if(!soi || soi.actif === false){
        return setTimeout(() => res.status(401).json({ error: 'Ce compte a été désactivé. Contactez le superviseur de votre cabinet.' }), 400);
      }
      const token = creerToken(sessionSecret, { cabinetId: compte.cabinetId, collaborateurId: compte.collaborateurId, role: compte.role });
      res.cookie('session', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: SESSION_MAX_AGE_MS, path: '/' });
      res.json({ ok: true });
    }catch(e){
      console.error('Erreur connexion', e);
      res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
    }
  });

  app.post('/api/deconnexion', (req, res) => { res.clearCookie('session', { path: '/' }); res.json({ ok: true }); });

  app.get('/api/moi', requireAuth, async (req, res) => {
    try{
      const ctx = await chargerDonneesActives(req, res);
      if(!ctx) return;
      const cabinet = await cabinets.findOne({ _id: req.session.cabinetId });
      res.json({ nom: ctx.soi.nom, role: req.session.role, cabinetNom: cabinet ? cabinet.nom : '', collaborateurId: req.session.collaborateurId });
    }catch(e){
      console.error('Erreur /api/moi', e);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  });

  /* ---------------- Données du cabinet (filtrées par rôle) ---------------- */

  app.get('/api/data', requireAuth, async (req, res) => {
    try{
      const ctx = await chargerDonneesActives(req, res);
      if(!ctx) return;
      let { donnees } = ctx;
      donnees = Object.assign({}, donnees, {
        collaborateurs: await enrichirCollaborateursAvecComptes(comptes, req.session.cabinetId, donnees.collaborateurs)
      });
      if(req.session.role === 'agent'){
        donnees = filtrerDonneesPourAgent(donnees, req.session.collaborateurId);
      }
      res.json(donnees);
    }catch(e){
      console.error('Erreur lecture /api/data', e);
      res.status(500).json({ error: 'Erreur serveur lors de la lecture des données.' });
    }
  });

  app.put('/api/data', requireAuth, async (req, res) => {
    try{
      const ctx = await chargerDonneesActives(req, res);
      if(!ctx) return;
      const payload = req.body || {};
      let nouvellesDonnees;
      if(req.session.role === 'superviseur'){
        nouvellesDonnees = Object.assign(donneesParDefaut(), payload);
        nouvellesDonnees.collaborateurs = retirerChampsComptes(nouvellesDonnees.collaborateurs);
        // un superviseur ne peut pas supprimer/altérer son propre accès par erreur via ce canal générique
        if(!nouvellesDonnees.collaborateurs.some(c => c.id === req.session.collaborateurId)){
          const moi = ctx.donnees.collaborateurs.find(c => c.id === req.session.collaborateurId);
          if(moi) nouvellesDonnees.collaborateurs.push(retirerChampsComptes([moi])[0]);
        }
      } else {
        nouvellesDonnees = fusionnerEcritureAgent(ctx.donnees, payload, req.session.collaborateurId, ctx.soi.nom);
      }
      await etat.updateOne({ _id: req.session.cabinetId }, { $set: { donnees: nouvellesDonnees, misAJourLe: new Date() } }, { upsert: true });
      res.json({ ok: true });
    }catch(e){
      console.error('Erreur écriture /api/data', e);
      res.status(500).json({ error: "Erreur serveur lors de l'enregistrement." });
    }
  });

  /* ---------------- Comptes de connexion des collaborateurs (superviseur) ---------------- */

  app.post('/api/collaborateurs/:id/compte', requireAuth, requireSuperviseur, async (req, res) => {
    try{
      const ctx = await chargerDonneesActives(req, res);
      if(!ctx) return;
      const collaborateurId = req.params.id;
      const col = ctx.donnees.collaborateurs.find(c => c.id === collaborateurId);
      if(!col) return res.status(404).json({ error: 'Collaborateur introuvable.' });
      const { email, motDePasse } = req.body || {};
      if(!emailValide(email)) return res.status(400).json({ error: 'Adresse email invalide.' });
      if(!motDePasse || String(motDePasse).length < 6) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });

      const emailLower = String(email).trim().toLowerCase();
      const existant = await comptes.findOne({ _id: emailLower });
      if(existant && existant.collaborateurId !== collaborateurId){
        return res.status(409).json({ error: 'Cette adresse email est déjà utilisée par un autre compte.' });
      }
      // si ce collaborateur avait déjà un compte sous une autre adresse, on le retire d'abord
      const ancien = await comptes.findOne({ cabinetId: req.session.cabinetId, collaborateurId });
      if(ancien && ancien._id !== emailLower) await comptes.deleteOne({ _id: ancien._id });

      const role = col.poste === 'Superviseur' ? 'superviseur' : 'agent';
      const motDePasseHash = await hasherMotDePasse(String(motDePasse));
      await comptes.updateOne(
        { _id: emailLower },
        { $set: { cabinetId: req.session.cabinetId, collaborateurId, role, motDePasseHash, creeLe: new Date() } },
        { upsert: true }
      );
      res.json({ ok: true, identifiant: emailLower, roleCompte: role });
    }catch(e){
      console.error('Erreur création compte collaborateur', e);
      res.status(500).json({ error: 'Erreur serveur lors de la création du compte.' });
    }
  });

  app.delete('/api/collaborateurs/:id/compte', requireAuth, requireSuperviseur, async (req, res) => {
    try{
      const collaborateurId = req.params.id;
      if(collaborateurId === req.session.collaborateurId){
        return res.status(400).json({ error: 'Vous ne pouvez pas retirer votre propre accès.' });
      }
      await comptes.deleteOne({ cabinetId: req.session.cabinetId, collaborateurId });
      res.json({ ok: true });
    }catch(e){
      console.error('Erreur suppression compte collaborateur', e);
      res.status(500).json({ error: 'Erreur serveur lors de la suppression du compte.' });
    }
  });

  return app;
}

module.exports = { creerApp, donneesParDefaut, filtrerDonneesPourAgent, fusionnerEcritureAgent };

/* Ce fichier ne contient plus de bloc de démarrage (app.listen) : c'est
   désormais server.js, à la racine du projet, qui construit la base de
   données (fichiers JSON ou MongoDB) et démarre le serveur, pour Render,
   pour un usage local ET pour Vercel — voir server.js et le README pour le
   pourquoi de ce choix (obligation de Vercel d'avoir un point d'entrée
   Express à la racine du projet). */
