/* Actions 2/4 de pointageRH — corps repris VERBATIM.
   Le contexte du handler arrive par `ctx` ; la destructuration ci-dessous
   recree exactement les liaisons d'origine. */
'use strict';
const { NOT_HANDLED } = require("./pointageService.dispatch");

module.exports = async function pointageServiceActions2(ctx) {
  const { req, res, action, dateParam, _fermeFilter, _cultureFilter, _keepPointage, _keepCulture, _keepCueillette, getPointageRowsForDate, getPointageRowsForDateRange, getPointageRowsForPeriode, getWorkerHistory, getCueilletteRows, db } = ctx;

  // Corps VERBATIM : ces noms venaient du scope englobant de l'ancien monolithe
  // pointageRH avant l'eclatement (commit 8a7284c). require() PAREsseux (pas en
  // haut de fichier) car pointageService.part1.js require CE fichier pour
  // construire __actions -- un require en tete de fichier recevrait un exports
  // encore vide (cycle). Les 5 fetchers gates (getPointageRowsForDate etc.)
  // restent EXCLUS d'ici : ils viennent de ctx (version filtree ferme/culture,
  // voir pointageService.js), jamais de la version brute de part1.
  const { HS_SEUIL_MINUTES, JOURS_FERIES_FALLBACK, POINTAGE_FERMES, REFERENTIEL_FAMILLES, REFERENTIEL_TTL_MS, USE_MIRROR, _getCueilletteRows, _getPointageRowsForDate, _getPointageRowsForDateRange, _getPointageRowsForPeriode, _getWorkerHistory, _qtkWarned, _refMap, _refTachesCache, _refTachesCacheAt, _referentielCache, _referentielLoadedAt, _supMapLastGood, admin, aggregateParcellesFromMirror, archiveDocRef, buildHalfToPeriode, buildHeuresSup, buildParCulture, buildPeriodeCampagne, campagneBudget, campagneBudgetCulture, campagneCourante, campagneExport, campagneOf, classifyType, computeAllowedMatricules, computeChargCond, computeDurationOvertime, consoAccessControl, consoBons, cors, countDistinctByFermeType, coutOuvrier, coutQuinzaineSnap, db_firestore, dedupeWorkersByMatricule, defaultPeriode, defaultPeriodeForCampagne, deriveFerme, detectFramboiseSubType, enrichRowsWithHaRef, fetchBrParcelleSupMap, fetchDetailFromMirror, fetchPostesFixesFromMirror, fetchSummaryFromMirror, fichierPaieStore, filterArchivedParFerme, filterArchivedParJour, filterArchivedRowsByFerme, filterByFermeField, filterMirrorRowsByCulture, filterMirrorRowsByFerme, filterPresenceRowsByAllowed, filterProdRowsByFerme, filterReposWorkersArchived, filterRowsByExactDates, findJourApres, findJourAvant, functions, getAvailableDates, getExcludedFonctionsHS, getJoursFeries, getPointageMeta, getPool, getSyncStatus, halfKey, invalidateReferentielCache, isSansEquipe, isValidCampagneLabel, loadReferentielCache, loadReferentielTaches, mapMirrorRowToDetail, mergeReferentiel, parcelleGroupSeedHa, parcelleGroupSplit, parcelleGroupValidate, pointageCacheKey, pool, quantiteToKg, recomposeArchivedTotals, recomposeProdTotalKg, referentielOperationsConnues, resolveCallerProfile, resolveFamily, resolveFermeFromParcelle, resolveHolidayPeriode, resolveMyrtilleVariete, resolvePointageRHAccess, resolveVariete, shouldExcludeWorkerDay, splitCompositeLabel, sql, sqlConfig, syncPointageFromProd, verifyAuth, warmRefTaches, withCache } = require("./pointageService.part1");
  // Idem, mais depuis pointageService.part2.js (memes contraintes de cycle :
  // part1.js require() ce fichier pour construire __actions, donc PAS de
  // require top-level de part2.js non plus). Bug trouve et corrige le
  // 2026-09-14 (production readiness) en meme temps que withCache/USE_MIRROR
  // ci-dessus -- meme classe de regression (8a7284c), noms restes libres apres
  // l'eclatement. Detecte par un passage ESLint no-undef sur tout functions/,
  // pas manuellement -- confirme qu'aucune autre occurrence du meme bug ne
  // trainait ailleurs dans les fichiers actions1-4.js.
  const { computeCampagneAnalytiqueDetail, computeCampagneCoutOuvrier, getSubmittedFermes, getSnapshotData, projectSbReferentielForCaller } = require("./pointageService.part2");


      // ------ HEURES-SUP: durée travaillée + dépassement 8h30 par quinzaine ------
      if (action === "heures-sup") {
        // GATING PAIE : clé de cache + payload cloisonnés par ferme du chef.
        const hsCacheSuffix = _fermeFilter || 'all';
        const cached = await withCache(`pointage_heures_sup_${hsCacheSuffix}`, 0, async () => {
          const metaHS = await getPointageMeta();
          const excludedFonctions = await getExcludedFonctionsHS();
          return await buildHeuresSup(metaHS, excludedFonctions, _fermeFilter);
        });
        return res.json(cached);
      }


      // ------ DATES: available dates ------
      if (action === "dates") {
        if (USE_MIRROR) {
          const availDates = await getAvailableDates(30);
          // For each date, we need nbOuv — read from mirror docs
          const dates = [];
          for (let i = 0; i < availDates.length; i += 10) {
            const batch = availDates.slice(i, i + 10);
            const results = await Promise.all(batch.map(async d => {
              const rows = await getPointageRowsForDate(d);
              const workers = new Set(rows.map(r => r.Personnel_Matricule));
              return { date: d, nbOuv: workers.size };
            }));
            dates.push(...results);
          }
          return res.json({ success: true, dates });
        }
        // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). Le chemin mirror compte
        // nbOuv via getPointageRowsForDate shadowé (déjà filtré ferme). Pour rester
        // cloisonnable, on ramène les couples DISTINCTS (jour, matricule, parcelle),
        // on filtre par la ferme du chef, puis on compte les matricules DISTINCTS par
        // jour en JS. _fermeFilter null (RH/DG/Finance) → passthrough (tous comptés).
        const result = await db.request().query(`SELECT DISTINCT CONVERT(date, Periode_Date) AS jour, Personnel_Matricule, Ref_parcelle, Parcelle_Culturale FROM BR_Pointage WHERE CONVERT(date, Periode_Date) >= DATEADD(day, -60, CONVERT(date, GETDATE()))`);
        const dateSets = {};
        for (const r of filterMirrorRowsByCulture(filterMirrorRowsByFerme(result.recordset, _fermeFilter), _cultureFilter)) {
          const key = new Date(r.jour).toISOString().slice(0, 10);
          if (!dateSets[key]) dateSets[key] = new Set();
          if (r.Personnel_Matricule) dateSets[key].add(r.Personnel_Matricule);
        }
        const dates = Object.entries(dateSets)
          .map(([date, workers]) => ({ date, nbOuv: workers.size }))
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 30);
        return res.json({ success: true, dates });
      }


      // ------ NOUVEAUX OUVRIERS: new workers detected in current quinzaine ------
      if (action === "nouveaux-ouvriers") {
        // Clé ferme-aware : la liste nominative des nouveaux ouvriers dépend de
        // _fermeFilter. La période est toujours la quinzaine courante (meta.periodes[0]).
        const cached = await withCache(pointageCacheKey("pointage_nouveaux_ouvriers", _fermeFilter), 5 * 60 * 1000, async () => {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const currentPeriode = meta?.periodes?.[0];
          if (!currentPeriode) return { success: true, periode: null, summary: { totalQuinzaine: 0, totalToday: 0, byFarm: {}, byDay: [] }, workers: [] };
          const periodeDates = meta?.periodeMap?.[currentPeriode] || [];
          const qStart = periodeDates[0] || null;
          const qEnd = periodeDates[periodeDates.length - 1] || null;
          // Load only current + previous periode to find first appearances (not ALL dates)
          const targetPeriodes = (meta?.periodes || []).slice(0, 2);
          const firstAppearance = {}; // matricule → first date
          for (const p of targetPeriodes.reverse()) { // oldest first
            const pRows = await getPointageRowsForPeriode(p);
            for (const r of pRows) {
              const mat = (r.Personnel_Matricule || "").trim();
              if (!firstAppearance[mat]) firstAppearance[mat] = { date: r.DateStr, nom: (r.Personnel_Nom || "").trim(), Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, Operation_Famille: r.Operation_Famille };
            }
          }
          // Filter workers whose first appearance >= qStart
          const today = new Date().toISOString().slice(0, 10);
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
        }
        // SQL fallback
        const periodeRes = await db.request().query(`SELECT TOP 1 Periode_paie FROM BR_Pointage ORDER BY Periode_Date DESC`);
        const currentPeriode = (periodeRes.recordset[0] || {}).Periode_paie;
        if (!currentPeriode) return { success: true, periode: null, summary: { totalQuinzaine: 0, totalToday: 0, byFarm: {}, byDay: [] }, workers: [] };
        const result = await db.request().query(`WITH QuinzaineBounds AS (SELECT MIN(CONVERT(date, Periode_Date)) AS q_start, MAX(CONVERT(date, Periode_Date)) AS q_end FROM BR_Pointage WHERE Periode_paie = N'${currentPeriode.replace(/'/g, "''")}'), WorkerFirst AS (SELECT Personnel_Matricule, MIN(Personnel_Nom) AS Personnel_Nom, MIN(CONVERT(date, Periode_Date)) AS first_date FROM BR_Pointage GROUP BY Personnel_Matricule HAVING MIN(CONVERT(date, Periode_Date)) >= (SELECT q_start FROM QuinzaineBounds)), WorkerFirstDetail AS (SELECT w.Personnel_Matricule, w.Personnel_Nom, w.first_date, p.Ref_parcelle, p.Parcelle_Culturale, p.Operation_Famille FROM WorkerFirst w OUTER APPLY (SELECT TOP 1 Ref_parcelle, Parcelle_Culturale, Operation_Famille FROM BR_Pointage WHERE Personnel_Matricule = w.Personnel_Matricule AND CONVERT(date, Periode_Date) = w.first_date) p) SELECT *, (SELECT q_start FROM QuinzaineBounds) AS q_start, (SELECT q_end FROM QuinzaineBounds) AS q_end FROM WorkerFirstDetail ORDER BY first_date DESC, Personnel_Nom`);
        // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). Chaque worker porte
        // Ref_parcelle/Parcelle_Culturale (première apparition) → ferme dérivable. On
        // filtre les LIGNES BRUTES par la ferme du chef AVANT agrégation (byFarm/byDay/
        // workers nominatifs). Fail-closed : ferme dérivée ≠ _fermeFilter → exclue.
        // _fermeFilter null (RH/DG/Finance) → passthrough strict (inchangé).
        // _cultureFilter non null (chef_f5) → filtre culture additionnel après ferme.
        const rows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(result.recordset, _fermeFilter), _cultureFilter);
        const today = new Date().toISOString().slice(0, 10);
        const qStart = rows.length > 0 ? new Date(rows[0].q_start).toISOString().slice(0, 10) : null;
        const qEnd = rows.length > 0 ? new Date(rows[0].q_end).toISOString().slice(0, 10) : null;
        const byFarm = {}; const byDayMap = {};
        const workers = rows.map(r => { const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale); const fd = new Date(r.first_date).toISOString().slice(0, 10); byFarm[ferme] = (byFarm[ferme] || 0) + 1; byDayMap[fd] = (byDayMap[fd] || 0) + 1; return { matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), firstDate: fd, ferme, equipe: (r.Personnel_Matricule || "").trim().substring(0, 2), operationFamille: r.Operation_Famille || "" }; });
        const totalToday = workers.filter(w => w.firstDate === today).length;
        const byDay = Object.entries(byDayMap).map(([jour, count]) => ({ jour, count })).sort((a, b) => b.jour.localeCompare(a.jour));
        return { success: true, periode: currentPeriode, quinzaineStart: qStart, quinzaineEnd: qEnd, summary: { totalQuinzaine: workers.length, totalToday, byFarm, byDay }, workers };
        }); // end withCache
        return res.json(cached);
      }


      // ------ WORKER-DETAIL: full BEE ONE info for a worker ------
      if (action === "worker-detail") {
        const matricule = req.query.matricule;
        if (!matricule) return res.status(400).json({ success: false, error: "matricule required" });

        let rows;
        if (USE_MIRROR) {
          const mirrorRows = await getWorkerHistory(matricule);
          rows = mirrorRows.sort((a, b) => (b.DateStr || "").localeCompare(a.DateStr || ""));
          // Map to expected shape
          rows = rows.map(r => ({ Personnel_Matricule: r.Personnel_Matricule, Personnel_Nom: r.Personnel_Nom, Operation_Famille: r.Operation_Famille, Operation: r.Operation, Operation_Groupe: r.Operation_Groupe, Nombre_Jr: r.Nombre_Jr, Nombre_Hr: r.Nombre_Hr, Quantite_unite: r.Quantite_unite, Cout: r.Cout, Parcelle_Culturale: r.Parcelle_Culturale, Ref_parcelle: r.Ref_parcelle, Variete: r.Variete, Culture: r.Culture, Periode_paie: r.Periode_paie, jour: r.DateStr, HS_25: r.HS_25, HS_50: r.HS_50, HS_100: r.HS_100 }));
        } else {
          const result = await db.request().query(`SELECT Personnel_Matricule, Personnel_Nom, Operation_Famille, Operation, Operation_Groupe, Nombre_Jr, Nombre_Hr, Quantite_unite, Cout, Parcelle_Culturale, Ref_parcelle, Variete, Culture, Periode_paie, CONVERT(date, Periode_Date) AS jour, HS_25, HS_50, HS_100, HS_NM FROM BR_Pointage WHERE Personnel_Matricule = N'${(matricule || '').replace(/'/g, "''")}' ORDER BY Periode_Date DESC`);
          // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). L'historique complet
          // d'un ouvrier peut couvrir plusieurs fermes. On ne garde que les LIGNES de la
          // ferme du chef (ferme dérivable via parcelle), comme le chemin mirror via
          // getWorkerHistory shadowé → si l'ouvrier n'a jamais pointé la ferme du chef,
          // rows vide → worker: null. _fermeFilter null (RH/DG/Finance) → passthrough.
          rows = filterMirrorRowsByFerme(result.recordset, _fermeFilter);
        }

        if (rows.length === 0) return res.json({ success: true, worker: null });
        const first = rows[rows.length - 1]; const last = rows[0];
        const totalJours = rows.reduce((s, r) => s + (r.Nombre_Jr || 0), 0);
        const totalHeures = rows.reduce((s, r) => s + (r.Nombre_Hr || 0), 0);
        const totalCout = rows.reduce((s, r) => s + (r.Cout || 0), 0);
        const totalQte = rows.reduce((s, r) => s + (r.Quantite_unite || 0), 0);
        const periodes = [...new Set(rows.map(r => r.Periode_paie))];
        const operations = [...new Set(rows.map(r => r.Operation_Famille).filter(Boolean))];
        const parcelles = [...new Set(rows.map(r => r.Ref_parcelle).filter(Boolean))];
        const jourStr = r => typeof r.jour === 'string' ? r.jour.slice(0, 10) : new Date(r.jour).toISOString().slice(0, 10);
        const jours = [...new Set(rows.map(r => jourStr(r)))].sort();
        return res.json({ success: true, worker: {
          matricule: (first.Personnel_Matricule || '').trim(), nom: (first.Personnel_Nom || '').trim(),
          premierJour: jourStr(first), dernierJour: jourStr(last),
          ferme: deriveFerme(first.Ref_parcelle, first.Parcelle_Culturale),
          equipe: (first.Personnel_Matricule || '').trim().substring(0, 2),
          totalJours: Math.round(totalJours * 10) / 10, totalHeures: Math.round(totalHeures * 10) / 10,
          totalCout: Math.round(totalCout), totalQuantite: Math.round(totalQte * 10) / 10,
          nbPeriodes: periodes.length, periodes, operations, parcelles, nbJoursDistincts: jours.length,
          historique: rows.slice(0, 30).map(r => ({ jour: jourStr(r), periode: r.Periode_paie, operation: r.Operation_Famille, operationDetail: r.Operation, parcelle: r.Ref_parcelle, culture: r.Culture, variete: r.Variete, heures: r.Nombre_Hr, jours: r.Nombre_Jr, quantite: r.Quantite_unite, cout: r.Cout })),
        }});
      }


      // ------ QUINZAINE-REPOS: average rest days per team per quinzaine ------
      if (action === "quinzaine-repos") {
        const periodeParamR = req.query.periode;
        // Clé ferme-aware : les équipes/ouvriers nominatifs dépendent de _fermeFilter.
        const cacheKeyR = pointageCacheKey(`pointage_quinzaine_repos_${periodeParamR || "latest"}`, _fermeFilter);
        const cachedR = await withCache(cacheKeyR, 5 * 60 * 1000, async () => {
        let periodes, selectedPeriode, quinzaineDates, rawRows;
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          periodes = meta?.periodes || [];
          selectedPeriode = periodeParamR || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, equipes: [], nbJoursQuinzaine: 0 };
          quinzaineDates = (meta?.periodeMap?.[selectedPeriode] || []).sort();
          rawRows = await getPointageRowsForPeriode(selectedPeriode);
          // Garde-fou label composite : ne jamais faire confiance au seul matching par
          // label entre deux campagnes qui réutilisent le même numéro de quinzaine.
          if (splitCompositeLabel(selectedPeriode).isComposite) {
            rawRows = filterRowsByExactDates(rawRows, meta?.periodeMap?.[selectedPeriode]);
          }
          // If mirror has no data, check archive
          if (rawRows.length === 0 && quinzaineDates.length === 0) {
            const archiveDoc = await archiveDocRef(selectedPeriode).get();
            if (archiveDoc.exists && archiveDoc.data().reposData) {
              const rd = archiveDoc.data().reposData;
              quinzaineDates = rd.quinzaineDates;
              rawRows = [];
              // GATING PAIE (chef) : reposData.workers = matricule+nom TOUTES fermes,
              // NOMINATIF, sans champ ferme ni parcelle exploitable. L'archive ne conserve
              // AUCUNE source ferme pour restreindre ces workers (contrairement au mirror).
              // DÉCISION fail-closed (zéro fuite nominative) : un chef ne voit PAS le
              // nominatif repos cross-ferme d'une période archivée → workers vidé.
              // _fermeFilter null (RH/DG/Finance) → passthrough (inchangé).
              for (const w of filterReposWorkersArchived(rd.workers, _fermeFilter)) {
                for (const d of w.joursPresent) {
                  rawRows.push({ Personnel_Matricule: w.matricule, Personnel_Nom: w.nom, DateStr: d });
                }
              }
            }
          }
        } else {
          const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
          periodes = periodesRes.recordset.map(r => r.Periode_paie);
          selectedPeriode = periodeParamR || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, equipes: [], nbJoursQuinzaine: 0 };
          // Label composite jamais présent en SQL brut (Periode_paie) — matcher le label brut.
          const { rawLabel: selectedRawLabelR } = splitCompositeLabel(selectedPeriode);
          const datesRes = await db.request().query(`SELECT DISTINCT CONVERT(date, Periode_Date) AS jour FROM BR_Pointage WHERE Periode_paie = N'${(selectedRawLabelR || '').replace(/'/g, "''")}' ORDER BY jour`);
          quinzaineDates = datesRes.recordset.map(r => new Date(r.jour).toISOString().slice(0, 10));
          const workersRes = await db.request().query(`SELECT Personnel_Matricule, MIN(Personnel_Nom) AS Personnel_Nom, CONVERT(date, Periode_Date) AS jour FROM BR_Pointage WHERE Periode_paie = N'${(selectedRawLabelR || '').replace(/'/g, "''")}' GROUP BY Personnel_Matricule, CONVERT(date, Periode_Date) ORDER BY Personnel_Matricule`);
          // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). Cette requête N'inclut
          // PAS de parcelle/refParcelle → la ferme n'est PAS dérivable pour ces lignes
          // repos nominatives. DÉCISION fail-closed (zéro fuite nominative), cohérente
          // avec filterReposWorkersArchived : un chef ne voit PAS le nominatif repos
          // cross-ferme (rawRows vidé). _fermeFilter null (RH/DG/Finance) → passthrough.
          rawRows = _fermeFilter
            ? []
            : workersRes.recordset.map(r => ({ Personnel_Matricule: r.Personnel_Matricule, Personnel_Nom: r.Personnel_Nom, DateStr: new Date(r.jour).toISOString().slice(0, 10) }));
        }
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
        }); // end withCache
        return res.json(cachedR);
      }


      // ------ QUINZAINE-ALERTES: teams absent 5+ consecutive days ------
      if (action === "quinzaine-alertes") {
        const periodeParamA = req.query.periode;
        // Clé ferme-aware : les alertes d'équipe dépendent des lignes filtrées par _fermeFilter.
        const cacheKeyA = pointageCacheKey(`pointage_quinzaine_alertes_${periodeParamA || "latest"}`, _fermeFilter);
        const cachedA = await withCache(cacheKeyA, 5 * 60 * 1000, async () => {
        let periodes, selectedPeriode, quinzaineDates, presenceMap;
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          periodes = meta?.periodes || [];
          selectedPeriode = periodeParamA || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, alertes: [] };
          quinzaineDates = (meta?.periodeMap?.[selectedPeriode] || []).sort();
          let rawRows = await getPointageRowsForPeriode(selectedPeriode);
          // Garde-fou label composite : ne jamais faire confiance au seul matching par
          // label entre deux campagnes qui réutilisent le même numéro de quinzaine.
          if (splitCompositeLabel(selectedPeriode).isComposite) {
            rawRows = filterRowsByExactDates(rawRows, meta?.periodeMap?.[selectedPeriode]);
          }
          if (rawRows.length > 0) {
            presenceMap = {};
            for (const r of rawRows) {
              const prefix = (r.Personnel_Matricule || '').trim().substring(0, 2).toUpperCase();
              if (!presenceMap[prefix]) presenceMap[prefix] = new Set();
              presenceMap[prefix].add(r.DateStr);
            }
          } else {
            // Check Firestore archive
            const archiveDoc = await archiveDocRef(selectedPeriode).get();
            if (archiveDoc.exists && archiveDoc.data().alertesData) {
              const ad = archiveDoc.data().alertesData;
              quinzaineDates = ad.quinzaineDates;
              presenceMap = {};
              // GATING PAIE (chef) : presenceByPrefix est keyé par préfixe d'équipe
              // (2 premiers caractères du matricule). Un préfixe d'équipe n'est PAS
              // cloisonné par ferme et AUCUN mapping préfixe→ferme n'existe côté serveur
              // (le mirror dérive la ferme via la PARCELLE, absente de l'archive alertes).
              // Un préfixe peut donc révéler l'activité d'une équipe d'une autre ferme.
              // DÉCISION fail-closed : pour un chef, on n'expose PAS les alertes d'équipe
              // d'une période archivée (presenceMap vidé → aucune alerte).
              // _fermeFilter null (RH/DG/Finance) → tous les préfixes (inchangé).
              if (!_fermeFilter) {
                for (const [prefix, days] of Object.entries(ad.presenceByPrefix)) {
                  presenceMap[prefix] = new Set(days);
                }
              }
            } else {
              presenceMap = {};
            }
          }
        } else {
          const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
          periodes = periodesRes.recordset.map(r => r.Periode_paie);
          selectedPeriode = periodeParamA || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, alertes: [] };
          // Label composite jamais présent en SQL brut (Periode_paie) — matcher le label brut.
          const { rawLabel: selectedRawLabelA } = splitCompositeLabel(selectedPeriode);
          const datesRes = await db.request().query(`SELECT DISTINCT CONVERT(date, Periode_Date) AS jour FROM BR_Pointage WHERE Periode_paie = N'${(selectedRawLabelA || '').replace(/'/g, "''")}' ORDER BY jour`);
          quinzaineDates = datesRes.recordset.map(r => new Date(r.jour).toISOString().slice(0, 10)).sort();
          const presenceRes = await db.request().query(`SELECT SUBSTRING(LTRIM(Personnel_Matricule), 1, 2) AS equipe_prefix, CONVERT(date, Periode_Date) AS jour, COUNT(DISTINCT Personnel_Matricule) AS nbOuv FROM BR_Pointage WHERE Periode_paie = N'${(selectedRawLabelA || '').replace(/'/g, "''")}' GROUP BY SUBSTRING(LTRIM(Personnel_Matricule), 1, 2), CONVERT(date, Periode_Date)`);
          presenceMap = {};
          // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). Les alertes sont keyées
          // par préfixe d'équipe (2 premiers car. du matricule) ; AUCUN mapping
          // préfixe→ferme n'existe (la ferme se dérive via la parcelle, absente ici).
          // DÉCISION fail-closed, cohérente avec le chemin archive : un chef ne voit PAS
          // les alertes d'équipe cross-ferme (presenceMap vidé → aucune alerte).
          // _fermeFilter null (RH/DG/Finance) → tous les préfixes (inchangé).
          if (!_fermeFilter) {
            for (const row of presenceRes.recordset) { const prefix = (row.equipe_prefix || '').toUpperCase(); if (!presenceMap[prefix]) presenceMap[prefix] = new Set(); presenceMap[prefix].add(new Date(row.jour).toISOString().slice(0, 10)); }
          }
        }
        // Find consecutive absent streaks >= 5 days
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
        }); // end withCache
        return res.json(cachedA);
      }


      // ------ MO-ANALYTIQUE-VARIETE: labor cost breakdown by variety across all quinzaines ------
      if (action === "mo-analytique-variete") {
        // Clé ferme-aware : les rows (jh/cout par parcelle) dépendent de _fermeFilter
        // via le shadow de getPointageRowsForPeriode.
        const cached = await withCache(pointageCacheKey("mo_analytique_variete", _fermeFilter), 30 * 60 * 1000, async () => {
          const meta = await getPointageMeta();
          const allPeriodes = meta?.allPeriodes || [];
          const mirrorPeriodes = meta?.periodes || [];

          // Accumulate analytique rows from all quinzaines (parallel reads)
          const allRows = [];

          // Split: mirror vs archived
          const mirrorPeriodesList = allPeriodes.filter(p => mirrorPeriodes.includes(p) && meta?.periodeMap?.[p]);
          const archivedPeriodesList = allPeriodes.filter(p => !mirrorPeriodes.includes(p) || !meta?.periodeMap?.[p]);

          // Read all archives in parallel
          const [mirrorResults, archiveDocs] = await Promise.all([
            Promise.all(mirrorPeriodesList.map(async (periode) => {
              const rawRows = await getPointageRowsForPeriode(periode);
              const groups = {};
              for (const r of rawRows) {
                const key = `${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Operation_Famille}`;
                if (!groups[key]) groups[key] = { parcelle: (r.Parcelle_Culturale || '').trim(), refParcelle: (r.Ref_parcelle || '').trim(), operationFamille: r.Operation_Famille, jh: 0, cout: 0 };
                groups[key].jh += r.Nombre_Jr || 0;
                groups[key].cout += r.Cout || 0;
              }
              return { periode, groups: Object.values(groups) };
            })),
            Promise.all(archivedPeriodesList.map(async (periode) => {
              const doc = await archiveDocRef(periode).get();
              return { periode, data: doc.exists ? doc.data().analytique : null };
            })),
          ]);

          for (const { periode, groups } of mirrorResults) {
            for (const g of groups) {
              allRows.push({ parcelle: g.parcelle, refParcelle: g.refParcelle, operationFamille: g.operationFamille, jh: g.jh, cout: g.cout, periode });
            }
          }
          for (const { periode, data } of archiveDocs) {
            if (data) {
              // GATING PAIE (chef) : le chemin archivé pousse toutes les fermes. Les
              // lignes archivées portent parcelle/refParcelle → ferme dérivable, donc
              // cloisonnable. Fail-closed : ferme dérivée ≠ _fermeFilter → exclue.
              // _fermeFilter null (RH/DG/Finance) → passthrough (inchangé).
              for (const row of filterArchivedRowsByFerme(data, _fermeFilter)) {
                allRows.push({ parcelle: row.parcelle, refParcelle: row.refParcelle, operationFamille: row.operationFamille, jh: row.jh, cout: row.cout, periode });
              }
            }
          }

          // Aggregate by variete
          const byVariete = {};
          const byQuinzaine = {};
          for (const row of allRows) {
            const resolved = resolveVariete(row.parcelle, row.refParcelle);
            const key = `${resolved.variete}|${resolved.ferme}`;
            const type = classifyType(row.operationFamille);

            if (!byVariete[key]) {
              byVariete[key] = {
                variete: resolved.variete, culture: resolved.culture, ferme: resolved.ferme,
                recolte: { jh: 0, cout: 0 }, horsRecolte: { jh: 0, cout: 0 }, postesFixes: { jh: 0, cout: 0 },
                total: { jh: 0, cout: 0 }, horsRecolteDetail: {},
              };
            }
            byVariete[key][type].jh += row.jh || 0;
            byVariete[key][type].cout += row.cout || 0;
            byVariete[key].total.jh += row.jh || 0;
            byVariete[key].total.cout += row.cout || 0;

            // Accumulate horsRecolte breakdown by operation family
            if (type === 'horsRecolte') {
              const opFam = row.operationFamille || 'Autre';
              if (!byVariete[key].horsRecolteDetail[opFam]) byVariete[key].horsRecolteDetail[opFam] = { jh: 0, cout: 0 };
              byVariete[key].horsRecolteDetail[opFam].jh += row.jh || 0;
              byVariete[key].horsRecolteDetail[opFam].cout += row.cout || 0;
            }

            // Par quinzaine
            if (!byQuinzaine[row.periode]) byQuinzaine[row.periode] = {};
            if (!byQuinzaine[row.periode][resolved.variete]) byQuinzaine[row.periode][resolved.variete] = 0;
            byQuinzaine[row.periode][resolved.variete] += row.cout || 0;
          }

          const parVariete = Object.values(byVariete)
            .map(v => {
              const hrDetail = {};
              for (const [op, val] of Object.entries(v.horsRecolteDetail || {})) {
                hrDetail[op] = { jh: Math.round(val.jh * 100) / 100, cout: Math.round(val.cout) };
              }
              return { ...v, recolte: { jh: Math.round(v.recolte.jh * 100) / 100, cout: Math.round(v.recolte.cout) }, horsRecolte: { jh: Math.round(v.horsRecolte.jh * 100) / 100, cout: Math.round(v.horsRecolte.cout) }, postesFixes: { jh: Math.round(v.postesFixes.jh * 100) / 100, cout: Math.round(v.postesFixes.cout) }, total: { jh: Math.round(v.total.jh * 100) / 100, cout: Math.round(v.total.cout) }, horsRecolteDetail: hrDetail };
            })
            .sort((a, b) => b.total.cout - a.total.cout);

          const totaux = parVariete.reduce((acc, v) => ({
            recolte: acc.recolte + v.recolte.cout, horsRecolte: acc.horsRecolte + v.horsRecolte.cout,
            postesFixes: acc.postesFixes + v.postesFixes.cout, total: acc.total + v.total.cout,
          }), { recolte: 0, horsRecolte: 0, postesFixes: 0, total: 0 });

          const parQuinzaine = allPeriodes.slice().reverse().map(p => ({
            periode: p, parVariete: byQuinzaine[p] || {},
          }));

          const periodeCampagne = (meta && meta.periodeCampagne) || {};
          return { success: true, parVariete, parQuinzaine, totaux, periodes: allPeriodes, periodeCampagne };
        });
        return res.json(cached);
      }


      // ------ CAMPAGNE-MO-VARIETE: cumulative labor cost by variety for current fiscal year (Jul→Jun) ------
      if (action === "campagne-mo-variete") {
        const today = new Date();
        const y = today.getFullYear();
        const startYear = today.getMonth() >= 6 ? y : y - 1;
        const campagne = {
          start: `${startYear}-07-01`,
          end: `${startYear + 1}-06-30`,
          label: `${startYear}-${startYear + 1} (Jul-Jun)`,
        };

        const cycle1End = `${startYear}-12-31`;
        const cycle2Start = `${startYear + 1}-01-01`;

        // Clé ferme-aware : les rows (jh/cout par parcelle) dépendent de _fermeFilter
        // via le shadow de getPointageRowsForDate/Periode.
        const cached = await withCache(pointageCacheKey(`campagne_mo_variete_v4_${campagne.start}`, _fermeFilter), 30 * 60 * 1000, async () => {
          const meta = await getPointageMeta();
          const allPeriodes = meta?.allPeriodes || [];
          const mirrorPeriodes = meta?.periodes || [];

          const mirrorPeriodesList = allPeriodes.filter(p => mirrorPeriodes.includes(p) && meta?.periodeMap?.[p]);
          const archivedPeriodesList = allPeriodes.filter(p => !mirrorPeriodes.includes(p) || !meta?.periodeMap?.[p]);

          // segments: each row tagged with cycle1Weight / cycle2Weight / annuelWeight
          // mirror rows: weight = 1 for the cycle the date belongs to, 0 for the other; 1 for annuel
          // archive rows: prorated by fraction of dates in each cycle within campagne range
          const taggedRows = []; // { parcelle, refParcelle, operationFamille, jh, cout, w1, w2, wA }

          // 1. Mirror periodes
          const mirrorResults = await Promise.all(mirrorPeriodesList.map(async (periode) => {
            const dates = (meta.periodeMap[periode] || []).filter(d => d >= campagne.start && d <= campagne.end);
            const out = [];
            for (let i = 0; i < dates.length; i += 10) {
              const batch = dates.slice(i, i + 10);
              const batchResults = await Promise.all(batch.map(d => getPointageRowsForDate(d).then(rows => ({ d, rows }))));
              for (const { d, rows: rawRows } of batchResults) {
                const inCycle1 = d <= cycle1End ? 1 : 0;
                const inCycle2 = d >= cycle2Start ? 1 : 0;
                // group per-date to reduce row count
                const groups = {};
                for (const r of rawRows) {
                  const key = `${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Operation_Famille}`;
                  if (!groups[key]) groups[key] = { parcelle: (r.Parcelle_Culturale || '').trim(), refParcelle: (r.Ref_parcelle || '').trim(), operationFamille: r.Operation_Famille, jh: 0, cout: 0 };
                  groups[key].jh += r.Nombre_Jr || 0;
                  groups[key].cout += r.Cout || 0;
                }
                for (const g of Object.values(groups)) {
                  out.push({ ...g, w1: inCycle1, w2: inCycle2, wA: 1 });
                }
              }
            }
            return out;
          }));
          for (const arr of mirrorResults) for (const r of arr) taggedRows.push(r);

          // 2. Archive periodes — prorate per cycle
          const archiveDocs = await Promise.all(archivedPeriodesList.map(async (periode) => {
            const doc = await archiveDocRef(periode).get();
            if (!doc.exists) return null;
            const d = doc.data();
            const analytique = d.analytique;
            if (!analytique) return null;
            const allDates = (d.reposData && d.reposData.quinzaineDates) || (d.alertesData && d.alertesData.quinzaineDates) || (meta?.periodeMap?.[periode]) || [];
            const datesInCampagne = allDates.filter(dt => dt >= campagne.start && dt <= campagne.end);
            const datesInCycle1 = datesInCampagne.filter(dt => dt <= cycle1End);
            const datesInCycle2 = datesInCampagne.filter(dt => dt >= cycle2Start);
            const total = allDates.length || datesInCampagne.length || 1;
            const fA = datesInCampagne.length / total;
            const f1 = datesInCycle1.length / total;
            const f2 = datesInCycle2.length / total;
            if (fA === 0) return null;
            return { f1, f2, fA, analytique };
          }));
          for (const result of archiveDocs) {
            if (!result) continue;
            // GATING PAIE (chef) : même cloisonnement fail-closed que mo-analytique-variete
            // sur le chemin archivé (ferme dérivée via parcelle/refParcelle).
            // _fermeFilter null (RH/DG/Finance) → passthrough (inchangé).
            for (const row of filterArchivedRowsByFerme(result.analytique, _fermeFilter)) {
              taggedRows.push({
                parcelle: row.parcelle,
                refParcelle: row.refParcelle,
                operationFamille: row.operationFamille,
                jh: row.jh || 0,
                cout: row.cout || 0,
                w1: result.f1,
                w2: result.f2,
                wA: result.fA,
              });
            }
          }

          // 3. Aggregate per segment per variete
          function emptyBucket(resolved) {
            return {
              variete: resolved.variete, culture: resolved.culture, ferme: resolved.ferme,
              recolte: { jh: 0, cout: 0 }, horsRecolte: { jh: 0, cout: 0 }, postesFixes: { jh: 0, cout: 0 },
              total: { jh: 0, cout: 0 }, kgRecolte: 0,
            };
          }
          const seg = { cycle1: {}, cycle2: {}, annuel: {} };
          for (const row of taggedRows) {
            const resolved = resolveVariete(row.parcelle, row.refParcelle);
            const key = `${resolved.variete}|${resolved.ferme}`;
            const type = classifyType(row.operationFamille);
            for (const [segName, w] of [['cycle1', row.w1], ['cycle2', row.w2], ['annuel', row.wA]]) {
              if (!w) continue;
              if (!seg[segName][key]) seg[segName][key] = emptyBucket(resolved);
              const b = seg[segName][key];
              const jhW = row.jh * w;
              const coutW = row.cout * w;
              b[type].jh += jhW;
              b[type].cout += coutW;
              b.total.jh += jhW;
              b.total.cout += coutW;
            }
          }

          // 4. Kg récolté par variété (from prod_tracabilite_recolte) per segment
          //    Doc IDs are YYYY-MM-DD. Query the campagne range.
          const prodSnap = await db_firestore.collection("prod_tracabilite_recolte")
            .where(admin.firestore.FieldPath.documentId(), ">=", campagne.start)
            .where(admin.firestore.FieldPath.documentId(), "<=", campagne.end)
            .get();
          for (const docSnap of prodSnap.docs) {
            const dateStr = docSnap.id;
            const inCycle1 = dateStr <= cycle1End;
            const inCycle2 = dateStr >= cycle2Start;
            // GATING PAIE (fail-closed) : prod_tracabilite_recolte agrège TOUTES les
            // fermes → pour un chef, on ne garde que les lignes prod de sa ferme, sinon
            // des buckets (variété|ferme) d'autres fermes gonfleraient kgRecolte/totaux.
            // _fermeFilter null (RH/DG/Finance) → passthrough STRICT (inchangé).
            const rows = filterProdRowsByFerme(docSnap.data().rows || [], _fermeFilter);
            for (const r of rows) {
              const resolved = resolveVariete(r.variete || r.parcelle || '', r.refParcelle || '');
              const key = `${resolved.variete}|${resolved.ferme}`;
              const kg = r.totalKg || 0;
              if (!seg.annuel[key]) seg.annuel[key] = emptyBucket(resolved);
              seg.annuel[key].kgRecolte += kg;
              if (inCycle1) {
                if (!seg.cycle1[key]) seg.cycle1[key] = emptyBucket(resolved);
                seg.cycle1[key].kgRecolte += kg;
              }
              if (inCycle2) {
                if (!seg.cycle2[key]) seg.cycle2[key] = emptyBucket(resolved);
                seg.cycle2[key].kgRecolte += kg;
              }
            }
          }

          function finalizeSegment(byVariete) {
            const parVariete = Object.values(byVariete).map(v => ({
              ...v,
              recolte: { jh: Math.round(v.recolte.jh * 100) / 100, cout: Math.round(v.recolte.cout) },
              horsRecolte: { jh: Math.round(v.horsRecolte.jh * 100) / 100, cout: Math.round(v.horsRecolte.cout) },
              postesFixes: { jh: Math.round(v.postesFixes.jh * 100) / 100, cout: Math.round(v.postesFixes.cout) },
              total: { jh: Math.round(v.total.jh * 100) / 100, cout: Math.round(v.total.cout) },
              kgRecolte: Math.round(v.kgRecolte),
            })).sort((a, b) => b.total.cout - a.total.cout);
            const totaux = parVariete.reduce((acc, v) => ({
              recolte: acc.recolte + v.recolte.cout, horsRecolte: acc.horsRecolte + v.horsRecolte.cout,
              postesFixes: acc.postesFixes + v.postesFixes.cout, total: acc.total + v.total.cout,
              kgRecolte: acc.kgRecolte + v.kgRecolte,
            }), { recolte: 0, horsRecolte: 0, postesFixes: 0, total: 0, kgRecolte: 0 });
            return { parVariete, totaux };
          }

          const result = {
            success: true,
            campagne,
            cycle1: { ...finalizeSegment(seg.cycle1), start: campagne.start, end: cycle1End, label: `Cycle 1 (Juil ${startYear} → Déc ${startYear})` },
            cycle2: { ...finalizeSegment(seg.cycle2), start: cycle2Start, end: campagne.end, label: `Cycle 2 (Jan ${startYear + 1} → Juin ${startYear + 1})` },
            annuel: { ...finalizeSegment(seg.annuel), start: campagne.start, end: campagne.end, label: `Cumul annuel ${campagne.label}` },
          };
          // Back-compat with v1 shape (parVariete + totaux at root = annuel)
          result.parVariete = result.annuel.parVariete;
          result.totaux = result.annuel.totaux;
          return result;
        });
        return res.json(cached);
      }


      // ------ CAMPAGNE-ANALYTIQUE-DETAIL : granularité parcelle × quinzaine × opération ------
      // Aggrège les données du miroir Firestore en gardant la granularité fine.
      // Utilisé par CampagneAnalytiqueTab (Vue "Affectation par Ha" + "Par Variété").
      // NE modifie PAS campagne-mo-variete.
      if (action === "campagne-analytique-detail") {
        // Corps EXTRAIT en computeCampagneAnalytiqueDetail (module level) pour
        // être réutilisable en interne par l'export Excel serveur. Le périmètre
        // du gating, jusqu'ici implicite (shadow des fetchers), est passé
        // EXPLICITEMENT — même filtrage, même fail-closed, même clé de cache.
        const cached = await computeCampagneAnalytiqueDetail(_fermeFilter, _cultureFilter);
        return res.json(cached);
      }


      // ------ CAMPAGNE-COUT-OUVRIER : coût CHARGÉ d'une journée d'ouvrier ------
      //
      // Le `Cout` de BR_Pointage, affiché partout ailleurs, est le BRUT BEE ONE :
      // ni CNSS patronale, ni prime de transport. Cette action rend le coût RÉEL
      // d'une journée pour l'entreprise, moyenné sur la campagne, pour valoriser
      // en dirhams un budget saisi en JH.
      //
      // Cette fonction ne fait que de l'I/O : le calcul vit dans le module pur
      // functions/lib/paie/coutOuvrierCampagne.js, testé sans émulateur.
      //
      // ⚠️ Le modèle de paie (paieUtils) est DUPLIQUÉ dans functions/lib/paie/ :
      // Firebase ne déploie que `functions/`, un require vers public/ ferait
      // crasher toutes les CF au load. La divergence est attrapée par
      // functions/lib/paie/__tests__/paieUtils.parite.test.js.
      if (action === "campagne-cout-ouvrier") {
        const cached = await computeCampagneCoutOuvrier();
        return res.json(cached);
        return res.json(cached);
      }


      // ------ CAMPAGNE-CONSO-PARCELLE : consommation Engrais+Pesticides par parcelle ------
      // SOURCE : les BONS DE CONSOMMATION Smart Berry (`consumption_vouchers`),
      // et NON PLUS la collection miroir BEE ONE `sql_mirror_consommation`.
      //
      // Pourquoi (décision Omar, ticket sb/conso-campagne-bons) : la source BEE
      // ONE est TARIE depuis avril 2026 — le miroir couvre 2025-07 → 2026-04 et
      // ZÉRO ligne sur la campagne courante, d'où le « Aucune donnée pour cette
      // sélection » de l'écran, alors que le magasinier saisit sa consommation
      // dans les bons depuis. On tourne la page : bons UNIQUEMENT, pas d'union,
      // pas de bascule à une date. Conséquence ASSUMÉE : les campagnes
      // antérieures s'affichent vides ici. Rien n'est supprimé côté BEE ONE, et
      // `getConsommationRows` reste utilisé par d'autres actions (fertigation,
      // phytosanitaire, produits, parcelles, dashboard, agroSummary, exports).
      //
      // Le rattachement à la campagne se fait par la DATE DU BON (`campagneOf`) :
      // aucun champ campagne n'est persisté sur les bons, et la date est
      // modifiable a posteriori (`update-bc-date`) — un bon PEUT donc changer de
      // campagne, c'est voulu.
      //
      // Note : les bons ne portent pas de coût — seules les quantités sont
      // disponibles, `totalEngraisCout`/`totalPesticidesCout` restent à 0 comme
      // avant (valoriser cet écran au PMP est une décision produit séparée).
      if (action === "campagne-conso-parcelle") {
        const campagneLabel = campagneCourante(); // '2026-2027'
        // Fail-CLOSED sur l'horloge : sans campagne résoluble, l'adaptation ne
        // filtrerait plus rien et renverrait TOUS les bons, toutes campagnes
        // confondues. Impossible en pratique (`campagneCourante()` dérive de la
        // date système), mais c'est le seul fail-open du chemin — on le ferme.
        if (!campagneLabel) {
          return res.status(500).json({ success: false, error: "Campagne courante indéterminable" });
        }
        const campagne = { label: campagneLabel.replace('-', '/') };

        const cached = await withCache(
          // Clé versionnée v3 : la FORME de la réponse change (seau à classer +
          // `articles_a_classer`). Sans ce bump, un cache chaud resservirait
          // l'ancienne forme pendant 30 min et le bandeau paraîtrait cassé.
          // (v1 = miroir BEE ONE, v2 = bascule vers les bons Smart Berry.)
          //
          // ⚠️ Ces 30 min sont PURGÉES par l'action `classer-article`
          // (functions/index.js) : la catégorie est résolue à la LECTURE, donc
          // classer un article change cette réponse. Le préfixe littéral
          // ci-dessous est dupliqué dans
          // functions/lib/consoBons/cacheKeys.js (CONSO_PARCELLE_CACHE_PREFIX)
          // — la divergence est attrapée par
          // tests/unit/classer-article-cablage.test.js. Bumper la version ici
          // sans bumper là-bas laisserait la purge taper à côté, en silence.
          pointageCacheKey(`campagne_conso_parcelle_v3_${campagneLabel}`, _fermeFilter, _cultureFilter),
          30 * 60 * 1000,
          async () => {
            const [bons, referentiel, catByArticle] = await Promise.all([
              consoBons.fetchBonsConsommation(db_firestore),
              consoBons.fetchReferentielParcelles(db_firestore),
              // La catégorie engrais/pesticide vient de l'ARTICLE, jamais du
              // type declaré sur le bon (48 bons /48 en `engrais` en prod).
              // Lecture de plus, mise en cache 30 min avec le reste : coût
              // négligeable à 1125 fiches.
              consoBons.fetchArticleCategories(db_firestore),
            ]);

            const rows = consoBons.adaptBonsToConsoRows(bons, {
              campagne: campagneLabel,
              haByLabel: referentiel.haByLabel,
              sbMap: referentiel.sbMap,
              catByArticle,
            });

            // Cloisonnement chef appliqué DANS l'agrégation, fail-closed :
            // l'action est ferme-aware côté cache mais ne filtrait aucune ligne
            // — invisible tant que l'écran renvoyait 0 parcelle, ça exposerait
            // les autres fermes maintenant qu'il en renvoie. Le filtre culture
            // couvre chef_f1, dont le périmètre ferme vaut 'all'.
            //
            // Dérivation = `consoBons.fermeDeParcelle`, RÈGLE UNIQUE partagée
            // avec `conso-valorisee`. Elle remplace `deriveFerme` ici : celui-ci
            // renvoyait 'Autre' sur `F2 - HAAS` / `F3 -HAAS` / `F4 -HAAS`, si
            // bien que `chef_avo` recevait un écran VIDE alors que ses 20,5 ha
            // avaient consommé 60 lignes. Les libellés non résolus restent
            // exclus (fail-closed) mais sont remontés dans le payload.
            const parcelles = consoBons.aggregateConsoParcelle(rows, {
              haByLabel: referentiel.haByLabel,
              sbMap: referentiel.sbMap,
              deriveFerme: (parcelle) => consoBons.fermeDeParcelle(parcelle) || 'Autre',
              fermeFilter: _fermeFilter,
              cultureFilter: _cultureFilter,
            });

            return {
              success: true,
              campagne: campagne.label,
              source: 'bons_smart_berry',
              // Périmètres IMPOSÉS, rendus explicites pour que l'écran puisse
              // expliquer un tableau court au lieu de le laisser deviner.
              perimetre_ferme: _fermeFilter || 'all',
              perimetre_culture: _cultureFilter || null,
              // Libellés dont la ferme est indéterminable : exclus du périmètre
              // d'un chef. Calculés sur les lignes AVANT filtrage (après, ils
              // ont disparu). Vide sur les 19 libellés réels d'aujourd'hui.
              parcelles_ferme_indeterminee: consoBons.resolveFermeInconnue(
                rows.map((r) => r.Parcelle_Culturale)
              ),
              // Articles dont la catégorie catalogue n'est ni engrais ni
              // pesticide (ou qui n'ont pas de fiche) : ils ne sont plus
              // ignorés en silence, l'écran les nomme. Même précaution que
              // ci-dessus : calculé sur les lignes AVANT filtrage de périmètre,
              // sinon un chef ne verrait jamais ce qui manque au catalogue.
              articles_a_classer: consoBons.articlesAClasser(rows),
              parcelles,
            };
          }
        );
        return res.json(cached);
      }


      // ------ UPLOAD-TIMES: when was pointage uploaded to SQL per farm ------
      if (action === "upload-times") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        if (USE_MIRROR) {
          const [rows, syncStatus] = await Promise.all([getPointageRowsForDate(dateForCheck), getSyncStatus()]);
          const farmData = { F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
          for (const r of rows) { const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale); if (farmData[ferme]) farmData[ferme].add(r.Personnel_Matricule); }
          const uploads = Object.entries(farmData).map(([ferme, workers]) => ({ ferme, nbOuv: workers.size }));
          const lastSync = syncStatus?.lastSuccessAt;
          const lastTableWrite = lastSync ? (lastSync.toDate ? lastSync.toDate().toISOString() : new Date(lastSync).toISOString()) : null;
          return res.json({ success: true, date: dateForCheck, lastTableWrite, uploads });
        }
        const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
        const statsRes = await db.request().query(`SELECT MAX(last_user_update) AS lastWrite FROM sys.dm_db_index_usage_stats WHERE database_id = DB_ID() AND object_id = OBJECT_ID('BR_Pointage')`);
        const lastTableWrite = statsRes.recordset[0]?.lastWrite || null;
        // nbOuv par ferme = matricules DISTINCTS. La ferme est dérivée en JS (pas une
        // colonne SQL) → on ramène les couples DISTINCTS (matricule, parcelle) et on
        // déduplique via un Set par ferme. Auparavant on sommait des COUNT(DISTINCT) par
        // parcelle → un ouvrier multi-parcelles était compté N fois. Mirroir du chemin MIRROR.
        const result = await db.request().query(`SELECT DISTINCT Personnel_Matricule, Ref_parcelle, Parcelle_Culturale FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL}`);
        const farmData = { F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
        // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). On filtre les lignes brutes
        // par la ferme du chef AVANT de peupler farmData → un chef ne voit que le nbOuv de
        // sa ferme (autres fermes = 0), comme le chemin mirror shadowé (fail-closed).
        // _fermeFilter null (RH/DG/Finance) → passthrough strict (inchangé).
        for (const row of filterMirrorRowsByCulture(filterMirrorRowsByFerme(result.recordset, _fermeFilter), _cultureFilter)) { const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale); if (farmData[ferme]) farmData[ferme].add(row.Personnel_Matricule); }
        const uploads = Object.entries(farmData).map(([ferme, workers]) => ({ ferme, nbOuv: workers.size }));
        return res.json({ success: true, date: dateForCheck, lastTableWrite: lastTableWrite ? new Date(lastTableWrite).toISOString() : null, uploads });
      }


      // ------ POSTES-FIXES: postes fixes detail for a date ------
      if (action === "postes-fixes") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        const submittedFermes = await getSubmittedFermes(dateForCheck);

        let rows;
        if (USE_MIRROR) {
          rows = await fetchPostesFixesFromMirror(dateForCheck, _fermeFilter);
        } else {
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const result = await db.request().query(`SELECT Personnel_Matricule, Personnel_Nom, Operation, Ref_parcelle, Parcelle_Culturale, Nombre_Jr, Nombre_Hr, Cout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = N'11. Postes fixes' ORDER BY Ref_parcelle, Operation, Personnel_Nom`);
          rows = result.recordset.map(r => ({ matricule: (r.Personnel_Matricule || '').trim(), nom: (r.Personnel_Nom || '').trim(), operation: r.Operation, parcelle: (r.Parcelle_Culturale || '').trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), jours: r.Nombre_Jr, heures: r.Nombre_Hr, cout: Math.round(r.Cout || 0) }));
          // GATING PAIE : chef → cloisonnement sur la ferme dérivée (fail-closed).
          rows = filterByFermeField(rows, _fermeFilter);
        }

        if (Object.keys(submittedFermes).length > 0) {
          const liveRows = rows.filter(r => !submittedFermes[r.ferme]);
          let snapshotRows = [];
          for (const f of Object.keys(submittedFermes)) { const snapData = await getSnapshotData(dateForCheck, f); if (snapData && snapData.postesFixes) snapshotRows = snapshotRows.concat(snapData.postesFixes); }
          // GATING PAIE : snapshots (toutes fermes) → filtrer sur la ferme du chef.
          rows = filterByFermeField([...liveRows, ...snapshotRows], _fermeFilter);
        }

        return res.json({ success: true, date: dateForCheck, rows, count: rows.length });
      }


      // ------ PARCELLES-PARAMS-LIST : écran « Paramètres Parcelles » (liste) ------
      // Source MAINTENANT : parcelles distinctes du mirror sql_mirror_pointage sur
      // ---- parcelles-campagne-list : parcelles BR_Pointage classées par campagne ----
      // Source : BR_Pointage (base de production JH), pas BR_Consommation.
      // Campagne 2026/2027 : dates >= 2026-07-01 (parcelles actives campagne courante).
      // Campagne 2025/2026 : dates 2025-07-01..2026-06-30 non présentes en 2026/2027.
      if (action === "parcelles-campagne-list") {
        const today = new Date().toISOString().slice(0, 10);
        const CUT = "2026-07-01";
        const PREV_START = "2025-07-01";
        const PREV_END = "2026-06-30";

        let rows2627 = [], rowsPrev = [];

        if (!USE_MIRROR) {
          const db = await getPool();
          // Surfaces depuis BR_Parcelle (table de référence, champ Sup_Parcelle_Culturale)
          const [r1, r2, rSup] = await Promise.all([
            db.request().query(`
              SELECT Ref_parcelle, Parcelle_Culturale, Culture, Variete, Ferme,
                MIN(CONVERT(date, Periode_Date)) AS Debut,
                MAX(CONVERT(date, Periode_Date)) AS Fin
              FROM BR_Pointage
              WHERE CONVERT(date, Periode_Date) >= '${CUT}'
                AND Parcelle_Culturale IS NOT NULL AND Parcelle_Culturale != ''
              GROUP BY Ref_parcelle, Parcelle_Culturale, Culture, Variete, Ferme
              ORDER BY Parcelle_Culturale`),
            db.request().query(`
              SELECT Ref_parcelle, Parcelle_Culturale, Culture, Variete, Ferme,
                MIN(CONVERT(date, Periode_Date)) AS Debut,
                MAX(CONVERT(date, Periode_Date)) AS Fin
              FROM BR_Pointage
              WHERE CONVERT(date, Periode_Date) >= '${PREV_START}'
                AND CONVERT(date, Periode_Date) <= '${PREV_END}'
                AND Parcelle_Culturale IS NOT NULL AND Parcelle_Culturale != ''
              GROUP BY Ref_parcelle, Parcelle_Culturale, Culture, Variete, Ferme
              ORDER BY Parcelle_Culturale`),
            // Surfaces depuis BR_Parcelle (source authoritative : Sup_Parcelle_Culturale)
            db.request().query(`
              SELECT Parcelle_Culturale, Sup_Parcelle_Culturale AS Sup
              FROM BR_Parcelle
              WHERE Parcelle_Culturale IS NOT NULL AND Parcelle_Culturale != ''`),
          ]);
          // Map label → sup pour le join
          const supMap = {};
          rSup.recordset.forEach(r => { supMap[(r.Parcelle_Culturale || "").trim()] = parseFloat(r.Sup) || 0; });
          const toRow = (r) => {
            const lbl = (r.Parcelle_Culturale || "").trim();
            return {
              ref: (r.Ref_parcelle || "").trim(),
              label: lbl,
              culture: (r.Culture || "").trim(),
              variete: (r.Variete || "").trim(),
              ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
              sup: supMap[lbl] || 0,
              debut: r.Debut ? String(r.Debut).slice(0, 10) : null,
              fin: r.Fin ? String(r.Fin).slice(0, 10) : null,
            };
          };
          rows2627 = r1.recordset.map(toRow);
          rowsPrev = r2.recordset.map(toRow);
        } else {
          // Mirror path — Firestore sql_mirror_pointage
          // Surfaces via fetchBrParcelleSupMap (résilient : last-known-good si BDR down)
          const [raw2627, rawPrev, supMap] = await Promise.all([
            getPointageRowsForDateRange(CUT, today),
            getPointageRowsForDateRange(PREV_START, PREV_END),
            fetchBrParcelleSupMap(),
          ]);
          const agg = (rows) => {
            const m = {};
            for (const r of rows) {
              const lbl = (r.Parcelle_Culturale || "").trim();
              if (!lbl) continue;
              if (!m[lbl]) m[lbl] = {
                ref: (r.Ref_parcelle || "").trim(),
                label: lbl,
                culture: (r.Culture || r.culture || "").trim(),
                variete: (r.Variete || r.variete || "").trim(),
                ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
                sup: supMap[lbl] || 0, debut: null, fin: null,
              };
              const d = r.DateStr || (r.jour ? String(r.jour).slice(0, 10) : null);
              if (d) {
                if (!m[lbl].debut || d < m[lbl].debut) m[lbl].debut = d;
                if (!m[lbl].fin || d > m[lbl].fin) m[lbl].fin = d;
              }
            }
            return Object.values(m).sort((a, b) => a.label.localeCompare(b.label));
          };
          rows2627 = agg(raw2627);
          rowsPrev = agg(rawPrev);
        }

        // Exclure de 2025/2026 les parcelles déjà dans 2026/2027 (label match)
        const labels2627 = new Set(rows2627.map(r => r.label));
        rowsPrev = rowsPrev.filter(r => !labels2627.has(r.label));

        return res.json({ success: true, campagne_courante: rows2627, campagne_precedente: rowsPrev });
      }


      // ===== RÉFÉRENTIEL PARCELLES SMART BERRY =====
      // Lecture du référentiel (noms SB + surfaces éditables)
      //
      // Exemptée du gating paie (GATING_EXEMPT_ACTIONS) : TOUS les profils
      // authentifiés voient les noms Smart Berry — décision produit. Le 403 est
      // levé, mais pas la protection des champs de traçabilité : on résout ici le
      // périmètre de l'appelant à la SEULE fin de choisir la PROJECTION.
      //  - profil déjà autorisé avant ce correctif (dg/finance/rh/admin/chef
      //    résolu) → document intégral, strictement comme avant ;
      //  - tout autre profil (magasinier…) → sous-ensemble non nominatif
      //    { id, label_bee_one, nom_sb, ha, culture_sb }.
      // verifyAuth renvoie null (ne throw pas) si le header est absent/invalide ;
      // l'authentification reste par ailleurs exigée en amont par requireAuth sur
      // /api/pointage-rh. Aucun 403 n'est émis ici.
      if (action === "sb-referentiel-list") {
        const _authUserR = await verifyAuth(req);
        const _callerProfileR = await resolveCallerProfile(_authUserR);
        const _perimR = consoAccessControl.resolvePerimetre(_callerProfileR, req.query.ferme);
        const snap = await db_firestore.collection("sb_parcelle_referentiel").get();
        const parcelles = [];
        snap.forEach(doc => parcelles.push(projectSbReferentielForCaller({ id: doc.id, ...doc.data() }, _perimR)));
        return res.json({ success: true, parcelles });
      }


      // Sauvegarde d'une entrée du référentiel (DG/RH uniquement)
      if (action === "sb-referentiel-save" && req.method === "POST") {
        const _authUser = await verifyAuth(req);
        const callerProfile = await resolveCallerProfile(_authUser);
        const _pid = callerProfile && (callerProfile.profileId || callerProfile.role || '');
        if (!['dg', 'rh', 'admin'].includes(_pid)) {
          return res.status(403).json({ success: false, error: "Accès refusé — DG/RH requis" });
        }
        const { label_bee_one, nom_sb, ha, culture_sb } = req.body || {};
        if (!label_bee_one || typeof label_bee_one !== "string") {
          return res.status(400).json({ success: false, error: "label_bee_one requis" });
        }
        const CULTURES_SB_VALIDES = ["Myrtille", "Framboise", "Avocatier"];
        if (culture_sb !== undefined && !CULTURES_SB_VALIDES.includes(culture_sb)) {
          return res.status(400).json({ success: false, error: "culture_sb invalide" });
        }
        const key = label_bee_one.trim().toUpperCase();
        const haNum = parseFloat(ha) || 0;
        const docPayload = {
          label_bee_one: label_bee_one.trim(),
          nom_sb: (nom_sb || "").trim(),
          ha: haNum,
          updated_by: { uid: (_authUser && _authUser.uid) || null, profileId: _pid },
          updated_at: require("firebase-admin").firestore.FieldValue.serverTimestamp(),
        };
        // Optionnel : n'écrit `culture_sb` que si fourni et valide — jamais
        // `undefined` vers Firestore (erreur), et ne pas écraser une valeur
        // existante lors d'un save qui ne concerne que le nom/Ha.
        if (culture_sb !== undefined) docPayload.culture_sb = culture_sb;
        const docRef = db_firestore.collection("sb_parcelle_referentiel").doc(key);
        await docRef.set(docPayload, { merge: true });
        return res.json({ success: true, key });
      }

  return NOT_HANDLED;
};
