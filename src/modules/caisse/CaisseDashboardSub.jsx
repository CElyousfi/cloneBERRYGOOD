/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaisseDashboardSub */
import { formatMAD } from '../finance/formatMAD.jsx';
import { STATUS_LABELS } from '../shared/STATUS_LABELS.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { TXN_TYPE_LABELS } from './TXN_TYPE_LABELS.jsx';
import { getCaisseColor } from './getCaisseColor.jsx';

// ---- Dashboard Sub ----
        function CaisseDashboardSub({ dashData, caisses, isControle, onNavigate }) {
            const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0,10));
            const [selectedCaisseId, setSelectedCaisseId] = useState('');
            const [allTx, setAllTx] = useState([]);
            const [txLoaded, setTxLoaded] = useState(false);

            React.useEffect(() => {
                fetch('/api/caisse?action=list-transactions&limit=2000').then(r => r.json())
                    .then(json => { if (json.success) { setAllTx(json.transactions || []); setTxLoaded(true); } })
                    .catch(() => {});
            }, []);

            const computeBalanceForDate = (caisseId, dateStr) => {
                const caisse = caisses.find(c => c.id === caisseId);
                if (!caisse) return 0;
                let bal = caisse.solde_initial || 0;
                allTx.forEach(t => {
                    if (t.caisse_id !== caisseId) return;
                    if (t.status !== 'valide') return;
                    if (t.date > dateStr) return;
                    const m = t.montant || 0;
                    if (t.type === 'alimentation' || t.type === 'transfer_in') bal += m;
                    else if (['depense','sortie','transfer_out','paie','transport'].includes(t.type)) bal -= m;
                });
                return bal;
            };

            const computeDayMovements = (caisseId, dateStr) => {
                const txOfDay = allTx.filter(t => t.date === dateStr && t.status === 'valide' && (caisseId ? t.caisse_id === caisseId : true));
                let entrees = 0, sorties = 0;
                txOfDay.forEach(t => {
                    const m = t.montant || 0;
                    if (t.type === 'alimentation' || t.type === 'transfer_in') entrees += m;
                    else if (['depense','sortie','transfer_out','paie','transport'].includes(t.type)) sorties += m;
                });
                return { entrees, sorties, count: txOfDay.length };
            };

            const shiftDay = (delta) => {
                const d = new Date(selectedDate + 'T12:00');
                d.setDate(d.getDate() + delta);
                setSelectedDate(d.toISOString().slice(0,10));
            };

            const soldeJour = selectedCaisseId
                ? computeBalanceForDate(selectedCaisseId, selectedDate)
                : caisses.reduce((s, c) => s + computeBalanceForDate(c.id, selectedDate), 0);
            const dayMov = computeDayMovements(selectedCaisseId, selectedDate);

            if (!dashData) return null;
            const totalSolde = caisses.reduce((s, c) => s + (c.solde_actuel || 0), 0);
            return (
                <div>
                    {/* Real-time balance with day navigation */}
                    <div style={{padding:'18px 24px',background:'white',borderRadius:12,marginBottom:20,border:'2px solid var(--berry)',boxShadow:'0 2px 8px rgba(139,34,82,0.08)'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:16}}>
                            <div style={{display:'flex',alignItems:'center',gap:14}}>
                                <button onClick={() => shiftDay(-1)} style={{width:36,height:36,borderRadius:'50%',border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:14,color:'var(--berry)'}}>
                                    <i className="fa-solid fa-chevron-left"></i>
                                </button>
                                <div style={{textAlign:'center',minWidth:140}}>
                                    <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:1,color:'var(--gray-600)'}}>Solde au</div>
                                    <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                                        style={{padding:'4px 8px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:13,fontWeight:600,textAlign:'center'}} />
                                </div>
                                <button onClick={() => shiftDay(1)} style={{width:36,height:36,borderRadius:'50%',border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:14,color:'var(--berry)'}}>
                                    <i className="fa-solid fa-chevron-right"></i>
                                </button>
                                <button onClick={() => setSelectedDate(new Date().toISOString().slice(0,10))} style={{padding:'6px 12px',borderRadius:6,border:'1px solid var(--gray-200)',background:'#f5f5f5',cursor:'pointer',fontSize:11}}>Aujourd'hui</button>
                            </div>
                            <select value={selectedCaisseId} onChange={e => setSelectedCaisseId(e.target.value)}
                                style={{padding:'8px 14px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12,fontWeight:600}}>
                                <option value="">Toutes caisses</option>
                                {caisses.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                            </select>
                            <div style={{textAlign:'right'}}>
                                <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:1,color:'var(--gray-600)'}}>Solde de fin de journée</div>
                                <div style={{fontSize:24,fontWeight:700,color: soldeJour >= 0 ? 'var(--berry)' : 'var(--red)'}}>{txLoaded ? formatMAD(soldeJour) : '...'}</div>
                                <div style={{fontSize:11,color:'var(--gray-600)',marginTop:2}}>
                                    <span style={{color:'var(--green)'}}>+{formatMAD(dayMov.entrees)}</span>
                                    <span style={{margin:'0 6px',color:'var(--gray-400)'}}>•</span>
                                    <span style={{color:'var(--red)'}}>-{formatMAD(dayMov.sorties)}</span>
                                    <span style={{margin:'0 6px',color:'var(--gray-400)'}}>•</span>
                                    <span>{dayMov.count} mvt(s)</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* Total banner */}
                    <div style={{padding:'18px 24px',background:'linear-gradient(135deg, var(--berry) 0%, var(--berry-light) 100%)',borderRadius:12,marginBottom:20,color:'white'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
                            <div>
                                <div style={{fontSize:11,textTransform:'uppercase',letterSpacing:1,opacity:0.7,marginBottom:4}}>Solde Total Toutes Caisses</div>
                                <div style={{fontSize:26,fontWeight:700}}>{formatMAD(totalSolde)}</div>
                            </div>
                            <div style={{display:'flex',gap:24,textAlign:'center'}}>
                                <div>
                                    <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:1,opacity:0.6}}>Alimentations (semaine)</div>
                                    <div style={{fontSize:18,fontWeight:700,color:'#81ecec'}}>{formatMAD(dashData.weekAlimentations)}</div>
                                </div>
                                <div>
                                    <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:1,opacity:0.6}}>Dépenses (semaine)</div>
                                    <div style={{fontSize:18,fontWeight:700,color:'#fab1a0'}}>{formatMAD(dashData.weekDepenses)}</div>
                                </div>
                                <div>
                                    <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:1,opacity:0.6}}>En attente</div>
                                    <div style={{fontSize:18,fontWeight:700,color:'#ffeaa7'}}>{dashData.pendingCount}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* KPI cards per caisse */}
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:12,marginBottom:20}}>
                        {caisses.map(c => {
                            const cc = getCaisseColor(c.id);
                            return (
                                <div key={c.id} style={{padding:16,background:'white',borderRadius:12,border:'1px solid var(--gray-200)',position:'relative',overflow:'hidden'}}>
                                    <div style={{position:'absolute',top:0,left:0,width:4,height:'100%',background:cc.color}}></div>
                                    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10,paddingLeft:8}}>
                                        <div style={{width:36,height:36,borderRadius:10,background:cc.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                            <i className={`fa-solid ${cc.icon}`} style={{color:cc.color,fontSize:15}}></i>
                                        </div>
                                        <div style={{fontSize:12,fontWeight:600,color:'var(--gray-800)'}}>{c.nom}</div>
                                    </div>
                                    <div style={{fontSize:20,fontWeight:700,color:cc.color,paddingLeft:8}}>{formatMAD(c.solde_actuel)}</div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Pending validations panel — DG/Finance only */}
                    {isControle && dashData.pendingCount > 0 && (
                        <div style={{padding:16,background:'rgba(243,156,18,0.06)',borderRadius:12,border:'1px solid rgba(243,156,18,0.2)',marginBottom:20}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                                <div style={{display:'flex',alignItems:'center',gap:8}}>
                                    <i className="fa-solid fa-clock" style={{color:'#E67E22'}}></i>
                                    <span style={{fontWeight:600,fontSize:14,color:'var(--gray-800)'}}>{dashData.pendingCount} transaction(s) en attente de validation</span>
                                </div>
                                <button onClick={() => onNavigate('caisse_validation')} style={{padding:'6px 14px',borderRadius:8,background:'#E67E22',color:'white',border:'none',cursor:'pointer',fontSize:12,fontWeight:600}}>
                                    <i className="fa-solid fa-check-double" style={{marginRight:4}}></i>Valider
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Recent transactions */}
                    <div style={{background:'white',borderRadius:12,border:'1px solid var(--gray-200)',overflow:'hidden'}}>
                        <div style={{padding:'14px 20px',borderBottom:'1px solid var(--gray-200)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                            <span style={{fontWeight:600,fontSize:14}}>
                                <i className="fa-solid fa-clock-rotate-left" style={{marginRight:8,color:'var(--berry)'}}></i>Dernières Transactions
                            </span>
                            <button onClick={() => onNavigate('caisse_transactions')} style={{fontSize:11,color:'var(--berry)',background:'none',border:'none',cursor:'pointer',fontWeight:600}}>
                                Voir tout <i className="fa-solid fa-arrow-right" style={{marginLeft:4}}></i>
                            </button>
                        </div>
                        {(!dashData.recentTx || dashData.recentTx.length === 0) ? (
                            <div style={{padding:40,textAlign:'center',color:'var(--gray-400)',fontSize:13}}>Aucune transaction enregistrée</div>
                        ) : (
                            <div style={{overflowX:'auto'}}>
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                    <thead><tr style={{background:'var(--gray-100)'}}>
                                        <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Date</th>
                                        <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Caisse</th>
                                        <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Type</th>
                                        <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Description</th>
                                        <th style={{padding:'10px 14px',textAlign:'right',fontWeight:600,color:'var(--gray-600)'}}>Montant</th>
                                        <th style={{padding:'10px 14px',textAlign:'center',fontWeight:600,color:'var(--gray-600)'}}>Statut</th>
                                    </tr></thead>
                                    <tbody>
                                        {dashData.recentTx.map((tx, i) => {
                                            const tt = TXN_TYPE_LABELS[tx.type] || {};
                                            const ss = STATUS_LABELS[tx.status] || {};
                                            const caisseName = caisses.find(c => c.id === tx.caisse_id)?.nom || tx.caisse_id;
                                            return (
                                                <tr key={tx.id || i} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                    <td style={{padding:'10px 14px',whiteSpace:'nowrap'}}>{tx.date}</td>
                                                    <td style={{padding:'10px 14px',fontSize:11}}>{caisseName}</td>
                                                    <td style={{padding:'10px 14px'}}>
                                                        <span style={{padding:'3px 10px',borderRadius:12,background:tt.bg||'#eee',color:tt.color||'#333',fontSize:11,fontWeight:600,whiteSpace:'nowrap'}}>
                                                            <i className={`fa-solid ${tt.icon||'fa-circle'}`} style={{marginRight:4}}></i>{tt.label||tx.type}
                                                        </span>
                                                    </td>
                                                    <td style={{padding:'10px 14px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tx.description || tx.reference}</td>
                                                    <td style={{padding:'10px 14px',textAlign:'right',fontWeight:600,color: ['depense','sortie','transfer_out'].includes(tx.type)?'var(--red)':'var(--green)'}}>
                                                        {['depense','sortie','transfer_out'].includes(tx.type)?'-':'+'}{formatMAD(tx.montant)}
                                                    </td>
                                                    <td style={{padding:'10px 14px',textAlign:'center'}}>
                                                        <span style={{padding:'3px 10px',borderRadius:12,background:ss.bg||'#eee',color:ss.color||'#333',fontSize:11,fontWeight:600}}>{ss.label||tx.status}</span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

export { CaisseDashboardSub };
