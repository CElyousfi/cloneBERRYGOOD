/* Module: admin | Déclaration(s): BackupManagementPanel */
import { Panel } from '../shared/Panel.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

function BackupManagementPanel({ authFetch }) {
            const [backups, setBackups] = useState([]);
            const [backupStatus, setBackupStatus] = useState(null);
            const [backupLoading, setBackupLoading] = useState(true);
            const [triggering, setTriggering] = useState(false);
            const [restoreModal, setRestoreModal] = useState(null);
            const [restoreCol, setRestoreCol] = useState('__all__');
            const [restoring, setRestoring] = useState(false);
            const [backupMsg, setBackupMsg] = useState('');

            const loadBackups = async () => {
                setBackupLoading(true);
                try {
                    const [listRes, statusRes] = await Promise.all([
                        authFetch('/api/backup?action=list'),
                        authFetch('/api/backup?action=status')
                    ]);
                    const listJson = await listRes.json();
                    const statusJson = await statusRes.json();
                    if (listJson.success) setBackups(listJson.backups || []);
                    if (statusJson.success) setBackupStatus(statusJson.status);
                } catch (e) { console.warn('Backup load error:', e); }
                setBackupLoading(false);
            };

            useEffect(() => { loadBackups(); }, []);

            const handleTriggerBackup = async () => {
                if (!confirm('Lancer une sauvegarde maintenant ?')) return;
                setTriggering(true);
                setBackupMsg('');
                try {
                    const r = await authFetch('/api/backup?action=trigger', { method: 'POST' });
                    const json = await r.json();
                    if (json.success) {
                        setBackupMsg(`Sauvegarde terminée : ${json.result.totalCollections} collections, ${json.result.totalDocs} documents`);
                        loadBackups();
                    } else {
                        setBackupMsg('Erreur: ' + (json.error || 'Échec'));
                    }
                } catch (e) { setBackupMsg('Erreur: ' + e.message); }
                setTriggering(false);
            };

            const handleRestore = async () => {
                if (!restoreModal) return;
                const colParam = restoreCol === '__all__' ? '' : `&collection=${restoreCol}`;
                const label = restoreCol === '__all__' ? 'TOUTES les collections' : restoreCol;
                if (!confirm(`ATTENTION: Vous allez restaurer ${label} depuis la sauvegarde du ${restoreModal.date}.\n\nLes données actuelles seront écrasées. Continuer ?`)) return;
                setRestoring(true);
                setBackupMsg('');
                try {
                    const r = await authFetch(`/api/backup?action=restore&date=${restoreModal.date}${colParam}`, { method: 'POST' });
                    const json = await r.json();
                    if (json.success) {
                        const total = json.restored.reduce((s, r) => s + r.docs, 0);
                        setBackupMsg(`Restauration terminée : ${json.restored.length} collection(s), ${total} documents restaurés`);
                        setRestoreModal(null);
                    } else {
                        setBackupMsg('Erreur: ' + (json.error || 'Échec'));
                    }
                } catch (e) { setBackupMsg('Erreur: ' + e.message); }
                setRestoring(false);
            };

            const formatSize = (bytes) => {
                if (!bytes) return '0 B';
                if (bytes < 1024) return bytes + ' B';
                if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
                return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
            };

            const formatDate = (isoStr) => {
                if (!isoStr) return '—';
                try { return new Date(isoStr).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); } catch(e) { return isoStr; }
            };

            return (
                <Panel title="Sauvegardes Firestore" icon="fa-database">
                    {backupMsg && <div style={{background: backupMsg.startsWith('Erreur') ? 'rgba(220,53,69,0.1)' : 'rgba(40,167,69,0.1)', color: backupMsg.startsWith('Erreur') ? '#dc3545' : '#28a745', padding:'8px 14px',borderRadius:8,fontSize:12,marginBottom:16,fontWeight:500}}>
                        <i className={`fa-solid ${backupMsg.startsWith('Erreur') ? 'fa-circle-xmark' : 'fa-circle-check'}`} style={{marginRight:6}}></i>{backupMsg}
                    </div>}

                    {triggering && (
                        <div style={{background:'linear-gradient(135deg, rgba(139,34,82,0.07), rgba(139,34,82,0.03))',border:'1px solid rgba(139,34,82,0.15)',borderRadius:12,padding:'24px 20px',marginBottom:16,textAlign:'center'}}>
                            <i className="fa-solid fa-spinner fa-spin" style={{fontSize:28,color:'var(--berry)',marginBottom:10,display:'block'}}></i>
                            <div style={{fontSize:15,fontWeight:700,color:'var(--berry)',marginBottom:4}}>Sauvegarde en cours...</div>
                            <div style={{fontSize:12,color:'var(--gray-500)'}}>Lecture et sauvegarde de toutes les collections Firestore. Cela peut prendre quelques minutes.</div>
                        </div>
                    )}

                    {!triggering && (
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                            <div style={{fontSize:12,color:'var(--gray-500)'}}>
                                {backupStatus ? (
                                    <span>
                                        <i className="fa-solid fa-clock" style={{marginRight:4}}></i>
                                        Dernière sauvegarde : {formatDate(backupStatus.lastBackupAt?._seconds ? new Date(backupStatus.lastBackupAt._seconds * 1000).toISOString() : backupStatus.lastBackupAt)}
                                        {' — '}{backupStatus.totalCollections} collections, {formatSize(backupStatus.totalSizeBytes)}
                                        {backupStatus.status === 'success' && <span style={{color:'#28a745',marginLeft:8}}><i className="fa-solid fa-circle-check"></i></span>}
                                        {backupStatus.status === 'partial' && <span style={{color:'#f39c12',marginLeft:8}}><i className="fa-solid fa-triangle-exclamation"></i></span>}
                                    </span>
                                ) : 'Aucune sauvegarde effectuée'}
                            </div>
                            <button onClick={handleTriggerBackup} style={{padding:'8px 16px',background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                <i className="fa-solid fa-cloud-arrow-up" style={{marginRight:6}}></i>
                                Sauvegarder maintenant
                            </button>
                        </div>
                    )}

                    {backupLoading ? (
                        <div style={{textAlign:'center',padding:20,color:'var(--gray-400)'}}>
                            <i className="fa-solid fa-spinner fa-spin"></i> Chargement...
                        </div>
                    ) : triggering ? null : backups.length === 0 ? (
                        <div style={{textAlign:'center',padding:20,color:'var(--gray-400)',fontSize:13}}>
                            <i className="fa-solid fa-box-open" style={{fontSize:24,marginBottom:8,display:'block'}}></i>
                            Aucune sauvegarde disponible
                        </div>
                    ) : (
                        <table className="data-table" style={{fontSize:12}}>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Terminée à</th>
                                    <th style={{textAlign:'center'}}>Collections</th>
                                    <th style={{textAlign:'center'}}>Documents</th>
                                    <th style={{textAlign:'center'}}>Taille</th>
                                    <th style={{textAlign:'center'}}>Statut</th>
                                    <th style={{textAlign:'center'}}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {backups.map(b => (
                                    <tr key={b.date}>
                                        <td style={{fontWeight:600}}>{b.date}</td>
                                        <td>{formatDate(b.completedAt)}</td>
                                        <td style={{textAlign:'center'}}>{b.totalCollections}</td>
                                        <td style={{textAlign:'center'}}>{(b.totalDocs || 0).toLocaleString()}</td>
                                        <td style={{textAlign:'center'}}>{formatSize(b.totalSizeBytes)}</td>
                                        <td style={{textAlign:'center'}}>
                                            <span className="status-badge" style={{background: b.status === 'success' ? 'rgba(40,167,69,0.1)' : 'rgba(243,156,18,0.1)', color: b.status === 'success' ? '#28a745' : '#f39c12', padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600}}>
                                                {b.status === 'success' ? 'OK' : 'Partiel'}
                                            </span>
                                        </td>
                                        <td style={{textAlign:'center'}}>
                                            <button onClick={() => { setRestoreModal(b); setRestoreCol('__all__'); }} style={{padding:'4px 12px',background:'var(--blue)',color:'#fff',border:'none',borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                                <i className="fa-solid fa-clock-rotate-left" style={{marginRight:4}}></i>Restaurer
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    <div style={{marginTop:12,fontSize:11,color:'var(--gray-400)'}}>
                        <i className="fa-solid fa-info-circle" style={{marginRight:4}}></i>
                        Sauvegarde automatique chaque nuit à minuit. Rétention : 7 jours.
                    </div>

                    {restoreModal && ReactDOM.createPortal(
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:99999}} onClick={() => !restoring && setRestoreModal(null)}>
                            <div style={{background:'#fff',borderRadius:16,padding:32,maxWidth:460,width:'90%',boxShadow:'0 20px 60px rgba(0,0,0,0.2)'}} onClick={e => e.stopPropagation()}>
                                <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
                                    <div style={{width:48,height:48,borderRadius:'50%',background:'rgba(243,156,18,0.1)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                                        <i className="fa-solid fa-triangle-exclamation" style={{fontSize:22,color:'#f39c12'}}></i>
                                    </div>
                                    <div>
                                        <h3 style={{margin:0,fontSize:16,fontWeight:700}}>Restaurer la sauvegarde</h3>
                                        <p style={{margin:0,fontSize:12,color:'var(--gray-500)'}}>Date : {restoreModal.date}</p>
                                    </div>
                                </div>

                                <div style={{marginBottom:16}}>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:6}}>Collection à restaurer</label>
                                    <select value={restoreCol} onChange={e => setRestoreCol(e.target.value)} style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}}>
                                        <option value="__all__">Toutes les collections ({restoreModal.totalCollections})</option>
                                        {(restoreModal.collections || []).sort().map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>

                                <div style={{background:'rgba(220,53,69,0.06)',border:'1px solid rgba(220,53,69,0.15)',borderRadius:10,padding:'12px 16px',marginBottom:20,fontSize:12,color:'#dc3545'}}>
                                    <i className="fa-solid fa-exclamation-circle" style={{marginRight:6}}></i>
                                    <strong>Attention :</strong> Les données actuelles de {restoreCol === '__all__' ? 'toutes les collections' : `"${restoreCol}"`} seront écrasées par la sauvegarde du {restoreModal.date}.
                                </div>

                                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                    <button onClick={() => setRestoreModal(null)} disabled={restoring} style={{padding:'8px 20px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:8,fontSize:12,cursor:'pointer'}}>Annuler</button>
                                    <button onClick={handleRestore} disabled={restoring} style={{padding:'8px 20px',background: restoring ? 'var(--gray-300)' : '#dc3545',color:'#fff',border:'none',borderRadius:8,fontSize:12,fontWeight:600,cursor: restoring ? 'wait' : 'pointer'}}>
                                        <i className={`fa-solid ${restoring ? 'fa-spinner fa-spin' : 'fa-clock-rotate-left'}`} style={{marginRight:6}}></i>
                                        {restoring ? 'Restauration en cours...' : 'Restaurer'}
                                    </button>
                                </div>
                            </div>
                        </div>,
                        document.body
                    )}
                </Panel>
            );
        }

export { BackupManagementPanel };
