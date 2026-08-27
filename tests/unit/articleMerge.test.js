'use strict';

/**
 * Fusion d'articles en doublon — tests purs.
 * Couvre normalizeArticleName, groupDuplicates, isMovementOpen, isBdcOpen.
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../functions/lib/stockMerge/articleMerge.js');

test('normalizeArticleName: minuscules + trim + accents + espaces multiples', () => {
  assert.equal(M.normalizeArticleName('  Acide   Phosphorique  '), 'acide phosphorique');
  assert.equal(M.normalizeArticleName('ACIDE PHOSPHORIQUE'), 'acide phosphorique');
  assert.equal(M.normalizeArticleName('Élément Numéro Ç'), 'element numero c');
  assert.equal(M.normalizeArticleName('Engrais\tNPK\n12'), 'engrais npk 12');
});

test('normalizeArticleName: valeurs nulles / non-string -> chaîne vide ou string', () => {
  assert.equal(M.normalizeArticleName(null), '');
  assert.equal(M.normalizeArticleName(undefined), '');
  assert.equal(M.normalizeArticleName(''), '');
  assert.equal(M.normalizeArticleName(123), '123');
});

test('groupDuplicates: regroupe par nom normalisé, >=2 seulement', () => {
  const articles = [
    { reference: 'A1', nom: 'Acide Phosphorique', categorie: 'Engrais', unite: 'L', active: true },
    { reference: 'A2', nom: 'ACIDE  PHOSPHORIQUE', categorie: 'engrais', unite: 'L', active: true },
    { reference: 'B1', nom: 'Sac plastique', active: true },
  ];
  const groups = M.groupDuplicates(articles);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].normalized, 'acide phosphorique');
  assert.equal(groups[0].articles.length, 2);
  assert.deepEqual(groups[0].articles.map((a) => a.reference).sort(), ['A1', 'A2']);
});

test('groupDuplicates: ignore active=false et noms vides', () => {
  const articles = [
    { reference: 'A1', nom: 'Gants', active: true },
    { reference: 'A2', nom: 'GANTS', active: false },
    { reference: 'A3', nom: '   ', active: true },
    { reference: 'A4', nom: 'GANTS', active: true },
  ];
  const groups = M.groupDuplicates(articles);
  // A2 inactif exclu -> A1+A4 = doublon
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].articles.map((a) => a.reference).sort(), ['A1', 'A4']);
});

test('groupDuplicates: propage les DONNÉES DE DÉCISION (prix + achats)', () => {
  // Sans ces champs, l'écran de fusion affiche deux fiches indiscernables et
  // le maître ne peut pas être suggéré : c'est exactement le bug du ticket.
  const articles = [
    { reference: 'A1', nom: 'Vertimec', prix_pmp: 38.25, prix_ht: 40, nb_achats: 3, active: true },
    { reference: 'A2', nom: 'VERTIMEC', active: true },
  ];
  const [g] = M.groupDuplicates(articles);
  const a1 = g.articles.find((a) => a.reference === 'A1');
  const a2 = g.articles.find((a) => a.reference === 'A2');
  assert.equal(a1.prix_pmp, 38.25);
  assert.equal(a1.prix_ht, 40);
  assert.equal(a1.nb_achats, 3);
  // Les champs existent même absents en base : l'écran affiche « — », pas undefined.
  assert.equal(a2.prix_pmp, null);
  assert.equal(a2.prix_ht, null);
  assert.equal(a2.nb_achats, null);
});

test('groupDuplicates: chaque groupe porte la suggestion de maître', () => {
  // La règle de choix ne doit exister QU'À UN endroit : le front la consomme,
  // il ne la recalcule pas.
  const [g] = M.groupDuplicates([
    { id: 'SANS_PRIX', reference: 'SANS_PRIX', nom: 'Vertimec', nb_achats: 12, active: true },
    { id: 'AVEC_PRIX', reference: 'AVEC_PRIX', nom: 'VERTIMEC', prix_pmp: 38.25, active: true },
  ]);
  assert.equal(g.decidable, true);
  assert.equal(g.master_suggere, 'AVEC_PRIX');
  assert.match(g.raison, /38,25 DH/);
});

test('groupDuplicates: le docId est propagé, et c’est LUI le maître suggéré', () => {
  // Cas « magical » : le champ `reference` est espacé, le docId ne l'est pas,
  // et un document FANTÔME sans nom existe à la référence espacée. Rendre
  // `reference` comme master_suggere ferait fusionner vers le fantôme.
  const [g] = M.groupDuplicates([
    { id: 'ENG0151', reference: 'ENG 0151', nom: 'Magical', nb_achats: 5, active: true },
    { id: 'ENG0150', reference: 'ENG 0150', nom: 'MAGICAL', prix_pmp: 107.95, active: true },
  ]);
  assert.equal(g.master_suggere, 'ENG0150');
  assert.notEqual(g.master_suggere, 'ENG 0150', 'la référence espacée adresse un fantôme');
  // Chaque article porte les DEUX : `id` pour adresser, `reference` pour Omar.
  const reelle = g.articles.find((a) => a.id === 'ENG0150');
  assert.equal(reelle.reference, 'ENG 0150');
  assert.deepEqual(g.articles.map((a) => a.id).sort(), ['ENG0150', 'ENG0151']);
});

test('groupDuplicates: groupe indécidable -> aucun maître suggéré (fail-closed)', () => {
  const [g] = M.groupDuplicates([
    { reference: 'PREMIERE', nom: 'Vertimec', active: true },
    { reference: 'SECONDE', nom: 'VERTIMEC', active: true },
  ]);
  assert.equal(g.decidable, false);
  assert.equal(g.master_suggere, null);
  // Surtout pas un repli silencieux sur la première fiche du tableau.
  assert.notEqual(g.master_suggere, 'PREMIERE');
  assert.ok(g.raison.length > 10);
});

// ── garde d'intégrité des fiches entrant dans une fusion ───────────────────

test('verifierIntegriteFiche: une fiche vivante et nommée passe', () => {
  const v = M.verifierIntegriteFiche({ active: true, nom: 'MAGICAL' }, 'ENG0150', 'master');
  assert.equal(v.ok, true);
  assert.equal(v.erreur, '');
});

test('verifierIntegriteFiche: le document FANTÔME est refusé (cas « magical »)', () => {
  // Document réel en base : ni `nom`, ni champ `active`, seulement un prix_ht.
  // L'ancienne garde `active === false` recevait `undefined !== false` et le
  // laissait passer : la fusion réécrivait alors article_nom:"" sur les
  // mouvements ouverts et article:"" sur les lignes de BDC ouverts.
  const fantome = { prix_ht: 42 };
  const v = M.verifierIntegriteFiche(fantome, 'ENG 0150', 'master');
  assert.equal(v.ok, false);
  assert.match(v.erreur, /ENG 0150/, 'le message doit nommer la fiche en cause');
  assert.match(v.erreur, /refus/i);
  // La garde doit être POSITIVE : `active !== true`, pas `active === false`.
  assert.equal(M.verifierIntegriteFiche({ nom: 'X' }, 'R', 'master').ok, false);
  assert.equal(M.verifierIntegriteFiche({ active: 'true', nom: 'X' }, 'R', 'master').ok, false);
  assert.equal(M.verifierIntegriteFiche({ active: 1, nom: 'X' }, 'R', 'master').ok, false);
});

test('verifierIntegriteFiche: une fiche sans nom exploitable est refusée', () => {
  for (const nom of [undefined, null, '', '   ']) {
    const v = M.verifierIntegriteFiche({ active: true, nom }, 'ENG0150', 'doublon');
    assert.equal(v.ok, false, 'nom : ' + JSON.stringify(nom));
    assert.match(v.erreur, /nom/);
  }
});

test('verifierIntegriteFiche: une fiche déjà fusionnée (active:false) est refusée', () => {
  // Sinon le doublon d'une fusion précédente pourrait être redésigné maître.
  const v = M.verifierIntegriteFiche({ active: false, nom: 'X', merged_into: 'Y' }, 'R', 'master');
  assert.equal(v.ok, false);
});

test('verifierIntegriteFiche: document absent / valeur non-objet -> refus, jamais un crash', () => {
  for (const rien of [null, undefined, 42, 'x', true]) {
    const v = M.verifierIntegriteFiche(rien, 'R', 'doublon');
    assert.equal(v.ok, false, 'entrée : ' + String(rien));
    assert.equal(typeof v.erreur, 'string');
    assert.ok(v.erreur.length > 10);
  }
});

test('verifierIntegriteFiche: le rôle apparaît dans le message', () => {
  assert.match(M.verifierIntegriteFiche({}, 'R', 'master').erreur, /master/);
  assert.match(M.verifierIntegriteFiche({}, 'R', 'doublon').erreur, /doublon/);
});

test('groupDuplicates: entrée vide / non-array -> []', () => {
  assert.deepEqual(M.groupDuplicates([]), []);
  assert.deepEqual(M.groupDuplicates(null), []);
  assert.deepEqual(M.groupDuplicates(undefined), []);
});

test('isMovementOpen: reception/sortie ouverts seulement avant valide_chef', () => {
  assert.equal(M.isMovementOpen({ type: 'reception', status: 'valide_mag' }), true);
  assert.equal(M.isMovementOpen({ type: 'reception', status: 'valide_achats' }), true);
  assert.equal(M.isMovementOpen({ type: 'sortie', status: 'valide_mag' }), true);
  assert.equal(M.isMovementOpen({ type: 'reception', status: 'valide_chef' }), false);
  assert.equal(M.isMovementOpen({ type: 'reception', status: 'rejete' }), false);
});

test('isMovementOpen: transfert/consommation jamais ouverts (impact immédiat)', () => {
  assert.equal(M.isMovementOpen({ type: 'transfert', status: 'valide_chef' }), false);
  assert.equal(M.isMovementOpen({ type: 'consommation', status: 'valide_chef' }), false);
  assert.equal(M.isMovementOpen(null), false);
});

test('réassignation: une clé doublon avec accents/double-espace matche la valeur normalisée', () => {
  // Le set des clés doublon est construit avec normalizeArticleName (comme la détection).
  // Un item référençant le doublon avec accents ou espaces différents doit matcher.
  const doublonNom = 'Acide  Phosphorique'; // double espace
  const key = M.normalizeArticleName(doublonNom);
  const doublonKeysNorm = new Set([key]);
  const itemMatches = (v) => doublonKeysNorm.has(M.normalizeArticleName(v));

  // item avec accents + simple espace + casse différente -> doit matcher la même clé
  assert.equal(itemMatches('acidé phosphorique'), true);
  assert.equal(itemMatches('ACIDE   PHOSPHORIQUE'), true);
  assert.equal(itemMatches('  Acide Phosphorique  '), true);
  // item hors groupe -> ne matche pas
  assert.equal(itemMatches('Acide Nitrique'), false);
});

test('réassignation: clé construite depuis ref ET nom, vide ignorée', () => {
  const doublonKeysNorm = new Set([
    M.normalizeArticleName('REF-Çà'),
    M.normalizeArticleName('Gants  Nitrile'),
  ]);
  doublonKeysNorm.delete('');
  const itemMatches = (v) => doublonKeysNorm.has(M.normalizeArticleName(v));
  assert.equal(itemMatches('ref-ca'), true); // ref normalisée
  assert.equal(itemMatches('GANTS NITRILE'), true); // nom normalisé
  assert.equal(itemMatches(''), false); // vide jamais matché
  assert.equal(itemMatches(null), false);
});

// ───────────────────────────────────────────────────────────────────────────
// CAUSE RACINE — résolution par nom normalisé avant écriture.
// La formule du docId n'est PAS touchée (la changer réétiquetterait tout le
// catalogue) : c'est la résolution qui empêche la création d'un second doc.
// ───────────────────────────────────────────────────────────────────────────

test('normalizeCategorie: minuscules + espaces réduits, défaut « autre »', () => {
  assert.equal(M.normalizeCategorie('Engrais'), 'engrais');
  assert.equal(M.normalizeCategorie('engrais'), 'engrais');
  assert.equal(M.normalizeCategorie('  PESTICIDES  '), 'pesticides');
  assert.equal(M.normalizeCategorie('Petit   Outillage'), 'petit outillage');
  assert.equal(M.normalizeCategorie(null), 'autre');
  assert.equal(M.normalizeCategorie(''), 'autre');
  assert.equal(M.normalizeCategorie('   '), 'autre');
  // défaut explicite (create-article conservait '' quand la catégorie est absente)
  assert.equal(M.normalizeCategorie(undefined, ''), '');
  // les deux conventions de la base convergent sur UNE seule valeur
  assert.equal(M.normalizeCategorie('Engrais'), M.normalizeCategorie('engrais'));
});

test('buildArticleIndex: n’indexe QUE les fiches actives, garde merged_into', () => {
  const idx = M.buildArticleIndex([
    { id: 'A', nom: 'Engrais NPK', active: true },
    { id: 'B', nom: 'ENGRAIS  NPK', active: false, merged_into: 'A' },
    { id: 'C', nom: 'Gants', active: true },
    { id: 'D', nom: '   ', active: true },
    { id: null, nom: 'sans id', active: true },
  ]);
  assert.deepEqual([...idx.byId].sort(), ['A', 'C', 'D']);
  assert.equal(idx.byName.get('engrais npk'), 'A');
  assert.equal(idx.byName.has(''), false, 'un nom vide ne doit jamais être indexé');
  assert.equal(idx.mergedInto.get('B'), 'A');
  // La fiche désactivée n’est PAS dans byId : un import ne doit pas la ressusciter.
  assert.equal(idx.byId.has('B'), false);
});

test('buildArticleIndex: allIds contient AUSSI les fiches désactivées', () => {
  // allIds ne sert PAS à la résolution : il permet à l'appelant de distinguer
  // « ce document n'existe pas » (set) de « il existe mais est inactif »
  // (update). Une fiche désactivée par validate-delete-article n'a ni
  // merged_into ni jumelle active : aucun repli ne la voit, et un set()
  // l'écraserait — prix_pmp, nb_achats et created_at perdus.
  const idx = M.buildArticleIndex([
    { id: 'ACTIF', nom: 'Gants', active: true },
    { id: 'SUPPRIME', nom: 'Sécateur', active: false },
    { id: 'FUSIONNE', nom: 'Gants', active: false, merged_into: 'ACTIF' },
  ]);
  assert.deepEqual([...idx.allIds].sort(), ['ACTIF', 'FUSIONNE', 'SUPPRIME']);
  assert.deepEqual([...idx.byId], ['ACTIF']);
  // La fiche supprimée n'est atteignable par AUCUN chemin de résolution…
  const t = M.resolveArticleTarget(idx, 'SUPPRIME', 'Sécateur');
  assert.equal(t.isNew, true, 'aucun repli ne la résout');
  // …mais allIds révèle qu'un document occupe déjà cet identifiant.
  assert.equal(idx.allIds.has(t.id), true, 'l’appelant doit pouvoir voir la collision');
});

test('rememberArticle: la fiche créée entre aussi dans allIds', () => {
  const idx = M.buildArticleIndex([]);
  M.rememberArticle(idx, 'NEUF', 'Gants');
  assert.equal(idx.allIds.has('NEUF'), true);
  assert.equal(idx.byId.has('NEUF'), true);
});

test('buildArticleIndex: collision de noms actifs -> id le plus petit, déterministe', () => {
  const docs = [
    { id: 'ZZZ', nom: 'Acide Phosphorique', active: true },
    { id: 'AAA', nom: 'ACIDE  PHOSPHORIQUE', active: true },
  ];
  assert.equal(M.buildArticleIndex(docs).byName.get('acide phosphorique'), 'AAA');
  // Ordre d’entrée inverse -> MÊME résultat (sinon deux imports divergeraient).
  assert.equal(M.buildArticleIndex(docs.slice().reverse()).byName.get('acide phosphorique'), 'AAA');
});

test('buildArticleIndex: entrée non-array -> index vide, jamais un crash', () => {
  for (const bad of [null, undefined, 42, 'x']) {
    const idx = M.buildArticleIndex(bad);
    assert.equal(idx.byId.size, 0);
    assert.equal(idx.allIds.size, 0);
    assert.equal(idx.byName.size, 0);
  }
});

test('resolveArticleTarget: id actif prioritaire, puis nom normalisé, puis création', () => {
  const idx = M.buildArticleIndex([
    { id: 'ID_MAJ', nom: 'Engrais NPK', active: true },
    { id: 'ID_GANTS', nom: 'Gants', active: true },
  ]);
  // 1. l’identifiant historique existe et est actif -> on l’utilise tel quel
  assert.deepEqual(M.resolveArticleTarget(idx, 'ID_MAJ', 'Engrais NPK'), {
    id: 'ID_MAJ', isNew: false, matchedBy: 'id',
  });
  // 2. identifiant INCONNU (casse de catégorie différente) mais nom déjà connu
  //    -> on met à jour la fiche existante AU LIEU d’en créer une seconde.
  assert.deepEqual(M.resolveArticleTarget(idx, 'ID_MIN', 'ENGRAIS   NPK'), {
    id: 'ID_MAJ', isNew: false, matchedBy: 'nom',
  });
  // accents et espaces multiples passent par la même normalisation
  assert.equal(M.resolveArticleTarget(idx, 'X', '  éngrais npk ').matchedBy, 'nom');
  // 3. rien ne matche -> création à l’identifiant historique, formule intacte
  assert.deepEqual(M.resolveArticleTarget(idx, 'ID_NEUF', 'Sécateur'), {
    id: 'ID_NEUF', isNew: true, matchedBy: 'none',
  });
});

test('resolveArticleTarget: un nom vide ou absent ne matche jamais par nom', () => {
  const idx = M.buildArticleIndex([{ id: 'A', nom: 'Gants', active: true }]);
  for (const nom of ['', '   ', null, undefined]) {
    const t = M.resolveArticleTarget(idx, 'NEUF', nom);
    assert.equal(t.matchedBy, 'none');
    assert.equal(t.id, 'NEUF');
    assert.equal(t.isNew, true);
  }
});

test('resolveArticleTarget: un doublon déjà fusionné redirige vers son master', () => {
  // Après fusion : le doublon est active:false + merged_into. L’import du 30/06
  // porte encore l’ancien identifiant : il doit atterrir sur le MASTER, pas
  // ressusciter la fiche fusionnée ni créer une troisième fiche.
  const idx = M.buildArticleIndex([
    { id: 'MASTER', nom: 'Nitrate de potasse', active: true },
    { id: 'DOUBLON', nom: 'Nitrate de potasse', active: false, merged_into: 'MASTER' },
  ]);
  assert.deepEqual(M.resolveArticleTarget(idx, 'DOUBLON', 'Nitrate de potasse'), {
    id: 'MASTER', isNew: false, matchedBy: 'nom',
  });
  // Même sans nom exploitable, la redirection merged_into rattrape la ligne.
  assert.deepEqual(M.resolveArticleTarget(idx, 'DOUBLON', ''), {
    id: 'MASTER', isNew: false, matchedBy: 'merged_into',
  });
  // merged_into pointant sur une fiche elle-même inactive -> pas de redirection.
  const idx2 = M.buildArticleIndex([
    { id: 'D', nom: 'X', active: false, merged_into: 'ABSENT' },
  ]);
  assert.equal(M.resolveArticleTarget(idx2, 'D', '').matchedBy, 'none');
});

test('mergedInto survit à la désactivation du master, contrairement à matchedBy', () => {
  // Piège : `matchedBy: 'merged_into'` n'est émis QUE si le master est encore
  // actif. Si le master d'une fusion est désactivé ensuite (par
  // validate-delete-article), la résolution d'un ancien identifiant de doublon
  // retombe en 'none' — donc une garde indexée sur `matchedBy` s'ouvre
  // exactement dans ce cas. `mergedInto`, lui, ne dépend pas de l'état du
  // master : c'est sur LUI qu'une garde doit s'appuyer.
  const docs = [
    { id: 'MASTER', nom: 'Nitrate de potasse', active: true },
    { id: 'DOUBLON', nom: 'Nitrate de potasse', active: false, merged_into: 'MASTER' },
  ];
  const vivant = M.buildArticleIndex(docs);
  assert.equal(M.resolveArticleTarget(vivant, 'DOUBLON', '').matchedBy, 'merged_into');
  assert.equal(vivant.mergedInto.has('DOUBLON'), true);

  // Master désactivé depuis : la redirection ne s'applique plus…
  const masterMort = M.buildArticleIndex([
    { ...docs[0], active: false },
    docs[1],
  ]);
  assert.equal(
    M.resolveArticleTarget(masterMort, 'DOUBLON', '').matchedBy,
    'none',
    'le repli merged_into s’éteint quand le master n’est plus actif'
  );
  assert.equal(M.resolveArticleTarget(masterMort, 'DOUBLON', '').isNew, true);
  // …mais la TOMBE est toujours visible dans l’index. Une garde bâtie dessus
  // tient dans les deux états.
  assert.equal(masterMort.mergedInto.has('DOUBLON'), true);
  assert.equal(masterMort.mergedInto.get('DOUBLON'), 'MASTER');
});

test('resolveArticleTarget: index absent/corrompu -> création, jamais un crash', () => {
  assert.deepEqual(M.resolveArticleTarget(null, 'ID', 'Gants'), {
    id: 'ID', isNew: true, matchedBy: 'none',
  });
  assert.deepEqual(M.resolveArticleTarget({}, 'ID', 'Gants'), {
    id: 'ID', isNew: true, matchedBy: 'none',
  });
});

test('rememberArticle: deux lignes du MÊME import convergent sur une seule fiche', () => {
  // Le scénario exact du 30/06 : la source renvoie « Engrais » et « engrais »
  // pour le même article -> deux docId -> deux fiches, aujourd’hui.
  const idx = M.buildArticleIndex([]);
  const docId = (nom, cat) =>
    Buffer.from(nom + '|' + cat).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 50);

  const l1 = { nom: 'Acide Phosphorique', categorie: 'Engrais' };
  const l2 = { nom: 'Acide Phosphorique', categorie: 'engrais' };
  const id1 = docId(l1.nom, l1.categorie);
  const id2 = docId(l2.nom, l2.categorie);
  assert.notEqual(id1, id2, 'prémisse : les deux casses produisent bien deux identifiants');

  const t1 = M.resolveArticleTarget(idx, id1, l1.nom);
  assert.equal(t1.isNew, true);
  M.rememberArticle(idx, t1.id, l1.nom);

  const t2 = M.resolveArticleTarget(idx, id2, l2.nom);
  assert.equal(t2.isNew, false, 'la 2e ligne ne doit PAS créer une seconde fiche');
  assert.equal(t2.id, t1.id);
  assert.equal(t2.matchedBy, 'nom');
});

test('rememberArticle: un SECOND import complet ne crée plus rien', () => {
  // Rejeu à blanc : c’est le test qui prouve que le 30/06 ne recréera rien.
  const lignes = [
    { nom: 'Acide Phosphorique', categorie: 'Engrais' },
    { nom: 'ACIDE  PHOSPHORIQUE', categorie: 'engrais' },
    { nom: 'Gants nitrile', categorie: 'Petit outillage' },
  ];
  const docId = (nom, cat) =>
    Buffer.from(nom + '|' + cat).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 50);
  const passe = (idx) => {
    let crees = 0;
    for (const l of lignes) {
      const t = M.resolveArticleTarget(idx, docId(l.nom, l.categorie), l.nom);
      if (t.isNew) { crees++; M.rememberArticle(idx, t.id, l.nom); }
    }
    return crees;
  };
  const idx = M.buildArticleIndex([]);
  assert.equal(passe(idx), 2, '1er import : 2 fiches distinctes (pas 3)');
  assert.equal(passe(idx), 0, '2e import : AUCUNE création');
});

test('rememberArticle: id vide ou index corrompu -> no-op silencieux', () => {
  const idx = M.buildArticleIndex([]);
  M.rememberArticle(idx, '', 'Gants');
  assert.equal(idx.byName.size, 0);
  assert.doesNotThrow(() => M.rememberArticle(null, 'A', 'Gants'));
  assert.doesNotThrow(() => M.rememberArticle({}, 'A', 'Gants'));
});

test('isBdcOpen: clôturés non réassignables, autres ouverts', () => {
  assert.equal(M.isBdcOpen({ status: 'brouillon' }), true);
  assert.equal(M.isBdcOpen({ status: 'rejete' }), true);
  assert.equal(M.isBdcOpen({ status: 'en_attente_chef' }), true);
  assert.equal(M.isBdcOpen({ status: 'en_attente_dg' }), true);
  assert.equal(M.isBdcOpen({ status: 'envoye' }), false);
  assert.equal(M.isBdcOpen({ status: 'valide_dg' }), false);
  assert.equal(M.isBdcOpen({ status: 'annule' }), false);
});
