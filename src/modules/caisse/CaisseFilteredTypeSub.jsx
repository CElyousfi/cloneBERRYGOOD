/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaisseFilteredTypeSub */
import { formatMAD } from '../finance/formatMAD.jsx';
import { STATUS_LABELS } from '../shared/STATUS_LABELS.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { CaisseSaisieSub } from './CaisseSaisieSub.jsx';
import { TXN_TYPE_LABELS } from './TXN_TYPE_LABELS.jsx';

// ---- Filtered Type Sub (Alimentations / Paie / Transport) ----
        function CaisseFilteredTypeSub({ caisses, typeFilter, title, icon, isSaisie, onDone, hasEmployee }) {
            const [transactions, setTransactions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [search, setSearch] = useState('');
            const [filterCaisse, setFilterCaisse] = useState('');
            const [dateFrom, setDateFrom] = useState('');
            const [dateTo, setDateTo] = useState('');

            const load = () => {
                setLoading(true);
                let url = '/api/caisse?action=list-transactions&limit=500';
                if (filterCaisse) url += '&caisse_id=' + filterCaisse;
                if (dateFrom) url += '&date_from=' + dateFrom;
                if (dateTo) url += '&date_to=' + dateTo;
                fetch(url).then(r => r.json())
                    .then(json => {
                        if (json.success) {
                            const filtered = (json.transactions || []).filter(t => t.type === typeFilter);
                            setTransactions(filtered);
                        }
                    })
                    .catch(() => {})
                    .finally(() => setLoading(false));
            };

            React.useEffect(() => { load(); }, [filterCaisse, dateFrom, dateTo, typeFilter]);

            let filtered = transactions;
            if (search && hasEmployee) {
                const q = search.toLowerCase();
                filtered = filtered.filter(t =>
                    (t.matricule || '').toLowerCase().includes(q) ||
                    (t.beneficiaire_nom || '').toLowerCase().includes(q) ||
                    (t.description || '').toLowerCase().includes(q) ||
                    (t.reference || '').toLowerCase().includes(q)
                );
            } else if (search) {
                const q = search.toLowerCase();
                filtered = filtered.filter(t =>
                    (t.description || '').toLowerCase().includes(q) ||
                    (t.reference || '').toLowerCase().includes(q)
                );
            }

            // Group by employee if hasEmployee
            const byEmployee = {};
            if (hasEmployee) {
                filtered.forEach(t => {
                    const key = t.matricule || t.beneficiaire_nom || '—';
                    if (!byEmployee[key]) byEmployee[key] = { matricule: t.matricule || '', nom: t.beneficiaire_nom || '', count: 0, total: 0, transactions: [] };
                    byEmployee[key].count += 1;
                    byEmployee[key].total += (t.montant || 0);
                    byEmployee[key].transactions.push(t);
                });
            }

            const totalMontant = filtered.filter(t => t.status === 'valide').reduce((s, t) => s + (t.montant || 0), 0);
            const totalEnAttente = filtered.filter(t => t.status === 'soumis').reduce((s, t) => s + (t.montant || 0), 0);
            const tt = TXN_TYPE_LABELS[typeFilter] || {};

            if (showForm) {
                return (
                    <div>
                        <button onClick={() => setShowForm(false)} style={{padding:'6px 14px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:12,marginBottom:16}}>
                            <i className="fa-solid fa-arrow-left" style={{marginRight:6}}></i>Retour à la liste
                        </button>
                        <CaisseSaisieSub caisses={caisses} defaultType={typeFilter} onDone={() => { setShowForm(false); load(); onDone && onDone(); }} />
                    </div>
                );
            }

            return (
                <div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <h4 style={{margin:0,display:'flex',alignItems:'center',gap:8}}>
                            <i className={`fa-solid ${icon}`} style={{color:tt.color || 'var(--berry)'}}></i>{title} ({filtered.length})
                        </h4>
                        {isSaisie && (
                            <button onClick={() => setShowForm(true)} style={{padding:'8px 16px',borderRadius:8,border:'none',background: tt.color || 'var(--berry)',color:'white',cursor:'pointer',fontSize:12,fontWeight:600}}>
                                <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouvelle saisie {title}
                            </button>
                        )}
                    </div>

                    <div className="kpi-grid" style={{gridTemplateColumns:'repeat(3,1fr)',marginBottom:16}}>
                        <div className="kpi-card"><div className="kpi-icon" style={{background:tt.bg,color:tt.color}}><i className={`fa-solid ${icon}`}></i></div><div className="kpi-value">{formatMAD(totalMontant)}</div><div className="kpi-label">Total validé</div></div>
                        <div className="kpi-card"><div className="kpi-icon" style={{background:'rgba(243,156,18,0.12)',color:'#E67E22'}}><i className="fa-solid fa-clock"></i></div><div className="kpi-value">{formatMAD(totalEnAttente)}</div><div className="kpi-label">En attente</div></div>
                        <div className="kpi-card"><div className="kpi-icon" style={{background:'rgba(52,152,219,0.12)',color:'var(--blue)'}}><i className="fa-solid fa-list"></i></div><div className="kpi-value">{filtered.length}</div><div className="kpi-label">Nb transactions</div></div>
                    </div>

                    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
                        <select value={filterCaisse} onChange={e => setFilterCaisse(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}}>
                            <option value="">Toutes caisses</option>
                            {caisses.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                        </select>
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Du"
                            style={{padding:'6px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}} />
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="Au"
                            style={{padding:'6px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}} />
                        <input value={search} onChange={e => setSearch(e.target.value)}
                            placeholder={hasEmployee ? 'Rechercher matricule, nom, description...' : 'Rechercher...'}
                            style={{padding:'6px 14px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12,flex:'1 1 250px'}} />
                    </div>

                    {loading && <div style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:24,color:'var(--berry)'}}></i></div>}

                    {!loading && hasEmployee && Object.keys(byEmployee).length > 0 && (
                        <div style={{marginBottom:16}}>
                            <h5 style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',marginBottom:8}}><i className="fa-solid fa-users" style={{marginRight:6}}></i>Récapitulatif par employé</h5>
                            <div style={{background:'white',borderRadius:12,border:'1px solid var(--gray-200)',overflow:'hidden'}}>
                                <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                                    <thead><tr style={{background:'var(--gray-100)'}}>
                                        <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600}}>Matricule</th>
                                        <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600}}>Nom</th>
                                        <th style={{padding:'10px 14px',textAlign:'right',fontWeight:600}}>Nb transactions</th>
                                        <th style={{padding:'10px 14px',textAlign:'right',fontWeight:600}}>Total (DH)</th>
                                    </tr></thead>
                                    <tbody>
                                        {Object.values(byEmployee).sort((a,b) => b.total - a.total).map((e, i) => (
                                            <tr key={i} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                <td style={{padding:'8px 14px',fontWeight:600}}>{e.matricule || '—'}</td>
                                                <td style={{padding:'8px 14px'}}>{e.nom || '—'}</td>
                                                <td style={{padding:'8px 14px',textAlign:'right'}}>{e.count}</td>
                                                <td style={{padding:'8px 14px',textAlign:'right',fontWeight:700,color:tt.color}}>{formatMAD(e.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {!loading && (
                        <div style={{background:'white',borderRadius:12,border:'1px solid var(--gray-200)',overflow:'hidden'}}>
                            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                                <thead><tr style={{background:'var(--gray-100)'}}>
                                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600}}>Date</th>
                                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600}}>Caisse</th>
                                    {hasEmployee && <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600}}>Matricule</th>}
                                    {hasEmployee && <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600}}>Bénéficiaire</th>}
                                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:600}}>Description</th>
                                    <th style={{padding:'10px 14px',textAlign:'right',fontWeight:600}}>Montant</th>
                                    <th style={{padding:'10px 14px',textAlign:'center',fontWeight:600}}>Statut</th>
                                </tr></thead>
                                <tbody>
                                    {filtered.map((tx) => {
                                        const ss = STATUS_LABELS[tx.status] || {};
                                        const caisseName = caisses.find(c => c.id === tx.caisse_id)?.nom || tx.caisse_id;
                                        return (
                                            <tr key={tx.id} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                <td style={{padding:'8px 14px',whiteSpace:'nowrap'}}>{tx.date}</td>
                                                <td style={{padding:'8px 14px',fontSize:11}}>{caisseName}</td>
                                                {hasEmployee && <td style={{padding:'8px 14px',fontWeight:600}}>{tx.matricule || '—'}</td>}
                                                {hasEmployee && <td style={{padding:'8px 14px'}}>{tx.beneficiaire_nom || '—'}</td>}
                                                <td style={{padding:'8px 14px',maxWidth:250,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tx.description || tx.reference}</td>
                                                <td style={{padding:'8px 14px',textAlign:'right',fontWeight:600,color: typeFilter === 'alimentation' ? 'var(--green)' : 'var(--red)'}}>
                                                    {typeFilter === 'alimentation' ? '+' : '-'}{formatMAD(tx.montant)}
                                                </td>
                                                <td style={{padding:'8px 14px',textAlign:'center'}}>
                                                    <span style={{padding:'3px 10px',borderRadius:12,background:ss.bg||'#eee',color:ss.color||'#333',fontSize:11,fontWeight:600}}>{ss.label||tx.status}</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {filtered.length === 0 && (
                                        <tr><td colSpan={hasEmployee ? 7 : 5} style={{padding:40,textAlign:'center',color:'var(--gray-400)'}}>Aucune transaction trouvée.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            );
        }

export { CaisseFilteredTypeSub };
