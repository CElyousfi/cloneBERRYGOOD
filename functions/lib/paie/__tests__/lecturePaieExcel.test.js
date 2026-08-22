/*
 * lecturePaieExcel.test.js
 *
 * Le fichier de paie est la SOURCE DE VÉRITÉ : une erreur de lecture ne produit
 * pas un plantage, elle produit un rapprochement faux — et on cherche ensuite
 * l'écart dans le code, pendant des heures.
 *
 * Chaque test ci-dessous fige un piège RÉELLEMENT rencontré le 2026-08-22, avec
 * ce qu'il a coûté. Les grilles sont écrites en clair : le module ne prend pas
 * de fichier, donc un test peut décrire en dix lignes exactement la feuille
 * qu'il vérifie.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const L = require(path.join(__dirname, '../lecturePaieExcel.js'));

/** En-tête réel des feuilles POINTAGE / SANS CNSS (15 colonnes de jours). */
const ENTETE_15 = [
  'Matricule', 'Personnel', 'Salaire de base Brut',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15',
  'Jour férié ', 'Nbr jour travail', 'Total', 'Prime ancienneté   ',
  'Prime Fonction Brut', 'Montant Brut', 'Montant  Net', "Nom d'equipe",
];

/** Le même avec SEIZE colonnes de jours : tout est décalé d'un cran. */
const ENTETE_16 = [
  'Matricule', 'Personnel', 'Salaire de base Brut',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16',
  'Jour férié ', 'Nbr jour travail', 'Total', 'Prime ancienneté   ',
  'Prime Fonction Brut', 'Montant Brut', 'Montant  Net', "Nom d'equipe",
];

/** Construit une ligne d'ouvrier alignée sur l'en-tête fourni. */
function ligne(entete, mat, valeurs) {
  const r = new Array(entete.length).fill(null);
  r[0] = mat;
  r[1] = valeurs.nom || 'OUVRIER';
  r[2] = valeurs.base === undefined ? 97.44 : valeurs.base;
  const at = (lib) => entete.findIndex((c) => L.normaliserLibelle(c) === L.normaliserLibelle(lib));
  r[at('Jour férié')] = valeurs.feries || 0;
  r[at('Nbr jour travail')] = valeurs.jours || 0;
  r[at('Prime ancienneté')] = valeurs.anc || 0;
  r[at('Prime Fonction Brut')] = valeurs.pf || 0;
  r[at('Montant Brut')] = valeurs.brut || 0;
  r[at('Montant Net')] = valeurs.net || 0;
  r[at("Nom d'equipe")] = valeurs.equipe || 'BGF 1';
  return r;
}

/** Bandeau de titre, de hauteur variable selon les feuilles. */
const BANDEAU = [
  [null, null, null, 'Fiche de Pointage "1"'],
  [null, null, null, ' Quinzaine : Du 01/07/2026 Au 15/07/2026'],
  ['Berry Good Farms'],
];

// ───────────────────────── PIÈGE 1 — la ligne de TOTAL ─────────────────────

test('PIÈGE 1 — la ligne de TOTAL est exclue (sinon toutes les sommes DOUBLENT)', () => {
  // Son « Matricule » est du texte, ses montants sont numériques comme ceux
  // d'un ouvrier. L'inclure a fait lire 2 968 journées là où il y en avait
  // 1 484 — un doublement EXACT, donc parfaitement crédible.
  const grille = [
    ...BANDEAU, ENTETE_15,
    ligne(ENTETE_15, 5, { jours: 12, brut: 1403.68, net: 1309 }),
    ligne(ENTETE_15, 6, { jours: 13, brut: 1647.45, net: 1537 }),
    ligne(ENTETE_15, 'Total', { jours: 25, brut: 3051.13, net: 2846 }),
  ];
  const lignes = L.lireFeuilleOuvriers(grille);
  assert.strictEqual(lignes.length, 2);
  assert.strictEqual(L.agregerOuvriers(lignes).jours, 25);
  assert.strictEqual(L.agregerOuvriers(lignes).net, 2846);
});

test('estLigneTotal — reconnaît les formes de total, garde les matricules', () => {
  ['Total', 'TOTAL GENERAL', '', '   ', null, undefined, 'Personnel']
    .forEach((v) => assert.strictEqual(L.estLigneTotal(v), true, String(v)));
  // Excel rend parfois un matricule en flottant : « 5 » devient « 5.0 ».
  [5, '5', ' 10563 ', '10563.0'].forEach((v) => assert.strictEqual(L.estLigneTotal(v), false, String(v)));
  // Un matricule alphanumérique du POINTAGE n'existe pas dans ces feuilles ;
  // s'il apparaissait, mieux vaut l'écarter que l'agréger par erreur.
  assert.strictEqual(L.estLigneTotal('CA10563'), true);
});

// ──────────────────── PIÈGE 2 — les colonnes décalées ──────────────────────

test('PIÈGE 2 — 16 colonnes de jours : tout est lu PAR EN-TÊTE, pas par position', () => {
  // La 2ᵉ quinzaine de juillet a une colonne de jours de plus. Lire par index
  // fixe y prend « Total » pour « Prime ancienneté » — d'où la conclusion, à
  // laquelle j'ai failli m'arrêter, que les non-déclarés touchent de
  // l'ancienneté. Ils n'en touchent pas.
  const g15 = [...BANDEAU, ENTETE_15,
    ligne(ENTETE_15, 5, { jours: 12, anc: 116.93, pf: 117.47, brut: 1403.68, net: 1309 })];
  const g16 = [...BANDEAU, ENTETE_16,
    ligne(ENTETE_16, 5, { jours: 12, anc: 116.93, pf: 117.47, brut: 1403.68, net: 1309 })];
  const a = L.lireFeuilleOuvriers(g15)[0];
  const b = L.lireFeuilleOuvriers(g16)[0];
  assert.deepStrictEqual(
    { anc: a.anciennete, pf: a.primeFonctionBrut, net: a.montantNet },
    { anc: b.anciennete, pf: b.primeFonctionBrut, net: b.montantNet }
  );
  assert.strictEqual(b.anciennete, 116.93);
});

test('trouverEnTete — retient la PREMIÈRE occurrence d\'un libellé', () => {
  // Certaines feuilles portent un second tableau à droite. Garder la dernière
  // occurrence ferait lire les colonnes du mauvais tableau, sans rien signaler.
  const en = L.trouverEnTete([['Matricule', 'Montant Brut', 'Matricule', 'Montant Brut']], 'matricule');
  assert.strictEqual(en.index.matricule, 0);
  assert.strictEqual(en.index['montant brut'], 1);
});

test('trouverEnTete — null si l\'ancre est absente, jamais un index vide', () => {
  // Un index vide se lirait « feuille sans données » ; `null` dit « je n'ai pas
  // reconnu cette feuille », ce qui n'est pas la même information.
  assert.strictEqual(L.trouverEnTete([['a', 'b']], 'matricule'), null);
  assert.deepStrictEqual(L.lireFeuilleOuvriers([['a', 'b']]), []);
});

// ─────────── PIÈGE 3 — la feuille porte ses PROPRES totaux ─────────────────

test('PIÈGE 3 — TRANSPORT : on LIT « Montant Total », on ne le recalcule pas', () => {
  // Sommer « tout ce qui est à droite du tarif » ré-additionne les colonnes de
  // total de la feuille : 849 475 DH de transport au lieu de 26 325. Trente
  // fois le montant réel, et aucune erreur levée.
  const grille = [
    [null, null, null, null, 'ETAT DES TRANSPORTEURS'],
    [null, 'Personnel', 'Salaire de base', '1', '2', '3',
      'Total des places', 'Montant Total'],
    ['BOUCHAREN', 'EL MGHITNI', 30, 2, 2, 2, 14, 420],
    ['EL BACHIR', 'EL SEGHIRE', 30, 15, 22, 16, 269, 8070],
    ['Total', null, null, null, null, null, 283, 8490],
  ];
  const t = L.lireTransport(grille);
  assert.strictEqual(t.equipes.length, 2);
  assert.strictEqual(t.total, 8490);
  assert.strictEqual(t.places, 283);
  assert.strictEqual(t.equipes[1].tarif, 30);
});

// ─────────────────── PIÈGE 4 — la clé matricule ────────────────────────────

test('PIÈGE 4 — les matricules se normalisent comme le registre Smart Berry', () => {
  // Le registre est keyé numérique. Une normalisation différente ici rendrait
  // tout rapprochement nominatif systématiquement vide — et donnerait l'illusion
  // que le fichier et Smart Berry ne parlent pas des mêmes gens.
  assert.strictEqual(L.cleMatricule('CA10563'), '10563');
  assert.strictEqual(L.cleMatricule(' 5 '), '5');
  assert.strictEqual(L.cleMatricule(null), '');
});

// ─────────────── PIÈGE 5 — « Prime Fonction Brut » agrège trois postes ─────

test('PIÈGE 5 — le champ garde le nom du FICHIER, pas le nôtre', () => {
  // « Prime Fonction Brut » agrège prime de fonction + heures sup + prime de
  // traitement. L'exposer sous le nom `primeFonction` inviterait à le comparer
  // à notre seule prime de fonction : un poste contre trois.
  const grille = [...BANDEAU, ENTETE_15, ligne(ENTETE_15, 5, { jours: 1, pf: 250, brut: 347, net: 324 })];
  const l = L.lireFeuilleOuvriers(grille)[0];
  assert.strictEqual(l.primeFonctionBrut, 250);
  assert.strictEqual(l.primeFonction, undefined);
});

// ─────────────── La quinzaine se lit DANS la feuille ───────────────────────

test('la période vient de la FEUILLE, jamais du nom de fichier', () => {
  // macOS encode les accents en NFD : un test `/2éme/` écrit en NFC ne matche
  // pas le nom réel. Deux quinzaines ont été interverties comme ça, et le
  // rapport était faux sans que rien ne se lève.
  assert.deepStrictEqual(L.periodeDeGrille(BANDEAU),
    { debut: '2026-07-01', fin: '2026-07-15' });
  assert.strictEqual(L.periodeDeGrille([['rien à voir']]), null);
});

// ─────────────── Populations : les MIXTES ──────────────────────────────────

test('postesExcel — les ouvriers présents sur LES DEUX feuilles sont comptés à part', () => {
  // Une partie de leurs journées est déclarée, l'autre non. Smart Berry
  // attribue un statut UNIQUE par ouvrier et par quinzaine : c'est une
  // divergence de modèle, pas un détail. Les noyer dans l'une des deux
  // populations empêcherait de la voir.
  const P = L.lireFeuilleOuvriers([...BANDEAU, ENTETE_15,
    ligne(ENTETE_15, 5, { jours: 12, brut: 1000, net: 933 }),
    ligne(ENTETE_15, 6, { jours: 13, brut: 1100, net: 1026 })]);
  const S = L.lireFeuilleOuvriers([...BANDEAU, ENTETE_15,
    ligne(ENTETE_15, 6, { jours: 2, brut: 214, net: 200 }),
    ligne(ENTETE_15, 99, { jours: 5, brut: 500, net: 466 })]);
  const p = L.postesExcel({ pointage: P, sansCnss: S, transport: { total: 300, places: 10 } });
  assert.deepStrictEqual(p.mixtes, ['6']);
  assert.strictEqual(p.effectifDeclaresPurs, 1);
  assert.strictEqual(p.effectifNonDeclaresPurs, 1);
  assert.strictEqual(p.jours, 32);
  assert.strictEqual(p.net, 933 + 1026 + 200 + 466);
  assert.strictEqual(p.transport, 300);
});

test('agregerOuvriers — une feuille vide vaut zéro partout, jamais NaN', () => {
  // Un `NaN` se propage silencieusement dans tous les totaux en aval et rend le
  // rapport entier illisible.
  const a = L.agregerOuvriers([]);
  Object.keys(a).forEach((k) => assert.strictEqual(a[k], 0, k));
  const b = L.agregerOuvriers([{ jours: 'abc', montantNet: undefined, montantBrut: NaN }]);
  assert.strictEqual(b.jours, 0);
  assert.strictEqual(b.net, 0);
  assert.strictEqual(b.brut, 0);
});
