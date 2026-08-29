/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): ProductivityReportTab */
import { ProductivityBoxplotMultiSvg } from './ProductivityBoxplotMultiSvg.jsx';
import { ProductivityFarmSummaryBanner } from './ProductivityFarmSummaryBanner.jsx';
import { ProductivityTreatmentDetail } from './ProductivityTreatmentDetail.jsx';
import { ProductivityTreatmentsTable } from './ProductivityTreatmentsTable.jsx';

// ============================================================
        // Productivity Report — Driscoll's Grower Productivity weekly tracker
        // 3 vues : 1) synthèse semaine, 2) histogramme par traitement, 3) évolution hebdo
        // Source : Firestore collection productivity_reports
        // ============================================================
        function ProductivityReportTab({ data, currentProfile, userProfile }) {
            const [weeks, setWeeks] = React.useState([]);
            const [selectedWeekId, setSelectedWeekId] = React.useState(null);
            const [report, setReport] = React.useState(null);
            const [loading, setLoading] = React.useState(false);
            const [error, setError] = React.useState(null);
            const [farmFilter, setFarmFilter] = React.useState('both');
            const [categoryFilter, setCategoryFilter] = React.useState('all');
            const [selectedTreatmentTitle, setSelectedTreatmentTitle] = React.useState(null);
            const [trendData, setTrendData] = React.useState(null);
            const [refreshingFromEmail, setRefreshingFromEmail] = React.useState(false);
            const [refetchStatus, setRefetchStatus] = React.useState(null);

            const canTriggerRefetch = currentProfile === 'dg' || currentProfile === 'finance';
            const myFarm = currentProfile === 'chef_f1' ? 'F1' : currentProfile === 'chef_f5' ? 'F5' : null;

            React.useEffect(() => {
                let cancelled = false;
                (async () => {
                    try {
                        const r = await fetch('/api/email-analysis?action=productivity-list&limit=52');
                        const j = await r.json();
                        if (cancelled) return;
                        if (!j.success) { setError(j.error || 'Erreur chargement'); return; }
                        const items = (j.items || []).sort((a, b) => (b.week || 0) - (a.week || 0));
                        setWeeks(items);
                        if (items.length > 0 && !selectedWeekId) setSelectedWeekId(items[0].id);
                    } catch (e) {
                        if (!cancelled) setError(e.message);
                    }
                })();
                return () => { cancelled = true; };
            }, []); // eslint-disable-line

            React.useEffect(() => {
                if (!selectedWeekId) { setReport(null); return; }
                let cancelled = false;
                setLoading(true); setError(null);
                (async () => {
                    try {
                        const r = await fetch('/api/email-analysis?action=productivity-detail&id=' + encodeURIComponent(selectedWeekId));
                        const j = await r.json();
                        if (cancelled) return;
                        if (!j.success) { setError(j.error || 'Erreur'); setReport(null); }
                        else setReport(j.report);
                    } catch (e) { if (!cancelled) setError(e.message); }
                    finally { if (!cancelled) setLoading(false); }
                })();
                return () => { cancelled = true; };
            }, [selectedWeekId]);

            React.useEffect(() => {
                if (!selectedTreatmentTitle || !report) { setTrendData(null); return; }
                let cancelled = false;
                (async () => {
                    try {
                        const sameCampaign = weeks.filter(w => w.campaign === report.campaign).slice(0, 8);
                        const details = await Promise.all(sameCampaign.map(w =>
                            fetch('/api/email-analysis?action=productivity-detail&id=' + encodeURIComponent(w.id))
                                .then(r => r.json()).then(j => j.success ? j.report : null).catch(() => null)
                        ));
                        if (cancelled) return;
                        const series = details.filter(Boolean).map(rep => {
                            const t = (rep.treatments || []).find(x => x.title === selectedTreatmentTitle);
                            if (!t) return null;
                            return {
                                week: rep.week, campaign: rep.campaign,
                                average: t.average, top25Threshold: t.top25Threshold,
                                f1: t.f1, f5: t.f5,
                            };
                        }).filter(Boolean).sort((a, b) => a.week - b.week);
                        setTrendData(series);
                    } catch (e) { /* silent */ }
                })();
                return () => { cancelled = true; };
            }, [selectedTreatmentTitle, report, weeks]);

            const triggerRefetch = async (onlyNew) => {
                setRefreshingFromEmail(true); setRefetchStatus(null);
                try {
                    const token = firebaseAuth && firebaseAuth.currentUser ? await firebaseAuth.currentUser.getIdToken() : null;
                    const url = '/api/email-analysis?action=refetch-productivity' + (onlyNew ? '&onlyNew=1' : '');
                    const r = await fetch(url, { method: 'POST', headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
                    const j = await r.json();
                    setRefetchStatus(j.success ? `${j.processed} rapport(s) traité(s), ${j.skipped} ignoré(s)` : (j.error || 'Erreur'));
                    const l = await fetch('/api/email-analysis?action=productivity-list&limit=52').then(x => x.json());
                    if (l.success) setWeeks((l.items || []).sort((a, b) => (b.week || 0) - (a.week || 0)));
                } catch (e) { setRefetchStatus('Erreur : ' + e.message); }
                finally { setRefreshingFromEmail(false); }
            };

            const filteredTreatments = React.useMemo(() => {
                if (!report || !Array.isArray(report.treatments)) return [];
                return report.treatments.filter(t => {
                    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
                    if (farmFilter === 'F1' && !t.f1) return false;
                    if (farmFilter === 'F5' && !t.f5) return false;
                    if (farmFilter === 'both' && !t.f1 && !t.f5) return false;
                    if (myFarm === 'F1' && !t.f1) return false;
                    if (myFarm === 'F5' && !t.f5) return false;
                    return true;
                });
            }, [report, categoryFilter, farmFilter, myFarm]);

            return (
                <div style={{ padding: '16px', height: '100%', overflowY: 'auto', background: 'var(--gray-50, #f8f9fa)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                        <div>
                            <h2 style={{ margin: 0, color: 'var(--primary, #0a5d3d)' }}>
                                <i className="fa-solid fa-chart-line" style={{ marginRight: 8 }}></i>
                                Productivity Report — Driscoll's
                            </h2>
                            <div style={{ fontSize: 13, color: 'var(--gray-600, #6c757d)', marginTop: 4 }}>
                                Suivi hebdomadaire du classement F1 (172) et F5 (195) vs autres growers · Objectif : top 25 %
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <select value={selectedWeekId || ''} onChange={e => setSelectedWeekId(e.target.value)}
                                style={{ padding: '6px 10px', border: '1px solid var(--gray-300, #ced4da)', borderRadius: 6, fontSize: 14 }}>
                                {weeks.length === 0 && <option value="">— aucune semaine —</option>}
                                {weeks.map(w => <option key={w.id} value={w.id}>{w.campaign} · Week {w.week}</option>)}
                            </select>
                            {canTriggerRefetch && (
                                <React.Fragment>
                                    <button onClick={() => triggerRefetch(true)} disabled={refreshingFromEmail}
                                        style={{ padding: '6px 12px', background: 'var(--primary, #0a5d3d)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                                        <i className={refreshingFromEmail ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-envelope-open-text'} style={{ marginRight: 6 }}></i>
                                        Nouveaux emails
                                    </button>
                                    <button onClick={() => { if (confirm('Re-scanner TOUS les emails (backfill complet) ?')) triggerRefetch(false); }} disabled={refreshingFromEmail}
                                        style={{ padding: '6px 12px', background: '#fff', color: 'var(--primary, #0a5d3d)', border: '1px solid var(--primary, #0a5d3d)', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                                        <i className="fa-solid fa-rotate"></i> Backfill
                                    </button>
                                </React.Fragment>
                            )}
                        </div>
                    </div>

                    {refetchStatus && (
                        <div style={{ padding: '8px 12px', background: '#e7f5e7', border: '1px solid #5cb85c', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                            {refetchStatus}
                        </div>
                    )}
                    {error && (
                        <div style={{ padding: '8px 12px', background: '#fdecea', border: '1px solid #e74c3c', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                            <i className="fa-solid fa-triangle-exclamation"></i> {error}
                        </div>
                    )}
                    {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--gray-600)' }}><i className="fa-solid fa-spinner fa-spin"></i> Chargement…</div>}

                    {!loading && weeks.length === 0 && !error && (
                        <div style={{ padding: 30, textAlign: 'center', background: '#fff', borderRadius: 8, border: '1px solid var(--gray-300)' }}>
                            <i className="fa-solid fa-inbox fa-3x" style={{ color: 'var(--gray-400)', marginBottom: 12 }}></i>
                            <div style={{ fontSize: 16, fontWeight: 600 }}>Aucun rapport pour le moment</div>
                            <div style={{ fontSize: 13, color: 'var(--gray-600)', marginTop: 8 }}>
                                Les rapports Driscoll's "Grower productivity report" seront ingérés automatiquement à leur arrivée sur qualiteberrygoodfarms@gmail.com.
                            </div>
                            {canTriggerRefetch && (
                                <button onClick={() => triggerRefetch(false)} style={{ marginTop: 16, padding: '8px 18px', background: 'var(--primary, #0a5d3d)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                                    Scanner les emails existants
                                </button>
                            )}
                        </div>
                    )}

                    {report && !loading && (
                        <React.Fragment>
                            <ProductivityFarmSummaryBanner report={report} myFarm={myFarm} farmFilter={farmFilter} onFarmFilter={setFarmFilter} />

                            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                                {['all', 'raspberry', 'blackberry', 'strawberry', 'blueberry'].map(c => (
                                    <button key={c} onClick={() => setCategoryFilter(c)}
                                        style={{
                                            padding: '4px 12px', fontSize: 12, borderRadius: 16,
                                            border: '1px solid ' + (categoryFilter === c ? 'var(--primary, #0a5d3d)' : 'var(--gray-300)'),
                                            background: categoryFilter === c ? 'var(--primary, #0a5d3d)' : '#fff',
                                            color: categoryFilter === c ? '#fff' : 'var(--gray-700)',
                                            cursor: 'pointer', textTransform: 'capitalize',
                                        }}>
                                        {c === 'all' ? 'Toutes catégories' : c}
                                    </button>
                                ))}
                            </div>

                            <ProductivityTreatmentsTable
                                treatments={filteredTreatments}
                                myFarm={myFarm}
                                onSelectTreatment={setSelectedTreatmentTitle}
                                selectedTitle={selectedTreatmentTitle} />

                            <ProductivityBoxplotMultiSvg treatments={filteredTreatments} myFarm={myFarm} />

                            {selectedTreatmentTitle && (
                                <ProductivityTreatmentDetail
                                    treatment={filteredTreatments.find(t => t.title === selectedTreatmentTitle) || report.treatments.find(t => t.title === selectedTreatmentTitle)}
                                    trendSeries={trendData}
                                    onClose={() => setSelectedTreatmentTitle(null)} />
                            )}

                            <div style={{ marginTop: 24, padding: 10, fontSize: 11, color: 'var(--gray-500)', borderTop: '1px solid var(--gray-200)' }}>
                                Reçu : {report.receivedAt && new Date(report.receivedAt).toLocaleString('fr-FR')} · Modèle parser : {report.parser?.model || '—'} · {report.treatments.length} traitements
                                {report.parseWarnings && report.parseWarnings.length > 0 && (
                                    <span style={{ color: '#e67e22', marginLeft: 8 }}>· ⚠ {report.parseWarnings.join(', ')}</span>
                                )}
                            </div>
                        </React.Fragment>
                    )}
                </div>
            );
        }

export { ProductivityReportTab };
