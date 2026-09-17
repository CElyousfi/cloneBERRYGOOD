/* Module: finance | Déclaration(s): FinTelecomTab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { SimpleBarChart } from '../shared/SimpleBarChart.jsx';

function FinTelecomTab({ data }) {
            const [telecom, setTelecom] = React.useState(null);
            const [lineMapping, setLineMapping] = React.useState({});
            const [loading, setLoading] = React.useState(true);
            const [error, setError] = React.useState(null);
            const [showAnomalies, setShowAnomalies] = React.useState(false);
            const [syncTime, setSyncTime] = React.useState(null);
            const [expandedKPI, setExpandedKPI] = React.useState(null);

            React.useEffect(() => {
                Promise.all([
                    fetch('/api/telecom?action=summary').then(r => r.json()),
                    fetch('/telecom-line-mapping.json').then(r => r.json()).catch(() => ({}))
                ]).then(([telecomData, mapping]) => {
                    if (telecomData.success) {
                        setTelecom(telecomData);
                        setLineMapping(mapping || {});
                        setSyncTime(new Date());
                    } else {
                        setError(telecomData.error || 'Erreur API');
                    }
                    setLoading(false);
                }).catch(err => {
                    setError(err.message);
                    setLoading(false);
                });
            }, []);

            if (loading) return <div style={{textAlign:'center', padding:60}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:24, color:'var(--gray-400)'}}></i><p style={{marginTop:12, color:'var(--gray-500)'}}>Chargement des données télécom...</p></div>;
            if (error) return <div style={{textAlign:'center', padding:60, color:'var(--red-500)'}}><i className="fa-solid fa-triangle-exclamation" style={{fontSize:24}}></i><p style={{marginTop:12}}>{error}</p></div>;
            if (!telecom) return null;

            const chartDataEvol = (telecom.evolution || []).map(e => ({
                mois: e.label || e.mois,
                Montant: e.montant
            }));

            const anomalies = telecom.anomalies || [];

            // Calcul du décalage données télécom (factures mensuelles → seuil 35 jours)
            let decalageJours = null;
            let lastFacturePeriode = null;
            if (telecom.dernieresFactures && telecom.dernieresFactures.length > 0) {
                const lastPeriode = telecom.dernieresFactures[0].periode || '';
                const [yyyy, mm] = lastPeriode.split('-');
                if (yyyy && mm) {
                    // End of the billing period month
                    const lastDate = new Date(parseInt(yyyy), parseInt(mm), 0); // last day of month
                    decalageJours = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
                    lastFacturePeriode = lastPeriode;
                }
            }
            const decalageCritical = decalageJours !== null && decalageJours >= 60;
            const decalageWarning = decalageJours !== null && decalageJours >= 35;

            // Chart répartition si données dispo
            const hasDetailData = (telecom.evolution || []).some(e => (e.appels || 0) + (e.sms || 0) + (e.data || 0) > 0);
            const chartDataRepartition = hasDetailData ? (telecom.evolution || []).map(e => ({
                mois: e.label || e.mois,
                Appels: e.appels || 0,
                SMS: e.sms || 0,
                Data: e.data || 0
            })) : [];

            return (
                <div className="fade-in">
                    {/* ===== ALERTE DÉCALAGE DONNÉES ===== */}
                    {decalageWarning && (
                        <div style={{padding:'12px 16px', background: decalageCritical ? 'rgba(231,76,60,0.1)' : 'rgba(243,156,18,0.1)', border: '1px solid ' + (decalageCritical ? 'rgba(231,76,60,0.3)' : 'rgba(243,156,18,0.3)'), borderRadius:10, marginBottom:16, display:'flex', alignItems:'center', gap:12, fontSize:13}}>
                            <i className={'fa-solid ' + (decalageCritical ? 'fa-circle-exclamation' : 'fa-triangle-exclamation')} style={{fontSize:18, color: decalageCritical ? '#e74c3c' : '#f39c12'}}></i>
                            <div>
                                <span style={{fontWeight:700, color: decalageCritical ? '#c0392b' : '#856404'}}>Données télécom non actualisées depuis {decalageJours} jours</span>
                                <span style={{marginLeft:8, color:'var(--gray-500)', fontSize:11}}>(dernière période : {lastFacturePeriode})</span>
                            </div>
                        </div>
                    )}

                    {/* ===== ALERTES ANOMALIES ===== */}
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
                                    <div style={{fontSize: 11, fontWeight: 600, color: '#BF360C', textTransform: 'uppercase', marginBottom: 4}}>
                                        <i className="fa-solid fa-chart-line" style={{marginRight: 4}}></i> Pics de consommation ({anomalies.length})
                                    </div>
                                    <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                                        {anomalies.slice(0, 10).map((a, i) => (
                                            <span key={i} style={{display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#FFCCBC', borderRadius: 6, fontSize: 11}}>
                                                <strong>{a.ligne}</strong> — {a.periode}: <span style={{color:'#D84315', fontWeight:700}}>{a.montant.toLocaleString('fr-FR')} DH</span> (moy: {a.moyenne} DH, ×{a.ratio})
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ===== KPIs ===== */}
                    <div className="kpi-grid" style={{gridTemplateColumns: 'repeat(4, 1fr)'}}>
                        <KPICard icon="fa-phone" iconClass="orange" value={(telecom.totalMois/1000).toFixed(1)} label="Total Mois (K DH)" />
                        <KPICard icon="fa-chart-line" iconClass="blue" value={(telecom.totalCampagne/1000).toFixed(0)} label="Total Campagne (K DH)" />
                        <KPICard icon="fa-sim-card" iconClass="green" value={telecom.nbLignes} label="Nombre de Lignes" />
                        <KPICard icon="fa-calculator" iconClass="berry" value={(telecom.coutMoyenLigne || 0).toLocaleString('fr-FR')} label="Coût Moyen / Ligne (DH)" />
                    </div>

                    {/* ===== CONSOMMATION PAR LIGNE + EVOLUTION ===== */}
                    <div className="two-col">
                        <Panel title="Consommation par Ligne" icon="fa-phone">
                            <div style={{maxHeight: 400, overflowY: 'auto'}}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Ligne</th>
                                            <th>Collaborateur</th>
                                            <th>Service</th>
                                            <th>Montant (DH)</th>
                                            <th>Forfait</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(telecom.parLigne || []).map((l, i) => {
                                            const mapping = lineMapping[l.ligne] || {};
                                            return (
                                                <tr key={i}>
                                                    <td><strong>{l.ligne}</strong></td>
                                                    <td>{mapping.collaborateur || '—'}</td>
                                                    <td>{mapping.service || '—'}</td>
                                                    <td>{l.montant.toLocaleString('fr-FR')}</td>
                                                    <td>{l.forfait || '—'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </Panel>

                        <Panel title="Évolution Mensuelle" icon="fa-chart-bar">
                            <SimpleBarChart data={chartDataEvol} dataKeys={['Montant']} colors={['#3498DB']} xKey="mois" height={220} />
                        </Panel>
                    </div>

                    {/* ===== RÉPARTITION APPELS/SMS/DATA ===== */}
                    {hasDetailData && (
                        <div style={{marginTop: 16}}>
                            <Panel title="Répartition Appels / SMS / Data" icon="fa-chart-bar">
                                <SimpleBarChart data={chartDataRepartition} dataKeys={['Appels', 'SMS', 'Data']} colors={['#E67E22', '#2ECC71', '#3498DB']} xKey="mois" height={220} />
                            </Panel>
                        </div>
                    )}

                    {/* ===== DERNIÈRES FACTURES ===== */}
                    <div style={{marginTop: 16}}>
                        <Panel title="Dernières Factures" icon="fa-file-invoice">
                            <div style={{maxHeight: 350, overflowY: 'auto'}}>
                                <table className="data-table" style={{fontSize: 12}}>
                                    <thead>
                                        <tr>
                                            <th>Période</th>
                                            <th>Ligne</th>
                                            <th>Forfait</th>
                                            <th>Montant (DH)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(telecom.dernieresFactures || []).map((f, i) => (
                                            <tr key={i}>
                                                <td style={{whiteSpace:'nowrap'}}>{f.periode}</td>
                                                <td><strong>{f.ligne}</strong></td>
                                                <td>{f.forfait || '—'}</td>
                                                <td>{typeof f.montant === 'number' ? f.montant.toLocaleString('fr-FR') + ' DH' : f.montant}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Panel>
                    </div>

                    <div style={{marginTop: 16, padding: 16, background: 'var(--orange-pale)', borderRadius: 12, fontSize: 12, color: 'var(--gray-600)'}}>
                        <div><strong><i className="fa-solid fa-circle-info" style={{marginRight: 6}}></i>Source:</strong> Espace Business IAM — Factures télécom entreprise. {telecom.nbFactures} factures ({telecom.campagne}).</div>
                        <div style={{marginTop: 8, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap'}}>
                            {telecom.lastSyncAt && (() => {
                                const syncDate = new Date(telecom.lastSyncAt);
                                return (
                                    <span style={{display: 'flex', alignItems: 'center', gap: 6}}>
                                        <i className="fa-solid fa-clock-rotate-left" style={{color: '#3498db'}}></i>
                                        <strong>Dernière synchronisation automatique :</strong> {syncDate.toLocaleDateString('fr-FR', {day:'2-digit', month:'short', year:'numeric'})} à {syncDate.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}
                                    </span>
                                );
                            })()}
                            {telecom.dernieresFactures && telecom.dernieresFactures.length > 0 && (
                                <span style={{display: 'flex', alignItems: 'center', gap: 6}}>
                                    <i className="fa-solid fa-file-invoice" style={{color: '#3498db'}}></i>
                                    <strong>Dernière facture :</strong> {telecom.dernieresFactures[0].periode}
                                </span>
                            )}
                        </div>
                        <div style={{marginTop: 8, fontSize: 11, color: 'var(--gray-500)', fontStyle: 'italic'}}>
                            <i className="fa-solid fa-robot" style={{marginRight: 6}}></i>
                            Récupération automatique chaque jour. Si la facture n'est pas encore publiée, le système réessaie automatiquement le lendemain.
                        </div>
                    </div>
                </div>
            );
        }

export { FinTelecomTab };
