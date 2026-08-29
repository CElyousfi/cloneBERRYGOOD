/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: technique | Déclaration(s): IrrigationIntelligenceTab */
import { PARCELLES_CULTURALES } from '../agronomie/PARCELLES_CULTURALES.jsx';
import { getCycle } from '../agronomie/getCycle.jsx';
import { SimpleAreaChart } from '../shared/SimpleAreaChart.jsx';
import { SimpleComboChart } from '../shared/SimpleComboChart.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== STATIONNAIRE: PILOTAGE IRRIGATION (INTELLIGENCE) =====================
        // Reads from /api/stock?action=irrigation-intelligence which delegates
        // to functions/lib/irrigation/. UI stays logic-free — every metric,
        // diagnosis, badge and recommendation is server-computed.
        function IrrigationIntelligenceTab({ farmFilter, currentProfile, userProfile }) {
            const [parcelle, setParcelle] = useState('');
            const [periodDays, setPeriodDays] = useState(7);
            const [data, setData] = useState(null);
            const [loading, setLoading] = useState(false);
            const [error, setError] = useState(null);
            const [selectedKey, setSelectedKey] = useState(null);
            // Admin: parcelle metadata config
            const [showConfig, setShowConfig] = useState(false);
            const [configMeta, setConfigMeta] = useState(null);
            const [configLoading, setConfigLoading] = useState(false);
            const [configMsg, setConfigMsg] = useState(null);
            const [savingId, setSavingId] = useState(null);
            const [edits, setEdits] = useState({});  // { parcelleId: { field: value } }
            // Live RadSum since last pulse + ETA — only when parcelle selected on today's date
            const [liveRad, setLiveRad] = useState(null);

            const loadConfigMeta = React.useCallback(async () => {
                setConfigLoading(true);
                setConfigMsg(null);
                try {
                    const r = await fetch('/api/stock?action=irrigation-meta-list');
                    const j = await r.json();
                    if (j.success) {
                        setConfigMeta(j.meta || {});
                    } else {
                        setConfigMsg({ type: 'error', text: j.error || 'Erreur chargement config' });
                    }
                } catch (e) {
                    setConfigMsg({ type: 'error', text: 'Erreur réseau : ' + e.message });
                }
                setConfigLoading(false);
            }, []);

            const seedConfig = React.useCallback(async () => {
                setConfigLoading(true);
                setConfigMsg(null);
                try {
                    const r = await fetch('/api/stock?action=irrigation-meta-seed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                    const j = await r.json();
                    if (j.success) {
                        setConfigMsg({ type: 'ok', text: `${j.seeded} parcelles initialisées dans Firestore.` });
                        await loadConfigMeta();
                    } else {
                        setConfigMsg({ type: 'error', text: j.error || 'Erreur seed' });
                    }
                } catch (e) {
                    setConfigMsg({ type: 'error', text: 'Erreur réseau : ' + e.message });
                }
                setConfigLoading(false);
            }, [loadConfigMeta]);

            const saveOneMeta = React.useCallback(async (id, meta) => {
                setSavingId(id);
                setConfigMsg(null);
                try {
                    const r = await fetch('/api/stock?action=irrigation-meta-save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id, meta }),
                    });
                    const j = await r.json();
                    if (j.success) {
                        setConfigMsg({ type: 'ok', text: `${id} sauvegardé.` });
                        // Update local state
                        setConfigMeta(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...meta } }));
                        setEdits(prev => { const n = { ...prev }; delete n[id]; return n; });
                    } else {
                        setConfigMsg({ type: 'error', text: j.error || 'Erreur sauvegarde' });
                    }
                } catch (e) {
                    setConfigMsg({ type: 'error', text: 'Erreur réseau : ' + e.message });
                }
                setSavingId(null);
            }, []);

            useEffect(() => { if (showConfig && !configMeta) loadConfigMeta(); }, [showConfig, configMeta, loadConfigMeta]);

            const currentCycle = getCycle(new Date().toISOString());
            const parcelleOptions = React.useMemo(() => {
                return PARCELLES_CULTURALES
                    .filter(pc => pc.ferme === farmFilter && (pc.culture === 'Avocatier' || pc.cycle === currentCycle) && pc.enProduction !== false)
                    .map(pc => ({
                        value: pc.id,
                        label: pc.secteurs.join('/') + ' ' + pc.variete + (pc.sousVariete ? ' ' + pc.sousVariete : ''),
                    }));
            }, [farmFilter, currentCycle]);

            const { dateFrom, dateTo } = React.useMemo(() => {
                const today = new Date();
                const to = today.toISOString().slice(0, 10);
                const fromDate = new Date(today);
                fromDate.setDate(fromDate.getDate() - (periodDays - 1));
                return { dateFrom: fromDate.toISOString().slice(0, 10), dateTo: to };
            }, [periodDays]);

            useEffect(() => {
                if (!farmFilter) return;
                let cancelled = false;
                setLoading(true);
                setError(null);
                const params = new URLSearchParams({
                    action: 'irrigation-intelligence',
                    ferme: farmFilter,
                    dateFrom, dateTo,
                });
                if (parcelle) params.set('parcelle', parcelle);
                fetch('/api/stock?' + params.toString())
                    .then(r => r.json())
                    .then(j => {
                        if (cancelled) return;
                        if (!j.success) throw new Error(j.error || 'Erreur serveur');
                        setData(j);
                        const first = (j.summaries || [])[0];
                        setSelectedKey(first ? first.parcelle + '__' + first.date : null);
                    })
                    .catch(e => { if (!cancelled) { setError(e.message); setData(null); } })
                    .finally(() => { if (!cancelled) setLoading(false); });
                return () => { cancelled = true; };
            }, [farmFilter, parcelle, dateFrom, dateTo]);

            // Live RadSum + ETA — only meaningful for "today" on a specific parcelle.
            // Polls the next-pulse endpoint every 60s and re-uses the recommendNextPulse
            // pipeline (radSumSinceLastPulseNow + radEtaTime + radTargetJPerCm2).
            useEffect(() => {
                if (!farmFilter || !parcelle) { setLiveRad(null); return; }
                let cancelled = false;
                const todayStr = new Date().toISOString().slice(0, 10);
                const fetchLive = async () => {
                    try {
                        const r = await fetch('/api/stock?action=irrigation-intelligence-next-pulse'
                            + '&ferme=' + encodeURIComponent(farmFilter)
                            + '&parcelle=' + encodeURIComponent(parcelle)
                            + '&date=' + encodeURIComponent(todayStr));
                        const j = await r.json();
                        if (cancelled || !j.success) return;
                        setLiveRad({
                            radSumSinceLastPulseNow: j.radSumSinceLastPulseNow,
                            radTargetJPerCm2: j.radTargetJPerCm2,
                            radEtaMin: j.radEtaMin,
                            radEtaTime: j.radEtaTime,
                            lastPulseHeure: j.lastPulseHeure,
                            fetchedAt: Date.now(),
                        });
                    } catch (e) { /* silent */ }
                };
                fetchLive();
                const id = setInterval(fetchLive, 60_000);
                return () => { cancelled = true; clearInterval(id); };
            }, [farmFilter, parcelle]);

            // ----- formatters & style helpers -----
            const fmtVol = v => v == null || !Number.isFinite(v) ? '—' : Math.round(v) + ' mL';
            const fmtPct = v => v == null || !Number.isFinite(v) ? '—' : v.toFixed(1) + '%';
            const fmtEc = v => v == null || !Number.isFinite(v) ? '—' : v.toFixed(2);
            const fmtPh = v => v == null || !Number.isFinite(v) ? '—' : v.toFixed(2);
            const fmtNum = v => v == null || !Number.isFinite(v) ? '—' : String(v);

            const diagnosisStyle = (d) => {
                if (d === 'critical') return { color: 'var(--red)', bg: 'rgba(231,76,60,0.10)', label: 'Critique', icon: 'fa-circle-exclamation' };
                if (d === 'over-drain') return { color: 'var(--orange)', bg: 'rgba(243,156,18,0.10)', label: 'Drainage élevé', icon: 'fa-arrow-trend-up' };
                if (d === 'under-drain') return { color: '#d97706', bg: 'rgba(217,119,6,0.10)', label: 'Drainage faible', icon: 'fa-arrow-trend-down' };
                if (d === 'optimal') return { color: 'var(--green)', bg: 'rgba(46,204,113,0.10)', label: 'Optimal', icon: 'fa-circle-check' };
                return { color: 'var(--gray-400)', bg: 'rgba(107,114,128,0.10)', label: 'Sans donnée', icon: 'fa-circle-question' };
            };

            const levelStyle = (lvl) => {
                if (lvl === 'critical') return { color: 'var(--red)', bg: 'rgba(231,76,60,0.10)', icon: 'fa-circle-exclamation' };
                if (lvl === 'warning') return { color: 'var(--orange)', bg: 'rgba(243,156,18,0.10)', icon: 'fa-triangle-exclamation' };
                if (lvl === 'info') return { color: 'var(--blue)', bg: 'rgba(52,152,219,0.10)', icon: 'fa-circle-info' };
                if (lvl === 'ok') return { color: 'var(--green)', bg: 'rgba(46,204,113,0.10)', icon: 'fa-circle-check' };
                return { color: 'var(--gray-500)', bg: '#f3f4f6', icon: 'fa-circle' };
            };

            const pulseBadges = (p) => {
                const out = [];
                if (p.drainPct == null) {
                    out.push({ text: 'Pas de drainage', color: 'var(--gray-500)', bg: '#f3f4f6' });
                } else if (p.drainPct > 35) {
                    out.push({ text: 'Critique', color: '#fff', bg: 'var(--red)' });
                } else if (p.isHighDrain) {
                    out.push({ text: 'Drain élevé', color: '#fff', bg: 'var(--orange)' });
                } else if (p.isLowDrain) {
                    out.push({ text: 'Drain faible', color: '#fff', bg: '#d97706' });
                } else {
                    out.push({ text: 'OK', color: '#fff', bg: 'var(--green)' });
                }
                if (p.isLateDayPulse) out.push({ text: 'Tardif', color: '#fff', bg: 'var(--blue)' });
                if (p.ecDelta != null && p.ecDelta > 0.4) out.push({ text: 'EC↑', color: '#fff', bg: '#7c3aed' });
                // Radiation-based badges (only when RadSum was computed)
                if (p.radSumSincePreviousPulse != null) {
                    if (p.radSumSincePreviousPulse < 60) out.push({ text: 'Trop tôt', color: '#fff', bg: '#0891b2' });
                    else if (p.radSumSincePreviousPulse > 250) out.push({ text: 'Trop tard', color: '#fff', bg: '#be123c' });
                }
                return out;
            };

            const _today = new Date().toISOString().slice(0, 10);
            const _findSummary = () => {
                if (!data || !Array.isArray(data.summaries)) return null;
                const found = data.summaries.find(s => (s.parcelle + '__' + s.date) === selectedKey);
                if (found) return found;
                // Virtual today (no data yet) — synthesize an empty summary
                if (selectedKey && selectedKey.endsWith('__' + _today)) {
                    const parc = selectedKey.split('__')[0];
                    return {
                        virtual: true,
                        date: _today, parcelle: parc, ferme: data.ferme,
                        parcelleLabel: (parcelleOptions.find(o => o.value === parc) || {}).label || parc,
                        totalInputMl: 0, totalDrainMl: 0, totalDrainPct: null,
                        avgEcPts: null, avgEcDrain: null, avgPhPts: null, avgPhDrain: null,
                        pulseCount: 0, highDrainPulseCount: 0, lowDrainPulseCount: 0,
                        irrigationCutoffTime: null, diagnosis: 'unknown', diagnosisReasons: [],
                        drainTrend: null, pulses: [],
                    };
                }
                return null;
            };
            const selectedSummary = _findSummary();
            const selectedTrail = (data && data.pulseTrailByKey && selectedKey)
                ? (data.pulseTrailByKey[selectedKey] || [])
                : [];
            const selectedRadRecos = (data && data.radiationRecommendationsByKey && selectedKey)
                ? (data.radiationRecommendationsByKey[selectedKey] || [])
                : [];
            const selectedRecos = (data && data.recommendationsByKey && selectedKey)
                ? (data.recommendationsByKey[selectedKey] || [])
                : [];

            // ----- shared inline panel style for visual rhythm -----
            const panelBase = { background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 16, marginBottom: 16 };

            return React.createElement('div', { className: 'fade-in', style: { padding: 16 } },
                // ===== Header =====
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 } },
                    React.createElement('h2', { style: { fontSize: '1.2rem', color: 'var(--berry)', margin: 0 } },
                        React.createElement('i', { className: 'fa-solid fa-brain', style: { marginRight: 8 } }),
                        'Pilotage Irrigation — ', farmFilter,
                    ),
                    React.createElement('button', {
                        onClick: () => setShowConfig(!showConfig),
                        style: {
                            background: showConfig ? 'var(--berry)' : '#fff',
                            color: showConfig ? '#fff' : 'var(--berry)',
                            border: '1px solid var(--berry)',
                            borderRadius: 8,
                            padding: '6px 12px',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                        },
                    },
                        React.createElement('i', { className: 'fa-solid fa-gear', style: { marginRight: 6 } }),
                        showConfig ? 'Fermer config' : 'Config parcelles',
                    ),
                ),
                React.createElement('div', { style: { fontSize: 12, color: 'var(--gray-500)', marginBottom: 8 } },
                    'Analyse agronomique automatique des pulses, basée sur ', periodDays, ' jours de données.',
                ),
                // Disclaimer — test feature, agronomist judgment prevails
                React.createElement('div', {
                    style: {
                        background: 'rgba(243,156,18,0.08)',
                        border: '1px solid rgba(243,156,18,0.25)',
                        borderRadius: 8,
                        padding: '8px 12px',
                        fontSize: 11.5,
                        color: 'var(--gray-600)',
                        marginBottom: 16,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        lineHeight: 1.45,
                    },
                },
                    React.createElement('i', { className: 'fa-solid fa-flask', style: { color: 'var(--orange)', marginTop: 2 } }),
                    React.createElement('span', null,
                        React.createElement('strong', { style: { color: 'var(--gray-700)' } }, 'Outil en phase de test — peut se tromper.'),
                        ' Les diagnostics et recommandations sont générés automatiquement à partir des règles agronomiques. À recouper avec l\'observation terrain (substrat, plantes, capteurs) avant toute décision opérationnelle.',
                    ),
                ),

                // ===== Config panel (admin: pot volume + substrate + greenhouse type per parcelle) =====
                showConfig && React.createElement('div', { style: { ...panelBase, padding: 16, borderColor: 'var(--berry)', borderWidth: 2 } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 } },
                        React.createElement('div', { style: { fontSize: 14, fontWeight: 700, color: 'var(--berry)' } },
                            React.createElement('i', { className: 'fa-solid fa-gear', style: { marginRight: 6 } }),
                            'Configuration parcelles',
                        ),
                        React.createElement('div', { style: { display: 'flex', gap: 8 } },
                            React.createElement('button', {
                                onClick: seedConfig, disabled: configLoading,
                                style: { background: '#fff', color: 'var(--berry)', border: '1px solid var(--berry)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: configLoading ? 'wait' : 'pointer' },
                            },
                                React.createElement('i', { className: 'fa-solid fa-database', style: { marginRight: 4 } }),
                                'Initialiser depuis le code',
                            ),
                            React.createElement('button', {
                                onClick: loadConfigMeta, disabled: configLoading,
                                style: { background: '#fff', color: 'var(--gray-600)', border: '1px solid #ddd', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: configLoading ? 'wait' : 'pointer' },
                            },
                                React.createElement('i', { className: 'fa-solid fa-arrow-rotate-right', style: { marginRight: 4 } }),
                                'Recharger',
                            ),
                        ),
                    ),
                    React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', marginBottom: 12 } },
                        'Édite ici le type de serre, le volume de pot et le substrat par parcelle. Sauvegarde immédiate dans Firestore (cache invalidé instantanément). Les changements sont pris en compte au prochain calcul.',
                    ),
                    configMsg && React.createElement('div', {
                        style: {
                            background: configMsg.type === 'ok' ? 'rgba(46,204,113,0.1)' : 'rgba(231,76,60,0.1)',
                            color: configMsg.type === 'ok' ? 'var(--green)' : 'var(--red)',
                            padding: '6px 10px', borderRadius: 6, fontSize: 12, marginBottom: 10,
                        },
                    },
                        React.createElement('i', { className: 'fa-solid ' + (configMsg.type === 'ok' ? 'fa-circle-check' : 'fa-circle-exclamation'), style: { marginRight: 6 } }),
                        configMsg.text,
                    ),
                    configLoading && !configMeta && React.createElement('div', { style: { padding: 16, textAlign: 'center', color: 'var(--gray-500)', fontSize: 12 } },
                        React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { marginRight: 6 } }),
                        'Chargement…',
                    ),
                    configMeta && React.createElement('div', { style: { overflowX: 'auto', maxHeight: 480, overflowY: 'auto' } },
                        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
                            React.createElement('thead', { style: { position: 'sticky', top: 0, background: '#fff', zIndex: 1 } },
                                React.createElement('tr', { style: { background: '#f8fafc' } },
                                    ['Parcelle', 'Culture', 'Variété', 'Ferme', 'Type serre', 'Pot (L)', 'Substrat', ''].map((h, i) =>
                                        React.createElement('th', { key: i, style: { padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid #eee', fontWeight: 600, color: 'var(--gray-600)', whiteSpace: 'nowrap' } }, h),
                                    ),
                                ),
                            ),
                            React.createElement('tbody', null,
                                Object.keys(configMeta).sort().map(id => {
                                    const m = configMeta[id] || {};
                                    const e = edits[id] || {};
                                    const merged = { ...m, ...e };
                                    const dirty = Object.keys(e).length > 0;
                                    const setField = (field, value) => setEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
                                    return React.createElement('tr', { key: id, style: { borderBottom: '1px solid #f3f4f6', background: dirty ? 'rgba(243,156,18,0.04)' : 'transparent' } },
                                        React.createElement('td', { style: { padding: '6px 10px', fontWeight: 700, fontFamily: 'monospace', fontSize: 11 } }, id),
                                        React.createElement('td', { style: { padding: '6px 10px', color: 'var(--gray-600)' } }, merged.culture || '—'),
                                        React.createElement('td', { style: { padding: '6px 10px', color: 'var(--gray-600)' } }, merged.variete || '—'),
                                        React.createElement('td', { style: { padding: '6px 10px', color: 'var(--gray-600)' } }, merged.ferme || '—'),
                                        React.createElement('td', { style: { padding: '6px 10px' } },
                                            React.createElement('select', {
                                                value: merged.greenhouseType || 'tunnel',
                                                onChange: ev => setField('greenhouseType', ev.target.value),
                                                style: { padding: '4px 8px', borderRadius: 4, border: '1px solid #ddd', fontSize: 12, background: '#fff' },
                                            },
                                                React.createElement('option', { value: 'tunnel' }, 'tunnel'),
                                                React.createElement('option', { value: 'canarienne' }, 'canarienne'),
                                                React.createElement('option', { value: 'open' }, 'plein champ'),
                                            ),
                                        ),
                                        React.createElement('td', { style: { padding: '6px 10px' } },
                                            React.createElement('input', {
                                                type: 'number', step: '0.5', min: 0,
                                                value: merged.potVolumeL == null ? '' : merged.potVolumeL,
                                                onChange: ev => setField('potVolumeL', ev.target.value === '' ? null : Number(ev.target.value)),
                                                placeholder: 'sol',
                                                style: { padding: '4px 8px', borderRadius: 4, border: '1px solid #ddd', fontSize: 12, width: 70 },
                                            }),
                                        ),
                                        React.createElement('td', { style: { padding: '6px 10px' } },
                                            React.createElement('input', {
                                                type: 'text',
                                                value: merged.substrate || '',
                                                onChange: ev => setField('substrate', ev.target.value),
                                                placeholder: 'coco / soil…',
                                                style: { padding: '4px 8px', borderRadius: 4, border: '1px solid #ddd', fontSize: 12, width: 160 },
                                            }),
                                        ),
                                        React.createElement('td', { style: { padding: '6px 10px' } },
                                            dirty && React.createElement('button', {
                                                onClick: () => saveOneMeta(id, merged),
                                                disabled: savingId === id,
                                                style: { background: 'var(--berry)', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: savingId === id ? 'wait' : 'pointer' },
                                            },
                                                savingId === id ? React.createElement('i', { className: 'fa-solid fa-spinner fa-spin' }) : 'Sauver',
                                            ),
                                        ),
                                    );
                                }),
                            ),
                        ),
                    ),
                ),

                // ===== Filter bar =====
                React.createElement('div', { style: { ...panelBase, padding: 12, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' } },
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                        React.createElement('label', { style: { fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 } }, 'Parcelle'),
                        React.createElement('select', {
                            value: parcelle,
                            onChange: e => setParcelle(e.target.value),
                            style: { padding: 8, borderRadius: 8, border: '1px solid #ddd', fontSize: 13, background: '#fff', minWidth: 220 },
                        },
                            React.createElement('option', { value: '' }, 'Toutes les parcelles'),
                            parcelleOptions.map(o => React.createElement('option', { key: o.value, value: o.value }, o.label)),
                        ),
                    ),
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                        React.createElement('label', { style: { fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 } }, 'Période'),
                        React.createElement('div', { className: 'chip-group', style: { gap: 6 } },
                            [7, 14, 30].map(d => React.createElement('button', {
                                key: d,
                                className: 'chip c-berry ' + (periodDays === d ? 'active' : ''),
                                onClick: () => setPeriodDays(d),
                                style: { padding: '6px 14px', fontSize: 12 },
                            }, d + 'j')),
                        ),
                    ),
                    React.createElement('div', { style: { marginLeft: 'auto', fontSize: 11, color: 'var(--gray-400)' } },
                        dateFrom + ' → ' + dateTo,
                    ),
                ),

                // ===== Weather strip (today's forecast) =====
                data && data.weatherToday && (() => {
                    const w = data.weatherToday;
                    const heat = Number.isFinite(w.tmax) && w.tmax >= 32;
                    const dry = Number.isFinite(w.humidity) && w.humidity <= 30;
                    const rain = Number.isFinite(w.precip) && w.precip >= 5;
                    const highEto = Number.isFinite(w.eto) && w.eto >= 5;
                    const chip = (active, color, icon, label) => React.createElement('span', {
                        style: {
                            fontSize: 11, padding: '4px 10px', borderRadius: 14,
                            background: active ? color : '#f5f5f5',
                            color: active ? '#fff' : 'var(--gray-600)',
                            fontWeight: active ? 700 : 500,
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                        },
                    },
                        React.createElement('i', { className: 'fa-solid ' + icon }),
                        label,
                    );
                    return React.createElement('div', { style: { ...panelBase, padding: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                        React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', marginRight: 4 } },
                            React.createElement('i', { className: 'fa-solid fa-cloud-sun', style: { marginRight: 4 } }),
                            'Météo aujourd\'hui',
                        ),
                        Number.isFinite(w.tmax) && chip(heat, 'var(--red)', 'fa-temperature-high', w.tmax.toFixed(0) + '°/' + (Number.isFinite(w.tmin) ? w.tmin.toFixed(0) : '—') + '°'),
                        Number.isFinite(w.eto) && chip(highEto, 'var(--orange)', 'fa-sun', 'ETo ' + w.eto.toFixed(1) + ' mm'),
                        Number.isFinite(w.humidity) && chip(dry, '#7c3aed', 'fa-droplet', 'HR ' + Math.round(w.humidity) + '%'),
                        Number.isFinite(w.precip) && chip(rain, 'var(--blue)', 'fa-cloud-rain', 'Pluie ' + w.precip.toFixed(1) + ' mm'),
                        Number.isFinite(w.outdoorRadSumSoFarJPerCm2) && chip(
                            w.outdoorRadSumSoFarJPerCm2 < 800,
                            'var(--orange)', 'fa-sun',
                            'Rad. ' + Math.round(w.outdoorRadSumSoFarJPerCm2) + (Number.isFinite(w.outdoorDailyRadJPerCm2) ? ' / ' + Math.round(w.outdoorDailyRadJPerCm2) : '') + ' J/cm²',
                        ),
                    );
                })(),

                // ===== Live "Pilotage temps réel" — only when a specific parcelle is selected =====
                parcelle && liveRad && (() => {
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const todaySummary = data && Array.isArray(data.summaries)
                        ? data.summaries.find(s => s.parcelle === parcelle && s.date === todayStr)
                        : null;
                    const target = Number.isFinite(liveRad.radTargetJPerCm2) ? liveRad.radTargetJPerCm2 : null;
                    const acc = Number.isFinite(liveRad.radSumSinceLastPulseNow) ? liveRad.radSumSinceLastPulseNow : null;
                    const pct = (target && acc != null) ? Math.min(100, Math.max(0, (acc / target) * 100)) : 0;

                    // Drainage & EC trend signals from today's pulses
                    const pulses = (todaySummary && Array.isArray(todaySummary.pulses)) ? todaySummary.pulses : [];
                    const drainVals = pulses.map(p => p.drainPct).filter(v => Number.isFinite(v));
                    const avgDrain = drainVals.length ? drainVals.reduce((s, v) => s + v, 0) / drainVals.length : null;
                    const lastDrain = drainVals.length ? drainVals[drainVals.length - 1] : null;
                    const ecDrainVals = pulses.map(p => p.ecDrain).filter(v => Number.isFinite(v));
                    const ecPtsVals = pulses.map(p => p.ecPts).filter(v => Number.isFinite(v));
                    const lastEcDrain = ecDrainVals.length ? ecDrainVals[ecDrainVals.length - 1] : null;
                    const lastEcDelta = (pulses.length && Number.isFinite(pulses[pulses.length - 1].ecDelta))
                        ? pulses[pulses.length - 1].ecDelta : null;

                    const drainSignal = avgDrain == null
                        ? { color: 'var(--gray-500)', icon: 'fa-circle-question', text: 'Pas encore de drainage mesuré aujourd\'hui' }
                        : avgDrain < 10
                        ? { color: 'var(--orange)', icon: 'fa-arrow-trend-down', text: `Drainage faible (moy ${avgDrain.toFixed(0)}%) — penser à augmenter la dose` }
                        : avgDrain > 30
                        ? { color: '#d97706', icon: 'fa-arrow-trend-up', text: `Drainage élevé (moy ${avgDrain.toFixed(0)}%) — réduire la dose ou attendre` }
                        : { color: 'var(--green)', icon: 'fa-circle-check', text: `Drainage OK (moy ${avgDrain.toFixed(0)}%)` };

                    const ecSignal = lastEcDelta == null
                        ? { color: 'var(--gray-500)', icon: 'fa-circle-question', text: 'EC non mesurée' }
                        : lastEcDelta > 0.5
                        ? { color: '#7c3aed', icon: 'fa-arrow-trend-up', text: `EC drain ↑ (Δ ${lastEcDelta.toFixed(2)}) — accumulation saline, surveiller` }
                        : lastEcDelta < -0.3
                        ? { color: 'var(--blue)', icon: 'fa-arrow-trend-down', text: `EC drain ↓ (Δ ${lastEcDelta.toFixed(2)}) — lessivage en cours` }
                        : { color: 'var(--green)', icon: 'fa-circle-check', text: `EC stable (Δ ${lastEcDelta.toFixed(2)})` };

                    // Mini cumulative-radiation curve with "now" + "ETA" markers
                    const cumul = todaySummary && Array.isArray(todaySummary.hourlyRadSumCumulative)
                        ? todaySummary.hourlyRadSumCumulative : null;
                    const now = new Date();
                    const nowMin = now.getHours() * 60 + now.getMinutes();
                    const etaMin = Number.isFinite(liveRad.radEtaMin) ? Math.max(0, liveRad.radEtaMin) : null;
                    const etaAbsMin = etaMin != null ? Math.min(24 * 60 - 1, nowMin + etaMin) : null;

                    const renderMini = () => {
                        if (!cumul) return null;
                        const W = 600, H = 110, pad = { top: 12, right: 16, bottom: 22, left: 36 };
                        const cw = W - pad.left - pad.right;
                        const ch = H - pad.top - pad.bottom;
                        const maxV = Math.max(1, ...cumul.map(v => v || 0));
                        const xAt = h => pad.left + (h / 23) * cw;
                        const yAt = v => pad.top + ch - ((v || 0) / maxV) * ch;
                        const path = cumul.map((v, h) => `${h === 0 ? 'M' : 'L'} ${xAt(h)} ${yAt(v)}`).join(' ');
                        const nowX = pad.left + (nowMin / (24 * 60)) * cw;
                        const etaX = etaAbsMin != null ? pad.left + (etaAbsMin / (24 * 60)) * cw : null;
                        const valueAtNow = cumul[Math.min(23, Math.floor(nowMin / 60))] || 0;
                        return React.createElement('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' },
                            // axis
                            React.createElement('line', { x1: pad.left, y1: pad.top + ch, x2: W - pad.right, y2: pad.top + ch, stroke: '#e5e7eb' }),
                            // hours labels (every 3h)
                            [0, 3, 6, 9, 12, 15, 18, 21].map(h => React.createElement('text', { key: 'h' + h, x: xAt(h), y: H - 6, fontSize: 9, fill: '#9ca3af', textAnchor: 'middle' }, String(h).padStart(2, '0') + 'h')),
                            // y axis label (max value)
                            React.createElement('text', { x: pad.left - 4, y: pad.top + 4, fontSize: 9, fill: '#9ca3af', textAnchor: 'end' }, Math.round(maxV)),
                            React.createElement('text', { x: pad.left - 4, y: pad.top + ch + 3, fontSize: 9, fill: '#9ca3af', textAnchor: 'end' }, '0'),
                            // area under curve
                            React.createElement('path', { d: path + ` L ${xAt(23)} ${pad.top + ch} L ${xAt(0)} ${pad.top + ch} Z`, fill: 'var(--orange)', opacity: 0.12 }),
                            React.createElement('path', { d: path, fill: 'none', stroke: 'var(--orange)', strokeWidth: 2 }),
                            // "now" vertical marker
                            React.createElement('line', { x1: nowX, y1: pad.top, x2: nowX, y2: pad.top + ch, stroke: 'var(--berry)', strokeWidth: 1.5, strokeDasharray: '3 3' }),
                            React.createElement('circle', { cx: nowX, cy: yAt(valueAtNow), r: 4, fill: 'var(--berry)' }),
                            React.createElement('text', { x: nowX, y: pad.top - 2, fontSize: 10, fill: 'var(--berry)', textAnchor: 'middle', fontWeight: 700 }, 'maintenant'),
                            // "ETA" marker
                            etaX != null && React.createElement('line', { x1: etaX, y1: pad.top, x2: etaX, y2: pad.top + ch, stroke: 'var(--green)', strokeWidth: 1.5, strokeDasharray: '4 2' }),
                            etaX != null && React.createElement('text', { x: etaX, y: pad.top - 2, fontSize: 10, fill: 'var(--green)', textAnchor: 'middle', fontWeight: 700 }, 'ETA ' + (liveRad.radEtaTime || '')),
                        );
                    };

                    const etaLabel = etaMin === 0
                        ? { text: 'Maintenant', color: 'var(--red)' }
                        : Number.isFinite(etaMin) && liveRad.radEtaTime
                        ? { text: liveRad.radEtaTime + '  (dans ' + (etaMin >= 60 ? Math.floor(etaMin / 60) + 'h' + String(etaMin % 60).padStart(2, '0') : etaMin + ' min') + ')', color: 'var(--green)' }
                        : { text: '—', color: 'var(--gray-400)' };

                    return React.createElement('div', { style: { ...panelBase, padding: 14, background: 'linear-gradient(135deg, #fff7ed 0%, #fff 80%)', borderColor: 'rgba(243,156,18,0.25)' } },
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontWeight: 700, color: 'var(--berry)' } },
                            React.createElement('i', { className: 'fa-solid fa-bolt', style: { color: 'var(--orange)' } }),
                            'Pilotage temps réel — prochain pulse',
                            React.createElement('span', { style: { fontSize: 10, color: 'var(--gray-400)', fontWeight: 500, marginLeft: 'auto' } }, 'rafraîchi toutes les 60s'),
                        ),
                        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 10 } },
                            // RadSum progress
                            React.createElement('div', null,
                                React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', fontWeight: 600, marginBottom: 4 } }, 'RadSum depuis dernier pulse'),
                                React.createElement('div', { style: { fontSize: 18, fontWeight: 800 } },
                                    (acc != null ? Math.round(acc) : '—'),
                                    target != null && React.createElement('span', { style: { fontSize: 12, color: 'var(--gray-500)', fontWeight: 500 } }, ' / ' + Math.round(target) + ' J/cm²'),
                                ),
                                target != null && React.createElement('div', { style: { marginTop: 6, height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' } },
                                    React.createElement('div', { style: { width: pct + '%', height: '100%', background: pct >= 100 ? 'var(--red)' : 'var(--orange)', transition: 'width 0.6s' } }),
                                ),
                            ),
                            // ETA
                            React.createElement('div', null,
                                React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', fontWeight: 600, marginBottom: 4 } }, 'Prochain pulse estimé'),
                                React.createElement('div', { style: { fontSize: 18, fontWeight: 800, color: etaLabel.color } }, etaLabel.text),
                                liveRad.lastPulseHeure && React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', marginTop: 4 } },
                                    'Dernier pulse à ', React.createElement('strong', null, liveRad.lastPulseHeure),
                                ),
                            ),
                            // Drain signal
                            React.createElement('div', null,
                                React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', fontWeight: 600, marginBottom: 4 } }, 'Drainage'),
                                React.createElement('div', { style: { fontSize: 12, color: drainSignal.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 } },
                                    React.createElement('i', { className: 'fa-solid ' + drainSignal.icon }),
                                    drainSignal.text,
                                ),
                                lastDrain != null && React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', marginTop: 2 } },
                                    'Dernier pulse : ' + lastDrain.toFixed(0) + '%',
                                ),
                            ),
                            // EC signal
                            React.createElement('div', null,
                                React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', fontWeight: 600, marginBottom: 4 } }, 'EC'),
                                React.createElement('div', { style: { fontSize: 12, color: ecSignal.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 } },
                                    React.createElement('i', { className: 'fa-solid ' + ecSignal.icon }),
                                    ecSignal.text,
                                ),
                                lastEcDrain != null && React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', marginTop: 2 } },
                                    'EC drain dernier : ' + lastEcDrain.toFixed(2),
                                ),
                            ),
                        ),
                        // Mini chart
                        cumul && React.createElement('div', { style: { marginTop: 8, padding: 8, background: '#fff', borderRadius: 8, border: '1px solid #f3f4f6' } },
                            React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', fontWeight: 600, marginBottom: 2 } }, 'RadSum cumulée aujourd\'hui (J/cm²) — capteur FarmRoad'),
                            renderMini(),
                        ),
                        React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-400)', marginTop: 8, fontStyle: 'italic' } },
                            'L\'ETA est calculée à partir de la radiation prévue (cible RadSum par culture). Drainage et EC sont affichés à titre indicatif — ajuster manuellement la dose si nécessaire.',
                        ),
                    );
                })(),

                // ===== Loading / error / empty states =====
                loading && React.createElement('div', { style: { ...panelBase, textAlign: 'center', padding: 32, color: 'var(--gray-500)' } },
                    React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 24, marginBottom: 8 } }),
                    React.createElement('div', null, 'Calcul des indicateurs…'),
                ),
                error && !loading && React.createElement('div', { style: { ...panelBase, color: 'var(--red)', background: 'rgba(231,76,60,0.05)', borderColor: 'rgba(231,76,60,0.2)' } },
                    React.createElement('i', { className: 'fa-solid fa-circle-exclamation', style: { marginRight: 8 } }),
                    'Erreur : ', error,
                ),
                !loading && !error && data && (!data.summaries || data.summaries.length === 0) && React.createElement('div', { style: { ...panelBase, textAlign: 'center', padding: 40, color: 'var(--gray-400)' } },
                    React.createElement('i', { className: 'fa-solid fa-droplet', style: { fontSize: 40, marginBottom: 12, opacity: 0.4 } }),
                    React.createElement('div', { style: { fontWeight: 600, color: 'var(--gray-500)' } }, 'Aucune lecture sur la période'),
                    React.createElement('div', { style: { fontSize: 12, marginTop: 4 } }, 'Saisissez ou scannez des fiches dans Saisie / Scanner.'),
                ),

                // ===== Main content =====
                !loading && !error && data && data.summaries && data.summaries.length > 0 && React.createElement('div', null,

                    // ----- Summary day chips (today injected even when empty) -----
                    React.createElement('div', { style: { ...panelBase, padding: 12 } },
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
                            React.createElement('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--gray-500)' } }, 'Sélectionner un jour'),
                            React.createElement('button', {
                                onClick: () => {
                                    // Trigger refresh by re-running the fetch (period change forces useEffect)
                                    setLoading(true);
                                    setData(null);
                                    setTimeout(() => setPeriodDays(periodDays), 0);
                                },
                                style: { background: 'transparent', border: '1px solid #ddd', borderRadius: 6, padding: '3px 10px', fontSize: 11, color: 'var(--gray-600)', cursor: 'pointer' },
                            },
                                React.createElement('i', { className: 'fa-solid fa-arrow-rotate-right', style: { marginRight: 4 } }),
                                'Rafraîchir',
                            ),
                        ),
                        React.createElement('div', { className: 'chip-group', style: { gap: 6, flexWrap: 'wrap' } },
                            (() => {
                                const today = new Date().toISOString().slice(0, 10);
                                const summariesByParcelleAsc = (parcelle ? [parcelle] : Array.from(new Set(data.summaries.map(s => s.parcelle))));
                                // Build a chronological set including today even if no data
                                const allChips = [];
                                // For each parcelle currently in scope, ensure today appears
                                summariesByParcelleAsc.forEach(p => {
                                    const hasToday = data.summaries.some(s => s.parcelle === p && s.date === today);
                                    if (!hasToday) {
                                        allChips.push({ virtual: true, parcelle: p, date: today, parcelleLabel: (parcelleOptions.find(o => o.value === p) || {}).label || p });
                                    }
                                });
                                data.summaries.forEach(s => allChips.push(s));
                                // Sort by date desc
                                allChips.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
                                return allChips.map(s => {
                                    const k = s.parcelle + '__' + s.date;
                                    const isToday = s.date === today;
                                    const ds = s.virtual
                                        ? { color: 'var(--gray-400)', bg: '#f8fafc', label: 'En attente', icon: 'fa-circle-dot' }
                                        : diagnosisStyle(s.diagnosis);
                                    const active = k === selectedKey;
                                    return React.createElement('button', {
                                        key: k,
                                        className: 'chip ' + (active ? 'active' : ''),
                                        onClick: () => setSelectedKey(k),
                                        style: {
                                            padding: '6px 12px', fontSize: 12,
                                            borderColor: active ? ds.color : '#ddd',
                                            background: active ? ds.color : '#fff',
                                            color: active ? '#fff' : ds.color,
                                            fontWeight: active ? 700 : 500,
                                            position: 'relative',
                                        },
                                    },
                                        isToday && React.createElement('span', {
                                            style: { display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#dc2626', marginRight: 5, animation: 'pulse 1.5s infinite' },
                                            title: 'Aujourd\'hui',
                                        }),
                                        React.createElement('i', { className: 'fa-solid ' + ds.icon, style: { marginRight: 4, fontSize: 10 } }),
                                        isToday ? 'AUJ.' : s.date.slice(5), ' · ',
                                        (s.parcelleLabel || s.parcelle || '').replace(/^[A-Z0-9-]+/, '').trim() || s.parcelle,
                                    );
                                });
                            })(),
                        ),
                    ),

                    selectedSummary && React.createElement('div', null,

                        // ----- Synthesis banner -----
                        (() => {
                            const s = selectedSummary;
                            const ds = diagnosisStyle(s.diagnosis);
                            return React.createElement('div', {
                                style: {
                                    ...panelBase, padding: 16,
                                    background: ds.bg,
                                    borderColor: ds.color + '33',
                                },
                            },
                                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 } },
                                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
                                        React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 } }, 'Date'),
                                        React.createElement('div', { style: { fontSize: 18, fontWeight: 700 } }, s.date),
                                    ),
                                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
                                        React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 } }, 'Parcelle'),
                                        React.createElement('div', { style: { fontSize: 14, fontWeight: 600 } }, s.parcelleLabel || s.parcelle),
                                    ),
                                    React.createElement('div', { style: {
                                        marginLeft: 'auto',
                                        padding: '6px 14px',
                                        borderRadius: 12,
                                        background: ds.color,
                                        color: '#fff',
                                        fontWeight: 700,
                                        fontSize: 13,
                                        display: 'flex', alignItems: 'center', gap: 6,
                                    } },
                                        React.createElement('i', { className: 'fa-solid ' + ds.icon }),
                                        ds.label,
                                    ),
                                ),
                                // KPI grid
                                React.createElement('div', {
                                    style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 },
                                },
                                    (() => {
                                        const radSoFar = s.radSumSoFarJPerCm2;
                                        const radDay = s.dailyRadJPerCm2;
                                        const radPct = (radSoFar != null && radDay > 0) ? Math.min(100, (radSoFar / radDay) * 100) : null;
                                        const cards = [
                                            { label: 'Volume apporté', value: fmtVol(s.totalInputMl), icon: 'fa-droplet', color: 'var(--blue)' },
                                            { label: 'Volume drainé', value: fmtVol(s.totalDrainMl), icon: 'fa-arrow-down', color: '#7c3aed' },
                                            { label: '% Drainage', value: fmtPct(s.totalDrainPct), icon: 'fa-percent', color: ds.color },
                                            { label: 'Pulses', value: fmtNum(s.pulseCount), icon: 'fa-repeat', color: 'var(--berry)' },
                                            { label: 'EC apport', value: fmtEc(s.avgEcPts), icon: 'fa-bolt', color: 'var(--blue)' },
                                            { label: 'EC drain', value: fmtEc(s.avgEcDrain), icon: 'fa-bolt', color: 'var(--orange)' },
                                            { label: 'pH apport', value: fmtPh(s.avgPhPts), icon: 'fa-flask', color: 'var(--green)' },
                                            { label: 'Fin irrig.', value: s.irrigationCutoffTime || '—', icon: 'fa-clock', color: 'var(--gray-500)' },
                                        ];
                                        if (radSoFar != null && radDay != null) {
                                            cards.push({
                                                label: 'RadSum jour',
                                                value: Math.round(radSoFar) + ' / ' + Math.round(radDay) + ' J/cm²',
                                                icon: 'fa-sun',
                                                color: 'var(--orange)',
                                                progress: radPct,
                                            });
                                        }
                                        return cards.map((k, i) => React.createElement('div', {
                                            key: i,
                                            style: { background: '#fff', border: '1px solid #eee', borderRadius: 8, padding: 10 },
                                        },
                                            React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 } },
                                                React.createElement('i', { className: 'fa-solid ' + k.icon, style: { marginRight: 4, color: k.color } }),
                                                k.label,
                                            ),
                                            React.createElement('div', { style: { fontSize: 17, fontWeight: 700, color: 'var(--dark)' } }, k.value),
                                            k.progress != null && React.createElement('div', {
                                                style: { marginTop: 6, height: 4, background: '#f1f5f9', borderRadius: 2, overflow: 'hidden' },
                                            },
                                                React.createElement('div', {
                                                    style: { width: k.progress + '%', height: '100%', background: k.color, transition: 'width 0.3s' },
                                                }),
                                            ),
                                        ));
                                    })(),
                                ),
                            );
                        })(),

                        // ----- Diagnostic cards -----
                        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 } },
                            (() => {
                                const s = selectedSummary;
                                const cards = [];
                                // Over-drain — promotes severity if intra-day trend is rising
                                const trend = s.drainTrend;
                                const trendRising = trend && trend.slopePctPerHour >= 1.5 && trend.endPct >= 30;
                                const overSeverity = s.totalDrainPct != null && s.totalDrainPct > 35
                                    ? 'critical'
                                    : (s.totalDrainPct != null && s.totalDrainPct > 30) || s.highDrainPulseCount >= 2 || trendRising
                                    ? 'warning' : 'ok';
                                let overDetail;
                                if (s.totalDrainPct == null) {
                                    overDetail = 'Aucun drainage mesuré.';
                                } else if (overSeverity === 'critical') {
                                    overDetail = 'Drainage > 35% — gaspillage majeur.';
                                } else if (trendRising) {
                                    const fromTime = trend.firstHighDrainTime ? ' à partir de ' + trend.firstHighDrainTime : '';
                                    overDetail = 'Drainage en hausse' + fromTime + ' : ' + trend.startPct.toFixed(0) + '% → ' + trend.endPct.toFixed(0) + '% (+' + trend.slopePctPerHour.toFixed(1) + ' pp/h).';
                                } else if (overSeverity === 'warning') {
                                    overDetail = s.highDrainPulseCount + ' pulse(s) > 30%.';
                                } else if (trend && Math.abs(trend.slopePctPerHour) < 0.5) {
                                    overDetail = 'Aucun excès détecté, drainage stable.';
                                } else {
                                    overDetail = 'Aucun excès détecté.';
                                }
                                cards.push({
                                    title: 'Surdrainage',
                                    severity: overSeverity,
                                    detail: overDetail,
                                    metric: trendRising ? '↗ ' + fmtPct(s.totalDrainPct) : fmtPct(s.totalDrainPct),
                                });
                                // Under-drain
                                const underSev = s.totalDrainPct != null && s.totalDrainPct < 15
                                    ? 'warning'
                                    : s.lowDrainPulseCount >= 2 ? 'warning' : 'ok';
                                cards.push({
                                    title: 'Drainage insuffisant',
                                    severity: underSev,
                                    detail: s.lowDrainPulseCount > 0
                                        ? `${s.lowDrainPulseCount} pulse(s) < 15%.`
                                        : 'Drainage suffisant pour le lessivage.',
                                    metric: s.lowDrainPulseCount + ' pulse(s)',
                                });
                                // Salt accumulation
                                const ecDelta = (Number.isFinite(s.avgEcDrain) && Number.isFinite(s.avgEcPts))
                                    ? s.avgEcDrain - s.avgEcPts : null;
                                const saltSev = ecDelta != null && ecDelta > 0.4 && s.totalDrainPct != null && s.totalDrainPct < 25
                                    ? 'warning' : 'ok';
                                cards.push({
                                    title: 'Accumulation saline',
                                    severity: saltSev,
                                    detail: ecDelta == null
                                        ? 'Données EC incomplètes.'
                                        : saltSev === 'warning'
                                        ? `ΔEC ${ecDelta.toFixed(2)} avec drainage ${fmtPct(s.totalDrainPct)}.`
                                        : `ΔEC contenu (${ecDelta.toFixed(2)}).`,
                                    metric: ecDelta == null ? '—' : 'Δ ' + ecDelta.toFixed(2),
                                });
                                // Late-day behaviour
                                const lateHigh = (s.pulses || []).filter(p => p.isLateDayPulse && p.isHighDrain);
                                const lateAny = (s.pulses || []).filter(p => p.isLateDayPulse);
                                const lateSev = lateHigh.length > 0 ? 'warning' : 'ok';
                                cards.push({
                                    title: 'Fin de journée',
                                    severity: lateSev,
                                    detail: lateHigh.length > 0
                                        ? `${lateHigh.length} pulse(s) tardif(s) avec drainage élevé.`
                                        : lateAny.length > 0
                                        ? `${lateAny.length} pulse(s) après 15h, drainage maîtrisé.`
                                        : 'Pas d\'irrigation après 15h.',
                                    metric: s.irrigationCutoffTime || '—',
                                });
                                return cards.map((c, i) => {
                                    const ls = levelStyle(c.severity);
                                    return React.createElement('div', {
                                        key: i,
                                        style: {
                                            background: ls.bg,
                                            border: '1px solid ' + ls.color + '33',
                                            borderRadius: 12, padding: 14,
                                            display: 'flex', flexDirection: 'column', gap: 6,
                                        },
                                    },
                                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                                            React.createElement('i', { className: 'fa-solid ' + ls.icon, style: { color: ls.color, fontSize: 16 } }),
                                            React.createElement('div', { style: { fontSize: 13, fontWeight: 700, color: 'var(--dark)' } }, c.title),
                                            React.createElement('div', { style: { marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: ls.color } }, c.metric),
                                        ),
                                        React.createElement('div', { style: { fontSize: 12, color: 'var(--gray-600)', lineHeight: 1.4 } }, c.detail),
                                    );
                                });
                            })(),
                        ),

                        // ----- Pulses table -----
                        React.createElement('div', { style: { ...panelBase, padding: 12 } },
                            React.createElement('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--berry)' } },
                                React.createElement('i', { className: 'fa-solid fa-list', style: { marginRight: 6 } }),
                                'Détail des pulses (' + selectedSummary.pulses.length + ')',
                            ),
                            selectedSummary.pulses.length === 0
                                ? React.createElement('div', { style: { color: 'var(--gray-400)', fontSize: 12, padding: 16 } }, 'Aucun pulse.')
                                : React.createElement('div', { style: { overflowX: 'auto' } },
                                    React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
                                        React.createElement('thead', null,
                                            React.createElement('tr', { style: { background: '#fafafa', textAlign: 'left' } },
                                                ['Heure', 'EC apport', 'pH apport', 'Vol apport', 'EC drain', 'pH drain', 'Vol drain', '% Drain', 'Δ EC', 'Cumul In', 'Cumul Drain', 'RadSum (J/cm²)', 'Statut']
                                                    .map((h, i) => React.createElement('th', { key: i, style: { padding: '6px 8px', borderBottom: '1px solid #eee', fontWeight: 600, color: 'var(--gray-500)', whiteSpace: 'nowrap' } }, h)),
                                            ),
                                        ),
                                        React.createElement('tbody', null,
                                            selectedSummary.pulses.map((p, i) => {
                                                const badges = pulseBadges(p);
                                                return React.createElement('tr', { key: i, style: { borderBottom: '1px solid #f3f4f6' } },
                                                    React.createElement('td', { style: { padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' } }, p.heure || '—'),
                                                    React.createElement('td', { style: { padding: '6px 8px' } }, fmtEc(p.ecPts)),
                                                    React.createElement('td', { style: { padding: '6px 8px' } }, fmtPh(p.phPts)),
                                                    React.createElement('td', { style: { padding: '6px 8px' } }, fmtVol(p.volumePtsMl)),
                                                    React.createElement('td', { style: { padding: '6px 8px' } }, fmtEc(p.ecDrain)),
                                                    React.createElement('td', { style: { padding: '6px 8px' } }, fmtPh(p.phDrain)),
                                                    React.createElement('td', { style: { padding: '6px 8px' } }, fmtVol(p.volumeDrainMl)),
                                                    React.createElement('td', { style: { padding: '6px 8px', fontWeight: 700,
                                                        color: p.drainPct == null ? 'var(--gray-400)' : p.isHighDrain ? 'var(--orange)' : p.isLowDrain ? '#d97706' : 'var(--green)',
                                                    } }, fmtPct(p.drainPct)),
                                                    React.createElement('td', { style: { padding: '6px 8px',
                                                        color: p.ecDelta != null && p.ecDelta > 0.4 ? '#7c3aed' : 'var(--gray-600)',
                                                        fontWeight: p.ecDelta != null && p.ecDelta > 0.4 ? 700 : 400,
                                                    } }, p.ecDelta == null ? '—' : (p.ecDelta > 0 ? '+' : '') + p.ecDelta.toFixed(2)),
                                                    React.createElement('td', { style: { padding: '6px 8px', color: 'var(--gray-500)' } }, fmtVol(p.cumulativeInputMl)),
                                                    React.createElement('td', { style: { padding: '6px 8px', color: 'var(--gray-500)' } }, fmtVol(p.cumulativeDrainMl)),
                                                    React.createElement('td', { style: { padding: '6px 8px', color: p.radSumSincePreviousPulse == null ? 'var(--gray-400)' : 'var(--gray-700)', fontWeight: p.radSumSincePreviousPulse != null ? 600 : 400 } },
                                                        p.radSumSincePreviousPulse == null ? '—' : Math.round(p.radSumSincePreviousPulse),
                                                    ),
                                                    React.createElement('td', { style: { padding: '6px 8px' } },
                                                        React.createElement('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                                                            badges.map((b, j) => React.createElement('span', {
                                                                key: j,
                                                                style: { fontSize: 10, padding: '2px 6px', borderRadius: 6, background: b.bg, color: b.color, fontWeight: 600, whiteSpace: 'nowrap' },
                                                            }, b.text)),
                                                        ),
                                                    ),
                                                );
                                            }),
                                        ),
                                    ),
                                ),
                        ),

                        // ----- F2 — Mini-courbe : Radiation cumulée vs Pulses par heure -----
                        Array.isArray(selectedSummary.hourlyRadSumCumulative) && React.createElement('div', { style: { ...panelBase, padding: 12 } },
                            React.createElement('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--berry)' } },
                                React.createElement('i', { className: 'fa-solid fa-sun', style: { marginRight: 6, color: 'var(--orange)' } }),
                                'Radiation et apport d’eau par pulse',
                            ),
                            React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', marginBottom: 10 } },
                                'À gauche : RadSum cumulée par heure (contexte journalier). ',
                                'À droite : RadSum accumulé entre chaque pulse (ligne) et volume d’eau apporté à chaque pulse (barres) — pour vérifier qu’on déclenche les pulses au bon palier de radiation.',
                            ),
                            (() => {
                                const cumul = selectedSummary.hourlyRadSumCumulative;
                                // Group pulses per hour
                                const pulsesPerHour = new Array(24).fill(0);
                                (selectedSummary.pulses || []).forEach(p => {
                                    if (Number.isFinite(p.minutesFromMidnight)) {
                                        const h = Math.floor(p.minutesFromMidnight / 60);
                                        if (h >= 0 && h < 24) pulsesPerHour[h]++;
                                    }
                                });
                                // Build dataset for charts: hours 5..21 only (skip empty night)
                                const data = [];
                                for (let h = 5; h <= 21; h++) {
                                    data.push({
                                        h: String(h).padStart(2, '0') + 'h',
                                        radCumul: Math.round(cumul[h] || 0),
                                        nbPulses: pulsesPerHour[h],
                                    });
                                }
                                return React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 } },
                                    React.createElement('div', null,
                                        React.createElement('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4 } },
                                            React.createElement('span', { style: { display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: 'var(--orange)', marginRight: 4 } }),
                                            'RadSum cumulée (J/cm²)',
                                        ),
                                        React.createElement(SimpleAreaChart, {
                                            data, dataKeys: ['radCumul'], colors: ['var(--orange)'],
                                            xKey: 'h', height: 160,
                                        }),
                                    ),
                                    (() => {
                                        const comboData = (selectedSummary.pulses || []).map((p, i) => ({
                                            x: p.heure || ('P' + (i + 1)),
                                            radSum: Math.round(p.radSumSincePreviousPulse || 0),
                                            vol: Math.round(p.volumePtsMl || 0),
                                        }));
                                        return React.createElement('div', null,
                                            React.createElement('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4, display: 'flex', gap: 12, flexWrap: 'wrap' } },
                                                React.createElement('span', null,
                                                    React.createElement('span', { style: { display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: 'var(--orange)', marginRight: 4 } }),
                                                    'RadSum depuis pulse précédent (J/cm²)',
                                                ),
                                                React.createElement('span', null,
                                                    React.createElement('span', { style: { display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#3498db', marginRight: 4 } }),
                                                    'Vol apport (mL)',
                                                ),
                                            ),
                                            comboData.length
                                                ? React.createElement(SimpleComboChart, {
                                                    data: comboData,
                                                    xKey: 'x',
                                                    lineKey: 'radSum',
                                                    barKey: 'vol',
                                                    lineColor: 'var(--orange)',
                                                    barColor: '#3498db',
                                                    height: 200,
                                                    lineMode: 'sawtooth',
                                                })
                                                : React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', padding: '20px 0', textAlign: 'center' } }, 'Aucun pulse pour cette journée'),
                                        );
                                    })(),
                                );
                            })(),
                        ),

                        // ----- Historique des conseils donnés au stationnaire (timeline) -----
                        selectedTrail.length > 0 && React.createElement('div', { style: { ...panelBase, padding: 12 } },
                            React.createElement('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--berry)' } },
                                React.createElement('i', { className: 'fa-solid fa-comments', style: { marginRight: 6 } }),
                                'Historique des conseils stationnaire (', selectedTrail.length, ')',
                            ),
                            React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', marginBottom: 10 } },
                                'Ce qui a été conseillé au stationnaire pulse par pulse, en ordre chronologique.',
                            ),
                            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' } },
                                selectedTrail.map((t, i) => {
                                    const sty = t.advice && t.advice.status === 'critical' ? { color: 'var(--red)', bg: 'rgba(231,76,60,0.06)', emoji: '🛑' }
                                              : t.advice && t.advice.status === 'warning' ? { color: 'var(--orange)', bg: 'rgba(243,156,18,0.06)', emoji: '⚠' }
                                              : t.advice && t.advice.status === 'info' ? { color: 'var(--blue)', bg: 'rgba(52,152,219,0.06)', emoji: 'ℹ' }
                                              : { color: 'var(--green)', bg: 'rgba(46,204,113,0.06)', emoji: '✓' };
                                    return React.createElement('div', {
                                        key: i,
                                        style: {
                                            background: sty.bg,
                                            borderLeft: '3px solid ' + sty.color,
                                            borderRadius: 6,
                                            padding: '8px 10px',
                                            display: 'grid',
                                            gridTemplateColumns: '60px 1fr',
                                            gap: 10,
                                            alignItems: 'flex-start',
                                            fontSize: 12,
                                        },
                                    },
                                        React.createElement('div', { style: { fontWeight: 700, fontSize: 13, color: 'var(--gray-700)' } },
                                            t.heure || '—',
                                            t.drainPct != null && React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-500)', fontWeight: 500 } },
                                                'drain ' + t.drainPct.toFixed(0) + '%',
                                            ),
                                            t.radSum != null && React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-500)', fontWeight: 500 } },
                                                t.radSum.toFixed(0) + ' J/cm²',
                                            ),
                                        ),
                                        React.createElement('div', null,
                                            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 } },
                                                React.createElement('span', { style: { fontSize: 14 } }, sty.emoji),
                                                React.createElement('span', { style: { fontWeight: 700, color: sty.color } }, t.advice && t.advice.headline),
                                            ),
                                            t.advice && t.advice.actionLabel && React.createElement('div', { style: { color: 'var(--gray-700)', fontSize: 12 } },
                                                React.createElement('i', { className: 'fa-solid fa-arrow-right', style: { color: sty.color, marginRight: 6 } }),
                                                t.advice.actionLabel,
                                            ),
                                            t.advice && t.advice.whenLabel && React.createElement('div', { style: { color: sty.color, fontSize: 11, fontWeight: 600, marginTop: 2 } },
                                                React.createElement('i', { className: 'fa-solid fa-clock', style: { marginRight: 4 } }),
                                                t.advice.whenLabel,
                                            ),
                                        ),
                                    );
                                }),
                            ),
                        ),

                        // ----- Empty-state when virtual today (no pulse yet) -----
                        selectedSummary.virtual && React.createElement('div', { style: { ...panelBase, padding: 24, textAlign: 'center', color: 'var(--gray-500)' } },
                            React.createElement('i', { className: 'fa-solid fa-hourglass-half', style: { fontSize: 28, marginBottom: 10, opacity: 0.5 } }),
                            React.createElement('div', { style: { fontWeight: 600 } }, 'En attente du premier pulse aujourd\'hui'),
                            React.createElement('div', { style: { fontSize: 12, marginTop: 4 } }, 'Dès qu\'un stationnaire enregistre une lecture, elle apparaîtra ici en temps réel.'),
                        ),

                        // ----- Recommendations panel (daily + radiation merged, sorted by severity) -----
                        (() => {
                            const order = { critical: 0, warning: 1, info: 2, ok: 3 };
                            const merged = [...selectedRecos, ...selectedRadRecos]
                                .slice()
                                .sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
                            return React.createElement('div', { style: { ...panelBase } },
                            React.createElement('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--berry)' } },
                                React.createElement('i', { className: 'fa-solid fa-lightbulb', style: { marginRight: 6 } }),
                                'Recommandations (' + merged.length + ')',
                            ),
                            merged.length === 0
                                ? React.createElement('div', { style: { color: 'var(--gray-400)', fontSize: 12, padding: 8 } }, 'Aucune recommandation.')
                                : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                                    merged.map((r, i) => {
                                        const ls = levelStyle(r.level);
                                        return React.createElement('div', {
                                            key: i,
                                            style: {
                                                background: ls.bg,
                                                border: '1px solid ' + ls.color + '33',
                                                borderLeft: '4px solid ' + ls.color,
                                                borderRadius: 10,
                                                padding: 12,
                                            },
                                        },
                                            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                                                React.createElement('i', { className: 'fa-solid ' + ls.icon, style: { color: ls.color, fontSize: 14 } }),
                                                React.createElement('div', { style: { fontSize: 13, fontWeight: 700, color: 'var(--dark)' } }, r.title),
                                                React.createElement('span', {
                                                    style: { marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 6, background: ls.color, color: '#fff', fontWeight: 700, textTransform: 'uppercase' },
                                                }, r.level),
                                            ),
                                            r.message && React.createElement('div', { style: { fontSize: 12, color: 'var(--gray-700)', marginBottom: 4 } }, r.message),
                                            r.rationale && React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', fontStyle: 'italic', marginBottom: 6 } }, r.rationale),
                                            r.suggestedAction && React.createElement('div', {
                                                style: { fontSize: 12, fontWeight: 600, color: ls.color, paddingTop: 6, borderTop: '1px dashed ' + ls.color + '33' },
                                            },
                                                React.createElement('i', { className: 'fa-solid fa-arrow-right', style: { marginRight: 6 } }),
                                                r.suggestedAction,
                                            ),
                                        );
                                    }),
                                ),
                        );
                        })(),

                        // ----- Weather-conditioned recommendations (forward-looking) -----
                        (() => {
                            const wRecos = (data.weatherRecommendationsByParcelle && data.weatherRecommendationsByParcelle[selectedSummary.parcelle]) || [];
                            if (wRecos.length === 0) return null;
                            return React.createElement('div', { style: { ...panelBase } },
                                React.createElement('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--berry)' } },
                                    React.createElement('i', { className: 'fa-solid fa-cloud-bolt', style: { marginRight: 6 } }),
                                    'Conseils météo — actions du jour (', wRecos.length, ')',
                                ),
                                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                                    wRecos.map((r, i) => {
                                        const ls = levelStyle(r.level);
                                        return React.createElement('div', {
                                            key: i,
                                            style: {
                                                background: ls.bg,
                                                border: '1px solid ' + ls.color + '33',
                                                borderLeft: '4px solid ' + ls.color,
                                                borderRadius: 10,
                                                padding: 12,
                                            },
                                        },
                                            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                                                React.createElement('i', { className: 'fa-solid ' + ls.icon, style: { color: ls.color, fontSize: 14 } }),
                                                React.createElement('div', { style: { fontSize: 13, fontWeight: 700, color: 'var(--dark)' } }, r.title),
                                                React.createElement('span', {
                                                    style: { marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 6, background: ls.color, color: '#fff', fontWeight: 700, textTransform: 'uppercase' },
                                                }, r.level),
                                            ),
                                            r.message && React.createElement('div', { style: { fontSize: 12, color: 'var(--gray-700)', marginBottom: 4 } }, r.message),
                                            r.rationale && React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', fontStyle: 'italic', marginBottom: 6 } }, r.rationale),
                                            r.suggestedAction && React.createElement('div', {
                                                style: { fontSize: 12, fontWeight: 600, color: ls.color, paddingTop: 6, borderTop: '1px dashed ' + ls.color + '33' },
                                            },
                                                React.createElement('i', { className: 'fa-solid fa-arrow-right', style: { marginRight: 6 } }),
                                                r.suggestedAction,
                                            ),
                                        );
                                    }),
                                ),
                            );
                        })(),

                        // ----- Period trends panel (cross-day signals for the selected parcelle) -----
                        (() => {
                            const trends = data.periodTrendsByParcelle && data.periodTrendsByParcelle[selectedSummary.parcelle];
                            const periodRecos = (data.periodRecommendationsByParcelle && data.periodRecommendationsByParcelle[selectedSummary.parcelle]) || [];
                            if (!trends) return null;
                            const ecSev = trends.ecDrainDrift != null && trends.ecDrainDrift >= 0.4 ? 'warning' : 'ok';
                            const streakSev = (trends.overDrainStreak.length >= 3 || trends.underDrainStreak.length >= 3) ? 'warning' : 'ok';
                            const stabilitySev = trends.drainStddev != null && trends.drainStddev >= 10 ? 'info' : 'ok';
                            const drainTrendSev = trends.drainPctDrift != null && Math.abs(trends.drainPctDrift) >= 5 ? 'info' : 'ok';
                            const isOverLonger = trends.overDrainStreak.length >= trends.underDrainStreak.length;
                            const streakLen = isOverLonger ? trends.overDrainStreak.length : trends.underDrainStreak.length;
                            const streakLbl = streakLen === 0 ? 'Aucune' : (isOverLonger ? 'Surdrainage' : 'Sous-drainage');
                            const stabilityLbl = trends.drainStddev == null ? '—'
                                : trends.drainStddev < 5 ? 'Très stable'
                                : trends.drainStddev < 10 ? 'Stable'
                                : trends.drainStddev < 15 ? 'Variable' : 'Instable';
                            const kpiCard = (sev, icon, label, value, sub) => {
                                const sty = levelStyle(sev);
                                return React.createElement('div', { style: { background: sty.bg, border: '1px solid ' + sty.color + '33', borderRadius: 10, padding: 12 } },
                                    React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 } },
                                        React.createElement('i', { className: 'fa-solid ' + icon, style: { marginRight: 4, color: sty.color } }),
                                        label,
                                    ),
                                    React.createElement('div', { style: { fontSize: 18, fontWeight: 700, color: sev === 'ok' ? 'var(--dark)' : sty.color } }, value),
                                    sub != null && React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-500)', marginTop: 2 } }, sub),
                                );
                            };
                            return React.createElement('div', { style: { ...panelBase } },
                                React.createElement('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--berry)' } },
                                    React.createElement('i', { className: 'fa-solid fa-chart-line', style: { marginRight: 6 } }),
                                    'Tendances période — ', trends.days, ' jours',
                                    React.createElement('span', { style: { marginLeft: 8, fontSize: 11, color: 'var(--gray-400)', fontWeight: 400 } },
                                        trends.dateFrom, ' → ', trends.dateTo,
                                    ),
                                ),
                                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: periodRecos.length > 0 ? 14 : 0 } },
                                    kpiCard(
                                        ecSev, 'fa-bolt', 'Dérive EC drain',
                                        trends.ecDrainDrift == null ? '—' : (trends.ecDrainDrift > 0 ? '+' : '') + trends.ecDrainDrift.toFixed(2),
                                        'mS/cm sur ' + trends.spanDays + ' j',
                                    ),
                                    kpiCard(
                                        drainTrendSev, 'fa-arrow-trend-up', 'Dérive % drainage',
                                        trends.drainPctDrift == null ? '—' : (trends.drainPctDrift > 0 ? '+' : '') + trends.drainPctDrift.toFixed(1) + ' pp',
                                        'sur ' + trends.spanDays + ' j',
                                    ),
                                    kpiCard(
                                        streakSev, 'fa-link', 'Plus longue série',
                                        streakLen + ' j',
                                        streakLbl,
                                    ),
                                    kpiCard(
                                        stabilitySev, 'fa-wave-square', 'Stabilité drainage',
                                        trends.drainStddev == null ? '—' : 'σ ' + trends.drainStddev.toFixed(1),
                                        stabilityLbl,
                                    ),
                                ),
                                periodRecos.length > 0 && React.createElement('div', null,
                                    React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', marginBottom: 6 } },
                                        'Recommandations période (', periodRecos.length, ')',
                                    ),
                                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                                        periodRecos.map((r, i) => {
                                            const ls = levelStyle(r.level);
                                            return React.createElement('div', {
                                                key: i,
                                                style: {
                                                    background: ls.bg,
                                                    border: '1px solid ' + ls.color + '33',
                                                    borderLeft: '4px solid ' + ls.color,
                                                    borderRadius: 10,
                                                    padding: 12,
                                                },
                                            },
                                                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                                                    React.createElement('i', { className: 'fa-solid ' + ls.icon, style: { color: ls.color, fontSize: 14 } }),
                                                    React.createElement('div', { style: { fontSize: 13, fontWeight: 700, color: 'var(--dark)' } }, r.title),
                                                    React.createElement('span', {
                                                        style: { marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 6, background: ls.color, color: '#fff', fontWeight: 700, textTransform: 'uppercase' },
                                                    }, r.level),
                                                ),
                                                r.message && React.createElement('div', { style: { fontSize: 12, color: 'var(--gray-700)', marginBottom: 4 } }, r.message),
                                                r.rationale && React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', fontStyle: 'italic', marginBottom: 6 } }, r.rationale),
                                                r.suggestedAction && React.createElement('div', {
                                                    style: { fontSize: 12, fontWeight: 600, color: ls.color, paddingTop: 6, borderTop: '1px dashed ' + ls.color + '33' },
                                                },
                                                    React.createElement('i', { className: 'fa-solid fa-arrow-right', style: { marginRight: 6 } }),
                                                    r.suggestedAction,
                                                ),
                                            );
                                        }),
                                    ),
                                ),
                            );
                        })(),
                    ),

                    // ----- Comparison view (across parcelles for the period) -----
                    !parcelle && Array.isArray(data.comparison) && data.comparison.length > 1 && React.createElement('div', { style: { ...panelBase } },
                        React.createElement('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--berry)' } },
                            React.createElement('i', { className: 'fa-solid fa-table-cells', style: { marginRight: 6 } }),
                            'Comparaison parcelles (', periodDays, 'j)',
                        ),
                        React.createElement('div', { style: { overflowX: 'auto' } },
                            React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
                                React.createElement('thead', null,
                                    React.createElement('tr', { style: { background: '#fafafa' } },
                                        ['Parcelle', 'Jours', 'Drain. moyen', 'Vol apporté', 'Vol drainé', 'Pulses', '% Pulses à risque', 'Stabilité EC (σ)', 'Stabilité pH (σ)']
                                            .map((h, i) => React.createElement('th', { key: i, style: { padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #eee', color: 'var(--gray-500)', fontWeight: 600, whiteSpace: 'nowrap' } }, h)),
                                    ),
                                ),
                                React.createElement('tbody', null,
                                    data.comparison.slice().sort((a, b) => (b.problemRatio || 0) - (a.problemRatio || 0)).map((c, i) => {
                                        const drainColor = c.avgDrainPct == null
                                            ? 'var(--gray-400)'
                                            : c.avgDrainPct > 30 ? 'var(--orange)'
                                            : c.avgDrainPct < 15 ? '#d97706' : 'var(--green)';
                                        const probColor = !c.problemRatio
                                            ? 'var(--green)'
                                            : c.problemRatio > 0.4 ? 'var(--red)'
                                            : c.problemRatio > 0.2 ? 'var(--orange)' : 'var(--green)';
                                        return React.createElement('tr', { key: i, style: { borderBottom: '1px solid #f3f4f6' } },
                                            React.createElement('td', { style: { padding: '6px 8px', fontWeight: 600 } }, c.parcelleLabel || c.parcelle),
                                            React.createElement('td', { style: { padding: '6px 8px' } }, c.days),
                                            React.createElement('td', { style: { padding: '6px 8px', fontWeight: 700, color: drainColor } }, fmtPct(c.avgDrainPct)),
                                            React.createElement('td', { style: { padding: '6px 8px' } }, fmtVol(c.totalInputMl)),
                                            React.createElement('td', { style: { padding: '6px 8px' } }, fmtVol(c.totalDrainMl)),
                                            React.createElement('td', { style: { padding: '6px 8px' } }, c.pulseCount),
                                            React.createElement('td', { style: { padding: '6px 8px', fontWeight: 700, color: probColor } },
                                                c.problemRatio == null ? '—' : (c.problemRatio * 100).toFixed(0) + '%',
                                            ),
                                            React.createElement('td', { style: { padding: '6px 8px', color: 'var(--gray-600)' } }, c.ecStability == null ? '—' : c.ecStability.toFixed(2)),
                                            React.createElement('td', { style: { padding: '6px 8px', color: 'var(--gray-600)' } }, c.phStability == null ? '—' : c.phStability.toFixed(2)),
                                        );
                                    }),
                                ),
                            ),
                        ),
                    ),
                ),
            );
        }

export { IrrigationIntelligenceTab };
