/* Extrait de pointageService.js — blocs repris VERBATIM.
   Seul ce preambule de require est ajoute. */
'use strict';
const { POINTAGE_FERMES, USE_MIRROR, _refMap, buildHeuresSup, buildParCulture, buildPeriodeCampagne, campagneBudget, campagneCourante, campagneExport, campagneOf, classifyType, computeChargCond, countDistinctByFermeType, coutOuvrier, db_firestore, deriveFerme, fetchBrParcelleSupMap, fetchDetailFromMirror, fetchPostesFixesFromMirror, fetchSummaryFromMirror, filterByFermeField, filterMirrorRowsByCulture, filterMirrorRowsByFerme, getCueilletteRows, getExcludedFonctionsHS, getJoursFeries, getPointageMeta, getPointageRowsForDate, getPointageRowsForDateRange, getPointageRowsForPeriode, getPool, getSyncStatus, loadReferentielTaches, pointageCacheKey, quantiteToKg, referentielOperationsConnues, resolveFamily, resolveMyrtilleVariete, resolvePointageRHAccess, warmRefTaches, withCache } = require("./pointageService.part1");


// =============================================
// Internal helpers for snapshot creation
// =============================================

// Fetch detail rows from SQL for a given date, filtered by ferme
async function fetchDetailFromSQL(dateParam) {
  const db = await getPool();
  const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
  const result = await db.request().query(`
    SELECT Personnel_Matricule, Personnel_Nom, Operation_Famille, Operation, Operation_Groupe,
      Nombre_Jr, Nombre_Hr, Quantite_unite, Cout, Parcelle_Culturale, Ref_parcelle, Variete, Culture,
      HS_25, HS_50, HS_100, HS_NM
    FROM BR_Pointage
    WHERE CONVERT(date, Periode_Date) = ${dateSQL}
    ORDER BY Ref_parcelle, Operation_Famille, Personnel_Nom
  `);
  return result.recordset.map(r => ({
    matricule: (r.Personnel_Matricule || "").trim(),
    nom: (r.Personnel_Nom || "").trim(),
    operationFamille: r.Operation_Famille,
    operation: r.Operation,
    groupe: r.Operation_Groupe,
    jours: r.Nombre_Jr, heures: r.Nombre_Hr, quantite: r.Quantite_unite, cout: r.Cout,
    parcelle: (r.Parcelle_Culturale || "").trim(),
    refParcelle: (r.Ref_parcelle || "").trim(),
    ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
    type: classifyType(r.Operation_Famille),
    variete: r.Variete, culture: r.Culture,
    hs25: r.HS_25, hs50: r.HS_50, hs100: r.HS_100,
  }));
}


// Fetch summary data from SQL for a given date
async function fetchSummaryFromSQL(dateParam) {
  const db = await getPool();
  const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
  // Effectifs = OUVRIERS DISTINCTS par (ferme, type). On récupère le matricule au grain
  // (parcelle, op) puis on déduplique côté JS par (ferme, type) — un ouvrier multi-parcelles
  // ne doit être compté qu'une fois. On agrège le coût au même grain (somme inchangée).
  const todayRes = await db.request().query(`
    SELECT Ref_parcelle, Parcelle_Culturale, Operation_Famille, Personnel_Matricule,
      SUM(Cout) AS totalCout
    FROM BR_Pointage
    WHERE CONVERT(date, Periode_Date) = ${dateSQL}
    GROUP BY Ref_parcelle, Parcelle_Culturale, Operation_Famille, Personnel_Matricule
  `);
  const lines = todayRes.recordset.map(r => ({
    matricule: r.Personnel_Matricule,
    ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
    type: classifyType(r.Operation_Famille),
    cout: r.totalCout || 0,
  }));
  return countDistinctByFermeType(lines, POINTAGE_FERMES);
}


// Fetch postes fixes from SQL for a given date
async function fetchPostesFixesFromSQL(dateParam) {
  const db = await getPool();
  const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
  const result = await db.request().query(`
    SELECT Personnel_Matricule, Personnel_Nom, Operation, Ref_parcelle, Parcelle_Culturale,
      Nombre_Jr, Nombre_Hr, Cout
    FROM BR_Pointage
    WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = N'11. Postes fixes'
    ORDER BY Ref_parcelle, Operation, Personnel_Nom
  `);
  return result.recordset.map(r => ({
    matricule: (r.Personnel_Matricule || '').trim(),
    nom: (r.Personnel_Nom || '').trim(),
    operation: r.Operation,
    parcelle: (r.Parcelle_Culturale || '').trim(),
    ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
    jours: r.Nombre_Jr,
    heures: r.Nombre_Hr,
    cout: Math.round(r.Cout || 0),
  }));
}


// Create a snapshot for a specific date+ferme
async function createSnapshot(dateParam, ferme, profileId) {
  const allDetail = USE_MIRROR ? await fetchDetailFromMirror(dateParam) : await fetchDetailFromSQL(dateParam);
  const fermeDetail = allDetail.filter(r => r.ferme === ferme);
  const allPostes = USE_MIRROR ? await fetchPostesFixesFromMirror(dateParam) : await fetchPostesFixesFromSQL(dateParam);
  const fermePostes = allPostes.filter(r => r.ferme === ferme);
  const summaryData = USE_MIRROR ? await fetchSummaryFromMirror(dateParam) : await fetchSummaryFromSQL(dateParam);
  const fermeSummary = summaryData[ferme] || { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 };

  const docId = `${dateParam}_${ferme}`;
  const snapRef = db_firestore.collection("pointage_snapshots").doc(docId);
  const existing = await snapRef.get();
  const version = existing.exists ? (existing.data().version || 1) + 1 : 1;

  const snapshotData = {
    date: dateParam,
    ferme,
    createdAt: Date.now(),
    createdBy: profileId || "rh",
    version,
    summary: fermeSummary,
    detailRows: fermeDetail,
    postesFixes: fermePostes,
    workerCount: new Set(fermeDetail.map(r => r.matricule)).size,
  };

  await snapRef.set(snapshotData);
  return snapshotData;
}


// Get submitted fermes for a date (those with visaRH or rejected status — i.e. have snapshots)
async function getSubmittedFermes(dateParam) {
  if (!dateParam) return {};
  const snaps = await db_firestore.collection("pointage_validations")
    .where("date", "==", dateParam).get();
  const result = {};
  snaps.forEach(doc => {
    const d = doc.data();
    if (d.visaRH || d.rejected) {
      result[d.ferme] = { snapshotId: doc.id, rejected: !!d.rejected };
    }
  });
  return result;
}


// Get snapshot data for a ferme
async function getSnapshotData(dateParam, ferme) {
  const docId = `${dateParam}_${ferme}`;
  const snap = await db_firestore.collection("pointage_snapshots").doc(docId).get();
  if (!snap.exists) return null;
  return snap.data();
}


// =============================================
// Cache Warmer — pre-populates api_cache for pointage endpoints
// Reads from Firestore mirror only (GCP→GCP, zero farm network impact)
// =============================================
// Recolte-equipes — shared compute + cache guard
// =============================================
// shouldCacheRecolteEquipes : refuse le cache si la majorité des dates n'ont aucun kg>0.
// some() était trop laxiste : 5 dates anciennes OK + 25 dates récentes à kg=0 passait → cache servi 5 min avec chart vide.
// Heuristique : >= 70% des dates doivent avoir au moins une ligne kg>0.
function shouldCacheRecolteEquipes(r) {
  if (!r || !r.success || !Array.isArray(r.rows) || r.rows.length === 0) return true;
  const byDate = {};
  r.rows.forEach(row => {
    const d = row.jour;
    if (!byDate[d]) byDate[d] = { total: 0, withKg: 0 };
    byDate[d].total++;
    if ((row.kg || 0) > 0) byDate[d].withKg++;
  });
  const dates = Object.keys(byDate);
  if (dates.length === 0) return true;
  const goodDates = dates.filter(d => byDate[d].withKg > 0).length;
  return (goodDates / dates.length) >= 0.7;
}


// computeRecolteEquipesPayload : calcul COMPLET du payload recolte-equipes.
// Lignes brutes du mirror (8. Récolte) → groupement matricule/jour → variété dominante
// → ENRICHISSEMENT kg depuis prod_tracabilite_recolte (getAll chunké, 3 retries) → ajout
// des ouvriers prod manquants. Le kg de récolte vient UNIQUEMENT de l'enrichissement prod
// (quantiteToKg=0 sur l'opération « Récolte »). Source de vérité unique partagée entre le
// serving path et le warm path → plus de divergence (warm cachait un payload kg=0).
// nQuinz : nombre de quinzaines chargées depuis meta.periodes (slice(0, nQuinz)). 3 partout.
// fermeFilter : GATING PAIE — chef → agrégat cloisonné sur SA ferme ; null → toutes fermes
// (RH/DG/Finance, inchangé). Filtre appliqué sur les lignes brutes du mirror AVANT
// agrégation, ET sur les ouvriers prod ajoutés (fail-closed sur 'Autre').
async function computeRecolteEquipesPayload(nQuinz, fermeFilter = null) {
  if (USE_MIRROR) {
    const meta = await getPointageMeta();
    const periodes = meta?.periodes || [];
    // Charger nQuinz quinzaines (~45 jours pour 3) : couvre la fenêtre 30j par défaut du chart
    // Coût Récolte avec buffer. ⚠️ Borné depuis que meta.periodes liste TOUTES les quinzaines
    // du mirror (fix quinzaines 21/22) : slice(0,6) chargeait ~6 quinzaines (~12k lignes)
    // → recolte-equipes lent (~10s) et Coût Récolte dégradé.
    const targetPeriodes = periodes.slice(0, nQuinz);
    const allRows = [];
    for (const p of targetPeriodes) {
      const pRows = await getPointageRowsForPeriode(p);
      // GATING PAIE : chef → filtre ferme sur lignes brutes AVANT agrégation.
      allRows.push(...filterMirrorRowsByFerme(pRows, fermeFilter));
    }
    const recolteRows = allRows.filter(r => r.Operation_Famille === "8. Récolte");
    const rawRows = recolteRows.map(r => ({
      matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
      jour: r.DateStr, periode: r.Periode_paie,
      kg: quantiteToKg(r.Quantite_unite, r.Operation),
      heures: r.Nombre_Hr, cout: Math.round(r.Cout || 0),
      ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
      variete: resolveMyrtilleVariete((r.Variete || "").trim(), r.Parcelle_Culturale),
      culture: (r.Culture || "").trim(),
      parcelle: (r.Parcelle_Culturale || "").trim(), operation: (r.Operation || "").trim(),
    }));
    // Agréger par ouvrier+jour (un ouvrier peut avoir plusieurs variétés/parcelles le même jour)
    const grouped = {};
    for (const r of rawRows) {
      const key = `${r.matricule}|${r.jour}`;
      if (!grouped[key]) {
        grouped[key] = { ...r, kgByVariete: { [r.variete]: r.kg } };
      } else {
        grouped[key].kg += r.kg;
        grouped[key].heures += r.heures;
        grouped[key].cout += r.cout;
        const v = r.variete || 'Autre';
        grouped[key].kgByVariete[v] = (grouped[key].kgByVariete[v] || 0) + r.kg;
      }
    }
    // Déterminer variété dominante pour chaque jour
    let rows = Object.values(grouped).map(r => {
      const bestVariete = Object.entries(r.kgByVariete)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || r.variete;
      delete r.kgByVariete;
      return { ...r, variete: bestVariete, kg: Math.round(r.kg * 10) / 10 };
    });

    // Enrich with production data (Tracabilite_recolte) — more accurate kg.
    // Le kg de récolte vient UNIQUEMENT d'ici (quantiteToKg=0 sur l'opération « Récolte »).
    // ⚠️ Historique : on lisait les ~60-90 docs prod SÉQUENTIELLEMENT (un get() par date). Un échec
    // transitoire Firestore faisait sauter l'enrichissement → kg=0 sur TOUTES les dates → payload
    // dégradée servie au DG. Parade : getAll() chunké en lots de 10 (+ 3 retries/lot).
    const prodDates = [...new Set(rows.map(r => r.jour))].sort();
    let enrichedCount = 0, addedCount = 0;
    const perDateStats = [];
    const prodByDate = {};
    let getAllFailedChunks = 0;
    if (prodDates.length > 0) {
      const CHUNK = 10;
      for (let i = 0; i < prodDates.length; i += CHUNK) {
        const chunkRefs = prodDates.slice(i, i + CHUNK)
          .map(d => db_firestore.collection("prod_tracabilite_recolte").doc(d));
        let docs = null;
        for (let attempt = 0; attempt < 3 && docs === null; attempt++) {
          try {
            docs = await db_firestore.getAll(...chunkRefs);
          } catch (chunkErr) {
            if (attempt === 2) {
              getAllFailedChunks++;
              console.error(`[recolte-equipes] getAll lot ${i / CHUNK} échoué 3x (${chunkErr.message})`);
              docs = [];
            }
          }
        }
        docs.forEach(doc => { if (doc && doc.exists) prodByDate[doc.id] = doc.data(); });
      }
      if (getAllFailedChunks > 0) console.warn(`[recolte-equipes] ${getAllFailedChunks} lot(s) getAll en échec → enrichissement partiel`);
    }
    for (const date of prodDates) {
      try {
        const prodData = prodByDate[date];
        if (!prodData) { perDateStats.push(`${date}:noDoc`); continue; }
        const prodRows = prodData.rows || [];
        if (prodRows.length === 0) { perDateStats.push(`${date}:emptyRows`); continue; }
        const prodMap = {};
        prodRows.forEach(r => { prodMap[(r.matricule || "").toUpperCase()] = r; });
        // Override kg for existing worker-days
        let perDateEnriched = 0;
        rows.forEach(r => {
          if (r.jour !== date) return;
          const prod = prodMap[(r.matricule || "").toUpperCase()];
          if (prod) {
            r.kg = prod.totalKg;
            r.variete = prod.variete || r.variete;
            enrichedCount++;
            perDateEnriched++;
          }
        });
        // Add workers in prod but missing from pointage for this date
        const existingMats = new Set(rows.filter(r => r.jour === date).map(r => (r.matricule || "").toUpperCase()));
        const periode = rows.find(r => r.jour === date)?.periode || (targetPeriodes && targetPeriodes[0]) || "";
        let perDateAdded = 0;
        prodRows.forEach(pr => {
          if (!existingMats.has((pr.matricule || "").toUpperCase()) && pr.totalKg > 0) {
            // GATING PAIE : ouvrier prod ajouté → n'entre QUE s'il appartient à la
            // ferme du chef (fail-closed : ferme dérivée 'Autre'/autre ferme exclue).
            const prFerme = deriveFerme(pr.refParcelle, "");
            if (fermeFilter && prFerme !== fermeFilter) return;
            rows.push({
              matricule: pr.matricule, nom: pr.nom, jour: date, periode,
              kg: pr.totalKg, heures: 0, cout: 0,
              ferme: prFerme, variete: pr.variete || "",
              culture: "", parcelle: pr.refParcelle || "", operation: "Récolte (prod)",
            });
            addedCount++;
            perDateAdded++;
          }
        });
        perDateStats.push(`${date}:e${perDateEnriched}/a${perDateAdded}/prodRows${prodRows.length}`);
      } catch (dateErr) {
        perDateStats.push(`${date}:ERR(${dateErr.message})`);
        console.warn(`[recolte-equipes] enrichment failed for ${date}:`, dateErr.message);
      }
    }
    console.log(`[recolte-equipes] Prod enrichment: ${enrichedCount} overridden, ${addedCount} added, ${prodDates.length} dates checked. Per-date: ${perDateStats.join(' | ')}`);

    const periodeCampagne = (meta && meta.periodeCampagne) || {};
    return { success: true, periodes, periodeCampagne, rows };
  }
  // SQL fallback
  const db = await getPool();
  const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
  const periodes = periodesRes.recordset.map(r => r.Periode_paie);
  const result = await db.request().query(`SELECT Personnel_Matricule, Personnel_Nom, CONVERT(date, Periode_Date) AS jour, Periode_paie, Quantite_unite, Nombre_Hr, Cout, Ref_parcelle, Parcelle_Culturale, Variete, Culture, Operation FROM BR_Pointage WHERE Operation_Famille = N'8. Récolte' ORDER BY jour DESC`);
  const sqlRawRowsAll = result.recordset.map(r => ({ matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: new Date(r.jour).toISOString().slice(0, 10), periode: r.Periode_paie, kg: quantiteToKg(r.Quantite_unite, r.Operation), heures: r.Nombre_Hr, cout: Math.round(r.Cout || 0), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: resolveMyrtilleVariete((r.Variete || "").trim(), r.Parcelle_Culturale), culture: (r.Culture || "").trim(), parcelle: (r.Parcelle_Culturale || "").trim(), operation: (r.Operation || "").trim() }));
  // GATING PAIE : chef → cloisonnement sur la ferme dérivée (fail-closed).
  const sqlRawRows = filterByFermeField(sqlRawRowsAll, fermeFilter);
  // Agréger par ouvrier+jour
  const sqlGrouped = {};
  for (const r of sqlRawRows) {
    const key = `${r.matricule}|${r.jour}`;
    if (!sqlGrouped[key]) {
      sqlGrouped[key] = { ...r, kgByVariete: { [r.variete]: r.kg } };
    } else {
      sqlGrouped[key].kg += r.kg;
      sqlGrouped[key].heures += r.heures;
      sqlGrouped[key].cout += r.cout;
      const v = r.variete || 'Autre';
      sqlGrouped[key].kgByVariete[v] = (sqlGrouped[key].kgByVariete[v] || 0) + r.kg;
    }
  }
  const rows = Object.values(sqlGrouped).map(r => {
    const bestVariete = Object.entries(r.kgByVariete)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || r.variete;
    delete r.kgByVariete;
    return { ...r, variete: bestVariete, kg: Math.round(r.kg * 10) / 10 };
  });
  return { success: true, periodes, rows };
}


// =============================================
// computeCampagneCoutOuvrier : coût ouvrier de la campagne, PAR OUVRIER.
//
// Extrait du handler `campagne-cout-ouvrier` pour être appelé AUSSI par
// computeCampagneAnalytiqueDetail : la grille Campagne doit valoriser chaque
// ligne au taux de L'OUVRIER qui l'a faite, et refaire ce calcul ailleurs
// recréerait exactement les deux chemins divergents qu'on vient de supprimer.
//
// Le résultat est caché 30 min : le second appelant ne repaie pas la lecture.
// =============================================
async function computeCampagneCoutOuvrier() {
        // Traitement, chargement et conditionnement sont primés au même tarif
        // journalier (écran Quinzaine, primesConfig.primeChargement.coutParJour).
        const PRIME_JOUR_DH = 10;
        const today = new Date();
        const y = today.getFullYear();
        const startYear = today.getMonth() >= 6 ? y : y - 1;
        const campagne = {
          start: `${startYear}-07-01`,
          end: `${startYear + 1}-06-30`,
          label: `${startYear}/${startYear + 1}`,
        };

        // Le coût moyen d'un ouvrier ne dépend NI de la ferme NI de la culture :
        // c'est une moyenne d'entreprise. La clé de cache est donc globale — la
        // ferme du demandeur ne change pas le résultat (contrairement aux
        // payloads nominatifs, cloisonnés eux).
        //
        // GATING : l'action passe par le contrôle d'accès commun de
        // /api/pointage-rh (authentification + profil autorisé) ; elle n'est PAS
        // exemptée. Ce qu'elle rend est un AGRÉGAT — un coût moyen, un nombre de
        // journées, un effectif — sans aucune donnée nominative, et il alimente
        // la valorisation en dirhams de l'écran Campagne, que ces mêmes profils
        // voient déjà (la grille y affiche des DH/Ha par parcelle).
        const cached = await withCache(
          // v2 : + tauxParOuvrier, fériés au barème (plus au coût BEE ONE), heures sup
          // incluses. Sans bump, une réponse v1 encore en cache servirait un
          // payload SANS taux — et la grille retomberait silencieusement sur sa
          // moyenne, sans que rien ne le signale.
          // v3 : + `postes` (ventilation par quinzaine) et transport résolu à la
          // quinzaine — le tarif ne vit que dans `history`, le champ plat
          // renvoyait 0. Une réponse v2 en cache servirait un coût amputé du
          // transport, exactement le symptôme qu'on vient de corriger.
          // v4 : clé de registre normalisée. Les matricules alphanumériques
          // trouvent enfin leur fiche — déclaré, ancienneté, prime de fonction.
          // Les valeurs changent sans que la forme bouge : sans bump, le cache
          // servirait l'ancien coût, faux et plausible.
          `campagne_cout_ouvrier_v4_${campagne.start}`,
          30 * 60 * 1000,
          async () => {
            const meta = await getPointageMeta();
            const periodeMap = (meta && meta.periodeMap) || {};

            // Quinzaines de la campagne, DANS L'ORDRE : l'ancienneté se cumule
            // de l'une à l'autre, les traiter en désordre la fausserait.
            const periodes = Object.keys(periodeMap)
              .map((p) => ({
                periode: p,
                dates: (periodeMap[p] || [])
                  .filter((d) => d >= campagne.start && d <= campagne.end)
                  .sort(),
              }))
              .filter((q) => q.dates.length > 0)
              .sort((a, b) => (a.dates[0] < b.dates[0] ? -1 : 1));

            if (periodes.length === 0) {
              return {
                success: true, campagne: campagne.label, coutMoyenJour: null,
                jours: 0, ouvriers: 0, quinzaines: 0, coutTotal: 0,
              };
            }

            // 1) Pointage : une lecture par journée de la campagne. En sortent
            //    le salaire de base BEE ONE, les journées et les heures sup ;
            //    les PRIMES DE TERRAIN se calculent ensuite sur les mêmes lignes.
            const holidays = await getJoursFeries();
            const quinzaines = [];
            const tousMatricules = new Set();
            for (const q of periodes) {
              const snaps = await Promise.all(q.dates.map((d) =>
                db_firestore.collection('sql_mirror_pointage').doc(d).get()));
              const parOuvrier = {};
              const lignesQuinzaine = [];
              snaps.forEach((snap, i) => {
                if (!snap.exists) return;
                const rows = snap.data().rows || [];
                coutOuvrier.cumuleJournee(parOuvrier, rows, q.dates[i]);
                lignesQuinzaine.push(...rows);
              });

              // PRIME DE TRAITEMENT : 10 DH par ouvrier et par JOUR passé sur une
              // opération de traitement (même règle que l'écran Quinzaine).
              const joursTraitement = {};
              lignesQuinzaine.forEach((r) => {
                if (!/traitement/i.test(r.Operation_Famille || '')) return;
                const m = String(r.Personnel_Matricule || '').trim();
                if (!m) return;
                if (!joursTraitement[m]) joursTraitement[m] = new Set();
                joursTraitement[m].add(r.DateStr);
              });

              // CHARGEMENT / CONDITIONNEMENT / JOURS FÉRIÉS : réutilise le calcul
              // déjà en production (computeChargCond), pour que ce coût ne puisse
              // pas diverger de celui affiché par l'écran Quinzaine.
              const cc = computeChargCond(lignesQuinzaine, holidays);
              const parMat = (liste, valeur) => {
                const out = {};
                (liste || []).forEach((w) => {
                  if (!w || !w.matricule) return;
                  out[w.matricule] = (out[w.matricule] || 0) + valeur(w);
                });
                return out;
              };
              const chargement = parMat(cc.chargementDetail, (w) => (w.jh || 0) * PRIME_JOUR_DH);
              const conditionnement = parMat(cc.conditionnementDetail, (w) => (w.jh || 0) * PRIME_JOUR_DH);
              // Jours fériés en NOMBRE de jours (`jh`), plus en dirhams : leur
              // valorisation vient désormais du barème Smart Berry. `w.cout`
              // était le coût journalier moyen BEE ONE — dernier filet d'argent
              // BEE ONE dans le coût de campagne (corrigé le 2026-08-21).
              const feriesJours = parMat(cc.jourFerieDetail, (w) => w.jh || 0);

              Object.keys(parOuvrier).forEach((m) => {
                tousMatricules.add(m);
                parOuvrier[m].primes = {
                  traitement: (joursTraitement[m] ? joursTraitement[m].size : 0) * PRIME_JOUR_DH,
                  chargement: chargement[m] || 0,
                  conditionnement: conditionnement[m] || 0,
                  recolte: 0, // renseigné plus bas, depuis les kilos cueillis
                };
                parOuvrier[m].feriesJours = feriesJours[m] || 0;
              });

              // HEURES SUP ACCORDÉES de la quinzaine (rh_heures_sup). Absentes,
              // le coût est simplement calculé sans elles — jamais une erreur :
              // une quinzaine sans heures sup est le cas courant.
              let heuresSupNet = {};
              try {
                const hsSnap = await db_firestore.collection('rh_heures_sup').doc(q.periode).get();
                if (hsSnap.exists) heuresSupNet = (hsSnap.data() || {}).montants || {};
              } catch (e) { heuresSupNet = {}; }

              quinzaines.push({
                periode: q.periode,
                dateFin: q.dates[q.dates.length - 1],
                parOuvrier,
                heuresSupNet,
              });
            }

            // 1 bis) PRIME DE RÉCOLTE : aux kilos cueillis, barème par variété.
            // Les kilos ne sont PAS dans le pointage (l'opération Récolte y a une
            // quantité nulle) : ils viennent de l'enrichissement production, via
            // le MÊME calcul que l'écran Coût Récolte.
            try {
              const recolte = await computeRecolteEquipesPayload(periodes.length, null);
              const parPeriode = {};
              (recolte && recolte.rows ? recolte.rows : []).forEach((r) => {
                const p = (r.periode || '').trim();
                const m = (r.matricule || '').trim();
                if (!p || !m) return;
                if (!parPeriode[p]) parPeriode[p] = {};
                parPeriode[p][m] = (parPeriode[p][m] || 0)
                  + coutOuvrier.primeRecolte(r.kg, r.variete, r.jour);
              });
              quinzaines.forEach((q) => {
                const parMatQ = parPeriode[q.periode] || {};
                Object.keys(q.parOuvrier).forEach((m) => {
                  if (q.parOuvrier[m].primes) q.parOuvrier[m].primes.recolte = parMatQ[m] || 0;
                });
              });
            } catch (e) {
              // La prime de récolte manquante DÉGRADE le coût, elle ne doit pas
              // faire tomber l'indicateur — mais il faut que ça se voie.
              console.warn('[campagne-cout-ouvrier] prime de récolte indisponible :', e && e.message);
            }

            // 2) Registre ouvriers (déclaré, ancienneté, prime de fonction).
            // CLÉS NUMÉRIQUES — `ouvriers_registry` n'en connaît pas d'autres.
            // Le pointage sert des matricules alphanumériques (`CA10563`) ;
            // demander le document `CA10563` ne rendait rien, et l'ouvrier
            // passait pour un non-déclaré sans fiche. On dédoublonne au passage :
            // deux matricules bruts peuvent viser la même fiche.
            const mats = Array.from(new Set(
              Array.from(tousMatricules).map((m) => coutOuvrier.cleRegistre(m)).filter(Boolean)
            ));
            const registre = {};
            const LOT = 20;
            for (let i = 0; i < mats.length; i += LOT) {
              const chunk = mats.slice(i, i + LOT);
              const snaps = await Promise.all(chunk.map((m) =>
                db_firestore.collection('ouvriers_registry').doc(m).get()));
              snaps.forEach((snap, j) => { if (snap.exists) registre[chunk[j]] = snap.data(); });
            }

            // 3) Barèmes de paie et primes de transport. Absents → le module
            //    pur retombe sur les barèmes par défaut / une prime nulle : le
            //    chiffre reste calculable, il est simplement moins juste.
            const [baremesSnap, transportSnap] = await Promise.all([
              db_firestore.collection('app_settings').doc('paie_baremes').get(),
              db_firestore.collection('rh_config').doc('transport_primes').get(),
            ]);
            const baremes = baremesSnap.exists ? baremesSnap.data() : {};
            const equipesTransport = (transportSnap.exists && transportSnap.data().equipes) || [];

            const out = coutOuvrier.coutOuvrierCampagne({
              quinzaines, registre, baremes, equipesTransport,
            });
            return Object.assign({ success: true, campagne: campagne.label }, out);
          }
        );
  return cached;
}


// =============================================
// computeCampagneAnalytiqueDetail : calcul COMPLET du payload
// `campagne-analytique-detail` (granularité parcelle × quinzaine × opération).
//
// EXTRAIT du handler HTTP `pointageRH` (même modèle que
// computeRecolteEquipesPayload) pour être réutilisable EN INTERNE — l'export
// Excel serveur (functions/lib/campagneExport) consomme le même payload que
// l'écran, sans repasser par HTTP. Le handler délègue désormais ici : le corps
// est repris à l'identique, aucune valeur du payload ne change.
//
// ⚠️ PÉRIMÈTRE EXPLICITE — dans le handler, le gating chef passait par le SHADOW
// des fetchers (`getPointageRowsForDate` filtré, cf. « GATING PAIE » dans
// pointageRH). Une fonction de module ne voit PAS ces shadows : le périmètre est
// donc reçu en PARAMÈTRES et le filtrage est ré-appliqué ici, avec les MÊMES
// prédicats (`deriveFerme(...) === fermeFilter` fail-closed sur 'Autre', et
// `filterMirrorRowsByCulture` pour le chef Myrtille). Tout appelant interne DOIT
// passer le périmètre de l'utilisateur : l'omettre revient à servir toutes les
// fermes.
//
// 🔒 CLÉ DE CACHE À TROIS DIMENSIONS (base, ferme, culture) — corrigé PAR ce lot.
// L'inline d'origine ne passait que `fermeFilter` à pointageCacheKey, alors que
// le payload est filtré ferme ET culture. `withCache` écrit dans un cache
// Firestore PARTAGÉ (cf. l'avertissement de pointageCacheKey) : deux périmètres
// qui ne diffèrent que par la culture se retrouvaient donc sur LA MÊME entrée.
// Tant que le seul appelant était le handler HTTP, le trou restait théorique.
// L'extraction l'ARME : buildCampagneExportXlsx appelle désormais cette
// fonction avec des paramètres libres, et un appel LOT B `fermeFilter='F5',
// cultureFilter=null` écrirait sous la clé `…_F5` un payload TOUTES cultures
// que le chef Myrtille (F5 + culture_filtre='Myrtille') relirait tel quel
// pendant 30 min — fuite hors périmètre, persistante et inter-instances.
// Ajouter la dimension n'est pas un changement de comportement produit : c'est
// fermer le trou que l'extraction ouvre. Aucun autre site n'utilise cette base
// de clé (aucun warm path) ; seul un chef Myrtille subit un recalcul à froid,
// une fois.
//
// ⚠️ NE JAMAIS retirer le 3e argument. Le verrou est
// tests/unit/campagne-analytique-cache-key.test.js, qui espionne la clé
// RÉELLEMENT passée à withCache depuis CE site d'appel et devient rouge si la
// dimension culture (ou ferme) disparaît. tests/unit/pointage-cache-key.test.js
// ne suffit pas : il appelle pointageCacheKey directement et reste vert quoi
// qu'il arrive ici (vérifié par mutation).
//
// @param {string|null} fermeFilter   'F1'|'F5'|'Avocatier'|'BAHIA' ou null (all)
// @param {string|null} cultureFilter 'Myrtille'|'Framboise' ou null
async function computeCampagneAnalytiqueDetail(fermeFilter = null, cultureFilter = null) {
  const today = new Date();
  const y = today.getFullYear();
  const startYear = today.getMonth() >= 6 ? y : y - 1;
  const campagne = {
    start: `${startYear}-07-01`,
    end: `${startYear + 1}-06-30`,
    label: `${startYear}/${startYear + 1}`,
  };

  // Reconstruction locale du shadow des fetchers (cf. bloc GATING de pointageRH).
  const keepPointage = fermeFilter
    ? (r) => deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale, campagneOf(r.DateStr) || undefined) === fermeFilter
    : () => true;
  const keepCulture = cultureFilter
    ? (r) => filterMirrorRowsByCulture([r], cultureFilter).length > 0
    : () => true;
  const fetchRowsForDate = (fermeFilter || cultureFilter)
    ? async (d) => (await getPointageRowsForDate(d)).filter(r => keepPointage(r) && keepCulture(r))
    : getPointageRowsForDate;

  await warmRefTaches();

  return withCache(
    // v2 : ajout de `nbOuv` par ligne. Sans bump de clé, une réponse v1
    // encore en cache (TTL 30 min) servirait des lignes sans `nbOuv` et
    // la colonne « Ouvriers » de la pop-up afficherait 0 sans erreur.
    // v3 : + `coutCharge` et `jhSansTaux` par ligne. Sans bump, une réponse v2
    // encore en cache servirait des lignes SANS coût chargé, et la grille en
    // mode Coût DH afficherait 0 partout — sans erreur, ce qui est le pire.
    // v4 : les TAUX changent de valeur (le transport était résolu à 0, son tarif
    // ne vivant que dans `history`). Le payload garde la même FORME : sans bump,
    // rien ne casse et la grille sert simplement l'ancien coût, amputé — un
    // chiffre faux et plausible, le seul genre qu'on ne repère pas à l'œil.
    pointageCacheKey(`campagne_analytique_detail_v4_${campagne.start}`, fermeFilter, cultureFilter),
    30 * 60 * 1000,
    async () => {
      // TAUX PAR OUVRIER — il valorise chaque ligne au coût de L'OUVRIER qui l'a
      // faite, au lieu d'une moyenne d'établissement appliquée à tout le monde.
      // Même calcul que l'écran Quinzaine : un seul chemin, caché 30 min.
      //
      // Indisponible (BEE ONE muet, registre vide) → `coutCharge` reste à 0 et
      // l'écran affiche « — » ; JAMAIS un repli sur le `Cout` BEE ONE, qui
      // ferait passer un coût nu pour un coût chargé.
      let tauxParOuvrier = {};
      try {
        const co = await computeCampagneCoutOuvrier();
        tauxParOuvrier = (co && co.tauxParOuvrier) || {};
      } catch (e) {
        console.warn('campagne-analytique-detail : taux ouvrier indisponible —', e.message);
      }

      const meta = await getPointageMeta();
      const allPeriodes = (meta?.allPeriodes || []).filter(p => {
        const dates = (meta?.periodeMap?.[p] || []);
        return dates.some(d => d >= campagne.start && d <= campagne.end);
      });

      // Lire toutes les rows miroir de la campagne — granularité parcelle×quinzaine×opération
      const rows = [];

      for (const periode of allPeriodes) {
        const dates = (meta?.periodeMap?.[periode] || []).filter(d => d >= campagne.start && d <= campagne.end);
        for (let i = 0; i < dates.length; i += 10) {
          const batch = dates.slice(i, i + 10);
          const batchResults = await Promise.all(batch.map(d => fetchRowsForDate(d)));
          for (const dayRows of batchResults) {
            // Grouper par (parcelle, periode, operation, groupe) pour réduire le volume
            const groups = {};
            for (const r of dayRows) {
              const famille = resolveFamily(r.Operation_Groupe, r.Operation_Famille);
              const key = `${(r.Parcelle_Culturale || '').trim()}|${(r.Ref_parcelle || '').trim()}|${periode}|${(r.Operation || '').trim()}|${(r.Operation_Groupe || '').trim()}`;
              if (!groups[key]) groups[key] = {
                parcelle: (r.Parcelle_Culturale || '').trim(),
                refParcelle: (r.Ref_parcelle || '').trim(),
                ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
                periode,
                operation: (r.Operation || '').trim(),
                groupe: (_refMap[r.Operation_Groupe] || {}).groupe || '',
                famille,
                code: (r.Operation_Groupe || '').trim(),
                jh: 0,
                cout: 0,
                // Coût CHARGÉ : Σ (JH × taux de l'ouvrier). C'est ce que la
                // grille affiche en mode Coût DH.
                coutCharge: 0,
                // JH dont l'ouvrier n'a pas de taux (absent du registre de paie).
                // Remonté pour que l'écran puisse le DIRE : un coût partiel
                // affiché sans mention se lit comme un coût complet.
                jhSansTaux: 0,
                // Matricules DISTINCTS du groupe (jamais un compteur : un
                // ouvrier pointé deux fois sur la même opération le même
                // jour ne compte qu'une fois). Remplacé par `nbOuv` avant
                // le push — un Set sérialiserait en `{}`.
                workers: new Set(),
              };
              groups[key].jh += r.Nombre_Jr || 0;
              // `cout` reste servi : ce n'est PAS un coût, c'est le témoin
              // BEE ONE du panneau de rapprochement (il mesure ce que la grille
              // ne rattache à aucune parcelle). Aucun écran ne doit l'afficher
              // comme de l'argent.
              groups[key].cout += r.Cout || 0;
              const _t = tauxParOuvrier[String(r.Personnel_Matricule || '').trim() + '|' + periode];
              if (_t) groups[key].coutCharge += (r.Nombre_Jr || 0) * _t;
              else groups[key].jhSansTaux += r.Nombre_Jr || 0;
              if (r.Personnel_Matricule) groups[key].workers.add(r.Personnel_Matricule);
            }
            for (const g of Object.values(groups)) {
              g.nbOuv = g.workers.size;
              delete g.workers;
              rows.push(g);
            }
          }
        }
      }

      // Enrichir avec Ha depuis sb_parcelle_referentiel
      const refSnap = await db_firestore.collection('sb_parcelle_referentiel').get();
      const haByRef = {};
      refSnap.forEach(doc => {
        const d = doc.data();
        if (d.label_bee_one && d.ha) haByRef[d.label_bee_one.trim().toUpperCase()] = d.ha;
      });

      // Liste triée des périodes présentes
      const periodeSet = new Set(rows.map(r => r.periode));
      const periodes = [...periodeSet].sort();

      // Liste des familles depuis référentiel complet
      const refData = await loadReferentielTaches();
      const famillesOrdered = [...new Set(refData.ops.map(o => o.famille))];

      return {
        success: true,
        campagne: campagne.label,
        periodes,
        famillesOrdered,
        haByRef,
        rows: rows.filter(r => r.jh > 0 || r.cout > 0),
      };
    }
  );
}


// =============================================
// buildCampagneExportXlsx : classeur Excel « Campagne » d'une culture, généré
// CÔTÉ SERVEUR, à l'identique du fichier produit par le navigateur.
//
// Assemble les quatre sources que l'écran assemble côté client :
//   1. le payload campagne-analytique-detail (computeCampagneAnalytiqueDetail) ;
//   2. le référentiel parcelle sb_parcelle_referentiel (nom SB, culture, ha) ;
//   3. les budgets JH/Ha de la campagne (sb_campagne_budget_jh), niveaux
//      FAMILLE et OPÉRATION ;
//   4. les surfaces BEE ONE (fetchBrParcelleSupMap) — 2ᵉ niveau de résolution
//      du `ha`, celui que le navigateur obtient via `parcelles-campagne-list`.
// Le rendu (structure + mise en forme ExcelJS) vit dans lib/campagneExport,
// module pur : ce wrapper ne fait QUE les lectures Firestore.
//
// ⚠️ PÉRIMÈTRE — fail-closed, comme partout ailleurs : `fermeFilter` et
// `cultureFilter` sont OBLIGATOIREMENT ceux de l'appelant. Les budgets sont
// filtrés avec les MÊMES prédicats que l'action campagne-budget-list
// (deriveFerme fail-closed sur 'Autre' + filterMirrorRowsByCulture).
//
// N'expose aucune Cloud Function : appelé en interne (LOT B — envoi WhatsApp).
//
// @param {*} params { culture, fermeFilter, cultureFilter, campagne }
// @returns {Promise<{fileName: string, buffer: Buffer, nbFeuilles: number}>}
// @throws {Error} culture manquante ou campagne invalide — JAMAIS de classeur
//   dégradé rendu en silence (cf. la garde en tête de fonction).
async function buildCampagneExportXlsx(params = {}) {
  const culture = params.culture;
  if (!culture) throw new Error("buildCampagneExportXlsx : culture requise");
  // ⚠️ ÉCHOUER BRUYAMMENT sur une campagne invalide, et le faire AVANT toute
  // lecture — même traitement que la culture manquante ci-dessus, et même
  // verdict que l'action HTTP campagne-budget-list, qui répond 400.
  // Ignorer le cas (ancien `if (campagneB)` autour de la lecture des budgets)
  // produisait un classeur SANS ERREUR dont les 4 colonnes de budget étaient
  // vides : c'est le pire mode de défaillance pour un fichier qui part
  // automatiquement, sans relecture humaine, chez les dirigeants — un rapport
  // « tout est à zéro » se lit comme une information, pas comme une panne. Le
  // job planifié du lot suivant doit pouvoir ALERTER plutôt qu'envoyer un
  // fichier faux.
  // Le défaut (`campagneCourante()`) est toujours valide : seul un
  // `params.campagne` explicitement malformé peut lever ici.
  const campagneB = campagneBudget.normCampagne(params.campagne || campagneCourante());
  if (!campagneB) {
    throw new Error(
      "buildCampagneExportXlsx : campagne invalide (" + String(params.campagne) + ")"
    );
  }
  const fermeFilter = params.fermeFilter || null;
  const cultureFilter = params.cultureFilter || null;

  const data = await computeCampagneAnalytiqueDetail(fermeFilter, cultureFilter);

  // Référentiel parcelle → { LABEL: { nom_sb, culture_sb, ha } }. Même clé de
  // jointure que haByRef (label BEE ONE trimé/majuscules).
  const refSnap = await db_firestore.collection('sb_parcelle_referentiel').get();
  const sbMap = {};
  refSnap.forEach((doc) => {
    const d = doc.data() || {};
    const key = String(d.label_bee_one || doc.id || '').trim().toUpperCase();
    if (!key) return;
    sbMap[key] = { nom_sb: d.nom_sb || '', culture_sb: d.culture_sb || '', ha: d.ha || 0 };
  });

  // Surfaces BEE ONE (BR_Parcelle.Sup_Parcelle_Culturale) — 2ᵉ niveau de
  // résolution du `ha`, exactement celui du navigateur : l'écran le reçoit via
  // `parcelles-campagne-list` (champ `sup`), qui appelle CE MÊME fetcher. Ses
  // clés sont des labels trimés ; on les remonte en MAJUSCULES, la clé de
  // jointure de l'export (cf. buildWorkbook.refKey).
  // Ne pas le charger revenait à sortir à 0 toute parcelle sans `ha` saisi au
  // référentiel SB, et avec elle sa colonne « / Ha » ET ses 4 colonnes de
  // budget — alors que le fichier du navigateur, lui, les remplit.
  // Résilient par construction (last-known-good persistant si le BDR est down).
  const supRaw = await fetchBrParcelleSupMap();
  const supByLabel = {};
  Object.keys(supRaw || {}).forEach((lbl) => {
    const key = String(lbl).trim().toUpperCase();
    if (key && Number(supRaw[lbl]) > 0) supByLabel[key] = Number(supRaw[lbl]);
  });

  // Budgets JH/Ha de la campagne (défaut : campagne courante) — les DEUX
  // niveaux, lus et normalisés EXACTEMENT comme l'action campagne-budget-list
  // qui alimente l'écran (mergeBudgets / canonicalizeOperationKeys +
  // mergeBudgetsOperations). Ne lire que `budgets` laisserait les 4 colonnes de
  // suivi budgétaire vides pour toute parcelle budgétée à la maille OPÉRATION —
  // alors que l'écran, lui, les remplit.
  // (`campagneB` est validé en tête de fonction — fail-fast, avant toute
  // lecture : ici il est forcément exploitable.)
  const budgetsByLabel = {};
  const opBudgetsByLabel = {};
  const snapB = await db_firestore.collection('sb_campagne_budget_jh')
    .where('campagne', '==', campagneB).get();
  const refListB = await loadReferentielTaches();
  const operationsConnuesListB = referentielOperationsConnues(refListB);
  snapB.forEach((doc) => {
    const d = doc.data() || {};
    const label = d.label_bee_one || '';
    if (!label) return;
    if (fermeFilter && deriveFerme(null, label, campagneB) !== fermeFilter) return;
    if (cultureFilter
      && filterMirrorRowsByCulture([{ Parcelle_Culturale: label }], cultureFilter).length === 0) return;
    const key = String(label).trim().toUpperCase();
    budgetsByLabel[key] = campagneBudget.mergeBudgets(d.budgets, {});
    opBudgetsByLabel[key] = campagneBudget.mergeBudgetsOperations(
      campagneBudget.canonicalizeOperationKeys(d.budgets_operations, operationsConnuesListB),
      {}
    );
  });

  return campagneExport.generateCampagneWorkbook({
    culture,
    data,
    fermeFilter,
    sbMap,
    supByLabel,
    budgetsByLabel,
    opBudgetsByLabel,
  });
}


// =============================================
async function warmAllPointageCaches() {
  if (!USE_MIRROR) {
    console.log("[cacheWarmer] Skipping — USE_MIRROR is false");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const meta = await getPointageMeta();
  const periodes = meta?.periodes || [];
  const results = [];

  // 1. Summary
  try {
    await withCache(pointageCacheKey(`pointage_summary_${today}`, null), 0, async () => {
      const submittedFermes = await getSubmittedFermes(today);
      const yesterdayStr = new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10);
      const weekStartStr = new Date(new Date(today).getTime() - 6 * 86400000).toISOString().slice(0, 10);
      const [todayRows, yesterdayRows, weekRows] = await Promise.all([
        getPointageRowsForDate(today),
        getPointageRowsForDate(yesterdayStr),
        getPointageRowsForDateRange(weekStartStr, today),
      ]);
      // Effectifs = OUVRIERS DISTINCTS par (ferme, type), dédupliqués sur les lignes brutes.
      const fermes = countDistinctByFermeType(todayRows.map(r => ({
        matricule: r.Personnel_Matricule,
        ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
        type: classifyType(r.Operation_Famille),
        cout: r.Cout || 0,
      })), POINTAGE_FERMES);
      // Veille = même méthode distincte (sinon variation faussée : distinct vs gonflé).
      const veilleEffectif = countDistinctByFermeType(yesterdayRows.map(r => ({
        matricule: r.Personnel_Matricule,
        ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
        type: classifyType(r.Operation_Famille),
        cout: r.Cout || 0,
      })), POINTAGE_FERMES);
      const fermesYesterday = { F1: { total: veilleEffectif.F1.total }, F5: { total: veilleEffectif.F5.total }, Avocatier: { total: veilleEffectif.Avocatier.total }, BAHIA: { total: veilleEffectif.BAHIA.total } };
      for (const f of Object.keys(submittedFermes)) {
        const snapData = await getSnapshotData(today, f);
        if (snapData && snapData.summary && fermes[f]) fermes[f] = snapData.summary;
      }
      const pointageJour = Object.keys(fermes).map(f => {
        const e = fermes[f];
        // total = ouvriers DISTINCTS de la ferme tous types (Set ferme global) ; fallback
        // sur la somme pour les snapshots sans champ `total` (ancien format).
        const total = (typeof e.total === 'number') ? e.total : (e.recolte + e.horsRecolte + e.postesFixes);
        const veille = fermesYesterday[f] ? fermesYesterday[f].total : total;
        return { ferme: f, total, recolte: e.recolte, horsRecolte: e.horsRecolte, postesFixes: e.postesFixes, cout: Math.round(e.cout), veille, diff: veille > 0 ? Math.round(((total - veille) / veille) * 1000) / 10 : 0 };
      });
      const trendMap = {};
      for (const r of weekRows) {
        const key = r.DateStr;
        if (!trendMap[key]) trendMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short" }), F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
        const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
        if (trendMap[key][ferme]) trendMap[key][ferme].add(r.Personnel_Matricule);
      }
      const weeklyTrend = Object.values(trendMap).map(t => ({ jour: t.jour, jourLabel: t.jourLabel, F1: t.F1.size, F5: t.F5.size, Avocatier: t.Avocatier.size, BAHIA: t.BAHIA.size })).sort((a, b) => a.jour.localeCompare(b.jour));
      const recolteRows = todayRows.filter(r => r.Operation_Famille === "8. Récolte");
      const recolteWorkers = new Set(recolteRows.map(r => r.Personnel_Matricule));
      const recolteQty = recolteRows.reduce((s, r) => s + (r.Quantite_unite || 0), 0);
      const recolteCout = recolteRows.reduce((s, r) => s + (r.Cout || 0), 0);
      const syncStatus = await getSyncStatus();
      return { success: true, date: today, effectif: fermes, pointageJour, weeklyTrend, topOps: [], recolteTotal: { qty: recolteQty, nbOuv: recolteWorkers.size, cout: Math.round(recolteCout) }, lastSaisie: syncStatus?.lastSuccessAt || null, syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null };
    });
    results.push("summary:ok");
  } catch (e) { results.push(`summary:${e.message}`); }

  // 2. Detail
  try {
    await withCache(`pointage_detail_${today}_all`, 0, async () => {
      const rows = await fetchDetailFromMirror(today);
      return { success: true, date: today, rows, count: rows.length };
    });
    results.push("detail:ok");
  } catch (e) { results.push(`detail:${e.message}`); }

  // 3. Recolte
  try {
    await withCache(pointageCacheKey(`pointage_recolte_${today}`, null), 0, async () => {
      const [pointageRows, cueilletteRows] = await Promise.all([
        getPointageRowsForDate(today),
        getCueilletteRows(today, today),
      ]);
      const cGroups = {};
      for (const r of cueilletteRows.filter(r => r.Operation_Famille === "8. Récolte")) {
        const key = `${r.Parcelle_Culturale}|${r.Variete}`;
        if (!cGroups[key]) cGroups[key] = { parcelle: (r.Parcelle_Culturale || "").trim(), variete: r.Variete, refTech: (r.Reference_Technique || "").trim(), totalKg: 0, totalCaisses: 0 };
        cGroups[key].totalKg += r.Poids_total_kg || 0;
        cGroups[key].totalCaisses += r.Nbre_Caisse || 0;
      }
      const cueillette = Object.values(cGroups).map(c => ({ ...c, ferme: deriveFerme(c.refTech || null, c.parcelle) })).sort((a, b) => b.totalKg - a.totalKg);
      const workers = pointageRows.filter(r => r.Operation_Famille === "8. Récolte").map((r, i) => ({
        rank: i + 1, matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
        operation: r.Operation, quantite: quantiteToKg(r.Quantite_unite, r.Operation),
        heures: r.Nombre_Hr, cout: r.Cout, parcelle: (r.Parcelle_Culturale || "").trim(),
        ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: r.Variete,
      })).sort((a, b) => b.quantite - a.quantite || a.nom.localeCompare(b.nom));
      workers.forEach((w, i) => { w.rank = i + 1; });
      const totalKgCueillette = cueillette.reduce((s, c) => s + c.totalKg, 0);
      return { success: true, date: today, workers, cueillette, totalKgCueillette, count: workers.length };
    });
    results.push("recolte:ok");
  } catch (e) { results.push(`recolte:${e.message}`); }

  // 4. Quinzaine (latest)
  //
  // BUG FIX (2026-08-06) : ce warmer écrit dans la MÊME clé Firestore
  // (`pointage_quinzaine_latest`, via pointageCacheKey) que le handler live de
  // l'action "quinzaine" (cf. ~ligne 2454 : cacheKey basé sur le même nom pour
  // _fermeFilter/_cultureFilter null, i.e. profils DG/Finance/RH sans ?periode).
  // Le handler live inclut `periodeCampagne` (+ `parCulture`) dans sa réponse
  // depuis les commits 929c526/5b51ff0, mais CE warmer ne les calculait pas :
  // toutes les 10 minutes (pubsub schedule), il écrasait le cache partagé avec
  // un payload INCOMPLET, privant pendant tout son TTL (5 min) le frontend de
  // periodeCampagne — casse silencieusement tout sélecteur "Campagne" qui en
  // dépend (Affectation Analytique) sans qu'aucune erreur ne soit levée.
  // Fix : aligner strictement la forme du payload sur le handler live.
  try {
    await withCache(pointageCacheKey("pointage_quinzaine_latest", null), 0, async () => {
      const selectedPeriode = periodes[0];
      let periodeCampagne = (meta && meta.periodeCampagne) || {};
      if (Object.keys(periodeCampagne).length === 0 && meta?.periodeMap) {
        periodeCampagne = buildPeriodeCampagne(meta.periodeMap, campagneOf);
      }
      if (!selectedPeriode) return { success: true, periode: null, periodes, periodeCampagne, totalJournees: 0, totalCout: 0, parFerme: [], parJour: [] };
      const rows = await getPointageRowsForPeriode(selectedPeriode);
      const qFermes = { F1: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, F5: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, Avocatier: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, BAHIA: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 } };
      for (const r of rows) { const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale); const type = classifyType(r.Operation_Famille); if (qFermes[ferme]) { qFermes[ferme].journees += r.Nombre_Jr || 0; qFermes[ferme].cout += r.Cout || 0; qFermes[ferme][type] += r.Nombre_Jr || 0; } }
      const dayMap = {};
      for (const r of rows) {
        const key = r.DateStr;
        if (!dayMap[key]) dayMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), nbOuv: new Set(), journees: 0, cout: 0, F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
        dayMap[key].nbOuv.add(r.Personnel_Matricule); dayMap[key].journees += r.Nombre_Jr || 0; dayMap[key].cout += r.Cout || 0;
        const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
        if (dayMap[key][ferme]) dayMap[key][ferme].add(r.Personnel_Matricule);
      }
      const perDay = Object.values(dayMap).map(d => ({ jour: d.jour, jourLabel: d.jourLabel, nbOuv: d.nbOuv.size, journees: d.journees, cout: d.cout, F1: d.F1.size, F5: d.F5.size, Avocatier: d.Avocatier.size, BAHIA: d.BAHIA.size })).sort((a, b) => a.jour.localeCompare(b.jour));
      const totalJournees = Object.values(qFermes).reduce((s, f) => s + f.journees, 0);
      const totalCout = Object.values(qFermes).reduce((s, f) => s + f.cout, 0);
      const parCulture = buildParCulture(rows);
      return { success: true, periode: selectedPeriode, periodes, periodeCampagne, totalJournees: Math.round(totalJournees), totalCout: Math.round(totalCout), parFerme: Object.entries(qFermes).map(([f, d]) => ({ ferme: f, journees: Math.round(d.journees), cout: Math.round(d.cout), recolte: Math.round(d.recolte), horsRecolte: Math.round(d.horsRecolte), postesFixes: Math.round(d.postesFixes) })), parJour: perDay, parCulture };
    });
    results.push("quinzaine:ok");
  } catch (e) { results.push(`quinzaine:${e.message}`); }

  // 4b. Quinzaine-analytique (latest)
  try {
    await withCache(pointageCacheKey("pointage_quinzaine_analytique_latest", null), 0, async () => {
      const selectedPeriode = periodes[0];
      if (!selectedPeriode) return { success: true, periode: null, periodes, rows: [] };
      const rawRows = await getPointageRowsForPeriode(selectedPeriode);
      const groups = {};
      for (const r of rawRows) {
        const key = `${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Operation_Famille}|${r.Operation}`;
        if (!groups[key]) groups[key] = { Parcelle_Culturale: r.Parcelle_Culturale, Ref_parcelle: r.Ref_parcelle, Operation_Famille: r.Operation_Famille, Operation_Groupe: r.Operation_Groupe, Operation: r.Operation, workers: new Set(), JH: 0, Cout: 0 };
        groups[key].workers.add(r.Personnel_Matricule);
        groups[key].JH += r.Nombre_Jr || 0;
        groups[key].Cout += r.Cout || 0;
      }
      const rows = Object.values(groups).map(g => ({ parcelle: (g.Parcelle_Culturale || '').trim(), refParcelle: (g.Ref_parcelle || '').trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale), operationFamille: g.Operation_Famille, operationGroupe: g.Operation_Groupe || '', operation: g.Operation, nbOuv: g.workers.size, jh: Math.round(g.JH * 100) / 100, cout: Math.round(g.Cout) }));
      return { success: true, periode: selectedPeriode, periodes, rows };
    });
    results.push("quinzaine-analytique:ok");
  } catch (e) { results.push(`quinzaine-analytique:${e.message}`); }

  // 4c. Quinzaine-repos (latest)
  try {
    await withCache(pointageCacheKey("pointage_quinzaine_repos_latest", null), 0, async () => {
      const selectedPeriode = periodes[0];
      if (!selectedPeriode) return { success: true, periode: null, equipes: [], nbJoursQuinzaine: 0 };
      const quinzaineDates = (meta?.periodeMap?.[selectedPeriode] || []).sort();
      const rawRows = await getPointageRowsForPeriode(selectedPeriode);
      const nbJoursQuinzaine = quinzaineDates.length;
      const equipeMap = {};
      for (const row of rawRows) {
        const mat = (row.Personnel_Matricule || '').trim();
        const prefix = mat.substring(0, 2).toUpperCase();
        const jour = row.DateStr || new Date(row.jour).toISOString().slice(0, 10);
        if (!equipeMap[prefix]) equipeMap[prefix] = {};
        if (!equipeMap[prefix][mat]) equipeMap[prefix][mat] = { matricule: mat, nom: (row.Personnel_Nom || '').trim(), joursPresent: new Set() };
        equipeMap[prefix][mat].joursPresent.add(jour);
      }
      const equipes = Object.entries(equipeMap).map(([prefix, workers]) => {
        const workerList = Object.values(workers).map(w => { const nbPresent = w.joursPresent.size; const nbRepos = nbJoursQuinzaine - nbPresent; return { matricule: w.matricule, nom: w.nom, nbPresent, nbRepos, nbJoursQuinzaine }; });
        const totalRepos = workerList.reduce((s, w) => s + w.nbRepos, 0);
        const moyRepos = workerList.length > 0 ? Math.round((totalRepos / workerList.length) * 10) / 10 : 0;
        return { prefix, nbOuvriers: workerList.length, moyRepos, nbJoursQuinzaine, workers: workerList.sort((a, b) => b.nbRepos - a.nbRepos) };
      }).sort((a, b) => a.prefix.localeCompare(b.prefix));
      return { success: true, periode: selectedPeriode, periodes, nbJoursQuinzaine, quinzaineDates, equipes };
    });
    results.push("quinzaine-repos:ok");
  } catch (e) { results.push(`quinzaine-repos:${e.message}`); }

  // 4d. Quinzaine-alertes (latest)
  try {
    await withCache(pointageCacheKey("pointage_quinzaine_alertes_latest", null), 0, async () => {
      const selectedPeriode = periodes[0];
      if (!selectedPeriode) return { success: true, periode: null, alertes: [] };
      const quinzaineDates = (meta?.periodeMap?.[selectedPeriode] || []).sort();
      const rawRows = await getPointageRowsForPeriode(selectedPeriode);
      const presenceMap = {};
      for (const r of rawRows) {
        const prefix = (r.Personnel_Matricule || '').trim().substring(0, 2).toUpperCase();
        if (!presenceMap[prefix]) presenceMap[prefix] = new Set();
        presenceMap[prefix].add(r.DateStr);
      }
      const alertes = [];
      Object.entries(presenceMap).forEach(([prefix, presentDays]) => {
        let streak = 0, streakStart = null;
        for (let i = 0; i < quinzaineDates.length; i++) {
          const d = quinzaineDates[i];
          if (!presentDays.has(d)) { if (streak === 0) streakStart = d; streak++; }
          else { if (streak >= 5) alertes.push({ equipePrefix: prefix, joursAbsents: streak, dateDebut: streakStart, dateFin: quinzaineDates[i - 1], message: `Équipe ${prefix} absente depuis plus de 5 jours (${streak} jours consécutifs du ${streakStart} au ${quinzaineDates[i - 1]})` }); streak = 0; streakStart = null; }
        }
        if (streak >= 5) alertes.push({ equipePrefix: prefix, joursAbsents: streak, dateDebut: streakStart, dateFin: quinzaineDates[quinzaineDates.length - 1], message: `Équipe ${prefix} absente depuis plus de 5 jours (${streak} jours consécutifs du ${streakStart} au ${quinzaineDates[quinzaineDates.length - 1]})` });
      });
      alertes.sort((a, b) => b.joursAbsents - a.joursAbsents);
      return { success: true, periode: selectedPeriode, periodes, quinzaineDates, alertes };
    });
    results.push("quinzaine-alertes:ok");
  } catch (e) { results.push(`quinzaine-alertes:${e.message}`); }

  // 5. Recolte-equipes
  // ⚠️ Anti-divergence (régression rCbmEuXS) : le warm DOIT enrichir kg depuis prod_tracabilite_recolte
  // ET appliquer shouldCacheRecolteEquipes, comme le serving. Auparavant le warm cachait un payload
  // brut (kg=0 car quantiteToKg=0 sur « Récolte ») sans garde-fou → graphe Coût Récolte vide servi 5 min.
  // TTL=0 force le recalcul ; shouldCacheRecolteEquipes empêche d'écrire un payload dégradé.
  try {
    await withCache("pointage_recolte_equipes_all", 0, () => computeRecolteEquipesPayload(3), shouldCacheRecolteEquipes);
    results.push("recolte-equipes:ok");
  } catch (e) { results.push(`recolte-equipes:${e.message}`); }

  // 6. Transport
  try {
    await withCache(pointageCacheKey("pointage_transport", null), 0, async () => {
      const targetPeriodes = periodes.slice(0, 2);
      const allRows = [];
      for (const p of targetPeriodes) { allRows.push(...await getPointageRowsForPeriode(p)); }
      const groups = {};
      for (const r of allRows) {
        const key = `${r.Personnel_Matricule}|${r.DateStr}|${r.Periode_paie}|${r.Operation_Famille}|${r.Operation}|${r.Ref_parcelle}`;
        if (!groups[key]) {
          groups[key] = { Personnel_Matricule: r.Personnel_Matricule, Personnel_Nom: r.Personnel_Nom, DateStr: r.DateStr, Periode_paie: r.Periode_paie, Operation_Famille: r.Operation_Famille, Operation: r.Operation, Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, Nombre_Hr: 0, Cout: 0 };
        }
        groups[key].Nombre_Hr += r.Nombre_Hr || 0;
        groups[key].Cout += r.Cout || 0;
      }
      const rows = Object.values(groups).map(r => ({ matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: r.DateStr, periode: r.Periode_paie, operationFamille: (r.Operation_Famille || "").trim(), operation: (r.Operation || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), parcelle: (r.Parcelle_Culturale || "").trim(), refParcelle: (r.Ref_parcelle || "").trim(), heures: r.Nombre_Hr || 0, cout: Math.round(r.Cout || 0) }));
      const holidays = await getJoursFeries();
      const extras = computeChargCond(allRows, holidays);
      return { success: true, periodes, rows, ...extras };
    });
    results.push("transport:ok");
  } catch (e) { results.push(`transport:${e.message}`); }

  // 6b. Heures supplémentaires
  try {
    await withCache("pointage_heures_sup_all", 0, async () => {
      const excludedFonctions = await getExcludedFonctionsHS();
      return await buildHeuresSup(meta, excludedFonctions);
    });
    results.push("heures-sup:ok");
  } catch (e) { results.push(`heures-sup:${e.message}`); }

  // 7. Nouveaux ouvriers
  try {
    await withCache(pointageCacheKey("pointage_nouveaux_ouvriers", null), 0, async () => {
      const currentPeriode = periodes[0];
      if (!currentPeriode) return { success: true, periode: null, summary: { totalQuinzaine: 0, totalToday: 0, byFarm: {}, byDay: [] }, workers: [] };
      const periodeDates = meta?.periodeMap?.[currentPeriode] || [];
      const qStart = periodeDates[0] || null;
      const qEnd = periodeDates[periodeDates.length - 1] || null;
      const targetPeriodes = periodes.slice(0, 2);
      const firstAppearance = {};
      for (const p of [...targetPeriodes].reverse()) {
        const pRows = await getPointageRowsForPeriode(p);
        for (const r of pRows) {
          const mat = (r.Personnel_Matricule || "").trim();
          if (!firstAppearance[mat]) firstAppearance[mat] = { date: r.DateStr, nom: (r.Personnel_Nom || "").trim(), Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, Operation_Famille: r.Operation_Famille };
        }
      }
      const byFarm = {}; const byDayMap = {};
      const workers = Object.entries(firstAppearance)
        .filter(([_, info]) => qStart && info.date >= qStart)
        .map(([mat, info]) => {
          const ferme = deriveFerme(info.Ref_parcelle, info.Parcelle_Culturale);
          byFarm[ferme] = (byFarm[ferme] || 0) + 1;
          byDayMap[info.date] = (byDayMap[info.date] || 0) + 1;
          return { matricule: mat, nom: info.nom, firstDate: info.date, ferme, equipe: mat.substring(0, 2), operationFamille: info.Operation_Famille || "" };
        })
        .sort((a, b) => b.firstDate.localeCompare(a.firstDate) || a.nom.localeCompare(b.nom));
      const totalToday = workers.filter(w => w.firstDate === today).length;
      const byDay = Object.entries(byDayMap).map(([jour, count]) => ({ jour, count })).sort((a, b) => b.jour.localeCompare(a.jour));
      return { success: true, periode: currentPeriode, quinzaineStart: qStart, quinzaineEnd: qEnd, summary: { totalQuinzaine: workers.length, totalToday, byFarm, byDay }, workers };
    });
    results.push("nouveaux-ouvriers:ok");
  } catch (e) { results.push(`nouveaux-ouvriers:${e.message}`); }

  // 8. Hors-récolte
  try {
    await withCache(pointageCacheKey(`pointage_hors_recolte_${today}`, null), 0, async () => {
      const rawRows = await getPointageRowsForDate(today);
      const filtered = rawRows.filter(r => r.Operation_Famille !== "8. Récolte" && r.Operation_Famille !== "11. Postes fixes");
      const groups = {};
      for (const r of filtered) {
        const key = `${r.Operation_Famille}|${r.Operation}|${r.Ref_parcelle}|${r.Parcelle_Culturale}`;
        if (!groups[key]) groups[key] = { Operation_Famille: r.Operation_Famille, Operation: r.Operation, Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, workers: new Set(), totalHr: 0, totalJr: 0, totalCout: 0 };
        groups[key].workers.add(r.Personnel_Matricule);
        groups[key].totalHr += r.Nombre_Hr || 0;
        groups[key].totalJr += r.Nombre_Jr || 0;
        groups[key].totalCout += r.Cout || 0;
      }
      const ops = Object.values(groups).map(g => ({ operationFamille: g.Operation_Famille, operation: g.Operation, effectif: g.workers.size, heures: g.totalHr, journees: g.totalJr, cout: Math.round(g.totalCout), parcelle: (g.Parcelle_Culturale || "").trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale) })).sort((a, b) => b.effectif - a.effectif);
      return { success: true, date: today, operations: ops };
    });
    results.push("hors-recolte:ok");
  } catch (e) { results.push(`hors-recolte:${e.message}`); }

  // 9. Suivi-tunnels (per ferme)
  try {
    for (const ferme of ['F1', 'F5', 'Avocatier']) {
      await withCache(`pointage_suivi_tunnels_${today}_${ferme}`, 0, async () => {
        const yesterdayStr = new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10);
        const thirtyDaysAgo = new Date(new Date(today).getTime() - 30 * 86400000).toISOString().slice(0, 10);
        const [todayRows, cumulRows] = await Promise.all([
          getPointageRowsForDate(today),
          getPointageRowsForDateRange(thirtyDaysAgo, yesterdayStr),
        ]);
        const filterHR = r => r.Operation_Famille !== "8. Récolte" && r.Operation_Famille !== "11. Postes fixes";
        const todayGroups = {};
        for (const r of todayRows.filter(filterHR)) {
          const key = `${r.Operation}|${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Variete}`;
          if (!todayGroups[key]) todayGroups[key] = { ...r, workers: new Set(), quantiteRealisee: 0, totalHr: 0, totalJr: 0, totalCout: 0 };
          todayGroups[key].workers.add(r.Personnel_Matricule);
          todayGroups[key].quantiteRealisee += r.Quantite_unite || 0;
          todayGroups[key].totalHr += r.Nombre_Hr || 0;
          todayGroups[key].totalCout += r.Cout || 0;
        }
        const cumulMap = {};
        for (const r of cumulRows.filter(filterHR)) {
          const key = `${(r.Parcelle_Culturale || '').trim()}_${r.Operation}`;
          if (!cumulMap[key]) cumulMap[key] = { quantiteCumul: 0, joursCumul: 0 };
          cumulMap[key].quantiteCumul += r.Quantite_unite || 0;
          cumulMap[key].joursCumul += r.Nombre_Jr || 0;
        }
        const byFerme = {};
        for (const g of Object.values(todayGroups)) {
          const f = deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale);
          if (f !== ferme) continue;
          if (!byFerme[f]) byFerme[f] = [];
          const parcelle = (g.Parcelle_Culturale || '').trim();
          const cumul = cumulMap[`${parcelle}_${g.Operation}`] || { quantiteCumul: 0 };
          byFerme[f].push({ parcelle, variete: g.Variete || parcelle, tache: g.Operation, nbOuvriers: g.workers.size, realiseAujourdhui: Math.round(g.quantiteRealisee), dejaRealise: Math.round(cumul.quantiteCumul), totalRealise: Math.round(cumul.quantiteCumul + g.quantiteRealisee), heures: g.totalHr, cout: Math.round(g.totalCout), ferme: f });
        }
        return { success: true, date: today, tunnels: byFerme };
      });
    }
    results.push("suivi-tunnels:ok");
  } catch (e) { results.push(`suivi-tunnels:${e.message}`); }

  console.log(`[cacheWarmer] Results: ${results.join(", ")}`);
  return results;
}


// =============================================
// GATING PAIE (Étape 0) — actions EXEMPTÉES de la barrière nominative
// =============================================
// Déclarée au niveau MODULE (et exportée) pour être vérifiable par un test
// unitaire : le contrat d'accès est une surface de sécurité, il ne doit pas
// pouvoir dériver silencieusement. Voir tests/unit/pointageGatingExempt.test.js.
//
// Une action n'entre ici que si sa RÉPONSE est intégralement NON NOMINATIVE :
// aucun matricule, aucun nom d'ouvrier, aucun montant/coût, aucune donnée paie.
// L'authentification reste exigée en amont dans tous les cas (/api/pointage-rh
// passe requireAuth via pointageV3, idem la délégation /api/validation).
// L'exemption ne porte QUE sur la LECTURE : toute action d'ÉCRITURE reste gatée
// par son propre contrôle de rôle DG/RH/admin (cf. sb-referentiel-save,
// sb-groupe-save/-delete), et n'a rien à faire dans cette table.
//
//  - 'suivi-tunnels'  : agrégats de PROGRESSION par parcelle/tâche (effectifs,
//    quantités) pour l'écran « Tunnels » du caporal — pas un listing paie ;
//    déjà cloisonné côté client par ?ferme=.
//  - 'confection-types' / 'referentiel-taches-list' : simples référentiels
//    d'opérations/tâches, non nominatifs.
//  - 'sb-groupes-list' : référentiel des GROUPES de parcelles (labels + Ha),
//    non nominatif, nécessaire au MAGASINIER pour le popup Bon de Consommation
//    (le gating paie refuserait ce profil).
//  - 'parcelles-campagne-list' : référentiel des PARCELLES classées par campagne
//    (courante / précédente), nécessaire au MAGASINIER pour le même popup Bon de
//    Consommation — sans lui, la modale retombe silencieusement sur /api/parcelles
//    qui agrège l'historique BR_Consommation de la campagne PRÉCÉDENTE, et le
//    magasinier ne trouve plus les parcelles de la campagne en cours.
//    Réponse strictement descriptive : par parcelle, uniquement
//    { ref, label, culture, variete, ferme, sup, debut, fin } — soit la référence
//    et le libellé BEE ONE de la parcelle, sa culture/variété, sa ferme dérivée,
//    sa surface en Ha (BR_Parcelle.Sup_Parcelle_Culturale) et les bornes de dates
//    de pointage. Aucun matricule, aucun nom de personne, aucun coût, aucune
//    journée-homme. Les deux branches (SQL BR_Pointage et mirror Firestore)
//    construisent le MÊME objet à 8 champs — vérifié champ par champ.
//    ⚠ Exemptée du 403 SEULEMENT : elle reste CLOISONNÉE (cf. EXEMPT_BUT_SCOPED).
//  - 'sb-referentiel-list' : référentiel des NOMS Smart Berry (nom_sb), des
//    surfaces (ha) et de la culture SB (culture_sb), clé par le label BEE ONE.
//    C'est la source des noms affichés PARTOUT dans l'app ; sans elle, une
//    parcelle s'affiche sous son libellé BEE ONE brut, et une parcelle dont
//    `culture_sb` diverge de sa culture BEE ONE devient invisible dès qu'un
//    filtre « Culture » est posé (cas du bon de consommation du magasinier).
//    ⚠ DIFFÉRENCE DE TRAITEMENT ASSUMÉE avec 'parcelles-campagne-list' : cette
//    action n'est volontairement PAS dans EXEMPT_BUT_SCOPED. Décision produit
//    (Omar) : TOUS les profils doivent voir les noms Smart Berry. Cloisonner un
//    référentiel de NOMS casserait précisément cet objectif — et lire le nom
//    d'une parcelle d'une autre ferme est sans conséquence (aucun matricule,
//    aucun montant, aucune journée-homme).
//    Ce qui est cloisonné ici, ce n'est pas la LISTE mais la PROJECTION : les
//    champs de traçabilité `updated_by` (uid + profileId d'un utilisateur) et
//    `updated_at` ne sont servis QU'AUX profils déjà autorisés par
//    resolvePointageRHAccess. Cf. projectSbReferentielDoc ci-dessous.
const GATING_EXEMPT_ACTIONS = {
  "suivi-tunnels": true,
  "confection-types": true,
  "referentiel-taches-list": true,
  "sb-groupes-list": true,
  "parcelles-campagne-list": true,
  "sb-referentiel-list": true,
};


// Sous-ensemble de GATING_EXEMPT_ACTIONS : actions exemptées du 403 mais dont le
// CLOISONNEMENT ferme/culture d'un chef DOIT rester appliqué.
//
// Une exemption « nue » ne saute pas que le 403 : elle saute TOUTE la résolution
// de périmètre, donc `_fermeFilter`/`_cultureFilter` restent null et les fetchers
// ne sont plus shadowés. Pour une action listant des parcelles, ça élargit le
// périmètre d'un chef (un chef_f5 verrait toutes les fermes / toutes les
// cultures) — pas une fuite nominative, mais un changement de cloisonnement.
//
// Pour ces actions on résout donc le périmètre comme d'habitude, et on n'utilise
// l'exemption que pour NE PAS renvoyer 403 quand le profil n'est pas autorisé
// (magasinier) : il obtient alors la liste non filtrée, ce qui est le
// comportement voulu pour le popup Bon de Consommation.
//
// Les 4 exemptions historiques (suivi-tunnels, confection-types,
// referentiel-taches-list, sb-groupes-list) ne sont volontairement PAS ici : les
// y mettre changerait le comportement de l'écran caporal (hors périmètre).
//
// 'sb-referentiel-list' n'est PAS ici non plus, et c'est délibéré : c'est un
// référentiel de NOMS que tous les profils doivent voir en entier (décision
// produit). Voir le commentaire de GATING_EXEMPT_ACTIONS ci-dessus.
const EXEMPT_BUT_SCOPED = { "parcelles-campagne-list": true };


// ---- Projection de sb_parcelle_referentiel ---------------------------------
// Champs RÉELLEMENT présents dans un document `sb_parcelle_referentiel`
// (écrit par `sb-referentiel-save` et `sb-referentiel-seed-ha`, seuls writers) :
//   label_bee_one : string  — libellé BEE ONE de la parcelle           → PUBLIC
//   nom_sb        : string  — nom Smart Berry                          → PUBLIC
//   ha            : number  — surface Smart Berry                      → PUBLIC
//   culture_sb    : string  — culture Smart Berry (Myrtille/…)         → PUBLIC
//   seeded_from   : string  — provenance de l'initialisation des Ha    → RÉSERVÉ
//   updated_by    : {uid, profileId} d'un utilisateur Smart Berry      → RÉSERVÉ
//   updated_at    : Timestamp de dernière modification                 → RÉSERVÉ
// (+ `id` = docId, ajouté par le handler, utilisé côté client comme clé de repli
//  quand `label_bee_one` est absent — cf. app.jsx / ParcellesReferentielTab).
//
// Aucune de ces données n'est de la paie, mais élargir l'accès à TOUS les profils
// ne doit pas diffuser des identifiants d'utilisateur : on projette donc une
// liste blanche pour les profils qui n'avaient PAS accès avant ce correctif.
const SB_REFERENTIEL_PUBLIC_FIELDS = ['id', 'label_bee_one', 'nom_sb', 'ha', 'culture_sb'];


/**
 * Projette un document du référentiel selon le profil appelant. PURE.
 *
 * @param {Object} doc document complet `{ id, ...doc.data() }`.
 * @param {boolean} fullAccess true = profil DÉJÀ autorisé avant ce correctif
 *   (resolvePointageRHAccess(...).allowed : dg/finance/rh/admin/chef résolu) →
 *   document intégral, aucune régression pour l'écran « Parcelles & Référentiel ».
 *   false = profil nouvellement admis (magasinier, chef non résolu, …) →
 *   sous-ensemble SB_REFERENTIEL_PUBLIC_FIELDS uniquement.
 * @returns {Object}
 */
function projectSbReferentielDoc(doc, fullAccess) {
  const d = doc || {};
  if (fullAccess === true) return d;
  const out = {};
  for (const f of SB_REFERENTIEL_PUBLIC_FIELDS) {
    if (d[f] !== undefined) out[f] = d[f];
  }
  return out;
}


/**
 * Projection de `sb-referentiel-list` pour un appelant dont le périmètre a été
 * résolu. PURE — c'est LA décision du handler, extraite pour être testée telle
 * quelle (même motif que gatingRequiresPerimetre / resolveGatingFilters : un test
 * qui recopierait la décision ne protégerait rien).
 *
 * Aucun 403 ici : l'action est exemptée, tout le monde reçoit la LISTE ENTIÈRE.
 * Seule la richesse de chaque document dépend du profil.
 *
 * @param {Object} doc document complet `{ id, ...doc.data() }`.
 * @param {{autorise?:boolean, perimetre_ferme?:string}|null} perim sortie de resolvePerimetre.
 * @returns {Object}
 */
function projectSbReferentielForCaller(doc, perim) {
  return projectSbReferentielDoc(doc, resolvePointageRHAccess(perim).allowed);
}


/**
 * Faut-il résoudre le périmètre de l'appelant (verifyAuth + resolvePerimetre)
 * pour cette action ? PURE — c'est la décision du handler, extraite pour être
 * testable telle quelle (un test qui la recopierait ne protégerait rien).
 *
 * false ⇒ action exemptée « nue » : le bloc de gating est entièrement sauté,
 * aucun verifyAuth n'est effectué (comportement historique de l'écran caporal).
 *
 * @param {string} action
 * @returns {boolean}
 */
function gatingRequiresPerimetre(action) {
  return !GATING_EXEMPT_ACTIONS[action] || EXEMPT_BUT_SCOPED[action] === true;
}
module.exports = { EXEMPT_BUT_SCOPED, GATING_EXEMPT_ACTIONS, SB_REFERENTIEL_PUBLIC_FIELDS, buildCampagneExportXlsx, computeCampagneAnalytiqueDetail, computeCampagneCoutOuvrier, computeRecolteEquipesPayload, createSnapshot, fetchDetailFromSQL, fetchPostesFixesFromSQL, fetchSummaryFromSQL, gatingRequiresPerimetre, getSnapshotData, getSubmittedFermes, projectSbReferentielDoc, projectSbReferentielForCaller, shouldCacheRecolteEquipes, warmAllPointageCaches };
