/* Module: qualite | Déclaration(s): ChefTrackingTab */
import { formatModePaiement } from '../caisse/formatModePaiement.jsx';
import { PROFILES } from '../shared/PROFILES.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== CHEF: SUIVI TRACKING COMMANDES =====================
        function ChefTrackingTab({ currentProfile, profileData }) {
            const profileObj = PROFILES.find(p => p.id === currentProfile);
            const chefFerme = profileObj?.farm || '';
            const [orders, setOrders] = useState([]);
            const [das, setDas] = useState([]);
            const [kpis, setKpis] = useState(null);
            const [loading, setLoading] = useState(true);
            const [expanded, setExpanded] = useState({});
            const [filterStatus, setFilterStatus] = useState('all'); // all | en_cours | termines | en_retard

            const STEPS = [
                { key: 'cree',    label: 'BDC Créé',    icon: 'fa-file-contract' },
                { key: 'chef',    label: 'Chef Ferme',  icon: 'fa-user-check' },
                { key: 'dg',      label: 'DG Approuvé', icon: 'fa-stamp' },
                { key: 'envoye',  label: 'Envoyé',      icon: 'fa-paper-plane' },
                { key: 'livre',   label: 'BL Reçu',     icon: 'fa-truck-ramp-box' },
                { key: 'facture', label: 'Facturé',     icon: 'fa-file-invoice' },
                { key: 'paye',    label: 'Payé',        icon: 'fa-circle-check' },
            ];

            const DA_STEPS = [
                { key: 'soumise',   label: 'Soumise',   icon: 'fa-file-lines',    color: '#f47920' },
                { key: 'approuvee', label: 'Approuvée',  icon: 'fa-check-circle',  color: '#22c55e' },
                { key: 'bdc',       label: 'BDC Créé',   icon: 'fa-file-contract', color: '#1a4a8c' },
            ];

            const load = () => {
                setLoading(true);
                Promise.all([
                    fetch('/api/stock?action=track-orders' + (chefFerme ? '&ferme=' + chefFerme : '')).then(r => r.json()),
                    fetch('/api/stock?action=list-da' + (chefFerme ? '&ferme=' + chefFerme : '')).then(r => r.json()),
                ]).then(([ordersJson, dasJson]) => {
                    if (ordersJson.success) { setOrders(ordersJson.orders || []); setKpis(ordersJson.kpis || null); }
                    if (dasJson.success) setDas(dasJson.das || []);
                }).catch(e => console.warn(e)).finally(() => setLoading(false));
            };
            useEffect(() => { load(); }, []);

            const fmtDuration = (ms) => {
                if (!ms || ms < 0) return '—';
                const m = Math.round(ms / 60000);
                if (m < 60) return m + ' min';
                const h = Math.round(ms / 3600000);
                if (h < 24) return h + 'h';
                const d = Math.floor(ms / 86400000);
                if (d < 7) return d + 'j';
                return Math.floor(d / 7) + ' sem';
            };

            const filtered = orders.filter(o => {
                if (filterStatus === 'en_cours') return !o.is_complete && !o.is_rejected;
                if (filterStatus === 'termines') return o.is_complete;
                if (filterStatus === 'en_retard') return o.is_late;
                return true;
            });

            if (loading) return React.createElement('div', {style:{textAlign:'center',padding:60}},
                React.createElement('i', {className:'fa-solid fa-spinner fa-spin', style:{fontSize:32,color:'#1a4a8c'}}));

            return (
                <div className="fade-in">
                    <style>{`
                        @keyframes track-pulse {
                            0%,100% { box-shadow: 0 0 0 0 rgba(244,121,32,0.6); }
                            50% { box-shadow: 0 0 0 8px rgba(244,121,32,0); }
                        }
                        .step-pulse { animation: track-pulse 2s infinite; }
                        .order-card { background:#fff; border:1.5px solid #e8edf4; border-radius:14px; padding:0; overflow:hidden; transition:box-shadow 0.2s; }
                        .order-card:hover { box-shadow: 0 4px 18px rgba(26,74,140,0.10); }
                        .order-card.late { border-color:#dc2626; }
                        .order-card.complete { border-color:#22c55e; }
                    `}</style>

                    {/* Header */}
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
                        <div>
                            <h3 style={{margin:0,fontSize:20,fontWeight:800,color:'#0f1a2e',letterSpacing:'-0.3px'}}>
                                <i className="fa-solid fa-route" style={{marginRight:10,color:'#1a4a8c'}}></i>
                                Suivi Commandes{chefFerme ? ' — ' + chefFerme : ''}
                            </h3>
                            <p style={{margin:'4px 0 0',fontSize:12,color:'#7a92b0'}}>Tracking temps réel · {orders.length} bon{orders.length!==1?'s':''} de commande</p>
                        </div>
                        <button onClick={load} style={{background:'#f0f4fa',border:'none',borderRadius:8,padding:'8px 14px',cursor:'pointer',fontSize:12,fontWeight:600,color:'#1a4a8c'}}>
                            <i className="fa-solid fa-rotate" style={{marginRight:6}}></i>Actualiser
                        </button>
                    </div>

                    {/* KPI Cards */}
                    {kpis && (
                        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
                            {[
                                { label:'EN COURS', value: kpis.en_cours, color:'#1a4a8c', bg:'#eef3fb', icon:'fa-hourglass-half' },
                                { label:'TERMINÉS', value: kpis.termines, color:'#16a34a', bg:'#f0fdf4', icon:'fa-circle-check' },
                                { label:'EN RETARD', value: kpis.en_retard, color:'#dc2626', bg:'#fef2f2', icon:'fa-triangle-exclamation', pulse: kpis.en_retard > 0 },
                                { label:'DÉLAI MOY.', value: kpis.delai_moyen_ms ? fmtDuration(kpis.delai_moyen_ms) : '—', color:'#7c3aed', bg:'#f5f3ff', icon:'fa-gauge-high' },
                            ].map(k => (
                                <div key={k.label} style={{background:k.bg,borderRadius:12,padding:'14px 16px',border:`1.5px solid ${k.color}22`}}>
                                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                                        <i className={'fa-solid ' + k.icon} style={{color:k.color,fontSize:14}}></i>
                                        <span style={{fontSize:10,fontWeight:700,color:'#7a92b0',letterSpacing:'1px'}}>{k.label}</span>
                                    </div>
                                    <div style={{fontSize:26,fontWeight:900,color:k.color,lineHeight:1}}>{k.value}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Filtres */}
                    <div className="chip-group" style={{marginBottom:16}}>
                        <span className="chip-group-label">Statut:</span>
                        {[['all','Toutes',orders.length],['en_cours','En cours',orders.filter(o=>!o.is_complete&&!o.is_rejected).length],['termines','Terminées',orders.filter(o=>o.is_complete).length],['en_retard','En retard',orders.filter(o=>o.is_late).length]].map(([v,l,c]) => (
                            <button key={v} className={`chip c-navy ${filterStatus===v ? 'active' : ''}`} onClick={()=>setFilterStatus(v)}>
                                {l} <span className="chip-count">{c}</span>
                            </button>
                        ))}
                    </div>

                    {/* Demandes d'Achat */}
                    {das.length > 0 && (
                        <div style={{marginBottom:20}}>
                            <h4 style={{margin:'0 0 10px',fontSize:14,fontWeight:700,color:'#0f1a2e'}}>
                                <i className="fa-solid fa-file-lines" style={{marginRight:8,color:'var(--berry)'}}></i>
                                Demandes d'Achat ({das.length})
                            </h4>
                            <div style={{display:'flex',flexDirection:'column',gap:8}}>
                                {das.map(da => {
                                    const stepIdx = da.status === 'rejetee' ? -1 : da.bdc_numero ? 2 : da.status === 'approuvee' ? 1 : 0;
                                    const isRejected = da.status === 'rejetee';
                                    return (
                                        <div key={da.id} className={'order-card' + (isRejected ? ' late' : da.status === 'approuvee' ? ' complete' : '')}>
                                            <div style={{height:3,background: isRejected ? '#dc2626' : da.status === 'approuvee' ? '#22c55e' : '#f47920'}}/>
                                            <div style={{padding:'12px 18px'}}>
                                                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                                                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                                                        <span style={{fontSize:14,fontWeight:800,color:'var(--berry)'}}>{da.numero}</span>
                                                        <span className="status-badge" style={da.urgence === 'critique' ? {background:'rgba(231,76,60,0.12)',color:'var(--red)',fontSize:10,fontWeight:700} : da.urgence === 'urgente' ? {background:'rgba(243,156,18,0.12)',color:'#E67E22',fontSize:10,fontWeight:700} : {background:'#f0f0f0',color:'#666',fontSize:10}}>{da.urgence}</span>
                                                        {isRejected && <span style={{background:'#fef2f2',color:'#dc2626',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>REJETÉE</span>}
                                                    </div>
                                                    <span style={{fontSize:11,color:'#7a92b0'}}>{da.created_at ? new Date(da.created_at).toLocaleDateString('fr-FR') : '—'}</span>
                                                </div>
                                                <div style={{fontSize:12,color:'#444',marginBottom:da.bdc_numero ? 4 : 10,lineHeight:1.4}}>{da.justification || '—'}</div>
                                                {da.bdc_numero && <div style={{fontSize:11,color:'#1a4a8c',fontWeight:600,marginBottom:10}}><i className="fa-solid fa-file-contract" style={{marginRight:4}}></i>BDC: {da.bdc_numero}</div>}
                                                {/* Pipeline DA */}
                                                {!isRejected && (
                                                    <div style={{display:'flex',alignItems:'center',gap:0}}>
                                                        {DA_STEPS.map((step, i) => {
                                                            const done = i <= stepIdx;
                                                            const isCurrent = i === stepIdx + 1;
                                                            return (
                                                                <React.Fragment key={step.key}>
                                                                    {i > 0 && <div style={{flex:1,height:2,background: i <= stepIdx ? '#22c55e' : '#dde6f0',minWidth:20}}/>}
                                                                    <div style={{width:26,height:26,borderRadius:'50%',background: done ? '#22c55e' : isCurrent ? '#f47920' : '#dde6f0',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color: done || isCurrent ? '#fff' : '#aaa',flexShrink:0}} className={isCurrent ? 'step-pulse' : ''}>
                                                                        {done ? <i className="fa-solid fa-check" style={{fontSize:9}}/> : <i className={'fa-solid ' + step.icon} style={{fontSize:9}}/>}
                                                                    </div>
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                {!isRejected && (
                                                    <div style={{display:'flex',alignItems:'flex-start',marginTop:4}}>
                                                        {DA_STEPS.map((step, i) => (
                                                            <React.Fragment key={step.key}>
                                                                {i > 0 && <div style={{flex:1}}/>}
                                                                <div style={{width:26,textAlign:'center',fontSize:8,fontWeight: i === stepIdx + 1 ? 700 : 500,color: i <= stepIdx ? '#22c55e' : i === stepIdx + 1 ? '#f47920' : '#aaa',lineHeight:1.2}}>{step.label}</div>
                                                            </React.Fragment>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Liste commandes */}
                    <div style={{display:'flex',flexDirection:'column',gap:12}}>
                        {filtered.length === 0 && (
                            <div style={{textAlign:'center',padding:60,color:'#7a92b0'}}>
                                <i className="fa-solid fa-box-open" style={{fontSize:40,marginBottom:12,display:'block',opacity:0.4}}></i>
                                <p style={{fontWeight:600,fontSize:14}}>Aucune commande</p>
                            </div>
                        )}
                        {filtered.map(order => {
                            const isExp = expanded[order.id];
                            return (
                                <div key={order.id} className={'order-card' + (order.is_late?' late':order.is_complete?' complete':'')}>
                                    {/* Bandeau coloré top */}
                                    <div style={{height:4,background: order.is_rejected?'#dc2626':order.is_late?'#f47920':order.is_complete?'#22c55e':'#1a4a8c'}}/>

                                    {/* Header carte */}
                                    <div style={{padding:'14px 18px',cursor:'pointer',display:'flex',alignItems:'center',gap:12}} onClick={()=>setExpanded(e=>({...e,[order.id]:!e[order.id]}))}>
                                        <div style={{flex:1}}>
                                            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                                                <span style={{fontSize:14,fontWeight:800,color:'#1a4a8c'}}>{order.numero}</span>
                                                {order.is_late && <span style={{background:'#fef2f2',color:'#dc2626',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,border:'1px solid #fca5a5'}}>⚠ RETARD</span>}
                                                {order.is_rejected && <span style={{background:'#fef2f2',color:'#dc2626',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20}}>✗ REJETÉ</span>}
                                                {order.is_complete && <span style={{background:'#f0fdf4',color:'#16a34a',fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,border:'1px solid #86efac'}}>✓ TERMINÉ</span>}
                                            </div>
                                            <div style={{fontSize:13,fontWeight:600,color:'#0f1a2e',marginTop:2}}>{order.fournisseur?.nom || '—'}</div>
                                            <div style={{fontSize:11,color:'#7a92b0',marginTop:1}}>
                                                {order.total_ttc ? order.total_ttc.toLocaleString('fr-FR',{minimumFractionDigits:0}) + ' MAD' : '—'}
                                                {order.code_analytique && <span style={{marginLeft:8,background:'#f0f4fa',borderRadius:6,padding:'1px 6px',fontSize:10,color:'#1a4a8c'}}>{order.code_analytique}</span>}
                                                <span style={{marginLeft:8,color:'#bbb'}}>· {order.created_at ? new Date(order.created_at).toLocaleDateString('fr-FR') : '—'}</span>
                                            </div>
                                        </div>
                                        <div style={{textAlign:'right',flexShrink:0}}>
                                            <div style={{fontSize:11,fontWeight:600,color:'#1a4a8c',background:'#eef3fb',borderRadius:8,padding:'4px 10px',marginBottom:4}}>
                                                <i className={'fa-solid ' + (STEPS.find(s=>s.key===order.current_step)?.icon||'fa-circle')} style={{marginRight:5}}></i>
                                                {order.current_step_label || '—'}
                                            </div>
                                            <i className={'fa-solid ' + (isExp?'fa-chevron-up':'fa-chevron-down')} style={{color:'#bbb',fontSize:11}}></i>
                                        </div>
                                    </div>

                                    {/* Pipeline visuel */}
                                    <div style={{padding:'0 18px 16px',overflow:'hidden'}}>
                                        <div style={{display:'flex',alignItems:'center',position:'relative'}}>
                                            {STEPS.map((step, i) => {
                                                const s = order.steps[i];
                                                const dur = order.durations[i - 1];
                                                const dotColor = s.isBlocked ? '#dc2626' : s.done ? '#22c55e' : s.isCurrent ? '#f47920' : '#dde6f0';
                                                const lineColor = i > 0 && order.steps[i-1].done ? '#22c55e' : '#dde6f0';
                                                return (
                                                    <React.Fragment key={step.key}>
                                                        {i > 0 && (
                                                            <div style={{flex:1,position:'relative',height:2,background:lineColor,minWidth:12}}>
                                                                {dur && dur.ms !== null && (
                                                                    <div style={{position:'absolute',top:-16,left:'50%',transform:'translateX(-50%)',whiteSpace:'nowrap',fontSize:9,fontWeight:700,color: dur.pending ? '#f47920' : '#7a92b0',background:'#fff',padding:'1px 5px',borderRadius:8,border:`1px solid ${dur.pending?'#f47920':'#e8edf4'}`}}>
                                                                        {fmtDuration(dur.ms)}{dur.pending ? ' ⟳' : ''}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        <div title={step.label} style={{flexShrink:0,width:28,height:28,borderRadius:'50%',background:dotColor,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:s.done?'#fff':s.isCurrent?'#fff':'#aaa',position:'relative',zIndex:1}}
                                                            className={s.isCurrent && !s.isBlocked ? 'step-pulse' : ''}>
                                                            {s.done ? <i className="fa-solid fa-check" style={{fontSize:10}}/> : s.isBlocked ? <i className="fa-solid fa-xmark" style={{fontSize:10}}/> : <i className={'fa-solid ' + step.icon} style={{fontSize:9}}/>}
                                                        </div>
                                                    </React.Fragment>
                                                );
                                            })}
                                        </div>
                                        {/* Labels étapes */}
                                        <div style={{display:'flex',alignItems:'flex-start',marginTop:6}}>
                                            {STEPS.map((step, i) => {
                                                const s = order.steps[i];
                                                return (
                                                    <React.Fragment key={step.key}>
                                                        {i > 0 && <div style={{flex:1}}/>}
                                                        <div style={{flexShrink:0,width:28,textAlign:'center'}}>
                                                            <div style={{fontSize:8,fontWeight: s.isCurrent?700:500,color: s.done?'#22c55e':s.isCurrent?'#f47920':'#aaa',lineHeight:1.2,letterSpacing:'0.3px'}}>{step.label.split(' ').map((w,wi)=><div key={wi}>{w}</div>)}</div>
                                                        </div>
                                                    </React.Fragment>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Détail expandable */}
                                    {isExp && (
                                        <div style={{borderTop:'1px solid #f0f4fa',padding:'14px 18px',background:'#fafbfd'}}>
                                            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10,marginBottom:12}}>
                                                {[
                                                    ['Ferme', order.ferme],
                                                    ['Fournisseur', order.fournisseur?.nom || '—'],
                                                    ['Montant TTC', order.total_ttc ? order.total_ttc.toLocaleString('fr-FR',{minimumFractionDigits:2}) + ' MAD' : '—'],
                                                    ['Mode paiement', formatModePaiement(order.mode_paiement)],
                                                    ['BL fournisseur', order.bl_numero || '—'],
                                                    ['N° Facture', order.facture_numero || '—'],
                                                ].map(([k,v]) => (
                                                    <div key={k} style={{background:'#fff',borderRadius:8,padding:'8px 12px',border:'1px solid #e8edf4'}}>
                                                        <div style={{fontSize:10,fontWeight:700,color:'#7a92b0',letterSpacing:'0.8px',textTransform:'uppercase',marginBottom:2}}>{k}</div>
                                                        <div style={{fontSize:12,fontWeight:600,color:'#0f1a2e'}}>{v}</div>
                                                    </div>
                                                ))}
                                            </div>
                                            {/* Timeline historique */}
                                            <div style={{fontSize:11,fontWeight:700,color:'#7a92b0',letterSpacing:'0.8px',textTransform:'uppercase',marginBottom:8}}>Historique des étapes</div>
                                            <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                                {order.steps.filter(s => s.at).map(s => (
                                                    <div key={s.key} style={{display:'flex',alignItems:'center',gap:10}}>
                                                        <div style={{width:8,height:8,borderRadius:'50%',background:'#22c55e',flexShrink:0}}/>
                                                        <span style={{fontSize:11,fontWeight:600,color:'#0f1a2e',width:100}}>{s.label}</span>
                                                        <span style={{fontSize:11,color:'#7a92b0'}}>{new Date(s.at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

export { ChefTrackingTab };
