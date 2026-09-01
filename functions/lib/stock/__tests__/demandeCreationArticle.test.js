'use strict';

/**
 * Tests du mécanisme « le magasinier demande, le DG crée »
 * (functions/lib/stock/demandeCreationArticle).
 *
 * Cas tirés de la production, pas inventés :
 *  - `GENAKTIS`, `TES`, `M.K.P` : parmi les 5 libellés qui ne se rattachent à
 *    aucune fiche (11 lignes sur 4 516) — ce sont les refus réels ;
 *  - `RHIZO MN ZN` → `RHIZO MN ZN (KG)` : rattaché par `canon` seule ;
 *  - « rouleau adhésif », « film », « souffleur », « substrat » : les lignes de
 *    BDC en attente que la QA a trouvées bloquées — du matériel qui n'a pas
 *    vocation à être tenu en stock, et qui ne doit donc PAS bloquer une
 *    réception.
 */

const test = require('node:test');
const assert = require('node:assert');

const dca = require('../demandeCreationArticle');
const identite = require('../identiteArticle');

const CATALOGUE = [
  { id: 'Ref-Eng0088', nom: 'RHIZO MN ZN (KG)', unite: 'kg', active: true },
  { id: 'Ref-Eng0051', nom: 'Nitrate de Potasse', unite: 'kg', active: true },
  { id: 'Ref-Eng0052', nom: 'NITRATE DE POTASSE (KG)', active: false, merged_into: 'Ref-Eng0051' },
];
const IDX = identite.indexerFiches(CATALOGUE);

// ---------------------------------------------------------------------------
// 1. Dédoublonnage STRUCTUREL.
//    MUTANT GARDÉ : dédoublonnage neutralisé → rouge.
// ---------------------------------------------------------------------------

test('deux demandes du même article visent le MÊME document', () => {
  // Casse, espaces et suffixe d'unité neutralisés : c'est la règle `canon`,
  // la même que celle de l'identité. Deux magasiniers ne peuvent pas créer
  // deux demandes, même simultanément — c'est le même docId.
  const a = dca.identifiantDemande('GENAKTIS');
  assert.strictEqual(a, dca.identifiantDemande('  genaktis  '));
  assert.strictEqual(a, dca.identifiantDemande('Genaktis'));
  assert.ok(a.startsWith('ACR-'), a);
});

test('l\'identifiant de demande ne contient jamais de caractère interdit par Firestore', () => {
  for (const l of ['M.K.P', 'SEACTIV GENAKTIS 3', 'ACIDE/BASE', 'Maspilan']) {
    const id = dca.identifiantDemande(l);
    assert.ok(id.length > 4, l + ' → ' + id);
    assert.ok(!id.includes('/'), 'un / rendrait le docId invalide : ' + id);
    assert.match(id, /^ACR-[A-Z0-9_]*-?[0-9a-f]{8}$/i, id);
  }
});

test('deux articles DISTINCTS ne partagent jamais un document — l\'identifiant est injectif', () => {
  // La partie lisible du docId est lossy, et c'est assumé. Mesuré par la QA :
  // « NPK 12-12-17 » et « NPK 12 12 17 » y donnaient tous deux
  // ACR-NPK_12_12_17 ; « ACIDE 20% » et « ACIDE 20 » aussi ; « ÉTIQUETTE »
  // devenait ACR-TIQUETTE. Deux articles réellement différents auraient
  // partagé une demande, et le DG n'en aurait vu qu'un.
  const paires = [
    ['NPK 12-12-17', 'NPK 12 12 17'],
    ['ACIDE 20%', 'ACIDE 20'],
    ['ÉTIQUETTE', 'ETIQUETTE 2'],
  ];
  for (const [a, b] of paires) {
    assert.notStrictEqual(
      dca.identifiantDemande(a),
      dca.identifiantDemande(b),
      '« ' + a + ' » et « ' + b + ' » doivent avoir des documents DISTINCTS'
    );
  }
});

test('l\'identifiant reste STABLE pour un même article (le dédoublonnage tient)', () => {
  assert.strictEqual(dca.identifiantDemande('NPK 12-12-17'), dca.identifiantDemande('  npk 12-12-17 '));
  assert.strictEqual(dca.identifiantDemande('ÉTIQUETTE'), dca.identifiantDemande('étiquette'));
});

test('un accent seul ne fait pas disparaître la partie lisible', () => {
  // « ÉTIQUETTE » rendait ACR-TIQUETTE : le É était mangé silencieusement.
  // Le hachage garantit désormais l'unicité même si le lisible reste amputé.
  const id = dca.identifiantDemande('ÉTIQUETTE');
  assert.match(id, /^ACR-.*-[0-9a-f]{8}$/, id);
});

test('un libellé vide ne produit aucune demande', () => {
  assert.strictEqual(dca.identifiantDemande(''), '');
  assert.strictEqual(dca.identifiantDemande(null), '');
});

test('libellesADemander dédoublonne sur la même règle', () => {
  const libelles = dca.libellesADemander([
    { issue: identite.ISSUE_INTROUVABLE, libelle: 'GENAKTIS' },
    { issue: identite.ISSUE_INTROUVABLE, libelle: 'genaktis' },
    { issue: identite.ISSUE_INTROUVABLE, libelle: 'TES' },
  ]);
  assert.deepStrictEqual(libelles, ['GENAKTIS', 'TES']);
});

// ---------------------------------------------------------------------------
// 2. Un cas AMBIGU ne demande pas une création.
// ---------------------------------------------------------------------------

test('un libellé AMBIGU ne produit PAS de demande de création', () => {
  // Deux fiches actives portent déjà ce nom : en créer une troisième
  // aggraverait exactement le défaut que ce chantier ferme. Un cas ambigu se
  // règle par une FUSION.
  const libelles = dca.libellesADemander([
    { issue: identite.ISSUE_AMBIGU, libelle: 'Acide Phosphorique' },
    { issue: identite.ISSUE_INTROUVABLE, libelle: 'TES' },
  ]);
  assert.deepStrictEqual(libelles, ['TES']);
});

test('le message d\'un cas ambigu reste celui du résolveur, pas « demande envoyée »', () => {
  const msg = dca.messageRefus(
    [{ issue: identite.ISSUE_AMBIGU, libelle: 'Acide Phosphorique', erreur: 'ERREUR AMBIGU' }],
    []
  );
  assert.strictEqual(msg, 'ERREUR AMBIGU');
  assert.ok(!msg.includes('demande de création'));
});

// ---------------------------------------------------------------------------
// 2bis. NE PAS créer ne veut pas dire NE RIEN FAIRE.
//
// Le défaut trouvé par la QA en exécutant le vrai handler : sur un BDC portant
// `OPAL` avec deux fiches actives (`OPAL` / `OPAL (L)`), la ligne n'entrait pas
// en stock, AUCUNE demande n'était écrite, ZÉRO alerte n'était émise, et le bon
// affirmait « article absent du catalogue — une demande a été envoyée au DG » :
// faux deux fois. De la marchandise reçue disparaissait sans le moindre signal.
//
// MUTANT GARDÉ : `ecartsASignaler` rendant [] → rouge.
// ---------------------------------------------------------------------------

test('un article AMBIGU produit une ALERTE, même s\'il ne produit pas de demande', () => {
  const ecarts = dca.ecartsASignaler([
    {
      issue: identite.ISSUE_AMBIGU,
      libelle: 'OPAL',
      candidats: [{ id: 'Ref-Pes0031', nom: 'OPAL' }, { id: 'Ref-Pes0032', nom: 'OPAL (L)' }],
    },
  ]);
  assert.strictEqual(ecarts.length, 1, 'ne rien créer ne veut pas dire ne rien signaler');
  assert.strictEqual(ecarts[0].motif, 'ambigu');
  assert.strictEqual(ecarts[0].libelle, 'OPAL');
});

test('l\'alerte d\'ambiguïté dit FUSIONNER, et surtout PAS créer', () => {
  const msg = dca.messageSignalement(
    dca.ecartsASignaler([
      {
        issue: identite.ISSUE_AMBIGU,
        libelle: 'OPAL',
        candidats: [{ id: 'Ref-Pes0031' }, { id: 'Ref-Pes0032' }],
      },
    ]),
    { numero: 'BDC-2026-0117' }
  );
  assert.ok(msg.includes('OPAL'), msg);
  assert.ok(msg.includes('Ref-Pes0031') && msg.includes('Ref-Pes0032'), 'les deux fiches doivent être nommées');
  assert.ok(/FUSIONN/i.test(msg), 'le remède est une fusion : ' + msg);
  assert.ok(/[Nn]e pas créer/.test(msg), 'créer une 3e fiche aggraverait le doublon : ' + msg);
});

test('une ligne SANS ARTICLE est signalée elle aussi — elle échappait à tout', () => {
  // `canon('')` est vide : cette ligne n'était ni demandée, ni signalée, ni
  // même marquée sur le bon.
  const ecarts = dca.ecartsASignaler([{ issue: identite.ISSUE_INTROUVABLE, libelle: '' }]);
  assert.strictEqual(ecarts.length, 1);
  assert.strictEqual(ecarts[0].motif, 'sans_libelle');
  assert.ok(dca.messageSignalement(ecarts, {}).length > 0, 'un signal sans message ne prévient personne');
});

test('INVARIANT : toute résolution fautive produit un signal — demande OU alerte', () => {
  // C'est la propriété qui ferme la panne silencieuse. Aucun cas ne doit
  // pouvoir traverser sans qu'un canal parte.
  const cas = [
    { issue: identite.ISSUE_INTROUVABLE, libelle: 'GENAKTIS' },
    { issue: identite.ISSUE_AMBIGU, libelle: 'OPAL', candidats: [{ id: 'A' }, { id: 'B' }] },
    { issue: identite.ISSUE_INTROUVABLE, libelle: '' },
  ];
  for (const c of cas) {
    const demandes = dca.libellesADemander([c]);
    const signaux = dca.ecartsASignaler([c]);
    assert.strictEqual(
      demandes.length + signaux.length,
      1,
      'exactement un signal attendu pour ' + JSON.stringify(c)
    );
  }
});

test('aucun écart : aucune alerte — on n\'envoie jamais un message vide', () => {
  assert.deepStrictEqual(dca.ecartsASignaler([{ issue: identite.ISSUE_INTROUVABLE, libelle: 'TES' }]), []);
  assert.strictEqual(dca.messageSignalement([], {}), '');
  assert.strictEqual(dca.messageSignalement(null, null), '');
});

// ---------------------------------------------------------------------------
// 2ter. Le motif porté par la ligne est DÉRIVÉ de l'issue.
// ---------------------------------------------------------------------------

test('le motif d\'un article EN DOUBLE ne dit pas « absent », et ne promet aucune demande', () => {
  const motif = dca.motifEcart({
    issue: identite.ISSUE_AMBIGU, libelle: 'OPAL', candidats: [{ id: 'A' }, { id: 'B' }],
  });
  assert.ok(!/absent du catalogue/i.test(motif), 'l\'article est présent — en double : ' + motif);
  assert.ok(!/demande de création/i.test(motif), 'aucune demande n\'est partie : ' + motif);
  assert.ok(/DOUBLE/i.test(motif) && /fusionn/i.test(motif), motif);
});

test('le motif d\'un article INTROUVABLE annonce bien la demande', () => {
  const motif = dca.motifEcart({ issue: identite.ISSUE_INTROUVABLE, libelle: 'GENAKTIS' });
  assert.ok(/absent du catalogue/i.test(motif), motif);
  assert.ok(/demande de création/i.test(motif), motif);
});

test('le motif d\'une ligne SANS article lui est propre', () => {
  const motif = dca.motifEcart({ issue: identite.ISSUE_INTROUVABLE, libelle: '' });
  assert.ok(/sans article/i.test(motif), motif);
  assert.ok(!/demande de création/i.test(motif), 'rien à créer : ' + motif);
});

// ---------------------------------------------------------------------------
// 3. Le document de demande.
// ---------------------------------------------------------------------------

test('la demande porte le libellé, sa clé, le demandeur et le contexte', () => {
  const { id, data } = dca.construireDemande({
    libelle: 'GENAKTIS',
    demandePar: { uid: 'u1', profileId: 'magasinier', name: 'Youssef' },
    contexte: { origine: 'create-movement', type: 'sortie', numero: 'BS-2026-0012' },
    maintenant: 1756600000000,
  });
  assert.match(id, /^ACR-GENAKTIS-[0-9a-f]{8}$/, id);
  assert.strictEqual(data.libelle, 'GENAKTIS');
  assert.strictEqual(data.cle, 'GENAKTIS');
  assert.strictEqual(data.statut, dca.STATUT_EN_ATTENTE);
  assert.strictEqual(data.derniere_demande_par.name, 'Youssef');
  assert.strictEqual(data.dernier_contexte.numero, 'BS-2026-0012');
  assert.strictEqual(data.derniere_demande_at, 1756600000000);
});

test('re-demander ROUVRE la demande (le DG a pu créer puis supprimer la fiche)', () => {
  const { data } = dca.construireDemande({ libelle: 'TES', maintenant: 1 });
  assert.strictEqual(data.statut, dca.STATUT_EN_ATTENTE);
  assert.strictEqual(data.cree_at, null, 'la clôture précédente doit être effacée');
  assert.strictEqual(data.cree_article_id, null);
});

// ---------------------------------------------------------------------------
// 4. Le message rendu au magasinier.
// ---------------------------------------------------------------------------

test('le refus NOMME l\'article ET annonce que la demande est partie', () => {
  const msg = dca.messageRefus(
    [{ issue: identite.ISSUE_INTROUVABLE, libelle: 'GENAKTIS', erreur: 'inconnu' }],
    ['GENAKTIS']
  );
  assert.ok(msg.includes('GENAKTIS'), msg);
  assert.ok(msg.includes('demande de création a été envoyée au DG'), msg);
});

test('sans demande enregistrée, le message reste le refus brut — jamais une promesse fausse', () => {
  const msg = dca.messageRefus(
    [{ issue: identite.ISSUE_INTROUVABLE, libelle: 'GENAKTIS', erreur: 'REFUS BRUT' }],
    []
  );
  assert.strictEqual(msg, 'REFUS BRUT');
});

// ---------------------------------------------------------------------------
// 5. La réception ne bloque JAMAIS. Cœur de la décision d'Omar.
//    MUTANT GARDÉ : ligne non résolue produisant quand même un mouvement → rouge.
// ---------------------------------------------------------------------------

test('une réception mixte : les lignes connues entrent, les autres sont écartées', () => {
  const lignes = [
    { article: 'RHIZO MN ZN', quantite_recue: 40 },
    { article: 'rouleau adhésif', quantite_recue: 12 },
    { article: 'souffleur', quantite_recue: 1 },
  ];
  const { retenues, ecartees, resolutions } = dca.partitionnerLignesReception(lignes, IDX);
  assert.deepStrictEqual(retenues.map((l) => l.article), ['RHIZO MN ZN']);
  assert.deepStrictEqual(ecartees.map((l) => l.article), ['rouleau adhésif', 'souffleur']);
  assert.strictEqual(resolutions.length, 2);
  assert.ok(resolutions.every((r) => r.issue === identite.ISSUE_INTROUVABLE));
});

test('une réception 100 %% inconnue ne retient RIEN — mais elle n\'échoue pas', () => {
  const { retenues, ecartees } = dca.partitionnerLignesReception(
    [{ article: 'film', quantite_recue: 3 }, { article: 'substrat', quantite_recue: 5 }],
    IDX
  );
  assert.deepStrictEqual(retenues, [], 'aucun mouvement de stock ne doit être produit');
  assert.strictEqual(ecartees.length, 2, 'les lignes restent, écartées — jamais perdues');
});

test('une ligne écartée est MARQUÉE sur le bon de livraison, jamais retirée', () => {
  const blItems = [
    { article: 'RHIZO MN ZN', quantite_recue: 40 },
    { article: 'souffleur', quantite_recue: 1 },
  ];
  const { ecartees, resolutions } = dca.partitionnerLignesReception(blItems, IDX);
  const marques = dca.marquerLignesEcartees(blItems, ecartees, resolutions);
  assert.strictEqual(marques.length, 2, 'le BL garde TOUTES ses lignes');
  assert.strictEqual(marques[0].hors_stock, undefined, 'la ligne retenue n\'est pas marquée');
  assert.strictEqual(marques[1].hors_stock, true);
  assert.ok(marques[1].hors_stock_motif.includes('demande de création'), marques[1].hors_stock_motif);
});

test('une ligne NON LIVRÉE (quantite_recue = 0) n\'est JAMAIS marquée hors_stock', () => {
  // L'appariement se faisait par `canon(article)` : la ligne à 0, que la
  // partition n'examine même pas, héritait du marquage de son homonyme reçu.
  // Une ligne non livrée aurait porté un motif d'écart de stock, qui n'a aucun
  // sens pour elle.
  const blItems = [
    { article: 'souffleur', quantite_recue: 0 },
    { article: 'souffleur', quantite_recue: 2 },
  ];
  const { ecartees, resolutions } = dca.partitionnerLignesReception(
    blItems.filter((it) => it.quantite_recue > 0),
    IDX
  );
  const marques = dca.marquerLignesEcartees(blItems, ecartees, resolutions);
  assert.strictEqual(marques[0].hors_stock, undefined, 'la ligne non livrée ne doit pas être marquée');
  assert.strictEqual(marques[1].hors_stock, true, 'la ligne réellement reçue, elle, l\'est');
});

test('le motif marqué sur la ligne suit son issue : double ≠ absent', () => {
  const idxDouble = identite.indexerFiches([
    { id: 'Ref-Pes0031', nom: 'OPAL', active: true },
    { id: 'Ref-Pes0032', nom: 'OPAL (L)', active: true },
  ]);
  const blItems = [{ article: 'OPAL', quantite_recue: 5 }];
  const { ecartees, resolutions } = dca.partitionnerLignesReception(blItems, idxDouble);
  assert.strictEqual(ecartees.length, 1, 'un article ambigu n\'entre pas en stock');
  const marques = dca.marquerLignesEcartees(blItems, ecartees, resolutions);
  assert.strictEqual(marques[0].hors_stock, true);
  assert.ok(
    !/absent du catalogue/i.test(marques[0].hors_stock_motif),
    'le motif mentait : l\'article est présent, en double — ' + marques[0].hors_stock_motif
  );
  assert.ok(/fusionn/i.test(marques[0].hors_stock_motif), marques[0].hors_stock_motif);
});

test('une ligne SANS article est écartée ET marquée', () => {
  // `canon('')` étant vide, elle n'était pas même marquée.
  const blItems = [{ article: '', quantite_recue: 3 }];
  const { retenues, ecartees, resolutions } = dca.partitionnerLignesReception(blItems, IDX);
  assert.deepStrictEqual(retenues, [], 'sans article, rien n\'entre en stock');
  const marques = dca.marquerLignesEcartees(blItems, ecartees, resolutions);
  assert.strictEqual(marques[0].hors_stock, true, 'la ligne doit porter la trace de son écart');
  assert.ok(/sans article/i.test(marques[0].hors_stock_motif), marques[0].hors_stock_motif);
});

test('la partition suit merged_into : une fiche fusionnée est RETENUE', () => {
  const { retenues, ecartees } = dca.partitionnerLignesReception(
    [{ article: 'NITRATE DE POTASSE (KG)', quantite_recue: 100 }],
    IDX
  );
  assert.strictEqual(retenues.length, 1, 'un article fusionné entre en stock, chez son maître');
  assert.strictEqual(ecartees.length, 0);
});

// ---------------------------------------------------------------------------
// 6. Clôture automatique — même règle `canon` que le reste.
//    MUTANT GARDÉ : clôture désactivée → rouge.
// ---------------------------------------------------------------------------

test('une demande se clôt dès qu\'une fiche porte le libellé, à la casse près', () => {
  const aClore = dca.demandesAClore(
    [
      { id: 'ACR-RHIZO_MN_ZN', libelle: 'RHIZO MN ZN', statut: dca.STATUT_EN_ATTENTE },
      { id: 'ACR-GENAKTIS', libelle: 'GENAKTIS', statut: dca.STATUT_EN_ATTENTE },
    ],
    IDX
  );
  // `RHIZO MN ZN` se résout à `RHIZO MN ZN (KG)` par `canon` : la clôture suit
  // exactement la règle d'identité, elle ne réimplémente aucune comparaison.
  assert.deepStrictEqual(aClore, [{ id: 'ACR-RHIZO_MN_ZN', article_id: 'Ref-Eng0088' }]);
});

test('une demande déjà close n\'est pas re-clôturée', () => {
  const aClore = dca.demandesAClore(
    [{ id: 'ACR-RHIZO_MN_ZN', libelle: 'RHIZO MN ZN', statut: dca.STATUT_CREE }],
    IDX
  );
  assert.deepStrictEqual(aClore, []);
});

test('la clôture enregistre la fiche qui a satisfait la demande', () => {
  const [c] = dca.demandesAClore(
    [{ id: 'ACR-X', libelle: 'NITRATE DE POTASSE (KG)', statut: dca.STATUT_EN_ATTENTE }],
    IDX
  );
  assert.strictEqual(c.article_id, 'Ref-Eng0051', 'la chaîne merged_into est suivie');
});

// ---------------------------------------------------------------------------
// 7. Le message WhatsApp au DG.
// ---------------------------------------------------------------------------

test('le WhatsApp NOMME l\'article : une alerte muette ne serait pas traitée', () => {
  const msg = dca.messageWhatsApp(['GENAKTIS'], { name: 'Youssef' });
  assert.ok(msg.includes('GENAKTIS'), msg);
  assert.ok(msg.includes('Youssef'), msg);
});

test('plusieurs articles : un seul message, tous nommés', () => {
  const msg = dca.messageWhatsApp(['TES', 'M.K.P'], { profileId: 'magasinier' });
  assert.ok(msg.includes('TES') && msg.includes('M.K.P'), msg);
  assert.ok(msg.startsWith('2 articles'), msg);
});

test('aucun article : aucun message (on n\'envoie pas une alerte vide)', () => {
  assert.strictEqual(dca.messageWhatsApp([], {}), '');
  assert.strictEqual(dca.messageWhatsApp(null, null), '');
});

// ---------------------------------------------------------------------------
// 8. Robustesse.
// ---------------------------------------------------------------------------

test('entrées nulles : aucune exception', () => {
  assert.deepStrictEqual(dca.libellesADemander(null), []);
  assert.deepStrictEqual(dca.demandesAClore(null, IDX), []);
  assert.deepStrictEqual(dca.partitionnerLignesReception(null, IDX).retenues, []);
  assert.deepStrictEqual(dca.marquerLignesEcartees(null, null), []);
  assert.strictEqual(dca.messageRefus(null, null), '');
});
