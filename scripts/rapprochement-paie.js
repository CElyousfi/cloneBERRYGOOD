#!/usr/bin/env node
/*
 * rapprochement-paie.js — le tableau à TROIS VOIES.
 *
 *   Excel (la vérité, c'est lui qui paie)  ↔  écran Quinzaine  ↔  écran Campagne
 *
 * Ces trois calculs doivent donner le même coût de main d'œuvre. Ce script les
 * met côte à côte, poste par poste, quinzaine par quinzaine, et nomme l'écart.
 *
 * ── LECTURE SEULE, SANS EXCEPTION ──────────────────────────────────────────
 * Aucune écriture Firestore. Aucun fichier de paie copié dans le dépôt : ils
 * portent la paie nominative de 250 personnes et sont lus en mémoire.
 *
 * ── POURQUOI UN SCRIPT PLUTÔT QU'UN ÉCRAN ──────────────────────────────────
 * Parce qu'on ne sait pas encore ce que l'écran devrait montrer. Quatre
 * diagnostics successifs de l'écart se sont révélés faux — tous produits en
 * raisonnant sur le code au lieu de lire les données. Ce script est
 * l'instrument de mesure ; l'écran (Lot 3, docs/spec-rapprochement-paie-quinzaine.md)
 * viendra quand les règles seront établies, et réutilisera le même module
 * d'extraction.
 *
 * USAGE
 *   node scripts/rapprochement-paie.js <fichier.xlsx> [autre.xlsx …]
 *   node scripts/rapprochement-paie.js ~/Desktop/pointage*.xlsx
 *
 * PRÉREQUIS : `gcloud auth print-access-token` doit répondre (accès Firestore
 * en lecture). Le script le dit clairement s'il ne peut pas lire.
 */
'use strict';

const path = require('node:path');
const https = require('node:https');
const { execSync } = require('node:child_process');

const RACINE = path.join(__dirname, '..');
const XLSX = require(path.join(RACINE, 'node_modules/xlsx'));
const lecture = require(path.join(RACINE, 'functions/lib/paie/lecturePaieExcel.js'));
const coutOuvrier = require(path.join(RACINE, 'functions/lib/paie/coutOuvrierCampagne.js'));

const PROJET = 'berrygood-farms-dashboard';
const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJET
  + '/databases/(default)/documents';

// ─────────────────────────── Firestore, en lecture ─────────────────────────

let JETON = null;
function jeton() {
  if (JETON) return JETON;
  try {
    JETON = execSync('gcloud auth print-access-token', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch (e) {
    throw new Error(
      'Impossible d\'obtenir un jeton Google. Lance :  gcloud auth login\n'
      + '(Le script lit Firestore ; il n\'écrit jamais.)'
    );
  }
  if (!JETON) throw new Error('Jeton Google vide — relance `gcloud auth login`.');
  return JETON;
}

function requete(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: 'Bearer ' + jeton() } }, (r) => {
      let corps = '';
      r.on('data', (d) => { corps += d; });
      r.on('end', () => {
        try { resolve(JSON.parse(corps)); } catch (e) { reject(new Error('Réponse illisible : ' + corps.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

/** Convertit une valeur Firestore REST en valeur JS. */
function valeur(v) {
  if (!v || typeof v !== 'object') return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valeur);
  if ('mapValue' in v) {
    const o = {};
    Object.entries(v.mapValue.fields || {}).forEach(([k, x]) => { o[k] = valeur(x); });
    return o;
  }
  return undefined;
}

function champs(doc) {
  const o = {};
  Object.entries((doc && doc.fields) || {}).forEach(([k, v]) => { o[k] = valeur(v); });
  return o;
}

async function lireDoc(chemin) {
  const d = await requete(BASE + '/' + chemin);
  if (d && d.error) return null;
  return d && d.fields ? champs(d) : null;
}

async function lireCollection(nom) {
  const out = [];
  let token = null;
  do {
    const d = await requete(BASE + '/' + nom + '?pageSize=300' + (token ? '&pageToken=' + token : ''));
    if (d && d.error) throw new Error('Lecture ' + nom + ' refusée : ' + d.error.message);
    (d.documents || []).forEach((doc) => {
      const o = champs(doc);
      o._id = doc.name.split('/').pop();
      out.push(o);
    });
    token = d.nextPageToken;
  } while (token);
  return out;
}

// ─────────────────────────── Lecture des classeurs ─────────────────────────

/** Feuille → grille de cellules (tableau de tableaux), cases vides à `null`. */
function grille(classeur, nomFeuille) {
  const ws = classeur.Sheets[nomFeuille];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}

/** Retrouve une feuille par son nom, en tolérant espaces et casse. */
function feuille(classeur, ...noms) {
  for (const n of noms) {
    const trouve = classeur.SheetNames.find(
      (s) => lecture.normaliserLibelle(s) === lecture.normaliserLibelle(n)
    );
    if (trouve) return trouve;
  }
  return null;
}

function lireClasseur(fichier) {
  const wb = XLSX.readFile(fichier, { cellDates: false });
  const nP = feuille(wb, 'POINTAGE');
  const nS = feuille(wb, 'SANS CNSS');
  const nT = feuille(wb, 'TRANSPORT');
  if (!nP || !nS) {
    throw new Error('Feuilles POINTAGE / SANS CNSS introuvables dans ' + path.basename(fichier));
  }
  const gP = grille(wb, nP);
  const gS = grille(wb, nS);
  const pointage = lecture.lireFeuilleOuvriers(gP);
  const sansCnss = lecture.lireFeuilleOuvriers(gS);
  const transport = nT ? lecture.lireTransport(grille(wb, nT)) : { total: 0, places: 0, equipes: [] };
  // La quinzaine se lit DANS la feuille, jamais dans le nom du fichier (NFD).
  const periode = lecture.periodeDeGrille(gP) || lecture.periodeDeGrille(gS);
  return {
    fichier: path.basename(fichier),
    periode,
    postes: lecture.postesExcel({ pointage, sansCnss, transport }),
  };
}

// ─────────────────────────── Le calcul CAMPAGNE ────────────────────────────

/** Toutes les dates ISO d'une période, bornes comprises. */
function datesEntre(debut, fin) {
  const out = [];
  const d = new Date(debut + 'T00:00:00Z');
  const f = new Date(fin + 'T00:00:00Z');
  while (d <= f) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Recalcule le coût de campagne pour UNE quinzaine, avec les mêmes entrées que
 * la Cloud Function. Les primes de terrain (traitement, conditionnement,
 * chargement, récolte) ne sont PAS reconstituées ici : le script le DIT plutôt
 * que de laisser croire à un total complet.
 */
async function campagnePourPeriode(periode, registre, baremes, equipesTransport) {
  const parOuvrier = {};
  const dates = datesEntre(periode.debut, periode.fin);
  for (const d of dates) {
    const doc = await lireDoc('sql_mirror_pointage/' + d);
    if (!doc) continue;
    coutOuvrier.cumuleJournee(parOuvrier, doc.rows || [], d);
  }
  const out = coutOuvrier.coutOuvrierCampagne({
    quinzaines: [{ periode: 'X', dateFin: periode.fin, parOuvrier }],
    registre, baremes, equipesTransport,
  });
  return out.parQuinzaine[0];
}

// ─────────────────────────── Rendu ─────────────────────────────────────────

const nombre = (v) => (isFinite(Number(v)) ? Number(v) : 0);
const dh = (v) => (Math.round(Number(v) || 0)).toLocaleString('fr-MA');
const j = (v) => (Math.round((Number(v) || 0) * 10) / 10).toLocaleString('fr-MA');

function tableau(titre, colonnes, lignes) {
  const larg = colonnes.map((c, i) => Math.max(
    c.length, ...lignes.map((l) => String(l[i] === undefined ? '' : l[i]).length)
  ));
  const ligne = (cells) => cells
    .map((c, i) => (i === 0 ? String(c).padEnd(larg[i]) : String(c).padStart(larg[i])))
    .join('  ');
  console.log('\n' + titre);
  console.log(ligne(colonnes));
  console.log(larg.map((n) => '─'.repeat(n)).join('  '));
  lignes.forEach((l) => console.log(ligne(l)));
}

function ecart(a, b) {
  if (a === null || b === null) return '—';
  const d = Math.round(a - b);
  return (d > 0 ? '+' : '') + d.toLocaleString('fr-MA');
}

// ─────────────────────────── Programme ─────────────────────────────────────

async function principal() {
  const fichiers = process.argv.slice(2).filter((f) => /\.xlsx$/i.test(f)
    && !path.basename(f).startsWith('~$'));
  if (!fichiers.length) {
    console.error('Usage : node scripts/rapprochement-paie.js <fichier.xlsx> [...]');
    process.exit(2);
  }

  console.log('Lecture des fichiers de paie…');
  const classeurs = fichiers.map(lireClasseur)
    .filter((c) => { if (!c.periode) console.warn('  ⚠️  période illisible : ' + c.fichier); return c.periode; })
    .sort((a, b) => (a.periode.debut < b.periode.debut ? -1 : 1));

  console.log('Lecture Firestore (instantanés, registre, barèmes, transport)…');
  const [snapsBruts, registreBrut, baremesDoc, transportDoc] = await Promise.all([
    lireCollection('rh_cout_quinzaine'),
    lireCollection('ouvriers_registry'),
    lireDoc('app_settings/paie_baremes'),
    lireDoc('rh_config/transport_primes'),
  ]);
  const baremes = baremesDoc || {};
  const equipesTransport = (transportDoc && transportDoc.equipes) || [];
  const registre = {};
  registreBrut.forEach((r) => { registre[coutOuvrier.cleRegistre(r._id)] = r; });
  console.log('  registre : ' + registreBrut.length + ' fiches | instantanés : '
    + snapsBruts.length + ' | équipes transport : ' + equipesTransport.length);

  // Les instantanés portent un LIBELLÉ de quinzaine, les fichiers des DATES.
  // On les apparie par les JH, seul point commun fiable — un libellé
  // « Quinzaine 01 » ne dit pas à quelles dates il correspond.
  const parJours = {};
  snapsBruts.forEach((s) => { parJours[Math.round(Number(s.jours) || 0)] = s; });

  const resultats = [];
  for (const c of classeurs) {
    const snap = parJours[Math.round(c.postes.jours)] || null;
    const camp = await campagnePourPeriode(c.periode, registre, baremes, equipesTransport);
    resultats.push({ c, snap, camp });
  }

  // ── Vue d'ensemble ──
  tableau(
    '═══ VUE D\'ENSEMBLE — coût employeur ═══',
    ['Quinzaine', 'JH Excel', 'JH Quinz.', 'Excel net', 'Quinzaine', 'Campagne', 'Δ Q−C'],
    resultats.map(({ c, snap, camp }) => [
      c.periode.debut + ' → ' + c.periode.fin,
      j(c.postes.jours),
      snap ? j(snap.jours) : '—',
      dh(c.postes.net),
      snap ? dh(snap.coutEmployeur) : '—',
      dh(camp.coutTotal),
      snap ? ecart(snap.coutEmployeur, camp.coutTotal) : '—',
    ])
  );

  // ── Poste par poste ──
  resultats.forEach(({ c, snap, camp }) => {
    const p = c.postes;
    const s = (snap && snap.postes) || {};
    const cp = camp.postes || {};
    const lignes = [
      ['Journées (JH)', j(p.jours), snap ? j(snap.jours) : '—', j(camp.jh)],
      ['Jours fériés', j(p.feries), s.joursFeries === undefined ? '?' : j(s.joursFeries), '?'],
      ['Ancienneté', dh(p.anciennete), '—', dh(cp.primeAnciennete)],
      ['Prime fonction (brut fichier*)', dh(p.primeFonctionBrut), '—', dh(cp.primeFonction)],
      ['Transport', dh(p.transport), s.primeTransport === undefined ? '—' : dh(s.primeTransport), dh(cp.transport)],
      ['Brut salaires', dh(p.brut), '—', '—'],
      ['NET salaires', dh(p.net), '—', '—'],
    ];
    // LA comparaison à périmètre égal. Le « NET versé » du fichier ne couvre que
    // les salaires ; le « Net à payer » de la Quinzaine y ajoute le transport et
    // la sous-traitance. Les mettre face à face sans recomposer le périmètre
    // fabrique un écart de 34 000 DH qui n'existe pas — c'est exactement ce qui
    // est arrivé le 2026-08-22.
    if (snap) {
      const recompose = p.net + nombre(s.primeTransport) + nombre(s.locationEngins);
      lignes.push(['— net + transport + L&E', dh(recompose), dh(snap.netAPayer),
        ecart(recompose, snap.netAPayer)]);
    }
    tableau(
      '─── ' + c.periode.debut + ' → ' + c.periode.fin + '  (' + c.fichier + ')',
      ['Poste', 'Excel', 'Quinzaine', 'Campagne / Δ'],
      lignes
    );
    console.log('   * « Prime Fonction Brut » du fichier agrège fonction + heures sup + traitement.');
    console.log('   Populations fichier : ' + p.effectifDeclaresPurs + ' déclarés purs, '
      + p.effectifNonDeclaresPurs + ' non-déclarés purs, ' + p.mixtes.length
      + ' MIXTES (présents sur les deux feuilles).');
    // Les primes de terrain ne sont pas reconstituées par ce script : le dire,
    // plutôt que de laisser lire le total « Campagne » comme un total complet.
    console.log('   ⚠️  Campagne recalculée SANS les primes de terrain (traitement, '
      + 'conditionnement, chargement, récolte) ni les jours fériés : son total est '
      + 'un PLANCHER.');
  });

  console.log('\nAucune écriture effectuée.');
}

principal().catch((e) => {
  console.error('\n🛑 ' + e.message);
  process.exit(1);
});
