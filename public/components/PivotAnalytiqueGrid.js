/*
 * PivotAnalytiqueGrid.jsx — GRILLE DE PRÉSENTATION du tableau croisé
 * (groupe M.O → famille GB → opération) × parcelle.
 *
 * Extrait de public/components/AffectationAnalytiqueTable.jsx (LOT 2a) à
 * comportement STRICTEMENT identique : le balisage produit avec une seule série
 * est celui d'avant, à l'octet près. Le filet qui le prouve est
 * tests/unit/affectationAnalytiqueTable.test.js, écrit AVANT l'extraction et
 * resté vert sans modification.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE, aucun identifiant top-level ne
 * fuite (cf. mémoire projet umd-global-collision-smoke-load — une collision
 * crashe le boot React #200). Les noms internes sont préfixés `_pag_` / `_PAG_`.
 * UN SEUL global exposé, et rien d'autre :
 *   window.PivotAnalytiqueGrid
 *
 * Aucun hook, aucun état, aucun fetch : composant de PRÉSENTATION pur. Le
 * calcul du pivot, la résolution culture/Ha, le carrousel, les sélecteurs et la
 * pop-up de détail restent chez l'appelant.
 *
 * ── Props ──────────────────────────────────────────────────────────────────
 *   parcelles     {Array<[string, number]>}  Colonnes : [clé de parcelle, Ha].
 *   groupedRows   {Array<{type,key,label,pivot}>}  Lignes, telles que produites
 *                 par AnalytiqueUtils.buildAnalytiquePivotByFamille.
 *                 `type` ∈ 'groupe' | 'famille' | 'operation'.
 *                 `pivot` = { [cléParcelle]: cellule }.
 *   metrics       {Array<Metric>}  Séries affichées DANS CHAQUE cellule (voir
 *                 plus bas). Une seule série = rendu historique.
 *   color         {string}  Couleur de la culture (bandeaux, bordures, totaux).
 *   title         {string}  Titre du bandeau (aujourd'hui : la culture).
 *   icon          {string}  Classe Font Awesome du bandeau.
 *   firstColumnLabel {string}  En-tête de la 1re colonne (défaut 'Opération').
 *   parcelleLabel {Function}  (cléParcelle) => libellé affiché (défaut : la clé).
 *   note          {string}  Légende discrète sous la grille, reprise en `title`
 *                 sur l'en-tête Total (quand cette colonne existe). Sert à
 *                 énoncer ce que les chiffres ne disent pas — typiquement le
 *                 PÉRIMÈTRE d'une série.
 *   showTotal     {bool}    Colonne Total à droite. Défaut TRUE — le panneau
 *                 « Affectation Analytique » de l'écran Quinzaine (EN
 *                 PRODUCTION) la garde, et son test de non-régression la
 *                 verrouille. `false` la retire ENTIÈREMENT : en-tête, total de
 *                 ligne, grand total du pied. L'écran Campagne s'en sert pour
 *                 ne l'afficher qu'en plein écran. Voir « colSpan » plus bas.
 *   chiffresGroupe {bool}   Totaux DANS le bandeau de section (défaut FALSE :
 *                 bandeau `colSpan` d'origine, celui de l'écran Quinzaine en
 *                 production). À true, la ligne `type: 'groupe'` prend la même
 *                 structure de colonnes qu'une ligne famille et affiche les
 *                 totaux de SA section — agrégés depuis ses lignes famille, donc
 *                 égaux par construction à la somme des lignes affichées dessous
 *                 (le `pivot` de la ligne groupe, lui, ne porte ni budget ni
 *                 `pctIdeal` : le lire donnerait des « — »).
 *   labelPied     {string}  Libellé de la ligne de pied (défaut 'TOTAL').
 *   piedsSupplementaires {Array<{key, label, valeurs, total, aide}>}  Lignes
 *                 ajoutées SOUS le pied. `valeurs` = { [cléParcelle]: [v par
 *                 série] }, `total` = [v par série] — DÉJÀ FORMATÉES (chaînes ou
 *                 nœuds React). Ce sont des RAPPORTS (kg/JH, DH/kg) : ni des
 *                 séries (la grille les agrégerait), ni des lignes famille
 *                 (elles entreraient dans les totaux). Défaut : aucune.
 *   onCellClick   {Function}  ({parcelle, operationFamille, ha, detailRows}) =>
 *                 void. Absent = cellules non cliquables (ni curseur, ni survol).
 *                 Une cellule dont `detailRows` est un tableau VIDE ne l'est pas
 *                 non plus : elle n'existe que parce qu'un budget y est saisi,
 *                 il n'y a rien à détailler. (`detailRows` absent = cliquable,
 *                 contrat historique préservé.)
 *
 * ── Metric ─────────────────────────────────────────────────────────────────
 * Une série = une valeur par cellule.
 *
 * PLUSIEURS SÉRIES ⇒ SOUS-COLONNES (lot « grille sous-colonnes »). Chaque série
 * devient une COLONNE sous l'en-tête de la parcelle, et son `label` devient
 * l'en-tête de cette sous-colonne au lieu d'être répété dans chaque cellule.
 * Empilées, trois séries libellées faisaient de chaque colonne un pavé de texte
 * (« 20.0 Réalisé JH/Ha 15.0 Budget JH/Ha 75.0 Consommé % » dans 110 px).
 *
 * UNE SEULE SÉRIE ⇒ RENDU HISTORIQUE, à l'octet près : un seul <tr> d'en-tête,
 * un <td> par parcelle, `colSpan` du bandeau de groupe inchangé. C'est le mode
 * du panneau « Affectation Analytique » de l'écran Quinzaine, EN PRODUCTION, et
 * c'est tests/unit/affectationAnalytiqueTable.test.js qui le verrouille.
 *
 * ── colSpan DU BANDEAU DE GROUPE ───────────────────────────────────────────
 * C'est le SEUL endroit du composant qui dépend du nombre de colonnes, et il
 * n'échoue jamais bruyamment : trop court ou trop long, le tableau se décale
 * sans qu'aucune erreur ne soit levée. Sa valeur est
 *   parcelles.length × metrics.length + 1 (colonne de libellé)
 *                                     + la LARGEUR de la colonne Total, qui
 *                                       vaut metrics.length en mode
 *                                       sous-colonnes, 1 en mode historique, 0
 *                                       sans `showTotal`.
 * Verrouillé dans les trois cas par tests/unit/pivotAnalytiqueGrid.test.js.
 *
 * ── COLONNE TOTAL : ÉCLATÉE EN MULTI, EMPILÉE EN MONO ──────────────────────
 * Avec PLUSIEURS séries, la colonne Total suit le reste de la grille : une
 * sous-colonne par série, et elle n'est PAS sticky — plusieurs colonnes collées
 * à droite exigeraient un `right` en pixels par sous-colonne, donc des largeurs
 * fixes, mécanisme absent de cette grille (les largeurs sont laissées au
 * navigateur, seul un `minWidth` est posé). Elle défile donc avec le tableau.
 * Avec UNE SEULE série, elle reste la colonne unique historique (`rowSpan: 2`,
 * `position: sticky; right: 0`) — c'est le rendu de l'écran Quinzaine.
 * Dans les deux cas elle reste STRICTEMENT APRÈS les parcelles : `_pag_paint`
 * et `parcelleCell` repèrent les sous-colonnes depuis la GAUCHE, en supposant
 * qu'une seule colonne (le libellé) les précède.
 *
 *   key      {string}    Champ lu dans la cellule du pivot (ex. 'jh', 'cout').
 *   get      {Function}  (cellule) => number|null. Prioritaire sur `key` — c'est
 *                        par là que passe une série CALCULÉE (l'écart,
 *                        typiquement). `null`/`undefined` (par `get` comme par
 *                        `key` absent) = valeur NON RENSEIGNÉE : la cellule
 *                        affiche « — » et ne pèse rien dans les agrégats. À NE
 *                        PAS confondre avec 0 (cf. _pag_raw).
 *   label    {string}    Nom court de la série. Affiché UNIQUEMENT s'il y a
 *                        plusieurs séries (sinon le balisage divergerait du
 *                        rendu historique) : en-tête de sa sous-colonne, sous
 *                        la parcelle comme sous le Total.
 *   unit     {string}    Unité affichée sous la valeur ('JH/Ha', 'DH emp.', …).
 *   basis    {'total'|'perHa'}  Ce que vaut la valeur BRUTE stockée dans le
 *                        pivot. Le réalisé est un TOTAL par cellule ; le budget
 *                        est déjà en JH/Ha. Défaut 'total'.
 *   display  {'total'|'perHa'}  Ce qu'on veut AFFICHER. Défaut 'total'.
 *   format   {Function}  (nombre) => string, appliqué à la valeur convertie.
 *   summary  {Function}  (total brut de la ligne) => string. Texte discret du
 *                        bandeau de ligne groupe. Seule la PREMIÈRE série en
 *                        pose un. Absent = pas de mention.
 *   ratio    {{parts: Function}}  Série RATIO (un pourcentage, typiquement).
 *                        `parts(cellule) => {num, den}|null`, les DEUX termes
 *                        exprimés en quantité TOTALE. La valeur affichée est
 *                        `format(num / den)`.
 *
 * ── POURQUOI UNE SÉRIE RATIO NE PEUT PAS ÊTRE UNE SÉRIE ORDINAIRE ───────────
 * Un pourcentage ne s'additionne pas. Le passer par `get` afficherait la bonne
 * valeur dans chaque cellule et une SOMME DE POURCENTAGES dans les totaux de
 * ligne, de colonne et le grand total : « 340 % » sur quatre parcelles à 85 %.
 * Une moyenne simple serait fausse elle aussi — les parcelles n'ont ni la même
 * surface ni le même engagement. La seule agrégation juste est de sommer
 * séparément le numérateur et le dénominateur, PUIS de diviser : c'est ce que
 * fait `ratio`, et c'est tout ce qu'il fait. `basis` / `display` ne s'y
 * appliquent pas (un ratio est invariant par changement d'unité) et sont ignorés.
 * `parts` renvoie `null` quand le ratio n'a pas de sens (dénominateur nul ou
 * absent) : la cellule affiche « — », jamais 0 %.
 *
 * `basis` et `display` séparés rendent le sens de la conversion EXPLICITE PAR
 * SÉRIE — c'est le point dur : un `_fmt` global divisait par le Ha en supposant
 * que toute valeur brute est un total, ce qui est faux pour le budget (déjà en
 * JH/Ha, donc à MULTIPLIER pour obtenir un total). Règles :
 *   basis === display          → la valeur brute est affichée telle quelle,
 *                                même Ha inconnu.
 *   'total'  → 'perHa'         → valeur / Ha  (Ha inconnu → « — »)
 *   'perHa'  → 'total'         → valeur × Ha  (Ha inconnu → « — »)
 * Les agrégats (total de ligne, de colonne, grand total) somment TOUJOURS la
 * quantité totale de chaque cellule (`basis === 'perHa'` ⇒ valeur × Ha de la
 * colonne), puis appliquent `display` au résultat. Sommer des JH/Ha entre
 * parcelles n'aurait aucun sens. Un agrégat dont AUCUNE cellule n'est
 * renseignée vaut « — », pas 0 (cf. _pag_agrege).
 *
 * Exemple à trois séries (cible du chantier — réalisé / budget / écart) :
 *   metrics={[
 *     { key: 'jh',     label: 'Réalisé', unit: 'JH/Ha',
 *       basis: 'total', display: 'perHa', format: _un,
 *       summary: (t) => `${Math.round(t)} JH total` },
 *     { key: 'budget', label: 'Budget',  unit: 'JH/Ha',
 *       basis: 'perHa', display: 'perHa', format: _un },
 *     { label: 'Écart', unit: 'JH/Ha',
 *       get: CampagneBudgetPivot.ecartCell,   // null si pas de budget / Ha inconnu
 *       basis: 'total', display: 'perHa', format: _signe },
 *   ]}
 * En basculant l'affichage sur Total, l'appelant passe `display: 'total'` sur
 * les trois : le réalisé cesse d'être divisé, le budget se met à être
 * multiplié, et l'écart suit — sans qu'aucune de ces règles ne soit codée ici.
 */
(function () {
  'use strict';

  var _PAG_R = window.React;
  if (!_PAG_R) return;
  var _pag_h = _PAG_R.createElement;

  /**
   * Valeur brute d'une série dans une cellule du pivot.
   *
   * `null` = valeur NON RENSEIGNÉE, à distinguer de 0. Le budget en a un besoin
   * structurel : « aucun budget saisi » (l'état de la plupart des parcelles) doit
   * s'afficher « — », jamais « 0.0 » — un budget nul affiché à côté d'un réalisé
   * se lit comme un dépassement total. Même chose pour l'écart, qui n'existe pas
   * sans budget : un 0 s'y lirait « pile dans le budget ».
   * Une valeur non finie (NaN, ±∞ — division par un Ha nul en amont) est traitée
   * de la même façon : indéterminable, jamais affichée.
   */
  function _pag_raw(metric, cell) {
    if (!cell) return null;
    var v = typeof metric.get === 'function' ? metric.get(cell) : cell[metric.key];
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /**
   * Cellule ouvrable au clic ? Détail EXPLICITEMENT vide → non : une cellule
   * qui n'existe que parce qu'un BUDGET y est saisi (aucun pointage réalisé)
   * porte `detailRows: []`, la rendre cliquable ouvrirait une pop-up vide.
   * `detailRows` ABSENT reste cliquable : le contrat n'a jamais exigé ce champ.
   */
  function _pag_cliquable(cell) {
    return !(Array.isArray(cell.detailRows) && cell.detailRows.length === 0);
  }

  /** Série RATIO ? (cf. en-tête : agrégation par somme des deux termes.) */
  function _pag_isRatio(metric) {
    return !!(metric && metric.ratio && typeof metric.ratio.parts === 'function');
  }

  /**
   * Termes {num, den} d'une série ratio dans une cellule. `null` = ratio sans
   * objet (pas de dénominateur), donc « — » — jamais 0 %.
   */
  function _pag_parts(metric, cell) {
    if (!cell) return null;
    var p = metric.ratio.parts(cell);
    if (!p) return null;
    var num = Number(p.num);
    var den = Number(p.den);
    if (!isFinite(num) || !isFinite(den) || !(den > 0)) return null;
    return {
      num: num,
      den: den
    };
  }

  /**
   * Agrège une série ratio : somme des numérateurs, somme des dénominateurs.
   * `null` = aucune cellule ne porte de ratio.
   */
  function _pag_agregeRatio(metric, cells) {
    var num = 0;
    var den = 0;
    var renseigne = false;
    cells.forEach(function (cell) {
      var p = _pag_parts(metric, cell);
      if (!p) return;
      renseigne = true;
      num += p.num;
      den += p.den;
    });
    return renseigne && den > 0 ? {
      num: num,
      den: den
    } : null;
  }

  /** Rendu d'un couple {num, den} — la division n'a lieu QU'ICI. */
  function _pag_renderRatio(metric, parts) {
    if (!parts) return null;
    return _pag_fmt(metric, parts.num / parts.den);
  }
  function _pag_basis(metric) {
    return metric.basis === 'perHa' ? 'perHa' : 'total';
  }
  function _pag_disp(metric) {
    return metric.display === 'perHa' ? 'perHa' : 'total';
  }

  /**
   * Quantité TOTALE portée par une cellule — la seule grandeur sommable.
   * Jamais appelée sur une valeur non renseignée (les agrégats l'écartent en
   * amont, cf. _pag_agrege).
   */
  function _pag_toTotal(metric, raw, ha) {
    return _pag_basis(metric) === 'perHa' ? raw * (ha || 0) : raw;
  }

  /**
   * Agrège une liste de valeurs par cellule. `null` = AUCUNE cellule renseignée,
   * donc agrégat indéterminable.
   *
   * Deux règles distinctes, et c'est tout l'objet de cette fonction :
   *  - ligne PARTIELLEMENT renseignée → on somme ce qui existe. C'est le
   *    « périmètre budgété » : le budget d'une ligne est la somme des budgets
   *    saisis, jamais complété par des zéros implicites (même règle que les
   *    colonnes budgétaires de l'export Excel).
   *  - ligne ENTIÈREMENT non renseignée → « — », jamais 0. Sans ça une ligne se
   *    contredisait elle-même : toutes ses cellules « — », son total « 0.0 » —
   *    lu « budget nul, donc dépassement total » sur la série budget, et « pile
   *    dans le budget » sur la série écart. C'est le cas COURANT en production
   *    (budget saisi progressivement, Récolte rarement budgétée).
   * Une valeur 0 RENSEIGNÉE, elle, compte : un réalisé nul reste « 0.0 » (le
   * panneau Quinzaine, dont toutes les cellules sont numériques, n'a donc aucun
   * total qui bascule en « — »).
   *
   * @param {Array<{raw: number|null, ha: number}>} parts
   * @returns {number|null}
   */
  function _pag_agrege(metric, parts) {
    var somme = 0;
    var renseigne = false;
    parts.forEach(function (p) {
      if (p.raw === null) return;
      renseigne = true;
      somme += _pag_toTotal(metric, p.raw, p.ha);
    });
    return renseigne ? somme : null;
  }
  function _pag_fmt(metric, value) {
    return typeof metric.format === 'function' ? metric.format(value) : String(value);
  }

  /** Rendu d'une cellule. `null` = indéterminable (valeur absente ou Ha inconnu). */
  function _pag_renderCell(metric, raw, ha) {
    if (raw === null) return null;
    var basis = _pag_basis(metric);
    var disp = _pag_disp(metric);
    if (basis === disp) return _pag_fmt(metric, raw);
    if (!(ha > 0)) return null;
    return _pag_fmt(metric, basis === 'total' ? raw / ha : raw * ha);
  }

  /** Rendu d'un agrégat DÉJÀ exprimé en total. `null` = indéterminable. */
  function _pag_renderTotal(metric, total, ha) {
    if (total === null) return null;
    if (_pag_disp(metric) === 'total') return _pag_fmt(metric, total);
    if (!(ha > 0)) return null;
    return _pag_fmt(metric, total / ha);
  }

  /** Marque d'une valeur non calculable — balisage historique de `_fmt`. */
  function _pag_dash() {
    return _pag_h('span', {
      style: {
        fontSize: 10,
        color: 'var(--gray-400)'
      }
    }, '—');
  }

  /**
   * Empile les séries dans une cellule : une ligne valeur + une ligne unité par
   * série. Avec UNE série, le balisage est exactement celui d'avant
   * l'extraction. Avec plusieurs, la ligne d'unité porte aussi le nom de la
   * série — sans quoi les valeurs seraient indiscernables.
   *
   * Depuis l'éclatement en sous-colonnes — Total compris — le mode empilé ne
   * sert plus que dans le rendu historique à une seule série. Le préfixe de
   * label reste écrit ici parce que le contrat de la fonction, lui, n'a pas
   * changé : elle empile N séries.
   */
  function _pag_stack(metrics, valueOf, valueStyle, unitStyle) {
    var multi = metrics.length > 1;
    var out = [];
    metrics.forEach(function (m, i) {
      var v = valueOf(m, i);
      out.push(_pag_h('div', {
        key: 'v' + i,
        style: valueStyle
      }, v === null ? _pag_dash() : v));
      var unit = m.unit || '';
      out.push(_pag_h('div', {
        key: 'u' + i,
        style: unitStyle
      }, multi && m.label ? unit ? m.label + ' ' + unit : m.label : unit));
    });
    return out;
  }

  /**
   * Survol d'une cellule éclatée en sous-colonnes : colore les K <td> de la
   * MÊME cellule métier, pas seulement celui qui est sous le curseur — un
   * survol qui ne colorerait qu'un tiers de la cellule ferait croire à trois
   * cellules distinctes.
   *
   * Les sous-colonnes d'une parcelle sont contiguës et de nombre constant
   * (jamais de colSpan dans le corps, cf. parcelleCell) : leur position dans la
   * ligne est donc calculable — `start` = 1 (la colonne de libellé) + index de
   * la parcelle × K. Inerte hors DOM (harnais de test sans document).
   */
  function _pag_paint(e, start, count, bg) {
    var td = e && e.currentTarget;
    var tr = td && td.parentNode;
    var kids = tr && tr.children;
    if (!kids) return;
    for (var j = 0; j < count; j += 1) {
      var c = kids[start + j];
      if (c && c.style) c.style.background = bg;
    }
  }
  function PivotAnalytiqueGrid(props) {
    var parcelles = props.parcelles || [];
    var groupedRows = props.groupedRows || [];
    var metrics = props.metrics && props.metrics.length ? props.metrics : [{
      key: 'jh'
    }];
    var color = props.color || 'var(--berry)';
    var onCellClick = typeof props.onCellClick === 'function' ? props.onCellClick : null;
    var parcelleLabel = typeof props.parcelleLabel === 'function' ? props.parcelleLabel : null;
    var firstColumnLabel = props.firstColumnLabel || 'Opération';
    var note = props.note || '';
    // Colonne Total : présente par DÉFAUT (l'écran Quinzaine en dépend). Seul
    // l'écran Campagne la retire — c'est le dernier endroit où les séries
    // restaient empilées avec leurs libellés, un pavé de texte au bout d'une
    // grille par ailleurs en sous-colonnes.
    var showTotal = props.showTotal !== false;
    // Totaux DANS le bandeau de section : opt-in, défaut inactif. Le panneau
    // Affectation Analytique de l'écran Quinzaine (EN PRODUCTION) ne le passe
    // pas et garde son bandeau `colSpan` d'origine, à l'octet près — c'est
    // tests/unit/affectationAnalytiqueTable.test.js qui le verrouille.
    var chiffresGroupe = props.chiffresGroupe === true;
    // Libellé de la ligne de pied. Défaut 'TOTAL' — l'écran Quinzaine et le
    // tableau hors récolte le gardent ; le bloc récolte, lui, dit « TOTAL
    // RÉCOLTE », parce qu'un second « TOTAL » sous le premier se lit comme le
    // total général de l'écran.
    var labelPied = props.labelPied || 'TOTAL';
    // Lignes de pied SUPPLÉMENTAIRES (des rapports, pas des totaux — cf. plus
    // bas). Défaut : aucune, donc `<tfoot>` inchangé.
    var piedsSupplementaires = props.piedsSupplementaires || [];

    // Éclatement en sous-colonnes : MÊME test que le mode empilé historique
    // (`multi` de _pag_stack). Une seule série ⇒ rendu d'avant, intégralement.
    var nbMetrics = metrics.length;
    var multi = nbMetrics > 1;
    // Nombre RÉEL de colonnes du corps, hors colonne de libellé et hors Total.
    var nbColonnesParcelles = parcelles.length * nbMetrics;
    // Largeur de la colonne Total : éclatée en sous-colonnes comme les
    // parcelles dès qu'il y a plusieurs séries, colonne unique sinon.
    var largeurTotal = showTotal ? multi ? nbMetrics : 1 : 0;
    // Largeur du bandeau de groupe : + 1 pour la colonne de libellé, + la
    // largeur RÉELLE de la colonne Total (cf. en-tête de fichier).
    var colSpanBandeau = nbColonnesParcelles + 1 + largeurTotal;

    /**
     * DENSITÉ — mode sous-colonnes uniquement.
     *
     * Éclatée en 3, une grille de 9 parcelles fait 27 colonnes : le tableau
     * défile déjà en X, et l'espacement d'origine (pensé pour des cellules
     * empilées de 2 lignes) lui imposait en plus un défilement vertical
     * permanent. Les sous-colonnes n'affichent qu'UNE ligne par cellule (le
     * libellé de série est monté en en-tête) : la hauteur d'origine n'a plus
     * de raison d'être.
     *
     * Le padding est réduit sur TOUTES les cellules d'une même ligne, colonne
     * de libellé comprise : la hauteur d'une ligne <tr> est celle de sa cellule
     * la PLUS haute — ne resserrer que les cellules de valeur ne gagnerait
     * rien. En mode une seule série (écran Quinzaine), toutes ces valeurs
     * restent celles d'avant, à l'octet près.
     */
    var padFamille = multi ? '4px 8px' : '8px 10px';
    var padFamilleLabel = multi ? '4px 12px' : '9px 14px';
    var padOperation = multi ? '3px 8px' : '6px 10px';
    var padOperationLabel = multi ? '3px 12px 3px 32px' : '6px 14px 6px 44px';
    // 12 px à gauche en dense : le bandeau de groupe reste aligné sur le
    // libellé de famille, qui suit la même réduction.
    var padGroupe = multi ? '5px 12px' : '8px 14px';
    var padPied = multi ? '5px 8px' : '8px 10px';
    var padPiedLabel = multi ? '5px 12px' : '8px 12px';
    // Interligne : sans lui, la hauteur de ligne reste celle du `line-height`
    // hérité (~1.5) et le padding réduit ne se voit qu'à moitié. La clé n'est
    // même pas POSÉE en mode une seule série — le style du <table> de l'écran
    // Quinzaine reste identique, propriété par propriété.
    var tableStyle = {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 12
    };
    if (multi) tableStyle.lineHeight = 1.25;

    /**
     * LARGEURS DÉTERMINISTES — mode sous-colonnes uniquement.
     *
     * Sans `table-layout: fixed`, le navigateur dimensionne chaque colonne
     * d'après SON contenu : deux grilles empilées qui portent les mêmes
     * parcelles (hors récolte / récolte) ne tombent alors PAS en face l'une de
     * l'autre — la seconde, dont les libellés sont plus courts, resserre sa
     * colonne de gauche et décale toutes les autres. C'est exactement ce qu'on
     * vient lire : la même parcelle, au-dessus et en dessous.
     *
     * `fixed` fait dépendre les largeurs de la PREMIÈRE ligne (l'en-tête) et
     * des largeurs déclarées, plus du contenu. Le tableau garde son
     * défilement horizontal : `minWidth` sur le <table> impose la largeur
     * totale, le conteneur défile.
     *
     * En mode une seule série (écran Quinzaine, EN PRODUCTION), rien n'est
     * posé : le rendu reste celui d'avant, propriété par propriété.
     */
    var LARGEUR_LIBELLE = 200;
    var LARGEUR_SOUS_COLONNE = 78;
    if (multi) {
      tableStyle.tableLayout = 'fixed';
      tableStyle.minWidth = LARGEUR_LIBELLE + (nbColonnesParcelles + largeurTotal) * LARGEUR_SOUS_COLONNE;
    }

    /**
     * Trait de FIN DE PARCELLE, posé sur la dernière sous-colonne de chaque
     * groupe. Repris à l'identique du séparateur qui ferme la colonne de
     * libellé sur les lignes du corps (`2px solid <couleur de culture>`) :
     * éclatée en 3, une parcelle n'est plus repérable sans lui.
     *
     * Il court sur TOUTES les lignes (les deux niveaux d'en-tête, famille,
     * opération, pied) : interrompu sur une seule, l'œil perd la colonne.
     * Entre les sous-colonnes d'une MÊME parcelle, aucun trait — elles se
     * liraient comme des colonnes indépendantes.
     */
    var traitParcelle = '2px solid ' + color;
    function borderSousColonne(i) {
      return i === nbMetrics - 1 ? traitParcelle : 'none';
    }
    var totalHa = parcelles.reduce(function (s, p) {
      return s + p[1];
    }, 0);

    /** Total (sommable) d'une série sur toute une ligne. `null` = ligne
     *  entièrement non renseignée (cf. _pag_agrege). Série ratio → couple
     *  {num, den} agrégé, jamais un pourcentage sommé. */
    function rowTotal(metric, row) {
      if (_pag_isRatio(metric)) {
        return _pag_agregeRatio(metric, parcelles.map(function (p) {
          return row.pivot[p[0]];
        }));
      }
      return _pag_agrege(metric, parcelles.map(function (p) {
        return {
          raw: _pag_raw(metric, row.pivot[p[0]]),
          ha: p[1]
        };
      }));
    }
    var familles = groupedRows.filter(function (r) {
      return r.type === 'famille';
    });

    /**
     * Familles de CHAQUE section, dans l'ordre de lecture : un bandeau ouvre une
     * section, les lignes famille qui suivent lui appartiennent jusqu'au bandeau
     * suivant (même découpage que campagneBudgetPivot.js). Les lignes opération
     * en sont exclues : elles rejouent les JH de leur famille, les compter
     * doublerait le total de la section.
     */
    var famillesParGroupe = {};
    var _sectionCourante = null;
    groupedRows.forEach(function (r) {
      if (!r) return;
      if (r.type === 'groupe') {
        _sectionCourante = famillesParGroupe[r.key] || (famillesParGroupe[r.key] = []);
        return;
      }
      if (r.type === 'famille' && _sectionCourante) _sectionCourante.push(r);
    });

    /** Total d'une série sur une colonne, pour un SOUS-ENSEMBLE de familles.
     *  Sert au pied (toutes les familles) comme au bandeau de section (les
     *  seules familles de la section) : un seul calcul, donc un bandeau qui ne
     *  peut pas diverger de la somme des lignes qu'il coiffe. */
    function colTotalDe(liste, metric, pKey, ha) {
      if (_pag_isRatio(metric)) {
        return _pag_agregeRatio(metric, liste.map(function (r) {
          return r.pivot[pKey];
        }));
      }
      return _pag_agrege(metric, liste.map(function (r) {
        return {
          raw: _pag_raw(metric, r.pivot[pKey]),
          ha: ha
        };
      }));
    }

    /** Total d'une série sur une colonne — lignes FAMILLE seules (jamais les
     *  lignes groupe ni opération : elles rejouent les mêmes JH). */
    function colTotal(metric, pKey, ha) {
      return colTotalDe(familles, metric, pKey, ha);
    }

    /** Grand total : somme des totaux de ligne DÉJÀ agrégés (donc en total),
     *  indéterminable seulement si AUCUNE ligne n'est renseignée. */
    function grandTotal(metric) {
      return grandTotalDe(familles, metric);
    }

    /** Grand total d'un SOUS-ENSEMBLE de familles (pied complet ou section). */
    function grandTotalDe(liste, metric) {
      if (_pag_isRatio(metric)) {
        // Somme des couples déjà agrégés par ligne : mêmes deux termes, une
        // seule division tout à la fin.
        var num = 0;
        var den = 0;
        var vu = false;
        liste.forEach(function (r) {
          var parts = rowTotal(metric, r);
          if (!parts) return;
          vu = true;
          num += parts.num;
          den += parts.den;
        });
        return vu && den > 0 ? {
          num: num,
          den: den
        } : null;
      }
      return _pag_agrege({
        basis: 'total'
      }, liste.map(function (r) {
        return {
          raw: rowTotal(metric, r),
          ha: 0
        };
      }));
    }

    /** Rendu d'un agrégat, quelle que soit la nature de la série. */
    function renderAgg(metric, agg, ha) {
      return _pag_isRatio(metric) ? _pag_renderRatio(metric, agg) : _pag_renderTotal(metric, agg, ha);
    }

    /**
     * Cellules de la colonne TOTAL d'une ligne (famille, opération ou pied).
     * Un seul endroit porte la bascule multi/mono, sinon elle serait écrite
     * trois fois — et une seule des trois oubliée décalerait le tableau.
     *
     * `null` sans colonne Total ; UN <td> empilé et sticky-right en mode
     * historique ; K <td> éclatés et NON sticky en sous-colonnes (cf. en-tête
     * de fichier). `rendu(metric)` renvoie la valeur déjà formatée, `null` si
     * l'agrégat est indéterminable.
     */
    function totalCells(rendu, opts) {
      if (!showTotal) return null;
      if (!multi) {
        return _pag_h('td', {
          style: opts.styleMono
        }, _pag_stack(metrics, function (m) {
          return rendu(m);
        }, undefined, opts.unitStyle));
      }
      return metrics.map(function (m, i) {
        var st = {
          padding: opts.pad,
          textAlign: 'center',
          // Le trait qui détache le Total de la dernière parcelle, posé une
          // seule fois : entre ses sous-colonnes, aucun — elles se liraient
          // comme des colonnes indépendantes (même règle que les parcelles).
          borderLeft: i === 0 ? traitParcelle : 'none'
        };
        Object.keys(opts.styleMulti).forEach(function (k) {
          st[k] = opts.styleMulti[k];
        });
        var v = rendu(m);
        return _pag_h('td', {
          key: '_total#' + i,
          style: st
        }, v === null ? _pag_dash() : v);
      });
    }

    // ── Cellule de parcelle (lignes famille et opération) ───────────────────
    //
    // Renvoie UN <td> à une seule série (rendu historique), K <td> contigus
    // sinon — un par sous-colonne. Jamais de colSpan ici : c'est ce qui garde
    // les colonnes alignées d'une ligne à l'autre et rend la position des
    // sous-cellules calculable (cf. _pag_paint).
    function parcelleCell(row, pKey, ha, opts, colIndex) {
      var cell = row.pivot[pKey];
      var valeurs = metrics.map(function (m) {
        if (!cell) return null;
        if (_pag_isRatio(m)) return _pag_renderRatio(m, _pag_parts(m, cell));
        return _pag_renderCell(m, _pag_raw(m, cell), ha);
      });
      if (!multi) {
        if (!cell) {
          return _pag_h('td', {
            key: pKey,
            style: {
              padding: opts.pad,
              textAlign: 'center',
              color: 'var(--gray-200)',
              borderRight: '1px solid #f5edf4',
              fontSize: opts.emptyFontSize
            }
          }, '—');
        }
        var style = {
          padding: opts.pad,
          textAlign: 'center',
          borderRight: '1px solid #f5edf4',
          transition: 'background 0.12s'
        };
        if (opts.fontSize) style.fontSize = opts.fontSize;
        var attrs = {
          key: pKey,
          style: style
        };
        // Détail EXPLICITEMENT vide → pas de clic. Une cellule qui n'existe que
        // parce qu'un BUDGET y est saisi (aucun pointage réalisé) porte
        // `detailRows: []` : la rendre cliquable ouvrirait une pop-up vide.
        // `detailRows` ABSENT reste cliquable : le contrat n'a jamais exigé ce
        // champ, l'appelant peut détailler autrement.
        if (onCellClick && _pag_cliquable(cell)) {
          style.cursor = 'pointer';
          attrs.title = 'Voir le détail de ' + row.label + ' sur ' + pKey;
          attrs.onClick = function () {
            onCellClick({
              parcelle: pKey,
              operationFamille: row.label,
              ha: ha,
              detailRows: cell.detailRows
            });
          };
          attrs.onMouseEnter = function (e) {
            e.currentTarget.style.background = '#fdf4f8';
          };
          attrs.onMouseLeave = function (e) {
            e.currentTarget.style.background = '';
          };
        }
        return _pag_h('td', attrs, _pag_stack(metrics, function (m, i) {
          return valeurs[i];
        }, opts.valueStyle, opts.unitStyle));
      }

      // Mode sous-colonnes.
      var actif = !!(cell && onCellClick && _pag_cliquable(cell));
      var debut = 1 + colIndex * nbMetrics; // 1 = la colonne de libellé
      return metrics.map(function (m, i) {
        var st = {
          padding: opts.pad,
          textAlign: 'center',
          borderRight: borderSousColonne(i),
          transition: 'background 0.12s'
        };
        if (opts.fontSize) st.fontSize = opts.fontSize;
        if (!cell) st.color = 'var(--gray-200)';
        var a = {
          key: pKey + '#' + i,
          style: st
        };
        if (actif) {
          // UNE SEULE zone cliquable par cellule métier : la sous-colonne de la
          // série PRIMAIRE (le réalisé). Trois <td> cliquables pour un même
          // détail tripleraient les cibles sans rien apporter.
          if (i === 0) {
            st.cursor = 'pointer';
            a.title = 'Voir le détail de ' + row.label + ' sur ' + pKey;
            a.onClick = function () {
              onCellClick({
                parcelle: pKey,
                operationFamille: row.label,
                ha: ha,
                detailRows: cell.detailRows
              });
            };
          }
          // …mais le SURVOL porte sur toute la cellule, depuis n'importe laquelle
          // de ses sous-colonnes.
          a.onMouseEnter = function (e) {
            _pag_paint(e, debut, nbMetrics, '#fdf4f8');
          };
          a.onMouseLeave = function (e) {
            _pag_paint(e, debut, nbMetrics, '');
          };
        }
        var v = valeurs[i];
        return _pag_h('td', a, _pag_h('div', {
          style: opts.valueStyle
        }, v === null ? _pag_dash() : v));
      });
    }

    // ── Lignes ─────────────────────────────────────────────────────────────
    var body = groupedRows.map(function (row) {
      // Ligne groupe (en-tête de section).
      if (row.type === 'groupe') {
        var primaire = metrics[0];
        var totalGroupe = rowTotal(primaire, row);
        // Total indéterminable → aucune mention, jamais un « NaN JH total ».
        var resume = totalGroupe !== null && typeof primaire.summary === 'function' ? primaire.summary(totalGroupe) : null;
        // Libellé de section — commun aux deux rendus. En bandeau CHIFFRÉ il ne
        // porte plus le colSpan : il n'occupe que la colonne de libellé, comme
        // sur une ligne famille, sinon les colonnes se décalent.
        var libelleGroupe = _pag_h('td', {
          // ⚠️ Le SEUL endroit qui dépend du nombre de colonnes : oublier le
          // × nbMetrics — ou la largeur de la colonne Total quand elle existe
          // — décale tout le tableau, silencieusement.
          colSpan: chiffresGroupe ? undefined : colSpanBandeau,
          style: {
            padding: padGroupe,
            fontWeight: 700,
            fontSize: 12,
            background: color,
            color: 'white',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            position: 'sticky',
            left: 0
          }
        }, row.label, resume === null ? null : _pag_h('span', {
          style: {
            fontWeight: 400,
            fontSize: 10,
            opacity: 0.75,
            marginLeft: 8
          }
        }, resume));
        if (!chiffresGroupe) return _pag_h('tr', {
          key: row.key
        }, libelleGroupe);

        // ── Bandeau CHIFFRÉ : la section devient un pied de tableau local ────
        // Les totaux sont agrégés depuis les lignes FAMILLE de la section, pas
        // lus dans `row.pivot` : (a) le chiffre affiché est ainsi, par
        // construction, la somme des lignes visibles dessous ; (b) le pivot du
        // groupe ne porte NI budget (buildBudgetPivot ne budgète que les
        // familles) NI `pctIdeal` (decoreIdeal saute les lignes groupe) — le
        // lire afficherait « — » sur trois séries sur quatre.
        var famillesSection = famillesParGroupe[row.key] || [];
        var styleValeurGroupe = {
          color: 'white',
          fontWeight: 700
        };
        var styleUniteGroupe = {
          fontSize: 10,
          color: 'white',
          opacity: 0.7
        };
        return _pag_h('tr', {
          key: row.key,
          style: {
            background: color
          }
        }, libelleGroupe, parcelles.map(function (p) {
          var valeurs = metrics.map(function (m) {
            return renderAgg(m, colTotalDe(famillesSection, m, p[0], p[1]), p[1]);
          });
          if (!multi) {
            return _pag_h('td', {
              key: p[0],
              style: {
                padding: padGroupe,
                textAlign: 'center',
                background: color,
                color: 'white',
                borderRight: '1px solid ' + color
              }
            }, _pag_stack(metrics, function (m, i) {
              return valeurs[i];
            }, styleValeurGroupe, styleUniteGroupe));
          }
          return metrics.map(function (m, i) {
            return _pag_h('td', {
              key: p[0] + '#' + i,
              style: {
                padding: padGroupe,
                textAlign: 'center',
                background: color,
                color: 'white',
                fontWeight: 700,
                borderRight: i === nbMetrics - 1 ? '2px solid #fff' : 'none'
              }
            }, valeurs[i] === null ? _pag_dash() : valeurs[i]);
          });
        }), totalCells(function (m) {
          return renderAgg(m, grandTotalDe(famillesSection, m), totalHa);
        }, {
          pad: padGroupe,
          styleMono: {
            padding: padGroupe,
            textAlign: 'center',
            background: color,
            color: 'white',
            fontWeight: 700,
            position: 'sticky',
            right: 0
          },
          styleMulti: {
            background: color,
            color: 'white',
            fontWeight: 700
          },
          unitStyle: styleUniteGroupe
        }));
      }

      // Ligne opération (mode Détail) : détail d'une famille, insérée juste
      // sous elle. Ces lignes ne sont JAMAIS de type 'famille', sinon le pied
      // de tableau doublerait les totaux.
      if (row.type === 'operation') {
        return _pag_h('tr', {
          key: row.key,
          style: {
            background: '#fcfafc',
            borderBottom: '1px solid #f7f0f6'
          }
        }, _pag_h('td', {
          style: {
            padding: padOperationLabel,
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--gray-600)',
            position: 'sticky',
            left: 0,
            background: '#fcfafc',
            borderRight: '2px solid ' + color,
            zIndex: 1,
            borderLeft: '3px solid ' + color + '55'
          }
        }, _pag_h('span', {
          style: {
            color: 'var(--gray-400)',
            marginRight: 6
          }
        }, '↳'), row.label), parcelles.map(function (p, i) {
          return parcelleCell(row, p[0], p[1], {
            pad: padOperation,
            fontSize: 11,
            emptyFontSize: 12,
            valueStyle: {
              fontWeight: 500,
              color: 'var(--gray-600)'
            },
            unitStyle: {
              fontSize: 9,
              color: 'var(--gray-400)'
            }
          }, i);
        }), totalCells(function (m) {
          return renderAgg(m, rowTotal(m, row), totalHa);
        }, {
          pad: padOperation,
          styleMono: {
            padding: padOperation,
            textAlign: 'center',
            fontWeight: 600,
            color: 'var(--gray-600)',
            background: '#fcfafc',
            position: 'sticky',
            right: 0,
            borderLeft: '1px solid #f0e6ef',
            fontSize: 11
          },
          styleMulti: {
            fontWeight: 600,
            color: 'var(--gray-600)',
            background: '#fcfafc',
            fontSize: 11
          },
          unitStyle: {
            fontSize: 9,
            color: 'var(--gray-400)',
            fontWeight: 400
          }
        }));
      }

      // Ligne famille.
      return _pag_h('tr', {
        key: row.key,
        style: {
          background: '#fff',
          borderBottom: '1px solid #f0e6ef'
        }
      }, _pag_h('td', {
        style: {
          padding: padFamilleLabel,
          fontWeight: 600,
          color: color,
          position: 'sticky',
          left: 0,
          background: '#fff',
          borderRight: '2px solid ' + color,
          zIndex: 1,
          borderLeft: '3px solid ' + color
        }
      }, row.label, _pag_h('span', {
        style: {
          fontSize: 10,
          fontWeight: 400,
          color: 'var(--gray-400)',
          marginLeft: 6
        }
      }, row.key)), parcelles.map(function (p, i) {
        return parcelleCell(row, p[0], p[1], {
          pad: padFamille,
          emptyFontSize: 13,
          valueStyle: {
            fontWeight: 700,
            color: 'var(--gray-700)'
          },
          unitStyle: {
            fontSize: 10,
            color: 'var(--gray-400)'
          }
        }, i);
      }), totalCells(function (m) {
        return renderAgg(m, rowTotal(m, row), totalHa);
      }, {
        pad: padFamille,
        styleMono: {
          padding: padFamille,
          textAlign: 'center',
          fontWeight: 700,
          color: color,
          background: '#fdf4f8',
          position: 'sticky',
          right: 0,
          borderLeft: '1px solid #f0e6ef'
        },
        styleMulti: {
          fontWeight: 700,
          color: color,
          background: '#fdf4f8'
        },
        unitStyle: {
          fontSize: 10,
          color: 'var(--gray-400)',
          fontWeight: 400
        }
      }));
    });
    return _pag_h('div', {
      style: {
        marginBottom: 20,
        background: '#fff',
        borderRadius: 12,
        border: '1px solid var(--gray-200)',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
      }
    },
    // Bandeau de titre.
    _pag_h('div', {
      style: {
        padding: '10px 16px',
        background: 'linear-gradient(135deg,' + color + '15,' + color + '08)',
        borderBottom: '2px solid ' + color + '30',
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }
    }, _pag_h('i', {
      className: 'fa-solid ' + (props.icon || ''),
      style: {
        color: color,
        fontSize: 14
      }
    }), _pag_h('span', {
      style: {
        fontSize: 13,
        fontWeight: 700,
        color: color
      }
    }, props.title), _pag_h('span', {
      style: {
        fontSize: 11,
        color: 'var(--gray-500)',
        fontWeight: 400
      }
    }, parcelles.length, ' parcelle', parcelles.length > 1 ? 's' : '', totalHa > 0 ? ' · ' + totalHa.toFixed(2) + ' Ha total' : '')), _pag_h('div', {
      style: {
        overflowX: 'auto'
      }
    }, _pag_h('table', {
      style: tableStyle
    },
    // En-tête à DEUX niveaux dès qu'il y a plusieurs séries : parcelle
    // (colSpan) puis une sous-colonne par série. Le Total suit la même
    // découpe ; seule la colonne de libellé reste unique (rowSpan).
    _pag_h('thead', null, _pag_h('tr', {
      key: 'h1',
      style: {
        background: 'var(--gray-50)'
      }
    }, _pag_h('th', {
      rowSpan: multi ? 2 : undefined,
      style: {
        padding: '8px 12px',
        textAlign: 'left',
        fontWeight: 600,
        color: 'var(--gray-600)',
        position: 'sticky',
        left: 0,
        background: 'var(--gray-50)',
        // En sous-colonnes, une largeur FIXE (et non un minimum) :
        // c'est elle qui aligne deux grilles empilées, cf. tableStyle.
        minWidth: multi ? LARGEUR_LIBELLE : 160,
        width: multi ? LARGEUR_LIBELLE : undefined,
        borderRight: '1px solid var(--gray-200)',
        zIndex: 1
      }
    }, firstColumnLabel), parcelles.map(function (p) {
      return _pag_h('th', {
        key: p[0],
        colSpan: multi ? nbMetrics : undefined,
        style: {
          padding: '6px 10px',
          textAlign: 'center',
          fontWeight: 600,
          color: 'var(--gray-600)',
          // Une parcelle éclatée n'a pas besoin de 110 px : ce sont
          // ses sous-colonnes qui portent la largeur.
          minWidth: multi ? undefined : 110,
          width: multi ? nbMetrics * LARGEUR_SOUS_COLONNE : undefined,
          borderRight: multi ? traitParcelle : '1px solid var(--gray-100)'
        }
      }, _pag_h('div', {
        style: {
          color: color,
          fontWeight: 700
        }
      }, (parcelleLabel ? parcelleLabel(p[0]) : p[0]) || p[0]), _pag_h('div', {
        style: {
          fontSize: 10,
          color: 'var(--gray-400)',
          fontWeight: 400
        }
      }, p[1] > 0 ? p[1] + ' Ha' : 'Ha ?'));
    }),
    // En sous-colonnes, l'en-tête du Total prend la MÊME forme que
    // celui d'une parcelle : un titre, la surface dessous, et un
    // colSpan sur ses sous-colonnes. Pas de sticky (cf. en-tête de
    // fichier) — il défile avec le tableau.
    showTotal ? multi ? _pag_h('th', {
      title: note || undefined,
      colSpan: nbMetrics,
      style: {
        padding: '6px 10px',
        textAlign: 'center',
        fontWeight: 700,
        color: 'var(--gray-700)',
        background: 'var(--gray-100)',
        borderLeft: traitParcelle
      }
    }, _pag_h('div', {
      style: {
        fontWeight: 700
      }
    }, 'TOTAL'), _pag_h('div', {
      style: {
        fontSize: 10,
        color: 'var(--gray-400)',
        fontWeight: 400
      }
    }, totalHa > 0 ? Math.round(totalHa * 100) / 100 + ' Ha' : 'Ha ?')) : _pag_h('th', {
      title: note || undefined,
      style: {
        padding: '6px 10px',
        textAlign: 'center',
        fontWeight: 700,
        color: 'var(--gray-700)',
        minWidth: 100,
        background: 'var(--gray-100)',
        position: 'sticky',
        right: 0,
        zIndex: 1
      }
    }, 'Total') : null), multi ? _pag_h('tr', {
      key: 'h2',
      style: {
        background: 'var(--gray-50)'
      }
    }, parcelles.map(function (p) {
      return metrics.map(function (m, i) {
        return _pag_h('th', {
          key: p[0] + '#' + i,
          style: {
            padding: '4px 6px',
            textAlign: 'center',
            fontWeight: 600,
            fontSize: 10,
            color: 'var(--gray-500)',
            // 27 sous-colonnes (9 parcelles × 3) ne tiennent pas à
            // 110 px chacune : le conteneur défile déjà en X, mais
            // 3 000 px de large ne se lisent pas non plus. Largeur
            // FIXE : c'est elle qui aligne deux grilles empilées.
            width: LARGEUR_SOUS_COLONNE,
            whiteSpace: 'nowrap',
            borderRight: borderSousColonne(i)
          }
        }, _pag_h('div', null, m.label || ''), m.unit ? _pag_h('div', {
          style: {
            fontSize: 9,
            color: 'var(--gray-400)',
            fontWeight: 400
          }
        }, m.unit) : null);
      });
    }),
    // Sous-colonnes du Total : mêmes en-têtes que sous une parcelle,
    // pour que l'œil les aligne série par série.
    showTotal ? metrics.map(function (m, i) {
      return _pag_h('th', {
        key: '_total#' + i,
        style: {
          padding: '4px 6px',
          textAlign: 'center',
          fontWeight: 600,
          fontSize: 10,
          color: 'var(--gray-500)',
          width: LARGEUR_SOUS_COLONNE,
          whiteSpace: 'nowrap',
          borderLeft: i === 0 ? traitParcelle : 'none',
          borderRight: borderSousColonne(i)
        }
      }, _pag_h('div', null, m.label || ''), m.unit ? _pag_h('div', {
        style: {
          fontSize: 9,
          color: 'var(--gray-400)',
          fontWeight: 400
        }
      }, m.unit) : null);
    }) : null) : null), _pag_h('tbody', null, body), _pag_h('tfoot', null, _pag_h('tr', {
      style: {
        background: color + '18',
        fontWeight: 700
      }
    }, _pag_h('td', {
      style: {
        padding: padPiedLabel,
        position: 'sticky',
        left: 0,
        background: color + '18',
        borderRight: '1px solid var(--gray-200)',
        zIndex: 1,
        color: color
      }
    }, labelPied), parcelles.map(function (p) {
      var totaux = metrics.map(function (m) {
        return renderAgg(m, colTotal(m, p[0], p[1]), p[1]);
      });
      if (!multi) {
        return _pag_h('td', {
          key: p[0],
          style: {
            padding: '8px 10px',
            textAlign: 'center',
            borderRight: '1px solid var(--gray-100)',
            color: color
          }
        }, _pag_stack(metrics, function (m, i) {
          return totaux[i];
        }, undefined, {
          fontSize: 10,
          opacity: 0.7
        }));
      }
      return metrics.map(function (m, i) {
        return _pag_h('td', {
          key: p[0] + '#' + i,
          style: {
            padding: padPied,
            textAlign: 'center',
            color: color,
            borderRight: borderSousColonne(i)
          }
        }, totaux[i] === null ? _pag_dash() : totaux[i]);
      });
    }), totalCells(function (m) {
      return renderAgg(m, grandTotal(m), totalHa);
    }, {
      pad: padPied,
      styleMono: {
        padding: '8px 10px',
        textAlign: 'center',
        background: color + '28',
        position: 'sticky',
        right: 0,
        color: color
      },
      styleMulti: {
        background: color + '28',
        color: color
      },
      unitStyle: {
        fontSize: 10,
        opacity: 0.7
      }
    })),
    // ── LIGNES DE PIED SUPPLÉMENTAIRES ──────────────────────────────
    // Un RAPPORT, pas un total : « Kg / JH » n'est pas la somme d'une
    // colonne, c'est un rendement qui relie deux grandeurs de nature
    // différente. Il ne peut donc pas être une série (la grille les
    // agrège), ni une ligne famille (elle serait comptée dans le
    // total). Les valeurs arrivent DÉJÀ FORMATÉES : la grille ne sait
    // pas ce qu'est un kilo, et n'a pas à l'apprendre.
    piedsSupplementaires.map(function (ligne) {
      var valeursDe = function (cle) {
        var v = (ligne.valeurs || {})[cle];
        return Array.isArray(v) ? v : [];
      };
      return _pag_h('tr', {
        key: '_pied#' + ligne.key,
        style: {
          background: color + '0d',
          fontWeight: 600
        }
      }, _pag_h('td', {
        title: ligne.aide || undefined,
        style: {
          padding: padPiedLabel,
          position: 'sticky',
          left: 0,
          background: color + '0d',
          borderRight: '1px solid var(--gray-200)',
          zIndex: 1,
          color: color,
          fontSize: 11
        }
      }, ligne.label), parcelles.map(function (p) {
        var vals = valeursDe(p[0]);
        if (!multi) {
          return _pag_h('td', {
            key: p[0],
            style: {
              padding: padPied,
              textAlign: 'center',
              color: color,
              borderRight: '1px solid var(--gray-100)'
            }
          }, vals[0] === undefined || vals[0] === null ? _pag_dash() : vals[0]);
        }
        return metrics.map(function (m, i) {
          var v = vals[i];
          return _pag_h('td', {
            key: p[0] + '#' + i,
            style: {
              padding: padPied,
              textAlign: 'center',
              color: color,
              fontSize: 11,
              borderRight: borderSousColonne(i)
            }
          }, v === undefined || v === null ? _pag_dash() : v);
        });
      }), showTotal ? multi ? metrics.map(function (m, i) {
        var v = (ligne.total || [])[i];
        return _pag_h('td', {
          key: '_total#' + i,
          style: {
            padding: padPied,
            textAlign: 'center',
            color: color,
            fontSize: 11,
            background: color + '1a',
            fontWeight: 700,
            borderLeft: i === 0 ? traitParcelle : 'none'
          }
        }, v === undefined || v === null ? _pag_dash() : v);
      }) : _pag_h('td', {
        style: {
          padding: padPied,
          textAlign: 'center',
          color: color,
          background: color + '1a',
          position: 'sticky',
          right: 0
        }
      }, (ligne.total || [])[0] || _pag_dash()) : null);
    })))),
    // Légende : le périmètre des séries n'est PAS déductible des chiffres
    // affichés (81 réalisé − 15 budget ≠ −3 d'écart quand une partie des
    // lignes n'est pas budgétée). Sans mention visible, le lecteur conclut à
    // une erreur de calcul.
    note ? _pag_h('div', {
      style: {
        padding: '6px 14px 10px',
        fontSize: 10,
        color: 'var(--gray-500)',
        borderTop: '1px solid var(--gray-100)'
      }
    }, _pag_h('i', {
      className: 'fa-solid fa-circle-info',
      style: {
        marginRight: 6
      }
    }), note) : null);
  }
  window.PivotAnalytiqueGrid = PivotAnalytiqueGrid;
})();
