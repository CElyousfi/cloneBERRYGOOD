/* Module: qualite | Déclaration(s): ChefHorsRecoltePanel */
import { Panel } from '../shared/Panel.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ===================== CHEF HORS RÉCOLTE PANEL =====================
        function ChefHorsRecoltePanel({ data, farmFilter }) {
            const [progress, setProgress] = useState([]);
            const [demandes, setDemandes] = useState([]);
            const [normProposals, setNormProposals] = useState([]);
            const [normesData, setNormesData] = useState([]);
            const [parcellesConfig, setParcellesConfig] = useState([]);
            const [loading, setLoading] = useState(true);
            const [validating, setValidating] = useState(null);
            const [editingParc, setEditingParc] = useState(null);
            const [editNbTunnels, setEditNbTunnels] = useState('');

            const parcelles = parcellesConfig.length > 0 ? parcellesConfig : (data.parcelleConfig[farmFilter] || []);

            React.useEffect(() => {
                const fq = `&ferme=${farmFilter}`;
                Promise.all([
                    fetch(`/api/hors-recolte-suivi?action=get-progress${fq}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=get-demandes${fq}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=get-norm-proposals${fq}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=get-normes${fq}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=get-parcelles-config${fq}`).then(r => r.json()),
                ]).then(([progRes, demRes, normPropRes, normRes, parcRes]) => {
                    if (progRes.success) setProgress(progRes.progress || []);
                    if (demRes.success) setDemandes(demRes.demandes || []);
                    if (normPropRes.success) setNormProposals(normPropRes.proposals || []);
                    if (normRes.success) setNormesData(normRes.normes || []);
                    if (parcRes.success && Array.isArray(parcRes.parcelles)) setParcellesConfig(parcRes.parcelles);
                }).catch(() => {}).finally(() => setLoading(false));
            }, [farmFilter]);

            const handleNormDecision = async (proposalId, decision) => {
                setValidating(proposalId);
                try {
                    await fetch('/api/hors-recolte-suivi?action=validate-norm-change', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ proposalId, decision, chef: `chef_${farmFilter.toLowerCase()}` }),
                    });
                    setNormProposals(prev => prev.filter(p => p.id !== proposalId));
                    if (decision) {
                        const normRes = await fetch(`/api/hors-recolte-suivi?action=get-normes&ferme=${farmFilter}`).then(r => r.json());
                        if (normRes.success) setNormesData(normRes.normes || []);
                    }
                } catch (e) {}
                setValidating(null);
            };

            const handleSaveParcelle = async (parcelle) => {
                setValidating(parcelle);
                try {
                    await fetch('/api/hors-recolte-suivi?action=update-parcelle-config', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ferme: farmFilter, parcelle, nbTunnels: Number(editNbTunnels), unite: 'tunnels' }),
                    });
                    setParcellesConfig(prev => prev.map(p => (p.parcelle || p.nom) === parcelle ? { ...p, nbTunnels: Number(editNbTunnels) } : p));
                    setEditingParc(null);
                } catch (e) {}
                setValidating(null);
            };

            const handleValidation = async (demandeId, decision) => {
                setValidating(demandeId);
                try {
                    await fetch('/api/hors-recolte-suivi?action=valider-reexecution', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ demandeId, decision, chef: `chef_${farmFilter.toLowerCase()}` }),
                    });
                    setDemandes(prev => prev.filter(d => d.id !== demandeId));
                    if (decision) {
                        // Refresh progress after approval
                        const resp = await fetch(`/api/hors-recolte-suivi?action=get-progress&ferme=${farmFilter}`).then(r => r.json());
                        if (resp.success) setProgress(resp.progress || []);
                    }
                } catch (e) {}
                setValidating(null);
            };

            if (loading) return null;
            if (progress.length === 0 && demandes.length === 0) return null;

            // Group progress by parcelle
            const byParcelle = {};
            progress.forEach(p => {
                if (!byParcelle[p.parcelle]) byParcelle[p.parcelle] = [];
                byParcelle[p.parcelle].push(p);
            });

            return (
                <React.Fragment>
                    <Panel title={`Avancement Hors Récolte — ${farmFilter}`} icon="fa-chart-gantt"
                        actions={demandes.length > 0 ? <span style={{fontSize:10, padding:'3px 10px', borderRadius:10, background:'var(--red)', color:'white', fontWeight:700}}>{demandes.length} demande{demandes.length>1?'s':''}</span> : null}>

                        {Object.entries(byParcelle).map(([parcelleName, tasks]) => {
                            const parcConfig = parcelles.find(p => (p.parcelle || p.nom) === parcelleName);
                            const nbTotal = parcConfig ? parcConfig.nbTunnels : 0;

                            return (
                                <div key={parcelleName} style={{marginBottom:16}}>
                                    <div style={{fontSize:12, fontWeight:700, color:'var(--berry)', marginBottom:8}}>
                                        <i className="fa-solid fa-seedling" style={{marginRight:6}}></i>{parcelleName}
                                        {nbTotal > 0 && <span style={{fontWeight:400, color:'var(--gray-400)', marginLeft:6}}>{nbTotal} tunnels</span>}
                                    </div>
                                    {tasks.map((t, i) => {
                                        const pct = nbTotal > 0 ? Math.min(100, Math.round(t.totalRealise / nbTotal * 100)) : 0;
                                        return (
                                            <div key={i} style={{display:'flex', alignItems:'center', gap:10, marginBottom:6, padding:'4px 0'}}>
                                                <span style={{fontSize:11, fontWeight:600, minWidth:120}}>{t.tache}</span>
                                                <div style={{flex:1, height:8, background:'var(--gray-200)', borderRadius:4, overflow:'hidden'}}>
                                                    <div style={{width:`${pct}%`, height:'100%', borderRadius:4, transition:'width 0.3s',
                                                        background: pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--berry)'}} />
                                                </div>
                                                <span style={{fontSize:10, fontWeight:700, minWidth:30, textAlign:'right',
                                                    color: pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--berry)'}}>{pct}%</span>
                                                <span style={{fontSize:9, color:'var(--gray-400)', minWidth:50, textAlign:'right'}}>{t.totalRealise}/{nbTotal}</span>
                                                {t.termine && <span style={{fontSize:8, padding:'1px 6px', borderRadius:6, background:'var(--green)', color:'white', fontWeight:700}}>OK</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}

                        {/* Demandes de re-exécution */}
                        {demandes.length > 0 && (
                            <div style={{marginTop:16, borderTop:'1px solid var(--gray-100)', paddingTop:16}}>
                                <div style={{fontSize:12, fontWeight:700, color:'var(--orange)', marginBottom:10}}>
                                    <i className="fa-solid fa-bell" style={{marginRight:6}}></i>Demandes de re-exécution
                                </div>
                                {demandes.map((d, i) => (
                                    <div key={i} style={{padding:12, background:'rgba(243,156,18,0.05)', border:'1px solid rgba(243,156,18,0.2)', borderRadius:10, marginBottom:8}}>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6}}>
                                            <div>
                                                <span style={{fontSize:12, fontWeight:700}}>{d.parcelle}</span>
                                                <span style={{fontSize:11, color:'var(--gray-500)', marginLeft:8}}>{d.tache}</span>
                                            </div>
                                            <span style={{fontSize:9, color:'var(--gray-400)'}}>{d.caporal}</span>
                                        </div>
                                        <div style={{fontSize:11, color:'var(--gray-600)', marginBottom:8, fontStyle:'italic'}}>
                                            "{d.justification}"
                                            {d.nbTunnels > 0 && <span style={{fontWeight:600, color:'var(--orange)', marginLeft:6}}>({d.nbTunnels} tunnels)</span>}
                                        </div>
                                        <div style={{display:'flex', gap:8}}>
                                            <button onClick={() => handleValidation(d.id, true)} disabled={validating === d.id}
                                                style={{padding:'5px 14px', background:'var(--green)', color:'white', border:'none', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                                                <i className="fa-solid fa-check" style={{marginRight:4}}></i>Valider
                                            </button>
                                            <button onClick={() => handleValidation(d.id, false)} disabled={validating === d.id}
                                                style={{padding:'5px 14px', background:'var(--red)', color:'white', border:'none', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                                                <i className="fa-solid fa-times" style={{marginRight:4}}></i>Refuser
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Panel>

                    {/* Norm adjustment proposals */}
                    {normProposals.length > 0 && (
                        <Panel title="Propositions de révision de normes" icon="fa-chart-line"
                            actions={<span style={{fontSize:10, padding:'3px 10px', borderRadius:10, background:'var(--blue)', color:'white', fontWeight:700}}>{normProposals.length}</span>}>
                            {normProposals.map((prop, i) => (
                                <div key={i} style={{padding:12, background:'rgba(52,152,219,0.05)', border:'1px solid rgba(52,152,219,0.2)', borderRadius:10, marginBottom:8}}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
                                        <div>
                                            <span style={{fontSize:12, fontWeight:700}}>{prop.tache}</span>
                                            {prop.ferme && <span style={{fontSize:10, color:'var(--gray-400)', marginLeft:8}}>{prop.ferme}</span>}
                                        </div>
                                        <span style={{fontSize:10, fontWeight:700, color:'var(--blue)'}}>
                                            {prop.ancienneValeur} → {prop.nouvelleValeur} tunnels/jour/ouv.
                                        </span>
                                    </div>
                                    <div style={{fontSize:10, color:'var(--gray-500)', marginBottom:8}}>
                                        Rendement moyen: <strong style={{color:'var(--green)'}}>{prop.detailsDetection?.rendementMoyen || '—'}%</strong> de la norme
                                        sur {prop.detailsDetection?.nbJours || '—'} jours ({prop.detailsDetection?.nbOuvriers || '—'} ouvriers en moyenne)
                                    </div>
                                    <div style={{display:'flex', gap:8}}>
                                        <button onClick={() => handleNormDecision(prop.id, true)} disabled={validating === prop.id}
                                            style={{padding:'5px 14px', background:'var(--green)', color:'white', border:'none', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                                            <i className="fa-solid fa-check" style={{marginRight:4}}></i>Appliquer
                                        </button>
                                        <button onClick={() => handleNormDecision(prop.id, false)} disabled={validating === prop.id}
                                            style={{padding:'5px 14px', background:'var(--gray-300)', color:'var(--gray-600)', border:'none', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                                            <i className="fa-solid fa-times" style={{marginRight:4}}></i>Refuser
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </Panel>
                    )}

                    {/* Normes actuelles */}
                    {normesData.length > 0 && (
                        <Panel title="Normes de productivité" icon="fa-sliders">
                            <table className="data-table" style={{fontSize:11}}>
                                <thead>
                                    <tr>
                                        <th>Tâche</th>
                                        <th style={{textAlign:'center'}}>Norme</th>
                                        <th style={{textAlign:'center'}}>Unité</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {normesData.map((n, i) => (
                                        <tr key={i}>
                                            <td style={{fontWeight:600}}>{n.tache}</td>
                                            <td style={{textAlign:'center', fontWeight:700, color:'var(--berry)'}}>{n.normeParJourParOuvrier || n.normeTunnelsParJourParOuvrier}</td>
                                            <td style={{textAlign:'center', fontSize:10, color:'var(--gray-400)'}}>{n.unite || 'tunnels'}/jour/ouv.</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Panel>
                    )}

                    {/* Config parcelles */}
                    {parcelles.length > 0 && (
                        <Panel title="Configuration Parcelles" icon="fa-gear">
                            <table className="data-table" style={{fontSize:11}}>
                                <thead>
                                    <tr>
                                        <th>Parcelle</th>
                                        <th>Variété</th>
                                        <th style={{textAlign:'center'}}>Nb Tunnels</th>
                                        <th style={{textAlign:'center'}}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {parcelles.map((p, i) => {
                                        const pName = p.parcelle || p.nom;
                                        const isEditing = editingParc === pName;
                                        return (
                                            <tr key={i}>
                                                <td style={{fontWeight:600}}>{pName}</td>
                                                <td style={{color:'var(--gray-500)'}}>{p.variete || '—'}</td>
                                                <td style={{textAlign:'center'}}>
                                                    {isEditing ? (
                                                        <input type="number" min="1" value={editNbTunnels} onChange={e => setEditNbTunnels(e.target.value)}
                                                            style={{width:60, padding:'3px 6px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:12, textAlign:'center', fontWeight:700}} />
                                                    ) : (
                                                        <span style={{fontWeight:700, color:'var(--berry)'}}>{p.nbTunnels || 0}</span>
                                                    )}
                                                </td>
                                                <td style={{textAlign:'center'}}>
                                                    {isEditing ? (
                                                        <div style={{display:'flex', gap:4, justifyContent:'center'}}>
                                                            <button onClick={() => handleSaveParcelle(pName)} disabled={validating === pName}
                                                                style={{padding:'3px 8px', background:'var(--green)', color:'white', border:'none', borderRadius:4, fontSize:10, cursor:'pointer'}}>
                                                                <i className="fa-solid fa-check"></i>
                                                            </button>
                                                            <button onClick={() => setEditingParc(null)}
                                                                style={{padding:'3px 8px', background:'var(--gray-200)', color:'var(--gray-600)', border:'none', borderRadius:4, fontSize:10, cursor:'pointer'}}>
                                                                <i className="fa-solid fa-times"></i>
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button onClick={() => { setEditingParc(pName); setEditNbTunnels(String(p.nbTunnels || 0)); }}
                                                            style={{padding:'3px 8px', background:'var(--gray-100)', color:'var(--gray-500)', border:'none', borderRadius:4, fontSize:10, cursor:'pointer'}}>
                                                            <i className="fa-solid fa-pen" style={{marginRight:3}}></i>Modifier
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </Panel>
                    )}
                </React.Fragment>
            );
        }

export { ChefHorsRecoltePanel };
