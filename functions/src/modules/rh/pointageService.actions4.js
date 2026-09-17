/* Actions 4/4 de pointageRH — corps repris VERBATIM.
   Le contexte du handler arrive par `ctx` ; la destructuration ci-dessous
   recree exactement les liaisons d'origine. */
'use strict';
const { NOT_HANDLED } = require("./pointageService.dispatch");

module.exports = async function pointageServiceActions4(ctx) {
  const { req, res, action, dateParam, _fermeFilter, _cultureFilter, _keepPointage, _keepCulture, _keepCueillette, getPointageRowsForDate, getPointageRowsForDateRange, getPointageRowsForPeriode, getWorkerHistory, getCueilletteRows, db } = ctx;

  // Corps VERBATIM : ces noms venaient du scope englobant de l'ancien monolithe
  // pointageRH avant l'eclatement (commit 8a7284c). require() PAREsseux (pas en
  // haut de fichier) car pointageService.part1.js require CE fichier pour
  // construire __actions -- un require en tete de fichier recevrait un exports
  // encore vide (cycle). Les 5 fetchers gates (getPointageRowsForDate etc.)
  // restent EXCLUS d'ici : ils viennent de ctx (version filtree ferme/culture,
  // voir pointageService.js), jamais de la version brute de part1.
  const { HS_SEUIL_MINUTES, JOURS_FERIES_FALLBACK, POINTAGE_FERMES, REFERENTIEL_FAMILLES, REFERENTIEL_TTL_MS, USE_MIRROR, _getCueilletteRows, _getPointageRowsForDate, _getPointageRowsForDateRange, _getPointageRowsForPeriode, _getWorkerHistory, _qtkWarned, _refMap, _refTachesCache, _refTachesCacheAt, _referentielCache, _referentielLoadedAt, _supMapLastGood, admin, aggregateParcellesFromMirror, archiveDocRef, buildHalfToPeriode, buildHeuresSup, buildParCulture, buildPeriodeCampagne, campagneBudget, campagneBudgetCulture, campagneCourante, campagneExport, campagneOf, classifyType, computeAllowedMatricules, computeChargCond, computeDurationOvertime, consoAccessControl, consoBons, cors, countDistinctByFermeType, coutOuvrier, coutQuinzaineSnap, db_firestore, dedupeWorkersByMatricule, defaultPeriode, defaultPeriodeForCampagne, deriveFerme, detectFramboiseSubType, enrichRowsWithHaRef, fetchBrParcelleSupMap, fetchDetailFromMirror, fetchPostesFixesFromMirror, fetchSummaryFromMirror, fichierPaieStore, filterArchivedParFerme, filterArchivedParJour, filterArchivedRowsByFerme, filterByFermeField, filterMirrorRowsByCulture, filterMirrorRowsByFerme, filterPresenceRowsByAllowed, filterProdRowsByFerme, filterReposWorkersArchived, filterRowsByExactDates, findJourApres, findJourAvant, functions, getAvailableDates, getExcludedFonctionsHS, getJoursFeries, getPointageMeta, getPool, getSyncStatus, halfKey, invalidateReferentielCache, isSansEquipe, isValidCampagneLabel, loadReferentielCache, loadReferentielTaches, mapMirrorRowToDetail, mergeReferentiel, parcelleGroupSeedHa, parcelleGroupSplit, parcelleGroupValidate, pointageCacheKey, pool, quantiteToKg, recomposeArchivedTotals, recomposeProdTotalKg, referentielOperationsConnues, resolveCallerProfile, resolveFamily, resolveFermeFromParcelle, resolveHolidayPeriode, resolveMyrtilleVariete, resolvePointageRHAccess, resolveVariete, shouldExcludeWorkerDay, splitCompositeLabel, sql, sqlConfig, syncPointageFromProd, verifyAuth, warmRefTaches, withCache } = require("./pointageService.part1");


      // ── action: emargement-chefs-ferme ──────────────────────────────────────
      if (action === 'emargement-chefs-ferme') {
        const _uid2 = await verifyAuth(req);
        const _prof2 = await resolveCallerProfile(_uid2);
        const _fpid2 = (_prof2 && _prof2.profileId) || '';
        if (!['chef_rh', 'rh', 'dg'].includes(_fpid2)) {
          return res.status(403).json({ success: false, error: 'Réservé RH/DG' });
        }
        const _periode = (req.query && req.query.periode) || '';
        if (!_periode) return res.status(400).json({ success: false, error: 'periode requis' });

        try {
          // 1) Résoudre les dates de la période
          const _metaSnap = await db_firestore.collection('sql_mirror_pointage_meta').doc('config').get();
          const _pMap = (_metaSnap.exists && _metaSnap.data().periodeMap) || {};
          const _pEntry = _pMap[_periode];
          if (!_pEntry) return res.status(404).json({ success: false, error: 'Période introuvable: ' + _periode });

          let _dates;
          if (Array.isArray(_pEntry)) {
            _dates = _pEntry.filter(function(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort();
          } else {
            const _f = _pEntry.from || _pEntry.dateFrom || '';
            const _t = _pEntry.to || _pEntry.dateTo || '';
            _dates = [];
            for (var _d = new Date(_f + 'T00:00:00Z'); _d <= new Date(_t + 'T00:00:00Z'); _d.setUTCDate(_d.getUTCDate() + 1)) {
              _dates.push(_d.toISOString().slice(0, 10));
            }
          }
          if (!_dates.length) return res.status(400).json({ success: false, error: 'Aucune date trouvée pour cette période' });

          // 2) Parallel reads MO mirror
          const _moSnaps = await Promise.all(_dates.map(function(d) {
            return db_firestore.collection('sql_mirror_pointage').doc(d).get();
          }));

          // 3) Grouper ferme → parcelle → equipe de transport → date → {jh, _set}
          var _fermeMap = {
            F1: { label: 'Framboise', parcelleMap: {}, totalJH: 0 },
            F5: { label: 'Myrtille', parcelleMap: {}, totalJH: 0 },
            Avocatier: { label: 'Avocatier', parcelleMap: {}, totalJH: 0 },
          };

          // Charger les noms d'équipes de transport depuis Firestore
          const _tpSnap = await db_firestore.collection('rh_config').doc('transport_primes').get();
          const _tpEquipes = (_tpSnap.exists && _tpSnap.data().equipes) || [];
          const _prefixToName = {};
          _tpEquipes.forEach(function(e) {
            if (e.prefix && e.equipe) _prefixToName[e.prefix.toUpperCase()] = e.equipe;
          });
          function _getEquipeName(prefix) {
            return _prefixToName[prefix] || prefix || 'Sans équipe';
          }

          for (var _i = 0; _i < _dates.length; _i++) {
            var _date = _dates[_i];
            if (!_moSnaps[_i].exists) continue;
            var _rows = _moSnaps[_i].data().rows || [];
            for (var _ri = 0; _ri < _rows.length; _ri++) {
              var _r = _rows[_ri];
              var _res = resolveFermeFromParcelle({ refParcelle: _r.Ref_parcelle, label: _r.Parcelle_Culturale, variete: _r.Variete });
              var _ferme = _res && _res.ferme;
              // Router par culture, pas seulement par ferme : F5 contient Myrtille ET Framboise ET Avocatier
              var _varRes = resolveVariete(_r.Parcelle_Culturale || '', _r.Ref_parcelle || '');
              var _labelUp = (_r.Parcelle_Culturale || '').toUpperCase();
              var _varUp = (_r.Variete || '').toUpperCase();
              var _isAvo = _ferme === 'Avocatier'
                || _labelUp.includes('HAAS') || _labelUp.includes('HASS') || _labelUp.includes('AVOCAT')
                || _varUp.includes('HAAS') || _varUp.includes('AVOCAT');
              var _bucketKey;
              if (_isAvo) {
                _bucketKey = 'Avocatier';
              } else if (_varRes.culture === 'Myrtille') {
                _bucketKey = 'F5';
              } else if (_varRes.culture === 'Framboise') {
                _bucketKey = 'F1';
              } else if (_ferme === 'F1') {
                _bucketKey = 'F1';
              } else {
                continue; // ferme inconnue / culture non résolue → fail-closed
              }
              if (!_fermeMap[_bucketKey]) continue;
              var _pl = _r.Parcelle_Culturale || _r.Ref_parcelle || '?';
              var _mat = (_r.Personnel_Matricule || '').trim();
              var _jh = Number(_r.Nombre_Jr || 0);
              // Dériver le préfixe équipe de transport (miroir de getEqPrefix frontend)
              // Matricules commençant par un chiffre → regrouper dans "Autre"
              var _prefix, _eqName;
              if (/^\d/.test(_mat)) {
                _prefix = '__autre__';
                _eqName = 'Autre';
              } else {
                _prefix = _mat.substring(0, 2).toUpperCase() || 'NV';
                var _matUp = _mat.toUpperCase();
                if (_matUp.startsWith('HAFI') || (_matUp.startsWith('HA') && !_matUp.startsWith('HAF'))) _prefix = 'HA';
                if (_matUp.startsWith('DD')) _prefix = 'NV';
                _eqName = _getEquipeName(_prefix);
              }
              var _fm = _fermeMap[_bucketKey];
              if (!_fm.parcelleMap[_pl]) _fm.parcelleMap[_pl] = { label: _pl, equipeMap: {}, totalJH: 0 };
              var _pm = _fm.parcelleMap[_pl];
              if (!_pm.equipeMap[_prefix]) _pm.equipeMap[_prefix] = { nom: _eqName, byDay: {}, totalJH: 0 };
              var _em = _pm.equipeMap[_prefix];
              if (!_em.byDay[_date]) _em.byDay[_date] = { jh: 0, _set: [] };
              _em.byDay[_date]._set.push(_mat);
              _em.byDay[_date].jh += _jh;
              _em.totalJH += _jh;
              _pm.totalJH += _jh;
              _fm.totalJH += _jh;
            }
          }

          // 4) Sérialiser _set → ouvriers + construire parcelles → equipes
          var _fermes = {};
          var _FERME_ORDER = ['F1', 'F5', 'Avocatier'];
          _FERME_ORDER.forEach(function(_fk) {
            var _fm2 = _fermeMap[_fk];
            var _parcelles = Object.values(_fm2.parcelleMap)
              .sort(function(a, b) { return a.label.localeCompare(b.label); })
              .map(function(pm) {
                var _equipes = Object.values(pm.equipeMap)
                  .sort(function(a, b) { return a.nom.localeCompare(b.nom); })
                  .map(function(em) {
                    var byDay = {};
                    Object.entries(em.byDay).forEach(function(_entry) {
                      var d = _entry[0], v = _entry[1];
                      byDay[d] = { jh: v.jh, ouvriers: new Set(v._set).size };
                    });
                    return { nom: em.nom, byDay: byDay, totalJH: em.totalJH };
                  });
                return { label: pm.label, totalJH: pm.totalJH, equipes: _equipes };
              });
            _fermes[_fk] = { label: _fm2.label, parcelles: _parcelles, totalJH: _fm2.totalJH };
          });

          // 5) Parallel reads pointage_divers
          var _dSnaps = await Promise.all(_dates.map(function(d) {
            return db_firestore.collection('pointage_divers').doc(d).get();
          }));
          var _diversMap = {};
          for (var _di = 0; _di < _dates.length; _di++) {
            var _ddate = _dates[_di];
            if (!_dSnaps[_di].exists) continue;
            var _entries = _dSnaps[_di].data().entries || [];
            for (var _eni = 0; _eni < _entries.length; _eni++) {
              var _e = _entries[_eni];
              var _key = (_e.beneficiaire || '') + '|' + (_e.fonction || '');
              if (!_diversMap[_key]) _diversMap[_key] = { key: _key, beneficiaire: _e.beneficiaire || '', fonction: _e.fonction || '', byDay: {}, totQ: 0, totM: 0 };
              if (!_diversMap[_key].byDay[_ddate]) _diversMap[_key].byDay[_ddate] = { q: 0, m: 0 };
              _diversMap[_key].byDay[_ddate].q += Number(_e.quantite || 0);
              _diversMap[_key].byDay[_ddate].m += Number(_e.montant || 0);
              _diversMap[_key].totQ += Number(_e.quantite || 0);
              _diversMap[_key].totM += Number(_e.montant || 0);
            }
          }
          var _diversLignes = Object.values(_diversMap).sort(function(a, b) { return a.beneficiaire.localeCompare(b.beneficiaire); });
          var _diversTotal = _diversLignes.reduce(function(s, l) { return s + l.totM; }, 0);

          return res.json({
            success: true, periode: _periode, dates: _dates,
            fermes: _fermes,
            divers: { lignes: _diversLignes, totalMontant: _diversTotal }
          });
        } catch (_err2) {
          console.error('[emargement-chefs-ferme]', _err2.message);
          return res.status(500).json({ success: false, error: _err2.message });
        }
      }


      // ── action: check-primes-quinzaine ──────────────────────────────────────
      if (action === 'check-primes-quinzaine') {
        const _uid3 = await verifyAuth(req);
        const _prof3 = await resolveCallerProfile(_uid3);
        const _fpid3 = (_prof3 && _prof3.profileId) || '';
        if (!['rh', 'chef_rh', 'dg'].includes(_fpid3)) {
          return res.status(403).json({ success: false, error: 'Réservé RH/DG' });
        }
        const _periode3 = (req.query && req.query.periode) || '';
        if (!_periode3) return res.status(400).json({ success: false, error: 'periode requis' });

        function getPrimeForDateBackend(history, currentPrime, dateStr) {
          if (!dateStr || !Array.isArray(history) || history.length === 0) return Number(currentPrime || 0);
          const applicable = history.filter(function(h) { return h.effectiveFrom && h.effectiveFrom <= dateStr; });
          if (applicable.length === 0) {
            const sorted = history.slice().sort(function(a, b) { return a.effectiveFrom < b.effectiveFrom ? -1 : 1; });
            return Number(sorted[0].previousMontant || 0);
          }
          const sorted = applicable.slice().sort(function(a, b) { return a.effectiveFrom < b.effectiveFrom ? 1 : -1; });
          return Number(sorted[0].montant || 0);
        }

        try {
          // 1) Lire periodeMap depuis sql_mirror_pointage_meta/config
          const _metaSnap3 = await db_firestore.collection('sql_mirror_pointage_meta').doc('config').get();
          const _pMap3 = (_metaSnap3.exists && _metaSnap3.data().periodeMap) || {};
          const _pEntry3 = _pMap3[_periode3];
          if (!_pEntry3) return res.json({ success: false, error: 'Période inconnue' });

          let _dates3;
          if (Array.isArray(_pEntry3)) {
            _dates3 = _pEntry3.filter(function(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort();
          } else {
            const _f3 = _pEntry3.from || _pEntry3.dateFrom || '';
            const _t3 = _pEntry3.to || _pEntry3.dateTo || '';
            _dates3 = [];
            for (var _d3 = new Date(_f3 + 'T00:00:00Z'); _d3 <= new Date(_t3 + 'T00:00:00Z'); _d3.setUTCDate(_d3.getUTCDate() + 1)) {
              _dates3.push(_d3.toISOString().slice(0, 10));
            }
          }
          if (!_dates3.length) return res.json({ success: false, error: 'Aucune date trouvée pour cette période' });

          const _firstDay3 = _dates3[0];

          // 2) Lire tous les docs pointage pour la période
          const _moSnaps3 = await Promise.all(_dates3.map(function(d) {
            return db_firestore.collection('sql_mirror_pointage').doc(d).get();
          }));

          // 3) Collecter les matricules UNIQUES des workers poste fixe
          const _postseMats = new Set();
          for (var _si = 0; _si < _moSnaps3.length; _si++) {
            if (!_moSnaps3[_si].exists) continue;
            var _rows3 = _moSnaps3[_si].data().rows || [];
            for (var _ri3 = 0; _ri3 < _rows3.length; _ri3++) {
              var _r3 = _rows3[_ri3];
              var _opFam = (_r3.Operation_Famille || '').toLowerCase();
              if (_opFam.includes('poste') && _r3.Personnel_Matricule) {
                _postseMats.add(String(_r3.Personnel_Matricule));
              }
            }
          }

          // 4) Lire ouvriers_registry en parallel (batch de 20)
          const _matsArr = Array.from(_postseMats);
          const _BATCH = 20;
          const _regDocs = {};
          for (var _bi = 0; _bi < _matsArr.length; _bi += _BATCH) {
            var _chunk = _matsArr.slice(_bi, _bi + _BATCH);
            var _snaps = await Promise.all(_chunk.map(function(m) {
              return db_firestore.collection('ouvriers_registry').doc(m).get();
            }));
            for (var _ci = 0; _ci < _chunk.length; _ci++) {
              if (_snaps[_ci].exists) {
                _regDocs[_chunk[_ci]] = _snaps[_ci].data();
              }
            }
          }

          // 5) Compter les journées par matricule pour la quinzaine
          const _joureesByMat = {};
          for (var _si2 = 0; _si2 < _moSnaps3.length; _si2++) {
            if (!_moSnaps3[_si2].exists) continue;
            var _rows3b = _moSnaps3[_si2].data().rows || [];
            for (var _ri3b = 0; _ri3b < _rows3b.length; _ri3b++) {
              var _r3b = _rows3b[_ri3b];
              var _opFam2 = (_r3b.Operation_Famille || '').toLowerCase();
              if (!_opFam2.includes('poste')) continue;
              var _mat3 = _r3b.Personnel_Matricule ? String(_r3b.Personnel_Matricule) : null;
              if (!_mat3) continue;
              if (!_joureesByMat[_mat3]) _joureesByMat[_mat3] = new Set();
              var _jour3 = _dates3[_si2];
              _joureesByMat[_mat3].add(_jour3);
            }
          }

          // 6) Calculer discrepancies
          const _impacted = [];
          var _coutDelta = 0;
          for (var _mi = 0; _mi < _matsArr.length; _mi++) {
            var _mat4 = _matsArr[_mi];
            var _rw3 = _regDocs[_mat4];
            if (!_rw3) continue;
            var _primeActuelle = Number(_rw3.primeFonctionJournaliere || 0);
            var _primePeriode = getPrimeForDateBackend(_rw3.prime_history, _primeActuelle, _firstDay3);
            if (_primePeriode !== _primeActuelle) {
              var _journeesQz = _joureesByMat[_mat4] ? _joureesByMat[_mat4].size : 0;
              var _delta = _primeActuelle - _primePeriode;
              _coutDelta += _delta * _journeesQz;
              _impacted.push({
                matricule: _mat4,
                nom: _rw3.nom || _rw3.name || _mat4,
                primeActuelle: _primeActuelle,
                primePeriode: _primePeriode,
                delta: _delta,
                journeesQz: _journeesQz
              });
            }
          }

          return res.json({
            success: true,
            periode: _periode3,
            firstDay: _firstDay3,
            totalWorkersFixed: _matsArr.length,
            impacted: _impacted.length,
            coutDelta: Math.round(_coutDelta * 100) / 100,
            ouvriers: _impacted
          });
        } catch (_err3) {
          console.error('[check-primes-quinzaine]', _err3.message);
          return res.status(500).json({ success: false, error: _err3.message });
        }
      }

  return NOT_HANDLED;
};
