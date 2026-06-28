'use strict';
// @ts-check

/**
 * consoValorisation.js — Logique PURE pour l'état CONSOMMATION valorisée au PMP.
 *
 * AUCUN accès Firestore : toutes les fonctions reçoivent leurs données en
 * argument. Produit l'agrégation par PARCELLE / Ha / famille (engrais vs
 * pesticide vs autre), VALORISÉE au PMP (articles_catalog.prix_pmp), depuis
 * le 01/07/2025.
 *
 * PÉRIMÈTRE & HONNÊTETÉ :
 *  - On valorise la consommation SAISIE uniquement (plancher). Les sorties
 *    magasin non rapprochées (ex. F2) ne sont PAS dans sql_mirror_consommation.
 *    Le coût/Ha calculé ici est donc un MINORANT.
 *  - Source de prix = articles_catalog.prix_pmp (PMP grand livre). PAS le canevas.
 *  - Un prix_pmp <= 1 est traité comme PLACEHOLDER (ex. HUMOCAL) : article non
 *    valorisé, compté en quantité seule (jamais valorisé à un prix fictif).
 *  - Unités : Tonne → KG (×1000). Familles KG / L gardées distinctes (aucune
 *    densité fabriquée).
 *
 * La table de synonymes SQL(conso) ↔ catalogue (PMP) est volontairement
 * extensible : à compléter au fil des divergences de nommage constatées.
 */

/**
 * Canonicalisation d'un nom d'article — IDENTIQUE à functions/lib/stock/pmpDetail.js
 * (MAJUSCULE, espaces normalisés, suffixe d'unité retiré).
 * @param {*} a
 * @returns {string}
 */
function canon(a) {
  let s = (a == null ? '' : String(a)).toUpperCase().trim();
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s*\((L|KG|G|ML|UNITE|U)\)\s*$/, '');
  return s.trim();
}

/**
 * Table de synonymes : nom CONSO (SQL mirror) → nom CATALOGUE (porteur du PMP).
 * Clés et valeurs sont matchées via canon(). À COMPLÉTER au fil des divergences.
 * @type {Record<string,string>}
 */
const SYNONYMES = {
  'KSC I': 'KSC 1',
  'KSC II': 'KSC 2',
  'KSC III': 'KSC 3',
  'KSC V': 'KSC 5',
  'VERTIMEC': 'VERTIMIC',
  'Nitrate de Potasse': 'NITRETE DE POTASSE',
  'Acide Sulfirique': 'ACIDE SULFRIQUE',
  'Ecovigor AA': 'ECOVIGOR',
  'MEGAFOL EN 10L': 'MEGAFOL',
  'DEPTIL': 'DEPTIL PA5',
  'AZO PRO': 'AZO PRO 31',
  'Rhizo Bore': 'RHIZO BOR',
  'MAP (GK)': 'MAP',
};

// Index canon(synonyme conso) → canon(nom catalogue) pour lookup O(1).
const SYNONYMES_CANON = {};
for (const k of Object.keys(SYNONYMES)) {
  SYNONYMES_CANON[canon(k)] = canon(SYNONYMES[k]);
}

/**
 * Normalise une unité brute vers une forme canonique comparable.
 * Tonne → KG (la conversion quantitative est gérée séparément).
 * @param {*} u
 * @returns {string} unité en MAJUSCULE, '' si absente
 */
function canonUnite(u) {
  let s = (u == null ? '' : String(u)).toUpperCase().trim();
  if (s === '') return '';
  if (s === 'T' || s === 'TONNE' || s === 'TONNES' || s === 'TN') return 'KG';
  if (s === 'KGS' || s === 'KILO' || s === 'KILOS' || s === 'KILOGRAMME') return 'KG';
  if (s === 'LITRE' || s === 'LITRES' || s === 'LT' || s === 'LTR') return 'L';
  if (s === 'U' || s === 'UNITE' || s === 'UNITÉ' || s === 'UN' || s === 'PCE' || s === 'PIECE') return 'UNITE';
  return s;
}

/**
 * Indique si l'unité brute est une tonne (qté ×1000 pour normaliser en KG).
 * @param {*} u
 * @returns {boolean}
 */
function isTonne(u) {
  const s = (u == null ? '' : String(u)).toUpperCase().trim();
  return s === 'T' || s === 'TONNE' || s === 'TONNES' || s === 'TN';
}

/**
 * Résout le PMP d'un article de conso depuis une map de prix par canon.
 *
 * Étapes : synonyme conso→catalogue (si présent) puis canon, lookup dans pmpMap.
 * GARDE-FOU placeholder : si pmp <= 1 → {pmp:0, source:'placeholder', matched:false}.
 *
 * @param {*} articleNom - nom de l'article tel que présent dans la conso
 * @param {Record<string,{pmp:number, source:string}>} pmpMap - clé = canon(nom catalogue)
 * @returns {{pmp:number, source:string, matched:boolean}}
 */
function resolvePmp(articleNom, pmpMap) {
  const map = pmpMap || {};
  const c0 = canon(articleNom);
  const key = SYNONYMES_CANON[c0] || c0;
  const entry = map[key];
  if (!entry) {
    return { pmp: 0, source: 'absent', matched: false };
  }
  const pmp = parseFloat(entry.pmp);
  if (!isFinite(pmp) || pmp <= 1) {
    // <=1 = prix placeholder (ex. HUMOCAL) : ne PAS valoriser à un prix fictif.
    return { pmp: 0, source: 'placeholder', matched: false };
  }
  return { pmp, source: entry.source || 'pmp', matched: true };
}

/**
 * Classe une catégorie de conso en bucket de famille.
 * @param {*} cat - Article_Categorie brut
 * @returns {('engrais'|'pesticide'|'autre')}
 */
function familleBucket(cat) {
  const s = (cat == null ? '' : String(cat)).toLowerCase();
  if (s.indexOf('engrais') !== -1) return 'engrais';
  if (s.indexOf('pesticide') !== -1 || s.indexOf('phyto') !== -1) return 'pesticide';
  return 'autre';
}

/**
 * Quantité normalisée en KG si l'unité d'origine est une tonne.
 * @param {number} qte
 * @param {*} unite
 * @returns {number}
 */
function normalizeQte(qte, unite) {
  let q = parseFloat(qte);
  if (!isFinite(q)) q = 0;
  if (isTonne(unite)) q = q * 1000;
  return q;
}

/**
 * Arrondi à 2 décimales (helper interne).
 * @param {number} n
 * @returns {number}
 */
function r2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * @typedef {Object} LigneArticle
 * @property {string} article
 * @property {number} quantite       quantité normalisée (KG si tonne)
 * @property {string} unite          unité canonique (KG / L / UNITE / …)
 * @property {string} famille        engrais | pesticide | autre
 * @property {number} pmp            PMP appliqué (0 si non valorisé)
 * @property {string} source_prix    pmp | absent | placeholder
 * @property {number} cout_ligne     quantite × pmp
 * @property {boolean} valorise
 */

/**
 * Agrège la consommation valorisée au PMP par parcelle, ferme, culture + total.
 *
 * @param {Array<Object>} consoRows - lignes brutes sql_mirror_consommation
 * @param {Record<string,{pmp:number, source:string}>} pmpMap - canon(nom)→{pmp,source}
 * @returns {{
 *   parcelles: Array<Object>,
 *   par_ferme: Array<Object>,
 *   par_culture: Array<Object>,
 *   total: Object,
 *   couverture: Object
 * }}
 */
function aggregateConsoValorisee(consoRows, pmpMap) {
  const rows = Array.isArray(consoRows) ? consoRows : [];

  // parcMap[parcelle] = { ...meta, articles: Map(famille|article → ligne), sup }
  const parcMap = {};

  // Couverture (au niveau articles distincts ET quantité).
  const distinctArticles = {}; // canon → { valorise, qte }

  for (const row of rows) {
    const parcelle = row.Parcelle_Culturale || row.Parcelle_Physique || '(sans parcelle)';
    const famille = familleBucket(row.Article_Categorie);
    const article = row.Article || '(article inconnu)';
    const unite = canonUnite(row.Article_unite);
    const qte = normalizeQte(row.Quantite, row.Article_unite);
    const sup = parseFloat(row.Parcelle_sup);
    const { pmp, source, matched } = resolvePmp(article, pmpMap);

    if (!parcMap[parcelle]) {
      parcMap[parcelle] = {
        parcelle,
        ferme: row.Ferme || '',
        culture: row.Culture || '',
        sup_ha: isFinite(sup) && sup > 0 ? sup : null,
        _cultureCounts: {},
        _lignes: {}, // key famille|canon(article)|unite → LigneArticle
      };
    }
    const p = parcMap[parcelle];
    if (isFinite(sup) && sup > 0 && (p.sup_ha == null || sup > p.sup_ha)) p.sup_ha = sup;
    if (row.Culture) p._cultureCounts[row.Culture] = (p._cultureCounts[row.Culture] || 0) + 1;

    const lkey = famille + '|' + canon(article) + '|' + unite;
    if (!p._lignes[lkey]) {
      p._lignes[lkey] = {
        article,
        quantite: 0,
        unite,
        famille,
        pmp,
        source_prix: source,
        cout_ligne: 0,
        valorise: matched,
      };
    }
    const ln = p._lignes[lkey];
    ln.quantite += qte;
    ln.cout_ligne += qte * pmp;
    // Garde le pmp/source si une occurrence est valorisée.
    if (matched && !ln.valorise) {
      ln.valorise = true;
      ln.pmp = pmp;
      ln.source_prix = source;
    }

    // Couverture par article distinct (canon, toutes parcelles confondues).
    const ac = canon(article);
    if (!distinctArticles[ac]) distinctArticles[ac] = { valorise: matched, qte: 0 };
    if (matched) distinctArticles[ac].valorise = true;
    distinctArticles[ac].qte += qte;
  }

  // Finalisation par parcelle.
  const parcelles = [];
  let gTotEng = 0, gTotPest = 0, gTotAutre = 0, gTotMad = 0;
  let gQteTotale = 0, gQteValorisee = 0;

  for (const key of Object.keys(parcMap)) {
    const p = parcMap[key];
    // Culture dominante.
    let maxC = p.culture, maxN = -1;
    for (const c of Object.keys(p._cultureCounts)) {
      if (p._cultureCounts[c] > maxN) { maxN = p._cultureCounts[c]; maxC = c; }
    }
    p.culture = maxC || p.culture;

    const engrais = [];
    const pesticides = [];
    const autres = [];
    const articles_non_valorises = [];
    let totEng = 0, totPest = 0, totAutre = 0;
    let engKg = 0, pestL = 0, pestKg = 0;

    for (const lk of Object.keys(p._lignes)) {
      const ln = p._lignes[lk];
      ln.quantite = r2(ln.quantite);
      ln.cout_ligne = r2(ln.cout_ligne);
      ln.pmp = r2(ln.pmp);
      if (ln.famille === 'engrais') {
        engrais.push(ln);
        totEng += ln.cout_ligne;
        if (ln.unite === 'KG') engKg += ln.quantite;
      } else if (ln.famille === 'pesticide') {
        pesticides.push(ln);
        totPest += ln.cout_ligne;
        if (ln.unite === 'L') pestL += ln.quantite;
        else if (ln.unite === 'KG') pestKg += ln.quantite;
      } else {
        autres.push(ln);
        totAutre += ln.cout_ligne;
      }
      if (!ln.valorise) {
        articles_non_valorises.push({
          article: ln.article, quantite: ln.quantite, unite: ln.unite,
          famille: ln.famille, source_prix: ln.source_prix,
        });
      }
    }

    const sortByCout = (a, b) => b.cout_ligne - a.cout_ligne;
    engrais.sort(sortByCout);
    pesticides.sort(sortByCout);
    autres.sort(sortByCout);

    const total_mad = totEng + totPest + totAutre;
    const sup = p.sup_ha;
    const hasSup = sup != null && sup > 0;

    const out = {
      parcelle: p.parcelle,
      ferme: p.ferme,
      culture: p.culture,
      sup_ha: hasSup ? r2(sup) : null,
      engrais,
      pesticides,
      autres,
      total_engrais_mad: r2(totEng),
      total_pest_mad: r2(totPest),
      total_autre_mad: r2(totAutre),
      total_mad: r2(total_mad),
      cout_ha_engrais: hasSup ? r2(totEng / sup) : null,
      cout_ha_pest: hasSup ? r2(totPest / sup) : null,
      cout_ha_total: hasSup ? r2(total_mad / sup) : null,
      eng_kg_ha: hasSup ? r2(engKg / sup) : null,
      pest_l_ha: hasSup ? r2(pestL / sup) : null,
      pest_kg_ha: hasSup ? r2(pestKg / sup) : null,
      articles_non_valorises,
    };
    parcelles.push(out);

    gTotEng += totEng; gTotPest += totPest; gTotAutre += totAutre; gTotMad += total_mad;
  }

  parcelles.sort((a, b) => b.total_mad - a.total_mad);

  // Agrégats par ferme.
  const fermeMap = {};
  for (const p of parcelles) {
    const f = p.ferme || '(sans ferme)';
    if (!fermeMap[f]) fermeMap[f] = { ferme: f, sup_ha: 0, total_engrais_mad: 0, total_pest_mad: 0, total_autre_mad: 0, total_mad: 0 };
    const m = fermeMap[f];
    if (p.sup_ha) m.sup_ha += p.sup_ha;
    m.total_engrais_mad += p.total_engrais_mad;
    m.total_pest_mad += p.total_pest_mad;
    m.total_autre_mad += p.total_autre_mad;
    m.total_mad += p.total_mad;
  }
  const par_ferme = Object.values(fermeMap).map((m) => {
    const has = m.sup_ha > 0;
    return {
      ferme: m.ferme,
      sup_ha: r2(m.sup_ha),
      total_engrais_mad: r2(m.total_engrais_mad),
      total_pest_mad: r2(m.total_pest_mad),
      total_autre_mad: r2(m.total_autre_mad),
      total_mad: r2(m.total_mad),
      cout_ha_total: has ? r2(m.total_mad / m.sup_ha) : null,
    };
  }).sort((a, b) => b.total_mad - a.total_mad);

  // Agrégats par culture.
  const cultMap = {};
  for (const p of parcelles) {
    const c = p.culture || '(sans culture)';
    if (!cultMap[c]) cultMap[c] = { culture: c, sup_ha: 0, total_engrais_mad: 0, total_pest_mad: 0, total_autre_mad: 0, total_mad: 0 };
    const m = cultMap[c];
    if (p.sup_ha) m.sup_ha += p.sup_ha;
    m.total_engrais_mad += p.total_engrais_mad;
    m.total_pest_mad += p.total_pest_mad;
    m.total_autre_mad += p.total_autre_mad;
    m.total_mad += p.total_mad;
  }
  const par_culture = Object.values(cultMap).map((m) => {
    const has = m.sup_ha > 0;
    return {
      culture: m.culture,
      sup_ha: r2(m.sup_ha),
      total_engrais_mad: r2(m.total_engrais_mad),
      total_pest_mad: r2(m.total_pest_mad),
      total_autre_mad: r2(m.total_autre_mad),
      total_mad: r2(m.total_mad),
      cout_ha_total: has ? r2(m.total_mad / m.sup_ha) : null,
    };
  }).sort((a, b) => b.total_mad - a.total_mad);

  // Couverture.
  const acKeys = Object.keys(distinctArticles);
  let nbValorises = 0;
  for (const k of acKeys) {
    const d = distinctArticles[k];
    gQteTotale += d.qte;
    if (d.valorise) { nbValorises += 1; gQteValorisee += d.qte; }
  }
  const couverture = {
    nb_articles_total: acKeys.length,
    nb_valorises: nbValorises,
    pct_articles: acKeys.length > 0 ? r2((nbValorises / acKeys.length) * 100) : 0,
    qte_totale: r2(gQteTotale),
    qte_valorisee: r2(gQteValorisee),
    pct_quantite: gQteTotale > 0 ? r2((gQteValorisee / gQteTotale) * 100) : 0,
  };

  const total = {
    total_engrais_mad: r2(gTotEng),
    total_pest_mad: r2(gTotPest),
    total_autre_mad: r2(gTotAutre),
    total_mad: r2(gTotMad),
    nb_parcelles: parcelles.length,
  };

  return { parcelles, par_ferme, par_culture, total, couverture };
}

module.exports = {
  canon,
  canonUnite,
  isTonne,
  normalizeQte,
  familleBucket,
  resolvePmp,
  aggregateConsoValorisee,
  SYNONYMES,
};
