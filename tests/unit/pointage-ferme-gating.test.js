'use strict';

// GATING PAIE (Étape 0) — cloisonnement chef par ferme sur les 4 actions
// nominatives de pointageRH (detail / postes-fixes / heures-sup / recolte-equipes).
//
// Ces tests couvrent la LOGIQUE DE FILTRAGE PURE partagée par les 4 helpers de
// niveau module (filterMirrorRowsByFerme sur lignes brutes du mirror, avant
// agrégation ; filterByFermeField sur payloads déjà porteurs d'un champ `ferme`).
// Ils asservissent la garantie sécurité : pour un chef F1, aucune ligne d'une
// autre ferme (ni 'Autre') ne peut sortir, et fermeFilter=null (RH/DG/Finance)
// laisse tout passer (comportement inchangé). Rows factices — zéro Firestore.

const test = require('node:test');
const assert = require('node:assert');

const {
  filterMirrorRowsByFerme,
  filterByFermeField,
  filterArchivedRowsByFerme,
  filterArchivedParFerme,
  filterArchivedParJour,
  recomposeArchivedTotals,
  filterReposWorkersArchived,
  computeAllowedMatricules,
  filterPresenceRowsByAllowed,
  filterProdRowsByFerme,
  recomposeProdTotalKg,
  deriveFerme,
} = require('../../functions/src/modules/rh/pointageService');

// --- Fixtures : lignes brutes du mirror (mêmes champs que sql_mirror_pointage) ---
// F1 : Ref_parcelle 'F1...'/'0032' ; F5 : 'F5...' ; Avocatier : 'F2...' ; BAHIA : ref bahia.
// 'Autre' : ref non mappable → deriveFerme() = 'Autre' (doit être exclu, fail-closed).
const rawMirrorRows = [
  { Personnel_Matricule: 'A1', Personnel_Nom: 'Alice', Ref_parcelle: 'F1-01', Parcelle_Culturale: 'S1', Operation_Famille: '8. Récolte', Cout: 100 },
  { Personnel_Matricule: 'A2', Personnel_Nom: 'Adam', Ref_parcelle: '0032', Parcelle_Culturale: '', Operation_Famille: '11. Postes fixes', Cout: 50 },
  { Personnel_Matricule: 'B1', Personnel_Nom: 'Bob', Ref_parcelle: 'F5-03', Parcelle_Culturale: 'S9', Operation_Famille: '8. Récolte', Cout: 200 },
  { Personnel_Matricule: 'C1', Personnel_Nom: 'Chloe', Ref_parcelle: 'F2-01', Parcelle_Culturale: '', Operation_Famille: '11. Postes fixes', Cout: 70 },
  { Personnel_Matricule: 'D1', Personnel_Nom: 'Driss', Ref_parcelle: 'BAHIA-01', Parcelle_Culturale: '', Operation_Famille: '8. Récolte', Cout: 90 },
  { Personnel_Matricule: 'Z1', Personnel_Nom: 'Zed', Ref_parcelle: 'XXX-999', Parcelle_Culturale: 'inconnue', Operation_Famille: '8. Récolte', Cout: 10 },
];

test('deriveFerme mappe correctement F1/F5/Avocatier/BAHIA et retourne Autre sinon', () => {
  assert.strictEqual(deriveFerme('F1-01', 'S1'), 'F1');
  assert.strictEqual(deriveFerme('0032', ''), 'F1');
  assert.strictEqual(deriveFerme('F5-03', 'S9'), 'F5');
  assert.strictEqual(deriveFerme('F2-01', ''), 'Avocatier');
  assert.strictEqual(deriveFerme('BAHIA-01', ''), 'BAHIA');
  assert.strictEqual(deriveFerme('XXX-999', 'inconnue'), 'Autre');
});

test('filterMirrorRowsByFerme(F1) ne renvoie QUE F1 et exclut Autre + autres fermes', () => {
  const out = filterMirrorRowsByFerme(rawMirrorRows, 'F1');
  const mats = out.map(r => r.Personnel_Matricule).sort();
  assert.deepStrictEqual(mats, ['A1', 'A2']);
  // Aucune ligne d'une autre ferme ni 'Autre'
  for (const r of out) {
    assert.strictEqual(deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), 'F1');
  }
  assert.ok(!out.some(r => r.Personnel_Matricule === 'Z1'), 'Autre (Z1) doit être exclu (fail-closed)');
});

test('filterMirrorRowsByFerme(BAHIA) isole BAHIA sans fuite Avocatier', () => {
  const out = filterMirrorRowsByFerme(rawMirrorRows, 'BAHIA');
  assert.deepStrictEqual(out.map(r => r.Personnel_Matricule), ['D1']);
});

test('filterMirrorRowsByFerme(null) = passthrough (RH/DG/Finance = toutes fermes, inchangé)', () => {
  const out = filterMirrorRowsByFerme(rawMirrorRows, null);
  assert.strictEqual(out.length, rawMirrorRows.length);
  assert.strictEqual(out, rawMirrorRows);
});

test('filterMirrorRowsByFerme gère rows null/undefined sans crash', () => {
  assert.deepStrictEqual(filterMirrorRowsByFerme(null, 'F1'), []);
  assert.deepStrictEqual(filterMirrorRowsByFerme(undefined, null), []);
});

// --- filterByFermeField : payloads déjà agrégés/enrichis (snapshots, recolte SQL) ---
const enrichedRows = [
  { matricule: 'A1', ferme: 'F1', kg: 12 },
  { matricule: 'B1', ferme: 'F5', kg: 30 },
  { matricule: 'D1', ferme: 'BAHIA', kg: 8 },
  { matricule: 'Z1', ferme: 'Autre', kg: 1 },
  { matricule: 'N1', ferme: null, kg: 5 },
];

test('filterByFermeField(F1) ne garde que ferme==="F1" (exclut Autre/null/autres)', () => {
  const out = filterByFermeField(enrichedRows, 'F1');
  assert.deepStrictEqual(out.map(r => r.matricule), ['A1']);
});

test('filterByFermeField(null) = passthrough inchangé', () => {
  assert.strictEqual(filterByFermeField(enrichedRows, null), enrichedRows);
});

// --- Garantie par ACTION nominative : pour un chef F1, chaque helper filtre ses
// lignes brutes AVANT agrégation → aucune ligne d'une autre ferme ne peut sortir. ---

test('action=detail (fetchDetailFromMirror) : chef F1 → aucune ligne hors F1', () => {
  // fetchDetailFromMirror applique filterMirrorRowsByFerme(rows, fermeFilter) puis map.
  const kept = filterMirrorRowsByFerme(rawMirrorRows, 'F1');
  assert.ok(kept.length > 0);
  assert.ok(kept.every(r => deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) === 'F1'));
});

test('action=postes-fixes (fetchPostesFixesFromMirror) : chef F1 → seulement postes fixes F1', () => {
  const kept = filterMirrorRowsByFerme(rawMirrorRows, 'F1')
    .filter(r => r.Operation_Famille === '11. Postes fixes');
  assert.deepStrictEqual(kept.map(r => r.Personnel_Matricule), ['A2']);
  assert.ok(!kept.some(r => r.Personnel_Matricule === 'C1'), 'poste fixe Avocatier (C1) exclu');
});

test('action=recolte-equipes (computeRecolteEquipesPayload) : chef F1 → récolte F1 uniquement', () => {
  // Le helper filtre les lignes brutes par ferme AVANT groupement matricule/jour.
  const kept = filterMirrorRowsByFerme(rawMirrorRows, 'F1')
    .filter(r => r.Operation_Famille === '8. Récolte');
  assert.deepStrictEqual(kept.map(r => r.Personnel_Matricule), ['A1']);
  assert.ok(!kept.some(r => ['B1', 'D1', 'Z1'].includes(r.Personnel_Matricule)));
});

test('action=heures-sup (buildHeuresSup) : set matricules autorisés = ceux ayant pointé F1', () => {
  // buildHeuresSup dérive allowedMatricules depuis les lignes mirror filtrées F1,
  // puis restreint prod_presence à ce set (prod_presence n'a pas de parcelle).
  const keptF1 = filterMirrorRowsByFerme(rawMirrorRows, 'F1');
  const allowed = new Set(keptF1.map(r => String(r.Personnel_Matricule).toUpperCase()));
  assert.deepStrictEqual([...allowed].sort(), ['A1', 'A2']);
  // Une ligne présence d'un ouvrier F5 (B1) ne doit PAS être autorisée pour le chef F1.
  assert.ok(!allowed.has('B1'));
  assert.ok(!allowed.has('Z1'), 'ouvrier Autre non autorisé (fail-closed)');
});

// =====================================================================
// TROU 1 — action=presence : cloisonnement via allowedMatricules dérivés
// du mirror (prod_presence n'a pas de parcelle). Champ presence = `matricule`.
// =====================================================================

test('computeAllowedMatricules(F1) = matricules UPPERCASE ayant pointé F1', () => {
  const allowed = computeAllowedMatricules(rawMirrorRows, 'F1');
  assert.deepStrictEqual([...allowed].sort(), ['A1', 'A2']);
});

test('computeAllowedMatricules(null) = null (RH/DG/Finance → passthrough)', () => {
  assert.strictEqual(computeAllowedMatricules(rawMirrorRows, null), null);
});

// Lignes prod_presence : champ `matricule` (minuscule), pas de parcelle.
const presenceRows = [
  { matricule: 'A1', nom: 'Alice', heureEntree: '07:00', heureSortie: '17:00' },
  { matricule: 'A2', nom: 'Adam', heureEntree: '07:30', heureSortie: '16:00' },
  { matricule: 'B1', nom: 'Bob', heureEntree: '08:00', heureSortie: '18:00' }, // F5
  { matricule: 'D1', nom: 'Driss', heureEntree: '06:00', heureSortie: '15:00' }, // BAHIA
  { matricule: 'P9', nom: 'Présent-jamais-pointé', heureEntree: '07:00', heureSortie: '17:00' },
];

test('action=presence : chef F1 → seuls les matricules ayant pointé F1 (exclut les autres)', () => {
  const allowed = computeAllowedMatricules(rawMirrorRows, 'F1');
  const out = filterPresenceRowsByAllowed(presenceRows, allowed);
  assert.deepStrictEqual(out.map(r => r.matricule).sort(), ['A1', 'A2']);
  // B1 (F5), D1 (BAHIA) exclus ; P9 présent mais jamais pointé → exclu (fail-closed).
  assert.ok(!out.some(r => ['B1', 'D1', 'P9'].includes(r.matricule)));
});

test('action=presence : chef BAHIA → uniquement D1', () => {
  const allowed = computeAllowedMatricules(rawMirrorRows, 'BAHIA');
  const out = filterPresenceRowsByAllowed(presenceRows, allowed);
  assert.deepStrictEqual(out.map(r => r.matricule), ['D1']);
});

test('action=presence : RH/DG/Finance (null) → toutes les rows (inchangé)', () => {
  const allowed = computeAllowedMatricules(rawMirrorRows, null); // null
  const out = filterPresenceRowsByAllowed(presenceRows, allowed);
  assert.strictEqual(out, presenceRows);
});

test('filterPresenceRowsByAllowed est insensible à la casse du matricule', () => {
  const allowed = new Set(['A1']);
  const out = filterPresenceRowsByAllowed([{ matricule: 'a1' }, { matricule: 'B1' }], allowed);
  assert.deepStrictEqual(out.map(r => r.matricule), ['a1']);
});

test('filterPresenceRowsByAllowed gère rows null sans crash', () => {
  assert.deepStrictEqual(filterPresenceRowsByAllowed(null, new Set(['A1'])), []);
});

// =====================================================================
// TROU 2 — mo-analytique-variete / campagne-mo-variete : chemin ARCHIVÉ
// (quinzaine_archive.analytique) cloisonné par ferme dérivée (parcelle/refParcelle).
// =====================================================================

// Lignes archivées : agrégées par parcelle/opération (non nominatives), avec jh/cout.
const archivedRows = [
  { parcelle: 'S1', refParcelle: 'F1-01', operationFamille: '8. Récolte', jh: 10, cout: 1000 },
  { parcelle: '', refParcelle: '0032', operationFamille: '11. Postes fixes', jh: 5, cout: 500 }, // F1
  { parcelle: 'S9', refParcelle: 'F5-03', operationFamille: '8. Récolte', jh: 8, cout: 800 }, // F5
  { parcelle: '', refParcelle: 'F2-01', operationFamille: '8. Récolte', jh: 6, cout: 600 }, // Avocatier
  { parcelle: '', refParcelle: 'BAHIA-01', operationFamille: '8. Récolte', jh: 4, cout: 400 }, // BAHIA
  { parcelle: 'inconnue', refParcelle: 'XXX-999', operationFamille: '8. Récolte', jh: 1, cout: 100 }, // Autre
];

test('mo-analytique archivé : chef F1 → seule sa ferme (exclut F5/Avocatier/BAHIA/Autre)', () => {
  const out = filterArchivedRowsByFerme(archivedRows, 'F1');
  assert.deepStrictEqual(out.map(r => r.refParcelle).sort(), ['0032', 'F1-01']);
  for (const r of out) assert.strictEqual(deriveFerme(r.refParcelle, r.parcelle), 'F1');
});

test('mo-analytique archivé : chef Avocatier → uniquement F2-01', () => {
  const out = filterArchivedRowsByFerme(archivedRows, 'Avocatier');
  assert.deepStrictEqual(out.map(r => r.refParcelle), ['F2-01']);
});

test('mo-analytique archivé : RH/DG/Finance (null) → tout (passthrough inchangé)', () => {
  const out = filterArchivedRowsByFerme(archivedRows, null);
  assert.strictEqual(out, archivedRows);
});

test('filterArchivedRowsByFerme exclut Autre (fail-closed) et gère rows null', () => {
  const out = filterArchivedRowsByFerme(archivedRows, 'F1');
  assert.ok(!out.some(r => r.refParcelle === 'XXX-999'));
  assert.deepStrictEqual(filterArchivedRowsByFerme(null, 'F1'), []);
  assert.deepStrictEqual(filterArchivedRowsByFerme(undefined, null), []);
});

// =====================================================================
// TROU — action=quinzaine (chemin ARCHIVÉ summary.parFerme / parJour / totaux).
// L'archive stocke des agrégats TOUTES fermes → un chef ne doit voir QUE sa ferme.
// =====================================================================

const archSummary = {
  totalJournees: 100,
  totalCout: 10000,
  parFerme: [
    { ferme: 'F1', journees: 40, cout: 4000, recolte: 30, horsRecolte: 8, postesFixes: 2 },
    { ferme: 'F5', journees: 30, cout: 3000, recolte: 20, horsRecolte: 8, postesFixes: 2 },
    { ferme: 'Avocatier', journees: 20, cout: 2000, recolte: 15, horsRecolte: 4, postesFixes: 1 },
    { ferme: 'BAHIA', journees: 10, cout: 1000, recolte: 8, horsRecolte: 1, postesFixes: 1 },
  ],
  parJour: [
    { jour: '2026-05-01', jourLabel: 'jeu 1 mai', nbOuv: 50, journees: 50, cout: 5000, F1: 20, F5: 15, Avocatier: 10, BAHIA: 5 },
    { jour: '2026-05-02', jourLabel: 'ven 2 mai', nbOuv: 50, journees: 50, cout: 5000, F1: 20, F5: 15, Avocatier: 10, BAHIA: 5 },
  ],
};

test('quinzaine archivé : chef F1 → parFerme = uniquement F1', () => {
  const out = filterArchivedParFerme(archSummary.parFerme, 'F1');
  assert.deepStrictEqual(out.map(e => e.ferme), ['F1']);
  assert.strictEqual(out[0].cout, 4000);
});

test('quinzaine archivé : chef F1 → parJour ne révèle QUE le nbOuv F1, journees/cout=0', () => {
  const out = filterArchivedParJour(archSummary.parJour, 'F1');
  assert.strictEqual(out.length, 2);
  for (const d of out) {
    assert.strictEqual(d.nbOuv, 20);       // compte F1
    assert.strictEqual(d.F1, 20);
    assert.strictEqual(d.F5, 0);           // autres fermes masquées
    assert.strictEqual(d.Avocatier, 0);
    assert.strictEqual(d.BAHIA, 0);
    assert.strictEqual(d.journees, 0);     // non ventilable par ferme → fail-closed
    assert.strictEqual(d.cout, 0);
  }
});

test('quinzaine archivé : chef F1 → totaux recomposés depuis SA ferme uniquement', () => {
  const parFerme = filterArchivedParFerme(archSummary.parFerme, 'F1');
  const totals = recomposeArchivedTotals(parFerme, archSummary, 'F1');
  assert.strictEqual(totals.totalJournees, 40);
  assert.strictEqual(totals.totalCout, 4000);
});

test('quinzaine archivé : chef BAHIA → isole BAHIA sans fuite Avocatier', () => {
  const parFerme = filterArchivedParFerme(archSummary.parFerme, 'BAHIA');
  assert.deepStrictEqual(parFerme.map(e => e.ferme), ['BAHIA']);
  const totals = recomposeArchivedTotals(parFerme, archSummary, 'BAHIA');
  assert.strictEqual(totals.totalCout, 1000);
  const parJour = filterArchivedParJour(archSummary.parJour, 'BAHIA');
  assert.ok(parJour.every(d => d.Avocatier === 0 && d.F1 === 0));
});

test('quinzaine archivé : RH/DG/Finance (null) → parFerme/parJour/totaux INCHANGÉS', () => {
  assert.strictEqual(filterArchivedParFerme(archSummary.parFerme, null), archSummary.parFerme);
  assert.strictEqual(filterArchivedParJour(archSummary.parJour, null), archSummary.parJour);
  const totals = recomposeArchivedTotals(archSummary.parFerme, archSummary, null);
  assert.strictEqual(totals.totalJournees, 100);
  assert.strictEqual(totals.totalCout, 10000);
});

// =====================================================================
// TROU — action=quinzaine-repos (chemin ARCHIVÉ reposData.workers, NOMINATIF).
// Aucune source ferme dans l'archive → fail-closed : workers vidé pour un chef.
// =====================================================================

const reposWorkers = [
  { matricule: 'A1', nom: 'Alice', joursPresent: ['2026-05-01'] },
  { matricule: 'B1', nom: 'Bob', joursPresent: ['2026-05-01', '2026-05-02'] },
  { matricule: 'D1', nom: 'Driss', joursPresent: ['2026-05-02'] },
];

test('quinzaine-repos archivé : chef F1 → AUCUN worker (fail-closed, zéro fuite nominative)', () => {
  const out = filterReposWorkersArchived(reposWorkers, 'F1');
  assert.deepStrictEqual(out, []);
  // Garantie centrale : aucun nom d'une autre ferme (ni de la sienne) n'est exposé
  // depuis une période archivée à un chef.
  assert.ok(!out.some(w => ['A1', 'B1', 'D1'].includes(w.matricule)));
});

test('quinzaine-repos archivé : chef BAHIA → AUCUN worker', () => {
  assert.deepStrictEqual(filterReposWorkersArchived(reposWorkers, 'BAHIA'), []);
});

test('quinzaine-repos archivé : RH/DG/Finance (null) → tous les workers (inchangé)', () => {
  assert.strictEqual(filterReposWorkersArchived(reposWorkers, null), reposWorkers);
});

test('filterReposWorkersArchived gère workers null sans crash', () => {
  assert.deepStrictEqual(filterReposWorkersArchived(null, null), []);
  assert.deepStrictEqual(filterReposWorkersArchived(undefined, 'F1'), []);
});

// =====================================================================
// TROU — action=quinzaine-analytique (chemin ARCHIVÉ .analytique) : réutilise
// filterArchivedRowsByFerme (rows portent parcelle/refParcelle).
// =====================================================================

test('quinzaine-analytique archivé : chef F5 → uniquement les parcelles F5', () => {
  const out = filterArchivedRowsByFerme(archivedRows, 'F5');
  assert.deepStrictEqual(out.map(r => r.refParcelle), ['F5-03']);
  assert.ok(!out.some(r => ['F1-01', '0032', 'F2-01', 'BAHIA-01', 'XXX-999'].includes(r.refParcelle)));
});

// =====================================================================
// FUITE SQL FALLBACK — chemins SQL (recordset brut) des actions pointageRH.
// Correction sécurité : chaque chemin SQL fallback chef-reachable filtre les
// LIGNES BRUTES par ferme AVANT agrégation (comme le chemin mirror shadowé), ou
// fail-closed quand la ferme n'est pas dérivable. Ces tests reproduisent la
// forme des recordsets SQL et prouvent le cloisonnement pour un chef F1 et le
// passthrough strict pour RH/DG/Finance (fermeFilter null).
// =====================================================================

// --- Recordset SQL brut « quinzaine » (chemin ACTIF USE_MIRROR=true, fallback
// interne) : lignes portant Ref_parcelle/Parcelle_Culturale, avant agrégation. ---
const sqlQuinzaineRecordset = [
  { Personnel_Matricule: 'A1', Nombre_Jr: 1, Cout: 100, Ref_parcelle: 'F1-01', Parcelle_Culturale: 'S1', Operation_Famille: '8. Récolte', DateStr: '2026-05-01' },
  { Personnel_Matricule: 'A2', Nombre_Jr: 1, Cout: 50, Ref_parcelle: '0032', Parcelle_Culturale: '', Operation_Famille: '11. Postes fixes', DateStr: '2026-05-01' },
  { Personnel_Matricule: 'B1', Nombre_Jr: 1, Cout: 200, Ref_parcelle: 'F5-03', Parcelle_Culturale: 'S9', Operation_Famille: '8. Récolte', DateStr: '2026-05-01' },
  { Personnel_Matricule: 'D1', Nombre_Jr: 1, Cout: 90, Ref_parcelle: 'BAHIA-01', Parcelle_Culturale: '', Operation_Famille: '8. Récolte', DateStr: '2026-05-02' },
  { Personnel_Matricule: 'Z1', Nombre_Jr: 1, Cout: 10, Ref_parcelle: 'XXX-999', Parcelle_Culturale: 'inconnue', Operation_Famille: '8. Récolte', DateStr: '2026-05-02' },
];

// Reproduit l'agrégation quinzaine (parFerme/parJour/totaux) telle qu'appliquée
// dans pointageService.js APRÈS filtrage des rows brutes — prouve que le payload
// est naturellement cloisonné une fois les rows filtrées en amont.
function aggregateQuinzaine(rows) {
  const qFermes = { F1: 0, F5: 0, Avocatier: 0, BAHIA: 0 };
  for (const r of rows) {
    const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
    if (qFermes[ferme] !== undefined) qFermes[ferme] += r.Cout || 0;
  }
  const totalCout = Object.values(qFermes).reduce((s, c) => s + c, 0);
  const days = {};
  for (const r of rows) {
    const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
    if (!days[r.DateStr]) days[r.DateStr] = { F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
    if (days[r.DateStr][ferme]) days[r.DateStr][ferme].add(r.Personnel_Matricule);
  }
  return { qFermes, totalCout, days };
}

test('quinzaine SQL fallback (ACTIF) : chef F1 → parFerme/totaux ne contiennent QUE F1', () => {
  const rows = filterMirrorRowsByFerme(sqlQuinzaineRecordset, 'F1');
  const agg = aggregateQuinzaine(rows);
  assert.strictEqual(agg.qFermes.F1, 150);           // A1 (100) + A2 (50)
  assert.strictEqual(agg.qFermes.F5, 0);             // Bob masqué
  assert.strictEqual(agg.qFermes.BAHIA, 0);
  assert.strictEqual(agg.totalCout, 150);            // total = SA ferme uniquement
  // Aucun jour ne révèle une autre ferme.
  for (const d of Object.values(agg.days)) {
    assert.strictEqual(d.F5.size, 0);
    assert.strictEqual(d.Avocatier.size, 0);
    assert.strictEqual(d.BAHIA.size, 0);
  }
});

test('quinzaine SQL fallback (ACTIF) : chef BAHIA → isole BAHIA, aucune fuite Avocatier/F5', () => {
  const rows = filterMirrorRowsByFerme(sqlQuinzaineRecordset, 'BAHIA');
  const agg = aggregateQuinzaine(rows);
  assert.strictEqual(agg.qFermes.BAHIA, 90);
  assert.strictEqual(agg.qFermes.F1, 0);
  assert.strictEqual(agg.qFermes.F5, 0);
  assert.strictEqual(agg.totalCout, 90);
});

test('quinzaine SQL fallback : RH/DG/Finance (null) → agrégat TOUTES fermes (inchangé)', () => {
  const rows = filterMirrorRowsByFerme(sqlQuinzaineRecordset, null);
  const agg = aggregateQuinzaine(rows);
  assert.strictEqual(agg.qFermes.F1, 150);
  assert.strictEqual(agg.qFermes.F5, 200);
  assert.strictEqual(agg.qFermes.BAHIA, 90);
  // Z1 (Autre) exclu de qFermes mais présent dans les rows (comportement d'origine).
  assert.strictEqual(agg.totalCout, 440);
});

// --- quinzaine fallback SQL EXTERNE (USE_MIRROR=false) : mêmes recordsets bruts
// portant Ref_parcelle/Parcelle_Culturale, filtrés avant agrégation. ---
test('quinzaine SQL fallback externe : chef F1 → summary/perDay/perDayMat filtrés F1', () => {
  const summaryRows = filterMirrorRowsByFerme(sqlQuinzaineRecordset, 'F1');
  assert.ok(summaryRows.every(r => deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) === 'F1'));
  assert.deepStrictEqual(summaryRows.map(r => r.Personnel_Matricule).sort(), ['A1', 'A2']);
});

// --- nouveaux-ouvriers SQL fallback : workers portent Ref_parcelle → filtrables. ---
const sqlNouveauxRecordset = [
  { Personnel_Matricule: 'A1', Personnel_Nom: 'Alice', first_date: '2026-05-01', Ref_parcelle: 'F1-01', Parcelle_Culturale: 'S1', Operation_Famille: '8. Récolte' },
  { Personnel_Matricule: 'B1', Personnel_Nom: 'Bob', first_date: '2026-05-01', Ref_parcelle: 'F5-03', Parcelle_Culturale: 'S9', Operation_Famille: '8. Récolte' },
  { Personnel_Matricule: 'Z1', Personnel_Nom: 'Zed', first_date: '2026-05-02', Ref_parcelle: 'XXX-999', Parcelle_Culturale: 'inconnue', Operation_Famille: '8. Récolte' },
];

test('nouveaux-ouvriers SQL fallback : chef F1 → uniquement les nouveaux de F1 (exclut Autre)', () => {
  const out = filterMirrorRowsByFerme(sqlNouveauxRecordset, 'F1');
  assert.deepStrictEqual(out.map(r => r.Personnel_Matricule), ['A1']);
  assert.ok(!out.some(r => ['B1', 'Z1'].includes(r.Personnel_Matricule)));
});

test('nouveaux-ouvriers SQL fallback : RH/DG/Finance (null) → tous (inchangé)', () => {
  assert.strictEqual(filterMirrorRowsByFerme(sqlNouveauxRecordset, null), sqlNouveauxRecordset);
});

// --- worker-detail SQL fallback : historique multi-ferme → ne garde que la
// ferme du chef ; ouvrier jamais pointé sur sa ferme → rows vide (worker null). ---
const sqlWorkerHistory = [
  { Personnel_Matricule: 'B1', Nombre_Jr: 1, Ref_parcelle: 'F5-03', Parcelle_Culturale: 'S9' },
  { Personnel_Matricule: 'B1', Nombre_Jr: 1, Ref_parcelle: 'F1-02', Parcelle_Culturale: 'S2' },
];

test('worker-detail SQL fallback : chef F1 sur un ouvrier F5+F1 → ne voit QUE les lignes F1', () => {
  const out = filterMirrorRowsByFerme(sqlWorkerHistory, 'F1');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(deriveFerme(out[0].Ref_parcelle, out[0].Parcelle_Culturale), 'F1');
});

test('worker-detail SQL fallback : chef Avocatier sur un ouvrier F5/F1 → rows vide (worker null)', () => {
  const out = filterMirrorRowsByFerme(sqlWorkerHistory, 'Avocatier');
  assert.deepStrictEqual(out, []);
});

// --- transport / quinzaine-analytique SQL fallback : payload déjà porteur de
// `ferme` → filterByFermeField (fail-closed sur Autre). ---
const sqlEnrichedFermeRows = [
  { matricule: 'A1', ferme: 'F1' },
  { matricule: 'B1', ferme: 'F5' },
  { matricule: 'Z1', ferme: 'Autre' },
];

test('transport / quinzaine-analytique SQL fallback : chef F1 → uniquement ferme F1', () => {
  assert.deepStrictEqual(filterByFermeField(sqlEnrichedFermeRows, 'F1').map(r => r.matricule), ['A1']);
});

test('transport / quinzaine-analytique SQL fallback : null → passthrough (inchangé)', () => {
  assert.strictEqual(filterByFermeField(sqlEnrichedFermeRows, null), sqlEnrichedFermeRows);
});

// --- summary / upload-times / dates SQL fallback : recordsets bruts avec
// parcelle → filterMirrorRowsByFerme AVANT comptage des effectifs par ferme. ---
test('summary/upload-times/dates SQL fallback : chef F1 → effectifs des autres fermes = 0', () => {
  const rows = filterMirrorRowsByFerme(sqlQuinzaineRecordset, 'F1');
  const farmData = { F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
  for (const r of rows) { const f = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale); if (farmData[f]) farmData[f].add(r.Personnel_Matricule); }
  assert.strictEqual(farmData.F1.size, 2);   // A1, A2
  assert.strictEqual(farmData.F5.size, 0);
  assert.strictEqual(farmData.BAHIA.size, 0);
});

// ============================================================================
// GATING PROD — prod_tracabilite_recolte : source NON filtrée par ferme.
// filterProdRowsByFerme dérive la ferme via deriveFerme(refParcelle, '').
// Couvre : (1) enrichissement recolte (ajout d'ouvriers prod + total kg),
// (2) campagne-mo-variete (buckets kg par variété|ferme).
// ============================================================================

// Lignes prod telles que stockées dans prod_tracabilite_recolte/{date}.rows :
// { matricule, nom, totalKg, variete, refParcelle } — AUCUN champ ferme.
const prodRows = [
  { matricule: 'A1', nom: 'Alice', totalKg: 40, variete: 'Corina', refParcelle: 'F1-01' },
  { matricule: 'B1', nom: 'Bob', totalKg: 60, variete: 'Breeze', refParcelle: 'F5-03' },
  { matricule: 'C1', nom: 'Chloe', totalKg: 25, variete: 'Avocat', refParcelle: 'F2-01' },
  { matricule: 'D1', nom: 'Driss', totalKg: 30, variete: 'Maravilla', refParcelle: 'BAHIA-01' },
  { matricule: 'Z1', nom: 'Zed', totalKg: 99, variete: 'X', refParcelle: 'XXX-999' }, // Autre → exclu
];

test('recolte prod : chef F1 → uniquement les ouvriers prod de F1 (pas d\'autres fermes)', () => {
  const out = filterProdRowsByFerme(prodRows, 'F1');
  assert.deepStrictEqual(out.map(r => r.matricule), ['A1']);
});

test('recolte prod : chef F5 → uniquement F5', () => {
  assert.deepStrictEqual(filterProdRowsByFerme(prodRows, 'F5').map(r => r.matricule), ['B1']);
});

test('recolte prod : fail-closed — ligne Autre (refParcelle non mappable) jamais renvoyée', () => {
  const all = ['F1', 'F5', 'Avocatier', 'BAHIA'].flatMap(f => filterProdRowsByFerme(prodRows, f).map(r => r.matricule));
  assert.ok(!all.includes('Z1'));
});

test('recolte prod : null (RH/DG/Finance) → passthrough STRICT (toutes fermes, référence identique)', () => {
  assert.strictEqual(filterProdRowsByFerme(prodRows, null), prodRows);
});

test('recolte prod : entrée vide/undefined → tableau vide (pas de crash)', () => {
  assert.deepStrictEqual(filterProdRowsByFerme(undefined, 'F1'), []);
  assert.deepStrictEqual(filterProdRowsByFerme([], 'F1'), []);
});

// recomposeProdTotalKg : le total kg servi au chef doit être la somme de SA ferme,
// pas prodData.totalKg (total toutes fermes).
test('recolte prod totalKg : chef F1 → somme kg de F1 (pas le total toutes fermes)', () => {
  const filtered = filterProdRowsByFerme(prodRows, 'F1');
  // total toutes fermes fictif (ce que porte prodData.totalKg) = 254
  assert.strictEqual(recomposeProdTotalKg(filtered, 254, 'F1'), 40);
});

test('recolte prod totalKg : chef F5 → 60', () => {
  const filtered = filterProdRowsByFerme(prodRows, 'F5');
  assert.strictEqual(recomposeProdTotalKg(filtered, 254, 'F5'), 60);
});

test('recolte prod totalKg : null → total prod d\'origine (inchangé)', () => {
  assert.strictEqual(recomposeProdTotalKg(prodRows, 254, null), 254);
});

// campagne-mo-variete : la boucle kg récolté doit ne créer des buckets que pour la
// ferme du chef. On simule l'agrégation key = variété|ferme sur rows filtrées.
test('campagne-mo-variete : chef F1 → buckets kg uniquement pour variétés de F1', () => {
  const rows = filterProdRowsByFerme(prodRows, 'F1');
  const buckets = {};
  for (const r of rows) {
    const key = `${r.variete}|F1`;
    buckets[key] = (buckets[key] || 0) + r.totalKg;
  }
  assert.deepStrictEqual(buckets, { 'Corina|F1': 40 });
});

test('campagne-mo-variete : null → toutes les variétés/fermes (passthrough)', () => {
  assert.strictEqual(filterProdRowsByFerme(prodRows, null).length, prodRows.length);
});
