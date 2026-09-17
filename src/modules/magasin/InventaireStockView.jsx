/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: magasin | Déclaration(s): InventaireStockView */
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { canonArt } from './canonArt.jsx';

import * as InventaireUtils from '../shared/lib/inventaireUtils.js';
import { InventaireMouvementsPopup } from './InventaireMouvementsPopup.jsx';
import { PmpDetailPopup } from './PmpDetailPopup.jsx';
function InventaireStockView() {
            const [balances, setBalances] = useState([]);
            const [loading, setLoading] = useState(true);
            const [locations, setLocations] = useState({ magasins: [], stations: [] });
            const [selectedLieux, setSelectedLieux] = useState([]);
            const [filterDate, setFilterDate] = useState(new Date().toISOString().split('T')[0]);
            const [search, setSearch] = useState('');
            const [showLocFilter, setShowLocFilter] = useState(false);
            const [priceMap, setPriceMap] = useState({});
            // Popup détail PMP (read-only) : article sélectionné via le badge PMP.
            const [pmpDetailArticle, setPmpDetailArticle] = useState(null);
            // Popup détail des mouvements (read-only) : article sélectionné via le NOM (cible
            // de clic distincte du badge PMP). Borné à la date d'inventaire affichée.
            const [mvtDetailLine, setMvtDetailLine] = useState(null);

            // canonArt (défini au-dessus de MagFicheStockTab) aligne les deux côtés :
            // les soldes (stock_balances) sont canonicalisés (suffixe d'unité retiré),
            // alors que le catalogue garde souvent "NOM (KG)".

            useEffect(() => {
                fetch('/api/stock?action=get-locations').then(r => r.json())
                    .then(json => { if (json.success) setLocations(json.locations || { magasins: [], stations: [] }); })
                    .catch(() => {});
            }, []);

            useEffect(() => {
                fetch('/api/stock?action=list-articles').then(r => r.json())
                    .then(j => {
                        if (j.success) {
                            const map = {};
                            (j.articles || []).forEach(a => {
                                const pmp = parseFloat(a.prix_pmp) || 0;
                                const catalogue = parseFloat(a.prix_ttc) || parseFloat(a.prix_ht) || parseFloat(a.prix_ref) || 0;
                                let entry;
                                if (pmp > 0) entry = { prix: pmp, source: 'PMP', pmpSource: a.prix_pmp_source || null };
                                else if (catalogue > 0) entry = { prix: catalogue, source: 'Catalogue' };
                                else entry = { prix: 0, source: '—' };
                                // En cas de collision sur une même clé canon, garder l'entrée avec prix>0.
                                const put = (k) => {
                                    if (!k) return;
                                    const existing = map[k];
                                    if (!existing || (existing.prix <= 0 && entry.prix > 0)) map[k] = entry;
                                };
                                put(canonArt(a.nom));
                                put(canonArt(a.reference));
                            });
                            setPriceMap(map);
                        }
                    }).catch(() => {});
            }, []);

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
                    fetch(url, { signal: controller.signal }).then(r => r.json())
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

            const toggleLieu = (lieu) => {
                setSelectedLieux(prev => prev.includes(lieu) ? prev.filter(l => l !== lieu) : [...prev, lieu]);
            };

            const getPrix = (b) => {
                const p = priceMap[canonArt(b.article_nom)] || priceMap[canonArt(b.article_ref)] || { prix: 0, source: '—' };
                return { prix: p.prix, source: p.source, pmpSource: p.pmpSource || null };
            };

            let filtered = balances.map(b => {
                const p = getPrix(b);
                return { ...b, prix_unitaire: p.prix, prix_source: p.source, prix_pmp_source: p.pmpSource, prix_total: (b.balance || 0) * p.prix };
            });
            if (selectedLieux.length > 0) filtered = filtered.filter(b => selectedLieux.includes(b.lieu_id));
            if (search) filtered = filtered.filter(b => (b.article_nom || b.article_ref || '').toLowerCase().includes(search.toLowerCase()));

            const totalPositif = filtered.filter(b => b.balance > 0).length;
            const totalAlerte = filtered.filter(b => b.seuil_alerte && b.balance <= b.seuil_alerte && b.balance > 0).length;
            const totalRupture = filtered.filter(b => b.balance <= 0).length;
            const valeurStock = filtered.reduce((s, b) => s + (b.prix_total > 0 ? b.prix_total : 0), 0);
            const nbPmp = filtered.filter(b => b.prix_source === 'PMP').length;
            const nbCatalogue = filtered.filter(b => b.prix_source === 'Catalogue').length;
            const nbSansPrix = filtered.filter(b => !b.prix_source || b.prix_source === '—').length;

            // Totaux de la sélection AFFICHÉE (pied de tableau + ligne TOTAL de l'export).
            // Sous-totaux quantité PAR UNITÉ (jamais de somme mélangée L/KG) + total DH commun.
            const IU = InventaireUtils || {};
            const totals = IU.computeInventaireTotals
                ? IU.computeInventaireTotals(filtered.map(b => ({ unite: b.unite, balance: b.balance, prix_total: b.prix_total })))
                : { count: filtered.length, prix_total_sum: 0, qte_par_unite: {} };
            const qteParUniteLabel = IU.formatQteParUnite ? IU.formatQteParUnite(totals.qte_par_unite) : '—';

            // Libellé date d'inventaire (réutilisé : titre, nom de fichier export, popup mvts).
            const dateInvValid = filterDate && /^\d{4}-\d{2}-\d{2}$/.test(filterDate);
            const dateInvFr = dateInvValid ? filterDate.split('-').reverse().join('-') : 'actuel';

            // Export Excel de la sélection affichée (respecte filtres lieu/recherche + date).
            const exportExcel = () => {
                if (!window.XLSX) return;
                const cols = ['Lieu', 'Type', 'Article', 'Unité', 'Solde', 'Prix unitaire (DH)', 'Source', 'Prix total (DH)', 'Statut'];
                const statutOf = (b) => b.balance <= 0 ? 'Rupture' : (b.seuil_alerte && b.balance <= b.seuil_alerte) ? 'Alerte' : 'OK';
                const dataRows = filtered.map(b => [
                    b.lieu_id || '', b.lieu_type || '', b.article_nom || b.article_ref || '', b.unite || '',
                    Number(b.balance) || 0,
                    b.prix_unitaire > 0 ? Number(b.prix_unitaire) : '',
                    b.prix_source || '—',
                    b.prix_total > 0 ? Number(b.prix_total) : '',
                    statutOf(b),
                ]);
                // Ligne TOTAL : total Prix Total DH + sous-totaux qté par unité (libellé compact).
                const totalRow = ['', '', `TOTAL (${totals.count} lignes)`, '', qteParUniteLabel, '', '', totals.prix_total_sum, ''];
                const all = [cols, ...dataRows, totalRow];
                const ws = XLSX.utils.aoa_to_sheet(all);
                ws['!cols'] = [16, 10, 32, 8, 12, 14, 12, 14, 10].map(w => ({ wch: w }));
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Inventaire');
                XLSX.writeFile(wb, `Inventaire_${dateInvFr}.xlsx`);
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            return (
                <div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <div>
                            <h3 style={{margin:0}}><i className="fa-solid fa-clipboard-list" style={{marginRight:8,color:'var(--berry)'}}></i>Inventaire {filterDate && /^\d{4}-\d{2}-\d{2}$/.test(filterDate) ? `au ${new Date(filterDate+'T12:00').toLocaleDateString('fr-FR')}` : '(actuel)'} ({filtered.length})</h3>
                            <div style={{fontSize:11,color:'#888',marginTop:4}}>Valorisation — PMP: {nbPmp} · Catalogue: {nbCatalogue} · sans prix: {nbSansPrix}</div>
                        </div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
                                style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}} />
                            <div style={{position:'relative'}}>
                                <button onClick={() => setShowLocFilter(!showLocFilter)}
                                    style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12,cursor:'pointer',background: selectedLieux.length ? 'var(--berry)' : '#f5f5f5',color: selectedLieux.length ? '#fff' : '#333'}}>
                                    <i className="fa-solid fa-filter" style={{marginRight:4}}></i>
                                    {selectedLieux.length ? `${selectedLieux.length} lieu(x)` : 'Tous les lieux'}
                                </button>
                                {showLocFilter && (
                                    <div style={{position:'absolute',top:'100%',right:0,marginTop:4,background:'#fff',border:'1px solid #ddd',borderRadius:10,padding:12,zIndex:100,minWidth:220,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',maxHeight:300,overflowY:'auto'}}>
                                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                                            <span style={{fontSize:11,fontWeight:700,color:'var(--berry)'}}>Sélectionner les lieux</span>
                                            {selectedLieux.length > 0 && <button onClick={() => setSelectedLieux([])} style={{fontSize:10,color:'var(--red)',border:'none',background:'none',cursor:'pointer'}}>Tout effacer</button>}
                                        </div>
                                        <div style={{fontSize:10,fontWeight:600,color:'#888',marginBottom:4,marginTop:8}}>MAGASINS</div>
                                        {(locations.magasins || []).map(m => (
                                            <label key={m} style={{display:'flex',alignItems:'center',gap:6,padding:'3px 0',fontSize:12,cursor:'pointer'}}>
                                                <input type="checkbox" checked={selectedLieux.includes(m)} onChange={() => toggleLieu(m)} />
                                                {m}
                                            </label>
                                        ))}
                                        <div style={{fontSize:10,fontWeight:600,color:'#888',marginBottom:4,marginTop:8}}>STATIONS</div>
                                        {(locations.stations || []).map(s => (
                                            <label key={s} style={{display:'flex',alignItems:'center',gap:6,padding:'3px 0',fontSize:12,cursor:'pointer'}}>
                                                <input type="checkbox" checked={selectedLieux.includes(s)} onChange={() => toggleLieu(s)} />
                                                {s}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher article..."
                                style={{padding:'6px 14px',borderRadius:8,border:'1px solid #ddd',fontSize:12,width:180}} />
                            <button onClick={exportExcel} disabled={!filtered.length}
                                title="Exporter la sélection affichée en Excel"
                                style={{padding:'6px 12px',borderRadius:8,border:'none',fontSize:12,fontWeight:600,cursor: filtered.length ? 'pointer' : 'not-allowed',background:'var(--green)',color:'#fff',opacity: filtered.length ? 1 : 0.5,display:'flex',alignItems:'center',gap:6}}>
                                <i className="fa-solid fa-file-excel"></i> Exporter Excel
                            </button>
                        </div>
                    </div>

                    <div className="kpi-grid" style={{gridTemplateColumns:'repeat(4, 1fr)',marginBottom:16}}>
                        <div className="kpi-card"><div className="kpi-icon green"><i className="fa-solid fa-check"></i></div><div className="kpi-value">{totalPositif}</div><div className="kpi-label">En stock</div></div>
                        <div className="kpi-card"><div className="kpi-icon" style={{background:'rgba(243,156,18,0.12)',color:'var(--gold)'}}><i className="fa-solid fa-exclamation"></i></div><div className="kpi-value">{totalAlerte}</div><div className="kpi-label">En alerte</div></div>
                        <div className="kpi-card"><div className="kpi-icon" style={{background:'rgba(231,76,60,0.12)',color:'var(--red)'}}><i className="fa-solid fa-ban"></i></div><div className="kpi-value">{totalRupture}</div><div className="kpi-label">Ruptures</div></div>
                        <div className="kpi-card"><div className="kpi-icon" style={{background:'rgba(139,34,82,0.12)',color:'var(--berry)'}}><i className="fa-solid fa-coins"></i></div><div className="kpi-value">{valeurStock.toLocaleString('fr-FR', {maximumFractionDigits:0})}</div><div className="kpi-label">Valeur stock (DH)</div></div>
                    </div>

                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>Lieu</th><th>Type</th><th>Article</th><th>Unité</th><th>Solde</th><th>Prix Unit. (DH)</th><th>Source</th><th>Prix Total (DH)</th><th>Statut</th></tr></thead>
                        <tbody>
                            {filtered.map((b, i) => (
                                <tr key={i}>
                                    <td><span className="status-badge" style={{background:'rgba(139,34,82,0.1)',color:'var(--berry)',fontSize:10}}>{b.lieu_id}</span></td>
                                    <td style={{fontSize:11,textTransform:'capitalize'}}>{b.lieu_type}</td>
                                    <td style={{fontWeight:600}}>
                                        <span
                                            title="Voir le détail des mouvements jusqu'à la date d'inventaire"
                                            onClick={() => setMvtDetailLine({
                                                // Le NOM d'abord : c'est la clé que portent les mouvements.
                                                // Un article fusionné a un solde sur le docId de sa fiche
                                                // (ex. Ref-Eng0052) que AUCUN mouvement ne porte — envoyer
                                                // la ref d'abord vidait l'écran. Même priorité que
                                                // get-pmp-detail (article_nom || article_ref).
                                                article: b.article_nom || b.article_ref || '',
                                                article_nom: b.article_nom || b.article_ref || '',
                                                lieu_id: b.lieu_id || '',
                                                unite: b.unite || '',
                                                solde: Number(b.balance) || 0,
                                            })}
                                            style={{cursor:'pointer',textDecoration:'underline dotted',textUnderlineOffset:2}}>
                                            {b.article_nom || b.article_ref}
                                        </span>
                                    </td>
                                    <td>{b.unite}</td>
                                    <td style={{fontWeight:700,fontSize:14}}>{(b.balance || 0).toLocaleString('fr-FR', {minimumFractionDigits:1})}</td>
                                    <td style={{textAlign:'right',color: b.prix_unitaire > 0 ? '#333' : '#bbb'}}>{b.prix_unitaire > 0 ? b.prix_unitaire.toFixed(2) : '—'}</td>
                                    <td style={{textAlign:'center'}}>
                                        {(() => {
                                            const src = b.prix_source || '—';
                                            const styleMap = {
                                                'PMP': { bg:'rgba(39,174,96,0.12)', col:'#1e8449' },
                                                'Catalogue': { bg:'rgba(0,0,0,0.06)', col:'#666' },
                                                '—': { bg:'rgba(231,76,60,0.10)', col:'#c0392b' }
                                            };
                                            const st = styleMap[src] || styleMap['—'];
                                            let title = src === 'PMP' ? 'PMP' : src;
                                            let dot = null;
                                            if (src === 'PMP') {
                                                if (b.prix_pmp_source === 'bon_entree') {
                                                    title = "PMP — prix d'un bon d'entrée réel (fiable)";
                                                    dot = '#1e8449';
                                                } else if (b.prix_pmp_source === 'inventaire') {
                                                    title = "PMP — prix de l'inventaire d'ouverture 30/06 (snapshot)";
                                                    dot = '#b9770e';
                                                }
                                            }
                                            if (src === 'PMP') {
                                                title = title + ' — cliquer pour le détail du calcul';
                                                return <span title={title} onClick={() => setPmpDetailArticle({ article_ref: b.article_ref || '', article_nom: b.article_nom || b.article_ref || '', unite: b.unite || '', lieu: b.lieu_id || '' })} style={{fontSize:10,fontWeight:600,padding:'2px 7px',borderRadius:10,background:st.bg,color:st.col,cursor:'pointer',textDecoration:'underline dotted'}}>{src}{dot && <span style={{marginLeft:4,color:dot}}>•</span>}</span>;
                                            }
                                            return <span title={title} style={{fontSize:10,fontWeight:600,padding:'2px 7px',borderRadius:10,background:st.bg,color:st.col,cursor:'default'}}>{src}{dot && <span style={{marginLeft:4,color:dot}}>•</span>}</span>;
                                        })()}
                                    </td>
                                    <td style={{textAlign:'right',fontWeight:700,color: b.prix_total > 0 ? 'var(--berry)' : '#bbb'}}>{b.prix_total > 0 ? b.prix_total.toLocaleString('fr-FR', {maximumFractionDigits:2}) : '—'}</td>
                                    <td>
                                        {b.balance <= 0 ? <span className="status-badge rejete">Rupture</span>
                                        : (b.seuil_alerte && b.balance <= b.seuil_alerte) ? <span className="status-badge en-attente">Alerte</span>
                                        : <span className="status-badge valide">OK</span>}
                                    </td>
                                </tr>
                            ))}
                            {filtered.length === 0 && <tr><td colSpan="9" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucun résultat pour les critères sélectionnés.</td></tr>}
                        </tbody>
                        {filtered.length > 0 && (
                            <tfoot>
                                <tr style={{background:'rgba(139,34,82,0.06)',fontWeight:700}}>
                                    <td colSpan="2" style={{fontWeight:700}}>TOTAL ({totals.count} lignes)</td>
                                    <td colSpan="2" style={{fontSize:11,fontWeight:600,color:'#555'}}>{qteParUniteLabel}</td>
                                    <td colSpan="3"></td>
                                    <td style={{textAlign:'right',fontWeight:700,color:'var(--berry)'}}>{totals.prix_total_sum.toLocaleString('fr-FR', {maximumFractionDigits:2})}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        )}
                    </table></div>
                    {pmpDetailArticle && PmpDetailPopup && (
                        <PmpDetailPopup
                            article_ref={pmpDetailArticle.article_ref}
                            article_nom={pmpDetailArticle.article_nom}
                            unite={pmpDetailArticle.unite}
                            lieu={pmpDetailArticle.lieu}
                            onClose={() => setPmpDetailArticle(null)}
                        />
                    )}
                    {mvtDetailLine && InventaireMouvementsPopup && (
                        <InventaireMouvementsPopup
                            article={mvtDetailLine.article}
                            article_nom={mvtDetailLine.article_nom}
                            lieu_id={mvtDetailLine.lieu_id}
                            unite={mvtDetailLine.unite}
                            dateInventaire={dateInvValid ? filterDate : ''}
                            soldeAttendu={mvtDetailLine.solde}
                            onClose={() => setMvtDetailLine(null)}
                        />
                    )}
                </div>
            );
        }

export { InventaireStockView };
