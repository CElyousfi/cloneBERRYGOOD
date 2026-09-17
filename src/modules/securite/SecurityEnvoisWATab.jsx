/* Module: securite | Déclaration(s): SecurityEnvoisWATab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ─── Registres reçus par WhatsApp (lecture seule) ────────────────────
        function SecurityEnvoisWATab({ farmFilter }) {
            const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
            const [items, setItems] = useState([]);
            const [loading, setLoading] = useState(true);
            const [viewItem, setViewItem] = useState(null);

            const load = React.useCallback(async () => {
                setLoading(true);
                try {
                    let q = firebase.firestore().collection('security_envois_registre');
                    if (farmFilter) q = q.where('ferme', '==', farmFilter);
                    q = q.where('date', '==', date).orderBy('createdAt', 'desc');
                    const snap = await q.get();
                    setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                } catch (e) { console.error('Erreur chargement envois WA:', e); }
                setLoading(false);
            }, [farmFilter, date]);
            useEffect(() => { load(); }, [load]);

            const inputStyle = { padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd', fontSize: 15 };

            return React.createElement('div', { style: { padding: 16, maxWidth: 900, margin: '0 auto' } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, padding: '16px 20px', background: 'linear-gradient(135deg, #1a237e 0%, #3f51b5 100%)', borderRadius: 16, color: '#fff' } },
                    React.createElement('i', { className: 'fa-brands fa-whatsapp', style: { fontSize: 36 } }),
                    React.createElement('div', null,
                        React.createElement('h2', { style: { margin: 0, fontSize: '1.2rem', fontWeight: 700 } }, 'Registres reçus par WhatsApp'),
                        React.createElement('div', { style: { opacity: 0.85, fontSize: '0.9rem', marginTop: 2 } }, 'Envois des agents BSNL — Ferme ', farmFilter)
                    )
                ),
                React.createElement('div', { style: { marginBottom: 16 } },
                    React.createElement('input', { type: 'date', value: date, onChange: e => setDate(e.target.value), style: inputStyle })
                ),
                loading && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: '#888' } },
                    React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 24 } })
                ),
                !loading && items.length === 0 && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: '#999', background: '#fafafa', borderRadius: 12 } },
                    React.createElement('i', { className: 'fa-solid fa-inbox', style: { fontSize: 32, marginBottom: 8, display: 'block' } }),
                    'Aucun registre reçu pour cette date'
                ),
                !loading && items.length > 0 && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 } },
                    items.map(it => React.createElement('div', { key: it.id, onClick: () => setViewItem(it), style: { background: '#fff', borderRadius: 12, border: '1px solid #e0e0e0', overflow: 'hidden', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } },
                        it.scan_url && React.createElement('div', { style: { aspectRatio: '3/4', overflow: 'hidden', background: '#f5f5f5' } },
                            React.createElement('img', { src: it.scan_url, alt: 'Registre', style: { width: '100%', height: '100%', objectFit: 'cover' }, loading: 'lazy' })
                        ),
                        React.createElement('div', { style: { padding: '8px 10px' } },
                            React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: '#333' } }, (it.ocr && it.ocr.lignes ? it.ocr.lignes.length : 0), ' visiteur(s)'),
                            React.createElement('div', { style: { fontSize: 11, color: '#888', marginTop: 2 } }, it.agent_name || it.agent_phone || '?'),
                            React.createElement('div', { style: { fontSize: 11, color: '#aaa' } }, new Date(it.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
                        )
                    ))
                ),
                viewItem && React.createElement('div', { onClick: () => setViewItem(null), style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', padding: 16, overflow: 'auto' } },
                    React.createElement('div', { onClick: e => e.stopPropagation(), style: { background: '#fff', borderRadius: 12, padding: 16, maxWidth: 900, margin: 'auto', width: '100%', maxHeight: '95vh', overflow: 'auto' } },
                        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
                            React.createElement('h3', { style: { margin: 0, color: '#1a237e' } }, 'Registre du ', viewItem.date),
                            React.createElement('button', { onClick: () => setViewItem(null), style: { background: '#f5f5f5', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' } }, 'Fermer')
                        ),
                        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
                            React.createElement('div', null,
                                viewItem.scan_url && React.createElement('img', { src: viewItem.scan_url, alt: 'Scan', style: { width: '100%', borderRadius: 8 } })
                            ),
                            React.createElement('div', null,
                                React.createElement('div', { style: { fontSize: 13, color: '#666', marginBottom: 8 } },
                                    React.createElement('strong', null, 'Envoyé par : '), viewItem.agent_name || viewItem.agent_phone
                                ),
                                React.createElement('table', { style: { width: '100%', fontSize: 12, borderCollapse: 'collapse' } },
                                    React.createElement('thead', null,
                                        React.createElement('tr', { style: { background: '#f5f7ff' } },
                                            ['Nom', 'Entreprise', 'Arrivée', 'Départ', 'Motif'].map(h => React.createElement('th', { key: h, style: { padding: 6, textAlign: 'left', borderBottom: '1px solid #ddd' } }, h))
                                        )
                                    ),
                                    React.createElement('tbody', null,
                                        ((viewItem.ocr && viewItem.ocr.lignes) || []).map((l, i) => React.createElement('tr', { key: i, style: { borderBottom: '1px solid #f0f0f0' } },
                                            React.createElement('td', { style: { padding: 6 } }, l.nom || '—'),
                                            React.createElement('td', { style: { padding: 6 } }, l.entreprise || '—'),
                                            React.createElement('td', { style: { padding: 6 } }, l.heure_arrivee || '—'),
                                            React.createElement('td', { style: { padding: 6 } }, l.heure_depart || '—'),
                                            React.createElement('td', { style: { padding: 6 } }, l.motif || '—')
                                        ))
                                    )
                                )
                            )
                        )
                    )
                )
            );
        }

export { SecurityEnvoisWATab };
