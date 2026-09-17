/* Module: recolte | Déclaration(s): CaporalSaisieTab */
import { Panel } from '../shared/Panel.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ===================== CAPORAL SAISIE TAB =====================
        function CaporalSaisieTab({ data, farmFilter, avoSubFilter }) {
            const [lang, setLang] = useState('fr');
            const isAr = lang === 'ar';
            const isAvocatier = farmFilter === 'Avocatier';
            const unite = isAvocatier ? (isAr ? 'خطوط' : 'lignes') : (isAr ? 'أنفاق' : 'tunnels');

            // Get parcelles for this farm
            const parcelles = React.useMemo(() => {
                if (isAvocatier) {
                    const avo = data.avocatierConfig || {};
                    const entries = avoSubFilter ? { [avoSubFilter]: avo[avoSubFilter] || [] } : avo;
                    return Object.entries(entries).map(([key, arr]) => arr.map(p => ({ ...p, nbTotal: p.nbLignes, ferme: key }))).flat();
                }
                return (data.parcelleConfig[farmFilter] || []).map(p => ({ ...p, nbTotal: p.nbTunnels }));
            }, [farmFilter, avoSubFilter, data.parcelleConfig, data.avocatierConfig]);

            const normes = data.normesProductivite || [];

            // State for saisie form
            const [saisies, setSaisies] = useState({});
            const [progress, setProgress] = useState([]);
            const [todaySaisies, setTodaySaisies] = useState([]);
            const [loading, setLoading] = useState(true);
            const [saving, setSaving] = useState(false);
            const [savedMsg, setSavedMsg] = useState('');
            const [showReexec, setShowReexec] = useState(null); // {parcelle, tache}
            const [reexecJustif, setReexecJustif] = useState('');
            const [reexecNb, setReexecNb] = useState('');

            // Load progress + today's saisies
            React.useEffect(() => {
                setLoading(true);
                const fermeQuery = farmFilter ? `&ferme=${farmFilter}` : '';
                Promise.all([
                    fetch(`/api/hors-recolte-suivi?action=get-progress${fermeQuery}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=get-saisies-today${fermeQuery}`).then(r => r.json()),
                ]).then(([progRes, saisieRes]) => {
                    if (progRes.success) setProgress(progRes.progress || []);
                    if (saisieRes.success) {
                        setTodaySaisies(saisieRes.saisies || []);
                        // Pre-fill form from today's saisies
                        const prefill = {};
                        (saisieRes.saisies || []).forEach(s => {
                            const key = `${s.parcelle}__${s.tache}`;
                            prefill[key] = { nbRealise: s.nbRealise, nbOuvriers: s.nbOuvriers };
                        });
                        setSaisies(prefill);
                    }
                }).catch(() => {}).finally(() => setLoading(false));
            }, [farmFilter]);

            const getCumul = (parcelle, tache) => {
                const found = progress.find(p => p.parcelle === parcelle && p.tache === tache);
                return found || { totalRealise: 0, termine: false };
            };

            const handleSave = async (parcelle, tache, nbTotal) => {
                const key = `${parcelle}__${tache}`;
                const s = saisies[key];
                if (!s || !s.nbRealise) return;

                setSaving(true);
                try {
                    const resp = await fetch('/api/hors-recolte-suivi?action=saisie', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ferme: farmFilter,
                            parcelle,
                            tache,
                            nbRealise: Number(s.nbRealise),
                            nbOuvriers: Number(s.nbOuvriers) || 0,
                            caporal: `caporal_${farmFilter.toLowerCase()}`,
                            nbTotal,
                        }),
                    });
                    const json = await resp.json();
                    if (json.success) {
                        setProgress(prev => {
                            const idx = prev.findIndex(p => p.parcelle === parcelle && p.tache === tache);
                            const updated = { parcelle, tache, ferme: farmFilter, totalRealise: json.totalRealise, termine: json.termine };
                            if (idx >= 0) { const c = [...prev]; c[idx] = { ...c[idx], ...updated }; return c; }
                            return [...prev, updated];
                        });
                        setSavedMsg(`${parcelle} — ${tache}`);
                        setTimeout(() => setSavedMsg(''), 2000);
                    }
                } catch (e) {}
                setSaving(false);
            };

            const handleReexecDemande = async () => {
                if (!showReexec || !reexecJustif.trim()) return;
                setSaving(true);
                try {
                    await fetch('/api/hors-recolte-suivi?action=demande-reexecution', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ferme: farmFilter,
                            parcelle: showReexec.parcelle,
                            tache: showReexec.tache,
                            justification: reexecJustif.trim(),
                            nbTunnels: Number(reexecNb) || 0,
                            caporal: `caporal_${farmFilter.toLowerCase()}`,
                        }),
                    });
                    setSavedMsg(isAr ? 'تم إرسال الطلب' : 'Demande envoyée');
                    setTimeout(() => setSavedMsg(''), 2000);
                    setShowReexec(null);
                    setReexecJustif('');
                    setReexecNb('');
                    window._refreshNotifications?.();
                } catch (e) {}
                setSaving(false);
            };

            const updateSaisie = (parcelle, tache, field, val) => {
                const key = `${parcelle}__${tache}`;
                setSaisies(prev => ({ ...prev, [key]: { ...(prev[key] || {}), [field]: val } }));
            };

            const t = {
                title: isAr ? 'إدخال يومي' : 'Saisie du Jour',
                parcelle: isAr ? 'القطعة' : 'Parcelle',
                tache: isAr ? 'المهمة' : 'Tâche',
                realise: isAr ? 'المنجز اليوم' : `${unite} réalisés`,
                ouvriers: isAr ? 'عدد العمال' : 'Nb Ouvriers',
                progression: isAr ? 'التقدم' : 'Progression',
                norme: isAr ? 'المعيار' : 'Norme',
                rendement: isAr ? 'المردود' : 'Rendement',
                enregistrer: isAr ? 'حفظ' : 'Enregistrer',
                termine: isAr ? 'منتهية' : 'Terminée',
                demanderReexec: isAr ? 'طلب إعادة التنفيذ' : 'Demander re-exécution',
                langue: isAr ? 'اللغة' : 'Langue',
                total: isAr ? 'المجموع' : 'Total',
            };

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin fa-2x"></i><div style={{marginTop:12}}>Chargement...</div></div>;

            const today = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

            return (
                <div className="fade-in" dir={isAr ? 'rtl' : 'ltr'} style={{fontFamily: isAr ? "'Noto Sans Arabic', 'Segoe UI', Arial, sans-serif" : undefined}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
                        <div>
                            <h2 style={{fontSize:16, fontWeight:800, color:'var(--dark)', margin:0}}>{t.title}</h2>
                            <div style={{fontSize:11, color:'var(--gray-400)', marginTop:2}}>{today} — {farmFilter}</div>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                            {savedMsg && <span style={{fontSize:11, color:'var(--green)', fontWeight:600}}><i className="fa-solid fa-check-circle" style={{marginRight:4}}></i>{savedMsg}</span>}
                            <div style={{display:'flex',background:'var(--gray-100)',borderRadius:20,padding:2,cursor:'pointer'}} onClick={() => setLang(lang === 'fr' ? 'ar' : 'fr')}>
                                <span style={{padding:'5px 14px',borderRadius:18,fontSize:12,fontWeight:700,background: lang === 'fr' ? 'var(--berry)' : 'transparent',color: lang === 'fr' ? '#fff' : 'var(--gray-500)',transition:'all 0.2s'}}>FR</span>
                                <span style={{padding:'5px 14px',borderRadius:18,fontSize:12,fontWeight:700,background: lang === 'ar' ? 'var(--berry)' : 'transparent',color: lang === 'ar' ? '#fff' : 'var(--gray-500)',transition:'all 0.2s'}}>ع</span>
                            </div>
                        </div>
                    </div>

                    {parcelles.map((parc, pi) => (
                        <Panel key={pi} title={`${parc.nom} — ${parc.variete || parc.culture}`} icon={isAvocatier ? 'fa-tree' : 'fa-seedling'}>
                            <div style={{fontSize:10, color:'var(--gray-400)', marginBottom:10}}>
                                {t.total}: {parc.nbTotal} {unite}
                            </div>
                            <div style={{display:'flex', flexDirection:'column', gap:12}}>
                                {normes.map((norme, ni) => {
                                    const cumul = getCumul(parc.nom, norme.tache);
                                    const key = `${parc.nom}__${norme.tache}`;
                                    const saisie = saisies[key] || {};
                                    const currentNb = Number(saisie.nbRealise) || 0;
                                    const totalAvecSaisie = cumul.totalRealise + currentNb;
                                    const pct = parc.nbTotal > 0 ? Math.min(100, Math.round(totalAvecSaisie / parc.nbTotal * 100)) : 0;
                                    const normeAttendu = (Number(saisie.nbOuvriers) || 0) * norme.normeTunnelsParJourParOuvrier;
                                    const rendPct = normeAttendu > 0 ? Math.round(currentNb / normeAttendu * 100) : 0;
                                    const isTermine = cumul.termine || totalAvecSaisie >= parc.nbTotal;

                                    return (
                                        <div key={ni} style={{padding:12, background: isTermine ? 'rgba(46,204,113,0.05)' : 'var(--gray-50)', borderRadius:10, border: isTermine ? '1px solid rgba(46,204,113,0.3)' : '1px solid var(--gray-100)'}}>
                                            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
                                                <div style={{display:'flex', alignItems:'center', gap:8}}>
                                                    <span style={{fontSize:12, fontWeight:700}}>{norme.tache}</span>
                                                    {isTermine && <span style={{fontSize:9, padding:'2px 8px', borderRadius:10, background:'var(--green)', color:'white', fontWeight:700}}>{t.termine}</span>}
                                                </div>
                                                <span style={{fontSize:10, color:'var(--gray-400)'}}>
                                                    {t.norme}: {norme.normeTunnelsParJourParOuvrier} {unite}/{isAr ? 'يوم/عامل' : 'jour/ouv.'}
                                                </span>
                                            </div>

                                            {/* Progress bar */}
                                            <div style={{marginBottom:10}}>
                                                <div style={{display:'flex', justifyContent:'space-between', marginBottom:3}}>
                                                    <span style={{fontSize:10, color:'var(--gray-500)'}}>{cumul.totalRealise}{currentNb > 0 ? ` + ${currentNb}` : ''} / {parc.nbTotal} {unite}</span>
                                                    <span style={{fontSize:10, fontWeight:700, color: pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--berry)'}}>{pct}%</span>
                                                </div>
                                                <div style={{width:'100%', height:8, background:'var(--gray-200)', borderRadius:4, overflow:'hidden'}}>
                                                    <div style={{width:`${pct}%`, height:'100%', borderRadius:4, transition:'width 0.3s',
                                                        background: pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--berry)'}} />
                                                </div>
                                            </div>

                                            {/* Input fields */}
                                            {!isTermine ? (
                                                <div style={{display:'flex', gap:8, alignItems:'flex-end', flexWrap:'wrap'}}>
                                                    <div style={{flex:'0 0 100px'}}>
                                                        <label style={{fontSize:9, fontWeight:600, display:'block', marginBottom:3, color:'var(--gray-500)'}}>{t.realise}</label>
                                                        <input type="number" min="0" value={saisie.nbRealise || ''} onChange={e => updateSaisie(parc.nom, norme.tache, 'nbRealise', e.target.value)}
                                                            placeholder="0" style={{width:'100%', padding:'6px 8px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12, textAlign:'center', fontWeight:700}} />
                                                    </div>
                                                    <div style={{flex:'0 0 80px'}}>
                                                        <label style={{fontSize:9, fontWeight:600, display:'block', marginBottom:3, color:'var(--gray-500)'}}>{t.ouvriers}</label>
                                                        <input type="number" min="0" value={saisie.nbOuvriers || ''} onChange={e => updateSaisie(parc.nom, norme.tache, 'nbOuvriers', e.target.value)}
                                                            placeholder="0" style={{width:'100%', padding:'6px 8px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12, textAlign:'center'}} />
                                                    </div>
                                                    {currentNb > 0 && normeAttendu > 0 && (
                                                        <span style={{fontSize:10, padding:'4px 10px', borderRadius:8, fontWeight:700,
                                                            background: rendPct >= 100 ? 'rgba(46,204,113,0.1)' : rendPct >= 80 ? 'rgba(52,152,219,0.1)' : rendPct >= 60 ? 'rgba(243,156,18,0.1)' : 'rgba(231,76,60,0.1)',
                                                            color: rendPct >= 100 ? 'var(--green)' : rendPct >= 80 ? 'var(--blue)' : rendPct >= 60 ? 'var(--orange)' : 'var(--red)'}}>
                                                            {t.rendement}: {rendPct}%
                                                        </span>
                                                    )}
                                                    <button onClick={() => handleSave(parc.nom, norme.tache, parc.nbTotal)} disabled={saving || !currentNb}
                                                        style={{padding:'6px 14px', background: currentNb ? 'var(--berry)' : 'var(--gray-200)', color: currentNb ? 'white' : 'var(--gray-400)',
                                                            border:'none', borderRadius:8, fontSize:11, fontWeight:600, cursor: currentNb ? 'pointer' : 'default', whiteSpace:'nowrap'}}>
                                                        <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-save'}`} style={{marginRight:4}}></i>{t.enregistrer}
                                                    </button>
                                                </div>
                                            ) : (
                                                <div style={{display:'flex', gap:8, alignItems:'center'}}>
                                                    <button onClick={() => { setShowReexec({ parcelle: parc.nom, tache: norme.tache }); setReexecJustif(''); setReexecNb(''); }}
                                                        style={{padding:'6px 14px', background:'rgba(243,156,18,0.1)', color:'var(--orange)', border:'1px solid var(--orange)', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                                                        <i className="fa-solid fa-rotate-right" style={{marginRight:4}}></i>{t.demanderReexec}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </Panel>
                    ))}

                    {/* Re-execution modal */}
                    {showReexec && (
                        <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}
                            onClick={() => setShowReexec(null)}>
                            <div style={{background:'white', borderRadius:16, padding:24, maxWidth:420, width:'100%', boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <h3 style={{fontSize:16, fontWeight:800, marginBottom:4, color:'var(--orange)'}}>
                                    <i className="fa-solid fa-rotate-right" style={{marginRight:8}}></i>
                                    {isAr ? 'طلب إعادة التنفيذ' : 'Demande de re-exécution'}
                                </h3>
                                <div style={{fontSize:12, color:'var(--gray-500)', marginBottom:16}}>
                                    {showReexec.parcelle} — {showReexec.tache}
                                </div>
                                <div style={{marginBottom:12}}>
                                    <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>{isAr ? 'السبب' : 'Justification'} *</label>
                                    <textarea value={reexecJustif} onChange={e => setReexecJustif(e.target.value)}
                                        placeholder={isAr ? 'اشرح لماذا يجب إعادة هذه المهمة...' : 'Expliquez pourquoi cette tâche doit être refaite...'}
                                        style={{width:'100%', padding:10, borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12, minHeight:80, resize:'vertical'}} />
                                </div>
                                <div style={{marginBottom:16}}>
                                    <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>{isAr ? 'عدد' : 'Nombre de'} {unite}</label>
                                    <input type="number" min="1" value={reexecNb} onChange={e => setReexecNb(e.target.value)} placeholder="0"
                                        style={{width:100, padding:'6px 8px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12, textAlign:'center'}} />
                                </div>
                                <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                                    <button onClick={() => setShowReexec(null)} style={{padding:'8px 16px', background:'var(--gray-200)', color:'var(--gray-600)', border:'none', borderRadius:8, fontSize:12, cursor:'pointer'}}>
                                        {isAr ? 'إلغاء' : 'Annuler'}
                                    </button>
                                    <button onClick={handleReexecDemande} disabled={saving || !reexecJustif.trim()}
                                        style={{padding:'8px 16px', background: reexecJustif.trim() ? 'var(--orange)' : 'var(--gray-200)', color: reexecJustif.trim() ? 'white' : 'var(--gray-400)', border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor: reexecJustif.trim() ? 'pointer' : 'default'}}>
                                        <i className="fa-solid fa-paper-plane" style={{marginRight:4}}></i>{isAr ? 'إرسال' : 'Envoyer'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { CaporalSaisieTab };
