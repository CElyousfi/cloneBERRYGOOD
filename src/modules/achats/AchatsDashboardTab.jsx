/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: achats | Déclaration(s): AchatsDashboardTab */
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== ACHATS: DASHBOARD TAB =====================
        function AchatsDashboardTab({ currentProfile, onNavigate }) {
            const [kpis, setKpis] = useState(null);
            const [pending, setPending] = useState(null);
            const [loading, setLoading] = useState(true);
            const [selectedDA, setSelectedDA] = useState(null);
            const [selectedBDC, setSelectedBDC] = useState(null);
            const [bdcRecents, setBdcRecents] = useState([]);
            const [approvingDA, setApprovingDA] = useState(false);

            useEffect(() => {
                Promise.all([
                    cachedFetch('/api/stock?action=stock-dashboard'),
                    fetch('/api/stock?action=pending-validations&role=achats').then(r => r.json()),
                    fetch('/api/stock?action=list-bdc&limit=5').then(r => r.json()),
                ]).then(([dashJson, pendJson, bdcJson]) => {
                    if (dashJson.success) setKpis(dashJson.kpis);
                    if (pendJson.success) setPending(pendJson.pending);
                    if (bdcJson.success) setBdcRecents((bdcJson.bdc || []).slice(0, 5));
                }).catch(err => console.warn('Dashboard achats error:', err))
                  .finally(() => setLoading(false));
            }, []);

            const nav = (tab, filter) => { if (onNavigate) onNavigate(tab, filter || ''); };

            const openBDCDetail = (bdc) => {
                fetch('/api/stock?action=get-bdc&id=' + bdc.id).then(r => r.json()).then(j => {
                    if (j.success) setSelectedBDC(j.bdc);
                    else setSelectedBDC(bdc);
                }).catch(() => setSelectedBDC(bdc));
            };

            const approveDA = (da) => {
                if (!confirm('Approuver cette demande d\'achat ?')) return;
                setApprovingDA(true);
                fetch('/api/stock?action=update-da', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: da.id, status: 'approuvee', updated_by: { profileId: currentProfile, name: currentProfile } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) {
                        setSelectedDA(null);
                        window._refreshNotifications?.();
                        Promise.all([
                            cachedFetch('/api/stock?action=stock-dashboard'),
                            fetch('/api/stock?action=pending-validations&role=achats').then(r => r.json()),
                        ]).then(([dashJson, pendJson]) => {
                            if (dashJson.success) setKpis(dashJson.kpis);
                            if (pendJson.success) setPending(pendJson.pending);
                        }).catch(() => {});
                    } else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau')).finally(() => setApprovingDA(false));
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}},
                React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            const d = kpis || { bdc_en_cours: 0, bdc_en_attente: 0, total_bdc_ttc: 0, factures_non_payees: 0, total_factures_ttc: 0, factures_avec_ecarts: 0, pipeline_paiement: {}, nb_bl: 0, nb_bc: 0 };
            const pp = d.pipeline_paiement || {};
            const p = pending || {};
            const totalActions = (p.da_soumises || 0) + (p.bdc_brouillon || 0) + (p.bdc_attente_chef || 0) + (p.bdc_attente_dg || 0) + (p.factures_achats || 0);

            const statusBDCLabels = { brouillon: 'Brouillon', en_attente_chef: 'Attente Chef', valide_chef: 'Validé Chef', en_attente_dg: 'Attente DG', valide_dg: 'Validé DG', envoye: 'Envoyé', virement_lance: 'Virement Lancé', virement_signe: 'Virement Signé', rejete: 'Rejeté', annule: 'Annulé' };
            const statusBDCColor = (s) => { if (!s) return '#95a5a6'; if (s === 'brouillon') return '#95a5a6'; if (s.startsWith('en_attente')) return '#e67e22'; if (s.startsWith('valide') || s === 'envoye') return '#27ae60'; if (s === 'rejete') return '#e74c3c'; return '#95a5a6'; };
            const fmtMt = (v) => v ? new Intl.NumberFormat('fr-FR').format(Math.round(v)) + ' MAD' : '—';
            const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('fr-FR') : '—';
            const getTS = (history, action) => { const h = (history || []).find(x => x.action === action); return h ? h.at : null; };
            const diffDays = (t1, t2) => { if (!t1 || !t2) return null; return Math.round(Math.abs(t2 - t1) / 86400000); };

            return (
                <div className="fade-in">
                    <h3 style={{margin:'0 0 16px'}}><i className="fa-solid fa-gauge-high" style={{marginRight:8}}></i>Dashboard Achats & Stock</h3>

                    {/* Actions Requises */}
                    {totalActions > 0 && (
                        <div style={{background:'linear-gradient(135deg, #fff5f5 0%, #fff0e6 100%)', border:'1.5px solid #f5c6cb', borderRadius:14, padding:18, marginBottom:20}}>
                            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:14}}>
                                <div style={{width:32, height:32, borderRadius:'50%', background:'#e74c3c', display:'flex', alignItems:'center', justifyContent:'center'}}>
                                    <i className="fa-solid fa-bell" style={{color:'#fff', fontSize:14}}></i>
                                </div>
                                <div>
                                    <div style={{fontWeight:800, fontSize:14, color:'#c0392b'}}>Actions Requises</div>
                                    <div style={{fontSize:11, color:'#e74c3c'}}>{totalActions} élément{totalActions > 1 ? 's' : ''} en attente de traitement</div>
                                </div>
                            </div>
                            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10}}>
                                {(p.da_soumises || 0) > 0 && (
                                    <div onClick={() => nav('achats_da', 'soumise')} style={{background:'#fff', borderRadius:10, padding:'12px 14px', border:'1px solid #fde2e2', display:'flex', alignItems:'center', gap:10, cursor:'pointer'}} onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 12px rgba(243,156,18,0.2)'} onMouseLeave={e => e.currentTarget.style.boxShadow='none'}>
                                        <div style={{width:36, height:36, borderRadius:10, background:'rgba(243,156,18,0.12)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                                            <i className="fa-solid fa-file-lines" style={{color:'#f39c12', fontSize:15}}></i>
                                        </div>
                                        <div>
                                            <div style={{fontSize:22, fontWeight:900, color:'#f39c12', lineHeight:1}}>{p.da_soumises}</div>
                                            <div style={{fontSize:10, fontWeight:600, color:'#666'}}>DA à approuver</div>
                                        </div>
                                    </div>
                                )}
                                {(p.bdc_brouillon || 0) > 0 && (
                                    <div onClick={() => nav('achats_bdc', 'brouillon')} style={{background:'#fff', borderRadius:10, padding:'12px 14px', border:'1px solid #fde2e2', display:'flex', alignItems:'center', gap:10, cursor:'pointer'}} onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 12px rgba(52,152,219,0.2)'} onMouseLeave={e => e.currentTarget.style.boxShadow='none'}>
                                        <div style={{width:36, height:36, borderRadius:10, background:'rgba(52,152,219,0.12)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                                            <i className="fa-solid fa-file-pen" style={{color:'#3498db', fontSize:15}}></i>
                                        </div>
                                        <div>
                                            <div style={{fontSize:22, fontWeight:900, color:'#3498db', lineHeight:1}}>{p.bdc_brouillon}</div>
                                            <div style={{fontSize:10, fontWeight:600, color:'#666'}}>BDC brouillon</div>
                                        </div>
                                    </div>
                                )}
                                {(p.bdc_attente_chef || 0) > 0 && (
                                    <div onClick={() => nav('achats_bdc', 'en_attente_chef')} style={{background:'#fff', borderRadius:10, padding:'12px 14px', border:'1px solid #fde2e2', display:'flex', alignItems:'center', gap:10, cursor:'pointer'}} onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 12px rgba(230,126,34,0.2)'} onMouseLeave={e => e.currentTarget.style.boxShadow='none'}>
                                        <div style={{width:36, height:36, borderRadius:10, background:'rgba(230,126,34,0.12)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                                            <i className="fa-solid fa-user-check" style={{color:'#e67e22', fontSize:15}}></i>
                                        </div>
                                        <div>
                                            <div style={{fontSize:22, fontWeight:900, color:'#e67e22', lineHeight:1}}>{p.bdc_attente_chef}</div>
                                            <div style={{fontSize:10, fontWeight:600, color:'#666'}}>BDC attente Chef</div>
                                        </div>
                                    </div>
                                )}
                                {(p.bdc_attente_dg || 0) > 0 && (
                                    <div onClick={() => nav('achats_bdc', 'en_attente_dg')} style={{background:'#fff', borderRadius:10, padding:'12px 14px', border:'1px solid #fde2e2', display:'flex', alignItems:'center', gap:10, cursor:'pointer'}} onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 12px rgba(155,89,182,0.2)'} onMouseLeave={e => e.currentTarget.style.boxShadow='none'}>
                                        <div style={{width:36, height:36, borderRadius:10, background:'rgba(155,89,182,0.12)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                                            <i className="fa-solid fa-stamp" style={{color:'#9b59b6', fontSize:15}}></i>
                                        </div>
                                        <div>
                                            <div style={{fontSize:22, fontWeight:900, color:'#9b59b6', lineHeight:1}}>{p.bdc_attente_dg}</div>
                                            <div style={{fontSize:10, fontWeight:600, color:'#666'}}>BDC attente DG</div>
                                        </div>
                                    </div>
                                )}
                                {(p.factures_achats || 0) > 0 && (
                                    <div onClick={() => nav('achats_factures', '')} style={{background:'#fff', borderRadius:10, padding:'12px 14px', border:'1px solid #fde2e2', display:'flex', alignItems:'center', gap:10, cursor:'pointer'}} onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 12px rgba(231,76,60,0.2)'} onMouseLeave={e => e.currentTarget.style.boxShadow='none'}>
                                        <div style={{width:36, height:36, borderRadius:10, background:'rgba(231,76,60,0.12)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                                            <i className="fa-solid fa-file-invoice-dollar" style={{color:'#e74c3c', fontSize:15}}></i>
                                        </div>
                                        <div>
                                            <div style={{fontSize:22, fontWeight:900, color:'#e74c3c', lineHeight:1}}>{p.factures_achats}</div>
                                            <div style={{fontSize:10, fontWeight:600, color:'#666'}}>Factures à valider</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* DA en cours */}
                    {(p.da_list || []).length > 0 && (
                        <div style={{background:'#fff', border:'1.5px solid #fdebd0', borderRadius:14, padding:18, marginBottom:20}}>
                            <h4 style={{margin:'0 0 12px', fontSize:14, fontWeight:700, color:'#e67e22', display:'flex', alignItems:'center', gap:8}}>
                                <i className="fa-solid fa-file-lines"></i> Demandes d'Achat en attente ({p.da_list.length})
                            </h4>
                            <div style={{display:'flex', flexDirection:'column', gap:8}}>
                                {p.da_list.map(da => (
                                    <div key={da.id} onClick={() => setSelectedDA(da)}
                                        style={{background:'#fef9f3', border:'1px solid #fdebd0', borderRadius:10, padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8, cursor:'pointer', transition:'box-shadow 0.15s'}}
                                        onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 12px rgba(230,126,34,0.18)'}
                                        onMouseLeave={e => e.currentTarget.style.boxShadow='none'}>
                                        <div style={{display:'flex', alignItems:'center', gap:10, flex:1, minWidth:200}}>
                                            <span style={{fontWeight:800, color:'var(--berry)', fontSize:13}}>{da.numero}</span>
                                            <span style={{fontSize:11, color:'#666', fontWeight:600}}>{da.ferme}</span>
                                            <span className="status-badge" style={da.urgence === 'critique' ? {background:'rgba(231,76,60,0.12)',color:'#e74c3c',fontSize:10,fontWeight:700} : da.urgence === 'urgente' ? {background:'rgba(243,156,18,0.12)',color:'#E67E22',fontSize:10,fontWeight:700} : {background:'#f0f0f0',color:'#666',fontSize:10}}>{da.urgence}</span>
                                        </div>
                                        <div style={{fontSize:12, color:'#444', flex:2, minWidth:200}}>{da.justification || (da.items && da.items[0]?.article) || '—'}</div>
                                        <div style={{display:'flex', alignItems:'center', gap:6, flexShrink:0}}>
                                            <span style={{fontSize:10, color:'#999'}}>{da.created_by?.name || '—'} · {da.created_at ? new Date(da.created_at).toLocaleDateString('fr-FR') : ''}</span>
                                            <span style={{background:'#f39c12', color:'#fff', padding:'3px 10px', borderRadius:12, fontSize:10, fontWeight:700}}>En attente</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div style={{textAlign:'right', marginTop:10}}>
                                <button onClick={() => nav('achats_da', 'soumise')} style={{background:'none', border:'none', color:'var(--berry)', fontWeight:700, fontSize:12, cursor:'pointer', padding:'4px 0'}}>
                                    Voir toutes les DA soumises →
                                </button>
                            </div>
                        </div>
                    )}

                    {/* KPI Cards */}
                    <div className="kpi-grid" style={{marginBottom: 24}}>
                        <div className="kpi-card" onClick={() => nav('achats_bdc', 'valide_dg')} style={{cursor:'pointer'}} onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 14px rgba(52,152,219,0.2)'} onMouseLeave={e => e.currentTarget.style.boxShadow=''}>
                            <div className="kpi-icon blue"><i className="fa-solid fa-file-contract"></i></div>
                            <div className="kpi-value">{d.bdc_en_cours}</div>
                            <div className="kpi-label">BDC en cours</div>
                        </div>
                        <div className="kpi-card" onClick={() => nav('achats_bdc', 'en_attente_chef')} style={{cursor:'pointer'}} onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 14px rgba(243,156,18,0.2)'} onMouseLeave={e => e.currentTarget.style.boxShadow=''}>
                            <div className="kpi-icon" style={{background:'rgba(243,156,18,0.12)',color:'#E67E22'}}><i className="fa-solid fa-clock"></i></div>
                            <div className="kpi-value">{d.bdc_en_attente}</div>
                            <div className="kpi-label">En attente validation</div>
                        </div>
                        <div className="kpi-card">
                            <div className="kpi-icon" style={{background:'rgba(139,34,82,0.1)',color:'var(--berry)'}}><i className="fa-solid fa-coins"></i></div>
                            <div className="kpi-value">{d.total_bdc_ttc ? (d.total_bdc_ttc / 1000).toFixed(1) + 'K' : '0'}</div>
                            <div className="kpi-label">Total BDC TTC (MAD)</div>
                        </div>
                        <div className="kpi-card" onClick={() => nav('achats_factures', '')} style={{cursor:'pointer'}} onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 14px rgba(231,76,60,0.2)'} onMouseLeave={e => e.currentTarget.style.boxShadow=''}>
                            <div className="kpi-icon" style={{background:'rgba(231,76,60,0.12)',color:'#e74c3c'}}><i className="fa-solid fa-file-invoice-dollar"></i></div>
                            <div className="kpi-value">{d.factures_non_payees}</div>
                            <div className="kpi-label">Factures non payees</div>
                        </div>
                    </div>
                    <div className="kpi-grid" style={{marginBottom: 24}}>
                        <div className="kpi-card">
                            <div className="kpi-icon green"><i className="fa-solid fa-truck-ramp-box"></i></div>
                            <div className="kpi-value">{d.nb_bl}</div>
                            <div className="kpi-label">Bons de livraison</div>
                        </div>
                        <div className="kpi-card">
                            <div className="kpi-icon" style={{background:'rgba(155,89,182,0.12)',color:'#9b59b6'}}><i className="fa-solid fa-flask"></i></div>
                            <div className="kpi-value">{d.nb_bc}</div>
                            <div className="kpi-label">Bons de consommation</div>
                        </div>
                        <div className="kpi-card">
                            <div className="kpi-icon" style={{background:'rgba(52,152,219,0.12)',color:'var(--blue)'}}><i className="fa-solid fa-coins"></i></div>
                            <div className="kpi-value">{d.total_factures_ttc ? (d.total_factures_ttc / 1000).toFixed(1) + 'K' : '0'}</div>
                            <div className="kpi-label">Total Factures TTC (MAD)</div>
                        </div>
                        <div className="kpi-card">
                            <div className="kpi-icon" style={{background:'rgba(231,76,60,0.12)',color:'#e74c3c'}}><i className="fa-solid fa-triangle-exclamation"></i></div>
                            <div className="kpi-value">{d.factures_avec_ecarts}</div>
                            <div className="kpi-label">Factures avec ecarts</div>
                        </div>
                    </div>

                    {/* Pipeline Validations */}
                    <h4 style={{fontSize:13, margin:'0 0 12px', display:'flex', alignItems:'center', gap:6}}>
                        <i className="fa-solid fa-route" style={{color:'var(--berry)'}}></i> Pipeline Validations BDC
                    </h4>
                    <div style={{display:'flex', gap:4, marginBottom:24, flexWrap:'wrap'}}>
                        {[
                            {k:'brouillon', l:'Brouillon', c:'#95a5a6', v: p.bdc_brouillon || 0, f:'brouillon'},
                            {k:'en_attente_chef', l:'Attente Chef', c:'#e67e22', v: p.bdc_attente_chef || 0, f:'en_attente_chef'},
                            {k:'en_attente_dg', l:'Attente DG', c:'#9b59b6', v: p.bdc_attente_dg || 0, f:'en_attente_dg'},
                            {k:'valide', l:'Validé DG', c:'#27ae60', v: d.bdc_en_cours || 0, f:'valide_dg'},
                        ].map(s => (
                            <div key={s.k} onClick={() => nav('achats_bdc', s.f)}
                                style={{flex:1, minWidth:110, background:'#fff', border:'1px solid #eee', borderRadius:8, padding:'10px 8px', textAlign:'center', borderTop:'3px solid '+s.c, cursor:'pointer', transition:'box-shadow 0.15s'}}
                                onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'}
                                onMouseLeave={e => e.currentTarget.style.boxShadow='none'}>
                                <div style={{fontSize:22, fontWeight:800, color:s.c}}>{s.v}</div>
                                <div style={{fontSize:10, color:'#666', fontWeight:600}}>{s.l}</div>
                            </div>
                        ))}
                    </div>

                    {/* BDC Récents */}
                    <div style={{background:'#fff', border:'1.5px solid #e8eaf6', borderRadius:14, padding:18, marginBottom:20}}>
                        <h4 style={{margin:'0 0 12px', fontSize:14, fontWeight:700, color:'var(--berry)', display:'flex', alignItems:'center', gap:8}}>
                            <i className="fa-solid fa-file-contract"></i> BDC Récents
                        </h4>
                        {bdcRecents.length === 0 ? (
                            <div style={{textAlign:'center', padding:'20px 0', color:'#999', fontSize:13}}>Aucun BDC récent</div>
                        ) : (
                            <div style={{display:'flex', flexDirection:'column', gap:6}}>
                                {bdcRecents.map(bdc => (
                                    <div key={bdc.id} onClick={() => openBDCDetail(bdc)}
                                        style={{background:'#f8f9ff', border:'1px solid #e8eaf6', borderRadius:10, padding:'10px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8, cursor:'pointer', transition:'box-shadow 0.15s'}}
                                        onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 12px rgba(139,34,82,0.1)'}
                                        onMouseLeave={e => e.currentTarget.style.boxShadow='none'}>
                                        <div style={{display:'flex', alignItems:'center', gap:10, flex:1, minWidth:180}}>
                                            <span style={{fontWeight:800, color:'var(--berry)', fontSize:13}}>{bdc.numero}</span>
                                            <span style={{fontSize:11, color:'#666'}}>{bdc.fournisseur?.nom || bdc.fournisseur_nom || '—'}</span>
                                            <span style={{fontSize:11, color:'#888'}}>{bdc.ferme}</span>
                                        </div>
                                        <div style={{display:'flex', alignItems:'center', gap:8, flexShrink:0}}>
                                            <span style={{fontSize:12, fontWeight:700, color:'#444'}}>{bdc.total_ttc ? new Intl.NumberFormat('fr-FR').format(Math.round(bdc.total_ttc)) + ' MAD' : '—'}</span>
                                            <span style={{background: statusBDCColor(bdc.status) + '22', color: statusBDCColor(bdc.status), padding:'3px 10px', borderRadius:12, fontSize:10, fontWeight:700}}>{statusBDCLabels[bdc.status] || bdc.status}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div style={{textAlign:'right', marginTop:10}}>
                            <button onClick={() => nav('achats_bdc', '')} style={{background:'none', border:'none', color:'var(--berry)', fontWeight:700, fontSize:12, cursor:'pointer', padding:'4px 0'}}>
                                Voir tous les BDC →
                            </button>
                        </div>
                    </div>

                    <h4 style={{fontSize:13,margin:'0 0 12px', display:'flex', alignItems:'center', gap:6}}>
                        <i className="fa-solid fa-money-check-dollar" style={{color:'var(--berry)'}}></i> Pipeline Paiements
                    </h4>
                    <div style={{display:'flex',gap:4,marginBottom:24,flexWrap:'wrap'}}>
                        {[{k:'non_payee',l:'Non payee',c:'#95a5a6'},{k:'en_validation',l:'En validation',c:'#f39c12'},{k:'validee_achats',l:'Valid. Achats',c:'#e67e22'},{k:'validee_finance',l:'Valid. Finance',c:'#3498db'},{k:'validee_dg',l:'Valid. DG',c:'#9b59b6'},{k:'payee',l:'Payee',c:'var(--green)'}].map(s => (
                            <div key={s.k} style={{flex:1,minWidth:100,background:'#fff',border:'1px solid #eee',borderRadius:8,padding:'10px 8px',textAlign:'center',borderTop:'3px solid '+s.c}}>
                                <div style={{fontSize:22,fontWeight:800,color:s.c}}>{pp[s.k] || 0}</div>
                                <div style={{fontSize:10,color:'#666',fontWeight:600}}>{s.l}</div>
                            </div>
                        ))}
                    </div>

                    {/* Modal DA */}
                    {selectedDA && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={() => setSelectedDA(null)}>
                            <div style={{background:'#fff',borderRadius:16,padding:24,width:'100%',maxWidth:580,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.25)'}} onClick={e => e.stopPropagation()}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
                                    <div>
                                        <div style={{fontWeight:900,fontSize:18,color:'var(--berry)'}}>{selectedDA.numero}</div>
                                        <div style={{fontSize:12,color:'#666',marginTop:4,display:'flex',gap:10,flexWrap:'wrap'}}>
                                            <span><i className="fa-solid fa-warehouse" style={{marginRight:4}}></i>{selectedDA.ferme}</span>
                                            {selectedDA.urgence && selectedDA.urgence !== 'normale' && <span style={{color: selectedDA.urgence==='critique' ? '#e74c3c' : '#e67e22',fontWeight:700}}><i className="fa-solid fa-bolt" style={{marginRight:4}}></i>{selectedDA.urgence.toUpperCase()}</span>}
                                            <span><i className="fa-regular fa-calendar" style={{marginRight:4}}></i>{fmtDate(selectedDA.created_at)}</span>
                                            {selectedDA.created_by?.name && <span><i className="fa-regular fa-user" style={{marginRight:4}}></i>{selectedDA.created_by.name}</span>}
                                        </div>
                                    </div>
                                    <button onClick={() => setSelectedDA(null)} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#999',padding:'0 4px',lineHeight:1}}>×</button>
                                </div>
                                {selectedDA.justification && (
                                    <div style={{background:'#fef9f3',border:'1px solid #fdebd0',borderRadius:10,padding:'10px 14px',marginBottom:14,fontSize:13,color:'#555',fontStyle:'italic'}}>
                                        "{selectedDA.justification}"
                                    </div>
                                )}
                                {(selectedDA.items || []).length > 0 && (
                                    <div style={{marginBottom:16}}>
                                        <div style={{fontSize:11,fontWeight:700,color:'#999',textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>Articles</div>
                                        {selectedDA.items.map((it, i) => (
                                            <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #f0f0f0',fontSize:13}}>
                                                <span style={{fontWeight:600}}>{it.article}</span>
                                                <span style={{color:'#666'}}>{it.quantite} {it.unite}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {(selectedDA.history || []).length > 0 && (
                                    <div style={{marginBottom:16}}>
                                        <div style={{fontSize:11,fontWeight:700,color:'#999',textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>Historique</div>
                                        {selectedDA.history.map((h, i) => (
                                            <div key={i} style={{display:'flex',gap:10,padding:'6px 0',borderBottom:'1px solid #f8f8f8',fontSize:12}}>
                                                <span style={{width:8,height:8,borderRadius:'50%',background:'var(--berry)',marginTop:5,flexShrink:0,display:'inline-block'}}></span>
                                                <div>
                                                    <span style={{fontWeight:600,textTransform:'capitalize'}}>{(h.action||'').replace(/_/g,' ')}</span>
                                                    {h.by?.name && <span style={{color:'#888'}}> — {h.by.name}</span>}
                                                    {h.at && <span style={{color:'#aaa'}}> — {fmtDate(h.at)}</span>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:16}}>
                                    <button onClick={() => { nav('achats_da', 'soumise'); setSelectedDA(null); }} style={{padding:'8px 16px',background:'#f0f0f0',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600,color:'#555'}}>
                                        Voir dans DA →
                                    </button>
                                    {selectedDA.status === 'soumise' && (
                                        <button onClick={() => approveDA(selectedDA)} disabled={approvingDA} style={{padding:'8px 20px',background:'var(--green)',color:'#fff',border:'none',borderRadius:8,cursor:approvingDA?'wait':'pointer',fontSize:13,fontWeight:700}}>
                                            {approvingDA ? 'En cours...' : 'Approuver'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Modal BDC */}
                    {selectedBDC && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={() => setSelectedBDC(null)}>
                            <div style={{background:'#fff',borderRadius:16,padding:24,width:'100%',maxWidth:620,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.25)'}} onClick={e => e.stopPropagation()}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
                                    <div>
                                        <div style={{fontWeight:900,fontSize:18,color:'var(--berry)'}}>{selectedBDC.numero}</div>
                                        <div style={{fontSize:12,color:'#666',marginTop:4,display:'flex',gap:10,flexWrap:'wrap'}}>
                                            <span>{selectedBDC.fournisseur?.nom || selectedBDC.fournisseur_nom || '—'}</span>
                                            <span>{selectedBDC.ferme}</span>
                                            <span>{fmtDate(selectedBDC.created_at)}</span>
                                            <span style={{background: statusBDCColor(selectedBDC.status)+'22', color: statusBDCColor(selectedBDC.status), padding:'2px 8px', borderRadius:8, fontWeight:700}}>{statusBDCLabels[selectedBDC.status] || selectedBDC.status}</span>
                                        </div>
                                    </div>
                                    <button onClick={() => setSelectedBDC(null)} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#999',padding:'0 4px',lineHeight:1}}>×</button>
                                </div>
                                {(selectedBDC.history || []).length > 0 && (() => {
                                    const h = selectedBDC.history || [];
                                    const tCreate = getTS(h, 'creation') || selectedBDC.created_at;
                                    const tSubmit = getTS(h, 'soumission');
                                    const tChef = getTS(h, 'validation_chef');
                                    const tDG = getTS(h, 'validation_dg');
                                    const tEnvoye = getTS(h, 'envoi');
                                    const steps = [
                                        {l:'Créé', t:tCreate, done:!!tCreate},
                                        {l:'Soumis', t:tSubmit, done:!!tSubmit},
                                        {l:'Chef', t:tChef, done:!!tChef},
                                        {l:'DG', t:tDG, done:!!tDG},
                                        {l:'Envoyé', t:tEnvoye, done:!!tEnvoye},
                                    ];
                                    return (
                                        <div style={{background:'#f8f9ff',border:'1px solid #e8eaf6',borderRadius:10,padding:'12px 16px',marginBottom:14}}>
                                            <div style={{fontSize:11,fontWeight:700,color:'#999',textTransform:'uppercase',letterSpacing:1,marginBottom:10}}>Timeline</div>
                                            <div style={{display:'flex',alignItems:'center',gap:0,overflowX:'auto'}}>
                                                {steps.map((s, i) => (
                                                    <React.Fragment key={i}>
                                                        <div style={{display:'flex',flexDirection:'column',alignItems:'center',minWidth:56}}>
                                                            <div style={{width:28,height:28,borderRadius:'50%',background:s.done?'#27ae60':'#e0e0e0',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:11,fontWeight:700}}>{s.done ? '✓' : i+1}</div>
                                                            <div style={{fontSize:10,color:s.done?'#27ae60':'#aaa',fontWeight:600,marginTop:4,textAlign:'center'}}>{s.l}</div>
                                                            {s.t && <div style={{fontSize:9,color:'#bbb',marginTop:2}}>{fmtDate(s.t)}</div>}
                                                        </div>
                                                        {i < steps.length - 1 && (() => {
                                                            const dd = diffDays(steps[i].t, steps[i+1].t);
                                                            return <div style={{flex:1,height:2,background:steps[i].done&&steps[i+1].done?'#27ae60':'#e0e0e0',minWidth:16,position:'relative',top:-14}}>
                                                                {dd !== null && <span style={{position:'absolute',top:-8,left:'50%',transform:'translateX(-50%)',fontSize:9,color:'#aaa',whiteSpace:'nowrap'}}>{dd}j</span>}
                                                            </div>;
                                                        })()}
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}
                                {(selectedBDC.items || []).length > 0 && (
                                    <div style={{marginBottom:14}}>
                                        <div style={{fontSize:11,fontWeight:700,color:'#999',textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>Articles ({selectedBDC.items.length})</div>
                                        {selectedBDC.items.map((it, i) => (
                                            <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #f0f0f0',fontSize:13,gap:8}}>
                                                <span style={{fontWeight:600,flex:2}}>{it.article}</span>
                                                <span style={{color:'#666',flexShrink:0}}>{it.quantite} {it.unite}</span>
                                                <span style={{color:'#888',flexShrink:0,fontFamily:'monospace'}}>{it.prix_unitaire ? new Intl.NumberFormat('fr-FR').format(it.prix_unitaire) + ' MAD' : '—'}</span>
                                            </div>
                                        ))}
                                        <div style={{textAlign:'right',marginTop:10,fontWeight:800,fontSize:14,color:'var(--berry)'}}>
                                            Total TTC: {fmtMt(selectedBDC.total_ttc)}
                                        </div>
                                    </div>
                                )}
                                {(selectedBDC.validated_by_chef || selectedBDC.validated_by_dg) && (
                                    <div style={{background:'#f8f9ff',border:'1px solid #e8eaf6',borderRadius:10,padding:'12px 16px',marginBottom:14,fontSize:12}}>
                                        {selectedBDC.validated_by_chef && <div><i className="fa-solid fa-check-circle" style={{color:'#27ae60',marginRight:6}}></i>Validé Chef: {selectedBDC.validated_by_chef?.name || selectedBDC.validated_by_chef}</div>}
                                        {selectedBDC.validated_by_dg && <div style={{marginTop:6}}><i className="fa-solid fa-check-double" style={{color:'#9b59b6',marginRight:6}}></i>Validé DG: {selectedBDC.validated_by_dg?.name || selectedBDC.validated_by_dg}</div>}
                                    </div>
                                )}
                                <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:16}}>
                                    <button onClick={() => { nav('achats_bdc', selectedBDC.status || ''); setSelectedBDC(null); }} style={{padding:'8px 16px',background:'#f0f0f0',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600,color:'#555'}}>
                                        Voir dans BDC →
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { AchatsDashboardTab };
