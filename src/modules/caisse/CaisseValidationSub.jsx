/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaisseValidationSub */
import { formatMAD } from '../finance/formatMAD.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { TXN_TYPE_LABELS } from './TXN_TYPE_LABELS.jsx';

// ---- Validation Sub (DG/Finance) ----
        function CaisseValidationSub({ caisses, onDone }) {
            const [transactions, setTransactions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [actionLoading, setActionLoading] = useState(null);
            const [rejectModal, setRejectModal] = useState(null);
            const [rejectMotif, setRejectMotif] = useState('');
            // Mode revue : un bon à la fois, navigation ← →. C'est le mode par
            // défaut — empiler 40 cartes fait perdre le fil à la DG.
            const [modeRevue, setModeRevue] = useState(true);

            // Décision unitaire depuis la revue. Réutilise les actions existantes ;
            // la validation UNITAIRE mouvemente le solde de façon atomique.
            const decisionRevue = (id, decision, motifRejet) => {
                const cfg = {
                    valide:   { action: 'validate-transaction', body: { id } },
                    rejete:   { action: 'reject-transaction',   body: { id, motif: motifRejet } },
                    a_revoir: { action: 'mark-revoir-batch',    body: { ids: [id], motif: motifRejet || '' } },
                }[decision];
                if (!cfg) return Promise.resolve(false);
                return fetch('/api/caisse?action=' + cfg.action, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(cfg.body),
                }).then(r => r.json()).then(json => {
                    if (!json.success) { alert('Erreur: ' + (json.error || 'Inconnue')); return false; }
                    setTransactions(prev => prev.filter(t => t.id !== id));
                    onDone();
                    return true;
                }).catch(err => { alert('Erreur: ' + err.message); return false; });
            };

            const load = () => {
                setLoading(true);
                fetch('/api/caisse?action=list-transactions&status=soumis').then(r => r.json()).then(json => {
                    if (json.success) setTransactions(json.transactions || []);
                }).catch(() => {}).finally(() => setLoading(false));
            };
            React.useEffect(() => { load(); }, []);

            const validate = (id) => {
                setActionLoading(id);
                fetch('/api/caisse?action=validate-transaction', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { setTransactions(prev => prev.filter(t => t.id !== id)); onDone(); }
                    else alert('Erreur: ' + (json.error || 'Inconnue'));
                }).catch(err => alert('Erreur: ' + err.message)).finally(() => setActionLoading(null));
            };

            const reject = () => {
                if (!rejectMotif.trim()) return alert('Veuillez saisir un motif de rejet');
                setActionLoading(rejectModal);
                fetch('/api/caisse?action=reject-transaction', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: rejectModal, motif: rejectMotif }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { setTransactions(prev => prev.filter(t => t.id !== rejectModal)); setRejectModal(null); setRejectMotif(''); onDone(); }
                    else alert('Erreur: ' + (json.error || 'Inconnue'));
                }).catch(err => alert('Erreur: ' + err.message)).finally(() => setActionLoading(null));
            };

            if (loading) return <div style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:20,color:'var(--berry)'}}></i></div>;
            if (transactions.length === 0) return (
                <div style={{textAlign:'center',padding:60}}>
                    <i className="fa-solid fa-check-circle" style={{fontSize:48,color:'var(--green)',marginBottom:12}}></i>
                    <div style={{fontSize:16,fontWeight:600,color:'var(--gray-800)'}}>Aucune transaction en attente</div>
                    <div style={{fontSize:13,color:'var(--gray-400)',marginTop:4}}>Toutes les transactions ont été traitées</div>
                </div>
            );

            if (modeRevue && window.CaisseRevueValidation) return (
                <window.CaisseRevueValidation
                    transactions={transactions}
                    caisses={caisses}
                    onDecision={decisionRevue}
                    onQuitter={() => setModeRevue(false)}
                />
            );

            return (
                <div>
                    <div style={{marginBottom:12,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                        <span style={{fontSize:13,color:'var(--gray-600)'}}>
                            <strong>{transactions.length}</strong> transaction(s) en attente de validation
                        </span>
                        {window.CaisseRevueValidation && (
                            <button onClick={() => setModeRevue(true)}
                                style={{padding:'7px 14px',borderRadius:8,border:'none',background:'var(--berry)',color:'white',cursor:'pointer',fontSize:12,fontWeight:600}}>
                                <i className="fa-solid fa-layer-group" style={{marginRight:6}}></i>Revue une par une
                            </button>
                        )}
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:12}}>
                        {transactions.map(tx => {
                            const tt = TXN_TYPE_LABELS[tx.type]||{};
                            const caisseName = caisses.find(c=>c.id===tx.caisse_id)?.nom || tx.caisse_id;
                            const isLoading = actionLoading === tx.id;
                            return (
                                <div key={tx.id} style={{background:'white',borderRadius:12,border:'1px solid var(--gray-200)',padding:16,opacity:isLoading?0.6:1}}>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
                                        <div style={{flex:1,minWidth:200}}>
                                            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                                                <span style={{padding:'3px 10px',borderRadius:12,background:tt.bg||'#eee',color:tt.color||'#333',fontSize:11,fontWeight:600}}>
                                                    <i className={`fa-solid ${tt.icon||''}`} style={{marginRight:4}}></i>{tt.label||tx.type}
                                                </span>
                                                <span style={{fontSize:11,color:'var(--gray-400)'}}>{caisseName}</span>
                                                <span style={{fontSize:11,color:'var(--gray-400)',fontFamily:'monospace'}}>{tx.reference}</span>
                                            </div>
                                            <div style={{fontSize:22,fontWeight:700,color:['depense','sortie','transfer_out'].includes(tx.type)?'var(--red)':'var(--green)',marginBottom:4}}>
                                                {['depense','sortie','transfer_out'].includes(tx.type)?'-':'+'}{formatMAD(tx.montant)}
                                            </div>
                                            <div style={{fontSize:12,color:'var(--gray-600)',marginBottom:4}}>{tx.description || '—'}</div>
                                            <div style={{fontSize:11,color:'var(--gray-400)'}}>
                                                Date: {tx.date} | Saisi par: {tx.saisie_by?.name||'—'} {tx.code_analytique ? `| Analytique: ${tx.code_analytique}` : ''}
                                            </div>
                                            {tx.files && tx.files.length > 0 && (
                                                <div style={{display:'flex',gap:6,marginTop:8}}>
                                                    {tx.files.map((f,j) => <img key={j} src={f.data||f.url} alt="" style={{width:50,height:50,objectFit:'cover',borderRadius:6,border:'1px solid var(--gray-200)'}} />)}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                                            <button onClick={()=>validate(tx.id)} disabled={isLoading}
                                                style={{padding:'10px 20px',borderRadius:10,border:'none',background:'var(--green)',color:'white',cursor:'pointer',fontSize:13,fontWeight:600,opacity:isLoading?0.5:1}}>
                                                {isLoading ? <i className="fa-solid fa-spinner fa-spin"></i> : <><i className="fa-solid fa-check" style={{marginRight:4}}></i>Valider</>}
                                            </button>
                                            <button onClick={()=>{setRejectModal(tx.id);setRejectMotif('');}} disabled={isLoading}
                                                style={{padding:'10px 20px',borderRadius:10,border:'1px solid var(--red)',background:'white',color:'var(--red)',cursor:'pointer',fontSize:13,fontWeight:600,opacity:isLoading?0.5:1}}>
                                                <i className="fa-solid fa-xmark" style={{marginRight:4}}></i>Rejeter
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Reject modal */}
                    {rejectModal && (
                        <div className="modal-overlay" onClick={()=>setRejectModal(null)}>
                            <div className="modal-content" onClick={e=>e.stopPropagation()} style={{maxWidth:440}}>
                                <h3 style={{margin:'0 0 16px',fontSize:16,color:'var(--red)'}}>
                                    <i className="fa-solid fa-triangle-exclamation" style={{marginRight:8}}></i>Rejeter la transaction
                                </h3>
                                <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',marginBottom:6,display:'block'}}>Motif du rejet *</label>
                                <textarea value={rejectMotif} onChange={e=>setRejectMotif(e.target.value)}
                                    style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid var(--gray-200)',fontSize:13,minHeight:80,resize:'vertical',fontFamily:'Inter, sans-serif'}}
                                    placeholder="Expliquez la raison du rejet..." autoFocus />
                                <div style={{display:'flex',gap:10,marginTop:16,justifyContent:'flex-end'}}>
                                    <button onClick={()=>setRejectModal(null)} style={{padding:'10px 20px',borderRadius:10,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={reject} disabled={actionLoading===rejectModal} style={{padding:'10px 20px',borderRadius:10,border:'none',background:'var(--red)',color:'white',cursor:'pointer',fontSize:13,fontWeight:600}}>
                                        {actionLoading===rejectModal ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Confirmer le rejet'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { CaisseValidationSub };
