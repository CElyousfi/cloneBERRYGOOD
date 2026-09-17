/* Module: admin | Déclaration(s): DGParametresTab */
import { PROFILES } from '../shared/PROFILES.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ===================== DG PARAMETRES =====================
        function DGParametresTab({ currentProfile, profileData }) {
            const [settings, setSettings] = useState({ hideCycle1Profiles: [] });
            const [loading, setLoading] = useState(true);
            const [saving, setSaving] = useState(false);

            const targetProfiles = PROFILES.filter(p =>
                p.id.startsWith('chef_') || p.id === 'qualite' || p.id === 'dt'
            );

            React.useEffect(() => {
                const load = async () => {
                    try {
                        const db = firebase.firestore();
                        const doc = await db.collection('app_settings').doc('dg_parametres').get();
                        if (doc.exists) setSettings(doc.data());
                    } catch(e) { console.error('Erreur chargement paramètres:', e); }
                    setLoading(false);
                };
                load();
            }, []);

            const toggleProfile = async (profileId) => {
                setSaving(true);
                const current = settings.hideCycle1Profiles || [];
                const updated = current.includes(profileId)
                    ? current.filter(id => id !== profileId)
                    : [...current, profileId];
                const newSettings = { ...settings, hideCycle1Profiles: updated, updatedAt: new Date().toISOString(), updatedBy: 'DG' };
                try {
                    const db = firebase.firestore();
                    await db.collection('app_settings').doc('dg_parametres').set(newSettings);
                    setSettings(newSettings);
                } catch(e) { console.error('Erreur sauvegarde:', e); }
                setSaving(false);
            };

            if (loading) return <div style={{padding:40, textAlign:'center'}}><i className="fa-solid fa-spinner fa-spin"></i> Chargement...</div>;

            return (
                <div className="fade-in">
                    <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:24}}>
                        <div style={{width:44, height:44, borderRadius:12, background:'linear-gradient(135deg,#6c5ce7,#a29bfe)', display:'flex', alignItems:'center', justifyContent:'center'}}>
                            <i className="fa-solid fa-gear" style={{color:'#fff', fontSize:20}}></i>
                        </div>
                        <div>
                            <h2 style={{margin:0, fontSize:20, fontWeight:700}}>Paramètres DG</h2>
                            <p style={{margin:0, fontSize:13, color:'var(--gray-500)'}}>Configuration globale du dashboard</p>
                        </div>
                    </div>

                    <div className="card" style={{marginBottom:24}}>
                        <div style={{padding:20}}>
                            <h3 style={{margin:'0 0 8px', fontSize:16, fontWeight:700, display:'flex', alignItems:'center', gap:8}}>
                                <i className="fa-solid fa-eye-slash" style={{color:'#e17055'}}></i>
                                Masquer les données du 1er Cycle
                            </h3>
                            <p style={{margin:'0 0 16px', fontSize:13, color:'var(--gray-500)'}}>
                                Lorsqu'activé, le profil ne verra que les données du 2ème cycle (Janvier–Juin) dans l'onglet Production. Le filtre "Tous" et "Cycle 1" seront masqués.
                            </p>

                            <div style={{display:'flex', flexDirection:'column', gap:8}}>
                                {targetProfiles.map(p => {
                                    const isActive = (settings.hideCycle1Profiles || []).includes(p.id);
                                    return (
                                        <div key={p.id} style={{
                                            display:'flex', alignItems:'center', justifyContent:'space-between',
                                            padding:'12px 16px', borderRadius:10,
                                            background: isActive ? 'rgba(108,92,231,0.06)' : 'var(--gray-50)',
                                            border: isActive ? '1.5px solid #6c5ce7' : '1.5px solid var(--gray-200)',
                                            transition:'all 0.2s'
                                        }}>
                                            <div style={{display:'flex', alignItems:'center', gap:10}}>
                                                <i className={`fa-solid ${p.icon}`} style={{color: isActive ? '#6c5ce7' : 'var(--gray-400)', fontSize:16}}></i>
                                                <div>
                                                    <div style={{fontWeight:600, fontSize:14}}>{p.label}</div>
                                                    <div style={{fontSize:12, color:'var(--gray-500)'}}>{p.fullName || p.name}{p.farm ? ` — ${p.farm}` : ''}</div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => toggleProfile(p.id)}
                                                disabled={saving}
                                                style={{
                                                    width:48, height:26, borderRadius:13, border:'none', cursor:'pointer',
                                                    background: isActive ? '#6c5ce7' : 'var(--gray-300)',
                                                    position:'relative', transition:'background 0.2s'
                                                }}>
                                                <div style={{
                                                    width:20, height:20, borderRadius:'50%', background:'#fff',
                                                    position:'absolute', top:3,
                                                    left: isActive ? 25 : 3,
                                                    transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)'
                                                }}></div>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>

                            {settings.updatedAt && (
                                <p style={{margin:'16px 0 0', fontSize:11, color:'var(--gray-400)'}}>
                                    Dernière modification : {new Date(settings.updatedAt).toLocaleString('fr-FR')}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

export { DGParametresTab };
