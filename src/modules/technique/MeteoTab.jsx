/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: technique | Déclaration(s): MeteoTab */
import { fetchSprayData } from '../agronomie/fetchSprayData.jsx';
import { transformSprayData } from '../agronomie/transformSprayData.jsx';
import { Panel } from '../shared/Panel.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { MeteoHistory7d } from './MeteoHistory7d.jsx';
import { MeteoPrevisionExterieure } from './MeteoPrevisionExterieure.jsx';
import { fetchMeteoblueData } from './fetchMeteoblueData.jsx';
import { meteoFermes } from './meteoFermes.jsx';
import { transformMeteoblueData } from './transformMeteoblueData.jsx';

// ===================== METEO TAB (API Meteoblue) =====================
        function MeteoTab({ data, farmFilter }) {
            const [meteoResult, setMeteoResult] = useState(null);
            const [loading, setLoading] = useState(true);
            const [error, setError] = useState(null);
            const [selectedDay, setSelectedDay] = useState(null);
            const [sprayData, setSprayData] = useState(null);
            const ferme = farmFilter || 'F1';
            const fermeInfo = meteoFermes[ferme] || meteoFermes.F1;

            useEffect(() => {
                setLoading(true); setError(null);
                Promise.all([fetchMeteoblueData(ferme), fetchSprayData(ferme)]).then(function(results) {
                    var apiData = results[0];
                    var sprayApiData = results[1];
                    if (apiData) {
                        var result = transformMeteoblueData(apiData, ferme);
                        setMeteoResult(result);
                    } else {
                        setError('Impossible de charger les données météo');
                    }
                    if (sprayApiData) {
                        setSprayData(transformSprayData(sprayApiData));
                    }
                    setLoading(false);
                }).catch(function(e) { setError(e.message); setLoading(false); });
            }, [ferme]);

            if (loading) return <div style={{textAlign:'center',padding:60}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:32,color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--gray-400)'}}>Chargement météo Meteoblue...</div></div>;
            if (error || !meteoResult) return <div style={{textAlign:'center',padding:60}}><i className="fa-solid fa-triangle-exclamation" style={{fontSize:32,color:'var(--red)'}}></i><div style={{marginTop:12,color:'var(--gray-500)'}}>{error || 'Erreur de chargement'}</div></div>;

            const { previsions, horaire, horaireParJour, alertes } = meteoResult;
            const today = previsions.find(p => p.isToday) || previsions[0];
            if (!today) return <div style={{textAlign:'center',padding:60,color:'var(--gray-400)'}}>Aucune donnée météo disponible</div>;

            // SVG courbe température horaire
            const tempChartW = 700;
            const tempChartH = 180;
            const tempPad = { t: 20, b: 30, l: 40, r: 20 };
            const hasHoraire = horaire.length > 1;
            const tempXStep = hasHoraire ? (tempChartW - tempPad.l - tempPad.r) / (horaire.length - 1) : 0;
            const tempMin = hasHoraire ? Math.min(...horaire.map(h => h.temp)) - 2 : 0;
            const tempMax = hasHoraire ? Math.max(...horaire.map(h => h.temp)) + 2 : 40;
            const tempY = (v) => tempPad.t + (tempChartH - tempPad.t - tempPad.b) * (1 - (v - tempMin) / (tempMax - tempMin || 1));
            const tempLine = hasHoraire ? horaire.map((h, i) => (i===0?'M':'L') + (tempPad.l + i*tempXStep) + ',' + tempY(h.temp)).join(' ') : '';
            const humLine = hasHoraire ? horaire.map((h, i) => (i===0?'M':'L') + (tempPad.l + i*tempXStep) + ',' + (tempPad.t + (tempChartH - tempPad.t - tempPad.b) * (1 - h.humidity/100))).join(' ') : '';

            // Prévision 7 jours mini chart
            const prevChartW = 700;
            const prevChartH = 120;
            const prevXStep = previsions.length > 1 ? (prevChartW - 80) / (previsions.length - 1) : 0;

            return (
                <div className="fade-in">
                    {/* Alertes climatiques */}
                    {alertes.length > 0 && (
                        <div style={{marginBottom:20}}>
                            {alertes.map((a, i) => (
                                <div key={i} style={{padding:'14px 18px', marginBottom:10, borderRadius:12, background: a.niveau==='danger' ? 'rgba(231,76,60,0.08)' : 'rgba(243,156,18,0.08)', border: '2px solid ' + (a.niveau==='danger' ? 'var(--red)' : 'var(--orange)'), display:'flex', alignItems:'flex-start', gap:14}}>
                                    <div style={{width:40, height:40, borderRadius:10, background: a.niveau==='danger' ? 'var(--red)' : 'var(--orange)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                                        <i className={'fa-solid ' + a.icon} style={{color:'white', fontSize:18}}></i>
                                    </div>
                                    <div style={{flex:1}}>
                                        <div style={{fontWeight:700, fontSize:13, color: a.niveau==='danger' ? 'var(--red)' : 'var(--orange)', marginBottom:2}}>
                                            {a.titre}
                                        </div>
                                        <div style={{fontSize:12, color:'var(--gray-600)', lineHeight:1.5}}>{a.message}</div>
                                        <div style={{fontSize:10, color:'var(--gray-400)', marginTop:4}}>
                                            <i className="fa-solid fa-calendar" style={{marginRight:4}}></i>Jours: {a.jours}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Prévision extérieure (24h, J-1/J/J+1) */}
                    <MeteoPrevisionExterieure ferme={ferme} fermeInfo={fermeInfo} meteoResult={meteoResult} />

                    {/* Météo actuelle */}
                    <Panel title={'Météo Aujourd\'hui - ' + fermeInfo.nom} icon="fa-cloud-sun">
                        <div style={{display:'flex', gap:4, marginBottom:12, flexWrap:'wrap'}}>
                            <span style={{fontSize:10, padding:'3px 8px', borderRadius:8, background:'var(--berry-pale)', color:'var(--berry)', fontWeight:600}}>
                                <i className="fa-solid fa-location-dot" style={{marginRight:3}}></i>{fermeInfo.lat}°N, {Math.abs(fermeInfo.lon)}°O
                            </span>
                            <span style={{fontSize:10, padding:'3px 8px', borderRadius:8, background:'var(--blue-pale)', color:'var(--blue)', fontWeight:600}}>
                                <i className="fa-solid fa-mountain" style={{marginRight:3}}></i>{fermeInfo.altitude}m
                            </span>
                            <span style={{fontSize:10, padding:'3px 8px', borderRadius:8, background:'var(--green-pale)', color:'var(--green)', fontWeight:600}}>
                                <i className="fa-solid fa-map-pin" style={{marginRight:3}}></i>{fermeInfo.region}
                            </span>
                            <span style={{fontSize:10, padding:'3px 8px', borderRadius:8, background:'rgba(243,156,18,0.1)', color:'var(--orange)', fontWeight:600}}>
                                <i className="fa-solid fa-satellite-dish" style={{marginRight:3}}></i>Meteoblue API (temps réel)
                            </span>
                        </div>
                        <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:24, alignItems:'center'}}>
                            <div style={{textAlign:'center', padding:'10px 30px'}}>
                                <i className={'fa-solid ' + today.icon} style={{fontSize:56, color: today.iconColor, marginBottom:8, display:'block'}}></i>
                                <div style={{fontSize:11, color:'var(--gray-500)', fontWeight:500}}>{today.condition}</div>
                                <div style={{fontSize:36, fontWeight:800, color:'var(--dark)', marginTop:4}}>{today.tMax}°<span style={{fontSize:20, color:'var(--gray-400)'}}>/{today.tMin}°</span></div>
                            </div>
                            <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12}}>
                                {[
                                    { icon:'fa-droplet', label:'Humidité', value: today.humidity + '%', color: today.humidity < 40 ? 'var(--orange)' : 'var(--blue)' },
                                    { icon:'fa-wind', label:'Vent', value: today.vent + ' km/h ' + today.ventDir, color: today.vent >= 25 ? 'var(--orange)' : 'var(--green)' },
                                    { icon:'fa-cloud-rain', label:'Précipitations', value: today.precip + ' mm', color: today.precip > 5 ? 'var(--blue)' : 'var(--gray-400)' },
                                    { icon:'fa-sun', label:'Indice UV', value: today.uv, color: today.uv >= 9 ? 'var(--red)' : (today.uv >= 6 ? 'var(--orange)' : 'var(--green)') },
                                    { icon:'fa-temperature-low', label:'T° Min', value: today.tMin + '°C', color: today.tMin <= 8 ? 'var(--blue)' : 'var(--green)' },
                                    { icon:'fa-temperature-high', label:'T° Max', value: today.tMax + '°C', color: today.tMax >= 32 ? 'var(--red)' : 'var(--green)' },
                                    { icon:'fa-water', label:'ETo', value: today.eto + ' mm/j', color: 'var(--blue)' },
                                    { icon:'fa-gauge-high', label:'Score Travail', value: (today.tMax <= 30 && today.humidity >= 40 ? 'Bon' : (today.tMax > 35 ? 'Critique' : 'Moyen')), color: today.tMax <= 30 && today.humidity >= 40 ? 'var(--green)' : (today.tMax > 35 ? 'var(--red)' : 'var(--orange)') }
                                ].map((item, i) => (
                                    <div key={i} style={{padding:'10px', background:'var(--gray-50)', borderRadius:10, textAlign:'center'}}>
                                        <i className={'fa-solid ' + item.icon} style={{fontSize:16, color: item.color, marginBottom:4, display:'block'}}></i>
                                        <div style={{fontSize:10, color:'var(--gray-400)', marginBottom:2}}>{item.label}</div>
                                        <div style={{fontSize:14, fontWeight:700, color: item.color}}>{item.value}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </Panel>

                    {/* Historique 7 derniers jours */}
                    <MeteoHistory7d ferme={ferme} fermeInfo={fermeInfo} />

                    {/* Courbe horaire */}
                    {hasHoraire && (
                    <Panel title="Température & Humidité - Aujourd'hui (Horaire)" icon="fa-chart-line">
                        <svg viewBox={'0 0 ' + tempChartW + ' ' + tempChartH} style={{width:'100%', height:200}}>
                            {[0,1,2,3,4].map(i => {
                                const y = tempPad.t + i * (tempChartH - tempPad.t - tempPad.b) / 4;
                                const val = Math.round(tempMax - i * (tempMax - tempMin) / 4);
                                return <g key={i}>
                                    <line x1={tempPad.l} y1={y} x2={tempChartW - tempPad.r} y2={y} stroke="var(--gray-100)" strokeWidth="1"/>
                                    <text x={tempPad.l - 6} y={y + 4} textAnchor="end" fontSize="9" fill="var(--gray-400)">{val}°</text>
                                </g>;
                            })}
                            <path d={tempLine} fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d={humLine} fill="none" stroke="var(--blue)" strokeWidth="2" strokeDasharray="4,3" strokeLinecap="round"/>
                            {horaire.map((h, i) => (
                                <g key={i}>
                                    <circle cx={tempPad.l + i*tempXStep} cy={tempY(h.temp)} r="4" fill="var(--red)" stroke="white" strokeWidth="2"/>
                                    <text x={tempPad.l + i*tempXStep} y={tempY(h.temp) - 10} textAnchor="middle" fontSize="9" fill="var(--red)" fontWeight="600">{h.temp}°</text>
                                    <text x={tempPad.l + i*tempXStep} y={tempChartH - 5} textAnchor="middle" fontSize="8" fill="var(--gray-400)">{h.heure}</text>
                                </g>
                            ))}
                            <circle cx={tempChartW - 160} cy={10} r="4" fill="var(--red)"/>
                            <text x={tempChartW - 152} y={14} fontSize="9" fill="var(--gray-600)">Température</text>
                            <line x1={tempChartW - 80} y1={10} x2={tempChartW - 60} y2={10} stroke="var(--blue)" strokeWidth="2" strokeDasharray="4,3"/>
                            <text x={tempChartW - 56} y={14} fontSize="9" fill="var(--gray-600)">Humidité</text>
                        </svg>
                    </Panel>
                    )}

                    {/* Prévisions 7 jours - cliquables */}
                    <Panel title="Prévisions 7 Jours" icon="fa-calendar-week" actions={
                        <span style={{fontSize:10,color:'var(--gray-400)'}}><i className="fa-solid fa-hand-pointer" style={{marginRight:4}}></i>Cliquez sur un jour pour le détail horaire</span>
                    }>
                        <div style={{display:'grid', gridTemplateColumns:'repeat(' + previsions.length + ', 1fr)', gap:8}}>
                            {previsions.map((p, i) => (
                                <div key={i} onClick={() => setSelectedDay(p)} style={{textAlign:'center', padding:'12px 6px', borderRadius:12, cursor:'pointer', transition:'all 0.2s', background: selectedDay?.dateISO === p.dateISO ? 'var(--berry-pale)' : (p.isToday ? 'rgba(139,34,82,0.04)' : 'var(--gray-50)'), border: selectedDay?.dateISO === p.dateISO ? '2px solid var(--berry)' : (p.isToday ? '2px solid rgba(139,34,82,0.3)' : '1px solid var(--gray-100)'), position:'relative'}}
                                    onMouseEnter={e => { if (selectedDay?.dateISO !== p.dateISO) { e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow='0 6px 16px rgba(0,0,0,0.1)'; }}}
                                    onMouseLeave={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}>
                                    {p.isToday && <div style={{position:'absolute', top:-8, left:'50%', transform:'translateX(-50%)', background:'var(--berry)', color:'white', fontSize:8, fontWeight:700, padding:'2px 8px', borderRadius:8}}>AUJOURD'HUI</div>}
                                    <div style={{fontSize:11, fontWeight:600, color:'var(--gray-600)'}}>{p.jourNom}</div>
                                    <div style={{fontSize:10, color:'var(--gray-400)'}}>{p.date}</div>
                                    <i className={'fa-solid ' + p.icon} style={{fontSize:24, color: p.iconColor, margin:'8px 0', display:'block'}}></i>
                                    <div style={{fontSize:9, color:'var(--gray-500)', marginBottom:6}}>{p.condition}</div>
                                    <div style={{fontSize:16, fontWeight:800, color: p.tMax >= 32 ? 'var(--red)' : 'var(--dark)'}}>{p.tMax}°</div>
                                    <div style={{fontSize:12, color: p.tMin <= 8 ? 'var(--blue)' : 'var(--gray-400)'}}>{p.tMin}°</div>
                                    <div style={{marginTop:6, fontSize:9}}>
                                        <span style={{color: p.humidity < 40 ? 'var(--orange)' : 'var(--blue)'}}>
                                            <i className="fa-solid fa-droplet" style={{fontSize:8, marginRight:2}}></i>{p.humidity}%
                                        </span>
                                    </div>
                                    <div style={{fontSize:9, color: p.vent >= 25 ? 'var(--orange)' : 'var(--gray-400)'}}>
                                        <i className="fa-solid fa-wind" style={{fontSize:8, marginRight:2}}></i>{p.vent} km/h
                                    </div>
                                    {p.precip > 0 && (
                                        <div style={{fontSize:9, color:'var(--blue)', marginTop:2}}>
                                            <i className="fa-solid fa-cloud-rain" style={{fontSize:8, marginRight:2}}></i>{p.precip} mm
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                        {previsions.length > 1 && <div style={{marginTop:16}}>
                            <svg viewBox={'0 0 ' + prevChartW + ' ' + prevChartH} style={{width:'100%', height:120}}>
                                {previsions.map((p, i) => {
                                    const x = 40 + i * prevXStep;
                                    const minT = Math.min(...previsions.map(pp => pp.tMin)) - 2;
                                    const maxT = Math.max(...previsions.map(pp => pp.tMax)) + 2;
                                    const yMax = 15 + (prevChartH - 40) * (1 - (p.tMax - minT) / (maxT - minT || 1));
                                    const yMin = 15 + (prevChartH - 40) * (1 - (p.tMin - minT) / (maxT - minT || 1));
                                    return <g key={i} style={{cursor:'pointer'}} onClick={() => setSelectedDay(p)}>
                                        <line x1={x} y1={yMax} x2={x} y2={yMin} stroke="var(--gray-200)" strokeWidth="6" strokeLinecap="round"/>
                                        <line x1={x} y1={yMax} x2={x} y2={yMin} stroke={'url(#tempGrad' + i + ')'} strokeWidth="4" strokeLinecap="round"/>
                                        <defs><linearGradient id={'tempGrad' + i} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--red)"/><stop offset="100%" stopColor="var(--blue)"/></linearGradient></defs>
                                        <circle cx={x} cy={yMax} r="4" fill="var(--red)" stroke="white" strokeWidth="1.5"/>
                                        <circle cx={x} cy={yMin} r="4" fill="var(--blue)" stroke="white" strokeWidth="1.5"/>
                                        <text x={x} y={yMax - 8} textAnchor="middle" fontSize="9" fill="var(--red)" fontWeight="700">{p.tMax}°</text>
                                        <text x={x} y={yMin + 14} textAnchor="middle" fontSize="9" fill="var(--blue)" fontWeight="600">{p.tMin}°</text>
                                        <text x={x} y={prevChartH - 2} textAnchor="middle" fontSize="9" fill="var(--gray-400)">{p.date}</text>
                                    </g>;
                                })}
                            </svg>
                        </div>}
                    </Panel>

                    {/* Popup détail horaire du jour sélectionné */}
                    {selectedDay && (() => {
                        const dayHours = horaireParJour[selectedDay.dateISO] || [];
                        const dW = 720, dH = 200, dPad = {t:25, b:35, l:45, r:20};
                        const dXStep = dayHours.length > 1 ? (dW - dPad.l - dPad.r) / (dayHours.length - 1) : 0;
                        const dTempMin = dayHours.length ? Math.min(...dayHours.map(h => h.temp)) - 2 : 0;
                        const dTempMax = dayHours.length ? Math.max(...dayHours.map(h => h.temp)) + 2 : 40;
                        const dTempY = (v) => dPad.t + (dH - dPad.t - dPad.b) * (1 - (v - dTempMin) / (dTempMax - dTempMin || 1));
                        const dTempLine = dayHours.map((h, i) => (i===0?'M':'L') + (dPad.l + i*dXStep) + ',' + dTempY(h.temp)).join(' ');
                        const dHumLine = dayHours.map((h, i) => (i===0?'M':'L') + (dPad.l + i*dXStep) + ',' + (dPad.t + (dH - dPad.t - dPad.b) * (1 - h.humidity/100))).join(' ');

                        return (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setSelectedDay(null)}>
                            <div style={{background:'#fff',borderRadius:16,maxWidth:800,width:'100%',maxHeight:'90vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                {/* Header */}
                                <div style={{padding:'16px 24px',borderBottom:'2px solid var(--gray-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                    <div style={{display:'flex',alignItems:'center',gap:14}}>
                                        <i className={'fa-solid ' + selectedDay.icon} style={{fontSize:32,color:selectedDay.iconColor}}></i>
                                        <div>
                                            <h3 style={{margin:0,fontSize:17,color:'var(--berry)'}}>{selectedDay.jourNom} {selectedDay.date} {selectedDay.isToday ? "(Aujourd'hui)" : ''}</h3>
                                            <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>{selectedDay.condition} | {selectedDay.tMin}° - {selectedDay.tMax}°</div>
                                        </div>
                                    </div>
                                    <button onClick={() => setSelectedDay(null)} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'var(--gray-400)',padding:4}}>
                                        <i className="fa-solid fa-xmark"></i>
                                    </button>
                                </div>

                                {/* KPIs résumé jour */}
                                <div style={{padding:'16px 24px',display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10}}>
                                    {[
                                        {icon:'fa-temperature-high',label:'Max',value:selectedDay.tMax+'°',color:selectedDay.tMax>=32?'var(--red)':'var(--dark)'},
                                        {icon:'fa-temperature-low',label:'Min',value:selectedDay.tMin+'°',color:selectedDay.tMin<=8?'var(--blue)':'var(--dark)'},
                                        {icon:'fa-droplet',label:'Humidité',value:selectedDay.humidity+'%',color:selectedDay.humidity<40?'var(--orange)':'var(--blue)'},
                                        {icon:'fa-wind',label:'Vent max',value:selectedDay.vent+' km/h',color:selectedDay.vent>=25?'var(--orange)':'var(--green)'},
                                        {icon:'fa-cloud-rain',label:'Pluie',value:selectedDay.precip+' mm',color:selectedDay.precip>5?'var(--blue)':'var(--gray-400)'},
                                        {icon:'fa-sun',label:'UV',value:selectedDay.uv,color:selectedDay.uv>=9?'var(--red)':'var(--green)'},
                                    ].map((k,i) => (
                                        <div key={i} style={{textAlign:'center',padding:10,background:'var(--gray-50)',borderRadius:10}}>
                                            <i className={'fa-solid '+k.icon} style={{fontSize:14,color:k.color,marginBottom:4,display:'block'}}></i>
                                            <div style={{fontSize:9,color:'var(--gray-400)',marginBottom:2}}>{k.label}</div>
                                            <div style={{fontSize:15,fontWeight:700,color:k.color}}>{k.value}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Courbe horaire */}
                                {dayHours.length > 1 && (
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
                                        {dayHours.map((h,i) => (
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

                                {/* Tableau horaire détaillé */}
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
                                            {dayHours.map((h,i) => (
                                                <tr key={i} style={{background: h.temp >= 32 ? 'rgba(231,76,60,0.05)' : (h.precip > 0 ? 'rgba(52,152,219,0.05)' : '')}}>
                                                    <td style={{fontWeight:600,fontFamily:'monospace'}}>{h.heure}</td>
                                                    <td style={{textAlign:'center'}}><i className={'fa-solid '+h.icon} style={{fontSize:14,color:h.icon==='fa-moon'?'#7f8c8d':selectedDay.iconColor}}></i></td>
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
                                    {dayHours.length === 0 && <div style={{textAlign:'center',padding:20,color:'var(--gray-400)',fontSize:12}}>Pas de données horaires disponibles pour ce jour</div>}
                                </div>
                            </div>
                        </div>
                        );
                    })()}

                    {/* Fenêtres de traitement phytosanitaire */}
                    {sprayData && sprayData.jours && sprayData.jours.length > 0 && (
                    <Panel title="Fenêtres de Traitement Phyto (Meteoblue Agro)" icon="fa-spray-can-sparkles" actions={
                        <span style={{fontSize:10,color:'var(--gray-400)'}}><i className="fa-solid fa-leaf" style={{marginRight:4,color:'var(--green)'}}></i>Modèle agromodelspray</span>
                    }>
                        {/* Résumé score du jour */}
                        {(() => {
                            var todaySpray = sprayData.jours.find(function(j) { return j.isToday; }) || sprayData.jours[0];
                            var scoreColor = todaySpray.score >= 70 ? 'var(--green)' : (todaySpray.score >= 40 ? 'var(--orange)' : 'var(--red)');
                            var scoreLabel = todaySpray.score >= 70 ? 'Favorable' : (todaySpray.score >= 40 ? 'Partiel' : 'Défavorable');
                            return (
                                <div style={{display:'flex',gap:16,marginBottom:16,alignItems:'center',padding:'14px 18px',background:'var(--gray-50)',borderRadius:12,border:'1px solid var(--gray-100)'}}>
                                    <div style={{textAlign:'center',minWidth:80}}>
                                        <div style={{fontSize:32,fontWeight:800,color:scoreColor}}>{todaySpray.score}%</div>
                                        <div style={{fontSize:10,color:scoreColor,fontWeight:700}}>{scoreLabel}</div>
                                        <div style={{fontSize:9,color:'var(--gray-400)',marginTop:2}}>Score traitement</div>
                                    </div>
                                    <div style={{flex:1}}>
                                        <div style={{fontSize:12,fontWeight:700,color:'var(--dark)',marginBottom:6}}>
                                            <i className="fa-solid fa-calendar-day" style={{marginRight:6,color:'var(--berry)'}}></i>
                                            Aujourd'hui - {todaySpray.jourNom} {todaySpray.date}
                                        </div>
                                        <div style={{display:'flex',gap:12,marginBottom:8}}>
                                            <span style={{fontSize:11,color:'var(--green)'}}><i className="fa-solid fa-circle-check" style={{marginRight:4}}></i>{todaySpray.bonCount}h favorables</span>
                                            <span style={{fontSize:11,color:'var(--orange)'}}><i className="fa-solid fa-circle-minus" style={{marginRight:4}}></i>{todaySpray.moyenCount}h modérées</span>
                                            <span style={{fontSize:11,color:'var(--red)'}}><i className="fa-solid fa-circle-xmark" style={{marginRight:4}}></i>{todaySpray.mauvaisCount}h défavorables</span>
                                        </div>
                                        {todaySpray.fenetres.length > 0 ? (
                                            <div style={{fontSize:11,color:'var(--gray-600)'}}>
                                                <i className="fa-solid fa-clock" style={{marginRight:4,color:'var(--green)'}}></i>
                                                Créneaux recommandés : {todaySpray.fenetres.map(function(f) { return f.de + 'h-' + f.a + 'h'; }).join(', ')}
                                            </div>
                                        ) : (
                                            <div style={{fontSize:11,color:'var(--red)'}}>
                                                <i className="fa-solid fa-ban" style={{marginRight:4}}></i>Aucun créneau favorable aujourd'hui
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Timeline visuelle par jour */}
                        <div style={{overflowX:'auto'}}>
                        <table className="data-table" style={{fontSize:11,width:'100%'}}>
                            <thead>
                                <tr>
                                    <th style={{width:80}}>Jour</th>
                                    <th style={{textAlign:'center'}}>Timeline (6h-20h)</th>
                                    <th style={{width:60,textAlign:'center'}}>Score</th>
                                    <th style={{width:130}}>Créneaux</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sprayData.jours.map(function(jour, ji) {
                                    var workHours = jour.heures.filter(function(e) { return e.heure >= 6 && e.heure <= 20; });
                                    var scoreColor = jour.score >= 70 ? 'var(--green)' : (jour.score >= 40 ? 'var(--orange)' : 'var(--red)');
                                    return (
                                        <tr key={ji} style={{background: jour.isToday ? 'rgba(139,34,82,0.04)' : ''}}>
                                            <td style={{fontWeight: jour.isToday ? 700 : 500}}>
                                                <div>{jour.jourNom} {jour.date}</div>
                                                {jour.isToday && <span style={{fontSize:8,color:'var(--berry)',fontWeight:700}}>AUJOURD'HUI</span>}
                                            </td>
                                            <td>
                                                <div style={{display:'flex',gap:1,alignItems:'center'}}>
                                                    {workHours.map(function(h, hi) {
                                                        var bg = h.value === 1 ? 'var(--green)' : (h.value === 2 ? 'var(--orange)' : 'var(--red)');
                                                        var opacity = h.value === 1 ? 0.8 : (h.value === 2 ? 0.6 : 0.4);
                                                        return (
                                                            <div key={hi} title={h.heure + 'h - ' + (h.value === 1 ? 'Favorable' : (h.value === 2 ? 'Modéré' : 'Défavorable'))} style={{
                                                                flex:1,height:22,borderRadius:3,background:bg,opacity:opacity,cursor:'default',
                                                                position:'relative',minWidth:12
                                                            }}>
                                                                {hi === 0 && <span style={{position:'absolute',bottom:-14,left:0,fontSize:7,color:'var(--gray-400)'}}>6h</span>}
                                                                {hi === workHours.length-1 && <span style={{position:'absolute',bottom:-14,right:0,fontSize:7,color:'var(--gray-400)'}}>20h</span>}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </td>
                                            <td style={{textAlign:'center'}}>
                                                <span style={{fontWeight:700,fontSize:14,color:scoreColor}}>{jour.score}%</span>
                                            </td>
                                            <td style={{fontSize:10,color:'var(--gray-600)'}}>
                                                {jour.fenetres.length > 0 ? jour.fenetres.map(function(f) { return f.de + 'h-' + f.a + 'h'; }).join(', ') : <span style={{color:'var(--red)'}}>Aucun</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        </div>

                        {/* Légende */}
                        <div style={{display:'flex',gap:16,marginTop:12,justifyContent:'center'}}>
                            <span style={{fontSize:10,display:'flex',alignItems:'center',gap:4}}><div style={{width:14,height:14,borderRadius:3,background:'var(--green)',opacity:0.8}}></div> Favorable</span>
                            <span style={{fontSize:10,display:'flex',alignItems:'center',gap:4}}><div style={{width:14,height:14,borderRadius:3,background:'var(--orange)',opacity:0.6}}></div> Modéré</span>
                            <span style={{fontSize:10,display:'flex',alignItems:'center',gap:4}}><div style={{width:14,height:14,borderRadius:3,background:'var(--red)',opacity:0.4}}></div> Défavorable</span>
                        </div>
                    </Panel>
                    )}

                    {/* Recommandations agricoles */}
                    <Panel title="Recommandations Agricoles" icon="fa-lightbulb">
                        <div style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12}}>
                            {[
                                { icon: 'fa-faucet-drip', title: 'Irrigation', text: today.tMax >= 35 ? 'Irriguer 2x/jour. ETo élevée, augmenter dose de 30%.' : (today.tMax >= 30 ? 'Irriguer tôt le matin. Prévoir dose supplémentaire.' : 'Irrigation normale selon planning.'), color: today.tMax >= 35 ? 'var(--red)' : (today.tMax >= 30 ? 'var(--orange)' : 'var(--green)'), priority: today.tMax >= 35 ? 'Urgent' : (today.tMax >= 30 ? 'Attention' : 'Normal') },
                                { icon: 'fa-users', title: 'Personnel', text: today.tMax >= 35 ? 'Arrêter travail extérieur 12h-16h. Distribuer eau toutes les 30min.' : (today.tMax >= 30 ? 'Pauses supplémentaires. Fournir eau et protection solaire.' : 'Conditions normales de travail.'), color: today.tMax >= 35 ? 'var(--red)' : (today.tMax >= 30 ? 'var(--orange)' : 'var(--green)'), priority: today.tMax >= 35 ? 'Urgent' : (today.tMax >= 30 ? 'Attention' : 'Normal') },
                                { icon: 'fa-spray-can-sparkles', title: 'Traitement Phyto', text: today.vent >= 20 ? 'Reporter traitements. Vent trop fort pour pulvérisation.' : (today.precip > 0 ? 'Reporter traitements. Pluie prévue.' : 'Conditions favorables. Traiter avant ' + (today.tMax >= 28 ? '9h' : '11h') + '.'), color: today.vent >= 20 || today.precip > 0 ? 'var(--orange)' : 'var(--green)', priority: today.vent >= 20 ? 'Reporter' : 'OK' },
                                { icon: 'fa-tent', title: 'Tunnels', text: today.tMax >= 32 ? 'Ouvrir aérations max. Installer filets ombrage si disponible.' : (today.vent >= 25 ? 'Vérifier fixations bâches. Fermer aérations côté vent.' : 'Aération normale selon protocole.'), color: today.tMax >= 32 ? 'var(--red)' : (today.vent >= 25 ? 'var(--orange)' : 'var(--green)'), priority: today.tMax >= 32 || today.vent >= 25 ? 'Attention' : 'Normal' }
                            ].map((rec, i) => (
                                <div key={i} style={{padding:'14px', borderRadius:12, background:'white', border:'1px solid var(--gray-100)', boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
                                    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8}}>
                                        <div style={{display:'flex', alignItems:'center', gap:8}}>
                                            <i className={'fa-solid ' + rec.icon} style={{fontSize:16, color: rec.color}}></i>
                                            <span style={{fontWeight:700, fontSize:13}}>{rec.title}</span>
                                        </div>
                                        <span style={{fontSize:9, padding:'2px 8px', borderRadius:8, background: rec.color === 'var(--red)' ? 'var(--red-pale)' : (rec.color === 'var(--orange)' ? 'var(--orange-pale)' : 'var(--green-pale)'), color: rec.color, fontWeight:700}}>{rec.priority}</span>
                                    </div>
                                    <div style={{fontSize:12, color:'var(--gray-600)', lineHeight:1.5}}>{rec.text}</div>
                                </div>
                            ))}
                        </div>
                    </Panel>
                </div>
            );
        }

export { MeteoTab };
