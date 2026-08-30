/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: securite | Déclaration(s): SecurityScanRegistreTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { useGeolocation } from '../technique/useGeolocation.jsx';

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

export { SecurityScanRegistreTab };
