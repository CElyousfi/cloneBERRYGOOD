'use strict';

/**
 * articleSelect — la sélection FERMÉE d'un article de catalogue.
 *
 * Demande d'Omar : « on passe l'article du bon de consommation en liste
 * déroulante avec champ de sélection en tapant le nom. Comme ça on règle le
 * problème. »
 *
 * Ce que la suite doit rendre IMPOSSIBLE :
 *  1. accepter une saisie qui n'est pas au catalogue ;
 *  2. valider silencieusement un libellé AMBIGU (2+ fiches actives) ;
 *  3. remplacer la recherche tolérante par une égalité stricte ;
 *  4. laisser la clé d'IDENTITÉ diverger de `articleKey.canon` (backend).
 *
 * Fiches réelles du catalogue de production.
 */

const test = require('node:test');
const assert = require('node:assert');

const AS = require('../../public/lib/articleSelect.js');
// Le backend, pour prouver que les deux clés d'identité ne peuvent pas diverger.
const { canon } = require('../../functions/lib/stock/articleKey.js');

const CATALOGUE = [
  // ── LE CAS D'OMAR, avec les VRAIS libellés du catalogue de production.
  // Il tape `sulfate` et se voit proposer « Demander la création au DG »
  // alors que NEUF « Sulfate … » existent. Mesuré sur la prod le 2026-09-02.
  { id: 'SULF_AMM', nom: "Sulfate d'ammoniaque", active: true, unite: 'KG' },
  { id: 'SULF_AMO', nom: "Sulfate d'ammonium", active: true, unite: 'KG' },
  { id: 'SULF_CU', nom: 'Sulfate de Cuivre', active: true, unite: 'KG' },
  { id: 'SULF_FE', nom: 'Sulfate de fer', active: true, unite: 'KG' },
  { id: 'SULF_MG', nom: 'Sulfate de Magnesie', active: true, unite: 'KG' },
  { id: 'SULF_POT', nom: 'Sulfat de potasse', active: true, unite: 'KG' },
  { id: 'Ref-Eng0056', nom: 'Rhizo amine', active: true, unite: 'KG' },
  { id: 'Ref-Eng0057', nom: 'Rhizo MnZn', active: true, unite: 'KG' },
  { id: 'IMP-022', nom: 'RHIZO MN ZN (KG)', active: true, unite: 'L' },
  { id: 'KELPAK', nom: 'KELPAK', active: true, unite: 'L' },
  { id: 'Ref-Eng0001', nom: 'Acide Nitrique', active: true, unite: 'KG' },
  { id: 'Ref-Eng0002', nom: 'ACIDE PHOSPHORIQUE (L)', active: true, unite: 'Kg' },
  { id: 'SEQ', nom: 'Séquestrène', active: true, unite: 'KG' },
  // Deux fiches ACTIVES de même identité : le cas ambigu, mesuré ~105 fois.
  { id: 'Ref-Eng0052', nom: 'OPAL', active: true, unite: 'L' },
  { id: 'Ref-Eng0177', nom: 'Opal', active: true, unite: 'L' },
  // Ce qui ne doit JAMAIS devenir une option.
  { id: 'DESACTIVE', nom: 'Vieux Produit', active: false },
  { id: 'FUSIONNE', nom: 'Absorbé', active: true, merged_into: 'Ref-Eng0056' },
  { id: 'FANTOME' },
  { id: 'SANS_NOM', nom: '   ', active: true },
];

const IDX = AS.indexerCatalogue(CATALOGUE);
const noms = (liste) => liste.map((e) => e.nom);

// ── La clé d'identité ne peut pas diverger du backend ─────────────────────

test('MUTANT « clé d\'identité maison » : cleIdentite EST canon, à la lettre', () => {
  const cas = [
    'ACIDE PHOSPHORIQUE (L)', 'Acide Phosphorique', '  acide   phosphorique  ',
    'RHIZO MN ZN (KG)', 'Rhizo MnZn', 'KELPAK', 'Séquestrène', 'NPK 12-12-17',
    'OPAL (U)', 'X (ML)', 'Y (UNITE)', 'Z (G)', '', null, undefined, 42,
  ];
  for (const c of cas) {
    assert.equal(
      AS.cleIdentite(c), canon(c),
      'divergence sur ' + JSON.stringify(c) + ' : l\'écran validerait un article que le serveur refuse'
    );
  }
});

test('l\'identité rapproche le suffixe d\'unité — comme le serveur', () => {
  assert.equal(AS.cleIdentite('ACIDE PHOSPHORIQUE (L)'), AS.cleIdentite('Acide Phosphorique'));
  // …et ne rapproche PAS deux libellés que le serveur tient pour distincts.
  assert.notEqual(AS.cleIdentite('Rhizo MnZn'), AS.cleIdentite('RHIZO MN ZN'));
});

// ── Index ─────────────────────────────────────────────────────────────────

test('l\'index n\'expose que des fiches CHOISISSABLES', () => {
  const n = noms(IDX.entrees);
  assert.ok(!n.includes('Vieux Produit'), 'fiche désactivée');
  assert.ok(!n.includes('Absorbé'), 'fiche fusionnée : le serveur la résout vers son maître');
  assert.ok(!n.some((x) => !x.trim()), 'fiche sans nom');
  assert.equal(IDX.entrees.filter((e) => e.cle === '').length, 0);
  for (const mauvais of [null, undefined, {}, { id: 'X' }, { nom: 'Y' }, 'chaine', 42]) {
    assert.equal(AS.ficheChoisissable(mauvais), false, JSON.stringify(mauvais));
  }
});

test('une seule entrée par IDENTITÉ, pas par nom brut', () => {
  // `ACIDE PHOSPHORIQUE (L)` et `Acide Phosphorique` seraient deux lignes
  // indiscernables à l'écran pour un seul article côté serveur.
  const phospho = IDX.entrees.filter((e) => e.cle === 'ACIDE PHOSPHORIQUE');
  assert.equal(phospho.length, 1);
  // `OPAL` / `Opal` : une entrée, marquée ambiguë.
  const opal = IDX.parCle['OPAL'];
  assert.ok(opal);
  assert.equal(opal.ambigu, true);
  assert.equal(opal.fiches.length, 2);
});

test('entrées dégénérées : jamais d\'exception', () => {
  for (const mauvais of [null, undefined, 'x', 42, {}]) {
    assert.deepEqual(AS.indexerCatalogue(mauvais).entrees, []);
    assert.deepEqual(AS.filtrerEntrees(mauvais, 'a'), []);
    assert.equal(AS.verdictChoix(mauvais, 'a').ok, false);
    assert.deepEqual(AS.lignesInvalides(mauvais, IDX), []);
  }
});

// ── Recherche : le magasinier tape vite, sur mobile ───────────────────────

test('MUTANT « égalité stricte » : la recherche tolère casse, accents et espaces', () => {
  const attendus = [
    ['acide phos', 'ACIDE PHOSPHORIQUE (L)'],
    ['ACIDE PHOS', 'ACIDE PHOSPHORIQUE (L)'],
    ['  acide   phos  ', 'ACIDE PHOSPHORIQUE (L)'],
    ['sequestrene', 'Séquestrène'],
    ['SÉQUESTRÈNE', 'Séquestrène'],
    ['rhizomnzn', 'Rhizo MnZn'],
    ['rhizo mn zn', 'Rhizo MnZn'],
    ['kelpak', 'KELPAK'],
  ];
  for (const [saisie, attendu] of attendus) {
    const r = noms(AS.filtrerEntrees(IDX, saisie));
    assert.ok(r.includes(attendu), '« ' + saisie +' » doit proposer ' + attendu + ' — obtenu ' + JSON.stringify(r));
  }
});

test('la saisie vide ouvre TOUT le catalogue (c\'est une liste déroulante)', () => {
  for (const vide of ['', null, undefined, '   ']) {
    const r = AS.filtrerEntrees(IDX, vide, 100);
    assert.equal(r.length, IDX.entrees.length, JSON.stringify(vide));
  }
});

test('les préfixes remontent en tête : la frappe courante est un début de nom', () => {
  const r = noms(AS.filtrerEntrees(IDX, 'rhizo'));
  assert.ok(r.length >= 2);
  assert.ok(r[0].toUpperCase().startsWith('RHIZO'), JSON.stringify(r));
});

test('la liste est bornée : 1 019 options ne se rendent pas sur un téléphone', () => {
  const gros = [];
  for (let i = 0; i < 500; i++) gros.push({ id: 'A' + i, nom: 'ARTICLE ' + i, active: true });
  const idx = AS.indexerCatalogue(gros);
  assert.equal(AS.filtrerEntrees(idx, '').length, 50, 'limite par défaut');
  assert.equal(AS.filtrerEntrees(idx, 'article', 8).length, 8);
});

test('une recherche sans résultat rend une liste VIDE, jamais tout le catalogue', () => {
  assert.deepEqual(AS.filtrerEntrees(IDX, 'ZZZZZ-INEXISTANT'), [],
    'rendre le catalogue entier ferait croire au magasinier que son article existe');
});

// ── Verdict : la seule fonction qui décide ────────────────────────────────

test('MUTANT « champ redevenu libre » : une saisie hors catalogue n\'est PAS ok', () => {
  const v = AS.verdictChoix(IDX, 'ACIDE SULFURIQUE');
  assert.equal(v.ok, false);
  assert.equal(v.issue, AS.ISSUE_INCONNU);
  assert.equal(v.nom, '', 'aucun nom ne doit sortir d\'un refus');
  assert.ok(v.message.includes('ACIDE SULFURIQUE'), 'le message doit NOMMER ce qui a été tapé');
  assert.ok(v.message.includes('demandez sa création au DG'), 'et dire l\'issue offerte');
  // Une faute de frappe sur un article qui EXISTE est refusée aussi.
  assert.equal(AS.verdictChoix(IDX, 'KELPACK').ok, false);
});

test('MUTANT « choix ambigu accepté » : OPAL/Opal est REFUSÉ, et les deux fiches nommées', () => {
  const v = AS.verdictChoix(IDX, 'OPAL');
  assert.equal(v.ok, false, 'accepter remplacerait une saisie libre par un choix ambigu');
  assert.equal(v.issue, AS.ISSUE_AMBIGU);
  assert.equal(v.fiches.length, 2);
  assert.ok(v.message.includes('Ref-Eng0052') && v.message.includes('Ref-Eng0177'),
    'le DG doit savoir QUELLES fiches fusionner');
  assert.ok(v.message.includes('Fusionnez'), 'le remède est une fusion, pas une création');
  // Même verdict quelle que soit la graphie tapée.
  assert.equal(AS.verdictChoix(IDX, 'opal').issue, AS.ISSUE_AMBIGU);
  assert.equal(AS.verdictChoix(IDX, 'Opal (L)').issue, AS.ISSUE_AMBIGU);
});

test('un article réel est accepté, sous le libellé EXACT du catalogue', () => {
  const v = AS.verdictChoix(IDX, 'kelpak');
  assert.equal(v.ok, true);
  assert.equal(v.issue, AS.ISSUE_CHOISI);
  assert.equal(v.nom, 'KELPAK', 'le libellé envoyé est celui de la fiche, pas la frappe');
  // Le suffixe d'unité est rapproché, comme côté serveur.
  assert.equal(AS.verdictChoix(IDX, 'Acide Phosphorique').ok, true);
  assert.equal(AS.verdictChoix(IDX, 'Acide Phosphorique').nom, 'ACIDE PHOSPHORIQUE (L)');
});

test('ligne vide : ni valide, ni fautive — elle est simplement ignorée', () => {
  for (const vide of ['', '   ', null, undefined]) {
    const v = AS.verdictChoix(IDX, vide);
    assert.equal(v.issue, AS.ISSUE_VIDE, JSON.stringify(vide));
    assert.equal(v.ok, false);
    assert.equal(v.message, '', 'une ligne vierge ne doit pas afficher d\'erreur');
  }
});

// ── Garde de soumission ───────────────────────────────────────────────────

test('lignesInvalides : nomme chaque ligne fautive, ignore les vides', () => {
  const items = [
    { article: 'KELPAK', quantite: 2 },
    { article: '', quantite: '' },
    { article: 'ACIDE SULFURIQUE', quantite: 5 },
    { article: 'OPAL', quantite: 1 },
  ];
  const r = AS.lignesInvalides(items, IDX);
  assert.equal(r.length, 2, 'la ligne valide et la ligne vide ne remontent pas');
  assert.deepEqual(r.map((x) => x.index), [2, 3]);
  assert.equal(r[0].issue, AS.ISSUE_INCONNU);
  assert.equal(r[1].issue, AS.ISSUE_AMBIGU);
  assert.ok(r[0].message.includes('ACIDE SULFURIQUE'));
  assert.ok(r[1].message.includes('OPAL'));
});

test('un bon entièrement valide ne remonte RIEN', () => {
  assert.deepEqual(
    AS.lignesInvalides([{ article: 'KELPAK' }, { article: 'Rhizo amine' }, { article: '' }], IDX),
    []
  );
});

// ── LE CAS D'OMAR — frappe partielle qui A des correspondances ────────────
// « Il doit afficher les suggestions des articles avec dropdown. Aujourd'hui
// il suggère d'ajouter pour tous, même pour articles existants. »
// Vérifié sur le catalogue de production : `sulfate` → 9 correspondances,
// `acide` → 8, `nitr` → 10, et TOUS déclenchaient le bouton de création.

test('MUTANT « création proposée alors que des résultats existent » — LE CAS D\'OMAR', () => {
  const v = AS.verdictChoix(IDX, 'sulfate');
  assert.equal(v.issue, AS.ISSUE_EN_COURS,
    'proposer la création alors que 5 « Sulfate … » existent est le défaut remonté par Omar');
  assert.notEqual(v.issue, AS.ISSUE_INCONNU, 'c\'est CE verdict qui affiche le bouton de création');
  assert.equal(v.ok, false, 'une frappe partielle ne vaut pas un choix : le bon ne doit pas partir');
  assert.ok(v.message.includes('choisissez-en un dans la liste'), 'le message doit dire quoi faire');
  // 5 et non 6 : « Sulfat de potasse » (sans le « e ») ne contient pas
  // « SULFATE ». C'est correct — et c'est pourquoi la recherche par PRÉFIXE
  // « sulfat » en propose 6, elle.
  assert.ok(/\b5 correspondent\b/.test(v.message), 'et combien : ' + v.message);
  assert.equal(AS.filtrerEntrees(IDX, 'sulfat').length, 6, '« sulfat » attrape aussi la variante sans « e »');
});

test('LE CAS D\'OMAR — la liste s\'affiche bel et bien sur la frappe partielle', () => {
  const noms = AS.filtrerEntrees(IDX, 'sulfate').map((e) => e.nom);
  assert.ok(noms.length >= 5, 'la frappe partielle doit proposer les articles existants');
  assert.ok(noms.includes("Sulfate d'ammoniaque"), JSON.stringify(noms));
  assert.ok(noms.includes('Sulfate de fer'), JSON.stringify(noms));
});

test('MUTANT « la liste ne s\'affiche pas sur une frappe partielle »', () => {
  // Chaque préfixe d'un article réel doit proposer quelque chose : sans cela,
  // le magasinier ne peut PAS atteindre l'article, et la sélection fermée
  // devient une impasse.
  for (const saisie of ['s', 'su', 'sul', 'sulf', 'sulfa', 'sulfate', 'sulfate de']) {
    assert.ok(
      AS.filtrerEntrees(IDX, saisie).length > 0,
      'aucune suggestion pour « ' + saisie +' »'
    );
    assert.equal(AS.verdictChoix(IDX, saisie).issue, AS.ISSUE_EN_COURS, saisie);
  }
});

test('la création n\'est proposée QUE si RIEN ne correspond', () => {
  const v = AS.verdictChoix(IDX, 'ZZQX-PRODUIT-INEXISTANT');
  assert.equal(v.issue, AS.ISSUE_INCONNU, 'là, et seulement là, le bouton doit s\'afficher');
  assert.equal(AS.filtrerEntrees(IDX, 'ZZQX-PRODUIT-INEXISTANT').length, 0);
  assert.ok(v.message.includes('Aucun article du catalogue ne correspond'));
  assert.ok(v.message.includes('demandez sa création au DG'), 'l\'issue reste offerte');
});

test('un libellé COMPLET reste un choix, pas une frappe en cours', () => {
  const v = AS.verdictChoix(IDX, "sulfate d'ammoniaque");
  assert.equal(v.issue, AS.ISSUE_CHOISI);
  assert.equal(v.ok, true);
  assert.equal(v.nom, "Sulfate d'ammoniaque");
});

test('la frappe partielle bloque quand même la SOUMISSION du bon', () => {
  // `en_cours` n'est pas une erreur à l'écran, mais ce n'est pas un article :
  // laisser partir « sulfate » enverrait un libellé que le serveur refuserait.
  const r = AS.lignesInvalides([{ article: 'sulfate', quantite: 5 }], IDX);
  assert.equal(r.length, 1);
  assert.equal(r[0].issue, AS.ISSUE_EN_COURS);
});

test('MUTANT « recherche sensible à la casse/accents » sur le cas d\'Omar', () => {
  for (const saisie of ['SULFATE', 'Sulfate', 'sUlFaTe', '  sulfate  ']) {
    assert.ok(AS.filtrerEntrees(IDX, saisie).length >= 5, saisie);
    assert.equal(AS.verdictChoix(IDX, saisie).issue, AS.ISSUE_EN_COURS, saisie);
  }
});
