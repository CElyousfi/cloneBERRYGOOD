/* Module: technique | Déclaration(s): IrrigationRecoTab */
import { Panel } from '../shared/Panel.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== IRRIGATION RECO TAB =====================
        function IrrigationRecoTab({ farmFilter }) {
            const [ferme, setFerme] = useState(farmFilter || 'F1');
            const [forecastData, setForecastData] = useState(null);
            const [loading, setLoading] = useState(true);
            const [configMode, setConfigMode] = useState(false);
            const [saving, setSaving] = useState(false);
            const [editConfig, setEditConfig] = useState({});

            const PARCELLES_DEFAUT = {
                F1: ['P1-Myrtille A', 'P2-Myrtille B', 'P3-Framboise', 'P4-Myrtille C', 'P5-Framboise B'],
                F5: ['P1-Myrtille', 'P2-Framboise A', 'P3-Framboise B', 'P4-Myrtille D'],
                F6: ['P1-Hass', 'P2-Hass B', 'P3-Fuerte'],
            };

            const CULTURE_DEFAULTS = {
                Myrtille:  { kc: 0.85, coeff_tunnel: 0.7, profondeur_racinaire: 0.35, reserve_utile: 100, seuil_declenchement: 0.35, type_abri: 'tunnel' },
                Framboise: { kc: 0.95, coeff_tunnel: 0.7, profondeur_racinaire: 0.40, reserve_utile: 110, seuil_declenchement: 0.40, type_abri: 'tunnel' },
                Hass:      { kc: 0.70, coeff_tunnel: 1.0, profondeur_racinaire: 0.80, reserve_utile: 140, seuil_declenchement: 0.50, type_abri: 'plein_champ' },
                Fuerte:    { kc: 0.70, coeff_tunnel: 1.0, profondeur_racinaire: 0.80, reserve_utile: 140, seuil_declenchement: 0.50, type_abri: 'plein_champ' },
            };

            function detectCulture(parcName) {
                if (/myrtille/i.test(parcName)) return 'Myrtille';
                if (/framboise/i.test(parcName)) return 'Framboise';
                if (/hass/i.test(parcName)) return 'Hass';
                if (/fuerte/i.test(parcName)) return 'Fuerte';
                return 'Myrtille';
            }

            const loadData = () => {
                setLoading(true);
                fetch('/api/stock?action=get-irrigation-forecast&ferme=' + ferme)
                    .then(r => r.json()).then(j => {
                        if (j.success) {
                            setForecastData(j);
                            // Init edit config from saved or defaults
                            const savedParcelles = j.config && j.config.parcelles ? j.config.parcelles : {};
                            const parcNames = PARCELLES_DEFAUT[ferme] || [];
                            const cfg = {};
                            parcNames.forEach(p => {
                                if (savedParcelles[p]) {
                                    cfg[p] = { ...savedParcelles[p] };
                                } else {
                                    const culture = detectCulture(p);
                                    const defs = CULTURE_DEFAULTS[culture] || CULTURE_DEFAULTS.Myrtille;
                                    cfg[p] = { debit_pompe: 10, surface_ha: 1, efficacite: 0.90, culture, ...defs };
                                }
                            });
                            setEditConfig(cfg);
                        }
                    }).catch(e => console.warn(e)).finally(() => setLoading(false));
            };

            useEffect(() => { loadData(); }, [ferme]);

            const handleSaveConfig = () => {
                setSaving(true);
                fetch('/api/stock?action=save-irrigation-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ferme, parcelles: editConfig, updated_by: 'chef_agronomie' }),
                }).then(r => r.json()).then(j => {
                    if (j.success) { setConfigMode(false); loadData(); }
                }).catch(e => console.warn(e)).finally(() => setSaving(false));
            };

            const updateParcConfig = (parc, field, value) => {
                setEditConfig(prev => ({
                    ...prev,
                    [parc]: { ...prev[parc], [field]: value }
                }));
            };

            if (loading) return <div style={{textAlign:'center',padding:60}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:32,color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--gray-400)'}}>Chargement données irrigation...</div></div>;

            const fd = forecastData || {};
            const recos = fd.recommendations || {};
            const plan7j = fd.plan7j || [];
            const model = fd.model || null;
            const indoorForecast = fd.indoorForecast || [];
            const soilAnalyses = fd.soilAnalyses || [];
            const todayIndoor = indoorForecast.length > 0 ? indoorForecast[0] : null;
            const todayOutdoor = (fd.forecast || [])[0] || null;

            // Colors
            const urgencyColor = (eto) => eto >= 6 ? 'var(--red)' : eto >= 4 ? 'var(--orange)' : 'var(--green)';
            const jourNoms = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];

            return (
                <div className="fade-in">
                    {/* Farm selector */}
                    <div style={{display:'flex',gap:10,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
                        {Object.keys(PARCELLES_DEFAUT).map(f => (
                            <button key={f} className={'chip c-berry ' + (ferme === f ? 'active' : '')} onClick={() => setFerme(f)} style={{padding:'8px 16px',fontSize:12}}>
                                {f}
                            </button>
                        ))}
                        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
                            <button onClick={() => setConfigMode(!configMode)} style={{padding:'8px 14px',borderRadius:8,border:'1px solid var(--gray-200)',background:configMode?'var(--berry)':'white',color:configMode?'white':'var(--gray-600)',fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
                                <i className="fa-solid fa-sliders"></i> Paramétrage
                            </button>
                            <button onClick={loadData} style={{padding:'8px 14px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',fontSize:12,cursor:'pointer'}}>
                                <i className="fa-solid fa-rotate"></i>
                            </button>
                        </div>
                    </div>

                    {/* Panneau 1: Conditions du jour */}
                    <Panel title="Conditions du jour" icon="fa-sun">
                        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))',gap:10}}>
                            {[
                                { icon: 'fa-water', label: 'ETo outdoor', value: todayOutdoor ? todayOutdoor.eto + ' mm/j' : '—', color: 'var(--blue)' },
                                { icon: 'fa-temperature-high', label: 'T° ext max', value: todayOutdoor ? todayOutdoor.tmax + '°C' : '—', color: 'var(--red)' },
                                { icon: 'fa-tent', label: 'T° serre prévu', value: todayIndoor ? todayIndoor.tmax + '°C' : '—', color: '#e67e22' },
                                { icon: 'fa-droplet', label: 'HR serre prévu', value: todayIndoor ? todayIndoor.hr + '%' : '—', color: 'var(--blue)' },
                                { icon: 'fa-gauge', label: 'VPD serre prévu', value: todayIndoor ? todayIndoor.vpd + ' kPa' : '—', color: '#D81B60' },
                                { icon: 'fa-cloud-rain', label: 'Pluie prévue', value: todayOutdoor ? todayOutdoor.precip + ' mm' : '—', color: '#5e35b1' },
                                { icon: 'fa-chart-line', label: 'Modèle R²', value: model ? (model.r2_tmax || '—') : 'Pas de modèle', color: 'var(--berry)' },
                                { icon: 'fa-database', label: 'Jours entraînement', value: model ? model.training_days + 'j' : '—', color: 'var(--gray-500)' },
                            ].map((kpi, i) => (
                                <div key={i} style={{background:'white',borderRadius:10,padding:'12px 14px',border:'1px solid var(--gray-100)',boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
                                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                                        <i className={'fa-solid ' + kpi.icon} style={{fontSize:13,color:kpi.color}}></i>
                                        <span style={{fontSize:10,color:'var(--gray-400)',fontWeight:600}}>{kpi.label}</span>
                                    </div>
                                    <div style={{fontSize:18,fontWeight:700,color:'var(--gray-800)'}}>{kpi.value}</div>
                                </div>
                            ))}
                        </div>
                        {model && model.daily_errors && model.daily_errors.length > 0 && (
                            <div style={{marginTop:10,fontSize:11,color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-circle-info"></i> Erreur moy. modèle (7j) : {(model.daily_errors.reduce((s,e) => s + e.error, 0) / model.daily_errors.length).toFixed(1)}°C
                            </div>
                        )}
                        {soilAnalyses.length > 0 && (
                            <div style={{marginTop:8,fontSize:11,color:'var(--gray-500)'}}>
                                <i className="fa-solid fa-flask"></i> Dernière analyse sol : {soilAnalyses[0].parsed_values ? Object.entries(soilAnalyses[0].parsed_values).slice(0, 5).map(([k,v]) => k + ':' + v).join(' | ') : 'Pas de valeurs'}
                            </div>
                        )}
                    </Panel>

                    {/* Panneau 2: Recommandations par parcelle */}
                    <Panel title={'Recommandations irrigation — ' + ferme} icon="fa-faucet-drip">
                        {Object.keys(recos).length === 0 ? (
                            <div style={{textAlign:'center',padding:30,color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-sliders" style={{fontSize:24,display:'block',marginBottom:8}}></i>
                                <div style={{fontSize:13,fontWeight:600}}>Aucune parcelle configurée</div>
                                <div style={{fontSize:12,marginTop:4}}>Cliquez "Paramétrage" pour configurer les parcelles et pompes</div>
                            </div>
                        ) : (
                            <div style={{overflowX:'auto'}}>
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                    <thead>
                                        <tr style={{background:'var(--gray-50)'}}>
                                            {['Parcelle','Culture','Abri','ETo','Kc','Coeff','ETc','Besoin','RU','Tours','Dose/tour','Volume','Durée','Alerte'].map(h => (
                                                <th key={h} style={{padding:'8px 6px',textAlign:'left',fontWeight:700,fontSize:10,color:'var(--gray-500)',borderBottom:'2px solid var(--gray-100)'}}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.entries(recos).map(([parc, r]) => (
                                            <tr key={parc} style={{borderBottom:'1px solid var(--gray-50)'}}>
                                                <td style={{padding:'8px 6px',fontWeight:600}}>{parc}</td>
                                                <td style={{padding:'8px 6px'}}>{r.culture || '—'}</td>
                                                <td style={{padding:'8px 6px'}}><span style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:r.type_abri==='tunnel'?'#fef3c7':r.type_abri==='canarienne'?'#dbeafe':'#dcfce7',fontWeight:600}}>{r.type_abri || '—'}</span></td>
                                                <td style={{padding:'8px 6px',color:urgencyColor(r.eto)}}>{r.eto}</td>
                                                <td style={{padding:'8px 6px'}}>{r.kc}</td>
                                                <td style={{padding:'8px 6px'}}>{r.coeff_tunnel}</td>
                                                <td style={{padding:'8px 6px',fontWeight:600}}>{r.etc}</td>
                                                <td style={{padding:'8px 6px'}}>{r.besoin_brut} mm</td>
                                                <td style={{padding:'8px 6px'}}>{r.ru_totale} mm</td>
                                                <td style={{padding:'8px 6px'}}><span style={{background:r.nb_tours>1?'var(--orange-pale)':'var(--green-pale)',color:r.nb_tours>1?'var(--orange)':'var(--green)',padding:'2px 8px',borderRadius:8,fontSize:11,fontWeight:700}}>{r.nb_tours}</span></td>
                                                <td style={{padding:'8px 6px'}}>{r.dose_par_tour} mm</td>
                                                <td style={{padding:'8px 6px'}}>{r.volume_m3} m³</td>
                                                <td style={{padding:'8px 6px'}}><span style={{fontWeight:700,fontSize:14,color:'var(--berry)'}}>{r.duree_label}</span></td>
                                                <td style={{padding:'8px 6px'}}>{r.alerte_ce ? <span style={{fontSize:10,color:'var(--orange)'}}><i className="fa-solid fa-triangle-exclamation"></i> {r.alerte_ce}</span> : <span style={{color:'var(--green)'}}><i className="fa-solid fa-check"></i></span>}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Panel>

                    {/* Panneau 3: Prévision 7 jours */}
                    {plan7j.length > 0 && (
                        <Panel title="Plan irrigation 7 jours" icon="fa-calendar-week">
                            <div style={{display:'grid',gridTemplateColumns:'repeat(7, 1fr)',gap:8}}>
                                {plan7j.map((day, i) => {
                                    var d = new Date(day.date + 'T12:00:00');
                                    var maxH = Math.max(...plan7j.map(x => x.duree_totale_h), 1);
                                    var barH = Math.round((day.duree_totale_h / maxH) * 80);
                                    return (
                                        <div key={i} style={{background:'white',borderRadius:10,padding:'10px 8px',border:i===0?'2px solid var(--berry)':'1px solid var(--gray-100)',textAlign:'center'}}>
                                            <div style={{fontSize:11,fontWeight:700,color:i===0?'var(--berry)':'var(--gray-600)',marginBottom:6}}>{jourNoms[d.getDay()]}</div>
                                            <div style={{fontSize:10,color:'var(--gray-400)',marginBottom:8}}>{String(d.getDate()).padStart(2,'0')}/{String(d.getMonth()+1).padStart(2,'0')}</div>
                                            <div style={{height:80,display:'flex',alignItems:'flex-end',justifyContent:'center',marginBottom:6}}>
                                                <div style={{width:28,height:barH,background:'linear-gradient(to top, var(--berry), #8e44ad)',borderRadius:'4px 4px 0 0',position:'relative'}}>
                                                    {day.precip > 0 && <div style={{position:'absolute',top:-14,left:'50%',transform:'translateX(-50)',fontSize:9,color:'var(--blue)',whiteSpace:'nowrap'}}><i className="fa-solid fa-cloud-rain"></i> {day.precip}</div>}
                                                </div>
                                            </div>
                                            <div style={{fontSize:14,fontWeight:700,color:'var(--gray-800)'}}>{Math.floor(day.duree_totale_h)}h{String(Math.round((day.duree_totale_h % 1) * 60)).padStart(2,'0')}</div>
                                            <div style={{fontSize:10,color:'var(--gray-400)',marginTop:2}}>ETo {day.eto || '—'}</div>
                                            {day.indoor && <div style={{fontSize:9,color:'#e67e22',marginTop:2}}>{day.indoor.tmax}°C / {day.indoor.hr}%</div>}
                                        </div>
                                    );
                                })}
                            </div>
                        </Panel>
                    )}

                    {/* Panneau 4: Paramétrage */}
                    {configMode && (
                        <Panel title={'Paramétrage irrigation — ' + ferme} icon="fa-sliders">
                            <div style={{overflowX:'auto'}}>
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                    <thead>
                                        <tr style={{background:'var(--gray-50)'}}>
                                            {['Parcelle','Culture','Type abri','Débit pompe (m³/h)','Surface (ha)','Kc','Coeff tunnel','Efficacité','RU (mm/m)','Prof. racin. (m)','Seuil décl.'].map(h => (
                                                <th key={h} style={{padding:'8px 6px',textAlign:'left',fontWeight:700,fontSize:10,color:'var(--gray-500)',borderBottom:'2px solid var(--gray-100)',whiteSpace:'nowrap'}}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.entries(editConfig).map(([parc, cfg]) => (
                                            <tr key={parc} style={{borderBottom:'1px solid var(--gray-50)'}}>
                                                <td style={{padding:'6px',fontWeight:600,whiteSpace:'nowrap'}}>{parc}</td>
                                                <td style={{padding:'6px'}}>
                                                    <select value={cfg.culture || ''} onChange={e => { var c = e.target.value; var defs = CULTURE_DEFAULTS[c] || {}; updateParcConfig(parc, 'culture', c); Object.entries(defs).forEach(([k,v]) => updateParcConfig(parc, k, v)); }} style={{padding:'4px 6px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:11,width:90}}>
                                                        {Object.keys(CULTURE_DEFAULTS).map(c => <option key={c} value={c}>{c}</option>)}
                                                    </select>
                                                </td>
                                                <td style={{padding:'6px'}}>
                                                    <select value={cfg.type_abri || 'tunnel'} onChange={e => updateParcConfig(parc, 'type_abri', e.target.value)} style={{padding:'4px 6px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:11,width:95}}>
                                                        <option value="tunnel">Tunnel</option>
                                                        <option value="canarienne">Canarienne</option>
                                                        <option value="plein_champ">Plein champ</option>
                                                    </select>
                                                </td>
                                                {[
                                                    { field: 'debit_pompe', step: 0.5, min: 0.5 },
                                                    { field: 'surface_ha', step: 0.1, min: 0.1 },
                                                    { field: 'kc', step: 0.05, min: 0.1 },
                                                    { field: 'coeff_tunnel', step: 0.05, min: 0.1 },
                                                    { field: 'efficacite', step: 0.05, min: 0.5 },
                                                    { field: 'reserve_utile', step: 5, min: 30 },
                                                    { field: 'profondeur_racinaire', step: 0.05, min: 0.1 },
                                                    { field: 'seuil_declenchement', step: 0.05, min: 0.1 },
                                                ].map(inp => (
                                                    <td key={inp.field} style={{padding:'6px'}}>
                                                        <input type="number" value={cfg[inp.field] || ''} step={inp.step} min={inp.min}
                                                            onChange={e => updateParcConfig(parc, inp.field, parseFloat(e.target.value) || 0)}
                                                            style={{width:65,padding:'4px 6px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:11,textAlign:'center'}} />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div style={{display:'flex',justifyContent:'flex-end',gap:10,marginTop:14}}>
                                <button onClick={() => setConfigMode(false)} style={{padding:'8px 20px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',fontSize:12,cursor:'pointer'}}>Annuler</button>
                                <button onClick={handleSaveConfig} disabled={saving} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--berry)',color:'white',fontSize:12,fontWeight:700,cursor:'pointer',opacity:saving?0.6:1}}>
                                    {saving ? <><i className="fa-solid fa-spinner fa-spin"></i> Sauvegarde...</> : <><i className="fa-solid fa-check"></i> Sauvegarder</>}
                                </button>
                            </div>
                        </Panel>
                    )}
                </div>
            );
        }

export { IrrigationRecoTab };
