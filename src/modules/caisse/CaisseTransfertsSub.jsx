/* Module: caisse | Déclaration(s): CaisseTransfertsSub */
import { formatMAD } from '../finance/formatMAD.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ---- Transferts Sub ----
        function CaisseTransfertsSub({ caisses, isSaisie, onDone }) {
            const [form, setForm] = useState({ from_caisse_id: caisses[0]?.id||'', to_caisse_id: caisses[1]?.id||'', montant: '', description: '', date: new Date().toISOString().slice(0,10) });
            const [saving, setSaving] = useState(false);
            const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--gray-200)', fontSize: 13, fontFamily: 'Inter, sans-serif' };

            const submit = (asBrouillon) => {
                if (!form.from_caisse_id || !form.to_caisse_id || !form.montant || !form.date) return alert('Veuillez remplir les champs obligatoires');
                if (form.from_caisse_id === form.to_caisse_id) return alert('La caisse source et destination doivent être différentes');
                if (parseFloat(form.montant) <= 0) return alert('Le montant doit être positif');
                setSaving(true);
                fetch('/api/caisse?action=create-transfer', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...form, montant: parseFloat(form.montant), submit: !asBrouillon }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { alert(asBrouillon ? 'Brouillon de transfert créé' : 'Transfert soumis pour validation'); onDone(); }
                    else alert('Erreur: ' + (json.error || 'Inconnue'));
                }).catch(err => alert('Erreur: ' + err.message)).finally(() => setSaving(false));
            };

            const fromCaisse = caisses.find(c => c.id === form.from_caisse_id);
            const toCaisse = caisses.find(c => c.id === form.to_caisse_id);

            return (
                <div style={{maxWidth:560}}>
                    <div style={{background:'white',borderRadius:12,border:'1px solid var(--gray-200)',padding:24}}>
                        <h4 style={{margin:'0 0 20px',display:'flex',alignItems:'center',gap:8}}>
                            <i className="fa-solid fa-right-left" style={{color:'var(--berry)'}}></i>Transfert Inter-Caisse
                        </h4>

                        {/* Visual transfer display */}
                        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20,padding:16,background:'var(--berry-pale)',borderRadius:12}}>
                            <div style={{flex:1,textAlign:'center'}}>
                                <div style={{fontSize:10,color:'var(--gray-400)',marginBottom:4}}>DE</div>
                                <div style={{fontWeight:600,fontSize:13,color:'var(--berry)'}}>{fromCaisse?.nom||'—'}</div>
                                <div style={{fontSize:11,color:'var(--gray-600)'}}>{formatMAD(fromCaisse?.solde_actuel||0)}</div>
                            </div>
                            <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
                                <i className="fa-solid fa-arrow-right" style={{fontSize:18,color:'var(--berry)'}}></i>
                                {form.montant && <div style={{fontSize:12,fontWeight:700,color:'var(--berry)',marginTop:4}}>{formatMAD(parseFloat(form.montant)||0)}</div>}
                            </div>
                            <div style={{flex:1,textAlign:'center'}}>
                                <div style={{fontSize:10,color:'var(--gray-400)',marginBottom:4}}>VERS</div>
                                <div style={{fontWeight:600,fontSize:13,color:'var(--green)'}}>{toCaisse?.nom||'—'}</div>
                                <div style={{fontSize:11,color:'var(--gray-600)'}}>{formatMAD(toCaisse?.solde_actuel||0)}</div>
                            </div>
                        </div>

                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                            <div>
                                <label style={{fontSize:11,fontWeight:600,color:'var(--gray-600)',marginBottom:4,display:'block'}}>Caisse Source *</label>
                                <select value={form.from_caisse_id} onChange={e=>setForm({...form,from_caisse_id:e.target.value})} style={inputStyle}>
                                    {caisses.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={{fontSize:11,fontWeight:600,color:'var(--gray-600)',marginBottom:4,display:'block'}}>Caisse Destination *</label>
                                <select value={form.to_caisse_id} onChange={e=>setForm({...form,to_caisse_id:e.target.value})} style={inputStyle}>
                                    {caisses.filter(c=>c.id!==form.from_caisse_id).map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={{fontSize:11,fontWeight:600,color:'var(--gray-600)',marginBottom:4,display:'block'}}>Montant (DH) *</label>
                                <input type="number" step="0.01" min="0" value={form.montant} onChange={e=>setForm({...form,montant:e.target.value})} style={inputStyle} placeholder="0.00" />
                            </div>
                            <div>
                                <label style={{fontSize:11,fontWeight:600,color:'var(--gray-600)',marginBottom:4,display:'block'}}>Date *</label>
                                <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} style={inputStyle} />
                            </div>
                            <div style={{gridColumn:'1/-1'}}>
                                <label style={{fontSize:11,fontWeight:600,color:'var(--gray-600)',marginBottom:4,display:'block'}}>Description</label>
                                <textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} style={{...inputStyle,minHeight:60,resize:'vertical'}} placeholder="Motif du transfert..." />
                            </div>
                        </div>
                        {isSaisie && (
                            <div style={{display:'flex',gap:10,marginTop:20,justifyContent:'flex-end'}}>
                                <button onClick={()=>submit(true)} disabled={saving} style={{padding:'10px 20px',borderRadius:10,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:13,fontWeight:500,opacity:saving?0.5:1}}>
                                    <i className="fa-solid fa-floppy-disk" style={{marginRight:6}}></i>Brouillon
                                </button>
                                <button onClick={()=>submit(false)} disabled={saving} style={{padding:'10px 20px',borderRadius:10,border:'none',background:'var(--berry)',color:'white',cursor:'pointer',fontSize:13,fontWeight:600,opacity:saving?0.5:1}}>
                                    {saving ? <i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i> : <i className="fa-solid fa-paper-plane" style={{marginRight:6}}></i>}
                                    Soumettre
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

export { CaisseTransfertsSub };
