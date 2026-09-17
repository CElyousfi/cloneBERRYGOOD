/* Module: magasin | Déclaration(s): MagStockIntrantsTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

function MagStockIntrantsTab() {
            const [balances, setBalances] = useState([]);
            const [loading, setLoading] = useState(true);
            const [search, setSearch] = useState('');
            const [filterLieu, setFilterLieu] = useState('');
            const [filterType, setFilterType] = useState('');
            const [filterDate, setFilterDate] = useState('');

            useEffect(() => {
                const valid = !filterDate || /^\d{4}-\d{2}-\d{2}$/.test(filterDate);
                let yearOk = true;
                if (filterDate) { const y = parseInt(filterDate.slice(0, 4), 10); yearOk = y >= 1900 && y <= 2200; }
                if (!valid || !yearOk) return; // date partielle pendant la frappe → on ignore
                const controller = new AbortController();
                const t = setTimeout(() => {
                    setLoading(true);
                    const todayStr = new Date().toISOString().split('T')[0];
                    const useMaterialized = !filterDate || filterDate >= todayStr;
                    const url = useMaterialized
                        ? '/api/stock?action=get-balances'
                        : `/api/stock?action=get-balances-at-date&date=${filterDate}`;
                    fetch(url, { signal: controller.signal })
                        .then(r => r.json())
                        .then(json => {
                            if (json.success) {
                                const list = json.balances || [];
                                setBalances(useMaterialized ? list.filter(b => Math.abs(Number(b.balance) || 0) >= 0.01) : list);
                            }
                        })
                        .catch(err => { if (err && err.name === 'AbortError') return; console.warn('Balances error:', err); })
                        .finally(() => setLoading(false));
                }, 400);
                return () => { clearTimeout(t); controller.abort(); };
            }, [filterDate]);

            let filtered = balances;
            if (search) filtered = filtered.filter(b => (b.article_nom || b.article_ref || '').toLowerCase().includes(search.toLowerCase()));
            if (filterLieu) filtered = filtered.filter(b => b.lieu_id === filterLieu);
            if (filterType) filtered = filtered.filter(b => b.lieu_type === filterType);

            const totalPositif = filtered.filter(b => b.balance > 0).length;
            const totalAlerte = filtered.filter(b => b.seuil_alerte && b.balance <= b.seuil_alerte && b.balance > 0).length;
            const totalRupture = filtered.filter(b => b.balance <= 0).length;
            const lieux = [...new Set(balances.map(b => b.lieu_id))].sort();
            // Types du filtre = UNION de magasin/station (toujours proposés, l'UI historique
            // ne doit pas perdre d'entrée un jour sans solde) et des lieu_type réellement
            // rencontrés : les soldes 'externe'/'parcelle' étaient affichés mais non filtrables.
            const lieuTypes = [...new Set(['magasin', 'station'].concat(balances.map(b => b.lieu_type).filter(Boolean)))].sort();
            const capitalizeType = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
            // Un filtre devenu orphelin (ex. « Externe » puis changement de date vers un jour
            // sans solde externe) viderait le tableau sans explication : on le réinitialise.
            useEffect(() => {
                if (filterType && !lieuTypes.includes(filterType)) setFilterType('');
            }, [lieuTypes.join('|'), filterType]);

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <h3 style={{margin:0}}><i className="fa-solid fa-warehouse" style={{marginRight:8,color:'var(--berry)'}}></i>Soldes Stock {filterDate && /^\d{4}-\d{2}-\d{2}$/.test(filterDate) ? `au ${new Date(filterDate+'T12:00').toLocaleDateString('fr-FR')}` : '(actuel)'} ({filtered.length})</h3>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
                                style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}} />
                            {filterDate && <button onClick={() => setFilterDate('')} style={{padding:'6px 10px',borderRadius:8,border:'1px solid #ddd',fontSize:11,cursor:'pointer',background:'#f5f5f5'}}>Aujourd'hui</button>}
                            <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                <option value="">Type lieu</option>
                                {lieuTypes.map(t => <option key={t} value={t}>{capitalizeType(t)}</option>)}
                            </select>
                            <select value={filterLieu} onChange={e => setFilterLieu(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                <option value="">Tous les lieux</option>
                                {lieux.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
                                style={{padding:'6px 14px',borderRadius:8,border:'1px solid #ddd',fontSize:12,width:200}} />
                        </div>
                    </div>

                    <div className="kpi-grid" style={{gridTemplateColumns:'repeat(3, 1fr)',marginBottom:16}}>
                        <div className="kpi-card"><div className="kpi-icon green"><i className="fa-solid fa-check"></i></div><div className="kpi-value">{totalPositif}</div><div className="kpi-label">En stock</div></div>
                        <div className="kpi-card"><div className="kpi-icon" style={{background:'rgba(243,156,18,0.12)',color:'var(--gold)'}}><i className="fa-solid fa-exclamation"></i></div><div className="kpi-value">{totalAlerte}</div><div className="kpi-label">En alerte</div></div>
                        <div className="kpi-card"><div className="kpi-icon" style={{background:'rgba(231,76,60,0.12)',color:'var(--red)'}}><i className="fa-solid fa-ban"></i></div><div className="kpi-value">{totalRupture}</div><div className="kpi-label">Ruptures</div></div>
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
                                    <td>
                                        {b.balance <= 0 ? <span className="status-badge rejete">Rupture</span>
                                        : (b.seuil_alerte && b.balance <= b.seuil_alerte) ? <span className="status-badge en-attente">Alerte</span>
                                        : <span className="status-badge valide">OK</span>}
                                    </td>
                                </tr>
                            ))}
                            {filtered.length === 0 && <tr><td colSpan="6" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>{search || filterLieu ? 'Aucun résultat.' : 'Aucun solde stock. Les soldes apparaitront après les premières réceptions validées.'}</td></tr>}
                        </tbody>
                    </table></div>
                </div>
            );
        }

export { MagStockIntrantsTab };
