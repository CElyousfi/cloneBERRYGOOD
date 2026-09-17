/*
 * campagneParcelleQuinzaine.js — VENTILATION d'une parcelle par quinzaine.
 *
 * ── À QUOI ÇA SERT ─────────────────────────────────────────────────────────
 * La grille Campagne montre une parcelle en UNE colonne : le cumul de toute la
 * campagne. On y lit « 166 JH/Ha d'entretien structure », jamais QUAND ils ont
 * été consommés — trois quinzaines calmes puis une flambée, ou un rythme
 * régulier, s'affichent exactement pareil.
 *
 * Ce module fait pivoter les MÊMES lignes brutes sur l'axe du temps : la
 * parcelle est figée, les colonnes deviennent les quinzaines. Il ne calcule
 * rien de neuf — il ne fait que ré-étiqueter `periode` en `parcelle` pour que
 * le pivot partagé (AnalytiqueUtils.buildAnalytiquePivotByFamille) et la grille
 * partagée (PivotAnalytiqueGrid) s'appliquent tels quels. Une seule mécanique
 * d'agrégation dans l'app, donc un seul endroit où un total peut être faux.
 */
// @ts-check

/**
 * Lignes brutes d'une parcelle, ré-étiquetées pour un pivot PAR QUINZAINE.
 * PURE.
 *
 * Le `ha` porté par chaque colonne est celui de la PARCELLE, identique
 * partout : une quinzaine ne possède pas de surface propre. C'est ce qui rend
 * « JH/Ha » lisible colonne par colonne — et c'est aussi pourquoi la surface
 * du TOTAL ne peut pas être la somme des colonnes (elle vaudrait 4 × la
 * parcelle sur 4 quinzaines) ; l'appelant la passe en `totalHa` à la grille.
 *
 * @param {Array<Object>} rows lignes de `campagne-analytique-detail`
 *   (champs : parcelle, periode, famille, code, operation, jh, cout, nbOuv).
 * @param {string} parcelle libellé BEE ONE de la parcelle à isoler.
 * @param {number} ha surface de la parcelle, 0 si inconnue.
 * @returns {Array<Object>} lignes au format attendu par
 *   buildAnalytiquePivotByFamille, avec `parcelle` = période.
 */
function lignesParQuinzaine(rows, parcelle, ha) {
  var cible = String(parcelle || '').trim();
  if (!cible) return [];
  var surface = Number(ha) > 0 ? Number(ha) : 0;
  var out = [];
  (rows || []).forEach(function (r) {
    if (!r || String(r.parcelle || '').trim() !== cible) return;
    var periode = String(r.periode || '').trim();
    if (!periode) return;
    out.push({
      // L'axe des colonnes : la QUINZAINE prend la place de la parcelle.
      parcelle: periode,
      ha: surface,
      jh: Number(r.jh) || 0,
      cout: Number(r.cout) || 0,
      nbOuv: Number(r.nbOuv) || 0,
      operation: r.operation,
      operationGroupe: r.code,
      operationFamille: r.famille,
    });
  });
  return out;
}

/**
 * Quinzaines présentes pour cette parcelle, dans l'ordre. PURE.
 *
 * Dérivé des lignes elles-mêmes, jamais d'un calendrier : une parcelle
 * plantée en cours de campagne n'a pas à afficher des colonnes vides pour
 * les quinzaines où elle n'existait pas encore.
 *
 * @param {Array<Object>} rows lignes brutes (avant ré-étiquetage).
 * @param {string} parcelle
 * @returns {Array<string>} périodes triées.
 */
function periodesDe(rows, parcelle) {
  var cible = String(parcelle || '').trim();
  var vues = {};
  (rows || []).forEach(function (r) {
    if (!r || String(r.parcelle || '').trim() !== cible) return;
    var p = String(r.periode || '').trim();
    if (p) vues[p] = true;
  });
  return Object.keys(vues).sort();
}

export { lignesParQuinzaine, periodesDe };
