/*
 * fichierPaieStore.test.js
 *
 * Ce module conserve le fichier de paie. Sa valeur tient à deux choses, et les
 * tests portent sur celles-là :
 *
 *  1. ce qu'il REFUSE de conserver — noms, RIB, et tout champ que personne n'a
 *     décidé de garder. Une donnée bancaire conservée devient une responsabilité
 *     permanente, et le rapprochement n'en a aucun besoin ;
 *  2. ce qu'il REFUSE d'importer — un fichier à moitié lu deviendrait la
 *     référence de tout le monde et ferait apparaître des écarts durables,
 *     imputés à Smart Berry.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const F = require(path.join(__dirname, '../fichierPaieStore.js'));

/** Import valide minimal. */
function imp(extra) {
  return F.normaliser(Object.assign({
    periode: 'Quinzaine 01',
    dateDebut: '2026-07-01',
    dateFin: '2026-07-15',
    nomFichier: 'pointage 1ér Qnz JUILLET.xlsx',
    transport: 26325,
    sousTraitance: 7950,
    pointage: [
      { matricule: '5', jours: 12, montantBrut: 1403.68, montantNet: 1309, equipe: 'BGF 1' },
      { matricule: '6', jours: 13, montantBrut: 1647.45, montantNet: 1537, equipe: 'BGF 2' },
    ],
    sansCnss: [
      { matricule: '6', jours: 2, montantBrut: 214.37, montantNet: 200, equipe: 'BGF 2' },
      { matricule: '99', jours: 5, montantBrut: 500, montantNet: 466, equipe: 'BGF 3' },
    ],
  }, extra || {}));
}

test('normaliser — les NOMS et les RIB ne sont jamais conservés', () => {
  // Le cœur du module. Le classeur porte une feuille VIREMENT avec les RIB et
  // les noms de 250 personnes. Une liste blanche stricte est la seule garantie
  // qui ne s'oublie pas : un filtre en sortie, lui, peut être contourné par un
  // champ ajouté plus tard.
  const out = F.normaliser({
    periode: 'Q1', dateDebut: '2026-07-01', dateFin: '2026-07-15',
    pointage: [{
      matricule: '5', jours: 12, montantNet: 1309,
      nom: 'EL HADDAJ AZIZ', rib: '007353000232500030665831', cin: 'X123', iban: 'MA64…',
    }],
  });
  const l = out.lignes[0];
  assert.strictEqual(l.matricule, '5');
  ['nom', 'rib', 'cin', 'iban', 'personnel'].forEach((k) => {
    assert.strictEqual(l[k], undefined, k + ' ne doit pas être conservé');
  });
  // Et la forme est FERMÉE : rien d'autre que les champs prévus.
  assert.deepStrictEqual(Object.keys(l).sort(),
    ['anciennete', 'equipe', 'feries', 'feuille', 'jours', 'matricule',
      'montantBrut', 'montantNet', 'primeFonctionBrut'].sort());
});

test('normaliserLigne — sans matricule exploitable, la ligne est écartée', () => {
  // Une ligne de total ou un séparateur n'a pas de matricule numérique. La
  // conserver fausserait tous les cumuls.
  assert.strictEqual(F.normaliserLigne({ matricule: 'Total', montantNet: 999 }, 'POINTAGE'), null);
  assert.strictEqual(F.normaliserLigne({}, 'POINTAGE'), null);
  assert.strictEqual(F.normaliserLigne({ matricule: 'CA10563' }, 'POINTAGE').matricule, '10563');
});

test('totaux — recalculés DEPUIS les lignes, jamais repris du client', () => {
  // Ce qui fait foi, c'est ce qu'on stocke. Un total envoyé par le client
  // pourrait survivre à des lignes écartées à la normalisation, et le document
  // serait incohérent avec lui-même.
  const t = F.totaux(imp().lignes);
  assert.strictEqual(t.effectif, 4);
  assert.strictEqual(t.jours, 32);
  assert.strictEqual(t.net, 1309 + 1537 + 200 + 466);
  assert.strictEqual(t.declares, 2);
  assert.strictEqual(t.nonDeclares, 2);
});

test('totaux — les MIXTES sont comptés : c\'est la piste du résidu', () => {
  // Les ouvriers présents sur LES DEUX feuilles ont une partie de leurs journées
  // déclarée et l'autre non, alors que Smart Berry leur attribue un statut unique
  // pour toute la quinzaine. Cela ne se lit QUE dans le détail par ouvrier —
  // c'est précisément ce que la conservation du fichier rend possible.
  assert.strictEqual(F.totaux(imp().lignes).mixtes, 1);
});

test('valider — REFUSE un fichier dont le net est nul', () => {
  // Des lignes présentes ET un net à zéro signalent une colonne mal lue, pas une
  // quinzaine sans paie. Conservé, ce fichier deviendrait la référence de tout le
  // monde et installerait un écart permanent imputé à Smart Berry.
  const v = F.valider(imp({
    pointage: [{ matricule: '5', jours: 12, montantBrut: 1403 }], sansCnss: [],
  }));
  assert.strictEqual(v.ok, false);
  assert.match(v.raison, /Montant Net/);
});

test('valider — REFUSE un fichier sans dates', () => {
  // Sans bornes, l'appariement automatique est impossible et le fichier ne
  // servirait à rien.
  assert.strictEqual(F.valider(imp({ dateDebut: '' })).ok, false);
});

test('valider — REFUSE un fichier sans aucune ligne lue', () => {
  const v = F.valider(imp({ pointage: [], sansCnss: [] }));
  assert.strictEqual(v.ok, false);
  assert.match(v.raison, /POINTAGE/);
});

test('valider — REFUSE au-delà du plafond de lignes', () => {
  // Garde-fou de taille : un document Firestore plafonne à 1 Mo, et au-delà de
  // 4 000 lignes ce n'est plus une quinzaine mais un autre fichier.
  const bcp = [];
  for (let i = 0; i < F.MAX_LIGNES + 1; i++) bcp.push({ matricule: String(i + 1), jours: 1, montantNet: 1 });
  const v = F.valider(F.normaliser({ periode: 'Q1', dateDebut: '2026-07-01',
    dateFin: '2026-07-15', pointage: bcp }));
  assert.strictEqual(v.ok, false);
  assert.match(v.raison, /quinzaine/);
});

test('valider — accepte un import complet', () => {
  assert.deepStrictEqual(F.valider(imp()), { ok: true, raison: '' });
});

test('normaliser — sous-traitance : `null` distinct de 0', () => {
  // « Feuille non lue » n'est pas « aucune sous-traitance ». Conserver un 0
  // ferait apparaître un écart durable face aux 7 950 DH de Smart Berry.
  assert.strictEqual(imp({ sousTraitance: null }).sousTraitance, null);
  assert.strictEqual(imp({ sousTraitance: undefined }).sousTraitance, null);
  assert.strictEqual(imp({ sousTraitance: 0 }).sousTraitance, 0);
});

test('versDocument — horodatage et auteur INJECTÉS, jamais lus d\'une horloge', () => {
  const doc = F.versDocument(imp(), '2026-08-22T12:00:00.000Z',
    { uid: 'u1', profileId: 'rh', email: 'a@b.c' });
  assert.strictEqual(doc.importe_at, '2026-08-22T12:00:00.000Z');
  assert.strictEqual(doc.importe_par.profileId, 'rh');
  assert.strictEqual(doc.totaux.effectif, 4);
  // Auteur inconnu : des champs vides, jamais `undefined` — Firestore refuse
  // `undefined` et fait échouer l'écriture ENTIÈRE.
  const anon = F.versDocument(imp(), '2026-08-22T12:00:00.000Z', null);
  assert.strictEqual(anon.importe_par.uid, null);
  assert.strictEqual(anon.importe_par.profileId, '');
});

test('parPeriode — rend la forme attendue par le rapprochement', () => {
  // Un fichier STOCKÉ doit se comparer exactement comme un fichier fraîchement
  // déposé : un seul chemin de comparaison, donc un seul comportement à
  // vérifier.
  const doc = F.versDocument(imp(), '2026-08-22T12:00:00.000Z', null);
  const p = F.parPeriode([doc])['Quinzaine 01'];
  assert.strictEqual(p.postes.jours, 32);
  assert.strictEqual(p.postes.net, 1309 + 1537 + 200 + 466);
  assert.strictEqual(p.postes.transport, 26325);
  assert.strictEqual(p.postes.sousTraitance, 7950);
  // `mixtes` est servi comme un TABLEAU : le rapprochement en lit la longueur,
  // comme pour un fichier fraîchement lu.
  assert.strictEqual(p.postes.mixtes.length, 1);
  assert.strictEqual(p.postes.effectifDeclaresPurs, 1);
});

test('parPeriode — ignore les documents sans période', () => {
  assert.deepStrictEqual(Object.keys(F.parPeriode([{ lignes: [] }, null])), []);
});
