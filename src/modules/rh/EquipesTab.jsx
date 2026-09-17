/* Module: rh | Déclaration(s): EquipesTab */
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { WorkerLink } from './WorkerLink.jsx';

// ===================== NEW RH TABS =====================
        // Onglet RH "Équipes" : gestion versionnée des primes de transport par équipe.
        // Persistance Firestore : rh_config/transport_primes
        function EquipesTab({ data }) {
            // Roster = équipes réellement configurées (primes rh_config). Les effectifs et la détection
            // des équipes actives viennent des VRAIS matricules ouvriers (/api/pointage-rh?action=transport),
            // pas du seed. On ne garde que les équipes avec un historique de prime OU des ouvriers réels.
            const buildAllTeams = () => {
                const byPrefix = {};
                (data.transportConfig || []).forEach(t => {
                    byPrefix[t.prefix] = {
                        prefix: t.prefix,
                        equipe: t.equipe || `Équipe ${t.prefix}`,
                        caporal: t.caporal || '',
                        ferme: t.ferme || '',
                        coutParOuvrier: t.coutParOuvrier || 0,
                        history: Array.isArray(t.history) ? [...t.history] : [],
                    };
                });
                return Object.values(byPrefix).sort((a, b) => a.prefix.localeCompare(b.prefix));
            };

            const [teams, setTeams] = useState(buildAllTeams);
            const [detailRows, setDetailRows] = useState([]);
            const [workerPopup, setWorkerPopup] = useState(null);
            const [editingTeam, setEditingTeam] = useState(null);
            const [editForm, setEditForm] = useState({ prefix: '', equipe: '', caporal: '', ferme: '', coutParOuvrier: 30, effectiveFrom: '' });
            const [expandedHistory, setExpandedHistory] = useState(null);
            const [saving, setSaving] = useState(false);
            const [saveMsg, setSaveMsg] = useState(null);
            const [filterFerme, setFilterFerme] = useState('');
            const [apiPeriodes, setApiPeriodes] = useState([]);
            const [apiTransportPeriodes, setApiTransportPeriodes] = useState([]);

            // Re-sync teams quand data.transportConfig change (= override Firestore appliqué)
            // Évite que teams reste figé sur le seed alors que data a été enrichi de l'historique
            React.useEffect(() => {
                if (saving || editingTeam) return; // ne pas écraser une édition en cours
                setTeams(buildAllTeams());
            // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [data.transportConfig]);

            // Charge la liste réelle des quinzaines depuis l'API pointage
            React.useEffect(() => {
                if (typeof cachedFetch !== 'function') return;
                cachedFetch('/api/pointage-rh?action=recolte-equipes')
                    .then(json => { if (json && json.success && Array.isArray(json.periodes)) setApiPeriodes(json.periodes); })
                    .catch(() => {});
            }, []);

            // Charge les VRAIS ouvriers (matricules) pour calculer effectifs réels + détecter les équipes actives.
            React.useEffect(() => {
                if (typeof cachedFetch !== 'function') return;
                cachedFetch('/api/pointage-rh?action=transport')
                    .then(json => {
                        if (json && json.success && Array.isArray(json.rows)) setDetailRows(json.rows);
                        if (json && json.success && Array.isArray(json.periodes)) setApiTransportPeriodes(json.periodes);
                    })
                    .catch(() => {});
            }, []);

            // Préfixe d'équipe depuis un matricule. Code équipe = 2 LETTRES (AY, CA, HA, MM, NA, NF, LA…).
            // 3 lettres réduites à 2 (HAFI→HA, MMG→MM). Matricule SANS préfixe-lettre (numérique 752…,
            // vide) → équipe BGF (prime 0). Ne renvoie jamais null : tout ouvrier est rattaché à une équipe.
            const getEqPrefix = (mat) => {
                const m = String(mat || '').toUpperCase().trim();
                if (m.startsWith('HAFI')) return 'HA';
                const p2 = m.substring(0, 2);
                if (p2 === 'BG') return 'BGF';
                return /^[A-Z]{2}$/.test(p2) ? p2 : 'BGF';
            };

            // Génère les N dernières quinzaines (1-15 / 16-fin) au format canonique
            // « DD/MM/YYYY - DD/MM/YYYY » (cohérent avec data.quinzaineOrder + history[].effectiveFrom).
            const genQuinzaines = (count) => {
                const out = [];
                const fmt = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
                const now = new Date();
                let y = now.getFullYear(), m = now.getMonth(); // m = 0..11
                let isSecond = now.getDate() >= 16;
                for (let i = 0; i < count; i++) {
                    let start, end;
                    if (isSecond) {
                        start = new Date(y, m, 16);
                        end = new Date(y, m + 1, 0); // dernier jour du mois
                    } else {
                        start = new Date(y, m, 1);
                        end = new Date(y, m, 15);
                    }
                    out.push(`${fmt(start)} - ${fmt(end)}`);
                    // recule d'une quinzaine
                    if (isSecond) { isSecond = false; }
                    else { isSecond = true; m -= 1; if (m < 0) { m = 11; y -= 1; } }
                }
                return out;
            };

            // Quinzaine en cours : on privilégie la VRAIE quinzaine renvoyée par l'API transport
            // (libellé Driscoll's réel porté par detailRows), sinon fallback sur génération locale.
            const currentPeriode = apiTransportPeriodes[0] || genQuinzaines(1)[0] || '';

            // Liste COMPLÈTE des quinzaines : on FUSIONNE TOUJOURS les périodes de l'API
            // (apiPeriodes / recolteData / pointageJour) avec une génération des 18 dernières
            // quinzaines (~9 mois), pas seulement en fallback. La quinzaine en cours reste en tête.
            const knownPeriodes = (() => {
                const set = new Set();
                set.add(currentPeriode);
                apiPeriodes.forEach(p => { if (p) set.add(p); });
                (data.recolteData || []).forEach(r => { if (r.periode) set.add(r.periode); });
                (data.pointageJour || []).forEach(r => { if (r.periode) set.add(r.periode); });
                genQuinzaines(18).forEach(p => { if (p) set.add(p); });
                return [...set].sort((a, b) => (data.quinzaineOrder ? data.quinzaineOrder(b) - data.quinzaineOrder(a) : 0));
            })();

            const openEdit = (team) => {
                setEditForm({ prefix: team.prefix, equipe: team.equipe, caporal: team.caporal, ferme: team.ferme, coutParOuvrier: team.coutParOuvrier || 30, effectiveFrom: currentPeriode });
                setEditingTeam({ team, mode: 'edit' });
            };
            const openAdd = () => {
                setEditForm({ prefix: '', equipe: '', caporal: '', ferme: '', coutParOuvrier: 30, effectiveFrom: currentPeriode });
                setEditingTeam({ team: null, mode: 'add' });
            };
            // Bouton explicite « Soumettre nouveau tarif » : choisir une équipe existante puis le tarif.
            const openSubmit = () => {
                setEditForm({ prefix: '', equipe: '', caporal: '', ferme: '', coutParOuvrier: 30, effectiveFrom: currentPeriode });
                setEditingTeam({ team: null, mode: 'submit' });
            };
            // Quand on choisit une équipe dans le mode « submit », pré-remplit le formulaire.
            const onPickEquipe = (prefix) => {
                const t = teams.find(x => x.prefix === prefix);
                setEditForm(f => ({ ...f, prefix, equipe: t ? t.equipe : '', caporal: t ? t.caporal : '', ferme: t ? t.ferme : '', coutParOuvrier: (t && t.coutParOuvrier) || 30 }));
            };
            // Historique des tarifs d'une équipe sur les 6 derniers mois (par date d'effet), récent→ancien.
            // Date réelle d'une entrée d'historique : date d'effet (« JJ/MM/AAAA … ») sinon date de modif.
            // Robuste au mélange de formats d'étiquette (« Quinzaine NN » n'a pas de date parsable → updatedAt).
            const histEffDate = (h) => {
                const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec((h && h.effectiveFrom) || '');
                if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
                return (h && h.updatedAt) ? new Date(h.updatedAt) : null;
            };
            const histSortDesc = (a, b) => {
                const da = histEffDate(a), db = histEffDate(b);
                return (db ? db.getTime() : 0) - (da ? da.getTime() : 0); // plus récent en haut
            };
            const histLast6Months = (prefix) => {
                const t = teams.find(x => x.prefix === prefix);
                if (!t || !Array.isArray(t.history)) return [];
                const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 6);
                return [...t.history]
                    .filter(h => { const d = histEffDate(h); return d ? d >= cutoff : true; })
                    .sort(histSortDesc);
            };

            // Synchronise data.transportConfig en mémoire pour que les autres écrans (lecture seule)
            // et l'expand historique reflètent la modif sans recharger la page.
            const syncDataInMemory = (nextTeams) => {
                nextTeams.forEach(t => {
                    if (!t.history || t.history.length === 0) return;
                    const sortedHist = [...t.history].sort((a, b) => (data.quinzaineOrder ? data.quinzaineOrder(b.effectiveFrom) - data.quinzaineOrder(a.effectiveFrom) : 0));
                    const latest = sortedHist[0];
                    const existing = (data.transportConfig || []).find(x => x.prefix === t.prefix);
                    if (existing) {
                        existing.history = [...t.history];
                        existing.coutParOuvrier = latest.coutParOuvrier;
                        existing.equipe = t.equipe;
                        existing.caporal = t.caporal;
                        existing.ferme = t.ferme;
                    } else {
                        (data.transportConfig || []).push({ prefix: t.prefix, equipe: t.equipe, caporal: t.caporal, ferme: t.ferme, coutParOuvrier: latest.coutParOuvrier, history: [...t.history] });
                    }
                });
            };

            // Écriture client (bloc complet) — utilisée uniquement pour la SUPPRESSION d'une version.
            const persist = async (nextTeams) => {
                setSaving(true);
                setSaveMsg(null);
                try {
                    const userEmail = (firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser.email : 'unknown';
                    const payload = {
                        equipes: nextTeams.filter(t => (t.history && t.history.length > 0)).map(t => ({
                            prefix: t.prefix, equipe: t.equipe, caporal: t.caporal, ferme: t.ferme, history: t.history,
                        })),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: userEmail,
                    };
                    await firebase.firestore().collection('rh_config').doc('transport_primes').set(payload, { merge: false });
                    syncDataInMemory(nextTeams);
                    setSaveMsg({ ok: true, txt: 'Enregistré ✓' });
                } catch (e) {
                    console.error(e);
                    setSaveMsg({ ok: false, txt: 'Erreur : ' + (e.message || e) });
                } finally {
                    setSaving(false);
                    setTimeout(() => setSaveMsg(null), 4000);
                }
            };

            // Soumission d'un tarif (ajout/édition) → via la Cloud Function unique (transport-config-apply)
            // qui écrit dans rh_config/transport_primes ET prévient le DG par WhatsApp si AUGMENTATION.
            const applyChange = async () => {
                if (!editForm.effectiveFrom) { alert("Choisissez une quinzaine d'effet."); return; }
                const targetPrefix = (editingTeam.mode === 'edit')
                    ? editingTeam.team.prefix
                    : (editForm.prefix || '').toUpperCase();
                if (!targetPrefix) { alert(editingTeam.mode === 'add' ? 'Préfixe requis.' : 'Choisissez une équipe.'); return; }
                const cout = Number(editForm.coutParOuvrier);
                if (isNaN(cout) || cout < 0) { alert('Montant invalide.'); return; }
                const existingTeam = teams.find(t => t.prefix === targetPrefix);
                const isAdd = !existingTeam;
                // Ancien tarif = tarif courant de l'équipe, 0 par défaut (nouvelle équipe / non configurée).
                const oldCout = existingTeam ? (existingTeam.coutParOuvrier || 0) : 0;
                const userEmail = (firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser.email : 'unknown';
                const newEntry = { effectiveFrom: editForm.effectiveFrom, coutParOuvrier: cout, updatedAt: new Date().toISOString(), updatedBy: userEmail };
                let nextTeams;
                if (isAdd) {
                    nextTeams = [...teams, { prefix: targetPrefix, equipe: editForm.equipe || `Équipe ${targetPrefix}`, caporal: editForm.caporal, ferme: editForm.ferme, coutParOuvrier: cout, history: [newEntry], effectif: 0 }].sort((a, b) => a.prefix.localeCompare(b.prefix));
                } else {
                    nextTeams = teams.map(t => {
                        if (t.prefix !== targetPrefix) return t;
                        const filteredHist = (t.history || []).filter(h => !(h.effectiveFrom === newEntry.effectiveFrom && h.coutParOuvrier === newEntry.coutParOuvrier));
                        return { ...t, equipe: editForm.equipe || t.equipe, caporal: editForm.caporal, ferme: editForm.ferme, coutParOuvrier: cout, history: [...filteredHist, newEntry] };
                    });
                }
                setSaving(true);
                setSaveMsg(null);
                try {
                    // Toujours via 'modifier_prix' (avec oldCout, 0 si nouvelle équipe) → le backend crée
                    // l'équipe si besoin ET prévient le DG par WhatsApp dès que newCout > oldCout (donc 0 → X).
                    const body = { changeType: 'modifier_prix', effectiveFrom: editForm.effectiveFrom, data: { prefix: targetPrefix, equipe: editForm.equipe || (existingTeam ? existingTeam.equipe : `Équipe ${targetPrefix}`), caporal: editForm.caporal, ferme: editForm.ferme, oldCout, newCout: cout } };
                    const res = await fetch('/api/validation?action=transport-config-apply', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
                    });
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error || 'échec');
                    setTeams(nextTeams);
                    syncDataInMemory(nextTeams);
                    setEditingTeam(null);
                    const augmente = cout > oldCout;
                    setSaveMsg({ ok: true, txt: augmente ? 'Enregistré ✓ — augmentation : le DG a été prévenu par WhatsApp' : 'Enregistré ✓' });
                } catch (e) {
                    console.error(e);
                    setSaveMsg({ ok: false, txt: 'Erreur : ' + (e.message || e) });
                } finally {
                    setSaving(false);
                    setTimeout(() => setSaveMsg(null), 4000);
                }
            };

            const removeHistEntry = async (prefix, entry) => {
                if (!confirm(`Supprimer la version du ${entry.effectiveFrom} (${entry.coutParOuvrier} MAD) ?`)) return;
                const nextTeams = teams.map(t => t.prefix === prefix ? { ...t, history: (t.history || []).filter(h => !(h.effectiveFrom === entry.effectiveFrom && h.updatedAt === entry.updatedAt)) } : t);
                setTeams(nextTeams);
                await persist(nextTeams);
            };

            const fermes = ['F1', 'F5', 'Avocatier'];

            // Ouvriers RÉELS par préfixe d'équipe (quinzaine en cours) : { prefix → { matricule → {matricule, nom, jh} } }.
            const workersByPrefix = (() => {
                const map = {};
                detailRows.forEach(r => {
                    if (currentPeriode && r.periode !== currentPeriode) return;
                    if (filterFerme && r.ferme !== filterFerme) return;
                    const eq = getEqPrefix(r.matricule);
                    if (!eq) return;
                    if (!map[eq]) map[eq] = {};
                    if (!map[eq][r.matricule]) map[eq][r.matricule] = { matricule: r.matricule, nom: r.nom || r.matricule, jh: 0 };
                    map[eq][r.matricule].jh += 1;
                });
                return map;
            })();
            const effectifByPrefix = (() => {
                const out = {};
                Object.keys(workersByPrefix).forEach(p => { out[p] = Object.keys(workersByPrefix[p]).length; });
                return out;
            })();
            const openWorkers = (t) => {
                const workers = Object.values(workersByPrefix[t.prefix] || {}).sort((a, b) => b.jh - a.jh);
                setWorkerPopup({ equipe: t.equipe, caporal: t.caporal || '—', cout: fmtCout(t) || 0, workers });
            };

            // Roster affiché = équipes configurées (primes) ∪ équipes détectées via vrais matricules,
            // en ne gardant que celles avec une prime (historique) OU des ouvriers réels (effectif > 0).
            // → élimine les fausses équipes seed 01–08 sans données réelles.
            const filteredTeams = (() => {
                const byPrefix = {};
                teams.forEach(t => { byPrefix[t.prefix] = { ...t, effectif: effectifByPrefix[t.prefix] || 0 }; });
                Object.keys(effectifByPrefix).forEach(p => {
                    if (!byPrefix[p]) byPrefix[p] = { prefix: p, equipe: p === 'BGF' ? 'BGF' : `Équipe ${p}`, caporal: '', ferme: '', coutParOuvrier: 0, history: [], effectif: effectifByPrefix[p] };
                });
                return Object.values(byPrefix)
                    .filter(t => (t.history && t.history.length > 0) || t.effectif > 0)
                    .filter(t => !filterFerme || t.ferme === filterFerme || (!t.ferme && t.effectif > 0))
                    // BGF (fourre-tout sans préfixe) toujours en dernier
                    .sort((a, b) => (a.prefix === 'BGF' ? 1 : b.prefix === 'BGF' ? -1 : a.prefix.localeCompare(b.prefix)));
            })();
            const fmtCout = (t) => {
                // Pas d'historique → fallback sur le seed coutParOuvrier (équipes hardcodées)
                if (!t.history || t.history.length === 0) {
                    return (t.coutParOuvrier && t.coutParOuvrier > 0) ? t.coutParOuvrier : null;
                }
                const target = currentPeriode ? (data.quinzaineOrder ? data.quinzaineOrder(currentPeriode) : 0) : Number.MAX_SAFE_INTEGER;
                const applicable = [...t.history].filter(h => (data.quinzaineOrder ? data.quinzaineOrder(h.effectiveFrom) : 0) <= target).sort((a, b) => (data.quinzaineOrder ? data.quinzaineOrder(b.effectiveFrom) - data.quinzaineOrder(a.effectiveFrom) : 0))[0];
                return applicable ? applicable.coutParOuvrier : (t.coutParOuvrier || t.history[t.history.length - 1].coutParOuvrier);
            };

            return (
                <div className="fade-in" style={{padding:'8px 0'}}>
                    <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:14,flexWrap:'wrap'}}>
                        <h2 style={{margin:0,fontSize:18,color:'var(--berry)'}}>
                            <i className="fa-solid fa-people-group" style={{marginRight:8}}></i>Équipes — Primes de transport
                        </h2>
                        <span style={{fontSize:11,color:'var(--gray-500)'}}>
                            Quinzaine en cours : <strong>{currentPeriode || '—'}</strong>
                        </span>
                        <div style={{flex:1}}></div>
                        <select value={filterFerme} onChange={e => setFilterFerme(e.target.value)} style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}}>
                            <option value="">Toutes fermes</option>
                            {fermes.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <button onClick={openSubmit} style={{padding:'8px 14px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                            <i className="fa-solid fa-money-bill-trend-up" style={{marginRight:6}}></i>Soumettre nouveau tarif
                        </button>
                        <button onClick={openAdd} style={{padding:'8px 14px',borderRadius:8,border:'1px solid var(--berry)',background:'#fff',color:'var(--berry)',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                            <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Ajouter équipe
                        </button>
                    </div>

                    <div style={{padding:'10px 14px',background:'rgba(139,34,82,0.06)',border:'1px solid rgba(139,34,82,0.15)',borderRadius:8,fontSize:11,color:'var(--gray-600)',marginBottom:12,lineHeight:1.5}}>
                        <i className="fa-solid fa-circle-info" style={{color:'var(--berry)',marginRight:6}}></i>
                        Chaque modification s'applique <strong>à partir de la quinzaine choisie</strong> sans recalculer les quinzaines précédentes.
                        Cliquez sur une prime pour la modifier ; cliquez sur l'icône <i className="fa-solid fa-clock-rotate-left"></i> pour voir l'historique.
                    </div>

                    {saveMsg && (
                        <div style={{padding:'8px 12px',borderRadius:8,marginBottom:10,fontSize:12,fontWeight:600,background: saveMsg.ok ? 'rgba(46,204,113,0.1)' : 'rgba(231,76,60,0.1)',color: saveMsg.ok ? '#27ae60' : '#c0392b',border: saveMsg.ok ? '1px solid rgba(46,204,113,0.3)' : '1px solid rgba(231,76,60,0.3)'}}>
                            {saveMsg.txt}
                        </div>
                    )}

                    <div className="table-responsive">
                        <table className="data-table" style={{fontSize:12}}>
                            <thead>
                                <tr>
                                    <th style={{width:60}}>Préfixe</th>
                                    <th>Équipe</th>
                                    <th>Caporal</th>
                                    <th style={{width:90}}>Ferme</th>
                                    <th style={{width:70,textAlign:'right'}}>Effectif</th>
                                    <th style={{width:170,textAlign:'right'}}>Prime transport (MAD/ouv.)</th>
                                    <th style={{width:60,textAlign:'center'}}>Hist.</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTeams.map(t => {
                                    const cout = fmtCout(t);
                                    const isExpanded = expandedHistory === t.prefix;
                                    return (
                                        <React.Fragment key={t.prefix}>
                                            <tr>
                                                <td><strong>{t.prefix}</strong></td>
                                                <td style={{fontWeight:600,color:'var(--blue)',cursor:'pointer'}} onClick={() => openWorkers(t)} title="Voir les ouvriers">{t.equipe} <i className="fa-solid fa-users" style={{fontSize:9,marginLeft:4,color:'var(--gray-400)'}}></i></td>
                                                <td style={{color:'var(--gray-600)'}}>{t.caporal || '—'}</td>
                                                <td>{t.ferme || '—'}</td>
                                                <td style={{textAlign:'right'}}>{t.effectif || '—'}</td>
                                                <td style={{textAlign:'right'}}>
                                                    <span onClick={() => openEdit(t)} style={{cursor:'pointer',padding:'4px 10px',borderRadius:6,background: cout != null ? 'rgba(139,34,82,0.08)' : 'rgba(243,156,18,0.15)',color: cout != null ? 'var(--berry)' : '#E67E22',fontWeight:700,borderBottom:'1px dashed currentColor'}} title={cout != null ? 'Cliquez pour modifier' : 'Tarif par défaut 0 — cliquez pour configurer'}>
                                                        {cout != null ? `${cout} MAD` : '0 MAD'}
                                                    </span>
                                                </td>
                                                <td style={{textAlign:'center'}}>
                                                    <button onClick={() => setExpandedHistory(isExpanded ? null : t.prefix)} style={{background:'transparent',border:'none',cursor:'pointer',color:'var(--gray-500)',fontSize:14}} title="Historique">
                                                        <i className={`fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-clock-rotate-left'}`}></i>
                                                        {(t.history && t.history.length > 0) && <span style={{fontSize:10,marginLeft:4,color:'var(--berry)',fontWeight:700}}>{t.history.length}</span>}
                                                    </button>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr>
                                                    <td colSpan={7} style={{background:'var(--gray-50)',padding:12}}>
                                                        {(!t.history || t.history.length === 0) ? (
                                                            <div style={{fontSize:11,color:'var(--gray-500)',fontStyle:'italic'}}>Aucun historique — cette équipe n'a jamais eu de prime configurée.</div>
                                                        ) : (
                                                            <table style={{width:'100%',fontSize:11}}>
                                                                <thead>
                                                                    <tr style={{color:'var(--gray-500)',textAlign:'left'}}>
                                                                        <th style={{padding:'4px 8px'}}>Quinzaine d'effet</th>
                                                                        <th style={{padding:'4px 8px',textAlign:'right'}}>Montant</th>
                                                                        <th style={{padding:'4px 8px'}}>Modifié par</th>
                                                                        <th style={{padding:'4px 8px'}}>Le</th>
                                                                        <th style={{padding:'4px 8px',width:30}}></th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {[...t.history].sort(histSortDesc).map((h, i) => (
                                                                        <tr key={i}>
                                                                            <td style={{padding:'4px 8px'}}>{h.effectiveFrom}</td>
                                                                            <td style={{padding:'4px 8px',textAlign:'right',fontWeight:600,color:'var(--berry)'}}>{h.coutParOuvrier} MAD</td>
                                                                            <td style={{padding:'4px 8px',color:'var(--gray-600)'}}>{h.updatedBy || '—'}</td>
                                                                            <td style={{padding:'4px 8px',color:'var(--gray-500)'}}>{h.updatedAt ? new Date(h.updatedAt).toLocaleDateString('fr-FR') : '—'}</td>
                                                                            <td style={{padding:'4px 8px'}}>
                                                                                <button onClick={() => removeHistEntry(t.prefix, h)} style={{background:'transparent',border:'none',cursor:'pointer',color:'#c0392b',fontSize:12}} title="Supprimer cette version">
                                                                                    <i className="fa-solid fa-trash"></i>
                                                                                </button>
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        )}
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {editingTeam && (
                        <div className="modal-overlay" onClick={() => !saving && setEditingTeam(null)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:480}}>
                                <h3 style={{margin:'0 0 16px',fontSize:16}}>
                                    <i className={`fa-solid ${editingTeam.mode === 'submit' ? 'fa-money-bill-trend-up' : 'fa-truck'}`} style={{color:'var(--berry)',marginRight:8}}></i>
                                    {editingTeam.mode === 'add' ? 'Nouvelle équipe' : editingTeam.mode === 'submit' ? 'Soumettre un nouveau tarif' : `Modifier prime — ${editingTeam.team.equipe} (${editingTeam.team.prefix})`}
                                </h3>
                                <div style={{display:'flex',flexDirection:'column',gap:14}}>
                                    {editingTeam.mode === 'add' && (
                                        <div>
                                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Préfixe (2 caractères)</label>
                                            <input type="text" maxLength={2} value={editForm.prefix} onChange={e => setEditForm({...editForm, prefix: e.target.value.toUpperCase()})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box',textTransform:'uppercase'}} />
                                        </div>
                                    )}
                                    {editingTeam.mode === 'submit' && (
                                        <div>
                                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Équipe</label>
                                            <select value={editForm.prefix} onChange={e => onPickEquipe(e.target.value)} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box'}}>
                                                <option value="">— Choisir une équipe —</option>
                                                {[...teams].sort((a,b)=>a.prefix.localeCompare(b.prefix)).map(t => <option key={t.prefix} value={t.prefix}>{t.prefix} — {t.equipe}{t.caporal ? ` (${t.caporal})` : ''}</option>)}
                                            </select>
                                        </div>
                                    )}
                                    {editingTeam.mode !== 'submit' && (
                                    <div>
                                        <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Nom de l'équipe</label>
                                        <input type="text" value={editForm.equipe} onChange={e => setEditForm({...editForm, equipe: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box'}} />
                                    </div>
                                    )}
                                    {editingTeam.mode !== 'submit' && (
                                    <div>
                                        <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Caporal / Responsable</label>
                                        <input type="text" value={editForm.caporal} onChange={e => setEditForm({...editForm, caporal: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box'}} />
                                    </div>
                                    )}
                                    {editingTeam.mode !== 'submit' && (
                                    <div>
                                        <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Ferme</label>
                                        <select value={editForm.ferme} onChange={e => setEditForm({...editForm, ferme: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box'}}>
                                            <option value="">—</option>
                                            {fermes.map(f => <option key={f} value={f}>{f}</option>)}
                                        </select>
                                    </div>
                                    )}
                                    <div style={{display:'flex',gap:10}}>
                                        <div style={{flex:1}}>
                                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Coût transport / ouvrier (MAD)</label>
                                            <input type="number" min={0} step={5} value={editForm.coutParOuvrier} onChange={e => setEditForm({...editForm, coutParOuvrier: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box'}} />
                                        </div>
                                        <div style={{flex:1.4}}>
                                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>À partir de la quinzaine</label>
                                            <select value={editForm.effectiveFrom} onChange={e => setEditForm({...editForm, effectiveFrom: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box'}}>
                                                {knownPeriodes.length === 0 && <option value="">— Aucune quinzaine connue —</option>}
                                                {knownPeriodes.map(p => <option key={p} value={p}>{p}{p === currentPeriode ? ' (en cours)' : ''}</option>)}
                                            </select>
                                            <div style={{fontSize:10,color:'var(--gray-500)',marginTop:4}}>Les quinzaines antérieures ne seront pas affectées.</div>
                                        </div>
                                    </div>
                                    {editingTeam.mode !== 'add' && editForm.prefix && (() => {
                                        const h6 = histLast6Months(editForm.prefix);
                                        return (
                                            <div style={{borderTop:'1px solid var(--gray-100)',paddingTop:10}}>
                                                <div style={{fontSize:11,fontWeight:600,color:'var(--gray-600)',marginBottom:6}}>
                                                    <i className="fa-solid fa-clock-rotate-left" style={{marginRight:6,color:'var(--berry)'}}></i>Tarifs des 6 derniers mois
                                                </div>
                                                {h6.length === 0 ? (
                                                    <div style={{fontSize:11,color:'var(--gray-400)',fontStyle:'italic'}}>Aucun tarif enregistré sur les 6 derniers mois.</div>
                                                ) : (
                                                    <table style={{width:'100%',fontSize:11}}>
                                                        <thead><tr style={{color:'var(--gray-500)',textAlign:'left'}}>
                                                            <th style={{padding:'3px 6px'}}>Quinzaine d'effet</th>
                                                            <th style={{padding:'3px 6px',textAlign:'right'}}>Montant</th>
                                                            <th style={{padding:'3px 6px'}}>Le</th>
                                                        </tr></thead>
                                                        <tbody>
                                                            {h6.map((h, i) => (
                                                                <tr key={i}>
                                                                    <td style={{padding:'3px 6px'}}>{h.effectiveFrom}</td>
                                                                    <td style={{padding:'3px 6px',textAlign:'right',fontWeight:600,color:'var(--berry)'}}>{h.coutParOuvrier} MAD</td>
                                                                    <td style={{padding:'3px 6px',color:'var(--gray-500)'}}>{h.updatedAt ? new Date(h.updatedAt).toLocaleDateString('fr-FR') : '—'}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>
                                <div style={{display:'flex',justifyContent:'flex-end',gap:10,marginTop:20}}>
                                    <button onClick={() => setEditingTeam(null)} disabled={saving} style={{padding:'8px 20px',borderRadius:8,border:'1px solid var(--gray-200)',background:'#fff',fontSize:13,cursor:'pointer'}}>Annuler</button>
                                    <button onClick={applyChange} disabled={saving} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',fontSize:13,fontWeight:600,cursor: saving ? 'wait' : 'pointer',opacity: saving ? 0.6 : 1}}>
                                        {saving ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Enregistrement…</> : (editingTeam.mode === 'add' ? 'Créer' : 'Soumettre le tarif')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {workerPopup && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setWorkerPopup(null)}>
                            <div style={{background:'#fff',borderRadius:12,maxWidth:600,width:'100%',maxHeight:'80vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{padding:'16px 20px',borderBottom:'2px solid var(--gray-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                    <div>
                                        <h3 style={{margin:0,fontSize:16,color:'var(--berry)'}}><i className="fa-solid fa-users" style={{marginRight:8}}></i>{workerPopup.equipe}</h3>
                                        <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>Caporal: {workerPopup.caporal} — {workerPopup.cout} MAD/ouvrier</div>
                                    </div>
                                    <button onClick={() => setWorkerPopup(null)} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--gray-400)'}}>&times;</button>
                                </div>
                                <div style={{padding:'12px 20px'}}>
                                    {workerPopup.workers.length === 0 ? (
                                        <div style={{fontSize:12,color:'var(--gray-500)',fontStyle:'italic',padding:'12px 0'}}>Aucun ouvrier pointé sur cette quinzaine pour cette équipe.</div>
                                    ) : (
                                        <table className="data-table" style={{fontSize:12}}>
                                            <thead>
                                                <tr>
                                                    <th>#</th>
                                                    <th>Matricule</th>
                                                    <th>Ouvrier</th>
                                                    <th style={{textAlign:'center'}}>JH</th>
                                                    <th style={{textAlign:'right'}}>Coût (MAD)</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {workerPopup.workers.map((w, i) => (
                                                    <tr key={w.matricule}>
                                                        <td style={{color:'var(--gray-400)'}}>{i + 1}</td>
                                                        <td style={{fontFamily:'monospace',fontWeight:600}}>{w.matricule}</td>
                                                        <td><WorkerLink matricule={w.matricule} nom={w.nom} /></td>
                                                        <td style={{textAlign:'center'}}>{w.jh}</td>
                                                        <td style={{textAlign:'right',fontWeight:600,color:'var(--berry)'}}>{(w.jh * (workerPopup.cout || 0)).toLocaleString('fr-FR')} MAD</td>
                                                    </tr>
                                                ))}
                                                <tr style={{background:'var(--berry-pale)',fontWeight:700}}>
                                                    <td></td>
                                                    <td>TOTAL</td>
                                                    <td>{workerPopup.workers.length} ouvriers</td>
                                                    <td style={{textAlign:'center'}}>{workerPopup.workers.reduce((s, w) => s + w.jh, 0)}</td>
                                                    <td style={{textAlign:'right',color:'var(--berry)'}}>{(workerPopup.workers.reduce((s, w) => s + w.jh, 0) * (workerPopup.cout || 0)).toLocaleString('fr-FR')} MAD</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { EquipesTab };
