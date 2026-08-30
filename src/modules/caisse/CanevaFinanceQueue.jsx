/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CanevaFinanceQueue */
import { callCanevaStock } from '../shared/callCanevaStock.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { CanevaSummaryView } from './CanevaSummaryView.jsx';
import { canevaActor } from './canevaActor.jsx';

// File d'attente Finance/DG : demandes à valider + archive (restauration).
        function CanevaFinanceQueue({ currentProfile, profileData, onDone }) {
            const [requests, setRequests] = useState([]);
            const [loading, setLoading] = useState(true);
            const [busyId, setBusyId] = useState('');
            const [openId, setOpenId] = useState('');

            const load = () => {
                setLoading(true);
                callCanevaStock({ mode: 'list' }).then(j => { if (j.success) setRequests(j.requests || []); }).catch(() => {}).finally(() => setLoading(false));
            };
            useEffect(() => { load(); }, []);

            const act = async (mode, reqId, motif) => {
                setBusyId(reqId);
                try {
                    const j = await callCanevaStock({ mode, request_id: reqId, motif, reviewed_by: canevaActor(currentProfile, profileData) });
                    if (!j.success) { alert('Erreur : ' + (j.error || 'échec')); }
                    else { load(); if (typeof onDone === 'function') onDone(); }
                } catch (e) { alert(e.message); } finally { setBusyId(''); }
            };

            if (loading) return <div style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:24,color:'var(--berry)'}}></i></div>;

            const pending = requests.filter(r => r.status === 'en_attente_finance');
            const archive = requests.filter(r => !r.file_pruned);
            const STATUS = { en_attente_finance: { label: 'En attente', color: 'var(--gold)' }, importe: { label: 'Importé', color: 'var(--green)' }, rejete: { label: 'Rejeté', color: 'var(--red)' } };

            return (
                <div style={{maxWidth:720}}>
                    <h4 style={{margin:'0 0 10px'}}><i className="fa-solid fa-list-check" style={{marginRight:8,color:'var(--berry)'}}></i>Demandes d'import à valider ({pending.length})</h4>
                    {pending.length === 0 && <div style={{padding:14,background:'var(--gray-100)',borderRadius:8,fontSize:12,color:'var(--gray-500)'}}>Aucune demande en attente.</div>}
                    {pending.map(r => (
                        <div key={r.id} style={{background:'white',border:'1px solid var(--gray-200)',borderRadius:10,padding:14,marginBottom:10}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                                <div>
                                    <div style={{fontWeight:600,fontSize:12.5}}><i className="fa-solid fa-file-excel" style={{marginRight:6,color:'var(--green)'}}></i>{r.filename}</div>
                                    <div style={{fontSize:11,color:'var(--gray-500)',marginTop:2}}>Par {(r.requested_by||{}).name || '—'} · {(r.jours_modifies||[]).length} jour(s) à remplacer · {(r.jours_nouveaux||[]).length} nouveau(x)</div>
                                </div>
                                <button onClick={() => setOpenId(openId === r.id ? '' : r.id)} style={{padding:'6px 10px',borderRadius:6,border:'1px solid var(--gray-200)',background:'white',fontSize:11,cursor:'pointer'}}>{openId === r.id ? 'Masquer' : 'Détails'}</button>
                            </div>
                            {openId === r.id && <CanevaSummaryView s={r.summary} />}
                            <div style={{display:'flex',gap:8,marginTop:10}}>
                                <button disabled={busyId === r.id} onClick={() => { const m = prompt('Motif du rejet :'); if (m !== null) act('reject', r.id, m); }} style={{padding:'8px 14px',borderRadius:8,border:'1px solid var(--red)',background:'white',color:'var(--red)',fontSize:12,cursor:'pointer'}}>Rejeter</button>
                                <button disabled={busyId === r.id} onClick={() => { if (confirm('Approuver et appliquer l\'import ? Les jours concernés seront remplacés.')) act('approve', r.id); }} style={{flex:1,padding:'8px',borderRadius:8,border:'none',background:'var(--green)',color:'white',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                    {busyId === r.id ? <i className="fa-solid fa-spinner fa-spin"></i> : <span><i className="fa-solid fa-check" style={{marginRight:6}}></i>Approuver & importer</span>}
                                </button>
                            </div>
                        </div>
                    ))}

                    <h4 style={{margin:'18px 0 10px'}}><i className="fa-solid fa-box-archive" style={{marginRight:8,color:'var(--berry)'}}></i>Archive (7 derniers fichiers)</h4>
                    <div style={{border:'1px solid var(--gray-200)',borderRadius:10,overflow:'hidden'}}>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:11.5}}>
                            <thead><tr style={{background:'var(--gray-100)'}}>
                                <th style={{textAlign:'left',padding:'7px 10px'}}>Fichier</th><th style={{textAlign:'left',padding:'7px 10px'}}>Statut</th>
                                <th style={{textAlign:'left',padding:'7px 10px'}}>Par</th><th style={{padding:'7px 10px'}}></th>
                            </tr></thead>
                            <tbody>
                                {archive.length === 0 && <tr><td colSpan={4} style={{padding:12,color:'var(--gray-400)',textAlign:'center'}}>Aucun fichier archivé.</td></tr>}
                                {archive.map(r => {
                                    const st = STATUS[r.status] || { label: r.status, color: 'var(--gray-500)' };
                                    return (
                                        <tr key={r.id} style={{borderTop:'1px solid var(--gray-100)'}}>
                                            <td style={{padding:'7px 10px'}}><i className="fa-solid fa-file-excel" style={{marginRight:5,color:'var(--green)'}}></i>{r.filename}</td>
                                            <td style={{padding:'7px 10px'}}><span style={{color:st.color,fontWeight:600}}>{st.label}</span></td>
                                            <td style={{padding:'7px 10px',color:'var(--gray-600)'}}>{(r.requested_by||{}).name || '—'}</td>
                                            <td style={{padding:'7px 10px',textAlign:'right'}}>
                                                <button disabled={busyId === r.id} onClick={() => { if (confirm('Restaurer cet import ? Les jours du fichier seront ré-appliqués.')) act('restore', r.id); }} style={{padding:'5px 10px',borderRadius:6,border:'1px solid var(--berry)',background:'white',color:'var(--berry)',fontSize:11,cursor:'pointer'}}>
                                                    {busyId === r.id ? <i className="fa-solid fa-spinner fa-spin"></i> : <span><i className="fa-solid fa-rotate-left" style={{marginRight:4}}></i>Restaurer</span>}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
        }

export { CanevaFinanceQueue };
