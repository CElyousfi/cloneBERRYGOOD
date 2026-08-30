/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: securite | Déclaration(s): SecurityTunnelsTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { useGeolocation } from '../technique/useGeolocation.jsx';

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

export { SecurityTunnelsTab };
