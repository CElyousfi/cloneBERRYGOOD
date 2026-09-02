'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  STATUT_RECEPTION_A_LA_CREATION,
  resoudreMagasinDestination,
  lignesDepuisBl,
  sourcesPrixDepuisBdc,
  construireItemsReception,
  construireMouvementReception,
  valoriserItemsReception,
} = require('../receptionBdc');
const { MOTIF } = require('../prixLigne');
const { isImpactApplied } = require('../../stock/movementImpact');

// BDC réel de production (BDC-2026-0165, TIMAC AGRO MAROC) : les prix y sont
// des CHAÎNES, pas des nombres — c'est la forme que Firestore renvoie.
const BDC_REEL = {
  numero: 'BDC-2026-0165',
  fournisseur: { nom: 'TIMAC AGRO MAROC' },
  items: [
    { article: 'Fertiactyl GZ', categorie: 'Engrais', quantite: '40', unite: 'L', prix_unitaire: '116.16' },
  ],
};

// --------------------------------------------------------------------------
// Lignes du BL → lignes de stock
// --------------------------------------------------------------------------

test('seules les lignes réellement reçues deviennent des lignes de stock', () => {
  const lignes = lignesDepuisBl([
    { article: 'A', quantite_recue: 5, unite: 'kg' },
    { article: 'B', quantite_recue: 0, unite: 'kg' },
    { article: 'C', quantite_recue: 2.5, unite: 'L' },
  ]);
  assert.deepEqual(lignes.map((l) => l.article_nom), ['A', 'C']);
  assert.equal(lignes[1].quantite, 2.5);
  assert.equal(lignes[1].unite, 'L');
});

test('une quantité en chaîne est lue comme un nombre', () => {
  const lignes = lignesDepuisBl([{ article: 'A', quantite_recue: '12.5', unite: 'kg' }]);
  assert.equal(lignes[0].quantite, 12.5);
});

test('unité absente → AUCUNE unité fabriquée', () => {
  // Le repli historique posait 'kg'. Cette unité inventée redevenait ensuite un
  // critère de refus dans prixLigne : le prix du BDC était perdu pour
  // « divergence » avec une unité qui n'avait jamais existé. 85,7 % des lignes
  // de BDC en production sont dans ce cas.
  const lignes = lignesDepuisBl([{ article: 'A', quantite_recue: 1 }]);
  assert.equal(lignes[0].unite, '', 'aucune unité ne doit être inventée');
});

test('BDC sans unité : la ligne entre en stock AVEC son prix', () => {
  // Bout en bout, sur la forme dominante en production.
  const { items, resume } = construireItemsReception(
    [{ article: 'FILM SUNN ASFI BLANC EVA EN 160', quantite_recue: 4430 }],
    { numero: 'BC-000001', items: [{ article: 'FILM SUNN ASFI BLANC EVA EN 160', quantite: '4430', unite: '', prix_unitaire: '25' }] }
  );
  assert.equal(items[0].prix_unitaire, 25, '110 750 DH HT entreraient en stock non valorisés');
  assert.equal(items[0].prix_source, 'bon_commande');
  assert.equal(items[0].prix_unite_verifiee, false, 'prix retenu, mais vérification impossible : ça doit rester visible');
  assert.equal(resume.valorisees, 1);
});

test('unités connues et identiques : aucun drapeau d\'invérifiabilité', () => {
  const { items } = construireItemsReception(
    [{ article: 'Fertiactyl GZ', quantite_recue: 40, unite: 'L' }],
    BDC_REEL
  );
  assert.equal(items[0].prix_unitaire, 116.16);
  assert.ok(!('prix_unite_verifiee' in items[0]), 'la comparaison a eu lieu : rien à signaler');
});

test('BL vide ou absent → aucune ligne, aucun crash', () => {
  assert.deepEqual(lignesDepuisBl([]), []);
  assert.deepEqual(lignesDepuisBl(null), []);
  assert.deepEqual(lignesDepuisBl(undefined), []);
});

// --------------------------------------------------------------------------
// BDC → source de prix
// --------------------------------------------------------------------------

test('les lignes du BDC deviennent une source de prix référencée par son numéro', () => {
  const src = sourcesPrixDepuisBdc(BDC_REEL);
  assert.equal(src.length, 1);
  assert.equal(src[0].article, 'Fertiactyl GZ');
  assert.equal(src[0].prix_unitaire, '116.16');
  assert.equal(src[0].reference, 'BDC-2026-0165');
});

test('BDC absent ou sans lignes → source vide, aucun crash', () => {
  assert.deepEqual(sourcesPrixDepuisBdc(null), []);
  assert.deepEqual(sourcesPrixDepuisBdc({}), []);
  assert.deepEqual(sourcesPrixDepuisBdc({ items: null }), []);
});

// --------------------------------------------------------------------------
// Le branchement complet — c'est ici que vivait le défaut d'origine
// --------------------------------------------------------------------------

test('cas nominal : la ligne reçoit le prix du BDC, en nombre', () => {
  const { items, resume } = construireItemsReception(
    [{ article: 'Fertiactyl GZ', quantite_recue: 40, unite: 'L' }],
    BDC_REEL
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].prix_unitaire, 116.16);
  assert.equal(typeof items[0].prix_unitaire, 'number', 'le prix doit être un nombre, pas la chaîne du BDC');
  assert.equal(items[0].prix_source, 'bon_commande');
  assert.equal(items[0].prix_reference, 'BDC-2026-0165');
  assert.equal(resume.valorisees, 1);
  assert.equal(resume.non_valorisees, 0);
});

test('article absent du BDC : la ligne entre en stock SANS prix, jamais à zéro', () => {
  // C'était le défaut : `prix_unitaire: bdcItem ? ... : 0` posait un 0 crédible.
  const { items, resume } = construireItemsReception(
    [{ article: 'ARTICLE HORS BDC', quantite_recue: 7, unite: 'kg' }],
    BDC_REEL
  );
  assert.equal(items.length, 1, 'la ligne entre en stock malgré tout');
  assert.equal(items[0].quantite, 7);
  assert.ok(!('prix_unitaire' in items[0]), 'aucun prix_unitaire, surtout pas 0');
  assert.equal(items[0].prix_source, null);
  assert.equal(items[0].prix_motif, MOTIF.AUCUNE_SOURCE);
  assert.equal(resume.non_valorisees, 1);
});

test('prix du BDC illisible : la ligne entre en stock SANS prix, jamais à zéro', () => {
  // C'était le second zéro : `parseFloat(bdcItem.prix_unitaire) || 0`.
  const { items } = construireItemsReception(
    [{ article: 'Fertiactyl GZ', quantite_recue: 40, unite: 'L' }],
    { numero: 'BDC-X', items: [{ article: 'Fertiactyl GZ', unite: 'L', prix_unitaire: 'à confirmer' }] }
  );
  assert.ok(!('prix_unitaire' in items[0]));
  assert.equal(items[0].prix_motif, MOTIF.PRIX_NON_POSITIF);
});

test('prix du BDC à zéro : la ligne entre en stock SANS prix, jamais à zéro', () => {
  const { items } = construireItemsReception(
    [{ article: 'Fertiactyl GZ', quantite_recue: 40, unite: 'L' }],
    { numero: 'BDC-X', items: [{ article: 'Fertiactyl GZ', unite: 'L', prix_unitaire: 0 }] }
  );
  assert.ok(!('prix_unitaire' in items[0]));
  assert.equal(items[0].prix_motif, MOTIF.PRIX_NON_POSITIF);
});

test('rapprochement : un accent de différence ne fait plus perdre le prix', () => {
  // Avec l'égalité stricte en minuscules de create-bl, cette ligne partait à 0.
  const { items } = construireItemsReception(
    [{ article: 'UREE', quantite_recue: 100, unite: 'kg' }],
    { numero: 'BDC-X', items: [{ article: 'Urée', unite: 'kg', prix_unitaire: '6.2' }] }
  );
  assert.equal(items[0].prix_unitaire, 6.2);
  assert.equal(items[0].prix_source, 'bon_commande');
});

test('unité divergente entre BDC et réception : aucun prix inventé', () => {
  const { items } = construireItemsReception(
    [{ article: 'ACIDE PHOSPHORIQUE', quantite_recue: 10, unite: 'L' }],
    { numero: 'BDC-X', items: [{ article: 'ACIDE PHOSPHORIQUE', unite: 'kg', prix_unitaire: 8.083 }] }
  );
  assert.ok(!('prix_unitaire' in items[0]));
  assert.equal(items[0].prix_motif, MOTIF.UNITE_DIVERGENTE);
});

test('la facture prime sur le BDC dès qu\'elle est fournie (câblage prêt)', () => {
  const { items } = construireItemsReception(
    [{ article: 'Fertiactyl GZ', quantite_recue: 40, unite: 'L' }],
    BDC_REEL,
    { facture: [{ article: 'Fertiactyl GZ', unite: 'L', prix_unitaire: 120, quantite: 40, reference: '159814' }] }
  );
  assert.equal(items[0].prix_source, 'facture');
  assert.equal(items[0].prix_unitaire, 120);
  assert.equal(items[0].prix_reference, '159814');
});

// --------------------------------------------------------------------------
// Invariante de conservation, au niveau du branchement
// --------------------------------------------------------------------------

test('conservation : toute ligne reçue entre en stock, valorisée ou non', () => {
  const blItems = [
    { article: 'Fertiactyl GZ', quantite_recue: 40, unite: 'L' },   // au BDC
    { article: 'HORS BDC', quantite_recue: 3, unite: 'kg' },        // pas au BDC
    { article: 'UNITE KO', quantite_recue: 1, unite: 'L' },         // unité divergente
    { article: 'NON LIVRE', quantite_recue: 0, unite: 'kg' },       // non reçue
  ];
  const bdc = {
    numero: 'BDC-X',
    items: [
      { article: 'Fertiactyl GZ', unite: 'L', prix_unitaire: '116.16' },
      { article: 'UNITE KO', unite: 'kg', prix_unitaire: 5 },
    ],
  };
  const { items, resume } = construireItemsReception(blItems, bdc);

  // 3 lignes reçues sur 4 : la seule exclue est celle à quantité nulle.
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.article_nom), ['Fertiactyl GZ', 'HORS BDC', 'UNITE KO']);
  // La quantité totale reçue est intégralement conservée.
  assert.equal(items.reduce((s, i) => s + i.quantite, 0), 44);
  // Aucune ligne ne porte un prix nul.
  for (const i of items) {
    if ('prix_unitaire' in i) assert.ok(i.prix_unitaire > 0, 'prix non strictement positif : ' + JSON.stringify(i));
  }
  assert.deepEqual(resume, {
    total: 3,
    valorisees: 1,
    non_valorisees: 2,
    non_verifiees: 0,
    par_source: { bon_commande: 1 },
    par_motif: { [MOTIF.AUCUNE_SOURCE]: 1, [MOTIF.UNITE_DIVERGENTE]: 1 },
  });
});

test('conservation : aucune ligne reçue → aucune réception créée', () => {
  const { items } = construireItemsReception([{ article: 'A', quantite_recue: 0, unite: 'kg' }], BDC_REEL);
  assert.equal(items.length, 0);
});

// --------------------------------------------------------------------------
// Le document de mouvement complet
//
// C'est ici que se décide le fait central du chantier : la réception entre en
// stock à la création. Ces tests le VÉRIFIENT via isImpactApplied — la même
// fonction que le reste de la stack utilise pour juger si un mouvement pèse sur
// les soldes — plutôt que de comparer une chaîne de statut à une autre chaîne.
// --------------------------------------------------------------------------

const PARAMS = {
  numero: 'BR-2026-0084',
  blItems: [{ article: 'Fertiactyl GZ', quantite_recue: 40, unite: 'L' }],
  bdc: BDC_REEL,
  magasinDemande: 'F5',
  bdcId: 'bdc123',
  blId: 'bl456',
  date: '2026-08-27',
  refBlFournisseur: 'BL-9911',
  scanUrl: null,
  createdBy: { userId: 'uid-magasinier', name: 'Resp. Magasin', profileId: 'magasinier' },
  maintenant: 1787000000000,
};

test('la réception est créée dans un statut qui PORTE l\'impact stock', () => {
  const mov = construireMouvementReception(PARAMS);
  assert.ok(mov, 'un mouvement doit être construit');
  assert.equal(
    isImpactApplied(mov),
    true,
    'la marchandise doit entrer en stock dès la création — c\'est tout l\'objet du chantier'
  );
  assert.equal(mov.status, STATUT_RECEPTION_A_LA_CREATION);
});

test('en_attente_achats ne porte PAS l\'impact stock (ce que le chantier corrige)', () => {
  // Garde-fou : si un jour le statut de création repassait à en_attente_achats,
  // le test ci-dessus tomberait — voici pourquoi.
  const mov = construireMouvementReception(PARAMS);
  assert.equal(isImpactApplied({ ...mov, status: 'en_attente_achats' }), false);
});

test('le document porte les lignes valorisées, pas les lignes brutes du BL', () => {
  const mov = construireMouvementReception(PARAMS);
  assert.equal(mov.items.length, 1);
  assert.equal(mov.items[0].article_nom, 'Fertiactyl GZ');
  assert.equal(mov.items[0].quantite, 40);
  assert.equal(mov.items[0].prix_unitaire, 116.16);
  assert.equal(mov.items[0].prix_source, 'bon_commande');
  // Les lignes du BL (quantite_recue / article) ne doivent PAS fuiter telles quelles.
  assert.ok(!('quantite_recue' in mov.items[0]), 'les lignes brutes du BL ne doivent pas être écrites');
  assert.ok(!('article' in mov.items[0]));
});

test('le document est complet et cohérent avec ce qu\'attend la collection', () => {
  const mov = construireMouvementReception(PARAMS);
  // `article_ref` est le SEUL champ dont applyStockImpact se sert pour ranger le
  // stock : la clé de solde est `${lieu_type}_${lieu_id}_${article_ref}`. Vide,
  // elle devient `magasin_F5_` et TOUS les articles de TOUTES les réceptions
  // fusionnent dans un unique document de solde. Dans un lot qui fait tirer
  // applyStockImpact dès la création, c'est le champ le plus coûteux à perdre.
  assert.equal(mov.items[0].article_ref, 'Fertiactyl GZ');
  assert.equal(mov.items[0].article_nom, 'Fertiactyl GZ');
  assert.equal(mov.numero, 'BR-2026-0084');
  assert.equal(mov.type, 'reception');
  assert.equal(mov.date, '2026-08-27');
  assert.deepEqual(mov.lieu_destination, { type: 'magasin', id: 'F5' });
  assert.equal(mov.lieu_source, null);
  assert.equal(mov.ferme, 'F5');
  assert.equal(mov.bdc_id, 'bdc123');
  assert.equal(mov.bl_id, 'bl456');
  assert.equal(mov.ref_bl_fournisseur, 'BL-9911');
  assert.ok(!('reception_libre' in mov), 'la réception libre est supprimée : le champ n\'est plus écrit');
  assert.ok(!('reception_libre_motif' in mov));
  assert.equal(mov.rejection, null);
  assert.equal(mov.created_by.userId, 'uid-magasinier');
  assert.deepEqual(mov.validations.magasinier, { by: 'uid-magasinier', name: 'Resp. Magasin', at: 1787000000000 });
  assert.equal(mov.created_at, 1787000000000);
});

test('le résumé de valorisation est écrit sur le mouvement (traçabilité)', () => {
  const mov = construireMouvementReception({
    ...PARAMS,
    blItems: [
      { article: 'Fertiactyl GZ', quantite_recue: 40, unite: 'L' },
      { article: 'HORS BDC', quantite_recue: 3, unite: 'kg' },
    ],
  });
  assert.deepEqual(mov.valorisation, {
    total: 2,
    valorisees: 1,
    non_valorisees: 1,
    non_verifiees: 0,
    par_source: { bon_commande: 1 },
    par_motif: { [MOTIF.AUCUNE_SOURCE]: 1 },
  });
});

test('aucune ligne réellement reçue → null, aucune réception à créer', () => {
  const mov = construireMouvementReception({
    ...PARAMS,
    blItems: [{ article: 'Fertiactyl GZ', quantite_recue: 0, unite: 'L' }],
  });
  assert.equal(mov, null);
});

test('aucun prix nul n\'est jamais écrit dans le document', () => {
  const mov = construireMouvementReception({
    ...PARAMS,
    blItems: [
      { article: 'Fertiactyl GZ', quantite_recue: 40, unite: 'L' },
      { article: 'HORS BDC', quantite_recue: 3, unite: 'kg' },
      { article: 'PRIX ZERO', quantite_recue: 1, unite: 'kg' },
    ],
    bdc: {
      numero: 'BDC-X',
      items: [
        { article: 'Fertiactyl GZ', unite: 'L', prix_unitaire: '116.16' },
        { article: 'PRIX ZERO', unite: 'kg', prix_unitaire: 0 },
      ],
    },
  });
  assert.equal(mov.items.length, 3, 'les 3 lignes reçues entrent en stock');
  for (const i of mov.items) {
    assert.ok(
      !('prix_unitaire' in i) || i.prix_unitaire > 0,
      'prix nul ou négatif écrit : ' + JSON.stringify(i)
    );
  }
});

// --------------------------------------------------------------------------
// create-movement : le SECOND chemin de création d'une réception
//
// Il existe en production (2 réceptions, juin 2026, toutes deux sans BDC). Il
// créait des réceptions en `en_attente_achats` — la même impasse que create-bl,
// par une autre porte. Il traverse désormais la MÊME décision de prix.
// --------------------------------------------------------------------------

test('create-movement : lignes déjà au format stock, valorisées par le BDC lié', () => {
  const { items, resume } = valoriserItemsReception(
    [{ article_ref: 'Fertiactyl GZ', article_nom: 'Fertiactyl GZ', quantite: 40, unite: 'L' }],
    BDC_REEL
  );
  assert.equal(items[0].prix_unitaire, 116.16);
  assert.equal(items[0].prix_source, 'bon_commande');
  assert.equal(resume.valorisees, 1);
});

test('create-movement sans BDC : aucune source, aucune ligne valorisée, aucun zéro', () => {
  // C'est le cas RÉEL des 2 réceptions de production issues de ce chemin :
  // reception_libre, sans bdc_id, donc sans aucune source de prix.
  const { items, resume } = valoriserItemsReception(
    [
      { article_ref: 'MASAMITE', article_nom: 'MASAMITE', quantite: 2, unite: 'kg' },
      { article_ref: 'SMART PH', article_nom: 'SMART PH', quantite: 5, unite: 'L' },
    ],
    null
  );
  assert.equal(items.length, 2, 'les lignes entrent en stock malgré l\'absence de prix');
  for (const i of items) {
    assert.ok(!('prix_unitaire' in i), 'aucun prix inventé : ' + JSON.stringify(i));
    assert.equal(i.prix_motif, MOTIF.AUCUNE_SOURCE);
  }
  assert.equal(resume.valorisees, 0);
  assert.equal(resume.non_valorisees, 2);
});

test('create-movement : la quantité entre en stock intégralement, valorisée ou non', () => {
  const lignes = [
    { article_ref: 'Fertiactyl GZ', article_nom: 'Fertiactyl GZ', quantite: 40, unite: 'L' },
    { article_ref: 'INCONNU', article_nom: 'INCONNU', quantite: 12, unite: 'kg' },
  ];
  const { items } = valoriserItemsReception(lignes, BDC_REEL);
  assert.equal(items.length, 2);
  assert.equal(items.reduce((s, i) => s + i.quantite, 0), 52);
});

// RÉPLIQUES des deux mappings du monolithe (functions/index.js).
//
// La version précédente de ce test alimentait les deux chemins avec des items
// écrits à la main, en contournant précisément les mappings où la divergence
// est née : create-movement fabriquait `unite: 'kg'` là où create-bl conservait
// l'absence, et le test ne voyait rien. Un test d'équivalence qui court-circuite
// ce qui diffère ne mesure pas l'équivalence.
//
// Ces répliques sont tenues alignées par les assertions de source de
// createBlContrat.test.js (« les DEUX chemins appliquent la même règle d'unité »).

/** Réplique du mapping blItems de create-bl (functions/index.js:7534). */
function mappingCreateBl(itemsSaisis) {
  return (itemsSaisis || []).map((it) => ({
    article: it.article || '',
    quantite_commandee: parseFloat(it.quantite_commandee) || 0,
    quantite_recue: parseFloat(it.quantite_recue) || 0,
    unite: it.unite || '',
    note: it.note || '',
  }));
}

/** Réplique du mapping movItems de create-movement (functions/index.js:11534). */
function mappingCreateMovement(itemsSaisis) {
  return (itemsSaisis || []).map((it) => ({
    article_ref: it.article_ref || it.article || '',
    article_nom: it.article_nom || it.article || '',
    quantite: parseFloat(it.quantite) || 0,
    unite: it.unite || '',
  }));
}

test('les deux chemins donnent le MÊME prix, mappings du monolithe traversés', () => {
  // BDC en L, saisie SANS unité : la forme exacte qui faisait diverger les deux
  // chemins (create-bl → 116.16, create-movement → refus pour unité divergente).
  const bdc = { numero: 'BDC-X', ferme: 'F5', items: [{ article: 'Fertiactyl GZ', quantite: '40', unite: 'L', prix_unitaire: '116.16' }] };

  const parBl = construireItemsReception(
    mappingCreateBl([{ article: 'Fertiactyl GZ', quantite_commandee: 40, quantite_recue: 40 }]),
    bdc
  );
  const parMouvement = valoriserItemsReception(
    mappingCreateMovement([{ article: 'Fertiactyl GZ', quantite: 40 }]),
    bdc
  );

  assert.equal(parBl.items[0].prix_unitaire, 116.16, 'create-bl doit valoriser');
  assert.equal(
    parMouvement.items[0].prix_unitaire, parBl.items[0].prix_unitaire,
    'même livraison, même BDC, deux chemins : le prix DOIT être identique'
  );
  assert.equal(parMouvement.items[0].prix_source, parBl.items[0].prix_source);
  assert.deepEqual(parMouvement.resume, parBl.resume);
});

test('les deux chemins concordent aussi quand le BDC n\'a pas d\'unité', () => {
  const bdc = { numero: 'BC-000001', ferme: 'F5', items: [{ article: 'FILM SUNN', quantite: '4430', unite: '', prix_unitaire: '25' }] };
  const parBl = construireItemsReception(mappingCreateBl([{ article: 'FILM SUNN', quantite_recue: 4430 }]), bdc);
  const parMouvement = valoriserItemsReception(mappingCreateMovement([{ article: 'FILM SUNN', quantite: 4430 }]), bdc);
  assert.equal(parBl.items[0].prix_unitaire, 25);
  assert.equal(parMouvement.items[0].prix_unitaire, 25);
  assert.deepEqual(parMouvement.resume, parBl.resume);
});

test('les deux chemins concordent aussi sur un REFUS de divergence réelle', () => {
  // L'équivalence doit tenir dans les deux sens : refuser des deux côtés, aussi.
  const bdc = { numero: 'BDC-Y', ferme: 'F5', items: [{ article: 'ACIDE', quantite: '10', unite: 'kg', prix_unitaire: '8' }] };
  const parBl = construireItemsReception(mappingCreateBl([{ article: 'ACIDE', quantite_recue: 10, unite: 'L' }]), bdc);
  const parMouvement = valoriserItemsReception(mappingCreateMovement([{ article: 'ACIDE', quantite: 10, unite: 'L' }]), bdc);
  assert.ok(!('prix_unitaire' in parBl.items[0]));
  assert.ok(!('prix_unitaire' in parMouvement.items[0]));
  assert.equal(parMouvement.items[0].prix_motif, parBl.items[0].prix_motif);
});


// --------------------------------------------------------------------------
// Destination : une réception sans destination crédite un solde... nulle part
//
// `lieu_destination.id` vide + statut `valide_chef` = mouvement DÉCLARÉ
// impactant qu'applyStockImpact ne crédite nulle part. Les soldes divergent du
// grand livre en silence. La règle appartient donc au module, pas à l'appelant.
// --------------------------------------------------------------------------

test('destination : le magasin choisi prime sur la ferme du BDC', () => {
  assert.equal(resoudreMagasinDestination('F2', { ferme: 'F5' }), 'F2');
});

test('destination : à défaut de magasin choisi, la ferme du BDC', () => {
  assert.equal(resoudreMagasinDestination('', { ferme: 'F5' }), 'F5');
  assert.equal(resoudreMagasinDestination(null, { ferme: 'F5' }), 'F5');
  assert.equal(resoudreMagasinDestination(undefined, { ferme: 'F5' }), 'F5');
});

test('destination : les blancs ne valent pas une destination', () => {
  assert.equal(resoudreMagasinDestination('   ', { ferme: 'F5' }), 'F5');
  assert.equal(resoudreMagasinDestination('   ', { ferme: '  ' }), '');
});

test('destination : ni magasin ni ferme → indéterminable', () => {
  assert.equal(resoudreMagasinDestination('', {}), '');
  assert.equal(resoudreMagasinDestination(null, null), '');
});

test('AUCUN mouvement n\'est construit sans destination', () => {
  assert.throws(
    () => construireMouvementReception({ ...PARAMS, magasinDemande: '', bdc: { ...BDC_REEL, ferme: '' } }),
    /Destination de réception indéterminable/,
    'un mouvement sans destination serait déclaré impactant sans rien créditer'
  );
});

test('la destination du mouvement vient bien de la résolution', () => {
  const parDefaut = construireMouvementReception({ ...PARAMS, magasinDemande: '', bdc: { ...BDC_REEL, ferme: 'F5' } });
  assert.equal(parDefaut.lieu_destination.id, 'F5');
  assert.equal(parDefaut.ferme, 'F5');

  const choisi = construireMouvementReception({ ...PARAMS, magasinDemande: 'F2', bdc: { ...BDC_REEL, ferme: 'F5' } });
  assert.equal(choisi.lieu_destination.id, 'F2');
  assert.equal(choisi.ferme, 'F2');
});


test('chaque article garde une clé de solde DISTINCTE', () => {
  // Le champ ne suffit pas : ce qui compte est que deux articles différents ne
  // se rangent pas au même endroit. On réplique ici la clé d'updateStockBalance
  // (functions/index.js:11117) pour asserter la conséquence, pas seulement la
  // présence du champ.
  const bdc = {
    numero: 'BDC-X', ferme: 'F5',
    items: [
      { article: 'Fertiactyl GZ', quantite: '40', unite: 'L', prix_unitaire: '116.16' },
      { article: 'AMMONITRATE', quantite: '10', unite: 'kg', prix_unitaire: '8' },
    ],
  };
  const mov = construireMouvementReception({
    ...PARAMS,
    bdc,
    blItems: [
      { article: 'Fertiactyl GZ', quantite_recue: 40, unite: 'L' },
      { article: 'AMMONITRATE', quantite_recue: 10, unite: 'kg' },
    ],
  });
  const cleSolde = (it) =>
    `${mov.lieu_destination.type}_${mov.lieu_destination.id}_${it.article_ref || it.article || ''}`.replace(/\s+/g, '_');
  const cles = mov.items.map(cleSolde);
  assert.deepEqual(cles, ['magasin_F5_Fertiactyl_GZ', 'magasin_F5_AMMONITRATE']);
  assert.equal(new Set(cles).size, mov.items.length, 'deux articles rangés dans le même solde : stock par article détruit');
});
