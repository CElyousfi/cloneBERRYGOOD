/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: technique | Déclaration(s): StationnaireHistoriqueTab */
import { PARCELLES_CULTURALES } from '../agronomie/PARCELLES_CULTURALES.jsx';
import { getCycle } from '../agronomie/getCycle.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { DrainageCurve } from './DrainageCurve.jsx';
import { meteoFermes } from './meteoFermes.jsx';

function StationnaireHistoriqueTab({ farmFilter, currentProfile, userProfile }) {
            const isDT = currentProfile === 'dt';
            const [selectedFarm, setSelectedFarm] = useState(farmFilter || 'F1');
            const activeFarm = isDT ? selectedFarm : farmFilter;
            const [readings, setReadings] = useState([]);
            const [loading, setLoading] = useState(true);
            const [filterDate, setFilterDate] = useState(new Date().toISOString().slice(0, 10));
            const [filterParcelle, setFilterParcelle] = useState('');
            const [selectedReading, setSelectedReading] = useState(null);
            const [editMode, setEditMode] = useState(false);
            const [editData, setEditData] = useState(null);
            const [saving, setSaving] = useState(false);
            // Calcul sunrise/sunset client-side (NOAA simplifié) : déterministe, pas d'appel API
            const sunTimes = React.useMemo(() => {
                var ferme = meteoFermes[activeFarm];
                if (!ferme || !filterDate) return { sunriseMin: null, sunsetMin: null };
                var parts = filterDate.split('-');
                var dateUTC = new Date(Date.UTC(parseInt(parts[0],10), parseInt(parts[1],10) - 1, parseInt(parts[2],10)));
                var startOfYear = Date.UTC(dateUTC.getUTCFullYear(), 0, 0);
                var dayOfYear = (dateUTC - startOfYear) / 86400000;
                var rad = Math.PI / 180;
                var solarDecl = 23.45 * rad * Math.sin(2 * Math.PI / 365 * (dayOfYear - 81));
                var latR = ferme.lat * rad;
                var cosH = -Math.tan(latR) * Math.tan(solarDecl);
                if (cosH > 1 || cosH < -1) return { sunriseMin: null, sunsetMin: null };
                var hourAngle = Math.acos(cosH) / rad; // degrés
                var solarNoonUTC = 12 - ferme.lon / 15; // h UTC
                var sunriseUTC = solarNoonUTC - hourAngle / 15;
                var sunsetUTC = solarNoonUTC + hourAngle / 15;
                var tzOffset = 1; // Africa/Casablanca = UTC+1 (Maroc, pas de DST depuis 2018)
                var srLocal = sunriseUTC + tzOffset;
                var ssLocal = sunsetUTC + tzOffset;
                return {
                    sunriseMin: Math.round(srLocal * 60),
                    sunsetMin: Math.round(ssLocal * 60)
                };
            }, [activeFarm, filterDate]);
            const todayStr = new Date().toISOString().slice(0, 10);

            const currentCycle = getCycle(new Date().toISOString());
            // BAHIA n'a pas d'entrée dans PARCELLES_CULTURALES : ses parcelles
            // sont découvertes dynamiquement par le cron Netafim et persistées
            // dans netafim_parcelles_bahia. On les charge à la volée quand on
            // bascule sur BAHIA.
            const [bahiaParcelles, setBahiaParcelles] = useState([]);
            useEffect(() => {
                if (activeFarm !== 'BAHIA') return;
                firebase.firestore().collection('netafim_parcelles_bahia')
                    .get()
                    .then(snap => setBahiaParcelles(snap.docs.map(d => d.data())))
                    .catch(e => console.error('Erreur chargement parcelles BAHIA:', e));
            }, [activeFarm]);
            const parcelleOptions = React.useMemo(() => {
                if (activeFarm === 'BAHIA') {
                    return bahiaParcelles
                        .slice()
                        .sort((a, b) => (a.label || a.id || '').localeCompare(b.label || b.id || ''))
                        .map(p => ({ value: p.id, label: p.label || p.id }));
                }
                return PARCELLES_CULTURALES
                    .filter(pc => pc.ferme === activeFarm && pc.cycle === currentCycle && pc.enProduction !== false)
                    .map(pc => ({ value: pc.id, label: pc.secteurs.join('/') + ' ' + pc.variete + (pc.sousVariete ? ' ' + pc.sousVariete : '') }));
            }, [activeFarm, currentCycle, bahiaParcelles]);

            const loadReadings = React.useCallback(async () => {
                setLoading(true);
                try {
                    let query = firebase.firestore().collection('irrigation_readings')
                        .where('ferme', '==', activeFarm)
                        .where('date', '==', filterDate)
                        .orderBy('createdAt', 'desc');
                    const snap = await query.get();
                    let results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    if (filterParcelle) results = results.filter(r => r.parcelle === filterParcelle);
                    results.sort((a, b) => (a.parcelleLabel || a.parcelle || '').localeCompare(b.parcelleLabel || b.parcelle || '') || (a.heure || '').localeCompare(b.heure || ''));
                    setReadings(results);
                } catch (e) { console.error('Erreur chargement historique:', e); }
                setLoading(false);
            }, [activeFarm, filterDate, filterParcelle]);

            useEffect(() => { loadReadings(); }, [loadReadings]);

            const handleDelete = async (id) => {
                if (!confirm('Supprimer cette lecture ?')) return;
                try {
                    await firebase.firestore().collection('irrigation_readings').doc(id).delete();
                    loadReadings();
                } catch (e) { alert('Erreur: ' + e.message); }
            };

            const canEditReading = (r) => {
                if (userProfile && userProfile.role === 'admin') return true;
                if (currentProfile && currentProfile.startsWith('stationnaire_') && r.date === todayStr) return true;
                return false;
            };

            const openEdit = (r) => {
                setEditData({
                    heure: r.heure || '',
                    duree: r.duree || 0,
                    points: (r.points || []).map(p => ({ label: p.label, ec: p.ec || 0, ph: p.ph || 0, volume: p.volume || 0 })),
                    drainage: (r.drainage || []).map(d => ({ label: d.label, ec: d.ec || 0, ph: d.ph || 0, volume: d.volume || 0 })),
                });
                setEditMode(true);
            };

            const handleUpdate = async () => {
                if (!selectedReading || !editData) return;
                setSaving(true);
                try {
                    await firebase.firestore().collection('irrigation_readings').doc(selectedReading.id).update({
                        heure: editData.heure,
                        duree: Number(editData.duree) || 0,
                        points: editData.points.map(p => ({ label: p.label, ec: Number(p.ec) || 0, ph: Number(p.ph) || 0, volume: Number(p.volume) || 0 })),
                        drainage: editData.drainage.map(d => ({ label: d.label, ec: Number(d.ec) || 0, ph: Number(d.ph) || 0, volume: Number(d.volume) || 0 })),
                        updatedAt: Date.now(),
                        updatedBy: currentProfile,
                    });
                    setEditMode(false);
                    setSelectedReading(null);
                    setEditData(null);
                    loadReadings();
                } catch (e) { alert('Erreur: ' + e.message); }
                setSaving(false);
            };

            const avg = (arr, field) => {
                if (!arr || arr.length === 0) return '-';
                const vals = arr.filter(x => x[field] > 0);
                if (vals.length === 0) return '-';
                return (vals.reduce((s, x) => s + x[field], 0) / vals.length).toFixed(1);
            };

            const byParcelle = React.useMemo(() => {
                const groups = {};
                readings.forEach(r => {
                    const key = r.parcelle || 'unknown';
                    if (!groups[key]) groups[key] = { label: r.parcelleLabel || r.parcelle || '-', readings: [] };
                    groups[key].readings.push(r);
                });
                return groups;
            }, [readings]);

            const groupAvg = (groupReadings, source, field) => {
                const allVals = [];
                groupReadings.forEach(r => {
                    (r[source] || []).forEach(p => { if (p[field] > 0) allVals.push(p[field]); });
                });
                if (allVals.length === 0) return '-';
                return (allVals.reduce((s, v) => s + v, 0) / allVals.length).toFixed(1);
            };

            const drainPct = (r) => {
                var pts = (r.points || []).filter(p => p.volume > 0);
                var drs = (r.drainage || []).filter(d => d.volume > 0);
                if (pts.length === 0 || drs.length === 0) return '-';
                var avgPt = pts.reduce((s, p) => s + p.volume, 0) / pts.length;
                var avgDr = drs.reduce((s, d) => s + d.volume, 0) / drs.length;
                if (avgPt === 0) return '-';
                return ((avgDr / avgPt) * 100).toFixed(1);
            };

            const groupDrainPct = (gReadings) => {
                var vals = gReadings.map(r => drainPct(r)).filter(v => v !== '-').map(Number);
                if (vals.length === 0) return '-';
                return (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1);
            };

            return React.createElement('div', { style: { padding: '16px' } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 } },
                    React.createElement('h2', { style: { fontSize: '1.2rem', margin: 0, color: 'var(--berry)' } },
                        React.createElement('i', { className: 'fa-solid fa-clock-rotate-left', style: { marginRight: 8 } }),
                        'Historique Irrigation — ', activeFarm
                    ),
                    isDT && React.createElement('div', { style: { display: 'flex', gap: 6 } },
                        ['F1', 'F5', 'BAHIA'].map(f => React.createElement('button', {
                            key: f,
                            onClick: () => { setSelectedFarm(f); setFilterParcelle(''); },
                            style: { padding: '6px 16px', borderRadius: 8, border: selectedFarm === f ? '2px solid var(--berry)' : '1px solid #ddd', background: selectedFarm === f ? 'var(--berry-pale)' : '#fff', color: selectedFarm === f ? 'var(--berry)' : 'var(--gray-600)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }
                        }, f))
                    )
                ),

                // Date navigation with arrows
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                        React.createElement('button', { onClick: () => { var d = new Date(filterDate); d.setDate(d.getDate() - 1); setFilterDate(d.toISOString().slice(0, 10)); }, style: { width: 36, height: 36, borderRadius: '50%', border: '1px solid #ddd', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 } },
                            React.createElement('i', { className: 'fa-solid fa-chevron-left' })
                        ),
                        React.createElement('input', { type: 'date', value: filterDate, onChange: e => setFilterDate(e.target.value), style: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 15, fontWeight: 600, textAlign: 'center' } }),
                        React.createElement('button', { onClick: () => { var d = new Date(filterDate); d.setDate(d.getDate() + 1); setFilterDate(d.toISOString().slice(0, 10)); }, style: { width: 36, height: 36, borderRadius: '50%', border: '1px solid #ddd', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 } },
                            React.createElement('i', { className: 'fa-solid fa-chevron-right' })
                        ),
                        React.createElement('button', { onClick: () => setFilterDate(new Date().toISOString().slice(0, 10)), style: { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--berry)', background: 'var(--berry-pale)', color: 'var(--berry)', fontSize: 11, fontWeight: 600, cursor: 'pointer' } }, "Aujourd'hui")
                    ),
                    React.createElement('div', { className: 'form-group', style: { marginLeft: 'auto' } },
                        React.createElement('select', { value: filterParcelle, onChange: e => setFilterParcelle(e.target.value), style: { padding: 8, borderRadius: 8, border: '1px solid #ddd', fontSize: 14, background: '#fff' } },
                            React.createElement('option', { value: '' }, 'Toutes parcelles'),
                            parcelleOptions.map(o => React.createElement('option', { key: o.value, value: o.value }, o.label))
                        )
                    )
                ),

                // Une carte par parcelle : Header → Historique → Graph → Recommandation
                loading ? React.createElement('p', null, 'Chargement...') :
                readings.length === 0 ? React.createElement('p', { style: { color: '#999', textAlign: 'center', marginTop: 32 } }, 'Aucune lecture pour cette date') :
                React.createElement('div', { style: { marginBottom: 20 } },
                    Object.entries(byParcelle).map(function(entry) {
                        var parcId = entry[0], group = entry[1];
                        var gReadings = group.readings;
                        var gEcPts = groupAvg(gReadings, 'points', 'ec');
                        var gPhPts = groupAvg(gReadings, 'points', 'ph');
                        var gEcDrain = groupAvg(gReadings, 'drainage', 'ec');
                        var gDrainPct = groupDrainPct(gReadings);
                        var drainColor = gDrainPct === '-' ? 'var(--gray-400)' : parseFloat(gDrainPct) > 30 ? 'var(--red)' : parseFloat(gDrainPct) < 10 ? 'var(--orange)' : 'var(--green)';
                        var gRecon = (gEcPts !== '-' && gEcDrain !== '-' && parseFloat(gEcPts) > 0) ? (parseFloat(gEcDrain) / parseFloat(gEcPts)) : null;
                        var gReconLabel = gRecon == null ? '-' : gRecon.toFixed(2) + 'x';
                        var gReconColor = gRecon == null ? 'var(--gray-400)' : gRecon < 1.1 ? 'var(--blue)' : gRecon <= 1.2 ? 'var(--green)' : '#F1C40F';
                        var gReconLabelSuffix = gRecon == null ? '' : gRecon > 1.2 ? ' · Faible ↑durée' : gRecon < 1.1 ? ' · Forte ↓durée' : ' · Optimale';
                        return React.createElement('div', { key: 'card-' + parcId, style: { background: '#fff', border: '1px solid rgba(139,34,82,0.15)', borderRadius: 10, padding: 12, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' } },
                            // Header
                            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 } },
                                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                                    React.createElement('i', { className: 'fa-solid fa-seedling', style: { color: 'var(--berry)', fontSize: 14 } }),
                                    React.createElement('span', { style: { fontWeight: 700, fontSize: 13, color: 'var(--berry)' } }, group.label),
                                    React.createElement('span', { style: { fontSize: 10, color: 'var(--gray-400)', background: 'rgba(0,0,0,0.04)', padding: '2px 8px', borderRadius: 10 } }, gReadings.length + ' lecture' + (gReadings.length > 1 ? 's' : ''))
                                ),
                                React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                                    React.createElement('span', { style: { fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600, background: 'rgba(139,34,82,0.06)', color: 'var(--gray-600)' } }, 'EC: ' + gEcPts),
                                    React.createElement('span', { style: { fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600, background: 'rgba(139,34,82,0.06)', color: 'var(--gray-600)' } }, 'pH: ' + gPhPts),
                                    React.createElement('span', { style: { fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600, background: 'rgba(52,152,219,0.08)', color: 'var(--blue)' } }, 'EC dr: ' + gEcDrain),
                                    React.createElement('span', { style: { fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600, background: 'rgba(0,0,0,0.04)', color: drainColor } }, '% Drain: ' + gDrainPct + (gDrainPct === '-' ? '' : '%')),
                                    React.createElement('span', { style: { fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 700, background: 'rgba(0,0,0,0.04)', color: gReconColor }, title: 'Reconcentration = EC drain / EC apport (cible 1.1–1.2)' }, 'Recon: ' + gReconLabel + gReconLabelSuffix)
                                )
                            ),
                            // Historique (table des lectures de cette parcelle)
                            React.createElement('div', { className: 'table-wrapper', style: { marginBottom: 10 } },
                                React.createElement('table', { className: 'data-table' },
                                    React.createElement('thead', null,
                                        React.createElement('tr', null,
                                            React.createElement('th', null, 'Heure'),
                                            React.createElement('th', { style: { textAlign: 'center' } }, 'EC pts'),
                                            React.createElement('th', { style: { textAlign: 'center' } }, 'pH pts'),
                                            React.createElement('th', { style: { textAlign: 'center' } }, 'Vol (mL)'),
                                            React.createElement('th', { style: { textAlign: 'center' } }, 'EC drain'),
                                            React.createElement('th', { style: { textAlign: 'center' } }, 'pH drain'),
                                            React.createElement('th', { style: { textAlign: 'center' } }, 'V (mL)'),
                                            React.createElement('th', { style: { textAlign: 'center' } }, '% Drainage'),
                                            React.createElement('th', { style: { textAlign: 'center' } }, 'Durée'),
                                            React.createElement('th', { style: { width: 40 } }, '')
                                        )
                                    ),
                                    React.createElement('tbody', null,
                                        gReadings.map(function(r) {
                                            return React.createElement('tr', { key: r.id, onClick: function() { setSelectedReading(r); }, style: { cursor: 'pointer' } },
                                                React.createElement('td', { style: { fontWeight: 600 } }, r.heure || '-'),
                                                React.createElement('td', { style: { textAlign: 'center' } }, avg(r.points, 'ec')),
                                                React.createElement('td', { style: { textAlign: 'center' } }, avg(r.points, 'ph')),
                                                React.createElement('td', { style: { textAlign: 'center' } }, avg(r.points, 'volume')),
                                                React.createElement('td', { style: { textAlign: 'center', color: 'var(--blue)' } }, avg(r.drainage, 'ec')),
                                                React.createElement('td', { style: { textAlign: 'center', color: 'var(--blue)' } }, avg(r.drainage, 'ph')),
                                                React.createElement('td', { style: { textAlign: 'center', color: 'var(--blue)' } }, avg(r.drainage, 'volume')),
                                                React.createElement('td', { style: { textAlign: 'center', fontWeight: 600, color: (function() { var v = drainPct(r); return v === '-' ? 'var(--gray-400)' : parseFloat(v) > 30 ? 'var(--red)' : parseFloat(v) < 10 ? 'var(--orange)' : 'var(--green)'; })() } }, (function() { var v = drainPct(r); return v === '-' ? '-' : v + '%'; })()),
                                                React.createElement('td', { style: { textAlign: 'center' } }, (r.duree || 0) + 'min'),
                                                React.createElement('td', null,
                                                    r.createdBy === currentProfile && React.createElement('button', {
                                                        onClick: function(e) { e.stopPropagation(); handleDelete(r.id); },
                                                        style: { background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer' },
                                                        title: 'Supprimer'
                                                    }, React.createElement('i', { className: 'fa-solid fa-trash-can' }))
                                                )
                                            );
                                        })
                                    ),
                                    // Totaux journée
                                    (function() {
                                        var sumPtsVol = 0, sumDrVol = 0, sumDuree = 0;
                                        var ecPtsVals = [], phPtsVals = [], ecDrVals = [], phDrVals = [];
                                        gReadings.forEach(function(r) {
                                            (r.points || []).forEach(function(p) {
                                                if (p.volume > 0) sumPtsVol += p.volume;
                                                if (p.ec > 0) ecPtsVals.push(p.ec);
                                                if (p.ph > 0) phPtsVals.push(p.ph);
                                            });
                                            (r.drainage || []).forEach(function(d) {
                                                if (d.volume > 0) sumDrVol += d.volume;
                                                if (d.ec > 0) ecDrVals.push(d.ec);
                                                if (d.ph > 0) phDrVals.push(d.ph);
                                            });
                                            sumDuree += Number(r.duree) || 0;
                                        });
                                        var mean = function(a) { return a.length ? (a.reduce(function(s,v){return s+v;},0)/a.length).toFixed(1) : '-'; };
                                        var globalDrainPct = sumPtsVol > 0 ? ((sumDrVol / sumPtsVol) * 100).toFixed(1) : '-';
                                        var globalDrainColor = globalDrainPct === '-' ? 'var(--gray-400)' : parseFloat(globalDrainPct) > 30 ? 'var(--red)' : parseFloat(globalDrainPct) < 10 ? 'var(--orange)' : 'var(--green)';
                                        return React.createElement('tfoot', null,
                                            React.createElement('tr', { style: { background: 'var(--berry-pale)', fontWeight: 700, borderTop: '2px solid var(--berry)' } },
                                                React.createElement('td', { style: { fontWeight: 800, color: 'var(--berry)' } }, 'TOTAL'),
                                                React.createElement('td', { style: { textAlign: 'center', color: 'var(--gray-600)', fontSize: 11 } }, '⌀ ' + mean(ecPtsVals)),
                                                React.createElement('td', { style: { textAlign: 'center', color: 'var(--gray-600)', fontSize: 11 } }, '⌀ ' + mean(phPtsVals)),
                                                React.createElement('td', { style: { textAlign: 'center' } }, sumPtsVol.toFixed(0)),
                                                React.createElement('td', { style: { textAlign: 'center', color: 'var(--blue)', fontSize: 11 } }, '⌀ ' + mean(ecDrVals)),
                                                React.createElement('td', { style: { textAlign: 'center', color: 'var(--blue)', fontSize: 11 } }, '⌀ ' + mean(phDrVals)),
                                                React.createElement('td', { style: { textAlign: 'center', color: 'var(--blue)' } }, sumDrVol.toFixed(0)),
                                                React.createElement('td', { style: { textAlign: 'center', color: globalDrainColor } }, globalDrainPct === '-' ? '-' : globalDrainPct + '%'),
                                                React.createElement('td', { style: { textAlign: 'center' } }, sumDuree + 'min'),
                                                React.createElement('td', null)
                                            )
                                        );
                                    })()
                                )
                            ),
                            // Graph
                            React.createElement(DrainageCurve, { group: group, drainPctFn: drainPct, sunriseMin: sunTimes.sunriseMin, sunsetMin: sunTimes.sunsetMin }),
                            (function() {
                                var sortedR = gReadings.slice().sort(function(a,b){ return (a.heure||'').localeCompare(b.heure||''); });
                                var last = sortedR[sortedR.length - 1];
                                if (!last) return null;
                                var ecPtsArr = (last.points||[]).filter(function(p){return p.ec>0;});
                                var ecDrArr = (last.drainage||[]).filter(function(d){return d.ec>0;});
                                var lastEcPts = ecPtsArr.length ? ecPtsArr.reduce(function(s,p){return s+p.ec;},0) / ecPtsArr.length : 0;
                                var lastEcDr = ecDrArr.length ? ecDrArr.reduce(function(s,d){return s+d.ec;},0) / ecDrArr.length : 0;
                                var lastRecon = (lastEcPts > 0 && lastEcDr > 0) ? (lastEcDr / lastEcPts) : null;
                                var lastDrainPct = drainPct(last);
                                var lastDuree = Number(last.duree) || 0;
                                var advice, action, advColor, advBg, suggestedDuree = lastDuree;
                                if (lastRecon == null) {
                                    advice = 'Données insuffisantes (manque EC drain ou EC apport sur la dernière lecture).';
                                    action = '—'; advColor = 'var(--gray-600)'; advBg = 'rgba(0,0,0,0.04)';
                                } else if (lastRecon > 1.2) {
                                    var inc = Math.max(1, Math.round(lastDuree * 0.2));
                                    suggestedDuree = lastDuree + inc;
                                    advice = 'Reconcentration ' + lastRecon.toFixed(2) + 'x élevée → racines en stress salin, apport insuffisant.';
                                    action = '↑ Augmenter la durée : ' + lastDuree + ' min → ~' + suggestedDuree + ' min (+' + inc + ' min)';
                                    advColor = '#B7950B'; advBg = 'rgba(241,196,15,0.12)';
                                } else if (lastRecon < 1.1) {
                                    var dec = Math.max(1, Math.round(lastDuree * 0.2));
                                    suggestedDuree = Math.max(2, lastDuree - dec);
                                    advice = 'Reconcentration ' + lastRecon.toFixed(2) + 'x faible → drainage excessif, gaspillage d’eau et nutriments.';
                                    action = '↓ Réduire la durée : ' + lastDuree + ' min → ~' + suggestedDuree + ' min (−' + dec + ' min)';
                                    advColor = 'var(--blue)'; advBg = 'rgba(52,152,219,0.10)';
                                } else {
                                    advice = 'Reconcentration ' + lastRecon.toFixed(2) + 'x dans la cible (1.10–1.20) — irrigation optimale.';
                                    action = '✓ Maintenir la durée : ' + lastDuree + ' min';
                                    advColor = 'var(--green)'; advBg = 'rgba(46,204,113,0.10)';
                                }
                                return React.createElement('div', { style: { marginTop: 10, padding: '10px 12px', background: advBg, borderLeft: '3px solid ' + advColor, borderRadius: 6 } },
                                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
                                        React.createElement('i', { className: 'fa-solid fa-lightbulb', style: { color: advColor, fontSize: 12 } }),
                                        React.createElement('span', { style: { fontSize: 11, fontWeight: 700, color: advColor, textTransform: 'uppercase', letterSpacing: 0.4 } }, 'Recommandation — dernière lecture ' + (last.heure || '?'))
                                    ),
                                    React.createElement('div', { style: { fontSize: 12, color: '#444', marginBottom: 4 } }, advice),
                                    React.createElement('div', { style: { fontSize: 12, fontWeight: 700, color: advColor } }, action),
                                    lastRecon != null && React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-600)', marginTop: 4 } },
                                        'EC apport ' + lastEcPts.toFixed(1) + ' → drain ' + lastEcDr.toFixed(1) + '   |   Drainage ' + (lastDrainPct === '-' ? '-' : lastDrainPct + '%') + '   |   Durée actuelle ' + lastDuree + ' min'
                                    )
                                );
                            })()
                        );
                    })
                ),

                // Detail / Edit modal
                selectedReading && React.createElement('div', { className: 'modal-overlay', onClick: () => { setSelectedReading(null); setEditMode(false); setEditData(null); } },
                    React.createElement('div', { className: 'modal-content', onClick: e => e.stopPropagation(), style: { maxWidth: 520 } },
                        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
                            React.createElement('h2', { style: { margin: 0 } }, editMode ? 'Modifier — ' : 'Détail — ', selectedReading.parcelleLabel || selectedReading.parcelle),
                            React.createElement('button', { onClick: () => { setSelectedReading(null); setEditMode(false); setEditData(null); }, style: { background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--gray-400)' } }, '×')
                        ),

                        editMode && editData ?
                        // ===== MODE ÉDITION =====
                        React.createElement('div', null,
                            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 } },
                                React.createElement('div', { className: 'form-group' },
                                    React.createElement('label', null, 'Heure'),
                                    React.createElement('input', { type: 'time', value: editData.heure, onChange: e => setEditData({ ...editData, heure: e.target.value }), style: { width: '100%', padding: 8, borderRadius: 8, border: '1px solid #ddd', fontSize: 15 } })
                                ),
                                React.createElement('div', { className: 'form-group' },
                                    React.createElement('label', null, 'Durée (min)'),
                                    React.createElement('input', { type: 'number', inputMode: 'numeric', value: editData.duree, onChange: e => setEditData({ ...editData, duree: e.target.value }), style: { width: '100%', padding: 8, borderRadius: 8, border: '1px solid #ddd', fontSize: 15 } })
                                )
                            ),
                            React.createElement('h3', { style: { fontSize: '0.95rem', margin: '12px 0 8px', color: 'var(--berry)' } }, "Points d'irrigation"),
                            editData.points.map((p, i) => React.createElement('div', { key: i, className: 'irrigation-point-card', style: { marginBottom: 8 } },
                                React.createElement('h4', { style: { marginBottom: 6, fontSize: '0.85rem' } }, p.label || ('Point ' + (i + 1))),
                                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 } },
                                    React.createElement('div', { className: 'form-group' },
                                        React.createElement('label', null, 'EC'),
                                        React.createElement('input', { type: 'number', inputMode: 'decimal', step: '0.1', value: p.ec, onChange: e => { var pts = editData.points.slice(); pts[i] = { ...pts[i], ec: e.target.value }; setEditData({ ...editData, points: pts }); }, style: { width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ddd', fontSize: 15 } })
                                    ),
                                    React.createElement('div', { className: 'form-group' },
                                        React.createElement('label', null, 'pH'),
                                        React.createElement('input', { type: 'number', inputMode: 'decimal', step: '0.1', value: p.ph, onChange: e => { var pts = editData.points.slice(); pts[i] = { ...pts[i], ph: e.target.value }; setEditData({ ...editData, points: pts }); }, style: { width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ddd', fontSize: 15 } })
                                    ),
                                    React.createElement('div', { className: 'form-group' },
                                        React.createElement('label', null, 'Vol (mL)'),
                                        React.createElement('input', { type: 'number', inputMode: 'decimal', step: '0.5', value: p.volume, onChange: e => { var pts = editData.points.slice(); pts[i] = { ...pts[i], volume: e.target.value }; setEditData({ ...editData, points: pts }); }, style: { width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ddd', fontSize: 15 } })
                                    )
                                )
                            )),
                            React.createElement('h3', { style: { fontSize: '0.95rem', margin: '12px 0 8px', color: 'var(--blue)' } }, 'Drainage'),
                            editData.drainage.map((d, i) => React.createElement('div', { key: i, className: 'irrigation-point-card irrigation-drainage-card', style: { marginBottom: 8 } },
                                React.createElement('h4', { style: { marginBottom: 6, fontSize: '0.85rem' } }, d.label || ('Drainage ' + (i + 1))),
                                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 } },
                                    React.createElement('div', { className: 'form-group' },
                                        React.createElement('label', null, 'EC'),
                                        React.createElement('input', { type: 'number', inputMode: 'decimal', step: '0.1', value: d.ec, onChange: e => { var drs = editData.drainage.slice(); drs[i] = { ...drs[i], ec: e.target.value }; setEditData({ ...editData, drainage: drs }); }, style: { width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ddd', fontSize: 15 } })
                                    ),
                                    React.createElement('div', { className: 'form-group' },
                                        React.createElement('label', null, 'pH'),
                                        React.createElement('input', { type: 'number', inputMode: 'decimal', step: '0.1', value: d.ph, onChange: e => { var drs = editData.drainage.slice(); drs[i] = { ...drs[i], ph: e.target.value }; setEditData({ ...editData, drainage: drs }); }, style: { width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ddd', fontSize: 15 } })
                                    ),
                                    React.createElement('div', { className: 'form-group' },
                                        React.createElement('label', null, 'V (mL)'),
                                        React.createElement('input', { type: 'number', inputMode: 'decimal', step: '0.5', value: d.volume, onChange: e => { var drs = editData.drainage.slice(); drs[i] = { ...drs[i], volume: e.target.value }; setEditData({ ...editData, drainage: drs }); }, style: { width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ddd', fontSize: 15 } })
                                    )
                                )
                            )),
                            React.createElement('div', { style: { marginTop: 16, display: 'flex', gap: 10, justifyContent: 'flex-end' } },
                                React.createElement('button', { className: 'btn-secondary', onClick: () => { setEditMode(false); setEditData(null); } }, 'Annuler'),
                                React.createElement('button', { className: 'btn-primary', onClick: handleUpdate, disabled: saving, style: { padding: '10px 24px' } }, saving ? 'Sauvegarde...' : 'Sauvegarder')
                            )
                        ) :
                        // ===== MODE LECTURE =====
                        React.createElement('div', null,
                            React.createElement('p', { style: { color: '#666', marginBottom: 8 } }, 'Date: ', selectedReading.date, ' | Durée: ', selectedReading.duree || 0, ' min'),

                            React.createElement('h3', { style: { fontSize: '0.95rem', margin: '12px 0 6px', color: 'var(--berry)' } }, "Points d'irrigation"),
                            React.createElement('div', { className: 'irrigation-points-grid' },
                                (selectedReading.points || []).map((p, i) => React.createElement('div', { key: i, className: 'irrigation-point-card' },
                                    React.createElement('h4', null, p.label || ('Point ' + (i + 1))),
                                    React.createElement('div', null, 'EC: ', React.createElement('strong', null, p.ec), ' mS/cm'),
                                    React.createElement('div', null, 'pH: ', React.createElement('strong', null, p.ph)),
                                    React.createElement('div', null, 'Vol: ', React.createElement('strong', null, p.volume), ' mL')
                                ))
                            ),

                            React.createElement('h3', { style: { fontSize: '0.95rem', margin: '12px 0 6px', color: 'var(--blue)' } }, 'Drainage'),
                            React.createElement('div', { className: 'irrigation-points-grid' },
                                (selectedReading.drainage || []).map((d, i) => React.createElement('div', { key: i, className: 'irrigation-point-card irrigation-drainage-card' },
                                    React.createElement('h4', null, d.label || ('Drainage ' + (i + 1))),
                                    React.createElement('div', null, 'EC: ', React.createElement('strong', null, d.ec), ' mS/cm'),
                                    React.createElement('div', null, 'pH: ', React.createElement('strong', null, d.ph)),
                                    React.createElement('div', null, 'V: ', React.createElement('strong', null, d.volume), ' mL')
                                ))
                            ),

                            React.createElement('div', { style: { marginTop: 16, display: 'flex', gap: 10, justifyContent: 'flex-end' } },
                                canEditReading(selectedReading) && React.createElement('button', { className: 'btn-primary', onClick: () => openEdit(selectedReading), style: { padding: '10px 20px' } },
                                    React.createElement('i', { className: 'fa-solid fa-pen', style: { marginRight: 6 } }), 'Modifier'
                                ),
                                React.createElement('button', { className: 'btn-secondary', onClick: () => setSelectedReading(null) }, 'Fermer')
                            )
                        )
                    )
                )
            );
        }

export { StationnaireHistoriqueTab };
