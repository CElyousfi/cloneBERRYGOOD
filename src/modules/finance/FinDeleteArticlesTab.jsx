/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): FinDeleteArticlesTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== FINANCE: SUPPRESSION ARTICLES TAB =====================
        function FinDeleteArticlesTab({ currentProfile, profileData }) {
            const [requests, setRequests] = useState([]);
            const [loading, setLoading] = useState(true);
            const [processing, setProcessing] = useState(null);

            const load = () => { setLoading(true); fetch('/api/stock?action=list-delete-requests&status=pending').then(r=>r.json()).then(j=>{ if(j.success) setRequests(j.requests||[]); }).catch(()=>{}).finally(()=>setLoading(false)); };
            useEffect(()=>{ load(); }, []);

            const handleValidate = (req, approved) => {
                if (!confirm(approved ? 'Approuver la suppression de "'+req.article_nom+'" ?' : 'Rejeter cette demande de suppression ?')) return;
                setProcessing(req.id);
                fetch('/api/stock?action=validate-delete-article', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ request_id: req.id, approved, validated_by: { uid: currentProfile, name: profileData?.name||currentProfile } }) })
                .then(r=>r.json()).then(j=>{ if(j.success) load(); else alert('Erreur: '+j.error); }).catch(()=>alert('Erreur réseau')).finally(()=>setProcessing(null));
            };

            if (loading) return React.createElement('div', {style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));
            return (
                <div className="fade-in">
                    <div style={{background:'rgba(231,76,60,0.08)',border:'1px solid rgba(231,76,60,0.2)',borderRadius:8,padding:'8px 14px',marginBottom:16,fontSize:12,color:'#922'}}>
                        <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                        Demandes de suppression d'articles du catalogue. La validation supprime définitivement l'article.
                    </div>
                    {requests.length === 0 ? (
                        <div style={{textAlign:'center',padding:60,color:'#aaa'}}>
                            <i className="fa-solid fa-circle-check" style={{fontSize:48,marginBottom:16,display:'block',color:'#ddd'}}></i>
                            Aucune demande de suppression en attente
                        </div>
                    ) : requests.map(r => (
                        <div key={r.id} style={{background:'#fff',border:'1px solid #e9ecef',borderRadius:10,padding:16,marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                            <div>
                                <div style={{fontWeight:700,fontSize:14}}>{r.article_nom}</div>
                                <div style={{fontSize:12,color:'#666',marginTop:4}}>
                                    <span style={{fontFamily:'monospace',color:'var(--berry)'}}>{r.article_id}</span>
                                    <span style={{margin:'0 8px'}}>—</span>
                                    Demandé par <strong>{r.requested_by?.name||'?'}</strong> le {new Date(r.requested_at).toLocaleDateString('fr-FR')}
                                </div>
                            </div>
                            <div style={{display:'flex',gap:8}}>
                                <button onClick={()=>handleValidate(r,false)} disabled={processing===r.id} style={{padding:'8px 14px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:12,color:'#666'}}>
                                    <i className="fa-solid fa-xmark" style={{marginRight:4}}></i>Rejeter
                                </button>
                                <button onClick={()=>handleValidate(r,true)} disabled={processing===r.id} style={{padding:'8px 14px',borderRadius:8,border:'none',background:'#e74c3c',color:'#fff',cursor:'pointer',fontSize:12,fontWeight:600}}>
                                    <i className="fa-solid fa-trash" style={{marginRight:4}}></i>Approuver suppression
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

export { FinDeleteArticlesTab };
