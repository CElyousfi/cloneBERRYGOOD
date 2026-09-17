/* Module: admin | Déclaration(s): DGAdoptionTab */
import { KPICard } from '../shared/KPICard.jsx';
import { PROFILES } from '../shared/PROFILES.jsx';
import { Panel } from '../shared/Panel.jsx';
import { SimpleBarChart } from '../shared/SimpleBarChart.jsx';
import { SimplePieChart } from '../shared/SimplePieChart.jsx';
import { useEffect, useMemo, useState } from '../shared/reactHooks.jsx';

// ===================== DG ADOPTION TRACKING =====================
        function DGAdoptionTab({ currentProfile, profileData }) {
            const [logs, setLogs] = useState([]);
            const [allUsers, setAllUsers] = useState([]);
            const [loading, setLoading] = useState(true);
            const [period, setPeriod] = useState('30');

            const authFetch = async (url, opts = {}) => {
                const token = await firebaseAuth.currentUser.getIdToken();
                const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) };
                return fetch(url, { ...opts, headers });
            };

            const HIDDEN_ADOPTION_NAMES = ['Tarik MAAOUNI'];
            const isHiddenUser = (u) => HIDDEN_ADOPTION_NAMES.some(n => (u.displayName || '').toLowerCase() === n.toLowerCase());

            useEffect(() => {
                authFetch('/api/auth?action=connection-stats&days=90')
                    .then(r => r.json())
                    .then(json => {
                        if (json.success) {
                            setLogs((json.logs || []).filter(l => !isHiddenUser(l)));
                            setAllUsers((json.allUsers || []).filter(u => !isHiddenUser(u)));
                        }
                    })
                    .catch(err => console.warn('Adoption stats error:', err))
                    .finally(() => setLoading(false));
            }, []);

            const now = Date.now();
            const periodMs = parseInt(period) * 24 * 60 * 60 * 1000;
            const filteredLogs = useMemo(() => logs.filter(l => l.timestampMs >= now - periodMs), [logs, period]);

            // Daily connection counts for bar chart
            const dailyData = useMemo(() => {
                const days = parseInt(period);
                const map = {};
                for (let i = days - 1; i >= 0; i--) {
                    const d = new Date(now - i * 86400000);
                    const key = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
                    map[key] = 0;
                }
                filteredLogs.forEach(l => {
                    const key = new Date(l.timestampMs).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
                    if (map[key] !== undefined) map[key]++;
                });
                return Object.entries(map).map(([day, connexions]) => ({ day, connexions }));
            }, [filteredLogs, period]);

            // Per-profile breakdown for pie chart
            const profileStats = useMemo(() => {
                const map = {};
                filteredLogs.forEach(l => {
                    const pid = l.profileId || 'inconnu';
                    map[pid] = (map[pid] || 0) + 1;
                });
                return Object.entries(map)
                    .map(([pid, count]) => {
                        const p = PROFILES.find(x => x.id === pid);
                        return { name: p ? p.label : pid, value: count };
                    })
                    .sort((a, b) => b.value - a.value);
            }, [filteredLogs]);

            const PROFILE_COLORS = ['#8B2252', '#2D8B4E', '#D4A847', '#3498db', '#e74c3c', '#9b59b6', '#1abc9c', '#f39c12', '#2c3e50', '#e67e22', '#16a085', '#c0392b', '#7f8c8d', '#27ae60'];

            // Active users (last 7 days)
            const activeUids7d = useMemo(() => {
                const since = now - 7 * 86400000;
                return new Set(logs.filter(l => l.timestampMs >= since).map(l => l.uid));
            }, [logs]);

            // Week connections (current week, Monday-based)
            const weekConnections = useMemo(() => {
                const today = new Date();
                const dayOfWeek = today.getDay() || 7;
                const monday = new Date(today);
                monday.setDate(today.getDate() - dayOfWeek + 1);
                monday.setHours(0, 0, 0, 0);
                return logs.filter(l => l.timestampMs >= monday.getTime()).length;
            }, [logs]);

            // Month connections
            const monthConnections = useMemo(() => {
                const start = new Date();
                start.setDate(1);
                start.setHours(0, 0, 0, 0);
                return logs.filter(l => l.timestampMs >= start.getTime()).length;
            }, [logs]);

            const adoptionRate = allUsers.length > 0 ? Math.round((activeUids7d.size / allUsers.length) * 100) : 0;

            // Per-user stats table
            const userStats = useMemo(() => {
                const map = {};
                logs.forEach(l => {
                    if (!map[l.uid]) map[l.uid] = { uid: l.uid, email: l.email, displayName: l.displayName, profileId: l.profileId, total: 0, lastTs: 0 };
                    map[l.uid].total++;
                    if (l.timestampMs > map[l.uid].lastTs) map[l.uid].lastTs = l.timestampMs;
                });
                // Include users with zero connections
                allUsers.forEach(u => {
                    if (!map[u.uid]) map[u.uid] = { uid: u.uid, email: u.email, displayName: u.displayName, profileId: u.profileId, total: 0, lastTs: 0 };
                });
                return Object.values(map).sort((a, b) => b.lastTs - a.lastTs);
            }, [logs, allUsers]);

            const profileLabel = (pid) => { const p = PROFILES.find(x => x.id === pid); return p ? p.label : pid || '—'; };

            const statusBadge = (lastTs) => {
                if (!lastTs) return { color: '#e74c3c', bg: 'rgba(231,76,60,0.1)', label: 'Jamais connecté' };
                const days = Math.floor((now - lastTs) / 86400000);
                if (days < 7) return { color: '#27ae60', bg: 'rgba(39,174,96,0.1)', label: 'Actif' };
                if (days < 30) return { color: '#f39c12', bg: 'rgba(243,156,18,0.1)', label: 'Inactif ' + days + 'j' };
                return { color: '#e74c3c', bg: 'rgba(231,76,60,0.1)', label: 'Inactif ' + days + 'j' };
            };

            if (loading) return (
                <div className="fade-in" style={{textAlign:'center',padding:60}}>
                    <i className="fa-solid fa-spinner fa-spin" style={{fontSize:32,color:'var(--berry)'}}></i>
                    <div style={{marginTop:12,color:'var(--berry)',fontWeight:500,fontSize:13}}>Chargement des données d'adoption...</div>
                </div>
            );

            return (
                <div className="fade-in">
                    {/* KPI Cards */}
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))',gap:16,marginBottom:24}}>
                        <KPICard icon="fa-users" iconClass="berry" value={activeUids7d.size} label="Utilisateurs actifs (7j)" />
                        <KPICard icon="fa-right-to-bracket" iconClass="green" value={weekConnections} label="Connexions cette semaine" />
                        <KPICard icon="fa-calendar-check" iconClass="blue" value={monthConnections} label="Connexions ce mois" />
                        <KPICard icon="fa-chart-line" iconClass="orange" value={adoptionRate + '%'} label="Taux d'adoption" />
                    </div>

                    {/* Daily connections chart */}
                    <Panel title="Connexions quotidiennes" icon="fa-chart-column" actions={
                        <div style={{display:'flex',gap:6}}>
                            {['7','30','90'].map(p => (
                                <button key={p} onClick={() => setPeriod(p)}
                                    style={{padding:'4px 12px',borderRadius:6,fontSize:11,fontWeight:600,border:'1px solid',cursor:'pointer',
                                        background: period === p ? 'var(--berry)' : 'transparent',
                                        color: period === p ? '#fff' : 'var(--gray-500)',
                                        borderColor: period === p ? 'var(--berry)' : 'var(--gray-200)'}}>
                                    {p}j
                                </button>
                            ))}
                        </div>
                    }>
                        {dailyData.length > 0 ? (
                            <SimpleBarChart data={dailyData} dataKeys={['connexions']} colors={['#8B2252']} xKey="day" height={280} />
                        ) : (
                            <div style={{textAlign:'center',padding:40,color:'var(--gray-400)',fontSize:13}}>Aucune donnée pour cette période</div>
                        )}
                    </Panel>

                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginTop:16}}>
                        {/* Pie chart - per profile */}
                        <Panel title="Répartition par profil" icon="fa-chart-pie">
                            {profileStats.length > 0 ? (
                                <div style={{display:'flex',alignItems:'center',gap:24,flexWrap:'wrap',justifyContent:'center'}}>
                                    <SimplePieChart data={profileStats} colors={PROFILE_COLORS} size={220} />
                                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                        {profileStats.map((p, i) => {
                                            const total = profileStats.reduce((s, x) => s + x.value, 0);
                                            return (
                                                <div key={i} style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}>
                                                    <div style={{width:10,height:10,borderRadius:3,background:PROFILE_COLORS[i % PROFILE_COLORS.length],flexShrink:0}}></div>
                                                    <span style={{fontWeight:600,color:'var(--dark)'}}>{p.name}</span>
                                                    <span style={{color:'var(--gray-400)'}}>{p.value} ({Math.round(p.value/total*100)}%)</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <div style={{textAlign:'center',padding:40,color:'var(--gray-400)',fontSize:13}}>Aucune donnée</div>
                            )}
                        </Panel>

                        {/* Summary stats */}
                        <Panel title="Résumé" icon="fa-square-poll-vertical">
                            <div style={{display:'flex',flexDirection:'column',gap:12,padding:'8px 0'}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 16px',borderRadius:10,background:'rgba(139,34,82,0.04)'}}>
                                    <span style={{fontSize:13,color:'var(--gray-600)'}}>Total utilisateurs suivis</span>
                                    <span style={{fontSize:18,fontWeight:800,color:'var(--berry)'}}>{allUsers.length}</span>
                                </div>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 16px',borderRadius:10,background:'rgba(39,174,96,0.04)'}}>
                                    <span style={{fontSize:13,color:'var(--gray-600)'}}>Actifs (7 derniers jours)</span>
                                    <span style={{fontSize:18,fontWeight:800,color:'var(--green)'}}>{activeUids7d.size}</span>
                                </div>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 16px',borderRadius:10,background:'rgba(231,76,60,0.04)'}}>
                                    <span style={{fontSize:13,color:'var(--gray-600)'}}>Jamais connectés</span>
                                    <span style={{fontSize:18,fontWeight:800,color:'var(--red)'}}>{userStats.filter(u => u.total === 0).length}</span>
                                </div>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 16px',borderRadius:10,background:'rgba(243,156,18,0.04)'}}>
                                    <span style={{fontSize:13,color:'var(--gray-600)'}}>Inactifs ({'>'} 30j)</span>
                                    <span style={{fontSize:18,fontWeight:800,color:'var(--orange)'}}>{userStats.filter(u => u.lastTs > 0 && (now - u.lastTs) > 30 * 86400000).length}</span>
                                </div>
                            </div>
                        </Panel>
                    </div>

                    {/* User activity table */}
                    <div style={{marginTop:16}}>
                        <Panel title="Activité par utilisateur" icon="fa-users">
                            <div style={{overflowX:'auto'}}>
                                <table className="data-table" style={{fontSize:12,width:'100%'}}>
                                    <thead>
                                        <tr>
                                            <th style={{textAlign:'left'}}>Utilisateur</th>
                                            <th style={{textAlign:'left'}}>Email</th>
                                            <th style={{textAlign:'center'}}>Profil</th>
                                            <th style={{textAlign:'center'}}>Dernière connexion</th>
                                            <th style={{textAlign:'center'}}>Total connexions</th>
                                            <th style={{textAlign:'center'}}>Statut</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {userStats.map((u, i) => {
                                            const st = statusBadge(u.lastTs);
                                            return (
                                                <tr key={i}>
                                                    <td style={{fontWeight:600}}>{u.displayName || '—'}</td>
                                                    <td style={{color:'var(--gray-500)'}}>{u.email}</td>
                                                    <td style={{textAlign:'center'}}>
                                                        <span style={{padding:'3px 10px',borderRadius:20,background:'rgba(139,34,82,0.08)',color:'var(--berry)',fontSize:11,fontWeight:600}}>
                                                            {profileLabel(u.profileId)}
                                                        </span>
                                                    </td>
                                                    <td style={{textAlign:'center',fontSize:11,color:'var(--gray-500)'}}>
                                                        {u.lastTs ? new Date(u.lastTs).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'}
                                                    </td>
                                                    <td style={{textAlign:'center',fontWeight:700}}>{u.total}</td>
                                                    <td style={{textAlign:'center'}}>
                                                        <span style={{padding:'3px 10px',borderRadius:20,background:st.bg,color:st.color,fontSize:10,fontWeight:700}}>
                                                            {st.label}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </Panel>
                    </div>
                </div>
            );
        }

export { DGAdoptionTab };
