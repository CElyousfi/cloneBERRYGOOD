/*
 * AffectationAnalytiqueTable.jsx — Panneau « Affectation Analytique » de l'onglet
 * Quinzaine : tableau croisé Opération (famille) × Parcelle, par culture
 * (Framboise / Myrtille / Avocatier), en JH ou en coût, par Ha ou en total,
 * avec sélecteur local Quinzaine/Campagne, mode plein écran et pop-up de détail
 * des opérations d'une cellule.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE, aucun identifiant top-level ne
 * fuite (cf. mémoire projet umd-global-collision-smoke-load — une collision
 * crashe le boot React #200). UN SEUL global exposé, et rien d'autre :
 *   window.AffectationAnalytiqueTable
 *
 * Extrait de public/app.jsx (QuinzaineTab) à comportement IDENTIQUE — règle de
 * modularisation progressive (CLAUDE.md). Le code déplacé est repris VERBATIM :
 * les props sont ré-aliasées en tête de fonction sous les noms qu'elles avaient
 * dans QuinzaineTab, pour qu'aucune ligne du bloc déplacé n'ait à être réécrite.
 *
 * Dépendances lues sur window (elles étaient dans le scope d'app.jsx) :
 *   - window.PARCELLES_CULTURALES  (référentiel parcelles, exposé par app.jsx)
 *   - window.sbParcelleHa()        (exposé par app.jsx)
 *   - window.deriveSubFerme()      (exposé par app.jsx)
 * Déjà globales avant l'extraction : window.AnalytiqueUtils (public/lib),
 * window.CampagneUtils, window.QuinzaineCampagneSelect, window.SB_PARCELLE_CAMPAGNE
 * (lue indirectement par window.sbParcelleHa), React (CDN).
 *
 * Props :
 *   analytiqueData  {Array}   Lignes analytiques de la quinzaine globale de
 *                             l'onglet (fetch + peuplement de
 *                             window.SB_PARCELLE_CAMPAGNE restent dans QuinzaineTab).
 *   apiData         {Object}  Payload quinzaine ({periodes, periodeCampagne, …}).
 *   selectedPeriode {string}  Quinzaine globale sélectionnée dans l'onglet.
 *   farmFilter      {string}  Filtre ferme global (lignes filtrées avant pivot).
 *   avoSubFilter    {string}  Filtre sous-ferme avocatier (via deriveSubFerme).
 *   empCostReady    {bool}    `_parcelleEmpCostMap.ready` du parent — pilote
 *                             uniquement les libellés « Coût emp. » vs
 *                             « Coût BEE ONE ». Seul `.ready` est consommé ici ;
 *                             la map elle-même reste dans QuinzaineTab.
 *
 *   State CONTRÔLÉ par le parent (les setters React sont passés TELS QUELS —
 *   ils acceptent donc aussi bien une valeur qu'un updater fonctionnel, ce dont
 *   le code déplacé se sert : `setFullscreen(f => !f)`,
 *   `setCultureIdx(i => …)`) :
 *     fullscreen / setFullscreen      Plein écran. Piloté aussi de l'EXTÉRIEUR
 *                                     par le bouton « Affectation Analytique »
 *                                     de la barre d'outils de QuinzaineTab, et
 *                                     par le useEffect Escape/body.overflow qui
 *                                     reste monté inconditionnellement chez le
 *                                     parent.
 *     cultureIdx / setCultureIdx      Index de la culture affichée en plein écran.
 *     totalMode / setTotalMode        false = par Ha, true = total.
 *     view / setView                  'jh' | 'cout'.
 *     detailCell / setDetailCell      Cellule ouverte dans le pop-up de détail.
 *     scopeMode / setScopeMode        'quinzaine' | 'campagne' (sélecteur local).
 *     scopeValue / setScopeValue      Quinzaine ou campagne locale sélectionnée.
 *     scopeData / setScopeData        null = pas d'override (lit analytiqueData).
 *     scopeLoading / setScopeLoading  Spinner du sélecteur local.
 *
 * Hypothèses (documentées dans le commit) :
 *  - TOUS les states restent chez le parent (props contrôlées), y compris ceux
 *    utilisés par ce seul panneau. Raison : QuinzaineTab fait un early-return
 *    « Chargement quinzaine… » pendant chaque changement de quinzaine
 *    (handlePeriodeChange → setLoading(true)) ; ce composant serait donc
 *    DÉMONTÉ et ses states locaux réinitialisés, alors qu'aujourd'hui ils
 *    survivent au rechargement. Descendre les states ici = changement de
 *    comportement, hors périmètre iso-comportement.
 *  - Le pop-up de détail était rendu PLUS HAUT dans le JSX de QuinzaineTab que
 *    le panneau ; il est ici rendu juste après. Aucun impact visuel : c'est un
 *    overlay position:fixed / zIndex 10001, supérieur à tous les z-index de la
 *    zone (panneau plein écran 9999, popup transport 9999).
 *  - `prettyParcelle` (ligne du <th>) est recopié À L'IDENTIQUE : il n'a jamais
 *    été dans le scope de QuinzaineTab (défini dans un useCallback d'un autre
 *    composant), donc `typeof prettyParcelle === 'function'` valait déjà false
 *    et l'expression rend `pKey`. Ne pas « réparer » = ne pas changer l'affichage.
 *  - Le code mort après le `return` de la ligne famille (branche
 *    `type=operation`) est déplacé TEL QUEL.
 */
(function () {
  'use strict';

  var _r = window.React;
  if (!_r) return;
  var React = _r;

  function AffectationAnalytiqueTable(props) {
            // ── Props ré-aliasées sous les noms qu'elles portaient dans QuinzaineTab ──
            const analytiqueData = props.analytiqueData || [];
            const apiData = props.apiData || {};
            const selectedPeriode = props.selectedPeriode;
            const farmFilter = props.farmFilter;
            const avoSubFilter = props.avoSubFilter;
            const _parcelleEmpCostMap = { ready: !!props.empCostReady };
            const analytiqueFullscreen = props.fullscreen;
            const setAnalytiqueFullscreen = props.setFullscreen;
            const analytiqueCultureIdx = props.cultureIdx;
            const setAnalytiqueCultureIdx = props.setCultureIdx;
            const analytiqueTotalMode = props.totalMode;
            const setAnalytiqueTotalMode = props.setTotalMode;
            const analytiqueView = props.view;
            const setAnalytiqueView = props.setView;
            const analytiqueDetailCell = props.detailCell;
            const setAnalytiqueDetailCell = props.setDetailCell;
            const analytiqueScopeMode = props.scopeMode;
            const setAnalytiqueScopeMode = props.setScopeMode;
            const analytiqueScopeValue = props.scopeValue;
            const setAnalytiqueScopeValue = props.setScopeValue;
            const analytiqueScopeData = props.scopeData; // null = pas d'override
            const setAnalytiqueScopeData = props.setScopeData;
            const analytiqueScopeLoading = props.scopeLoading;
            const setAnalytiqueScopeLoading = props.setScopeLoading;

            // Sélecteur local Affectation Analytique — mode Quinzaine : un seul fetch
            // sur la quinzaine choisie, indépendant de selectedPeriode (global à l'onglet).
            const loadAnalytiqueScopeQuinzaine = (label) => {
                setAnalytiqueScopeLoading(true);
                fetch(`/api/pointage-rh?action=quinzaine-analytique&periode=${encodeURIComponent(label)}`)
                    .then(r => r.json())
                    .then(d => { setAnalytiqueScopeData(d && d.success ? (d.rows || []) : []); })
                    .catch(() => { setAnalytiqueScopeData([]); })
                    .finally(() => setAnalytiqueScopeLoading(false));
            };

            // Sélecteur local Affectation Analytique — mode Campagne : fetch en parallèle
            // de toutes les quinzaines de la campagne (déduites de apiData.periodeCampagne),
            // puis concaténation des rows bruts. _buildAnalytiquePivot additionne déjà par
            // parcelle+famille : la concaténation suffit à obtenir la somme sur la campagne.
            const loadAnalytiqueScopeCampagne = (campagne) => {
                const pc = (apiData && apiData.periodeCampagne) || {};
                const labels = Object.keys(pc).filter(k => pc[k] === campagne);
                setAnalytiqueScopeLoading(true);
                Promise.all(labels.map(label =>
                    fetch(`/api/pointage-rh?action=quinzaine-analytique&periode=${encodeURIComponent(label)}`)
                        .then(r => r.json())
                        .catch(() => ({ rows: [] }))
                )).then(results => {
                    const merged = [];
                    results.forEach(r => { merged.push(...((r && r.rows) || [])); });
                    setAnalytiqueScopeData(merged);
                }).finally(() => setAnalytiqueScopeLoading(false));
            };

            // ===== AFFECTATION ANALYTIQUE PAR CULTURE / HA =====
            const _pcInfoMap = {};
            (window.PARCELLES_CULTURALES || []).forEach(pc => {
                (pc.designations || []).forEach(d => {
                    const k = d.toUpperCase().trim();
                    if (!_pcInfoMap[k]) _pcInfoMap[k] = { ha: pc.ha || 0, culture: pc.culture || 'Framboise', variete: pc.variete || '' };
                });
            });
            const _getAnalytiqueRowInfo = (r) => {
                const norm = (r.parcelle || '').toUpperCase().trim();
                // 1. Référentiel SB (source prioritaire — saisi manuellement par RH/DG)
                const sbHa = window.sbParcelleHa(r.parcelle);
                // 2. Lookup PARCELLES_CULTURALES (désignations — ajouter le label BEE ONE si manquant)
                let info = _pcInfoMap[norm];
                if (!info) {
                    for (const [k, v] of Object.entries(_pcInfoMap)) {
                        if (norm.includes(k) || k.includes(norm)) { info = v; break; }
                    }
                }
                // 3. Fallback culture par regex sur le label
                if (!info) {
                    if (/CORINA|CASCADE|BREEZE|MYRTILL/i.test(r.parcelle)) info = { ha: 0, culture: 'Myrtille', variete: '' };
                    else if (/HAAS|AVOCAT|BACON/i.test(r.parcelle)) info = { ha: 0, culture: 'Avocatier', variete: '' };
                    else info = { ha: 0, culture: 'Framboise', variete: '' };
                }
                // Ha : SB ref > PARCELLES_CULTURALES désignation > fallback ferme unique > framboise keyword/secteur > haRef
                let ha = sbHa || info.ha || 0;
                if (ha === 0) {
                    // Fallback universel : extraire le code ferme du label BEE ONE et chercher dans PARCELLES_CULTURALES.
                    // Si une seule entrée (ex: avocatier — 1 par ferme) → utiliser son ha.
                    const _fm = ((r.parcelle || '').toUpperCase().match(/\b(F[1-6]|BAHIA)\b/) || [])[1];
                    if (_fm) {
                        const _byFm = (window.PARCELLES_CULTURALES || [])
                            .filter(pc => pc.culture === info.culture && pc.ferme === _fm && pc.ha > 0);
                        if (_byFm.length === 1) ha = _byFm[0].ha;
                    }
                }
                if (ha === 0 && info.culture === 'Framboise') {
                    // Labels BEE ONE (ex: 'F1-S5 MARAVILLA MD') ne matchent pas les désignations BDR.
                    // Fallback 1 : extraire variété par mot-clé + ferme.
                    const _normL = (r.parcelle || '').toUpperCase();
                    const _fmFr = ((_normL.match(/\b(F1|F5)\b/) || [])[0]);
                    const _varFr = _normL.includes('MARAVILLA') ? 'Maravilla'
                        : _normL.includes('YAZMIN') ? 'Yazmin'
                        : _normL.includes('REYNA') ? 'Reyna' : null;
                    if (_varFr && _fmFr) {
                        const _cand = (window.PARCELLES_CULTURALES || [])
                            .filter(pc => pc.culture === 'Framboise' && pc.variete === _varFr && pc.ferme === _fmFr && pc.ha > 0);
                        if (_cand.length > 0) ha = _cand[0].ha;
                    }
                    // Fallback 2 : variété abrégée inconnue (ex: 'MYA') — matcher ferme + numéro secteur
                    if (ha === 0 && _fmFr) {
                        const _secM = _normL.match(/\bS(\d+)\b/);
                        if (_secM) {
                            const _sec = _secM[1];
                            const _cand2 = (window.PARCELLES_CULTURALES || [])
                                .filter(pc => pc.culture === 'Framboise' && pc.ferme === _fmFr && pc.ha > 0
                                    && Array.isArray(pc.secteurs) && pc.secteurs.some(s => s.replace(/^S/i, '') === _sec));
                            if (_cand2.length > 0) ha = _cand2[0].ha;
                        }
                    }
                }
                if (ha === 0 && r.haRef > 0) ha = r.haRef;
                return { ...info, ha };
            };
            // Source résolue du panneau Affectation Analytique : override local
            // (quinzaine différente ou campagne agrégée) si présent, sinon comportement
            // historique (quinzaine du sélecteur global de l'onglet).
            const _analytiqueSourceRows = analytiqueScopeData !== null ? analytiqueScopeData : analytiqueData;
            const _cultureGroups = { Myrtille: [], Framboise: [], Avocatier: [] };
            _analytiqueSourceRows.forEach(r => {
                if (farmFilter && r.ferme !== farmFilter) return;
                if (avoSubFilter && window.deriveSubFerme(r.refParcelle, r.parcelle) !== avoSubFilter) return;
                const info = _getAnalytiqueRowInfo(r);
                const culture = info.culture || 'Framboise';
                if (!_cultureGroups[culture]) _cultureGroups[culture] = [];
                _cultureGroups[culture].push({ ...r, ha: info.ha, culture });
            });
            // Pivot délégué à la lib pure (public/lib/analytiqueUtils.js) — regroupe les
            // familles d'opérations sur une clé normalisée (casse/tirets) pour supprimer
            // les lignes dupliquées post-bascule BDP. Garde anti-crash si la lib n'est
            // pas chargée (cf. mémoire projet : global manquant = crash React global).
            const _buildAnalytiquePivot = (rows) => {
                if (!window.AnalytiqueUtils) return { parcelles: [], groupedRows: [] };
                return window.AnalytiqueUtils.buildAnalytiquePivotByFamille
                    ? window.AnalytiqueUtils.buildAnalytiquePivotByFamille(rows)
                    : { parcelles: [], groupedRows: [] };
            };

            // Sélecteur local Quinzaine (panneau Affectation Analytique) — restreint
            // aux quinzaines de la campagne COURANTE (celle de selectedPeriode), pas
            // à l'historique complet toutes campagnes confondues. Fix bug report Omar
            // 2026-08-06 : le dropdown listait Quinzaine 01 à 24 mélangées (plusieurs
            // campagnes) au lieu des seules quinzaines de la campagne active.
            // Recalculé à chaque render (dépend de apiData/selectedPeriode) donc reste
            // à jour si le sélecteur global de l'onglet change de campagne.
            const _analytiqueLocalPeriodeCampagne = (apiData && apiData.periodeCampagne) || {};
            const _analytiqueLocalCampagneCourante = (() => {
                if (selectedPeriode && _analytiqueLocalPeriodeCampagne[selectedPeriode]) {
                    return _analytiqueLocalPeriodeCampagne[selectedPeriode];
                }
                // Fallback : campagne la plus RÉCENTE — MÊME logique que
                // window.QuinzaineCampagneSelect (QCS_group : campagne DESC,
                // `.slice(0,1)`), factorisée dans CampagneUtils.mostRecentCampagne.
                // PAS la plus fréquente : une campagne ancienne/complète (ex. 24
                // quinzaines) a mécaniquement beaucoup plus d'entrées dans
                // periodeCampagne qu'une campagne tout juste démarrée (ex. 3
                // quinzaines) — "la plus fréquente" élirait à tort l'ancienne, faisant
                // diverger ce sélecteur local du sélecteur global de l'onglet (bug
                // report Omar 2026-08-06 : napperoir bloqué sur 2025-2026 au lieu de
                // 2026-2027).
                const mostRecent = window.CampagneUtils && window.CampagneUtils.mostRecentCampagne
                    ? window.CampagneUtils.mostRecentCampagne(_analytiqueLocalPeriodeCampagne)
                    : '';
                if (mostRecent) return mostRecent;
                const firstPeriode = ((apiData && apiData.periodes) || [])[0];
                return firstPeriode ? (_analytiqueLocalPeriodeCampagne[firstPeriode] || '') : '';
            })();
            const _analytiqueLocalPeriodes = ((apiData && apiData.periodes) || []).filter(p => (
                !_analytiqueLocalCampagneCourante || _analytiqueLocalPeriodeCampagne[p] === _analytiqueLocalCampagneCourante
            ));

            return (<>
                    {/* Popup détail opérations Affectation Analytique */}
                    {analytiqueDetailCell && (() => {
                        const _adc = analytiqueDetailCell;
                        const _opLabel = (op) => (op || '').replace(/^\d+\.\s*/, '');
                        const _opMap = {};
                        (_adc.detailRows || []).forEach(r => {
                            if (!_opMap[r.operation]) _opMap[r.operation] = { operation: r.operation, jh: 0, cout: 0, nbOuv: 0 };
                            _opMap[r.operation].jh += r.jh || 0;
                            _opMap[r.operation].cout += r.cout || 0;
                            _opMap[r.operation].nbOuv += r.nbOuv || 0;
                        });
                        const _opRows = Object.values(_opMap).sort((a, b) => b.jh - a.jh);
                        const _haLabel = _adc.ha > 0 ? `${_adc.ha} Ha` : 'Ha inconnu';
                        const _fmtHa = (v) => _adc.ha > 0 ? (Math.round(v / _adc.ha * 10) / 10).toFixed(1) : '—';
                        return (
                            <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.6)',zIndex:10001,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
                                onClick={() => setAnalytiqueDetailCell(null)}>
                                <div style={{background:'#fff',borderRadius:16,maxWidth:680,width:'100%',maxHeight:'80vh',overflow:'auto',boxShadow:'0 24px 64px rgba(0,0,0,0.35)'}}
                                    onClick={e => e.stopPropagation()}>
                                    <div style={{padding:'16px 20px',background:'linear-gradient(135deg,#3949ab,#5c6bc0)',borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,zIndex:1}}>
                                        <div>
                                            <div style={{fontSize:15,fontWeight:700}}>{_adc.parcelle}</div>
                                            <div style={{fontSize:11,opacity:0.85,marginTop:2}}>{_opLabel(_adc.operationFamille)} · {_haLabel}</div>
                                        </div>
                                        <button onClick={() => setAnalytiqueDetailCell(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                    <div style={{padding:'16px 20px'}}>
                                        <table className="data-table" style={{fontSize:12,margin:0}}>
                                            <thead>
                                                <tr style={{background:'var(--gray-50)'}}>
                                                    <th style={{padding:'6px 10px'}}>Opération</th>
                                                    <th style={{padding:'6px 10px',textAlign:'center'}}>Ouvriers</th>
                                                    <th style={{padding:'6px 10px',textAlign:'right'}}>JH</th>
                                                    <th style={{padding:'6px 10px',textAlign:'right'}}>JH / Ha</th>
                                                    <th style={{padding:'6px 10px',textAlign:'right'}}>Coût (DH)</th>
                                                    <th style={{padding:'6px 10px',textAlign:'right'}}>DH / Ha</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {_opRows.map((row, i) => (
                                                    <tr key={i} style={{background: i%2===0 ? '#fff' : 'var(--gray-50)'}}>
                                                        <td style={{padding:'6px 10px',fontWeight:500}}>{row.operation || '—'}</td>
                                                        <td style={{padding:'6px 10px',textAlign:'center'}}>{row.nbOuv}</td>
                                                        <td style={{padding:'6px 10px',textAlign:'right',fontWeight:600}}>{(Math.round(row.jh * 10) / 10).toFixed(1)}</td>
                                                        <td style={{padding:'6px 10px',textAlign:'right',color:'#3949ab'}}>{_fmtHa(row.jh)}</td>
                                                        <td style={{padding:'6px 10px',textAlign:'right'}}>{Math.round(row.cout).toLocaleString('fr-FR')}</td>
                                                        <td style={{padding:'6px 10px',textAlign:'right',color:'#3949ab'}}>{_adc.ha > 0 ? Math.round(row.cout / _adc.ha).toLocaleString('fr-FR') : '—'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr style={{background:'#eef0fa',fontWeight:700}}>
                                                    <td style={{padding:'8px 10px'}}>TOTAL</td>
                                                    <td style={{padding:'8px 10px',textAlign:'center'}}>{_opRows.reduce((s,r)=>s+r.nbOuv,0)}</td>
                                                    <td style={{padding:'8px 10px',textAlign:'right'}}>{(_opRows.reduce((s,r)=>s+r.jh,0)).toFixed(1)}</td>
                                                    <td style={{padding:'8px 10px',textAlign:'right',color:'#3949ab'}}>{_fmtHa(_opRows.reduce((s,r)=>s+r.jh,0))}</td>
                                                    <td style={{padding:'8px 10px',textAlign:'right'}}>{Math.round(_opRows.reduce((s,r)=>s+r.cout,0)).toLocaleString('fr-FR')}</td>
                                                    <td style={{padding:'8px 10px',textAlign:'right',color:'#3949ab'}}>{_adc.ha > 0 ? Math.round(_opRows.reduce((s,r)=>s+r.cout,0) / _adc.ha).toLocaleString('fr-FR') : '—'}</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Affectation Analytique */}
                    {_analytiqueSourceRows.length > 0 && (
                        <div style={analytiqueFullscreen ? {position:'fixed',inset:0,zIndex:9999,background:'#fff',overflowY:'auto',padding:24} : {}}>
                        <div style={analytiqueFullscreen ? {marginBottom:16,position:'relative'} : {marginBottom:16}}>
                            {analytiqueFullscreen && (
                                <button onClick={() => setAnalytiqueFullscreen(false)}
                                    style={{position:'absolute',top:12,right:12,padding:'6px 10px',borderRadius:6,border:'none',background:'var(--gray-200)',cursor:'pointer',fontSize:14}}>
                                    <i className="fa-solid fa-xmark"></i>
                                </button>
                            )}
                            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',gap:8}}>
                                <div style={{fontSize:14,fontWeight:700,color:'var(--gray-700)',display:'flex',alignItems:'center',gap:8}}>
                                    <i className="fa-solid fa-chart-pie" style={{color:'var(--berry)'}}></i>
                                    Affectation Analytique{analytiqueTotalMode ? ' — Total' : ' — par Ha'} · Famille
                                </div>
                                <div style={{display:'flex',alignItems:'center',gap:6}}>
                                    <div style={{display:'flex',gap:6,background:'var(--gray-100)',borderRadius:8,padding:'3px'}}>
                                        {(analytiqueTotalMode
                                        ? [['jh', 'JH'], ['cout', 'Coût emp.']]
                                        : [['jh', 'JH / Ha'], ['cout', _parcelleEmpCostMap.ready ? 'Coût emp. / Ha' : 'Coût BEE ONE / Ha']]
                                    ).map(([v, label]) => (
                                            <button key={v} onClick={() => setAnalytiqueView(v)}
                                                style={{padding:'5px 14px',borderRadius:6,border:'none',cursor:'pointer',fontSize:12,fontWeight:600,
                                                    background: analytiqueView === v ? 'var(--berry)' : 'transparent',
                                                    color: analytiqueView === v ? '#fff' : 'var(--gray-500)',
                                                    transition:'all 0.15s'}}>
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    <div style={{display:'flex',gap:4,background:'var(--gray-100)',borderRadius:8,padding:'3px'}}>
                                        {[['ha', 'Ha'], ['total', 'Total']].map(([v, label]) => (
                                            <button key={v}
                                                onClick={() => setAnalytiqueTotalMode(v === 'total')}
                                                style={{
                                                    padding: '4px 12px',
                                                    borderRadius: 8,
                                                    border: 'none',
                                                    background: (analytiqueTotalMode ? v === 'total' : v === 'ha') ? 'var(--berry)' : 'transparent',
                                                    color: (analytiqueTotalMode ? v === 'total' : v === 'ha') ? '#fff' : 'var(--gray-500)',
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    transition: 'all 0.15s',
                                                }}>{label}</button>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => { setAnalytiqueFullscreen(f => !f); setAnalytiqueCultureIdx(0); }}
                                        title={analytiqueFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
                                        style={{padding:'5px 10px',borderRadius:6,border:'1px solid var(--gray-200)',background:'var(--gray-100)',cursor:'pointer',fontSize:12,color:'var(--gray-600)'}}>
                                        <i className={`fa-solid ${analytiqueFullscreen ? 'fa-compress' : 'fa-expand'}`}></i>
                                    </button>
                                </div>
                            </div>

                            {/* Sélecteur local Quinzaine/Campagne — scopé à ce panneau uniquement,
                                visible en mode compact ET plein écran (même bloc JSX). Permet de
                                consulter une autre quinzaine ou d'agréger sur une campagne entière
                                sans dépendre du sélecteur global de l'onglet (caché en plein écran). */}
                            <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:12}}>
                                <div style={{display:'flex',gap:4,background:'var(--gray-100)',borderRadius:8,padding:'3px'}}>
                                    {[['quinzaine', 'Quinzaine'], ['campagne', 'Campagne']].map(([v, label]) => (
                                        <button key={v}
                                            onClick={() => {
                                                setAnalytiqueScopeMode(v);
                                                if (v === 'campagne') {
                                                    setAnalytiqueScopeValue(_analytiqueLocalCampagneCourante || '');
                                                    if (_analytiqueLocalCampagneCourante) loadAnalytiqueScopeCampagne(_analytiqueLocalCampagneCourante);
                                                } else {
                                                    setAnalytiqueScopeValue('');
                                                    setAnalytiqueScopeData(null);
                                                }
                                            }}
                                            style={{padding:'4px 12px',borderRadius:8,border:'none',
                                                background: analytiqueScopeMode === v ? 'var(--berry)' : 'transparent',
                                                color: analytiqueScopeMode === v ? '#fff' : 'var(--gray-500)',
                                                fontSize:11,fontWeight:600,cursor:'pointer',transition:'all 0.15s'}}>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                {analytiqueScopeMode === 'campagne' ? (
                                    <span style={{padding:'4px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:11,fontWeight:600,color:'var(--gray-700)'}}>
                                        {_analytiqueLocalCampagneCourante || '—'}
                                    </span>
                                ) : (
                                    <window.QuinzaineCampagneSelect
                                        periodes={_analytiqueLocalPeriodes}
                                        periodeCampagne={apiData.periodeCampagne}
                                        value={analytiqueScopeValue || selectedPeriode}
                                        onChange={(v) => { setAnalytiqueScopeValue(v); loadAnalytiqueScopeQuinzaine(v); }}
                                    />
                                )}
                                {analytiqueScopeLoading && (
                                    <span style={{fontSize:11,color:'var(--gray-500)'}}>
                                        <i className="fa-solid fa-spinner fa-spin" style={{marginRight:4}}></i>Chargement…
                                    </span>
                                )}
                                <span style={{fontSize:11,color:'var(--gray-500)',fontStyle:'italic'}}>
                                    {analytiqueScopeMode === 'campagne' && analytiqueScopeValue
                                        ? `Campagne ${analytiqueScopeValue} · cumul de ${Object.keys(apiData.periodeCampagne || {}).filter(k => (apiData.periodeCampagne || {})[k] === analytiqueScopeValue).length} quinzaines`
                                        : (analytiqueScopeValue || selectedPeriode || (apiData.periodes || [])[0] || '')}
                                </span>
                            </div>

                            {(() => {
                                const _CULTURES_DEF = [
                                    { culture: 'Framboise', color: '#8B2252', icon: 'fa-seedling' },
                                    { culture: 'Myrtille',  color: '#3498DB', icon: 'fa-circle-dot' },
                                    { culture: 'Avocatier', color: '#2D8B4E', icon: 'fa-tree' },
                                ];
                                const _culturesWithData = _CULTURES_DEF.filter(({ culture }) => (_cultureGroups[culture] || []).length > 0);
                                const _culturesToShow = analytiqueFullscreen
                                    ? (_culturesWithData[analytiqueCultureIdx] ? [_culturesWithData[analytiqueCultureIdx]] : _culturesWithData.slice(0,1))
                                    : _CULTURES_DEF;
                                return (<>
                                    {_culturesWithData.length > 1 && (
                                        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:12,marginBottom:12}}>
                                            <button
                                                onClick={() => setAnalytiqueCultureIdx(i => (i - 1 + _culturesWithData.length) % _culturesWithData.length)}
                                                style={{padding:'6px 14px',borderRadius:8,border:'1px solid var(--gray-200)',background:'#fff',cursor:'pointer',fontSize:14}}>
                                                <i className="fa-solid fa-chevron-left"></i>
                                            </button>
                                            {_culturesWithData.map((c, i) => (
                                                <button key={c.culture}
                                                    onClick={() => setAnalytiqueCultureIdx(i)}
                                                    style={{padding:'5px 14px',borderRadius:8,border:`1.5px solid ${i === analytiqueCultureIdx ? c.color : 'var(--gray-200)'}`,background: i === analytiqueCultureIdx ? c.color : '#fff',color: i === analytiqueCultureIdx ? '#fff' : 'var(--gray-600)',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                                    <i className={`fa-solid ${c.icon}`} style={{marginRight:5}}></i>{c.culture}
                                                </button>
                                            ))}
                                            <button
                                                onClick={() => setAnalytiqueCultureIdx(i => (i + 1) % _culturesWithData.length)}
                                                style={{padding:'6px 14px',borderRadius:8,border:'1px solid var(--gray-200)',background:'#fff',cursor:'pointer',fontSize:14}}>
                                                <i className="fa-solid fa-chevron-right"></i>
                                            </button>
                                        </div>
                                    )}
                                    {_culturesToShow.map(({ culture, color, icon }) => {
                                const _rows = _cultureGroups[culture] || [];
                                if (_rows.length === 0) return null;
                                const _pivotResult = _buildAnalytiquePivot(_rows);
                                const parcelles = _pivotResult.parcelles;
                                // Mode Famille → groupedRows ; Mode Sous-famille → operations + pivot
                                const groupedRows = _pivotResult.groupedRows || null;
                                const _hasRows = groupedRows && groupedRows.length > 0;
                                if (!_hasRows) return null;
                                const _totalHa = parcelles.reduce((s, [, ha]) => s + ha, 0);
                                const _unit = analytiqueView === 'jh'
                                    ? (analytiqueTotalMode ? 'JH' : 'JH/Ha')
                                    : (_parcelleEmpCostMap.ready
                                        ? (analytiqueTotalMode ? 'DH emp.' : 'DH emp./Ha')
                                        : (analytiqueTotalMode ? 'DH' : 'DH/Ha'));
                                const _fmt = (val, ha) => {
                                    if (!analytiqueTotalMode && ha === 0) return <span style={{fontSize:10,color:'var(--gray-400)'}}>—</span>;
                                    if (analytiqueTotalMode) {
                                        return analytiqueView === 'jh'
                                            ? (Math.round(val * 10) / 10).toFixed(1)
                                            : Math.round(val).toLocaleString('fr-FR');
                                    }
                                    const v = val / ha;
                                    return analytiqueView === 'jh'
                                        ? (Math.round(v * 10) / 10).toFixed(1)
                                        : Math.round(v).toLocaleString('fr-FR');
                                };
                                return (
                                    <div key={culture} style={{marginBottom:20,background:'#fff',borderRadius:12,border:'1px solid var(--gray-200)',overflow:'hidden',boxShadow:'0 2px 8px rgba(0,0,0,0.04)'}}>
                                        <div style={{padding:'10px 16px',background:`linear-gradient(135deg,${color}15,${color}08)`,borderBottom:`2px solid ${color}30`,display:'flex',alignItems:'center',gap:10}}>
                                            <i className={`fa-solid ${icon}`} style={{color,fontSize:14}}></i>
                                            <span style={{fontSize:13,fontWeight:700,color}}>{culture}</span>
                                            <span style={{fontSize:11,color:'var(--gray-500)',fontWeight:400}}>
                                                {parcelles.length} parcelle{parcelles.length > 1 ? 's' : ''}
                                                {_totalHa > 0 ? ` · ${_totalHa.toFixed(2)} Ha total` : ''}
                                            </span>
                                        </div>
                                        <div style={{overflowX:'auto'}}>
                                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                                <thead>
                                                    <tr style={{background:'var(--gray-50)'}}>
                                                        <th style={{padding:'8px 12px',textAlign:'left',fontWeight:600,color:'var(--gray-600)',position:'sticky',left:0,background:'var(--gray-50)',minWidth:160,borderRight:'1px solid var(--gray-200)',zIndex:1}}>Opération</th>
                                                        {parcelles.map(([pKey, ha]) => (
                                                            <th key={pKey} style={{padding:'6px 10px',textAlign:'center',fontWeight:600,color:'var(--gray-600)',minWidth:110,borderRight:'1px solid var(--gray-100)'}}>
                                                                <div style={{color,fontWeight:700}}>{(typeof prettyParcelle === 'function' ? prettyParcelle(pKey) : pKey) || pKey}</div>
                                                                <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:400}}>{ha > 0 ? `${ha} Ha` : 'Ha ?'}</div>
                                                            </th>
                                                        ))}
                                                        <th style={{padding:'6px 10px',textAlign:'center',fontWeight:700,color:'var(--gray-700)',minWidth:100,background:'var(--gray-100)',position:'sticky',right:0,zIndex:1}}>Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(groupedRows || []).map((row) => {
                                                            const _totalHaForRow = parcelles.reduce((s, [, ha]) => s + ha, 0);
                                                            const _rowTotal = analytiqueView === 'jh'
                                                                ? parcelles.reduce((s, [pKey]) => { const c = row.pivot[pKey]; return s + (c ? c.jh : 0); }, 0)
                                                                : parcelles.reduce((s, [pKey]) => { const c = row.pivot[pKey]; return s + (c ? c.cout : 0); }, 0);

                                                            // ── Ligne groupe (en-tête de section) ──
                                                            if (row.type === 'groupe') {
                                                                return (
                                                                    <tr key={row.key}>
                                                                        <td colSpan={parcelles.length + 2} style={{padding:'8px 14px',fontWeight:700,fontSize:12,background:color,color:'white',letterSpacing:'0.04em',textTransform:'uppercase',position:'sticky',left:0}}>
                                                                            {row.label}
                                                                            <span style={{fontWeight:400,fontSize:10,opacity:0.75,marginLeft:8}}>
                                                                                {analytiqueView === 'jh'
                                                                                    ? `${Math.round(_rowTotal)} JH total`
                                                                                    : `${Math.round(_rowTotal).toLocaleString('fr-FR')} DH`}
                                                                            </span>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            }

                                                            // ── Ligne famille (clic sur cellule → popup) ──
                                                            return (
                                                                <tr key={row.key} style={{background:'#fff',borderBottom:'1px solid #f0e6ef'}}>
                                                                    <td style={{padding:'9px 14px',fontWeight:600,color,position:'sticky',left:0,background:'#fff',borderRight:`2px solid ${color}`,zIndex:1,borderLeft:`3px solid ${color}`}}>
                                                                        {row.label}
                                                                        <span style={{fontSize:10,fontWeight:400,color:'var(--gray-400)',marginLeft:6}}>{row.key}</span>
                                                                    </td>
                                                                    {parcelles.map(([pKey, ha]) => {
                                                                        const c = row.pivot[pKey];
                                                                        if (!c) return <td key={pKey} style={{padding:'8px 10px',textAlign:'center',color:'var(--gray-200)',borderRight:'1px solid #f5edf4',fontSize:13}}>—</td>;
                                                                        const _val = analytiqueView === 'jh' ? c.jh : c.cout;
                                                                        return (
                                                                            <td key={pKey}
                                                                                onClick={() => setAnalytiqueDetailCell({ parcelle: pKey, operationFamille: row.label, ha, detailRows: c.detailRows })}
                                                                                title={`Voir le détail de ${row.label} sur ${pKey}`}
                                                                                style={{padding:'8px 10px',textAlign:'center',cursor:'pointer',borderRight:'1px solid #f5edf4',transition:'background 0.12s'}}
                                                                                onMouseEnter={e => e.currentTarget.style.background='#fdf4f8'}
                                                                                onMouseLeave={e => e.currentTarget.style.background=''}>
                                                                                <div style={{fontWeight:700,color:'var(--gray-700)'}}>{_fmt(_val, ha)}</div>
                                                                                <div style={{fontSize:10,color:'var(--gray-400)'}}>{_unit}</div>
                                                                            </td>
                                                                        );
                                                                    })}
                                                                    <td style={{padding:'8px 10px',textAlign:'center',fontWeight:700,color,background:'#fdf4f8',position:'sticky',right:0,borderLeft:'1px solid #f0e6ef'}}>
                                                                        <div>{_fmt(_rowTotal, _totalHaForRow)}</div>
                                                                        <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:400}}>{_unit}</div>
                                                                    </td>
                                                                </tr>
                                                            );
                                                            // (dead code placeholder for linter — was type=operation branch)
                                                            return (
                                                                <tr key={row.key}>
                                                                    <td></td>
                                                                    {parcelles.map(([pKey, ha]) => {
                                                                        const c = row.pivot[pKey];
                                                                        if (!c) return <td key={pKey}></td>;
                                                                        const _val = analytiqueView === 'jh' ? c.jh : c.cout;
                                                                        return (
                                                                            <td key={pKey}
                                                                                onClick={() => setAnalytiqueDetailCell({ parcelle: pKey, operationFamille: row.label, ha, detailRows: c.detailRows })}
                                                                                style={{padding:'6px 10px',textAlign:'center',cursor:'pointer',borderRight:'1px solid var(--gray-100)',transition:'background 0.1s',fontSize:11}}
                                                                                onMouseEnter={e => e.currentTarget.style.background=`${color}18`}
                                                                                onMouseLeave={e => e.currentTarget.style.background=''}>
                                                                                <div style={{fontWeight:500,color:'var(--gray-700)'}}>{_fmt(_val, ha)}</div>
                                                                                <div style={{fontSize:10,color:'var(--gray-400)'}}>{_unit}</div>
                                                                            </td>
                                                                        );
                                                                    })}
                                                                    <td style={{padding:'6px 10px',textAlign:'center',fontWeight:600,color:'var(--gray-600)',background:'var(--gray-100)',position:'sticky',right:0,fontSize:11}}>
                                                                        <div>{_fmt(_rowTotal, _totalHaForRow)}</div>
                                                                        <div style={{fontSize:10,color:'var(--gray-400)'}}>{_unit}</div>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                </tbody>
                                                <tfoot>
                                                    <tr style={{background:`${color}18`,fontWeight:700}}>
                                                        <td style={{padding:'8px 12px',position:'sticky',left:0,background:`${color}18`,borderRight:'1px solid var(--gray-200)',zIndex:1,color}}>TOTAL</td>
                                                        {parcelles.map(([pKey, ha]) => {
                                                            const colTotal = analytiqueView === 'jh'
                                                                ? (groupedRows || []).filter(r => r.type === 'famille').reduce((s, r) => { const c = r.pivot[pKey]; return s + (c ? c.jh : 0); }, 0)
                                                                : (groupedRows || []).filter(r => r.type === 'famille').reduce((s, r) => { const c = r.pivot[pKey]; return s + (c ? c.cout : 0); }, 0);
                                                            return (
                                                                <td key={pKey} style={{padding:'8px 10px',textAlign:'center',borderRight:'1px solid var(--gray-100)',color}}>
                                                                    <div>{_fmt(colTotal, ha)}</div>
                                                                    <div style={{fontSize:10,opacity:0.7}}>{_unit}</div>
                                                                </td>
                                                            );
                                                        })}
                                                        <td style={{padding:'8px 10px',textAlign:'center',background:`${color}28`,position:'sticky',right:0,color}}>
                                                            {(() => {
                                                                const gt = analytiqueView === 'jh'
                                                                    ? (groupedRows || []).filter(r => r.type === 'famille').reduce((s, r) => s + parcelles.reduce((ps, [pKey]) => { const c = r.pivot[pKey]; return ps + (c ? c.jh : 0); }, 0), 0)
                                                                    : (groupedRows || []).filter(r => r.type === 'famille').reduce((s, r) => s + parcelles.reduce((ps, [pKey]) => { const c = r.pivot[pKey]; return ps + (c ? c.cout : 0); }, 0), 0);
                                                                return <><div>{_fmt(gt, _totalHa)}</div><div style={{fontSize:10,opacity:0.7}}>{_unit}</div></>;
                                                            })()}
                                                        </td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })}
                                </>);
                            })()}
                        </div>
                        </div>
                    )}
            </>);
  }

  window.AffectationAnalytiqueTable = AffectationAnalytiqueTable;
})();
