/* Module: magasin | Déclaration(s): InventairePrixView */
import { useEffect, useRef, useState } from '../shared/reactHooks.jsx';

function InventairePrixView() {
            const [articles, setArticles] = useState([]);
            const [selectedArticle, setSelectedArticle] = useState('');
            const [history, setHistory] = useState([]);
            const [loading, setLoading] = useState(false);
            const [dateFrom, setDateFrom] = useState('');
            const [dateTo, setDateTo] = useState('');
            const canvasRef = useRef(null);

            useEffect(() => {
                fetch('/api/stock?action=list-articles').then(r => r.json())
                    .then(j => { if (j.success) { const seen = new Set(); setArticles((j.articles||[]).filter(a => { if(seen.has(a.nom)) return false; seen.add(a.nom); return true; })); } })
                    .catch(() => {});
            }, []);

            useEffect(() => {
                if (!selectedArticle) { setHistory([]); return; }
                setLoading(true);
                let url = `/api/stock?action=get-price-history&article=${encodeURIComponent(selectedArticle)}`;
                if (dateFrom) url += `&date_from=${dateFrom}`;
                if (dateTo) url += `&date_to=${dateTo}`;
                fetch(url).then(r => r.json())
                    .then(json => { if (json.success) setHistory(json.history || []); })
                    .catch(err => console.warn(err))
                    .finally(() => setLoading(false));
            }, [selectedArticle, dateFrom, dateTo]);

            useEffect(() => {
                if (!canvasRef.current || history.length < 2) return;
                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d');
                const W = canvas.width = canvas.parentElement.offsetWidth;
                const H = canvas.height = 220;
                ctx.clearRect(0, 0, W, H);

                const prices = history.map(h => h.prix_unitaire);
                const minP = Math.min(...prices) * 0.9;
                const maxP = Math.max(...prices) * 1.1;
                const rangeP = maxP - minP || 1;
                const pad = { top: 20, bottom: 30, left: 60, right: 20 };
                const chartW = W - pad.left - pad.right;
                const chartH = H - pad.top - pad.bottom;

                ctx.strokeStyle = '#eee'; ctx.lineWidth = 1;
                for (let i = 0; i <= 4; i++) {
                    const y = pad.top + (chartH * i / 4);
                    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
                    ctx.fillStyle = '#999'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
                    ctx.fillText((maxP - (rangeP * i / 4)).toFixed(2), pad.left - 6, y + 3);
                }

                ctx.strokeStyle = '#8b2252'; ctx.lineWidth = 2;
                ctx.beginPath();
                history.forEach((h, i) => {
                    const x = pad.left + (chartW * i / (history.length - 1));
                    const y = pad.top + chartH - ((h.prix_unitaire - minP) / rangeP) * chartH;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                });
                ctx.stroke();

                ctx.fillStyle = '#8b2252';
                history.forEach((h, i) => {
                    const x = pad.left + (chartW * i / (history.length - 1));
                    const y = pad.top + chartH - ((h.prix_unitaire - minP) / rangeP) * chartH;
                    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
                });

                ctx.fillStyle = '#999'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
                const step = Math.max(1, Math.floor(history.length / 6));
                history.forEach((h, i) => {
                    if (i % step === 0 || i === history.length - 1) {
                        const x = pad.left + (chartW * i / (history.length - 1));
                        ctx.fillText(h.date.slice(5), x, H - 8);
                    }
                });
            }, [history]);

            const prixMin = history.length ? Math.min(...history.map(h => h.prix_unitaire)) : 0;
            const prixMax = history.length ? Math.max(...history.map(h => h.prix_unitaire)) : 0;
            const prixMoy = history.length ? (history.reduce((s, h) => s + h.prix_unitaire, 0) / history.length) : 0;
            const dernierPrix = history.length ? history[history.length - 1].prix_unitaire : 0;
            const variation = history.length > 1 ? ((dernierPrix - history[0].prix_unitaire) / history[0].prix_unitaire * 100) : 0;

            return (
                <div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <h3 style={{margin:0}}><i className="fa-solid fa-chart-line" style={{marginRight:8,color:'var(--berry)'}}></i>Évolution des Prix</h3>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                            <input list="prix-articles-list" value={selectedArticle} onChange={e => setSelectedArticle(e.target.value)}
                                placeholder="Sélectionner un article..." style={{padding:'6px 14px',borderRadius:8,border:'1px solid #ddd',fontSize:12,width:250}} />
                            <datalist id="prix-articles-list">{articles.map(a => <option key={a.id} value={a.nom} />)}</datalist>
                            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Date début"
                                style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}} />
                            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="Date fin"
                                style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}} />
                        </div>
                    </div>

                    {loading && <div style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:24,color:'var(--berry)'}}></i></div>}

                    {!loading && selectedArticle && history.length > 0 && (
                        <div>
                            <div className="kpi-grid" style={{gridTemplateColumns:'repeat(5, 1fr)',marginBottom:16}}>
                                <div className="kpi-card"><div className="kpi-icon green"><i className="fa-solid fa-arrow-down"></i></div><div className="kpi-value">{prixMin.toFixed(2)}</div><div className="kpi-label">Prix Min (DH)</div></div>
                                <div className="kpi-card"><div className="kpi-icon" style={{background:'rgba(231,76,60,0.12)',color:'var(--red)'}}><i className="fa-solid fa-arrow-up"></i></div><div className="kpi-value">{prixMax.toFixed(2)}</div><div className="kpi-label">Prix Max (DH)</div></div>
                                <div className="kpi-card"><div className="kpi-icon" style={{background:'rgba(52,152,219,0.12)',color:'var(--blue)'}}><i className="fa-solid fa-equals"></i></div><div className="kpi-value">{prixMoy.toFixed(2)}</div><div className="kpi-label">Prix Moyen (DH)</div></div>
                                <div className="kpi-card"><div className="kpi-icon" style={{background:'rgba(139,34,82,0.12)',color:'var(--berry)'}}><i className="fa-solid fa-tag"></i></div><div className="kpi-value">{dernierPrix.toFixed(2)}</div><div className="kpi-label">Dernier Prix (DH)</div></div>
                                <div className="kpi-card"><div className="kpi-icon" style={{background: variation >= 0 ? 'rgba(231,76,60,0.12)' : 'rgba(46,204,113,0.12)',color: variation >= 0 ? 'var(--red)' : 'var(--green)'}}><i className={`fa-solid ${variation >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}`}></i></div><div className="kpi-value">{variation >= 0 ? '+' : ''}{variation.toFixed(1)}%</div><div className="kpi-label">Variation</div></div>
                            </div>

                            <div style={{background:'#fff',borderRadius:12,padding:16,marginBottom:16,border:'1px solid #eee'}}>
                                <canvas ref={canvasRef} style={{width:'100%',height:220}}></canvas>
                            </div>

                            <div className="table-responsive"><table className="data-table" style={{fontSize:12}}>
                                <thead><tr><th>Date</th><th>Prix Unitaire (DH)</th><th>Quantité</th><th>Unité</th><th>Fournisseur</th><th>N° BDC</th><th>N° BR</th></tr></thead>
                                <tbody>
                                    {history.map((h, i) => (
                                        <tr key={i}>
                                            <td>{new Date(h.date+'T12:00').toLocaleDateString('fr-FR')}</td>
                                            <td style={{fontWeight:700,color:'var(--berry)'}}>{h.prix_unitaire.toFixed(2)}</td>
                                            <td>{h.quantite}</td>
                                            <td>{h.unite}</td>
                                            <td>{h.fournisseur || '—'}</td>
                                            <td>{h.bdc_numero || '—'}</td>
                                            <td>{h.numero || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table></div>
                        </div>
                    )}

                    {!loading && selectedArticle && history.length === 0 && (
                        <div style={{textAlign:'center',padding:60,color:'var(--gray-400)'}}>
                            <i className="fa-solid fa-chart-line" style={{fontSize:40,marginBottom:12,opacity:0.3}}></i>
                            <p>Aucun historique de prix trouvé pour cet article.</p>
                            <p style={{fontSize:11}}>Les prix sont extraits des bons de commande liés aux réceptions validées.</p>
                        </div>
                    )}

                    {!loading && !selectedArticle && (
                        <div style={{textAlign:'center',padding:60,color:'var(--gray-400)'}}>
                            <i className="fa-solid fa-search" style={{fontSize:40,marginBottom:12,opacity:0.3}}></i>
                            <p>Sélectionnez un article pour voir l'évolution de son prix d'achat.</p>
                        </div>
                    )}
                </div>
            );
        }

export { InventairePrixView };
