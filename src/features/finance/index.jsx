// @ts-check
/**
 * Extracted feature module
 * Compiled by Vite (src/) as ES modules.
 * // TODO: import from @shared when Step 5 runs
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

        // ===================== FINANCE TABS =====================
        // ===================== SECURITE BSNL =====================
        function useGeolocation() {
            const [geo, setGeo] = useState(null);
            useEffect(() => {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition(
                    pos => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
                    () => {},
                    { enableHighAccuracy: true, timeout: 10000 }
                );
            }, []);
            const refresh = () => {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition(
                    pos => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
                    () => {},
                    { enableHighAccuracy: true, timeout: 10000 }
                );
            };
            return [geo, refresh];
        }

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

        function SecurityScanRegistreTab({ farmFilter, currentProfile }) {
            const [geo, refreshGeo] = useGeolocation();
            const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
            const [scans, setScans] = useState([]);
            const [loading, setLoading] = useState(true);
            const [saving, setSaving] = useState(false);
            const [previews, setPreviews] = useState([]);
            const [pageLabel, setPageLabel] = useState('');
            const fileInputRef = React.useRef(null);

            const loadScans = React.useCallback(async () => {
                try {
                    const snap = await firebase.firestore().collection('security_scan_registre')
                        .where('ferme', '==', farmFilter)
                        .where('date', '==', date)
                        .orderBy('createdAt', 'desc')
                        .get();
                    setScans(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                } catch (e) { console.error('Erreur chargement scans:', e); }
                setLoading(false);
            }, [farmFilter, date]);

            useEffect(() => { setLoading(true); loadScans(); }, [loadScans]);

            const handleFiles = (e) => {
                const files = Array.from(e.target.files);
                if (!files.length) return;
                const readers = files.map(file => new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = ev => resolve({ name: file.name, data: ev.target.result });
                    reader.readAsDataURL(file);
                }));
                Promise.all(readers).then(results => setPreviews(prev => [...prev, ...results]));
                e.target.value = '';
            };

            const removePreview = (idx) => {
                setPreviews(prev => prev.filter((_, i) => i !== idx));
            };

            const handleSave = async () => {
                if (previews.length === 0) return alert('Veuillez ajouter au moins une photo');
                setSaving(true);
                try {
                    const batch = firebase.firestore().batch();
                    previews.forEach((p, i) => {
                        const ref = firebase.firestore().collection('security_scan_registre').doc();
                        batch.set(ref, {
                            date,
                            ferme: farmFilter,
                            page: pageLabel ? (pageLabel + (previews.length > 1 ? ' (' + (i + 1) + '/' + previews.length + ')' : '')) : 'Page ' + (scans.length + i + 1),
                            photo: p.data,
                            fileName: p.name,
                            geo: geo || null,
                            createdBy: currentProfile,
                            createdAt: Date.now()
                        });
                    });
                    await batch.commit();
                    refreshGeo();
                    setPreviews([]);
                    setPageLabel('');
                    loadScans();
                } catch (e) { alert('Erreur: ' + e.message); }
                setSaving(false);
            };

            const handleDelete = async (id) => {
                if (!confirm('Supprimer ce scan ?')) return;
                try {
                    await firebase.firestore().collection('security_scan_registre').doc(id).delete();
                    loadScans();
                } catch (e) { alert('Erreur: ' + e.message); }
            };

            const [viewImage, setViewImage] = useState(null);

            const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd', fontSize: 15, boxSizing: 'border-box' };

            return React.createElement('div', { style: { padding: 16, maxWidth: 700, margin: '0 auto' } },
                // Header
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, padding: '16px 20px', background: 'linear-gradient(135deg, #1a237e 0%, #3f51b5 100%)', borderRadius: 16, color: '#fff' } },
                    React.createElement('img', { src: '/assets/logo_bsnl.svg', alt: 'BSNL', style: { height: 56, width: 'auto', filter: 'brightness(0) invert(1)' } }),
                    React.createElement('div', null,
                        React.createElement('h2', { style: { margin: 0, fontSize: '1.3rem', fontWeight: 700 } }, 'Scan du Registre'),
                        React.createElement('div', { style: { opacity: 0.85, fontSize: '0.9rem', marginTop: 2 } }, 'Ferme ', farmFilter, ' — Numérisation des pages')
                    )
                ),

                // Date
                React.createElement('div', { style: { marginBottom: 16 } },
                    React.createElement('input', { type: 'date', value: date, onChange: e => setDate(e.target.value), style: { ...inputStyle, maxWidth: 200 } })
                ),

                // Upload zone
                React.createElement('div', { style: { marginBottom: 20 } },
                    React.createElement('input', { ref: fileInputRef, type: 'file', accept: 'image/*', capture: 'environment', multiple: true, onChange: handleFiles, style: { display: 'none' } }),

                    // Upload button
                    previews.length === 0 && React.createElement('div', {
                        onClick: () => fileInputRef.current && fileInputRef.current.click(),
                        style: { border: '2px dashed #3f51b5', borderRadius: 16, padding: '40px 20px', textAlign: 'center', cursor: 'pointer', background: '#f5f7ff', transition: 'all 0.2s' }
                    },
                        React.createElement('i', { className: 'fa-solid fa-camera', style: { fontSize: 40, color: '#3f51b5', marginBottom: 12, display: 'block' } }),
                        React.createElement('div', { style: { fontSize: 16, fontWeight: 600, color: '#1a237e', marginBottom: 4 } }, 'Photographier le registre'),
                        React.createElement('div', { style: { fontSize: 13, color: '#777' } }, 'Prenez en photo les pages du registre entrées/sorties')
                    ),

                    // Preview gallery
                    previews.length > 0 && React.createElement('div', { style: { background: '#fff', border: '2px solid #1a237e', borderRadius: 16, padding: 16, marginBottom: 12 } },
                        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
                            React.createElement('h3', { style: { margin: 0, fontSize: '1rem', color: '#1a237e' } },
                                React.createElement('i', { className: 'fa-solid fa-images', style: { marginRight: 8 } }),
                                previews.length, ' photo', previews.length > 1 ? 's' : '', ' à enregistrer'
                            ),
                            React.createElement('button', {
                                onClick: () => fileInputRef.current && fileInputRef.current.click(),
                                style: { background: '#e8eaf6', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, color: '#1a237e', fontWeight: 600, cursor: 'pointer' }
                            }, React.createElement('i', { className: 'fa-solid fa-plus', style: { marginRight: 4 } }), 'Ajouter')
                        ),

                        // Thumbnails
                        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, marginBottom: 14 } },
                            previews.map((p, i) => React.createElement('div', { key: i, style: { position: 'relative', borderRadius: 10, overflow: 'hidden', border: '1px solid #e0e0e0', aspectRatio: '3/4' } },
                                React.createElement('img', { src: p.data, alt: p.name, style: { width: '100%', height: '100%', objectFit: 'cover' } }),
                                React.createElement('button', {
                                    onClick: () => removePreview(i),
                                    style: { position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: '50%', background: 'rgba(198,40,40,0.9)', color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
                                }, React.createElement('i', { className: 'fa-solid fa-times' }))
                            ))
                        ),

                        // Label
                        React.createElement('div', { style: { marginBottom: 14 } },
                            React.createElement('label', { style: { fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 } }, 'Référence / Note (optionnel)'),
                            React.createElement('input', { type: 'text', value: pageLabel, onChange: e => setPageLabel(e.target.value), placeholder: 'Ex: Pages 12-13, Registre nuit...', style: inputStyle })
                        ),

                        // Save
                        React.createElement('div', { style: { display: 'flex', gap: 10 } },
                            React.createElement('button', {
                                onClick: handleSave, disabled: saving,
                                style: { flex: 1, padding: '12px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }
                            }, saving ? 'Enregistrement...' : React.createElement(React.Fragment, null, React.createElement('i', { className: 'fa-solid fa-cloud-arrow-up', style: { marginRight: 6 } }), 'Enregistrer')),
                            React.createElement('button', {
                                onClick: () => { setPreviews([]); setPageLabel(''); },
                                style: { padding: '12px 20px', background: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: 10, fontSize: 15, cursor: 'pointer' }
                            }, 'Annuler')
                        )
                    )
                ),

                // Scans count
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 } },
                    React.createElement('h3', { style: { margin: 0, fontSize: '1rem', color: '#333' } },
                        React.createElement('i', { className: 'fa-solid fa-file-image', style: { marginRight: 8, color: '#1a237e' } }),
                        'Scans du ', new Date(date + 'T00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }), ' (', scans.length, ')'
                    )
                ),

                // Loading
                loading && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: '#888' } },
                    React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 24 } })
                ),

                // Scans grid
                !loading && scans.length === 0 && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: '#999', background: '#fafafa', borderRadius: 12 } },
                    React.createElement('i', { className: 'fa-solid fa-file-circle-xmark', style: { fontSize: 32, marginBottom: 8, display: 'block' } }),
                    'Aucun scan pour cette date'
                ),

                !loading && scans.length > 0 && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 } },
                    scans.map(s => React.createElement('div', { key: s.id, style: { background: '#fff', borderRadius: 12, border: '1px solid #e0e0e0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', cursor: 'pointer', transition: 'transform 0.15s', position: 'relative' } },
                        React.createElement('div', { onClick: () => setViewImage(s), style: { aspectRatio: '3/4', overflow: 'hidden' } },
                            React.createElement('img', { src: s.photo, alt: s.page, style: { width: '100%', height: '100%', objectFit: 'cover' }, loading: 'lazy' })
                        ),
                        React.createElement('div', { style: { padding: '8px 10px' } },
                            React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.page),
                            React.createElement('div', { style: { fontSize: 11, color: '#999', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 } },
                                new Date(s.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                                s.geo && React.createElement('a', { href: 'https://www.google.com/maps?q=' + s.geo.lat + ',' + s.geo.lng, target: '_blank', rel: 'noopener', onClick: e => e.stopPropagation(), style: { color: '#1565c0', fontSize: 11 } }, React.createElement('i', { className: 'fa-solid fa-location-dot' }))
                            )
                        ),
                        React.createElement('button', {
                            onClick: (e) => { e.stopPropagation(); handleDelete(s.id); },
                            style: { position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
                        }, React.createElement('i', { className: 'fa-solid fa-trash' }))
                    ))
                ),

                // Fullscreen image viewer
                viewImage && React.createElement('div', {
                    onClick: () => setViewImage(null),
                    style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }
                },
                    React.createElement('div', { style: { color: '#fff', fontSize: 16, fontWeight: 600, marginBottom: 12 } },
                        viewImage.page, ' — ', new Date(viewImage.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                    ),
                    React.createElement('img', { src: viewImage.photo, alt: viewImage.page, style: { maxWidth: '95%', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 } }),
                    React.createElement('button', {
                        onClick: () => setViewImage(null),
                        style: { position: 'absolute', top: 16, right: 16, width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', fontSize: 20, cursor: 'pointer' }
                    }, React.createElement('i', { className: 'fa-solid fa-times' }))
                )
            );
        }

        function SecurityTunnelsTab({ farmFilter, currentProfile }) {
            const [geo, refreshGeo] = useGeolocation();
            const TOTAL_TUNNELS = 113;
            const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
            const [currentTunnel, setCurrentTunnel] = useState(1);
            const [photosByTunnel, setPhotosByTunnel] = useState({});
            const [loading, setLoading] = useState(true);
            const [saving, setSaving] = useState(false);
            const [preview, setPreview] = useState(null);
            const fileInputRef = React.useRef(null);

            const loadPhotos = React.useCallback(async () => {
                try {
                    const snap = await firebase.firestore().collection('security_tunnel_photos')
                        .where('ferme', '==', farmFilter)
                        .where('date', '==', date)
                        .get();
                    const map = {};
                    snap.docs.forEach(d => {
                        const data = d.data();
                        map[data.tunnel] = { id: d.id, ...data };
                    });
                    setPhotosByTunnel(map);
                } catch (e) { console.error('Erreur chargement photos tunnels:', e); }
                setLoading(false);
            }, [farmFilter, date]);

            useEffect(() => { setLoading(true); loadPhotos(); }, [loadPhotos]);

            const handleFileChange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => setPreview(ev.target.result);
                reader.readAsDataURL(file);
                e.target.value = '';
            };

            const handleSavePhoto = async () => {
                if (!preview) return;
                setSaving(true);
                try {
                    // Delete existing photo for this tunnel/date if exists
                    if (photosByTunnel[currentTunnel]) {
                        await firebase.firestore().collection('security_tunnel_photos').doc(photosByTunnel[currentTunnel].id).delete();
                    }
                    await firebase.firestore().collection('security_tunnel_photos').add({
                        date,
                        ferme: farmFilter,
                        tunnel: currentTunnel,
                        photo: preview,
                        geo: geo || null,
                        createdBy: currentProfile,
                        createdAt: Date.now()
                    });
                    refreshGeo();
                    setPreview(null);
                    loadPhotos();
                    // Auto-advance to next tunnel
                    if (currentTunnel < TOTAL_TUNNELS) {
                        setCurrentTunnel(currentTunnel + 1);
                    }
                } catch (e) { alert('Erreur: ' + e.message); }
                setSaving(false);
            };

            const photographed = Object.keys(photosByTunnel).length;
            const progressPct = Math.round((photographed / TOTAL_TUNNELS) * 100);

            return React.createElement('div', { style: { padding: 16, maxWidth: 700, margin: '0 auto' } },
                // Header
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, padding: '16px 20px', background: 'linear-gradient(135deg, #1a237e 0%, #3f51b5 100%)', borderRadius: 16, color: '#fff' } },
                    React.createElement('img', { src: '/assets/logo_bsnl.svg', alt: 'BSNL', style: { height: 48, width: 'auto', filter: 'brightness(0) invert(1)' } }),
                    React.createElement('div', null,
                        React.createElement('h2', { style: { margin: 0, fontSize: '1.2rem', fontWeight: 700 } }, 'Photos Tunnels Myrtille'),
                        React.createElement('div', { style: { opacity: 0.85, fontSize: '0.85rem', marginTop: 2 } }, 'Ferme F5 — Inspection quotidienne')
                    )
                ),

                // Date
                React.createElement('div', { style: { marginBottom: 16 } },
                    React.createElement('input', { type: 'date', value: date, onChange: e => { setDate(e.target.value); setCurrentTunnel(1); }, style: { width: '100%', maxWidth: 200, padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd', fontSize: 15 } })
                ),

                // Progress bar
                React.createElement('div', { style: { marginBottom: 20 } },
                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 } },
                        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: '#333' } }, 'Progression'),
                        React.createElement('span', { style: { fontSize: 14, fontWeight: 700, color: progressPct === 100 ? '#2e7d32' : '#1a237e' } }, photographed, ' / ', TOTAL_TUNNELS, ' tunnels (', progressPct, '%)')
                    ),
                    React.createElement('div', { style: { height: 10, background: '#e0e0e0', borderRadius: 6, overflow: 'hidden' } },
                        React.createElement('div', { style: { height: '100%', width: progressPct + '%', background: progressPct === 100 ? '#4caf50' : 'linear-gradient(90deg, #1a237e, #3f51b5)', borderRadius: 6, transition: 'width 0.3s ease' } })
                    )
                ),

                // Current tunnel navigation
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 20 } },
                    React.createElement('button', {
                        onClick: () => setCurrentTunnel(Math.max(1, currentTunnel - 1)),
                        disabled: currentTunnel <= 1,
                        style: { width: 52, height: 52, borderRadius: '50%', border: '2px solid #1a237e', background: currentTunnel <= 1 ? '#f5f5f5' : '#fff', color: currentTunnel <= 1 ? '#ccc' : '#1a237e', fontSize: 22, cursor: currentTunnel <= 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
                    }, React.createElement('i', { className: 'fa-solid fa-chevron-left' })),
                    React.createElement('div', { style: { textAlign: 'center' } },
                        React.createElement('div', { style: { fontSize: '2.2rem', fontWeight: 800, color: '#1a237e', lineHeight: 1 } }, currentTunnel),
                        React.createElement('div', { style: { fontSize: '0.85rem', color: '#777', marginTop: 4 } }, 'Tunnel ', currentTunnel, ' / ', TOTAL_TUNNELS),
                        photosByTunnel[currentTunnel] && React.createElement('div', { style: { marginTop: 4 } },
                            React.createElement('span', { style: { background: '#e8f5e9', color: '#2e7d32', padding: '2px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600 } }, React.createElement('i', { className: 'fa-solid fa-check', style: { marginRight: 4 } }), 'Photographié')
                        )
                    ),
                    React.createElement('button', {
                        onClick: () => setCurrentTunnel(Math.min(TOTAL_TUNNELS, currentTunnel + 1)),
                        disabled: currentTunnel >= TOTAL_TUNNELS,
                        style: { width: 52, height: 52, borderRadius: '50%', border: '2px solid #1a237e', background: currentTunnel >= TOTAL_TUNNELS ? '#f5f5f5' : '#fff', color: currentTunnel >= TOTAL_TUNNELS ? '#ccc' : '#1a237e', fontSize: 22, cursor: currentTunnel >= TOTAL_TUNNELS ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
                    }, React.createElement('i', { className: 'fa-solid fa-chevron-right' }))
                ),

                // Photo area
                React.createElement('div', { style: { marginBottom: 20 } },
                    // Existing photo display
                    !preview && photosByTunnel[currentTunnel] && React.createElement('div', { style: { marginBottom: 12 } },
                        React.createElement('img', { src: photosByTunnel[currentTunnel].photo, alt: 'Tunnel ' + currentTunnel, style: { width: '100%', maxHeight: 300, objectFit: 'cover', borderRadius: 12, border: '2px solid #e0e0e0' } }),
                        React.createElement('div', { style: { fontSize: 12, color: '#999', textAlign: 'center', marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 } },
                            'Photo prise à ', new Date(photosByTunnel[currentTunnel].createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                            photosByTunnel[currentTunnel].geo && React.createElement('a', { href: 'https://www.google.com/maps?q=' + photosByTunnel[currentTunnel].geo.lat + ',' + photosByTunnel[currentTunnel].geo.lng, target: '_blank', rel: 'noopener', style: { color: '#1565c0', textDecoration: 'none', fontSize: 12 } }, React.createElement('i', { className: 'fa-solid fa-location-dot', style: { marginRight: 3 } }), 'Voir sur Maps')
                        )
                    ),

                    // Preview of new photo
                    preview && React.createElement('div', { style: { marginBottom: 12 } },
                        React.createElement('img', { src: preview, alt: 'Aperçu', style: { width: '100%', maxHeight: 300, objectFit: 'cover', borderRadius: 12, border: '2px solid #1a237e' } }),
                        React.createElement('div', { style: { display: 'flex', gap: 10, marginTop: 10 } },
                            React.createElement('button', {
                                onClick: handleSavePhoto, disabled: saving,
                                style: { flex: 1, padding: '12px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }
                            }, saving ? 'Enregistrement...' : React.createElement(React.Fragment, null, React.createElement('i', { className: 'fa-solid fa-save', style: { marginRight: 6 } }), 'Enregistrer & Suivant')),
                            React.createElement('button', {
                                onClick: () => setPreview(null),
                                style: { padding: '12px 20px', background: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: 10, fontSize: 15, cursor: 'pointer' }
                            }, React.createElement('i', { className: 'fa-solid fa-redo' }))
                        )
                    ),

                    // Hidden file input
                    React.createElement('input', { ref: fileInputRef, type: 'file', accept: 'image/*', capture: 'environment', onChange: handleFileChange, style: { display: 'none' } }),

                    // Take photo button
                    !preview && React.createElement('button', {
                        onClick: () => fileInputRef.current && fileInputRef.current.click(),
                        style: { width: '100%', padding: '16px', background: photosByTunnel[currentTunnel] ? '#ff9800' : '#1a237e', color: '#fff', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }
                    },
                        React.createElement('i', { className: 'fa-solid fa-camera', style: { fontSize: 20 } }),
                        photosByTunnel[currentTunnel] ? 'Reprendre la photo' : 'Prendre la photo'
                    )
                ),

                // Tunnel grid
                React.createElement('div', { style: { marginTop: 20 } },
                    React.createElement('h3', { style: { fontSize: '0.95rem', color: '#333', marginBottom: 10 } },
                        React.createElement('i', { className: 'fa-solid fa-grip', style: { marginRight: 8, color: '#1a237e' } }),
                        'Vue d\'ensemble des tunnels'
                    ),
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(42px, 1fr))', gap: 4, maxHeight: 260, overflowY: 'auto', padding: 4 } },
                        Array.from({ length: TOTAL_TUNNELS }, (_, i) => i + 1).map(t =>
                            React.createElement('button', {
                                key: t,
                                onClick: () => setCurrentTunnel(t),
                                style: {
                                    width: '100%', aspectRatio: '1', borderRadius: 8, border: t === currentTunnel ? '2px solid #1a237e' : '1px solid #e0e0e0',
                                    background: photosByTunnel[t] ? '#e8f5e9' : (t === currentTunnel ? '#e8eaf6' : '#fff'),
                                    color: photosByTunnel[t] ? '#2e7d32' : (t === currentTunnel ? '#1a237e' : '#888'),
                                    fontSize: 12, fontWeight: t === currentTunnel ? 700 : 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative'
                                }
                            },
                                t,
                                photosByTunnel[t] && React.createElement('i', { className: 'fa-solid fa-check', style: { position: 'absolute', top: 2, right: 3, fontSize: 7, color: '#2e7d32' } })
                            )
                        )
                    )
                )
            );
        }

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

        function FinDashboardTab({ data, farmFilter, onNavigateMeteo }) {
            const [viewMode, setViewMode] = useState('global');
            const [selectedCharge, setSelectedCharge] = useState(null);
            const [nouveauxData, setNouveauxData] = useState(null);
            const [showNouveaux, setShowNouveaux] = useState(false);
            const [alertesAbsence, setAlertesAbsence] = useState(null);
            const [showAlertes, setShowAlertes] = useState(false);
            const [pendingTransportChanges, setPendingTransportChanges] = useState([]);
            const [showTransportChanges, setShowTransportChanges] = useState(false);
            const [validatingChange, setValidatingChange] = useState(null);
            const [moAnalytique, setMoAnalytique] = useState(null);
            const [consumptionCosts, setConsumptionCosts] = useState(null);
            const [fuelData, setFuelData] = useState(null);
            const [liqData, setLiqData] = useState(null);
            const [marcheLocalBons, setMarcheLocalBons] = useState(null);
            const [cpcMode, setCpcMode] = useState('total');

            // Map prefix to equipe name
            const prefixToName = {};
            (data.transportConfig || []).forEach(t => { prefixToName[t.prefix] = t.equipe; });

            React.useEffect(() => {
                cachedFetch('/api/pointage-rh?action=nouveaux-ouvriers')
                    .then(json => { if (json.success) setNouveauxData(json); })
                    .catch(() => {});
                cachedFetch('/api/pointage-rh?action=quinzaine-alertes')
                    .then(json => { if (json.success) setAlertesAbsence(json); })
                    .catch(() => {});
                cachedFetch('/api/pointage-rh?action=mo-analytique-variete')
                    .then(json => { if (json.success) setMoAnalytique(json); })
                    .catch(() => {});
                cachedFetch('/api/stock?action=get-consumption-costs')
                    .then(json => { if (json.success) setConsumptionCosts(json.data); })
                    .catch(() => {});
                // Fuel CPC: read snapshot from Firestore (fast, always available)
                if (typeof firebase !== 'undefined' && firebase.firestore) {
                    firebase.firestore().collection('cpc_snapshots').doc('fuel').get()
                        .then(doc => { if (doc.exists) setFuelData(doc.data()); })
                        .catch(() => {});
                }
                Promise.all([
                    cachedFetch('/api/email-analysis?action=liquidations'),
                    cachedFetch('/api/email-analysis?action=expeditions&limit=2000'),
                ]).then(([liqJson, expJson]) => {
                    if (liqJson.success && expJson.success) setLiqData({ liquidations: liqJson.liquidations || [], expeditions: expJson.expeditions || [] });
                }).catch(() => {});
                // Load ALL marché local bons: pfq_interne (typeVente=Marché Local) + bons_marche_local
                (async () => {
                    const allBons = [];
                    try {
                        const prodBons = await loadBonsFromFirestore();
                        prodBons.filter(b => b.typeVente === 'Marché Local').forEach(b => allBons.push(b));
                    } catch(e) {}
                    try {
                        if (typeof firebase !== 'undefined' && firebase.firestore) {
                            const snap = await firebase.firestore().collection('bons_marche_local').get();
                            snap.forEach(d => allBons.push({ id: d.id, ...d.data(), source: 'firestore' }));
                        }
                    } catch(e) {}
                    setMarcheLocalBons(allBons);
                })();
                fetch('/api/validation?action=transport-config')
                    .then(r => r.json())
                    .then(json => { if (json.success) setPendingTransportChanges(json.pendingChanges || []); })
                    .catch(() => {});
            }, []);

            const handleValidateTransportChange = (changeId, decision) => {
                setValidatingChange(changeId);
                fetch('/api/validation?action=transport-config-validate', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ changeId, decision, validatedBy: 'Finance' }),
                }).then(r => r.json()).then(json => {
                    if (json.success) {
                        setPendingTransportChanges(prev => prev.filter(c => c.id !== changeId));
                    }
                }).catch(err => alert('Erreur: ' + err.message)).finally(() => setValidatingChange(null));
            };

            const charges = data.cpcCharges;
            const varietes = data.cpcVarietes;
            const ccSummary = consumptionCosts && consumptionCosts['_summary'];

            // Campagne Jul→Juin : map mois → [année, mois 1-12]
            const MOIS_CAMPAGNE = { 'Jul':[2025,7],'Aoû':[2025,8],'Sep':[2025,9],'Oct':[2025,10],'Nov':[2025,11],'Déc':[2025,12],'Jan':[2026,1],'Fév':[2026,2],'Mar':[2026,3],'Avr':[2026,4],'Mai':[2026,5],'Jui':[2026,6] };
            const _today = new Date();
            const _todayY = _today.getFullYear();
            const _todayM = _today.getMonth() + 1;
            const _todayD = _today.getDate();
            // État d'un mois par rapport à aujourd'hui : 'past' | 'current' | 'future'
            const moisStatus = (label) => {
                const ym = MOIS_CAMPAGNE[label]; if (!ym) return 'past';
                const [y,mo] = ym;
                if (y < _todayY || (y === _todayY && mo < _todayM)) return 'past';
                if (y === _todayY && mo === _todayM) return 'current';
                return 'future';
            };
            // Total écoulé à date avec pro-rata du mois courant
            const elapsedTotal = (parMois) => {
                if (!Array.isArray(parMois)) return 0;
                let t = 0;
                for (const { m, v } of parMois) {
                    const s = moisStatus(m);
                    if (s === 'past') t += v;
                    else if (s === 'current') {
                        const [y, mo] = MOIS_CAMPAGNE[m];
                        const daysInMonth = new Date(y, mo, 0).getDate();
                        t += v * (_todayD / daysInMonth);
                    }
                }
                return Math.round(t);
            };
            // Nombre de mois écoulés (avec fraction pour le mois courant) sur la campagne
            const elapsedMonthsCount = (() => {
                let n = 0;
                for (const label of Object.keys(MOIS_CAMPAGNE)) {
                    const s = moisStatus(label);
                    if (s === 'past') n += 1;
                    else if (s === 'current') {
                        const [y, mo] = MOIS_CAMPAGNE[label];
                        n += _todayD / new Date(y, mo, 0).getDate();
                    }
                }
                return n;
            })();
            // Pour les charges dont parMois s'arrête à Déc (variables Jul-Déc), elapsed = total
            const chargeElapsed = (c) => {
                if (!c.parMois || c.parMois.length === 0) return c.total;
                const sumParMois = c.parMois.reduce((s, x) => s + (x.v || 0), 0);
                // si parMois ne couvre que les mois passés réalisés (ex: 6 mois Jul-Déc), total = somme parMois
                if (Math.abs(sumParMois - c.total) < 1) return elapsedTotal(c.parMois);
                // sinon (cas mixte) : prorata sur le total
                return Math.round(c.total * elapsedTotal(c.parMois) / sumParMois);
            };

            // --- Live KPI totals ---
            // CA Live from liquidations
            const liveCAExport = liqData ? (() => {
                let total = 0;
                (liqData.liquidations || []).forEach(liq => {
                    (liq.rows || []).forEach(row => { total += row.gsNet || 0; });
                });
                return total;
            })() : null;
            const liveCALocal = marcheLocalBons ? marcheLocalBons.reduce((s, b) => s + (parseFloat(b.totalDH) || ((parseFloat(b.poidsLot)||0) * (parseFloat(b.prixDH)||0))), 0) : null;
            const liveMO = moAnalytique ? moAnalytique.totaux.total : null;
            const liveEngrais = ccSummary ? ccSummary.total_engrais_ttc : null;
            const livePesticides = ccSummary ? ccSummary.total_pesticides_ttc : null;

            // Use live values when available, otherwise hardcoded
            const totalCAExportDisplay = liveCAExport !== null ? liveCAExport : data.totalCAExport;
            const totalCALocalDisplay = liveCALocal !== null ? liveCALocal : data.totalCALocal;
            const totalCADisplay = totalCAExportDisplay + totalCALocalDisplay;

            // Charges: MO live + intrants live + structure hardcodée
            const moCharges = liveMO !== null ? liveMO : charges.filter(c => ['M.O Récolte','M.O Hors Récolte','STC Ouvriers'].includes(c.poste)).reduce((s,c) => s+chargeElapsed(c), 0);
            const intrantsCharges = charges.filter(c => ['Plants','Engrais','Pesticides','Eau ORMVAL','Autres Intrants'].includes(c.poste)).reduce((s,c) => {
                if (ccSummary && c.poste === 'Engrais') return s + ccSummary.total_engrais_ttc;
                if (ccSummary && c.poste === 'Pesticides') return s + ccSummary.total_pesticides_ttc;
                return s + chargeElapsed(c);
            }, 0);
            const structureCharges = charges.filter(c => ['Encadrement','CNSS','IR','Frais Généraux','Loyer Terrains','Électricité','Gasoil & Gaz','Transport & Divers','Amortissement & Frais Financiers'].includes(c.poste)).reduce((s,c) => s+chargeElapsed(c), 0);
            const totalChargesDisplay = moCharges + intrantsCharges + structureCharges;
            const resultatDisplay = totalCADisplay - totalChargesDisplay;

            // Charges par poste — override live values
            const liveChargeOverrides = {};
            if (liveEngrais !== null) liveChargeOverrides['Engrais'] = liveEngrais;
            if (livePesticides !== null) liveChargeOverrides['Pesticides'] = livePesticides;
            if (liveMO !== null) {
                const moTotaux = moAnalytique.totaux;
                liveChargeOverrides['M.O Récolte'] = moTotaux.recolte;
                liveChargeOverrides['M.O Hors Récolte'] = moTotaux.horsRecolte;
            }

            // Safety: ensure critical data fields are primitives
            if (!charges || !Array.isArray(charges)) return <div style={{padding:40,textAlign:'center',color:'var(--gray-400)'}}>Chargement des données...</div>;

            return (
                <div className="fade-in">
                    {/* Header band */}
                    <div style={{padding:'20px 24px', background:'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', borderRadius:'12px', marginBottom:'20px', color:'white'}}>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'12px'}}>
                            <div>
                                <div style={{fontSize:'11px', textTransform:'uppercase', letterSpacing:'1px', opacity:0.6, marginBottom:'4px'}}>CPC Campagne</div>
                                <div style={{fontSize:'22px', fontWeight:'700'}}>2025-2026</div>
                                <div style={{fontSize:'12px', opacity:0.7}}>{liveCAExport !== null ? 'Données LIVE' : `À date ${_today.toLocaleDateString('fr-FR')} · ${elapsedMonthsCount.toFixed(1)}/12 mois`} | {data.totalHa} Ha cultivés</div>
                            </div>
                            <div style={{display:'flex', gap:'24px', textAlign:'center'}}>
                                <div>
                                    <div style={{fontSize:'10px', textTransform:'uppercase', letterSpacing:'1px', opacity:0.6}}>CA Total</div>
                                    <div style={{fontSize:'20px', fontWeight:'700', color:'#D4A847'}}>{(totalCADisplay/1000000).toFixed(1)}M DH</div>
                                </div>
                                <div>
                                    <div style={{fontSize:'10px', textTransform:'uppercase', letterSpacing:'1px', opacity:0.6}}>Charges</div>
                                    <div style={{fontSize:'20px', fontWeight:'700', color:'#E74C3C'}}>{(totalChargesDisplay/1000000).toFixed(1)}M DH</div>
                                </div>
                                <div>
                                    <div style={{fontSize:'10px', textTransform:'uppercase', letterSpacing:'1px', opacity:0.6}}>Résultat</div>
                                    <div style={{fontSize:'20px', fontWeight:'700', color: resultatDisplay >= 0 ? '#2D8B4E' : '#E74C3C'}}>{(resultatDisplay/1000000).toFixed(1)}M DH</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Météo Dashboard (DG) — temporarily disabled for debugging */}
                    {/* <MeteoAlertsDashboard farmFilter={farmFilter || 'F1'} onNavigateMeteo={onNavigateMeteo} /> */}

                    {/* Alerte Équipes Absentes - Finance Dashboard */}
                    {alertesAbsence && alertesAbsence.alertes && alertesAbsence.alertes.length > 0 && (
                        <div style={{marginBottom:16}}>
                            <div onClick={() => setShowAlertes(!showAlertes)} style={{padding:'12px 20px', background:'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)', borderRadius: showAlertes ? '10px 10px 0 0' : '10px', color:'white', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                <div style={{display:'flex', alignItems:'center', gap:12}}>
                                    <i className="fa-solid fa-triangle-exclamation" style={{fontSize:16}}></i>
                                    <span style={{fontWeight:600, fontSize:13}}>
                                        {alertesAbsence.alertes.length} alerte{alertesAbsence.alertes.length > 1 ? 's' : ''} — Équipe{alertesAbsence.alertes.length > 1 ? 's' : ''} absente{alertesAbsence.alertes.length > 1 ? 's' : ''} depuis plus de 5 jours
                                    </span>
                                    <span style={{fontSize:10, opacity:0.7, background:'rgba(255,255,255,0.2)', padding:'2px 8px', borderRadius:8}}>{alertesAbsence.periode}</span>
                                </div>
                                <i className={`fa-solid fa-chevron-${showAlertes ? 'up' : 'down'}`} style={{fontSize:12, opacity:0.8}}></i>
                            </div>
                            {showAlertes && (
                                <div style={{background:'white', border:'1px solid #e74c3c', borderTop:'none', borderRadius:'0 0 10px 10px', padding:16}}>
                                    {alertesAbsence.alertes.map((a, i) => (
                                        <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:'rgba(231,76,60,0.06)',borderRadius:8,marginBottom:i < alertesAbsence.alertes.length - 1 ? 6 : 0}}>
                                            <i className="fa-solid fa-users-slash" style={{fontSize:14,color:'#e74c3c'}}></i>
                                            <div>
                                                <strong style={{color:'#e74c3c'}}>{prefixToName[a.equipePrefix] || a.equipePrefix}</strong> — {a.joursAbsents} jours consécutifs d'absence
                                                <div style={{fontSize:10,color:'var(--gray-500)'}}>Du {new Date(a.dateDebut).toLocaleDateString('fr-FR')} au {new Date(a.dateFin).toLocaleDateString('fr-FR')}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Demandes Transport en attente de validation Finance */}
                    {pendingTransportChanges.length > 0 && (
                        <div style={{marginBottom:16}}>
                            <div onClick={() => setShowTransportChanges(!showTransportChanges)} style={{padding:'12px 20px', background:'linear-gradient(135deg, #e67e22 0%, #d35400 100%)', borderRadius: showTransportChanges ? '10px 10px 0 0' : '10px', color:'white', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                <div style={{display:'flex', alignItems:'center', gap:12}}>
                                    <i className="fa-solid fa-bus" style={{fontSize:16}}></i>
                                    <span style={{fontWeight:600, fontSize:13}}>
                                        {pendingTransportChanges.length} modification{pendingTransportChanges.length > 1 ? 's' : ''} transport en attente de validation
                                    </span>
                                </div>
                                <i className={`fa-solid fa-chevron-${showTransportChanges ? 'up' : 'down'}`} style={{fontSize:12, opacity:0.8}}></i>
                            </div>
                            {showTransportChanges && (
                                <div style={{background:'white', border:'1px solid #e67e22', borderTop:'none', borderRadius:'0 0 10px 10px', padding:16}}>
                                    {pendingTransportChanges.map((ch, ci) => (
                                        <div key={ch.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',background:'rgba(230,126,34,0.06)',borderRadius:8,marginBottom:ci < pendingTransportChanges.length - 1 ? 6 : 0}}>
                                            <div style={{fontSize:12}}>
                                                {ch.changeType === 'modifier_prix' && (
                                                    <span><i className="fa-solid fa-edit" style={{marginRight:6,color:'#e67e22'}}></i><strong>{ch.data.equipe}</strong> — Prix: {ch.data.oldCout} DH → <strong style={{color:'var(--berry)'}}>{ch.data.newCout} DH</strong></span>
                                                )}
                                                {ch.changeType === 'ajouter_equipe' && (
                                                    <span><i className="fa-solid fa-plus-circle" style={{marginRight:6,color:'#e67e22'}}></i>Ajout: <strong>{ch.data.equipe}</strong> ({ch.data.prefix}) — {ch.data.coutParOuvrier} DH/ouv. — Caporal: {ch.data.caporal}</span>
                                                )}
                                                {ch.changeType === 'supprimer_equipe' && (
                                                    <span><i className="fa-solid fa-trash" style={{marginRight:6,color:'#e74c3c'}}></i>Suppression: <strong>{ch.data.equipe}</strong></span>
                                                )}
                                                <div style={{fontSize:10,color:'var(--gray-400)',marginTop:2}}>Soumis par {ch.submittedBy} le {new Date(ch.createdAt).toLocaleDateString('fr-FR')}</div>
                                            </div>
                                            <div style={{display:'flex',gap:6}}>
                                                <button onClick={() => handleValidateTransportChange(ch.id, 'approuver')} disabled={validatingChange === ch.id}
                                                    style={{padding:'5px 12px',background:'var(--green)',color:'#fff',border:'none',borderRadius:6,fontSize:11,fontWeight:600,cursor: validatingChange === ch.id ? 'wait' : 'pointer'}}>
                                                    <i className={`fa-solid ${validatingChange === ch.id ? 'fa-spinner fa-spin' : 'fa-check'}`} style={{marginRight:4}}></i>Approuver
                                                </button>
                                                <button onClick={() => handleValidateTransportChange(ch.id, 'rejeter')} disabled={validatingChange === ch.id}
                                                    style={{padding:'5px 12px',background:'#e74c3c',color:'#fff',border:'none',borderRadius:6,fontSize:11,fontWeight:600,cursor: validatingChange === ch.id ? 'wait' : 'pointer'}}>
                                                    <i className="fa-solid fa-xmark" style={{marginRight:4}}></i>Rejeter
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Nouveaux Ouvriers Banner */}
                    {nouveauxData && nouveauxData.summary.totalQuinzaine > 0 && (
                        <div style={{marginBottom:16}}>
                            <div onClick={() => setShowNouveaux(!showNouveaux)} style={{padding:'12px 20px', background:'linear-gradient(135deg, #2D8B4E 0%, #1a6b35 100%)', borderRadius: showNouveaux ? '10px 10px 0 0' : '10px', color:'white', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                <div style={{display:'flex', alignItems:'center', gap:12}}>
                                    <i className="fa-solid fa-user-plus" style={{fontSize:16}}></i>
                                    <span style={{fontWeight:600, fontSize:13}}>
                                        {nouveauxData.summary.totalQuinzaine} nouveaux ouvriers cette quinzaine
                                        {nouveauxData.summary.totalToday > 0 && <span style={{opacity:0.8, fontWeight:400}}> ({nouveauxData.summary.totalToday} aujourd'hui)</span>}
                                    </span>
                                    <span style={{fontSize:10, opacity:0.7, background:'rgba(255,255,255,0.2)', padding:'2px 8px', borderRadius:8}}>{nouveauxData.periode}</span>
                                </div>
                                <i className={`fa-solid fa-chevron-${showNouveaux ? 'up' : 'down'}`} style={{fontSize:12, opacity:0.8}}></i>
                            </div>
                            {showNouveaux && (
                                <div style={{background:'white', border:'1px solid var(--gray-200)', borderTop:'none', borderRadius:'0 0 10px 10px', padding:16}}>
                                    <div style={{display:'flex', gap:12, marginBottom:12, flexWrap:'wrap'}}>
                                        {Object.entries(nouveauxData.summary.byFarm).map(([f, v]) => (
                                            <span key={f} className="status-badge" style={{background: f==='F1' ? 'rgba(139,34,82,0.1)' : f==='F5' ? 'rgba(45,139,78,0.1)' : 'rgba(212,168,71,0.1)', color: f==='F1' ? 'var(--berry)' : f==='F5' ? 'var(--green)' : 'var(--gold)', fontSize:11, padding:'4px 10px'}}>{f}: {typeof v === 'object' ? JSON.stringify(v) : v}</span>
                                        ))}
                                    </div>
                                    <table className="data-table">
                                        <thead>
                                            <tr><th>Matricule</th><th>Nom</th><th>Date Arrivée</th><th>Ferme</th><th>Équipe</th></tr>
                                        </thead>
                                        <tbody>
                                            {nouveauxData.workers.map((w, i) => (
                                                <tr key={i}>
                                                    <td style={{fontFamily:'monospace',fontWeight:600}}>{w.matricule}</td>
                                                    <td style={{fontWeight:500}}><WorkerLink matricule={w.matricule} nom={w.nom} /></td>
                                                    <td>{new Date(w.firstDate).toLocaleDateString('fr-FR')}</td>
                                                    <td><span className="status-badge" style={{background: w.ferme==='F1' ? 'rgba(139,34,82,0.1)' : w.ferme==='F5' ? 'rgba(45,139,78,0.1)' : 'rgba(212,168,71,0.1)', color: w.ferme==='F1' ? 'var(--berry)' : w.ferme==='F5' ? 'var(--green)' : 'var(--gold)', fontSize:10}}>{w.ferme}</span></td>
                                                    <td style={{fontSize:11,color:'var(--gray-600)'}}>{w.equipe}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* KPI Row */}
                    <div className="kpi-grid">
                        <KPICard icon="fa-money-bill-wave" iconClass="green" value={`${(totalCAExportDisplay/1000).toFixed(0)}K`} label={liveCAExport !== null ? "CA Liquidé Driscoll's" : "CA Export Driscoll's"} subItems={[{value: liveCAExport !== null ? 'LIVE' : `${data.totalKgExport.toLocaleString('fr-FR')} kg`, label: liveCAExport !== null ? '' : 'Tonnage'}]} />
                        <KPICard icon="fa-store" iconClass="blue" value={`${(totalCALocalDisplay/1000).toFixed(0)}K`} label="CA Local" subItems={liveCALocal !== null ? [{value:'LIVE', label:''}] : []} />
                        <KPICard icon="fa-users" iconClass="red" value={`${(moCharges/1000).toFixed(0)}K`} label="Main d'Oeuvre" subItems={[{value:`${totalChargesDisplay > 0 ? Math.round(moCharges/totalChargesDisplay*100) : 0}%`, label:'du total'}, ...(liveMO !== null ? [{value:'LIVE', label:''}] : [])]} />
                        <KPICard icon="fa-chart-line" iconClass="berry" value={`${(resultatDisplay/1000).toFixed(0)}K`} label="Résultat Net" />
                    </div>

                    {/* Répartition des charges */}
                    <Panel title="Structure des Charges par Poste" icon="fa-layer-group">
                        <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:10}}><i className="fa-solid fa-hand-pointer" style={{marginRight:4}}></i> Cliquez sur un poste pour voir le détail</div>
                        <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'10px'}}>
                            {charges.map((c, i) => {
                                const liveVal = liveChargeOverrides[c.poste];
                                const displayTotal = liveVal !== undefined ? liveVal : chargeElapsed(c);
                                const pct = totalChargesDisplay > 0 ? (displayTotal / totalChargesDisplay * 100).toFixed(1) : '0';
                                const isLive = liveVal !== undefined;
                                return (
                                    <div key={i} onClick={() => setSelectedCharge(c)} style={{padding:'12px', background:'var(--gray-100)', borderRadius:'10px', borderLeft:`4px solid ${c.color}`, cursor:'pointer', transition:'all 0.2s'}}
                                        onMouseOver={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)'; }}
                                        onMouseOut={e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='none'; }}>
                                        <div style={{display:'flex', alignItems:'center', gap:'6px', marginBottom:'6px'}}>
                                            <i className={`fa-solid ${c.icon}`} style={{fontSize:'11px', color:c.color}}></i>
                                            <span style={{fontSize:'11px', fontWeight:'600', color:'var(--gray-600)'}}>{c.poste}</span>
                                            {isLive && <span style={{fontSize:7,padding:'1px 4px',borderRadius:3,background:'#d4edda',color:'#155724',fontWeight:700}}>LIVE</span>}
                                        </div>
                                        <div style={{fontSize:'16px', fontWeight:'700'}}>{(displayTotal/1000).toFixed(0)}K</div>
                                        <div style={{fontSize:'10px', color:'var(--gray-400)'}}>{pct}% des charges</div>
                                        <div style={{height:'4px', background:'var(--gray-200)', borderRadius:'2px', marginTop:'6px'}}>
                                            <div style={{height:'100%', width:`${Math.min(parseFloat(pct)*2, 100)}%`, background:c.color, borderRadius:'2px'}}></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{display:'flex', gap:'16px', marginTop:'16px', padding:'12px', background:'var(--berry-pale)', borderRadius:'8px'}}>
                            <div style={{flex:1, textAlign:'center'}}>
                                <div style={{fontSize:'10px', fontWeight:'600', color:'var(--gray-400)', textTransform:'uppercase'}}>Intrants & Terrain</div>
                                <div style={{fontSize:'16px', fontWeight:'700', color:'var(--green)'}}>{(intrantsCharges/1000).toFixed(0)}K DH</div>
                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>{Math.round(intrantsCharges/totalChargesDisplay*100)}%</div>
                            </div>
                            <div style={{flex:1, textAlign:'center'}}>
                                <div style={{fontSize:'10px', fontWeight:'600', color:'var(--gray-400)', textTransform:'uppercase'}}>Main d'Oeuvre</div>
                                <div style={{fontSize:'16px', fontWeight:'700', color:'var(--red)'}}>{(moCharges/1000).toFixed(0)}K DH</div>
                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>{Math.round(moCharges/totalChargesDisplay*100)}%</div>
                            </div>
                            <div style={{flex:1, textAlign:'center'}}>
                                <div style={{fontSize:'10px', fontWeight:'600', color:'var(--gray-400)', textTransform:'uppercase'}}>Structure & Frais</div>
                                <div style={{fontSize:'16px', fontWeight:'700', color:'var(--blue)'}}>{(structureCharges/1000).toFixed(0)}K DH</div>
                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>{Math.round(structureCharges/totalChargesDisplay*100)}%</div>
                            </div>
                        </div>
                    </Panel>

                    {/* Comptabilité Analytique M.O par Variété */}
                    <Panel title="Comptabilité Analytique M.O par Variété" icon="fa-users-gear">
                        {!moAnalytique ? (
                            <div style={{textAlign:'center',padding:30,color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-spinner fa-spin" style={{marginRight:8}}></i>Chargement données M.O...
                            </div>
                        ) : (() => {
                            const rows = (moAnalytique.parVariete || []).filter(v => !farmFilter || v.ferme === farmFilter);
                            const tot = rows.reduce((a, v) => ({ recolte: a.recolte + v.recolte.cout, horsRecolte: a.horsRecolte + v.horsRecolte.cout, postesFixes: a.postesFixes + v.postesFixes.cout, total: a.total + v.total.cout }), { recolte: 0, horsRecolte: 0, postesFixes: 0, total: 0 });
                            const COLORS_MO = ['#8B2252','#2D8B4E','#D4A847','#3498DB','#E67E22','#9B59B6','#E74C3C','#1ABC9C'];
                            return React.createElement('div', null,
                                React.createElement('div', {style:{display:'flex',gap:16,marginBottom:16,flexWrap:'wrap'}},
                                    [{label:'Récolte',val:tot.recolte,color:'#E74C3C'},{label:'Hors Récolte',val:tot.horsRecolte,color:'#3498DB'},{label:'Ouvriers Avocatier',val:tot.postesFixes,color:'#95A5A6'},{label:'Total M.O',val:tot.total,color:'#8B2252'}].map((s,i) =>
                                        React.createElement('div', {key:i, style:{flex:1,minWidth:120,background:'#f8f9fa',borderRadius:10,padding:'12px 16px',textAlign:'center'}},
                                            React.createElement('div', {style:{fontSize:10,textTransform:'uppercase',letterSpacing:'0.5px',color:'#888',marginBottom:4}}, s.label),
                                            React.createElement('div', {style:{fontSize:18,fontWeight:700,color:s.color}}, (s.val/1000).toFixed(0) + 'k')
                                        )
                                    )
                                ),
                                React.createElement('table', {className:'data-table'},
                                    React.createElement('thead', null,
                                        React.createElement('tr', null,
                                            React.createElement('th', null, 'Variété'),
                                            React.createElement('th', null, 'Culture'),
                                            React.createElement('th', null, 'Ferme'),
                                            React.createElement('th', {style:{textAlign:'right'}}, 'Récolte (DH)'),
                                            React.createElement('th', {style:{textAlign:'right'}}, 'Hors Récolte (DH)'),
                                            React.createElement('th', {style:{textAlign:'right'}}, 'Ouvrier Avocatier (DH)'),
                                            React.createElement('th', {style:{textAlign:'right'}}, 'Total (DH)'),
                                            React.createElement('th', {style:{textAlign:'right'}}, '%')
                                        )
                                    ),
                                    React.createElement('tbody', null,
                                        rows.map((v, i) =>
                                            React.createElement('tr', {key:i},
                                                React.createElement('td', null, React.createElement('strong', null, v.variete)),
                                                React.createElement('td', null, React.createElement('span', {style:{fontSize:11,padding:'2px 8px',borderRadius:12,background: v.culture==='Framboise'?'rgba(139,34,82,0.1)':v.culture==='Myrtille'?'rgba(52,152,219,0.1)':'rgba(45,139,78,0.1)',color: v.culture==='Framboise'?'#8B2252':v.culture==='Myrtille'?'#3498DB':'#2D8B4E',fontWeight:600}}, v.culture)),
                                                React.createElement('td', null, v.ferme),
                                                React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, v.recolte.cout.toLocaleString('fr-FR')),
                                                React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, v.horsRecolte.cout.toLocaleString('fr-FR')),
                                                React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, v.postesFixes.cout.toLocaleString('fr-FR')),
                                                React.createElement('td', {style:{textAlign:'right',fontWeight:700,fontFamily:'monospace'}}, v.total.cout.toLocaleString('fr-FR')),
                                                React.createElement('td', {style:{textAlign:'right',color:'#888'}}, tot.total > 0 ? Math.round(v.total.cout / tot.total * 100) + '%' : '-')
                                            )
                                        ),
                                        React.createElement('tr', {style:{background:'var(--berry-pale)',fontWeight:700}},
                                            React.createElement('td', {colSpan:3}, 'TOTAL'),
                                            React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, tot.recolte.toLocaleString('fr-FR')),
                                            React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, tot.horsRecolte.toLocaleString('fr-FR')),
                                            React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, tot.postesFixes.toLocaleString('fr-FR')),
                                            React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, tot.total.toLocaleString('fr-FR')),
                                            React.createElement('td', {style:{textAlign:'right'}}, '100%')
                                        )
                                    )
                                ),
                                React.createElement('div', {style:{marginTop:16}},
                                    rows.map((v, i) => {
                                        const pct = tot.total > 0 ? (v.total.cout / tot.total * 100) : 0;
                                        return React.createElement('div', {key:i, style:{display:'flex',alignItems:'center',gap:8,marginBottom:6}},
                                            React.createElement('div', {style:{width:90,fontSize:11,fontWeight:600,textAlign:'right',color:'#555'}}, v.variete),
                                            React.createElement('div', {style:{flex:1,height:18,background:'#f0f0f0',borderRadius:4,overflow:'hidden'}},
                                                React.createElement('div', {style:{width:pct+'%',height:'100%',background:COLORS_MO[i % COLORS_MO.length],borderRadius:4,transition:'width 0.5s',minWidth: pct > 0 ? 2 : 0}})
                                            ),
                                            React.createElement('div', {style:{width:45,fontSize:11,color:'#888',textAlign:'right'}}, Math.round(pct)+'%')
                                        );
                                    })
                                )
                            );
                        })()}
                    </Panel>

                    {/* CPC par Variété */}
                    <Panel title="CPC par Variété — Total & par Ha" icon="fa-table-columns">
                        {!moAnalytique ? (
                            <div style={{textAlign:'center',padding:30,color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-spinner fa-spin" style={{marginRight:8}}></i>Chargement...
                            </div>
                        ) : (() => {
                            // Aggregate cpcVarietes by variete+ferme — Maravilla séparée en Green Cane / Long Cane
                            const vaMap = {};
                            (data.cpcVarietes || []).forEach(v => {
                                const vn = v.code === 'AVOCAT' ? 'Avocat' : v.code === 'S1S4_MAR_MD' ? 'Maravilla GC' : v.code === 'S3S7_MAR_MT' ? 'Maravilla LC' : v.label.includes('Yazmin') ? 'Yazmin' : v.label.includes('Reyna') ? 'Reyna' : v.label.includes('Corina') ? 'Corina' : v.label.includes('Cascade') ? 'Cascade' : v.label.includes('Breeze') ? 'Breeze' : 'Autre';
                                const ferme = v.code === 'AVOCAT' ? 'Avocatier' : v.code.includes('S10') || v.code.includes('S13') || v.code.includes('S9') || v.code === 'CORINA' ? 'F5' : v.code === 'CASCADE' || v.code === 'BREEZE' ? 'F5' : v.ferme;
                                const key = vn + '|' + ferme;
                                if (!vaMap[key]) vaMap[key] = { variete: vn, ferme, ha: 0, caExport: 0, caLocal: 0, culture: v.code === 'AVOCAT' ? 'Avocat' : ['Corina','Cascade','Breeze'].includes(vn) ? 'Myrtille' : 'Framboise' };
                                vaMap[key].ha += v.ha;
                                vaMap[key].caExport += v.caExport;
                                vaMap[key].caLocal += v.caLocal;
                            });

                            // Build CPC rows per variety
                            const moRows = moAnalytique.parVariete || [];
                            const varieties = Object.values(vaMap).filter(v => !farmFilter || v.ferme === farmFilter).sort((a, b) => (b.caExport + b.caLocal) - (a.caExport + a.caLocal));
                            const totalHaFiltered = varieties.reduce((s, v) => s + v.ha, 0);

                            // Get MO data for each variety (Maravilla GC/LC both map to "Maravilla" in BEE ONE — split by Ha ratio)
                            const getMo = (variete, ferme) => {
                                const isMarGC = variete === 'Maravilla GC';
                                const isMarLC = variete === 'Maravilla LC';
                                const moVariete = (isMarGC || isMarLC) ? 'Maravilla' : variete;
                                const raw = moRows.find(m => m.variete === moVariete && m.ferme === ferme) || { recolte: {cout:0}, horsRecolte: {cout:0}, horsRecolteDetail: {}, postesFixes: {cout:0}, total: {cout:0} };
                                if (!isMarGC && !isMarLC) return raw;
                                // Split Maravilla MO by Ha ratio: GC=4.2Ha, LC=5.2Ha
                                const haGC = 4.2, haLC = 5.2, haTotal = haGC + haLC;
                                const ratio = isMarGC ? haGC / haTotal : haLC / haTotal;
                                const scale = (obj) => ({ jh: Math.round((obj.jh || 0) * ratio * 100) / 100, cout: Math.round((obj.cout || 0) * ratio) });
                                const hrDetail = {};
                                for (const [op, val] of Object.entries(raw.horsRecolteDetail || {})) { hrDetail[op] = scale(val); }
                                return { recolte: scale(raw.recolte), horsRecolte: scale(raw.horsRecolte), horsRecolteDetail: hrDetail, postesFixes: scale(raw.postesFixes), total: scale(raw.total) };
                            };

                            // === Modes d'affectation selon SOURCE CPC BGF.xlsx ===
                            const charges = data.cpcCharges || [];
                            const haByFerme = {};
                            varieties.forEach(v => { haByFerme[v.ferme] = (haByFerme[v.ferme] || 0) + v.ha; });
                            const totalHaAll = Object.values(haByFerme).reduce((s, h) => s + h, 0);

                            // S.C/S.C.F — surface cultivée / surface cultivée par ferme
                            const allocateSCSCF = (total, fermeCharge, v) => {
                                if (fermeCharge && fermeCharge !== 'Toutes' && !fermeCharge.includes('+')) {
                                    if (v.ferme !== fermeCharge) return 0;
                                    return haByFerme[v.ferme] > 0 ? total * (v.ha / haByFerme[v.ferme]) : 0;
                                }
                                return totalHaAll > 0 ? total * (v.ha / totalHaAll) : 0;
                            };
                            // S.C/S.C.T — surface cultivée / surface cultivée totale
                            const allocateSCSCT = (total, v) => totalHaAll > 0 ? total * (v.ha / totalHaAll) : 0;
                            // C.R.M.O — clé de répartition M.O (proportionnel au coût M.O réel)
                            const totalMO = varieties.reduce((s, v) => s + getMo(v.variete, v.ferme).total.cout, 0);
                            const allocateCRMO = (total, v) => {
                                const moVar = getMo(v.variete, v.ferme).total.cout;
                                return totalMO > 0 ? total * (moVar / totalMO) : 0;
                            };

                            // Consumption costs by variety (Engrais / Pesticides)
                            const VARIETY_CPC_CODES = {
                                'Maravilla GC|F1': ['S1S4_MAR_MD'],
                                'Maravilla LC|F1': ['S3S7_MAR_MT'],
                                'Yazmin|F1': ['S2S5_YAZ_MD'],
                                'Yazmin|F5': ['S10_YAZ_MT', 'S13_YAZ_MD'],
                                'Reyna|F5': ['S9_REYNA'],
                                'Corina|F5': ['CORINA'],
                                'Avocat|Avocatier': ['AVOCAT'],
                                'Cascade|F5': ['CASCADE'],
                                'Breeze|F5': ['BREEZE'],
                            };
                            const getConsumptionCost = (variete, ferme, bucket) => {
                                if (!consumptionCosts) return null;
                                const codes = VARIETY_CPC_CODES[variete + '|' + ferme];
                                if (!codes) return null;
                                let total = 0;
                                for (const code of codes) {
                                    const cc = consumptionCosts[code];
                                    if (cc) total += (bucket === 'engrais' ? cc.engrais_ttc : cc.pesticides_ttc) || 0;
                                }
                                return total;
                            };
                            const hasLiveCosts = !!consumptionCosts;

                            // Helper: get charge total by poste name
                            const chargeTotal = (poste) => (charges.find(c => c.poste === poste) || {}).total || 0;
                            const chargeOf = (poste) => charges.find(c => c.poste === poste) || {};

                            // --- CA Live from liquidations ---
                            const liqCAByVariety = {};
                            if (liqData) {
                                const expByReceipt = {};
                                (liqData.expeditions || []).forEach(exp => {
                                    const rid = (exp.receiptId || '').trim();
                                    if (rid) expByReceipt[rid] = exp;
                                });
                                const addLiqCA = (variete, ferme, kg, montant) => {
                                    const key = variete + '|' + ferme;
                                    if (!liqCAByVariety[key]) liqCAByVariety[key] = { kg: 0, montant: 0 };
                                    liqCAByVariety[key].kg += kg;
                                    liqCAByVariety[key].montant += montant;
                                };
                                (liqData.liquidations || []).forEach(liq => {
                                    (liq.rows || []).forEach(row => {
                                        const kg = row.receiptQtyKg || 0;
                                        const gs = row.gsNet || 0;
                                        if (kg <= 0 && gs <= 0) return;
                                        const vName = row.variety || row.varietyCode || '';
                                        const norm = normalizeParcelle(vName);
                                        let variete = norm ? norm.variete : vName;
                                        let ferme = norm ? norm.ferme : null;

                                        // Try to resolve ferme/sous-variete from expedition match
                                        const rid = (row.receiptId || '').trim();
                                        const matchedExp = rid ? expByReceipt[rid] : null;
                                        if (matchedExp) {
                                            if (!ferme) ferme = matchedExp.ferme;
                                            // Try to get GC/LC from expedition variety
                                            if (variete === 'Maravilla' && (!norm || !norm.sousVariete)) {
                                                const expNorm = normalizeParcelle(matchedExp.variety);
                                                if (expNorm && expNorm.sousVariete === 'Green Cane') variete = 'Maravilla GC';
                                                else if (expNorm && expNorm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                                                else if (expNorm && expNorm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                                            }
                                        }

                                        // Separate Maravilla GC / LC from normalization
                                        if (variete === 'Maravilla' && norm && norm.sousVariete) {
                                            if (norm.sousVariete === 'Green Cane' || norm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                                            else if (norm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                                        }

                                        // Maravilla without GC/LC distinction → split by Ha ratio
                                        if (variete === 'Maravilla') {
                                            const haGC = 4.2, haLC = 5.2, haT = haGC + haLC;
                                            addLiqCA('Maravilla GC', 'F1', kg * haGC / haT, gs * haGC / haT);
                                            addLiqCA('Maravilla LC', 'F1', kg * haLC / haT, gs * haLC / haT);
                                            return;
                                        }
                                        // Yazmin without ferme → split by Ha ratio F1(2Ha) / F5(4.7Ha)
                                        if (variete === 'Yazmin' && !matchedExp) {
                                            const haF1 = 2.0, haF5 = 4.7, haT = haF1 + haF5;
                                            addLiqCA('Yazmin', 'F1', kg * haF1 / haT, gs * haF1 / haT);
                                            addLiqCA('Yazmin', 'F5', kg * haF5 / haT, gs * haF5 / haT);
                                            return;
                                        }
                                        if (!ferme) ferme = 'F1';
                                        addLiqCA(variete, ferme, kg, gs);
                                    });
                                });
                            }
                            const hasLiqData = Object.keys(liqCAByVariety).length > 0;

                            // --- CA Prévisionnel: expeditions de semaines non liquidées × prix moyen ---
                            const prevCAByVariety = {};
                            if (liqData && hasLiqData) {
                                // Build set of liquidated WEEKS (same logic as Liquidations Qualité tab)
                                const liquidatedWeeks = new Set();
                                (liqData.liquidations || []).forEach(liq => {
                                    if (!liq.week) return;
                                    const m = (liq.subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                                    const y = m ? parseInt(m[1]) : (liq.date ? new Date(liq.date).getFullYear() : 2025);
                                    liquidatedWeeks.add(`${y}-W${liq.week}`);
                                });
                                // ISO week helpers
                                const getExpWeek = (dateStr) => {
                                    if (!dateStr) return null;
                                    const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                                    if (!m) { const m2 = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m2) return null; const d = new Date(parseInt(m2[1]), parseInt(m2[2])-1, parseInt(m2[3])); d.setDate(d.getDate()+3-(d.getDay()+6)%7); const w1 = new Date(d.getFullYear(),0,4); return 1+Math.round(((d.getTime()-w1.getTime())/86400000-3+(w1.getDay()+6)%7)/7); }
                                    const d = new Date(parseInt(m[3]), parseInt(m[1])-1, parseInt(m[2])); d.setDate(d.getDate()+3-(d.getDay()+6)%7); const w1 = new Date(d.getFullYear(),0,4); return 1+Math.round(((d.getTime()-w1.getTime())/86400000-3+(w1.getDay()+6)%7)/7);
                                };
                                const getExpYear = (dateStr) => {
                                    if (!dateStr) return null;
                                    const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                                    if (!m) { const m2 = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m2) return null; const d = new Date(parseInt(m2[1]), parseInt(m2[2])-1, parseInt(m2[3])); d.setDate(d.getDate()+3-(d.getDay()+6)%7); return d.getFullYear(); }
                                    const d = new Date(parseInt(m[3]), parseInt(m[1])-1, parseInt(m[2])); d.setDate(d.getDate()+3-(d.getDay()+6)%7); return d.getFullYear();
                                };
                                // Average price per variety from liquidations
                                const avgPriceByVar = {};
                                Object.entries(liqCAByVariety).forEach(([key, val]) => {
                                    if (val.kg > 0) avgPriceByVar[key] = val.montant / val.kg;
                                });
                                const globalAvgPrice = Object.values(liqCAByVariety).reduce((s, v) => s + v.montant, 0) / Math.max(Object.values(liqCAByVariety).reduce((s, v) => s + v.kg, 0), 1);
                                // Non-liquidated expeditions (by WEEK, not receiptId)
                                const addPrevCA = (variete, ferme, amount) => {
                                    const key = variete + '|' + ferme;
                                    if (!prevCAByVariety[key]) prevCAByVariety[key] = 0;
                                    prevCAByVariety[key] += amount;
                                };
                                (liqData.expeditions || []).filter(e => e.overallResult !== 'REJECT').forEach(exp => {
                                    const w = getExpWeek(exp.date || '');
                                    const y = getExpYear(exp.date || '');
                                    if (!w || !y) return;
                                    if (liquidatedWeeks.has(`${y}-W${w}`)) return; // week already liquidated
                                    const kg = exp.batchWeight || 0;
                                    if (kg <= 0) return;
                                    const norm = normalizeParcelle(exp.variety);
                                    let variete = norm ? norm.variete : (exp.variety || '');
                                    let ferme = exp.ferme || (norm ? norm.ferme : 'F1');
                                    if (variete === 'Maravilla' && norm && norm.sousVariete) {
                                        if (norm.sousVariete === 'Green Cane' || norm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                                        else if (norm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                                    }
                                    // Maravilla without GC/LC → split by Ha
                                    if (variete === 'Maravilla') {
                                        const haGC = 4.2, haLC = 5.2, haT = haGC + haLC;
                                        const priceGC = avgPriceByVar['Maravilla GC|F1'] || globalAvgPrice;
                                        const priceLC = avgPriceByVar['Maravilla LC|F1'] || globalAvgPrice;
                                        addPrevCA('Maravilla GC', 'F1', kg * haGC / haT * priceGC);
                                        addPrevCA('Maravilla LC', 'F1', kg * haLC / haT * priceLC);
                                        return;
                                    }
                                    // Yazmin without expedition ferme → split F1/F5
                                    if (variete === 'Yazmin' && !exp.ferme) {
                                        const haF1 = 2.0, haF5 = 4.7, haT = haF1 + haF5;
                                        const priceF1 = avgPriceByVar['Yazmin|F1'] || globalAvgPrice;
                                        const priceF5 = avgPriceByVar['Yazmin|F5'] || globalAvgPrice;
                                        addPrevCA('Yazmin', 'F1', kg * haF1 / haT * priceF1);
                                        addPrevCA('Yazmin', 'F5', kg * haF5 / haT * priceF5);
                                        return;
                                    }
                                    const key = variete + '|' + ferme;
                                    const price = avgPriceByVar[key] || globalAvgPrice;
                                    if (!prevCAByVariety[key]) prevCAByVariety[key] = 0;
                                    prevCAByVariety[key] += kg * price;
                                });
                            }
                            const hasPrevCA = Object.keys(prevCAByVariety).length > 0;

                            // --- CA Marché Local par variété (pfq_interne + bons_marche_local) ---
                            const localCAByVariety = {};
                            if (marcheLocalBons && marcheLocalBons.length > 0) {
                                marcheLocalBons.forEach(bon => {
                                    const rawVariete = bon.variete || bon.blocVariete || bon.designation || '';
                                    const norm = normalizeParcelle(rawVariete);
                                    let variete = norm ? norm.variete : (rawVariete || 'Autre');
                                    let ferme = bon.ferme || bon.blocFerme || (norm ? norm.ferme : 'F1');
                                    if (variete === 'Maravilla' && norm && norm.sousVariete) {
                                        if (norm.sousVariete === 'Green Cane' || norm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                                        else if (norm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                                    }
                                    // Maravilla sans GC/LC → split par Ha
                                    if (variete === 'Maravilla') {
                                        const montant = parseFloat(bon.totalDH) || 0;
                                        const haGC = 4.2, haLC = 5.2, haT = haGC + haLC;
                                        const kGC = 'Maravilla GC|F1', kLC = 'Maravilla LC|F1';
                                        if (!localCAByVariety[kGC]) localCAByVariety[kGC] = 0;
                                        if (!localCAByVariety[kLC]) localCAByVariety[kLC] = 0;
                                        localCAByVariety[kGC] += montant * haGC / haT;
                                        localCAByVariety[kLC] += montant * haLC / haT;
                                        return;
                                    }
                                    const key = variete + '|' + ferme;
                                    if (!localCAByVariety[key]) localCAByVariety[key] = 0;
                                    const montant = parseFloat(bon.totalDH) || ((parseFloat(bon.poidsLot) || 0) * (parseFloat(bon.prixDH) || 0));
                                    localCAByVariety[key] += montant;
                                });
                            }
                            const hasLocalCA = Object.keys(localCAByVariety).length > 0;

                            const getCA = (v) => {
                                if (hasLiqData) {
                                    const lv = liqCAByVariety[v.variete + '|' + v.ferme];
                                    return lv ? lv.montant : 0;
                                }
                                return v.caExport + v.caLocal;
                            };
                            const getPrevCA = (v) => prevCAByVariety[v.variete + '|' + v.ferme] || 0;
                            const getLocalCA = (v) => {
                                if (hasLocalCA) return localCAByVariety[v.variete + '|' + v.ferme] || 0;
                                return v.caLocal || 0;
                            };
                            const getTotalCA = (v) => getCA(v) + getPrevCA(v) + getLocalCA(v);

                            // --- HR sub-lines: collect top 6 operation families ---
                            const hrOpTotals = {};
                            moRows.forEach(m => {
                                Object.entries(m.horsRecolteDetail || {}).forEach(([op, val]) => {
                                    if (!hrOpTotals[op]) hrOpTotals[op] = 0;
                                    hrOpTotals[op] += val.cout || 0;
                                });
                            });
                            const sortedHrOps = Object.entries(hrOpTotals).sort((a, b) => b[1] - a[1]);
                            const topHrOps = sortedHrOps.slice(0, 6).map(([op]) => op);
                            const otherHrOps = sortedHrOps.slice(6).map(([op]) => op);
                            const HR_ICONS = { '1. Taille': 'fa-scissors', '2. Entretien': 'fa-broom', '3. Paillage': 'fa-layer-group', '4. Palissage': 'fa-grip-lines-vertical', '5. Traitement': 'fa-spray-can', '6. Fertigation': 'fa-droplet', '7. Plantation': 'fa-seedling', '9. Irrigation': 'fa-faucet-drip', '10. Tuteurage': 'fa-arrows-up-down' };

                            // CPC lines — modes d'affectation selon SOURCE CPC BGF.xlsx
                            const cpcLines = [
                                // --- PRODUITS ---
                                { label: hasLiqData ? 'CA Liquidé' : 'CA Export', icon: 'fa-plane-departure', color: '#2D8B4E', getValue: (v) => getCA(v), source: hasLiqData ? 'live' : 'hardcode' },
                                ...(hasPrevCA ? [{ label: 'CA Prévisionnel', icon: 'fa-clock', color: '#F39C12', getValue: (v) => getPrevCA(v), source: 'live' }] : []),
                                { label: 'CA Marché Local', icon: 'fa-store', color: '#8B6914', getValue: (v) => getLocalCA(v), source: hasLocalCA ? 'live' : 'hardcode' },
                                { label: 'CA Total', icon: 'fa-coins', color: '#D4A847', getValue: (v) => getTotalCA(v), bold: true, source: hasLiqData ? 'live' : 'hardcode' },
                                { label: '─', separator: true },
                                // --- M.O (REEL — LIVE BEE ONE) ---
                                { label: 'M.O Récolte', icon: 'fa-people-carry-box', color: '#E74C3C', getValue: (v) => getMo(v.variete, v.ferme).recolte.cout, isCharge: true, source: 'live' },
                                { label: 'M.O Hors Récolte', icon: 'fa-users', color: '#C0392B', getValue: (v) => getMo(v.variete, v.ferme).horsRecolte.cout, isCharge: true, source: 'live', bold: true },
                                // HR sub-lines (top 6 + autres)
                                ...topHrOps.map(op => ({
                                    label: op.replace(/^\d+\.\s*/, ''), icon: HR_ICONS[op] || 'fa-circle', color: '#C0392B', isCharge: true, subLine: true, source: 'live', indent: true,
                                    getValue: (v) => (getMo(v.variete, v.ferme).horsRecolteDetail || {})[op]?.cout || 0,
                                })),
                                ...(otherHrOps.length > 0 ? [{
                                    label: 'Autres HR', icon: 'fa-ellipsis', color: '#C0392B', isCharge: true, subLine: true, source: 'live', indent: true,
                                    getValue: (v) => { const d = getMo(v.variete, v.ferme).horsRecolteDetail || {}; return otherHrOps.reduce((s, op) => s + (d[op]?.cout || 0), 0); },
                                }] : []),
                                { label: 'M.O Ouvrier Avocatier', icon: 'fa-user-clock', color: '#95A5A6', getValue: (v) => getMo(v.variete, v.ferme).postesFixes.cout, isCharge: true, source: 'live' },
                                { label: 'Total M.O', icon: 'fa-users-gear', color: '#8B2252', getValue: (v) => getMo(v.variete, v.ferme).total.cout, isCharge: true, bold: true, source: 'live' },
                                { label: '─', separator: true },
                                // --- REEL (hardcodé, à connecter) ---
                                { label: 'Plants', icon: 'fa-seedling', color: 'var(--green)', getValue: (v) => allocateSCSCF(chargeTotal('Plants'), chargeOf('Plants').ferme, v), isCharge: true, source: 'hardcode' },
                                // --- REEL (Engrais/Pesticides — LIVE si consumptionCosts) ---
                                { label: 'Engrais', icon: 'fa-flask', color: '#27AE60', isCharge: true, source: hasLiveCosts ? 'live' : 'hardcode',
                                  getValue: (v) => { const lv = getConsumptionCost(v.variete, v.ferme, 'engrais'); return lv !== null ? lv : allocateSCSCF(chargeTotal('Engrais'), chargeOf('Engrais').ferme, v); } },
                                { label: 'Pesticides', icon: 'fa-spray-can-sparkles', color: '#E67E22', isCharge: true, source: hasLiveCosts ? 'live' : 'hardcode',
                                  getValue: (v) => { const lv = getConsumptionCost(v.variete, v.ferme, 'pesticides'); return lv !== null ? lv : allocateSCSCF(chargeTotal('Pesticides'), chargeOf('Pesticides').ferme, v); } },
                                { label: '─', separator: true },
                                // --- S.C/S.C.F (surface cultivée / surface par ferme) ---
                                { label: 'Loyer Terrains', icon: 'fa-land-mine-on', color: '#8B6914', getValue: (v) => allocateSCSCF(chargeTotal('Loyer Terrains'), chargeOf('Loyer Terrains').ferme, v), isCharge: true, source: 'S.C/S.C.F' },
                                { label: 'Électricité', icon: 'fa-bolt', color: '#F1C40F', getValue: (v) => allocateSCSCF(chargeTotal('Électricité'), chargeOf('Électricité').ferme, v), isCharge: true, source: 'S.C/S.C.F' },
                                { label: 'Autres Intrants', icon: 'fa-box', color: '#9B59B6', getValue: (v) => allocateSCSCF(chargeTotal('Autres Intrants'), chargeOf('Autres Intrants').ferme, v), isCharge: true, source: 'S.C/S.C.F' },
                                // --- S.C/S.C.T (surface cultivée / surface totale) ---
                                { label: 'Eau ORMVAL', icon: 'fa-droplet', color: '#3498DB', getValue: (v) => allocateSCSCT(chargeTotal('Eau ORMVAL'), v), isCharge: true, source: 'S.C/S.C.T' },
                                { label: '─', separator: true },
                                // --- C.R.M.O (clé de répartition M.O) ---
                                { label: 'Gasoil & Gaz', icon: 'fa-gas-pump', color: '#95A5A6', getValue: (v) => allocateCRMO(fuelData ? (fuelData.totalCampagne || 0) + (fuelData.totalPeages || 0) : chargeTotal('Gasoil & Gaz'), v), isCharge: true, source: fuelData ? 'live' : 'C.R.M.O' },
                                { label: 'Transport & Divers', icon: 'fa-truck', color: '#7F8C8D', getValue: (v) => allocateCRMO(chargeTotal('Transport & Divers'), v), isCharge: true, source: 'C.R.M.O' },
                                { label: 'STC Ouvriers', icon: 'fa-money-check', color: '#2C3E50', getValue: (v) => allocateCRMO(chargeTotal('STC Ouvriers'), v), isCharge: true, source: 'C.R.M.O' },
                                { label: 'Encadrement', icon: 'fa-user-tie', color: '#8E44AD', getValue: (v) => allocateCRMO(chargeTotal('Encadrement'), v), isCharge: true, source: 'C.R.M.O' },
                                { label: 'CNSS', icon: 'fa-shield-halved', color: '#16A085', getValue: (v) => allocateCRMO(chargeTotal('CNSS'), v), isCharge: true, source: 'C.R.M.O' },
                                { label: 'IR', icon: 'fa-receipt', color: '#D35400', getValue: (v) => allocateCRMO(chargeTotal('IR'), v), isCharge: true, source: 'C.R.M.O' },
                                { label: 'Frais Généraux', icon: 'fa-building', color: '#34495E', getValue: (v) => allocateCRMO(chargeTotal('Frais Généraux'), v), isCharge: true, source: 'C.R.M.O' },
                                { label: '─', separator: true },
                            ];

                            // Compute totals
                            const getTotalCharges = (v) => {
                                return cpcLines.filter(l => l.isCharge && !l.bold && !l.subLine).reduce((s, l) => s + l.getValue(v), 0);
                            };
                            const getResultat = (v) => getTotalCA(v) - getTotalCharges(v);

                            const fmt = (val, ha) => {
                                const v = cpcMode === 'ha' && ha > 0 ? val / ha : val;
                                if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(1) + 'M';
                                if (Math.abs(v) >= 1000) return Math.round(v / 1000) + 'k';
                                return Math.round(v).toLocaleString('fr-FR');
                            };

                            return React.createElement('div', null,
                                // Toggle
                                React.createElement('div', {style:{display:'flex',gap:8,marginBottom:16,justifyContent:'flex-end'}},
                                    ['total','ha'].map(m => React.createElement('button', {key:m, onClick:()=>setCpcMode(m), style:{padding:'6px 16px',borderRadius:8,border: cpcMode===m?'2px solid var(--berry)':'1px solid #ddd',background: cpcMode===m?'var(--berry-pale)':'#fff',color: cpcMode===m?'var(--berry)':'#666',fontWeight:cpcMode===m?700:500,fontSize:12,cursor:'pointer'}}, m === 'total' ? 'Total (DH)' : 'Par Hectare (DH/Ha)'))
                                ),
                                // Table
                                React.createElement('div', {style:{overflowX:'auto'}},
                                    React.createElement('table', {className:'data-table', style:{fontSize:11,whiteSpace:'nowrap'}},
                                        React.createElement('thead', null,
                                            React.createElement('tr', null,
                                                React.createElement('th', {style:{position:'sticky',left:0,background:'#fff',zIndex:2,minWidth:140}}, 'Poste'),
                                                ...varieties.map(v => React.createElement('th', {key:v.variete+v.ferme, style:{textAlign:'right',minWidth:90}},
                                                    React.createElement('div', null, v.variete),
                                                    React.createElement('div', {style:{fontSize:9,color:'#888',fontWeight:400}}, v.ferme + ' · ' + v.ha + ' Ha')
                                                )),
                                                React.createElement('th', {style:{textAlign:'right',minWidth:100,background:'var(--gray-100)'}}, 'TOTAL')
                                            )
                                        ),
                                        React.createElement('tbody', null,
                                            // CPC lines
                                            ...cpcLines.map((line, i) => {
                                                if (line.separator) return React.createElement('tr', {key:'sep'+i}, React.createElement('td', {colSpan:varieties.length+2, style:{padding:2,background:'var(--gray-100)'}}));
                                                const lineTotal = varieties.reduce((s, v) => s + line.getValue(v), 0);
                                                return React.createElement('tr', {key:i, style: line.bold ? {background:'var(--gray-50)',fontWeight:700} : line.indent ? {opacity:0.85} : {}},
                                                    React.createElement('td', {style:{position:'sticky',left:0,background: line.bold?'var(--gray-50)':'#fff',zIndex:1}},
                                                        React.createElement('div', {style:{display:'flex',alignItems:'center',gap:6, ...(line.indent ? {paddingLeft:22,fontSize:11} : {})}},
                                                            line.icon && React.createElement('i', {className:'fa-solid '+line.icon, style:{color:line.color,fontSize: line.indent ? 9 : 10,width:14,textAlign:'center', opacity: line.indent ? 0.6 : 1}}),
                                                            React.createElement('span', null, line.label),
                                                            line.source === 'live' && React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#d4edda',color:'#155724',fontWeight:700,letterSpacing:'0.5px'}}, 'LIVE'),
                                                            line.source === 'hardcode' && React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#fff3cd',color:'#856404',fontWeight:700,letterSpacing:'0.5px'}}, 'HARDCODÉ'),
                                                            line.source === 'S.C/S.C.F' && React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#d1ecf1',color:'#0c5460',fontWeight:700,letterSpacing:'0.5px'}}, 'S.C/S.C.F'),
                                                            line.source === 'S.C/S.C.T' && React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#cce5ff',color:'#004085',fontWeight:700,letterSpacing:'0.5px'}}, 'S.C/S.C.T'),
                                                            line.source === 'C.R.M.O' && React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#e8daef',color:'#6c3483',fontWeight:700,letterSpacing:'0.5px'}}, 'C.R.M.O')
                                                        )
                                                    ),
                                                    ...varieties.map(v => {
                                                        const val = line.getValue(v);
                                                        const displayVal = cpcMode === 'ha' && v.ha > 0 ? val / v.ha : val;
                                                        return React.createElement('td', {key:v.variete+v.ferme, style:{textAlign:'right',fontFamily:'monospace',color: line.isCharge ? '#c0392b' : val > 0 ? '#2D8B4E' : '#888'}}, fmt(val, v.ha));
                                                    }),
                                                    React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace',fontWeight:700,background:'var(--gray-100)',color: line.isCharge ? '#c0392b' : lineTotal > 0 ? '#2D8B4E' : '#888'}}, fmt(lineTotal, totalHaFiltered))
                                                );
                                            }),
                                            // Total Charges
                                            React.createElement('tr', {style:{background:'#fef0f0',fontWeight:700}},
                                                React.createElement('td', {style:{position:'sticky',left:0,background:'#fef0f0',zIndex:1}}, React.createElement('span', null, React.createElement('i', {className:'fa-solid fa-minus-circle', style:{marginRight:6,color:'#c0392b',fontSize:10}}), 'Total Charges')),
                                                ...varieties.map(v => {
                                                    const val = getTotalCharges(v);
                                                    return React.createElement('td', {key:v.variete+v.ferme, style:{textAlign:'right',fontFamily:'monospace',color:'#c0392b'}}, fmt(val, v.ha));
                                                }),
                                                React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace',fontWeight:700,background:'var(--gray-100)',color:'#c0392b'}}, fmt(varieties.reduce((s,v) => s+getTotalCharges(v),0), totalHaFiltered))
                                            ),
                                            // Résultat
                                            React.createElement('tr', {style:{fontWeight:700,fontSize:12}},
                                                React.createElement('td', {style:{position:'sticky',left:0,background:'#fff',zIndex:1}}, React.createElement('span', null, React.createElement('i', {className:'fa-solid fa-equals', style:{marginRight:6,color:'#8B2252',fontSize:10}}), 'Résultat')),
                                                ...varieties.map(v => {
                                                    const val = getResultat(v);
                                                    return React.createElement('td', {key:v.variete+v.ferme, style:{textAlign:'right',fontFamily:'monospace',color: val >= 0 ? '#2D8B4E' : '#c0392b'}}, fmt(val, v.ha));
                                                }),
                                                React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace',fontWeight:700,background:'var(--gray-100)',color: varieties.reduce((s,v) => s+getResultat(v),0) >= 0 ? '#2D8B4E' : '#c0392b'}}, fmt(varieties.reduce((s,v) => s+getResultat(v),0), totalHaFiltered))
                                            )
                                        )
                                    )
                                ),
                                React.createElement('div', {style:{marginTop:12,display:'flex',gap:12,fontSize:10,color:'#666',flexWrap:'wrap',alignItems:'center'}},
                                    React.createElement('span', {style:{display:'flex',alignItems:'center',gap:4}}, React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#d4edda',color:'#155724',fontWeight:700}}, 'LIVE'), 'Réel BEE ONE'),
                                    React.createElement('span', {style:{display:'flex',alignItems:'center',gap:4}}, React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#fff3cd',color:'#856404',fontWeight:700}}, 'HARDCODÉ'), 'À vérifier'),
                                    React.createElement('span', {style:{display:'flex',alignItems:'center',gap:4}}, React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#d1ecf1',color:'#0c5460',fontWeight:700}}, 'S.C/S.C.F'), 'Surface/Ferme'),
                                    React.createElement('span', {style:{display:'flex',alignItems:'center',gap:4}}, React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#cce5ff',color:'#004085',fontWeight:700}}, 'S.C/S.C.T'), 'Surface/Total'),
                                    React.createElement('span', {style:{display:'flex',alignItems:'center',gap:4}}, React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#e8daef',color:'#6c3483',fontWeight:700}}, 'C.R.M.O'), 'Clé M.O'),
                                    fuelData && fuelData.updatedAt && React.createElement('span', {style:{marginLeft:'auto',color:'#999',fontStyle:'italic'}},
                                        React.createElement('i', {className:'fa-solid fa-gas-pump', style:{marginRight:4}}),
                                        'Fuel MAJ: ', fuelData.updatedAt.toDate ? fuelData.updatedAt.toDate().toLocaleDateString('fr-FR') : new Date(fuelData.updatedAt).toLocaleDateString('fr-FR')
                                    )
                                )
                            );
                        })()}
                    </Panel>

                    {/* EBE par variété */}
                    <Panel title="EBE par Variété Framboise" icon="fa-chart-bar">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Variété</th>
                                    <th style={{textAlign:'right'}}>EBE Total (DH)</th>
                                    <th style={{textAlign:'right'}}>EBE / Ha (DH)</th>
                                    <th style={{textAlign:'right'}}>% Prix Vente</th>
                                    <th>Rentabilité</th>
                                </tr>
                            </thead>
                            <tbody>
                                {undefined((v, i) => (
                                    <tr key={i}>
                                        <td><strong>{v.variete}</strong></td>
                                        <td style={{textAlign:'right', fontWeight:'600', color: v.ebe >= 0 ? 'var(--green)' : 'var(--red)'}}>{Math.round(v.ebe).toLocaleString('fr-FR')}</td>
                                        <td style={{textAlign:'right', color: v.ebeHa >= 0 ? 'var(--green)' : 'var(--red)'}}>{Math.round(v.ebeHa).toLocaleString('fr-FR')}</td>
                                        <td style={{textAlign:'right', color: v.pctCA >= 0 ? 'var(--green)' : 'var(--red)'}}>{v.pctCA}%</td>
                                        <td>
                                            <span className={`status-badge ${v.ebe >= 0 ? 'green' : 'red'}`}>
                                                {v.ebe >= 0 ? '✓ Rentable' : '✗ Déficitaire'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                <tr style={{background:'var(--red-pale)', fontWeight:'700'}}>
                                    <td>TOTAL EBE FRAMBOISE</td>
                                    <td style={{textAlign:'right', color:'var(--red)'}}>{Math.round(data.ebeFramboise).toLocaleString('fr-FR')}</td>
                                    <td></td>
                                    <td></td>
                                    <td><span className="status-badge red">Déficitaire</span></td>
                                </tr>
                            </tbody>
                        </table>
                        <SimpleBarChart
                            data={undefined(v => ({variete: v.variete.replace('S','').substring(0, 12), ebe: Math.round(v.ebe/1000)}))}
                            dataKeys={['ebe']}
                            colors={['#8B2252']}
                            xKey="variete"
                            height={200}
                        />
                    </Panel>

                    {/* Résultat par mois */}
                    <Panel title="Évolution Résultat Cumulé" icon="fa-chart-line">
                        <SimpleAreaChart
                            data={data.resultatParMois}
                            dataKeys={['resultat']}
                            colors={['#E74C3C']}
                            xKey="mois"
                            height={200}
                        />
                        <div style={{marginTop:'12px', padding:'12px', background:'var(--red-pale)', borderRadius:'8px', textAlign:'center'}}>
                            <div style={{fontSize:'11px', fontWeight:'600', color:'var(--gray-600)'}}>Résultat Avant Impôt (C.F & DEA inclus: {(data.cfDea/1000).toFixed(0)}K DH)</div>
                            <div style={{fontSize:'24px', fontWeight:'700', color:'var(--red)'}}>{(data.resultatAvantImpot/1000).toFixed(0)}K DH</div>
                            <div style={{fontSize:'11px', color:'var(--gray-400)'}}>Tonnage d'équilibre: 4 604 kg</div>
                        </div>
                    </Panel>

                    {/* ===== CHARGE DETAIL POPUP ===== */}
                    {selectedCharge && (
                        <div className="modal-overlay" onClick={() => setSelectedCharge(null)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:'700px', maxHeight:'90vh', overflowY:'auto'}}>
                                {/* Header */}
                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, paddingBottom:12, borderBottom:`3px solid ${selectedCharge.color}`}}>
                                    <div style={{display:'flex', alignItems:'center', gap:10}}>
                                        <div style={{width:40, height:40, borderRadius:10, background:selectedCharge.color+'20', display:'flex', alignItems:'center', justifyContent:'center'}}>
                                            <i className={`fa-solid ${selectedCharge.icon}`} style={{fontSize:18, color:selectedCharge.color}}></i>
                                        </div>
                                        <div>
                                            <div style={{fontSize:18, fontWeight:700}}>{selectedCharge.poste}</div>
                                            <div style={{fontSize:11, color:'var(--gray-400)'}}>{selectedCharge.fournisseur} | {selectedCharge.ferme}</div>
                                        </div>
                                    </div>
                                    <div style={{textAlign:'right'}}>
                                        <div style={{fontSize:22, fontWeight:700, color:selectedCharge.color}}>{(chargeElapsed(selectedCharge)/1000).toFixed(0)}K DH <span style={{fontSize:10, opacity:0.6, fontWeight:500}}>/ {(selectedCharge.total/1000).toFixed(0)}K</span></div>
                                        <div style={{fontSize:11, color:'var(--gray-400)'}}>{totalChargesDisplay > 0 ? (chargeElapsed(selectedCharge) / totalChargesDisplay * 100).toFixed(1) : '0'}% du total charges à date</div>
                                    </div>
                                </div>

                                {/* Détail par ligne */}
                                <div style={{marginBottom:16}}>
                                    <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                        <i className="fa-solid fa-list" style={{marginRight:6}}></i>Détail des dépenses
                                    </div>
                                    <table className="data-table" style={{fontSize:12}}>
                                        <thead>
                                            <tr><th>Description</th><th style={{textAlign:'right', width:120}}>Montant (DH)</th><th style={{textAlign:'right', width:60}}>%</th></tr>
                                        </thead>
                                        <tbody>
                                            {selectedCharge.detail.map((d, i) => (
                                                <tr key={i}>
                                                    <td>{d.desc}</td>
                                                    <td style={{textAlign:'right', fontWeight:600}}>{d.montant.toLocaleString('fr-FR')}</td>
                                                    <td style={{textAlign:'right', color:'var(--gray-400)'}}>{(d.montant/selectedCharge.total*100).toFixed(0)}%</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Évolution par mois */}
                                <div style={{marginBottom:16}}>
                                    <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                        <i className="fa-solid fa-chart-bar" style={{marginRight:6}}></i>Évolution mensuelle
                                    </div>
                                    {(() => {
                                        const mois = selectedCharge.parMois;
                                        const maxV = Math.max(...mois.map(m => m.v));
                                        return (
                                            <div style={{display:'flex', alignItems:'flex-end', gap:6, height:120, padding:'0 10px'}}>
                                                {mois.map((m, i) => {
                                                    const st = moisStatus(m.m);
                                                    const [yy, mm] = MOIS_CAMPAGNE[m.m] || [0,0];
                                                    const displayV = st === 'current' ? Math.round(m.v * (_todayD / new Date(yy, mm, 0).getDate())) : (st === 'past' ? m.v : 0);
                                                    const barColor = st === 'future' ? 'var(--gray-200)' : (st === 'current' ? '#D4A847' : selectedCharge.color);
                                                    const labelColor = st === 'future' ? 'var(--gray-300)' : (st === 'current' ? '#D4A847' : selectedCharge.color);
                                                    return (
                                                        <div key={i} style={{flex:1, textAlign:'center'}}>
                                                            <div style={{fontSize:9, fontWeight:600, color:labelColor, marginBottom:2}}>
                                                                {displayV > 0 ? `${(displayV/1000).toFixed(0)}K` : '-'}
                                                            </div>
                                                            <div style={{height: maxV > 0 ? Math.max(m.v / maxV * 80, 2) : 2, background: barColor, borderRadius:'3px 3px 0 0', opacity: st === 'future' ? 0.35 : 0.85, transition:'height 0.3s'}}></div>
                                                            <div style={{fontSize:9, color: st === 'future' ? 'var(--gray-300)' : 'var(--gray-400)', marginTop:4, fontWeight: st === 'current' ? 700 : 400}}>{m.m}</div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* KPIs */}
                                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:16}}>
                                    <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'var(--gray-400)'}}>Moyenne / Mois écoulé</div>
                                        <div style={{fontSize:16, fontWeight:700}}>{elapsedMonthsCount > 0 ? (chargeElapsed(selectedCharge)/elapsedMonthsCount/1000).toFixed(0) : '0'}K DH</div>
                                    </div>
                                    <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'var(--gray-400)'}}>Par Hectare</div>
                                        <div style={{fontSize:16, fontWeight:700}}>{(selectedCharge.total/data.totalHa/1000).toFixed(0)}K DH</div>
                                    </div>
                                    <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'var(--gray-400)'}}>Par Kg produit</div>
                                        <div style={{fontSize:16, fontWeight:700}}>{(selectedCharge.total/data.totalKgExport).toFixed(1)} DH</div>
                                    </div>
                                </div>

                                <button onClick={() => setSelectedCharge(null)} style={{width:'100%', padding:'10px', background:'var(--berry)', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer'}}>
                                    <i className="fa-solid fa-xmark" style={{marginRight:6}}></i> Fermer
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        function FinCATab({ data }) {
            const [filterFerme, setFilterFerme] = useState('');
            const [loading, setLoading] = useState(true);
            const [error, setError] = useState(null);
            const [liqData, setLiqData] = useState(null);
            const [marcheLocalBons, setMarcheLocalBons] = useState(null);

            // Config hectares statique (données physiques de la ferme)
            const VARIETES_HA = {
                'Maravilla GC|F1': { label: 'S1/S4 Maravilla MD', ha: 4.2, culture: 'Framboise' },
                'Maravilla LC|F1': { label: 'S3/S7 Maravilla MT', ha: 5.2, culture: 'Framboise' },
                'Yazmin|F1': { label: 'S2/S5 Yazmin MD', ha: 2.0, culture: 'Framboise' },
                'Yazmin|F5': { label: 'S10/S13 Yazmin F5', ha: 4.7, culture: 'Framboise' },
                'Reyna|F5': { label: 'S9 Reyna', ha: 3.0, culture: 'Framboise' },
                'Corina|F5': { label: 'Corina S8', ha: 2.5, culture: 'Myrtille' },
                'Cascade|F5': { label: 'Cascade S8-1', ha: 1.5, culture: 'Myrtille' },
                'Breeze|F5': { label: 'Breeze S8-2', ha: 1.0, culture: 'Myrtille' },
            };
            const totalHaConfig = 54.8;

            // Fetch liquidations + expeditions + marché local
            React.useEffect(() => {
                Promise.all([
                    cachedFetch('/api/email-analysis?action=liquidations'),
                    cachedFetch('/api/email-analysis?action=expeditions&limit=2000'),
                    (async () => {
                        const allBons = [];
                        try {
                            const prodBons = await loadBonsFromFirestore();
                            prodBons.filter(b => b.typeVente === 'Marché Local').forEach(b => allBons.push(b));
                        } catch(e) {}
                        try {
                            if (typeof firebase !== 'undefined' && firebase.firestore) {
                                const snap = await firebase.firestore().collection('bons_marche_local').get();
                                snap.forEach(d => allBons.push({ id: d.id, ...d.data(), source: 'firestore' }));
                            }
                        } catch(e) {}
                        return allBons;
                    })()
                ]).then(([liqJson, expJson, bons]) => {
                    if (liqJson.success) {
                        setLiqData({
                            liquidations: (liqJson.liquidations || []).filter(l => l.rows && l.rows.length > 0),
                            expeditions: expJson.success ? expJson.expeditions || [] : []
                        });
                    } else {
                        setError('Erreur chargement liquidations');
                    }
                    setMarcheLocalBons(bons);
                    setLoading(false);
                }).catch(err => { setError(err.message); setLoading(false); });
            }, []);

            // Loading / Error states
            if (loading) return (
                <div style={{textAlign:'center', padding:60}}>
                    <i className="fa-solid fa-spinner fa-spin" style={{fontSize:24, color:'var(--gray-400)'}}></i>
                    <p style={{marginTop:12, color:'var(--gray-500)'}}>Chargement des données CA...</p>
                </div>
            );
            if (error) return (
                <div style={{textAlign:'center', padding:60, color:'var(--red-500)'}}>
                    <i className="fa-solid fa-triangle-exclamation" style={{fontSize:24}}></i>
                    <p style={{marginTop:12}}>{error}</p>
                </div>
            );

            // --- Agréger CA Export depuis les liquidations (même logique que CPC tab) ---
            const liqCAByVariety = {};
            if (liqData) {
                const expByReceipt = {};
                (liqData.expeditions || []).forEach(exp => {
                    const rid = (exp.receiptId || '').trim();
                    if (rid) expByReceipt[rid] = exp;
                });
                const addLiqCA = (variete, ferme, kg, montant) => {
                    const key = variete + '|' + ferme;
                    if (!liqCAByVariety[key]) liqCAByVariety[key] = { kg: 0, montant: 0 };
                    liqCAByVariety[key].kg += kg;
                    liqCAByVariety[key].montant += montant;
                };
                (liqData.liquidations || []).forEach(liq => {
                    (liq.rows || []).forEach(row => {
                        const kg = row.receiptQtyKg || 0;
                        const gs = row.gsNet || 0;
                        if (kg <= 0 && gs <= 0) return;
                        const vName = row.variety || row.varietyCode || '';
                        const norm = normalizeParcelle(vName);
                        let variete = norm ? norm.variete : vName;
                        let ferme = norm ? norm.ferme : null;

                        const rid = (row.receiptId || '').trim();
                        const matchedExp = rid ? expByReceipt[rid] : null;
                        if (matchedExp) {
                            if (!ferme) ferme = matchedExp.ferme;
                            if (variete === 'Maravilla' && (!norm || !norm.sousVariete)) {
                                const expNorm = normalizeParcelle(matchedExp.variety);
                                if (expNorm && expNorm.sousVariete === 'Green Cane') variete = 'Maravilla GC';
                                else if (expNorm && expNorm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                                else if (expNorm && expNorm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                            }
                        }
                        if (variete === 'Maravilla' && norm && norm.sousVariete) {
                            if (norm.sousVariete === 'Green Cane' || norm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                            else if (norm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                        }
                        if (variete === 'Maravilla') {
                            const haGC = 4.2, haLC = 5.2, haT = haGC + haLC;
                            addLiqCA('Maravilla GC', 'F1', kg * haGC / haT, gs * haGC / haT);
                            addLiqCA('Maravilla LC', 'F1', kg * haLC / haT, gs * haLC / haT);
                            return;
                        }
                        if (variete === 'Yazmin' && !matchedExp) {
                            const haF1 = 2.0, haF5 = 4.7, haT = haF1 + haF5;
                            addLiqCA('Yazmin', 'F1', kg * haF1 / haT, gs * haF1 / haT);
                            addLiqCA('Yazmin', 'F5', kg * haF5 / haT, gs * haF5 / haT);
                            return;
                        }
                        if (!ferme) ferme = 'F1';
                        addLiqCA(variete, ferme, kg, gs);
                    });
                });
            }

            // --- CA Marché Local (pfq_interne + bons_marche_local) ---
            const localCAByVariety = {};
            const localKgByVariety = {};
            if (marcheLocalBons && marcheLocalBons.length > 0) {
                marcheLocalBons.forEach(bon => {
                    const rawVariete = bon.variete || bon.blocVariete || bon.designation || '';
                    const norm = normalizeParcelle(rawVariete);
                    let variete = norm ? norm.variete : (rawVariete || 'Autre');
                    let ferme = bon.ferme || bon.blocFerme || (norm ? norm.ferme : 'F1');
                    if (variete === 'Maravilla' && norm && norm.sousVariete) {
                        if (norm.sousVariete === 'Green Cane' || norm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                        else if (norm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                    }
                    if (variete === 'Maravilla') {
                        const montant = parseFloat(bon.totalDH) || 0;
                        const kgLocal = parseFloat(bon.poidsLot) || 0;
                        const haGC = 4.2, haLC = 5.2, haT = haGC + haLC;
                        const kGC = 'Maravilla GC|F1', kLC = 'Maravilla LC|F1';
                        if (!localCAByVariety[kGC]) localCAByVariety[kGC] = 0;
                        if (!localCAByVariety[kLC]) localCAByVariety[kLC] = 0;
                        if (!localKgByVariety[kGC]) localKgByVariety[kGC] = 0;
                        if (!localKgByVariety[kLC]) localKgByVariety[kLC] = 0;
                        localCAByVariety[kGC] += montant * haGC / haT;
                        localCAByVariety[kLC] += montant * haLC / haT;
                        localKgByVariety[kGC] += kgLocal * haGC / haT;
                        localKgByVariety[kLC] += kgLocal * haLC / haT;
                        return;
                    }
                    const key = variete + '|' + ferme;
                    if (!localCAByVariety[key]) localCAByVariety[key] = 0;
                    if (!localKgByVariety[key]) localKgByVariety[key] = 0;
                    const montant = parseFloat(bon.totalDH) || ((parseFloat(bon.poidsLot) || 0) * (parseFloat(bon.prixDH) || 0));
                    localCAByVariety[key] += montant;
                    localKgByVariety[key] += parseFloat(bon.poidsLot) || 0;
                });
            }

            // --- Construire caDetail dynamiquement ---
            const allKeys = new Set([...Object.keys(liqCAByVariety), ...Object.keys(localCAByVariety)]);
            const totalExport = Object.values(liqCAByVariety).reduce((s, v) => s + v.montant, 0);
            const totalLocal = Object.values(localCAByVariety).reduce((s, v) => s + v, 0);
            const totalCA = totalExport + totalLocal;
            const totalKgExport = Object.values(liqCAByVariety).reduce((s, v) => s + v.kg, 0);

            const caDetail = [];
            allKeys.forEach(key => {
                const [variete, ferme] = key.split('|');
                const expData = liqCAByVariety[key] || { kg: 0, montant: 0 };
                const localMontant = localCAByVariety[key] || 0;
                const localKg = localKgByVariety[key] || 0;
                const configMatch = VARIETES_HA[key];
                const ha = configMatch ? configMatch.ha : 1;
                const ca = expData.montant + localMontant;
                const totalKg = expData.kg + localKg;
                if (ca <= 0) return;
                caDetail.push({
                    variete: configMatch ? configMatch.label : `${variete} (${ferme})`,
                    ferme,
                    culture: configMatch ? configMatch.culture : 'Framboise',
                    kg: totalKg,
                    ca,
                    prixMoyen: totalKg > 0 ? Math.round(ca / totalKg * 100) / 100 : 0,
                    ha,
                    caHa: Math.round(ca / ha),
                    pctCA: totalCA > 0 ? Math.round(ca / totalCA * 100 * 10) / 10 : 0,
                });
            });
            caDetail.sort((a, b) => b.ca - a.ca);

            const filtered = filterFerme ? caDetail.filter(c => c.ferme === filterFerme) : caDetail;
            const totalFiltered = filtered.reduce((s, c) => s + c.ca, 0);
            const totalKgFiltered = filtered.reduce((s, c) => s + c.kg, 0);

            return (
                <div className="fade-in">
                    <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:12}}>
                        <i className="fa-solid fa-circle" style={{color:'#2D8B4E', fontSize:8, marginRight:6}}></i>
                        Données LIVE — {liqData ? liqData.liquidations.length : 0} liquidations, {marcheLocalBons ? marcheLocalBons.length : 0} bons locaux
                    </div>

                    <div className="kpi-grid">
                        <KPICard icon="fa-coins" iconClass="green" value={`${(totalCA/1000000).toFixed(1)}M`} label="CA Total (DH)" subItems={[{value:'Export', label:`${(totalExport/1000).toFixed(0)}K`}, {value:'Local', label:`${(totalLocal/1000).toFixed(0)}K`}]} />
                        <KPICard icon="fa-weight-scale" iconClass="berry" value={`${(totalKgExport/1000).toFixed(1)}T`} label="Tonnage Export" />
                        <KPICard icon="fa-calculator" iconClass="blue" value={`${totalKgExport > 0 ? Math.round(totalExport/totalKgExport) : 0}`} label="Prix Moyen Export (DH/Kg)" />
                        <KPICard icon="fa-leaf" iconClass="orange" value={`${totalHaConfig}`} label="Superficie (Ha)" />
                    </div>

                    <div style={{display:'flex', gap:12, marginBottom:16, alignItems:'center', flexWrap:'wrap'}}>
                        <label style={{fontSize:12, fontWeight:600}}>Filtrer par ferme:</label>
                        <select className="filter-select" value={filterFerme} onChange={e => setFilterFerme(e.target.value)}>
                            <option value="">Toutes les fermes</option>
                            <option value="F1">F1 - Larache</option>
                            <option value="F5">F5 - Kénitra</option>
                        </select>
                    </div>

                    <Panel title="Chiffre d'Affaires par Variété" icon="fa-coins">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Variété</th>
                                    <th>Ferme</th>
                                    <th>Ha</th>
                                    <th style={{textAlign:'right'}}>Quantité (Kg)</th>
                                    <th style={{textAlign:'right'}}>CA (DH)</th>
                                    <th style={{textAlign:'right'}}>Prix Moy.</th>
                                    <th style={{textAlign:'right'}}>CA/Ha</th>
                                    <th style={{textAlign:'right'}}>% CA</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((c, i) => (
                                    <tr key={i}>
                                        <td><strong>{c.variete}</strong></td>
                                        <td><span className={`farm-tag ${c.ferme === 'F1' ? 'f1' : (c.ferme === 'F5' ? 'f5' : 'avo')}`}>{c.ferme}</span></td>
                                        <td>{c.ha}</td>
                                        <td style={{textAlign:'right'}}>{c.kg.toLocaleString('fr-FR')}</td>
                                        <td style={{textAlign:'right', fontWeight:'600'}}>{Math.round(c.ca).toLocaleString('fr-FR')}</td>
                                        <td style={{textAlign:'right'}}>{c.prixMoyen.toFixed(2)}</td>
                                        <td style={{textAlign:'right'}}>{c.caHa.toLocaleString('fr-FR')}</td>
                                        <td style={{textAlign:'right', fontWeight:'600'}}>{c.pctCA}%</td>
                                    </tr>
                                ))}
                                <tr style={{background:'var(--gray-100)', fontWeight:700}}>
                                    <td colSpan="3">TOTAL</td>
                                    <td style={{textAlign:'right'}}>{totalKgFiltered.toLocaleString('fr-FR')}</td>
                                    <td style={{textAlign:'right'}}>{Math.round(totalFiltered).toLocaleString('fr-FR')}</td>
                                    <td></td>
                                    <td></td>
                                    <td style={{textAlign:'right'}}>{totalCA > 0 ? Math.round(totalFiltered/totalCA*100) : 0}%</td>
                                </tr>
                            </tbody>
                        </table>
                    </Panel>

                    <Panel title="CA par Variété" icon="fa-chart-bar">
                        <SimpleBarChart
                            data={filtered.map(c => ({variete: c.variete.substring(0, 15), caK: Math.round(c.ca/1000)}))}
                            dataKeys={['caK']}
                            colors={['#D4A847']}
                            xKey="variete"
                            height={220}
                        />
                    </Panel>

                    {/* Répartition Export vs Local */}
                    <Panel title="Répartition Export vs Local" icon="fa-pie-chart">
                        <div style={{display:'flex', gap:'24px', alignItems:'center', justifyContent:'center', flexWrap:'wrap'}}>
                            <SimplePieChart
                                data={[{name:'Export', value: totalExport}, {name:'Local', value: totalLocal}]}
                                colors={['#2D8B4E', '#D4A847']}
                                size={180}
                            />
                            <div>
                                <div style={{marginBottom:'8px'}}><span style={{display:'inline-block', width:'12px', height:'12px', background:'#2D8B4E', borderRadius:'2px', marginRight:'8px'}}></span><strong>Export Driscoll's:</strong> {(totalExport/1000).toFixed(0)}K DH ({totalCA > 0 ? Math.round(totalExport/totalCA*100) : 0}%)</div>
                                <div><span style={{display:'inline-block', width:'12px', height:'12px', background:'#D4A847', borderRadius:'2px', marginRight:'8px'}}></span><strong>Local:</strong> {(totalLocal/1000).toFixed(0)}K DH ({totalCA > 0 ? Math.round(totalLocal/totalCA*100) : 0}%)</div>
                            </div>
                        </div>
                    </Panel>
                </div>
            );
        }

        function FuelWeeklyChart({ data, cardMapping }) {
            if (!data || !data.length) return React.createElement('div', {style:{textAlign:'center',color:'var(--gray-400)',padding:20}}, 'Pas de données hebdomadaires');
            const allWeeks = data[0].semaines.map(s => s.semaine);
            const cardColors = ['#E67E22', '#3498DB', '#2ECC71', '#9B59B6', '#E74C3C'];
            const maxLitres = Math.max(...data.flatMap(c => c.semaines.map(s => s.litres)));
            const padding = { top: 20, right: 20, bottom: 40, left: 50 };
            const W = 800, H = 260;
            const chartW = W - padding.left - padding.right;
            const chartH = H - padding.top - padding.bottom;

            // Show every 4th week label to avoid clutter
            const labelInterval = Math.max(1, Math.floor(allWeeks.length / 10));

            return React.createElement('div', null,
                React.createElement('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' },
                    // Grid
                    [0, 0.25, 0.5, 0.75, 1].map((tick, i) => {
                        const y = padding.top + chartH * (1 - tick);
                        return React.createElement('g', { key: 'g'+i },
                            React.createElement('line', { x1: padding.left, y1: y, x2: W - padding.right, y2: y, stroke: '#f0f0f0', strokeDasharray: '3 3' }),
                            React.createElement('text', { x: padding.left - 5, y: y + 4, textAnchor: 'end', fontSize: '9', fill: '#999' }, Math.round(maxLitres * tick) + 'L')
                        );
                    }),
                    // Lines per card
                    data.map((card, ci) => {
                        const pts = card.semaines.map((s, wi) => ({
                            x: padding.left + (wi / Math.max(1, allWeeks.length - 1)) * chartW,
                            y: padding.top + chartH - (s.litres / (maxLitres || 1)) * chartH,
                        }));
                        const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                        return React.createElement('g', { key: 'c'+ci },
                            React.createElement('path', { d: pathD, fill: 'none', stroke: cardColors[ci], strokeWidth: '2', opacity: '0.85' }),
                            pts.filter((_, i) => i === pts.length - 1).map((p, i) =>
                                React.createElement('circle', { key: 'dot'+i, cx: p.x, cy: p.y, r: '3', fill: cardColors[ci] })
                            )
                        );
                    }),
                    // X-axis labels
                    allWeeks.map((w, i) => i % labelInterval === 0 ?
                        React.createElement('text', { key: 'w'+i, x: padding.left + (i / Math.max(1, allWeeks.length - 1)) * chartW, y: H - 5, textAnchor: 'middle', fontSize: '8', fill: '#999', transform: `rotate(-30, ${padding.left + (i / Math.max(1, allWeeks.length - 1)) * chartW}, ${H - 10})` }, w.replace(/^\d{4}-/, ''))
                        : null
                    )
                ),
                // Legend
                React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, justifyContent: 'center' } },
                    data.map((card, ci) => {
                        const name = (cardMapping[card.carte] || {}).collaborateur || card.carte;
                        return React.createElement('span', { key: ci, style: { fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 } },
                            React.createElement('span', { style: { width: 12, height: 3, background: cardColors[ci], display: 'inline-block', borderRadius: 2 } }),
                            name
                        );
                    })
                )
            );
        }

        function FuelKmChart({ suiviKm }) {
            if (!suiviKm || !suiviKm.points || suiviKm.points.length < 2) return null;
            const pts = suiviKm.points;
            const padding = { top: 20, right: 20, bottom: 30, left: 50 };
            const W = 600, H = 200;
            const chartW = W - padding.left - padding.right;
            const chartH = H - padding.top - padding.bottom;
            const maxVal = Math.max(...pts.map(p => p.l100km)) * 1.15;
            const minVal = Math.min(...pts.map(p => p.l100km)) * 0.85;
            const range = maxVal - minVal || 1;

            const points = pts.map((p, i) => ({
                x: padding.left + (i / (pts.length - 1)) * chartW,
                y: padding.top + chartH - ((p.l100km - minVal) / range) * chartH,
                val: p.l100km,
                date: p.date,
            }));
            const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            const avgY = padding.top + chartH - ((suiviKm.moyenneL100 - minVal) / range) * chartH;
            const labelInterval = Math.max(1, Math.floor(pts.length / 8));

            return React.createElement('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' },
                // Grid
                [0, 0.25, 0.5, 0.75, 1].map((tick, i) => {
                    const y = padding.top + chartH * (1 - tick);
                    const val = (minVal + range * tick).toFixed(1);
                    return React.createElement('g', { key: i },
                        React.createElement('line', { x1: padding.left, y1: y, x2: W - padding.right, y2: y, stroke: '#f0f0f0', strokeDasharray: '3 3' }),
                        React.createElement('text', { x: padding.left - 5, y: y + 4, textAnchor: 'end', fontSize: '9', fill: '#999' }, val)
                    );
                }),
                // Average line
                React.createElement('line', { x1: padding.left, y1: avgY, x2: W - padding.right, y2: avgY, stroke: '#E74C3C', strokeWidth: '1', strokeDasharray: '6 3' }),
                React.createElement('text', { x: W - padding.right + 2, y: avgY + 3, fontSize: '9', fill: '#E74C3C' }, 'moy'),
                // Area
                React.createElement('path', { d: pathD + ` L ${points[points.length-1].x} ${padding.top + chartH} L ${points[0].x} ${padding.top + chartH} Z`, fill: '#3498DB', opacity: '0.1' }),
                // Line
                React.createElement('path', { d: pathD, fill: 'none', stroke: '#3498DB', strokeWidth: '2' }),
                // Dots
                points.map((p, i) => React.createElement('circle', { key: i, cx: p.x, cy: p.y, r: '3', fill: '#3498DB' })),
                // X labels
                points.map((p, i) => i % labelInterval === 0 ? React.createElement('text', { key: 'l'+i, x: p.x, y: H - 5, textAnchor: 'middle', fontSize: '8', fill: '#999' }, pts[i].date.split(' ')[0].substring(0, 5)) : null)
            );
        }

        // ===================== FIN OJRA TAB (Paie & charges sociales) =====================
        // Source: export Excel manuel d'OJRA (logiciel de paie hébergé en RDP).
        // Phase 2 : automatisation SQL si la base d'OJRA devient accessible (cf. plan Phase 1).
        function FinOjraTab({ data }) {
            const [summary, setSummary] = React.useState(null);
            const [loading, setLoading] = React.useState(true);
            const [error, setError] = React.useState(null);

            // Upload state
            const [selectedFile, setSelectedFile] = React.useState(null);
            const [period, setPeriod] = React.useState(() => {
                // Default to most recent Saturday (start of current Sat-Fri quinzaine)
                const d = new Date();
                const day = d.getDay(); // 0=Sun..6=Sat
                const diffToSat = (day - 6 + 7) % 7;
                d.setDate(d.getDate() - diffToSat);
                return d.toISOString().slice(0, 10);
            });
            const [uploading, setUploading] = React.useState(false);
            const [uploadResult, setUploadResult] = React.useState(null);
            const [uploadError, setUploadError] = React.useState(null);
            const [dryRunPreview, setDryRunPreview] = React.useState(null);

            // Detail view
            const [selectedPeriod, setSelectedPeriod] = React.useState(null);
            const [periodDetail, setPeriodDetail] = React.useState(null);
            const [loadingDetail, setLoadingDetail] = React.useState(false);
            const [search, setSearch] = React.useState('');

            const reloadSummary = React.useCallback(() => {
                setLoading(true);
                fetch('/api/ojra?action=summary')
                    .then(r => r.json())
                    .then(d => {
                        if (d.success) {
                            setSummary(d);
                            if (d.latest && !selectedPeriod) setSelectedPeriod(d.latest.period);
                        } else setError(d.error || 'Erreur API');
                    })
                    .catch(e => setError(e.message))
                    .finally(() => setLoading(false));
            }, [selectedPeriod]);

            React.useEffect(() => { reloadSummary(); }, []);

            React.useEffect(() => {
                if (!selectedPeriod) return;
                setLoadingDetail(true);
                fetch('/api/ojra?action=detail&period=' + encodeURIComponent(selectedPeriod))
                    .then(r => r.json())
                    .then(d => { if (d.success) setPeriodDetail(d); })
                    .finally(() => setLoadingDetail(false));
            }, [selectedPeriod]);

            const fileToBase64 = (file) => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result;
                    const base64 = String(result).split(',')[1] || '';
                    resolve(base64);
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });

            const runImport = async (dryRun) => {
                if (!selectedFile) { setUploadError('Choisir un fichier Excel'); return; }
                if (!period) { setUploadError('Choisir une période (samedi début de quinzaine)'); return; }
                setUploading(true);
                setUploadError(null);
                setUploadResult(null);
                setDryRunPreview(null);
                try {
                    const base64 = await fileToBase64(selectedFile);
                    const resp = await fetch('/api/ojra?action=import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            file: base64,
                            period,
                            dryRun: !!dryRun,
                            importedBy: (firebaseAuth && firebaseAuth.currentUser) ? firebaseAuth.currentUser.email : null,
                        }),
                    });
                    const data = await resp.json();
                    if (!data.success) {
                        setUploadError(data.error || 'Erreur import');
                        if (data.sheets) setDryRunPreview({ sheets: data.sheets });
                    } else if (dryRun) {
                        setDryRunPreview(data);
                    } else {
                        setUploadResult(data);
                        setSelectedFile(null);
                        setSelectedPeriod(period);
                        reloadSummary();
                    }
                } catch (e) {
                    setUploadError(e.message);
                } finally {
                    setUploading(false);
                }
            };

            if (loading) return <div style={{textAlign:'center', padding:60}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:24, color:'var(--gray-400)'}}></i><p style={{marginTop:12, color:'var(--gray-500)'}}>Chargement des données OJRA...</p></div>;
            if (error) return <div style={{textAlign:'center', padding:60, color:'var(--red-500)'}}><i className="fa-solid fa-triangle-exclamation" style={{fontSize:24}}></i><p style={{marginTop:12}}>{error}</p></div>;

            const periods = (summary && summary.periods) || [];
            const latest = summary && summary.latest;

            // Freshness alert
            let decalageJours = null;
            if (summary && summary.lastImportAt) {
                decalageJours = Math.floor((Date.now() - new Date(summary.lastImportAt).getTime()) / 86400000);
            }
            const decalageWarning = decalageJours !== null && decalageJours >= 21;
            const decalageCritical = decalageJours !== null && decalageJours >= 35;

            // Evolution chart over the last periods (oldest → newest)
            const evolutionData = [...periods].reverse().map(p => ({
                periode: p.period.slice(5), // MM-DD
                Brut: Math.round(p.salaireBrut),
                Net: Math.round(p.salaireNet),
                Charges: Math.round(p.chargesSocialesTotal),
            }));

            // Detail filtering
            const detailRecords = (periodDetail && periodDetail.records) || [];
            const filteredRecords = search
                ? detailRecords.filter(r => {
                    const q = search.toLowerCase();
                    return (r.nom || '').toLowerCase().includes(q) ||
                           (r.matricule || '').toLowerCase().includes(q) ||
                           (r.poste || '').toLowerCase().includes(q);
                  })
                : detailRecords;

            return (
                <div className="fade-in">
                    {/* ===== ALERTE FRAÎCHEUR ===== */}
                    {decalageWarning && (
                        <div style={{padding:'12px 16px', background: decalageCritical ? 'rgba(231,76,60,0.1)' : 'rgba(243,156,18,0.1)', border: '1px solid ' + (decalageCritical ? 'rgba(231,76,60,0.3)' : 'rgba(243,156,18,0.3)'), borderRadius:10, marginBottom:16, display:'flex', alignItems:'center', gap:12, fontSize:13}}>
                            <i className={'fa-solid ' + (decalageCritical ? 'fa-circle-exclamation' : 'fa-triangle-exclamation')} style={{fontSize:18, color: decalageCritical ? '#e74c3c' : '#f39c12'}}></i>
                            <div>
                                <span style={{fontWeight:700, color: decalageCritical ? '#c0392b' : '#856404'}}>Aucun import OJRA depuis {decalageJours} jours</span>
                                {summary.lastPeriod && <span style={{marginLeft:8, color:'var(--gray-500)', fontSize:11}}>(dernière période : {summary.lastPeriod})</span>}
                            </div>
                        </div>
                    )}

                    {/* ===== KPIs (dernière quinzaine) ===== */}
                    {latest ? (
                        <div className="kpi-grid" style={{gridTemplateColumns: 'repeat(4, 1fr)'}}>
                            <KPICard icon="fa-money-bill-wave" iconClass="berry" value={(latest.salaireBrut/1000).toFixed(1)} label="Masse Salariale Brute (K DH)" />
                            <KPICard icon="fa-hand-holding-dollar" iconClass="green" value={(latest.salaireNet/1000).toFixed(1)} label="Net à Payer (K DH)" />
                            <KPICard icon="fa-shield-halved" iconClass="orange" value={(latest.chargesSocialesTotal/1000).toFixed(1)} label="Charges Sociales (K DH)" />
                            <KPICard icon="fa-users" iconClass="blue" value={latest.nbEmployes} label="Effectif Payé" />
                        </div>
                    ) : (
                        <div style={{padding: 24, background: 'var(--orange-pale)', borderRadius: 12, marginBottom: 16, fontSize: 13, color: 'var(--gray-600)', textAlign: 'center'}}>
                            <i className="fa-solid fa-circle-info" style={{marginRight: 8}}></i>
                            Aucune donnée OJRA importée. Utiliser le formulaire ci-dessous pour uploader le journal de paie Excel exporté depuis OJRA (en bureau à distance).
                        </div>
                    )}

                    {/* ===== UPLOAD EXCEL ===== */}
                    <Panel title="Importer un journal de paie OJRA" icon="fa-cloud-arrow-up">
                        <div style={{padding: 16}}>
                            <div style={{display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end'}}>
                                <div style={{flex: '1 1 240px'}}>
                                    <label style={{display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', marginBottom: 4}}>Période (samedi début de quinzaine)</label>
                                    <input
                                        type="date"
                                        value={period}
                                        onChange={e => setPeriod(e.target.value)}
                                        style={{padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 8, fontSize: 13, width: '100%'}}
                                    />
                                </div>
                                <div style={{flex: '2 1 320px'}}>
                                    <label style={{display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', marginBottom: 4}}>Fichier Excel OJRA</label>
                                    <input
                                        type="file"
                                        accept=".xlsx,.xls"
                                        onChange={e => { setSelectedFile(e.target.files[0] || null); setUploadError(null); setUploadResult(null); setDryRunPreview(null); }}
                                        style={{padding: '6px 0', fontSize: 13, width: '100%'}}
                                    />
                                </div>
                                <div style={{display: 'flex', gap: 8}}>
                                    <button
                                        onClick={() => runImport(true)}
                                        disabled={uploading || !selectedFile}
                                        style={{padding: '8px 14px', background: 'var(--gray-100)', color: 'var(--dark)', border: '1px solid var(--gray-200)', borderRadius: 8, cursor: uploading || !selectedFile ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, opacity: uploading || !selectedFile ? 0.5 : 1}}>
                                        <i className="fa-solid fa-eye" style={{marginRight: 6}}></i>Aperçu
                                    </button>
                                    <button
                                        onClick={() => runImport(false)}
                                        disabled={uploading || !selectedFile}
                                        style={{padding: '8px 14px', background: 'var(--berry)', color: 'white', border: 'none', borderRadius: 8, cursor: uploading || !selectedFile ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, opacity: uploading || !selectedFile ? 0.5 : 1}}>
                                        {uploading ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight: 6}}></i>Import...</> : <><i className="fa-solid fa-upload" style={{marginRight: 6}}></i>Importer</>}
                                    </button>
                                </div>
                            </div>

                            {uploadError && (
                                <div style={{marginTop: 12, padding: 10, background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: 8, color: '#c0392b', fontSize: 12}}>
                                    <i className="fa-solid fa-circle-exclamation" style={{marginRight: 6}}></i>{uploadError}
                                </div>
                            )}
                            {uploadResult && (
                                <div style={{marginTop: 12, padding: 10, background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: 8, color: '#1e8449', fontSize: 12}}>
                                    <i className="fa-solid fa-circle-check" style={{marginRight: 6}}></i>
                                    {uploadResult.imported} ligne{uploadResult.imported > 1 ? 's' : ''} importée{uploadResult.imported > 1 ? 's' : ''} pour la période {uploadResult.period}.
                                    Brut total : {(uploadResult.totals.salaireBrut/1000).toFixed(1)} K DH · Net : {(uploadResult.totals.salaireNet/1000).toFixed(1)} K DH · Charges : {(uploadResult.totals.chargesSocialesTotal/1000).toFixed(1)} K DH.
                                </div>
                            )}
                            {dryRunPreview && (
                                <div style={{marginTop: 12, padding: 12, background: 'var(--blue-pale)', borderRadius: 8, fontSize: 12}}>
                                    <div style={{fontWeight: 700, marginBottom: 6}}><i className="fa-solid fa-eye" style={{marginRight: 6}}></i>Aperçu de l'import</div>
                                    {dryRunPreview.totals && (
                                        <div style={{marginBottom: 8}}>
                                            <strong>{dryRunPreview.totals.nbEmployes}</strong> employés · Brut <strong>{(dryRunPreview.totals.salaireBrut/1000).toFixed(1)} K DH</strong> · Net <strong>{(dryRunPreview.totals.salaireNet/1000).toFixed(1)} K DH</strong> · Charges <strong>{(dryRunPreview.totals.chargesSocialesTotal/1000).toFixed(1)} K DH</strong>
                                        </div>
                                    )}
                                    {dryRunPreview.sheets && dryRunPreview.sheets.map((s, i) => (
                                        <div key={i} style={{marginTop: 4, fontSize: 11}}>
                                            <strong>{s.name}</strong> — {s.skipped ? <span style={{color: '#c0392b'}}>ignorée ({s.reason || 'aucun en-tête reconnu'})</span> : <span>{s.nbRecords} lignes — colonnes détectées : {(s.detectedColumns || []).join(', ')}</span>}
                                        </div>
                                    ))}
                                    {dryRunPreview.sample && dryRunPreview.sample.length > 0 && (
                                        <div style={{marginTop: 8, fontSize: 11, color: 'var(--gray-600)'}}>
                                            <em>Échantillon (1ère ligne) :</em> {dryRunPreview.sample[0].nomComplet || dryRunPreview.sample[0].nom || '—'} · Brut {dryRunPreview.sample[0].salaireBrut} · Net {dryRunPreview.sample[0].salaireNet}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </Panel>

                    {/* ===== ÉVOLUTION + RÉPARTITION CHARGES ===== */}
                    {periods.length > 0 && (
                        <div className="two-col" style={{marginTop: 16}}>
                            <Panel title="Évolution Masse Salariale" icon="fa-chart-line">
                                <SimpleBarChart data={evolutionData} dataKeys={['Brut', 'Net', 'Charges']} colors={['#9b59b6', '#2ECC71', '#E67E22']} xKey="periode" height={240} />
                            </Panel>
                            <Panel title="Répartition Charges (dernière quinzaine)" icon="fa-shield-halved">
                                {latest && (
                                    <div style={{padding: 16}}>
                                        <table className="data-table" style={{fontSize: 12}}>
                                            <tbody>
                                                <tr><td>CNSS — part salariale</td><td style={{textAlign: 'right'}}><strong>{(latest.cnssEmploye || 0).toLocaleString('fr-FR')} DH</strong></td></tr>
                                                <tr><td>CNSS — part patronale</td><td style={{textAlign: 'right'}}><strong>{(latest.cnssEmployeur || 0).toLocaleString('fr-FR')} DH</strong></td></tr>
                                                <tr><td>AMO — part salariale</td><td style={{textAlign: 'right'}}><strong>{(latest.amoEmploye || 0).toLocaleString('fr-FR')} DH</strong></td></tr>
                                                <tr><td>AMO — part patronale</td><td style={{textAlign: 'right'}}><strong>{(latest.amoEmployeur || 0).toLocaleString('fr-FR')} DH</strong></td></tr>
                                                <tr><td>IR (impôt sur le revenu)</td><td style={{textAlign: 'right'}}><strong>{(latest.ir || 0).toLocaleString('fr-FR')} DH</strong></td></tr>
                                                <tr><td>CIMR / retraite compl.</td><td style={{textAlign: 'right'}}><strong>{(latest.cimr || 0).toLocaleString('fr-FR')} DH</strong></td></tr>
                                                <tr style={{borderTop: '2px solid var(--gray-200)'}}><td><strong>Total charges sociales</strong></td><td style={{textAlign: 'right'}}><strong style={{color: 'var(--berry)'}}>{(latest.chargesSocialesTotal || 0).toLocaleString('fr-FR')} DH</strong></td></tr>
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </Panel>
                        </div>
                    )}

                    {/* ===== DÉTAIL EMPLOYÉS PAR QUINZAINE ===== */}
                    {periods.length > 0 && (
                        <div style={{marginTop: 16}}>
                            <Panel title="Détail Employés" icon="fa-users">
                                <div style={{padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--gray-100)'}}>
                                    <label style={{fontSize: 12, color: 'var(--gray-500)'}}>Quinzaine :</label>
                                    <select value={selectedPeriod || ''} onChange={e => setSelectedPeriod(e.target.value)} style={{padding: '6px 10px', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 12}}>
                                        {periods.map(p => <option key={p.period} value={p.period}>{p.period} ({p.nbEmployes} pers.)</option>)}
                                    </select>
                                    <input
                                        type="text"
                                        placeholder="Rechercher (nom, matricule, poste)..."
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                        style={{padding: '6px 10px', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 12, flex: '1 1 200px'}}
                                    />
                                    <span style={{fontSize: 11, color: 'var(--gray-400)'}}>{filteredRecords.length} / {detailRecords.length} employés</span>
                                </div>
                                <div style={{maxHeight: 480, overflowY: 'auto'}}>
                                    {loadingDetail ? (
                                        <div style={{padding: 30, textAlign: 'center', color: 'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin"></i> Chargement...</div>
                                    ) : (
                                        <table className="data-table" style={{fontSize: 12}}>
                                            <thead>
                                                <tr>
                                                    <th>Matricule</th>
                                                    <th>Nom</th>
                                                    <th>Poste</th>
                                                    <th style={{textAlign: 'right'}}>Brut</th>
                                                    <th style={{textAlign: 'right'}}>CNSS</th>
                                                    <th style={{textAlign: 'right'}}>AMO</th>
                                                    <th style={{textAlign: 'right'}}>IR</th>
                                                    <th style={{textAlign: 'right'}}>Net</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredRecords.map(r => (
                                                    <tr key={r.id}>
                                                        <td>{r.matricule || '—'}</td>
                                                        <td><strong>{r.nom || '—'}</strong></td>
                                                        <td>{r.poste || '—'}</td>
                                                        <td style={{textAlign: 'right'}}>{(r.salaireBrut || 0).toLocaleString('fr-FR')}</td>
                                                        <td style={{textAlign: 'right', color: 'var(--gray-500)'}}>{(r.cnssEmploye || 0).toLocaleString('fr-FR')}</td>
                                                        <td style={{textAlign: 'right', color: 'var(--gray-500)'}}>{(r.amoEmploye || 0).toLocaleString('fr-FR')}</td>
                                                        <td style={{textAlign: 'right', color: 'var(--gray-500)'}}>{(r.ir || 0).toLocaleString('fr-FR')}</td>
                                                        <td style={{textAlign: 'right'}}><strong style={{color: 'var(--green)'}}>{(r.salaireNet || 0).toLocaleString('fr-FR')}</strong></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </Panel>
                        </div>
                    )}

                    {/* ===== INFO SOURCE ===== */}
                    <div style={{marginTop: 16, padding: 16, background: 'var(--orange-pale)', borderRadius: 12, fontSize: 12, color: 'var(--gray-600)'}}>
                        <div><strong><i className="fa-solid fa-circle-info" style={{marginRight: 6}}></i>Source :</strong> Logiciel de paie OJRA (serveur Windows accessible en bureau à distance). Export Excel manuel à uploader chaque quinzaine.</div>
                        {summary && summary.lastImportAt && (
                            <div style={{marginTop: 8}}>
                                <i className="fa-solid fa-clock-rotate-left" style={{color: '#3498db', marginRight: 6}}></i>
                                <strong>Dernier import :</strong> {new Date(summary.lastImportAt).toLocaleDateString('fr-FR', {day:'2-digit', month:'short', year:'numeric'})} à {new Date(summary.lastImportAt).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})} — période {summary.lastPeriod}
                            </div>
                        )}
                        <div style={{marginTop: 8, fontSize: 11, color: 'var(--gray-500)', fontStyle: 'italic'}}>
                            Le parser détecte automatiquement les colonnes (matricule, nom, brut, net, CNSS, AMO, IR…). Si certaines colonnes manquent dans l'aperçu, vérifier que les en-têtes du fichier OJRA contiennent ces mots-clés.
                        </div>
                    </div>
                </div>
            );
        }

        function FinStockTab({ data }) {
            const fin = data.finStock;
            const stockTotal = fin.stockTheorique.reduce((s, c) => s + c.valeur, 0);

            return (
                <div className="fade-in">
                    <div className="kpi-grid">
                        <KPICard icon="fa-boxes-stacked" iconClass="berry" value={(stockTotal/1000000).toFixed(1)} label="Valeur Stock Théorique (M DH)" />
                        <KPICard icon="fa-sync" iconClass={fin.ecart < 0 ? 'red' : 'green'} value={fin.ecart.toLocaleString('fr-FR')} label={`Écart Réconciliation (DH)`} />
                        <KPICard icon="fa-wallet" iconClass="gold" value={(fin.caisse.solde/1000).toFixed(1)} label="Solde Caisse (K DH)" />
                    </div>

                    <div className="two-col">
                        <Panel title="Stock par Catégorie" icon="fa-boxes-stacked">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Catégorie</th>
                                        <th>Nb Réfs</th>
                                        <th>Valeur (DH)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {fin.stockTheorique.map((c, i) => (
                                        <tr key={i}>
                                            <td><strong>{c.categorie}</strong></td>
                                            <td>{c.nbRefs}</td>
                                            <td>{c.valeur.toLocaleString('fr-FR')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Panel>

                        <Panel title="Suivi Caisse" icon="fa-wallet">
                            <div style={{padding: 16}}>
                                <div style={{marginBottom: 12}}>
                                    <div style={{fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase'}}>Solde</div>
                                    <div style={{fontSize: 22, fontWeight: 700, color: 'var(--green)'}}>{fin.caisse.solde.toLocaleString('fr-FR')} DH</div>
                                </div>
                                <div style={{marginBottom: 12}}>
                                    <div style={{fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase'}}>Dernier Mouvement</div>
                                    <div style={{fontSize: 14, color: 'var(--dark)'}}>{fin.caisse.dernierMvt}</div>
                                </div>
                                <div>
                                    <div style={{fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase'}}>Responsable Achats</div>
                                    <div style={{fontSize: 14, color: 'var(--dark)', fontWeight: 600}}>{fin.caisse.respAchat}</div>
                                </div>
                            </div>
                        </Panel>
                    </div>

                    <Panel title="PV de Réconciliation" icon="fa-file-upload">
                        <div style={{padding: 16, textAlign: 'center', color: 'var(--gray-400)'}}>
                            <i className="fa-solid fa-cloud-arrow-up" style={{fontSize: 32, marginBottom: 12}}></i>
                            <div style={{fontSize: 12, marginBottom: 12}}>Cliquez pour uploader le PV de réconciliation du {fin.derniereReconciliation}</div>
                            <button style={{padding: '8px 16px', background: 'var(--berry)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600}}>
                                Choisir un fichier
                            </button>
                        </div>
                    </Panel>

                    <div style={{marginTop: 16, padding: 16, background: 'var(--blue-pale)', borderRadius: 12, fontSize: 12, color: 'var(--gray-600)'}}>
                        <strong>Caisse suivie par le responsable Achats (<strong>Achraf EL INAK</strong>)</strong>
                    </div>
                </div>
            );
        }

        // ===================== FIN LIQUIDATIONS TAB =====================
        // Transforms Firestore `liquidations` collection docs into the shape expected
        // by FinLiquidationsTab. No fallback to demo data — empty defaults if Firestore
        // has nothing yet. `factures`, `aVenir`, `planning` are filled by other fetches.
        function buildLiquidationsView(docs, selectedFruit) {
            const filtered = selectedFruit ? docs.filter(d => (d.fruit || 'framboise') === selectedFruit) : docs;
            const extractYear = (d) => {
                const m = (d.subject || '').match(/week\s*\d+[-\/](\d{4})/i);
                if (m) return parseInt(m[1]);
                if (d.date) return new Date(d.date).getFullYear();
                return 2025;
            };

            const historique = filtered
                .filter(d => d.rows && d.rows.length > 0 && d.week != null)
                .map(d => {
                    // Dedup rows by receiptId — a same receipt can appear on multiple rows (grade splits)
                    // Matches QualiteLiquidationsTab logic at app.jsx:15647 for consistent totals.
                    const byRid = {};
                    (d.rows || []).forEach(r => {
                        const rid = r.receiptId || ('row_' + Math.random());
                        if (!byRid[rid]) byRid[rid] = { kg: 0, gsNet: 0 };
                        byRid[rid].kg += (r.receiptQtyKg || 0);
                        byRid[rid].gsNet += (r.gsNet || 0);
                    });
                    const qteKg = Object.values(byRid).reduce((s, r) => s + r.kg, 0);
                    const gsNetSum = Object.values(byRid).reduce((s, r) => s + r.gsNet, 0);
                    const montantBrut = d.base || gsNetSum;
                    // In Driscoll's PDF: column 4 is "DED Rasp" (framboise) or "Plant Deduction" (myrtille).
                    // Both represent the plants deduction on seedling bills — unified here as prelevPlants.
                    const prelevPlants = (d.dedPlants || 0) + (d.dedRasp || 0);
                    const prelevPret = d.cropAdvance || 0;
                    const fruitAdvance = d.fruitAdvance || 0;
                    const montantNet = d.netPayable != null && d.netPayable !== 0
                        ? d.netPayable
                        : Math.max(montantBrut - prelevPlants - prelevPret - fruitAdvance, 0);
                    const prixMoyen = qteKg > 0 ? montantBrut / qteKg : 0;
                    const year = extractYear(d);
                    return {
                        semaine: `S${String(d.week).padStart(2,'0')}-${year}`,
                        week: d.week,
                        year,
                        qteKg: Math.round(qteKg * 100) / 100,
                        prixMoyen: Math.round(prixMoyen * 100) / 100,
                        montantBrut: Math.round(montantBrut * 100) / 100,
                        prelevPlants: Math.round(prelevPlants * 100) / 100,
                        prelevPret: Math.round(prelevPret * 100) / 100,
                        fruitAdvance: Math.round(fruitAdvance * 100) / 100,
                        montantNet: Math.round(montantNet * 100) / 100,
                        dateEncaissement: d.date ? new Date(d.date).toLocaleDateString('fr-FR') : '-',
                        status: 'Encaissée',
                        fruit: d.fruit || 'framboise',
                        liquidationNumber: d.liquidationNumber,
                        period: d.period,
                        rows: d.rows,
                    };
                })
                .sort((a, b) => (a.year * 100 + a.week) - (b.year * 100 + b.week));

            const totalKg = historique.reduce((s, h) => s + h.qteKg, 0);
            const totalBrut = historique.reduce((s, h) => s + h.montantBrut, 0);
            const totalEncaisse = historique.reduce((s, h) => s + h.montantNet, 0);
            const totalPlantsPreleve = historique.reduce((s, h) => s + h.prelevPlants, 0);
            const totalCropAdvancePreleve = historique.reduce((s, h) => s + h.prelevPret, 0);
            const totalFruitAdvancePreleve = historique.reduce((s, h) => s + (h.fruitAdvance || 0), 0);

            const plantsPrelevs = historique.filter(h => h.prelevPlants > 0).map(h => ({ semaine: h.semaine, montant: h.prelevPlants }));
            const cropPrelevs = historique.filter(h => h.prelevPret > 0).map(h => ({ semaine: h.semaine, montant: h.prelevPret }));
            const fruitPrelevs = historique.filter(h => (h.fruitAdvance || 0) > 0).map(h => ({ semaine: h.semaine, montant: h.fruitAdvance }));

            return {
                historique,
                aVenir: [],
                planning: [],
                totalKg,
                totalBrut,
                totalNet: totalEncaisse,
                totalEncaisse,
                enCours: Math.max(totalBrut - totalEncaisse, 0),
                deductions: {
                    plants: {
                        designation: 'Plants Framboise',
                        totalFacture: 0,
                        totalPreleve: totalPlantsPreleve,
                        resteADeduire: 0,
                        factures: [],
                        prelevements: plantsPrelevs,
                    },
                    cropAdvance: {
                        designation: "Prêt Driscoll's (Crop Advance)",
                        totalMontant: 0,
                        totalPreleve: totalCropAdvancePreleve,
                        resteADeduire: 0,
                        prelevements: cropPrelevs,
                    },
                    fruitAdvance: {
                        designation: 'Fruit Advance',
                        totalMontant: 0,
                        totalPreleve: totalFruitAdvancePreleve,
                        resteADeduire: 0,
                        prelevements: fruitPrelevs,
                    },
                },
            };
        }

        // ===================== TRÉSORERIE (Finance & DG) =====================
        // Sat-Fri week (calendrier Driscoll's) — début = samedi 00:00 local
        function getSatFriWeek(date) {
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);
            const day = d.getDay(); // 0=Sun..6=Sat
            const diffToSat = (day - 6 + 7) % 7;
            const start = new Date(d);
            start.setDate(d.getDate() - diffToSat);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            end.setHours(23, 59, 59, 999);
            return { start, end };
        }
        function tresoParseDMY(s) {
            if (!s) return null;
            const parts = String(s).split('/');
            if (parts.length !== 3) return null;
            const [d, m, y] = parts.map(Number);
            if (!d || !m || !y) return null;
            return new Date(y, m - 1, d);
        }
        function tresoFmtMAD(n) {
            return (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' MAD';
        }
        function tresoFmtDate(d) {
            if (!d) return '';
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            return `${dd}/${mm}`;
        }

        function FinTresorerieTab({ data, currentProfile }) {
            const canEdit = currentProfile === 'finance' || currentProfile === 'dg';
            const [items, setItems] = useState([]);
            const [itemsLoading, setItemsLoading] = useState(true);
            const [factures, setFactures] = useState([]);
            const [facturesLoading, setFacturesLoading] = useState(true);
            const [ojraSummary, setOjraSummary] = useState(null);
            const [showForm, setShowForm] = useState(false);
            const [editing, setEditing] = useState(null);
            const emptyForm = { type: 'loyer', libelle: '', beneficiaire: '', montant: '', recurrence: 'mensuelle', dateEcheance: '', jourDuMois: '', dateFin: '' };
            const [form, setForm] = useState(emptyForm);

            useEffect(() => {
                const db = firebase.firestore();
                const unsub = db.collection('tresorerie_items').onSnapshot(snap => {
                    const rows = [];
                    snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
                    setItems(rows.filter(r => r.actif !== false));
                    setItemsLoading(false);
                }, err => { console.warn('tresorerie_items snapshot error', err); setItemsLoading(false); });
                return () => unsub();
            }, []);

            useEffect(() => {
                fetch('/api/stock?action=list-factures').then(r => r.json())
                    .then(json => {
                        if (json.success) {
                            const all = json.factures || [];
                            const pending = all.filter(f => {
                                const s = String(f.payment_status || '').toLowerCase();
                                return s !== 'paye' && s !== 'payee' && s !== 'payée';
                            });
                            setFactures(pending);
                        }
                    })
                    .catch(err => console.warn('factures load error', err))
                    .finally(() => setFacturesLoading(false));
            }, []);

            useEffect(() => {
                fetch('/api/ojra?action=summary').then(r => r.json())
                    .then(json => { if (json.success) setOjraSummary(json); })
                    .catch(() => {});
            }, []);

            const weeks = useMemo(() => {
                const cur = getSatFriWeek(new Date());
                const arr = [];
                for (let i = 0; i < 9; i++) {
                    const start = new Date(cur.start);
                    start.setDate(cur.start.getDate() + i * 7);
                    arr.push(getSatFriWeek(start));
                }
                return arr;
            }, []);

            const expandedSorties = useMemo(() => {
                const out = [];
                if (!weeks.length) return out;
                const windowStart = weeks[0].start;
                const windowEnd = weeks[weeks.length - 1].end;
                items.forEach(it => {
                    const montant = Number(it.montant) || 0;
                    if (!montant) return;
                    if (it.recurrence === 'mensuelle') {
                        const jour = Math.min(Math.max(Number(it.jourDuMois) || 1, 1), 28);
                        const fin = it.dateFin ? new Date(it.dateFin) : null;
                        const start = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
                        for (let m = 0; m < 4; m++) {
                            const occ = new Date(start.getFullYear(), start.getMonth() + m, jour);
                            if (occ < windowStart || occ > windowEnd) continue;
                            if (fin && occ > fin) continue;
                            out.push({ date: occ, type: it.type, libelle: it.libelle, montant, beneficiaire: it.beneficiaire, id: it.id });
                        }
                    } else {
                        const dt = it.dateEcheance ? new Date(it.dateEcheance) : null;
                        if (!dt) return;
                        if (dt >= windowStart && dt <= windowEnd) {
                            out.push({ date: dt, type: it.type, libelle: it.libelle, montant, beneficiaire: it.beneficiaire, id: it.id });
                        }
                    }
                });
                return out;
            }, [items, weeks]);

            const weeklyRows = useMemo(() => {
                const liquidations = (data?.liquidations?.aVenir) || [];
                let cumul = 0;
                return weeks.map(w => {
                    const entrees = liquidations.reduce((sum, l) => {
                        const dt = tresoParseDMY(l.dateEstimee);
                        if (!dt) return sum;
                        if (dt >= w.start && dt <= w.end) return sum + (Number(l.montantEstime) || 0);
                        return sum;
                    }, 0);
                    const sortiesFactures = factures.reduce((sum, f) => {
                        const raw = f.date_echeance || f.date_facture || f.dateEcheance;
                        if (!raw) return sum;
                        const dt = new Date(raw);
                        if (isNaN(dt)) return sum;
                        if (dt >= w.start && dt <= w.end) return sum + (Number(f.total_ttc) || 0);
                        return sum;
                    }, 0);
                    const inWeek = expandedSorties.filter(s => s.date >= w.start && s.date <= w.end);
                    const sortiesLoyers = inWeek.filter(s => s.type === 'loyer').reduce((a, b) => a + b.montant, 0);
                    const sortiesPaie = inWeek.filter(s => s.type === 'paie').reduce((a, b) => a + b.montant, 0);
                    const sortiesAutres = inWeek.filter(s => s.type !== 'loyer' && s.type !== 'paie').reduce((a, b) => a + b.montant, 0);
                    const sorties = sortiesFactures + sortiesLoyers + sortiesPaie + sortiesAutres;
                    const net = entrees - sorties;
                    cumul += net;
                    return { week: w, entrees, sortiesFactures, sortiesLoyers, sortiesPaie, sortiesAutres, sorties, net, cumul };
                });
            }, [weeks, data, factures, expandedSorties]);

            const kpis = useMemo(() => {
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const in7 = new Date(today); in7.setDate(today.getDate() + 7);
                const retards = factures.reduce((sum, f) => {
                    const raw = f.date_echeance || f.dateEcheance;
                    if (!raw) return sum;
                    const dt = new Date(raw);
                    if (isNaN(dt)) return sum;
                    return dt < today ? sum + (Number(f.total_ttc) || 0) : sum;
                }, 0);
                const ech7j = factures.reduce((sum, f) => {
                    const raw = f.date_echeance || f.dateEcheance;
                    if (!raw) return sum;
                    const dt = new Date(raw);
                    if (isNaN(dt)) return sum;
                    return (dt >= today && dt <= in7) ? sum + (Number(f.total_ttc) || 0) : sum;
                }, 0) + expandedSorties.filter(s => s.date >= today && s.date <= in7).reduce((a, b) => a + b.montant, 0);
                const totalEntrees = weeklyRows.reduce((a, r) => a + r.entrees, 0);
                const soldeProj = weeklyRows.length ? weeklyRows[weeklyRows.length - 1].cumul : 0;
                return { retards, ech7j, totalEntrees, soldeProj };
            }, [factures, expandedSorties, weeklyRows]);

            const saveItem = () => {
                if (!canEdit) return;
                const db = firebase.firestore();
                const payload = {
                    type: form.type,
                    libelle: form.libelle.trim(),
                    beneficiaire: form.beneficiaire.trim(),
                    montant: Number(form.montant) || 0,
                    recurrence: form.recurrence,
                    dateEcheance: form.recurrence === 'unique' ? form.dateEcheance : null,
                    jourDuMois: form.recurrence === 'mensuelle' ? (Number(form.jourDuMois) || 1) : null,
                    dateFin: form.dateFin || null,
                    actif: true,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: currentProfile,
                };
                if (!payload.libelle || !payload.montant) { alert('Libellé et montant obligatoires.'); return; }
                const op = editing
                    ? db.collection('tresorerie_items').doc(editing).update(payload)
                    : db.collection('tresorerie_items').add({ ...payload, createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: currentProfile });
                op.then(() => { setShowForm(false); setEditing(null); setForm(emptyForm); })
                  .catch(err => alert('Erreur sauvegarde: ' + err.message));
            };
            const deleteItem = (id) => {
                if (!canEdit) return;
                if (!confirm('Supprimer cet élément ?')) return;
                firebase.firestore().collection('tresorerie_items').doc(id).update({ actif: false, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
                    .catch(err => alert('Erreur: ' + err.message));
            };
            const startEdit = (it) => {
                setEditing(it.id);
                setForm({
                    type: it.type || 'loyer',
                    libelle: it.libelle || '',
                    beneficiaire: it.beneficiaire || '',
                    montant: it.montant || '',
                    recurrence: it.recurrence || 'mensuelle',
                    dateEcheance: it.dateEcheance || '',
                    jourDuMois: it.jourDuMois || '',
                    dateFin: it.dateFin || '',
                });
                setShowForm(true);
            };

            const ojraNet = ojraSummary?.latest?.totalNet || ojraSummary?.latest?.total || 0;

            return (
                <div className="fade-in" style={{ padding: '16px 4px' }}>
                    <h3 style={{ margin: '0 0 16px' }}>
                        <i className="fa-solid fa-vault" style={{ marginRight: 8, color: 'var(--berry)' }}></i>
                        Trésorerie — Cash-flow prévisionnel
                    </h3>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
                        <div className="kpi-card" style={{ borderLeft: `4px solid ${kpis.soldeProj >= 0 ? 'var(--green)' : '#e74c3c'}` }}>
                            <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Solde net projeté (8 sem.)</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: kpis.soldeProj >= 0 ? 'var(--green)' : '#e74c3c', marginTop: 6 }}>{tresoFmtMAD(kpis.soldeProj)}</div>
                        </div>
                        <div className="kpi-card" style={{ borderLeft: '4px solid #e67e22' }}>
                            <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Échéances 7 prochains jours</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#e67e22', marginTop: 6 }}>{tresoFmtMAD(kpis.ech7j)}</div>
                        </div>
                        <div className="kpi-card" style={{ borderLeft: '4px solid #e74c3c' }}>
                            <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Factures en retard</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#e74c3c', marginTop: 6 }}>{tresoFmtMAD(kpis.retards)}</div>
                        </div>
                        <div className="kpi-card" style={{ borderLeft: '4px solid var(--berry)' }}>
                            <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Entrées Driscoll's attendues</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--berry)', marginTop: 6 }}>{tresoFmtMAD(kpis.totalEntrees)}</div>
                        </div>
                        {ojraNet > 0 && (
                            <div className="kpi-card" style={{ borderLeft: '4px solid #3498db' }}>
                                <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Dernière paie OJRA</div>
                                <div style={{ fontSize: 18, fontWeight: 700, color: '#3498db', marginTop: 6 }}>{tresoFmtMAD(ojraNet)}</div>
                                <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{ojraSummary?.latest?.period || ''}</div>
                            </div>
                        )}
                    </div>

                    <div style={{ marginBottom: 24 }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>
                            <i className="fa-solid fa-calendar-week" style={{ marginRight: 6 }}></i>
                            Calendrier hebdomadaire (Samedi → Vendredi, calendrier Driscoll's)
                        </h4>
                        {(facturesLoading || itemsLoading) && <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>Chargement…</div>}
                        <div className="table-responsive"><table className="data-table" style={{ fontSize: 12 }}>
                            <thead>
                                <tr>
                                    <th>Semaine</th>
                                    <th style={{ textAlign: 'right' }}>Entrées Driscoll's</th>
                                    <th style={{ textAlign: 'right' }}>Factures</th>
                                    <th style={{ textAlign: 'right' }}>Loyers</th>
                                    <th style={{ textAlign: 'right' }}>Paie</th>
                                    <th style={{ textAlign: 'right' }}>Autres</th>
                                    <th style={{ textAlign: 'right' }}>Solde net</th>
                                    <th style={{ textAlign: 'right' }}>Cumul</th>
                                </tr>
                            </thead>
                            <tbody>
                                {weeklyRows.map((r, i) => {
                                    const cumulColor = r.cumul >= 0 ? 'var(--green)' : '#e74c3c';
                                    return (
                                        <tr key={i} style={i === 0 ? { background: '#fff8e1' } : null}>
                                            <td style={{ fontWeight: 600 }}>{tresoFmtDate(r.week.start)} → {tresoFmtDate(r.week.end)}{i === 0 ? ' (en cours)' : ''}</td>
                                            <td style={{ textAlign: 'right', color: r.entrees > 0 ? 'var(--green)' : 'var(--gray-400)' }}>{r.entrees > 0 ? tresoFmtMAD(r.entrees) : '—'}</td>
                                            <td style={{ textAlign: 'right' }}>{r.sortiesFactures > 0 ? tresoFmtMAD(r.sortiesFactures) : '—'}</td>
                                            <td style={{ textAlign: 'right' }}>{r.sortiesLoyers > 0 ? tresoFmtMAD(r.sortiesLoyers) : '—'}</td>
                                            <td style={{ textAlign: 'right' }}>{r.sortiesPaie > 0 ? tresoFmtMAD(r.sortiesPaie) : '—'}</td>
                                            <td style={{ textAlign: 'right' }}>{r.sortiesAutres > 0 ? tresoFmtMAD(r.sortiesAutres) : '—'}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: r.net >= 0 ? 'var(--green)' : '#e74c3c' }}>{tresoFmtMAD(r.net)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 700, color: cumulColor }}>{tresoFmtMAD(r.cumul)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table></div>
                    </div>

                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <h4 style={{ margin: 0, fontSize: 14 }}>
                                <i className="fa-solid fa-list-check" style={{ marginRight: 6 }}></i>
                                Échéances & engagements ({items.length})
                            </h4>
                            {canEdit && (
                                <button onClick={() => { setEditing(null); setForm(emptyForm); setShowForm(!showForm); }} style={{ background: 'var(--berry)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                                    <i className={`fa-solid ${showForm ? 'fa-xmark' : 'fa-plus'}`} style={{ marginRight: 4 }}></i>{showForm ? 'Annuler' : 'Ajouter'}
                                </button>
                            )}
                        </div>

                        {showForm && canEdit && (
                            <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                                    <label style={{ fontSize: 11 }}>Type
                                        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} style={{ width: '100%', padding: 6 }}>
                                            <option value="loyer">Loyer</option>
                                            <option value="paie">Paie</option>
                                            <option value="echeance">Échéance (crédit, traite…)</option>
                                            <option value="autre">Autre</option>
                                        </select>
                                    </label>
                                    <label style={{ fontSize: 11 }}>Libellé *
                                        <input value={form.libelle} onChange={e => setForm({ ...form, libelle: e.target.value })} style={{ width: '100%', padding: 6 }} placeholder="Loyer bureau Casa" />
                                    </label>
                                    <label style={{ fontSize: 11 }}>Bénéficiaire
                                        <input value={form.beneficiaire} onChange={e => setForm({ ...form, beneficiaire: e.target.value })} style={{ width: '100%', padding: 6 }} />
                                    </label>
                                    <label style={{ fontSize: 11 }}>Montant (MAD) *
                                        <input type="number" value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })} style={{ width: '100%', padding: 6 }} />
                                    </label>
                                    <label style={{ fontSize: 11 }}>Récurrence
                                        <select value={form.recurrence} onChange={e => setForm({ ...form, recurrence: e.target.value })} style={{ width: '100%', padding: 6 }}>
                                            <option value="mensuelle">Mensuelle</option>
                                            <option value="unique">Unique</option>
                                        </select>
                                    </label>
                                    {form.recurrence === 'mensuelle' ? (
                                        <>
                                            <label style={{ fontSize: 11 }}>Jour du mois (1-28)
                                                <input type="number" min="1" max="28" value={form.jourDuMois} onChange={e => setForm({ ...form, jourDuMois: e.target.value })} style={{ width: '100%', padding: 6 }} />
                                            </label>
                                            <label style={{ fontSize: 11 }}>Date de fin (optionnel)
                                                <input type="date" value={form.dateFin} onChange={e => setForm({ ...form, dateFin: e.target.value })} style={{ width: '100%', padding: 6 }} />
                                            </label>
                                        </>
                                    ) : (
                                        <label style={{ fontSize: 11 }}>Date d'échéance *
                                            <input type="date" value={form.dateEcheance} onChange={e => setForm({ ...form, dateEcheance: e.target.value })} style={{ width: '100%', padding: 6 }} />
                                        </label>
                                    )}
                                </div>
                                <div style={{ marginTop: 10, textAlign: 'right' }}>
                                    <button onClick={saveItem} style={{ background: 'var(--green)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                                        <i className="fa-solid fa-check" style={{ marginRight: 4 }}></i>{editing ? 'Mettre à jour' : 'Enregistrer'}
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="table-responsive"><table className="data-table" style={{ fontSize: 12 }}>
                            <thead>
                                <tr>
                                    <th>Type</th>
                                    <th>Libellé</th>
                                    <th>Bénéficiaire</th>
                                    <th style={{ textAlign: 'right' }}>Montant</th>
                                    <th>Récurrence</th>
                                    <th>Prochaine échéance</th>
                                    {canEdit && <th>Actions</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 && (
                                    <tr><td colSpan={canEdit ? 7 : 6} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 24 }}>Aucun engagement enregistré.</td></tr>
                                )}
                                {items.map(it => {
                                    let prochaine = '—';
                                    if (it.recurrence === 'unique' && it.dateEcheance) {
                                        const dt = new Date(it.dateEcheance);
                                        prochaine = tresoFmtDate(dt) + '/' + dt.getFullYear();
                                    } else if (it.recurrence === 'mensuelle' && it.jourDuMois) {
                                        const today = new Date();
                                        const jour = Math.min(it.jourDuMois, 28);
                                        let next = new Date(today.getFullYear(), today.getMonth(), jour);
                                        if (next < today) next = new Date(today.getFullYear(), today.getMonth() + 1, jour);
                                        prochaine = tresoFmtDate(next) + '/' + next.getFullYear();
                                    }
                                    return (
                                        <tr key={it.id}>
                                            <td><span style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4, fontSize: 10, textTransform: 'uppercase' }}>{it.type}</span></td>
                                            <td style={{ fontWeight: 600 }}>{it.libelle}</td>
                                            <td>{it.beneficiaire || '—'}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{tresoFmtMAD(it.montant)}</td>
                                            <td>{it.recurrence === 'mensuelle' ? `Mensuelle (j${it.jourDuMois})` : 'Unique'}</td>
                                            <td>{prochaine}</td>
                                            {canEdit && (
                                                <td>
                                                    <button onClick={() => startEdit(it)} title="Modifier" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--berry)', marginRight: 6 }}><i className="fa-solid fa-pen"></i></button>
                                                    <button onClick={() => deleteItem(it.id)} title="Supprimer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e74c3c' }}><i className="fa-solid fa-trash"></i></button>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table></div>
                        <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 8 }}>
                            <i className="fa-solid fa-info-circle" style={{ marginRight: 4 }}></i>
                            Les factures fournisseurs et liquidations Driscoll's sont agrégées automatiquement. La paie peut être ajoutée comme item récurrent.
                        </div>
                    </div>
                </div>
            );
        }

        function FinLiquidationsTab({ data, currentProfile }) {
            const isAdmin = currentProfile === 'dg' || currentProfile === 'finance';
            const [subTab, setSubTab] = useState('situation');
            const [editingPrix, setEditingPrix] = useState({});
            const [showDeductionModal, setShowDeductionModal] = useState(false);
            const [selectedFacture, setSelectedFacture] = useState(null);
            const [selectedLiquidation, setSelectedLiquidation] = useState(null);
            const [deductionForm, setDeductionForm] = useState({ type: 'plants', semaine: '', montant: '' });
            const [selectedFruit, setSelectedFruit] = useState('');
            const [fetchedDocs, setFetchedDocs] = useState(null);
            const [fetchedExpeditions, setFetchedExpeditions] = useState(null);
            const [plantInvoices, setPlantInvoices] = useState(null);
            const [uploadingInvoice, setUploadingInvoice] = useState(false);
            const [uploadResult, setUploadResult] = useState(null);
            const [uploadProgress, setUploadProgress] = useState(null); // { current, total, currentName }
            // Deduction montants:
            //  - cropAdvance = pot UNIQUE ferme (prêt Driscoll's global, partagé Framboise+Myrtille).
            //  - fruitAdvance = par culture (chaque fruit a son propre montant convenu).
            // Shape: { cropAdvance: number, fruitAdvance: { framboise: number, myrtille: number } }
            const [deductionMontants, setDeductionMontants] = useState({ cropAdvance: 0, fruitAdvance: { framboise: 0, myrtille: 0 } });
            const [editingMontant, setEditingMontant] = useState(null); // 'cropAdvance' | 'fruitAdvance' | null
            const [editMontantValue, setEditMontantValue] = useState('');
            const [editMontantPerCulture, setEditMontantPerCulture] = useState({ framboise: '', myrtille: '' });
            const [invoiceDragOver, setInvoiceDragOver] = useState(false);
            const fileInputRef = React.useRef(null);

            const fetchPlantInvoices = React.useCallback(() => {
                invalidateCache('plant-invoices');
                return fetch('/api/email-analysis?action=plant-invoices')
                    .then(r => r.json())
                    .then(json => { if (json.success) setPlantInvoices(json.invoices || []); })
                    .catch(() => setPlantInvoices([]));
            }, []);

            const handleDeleteInvoice = async (ref) => {
                if (!ref) return;
                if (!window.confirm(`Supprimer toutes les lignes de la facture ${ref} (et son PDF) ?`)) return;
                try {
                    const r = await fetch('/api/email-analysis?action=delete-plant-invoice', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ref, deleteStorage: true }),
                    });
                    const json = await r.json();
                    if (!json.success) { alert('Échec suppression: ' + (json.error || '')); return; }
                    await fetchPlantInvoices();
                    setUploadResult({ ok: true, msg: `Facture ${ref} supprimée` });
                } catch (e) { alert('Erreur réseau: ' + e.message); }
            };

            const handleRescanInvoice = async (ref) => {
                if (!ref) return;
                setUploadingInvoice(true);
                setUploadResult(null);
                setUploadProgress({ current: 1, total: 1, currentName: ref });
                try {
                    const r = await fetch('/api/email-analysis?action=rescan-plant-invoice', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ref }),
                    });
                    const json = await r.json();
                    if (json.success) {
                        await fetchPlantInvoices();
                        setUploadResult({ ok: true, msg: `${ref} re-scannée — ${json.created?.length || 0} ligne(s)` });
                    } else {
                        setUploadResult({ ok: false, msg: 'Échec re-scan: ' + (json.error || '') });
                    }
                } catch (e) {
                    setUploadResult({ ok: false, msg: 'Erreur réseau: ' + e.message });
                } finally {
                    setUploadingInvoice(false);
                    setUploadProgress(null);
                }
            };

            React.useEffect(() => {
                Promise.all([
                    cachedFetch('/api/email-analysis?action=liquidations'),
                    cachedFetch('/api/email-analysis?action=expeditions&limit=2000'),
                    fetch('/api/email-analysis?action=plant-invoices').then(r => r.json()).catch(() => ({ success: false })),
                ]).then(([liqJson, expJson, plantJson]) => {
                    if (liqJson.success) setFetchedDocs(liqJson.liquidations || []);
                    else setFetchedDocs([]);
                    if (expJson.success && expJson.expeditions) setFetchedExpeditions(expJson.expeditions);
                    else setFetchedExpeditions([]);
                    if (plantJson && plantJson.success) setPlantInvoices(plantJson.invoices || []);
                    else setPlantInvoices([]);
                }).catch(() => { setFetchedDocs([]); setFetchedExpeditions([]); setPlantInvoices([]); });
                // Load deduction montants from Firestore — migrate older shapes:
                //  - v1 (flat): { cropAdvance, fruitAdvance } → cropAdvance global, fruitAdvance.framboise = old value.
                //  - v2 (per-culture): { framboise:{cA,fA}, myrtille:{cA,fA} } → cropAdvance = max(both), fruitAdvance per-culture.
                //  - v3 (current): { cropAdvance, fruitAdvance:{framboise,myrtille} } → as-is.
                firebase.firestore().collection('app_settings').doc('deduction_montants').get()
                    .then(doc => {
                        if (!doc.exists) return;
                        const data = doc.data() || {};
                        const isV3 = typeof data.fruitAdvance === 'object' && data.fruitAdvance !== null;
                        const isV2 = !isV3 && (data.framboise != null || data.myrtille != null);
                        const isV1 = !isV2 && !isV3 && (data.cropAdvance != null || data.fruitAdvance != null);
                        if (isV3) {
                            setDeductionMontants({
                                cropAdvance: data.cropAdvance || 0,
                                fruitAdvance: { framboise: data.fruitAdvance.framboise || 0, myrtille: data.fruitAdvance.myrtille || 0 },
                            });
                        } else if (isV2) {
                            const f = data.framboise || {}, m = data.myrtille || {};
                            setDeductionMontants({
                                cropAdvance: Math.max(f.cropAdvance || 0, m.cropAdvance || 0),
                                fruitAdvance: { framboise: f.fruitAdvance || 0, myrtille: m.fruitAdvance || 0 },
                            });
                        } else if (isV1) {
                            setDeductionMontants({
                                cropAdvance: data.cropAdvance || 0,
                                fruitAdvance: { framboise: data.fruitAdvance || 0, myrtille: 0 },
                            });
                        }
                    })
                    .catch(() => {});
            }, []);

            // Resolve montants for the current culture filter.
            //  - cropAdvance is GLOBAL → returned as-is regardless of culture.
            //  - fruitAdvance is per-culture; "Toutes" returns the sum.
            const getMontantsForCulture = (culture) => {
                const fA = deductionMontants.fruitAdvance || {};
                const cropAdvance = deductionMontants.cropAdvance || 0;
                if (culture === 'framboise') return { cropAdvance, fruitAdvance: fA.framboise || 0 };
                if (culture === 'myrtille') return { cropAdvance, fruitAdvance: fA.myrtille || 0 };
                return { cropAdvance, fruitAdvance: (fA.framboise || 0) + (fA.myrtille || 0) };
            };

            const saveDeductionMontant = async (type, value) => {
                let updated;
                if (type === 'cropAdvance') {
                    // Always a single global value, no culture distinction.
                    updated = { ...deductionMontants, cropAdvance: parseFloat(value) || 0 };
                } else if (type === 'fruitAdvance') {
                    const fA = { ...(deductionMontants.fruitAdvance || {}) };
                    if (selectedFruit) {
                        fA[selectedFruit] = parseFloat(value) || 0;
                    } else {
                        // "Toutes" mode — value is { framboise, myrtille }
                        const v = value || {};
                        fA.framboise = parseFloat(v.framboise) || 0;
                        fA.myrtille = parseFloat(v.myrtille) || 0;
                    }
                    updated = { ...deductionMontants, fruitAdvance: fA };
                } else {
                    return;
                }
                setDeductionMontants(updated);
                setEditingMontant(null);
                try {
                    await firebase.firestore().collection('app_settings').doc('deduction_montants').set(updated);
                } catch(e) { console.error('Save deduction montant error:', e); }
            };

            const handleUploadInvoices = async (filesIterable) => {
                const files = Array.from(filesIterable || []).filter(Boolean);
                if (files.length === 0) return;
                const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
                const valid = files.filter(f => validTypes.includes(f.type) && f.size <= 10 * 1024 * 1024);
                const skipped = files.length - valid.length;
                if (valid.length === 0) {
                    alert('Aucun fichier valide (PDF/JPG/PNG, max 10 MB)');
                    return;
                }
                setUploadingInvoice(true);
                setUploadResult(null);
                const successes = [];
                const failures = [];
                for (let i = 0; i < valid.length; i++) {
                    const file = valid[i];
                    setUploadProgress({ current: i + 1, total: valid.length, currentName: file.name });
                    try {
                        const base64 = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = (e) => resolve(e.target.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(file);
                        });
                        const resp = await fetch('/api/email-analysis?action=scan-plant-invoice', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ pdf_base64: base64, filename: file.name }),
                        });
                        const json = await resp.json();
                        if (json.success) successes.push({ file: file.name, ref: json.analysis?.ref, lines: json.created?.length || 0 });
                        else failures.push({ file: file.name, error: json.error || 'Échec' });
                    } catch (e) {
                        failures.push({ file: file.name, error: e.message });
                    }
                }
                setUploadProgress(null);
                setUploadingInvoice(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
                await fetchPlantInvoices();
                setUploadResult({
                    ok: failures.length === 0,
                    msg: `${successes.length}/${valid.length} facture(s) traitée(s)${skipped > 0 ? ` — ${skipped} fichier(s) ignoré(s)` : ''}${failures.length > 0 ? ` — Erreurs: ${failures.map(f => f.file + ': ' + f.error).join(' | ')}` : ''}`,
                    successes,
                    failures,
                });
            };

            // Build live "à venir" list from expeditions (weeks with shipments but no liquidation yet).
            // Uses ISO week; estimates price from last 2 liquidations of the same culture.
            const computeLiveAVenir = () => {
                if (!fetchedExpeditions || !fetchedDocs) return null;
                const getISOWeek = (dateStr) => {
                    if (!dateStr) return null;
                    const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                    if (!m) return null;
                    const d = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
                    d.setHours(0, 0, 0, 0);
                    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
                    const week1 = new Date(d.getFullYear(), 0, 4);
                    return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
                };
                const getISOYear = (dateStr) => {
                    if (!dateStr) return null;
                    const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                    if (!m) return null;
                    const d = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
                    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
                    return d.getFullYear();
                };
                const mondayOf = (year, week) => {
                    // ISO week Monday — add 4 weeks for Driscoll's settlement lag
                    const simple = new Date(year, 0, 1 + (week - 1) * 7);
                    const dow = simple.getDay() || 7;
                    const monday = new Date(simple);
                    monday.setDate(simple.getDate() - dow + 1);
                    return monday;
                };
                // Liquidated weeks — key WITHOUT culture (matches QualiteLiquidationsTab:15941).
                // A week is considered liquidated as soon as ANY liquidation exists for it.
                const liquidatedKeys = new Set();
                fetchedDocs.forEach(l => {
                    if (!l.week) return;
                    const m = (l.subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                    const y = m ? parseInt(m[1]) : (l.date ? new Date(l.date).getFullYear() : 2025);
                    liquidatedKeys.add(`${y}-W${l.week}`);
                });
                // Classify variety into culture — same regex as QualiteLiquidationsTab
                const varietyToCulture = (v) => /myrtille|blue|corina|corrina|cascade|breeze/i.test(v || '') ? 'myrtille' : 'framboise';
                // Aggregate expedition kg by week (no culture), with breakdown by variety
                const agg = {};
                (fetchedExpeditions || []).filter(e => e.overallResult !== 'REJECT').forEach(e => {
                    const w = getISOWeek(e.date || '');
                    const y = getISOYear(e.date || '');
                    if (!w || !y) return;
                    const key = `${y}-W${w}`;
                    if (!agg[key]) agg[key] = { year: y, week: w, totalKg: 0, byVariety: {} };
                    const v = e.variety || '?';
                    agg[key].totalKg += (e.batchWeight || 0);
                    agg[key].byVariety[v] = (agg[key].byVariety[v] || 0) + (e.batchWeight || 0);
                });
                // Average price from last 2 liquidations per culture (matches qualite logic)
                const sortedLiqs = [...fetchedDocs].sort((a, b) => {
                    const ya = (() => { const m = (a.subject || '').match(/week\s*\d+[\/-](\d{4})/i); return m ? parseInt(m[1]) : 2025; })();
                    const yb = (() => { const m = (b.subject || '').match(/week\s*\d+[\/-](\d{4})/i); return m ? parseInt(m[1]) : 2025; })();
                    if (ya !== yb) return yb - ya;
                    return (b.week || 0) - (a.week || 0);
                });
                const priceByCulture = {};
                for (const liq of sortedLiqs) {
                    const culture = (liq.fruit || 'framboise').toLowerCase();
                    if (!priceByCulture[culture]) priceByCulture[culture] = [];
                    if (priceByCulture[culture].length >= 2) continue;
                    const totalKgLiq = (liq.rows || []).reduce((s, r) => s + (r.receiptQtyKg || 0), 0);
                    const totalGs = (liq.rows || []).reduce((s, r) => s + (r.gsNet || 0), 0);
                    if (totalKgLiq > 0) priceByCulture[culture].push(totalGs / totalKgLiq);
                }
                const avgPriceFor = (culture) => {
                    const arr = priceByCulture[culture] || [];
                    if (!arr.length) return 55;
                    return arr.reduce((s, p) => s + p, 0) / arr.length;
                };
                // Build aVenir entries — one per week, with variety breakdown and weighted price
                const entries = Object.values(agg)
                    .filter(a => !liquidatedKeys.has(`${a.year}-W${a.week}`))
                    .sort((a, b) => (a.year * 100 + a.week) - (b.year * 100 + b.week))
                    .map(a => {
                        // Filter byVariety by selectedFruit if active
                        const byVarietyFiltered = {};
                        let filteredKg = 0;
                        let weightedCA = 0;
                        const culturesInWeek = new Set();
                        Object.entries(a.byVariety).forEach(([v, kg]) => {
                            const culture = varietyToCulture(v);
                            if (selectedFruit && culture !== selectedFruit) return;
                            byVarietyFiltered[v] = kg;
                            filteredKg += kg;
                            weightedCA += kg * avgPriceFor(culture);
                            culturesInWeek.add(culture);
                        });
                        if (filteredKg === 0) return null;
                        const prixEstime = Math.round((weightedCA / filteredKg) * 100) / 100;
                        const settle = mondayOf(a.year, a.week);
                        settle.setDate(settle.getDate() + 28);
                        return {
                            semaine: `S${String(a.week).padStart(2, '0')}-${a.year}`,
                            year: a.year,
                            week: a.week,
                            qteKg: Math.round(filteredKg * 100) / 100,
                            prixEstime,
                            montantEstime: Math.round(filteredKg * prixEstime * 100) / 100,
                            dateEstimee: settle.toLocaleDateString('fr-FR'),
                            status: 'En attente',
                            byVariety: byVarietyFiltered,
                            cultures: Array.from(culturesInWeek),
                        };
                    })
                    .filter(Boolean);
                return entries;
            };

            // Loading state — show a spinner instead of demo data
            if (!fetchedDocs) {
                return React.createElement('div', { className:'loading', style:{padding:40, textAlign:'center', color:'var(--gray-400)'} },
                    React.createElement('i', { className:'fa-solid fa-spinner fa-spin', style:{fontSize:24, marginBottom:8} }),
                    React.createElement('div', null, 'Chargement des liquidations…')
                );
            }

            // Build the live view from Firestore — no demo fallback
            let liq = buildLiquidationsView(fetchedDocs, selectedFruit);
            const liveAVenir = computeLiveAVenir();
            if (liveAVenir) liq = { ...liq, aVenir: liveAVenir };

            // Inject plant invoices from Firestore if any have been uploaded
            const filteredInvoices = (plantInvoices || []).filter(inv => !selectedFruit || (inv.culture || 'framboise') === selectedFruit);
            if (plantInvoices && plantInvoices.length > 0) {
                const filteredInv = filteredInvoices;
                const sorted = [...filteredInv].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                const totalFacture = sorted.reduce((s, inv) => s + (inv.montant || 0), 0);
                const factures = sorted.map(inv => ({
                    id: inv.id,
                    date: inv.date ? inv.date.split('-').reverse().join('/') : '-',
                    ref: inv.ref || '-',
                    montant: inv.montant || 0,
                    variete: inv.variete || '-',
                    qte: inv.qte || 0,
                    commande: inv.commande,
                    packing: inv.packing,
                    echeance: inv.echeance ? inv.echeance.split('-').reverse().join('/') : '-',
                    livraison: inv.livraison ? inv.livraison.split('-').reverse().join('/') : '-',
                    pdfUrl: inv.pdfUrl,
                }));
                liq = {
                    ...liq,
                    deductions: {
                        ...liq.deductions,
                        plants: {
                            ...liq.deductions.plants,
                            totalFacture,
                            resteADeduire: Math.max(totalFacture - liq.deductions.plants.totalPreleve, 0),
                            factures,
                        },
                    },
                };
            }

            // Inject configured montants:
            //  - Crop Advance: pot UNIQUE — totalMontant + totalPreleve calculés sur TOUTES cultures,
            //    indépendants du filtre. C'est le solde restant du prêt Driscoll's pour la ferme.
            //  - Fruit Advance: par culture (suit le filtre, ou somme en "Toutes").
            const _curMontants = getMontantsForCulture(selectedFruit);
            const cropMontant = _curMontants.cropAdvance || 0;
            const fruitMontant = _curMontants.fruitAdvance || 0;
            const globalCropPreleve = (fetchedDocs || []).reduce((s, d) => s + (d.cropAdvance || 0), 0);
            liq = {
                ...liq,
                deductions: {
                    ...liq.deductions,
                    plants: {
                        ...liq.deductions.plants,
                        designation: selectedFruit === 'myrtille' ? 'Plants Myrtille' : selectedFruit === 'framboise' ? 'Plants Framboise' : 'Plants (Toutes cultures)',
                    },
                    cropAdvance: {
                        ...liq.deductions.cropAdvance,
                        designation: "Prêt Driscoll's (Crop Advance) — global ferme",
                        totalMontant: cropMontant,
                        totalPreleve: globalCropPreleve,
                        resteADeduire: Math.max(cropMontant - globalCropPreleve, 0),
                    },
                    fruitAdvance: {
                        ...liq.deductions.fruitAdvance,
                        totalMontant: fruitMontant,
                        resteADeduire: Math.max(fruitMontant - liq.deductions.fruitAdvance.totalPreleve, 0),
                    },
                },
            };

            const handlePrixChange = (semaine, newPrix) => {
                setEditingPrix(prev => ({ ...prev, [semaine]: parseFloat(newPrix) || 0 }));
            };

            const getEstimePrix = (item) => editingPrix[item.semaine] !== undefined ? editingPrix[item.semaine] : item.prixEstime;
            const getEstimeMontant = (item) => item.qteKg * getEstimePrix(item);

            const totalEncaisseHist = liq.historique.reduce((s, l) => s + l.montantNet, 0);
            const totalAVenir = liq.aVenir.reduce((s, l) => s + l.qteKg * getEstimePrix(l), 0);

            const pctPlants = liq.deductions.plants.totalFacture > 0
                ? (liq.deductions.plants.totalPreleve / liq.deductions.plants.totalFacture * 100)
                : 0;
            const pctPret = liq.deductions.cropAdvance.totalMontant > 0
                ? (liq.deductions.cropAdvance.totalPreleve / liq.deductions.cropAdvance.totalMontant * 100)
                : 0;

            return (
                <div className="fade-in">
                    {/* Culture filter */}
                    <div style={{display:'flex', gap:'8px', marginBottom:'12px', alignItems:'center'}}>
                        <span style={{fontSize:12, color:'var(--gray-500)', fontWeight:600}}>Culture:</span>
                        <button className={`chip c-purple ${!selectedFruit ? 'active' : ''}`} onClick={() => setSelectedFruit('')}>Toutes</button>
                        <button className={`chip c-berry ${selectedFruit === 'framboise' ? 'active' : ''}`} onClick={() => setSelectedFruit(selectedFruit === 'framboise' ? '' : 'framboise')}>🍓 Framboise</button>
                        <button className={`chip c-indigo ${selectedFruit === 'myrtille' ? 'active' : ''}`} onClick={() => setSelectedFruit(selectedFruit === 'myrtille' ? '' : 'myrtille')}>🫐 Myrtille</button>
                        {fetchedDocs === null && <span style={{fontSize:11, color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin" style={{marginRight:4}}></i>Chargement…</span>}
                        {fetchedDocs !== null && <span style={{fontSize:11, color:'var(--green)'}}><i className="fa-solid fa-check-circle" style={{marginRight:4}}></i>Données en direct ({fetchedDocs.length} liquidations)</span>}
                    </div>
                    {/* Sub-tab navigation */}
                    <div style={{display:'flex', gap:'8px', marginBottom:'20px'}}>
                        {[
                            {id:'situation', label:'Situation Globale', icon:'fa-chart-line'},
                            {id:'deductions', label:'Déductions', icon:'fa-scissors'},
                            {id:'planning', label:'Planning Prélèvements', icon:'fa-calendar-check'}
                        ].map(t => (
                            <button key={t.id} className={`chip c-berry ${subTab===t.id ? 'active' : ''}`} onClick={() => setSubTab(t.id)} style={{padding:'8px 18px',fontSize:12.5}}>
                                <i className={`fa-solid ${t.icon}`} style={{marginRight:4}}></i> {t.label}
                            </button>
                        ))}
                    </div>

                    {subTab === 'situation' && (
                        <div>
                            {/* KPIs */}
                            <div className="kpi-grid">
                                <KPICard icon="fa-weight-scale" iconClass="berry" value={liq.totalKg.toLocaleString('fr-FR')} label="Total Kg Campagne" />
                                <KPICard icon="fa-money-bill-trend-up" iconClass="green" value={`${Math.round(liq.totalBrut/1000).toLocaleString('fr-FR')}K`} label="Montant Brut (DH)" />
                                <KPICard icon="fa-hand-holding-dollar" iconClass="blue" value={`${Math.round(liq.totalEncaisse/1000).toLocaleString('fr-FR')}K`} label="Encaissé (DH)" />
                                <KPICard icon="fa-clock" iconClass="orange" value={`${Math.round(liq.enCours/1000).toLocaleString('fr-FR')}K`} label="En Cours (DH)" />
                            </div>

                            {/* Liquidations à venir */}
                            <Panel title="Liquidations à Venir (décalage 4 semaines)" icon="fa-forward">
                                <p style={{fontSize:'12px', color:'var(--gray-400)', marginBottom:'12px'}}>
                                    <i className="fa-solid fa-info-circle"></i> Prix estimé pondéré par variété (moyenne des 2 dernières liquidations par culture). Modifiable.
                                </p>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Semaine</th>
                                            <th>Variétés</th>
                                            <th>Quantité (Kg)</th>
                                            <th>Prix Estimé (DH/Kg)</th>
                                            <th>Montant Estimé (DH)</th>
                                            <th>Date Estimée Encaissement</th>
                                            <th>Statut</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {liq.aVenir.map((l, i) => {
                                            const byVar = l.byVariety || {};
                                            const varEntries = Object.entries(byVar).sort((a, b) => b[1] - a[1]);
                                            return (
                                                <tr key={i}>
                                                    <td><strong>{l.semaine}</strong>{l.cultures && l.cultures.length > 1 && <span style={{marginLeft:6, fontSize:10}}>🍓🫐</span>}</td>
                                                    <td style={{fontSize:11, color:'var(--gray-600)'}}>
                                                        {varEntries.length === 0 ? '-' : varEntries.map(([v, kg], j) => (
                                                            <span key={v} style={{display:'inline-block', marginRight:8}}>
                                                                <strong>{v}</strong>: {Math.round(kg).toLocaleString('fr-FR')}{j < varEntries.length - 1 ? ' ·' : ''}
                                                            </span>
                                                        ))}
                                                    </td>
                                                    <td>{l.qteKg.toLocaleString('fr-FR')}</td>
                                                    <td>
                                                        <input type="number" step="0.01" value={getEstimePrix(l)}
                                                            onChange={e => handlePrixChange(l.semaine, e.target.value)}
                                                            style={{width:'90px', padding:'4px 8px', border:'1px solid var(--gold)', borderRadius:'6px', fontSize:'13px', fontWeight:'600', color:'var(--berry)', background:'rgba(212,168,71,0.08)', textAlign:'right'}} />
                                                    </td>
                                                    <td><strong>{Math.round(getEstimeMontant(l)).toLocaleString('fr-FR')}</strong></td>
                                                    <td>{l.dateEstimee}</td>
                                                    <td><span className={`status-badge ${l.status === 'En attente' ? 'orange' : 'blue'}`}>{l.status === 'En attente' ? '⏳' : '🔮'} {l.status}</span></td>
                                                </tr>
                                            );
                                        })}
                                        <tr style={{background:'var(--gray-100)', fontWeight:'700'}}>
                                            <td>TOTAL À VENIR</td>
                                            <td></td>
                                            <td>{liq.aVenir.reduce((s,l) => s+l.qteKg, 0).toLocaleString('fr-FR')}</td>
                                            <td></td>
                                            <td>{Math.round(totalAVenir).toLocaleString('fr-FR')}</td>
                                            <td></td>
                                            <td></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </Panel>

                            {/* Historique Liquidations */}
                            <Panel title="Historique Liquidations Campagne 2025-2026" icon="fa-history">
                                <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:8}}><i className="fa-solid fa-hand-pointer" style={{marginRight:4}}></i> Cliquez sur une liquidation pour voir le rapport Driscoll's</div>
                                <div style={{maxHeight:'400px', overflowY:'auto'}}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Semaine</th>
                                            <th>Qté (Kg)</th>
                                            <th>Prix Moy.</th>
                                            <th>Montant Brut</th>
                                            <th>Prélèv. Plants</th>
                                            <th>Prélèv. Prêt</th>
                                            <th>Montant Net</th>
                                            <th>Encaissement</th>
                                            <th>Statut</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {liq.historique.slice().reverse().map((l, i) => (
                                            <tr key={i} onClick={() => setSelectedLiquidation(l)} style={{cursor:'pointer'}}
                                                onMouseOver={e => e.currentTarget.style.background='rgba(139,34,82,0.04)'}
                                                onMouseOut={e => e.currentTarget.style.background=''}>
                                                <td><strong style={{color:'var(--berry)'}}>{l.semaine}</strong></td>
                                                <td>{l.qteKg.toLocaleString('fr-FR')}</td>
                                                <td>{l.prixMoyen.toFixed(2)}</td>
                                                <td>{Math.round(l.montantBrut).toLocaleString('fr-FR')}</td>
                                                <td style={{color: l.prelevPlants > 0 ? 'var(--red)' : 'var(--gray-400)'}}>{l.prelevPlants > 0 ? `-${Math.round(l.prelevPlants).toLocaleString('fr-FR')}` : '-'}</td>
                                                <td style={{color: l.prelevPret > 0 ? 'var(--red)' : 'var(--gray-400)'}}>{l.prelevPret > 0 ? `-${Math.round(l.prelevPret).toLocaleString('fr-FR')}` : '-'}</td>
                                                <td><strong style={{color:'var(--green)'}}>{Math.round(l.montantNet).toLocaleString('fr-FR')}</strong></td>
                                                <td>{l.dateEncaissement}</td>
                                                <td><span className="status-badge green">✓ {l.status}</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    {(() => {
                                        const h = liq.historique;
                                        const totKg = h.reduce((s, l) => s + (l.qteKg || 0), 0);
                                        const totBrut = h.reduce((s, l) => s + (l.montantBrut || 0), 0);
                                        const totPlants = h.reduce((s, l) => s + (l.prelevPlants || 0), 0);
                                        const totPret = h.reduce((s, l) => s + (l.prelevPret || 0), 0);
                                        const totNet = h.reduce((s, l) => s + (l.montantNet || 0), 0);
                                        const avgPrix = totKg > 0 ? totBrut / totKg : 0;
                                        return (
                                            <tfoot>
                                                <tr style={{background:'var(--gray-100)', fontWeight:700, borderTop:'2px solid var(--dark)'}}>
                                                    <td>TOTAL</td>
                                                    <td>{totKg.toLocaleString('fr-FR', {maximumFractionDigits:1})}</td>
                                                    <td>{avgPrix.toFixed(2)}</td>
                                                    <td>{Math.round(totBrut).toLocaleString('fr-FR')}</td>
                                                    <td style={{color:'var(--red)'}}>{totPlants > 0 ? `-${Math.round(totPlants).toLocaleString('fr-FR')}` : '-'}</td>
                                                    <td style={{color:'var(--red)'}}>{totPret > 0 ? `-${Math.round(totPret).toLocaleString('fr-FR')}` : '-'}</td>
                                                    <td style={{color:'var(--green)'}}>{Math.round(totNet).toLocaleString('fr-FR')}</td>
                                                    <td colSpan="2"></td>
                                                </tr>
                                            </tfoot>
                                        );
                                    })()}
                                </table>
                                </div>
                            </Panel>

                            {/* Evolution chart */}
                            <Panel title="Évolution Prix Moyen par Semaine" icon="fa-chart-line">
                                <SimpleAreaChart
                                    data={liq.historique.map(l => ({ semaine: l.semaine.replace('S','').replace('-2025','').replace('-2026','\'26'), prix: l.prixMoyen, montantK: Math.round(l.montantBrut/1000) }))}
                                    dataKeys={['prix']}
                                    colors={['#8B2252']}
                                    xKey="semaine"
                                    height={220}
                                />
                            </Panel>
                        </div>
                    )}

                    {subTab === 'deductions' && (
                        <div>
                            {/* Summary KPIs */}
                            <div className="kpi-grid">
                                <KPICard icon="fa-seedling" iconClass="green"
                                    value={`${Math.round(liq.deductions.plants.resteADeduire/1000).toLocaleString('fr-FR')}K`}
                                    label="Reste Plants"
                                    subItems={[
                                        {value: `${Math.round(liq.deductions.plants.totalFacture/1000)}K`, label: 'Facturé'},
                                        {value: `${Math.round(liq.deductions.plants.totalPreleve/1000)}K`, label: 'Prélevé'},
                                        {value: `${pctPlants.toFixed(1)}%`, label: 'Avancement'}
                                    ]} />
                                <div onClick={() => {
                                        // Crop Advance is a GLOBAL pot — always single value, no per-culture editor.
                                        setEditingMontant('cropAdvance');
                                        setEditMontantValue(String(deductionMontants.cropAdvance || ''));
                                    }} style={{cursor: 'pointer'}}>
                                <KPICard icon="fa-handshake" iconClass="blue"
                                    value={`${Math.round(liq.deductions.cropAdvance.resteADeduire/1000).toLocaleString('fr-FR')}K`}
                                    label="Reste Crop Advance"
                                    subItems={[
                                        {value: `${Math.round(liq.deductions.cropAdvance.totalMontant/1000)}K`, label: 'Montant'},
                                        {value: `${Math.round(liq.deductions.cropAdvance.totalPreleve/1000)}K`, label: 'Prélevé'},
                                        {value: `${pctPret.toFixed(1)}%`, label: 'Avancement'}
                                    ]} />
                                </div>
                                <div onClick={() => {
                                        setEditingMontant('fruitAdvance');
                                        if (selectedFruit) {
                                            setEditMontantValue(String(getMontantsForCulture(selectedFruit).fruitAdvance || ''));
                                        } else {
                                            const fA = deductionMontants.fruitAdvance || {};
                                            setEditMontantPerCulture({
                                                framboise: String(fA.framboise || ''),
                                                myrtille: String(fA.myrtille || ''),
                                            });
                                        }
                                    }} style={{cursor: 'pointer'}}>
                                <KPICard icon="fa-apple-whole" iconClass="orange"
                                    value={`${Math.round(liq.deductions.fruitAdvance.resteADeduire/1000).toLocaleString('fr-FR')}K`}
                                    label="Reste Fruit Advance"
                                    subItems={[
                                        {value: `${Math.round(liq.deductions.fruitAdvance.totalMontant/1000)}K`, label: 'Montant'},
                                        {value: `${Math.round(liq.deductions.fruitAdvance.totalPreleve/1000)}K`, label: 'Prélevé'}
                                    ]} />
                                </div>
                                <KPICard icon="fa-calculator" iconClass="berry"
                                    value={`${Math.round((liq.deductions.plants.resteADeduire + liq.deductions.cropAdvance.resteADeduire + liq.deductions.fruitAdvance.resteADeduire)/1000).toLocaleString('fr-FR')}K`}
                                    label="Total Reste à Déduire" />
                            </div>

                            {/* Progress bars */}
                            <Panel title="Avancement des Déductions" icon="fa-tasks">
                                {[
                                    { label: liq.deductions.plants.designation, pct: pctPlants, total: liq.deductions.plants.totalFacture, preleve: liq.deductions.plants.totalPreleve, color: 'var(--green)' },
                                    { label: 'Crop Advance (Prêt)', pct: pctPret, total: liq.deductions.cropAdvance.totalMontant, preleve: liq.deductions.cropAdvance.totalPreleve, color: 'var(--blue)' },
                                    { label: 'Fruit Advance', pct: liq.deductions.fruitAdvance.totalMontant > 0 ? (liq.deductions.fruitAdvance.totalPreleve / liq.deductions.fruitAdvance.totalMontant * 100) : 0, total: liq.deductions.fruitAdvance.totalMontant, preleve: liq.deductions.fruitAdvance.totalPreleve, color: 'var(--orange)' },
                                ].map((d, i) => (
                                    <div key={i} style={{marginBottom:'20px'}}>
                                        <div style={{display:'flex', justifyContent:'space-between', marginBottom:'6px'}}>
                                            <span style={{fontWeight:'600', fontSize:'14px'}}>{d.label}</span>
                                            <span style={{fontSize:'13px', color:'var(--gray-600)'}}>
                                                {Math.round(d.preleve).toLocaleString('fr-FR')} / {Math.round(d.total).toLocaleString('fr-FR')} DH ({d.pct.toFixed(1)}%)
                                            </span>
                                        </div>
                                        <div style={{height:'12px', background:'var(--gray-100)', borderRadius:'6px', overflow:'hidden'}}>
                                            <div style={{height:'100%', width:`${Math.min(d.pct, 100)}%`, background:d.color, borderRadius:'6px', transition:'width 0.5s ease'}}></div>
                                        </div>
                                    </div>
                                ))}
                            </Panel>

                            {/* Factures Plants */}
                            <Panel title={`Factures ${liq.deductions.plants.designation}`} icon="fa-file-invoice" actions={
                                plantInvoices !== null && <span style={{fontSize:11, color:'var(--gray-400)'}}>{filteredInvoices.length} facture(s)</span>
                            }>
                                {/* Drop zone — clickable + drag-and-drop, multi-file */}
                                <input type="file" ref={fileInputRef} accept="application/pdf,image/jpeg,image/png,image/webp" multiple style={{display:'none'}}
                                    onChange={e => handleUploadInvoices(e.target.files)} />
                                <div
                                    onClick={() => !uploadingInvoice && fileInputRef.current && fileInputRef.current.click()}
                                    onDragOver={e => { e.preventDefault(); if (!uploadingInvoice) setInvoiceDragOver(true); }}
                                    onDragEnter={e => { e.preventDefault(); if (!uploadingInvoice) setInvoiceDragOver(true); }}
                                    onDragLeave={() => setInvoiceDragOver(false)}
                                    onDrop={e => { e.preventDefault(); setInvoiceDragOver(false); if (!uploadingInvoice) handleUploadInvoices(e.dataTransfer.files); }}
                                    style={{
                                        border: invoiceDragOver ? '2.5px solid var(--berry)' : '2.5px dashed var(--gray-300)',
                                        borderRadius: 12,
                                        padding: '20px 24px',
                                        textAlign: 'center',
                                        cursor: uploadingInvoice ? 'wait' : 'pointer',
                                        background: invoiceDragOver ? 'rgba(139,34,82,0.06)' : 'var(--gray-50)',
                                        transition: 'all 0.2s ease',
                                        marginBottom: 12,
                                    }}>
                                    <i className={`fa-solid ${uploadingInvoice ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'}`} style={{fontSize:28, color: invoiceDragOver ? 'var(--berry)' : 'var(--gray-400)', marginBottom:8, display:'block'}}></i>
                                    <div style={{fontSize:13, fontWeight:600, color:'var(--dark)'}}>
                                        {uploadingInvoice
                                            ? (uploadProgress ? `Analyse ${uploadProgress.current}/${uploadProgress.total} : ${uploadProgress.currentName}` : 'Analyse en cours…')
                                            : 'Glissez-déposez vos factures plants ici ou cliquez pour parcourir'}
                                    </div>
                                    <div style={{fontSize:11, color:'var(--gray-400)', marginTop:4}}>PDF, JPG, PNG · max 10 MB · multi-fichiers OK</div>
                                </div>

                                {uploadResult && (
                                    <div style={{padding:'10px 14px', marginBottom:10, borderRadius:8, fontSize:12, background: uploadResult.ok ? 'rgba(76,175,80,0.1)' : 'rgba(244,67,54,0.1)', color: uploadResult.ok ? '#2e7d32' : '#c62828', border:`1px solid ${uploadResult.ok ? '#a5d6a7' : '#ef9a9a'}`}}>
                                        <i className={`fa-solid ${uploadResult.ok ? 'fa-check-circle' : 'fa-circle-exclamation'}`} style={{marginRight:6}}></i>
                                        {uploadResult.msg}
                                        <button onClick={() => setUploadResult(null)} style={{float:'right', background:'none', border:'none', cursor:'pointer', color:'inherit'}}>×</button>
                                    </div>
                                )}

                                {liq.deductions.plants.factures.length > 0 && (
                                    <p style={{fontSize:'11px', color:'var(--gray-400)', marginBottom:'10px'}}>
                                        <i className="fa-solid fa-hand-pointer"></i> Cliquez sur une facture pour afficher le détail Driscoll's
                                    </p>
                                )}
                                {liq.deductions.plants.factures.length === 0 ? (
                                    <div style={{textAlign:'center', padding:'24px', color:'var(--gray-400)', fontSize:12}}>
                                        Aucune facture pour l'instant — uploadez vos PDFs Driscoll's via la zone ci-dessus.
                                    </div>
                                ) : (
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Date</th><th>Référence</th><th>Commande</th><th>Variété</th><th>Quantité</th><th>Montant (DH)</th>
                                                {isAdmin && <th style={{textAlign:'center', width:80}}>Actions</th>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {liq.deductions.plants.factures.map((f, i) => {
                                                // Show admin actions only on the FIRST row of each ref to avoid clutter
                                                const isFirstOfRef = i === 0 || liq.deductions.plants.factures[i - 1].ref !== f.ref;
                                                return (
                                                    <tr key={i} onClick={() => setSelectedFacture(f)} style={{cursor:'pointer', transition:'background 0.15s'}} onMouseOver={e => e.currentTarget.style.background='var(--berry-pale)'} onMouseOut={e => e.currentTarget.style.background=''}>
                                                        <td>{f.date}</td>
                                                        <td><strong style={{color:'var(--blue)'}}>{f.ref}</strong></td>
                                                        <td style={{fontFamily:'monospace', fontSize:11, color:'var(--gray-500)'}}>{f.commande || '-'}</td>
                                                        <td style={{fontWeight:500}}>{f.variete}</td>
                                                        <td>{f.qte ? f.qte.toLocaleString('fr-FR') : '-'}</td>
                                                        <td>{Math.round(f.montant).toLocaleString('fr-FR')}</td>
                                                        {isAdmin && (
                                                            <td style={{textAlign:'center'}} onClick={e => e.stopPropagation()}>
                                                                {isFirstOfRef && (
                                                                    <div style={{display:'flex', gap:4, justifyContent:'center'}}>
                                                                        <button onClick={() => handleRescanInvoice(f.ref)} disabled={uploadingInvoice}
                                                                            title="Re-scanner ce PDF"
                                                                            style={{background:'var(--blue)', color:'#fff', border:'none', borderRadius:6, padding:'4px 8px', cursor:uploadingInvoice?'wait':'pointer', fontSize:10}}>
                                                                            <i className="fa-solid fa-arrows-rotate"></i>
                                                                        </button>
                                                                        <button onClick={() => handleDeleteInvoice(f.ref)} disabled={uploadingInvoice}
                                                                            title="Supprimer cette facture"
                                                                            style={{background:'var(--red)', color:'#fff', border:'none', borderRadius:6, padding:'4px 8px', cursor:uploadingInvoice?'wait':'pointer', fontSize:10}}>
                                                                            <i className="fa-solid fa-trash"></i>
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </td>
                                                        )}
                                                    </tr>
                                                );
                                            })}
                                            <tr style={{background:'var(--gray-100)', fontWeight:'700'}}>
                                                <td colSpan={isAdmin ? 5 : 5}>TOTAL FACTURÉ</td>
                                                <td>{Math.round(liq.deductions.plants.totalFacture).toLocaleString('fr-FR')}</td>
                                                {isAdmin && <td></td>}
                                            </tr>
                                        </tbody>
                                    </table>
                                )}
                            </Panel>

                            {/* ===== FACTURE POPUP ===== */}
                            {selectedFacture && (
                                <div className="modal-overlay" onClick={() => setSelectedFacture(null)}>
                                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:'700px', maxHeight:'90vh', overflowY:'auto', padding:0}}>
                                        {/* Driscoll's Invoice Header */}
                                        <div style={{padding:'20px 24px 16px', borderBottom:'3px solid var(--green)'}}>
                                            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                                                <div>
                                                    <div style={{fontSize:'11px', color:'var(--gray-400)', fontWeight:600}}>Driscoll's Du Maroc SARL</div>
                                                    <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Douar Dlalha - BP 4422</div>
                                                    <div style={{fontSize:'10px', color:'var(--gray-400)'}}>92003 My Bouselham (Larache), Maroc</div>
                                                </div>
                                                <div style={{textAlign:'right'}}>
                                                    <div style={{fontSize:'22px', fontWeight:'800', color:'var(--green)', fontFamily:'Georgia, serif', letterSpacing:'-0.5px'}}>FACTURE</div>
                                                    <div style={{fontSize:'10px', color:'var(--gray-400)', marginTop:'2px'}}>Driscoll's - Only the Finest Berries</div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Address + Invoice Info */}
                                        <div style={{padding:'12px 24px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', borderBottom:'1px solid var(--gray-200)'}}>
                                            <div>
                                                <div style={{fontSize:'10px', fontWeight:'600', color:'var(--gray-400)', textTransform:'uppercase', marginBottom:'4px'}}>Adresse de facturation</div>
                                                <div style={{fontSize:'12px', fontWeight:'600'}}>Berry Good Farms SARL</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-500)'}}>Res Tifaouine Imm E Apt 21 Av Moukawama</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-500)'}}>ICE 002106859000069</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-500)'}}>80020 Agadir, Maroc</div>
                                            </div>
                                            <div>
                                                <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:'3px 10px', fontSize:'11px'}}>
                                                    <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Client</span><span>400145</span>
                                                    <span style={{fontWeight:'600', color:'var(--gray-400)'}}>IF N.</span><span>2610702</span>
                                                    <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Notre réf.</span><span>11265</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Commande + Facture ref */}
                                        <div style={{padding:'10px 24px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px', borderBottom:'1px solid var(--gray-200)', background:'var(--gray-100)'}}>
                                            <div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)', fontWeight:600}}>Commande</div>
                                                <div style={{fontSize:'12px', fontWeight:700}}>{selectedFacture.commande || '-'}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-500)'}}>{selectedFacture.date}</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)', fontWeight:600}}>Facture</div>
                                                <div style={{fontSize:'12px', fontWeight:700, color:'var(--berry)'}}>{selectedFacture.ref}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-500)'}}>{selectedFacture.date}</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)', fontWeight:600}}>Date de livraison</div>
                                                <div style={{fontSize:'12px', fontWeight:600}}>{selectedFacture.livraison || '-'}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-500)'}}>Conditions: EXW</div>
                                            </div>
                                        </div>

                                        {/* Invoice Lines Table */}
                                        <div style={{padding:'12px 24px'}}>
                                            <table className="data-table" style={{fontSize:'12px'}}>
                                                <thead>
                                                    <tr style={{background:'var(--gray-100)'}}>
                                                        <th>Qté</th><th>Nom du produit</th><th style={{textAlign:'right'}}>Poids net</th><th style={{textAlign:'right'}}>Unité</th><th style={{textAlign:'right'}}>Prix unitaire</th><th style={{textAlign:'right'}}>TVA %</th><th style={{textAlign:'right'}}>Montant</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr style={{fontSize:'11px', color:'var(--gray-400)'}}>
                                                        <td colSpan="7">{selectedFacture.commande || '-'}</td>
                                                    </tr>
                                                    <tr style={{fontSize:'11px', color:'var(--gray-400)'}}>
                                                        <td colSpan="7">Packing slip {selectedFacture.packing || '-'}:</td>
                                                    </tr>
                                                    <tr>
                                                        <td>{selectedFacture.qte ? selectedFacture.qte.toLocaleString('fr-FR') : '-'}</td>
                                                        <td style={{fontWeight:600}}>{selectedFacture.variete}</td>
                                                        <td style={{textAlign:'right'}}>0.00</td>
                                                        <td style={{textAlign:'right'}}>1000 ea</td>
                                                        <td style={{textAlign:'right'}}>MAD {selectedFacture.qte ? (selectedFacture.montant / selectedFacture.qte * 1000).toFixed(2) : '-'}</td>
                                                        <td style={{textAlign:'right'}}>0,00 %</td>
                                                        <td style={{textAlign:'right', fontWeight:700}}>MAD {selectedFacture.montant.toLocaleString('fr-FR', {minimumFractionDigits:2})}</td>
                                                    </tr>
                                                    <tr style={{background:'var(--gray-100)', fontWeight:700, borderTop:'2px solid var(--gray-300)'}}>
                                                        <td colSpan="3"></td>
                                                        <td colSpan="3" style={{textAlign:'right'}}>Total before VAT</td>
                                                        <td style={{textAlign:'right'}}>MAD {selectedFacture.montant.toLocaleString('fr-FR', {minimumFractionDigits:2})}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* TVA + Totals */}
                                        <div style={{padding:'0 24px 12px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px'}}>
                                            <div style={{fontSize:'11px', color:'var(--gray-500)'}}>
                                                <div><strong>Exonerable</strong></div>
                                                <div style={{marginTop:'4px'}}>Conditions de paiement: <strong>90 Jours</strong></div>
                                                <div>Date d'échéance: <strong>{selectedFacture.echeance || '-'}</strong></div>
                                            </div>
                                            <div>
                                                <div style={{background:'var(--gray-100)', borderRadius:'8px', padding:'8px 12px', fontSize:'11px'}}>
                                                    <div style={{fontWeight:600, marginBottom:'4px'}}>TVA - IF N. 04960175</div>
                                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'2px', fontSize:'10px', color:'var(--gray-400)'}}>
                                                        <span>TVA %</span><span>HT</span><span>TVA</span>
                                                        <span>0,00 %</span><span>MAD {selectedFacture.montant.toLocaleString('fr-FR', {minimumFractionDigits:2})}</span><span>MAD 0.00</span>
                                                    </div>
                                                    <div style={{borderTop:'1px solid var(--gray-300)', marginTop:'6px', paddingTop:'6px', display:'flex', justifyContent:'space-between'}}>
                                                        <span>Total TVA</span><span>MAD 0.00</span>
                                                    </div>
                                                </div>
                                                <div style={{marginTop:'8px', background:'var(--berry-pale)', borderRadius:'8px', padding:'10px 12px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                                    <span style={{fontWeight:700, fontSize:'13px'}}>Total TTC</span>
                                                    <span style={{fontWeight:800, fontSize:'15px', color:'var(--berry)'}}>MAD {selectedFacture.montant.toLocaleString('fr-FR', {minimumFractionDigits:2})}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Footer */}
                                        <div style={{padding:'10px 24px', borderTop:'1px solid var(--gray-200)', fontSize:'9px', color:'var(--gray-400)'}}>
                                            <div>Vente Fermée | En cas de retards de paiement une pénalité égale à une fois et demi le taux de l'intérêt légal sera exigible.</div>
                                            <div style={{marginTop:'2px'}}>*R.C. 24587 *T.P. 22211020 * IF 04960175 * CNSS 2258053 * ICE 001536944000082</div>
                                        </div>

                                        {/* Close button */}
                                        <div style={{padding:'12px 24px 16px', textAlign:'center'}}>
                                            <button className="btn-primary" onClick={() => setSelectedFacture(null)} style={{width:'auto', padding:'10px 32px'}}>
                                                <i className="fa-solid fa-times"></i> Fermer
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Historique Prélèvements Plants */}
                            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'16px'}}>
                                <Panel title={`Prélèvements ${liq.deductions.plants.designation}`} icon="fa-seedling">
                                    <div style={{maxHeight:'300px', overflowY:'auto'}}>
                                    <table className="data-table">
                                        <thead><tr><th>Semaine</th><th>Montant (DH)</th></tr></thead>
                                        <tbody>
                                            {liq.deductions.plants.prelevements.map((p, i) => {
                                                const matchedLiq = liq.historique.find(h => h.semaine === p.semaine);
                                                return (
                                                    <tr key={i} style={{cursor: matchedLiq ? 'pointer' : 'default'}} onClick={() => matchedLiq && setSelectedLiquidation(matchedLiq)}
                                                        onMouseOver={e => matchedLiq && (e.currentTarget.style.background='rgba(139,34,82,0.04)')}
                                                        onMouseOut={e => e.currentTarget.style.background=''}>
                                                        <td><span style={{color: matchedLiq ? 'var(--berry)' : 'inherit', fontWeight: matchedLiq ? 600 : 400}}>{p.semaine}</span></td>
                                                        <td style={{color:'var(--red)'}}>{Math.round(p.montant).toLocaleString('fr-FR')}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    </div>
                                </Panel>
                                <Panel title="Prélèvements Crop Advance" icon="fa-handshake">
                                    <div style={{maxHeight:'300px', overflowY:'auto'}}>
                                    <table className="data-table">
                                        <thead><tr><th>Semaine</th><th>Montant (DH)</th></tr></thead>
                                        <tbody>
                                            {liq.deductions.cropAdvance.prelevements.map((p, i) => {
                                                const matchedLiq = liq.historique.find(h => h.semaine === p.semaine);
                                                return (
                                                    <tr key={i} style={{cursor: matchedLiq ? 'pointer' : 'default'}} onClick={() => matchedLiq && setSelectedLiquidation(matchedLiq)}
                                                        onMouseOver={e => matchedLiq && (e.currentTarget.style.background='rgba(139,34,82,0.04)')}
                                                        onMouseOut={e => e.currentTarget.style.background=''}>
                                                        <td><span style={{color: matchedLiq ? 'var(--berry)' : 'inherit', fontWeight: matchedLiq ? 600 : 400}}>{p.semaine}</span></td>
                                                        <td style={{color:'var(--red)'}}>{Math.round(p.montant).toLocaleString('fr-FR')}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    </div>
                                </Panel>
                                <Panel title="Prélèvements Fruit Advance" icon="fa-apple-whole">
                                    <div style={{maxHeight:'300px', overflowY:'auto'}}>
                                    <table className="data-table">
                                        <thead><tr><th>Semaine</th><th>Montant (DH)</th></tr></thead>
                                        <tbody>
                                            {liq.deductions.fruitAdvance.prelevements.map((p, i) => {
                                                const matchedLiq = liq.historique.find(h => h.semaine === p.semaine);
                                                return (
                                                    <tr key={i} style={{cursor: matchedLiq ? 'pointer' : 'default'}} onClick={() => matchedLiq && setSelectedLiquidation(matchedLiq)}
                                                        onMouseOver={e => matchedLiq && (e.currentTarget.style.background='rgba(139,34,82,0.04)')}
                                                        onMouseOut={e => e.currentTarget.style.background=''}>
                                                        <td><span style={{color: matchedLiq ? 'var(--berry)' : 'inherit', fontWeight: matchedLiq ? 600 : 400}}>{p.semaine}</span></td>
                                                        <td style={{color:'var(--red)'}}>{Math.round(p.montant).toLocaleString('fr-FR')}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    </div>
                                </Panel>
                            </div>

                            {/* Add deduction button */}
                            <button className="fab-btn" onClick={() => setShowDeductionModal(true)} title="Saisir une déduction">
                                <i className="fa-solid fa-plus"></i>
                            </button>

                            {showDeductionModal && (
                                <div className="modal-overlay" onClick={() => setShowDeductionModal(false)}>
                                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                                        <h2><i className="fa-solid fa-scissors"></i> Saisir Déduction</h2>
                                        <div className="form-group">
                                            <label>Type de Déduction</label>
                                            <select value={deductionForm.type} onChange={e => setDeductionForm(prev => ({...prev, type: e.target.value}))}>
                                                <option value="plants">Plants Framboise</option>
                                                <option value="cropAdvance">Crop Advance (Prêt)</option>
                                                <option value="fruitAdvance">Fruit Advance</option>
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>Semaine de Liquidation</label>
                                            <input type="text" placeholder="Ex: S08" value={deductionForm.semaine} onChange={e => setDeductionForm(prev => ({...prev, semaine: e.target.value}))} />
                                        </div>
                                        <div className="form-group">
                                            <label>Montant (DH)</label>
                                            <input type="number" placeholder="0.00" value={deductionForm.montant} onChange={e => setDeductionForm(prev => ({...prev, montant: e.target.value}))} />
                                        </div>
                                        <div className="form-actions">
                                            <button className="btn-secondary" onClick={() => setShowDeductionModal(false)}>Annuler</button>
                                            <button className="btn-primary" onClick={() => { setShowDeductionModal(false); setDeductionForm({type:'plants', semaine:'', montant:''}); }}>
                                                <i className="fa-solid fa-check"></i> Enregistrer
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Modal édition montant Crop Advance / Fruit Advance */}
                            {editingMontant && (
                                <div className="modal-overlay" onClick={() => setEditingMontant(null)}>
                                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:400}}>
                                        <h2><i className="fa-solid fa-pen"></i> {editingMontant === 'cropAdvance'
                                            ? "Montant Crop Advance (prêt — global ferme)"
                                            : `Montant Fruit Advance${selectedFruit ? ` — ${selectedFruit === 'myrtille' ? 'Myrtille' : 'Framboise'}` : ''}`}</h2>
                                        <p style={{fontSize:12, color:'var(--gray-500)', marginBottom:16}}>
                                            {editingMontant === 'cropAdvance'
                                                ? "Le Crop Advance est un prêt unique convenu avec Driscoll's pour l'ensemble de la ferme. Les prélèvements Framboise + Myrtille viennent décompter ce même montant."
                                                : "Saisissez le montant total convenu avec Driscoll's pour cette saison. Cette valeur sera utilisée pour calculer le reste à déduire et l'avancement."}
                                        </p>
                                        {(editingMontant === 'cropAdvance' || selectedFruit) ? (
                                            <>
                                                <div className="form-group">
                                                    <label>Montant total (DH)</label>
                                                    <input type="number" placeholder="Ex: 1200000" value={editMontantValue}
                                                        onChange={e => setEditMontantValue(e.target.value)}
                                                        onKeyDown={e => { if (e.key === 'Enter') saveDeductionMontant(editingMontant, parseFloat(editMontantValue) || 0); }}
                                                        autoFocus style={{fontSize:16, fontWeight:700}} />
                                                </div>
                                                <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:16}}>
                                                    Valeur actuelle : <strong>{(editingMontant === 'cropAdvance'
                                                        ? (deductionMontants.cropAdvance || 0)
                                                        : (getMontantsForCulture(selectedFruit).fruitAdvance || 0)
                                                    ).toLocaleString('fr-FR')} DH</strong>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="form-group">
                                                    <label>Framboise (DH)</label>
                                                    <input type="number" placeholder="Ex: 1200000" value={editMontantPerCulture.framboise}
                                                        onChange={e => setEditMontantPerCulture(v => ({ ...v, framboise: e.target.value }))}
                                                        autoFocus style={{fontSize:16, fontWeight:700}} />
                                                </div>
                                                <div className="form-group">
                                                    <label>Myrtille (DH)</label>
                                                    <input type="number" placeholder="Ex: 1200000" value={editMontantPerCulture.myrtille}
                                                        onChange={e => setEditMontantPerCulture(v => ({ ...v, myrtille: e.target.value }))}
                                                        onKeyDown={e => { if (e.key === 'Enter') saveDeductionMontant(editingMontant, editMontantPerCulture); }}
                                                        style={{fontSize:16, fontWeight:700}} />
                                                </div>
                                                <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:16}}>
                                                    Valeurs actuelles : Framboise <strong>{((deductionMontants.fruitAdvance || {}).framboise || 0).toLocaleString('fr-FR')} DH</strong> · Myrtille <strong>{((deductionMontants.fruitAdvance || {}).myrtille || 0).toLocaleString('fr-FR')} DH</strong>
                                                </div>
                                            </>
                                        )}
                                        <div className="form-actions">
                                            <button className="btn-secondary" onClick={() => setEditingMontant(null)}>Annuler</button>
                                            <button className="btn-primary" onClick={() => saveDeductionMontant(editingMontant, (editingMontant === 'cropAdvance' || selectedFruit) ? (parseFloat(editMontantValue) || 0) : editMontantPerCulture)}>
                                                <i className="fa-solid fa-check"></i> Enregistrer
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {subTab === 'planning' && (
                        <div>
                            <Panel title="Planning Prélèvements vs Réel" icon="fa-calendar-check">
                                <p style={{fontSize:'12px', color:'var(--gray-400)', marginBottom:'12px'}}>
                                    <i className="fa-solid fa-info-circle"></i> Comparaison entre les prélèvements planifiés et les prélèvements réels sur chaque liquidation.
                                </p>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Semaine</th>
                                            <th>Plan Plants (DH)</th>
                                            <th>Plan Prêt (DH)</th>
                                            <th>Réel Plants</th>
                                            <th>Réel Prêt</th>
                                            <th>Écart Plants</th>
                                            <th>Écart Prêt</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {liq.planning.map((p, i) => {
                                            const ecartPlants = p.reelPlants !== null ? p.reelPlants - p.planPlants : null;
                                            const ecartPret = p.reelPret !== null ? p.reelPret - p.planPret : null;
                                            return (
                                                <tr key={i}>
                                                    <td><strong>{p.semaine}</strong></td>
                                                    <td>{Math.round(p.planPlants).toLocaleString('fr-FR')}</td>
                                                    <td>{Math.round(p.planPret).toLocaleString('fr-FR')}</td>
                                                    <td>{p.reelPlants !== null ? Math.round(p.reelPlants).toLocaleString('fr-FR') : <span style={{color:'var(--gray-400)'}}>En attente</span>}</td>
                                                    <td>{p.reelPret !== null ? Math.round(p.reelPret).toLocaleString('fr-FR') : <span style={{color:'var(--gray-400)'}}>En attente</span>}</td>
                                                    <td style={{color: ecartPlants !== null ? (ecartPlants >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--gray-400)'}}>
                                                        {ecartPlants !== null ? `${ecartPlants >= 0 ? '+' : ''}${Math.round(ecartPlants).toLocaleString('fr-FR')}` : '-'}
                                                    </td>
                                                    <td style={{color: ecartPret !== null ? (ecartPret >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--gray-400)'}}>
                                                        {ecartPret !== null ? `${ecartPret >= 0 ? '+' : ''}${Math.round(ecartPret).toLocaleString('fr-FR')}` : '-'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </Panel>

                            {/* Projection de remboursement */}
                            <Panel title="Projection de Remboursement" icon="fa-chart-bar">
                                <SimpleBarChart
                                    data={liq.planning.map(p => ({ semaine: p.semaine, plants: Math.round(p.planPlants/1000), pret: Math.round(p.planPret/1000) }))}
                                    dataKeys={['plants', 'pret']}
                                    colors={['#2D8B4E', '#3498DB']}
                                    xKey="semaine"
                                    height={250}
                                />
                                <div style={{display:'flex', gap:'20px', justifyContent:'center', marginTop:'8px', fontSize:'12px'}}>
                                    <span><span style={{display:'inline-block', width:'12px', height:'12px', borderRadius:'2px', background:'#2D8B4E', marginRight:'4px'}}></span> Plants (K DH)</span>
                                    <span><span style={{display:'inline-block', width:'12px', height:'12px', borderRadius:'2px', background:'#3498DB', marginRight:'4px'}}></span> Prêt (K DH)</span>
                                </div>
                            </Panel>
                        </div>
                    )}

                    {/* ===== LIQUIDATION REPORT POPUP (Driscoll's style) ===== */}
                    {selectedLiquidation && (() => {
                        const l = selectedLiquidation;
                        const semaineNum = l.semaine.replace('S','').split('-')[0];
                        const annee = l.semaine.split('-')[1];
                        const totalDeductions = l.prelevPlants + l.prelevPret + (l.fruitAdvance || 0);
                        const nbColis = Math.round(l.qteKg / 1.5);
                        return (
                            <div className="modal-overlay" onClick={() => setSelectedLiquidation(null)}>
                                <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:'750px', maxHeight:'90vh', overflowY:'auto', padding:0}}>
                                    {/* Header Driscoll's */}
                                    <div style={{background:'linear-gradient(135deg, #1a5e1a 0%, #2d8b4e 100%)', padding:'20px 24px', color:'white'}}>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                            <div>
                                                <div style={{fontSize:10, textTransform:'uppercase', letterSpacing:2, opacity:0.7}}>Driscoll's Du Maroc SARL</div>
                                                <div style={{fontSize:20, fontWeight:700, marginTop:4}}>Rapport de Liquidation</div>
                                                <div style={{fontSize:12, opacity:0.8, marginTop:2}}>Semaine {semaineNum} - {annee}</div>
                                            </div>
                                            <div style={{textAlign:'right'}}>
                                                <div style={{fontSize:28, fontWeight:800, fontFamily:'Georgia, serif'}}>LIQUIDATION</div>
                                                <div style={{fontSize:11, opacity:0.8}}>Driscoll's - Only the Finest Berries</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{padding:'20px 24px'}}>
                                        {/* Info Grid */}
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20}}>
                                            <div style={{padding:12, background:'var(--gray-100)', borderRadius:8}}>
                                                <div style={{fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', marginBottom:6}}>Producteur</div>
                                                <div style={{fontSize:13, fontWeight:600}}>Berry Good Farms SARL</div>
                                                <div style={{fontSize:11, color:'var(--gray-600)'}}>Ranch 200876 / 200742</div>
                                                <div style={{fontSize:11, color:'var(--gray-600)'}}>IF: 2610702 | ICE: 002106859000069</div>
                                            </div>
                                            <div style={{padding:12, background:'var(--gray-100)', borderRadius:8}}>
                                                <div style={{fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', marginBottom:6}}>Période de Liquidation</div>
                                                <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:'3px 12px', fontSize:12}}>
                                                    <span style={{fontWeight:600, color:'var(--gray-400)'}}>Semaine</span><span style={{fontWeight:600}}>{l.semaine}</span>
                                                    <span style={{fontWeight:600, color:'var(--gray-400)'}}>Encaissement</span><span>{l.dateEncaissement}</span>
                                                    <span style={{fontWeight:600, color:'var(--gray-400)'}}>Statut</span><span style={{color:'var(--green)', fontWeight:600}}>{l.status}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Production Summary */}
                                        <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                            <i className="fa-solid fa-boxes-stacked" style={{marginRight:6}}></i>Résumé Production
                                        </div>
                                        <table className="data-table" style={{fontSize:12, marginBottom:16}}>
                                            <thead>
                                                <tr>
                                                    <th>Produit</th>
                                                    <th style={{textAlign:'right'}}>Colis</th>
                                                    <th style={{textAlign:'right'}}>Poids Net (Kg)</th>
                                                    <th style={{textAlign:'right'}}>Prix Moyen (DH/Kg)</th>
                                                    <th style={{textAlign:'right'}}>Montant Brut (DH)</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td><strong>Framboises - Toutes variétés</strong></td>
                                                    <td style={{textAlign:'right'}}>{nbColis.toLocaleString('fr-FR')}</td>
                                                    <td style={{textAlign:'right', fontWeight:600}}>{l.qteKg.toLocaleString('fr-FR')}</td>
                                                    <td style={{textAlign:'right', fontWeight:600}}>{l.prixMoyen.toFixed(2)}</td>
                                                    <td style={{textAlign:'right', fontWeight:700, color:'var(--berry)'}}>{Math.round(l.montantBrut).toLocaleString('fr-FR')}</td>
                                                </tr>
                                            </tbody>
                                        </table>

                                        {/* Déductions */}
                                        <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                            <i className="fa-solid fa-scissors" style={{marginRight:6}}></i>Déductions
                                        </div>
                                        <table className="data-table" style={{fontSize:12, marginBottom:16}}>
                                            <thead>
                                                <tr><th>Type de Déduction</th><th style={{textAlign:'right'}}>Montant (DH)</th></tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td>Prélèvement Plants Framboise</td>
                                                    <td style={{textAlign:'right', color: l.prelevPlants > 0 ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>
                                                        {l.prelevPlants > 0 ? `-${Math.round(l.prelevPlants).toLocaleString('fr-FR')}` : '0'}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td>Prélèvement Crop Advance (Prêt)</td>
                                                    <td style={{textAlign:'right', color: l.prelevPret > 0 ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>
                                                        {l.prelevPret > 0 ? `-${Math.round(l.prelevPret).toLocaleString('fr-FR')}` : '0'}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td>Prélèvement Fruit Advance</td>
                                                    <td style={{textAlign:'right', color: (l.fruitAdvance || 0) > 0 ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>
                                                        {(l.fruitAdvance || 0) > 0 ? `-${Math.round(l.fruitAdvance).toLocaleString('fr-FR')}` : '0'}
                                                    </td>
                                                </tr>
                                                <tr style={{background:'rgba(231,76,60,0.05)'}}>
                                                    <td style={{fontWeight:700}}>Total Déductions</td>
                                                    <td style={{textAlign:'right', fontWeight:700, color:'var(--red)'}}>
                                                        {totalDeductions > 0 ? `-${Math.round(totalDeductions).toLocaleString('fr-FR')}` : '0'}
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>

                                        {/* Net Payable */}
                                        <div style={{padding:16, background:'linear-gradient(135deg, #2D8B4E10 0%, #2D8B4E20 100%)', borderRadius:10, border:'2px solid var(--green)', marginBottom:16}}>
                                            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                                <div>
                                                    <div style={{fontSize:11, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase'}}>Montant Net Payable</div>
                                                    <div style={{fontSize:11, color:'var(--gray-400)'}}>Montant brut - Déductions</div>
                                                </div>
                                                <div style={{fontSize:28, fontWeight:800, color:'var(--green)'}}>{Math.round(l.montantNet).toLocaleString('fr-FR')} DH</div>
                                            </div>
                                        </div>

                                        {/* Récapitulatif */}
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginBottom:16}}>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>Prix Moyen</div>
                                                <div style={{fontSize:16, fontWeight:700, color:'var(--berry)'}}>{l.prixMoyen.toFixed(2)}</div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>DH / Kg</div>
                                            </div>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>Tonnage</div>
                                                <div style={{fontSize:16, fontWeight:700}}>{l.qteKg.toLocaleString('fr-FR')}</div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>Kg</div>
                                            </div>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>% Retenu</div>
                                                <div style={{fontSize:16, fontWeight:700, color: totalDeductions > 0 ? 'var(--red)' : 'var(--green)'}}>
                                                    {l.montantBrut > 0 ? (totalDeductions/l.montantBrut*100).toFixed(1) : '0'}%
                                                </div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>déductions</div>
                                            </div>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>Net / Kg</div>
                                                <div style={{fontSize:16, fontWeight:700, color:'var(--green)'}}>
                                                    {l.qteKg > 0 ? (l.montantNet/l.qteKg).toFixed(2) : '0'}
                                                </div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>DH / Kg</div>
                                            </div>
                                        </div>

                                        {/* Footer */}
                                        <div style={{fontSize:10, color:'var(--gray-400)', borderTop:'1px solid var(--gray-200)', paddingTop:10, marginBottom:12}}>
                                            <div>Document généré automatiquement | Berry Good Farms SARL</div>
                                            <div>R.C. 24587 | T.P. 22211020 | IF 04960175 | CNSS 2258053 | ICE 002106859000069</div>
                                        </div>

                                        <button onClick={() => setSelectedLiquidation(null)} style={{width:'100%', padding:'10px', background:'var(--berry)', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer'}}>
                                            <i className="fa-solid fa-xmark" style={{marginRight:6}}></i> Fermer
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            );
        }

        // ===================== FINANCE: CODES ANALYTIQUES TAB =====================
        function FinCodesAnalytiquesTab({ currentProfile, profileData }) {
            const [codes, setCodes] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [editId, setEditId] = useState(null);
            const emptyForm = { code: '', libelle: '', ferme: 'Toutes', categorie_achat: 'engrais', nature_cpc: '612' };
            const [form, setForm] = useState({ ...emptyForm });
            const FERMES = ['Toutes','F1','F5','Avocatier'];
            const CATS = ['engrais','phyto','emballage','materiel','autre'];
            const CPC_NATURES = [{ v:'612', l:'612 - Achats consommés' },{ v:'613', l:'613 - Autres charges' },{ v:'614', l:'614 - Charges externalisées' },{ v:'621', l:'621 - Rémunérations' },{ v:'2335', l:'2335 - Matériel/Outillage' }];

            const load = () => { setLoading(true); fetch('/api/stock?action=list-codes-analytiques').then(r=>r.json()).then(j=>{ if(j.success) setCodes(j.codes||[]); }).finally(()=>setLoading(false)); };
            useEffect(()=>{ load(); }, []);

            const handleSave = () => {
                if (!form.code||!form.libelle) { alert('Code et libellé requis'); return; }
                fetch('/api/stock?action=save-code-analytique', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...form, id: editId||undefined, saved_by: { uid: currentProfile, name: profileData?.name||currentProfile } }) })
                .then(r=>r.json()).then(j=>{ if(j.success) { setShowForm(false); setEditId(null); setForm({...emptyForm}); load(); } else alert('Erreur: '+j.error); }).catch(()=>alert('Erreur réseau'));
            };
            const handleDelete = (id) => {
                if (!confirm('Désactiver ce code analytique ?')) return;
                fetch('/api/stock?action=delete-code-analytique', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
                .then(r=>r.json()).then(j=>{ if(j.success) load(); }).catch(()=>{});
            };
            const startEdit = (c) => { setForm({ code: c.code, libelle: c.libelle, ferme: c.ferme||'Toutes', categorie_achat: c.categorie_achat||'engrais', nature_cpc: c.nature_cpc||'612' }); setEditId(c.id); setShowForm(true); };

            if (loading) return React.createElement('div', {style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));
            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                        <div style={{fontSize:13,color:'#666'}}><i className="fa-solid fa-tags" style={{marginRight:6,color:'var(--berry)'}}></i>{codes.length} code(s) actif(s)</div>
                        <button onClick={()=>{ setEditId(null); setForm({...emptyForm}); setShowForm(true); }} style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                            <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouveau code
                        </button>
                    </div>
                    <div style={{background:'rgba(52,152,219,0.08)',border:'1px solid rgba(52,152,219,0.2)',borderRadius:8,padding:'8px 14px',marginBottom:12,fontSize:12,color:'#2c3e50'}}>
                        <i className="fa-solid fa-circle-info" style={{marginRight:6,color:'var(--blue)'}}></i>
                        Les codes analytiques sont utilisés dans les BDC pour le traitement du CPC. Ils sont basés sur le plan comptable marocain (PCM).
                    </div>
                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>Code</th><th>Libellé</th><th>Ferme</th><th>Catégorie Achat</th><th>Nature CPC</th><th></th></tr></thead>
                        <tbody>
                            {codes.map(c => (
                                <tr key={c.id}>
                                    <td style={{fontFamily:'monospace',fontWeight:700,color:'var(--berry)'}}>{c.code}</td>
                                    <td>{c.libelle}</td>
                                    <td><span style={{background:'rgba(45,139,78,0.1)',color:'#2D8B4E',padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:600}}>{c.ferme||'Toutes'}</span></td>
                                    <td style={{fontSize:12,color:'#666'}}>{c.categorie_achat}</td>
                                    <td style={{fontFamily:'monospace',fontSize:12}}>{c.nature_cpc}</td>
                                    <td style={{display:'flex',gap:6}}>
                                        <button onClick={()=>startEdit(c)} style={{background:'none',border:'1px solid #ddd',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:11}}>Modifier</button>
                                        <button onClick={()=>handleDelete(c.id)} style={{background:'none',border:'1px solid #fcc',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:11,color:'#e74c3c'}}>Désactiver</button>
                                    </td>
                                </tr>
                            ))}
                            {codes.length===0 && <tr><td colSpan={6} style={{textAlign:'center',padding:30,color:'#aaa'}}>Aucun code analytique configuré</td></tr>}
                        </tbody>
                    </table></div>
                    {showForm && (
                        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
                            <div style={{background:'#fff',borderRadius:12,padding:24,width:'100%',maxWidth:500}}>
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:16}}><h3 style={{margin:0}}>{editId?'Modifier':'Nouveau'} code analytique</h3><button onClick={()=>setShowForm(false)} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'#999'}}>×</button></div>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:12,marginBottom:16}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Code *</label><input value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})} placeholder="Ex: 612-F1-ENG" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,fontFamily:'monospace',boxSizing:'border-box'}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Libellé *</label><input value={form.libelle} onChange={e=>setForm({...form,libelle:e.target.value})} placeholder="Ex: Engrais - Ferme F1" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,boxSizing:'border-box'}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Ferme</label><select value={form.ferme} onChange={e=>setForm({...form,ferme:e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>{FERMES.map(f=><option key={f} value={f}>{f}</option>)}</select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Catégorie Achat</label><select value={form.categorie_achat} onChange={e=>setForm({...form,categorie_achat:e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>{CATS.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
                                    <div style={{gridColumn:'1/-1'}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Nature CPC (Plan Comptable Marocain)</label><select value={form.nature_cpc} onChange={e=>setForm({...form,nature_cpc:e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>{CPC_NATURES.map(n=><option key={n.v} value={n.v}>{n.l}</option>)}</select></div>
                                </div>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                    <button onClick={()=>setShowForm(false)} style={{padding:'8px 20px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleSave} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Enregistrer</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        // ===================== FINANCE: SUPPRESSION ARTICLES TAB =====================
        function FinDeleteArticlesTab({ currentProfile, profileData }) {
            const [requests, setRequests] = useState([]);
            const [loading, setLoading] = useState(true);
            const [processing, setProcessing] = useState(null);

            const load = () => { setLoading(true); fetch('/api/stock?action=list-delete-requests&status=pending').then(r=>r.json()).then(j=>{ if(j.success) setRequests(j.requests||[]); }).catch(()=>{}).finally(()=>setLoading(false)); };
            useEffect(()=>{ load(); }, []);

            const handleValidate = (req, approved) => {
                if (!confirm(approved ? 'Approuver la suppression de "'+req.article_nom+'" ?' : 'Rejeter cette demande de suppression ?')) return;
                setProcessing(req.id);
                fetch('/api/stock?action=validate-delete-article', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ request_id: req.id, approved, validated_by: { uid: currentProfile, name: profileData?.name||currentProfile } }) })
                .then(r=>r.json()).then(j=>{ if(j.success) load(); else alert('Erreur: '+j.error); }).catch(()=>alert('Erreur réseau')).finally(()=>setProcessing(null));
            };

            if (loading) return React.createElement('div', {style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));
            return (
                <div className="fade-in">
                    <div style={{background:'rgba(231,76,60,0.08)',border:'1px solid rgba(231,76,60,0.2)',borderRadius:8,padding:'8px 14px',marginBottom:16,fontSize:12,color:'#922'}}>
                        <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                        Demandes de suppression d'articles du catalogue. La validation supprime définitivement l'article.
                    </div>
                    {requests.length === 0 ? (
                        <div style={{textAlign:'center',padding:60,color:'#aaa'}}>
                            <i className="fa-solid fa-circle-check" style={{fontSize:48,marginBottom:16,display:'block',color:'#ddd'}}></i>
                            Aucune demande de suppression en attente
                        </div>
                    ) : requests.map(r => (
                        <div key={r.id} style={{background:'#fff',border:'1px solid #e9ecef',borderRadius:10,padding:16,marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                            <div>
                                <div style={{fontWeight:700,fontSize:14}}>{r.article_nom}</div>
                                <div style={{fontSize:12,color:'#666',marginTop:4}}>
                                    <span style={{fontFamily:'monospace',color:'var(--berry)'}}>{r.article_id}</span>
                                    <span style={{margin:'0 8px'}}>—</span>
                                    Demandé par <strong>{r.requested_by?.name||'?'}</strong> le {new Date(r.requested_at).toLocaleDateString('fr-FR')}
                                </div>
                            </div>
                            <div style={{display:'flex',gap:8}}>
                                <button onClick={()=>handleValidate(r,false)} disabled={processing===r.id} style={{padding:'8px 14px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:12,color:'#666'}}>
                                    <i className="fa-solid fa-xmark" style={{marginRight:4}}></i>Rejeter
                                </button>
                                <button onClick={()=>handleValidate(r,true)} disabled={processing===r.id} style={{padding:'8px 14px',borderRadius:8,border:'none',background:'#e74c3c',color:'#fff',cursor:'pointer',fontSize:12,fontWeight:600}}>
                                    <i className="fa-solid fa-trash" style={{marginRight:4}}></i>Approuver suppression
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

        // ===================== FINANCE: VIREMENTS TAB =====================
        function FinVirementsTab({ currentProfile, profileData }) {
            const [virements, setVirements] = useState([]);
            const [loading, setLoading] = useState(true);
            const statusColors = { en_attente: '#f39c12', approuve: '#2980b9', execute: '#27ae60', rejete: '#e74c3c' };
            const statusLabels = { en_attente: 'En attente', approuve: 'Approuvé', execute: 'Exécuté', rejete: 'Rejeté' };

            const load = () => { setLoading(true); fetch('/api/stock?action=list-demandes-virement').then(r=>r.json()).then(j=>{ if(j.success) setVirements(j.virements||[]); }).catch(()=>{}).finally(()=>setLoading(false)); };
            useEffect(()=>{ load(); }, []);

            const handleValidate = (id, decision) => {
                const rib = decision==='approuve' ? prompt('Saisir le RIB du fournisseur :') : null;
                if (decision==='approuve' && !rib) return;
                fetch('/api/stock?action=validate-virement', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, decision, rib: rib||'', validated_by: { uid: currentProfile, name: profileData?.name||currentProfile } }) })
                .then(r=>r.json()).then(j=>{ if(j.success) load(); else alert('Erreur: '+j.error); }).catch(()=>alert('Erreur réseau'));
            };

            if (loading) return React.createElement('div', {style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));
            return (
                <div className="fade-in">
                    <div style={{marginBottom:12,fontSize:13,color:'#666'}}><i className="fa-solid fa-money-bill-transfer" style={{marginRight:6,color:'var(--berry)'}}></i>{virements.length} demande(s) de virement</div>
                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>N°</th><th>Fournisseur</th><th>Montant TTC</th><th>Motif</th><th>RIB</th><th>Statut</th><th>Actions</th></tr></thead>
                        <tbody>
                            {virements.map(v => (
                                <tr key={v.id}>
                                    <td style={{fontFamily:'monospace',fontWeight:700,fontSize:12}}>{v.numero}</td>
                                    <td style={{fontWeight:600}}>{v.fournisseur?.nom||'—'}</td>
                                    <td style={{fontFamily:'monospace',fontWeight:700,color:'var(--berry)'}}>{(v.montant_ttc||0).toFixed(2)} MAD</td>
                                    <td style={{fontSize:12,color:'#666',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v.motif||'—'}</td>
                                    <td style={{fontFamily:'monospace',fontSize:11}}>{v.fournisseur?.rib||<span style={{color:'#aaa'}}>À saisir</span>}</td>
                                    <td><span style={{background: statusColors[v.status]+'22',color: statusColors[v.status],padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:600}}>{statusLabels[v.status]||v.status}</span></td>
                                    <td>
                                        {v.status==='en_attente' && (
                                            <div style={{display:'flex',gap:6}}>
                                                <button onClick={()=>handleValidate(v.id,'approuve')} style={{background:'#2980b9',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11,fontWeight:600}}>Approuver</button>
                                                <button onClick={()=>handleValidate(v.id,'rejete')} style={{background:'none',border:'1px solid #e74c3c',color:'#e74c3c',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11}}>Rejeter</button>
                                            </div>
                                        )}
                                        {v.status==='approuve' && <button onClick={()=>handleValidate(v.id,'execute')} style={{background:'#27ae60',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:11,fontWeight:600}}>Marquer exécuté</button>}
                                    </td>
                                </tr>
                            ))}
                            {virements.length===0 && <tr><td colSpan={7} style={{textAlign:'center',padding:30,color:'#aaa'}}>Aucune demande de virement en cours</td></tr>}
                        </tbody>
                    </table></div>
                </div>
            );
        }

        // ===================== ACHATS: ANALYSES FOLIAIRES TAB =====================
        function AchatsAnalysesFoliairesTab({ currentProfile, profileData }) {
            const [data, setData] = React.useState({ analyses: [], parcelles_overdue: [], counts: { demandees: 0, commandees: 0, prelevees: 0, en_retard: 0 } });
            const [loading, setLoading] = React.useState(true);
            const [filterFerme, setFilterFerme] = React.useState('');
            const [actionLoading, setActionLoading] = React.useState(null);
            const [scanModal, setScanModal] = React.useState(null); // { analyseId, parcelle, ferme, culture, photo_url, note_demande }
            const [scanFile, setScanFile] = React.useState(null);
            const [scanPreview, setScanPreview] = React.useState(null);
            const [generating, setGenerating] = React.useState(false);
            const [successMsg, setSuccessMsg] = React.useState('');

            const STATUT_CONFIG_ACHATS = {
                demandee:  { color: '#2563eb', bg: '#eff6ff', label: 'Demandée',  icon: 'fa-paper-plane' },
                commandee: { color: '#d97706', bg: '#fffbeb', label: 'Commandée', icon: 'fa-shopping-cart' },
                prelevee:  { color: '#7c3aed', bg: '#f5f3ff', label: 'Prélevée',  icon: 'fa-vial' },
                completee: { color: '#16a34a', bg: '#f0fdf4', label: 'Complète',  icon: 'fa-circle-check' },
            };

            const loadData = () => {
                setLoading(true);
                const qs = filterFerme ? '&ferme=' + filterFerme : '';
                fetch('/api/stock?action=list-analyses-foliaires' + qs)
                    .then(r => r.json())
                    .then(json => { if (json.success) setData(json); })
                    .catch(err => console.warn('AF error:', err))
                    .finally(() => setLoading(false));
            };
            React.useEffect(() => { loadData(); }, [filterFerme]);

            const handleUpdate = (id, statut, comment) => {
                setActionLoading(id + '_' + statut);
                const profileInfo = { profileId: currentProfile, name: profileData?.name || currentProfile };
                fetch('/api/stock?action=update-analyse-foliaire', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, statut, comment, updated_by: profileInfo }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { loadData(); window._refreshNotifications?.(); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau'))
                .finally(() => setActionLoading(null));
            };

            const handleScanSelect = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                setScanFile(file);
                const reader = new FileReader();
                reader.onload = ev => setScanPreview(ev.target.result);
                reader.readAsDataURL(file);
            };

            const handleUploadScan = () => {
                if (!scanFile || !scanModal) return;
                setGenerating(true);
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    const base64 = ev.target.result.split(',')[1];
                    const profileInfo = { profileId: currentProfile, name: profileData?.name || currentProfile };
                    try {
                        // Step 1: upload scan + mark completee
                        const upRes = await fetch('/api/stock?action=upload-scan-analyse', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: scanModal.analyseId, scan_base64: base64, filename: scanFile.name, uploaded_by: profileInfo }),
                        }).then(r => r.json());
                        if (!upRes.success) throw new Error(upRes.error || 'Upload échoué');

                        // Step 2: generate IA recommendations
                        const recoRes = await fetch('/api/stock?action=generate-reco-foliaire', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id: scanModal.analyseId,
                                parcelle: scanModal.parcelle,
                                ferme: scanModal.ferme,
                                culture: scanModal.culture,
                                photo_url: scanModal.photo_url || null,
                                scan_url: upRes.scan_url,
                                note_demande: scanModal.note_demande || '',
                            }),
                        }).then(r => r.json());
                        if (!recoRes.success) throw new Error(recoRes.error || 'IA échouée');

                        setSuccessMsg('Résultat uploadé et recommandations IA envoyées au Chef de Ferme !');
                        setScanModal(null); setScanFile(null); setScanPreview(null);
                        loadData();
                        setTimeout(() => setSuccessMsg(''), 5000);
                    } catch (err) {
                        alert('Erreur: ' + err.message);
                    } finally {
                        setGenerating(false);
                    }
                };
                reader.readAsDataURL(scanFile);
            };

            const fermes = ['F1', 'F5', 'Avocatier'];

            const analyses = data.analyses || [];
            const demandees  = analyses.filter(a => a.statut === 'demandee');
            const en_cours   = analyses.filter(a => a.statut === 'commandee' || a.statut === 'prelevee');
            const en_retard  = analyses.filter(a => a.is_result_late && a.statut === 'prelevee');

            const daysSince = (ts) => {
                if (!ts) return null;
                const ms = typeof ts === 'object' && ts._seconds ? ts._seconds * 1000 : (typeof ts === 'number' ? ts : new Date(ts).getTime());
                return Math.floor((Date.now() - ms) / 86400000);
            };

            const fmtDate = (ts) => {
                if (!ts) return '—';
                const ms = typeof ts === 'object' && ts._seconds ? ts._seconds * 1000 : (typeof ts === 'number' ? ts : new Date(ts).getTime());
                return new Date(ms).toLocaleDateString('fr-FR');
            };

            if (loading) return React.createElement('div', { style: { textAlign: 'center', padding: 60 } },
                React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 32, color: 'var(--berry)' } }));

            return (
                <div className="fade-in">
                    {/* Success banner */}
                    {successMsg && (
                        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <i className="fa-solid fa-circle-check" /> {successMsg}
                        </div>
                    )}

                    {/* Stats bar */}
                    <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                        {[
                            { label: 'Demandées', val: data.counts?.demandees || 0, color: '#2563eb', bg: '#eff6ff' },
                            { label: 'Commandées', val: data.counts?.commandees || 0, color: '#d97706', bg: '#fffbeb' },
                            { label: 'Prélevées', val: data.counts?.prelevees || 0, color: '#7c3aed', bg: '#f5f3ff' },
                            { label: 'En retard', val: data.counts?.en_retard || 0, color: '#dc2626', bg: '#fef2f2' },
                        ].map(s => (
                            <div key={s.label} style={{ background: s.bg, border: '1px solid ' + s.color + '33', borderRadius: 10, padding: '10px 18px', textAlign: 'center', minWidth: 110 }}>
                                <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.val}</div>
                                <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{s.label}</div>
                            </div>
                        ))}
                        {/* Ferme filter */}
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                            {['', ...fermes].map(f => (
                                <button key={f} onClick={() => setFilterFerme(f)} className={`chip c-berry ${filterFerme === f ? 'active' : ''}`}>
                                    {f || 'Toutes fermes'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Section 1: Demandes reçues */}
                    <div style={{ marginBottom: 28 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <i className="fa-solid fa-paper-plane" style={{ color: '#2563eb' }} />
                            Demandes reçues
                            <span style={{ background: '#eff6ff', color: '#2563eb', borderRadius: 12, padding: '1px 8px', fontSize: 12 }}>{demandees.length}</span>
                        </h3>
                        {demandees.length === 0 ? (
                            <div style={{ color: '#aaa', fontSize: 13, padding: '12px 0' }}>Aucune demande en attente</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {demandees.map(a => (
                                    <div key={a.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>
                                                    <span style={{ background: '#eff6ff', color: '#2563eb', borderRadius: 6, padding: '2px 7px', fontSize: 11, marginRight: 6 }}>{a.numero}</span>
                                                    {a.parcelle}
                                                    <span style={{ color: '#64748b', fontSize: 12, marginLeft: 6 }}>— {a.ferme}</span>
                                                </div>
                                                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                                                    Demandé le {fmtDate(a.date_demande)} par <b>{a.created_by?.name || '—'}</b>
                                                    {a.culture && <span> · {a.culture}</span>}
                                                </div>
                                                {a.note_demande && <div style={{ fontSize: 12, color: '#475569', marginTop: 4, fontStyle: 'italic' }}>"{a.note_demande}"</div>}
                                            </div>
                                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                                {a.photo_parcelle_url && (
                                                    <a href={a.photo_parcelle_url} target="_blank" rel="noopener noreferrer">
                                                        <img src={a.photo_parcelle_url} alt="photo parcelle" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0' }} />
                                                    </a>
                                                )}
                                                <button
                                                    onClick={() => handleUpdate(a.id, 'commandee', 'BDC créé')}
                                                    disabled={actionLoading === a.id + '_commandee'}
                                                    style={{ background: '#d97706', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                                                >
                                                    {actionLoading === a.id + '_commandee' ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-shopping-cart" />}
                                                    Marquer commandée
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Section 2: En cours */}
                    <div style={{ marginBottom: 28 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <i className="fa-solid fa-vial" style={{ color: '#7c3aed' }} />
                            En cours
                            <span style={{ background: '#f5f3ff', color: '#7c3aed', borderRadius: 12, padding: '1px 8px', fontSize: 12 }}>{en_cours.length}</span>
                        </h3>
                        {en_cours.length === 0 ? (
                            <div style={{ color: '#aaa', fontSize: 13, padding: '12px 0' }}>Aucune analyse en cours</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {en_cours.map(a => {
                                    const cfg = STATUT_CONFIG_ACHATS[a.statut];
                                    const jours = a.statut === 'prelevee' ? daysSince(a.date_prelevement) : null;
                                    const isLate = a.is_result_late;
                                    return (
                                        <div key={a.id} style={{ background: isLate ? '#fef2f2' : '#fff', border: '1px solid ' + (isLate ? '#fca5a5' : '#e2e8f0'), borderRadius: 10, padding: 14 }}>
                                            {isLate && (
                                                <div style={{ background: '#dc2626', color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                    <i className="fa-solid fa-triangle-exclamation" />
                                                    RÉSULTAT EN RETARD — {jours} jour{jours > 1 ? 's' : ''}
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>
                                                        <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 6, padding: '2px 7px', fontSize: 11, marginRight: 6 }}>{a.numero}</span>
                                                        {a.parcelle}
                                                        <span style={{ color: '#64748b', fontSize: 12, marginLeft: 6 }}>— {a.ferme}</span>
                                                    </div>
                                                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                                                        <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>
                                                            <i className={'fa-solid ' + cfg.icon} style={{ marginRight: 4 }} />{cfg.label}
                                                        </span>
                                                        {a.statut === 'prelevee' && a.date_prelevement && (
                                                            <span style={{ marginLeft: 8 }}>Prélevé le {fmtDate(a.date_prelevement)}{jours !== null && <span style={{ color: isLate ? '#dc2626' : '#64748b' }}> · il y a {jours}j</span>}</span>
                                                        )}
                                                    </div>
                                                    {a.note_demande && <div style={{ fontSize: 12, color: '#475569', marginTop: 4, fontStyle: 'italic' }}>"{a.note_demande}"</div>}
                                                </div>
                                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                                    {a.photo_parcelle_url && (
                                                        <a href={a.photo_parcelle_url} target="_blank" rel="noopener noreferrer">
                                                            <img src={a.photo_parcelle_url} alt="photo parcelle" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0' }} />
                                                        </a>
                                                    )}
                                                    {a.statut === 'commandee' && (
                                                        <button
                                                            onClick={() => handleUpdate(a.id, 'prelevee', 'Prélèvement effectué')}
                                                            disabled={actionLoading === a.id + '_prelevee'}
                                                            style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                                                        >
                                                            {actionLoading === a.id + '_prelevee' ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-vial" />}
                                                            Prélèvement effectué
                                                        </button>
                                                    )}
                                                    {a.statut === 'prelevee' && (
                                                        <button
                                                            onClick={() => setScanModal({ analyseId: a.id, parcelle: a.parcelle, ferme: a.ferme, culture: a.culture, photo_url: a.photo_parcelle_url, note_demande: a.note_demande })}
                                                            style={{ background: isLate ? '#dc2626' : '#16a34a', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                                                        >
                                                            <i className="fa-solid fa-upload" />
                                                            Upload résultat + IA
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Section 3: Completées récentes */}
                    {analyses.filter(a => a.statut === 'completee').length > 0 && (
                        <div style={{ marginBottom: 28 }}>
                            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <i className="fa-solid fa-circle-check" style={{ color: '#16a34a' }} />
                                Complètes récentes
                                <span style={{ background: '#f0fdf4', color: '#16a34a', borderRadius: 12, padding: '1px 8px', fontSize: 12 }}>{analyses.filter(a => a.statut === 'completee').length}</span>
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {analyses.filter(a => a.statut === 'completee').map(a => (
                                    <div key={a.id} style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                        <div>
                                            <span style={{ background: '#dcfce7', color: '#16a34a', borderRadius: 6, padding: '2px 7px', fontSize: 11, marginRight: 6 }}>{a.numero}</span>
                                            <b style={{ fontSize: 13 }}>{a.parcelle}</b>
                                            <span style={{ color: '#64748b', fontSize: 12, marginLeft: 6 }}>— {a.ferme}</span>
                                            <span style={{ fontSize: 12, color: '#64748b', marginLeft: 12 }}>Résultat le {fmtDate(a.date_resultat)}</span>
                                        </div>
                                        {a.scan_resultat_url && (
                                            <a href={a.scan_resultat_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <i className="fa-solid fa-file-pdf" /> Voir scan
                                            </a>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Scan Upload Modal */}
                    {scanModal && (
                        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                            <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1e293b' }}>
                                        <i className="fa-solid fa-upload" style={{ color: '#16a34a', marginRight: 8 }} />
                                        Upload résultat d'analyse
                                    </h3>
                                    <button onClick={() => { setScanModal(null); setScanFile(null); setScanPreview(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#94a3b8' }}>✕</button>
                                </div>
                                <div style={{ background: '#f8fafc', borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 13, color: '#475569' }}>
                                    <b>{scanModal.parcelle}</b> — {scanModal.ferme}{scanModal.culture && <span> · {scanModal.culture}</span>}
                                </div>

                                {generating ? (
                                    <div style={{ textAlign: 'center', padding: '30px 0' }}>
                                        <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 32, color: 'var(--berry)', marginBottom: 12 }} />
                                        <div style={{ color: '#64748b', fontSize: 14 }}>Analyse IA en cours…</div>
                                        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>Claude analyse le rapport et génère des recommandations</div>
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ marginBottom: 14 }}>
                                            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Scan du rapport d'analyse *</label>
                                            <input type="file" accept="image/*,.pdf" onChange={handleScanSelect} style={{ fontSize: 13, width: '100%' }} />
                                            {scanPreview && scanFile?.type?.startsWith('image/') && (
                                                <img src={scanPreview} alt="preview" style={{ marginTop: 8, maxWidth: '100%', maxHeight: 200, borderRadius: 6, objectFit: 'contain', border: '1px solid #e2e8f0' }} />
                                            )}
                                            {scanFile && !scanFile?.type?.startsWith('image/') && (
                                                <div style={{ marginTop: 8, fontSize: 12, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <i className="fa-solid fa-file-pdf" /> {scanFile.name}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#92400e', marginBottom: 16 }}>
                                            <i className="fa-solid fa-robot" style={{ marginRight: 6 }} />
                                            Après l'upload, Claude analysera le rapport et générera des recommandations agronomiques pour le Chef de Ferme.
                                            {scanModal.photo_url && <span> La photo de la parcelle sera également analysée.</span>}
                                        </div>
                                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                                            <button onClick={() => { setScanModal(null); setScanFile(null); setScanPreview(null); }} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer', fontSize: 13 }}>Annuler</button>
                                            <button
                                                onClick={handleUploadScan}
                                                disabled={!scanFile}
                                                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: scanFile ? '#16a34a' : '#d1fae5', color: '#fff', cursor: scanFile ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
                                            >
                                                <i className="fa-solid fa-rocket" />
                                                Uploader + Lancer IA
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            );
        }


export {
  useGeolocation,
  SecurityRegistreTab,
  SecurityScanRegistreTab,
  SecurityTunnelsTab,
  SecurityEnvoisWATab,
  SecurityIncidentsTab,
  FinDashboardTab,
  FinCATab,
  FuelWeeklyChart,
  FuelKmChart,
  FinOjraTab,
  FinStockTab,
  buildLiquidationsView,
  getSatFriWeek,
  tresoParseDMY,
  tresoFmtMAD,
  tresoFmtDate,
  FinTresorerieTab,
  FinLiquidationsTab,
  FinCodesAnalytiquesTab,
  FinDeleteArticlesTab,
  FinVirementsTab,
  AchatsAnalysesFoliairesTab
};
