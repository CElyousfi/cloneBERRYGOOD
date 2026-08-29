/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: technique | Déclaration(s): StationnaireIrrigationTab */
import { PARCELLES_CULTURALES } from '../agronomie/PARCELLES_CULTURALES.jsx';
import { getCycle } from '../agronomie/getCycle.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== STATIONNAIRE IRRIGATION TABS =====================

        function StationnaireIrrigationTab({ farmFilter, currentProfile }) {
            const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
            const [parcelle, setParcelle] = useState('');
            const [heure, setHeure] = useState(new Date().toTimeString().slice(0, 5));
            const [duree, setDuree] = useState('10');
            const [stations, setStations] = useState([
                { point: { ec: '', ph: '', volume: '' }, drainage: { ec: '', ph: '', volume: '' } },
                { point: { ec: '', ph: '', volume: '' }, drainage: { ec: '', ph: '', volume: '' } },
                { point: { ec: '', ph: '', volume: '' }, drainage: { ec: '', ph: '', volume: '' } },
                { point: { ec: '', ph: '', volume: '' }, drainage: { ec: '', ph: '', volume: '' } },
            ]);
            const [saving, setSaving] = useState(false);
            const [savedMsg, setSavedMsg] = useState('');
            const [todayReadings, setTodayReadings] = useState([]);
            const [loading, setLoading] = useState(true);
            const [nextAdvice, setNextAdvice] = useState(null);
            const [adviceLoading, setAdviceLoading] = useState(false);
            // F3 — live RadSum since last pulse (polled every 60s while parcelle selected)
            const [liveRad, setLiveRad] = useState(null);

            const currentCycle = getCycle(new Date().toISOString());
            const parcelleOptions = React.useMemo(() => {
                return PARCELLES_CULTURALES
                    .filter(pc => pc.ferme === farmFilter && (pc.culture === 'Avocatier' || pc.cycle === currentCycle) && pc.enProduction !== false)
                    .map(pc => ({
                        value: pc.id,
                        label: pc.secteurs.join('/') + ' ' + pc.variete + (pc.sousVariete ? ' ' + pc.sousVariete : ''),
                    }));
            }, [farmFilter, currentCycle]);

            // F3 — fetch live RadSum since last pulse, no auth gating issues since /api/* auto-injects token
            const fetchLiveRad = React.useCallback(async (parc) => {
                if (!parc || !farmFilter) { setLiveRad(null); return; }
                try {
                    const r = await fetch('/api/stock?action=irrigation-intelligence-next-pulse&ferme=' + encodeURIComponent(farmFilter) + '&parcelle=' + encodeURIComponent(parc));
                    const j = await r.json();
                    if (j.success) {
                        setLiveRad({
                            radSumSinceLastPulseNow: j.radSumSinceLastPulseNow,
                            radTargetJPerCm2: j.radTargetJPerCm2,
                            radEtaMin: j.radEtaMin,
                            radEtaTime: j.radEtaTime,
                            lastPulseHeure: j.lastPulseHeure,
                        });
                    }
                } catch (e) { /* silent */ }
            }, [farmFilter]);

            useEffect(() => {
                if (!parcelle) { setLiveRad(null); return; }
                fetchLiveRad(parcelle);
                const id = setInterval(() => fetchLiveRad(parcelle), 60_000);
                return () => clearInterval(id);
            }, [parcelle, fetchLiveRad]);

            const fetchNextPulseAdvice = React.useCallback(async (savedParcelle, savedDate) => {
                if (!savedParcelle || !farmFilter) return;
                setAdviceLoading(true);
                try {
                    const params = new URLSearchParams({
                        action: 'irrigation-intelligence-next-pulse',
                        ferme: farmFilter,
                        parcelle: savedParcelle,
                        date: savedDate,
                    });
                    const r = await fetch('/api/stock?' + params.toString());
                    const j = await r.json();
                    if (j.success) {
                        setNextAdvice({
                            ...j,
                            parcelleLabel: (parcelleOptions.find(o => o.value === savedParcelle) || {}).label || savedParcelle,
                        });
                    }
                } catch (e) { console.warn('next-pulse advice failed:', e.message); }
                setAdviceLoading(false);
            }, [farmFilter, parcelleOptions]);

            const loadTodayReadings = React.useCallback(async () => {
                try {
                    const snap = await firebase.firestore().collection('irrigation_readings')
                        .where('ferme', '==', farmFilter)
                        .where('date', '==', date)
                        .orderBy('createdAt', 'desc')
                        .get();
                    setTodayReadings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                } catch (e) { console.error('Erreur chargement lectures:', e); }
                setLoading(false);
            }, [farmFilter, date]);

            useEffect(() => { setLoading(true); loadTodayReadings(); }, [loadTodayReadings]);

            const updateStation = (idx, type, field, val) => {
                setStations(prev => prev.map((s, i) => i === idx ? { ...s, [type]: { ...s[type], [field]: val } } : s));
            };

            const handleSave = async () => {
                if (!parcelle) return alert('Veuillez sélectionner une parcelle');
                if (!heure) return alert('Veuillez saisir l\'heure d\'irrigation');
                setSaving(true);
                try {
                    const opt = parcelleOptions.find(o => o.value === parcelle);
                    const doc = {
                        date,
                        ferme: farmFilter,
                        parcelle,
                        parcelleLabel: opt ? opt.label : parcelle,
                        heure,
                        duree: Number(duree) || 0,
                        points: stations.map((s, i) => ({
                            label: 'Point ' + (i + 1),
                            ec: Number(s.point.ec) || 0,
                            ph: Number(s.point.ph) || 0,
                            volume: Number(s.point.volume) || 0,
                        })),
                        drainage: stations.map((s, i) => ({
                            label: 'Drainage ' + (i + 1),
                            ec: Number(s.drainage.ec) || 0,
                            ph: Number(s.drainage.ph) || 0,
                            volume: Number(s.drainage.volume) || 0,
                        })),
                        createdBy: currentProfile,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    };
                    await firebase.firestore().collection('irrigation_readings').add(doc);
                    setSavedMsg('Enregistré avec succès !');
                    const savedParcelle = parcelle;
                    const savedDate = date;
                    setParcelle('');
                    setHeure(new Date().toTimeString().slice(0, 5));
                    setDuree('10');
                    setStations([
                        { point: { ec: '', ph: '', volume: '' }, drainage: { ec: '', ph: '', volume: '' } },
                        { point: { ec: '', ph: '', volume: '' }, drainage: { ec: '', ph: '', volume: '' } },
                        { point: { ec: '', ph: '', volume: '' }, drainage: { ec: '', ph: '', volume: '' } },
                        { point: { ec: '', ph: '', volume: '' }, drainage: { ec: '', ph: '', volume: '' } },
                    ]);
                    loadTodayReadings();
                    fetchNextPulseAdvice(savedParcelle, savedDate);
                    setTimeout(() => setSavedMsg(''), 3000);
                } catch (e) {
                    alert('Erreur lors de la sauvegarde: ' + e.message);
                }
                setSaving(false);
            };

            const handleDelete = async (id) => {
                if (!confirm('Supprimer cette lecture ?')) return;
                try {
                    await firebase.firestore().collection('irrigation_readings').doc(id).delete();
                    loadTodayReadings();
                } catch (e) { alert('Erreur: ' + e.message); }
            };

            // Color/icon mapping for the post-save advice banner
            const adviceStyle = (status) => {
                if (status === 'critical') return { color: 'var(--red)', bg: 'rgba(231,76,60,0.10)', border: 'var(--red)', icon: 'fa-circle-exclamation', emoji: '🛑' };
                if (status === 'warning') return { color: 'var(--orange)', bg: 'rgba(243,156,18,0.10)', border: 'var(--orange)', icon: 'fa-triangle-exclamation', emoji: '⚠' };
                if (status === 'info') return { color: 'var(--blue)', bg: 'rgba(52,152,219,0.10)', border: 'var(--blue)', icon: 'fa-circle-info', emoji: 'ℹ' };
                return { color: 'var(--green)', bg: 'rgba(46,204,113,0.10)', border: 'var(--green)', icon: 'fa-circle-check', emoji: '✓' };
            };

            return React.createElement('div', { style: { padding: '16px', maxWidth: 600, margin: '0 auto' } },
                React.createElement('h2', { style: { fontSize: '1.2rem', marginBottom: 16, color: 'var(--berry)' } },
                    React.createElement('i', { className: 'fa-solid fa-faucet-drip', style: { marginRight: 8 } }),
                    'Saisie Irrigation — ', farmFilter
                ),

                // ===== Post-save advice banner (operator-facing) =====
                nextAdvice && (() => {
                    const sty = adviceStyle(nextAdvice.status);
                    const k = nextAdvice.todayKpis;
                    return React.createElement('div', {
                        style: {
                            background: sty.bg,
                            border: '1px solid ' + sty.border + '55',
                            borderLeft: '5px solid ' + sty.border,
                            borderRadius: 12,
                            padding: 14,
                            marginBottom: 16,
                        },
                    },
                        // Header line: status emoji + headline + dismiss
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 } },
                            React.createElement('span', { style: { fontSize: 20 } }, sty.emoji),
                            React.createElement('div', { style: { fontSize: 16, fontWeight: 700, color: sty.color, flex: 1 } }, nextAdvice.headline),
                            React.createElement('button', {
                                onClick: () => setNextAdvice(null),
                                style: { background: 'transparent', border: 'none', color: 'var(--gray-400)', cursor: 'pointer', fontSize: 14, padding: 4 },
                                'aria-label': 'Fermer',
                            }, React.createElement('i', { className: 'fa-solid fa-xmark' })),
                        ),
                        // Parcelle + KPIs strip
                        React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-600)', marginBottom: 10 } },
                            nextAdvice.parcelleLabel,
                            k && [
                                ' · ', k.pulseCount, ' pulse(s)',
                                ' · ', Math.round(k.cumulInputMl || 0), ' mL apporté',
                                ' · ', Math.round(k.cumulDrainMl || 0), ' mL drainé',
                                k.drainPct != null ? ' · ' + k.drainPct.toFixed(0) + ' %' : '',
                            ],
                        ),
                        // Action line — what to do
                        React.createElement('div', {
                            style: {
                                background: '#fff',
                                borderRadius: 10,
                                padding: '10px 12px',
                                marginBottom: 8,
                                display: 'flex', alignItems: 'flex-start', gap: 10,
                            },
                        },
                            React.createElement('i', { className: 'fa-solid fa-arrow-right', style: { color: sty.color, marginTop: 3, fontSize: 14 } }),
                            React.createElement('div', { style: { flex: 1 } },
                                React.createElement('div', { style: { fontWeight: 700, fontSize: 14, color: 'var(--dark)', marginBottom: 2 } }, nextAdvice.nextAction.label),
                                nextAdvice.nextAction.detail && React.createElement('div', { style: { fontSize: 12, color: 'var(--gray-600)' } }, nextAdvice.nextAction.detail),
                            ),
                        ),
                        // Timing line
                        nextAdvice.whenNext && nextAdvice.whenNext.label && React.createElement('div', {
                            style: { fontSize: 12, color: sty.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 },
                        },
                            React.createElement('i', { className: 'fa-solid fa-clock' }),
                            nextAdvice.whenNext.label,
                        ),
                        // Disclaimer — test feature, operator judgment prevails
                        React.createElement('div', {
                            style: {
                                marginTop: 10,
                                paddingTop: 8,
                                borderTop: '1px dashed ' + sty.border + '44',
                                fontSize: 10.5,
                                color: 'var(--gray-500)',
                                lineHeight: 1.4,
                                fontStyle: 'italic',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 6,
                            },
                        },
                            React.createElement('i', { className: 'fa-solid fa-flask', style: { marginTop: 2, color: 'var(--gray-400)' } }),
                            React.createElement('span', null,
                                React.createElement('strong', null, 'Fonction de prédiction en test — peut se tromper.'),
                                ' Vérifie toujours le terrain (substrat, plantes, météo réelle). Ton jugement de stationnaire prime sur cette suggestion.',
                            ),
                        ),
                    );
                })(),

                adviceLoading && !nextAdvice && React.createElement('div', {
                    style: { fontSize: 12, color: 'var(--gray-400)', marginBottom: 12, textAlign: 'center' },
                },
                    React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { marginRight: 6 } }),
                    'Analyse du pulse…',
                ),

                // Date + Heure + Durée
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 } },
                    React.createElement('div', { className: 'form-group' },
                        React.createElement('label', null, 'Date'),
                        React.createElement('input', { type: 'date', value: date, onChange: e => setDate(e.target.value), style: { width: '100%', padding: 8, borderRadius: 8, border: '1px solid #ddd', fontSize: 16 } })
                    ),
                    React.createElement('div', { className: 'form-group' },
                        React.createElement('label', null, 'Heure'),
                        React.createElement('input', { type: 'time', value: heure, onChange: e => setHeure(e.target.value), style: { width: '100%', padding: 8, borderRadius: 8, border: '1px solid #ddd', fontSize: 16 } })
                    ),
                    React.createElement('div', { className: 'form-group' },
                        React.createElement('label', null, 'Durée (min)'),
                        React.createElement('input', { type: 'number', inputMode: 'numeric', value: duree, onChange: e => setDuree(e.target.value), placeholder: '45', min: 0, style: { width: '100%', padding: 8, borderRadius: 8, border: '1px solid #ddd', fontSize: 16 } })
                    )
                ),

                // Parcelle
                React.createElement('div', { className: 'form-group', style: { marginBottom: 16 } },
                    React.createElement('label', null, 'Parcelle'),
                    React.createElement('select', { value: parcelle, onChange: e => setParcelle(e.target.value), style: { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 16, background: '#fff' } },
                        React.createElement('option', { value: '' }, '— Sélectionner —'),
                        parcelleOptions.map(o => React.createElement('option', { key: o.value, value: o.value }, o.label))
                    )
                ),

                // F3 — Live RadSum widget (visible quand parcelle sélectionnée)
                parcelle && liveRad && Number.isFinite(liveRad.radSumSinceLastPulseNow) && (() => {
                    const acc = liveRad.radSumSinceLastPulseNow;
                    const target = liveRad.radTargetJPerCm2 || 130;
                    const pct = Math.min(100, (acc / target) * 100);
                    const ready = acc >= target * 0.9;  // >=90% du target → quasi prêt
                    const lateMargin = acc > target * 1.5;  // >150% → retard significatif
                    const color = lateMargin ? 'var(--red)' : ready ? 'var(--green)' : 'var(--orange)';
                    return React.createElement('div', {
                        style: {
                            background: 'rgba(243,156,18,0.06)',
                            border: '1px solid rgba(243,156,18,0.25)',
                            borderRadius: 10,
                            padding: 12,
                            marginBottom: 16,
                        },
                    },
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12, color: 'var(--gray-600)' } },
                            React.createElement('i', { className: 'fa-solid fa-sun', style: { color: 'var(--orange)' } }),
                            React.createElement('span', null,
                                'Depuis ', liveRad.lastPulseHeure ? 'le pulse de ' + liveRad.lastPulseHeure : 'le lever du soleil',
                                ' :',
                            ),
                        ),
                        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 } },
                            React.createElement('span', { style: { fontSize: 22, fontWeight: 700, color } }, Math.round(acc) + ' J/cm²'),
                            React.createElement('span', { style: { fontSize: 12, color: 'var(--gray-500)' } }, 'cible ' + Math.round(target) + ' J/cm²'),
                            liveRad.radEtaMin != null && liveRad.radEtaMin > 0 && React.createElement('span', { style: { fontSize: 12, color: 'var(--gray-500)', marginLeft: 'auto' } },
                                React.createElement('i', { className: 'fa-solid fa-clock', style: { marginRight: 4 } }),
                                'encore ~', liveRad.radEtaMin, ' min',
                                liveRad.radEtaTime ? ' (' + liveRad.radEtaTime + ')' : '',
                            ),
                            ready && (liveRad.radEtaMin === 0 || liveRad.radEtaMin == null) && React.createElement('span', { style: { fontSize: 12, color: 'var(--green)', fontWeight: 700, marginLeft: 'auto' } },
                                React.createElement('i', { className: 'fa-solid fa-circle-check', style: { marginRight: 4 } }),
                                'cible atteinte',
                            ),
                        ),
                        // progress bar
                        React.createElement('div', { style: { height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' } },
                            React.createElement('div', { style: { width: pct + '%', height: '100%', background: color, transition: 'width 0.3s' } }),
                        ),
                        React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-400)', marginTop: 6, fontStyle: 'italic' } },
                            'Indicateur live (refresh 60 s) — repère agronomique, pas une consigne.',
                        ),
                    );
                })(),

                // Stations : Point + Drainage groupés (format papier)
                stations.map((st, i) => React.createElement('div', { key: i, className: 'irrigation-point-card', style: { marginBottom: 12 } },
                    React.createElement('h4', { style: { marginBottom: 10, fontSize: '0.95rem', borderBottom: '1px solid #eee', paddingBottom: 6 } }, 'Point ', i + 1),
                    // Point row
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 } },
                        React.createElement('div', { className: 'form-group' },
                            React.createElement('label', null, 'EC (mS/cm)'),
                            React.createElement('input', { type: 'number', inputMode: 'decimal', step: '0.1', value: st.point.ec, onChange: e => updateStation(i, 'point', 'ec', e.target.value), placeholder: '0.0', style: { width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ddd', fontSize: 16 } })
                        ),
                        React.createElement('div', { className: 'form-group' },
                            React.createElement('label', null, 'pH'),
                            React.createElement('input', { type: 'number', inputMode: 'decimal', step: '0.1', value: st.point.ph, onChange: e => updateStation(i, 'point', 'ph', e.target.value), placeholder: '0.0', style: { width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ddd', fontSize: 16 } })
                        ),
                        React.createElement('div', { className: 'form-group' },
                            React.createElement('label', null, 'Vol (mL)'),
                            React.createElement('input', { type: 'number', inputMode: 'decimal', step: '0.5', value: st.point.volume, onChange: e => updateStation(i, 'point', 'volume', e.target.value), placeholder: '0.0', style: { width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ddd', fontSize: 16 } })
                        )
                    ),
                    // Drainage row
                    React.createElement('div', { style: { borderLeft: '3px solid var(--blue)', paddingLeft: 8 } },
                        React.createElement('div', { style: { fontSize: '0.75rem', color: 'var(--blue)', fontWeight: 600, marginBottom: 4 } }, 'Drainage'),
                        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 } },
                            React.createElement('div', { className: 'form-group' },
                                React.createElement('label', null, 'EC'),
                                React.createElement('input', { type: 'number', inputMode: 'decimal', step: '0.1', value: st.drainage.ec, onChange: e => updateStation(i, 'drainage', 'ec', e.target.value), placeholder: '0.0', style: { width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ddd', fontSize: 16 } })
                            ),
                            React.createElement('div', { className: 'form-group' },
                                React.createElement('label', null, 'pH'),
                                React.createElement('input', { type: 'number', inputMode: 'decimal', step: '0.1', value: st.drainage.ph, onChange: e => updateStation(i, 'drainage', 'ph', e.target.value), placeholder: '0.0', style: { width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ddd', fontSize: 16 } })
                            ),
                            React.createElement('div', { className: 'form-group' },
                                React.createElement('label', null, 'V (mL)'),
                                React.createElement('input', { type: 'number', inputMode: 'decimal', step: '0.5', value: st.drainage.volume, onChange: e => updateStation(i, 'drainage', 'volume', e.target.value), placeholder: '0', style: { width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ddd', fontSize: 16 } })
                            )
                        )
                    )
                )),

                // Save button
                React.createElement('div', { style: { marginTop: 20, display: 'flex', gap: 12, alignItems: 'center' } },
                    React.createElement('button', {
                        className: 'btn-primary',
                        onClick: handleSave,
                        disabled: saving,
                        style: { padding: '12px 32px', fontSize: '1rem', borderRadius: 10, flex: 1 }
                    }, saving ? 'Enregistrement...' : 'Enregistrer'),
                    savedMsg && React.createElement('span', { className: 'irrigation-saved-badge' }, savedMsg)
                ),

                // Today's readings
                React.createElement('div', { className: 'irrigation-today-summary', style: { marginTop: 24 } },
                    React.createElement('h3', { style: { fontSize: '1rem', marginBottom: 10, color: 'var(--berry)' } },
                        React.createElement('i', { className: 'fa-solid fa-clock-rotate-left', style: { marginRight: 6 } }),
                        'Lectures du jour (', todayReadings.length, ')'
                    ),
                    loading ? React.createElement('p', null, 'Chargement...') :
                    todayReadings.length === 0 ? React.createElement('p', { style: { color: '#999' } }, 'Aucune lecture pour cette date') :
                    todayReadings.map(r => React.createElement('div', { key: r.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#fff', borderRadius: 8, marginBottom: 6, border: '1px solid #eee' } },
                        React.createElement('div', null,
                            React.createElement('strong', null, r.heure), ' — ', r.parcelleLabel || r.parcelle,
                            React.createElement('div', { style: { fontSize: '0.8rem', color: '#888' } },
                                'EC moy: ', r.points && r.points.length > 0 ? (r.points.reduce((s, p) => s + (p.ec || 0), 0) / r.points.length).toFixed(1) : '-',
                                ' | pH moy: ', r.points && r.points.length > 0 ? (r.points.reduce((s, p) => s + (p.ph || 0), 0) / r.points.length).toFixed(1) : '-',
                                ' | Durée: ', r.duree || 0, 'min'
                            )
                        ),
                        React.createElement('button', {
                            onClick: () => handleDelete(r.id),
                            style: { background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: '1rem', padding: 4 },
                            title: 'Supprimer'
                        }, React.createElement('i', { className: 'fa-solid fa-trash' }))
                    ))
                )
            );
        }

export { StationnaireIrrigationTab };
