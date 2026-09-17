/* Module: admin | Déclaration(s): AdminConsoleTab */
import { PROFILES } from '../shared/PROFILES.jsx';
import { Panel } from '../shared/Panel.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { BackupManagementPanel } from './BackupManagementPanel.jsx';
import { WhatsAppConfigPanel } from './WhatsAppConfigPanel.jsx';

function AdminConsoleTab({ authUser, userProfile }) {
            const [users, setUsers] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showCreate, setShowCreate] = useState(false);
            const [editUser, setEditUser] = useState(null);
            const [form, setForm] = useState({ email: '', password: '', displayName: '', profileId: 'rh', role: 'user', whatsappPhone: '', ferme: '' });
            const [saving, setSaving] = useState(false);
            const [msg, setMsg] = useState('');
            const [showPasswordCreate, setShowPasswordCreate] = useState(false);
            const [showPasswordEdit, setShowPasswordEdit] = useState(false);
            const [updateConfirm, setUpdateConfirm] = useState(null); // {displayName, changes[]}

            const authFetch = async (url, opts = {}) => {
                const token = await firebaseAuth.currentUser.getIdToken();
                const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) };
                return fetch(url, { ...opts, headers });
            };

            const loadUsers = async () => {
                setLoading(true);
                try {
                    const r = await authFetch('/api/auth?action=list');
                    const json = await r.json();
                    if (json.success) setUsers(json.users || []);
                } catch (e) { console.warn(e); }
                setLoading(false);
            };

            useEffect(() => { loadUsers(); }, []);

            const handleCreate = async () => {
                if (!form.email || !form.password) { setMsg('Email et mot de passe requis'); return; }
                setSaving(true); setMsg('');
                try {
                    const r = await authFetch('/api/auth?action=create', { method: 'POST', body: JSON.stringify(form) });
                    const json = await r.json();
                    if (json.success) { setShowCreate(false); setForm({ email: '', password: '', displayName: '', profileId: 'rh', role: 'user', whatsappPhone: '', ferme: '' }); loadUsers(); setMsg('Utilisateur créé'); }
                    else setMsg(json.error || 'Erreur');
                } catch (e) { setMsg(e.message); }
                setSaving(false);
            };

            const handleUpdate = async () => {
                if (!editUser) return;
                setSaving(true); setMsg('');
                try {
                    const body = { uid: editUser.uid, displayName: editUser.displayName, profileId: editUser.profileId, role: editUser.role, disabled: editUser.disabled, whatsappPhone: editUser.whatsappPhone || '', whatsappEnabled: !!editUser.whatsappPhone, ferme: editUser.ferme || '' };
                    if (editUser.newPassword) body.password = editUser.newPassword;
                    const r = await authFetch('/api/auth?action=update', { method: 'POST', body: JSON.stringify(body) });
                    const json = await r.json();
                    if (json.success) {
                        const changes = [];
                        changes.push('Profil: ' + profileLabel(editUser.profileId));
                        changes.push('Rôle: ' + editUser.role);
                        if (editUser.newPassword) changes.push('Mot de passe modifié');
                        changes.push('Statut: ' + (editUser.disabled ? 'Désactivé' : 'Actif'));
                        setUpdateConfirm({ displayName: editUser.displayName || editUser.email, changes });
                        setEditUser(null); setShowPasswordEdit(false); loadUsers();
                    }
                    else setMsg(json.error || 'Erreur');
                } catch (e) { setMsg(e.message); }
                setSaving(false);
            };

            const handleDelete = async (uid, email) => {
                if (!confirm('Supprimer ' + email + ' ? Cette action est irréversible.')) return;
                try {
                    const r = await authFetch('/api/auth?action=delete', { method: 'POST', body: JSON.stringify({ uid }) });
                    const json = await r.json();
                    if (json.success) loadUsers();
                    else alert(json.error);
                } catch (e) { alert(e.message); }
            };

            const profileLabel = (pid) => { const p = PROFILES.find(x => x.id === pid); return p ? p.label : pid; };
            const roleColors = { admin: 'var(--berry)', finance: 'var(--blue)', user: 'var(--green)' };

            if (loading) return <div style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🫐</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement...</div></div>;

            return (
                <div className="fade-in">
                    {msg && <div style={{background:'rgba(40,167,69,0.1)',color:'#28a745',padding:'8px 14px',borderRadius:8,fontSize:12,marginBottom:16,fontWeight:500}}><i className="fa-solid fa-circle-check" style={{marginRight:6}}></i>{msg}</div>}

                    <Panel title="Gestion des Utilisateurs" icon="fa-users-gear">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                            <div style={{fontSize:12,color:'var(--gray-500)'}}>{users.length} utilisateur{users.length > 1 ? 's' : ''} enregistré{users.length > 1 ? 's' : ''}</div>
                            <div style={{display:'flex',gap:8}}>
                                <button onClick={async () => {
                                    const usersWithPhone = users.filter(u => u.whatsappPhone && !u.disabled);
                                    const notSent = usersWithPhone.filter(u => !u.welcome_sent_at).length;
                                    const msg = `Envoyer le message de bienvenue à ${notSent} utilisateur${notSent > 1 ? 's' : ''} qui ne l'ont pas encore reçu ?\n\n(${usersWithPhone.length} utilisateurs WhatsApp au total, ${usersWithPhone.length - notSent} déjà reçus seront skippés)`;
                                    if (!confirm(msg)) return;
                                    setMsg('Envoi en cours...');
                                    try {
                                        const r = await authFetch('/api/whatsapp-admin?action=send-welcome-all', { method: 'POST', body: JSON.stringify({}) });
                                        const json = await r.json();
                                        if (json.success) {
                                            setMsg(`✓ ${json.sent} envoyé${json.sent > 1 ? 's' : ''}, ${json.skipped} skippé${json.skipped > 1 ? 's' : ''}, ${json.failed} échec${json.failed > 1 ? 's' : ''}`);
                                            loadUsers();
                                        } else {
                                            setMsg('Erreur: ' + (json.error || 'Inconnue'));
                                        }
                                    } catch (e) { setMsg(e.message); }
                                }} style={{padding:'8px 16px',background:'#25D366',color:'#fff',border:'none',borderRadius:8,fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                    <i className="fa-brands fa-whatsapp" style={{marginRight:6}}></i>Envoyer bienvenue à tous
                                </button>
                                <button onClick={() => { setShowCreate(true); setEditUser(null); }} style={{padding:'8px 16px',background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                    <i className="fa-solid fa-user-plus" style={{marginRight:6}}></i>Nouvel utilisateur
                                </button>
                            </div>
                        </div>

                        <table className="data-table" style={{fontSize:12}}>
                            <thead>
                                <tr>
                                    <th>Utilisateur</th>
                                    <th>Email</th>
                                    <th>Profil</th>
                                    <th>Rôle</th>
                                    <th style={{textAlign:'center'}}>Google</th>
                                    <th style={{textAlign:'center'}}>WhatsApp</th>
                                    <th style={{textAlign:'center'}}>Statut</th>
                                    <th>Dernière connexion</th>
                                    <th style={{textAlign:'center'}}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(u => (
                                    <tr key={u.uid} style={{opacity: u.disabled ? 0.5 : 1}}>
                                        <td><strong>{u.displayName || '-'}</strong></td>
                                        <td style={{fontFamily:'monospace',fontSize:11}}>{u.email}</td>
                                        <td><span style={{background:'var(--gray-100)',padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:600}}>{profileLabel(u.profileId)}</span></td>
                                        <td><span style={{color: roleColors[u.role] || 'var(--gray-500)',fontWeight:700,fontSize:11,textTransform:'uppercase'}}>{u.role}</span></td>
                                        <td style={{textAlign:'center'}}>{u.googleLinked ? <i className="fa-brands fa-google" style={{color:'#4285F4'}}></i> : <span style={{color:'var(--gray-300)'}}>-</span>}</td>
                                        <td style={{textAlign:'center'}}>
                                            {u.whatsappPhone ? (
                                                <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
                                                    <i className="fa-brands fa-whatsapp" style={{color:'#25D366'}} title={u.whatsappPhone}></i>
                                                    <button onClick={async () => {
                                                        if (!confirm('Envoyer le message de bienvenue à ' + (u.displayName || u.email) + ' ?')) return;
                                                        try {
                                                            const r = await authFetch('/api/whatsapp-admin?action=send-welcome', { method: 'POST', body: JSON.stringify({ uid: u.uid }) });
                                                            const json = await r.json();
                                                            if (json.success) setMsg('Message de bienvenue envoyé à ' + (u.displayName || u.email));
                                                            else setMsg('Erreur: ' + (json.error || 'Inconnue'));
                                                        } catch (e) { setMsg(e.message); }
                                                    }} style={{background:'none',border:'none',color:'#25D366',cursor:'pointer',fontSize:11,padding:0}} title="Envoyer message de bienvenue">
                                                        <i className="fa-solid fa-paper-plane"></i>
                                                    </button>
                                                </span>
                                            ) : <span style={{color:'var(--gray-300)'}}>-</span>}
                                        </td>
                                        <td style={{textAlign:'center'}}>
                                            {u.disabled ? <span className="status-badge" style={{background:'rgba(220,53,69,0.1)',color:'#dc3545',fontSize:10}}>Désactivé</span>
                                                : <span className="status-badge" style={{background:'rgba(40,167,69,0.1)',color:'#28a745',fontSize:10}}>Actif</span>}
                                        </td>
                                        <td style={{fontSize:10,color:'var(--gray-400)'}}>{u.lastSignIn ? new Date(u.lastSignIn).toLocaleString('fr-FR') : '-'}</td>
                                        <td style={{textAlign:'center'}}>
                                            <button onClick={() => { setEditUser({ ...u, newPassword: '' }); setShowCreate(false); }} style={{background:'none',border:'none',color:'var(--blue)',cursor:'pointer',fontSize:14,marginRight:8}} title="Modifier">
                                                <i className="fa-solid fa-pen"></i>
                                            </button>
                                            {u.uid !== authUser.uid && (
                                                <button onClick={() => handleDelete(u.uid, u.email)} style={{background:'none',border:'none',color:'#dc3545',cursor:'pointer',fontSize:14}} title="Supprimer">
                                                    <i className="fa-solid fa-trash"></i>
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Panel>

                    {/* Create user form */}
                    {showCreate && (
                        <Panel title="Créer un utilisateur" icon="fa-user-plus">
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Nom complet</label>
                                    <input value={form.displayName} onChange={e => setForm({...form, displayName: e.target.value})} placeholder="Nom Prénom"
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                </div>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Email *</label>
                                    <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="email@berrygood.ma" required
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                </div>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Mot de passe *</label>
                                    <div style={{position:'relative'}}>
                                        <input type={showPasswordCreate ? 'text' : 'password'} value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="Min. 6 caractères"
                                            style={{width:'100%',padding:'8px 12px',paddingRight:36,borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                        <button type="button" onClick={() => setShowPasswordCreate(!showPasswordCreate)} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',fontSize:13}}>
                                            <i className={`fa-solid ${showPasswordCreate ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Profil *</label>
                                    <select value={form.profileId} onChange={e => setForm({...form, profileId: e.target.value})}
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}}>
                                        {PROFILES.map(p => <option key={p.id} value={p.id}>{p.label} — {p.fullName}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Rôle d'accès</label>
                                    <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}}>
                                        <option value="admin">Admin (accès complet + gestion utilisateurs)</option>
                                        <option value="finance">Finance (accès complet)</option>
                                        <option value="user">Utilisateur (accès restreint au profil)</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}><i className="fa-brands fa-whatsapp" style={{color:'#25D366',marginRight:4}}></i>WhatsApp</label>
                                    <input value={form.whatsappPhone} onChange={e => setForm({...form, whatsappPhone: e.target.value})} placeholder="+212 6XX XXX XXX"
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                </div>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Ferme</label>
                                    <input value={form.ferme} onChange={e => setForm({...form, ferme: e.target.value})} placeholder="Ex: BGF, BSNL..."
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                </div>
                            </div>
                            <div style={{display:'flex',gap:8}}>
                                <button onClick={handleCreate} disabled={saving} style={{padding:'8px 20px',background: saving ? 'var(--gray-300)' : 'var(--green)',color:'#fff',border:'none',borderRadius:8,fontSize:12,fontWeight:600,cursor: saving ? 'wait' : 'pointer'}}>
                                    <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-check'}`} style={{marginRight:6}}></i>Créer
                                </button>
                                <button onClick={() => setShowCreate(false)} style={{padding:'8px 20px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:8,fontSize:12,cursor:'pointer'}}>Annuler</button>
                            </div>
                        </Panel>
                    )}

                    {/* Edit user form */}
                    {editUser && (
                        <Panel title={`Modifier: ${editUser.displayName || editUser.email}`} icon="fa-user-pen">
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Nom complet</label>
                                    <input value={editUser.displayName} onChange={e => setEditUser({...editUser, displayName: e.target.value})}
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                </div>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Nouveau mot de passe <span style={{color:'var(--gray-400)',fontWeight:400}}>(laisser vide pour ne pas changer)</span></label>
                                    <div style={{position:'relative'}}>
                                        <input type={showPasswordEdit ? 'text' : 'password'} value={editUser.newPassword || ''} onChange={e => setEditUser({...editUser, newPassword: e.target.value})} placeholder="Nouveau mot de passe"
                                            style={{width:'100%',padding:'8px 12px',paddingRight:36,borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                        <button type="button" onClick={() => setShowPasswordEdit(!showPasswordEdit)} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',fontSize:13}}>
                                            <i className={`fa-solid ${showPasswordEdit ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Profil</label>
                                    <select value={editUser.profileId} onChange={e => setEditUser({...editUser, profileId: e.target.value})}
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}}>
                                        {PROFILES.map(p => <option key={p.id} value={p.id}>{p.label} — {p.fullName}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Rôle d'accès</label>
                                    <select value={editUser.role} onChange={e => setEditUser({...editUser, role: e.target.value})}
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}}>
                                        <option value="admin">Admin</option>
                                        <option value="finance">Finance</option>
                                        <option value="user">Utilisateur</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Statut</label>
                                    <select value={editUser.disabled ? 'disabled' : 'active'} onChange={e => setEditUser({...editUser, disabled: e.target.value === 'disabled'})}
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}}>
                                        <option value="active">Actif</option>
                                        <option value="disabled">Désactivé</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}><i className="fa-brands fa-whatsapp" style={{color:'#25D366',marginRight:4}}></i>WhatsApp</label>
                                    <input value={editUser.whatsappPhone || ''} onChange={e => setEditUser({...editUser, whatsappPhone: e.target.value})} placeholder="+212 6XX XXX XXX"
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                </div>
                                <div>
                                    <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Ferme</label>
                                    <input value={editUser.ferme || ''} onChange={e => setEditUser({...editUser, ferme: e.target.value})} placeholder="Ex: BGF, BSNL..."
                                        style={{width:'100%',padding:'8px 12px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                </div>
                            </div>
                            <div style={{display:'flex',gap:8}}>
                                <button onClick={handleUpdate} disabled={saving} style={{padding:'8px 20px',background: saving ? 'var(--gray-300)' : 'var(--blue)',color:'#fff',border:'none',borderRadius:8,fontSize:12,fontWeight:600,cursor: saving ? 'wait' : 'pointer'}}>
                                    <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-save'}`} style={{marginRight:6}}></i>Enregistrer
                                </button>
                                <button onClick={() => setEditUser(null)} style={{padding:'8px 20px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:8,fontSize:12,cursor:'pointer'}}>Annuler</button>
                            </div>
                        </Panel>
                    )}

                    {/* ── Backup Management Panel ── */}
                    <BackupManagementPanel authFetch={authFetch} />

                    {/* ── WhatsApp Configuration Panel ── */}
                    <WhatsAppConfigPanel authFetch={authFetch} />

                    {updateConfirm && ReactDOM.createPortal(
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:99999}} onClick={() => setUpdateConfirm(null)}>
                            <div style={{background:'#fff',borderRadius:16,padding:32,maxWidth:400,width:'90%',textAlign:'center',boxShadow:'0 20px 60px rgba(0,0,0,0.2)'}} onClick={e => e.stopPropagation()}>
                                <div style={{width:56,height:56,borderRadius:'50%',background:'rgba(40,167,69,0.1)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px'}}>
                                    <i className="fa-solid fa-circle-check" style={{fontSize:28,color:'#28a745'}}></i>
                                </div>
                                <h3 style={{margin:'0 0 8px',fontSize:18,fontWeight:700}}>Utilisateur mis à jour</h3>
                                <p style={{margin:'0 0 16px',fontSize:13,color:'var(--gray-500)'}}>{updateConfirm.displayName}</p>
                                <div style={{textAlign:'left',background:'var(--gray-50)',borderRadius:10,padding:'12px 16px',marginBottom:20}}>
                                    {updateConfirm.changes.map((c, i) => (
                                        <div key={i} style={{fontSize:12,color:'var(--gray-600)',padding:'3px 0',display:'flex',alignItems:'center',gap:8}}>
                                            <i className="fa-solid fa-check" style={{color:'#28a745',fontSize:10}}></i> {c}
                                        </div>
                                    ))}
                                </div>
                                <button onClick={() => setUpdateConfirm(null)} style={{padding:'10px 32px',background:'var(--berry)',color:'#fff',border:'none',borderRadius:10,fontSize:13,fontWeight:600,cursor:'pointer'}}>
                                    OK
                                </button>
                            </div>
                        </div>,
                        document.body
                    )}
                </div>
            );
        }

export { AdminConsoleTab };
