'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const XLSX = require('xlsx')

const {
  parseWorkbook, evaluateGuard, computeDayDiff, impactedDates,
  buildDrySummary, movementDelta, dayFingerprint, SHEETS,
} = require('../index')
const { ARTICLE_MAP } = require('../mappings')

// Construit un classeur en mémoire à partir de tableaux de lignes (AOA) par feuille.
function makeWorkbook(sheets) {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31))
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

// En-têtes réels des feuilles (ligne 0 ignorée par le parser via slice(1)).
const H = {
  inv: ['LIEU', 'LIEU DE STOCK', 'NOM ARTICLE', 'UNITE', 'QTE', 'PRIX TTC'],
  ent: ['LIEU DE STOCK', 'DATE', 'N° BL', 'FOURNISSEUR', 'NOM ARTICLE', 'UNITE', 'QUNTITE', 'PRIX TTC'],
  trf: ['DATE', 'N° BON', 'LIEU DEPART', 'LIEU ARRIVEE', 'NOM ARTICLE', 'UNITE', 'QUNTITE'],
  // Nouveau fichier : feuille BONS DE TRANSFERT SANS colonne UNITE (qte en index 5)
  trfNoUnite: ['DATE', 'N° BON', 'LIEU DEPART', 'LIEU ARRIVEE', 'NOM ARTICLE', 'QUNTITE'],
  cons: ['DATE', 'N° BON', 'LIEU DEPART', 'PARCELLE', 'CODE', 'NOM ARTICLE', 'UNITE', 'QUNTITE'],
  sor: ['LIEU', 'DATE', 'N° BON', 'DESTINATION', 'CODE', 'NOM ARTICLE', 'UNITE', 'QUNTITE', 'MOTIF'],
}

// Inventaire: col[1]=lieu, col[2]=article, col[3]=unite, col[4]=qte, col[5]=prix
function fullWorkbook() {
  return makeWorkbook({
    [SHEETS.inventaire]: [
      H.inv,
      ['', 'F-01', 'AMMONITRATE (KG)', 'KG', 100, 12],
      ['', 'F-05', 'GZ (L)', 'L', 50, 8],
    ],
    [SHEETS.entrees]: [
      H.ent,
      ['F-01', '2026-06-02', 'BL001', 'FOURN A', 'AMMONITRATE (KG)', 'KG', 40, 12],
      ['F-01', '2026-06-02', 'BL001', 'FOURN A', 'MEGAFOL', 'L', 10, 50],
    ],
    [SHEETS.transferts]: [
      H.trf,
      ['2026-06-03', '1246', 'F-01', 'F-05', 'AMMONITRATE (KG)', 'KG', 20],
    ],
    [SHEETS.consommations]: [
      H.cons,
      ['2026-06-02', '2818', 'F-01', 'S3 MARAVILLA MOTTE F1', '', 'AMMONITRATE (KG)', 'KG', 5],
      ['2026-06-04', '2820', 'F-05', 'S9 REYNA F5', '', 'GZ (L)', 'L', 7],
    ],
    [SHEETS.sorties]: [
      H.sor,
      ['F-05', '2026-06-05', '1035', 'EL BAHIA', '', 'GZ (L)', 'L', 3, 'RETOUR BARBARIAN'],
    ],
    [SHEETS.stockReel]: [
      ['STOCK REEL'], [], ['ARTICLE', 'F01', 'F02', 'F05'],
      ['AMMONITRATE (KG)', 115, 0, 20], // == calculé → match
      ['GZ (L)', 0, 0, 38],             // calculé 40 → écart 2
    ],
  })
}

test('parseWorkbook: regroupe les lignes en mouvements par type', () => {
  const plan = parseWorkbook(fullWorkbook(), XLSX)
  assert.equal(plan.counts.receptions, 1) // 2 lignes même BL/date/lieu → 1 réception
  assert.equal(plan.counts.transferts, 1)
  assert.equal(plan.counts.consommations, 2) // dates différentes
  assert.equal(plan.counts.sorties, 1)
  assert.equal(plan.counts.movements, 5)

  const recep = plan.movements.find(m => m.type === 'reception')
  assert.equal(recep.items.length, 2)
  assert.equal(recep.ferme, 'F1')
  assert.equal(recep.lieu_destination.id, 'F1')
  assert.equal(recep.ref_bl_fournisseur, 'BL001')
})

test('parseWorkbook: résolution article (connu / nouveau / inconnu / espace)', () => {
  const buf = makeWorkbook({
    [SHEETS.inventaire]: [H.inv,
      ['', 'F-01', 'AMMONITRATE (KG)', 'KG', 10, 0],   // connu
      ['', 'F-01', 'KELPARK', 'KG', 5, 0],              // NEW_ARTICLES → IMP-NNN
      ['', 'F-01', 'AGROZITE ', 'KG', 3, 0],            // espace final → connu
      ['', 'F-01', 'PRODUIT INCONNU XYZ', 'L', 2, 0],   // inconnu → IMP-<SLUG>
    ],
    [SHEETS.entrees]: [H.ent], [SHEETS.transferts]: [H.trf],
    [SHEETS.consommations]: [H.cons], [SHEETS.sorties]: [H.sor],
    [SHEETS.stockReel]: [['x'], [], ['ARTICLE']],
  })
  const plan = parseWorkbook(buf, XLSX)
  const refs = plan.balancesInit.map(b => b.article_ref)
  assert.ok(refs.includes('Ref-Eng0113'), 'AMMONITRATE connu')
  assert.ok(refs.includes('A00936'), 'AGROZITE espace final résolu')
  assert.ok(refs.some(r => /^IMP-0\d\d$/.test(r)), 'KELPARK → IMP-NNN')
  assert.ok(refs.includes('IMP-PRODUITINCONNUXYZ'), 'inconnu → IMP-<SLUG>')
})

test('parseWorkbook: deltas de solde — destination parcelle n\'incrémente pas', () => {
  const plan = parseWorkbook(fullWorkbook(), XLSX)
  const conso = plan.movements.find(m => m.type === 'consommation')
  const deltas = movementDelta(conso)
  // consommation : −source magasin uniquement (parcelle exclue)
  assert.equal(deltas.length, 1)
  assert.equal(deltas[0].lieu_type, 'magasin')
  assert.ok(deltas[0].delta < 0)

  const sortie = plan.movements.find(m => m.type === 'sortie')
  const sd = movementDelta(sortie)
  // mirror applyStockImpact : −source magasin, +destination (seul parcelle est exclu).
  // Destination 'EL BAHIA' = ferme du groupe → magasin (et non plus 'externe'),
  // sinon le stock BAHIA reste invisible de tous les dropdowns.
  assert.equal(sd.length, 2)
  assert.equal(sd.find(d => d.delta < 0).lieu_type, 'magasin')
  assert.equal(sd.find(d => d.delta > 0).lieu_type, 'magasin')
  assert.equal(sd.find(d => d.delta > 0).lieu_id, 'BAHIA')

  const transf = plan.movements.find(m => m.type === 'transfert')
  const td = movementDelta(transf)
  assert.equal(td.length, 2, 'transfert magasin→magasin: −source +dest')
})

test('parseWorkbook: sortie vers un tiers (non-ferme) reste "externe"', () => {
  // GARDE-FOU : seules les fermes du groupe (F1..F6, BAHIA) deviennent 'magasin'.
  // Un tiers (client, prestataire, décharge) DOIT rester 'externe' : le basculer
  // en 'parcelle' l'exclurait de movementDelta puis de rebuildBalances → le solde
  // disparaîtrait des Soldes Stock au prochain import.
  const buf = makeWorkbook({
    [SHEETS.inventaire]: [H.inv, ['', 'F-01', 'AMMONITRATE (KG)', 'KG', 100, 12]],
    [SHEETS.entrees]: [H.ent], [SHEETS.transferts]: [H.trf], [SHEETS.consommations]: [H.cons],
    [SHEETS.sorties]: [H.sor,
      ['F-01', '2026-06-05', '2001', 'DECHARGE', '', 'AMMONITRATE (KG)', 'KG', 4, 'DESTRUCTION'],
      ['F-01', '2026-06-05', '2002', 'EL BAHIA', '', 'AMMONITRATE (KG)', 'KG', 6, 'PRET'],
    ],
    [SHEETS.stockReel]: [['x'], [], ['ARTICLE']],
  })
  const plan = parseWorkbook(buf, XLSX)
  const sorties = plan.movements.filter(m => m.type === 'sortie')
  assert.equal(sorties.length, 2)

  const versTiers = sorties.find(m => m.lieu_destination.id === 'DECHARGE')
  assert.deepEqual(versTiers.lieu_destination, { type: 'externe', id: 'DECHARGE' })
  const dTiers = movementDelta(versTiers)
  assert.equal(dTiers.length, 2, 'externe reste crédité (visible dans les soldes)')
  assert.equal(dTiers.find(d => d.delta > 0).lieu_type, 'externe')

  const versBahia = sorties.find(m => m.lieu_destination.id === 'BAHIA')
  assert.deepEqual(versBahia.lieu_destination, { type: 'magasin', id: 'BAHIA' })
})

test('parseWorkbook: validation vs stock réel (matches/mismatches)', () => {
  const plan = parseWorkbook(fullWorkbook(), XLSX)
  // F01 AMMONITRATE: inv 100 +40(recep) -20(transf out) -5(conso) = 115 == réel 115 → match
  // F05 GZ: inv 50 -7(conso) -3(sortie) = 40 vs réel 38 → mismatch (delta 2)
  assert.ok(plan.validation.matches >= 1)
  const gz = plan.validation.mismatches.find(m => m.farm === 'F5' && m.article === 'GZ (L)')
  assert.ok(gz, 'écart GZ F5 détecté')
  assert.equal(gz.computed, 40)
  assert.equal(gz.reel, 38)
})

test('parseWorkbook: transfert SANS colonne UNITE (nouveau fichier) → qte lue en index 5', () => {
  const buf = makeWorkbook({
    [SHEETS.inventaire]: [H.inv,
      ['', 'F-01', 'AMMONITRATE (KG)', 'KG', 100, 12],
      ['', 'F-05', 'AMMONITRATE (KG)', 'KG', 0, 12],
    ],
    [SHEETS.entrees]: [H.ent],
    // Header SANS UNITE : ['DATE','N° BON','DEPART','ARRIVEE','NOM ARTICLE','QUNTITE']
    [SHEETS.transferts]: [H.trfNoUnite,
      ['2026-06-03', '1246', 'F-01', 'F-05', 'AMMONITRATE (KG)', 20],
    ],
    [SHEETS.consommations]: [H.cons],
    [SHEETS.sorties]: [H.sor],
    [SHEETS.stockReel]: [['x'], [], ['ARTICLE']],
  })
  const plan = parseWorkbook(buf, XLSX)
  assert.equal(plan.counts.transferts, 1, '1 transfert parsé malgré absence de colonne UNITE')
  const transf = plan.movements.find(m => m.type === 'transfert')
  assert.ok(transf, 'mouvement transfert présent')
  assert.equal(transf.items.length, 1)
  assert.equal(transf.items[0].quantite, 20, 'quantité lue en index 5 (pas filtrée à 0)')
  assert.equal(transf.items[0].unite, 'kg', 'unité par défaut kg quand colonne absente')
  // delta : −source +dest
  const td = movementDelta(transf)
  assert.equal(td.length, 2)
})

test('parseWorkbook: transfert AVEC colonne UNITE (ancien fichier) → qte en index 6, unité préservée', () => {
  const buf = makeWorkbook({
    [SHEETS.inventaire]: [H.inv,
      ['', 'F-01', 'GZ (L)', 'L', 100, 8],
      ['', 'F-05', 'GZ (L)', 'L', 0, 8],
    ],
    [SHEETS.entrees]: [H.ent],
    [SHEETS.transferts]: [H.trf,
      ['2026-06-03', '1246', 'F-01', 'F-05', 'GZ (L)', 'L', 15],
    ],
    [SHEETS.consommations]: [H.cons],
    [SHEETS.sorties]: [H.sor],
    [SHEETS.stockReel]: [['x'], [], ['ARTICLE']],
  })
  const plan = parseWorkbook(buf, XLSX)
  assert.equal(plan.counts.transferts, 1)
  const transf = plan.movements.find(m => m.type === 'transfert')
  assert.equal(transf.items[0].quantite, 15, 'quantité lue en index 6 (layout legacy)')
  assert.equal(transf.items[0].unite, 'L', 'unité explicite préservée')
})

test('guard: classeur vide → hardBlock', () => {
  const buf = makeWorkbook({
    [SHEETS.inventaire]: [H.inv], [SHEETS.entrees]: [H.ent],
    [SHEETS.consommations]: [H.cons],
  })
  const plan = parseWorkbook(buf, XLSX)
  const g = evaluateGuard(plan, { currentMovementCount: 100 })
  assert.equal(g.hardBlock, true)
  assert.ok(g.reasons.some(r => /Aucun mouvement/.test(r)))
})

test('guard: feuille requise manquante → hardBlock', () => {
  const buf = makeWorkbook({
    [SHEETS.entrees]: [H.ent, ['F-01', '2026-06-02', 'BL', 'F', 'GZ (L)', 'L', 5, 8]],
    [SHEETS.consommations]: [H.cons],
  })
  const plan = parseWorkbook(buf, XLSX)
  const g = evaluateGuard(plan, {})
  assert.equal(g.hardBlock, true)
  assert.ok(g.reasons.some(r => /manquante/.test(r)))
})

test('guard: shrink signalé sans bloquer', () => {
  const plan = parseWorkbook(fullWorkbook(), XLSX)
  const g = evaluateGuard(plan, { currentMovementCount: 100 })
  assert.equal(g.hardBlock, false)
  assert.equal(g.shrink.flagged, true)
  assert.equal(g.shrink.new, 5)
})

test('computeDayDiff: nouveau vs identique vs modifié', () => {
  const plan = parseWorkbook(fullWorkbook(), XLSX)
  // Aucun existant → tous les jours sont nouveaux
  const d0 = computeDayDiff(plan, [])
  assert.equal(d0.jours_modifies.length, 0)
  assert.equal(d0.jours_identiques.length, 0)
  assert.ok(d0.jours_nouveaux.includes('2026-06-02'))

  // Existant identique pour 2026-06-02 (mêmes mouvements) → identique
  const day0602 = plan.movements.filter(m => m.date === '2026-06-02')
  const d1 = computeDayDiff(plan, day0602)
  assert.ok(d1.jours_identiques.includes('2026-06-02'))
  assert.ok(!d1.jours_modifies.some(x => x.date === '2026-06-02'))

  // Existant modifié pour 2026-06-02 (quantité différente) → modifié
  const altered = day0602.map(m => ({
    ...m,
    items: m.items.map(it => ({ ...it, quantite: it.quantite + 1 })),
  }))
  const d2 = computeDayDiff(plan, altered)
  assert.ok(d2.jours_modifies.some(x => x.date === '2026-06-02'))

  const imp = impactedDates(d1)
  assert.ok(!imp.has('2026-06-02'), 'jour identique non impacté')
  assert.ok(imp.has('2026-06-03'), 'jour nouveau impacté')
})

test('dayFingerprint: stable indépendamment de l\'ordre des mouvements', () => {
  const plan = parseWorkbook(fullWorkbook(), XLSX)
  const movs = plan.movements.filter(m => m.date === '2026-06-02')
  const reversed = [...movs].reverse()
  assert.equal(dayFingerprint(movs), dayFingerprint(reversed))
})

test('parseWorkbook: pureté — ARTICLE_MAP non muté', () => {
  const before = JSON.stringify(ARTICLE_MAP)
  parseWorkbook(fullWorkbook(), XLSX)
  parseWorkbook(fullWorkbook(), XLSX)
  assert.equal(JSON.stringify(ARTICLE_MAP), before, 'ARTICLE_MAP doit rester intact')
})

test('buildDrySummary: structure complète pour l\'UI', () => {
  const plan = parseWorkbook(fullWorkbook(), XLSX)
  const guard = evaluateGuard(plan, { currentMovementCount: 4 })
  const diff = computeDayDiff(plan, [])
  const s = buildDrySummary(plan, guard, diff)
  assert.equal(s.requires_finance, false)
  assert.ok(Array.isArray(s.jours_nouveaux))
  assert.ok(s.counts.movements === 5)
  assert.ok(s.validation.mismatch_count >= 1)
})
