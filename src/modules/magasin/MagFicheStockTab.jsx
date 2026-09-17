/* Module: magasin | Déclaration(s): MagFicheStockTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { canonArt } from './canonArt.jsx';

// ===================== MAGASINIER: SOLDES STOCK TAB =====================
        function MagFicheStockTab() {
            const [articles, setArticles] = useState([]);
            const [loadingArticles, setLoadingArticles] = useState(true);
            const [selectedArticle, setSelectedArticle] = useState('');
            const [entries, setEntries] = useState([]);
            const [soldes, setSoldes] = useState([]);
            const [soldeGlobal, setSoldeGlobal] = useState(0);
            const [movementsMap, setMovementsMap] = useState({});
            const [detailMov, setDetailMov] = useState(null);
            const [articleInfo, setArticleInfo] = useState(null);
            const [loadingHistory, setLoadingHistory] = useState(false);
            const [filterLieu, setFilterLieu] = useState('');
            const [dateFrom, setDateFrom] = useState('');
            const [dateTo, setDateTo] = useState('');
            const [filterNum, setFilterNum] = useState('');
            const [filterType, setFilterType] = useState('');
            const [onlyNegCumul, setOnlyNegCumul] = useState(false);

            // Liste distincte d'articles depuis les soldes officiels
            useEffect(() => {
                setLoadingArticles(true);
                fetch('/api/stock?action=get-balances')
                    .then(r => r.json())
                    .then(json => {
                        if (json.success) {
                            // UNE entrée par ARTICLE, c'est-à-dire par clé `canonArt` — celle
                            // qui résout déjà l'historique, les soldes et le PMP. Sur le nom
                            // BRUT, « ALGA 600 » et « Alga 600 » donnaient deux entrées au
                            // stock et aux mouvements identiques : l'écran affirmait deux
                            // articles là où il n'y en a qu'un.
                            // Libellé retenu — déterministe et indépendant de l'ordre d'arrivée
                            // des soldes : l'écriture canonique si elle figure telle quelle
                            // parmi les variantes (« ALGA 600 » l'emporte sur « Alga 600 »),
                            // sinon la plus petite en comparaison binaire.
                            const seen = {};
                            (json.balances || []).forEach(b => {
                                // NOM d'abord : clé portée par les mouvements (cf. get-article-history).
                                // Avec la ref d'abord, un article fusionné (solde sur docId) s'affichait
                                // dans la liste mais son grand livre revenait vide.
                                const ref = b.article_nom || b.article_ref;
                                const key = canonArt(ref);
                                if (!ref || !key) return;
                                const prev = seen[key];
                                if (prev === undefined) { seen[key] = ref; return; }
                                if (prev === key) return;
                                if (ref === key || ref < prev) seen[key] = ref;
                            });
                            const list = Object.keys(seen).map(k => ({ ref: seen[k], label: seen[k] }));
                            list.sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
                            setArticles(list);
                            setSelectedArticle(prev => (!prev && list.length > 0) ? list[0].ref : prev);
                        }
                    })
                    .catch(err => console.warn('Articles error:', err))
                    .finally(() => setLoadingArticles(false));
            }, []);

            // Historique du grand livre pour l'article sélectionné
            useEffect(() => {
                if (!selectedArticle) { setEntries([]); setSoldes([]); setSoldeGlobal(0); setMovementsMap({}); setArticleInfo(null); return; }
                setLoadingHistory(true);
                fetch('/api/stock?action=get-article-history&article=' + encodeURIComponent(selectedArticle))
                    .then(r => r.json())
                    .then(json => {
                        if (json.success) {
                            setEntries(json.entries || []);
                            setSoldes(json.soldes_par_lieu || []);
                            setSoldeGlobal(json.solde_global || 0);
                            setMovementsMap(json.movements || {});
                            setArticleInfo(json.article || null);
                        } else {
                            setEntries([]); setSoldes([]); setSoldeGlobal(0); setMovementsMap({}); setArticleInfo(null);
                        }
                    })
                    .catch(err => console.warn('Article history error:', err))
                    .finally(() => setLoadingHistory(false));
            }, [selectedArticle]);

            const typeLabel = (t) => ({ reception: 'Réception', sortie: 'Sortie', consommation: 'Consommation', transfert: 'Transfert', inventaire: 'Inventaire' }[t] || (t || ''));
            const fmt = (n) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
            const lieuxPresents = [...new Set(entries.map(e => e.lieu_id))].sort();
            const numQuery = (filterNum || '').trim().toLowerCase();
            const visibleEntries = entries.filter(e => {
                if (filterLieu && e.lieu_id !== filterLieu) return false;
                if (dateFrom && !(e.date >= dateFrom)) return false;
                if (dateTo && !(e.date <= dateTo)) return false;
                if (numQuery && !(e.numero || '').toLowerCase().includes(numQuery)) return false;
                if (filterType && e.type !== filterType) return false;
                if (onlyNegCumul && !(Number(e.cumul_apres) < 0 || Number(e.cumul_global_apres) < 0)) return false;
                return true;
            });
            const anyFilterActive = !!(filterLieu || dateFrom || dateTo || numQuery || filterType || onlyNegCumul);
            const curIdx = articles.findIndex(a => a.ref === selectedArticle);
            const navDisabled = loadingArticles || articles.length <= 1;
            const gotoPrev = () => { if (articles.length > 0) setSelectedArticle(articles[(curIdx - 1 + articles.length) % articles.length].ref); };
            const gotoNext = () => { if (articles.length > 0) setSelectedArticle(articles[(curIdx + 1) % articles.length].ref); };
            const arrowStyle = (disabled) => ({ width:30, height:30, borderRadius:8, border:'1px solid #ddd', background:'#f5f5f5', cursor: disabled ? 'default' : 'pointer', fontSize:13, color:'var(--berry)', opacity: disabled ? 0.4 : 1, display:'flex', alignItems:'center', justifyContent:'center', padding:0 });

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <h3 style={{margin:0}}><i className="fa-solid fa-file-invoice" style={{marginRight:8,color:'var(--berry)'}}></i>Fiche de Stock</h3>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                            <button onClick={gotoPrev} disabled={navDisabled} title="Article précédent" style={arrowStyle(navDisabled)}>◀</button>
                            {selectedArticle && curIdx >= 0 && <span style={{fontSize:12,color:'#888',minWidth:48,textAlign:'center'}}>{curIdx + 1}/{articles.length}</span>}
                            <button onClick={gotoNext} disabled={navDisabled} title="Article suivant" style={arrowStyle(navDisabled)}>▶</button>
                            <input list="fiche-stock-articles" value={selectedArticle} onChange={e => setSelectedArticle(e.target.value)}
                                placeholder={loadingArticles ? 'Chargement...' : 'Choisir un article...'}
                                disabled={loadingArticles}
                                style={{padding:'6px 14px',borderRadius:8,border:'1px solid #ddd',fontSize:12,width:280}} />
                            <datalist id="fiche-stock-articles">
                                {articles.map(a => <option key={a.ref} value={a.ref}>{a.label}</option>)}
                            </datalist>
                            {selectedArticle && <button onClick={() => setSelectedArticle('')} style={{padding:'6px 10px',borderRadius:8,border:'1px solid #ddd',fontSize:11,cursor:'pointer',background:'#f5f5f5'}}>Effacer</button>}
                        </div>
                    </div>

                    {!selectedArticle && (
                        <div style={{textAlign:'center',padding:48,color:'#999'}}>
                            <i className="fa-solid fa-file-invoice" style={{fontSize:40,opacity:0.3,marginBottom:12,display:'block'}}></i>
                            Sélectionnez un article pour consulter son grand livre de stock.
                        </div>
                    )}

                    {selectedArticle && loadingHistory && (
                        <div style={{textAlign:'center',padding:60}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:32,color:'var(--berry)'}}></i></div>
                    )}

                    {selectedArticle && !loadingHistory && (
                        <React.Fragment>
                            <div style={{marginBottom:16}}>
                                <div style={{fontWeight:700,fontSize:16,marginBottom:8}}>{articleInfo ? (articleInfo.nom || articleInfo.ref) : selectedArticle}</div>
                                <div style={{display:'inline-flex',alignItems:'center',gap:8,padding:'10px 18px',borderRadius:10,background:'rgba(139,34,82,0.08)',border:'1px solid rgba(139,34,82,0.2)',marginBottom:10}}>
                                    <i className="fa-solid fa-warehouse" style={{color:'var(--berry)'}}></i>
                                    <span style={{fontSize:13,color:'#555',fontWeight:600}}>Stock global :</span>
                                    <span style={{fontSize:20,fontWeight:800,color: soldeGlobal > 0 ? 'var(--green,#27ae60)' : soldeGlobal < 0 ? 'var(--red)' : 'var(--berry)'}}>{fmt(soldeGlobal)} {articleInfo ? articleInfo.unite : ''}</span>
                                </div>
                                <div style={{fontSize:11,color:'#888',fontWeight:600,marginBottom:4}}>Détail par magasin</div>
                                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                                    {soldes.length === 0 && <span style={{color:'#999',fontSize:12}}>Aucun solde.</span>}
                                    {soldes.map((s, i) => (
                                        <span key={i} className="status-badge" style={{background: s.balance > 0 ? 'rgba(46,204,113,0.12)' : 'rgba(231,76,60,0.12)', color: s.balance > 0 ? 'var(--green,#27ae60)' : 'var(--red)', fontSize:12, fontWeight:700}}>
                                            {s.lieu_id} : {fmt(s.balance)} {articleInfo ? articleInfo.unite : ''}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {lieuxPresents.length > 1 && (
                                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12,alignItems:'center'}}>
                                    <button onClick={() => setFilterLieu('')} style={{padding:'4px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:11,cursor:'pointer',background: filterLieu === '' ? 'var(--berry)' : '#f5f5f5', color: filterLieu === '' ? '#fff' : '#333'}}>Tous</button>
                                    {lieuxPresents.map(l => (
                                        <button key={l} onClick={() => setFilterLieu(l)} style={{padding:'4px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:11,cursor:'pointer',background: filterLieu === l ? 'var(--berry)' : '#f5f5f5', color: filterLieu === l ? '#fff' : '#333'}}>{l}</button>
                                    ))}
                                </div>
                            )}

                            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12,alignItems:'center'}}>
                                <span style={{fontSize:11,color:'#888'}}>Du</span>
                                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{padding:'4px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:11}} />
                                <span style={{fontSize:11,color:'#888'}}>Au</span>
                                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{padding:'4px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:11}} />
                                <input type="text" value={filterNum} onChange={e => setFilterNum(e.target.value)} placeholder="N° bon…" style={{padding:'4px 10px',borderRadius:8,border:'1px solid #ddd',fontSize:11,width:120}} />
                                <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{padding:'4px 10px',borderRadius:8,border:'1px solid #ddd',fontSize:11}}>
                                    <option value="">Tous types</option>
                                    {['reception','sortie','consommation','transfert','inventaire'].map(t => (
                                        <option key={t} value={t}>{typeLabel(t)}</option>
                                    ))}
                                </select>
                                <button onClick={() => setOnlyNegCumul(v => !v)} style={{padding:'4px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:11,cursor:'pointer',background: onlyNegCumul ? 'var(--berry)' : '#f5f5f5', color: onlyNegCumul ? '#fff' : '#333'}}>Cumul négatif</button>
                            </div>

                            {visibleEntries.length === 0 && (
                                <div style={{textAlign:'center',padding:32,color:'#999'}}>{anyFilterActive ? 'Aucun mouvement pour ces filtres.' : 'Aucun mouvement pour cet article.'}</div>
                            )}

                            {visibleEntries.length > 0 && (
                                <div className="table-responsive"><table className="data-table">
                                    <thead><tr><th>Date</th><th>N°</th><th>Type</th><th>Lieu</th><th>Sens</th><th style={{textAlign:'right'}}>Quantité</th><th style={{textAlign:'right'}}>Cumul lieu</th><th style={{textAlign:'right'}}>Cumul global</th></tr></thead>
                                    <tbody>
                                        {visibleEntries.map((e, i) => (
                                            <tr key={i} onClick={() => { const mv = movementsMap[e.movementId]; if (mv) setDetailMov(mv); }} style={{cursor:'pointer'}} onMouseEnter={ev => { ev.currentTarget.style.background = 'rgba(139,34,82,0.04)'; }} onMouseLeave={ev => { ev.currentTarget.style.background = ''; }}>
                                                <td style={{fontSize:11}}>{e.date}</td>
                                                <td style={{fontSize:11}}>{e.numero}</td>
                                                <td style={{fontSize:11}}>{typeLabel(e.type)}</td>
                                                <td><span className="status-badge" style={{background:'rgba(139,34,82,0.1)',color:'var(--berry)',fontSize:10}}>{e.lieu_id}</span></td>
                                                <td style={{fontSize:11,fontWeight:600,color: e.sens === 'entree' ? 'var(--green,#27ae60)' : 'var(--red)'}}>{e.sens === 'entree' ? 'Entrée' : 'Sortie'}</td>
                                                <td style={{textAlign:'right',fontWeight:700,color: e.quantite >= 0 ? 'var(--green,#27ae60)' : 'var(--red)'}}>{e.quantite >= 0 ? '+' : ''}{fmt(e.quantite)} {e.unite}</td>
                                                <td style={{textAlign:'right',fontWeight:700}}>{fmt(e.cumul_apres)} {e.unite}</td>
                                                <td style={{textAlign:'right',fontWeight:700,color:'var(--berry)'}}>{fmt(e.cumul_global_apres)} {e.unite}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    {visibleEntries.length > 0 && (() => {
                                        const net = visibleEntries.reduce((s, e) => s + (Number(e.quantite) || 0), 0);
                                        const totIn = visibleEntries.reduce((s, e) => { const q = Number(e.quantite) || 0; return q > 0 ? s + q : s; }, 0);
                                        const totOut = visibleEntries.reduce((s, e) => { const q = Number(e.quantite) || 0; return q < 0 ? s + (-q) : s; }, 0);
                                        const last = visibleEntries[visibleEntries.length - 1];
                                        const u = last.unite;
                                        return (
                                            <tfoot>
                                                <tr style={{background:'rgba(139,34,82,0.06)',fontWeight:700,borderTop:'2px solid rgba(139,34,82,0.25)'}}>
                                                    <td colSpan={4} style={{fontSize:12,fontWeight:700}}>TOTAL ({visibleEntries.length} mouvement{visibleEntries.length > 1 ? 's' : ''})</td>
                                                    <td></td>
                                                    <td style={{textAlign:'right'}}>
                                                        <div style={{fontWeight:700,color: net >= 0 ? 'var(--green,#27ae60)' : 'var(--red)'}}>{net >= 0 ? '+' : ''}{fmt(net)} {u}</div>
                                                        <div style={{fontSize:10,fontWeight:400,color:'#999'}}>Entrées +{fmt(totIn)} · Sorties −{fmt(totOut)}</div>
                                                    </td>
                                                    <td style={{textAlign:'right',fontWeight:700}}>{fmt(last.cumul_apres)} {u}</td>
                                                    <td style={{textAlign:'right',fontWeight:700,color:'var(--berry)'}}>{fmt(last.cumul_global_apres)} {u}</td>
                                                </tr>
                                            </tfoot>
                                        );
                                    })()}
                                </table></div>
                            )}
                        </React.Fragment>
                    )}

                    {detailMov && (() => {
                        const m = detailMov;
                        const fmtTs = (v) => {
                            if (!v) return null;
                            try {
                                if (typeof v === 'string') return v.length > 10 ? new Date(v).toLocaleString('fr-FR') : v;
                                if (v.seconds != null) return new Date(v.seconds * 1000).toLocaleString('fr-FR');
                                if (v._seconds != null) return new Date(v._seconds * 1000).toLocaleString('fr-FR');
                                if (v instanceof Date) return v.toLocaleString('fr-FR');
                            } catch (e) { return null; }
                            return null;
                        };
                        const items = m.items || [];
                        const hasParcelle = items.some(i => i.parcelle != null && i.parcelle !== '');
                        const hasPrix = items.some(i => i.prix_unitaire != null);
                        const hasMontant = items.some(i => i.montant_ttc != null);
                        const totalTtc = items.reduce((s, i) => s + (typeof i.montant_ttc === 'number' ? i.montant_ttc : 0), 0);
                        const valEntries = m.validations && typeof m.validations === 'object' ? Object.entries(m.validations) : [];
                        const scan = m.scan_url || '';
                        const isHttpScan = /^https?:\/\//i.test(scan);
                        const isImgScan = isHttpScan && /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(scan);
                        const lieuLabel = (l) => l == null ? null : (typeof l === 'string' ? l : (l.id || null));
                        const infoRow = (label, value) => value == null || value === '' ? null : (
                            <div style={{display:'flex',gap:8,padding:'3px 0'}}>
                                <span style={{minWidth:140,color:'var(--gray-400)',fontSize:12}}>{label}</span>
                                <span style={{fontSize:12,fontWeight:600,color:'#1e293b'}}>{value}</span>
                            </div>
                        );
                        return (
                            <div onClick={() => setDetailMov(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(2px)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
                                <div onClick={e => e.stopPropagation()} style={{background:'#fff',borderRadius:12,maxWidth:640,width:'100%',maxHeight:'85vh',overflow:'auto',padding:24,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,gap:12}}>
                                        <h3 style={{margin:0,color:'var(--berry)'}}><i className="fa-solid fa-clock-rotate-left" style={{marginRight:8}}></i>{typeLabel(m.type)} {m.numero || ''}</h3>
                                        <button onClick={() => setDetailMov(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:20,color:'var(--gray-400)',lineHeight:1}} title="Fermer">✕</button>
                                    </div>

                                    <div style={{marginBottom:16}}>
                                        {infoRow('Type', typeLabel(m.type))}
                                        {infoRow('Date', m.date)}
                                        {infoRow('Source', lieuLabel(m.lieu_source))}
                                        {infoRow('Destination', lieuLabel(m.lieu_destination))}
                                        {infoRow('Réf BL fournisseur', m.ref_bl_fournisseur)}
                                        {infoRow('Fournisseur', m.fournisseur_nom)}
                                        {infoRow('Type de sortie', m.sortie_type)}
                                        {infoRow('Bénéficiaire', m.beneficiaire)}
                                        {infoRow('Motif', m.motif_rebut)}
                                        {infoRow('Créé par', m.created_by?.name)}
                                        {infoRow('Créé le', fmtTs(m.created_at))}
                                    </div>

                                    {items.length > 0 && (
                                        <div style={{marginBottom:16}}>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Articles</h4>
                                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                                <thead><tr style={{background:'#f8f8f8',textAlign:'left'}}>
                                                    <th style={{padding:'6px 8px'}}>Article</th>
                                                    <th style={{padding:'6px 8px',textAlign:'right'}}>Quantité</th>
                                                    <th style={{padding:'6px 8px'}}>Unité</th>
                                                    {hasParcelle && <th style={{padding:'6px 8px'}}>Parcelle</th>}
                                                    {hasPrix && <th style={{padding:'6px 8px',textAlign:'right'}}>Prix unit.</th>}
                                                    {hasMontant && <th style={{padding:'6px 8px',textAlign:'right'}}>Montant TTC</th>}
                                                </tr></thead>
                                                <tbody>
                                                    {items.map((i, idx) => (
                                                        <tr key={idx} style={{borderBottom:'1px solid #f0f0f0'}}>
                                                            <td style={{padding:'6px 8px'}}>{i.article_nom || i.article_ref || '—'}</td>
                                                            <td style={{padding:'6px 8px',textAlign:'right'}}>{i.quantite != null ? i.quantite : '—'}</td>
                                                            <td style={{padding:'6px 8px'}}>{i.unite || '—'}</td>
                                                            {hasParcelle && <td style={{padding:'6px 8px'}}>{i.parcelle || '—'}</td>}
                                                            {hasPrix && <td style={{padding:'6px 8px',textAlign:'right'}}>{i.prix_unitaire != null ? i.prix_unitaire : '—'}</td>}
                                                            {hasMontant && <td style={{padding:'6px 8px',textAlign:'right'}}>{i.montant_ttc != null ? i.montant_ttc : '—'}</td>}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                                {hasMontant && (
                                                    <tfoot><tr style={{fontWeight:700}}>
                                                        <td style={{padding:'6px 8px'}} colSpan={(hasParcelle ? 1 : 0) + (hasPrix ? 1 : 0) + 3}>Total</td>
                                                        <td style={{padding:'6px 8px',textAlign:'right'}}>{totalTtc.toLocaleString('fr-FR')}</td>
                                                    </tr></tfoot>
                                                )}
                                            </table>
                                        </div>
                                    )}

                                    {valEntries.length > 0 && (
                                        <div style={{marginBottom:16}}>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Validations</h4>
                                            <ul style={{margin:0,paddingLeft:18,fontSize:12}}>
                                                {valEntries.map(([role, v]) => (
                                                    <li key={role} style={{padding:'2px 0'}}>
                                                        <strong>{role}</strong> : {(v && v.name) || (v && v.by) || '—'}{v && fmtTs(v.at) ? ' le ' + fmtTs(v.at) : ''}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {scan && (
                                        <div style={{marginBottom:16}}>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Scan du bon</h4>
                                            {isImgScan ? (
                                                <a href={scan} target="_blank" rel="noopener noreferrer">
                                                    <img src={scan} alt="Scan du bon" style={{maxWidth:'100%',maxHeight:280,borderRadius:8,border:'1px solid #eee',cursor:'zoom-in'}} />
                                                </a>
                                            ) : isHttpScan ? (
                                                <a href={scan} target="_blank" rel="noopener noreferrer" style={{color:'var(--blue)',fontSize:12}}><i className="fa-solid fa-paperclip" style={{marginRight:6}}></i>Voir le scan</a>
                                            ) : (
                                                <span style={{fontSize:12,color:'var(--gray-400)'}}><i className="fa-solid fa-paperclip" style={{marginRight:6}}></i>Scan disponible (stockage interne)</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            );
        }

export { MagFicheStockTab };
