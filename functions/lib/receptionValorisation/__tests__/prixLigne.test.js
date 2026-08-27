'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  SOURCES_PRIORITE,
  MOTIF,
  cleArticle,
  prixPondereSource,
  resolvePrixLigne,
  valoriserLignes,
} = require('../prixLigne');

// --------------------------------------------------------------------------
// Hiérarchie des sources
// --------------------------------------------------------------------------

test('la hiérarchie est facture > bon_commande > bon_entree', () => {
  assert.deepEqual(SOURCES_PRIORITE, ['facture', 'bon_commande', 'bon_entree']);
});

test('la facture prime sur le BDC quand les deux portent un prix', () => {
  const ligne = { article_nom: 'NITRATE DE CHAUX', unite: 'kg', quantite: 100 };
  const r = resolvePrixLigne(ligne, {
    facture: [{ article: 'Nitrate de chaux', unite: 'KG', prix_unitaire: 4.8, quantite: 300, reference: '135937' }],
    bon_commande: [{ article: 'NITRATE DE CHAUX', unite: 'kg', prix_unitaire: 5.5, quantite: 100, reference: 'BDC-2026-0165' }],
  });
  assert.equal(r.source, 'facture');
  assert.equal(r.prix_unitaire, 4.8);
  assert.equal(r.reference, '135937');
  assert.equal(r.motif, '');
});

test('le BDC sert quand aucune facture ne couvre l\'article', () => {
  const ligne = { article_nom: 'Fertiactyl GZ', unite: 'L' };
  const r = resolvePrixLigne(ligne, {
    facture: [{ article: 'AUTRE ARTICLE', unite: 'L', prix_unitaire: 999 }],
    bon_commande: [{ article: 'Fertiactyl GZ', unite: 'L', prix_unitaire: '116.16', reference: 'BDC-2026-0165' }],
  });
  assert.equal(r.source, 'bon_commande');
  assert.equal(r.prix_unitaire, 116.16);
  assert.equal(r.reference, 'BDC-2026-0165');
});

test('le prix déjà porté par la ligne est la source bon_entree, la moins prioritaire', () => {
  const ligne = { article_nom: 'SMART PH', unite: 'L', prix_unitaire: 75 };
  const seul = resolvePrixLigne(ligne, {});
  assert.equal(seul.source, 'bon_entree');
  assert.equal(seul.prix_unitaire, 75);

  const avecBdc = resolvePrixLigne(ligne, {
    bon_commande: [{ article: 'SMART PH', unite: 'L', prix_unitaire: 80 }],
  });
  assert.equal(avecBdc.source, 'bon_commande');
  assert.equal(avecBdc.prix_unitaire, 80);
});

// --------------------------------------------------------------------------
// Rapprochement des noms d'article
//
// create-bl rapprochait les noms par égalité stricte en minuscules
// (`a.toLowerCase() === b.toLowerCase()`). Chaque cas ci-dessous ÉCHOUAIT avec
// cette règle, et produisait donc une ligne non valorisée (historiquement : un
// prix à zéro). Ils doivent tous se rapprocher maintenant.
// --------------------------------------------------------------------------

test('rapprochement : la casse seule ne fait pas échouer le rapprochement', () => {
  const r = resolvePrixLigne({ article_nom: 'NITRATE DE CHAUX', unite: 'kg' }, {
    bon_commande: [{ article: 'Nitrate de Chaux', unite: 'kg', prix_unitaire: 4.8 }],
  });
  assert.equal(r.prix_unitaire, 4.8);
});

test('rapprochement : les accents ne font plus échouer le rapprochement (Urée / UREE)', () => {
  const r = resolvePrixLigne({ article_nom: 'UREE', unite: 'kg' }, {
    bon_commande: [{ article: 'Urée', unite: 'kg', prix_unitaire: 6.2 }],
  });
  assert.equal(r.prix_unitaire, 6.2, 'ancien comportement : aucun rapprochement, ligne à 0');
});

test('rapprochement : le suffixe d\'unité ne fait plus échouer le rapprochement (MAP (KG) / MAP)', () => {
  const r = resolvePrixLigne({ article_nom: 'MAP (KG)', unite: 'kg' }, {
    bon_commande: [{ article: 'MAP', unite: 'kg', prix_unitaire: 9.9 }],
  });
  assert.equal(r.prix_unitaire, 9.9);
});

test('rapprochement : les espaces multiples ne font plus échouer le rapprochement', () => {
  const r = resolvePrixLigne({ article_nom: 'ACIDE   PHOSPHORIQUE', unite: 'kg' }, {
    bon_commande: [{ article: 'ACIDE PHOSPHORIQUE', unite: 'kg', prix_unitaire: 8.083 }],
  });
  assert.equal(r.prix_unitaire, 8.083);
});

test('rapprochement : deux articles réellement différents ne se rapprochent PAS', () => {
  const r = resolvePrixLigne({ article_nom: 'NITRATE DE CHAUX', unite: 'kg' }, {
    bon_commande: [{ article: 'NITRATE DE POTASSE', unite: 'kg', prix_unitaire: 12 }],
  });
  assert.equal(r.prix_unitaire, null);
  assert.equal(r.motif, MOTIF.AUCUNE_SOURCE);
});

// --------------------------------------------------------------------------
// Jamais de prix à zéro
// --------------------------------------------------------------------------

test('aucune source → AUCUN prix (pas de zéro), motif aucune_source', () => {
  const r = resolvePrixLigne({ article_nom: 'ARTICLE INCONNU', unite: 'kg' }, {});
  assert.equal(r.prix_unitaire, null);
  assert.notEqual(r.prix_unitaire, 0);
  assert.equal(r.source, null);
  assert.equal(r.motif, MOTIF.AUCUNE_SOURCE);
});

test('un prix source à zéro ne vaut PAS prix : la source est écartée', () => {
  const r = resolvePrixLigne({ article_nom: 'HUMOCAL', unite: 'kg' }, {
    bon_commande: [{ article: 'HUMOCAL', unite: 'kg', prix_unitaire: 0 }],
  });
  assert.equal(r.prix_unitaire, null);
  assert.equal(r.motif, MOTIF.PRIX_NON_POSITIF);
});

test('un prix à zéro sur la facture laisse la main au BDC (jamais zéro retenu)', () => {
  const r = resolvePrixLigne({ article_nom: 'HUMOCAL', unite: 'kg' }, {
    facture: [{ article: 'HUMOCAL', unite: 'kg', prix_unitaire: 0 }],
    bon_commande: [{ article: 'HUMOCAL', unite: 'kg', prix_unitaire: 12.5 }],
  });
  assert.equal(r.source, 'bon_commande');
  assert.equal(r.prix_unitaire, 12.5);
});

test('un prix négatif ou illisible ne vaut PAS prix', () => {
  const neg = resolvePrixLigne({ article_nom: 'X', unite: 'kg' }, {
    bon_commande: [{ article: 'X', unite: 'kg', prix_unitaire: -3 }],
  });
  assert.equal(neg.prix_unitaire, null);

  const illisible = resolvePrixLigne({ article_nom: 'X', unite: 'kg' }, {
    bon_commande: [{ article: 'X', unite: 'kg', prix_unitaire: 'besoin prix facture' }],
  });
  assert.equal(illisible.prix_unitaire, null);
});

test('un prix_unitaire à 0 porté par la ligne ne vaut pas source bon_entree', () => {
  // create-bl écrivait historiquement 0 quand l'article n'était pas trouvé au BDC.
  const r = resolvePrixLigne({ article_nom: 'X', unite: 'kg', prix_unitaire: 0 }, {});
  assert.equal(r.prix_unitaire, null);
  assert.equal(r.motif, MOTIF.AUCUNE_SOURCE);
});

// --------------------------------------------------------------------------
// Unités : refus plutôt que devinette
// --------------------------------------------------------------------------

test('unité divergente → REFUS, aucun prix inventé', () => {
  const r = resolvePrixLigne({ article_nom: 'ACIDE PHOSPHORIQUE', unite: 'L' }, {
    facture: [{ article: 'ACIDE PHOSPHORIQUE', unite: 'KG', prix_unitaire: 8.083, quantite: 192 }],
  });
  assert.equal(r.prix_unitaire, null);
  assert.equal(r.source, null);
  assert.equal(r.motif, MOTIF.UNITE_DIVERGENTE);
  assert.equal(r.refus.length, 1);
  assert.equal(r.refus[0].source, 'facture');
  assert.equal(r.refus[0].unite_source, 'KG');
  assert.equal(r.refus[0].unite_stock, 'L');
});

test('unité divergente sur la facture → on descend au BDC cohérent, refus tracé', () => {
  const r = resolvePrixLigne({ article_nom: 'ACIDE PHOSPHORIQUE', unite: 'L' }, {
    facture: [{ article: 'ACIDE PHOSPHORIQUE', unite: 'KG', prix_unitaire: 8.083 }],
    bon_commande: [{ article: 'ACIDE PHOSPHORIQUE', unite: 'L', prix_unitaire: 11 }],
  });
  assert.equal(r.source, 'bon_commande');
  assert.equal(r.prix_unitaire, 11);
  assert.equal(r.refus.length, 1);
  assert.equal(r.refus[0].motif, MOTIF.UNITE_DIVERGENTE);
});

test('la tonne est convertie (conversion exacte), pas devinée', () => {
  const r = resolvePrixLigne({ article_nom: 'MAP', unite: 'kg' }, {
    bon_commande: [{ article: 'MAP', unite: 'T', prix_unitaire: 12000, quantite: 2 }],
  });
  assert.equal(r.source, 'bon_commande');
  assert.equal(r.prix_unitaire, 12); // 12000 DH/T → 12 DH/kg
});

// --- Unité ABSENTE : ce n'est pas une divergence ---------------------------
// 491 des 573 lignes de bons de commande recevables en production (85,7 %)
// n'ont AUCUNE unité et portent toutes un prix. Les traiter comme divergentes
// faisait perdre le prix de 219 des 270 BDC de « BDC à réceptionner ».

test('unité ABSENTE au BDC + unité connue au stock → le prix est RETENU', () => {
  // Forme exacte de production : BDC sans unité, ligne de stock en kg.
  const r = resolvePrixLigne({ article_nom: 'X', unite: 'kg' }, {
    bon_commande: [{ article: 'X', unite: '', prix_unitaire: 10 }],
  });
  assert.equal(r.prix_unitaire, 10, 'une unité absente n\'est pas une divergence');
  assert.equal(r.source, 'bon_commande');
  assert.equal(r.motif, '');
  assert.equal(r.unite_verifiee, false, 'la vérification était impossible : ça doit se voir');
});

test('cas réel BC-000001 : 4430 u de film à 25 DH, BDC sans unité → 25 DH', () => {
  const r = resolvePrixLigne(
    { article_nom: 'FILM SUNN ASFI BLANC EVA EN 160', unite: 'kg', quantite: 4430 },
    { bon_commande: [{ article: 'FILM SUNN ASFI BLANC EVA EN 160', unite: '', prix_unitaire: '25', quantite: '4430' }] }
  );
  assert.equal(r.prix_unitaire, 25, '110 750 DH HT entreraient en stock non valorisés');
});

test('unité de stock absente + unité connue au BDC → le prix est RETENU', () => {
  const r = resolvePrixLigne({ article_nom: 'X', unite: '' }, {
    bon_commande: [{ article: 'X', unite: 'kg', prix_unitaire: 10 }],
  });
  assert.equal(r.prix_unitaire, 10);
  assert.equal(r.unite_verifiee, false);
});

test('les deux unités absentes → le prix est RETENU, vérification impossible', () => {
  const r = resolvePrixLigne({ article_nom: 'X', unite: '' }, {
    bon_commande: [{ article: 'X', unite: '', prix_unitaire: 10 }],
  });
  assert.equal(r.prix_unitaire, 10);
  assert.equal(r.unite_verifiee, false);
});

test('les deux unités connues et IDENTIQUES → prix retenu ET vérification faite', () => {
  const r = resolvePrixLigne({ article_nom: 'X', unite: 'kg' }, {
    bon_commande: [{ article: 'X', unite: 'kg', prix_unitaire: 10 }],
  });
  assert.equal(r.prix_unitaire, 10);
  assert.equal(r.unite_verifiee, true, 'ici la comparaison a réellement eu lieu');
});

test('une DIVERGENCE reste un refus, même à côté d\'une ligne sans unité', () => {
  const r = resolvePrixLigne({ article_nom: 'X', unite: 'L' }, {
    bon_commande: [{ article: 'X', unite: 'kg', prix_unitaire: 8 }],
  });
  assert.equal(r.prix_unitaire, null, 'les deux unités sont connues et diffèrent : aucune densité fabriquée');
  assert.equal(r.motif, MOTIF.UNITE_DIVERGENTE);
});

// --- Débordement : un pondéré non fini n'est pas un prix -------------------

test('débordement des sommes → AUCUN prix, jamais « valorisée sans prix »', () => {
  // vSum et qSum débordent à Infinity, Infinity/Infinity = NaN. Sans garde, la
  // ligne ressortait motif:'' avec prix:null — déclarée valorisée sans prix.
  const r = prixPondereSource(
    [
      { article: 'X', unite: 'kg', prix_unitaire: 1e308, quantite: 1e308 },
      { article: 'X', unite: 'kg', prix_unitaire: 1e308, quantite: 1e308 },
    ],
    cleArticle('X'),
    'KG'
  );
  assert.equal(r.prix, null);
  assert.notEqual(r.motif, '', 'motif vide = déclarée valorisée : l\'invariante tombe');
  assert.equal(r.motif, MOTIF.PRIX_NON_CALCULABLE);
});

test('un pondéré INFINI n\'est pas un prix (une seule ligne extrême suffit)', () => {
  // Cas distinct du NaN : ici vSum déborde à Infinity mais qSum reste FINI, donc
  // le pondéré vaut Infinity — et `Infinity > 0` est vrai. Vérifier le seul
  // signe laisserait passer un prix infini, annoncé comme valide.
  const r = prixPondereSource(
    [{ article: 'X', unite: 'kg', prix_unitaire: 1e308, quantite: 1e308 }],
    cleArticle('X'),
    'KG'
  );
  assert.equal(r.prix, null, 'un prix infini reste un prix invalide');
  assert.equal(r.motif, MOTIF.PRIX_NON_CALCULABLE);
});

test('un prix infini ne ressort jamais sur une ligne de réception', () => {
  const { items, resume } = valoriserLignes(
    [{ article_nom: 'X', unite: 'kg', quantite: 1 }],
    () => ({ bon_commande: [{ article: 'X', unite: 'kg', prix_unitaire: 1e308, quantite: 1e308 }] })
  );
  assert.equal(resume.valorisees, 0);
  assert.ok(!('prix_unitaire' in items[0]), 'prix_unitaire Infinity écrit en base : ' + JSON.stringify(items[0]));
});

test('débordement : la ligne n\'est PAS comptée comme valorisée', () => {
  const { items, resume } = valoriserLignes(
    [{ article_nom: 'X', unite: 'kg', quantite: 1 }],
    () => ({ bon_commande: [
      { article: 'X', unite: 'kg', prix_unitaire: 1e308, quantite: 1e308 },
      { article: 'X', unite: 'kg', prix_unitaire: 1e308, quantite: 1e308 },
    ] })
  );
  assert.equal(resume.valorisees, 0, 'valorisee sans prix_unitaire : exactement le défaut que ce module ferme');
  assert.equal(resume.non_valorisees, 1);
  assert.ok(!('prix_unitaire' in items[0]));
  assert.equal(items[0].prix_source, null);
});

// --------------------------------------------------------------------------
// Moyenne pondérée intra-source
// --------------------------------------------------------------------------

test('plusieurs lignes facture pour un article → moyenne pondérée par quantité', () => {
  const r = prixPondereSource(
    [
      { article: 'UREE', unite: 'kg', prix_unitaire: 10, quantite: 100 },
      { article: 'UREE', unite: 'kg', prix_unitaire: 20, quantite: 300 },
    ],
    cleArticle('UREE'),
    'KG'
  );
  // (100*10 + 300*20) / 400 = 17.5 — surtout PAS la moyenne simple (15)
  assert.equal(r.prix, 17.5);
});

// --------------------------------------------------------------------------
// Contrat de prixPondereSource : motif '' <=> prix strictement positif.
// C'est le SEUL endroit où « valorisé » se décide ; les appelants branchent sur
// ce signal. Ces tests sont ce qui rend cette garde unique falsifiable.
// --------------------------------------------------------------------------

test('contrat : un prix source à 0 rend motif=prix_non_positif et prix=null', () => {
  const r = prixPondereSource([{ article: 'X', unite: 'kg', prix_unitaire: 0, quantite: 5 }], cleArticle('X'), 'KG');
  assert.equal(r.prix, null);
  assert.equal(r.motif, MOTIF.PRIX_NON_POSITIF);
});

test('contrat : un prix source négatif rend motif=prix_non_positif et prix=null', () => {
  const r = prixPondereSource([{ article: 'X', unite: 'kg', prix_unitaire: -7, quantite: 5 }], cleArticle('X'), 'KG');
  assert.equal(r.prix, null);
  assert.equal(r.motif, MOTIF.PRIX_NON_POSITIF);
});

test('contrat : un prix source illisible rend motif=prix_non_positif et prix=null', () => {
  const r = prixPondereSource([{ article: 'X', unite: 'kg', prix_unitaire: 'voir facture' }], cleArticle('X'), 'KG');
  assert.equal(r.prix, null);
  assert.equal(r.motif, MOTIF.PRIX_NON_POSITIF);
});

test('contrat : une ligne à prix 0 est EXCLUE de la moyenne, elle ne la tire pas vers le bas', () => {
  // Cas décisif : sans filtre par ligne, (100×10 + 300×0)/400 = 2,50 — un prix
  // inventé, plus bas que tout prix réellement payé. Le filtre doit l'exclure.
  const r = prixPondereSource(
    [
      { article: 'UREE', unite: 'kg', prix_unitaire: 10, quantite: 100 },
      { article: 'UREE', unite: 'kg', prix_unitaire: 0, quantite: 300 },
    ],
    cleArticle('UREE'),
    'KG'
  );
  assert.equal(r.motif, '');
  assert.equal(r.prix, 10);
});

test('contrat : une ligne à prix négatif est EXCLUE de la moyenne', () => {
  const r = prixPondereSource(
    [
      { article: 'UREE', unite: 'kg', prix_unitaire: 10, quantite: 100 },
      { article: 'UREE', unite: 'kg', prix_unitaire: -50, quantite: 100 },
    ],
    cleArticle('UREE'),
    'KG'
  );
  assert.equal(r.prix, 10);
});

test('contrat : une ligne à prix illisible est EXCLUE de la moyenne', () => {
  const r = prixPondereSource(
    [
      { article: 'UREE', unite: 'kg', prix_unitaire: 10, quantite: 100 },
      { article: 'UREE', unite: 'kg', prix_unitaire: 'voir facture', quantite: 300 },
    ],
    cleArticle('UREE'),
    'KG'
  );
  assert.equal(r.prix, 10);
});

test('contrat : article absent de la source → motif=article_absent, jamais un prix', () => {
  const r = prixPondereSource([{ article: 'AUTRE', unite: 'kg', prix_unitaire: 5 }], cleArticle('X'), 'KG');
  assert.equal(r.prix, null);
  assert.equal(r.motif, MOTIF.ARTICLE_ABSENT);
});

test('contrat : motif vide implique TOUJOURS un prix strictement positif', () => {
  // Balayage de cas limites : aucun ne doit produire motif '' avec un prix <= 0.
  const cas = [
    [{ article: 'X', unite: 'kg', prix_unitaire: 0, quantite: 5 }],
    [{ article: 'X', unite: 'kg', prix_unitaire: -7, quantite: 5 }],
    [{ article: 'X', unite: 'kg', prix_unitaire: null, quantite: 5 }],
    [{ article: 'X', unite: 'kg', prix_unitaire: '', quantite: 5 }],
    [{ article: 'X', unite: 'kg', prix_unitaire: 'PERIME', quantite: 5 }],
    [{ article: 'X', unite: 'L', prix_unitaire: 9, quantite: 5 }],
    [{ article: 'X', unite: 'kg', prix_unitaire: 0, quantite: 5 }, { article: 'X', unite: 'kg', prix_unitaire: 0, quantite: 1 }],
    [{ article: 'X', unite: 'kg', prix_unitaire: 4, quantite: 5 }],
  ];
  for (const lignes of cas) {
    const r = prixPondereSource(lignes, cleArticle('X'), 'KG');
    if (r.motif === '') {
      assert.ok(typeof r.prix === 'number' && r.prix > 0,
        'motif vide sans prix strictement positif : ' + JSON.stringify({ lignes, r }));
    } else {
      assert.equal(r.prix, null, 'motif non vide doit rendre prix=null : ' + JSON.stringify(r));
    }
  }
});

test('contrat : (prix != null) <=> (motif === "") sur un balayage exhaustif', () => {
  // Cette biconditionnelle est ce qui autorise les appelants à ne brancher que
  // sur `motif`. Tant qu'elle tient, tester la valeur EN PLUS du signal serait
  // une garde redondante. Si un jour un retour la casse, ce test le dit.
  // Le domaine DOIT contenir les extrêmes : une première version de ce balayage
  // s'arrêtait à 100 et « prouvait » l'équivalence d'une garde que le
  // débordement (1e308) falsifiait. Une preuve d'équivalence ne vaut que par la
  // couverture de son domaine.
  const prix = [0, -7, 3, 12.5, null, undefined, '', '  ', 'voir facture', 'PERIME', '2,708,33', '2 120,00 DH', NaN, Infinity, -Infinity, 1e308, Number.MAX_VALUE, 5e-324];
  const unites = ['kg', 'KG', 'L', 'T', 'UNITE', '', null, 'litre'];
  const qtes = [0, 1, 100, -5, null, 'abc', 1e308, Number.MAX_VALUE, 1e-320];
  const articles = ['X', 'AUTRE', '', null];
  const uniteStocks = ['KG', 'L', ''];
  const secondesLignes = [
    [],
    [{ article: 'X', unite: 'kg', prix_unitaire: 10, quantite: 100 }],
    // Seconde ligne extrême : c'est la COMBINAISON qui fait déborder les sommes.
    [{ article: 'X', unite: 'kg', prix_unitaire: 1e308, quantite: 1e308 }],
  ];

  let cas = 0;
  for (const p of prix) {
    for (const u of unites) {
      for (const q of qtes) {
        for (const a of articles) {
          for (const us of uniteStocks) {
            for (const secondes of secondesLignes) {
              const lignes = [{ article: a, unite: u, prix_unitaire: p, quantite: q }].concat(secondes);
              const r = prixPondereSource(lignes, cleArticle('X'), us);
              cas += 1;
              assert.equal(
                r.prix != null,
                r.motif === '',
                'biconditionnelle rompue : ' + JSON.stringify({ lignes, uniteStock: us, r })
              );
              if (r.prix != null) {
                assert.ok(r.prix > 0, 'prix retenu non strictement positif : ' + JSON.stringify(r));
              }
            }
          }
        }
      }
    }
  }
  assert.ok(cas > 40000, 'balayage trop maigre : ' + cas);
});

test('contrat : resolvePrixLigne ne rend motif vide qu\'avec un prix > 0', () => {
  const valorise = resolvePrixLigne({ article_nom: 'X', unite: 'kg' }, {
    bon_commande: [{ article: 'X', unite: 'kg', prix_unitaire: 4 }],
  });
  assert.equal(valorise.motif, '');
  assert.ok(valorise.prix_unitaire > 0);

  const nonValorise = resolvePrixLigne({ article_nom: 'X', unite: 'kg' }, {
    bon_commande: [{ article: 'X', unite: 'kg', prix_unitaire: 0 }],
  });
  assert.notEqual(nonValorise.motif, '');
  assert.equal(nonValorise.prix_unitaire, null);
});

test('les lignes d\'unité divergente sont exclues de la moyenne, pas converties', () => {
  const r = prixPondereSource(
    [
      { article: 'UREE', unite: 'kg', prix_unitaire: 10, quantite: 100 },
      { article: 'UREE', unite: 'L', prix_unitaire: 1000, quantite: 100 },
    ],
    cleArticle('UREE'),
    'KG'
  );
  assert.equal(r.prix, 10);
});

// --------------------------------------------------------------------------
// Invariante de conservation
// --------------------------------------------------------------------------

test('conservation : autant de lignes en sortie qu\'en entrée, même ordre', () => {
  const lignes = [
    { article_nom: 'A', unite: 'kg', quantite: 1 },
    { article_nom: 'B', unite: 'kg', quantite: 2 },
    { article_nom: 'C', unite: 'kg', quantite: 3 },
  ];
  const { items } = valoriserLignes(lignes, (art) => (
    art === cleArticle('B') ? { bon_commande: [{ article: 'B', unite: 'kg', prix_unitaire: 7 }] } : {}
  ));
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.article_nom), ['A', 'B', 'C']);
  assert.deepEqual(items.map((i) => i.quantite), [1, 2, 3]);
});

test('conservation : une ligne non valorisée entre en stock SANS prix, jamais exclue', () => {
  const lignes = [
    { article_nom: 'SANS PRIX', unite: 'kg', quantite: 5 },
    { article_nom: 'AVEC PRIX', unite: 'kg', quantite: 5 },
  ];
  const { items, resume } = valoriserLignes(lignes, (art) => (
    art === cleArticle('AVEC PRIX') ? { bon_commande: [{ article: 'AVEC PRIX', unite: 'kg', prix_unitaire: 3 }] } : {}
  ));
  assert.equal(items.length, 2);
  const sansPrix = items[0];
  assert.equal(sansPrix.quantite, 5, 'la quantité entre en stock même sans prix');
  assert.ok(!('prix_unitaire' in sansPrix), 'aucun prix_unitaire, pas même 0');
  assert.equal(sansPrix.prix_source, null);
  assert.equal(sansPrix.prix_motif, MOTIF.AUCUNE_SOURCE);
  assert.equal(items[1].prix_unitaire, 3);
  assert.deepEqual(resume, {
    total: 2,
    valorisees: 1,
    non_valorisees: 1,
    non_verifiees: 0,
    par_source: { bon_commande: 1 },
    par_motif: { [MOTIF.AUCUNE_SOURCE]: 1 },
  });
});

test('conservation : un prix résiduel à 0 est RETIRÉ, pas conservé', () => {
  const { items } = valoriserLignes([{ article_nom: 'X', unite: 'kg', quantite: 2, prix_unitaire: 0 }], () => ({}));
  assert.equal(items.length, 1);
  assert.ok(!('prix_unitaire' in items[0]));
  assert.equal(items[0].quantite, 2);
});

test('conservation : liste vide → liste vide, aucun crash', () => {
  const { items, resume } = valoriserLignes([], () => ({}));
  assert.deepEqual(items, []);
  assert.equal(resume.total, 0);
});


// --------------------------------------------------------------------------
// Re-valorisation : le drapeau d'invérifiabilité doit pouvoir DISPARAÎTRE
//
// Le spec §C prévoit qu'une facture recalcule le PMP rétroactivement : des
// lignes déjà valorisées seront re-valorisées avec de meilleures sources. Un
// drapeau figé survivrait à une valorisation devenue vérifiable et gonflerait
// le tableau de bord à jamais.
// --------------------------------------------------------------------------

test('re-valorisation : le drapeau tombe quand les unités deviennent comparables', () => {
  const ligneDejaMarquee = {
    article_nom: 'X', unite: 'kg', quantite: 10,
    prix_unite_verifiee: false, prix_source: 'bon_commande', prix_reference: 'BDC-1',
  };
  const { items, resume } = valoriserLignes([ligneDejaMarquee], () => ({
    // Cette fois la source PORTE une unité, comparable à celle du stock.
    facture: [{ article: 'X', unite: 'kg', prix_unitaire: 12, quantite: 10, reference: 'FAC-9' }],
  }));
  assert.equal(items[0].prix_unitaire, 12);
  assert.ok(
    !('prix_unite_verifiee' in items[0]),
    'drapeau figé : la ligne resterait « invérifiable » alors qu\'elle vient d\'être vérifiée'
  );
  assert.equal(resume.non_verifiees, 0);
});

test('re-valorisation : le drapeau RESTE si la nouvelle source n\'a pas d\'unité', () => {
  const ligne = { article_nom: 'X', unite: 'kg', quantite: 10, prix_unite_verifiee: false };
  const { items, resume } = valoriserLignes([ligne], () => ({
    facture: [{ article: 'X', unite: '', prix_unitaire: 12, quantite: 10 }],
  }));
  assert.equal(items[0].prix_unite_verifiee, false);
  assert.equal(resume.non_verifiees, 1);
});

// --------------------------------------------------------------------------
// non_verifiees : le compte doit exister là où on le lit
// --------------------------------------------------------------------------

test('resume.non_verifiees compte les lignes valorisées sans unité comparable', () => {
  const { resume } = valoriserLignes(
    [
      { article_nom: 'A', unite: 'kg', quantite: 1 },  // BDC sans unité  → non vérifiée
      { article_nom: 'B', unite: 'kg', quantite: 1 },  // BDC avec unité  → vérifiée
      { article_nom: 'C', unite: 'kg', quantite: 1 },  // absent du BDC   → non valorisée
    ],
    (cle) => ({
      bon_commande: [
        { article: 'A', unite: '', prix_unitaire: 5 },
        { article: 'B', unite: 'kg', prix_unitaire: 7 },
      ],
    })
  );
  assert.equal(resume.total, 3);
  assert.equal(resume.valorisees, 2);
  assert.equal(resume.non_valorisees, 1);
  assert.equal(resume.non_verifiees, 1, 'seules les lignes VALORISÉES mais invérifiables comptent');
});

test('non_verifiees n\'inclut pas les lignes non valorisées', () => {
  // Une ligne sans prix n'est pas « invérifiable » : elle est absente. Les
  // confondre gonflerait le compte avec des lignes qui n'ont aucun prix à vérifier.
  const { resume } = valoriserLignes([{ article_nom: 'INCONNU', unite: 'kg', quantite: 1 }], () => ({}));
  assert.equal(resume.non_valorisees, 1);
  assert.equal(resume.non_verifiees, 0);
});
