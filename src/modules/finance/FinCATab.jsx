/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): FinCATab */
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { SimpleBarChart } from '../shared/SimpleBarChart.jsx';
import { SimplePieChart } from '../shared/SimplePieChart.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { useState } from '../shared/reactHooks.jsx';

function FinCATab({ data }) {
            const [filterFerme, setFilterFerme] = useState('');
            const [loading, setLoading] = useState(true);
            const [error, setError] = useState(null);
            const [liqData, setLiqData] = useState(null);
            const [marcheLocalBons, setMarcheLocalBons] = useState(null);

            // Config hectares statique (données physiques de la ferme)
            const VARIETES_HA = {
                'Maravilla GC|F1': { label: 'S1/S4 Maravilla MD', ha: 4.2, culture: 'Framboise' },
                'Maravilla LC|F1': { label: 'S3/S7 Maravilla MT', ha: 5.2, culture: 'Framboise' },
                'Yazmin|F1': { label: 'S2/S5 Yazmin MD', ha: 2.0, culture: 'Framboise' },
                'Yazmin|F5': { label: 'S10/S13 Yazmin F5', ha: 4.7, culture: 'Framboise' },
                'Reyna|F5': { label: 'S9 Reyna', ha: 3.0, culture: 'Framboise' },
                'Corina|F5': { label: 'Corina S8', ha: 2.5, culture: 'Myrtille' },
                'Cascade|F5': { label: 'Cascade S8-1', ha: 1.5, culture: 'Myrtille' },
                'Breeze|F5': { label: 'Breeze S8-2', ha: 1.0, culture: 'Myrtille' },
            };
            const totalHaConfig = 54.8;

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

            // --- Agréger CA Export depuis les liquidations (même logique que CPC tab) ---
            const liqCAByVariety = {};
            if (liqData) {
                const expByReceipt = {};
                (liqData.expeditions || []).forEach(exp => {
                    const rid = (exp.receiptId || '').trim();
                    if (rid) expByReceipt[rid] = exp;
                });
                const addLiqCA = (variete, ferme, kg, montant) => {
                    const key = variete + '|' + ferme;
                    if (!liqCAByVariety[key]) liqCAByVariety[key] = { kg: 0, montant: 0 };
                    liqCAByVariety[key].kg += kg;
                    liqCAByVariety[key].montant += montant;
                };
                (liqData.liquidations || []).forEach(liq => {
                    (liq.rows || []).forEach(row => {
                        const kg = row.receiptQtyKg || 0;
                        const gs = row.gsNet || 0;
                        if (kg <= 0 && gs <= 0) return;
                        const vName = row.variety || row.varietyCode || '';
                        const norm = normalizeParcelle(vName);
                        let variete = norm ? norm.variete : vName;
                        let ferme = norm ? norm.ferme : null;

                        const rid = (row.receiptId || '').trim();
                        const matchedExp = rid ? expByReceipt[rid] : null;
                        if (matchedExp) {
                            if (!ferme) ferme = matchedExp.ferme;
                            if (variete === 'Maravilla' && (!norm || !norm.sousVariete)) {
                                const expNorm = normalizeParcelle(matchedExp.variety);
                                if (expNorm && expNorm.sousVariete === 'Green Cane') variete = 'Maravilla GC';
                                else if (expNorm && expNorm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                                else if (expNorm && expNorm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                            }
                        }
                        if (variete === 'Maravilla' && norm && norm.sousVariete) {
                            if (norm.sousVariete === 'Green Cane' || norm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                            else if (norm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                        }
                        if (variete === 'Maravilla') {
                            const haGC = 4.2, haLC = 5.2, haT = haGC + haLC;
                            addLiqCA('Maravilla GC', 'F1', kg * haGC / haT, gs * haGC / haT);
                            addLiqCA('Maravilla LC', 'F1', kg * haLC / haT, gs * haLC / haT);
                            return;
                        }
                        if (variete === 'Yazmin' && !matchedExp) {
                            const haF1 = 2.0, haF5 = 4.7, haT = haF1 + haF5;
                            addLiqCA('Yazmin', 'F1', kg * haF1 / haT, gs * haF1 / haT);
                            addLiqCA('Yazmin', 'F5', kg * haF5 / haT, gs * haF5 / haT);
                            return;
                        }
                        if (!ferme) ferme = 'F1';
                        addLiqCA(variete, ferme, kg, gs);
                    });
                });
            }

            // --- CA Marché Local (pfq_interne + bons_marche_local) ---
            const localCAByVariety = {};
            const localKgByVariety = {};
            if (marcheLocalBons && marcheLocalBons.length > 0) {
                marcheLocalBons.forEach(bon => {
                    const rawVariete = bon.variete || bon.blocVariete || bon.designation || '';
                    const norm = normalizeParcelle(rawVariete);
                    let variete = norm ? norm.variete : (rawVariete || 'Autre');
                    let ferme = bon.ferme || bon.blocFerme || (norm ? norm.ferme : 'F1');
                    if (variete === 'Maravilla' && norm && norm.sousVariete) {
                        if (norm.sousVariete === 'Green Cane' || norm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                        else if (norm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                    }
                    if (variete === 'Maravilla') {
                        const montant = parseFloat(bon.totalDH) || 0;
                        const kgLocal = parseFloat(bon.poidsLot) || 0;
                        const haGC = 4.2, haLC = 5.2, haT = haGC + haLC;
                        const kGC = 'Maravilla GC|F1', kLC = 'Maravilla LC|F1';
                        if (!localCAByVariety[kGC]) localCAByVariety[kGC] = 0;
                        if (!localCAByVariety[kLC]) localCAByVariety[kLC] = 0;
                        if (!localKgByVariety[kGC]) localKgByVariety[kGC] = 0;
                        if (!localKgByVariety[kLC]) localKgByVariety[kLC] = 0;
                        localCAByVariety[kGC] += montant * haGC / haT;
                        localCAByVariety[kLC] += montant * haLC / haT;
                        localKgByVariety[kGC] += kgLocal * haGC / haT;
                        localKgByVariety[kLC] += kgLocal * haLC / haT;
                        return;
                    }
                    const key = variete + '|' + ferme;
                    if (!localCAByVariety[key]) localCAByVariety[key] = 0;
                    if (!localKgByVariety[key]) localKgByVariety[key] = 0;
                    const montant = parseFloat(bon.totalDH) || ((parseFloat(bon.poidsLot) || 0) * (parseFloat(bon.prixDH) || 0));
                    localCAByVariety[key] += montant;
                    localKgByVariety[key] += parseFloat(bon.poidsLot) || 0;
                });
            }

            // --- Construire caDetail dynamiquement ---
            const allKeys = new Set([...Object.keys(liqCAByVariety), ...Object.keys(localCAByVariety)]);
            const totalExport = Object.values(liqCAByVariety).reduce((s, v) => s + v.montant, 0);
            const totalLocal = Object.values(localCAByVariety).reduce((s, v) => s + v, 0);
            const totalCA = totalExport + totalLocal;
            const totalKgExport = Object.values(liqCAByVariety).reduce((s, v) => s + v.kg, 0);

            const caDetail = [];
            allKeys.forEach(key => {
                const [variete, ferme] = key.split('|');
                const expData = liqCAByVariety[key] || { kg: 0, montant: 0 };
                const localMontant = localCAByVariety[key] || 0;
                const localKg = localKgByVariety[key] || 0;
                const configMatch = VARIETES_HA[key];
                const ha = configMatch ? configMatch.ha : 1;
                const ca = expData.montant + localMontant;
                const totalKg = expData.kg + localKg;
                if (ca <= 0) return;
                caDetail.push({
                    variete: configMatch ? configMatch.label : `${variete} (${ferme})`,
                    ferme,
                    culture: configMatch ? configMatch.culture : 'Framboise',
                    kg: totalKg,
                    ca,
                    prixMoyen: totalKg > 0 ? Math.round(ca / totalKg * 100) / 100 : 0,
                    ha,
                    caHa: Math.round(ca / ha),
                    pctCA: totalCA > 0 ? Math.round(ca / totalCA * 100 * 10) / 10 : 0,
                });
            });
            caDetail.sort((a, b) => b.ca - a.ca);

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
