/* Actions 3/4 de pointageRH — corps repris VERBATIM.
   Le contexte du handler arrive par `ctx` ; la destructuration ci-dessous
   recree exactement les liaisons d'origine. */
'use strict';
const { NOT_HANDLED } = require("./pointageService.dispatch");

module.exports = async function pointageServiceActions3(ctx) {
  const { req, res, action, dateParam, _fermeFilter, _cultureFilter, _keepPointage, _keepCulture, _keepCueillette, getPointageRowsForDate, getPointageRowsForDateRange, getPointageRowsForPeriode, getWorkerHistory, getCueilletteRows, db } = ctx;

  // Corps VERBATIM : ces noms venaient du scope englobant de l'ancien monolithe
  // pointageRH avant l'eclatement (commit 8a7284c). require() PAREsseux (pas en
  // haut de fichier) car pointageService.part1.js require CE fichier pour
  // construire __actions -- un require en tete de fichier recevrait un exports
  // encore vide (cycle). Les 5 fetchers gates (getPointageRowsForDate etc.)
  // restent EXCLUS d'ici : ils viennent de ctx (version filtree ferme/culture,
  // voir pointageService.js), jamais de la version brute de part1.
  const { HS_SEUIL_MINUTES, JOURS_FERIES_FALLBACK, POINTAGE_FERMES, REFERENTIEL_FAMILLES, REFERENTIEL_TTL_MS, USE_MIRROR, _getCueilletteRows, _getPointageRowsForDate, _getPointageRowsForDateRange, _getPointageRowsForPeriode, _getWorkerHistory, _qtkWarned, _refMap, _refTachesCache, _refTachesCacheAt, _referentielCache, _referentielLoadedAt, _supMapLastGood, admin, aggregateParcellesFromMirror, archiveDocRef, buildHalfToPeriode, buildHeuresSup, buildParCulture, buildPeriodeCampagne, campagneBudget, campagneBudgetCulture, campagneCourante, campagneExport, campagneOf, classifyType, computeAllowedMatricules, computeChargCond, computeDurationOvertime, consoAccessControl, consoBons, cors, countDistinctByFermeType, coutOuvrier, coutQuinzaineSnap, db_firestore, dedupeWorkersByMatricule, defaultPeriode, defaultPeriodeForCampagne, deriveFerme, detectFramboiseSubType, enrichRowsWithHaRef, fetchBrParcelleSupMap, fetchDetailFromMirror, fetchPostesFixesFromMirror, fetchSummaryFromMirror, fichierPaieStore, filterArchivedParFerme, filterArchivedParJour, filterArchivedRowsByFerme, filterByFermeField, filterMirrorRowsByCulture, filterMirrorRowsByFerme, filterPresenceRowsByAllowed, filterProdRowsByFerme, filterReposWorkersArchived, filterRowsByExactDates, findJourApres, findJourAvant, functions, getAvailableDates, getExcludedFonctionsHS, getJoursFeries, getPointageMeta, getPool, getSyncStatus, halfKey, invalidateReferentielCache, isSansEquipe, isValidCampagneLabel, loadReferentielCache, loadReferentielTaches, mapMirrorRowToDetail, mergeReferentiel, parcelleGroupSeedHa, parcelleGroupSplit, parcelleGroupValidate, pointageCacheKey, pool, quantiteToKg, recomposeArchivedTotals, recomposeProdTotalKg, referentielOperationsConnues, resolveCallerProfile, resolveFamily, resolveFermeFromParcelle, resolveHolidayPeriode, resolveMyrtilleVariete, resolvePointageRHAccess, resolveVariete, shouldExcludeWorkerDay, splitCompositeLabel, sql, sqlConfig, syncPointageFromProd, verifyAuth, warmRefTaches, withCache } = require("./pointageService.part1");


      // Initialisation des Ha MANQUANTS du référentiel depuis BEE ONE (DG/RH/admin).
      //
      // Pourquoi : le prorata des groupes de parcelles lit UNIQUEMENT
      // sb_parcelle_referentiel.ha ; une parcelle sans Ha SB est inéligible aux
      // groupes alors que le tableau affiche une surface… qui vient de BEE ONE.
      // On initialise donc une fois le référentiel avec la surface BEE ONE ; le
      // prorata continue ensuite de lire uniquement Smart Berry (règle produit
      // inchangée) et chaque Ha reste corrigeable via « Éditer ».
      //
      // PÉRIMÈTRE : les parcelles AFFICHÉES à l'écran (campagne sélectionnée),
      // dont le client envoie les LABELS dans `labels`. Le serveur ne découvre
      // plus les parcelles lui-même : sinon la simulation annonce des parcelles
      // absentes du tableau (l'écran affiche une campagne, la découverte en
      // couvrait deux). Le client n'envoie QUE des labels : la surface reste
      // résolue serveur via fetchBrParcelleSupMap() — un `ha` client ne doit
      // jamais atteindre Firestore.
      //
      // Sûreté : dry_run VRAI PAR DÉFAUT (champ absent → simulation), plan
      // calculé par une fonction pure IDEMPOTENTE (lib/parcelleGroupes/seedHa) :
      // une parcelle avec ha > 0 n'est jamais réécrite, une parcelle sans
      // surface source n'est jamais inventée, nom_sb n'est jamais touché.
      if (action === "sb-referentiel-seed-ha" && req.method === "POST") {
        const _authUserS = await verifyAuth(req);
        const callerProfileS = await resolveCallerProfile(_authUserS);
        const _pidS = callerProfileS && (callerProfileS.profileId || callerProfileS.role || '');
        if (!['dg', 'rh', 'admin'].includes(_pidS)) {
          return res.status(403).json({ success: false, error: "Accès refusé — DG/RH requis" });
        }
        // dry_run par défaut : seul un `dry_run: false` EXPLICITE écrit.
        const dryRunS = (req.body || {}).dry_run !== false;

        // Périmètre : labels des parcelles affichées (validation pure et testée
        // — liste de chaînes non vide, bornée, trimée, dédupliquée).
        const labelsS = parcelleGroupSeedHa.sanitizeLabels((req.body || {}).labels);
        if (!labelsS.ok) {
          return res.status(400).json({ success: false, error: labelsS.error });
        }

        // Surfaces BEE ONE : fetchBrParcelleSupMap est résilient (last-known-good
        // depuis sql_mirror_pointage_meta/br_parcelle_sup si le serveur BDR est
        // down) → une indisponibilité ne fait pas « disparaître » les surfaces,
        // au pire le plan est vide et on n'écrit rien.
        const [supMapS, sbSnapS] = await Promise.all([
          fetchBrParcelleSupMap(),
          db_firestore.collection("sb_parcelle_referentiel").get(),
        ]);
        const sbMapS = {};
        sbSnapS.forEach((doc) => {
          const d = doc.data() || {};
          const lbl = (d.label_bee_one || doc.id || "").toUpperCase().trim();
          if (lbl) sbMapS[lbl] = d;
        });

        const planS = parcelleGroupSeedHa.computeSeedPlan({
          labels: labelsS.labels, sbMap: sbMapS, supMap: supMapS,
        });

        if (!dryRunS && planS.toCreate.length > 0) {
          const FieldValueS = require("firebase-admin").firestore.FieldValue;
          const CHUNK_S = 400; // limite Firestore 500/batch, marge de 100
          for (let i = 0; i < planS.toCreate.length; i += CHUNK_S) {
            const batchS = db_firestore.batch();
            planS.toCreate.slice(i, i + CHUNK_S).forEach((c) => {
              const refS = db_firestore.collection("sb_parcelle_referentiel")
                .doc(parcelleGroupSeedHa.normLabel(c.label));
              // merge:true + aucun champ nom_sb → un nom SB déjà saisi survit.
              batchS.set(refS, {
                label_bee_one: c.label,
                ha: c.ha,
                seeded_from: c.source,
                updated_by: { uid: (_authUserS && _authUserS.uid) || null, profileId: _pidS },
                updated_at: FieldValueS.serverTimestamp(),
              }, { merge: true });
            });
            await batchS.commit();
          }
        }

        return res.json({
          success: true,
          dry_run: dryRunS,
          total_parcelles: planS.toCreate.length + planS.skipped.length,
          a_creer: planS.toCreate.map((c) => ({ label: c.label, ha: c.ha })),
          ignorees: planS.skipped,
        });
      }


      // ===== BUDGET JH / Ha PAR PARCELLE × FAMILLE × OPÉRATION =====
      // Collection `sb_campagne_budget_jh`, clé `${campagne}__${LABEL_BEE_ONE}`.
      // Deux niveaux COEXISTENT dans le même document, sans migration :
      //   `budgets`            = JH/Ha au niveau famille (documents du lot
      //                          précédent + familles sans détail, ex.
      //                          « Service générale ») ;
      //   `budgets_operations` = JH/Ha au niveau opération (famille → opération).
      //   `budgets_quinzaine`  = JH/Ha ENGAGÉS sur une quinzaine donnée
      //                          (quinzaine → famille), LOT 3b. Orthogonal aux
      //                          deux précédents : aucune contrainte de somme
      //                          avec le budget annuel, l'écart est une
      //                          information. Réservé aux cultures budgétées
      //                          (Framboise/Myrtille) — avocatier refusé côté
      //                          serveur, pas seulement masqué à l'écran.
      // Total d'une famille = somme de ses opérations si elle en porte, sinon
      // sa valeur de famille (campagneBudget.familleTotal) — jamais les deux.
      // La campagne fait partie de la clé (contrairement à
      // `sb_parcelle_referentiel`, clé par le seul label) : un budget est propre
      // à une campagne. Validation/merge purs : lib/campagneBudget/validate.
      //
      // Gating : ces deux actions ne sont PAS dans GATING_EXEMPT_ACTIONS — elles
      // passent donc par verifyAuth + resolvePerimetre + resolvePointageRHAccess
      // en amont (403 fail-closed pour tout profil hors périmètre). `_fermeFilter`
      // (chef) est appliqué ici aussi : lecture filtrée sur SA ferme, écriture
      // refusée.

      // Lecture des budgets d'une campagne (défaut : campagne courante).
      if (action === "campagne-budget-list" && req.method === "GET") {
        const campagneB = campagneBudget.normCampagne(req.query.campagne || campagneCourante());
        if (!campagneB) {
          return res.status(400).json({ success: false, error: "Campagne invalide" });
        }
        const snapB = await db_firestore.collection("sb_campagne_budget_jh")
          .where("campagne", "==", campagneB).get();
        // Référentiel (cache 1h) : sert UNIQUEMENT à ramener les clés d'opération
        // héritées (libellé nu) à leur forme canonique `CODE::Libellé` en lecture.
        // Aucune écriture, aucune purge ici — la conversion est en mémoire.
        const refListB = await loadReferentielTaches();
        const operationsConnuesListB = referentielOperationsConnues(refListB);
        const budgets = [];
        snapB.forEach((doc) => {
          const d = doc.data() || {};
          const label = d.label_bee_one || "";
          // Chef : cloisonnement ferme. deriveFerme retourne 'Autre' si la
          // parcelle n'est pas rattachable → exclue (fail-closed).
          if (_fermeFilter && deriveFerme(null, label, campagneB) !== _fermeFilter) return;
          // Chef Myrtille (chef_f5) : filtre culture additionnel, via le MÊME
          // helper que les lignes miroir (cf. _keepCulture) — un budget porte
          // le seul label, `filterMirrorRowsByCulture` sait le résoudre.
          if (_cultureFilter
            && filterMirrorRowsByCulture([{ Parcelle_Culturale: label }], _cultureFilter).length === 0) return;
          budgets.push({
            id: doc.id,
            campagne: d.campagne || campagneB,
            label_bee_one: label,
            // mergeBudgets(x, {}) / mergeBudgetsOperations(x, {}) = normalisation
            // en lecture (valeurs numériques > 0 seulement), aucune écriture.
            budgets: campagneBudget.mergeBudgets(d.budgets, {}),
            budgets_operations: campagneBudget.mergeBudgetsOperations(
              campagneBudget.canonicalizeOperationKeys(d.budgets_operations, operationsConnuesListB),
              {}
            ),
            // Budget de QUINZAINE (engagement court terme, maille famille).
            // Champ additif : absent des documents antérieurs → {} (aucune
            // migration). Les clés sont canonisées en lecture ('Q07').
            budgets_quinzaine: campagneBudget.mergeBudgetsQuinzaine(d.budgets_quinzaine, {}),
          });
        });
        budgets.sort((a, b) => (a.label_bee_one || "").localeCompare(b.label_bee_one || ""));
        return res.json({ success: true, campagne: campagneB, budgets });
      }


      // Upsert d'un budget (DG/RH/admin — même gate que sb-referentiel-save).
      if (action === "campagne-budget-save" && req.method === "POST") {
        const _authUserB = await verifyAuth(req);
        const callerProfileB = await resolveCallerProfile(_authUserB);
        const _pidB = callerProfileB && (callerProfileB.profileId || callerProfileB.role || '');
        if (!['dg', 'rh', 'admin'].includes(_pidB)) {
          return res.status(403).json({ success: false, error: "Accès refusé — DG/RH requis" });
        }
        // Défense en profondeur : un profil à périmètre restreint (chef) n'écrit
        // jamais, même si son profileId devenait un jour éligible ci-dessus.
        if (_fermeFilter) {
          return res.status(403).json({ success: false, error: "Accès refusé — périmètre restreint" });
        }

        const bodyB = req.body || {};
        // Familles ET COUPLES (code, opération) AUTORISÉS = référentiel des tâches
        // (jamais une liste figée en dur), la famille étant RÉSOLUE DEPUIS LE CODE
        // — exactement comme le tableau Campagne attribue une famille à une ligne
        // de pointage. C'est ce qui rend budget et réalisé inséparables.
        const refDataB = await loadReferentielTaches();
        const operationsConnuesB = referentielOperationsConnues(refDataB);
        const famillesConnuesB = [...new Set(operationsConnuesB.map((o) => o.famille))];
        // Labels AUTORISÉS = référentiel parcelles Smart Berry.
        const refSnapB = await db_firestore.collection("sb_parcelle_referentiel").get();
        const labelsConnusB = [];
        const sbMapB = {};
        refSnapB.forEach((doc) => {
          const d = doc.data() || {};
          const lbl = (d.label_bee_one || doc.id || "").trim();
          if (lbl) labelsConnusB.push(lbl);
          if (lbl) sbMapB[lbl.toUpperCase()] = d;
        });
        // CIBLES de l'enregistrement. `labels[]` = fan-out (saisie par variété ou
        // par culture : la même grille JH/Ha écrite sur N parcelles) ; à défaut,
        // le `label_bee_one` historique. Extension ADDITIVE de l'action : un body
        // d'un client antérieur emprunte exactement le même chemin.
        const rawLabelsB = Array.isArray(bodyB.labels) && bodyB.labels.length > 0
          ? bodyB.labels
          : [bodyB.label_bee_one];
        const ciblesB = campagneBudget.normFanoutLabels(
          rawLabelsB, campagneBudget.MAX_FANOUT_LABELS
        );
        if (!ciblesB.ok) {
          return res.status(400).json({ success: false, error: ciblesB.error });
        }

        /**
         * Enregistre le budget d'UNE parcelle. Ne décide JAMAIS du statut HTTP de
         * la requête : elle renvoie son verdict, et l'appelant décide au vu de
         * l'ensemble (un label refusé ne doit pas faire échouer les 22 autres).
         *
         * @param {string} label label BEE ONE brut de la cible.
         * @returns {Promise<Object>} `{ok:true, …réponse historique}` ou
         *   `{ok:false, label_bee_one, error}`.
         */
        async function saveOneBudget(label) {
          // Culture résolue PAR LABEL (miroir de CultureUtils,
          // lib/campagneBudget/culture.js : `culture_sb` prioritaire, sinon repli
          // sur le libellé). Elle ne sert QUE le gating avocatier du budget de
          // quinzaine, qui reste donc une décision par parcelle — sémantique
          // strictement inchangée par le fan-out. Le budget annuel, lui, reste
          // ouvert à toutes les cultures (473 valeurs en production, dont le
          // périmètre n'est pas modifié ici).
          const culture1 = campagneBudgetCulture.resolveCulture({ label }, sbMapB);
          const verdict1 = campagneBudget.validateBudgetSave({
            campagne: bodyB.campagne || campagneCourante(),
            label_bee_one: label,
            budgets: bodyB.budgets,
            budgets_operations: bodyB.budgets_operations,
            budgets_quinzaine: bodyB.budgets_quinzaine,
            culture: culture1,
            famillesConnues: famillesConnuesB,
            operationsConnues: operationsConnuesB,
            labelsConnus: labelsConnusB,
          });
          if (!verdict1.ok) {
            return { ok: false, label_bee_one: label, error: verdict1.error };
          }

          const docRef1 = db_firestore.collection("sb_campagne_budget_jh").doc(verdict1.docId);
          // Transaction : le merge lit l'existant (les familles absentes du body
          // sont conservées) — sans transaction, deux saves concurrents sur deux
          // familles différentes en perdraient une. L'écriture elle-même est dans
          // lib/campagneBudget (writeBudgetInTransaction) : elle utilise
          // `mergeFields` aux RACINES `budgets` / `budgets_operations` et NON
          // `{merge:true}`, sans quoi une famille — ou une opération — retirée
          // survivrait en base (masque de champs construit sur les feuilles).
          const write1 = await db_firestore.runTransaction((tx) =>
            campagneBudget.writeBudgetInTransaction(tx, docRef1, {
              campagne: verdict1.campagne,
              label: verdict1.label,
              budgets: verdict1.budgets,
              budgets_operations: verdict1.budgets_operations,
              budgets_quinzaine: verdict1.budgets_quinzaine,
              famillesConnues: famillesConnuesB,
              operationsConnues: operationsConnuesB,
              uid: (_authUserB && _authUserB.uid) || null,
              profileId: _pidB,
              serverTimestamp: require("firebase-admin").firestore.FieldValue.serverTimestamp(),
            })
          );

          // RELECTURE après commit : on renvoie l'état RÉELLEMENT persisté, jamais
          // le calculé. Un succès affiché par le client doit être prouvé — c'est
          // exactement ce qui masquait la survie des familles supprimées. Faite
          // PAR LABEL, y compris en fan-out : le client réaligne son écran sur
          // chaque relecture, jamais sur ce qu'il croyait envoyer.
          const after1 = await docRef1.get();
          const afterData1 = (after1.exists && after1.data()) || {};

          return {
            ok: true, id: verdict1.docId, campagne: verdict1.campagne,
            label_bee_one: verdict1.label,
            budgets: afterData1.budgets || {},
            budgets_operations: afterData1.budgets_operations || {},
            budgets_quinzaine: afterData1.budgets_quinzaine || {},
            familles_purgees: write1.purgees,
            operations_purgees: write1.operations_purgees,
            quinzaines_purgees: write1.quinzaines_purgees,
            // Valeurs de quinzaine réellement disparues (comparaison avant/après
            // dans la transaction) — une suppression de saisie n'est jamais
            // silencieuse, même quand elle est demandée.
            quinzaines_supprimees: write1.quinzaines_supprimees,
            // Valeurs de famille remplacées par le détail des opérations, et
            // purge reportée faute d'ampleur plausible : deux effets de bord
            // possibles d'un save, remontés pour être AFFICHÉS (jamais silencieux).
            familles_neutralisees: write1.familles_neutralisees,
            purge_differee: write1.purge_differee,
          };
        }

        // Boucle SÉQUENTIELLE (jamais Promise.all) : mémoire bornée, point de
        // défaillance déterministe, et aucun gain réel à paralléliser N
        // transactions mono-document. CONTINUE-ON-ERROR : s'arrêter au premier
        // échec laisserait le MÊME état partiel avec moins d'information.
        const resultsB = [];
        const echecsB = [];
        for (const cible1 of ciblesB.labels) {
          let r1;
          try {
            r1 = await saveOneBudget(cible1);
          } catch (e1) {
            r1 = {
              ok: false, label_bee_one: cible1,
              error: (e1 && e1.message) || "Erreur serveur",
            };
          }
          resultsB.push(r1);
          if (!r1.ok) echecsB.push({ label_bee_one: r1.label_bee_one, error: r1.error });
        }

        const okB = resultsB.filter((r) => r.ok);
        // ZÉRO écriture → 400, avec l'erreur du premier refus : c'est la réponse
        // d'aujourd'hui pour un body mono-label.
        if (okB.length === 0) {
          return res.status(400).json({
            success: false, error: echecsB[0].error,
            results: resultsB, echecs: echecsB, nb_demandees: ciblesB.labels.length,
          });
        }
        // Au moins une écriture → HTTP 200 et `success: true`, c'est la vérité du
        // système. Les échecs voyagent dans `echecs` et c'est au CLIENT de ne
        // jamais afficher un succès partiel en vert (cf. CBT_fanoutMessage).
        // RÉTRO-COMPATIBILITÉ : les champs du premier succès restent à la racine,
        // donc un body mono-`label_bee_one` produit la réponse d'aujourd'hui aux
        // champs additifs près, et un client antérieur continue de fonctionner.
        const { ok: _okIgnoreB, ...premierB } = okB[0];
        return res.json({
          success: true,
          ...premierB,
          results: resultsB,
          echecs: echecsB,
          nb_demandees: ciblesB.labels.length,
        });
      }


      // ===== GROUPES DE PARCELLES (raccourci de saisie du Bon de Consommation) =====
      // Un groupe = N parcelles réelles traitées en une seule application. À la
      // saisie d'un BC, create-bc éclate la ligne en N lignes de parcelles
      // RÉELLES, quantités au prorata des Ha (functions/lib/parcelleGroupes).
      // Le groupe n'est JAMAIS persisté comme une parcelle.
      //
      // Base du prorata = uniquement le `ha` de sb_parcelle_referentiel (pas de
      // fallback surface BEE ONE) → une parcelle sans Ha SB > 0 ne peut pas
      // entrer dans un groupe. Les Ha ne sont pas figés dans le groupe : ils
      // sont relus à chaque lecture/saisie (une correction se propage).

      // Liste des groupes ACTIFS + Ha/pct résolus (lecture : tout profil
      // authentifié — le magasinier en a besoin ; cf. GATING_EXEMPT_ACTIONS).
      if (action === "sb-groupes-list") {
        const _gu = await verifyAuth(req);
        if (!_gu) return res.status(401).json({ success: false, error: "Non authentifié" });
        const [grpSnap, refSnap] = await Promise.all([
          db_firestore.collection("sb_parcelle_groupes").get(),
          db_firestore.collection("sb_parcelle_referentiel").get(),
        ]);
        const haByLabel = {};
        refSnap.forEach((doc) => {
          const d = doc.data() || {};
          const lbl = (d.label_bee_one || doc.id || "").toUpperCase().trim();
          if (lbl) haByLabel[lbl] = parseFloat(d.ha) || 0;
        });
        const groupes = [];
        grpSnap.forEach((doc) => {
          const d = doc.data() || {};
          if (d.actif === false) return;
          const membres = (d.membres || []).map((lbl) => ({
            label: lbl,
            ha: haByLabel[(lbl || "").toUpperCase().trim()] || 0,
          }));
          let parts = [];
          let totalHa = 0;
          try {
            parts = parcelleGroupSplit.computeParts(membres);
            totalHa = parcelleGroupSplit.totalHa(membres);
          } catch (e) {
            // Ha manquant sur un membre (Ha effacé après création du groupe) :
            // on renvoie quand même le groupe, marqué invalide → le front le
            // grise et le backend refusera l'éclatement avec un message clair.
            parts = [];
            totalHa = 0;
          }
          groupes.push({
            id: doc.id,
            label: d.label || doc.id,
            membres,
            parts,
            total_ha: Math.round(totalHa * 100) / 100,
            valide: parts.length > 0,
            actif: true,
          });
        });
        groupes.sort((a, b) => (a.label || "").localeCompare(b.label || ""));
        return res.json({ success: true, groupes });
      }


      // ANCIENNETÉ CUMULÉE — journées travaillées DEPUIS le socle du registre.
      //
      // L'écran Quinzaine appliquait `trouverPalierAnciennete(baselineJours)` :
      // le socle SEUL, figé au 30/04/2026. L'ancienneté n'y progressait donc
      // jamais. L'écran Campagne, lui, cumule déjà — nos deux écrans ne
      // donnaient pas la même ancienneté au même ouvrier.
      //
      // Mesuré le 2026-08-22 : le matricule 3607 est à 606 jours de socle et a
      // pointé 111 journées depuis. À 717 il franchit le seuil des 624 (5 %) —
      // ce que la paie lui verse, et que la Quinzaine lui refusait.
      //
      // ⚠️ On cumule depuis `baselineDate`, PAS depuis le début de campagne :
      // le socle date du 30/04 et la campagne commence le 01/07. Partir de la
      // campagne perdrait mai et juin — 59 journées pour le seul 3607, et le
      // matricule 2296 resterait sous son seuil à tort.
      if (action === "anciennete-cumul") {
        const jusqua = String(req.query.jusqua || '').match(/^\d{4}-\d{2}-\d{2}$/)
          ? String(req.query.jusqua) : new Date().toISOString().slice(0, 10);
        const cachedA = await withCache(
          `anciennete_cumul_v1_${jusqua}`,
          6 * 60 * 60 * 1000,
          async () => {
            // Socles : on ne lit QUE les dates, pas les fiches entières.
            const regSnap = await db_firestore.collection('ouvriers_registry').get();
            const socles = {};
            let plusAncien = jusqua;
            regSnap.forEach((doc) => {
              const d = doc.data() || {};
              const dt = String(d.baselineDate || '');
              if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) return;
              socles[coutOuvrier.cleRegistre(doc.id)] = dt;
              if (dt < plusAncien) plusAncien = dt;
            });

            // Journées DISTINCTES par ouvrier, du lendemain du socle à `jusqua`.
            // Une journée est comptée une fois, quel que soit le nombre de
            // lignes de pointage : c'est l'assiette de l'ancienneté, comme celle
            // de la paie.
            const cumul = {};
            const vusParJour = {};
            const d0 = new Date(plusAncien + 'T00:00:00Z');
            d0.setUTCDate(d0.getUTCDate() + 1);
            const dFin = new Date(jusqua + 'T00:00:00Z');
            const jours = [];
            for (let d = d0; d <= dFin; d.setUTCDate(d.getUTCDate() + 1)) {
              jours.push(d.toISOString().slice(0, 10));
            }
            const LOT_J = 15;
            for (let i = 0; i < jours.length; i += LOT_J) {
              const lot = jours.slice(i, i + LOT_J);
              const snaps = await Promise.all(lot.map((j) =>
                db_firestore.collection('sql_mirror_pointage').doc(j).get()));
              snaps.forEach((snap, k) => {
                if (!snap.exists) return;
                const jour = lot[k];
                const vus = new Set();
                (snap.data().rows || []).forEach((r) => {
                  const m = coutOuvrier.cleRegistre(r.Personnel_Matricule);
                  if (!m || vus.has(m)) return;
                  vus.add(m);
                  // Chaque ouvrier ne compte QUE les journées postérieures à SON
                  // socle : ils ne sont pas tous datés du même jour.
                  const socle = socles[m];
                  if (!socle || jour <= socle) return;
                  cumul[m] = (cumul[m] || 0) + 1;
                });
                vusParJour[jour] = vus.size;
              });
            }
            return { success: true, jusqua, socles, cumul, joursLus: Object.keys(vusParJour).length };
          }
        );
        return res.json(cachedA);
      }


      // FICHIER DE PAIE CONSERVÉ — déposé une fois, exploitable ensuite par tous.
      //
      // ⚠️ On ne conserve NI NOM NI RIB. Le classeur porte une feuille VIREMENT
      // avec les coordonnées bancaires de 250 personnes ; le module de
      // normalisation applique une liste blanche stricte (matricule, journées,
      // montants). Décision d'Omar, 2026-08-22 : une donnée bancaire conservée
      // devient une responsabilité permanente, et le rapprochement n'en a aucun
      // besoin.
      if (action === "paie-fichier-save" && req.method === "POST") {
        const _authUserF = await verifyAuth(req);
        const callerProfileF = await resolveCallerProfile(_authUserF);
        const _pidF = callerProfileF && (callerProfileF.profileId || callerProfileF.role || '');
        if (!['dg', 'rh', 'finance', 'admin'].includes(_pidF)) {
          return res.status(403).json({ success: false, error: "Accès refusé — DG/RH/Finance requis" });
        }
        if (_fermeFilter) {
          return res.status(403).json({ success: false, error: "Accès refusé — périmètre restreint" });
        }

        const impF = fichierPaieStore.normaliser(req.body || {});
        const vF = fichierPaieStore.valider(impF);
        if (!vF.ok) {
          // 400 et la RAISON : un refus muet laisserait le RH redéposer
          // indéfiniment le même fichier sans savoir ce qui cloche.
          return res.status(400).json({ success: false, error: vF.raison });
        }
        const docF = fichierPaieStore.versDocument(impF, new Date().toISOString(), {
          uid: (_authUserF && _authUserF.uid) || null,
          profileId: _pidF,
          email: (_authUserF && _authUserF.email) || '',
        });
        await db_firestore.collection("rh_paie_fichier")
          .doc(impF.periode).set(docF, { merge: false });
        return res.json({ success: true, periode: impF.periode, totaux: docF.totaux });
      }


      // Lecture des fichiers conservés. AGRÉGATS et lignes par MATRICULE, sans
      // aucune donnée nominative — même gate de lecture que les autres actions
      // de cet écran.
      if (action === "paie-fichier") {
        const snapsF = await db_firestore.collection("rh_paie_fichier").get();
        const docsF = [];
        snapsF.forEach((d) => docsF.push(d.data() || {}));
        // `detail=1` sert les lignes par ouvrier (analyse du résidu). Sans lui,
        // on ne rend que les agrégats : un payload de 210 lignes par quinzaine
        // n'a pas à traverser le réseau pour afficher six totaux.
        if (String(req.query.detail || '') === '1') {
          return res.json({ success: true, fichiers: docsF });
        }
        return res.json({
          success: true,
          parPeriode: fichierPaieStore.parPeriode(docsF),
        });
      }


      // INSTANTANÉ DU COÛT DE QUINZAINE — écrit par l'écran Quinzaine lui-même.
      //
      // L'écran Campagne ne RECALCULE plus ce total : trois tentatives de le
      // reproduire ont produit trois divergences (transport résolu au mauvais
      // format de date, préfixe d'équipe deviné, part salariale comptée d'un
      // côté seulement). L'écran qui fait foi enregistre son chiffre, l'autre le
      // relit. L'écart affiché redevient un écart RÉEL entre deux mesures.
      if (action === "cout-quinzaine-save" && req.method === "POST") {
        const _authUserQ = await verifyAuth(req);
        const callerProfileQ = await resolveCallerProfile(_authUserQ);
        const _pidQ = callerProfileQ && (callerProfileQ.profileId || callerProfileQ.role || '');
        // Mêmes profils que ceux qui VOIENT l'écran Quinzaine : on enregistre ce
        // qu'ils ont sous les yeux, on n'ouvre aucun accès nouveau.
        if (!['dg', 'rh', 'finance', 'admin'].includes(_pidQ)) {
          return res.status(403).json({ success: false, error: "Accès refusé — DG/RH/Finance requis" });
        }
        // Un profil à périmètre restreint ne voit qu'une ferme : son total EST un
        // sous-total, quoi qu'il déclare.
        if (_fermeFilter) {
          return res.status(403).json({ success: false, error: "Accès refusé — périmètre restreint" });
        }

        const snapQ = coutQuinzaineSnap.normaliser(req.body || {});
        const vQ = coutQuinzaineSnap.valider(snapQ);
        if (!vQ.ok) {
          // 400 et la RAISON : un refus muet laisserait l'écran Campagne afficher
          // « — » sans que personne ne sache quoi corriger.
          return res.status(400).json({ success: false, error: vQ.raison });
        }

        const docQ = coutQuinzaineSnap.versDocument(snapQ, new Date().toISOString(), {
          uid: (_authUserQ && _authUserQ.uid) || null,
          profileId: _pidQ,
          email: (_authUserQ && _authUserQ.email) || '',
        });
        await db_firestore.collection("rh_cout_quinzaine")
          .doc(snapQ.periode).set(docQ, { merge: false });
        return res.json({ success: true, periode: snapQ.periode, enregistre: docQ });
      }


      // Lecture des instantanés — sert le panneau de rapprochement de l'écran
      // Campagne. AGRÉGAT par quinzaine, aucune donnée nominative : même
      // exemption de gate que `campagne-cout-ouvrier`, qui alimente le même écran.
      if (action === "cout-quinzaine") {
        const snapsQ = await db_firestore.collection("rh_cout_quinzaine").get();
        const docsQ = [];
        snapsQ.forEach((d) => docsQ.push(d.data() || {}));
        return res.json({
          success: true,
          parPeriode: coutQuinzaineSnap.parPeriode(docsQ),
        });
      }


      // Création / édition d'un groupe (DG/RH/admin — même gate que sb-referentiel-save)
      if (action === "sb-groupe-save" && req.method === "POST") {
        const _authUserG = await verifyAuth(req);
        const callerProfileG = await resolveCallerProfile(_authUserG);
        const _pidG = callerProfileG && (callerProfileG.profileId || callerProfileG.role || '');
        if (!['dg', 'rh', 'admin'].includes(_pidG)) {
          return res.status(403).json({ success: false, error: "Accès refusé — DG/RH requis" });
        }
        const body = req.body || {};
        // Ha : chaque membre DOIT exister dans sb_parcelle_referentiel avec ha > 0.
        const [refSnapG, grpSnapG] = await Promise.all([
          db_firestore.collection("sb_parcelle_referentiel").get(),
          db_firestore.collection("sb_parcelle_groupes").get(),
        ]);
        const haByLabelG = {};
        refSnapG.forEach((doc) => {
          const d = doc.data() || {};
          const lbl = (d.label_bee_one || doc.id || "").toUpperCase().trim();
          if (lbl) haByLabelG[lbl] = parseFloat(d.ha) || 0;
        });
        const groupesExistants = grpSnapG.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
        // Validation PURE (unicité du nom, ≥ 2 membres, Ha > 0, appartenance
        // exclusive) — testée dans lib/parcelleGroupes/__tests__/validate.test.js.
        const verdict = parcelleGroupValidate.validateGroupeSave({
          id: body.id,
          label: body.label,
          membres: body.membres,
          haByLabel: haByLabelG,
          groupes: groupesExistants,
        });
        if (!verdict.ok) {
          return res.status(400).json({ success: false, error: verdict.error });
        }
        await db_firestore.collection("sb_parcelle_groupes").doc(verdict.docId).set({
          label: verdict.label,
          membres: verdict.membres,
          actif: true,
          updated_by: { uid: (_authUserG && _authUserG.uid) || null, profileId: _pidG },
          updated_at: require("firebase-admin").firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return res.json({ success: true, id: verdict.docId, label: verdict.label, membres: verdict.membres });
      }


      // Suppression d'un groupe = SOFT DELETE (les BC passés référencent l'id).
      if (action === "sb-groupe-delete" && req.method === "POST") {
        const _authUserD = await verifyAuth(req);
        const callerProfileD = await resolveCallerProfile(_authUserD);
        const _pidD = callerProfileD && (callerProfileD.profileId || callerProfileD.role || '');
        if (!['dg', 'rh', 'admin'].includes(_pidD)) {
          return res.status(403).json({ success: false, error: "Accès refusé — DG/RH requis" });
        }
        const idD = typeof (req.body || {}).id === "string" ? req.body.id.trim() : "";
        if (!idD) return res.status(400).json({ success: false, error: "id du groupe requis" });
        const docRefD = db_firestore.collection("sb_parcelle_groupes").doc(idD);
        const snapD = await docRefD.get();
        if (!snapD.exists) return res.status(404).json({ success: false, error: "Groupe introuvable" });
        await docRefD.set({
          actif: false,
          updated_by: { uid: (_authUserD && _authUserD.uid) || null, profileId: _pidD },
          updated_at: require("firebase-admin").firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return res.json({ success: true, id: idD });
      }


      // la campagne sélectionnée (référentiel parcelle_ferme_referentiel encore vide,
      // serveur BEE ONE down). LEFT-JOIN référentiel pour enrichir surface_ha /
      // campagne_assignee — surface « manquante » tant que le pull BEE ONE n'a pas
      // tourné (dégradé gracieux voulu, spec §7.2).
      // Cloisonnement : _fermeFilter (chef → ses parcelles) déjà appliqué via le
      // shadow de getPointageRowsForDate (fail-closed). DG/RH → toutes.
      if (action === "parcelles-params-list") {
        const campagne = req.query.campagne || campagneCourante();
        if (!isValidCampagneLabel(campagne)) {
          return res.status(400).json({ success: false, error: "Campagne invalide" });
        }
        // Toutes les dates de la campagne (année fiscale 1er juil → 30 juin).
        const start = `${campagne.slice(0, 4)}-07-01`;
        const end = `${campagne.slice(5, 9)}-06-30`;
        // getPointageRowsForDateRange est shadowé (filtré ferme) quand _fermeFilter.
        const rawRows = await getPointageRowsForDateRange(start, end);
        const parcelles = aggregateParcellesFromMirror(rawRows, deriveFerme, campagne);
        // LEFT-JOIN référentiel : lire les docs de la campagne (clé `${campagne}__${ref}`).
        const refByKey = new Map();
        try {
          const refSnap = await db_firestore.collection("parcelle_ferme_referentiel")
            .where("campagne", "==", campagne).get();
          refSnap.forEach((doc) => { refByKey.set(doc.id, doc.data() || {}); });
        } catch (e) {
          // Référentiel illisible → toutes surfaces « manquantes » (dégradé gracieux).
          console.error("[parcelles-params-list] référentiel illisible:", e.message);
        }
        const merged = mergeReferentiel(parcelles, refByKey, campagne);
        return res.json({ success: true, campagne, parcelles: merged, count: merged.length });
      }


      // ------ ASSIGN-CAMPAGNE-PARCELLE : assignation campagne (ÉCRITURE, gatée DG/admin) ------
      // SEULE saisie SB de l'écran (spec §4/§7.1). Rôle : DG + admin uniquement
      // (chef/RH/finance → 403). Upsert merge dans parcelle_ferme_referentiel
      // (source:'manual' protège d'un écrasement au sync). Ne touche PAS surface_ha
      // (authoritative BEE ONE).
      if (action === "assign-campagne-parcelle") {
        // Re-résout le profil du caller (le _callerProfile du bloc de gating est
        // hors scope). Auth déjà exigée en amont (action non exemptée).
        const _wu = await verifyAuth(req);
        const _wProfile = await resolveCallerProfile(_wu);
        const _isDG = _wProfile && (_wProfile.profileId === "dg" || _wProfile.role === "admin");
        if (!_isDG) {
          return res.status(403).json({ success: false, error: "Réservé DG/admin" });
        }
        const body = req.body || {};
        const ref = (body.ref == null ? "" : String(body.ref)).trim();
        const campagneCible = (body.campagne == null ? "" : String(body.campagne)).trim();
        if (!ref) return res.status(400).json({ success: false, error: "ref manquant" });
        if (!isValidCampagneLabel(campagneCible)) {
          return res.status(400).json({ success: false, error: "Campagne cible invalide" });
        }
        // La clé du doc utilise la campagne D'ORIGINE (où la parcelle est listée),
        // pas la cible : c'est le doc de CETTE parcelle-campagne que l'on annote.
        const campagneOrigine = (body.campagne_origine == null ? campagneCible : String(body.campagne_origine)).trim();
        if (!isValidCampagneLabel(campagneOrigine)) {
          return res.status(400).json({ success: false, error: "Campagne d'origine invalide" });
        }
        const docId = `${campagneOrigine}__${ref}`;
        try {
          await db_firestore.collection("parcelle_ferme_referentiel").doc(docId).set({
            campagne: campagneOrigine,
            ref_parcelle: ref,
            campagne_assignee: campagneCible,
            campagne_assignee_by: {
              uid: (_wu && _wu.uid) || null,
              name: (_wProfile && _wProfile.profileId) || null,
            },
            campagne_assignee_at: admin.firestore.FieldValue.serverTimestamp(),
            source: "manual",
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (e) {
          console.error("[assign-campagne-parcelle] échec écriture:", e.message);
          return res.status(500).json({ success: false, error: "Échec de l'écriture" });
        }
        // Invalide le cache référentiel mémoire (l'override manual peut changer un rattachement futur).
        invalidateReferentielCache();
        return res.json({ success: true, ref, campagne_assignee: campagneCible });
      }


      // ---- GET referentiel-unresolved : liste les Ref_parcelle non résolus ----
      // Requiert auth role 'dg' ou 'rh'.
      if (action === 'referentiel-unresolved' && req.method === 'GET') {
        const _au = await verifyAuth(req);
        const _cp = await resolveCallerProfile(_au);
        const _pid = _cp && (_cp.profileId || _cp.role || '');
        const _allowed = _pid === 'dg' || _pid === 'rh' || _pid === 'admin';
        if (!_allowed) {
          return res.status(403).json({ success: false, error: 'Réservé DG/RH' });
        }
        const metaSnap = await db_firestore.collection('parcelle_ferme_referentiel_meta').doc('state').get();
        if (!metaSnap.exists) {
          return res.json({ success: true, unresolvedRefs: [], unresolvedCount: 0, campagne: null, lastSyncAt: null });
        }
        const meta = metaSnap.data();
        return res.json({
          success: true,
          unresolvedRefs: meta.unresolvedRefs || [],
          unresolvedCount: typeof meta.unresolvedCount === 'number' ? meta.unresolvedCount : (meta.unresolvedRefs || []).length,
          campagne: meta.campagne || null,
          lastSyncAt: meta.lastSyncAt || null,
        });
      }


      // ---- POST referentiel-override-ferme : rattachement manuel d'une parcelle à une ferme ----
      // Requiert auth role 'dg' (admin uniquement).
      if (action === 'referentiel-override-ferme' && req.method === 'POST') {
        const _au = await verifyAuth(req);
        const _cp = await resolveCallerProfile(_au);
        const _pid = _cp && (_cp.profileId || _cp.role || '');
        if (_pid !== 'dg' && _pid !== 'admin') {
          return res.status(403).json({ success: false, error: 'Réservé DG/admin' });
        }
        const VALID_FERMES = ['F1', 'F5', 'Avocatier', 'BAHIA'];
        const body = req.body || {};
        const refParcelle = (body.ref_parcelle == null ? '' : String(body.ref_parcelle)).trim();
        const ferme = (body.ferme == null ? '' : String(body.ferme)).trim();
        const campagne = (body.campagne == null ? '' : String(body.campagne)).trim();
        if (!refParcelle) return res.status(400).json({ success: false, error: 'ref_parcelle manquant' });
        if (!ferme || VALID_FERMES.indexOf(ferme) < 0) {
          return res.status(400).json({ success: false, error: 'ferme invalide. Valeurs acceptées : ' + VALID_FERMES.join(', ') });
        }
        if (!campagne || !isValidCampagneLabel(campagne)) {
          return res.status(400).json({ success: false, error: 'campagne invalide (ex: 2026-2027)' });
        }
        const docId = `${campagne}__${refParcelle}`;
        try {
          await db_firestore.collection('parcelle_ferme_referentiel').doc(docId).set({
            source: 'manual',
            ferme,
            confidence: 'manual',
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
            ref_parcelle: refParcelle,
            campagne,
          }, { merge: true });
        } catch (e) {
          console.error('[referentiel-override-ferme] échec écriture:', e.message);
          return res.status(500).json({ success: false, error: 'Échec de l\'écriture' });
        }
        // Invalide le cache référentiel mémoire pour que le nouvel override soit pris en compte.
        invalidateReferentielCache();
        return res.json({ success: true, docId, ferme });
      }


      // ---- POST force-sync-periode : déclenche un pull BDP → mirror live sur une période ----
      // Réservé DG. Permet de ré-synchroniser une quinzaine depuis BEE ONE sans passer par admin secret.
      if (action === 'force-sync-periode' && req.method === 'POST') {
        const _fau = await verifyAuth(req);
        const _fcp = await resolveCallerProfile(_fau);
        const _fpid = _fcp && (_fcp.profileId || _fcp.role || '');
        if (_fpid !== 'dg') {
          return res.status(403).json({ success: false, error: 'Réservé DG uniquement' });
        }

        const body = req.body || {};
        let syncFrom = (body.from == null ? '' : String(body.from)).trim();
        let syncTo = (body.to == null ? '' : String(body.to)).trim();

        // Si from/to absents, résoudre via periodeMap dans le meta Firestore.
        if (!syncFrom || !syncTo) {
          const periode = (body.periode == null ? '' : String(body.periode)).trim();
          if (!periode) {
            return res.status(400).json({ success: false, error: 'Fournir soit {from, to} soit {periode}' });
          }
          const metaDoc = await db_firestore.collection('sql_mirror_pointage_meta').doc('config').get();
          if (!metaDoc.exists) {
            return res.status(404).json({ success: false, error: 'Meta Firestore introuvable (sql_mirror_pointage_meta/config)' });
          }
          const metaData = metaDoc.data() || {};
          const periodeMap = metaData.periodeMap || {};
          const dates = periodeMap[periode];
          if (!dates || !Array.isArray(dates) || dates.length === 0) {
            return res.status(404).json({ success: false, error: 'Période introuvable dans periodeMap : ' + periode });
          }
          const sorted = dates.slice().sort();
          syncFrom = sorted[0];
          syncTo = sorted[sorted.length - 1];
        }

        // Validation format YYYY-MM-DD
        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
        if (!DATE_RE.test(syncFrom) || !DATE_RE.test(syncTo)) {
          return res.status(400).json({ success: false, error: 'Format de date invalide — attendu YYYY-MM-DD' });
        }
        if (syncFrom > syncTo) {
          return res.status(400).json({ success: false, error: 'from doit être <= to' });
        }
        // Plage max 16 jours (quinzaine + marge)
        const msPerDay = 86400000;
        const diffDays = Math.round((new Date(syncTo) - new Date(syncFrom)) / msPerDay);
        if (diffDays > 16) {
          return res.status(400).json({ success: false, error: 'Plage trop large (' + diffDays + ' jours). Maximum 16 jours.' });
        }

        console.log('[force-sync-periode] DG ' + (_fcp.name || _fau.uid) + ' → ' + syncFrom + ' → ' + syncTo + ' (live)');
        try {
          const result = await syncPointageFromProd(db_firestore, { from: syncFrom, to: syncTo, target: 'live' });
          // syncPointageFromProd() n'a JAMAIS levé d'exception (catch interne, cf.
          // pointageBdpSync.js) : elle renvoie {success:false, error} en cas d'échec.
          // Avant ce fix, ce cas était ignoré et l'appelant recevait {success:true}
          // avec des compteurs à 0 — le front affichait "Sync terminée — 0 lignes"
          // comme un succès alors que le pull BDP avait réellement échoué.
          if (!result || !result.success) {
            const errMsg = (result && result.error) || 'Échec de synchronisation (raison inconnue)';
            console.error('[force-sync-periode] échec sync:', errMsg);
            return res.status(500).json({ success: false, error: errMsg });
          }
          return res.json({
            success: true,
            from: syncFrom,
            to: syncTo,
            daysProcessed: result.jours || 0,
            totalRows: result.lignes || 0,
            metaRebuilt: result.meta_rebuilt !== false,
            metaRebuildError: result.metaRebuildError || null,
          });
        } catch (syncErr) {
          console.error('[force-sync-periode] échec sync:', syncErr.message);
          return res.status(500).json({ success: false, error: 'Échec de la synchronisation : ' + syncErr.message });
        }
      }


      // ---- POST rebuild-pointage-meta : régénère periodes/periodeMap/periodeCampagne ----
      // Réservé DG. Appelle directement sqlSyncService.rebuildPointageMetaFromMirror()
      // SANS passer par syncPointageFromProd (donc SANS dépendance au serveur BEE ONE
      // BDP, injoignable depuis le 2026-07-09 — cf. mémoire projet). C'est le SEUL
      // moyen de régénérer les données déjà stockées avec le fix de désambiguïsation
      // de labels "Quinzaine N" entre campagnes (cf. campagnePeriodes.js) : le
      // déclencheur normal (sync BR_Pointage) est bloqué par la panne du serveur.
      if (action === 'rebuild-pointage-meta' && req.method === 'POST') {
        const _rau = await verifyAuth(req);
        const _rcp = await resolveCallerProfile(_rau);
        const _rpid = _rcp && (_rcp.profileId || _rcp.role || '');
        if (_rpid !== 'dg') {
          return res.status(403).json({ success: false, error: 'Réservé DG uniquement' });
        }

        console.log('[rebuild-pointage-meta] DG ' + (_rcp.name || _rau.uid) + ' → rebuild manuel (mirror only, sans BDP)');
        try {
          const { rebuildPointageMetaFromMirror } = require('./sqlSyncService');
          await rebuildPointageMetaFromMirror();
          const metaAfter = await db_firestore.collection('sql_mirror_pointage_meta').doc('config').get();
          const metaData = (metaAfter.exists && metaAfter.data()) || {};
          return res.json({
            success: true,
            periodesCount: (metaData.periodes || []).length,
            allPeriodesCount: (metaData.allPeriodes || []).length,
            availableDatesCount: (metaData.availableDates || []).length,
          });
        } catch (rebuildErr) {
          console.error('[rebuild-pointage-meta] échec:', rebuildErr.message);
          return res.status(500).json({ success: false, error: 'Échec de la reconstruction : ' + rebuildErr.message });
        }
      }

  return NOT_HANDLED;
};
