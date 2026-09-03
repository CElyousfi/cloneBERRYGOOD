'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  EMARGEMENT_PREFIX,
  normalizeFermeKey,
  buildEmargementPath,
  isEmargementPath,
  buildEmargementWrite,
} = require('../emargementWrite');
const { sanitizeFilename } = require('../../stock/scanAttachmentUtils');
const {
  validateAttachmentMetadata,
  MAX_ATTACHMENT_BYTES,
} = require('../../stock/scanAttachment');

const META = {
  path: 'rh_emargements/QUINZAINE_04/F1_1700000000000_etat.pdf',
  filename: 'état signé F1.pdf',
  now: 'SERVER_TS',
  actor: { uid: 'u1', profileId: 'rh', name: 'Omar' },
};

// ─────────────────────────── buildEmargementWrite ───────────────────────────

test('buildEmargementWrite : merge TOUJOURS actif', () => {
  const w = buildEmargementWrite('Quinzaine 04', 'F1', META);
  assert.strictEqual(w.options.merge, true);
});

test('buildEmargementWrite : emargements porte EXACTEMENT la clé de la ferme', () => {
  const w = buildEmargementWrite('Quinzaine 04', 'F1', META);
  assert.deepStrictEqual(Object.keys(w.data.emargements), ['F1']);
  assert.strictEqual(w.fermeKey, 'F1');
});

// L'INVARIANT CENTRAL, identique à celui de `montants` (heuresSupWrite.js).
// `set({ emargements: {} }, {merge:true})` remplace la map par une map vide
// (aucune feuille -> le masque porte `emargements`), ce qui effacerait les états
// déposés par les AUTRES fermes de la quinzaine.
test('buildEmargementWrite : emargements n\'est JAMAIS un objet vide', () => {
  const cas = [
    ['Quinzaine 04', 'F1'],
    ['Quinzaine 04', 'Avocatier'],
    ['Quinzaine 03', 'BAHIA'],
    ['Quinzaine 03', ' F5 '],
  ];
  for (const [per, ferme] of cas) {
    const w = buildEmargementWrite(per, ferme, META);
    assert.ok(w.data.emargements && typeof w.data.emargements === 'object',
      'emargements doit être un objet');
    assert.ok(Object.keys(w.data.emargements).length > 0,
      'emargements vide = la map de la quinzaine serait écrasée (' + ferme + ')');
    assert.strictEqual(Object.keys(w.data.emargements).length, 1,
      'une seule ferme par dépôt (' + ferme + ')');
  }
});

test('buildEmargementWrite : la map `montants` n\'est JAMAIS touchée', () => {
  // Le document rh_heures_sup/<periode> porte AUSSI les montants de paie. Une
  // clé `montants` ici — même vide — les effacerait au merge.
  const w = buildEmargementWrite('Quinzaine 04', 'F1', META);
  assert.ok(!Object.prototype.hasOwnProperty.call(w.data, 'montants'));
  assert.deepStrictEqual(Object.keys(w.data).sort(), ['emargements', 'periode']);
});

test('buildEmargementWrite : la ferme est normalisée (casse, accents, espaces)', () => {
  assert.deepStrictEqual(Object.keys(buildEmargementWrite('Q4', 'avocatier', META).data.emargements), ['AVOCATIER']);
  assert.deepStrictEqual(Object.keys(buildEmargementWrite('Q4', ' F5 ', META).data.emargements), ['F5']);
  assert.deepStrictEqual(Object.keys(buildEmargementWrite('Q4', 'Ferme Été', META).data.emargements), ['FERME_ETE']);
});

test('buildEmargementWrite : le LABEL d\'origine est conservé dans l\'entrée', () => {
  const w = buildEmargementWrite('Quinzaine 04', 'Avocatier', META);
  assert.strictEqual(w.data.emargements.AVOCATIER.ferme, 'Avocatier');
});

test('buildEmargementWrite : nom de fichier normalisé (pas d\'espace ni d\'accent)', () => {
  const w = buildEmargementWrite('Quinzaine 04', 'F1', META);
  assert.strictEqual(w.data.emargements.F1.filename, '_tat_sign_F1.pdf');
  // Défense contre la traversée de chemin : les composants de dossier sautent.
  const w2 = buildEmargementWrite('Quinzaine 04', 'F1',
    Object.assign({}, META, { filename: '../../etc/passwd' }));
  assert.strictEqual(w2.data.emargements.F1.filename, 'passwd');
});

test('buildEmargementWrite : path, horodatage et auteur sont portés', () => {
  const w = buildEmargementWrite('Quinzaine 04', 'F1', META);
  const e = w.data.emargements.F1;
  assert.strictEqual(w.data.periode, 'Quinzaine 04');
  assert.strictEqual(e.path, META.path);
  assert.strictEqual(e.uploaded_at, 'SERVER_TS');
  assert.deepStrictEqual(e.uploaded_by, META.actor);
});

test('buildEmargementWrite : periode, ferme ou path vide refusé', () => {
  assert.throws(() => buildEmargementWrite('', 'F1', META), /periode/);
  assert.throws(() => buildEmargementWrite('Quinzaine 04', '', META), /ferme/);
  assert.throws(() => buildEmargementWrite('Quinzaine 04', '   ', META), /ferme/);
  assert.throws(() => buildEmargementWrite('Quinzaine 04', '---', META), /ferme/);
  assert.throws(() => buildEmargementWrite('Quinzaine 04', 'F1', { path: '' }), /path/);
  assert.throws(() => buildEmargementWrite('Quinzaine 04', 'F1', {}), /path/);
});

test('buildEmargementWrite : aucun chemin à plat `emargements.F1` dans le payload', () => {
  const w = buildEmargementWrite('Quinzaine 04', 'F1', META);
  assert.ok(!Object.prototype.hasOwnProperty.call(w.data, 'emargements.F1'));
});

// ──────────────────────────── chemin Storage ────────────────────────────────

test('buildEmargementPath : rh_emargements/<periode>/<FERME>_<ts>_<fichier>', () => {
  assert.strictEqual(
    buildEmargementPath('Quinzaine 04', 'F1', 'état signé.pdf', 1700000000000),
    'rh_emargements/QUINZAINE_04/F1_1700000000000__tat_sign_.pdf'
  );
});

test('buildEmargementPath : periode ou ferme vide refusée', () => {
  assert.throws(() => buildEmargementPath('', 'F1', 'a.pdf', 1), /periode/);
  assert.throws(() => buildEmargementPath('Q4', '', 'a.pdf', 1), /ferme/);
});

test('isEmargementPath : refuse tout ce qui sort du namespace', () => {
  assert.ok(isEmargementPath('rh_emargements/QUINZAINE_04/F1_1_a.pdf', 'Quinzaine 04'));
  assert.ok(!isEmargementPath('scans/invoices/1_a.pdf', 'Quinzaine 04'));
  assert.ok(!isEmargementPath(EMARGEMENT_PREFIX, 'Quinzaine 04'));
  assert.ok(!isEmargementPath('rh_emargements/QUINZAINE_04/', 'Quinzaine 04'));
  assert.ok(!isEmargementPath('rh_emargements/QUINZAINE_04/../../scans/x.pdf', 'Quinzaine 04'));
  assert.ok(!isEmargementPath(null, 'Quinzaine 04'));
  assert.ok(!isEmargementPath(42, 'Quinzaine 04'));
});

// Le chemin doit être lié à SA quinzaine : sans ça, un appelant autorisé peut
// faire enregistrer sur la quinzaine 05 un objet déposé pour la 04, et le lien
// désignerait un état signé pour une autre paie.
test('isEmargementPath : un objet d\'une AUTRE quinzaine est refusé', () => {
  const chemin = 'rh_emargements/QUINZAINE_04/F1_1_a.pdf';
  assert.ok(isEmargementPath(chemin, 'Quinzaine 04'));
  assert.ok(!isEmargementPath(chemin, 'Quinzaine 05'));
  assert.ok(!isEmargementPath(chemin, 'Quinzaine 03'));
});

test('isEmargementPath : periode manquante = refus (jamais de contrôle relâché par omission)', () => {
  const chemin = 'rh_emargements/QUINZAINE_04/F1_1_a.pdf';
  assert.ok(!isEmargementPath(chemin));
  assert.ok(!isEmargementPath(chemin, ''));
  assert.ok(!isEmargementPath(chemin, '   '));
  assert.ok(!isEmargementPath(chemin, null));
});

test('isEmargementPath : accepte le chemin produit par buildEmargementPath', () => {
  // Les deux fonctions doivent parler du même dossier, quelle que soit la
  // graphie de la période (espaces, casse, accents).
  const cas = ['Quinzaine 04', 'quinzaine 04', 'Quinzaine Été 12'];
  for (const per of cas) {
    const chemin = buildEmargementPath(per, 'Avocatier', 'état signé.pdf', 1700000000000);
    assert.ok(isEmargementPath(chemin, per), per);
  }
});

// Cas du nom de fichier à points consécutifs (« état signé..pdf ») : le front
// les réduit à un seul point AVANT l'upload (HsEmargementFooter.jsx#HSEF_path),
// car sanitizeFilename les conserve et le '..' résultant serait refusé ici —
// après upload, donc avec un objet orphelin et un message indéchiffrable.
test('isEmargementPath : un nom à points consécutifs produirait un chemin refusé', () => {
  assert.ok(sanitizeFilename('état signé..pdf').indexOf('..') !== -1);
  assert.ok(!isEmargementPath('rh_emargements/QUINZAINE_04/F1_1__tat_sign_..pdf', 'Quinzaine 04'));
  // Le collapse appliqué côté front rend le chemin valide.
  const safe = sanitizeFilename('état signé..pdf').replace(/\.{2,}/g, '.');
  assert.ok(isEmargementPath('rh_emargements/QUINZAINE_04/F1_1_' + safe, 'Quinzaine 04'));
});

// ───────────── contrat MIME/taille du dépôt (allowlist par défaut) ──────────

test('émargement : allowlist par défaut = PDF + images, refus au-delà de 25 Mo', () => {
  const MB = 1024 * 1024;
  ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'].forEach((ct) => {
    assert.strictEqual(validateAttachmentMetadata({ size: 3 * MB, contentType: ct }).valid, true, ct);
  });
  const trop = validateAttachmentMetadata({ size: MAX_ATTACHMENT_BYTES, contentType: 'application/pdf' });
  assert.strictEqual(trop.valid, false);
  assert.match(trop.error, /25 Mo/);
});

test('émargement : MIME inconnu refusé (un .xlsx n\'est pas un état signé)', () => {
  const MB = 1024 * 1024;
  const r = validateAttachmentMetadata({
    size: MB,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /non autorisé/);
});
