/* Module: caisse | Déclaration(s): CaisseImportEncaissementsSub */
import { getActiveMarcheLocalClients } from '../shared/getActiveMarcheLocalClients.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { ENC_FALLBACK_CLIENTS } from './ENC_FALLBACK_CLIENTS.jsx';
import { ENC_REJET_LABELS } from './ENC_REJET_LABELS.jsx';
import { encBrut } from './encBrut.jsx';

import * as EncaissementsCanevas from '../shared/lib/encaissementsCanevas.js';
function CaisseImportEncaissementsSub({ isControle, onApplied }) {
            const EC = (typeof window !== 'undefined' && EncaissementsCanevas) || null;
            const [active, setActive] = useState([]); // [{client_id, nom}]
            const [archivedNames, setArchivedNames] = useState(new Set());
            const [clientsLoaded, setClientsLoaded] = useState(false);
            const [report, setReport] = useState(null);
            const [fileName, setFileName] = useState('');
            const [error, setError] = useState('');
            const [applying, setApplying] = useState(false);
            const [applyResult, setApplyResult] = useState(null);
            const fileRef = React.useRef(null);

            // Applique les encaissements VALIDÉS (report.ok) via l'action backend
            // dédiée apply-encaissements (DG/Finance uniquement). NO write côté client.
            const handleApply = async () => {
                if (!report || !report.ok || !report.ok.length) return;
                setError('');
                setApplyResult(null);
                setApplying(true);
                try {
                    const lignes = report.ok.map(e => ({
                        client_id: e.client_id,
                        montant: e.montant,
                        date: e.date,
                        mode: e.mode || '',
                        reference: e.reference,
                        motif: e.motif || '',
                    }));
                    const resp = await fetch('/api/caisse?action=apply-encaissements', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ lignes, dryRun: false }),
                    });
                    const json = await resp.json();
                    if (!json.success) throw new Error(json.error || 'Échec de l\'application.');
                    setApplyResult(json);
                    if (typeof onApplied === 'function') onApplied();
                } catch (e) {
                    setError('Erreur application : ' + (e && e.message ? e.message : e));
                } finally {
                    setApplying(false);
                }
            };

            // Charger les clients ACTIFS en live (fallback sur les 5 connus si KO).
            React.useEffect(() => {
                let cancelled = false;
                (async () => {
                    try {
                        const db = firebase.firestore();
                        const ref = await getActiveMarcheLocalClients(db);
                        if (cancelled) return;
                        const list = (ref.active || []).map(d => ({
                            client_id: (EC ? EC.slugifyClient(d.nom) : ''),
                            nom: d.nom,
                        })).filter(c => c.nom);
                        if (list.length) {
                            setActive(list);
                            setArchivedNames(ref.archivedNames || new Set());
                        } else {
                            throw new Error('liste active vide');
                        }
                    } catch (e) {
                        if (cancelled) return;
                        // Fallback sur les 5 clients connus.
                        setActive(ENC_FALLBACK_CLIENTS.map(nom => ({
                            client_id: (EC ? EC.slugifyClient(nom) : ''), nom,
                        })));
                        setArchivedNames(new Set());
                    } finally {
                        if (!cancelled) setClientsLoaded(true);
                    }
                })();
                return () => { cancelled = true; };
            }, []);

            const handleDownloadModele = () => {
                setError('');
                try {
                    if (!EC) throw new Error('Module EncaissementsCanevas indisponible.');
                    const wb = EC.buildModeleWorkbook(EC.ENCAISSEMENTS_SCHEMA, { clients: active });
                    XLSX.writeFile(wb, 'Modele_Encaissements_Marche_Local.xlsx');
                } catch (e) {
                    setError('Erreur génération modèle : ' + (e && e.message ? e.message : e));
                }
            };

            const handleFile = (ev) => {
                setError('');
                setReport(null);
                setApplyResult(null);
                const file = ev.target.files && ev.target.files[0];
                if (!file) return;
                setFileName(file.name);
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        if (!EC) throw new Error('Module EncaissementsCanevas indisponible.');
                        const wb = XLSX.read(e.target.result, { type: 'array' });
                        const ws = wb.Sheets[EC.ENCAISSEMENTS_SCHEMA.sheet] || wb.Sheets[wb.SheetNames[0]];
                        if (!ws) throw new Error('Feuille « ' + EC.ENCAISSEMENTS_SCHEMA.sheet + ' » introuvable.');
                        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
                        const res = EC.parseEncaissements(rows, { activeClients: active, archivedNames });
                        setReport(res);
                    } catch (err) {
                        setError('Erreur lecture fichier : ' + (err && err.message ? err.message : err));
                    }
                };
                reader.onerror = () => setError('Lecture du fichier impossible.');
                reader.readAsArrayBuffer(file);
            };

            const card = { background: 'white', border: '1px solid var(--gray-200)', borderRadius: 12, padding: 16, marginBottom: 16 };
            const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--gray-600)', borderBottom: '1px solid var(--gray-200)', whiteSpace: 'nowrap' };
            const td = { padding: '7px 10px', fontSize: 12, borderBottom: '1px solid var(--gray-100)', whiteSpace: 'nowrap' };
            const counter = (label, value, color) => (
                <div style={{ flex: '1 1 120px', background: 'var(--gray-50, #f7f7f7)', border: '1px solid var(--gray-200)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--gray-800)' }}>{value}</div>
                    <div style={{ fontSize: 11, color: 'var(--gray-600)', marginTop: 2 }}>{label}</div>
                </div>
            );

            return (
                <div className="fade-in">
                    <div style={card}>
                        <h4 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <i className="fa-solid fa-file-invoice-dollar" style={{ color: 'var(--berry)' }}></i>
                            Import des encaissements (compte client Marché Local)
                        </h4>
                        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--gray-600)', lineHeight: 1.5 }}>
                            Vérification du canevas <strong>sans aucune écriture</strong> (mode aperçu).
                            Téléchargez le modèle vierge, remplissez-le, puis chargez-le pour
                            contrôler les lignes valides, les rejets et les doublons.
                        </p>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                            <button onClick={handleDownloadModele} disabled={!clientsLoaded}
                                style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--berry)', background: 'white', color: 'var(--berry)', cursor: clientsLoaded ? 'pointer' : 'not-allowed', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                                <i className="fa-solid fa-download"></i> Télécharger le modèle vierge
                            </button>
                            <label style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--gray-200)', background: 'white', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                                <i className="fa-solid fa-file-arrow-up"></i> Charger un fichier .xlsx
                                <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ display: 'none' }} />
                            </label>
                            {fileName && <span style={{ fontSize: 12, color: 'var(--gray-600)' }}><i className="fa-solid fa-paperclip" style={{ marginRight: 5 }}></i>{fileName}</span>}
                        </div>
                        <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <i className="fa-solid fa-shield-halved"></i>
                            Aperçu seulement — aucune donnée n'est enregistrée à cette étape.
                        </div>
                    </div>

                    {error && (
                        <div style={{ ...card, borderColor: '#E74C3C', background: '#FDEDEC', color: '#922B21', fontSize: 12.5 }}>
                            <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 7 }}></i>{error}
                        </div>
                    )}

                    {report && (
                        <React.Fragment>
                            <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                {counter('Lignes lues', report.stats.lus, 'var(--gray-800)')}
                                {counter('Valides', report.stats.ok, '#27AE60')}
                                {counter('Rejetées', report.stats.rejetes, '#E74C3C')}
                                {counter('Doublons', report.stats.doublons, '#E67E22')}
                            </div>

                            {/* Bouton Appliquer — DG/Finance uniquement (Achats : pas le bouton). */}
                            {isControle && (
                                <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                        <button
                                            onClick={handleApply}
                                            disabled={applying || !report.ok.length}
                                            style={{
                                                padding: '10px 20px', borderRadius: 8, border: 'none',
                                                background: (applying || !report.ok.length) ? 'var(--gray-300, #ccc)' : 'var(--berry)',
                                                color: 'white', fontSize: 13, fontWeight: 700,
                                                cursor: (applying || !report.ok.length) ? 'not-allowed' : 'pointer',
                                                display: 'flex', alignItems: 'center', gap: 8,
                                            }}>
                                            <i className={applying ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-database'}></i>
                                            {applying ? 'Application en cours…' : `Appliquer (${report.ok.length} encaissement${report.ok.length > 1 ? 's' : ''})`}
                                        </button>
                                        <span style={{ fontSize: 11.5, color: 'var(--gray-500)' }}>
                                            <i className="fa-solid fa-circle-info" style={{ marginRight: 5 }}></i>
                                            Enregistre les lignes valides dans les comptes clients. Réservé DG / Finance.
                                        </span>
                                    </div>
                                    {applyResult && (
                                        <div style={{ background: '#EAFAF1', border: '1px solid #27AE60', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: '#1E8449' }}>
                                            <i className="fa-solid fa-circle-check" style={{ marginRight: 7 }}></i>
                                            <strong>{applyResult.created || 0}</strong> créé{(applyResult.created || 0) > 1 ? 's' : ''} ·{' '}
                                            <strong>{applyResult.duplicatesIgnored || 0}</strong> doublon{(applyResult.duplicatesIgnored || 0) > 1 ? 's' : ''} ignoré{(applyResult.duplicatesIgnored || 0) > 1 ? 's' : ''} ·{' '}
                                            <strong>{(applyResult.errors || []).length}</strong> erreur{(applyResult.errors || []).length > 1 ? 's' : ''}
                                            {(applyResult.errors || []).length > 0 && (
                                                <div style={{ marginTop: 6, color: '#C0392B' }}>
                                                    {applyResult.errors.map((er, i) => (
                                                        <div key={i}>Ligne {er.ligne} : {ENC_REJET_LABELS[er.raison] || er.raison}</div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {report.ok.length > 0 && (
                                <div style={card}>
                                    <h4 style={{ margin: '0 0 10px', fontSize: 13, color: '#27AE60' }}>
                                        <i className="fa-solid fa-circle-check" style={{ marginRight: 7 }}></i>
                                        Encaissements valides ({report.ok.length})
                                    </h4>
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 600 }}>
                                            <thead><tr>
                                                <th style={th}>Client</th><th style={th}>Date</th>
                                                <th style={th}>Montant (DH)</th><th style={th}>Mode</th>
                                                <th style={th}>Référence</th><th style={th}>Motif</th>
                                            </tr></thead>
                                            <tbody>
                                                {report.ok.map((e, i) => (
                                                    <tr key={i}>
                                                        <td style={td}>{e.client_id}</td>
                                                        <td style={td}>{e.date}</td>
                                                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{e.montant.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</td>
                                                        <td style={td}>{e.mode || '—'}</td>
                                                        <td style={td}>{e.reference}</td>
                                                        <td style={td}>{e.motif || '—'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {report.rejets.length > 0 && (
                                <div style={card}>
                                    <h4 style={{ margin: '0 0 10px', fontSize: 13, color: '#E74C3C' }}>
                                        <i className="fa-solid fa-circle-xmark" style={{ marginRight: 7 }}></i>
                                        Lignes rejetées ({report.rejets.length})
                                    </h4>
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 600 }}>
                                            <thead><tr>
                                                <th style={th}>Ligne</th><th style={th}>Motif du rejet</th>
                                                <th style={th}>Client</th><th style={th}>Référence</th>
                                                <th style={th}>Date</th><th style={th}>Montant</th>
                                            </tr></thead>
                                            <tbody>
                                                {report.rejets.map((r, i) => (
                                                    <tr key={i}>
                                                        <td style={td}>{r.ligne}</td>
                                                        <td style={{ ...td, color: '#C0392B', fontWeight: 600 }}>{ENC_REJET_LABELS[r.raison] || r.raison}</td>
                                                        <td style={td}>{encBrut(r, 'client', 'Client')}</td>
                                                        <td style={td}>{encBrut(r, 'reference', 'Référence')}</td>
                                                        <td style={td}>{encBrut(r, 'date', 'Date encaissement')}</td>
                                                        <td style={td}>{encBrut(r, 'montant', 'Montant (DH)')}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {report.doublons.length > 0 && (
                                <div style={card}>
                                    <h4 style={{ margin: '0 0 10px', fontSize: 13, color: '#E67E22' }}>
                                        <i className="fa-solid fa-copy" style={{ marginRight: 7 }}></i>
                                        Doublons dans le fichier ({report.doublons.length})
                                    </h4>
                                    <p style={{ margin: '0 0 8px', fontSize: 11.5, color: 'var(--gray-600)' }}>
                                        La première occurrence de chaque référence est conservée ; les suivantes sont listées ici.
                                    </p>
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 600 }}>
                                            <thead><tr>
                                                <th style={th}>Ligne</th><th style={th}>Client</th>
                                                <th style={th}>Référence</th><th style={th}>Date</th>
                                                <th style={th}>Montant</th>
                                            </tr></thead>
                                            <tbody>
                                                {report.doublons.map((d, i) => (
                                                    <tr key={i}>
                                                        <td style={td}>{d.ligne}</td>
                                                        <td style={td}>{encBrut(d, 'client', 'Client')}</td>
                                                        <td style={td}>{encBrut(d, 'reference', 'Référence')}</td>
                                                        <td style={td}>{encBrut(d, 'date', 'Date encaissement')}</td>
                                                        <td style={td}>{encBrut(d, 'montant', 'Montant (DH)')}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </React.Fragment>
                    )}
                </div>
            );
        }

export { CaisseImportEncaissementsSub };
