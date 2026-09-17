/* Module: achats | Déclaration(s): AchatsConsultationTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== ACHATS: CONSULTATION / 3 DEVIS TAB =====================
        function AchatsConsultationTab({ currentProfile, profileData }) {
            const [consultations, setConsultations] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [selected, setSelected] = useState(null);
            const FARMS = ['F1', 'F5', 'Avocatier'];
            const emptyOffre = { fournisseur_nom: '', date_reception: '', delai_livraison: '', conditions_paiement: '', items: [], total_ht: 0 };
            const [form, setForm] = useState({ ferme: 'F1', objet: '', date_limite_reponse: '', items_demandes: [{ article: '', quantite: '', unite: 'kg', categorie: 'engrais' }], offres: [{ ...emptyOffre }, { ...emptyOffre }, { ...emptyOffre }] });

            const load = () => { setLoading(true); fetch('/api/stock?action=list-consultations').then(r=>r.json()).then(j=>{ if(j.success) setConsultations(j.consultations||[]); }).catch(()=>{}).finally(()=>setLoading(false)); };
            useEffect(()=>{ load(); }, []);

            const handleCreate = () => {
                if (!form.objet.trim()) { alert('Objet requis'); return; }
                fetch('/api/stock?action=create-consultation', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...form, created_by: { uid: currentProfile, name: profileData?.name||currentProfile } }) })
                .then(r=>r.json()).then(j=>{ if(j.success) { setShowForm(false); load(); alert('Consultation '+j.numero+' créée'); } else alert('Erreur: '+j.error); }).catch(()=>alert('Erreur réseau'));
            };

            const statusColors = { en_cours: '#f39c12', cloturee: '#27ae60', annulee: '#e74c3c' };
            const statusLabels = { en_cours: 'En cours', cloturee: 'Clôturée', annulee: 'Annulée' };

            if (loading) return React.createElement('div', {style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                        <div style={{fontSize:13,color:'#666'}}><i className="fa-solid fa-scale-balanced" style={{marginRight:6,color:'var(--berry)'}}></i>{consultations.length} consultation(s)</div>
                        <button onClick={()=>setShowForm(true)} style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                            <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouvelle consultation
                        </button>
                    </div>
                    <div style={{background:'rgba(243,156,18,0.08)',border:'1px solid rgba(243,156,18,0.3)',borderRadius:8,padding:'8px 14px',marginBottom:12,fontSize:12,color:'#7d6608'}}>
                        <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                        Toute commande doit être précédée d'une consultation avec <strong>au minimum 3 offres contradictoires</strong>. La consultation retenue génère automatiquement le BDC.
                    </div>
                    {consultations.length === 0 && !showForm && (
                        <div style={{textAlign:'center',padding:60,color:'#aaa'}}>
                            <i className="fa-solid fa-scale-balanced" style={{fontSize:48,marginBottom:16,display:'block',color:'#ddd'}}></i>
                            Aucune consultation — créez-en une avant d'établir un BDC
                        </div>
                    )}
                    {consultations.map(c => (
                        <div key={c.id} style={{background:'#fff',border:'1px solid #e9ecef',borderRadius:10,padding:16,marginBottom:12,cursor:'pointer'}} onClick={()=>setSelected(selected===c.id?null:c.id)}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                <div><span style={{fontWeight:700,color:'var(--berry)',marginRight:8}}>{c.numero}</span><span style={{fontWeight:600}}>{c.objet}</span><span style={{marginLeft:8,fontSize:12,color:'#666'}}>— {c.ferme}</span></div>
                                <span style={{background: statusColors[c.status]+'22',color: statusColors[c.status],padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:600}}>{statusLabels[c.status]||c.status}</span>
                            </div>
                            {selected===c.id && (
                                <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid #f0f0f0'}}>
                                    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
                                        {(c.offres||[]).map((o,i) => (
                                            <div key={i} style={{border: o.retenu?'2px solid #27ae60':'1px solid #ddd',borderRadius:8,padding:12,background: o.retenu?'rgba(39,174,96,0.05)':'#fafafa'}}>
                                                <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{o.fournisseur_nom||'Offre '+(i+1)} {o.retenu&&<span style={{color:'#27ae60',marginLeft:4}}>✓ Retenue</span>}</div>
                                                <div style={{fontSize:12,color:'#666'}}>Total HT: <strong>{(o.total_ht||0).toFixed(2)} MAD</strong></div>
                                                <div style={{fontSize:11,color:'#999'}}>Délai: {o.delai_livraison||'—'} j &nbsp;|&nbsp; {o.conditions_paiement||'—'}</div>
                                            </div>
                                        ))}
                                    </div>
                                    {c.bdc_id && <p style={{marginTop:8,fontSize:12,color:'#27ae60'}}><i className="fa-solid fa-link" style={{marginRight:4}}></i>BDC généré : {c.bdc_id}</p>}
                                </div>
                            )}
                        </div>
                    ))}
                    {showForm && (
                        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
                            <div style={{background:'#fff',borderRadius:12,padding:24,width:'100%',maxWidth:700,maxHeight:'90vh',overflowY:'auto'}}>
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:16}}><h3 style={{margin:0}}>Nouvelle Consultation</h3><button onClick={()=>setShowForm(false)} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'#999'}}>×</button></div>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Objet *</label><input value={form.objet} onChange={e=>setForm({...form,objet:e.target.value})} placeholder="Ex: Achat engrais Q2 2026" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,boxSizing:'border-box'}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Ferme</label><select value={form.ferme} onChange={e=>setForm({...form,ferme:e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>{FARMS.map(f=><option key={f} value={f}>{f}</option>)}</select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date limite réponse</label><input type="date" value={form.date_limite_reponse} onChange={e=>setForm({...form,date_limite_reponse:e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                </div>
                                <h4 style={{marginBottom:8}}>Articles demandés</h4>
                                {form.items_demandes.map((it,i) => (
                                    <div key={i} style={{display:'grid',gridTemplateColumns:'3fr 1fr 1fr auto',gap:8,marginBottom:8,alignItems:'center'}}>
                                        <input value={it.article} onChange={e=>{ const arr=[...form.items_demandes]; arr[i]={...arr[i],article:e.target.value}; setForm({...form,items_demandes:arr}); }} placeholder="Article" style={{padding:'6px 10px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} />
                                        <input type="number" value={it.quantite} onChange={e=>{ const arr=[...form.items_demandes]; arr[i]={...arr[i],quantite:e.target.value}; setForm({...form,items_demandes:arr}); }} placeholder="Qté" style={{padding:'6px 10px',borderRadius:6,border:'1px solid #ddd',fontSize:12,textAlign:'right'}} />
                                        <select value={it.unite} onChange={e=>{ const arr=[...form.items_demandes]; arr[i]={...arr[i],unite:e.target.value}; setForm({...form,items_demandes:arr}); }} style={{padding:'6px',borderRadius:6,border:'1px solid #ddd',fontSize:12}}><option value="kg">kg</option><option value="L">L</option><option value="unité">unité</option><option value="sac">sac</option></select>
                                        <button onClick={()=>{ if(form.items_demandes.length>1) setForm({...form,items_demandes:form.items_demandes.filter((_,j)=>j!==i)}); }} style={{background:'none',border:'none',cursor:'pointer',color:'#e74c3c',fontSize:14}}>✕</button>
                                    </div>
                                ))}
                                <button onClick={()=>setForm({...form,items_demandes:[...form.items_demandes,{article:'',quantite:'',unite:'kg',categorie:'engrais'}]})} style={{fontSize:12,color:'var(--berry)',background:'none',border:'1px dashed var(--berry)',borderRadius:6,padding:'4px 12px',cursor:'pointer',marginBottom:16}}>+ Ajouter article</button>
                                <h4 style={{marginBottom:8}}>Offres reçues (3 minimum)</h4>
                                {form.offres.map((o,i) => (
                                    <div key={i} style={{border:'1px solid #e9ecef',borderRadius:8,padding:12,marginBottom:12}}>
                                        <div style={{fontWeight:600,fontSize:12,marginBottom:8,color:'var(--berry)'}}>Offre {i+1}</div>
                                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                                            <div><label style={{fontSize:11,display:'block',marginBottom:2}}>Fournisseur</label><input value={o.fournisseur_nom} onChange={e=>{ const arr=[...form.offres]; arr[i]={...arr[i],fournisseur_nom:e.target.value}; setForm({...form,offres:arr}); }} style={{width:'100%',padding:'6px 10px',borderRadius:6,border:'1px solid #ddd',fontSize:12,boxSizing:'border-box'}} /></div>
                                            <div><label style={{fontSize:11,display:'block',marginBottom:2}}>Total HT (MAD)</label><input type="number" value={o.total_ht||''} onChange={e=>{ const arr=[...form.offres]; arr[i]={...arr[i],total_ht:parseFloat(e.target.value)||0}; setForm({...form,offres:arr}); }} style={{width:'100%',padding:'6px 10px',borderRadius:6,border:'1px solid #ddd',fontSize:12,boxSizing:'border-box'}} /></div>
                                            <div><label style={{fontSize:11,display:'block',marginBottom:2}}>Délai (jours)</label><input type="number" value={o.delai_livraison||''} onChange={e=>{ const arr=[...form.offres]; arr[i]={...arr[i],delai_livraison:e.target.value}; setForm({...form,offres:arr}); }} style={{width:'100%',padding:'6px 10px',borderRadius:6,border:'1px solid #ddd',fontSize:12,boxSizing:'border-box'}} /></div>
                                        </div>
                                        <div style={{marginTop:8}}><label style={{fontSize:11,display:'block',marginBottom:2}}>Conditions paiement</label><input value={o.conditions_paiement} onChange={e=>{ const arr=[...form.offres]; arr[i]={...arr[i],conditions_paiement:e.target.value}; setForm({...form,offres:arr}); }} placeholder="Ex: 30 jours, comptant..." style={{width:'100%',padding:'6px 10px',borderRadius:6,border:'1px solid #ddd',fontSize:12,boxSizing:'border-box'}} /></div>
                                    </div>
                                ))}
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
                                    <button onClick={()=>setShowForm(false)} style={{padding:'8px 20px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleCreate} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Créer la consultation</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { AchatsConsultationTab };
