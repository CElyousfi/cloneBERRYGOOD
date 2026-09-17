/* Module: technique | Déclaration(s): MeteoHistory7d */
import { Panel } from '../shared/Panel.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== METEO HISTORY 7D (Firestore meteo_outdoor) =====================
        function MeteoHistory7d({ ferme, fermeInfo }) {
            const [days, setDays] = useState(null); // array sorted asc by date
            const [loading, setLoading] = useState(true);
            const [showPopup, setShowPopup] = useState(false);

            useEffect(() => {
                let cancelled = false;
                setLoading(true);
                (async () => {
                    try {
                        if (typeof firebase === 'undefined' || !firebase.firestore) { setDays([]); setLoading(false); return; }
                        const db = firebase.firestore();
                        const today = new Date();
                        const dates = [];
                        for (let i = 6; i >= 0; i--) {
                            const d = new Date(today); d.setDate(d.getDate() - i);
                            dates.push(d.toISOString().slice(0, 10));
                        }
                        const ids = dates.map(d => `${d}_${ferme}`);
                        const snaps = await Promise.all(ids.map(id => db.collection('meteo_outdoor').doc(id).get()));
                        const result = snaps.map((s, i) => s.exists ? { date: dates[i], ...s.data() } : { date: dates[i], missing: true });
                        if (!cancelled) { setDays(result); setLoading(false); }
                    } catch (e) {
                        console.warn('MeteoHistory7d fetch error:', e);
                        if (!cancelled) { setDays([]); setLoading(false); }
                    }
                })();
                return () => { cancelled = true; };
            }, [ferme]);

            if (loading) return null;
            if (!days || days.length === 0) return null;
            const valid = days.filter(d => !d.missing && d.tmax != null);
            if (valid.length === 0) return (
                <Panel title="Historique météo - 7 derniers jours" icon="fa-clock-rotate-left">
                    <div style={{padding:20, textAlign:'center', color:'var(--gray-400)', fontSize:13}}>
                        <i className="fa-solid fa-circle-info" style={{marginRight:6}}></i>
                        Aucun historique disponible pour {ferme}. Les données s'accumuleront à partir d'aujourd'hui.
                    </div>
                </Panel>
            );

            // Sparkline geometry
            const W = 700, H = 90, pad = { t: 12, b: 18, l: 30, r: 10 };
            const xStep = days.length > 1 ? (W - pad.l - pad.r) / (days.length - 1) : 0;
            const tmaxArr = days.map(d => d.tmax).filter(v => v != null);
            const tminArr = days.map(d => d.tmin).filter(v => v != null);
            const allT = tmaxArr.concat(tminArr);
            const tMin = allT.length ? Math.min(...allT) - 2 : 0;
            const tMax = allT.length ? Math.max(...allT) + 2 : 40;
            const tY = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - tMin) / (tMax - tMin || 1));
            const buildLine = (key) => {
                const pts = [];
                days.forEach((d, i) => {
                    if (d[key] == null) return;
                    pts.push((pts.length === 0 ? 'M' : 'L') + (pad.l + i * xStep) + ',' + tY(d[key]));
                });
                return pts.join(' ');
            };
            const tmaxLine = buildLine('tmax');
            const tminLine = buildLine('tmin');

            // Precip bars geometry
            const precipMax = Math.max(5, ...days.map(d => d.precip || 0));
            const precipBarW = Math.max(8, xStep * 0.4);

            const fmtDay = (dateStr) => {
                const d = new Date(dateStr + 'T12:00:00');
                return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit' });
            };

            return (
                <React.Fragment>
                    <Panel title="Historique météo - 7 derniers jours" icon="fa-clock-rotate-left" actions={
                        <button onClick={() => setShowPopup(true)} style={{padding:'6px 12px', fontSize:11, fontWeight:600, background:'var(--berry-pale)', color:'var(--berry)', border:'none', borderRadius:8, cursor:'pointer'}}>
                            <i className="fa-solid fa-table" style={{marginRight:5}}></i>Voir détail
                        </button>
                    }>
                        <div onClick={() => setShowPopup(true)} style={{cursor:'pointer'}} title="Cliquer pour voir le tableau détaillé">
                            <div style={{fontSize:11, color:'var(--gray-500)', marginBottom:6, display:'flex', gap:14, alignItems:'center'}}>
                                <span><i className="fa-solid fa-temperature-high" style={{color:'var(--red)', marginRight:4}}></i>T° Max</span>
                                <span><i className="fa-solid fa-temperature-low" style={{color:'var(--blue)', marginRight:4}}></i>T° Min</span>
                                <span><i className="fa-solid fa-cloud-rain" style={{color:'#4fc3f7', marginRight:4}}></i>Pluie (mm)</span>
                            </div>
                            <svg viewBox={'0 0 ' + W + ' ' + H} style={{width:'100%', height:120}}>
                                {/* Grid */}
                                {[0,1,2,3].map(i => {
                                    const y = pad.t + i * (H - pad.t - pad.b) / 3;
                                    const val = Math.round(tMax - i * (tMax - tMin) / 3);
                                    return <g key={'g'+i}>
                                        <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="var(--gray-100)" strokeWidth="1"/>
                                        <text x={pad.l - 4} y={y + 3} textAnchor="end" fontSize="9" fill="var(--gray-400)">{val}°</text>
                                    </g>;
                                })}
                                {/* Precip bars */}
                                {days.map((d, i) => {
                                    if (!d.precip || d.precip <= 0) return null;
                                    const cx = pad.l + i * xStep;
                                    const hBar = (H - pad.t - pad.b) * (d.precip / precipMax) * 0.5;
                                    return <rect key={'p'+i} x={cx - precipBarW/2} y={H - pad.b - hBar} width={precipBarW} height={hBar} fill="#4fc3f7" opacity="0.5" rx="2"/>;
                                })}
                                {/* Tmin line */}
                                {tminLine && <path d={tminLine} fill="none" stroke="var(--blue)" strokeWidth="2"/>}
                                {/* Tmax line */}
                                {tmaxLine && <path d={tmaxLine} fill="none" stroke="var(--red)" strokeWidth="2"/>}
                                {/* Points */}
                                {days.map((d, i) => {
                                    const cx = pad.l + i * xStep;
                                    return <g key={'pt'+i}>
                                        {d.tmax != null && <circle cx={cx} cy={tY(d.tmax)} r="3" fill="var(--red)"/>}
                                        {d.tmin != null && <circle cx={cx} cy={tY(d.tmin)} r="3" fill="var(--blue)"/>}
                                        <text x={cx} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--gray-500)" fontWeight={d.date === days[days.length-1].date ? 700 : 400}>{fmtDay(d.date)}</text>
                                    </g>;
                                })}
                            </svg>
                        </div>
                    </Panel>

                    {showPopup && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setShowPopup(false)}>
                            <div style={{background:'#fff',borderRadius:16,maxWidth:900,width:'100%',maxHeight:'90vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{padding:'16px 24px',borderBottom:'2px solid var(--gray-100)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'linear-gradient(135deg, #1a73e808, #4fc3f708)'}}>
                                    <div style={{display:'flex',alignItems:'center',gap:14}}>
                                        <i className="fa-solid fa-clock-rotate-left" style={{fontSize:24,color:'var(--berry)'}}></i>
                                        <div>
                                            <h3 style={{margin:0,fontSize:17,color:'var(--berry)'}}>Historique météo - 7 derniers jours</h3>
                                            <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>{fermeInfo.nom} | Source: Open-Meteo (extérieur)</div>
                                        </div>
                                    </div>
                                    <button onClick={() => setShowPopup(false)} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'var(--gray-400)',padding:4}}>
                                        <i className="fa-solid fa-xmark"></i>
                                    </button>
                                </div>
                                <div style={{padding:'16px 24px', overflowX:'auto'}}>
                                    <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
                                        <thead>
                                            <tr style={{background:'var(--gray-50)', borderBottom:'2px solid var(--gray-100)'}}>
                                                <th style={{textAlign:'left', padding:'10px 8px', fontWeight:700, color:'var(--gray-600)'}}>Jour</th>
                                                <th style={{textAlign:'right', padding:'10px 8px', fontWeight:700, color:'var(--gray-600)'}}>T° Max</th>
                                                <th style={{textAlign:'right', padding:'10px 8px', fontWeight:700, color:'var(--gray-600)'}}>T° Min</th>
                                                <th style={{textAlign:'right', padding:'10px 8px', fontWeight:700, color:'var(--gray-600)'}}>Humidité</th>
                                                <th style={{textAlign:'right', padding:'10px 8px', fontWeight:700, color:'var(--gray-600)'}}>Pluie</th>
                                                <th style={{textAlign:'right', padding:'10px 8px', fontWeight:700, color:'var(--gray-600)'}}>Vent max</th>
                                                <th style={{textAlign:'right', padding:'10px 8px', fontWeight:700, color:'var(--gray-600)'}}>ETo</th>
                                                <th style={{textAlign:'right', padding:'10px 8px', fontWeight:700, color:'var(--gray-600)'}}>Radiation</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {days.slice().reverse().map((d, i) => {
                                                const dt = new Date(d.date + 'T12:00:00');
                                                const lbl = dt.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'short' });
                                                if (d.missing) return (
                                                    <tr key={i} style={{borderBottom:'1px solid var(--gray-50)', color:'var(--gray-400)'}}>
                                                        <td style={{padding:'10px 8px'}}>{lbl}</td>
                                                        <td colSpan="7" style={{padding:'10px 8px', textAlign:'center', fontStyle:'italic'}}>Pas de données</td>
                                                    </tr>
                                                );
                                                const fmt = (v, suf, dec) => v == null ? '—' : (dec ? v.toFixed(dec) : Math.round(v)) + (suf || '');
                                                return (
                                                    <tr key={i} style={{borderBottom:'1px solid var(--gray-50)'}}>
                                                        <td style={{padding:'10px 8px', fontWeight:600, color:'var(--dark)'}}>{lbl}</td>
                                                        <td style={{padding:'10px 8px', textAlign:'right', color: d.tmax >= 32 ? 'var(--red)' : 'var(--dark)', fontWeight:600}}>{fmt(d.tmax, '°C', 1)}</td>
                                                        <td style={{padding:'10px 8px', textAlign:'right', color: d.tmin <= 8 ? 'var(--blue)' : 'var(--dark)', fontWeight:600}}>{fmt(d.tmin, '°C', 1)}</td>
                                                        <td style={{padding:'10px 8px', textAlign:'right'}}>{fmt(d.humidity, '%')}</td>
                                                        <td style={{padding:'10px 8px', textAlign:'right', color: (d.precip > 0 ? 'var(--blue)' : 'var(--gray-400)'), fontWeight: d.precip > 0 ? 600 : 400}}>{fmt(d.precip, ' mm', 1)}</td>
                                                        <td style={{padding:'10px 8px', textAlign:'right'}}>{fmt(d.wind, ' km/h')}</td>
                                                        <td style={{padding:'10px 8px', textAlign:'right'}}>{fmt(d.eto, ' mm/j', 1)}</td>
                                                        <td style={{padding:'10px 8px', textAlign:'right'}}>{fmt(d.radiation, ' MJ/m²', 1)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </React.Fragment>
            );
        }

export { MeteoHistory7d };
