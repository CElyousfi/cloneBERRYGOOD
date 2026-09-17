/* Module: technique | Déclaration(s): StationnaireImportScanTab */
import { PARCELLES_CULTURALES } from '../agronomie/PARCELLES_CULTURALES.jsx';
import { getCycle } from '../agronomie/getCycle.jsx';
import { useEffect, useRef, useState } from '../shared/reactHooks.jsx';

function StationnaireImportScanTab({ farmFilter, currentProfile }) {
            const [scanQueue, setScanQueue] = useState([]);
            const [scanResults, setScanResults] = useState([]);
            const [importing, setImporting] = useState(false);
            const [importMsg, setImportMsg] = useState('');
            const fileInputRef = useRef(null);

            const handleFiles = (files) => {
                const items = Array.from(files).filter(f => f.type.startsWith('image/')).map(f => ({
                    file: f,
                    preview: URL.createObjectURL(f),
                    status: 'pending',
                    error: null,
                    analysis: null,
                    scan_url: null,
                }));
                setScanQueue(prev => [...prev, ...items]);
            };

            // Auto-process pending scans
            useEffect(() => {
                const pending = scanQueue.find(s => s.status === 'pending');
                if (!pending) return;

                const processOne = async () => {
                    setScanQueue(prev => prev.map(s => s === pending ? { ...s, status: 'processing' } : s));
                    try {
                        // Compress image via canvas before sending (max 1600px, quality 0.7)
                        const base64 = await new Promise((resolve, reject) => {
                            const img = new Image();
                            img.onload = () => {
                                const maxDim = 1600;
                                let w = img.width, h = img.height;
                                if (w > maxDim || h > maxDim) {
                                    if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
                                    else { w = Math.round(w * maxDim / h); h = maxDim; }
                                }
                                const canvas = document.createElement('canvas');
                                canvas.width = w; canvas.height = h;
                                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                                resolve(canvas.toDataURL('image/jpeg', 0.7));
                            };
                            img.onerror = reject;
                            img.src = URL.createObjectURL(pending.file);
                        });
                        const resp = await fetch('/api/stock?action=scan-irrigation-sheet', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ scan_base64: base64, filename: pending.file.name }),
                        });
                        const json = await resp.json();
                        if (json.success && json.analysis) {
                            setScanQueue(prev => prev.map(s => s === pending ? { ...s, status: 'done', analysis: json.analysis, scan_url: json.scan_url } : s));
                            // Add lectures to results
                            const lectures = (json.analysis.lectures || []).map((lec, i) => ({
                                ...lec,
                                _key: Date.now() + '_' + i,
                                _selected: true,
                                _ferme: json.analysis.ferme || farmFilter,
                                _parcelle: json.analysis.parcelle || '',
                                _scanUrl: json.scan_url,
                                points: (lec.points || []).map((p, j) => ({ label: 'Point ' + (j + 1), ec: p.ec || 0, ph: p.ph || 0, volume: p.volume || 0 })),
                                drainage: (lec.drainage || []).map((d, j) => ({ label: 'Drainage ' + (j + 1), ec: d.ec || 0, ph: d.ph || 0, volume: d.volume || 0 })),
                            }));
                            setScanResults(prev => [...prev, ...lectures]);
                        } else {
                            setScanQueue(prev => prev.map(s => s === pending ? { ...s, status: 'error', error: json.error || 'Erreur analyse' } : s));
                        }
                    } catch (e) {
                        setScanQueue(prev => prev.map(s => s === pending ? { ...s, status: 'error', error: e.message } : s));
                    }
                };
                processOne();
            }, [scanQueue]);

            const toggleSelect = (key) => {
                setScanResults(prev => prev.map(r => r._key === key ? { ...r, _selected: !r._selected } : r));
            };

            const handleImport = async () => {
                const toImport = scanResults.filter(r => r._selected);
                if (toImport.length === 0) return alert('Aucune lecture sélectionnée');
                setImporting(true);
                let count = 0;
                try {
                    for (const lec of toImport) {
                        const parcelleId = matchParcelle(lec._parcelle, lec._ferme);
                        await firebase.firestore().collection('irrigation_readings').add({
                            date: lec.date || new Date().toISOString().slice(0, 10),
                            ferme: lec._ferme || farmFilter,
                            parcelle: parcelleId || lec._parcelle,
                            parcelleLabel: lec._parcelle,
                            heure: lec.heure || '',
                            duree: lec.duree || 0,
                            points: lec.points || [],
                            drainage: lec.drainage || [],
                            source: 'scan_ocr',
                            scanPhoto: lec._scanUrl || '',
                            createdBy: currentProfile,
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                        });
                        count++;
                    }
                    setImportMsg(count + ' lectures importées avec succès !');
                    setScanResults(prev => prev.filter(r => !r._selected));
                    setTimeout(() => setImportMsg(''), 4000);
                } catch (e) { alert('Erreur import: ' + e.message); }
                setImporting(false);
            };

            // Try to match parcelle text to PARCELLES_CULTURALES id
            const matchParcelle = (text, ferme) => {
                if (!text) return '';
                const lower = text.toLowerCase();
                const currentCycle = getCycle(new Date().toISOString());
                const match = PARCELLES_CULTURALES.find(pc =>
                    pc.ferme === (ferme || farmFilter) && pc.cycle === currentCycle &&
                    pc.enProduction !== false &&
                    (pc.designations || []).some(d => d.toLowerCase() === lower || lower.includes(d.toLowerCase()) || d.toLowerCase().includes(lower))
                );
                return match ? match.id : '';
            };

            const updateResult = (key, field, value) => {
                setScanResults(prev => prev.map(r => r._key === key ? { ...r, [field]: value } : r));
            };

            return React.createElement('div', { style: { padding: 16, maxWidth: 700, margin: '0 auto' } },
                React.createElement('h2', { style: { fontSize: '1.2rem', marginBottom: 16, color: 'var(--berry)' } },
                    React.createElement('i', { className: 'fa-solid fa-camera', style: { marginRight: 8 } }),
                    'Scanner Fiches Irrigation'
                ),

                // Upload zone
                React.createElement('div', {
                    onDragOver: e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--berry)'; },
                    onDragLeave: e => { e.currentTarget.style.borderColor = '#ccc'; },
                    onDrop: e => { e.preventDefault(); e.currentTarget.style.borderColor = '#ccc'; handleFiles(e.dataTransfer.files); },
                    onClick: () => fileInputRef.current?.click(),
                    style: { border: '2px dashed #ccc', borderRadius: 12, padding: 32, textAlign: 'center', cursor: 'pointer', background: '#fafafa', marginBottom: 16 }
                },
                    React.createElement('i', { className: 'fa-solid fa-cloud-arrow-up', style: { fontSize: 32, color: 'var(--berry)', marginBottom: 8 } }),
                    React.createElement('p', { style: { margin: 0, color: '#666' } }, 'Glisser une photo ou cliquer pour sélectionner'),
                    React.createElement('p', { style: { margin: '4px 0 0', fontSize: '0.8rem', color: '#999' } }, 'JPG, PNG — plusieurs fiches possibles'),
                    React.createElement('input', { ref: fileInputRef, type: 'file', accept: 'image/*', multiple: true, capture: 'environment', style: { display: 'none' }, onChange: e => { handleFiles(e.target.files); e.target.value = ''; } })
                ),

                // Scan queue
                scanQueue.length > 0 && React.createElement('div', { style: { marginBottom: 16 } },
                    React.createElement('h3', { style: { fontSize: '0.95rem', marginBottom: 8 } }, 'Fiches scannées'),
                    scanQueue.map((s, i) => React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 10, padding: 8, background: '#fff', borderRadius: 8, marginBottom: 6, border: '1px solid #eee' } },
                        React.createElement('img', { src: s.preview, style: { width: 48, height: 48, objectFit: 'cover', borderRadius: 6 } }),
                        React.createElement('div', { style: { flex: 1 } },
                            React.createElement('div', { style: { fontSize: '0.85rem', fontWeight: 600 } }, s.file.name),
                            React.createElement('div', { style: { fontSize: '0.75rem', color: s.status === 'error' ? 'var(--red)' : s.status === 'done' ? 'var(--green)' : 'var(--blue)' } },
                                s.status === 'pending' ? 'En attente...' :
                                s.status === 'processing' ? 'Analyse en cours...' :
                                s.status === 'done' ? ('Terminé — ' + (s.analysis?.lectures?.length || 0) + ' lectures trouvées') :
                                ('Erreur: ' + s.error)
                            )
                        ),
                        s.status === 'processing' && React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { color: 'var(--blue)' } })
                    ))
                ),

                // Results table
                scanResults.length > 0 && React.createElement('div', null,
                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 } },
                        React.createElement('h3', { style: { fontSize: '0.95rem', margin: 0 } }, 'Lectures extraites (', scanResults.length, ')'),
                        React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                            importMsg && React.createElement('span', { className: 'irrigation-saved-badge' }, importMsg),
                            React.createElement('button', {
                                className: 'btn-primary',
                                onClick: handleImport,
                                disabled: importing,
                                style: { padding: '8px 20px', fontSize: '0.85rem', borderRadius: 8 }
                            }, importing ? 'Import...' : 'Importer sélection')
                        )
                    ),
                    React.createElement('div', { className: 'table-wrapper' },
                        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' } },
                            React.createElement('thead', null,
                                React.createElement('tr', { style: { background: 'var(--berry-pale)', borderBottom: '2px solid var(--berry)' } },
                                    React.createElement('th', { style: { padding: '6px 4px', width: 30 } }, ''),
                                    React.createElement('th', { style: { padding: '6px 4px', textAlign: 'left' } }, 'Date'),
                                    React.createElement('th', { style: { padding: '6px 4px', textAlign: 'left' } }, 'Heure'),
                                    React.createElement('th', { style: { padding: '6px 4px', textAlign: 'left' } }, 'Parcelle'),
                                    React.createElement('th', { style: { padding: '6px 4px', textAlign: 'center' } }, 'Pts EC'),
                                    React.createElement('th', { style: { padding: '6px 4px', textAlign: 'center' } }, 'Pts pH'),
                                    React.createElement('th', { style: { padding: '6px 4px', textAlign: 'center' } }, 'Dr EC'),
                                    React.createElement('th', { style: { padding: '6px 4px', textAlign: 'center' } }, 'Dr pH')
                                )
                            ),
                            React.createElement('tbody', null,
                                scanResults.map(r => {
                                    const avgPtsEc = r.points?.length ? (r.points.reduce((s, p) => s + (p.ec || 0), 0) / r.points.length).toFixed(1) : '-';
                                    const avgPtsPh = r.points?.length ? (r.points.reduce((s, p) => s + (p.ph || 0), 0) / r.points.length).toFixed(1) : '-';
                                    const avgDrEc = r.drainage?.length ? (r.drainage.reduce((s, d) => s + (d.ec || 0), 0) / r.drainage.length).toFixed(1) : '-';
                                    const avgDrPh = r.drainage?.length ? (r.drainage.reduce((s, d) => s + (d.ph || 0), 0) / r.drainage.length).toFixed(1) : '-';
                                    return React.createElement('tr', { key: r._key, style: { borderBottom: '1px solid #eee', opacity: r._selected ? 1 : 0.5 } },
                                        React.createElement('td', { style: { padding: '6px 4px', textAlign: 'center' } },
                                            React.createElement('input', { type: 'checkbox', checked: r._selected, onChange: () => toggleSelect(r._key) })
                                        ),
                                        React.createElement('td', { style: { padding: '6px 4px' } },
                                            React.createElement('input', { type: 'date', value: r.date || '', onChange: e => updateResult(r._key, 'date', e.target.value), style: { width: 120, padding: 2, border: '1px solid #ddd', borderRadius: 4, fontSize: 13 } })
                                        ),
                                        React.createElement('td', { style: { padding: '6px 4px' } },
                                            React.createElement('input', { type: 'time', value: r.heure || '', onChange: e => updateResult(r._key, 'heure', e.target.value), style: { width: 80, padding: 2, border: '1px solid #ddd', borderRadius: 4, fontSize: 13 } })
                                        ),
                                        React.createElement('td', { style: { padding: '6px 4px', fontSize: '0.75rem' } }, r._parcelle),
                                        React.createElement('td', { style: { padding: '6px 4px', textAlign: 'center' } }, avgPtsEc),
                                        React.createElement('td', { style: { padding: '6px 4px', textAlign: 'center' } }, avgPtsPh),
                                        React.createElement('td', { style: { padding: '6px 4px', textAlign: 'center', color: 'var(--blue)' } }, avgDrEc),
                                        React.createElement('td', { style: { padding: '6px 4px', textAlign: 'center', color: 'var(--blue)' } }, avgDrPh)
                                    );
                                })
                            )
                        )
                    )
                ),

                // Empty state
                scanQueue.length === 0 && scanResults.length === 0 && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: '#999' } },
                    React.createElement('i', { className: 'fa-solid fa-file-image', style: { fontSize: 48, marginBottom: 12, opacity: 0.3 } }),
                    React.createElement('p', null, 'Prenez en photo vos fiches d\'irrigation pour importer les données automatiquement')
                )
            );
        }

export { StationnaireImportScanTab };
