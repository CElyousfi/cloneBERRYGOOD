/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: achats | Déclaration(s): AchatsVentePlastiqueTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== ACHATS: VENTE PLASTIQUE TAB =====================
        function AchatsVentePlastiqueTab({ currentProfile, profileData }) {
            const [ventes, setVentes] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [editingVente, setEditingVente] = useState(null);
            const [saving, setSaving] = useState(false);
            const [filterMois, setFilterMois] = useState('');

            const TYPES_PLASTIQUE = ['Film plastique','Barquette','Caisse plastique','Palette plastique','Bidon','Tuyau irrigation','Autre'];
            const emptyForm = { date:'', typePlastique:'Film plastique', quantiteKg:'', acheteur:'', prixKg:'', totalDH:'', notes:'' };
            const [form, setForm] = useState({...emptyForm});

            const fStyle = {width:'100%',padding:'8px 10px',borderRadius:8,border:'1px solid #ddd',fontSize:13};
            const lStyle = {fontSize:11,fontWeight:600,display:'block',marginBottom:4};

            const loadVentes = async () => {
                setLoading(true);
                try {
                    const db = firebase.firestore();
                    let query = db.collection('ventes_plastique').orderBy('date','desc').limit(500);
                    const snap = await query.get();
                    let list = [];
                    snap.forEach(doc => list.push({id:doc.id,...doc.data()}));
                    if (filterMois) {
                        list = list.filter(v => v.date && v.date.startsWith(filterMois));
                    }
                    setVentes(list);
                } catch(err) { console.error('Load ventes plastique error:',err); }
                setLoading(false);
            };
            useEffect(() => { loadVentes(); }, [filterMois]);

            const handleSubmit = async () => {
                if (!form.date || !form.quantiteKg || !form.acheteur) {
                    alert('Veuillez remplir Date, Quantité et Acheteur'); return;
                }
                setSaving(true);
                try {
                    const db = firebase.firestore();
                    const qte = parseFloat(form.quantiteKg) || 0;
                    const prix = parseFloat(form.prixKg) || 0;
                    const record = {
                        date: form.date,
                        typePlastique: form.typePlastique,
                        quantiteKg: qte,
                        acheteur: form.acheteur.trim(),
                        prixKg: prix,
                        totalDH: qte * prix,
                        notes: form.notes.trim(),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: { profileId: currentProfile, name: profileData?.name || currentProfile },
                    };
                    if (editingVente) {
                        await db.collection('ventes_plastique').doc(editingVente.id).update(record);
                    } else {
                        record.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                        record.createdBy = { profileId: currentProfile, name: profileData?.name || currentProfile };
                        await db.collection('ventes_plastique').add(record);
                    }
                    setShowForm(false); setEditingVente(null); setForm({...emptyForm});
                    loadVentes();
                } catch(err) { alert('Erreur: '+err.message); }
                setSaving(false);
            };

            const handleEdit = (v) => {
                setEditingVente(v);
                setForm({ date:v.date||'', typePlastique:v.typePlastique||'Film plastique', quantiteKg:v.quantiteKg||'', acheteur:v.acheteur||'', prixKg:v.prixKg||'', totalDH:v.totalDH||'', notes:v.notes||'' });
                setShowForm(true);
            };

            const handleDelete = async (v) => {
                if (!confirm('Supprimer cette vente ?')) return;
                try {
                    await firebase.firestore().collection('ventes_plastique').doc(v.id).delete();
                    loadVentes();
                } catch(err) { alert('Erreur: '+err.message); }
            };

            const totalKg = ventes.reduce((s,v) => s + (v.quantiteKg||0), 0);
            const totalDH = ventes.reduce((s,v) => s + (v.totalDH||0), 0);

            // Group by month for chart
            const byMonth = {};
            ventes.forEach(v => {
                if (!v.date) return;
                const m = v.date.substring(0,7);
                if (!byMonth[m]) byMonth[m] = {kg:0, dh:0};
                byMonth[m].kg += v.quantiteKg || 0;
                byMonth[m].dh += v.totalDH || 0;
            });
            const months = Object.keys(byMonth).sort();

            return (
                <div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
                        <h3 style={{margin:0,fontSize:18}}><i className="fas fa-recycle" style={{marginRight:8,color:'#22c55e'}}></i>Vente Plastique</h3>
                        <div style={{display:'flex',gap:10,alignItems:'center'}}>
                            <input type="month" value={filterMois} onChange={e=>setFilterMois(e.target.value)} style={{...fStyle,width:180}} />
                            {filterMois && <button onClick={()=>setFilterMois('')} style={{background:'none',border:'none',cursor:'pointer',color:'#666',fontSize:13}}>✕ Reset</button>}
                            <button onClick={()=>{setShowForm(true);setEditingVente(null);setForm({...emptyForm})}} style={{background:'#22c55e',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontWeight:600,cursor:'pointer',fontSize:13}}>
                                <i className="fas fa-plus" style={{marginRight:6}}></i>Nouvelle Vente
                            </button>
                        </div>
                    </div>

                    {/* KPI Cards */}
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12,marginBottom:20}}>
                        <div style={{background:'#f0fdf4',borderRadius:12,padding:16,textAlign:'center'}}>
                            <div style={{fontSize:11,color:'#666',fontWeight:600}}>Total Vendu</div>
                            <div style={{fontSize:22,fontWeight:700,color:'#22c55e'}}>{totalKg.toLocaleString('fr-FR',{maximumFractionDigits:0})} kg</div>
                        </div>
                        <div style={{background:'#eff6ff',borderRadius:12,padding:16,textAlign:'center'}}>
                            <div style={{fontSize:11,color:'#666',fontWeight:600}}>Revenu Total</div>
                            <div style={{fontSize:22,fontWeight:700,color:'#1565C0'}}>{totalDH.toLocaleString('fr-FR',{maximumFractionDigits:0})} DH</div>
                        </div>
                        <div style={{background:'#fefce8',borderRadius:12,padding:16,textAlign:'center'}}>
                            <div style={{fontSize:11,color:'#666',fontWeight:600}}>Nombre Ventes</div>
                            <div style={{fontSize:22,fontWeight:700,color:'#ca8a04'}}>{ventes.length}</div>
                        </div>
                        <div style={{background:'#faf5ff',borderRadius:12,padding:16,textAlign:'center'}}>
                            <div style={{fontSize:11,color:'#666',fontWeight:600}}>Prix Moyen/Kg</div>
                            <div style={{fontSize:22,fontWeight:700,color:'#7c3aed'}}>{totalKg > 0 ? (totalDH/totalKg).toFixed(2) : '0'} DH</div>
                        </div>
                    </div>

                    {/* Monthly chart */}
                    {months.length > 1 && (
                        <div style={{background:'#fff',borderRadius:12,padding:16,marginBottom:20,boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                            <div style={{fontSize:13,fontWeight:600,marginBottom:12}}>Évolution Mensuelle</div>
                            <div style={{display:'flex',alignItems:'flex-end',gap:4,height:120}}>
                                {months.map(m => {
                                    const maxKg = Math.max(...months.map(mm => byMonth[mm].kg));
                                    const h = maxKg > 0 ? (byMonth[m].kg / maxKg * 100) : 0;
                                    return (
                                        <div key={m} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                                            <div style={{fontSize:10,fontWeight:600,color:'#22c55e'}}>{byMonth[m].kg.toLocaleString('fr-FR',{maximumFractionDigits:0})}</div>
                                            <div style={{width:'100%',maxWidth:40,height:h,background:'linear-gradient(180deg,#22c55e,#16a34a)',borderRadius:'4px 4px 0 0',minHeight:2}}></div>
                                            <div style={{fontSize:9,color:'#666'}}>{m.substring(5)}/{m.substring(2,4)}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Form Modal */}
                    {showForm && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={()=>setShowForm(false)}>
                            <div style={{background:'#fff',borderRadius:16,padding:24,maxWidth:500,width:'100%',maxHeight:'80vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
                                <h3 style={{margin:'0 0 16px',fontSize:16}}>{editingVente ? 'Modifier Vente' : 'Nouvelle Vente Plastique'}</h3>
                                <div style={{display:'grid',gap:12}}>
                                    <div>
                                        <label style={lStyle}>Date *</label>
                                        <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} style={fStyle} />
                                    </div>
                                    <div>
                                        <label style={lStyle}>Type de Plastique</label>
                                        <select value={form.typePlastique} onChange={e=>setForm({...form,typePlastique:e.target.value})} style={fStyle}>
                                            {TYPES_PLASTIQUE.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={lStyle}>Acheteur *</label>
                                        <input value={form.acheteur} onChange={e=>setForm({...form,acheteur:e.target.value})} style={fStyle} placeholder="Nom de l'acheteur" />
                                    </div>
                                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                                        <div>
                                            <label style={lStyle}>Quantité (kg) *</label>
                                            <input type="number" value={form.quantiteKg} onChange={e=>setForm({...form,quantiteKg:e.target.value})} style={fStyle} placeholder="0" />
                                        </div>
                                        <div>
                                            <label style={lStyle}>Prix/Kg (DH)</label>
                                            <input type="number" step="0.01" value={form.prixKg} onChange={e=>setForm({...form,prixKg:e.target.value})} style={fStyle} placeholder="0.00" />
                                        </div>
                                    </div>
                                    {form.quantiteKg && form.prixKg && (
                                        <div style={{background:'#f0fdf4',borderRadius:8,padding:10,textAlign:'center',fontSize:14,fontWeight:600,color:'#22c55e'}}>
                                            Total: {((parseFloat(form.quantiteKg)||0) * (parseFloat(form.prixKg)||0)).toLocaleString('fr-FR',{maximumFractionDigits:2})} DH
                                        </div>
                                    )}
                                    <div>
                                        <label style={lStyle}>Notes</label>
                                        <textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} style={{...fStyle,minHeight:60}} placeholder="Remarques..." />
                                    </div>
                                </div>
                                <div style={{display:'flex',gap:10,marginTop:16}}>
                                    <button onClick={()=>setShowForm(false)} style={{flex:1,padding:'10px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleSubmit} disabled={saving} style={{flex:1,padding:'10px',borderRadius:8,border:'none',background:'#22c55e',color:'#fff',fontWeight:600,cursor:'pointer',fontSize:13,opacity:saving?0.6:1}}>
                                        {saving ? 'Enregistrement...' : (editingVente ? 'Modifier' : 'Enregistrer')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Table */}
                    {loading ? (
                        <div style={{textAlign:'center',padding:40,color:'#999'}}>Chargement...</div>
                    ) : ventes.length === 0 ? (
                        <div style={{textAlign:'center',padding:40,color:'#999'}}>
                            <i className="fas fa-recycle" style={{fontSize:40,marginBottom:10,display:'block',opacity:0.3}}></i>
                            Aucune vente enregistrée
                        </div>
                    ) : (
                        <div style={{overflowX:'auto'}}>
                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                <thead>
                                    <tr style={{background:'#f8fafc'}}>
                                        <th style={{padding:'10px 8px',textAlign:'left',borderBottom:'2px solid #e2e8f0',fontWeight:600}}>Date</th>
                                        <th style={{padding:'10px 8px',textAlign:'left',borderBottom:'2px solid #e2e8f0',fontWeight:600}}>Type</th>
                                        <th style={{padding:'10px 8px',textAlign:'left',borderBottom:'2px solid #e2e8f0',fontWeight:600}}>Acheteur</th>
                                        <th style={{padding:'10px 8px',textAlign:'right',borderBottom:'2px solid #e2e8f0',fontWeight:600}}>Qté (kg)</th>
                                        <th style={{padding:'10px 8px',textAlign:'right',borderBottom:'2px solid #e2e8f0',fontWeight:600}}>Prix/Kg</th>
                                        <th style={{padding:'10px 8px',textAlign:'right',borderBottom:'2px solid #e2e8f0',fontWeight:600}}>Total DH</th>
                                        <th style={{padding:'10px 8px',textAlign:'center',borderBottom:'2px solid #e2e8f0',fontWeight:600}}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ventes.map(v => (
                                        <tr key={v.id} style={{borderBottom:'1px solid #f1f5f9'}}>
                                            <td style={{padding:'8px'}}>{v.date ? new Date(v.date+'T00:00').toLocaleDateString('fr-FR') : '-'}</td>
                                            <td style={{padding:'8px'}}><span style={{background:'#dcfce7',color:'#166534',padding:'2px 8px',borderRadius:10,fontSize:11,fontWeight:500}}>{v.typePlastique}</span></td>
                                            <td style={{padding:'8px',fontWeight:500}}>{v.acheteur}</td>
                                            <td style={{padding:'8px',textAlign:'right',fontWeight:600}}>{(v.quantiteKg||0).toLocaleString('fr-FR')}</td>
                                            <td style={{padding:'8px',textAlign:'right'}}>{(v.prixKg||0).toFixed(2)}</td>
                                            <td style={{padding:'8px',textAlign:'right',fontWeight:600,color:'#22c55e'}}>{(v.totalDH||0).toLocaleString('fr-FR',{maximumFractionDigits:2})}</td>
                                            <td style={{padding:'8px',textAlign:'center'}}>
                                                <button onClick={()=>handleEdit(v)} style={{background:'none',border:'none',cursor:'pointer',color:'#3b82f6',marginRight:8}} title="Modifier"><i className="fas fa-edit"></i></button>
                                                <button onClick={()=>handleDelete(v)} style={{background:'none',border:'none',cursor:'pointer',color:'#ef4444'}} title="Supprimer"><i className="fas fa-trash"></i></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr style={{background:'#f0fdf4',fontWeight:700}}>
                                        <td colSpan={3} style={{padding:'10px 8px'}}>TOTAL</td>
                                        <td style={{padding:'10px 8px',textAlign:'right'}}>{totalKg.toLocaleString('fr-FR')} kg</td>
                                        <td style={{padding:'10px 8px'}}></td>
                                        <td style={{padding:'10px 8px',textAlign:'right',color:'#22c55e'}}>{totalDH.toLocaleString('fr-FR',{maximumFractionDigits:2})} DH</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </div>
            );
        }

export { AchatsVentePlastiqueTab };
