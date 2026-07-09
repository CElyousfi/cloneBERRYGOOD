'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { resolveFermeFromParcelle } = require('../../functions/lib/pointage/refParcelleFerme');

// Référence : deriveFerme actuel (pointageService.js, version sécurité avec BAHIA
// prioritaire). Reproduit ici pour prouver l'ISO au grain de la règle.
function deriveFermeLegacy(refParcelle, parcelleCulturale) {
  const ref = (refParcelle || '').trim();
  if (/bahia/i.test(ref) || /bahia/i.test(parcelleCulturale || '')) return 'BAHIA';
  if (ref) {
    if (ref.startsWith('F1') || ref === '0032' || ref === '0035' || ref === '0036') return 'F1';
    if (ref.startsWith('F5') || ref === '0037' || ref === '0038' || ref === '0039') return 'F5';
    if (ref.startsWith('F2') || ref.startsWith('F3') || ref.startsWith('F4') || ref.startsWith('F6') || ref === '0031' || ref === '0033') return 'Avocatier';
  }
  if (parcelleCulturale) {
    if (/F1/i.test(parcelleCulturale)) return 'F1';
    if (/F5/i.test(parcelleCulturale)) return 'F5';
    if (/avocat/i.test(parcelleCulturale)) return 'Avocatier';
    const sMatch = parcelleCulturale.match(/\bS(\d{1,2})\b/i);
    if (sMatch) {
      const sNum = parseInt(sMatch[1], 10);
      if (sNum >= 1 && sNum <= 7) return 'F1';
      if (sNum >= 8 && sNum <= 14) return 'F5';
    }
  }
  return 'Autre';
}

function resolve(refParcelle, label, variete, idFermes) {
  return resolveFermeFromParcelle({ refParcelle, label, variete, idFermes }).ferme;
}

// ── BAHIA ────────────────────────────────────────────────────────────────
test('BAHIA — idFermes=2 (FK Fermes)', () => {
  assert.strictEqual(resolve('0037', 'F5 CORINA', 'CORINA', 2), 'BAHIA');
  assert.strictEqual(resolve('0037', 'F5 CORINA', 'CORINA', '2'), 'BAHIA');
});
test('BAHIA — nom (ref ou label)', () => {
  assert.strictEqual(resolve('BAHIA-1', '', '', 1), 'BAHIA');
  assert.strictEqual(resolve('X', 'EL BAHIA parcelle', '', 1), 'BAHIA');
});
test('BAHIA prime sur avocat/F5', () => {
  assert.strictEqual(resolve('F5', 'BAHIA AVOCAT', 'AVOCAT', 1), 'BAHIA');
});

// ── Avocatier ────────────────────────────────────────────────────────────
test('Avocatier — variété HAAS / AVOCAT (fallback, label sans mot-clé)', () => {
  assert.strictEqual(resolve('B7', '', 'HAAS', 1), 'Avocatier');
  assert.strictEqual(resolve('B6', '', 'AVOCAT', 1), 'Avocatier');
});
test('Avocatier — préfixe ref F2/F3/F4/F6', () => {
  assert.strictEqual(resolve('F2', 'F2 - HAAS', '', 1), 'Avocatier');
  assert.strictEqual(resolve('F3', '', '', 1), 'Avocatier');
  assert.strictEqual(resolve('F4', '', '', 1), 'Avocatier');
  assert.strictEqual(resolve('F6', '', '', 1), 'Avocatier');
});
test('Avocatier — numériques historiques 0031 / 0033', () => {
  assert.strictEqual(resolve('0031', '', '', 1), 'Avocatier');
  assert.strictEqual(resolve('0033', '', '', 1), 'Avocatier');
});
test('Avocatier — label /avocat/i (B7-AVOCAT)', () => {
  assert.strictEqual(resolve('B7-AVOCAT', 'B7-AVOCAT', '', 1), 'Avocatier');
});

// ── F1 ───────────────────────────────────────────────────────────────────
test('F1 — préfixe ref', () => {
  assert.strictEqual(resolve('F1-S6', 'F1-S6.S7 MARAVILLA', '', 1), 'F1');
});
test('F1 — numériques historiques 0032/0035/0036', () => {
  assert.strictEqual(resolve('0032', '', '', 1), 'F1');
  assert.strictEqual(resolve('0035', '', '', 1), 'F1');
  assert.strictEqual(resolve('0036', '', '', 1), 'F1');
});
test('F1 — nouvelle parcelle 0040/0042 via label', () => {
  assert.strictEqual(resolve('0040', 'F1-S6.S7 MARAVILLA', 'MARAVILLA', 1), 'F1');
  assert.strictEqual(resolve('0042', 'F1- S5 MARAVILLA', 'MARAVILLA', 1), 'F1');
});
test('F1 — secteurs S1-S7 via label', () => {
  assert.strictEqual(resolve('X', 'MARAVILLA S1', '', 1), 'F1');
  assert.strictEqual(resolve('X', 'MARAVILLA S7', '', 1), 'F1');
});

// ── F5 ───────────────────────────────────────────────────────────────────
test('F5 — préfixe ref', () => {
  assert.strictEqual(resolve('F5', 'F5 CORINA S8-3', '', 1), 'F5');
});
test('F5 — numériques historiques 0037/0038/0039', () => {
  assert.strictEqual(resolve('0037', '', '', 1), 'F5');
  assert.strictEqual(resolve('0038', '', '', 1), 'F5');
  assert.strictEqual(resolve('0039', '', '', 1), 'F5');
});
test('F5 — nouvelles parcelles 0041/0043 via label', () => {
  assert.strictEqual(resolve('0041', 'F5 YAZMIN MT', 'YAZMIN', 1), 'F5');
  assert.strictEqual(resolve('0043', 'F5- MYA S9', 'MYA', 1), 'F5');
});
test('F5 — secteurs S8-S14 via label', () => {
  assert.strictEqual(resolve('X', 'CORINA S8', '', 1), 'F5');
  assert.strictEqual(resolve('X', 'YAZMIN S14', '', 1), 'F5');
});
test('AVOCAT-F5 reste F5 (préfixe F5 gagne sur variété avocat) — §8.2', () => {
  // Ref=F5 + variété AVOCAT → F5, PAS Avocatier (impératif iso).
  assert.strictEqual(resolve('F5', 'AVOCAT F5', 'AVOCAT', 1), 'F5');
  assert.strictEqual(resolveFermeFromParcelle({ refParcelle: 'F5', label: 'AVOCAT F5', variete: 'AVOCAT', idFermes: 1 }).ferme, 'F5');
});

// ── INCONNU ──────────────────────────────────────────────────────────────
test('INCONNU — aucun signal (confidence unresolved)', () => {
  const r = resolveFermeFromParcelle({ refParcelle: '0044', label: 'PARCELLE NEUVE', variete: '', idFermes: 1 });
  assert.strictEqual(r.ferme, 'INCONNU');
  assert.strictEqual(r.confidence, 'unresolved');
});
test('INCONNU — agrumes sans mot-clé ferme (B6-AGRUMES)', () => {
  assert.strictEqual(resolve('B6-AGRUMES', 'B6-AGRUMES', 'AGRUMES', 1), 'INCONNU');
});
test('INCONNU — tout vide', () => {
  assert.strictEqual(resolve('', '', '', undefined), 'INCONNU');
});

// ── Confidence ───────────────────────────────────────────────────────────
test('confidence high sur résolution', () => {
  assert.strictEqual(resolveFermeFromParcelle({ refParcelle: 'F1', label: '' }).confidence, 'high');
});

// ── Robustesse entrées non-string ───────────────────────────────────────
test('robustesse — null/undefined/nombres', () => {
  assert.strictEqual(resolveFermeFromParcelle({}).ferme, 'INCONNU');
  assert.strictEqual(resolveFermeFromParcelle({ refParcelle: null, label: null }).ferme, 'INCONNU');
  assert.strictEqual(resolveFermeFromParcelle({ refParcelle: 40, label: 'F1' }).ferme, 'F1');
});

// ── ISO vs deriveFerme legacy (gate au grain règle) ──────────────────────
test('ISO — new == legacy sur un large échantillon (hors rescues avocat)', () => {
  const refs = ['', 'F1', 'F1-S6', 'F5', 'F5-MYA', 'F2', 'F3', 'F4', 'F6',
    '0031', '0032', '0033', '0035', '0036', '0037', '0038', '0039',
    '0040', '0041', '0042', '0043', '0044', 'B6-AGRUMES', 'B7-AVOCAT', 'BAHIA-1', 'X'];
  const labels = ['', 'F1-S6.S7 MARAVILLA', 'F5 CORINA S8-3', 'F5 YAZMIN MT',
    'F1- S5 MARAVILLA', 'F5- MYA S9', 'B7-AVOCAT', 'B6-AGRUMES', 'EL BAHIA',
    'MARAVILLA S3', 'CORINA S8', 'YAZMIN S14', 'PARCELLE NEUVE', 'AVOCAT F5'];
  const varietes = ['', 'MARAVILLA', 'YAZMIN', 'CORINA', 'AVOCAT', 'HAAS', 'AGRUMES'];

  for (const ref of refs) {
    for (const label of labels) {
      for (const variete of varietes) {
        const legacy = deriveFermeLegacy(ref, label); // legacy ignore variete/idFermes
        const next = resolveFermeFromParcelle({ refParcelle: ref, label, variete, idFermes: 1 }).ferme;
        if (legacy === 'Autre') {
          // Le nouveau peut rescaper en Avocatier (variété avocat) ou rester INCONNU.
          assert.ok(next === 'INCONNU' || next === 'Avocatier',
            `Autre→${next} attendu INCONNU|Avocatier (ref=${ref} label=${label} var=${variete})`);
        } else {
          // Toute résolution NON-Autre du legacy doit être reproduite à l'identique.
          assert.strictEqual(next, legacy,
            `DIVERGENCE ref=${ref} label=${label} var=${variete}: legacy=${legacy} next=${next}`);
        }
      }
    }
  }
});
