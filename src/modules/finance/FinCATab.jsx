/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): FinCATab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { SimpleBarChart } from '../shared/SimpleBarChart.jsx';
import { SimplePieChart } from '../shared/SimplePieChart.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { computeCADetail } from './computeCADetail.jsx';

function FinCATab({ data }) {
            const [filterFerme, setFilterFerme] = useState('');
            const [loading, setLoading] = useState(true);
            const [error, setError] = useState(null);
            const [liqData, setLiqData] = useState(null);
            const [marcheLocalBons, setMarcheLocalBons] = useState(null);

            // Fetch liquidations + expeditions + marché local
            React.useEffect(() => {
                Promise.all([
                    cachedFetch('/api/email-analysis?action=liquidations'),
                    cachedFetch('/api/email-analysis?action=expeditions&limit=2000'),
                    (async () => {
                        const allBons = [];
                        try {
                            const prodBons = await loadBonsFromFirestore();
                            prodBons.filter(b => b.typeVente === 'Marché Local').forEach(b => allBons.push(b));
                        } catch(e) {}
                        try {
                            if (typeof firebase !== 'undefined' && firebase.firestore) {
                                const snap = await firebase.firestore().collection('bons_marche_local').get();
                                snap.forEach(d => allBons.push({ id: d.id, ...d.data(), source: 'firestore' }));
                            }
                        } catch(e) {}
                        return allBons;
                    })()
                ]).then(([liqJson, expJson, bons]) => {
                    if (liqJson.success) {
                        setLiqData({
                            liquidations: (liqJson.liquidations || []).filter(l => l.rows && l.rows.length > 0),
                            expeditions: expJson.success ? expJson.expeditions || [] : []
                        });
                    } else {
                        setError('Erreur chargement liquidations');
                    }
                    setMarcheLocalBons(bons);
                    setLoading(false);
                }).catch(err => { setError(err.message); setLoading(false); });
            }, []);

            // Loading / Error states
            if (loading) return (
                <div style={{textAlign:'center', padding:60}}>
                    <i className="fa-solid fa-spinner fa-spin" style={{fontSize:24, color:'var(--gray-400)'}}></i>
                    <p style={{marginTop:12, color:'var(--gray-500)'}}>Chargement des données CA...</p>
                </div>
            );
            if (error) return (
                <div style={{textAlign:'center', padding:60, color:'var(--red-500)'}}>
                    <i className="fa-solid fa-triangle-exclamation" style={{fontSize:24}}></i>
                    <p style={{marginTop:12}}>{error}</p>
                </div>
            );

            // Calcul extrait dans computeCADetail.jsx (production readiness, 2026-09-14)
            // — même fonction pure que celle appelée depuis AuthenticatedApp.jsx pour
            // le Dashboard : un seul calcul, jamais deux chiffres divergents pour le
            // même CA. Voir docs/DATA_SOURCES.md.
            const { totalExport, totalLocal, totalCA, totalKgExport, caDetail, totalHaConfig } = computeCADetail({
                liquidations: liqData ? liqData.liquidations : [],
                expeditions: liqData ? liqData.expeditions : [],
                marcheLocalBons,
            });

            const filtered = filterFerme ? caDetail.filter(c => c.ferme === filterFerme) : caDetail;
            const totalFiltered = filtered.reduce((s, c) => s + c.ca, 0);
            const totalKgFiltered = filtered.reduce((s, c) => s + c.kg, 0);

            return (
                <div className="fade-in">
                    <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:12}}>
                        <i className="fa-solid fa-circle" style={{color:'#2D8B4E', fontSize:8, marginRight:6}}></i>
                        Données LIVE — {liqData ? liqData.liquidations.length : 0} liquidations, {marcheLocalBons ? marcheLocalBons.length : 0} bons locaux
                    </div>

                    <div className="kpi-grid">
                        <KPICard icon="fa-coins" iconClass="green" value={`${(totalCA/1000000).toFixed(1)}M`} label="CA Total (DH)" subItems={[{value:'Export', label:`${(totalExport/1000).toFixed(0)}K`}, {value:'Local', label:`${(totalLocal/1000).toFixed(0)}K`}]} />
                        <KPICard icon="fa-weight-scale" iconClass="berry" value={`${(totalKgExport/1000).toFixed(1)}T`} label="Tonnage Export" />
                        <KPICard icon="fa-calculator" iconClass="blue" value={`${totalKgExport > 0 ? Math.round(totalExport/totalKgExport) : 0}`} label="Prix Moyen Export (DH/Kg)" />
                        <KPICard icon="fa-leaf" iconClass="orange" value={`${totalHaConfig}`} label="Superficie (Ha)" />
                    </div>

                    <div style={{display:'flex', gap:12, marginBottom:16, alignItems:'center', flexWrap:'wrap'}}>
                        <label style={{fontSize:12, fontWeight:600}}>Filtrer par ferme:</label>
                        <select className="filter-select" value={filterFerme} onChange={e => setFilterFerme(e.target.value)}>
                            <option value="">Toutes les fermes</option>
                            <option value="F1">F1 - Larache</option>
                            <option value="F5">F5 - Kénitra</option>
                        </select>
                    </div>

                    <Panel title="Chiffre d'Affaires par Variété" icon="fa-coins">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Variété</th>
                                    <th>Ferme</th>
                                    <th>Ha</th>
                                    <th style={{textAlign:'right'}}>Quantité (Kg)</th>
                                    <th style={{textAlign:'right'}}>CA (DH)</th>
                                    <th style={{textAlign:'right'}}>Prix Moy.</th>
                                    <th style={{textAlign:'right'}}>CA/Ha</th>
                                    <th style={{textAlign:'right'}}>% CA</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((c, i) => (
                                    <tr key={i}>
                                        <td><strong>{c.variete}</strong></td>
                                        <td><span className={`farm-tag ${c.ferme === 'F1' ? 'f1' : (c.ferme === 'F5' ? 'f5' : 'avo')}`}>{c.ferme}</span></td>
                                        <td>{c.ha}</td>
                                        <td style={{textAlign:'right'}}>{c.kg.toLocaleString('fr-FR')}</td>
                                        <td style={{textAlign:'right', fontWeight:'600'}}>{Math.round(c.ca).toLocaleString('fr-FR')}</td>
                                        <td style={{textAlign:'right'}}>{c.prixMoyen.toFixed(2)}</td>
                                        <td style={{textAlign:'right'}}>{c.caHa.toLocaleString('fr-FR')}</td>
                                        <td style={{textAlign:'right', fontWeight:'600'}}>{c.pctCA}%</td>
                                    </tr>
                                ))}
                                <tr style={{background:'var(--gray-100)', fontWeight:700}}>
                                    <td colSpan="3">TOTAL</td>
                                    <td style={{textAlign:'right'}}>{totalKgFiltered.toLocaleString('fr-FR')}</td>
                                    <td style={{textAlign:'right'}}>{Math.round(totalFiltered).toLocaleString('fr-FR')}</td>
                                    <td></td>
                                    <td></td>
                                    <td style={{textAlign:'right'}}>{totalCA > 0 ? Math.round(totalFiltered/totalCA*100) : 0}%</td>
                                </tr>
                            </tbody>
                        </table>
                    </Panel>

                    <Panel title="CA par Variété" icon="fa-chart-bar">
                        <SimpleBarChart
                            data={filtered.map(c => ({variete: c.variete.substring(0, 15), caK: Math.round(c.ca/1000)}))}
                            dataKeys={['caK']}
                            colors={['#D4A847']}
                            xKey="variete"
                            height={220}
                        />
                    </Panel>

                    {/* Répartition Export vs Local */}
                    <Panel title="Répartition Export vs Local" icon="fa-pie-chart">
                        <div style={{display:'flex', gap:'24px', alignItems:'center', justifyContent:'center', flexWrap:'wrap'}}>
                            <SimplePieChart
                                data={[{name:'Export', value: totalExport}, {name:'Local', value: totalLocal}]}
                                colors={['#2D8B4E', '#D4A847']}
                                size={180}
                            />
                            <div>
                                <div style={{marginBottom:'8px'}}><span style={{display:'inline-block', width:'12px', height:'12px', background:'#2D8B4E', borderRadius:'2px', marginRight:'8px'}}></span><strong>Export Driscoll's:</strong> {(totalExport/1000).toFixed(0)}K DH ({totalCA > 0 ? Math.round(totalExport/totalCA*100) : 0}%)</div>
                                <div><span style={{display:'inline-block', width:'12px', height:'12px', background:'#D4A847', borderRadius:'2px', marginRight:'8px'}}></span><strong>Local:</strong> {(totalLocal/1000).toFixed(0)}K DH ({totalCA > 0 ? Math.round(totalLocal/totalCA*100) : 0}%)</div>
                            </div>
                        </div>
                    </Panel>
                </div>
            );
        }

export { FinCATab };
