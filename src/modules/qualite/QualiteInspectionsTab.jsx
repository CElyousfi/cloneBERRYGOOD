/* Module: qualite | Déclaration(s): QualiteInspectionsTab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { deduplicateExpeditions } from './deduplicateExpeditions.jsx';

function QualiteInspectionsTab({ data, applyVarietyMapping, farmFilter }) {
            const [expeditions, setExpeditions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedDate, setSelectedDate] = useState('');
            const [selectedExp, setSelectedExp] = useState(null);
            const [refreshing, setRefreshing] = useState(false);
            const [refreshMsg, setRefreshMsg] = useState('');
            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };

            const loadExpeditions = () => {
                setLoading(true);
                cachedFetch('/api/email-analysis?action=expeditions&limit=2000')
                    .then(json => {
                        if (json.success && json.expeditions) setExpeditions(json.expeditions);
                    })
                    .catch(err => console.warn('Could not load expeditions:', err))
                    .finally(() => setLoading(false));
            };

            React.useEffect(() => { loadExpeditions(); }, []);

            const handleBulkBrixRefresh = async () => {
                setRefreshing(true);
                setRefreshMsg('Relecture DQR/Brix en cours...');
                try {
                    const res = await fetch('/api/email-analysis?action=refetch-dqr');
                    const json = await res.json();
                    setRefreshMsg(`${json.processed || 0} emails DQR re-traités. Traitement Brix en cours...`);
                    // Wait a bit for triggers to process, then reload
                    setTimeout(() => {
                        loadExpeditions();
                        setRefreshMsg('');
                        setRefreshing(false);
                    }, 15000);
                } catch (err) {
                    setRefreshMsg('Erreur: ' + err.message);
                    setRefreshing(false);
                }
            };

            const mappedExpeditions = React.useMemo(() =>
                deduplicateExpeditions(expeditions).map(e => ({
                    ...e, variety: applyVarietyMapping ? applyVarietyMapping(e.batchNumber, e.variety) : e.variety
                })),
            [expeditions, applyVarietyMapping]);

            // Parse date from "MM/DD/YYYY HH:MM GMT" or ISO format to YYYY-MM-DD
            const parseExpDate = (e) => {
                const raw = e.date || e.inspectedDate || e.createdAt || '';
                if (!raw) return '';
                // Try MM/DD/YYYY format
                const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                if (m) return `${m[3]}-${m[1]}-${m[2]}`;
                // Try ISO format
                if (raw.length >= 10 && raw[4] === '-') return raw.slice(0, 10);
                return '';
            };

            const withDates = React.useMemo(() =>
                mappedExpeditions.map(e => ({ ...e, _day: parseExpDate(e) })),
            [mappedExpeditions]);

            // Get unique dates sorted descending
            const uniqueDates = React.useMemo(() => {
                return [...new Set(withDates.map(e => e._day).filter(Boolean))].sort().reverse();
            }, [withDates]);

            // Auto-select today, or most recent date
            React.useEffect(() => {
                if (!selectedDate && uniqueDates.length > 0) {
                    const today = new Date().toISOString().slice(0, 10);
                    setSelectedDate(uniqueDates.includes(today) ? today : uniqueDates[0]);
                }
            }, [uniqueDates]);

            const dayExpeditions = React.useMemo(() =>
                withDates.filter(e => e._day === selectedDate && (!farmFilter || ranchToFerme[e.ranch] === farmFilter)),
            [withDates, selectedDate, farmFilter]);

            // KPIs
            const nbLots = dayExpeditions.length;
            const nbPass = dayExpeditions.filter(e => (e.overallResult || '').toUpperCase() === 'PASS').length;
            const nbFail = dayExpeditions.filter(e => { const r = (e.overallResult || '').toUpperCase(); return r === 'FAIL' || r === 'REJECT'; }).length;
            const nonRejectExpeditions = dayExpeditions.filter(e => (e.overallResult || '').toUpperCase() !== 'REJECT');
            const avgPfq = nonRejectExpeditions.length > 0 ? (nonRejectExpeditions.reduce((s, e) => s + (e.pfqTotal || 0), 0) / nonRejectExpeditions.length).toFixed(1) : '-';
            const avgBrix = (() => {
                const withBrix = dayExpeditions.filter(e => e.brixFromDQR != null);
                return withBrix.length > 0 ? (withBrix.reduce((s, e) => s + e.brixFromDQR, 0) / withBrix.length).toFixed(1) : '-';
            })();

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🫐</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement des inspections...</div></div>;

            return (
                <div className="fade-in">
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8}}>
                        <div></div>
                        <div style={{display:'flex', gap:8, alignItems:'center'}}>
                            {refreshMsg && <span style={{fontSize:11, color:'var(--blue)'}}>{refreshMsg}</span>}
                            <button onClick={handleBulkBrixRefresh} disabled={refreshing}
                                style={{padding:'6px 14px', fontSize:11, fontWeight:600, border:'1px solid #9C27B0', background: refreshing ? '#f3e5f5' : 'white', color:'#9C27B0', borderRadius:8, cursor: refreshing ? 'wait' : 'pointer', display:'flex', alignItems:'center', gap:6}}>
                                <i className={`fa-solid ${refreshing ? 'fa-spinner fa-spin' : 'fa-flask'}`}></i>
                                Relecture Brix (Bulk)
                            </button>
                            <button onClick={loadExpeditions} disabled={loading}
                                style={{padding:'6px 14px', fontSize:11, fontWeight:600, border:'1px solid var(--gray-300)', background:'white', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', gap:6}}>
                                <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-refresh'}`}></i>
                                Rafraîchir
                            </button>
                        </div>
                    </div>
                    <div className="kpi-grid" style={{marginBottom: 16}}>
                        <KPICard icon="fa-calendar-day" iconClass="blue" value={selectedDate ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('fr-FR', {day:'numeric',month:'short',year:'numeric'}) : '-'} label="Date sélectionnée" />
                        <KPICard icon="fa-boxes-stacked" iconClass="purple" value={nbLots} label="Lots inspectés" />
                        <KPICard icon="fa-circle-check" iconClass="green" value={nbPass} label="Pass" />
                        <KPICard icon="fa-circle-xmark" iconClass="red" value={nbFail} label="Fail / Reject" />
                        <KPICard icon="fa-star" iconClass="orange" value={avgPfq} label="PFQ moyen" />
                        <KPICard icon="fa-lemon" iconClass="yellow" value={avgBrix} label="Brix moyen" />
                    </div>

                    <Panel title="Inspections du Jour - Détail par Lot" icon="fa-list-check" actions={
                        <select value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                            style={{padding:'6px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12,fontWeight:600}}>
                            {uniqueDates.map(d => <option key={d} value={d}>{new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', {weekday:'short',day:'numeric',month:'short',year:'numeric'})}</option>)}
                        </select>
                    }>
                        {dayExpeditions.length === 0 ? (
                            <div style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-inbox fa-2x" style={{marginBottom:12,display:'block'}}></i>
                                Aucune inspection pour cette date
                            </div>
                        ) : (
                        <div className="table-responsive">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Heure</th>
                                    <th>Receipt ID</th>
                                    <th>Batch Number</th>
                                    <th>Variété</th>
                                    <th>Ferme</th>
                                    <th>Qty</th>
                                    <th>Poids (kg)</th>
                                    <th>Brix</th>
                                    <th>Brix (Pts)</th>
                                    <th>PFQ Total</th>
                                    <th>Condition</th>
                                    <th>Apparence</th>
                                    <th>Résultat</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dayExpeditions.map((e, i) => {
                                    const isByPass = (e.inspectionType || '').toLowerCase().includes('by') && (e.inspectionType || '').toLowerCase().includes('pass');
                                    const condPct = (e.conditionDefects || []).reduce((s, d) => s + (d.percent || 0), 0);
                                    const appPct = (e.appearanceDefects || []).reduce((s, d) => s + (d.percent || 0), 0);
                                    const pfqTotal = e.pfqBrix != null ? (e.pfqCondition || 0) + (e.pfqApparence || 0) + (e.pfqBrix || 0) : (e.pfqTotal != null ? e.pfqTotal : null);
                                    const ferme = ranchToFerme[e.ranch] || e.ranch || '-';
                                    const byPassBadge = <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:'#e0f2f1',color:'#00695c'}}>By-Pass</span>;
                                    return (
                                    <tr key={i} onClick={() => setSelectedExp(e)} style={{cursor:'pointer'}}
                                        onMouseOver={ev => ev.currentTarget.style.background='rgba(139,34,82,0.04)'}
                                        onMouseOut={ev => ev.currentTarget.style.background=''}>
                                        <td style={{fontFamily:'monospace',fontSize:12,fontWeight:600,color:'var(--blue)'}}>{(() => { const raw = e.date || ''; const tm = raw.match(/(\d{2}:\d{2})/); return tm ? tm[1] : '-'; })()}</td>
                                        <td style={{fontFamily:'monospace',fontSize:12}}>{e.receiptId || '-'}</td>
                                        <td style={{fontFamily:'monospace',fontSize:11,color:'var(--gray-500)'}}>{e.batchNumber || '-'}</td>
                                        <td style={{fontWeight:500}}>{e.variety || '-'}</td>
                                        <td><span className="status-badge" style={{background:'var(--berry-pale)',color:'var(--berry)'}}>{ferme}</span></td>
                                        <td>{e.batchQuantity || '-'}</td>
                                        <td>{e.batchWeight ? e.batchWeight.toFixed(2) : '-'}</td>
                                        <td style={{fontWeight:600,color: (e.brixFromDQR || e.brix || 0) >= 8 ? 'var(--green)' : 'var(--orange)'}}>{isByPass ? byPassBadge : (e.brixFromDQR != null ? e.brixFromDQR : (e.brix || '-'))}</td>
                                        <td style={{fontWeight:600}}>{isByPass ? byPassBadge : (e.pfqBrix != null ? e.pfqBrix.toFixed(1) : '-')}</td>
                                        <td><strong>{isByPass ? byPassBadge : (pfqTotal != null ? pfqTotal.toFixed(1) : '-')}</strong></td>
                                        <td style={{color: condPct > 3 ? 'var(--red)' : 'var(--green)'}}>{isByPass ? byPassBadge : (e.pfqCondition != null ? e.pfqCondition.toFixed(1) : '-')}</td>
                                        <td style={{color: appPct > 5 ? 'var(--red)' : 'var(--green)'}}>{isByPass ? byPassBadge : (e.pfqApparence != null ? e.pfqApparence.toFixed(1) : '-')}</td>
                                        <td>
                                            <span className={`status-badge ${(e.overallResult || '').toUpperCase() === 'PASS' ? 'active' : 'danger'}`}
                                                style={(e.overallResult || '').toUpperCase() === 'REJECT' ? {background:'#e53935',color:'#fff',fontWeight:700} : {}}>
                                                {(e.overallResult || '').toUpperCase() === 'PASS' ? '✓ Pass' : ((e.overallResult || '').toUpperCase() === 'REJECT' ? '✕ REJECT' : '✕ Fail')}
                                            </span>
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr style={{background:'#f8f9fa',fontWeight:700}}>
                                    <td colSpan={5} style={{textAlign:'right',padding:'10px 8px',fontSize:13}}>Total</td>
                                    <td style={{padding:'10px 8px',fontSize:13}}>{dayExpeditions.filter(e => (e.overallResult||'').toUpperCase() !== 'REJECT').reduce((s,e) => s + (e.batchQuantity || 0), 0)}</td>
                                    <td style={{padding:'10px 8px',fontSize:13,color:'var(--berry)'}}>{dayExpeditions.filter(e => (e.overallResult||'').toUpperCase() !== 'REJECT').reduce((s,e) => s + (e.batchWeight || 0), 0).toFixed(1)} kg</td>
                                    <td colSpan={6}></td>
                                </tr>
                            </tfoot>
                        </table>
                        </div>
                        )}
                    </Panel>

                    {dayExpeditions.length > 0 && (() => {
                        // Build PFQ by variety per reception hour
                        const varietyColors = { 'Reyna': '#8B2252', 'Maravilla': '#2D8B4E', 'Maravilla Long Cane': '#1B6B3E', 'Adelita': '#D4A847', 'Kwanza': '#2196F3', 'Cadence': '#9C27B0', 'Grandeur': '#FF5722' };
                        const defaultColors = ['#8B2252', '#2D8B4E', '#D4A847', '#2196F3', '#9C27B0', '#FF5722', '#607D8B', '#E91E63'];
                        const parseHeure = (raw) => { const m = (raw || '').match(/(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : null; };
                        const allVarieties = [...new Set(dayExpeditions.map(e => e.variety).filter(Boolean))].sort();
                        // Group by hour, then by variety
                        const byHour = {};
                        dayExpeditions.forEach(e => {
                            const h = parseHeure(e.date);
                            if (!h) return;
                            if (!byHour[h]) byHour[h] = {};
                            const pfq = e.pfqBrix != null ? (e.pfqCondition || 0) + (e.pfqApparence || 0) + (e.pfqBrix || 0) : (e.pfqTotal || null);
                            if (pfq == null) return;
                            const v = e.variety || 'Inconnu';
                            if (!byHour[h][v]) byHour[h][v] = [];
                            byHour[h][v].push(pfq);
                        });
                        const hours = Object.keys(byHour).sort();
                        if (hours.length < 1) return null;
                        // Compute averages
                        const seriesData = {};
                        allVarieties.forEach(v => {
                            seriesData[v] = hours.map(h => {
                                const vals = (byHour[h] || {})[v];
                                return vals ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
                            });
                        });
                        const width = 700;
                        const height = 280;
                        const pad = { top: 30, right: 20, bottom: 40, left: 50 };
                        const pw = width - pad.left - pad.right;
                        const ph = height - pad.top - pad.bottom;
                        const allVals = Object.values(seriesData).flat().filter(v => v != null);
                        const minV = Math.max(0, Math.floor((Math.min(...allVals) - 5) / 10) * 10);
                        const maxV = Math.min(100, Math.ceil((Math.max(...allVals) + 5) / 10) * 10);
                        const range = maxV - minV || 1;
                        const getX = (i) => pad.left + (hours.length === 1 ? pw / 2 : i * pw / (hours.length - 1));
                        const getY = (val) => pad.top + ph - ((val - minV) / range) * ph;
                        return (
                            <Panel title="Évolution PFQ par Variété — par Heure de Réception" icon="fa-chart-line">
                                <div style={{display:'flex', gap:12, marginBottom:12, flexWrap:'wrap'}}>
                                    {allVarieties.map((v, vi) => {
                                        const color = varietyColors[v] || defaultColors[vi % defaultColors.length];
                                        return <span key={v} style={{display:'flex', alignItems:'center', gap:4, fontSize:12, fontWeight:600}}>
                                            <span style={{display:'inline-block', width:12, height:12, borderRadius:3, background:color}}></span>
                                            {v}
                                        </span>;
                                    })}
                                </div>
                                <svg viewBox={`0 0 ${width} ${height}`} style={{width:'100%', maxWidth:width, border:'1px solid var(--gray-200)', borderRadius:8, background:'#fafafa'}}>
                                    {/* Grid */}
                                    {Array.from({length: Math.floor(range / 10) + 1}, (_, i) => minV + i * 10).map(val => {
                                        const y = getY(val);
                                        return <g key={val}>
                                            <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="var(--gray-200)" strokeDasharray="4,4" />
                                            <text x={pad.left - 8} y={y + 4} fontSize="10" textAnchor="end" fill="var(--gray-400)">{val}</text>
                                        </g>;
                                    })}
                                    {/* Axes */}
                                    <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} stroke="var(--gray-300)" />
                                    <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} stroke="var(--gray-300)" />
                                    {/* Lines per variety */}
                                    {allVarieties.map((v, vi) => {
                                        const color = varietyColors[v] || defaultColors[vi % defaultColors.length];
                                        const points = seriesData[v].map((val, i) => val != null ? { x: getX(i), y: getY(val), val } : null);
                                        const segments = points.filter(p => p != null);
                                        const linePath = segments.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                                        return <g key={v}>
                                            {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />}
                                            {segments.map((p, i) => <g key={i}>
                                                <circle cx={p.x} cy={p.y} r="5" fill="#fff" stroke={color} strokeWidth="2" />
                                                <text x={p.x} y={p.y - 10} fontSize="10" textAnchor="middle" fill={color} fontWeight="700">{p.val.toFixed(1)}</text>
                                            </g>)}
                                        </g>;
                                    })}
                                    {/* X-axis labels (hours) */}
                                    {hours.map((h, i) => <text key={h} x={getX(i)} y={height - pad.bottom + 18} fontSize="11" textAnchor="middle" fill="var(--gray-600)" fontWeight="600">{h}</text>)}
                                    {/* Axis titles */}
                                    <text x={pad.left + 4} y={pad.top - 10} fontSize="11" fill="var(--gray-500)" fontWeight="600">PFQ Score</text>
                                    <text x={width / 2} y={height - 4} fontSize="11" textAnchor="middle" fill="var(--gray-500)" fontWeight="600">Heure de réception</text>
                                </svg>
                            </Panel>
                        );
                    })()}

                    <div style={{marginTop: 16, padding: 16, background: 'var(--berry-pale)', borderRadius: 12, fontSize: 12, color: 'var(--gray-600)'}}>
                        <strong><i className="fa-solid fa-circle-info" style={{marginRight: 6}}></i>Légende PFQ:</strong> Condition = Decay, Wet/Leaky, Overripe, Collapsed, Weak Cells, Sooty Mold, Yellow Rust |
                        Apparence = Broken, Green, Size, Skin Damage, Malformed, Attached Calyx, Foreign Bodies |
                        Seuils: Condition {'<'} 3% ✓ | Apparence {'<'} 5% ✓
                    </div>

                    {/* Quality Inspection Detail Modal */}
                    {selectedExp && (() => {
                        const _dfr = {'Decay':'Pourriture','Decay Mold':'Pourriture','Decay/Mold':'Pourriture','Wet Leaky':'Fruit saignant','Wet/Leaky':'Fruit saignant','Overripe':'Fruit trop mûr','Soft':'Fruit mou','Collapsed':'Fruit mou','Shriveled':'Fruit desséché','Weak Cells':'Cellules blanches','Sooty Mold':'Cladosporium','Yellow Rust':'Rouille jaune','Reversion':'Réversion','Insect/SWD':'Insecte/Drosophile','Wet/Bruising':'Meurtrissure humide','Dry Bruising':'Meurtrissure sèche','Mildew':'Mildiou','Green':'Immature','Size':'Calibre < 3g','Skin Damage':'Dégâts ravageurs','Broken':'Cassé','Malformed':'Déformation','Attached Calyx':'Avec pédoncule','Foreign Bodies':'Corps étrangers','Foreign bodies':'Corps étrangers','Bloom':'Bloom (pruine)','Stem Blossom':'Résidu floral','Condition':'Condition','Appearance':'Apparence'};
                        const trD = (n) => _dfr[n] || n;
                        const _bfr = {'BLUE':'Myrtille','RASP':'Framboise','STRAW':'Fraise','BLACK':'Mûre'};
                        const berryFr = (t) => { if (!t) return '-'; for (const [k,v] of Object.entries(_bfr)) if (t.toUpperCase().includes(k)) return v; return t; };
                        return (
                        <div className="modal-overlay" onClick={() => setSelectedExp(null)}>
                            <div className="modal-content" onClick={ev => ev.stopPropagation()} style={{maxWidth:720, maxHeight:'90vh', overflow:'auto', padding:0, borderRadius:12}}>
                                <div style={{background:'linear-gradient(135deg, #2d0a31 0%, #8B2252 100%)', padding:'20px 24px', color:'#fff', borderRadius:'12px 12px 0 0'}}>
                                    <div style={{fontSize:11, opacity:0.7, letterSpacing:1, marginBottom:4}}>DRISCOLL'S</div>
                                    <div style={{fontSize:20, fontWeight:300, fontStyle:'italic', marginBottom:12}}>Rapport d'Inspection Qualité</div>
                                    <div style={{display:'flex', alignItems:'center', gap:12}}>
                                        <span style={{padding:'4px 16px', borderRadius:6, fontSize:14, fontWeight:700,
                                            background: (selectedExp.overallResult || '').toUpperCase() === 'PASS' ? '#4caf50' : '#e53935',
                                            color:'#fff'}}>
                                            {(selectedExp.overallResult || '').toUpperCase() === 'PASS' ? '\u2714 CONFORME' : '\u2718 NON CONFORME'}
                                        </span>
                                        <span style={{fontSize:12, opacity:0.8}}>Inspection Initiale</span>
                                    </div>
                                </div>
                                <div style={{padding:'20px 24px'}}>
                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:0, marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                        <div style={{display:'grid', gridTemplateColumns:'auto 1fr'}}>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Fruit</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{berryFr(selectedExp.berryType || selectedExp.berryTypeFr)}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Variété</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.variety || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Article</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.itemDescription || selectedExp.item || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12}}>Ferme</div>
                                            <div style={{padding:'8px 12px', fontSize:12}}>{ranchToFerme[selectedExp.ranch] || selectedExp.ranch || '-'}{selectedExp.ranchName ? ` — ${selectedExp.ranchName}` : ''}</div>
                                        </div>
                                        <div style={{display:'grid', gridTemplateColumns:'auto 1fr', borderLeft:'1px solid #e0e0e0'}}>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Reçu</div>
                                            <div style={{padding:'8px 12px', fontSize:12, fontWeight:600, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.receiptId || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>N° Lot</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.batchNumber || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Licence</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.license || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Réception</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.date || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12}}>Inspecté</div>
                                            <div style={{padding:'8px 12px', fontSize:12}}>{selectedExp.inspectedDate || '-'}</div>
                                        </div>
                                    </div>

                                    {selectedExp.conditionDefects && selectedExp.conditionDefects.length > 0 && (
                                        <div style={{marginBottom:20}}>
                                            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                                                <thead>
                                                    <tr style={{background:'#f5f5f5'}}>
                                                        <th style={{padding:'8px 12px', textAlign:'left', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Attribut / Défaut</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Nb Fruits</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>%</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Points</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selectedExp.conditionDefects.map((d, j) => {
                                                        const isSummary = d.name === 'Condition' || d.name === 'Appearance';
                                                        return (
                                                            <tr key={j} style={{background: isSummary ? (d.name === 'Condition' ? '#e8f5e9' : '#fce4ec') : 'transparent'}}>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', fontWeight: isSummary ? 700 : 400}}>{trD(d.name)}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.count || 0}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.percent != null ? d.percent.toFixed(1) + '%' : '0.0%'}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.points || ''}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    <div style={{marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                        <div style={{background:'linear-gradient(135deg, #ce93d8, #ba68c8)', padding:'8px 16px', textAlign:'center', color:'#fff', fontWeight:700, fontSize:13}}>Saveur & Score PFQ</div>
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:0}}>
                                            <div style={{textAlign:'center', padding:'10px 6px', borderRight:'1px solid #e0e0e0'}}>
                                                <div style={{fontSize:10, color:'#888'}}>Degrés Brix</div>
                                                <div style={{fontSize:20, fontWeight:700, color:'#9C27B0'}}>{selectedExp.brixFromDQR != null ? selectedExp.brixFromDQR : (selectedExp.brix || '-')}</div>
                                            </div>
                                            <div style={{textAlign:'center', padding:'10px 6px', borderRight:'1px solid #e0e0e0'}}>
                                                <div style={{fontSize:10, color:'#888'}}>Points Brix</div>
                                                <div style={{fontSize:20, fontWeight:700, color: selectedExp.pfqBrix != null ? '#9C27B0' : '#ccc'}}>{selectedExp.pfqBrix != null ? selectedExp.pfqBrix.toFixed(1) : 'En attente'}</div>
                                            </div>
                                            <div style={{textAlign:'center', padding:'10px 6px', borderRight:'1px solid #e0e0e0'}}>
                                                <div style={{fontSize:10, color:'#888'}}>Condition + Apparence</div>
                                                <div style={{fontSize:20, fontWeight:700, color:'var(--dark)'}}>{((selectedExp.pfqCondition || 0) + (selectedExp.pfqApparence || 0)).toFixed(1)}</div>
                                                <div style={{fontSize:9, color:'#aaa'}}>{selectedExp.pfqCondition || 0} + {selectedExp.pfqApparence || 0}</div>
                                            </div>
                                            <div style={{textAlign:'center', padding:'10px 6px', background: selectedExp.pfqBrix != null ? 'rgba(76,175,80,0.08)' : 'rgba(255,152,0,0.06)'}}>
                                                <div style={{fontSize:10, color:'#888'}}>PFQ Total</div>
                                                {(() => {
                                                    const total = selectedExp.pfqBrix != null
                                                        ? (selectedExp.pfqCondition || 0) + (selectedExp.pfqApparence || 0) + (selectedExp.pfqBrix || 0)
                                                        : (selectedExp.pfqTotal || null);
                                                    return <div style={{fontSize:20, fontWeight:700, color: total != null ? (total >= 70 ? '#4caf50' : '#e53935') : '#ccc'}}>{total != null ? total.toFixed(1) : '-'}</div>;
                                                })()}
                                                <div style={{fontSize:9, color: selectedExp.pfqBrix != null ? '#4caf50' : '#ff9800'}}>{selectedExp.pfqBrix != null ? 'Brix inclus' : 'Brix en attente'}</div>
                                            </div>
                                        </div>
                                    </div>

                                    <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:16}}>
                                        <thead>
                                            <tr style={{background:'#f5f5f5'}}>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Poids Lot (kg)</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Qté Lot</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Échantillon</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Moy. Fruits/Barq.</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Poids Moy. Barq.</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Total Fruits Insp.</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.batchWeight ? selectedExp.batchWeight.toFixed(2) : '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.batchQuantity || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.sampleSize || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.avgFruitsPerPunnet || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.avgPunnetWeight || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.totalFruitInspected || '-'}</td>
                                            </tr>
                                        </tbody>
                                    </table>

                                    <div style={{textAlign:'right'}}>
                                        <button className="btn-secondary" onClick={() => setSelectedExp(null)}>Fermer</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );})()}
                </div>
            );
        }

export { QualiteInspectionsTab };
