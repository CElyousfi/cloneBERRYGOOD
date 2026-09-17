/* Module: rh | Déclaration(s): WorkerDetailModal */


function WorkerDetailModal({ workerPopup, setWorkerPopup, workerLoading }) {
            if (workerLoading) return (
                <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.3)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <div style={{background:'#fff',borderRadius:12,padding:30,textAlign:'center',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                        <i className="fa-solid fa-spinner fa-spin fa-2x" style={{color:'var(--berry)'}}></i>
                        <div style={{marginTop:12,fontWeight:600}}>Chargement fiche ouvrier...</div>
                    </div>
                </div>
            );
            if (!workerPopup) return null;
            const w = workerPopup;
            return (
                <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setWorkerPopup(null)}>
                    <div style={{background:'#fff',borderRadius:16,maxWidth:700,width:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                        <div style={{padding:'20px 24px',background:'linear-gradient(135deg, var(--berry) 0%, #6b1a3a 100%)',borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                            <div>
                                <div style={{fontSize:18,fontWeight:700}}><i className="fa-solid fa-user" style={{marginRight:8}}></i>{w.nom}</div>
                                <div style={{fontSize:13,opacity:0.85,marginTop:4}}>
                                    <span style={{fontFamily:'monospace',background:'rgba(255,255,255,0.2)',padding:'2px 8px',borderRadius:6,marginRight:8}}>{w.matricule}</span>
                                    Équipe: {w.equipe} — {w.ferme}
                                </div>
                            </div>
                            <button onClick={() => setWorkerPopup(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div style={{padding:'16px 24px',display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))',gap:12}}>
                            <div style={{background:'var(--berry-pale)',borderRadius:10,padding:12,textAlign:'center'}}>
                                <div style={{fontSize:10,color:'var(--gray-500)'}}>Premier jour</div>
                                <div style={{fontSize:13,fontWeight:700,color:'var(--berry)'}}>{new Date(w.premierJour+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})}</div>
                            </div>
                            <div style={{background:'var(--green-pale)',borderRadius:10,padding:12,textAlign:'center'}}>
                                <div style={{fontSize:10,color:'var(--gray-500)'}}>Dernier jour</div>
                                <div style={{fontSize:13,fontWeight:700,color:'var(--green)'}}>{new Date(w.dernierJour+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})}</div>
                            </div>
                            <div style={{background:'#e8f4fd',borderRadius:10,padding:12,textAlign:'center'}}>
                                <div style={{fontSize:10,color:'var(--gray-500)'}}>Jours pointés</div>
                                <div style={{fontSize:13,fontWeight:700,color:'#1565C0'}}>{w.nbJoursDistincts}</div>
                            </div>
                            <div style={{background:'#fff3e0',borderRadius:10,padding:12,textAlign:'center'}}>
                                <div style={{fontSize:10,color:'var(--gray-500)'}}>Total Heures</div>
                                <div style={{fontSize:13,fontWeight:700,color:'#e65100'}}>{w.totalHeures}h</div>
                            </div>
                            <div style={{background:'var(--berry-pale)',borderRadius:10,padding:12,textAlign:'center'}}>
                                <div style={{fontSize:10,color:'var(--gray-500)'}}>Coût Total</div>
                                <div style={{fontSize:13,fontWeight:700,color:'var(--berry)'}}>{w.totalCout.toLocaleString('fr-FR')} DH</div>
                            </div>
                            {w.totalQuantite > 0 && (
                            <div style={{background:'var(--green-pale)',borderRadius:10,padding:12,textAlign:'center'}}>
                                <div style={{fontSize:10,color:'var(--gray-500)'}}>Total Quantité</div>
                                <div style={{fontSize:13,fontWeight:700,color:'var(--green)'}}>{w.totalQuantite}</div>
                            </div>
                            )}
                        </div>
                        <div style={{padding:'0 24px',marginBottom:8,display:'flex',gap:8,flexWrap:'wrap'}}>
                            {w.operationFamilles && w.operationFamilles.length > 0 && w.operationFamilles.map((f, i) => (
                                <span key={i} style={{fontSize:10,padding:'3px 10px',borderRadius:8,background:'var(--gray-100)',color:'var(--gray-600)',fontWeight:500}}>
                                    <i className="fa-solid fa-briefcase" style={{marginRight:4}}></i>{f}
                                </span>
                            ))}
                            {w.parcelles && w.parcelles.length > 0 && w.parcelles.slice(0,5).map((p, i) => (
                                <span key={i} style={{fontSize:10,padding:'3px 10px',borderRadius:8,background:'var(--green-pale)',color:'var(--green)',fontWeight:500}}>
                                    <i className="fa-solid fa-map-pin" style={{marginRight:4}}></i>{p}
                                </span>
                            ))}
                            {w.nbQuinzaines && (
                                <span style={{fontSize:10,padding:'3px 10px',borderRadius:8,background:'#e8f4fd',color:'#1565C0',fontWeight:500}}>
                                    <i className="fa-solid fa-calendar" style={{marginRight:4}}></i>{w.nbQuinzaines} quinzaine{w.nbQuinzaines>1?'s':''}
                                </span>
                            )}
                        </div>
                        <div style={{padding:'0 24px 20px'}}>
                            <div style={{fontSize:13,fontWeight:700,marginBottom:8}}><i className="fa-solid fa-clock-rotate-left" style={{marginRight:6,color:'var(--berry)'}}></i>Historique Pointage (derniers 30 jours)</div>
                            <div style={{maxHeight:250,overflowY:'auto'}}>
                            <table className="data-table" style={{fontSize:11}}>
                                <thead><tr><th>Date</th><th>Période</th><th>Opération</th><th>Parcelle</th><th>Heures</th><th>Qté</th><th>Coût</th></tr></thead>
                                <tbody>
                                    {(w.historique || []).map((h, i) => (
                                        <tr key={i}>
                                            <td style={{whiteSpace:'nowrap'}}>{new Date(h.jour+'T12:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})}</td>
                                            <td style={{fontSize:10,color:'var(--gray-400)'}}>{h.periode}</td>
                                            <td style={{fontWeight:500}}>{h.operation}{h.operationDetail && h.operationDetail !== h.operation ? <span style={{fontSize:9,color:'var(--gray-400)',display:'block'}}>{h.operationDetail}</span> : ''}</td>
                                            <td style={{fontSize:10}}>{h.parcelle}</td>
                                            <td>{h.heures || '-'}</td>
                                            <td>{h.quantite || '-'}</td>
                                            <td style={{fontWeight:600}}>{Math.round(h.cout || 0)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

export { WorkerDetailModal };
