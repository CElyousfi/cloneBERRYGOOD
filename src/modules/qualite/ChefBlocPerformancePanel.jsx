/* Module: qualite | Déclaration(s): ChefBlocPerformancePanel */
import { PARCELLES_CULTURALES } from '../agronomie/PARCELLES_CULTURALES.jsx';
import { getCycle } from '../agronomie/getCycle.jsx';
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';
import { Panel } from '../shared/Panel.jsx';
import { loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { useState } from '../shared/reactHooks.jsx';

function ChefBlocPerformancePanel({ data, farmFilter }) {
            const [bonsApport, setBonsApport] = useState([]);
            const [loading, setLoading] = useState(true);

            React.useEffect(() => {
                const loadBons = async () => {
                    try { setBonsApport(await loadBonsFromFirestore()); } catch(e) { console.error(e); }
                    setLoading(false);
                };
                loadBons();
            }, []);

            if (loading) return <Panel title={`Performance Production — ${farmFilter}`} icon="fa-cubes"><div style={{textAlign:'center',padding:20,color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin"></i></div></Panel>;

            // Map bons to parcelles using normalizeParcelle
            const currentCycle = getCycle(new Date().toISOString());
            const parcelles = PARCELLES_CULTURALES.filter(pc => pc.ferme === farmFilter && (pc.culture === 'Avocatier' || pc.cycle === currentCycle) && pc.enProduction !== false);
            const parcelleStats = {};
            parcelles.forEach(pc => {
                const label = pc.sousVariete ? `${pc.variete} ${pc.sousVariete}` : pc.variete;
                parcelleStats[pc.id] = { parcelle: pc, label, bons: 0, totalKg: 0, exportKg: 0, ecartKg: 0 };
            });

            bonsApport.forEach(b => {
                const kg = parseFloat(b.poidsLot) || 0;
                if (kg <= 0) return;
                const cycle = getCycle(b.date);
                if (cycle !== currentCycle) return; // Only count bons from current cycle
                const resolved = normalizeParcelle(b.designation || b.blocLabel || b.blocVariete);
                if (!resolved || resolved.ferme !== farmFilter) return;
                // Find matching parcelle
                const match = parcelles.find(pc =>
                    pc.variete === resolved.variete &&
                    (resolved.sousVariete ? pc.sousVariete === resolved.sousVariete : true)
                );
                if (match && parcelleStats[match.id]) {
                    parcelleStats[match.id].bons++;
                    parcelleStats[match.id].totalKg += kg;
                    if (b.typeVente === 'Export') parcelleStats[match.id].exportKg += kg;
                    else parcelleStats[match.id].ecartKg += kg;
                }
            });

            const activeBlocs = Object.values(parcelleStats).filter(s => s.bons > 0);
            if (activeBlocs.length === 0) return null;

            return (
                <Panel title={`Performance Production — ${farmFilter}`} icon="fa-cubes">
                    <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))', gap:16}}>
                        {activeBlocs.map((bs, i) => {
                            const tHa = bs.parcelle.ha > 0 ? Math.round(bs.exportKg / bs.parcelle.ha / 100) / 10 : 0;
                            const kgPlant = bs.parcelle.nbPlants > 0 ? Math.round(bs.exportKg / bs.parcelle.nbPlants * 100) / 100 : 0;
                            const ecartPct = bs.totalKg > 0 ? (bs.ecartKg / bs.totalKg * 100).toFixed(1) : '0.0';
                            const ecartColor = parseFloat(ecartPct) > 15 ? 'var(--red)' : parseFloat(ecartPct) > 10 ? 'var(--orange)' : 'var(--green)';
                            const isMyrtille = bs.parcelle.culture === 'Myrtille';
                            return (
                                <div key={i} style={{padding:16, border:'1px solid var(--gray-200)', borderRadius:12, background:'white'}}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
                                        <div>
                                            <div style={{fontSize:15, fontWeight:700, color:'var(--berry)'}}>{bs.label}</div>
                                            <div style={{fontSize:11, color:'var(--gray-400)'}}>{bs.parcelle.ferme} | {bs.parcelle.ha} Ha{bs.parcelle.nbTunnels ? ` | ${bs.parcelle.nbTunnels} tunnels` : ''}</div>
                                        </div>
                                        <span style={{padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:700,
                                            background: isMyrtille ? 'rgba(63,81,181,0.1)' : 'rgba(233,30,99,0.1)',
                                            color: isMyrtille ? '#283593' : '#c2185b'}}>{isMyrtille ? 'Myrtille' : 'Framboise'}</span>
                                    </div>
                                    <div style={{display:'grid', gridTemplateColumns: isMyrtille ? 'repeat(5, 1fr)' : 'repeat(4, 1fr)', gap:8, textAlign:'center'}}>
                                        <div><div style={{fontSize:18,fontWeight:700}}>{bs.bons}</div><div style={{fontSize:10,color:'var(--gray-400)'}}>Bons</div></div>
                                        <div><div style={{fontSize:18,fontWeight:700}}>{Math.round(bs.exportKg).toLocaleString('fr-FR')}</div><div style={{fontSize:10,color:'var(--gray-400)'}}>Kg Export</div></div>
                                        <div><div style={{fontSize:18,fontWeight:700,color:ecartColor}}>{ecartPct}%</div><div style={{fontSize:10,color:'var(--gray-400)'}}>Écarts</div></div>
                                        <div><div style={{fontSize:18,fontWeight:700,color:'var(--green)'}}>{tHa} T/Ha</div><div style={{fontSize:10,color:'var(--gray-400)'}}>Rendement</div></div>
                                        {isMyrtille && <div><div style={{fontSize:18,fontWeight:700,color:'#283593'}}>{kgPlant}</div><div style={{fontSize:10,color:'var(--gray-400)'}}>kg/plant</div></div>}
                                    </div>
                                    <div style={{marginTop:8}}>
                                        <div style={{height:6,background:'var(--gray-200)',borderRadius:3}}>
                                            <div style={{height:'100%',width:`${Math.min(tHa / 15 * 100, 100)}%`,background: tHa >= 10 ? 'var(--green)' : tHa >= 5 ? 'var(--orange)' : 'var(--red)',borderRadius:3}}></div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Panel>
            );
        }

export { ChefBlocPerformancePanel };
