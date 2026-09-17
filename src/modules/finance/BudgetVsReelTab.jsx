/* Module: finance | Déclaration(s): BudgetVsReelTab */
import { computeMomentum } from '../agronomie/computeMomentum.jsx';
import { PROFILES } from '../shared/PROFILES.jsx';
import { SimpleAreaChart } from '../shared/SimpleAreaChart.jsx';
import { SimpleBarChart } from '../shared/SimpleBarChart.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { getCurrentWeekNumber } from '../shared/getCurrentWeekNumber.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { BUDGET_BGF } from './BUDGET_BGF.jsx';
import { computeAtterrissage } from './computeAtterrissage.jsx';
import { computeBudgetWeekly } from './computeBudgetWeekly.jsx';
import { computeProjection } from './computeProjection.jsx';

// ===================== BUDGET VS RÉEL TAB =====================
        function BudgetVsReelTab({ currentProfile, profileData }) {
            const isChef = currentProfile && currentProfile.startsWith('chef_');
            const chefFarm = isChef ? (PROFILES.find(p => p.id === currentProfile) || {}).farm : null;
            const canEdit = currentProfile === 'finance' || currentProfile === 'dg';

            const CURRENT_SEASON = '2025-2026';
            const VARIETIES_F5 = ['Corrina', 'Cascade', 'Breeze', 'Yazmin cut back', 'Reyna', 'Myrtille nouvelle plantation'];
            const VARIETIES_F1 = ['Maravilla LC', 'Maravilla GLC'];
            const ALL_VARIETIES = [...VARIETIES_F5, ...VARIETIES_F1];
            const WEEK_NUMBERS = Array.from({ length: 52 }, (_, i) => i + 1);

            const [subTab, setSubTab] = useState('synthese');
            const [selectedFerme, setSelectedFerme] = useState(chefFarm || 'F5');
            const [selectedSeason, setSelectedSeason] = useState(CURRENT_SEASON);
            const [granularity, setGranularity] = useState('week');

            // ---- Synthèse state ----
            const [comparison, setComparison] = useState(null);
            const [compLoading, setCompLoading] = useState(false);
            const [compError, setCompError] = useState(null);

            // ---- Saisie Budget state ----
            const [budgetCategory, setBudgetCategory] = useState('production');
            const [budgetEntries, setBudgetEntries] = useState({});
            const [budgetLoading, setBudgetLoading] = useState(false);
            const [budgetSaving, setBudgetSaving] = useState(false);

            // ---- Courbes Volume state ----
            const [curves, setCurves] = useState({});
            const [curvesLoading, setCurvesLoading] = useState(false);
            const [selectedVariety, setSelectedVariety] = useState('Corrina');
            const [curveParams, setCurveParams] = useState({ kg_par_plante: 0, nbr_plant_ha: 0, nbr_ha: 0, coefficient: 1, total_volume_kg: 0 });
            const [curveWeeks, setCurveWeeks] = useState({});
            const [curveSaving, setCurveSaving] = useState(false);
            const [globalBudget, setGlobalBudget] = useState('');

            // ---- Import state ----
            const [importType, setImportType] = useState('canevas');
            const [importFile, setImportFile] = useState(null);
            const [importing, setImporting] = useState(false);
            const [importResult, setImportResult] = useState(null);
            const [importHistory, setImportHistory] = useState([]);

            // ---- Coût Intrants state ----
            const [intrantsCosts, setIntrantsCosts] = useState(null);
            const [intrantsCostsLoading, setIntrantsCostsLoading] = useState(false);

            // ---- Budget Kg/Ha state ----
            const budgetVarieties = Object.keys(BUDGET_BGF);
            const [budgetHaVariety, setBudgetHaVariety] = useState(budgetVarieties[0] || '');
            const storedBGFTotals = (() => { try { return JSON.parse(localStorage.getItem('budgetBGFTotals') || '{}'); } catch(e) { return {}; } })();
            const [editBGFTotal, setEditBGFTotal] = useState(storedBGFTotals[budgetVarieties[0]] || (BUDGET_BGF[budgetVarieties[0]] || {}).total || 0);
            const [showBudgetEcarts, setShowBudgetEcarts] = useState(true);

            const CATEGORIES = [
                { id: 'production', label: 'Production', icon: 'fa-basket-shopping', fields: [
                    { key: 'recolte_kg', label: 'Récolte (kg)', unit: 'kg' },
                    { key: 'export_kg', label: 'Export (kg)', unit: 'kg' },
                    { key: 'marche_local_kg', label: 'Marché Local (kg)', unit: 'kg' },
                ]},
                { id: 'hors_recolte', label: 'Hors Récolte', icon: 'fa-trowel', fields: [
                    { key: 'mod_generale_jh', label: 'M.O. Générale', unit: 'JH' },
                    { key: 'palissage_jh', label: 'Palissage', unit: 'JH' },
                    { key: 'aeration_jh', label: 'Aération', unit: 'JH' },
                    { key: 'plantation_jh', label: 'Plantation', unit: 'JH' },
                    { key: 'irrigation_jh', label: 'Irrigation', unit: 'JH' },
                    { key: 'traitement_jh', label: 'Traitement', unit: 'JH' },
                    { key: 'entretien_serre_jh', label: 'Entretien Serre', unit: 'JH' },
                    { key: 'entretien_domaine_jh', label: 'Entretien Domaine', unit: 'JH' },
                    { key: 'mod_caporaux_jh', label: 'M.O. Caporaux', unit: 'JH' },
                ]},
                { id: 'intrants', label: 'Intrants', icon: 'fa-flask', fields: [
                    { key: 'engrais_kdh', label: 'Engrais', unit: 'Kdh' },
                    { key: 'phytosanitaires_kdh', label: 'Phytosanitaires', unit: 'Kdh' },
                    { key: 'autres_intrants_kdh', label: 'Autres Intrants', unit: 'Kdh' },
                ]},
                { id: 'recolte_costs', label: 'Coûts Récolte', icon: 'fa-coins', fields: [
                    { key: 'mod_recolte_jh', label: 'M.O. Récolte', unit: 'JH' },
                    { key: 'vitesse_kg_h', label: 'Vitesse kg/h', unit: 'kg/h' },
                    { key: 'prix_ouvrier_dh_h', label: 'Prix ouvrier', unit: 'Dh/h' },
                    { key: 'cout_recolte_dh_kg', label: 'Coût récolte', unit: 'Dh/kg' },
                ]},
            ];

            const currentFermeVarieties = selectedFerme === 'F1' ? VARIETIES_F1 : VARIETIES_F5;

            // ---- Load budget entries ----
            const loadBudget = () => {
                setBudgetLoading(true);
                fetch(`/api/budget?action=get-budget&season=${selectedSeason}&ferme=${selectedFerme}`)
                    .then(r => r.json())
                    .then(json => {
                        if (json.success) {
                            const map = {};
                            (json.entries || []).forEach(e => { map[e.category] = e.varieties || {}; });
                            setBudgetEntries(map);
                        }
                    }).catch(() => {}).finally(() => setBudgetLoading(false));
            };

            // ---- Load curves ----
            const loadCurves = () => {
                setCurvesLoading(true);
                fetch(`/api/budget?action=get-curves&season=${selectedSeason}&ferme=${selectedFerme}`)
                    .then(r => r.json())
                    .then(json => {
                        if (json.success) {
                            const map = {};
                            (json.curves || []).forEach(c => { map[c.variete] = c; });
                            setCurves(map);
                        }
                    }).catch(() => {}).finally(() => setCurvesLoading(false));
            };

            // ---- Load import history ----
            const loadImportHistory = () => {
                fetch(`/api/budget?action=get-import-history&season=${selectedSeason}`)
                    .then(r => r.json())
                    .then(json => { if (json.success) setImportHistory(json.imports || []); })
                    .catch(() => {});
            };

            useEffect(() => { loadBudget(); loadCurves(); }, [selectedSeason, selectedFerme]);
            useEffect(() => { if (subTab === 'import') loadImportHistory(); }, [subTab]);
            useEffect(() => {
                if (subTab === 'cout_intrants' && !intrantsCosts) {
                    setIntrantsCostsLoading(true);
                    cachedFetch('/api/stock?action=get-consumption-costs')
                        .then(json => { if (json.success) setIntrantsCosts(json.data); })
                        .catch(() => {}).finally(() => setIntrantsCostsLoading(false));
                }
            }, [subTab]);

            // ---- Load comparison ----
            const loadComparison = () => {
                setCompLoading(true); setCompError(null);
                const now = new Date();
                const startOfYear = `${now.getFullYear()}-01-01`;
                const today = now.toISOString().slice(0, 10);
                fetch(`/api/budget?action=get-comparison&season=${selectedSeason}&ferme=${selectedFerme}&startDate=${startOfYear}&endDate=${today}&granularity=${granularity}`)
                    .then(r => r.json())
                    .then(json => {
                        if (json.success) setComparison(json);
                        else setCompError(json.error || 'Erreur chargement');
                    }).catch(e => setCompError(e.message)).finally(() => setCompLoading(false));
            };

            useEffect(() => { if (subTab === 'synthese') loadComparison(); }, [subTab, selectedSeason, selectedFerme, granularity]);

            // ---- Update curve params → recalculate total ----
            useEffect(() => {
                const curv = curves[selectedVariety];
                if (curv) {
                    setCurveParams(curv.params || { kg_par_plante: 0, nbr_plant_ha: 0, nbr_ha: 0, coefficient: 1, total_volume_kg: 0 });
                    setCurveWeeks(curv.weeks || {});
                } else {
                    setCurveParams({ kg_par_plante: 0, nbr_plant_ha: 0, nbr_ha: 0, coefficient: 1, total_volume_kg: 0 });
                    setCurveWeeks({});
                }
            }, [selectedVariety, curves]);

            const calcTotalFromParams = (p) =>
                Math.round((p.kg_par_plante || 0) * (p.nbr_plant_ha || 0) * (p.nbr_ha || 0) * (p.coefficient || 1));

            const handleParamChange = (key, val) => {
                const newP = { ...curveParams, [key]: parseFloat(val) || 0 };
                newP.total_volume_kg = calcTotalFromParams(newP);
                setCurveParams(newP);
            };

            // ---- Distribute global budget by week percentages ----
            const distributeGlobalBudget = () => {
                const total = parseFloat(globalBudget) || 0;
                if (total <= 0) return;
                const sumPct = Object.values(curveWeeks).reduce((s, v) => s + (parseFloat(v) || 0), 0);
                if (sumPct <= 0) { alert('Veuillez saisir les pourcentages semaines d\'abord'); return; }
                // Recalculate total_volume_kg from global budget
                const newParams = { ...curveParams, total_volume_kg: total };
                setCurveParams(newParams);
            };

            // ---- Save budget ----
            const saveBudget = () => {
                setBudgetSaving(true);
                const catDef = CATEGORIES.find(c => c.id === budgetCategory);
                const varietiesData = {};
                currentFermeVarieties.forEach(v => {
                    const vData = {};
                    catDef.fields.forEach(f => {
                        const val = budgetEntries[budgetCategory]?.[v]?.[f.key];
                        vData[f.key] = parseFloat(val) || 0;
                    });
                    varietiesData[v] = vData;
                });
                fetch('/api/budget?action=save-budget', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ season: selectedSeason, ferme: selectedFerme, category: budgetCategory, varieties: varietiesData, updatedBy: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json())
                    .then(json => { if (json.success) { alert('Budget sauvegardé'); loadBudget(); } else alert('Erreur: ' + (json.error || 'Echec')); })
                    .catch(e => alert('Erreur: ' + e.message)).finally(() => setBudgetSaving(false));
            };

            // ---- Save curve ----
            const saveCurve = () => {
                setCurveSaving(true);
                const pctSum = Object.values(curveWeeks).reduce((s, v) => s + (parseFloat(v) || 0), 0);
                if (Math.abs(pctSum - 100) > 0.5) {
                    if (!confirm(`Total des % = ${pctSum.toFixed(1)}% (≠ 100%). Continuer quand même ?`)) { setCurveSaving(false); return; }
                }
                fetch('/api/budget?action=save-curve', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ season: selectedSeason, ferme: selectedFerme, variete: selectedVariety, params: curveParams, weeks: curveWeeks, updatedBy: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json())
                    .then(json => { if (json.success) { alert('Courbe sauvegardée'); loadCurves(); } else alert('Erreur: ' + (json.error || 'Echec')); })
                    .catch(e => alert('Erreur: ' + e.message)).finally(() => setCurveSaving(false));
            };

            // ---- Handle import ----
            const handleImport = () => {
                if (!importFile) { alert('Veuillez sélectionner un fichier Excel'); return; }
                setImporting(true); setImportResult(null);
                const reader = new FileReader();
                reader.onload = (evt) => {
                    const base64 = evt.target.result.split(',')[1];
                    fetch(`/api/budget?action=import-${importType}`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ file: base64, season: selectedSeason, updatedBy: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                    }).then(r => r.json())
                        .then(json => { setImportResult(json); if (json.success) { loadBudget(); loadCurves(); } })
                        .catch(e => setImportResult({ success: false, error: e.message }))
                        .finally(() => setImporting(false));
                };
                reader.readAsDataURL(importFile);
            };

            // ---- Ecart badge color ----
            const ecartBadge = (pct) => {
                const abs = Math.abs(pct || 0);
                const color = abs < 5 ? '#22c55e' : abs < 15 ? '#f59e0b' : '#ef4444';
                const bg = abs < 5 ? '#dcfce7' : abs < 15 ? '#fef3c7' : '#fee2e2';
                return <span style={{ background: bg, color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{pct > 0 ? '+' : ''}{pct}%</span>;
            };

            // ---- Weekly curve chart data ----
            const curveChartData = WEEK_NUMBERS
                .filter(w => curveWeeks[String(w)] > 0)
                .map(w => ({
                    week: `S${w}`,
                    pct: parseFloat(curveWeeks[String(w)]) || 0,
                    kg: Math.round(((parseFloat(curveWeeks[String(w)]) || 0) / 100) * (curveParams.total_volume_kg || 0)),
                }));

            // ---- Synthèse production chart data ----
            const synthChartData = (() => {
                if (!comparison?.summary?.production) return [];
                return Object.entries(comparison.summary.production).slice(0, 8).map(([v, d]) => ({
                    variety: v.length > 12 ? v.slice(0, 12) + '…' : v,
                    Budget: Math.round(d.budget_kg || 0),
                    Réel: Math.round(d.actual_kg || 0),
                }));
            })();

            const totalBudgetKg = Object.values(comparison?.summary?.production || {}).reduce((s, d) => s + (d.budget_kg || 0), 0);
            const totalActualKg = Object.values(comparison?.summary?.production || {}).reduce((s, d) => s + (d.actual_kg || 0), 0);
            const totalEcartPct = totalBudgetKg > 0 ? Math.round((totalActualKg - totalBudgetKg) / totalBudgetKg * 100) : 0;

            const totalHRActual = Object.values(comparison?.summary?.hors_recolte || {}).reduce((s, d) => s + (d.actual_jh || 0), 0);
            const totalIntrantsActual = Object.values(comparison?.summary?.intrants || {}).reduce((s, d) => s + (d.actual_qty || 0), 0);

            const SUB_TABS = [
                { id: 'synthese', label: 'Synthèse', icon: 'fa-gauge-high' },
                { id: 'cout_intrants', label: 'Coût Intrants', icon: 'fa-flask' },
                { id: 'saisie', label: 'Saisie Budget', icon: 'fa-pen-to-square', editOnly: true },
                { id: 'courbes', label: 'Courbes Volume', icon: 'fa-wave-square' },
                { id: 'import', label: 'Import Excel', icon: 'fa-file-excel', editOnly: true },
                { id: 'budget_ha', label: 'Budget Kg/Ha', icon: 'fa-table-columns' },
            ];

            const visibleSubTabs = SUB_TABS.filter(t => !t.editOnly || canEdit);

            const btnStyle = (active) => ({
                padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12,
                background: active ? 'var(--berry)' : 'var(--surface)', color: active ? '#fff' : 'var(--text)',
                display: 'flex', alignItems: 'center', gap: 6,
            });
            const inputStyle = { padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, width: '100%' };
            const cellStyle = { padding: '6px 8px', border: '1px solid var(--border)', fontSize: 12 };

            return (
                <div className="fade-in" style={{ padding: '0 0 40px 0' }}>
                    {/* Header */}
                    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}><i className="fas fa-scale-balanced" style={{ color: 'var(--berry)', marginRight: 8 }}></i>Budget vs Réel — {selectedSeason}</h2>
                            <div style={{ color: 'var(--gray-400)', fontSize: 12, marginTop: 2 }}>Suivi budgétaire par ferme et par variété</div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            {!isChef && (
                                <select value={selectedFerme} onChange={e => setSelectedFerme(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                                    <option value="F5">F5 — Myrtille/Framboise</option>
                                    <option value="F1">F1 — Framboise Larache</option>
                                </select>
                            )}
                            <select value={granularity} onChange={e => setGranularity(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                                <option value="week">Par semaine</option>
                                <option value="month">Par mois</option>
                                <option value="day">Par jour</option>
                            </select>
                        </div>
                    </div>

                    {/* Sub-navigation */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                        {visibleSubTabs.map(t => (
                            <button key={t.id} style={btnStyle(subTab === t.id)} onClick={() => setSubTab(t.id)}>
                                <i className={`fas ${t.icon}`}></i>{t.label}
                            </button>
                        ))}
                    </div>

                    {/* ========== SYNTHÈSE ========== */}
                    {subTab === 'synthese' && (
                        <div>
                            {compLoading && <div style={{ textAlign: 'center', padding: 40 }}><i className="fas fa-spinner fa-spin" style={{ fontSize: 24, color: 'var(--berry)' }}></i></div>}
                            {compError && <div style={{ background: '#fee2e2', color: '#ef4444', padding: 16, borderRadius: 8, marginBottom: 16 }}>Erreur: {compError}</div>}
                            {!compLoading && (
                                <>
                                    {/* KPI Cards */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                                        {[
                                            { label: 'Production Budget', val: `${Math.round(totalBudgetKg).toLocaleString()} kg`, icon: 'fa-basket-shopping', color: '#3b82f6' },
                                            { label: 'Production Réelle', val: `${Math.round(totalActualKg).toLocaleString()} kg`, icon: 'fa-weight-hanging', color: '#22c55e' },
                                            { label: 'Écart Production', val: ecartBadge(totalEcartPct), icon: 'fa-chart-line', color: totalEcartPct < 0 ? '#ef4444' : '#f59e0b' },
                                            { label: 'H.R. Réel (JH)', val: Math.round(totalHRActual).toLocaleString(), icon: 'fa-person-digging', color: '#8b5cf6' },
                                        ].map((kpi, i) => (
                                            <div key={i} style={{ background: 'var(--surface)', borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center' }}>
                                                <div style={{ width: 40, height: 40, borderRadius: 8, background: kpi.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <i className={`fas ${kpi.icon}`} style={{ color: kpi.color, fontSize: 16 }}></i>
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{kpi.label}</div>
                                                    <div style={{ fontSize: 16, fontWeight: 700 }}>{kpi.val}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Production chart */}
                                    {synthChartData.length > 0 && (
                                        <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
                                            <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700 }}>Production par Variété — Budget vs Réel</h3>
                                            <SimpleBarChart data={synthChartData} dataKeys={['Budget', 'Réel']} colors={['#3b82f6', '#22c55e']} xKey="variety" height={220} />
                                        </div>
                                    )}

                                    {/* Écarts table */}
                                    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
                                        <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700 }}>Détail Écarts — Production</h3>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                                <thead>
                                                    <tr style={{ background: 'var(--bg)' }}>
                                                        {['Variété', 'Budget (kg)', 'Réel (kg)', 'Écart (kg)', 'Écart %'].map(h => (
                                                            <th key={h} style={{ ...cellStyle, textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {Object.entries(comparison?.summary?.production || {}).map(([v, d]) => (
                                                        <tr key={v} style={{ borderBottom: '1px solid var(--border)' }}>
                                                            <td style={cellStyle}><strong>{v}</strong></td>
                                                            <td style={cellStyle}>{Math.round(d.budget_kg || 0).toLocaleString()}</td>
                                                            <td style={cellStyle}>{Math.round(d.actual_kg || 0).toLocaleString()}</td>
                                                            <td style={cellStyle}>{Math.round((d.actual_kg || 0) - (d.budget_kg || 0)).toLocaleString()}</td>
                                                            <td style={cellStyle}>{ecartBadge(d.ecart_pct || 0)}</td>
                                                        </tr>
                                                    ))}
                                                    {Object.keys(comparison?.summary?.production || {}).length === 0 && (
                                                        <tr><td colSpan={5} style={{ ...cellStyle, textAlign: 'center', color: 'var(--gray-400)' }}>Aucune donnée — saisissez le budget ou importez le Canevas</td></tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* Hors Récolte table */}
                                    {Object.keys(comparison?.summary?.hors_recolte || {}).length > 0 && (
                                        <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '16px 20px' }}>
                                            <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700 }}>Hors Récolte — Réel</h3>
                                            <div style={{ overflowX: 'auto' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                                    <thead>
                                                        <tr style={{ background: 'var(--bg)' }}>
                                                            {['Opération', 'JH Réel', 'Coût Réel (Dh)'].map(h => (
                                                                <th key={h} style={{ ...cellStyle, textAlign: 'left', fontWeight: 700 }}>{h}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {Object.entries(comparison.summary.hors_recolte).map(([op, d]) => (
                                                            <tr key={op} style={{ borderBottom: '1px solid var(--border)' }}>
                                                                <td style={cellStyle}>{op}</td>
                                                                <td style={cellStyle}>{Math.round(d.actual_jh || 0).toLocaleString()}</td>
                                                                <td style={cellStyle}>{Math.round(d.actual_cout || 0).toLocaleString()}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* ========== SAISIE BUDGET ========== */}
                    {subTab === 'saisie' && canEdit && (
                        <div>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                                {CATEGORIES.map(cat => (
                                    <button key={cat.id} style={btnStyle(budgetCategory === cat.id)} onClick={() => setBudgetCategory(cat.id)}>
                                        <i className={`fas ${cat.icon}`}></i>{cat.label}
                                    </button>
                                ))}
                            </div>

                            {budgetLoading ? (
                                <div style={{ textAlign: 'center', padding: 40 }}><i className="fas fa-spinner fa-spin" style={{ fontSize: 24, color: 'var(--berry)' }}></i></div>
                            ) : (() => {
                                const catDef = CATEGORIES.find(c => c.id === budgetCategory);
                                return (
                                    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '16px 20px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                                            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{catDef.label} — Ferme {selectedFerme} — {selectedSeason}</h3>
                                            <button onClick={saveBudget} disabled={budgetSaving} style={{ ...btnStyle(true), opacity: budgetSaving ? 0.6 : 1 }}>
                                                {budgetSaving ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-floppy-disk"></i>}
                                                {budgetSaving ? 'Sauvegarde…' : 'Sauvegarder'}
                                            </button>
                                        </div>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                                <thead>
                                                    <tr style={{ background: 'var(--bg)' }}>
                                                        <th style={{ ...cellStyle, fontWeight: 700, textAlign: 'left', minWidth: 130 }}>Variété</th>
                                                        {catDef.fields.map(f => (
                                                            <th key={f.key} style={{ ...cellStyle, fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }}>{f.label}<br/><span style={{ fontWeight: 400, color: 'var(--gray-400)' }}>{f.unit}</span></th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {currentFermeVarieties.map(v => (
                                                        <tr key={v} style={{ borderBottom: '1px solid var(--border)' }}>
                                                            <td style={{ ...cellStyle, fontWeight: 600 }}>{v}</td>
                                                            {catDef.fields.map(f => (
                                                                <td key={f.key} style={{ ...cellStyle, textAlign: 'center' }}>
                                                                    <input
                                                                        type="number"
                                                                        value={budgetEntries[budgetCategory]?.[v]?.[f.key] || ''}
                                                                        onChange={e => {
                                                                            const val = e.target.value;
                                                                            setBudgetEntries(prev => ({
                                                                                ...prev,
                                                                                [budgetCategory]: {
                                                                                    ...(prev[budgetCategory] || {}),
                                                                                    [v]: { ...(prev[budgetCategory]?.[v] || {}), [f.key]: val },
                                                                                },
                                                                            }));
                                                                        }}
                                                                        style={{ ...inputStyle, textAlign: 'right', width: 90 }}
                                                                        placeholder="0"
                                                                    />
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                    {/* Totals row */}
                                                    <tr style={{ background: 'var(--bg)', fontWeight: 700 }}>
                                                        <td style={cellStyle}>Total</td>
                                                        {catDef.fields.map(f => {
                                                            const total = currentFermeVarieties.reduce((s, v) => s + (parseFloat(budgetEntries[budgetCategory]?.[v]?.[f.key]) || 0), 0);
                                                            return <td key={f.key} style={{ ...cellStyle, textAlign: 'center' }}>{Math.round(total).toLocaleString()}</td>;
                                                        })}
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {/* ========== COURBES VOLUME ========== */}
                    {subTab === 'courbes' && (
                        <div>
                            {/* Variety selector */}
                            <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '14px 20px', marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                                <label style={{ fontSize: 12, fontWeight: 600 }}>Variété :</label>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {currentFermeVarieties.map(v => (
                                        <button key={v} style={{ ...btnStyle(selectedVariety === v), fontSize: 11 }} onClick={() => setSelectedVariety(v)}>{v}</button>
                                    ))}
                                </div>
                            </div>

                            {curvesLoading ? (
                                <div style={{ textAlign: 'center', padding: 40 }}><i className="fas fa-spinner fa-spin" style={{ fontSize: 24, color: 'var(--berry)' }}></i></div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                    {/* Left: Parameters */}
                                    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '16px 20px' }}>
                                        <h3 style={{ margin: '0 0 14px 0', fontSize: 14, fontWeight: 700 }}>Paramètres — {selectedVariety}</h3>
                                        {[
                                            { key: 'kg_par_plante', label: 'kg / plante' },
                                            { key: 'nbr_plant_ha', label: 'Plants / ha' },
                                            { key: 'nbr_ha', label: 'Nombre ha' },
                                            { key: 'coefficient', label: 'Coefficient' },
                                        ].map(p => (
                                            <div key={p.key} style={{ marginBottom: 10 }}>
                                                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: 4 }}>{p.label}</label>
                                                <input type="number" value={curveParams[p.key] || ''} onChange={e => handleParamChange(p.key, e.target.value)} style={inputStyle} disabled={!canEdit} step="0.01" />
                                            </div>
                                        ))}
                                        <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg)', borderRadius: 8 }}>
                                            <div style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 600 }}>Volume Total Calculé</div>
                                            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--berry)' }}>{(curveParams.total_volume_kg || 0).toLocaleString()} kg</div>
                                        </div>
                                        {canEdit && (
                                            <div style={{ marginTop: 12 }}>
                                                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Budget Global (kg) — répartit selon les %</label>
                                                <div style={{ display: 'flex', gap: 6 }}>
                                                    <input type="number" value={globalBudget} onChange={e => setGlobalBudget(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="ex: 500000" />
                                                    <button onClick={distributeGlobalBudget} style={{ ...btnStyle(false), whiteSpace: 'nowrap' }}>Appliquer</button>
                                                </div>
                                            </div>
                                        )}
                                        {canEdit && (
                                            <button onClick={saveCurve} disabled={curveSaving} style={{ ...btnStyle(true), width: '100%', marginTop: 14, justifyContent: 'center' }}>
                                                {curveSaving ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-floppy-disk"></i>}
                                                {curveSaving ? 'Sauvegarde…' : 'Sauvegarder la courbe'}
                                            </button>
                                        )}
                                    </div>

                                    {/* Right: Weekly % table */}
                                    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '16px 20px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Distribution Hebdomadaire (%)</h3>
                                            <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                                                Total: <strong style={{ color: Math.abs(Object.values(curveWeeks).reduce((s, v) => s + (parseFloat(v) || 0), 0) - 100) < 0.5 ? '#22c55e' : '#f59e0b' }}>
                                                    {Object.values(curveWeeks).reduce((s, v) => s + (parseFloat(v) || 0), 0).toFixed(1)}%
                                                </strong>
                                            </span>
                                        </div>
                                        <div style={{ overflowY: 'auto', maxHeight: 360 }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                                <thead>
                                                    <tr style={{ background: 'var(--bg)', position: 'sticky', top: 0 }}>
                                                        <th style={{ ...cellStyle, fontWeight: 700 }}>Sem.</th>
                                                        <th style={{ ...cellStyle, fontWeight: 700 }}>% Saison</th>
                                                        <th style={{ ...cellStyle, fontWeight: 700 }}>kg Estimé</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {WEEK_NUMBERS.map(w => {
                                                        const pct = parseFloat(curveWeeks[String(w)]) || 0;
                                                        const kg = Math.round((pct / 100) * (curveParams.total_volume_kg || 0));
                                                        return (
                                                            <tr key={w} style={{ borderBottom: '1px solid var(--border)', background: pct > 0 ? 'var(--bg)' : 'transparent' }}>
                                                                <td style={{ ...cellStyle, fontWeight: 600, color: 'var(--gray-400)' }}>S{w}</td>
                                                                <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                                    {canEdit ? (
                                                                        <input
                                                                            type="number" step="0.01" min="0" max="100"
                                                                            value={curveWeeks[String(w)] || ''}
                                                                            onChange={e => setCurveWeeks(prev => ({ ...prev, [String(w)]: e.target.value }))}
                                                                            style={{ ...inputStyle, width: 70, textAlign: 'right', padding: '3px 6px' }}
                                                                            placeholder="0"
                                                                        />
                                                                    ) : (
                                                                        <span>{pct > 0 ? pct.toFixed(2) + '%' : '—'}</span>
                                                                    )}
                                                                </td>
                                                                <td style={{ ...cellStyle, textAlign: 'right', color: kg > 0 ? 'var(--berry)' : 'var(--gray-400)', fontWeight: kg > 0 ? 700 : 400 }}>
                                                                    {kg > 0 ? kg.toLocaleString() : '—'}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Preview chart */}
                            {curveChartData.length > 0 && (
                                <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '16px 20px', marginTop: 16 }}>
                                    <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700 }}>Aperçu — Courbe de Production {selectedVariety}</h3>
                                    <SimpleAreaChart data={curveChartData} dataKeys={['kg']} colors={['var(--berry)']} xKey="week" height={220} />
                                </div>
                            )}
                        </div>
                    )}

                    {/* ========== IMPORT EXCEL ========== */}
                    {subTab === 'import' && canEdit && (
                        <div>
                            <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '20px 24px', marginBottom: 16 }}>
                                <h3 style={{ margin: '0 0 16px 0', fontSize: 14, fontWeight: 700 }}>Import Excel — Saison {selectedSeason}</h3>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                                    {[
                                        { id: 'canevas', label: 'BerryGood Canevas', desc: 'Budget par catégorie et variété (tous les onglets ferme)' },
                                        { id: 'curves', label: 'Courbe Volume', desc: 'Distribution hebdomadaire (%) par variété' },
                                    ].map(t => (
                                        <button key={t.id} onClick={() => setImportType(t.id)} style={{ ...btnStyle(importType === t.id), flexDirection: 'column', alignItems: 'flex-start', padding: '10px 16px', gap: 4 }}>
                                            <span style={{ fontWeight: 700 }}>{t.label}</span>
                                            <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.8 }}>{t.desc}</span>
                                        </button>
                                    ))}
                                </div>

                                <div
                                    style={{ border: '2px dashed var(--border)', borderRadius: 10, padding: 30, textAlign: 'center', cursor: 'pointer', background: 'var(--bg)' }}
                                    onClick={() => document.getElementById('budget-file-input').click()}
                                    onDragOver={e => e.preventDefault()}
                                    onDrop={e => { e.preventDefault(); setImportFile(e.dataTransfer.files[0]); setImportResult(null); }}
                                >
                                    <input id="budget-file-input" type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { setImportFile(e.target.files[0]); setImportResult(null); }} />
                                    <i className="fas fa-file-excel" style={{ fontSize: 32, color: '#22c55e', marginBottom: 8, display: 'block' }}></i>
                                    {importFile ? (
                                        <div><strong>{importFile.name}</strong><br/><span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{(importFile.size / 1024).toFixed(0)} KB</span></div>
                                    ) : (
                                        <div style={{ color: 'var(--gray-400)', fontSize: 13 }}>Cliquez ou glissez un fichier Excel (.xlsx)</div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                                    <button onClick={handleImport} disabled={!importFile || importing} style={{ ...btnStyle(true), opacity: (!importFile || importing) ? 0.5 : 1 }}>
                                        {importing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-upload"></i>}
                                        {importing ? 'Import en cours…' : 'Importer'}
                                    </button>
                                </div>

                                {importResult && (
                                    <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 8, background: importResult.success ? '#dcfce7' : '#fee2e2', color: importResult.success ? '#15803d' : '#ef4444' }}>
                                        {importResult.success ? (
                                            <>
                                                <i className="fas fa-circle-check" style={{ marginRight: 6 }}></i>
                                                Import réussi — {(importResult.imported || []).length} entrée(s) créée(s)
                                            </>
                                        ) : (
                                            <>
                                                <i className="fas fa-circle-xmark" style={{ marginRight: 6 }}></i>
                                                Erreur : {importResult.error}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Import history */}
                            {importHistory.length > 0 && (
                                <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '14px 20px' }}>
                                    <h3 style={{ margin: '0 0 10px 0', fontSize: 13, fontWeight: 700 }}>Historique des imports</h3>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                        <thead>
                                            <tr style={{ background: 'var(--bg)' }}>
                                                {['Date', 'Type', 'Par', 'Entrées'].map(h => <th key={h} style={{ ...cellStyle, fontWeight: 700, textAlign: 'left' }}>{h}</th>)}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {importHistory.map((imp, i) => (
                                                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                                    <td style={cellStyle}>{new Date(imp.importedAt).toLocaleDateString('fr-MA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                                                    <td style={cellStyle}><span style={{ background: imp.type === 'canevas' ? '#dbeafe' : '#dcfce7', color: imp.type === 'canevas' ? '#1d4ed8' : '#15803d', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>{imp.type}</span></td>
                                                    <td style={cellStyle}>{imp.importedBy?.name || '—'}</td>
                                                    <td style={cellStyle}>{(imp.entriesCreated || imp.curvesCreated || []).length}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ========== COÛT INTRANTS PAR VARIÉTÉ ========== */}
                    {subTab === 'cout_intrants' && (() => {
                        if (intrantsCostsLoading) return React.createElement('div', {style:{textAlign:'center',padding:40}}, React.createElement('i', {className:'fas fa-spinner fa-spin', style:{fontSize:24,color:'var(--berry)'}}));
                        if (!intrantsCosts) return React.createElement('div', {style:{textAlign:'center',padding:40,color:'var(--gray-400)'}}, 'Aucune donnée de consommation intrants disponible.');

                        // Filter by selected ferme
                        const varietyDocs = Object.entries(intrantsCosts)
                            .filter(([k, v]) => k !== '_summary' && (!chefFarm || v.ferme === chefFarm || (chefFarm === 'F5' && ['F5','Avocatier'].includes(v.ferme))) && (!selectedFerme || v.ferme === selectedFerme || (selectedFerme === 'F5' && ['F5','Avocatier'].includes(v.ferme))))
                            .sort((a, b) => (b[1].total_ttc || 0) - (a[1].total_ttc || 0));

                        const totalEngrais = varietyDocs.reduce((s, [, v]) => s + (v.engrais_ttc || 0), 0);
                        const totalPesticides = varietyDocs.reduce((s, [, v]) => s + (v.pesticides_ttc || 0), 0);
                        const totalAll = totalEngrais + totalPesticides;

                        const HA_MAP = { 'S3S7_MAR_MT': 5.2, 'S1S4_MAR_MD': 4.2, 'S2S5_YAZ_MD': 2.0, 'S10_YAZ_MT': 1.9, 'S13_YAZ_MD': 2.8, 'S9_REYNA': 3.0, 'CORINA': 2.5, 'AVOCAT': 30.7, 'CASCADE': 1.5, 'BREEZE': 1.0 };
                        const fmtDH = (v) => Math.round(v).toLocaleString('fr-FR') + ' DH';
                        const fmtKDH = (v) => (v / 1000).toFixed(1) + ' Kdh';

                        return React.createElement('div', null,
                            // KPI Cards
                            React.createElement('div', {style:{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))',gap:12,marginBottom:20}},
                                [{label:'Total Engrais', val:fmtKDH(totalEngrais), icon:'fa-flask', color:'#27AE60'},
                                 {label:'Total Pesticides', val:fmtKDH(totalPesticides), icon:'fa-spray-can-sparkles', color:'#E67E22'},
                                 {label:'Total Intrants', val:fmtKDH(totalAll), icon:'fa-boxes-stacked', color:'var(--berry)'},
                                 {label:'Variétés', val:varietyDocs.length, icon:'fa-seedling', color:'#3498DB'}
                                ].map((kpi, i) => React.createElement('div', {key:i, style:{background:'var(--surface)',borderRadius:10,padding:'14px 16px',display:'flex',gap:12,alignItems:'center'}},
                                    React.createElement('div', {style:{width:40,height:40,borderRadius:8,background:kpi.color+'20',display:'flex',alignItems:'center',justifyContent:'center'}},
                                        React.createElement('i', {className:'fas '+kpi.icon, style:{color:kpi.color,fontSize:16}})
                                    ),
                                    React.createElement('div', null,
                                        React.createElement('div', {style:{fontSize:10,color:'var(--gray-400)',fontWeight:600,textTransform:'uppercase',marginBottom:2}}, kpi.label),
                                        React.createElement('div', {style:{fontSize:16,fontWeight:700}}, kpi.val)
                                    )
                                ))
                            ),

                            // Table
                            React.createElement('div', {style:{background:'var(--surface)',borderRadius:12,overflow:'auto',marginBottom:20}},
                                React.createElement('table', {style:{width:'100%',borderCollapse:'collapse',fontSize:12}},
                                    React.createElement('thead', null,
                                        React.createElement('tr', {style:{background:'var(--gray-50)'}},
                                            ['Variété','Ferme','Ha','Engrais (DH)','Pesticides (DH)','Total (DH)','DH/Ha','% du Total'].map((h,i) =>
                                                React.createElement('th', {key:i, style:{padding:'10px 12px',textAlign:i>=3?'right':'left',fontWeight:700,borderBottom:'2px solid var(--border)',fontSize:11,textTransform:'uppercase',letterSpacing:'0.5px',color:'var(--gray-500)'}}, h)
                                            )
                                        )
                                    ),
                                    React.createElement('tbody', null,
                                        ...varietyDocs.map(([code, v], i) => {
                                            const ha = HA_MAP[code] || 0;
                                            const dhHa = ha > 0 ? Math.round(v.total_ttc / ha) : 0;
                                            const pctTotal = totalAll > 0 ? ((v.total_ttc / totalAll) * 100).toFixed(1) : '0';
                                            const maxTotal = Math.max(...varietyDocs.map(([,d]) => d.total_ttc || 0));
                                            const barPct = maxTotal > 0 ? (v.total_ttc / maxTotal) * 100 : 0;
                                            return React.createElement('tr', {key:code, style:{borderBottom:'1px solid var(--border)'}},
                                                React.createElement('td', {style:{padding:'10px 12px',fontWeight:600}}, v.variete),
                                                React.createElement('td', {style:{padding:'10px 12px'}},
                                                    React.createElement('span', {style:{padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:600,background:v.ferme==='F1'?'rgba(45,139,78,0.1)':v.ferme==='F5'?'rgba(52,152,219,0.1)':'rgba(243,156,18,0.1)',color:v.ferme==='F1'?'#2D8B4E':v.ferme==='F5'?'#3498DB':'#E67E22'}}, v.ferme)
                                                ),
                                                React.createElement('td', {style:{padding:'10px 12px'}}, ha > 0 ? ha.toFixed(1) : '\u2014'),
                                                React.createElement('td', {style:{padding:'10px 12px',textAlign:'right',color:'#27AE60',fontWeight:600}}, fmtDH(v.engrais_ttc || 0)),
                                                React.createElement('td', {style:{padding:'10px 12px',textAlign:'right',color:'#E67E22',fontWeight:600}}, fmtDH(v.pesticides_ttc || 0)),
                                                React.createElement('td', {style:{padding:'10px 12px',textAlign:'right',fontWeight:700}},
                                                    React.createElement('div', null, fmtDH(v.total_ttc || 0)),
                                                    React.createElement('div', {style:{height:4,borderRadius:2,background:'var(--gray-100)',marginTop:4}},
                                                        React.createElement('div', {style:{height:'100%',borderRadius:2,background:'var(--berry)',width:barPct+'%',transition:'width 0.5s'}})
                                                    )
                                                ),
                                                React.createElement('td', {style:{padding:'10px 12px',textAlign:'right',fontWeight:600}}, ha > 0 ? fmtDH(dhHa) : '\u2014'),
                                                React.createElement('td', {style:{padding:'10px 12px',textAlign:'right'}}, pctTotal + '%')
                                            );
                                        }),
                                        // Total row
                                        React.createElement('tr', {style:{background:'var(--gray-50)',fontWeight:700,borderTop:'2px solid var(--border)'}},
                                            React.createElement('td', {style:{padding:'10px 12px'},colSpan:3}, 'TOTAL'),
                                            React.createElement('td', {style:{padding:'10px 12px',textAlign:'right',color:'#27AE60'}}, fmtDH(totalEngrais)),
                                            React.createElement('td', {style:{padding:'10px 12px',textAlign:'right',color:'#E67E22'}}, fmtDH(totalPesticides)),
                                            React.createElement('td', {style:{padding:'10px 12px',textAlign:'right'}}, fmtDH(totalAll)),
                                            React.createElement('td', {style:{padding:'10px 12px',textAlign:'right'}}, '\u2014'),
                                            React.createElement('td', {style:{padding:'10px 12px',textAlign:'right'}}, '100%')
                                        )
                                    )
                                )
                            ),

                            // Stacked bar chart
                            React.createElement('div', {style:{background:'var(--surface)',borderRadius:12,padding:20}},
                                React.createElement('h4', {style:{margin:'0 0 16px 0',fontSize:14,fontWeight:700}},
                                    React.createElement('i', {className:'fas fa-chart-bar',style:{color:'var(--berry)',marginRight:8}}),
                                    'Répartition Engrais vs Pesticides par Variété'
                                ),
                                React.createElement('div', {style:{display:'flex',flexDirection:'column',gap:8}},
                                    ...varietyDocs.map(([code, v]) => {
                                        const eng = v.engrais_ttc || 0;
                                        const pest = v.pesticides_ttc || 0;
                                        const total = eng + pest;
                                        const maxBar = Math.max(...varietyDocs.map(([,d]) => (d.engrais_ttc||0)+(d.pesticides_ttc||0)));
                                        const barW = maxBar > 0 ? (total / maxBar) * 100 : 0;
                                        const engPct = total > 0 ? (eng / total) * 100 : 0;
                                        return React.createElement('div', {key:code, style:{display:'flex',alignItems:'center',gap:12}},
                                            React.createElement('div', {style:{width:120,fontSize:11,fontWeight:600,textAlign:'right',flexShrink:0}}, v.variete),
                                            React.createElement('div', {style:{flex:1,height:22,background:'var(--gray-100)',borderRadius:4,overflow:'hidden',display:'flex',position:'relative',width:barW+'%'}},
                                                React.createElement('div', {style:{width:engPct+'%',height:'100%',background:'#27AE60',transition:'width 0.5s'}}),
                                                React.createElement('div', {style:{width:(100-engPct)+'%',height:'100%',background:'#E67E22',transition:'width 0.5s'}})
                                            ),
                                            React.createElement('div', {style:{width:80,fontSize:10,color:'var(--gray-500)',flexShrink:0}}, fmtKDH(total))
                                        );
                                    })
                                ),
                                React.createElement('div', {style:{display:'flex',gap:16,marginTop:12,justifyContent:'center'}},
                                    React.createElement('div', {style:{display:'flex',alignItems:'center',gap:6,fontSize:11}},
                                        React.createElement('div', {style:{width:12,height:12,borderRadius:3,background:'#27AE60'}}), 'Engrais'
                                    ),
                                    React.createElement('div', {style:{display:'flex',alignItems:'center',gap:6,fontSize:11}},
                                        React.createElement('div', {style:{width:12,height:12,borderRadius:3,background:'#E67E22'}}), 'Pesticides'
                                    )
                                )
                            )
                        );
                    })()}

                    {/* ========== BUDGET KG/HA ========== */}
                    {subTab === 'budget_ha' && (() => {
                        const config = BUDGET_BGF[budgetHaVariety];
                        if (!config) return <div style={{padding:40, textAlign:'center', color:'var(--gray-400)'}}>Aucune variété budget configurée</div>;

                        const budgetWeekly = computeBudgetWeekly(editBGFTotal, config.distribution);
                        const budgetWeeks = Object.keys(config.distribution).map(Number).sort((a, b) => a - b);
                        const curWeek = getCurrentWeekNumber();

                        const reelByWeek = {};

                        const momentum = computeMomentum(reelByWeek, budgetWeekly, curWeek);
                        const projection = computeProjection(reelByWeek, budgetWeekly, momentum, curWeek);
                        const atterrissage = computeAtterrissage(reelByWeek, budgetWeekly, momentum, curWeek);

                        const handleTotalChange = (val) => {
                            const numVal = parseFloat(val) || 0;
                            setEditBGFTotal(numVal);
                            const stored = (() => { try { return JSON.parse(localStorage.getItem('budgetBGFTotals') || '{}'); } catch(e) { return {}; } })();
                            const totals = { ...stored, [budgetHaVariety]: numVal };
                            localStorage.setItem('budgetBGFTotals', JSON.stringify(totals));
                        };

                        const handleVarietyChange = (v) => {
                            setBudgetHaVariety(v);
                            const stored = (() => { try { return JSON.parse(localStorage.getItem('budgetBGFTotals') || '{}'); } catch(e) { return {}; } })();
                            setEditBGFTotal(stored[v] || (BUDGET_BGF[v] || {}).total || 0);
                        };

                        let budgetCumul = 0;

                        return (
                            <div>
                                {/* KPI Cards */}
                                <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12, marginBottom:16}}>
                                    <div style={{background:'#fdf2f8', borderRadius:10, padding:'12px 16px'}}>
                                        <div style={{fontSize:10, color:'#999', fontWeight:600, marginBottom:4}}>OBJECTIF BGF</div>
                                        <div style={{fontSize:18, fontWeight:700, color:'#e91e8f'}}>{editBGFTotal.toLocaleString()} kg/ha</div>
                                    </div>
                                    <div style={{background:'#f0fdf4', borderRadius:10, padding:'12px 16px'}}>
                                        <div style={{fontSize:10, color:'#999', fontWeight:600, marginBottom:4}}>ATTERRISSAGE PROJETÉ</div>
                                        <div style={{fontSize:18, fontWeight:700, color:'#22c55e'}}>{atterrissage.toLocaleString()} kg/ha</div>
                                    </div>
                                    <div style={{background: momentum >= 1 ? '#f0fdf4' : '#fef2f2', borderRadius:10, padding:'12px 16px'}}>
                                        <div style={{fontSize:10, color:'#999', fontWeight:600, marginBottom:4}}>MOMENTUM</div>
                                        <div style={{fontSize:18, fontWeight:700, color: momentum >= 1 ? '#22c55e' : '#ef4444'}}>{(momentum * 100).toFixed(0)}%</div>
                                    </div>
                                </div>

                                {/* Controls */}
                                <div style={{background:'var(--surface)', borderRadius:12, padding:'14px 20px', marginBottom:16, display:'flex', gap:16, flexWrap:'wrap', alignItems:'center'}}>
                                    <div style={{display:'flex', gap:6, alignItems:'center'}}>
                                        <label style={{fontSize:12, fontWeight:600}}>Variété :</label>
                                        {budgetVarieties.map(v => (
                                            <button key={v} style={{...btnStyle(budgetHaVariety === v), fontSize:11}} onClick={() => handleVarietyChange(v)}>{v}</button>
                                        ))}
                                    </div>
                                    <div style={{display:'flex', gap:6, alignItems:'center'}}>
                                        <label style={{fontSize:12, fontWeight:600}}>Objectif Total (kg/ha) :</label>
                                        <input type="number" value={editBGFTotal} onChange={e => handleTotalChange(e.target.value)} style={{...inputStyle, width:120, textAlign:'right', fontWeight:700, fontSize:14}} />
                                    </div>
                                    <label style={{display:'flex', alignItems:'center', gap:4, fontSize:11, cursor:'pointer', userSelect:'none', padding:'4px 10px', borderRadius:16, border: showBudgetEcarts ? '2px solid #e67e22' : '1.5px solid var(--gray-200)', background: showBudgetEcarts ? 'rgba(230,126,34,0.08)' : '#fff'}}>
                                        <input type="checkbox" checked={showBudgetEcarts} onChange={ev => setShowBudgetEcarts(ev.target.checked)} style={{accentColor:'#e67e22'}} />
                                        <span style={{fontWeight: showBudgetEcarts ? 600 : 500, color: showBudgetEcarts ? '#e67e22' : 'var(--gray-600)'}}>Écarts</span>
                                    </label>
                                </div>

                                {/* Budget Table */}
                                <div style={{background:'var(--surface)', borderRadius:12, padding:'16px 20px'}}>
                                    <h3 style={{margin:'0 0 12px 0', fontSize:14, fontWeight:700}}>
                                        <i className="fas fa-table-columns" style={{color:'var(--berry)', marginRight:8}}></i>
                                        Budget Kg/Ha — {budgetHaVariety}
                                    </h3>
                                    <div style={{overflowX:'auto'}}>
                                        <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                                            <thead>
                                                <tr style={{background:'var(--bg)'}}>
                                                    <th style={{...cellStyle, fontWeight:700, textAlign:'left'}}>Semaine</th>
                                                    <th style={{...cellStyle, fontWeight:700, textAlign:'center'}}>% Répartition</th>
                                                    <th style={{...cellStyle, fontWeight:700, textAlign:'center', color:'#e91e8f'}}>Budget BGF (Kg/Ha)</th>
                                                    <th style={{...cellStyle, fontWeight:700, textAlign:'center', color:'#e91e8f'}}>Budget Cumulé</th>
                                                    {showBudgetEcarts && (
                                                        <>
                                                            <th style={{...cellStyle, fontWeight:700, textAlign:'center', color:'#22c55e'}}>Réel Export (Kg/Ha)</th>
                                                            <th style={{...cellStyle, fontWeight:700, textAlign:'center', color:'#e67e22'}}>Écart</th>
                                                            <th style={{...cellStyle, fontWeight:700, textAlign:'center', color:'#3b82f6'}}>Projeté</th>
                                                        </>
                                                    )}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {budgetWeeks.map(w => {
                                                    const pct = config.distribution[w] || 0;
                                                    const budgetVal = budgetWeekly[w] || 0;
                                                    budgetCumul += budgetVal;
                                                    const reel = reelByWeek[w] || 0;
                                                    const ecart = reel - budgetVal;
                                                    const projVal = projection[w] || 0;
                                                    const isPast = w <= curWeek;
                                                    const isFuture = w > curWeek;
                                                    return (
                                                        <tr key={w} style={{borderBottom:'1px solid var(--border)', background: isFuture ? 'rgba(59,130,246,0.03)' : 'transparent'}}>
                                                            <td style={{...cellStyle, fontWeight:600}}>
                                                                W{w}
                                                                {w === curWeek && <span style={{marginLeft:6, background:'#22c55e', color:'#fff', borderRadius:4, padding:'1px 5px', fontSize:9, fontWeight:700}}>En cours</span>}
                                                            </td>
                                                            <td style={{...cellStyle, textAlign:'center', color:'var(--gray-400)'}}>{(pct * 100).toFixed(1)}%</td>
                                                            <td style={{...cellStyle, textAlign:'center', fontWeight:600, color:'#e91e8f'}}>{budgetVal.toLocaleString()}</td>
                                                            <td style={{...cellStyle, textAlign:'center', color:'#e91e8f', opacity:0.7}}>{budgetCumul.toLocaleString()}</td>
                                                            {showBudgetEcarts && (
                                                                <>
                                                                    <td style={{...cellStyle, textAlign:'center', fontWeight: isPast ? 600 : 400, fontStyle: isFuture ? 'italic' : 'normal', color: isPast ? '#22c55e' : 'var(--gray-400)'}}>
                                                                        {isPast ? (reel > 0 ? reel.toLocaleString() : '—') : '—'}
                                                                    </td>
                                                                    <td style={{...cellStyle, textAlign:'center', fontWeight:600, color: ecart >= 0 ? '#22c55e' : '#ef4444'}}>
                                                                        {isPast && reel > 0 ? (ecart > 0 ? '+' : '') + ecart.toLocaleString() : '—'}
                                                                    </td>
                                                                    <td style={{...cellStyle, textAlign:'center', fontWeight: isFuture ? 600 : 400, fontStyle: isFuture ? 'italic' : 'normal', color:'#3b82f6'}}>
                                                                        {isFuture ? projVal.toLocaleString() : (isPast && reel > 0 ? reel.toLocaleString() : '—')}
                                                                    </td>
                                                                </>
                                                            )}
                                                        </tr>
                                                    );
                                                })}
                                                {/* Total row */}
                                                <tr style={{background:'var(--bg)', fontWeight:700}}>
                                                    <td style={cellStyle}>Total</td>
                                                    <td style={{...cellStyle, textAlign:'center'}}>100%</td>
                                                    <td style={{...cellStyle, textAlign:'center', color:'#e91e8f'}}>{editBGFTotal.toLocaleString()}</td>
                                                    <td style={{...cellStyle, textAlign:'center', color:'#e91e8f'}}></td>
                                                    {showBudgetEcarts && (
                                                        <>
                                                            <td style={{...cellStyle, textAlign:'center', color:'#22c55e'}}>{Object.values(reelByWeek).reduce((s, v) => s + v, 0).toLocaleString() || '—'}</td>
                                                            <td style={cellStyle}></td>
                                                            <td style={{...cellStyle, textAlign:'center', color:'#3b82f6', fontWeight:700}}>{atterrissage.toLocaleString()}</td>
                                                        </>
                                                    )}
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            );
        }

export { BudgetVsReelTab };
