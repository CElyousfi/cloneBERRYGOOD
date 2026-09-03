/* Actions 1/4 de pointageRH — corps repris VERBATIM.
   Le contexte du handler arrive par `ctx` ; la destructuration ci-dessous
   recree exactement les liaisons d'origine. */
'use strict';
const { NOT_HANDLED } = require("./pointageService.dispatch");

module.exports = async function pointageServiceActions1(ctx) {
  const { req, res, action, dateParam, _fermeFilter, _cultureFilter, _keepPointage, _keepCulture, _keepCueillette, getPointageRowsForDate, getPointageRowsForDateRange, getPointageRowsForPeriode, getWorkerHistory, getCueilletteRows, db } = ctx;


      // ------ CONFECTION-TYPES: extract distinct confection types from BR_Pointage ------
      if (action === "confection-types") {
        try {
          let operations = [];
          if (USE_MIRROR) {
            // Lire depuis le mirror Firestore
            const dates = await getAvailableDates();
            const recentDates = dates.slice(0, 10);
            const opsSet = new Set();
            for (const d of recentDates) {
              const rows = await getPointageRowsForDate(d);
              rows.filter(r => r.Operation_Famille === "8. Récolte" && /caisse/i.test(r.Operation || ""))
                  .forEach(r => opsSet.add((r.Operation || "").trim()));
            }
            operations = [...opsSet];
          } else {
            const result = await db.request().query(`
              SELECT DISTINCT Operation FROM BR_Pointage
              WHERE Operation_Famille = N'8. Récolte'
              AND Operation LIKE N'%Caisse%kg%'
            `);
            operations = result.recordset.map(r => (r.Operation || "").trim()).filter(Boolean);
          }
          // Extraire le poids par colis depuis le nom de l'opération (caisse, barquette, seau, etc.)
          const types = operations.map(op => {
            const match = op.match(/([\d.]+)\s*kg/i);
            const poidsParColis = match ? parseFloat(match[1]) : 1.5;
            return { id: op.replace(/\s+/g, '_').toLowerCase(), label: op, poidsParColis, composition: [], source: 'beeone' };
          }).sort((a, b) => a.poidsParColis - b.poidsParColis);
          return res.json({ success: true, types });
        } catch(e) {
          console.error('confection-types error:', e);
          return res.json({ success: true, types: [] });
        }
      }


      // ------ PRESENCE: heures entrée/sortie depuis BEE_BERRY_GOOD (mirror prod_presence) ------
      if (action === "presence") {
        const date = dateParam || new Date().toISOString().slice(0, 10);
        const snap = await db_firestore.collection("prod_presence").doc(date).get();
        if (!snap.exists) {
          return res.json({ success: true, date, rows: [], rowCount: 0, syncedAt: null });
        }
        const data = snap.data();
        let rows = data.rows || [];
        // GATING PAIE (chef) : prod_presence est NOMINATIF et ne porte pas de parcelle
        // exploitable pour dériver la ferme. Même approche que buildHeuresSup : on
        // dérive le set des matricules ayant pointé la ferme du chef (via le mirror
        // du même jour), puis on ne renvoie que ces rows. Fail-closed : un ouvrier
        // présent mais jamais pointé sur la ferme du chef est exclu.
        // _fermeFilter null (RH/DG/Finance) → passthrough (toutes rows, inchangé).
        if (_fermeFilter) {
          // getPointageRowsForDate est shadowé (filtré ferme) → computeAllowedMatricules
          // re-filtre sans effet, restant correct.
          const mirrorRows = await getPointageRowsForDate(date);
          const allowed = computeAllowedMatricules(mirrorRows, _fermeFilter);
          rows = filterPresenceRowsByAllowed(rows, allowed);
        }
        return res.json({
          success: true,
          date,
          rows,
          rowCount: rows.length,
          syncedAt: data.syncedAt || null,
        });
      }


      // ------ PRESENCE-QUINZAINE: résumé absence entrée/sortie pour toute la quinzaine ------
      if (action === "presence-quinzaine") {
        const meta = await getPointageMeta();
        const periodes = (meta && meta.periodes) || [];
        const periodeMap = (meta && meta.periodeMap) || {};
        const targetPeriode = periodes[0];
        if (!targetPeriode) return res.json({ success: true, periode: null, days: [] });
        const days = (periodeMap[targetPeriode] || []).slice().sort();
        const dayResults = [];
        for (let i = 0; i < days.length; i += 10) {
          const batch = days.slice(i, i + 10);
          const snaps = await Promise.all(batch.map(d => db_firestore.collection('prod_presence').doc(d).get()));
          snaps.forEach((snap, idx) => {
            const d = batch[idx];
            let rows = snap.exists ? (snap.data().rows || []) : [];
            // fermeFilter skipped: prod_presence n'a pas de parcelle exploitable.
            // Le frontend filtre via transportRows (ferme dérivée de la parcelle BDP).
            dayResults.push({
              date: d,
              rows: rows.map(r => ({
                matricule: (r.matricule || '').trim(),
                nom: (r.nom || '').trim(),
                heureEntree: r.heureEntree || null,
                heureSortie: r.heureSortie || null,
              })),
            });
          });
        }
        return res.json({ success: true, periode: targetPeriode, days: dayResults });
      }


      // ------ SUMMARY: effectif today + yesterday + weekly trend + top ops ------
      if (action === "summary") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        // Clé ferme-aware : le payload est filtré par _fermeFilter (shadow des fetchers).
        const cacheKey = pointageCacheKey(`pointage_summary_${dateForCheck}`, _fermeFilter, _cultureFilter);
        const cached = await withCache(cacheKey, 2 * 60 * 1000, async () => {
        const submittedFermes = await getSubmittedFermes(dateForCheck);

        if (USE_MIRROR) {
          // === MIRROR PATH ===
          const yesterdayStr = new Date(new Date(dateForCheck).getTime() - 86400000).toISOString().slice(0, 10);
          const weekStartStr = new Date(new Date(dateForCheck).getTime() - 6 * 86400000).toISOString().slice(0, 10);
          const [todayRows, yesterdayRows, weekRows] = await Promise.all([
            getPointageRowsForDate(dateForCheck),
            getPointageRowsForDate(yesterdayStr),
            getPointageRowsForDateRange(weekStartStr, dateForCheck),
          ]);
          // Effectifs = OUVRIERS DISTINCTS par (ferme, type), dédupliqués sur les lignes brutes
          // (un ouvrier multi-parcelles compté 1×, cohérent avec le popup détail).
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
          // Override with snapshot data.
          // GATING PAIE (fail-closed) : snapData.summary est le résumé effectif/coût
          // d'UNE ferme soumise. Pour un chef, on ne réinjecte QUE le snapshot de SA
          // ferme — sinon pointageJour émettrait l'effectif/coût des autres fermes
          // soumises. Les live counts (fermes[f]) des autres fermes sont déjà zérotés
          // par le shadow des fetchers (todayRows filtré). _fermeFilter null
          // (RH/DG/Finance) → override de toutes les fermes soumises (inchangé).
          for (const f of Object.keys(submittedFermes)) {
            if (_fermeFilter && f !== _fermeFilter) continue;
            const snapData = await getSnapshotData(dateForCheck, f);
            if (snapData && snapData.summary && fermes[f]) fermes[f] = snapData.summary;
          }
          const pointageJour = Object.keys(fermes).map(f => {
            const e = fermes[f];
            // total = ouvriers DISTINCTS ferme tous types ; fallback somme pour snapshots ancien format.
            const total = (typeof e.total === 'number') ? e.total : (e.recolte + e.horsRecolte + e.postesFixes);
            const veille = fermesYesterday[f] ? fermesYesterday[f].total : total;
            return { ferme: f, total, recolte: e.recolte, horsRecolte: e.horsRecolte, postesFixes: e.postesFixes, cout: Math.round(e.cout), veille, diff: veille > 0 ? Math.round(((total - veille) / veille) * 1000) / 10 : 0 };
          });
          // Weekly trend
          const trendMap = {};
          for (const r of weekRows) {
            const key = r.DateStr;
            if (!trendMap[key]) trendMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short" }), F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            if (trendMap[key][ferme]) trendMap[key][ferme].add(r.Personnel_Matricule);
          }
          const weeklyTrend = Object.values(trendMap).map(t => ({ jour: t.jour, jourLabel: t.jourLabel, F1: t.F1.size, F5: t.F5.size, Avocatier: t.Avocatier.size, BAHIA: t.BAHIA.size })).sort((a, b) => a.jour.localeCompare(b.jour));
          // Top ops
          const opsGroups = {};
          for (const r of todayRows) {
            if (r.Operation_Famille === "8. Récolte" || r.Operation_Famille === "11. Postes fixes") continue;
            const key = `${r.Operation_Famille}|${r.Operation}|${r.Ref_parcelle}|${r.Parcelle_Culturale}`;
            if (!opsGroups[key]) opsGroups[key] = { ...r, workers: new Set(), totalHr: 0 };
            opsGroups[key].workers.add(r.Personnel_Matricule);
            opsGroups[key].totalHr += r.Nombre_Hr || 0;
          }
          const topOps = Object.values(opsGroups).map(g => ({ operation: g.Operation || g.Operation_Famille, operationFamille: g.Operation_Famille, effectif: g.workers.size, heures: g.totalHr, parcelle: (g.Parcelle_Culturale || "").trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale) })).sort((a, b) => b.effectif - a.effectif).slice(0, 10);
          // Recolte kg
          const recolteRows = todayRows.filter(r => r.Operation_Famille === "8. Récolte");
          const recolteWorkers = new Set(recolteRows.map(r => r.Personnel_Matricule));
          const recolteQty = recolteRows.reduce((s, r) => s + (r.Quantite_unite || 0), 0);
          const recolteCout = recolteRows.reduce((s, r) => s + (r.Cout || 0), 0);
          const syncStatus = await getSyncStatus();
          return { success: true, date: dateForCheck, effectif: fermes, pointageJour, weeklyTrend, topOps, recolteTotal: { qty: recolteQty, nbOuv: recolteWorkers.size, cout: Math.round(recolteCout) }, lastSaisie: syncStatus?.lastSuccessAt || null, syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null };
        }

        // === FALLBACK SQL PATH ===
        const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";

        // Effectifs = OUVRIERS DISTINCTS par (ferme, type). On descend le matricule au grain
        // (parcelle, op) afin de dédupliquer côté JS par (ferme, type) — un ouvrier multi-parcelles
        // ne doit compter qu'une fois. Le coût reste une SOMME (inchangé). Idem veille + trend.
        const [todayRes, yesterdayRes, trendRes, topOpsRes, recolteKgRes, lastSaisieRes] = await Promise.all([
          db.request().query(`SELECT Ref_parcelle, Parcelle_Culturale, Operation_Famille, Personnel_Matricule, SUM(Cout) AS totalCout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} GROUP BY Ref_parcelle, Parcelle_Culturale, Operation_Famille, Personnel_Matricule`),
          db.request().query(`SELECT Ref_parcelle, Parcelle_Culturale, Operation_Famille, Personnel_Matricule FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = DATEADD(day, -1, ${dateSQL}) GROUP BY Ref_parcelle, Parcelle_Culturale, Operation_Famille, Personnel_Matricule`),
          db.request().query(`SELECT CONVERT(date, Periode_Date) AS jour, Ref_parcelle, Parcelle_Culturale, Personnel_Matricule FROM BR_Pointage WHERE Periode_Date >= DATEADD(day, -6, ${dateSQL}) AND CONVERT(date, Periode_Date) <= ${dateSQL} GROUP BY CONVERT(date, Periode_Date), Ref_parcelle, Parcelle_Culturale, Personnel_Matricule ORDER BY jour`),
          db.request().query(`SELECT Operation_Famille, Operation, Ref_parcelle, Parcelle_Culturale, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Hr) AS totalHr FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille != '8. Récolte' AND Operation_Famille != '11. Postes fixes' GROUP BY Operation_Famille, Operation, Ref_parcelle, Parcelle_Culturale ORDER BY nbOuv DESC`),
          db.request().query(`SELECT Ref_parcelle, Parcelle_Culturale, Quantite_unite, Personnel_Matricule, Cout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = '8. Récolte'`),
          db.request().query(`SELECT TOP 1 Periode_Date FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} ORDER BY Periode_Date DESC`),
        ]);

        // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false, filet de sécurité). Ces
        // recordsets portent Ref_parcelle/Parcelle_Culturale → ferme dérivable. On filtre
        // CHAQUE recordset par la ferme du chef AVANT agrégation (effectifs/trend/topOps/
        // récolte), comme le chemin mirror via les fetchers shadowés. Fail-closed.
        // _fermeFilter null (RH/DG/Finance) → passthrough strict (inchangé).
        // _cultureFilter non null (chef_f5) → filtre culture additionnel après ferme.
        const todayRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(todayRes.recordset, _fermeFilter), _cultureFilter);
        const yesterdayRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(yesterdayRes.recordset, _fermeFilter), _cultureFilter);
        const trendRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(trendRes.recordset, _fermeFilter), _cultureFilter);
        const topOpsRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(topOpsRes.recordset, _fermeFilter), _cultureFilter);
        const recolteRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(recolteKgRes.recordset, _fermeFilter), _cultureFilter);

        const fermes = countDistinctByFermeType(todayRows.map(row => ({
          matricule: row.Personnel_Matricule,
          ferme: deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale),
          type: classifyType(row.Operation_Famille),
          cout: row.totalCout || 0,
        })), POINTAGE_FERMES);
        const veilleEffectif = countDistinctByFermeType(yesterdayRows.map(row => ({
          matricule: row.Personnel_Matricule,
          ferme: deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale),
          type: classifyType(row.Operation_Famille),
        })), POINTAGE_FERMES);
        const fermesYesterday = { F1: { total: veilleEffectif.F1.total }, F5: { total: veilleEffectif.F5.total }, Avocatier: { total: veilleEffectif.Avocatier.total }, BAHIA: { total: veilleEffectif.BAHIA.total } };

        // Override with snapshot data for submitted fermes.
        // GATING PAIE (fail-closed) : même garde ferme que le chemin mirror (l.1726).
        // Pour un chef, ne réinjecter QUE le snapshot de SA ferme — sinon le résumé
        // effectif/coût des autres fermes soumises fuiterait. _fermeFilter null
        // (RH/DG/Finance) → override de toutes les fermes soumises (inchangé).
        for (const f of Object.keys(submittedFermes)) {
          if (_fermeFilter && f !== _fermeFilter) continue;
          const snapData = await getSnapshotData(dateForCheck, f);
          if (snapData && snapData.summary && fermes[f]) {
            fermes[f] = snapData.summary;
          }
        }

        // Build pointageJour array
        const pointageJour = Object.keys(fermes).map(f => {
          const e = fermes[f];
          // total = ouvriers DISTINCTS ferme tous types ; fallback somme pour snapshots ancien format.
          const total = (typeof e.total === 'number') ? e.total : (e.recolte + e.horsRecolte + e.postesFixes);
          const veille = fermesYesterday[f] ? fermesYesterday[f].total : total;
          return {
            ferme: f, total, recolte: e.recolte, horsRecolte: e.horsRecolte, postesFixes: e.postesFixes,
            cout: Math.round(e.cout), veille, diff: veille > 0 ? Math.round(((total - veille) / veille) * 1000) / 10 : 0,
          };
        });

        // Weekly trend — ouvriers distincts par (jour, ferme), dédupliqués via Set.
        const trendMap = {};
        for (const row of trendRows) {
          const d = new Date(row.jour);
          const key = d.toISOString().slice(0, 10);
          if (!trendMap[key]) trendMap[key] = { jour: key, jourLabel: d.toLocaleDateString("fr-FR", { weekday: "short" }), F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
          const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale);
          if (trendMap[key][ferme]) trendMap[key][ferme].add(row.Personnel_Matricule);
        }
        const weeklyTrend = Object.values(trendMap)
          .map(t => ({ jour: t.jour, jourLabel: t.jourLabel, F1: t.F1.size, F5: t.F5.size, Avocatier: t.Avocatier.size, BAHIA: t.BAHIA.size }))
          .sort((a, b) => a.jour.localeCompare(b.jour));

        // Top ops
        const topOps = topOpsRows.slice(0, 10).map(r => ({
          operation: r.Operation || r.Operation_Famille,
          operationFamille: r.Operation_Famille,
          effectif: r.nbOuv,
          heures: r.totalHr,
          parcelle: (r.Parcelle_Culturale || "").trim(),
          ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
        }));

        // Récolte : agrégé en JS depuis les lignes filtrées par ferme (la requête ne
        // pré-agrège plus, pour rester cloisonnable). nbOuv = matricules distincts.
        const recolteMatricules = new Set();
        let recolteTotalQty = 0;
        let recolteTotalCout = 0;
        for (const r of recolteRows) {
          if (r.Personnel_Matricule) recolteMatricules.add(r.Personnel_Matricule);
          recolteTotalQty += r.Quantite_unite || 0;
          recolteTotalCout += r.Cout || 0;
        }
        const recolteKg = { totalQty: recolteTotalQty, nbOuv: recolteMatricules.size, totalCout: recolteTotalCout };
        const lastSaisieRow = lastSaisieRes.recordset[0];
        const lastSaisie = lastSaisieRow ? new Date(lastSaisieRow.Periode_Date).toISOString() : null;

        return {
          success: true, date: dateParam || new Date().toISOString().slice(0, 10),
          effectif: fermes, pointageJour, weeklyTrend, topOps,
          recolteTotal: { qty: recolteKg.totalQty || 0, nbOuv: recolteKg.nbOuv || 0, cout: Math.round(recolteKg.totalCout || 0) },
          lastSaisie,
        };
        }); // end withCache
        return res.json(cached);
      }


      // ------ DETAIL: detailed pointage for a date ------
      if (action === "detail") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        // GATING PAIE : la clé de cache inclut la ferme du chef (_fermeFilter) pour
        // qu'un payload cloisonné ne soit jamais servi à un autre profil ni ne pollue
        // le cache global RH ('all' → suffixe 'all', comportement inchangé).
        const cacheSuffix = _fermeFilter || 'all';
        const cached = await withCache(`pointage_detail_${dateForCheck}_${cacheSuffix}`, 2 * 60 * 1000, async () => {
        const submittedFermes = await getSubmittedFermes(dateForCheck);

        let rows;
        if (USE_MIRROR) {
          rows = await fetchDetailFromMirror(dateForCheck, _fermeFilter);
        } else {
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const result = await db.request().query(`
            SELECT Personnel_Matricule, Personnel_Nom, Operation_Famille, Operation, Operation_Groupe,
              Nombre_Jr, Nombre_Hr, Quantite_unite, Cout, Parcelle_Culturale, Ref_parcelle, Variete, Culture,
              HS_25, HS_50, HS_100, HS_NM
            FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL}
            ORDER BY Ref_parcelle, Operation_Famille, Personnel_Nom`);
          rows = result.recordset.map(r => ({
            matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
            operationFamille: r.Operation_Famille, operation: r.Operation, groupe: r.Operation_Groupe,
            jours: r.Nombre_Jr, heures: r.Nombre_Hr, quantite: r.Quantite_unite, cout: r.Cout,
            parcelle: (r.Parcelle_Culturale || "").trim(), refParcelle: (r.Ref_parcelle || "").trim(),
            ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), type: classifyType(r.Operation_Famille),
            variete: r.Variete, culture: r.Culture, hs25: r.HS_25, hs50: r.HS_50, hs100: r.HS_100,
          }));
          // GATING PAIE : chef → cloisonnement sur la ferme dérivée (fail-closed).
          rows = filterByFermeField(rows, _fermeFilter);
        }

        if (Object.keys(submittedFermes).length > 0) {
          const liveRows = rows.filter(r => !submittedFermes[r.ferme]);
          let snapshotRows = [];
          for (const f of Object.keys(submittedFermes)) {
            const snapData = await getSnapshotData(dateForCheck, f);
            if (snapData && snapData.detailRows) snapshotRows = snapshotRows.concat(snapData.detailRows);
          }
          // GATING PAIE : les snapshots agrègent TOUTES les fermes → filtrer sur la
          // ferme du chef avant renvoi (fail-closed sur 'Autre'/autre ferme).
          rows = filterByFermeField([...liveRows, ...snapshotRows], _fermeFilter);
        }

        return { success: true, date: dateForCheck, rows, count: rows.length };
        }); // end withCache
        return res.json(cached);
      }


      // ------ RECOLTE: harvest workers for a date ------
      if (action === "recolte") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        // Clé ferme-aware : le payload est filtré par _fermeFilter (shadow des fetchers).
        const cached = await withCache(pointageCacheKey(`pointage_recolte_${dateForCheck}`, _fermeFilter, _cultureFilter), 2 * 60 * 1000, async () => {
        let workers, cueillette;

        if (USE_MIRROR) {
          const [pointageRows, cueilletteRows] = await Promise.all([
            getPointageRowsForDate(dateForCheck),
            getCueilletteRows(dateForCheck, dateForCheck),
          ]);
          // Cueillette
          const cGroups = {};
          for (const r of cueilletteRows.filter(r => r.Operation_Famille === "8. Récolte")) {
            const key = `${r.Parcelle_Culturale}|${r.Variete}`;
            if (!cGroups[key]) cGroups[key] = { parcelle: (r.Parcelle_Culturale || "").trim(), variete: r.Variete, refTech: (r.Reference_Technique || "").trim(), totalKg: 0, totalCaisses: 0 };
            cGroups[key].totalKg += r.Poids_total_kg || 0;
            cGroups[key].totalCaisses += r.Nbre_Caisse || 0;
          }
          cueillette = Object.values(cGroups).map(c => ({ ...c, ferme: deriveFerme(c.refTech || null, c.parcelle) })).sort((a, b) => b.totalKg - a.totalKg);
          // Workers from pointage
          workers = pointageRows
            .filter(r => r.Operation_Famille === "8. Récolte")
            .map((r, i) => ({
              rank: i + 1, matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
              operation: r.Operation, quantite: quantiteToKg(r.Quantite_unite, r.Operation),
              heures: r.Nombre_Hr, cout: r.Cout, parcelle: (r.Parcelle_Culturale || "").trim(),
              ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: r.Variete,
            }));
        } else {
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const [pointageRes, cueilletteRes] = await Promise.all([
            db.request().query(`SELECT Personnel_Matricule, Personnel_Nom, Operation, Quantite_unite, Nombre_Hr, Cout, Parcelle_Culturale, Ref_parcelle, Variete FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = N'8. Récolte' ORDER BY Quantite_unite DESC, Personnel_Nom`),
            db.request().query(`SELECT Parcelle_Culturale, Variete, Reference_Technique, SUM(Poids_total_kg) AS totalKg, SUM(Nbre_Caisse) AS totalCaisses FROM BR_Cueillette WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = N'8. Récolte' GROUP BY Parcelle_Culturale, Variete, Reference_Technique ORDER BY totalKg DESC`),
          ]);
          cueillette = cueilletteRes.recordset.map(r => ({ parcelle: (r.Parcelle_Culturale || "").trim(), variete: r.Variete, ferme: deriveFerme(r.Reference_Technique, r.Parcelle_Culturale), totalKg: r.totalKg || 0, totalCaisses: r.totalCaisses || 0 }));
          workers = pointageRes.recordset.map((r, i) => ({ rank: i + 1, matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), operation: r.Operation, quantite: quantiteToKg(r.Quantite_unite, r.Operation), heures: r.Nombre_Hr, cout: r.Cout, parcelle: (r.Parcelle_Culturale || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: r.Variete }));
          // Fail-closed : cohérence avec detail/postes-fixes. En prod USE_MIRROR=true
          // (le shadow filtre déjà), mais on filtre aussi cette branche SQL fallback.
          workers = filterByFermeField(workers, _fermeFilter);
          cueillette = filterByFermeField(cueillette, _fermeFilter);
        }

        // Dédup SYSTÉMATIQUE par matricule : 1 ligne BR_Pointage par (ouvrier × parcelle),
        // donc un ouvrier multi-parcelles était compté N fois (count gonflé). On regroupe
        // par matricule en SOMMANT heures/cout/quantite (somme totale inchangée — rien perdu).
        // Auparavant ce regroupement n'avait lieu que dans la branche scan prod ci-dessous.
        workers = dedupeWorkersByMatricule(workers);

        // Enrich with production data (Tracabilite_recolte) if available
        let prodSyncedAt = null;
        try {
          const prodDoc = await db_firestore.collection("prod_tracabilite_recolte").doc(dateForCheck).get();
          if (prodDoc.exists) {
            const prodData = prodDoc.data();
            if (prodData.syncedAt && typeof prodData.syncedAt.toMillis === "function") {
              prodSyncedAt = prodData.syncedAt.toMillis();
            }
          }
          // Fallback: if no doc for this date (no scans yet), use the global last-run timestamp
          if (!prodSyncedAt) {
            const statusDoc = await db_firestore.collection("prod_tracabilite_recolte").doc("_status").get();
            if (statusDoc.exists) {
              const s = statusDoc.data();
              if (s.lastRunAt && typeof s.lastRunAt.toMillis === "function") {
                prodSyncedAt = s.lastRunAt.toMillis();
              }
            }
          }
          if (prodDoc.exists) {
            const prodData = prodDoc.data();
            // GATING PAIE (fail-closed) : prod_tracabilite_recolte contient TOUS les
            // ouvriers de TOUTES les fermes (aucun champ ferme). Pour un chef, on filtre
            // les lignes prod sur sa ferme AVANT tout enrichissement — sinon la boucle
            // « add workers missing from pointage » injecterait matricule+nom+kg d'autres
            // fermes, et cueillette/totalKg (prodData.totalKg) seraient tous-fermes.
            // _fermeFilter null (RH/DG/Finance) → passthrough STRICT (inchangé).
            const prodRows = filterProdRowsByFerme(prodData.rows || [], _fermeFilter);
            if (prodRows.length > 0) {
              // workers est déjà dédupliqué par matricule (cf. dedupeWorkersByMatricule
              // appelé plus haut, systématiquement). Idempotent par sécurité.
              workers = dedupeWorkersByMatricule(workers);

              const prodMap = {};
              prodRows.forEach(r => { prodMap[(r.matricule || "").toUpperCase()] = r; });
              // Override kg for existing workers — prod is the source of truth for kg
              workers.forEach(w => {
                const prod = prodMap[(w.matricule || "").toUpperCase()];
                if (prod) {
                  w.quantite = prod.totalKg;
                  w.variete = prod.variete || w.variete;
                } else {
                  w.quantite = 0;
                }
              });
              // Add workers in prod but missing from pointage
              prodRows.forEach(r => {
                const matUp = (r.matricule || "").toUpperCase();
                if (!workers.find(w => (w.matricule || "").toUpperCase() === matUp)) {
                  workers.push({
                    rank: 0, matricule: r.matricule, nom: r.nom,
                    operation: "Récolte (prod)", quantite: r.totalKg,
                    heures: 0, cout: 0, parcelle: r.refParcelle || "",
                    ferme: deriveFerme(r.refParcelle, ""), variete: r.variete,
                  });
                }
              });
              // Use prod totalKg instead of BR_Cueillette. Pour un chef, prodData.totalKg
              // est un total TOUTES fermes → on resomme sur les seules lignes prod de sa
              // ferme (déjà filtrées ci-dessus). _fermeFilter null → total prod d'origine.
              const prodTotalKg = recomposeProdTotalKg(prodRows, prodData.totalKg || 0, _fermeFilter);
              cueillette = [{ parcelle: "Total (prod)", variete: "", ferme: _fermeFilter || "", totalKg: prodTotalKg, totalCaisses: 0 }];
            }
          }
        } catch (prodErr) {
          console.warn("[recolte] Prod data unavailable, using reporting:", prodErr.message);
        }

        workers.sort((a, b) => b.quantite - a.quantite || a.nom.localeCompare(b.nom));
        workers.forEach((w, i) => { w.rank = i + 1; });
        const totalKgCueillette = cueillette.reduce((s, c) => s + c.totalKg, 0);
        return { success: true, date: dateForCheck, workers, cueillette, totalKgCueillette, count: workers.length, prodSyncedAt };
        }); // end withCache
        return res.json(cached);
      }


      // ------ QUINZAINE: bi-weekly summary ------
      if (action === "quinzaine") {
        const periodeParam = req.query.periode;
        // Clé ferme-aware : le payload (parFerme/parJour) dépend de _fermeFilter.
        const cacheKey = pointageCacheKey(`pointage_quinzaine_${periodeParam || "latest"}`, _fermeFilter, _cultureFilter);
        const cached = await withCache(cacheKey, 5 * 60 * 1000, async () => {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.allPeriodes || meta?.periodes || [];
          let periodeCampagne = (meta && meta.periodeCampagne) || {};
          // Dériver periodeCampagne depuis periodeMap si vide (nouvelle campagne ou sync incomplet)
          if (Object.keys(periodeCampagne).length === 0 && meta?.periodeMap) {
            periodeCampagne = buildPeriodeCampagne(meta.periodeMap, campagneOf);
          }
          const mirrorPeriodes = meta?.periodes || [];
          const selectedPeriode = periodeParam || defaultPeriode(meta, periodes);
          if (!selectedPeriode) return { success: true, periode: null, periodes, periodeCampagne, totalJournees: 0, totalCout: 0, parFerme: [], parJour: [] };

          // Label composite ("Quinzaine N (AAAA-BBBB)") : `Periode_paie` en SQL/mirror
          // ne contient jamais le suffixe — extraire le label brut pour matcher, puis
          // filtrer les lignes obtenues par la liste de dates exacte de periodeMap
          // (jamais faire confiance au matching par label seul entre deux campagnes).
          const { rawLabel: selectedRawLabel, isComposite: selectedIsComposite } = splitCompositeLabel(selectedPeriode);
          const selectedExactDates = meta?.periodeMap?.[selectedPeriode];

          // If selected period has mirror data, use Firestore; otherwise fallback to SQL
          let rows;
          if (mirrorPeriodes.includes(selectedPeriode) && meta?.periodeMap?.[selectedPeriode]) {
            rows = await getPointageRowsForPeriode(selectedPeriode);
            if (selectedIsComposite) rows = filterRowsByExactDates(rows, selectedExactDates);
          } else {
            // Check Firestore archive first
            const archiveDoc = await archiveDocRef(selectedPeriode).get();
            if (archiveDoc.exists && archiveDoc.data().summary) {
              const arch = archiveDoc.data().summary;
              // GATING PAIE (chef) : l'archive stocke des agrégats TOUTES fermes
              // (parFerme keyé par ferme, parJour ventilé par ferme, totaux tous-fermes).
              // Sans cloisonnement, un chef verrait toutes les fermes. On ne garde que
              // sa ferme et on recompose ses totaux (fail-closed sur journees/cout du jour,
              // non ventilables par ferme dans l'archive).
              // _fermeFilter null (RH/DG/Finance) → passthrough (inchangé).
              const parFerme = filterArchivedParFerme(arch.parFerme, _fermeFilter);
              const parJour = filterArchivedParJour(arch.parJour, _fermeFilter);
              const totals = recomposeArchivedTotals(parFerme, arch, _fermeFilter);
              // parCulture : présent dans les nouvelles archives, null dans les anciennes
              // (le frontend dégrade gracieusement si null — bouton Rafraîchir Firestore Cache)
              const parCulture = arch.parCulture || null;
              return {
                success: true, periode: selectedPeriode, periodes, periodeCampagne,
                totalJournees: totals.totalJournees, totalCout: totals.totalCout,
                parFerme, parJour, parCulture,
              };
            }
            // Fallback: fetch directly from SQL for older quinzaines
            const sqlDb = await getPool();
            const sqlResult = await sqlDb.request().input('periode', selectedRawLabel).query(`
              SELECT Personnel_Matricule, Personnel_Nom, Operation_Famille, Operation, Operation_Groupe,
                Nombre_Jr, Nombre_Hr, Quantite_unite, Cout, Parcelle_Culturale, Ref_parcelle,
                Variete, Culture, Periode_paie,
                CONVERT(varchar(10), Periode_Date, 23) AS DateStr,
                HS_25, HS_50, HS_100, HS_NM
              FROM BR_Pointage
              WHERE Periode_paie = @periode
              ORDER BY Periode_Date, Personnel_Nom
            `);
            rows = sqlResult.recordset.map(r => ({
              Personnel_Matricule: (r.Personnel_Matricule || "").trim(),
              Personnel_Nom: (r.Personnel_Nom || "").trim(),
              Operation_Famille: r.Operation_Famille,
              Operation: r.Operation,
              Operation_Groupe: r.Operation_Groupe,
              Nombre_Jr: r.Nombre_Jr,
              Nombre_Hr: r.Nombre_Hr,
              Quantite_unite: r.Quantite_unite,
              Cout: r.Cout,
              Parcelle_Culturale: (r.Parcelle_Culturale || "").trim(),
              Ref_parcelle: (r.Ref_parcelle || "").trim(),
              Variete: (r.Variete || "").trim(),
              Culture: (r.Culture || "").trim(),
              Periode_paie: (r.Periode_paie || "").trim(),
              DateStr: r.DateStr,
              HS_25: r.HS_25 || 0, HS_50: r.HS_50 || 0, HS_100: r.HS_100 || 0, HS_NM: r.HS_NM || 0,
            }));
            // GATING PAIE (chef) : ce fallback SQL lit le raw recordset SANS passer par
            // le fetcher shadowé (getPointageRowsForPeriode). On filtre donc les LIGNES
            // BRUTES par la ferme du chef AVANT toute agrégation (qFermes/parJour/totaux),
            // exactement comme le chemin mirror. Sans ça, un chef verrait toutes les fermes.
            // _fermeFilter null (RH/DG/Finance) → passthrough strict (inchangé).
            // _cultureFilter non null (chef_f5) → filtre culture additionnel après ferme.
            rows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(rows, _fermeFilter), _cultureFilter);
            // Garde-fou (no-op si periodeMap ne connaît pas ce label composite) : ne
            // jamais faire confiance au seul matching SQL par label brut, ambigu entre
            // deux campagnes qui réutilisent le même numéro de quinzaine.
            if (selectedIsComposite) rows = filterRowsByExactDates(rows, selectedExactDates);
          }
          // Summary per ferme
          const qFermes = { F1: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, F5: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, Avocatier: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, BAHIA: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 } };
          for (const r of rows) {
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            const type = classifyType(r.Operation_Famille);
            if (qFermes[ferme]) { qFermes[ferme].journees += r.Nombre_Jr || 0; qFermes[ferme].cout += r.Cout || 0; qFermes[ferme][type] += r.Nombre_Jr || 0; }
          }
          // Per day
          const dayMap = {};
          for (const r of rows) {
            const key = r.DateStr;
            if (!dayMap[key]) dayMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), nbOuv: new Set(), journees: 0, cout: 0, F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
            dayMap[key].nbOuv.add(r.Personnel_Matricule);
            dayMap[key].journees += r.Nombre_Jr || 0;
            dayMap[key].cout += r.Cout || 0;
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            if (dayMap[key][ferme]) dayMap[key][ferme].add(r.Personnel_Matricule);
          }
          const perDay = Object.values(dayMap).map(d => ({ jour: d.jour, jourLabel: d.jourLabel, nbOuv: d.nbOuv.size, journees: d.journees, cout: d.cout, F1: d.F1.size, F5: d.F5.size, Avocatier: d.Avocatier.size, BAHIA: d.BAHIA.size })).sort((a, b) => a.jour.localeCompare(b.jour));
          const totalJournees = Object.values(qFermes).reduce((s, f) => s + f.journees, 0);
          const totalCout = Object.values(qFermes).reduce((s, f) => s + f.cout, 0);
          const parCulture = buildParCulture(rows);
          return { success: true, periode: selectedPeriode, periodes, periodeCampagne, totalJournees: Math.round(totalJournees), totalCout: Math.round(totalCout), parFerme: Object.entries(qFermes).map(([f, d]) => ({ ferme: f, journees: Math.round(d.journees), cout: Math.round(d.cout), recolte: Math.round(d.recolte), horsRecolte: Math.round(d.horsRecolte), postesFixes: Math.round(d.postesFixes) })), parJour: perDay, parCulture: parCulture };
        }

        // === FALLBACK SQL PATH ===
        let periodeFilter = "";
        if (periodeParam) { periodeFilter = `AND Periode_paie = '${periodeParam}'`; }
        else { const latest = await db.request().query(`SELECT TOP 1 Periode_paie FROM BR_Pointage ORDER BY Periode_Date DESC`); const latestPeriode = latest.recordset[0]?.Periode_paie || ""; periodeFilter = latestPeriode ? `AND Periode_paie = '${latestPeriode}'` : ""; }
        const [summaryRes, perDayRes, perDayMatRes, periodesRes] = await Promise.all([
          db.request().query(`SELECT Ref_parcelle, Parcelle_Culturale, Operation_Famille, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout, SUM(Quantite_unite) AS totalQty FROM BR_Pointage WHERE 1=1 ${periodeFilter} GROUP BY Ref_parcelle, Parcelle_Culturale, Operation_Famille`),
          db.request().query(`SELECT CONVERT(date, Periode_Date) AS jour, Ref_parcelle, Parcelle_Culturale, Operation_Famille, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout FROM BR_Pointage WHERE 1=1 ${periodeFilter} GROUP BY CONVERT(date, Periode_Date), Ref_parcelle, Parcelle_Culturale, Operation_Famille ORDER BY jour`),
          // Lignes (jour, matricule, parcelle) pour compter des matricules DISTINCTS par jour
          // et par (jour, ferme) en JS — la ferme est dérivée en JS, pas une colonne SQL,
          // donc un GROUP BY ferme côté SQL n'est pas possible. Mirroir du chemin MIRROR.
          db.request().query(`SELECT DISTINCT CONVERT(date, Periode_Date) AS jour, Personnel_Matricule, Ref_parcelle, Parcelle_Culturale FROM BR_Pointage WHERE 1=1 ${periodeFilter}`),
          db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`),
        ]);
        // GATING PAIE (chef) : ce fallback SQL externe (USE_MIRROR=false, filet de
        // sécurité) agrège des recordsets bruts portant Ref_parcelle/Parcelle_Culturale
        // → ferme dérivable. On filtre CHAQUE recordset par la ferme du chef AVANT
        // agrégation (qFermes/parJour/totaux) pour cloisonner, cohérence fail-closed.
        // _fermeFilter null (RH/DG/Finance) → passthrough strict (inchangé).
        // _cultureFilter non null (chef_f5) → filtre culture additionnel après ferme.
        const summaryRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(summaryRes.recordset, _fermeFilter), _cultureFilter);
        const perDayRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(perDayRes.recordset, _fermeFilter), _cultureFilter);
        const perDayMatRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(perDayMatRes.recordset, _fermeFilter), _cultureFilter);
        const qFermes = { F1: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, F5: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, Avocatier: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, BAHIA: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 } };
        for (const row of summaryRows) { const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale); const type = classifyType(row.Operation_Famille); if (qFermes[ferme]) { qFermes[ferme].journees += row.totalJr || 0; qFermes[ferme].cout += row.totalCout || 0; qFermes[ferme][type] += row.totalJr || 0; } }
        // journees/cout = SOMMES sur les groupes (parcelle × op-famille) — INCHANGÉ.
        const dayMap = {};
        for (const row of perDayRows) { const d = new Date(row.jour); const key = d.toISOString().slice(0, 10); if (!dayMap[key]) dayMap[key] = { jour: key, jourLabel: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), nbOuv: 0, journees: 0, cout: 0, F1: 0, F5: 0, Avocatier: 0, BAHIA: 0 }; dayMap[key].journees += row.totalJr || 0; dayMap[key].cout += row.totalCout || 0; }
        // nbOuv (jour + par ferme) = matricules DISTINCTS via Set (corrige le gonflage :
        // on ne somme plus des COUNT(DISTINCT) par parcelle/op). Mirroir du chemin MIRROR.
        const daySets = {};
        for (const row of perDayMatRows) {
          const d = new Date(row.jour); const key = d.toISOString().slice(0, 10);
          if (!daySets[key]) daySets[key] = { nbOuv: new Set(), F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
          const mat = row.Personnel_Matricule;
          daySets[key].nbOuv.add(mat);
          const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale);
          if (daySets[key][ferme]) daySets[key][ferme].add(mat);
        }
        for (const key of Object.keys(daySets)) {
          if (!dayMap[key]) dayMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), nbOuv: 0, journees: 0, cout: 0, F1: 0, F5: 0, Avocatier: 0, BAHIA: 0 };
          const s = daySets[key];
          dayMap[key].nbOuv = s.nbOuv.size;
          dayMap[key].F1 = s.F1.size; dayMap[key].F5 = s.F5.size; dayMap[key].Avocatier = s.Avocatier.size; dayMap[key].BAHIA = s.BAHIA.size;
        }
        const perDay = Object.values(dayMap).sort((a, b) => a.jour.localeCompare(b.jour));
        const totalJournees = Object.values(qFermes).reduce((s, f) => s + f.journees, 0);
        const totalCout = Object.values(qFermes).reduce((s, f) => s + f.cout, 0);
        // summaryRows champs: totalJr / totalCout (SQL agrégé) → mapper pour buildParCulture
        const parCulture = buildParCulture(summaryRows.map(function(r) { return { Parcelle_Culturale: r.Parcelle_Culturale, Ref_parcelle: r.Ref_parcelle, Nombre_Jr: r.totalJr, Cout: r.totalCout, Operation_Famille: r.Operation_Famille }; }));
        return { success: true, periode: periodeParam || "latest", periodes: periodesRes.recordset.map(r => r.Periode_paie), totalJournees: Math.round(totalJournees), totalCout: Math.round(totalCout), parFerme: Object.entries(qFermes).map(([f, d]) => ({ ferme: f, journees: Math.round(d.journees), cout: Math.round(d.cout), recolte: Math.round(d.recolte), horsRecolte: Math.round(d.horsRecolte), postesFixes: Math.round(d.postesFixes) })), parJour: perDay, parCulture: parCulture };
        }); // end withCache
        return res.json(cached);
      }


      // ------ QUINZAINE-ANALYTIQUE: pivot parcelle x operation ------
      if (action === "quinzaine-analytique") {
        const periodeParam = req.query.periode;
        // Clé ferme-aware : les rows par parcelle/op dépendent de _fermeFilter.
        const cacheKey = pointageCacheKey(`pointage_quinzaine_analytique_${periodeParam || "latest"}`, _fermeFilter, _cultureFilter);
        const cached = await withCache(cacheKey, 5 * 60 * 1000, async () => {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.periodes || [];
          const periodeCampagne = (meta && meta.periodeCampagne) || {};
          const selectedPeriode = periodeParam || defaultPeriode(meta, periodes);
          if (!selectedPeriode) return { success: true, periode: null, periodes, periodeCampagne, rows: [] };
          // Label composite ("Quinzaine N (AAAA-BBBB)") : `Periode_paie` en SQL/mirror
          // ne contient jamais le suffixe. Le fetcher mirror résout déjà par les dates
          // exactes de periodeMap[selectedPeriode] (jamais par label), mais on filtre
          // quand même explicitement par ces dates en garde-fou — ne jamais faire
          // confiance au seul matching par label entre deux campagnes qui réutilisent
          // le même numéro de quinzaine.
          const { isComposite: selectedIsComposite } = splitCompositeLabel(selectedPeriode);
          const selectedExactDates = meta?.periodeMap?.[selectedPeriode];
          // Surfaces BR_Parcelle en parallèle des rows (fallback {} si BDR down)
          const [rawRowsRaw, supMap] = await Promise.all([
            getPointageRowsForPeriode(selectedPeriode),
            fetchBrParcelleSupMap(),
          ]);
          const rawRows = selectedIsComposite ? filterRowsByExactDates(rawRowsRaw, selectedExactDates) : rawRowsRaw;
          if (rawRows.length === 0) {
            // Check Firestore archive
            const archiveDoc = await archiveDocRef(selectedPeriode).get();
            if (archiveDoc.exists && archiveDoc.data().analytique) {
              // GATING PAIE (chef) : les rows archivées portent parcelle/refParcelle
              // → ferme dérivable. Sans filtrage, un chef verrait les parcelles/coûts
              // de toutes les fermes. Fail-closed : ferme dérivée ≠ _fermeFilter → exclue.
              // _fermeFilter null (RH/DG/Finance) → passthrough (inchangé).
              return { success: true, periode: selectedPeriode, periodes, periodeCampagne, rows: enrichRowsWithHaRef(filterArchivedRowsByFerme(archiveDoc.data().analytique, _fermeFilter), supMap) };
            }
          }
          // Group by parcelle+ref+opFamille+operation
          const groups = {};
          for (const r of rawRows) {
            const key = `${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Operation_Famille}|${r.Operation}`;
            if (!groups[key]) groups[key] = { Parcelle_Culturale: r.Parcelle_Culturale, Ref_parcelle: r.Ref_parcelle, Operation_Famille: r.Operation_Famille, Operation_Groupe: r.Operation_Groupe, Operation: r.Operation, workers: new Set(), JH: 0, Cout: 0 };
            groups[key].workers.add(r.Personnel_Matricule);
            groups[key].JH += r.Nombre_Jr || 0;
            groups[key].Cout += r.Cout || 0;
          }
          const rows = Object.values(groups).map(g => ({ parcelle: (g.Parcelle_Culturale || '').trim(), refParcelle: (g.Ref_parcelle || '').trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale), operationFamille: g.Operation_Famille, operationGroupe: g.Operation_Groupe || '', operation: g.Operation, nbOuv: g.workers.size, jh: Math.round(g.JH * 100) / 100, cout: Math.round(g.Cout) }));
          return { success: true, periode: selectedPeriode, periodes, periodeCampagne, rows: enrichRowsWithHaRef(rows, supMap) };
        }
        // SQL fallback
        const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
        const periodes = periodesRes.recordset.map(r => r.Periode_paie);
        const selectedPeriode = periodeParam || periodes[0];
        // Label composite jamais présent en SQL brut (Periode_paie) — matcher le label brut.
        const { rawLabel: selectedRawLabelSql } = splitCompositeLabel(selectedPeriode);
        const result = await db.request().query(`SELECT Parcelle_Culturale, Ref_parcelle, Operation_Famille, Operation_Groupe, Operation, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Jr) AS JH, SUM(Cout) AS Cout FROM BR_Pointage WHERE Periode_paie = N'${(selectedRawLabelSql || '').replace(/'/g, "''")}' GROUP BY Parcelle_Culturale, Ref_parcelle, Operation_Famille, Operation_Groupe, Operation ORDER BY Parcelle_Culturale, Operation_Famille`);
        // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). Les rows portent un champ
        // `ferme` dérivé → on cloisonne sur la ferme du chef (fail-closed), cohérence avec
        // le chemin mirror/archive. _fermeFilter null (RH/DG/Finance) → passthrough.
        const rows = filterByFermeField(result.recordset.map(r => ({ parcelle: (r.Parcelle_Culturale || '').trim(), refParcelle: (r.Ref_parcelle || '').trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), operationFamille: r.Operation_Famille, operationGroupe: r.Operation_Groupe || '', operation: r.Operation, nbOuv: r.nbOuv, jh: Math.round((r.JH || 0) * 100) / 100, cout: Math.round(r.Cout || 0) })), _fermeFilter);
        return { success: true, periode: selectedPeriode, periodes, rows: enrichRowsWithHaRef(rows, await fetchBrParcelleSupMap()) };
        }); // end withCache
        return res.json(cached);
      }


      // ------ HORS-RECOLTE: operations breakdown ------
      if (action === "hors-recolte") {
        // Charger le référentiel Firestore avant de construire les opérations
        await warmRefTaches();
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        // Clé ferme-aware : operations/effectifs dépendent de _fermeFilter.
        const cached = await withCache(pointageCacheKey(`pointage_hors_recolte_${dateForCheck}`, _fermeFilter), 10 * 60 * 1000, async () => {
          if (USE_MIRROR) {
            const rawRows = await getPointageRowsForDate(dateForCheck);
            const filtered = rawRows.filter(r => r.Operation_Famille !== "8. Récolte" && r.Operation_Famille !== "11. Postes fixes");
            const groups = {};
            for (const r of filtered) {
              const key = `${r.Operation_Famille}|${r.Operation}|${r.Ref_parcelle}|${r.Parcelle_Culturale}`;
              if (!groups[key]) groups[key] = { Operation_Famille: r.Operation_Famille, Operation_Groupe: r.Operation_Groupe, Operation: r.Operation, Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, workers: new Set(), totalHr: 0, totalJr: 0, totalCout: 0 };
              groups[key].workers.add(r.Personnel_Matricule);
              groups[key].totalHr += r.Nombre_Hr || 0;
              groups[key].totalJr += r.Nombre_Jr || 0;
              groups[key].totalCout += r.Cout || 0;
            }
            const ops = Object.values(groups).map(g => ({ operationFamille: g.Operation_Famille, famille: resolveFamily(g.Operation_Groupe, g.Operation_Famille), groupe: (_refMap[g.Operation_Groupe && g.Operation_Groupe.trim()] || {}).groupe || '', operation: g.Operation, effectif: g.workers.size, heures: g.totalHr, journees: g.totalJr, cout: Math.round(g.totalCout), parcelle: (g.Parcelle_Culturale || "").trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale) })).sort((a, b) => b.effectif - a.effectif);
            // Effectifs DISTINCTS (Set de matricules) — le front ne peut pas dédupliquer car
            // operations[].effectif est par (op×parcelle). On expose ici l'effectif distinct
            // global, par operationFamille, et par (ferme, famille) pour les vues filtrées.
            // heures/journees/cout restent des sommes côté front.
            const globalSet = new Set();
            const familleSets = {};
            const fermeSets = {};       // ferme -> Set global de la ferme
            const fermeFamilleSets = {}; // ferme -> famille -> Set
            for (const r of filtered) {
              const mat = r.Personnel_Matricule;
              const f = resolveFamily(r.Operation_Groupe, r.Operation_Famille);
              const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
              globalSet.add(mat);
              if (!familleSets[f]) familleSets[f] = new Set();
              familleSets[f].add(mat);
              if (!fermeSets[ferme]) fermeSets[ferme] = new Set();
              fermeSets[ferme].add(mat);
              if (!fermeFamilleSets[ferme]) fermeFamilleSets[ferme] = {};
              if (!fermeFamilleSets[ferme][f]) fermeFamilleSets[ferme][f] = new Set();
              fermeFamilleSets[ferme][f].add(mat);
            }
            const effectifParFamille = {};
            for (const f of Object.keys(familleSets)) effectifParFamille[f] = familleSets[f].size;
            const effectifDistinctParFerme = {};
            for (const ferme of Object.keys(fermeSets)) effectifDistinctParFerme[ferme] = fermeSets[ferme].size;
            const effectifFamilleParFerme = {};
            for (const ferme of Object.keys(fermeFamilleSets)) {
              effectifFamilleParFerme[ferme] = {};
              for (const f of Object.keys(fermeFamilleSets[ferme])) effectifFamilleParFerme[ferme][f] = fermeFamilleSets[ferme][f].size;
            }
            return { success: true, date: dateForCheck, operations: ops, effectifDistinct: globalSet.size, effectifParFamille, effectifDistinctParFerme, effectifFamilleParFerme };
          }
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const result = await db.request().query(`SELECT Operation_Famille, Operation_Groupe, Operation, Ref_parcelle, Parcelle_Culturale, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Hr) AS totalHr, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille != '8. Récolte' AND Operation_Famille != '11. Postes fixes' GROUP BY Operation_Famille, Operation_Groupe, Operation, Ref_parcelle, Parcelle_Culturale ORDER BY Operation_Famille, nbOuv DESC`);
          // Fail-closed : cohérence avec le shadow. En prod USE_MIRROR=true, mais on
          // filtre aussi cette branche SQL fallback par la ferme du chef.
          const ops = filterByFermeField(result.recordset.map(r => ({ operationFamille: r.Operation_Famille, famille: resolveFamily(r.Operation_Groupe, r.Operation_Famille), groupe: (_refMap[r.Operation_Groupe && r.Operation_Groupe.trim()] || {}).groupe || '', operation: r.Operation, effectif: r.nbOuv, heures: r.totalHr, journees: r.totalJr, cout: Math.round(r.totalCout || 0), parcelle: (r.Parcelle_Culturale || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) })), _fermeFilter);
          // Effectifs DISTINCTS : on ramène les couples DISTINCTS (matricule, famille, parcelle)
          // pour dériver la ferme en JS et compter via Set (global / par famille / par ferme).
          const matRes = await db.request().query(`SELECT DISTINCT Personnel_Matricule, Operation_Famille, Operation_Groupe, Ref_parcelle, Parcelle_Culturale FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille != '8. Récolte' AND Operation_Famille != '11. Postes fixes'`);
          const globalSet = new Set();
          const familleSets = {};
          const fermeSets = {};
          const fermeFamilleSets = {};
          for (const r of matRes.recordset) {
            const mat = r.Personnel_Matricule;
            const f = resolveFamily(r.Operation_Groupe, r.Operation_Famille);
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            // Fail-closed : un chef ne voit que sa ferme dans les effectifs distincts.
            if (_fermeFilter && ferme !== _fermeFilter) continue;
            globalSet.add(mat);
            if (!familleSets[f]) familleSets[f] = new Set();
            familleSets[f].add(mat);
            if (!fermeSets[ferme]) fermeSets[ferme] = new Set();
            fermeSets[ferme].add(mat);
            if (!fermeFamilleSets[ferme]) fermeFamilleSets[ferme] = {};
            if (!fermeFamilleSets[ferme][f]) fermeFamilleSets[ferme][f] = new Set();
            fermeFamilleSets[ferme][f].add(mat);
          }
          const effectifParFamille = {};
          for (const f of Object.keys(familleSets)) effectifParFamille[f] = familleSets[f].size;
          const effectifDistinctParFerme = {};
          for (const ferme of Object.keys(fermeSets)) effectifDistinctParFerme[ferme] = fermeSets[ferme].size;
          const effectifFamilleParFerme = {};
          for (const ferme of Object.keys(fermeFamilleSets)) {
            effectifFamilleParFerme[ferme] = {};
            for (const f of Object.keys(fermeFamilleSets[ferme])) effectifFamilleParFerme[ferme][f] = fermeFamilleSets[ferme][f].size;
          }
          return { success: true, date: dateForCheck, operations: ops, effectifDistinct: globalSet.size, effectifParFamille, effectifDistinctParFerme, effectifFamilleParFerme };
        });
        return res.json(cached);
      }


      // ------ REFERENTIEL-TACHES-LIST: liste complète des opérations du référentiel ------
      if (action === 'referentiel-taches-list') {
        const ref = await loadReferentielTaches();
        // `familles_par_code` = la table que `resolveFamily` utilise pour
        // attribuer une famille à une ligne de pointage BEE ONE. Exposée pour que
        // l'écran Budget résolve la famille d'une opération EXACTEMENT comme le
        // tableau Campagne — depuis le code GB, jamais depuis le champ `famille`
        // de la fiche (deux fiches peuvent porter le même libellé sous deux codes,
        // cf. « Nettoyage » GB05/GB11).
        const famillesParCode = {};
        Object.keys(ref.map || {}).forEach((code) => {
          famillesParCode[code] = (ref.map[code] || {}).famille || '';
        });
        return res.json({
          success: true,
          operations: ref.ops.sort((a, b) => a.ordre - b.ordre),
          familles_par_code: famillesParCode,
        });
      }


      // ------ SUIVI-TUNNELS: hors-récolte progress by parcelle/tâche for caporal screens ------
      if (action === "suivi-tunnels") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        const fermeParam = req.query.ferme;
        const cacheKey = `pointage_suivi_tunnels_${dateForCheck}_${fermeParam || 'all'}`;
        const cached = await withCache(cacheKey, 10 * 60 * 1000, async () => {
          if (USE_MIRROR) {
            const meta = await getPointageMeta();
            const earliestDate = meta?.availableDates?.[meta.availableDates.length - 1] || dateForCheck;
            const yesterdayStr = new Date(new Date(dateForCheck).getTime() - 86400000).toISOString().slice(0, 10);
            // Limit cumul range to 30 days max to avoid loading entire history
            const thirtyDaysAgo = new Date(new Date(dateForCheck).getTime() - 30 * 86400000).toISOString().slice(0, 10);
            const startDate = earliestDate > thirtyDaysAgo ? earliestDate : thirtyDaysAgo;
            const [todayRows, cumulRows] = await Promise.all([
              getPointageRowsForDate(dateForCheck),
              getPointageRowsForDateRange(startDate, yesterdayStr),
            ]);
            const filterHR = r => r.Operation_Famille !== "8. Récolte" && r.Operation_Famille !== "11. Postes fixes";
            // Today groups
            const todayGroups = {};
            for (const r of todayRows.filter(filterHR)) {
              const key = `${r.Operation}|${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Variete}`;
              if (!todayGroups[key]) todayGroups[key] = { ...r, workers: new Set(), quantiteRealisee: 0, totalHr: 0, totalJr: 0, totalCout: 0 };
              todayGroups[key].workers.add(r.Personnel_Matricule);
              todayGroups[key].quantiteRealisee += r.Quantite_unite || 0;
              todayGroups[key].totalHr += r.Nombre_Hr || 0;
              todayGroups[key].totalCout += r.Cout || 0;
            }
            // Cumul
            const cumulMap = {};
            for (const r of cumulRows.filter(filterHR)) {
              const key = `${(r.Parcelle_Culturale || '').trim()}_${r.Operation}`;
              if (!cumulMap[key]) cumulMap[key] = { quantiteCumul: 0, joursCumul: 0 };
              cumulMap[key].quantiteCumul += r.Quantite_unite || 0;
              cumulMap[key].joursCumul += r.Nombre_Jr || 0;
            }
            const byFerme = {};
            for (const g of Object.values(todayGroups)) {
              const ferme = deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale);
              if (fermeParam && ferme !== fermeParam) continue;
              if (!byFerme[ferme]) byFerme[ferme] = [];
              const parcelle = (g.Parcelle_Culturale || '').trim();
              const cumul = cumulMap[`${parcelle}_${g.Operation}`] || { quantiteCumul: 0 };
              byFerme[ferme].push({ parcelle, variete: g.Variete || parcelle, tache: g.Operation, nbOuvriers: g.workers.size, realiseAujourdhui: Math.round(g.quantiteRealisee), dejaRealise: Math.round(cumul.quantiteCumul), totalRealise: Math.round(cumul.quantiteCumul + g.quantiteRealisee), heures: g.totalHr, cout: Math.round(g.totalCout), ferme });
            }
            return { success: true, date: dateForCheck, tunnels: byFerme };
          }

          // SQL fallback
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const result = await db.request().query(`SELECT Operation, Parcelle_Culturale, Ref_parcelle, Variete, COUNT(DISTINCT Personnel_Matricule) AS nbOuvriers, SUM(Quantite_unite) AS quantiteRealisee, SUM(Nombre_Hr) AS totalHr, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille != N'8. Récolte' AND Operation_Famille != N'11. Postes fixes' GROUP BY Operation, Parcelle_Culturale, Ref_parcelle, Variete ORDER BY Parcelle_Culturale, Operation`);
          const cumulResult = await db.request().query(`SELECT Operation, Parcelle_Culturale, Ref_parcelle, SUM(Quantite_unite) AS quantiteCumul, SUM(Nombre_Jr) AS joursCumul FROM BR_Pointage WHERE CONVERT(date, Periode_Date) < ${dateSQL} AND Operation_Famille != N'8. Récolte' AND Operation_Famille != N'11. Postes fixes' GROUP BY Operation, Parcelle_Culturale, Ref_parcelle`);
          const cumulMap = {};
          for (const r of cumulResult.recordset) { cumulMap[`${(r.Parcelle_Culturale || '').trim()}_${r.Operation}`] = { quantiteCumul: r.quantiteCumul || 0, joursCumul: r.joursCumul || 0 }; }
          const byFerme = {};
          for (const r of result.recordset) {
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            if (fermeParam && ferme !== fermeParam) continue;
            if (!byFerme[ferme]) byFerme[ferme] = [];
            const parcelle = (r.Parcelle_Culturale || '').trim();
            const cumul = cumulMap[`${parcelle}_${r.Operation}`] || { quantiteCumul: 0 };
            byFerme[ferme].push({ parcelle, variete: r.Variete || parcelle, tache: r.Operation, nbOuvriers: r.nbOuvriers, realiseAujourdhui: Math.round(r.quantiteRealisee || 0), dejaRealise: Math.round(cumul.quantiteCumul), totalRealise: Math.round(cumul.quantiteCumul + (r.quantiteRealisee || 0)), heures: r.totalHr, cout: Math.round(r.totalCout || 0), ferme });
          }
          return { success: true, date: dateForCheck, tunnels: byFerme };
        });
        return res.json(cached);
      }


      // ------ RECOLTE-EQUIPES: harvest per worker per day for team tracking ------
      if (action === "recolte-equipes") {
        // Calcul + cache via la fonction partagée (même logique serving + warm).
        // 3 quinzaines, enrichissement prod, garde-fou shouldCacheRecolteEquipes.
        // GATING PAIE : clé de cache + payload cloisonnés par ferme du chef
        // (_fermeFilter). 'all' → clé/comportement inchangés (RH/DG/Finance).
        const reCacheSuffix = _fermeFilter || 'all';
        const cached = await withCache(
          `pointage_recolte_equipes_${reCacheSuffix}`,
          5 * 60 * 1000,
          () => computeRecolteEquipesPayload(3, _fermeFilter),
          shouldCacheRecolteEquipes
        );
        return res.json(cached);
      }


      // ------ TRANSPORT: all workers per day for transport cost calculation ------
      if (action === "transport") {
        // QUINZAINE DEMANDÉE (facultative) : l'écran Quinzaine peut consulter
        // n'importe quelle période, or ce payload ne chargeait que les DEUX plus
        // récentes. Au-delà, ses blocs Transport / Autres primes / Jours fériés
        // se vidaient — pendant que les KPI du haut, servis par l'action
        // `quinzaine` (qui charge la période demandée, elle), restaient justes.
        // Symptôme : « les totaux ont disparu sur Q1 et Q2, pas sur Q3 et Q4 ».
        // On charge donc « les 2 récentes + celle demandée » : le coût reste de
        // 2 à 3 quinzaines par appel, et toute quinzaine redevient consultable.
        const periodeDemandee = (req.query.periode || "").trim();
        // Clé ferme-aware : les rows nominatives (matricule/nom) dépendent de
        // _fermeFilter. Et clé PAR PÉRIODE demandée : deux quinzaines
        // différentes ne peuvent pas partager une entrée de cache.
        const _tCacheKey = pointageCacheKey("pointage_transport", _fermeFilter)
          + (periodeDemandee ? `_${periodeDemandee}` : "");
        const cached = await withCache(_tCacheKey, 0, async () => {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.periodes || [];
          const periodeCampagne = (meta && meta.periodeCampagne) || {};
          // Les 2 plus récentes, plus celle qu'on consulte si elle est ailleurs.
          // `allPeriodes` (et non `periodes`) : une quinzaine archivée n'est plus
          // dans le miroir courant, la demander doit rester sans effet plutôt
          // que de charger la mauvaise.
          const targetPeriodes = periodes.slice(0, 2);
          if (periodeDemandee && periodes.includes(periodeDemandee)
            && !targetPeriodes.includes(periodeDemandee)) {
            targetPeriodes.push(periodeDemandee);
          }
          const allRows = [];
          for (const p of targetPeriodes) {
            const pRows = await getPointageRowsForPeriode(p);
            allRows.push(...pRows);
          }
          // Group by matricule+day+periode+operation+parcelle (include parcelle in key to preserve all parcelles)
          const groups = {};
          for (const r of allRows) {
            const key = `${r.Personnel_Matricule}|${r.DateStr}|${r.Periode_paie}|${r.Operation_Famille}|${r.Operation}|${r.Parcelle_Culturale||''}`;
            if (!groups[key]) groups[key] = { Personnel_Matricule: r.Personnel_Matricule, Personnel_Nom: r.Personnel_Nom, DateStr: r.DateStr, Periode_paie: r.Periode_paie, Operation_Famille: r.Operation_Famille, Operation: r.Operation, Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale };
          }
          const rows = Object.values(groups).map(r => {
            const _ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            const _resolved = resolveVariete(r.Parcelle_Culturale, r.Ref_parcelle);
            // Décision métier : parcelle non identifiable sur F1/F5 → Framboise (cf. réaffectation Yasmin/Maravilla F5→F1)
            const _culture = (_resolved.culture && _resolved.culture !== 'Autre') ? _resolved.culture
              : (_ferme === 'Avocatier' || _ferme === 'BAHIA') ? 'Avocat' : 'Framboise';
            return { matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: r.DateStr, periode: r.Periode_paie, operationFamille: (r.Operation_Famille || "").trim(), operation: (r.Operation || "").trim(), ferme: _ferme, culture: _culture, parcelle: (r.Parcelle_Culturale || "").trim(), refParcelle: (r.Ref_parcelle || "").trim() };
          });
          const holidays = await getJoursFeries();
          const extras = computeChargCond(allRows, holidays);
          return { success: true, periodes, periodeCampagne, rows, ...extras };
        }
        // SQL fallback
        const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
        const periodes = periodesRes.recordset.map(r => r.Periode_paie);
        const result = await db.request().query(`SELECT Personnel_Matricule, MIN(Personnel_Nom) AS Personnel_Nom, CONVERT(date, Periode_Date) AS jour, Periode_paie, Operation_Famille, Operation, MIN(Ref_parcelle) AS Ref_parcelle, MIN(Parcelle_Culturale) AS Parcelle_Culturale FROM BR_Pointage GROUP BY Personnel_Matricule, CONVERT(date, Periode_Date), Periode_paie, Operation_Famille, Operation ORDER BY jour DESC`);
        // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). Rows NOMINATIVES avec
        // ferme dérivée → cloisonnement sur la ferme du chef (fail-closed), cohérence
        // avec le chemin mirror shadowé. _fermeFilter null (RH/DG/Finance) → passthrough.
        const rows = filterByFermeField(result.recordset.map(r => {
          const _ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
          const _resolved = resolveVariete(r.Parcelle_Culturale, r.Ref_parcelle);
          const _culture = (_resolved.culture && _resolved.culture !== 'Autre') ? _resolved.culture
            : (_ferme === 'Avocatier' || _ferme === 'BAHIA') ? 'Avocat' : 'Framboise';
          return { matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: new Date(r.jour).toISOString().slice(0, 10), periode: r.Periode_paie, operationFamille: (r.Operation_Famille || "").trim(), operation: (r.Operation || "").trim(), ferme: _ferme, culture: _culture, parcelle: (r.Parcelle_Culturale || "").trim(), refParcelle: (r.Ref_parcelle || "").trim() };
        }), _fermeFilter);
        return { success: true, periodes, rows };
        }); // end withCache
        return res.json(cached);
      }

  return NOT_HANDLED;
};
