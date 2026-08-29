/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: achats | Déclaration(s): AchatsReceptionsValoriserTab */


// ===================== ACHATS: RÉCEPTIONS À VALORISER =====================
        function AchatsReceptionsValoriserTab({ currentProfile, profileData }) {
            const { useState, useEffect } = React;
            const [receptions, setReceptions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [prices, setPrices] = useState({}); // { movId: { itemIdx: prixString } }
            const [submitting, setSubmitting] = useState(null); // movId en cours

            const loadData = () => {
                setLoading(true);
                fetch('/api/stock?action=list-movements&status=en_attente_achats&limit=300')
                    .then(r => r.json())
                    .then(json => {
                        const list = (json.success ? json.movements : []).filter(m => m.type === 'reception');
                        setReceptions(list);
                        // Pré-remplir les prix depuis les items (BDC) si présents
                        const init = {};
                        list.forEach(m => {
                            init[m.id] = {};
                            (m.items || []).forEach((it, idx) => {
                                const p = it.prix_unitaire;
                                init[m.id][idx] = (p !== undefined && p !== null && p !== '') ? String(p) : '';
                            });
                        });
                        setPrices(init);
                    })
                    .catch(() => setReceptions([]))
                    .finally(() => setLoading(false));
            };
            useEffect(() => { loadData(); }, []);

            const setPrice = (movId, idx, value) => {
                setPrices(prev => ({ ...prev, [movId]: { ...(prev[movId] || {}), [idx]: value } }));
            };

            const handleValidate = (mov) => {
                const movPrices = prices[mov.id] || {};
                const items = (mov.items || []).map((it, idx) => ({
                    article_ref: it.article_ref || '',
                    article_nom: it.article_nom || '',
                    prix_unitaire: movPrices[idx],
                }));
                // Validation client : chaque prix numérique >= 0
                for (let i = 0; i < items.length; i++) {
                    const raw = items[i].prix_unitaire;
                    const n = parseFloat(raw);
                    if (raw === '' || raw === undefined || raw === null || !Number.isFinite(n) || n < 0) {
                        alert('Saisissez un prix unitaire valide (>= 0) pour : ' + (items[i].article_nom || items[i].article_ref || ('article #' + (i + 1))));
                        return;
                    }
                }
                if (!window.confirm('Valider et valoriser la réception ' + (mov.numero || '') + ' ? L\'impact stock sera appliqué.')) return;
                setSubmitting(mov.id);
                fetch('/api/stock?action=validate-movement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: mov.id,
                        role: 'achats',
                        validated_by: { profileId: currentProfile, name: profileData?.name || currentProfile, userId: profileData?.userId || '' },
                        items,
                    }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { alert('Réception ' + (mov.numero || '') + ' validée et valorisée.'); loadData(); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau')).finally(() => setSubmitting(null));
            };

            if (loading) return React.createElement('div', { className: 'fade-in', style: { textAlign: 'center', padding: 60 } }, React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 32, color: 'var(--berry)' } }));

            return (
                <div className="fade-in">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                        <h3 style={{ margin: 0 }}><i className="fa-solid fa-tags" style={{ marginRight: 8, color: 'var(--berry)' }}></i>Réceptions à valoriser ({receptions.length})</h3>
                        <button onClick={loadData} style={{ padding: '8px 14px', background: '#f0f0f0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#555' }}><i className="fa-solid fa-rotate" style={{ marginRight: 6 }}></i>Actualiser</button>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--gray-400)', margin: '0 0 16px' }}>Saisissez/ajustez les prix unitaires puis validez. La validation applique l'impact stock. Les réceptions par BDC sont pré-remplies avec le prix du bon de commande.</p>
                    {receptions.length === 0 && (
                        <div style={{ textAlign: 'center', padding: 60, color: 'var(--gray-400)' }}>
                            <i className="fa-solid fa-check-double" style={{ fontSize: 48, marginBottom: 16, display: 'block' }}></i>
                            <p style={{ fontSize: 16, fontWeight: 600 }}>Aucune réception en attente de valorisation</p>
                        </div>
                    )}
                    {receptions.map(mov => (
                        <div key={mov.id} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                                <div>
                                    <strong style={{ fontSize: 15 }}>{mov.numero || '—'}</strong>
                                    <span style={{ marginLeft: 10, fontSize: 12, color: '#888' }}>{mov.date || ''}</span>
                                    {mov.reception_libre && <span style={{ marginLeft: 10, fontSize: 11, background: '#fff3cd', color: '#856404', padding: '2px 8px', borderRadius: 6 }}>Réception libre</span>}
                                    {mov.bdc_id && <span style={{ marginLeft: 10, fontSize: 11, background: '#e8f4fd', color: '#2471a3', padding: '2px 8px', borderRadius: 6 }}>BDC</span>}
                                </div>
                                <div style={{ fontSize: 12, color: '#555' }}>
                                    {mov.ferme && <span><i className="fa-solid fa-warehouse" style={{ marginRight: 4 }}></i>{mov.ferme}</span>}
                                    {mov.fournisseur_nom && <span style={{ marginLeft: 12 }}><i className="fa-solid fa-truck" style={{ marginRight: 4 }}></i>{mov.fournisseur_nom}</span>}
                                </div>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ textAlign: 'left', color: '#888', fontSize: 11 }}>
                                        <th style={{ padding: '4px 6px' }}>Article</th>
                                        <th style={{ padding: '4px 6px', textAlign: 'right' }}>Quantité</th>
                                        <th style={{ padding: '4px 6px' }}>Unité</th>
                                        <th style={{ padding: '4px 6px', width: 140 }}>Prix unitaire</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(mov.items || []).map((it, idx) => (
                                        <tr key={idx} style={{ borderTop: '1px solid #f3f3f3' }}>
                                            <td style={{ padding: '6px' }}>{it.article_nom || it.article_ref || '—'}</td>
                                            <td style={{ padding: '6px', textAlign: 'right' }}>{it.quantite}</td>
                                            <td style={{ padding: '6px' }}>{it.unite || 'kg'}</td>
                                            <td style={{ padding: '6px' }}>
                                                <input type="number" min="0" step="0.01"
                                                    value={(prices[mov.id] && prices[mov.id][idx] !== undefined) ? prices[mov.id][idx] : ''}
                                                    onChange={e => setPrice(mov.id, idx, e.target.value)}
                                                    placeholder="0.00"
                                                    style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div style={{ textAlign: 'right', marginTop: 12 }}>
                                <button onClick={() => handleValidate(mov)} disabled={submitting === mov.id}
                                    style={{ padding: '8px 18px', background: 'var(--berry)', color: '#fff', border: 'none', borderRadius: 8, cursor: submitting === mov.id ? 'wait' : 'pointer', fontSize: 13, fontWeight: 700, opacity: submitting === mov.id ? 0.6 : 1 }}>
                                    <i className="fa-solid fa-check" style={{ marginRight: 6 }}></i>{submitting === mov.id ? 'Validation…' : 'Valider + valoriser'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

export { AchatsReceptionsValoriserTab };
