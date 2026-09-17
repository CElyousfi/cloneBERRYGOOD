/* Module: securite | Déclaration(s): SecurityIncidentsTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ─── Incidents Sécurité reçus par WhatsApp (lecture seule) ───────────
        function SecurityIncidentsTab({ farmFilter }) {
            const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
            const [items, setItems] = useState([]);
            const [loading, setLoading] = useState(true);
            const [viewItem, setViewItem] = useState(null);

            const load = React.useCallback(async () => {
                setLoading(true);
                try {
                    let q = firebase.firestore().collection('security_incidents');
                    if (farmFilter) q = q.where('ferme', '==', farmFilter);
                    q = q.where('date', '==', date).orderBy('createdAt', 'desc');
                    const snap = await q.get();
                    setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                } catch (e) { console.error('Erreur chargement incidents:', e); }
                setLoading(false);
            }, [farmFilter, date]);
            useEffect(() => { load(); }, [load]);

            return React.createElement('div', { style: { padding: 16, maxWidth: 900, margin: '0 auto' } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, padding: '16px 20px', background: 'linear-gradient(135deg, #b71c1c 0%, #e53935 100%)', borderRadius: 16, color: '#fff' } },
                    React.createElement('i', { className: 'fa-solid fa-triangle-exclamation', style: { fontSize: 32 } }),
                    React.createElement('div', null,
                        React.createElement('h2', { style: { margin: 0, fontSize: '1.2rem', fontWeight: 700 } }, 'Incidents Sécurité'),
                        React.createElement('div', { style: { opacity: 0.85, fontSize: '0.9rem', marginTop: 2 } }, 'Signalements WhatsApp — Ferme ', farmFilter)
                    )
                ),
                React.createElement('div', { style: { marginBottom: 16 } },
                    React.createElement('input', { type: 'date', value: date, onChange: e => setDate(e.target.value), style: { padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd', fontSize: 15 } })
                ),
                loading && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: '#888' } },
                    React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 24 } })
                ),
                !loading && items.length === 0 && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: '#999', background: '#fafafa', borderRadius: 12 } },
                    React.createElement('i', { className: 'fa-solid fa-shield-halved', style: { fontSize: 32, marginBottom: 8, display: 'block', color: '#4caf50' } }),
                    'Aucun incident signalé pour cette date'
                ),
                !loading && items.length > 0 && React.createElement('div', { style: { display: 'grid', gap: 12 } },
                    items.map(it => {
                        const emp = it.badge_ocr ? [it.badge_ocr.prenom, it.badge_ocr.nom].filter(Boolean).join(' ') : null;
                        return React.createElement('div', { key: it.id, onClick: () => setViewItem(it), style: { background: '#fff', borderRadius: 12, border: '1px solid #ffcdd2', padding: 12, cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center' } },
                            it.incident_url && React.createElement('img', { src: it.incident_url, alt: 'Incident', style: { width: 80, height: 80, objectFit: 'cover', borderRadius: 8 }, loading: 'lazy' }),
                            React.createElement('div', { style: { flex: 1 } },
                                React.createElement('div', { style: { fontWeight: 600, color: '#b71c1c' } }, emp || 'Employé non identifié', it.badge_ocr?.matricule ? ' — mat. ' + it.badge_ocr.matricule : ''),
                                React.createElement('div', { style: { fontSize: 13, color: '#555', marginTop: 4 } }, it.description || React.createElement('em', { style: { color: '#aaa' } }, 'pas de description')),
                                React.createElement('div', { style: { fontSize: 11, color: '#999', marginTop: 4 } }, 'Signalé par ', it.agent_name || it.agent_phone, ' — ', new Date(it.createdAt).toLocaleString('fr-FR'))
                            )
                        );
                    })
                ),
                viewItem && React.createElement('div', { onClick: () => setViewItem(null), style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', padding: 16, overflow: 'auto' } },
                    React.createElement('div', { onClick: e => e.stopPropagation(), style: { background: '#fff', borderRadius: 12, padding: 16, maxWidth: 800, margin: 'auto', width: '100%', maxHeight: '95vh', overflow: 'auto' } },
                        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
                            React.createElement('h3', { style: { margin: 0, color: '#b71c1c' } }, 'Incident du ', viewItem.date),
                            React.createElement('button', { onClick: () => setViewItem(null), style: { background: '#f5f5f5', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' } }, 'Fermer')
                        ),
                        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 } },
                            React.createElement('div', null,
                                React.createElement('div', { style: { fontSize: 12, color: '#666', marginBottom: 4 } }, 'Badge employé'),
                                viewItem.badge_url && React.createElement('img', { src: viewItem.badge_url, alt: 'Badge', style: { width: '100%', borderRadius: 8 } })
                            ),
                            React.createElement('div', null,
                                React.createElement('div', { style: { fontSize: 12, color: '#666', marginBottom: 4 } }, 'Incident'),
                                viewItem.incident_url && React.createElement('img', { src: viewItem.incident_url, alt: 'Incident', style: { width: '100%', borderRadius: 8 } })
                            )
                        ),
                        viewItem.badge_ocr && React.createElement('div', { style: { background: '#fafafa', padding: 12, borderRadius: 8, marginBottom: 12 } },
                            React.createElement('div', { style: { fontSize: 12, color: '#666', marginBottom: 4 } }, 'Identification automatique :'),
                            React.createElement('div', null, React.createElement('strong', null, 'Matricule : '), viewItem.badge_ocr.matricule || '—'),
                            React.createElement('div', null, React.createElement('strong', null, 'Nom : '), [viewItem.badge_ocr.prenom, viewItem.badge_ocr.nom].filter(Boolean).join(' ') || '—'),
                            React.createElement('div', null, React.createElement('strong', null, 'Fonction : '), viewItem.badge_ocr.fonction || '—')
                        ),
                        viewItem.description && React.createElement('div', { style: { marginBottom: 12 } },
                            React.createElement('div', { style: { fontSize: 12, color: '#666', marginBottom: 4 } }, 'Description :'),
                            React.createElement('div', { style: { background: '#fff3e0', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap' } }, viewItem.description)
                        ),
                        React.createElement('div', { style: { fontSize: 12, color: '#999', borderTop: '1px solid #eee', paddingTop: 8 } },
                            'Signalé par ', viewItem.agent_name || viewItem.agent_phone, ' le ', new Date(viewItem.createdAt).toLocaleString('fr-FR')
                        )
                    )
                )
            );
        }

export { SecurityIncidentsTab };
