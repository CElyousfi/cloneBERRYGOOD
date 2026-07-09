'use strict';
// @ts-check

/**
 * refParcelleFerme.js — Règle PURE de dérivation parcelle → ferme SB.
 *
 * Contexte (docs/spec-referentiel-parcelle-ferme.md) : la ferme fine SB
 * (`F1 | F5 | Avocatier | BAHIA`) N'EXISTE PAS comme entité dans BEE ONE. La
 * table `Fermes` n'a que 2 lignes (IDFermes=1 « BERRY GOOD Farms », IDFermes=2
 * « BAHIA »). La ferme fine est un concept Smart Berry dérivé du LABEL de la
 * parcelle (`ParcelleCulturale.Ref`) + du `Ref_parcelle` + de la variété. La FK
 * `Fermes` ne sert qu'à isoler BAHIA (IDFermes=2).
 *
 * Cette fonction REMPLACE la liste codée en dur de `deriveFerme`
 * (functions/pointageService.js:320, dupliquée sqlSyncService.js:927). Elle DOIT
 * reproduire EXACTEMENT le rattachement actuel sur les données actives (gate
 * « migration 100 % iso », §7 du spec) — c'est pourquoi les listes numériques et
 * l'ordre des tests sont FIGÉS sur la logique existante. Ne pas « améliorer » la
 * règle sans re-prouver l'iso.
 *
 * ── RÈGLE DE PRIORITÉ (§3 du spec) ─────────────────────────────────────────
 * 1. `idFermes == 2` OU /bahia/i (ref ou label) → BAHIA (entité juridique).
 * 2. Préfixe ref F2/F3/F4/F6 (ou numériques historiques 0031/0033) → Avocatier.
 * 3. Préfixe ref F1 (ou numériques F1 0032/0035/0036) OU label /F1/i OU
 *    secteurs S1-S7 → F1.
 * 4. Préfixe ref F5 (ou numériques F5 0037/0038/0039) OU label /F5/i OU
 *    secteurs S8-S14 → F5.
 * 2bis. FALLBACK variété avocat (HAAS/AVOCAT), APRÈS ref+label : rescape les
 *    parcelles avocat sans mot-clé ferme dans le label, SANS surclasser F1/F5.
 *    ⚠️ AVOCAT-F5 : une parcelle Ref=F5 plantée en avocat reste F5 (le préfixe
 *    F5 n'est PAS capté par la règle 2 : seuls F2/F3/F4/F6 le sont). Décision
 *    tranchée §8.2 : impératif pour l'iso. Reclassification F5→Avocatier =
 *    patch data séparé APRÈS bascule, hors ce module.
 * 5. Sinon → INCONNU (confidence 'unresolved'). Jamais 'Autre' silencieux :
 *    le runtime alerte (§6). Fail-closed préservé (INCONNU != fermeFilter chef).
 *
 * @typedef {'BAHIA'|'F1'|'F5'|'Avocatier'|'INCONNU'} FermeSB
 * @typedef {'high'|'unresolved'} Confidence
 */

/** Numériques historiques rattachés en dur (repris de deriveFerme actuel). */
const F1_NUMERIQUES = new Set(['0032', '0035', '0036']);
const F5_NUMERIQUES = new Set(['0037', '0038', '0039']);
const AVOCATIER_NUMERIQUES = new Set(['0031', '0033']);

/**
 * Résout la ferme SB d'une parcelle à partir de ses signaux BDP.
 *
 * Reproduit EXACTEMENT `deriveFerme(refParcelle, parcelleCulturale)` de
 * pointageService.js (version sécurité, BAHIA prioritaire), en ajoutant :
 *   - le signal `idFermes == 2` → BAHIA (2e signal BAHIA, §8.3) ;
 *   - le signal variété avocat (HAAS/AVOCAT) → Avocatier (equiv. au /avocat/i
 *     sur le label, étendu à la variété) ;
 *   - le retour 'INCONNU' + confidence au lieu de 'Autre' muet.
 *
 * @param {Object} input
 * @param {*} [input.refParcelle] Ref_parcelle BDP (ex. '0041', 'F5', 'B7-AVOCAT')
 * @param {*} [input.label] Parcelle_Culturale / Ref (label, ex. 'F5 YAZMIN MT')
 * @param {*} [input.variete] variété BDP (ex. 'HAAS', 'YAZMIN', 'CORINA')
 * @param {*} [input.idFermes] FK Fermes (1 = BERRY GOOD Farms, 2 = BAHIA)
 * @returns {{ferme: FermeSB, confidence: Confidence}}
 */
function resolveFermeFromParcelle(input) {
  const src = input || {};
  const ref = String(src.refParcelle == null ? '' : src.refParcelle).trim();
  const label = String(src.label == null ? '' : src.label);
  const variete = String(src.variete == null ? '' : src.variete);
  const idFermes = src.idFermes;

  // (1) BAHIA — 2 signaux : FK Fermes=2 (entité juridique) OU nom.
  if (String(idFermes) === '2') return { ferme: 'BAHIA', confidence: 'high' };
  if (/bahia/i.test(ref) || /bahia/i.test(label)) {
    return { ferme: 'BAHIA', confidence: 'high' };
  }

  // (2) Avocatier via préfixe/numériques REF — ordre figé identique à
  //     deriveFerme actuel. La variété avocat est traitée en FALLBACK plus bas
  //     (après ref+label) pour NE JAMAIS surclasser un préfixe F1/F5 : AVOCAT-F5
  //     doit rester F5 (§3/§8.2 — impératif iso).
  // Bloc REF (ref non vide) — ordre figé identique à deriveFerme actuel.
  if (ref) {
    if (ref.startsWith('F1') || F1_NUMERIQUES.has(ref)) return { ferme: 'F1', confidence: 'high' };
    if (ref.startsWith('F5') || F5_NUMERIQUES.has(ref)) return { ferme: 'F5', confidence: 'high' };
    if (
      ref.startsWith('F2') || ref.startsWith('F3') || ref.startsWith('F4') ||
      ref.startsWith('F6') || AVOCATIER_NUMERIQUES.has(ref)
    ) {
      return { ferme: 'Avocatier', confidence: 'high' };
    }
    // ref non vide mais non résolu → on retombe sur le label (comportement actuel).
  }

  // Bloc LABEL — ordre figé identique à deriveFerme actuel.
  if (label) {
    if (/F1/i.test(label)) return { ferme: 'F1', confidence: 'high' };
    if (/F5/i.test(label)) return { ferme: 'F5', confidence: 'high' };
    if (/avocat/i.test(label)) return { ferme: 'Avocatier', confidence: 'high' };
    // Secteurs : S1-S7 = F1, S8-S14 = F5.
    const sMatch = label.match(/\bS(\d{1,2})\b/i);
    if (sMatch) {
      const sNum = parseInt(sMatch[1], 10);
      if (sNum >= 1 && sNum <= 7) return { ferme: 'F1', confidence: 'high' };
      if (sNum >= 8 && sNum <= 14) return { ferme: 'F5', confidence: 'high' };
    }
  }

  // (2bis) FALLBACK variété avocat — n'intervient QUE là où deriveFerme actuel
  //   renverrait 'Autre' (aucun signal ref/label). Ne surclasse donc jamais un
  //   rattachement existant (iso préservé) ; rescape en plus les parcelles avocat
  //   dont le label ne porte aucun mot-clé ferme (ex. variété AVOCAT seule).
  if (/haas|avocat/i.test(variete)) return { ferme: 'Avocatier', confidence: 'high' };

  // (5) Aucun signal → INCONNU (jamais 'Autre' muet ; fail-closed en aval).
  return { ferme: 'INCONNU', confidence: 'unresolved' };
}

module.exports = {
  resolveFermeFromParcelle,
  F1_NUMERIQUES,
  F5_NUMERIQUES,
  AVOCATIER_NUMERIQUES,
};
