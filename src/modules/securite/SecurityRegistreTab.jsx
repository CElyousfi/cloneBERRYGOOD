/* Module: securite | Déclaration(s): SecurityRegistreTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { useGeolocation } from '../technique/useGeolocation.jsx';

function SecurityRegistreTab({ farmFilter, currentProfile }) {
            const [geo, refreshGeo] = useGeolocation();
            const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
            const [mouvements, setMouvements] = useState([]);
            const [loading, setLoading] = useState(true);
            const [saving, setSaving] = useState(false);
            const [savedMsg, setSavedMsg] = useState('');
            const [showForm, setShowForm] = useState(false);
            const [form, setForm] = useState({
                type: 'entree',
                nom: '',
                cin: '',
                heure: new Date().toTimeString().slice(0, 5),
                vehicule: '',
                motif: '',
                observations: ''
            });

            const loadMouvements = React.useCallback(async () => {
                try {
                    const snap = await firebase.firestore().collection('security_mouvements')
                        .where('ferme', '==', farmFilter)
                        .where('date', '==', date)
                        .orderBy('createdAt', 'desc')
                        .get();
                    setMouvements(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                } catch (e) { console.error('Erreur chargement mouvements:', e); }
                setLoading(false);
            }, [farmFilter, date]);

            useEffect(() => { setLoading(true); loadMouvements(); }, [loadMouvements]);

            const handleSave = async () => {
                if (!form.nom.trim()) return alert('Veuillez saisir le nom');
                if (!form.heure) return alert('Veuillez saisir l\'heure');
                setSaving(true);
                try {
                    await firebase.firestore().collection('security_mouvements').add({
                        date,
                        ferme: farmFilter,
                        type: form.type,
                        nom: form.nom.trim(),
                        cin: form.cin.trim(),
                        heure: form.heure,
                        vehicule: form.vehicule.trim(),
                        motif: form.motif.trim(),
                        observations: form.observations.trim(),
                        geo: geo || null,
                        createdBy: currentProfile,
                        createdAt: Date.now()
                    });
                    refreshGeo();
                    setSavedMsg('Mouvement enregistré !');
                    setForm({ type: 'entree', nom: '', cin: '', heure: new Date().toTimeString().slice(0, 5), vehicule: '', motif: '', observations: '' });
                    setShowForm(false);
                    loadMouvements();
                    setTimeout(() => setSavedMsg(''), 3000);
                } catch (e) { alert('Erreur: ' + e.message); }
                setSaving(false);
            };

            const handleDelete = async (id) => {
                if (!confirm('Supprimer ce mouvement ?')) return;
                try {
                    await firebase.firestore().collection('security_mouvements').doc(id).delete();
                    loadMouvements();
                } catch (e) { alert('Erreur: ' + e.message); }
            };

            const entrees = mouvements.filter(m => m.type === 'entree');
            const sorties = mouvements.filter(m => m.type === 'sortie');
            const presents = entrees.length - sorties.length;

            const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd', fontSize: 15, boxSizing: 'border-box' };

            return React.createElement('div', { style: { padding: 16, maxWidth: 700, margin: '0 auto' } },
                // Header with BSNL logo
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, padding: '16px 20px', background: 'linear-gradient(135deg, #1a237e 0%, #3f51b5 100%)', borderRadius: 16, color: '#fff' } },
                    React.createElement('img', { src: '/assets/logo_bsnl.svg', alt: 'BSNL', style: { height: 56, width: 'auto', filter: 'brightness(0) invert(1)' } }),
                    React.createElement('div', null,
                        React.createElement('h2', { style: { margin: 0, fontSize: '1.3rem', fontWeight: 700 } }, 'Registre Entrées / Sorties'),
                        React.createElement('div', { style: { opacity: 0.85, fontSize: '0.9rem', marginTop: 2 } }, 'Ferme ', farmFilter, ' — BSNL Sécurité')
                    )
                ),

                // Date picker
                React.createElement('div', { style: { marginBottom: 16 } },
                    React.createElement('input', { type: 'date', value: date, onChange: e => setDate(e.target.value), style: { ...inputStyle, maxWidth: 200 } })
                ),

                // KPI cards
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 } },
                    React.createElement('div', { style: { background: '#e8f5e9', borderRadius: 12, padding: '14px 16px', textAlign: 'center' } },
                        React.createElement('div', { style: { fontSize: '1.8rem', fontWeight: 700, color: '#2e7d32' } }, entrees.length),
                        React.createElement('div', { style: { fontSize: '0.8rem', color: '#555', marginTop: 2 } }, 'Entrées')
                    ),
                    React.createElement('div', { style: { background: '#ffebee', borderRadius: 12, padding: '14px 16px', textAlign: 'center' } },
                        React.createElement('div', { style: { fontSize: '1.8rem', fontWeight: 700, color: '#c62828' } }, sorties.length),
                        React.createElement('div', { style: { fontSize: '0.8rem', color: '#555', marginTop: 2 } }, 'Sorties')
                    ),
                    React.createElement('div', { style: { background: '#e3f2fd', borderRadius: 12, padding: '14px 16px', textAlign: 'center' } },
                        React.createElement('div', { style: { fontSize: '1.8rem', fontWeight: 700, color: '#1565c0' } }, Math.max(0, presents)),
                        React.createElement('div', { style: { fontSize: '0.8rem', color: '#555', marginTop: 2 } }, 'Présents')
                    )
                ),

                // Add button
                !showForm && React.createElement('button', {
                    onClick: () => setShowForm(true),
                    style: { width: '100%', padding: '14px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: 'pointer', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }
                },
                    React.createElement('i', { className: 'fa-solid fa-plus' }),
                    'Nouveau Mouvement'
                ),

                // Saved message
                savedMsg && React.createElement('div', { style: { background: '#e8f5e9', color: '#2e7d32', padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontWeight: 600, textAlign: 'center' } },
                    React.createElement('i', { className: 'fa-solid fa-check-circle', style: { marginRight: 8 } }), savedMsg
                ),

                // Form
                showForm && React.createElement('div', { style: { background: '#fff', border: '2px solid #1a237e', borderRadius: 16, padding: 20, marginBottom: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' } },
                    React.createElement('h3', { style: { margin: '0 0 16px', fontSize: '1.1rem', color: '#1a237e' } },
                        React.createElement('i', { className: 'fa-solid fa-pen-to-square', style: { marginRight: 8 } }), 'Nouveau mouvement'
                    ),

                    // Type toggle
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 } },
                        React.createElement('button', {
                            onClick: () => setForm(f => ({ ...f, type: 'entree' })),
                            style: { padding: '12px', borderRadius: 10, border: form.type === 'entree' ? '2px solid #2e7d32' : '2px solid #ddd', background: form.type === 'entree' ? '#e8f5e9' : '#fff', color: form.type === 'entree' ? '#2e7d32' : '#888', fontWeight: 600, fontSize: 15, cursor: 'pointer' }
                        }, React.createElement('i', { className: 'fa-solid fa-arrow-right-to-bracket', style: { marginRight: 6 } }), 'Entrée'),
                        React.createElement('button', {
                            onClick: () => setForm(f => ({ ...f, type: 'sortie' })),
                            style: { padding: '12px', borderRadius: 10, border: form.type === 'sortie' ? '2px solid #c62828' : '2px solid #ddd', background: form.type === 'sortie' ? '#ffebee' : '#fff', color: form.type === 'sortie' ? '#c62828' : '#888', fontWeight: 600, fontSize: 15, cursor: 'pointer' }
                        }, React.createElement('i', { className: 'fa-solid fa-arrow-right-from-bracket', style: { marginRight: 6 } }), 'Sortie')
                    ),

                    // Nom + CIN
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 } },
                        React.createElement('div', null,
                            React.createElement('label', { style: { fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 } }, 'Nom complet *'),
                            React.createElement('input', { type: 'text', value: form.nom, onChange: e => setForm(f => ({ ...f, nom: e.target.value })), placeholder: 'Mohamed ALAMI', style: inputStyle })
                        ),
                        React.createElement('div', null,
                            React.createElement('label', { style: { fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 } }, 'CIN'),
                            React.createElement('input', { type: 'text', value: form.cin, onChange: e => setForm(f => ({ ...f, cin: e.target.value })), placeholder: 'AB123456', style: inputStyle })
                        )
                    ),

                    // Heure + Véhicule
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 } },
                        React.createElement('div', null,
                            React.createElement('label', { style: { fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 } }, 'Heure *'),
                            React.createElement('input', { type: 'time', value: form.heure, onChange: e => setForm(f => ({ ...f, heure: e.target.value })), style: inputStyle })
                        ),
                        React.createElement('div', null,
                            React.createElement('label', { style: { fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 } }, 'Véhicule'),
                            React.createElement('input', { type: 'text', value: form.vehicule, onChange: e => setForm(f => ({ ...f, vehicule: e.target.value })), placeholder: 'Camion ABC-123', style: inputStyle })
                        )
                    ),

                    // Motif
                    React.createElement('div', { style: { marginBottom: 10 } },
                        React.createElement('label', { style: { fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 } }, 'Motif'),
                        React.createElement('input', { type: 'text', value: form.motif, onChange: e => setForm(f => ({ ...f, motif: e.target.value })), placeholder: 'Livraison, Visite, Travaux...', style: inputStyle })
                    ),

                    // Observations
                    React.createElement('div', { style: { marginBottom: 16 } },
                        React.createElement('label', { style: { fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 } }, 'Observations'),
                        React.createElement('textarea', { value: form.observations, onChange: e => setForm(f => ({ ...f, observations: e.target.value })), placeholder: 'Remarques...', rows: 2, style: { ...inputStyle, resize: 'vertical' } })
                    ),

                    // Action buttons
                    React.createElement('div', { style: { display: 'flex', gap: 10 } },
                        React.createElement('button', {
                            onClick: handleSave, disabled: saving,
                            style: { flex: 1, padding: '12px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }
                        }, saving ? 'Enregistrement...' : React.createElement(React.Fragment, null, React.createElement('i', { className: 'fa-solid fa-save', style: { marginRight: 6 } }), 'Enregistrer')),
                        React.createElement('button', {
                            onClick: () => setShowForm(false),
                            style: { padding: '12px 20px', background: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: 10, fontSize: 15, cursor: 'pointer' }
                        }, 'Annuler')
                    )
                ),

                // Loading
                loading && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: '#888' } },
                    React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 24 } })
                ),

                // Movements list
                !loading && React.createElement('div', null,
                    React.createElement('h3', { style: { fontSize: '1rem', color: '#333', marginBottom: 12 } },
                        React.createElement('i', { className: 'fa-solid fa-list', style: { marginRight: 8, color: '#1a237e' } }),
                        'Mouvements du jour (', mouvements.length, ')'
                    ),
                    mouvements.length === 0 && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: '#999', background: '#fafafa', borderRadius: 12 } },
                        React.createElement('i', { className: 'fa-solid fa-inbox', style: { fontSize: 32, marginBottom: 8, display: 'block' } }),
                        'Aucun mouvement enregistré'
                    ),
                    mouvements.map(m => React.createElement('div', { key: m.id, style: { background: '#fff', borderRadius: 12, padding: '14px 16px', marginBottom: 8, border: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' } },
                        // Type badge
                        React.createElement('div', { style: { minWidth: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: m.type === 'entree' ? '#e8f5e9' : '#ffebee', color: m.type === 'entree' ? '#2e7d32' : '#c62828', fontSize: 18 } },
                            React.createElement('i', { className: m.type === 'entree' ? 'fa-solid fa-arrow-right-to-bracket' : 'fa-solid fa-arrow-right-from-bracket' })
                        ),
                        // Info
                        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                            React.createElement('div', { style: { fontWeight: 600, fontSize: 15, color: '#222' } }, m.nom),
                            React.createElement('div', { style: { fontSize: 13, color: '#777', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' } },
                                React.createElement('span', null, React.createElement('i', { className: 'fa-solid fa-clock', style: { marginRight: 4 } }), m.heure),
                                m.cin && React.createElement('span', null, React.createElement('i', { className: 'fa-solid fa-id-card', style: { marginRight: 4 } }), m.cin),
                                m.vehicule && React.createElement('span', null, React.createElement('i', { className: 'fa-solid fa-car', style: { marginRight: 4 } }), m.vehicule),
                                m.motif && React.createElement('span', null, React.createElement('i', { className: 'fa-solid fa-tag', style: { marginRight: 4 } }), m.motif),
                                m.geo && React.createElement('a', { href: 'https://www.google.com/maps?q=' + m.geo.lat + ',' + m.geo.lng, target: '_blank', rel: 'noopener', style: { color: '#1565c0', textDecoration: 'none' } }, React.createElement('i', { className: 'fa-solid fa-location-dot', style: { marginRight: 4 } }), 'GPS')
                            ),
                            m.observations && React.createElement('div', { style: { fontSize: 12, color: '#999', marginTop: 3, fontStyle: 'italic' } }, m.observations)
                        ),
                        // Badge
                        React.createElement('span', { style: { padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: m.type === 'entree' ? '#e8f5e9' : '#ffebee', color: m.type === 'entree' ? '#2e7d32' : '#c62828', whiteSpace: 'nowrap' } },
                            m.type === 'entree' ? 'ENTRÉE' : 'SORTIE'
                        ),
                        // Delete
                        React.createElement('button', {
                            onClick: () => handleDelete(m.id),
                            style: { background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: 16, padding: 4 },
                            title: 'Supprimer'
                        }, React.createElement('i', { className: 'fa-solid fa-trash' }))
                    ))
                )
            );
        }

export { SecurityRegistreTab };
