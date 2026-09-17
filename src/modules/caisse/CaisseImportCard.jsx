/* Module: caisse | Déclaration(s): CaisseImportCard */
import { formatMAD } from '../finance/formatMAD.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { CaisseDropzone } from './CaisseDropzone.jsx';
import { CaisseImportReportView } from './CaisseImportReportView.jsx';
import { CaissePreviewSummary } from './CaissePreviewSummary.jsx';
import { caisseFileToB64 } from './caisseFileToB64.jsx';

// Carte d'une caisse : machine à états locale (idle → preview → import → done).
        function CaisseImportCard({ caisse, fmt, cc, onDone }) {
            const [files, setFiles] = useState([]);
            const [overwrite, setOverwrite] = useState(false);
            const [phase, setPhase] = useState('idle'); // idle | previewing | preview_ready | importing | done | error
            const [summaries, setSummaries] = useState([]); // [{file, summary}]
            const [reports, setReports] = useState([]);      // [{file, report}]
            const [progress, setProgress] = useState({ current: 0, total: 0 });
            const [error, setError] = useState('');
            const b64Cache = React.useRef({});

            const reset = () => { setFiles([]); setPhase('idle'); setSummaries([]); setReports([]); setError(''); b64Cache.current = {}; };
            const onFiles = (fs) => { setFiles(fs); setPhase('idle'); setSummaries([]); setReports([]); setError(''); };

            const getB64 = async (file) => {
                if (!b64Cache.current[file.name]) b64Cache.current[file.name] = await caisseFileToB64(file);
                return b64Cache.current[file.name];
            };

            const callImport = async (file, dryRun) => {
                const b64 = await getB64(file);
                const r = await fetch('/api/caisse?action=import-excel-file', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ caisse_id: caisse.id, file_base64: b64, force_overwrite: overwrite, dry_run: dryRun }),
                });
                return r.json();
            };

            const doPreview = async () => {
                setPhase('previewing'); setError(''); setSummaries([]);
                try {
                    const out = [];
                    for (const file of files) {
                        const json = await callImport(file, true);
                        if (!json.success) { setError((json.error || 'Erreur') + ' — ' + file.name); setPhase('error'); return; }
                        out.push({ file, summary: json });
                    }
                    setSummaries(out); setPhase('preview_ready');
                } catch (err) { setError(err.message); setPhase('error'); }
            };

            const doImport = async () => {
                setPhase('importing'); setError(''); setReports([]);
                const out = [];
                try {
                    for (let i = 0; i < files.length; i++) {
                        setProgress({ current: i + 1, total: files.length });
                        const json = await callImport(files[i], false);
                        if (!json.success) { setError((json.error || 'Erreur') + ' — ' + files[i].name); setPhase('error'); return; }
                        out.push({ file: files[i], report: json });
                    }
                    setReports(out); setPhase('done');
                    if (typeof onDone === 'function') onDone();
                } catch (err) { setError(err.message); setPhase('error'); }
            };

            const multi = files.length > 1;
            const busy = phase === 'previewing' || phase === 'importing';

            return (
                <div style={{background:'white',borderRadius:12,border:'1px solid var(--gray-200)',padding:16,position:'relative',overflow:'hidden'}}>
                    <div style={{position:'absolute',top:0,left:0,width:4,height:'100%',background:cc.color}}></div>
                    <div style={{paddingLeft:12}}>
                        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                            <div style={{width:36,height:36,borderRadius:10,background:cc.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                <i className={`fa-solid ${cc.icon}`} style={{color:cc.color,fontSize:14}}></i>
                            </div>
                            <div style={{flex:1}}>
                                <div style={{fontWeight:600,fontSize:13}}>{caisse.nom}</div>
                                <div style={{fontSize:11,color:'var(--gray-400)'}}>{formatMAD(caisse.solde_actuel)}</div>
                            </div>
                        </div>

                        <div style={{fontSize:11,color:'var(--gray-600)',marginBottom:8,padding:'8px 10px',background:'var(--gray-100)',borderRadius:6}}>
                            <div style={{fontWeight:600,marginBottom:2}}>{fmt.label}</div>
                            <div style={{color:'var(--gray-400)'}}>{fmt.hint}</div>
                        </div>

                        {(phase === 'idle' || phase === 'error') && <CaisseDropzone onFiles={onFiles} cc={cc} />}

                        {files.length > 0 && phase !== 'done' && (
                            <div style={{fontSize:11,marginBottom:8}}>
                                {files.map((f, i) => <div key={i} style={{color:'var(--berry)',padding:'2px 0'}}><i className="fa-solid fa-file-excel" style={{marginRight:5}}></i>{f.name}</div>)}
                            </div>
                        )}

                        {phase !== 'done' && (
                            <label style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--gray-600)',marginBottom:10,cursor:'pointer'}}>
                                <input type="checkbox" checked={overwrite} disabled={busy} onChange={e => setOverwrite(e.target.checked)} />
                                Écraser les transactions existantes (forcer la mise à jour)
                            </label>
                        )}

                        {error && <div style={{padding:8,background:'rgba(231,76,60,0.08)',color:'var(--red)',borderRadius:6,fontSize:11,marginBottom:8}}><i className="fa-solid fa-triangle-exclamation" style={{marginRight:5}}></i>{error}</div>}

                        {phase === 'importing' && progress.total > 1 && (
                            <div style={{marginBottom:8}}>
                                <div style={{fontSize:10.5,color:'var(--gray-500)',marginBottom:3}}>Fichier {progress.current}/{progress.total}…</div>
                                <div style={{height:6,background:'var(--gray-100)',borderRadius:4,overflow:'hidden'}}>
                                    <div style={{height:'100%',width:`${(progress.current / progress.total) * 100}%`,background:cc.color,transition:'width .2s'}}></div>
                                </div>
                            </div>
                        )}

                        {/* Boutons selon la phase */}
                        {(phase === 'idle' || phase === 'error') && files.length > 0 && (
                            <button onClick={doPreview}
                                style={{width:'100%',padding:'10px',borderRadius:8,border:'none',background:cc.color,color:'white',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                <i className="fa-solid fa-magnifying-glass" style={{marginRight:6}}></i>Prévisualiser
                            </button>
                        )}
                        {phase === 'previewing' && (
                            <button disabled style={{width:'100%',padding:'10px',borderRadius:8,border:'none',background:'var(--gray-200)',color:'white',fontSize:12,fontWeight:600,cursor:'wait'}}>
                                <i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Analyse en cours…
                            </button>
                        )}

                        {(phase === 'preview_ready') && summaries.map((it, i) => (
                            <CaissePreviewSummary key={i} s={it.summary} fileName={it.file.name} multi={multi} />
                        ))}

                        {phase === 'preview_ready' && (
                            <div style={{display:'flex',gap:8,marginTop:10}}>
                                <button onClick={reset} style={{flex:'0 0 auto',padding:'10px 14px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',color:'var(--gray-600)',fontSize:12,cursor:'pointer'}}>Annuler</button>
                                <button onClick={doImport} style={{flex:1,padding:'10px',borderRadius:8,border:'none',background:cc.color,color:'white',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                    <i className="fa-solid fa-upload" style={{marginRight:6}}></i>Confirmer l'import
                                </button>
                            </div>
                        )}

                        {phase === 'importing' && (
                            <button disabled style={{width:'100%',padding:'10px',borderRadius:8,border:'none',background:'var(--gray-200)',color:'white',fontSize:12,fontWeight:600,cursor:'wait'}}>
                                <i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Import en cours…
                            </button>
                        )}

                        {phase === 'done' && (
                            <>
                                {reports.map((it, i) => <CaisseImportReportView key={i} r={it.report} fileName={it.file.name} multi={multi} />)}
                                <button onClick={reset} style={{width:'100%',marginTop:10,padding:'9px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',color:'var(--gray-600)',fontSize:12,cursor:'pointer'}}>
                                    <i className="fa-solid fa-rotate-left" style={{marginRight:6}}></i>Nouvel import
                                </button>
                            </>
                        )}
                    </div>
                </div>
            );
        }

export { CaisseImportCard };
