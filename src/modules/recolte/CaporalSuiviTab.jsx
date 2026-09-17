/* Module: recolte | Déclaration(s): CaporalSuiviTab */
import { PARCELLES_CULTURALES } from '../agronomie/PARCELLES_CULTURALES.jsx';
import { getCycle } from '../agronomie/getCycle.jsx';
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { MeteoAlertsDashboard } from '../technique/MeteoAlertsDashboard.jsx';

function CaporalSuiviTab({ data, farmFilter, avoSubFilter, onNavigateMeteo, readOnly }) {
            const [lang, setLang] = useState('fr');
            const isAr = lang === 'ar';
            const unite = isAr ? 'أنفاق' : 'tunnels';
            const [parcelles, setParcelles] = useState([]);
            const [normes, setNormes] = useState([]);
            const [progress, setProgress] = useState([]);
            const [saisies, setSaisies] = useState({});
            const [loading, setLoading] = useState(true);
            const [saving, setSaving] = useState(false);
            const [savedMsg, setSavedMsg] = useState('');
            const [showReexec, setShowReexec] = useState(null);
            const [reexecJustif, setReexecJustif] = useState('');
            const [reexecNb, setReexecNb] = useState('');

            const [pointageWorkers, setPointageWorkers] = useState({});
            const [affectations, setAffectations] = useState([]); // raw workers from pointage: [{parcelle, tache, nbOuvriers}]

            React.useEffect(() => {
                setLoading(true);
                const fq = farmFilter ? `&ferme=${farmFilter}` : '';
                Promise.all([
                    fetch(`/api/hors-recolte-suivi?action=get-parcelles-config${fq}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=get-normes${fq}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=get-progress${fq}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=get-saisies-today${fq}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=get-pointage-workers${fq}`).then(r => r.json()),
                ]).then(([parcRes, normRes, progRes, saisieRes, workersRes]) => {
                    if (parcRes.success) setParcelles(Array.isArray(parcRes.parcelles) ? parcRes.parcelles : []);
                    if (normRes.success) setNormes(normRes.normes || []);
                    if (progRes.success) setProgress(progRes.progress || []);

                    // Store raw affectations, enrich with normalizeParcelle + PARCELLES_CULTURALES
                    const rawWorkers = (workersRes.success && workersRes.workers) || [];
                    const enriched = rawWorkers.map(w => {
                        const sqlName = (w.parcelle || '').trim();
                        const norm = normalizeParcelle(sqlName);
                        const dn = norm ? (norm.sousVariete ? `${norm.variete} ${norm.sousVariete}` : norm.variete) : sqlName;
                        const pc = norm ? PARCELLES_CULTURALES.find(p => p.variete === norm.variete && p.ferme === norm.ferme && p.sousVariete === norm.sousVariete && p.cycle === getCycle(new Date().toISOString().slice(0,10))) : null;
                        return { ...w, displayName: dn, variete: norm ? norm.variete : '', nbTunnels: pc ? pc.nbTunnels : 0, sqlParcelle: sqlName };
                    });
                    setAffectations(enriched);
                    const pwMap = {};
                    enriched.forEach(w => { pwMap[`${w.displayName}__${w.tache}`] = w.nbOuvriers; });
                    setPointageWorkers(pwMap);

                    // Prefill saisies from today's saved data, then auto-fill nbOuvriers from pointage
                    const prefill = {};
                    const alreadySaved = new Set();
                    if (saisieRes.success) {
                        (saisieRes.saisies || []).forEach(s => {
                            const key = `${s.parcelle}__${s.tache}`;
                            prefill[key] = { nbRealise: s.nbRealise, nbOuvriers: s.nbOuvriers };
                            if (s.nbRealise > 0) alreadySaved.add(key);
                        });
                    }
                    Object.entries(pwMap).forEach(([key, nb]) => {
                        if (!prefill[key]) prefill[key] = { nbOuvriers: nb, fromPointage: true };
                        else if (!prefill[key].nbOuvriers) { prefill[key].nbOuvriers = nb; prefill[key].fromPointage = true; }
                    });
                    setSaisies(prefill);
                    setSavedKeys(alreadySaved);
                }).catch(() => {}).finally(() => setLoading(false));
            }, [farmFilter]);

            const getCumul = (parcelle, tache) => {
                const found = progress.find(p => p.parcelle === parcelle && p.tache === tache);
                return found || { totalRealise: 0, termine: false };
            };
            const getNorme = (tache) => {
                const found = normes.find(n => n.tache === tache);
                return found ? (found.normeParJourParOuvrier || found.normeTunnelsParJourParOuvrier || 0) : 0;
            };
            const updateSaisie = (parcelle, tache, field, val) => {
                setSaisies(prev => ({ ...prev, [`${parcelle}__${tache}`]: { ...(prev[`${parcelle}__${tache}`] || {}), [field]: val } }));
            };
            const [savedKeys, setSavedKeys] = useState(new Set());
            const [taskPopup, setTaskPopup] = useState(null);
            const handleSave = async (parcelle, tache, nbTotal) => {
                const key = `${parcelle}__${tache}`;
                const s = saisies[key];
                if (!s || !s.nbRealise) return;
                setSaving(true);
                try {
                    const resp = await fetch('/api/hors-recolte-suivi?action=saisie', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ferme: farmFilter, parcelle, tache, nbRealise: Number(s.nbRealise), nbOuvriers: Number(s.nbOuvriers) || 0, caporal: `caporal_${farmFilter.toLowerCase()}`, nbTotal }),
                    });
                    const json = await resp.json();
                    if (json.success) {
                        setProgress(prev => {
                            const idx = prev.findIndex(p => p.parcelle === parcelle && p.tache === tache);
                            const updated = { parcelle, tache, ferme: farmFilter, totalRealise: json.totalRealise, termine: json.termine };
                            if (idx >= 0) { const c = [...prev]; c[idx] = { ...c[idx], ...updated }; return c; }
                            return [...prev, updated];
                        });
                        setSavedKeys(prev => new Set([...prev, key]));
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
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ferme: farmFilter, parcelle: showReexec.parcelle, tache: showReexec.tache, justification: reexecJustif.trim(), nbTunnels: Number(reexecNb) || 0, caporal: `caporal_${farmFilter.toLowerCase()}` }),
                    });
                    setSavedMsg(isAr ? '��م إرسال الطلب' : 'Demande envoyée');
                    setTimeout(() => setSavedMsg(''), 2000);
                    setShowReexec(null); setReexecJustif(''); setReexecNb('');
                    window._refreshNotifications?.();
                } catch (e) {}
                setSaving(false);
            };

            const t = {
                title: isAr ? 'متابعة اليوم' : 'Suivi du Jour',
                tachesJour: isAr ? 'مهام اليوم' : 'Tâches du jour',
                avancementGlobal: isAr ? 'التقدم الإجمالي' : 'Avancement global',
                rendementMoyen: isAr ? 'المردود المتوسط' : 'Rendement moyen',
                realise: isAr ? 'المنجز اليوم' : `${unite} réalisés`,
                ouvriers: isAr ? 'العمال' : 'Ouvriers',
                norme: isAr ? 'المعيار' : 'Norme',
                rendement: isAr ? 'المردود' : 'Rendement',
                enregistrer: isAr ? 'حفظ' : 'Enregistrer',
                termine: isAr ? 'منتهية' : 'Terminée',
                demanderReexec: isAr ? 'طلب إعادة التنفيذ' : 'Demander re-exécution',
                total: isAr ? 'المجموع' : 'Total',
            };

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin fa-2x"></i><div style={{marginTop:12}}>Chargement suivi...</div></div>;

            const today = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

            // Group affectations by displayName for rendering
            const affectByParcelle = {};
            affectations.forEach(a => {
                const key = a.displayName || a.parcelle;
                if (!affectByParcelle[key]) affectByParcelle[key] = { tasks: [], variete: a.variete || '', nbTunnels: a.nbTunnels || 0 };
                affectByParcelle[key].tasks.push(a);
            });

            // Compute KPIs from affectations only
            let totalTaches = affectations.length, totalTunnels = 0, totalRealise = 0, rendementSum = 0, rendementCount = 0;
            const seenParcelles = new Set();
            affectations.forEach(a => {
                const dn = a.displayName || a.parcelle;
                if (!seenParcelles.has(dn)) {
                    seenParcelles.add(dn);
                    totalTunnels += a.nbTunnels || 0;
                }
                totalRealise += (getCumul(dn, a.tache).totalRealise || 0);
                const s = saisies[`${dn}__${a.tache}`] || {};
                const nb = Number(s.nbRealise) || 0, ouv = Number(s.nbOuvriers) || a.nbOuvriers || 0, nv = getNorme(a.tache);
                if (nb > 0 && ouv > 0 && nv > 0) { rendementSum += (nb / (ouv * nv)) * 100; rendementCount++; }
            });
            const globalPct = totalTunnels > 0 ? Math.round(totalRealise / totalTunnels * 100) : 0;
            const avgRendement = rendementCount > 0 ? Math.round(rendementSum / rendementCount) : 0;

            return (
                <div className="fade-in" dir={isAr ? 'rtl' : 'ltr'} style={{fontFamily: isAr ? "'Noto Sans Arabic', 'Segoe UI', Arial, sans-serif" : undefined}}>
                    {/* Météo Dashboard (Caporal only, not in Chef read-only) */}
                    {farmFilter && !readOnly && <MeteoAlertsDashboard farmFilter={avoSubFilter || farmFilter} onNavigateMeteo={onNavigateMeteo} />}

                    {/* Header */}
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

                    {/* KPI Cards */}
                    <div className="kpi-grid" style={{marginBottom:20}}>
                        <KPICard icon="fa-clipboard-list" iconClass="berry" value={totalTaches} label={t.tachesJour} />
                        <KPICard icon="fa-chart-pie" iconClass={globalPct >= 75 ? 'green' : globalPct >= 40 ? 'gold' : 'red'} value={`${globalPct}%`} label={t.avancementGlobal} />
                        <KPICard icon="fa-gauge-high" iconClass={avgRendement >= 100 ? 'green' : avgRendement >= 60 ? 'gold' : 'red'} value={avgRendement > 0 ? `${avgRendement}%` : '—'} label={t.rendementMoyen} />
                    </div>

                    {/* Per-parcelle cards — only parcelles with affectations today */}
                    {Object.keys(affectByParcelle).length === 0 ? (
                        <div style={{textAlign:'center',padding:24,color:'var(--gray-400)',fontSize:13}}>
                            <i className="fa-solid fa-inbox" style={{fontSize:24,marginBottom:8,display:'block'}}></i>
                            {isAr ? 'لا توجد مهام مسجلة في كشف اليوم' : 'Aucune affectation hors-récolte dans le pointage du jour'}
                        </div>
                    ) : Object.entries(affectByParcelle).map(([parcName, parcData], pi) => {
                        const nbTotal = parcData.nbTunnels || 0;
                        const variete = parcData.variete || '';
                        const tasks = parcData.tasks;
                        return (
                            <Panel key={pi} title={`${parcName} — ${variete}`} icon="fa-seedling">
                                <div style={{fontSize:10, color:'var(--gray-400)', marginBottom:10}}>{nbTotal > 0 ? `${t.total}: ${nbTotal} ${unite}` : ''} — {tasks.length} {isAr ? 'مهام' : 'tâche(s)'} — {tasks.reduce((s, tk) => s + tk.nbOuvriers, 0)} {t.ouvriers}</div>
                                <div style={{display:'flex', flexDirection:'column', gap:12}}>
                                    {tasks.map((aff, ni) => {
                                        const tacheName = aff.tache;
                                        const cumul = getCumul(parcName, tacheName);
                                        const saisie = saisies[`${parcName}__${tacheName}`] || {};
                                        const currentNb = Number(saisie.nbRealise) || 0;
                                        const totalAvecSaisie = cumul.totalRealise + currentNb;
                                        const pct = nbTotal > 0 ? Math.min(100, Math.round(totalAvecSaisie / nbTotal * 100)) : 0;
                                        const normeVal = getNorme(tacheName);
                                        const normeAttendu = (Number(saisie.nbOuvriers) || 0) * normeVal;
                                        const rendPct = normeAttendu > 0 ? Math.round(currentNb / normeAttendu * 100) : 0;
                                        const isTermine = cumul.termine || (nbTotal > 0 && totalAvecSaisie >= nbTotal);
                                        return (
                                            <div key={ni} style={{padding:12, background: isTermine ? 'rgba(46,204,113,0.05)' : 'var(--gray-50)', borderRadius:10, border: isTermine ? '1px solid rgba(46,204,113,0.3)' : '1px solid var(--gray-100)'}}>
                                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
                                                    <div style={{display:'flex', alignItems:'center', gap:8}}>
                                                        <span style={{fontSize:12, fontWeight:700}}>{tacheName}</span>
                                                        {isTermine && <span style={{fontSize:9, padding:'2px 8px', borderRadius:10, background:'var(--green)', color:'white', fontWeight:700}}>{t.termine}</span>}
                                                    </div>
                                                    <span style={{fontSize:10, color:'var(--gray-400)'}}>{t.norme}: {normeVal} {unite}/{isAr ? 'يوم/عامل' : 'jour/ouv.'}</span>
                                                </div>
                                                {/* Progress bar */}
                                                <div style={{marginBottom:10}}>
                                                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:3}}>
                                                        <span style={{fontSize:10, color:'var(--gray-500)'}}>{cumul.totalRealise}{currentNb > 0 ? ` + ${currentNb}` : ''} / {nbTotal} {unite}</span>
                                                        <span style={{fontSize:10, fontWeight:700, color: pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--berry)'}}>{pct}%</span>
                                                    </div>
                                                    <div style={{width:'100%', height:8, background:'var(--gray-200)', borderRadius:4, overflow:'hidden'}}>
                                                        <div style={{width:`${pct}%`, height:'100%', borderRadius:4, transition:'width 0.3s',
                                                            background: pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--berry)'}} />
                                                    </div>
                                                </div>
                                                {/* Input fields or terminée */}
                                                {!isTermine && !readOnly ? (
                                                    savedKeys.has(`${parcName}__${tacheName}`) ? (
                                                    /* Already saved — read-only display with Modifier button */
                                                    <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                                                        <span style={{fontSize:12, fontWeight:700, color:'var(--green)'}}>
                                                            <i className="fa-solid fa-check-circle" style={{marginRight:4}}></i>
                                                            {saisie.nbRealise} {unite}
                                                        </span>
                                                        <span style={{fontSize:10, color:'var(--gray-400)'}}>— {saisie.nbOuvriers || aff.nbOuvriers || 0} {t.ouvriers}</span>
                                                        {normeAttendu > 0 && (
                                                            <span style={{fontSize:10, padding:'3px 8px', borderRadius:8, fontWeight:700,
                                                                background: rendPct >= 100 ? 'rgba(46,204,113,0.1)' : rendPct >= 60 ? 'rgba(243,156,18,0.1)' : 'rgba(231,76,60,0.1)',
                                                                color: rendPct >= 100 ? 'var(--green)' : rendPct >= 60 ? 'var(--orange)' : 'var(--red)'}}>
                                                                {t.rendement}: {rendPct}%
                                                            </span>
                                                        )}
                                                        <button onClick={() => setSavedKeys(prev => { const n = new Set(prev); n.delete(`${parcName}__${tacheName}`); return n; })}
                                                            style={{padding:'5px 12px', background:'rgba(243,156,18,0.1)', color:'var(--orange)', border:'1px solid var(--orange)', borderRadius:8, fontSize:10, fontWeight:600, cursor:'pointer', marginLeft:'auto'}}>
                                                            <i className="fa-solid fa-pen" style={{marginRight:4}}></i>{isAr ? 'تعديل' : 'Modifier'}
                                                        </button>
                                                    </div>
                                                    ) : (
                                                    /* Editable form */
                                                    <div style={{display:'flex', gap:8, alignItems:'flex-end', flexWrap:'wrap'}}>
                                                        <div style={{flex:'0 0 100px'}}>
                                                            <label style={{fontSize:9, fontWeight:600, display:'block', marginBottom:3, color:'var(--gray-500)'}}>{t.realise}</label>
                                                            <input type="number" min="0" value={saisie.nbRealise || ''} onChange={e => updateSaisie(parcName, tacheName, 'nbRealise', e.target.value)}
                                                                placeholder="0" style={{width:'100%', padding:'6px 8px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12, textAlign:'center', fontWeight:700}} />
                                                        </div>
                                                        <div style={{flex:'0 0 80px'}}>
                                                            <label style={{fontSize:9, fontWeight:600, display:'block', marginBottom:3, color:'var(--gray-500)'}}>
                                                                {t.ouvriers}
                                                                <span style={{marginLeft:3, fontSize:7, padding:'1px 4px', borderRadius:4, background:'rgba(52,152,219,0.15)', color:'var(--blue)', fontWeight:700}}>Pointage</span>
                                                            </label>
                                                            <div style={{width:'100%', padding:'6px 8px', borderRadius:8, background:'var(--gray-50)', border:'1px solid rgba(52,152,219,0.3)', fontSize:12, textAlign:'center', fontWeight:700, color:'var(--blue)'}}>
                                                                {saisie.nbOuvriers || aff.nbOuvriers || 0}
                                                            </div>
                                                        </div>
                                                        {currentNb > 0 && normeAttendu > 0 && (
                                                            <span style={{fontSize:10, padding:'4px 10px', borderRadius:8, fontWeight:700,
                                                                background: rendPct >= 100 ? 'rgba(46,204,113,0.1)' : rendPct >= 80 ? 'rgba(52,152,219,0.1)' : rendPct >= 60 ? 'rgba(243,156,18,0.1)' : 'rgba(231,76,60,0.1)',
                                                                color: rendPct >= 100 ? 'var(--green)' : rendPct >= 80 ? 'var(--blue)' : rendPct >= 60 ? 'var(--orange)' : 'var(--red)'}}>
                                                                {t.rendement}: {rendPct}%
                                                            </span>
                                                        )}
                                                        <button onClick={() => handleSave(parcName, tacheName, nbTotal)} disabled={saving || !currentNb}
                                                            style={{padding:'6px 14px', background: currentNb ? 'var(--berry)' : 'var(--gray-200)', color: currentNb ? 'white' : 'var(--gray-400)',
                                                                border:'none', borderRadius:8, fontSize:11, fontWeight:600, cursor: currentNb ? 'pointer' : 'default', whiteSpace:'nowrap'}}>
                                                            <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-save'}`} style={{marginRight:4}}></i>{t.enregistrer}
                                                        </button>
                                                    </div>
                                                    )
                                                ) : readOnly ? (
                                                    /* Read-only summary for Chef */
                                                    <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                                                        {currentNb > 0 && (
                                                            <span style={{fontSize:12, fontWeight:700, color:'var(--green)'}}>
                                                                <i className="fa-solid fa-check-circle" style={{marginRight:4}}></i>{currentNb} {unite}
                                                            </span>
                                                        )}
                                                        <span style={{fontSize:10, color:'var(--gray-400)'}}>{saisie.nbOuvriers || aff.nbOuvriers || 0} {t.ouvriers}</span>
                                                        {normeAttendu > 0 && rendPct > 0 && (
                                                            <span style={{fontSize:10, padding:'3px 8px', borderRadius:8, fontWeight:700,
                                                                background: rendPct >= 100 ? 'rgba(46,204,113,0.1)' : rendPct >= 60 ? 'rgba(243,156,18,0.1)' : 'rgba(231,76,60,0.1)',
                                                                color: rendPct >= 100 ? 'var(--green)' : rendPct >= 60 ? 'var(--orange)' : 'var(--red)'}}>
                                                                {t.rendement}: {rendPct}%
                                                            </span>
                                                        )}
                                                        {isTermine && <span style={{fontSize:9, padding:'2px 8px', borderRadius:10, background:'var(--green)', color:'white', fontWeight:700}}>{t.termine}</span>}
                                                    </div>
                                                ) : (
                                                    <div style={{display:'flex', gap:8, alignItems:'center'}}>
                                                        <button onClick={() => { setShowReexec({ parcelle: parcName, tache: tacheName }); setReexecJustif(''); setReexecNb(''); }}
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
                        );
                    })}

                    {/* Re-execution modal */}
                    {showReexec && (
                        <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}
                            onClick={() => setShowReexec(null)}>
                            <div style={{background:'white', borderRadius:16, padding:24, maxWidth:420, width:'100%', boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <h3 style={{fontSize:16, fontWeight:800, marginBottom:4, color:'var(--orange)'}}>
                                    <i className="fa-solid fa-rotate-right" style={{marginRight:8}}></i>
                                    {isAr ? 'طلب إعادة التنفيذ' : 'Demande de re-exécution'}
                                </h3>
                                <div style={{fontSize:12, color:'var(--gray-500)', marginBottom:16}}>{showReexec.parcelle} — {showReexec.tache}</div>
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

                    {/* Tableau récapitulatif pour Chef (readOnly) */}
                    {/* Tableau récapitulatif + popup détail */}
                    {readOnly && Object.keys(affectByParcelle).length > 0 && (() => {
                        // Build all rows data for table + popup
                        const tableRows = [];
                        Object.entries(affectByParcelle).forEach(([pName, pData]) => {
                            pData.tasks.forEach(aff => {
                                const tn = aff.tache;
                                const cm = getCumul(pName, tn);
                                const sa = saisies[`${pName}__${tn}`] || {};
                                const nb = Number(sa.nbRealise) || 0;
                                const nbt = pData.nbTunnels || 0;
                                const tot = cm.totalRealise + nb;
                                const pc = nbt > 0 ? Math.min(100, Math.round(tot / nbt * 100)) : 0;
                                const nv = getNorme(tn);
                                const ouv = Number(sa.nbOuvriers) || aff.nbOuvriers || 0;
                                const rendement = ouv > 0 && nb > 0 ? Math.round(nb / ouv * 10) / 10 : 0;
                                const ecart = nv > 0 && rendement > 0 ? Math.round((rendement - nv) / nv * 100) : null;
                                // Find historique from progress
                                const progEntry = progress.find(p => p.parcelle === pName && p.tache === tn)
                                    || progress.find(p => p.parcelle === aff.sqlParcelle && p.tache === tn);
                                tableRows.push({ pName, tn, ouv, nb, cumul: cm.totalRealise, nbt, tot, pc, nv, rendement, ecart, historique: progEntry ? progEntry.historique : [] });
                            });
                        });
                        return (
                            <React.Fragment>
                            <Panel title={`Suivi Hors-Récolte ${farmFilter}`} icon="fa-chart-gantt">
                                <table className="data-table" style={{fontSize:11}}>
                                    <thead>
                                        <tr>
                                            <th>Parcelle</th>
                                            <th>Tâche</th>
                                            <th style={{textAlign:'center'}}>Ouv.</th>
                                            <th style={{textAlign:'right'}}>Réalisé</th>
                                            <th style={{textAlign:'right'}}>Cumul</th>
                                            <th style={{textAlign:'right'}}>Total</th>
                                            <th style={{width:100}}>Progression</th>
                                            <th style={{textAlign:'center'}}>Norme</th>
                                            <th style={{textAlign:'center'}}>Rendement</th>
                                            <th style={{textAlign:'center'}}>Écart</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tableRows.map((r, i) => (
                                            <tr key={i} style={{cursor:'pointer', background: r.pc >= 100 ? 'rgba(46,204,113,0.04)' : undefined}}
                                                onClick={() => setTaskPopup(r)}>
                                                <td style={{fontWeight:600}}>{r.pName}</td>
                                                <td style={{fontSize:10}}>{r.tn}</td>
                                                <td style={{textAlign:'center'}}>{r.ouv}</td>
                                                <td style={{textAlign:'right', fontWeight:600, color: r.nb > 0 ? 'var(--green)' : 'var(--gray-300)'}}>{r.nb}</td>
                                                <td style={{textAlign:'right', fontWeight:600}}>{r.cumul}</td>
                                                <td style={{textAlign:'right', color:'var(--gray-400)'}}>{r.nbt || '—'}</td>
                                                <td>
                                                    {r.nbt > 0 ? (
                                                        <div style={{display:'flex', alignItems:'center', gap:4}}>
                                                            <div style={{flex:1, height:6, background:'var(--gray-200)', borderRadius:3, overflow:'hidden'}}>
                                                                <div style={{width:`${r.pc}%`, height:'100%', borderRadius:3, background: r.pc >= 100 ? 'var(--green)' : r.pc >= 50 ? 'var(--orange)' : 'var(--berry)'}} />
                                                            </div>
                                                            <span style={{fontSize:8, fontWeight:700, color: r.pc >= 100 ? 'var(--green)' : r.pc >= 50 ? 'var(--orange)' : 'var(--berry)'}}>{r.pc}%</span>
                                                        </div>
                                                    ) : '—'}
                                                </td>
                                                <td style={{textAlign:'center', fontSize:9}}>
                                                    {r.nv > 0 ? <span style={{color:'var(--gray-500)'}}>{r.nv}</span> : <span style={{color:'var(--orange)', cursor:'pointer', textDecoration:'underline'}} onClick={e => { e.stopPropagation(); /* navigate to norme config */ }}>Définir</span>}
                                                </td>
                                                <td style={{textAlign:'center'}}>
                                                    {r.rendement > 0 ? <span style={{fontSize:11, fontWeight:700, color:'var(--dark)'}}>{r.rendement}</span> : '—'}
                                                </td>
                                                <td style={{textAlign:'center'}}>
                                                    {r.ecart !== null ? (
                                                        <span style={{fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:6,
                                                            background: r.ecart >= 0 ? 'rgba(46,204,113,0.1)' : 'rgba(231,76,60,0.1)',
                                                            color: r.ecart >= 0 ? 'var(--green)' : 'var(--red)'}}>
                                                            {r.ecart >= 0 ? '+' : ''}{r.ecart}%
                                                        </span>
                                                    ) : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div style={{fontSize:9, color:'var(--gray-400)', marginTop:8, textAlign:'center'}}>
                                    <i className="fa-solid fa-hand-pointer" style={{marginRight:4}}></i>Cliquez sur une ligne pour voir le détail historique
                                </div>
                            </Panel>

                            {/* Task detail popup with histogram + rendement curve */}
                            {taskPopup && (() => {
                                const hist = (taskPopup.historique || []).filter(h => h.nb > 0).sort((a, b) => a.date.localeCompare(b.date));
                                if (hist.length === 0) return (
                                    <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setTaskPopup(null)}>
                                        <div style={{background:'white',borderRadius:16,padding:24,maxWidth:500,width:'100%',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                            <h3 style={{fontSize:14,fontWeight:800,margin:'0 0 8px'}}>{taskPopup.pName} — {taskPopup.tn}</h3>
                                            <div style={{textAlign:'center',padding:24,color:'var(--gray-400)'}}>Aucun historique disponible</div>
                                            <button onClick={() => setTaskPopup(null)} style={{padding:'8px 16px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:8,fontSize:12,cursor:'pointer',marginTop:8}}>Fermer</button>
                                        </div>
                                    </div>
                                );
                                const maxNb = Math.max(...hist.map(h => h.nb), 1);
                                const norme = taskPopup.nv || 0;
                                const chartW = 500, chartH = 200, barW = Math.min(40, (chartW - 40) / hist.length - 4), padL = 30, padB = 30;
                                const innerW = chartW - padL - 10, innerH = chartH - padB - 10;
                                // Rendement per day
                                const rendPoints = hist.map((h, idx) => {
                                    const ouv = h.nbOuvriers || 1;
                                    const rend = Math.round(h.nb / ouv * 10) / 10;
                                    return { date: h.date, rend, x: padL + (idx + 0.5) * (innerW / hist.length), y: 10 + innerH - (rend / Math.max(maxNb, norme * 1.5, 1)) * innerH };
                                });
                                const maxY = Math.max(maxNb, norme * 1.5, 1);
                                const normeY = 10 + innerH - (norme / maxY) * innerH;
                                const rendLine = rendPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

                                return (
                                    <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setTaskPopup(null)}>
                                        <div style={{background:'white',borderRadius:16,padding:24,maxWidth:600,width:'100%',boxShadow:'0 20px 60px rgba(0,0,0,0.3)',maxHeight:'90vh',overflowY:'auto'}} onClick={e => e.stopPropagation()}>
                                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                                                <div>
                                                    <h3 style={{fontSize:14,fontWeight:800,margin:0,color:'var(--dark)'}}>{taskPopup.pName}</h3>
                                                    <div style={{fontSize:12,color:'var(--berry)',fontWeight:600}}>{taskPopup.tn}</div>
                                                </div>
                                                <div style={{textAlign:'right'}}>
                                                    {norme > 0 && <div style={{fontSize:10,color:'var(--gray-400)'}}>Norme: <strong>{norme}</strong> tunnels/ouv/jour</div>}
                                                    <div style={{fontSize:10,color:'var(--gray-400)'}}>{hist.length} jours enregistrés</div>
                                                </div>
                                            </div>

                                            {/* Chart */}
                                            <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{width:'100%',height:220}}>
                                                {/* Y axis labels */}
                                                {[0, 0.25, 0.5, 0.75, 1].map(f => {
                                                    const val = Math.round(maxY * f);
                                                    const y = 10 + innerH - f * innerH;
                                                    return <React.Fragment key={f}>
                                                        <line x1={padL} y1={y} x2={chartW - 10} y2={y} stroke="var(--gray-100)" strokeWidth={1} />
                                                        <text x={padL - 4} y={y + 3} textAnchor="end" fontSize={8} fill="var(--gray-400)">{val}</text>
                                                    </React.Fragment>;
                                                })}
                                                {/* Bars (tunnels per day) */}
                                                {hist.map((h, idx) => {
                                                    const barH = (h.nb / maxY) * innerH;
                                                    const x = padL + idx * (innerW / hist.length) + (innerW / hist.length - barW) / 2;
                                                    const y = 10 + innerH - barH;
                                                    return <React.Fragment key={idx}>
                                                        <rect x={x} y={y} width={barW} height={barH} rx={3} fill="var(--berry)" opacity={0.7} />
                                                        <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={8} fontWeight={700} fill="var(--dark)">{h.nb}</text>
                                                        <text x={x + barW / 2} y={chartH - 4} textAnchor="middle" fontSize={7} fill="var(--gray-400)">
                                                            {new Date(h.date + 'T12:00:00').toLocaleDateString('fr-FR', {day:'numeric', month:'short'})}
                                                        </text>
                                                    </React.Fragment>;
                                                })}
                                                {/* Norme line (dashed) */}
                                                {norme > 0 && <line x1={padL} y1={normeY} x2={chartW - 10} y2={normeY} stroke="var(--orange)" strokeWidth={1.5} strokeDasharray="6,3" />}
                                                {norme > 0 && <text x={chartW - 10} y={normeY - 4} textAnchor="end" fontSize={8} fill="var(--orange)" fontWeight={700}>Norme {norme}</text>}
                                                {/* Rendement curve (solid line) */}
                                                {rendPoints.length > 1 && <path d={rendLine} fill="none" stroke="var(--blue)" strokeWidth={2} />}
                                                {rendPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill="var(--blue)" />)}
                                            </svg>

                                            <div style={{display:'flex',gap:16,justifyContent:'center',marginTop:8,fontSize:10}}>
                                                <span><span style={{display:'inline-block',width:12,height:12,borderRadius:2,background:'var(--berry)',opacity:0.7,verticalAlign:'middle',marginRight:4}}></span>Tunnels réalisés</span>
                                                <span><span style={{display:'inline-block',width:12,height:2,background:'var(--blue)',verticalAlign:'middle',marginRight:4}}></span>Rendement/ouv</span>
                                                {norme > 0 && <span><span style={{display:'inline-block',width:12,height:0,borderTop:'2px dashed var(--orange)',verticalAlign:'middle',marginRight:4}}></span>Norme</span>}
                                            </div>

                                            {/* Detail table */}
                                            <table className="data-table" style={{fontSize:10,marginTop:16}}>
                                                <thead>
                                                    <tr>
                                                        <th>Date</th>
                                                        <th style={{textAlign:'center'}}>Tunnels</th>
                                                        <th style={{textAlign:'center'}}>Ouv.</th>
                                                        <th style={{textAlign:'center'}}>Rend./ouv</th>
                                                        {norme > 0 && <th style={{textAlign:'center'}}>vs Norme</th>}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {hist.map((h, i) => {
                                                        const o = h.nbOuvriers || 1;
                                                        const rd = Math.round(h.nb / o * 10) / 10;
                                                        const ec = norme > 0 ? Math.round((rd - norme) / norme * 100) : null;
                                                        return (
                                                            <tr key={i}>
                                                                <td>{new Date(h.date + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'short', day:'numeric', month:'short'})}</td>
                                                                <td style={{textAlign:'center', fontWeight:600}}>{h.nb}</td>
                                                                <td style={{textAlign:'center'}}>{h.nbOuvriers || '—'}</td>
                                                                <td style={{textAlign:'center', fontWeight:700, color:'var(--blue)'}}>{rd}</td>
                                                                {norme > 0 && <td style={{textAlign:'center'}}>
                                                                    <span style={{fontSize:9, fontWeight:700, color: ec >= 0 ? 'var(--green)' : 'var(--red)'}}>
                                                                        {ec >= 0 ? '+' : ''}{ec}%
                                                                    </span>
                                                                </td>}
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>

                                            <div style={{textAlign:'right',marginTop:12}}>
                                                <button onClick={() => setTaskPopup(null)} style={{padding:'8px 20px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:8,fontSize:12,cursor:'pointer',fontWeight:600}}>Fermer</button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                            </React.Fragment>
                        );
                    })()}
                </div>
            );
        }

export { CaporalSuiviTab };
