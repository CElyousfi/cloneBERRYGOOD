/* Module: finance | Déclaration(s): FinCodesAnalytiquesTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== FINANCE: CODES ANALYTIQUES TAB =====================
        function FinCodesAnalytiquesTab({ currentProfile, profileData }) {
            const [codes, setCodes] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [editId, setEditId] = useState(null);
            const emptyForm = { code: '', libelle: '', ferme: 'Toutes', categorie_achat: 'engrais', nature_cpc: '612' };
            const [form, setForm] = useState({ ...emptyForm });
            const FERMES = ['Toutes','F1','F5','Avocatier'];
            const CATS = ['engrais','phyto','emballage','materiel','autre'];
            const CPC_NATURES = [{ v:'612', l:'612 - Achats consommés' },{ v:'613', l:'613 - Autres charges' },{ v:'614', l:'614 - Charges externalisées' },{ v:'621', l:'621 - Rémunérations' },{ v:'2335', l:'2335 - Matériel/Outillage' }];

            const load = () => { setLoading(true); fetch('/api/stock?action=list-codes-analytiques').then(r=>r.json()).then(j=>{ if(j.success) setCodes(j.codes||[]); }).finally(()=>setLoading(false)); };
            useEffect(()=>{ load(); }, []);

            const handleSave = () => {
                if (!form.code||!form.libelle) { alert('Code et libellé requis'); return; }
                fetch('/api/stock?action=save-code-analytique', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...form, id: editId||undefined, saved_by: { uid: currentProfile, name: profileData?.name||currentProfile } }) })
                .then(r=>r.json()).then(j=>{ if(j.success) { setShowForm(false); setEditId(null); setForm({...emptyForm}); load(); } else alert('Erreur: '+j.error); }).catch(()=>alert('Erreur réseau'));
            };
            const handleDelete = (id) => {
                if (!confirm('Désactiver ce code analytique ?')) return;
                fetch('/api/stock?action=delete-code-analytique', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
                .then(r=>r.json()).then(j=>{ if(j.success) load(); }).catch(()=>{});
            };
            const startEdit = (c) => { setForm({ code: c.code, libelle: c.libelle, ferme: c.ferme||'Toutes', categorie_achat: c.categorie_achat||'engrais', nature_cpc: c.nature_cpc||'612' }); setEditId(c.id); setShowForm(true); };

            if (loading) return React.createElement('div', {style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));
            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                        <div style={{fontSize:13,color:'#666'}}><i className="fa-solid fa-tags" style={{marginRight:6,color:'var(--berry)'}}></i>{codes.length} code(s) actif(s)</div>
                        <button onClick={()=>{ setEditId(null); setForm({...emptyForm}); setShowForm(true); }} style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                            <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouveau code
                        </button>
                    </div>
                    <div style={{background:'rgba(52,152,219,0.08)',border:'1px solid rgba(52,152,219,0.2)',borderRadius:8,padding:'8px 14px',marginBottom:12,fontSize:12,color:'#2c3e50'}}>
                        <i className="fa-solid fa-circle-info" style={{marginRight:6,color:'var(--blue)'}}></i>
                        Les codes analytiques sont utilisés dans les BDC pour le traitement du CPC. Ils sont basés sur le plan comptable marocain (PCM).
                    </div>
                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>Code</th><th>Libellé</th><th>Ferme</th><th>Catégorie Achat</th><th>Nature CPC</th><th></th></tr></thead>
                        <tbody>
                            {codes.map(c => (
                                <tr key={c.id}>
                                    <td style={{fontFamily:'monospace',fontWeight:700,color:'var(--berry)'}}>{c.code}</td>
                                    <td>{c.libelle}</td>
                                    <td><span style={{background:'rgba(45,139,78,0.1)',color:'#2D8B4E',padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:600}}>{c.ferme||'Toutes'}</span></td>
                                    <td style={{fontSize:12,color:'#666'}}>{c.categorie_achat}</td>
                                    <td style={{fontFamily:'monospace',fontSize:12}}>{c.nature_cpc}</td>
                                    <td style={{display:'flex',gap:6}}>
                                        <button onClick={()=>startEdit(c)} style={{background:'none',border:'1px solid #ddd',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:11}}>Modifier</button>
                                        <button onClick={()=>handleDelete(c.id)} style={{background:'none',border:'1px solid #fcc',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:11,color:'#e74c3c'}}>Désactiver</button>
                                    </td>
                                </tr>
                            ))}
                            {codes.length===0 && <tr><td colSpan={6} style={{textAlign:'center',padding:30,color:'#aaa'}}>Aucun code analytique configuré</td></tr>}
                        </tbody>
                    </table></div>
                    {showForm && (
                        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
                            <div style={{background:'#fff',borderRadius:12,padding:24,width:'100%',maxWidth:500}}>
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:16}}><h3 style={{margin:0}}>{editId?'Modifier':'Nouveau'} code analytique</h3><button onClick={()=>setShowForm(false)} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'#999'}}>×</button></div>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:12,marginBottom:16}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Code *</label><input value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})} placeholder="Ex: 612-F1-ENG" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,fontFamily:'monospace',boxSizing:'border-box'}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Libellé *</label><input value={form.libelle} onChange={e=>setForm({...form,libelle:e.target.value})} placeholder="Ex: Engrais - Ferme F1" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,boxSizing:'border-box'}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Ferme</label><select value={form.ferme} onChange={e=>setForm({...form,ferme:e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>{FERMES.map(f=><option key={f} value={f}>{f}</option>)}</select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Catégorie Achat</label><select value={form.categorie_achat} onChange={e=>setForm({...form,categorie_achat:e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>{CATS.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
                                    <div style={{gridColumn:'1/-1'}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Nature CPC (Plan Comptable Marocain)</label><select value={form.nature_cpc} onChange={e=>setForm({...form,nature_cpc:e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>{CPC_NATURES.map(n=><option key={n.v} value={n.v}>{n.l}</option>)}</select></div>
                                </div>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                    <button onClick={()=>setShowForm(false)} style={{padding:'8px 20px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleSave} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Enregistrer</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { FinCodesAnalytiquesTab };
