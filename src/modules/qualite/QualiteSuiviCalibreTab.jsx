/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: qualite | Déclaration(s): QualiteSuiviCalibreTab */
import { Panel } from '../shared/Panel.jsx';
import { useEffect, useMemo, useState } from '../shared/reactHooks.jsx';

// ===================== SUIVI CALIBRE TAB =====================
        function QualiteSuiviCalibreTab({ data }) {
            const [records, setRecords] = useState([]);
            const [loading, setLoading] = useState(true);
            const [filterFerme, setFilterFerme] = useState('');
            const [filterVariete, setFilterVariete] = useState('');
            const [filterBloc, setFilterBloc] = useState('');
            const [dateFrom, setDateFrom] = useState('');
            const [dateTo, setDateTo] = useState('');

            useEffect(() => {
                const load = async () => {
                    setLoading(true);
                    try {
                        let firestoreData = [];
                        if (typeof firebase !== 'undefined' && firebase.firestore) {
                            const db = firebase.firestore();
                            const snap = await db.collection('pfq_interne')
                                .orderBy('createdAt', 'desc').limit(500).get();
                            firestoreData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                        }
                        const localData = JSON.parse(localStorage.getItem('pfq_interne_local') || '[]');
                        setRecords([...localData, ...firestoreData]);
                    } catch (e) {
                        console.error('Error loading suivi calibre:', e);
                        setRecords(JSON.parse(localStorage.getItem('pfq_interne_local') || '[]'));
                    } finally {
                        setLoading(false);
                    }
                };
                load();
            }, []);

            // Aplatir: une ligne par barquette avec calibre
            const rows = useMemo(() => {
                const out = [];
                records.forEach(r => {
                    (r.barquettes || []).forEach(b => {
                        const cal = b.calibre != null ? b.calibre : (b.poids > 0 && b.nbFruits > 0 ? Math.round(((b.poids - (b.poidsEmballage || 7)) / b.nbFruits) * 100) / 100 : null);
                        if (cal == null) return;
                        out.push({
                            date: r.date || (r.createdAt ? String(r.createdAt).slice(0, 10) : ''),
                            ferme: r.blocFerme || '',
                            variete: r.blocVariete || '',
                            bloc: r.blocLabel || r.bloc || '',
                            bonApport: r.bonApport || '',
                            numero: b.numero,
                            poids: b.poids,
                            poidsEmballage: b.poidsEmballage || 0,
                            nbFruits: b.nbFruits,
                            calibre: cal,
                        });
                    });
                });
                return out;
            }, [records]);

            const fermes = useMemo(() => Array.from(new Set(rows.map(r => r.ferme).filter(Boolean))).sort(), [rows]);
            const varietes = useMemo(() => Array.from(new Set(rows.map(r => r.variete).filter(Boolean))).sort(), [rows]);
            const blocs = useMemo(() => Array.from(new Set(rows.map(r => r.bloc).filter(Boolean))).sort(), [rows]);

            const filtered = useMemo(() => rows.filter(r => {
                if (filterFerme && r.ferme !== filterFerme) return false;
                if (filterVariete && r.variete !== filterVariete) return false;
                if (filterBloc && r.bloc !== filterBloc) return false;
                if (dateFrom && r.date < dateFrom) return false;
                if (dateTo && r.date > dateTo) return false;
                return true;
            }), [rows, filterFerme, filterVariete, filterBloc, dateFrom, dateTo]);

            // Moyennes par bloc/variete
            const aggByBloc = useMemo(() => {
                const map = {};
                filtered.forEach(r => {
                    const key = r.bloc;
                    if (!map[key]) map[key] = { bloc: r.bloc, ferme: r.ferme, variete: r.variete, sum: 0, n: 0, min: Infinity, max: -Infinity };
                    map[key].sum += r.calibre;
                    map[key].n += 1;
                    map[key].min = Math.min(map[key].min, r.calibre);
                    map[key].max = Math.max(map[key].max, r.calibre);
                });
                return Object.values(map).map(o => ({ ...o, avg: o.n > 0 ? o.sum / o.n : 0 })).sort((a, b) => b.avg - a.avg);
            }, [filtered]);

            const aggByVariete = useMemo(() => {
                const map = {};
                filtered.forEach(r => {
                    const key = r.variete;
                    if (!map[key]) map[key] = { variete: r.variete, sum: 0, n: 0 };
                    map[key].sum += r.calibre;
                    map[key].n += 1;
                });
                return Object.values(map).map(o => ({ ...o, avg: o.n > 0 ? o.sum / o.n : 0 })).sort((a, b) => b.avg - a.avg);
            }, [filtered]);

            const globalAvg = filtered.length > 0 ? filtered.reduce((s, r) => s + r.calibre, 0) / filtered.length : 0;

            const calColor = (c) => c >= 4 ? 'var(--green)' : c >= 3 ? 'var(--blue)' : c >= 2 ? 'var(--orange)' : 'var(--red)';

            if (loading) return <div className="tab-content fade-in"><Panel title="Suivi Calibre" icon="fa-ruler-combined"><div style={{padding:40,textAlign:'center',color:'var(--gray-500)'}}>Chargement…</div></Panel></div>;

            return (
                <div className="tab-content fade-in">
                    <Panel title="Suivi Calibre — PFQ Interne" icon="fa-ruler-combined">
                        <div style={{padding:16}}>
                            {/* Filtres */}
                            <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
                                <select value={filterFerme} onChange={e => setFilterFerme(e.target.value)} style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}}>
                                    <option value="">Toutes fermes</option>
                                    {fermes.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                                <select value={filterVariete} onChange={e => setFilterVariete(e.target.value)} style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}}>
                                    <option value="">Toutes variétés</option>
                                    {varietes.map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                                <select value={filterBloc} onChange={e => setFilterBloc(e.target.value)} style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}}>
                                    <option value="">Tous blocs</option>
                                    {blocs.map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}} />
                                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}} />
                            </div>

                            {/* KPI globaux */}
                            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))',gap:12,marginBottom:20}}>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Calibre moyen</div>
                                    <div style={{fontSize:26,fontWeight:700,color:calColor(globalAvg),marginTop:4}}>{globalAvg.toFixed(2)} g</div>
                                </div>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Barquettes</div>
                                    <div style={{fontSize:26,fontWeight:700,marginTop:4}}>{filtered.length}</div>
                                </div>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Blocs suivis</div>
                                    <div style={{fontSize:26,fontWeight:700,marginTop:4}}>{aggByBloc.length}</div>
                                </div>
                            </div>

                            {/* Calibre moyen par variété */}
                            <div style={{marginBottom:24}}>
                                <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>Calibre moyen par variété</h3>
                                <table style={{width:'100%',fontSize:13,borderCollapse:'collapse'}}>
                                    <thead><tr style={{background:'var(--gray-50)'}}><th style={{textAlign:'left',padding:'8px 10px'}}>Variété</th><th style={{textAlign:'right',padding:'8px 10px'}}>Barquettes</th><th style={{textAlign:'right',padding:'8px 10px'}}>Calibre moyen (g)</th></tr></thead>
                                    <tbody>
                                        {aggByVariete.map(v => (
                                            <tr key={v.variete} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                <td style={{padding:'6px 10px',fontWeight:600}}>{v.variete}</td>
                                                <td style={{padding:'6px 10px',textAlign:'right'}}>{v.n}</td>
                                                <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:calColor(v.avg)}}>{v.avg.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                        {aggByVariete.length === 0 && <tr><td colSpan={3} style={{padding:20,textAlign:'center',color:'var(--gray-400)'}}>Aucune donnée</td></tr>}
                                    </tbody>
                                </table>
                            </div>

                            {/* Calibre par bloc */}
                            <div style={{marginBottom:24}}>
                                <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>Calibre moyen par bloc</h3>
                                <table style={{width:'100%',fontSize:13,borderCollapse:'collapse'}}>
                                    <thead><tr style={{background:'var(--gray-50)'}}><th style={{textAlign:'left',padding:'8px 10px'}}>Bloc</th><th style={{textAlign:'left',padding:'8px 10px'}}>Ferme</th><th style={{textAlign:'left',padding:'8px 10px'}}>Variété</th><th style={{textAlign:'right',padding:'8px 10px'}}>Barq.</th><th style={{textAlign:'right',padding:'8px 10px'}}>Min</th><th style={{textAlign:'right',padding:'8px 10px'}}>Moyen</th><th style={{textAlign:'right',padding:'8px 10px'}}>Max</th></tr></thead>
                                    <tbody>
                                        {aggByBloc.map(b => (
                                            <tr key={b.bloc} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                <td style={{padding:'6px 10px',fontWeight:600}}>{b.bloc}</td>
                                                <td style={{padding:'6px 10px'}}>{b.ferme}</td>
                                                <td style={{padding:'6px 10px'}}>{b.variete}</td>
                                                <td style={{padding:'6px 10px',textAlign:'right'}}>{b.n}</td>
                                                <td style={{padding:'6px 10px',textAlign:'right'}}>{b.min.toFixed(2)}</td>
                                                <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:calColor(b.avg)}}>{b.avg.toFixed(2)}</td>
                                                <td style={{padding:'6px 10px',textAlign:'right'}}>{b.max.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                        {aggByBloc.length === 0 && <tr><td colSpan={7} style={{padding:20,textAlign:'center',color:'var(--gray-400)'}}>Aucune donnée</td></tr>}
                                    </tbody>
                                </table>
                            </div>

                            {/* Détail par barquette */}
                            <div>
                                <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>Détail des barquettes ({filtered.length})</h3>
                                <div style={{maxHeight:400,overflowY:'auto',border:'1px solid var(--gray-100)',borderRadius:8}}>
                                    <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                                        <thead style={{position:'sticky',top:0,background:'var(--gray-50)'}}><tr><th style={{textAlign:'left',padding:'6px 10px'}}>Date</th><th style={{textAlign:'left',padding:'6px 10px'}}>Bloc</th><th style={{textAlign:'left',padding:'6px 10px'}}>Variété</th><th style={{textAlign:'right',padding:'6px 10px'}}>BA</th><th style={{textAlign:'right',padding:'6px 10px'}}>Barq.</th><th style={{textAlign:'right',padding:'6px 10px'}}>P. avec emb.</th><th style={{textAlign:'right',padding:'6px 10px'}}>P. emb.</th><th style={{textAlign:'right',padding:'6px 10px'}}>Nb fruits</th><th style={{textAlign:'right',padding:'6px 10px'}}>Calibre</th></tr></thead>
                                        <tbody>
                                            {filtered.slice(0, 500).map((r, i) => (
                                                <tr key={i} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                    <td style={{padding:'5px 10px'}}>{r.date}</td>
                                                    <td style={{padding:'5px 10px'}}>{r.bloc}</td>
                                                    <td style={{padding:'5px 10px'}}>{r.variete}</td>
                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{r.bonApport}</td>
                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{r.numero}</td>
                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{r.poids}</td>
                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{r.poidsEmballage}</td>
                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{r.nbFruits}</td>
                                                    <td style={{padding:'5px 10px',textAlign:'right',fontWeight:700,color:calColor(r.calibre)}}>{r.calibre.toFixed(2)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </Panel>
                </div>
            );
        }

export { QualiteSuiviCalibreTab };
