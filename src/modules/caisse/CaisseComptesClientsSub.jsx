/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaisseComptesClientsSub */
import { formatMAD } from '../finance/formatMAD.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ---- Comptes Clients Marché Local (sous-lot 4.4) — LECTURE SEULE ----
        // Vue read-only des comptes clients marché local basés sur les caisses
        // `compte_client_*` (caisse_definitions). Remplace l'écran legacy
        // « Marché Local / Situation Clients » (fin_marche_local), désormais
        // retiré du menu. Aucun write Firestore : uniquement les actions de
        // lecture existantes (dashboard caisses + list-transactions).
        function CaisseComptesClientsSub({ caisses }) {
            const CU = (typeof window !== 'undefined' && window.CaisseUtils) ? window.CaisseUtils : null;

            // Filtre les caisses comptes clients (par préfixe id / kind).
            const clientCaisses = React.useMemo(() => {
                const list = Array.isArray(caisses) ? caisses : [];
                return list.filter(c => (CU ? CU.isCompteClientCaisse(c) : (c && typeof c.id === 'string' && c.id.indexOf('compte_client_') === 0)));
            }, [caisses]);

            // rows: { caisse, totals, transactions } ; loading / error global.
            const [rows, setRows] = useState([]);
            const [loading, setLoading] = useState(true);
            const [error, setError] = useState(null);
            const [expanded, setExpanded] = useState(null); // caisse_id du détail ouvert

            React.useEffect(() => {
                let cancelled = false;
                setLoading(true);
                setError(null);
                if (!clientCaisses.length) { setRows([]); setLoading(false); return; }
                Promise.all(clientCaisses.map(c =>
                    fetch('/api/caisse?action=list-transactions&caisse_id=' + encodeURIComponent(c.id) + '&limit=2000')
                        .then(r => r.json())
                        .then(json => ({ caisse: c, transactions: (json && json.success && json.transactions) ? json.transactions : [] }))
                        .catch(() => ({ caisse: c, transactions: [] }))
                )).then(results => {
                    if (cancelled) return;
                    const computed = results.map(res => ({
                        caisse: res.caisse,
                        transactions: res.transactions,
                        totals: CU ? CU.computeCompteClientTotals(res.transactions) : (() => {
                            let totalVendu = 0, totalEncaisse = 0;
                            res.transactions.forEach(t => {
                                const m = Number(t && t.montant) || 0;
                                if (t && t.type === 'vente') totalVendu += m;
                                else if (t && t.type === 'encaissement') totalEncaisse += m;
                            });
                            return { totalVendu, totalEncaisse, resteDu: totalVendu - totalEncaisse, nbVentes: 0, nbEncaissements: 0 };
                        })(),
                    }));
                    setRows(computed);
                    setLoading(false);
                }).catch(() => {
                    if (cancelled) return;
                    setError('Impossible de charger les comptes clients.');
                    setLoading(false);
                });
                return () => { cancelled = true; };
            }, [clientCaisses]);

            const grand = React.useMemo(() => rows.reduce((acc, r) => ({
                totalVendu: acc.totalVendu + r.totals.totalVendu,
                totalEncaisse: acc.totalEncaisse + r.totals.totalEncaisse,
                resteDu: acc.resteDu + r.totals.resteDu,
            }), { totalVendu: 0, totalEncaisse: 0, resteDu: 0 }), [rows]);

            const th = { padding: '10px 12px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gray-600)', borderBottom: '2px solid var(--gray-200)', whiteSpace: 'nowrap' };
            const thR = Object.assign({}, th, { textAlign: 'right' });
            const td = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--gray-100)' };
            const tdR = Object.assign({}, td, { textAlign: 'right', fontVariantNumeric: 'tabular-nums' });

            if (loading) return (
                <div style={{display:'flex',justifyContent:'center',alignItems:'center',padding:50}}>
                    <i className="fa-solid fa-spinner fa-spin" style={{fontSize:20,color:'var(--berry)',marginRight:10}}></i>
                    <span style={{color:'var(--gray-600)'}}>Chargement des comptes clients...</span>
                </div>
            );

            return (
                <div className="fade-in">
                    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
                        <h4 style={{margin:0,display:'flex',alignItems:'center',gap:8}}>
                            <i className="fa-solid fa-users" style={{color:'var(--berry)'}}></i>
                            Comptes Clients — Marché Local
                        </h4>
                        <span style={{fontSize:11,padding:'2px 10px',borderRadius:20,background:'#eef2f7',color:'var(--gray-600)',fontWeight:600}}>
                            <i className="fa-solid fa-lock" style={{marginRight:5}}></i>Lecture seule
                        </span>
                    </div>

                    {error && (
                        <div style={{padding:'10px 14px',borderRadius:8,background:'#FDECEA',color:'#C0392B',fontSize:12.5,marginBottom:14}}>
                            <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>{error}
                        </div>
                    )}

                    {rows.length === 0 && !error && (
                        <div style={{padding:'30px',textAlign:'center',color:'var(--gray-600)',background:'white',borderRadius:12,border:'1px solid var(--gray-200)'}}>
                            Aucun compte client marché local trouvé.
                        </div>
                    )}

                    {rows.length > 0 && (
                        <div style={{background:'white',borderRadius:12,border:'1px solid var(--gray-200)',overflow:'hidden'}}>
                            <div style={{overflowX:'auto'}}>
                                <table style={{borderCollapse:'collapse',width:'100%',minWidth:560}}>
                                    <thead><tr>
                                        <th style={th}>Client</th>
                                        <th style={thR}>Total vendu</th>
                                        <th style={thR}>Total encaissé</th>
                                        <th style={thR}>Reste dû</th>
                                        <th style={Object.assign({}, th, {textAlign:'center'})}></th>
                                    </tr></thead>
                                    <tbody>
                                        {rows.map(r => {
                                            const isOpen = expanded === r.caisse.id;
                                            return (
                                                <React.Fragment key={r.caisse.id}>
                                                    <tr style={{cursor:'pointer'}} onClick={() => setExpanded(isOpen ? null : r.caisse.id)}>
                                                        <td style={Object.assign({}, td, {fontWeight:600})}>
                                                            <i className={`fa-solid ${isOpen ? 'fa-chevron-down' : 'fa-chevron-right'}`} style={{fontSize:10,marginRight:8,color:'var(--gray-400)'}}></i>
                                                            {r.caisse.nom || r.caisse.id}
                                                        </td>
                                                        <td style={tdR}>{formatMAD(r.totals.totalVendu)}</td>
                                                        <td style={Object.assign({}, tdR, {color:'var(--green)'})}>{formatMAD(r.totals.totalEncaisse)}</td>
                                                        <td style={Object.assign({}, tdR, {fontWeight:700, color: r.totals.resteDu > 0 ? 'var(--berry)' : 'var(--gray-600)'})}>{formatMAD(r.totals.resteDu)}</td>
                                                        <td style={Object.assign({}, td, {textAlign:'center',color:'var(--gray-400)',fontSize:11})}>
                                                            {r.totals.nbVentes} v / {r.totals.nbEncaissements} e
                                                        </td>
                                                    </tr>
                                                    {isOpen && (
                                                        <tr>
                                                            <td colSpan={5} style={{padding:'0 12px 14px',background:'#fafbfc'}}>
                                                                {r.transactions.filter(t => t.type === 'vente' || t.type === 'encaissement').length === 0 ? (
                                                                    <div style={{padding:'12px 0',fontSize:12,color:'var(--gray-600)'}}>Aucune vente ni encaissement.</div>
                                                                ) : (
                                                                    <table style={{borderCollapse:'collapse',width:'100%',marginTop:6}}>
                                                                        <thead><tr>
                                                                            <th style={Object.assign({}, th, {fontSize:10})}>Date</th>
                                                                            <th style={Object.assign({}, th, {fontSize:10})}>Type</th>
                                                                            <th style={Object.assign({}, th, {fontSize:10})}>Référence</th>
                                                                            <th style={Object.assign({}, th, {fontSize:10})}>Description</th>
                                                                            <th style={Object.assign({}, thR, {fontSize:10})}>Montant</th>
                                                                        </tr></thead>
                                                                        <tbody>
                                                                            {r.transactions
                                                                                .filter(t => t.type === 'vente' || t.type === 'encaissement')
                                                                                .map(t => (
                                                                                    <tr key={t.id}>
                                                                                        <td style={Object.assign({}, td, {fontSize:12})}>{t.date || '-'}</td>
                                                                                        <td style={Object.assign({}, td, {fontSize:12})}>
                                                                                            <span style={{padding:'1px 8px',borderRadius:10,fontSize:10,fontWeight:600,background: t.type === 'vente' ? 'rgba(139,34,82,0.08)' : 'rgba(26,122,63,0.10)', color: t.type === 'vente' ? 'var(--berry)' : 'var(--green)'}}>
                                                                                                {t.type === 'vente' ? 'Vente' : 'Encaissement'}
                                                                                            </span>
                                                                                        </td>
                                                                                        <td style={Object.assign({}, td, {fontSize:12})}>{t.reference || '-'}</td>
                                                                                        <td style={Object.assign({}, td, {fontSize:12,color:'var(--gray-600)'})}>{t.description || '-'}</td>
                                                                                        <td style={Object.assign({}, tdR, {fontSize:12})}>{formatMAD(t.montant)}</td>
                                                                                    </tr>
                                                                                ))}
                                                                        </tbody>
                                                                    </table>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{background:'#f5f6f8'}}>
                                            <td style={Object.assign({}, td, {fontWeight:700,borderTop:'2px solid var(--gray-200)'})}>TOTAL</td>
                                            <td style={Object.assign({}, tdR, {fontWeight:700,borderTop:'2px solid var(--gray-200)'})}>{formatMAD(grand.totalVendu)}</td>
                                            <td style={Object.assign({}, tdR, {fontWeight:700,color:'var(--green)',borderTop:'2px solid var(--gray-200)'})}>{formatMAD(grand.totalEncaisse)}</td>
                                            <td style={Object.assign({}, tdR, {fontWeight:700,color:'var(--berry)',borderTop:'2px solid var(--gray-200)'})}>{formatMAD(grand.resteDu)}</td>
                                            <td style={Object.assign({}, td, {borderTop:'2px solid var(--gray-200)'})}></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    )}

                    <p style={{fontSize:11,color:'var(--gray-400)',marginTop:12}}>
                        <i className="fa-solid fa-circle-info" style={{marginRight:5}}></i>
                        Reste dû = Total vendu − Total encaissé. Tant qu'aucun encaissement n'a été importé, le reste dû est égal au total vendu.
                    </p>
                </div>
            );
        }

export { CaisseComptesClientsSub };
