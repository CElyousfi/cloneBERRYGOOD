/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CanevaUploadCard */
import { callCanevaStock } from '../shared/callCanevaStock.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { CaisseDropzone } from './CaisseDropzone.jsx';
import { CanevaSummaryView } from './CanevaSummaryView.jsx';
import { caisseFileToB64 } from './caisseFileToB64.jsx';
import { canevaActor } from './canevaActor.jsx';

// Carte d'upload Achats : dropzone → aperçu obligatoire → import direct OU demande Finance.
        function CanevaUploadCard({ currentProfile, profileData, onDone }) {
            const [file, setFile] = useState(null);
            const [phase, setPhase] = useState('idle'); // idle | previewing | preview_ready | submitting | done | error
            const [summary, setSummary] = useState(null);
            const [error, setError] = useState('');
            const [result, setResult] = useState(null);

            const reset = () => { setFile(null); setPhase('idle'); setSummary(null); setError(''); setResult(null); };
            const onFiles = (fs) => { setFile(fs[0]); setPhase('idle'); setSummary(null); setError(''); setResult(null); };

            const doPreview = async () => {
                setPhase('previewing'); setError('');
                try {
                    const b64 = await caisseFileToB64(file);
                    const j = await callCanevaStock({ mode: 'preview', file_base64: b64, filename: file.name, requested_by: canevaActor(currentProfile, profileData) });
                    if (!j.success) { setSummary(j.summary || null); setError((j.reasons && j.reasons.join(' · ')) || j.error || 'Classeur invalide'); setPhase('error'); return; }
                    setSummary(j.summary); setPhase('preview_ready');
                } catch (e) { setError(e.message); setPhase('error'); }
            };

            const submit = async (mode) => {
                setPhase('submitting'); setError('');
                try {
                    const b64 = await caisseFileToB64(file);
                    const j = await callCanevaStock({ mode, file_base64: b64, filename: file.name, requested_by: canevaActor(currentProfile, profileData) });
                    if (!j.success) { setError(j.error || 'Échec'); setPhase('preview_ready'); return; }
                    setResult({ mode, ...j }); setPhase('done');
                    if (typeof onDone === 'function') onDone();
                } catch (e) { setError(e.message); setPhase('error'); }
            };

            const requiresFinance = summary && summary.requires_finance;
            const hardBlock = summary && summary.guard && summary.guard.hardBlock;

            return (
                <div style={{background:'white',borderRadius:12,border:'1px solid var(--gray-200)',padding:16,maxWidth:680}}>
                    <div style={{fontWeight:700,fontSize:14,marginBottom:4}}><i className="fa-solid fa-file-import" style={{marginRight:8,color:'var(--berry)'}}></i>Importer le canevas Stock</div>
                    <div style={{fontSize:11.5,color:'var(--gray-500)',marginBottom:12}}>Déposez le classeur Excel « CANEVA STOCK BGF ». Un aperçu obligatoire s'affiche avant tout import. Les jours déjà importés ne peuvent être remplacés qu'avec l'accord de Finance.</div>

                    {(phase === 'idle' || phase === 'error') && <CaisseDropzone onFiles={onFiles} cc={{ color: 'var(--berry)', bg: 'rgba(139,34,82,0.08)' }} />}
                    {file && phase !== 'done' && <div style={{fontSize:11,color:'var(--berry)',marginBottom:8}}><i className="fa-solid fa-file-excel" style={{marginRight:5}}></i>{file.name}</div>}
                    {error && <div style={{padding:8,background:'rgba(231,76,60,0.08)',color:'var(--red)',borderRadius:6,fontSize:11,marginBottom:8}}><i className="fa-solid fa-triangle-exclamation" style={{marginRight:5}}></i>{error}</div>}

                    {(phase === 'idle' || phase === 'error') && file && (
                        <button onClick={doPreview} style={{width:'100%',padding:'10px',borderRadius:8,border:'none',background:'var(--berry)',color:'white',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                            <i className="fa-solid fa-magnifying-glass" style={{marginRight:6}}></i>Prévisualiser
                        </button>
                    )}
                    {phase === 'previewing' && <button disabled style={{width:'100%',padding:'10px',borderRadius:8,border:'none',background:'var(--gray-200)',color:'white',fontSize:12,cursor:'wait'}}><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Analyse…</button>}

                    {summary && (phase === 'preview_ready' || phase === 'submitting' || phase === 'error') && <CanevaSummaryView s={summary} />}

                    {phase === 'preview_ready' && !hardBlock && (
                        <div style={{display:'flex',gap:8,marginTop:12}}>
                            <button onClick={reset} style={{padding:'10px 14px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',color:'var(--gray-600)',fontSize:12,cursor:'pointer'}}>Annuler</button>
                            {requiresFinance ? (
                                <button onClick={() => submit('request')} style={{flex:1,padding:'10px',borderRadius:8,border:'none',background:'var(--gold)',color:'white',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                    <i className="fa-solid fa-paper-plane" style={{marginRight:6}}></i>Demander l'import à Finance
                                </button>
                            ) : (
                                <button onClick={() => submit('apply')} style={{flex:1,padding:'10px',borderRadius:8,border:'none',background:'var(--green)',color:'white',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                    <i className="fa-solid fa-upload" style={{marginRight:6}}></i>Importer
                                </button>
                            )}
                        </div>
                    )}
                    {phase === 'preview_ready' && hardBlock && (
                        <button onClick={reset} style={{width:'100%',marginTop:12,padding:'9px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',color:'var(--gray-600)',fontSize:12,cursor:'pointer'}}>Choisir un autre fichier</button>
                    )}
                    {phase === 'submitting' && <button disabled style={{width:'100%',marginTop:12,padding:'10px',borderRadius:8,border:'none',background:'var(--gray-200)',color:'white',fontSize:12,cursor:'wait'}}><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Traitement…</button>}

                    {phase === 'done' && result && (
                        <div style={{marginTop:12}}>
                            <div style={{padding:12,background:'rgba(45,139,78,0.06)',border:'1px solid rgba(45,139,78,0.3)',borderRadius:8,fontSize:12}}>
                                {result.status === 'importe'
                                    ? <span style={{color:'var(--green)',fontWeight:600}}><i className="fa-solid fa-check" style={{marginRight:6}}></i>Import effectué{result.impacted_dates ? ` — ${result.impacted_dates.length} jour(s) traité(s)` : ''}.</span>
                                    : <span style={{color:'var(--gold)',fontWeight:600}}><i className="fa-solid fa-paper-plane" style={{marginRight:6}}></i>Demande envoyée à Finance. L'import s'appliquera après validation.</span>}
                            </div>
                            <button onClick={reset} style={{width:'100%',marginTop:10,padding:'9px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',color:'var(--gray-600)',fontSize:12,cursor:'pointer'}}><i className="fa-solid fa-rotate-left" style={{marginRight:6}}></i>Nouvel import</button>
                        </div>
                    )}
                </div>
            );
        }

export { CanevaUploadCard };
