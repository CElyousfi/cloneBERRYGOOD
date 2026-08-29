/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): AgroGrowthTab */
import { SimpleAreaChart } from '../shared/SimpleAreaChart.jsx';
import { useEffect, useMemo, useState } from '../shared/reactHooks.jsx';
import { PARCELLES_CULTURALES } from './PARCELLES_CULTURALES.jsx';

// =============================================
        // SUIVI CROISSANCE FRAMBOISE (points de contrôle)
        // =============================================
        function AgroGrowthTab({ currentProfile, userProfile }) {
            const GU = window.GrowthUtils || {};
            const PALETTE = ['#8B2252', '#2D8B4E', '#D4A847', '#2196F3', '#9C27B0', '#FF7043', '#00897B', '#5C6BC0'];
            // Le backend autorise l'écriture au seul profil RÉEL agronomie (token).
            const isAgro = !!(userProfile && userProfile.profileId === 'agronomie');

            const todayStr = () => {
                const d = new Date();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${d.getFullYear()}-${mm}-${dd}`;
            };

            const [varieteFilter, setVarieteFilter] = useState('Toutes');
            const [parcelleId, setParcelleId] = useState('');
            const [measurements, setMeasurements] = useState([]);
            const [configs, setConfigs] = useState([]);
            const [loading, setLoading] = useState(true);
            const [busy, setBusy] = useState(false);
            const [err, setErr] = useState('');

            // Formulaire relevé
            const [formDate, setFormDate] = useState(todayStr());
            const [formCheckpoint, setFormCheckpoint] = useState('');
            const [formLength, setFormLength] = useState('');
            // Ajout point de contrôle
            const [newCheckpoint, setNewCheckpoint] = useState('');

            const varietes = useMemo(() => GU.varietesFramboise ? GU.varietesFramboise(PARCELLES_CULTURALES) : [], []);
            const parcelles = useMemo(
                () => GU.framboiseParcelles ? GU.framboiseParcelles(PARCELLES_CULTURALES, varieteFilter) : [],
                [varieteFilter]
            );
            const selectedParcelle = useMemo(
                () => parcelles.find(p => p.id === parcelleId) || null,
                [parcelles, parcelleId]
            );
            const selectedConfig = useMemo(
                () => configs.find(c => c.parcelle_id === parcelleId) || null,
                [configs, parcelleId]
            );
            const checkpoints = (selectedConfig && Array.isArray(selectedConfig.checkpoints)) ? selectedConfig.checkpoints : [];

            const reload = async () => {
                setLoading(true);
                setErr('');
                try {
                    const [mRes, cRes] = await Promise.all([
                        fetch('/api/growth?action=list-measurements').then(r => r.json()),
                        fetch('/api/growth?action=list-config').then(r => r.json()),
                    ]);
                    if (mRes && mRes.success) setMeasurements(mRes.measurements || []);
                    if (cRes && cRes.success) setConfigs(cRes.configs || []);
                } catch (e) {
                    setErr('Erreur de chargement : ' + e.message);
                } finally {
                    setLoading(false);
                }
            };

            useEffect(() => { reload(); }, []);

            // Auto-sélectionne la 1re parcelle quand la liste change
            useEffect(() => {
                if (parcelles.length && !parcelles.find(p => p.id === parcelleId)) {
                    setParcelleId(parcelles[0].id);
                }
            }, [parcelles]);

            // Reset du checkpoint sélectionné quand on change de parcelle
            useEffect(() => { setFormCheckpoint(''); }, [parcelleId]);

            const postJson = async (action, body) => {
                const r = await fetch('/api/growth?action=' + action, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                return r.json();
            };

            const addCheckpoint = async () => {
                const name = (newCheckpoint || '').trim();
                if (!name || !selectedParcelle) return;
                setBusy(true);
                setErr('');
                try {
                    const next = (GU.normalizeCheckpoints || ((a) => a))(checkpoints.concat([name]));
                    const res = await postJson('set-checkpoints', {
                        parcelle_id: selectedParcelle.id,
                        parcelle_nom: selectedParcelle.label,
                        checkpoints: next,
                    });
                    if (!res.success) { setErr(res.error || 'Échec.'); return; }
                    setNewCheckpoint('');
                    await reload();
                } catch (e) { setErr(e.message); } finally { setBusy(false); }
            };

            const removeCheckpoint = async (name) => {
                if (!selectedParcelle) return;
                setBusy(true);
                setErr('');
                try {
                    const next = checkpoints.filter(c => c !== name);
                    const res = await postJson('set-checkpoints', {
                        parcelle_id: selectedParcelle.id,
                        parcelle_nom: selectedParcelle.label,
                        checkpoints: next,
                    });
                    if (!res.success) { setErr(res.error || 'Échec.'); return; }
                    await reload();
                } catch (e) { setErr(e.message); } finally { setBusy(false); }
            };

            const submitMeasurement = async () => {
                if (!selectedParcelle) return;
                const payload = {
                    parcelle_id: selectedParcelle.id,
                    checkpoint: formCheckpoint,
                    date: formDate,
                    length_cm: formLength,
                };
                const check = (GU.validateMeasurement || (() => ({ valid: true })))(payload);
                if (!check.valid) { setErr(check.error); return; }
                setBusy(true);
                setErr('');
                try {
                    const res = await postJson('create-measurement', {
                        parcelle_id: selectedParcelle.id,
                        parcelle_nom: selectedParcelle.label,
                        variete: selectedParcelle.variete,
                        sous_variete: selectedParcelle.sousVariete || '',
                        ferme: selectedParcelle.ferme,
                        checkpoint: formCheckpoint,
                        date: formDate,
                        length_cm: parseFloat(formLength),
                    });
                    if (!res.success) { setErr(res.error || 'Échec.'); return; }
                    setFormLength('');
                    await reload();
                } catch (e) { setErr(e.message); } finally { setBusy(false); }
            };

            const deleteMeasurement = async (id) => {
                setBusy(true);
                setErr('');
                try {
                    const res = await postJson('delete-measurement', { id });
                    if (!res.success) { setErr(res.error || 'Échec.'); return; }
                    await reload();
                } catch (e) { setErr(e.message); } finally { setBusy(false); }
            };

            // Relevés de la parcelle sélectionnée
            const parcelleMeasurements = useMemo(
                () => measurements.filter(m => m.parcelle_id === parcelleId),
                [measurements, parcelleId]
            );
            const series = useMemo(
                () => (GU.buildGrowthSeries ? GU.buildGrowthSeries(parcelleMeasurements, checkpoints) : { rows: [], dataKeys: [] }),
                [parcelleMeasurements, checkpoints]
            );

            const card = { background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' };
            const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 };
            const inputStyle = { width: '100%', padding: '10px 12px', fontSize: 15, border: '1px solid #ddd', borderRadius: 8, boxSizing: 'border-box' };
            const btnPrimary = { padding: '12px 18px', fontSize: 15, fontWeight: 600, color: '#fff', background: 'var(--berry, #8B2252)', border: 'none', borderRadius: 8, cursor: 'pointer' };

            return (
                <div style={{ maxWidth: 760, margin: '0 auto', padding: 12 }}>
                    <h2 style={{ fontSize: 20, margin: '4px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="fa-solid fa-ruler-vertical" style={{ color: 'var(--berry, #8B2252)' }}></i>
                        Suivi Croissance Framboise
                    </h2>

                    {err && <div style={{ background: '#fdecea', color: '#b71c1c', padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 14 }}>{err}</div>}

                    {/* Filtres */}
                    <div style={card}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                            <div style={{ flex: '1 1 200px' }}>
                                <label style={labelStyle}>Variété</label>
                                <select style={inputStyle} value={varieteFilter} onChange={e => setVarieteFilter(e.target.value)}>
                                    <option value="Toutes">Toutes</option>
                                    {varietes.map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: '1 1 260px' }}>
                                <label style={labelStyle}>Parcelle</label>
                                <select style={inputStyle} value={parcelleId} onChange={e => setParcelleId(e.target.value)}>
                                    {parcelles.length === 0 && <option value="">Aucune parcelle</option>}
                                    {parcelles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>

                    {loading && <div style={{ textAlign: 'center', color: '#888', padding: 20 }}>Chargement…</div>}

                    {!loading && selectedParcelle && (
                        <React.Fragment>
                            {/* Configuration des points de contrôle */}
                            <div style={card}>
                                <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>Points de contrôle</h3>
                                {checkpoints.length === 0 && (
                                    <p style={{ color: '#888', fontSize: 14, margin: '0 0 8px' }}>
                                        {isAgro ? 'Aucun point configuré. Ajoute-en un ci-dessous.' : 'Aucun point de contrôle configuré.'}
                                    </p>
                                )}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: isAgro ? 12 : 0 }}>
                                    {checkpoints.map(cp => (
                                        <span key={cp} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f0e6eb', color: '#8B2252', padding: '6px 10px', borderRadius: 16, fontSize: 13, fontWeight: 600 }}>
                                            {cp}
                                            {isAgro && (
                                                <i className="fa-solid fa-xmark" style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => !busy && removeCheckpoint(cp)} title="Supprimer"></i>
                                            )}
                                        </span>
                                    ))}
                                </div>
                                {isAgro && (
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <input style={{ ...inputStyle, flex: 1 }} placeholder="Nouveau point (ex. Entrée)" value={newCheckpoint}
                                            onChange={e => setNewCheckpoint(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') addCheckpoint(); }} />
                                        <button style={btnPrimary} disabled={busy || !newCheckpoint.trim()} onClick={addCheckpoint}>Ajouter</button>
                                    </div>
                                )}
                            </div>

                            {/* Formulaire de relevé */}
                            {isAgro && (
                                <div style={card}>
                                    <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>Nouveau relevé</h3>
                                    {checkpoints.length === 0 ? (
                                        <p style={{ color: '#888', fontSize: 14, margin: 0 }}>Configure d'abord les points de contrôle.</p>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                            <div>
                                                <label style={labelStyle}>Date</label>
                                                <input type="date" style={inputStyle} value={formDate} onChange={e => setFormDate(e.target.value)} />
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Point de contrôle</label>
                                                <select style={inputStyle} value={formCheckpoint} onChange={e => setFormCheckpoint(e.target.value)}>
                                                    <option value="">— Choisir —</option>
                                                    {checkpoints.map(cp => <option key={cp} value={cp}>{cp}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Longueur de canne (cm)</label>
                                                <input type="number" inputMode="decimal" min="0" step="0.1" style={inputStyle} value={formLength}
                                                    onChange={e => setFormLength(e.target.value)} placeholder="ex. 42" />
                                            </div>
                                            <button style={btnPrimary} disabled={busy} onClick={submitMeasurement}>
                                                <i className="fa-solid fa-plus" style={{ marginRight: 6 }}></i>Enregistrer le relevé
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Graphe */}
                            <div style={card}>
                                <h3 style={{ fontSize: 15, margin: '0 0 4px' }}>
                                    Évolution — {selectedParcelle.label}
                                </h3>
                                <p style={{ color: '#888', fontSize: 12, margin: '0 0 10px' }}>Longueur (cm) par point de contrôle</p>
                                {series.rows.length === 0 ? (
                                    <p style={{ color: '#888', fontSize: 14, margin: 0 }}>Aucun relevé pour cette parcelle.</p>
                                ) : (
                                    <React.Fragment>
                                        <SimpleAreaChart data={series.rows} dataKeys={series.dataKeys} colors={PALETTE} xKey="date" height={260} />
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
                                            {series.dataKeys.map((k, i) => (
                                                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                                    <span style={{ width: 12, height: 12, borderRadius: 3, background: PALETTE[i % PALETTE.length] }}></span>{k}
                                                </span>
                                            ))}
                                        </div>
                                    </React.Fragment>
                                )}
                            </div>

                            {/* Historique */}
                            <div style={card}>
                                <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>Historique des relevés</h3>
                                {parcelleMeasurements.length === 0 ? (
                                    <p style={{ color: '#888', fontSize: 14, margin: 0 }}>Aucun relevé.</p>
                                ) : (
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                                            <thead>
                                                <tr style={{ textAlign: 'left', color: '#666', borderBottom: '1px solid #eee' }}>
                                                    <th style={{ padding: '6px 8px' }}>Date</th>
                                                    <th style={{ padding: '6px 8px' }}>Point</th>
                                                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>cm</th>
                                                    {isAgro && <th style={{ padding: '6px 8px' }}></th>}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {parcelleMeasurements.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 50).map(m => (
                                                    <tr key={m.id} style={{ borderBottom: '1px solid #f4f4f4' }}>
                                                        <td style={{ padding: '6px 8px' }}>{m.date}</td>
                                                        <td style={{ padding: '6px 8px' }}>{m.checkpoint}</td>
                                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{m.length_cm}</td>
                                                        {isAgro && (
                                                            <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                                                <i className="fa-solid fa-trash" style={{ color: '#c62828', cursor: 'pointer' }} title="Supprimer" onClick={() => !busy && deleteMeasurement(m.id)}></i>
                                                            </td>
                                                        )}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </React.Fragment>
                    )}
                </div>
            );
        }

export { AgroGrowthTab };
