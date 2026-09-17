/* Module: finance | Déclaration(s): FinTresorerieTab */
import { getSatFriWeek } from '../shared/getSatFriWeek.jsx';
import { useEffect, useMemo, useState } from '../shared/reactHooks.jsx';
import { tresoFmtDate } from './tresoFmtDate.jsx';
import { tresoFmtMAD } from './tresoFmtMAD.jsx';
import { tresoParseDMY } from './tresoParseDMY.jsx';

function FinTresorerieTab({ data, currentProfile }) {
            const canEdit = currentProfile === 'finance' || currentProfile === 'dg';
            const [items, setItems] = useState([]);
            const [itemsLoading, setItemsLoading] = useState(true);
            const [factures, setFactures] = useState([]);
            const [facturesLoading, setFacturesLoading] = useState(true);
            const [ojraSummary, setOjraSummary] = useState(null);
            const [showForm, setShowForm] = useState(false);
            const [editing, setEditing] = useState(null);
            const emptyForm = { type: 'loyer', libelle: '', beneficiaire: '', montant: '', recurrence: 'mensuelle', dateEcheance: '', jourDuMois: '', dateFin: '' };
            const [form, setForm] = useState(emptyForm);

            useEffect(() => {
                const db = firebase.firestore();
                const unsub = db.collection('tresorerie_items').onSnapshot(snap => {
                    const rows = [];
                    snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
                    setItems(rows.filter(r => r.actif !== false));
                    setItemsLoading(false);
                }, err => { console.warn('tresorerie_items snapshot error', err); setItemsLoading(false); });
                return () => unsub();
            }, []);

            useEffect(() => {
                fetch('/api/stock?action=list-factures').then(r => r.json())
                    .then(json => {
                        if (json.success) {
                            const all = json.factures || [];
                            const pending = all.filter(f => {
                                const s = String(f.payment_status || '').toLowerCase();
                                return s !== 'paye' && s !== 'payee' && s !== 'payée';
                            });
                            setFactures(pending);
                        }
                    })
                    .catch(err => console.warn('factures load error', err))
                    .finally(() => setFacturesLoading(false));
            }, []);

            useEffect(() => {
                fetch('/api/ojra?action=summary').then(r => r.json())
                    .then(json => { if (json.success) setOjraSummary(json); })
                    .catch(() => {});
            }, []);

            const weeks = useMemo(() => {
                const cur = getSatFriWeek(new Date());
                const arr = [];
                for (let i = 0; i < 9; i++) {
                    const start = new Date(cur.start);
                    start.setDate(cur.start.getDate() + i * 7);
                    arr.push(getSatFriWeek(start));
                }
                return arr;
            }, []);

            const expandedSorties = useMemo(() => {
                const out = [];
                if (!weeks.length) return out;
                const windowStart = weeks[0].start;
                const windowEnd = weeks[weeks.length - 1].end;
                items.forEach(it => {
                    const montant = Number(it.montant) || 0;
                    if (!montant) return;
                    if (it.recurrence === 'mensuelle') {
                        const jour = Math.min(Math.max(Number(it.jourDuMois) || 1, 1), 28);
                        const fin = it.dateFin ? new Date(it.dateFin) : null;
                        const start = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
                        for (let m = 0; m < 4; m++) {
                            const occ = new Date(start.getFullYear(), start.getMonth() + m, jour);
                            if (occ < windowStart || occ > windowEnd) continue;
                            if (fin && occ > fin) continue;
                            out.push({ date: occ, type: it.type, libelle: it.libelle, montant, beneficiaire: it.beneficiaire, id: it.id });
                        }
                    } else {
                        const dt = it.dateEcheance ? new Date(it.dateEcheance) : null;
                        if (!dt) return;
                        if (dt >= windowStart && dt <= windowEnd) {
                            out.push({ date: dt, type: it.type, libelle: it.libelle, montant, beneficiaire: it.beneficiaire, id: it.id });
                        }
                    }
                });
                return out;
            }, [items, weeks]);

            const weeklyRows = useMemo(() => {
                const liquidations = (data?.liquidations?.aVenir) || [];
                let cumul = 0;
                return weeks.map(w => {
                    const entrees = liquidations.reduce((sum, l) => {
                        const dt = tresoParseDMY(l.dateEstimee);
                        if (!dt) return sum;
                        if (dt >= w.start && dt <= w.end) return sum + (Number(l.montantEstime) || 0);
                        return sum;
                    }, 0);
                    const sortiesFactures = factures.reduce((sum, f) => {
                        const raw = f.date_echeance || f.date_facture || f.dateEcheance;
                        if (!raw) return sum;
                        const dt = new Date(raw);
                        if (isNaN(dt)) return sum;
                        if (dt >= w.start && dt <= w.end) return sum + (Number(f.total_ttc) || 0);
                        return sum;
                    }, 0);
                    const inWeek = expandedSorties.filter(s => s.date >= w.start && s.date <= w.end);
                    const sortiesLoyers = inWeek.filter(s => s.type === 'loyer').reduce((a, b) => a + b.montant, 0);
                    const sortiesPaie = inWeek.filter(s => s.type === 'paie').reduce((a, b) => a + b.montant, 0);
                    const sortiesAutres = inWeek.filter(s => s.type !== 'loyer' && s.type !== 'paie').reduce((a, b) => a + b.montant, 0);
                    const sorties = sortiesFactures + sortiesLoyers + sortiesPaie + sortiesAutres;
                    const net = entrees - sorties;
                    cumul += net;
                    return { week: w, entrees, sortiesFactures, sortiesLoyers, sortiesPaie, sortiesAutres, sorties, net, cumul };
                });
            }, [weeks, data, factures, expandedSorties]);

            const kpis = useMemo(() => {
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const in7 = new Date(today); in7.setDate(today.getDate() + 7);
                const retards = factures.reduce((sum, f) => {
                    const raw = f.date_echeance || f.dateEcheance;
                    if (!raw) return sum;
                    const dt = new Date(raw);
                    if (isNaN(dt)) return sum;
                    return dt < today ? sum + (Number(f.total_ttc) || 0) : sum;
                }, 0);
                const ech7j = factures.reduce((sum, f) => {
                    const raw = f.date_echeance || f.dateEcheance;
                    if (!raw) return sum;
                    const dt = new Date(raw);
                    if (isNaN(dt)) return sum;
                    return (dt >= today && dt <= in7) ? sum + (Number(f.total_ttc) || 0) : sum;
                }, 0) + expandedSorties.filter(s => s.date >= today && s.date <= in7).reduce((a, b) => a + b.montant, 0);
                const totalEntrees = weeklyRows.reduce((a, r) => a + r.entrees, 0);
                const soldeProj = weeklyRows.length ? weeklyRows[weeklyRows.length - 1].cumul : 0;
                return { retards, ech7j, totalEntrees, soldeProj };
            }, [factures, expandedSorties, weeklyRows]);

            const saveItem = () => {
                if (!canEdit) return;
                const db = firebase.firestore();
                const payload = {
                    type: form.type,
                    libelle: form.libelle.trim(),
                    beneficiaire: form.beneficiaire.trim(),
                    montant: Number(form.montant) || 0,
                    recurrence: form.recurrence,
                    dateEcheance: form.recurrence === 'unique' ? form.dateEcheance : null,
                    jourDuMois: form.recurrence === 'mensuelle' ? (Number(form.jourDuMois) || 1) : null,
                    dateFin: form.dateFin || null,
                    actif: true,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: currentProfile,
                };
                if (!payload.libelle || !payload.montant) { alert('Libellé et montant obligatoires.'); return; }
                const op = editing
                    ? db.collection('tresorerie_items').doc(editing).update(payload)
                    : db.collection('tresorerie_items').add({ ...payload, createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: currentProfile });
                op.then(() => { setShowForm(false); setEditing(null); setForm(emptyForm); })
                  .catch(err => alert('Erreur sauvegarde: ' + err.message));
            };
            const deleteItem = (id) => {
                if (!canEdit) return;
                if (!confirm('Supprimer cet élément ?')) return;
                firebase.firestore().collection('tresorerie_items').doc(id).update({ actif: false, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
                    .catch(err => alert('Erreur: ' + err.message));
            };
            const startEdit = (it) => {
                setEditing(it.id);
                setForm({
                    type: it.type || 'loyer',
                    libelle: it.libelle || '',
                    beneficiaire: it.beneficiaire || '',
                    montant: it.montant || '',
                    recurrence: it.recurrence || 'mensuelle',
                    dateEcheance: it.dateEcheance || '',
                    jourDuMois: it.jourDuMois || '',
                    dateFin: it.dateFin || '',
                });
                setShowForm(true);
            };

            const ojraNet = ojraSummary?.latest?.totalNet || ojraSummary?.latest?.total || 0;

            return (
                <div className="fade-in" style={{ padding: '16px 4px' }}>
                    <h3 style={{ margin: '0 0 16px' }}>
                        <i className="fa-solid fa-vault" style={{ marginRight: 8, color: 'var(--berry)' }}></i>
                        Trésorerie — Cash-flow prévisionnel
                    </h3>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
                        <div className="kpi-card" style={{ borderLeft: `4px solid ${kpis.soldeProj >= 0 ? 'var(--green)' : '#e74c3c'}` }}>
                            <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Solde net projeté (8 sem.)</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: kpis.soldeProj >= 0 ? 'var(--green)' : '#e74c3c', marginTop: 6 }}>{tresoFmtMAD(kpis.soldeProj)}</div>
                        </div>
                        <div className="kpi-card" style={{ borderLeft: '4px solid #e67e22' }}>
                            <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Échéances 7 prochains jours</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#e67e22', marginTop: 6 }}>{tresoFmtMAD(kpis.ech7j)}</div>
                        </div>
                        <div className="kpi-card" style={{ borderLeft: '4px solid #e74c3c' }}>
                            <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Factures en retard</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#e74c3c', marginTop: 6 }}>{tresoFmtMAD(kpis.retards)}</div>
                        </div>
                        <div className="kpi-card" style={{ borderLeft: '4px solid var(--berry)' }}>
                            <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Entrées Driscoll's attendues</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--berry)', marginTop: 6 }}>{tresoFmtMAD(kpis.totalEntrees)}</div>
                        </div>
                        {ojraNet > 0 && (
                            <div className="kpi-card" style={{ borderLeft: '4px solid #3498db' }}>
                                <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Dernière paie OJRA</div>
                                <div style={{ fontSize: 18, fontWeight: 700, color: '#3498db', marginTop: 6 }}>{tresoFmtMAD(ojraNet)}</div>
                                <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{ojraSummary?.latest?.period || ''}</div>
                            </div>
                        )}
                    </div>

                    <div style={{ marginBottom: 24 }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>
                            <i className="fa-solid fa-calendar-week" style={{ marginRight: 6 }}></i>
                            Calendrier hebdomadaire (Samedi → Vendredi, calendrier Driscoll's)
                        </h4>
                        {(facturesLoading || itemsLoading) && <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>Chargement…</div>}
                        <div className="table-responsive"><table className="data-table" style={{ fontSize: 12 }}>
                            <thead>
                                <tr>
                                    <th>Semaine</th>
                                    <th style={{ textAlign: 'right' }}>Entrées Driscoll's</th>
                                    <th style={{ textAlign: 'right' }}>Factures</th>
                                    <th style={{ textAlign: 'right' }}>Loyers</th>
                                    <th style={{ textAlign: 'right' }}>Paie</th>
                                    <th style={{ textAlign: 'right' }}>Autres</th>
                                    <th style={{ textAlign: 'right' }}>Solde net</th>
                                    <th style={{ textAlign: 'right' }}>Cumul</th>
                                </tr>
                            </thead>
                            <tbody>
                                {weeklyRows.map((r, i) => {
                                    const cumulColor = r.cumul >= 0 ? 'var(--green)' : '#e74c3c';
                                    return (
                                        <tr key={i} style={i === 0 ? { background: '#fff8e1' } : null}>
                                            <td style={{ fontWeight: 600 }}>{tresoFmtDate(r.week.start)} → {tresoFmtDate(r.week.end)}{i === 0 ? ' (en cours)' : ''}</td>
                                            <td style={{ textAlign: 'right', color: r.entrees > 0 ? 'var(--green)' : 'var(--gray-400)' }}>{r.entrees > 0 ? tresoFmtMAD(r.entrees) : '—'}</td>
                                            <td style={{ textAlign: 'right' }}>{r.sortiesFactures > 0 ? tresoFmtMAD(r.sortiesFactures) : '—'}</td>
                                            <td style={{ textAlign: 'right' }}>{r.sortiesLoyers > 0 ? tresoFmtMAD(r.sortiesLoyers) : '—'}</td>
                                            <td style={{ textAlign: 'right' }}>{r.sortiesPaie > 0 ? tresoFmtMAD(r.sortiesPaie) : '—'}</td>
                                            <td style={{ textAlign: 'right' }}>{r.sortiesAutres > 0 ? tresoFmtMAD(r.sortiesAutres) : '—'}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: r.net >= 0 ? 'var(--green)' : '#e74c3c' }}>{tresoFmtMAD(r.net)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 700, color: cumulColor }}>{tresoFmtMAD(r.cumul)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table></div>
                    </div>

                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <h4 style={{ margin: 0, fontSize: 14 }}>
                                <i className="fa-solid fa-list-check" style={{ marginRight: 6 }}></i>
                                Échéances & engagements ({items.length})
                            </h4>
                            {canEdit && (
                                <button onClick={() => { setEditing(null); setForm(emptyForm); setShowForm(!showForm); }} style={{ background: 'var(--berry)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                                    <i className={`fa-solid ${showForm ? 'fa-xmark' : 'fa-plus'}`} style={{ marginRight: 4 }}></i>{showForm ? 'Annuler' : 'Ajouter'}
                                </button>
                            )}
                        </div>

                        {showForm && canEdit && (
                            <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                                    <label style={{ fontSize: 11 }}>Type
                                        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} style={{ width: '100%', padding: 6 }}>
                                            <option value="loyer">Loyer</option>
                                            <option value="paie">Paie</option>
                                            <option value="echeance">Échéance (crédit, traite…)</option>
                                            <option value="autre">Autre</option>
                                        </select>
                                    </label>
                                    <label style={{ fontSize: 11 }}>Libellé *
                                        <input value={form.libelle} onChange={e => setForm({ ...form, libelle: e.target.value })} style={{ width: '100%', padding: 6 }} placeholder="Loyer bureau Casa" />
                                    </label>
                                    <label style={{ fontSize: 11 }}>Bénéficiaire
                                        <input value={form.beneficiaire} onChange={e => setForm({ ...form, beneficiaire: e.target.value })} style={{ width: '100%', padding: 6 }} />
                                    </label>
                                    <label style={{ fontSize: 11 }}>Montant (MAD) *
                                        <input type="number" value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })} style={{ width: '100%', padding: 6 }} />
                                    </label>
                                    <label style={{ fontSize: 11 }}>Récurrence
                                        <select value={form.recurrence} onChange={e => setForm({ ...form, recurrence: e.target.value })} style={{ width: '100%', padding: 6 }}>
                                            <option value="mensuelle">Mensuelle</option>
                                            <option value="unique">Unique</option>
                                        </select>
                                    </label>
                                    {form.recurrence === 'mensuelle' ? (
                                        <>
                                            <label style={{ fontSize: 11 }}>Jour du mois (1-28)
                                                <input type="number" min="1" max="28" value={form.jourDuMois} onChange={e => setForm({ ...form, jourDuMois: e.target.value })} style={{ width: '100%', padding: 6 }} />
                                            </label>
                                            <label style={{ fontSize: 11 }}>Date de fin (optionnel)
                                                <input type="date" value={form.dateFin} onChange={e => setForm({ ...form, dateFin: e.target.value })} style={{ width: '100%', padding: 6 }} />
                                            </label>
                                        </>
                                    ) : (
                                        <label style={{ fontSize: 11 }}>Date d'échéance *
                                            <input type="date" value={form.dateEcheance} onChange={e => setForm({ ...form, dateEcheance: e.target.value })} style={{ width: '100%', padding: 6 }} />
                                        </label>
                                    )}
                                </div>
                                <div style={{ marginTop: 10, textAlign: 'right' }}>
                                    <button onClick={saveItem} style={{ background: 'var(--green)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                                        <i className="fa-solid fa-check" style={{ marginRight: 4 }}></i>{editing ? 'Mettre à jour' : 'Enregistrer'}
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="table-responsive"><table className="data-table" style={{ fontSize: 12 }}>
                            <thead>
                                <tr>
                                    <th>Type</th>
                                    <th>Libellé</th>
                                    <th>Bénéficiaire</th>
                                    <th style={{ textAlign: 'right' }}>Montant</th>
                                    <th>Récurrence</th>
                                    <th>Prochaine échéance</th>
                                    {canEdit && <th>Actions</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 && (
                                    <tr><td colSpan={canEdit ? 7 : 6} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 24 }}>Aucun engagement enregistré.</td></tr>
                                )}
                                {items.map(it => {
                                    let prochaine = '—';
                                    if (it.recurrence === 'unique' && it.dateEcheance) {
                                        const dt = new Date(it.dateEcheance);
                                        prochaine = tresoFmtDate(dt) + '/' + dt.getFullYear();
                                    } else if (it.recurrence === 'mensuelle' && it.jourDuMois) {
                                        const today = new Date();
                                        const jour = Math.min(it.jourDuMois, 28);
                                        let next = new Date(today.getFullYear(), today.getMonth(), jour);
                                        if (next < today) next = new Date(today.getFullYear(), today.getMonth() + 1, jour);
                                        prochaine = tresoFmtDate(next) + '/' + next.getFullYear();
                                    }
                                    return (
                                        <tr key={it.id}>
                                            <td><span style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4, fontSize: 10, textTransform: 'uppercase' }}>{it.type}</span></td>
                                            <td style={{ fontWeight: 600 }}>{it.libelle}</td>
                                            <td>{it.beneficiaire || '—'}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{tresoFmtMAD(it.montant)}</td>
                                            <td>{it.recurrence === 'mensuelle' ? `Mensuelle (j${it.jourDuMois})` : 'Unique'}</td>
                                            <td>{prochaine}</td>
                                            {canEdit && (
                                                <td>
                                                    <button onClick={() => startEdit(it)} title="Modifier" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--berry)', marginRight: 6 }}><i className="fa-solid fa-pen"></i></button>
                                                    <button onClick={() => deleteItem(it.id)} title="Supprimer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e74c3c' }}><i className="fa-solid fa-trash"></i></button>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table></div>
                        <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 8 }}>
                            <i className="fa-solid fa-info-circle" style={{ marginRight: 4 }}></i>
                            Les factures fournisseurs et liquidations Driscoll's sont agrégées automatiquement. La paie peut être ajoutée comme item récurrent.
                        </div>
                    </div>
                </div>
            );
        }

export { FinTresorerieTab };
