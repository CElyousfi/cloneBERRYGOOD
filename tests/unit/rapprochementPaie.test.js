/*
 * rapprochementPaie.test.js
 *
 * Ce module existe pour répondre à UNE question : d'où vient l'écart entre le
 * fichier de paie et Smart Berry ? Sa valeur tient donc moins aux nombres qu'il
 * aligne qu'à ce qu'il en DIT — un écart de calcul se corrige, un désaccord de
 * données s'arbitre, et les confondre fait chercher un bug là où il n'y en a
 * pas.
 *
 * Les cas ci-dessous reprennent les mesures réelles des trois quinzaines de la
 * campagne 2026/2027 (2026-08-22).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const R = require(path.join(__dirname, '../../public/lib/rapprochementPaie.js'));

const BAREMES = { smagBrutJournalier: 97.44, tauxCnssSalariale: 0.0448, tauxAmo: 0.0226 };

/** Quinzaine 01 (01–15/07) : aucun jour férié, l'écart y est de 41 DH. */
function q01() {
  return {
    fichier: { jours: 1484, feries: 0, net: 153503, transport: 26325, sousTraitance: 7950 },
    quinzaine: {
      jours: 1484, netAPayer: 187737, joursFeries: 0,
      postes: { primeTransport: 26445, locationEngins: 7950 },
      sousPostes: { jourFerie: 0 },
    },
    baremes: BAREMES,
  };
}

test('comparer — la quinzaine SANS jour férié ne lève aucune alerte', () => {
  // LE TÉMOIN de tout le chantier : 41 DH d'écart sur 187 778, soit 0,02 %.
  // Si une correction future fait bouger CE chiffre, c'est qu'elle est fausse.
  //
  // ⚠️ Chaque colonne utilise SON PROPRE transport : 26 325 côté fichier,
  // 26 445 côté Smart Berry. Croiser les deux — ce que j'ai fait en première
  // lecture — donne 161 DH au lieu de 41, et fait chercher 120 DH imaginaires.
  const r = R.comparer(q01());
  assert.strictEqual(r.comparable, true);
  assert.strictEqual(Math.round(r.total.ecart), 41);
  assert.deepStrictEqual(r.alertes.map((a) => a.niveau), ['ok']);
});

test('comparer — le TOTAL reconstitue le périmètre des deux côtés', () => {
  // Mettre le « NET » du fichier (153 503) face au « Net à payer » de l'écran
  // (187 737) fabrique 34 000 DH d'écart qui n'existent pas : le premier ne
  // couvre que les salaires, le second y ajoute transport et sous-traitance.
  // C'est exactement l'erreur commise le 2026-08-22.
  const r = R.comparer(q01());
  assert.strictEqual(r.total.fichier, 153503 + 26325 + 7950);
  assert.strictEqual(r.total.smartBerry, 187737);
});

test('comparer — un écart de JOURS FÉRIÉS est signalé comme un ARBITRAGE, pas un bug', () => {
  // Mesure réelle du 14/08 : la paie paie 72 journées fériées, le pointage
  // BEE ONE en enregistre 39. Aucun code ne tranche ce désaccord.
  const a = q01();
  a.fichier.feries = 72;
  a.quinzaine.joursFeries = 39;
  const r = R.comparer(a);
  const alerte = r.alertes.find((x) => x.niveau === 'arbitrage');
  assert.ok(alerte, 'une alerte d\'arbitrage doit être levée');
  assert.match(alerte.texte, /33 journées fériées DE PLUS/);
  assert.match(alerte.texte, /décision RH/);
  // Et la ligne elle-même porte la nature, pour que l'écran puisse la traiter
  // autrement qu'un écart de calcul.
  const l = r.lignes.find((x) => x.cle === 'joursFeries');
  assert.strictEqual(l.nature, 'donnees');
});

test('comparer — un écart de JH bloque la lecture des montants', () => {
  // Deux totaux qui ne portent pas sur les mêmes journées ne se comparent pas.
  // L'alerte doit passer AVANT les autres.
  const a = q01();
  a.quinzaine.jours = 1400;
  const r = R.comparer(a);
  assert.strictEqual(r.alertes[0].niveau, 'bloquant');
  assert.match(r.alertes[0].texte, /AVANT/);
});

test('valeurFerieFichier — reconstitué au SMAG, avec la retenue', () => {
  // Le fichier n'isole pas le férié : il l'inclut dans le montant de l'ouvrier.
  // On le reconstitue comme la paie le fait — 97,44 × 0,9326.
  assert.strictEqual(Math.round(R.valeurFerieFichier(74, BAREMES)), 6725);
  assert.strictEqual(R.valeurFerieFichier(0, BAREMES), 0);
  // Barèmes absents : 0, jamais NaN — un NaN se propagerait dans tout le rapport.
  assert.strictEqual(R.valeurFerieFichier(74, null), 0);
});

test('comparer — l\'écart HORS férié est isolé et attribué au calcul', () => {
  // Le rapport doit répondre « une fois le férié mis de côté, que reste-t-il ? ».
  // Sans cette ligne, on impute au férié un écart qui vient d'ailleurs.
  const a = q01();
  a.fichier.feries = 74;
  a.quinzaine.joursFeries = 74;      // même nombre de journées des deux côtés…
  a.quinzaine.sousPostes.jourFerie = 0; // …mais Smart Berry ne les valorise pas
  a.fichier.net = 153503 + 6725;
  const r = R.comparer(a);
  const ferie = r.lignes.find((x) => x.cle === 'ferieDH');
  assert.strictEqual(Math.round(ferie.ecart), 6725);
  // L'écart total étant intégralement expliqué par le férié, aucune alerte de
  // calcul résiduel ne doit être levée.
  assert.ok(!r.alertes.some((x) => x.niveau === 'calcul'));
});

test('comparer — sous-postes absents : `null`, jamais 0', () => {
  // Un instantané enregistré avant l'ajout des sous-postes n'a pas de férié.
  // Afficher 0 ferait lire « Smart Berry ne valorise pas le férié » alors que
  // l'information est simplement absente.
  const a = q01();
  delete a.quinzaine.sousPostes;
  delete a.quinzaine.joursFeries;
  const r = R.comparer(a);
  assert.strictEqual(r.lignes.find((x) => x.cle === 'ferieDH').smartBerry, null);
  assert.strictEqual(r.lignes.find((x) => x.cle === 'joursFeries').smartBerry, null);
  // Un écart indéterminé reste `null` : on ne soustrait pas une valeur absente.
  assert.strictEqual(r.lignes.find((x) => x.cle === 'ferieDH').ecart, null);
});

test('comparer — sans fichier ou sans instantané : `comparable: false`', () => {
  // Rendre un rapport vide se lirait « tout concorde ».
  assert.strictEqual(R.comparer({ quinzaine: {} }).comparable, false);
  assert.strictEqual(R.comparer({ fichier: {} }).comparable, false);
  assert.strictEqual(R.comparer(null).comparable, false);
});

test('la SOUS-TRAITANCE vient du FICHIER, pas empruntée à Smart Berry', () => {
  // Le fichier la porte sur sa feuille « TRSP MARCHANDISE & Divers » — 7 950 DH
  // sur la Q01, exactement le montant de Smart Berry. L'écran affichait « — » et
  // EMPRUNTAIT le chiffre de Smart Berry pour composer le total du fichier : le
  // résultat tombait juste, mais un chiffre emprunté à celui qu'on contrôle ne
  // contrôle plus rien.
  const l = R.comparer(q01()).lignes.find((x) => x.cle === 'location');
  assert.strictEqual(l.nature, 'calcul');
  assert.strictEqual(l.fichier, 7950);
  assert.strictEqual(l.smartBerry, 7950);
  assert.strictEqual(l.ecart, 0);
});

test('sous-traitance NON LUE : on emprunte Smart Berry, mais on le DIT', () => {
  // Un fichier sans la feuille ne doit pas faire chuter le total de plusieurs
  // milliers de dirhams et afficher un écart qui n'existe pas. On retombe donc
  // sur Smart Berry — en le signalant dans le libellé ET dans la nature.
  const a = q01();
  a.fichier.sousTraitance = null;
  const r = R.comparer(a);
  const l = r.lignes.find((x) => x.cle === 'location');
  assert.strictEqual(l.nature, 'info');
  assert.strictEqual(l.fichier, null);
  assert.match(l.libelle, /non lue/);
  // Le total reste juste : il emprunte les 7 950 de Smart Berry.
  assert.strictEqual(r.total.fichier, 153503 + 26325 + 7950);
});

test('une sous-traitance DIFFÉRENTE ressort en écart', () => {
  // Zéro n'est pas « absent » : une quinzaine sans prestataire est une
  // information, et un désaccord sur ce poste doit se voir.
  const a = q01();
  a.fichier.sousTraitance = 6000;
  const r = R.comparer(a);
  assert.strictEqual(r.lignes.find((x) => x.cle === 'location').ecart, 6000 - 7950);
  assert.strictEqual(r.total.fichier, 153503 + 26325 + 6000);
});
