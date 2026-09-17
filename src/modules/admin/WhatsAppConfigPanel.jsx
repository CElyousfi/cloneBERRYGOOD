/* Module: admin | Déclaration(s): WhatsAppConfigPanel */
import { Panel } from '../shared/Panel.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { TemplateSimulator } from './TemplateSimulator.jsx';

function WhatsAppConfigPanel({ authFetch }) {
            const [waConfig, setWaConfig] = useState(null);
            const [waLogs, setWaLogs] = useState([]);
            const [waLoading, setWaLoading] = useState(true);
            const [waEditing, setWaEditing] = useState(false);
            const [waForm, setWaForm] = useState({ phone_number_id: '', waba_id: '', access_token: '', enabled: false });
            const [waSaving, setWaSaving] = useState(false);
            const [waMsg, setWaMsg] = useState('');
            const [waTestPhone, setWaTestPhone] = useState('');
            const [waTesting, setWaTesting] = useState(false);
            const [waShowLogs, setWaShowLogs] = useState(false);
            const [waShowMessages, setWaShowMessages] = useState(false);
            const [waMessagesList, setWaMessagesList] = useState([]);
            const [waShowWebhook, setWaShowWebhook] = useState(false);
            const [waVerifyToken, setWaVerifyToken] = useState('');

            const loadConfig = async () => {
                setWaLoading(true);
                try {
                    const r = await authFetch('/api/whatsapp-admin?action=get-config');
                    const json = await r.json();
                    if (json.success) setWaConfig(json.config);
                } catch (e) { console.warn(e); }
                setWaLoading(false);
            };

            const loadLogs = async () => {
                try {
                    const r = await authFetch('/api/whatsapp-admin?action=get-logs&limit=30');
                    const json = await r.json();
                    if (json.success) setWaLogs(json.logs || []);
                } catch (e) { console.warn(e); }
            };

            const loadMessages = async () => {
                try {
                    const r = await authFetch('/api/whatsapp-admin?action=get-messages&limit=50');
                    const json = await r.json();
                    if (json.success) setWaMessagesList(json.messages || []);
                } catch (e) { console.warn(e); }
            };

            const loadVerifyToken = async () => {
                try {
                    const r = await authFetch('/api/whatsapp-admin?action=get-verify-token');
                    const json = await r.json();
                    if (json.success) setWaVerifyToken(json.verify_token || '');
                } catch (e) { console.warn(e); }
            };

            const generateVerifyToken = async () => {
                if (!confirm('Générer un nouveau verify token ? L\'ancien sera invalidé et il faudra reconfigurer le webhook dans Meta.')) return;
                try {
                    const r = await authFetch('/api/whatsapp-admin?action=generate-verify-token', { method: 'POST', body: JSON.stringify({}) });
                    const json = await r.json();
                    if (json.success) { setWaVerifyToken(json.verify_token); setWaMsg('Verify token généré. Configurez-le dans Meta.'); }
                    else setWaMsg(json.error || 'Erreur');
                } catch (e) { setWaMsg(e.message); }
            };

            useEffect(() => { loadConfig(); }, []);

            const handleSaveConfig = async () => {
                setWaSaving(true); setWaMsg('');
                try {
                    const r = await authFetch('/api/whatsapp-admin?action=update-config', { method: 'POST', body: JSON.stringify(waForm) });
                    const json = await r.json();
                    if (json.success) { setWaMsg('Configuration sauvegardée'); setWaEditing(false); loadConfig(); }
                    else setWaMsg(json.error || 'Erreur');
                } catch (e) { setWaMsg(e.message); }
                setWaSaving(false);
            };

            const handleTestMessage = async () => {
                if (!waTestPhone) return;
                setWaTesting(true); setWaMsg('');
                try {
                    const r = await authFetch('/api/whatsapp-admin?action=test-message', { method: 'POST', body: JSON.stringify({ phone: waTestPhone }) });
                    const json = await r.json();
                    setWaMsg(json.success ? 'Message de test envoyé !' : ('Erreur: ' + (json.error || 'Inconnue')));
                } catch (e) { setWaMsg(e.message); }
                setWaTesting(false);
            };

            if (waLoading) return <Panel title="WhatsApp Business" icon="fa-brands fa-whatsapp"><div style={{textAlign:'center',padding:20,color:'var(--gray-400)',fontSize:12}}><i className="fa-solid fa-spinner fa-spin"></i> Chargement...</div></Panel>;

            return (
                <Panel title="WhatsApp Business" icon="fa-brands fa-whatsapp">
                    {waMsg && <div style={{background:'rgba(37,211,102,0.1)',color:'#25D366',padding:'8px 14px',borderRadius:8,fontSize:12,marginBottom:12,fontWeight:500}}><i className="fa-solid fa-circle-info" style={{marginRight:6}}></i>{waMsg}</div>}

                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                            <span style={{fontSize:13,fontWeight:600}}>Statut:</span>
                            {waConfig?.enabled
                                ? <span className="status-badge" style={{background:'rgba(37,211,102,0.1)',color:'#25D366',fontSize:11}}>Actif</span>
                                : <span className="status-badge" style={{background:'rgba(220,53,69,0.1)',color:'#dc3545',fontSize:11}}>Inactif</span>}
                            {waConfig?.phone_number_id && <span style={{fontSize:11,color:'var(--gray-400)'}}>Phone ID: {waConfig.phone_number_id}</span>}
                        </div>
                        <div style={{display:'flex',gap:8}}>
                            <button onClick={() => { setWaEditing(!waEditing); setWaForm({ phone_number_id: waConfig?.phone_number_id || '', waba_id: waConfig?.waba_id || '', access_token: '', enabled: waConfig?.enabled || false }); }}
                                style={{padding:'6px 14px',background:'var(--gray-100)',border:'1px solid var(--gray-200)',borderRadius:8,fontSize:11,cursor:'pointer',fontWeight:600}}>
                                <i className="fa-solid fa-gear" style={{marginRight:4}}></i>Configurer
                            </button>
                            <button onClick={() => { setWaShowLogs(!waShowLogs); if (!waShowLogs) loadLogs(); }}
                                style={{padding:'6px 14px',background:'var(--gray-100)',border:'1px solid var(--gray-200)',borderRadius:8,fontSize:11,cursor:'pointer',fontWeight:600}}>
                                <i className="fa-solid fa-list" style={{marginRight:4}}></i>Logs envoyés
                            </button>
                            <button onClick={() => { setWaShowMessages(!waShowMessages); if (!waShowMessages) loadMessages(); }}
                                style={{padding:'6px 14px',background:'var(--gray-100)',border:'1px solid var(--gray-200)',borderRadius:8,fontSize:11,cursor:'pointer',fontWeight:600}}>
                                <i className="fa-solid fa-inbox" style={{marginRight:4}}></i>Réponses reçues
                            </button>
                            <button onClick={() => { setWaShowWebhook(!waShowWebhook); if (!waShowWebhook) loadVerifyToken(); }}
                                style={{padding:'6px 14px',background:'var(--gray-100)',border:'1px solid var(--gray-200)',borderRadius:8,fontSize:11,cursor:'pointer',fontWeight:600}}>
                                <i className="fa-solid fa-link" style={{marginRight:4}}></i>Webhook
                            </button>
                        </div>
                    </div>

                    {waEditing && (
                        <div style={{background:'var(--gray-50)',borderRadius:10,padding:16,marginBottom:16}}>
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Phone Number ID (Meta)</label>
                                    <input value={waForm.phone_number_id} onChange={e => setWaForm({...waForm, phone_number_id: e.target.value})} placeholder="Ex: 1040240149168335"
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                </div>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>WABA ID (compte WhatsApp Business)</label>
                                    <input value={waForm.waba_id} onChange={e => setWaForm({...waForm, waba_id: e.target.value})} placeholder="Ex: 1435674314903560"
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                </div>
                                <div style={{gridColumn:'1 / -1'}}>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Access Token</label>
                                    <input type="password" value={waForm.access_token} onChange={e => setWaForm({...waForm, access_token: e.target.value})} placeholder="Laisser vide pour ne pas changer"
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                </div>
                            </div>
                            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
                                <label style={{fontSize:11,fontWeight:600}}>Activer les notifications WhatsApp:</label>
                                <input type="checkbox" checked={waForm.enabled} onChange={e => setWaForm({...waForm, enabled: e.target.checked})} />
                            </div>
                            <div style={{display:'flex',gap:8}}>
                                <button onClick={handleSaveConfig} disabled={waSaving} style={{padding:'6px 16px',background: waSaving ? 'var(--gray-300)' : '#25D366',color:'#fff',border:'none',borderRadius:8,fontSize:12,fontWeight:600,cursor: waSaving ? 'wait' : 'pointer'}}>
                                    <i className={`fa-solid ${waSaving ? 'fa-spinner fa-spin' : 'fa-save'}`} style={{marginRight:4}}></i>Sauvegarder
                                </button>
                                <button onClick={() => setWaEditing(false)} style={{padding:'6px 16px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:8,fontSize:12,cursor:'pointer'}}>Annuler</button>
                            </div>
                        </div>
                    )}

                    {waConfig?.enabled && (
                        <div style={{background:'var(--gray-50)',borderRadius:10,padding:16,marginBottom:16}}>
                            <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>Envoyer un message de test</div>
                            <div style={{display:'flex',gap:8,marginBottom:12}}>
                                <input value={waTestPhone} onChange={e => setWaTestPhone(e.target.value)} placeholder="+212 6XX XXX XXX"
                                    style={{flex:1,padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12}} />
                                <button onClick={handleTestMessage} disabled={waTesting} style={{padding:'6px 16px',background: waTesting ? 'var(--gray-300)' : '#25D366',color:'#fff',border:'none',borderRadius:8,fontSize:12,fontWeight:600,cursor: waTesting ? 'wait' : 'pointer',whiteSpace:'nowrap'}}>
                                    <i className={`fa-solid ${waTesting ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`} style={{marginRight:4}}></i>Tester
                                </button>
                            </div>
                            <div style={{borderTop:'1px solid var(--gray-200)',paddingTop:12}}>
                                <TemplateSimulator authFetch={authFetch} testPhone={waTestPhone} setMsg={setWaMsg} />
                            </div>
                        </div>
                    )}

                    {waShowLogs && (
                        <div style={{maxHeight:300,overflowY:'auto'}}>
                            <table className="data-table" style={{fontSize:11}}>
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Destinataire</th>
                                        <th>Template</th>
                                        <th>Contenu</th>
                                        <th>Statut</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {waLogs.map(log => (
                                        <tr key={log.id}>
                                            <td style={{whiteSpace:'nowrap'}}>{new Date(log.sentAt).toLocaleString('fr-FR')}</td>
                                            <td>
                                                {log.toName && <div style={{fontWeight:600,fontSize:11}}>{log.toName}</div>}
                                                <div style={{fontFamily:'monospace',fontSize:10,color:'var(--gray-500)'}}>{log.to}</div>
                                            </td>
                                            <td>{log.templateName}</td>
                                            <td style={{maxWidth:300,fontSize:11,color:'var(--gray-600)'}}>
                                                {log.params && log.params.length > 0 ? log.params.join(' | ') : <span style={{color:'var(--gray-400)'}}>—</span>}
                                            </td>
                                            <td>
                                                {log.status === 'read' ? <span style={{color:'#25D366',fontWeight:600}} title="Lu">✓✓ Lu</span>
                                                    : log.status === 'delivered' ? <span style={{color:'#25D366',fontWeight:600}} title="Livré">✓✓ Livré</span>
                                                    : log.status === 'sent' ? <span style={{color:'var(--gray-500)',fontWeight:600}}>✓ Envoyé</span>
                                                    : log.status === 'failed' ? (
                                                        <div>
                                                            <div style={{color:'#dc3545',fontWeight:600,display:'flex',alignItems:'center',gap:6}}>
                                                                <span>✗ Échec</span>
                                                                {log.retried_at ? (
                                                                    <span style={{fontSize:9,color:'#28a745',fontWeight:500}}>✓ Renvoyé</span>
                                                                ) : (
                                                                    <button type="button" onClick={async (e) => {
                                                                        console.log('[Retry] Click sur log', log.id);
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        setWaMsg('⏳ Envoi en cours...');
                                                                        try {
                                                                            const r = await authFetch('/api/whatsapp-admin?action=retry-log', { method: 'POST', body: JSON.stringify({ log_id: log.id }) });
                                                                            console.log('[Retry] HTTP status:', r.status);
                                                                            const json = await r.json();
                                                                            console.log('[Retry] Réponse:', json);
                                                                            if (json.success) {
                                                                                setWaMsg(`✓ Message renvoyé à ${log.to}`);
                                                                                setWaLogs(prev => prev.map(l => l.id === log.id ? { ...l, retried_at: Date.now() } : l));
                                                                                setTimeout(() => loadLogs(), 1500);
                                                                            } else {
                                                                                setWaMsg(`✗ Erreur: ${json.error || 'Inconnue'}`);
                                                                            }
                                                                        } catch (err) {
                                                                            console.error('[Retry] Erreur:', err);
                                                                            setWaMsg('Erreur réseau: ' + err.message);
                                                                        }
                                                                    }} style={{background:'#dc3545',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11,color:'#fff',fontWeight:600}} title="Réessayer cet envoi">
                                                                        <i className="fa-solid fa-rotate-right" style={{marginRight:4}}></i>Retenter
                                                                    </button>
                                                                )}
                                                            </div>
                                                            {log.error && <div style={{fontSize:9,color:'#dc3545',maxWidth:240,wordBreak:'break-word',marginTop:2,opacity:0.8}}>{log.error}</div>}
                                                        </div>
                                                    )
                                                    : <span style={{color:'var(--gray-400)',fontWeight:600}}>{log.status}</span>}
                                            </td>
                                        </tr>
                                    ))}
                                    {waLogs.length === 0 && <tr><td colSpan={5} style={{textAlign:'center',color:'var(--gray-400)'}}>Aucun log</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {waShowMessages && (
                        <div style={{maxHeight:400,overflowY:'auto',marginTop:12}}>
                            <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>Messages reçus des utilisateurs</div>
                            {waMessagesList.length === 0 && <div style={{textAlign:'center',color:'var(--gray-400)',fontSize:12,padding:20}}>Aucun message reçu</div>}
                            {waMessagesList.map(m => (
                                <div key={m.id} style={{background:'var(--gray-50)',borderRadius:8,padding:10,marginBottom:8,borderLeft:'3px solid #25D366'}}>
                                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                                        <span style={{fontSize:11,fontWeight:600}}>
                                            <i className="fa-brands fa-whatsapp" style={{color:'#25D366',marginRight:4}}></i>
                                            {m.userName || m.contactName || m.from}
                                            {m.userName && <span style={{color:'var(--gray-400)',fontWeight:400,marginLeft:4}}>({m.from})</span>}
                                        </span>
                                        <span style={{fontSize:10,color:'var(--gray-400)'}}>{new Date(m.receivedAt).toLocaleString('fr-FR')}</span>
                                    </div>
                                    <div style={{fontSize:12,color:'var(--gray-700)'}}>
                                        {m.text || (m.type !== 'text' ? <em style={{color:'var(--gray-500)'}}>[{m.type}]</em> : '')}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {waShowWebhook && (
                        <div style={{background:'var(--gray-50)',borderRadius:10,padding:16,marginTop:12}}>
                            <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>Configuration du webhook Meta</div>
                            <div style={{fontSize:11,color:'var(--gray-600)',marginBottom:12,lineHeight:1.5}}>
                                Le webhook permet de recevoir les confirmations de livraison/lecture et les réponses des utilisateurs.
                                Configurez-le dans Meta App → WhatsApp → Configuration → Webhooks.
                            </div>
                            <div style={{marginBottom:10}}>
                                <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>URL du webhook (à coller dans Meta)</label>
                                <input readOnly value="https://europe-west1-berrygood-farms-dashboard.cloudfunctions.net/whatsappWebhook"
                                    onClick={e => e.target.select()}
                                    style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:11,boxSizing:'border-box',fontFamily:'monospace',background:'#fff'}} />
                            </div>
                            <div style={{marginBottom:10}}>
                                <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Verify Token</label>
                                <div style={{display:'flex',gap:8}}>
                                    <input readOnly value={waVerifyToken || '(non généré)'}
                                        onClick={e => e.target.select()}
                                        style={{flex:1,padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:11,boxSizing:'border-box',fontFamily:'monospace',background:'#fff'}} />
                                    <button onClick={generateVerifyToken} style={{padding:'6px 14px',background:'#25D366',color:'#fff',border:'none',borderRadius:8,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>
                                        {waVerifyToken ? 'Régénérer' : 'Générer'}
                                    </button>
                                </div>
                            </div>
                            <div style={{fontSize:11,color:'var(--gray-600)',marginTop:12,lineHeight:1.5}}>
                                <strong>Champs à activer dans Meta:</strong> <code>messages</code>, <code>message_status</code>
                            </div>
                        </div>
                    )}
                </Panel>
            );
        }

export { WhatsAppConfigPanel };
