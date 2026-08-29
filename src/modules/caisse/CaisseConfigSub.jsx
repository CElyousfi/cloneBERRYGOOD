/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaisseConfigSub */
import { formatMAD } from '../finance/formatMAD.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { getCaisseColor } from './getCaisseColor.jsx';

// ---- Configuration Sub (DG/Finance) ----
        function CaisseConfigSub({ caisses, onDone }) {
            const [showModal, setShowModal] = useState(false);
            const [newName, setNewName] = useState('');
            const [newDesc, setNewDesc] = useState('');
            const [saving, setSaving] = useState(false);
            const [seedLoading, setSeedLoading] = useState(false);

            const createCaisse = () => {
                if (!newName.trim()) return alert('Nom requis');
                setSaving(true);
                fetch('/api/caisse?action=create-caisse', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nom: newName, description: newDesc }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { setShowModal(false); setNewName(''); setNewDesc(''); onDone(); }
                    else alert('Erreur: ' + (json.error || 'Inconnue'));
                }).catch(err => alert('Erreur: ' + err.message)).finally(() => setSaving(false));
            };

            const seedDefaults = () => {
                setSeedLoading(true);
                fetch('/api/caisse?action=seed-defaults', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
                    .then(r => r.json()).then(json => { if (json.success) { alert('Caisses par défaut créées'); onDone(); } else alert('Erreur: ' + json.error); })
                    .catch(err => alert('Erreur: ' + err.message)).finally(() => setSeedLoading(false));
            };

            return (
                <div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <h4 style={{margin:0}}><i className="fa-solid fa-gear" style={{color:'var(--berry)',marginRight:8}}></i>Configuration des Caisses</h4>
                        <div style={{display:'flex',gap:8}}>
                            {caisses.length === 0 && (
                                <button onClick={seedDefaults} disabled={seedLoading} style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--gold)',background:'rgba(212,168,71,0.1)',color:'var(--gold)',cursor:'pointer',fontSize:12,fontWeight:600}}>
                                    {seedLoading ? <i className="fa-solid fa-spinner fa-spin" style={{marginRight:4}}></i> : <i className="fa-solid fa-database" style={{marginRight:4}}></i>}
                                    Créer caisses par défaut
                                </button>
                            )}
                            <button onClick={()=>setShowModal(true)} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'white',cursor:'pointer',fontSize:12,fontWeight:600}}>
                                <i className="fa-solid fa-plus" style={{marginRight:4}}></i>Nouvelle Caisse
                            </button>
                        </div>
                    </div>

                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
                        {caisses.map(c => {
                            const cc = getCaisseColor(c.id);
                            return (
                                <div key={c.id} style={{background:'white',borderRadius:12,border:'1px solid var(--gray-200)',padding:20,position:'relative',overflow:'hidden'}}>
                                    <div style={{position:'absolute',top:0,left:0,width:4,height:'100%',background:cc.color}}></div>
                                    <div style={{paddingLeft:12}}>
                                        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                                            <div style={{width:40,height:40,borderRadius:10,background:cc.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                                <i className={`fa-solid ${cc.icon}`} style={{color:cc.color,fontSize:16}}></i>
                                            </div>
                                            <div>
                                                <div style={{fontWeight:600,fontSize:14}}>{c.nom}</div>
                                                <div style={{fontSize:11,color:'var(--gray-400)'}}>{c.description || 'Pas de description'}</div>
                                            </div>
                                        </div>
                                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:12}}>
                                            <div>
                                                <div style={{fontSize:10,color:'var(--gray-400)',textTransform:'uppercase'}}>Solde Actuel</div>
                                                <div style={{fontSize:20,fontWeight:700,color:cc.color}}>{formatMAD(c.solde_actuel)}</div>
                                            </div>
                                            {c.is_default && <span style={{padding:'3px 10px',borderRadius:12,background:'var(--berry-pale)',color:'var(--berry)',fontSize:10,fontWeight:600}}>Par défaut</span>}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Create modal */}
                    {showModal && (
                        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
                            <div className="modal-content" onClick={e=>e.stopPropagation()} style={{maxWidth:440}}>
                                <h3 style={{margin:'0 0 16px',fontSize:16}}>
                                    <i className="fa-solid fa-plus-circle" style={{marginRight:8,color:'var(--berry)'}}></i>Nouvelle Caisse
                                </h3>
                                <div style={{marginBottom:14}}>
                                    <label style={{fontSize:11,fontWeight:600,color:'var(--gray-600)',marginBottom:4,display:'block'}}>Nom *</label>
                                    <input type="text" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Ex: Caisse Avocatier"
                                        style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid var(--gray-200)',fontSize:13}} autoFocus />
                                </div>
                                <div style={{marginBottom:14}}>
                                    <label style={{fontSize:11,fontWeight:600,color:'var(--gray-600)',marginBottom:4,display:'block'}}>Description</label>
                                    <textarea value={newDesc} onChange={e=>setNewDesc(e.target.value)} placeholder="Description de la caisse..."
                                        style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid var(--gray-200)',fontSize:13,minHeight:60,resize:'vertical',fontFamily:'Inter, sans-serif'}} />
                                </div>
                                <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                                    <button onClick={()=>setShowModal(false)} style={{padding:'10px 20px',borderRadius:10,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={createCaisse} disabled={saving} style={{padding:'10px 20px',borderRadius:10,border:'none',background:'var(--berry)',color:'white',cursor:'pointer',fontSize:13,fontWeight:600}}>
                                        {saving ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Créer'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { CaisseConfigSub };
