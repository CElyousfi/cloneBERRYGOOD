/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): FinOjraTab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { SimpleBarChart } from '../shared/SimpleBarChart.jsx';

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

export { FinOjraTab };
