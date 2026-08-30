/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): AgroFertilisationTab */
import { useState } from '../shared/reactHooks.jsx';
import { displayCulture } from './displayCulture.jsx';

function AgroFertilisationTab({ data, getAlias, getFerme }) {
            const agro = data.agroData;
            const apiStatus = data.agroApiStatus || 'idle';
            // Cascade filters: Ferme → Culture → Parcelle
            const [fermeFilter, setFermeFilter] = useState('Toutes');
            const [cultureFilter, setCultureFilter] = useState('Toutes');
            const [parcelleFilter, setParcelleFilter] = useState('Toutes');

            // Enrichir parcelles avec ferme assignée
            const enrichedParc = agro.parcelles.map(p => ({ ...p, displayFerme: getFerme(p.parcelle, p.ferme) }));

            // Fermes disponibles
            const fermes = ['Toutes', ...new Set(enrichedParc.map(p => p.displayFerme))].sort();

            // Filtrer par ferme
            const parcByFerme = fermeFilter === 'Toutes' ? enrichedParc : enrichedParc.filter(p => p.displayFerme === fermeFilter);

            // Cultures dans la ferme
            const cultures = ['Toutes', ...new Set(parcByFerme.map(p => displayCulture(p.culture)))];

            // Filtrer par culture
            const parcByCulture = cultureFilter === 'Toutes' ? parcByFerme : parcByFerme.filter(p => displayCulture(p.culture) === cultureFilter);

            // Parcelles culturales dans la sélection
            const parcNames = ['Toutes', ...parcByCulture.map(p => p.parcelle)];

            // Filtre final
            const parc = parcelleFilter === 'Toutes' ? parcByCulture : parcByCulture.filter(p => p.parcelle === parcelleFilter);

            // Reset cascading filters
            React.useEffect(() => { setCultureFilter('Toutes'); setParcelleFilter('Toutes'); }, [fermeFilter]);
            React.useEffect(() => { setParcelleFilter('Toutes'); }, [cultureFilter]);

            // Sort by engrais/Ha desc
            const sorted = [...parc].sort((a,b) => (b.engrais/b.sup) - (a.engrais/a.sup));
            const maxEngHa = sorted.length > 0 ? Math.max(...sorted.map(p => p.engrais/p.sup)) : 1;

            return (
                <div className="fade-in">
                    <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
                        <div>
                            <label style={{fontSize:10,color:'var(--gray-400)',display:'block',marginBottom:2}}>Ferme</label>
                            <select value={fermeFilter} onChange={e => setFermeFilter(e.target.value)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}}>
                                {fermes.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{fontSize:10,color:'var(--gray-400)',display:'block',marginBottom:2}}>Culture</label>
                            <select value={cultureFilter} onChange={e => setCultureFilter(e.target.value)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}}>
                                {cultures.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{fontSize:10,color:'var(--gray-400)',display:'block',marginBottom:2}}>Parcelle Culturale</label>
                            <select value={parcelleFilter} onChange={e => setParcelleFilter(e.target.value)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,maxWidth:280}}>
                                {parcNames.map(p => <option key={p} value={p}>{p === 'Toutes' ? 'Toutes' : getAlias(p)}</option>)}
                            </select>
                        </div>
                        {apiStatus === 'ok' && <span style={{background:'#d4edda',color:'#155724',padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:600,marginTop:14}}>SQL Live</span>}
                        {apiStatus === 'loading' && <span style={{background:'#fff3cd',color:'#856404',padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:600,marginTop:14}}><i className="fa-solid fa-spinner fa-spin"></i> Chargement SQL...</span>}
                        <div style={{marginLeft:'auto',fontSize:12,color:'var(--gray-400)',marginTop:14}}>
                            {parc.length} parcelles — {parc.reduce((s,p)=>s+p.sup,0).toFixed(1)} Ha
                        </div>
                    </div>

                    {/* Bilan par parcelle */}
                    <div className="panel">
                        <h3><i className="fa-solid fa-flask"></i> Bilan NPK Cumulé par Parcelle (kg/Ha) — Campagne {agro.campagne}</h3>
                        <div className="table-responsive"><table>
                            <thead><tr>
                                <th>Parcelle</th><th>Culture</th><th>Ferme</th><th>Sup</th>
                                <th style={{color:'#2E86C1'}}>N/Ha</th><th style={{color:'#E74C3C'}}>P2O5/Ha</th><th style={{color:'#F39C12'}}>K2O/Ha</th>
                                <th style={{color:'#8E44AD'}}>CaO/Ha</th><th style={{color:'#1ABC9C'}}>MgO/Ha</th><th>Ca/K</th><th>Eng/Ha</th>
                            </tr></thead>
                            <tbody>
                                {sorted.map((p,i) => {
                                    const nH = (p.N/p.sup).toFixed(1);
                                    const pH = (p.P2O5/p.sup).toFixed(1);
                                    const kH = (p.K2O/p.sup).toFixed(1);
                                    const caH = (p.CaO/p.sup).toFixed(1);
                                    const mgH = (p.MgO/p.sup).toFixed(1);
                                    const engH = Math.round(p.engrais/p.sup);
                                    const caK = p.K2O > 0 ? (p.CaO/p.K2O).toFixed(2) : '—';
                                    const caKOk = p.K2O > 0 && (p.CaO/p.K2O) >= 0.5 && (p.CaO/p.K2O) <= 2.0;
                                    return (
                                        <tr key={i} style={engH > 2000 ? {background:'#fff8e1'} : {}}>
                                            <td><strong style={{fontSize:12}}>{getAlias(p.parcelle)}</strong></td>
                                            <td>{displayCulture(p.culture)}</td><td>{p.displayFerme}</td><td>{p.sup}</td>
                                            <td style={{fontWeight:600,color:'#2E86C1'}}>{nH}</td>
                                            <td style={{fontWeight:600,color:'#E74C3C'}}>{pH}</td>
                                            <td style={{fontWeight:600,color:'#F39C12'}}>{kH}</td>
                                            <td style={{fontWeight:600,color:'#8E44AD'}}>{caH}</td>
                                            <td style={{fontWeight:600,color:'#1ABC9C'}}>{mgH}</td>
                                            <td><span className={`badge ${caKOk ? 'badge-success' : 'badge-warning'}`}>{caK}</span></td>
                                            <td style={{fontWeight:600}}>{engH.toLocaleString()}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table></div>
                    </div>

                    {/* Top Engrais */}
                    <div className="panel">
                        <h3><i className="fa-solid fa-ranking-star"></i> Top Engrais (quantité totale kg)</h3>
                        <div className="table-responsive"><table>
                            <thead><tr><th>Produit</th><th>Type</th><th>Quantité (kg)</th><th>% du total</th><th style={{width:'40%'}}>Barre</th></tr></thead>
                            <tbody>
                                {agro.topEngrais.map((e,i) => {
                                    const pct = (e.qty / agro.topEngrais[0].qty * 100).toFixed(1);
                                    return (
                                        <tr key={i}>
                                            <td><strong>{e.article}</strong></td>
                                            <td style={{fontSize:12}}>{e.type}</td>
                                            <td style={{fontWeight:600}}>{e.qty.toLocaleString()}</td>
                                            <td>{pct}%</td>
                                            <td><div style={{height:16,borderRadius:4,background:'var(--green)',opacity:0.7,width:`${pct}%`,minWidth:4}}></div></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table></div>
                    </div>
                </div>
            );
        }

export { AgroFertilisationTab };
