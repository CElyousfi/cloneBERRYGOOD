/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): FinVirementsTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== FINANCE: VIREMENTS TAB =====================
        function FinVirementsTab({ currentProfile, profileData }) {
            const [virements, setVirements] = useState([]);
            const [loading, setLoading] = useState(true);
            const statusColors = { en_attente: '#f39c12', approuve: '#2980b9', execute: '#27ae60', rejete: '#e74c3c' };
            const statusLabels = { en_attente: 'En attente', approuve: 'Approuvé', execute: 'Exécuté', rejete: 'Rejeté' };

            const load = () => { setLoading(true); fetch('/api/stock?action=list-demandes-virement').then(r=>r.json()).then(j=>{ if(j.success) setVirements(j.virements||[]); }).catch(()=>{}).finally(()=>setLoading(false)); };
            useEffect(()=>{ load(); }, []);

            const handleValidate = (id, decision) => {
                const rib = decision==='approuve' ? prompt('Saisir le RIB du fournisseur :') : null;
                if (decision==='approuve' && !rib) return;
                fetch('/api/stock?action=validate-virement', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, decision, rib: rib||'', validated_by: { uid: currentProfile, name: profileData?.name||currentProfile } }) })
                .then(r=>r.json()).then(j=>{ if(j.success) load(); else alert('Erreur: '+j.error); }).catch(()=>alert('Erreur réseau'));
            };

            if (loading) return React.createElement('div', {style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));
            return (
                <div className="fade-in">
                    <div style={{marginBottom:12,fontSize:13,color:'#666'}}><i className="fa-solid fa-money-bill-transfer" style={{marginRight:6,color:'var(--berry)'}}></i>{virements.length} demande(s) de virement</div>
                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>N°</th><th>Fournisseur</th><th>Montant TTC</th><th>Motif</th><th>RIB</th><th>Statut</th><th>Actions</th></tr></thead>
                        <tbody>
                            {virements.map(v => (
                                <tr key={v.id}>
                                    <td style={{fontFamily:'monospace',fontWeight:700,fontSize:12}}>{v.numero}</td>
                                    <td style={{fontWeight:600}}>{v.fournisseur?.nom||'—'}</td>
                                    <td style={{fontFamily:'monospace',fontWeight:700,color:'var(--berry)'}}>{(v.montant_ttc||0).toFixed(2)} MAD</td>
                                    <td style={{fontSize:12,color:'#666',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v.motif||'—'}</td>
                                    <td style={{fontFamily:'monospace',fontSize:11}}>{v.fournisseur?.rib||<span style={{color:'#aaa'}}>À saisir</span>}</td>
                                    <td><span style={{background: statusColors[v.status]+'22',color: statusColors[v.status],padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:600}}>{statusLabels[v.status]||v.status}</span></td>
                                    <td>
                                        {v.status==='en_attente' && (
                                            <div style={{display:'flex',gap:6}}>
                                                <button onClick={()=>handleValidate(v.id,'approuve')} style={{background:'#2980b9',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11,fontWeight:600}}>Approuver</button>
                                                <button onClick={()=>handleValidate(v.id,'rejete')} style={{background:'none',border:'1px solid #e74c3c',color:'#e74c3c',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11}}>Rejeter</button>
                                            </div>
                                        )}
                                        {v.status==='approuve' && <button onClick={()=>handleValidate(v.id,'execute')} style={{background:'#27ae60',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11,fontWeight:600}}>Marquer exécuté</button>}
                                    </td>
                                </tr>
                            ))}
                            {virements.length===0 && <tr><td colSpan={7} style={{textAlign:'center',padding:30,color:'#aaa'}}>Aucune demande de virement en cours</td></tr>}
                        </tbody>
                    </table></div>
                </div>
            );
        }

export { FinVirementsTab };
