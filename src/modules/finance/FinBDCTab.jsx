/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): FinBDCTab */
import { formatModePaiement } from '../caisse/formatModePaiement.jsx';
import { isModeVirement } from '../caisse/isModeVirement.jsx';
import { PROFILES } from '../shared/PROFILES.jsx';

import * as BdcWorkflow from '../shared/lib/bdcWorkflow.js';
// ===================== FINANCE: SUIVI BDC TAB =====================
        function FinBDCTab({ currentProfile }) {
            const [bdcList, setBdcList] = React.useState([]);
            const [loading, setLoading] = React.useState(true);
            const [filterFerme, setFilterFerme] = React.useState('');
            const [filterStatus, setFilterStatus] = React.useState('');
            const [expanded, setExpanded] = React.useState({});

            const FARMS = ['F1', 'F5', 'Avocatier'];
            const RELEVANT_BDC_STATUSES = ['en_attente_chef', 'en_attente_dg', 'valide_dg', 'envoye', 'virement_lance', 'virement_signe', 'rejete'];
            const STATUT_CFG = {
                en_attente_chef:  { label: 'Attente Chef',  color: '#d97706', bg: '#fffbeb' },
                en_attente_dg:    { label: 'Attente DG',    color: '#7c3aed', bg: '#f5f3ff' },
                valide_dg:        { label: 'Validé DG',     color: '#2563eb', bg: '#eff6ff' },
                envoye:           { label: 'Envoyé',          color: '#16a34a', bg: '#f0fdf4' },
                virement_lance:   { label: 'Virement Lancé',  color: '#0369a1', bg: '#e0f2fe' },
                virement_signe:   { label: 'Virement Signé',  color: '#7c3aed', bg: '#f5f3ff' },
                rejete:           { label: 'Rejeté',           color: '#dc2626', bg: '#fef2f2' },
                annule:           { label: 'Annulé',           color: '#6b7280', bg: '#f3f4f6' },
            };
            const STEP_DEFS = {
                creation:        { key: 'creation',        label: 'Créé',            icon: 'fa-plus-circle' },
                soumission:      { key: 'soumission',      label: 'Soumis',          icon: 'fa-paper-plane',  action: 'soumission' },
                validation_chef: { key: 'validation_chef', label: 'Chef',            icon: 'fa-user-check',   action: 'validation_chef' },
                validation_dg:   { key: 'validation_dg',   label: 'DG',              icon: 'fa-stamp',        action: 'validation_dg' },
                virement_lance:  { key: 'virement_lance',  label: 'Virement Lancé',  icon: 'fa-money-bill-transfer', action: 'virement_lance' },
                virement_signe:  { key: 'virement_signe',  label: 'Virement Signé',  icon: 'fa-signature',    action: 'virement_signe' },
                envoi:           { key: 'envoi',           label: 'Envoyé',          icon: 'fa-truck',        action: 'envoi_fournisseur' },
            };
            const getStepsForBdc = (bdc) => {
                const base = bdc.ferme === 'Avocatier'
                    ? ['creation', 'soumission', 'validation_dg']
                    : ['creation', 'soumission', 'validation_chef', 'validation_dg'];
                if (isModeVirement(bdc.mode_paiement)) {
                    return [...base, 'virement_lance', 'virement_signe', 'envoi'].map(k => STEP_DEFS[k]);
                }
                return [...base, 'envoi'].map(k => STEP_DEFS[k]);
            };

            const fmtDur = (ms) => {
                if (!ms || ms < 0) return null;
                const m = Math.round(ms / 60000);
                if (m < 60) return m + ' min';
                const h = Math.round(ms / 3600000);
                if (h < 24) return h + 'h';
                const d = Math.floor(ms / 86400000);
                if (d < 7) return d + 'j';
                return Math.floor(d / 7) + ' sem';
            };
            const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
            const fmtDateFull = (ts) => ts ? new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

            const getStepTimes = (bdc) => {
                const h = bdc.history || [];
                const getAt = (action) => { const e = h.find(x => x.action === action); return e ? (e.at || null) : null; };
                return {
                    creation: bdc.created_at || null,
                    soumission: getAt('soumission'),
                    validation_chef: getAt('validation_chef'),
                    validation_dg: getAt('validation_dg'),
                    envoi: getAt('envoi_fournisseur'),
                    virement_lance: getAt('virement_lance'),
                    virement_signe: getAt('virement_signe'),
                };
            };

            const getDurations = (times, bdc) => {
                const baseKeys = bdc?.ferme === 'Avocatier'
                    ? ['creation', 'soumission', 'validation_dg']
                    : ['creation', 'soumission', 'validation_chef', 'validation_dg'];
                const keys = isModeVirement(bdc?.mode_paiement)
                    ? [...baseKeys, 'virement_lance', 'virement_signe', 'envoi']
                    : [...baseKeys, 'envoi'];
                const result = {};
                for (let i = 1; i < keys.length; i++) {
                    const from = times[keys[i - 1]];
                    const to = times[keys[i]];
                    if (from && to) result[keys[i]] = to - from;
                    else if (from && !to) result[keys[i] + '_pending'] = Date.now() - from;
                }
                return result;
            };

            const getCurrentStep = (bdc) => {
                if (bdc.status === 'rejete') return 'rejete';
                if (bdc.status === 'envoye') return 'envoi';
                if (bdc.status === 'virement_signe') return 'virement_signe';
                if (bdc.status === 'virement_lance') return 'virement_lance';
                if (bdc.status === 'valide_dg') return 'validation_dg';
                if (bdc.status === 'en_attente_dg') return (BdcWorkflow && !BdcWorkflow.requiresChefValidation(bdc.ferme)) ? 'soumission' : 'validation_chef';
                if (bdc.status === 'en_attente_chef') return 'soumission';
                return 'creation';
            };

            const load = () => {
                setLoading(true);
                let url = '/api/stock?action=list-bdc&limit=500&status=' + RELEVANT_BDC_STATUSES.join(',');
                if (filterFerme) url += '&ferme=' + filterFerme;
                fetch(url).then(r => r.json()).then(j => { if (j.success) setBdcList(j.bdc || []); })
                    .catch(() => {}).finally(() => setLoading(false));
            };
            React.useEffect(() => { load(); }, [filterFerme]);

            const filteredBdc = bdcList
                .filter(b => RELEVANT_BDC_STATUSES.includes(b.status))
                .filter(b => !filterStatus || b.status === filterStatus);

            const counts = {
                en_cours: filteredBdc.filter(b => ['en_attente_chef', 'en_attente_dg'].includes(b.status)).length,
                valides_dg: filteredBdc.filter(b => b.status === 'valide_dg').length,
                envoyes: filteredBdc.filter(b => b.status === 'envoye').length,
                virement_lance: filteredBdc.filter(b => b.status === 'virement_lance').length,
                virement_signe: filteredBdc.filter(b => b.status === 'virement_signe').length,
                rejetes: filteredBdc.filter(b => b.status === 'rejete').length,
            };
            const completedBdc = filteredBdc.filter(b => b.status === 'envoye');
            const avgDurMs = completedBdc.length
                ? completedBdc.reduce((sum, b) => {
                    const t = getStepTimes(b);
                    return sum + (t.envoi && t.creation ? t.envoi - t.creation : 0);
                }, 0) / completedBdc.length
                : null;

            if (loading) return React.createElement('div', { style: { textAlign: 'center', padding: 60 } },
                React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 32, color: 'var(--berry)' } }));

            return (
                <div className="fade-in">
                    {/* KPI + Filtres */}
                    <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                        {[
                            { label: 'En validation', val: counts.en_cours,   color: '#d97706', bg: '#fffbeb', icon: 'fa-hourglass-half' },
                            { label: 'Validés DG',    val: counts.valides_dg, color: '#2563eb', bg: '#eff6ff', icon: 'fa-stamp' },
                            { label: 'Envoyés',       val: counts.envoyes,    color: '#16a34a', bg: '#f0fdf4', icon: 'fa-truck' },
                            { label: 'Rejetés',       val: counts.rejetes,    color: '#dc2626', bg: '#fef2f2', icon: 'fa-xmark-circle' },
                            avgDurMs ? { label: 'Délai moy.', val: fmtDur(avgDurMs), color: '#7c3aed', bg: '#f5f3ff', icon: 'fa-clock' } : null,
                        ].filter(Boolean).map(s => (
                            <div key={s.label} style={{ background: s.bg, border: '1px solid ' + s.color + '33', borderRadius: 10, padding: '8px 16px', textAlign: 'center', minWidth: 90 }}>
                                <i className={'fa-solid ' + s.icon} style={{ color: s.color, fontSize: 14, marginBottom: 3 }} />
                                <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.val}</div>
                                <div style={{ fontSize: 10, color: '#666' }}>{s.label}</div>
                            </div>
                        ))}
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            {['', ...FARMS].map(f => (
                                <button key={f} onClick={() => setFilterFerme(f)} className={`chip c-berry ${filterFerme === f ? 'active' : ''}`}>
                                    {f || 'Toutes'}
                                </button>
                            ))}
                            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 11 }}>
                                <option value="">Tous statuts</option>
                                {Object.entries(STATUT_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                        </div>
                    </div>

                    {filteredBdc.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>
                            <i className="fa-solid fa-file-contract" style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
                            Aucun BDC à afficher
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {filteredBdc.map(bdc => {
                                const cfg = STATUT_CFG[bdc.status] || { label: bdc.status, color: '#64748b', bg: '#f1f5f9' };
                                const times = getStepTimes(bdc);
                                const durations = getDurations(times, bdc);
                                const currentStep = getCurrentStep(bdc);
                                const STEPS = getStepsForBdc(bdc);
                                const isExpanded = expanded[bdc.id];
                                const isRejected = bdc.status === 'rejete';
                                const rejectEntry = (bdc.history || []).slice().reverse().find(h => h.action?.includes('rejet'));

                                return (
                                    <div key={bdc.id} style={{ background: '#fff', border: '1.5px solid ' + (isRejected ? '#fca5a5' : '#e2e8f0'), borderRadius: 12, overflow: 'hidden' }}>
                                        {/* Header cliquable */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', gap: 12 }} onClick={() => setExpanded(e => ({ ...e, [bdc.id]: !e[bdc.id] }))}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                <span style={{ fontWeight: 700, color: 'var(--berry)', fontSize: 13 }}>{bdc.numero}</span>
                                                <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{cfg.label}</span>
                                                <span style={{ fontSize: 12, color: '#64748b' }}>{bdc.fournisseur?.nom || '—'}</span>
                                                <span style={{ background: '#f1f5f9', color: '#475569', borderRadius: 6, padding: '1px 6px', fontSize: 11 }}>{bdc.ferme}</span>
                                                {bdc.purchase_request_id && <span style={{ background: '#eff6ff', color: '#2563eb', borderRadius: 6, padding: '1px 6px', fontSize: 11 }}><i className="fa-solid fa-file-pen" style={{ marginRight: 3 }} />DA liée</span>}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                <span style={{ fontWeight: 700, fontSize: 14 }}>{(bdc.total_ttc || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} MAD</span>
                                                <i className={'fa-solid ' + (isExpanded ? 'fa-chevron-up' : 'fa-chevron-down')} style={{ color: '#94a3b8', fontSize: 12 }} />
                                            </div>
                                        </div>

                                        {/* Timeline */}
                                        <div style={{ padding: '8px 16px 12px', borderTop: '1px solid #f1f5f9', background: '#fafbfc' }}>
                                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                                {STEPS.map((step, idx) => {
                                                    const stepAt = idx === 0 ? times.creation : times[step.key];
                                                    const isDone = !!stepAt;
                                                    const isCurrent = step.key === currentStep && !isRejected;
                                                    const dur = idx > 0 ? (durations[step.key] || durations[step.key + '_pending']) : null;
                                                    const isPending = idx > 0 && !durations[step.key] && !!durations[step.key + '_pending'];
                                                    const dotColor = isRejected && isCurrent ? '#dc2626' : isDone ? '#16a34a' : isCurrent ? '#d97706' : '#d1d5db';

                                                    return (
                                                        <React.Fragment key={step.key}>
                                                            {idx > 0 && (
                                                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
                                                                    {dur ? <div style={{ fontSize: 10, color: isPending ? '#d97706' : '#64748b', fontWeight: 600, marginBottom: 2, whiteSpace: 'nowrap' }}>{isPending ? '⟳ ' : ''}{fmtDur(dur)}</div> : <div style={{ fontSize: 10, color: '#d1d5db', marginBottom: 2 }}>—</div>}
                                                                    <div style={{ height: 2, width: '100%', background: isDone ? '#16a34a' : '#e2e8f0' }} />
                                                                </div>
                                                            )}
                                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                                                <div style={{ width: 26, height: 26, borderRadius: '50%', background: dotColor, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: isCurrent ? '0 0 0 3px ' + dotColor + '33' : 'none' }}>
                                                                    <i className={'fa-solid ' + step.icon} style={{ color: isDone || isCurrent ? '#fff' : '#9ca3af', fontSize: 10 }} />
                                                                </div>
                                                                <div style={{ fontSize: 10, color: isDone ? '#1e293b' : '#9ca3af', fontWeight: isDone ? 600 : 400, whiteSpace: 'nowrap' }}>{step.label}</div>
                                                                {stepAt && <div style={{ fontSize: 9, color: '#94a3b8' }}>{fmtDate(stepAt)}</div>}
                                                            </div>
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </div>
                                            {isRejected && rejectEntry && (
                                                <div style={{ marginTop: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#dc2626' }}>
                                                    <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }} />
                                                    Rejeté par <b>{rejectEntry.by?.name || '—'}</b>{rejectEntry.comment ? ` — "${rejectEntry.comment}"` : ''}
                                                </div>
                                            )}
                                        </div>

                                        {/* Détail expandable */}
                                        {isExpanded && (
                                            <div style={{ padding: '12px 16px 16px', borderTop: '1px solid #f1f5f9' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
                                                    <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Créé le</div><div style={{ fontWeight: 600, fontSize: 12 }}>{fmtDateFull(bdc.created_at)}</div></div>
                                                    <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Créé par</div><div style={{ fontWeight: 600, fontSize: 12 }}>{bdc.created_by?.name || '—'}</div></div>
                                                    <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Livraison prévue</div><div style={{ fontWeight: 600, fontSize: 12 }}>{bdc.date_livraison_prevue || '—'}</div></div>
                                                    {bdc.code_analytique && <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Code analytique</div><div style={{ fontWeight: 600, fontSize: 12, fontFamily: 'monospace' }}>{bdc.code_analytique}</div></div>}
                                                    {bdc.mode_paiement && <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Paiement</div><div style={{ fontWeight: 600, fontSize: 12 }}>{formatModePaiement(bdc.mode_paiement)}</div></div>}
                                                    {bdc.validated_by_chef && <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Validé Chef</div><div style={{ fontWeight: 600, fontSize: 12, color: '#16a34a' }}>{bdc.validated_by_chef.name}</div><div style={{ fontSize: 10, color: '#94a3b8' }}>{fmtDateFull(bdc.validated_by_chef.at)}</div></div>}
                                                    {bdc.validated_by_dg && <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Validé DG</div><div style={{ fontWeight: 600, fontSize: 12, color: '#2563eb' }}>{bdc.validated_by_dg.name}</div><div style={{ fontSize: 10, color: '#94a3b8' }}>{fmtDateFull(bdc.validated_by_dg.at)}</div></div>}
                                                    {bdc.notified_finance && <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '6px 10px' }}><div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}><i className="fa-solid fa-circle-check" style={{ marginRight: 4 }} />Transmis Finance</div><div style={{ fontSize: 10, color: '#94a3b8' }}>{fmtDateFull(bdc.notified_finance_at)}</div></div>}
                                                </div>
                                                {/* Articles */}
                                                <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>Articles ({bdc.items?.length || 0})</div>
                                                <div style={{ overflowX: 'auto' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                                        <thead><tr style={{ background: '#f8fafc' }}>
                                                            {['Article', 'Qté', 'PU', 'TVA', 'TTC'].map(h => <th key={h} style={{ padding: '5px 8px', textAlign: h === 'Article' ? 'left' : 'right', borderBottom: '1px solid #e2e8f0' }}>{h}</th>)}
                                                        </tr></thead>
                                                        <tbody>
                                                            {(bdc.items || []).map((it, i) => (
                                                                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                                    <td style={{ padding: '5px 8px', fontWeight: 600 }}>{it.article}</td>
                                                                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>{it.quantite} {it.unite}</td>
                                                                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>{(parseFloat(it.prix_unitaire) || 0).toFixed(2)}</td>
                                                                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>{it.taux_tva}%</td>
                                                                    <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700 }}>{(it.montant_ttc || 0).toFixed(2)} MAD</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                        <tfoot><tr style={{ background: '#f8fafc' }}>
                                                            <td colSpan={4} style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right' }}>Total TTC</td>
                                                            <td style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--berry)', textAlign: 'right' }}>{(bdc.total_ttc || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} MAD</td>
                                                        </tr></tfoot>
                                                    </table>
                                                </div>
                                                {/* Pièce jointe (scan BDC) */}
                                                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Scan BDC :</span>
                                                    {window.ScanAttachmentButton && <window.ScanAttachmentButton entityType="purchase_orders" entityId={bdc.id} scanUrl={bdc.scan_url} scanPath={bdc.scan_path} uploadedBy={{ profileId: currentProfile }} onUploaded={() => load()} />}
                                                </div>
                                                {/* Durées détaillées */}
                                                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                    {[
                                                        { label: 'Soumission',      dur: durations.soumission },
                                                        { label: 'Valid. Chef',     dur: durations.validation_chef },
                                                        { label: 'Valid. DG',       dur: durations.validation_dg },
                                                        { label: 'Envoi',           dur: durations.envoi },
                                                        { label: 'Vir. Lancé',      dur: durations.virement_lance },
                                                        { label: 'Vir. Signé',      dur: durations.virement_signe },
                                                    ].filter(d => d.dur).map(d => (
                                                        <div key={d.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '5px 12px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: 10, color: '#94a3b8' }}>{d.label}</div>
                                                            <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 13 }}>{fmtDur(d.dur)}</div>
                                                        </div>
                                                    ))}
                                                    {times.creation && times.envoi && (
                                                        <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 8, padding: '5px 12px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: 10, color: '#2563eb' }}>Total cycle</div>
                                                            <div style={{ fontWeight: 700, color: '#2563eb', fontSize: 13 }}>{fmtDur((times.virement_signe || times.virement_lance || times.envoi) - times.creation)}</div>
                                                        </div>
                                                    )}
                                                </div>
                                                {/* Bouton Lancer virement (Finance) — disponible dès Validé DG pour Comptant–Virement */}
                                                {bdc.status === 'valide_dg' && isModeVirement(bdc.mode_paiement) && currentProfile === 'finance' && (
                                                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
                                                        <button onClick={(e) => { e.stopPropagation(); if (!confirm('Confirmer le lancement du virement pour ' + bdc.numero + ' ?')) return;
                                                            fetch('/api/stock?action=update-bdc-virement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ id: bdc.id, decision: 'lancer', by: { profileId: currentProfile, name: PROFILES.find(p=>p.id===currentProfile)?.name || currentProfile } })
                                                            }).then(r=>r.json()).then(j=>{ if(j.success) { load(); window._refreshNotifications?.(); } else alert('Erreur: '+(j.error||'Echec')); }).catch(()=>alert('Erreur réseau'));
                                                        }} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#0369a1', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                                                            <i className="fa-solid fa-money-bill-transfer" style={{ marginRight: 6 }}></i>Lancer le virement
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            );
        }

export { FinBDCTab };
