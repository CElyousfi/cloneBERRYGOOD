/* Module: achats | Déclaration(s): AchatsAnalysesFoliairesTab */


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

export { AchatsAnalysesFoliairesTab };
