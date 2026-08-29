/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: technique | Déclaration(s): MeteoAlertsDashboard */
import { fetchSprayData } from '../agronomie/fetchSprayData.jsx';
import { transformSprayData } from '../agronomie/transformSprayData.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { fetchMeteoblueData } from './fetchMeteoblueData.jsx';
import { transformMeteoblueData } from './transformMeteoblueData.jsx';

// ===================== DASHBOARD TAB =====================
        // ===================== METEO ALERTS DASHBOARD (Chef) =====================
        function MeteoAlertsDashboard({ farmFilter, onNavigateMeteo }) {
            const [meteoResult, setMeteoResult] = useState(null);
            const [sprayResult, setSprayResult] = useState(null);
            const [loading, setLoading] = useState(true);
            const [loadError, setLoadError] = useState(false);

            useEffect(() => {
                setLoading(true);
                setLoadError(false);
                Promise.all([
                    fetchMeteoblueData(farmFilter || 'F1'),
                    fetchSprayData(farmFilter || 'F1')
                ]).then(function(results) {
                    if (results[0]) setMeteoResult(transformMeteoblueData(results[0], farmFilter));
                    else setLoadError(true);
                    if (results[1]) setSprayResult(transformSprayData(results[1]));
                    setLoading(false);
                }).catch(function() { setLoadError(true); setLoading(false); });
            }, [farmFilter]);

            const [showMeteoPopup, setShowMeteoPopup] = useState(false);

            if (loading) return null;
            if (!meteoResult) {
                if (!loadError) return null;
                return (
                    <div style={{marginBottom:16,padding:'10px 18px',borderRadius:12,background:'rgba(231,76,60,0.05)',border:'1px solid rgba(231,76,60,0.25)',display:'flex',alignItems:'center',gap:10}}>
                        <i className="fa-solid fa-cloud-slash" style={{fontSize:16,color:'#e74c3c'}}></i>
                        <div>
                            <div style={{fontSize:12,fontWeight:700,color:'#e74c3c'}}>Météo temporairement indisponible</div>
                            <div style={{fontSize:10,color:'var(--gray-400)'}}>Quota API dépassé — contact admin pour renouveler</div>
                        </div>
                    </div>
                );
            }
            const { alertes, previsions, horaireParJour } = meteoResult;
            const today = previsions.find(p => p.isToday) || previsions[0];
            if (!today && alertes.length === 0) return null;

            // Données horaires pour le popup
            const todayHours = today ? (horaireParJour[today.dateISO] || []) : [];

            return (
                <div style={{marginBottom:16}}>
                    {/* Mini météo résumé - cliquable → popup */}
                    {today && (
                        <div onClick={() => setShowMeteoPopup(true)} style={{padding:'12px 18px', marginBottom: alertes.length > 0 || (sprayResult && sprayResult.jours) ? 10 : 0, borderRadius:12, background:'linear-gradient(135deg, #1a73e811, #4fc3f711)', border:'1px solid #1a73e833', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap', cursor:'pointer', transition:'all 0.2s'}}
                            onMouseEnter={e => { e.currentTarget.style.boxShadow='0 4px 16px rgba(26,115,232,0.15)'; e.currentTarget.style.borderColor='#1a73e866'; }}
                            onMouseLeave={e => { e.currentTarget.style.boxShadow=''; e.currentTarget.style.borderColor='#1a73e833'; }}>
                            <div style={{display:'flex',alignItems:'center',gap:10}}>
                                <i className={'fa-solid ' + today.icon} style={{fontSize:28, color: today.iconColor}}></i>
                                <div>
                                    <div style={{fontSize:11, color:'var(--gray-500)', fontWeight:500}}>{today.condition}</div>
                                    <div style={{fontSize:22, fontWeight:800, color:'var(--dark)'}}>{today.tMax}°<span style={{fontSize:14, color:'var(--gray-400)'}}>/{today.tMin}°</span></div>
                                </div>
                            </div>
                            {/* Mini prévisions 3 jours */}
                            <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                                {previsions.slice(1, 4).map((p, i) => (
                                    <div key={i} style={{textAlign:'center',fontSize:10}}>
                                        <div style={{color:'var(--gray-400)',fontWeight:600}}>{p.jourNom}</div>
                                        <i className={'fa-solid ' + p.icon} style={{fontSize:14,color:p.iconColor,margin:'2px 0',display:'block'}}></i>
                                        <div style={{fontWeight:700,color:'var(--dark)'}}>{p.tMax}°<span style={{color:'var(--gray-400)',fontWeight:400}}>/{p.tMin}°</span></div>
                                    </div>
                                ))}
                            </div>
                            <div style={{display:'flex',gap:16,flexWrap:'wrap',fontSize:11}}>
                                <span style={{color:'var(--blue)'}}><i className="fa-solid fa-droplet" style={{marginRight:3}}></i>{today.humidity}%</span>
                                <span style={{color: today.vent >= 25 ? 'var(--orange)' : 'var(--gray-500)'}}><i className="fa-solid fa-wind" style={{marginRight:3}}></i>{today.vent} km/h</span>
                                {today.precip > 0 && <span style={{color:'var(--blue)'}}><i className="fa-solid fa-cloud-rain" style={{marginRight:3}}></i>{today.precip} mm</span>}
                                <span style={{color: today.uv >= 9 ? 'var(--red)' : 'var(--gray-500)'}}><i className="fa-solid fa-sun" style={{marginRight:3}}></i>UV {today.uv}</span>
                            </div>
                            <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6}}>
                                <div style={{fontSize:10,color:'var(--gray-400)'}}>
                                    <i className="fa-solid fa-clock" style={{marginRight:3}}></i>Détail horaire
                                </div>
                                <i className="fa-solid fa-up-right-from-square" style={{fontSize:10,color:'var(--blue)'}}></i>
                            </div>
                        </div>
                    )}

                    {/* Popup météo heure par heure */}
                    {showMeteoPopup && today && (() => {
                        const dW = 720, dH = 200, dPad = {t:25, b:35, l:45, r:20};
                        const dXStep = todayHours.length > 1 ? (dW - dPad.l - dPad.r) / (todayHours.length - 1) : 0;
                        const dTempMin = todayHours.length ? Math.min(...todayHours.map(h => h.temp)) - 2 : 0;
                        const dTempMax = todayHours.length ? Math.max(...todayHours.map(h => h.temp)) + 2 : 40;
                        const dTempY = (v) => dPad.t + (dH - dPad.t - dPad.b) * (1 - (v - dTempMin) / (dTempMax - dTempMin || 1));
                        const dTempLine = todayHours.map((h, i) => (i===0?'M':'L') + (dPad.l + i*dXStep) + ',' + dTempY(h.temp)).join(' ');
                        const dHumLine = todayHours.map((h, i) => (i===0?'M':'L') + (dPad.l + i*dXStep) + ',' + (dPad.t + (dH - dPad.t - dPad.b) * (1 - h.humidity/100))).join(' ');

                        // Spray data for today
                        var todaySprayPopup = sprayResult && sprayResult.jours ? sprayResult.jours.find(function(j) { return j.isToday; }) : null;
                        var sprayWorkHours = todaySprayPopup ? todaySprayPopup.heures.filter(function(e) { return e.heure >= 6 && e.heure <= 20; }) : [];

                        return (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setShowMeteoPopup(false)}>
                            <div style={{background:'#fff',borderRadius:16,maxWidth:800,width:'100%',maxHeight:'90vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                {/* Header */}
                                <div style={{padding:'16px 24px',borderBottom:'2px solid var(--gray-100)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'linear-gradient(135deg, #1a73e808, #4fc3f708)'}}>
                                    <div style={{display:'flex',alignItems:'center',gap:14}}>
                                        <i className={'fa-solid ' + today.icon} style={{fontSize:32,color:today.iconColor}}></i>
                                        <div>
                                            <h3 style={{margin:0,fontSize:17,color:'var(--berry)'}}>Météo Aujourd'hui - {today.jourNom} {today.date}</h3>
                                            <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>{today.condition} | {today.tMin}° - {today.tMax}°</div>
                                        </div>
                                    </div>
                                    <button onClick={() => setShowMeteoPopup(false)} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'var(--gray-400)',padding:4}}>
                                        <i className="fa-solid fa-xmark"></i>
                                    </button>
                                </div>

                                {/* KPIs */}
                                <div style={{padding:'16px 24px',display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10}}>
                                    {[
                                        {icon:'fa-temperature-high',label:'Max',value:today.tMax+'°',color:today.tMax>=32?'var(--red)':'var(--dark)'},
                                        {icon:'fa-temperature-low',label:'Min',value:today.tMin+'°',color:today.tMin<=8?'var(--blue)':'var(--dark)'},
                                        {icon:'fa-droplet',label:'Humidité',value:today.humidity+'%',color:today.humidity<40?'var(--orange)':'var(--blue)'},
                                        {icon:'fa-wind',label:'Vent max',value:today.vent+' km/h',color:today.vent>=25?'var(--orange)':'var(--green)'},
                                        {icon:'fa-cloud-rain',label:'Pluie',value:today.precip+' mm',color:today.precip>5?'var(--blue)':'var(--gray-400)'},
                                        {icon:'fa-sun',label:'UV',value:today.uv,color:today.uv>=9?'var(--red)':'var(--green)'},
                                    ].map((k,i) => (
                                        <div key={i} style={{textAlign:'center',padding:10,background:'var(--gray-50)',borderRadius:10}}>
                                            <i className={'fa-solid '+k.icon} style={{fontSize:14,color:k.color,marginBottom:4,display:'block'}}></i>
                                            <div style={{fontSize:9,color:'var(--gray-400)',marginBottom:2}}>{k.label}</div>
                                            <div style={{fontSize:15,fontWeight:700,color:k.color}}>{k.value}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Courbe horaire */}
                                {todayHours.length > 1 && (
                                <div style={{padding:'0 24px 16px'}}>
                                    <div style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',marginBottom:8}}>
                                        <i className="fa-solid fa-chart-line" style={{marginRight:6,color:'var(--berry)'}}></i>Courbe horaire
                                    </div>
                                    <svg viewBox={'0 0 '+dW+' '+dH} style={{width:'100%',height:220}}>
                                        {[0,1,2,3,4].map(i => {
                                            const y = dPad.t + i*(dH-dPad.t-dPad.b)/4;
                                            const val = Math.round(dTempMax - i*(dTempMax-dTempMin)/4);
                                            return <g key={i}><line x1={dPad.l} y1={y} x2={dW-dPad.r} y2={y} stroke="var(--gray-100)" strokeWidth="1"/><text x={dPad.l-6} y={y+4} textAnchor="end" fontSize="9" fill="var(--gray-400)">{val}°</text></g>;
                                        })}
                                        <path d={dTempLine} fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                        <path d={dHumLine} fill="none" stroke="var(--blue)" strokeWidth="2" strokeDasharray="4,3" strokeLinecap="round"/>
                                        {todayHours.map((h,i) => (
                                            <g key={i}>
                                                <circle cx={dPad.l+i*dXStep} cy={dTempY(h.temp)} r="4" fill="var(--red)" stroke="white" strokeWidth="2"/>
                                                <text x={dPad.l+i*dXStep} y={dTempY(h.temp)-10} textAnchor="middle" fontSize="9" fill="var(--red)" fontWeight="600">{h.temp}°</text>
                                                <text x={dPad.l+i*dXStep} y={dH-8} textAnchor="middle" fontSize="8" fill="var(--gray-400)">{h.heure}</text>
                                            </g>
                                        ))}
                                        <circle cx={dW-170} cy={12} r="4" fill="var(--red)"/><text x={dW-162} y={16} fontSize="9" fill="var(--gray-600)">Température</text>
                                        <line x1={dW-85} y1={12} x2={dW-65} y2={12} stroke="var(--blue)" strokeWidth="2" strokeDasharray="4,3"/><text x={dW-61} y={16} fontSize="9" fill="var(--gray-600)">Humidité</text>
                                    </svg>
                                </div>
                                )}

                                {/* Spray timeline dans le popup */}
                                {sprayWorkHours.length > 0 && (
                                <div style={{padding:'0 24px 16px'}}>
                                    <div style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',marginBottom:8}}>
                                        <i className="fa-solid fa-spray-can-sparkles" style={{marginRight:6,color:'var(--green)'}}></i>Fenêtre de traitement phyto
                                    </div>
                                    <div style={{display:'flex',gap:2,marginBottom:4}}>
                                        {sprayWorkHours.map(function(h, hi) {
                                            var bg = h.value === 1 ? '#27ae60' : (h.value === 2 ? '#f39c12' : '#e74c3c');
                                            var opacity = h.value === 1 ? 0.85 : (h.value === 2 ? 0.6 : 0.4);
                                            var label = h.value === 1 ? 'OK' : (h.value === 2 ? '~' : 'X');
                                            return (
                                                <div key={hi} style={{flex:1,textAlign:'center',borderRadius:4,background:bg,opacity:opacity,padding:'6px 0',fontSize:9,color:'white',fontWeight:700}} title={h.heure + 'h - ' + (h.value===1?'Favorable':h.value===2?'Modéré':'Défavorable')}>
                                                    <div>{h.heure}h</div>
                                                    <div style={{fontSize:11}}>{label}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div style={{display:'flex',gap:12,justifyContent:'center',marginTop:6}}>
                                        <span style={{fontSize:9,display:'flex',alignItems:'center',gap:3}}><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:'#27ae60',opacity:0.85}}></span>Favorable</span>
                                        <span style={{fontSize:9,display:'flex',alignItems:'center',gap:3}}><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:'#f39c12',opacity:0.6}}></span>Modéré</span>
                                        <span style={{fontSize:9,display:'flex',alignItems:'center',gap:3}}><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:'#e74c3c',opacity:0.4}}></span>Défavorable</span>
                                    </div>
                                </div>
                                )}

                                {/* Tableau horaire */}
                                <div style={{padding:'0 24px 20px'}}>
                                    <div style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',marginBottom:8}}>
                                        <i className="fa-solid fa-clock" style={{marginRight:6,color:'var(--berry)'}}></i>Détail heure par heure
                                    </div>
                                    <div style={{overflowX:'auto'}}>
                                    <table className="data-table" style={{fontSize:11,width:'100%'}}>
                                        <thead>
                                            <tr>
                                                <th>Heure</th>
                                                <th style={{textAlign:'center'}}>Ciel</th>
                                                <th style={{textAlign:'right'}}>Temp.</th>
                                                <th style={{textAlign:'right'}}>Ressenti</th>
                                                <th style={{textAlign:'right'}}>Humidité</th>
                                                <th style={{textAlign:'right'}}>Vent</th>
                                                <th style={{textAlign:'right'}}>Pluie</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {todayHours.map((h,i) => (
                                                <tr key={i} style={{background: h.temp >= 32 ? 'rgba(231,76,60,0.05)' : (h.precip > 0 ? 'rgba(52,152,219,0.05)' : '')}}>
                                                    <td style={{fontWeight:600,fontFamily:'monospace'}}>{h.heure}</td>
                                                    <td style={{textAlign:'center'}}><i className={'fa-solid '+h.icon} style={{fontSize:14,color:h.icon==='fa-moon'?'#7f8c8d':today.iconColor}}></i></td>
                                                    <td style={{textAlign:'right',fontWeight:700,color:h.temp>=32?'var(--red)':(h.temp<=10?'var(--blue)':'var(--dark)')}}>{h.temp}°C</td>
                                                    <td style={{textAlign:'right',color:'var(--gray-500)'}}>{h.feltTemp}°C</td>
                                                    <td style={{textAlign:'right'}}>
                                                        <span style={{color:h.humidity>=80?'var(--blue)':(h.humidity<40?'var(--orange)':'var(--gray-600)')}}>{h.humidity}%</span>
                                                    </td>
                                                    <td style={{textAlign:'right',color:h.vent>=25?'var(--orange)':'var(--gray-600)'}}>{h.vent} km/h</td>
                                                    <td style={{textAlign:'right',color:h.precip>0?'var(--blue)':'var(--gray-300)'}}>{h.precip > 0 ? h.precip+' mm' : '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    </div>
                                    {todayHours.length === 0 && <div style={{textAlign:'center',padding:20,color:'var(--gray-400)',fontSize:12}}>Pas de données horaires disponibles</div>}
                                </div>

                                {/* Lien vers onglet Météo complet */}
                                <div style={{padding:'12px 24px',borderTop:'1px solid var(--gray-100)',textAlign:'center'}}>
                                    <button onClick={function() { setShowMeteoPopup(false); if (onNavigateMeteo) onNavigateMeteo(); }} style={{background:'none',border:'1px solid var(--berry)',color:'var(--berry)',padding:'8px 20px',borderRadius:8,fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                        <i className="fa-solid fa-cloud-sun" style={{marginRight:6}}></i>Voir prévisions 7 jours complètes
                                    </button>
                                </div>
                            </div>
                        </div>
                        );
                    })()}
                    {/* Fenêtre de traitement phyto du jour */}
                    {sprayResult && sprayResult.jours && (() => {
                        var todaySpray = sprayResult.jours.find(function(j) { return j.isToday; }) || sprayResult.jours[0];
                        if (!todaySpray) return null;
                        var scoreColor = todaySpray.score >= 70 ? '#27ae60' : (todaySpray.score >= 40 ? '#f39c12' : '#e74c3c');
                        var scoreBg = todaySpray.score >= 70 ? 'rgba(39,174,96,0.08)' : (todaySpray.score >= 40 ? 'rgba(243,156,18,0.08)' : 'rgba(231,76,60,0.08)');
                        var scoreBorder = todaySpray.score >= 70 ? 'rgba(39,174,96,0.3)' : (todaySpray.score >= 40 ? 'rgba(243,156,18,0.3)' : 'rgba(231,76,60,0.3)');
                        var scoreLabel = todaySpray.score >= 70 ? 'Favorable' : (todaySpray.score >= 40 ? 'Partiel' : 'Défavorable');
                        var workHours = todaySpray.heures.filter(function(e) { return e.heure >= 6 && e.heure <= 20; });
                        return (
                            <div onClick={onNavigateMeteo} style={{padding:'12px 18px', marginBottom:10, borderRadius:12, background:scoreBg, border:'1.5px solid ' + scoreBorder, display:'flex', alignItems:'center', gap:14, cursor:'pointer', transition:'all 0.2s'}}
                                onMouseEnter={function(e) { e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.1)'; }}
                                onMouseLeave={function(e) { e.currentTarget.style.boxShadow=''; }}>
                                <div style={{textAlign:'center',minWidth:56}}>
                                    <i className="fa-solid fa-spray-can-sparkles" style={{fontSize:16,color:scoreColor,marginBottom:4,display:'block'}}></i>
                                    <div style={{fontSize:20,fontWeight:800,color:scoreColor}}>{todaySpray.score}%</div>
                                    <div style={{fontSize:8,color:scoreColor,fontWeight:700}}>{scoreLabel}</div>
                                </div>
                                <div style={{flex:1}}>
                                    <div style={{fontSize:12,fontWeight:700,color:'var(--dark)',marginBottom:6}}>Traitement Phyto</div>
                                    {/* Mini timeline */}
                                    <div style={{display:'flex',gap:1,marginBottom:6}}>
                                        {workHours.map(function(h, hi) {
                                            var bg = h.value === 1 ? '#27ae60' : (h.value === 2 ? '#f39c12' : '#e74c3c');
                                            var opacity = h.value === 1 ? 0.8 : (h.value === 2 ? 0.6 : 0.4);
                                            return React.createElement('div', {key: hi, title: h.heure + 'h', style: {flex:1, height:10, borderRadius:2, background:bg, opacity:opacity}});
                                        })}
                                    </div>
                                    <div style={{display:'flex',justifyContent:'space-between',fontSize:8,color:'var(--gray-400)'}}>
                                        <span>6h</span><span>13h</span><span>20h</span>
                                    </div>
                                    {todaySpray.fenetres.length > 0 ? (
                                        <div style={{fontSize:10,color:'var(--gray-600)',marginTop:4}}>
                                            <i className="fa-solid fa-clock" style={{marginRight:3,color:scoreColor}}></i>
                                            Créneaux : {todaySpray.fenetres.map(function(f) { return f.de + 'h-' + f.a + 'h'; }).join(', ')}
                                        </div>
                                    ) : (
                                        <div style={{fontSize:10,color:'#e74c3c',marginTop:4}}>
                                            <i className="fa-solid fa-ban" style={{marginRight:3}}></i>Aucun créneau favorable
                                        </div>
                                    )}
                                </div>
                                <div style={{display:'flex',alignItems:'center',gap:4}}>
                                    <span style={{fontSize:9,color:'var(--gray-400)'}}>Détail</span>
                                    <i className="fa-solid fa-arrow-right" style={{fontSize:10,color:scoreColor}}></i>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Alertes */}
                    {alertes.map((a, i) => (
                        <div key={i} onClick={onNavigateMeteo} style={{padding:'10px 16px', marginBottom:8, borderRadius:10, cursor:'pointer', background: a.niveau==='danger' ? 'rgba(231,76,60,0.06)' : 'rgba(243,156,18,0.06)', border: '1.5px solid ' + (a.niveau==='danger' ? 'var(--red)' : 'var(--orange)'), display:'flex', alignItems:'center', gap:12, transition:'all 0.2s'}}
                            onMouseEnter={e => { e.currentTarget.style.boxShadow='0 3px 12px rgba(0,0,0,0.08)'; }}
                            onMouseLeave={e => { e.currentTarget.style.boxShadow=''; }}>
                            <div style={{width:32, height:32, borderRadius:8, background: a.niveau==='danger' ? 'var(--red)' : 'var(--orange)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                                <i className={'fa-solid ' + a.icon} style={{color:'white', fontSize:14}}></i>
                            </div>
                            <div style={{flex:1}}>
                                <span style={{fontWeight:700, fontSize:12, color: a.niveau==='danger' ? 'var(--red)' : 'var(--orange)'}}>{a.titre}</span>
                                <span style={{fontSize:11, color:'var(--gray-500)', marginLeft:8}}>{a.message}</span>
                            </div>
                            <span style={{fontSize:11, fontWeight:700, color:'var(--gray-600)', whiteSpace:'nowrap'}}>{a.jours}</span>
                            <i className="fa-solid fa-arrow-right" style={{fontSize:10,color:'var(--gray-300)'}}></i>
                        </div>
                    ))}
                </div>
            );
        }

export { MeteoAlertsDashboard };
