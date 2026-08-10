'use strict';

/**
 * Unit tests for functions/lib/bdc/bdcDigest.js.
 * Run with: npm run test:unit
 *
 * Le module alimente le tool `get_bdc_en_attente_validation` du bot WhatsApp
 * assistant DG. Les chiffres doivent être identiques à l'onglet Achats/BdC, et
 * le ciblage « qui bloque » aligné sur l'action `remind-bdc` (functions/index.js).
 * Aucun accès Firestore ici : docs + date du jour injectés.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PENDING_STATUSES,
  RECEIVABLE_STATUSES,
  blockedBy,
  summarizePendingValidation,
  buildDigestPayload,
  summarizePendingReception,
  detailArticles,
  buildReceptionPayload,
  MISE_EN_SERVICE_MS,
  isDepuisMiseEnService,
} = require('../../functions/lib/bdc/bdcDigest.js');

const DAY = 24 * 60 * 60 * 1000;
const TODAY = Date.parse('2026-08-09T12:00:00.000Z');

/**
 * @param {object} over
 * @returns {object} un doc purchase_orders minimal.
 */
function bdc(over) {
  return Object.assign({
    numero: 'BDC-2026-0001',
    status: 'en_attente_dg',
    ferme: 'F1',
    fournisseur: { nom: 'SOMAGRI' },
    total_ttc: 1000,
    created_at: TODAY - DAY,
    updated_at: TODAY - DAY,
  }, over);
}

// ============================================================================
// PENDING_STATUSES
// ============================================================================

test('PENDING_STATUSES: exactement les 3 statuts d\'attente de validation', () => {
  assert.deepEqual(PENDING_STATUSES, ['brouillon', 'en_attente_chef', 'en_attente_dg']);
});

// ============================================================================
// blockedBy — aligné sur la table de ciblage de remind-bdc
// ============================================================================

test('blockedBy: brouillon → achats (pas encore soumis, la balle est chez le saisisseur)', () => {
  const result = blockedBy(bdc({ status: 'brouillon', ferme: 'F1' }));
  assert.equal(result.role, 'achats');
  assert.match(result.label, /pas encore soumis/i);
  assert.equal(result.ferme, 'F1');
});

test('blockedBy: en_attente_chef sur F1 → chef_f1 / "Chef F1"', () => {
  assert.deepEqual(blockedBy(bdc({ status: 'en_attente_chef', ferme: 'F1' })), {
    role: 'chef_f1', label: 'Chef F1', ferme: 'F1',
  });
});

test('blockedBy: en_attente_chef sur F5 → chef_f5 / "Chef F5"', () => {
  assert.deepEqual(blockedBy(bdc({ status: 'en_attente_chef', ferme: 'F5' })), {
    role: 'chef_f5', label: 'Chef F5', ferme: 'F5',
  });
});

test('blockedBy: en_attente_dg → dg, quelle que soit la ferme', () => {
  assert.equal(blockedBy(bdc({ status: 'en_attente_dg', ferme: 'Avocatier' })).role, 'dg');
  assert.equal(blockedBy(bdc({ status: 'en_attente_dg', ferme: 'F1' })).label, 'DG');
});

test('blockedBy: ferme direct-DG (Avocatier) coincée en en_attente_chef → rôle aucun_valideur, jamais dg ni undefined', () => {
  const result = blockedBy(bdc({ status: 'en_attente_chef', ferme: 'Avocatier' }));
  assert.equal(result.role, 'aucun_valideur');
  assert.notEqual(result.role, 'dg');
  assert.match(result.label, /aucun chef/i);
  assert.match(result.label, /Avocatier/);
});

test('blockedBy: ferme inconnue (typo) en en_attente_chef → aucun_valideur, pas le DG', () => {
  // requiresChefValidation() est fail-safe true pour une ferme inconnue :
  // une simple typo produit un BdC en_attente_chef sans chef compétent.
  assert.equal(blockedBy(bdc({ status: 'en_attente_chef', ferme: 'F11' })).role, 'aucun_valideur');
});

test('blockedBy: ferme absente en en_attente_chef → aucun_valideur sans crash', () => {
  const result = blockedBy({ status: 'en_attente_chef' });
  assert.equal(result.role, 'aucun_valideur');
  assert.equal(result.ferme, null);
});

test('blockedBy: statut hors périmètre → rôle "inconnu" explicite', () => {
  assert.equal(blockedBy(bdc({ status: 'valide_dg' })).role, 'inconnu');
});

// ============================================================================
// summarizePendingValidation — agrégats + tri + normalisation
// ============================================================================

test('summarizePendingValidation: liste vide → totaux à zéro, pas de crash', () => {
  assert.deepEqual(summarizePendingValidation([], { today: TODAY }), {
    total: 0, totalTtc: 0, byBlocker: [], items: [],
  });
  assert.deepEqual(summarizePendingValidation(undefined, { today: TODAY }).items, []);
});

test('summarizePendingValidation: ignore les BdC hors statuts d\'attente', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-1', status: 'valide_dg' }),
    bdc({ numero: 'BDC-2', status: 'en_attente_dg' }),
    bdc({ numero: 'BDC-3', status: 'annule' }),
  ], { today: TODAY });
  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((i) => i.numero), ['BDC-2']);
});

test('summarizePendingValidation: tri par ageJours décroissant (le plus vieux d\'abord)', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-RECENT', updated_at: TODAY - 1 * DAY }),
    bdc({ numero: 'BDC-VIEUX', updated_at: TODAY - 12 * DAY }),
    bdc({ numero: 'BDC-MOYEN', updated_at: TODAY - 6 * DAY }),
  ], { today: TODAY });
  assert.deepEqual(result.items.map((i) => i.numero), ['BDC-VIEUX', 'BDC-MOYEN', 'BDC-RECENT']);
  assert.deepEqual(result.items.map((i) => i.ageJours), [12, 6, 1]);
});

test('summarizePendingValidation: ageJours calculé sur updated_at, sinon created_at', () => {
  const sansUpdate = summarizePendingValidation(
    [{ numero: 'BDC-X', status: 'en_attente_dg', created_at: TODAY - 4 * DAY }],
    { today: TODAY }
  );
  assert.equal(sansUpdate.items[0].ageJours, 4);

  const avecUpdate = summarizePendingValidation(
    [{ numero: 'BDC-Y', status: 'en_attente_dg', created_at: TODAY - 30 * DAY, updated_at: TODAY - 2 * DAY }],
    { today: TODAY }
  );
  assert.equal(avecUpdate.items[0].ageJours, 2);
});

test('summarizePendingValidation: aucune date exploitable → ageJours null (pas 0 trompeur, pas NaN)', () => {
  const result = summarizePendingValidation([{ numero: 'BDC-Z', status: 'brouillon' }], { today: TODAY });
  assert.equal(result.items[0].ageJours, null);
});

test('summarizePendingValidation: date future → ageJours clampé à 0, jamais négatif', () => {
  const futur = summarizePendingValidation(
    [{ numero: 'BDC-F', status: 'brouillon', updated_at: TODAY + 5 * DAY }],
    { today: TODAY }
  );
  assert.equal(futur.items[0].ageJours, 0);
});

test('summarizePendingValidation: BdC sans date placés en FIN de tri, pas en tête', () => {
  const result = summarizePendingValidation([
    { numero: 'BDC-SANS-DATE', status: 'en_attente_dg' },
    { numero: 'BDC-VIEUX', status: 'en_attente_dg', updated_at: TODAY - 10 * DAY },
    { numero: 'BDC-RECENT', status: 'en_attente_dg', updated_at: TODAY - 1 * DAY },
  ], { today: TODAY });
  assert.deepEqual(result.items.map((i) => i.numero), ['BDC-VIEUX', 'BDC-RECENT', 'BDC-SANS-DATE']);
});

test('summarizePendingValidation: today absent ou invalide → throw bruyant (jamais un fallback silencieux à 0)', () => {
  const docs = [bdc({ numero: 'BDC-1' })];
  assert.throws(() => summarizePendingValidation(docs, {}), /today/i);
  assert.throws(() => summarizePendingValidation(docs, undefined), /today/i);
  assert.throws(() => summarizePendingValidation(docs, { today: 'pas-une-date' }), /today/i);
  assert.throws(() => summarizePendingValidation(docs, { today: NaN }), /today/i);
  assert.throws(() => summarizePendingValidation(docs, { today: new Date('nawak') }), /today/i);
});

test('summarizePendingValidation: fournisseur objet → nom ; manquant ou mal formé → "—"', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-A', fournisseur: { nom: 'SOMAGRI' }, updated_at: TODAY - 3 * DAY }),
    bdc({ numero: 'BDC-B', fournisseur: null, updated_at: TODAY - 2 * DAY }),
    bdc({ numero: 'BDC-C', fournisseur: { id: 'xyz' }, updated_at: TODAY - 1 * DAY }),
    bdc({ numero: 'BDC-D', fournisseur: 'AGRIMAT', updated_at: TODAY }),
  ], { today: TODAY });
  assert.deepEqual(result.items.map((i) => i.fournisseur), ['SOMAGRI', '—', '—', 'AGRIMAT']);
});

test('summarizePendingValidation: agrégation byBlocker — count + totalTtc par bloqueur', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-1', status: 'en_attente_chef', ferme: 'F1', total_ttc: 1000, updated_at: TODAY - 5 * DAY }),
    bdc({ numero: 'BDC-2', status: 'en_attente_chef', ferme: 'F1', total_ttc: 400, updated_at: TODAY - 4 * DAY }),
    bdc({ numero: 'BDC-3', status: 'en_attente_dg', ferme: 'Avocatier', total_ttc: 2500, updated_at: TODAY - 3 * DAY }),
    bdc({ numero: 'BDC-4', status: 'brouillon', ferme: 'F5', total_ttc: 100, updated_at: TODAY - 2 * DAY }),
  ], { today: TODAY });

  assert.equal(result.total, 4);
  assert.equal(result.totalTtc, 4000);
  assert.deepEqual(result.byBlocker, [
    { role: 'chef_f1', label: 'Chef F1', count: 2, totalTtc: 1400 },
    { role: 'dg', label: 'DG', count: 1, totalTtc: 2500 },
    { role: 'achats', label: 'Achats', count: 1, totalTtc: 100 },
  ]);
});

test('summarizePendingValidation: total_ttc string ou absent → traité comme nombre, jamais NaN', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-1', total_ttc: '1200.50', updated_at: TODAY - 2 * DAY }),
    bdc({ numero: 'BDC-2', total_ttc: undefined, updated_at: TODAY - 1 * DAY }),
  ], { today: TODAY });
  assert.deepEqual(result.items.map((i) => i.totalTtc), [1200.5, 0]);
  assert.equal(result.totalTtc, 1200.5);
});

test('summarizePendingValidation: today accepte Date, epoch ms et string ISO', () => {
  const docs = [bdc({ numero: 'BDC-1', updated_at: TODAY - 7 * DAY })];
  assert.equal(summarizePendingValidation(docs, { today: new Date(TODAY) }).items[0].ageJours, 7);
  assert.equal(summarizePendingValidation(docs, { today: TODAY }).items[0].ageJours, 7);
  assert.equal(summarizePendingValidation(docs, { today: '2026-08-09T12:00:00.000Z' }).items[0].ageJours, 7);
});

test('summarizePendingValidation: un BdC sans chef compétent ne pollue PAS le bucket dg de byBlocker', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-DG', status: 'en_attente_dg', ferme: 'F1', total_ttc: 3000, updated_at: TODAY - 2 * DAY }),
    bdc({ numero: 'BDC-ORPHELIN', status: 'en_attente_chef', ferme: 'Avocatier', total_ttc: 9000, updated_at: TODAY - 1 * DAY }),
  ], { today: TODAY });

  const byRole = Object.fromEntries(result.byBlocker.map((b) => [b.role, b]));
  assert.deepEqual(byRole.dg, { role: 'dg', label: 'DG', count: 1, totalTtc: 3000 });
  assert.deepEqual(byRole.aucun_valideur, {
    role: 'aucun_valideur', label: 'Bloqué — aucun chef de ferme', count: 1, totalTtc: 9000,
  });
  // Le total global reste complet : rien n'est perdu, c'est juste imputé au bon bloqueur.
  assert.equal(result.totalTtc, 12000);
});

test('summarizePendingValidation: chaque item porte son blockedBy détaillé', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-1', status: 'en_attente_chef', ferme: 'F5', updated_at: TODAY - 6 * DAY }),
  ], { today: TODAY });
  assert.deepEqual(result.items[0], {
    numero: 'BDC-1',
    fournisseur: 'SOMAGRI',
    ferme: 'F5',
    totalTtc: 1000,
    status: 'en_attente_chef',
    blockedBy: { role: 'chef_f5', label: 'Chef F5', ferme: 'F5' },
    ageJours: 6,
  });
});

// ============================================================================
// buildDigestPayload — mise en forme envoyée au modèle. Les totaux doivent
// rester ceux de TOUT le jeu de données, seule la liste est bornée.
// ============================================================================

/**
 * @param {number} n
 * @returns {object} un résumé de n BdC en attente DG à 100 MAD pièce.
 */
function summaryOf(n) {
  const docs = [];
  for (let i = 0; i < n; i++) {
    docs.push(bdc({ numero: `BDC-${String(i).padStart(3, '0')}`, total_ttc: 100, updated_at: TODAY - (n - i) * DAY }));
  }
  return summarizePendingValidation(docs, { today: TODAY });
}

test('buildDigestPayload: limite par défaut à 15 items, totaux calculés sur TOUT le jeu', () => {
  const payload = buildDigestPayload(summaryOf(40), undefined);
  assert.equal(payload.items.length, 15);
  assert.equal(payload.total, 40);
  assert.equal(payload.totalTtc, 4000);
  assert.equal(payload.byBlocker[0].count, 40);
  assert.equal(payload.reste, 25);
});

test('buildDigestPayload: limit explicite respecté, reste recalculé', () => {
  const payload = buildDigestPayload(summaryOf(10), 3);
  assert.equal(payload.items.length, 3);
  assert.equal(payload.reste, 7);
  assert.equal(payload.total, 10);
});

test('buildDigestPayload: pas de champ reste quand tout est détaillé', () => {
  const payload = buildDigestPayload(summaryOf(4), 15);
  assert.equal(payload.items.length, 4);
  assert.equal('reste' in payload, false);
});

test('buildDigestPayload: limit invalide (0, négatif, NaN, string) → défaut 15', () => {
  for (const bad of [0, -5, NaN, 'abc', null, undefined]) {
    assert.equal(buildDigestPayload(summaryOf(20), /** @type {any} */ (bad)).items.length, 15, `limit=${String(bad)}`);
  }
  // string numérique tolérée
  assert.equal(buildDigestPayload(summaryOf(20), '5').items.length, 5);
});

test('buildDigestPayload: items bornés = les plus anciens en premier (ordre du résumé préservé)', () => {
  const payload = buildDigestPayload(summaryOf(5), 2);
  assert.deepEqual(payload.items.map((i) => i.numero), ['BDC-000', 'BDC-001']);
});

test('buildDigestPayload: ferme informative — filtre ou "toutes"', () => {
  assert.equal(buildDigestPayload(summaryOf(1), 15).ferme, 'toutes');
  assert.equal(buildDigestPayload(summaryOf(1), 15, { ferme: '' }).ferme, 'toutes');
  assert.equal(buildDigestPayload(summaryOf(1), 15, { ferme: 'F1' }).ferme, 'F1');
});

test('buildDigestPayload: lectureTronquee posé seulement si la lecture source a atteint son plafond', () => {
  assert.equal('lectureTronquee' in buildDigestPayload(summaryOf(2), 15), false);
  assert.equal('lectureTronquee' in buildDigestPayload(summaryOf(2), 15, { tronque: false }), false);
  assert.equal(buildDigestPayload(summaryOf(2), 15, { tronque: true }).lectureTronquee, true);
});

test('buildDigestPayload: résumé vide → payload cohérent, pas de reste', () => {
  const payload = buildDigestPayload(summarizePendingValidation([], { today: TODAY }), 15);
  assert.deepEqual(payload, { ferme: 'toutes', total: 0, totalTtc: 0, byBlocker: [], items: [] });
});

// ============================================================================
// Réception — summarizePendingReception / detailArticles / buildReceptionPayload
//
// Référence fonctionnelle : l'onglet magasin (public/components/MagBdcReceptionTab.jsx)
// charge les BdC en statut valide_dg,envoye,virement_lance,virement_signe et
// exclut ceux entièrement livrés. Le module doit renvoyer les MÊMES BdC, à
// ceci près que le "entièrement livré" est RECALCULÉ à partir des BL vivants.
// ============================================================================

/**
 * @param {object} [over]
 * @returns {object} un doc purchase_orders réceptionnable minimal.
 */
function rbdc(over) {
  return Object.assign({
    id: 'BDC1',
    numero: 'BDC-2026-0100',
    status: 'valide_dg',
    ferme: 'F1',
    fournisseur: { nom: 'SOMAGRI' },
    total_ttc: 5000,
    date_livraison_prevue: '2026-08-01', // 8 j avant TODAY
    items: [{ article: 'Engrais', quantite: 100, unite: 'kg' }],
  }, over);
}

test('RECEIVABLE_STATUSES: mêmes statuts que la garde create-bl et l\'onglet magasin', () => {
  assert.deepEqual(RECEIVABLE_STATUSES, ['valide_dg', 'envoye', 'virement_lance', 'virement_signe']);
});

test('summarizePendingReception: BdC sans aucun BL → non_livre, 0 % reçu, retard calculé', () => {
  const result = summarizePendingReception([rbdc()], {}, { today: TODAY });
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0], {
    numero: 'BDC-2026-0100',
    fournisseur: 'SOMAGRI',
    ferme: 'F1',
    totalTtc: 5000,
    deliveryStatus: 'non_livre',
    dateLivraisonPrevue: '2026-08-01',
    retardJours: 8,
    pctRecu: 0,
    nbArticlesIncomplets: 1,
  });
  assert.equal(result.enRetard, 1);
  assert.deepEqual(result.byDeliveryStatus, [{ status: 'non_livre', count: 1, totalTtc: 5000 }]);
});

test('summarizePendingReception: BL partiel → partiel + pctRecu + reliquat sur 1 article', () => {
  const bls = { BDC1: [{ items: [{ article: 'Engrais', quantite_recue: 40 }] }] };
  const result = summarizePendingReception([rbdc()], bls, { today: TODAY });
  assert.equal(result.items[0].deliveryStatus, 'partiel');
  assert.equal(result.items[0].pctRecu, 40);
  assert.equal(result.items[0].nbArticlesIncomplets, 1);
});

test('summarizePendingReception: BL soft-deleted JAMAIS compté (sinon le BdC disparaît à tort)', () => {
  const bls = {
    BDC1: [
      { deleted: true, items: [{ article: 'Engrais', quantite_recue: 100 }] },
      { items: [{ article: 'Engrais', quantite_recue: 25 }] },
    ],
  };
  const result = summarizePendingReception([rbdc()], bls, { today: TODAY });
  assert.equal(result.total, 1, 'le BdC reste dans la liste : le BL supprimé ne solde rien');
  assert.equal(result.items[0].deliveryStatus, 'partiel');
  assert.equal(result.items[0].pctRecu, 25);

  // Cas extrême : le SEUL BL est supprimé → retour à non_livre.
  const seulSupprime = summarizePendingReception(
    [rbdc()],
    { BDC1: [{ deleted: true, items: [{ article: 'Engrais', quantite_recue: 100 }] }] },
    { today: TODAY }
  );
  assert.equal(seulSupprime.items[0].deliveryStatus, 'non_livre');
  assert.equal(seulSupprime.items[0].pctRecu, 0);
});

test('summarizePendingReception: BdC entièrement livré → EXCLU du résultat', () => {
  const bls = { BDC1: [{ items: [{ article: 'Engrais', quantite_recue: 100 }] }] };
  const result = summarizePendingReception([rbdc()], bls, { today: TODAY });
  assert.deepEqual(result, { total: 0, totalTtc: 0, enRetard: 0, byDeliveryStatus: [], items: [] });
});

test('summarizePendingReception: deliveryStatus RECALCULÉ, le champ stocké est ignoré', () => {
  // Champ matérialisé "complet" alors qu'aucun BL vivant n'existe → le BdC doit
  // rester listé (c'est exactement la divergence qu'on veut détecter).
  const menteur = summarizePendingReception([rbdc({ delivery_status: 'complet' })], {}, { today: TODAY });
  assert.equal(menteur.total, 1);
  assert.equal(menteur.items[0].deliveryStatus, 'non_livre');

  // Inverse : champ stocké "non_livre" mais BL couvrant tout → exclu.
  const solde = summarizePendingReception(
    [rbdc({ delivery_status: 'non_livre' })],
    { BDC1: [{ items: [{ article: 'Engrais', quantite_recue: 100 }] }] },
    { today: TODAY }
  );
  assert.equal(solde.total, 0);
});

test('summarizePendingReception: ignore les BdC hors statuts réceptionnables', () => {
  const result = summarizePendingReception([
    rbdc({ id: 'A', numero: 'BDC-A', status: 'en_attente_dg' }),
    rbdc({ id: 'B', numero: 'BDC-B', status: 'envoye' }),
    rbdc({ id: 'C', numero: 'BDC-C', status: 'annule' }),
    rbdc({ id: 'D', numero: 'BDC-D', status: 'virement_signe' }),
  ], {}, { today: TODAY });
  assert.deepEqual(result.items.map((i) => i.numero).sort(), ['BDC-B', 'BDC-D']);
});

test('summarizePendingReception: date_livraison_prevue absente ou vide → retardJours null', () => {
  const sansDate = summarizePendingReception([rbdc({ date_livraison_prevue: '' })], {}, { today: TODAY });
  assert.equal(sansDate.items[0].retardJours, null);
  assert.equal(sansDate.items[0].dateLivraisonPrevue, null);
  assert.equal(sansDate.enRetard, 0);

  const absente = summarizePendingReception([rbdc({ date_livraison_prevue: undefined })], {}, { today: TODAY });
  assert.equal(absente.items[0].retardJours, null);
});

test('summarizePendingReception: échéance future → retardJours clampé à 0, jamais négatif', () => {
  const result = summarizePendingReception([rbdc({ date_livraison_prevue: '2026-09-15' })], {}, { today: TODAY });
  assert.equal(result.items[0].retardJours, 0);
  assert.equal(result.enRetard, 0, 'un BdC pas encore échu n\'est pas "en retard"');
});

test('summarizePendingReception: pctRecu pondéré par les quantités (articles hétérogènes)', () => {
  const bdcMulti = rbdc({
    items: [
      { article: 'Engrais', quantite: 900, unite: 'kg' },
      { article: 'Gants', quantite: 100, unite: 'unité' },
    ],
  });
  // 900 commandés dont 450 reçus + 100 commandés dont 100 reçus = 550/1000.
  const bls = { BDC1: [{ items: [{ article: 'Engrais', quantite_recue: 450 }, { article: 'Gants', quantite_recue: 100 }] }] };
  const result = summarizePendingReception([bdcMulti], bls, { today: TODAY });
  assert.equal(result.items[0].pctRecu, 55);
  assert.equal(result.items[0].nbArticlesIncomplets, 1, 'seul Engrais est incomplet');
});

test('summarizePendingReception: sur-réception d\'un article ne masque pas le manque d\'un autre', () => {
  const bdcMulti = rbdc({
    items: [
      { article: 'Engrais', quantite: 100, unite: 'kg' },
      { article: 'Gants', quantite: 100, unite: 'unité' },
    ],
  });
  const bls = { BDC1: [{ items: [{ article: 'Engrais', quantite_recue: 200 }] }] };
  const result = summarizePendingReception([bdcMulti], bls, { today: TODAY });
  assert.equal(result.items[0].pctRecu, 50, 'reçu plafonné au commandé par article');
  assert.equal(result.items[0].nbArticlesIncomplets, 1);
});

test('summarizePendingReception: BL cumulés sur plusieurs livraisons partielles', () => {
  const bls = {
    BDC1: [
      { items: [{ article: 'Engrais', quantite_recue: 30 }] },
      { items: [{ article: 'Engrais', quantite_recue: 20 }] },
    ],
  };
  const result = summarizePendingReception([rbdc()], bls, { today: TODAY });
  assert.equal(result.items[0].pctRecu, 50);
});

test('summarizePendingReception: tri — le plus en retard d\'abord, échéance inconnue en fin', () => {
  const result = summarizePendingReception([
    rbdc({ id: 'A', numero: 'BDC-A', date_livraison_prevue: '2026-08-05' }),
    rbdc({ id: 'B', numero: 'BDC-B', date_livraison_prevue: '' }),
    rbdc({ id: 'C', numero: 'BDC-C', date_livraison_prevue: '2026-07-01' }),
  ], {}, { today: TODAY });
  assert.deepEqual(result.items.map((i) => i.numero), ['BDC-C', 'BDC-A', 'BDC-B']);
});

test('summarizePendingReception: enRetardSeulement filtre items ET totaux', () => {
  const result = summarizePendingReception([
    rbdc({ id: 'A', numero: 'BDC-A', date_livraison_prevue: '2026-07-01', total_ttc: 1000 }),
    rbdc({ id: 'B', numero: 'BDC-B', date_livraison_prevue: '2026-09-01', total_ttc: 700 }),
    rbdc({ id: 'C', numero: 'BDC-C', date_livraison_prevue: '', total_ttc: 300 }),
  ], {}, { today: TODAY, enRetardSeulement: true });
  assert.deepEqual(result.items.map((i) => i.numero), ['BDC-A']);
  assert.equal(result.total, 1);
  assert.equal(result.totalTtc, 1000);
  assert.equal(result.enRetard, 1);
});

test('summarizePendingReception: liste vide / BL absents → totaux à zéro, pas de crash', () => {
  assert.deepEqual(summarizePendingReception([], {}, { today: TODAY }), {
    total: 0, totalTtc: 0, enRetard: 0, byDeliveryStatus: [], items: [],
  });
  assert.deepEqual(summarizePendingReception(undefined, undefined, { today: TODAY }).items, []);
  assert.equal(summarizePendingReception([rbdc()], undefined, { today: TODAY }).total, 1);
});

test('summarizePendingReception: today absent ou invalide → throw bruyant', () => {
  const docs = [rbdc()];
  assert.throws(() => summarizePendingReception(docs, {}, {}), /today/i);
  assert.throws(() => summarizePendingReception(docs, {}, undefined), /today/i);
  assert.throws(() => summarizePendingReception(docs, {}, { today: 'pas-une-date' }), /today/i);
  assert.throws(() => summarizePendingReception(docs, {}, { today: NaN }), /today/i);
});

test('summarizePendingReception: BL retrouvés par numéro si l\'id n\'est pas propagé', () => {
  const sansId = rbdc({ id: undefined });
  const result = summarizePendingReception([sansId], { 'BDC-2026-0100': [{ items: [{ article: 'Engrais', quantite_recue: 60 }] }] }, { today: TODAY });
  assert.equal(result.items[0].pctRecu, 60);
});

// ---------------------------------------------------------------------------
// detailArticles
// ---------------------------------------------------------------------------

test('detailArticles: commandé / livré / reliquat par article, unité conservée', () => {
  const bdcMulti = rbdc({
    items: [
      { article: 'Engrais', quantite: 100, unite: 'kg' },
      { article: 'Gants', quantite: 50, unite: 'unité' },
    ],
  });
  const lignes = detailArticles(bdcMulti, [{ items: [{ article: 'Engrais', quantite_recue: 30 }] }]);
  assert.deepEqual(lignes, [
    { article: 'Engrais', unite: 'kg', qCmd: 100, qLiv: 30, reliquat: 70 },
    { article: 'Gants', unite: 'unité', qCmd: 50, qLiv: 0, reliquat: 50 },
  ]);
});

test('detailArticles: BL soft-deleted ignoré', () => {
  const lignes = detailArticles(rbdc(), [
    { deleted: true, items: [{ article: 'Engrais', quantite_recue: 100 }] },
    { items: [{ article: 'Engrais', quantite_recue: 10 }] },
  ]);
  assert.deepEqual(lignes, [{ article: 'Engrais', unite: 'kg', qCmd: 100, qLiv: 10, reliquat: 90 }]);
});

test('detailArticles: reliquat jamais négatif en cas de sur-réception', () => {
  const lignes = detailArticles(rbdc(), [{ items: [{ article: 'Engrais', quantite_recue: 130 }] }]);
  assert.deepEqual(lignes, [{ article: 'Engrais', unite: 'kg', qCmd: 100, qLiv: 130, reliquat: 0 }]);
});

test('detailArticles: article livré absent du BdC → listé avec qCmd 0 (incohérence visible)', () => {
  const lignes = detailArticles(rbdc(), [{ items: [{ article: 'Intrus', quantite_recue: 5 }] }]);
  assert.deepEqual(lignes, [
    { article: 'Engrais', unite: 'kg', qCmd: 100, qLiv: 0, reliquat: 100 },
    { article: 'Intrus', unite: '—', qCmd: 0, qLiv: 5, reliquat: 0 },
  ]);
});

test('detailArticles: BdC sans items ou sans BL → pas de crash', () => {
  assert.deepEqual(detailArticles({}, []), []);
  assert.deepEqual(detailArticles(rbdc(), undefined), [
    { article: 'Engrais', unite: 'kg', qCmd: 100, qLiv: 0, reliquat: 100 },
  ]);
});

// ---------------------------------------------------------------------------
// buildReceptionPayload
// ---------------------------------------------------------------------------

/**
 * @param {number} n
 * @returns {object} un résumé réception de n BdC non livrés à 100 MAD pièce.
 */
function receptionSummaryOf(n) {
  const docs = [];
  for (let i = 0; i < n; i++) {
    docs.push(rbdc({
      id: `ID-${i}`,
      numero: `BDC-${String(i).padStart(3, '0')}`,
      total_ttc: 100,
      date_livraison_prevue: '2026-08-01',
    }));
  }
  return summarizePendingReception(docs, {}, { today: TODAY });
}

test('buildReceptionPayload: borne les items mais garde les agrégats sur TOUT le jeu', () => {
  const payload = buildReceptionPayload(receptionSummaryOf(40), undefined);
  assert.equal(payload.items.length, 15);
  assert.equal(payload.total, 40);
  assert.equal(payload.totalTtc, 4000);
  assert.equal(payload.enRetard, 40);
  assert.deepEqual(payload.byDeliveryStatus, [{ status: 'non_livre', count: 40, totalTtc: 4000 }]);
  assert.equal(payload.reste, 25);
  assert.equal('byBlocker' in payload, false, 'agrégat du digest validation, hors sujet ici');
});

test('buildReceptionPayload: limit explicite, ferme informative, drapeaux de contexte', () => {
  const payload = buildReceptionPayload(receptionSummaryOf(5), 2, { ferme: 'F5', tronque: true, enRetardSeulement: true });
  assert.equal(payload.items.length, 2);
  assert.equal(payload.reste, 3);
  assert.equal(payload.ferme, 'F5');
  assert.equal(payload.lectureTronquee, true);
  assert.equal(payload.enRetardSeulement, true);
});

test('buildReceptionPayload: résumé vide → payload cohérent, pas de reste ni de drapeau', () => {
  const payload = buildReceptionPayload(receptionSummaryOf(0), 15);
  assert.deepEqual(payload, {
    ferme: 'toutes', total: 0, totalTtc: 0, enRetard: 0, byDeliveryStatus: [], items: [],
    ecartesAvantMiseEnService: 0,
  });
});

test('buildReceptionPayload: le compte d\'écartés est TOUJOURS exposé (rien ne disparaît sans trace)', () => {
  const avec = buildReceptionPayload(receptionSummaryOf(3), 15, { ecartesAvantMiseEnService: 270 });
  assert.equal(avec.ecartesAvantMiseEnService, 270);

  // Absent côté appelant → 0 explicite, jamais undefined : le modèle doit
  // pouvoir répondre "aucun BdC écarté" et pas rester muet.
  const sans = buildReceptionPayload(receptionSummaryOf(3), 15);
  assert.equal(sans.ecartesAvantMiseEnService, 0);
});

// ---------------------------------------------------------------------------
// Bornage à la mise en service de l'app — isDepuisMiseEnService
//
// Avant le 01/07/2026 l'app n'était pas utilisée : les réceptions n'ont jamais
// été saisies, donc ces BdC restent éternellement "0 % reçu, 130 j de retard"
// alors que la marchandise est livrée. Le prédicat est écrit EN POSITIF : on
// n'écarte que ce qu'on SAIT antérieur au seuil.
// ---------------------------------------------------------------------------

test('MISE_EN_SERVICE_MS: seuil = 01/07/2026 à minuit HEURE MAROCAINE (UTC+1)', () => {
  // Volontairement 23h00 UTC la veille : le Maroc est à UTC+1, et un seuil posé
  // à 00h00 UTC tomberait à 01h00 locale — un BdC créé dans cette heure-là
  // serait écarté à tort, donc rendu INVISIBLE. Seul sens d'erreur refusé ici.
  assert.equal(MISE_EN_SERVICE_MS, Date.parse('2026-06-30T23:00:00.000Z'));
  assert.equal(new Date(MISE_EN_SERVICE_MS).toISOString(), '2026-06-30T23:00:00.000Z');
});

test('isDepuisMiseEnService: created_at antérieur au seuil → ÉCARTÉ', () => {
  // Cas terrain : BDC-2026-0009, commandé début mai, 0 % reçu, 136 j de retard.
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: Date.parse('2026-05-02T09:00:00.000Z') })), false);
  // Import historique BC-000001 (created_at = date d'origine de la commande).
  assert.equal(isDepuisMiseEnService(rbdc({ numero: 'BC-000001', created_at: Date.parse('2025-07-23T00:00:00.000Z') })), false);
  // Une milliseconde avant le seuil suffit à écarter.
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: MISE_EN_SERVICE_MS - 1 })), false);
});

test('isDepuisMiseEnService: created_at postérieur au seuil → CONSERVÉ', () => {
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: MISE_EN_SERVICE_MS + 1 })), true);
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: TODAY })), true);
});

test('isDepuisMiseEnService: created_at EXACTEMENT au seuil → conservé (borne inclusive)', () => {
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: MISE_EN_SERVICE_MS })), true);
});

// Verrouille le CHOIX DU CHAMP, pas seulement la comparaison. Sans ce test, un
// refactor basculant sur `updated_at` passerait les 65 autres au vert — et des
// BdC de mai touchés par un BL récent réapparaîtraient dans le bruit, puisque
// `updated_at` est réécrit à chaque création/suppression de BL
// (functions/index.js:7389, :10816). Mutant identifié en relecture QA.
test('isDepuisMiseEnService: se fonde sur created_at, JAMAIS sur updated_at', () => {
  const vieuxBdcTouchéRécemment = rbdc({
    numero: 'BDC-2026-0009',
    created_at: Date.parse('2026-05-02T09:00:00.000Z'), // avant la mise en service
    updated_at: TODAY,                                   // BL créé ou supprimé hier
  });
  assert.equal(isDepuisMiseEnService(vieuxBdcTouchéRécemment), false,
    'un BdC de mai reste écarté même si updated_at est récent');

  const recentJamaisTouché = rbdc({
    created_at: MISE_EN_SERVICE_MS + 1,
    updated_at: Date.parse('2026-05-02T09:00:00.000Z'), // incohérent à dessein
  });
  assert.equal(isDepuisMiseEnService(recentJamaisTouché), true,
    'un BdC récent reste conservé même si updated_at est ancien');
});

test('isDepuisMiseEnService: created_at absent → CONSERVÉ, jamais écarté en silence', () => {
  const sansChamp = rbdc();
  delete sansChamp.created_at;
  assert.equal(isDepuisMiseEnService(sansChamp), true);
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: undefined })), true);
});

test('isDepuisMiseEnService: date inexploitable (null, 0, string, NaN) → CONSERVÉ', () => {
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: null })), true);
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: 0 })), true);
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: -1 })), true);
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: '2026-05-02' })), true);
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: String(MISE_EN_SERVICE_MS - 1) })), true);
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: NaN })), true);
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: Infinity })), true);
  assert.equal(isDepuisMiseEnService(rbdc({ created_at: {} })), true);
});

test('isDepuisMiseEnService: doc absent / vide → conservé sans crash', () => {
  assert.equal(isDepuisMiseEnService(/** @type {any} */ (null)), true);
  assert.equal(isDepuisMiseEnService(/** @type {any} */ ({})), true);
});

test('isDepuisMiseEnService: jeu mixte — compte exact d\'écartés et de conservés', () => {
  const docs = [
    rbdc({ numero: 'BC-000001', created_at: Date.parse('2025-07-23T00:00:00.000Z') }), // écarté
    rbdc({ numero: 'BDC-2026-0009', created_at: Date.parse('2026-05-02T09:00:00.000Z') }), // écarté
    rbdc({ numero: 'BDC-2026-0034', created_at: MISE_EN_SERVICE_MS - 1 }), // écarté
    rbdc({ numero: 'BDC-2026-0100', created_at: MISE_EN_SERVICE_MS }), // conservé (borne)
    rbdc({ numero: 'BDC-2026-0142', created_at: TODAY - DAY }), // conservé
    rbdc({ numero: 'BDC-SANS-DATE', created_at: undefined }), // conservé (inexploitable)
    rbdc({ numero: 'BDC-DATE-NULLE', created_at: null }), // conservé (inexploitable)
  ];

  const gardes = docs.filter(isDepuisMiseEnService);
  assert.equal(gardes.length, 4);
  assert.deepEqual(gardes.map((d) => d.numero), [
    'BDC-2026-0100', 'BDC-2026-0142', 'BDC-SANS-DATE', 'BDC-DATE-NULLE',
  ]);
  assert.equal(docs.length - gardes.length, 3, 'nombre d\'écartés exposé au payload');
});
