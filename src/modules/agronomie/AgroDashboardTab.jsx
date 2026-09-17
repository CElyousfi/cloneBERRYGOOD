/* Module: agronomie | Déclaration(s): AgroDashboardTab */


// ===================== AGRONOMIE TABS (DONNÉES RÉELLES — Make.com / BR_Consommation) =====================
        function AgroDashboardTab({ data, getAlias }) {
            const agro = data.agroData;
            const apiStatus = data.agroApiStatus || 'idle';
            const parc = agro.parcelles;
            const cult = agro.cultures;
            const totalHa = parc.reduce((s,p) => s + p.sup, 0);
            const totalN = parc.reduce((s,p) => s + p.N, 0);
            const totalP = parc.reduce((s,p) => s + p.P2O5, 0);
            const totalK = parc.reduce((s,p) => s + p.K2O, 0);
            const totalCaO = parc.reduce((s,p) => s + p.CaO, 0);
            const totalMgO = parc.reduce((s,p) => s + p.MgO, 0);
            const totalEng = parc.reduce((s,p) => s + p.engrais, 0);
            const totalPest = parc.reduce((s,p) => s + p.pest, 0);

            // NPK par culture for bar chart
            const cultColors = { 'Avocat':'#27AE60', 'Myrtille':'#8E44AD', 'Framboise Maravilla':'#E74C3C', 'Framboise Yazmin':'#F39C12', 'Framboise Reyna':'#3498DB' };
            const maxKHa = Math.max(...cult.map(c => c.K_Ha));

            const sourceIcon = apiStatus === 'ok' ? 'fa-database' : apiStatus === 'loading' ? 'fa-spinner fa-spin' : 'fa-triangle-exclamation';
            const sourceColor = apiStatus === 'ok' ? 'var(--green)' : apiStatus === 'loading' ? '#F39C12' : '#E74C3C';
            const sourceText = apiStatus === 'ok'
                ? `Campagne ${agro.campagne} — Données SQL (BR_Consommation) au ${agro.dateExtraction} — ${parc.length} parcelles / ${totalHa.toFixed(1)} Ha`
                : apiStatus === 'loading'
                ? 'Chargement des données...'
                : `Campagne ${agro.campagne} — Données locales (fallback) — ${parc.length} parcelles / ${totalHa.toFixed(1)} Ha`;

            return (
                <div className="fade-in">
                    <div style={{background:'linear-gradient(135deg,#2D8B4E11,#8B225211)',borderRadius:16,padding:'12px 20px',marginBottom:16,display:'flex',alignItems:'center',gap:12}}>
                        <i className={`fa-solid ${sourceIcon}`} style={{color:sourceColor,fontSize:18}}></i>
                        <span style={{fontSize:13,color:'var(--gray-500)'}}>{sourceText}</span>
                        {apiStatus === 'ok' && <span style={{marginLeft:'auto',background:'#d4edda',color:'#155724',padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:600}}>SQL Live</span>}
                        {apiStatus === 'error' && <span style={{marginLeft:'auto',background:'#fff3cd',color:'#856404',padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:600}}>Fallback local</span>}
                    </div>
                    <div className="kpi-row">
                        <div className="kpi-card" style={{borderLeftColor:'#2E86C1'}}><div className="kpi-value">{Math.round(totalN).toLocaleString()} kg</div><div className="kpi-label">Azote (N)</div><div className="kpi-sub">{(totalN/totalHa).toFixed(1)} kg/Ha</div></div>
                        <div className="kpi-card" style={{borderLeftColor:'#E74C3C'}}><div className="kpi-value">{Math.round(totalP).toLocaleString()} kg</div><div className="kpi-label">Phosphore (P2O5)</div><div className="kpi-sub">{(totalP/totalHa).toFixed(1)} kg/Ha</div></div>
                        <div className="kpi-card" style={{borderLeftColor:'#F39C12'}}><div className="kpi-value">{Math.round(totalK).toLocaleString()} kg</div><div className="kpi-label">Potassium (K2O)</div><div className="kpi-sub">{(totalK/totalHa).toFixed(1)} kg/Ha</div></div>
                        <div className="kpi-card" style={{borderLeftColor:'#8E44AD'}}><div className="kpi-value">{Math.round(totalCaO).toLocaleString()} kg</div><div className="kpi-label">Calcium (CaO)</div><div className="kpi-sub">{(totalCaO/totalHa).toFixed(1)} kg/Ha</div></div>
                    </div>
                    <div className="kpi-row">
                        <div className="kpi-card" style={{borderLeftColor:'#1ABC9C'}}><div className="kpi-value">{Math.round(totalMgO).toLocaleString()} kg</div><div className="kpi-label">Magnésium (MgO)</div><div className="kpi-sub">{(totalMgO/totalHa).toFixed(1)} kg/Ha</div></div>
                        <div className="kpi-card" style={{borderLeftColor:'#27AE60'}}><div className="kpi-value">{(totalEng/1000).toFixed(1)}t</div><div className="kpi-label">Engrais Total</div><div className="kpi-sub">{Math.round(totalEng/totalHa)} kg/Ha</div></div>
                        <div className="kpi-card" style={{borderLeftColor:'#E67E22'}}><div className="kpi-value">{Math.round(totalPest)} kg</div><div className="kpi-label">Pesticides Total</div><div className="kpi-sub">{(totalPest/totalHa).toFixed(1)} kg/Ha</div></div>
                        <div className="kpi-card" style={{borderLeftColor:'var(--berry)'}}><div className="kpi-value">{agro.pesticides.length}</div><div className="kpi-label">Produits Phyto</div><div className="kpi-sub">{agro.topEngrais.length} engrais</div></div>
                    </div>

                    {/* NPK par culture - bar chart */}
                    <div className="panel">
                        <h3><i className="fa-solid fa-chart-bar"></i> Apports NPK par Culture (kg/Ha cumulé campagne)</h3>
                        <svg viewBox="0 0 700 280" style={{width:'100%',maxWidth:700}}>
                            {cult.map((c, i) => {
                                const y = 30 + i * 48;
                                const wN = (c.N_Ha / (maxKHa||1)) * 400;
                                const wP = (c.P_Ha / (maxKHa||1)) * 400;
                                const wK = (c.K_Ha / (maxKHa||1)) * 400;
                                return (
                                    <g key={i}>
                                        <text x={5} y={y+12} fontSize="11" fill="#333" fontWeight="600">{c.culture}</text>
                                        <text x={5} y={y+24} fontSize="9" fill="#999">{c.sup} Ha</text>
                                        <rect x={150} y={y} width={wN} height={10} fill="#2E86C1" rx={2}/>
                                        <text x={155+wN} y={y+9} fontSize="9" fill="#2E86C1">{c.N_Ha}</text>
                                        <rect x={150} y={y+12} width={wP} height={10} fill="#E74C3C" rx={2}/>
                                        <text x={155+wP} y={y+21} fontSize="9" fill="#E74C3C">{c.P_Ha}</text>
                                        <rect x={150} y={y+24} width={wK} height={10} fill="#F39C12" rx={2}/>
                                        <text x={155+wK} y={y+33} fontSize="9" fill="#F39C12">{c.K_Ha}</text>
                                    </g>
                                );
                            })}
                            <rect x={150} y={270} width={12} height={8} fill="#2E86C1" rx={1}/><text x={166} y={277} fontSize="10" fill="#666">N/Ha</text>
                            <rect x={220} y={270} width={12} height={8} fill="#E74C3C" rx={1}/><text x={236} y={277} fontSize="10" fill="#666">P2O5/Ha</text>
                            <rect x={310} y={270} width={12} height={8} fill="#F39C12" rx={1}/><text x={326} y={277} fontSize="10" fill="#666">K2O/Ha</text>
                        </svg>
                    </div>

                    {/* Culture summary table */}
                    <div className="panel">
                        <h3><i className="fa-solid fa-seedling"></i> Bilan NPK par Culture</h3>
                        <div className="table-responsive"><table>
                            <thead><tr><th>Culture</th><th>Sup</th><th style={{color:'#2E86C1'}}>N/Ha</th><th style={{color:'#E74C3C'}}>P2O5/Ha</th><th style={{color:'#F39C12'}}>K2O/Ha</th><th style={{color:'#8E44AD'}}>CaO/Ha</th><th style={{color:'#1ABC9C'}}>MgO/Ha</th><th>Ca/K</th><th>Eng/Ha</th><th>Pest/Ha</th></tr></thead>
                            <tbody>
                                {cult.map((c,i) => {
                                    const caKOk = c.Ca_K >= 0.5 && c.Ca_K <= 2.0;
                                    return (
                                        <tr key={i}>
                                            <td><strong>{c.culture}</strong></td><td>{c.sup}</td>
                                            <td style={{fontWeight:600,color:'#2E86C1'}}>{c.N_Ha}</td>
                                            <td style={{fontWeight:600,color:'#E74C3C'}}>{c.P_Ha}</td>
                                            <td style={{fontWeight:600,color:'#F39C12'}}>{c.K_Ha}</td>
                                            <td style={{fontWeight:600,color:'#8E44AD'}}>{c.CaO_Ha}</td>
                                            <td style={{fontWeight:600,color:'#1ABC9C'}}>{c.MgO_Ha}</td>
                                            <td><span className={`badge ${caKOk ? 'badge-success' : 'badge-warning'}`}>{c.Ca_K}</span></td>
                                            <td>{c.Eng_Ha}</td><td>{c.Pest_Ha}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table></div>
                    </div>

                    {/* Alertes dynamiques */}
                    <div className="panel">
                        <h3><i className="fa-solid fa-triangle-exclamation"></i> Alertes & Tendances</h3>
                        <div style={{display:'flex',flexDirection:'column',gap:12}}>
                            {(() => {
                                const alerts = [];
                                // Alerte parcelles avec forte consommation engrais/Ha
                                const topConsumers = [...parc].sort((a,b) => (b.engrais/b.sup) - (a.engrais/a.sup)).slice(0,2);
                                topConsumers.forEach(p => {
                                    const engHa = Math.round(p.engrais / p.sup);
                                    if (engHa > 1500) {
                                        alerts.push(<div key={'eng_'+p.parcelle} style={{padding:'12px 16px',borderRadius:10,background:'#fff3cd',borderLeft:'4px solid #F39C12'}}>
                                            <strong>{getAlias(p.parcelle)}:</strong> Consommation engrais élevée ({p.engrais.toLocaleString()} kg soit {engHa.toLocaleString()} kg/Ha sur {p.sup} Ha).
                                        </div>);
                                    }
                                });
                                // Alerte K2O/Ha élevé
                                const topK = [...parc].sort((a,b) => (b.K2O/b.sup) - (a.K2O/a.sup))[0];
                                if (topK && (topK.K2O/topK.sup) > 200) {
                                    alerts.push(<div key="topK" style={{padding:'12px 16px',borderRadius:10,background:'#fff3cd',borderLeft:'4px solid #E74C3C'}}>
                                        <strong>{getAlias(topK.parcelle)}:</strong> Plus haute intensité K2O ({Math.round(topK.K2O/topK.sup)} kg/Ha sur {topK.sup} Ha) — demande potassique concentrée.
                                    </div>);
                                }
                                // Ratio Ca/K par culture
                                const fruitRouge = cult.filter(c => c.culture.includes('Framboise') || c.culture === 'Myrtille');
                                if (fruitRouge.length > 0) {
                                    const caKVals = fruitRouge.map(c => c.Ca_K);
                                    alerts.push(<div key="cak" style={{padding:'12px 16px',borderRadius:10,background:'#d4edda',borderLeft:'4px solid #27AE60'}}>
                                        <strong>Ratio Ca/K fruits rouges:</strong> {fruitRouge.map(c => `${c.culture.replace('Framboise ','')} Ca/K=${c.Ca_K}`).join(', ')}. {caKVals.some(v => v < 0.5) ? 'Ratio bas (forte consommation K pour la fructification).' : 'Ratios dans la norme.'}
                                    </div>);
                                }
                                // Ratio N:P:K
                                const npkCultures = cult.filter(c => c.N_Ha > 0);
                                if (npkCultures.length > 0) {
                                    const ratios = npkCultures.map(c => `${c.culture} 1:${(c.P_Ha/c.N_Ha).toFixed(2)}:${(c.K_Ha/c.N_Ha).toFixed(2)}`).join(', ');
                                    alerts.push(<div key="npk" style={{padding:'12px 16px',borderRadius:10,background:'#d1ecf1',borderLeft:'4px solid #3498DB'}}>
                                        <strong>Ratio N:P:K:</strong> {ratios}
                                    </div>);
                                }
                                return alerts.length > 0 ? alerts : <div style={{color:'var(--gray-400)',fontStyle:'italic'}}>Aucune alerte pour cette campagne.</div>;
                            })()}
                        </div>
                    </div>
                </div>
            );
        }

export { AgroDashboardTab };
