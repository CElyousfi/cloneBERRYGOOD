/* Module: magasin | Déclaration(s): MagDashboardStockTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== MAGASINIER TABS =====================

        // ===================== MAGASINIER: DASHBOARD STOCK =====================
        function MagDashboardStockTab({ currentProfile, profileData }) {
            const [balances, setBalances] = useState([]);
            const [movements, setMovements] = useState([]);
            const [loading, setLoading] = useState(true);
            const [filterLieu, setFilterLieu] = useState('');

            useEffect(() => {
                Promise.all([
                    fetch('/api/stock?action=get-balances').then(r => r.json()),
                    fetch('/api/stock?action=list-movements&limit=20').then(r => r.json()),
                ]).then(([balJson, movJson]) => {
                    if (balJson.success) setBalances(balJson.balances || []);
                    if (movJson.success) setMovements(movJson.movements || []);
                }).catch(err => console.warn(err)).finally(() => setLoading(false));
            }, []);

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            const filtered = filterLieu ? balances.filter(b => b.lieu_id === filterLieu) : balances;
            const totalArticles = filtered.length;
            const alertes = filtered.filter(b => b.seuil_alerte && b.balance <= b.seuil_alerte).length;
            const ruptures = filtered.filter(b => b.balance <= 0).length;
            const lieux = [...new Set(balances.map(b => b.lieu_id))].sort();

            const typeLabels = { reception: 'Réception', transfert: 'Transfert', consommation: 'Consommation', sortie: 'Sortie' };
            const typeColors = { reception: 'var(--green)', transfert: 'var(--blue)', consommation: 'var(--gold)', sortie: 'var(--red)' };

            return (
                <div className="fade-in">
                    <h3 style={{marginBottom:16}}><i className="fa-solid fa-gauge-high" style={{marginRight:8,color:'var(--berry)'}}></i>Dashboard Stock</h3>

                    <div className="kpi-grid" style={{gridTemplateColumns:'repeat(4, 1fr)',marginBottom:16}}>
                        <div className="kpi-card"><div className="kpi-icon berry"><i className="fa-solid fa-cubes"></i></div><div className="kpi-value">{totalArticles}</div><div className="kpi-label">Articles en stock</div></div>
                        <div className="kpi-card"><div className="kpi-icon" style={{background:'rgba(231,76,60,0.12)',color:'var(--red)'}}><i className="fa-solid fa-triangle-exclamation"></i></div><div className="kpi-value">{alertes}</div><div className="kpi-label">En alerte</div></div>
                        <div className="kpi-card"><div className="kpi-icon" style={{background:'rgba(231,76,60,0.2)',color:'#c0392b'}}><i className="fa-solid fa-ban"></i></div><div className="kpi-value">{ruptures}</div><div className="kpi-label">Ruptures</div></div>
                        <div className="kpi-card"><div className="kpi-icon green"><i className="fa-solid fa-warehouse"></i></div><div className="kpi-value">{lieux.length}</div><div className="kpi-label">Lieux actifs</div></div>
                    </div>

                    {/* Soldes par magasin */}
                    <div className="panel" style={{marginBottom:20}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                            <h4 style={{margin:0}}>Soldes par lieu ({filtered.length})</h4>
                            <select value={filterLieu} onChange={e => setFilterLieu(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                <option value="">Tous les lieux</option>
                                {lieux.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>
                        </div>
                        <div className="table-responsive"><table className="data-table">
                            <thead><tr><th>Lieu</th><th>Type</th><th>Article</th><th>Unité</th><th>Solde</th><th>Statut</th></tr></thead>
                            <tbody>
                                {filtered.map((b, i) => (
                                    <tr key={i}>
                                        <td><span className="status-badge" style={{background:'rgba(139,34,82,0.1)',color:'var(--berry)',fontSize:10}}>{b.lieu_id}</span></td>
                                        <td style={{fontSize:11,textTransform:'capitalize'}}>{b.lieu_type}</td>
                                        <td style={{fontWeight:600}}>{b.article_nom || b.article_ref}</td>
                                        <td>{b.unite}</td>
                                        <td style={{fontWeight:700,fontSize:14}}>{(b.balance || 0).toLocaleString('fr-FR', {minimumFractionDigits:1})}</td>
                                        <td>{b.balance <= 0 ? <span className="status-badge rejete">Rupture</span> : (b.seuil_alerte && b.balance <= b.seuil_alerte) ? <span className="status-badge en-attente">Alerte</span> : <span className="status-badge valide">OK</span>}</td>
                                    </tr>
                                ))}
                                {filtered.length === 0 && <tr><td colSpan="6" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucun stock enregistré. Les soldes apparaitront après les premières réceptions.</td></tr>}
                            </tbody>
                        </table></div>
                    </div>

                    {/* Derniers mouvements */}
                    <div className="panel">
                        <h4 style={{margin:'0 0 12px 0'}}>Derniers mouvements</h4>
                        <div className="table-responsive"><table className="data-table" style={{fontSize:12}}>
                            <thead><tr><th>N°</th><th>Type</th><th>Date</th><th>Ferme</th><th>Articles</th><th>Statut</th></tr></thead>
                            <tbody>
                                {movements.slice(0, 10).map((m) => (
                                    <tr key={m.id}>
                                        <td style={{fontWeight:700,color:'var(--berry)',fontSize:11}}>{m.numero}</td>
                                        <td><span style={{color: typeColors[m.type] || '#666',fontWeight:600,fontSize:11}}>{typeLabels[m.type] || m.type}</span></td>
                                        <td>{m.date}</td>
                                        <td>{m.ferme}</td>
                                        <td style={{fontSize:11}}>{(m.items||[]).map(i => (i.article_nom||i.article_ref) + ' (' + i.quantite + ')').join(', ')}</td>
                                        <td><span className={'status-badge ' + (m.status === 'valide_chef' ? 'valide' : m.status === 'rejete' ? 'rejete' : 'en-attente')}>{m.status === 'valide_chef' ? 'Validé' : m.status === 'valide_mag' ? 'À valider par Achats' : m.status === 'valide_achats' ? 'À valider par Chef' : m.status === 'rejete' ? 'Rejeté' : m.status}</span></td>
                                    </tr>
                                ))}
                                {movements.length === 0 && <tr><td colSpan="6" style={{textAlign:'center',color:'var(--gray-400)',padding:20}}>Aucun mouvement enregistré.</td></tr>}
                            </tbody>
                        </table></div>
                    </div>
                </div>
            );
        }

export { MagDashboardStockTab };
