'use strict';
/**
 * classification-articles-report.js — Rapport de CLASSIFICATION des articles
 * consommés (ticket sb/conso-categorie-article, partie D du plan).
 *
 * STRICTEMENT LECTURE SEULE. Aucune méthode d'écriture Firestore
 * (set/update/delete/add/batch) n'est appelée nulle part dans ce fichier.
 * Corriger une fiche `articles_catalog` est une décision d'Omar (point GATED) :
 * ce script produit le document qu'il annote pour trancher, rien de plus.
 *
 * ── Ce qu'il répond ─────────────────────────────────────────────────────────
 *  1. Quels articles consommés ne tombent NI en engrais NI en pesticide ?
 *     Ce sont les lignes qui n'apparaissent dans aucun des deux onglets de
 *     l'écran Campagne. Trois causes, distinguées car les corrections diffèrent :
 *       - `catégorie catalogue hors familles` (ex. « autre ») → corriger la fiche ;
 *       - `absent du catalogue`               → créer la fiche ;
 *       - `clé ambiguë`                       → deux fiches, deux familles :
 *          le rapprochement refuse de trancher (fail-closed), il faut arbitrer.
 *  2. Quelles clés du catalogue sont ambiguës, consommées ou non — noms
 *     identiques (doublon franc) ET clés alphanumériques.
 *  3. La répartition d'ensemble engrais / pesticides / à classer.
 *
 * Rejouable après chaque correction, pour vérifier que la liste se vide.
 *
 * Toute l'arithmétique vit dans le module PUR `functions/lib/consoBons` (testé
 * unitairement) : ce script ne fait que lire, appeler, et mettre en forme.
 *
 * Usage :
 *   node scripts/classification-articles-report.js
 *   node scripts/classification-articles-report.js --campagne 2026-2027
 *   node scripts/classification-articles-report.js --depuis 2026-07-01
 *   node scripts/classification-articles-report.js --json
 */

// En local, l'ADC gcloud peut pointer vers un autre projet (ex: bgf-sentinel).
// Ce script cible toujours le projet Smart Berry, sauf override explicite.
if (!process.env.GCLOUD_PROJECT && !process.env.GOOGLE_CLOUD_PROJECT) {
  process.env.GCLOUD_PROJECT = 'berrygood-farms-dashboard';
}

const {
  adaptBonsToConsoRows,
  buildArticleCategoryIndex,
  lookupArticleCategorie,
  articlesAClasser,
} = require('../functions/lib/consoBons');
const { familleBucket } = require('../functions/lib/valorisation/consoValorisation');

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { json: false, campagne: '', depuis: '', jusquA: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--campagne') { out.campagne = String(argv[i + 1] || ''); i += 1; }
    else if (a === '--depuis') { out.depuis = String(argv[i + 1] || ''); i += 1; }
    else if (a === '--jusqu-a') { out.jusquA = String(argv[i + 1] || ''); i += 1; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lecture (read-only)
// ---------------------------------------------------------------------------

/**
 * Lit les deux collections nécessaires. Lecture COMPLÈTE des deux : 48 bons et
 * ~1600 fiches au 2026-08-26, quelques centaines de Ko — aucun filtre serveur
 * ne vaut la complexité à cette échelle, et un rapport partiel serait pire
 * qu'un rapport lent.
 *
 * @returns {Promise<{bons: Array<Object>, articles: Array<Object>}>}
 */
async function lire() {
  const { db } = require('../functions/config/firebase');
  const [bonsSnap, catSnap] = await Promise.all([
    db.collection('consumption_vouchers').get(),
    db.collection('articles_catalog').get(),
  ]);
  const bons = [];
  bonsSnap.forEach((d) => bons.push(Object.assign({ id: d.id }, d.data())));
  const articles = [];
  catSnap.forEach((d) => articles.push(d.data() || {}));
  return { bons, articles };
}

// ---------------------------------------------------------------------------
// Analyse (PURE — exportée et exercée par les tests du module consoBons)
// ---------------------------------------------------------------------------

/**
 * @param {Array<Object>} bons documents `consumption_vouchers`.
 * @param {Array<Object>} articles fiches `articles_catalog`.
 * @param {Object} [opts] options de `parseArgs`.
 * @returns {Object} rapport structuré.
 */
function analyser(bons, articles, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const index = buildArticleCategoryIndex(articles);
  const rows = adaptBonsToConsoRows(bons, {
    campagne: o.campagne || undefined,
    since: o.depuis || undefined,
    until: o.jusquA || undefined,
    catByArticle: index,
  });

  // Le statut de résolution est reconstitué depuis le LIBELLÉ de la ligne :
  // c'est exactement ce que fait l'adaptateur, donc ce que voit l'écran.
  const aClasser = articlesAClasser(rows).map((a) => {
    const statut = lookupArticleCategorie(a.article, index).statut;
    return Object.assign({}, a, {
      statut,
      cause: statut === 'absent'
        ? 'absent du catalogue'
        : (statut === 'ambigu' ? 'clé ambiguë (2 familles)' : 'catégorie catalogue hors familles'),
    });
  });

  const familles = { engrais: 0, pesticide: 0, autre: 0 };
  rows.forEach((r) => { familles[familleBucket(r.Article_Categorie)] += 1; });

  // Clés ambiguës du CATALOGUE, consommées ou non : elles ne trancheront
  // jamais, autant les connaître avant qu'un article ne tombe dessus.
  //
  // DEUX niveaux, listés séparément car ils ne se corrigent pas pareil :
  //  - `byName`  : deux fiches actives portant le MÊME nom normalisé dans deux
  //    familles différentes (doublon franc au catalogue). 0 cas au 2026-08-26,
  //    mais le catalogue compte ~105 doublons connus : l'angle mort deviendra
  //    réel. Symptôme piégeux si on ne le liste pas : corriger `EXTREME` →
  //    `Engrais` reste SANS EFFET tant qu'un doublon `EXTREME` en `autre`
  //    subsiste — l'article reste « à classer » et la correction paraît perdue.
  //    Correction = fusionner/désactiver le doublon, pas re-catégoriser.
  //  - `byAlnum` : même clé une fois la ponctuation retirée (`PRIORI-TOP` vs
  //    `PRIORITOP`). Correction = arbitrer laquelle est la bonne famille.
  const nomsAmbigus = Object.keys(index.byName)
    .filter((k) => index.byName[k].ambigu)
    .sort();
  const clesAmbigues = Object.keys(index.byAlnum)
    .filter((k) => index.byAlnum[k].ambigu)
    .sort();

  return {
    bons: bons.length,
    fiches_actives: Object.keys(index.byName).length,
    lignes: rows.length,
    familles,
    articles_a_classer: aClasser,
    noms_ambigus: nomsAmbigus,
    cles_ambigues: clesAmbigues,
  };
}

// ---------------------------------------------------------------------------
// Mise en forme
// ---------------------------------------------------------------------------

function pad(s, n) {
  const t = String(s);
  return t.length >= n ? t : t + ' '.repeat(n - t.length);
}

function padL(s, n) {
  const t = String(s);
  return t.length >= n ? t : ' '.repeat(n - t.length) + t;
}

function qte(v) {
  return (Math.round(v * 100) / 100).toFixed(2);
}

function render(rapport, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const out = [];
  out.push('════════════════════════════════════════════════════════════════');
  out.push(' CLASSIFICATION DES ARTICLES CONSOMMÉS');
  const filtres = [];
  if (o.campagne) filtres.push('campagne ' + o.campagne);
  if (o.depuis) filtres.push('depuis ' + o.depuis);
  if (o.jusquA) filtres.push("jusqu'à " + o.jusquA);
  out.push(' ' + (filtres.length ? filtres.join(' · ') : 'tous les bons'));
  out.push(' ' + rapport.bons + ' bon(s) · ' + rapport.lignes + ' ligne(s) · '
    + rapport.fiches_actives + ' fiche(s) active(s) au catalogue');
  out.push('════════════════════════════════════════════════════════════════');
  out.push('');

  if (!rapport.lignes) {
    out.push("  Aucune ligne sur ce périmètre. Aucun taux n'est calculable — ne");
    out.push('  pas lire cette absence comme « tout est bien classé ».');
    out.push('');
    return out.join('\n');
  }

  out.push('▶ RÉPARTITION');
  out.push('  engrais    : ' + padL(rapport.familles.engrais, 6));
  out.push('  pesticides : ' + padL(rapport.familles.pesticide, 6));
  out.push('  à classer  : ' + padL(rapport.familles.autre, 6)
    + (rapport.familles.autre ? '   ⚠️  invisibles sur les deux onglets' : '   ✅'));
  out.push('');

  out.push('▶ ARTICLES À CLASSER (à arbitrer au catalogue)');
  if (!rapport.articles_a_classer.length) {
    out.push('  (aucun — tous les articles consommés tombent dans une famille)');
  } else {
    out.push('  ' + pad('article', 28) + pad('cause', 34) + padL('lignes', 7)
      + padL('quantité', 12) + '  unité');
    rapport.articles_a_classer.forEach((a) => {
      out.push('  ' + pad(a.article, 28) + pad(a.cause, 34) + padL(a.lignes, 7)
        + padL(qte(a.quantite), 12) + '  ' + (a.unite || '—'));
    });
    out.push('');
    out.push('  Rappel : la catégorie actuelle des fiches présentes est reprise');
    out.push('  telle quelle ci-dessous, pour l\'arbitrage.');
    rapport.articles_a_classer.forEach((a) => {
      out.push('    - ' + pad(a.article, 28) + '→ ' + a.categorie_actuelle);
    });
  }
  out.push('');

  out.push('▶ CLÉS AMBIGUËS DU CATALOGUE');
  out.push('  Deux fiches actives dans DEUX familles sur la même clé : le');
  out.push('  rapprochement refuse de trancher (fail-closed).');
  out.push('');
  out.push('  · noms identiques (doublon franc — fusionner/désactiver la fiche');
  out.push('    en trop ; re-catégoriser l\'autre resterait SANS EFFET) :');
  if (!(rapport.noms_ambigus || []).length) {
    out.push('      (aucun)');
  } else {
    rapport.noms_ambigus.forEach((k) => out.push('      - ' + k));
  }
  out.push('');
  out.push('  · clés alphanumériques (même clé sans ponctuation — arbitrer la');
  out.push('    bonne famille) :');
  if (!rapport.cles_ambigues.length) {
    out.push('      (aucune)');
  } else {
    rapport.cles_ambigues.forEach((k) => out.push('      - ' + k));
  }
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { bons, articles } = await lire();
  const rapport = analyser(bons, articles, opts);
  process.stdout.write(
    (opts.json ? JSON.stringify(rapport, null, 2) : render(rapport, opts)) + '\n'
  );
}

// Chargé comme module (tests) : rien ne s'exécute. Cf. règles de compatibilité
// Vite du CLAUDE.md — aucun import à effet de bord.
if (require.main === module) {
  main().then(
    () => process.exit(0),
    (e) => { process.stderr.write('ERREUR: ' + (e && e.message ? e.message : e) + '\n'); process.exit(1); }
  );
}

module.exports = { parseArgs, analyser, render };
