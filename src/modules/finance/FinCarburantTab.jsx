/* Module: finance | Déclaration(s): FinCarburantTab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { SimpleBarChart } from '../shared/SimpleBarChart.jsx';
import { FuelKmChart } from './FuelKmChart.jsx';
import { FuelWeeklyChart } from './FuelWeeklyChart.jsx';

function FinCarburantTab({ data }) {
            const [carb, setCarb] = React.useState(null);
            const [cardMapping, setCardMapping] = React.useState({});
            const [loading, setLoading] = React.useState(true);
            const [error, setError] = React.useState(null);
            const [selectedAnomaly, setSelectedAnomaly] = React.useState(null);
            const [syncTime, setSyncTime] = React.useState(null);
            const [showAnomalies, setShowAnomalies] = React.useState(false);
            const [expandedKPI, setExpandedKPI] = React.useState(null);

            React.useEffect(() => {
                Promise.all([
                    fetch('/api/fuel?action=summary').then(r => r.json()),
                    fetch('/fuel-card-mapping.json').then(r => r.json()).catch(() => ({}))
                ]).then(([fuelData, mapping]) => {
                    if (fuelData.success) {
                        setCarb(fuelData);
                        setCardMapping(mapping || {});
                        setSyncTime(new Date());
                    } else {
                        setError(fuelData.error || 'Erreur API');
                    }
                    setLoading(false);
                }).catch(err => {
                    setError(err.message);
                    setLoading(false);
                });
            }, []);

            if (loading) return <div style={{textAlign:'center', padding:60}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:24, color:'var(--gray-400)'}}></i><p style={{marginTop:12, color:'var(--gray-500)'}}>Chargement des données carburant...</p></div>;
            if (error) return <div style={{textAlign:'center', padding:60, color:'var(--red-500)'}}><i className="fa-solid fa-triangle-exclamation" style={{fontSize:24}}></i><p style={{marginTop:12}}>{error}</p></div>;
            if (!carb) return null;

            const chartDataEvol = (carb.evolution || []).map(e => ({
                mois: e.label || e.mois,
                Carburant: e.carburant,
                Péages: e.peages
            }));

            const anomalies = carb.anomalies || [];
            const multiFills = anomalies.filter(a => a.type === 'multi_fill');
            const highAmounts = anomalies.filter(a => a.type === 'high_amount');

            // Calcul du décalage données carburant
            let decalageJours = null;
            let lastTransDateStr = null;
            if (carb.dernieresTransactions && carb.dernieresTransactions.length > 0) {
                const raw = carb.dernieresTransactions[0].date || '';
                const [datePart] = raw.split(' ');
                const [dd, mm, yyyy] = (datePart || '').split('/');
                if (dd && mm && yyyy) {
                    const lastDate = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
                    decalageJours = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
                    lastTransDateStr = datePart;
                }
            }
            const decalageCritical = decalageJours !== null && decalageJours >= 7;
            const decalageWarning = decalageJours !== null && decalageJours >= 3;

            return (
                <div className="fade-in">
                    {/* ===== ALERTE DÉCALAGE DONNÉES ===== */}
                    {decalageWarning && (
                        <div style={{padding:'12px 16px', background: decalageCritical ? 'rgba(231,76,60,0.1)' : 'rgba(243,156,18,0.1)', border: '1px solid ' + (decalageCritical ? 'rgba(231,76,60,0.3)' : 'rgba(243,156,18,0.3)'), borderRadius:10, marginBottom:16, display:'flex', alignItems:'center', gap:12, fontSize:13}}>
                            <i className={'fa-solid ' + (decalageCritical ? 'fa-circle-exclamation' : 'fa-triangle-exclamation')} style={{fontSize:18, color: decalageCritical ? '#e74c3c' : '#f39c12'}}></i>
                            <div>
                                <span style={{fontWeight:700, color: decalageCritical ? '#c0392b' : '#856404'}}>Données carburant non actualisées depuis {decalageJours} jour{decalageJours > 1 ? 's' : ''}</span>
                                <span style={{marginLeft:8, color:'var(--gray-500)', fontSize:11}}>(dernière transaction : {lastTransDateStr})</span>
                            </div>
                        </div>
                    )}
                    {/* ===== ALERTES ANOMALIES (collapsed by default) ===== */}
                    {anomalies.length > 0 && (
                        <div style={{marginBottom: 16}}>
                            <div onClick={() => setShowAnomalies(!showAnomalies)} style={{padding:'10px 16px', background: '#FFF3E0', border: '1px solid #FFB74D', borderRadius: showAnomalies ? '12px 12px 0 0' : 12, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', transition:'border-radius 0.2s'}}>
                                <div style={{fontWeight: 700, fontSize: 14, color: '#E65100'}}>
                                    <i className="fa-solid fa-triangle-exclamation" style={{marginRight: 8}}></i>
                                    {anomalies.length} anomalie{anomalies.length > 1 ? 's' : ''} détectée{anomalies.length > 1 ? 's' : ''}
                                </div>
                                <i className={`fa-solid fa-chevron-${showAnomalies ? 'up' : 'down'}`} style={{color:'#E65100', fontSize:12}}></i>
                            </div>
                            {showAnomalies && (
                                <div style={{padding: 16, background: '#FFF3E0', border: '1px solid #FFB74D', borderTop:'none', borderRadius: '0 0 12px 12px'}}>
                                    {multiFills.length > 0 && (
                                        <div style={{marginBottom: 8}}>
                                            <div style={{fontSize: 11, fontWeight: 600, color: '#BF360C', textTransform: 'uppercase', marginBottom: 4}}>
                                                <i className="fa-solid fa-gas-pump" style={{marginRight: 4}}></i> Multi-pleins suspects ({multiFills.length})
                                            </div>
                                            <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                                                {multiFills.slice(0, 10).map((a, i) => (
                                                    <span key={i} onClick={() => setSelectedAnomaly(a)} style={{display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#FFCCBC', borderRadius: 6, fontSize: 11, cursor: 'pointer', transition: 'background 0.15s'}}
                                                        onMouseEnter={e => e.currentTarget.style.background='#FFAB91'} onMouseLeave={e => e.currentTarget.style.background='#FFCCBC'}>
                                                        <strong>{a.carte}</strong> — {a.date}: <span style={{color:'#D84315', fontWeight:700}}>{a.count} pleins</span> ({a.montant.toLocaleString('fr-FR')} DH)
                                                    </span>
                                                ))}
                                                {multiFills.length > 10 && <span style={{fontSize: 11, color: '#BF360C'}}>+{multiFills.length - 10} autres</span>}
                                            </div>
                                        </div>
                                    )}

                                    {highAmounts.length > 0 && (
                                        <div>
                                            <div style={{fontSize: 11, fontWeight: 600, color: '#BF360C', textTransform: 'uppercase', marginBottom: 4}}>
                                                <i className="fa-solid fa-money-bill-trend-up" style={{marginRight: 4}}></i> Montants anormaux ({highAmounts.length})
                                            </div>
                                            <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                                                {highAmounts.slice(0, 8).map((a, i) => (
                                                    <span key={i} onClick={() => setSelectedAnomaly(a)} style={{display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#FFCCBC', borderRadius: 6, fontSize: 11, cursor: 'pointer', transition: 'background 0.15s'}}
                                                        onMouseEnter={e => e.currentTarget.style.background='#FFAB91'} onMouseLeave={e => e.currentTarget.style.background='#FFCCBC'}>
                                                        <strong>{a.carte}</strong> — {a.date}: <span style={{color:'#D84315', fontWeight:700}}>{a.montant.toLocaleString('fr-FR')} DH</span> (médiane: {a.mediane} DH)
                                                    </span>
                                                ))}
                                                {highAmounts.length > 8 && <span style={{fontSize: 11, color: '#BF360C'}}>+{highAmounts.length - 8} autres</span>}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ===== MODAL ANOMALIE ===== */}
                    {selectedAnomaly && (
                        <div className="modal-overlay" onClick={() => setSelectedAnomaly(null)}>
                            <div className="modal-content" style={{maxWidth: 640, padding: 0, overflow: 'hidden'}} onClick={e => e.stopPropagation()}>
                                {selectedAnomaly.type === 'multi_fill' ? (
                                    <div>
                                        <div style={{background: 'linear-gradient(135deg, #E65100, #F57C00)', padding: '16px 20px', color: 'white'}}>
                                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                                <div>
                                                    <div style={{fontSize: 16, fontWeight: 700}}>
                                                        <i className="fa-solid fa-gas-pump" style={{marginRight: 8}}></i>
                                                        Multi-pleins — Carte {selectedAnomaly.carte}
                                                    </div>
                                                    <div style={{fontSize: 12, opacity: 0.9, marginTop: 2}}>{selectedAnomaly.date} — {selectedAnomaly.count} pleins — {selectedAnomaly.montant.toLocaleString('fr-FR')} DH</div>
                                                </div>
                                                <button onClick={() => setSelectedAnomaly(null)} style={{background: 'none', border: 'none', color: 'white', fontSize: 20, cursor: 'pointer', padding: '0 4px'}}>&times;</button>
                                            </div>
                                        </div>
                                        <div style={{padding: '16px 20px'}}>
                                            {/* Histogramme distribution pleins/jour */}
                                            {selectedAnomaly.dailyDistribution && (() => {
                                                const dist = selectedAnomaly.dailyDistribution;
                                                const entries = Object.entries(dist).map(([k, v]) => ({count: parseInt(k), days: v})).sort((a, b) => a.count - b.count);
                                                const maxDays = Math.max(...entries.map(e => e.days));
                                                return (
                                                    <div style={{marginBottom: 16}}>
                                                        <div style={{fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 8}}>Fréquence pleins/jour pour cette carte</div>
                                                        <div style={{display: 'flex', alignItems: 'flex-end', gap: 3, height: 80}}>
                                                            {entries.map((e, i) => {
                                                                const isAnomaly = e.count === selectedAnomaly.count;
                                                                const h = Math.max(8, (e.days / maxDays) * 70);
                                                                return (
                                                                    <div key={i} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1}}>
                                                                        <div style={{fontSize: 9, color: isAnomaly ? '#D32F2F' : '#999', fontWeight: isAnomaly ? 700 : 400, marginBottom: 2}}>{e.days}j</div>
                                                                        <div style={{width: '100%', maxWidth: 28, height: h, background: isAnomaly ? '#D32F2F' : '#FFB74D', borderRadius: '4px 4px 0 0', transition: 'height 0.3s'}}></div>
                                                                        <div style={{fontSize: 9, color: isAnomaly ? '#D32F2F' : '#666', fontWeight: isAnomaly ? 700 : 400, marginTop: 2}}>{e.count}x</div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                            {/* Tableau transactions */}
                                            <div style={{fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 6}}>Détail des transactions</div>
                                            <table className="data-table" style={{fontSize: 12}}>
                                                <thead>
                                                    <tr>
                                                        <th>Heure</th>
                                                        <th>Station</th>
                                                        <th>Produit</th>
                                                        <th>Qté (L)</th>
                                                        <th>Montant (DH)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(selectedAnomaly.transactions || []).map((tx, i) => (
                                                        <tr key={i}>
                                                            <td>{tx.heure}</td>
                                                            <td>{tx.lieu}</td>
                                                            <td>{tx.produit}</td>
                                                            <td>{tx.quantite}</td>
                                                            <td>{Math.round(tx.montant).toLocaleString('fr-FR')}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                                <tfoot>
                                                    <tr style={{fontWeight: 700, background: '#FFF3E0'}}>
                                                        <td colSpan={3}>TOTAL</td>
                                                        <td>{Math.round((selectedAnomaly.transactions || []).reduce((s, t) => s + (t.quantite || 0), 0) * 10) / 10} L</td>
                                                        <td>{selectedAnomaly.montant.toLocaleString('fr-FR')} DH</td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <div style={{background: 'linear-gradient(135deg, #B71C1C, #E53935)', padding: '16px 20px', color: 'white'}}>
                                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                                <div>
                                                    <div style={{fontSize: 16, fontWeight: 700}}>
                                                        <i className="fa-solid fa-money-bill-trend-up" style={{marginRight: 8}}></i>
                                                        Montant Anormal — Carte {selectedAnomaly.carte}
                                                    </div>
                                                    <div style={{fontSize: 12, opacity: 0.9, marginTop: 2}}>{selectedAnomaly.date} — {selectedAnomaly.lieu}</div>
                                                </div>
                                                <button onClick={() => setSelectedAnomaly(null)} style={{background: 'none', border: 'none', color: 'white', fontSize: 20, cursor: 'pointer', padding: '0 4px'}}>&times;</button>
                                            </div>
                                        </div>
                                        <div style={{padding: '16px 20px'}}>
                                            {/* Détail transaction */}
                                            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, padding: 12, background: '#FFF3E0', borderRadius: 8}}>
                                                <div><div style={{fontSize: 10, color: '#999', textTransform: 'uppercase'}}>Montant</div><div style={{fontSize: 20, fontWeight: 700, color: '#D32F2F'}}>{selectedAnomaly.montant.toLocaleString('fr-FR')} DH</div></div>
                                                <div><div style={{fontSize: 10, color: '#999', textTransform: 'uppercase'}}>Médiane carte</div><div style={{fontSize: 20, fontWeight: 700, color: '#666'}}>{selectedAnomaly.mediane.toLocaleString('fr-FR')} DH</div></div>
                                                <div><div style={{fontSize: 10, color: '#999', textTransform: 'uppercase'}}>Produit</div><div style={{fontSize: 14, fontWeight: 600}}>{selectedAnomaly.produit || '—'}</div></div>
                                                <div><div style={{fontSize: 10, color: '#999', textTransform: 'uppercase'}}>Ratio</div><div style={{fontSize: 14, fontWeight: 700, color: '#D32F2F'}}>{(selectedAnomaly.montant / selectedAnomaly.mediane).toFixed(1)}× la médiane</div></div>
                                            </div>
                                            {/* Histogramme distribution montants */}
                                            {selectedAnomaly.historique && selectedAnomaly.historique.distribution && (() => {
                                                const dist = selectedAnomaly.historique.distribution;
                                                const maxCount = Math.max(...dist.map(d => d.count));
                                                const anomalyBucket = dist.findIndex(d => selectedAnomaly.montant >= d.lo && selectedAnomaly.montant < d.hi);
                                                return (
                                                    <div style={{marginBottom: 12}}>
                                                        <div style={{fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 8}}>Distribution des montants pour cette carte</div>
                                                        <div style={{display: 'flex', alignItems: 'flex-end', gap: 3, height: 80}}>
                                                            {dist.map((d, i) => {
                                                                const isAnomaly = i === anomalyBucket || (i === dist.length - 1 && anomalyBucket === -1);
                                                                const h = Math.max(4, (d.count / (maxCount || 1)) * 70);
                                                                return (
                                                                    <div key={i} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1}}>
                                                                        <div style={{fontSize: 9, color: isAnomaly ? '#D32F2F' : '#999', fontWeight: isAnomaly ? 700 : 400, marginBottom: 2}}>{d.count}</div>
                                                                        <div style={{width: '100%', maxWidth: 40, height: h, background: isAnomaly ? '#D32F2F' : '#EF9A9A', borderRadius: '4px 4px 0 0'}}></div>
                                                                        <div style={{fontSize: 8, color: '#999', marginTop: 2, whiteSpace: 'nowrap'}}>{d.lo}-{d.hi}</div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                        <div style={{fontSize: 10, color: '#999', marginTop: 6}}>
                                                            Min: {selectedAnomaly.historique.min} DH — Max: {selectedAnomaly.historique.max} DH — Médiane: {selectedAnomaly.historique.mediane} DH
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ===== KPIs ===== */}
                    <div className="kpi-grid" style={{gridTemplateColumns: 'repeat(4, 1fr)'}}>
                        <KPICard icon="fa-gas-pump" iconClass="orange" value={(carb.totalMois/1000).toFixed(1)} label="Total Mois (K DH)" onClick={() => setExpandedKPI(expandedKPI === 'carburant' ? null : 'carburant')} />
                        <KPICard icon="fa-chart-line" iconClass="blue" value={(carb.totalCampagne/1000).toFixed(0)} label="Total Carburants (K DH)" onClick={() => setExpandedKPI(expandedKPI === 'campagne' ? null : 'campagne')} />
                        <KPICard icon="fa-road" iconClass="green" value={(carb.totalPeages/1000).toFixed(1)} label="Total Péages (K DH)" onClick={() => setExpandedKPI(expandedKPI === 'peages' ? null : 'peages')} />
                        <KPICard icon="fa-droplet" iconClass="berry" value={(carb.prixMoyenLitre || 0).toFixed(2)} label="Prix Moyen / Litre (DH)" onClick={() => setExpandedKPI(expandedKPI === 'prix' ? null : 'prix')} />
                    </div>

                    {/* ===== DÉTAIL KPI CARBURANT PAR MOIS ===== */}
                    {expandedKPI === 'carburant' && (
                        <div style={{marginTop:8, marginBottom:16}}>
                            <Panel title="Carburant par Mois" icon="fa-gas-pump">
                                <SimpleBarChart data={(carb.evolution || []).map(e => ({ mois: e.label || e.mois, Carburant: e.carburant }))} dataKeys={['Carburant']} colors={['#F39C12']} xKey="mois" height={220} />
                            </Panel>
                        </div>
                    )}

                    {/* ===== DÉTAIL KPI PÉAGES PAR MOIS ===== */}
                    {expandedKPI === 'peages' && (
                        <div style={{marginTop:8, marginBottom:16}}>
                            <Panel title="Péages par Mois" icon="fa-road">
                                <SimpleBarChart data={(carb.evolution || []).map(e => ({ mois: e.label || e.mois, 'Péages': e.peages }))} dataKeys={['Péages']} colors={['#E74C3C']} xKey="mois" height={220} />
                            </Panel>
                        </div>
                    )}

                    {/* ===== DÉTAIL KPI CAMPAGNE — CUMUL & ÉVOLUTION ===== */}
                    {expandedKPI === 'campagne' && (
                        <div style={{marginTop:8, marginBottom:16}}>
                            <Panel title="Carburant — Cumul Campagne (carburant seul, hors péages)" icon="fa-chart-line">
                                <div style={{display:'flex',gap:16,marginBottom:16,flexWrap:'wrap',padding:'12px',background:'#f8f9fa',borderRadius:10}}>
                                    <div style={{flex:1,minWidth:140,textAlign:'center'}}>
                                        <div style={{fontSize:10,textTransform:'uppercase',color:'#888',marginBottom:4}}>Carburant Campagne</div>
                                        <div style={{fontSize:20,fontWeight:700,color:'#3498DB'}}>{(carb.totalCampagne/1000).toFixed(1)}k DH</div>
                                    </div>
                                    <div style={{flex:1,minWidth:140,textAlign:'center'}}>
                                        <div style={{fontSize:10,textTransform:'uppercase',color:'#888',marginBottom:4}}>+ Péages</div>
                                        <div style={{fontSize:20,fontWeight:700,color:'#E74C3C'}}>{(carb.totalPeages/1000).toFixed(1)}k DH</div>
                                    </div>
                                    <div style={{flex:1,minWidth:140,textAlign:'center',borderLeft:'2px solid #ddd',paddingLeft:16}}>
                                        <div style={{fontSize:10,textTransform:'uppercase',color:'#888',marginBottom:4}}>Total Gasoil & Gaz</div>
                                        <div style={{fontSize:22,fontWeight:700,color:'#2C3E50'}}>{((carb.totalCampagne + carb.totalPeages)/1000).toFixed(1)}k DH</div>
                                    </div>
                                    <div style={{flex:1,minWidth:140,textAlign:'center'}}>
                                        <div style={{fontSize:10,textTransform:'uppercase',color:'#888',marginBottom:4}}>Litres Total</div>
                                        <div style={{fontSize:20,fontWeight:700,color:'#27AE60'}}>{((carb.totalCampagne / (carb.prixMoyenLitre || 1))).toLocaleString('fr-FR', {maximumFractionDigits:0})} L</div>
                                    </div>
                                </div>
                                {(() => {
                                    const evol = carb.evolution || [];
                                    let cumul = 0;
                                    const cumulData = evol.map(e => { cumul += (e.carburant || 0); return { mois: e.label || e.mois, 'Carburant Mois': e.carburant, 'Cumul': Math.round(cumul) }; });
                                    return React.createElement(SimpleBarChart, { data: cumulData, dataKeys:['Carburant Mois','Cumul'], colors:['#3498DB','#1ABC9C'], xKey:'mois', height:240 });
                                })()}
                            </Panel>
                        </div>
                    )}

                    {/* ===== DÉTAIL KPI PRIX MOYEN PAR SEMAINE ===== */}
                    {expandedKPI === 'prix' && (
                        <div style={{marginTop:8, marginBottom:16}}>
                            <Panel title="Prix Moyen / Litre par Semaine (DH)" icon="fa-droplet">
                                <SimpleBarChart data={(carb.prixMoyenParSemaine || []).map(e => ({ semaine: e.semaine.replace(/^\d{4}-/, ''), 'Prix/L': e.prixMoyen }))} dataKeys={['Prix/L']} colors={['#8E44AD']} xKey="semaine" height={220} />
                            </Panel>
                        </div>
                    )}

                    {/* ===== CARBURANT PAR CARTE + EVOLUTION ===== */}
                    <div className="two-col">
                        <Panel title="Carburant par Carte" icon="fa-gas-pump">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Carte</th>
                                        <th>Collaborateur</th>
                                        <th>Véhicule</th>
                                        <th>Montant (DH)</th>
                                        <th>Litres</th>
                                        <th>Péages (DH)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(carb.parCarte || []).map((c, i) => {
                                        const mapping = cardMapping[c.carte] || {};
                                        return (
                                            <tr key={i}>
                                                <td><strong>{c.carte}</strong></td>
                                                <td>{mapping.collaborateur || '—'}</td>
                                                <td>{mapping.vehicule || '—'}</td>
                                                <td>{c.montant.toLocaleString('fr-FR')}</td>
                                                <td>{c.litres}</td>
                                                <td>{c.peages.toLocaleString('fr-FR')}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </Panel>

                        <Panel title="Évolution Carburant + Péages" icon="fa-chart-bar">
                            <SimpleBarChart data={chartDataEvol} dataKeys={['Carburant', 'Péages']} colors={['#F39C12', '#E74C3C']} xKey="mois" height={220} />
                            <div style={{marginTop:12,padding:'10px 14px',background:'#f8f9fa',borderRadius:8,display:'flex',gap:16,flexWrap:'wrap',justifyContent:'space-around',alignItems:'center'}}>
                                <div style={{textAlign:'center'}}>
                                    <div style={{fontSize:10,textTransform:'uppercase',color:'#888',marginBottom:2}}>Carburants</div>
                                    <div style={{fontSize:16,fontWeight:700,color:'#F39C12'}}>{(carb.totalCampagne/1000).toFixed(1)}k DH</div>
                                </div>
                                <div style={{fontSize:18,color:'#aaa',fontWeight:700}}>+</div>
                                <div style={{textAlign:'center'}}>
                                    <div style={{fontSize:10,textTransform:'uppercase',color:'#888',marginBottom:2}}>Péages</div>
                                    <div style={{fontSize:16,fontWeight:700,color:'#E74C3C'}}>{(carb.totalPeages/1000).toFixed(1)}k DH</div>
                                </div>
                                <div style={{fontSize:18,color:'#aaa',fontWeight:700}}>=</div>
                                <div style={{textAlign:'center',padding:'4px 14px',background:'#fff',borderRadius:8,border:'2px solid #2C3E50'}}>
                                    <div style={{fontSize:10,textTransform:'uppercase',color:'#888',marginBottom:2,fontWeight:600}}>Total Carburant & Péages</div>
                                    <div style={{fontSize:18,fontWeight:800,color:'#2C3E50'}}>{((carb.totalCampagne + carb.totalPeages)/1000).toFixed(1)}k DH</div>
                                </div>
                            </div>
                        </Panel>
                    </div>

                    {/* ===== TENDANCE LITRES/SEMAINE ===== */}
                    {carb.consumptionWeekly && carb.consumptionWeekly.length > 0 && (
                        <div style={{marginTop: 16}}>
                            <Panel title="Tendance Consommation Hebdomadaire (Top 5 Cartes)" icon="fa-chart-line">
                                <FuelWeeklyChart data={carb.consumptionWeekly} cardMapping={cardMapping} />
                            </Panel>
                        </div>
                    )}

                    {/* ===== TRANSACTIONS + TOP STATIONS ===== */}
                    <div className="two-col" style={{marginTop: 16}}>
                        <Panel title="20 Dernières Transactions" icon="fa-list">
                            <div style={{maxHeight: 350, overflowY: 'auto'}}>
                                <table className="data-table" style={{fontSize: 12}}>
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Station</th>
                                            <th>Produit</th>
                                            <th>Qté (L)</th>
                                            <th>Montant</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(carb.dernieresTransactions || []).map((t, i) => (
                                            <tr key={i}>
                                                <td style={{whiteSpace:'nowrap'}}>{t.date}</td>
                                                <td>{t.lieu}</td>
                                                <td>{t.produit}</td>
                                                <td>{t.quantite}</td>
                                                <td style={{whiteSpace:'nowrap'}}>{typeof t.montant === 'number' ? t.montant.toLocaleString('fr-FR') + ' DH' : t.montant}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Panel>

                        <Panel title="Top 5 Stations" icon="fa-ranking-star">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Station</th>
                                        <th>Passages</th>
                                        <th>Montant (DH)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(carb.topStations || []).map((s, i) => (
                                        <tr key={i}>
                                            <td><strong>{s.station}</strong></td>
                                            <td>{s.count}</td>
                                            <td>{s.montant.toLocaleString('fr-FR')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Panel>
                    </div>

                    {/* ===== SUIVI KILOMETRIQUE L/100km ===== */}
                    {carb.suiviKm && carb.suiviKm.points && carb.suiviKm.points.length > 0 && (
                        <div style={{marginTop: 16}}>
                            <Panel title={`Suivi Kilométrique — Carte ${carb.suiviKm.carte}`} icon="fa-gauge-high">
                                <div className="kpi-grid" style={{gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 12}}>
                                    <div style={{textAlign: 'center', padding: 12}}>
                                        <div style={{fontSize: 22, fontWeight: 700, color: 'var(--blue)'}}>{carb.suiviKm.moyenneL100}</div>
                                        <div style={{fontSize: 11, color: 'var(--gray-500)'}}>L/100km (moyenne)</div>
                                    </div>
                                    <div style={{textAlign: 'center', padding: 12}}>
                                        <div style={{fontSize: 22, fontWeight: 700, color: 'var(--green)'}}>{((carb.suiviKm && carb.suiviKm.kmTotal) || 0).toLocaleString('fr-FR')}</div>
                                        <div style={{fontSize: 11, color: 'var(--gray-500)'}}>km parcourus (campagne)</div>
                                    </div>
                                    <div style={{textAlign: 'center', padding: 12}}>
                                        <div style={{fontSize: 22, fontWeight: 700, color: 'var(--orange)'}}>{carb.suiviKm.points.length}</div>
                                        <div style={{fontSize: 11, color: 'var(--gray-500)'}}>relevés compteur</div>
                                    </div>
                                </div>
                                <FuelKmChart suiviKm={carb.suiviKm} />
                            </Panel>
                        </div>
                    )}

                    <div style={{marginTop: 16, padding: 16, background: 'var(--orange-pale)', borderRadius: 12, fontSize: 12, color: 'var(--gray-600)'}}>
                        <div><strong><i className="fa-solid fa-circle-info" style={{marginRight: 6}}></i>Source:</strong> Extranet TOTAL Energies — Cartes carburant entreprise. {carb.nbTransactions} transactions ({carb.campagne}).</div>
                        <div style={{marginTop: 8, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap'}}>
                            {syncTime && (
                                <span style={{display: 'flex', alignItems: 'center', gap: 6}}>
                                    <i className="fa-solid fa-clock-rotate-left" style={{color: '#e67e22'}}></i>
                                    <strong>Dernière synchro :</strong> {syncTime.toLocaleDateString('fr-FR', {day:'2-digit', month:'short', year:'numeric'})} à {syncTime.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}
                                </span>
                            )}
                            {carb.dernieresTransactions && carb.dernieresTransactions.length > 0 && (
                                <span style={{display: 'flex', alignItems: 'center', gap: 6}}>
                                    <i className="fa-solid fa-gas-pump" style={{color: '#e67e22'}}></i>
                                    <strong>Dernière transaction :</strong> {carb.dernieresTransactions[0].date}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

export { FinCarburantTab };
