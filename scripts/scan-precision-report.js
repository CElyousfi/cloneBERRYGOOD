'use strict';
/**
 * scan-precision-report.js — Rapport de PRÉCISION du rapprochement du scanner
 * de bons de consommation (Lot C, docs/spec-scan-apprentissage.md §4.4).
 *
 * STRICTEMENT LECTURE SEULE. Aucune méthode d'écriture Firestore
 * (set/update/delete/add/batch) n'est appelée nulle part dans ce fichier.
 * Il n'y a AUCUN écran de relecture (décision d'Omar) : ce script est le seul
 * consommateur du journal `bc_scan_corrections`.
 *
 * ── Ce qu'il répond ─────────────────────────────────────────────────────────
 *  1. Combien de propositions sorties en `exact` ont été CORRIGÉES ?
 *     Ce sont les FAUX POSITIFS AVÉRÉS — le défaut que tout le chantier cherche
 *     à éviter, et qu'on n'avait jusqu'ici aucun moyen d'observer. En tête.
 *  2. Taux de pré-remplissage, articles et parcelles séparément.
 *  3. Taux de correction PAR STATUT initial : un `probable` corrigé souvent =
 *     seuil trop permissif ; jamais corrigé = seuil trop strict, on fait
 *     travailler le magasinier pour rien.
 *  4. Efficacité des alias : un alias mémorisé est-il conservé ou re-corrigé ?
 *  5. Palmarès des libellés lus qui coûtent le plus de corrections.
 *
 * Toute l'arithmétique vit dans le module PUR `functions/lib/stock/bcScanJournal.js`
 * (testé unitairement) : ce script ne fait que lire, appeler, et mettre en forme.
 *
 * Usage :
 *   node scripts/scan-precision-report.js
 *   node scripts/scan-precision-report.js --campagne 2026-2027
 *   node scripts/scan-precision-report.js --depuis 2026-08-01 --jusqu-a 2026-09-30
 *   node scripts/scan-precision-report.js --json
 *   node scripts/scan-precision-report.js --demo   # sortie d'exemple, sans Firestore
 */

// En local, l'ADC gcloud peut pointer vers un autre projet (ex: bgf-sentinel).
// Ce script cible toujours le projet Smart Berry, sauf override explicite.
if (!process.env.GCLOUD_PROJECT && !process.env.GOOGLE_CLOUD_PROJECT) {
  process.env.GCLOUD_PROJECT = 'berrygood-farms-dashboard';
}

const {
  computeScanPrecision,
  periodesCouvertes,
} = require('../functions/lib/stock/bcScanJournal');

const COLLECTION = 'bc_scan_corrections';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { json: false, demo: false, campagne: '', depuis: '', jusquA: '', periodes: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--demo') out.demo = true;
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
 * ⚠️ Combiner `--campagne` avec `--depuis`/`--jusqu-a` produit une requête à
 * deux champs (`campagne ==` + `date` en plage) : Firestore exigera un INDEX
 * COMPOSITE. Il n'est pas créé d'avance (on ne devine pas quels filtres seront
 * utilisés) ; au premier usage, le message d'erreur Firestore contient le lien
 * de création directe. Chaque filtre pris SÉPARÉMENT fonctionne sans index.
 */
async function readJournal(opts) {
  const { db } = require('../functions/config/firebase');
  let q = db.collection(COLLECTION);
  if (opts.campagne) q = q.where('campagne', '==', opts.campagne);
  if (opts.depuis) q = q.where('date', '>=', opts.depuis);
  if (opts.jusquA) q = q.where('date', '<=', opts.jusquA);
  const snap = await q.get();
  const rows = [];
  snap.forEach((d) => rows.push(d.data() || {}));
  return rows;
}

/**
 * Jeu de démonstration — sert à montrer la FORME du rapport tant que le journal
 * de production est vide. Il n'est jamais mélangé aux vraies données : `--demo`
 * ne touche pas Firestore du tout.
 */
function jeuDemo() {
  const l = (o) => Object.assign({
    date: '2026-08-25', bon_numero: 'F1-0005667', campagne: '2026-2027',
    article_lu: 'N. calcium', article_propose: 'Nitrate de Calcium',
    article_choisi: 'Nitrate de Calcium', article_status_initial: 'probable', article_score: 0.81,
    parcelle_lue: 'marvilla S-3', parcelle_proposee: 'F1 MARAVILLA S3',
    parcelle_choisie: 'F1 MARAVILLA S3', parcelle_status_initial: 'exact', parcelle_score: 1,
  }, o);
  return [
    l({}),
    l({ article_status_initial: 'exact', article_score: 1 }),
    // Faux positif avéré : proposé `exact`, corrigé par le magasinier.
    l({
      article_lu: 'Decis', article_propose: 'DECIS EXPERT', article_choisi: 'DECIS PROTECH 015 EW',
      article_status_initial: 'exact', article_score: 1, bon_numero: 'F1-0005668',
    }),
    // `probable` corrigé : le seuil est peut-être trop permissif sur ce libellé.
    l({
      article_lu: 'S. Potassium', article_propose: 'Sulfate de Potasse Granulé',
      article_choisi: 'Sulfate de potasse soluble crist.', article_status_initial: 'probable',
      article_score: 0.79, bon_numero: 'F1-0005668',
    }),
    l({
      article_lu: 'S. Potassium', article_propose: 'Sulfate de Potasse Granulé',
      article_choisi: 'Sulfate de potasse soluble crist.', article_status_initial: 'probable',
      article_score: 0.79, bon_numero: 'F1-0005669', date: '2026-09-02',
    }),
    // `unmatched` complété à la main : rien à corriger, tout à enseigner.
    l({
      article_lu: 'Yeoutrop', article_propose: '', article_choisi: 'YEOUTROP 20-20-20',
      article_status_initial: 'unmatched', article_score: null,
      parcelle_lue: 'M.T.L S-8', parcelle_proposee: '', parcelle_choisie: 'F5- CASCADE -S8-2',
      parcelle_status_initial: 'unmatched', parcelle_score: null,
      bon_numero: 'F1-0005670', date: '2026-09-02',
    }),
    // Alias mémorisé, conservé.
    l({
      parcelle_lue: 'M.T.L S-8', parcelle_proposee: 'F5- CASCADE -S8-2',
      parcelle_choisie: 'F5- CASCADE -S8-2', parcelle_status_initial: 'alias',
      parcelle_score: 1, parcelle_alias_count: 2,
      bon_numero: 'F1-0005671', date: '2026-09-02',
    }),
    // Alias mémorisé, RE-corrigé : l'apprentissage a mémorisé une erreur.
    l({
      parcelle_lue: 'M.T.L S-13-14', parcelle_proposee: 'F5- CASCADE -S13',
      parcelle_choisie: 'S14 - YAZMIN F5', parcelle_status_initial: 'alias',
      parcelle_score: 1, parcelle_alias_count: 1,
      bon_numero: 'F1-0005672', date: '2026-09-02',
    }),
  ];
}

// ---------------------------------------------------------------------------
// Mise en forme
// ---------------------------------------------------------------------------

/** Pourcentage lisible. `null` (dénominateur nul) → « n/a », JAMAIS « 0 % ». */
function pct(v) {
  return v == null ? 'n/a' : (v * 100).toFixed(1) + ' %';
}

/** Score moyen lisible, `null` → « n/a ». */
function sc(v) {
  return v == null ? 'n/a' : v.toFixed(2);
}

function pad(s, n) {
  const t = String(s);
  return t.length >= n ? t : t + ' '.repeat(n - t.length);
}

function padL(s, n) {
  const t = String(s);
  return t.length >= n ? t : ' '.repeat(n - t.length) + t;
}

function ligneStatuts(cote, out) {
  out.push('    ' + pad('statut', 12) + padL('lignes', 8) + padL('conserv.', 10)
    + padL('corrig.', 9) + padL('% corr.', 10) + padL('score moy.', 12));
  const noms = Object.keys(cote.par_statut);
  if (!noms.length) { out.push('    (aucune ligne)'); return; }
  noms.forEach((nom) => {
    const s = cote.par_statut[nom];
    out.push('    ' + pad(nom, 12) + padL(s.lignes, 8) + padL(s.conservees, 10)
      + padL(s.corrigees, 9) + padL(pct(s.taux_correction), 10) + padL(sc(s.score_moyen), 12));
  });
}

function blocCote(titre, cote, out) {
  out.push('  ' + titre);
  out.push('    pré-remplissage : ' + cote.proposees + ' / ' + cote.lignes
    + '  (' + pct(cote.taux_prefill) + ')');
  out.push('    corrections     : ' + cote.corrigees + ' / ' + cote.renseignees
    + '  (' + pct(cote.taux_correction) + ')');
  out.push('');
  ligneStatuts(cote, out);
  out.push('');
  out.push('    alias mémorisés : ' + cote.alias.lignes + ' appliqué(s), '
    + cote.alias.conservees + ' conservé(s), ' + cote.alias.corrigees + ' re-corrigé(s)'
    + '  → conservation ' + pct(cote.alias.taux_conservation));
  if (cote.palmares.length) {
    out.push('');
    out.push('    libellés les plus coûteux en corrections :');
    cote.palmares.forEach((p) => {
      out.push('      ' + pad(p.libelle, 28) + padL(p.corrigees + '/' + p.lignes, 8)
        + padL(pct(p.taux_correction), 10));
    });
  }
  out.push('');
}

function render(rapport, opts, couverture) {
  const cv = couverture || { periodes: [], tronquee: false };
  const out = [];
  out.push('════════════════════════════════════════════════════════════════');
  out.push(' PRÉCISION DU SCAN DES BONS DE CONSOMMATION');
  const filtres = [];
  if (opts.campagne) filtres.push('campagne ' + opts.campagne);
  if (opts.depuis) filtres.push('depuis ' + opts.depuis);
  if (opts.jusquA) filtres.push("jusqu'à " + opts.jusquA);
  if (opts.demo) filtres.push('JEU DE DÉMONSTRATION (journal non lu)');
  out.push(' ' + (filtres.length ? filtres.join(' · ') : 'tout le journal'));
  out.push(' ' + rapport.lignes + ' ligne(s) journalisée(s) · ' + rapport.bons + ' bon(s)');
  out.push('════════════════════════════════════════════════════════════════');
  out.push('');

  if (!rapport.lignes) {
    out.push('  Journal vide : aucun bon enregistré depuis la mise en service du');
    out.push('  journal. Aucun taux n\'est calculable — ne pas lire cette absence');
    out.push('  comme « 0 % d\'erreur ».');
    out.push('');
    return out.join('\n');
  }

  // ── EN TÊTE : les faux positifs. C'est le chiffre qui décide s'il faut
  //    resserrer les seuils ; tout le reste est du réglage de confort.
  out.push('▶ FAUX POSITIFS AVÉRÉS (proposition `exact`, puis CORRIGÉE)');
  out.push('  articles  : ' + rapport.faux_positifs.article);
  out.push('  parcelles : ' + rapport.faux_positifs.parcelle);
  out.push('  TOTAL     : ' + rapport.faux_positifs.total
    + (rapport.faux_positifs.total ? '   ⚠️  seuils trop permissifs, à resserrer' : '   ✅'));
  out.push('');

  blocCote('▶ ARTICLES', rapport.article, out);
  blocCote('▶ PARCELLES', rapport.parcelle, out);

  out.push('▶ PAR PÉRIODE (mois)');
  if (cv.tronquee) {
    out.push('  ⚠️  plage trop large (date aberrante dans les données) : seuls les');
    out.push('      mois RÉELLEMENT observés sont listés. Des mois sans donnée');
    out.push('      peuvent manquer — borner avec --depuis / --jusqu-a.');
  }
  out.push('  ' + pad('période', 10) + padL('lignes', 8) + padL('art.préf.', 11)
    + padL('art.corr.', 11) + padL('parc.préf.', 12) + padL('parc.corr.', 12) + padL('faux pos.', 11));
  rapport.periodes.forEach((p) => {
    out.push('  ' + pad(p.periode, 10) + padL(p.lignes, 8)
      + padL(pct(p.article.taux_prefill), 11) + padL(pct(p.article.taux_correction), 11)
      + padL(pct(p.parcelle.taux_prefill), 12) + padL(pct(p.parcelle.taux_correction), 12)
      + padL(p.article.faux_positifs + p.parcelle.faux_positifs, 11));
  });
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------------

/**
 * Chemin COMPLET du rapport, de la liste d'entrées au texte affiché.
 *
 * Exporté et testé (tests/unit/scanPrecisionReport.test.js) : c'est
 * exactement le code que la CLI exécute. Tester `computeScanPrecision` seul ne
 * suffisait pas — la fonctionnalité « période vide » était implémentée et
 * testée dans le module, mais INATTEIGNABLE depuis la ligne de commande faute
 * de lui passer `periodes`. Un mois entier sans donnée s'évaporait du tableau,
 * ce qui est précisément le défaut que ce lot combat.
 *
 * @param {Array<Object>} rows Entrées du journal.
 * @param {Object} [opts] Options de `parseArgs`.
 * @returns {{rapport: Object, couverture: {periodes: Array<string>, tronquee: boolean}, texte: string}}
 */
function analyser(rows, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const couverture = periodesCouvertes(rows, { depuis: o.depuis, jusqu_a: o.jusquA });
  const rapport = computeScanPrecision(rows, { periodes: couverture.periodes });
  return { rapport, couverture, texte: render(rapport, o, couverture) };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rows = opts.demo ? jeuDemo() : await readJournal(opts);
  const { rapport, texte } = analyser(rows, opts);
  process.stdout.write((opts.json ? JSON.stringify(rapport, null, 2) : texte) + '\n');
}

// Chargé comme module (tests) : rien ne s'exécute. Cf. règles de compatibilité
// Vite du CLAUDE.md — aucun import à effet de bord.
if (require.main === module) {
  main().then(
    () => process.exit(0),
    (e) => { process.stderr.write('ERREUR: ' + (e && e.message ? e.message : e) + '\n'); process.exit(1); }
  );
}

module.exports = { parseArgs, analyser, render, jeuDemo, COLLECTION };
