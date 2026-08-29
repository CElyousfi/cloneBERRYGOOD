/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): AgroAnalyseFoliairesTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== ANALYSES FOLIAIRES TAB =====================
        function AgroAnalyseFoliairesTab({ ferme, currentProfile, profileData, userProfile }) {
            // ---- V5: Suivi des analyses par variété (timeline + panneau IA) ----
            const PARCELLES_MAP = {
                F1: ['P1-Myrtille A','P2-Myrtille B','P3-Framboise','P4-Myrtille C','P5-Framboise B'],
                F2: [], F3: [], F4: [], F6: [], BAHIA: [],
                F5: ['P1-Myrtille','P2-Framboise A','P3-Framboise B','P4-Myrtille D'],
                Avocatier: ['P1-Hass','P2-Hass B','P3-Fuerte'],
            };
            const parcelles = PARCELLES_MAP[ferme] || [];
            const [analyses, setAnalyses] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [form, setForm] = useState({ parcelle: parcelles[0] || '', note: '', photo: null, photoPreview: null, type_analyse: 'foliaire', variete: '', phenologie: '' });
            const [submitting, setSubmitting] = useState(false);
            const [selectedRowId, setSelectedRowId] = useState(null);
            const [selectedEvent, setSelectedEvent] = useState(null);
            const [generatingAI, setGeneratingAI] = useState(false);
            const [progressState, setProgressState] = useState(null);   // loading_pdf | calling_llm | saving | error | null
            const [progressDetail, setProgressDetail] = useState('');
            const [progressModel, setProgressModel] = useState('');
            const [elapsedS, setElapsedS] = useState(0);
            const [cachedToast, setCachedToast] = useState(null);
            const [filters, setFilters] = useState({ variete: '', type_analyse: '', period: '12m' });
            const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
            const [fullReportOpen, setFullReportOpen] = useState(false);
            const [photoZoom, setPhotoZoom] = useState(null);
            const [photoZoomList, setPhotoZoomList] = useState([]);
            const [photoZoomIdx, setPhotoZoomIdx] = useState(0);
            const [varieteContexte, setVarieteContexte] = useState('');
            const [varieteContexteLoading, setVarieteContexteLoading] = useState(false);
            const [editingContexte, setEditingContexte] = useState(false);
            const [contexteDraft, setContexteDraft] = useState('');
            const [savingContexte, setSavingContexte] = useState(false);

            const TYPE_CONFIG = {
                foliaire:             { label: 'Foliaire',    icon: 'fa-leaf',         color: '#4F7C45' },
                sol:                  { label: 'Sol',         icon: 'fa-mound',        color: '#A56A43' },
                eau_irrigation:       { label: 'Eau irrig.',  icon: 'fa-droplet',      color: '#2F80ED' },
                eau_apport:           { label: 'Eau apport',  icon: 'fa-faucet',       color: '#0891b2' },
                eau_du_sol:           { label: 'Eau du sol',  icon: 'fa-water',        color: '#0E7490' },
                observation_terrain:  { label: 'Observation', icon: 'fa-camera',       color: '#8B5CF6' },
            };

            const STADES_PHENOLOGIQUES = {
                Myrtille: [
                    { id: 'dormance', label: 'Dormance' },
                    { id: 'debourrement', label: 'Débourrement' },
                    { id: 'floraison', label: 'Floraison' },
                    { id: 'nouaison', label: 'Nouaison' },
                    { id: 'grossissement', label: 'Grossissement du fruit' },
                    { id: 'veraison', label: 'Véraison' },
                    { id: 'maturation', label: 'Maturation / Récolte' },
                    { id: 'post_recolte', label: 'Post-récolte' },
                ],
                Framboise: [
                    { id: 'dormance', label: 'Dormance' },
                    { id: 'debourrement', label: 'Débourrement' },
                    { id: 'floraison', label: 'Floraison' },
                    { id: 'nouaison', label: 'Nouaison' },
                    { id: 'grossissement', label: 'Grossissement du fruit' },
                    { id: 'veraison', label: 'Véraison' },
                    { id: 'maturation', label: 'Maturation / Récolte' },
                    { id: 'post_recolte', label: 'Post-récolte' },
                ],
                Avocatier: [
                    { id: 'repos_vegetatif', label: 'Repos végétatif' },
                    { id: 'debourrement', label: 'Débourrement' },
                    { id: 'floraison', label: 'Floraison' },
                    { id: 'nouaison', label: 'Nouaison' },
                    { id: 'grossissement', label: 'Grossissement du fruit' },
                    { id: 'maturation', label: 'Maturation / Récolte' },
                    { id: 'post_recolte', label: 'Post-récolte' },
                ],
            };
            const ALL_STADES = [...new Map([
                ...STADES_PHENOLOGIQUES.Myrtille,
                ...STADES_PHENOLOGIQUES.Avocatier,
            ].map(s => [s.id, s])).values()];

            const STATUS_CONFIG = {
                ok:       { color: '#16a34a', bg: '#f0fdf4', label: 'OK' },
                warning:  { color: '#f2994a', bg: '#fff7ed', label: 'À surveiller' },
                late:     { color: '#d97706', bg: '#fffbeb', label: 'Retard' },
                critical: { color: '#d94841', bg: '#fef2f2', label: 'Critique' },
            };

            const MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jui','Jui','Aoû','Sep','Oct','Nov','Déc'];

            const load = () => {
                setLoading(true);
                fetch('/api/stock?action=list-analyses-foliaires' + (ferme ? '&ferme=' + ferme : ''))
                    .then(r => r.json()).then(j => {
                        if (j.success) { setAnalyses(j.analyses || []); }
                    }).catch(() => {}).finally(() => setLoading(false));
            };
            useEffect(() => { load(); }, [ferme]);

            const handlePhoto = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => setForm(f => ({ ...f, photo: ev.target.result, photoPreview: ev.target.result }));
                reader.readAsDataURL(file);
            };

            const handlePhotoFile = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => setForm(f => ({ ...f, photo: ev.target.result, photoPreview: ev.target.result }));
                reader.readAsDataURL(file);
            };

            const handleCreate = () => {
                if (form.type_analyse === 'foliaire' && parcelles.length > 0 && !form.parcelle) { alert('Sélectionnez une parcelle'); return; }
                setSubmitting(true);
                const pLower = (form.parcelle || '').toLowerCase();
                const culture = pLower.includes('hass') || pLower.includes('fuerte') ? 'Avocatier' : pLower.includes('framboise') ? 'Framboise' : pLower.includes('myrtille') ? 'Myrtille' : null;
                fetch('/api/stock?action=create-analyse-foliaire', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ferme, parcelle: form.parcelle || null, culture, type_analyse: form.type_analyse, variete: form.variete || null, phenologie: form.phenologie || null, note_demande: form.note, photo_base64: form.photo, photo_filename: 'photo_parcelle.jpg', created_by: { profileId: currentProfile, name: profileData?.name || currentProfile } })
                }).then(r => r.json()).then(j => {
                    if (j.success) { setShowForm(false); setForm({ parcelle: parcelles[0] || '', note: '', photo: null, photoPreview: null, type_analyse: 'foliaire', variete: '', phenologie: '' }); load(); }
                    else alert('Erreur: ' + j.error);
                }).catch(() => alert('Erreur réseau')).finally(() => setSubmitting(false));
            };

            // Fire-and-forget + polling. The backend always persists the reco to Firestore,
            // so we don't need to block on the HTTP response — which would die anyway:
            // Safari drops long fetches (~60-90s) with "Load failed". Instead, kick off the
            // request, ignore its fate, and poll list-analyses-foliaires until the new reco
            // appears (or 5 min elapse).
            const generateIA = (analyseId, a, force = false) => {
                if (!analyseId || generatingAI) return;
                const initialRecoCount = (a.recommandations_ia || []).length;
                const startedAt = Date.now();
                setGeneratingAI(true);
                setElapsedS(0);
                setProgressState(null);
                setProgressDetail('');
                setProgressModel('');

                const FN_URL = 'https://europe-west1-berrygood-farms-dashboard.cloudfunctions.net/stockManagement?action=generate-reco-foliaire';
                (async () => {
                    try {
                        let token = null;
                        if (firebaseAuth && firebaseAuth.currentUser) token = await firebaseAuth.currentUser.getIdToken();
                        await fetch(FN_URL, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
                            },
                            body: JSON.stringify({ id: analyseId, ferme: a.ferme, culture: a.culture, parcelle: a.variete || a.parcelle, scan_url: a.scan_resultat_url, note_demande: a.terrain_raw || '', force }),
                        });
                    } catch (e) {
                        console.warn('[generateIA] request dropped, continuing with polling:', e?.message || e);
                    }
                })();

                let pollTimer = null;
                let giveUpTimer = null;
                let tickTimer = null;
                const stop = () => {
                    if (pollTimer) clearInterval(pollTimer);
                    if (giveUpTimer) clearTimeout(giveUpTimer);
                    if (tickTimer) clearInterval(tickTimer);
                    setGeneratingAI(false);
                    setProgressState(null);
                    setProgressDetail('');
                    setProgressModel('');
                };

                tickTimer = setInterval(() => {
                    setElapsedS(Math.floor((Date.now() - startedAt) / 1000));
                }, 1000);

                const poll = async () => {
                    try {
                        const r = await fetch('/api/stock?action=list-analyses-foliaires' + (ferme ? '&ferme=' + ferme : ''));
                        const j = await r.json();
                        if (!j.success) return;
                        const doc = (j.analyses || []).find(x => x.id === analyseId);
                        if (!doc) return;

                        const prog = doc.reco_progress;
                        if (prog && Date.now() - (prog.updated_at || 0) < 10 * 60 * 1000) {
                            setProgressState(prog.state || null);
                            setProgressDetail(prog.detail || '');
                            if (prog.model) setProgressModel(prog.model);
                        }

                        const newCount = (doc.recommandations_ia || []).length;
                        if (newCount > initialRecoCount) {
                            const elapsed = Date.now() - startedAt;
                            stop();
                            if (elapsed < 3000) {
                                setCachedToast('Rapport existant chargé (0 tokens)');
                            } else {
                                setCachedToast('Rapport généré ✓');
                            }
                            setTimeout(() => setCachedToast(null), 2500);
                            load();
                        }
                    } catch (_) { /* transient, retry next tick */ }
                };

                setTimeout(poll, 1200);
                pollTimer = setInterval(poll, 8000);
                giveUpTimer = setTimeout(() => {
                    stop();
                    alert("La génération a dépassé 8 minutes côté UI. Le backend peut encore finir en arrière-plan — rafraîchis dans 1-2 minutes pour récupérer le rapport.");
                }, 480000);
            };

            const fmtElapsed = (s) => {
                if (s < 60) return `${s}s`;
                const m = Math.floor(s / 60);
                const rem = s % 60;
                return `${m} min ${String(rem).padStart(2, '0')}s`;
            };
            const progressLabel = (state) => ({
                loading_pdf: 'Chargement du PDF d\'analyse…',
                calling_llm: 'Claude rédige le rapport…',
                saving: 'Sauvegarde du rapport…',
                error: 'Erreur lors de la génération',
            }[state] || 'Initialisation…');

            const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

            // ---- Build rows (grouped by variete) ----
            const filtered = analyses.filter(a => {
                if (filters.variete && a.variete !== filters.variete) return false;
                if (filters.type_analyse && a.type_analyse !== filters.type_analyse) return false;
                if (filters.period !== 'all' && a.date_analyse) {
                    const months = filters.period === '3m' ? 3 : filters.period === '6m' ? 6 : 12;
                    const cutoff = Date.now() - months * 30 * 86400000;
                    if (a.date_analyse < cutoff) return false;
                }
                return true;
            });

            const refusalRe = /^\s*(je ne peux pas|je n'ai pas (accès|pu|de)|je ne (vois|dispose)|désolé|sorry|i (cannot|can't|don't|am (unable|not able)))/i;
            const isValidReco = (r) => r && r.message && r.message.length >= 600 && !refusalRe.test(r.message);

            const rowsMap = {};
            filtered.forEach(a => {
                const key = (a.ferme || '?') + '|' + (a.variete || '—');
                if (!rowsMap[key]) {
                    rowsMap[key] = { id: key, ferme: a.ferme || '?', variete: a.variete || '—', culture: a.culture, events: [], latestReco: null };
                }
                rowsMap[key].events.push(a);
                (a.recommandations_ia || []).forEach(reco => {
                    if (!isValidReco(reco)) return;
                    if (!rowsMap[key].latestReco || (reco.generated_at || 0) > (rowsMap[key].latestReco.generated_at || 0)) {
                        rowsMap[key].latestReco = reco;
                    }
                });
            });
            const rows = Object.values(rowsMap);
            const nowMs = Date.now();
            rows.forEach(r => {
                r.events.sort((a, b) => (a.date_analyse || 0) - (b.date_analyse || 0));
                const lastDate = r.events.reduce((m, e) => Math.max(m, e.date_analyse || 0), 0);
                const ageDays = lastDate ? (nowMs - lastDate) / 86400000 : Infinity;
                if (ageDays > 120) r.status = 'late';
                else if (ageDays > 60) r.status = 'warning';
                else r.status = 'ok';
                if (r.latestReco && /critiqu|urgent|risque élevé/i.test(r.latestReco.message || '')) r.status = 'critical';
            });
            rows.sort((a, b) => {
                const order = { critical: 0, late: 1, warning: 2, ok: 3 };
                return (order[a.status] || 4) - (order[b.status] || 4);
            });

            const selectedRow = rows.find(r => r.id === selectedRowId) || rows[0];

            // Load variety context when selected row changes
            useEffect(() => {
                if (!selectedRow) { setVarieteContexte(''); return; }
                setVarieteContexteLoading(true);
                setEditingContexte(false);
                fetch(`/api/stock?action=get-variete-contexte&ferme=${encodeURIComponent(selectedRow.ferme)}&variete=${encodeURIComponent(selectedRow.variete)}`)
                    .then(r => r.json())
                    .then(j => { setVarieteContexte(j.contexte?.contexte_general || ''); })
                    .catch(() => {})
                    .finally(() => setVarieteContexteLoading(false));
            }, [selectedRow?.id]);

            const saveContexte = () => {
                if (!selectedRow) return;
                setSavingContexte(true);
                fetch('/api/stock?action=save-variete-contexte', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ferme: selectedRow.ferme, variete: selectedRow.variete,
                        contexte_general: contexteDraft,
                        updated_by: { profileId: currentProfile, name: profileData?.name || currentProfile }
                    })
                }).then(r => r.json()).then(j => {
                    if (j.success) { setVarieteContexte(contexteDraft); setEditingContexte(false); }
                    else { alert('Erreur: ' + (j.error || 'Échec de sauvegarde — les fonctions doivent être redéployées')); }
                }).catch(e => alert('Erreur réseau: ' + (e.message || 'vérifiez le déploiement des fonctions')))
                .finally(() => setSavingContexte(false));
            };

            // ---- Timeline axis (12 / 6 / 3 months ending this month) ----
            const periodMonths = filters.period === '3m' ? 3 : filters.period === '6m' ? 6 : 12;
            const now = new Date();
            const periodStart = new Date(now.getFullYear(), now.getMonth() - periodMonths + 1, 1);
            const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            const monthLabels = [];
            for (let i = 0; i < periodMonths; i++) {
                const d = new Date(periodStart);
                d.setMonth(periodStart.getMonth() + i);
                monthLabels.push(MONTHS[d.getMonth()]);
            }
            const markerPct = (date) => {
                if (!date) return null;
                const total = periodEnd.getTime() - periodStart.getTime();
                const pct = ((date - periodStart.getTime()) / total) * 100;
                if (pct < 0 || pct > 100) return null;
                return pct;
            };

            const varieteList = [...new Set(analyses.map(a => a.variete).filter(Boolean))].sort();

            const cultureEmoji = (c) => c === 'Framboise' ? '🍓' : c === 'Myrtille' ? '🫐' : c === 'Avocatier' ? '🥑' : '🌱';

            // Markdown → HTML converter — keeps headings, bold, bullets, numbered lists,
            // plus highlights the 🔴/🟡/🟢 status emojis as pill badges.
            const renderMarkdown = (md) => {
                if (!md) return '';
                // 1. Escape HTML once, up front.
                let src = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

                // 2. Extract markdown tables first (line-based) so we don't fight with <br/>.
                const lines = src.split('\n');
                const out = [];
                const isTableSep = (s) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s);
                const splitRow = (s) => s.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
                for (let i = 0; i < lines.length; i++) {
                    if (i + 1 < lines.length && lines[i].includes('|') && isTableSep(lines[i + 1])) {
                        const header = splitRow(lines[i]);
                        i += 2;
                        const rows = [];
                        while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
                            rows.push(splitRow(lines[i]));
                            i++;
                        }
                        i--;
                        const th = header.map(h => `<th style="background:#f5f3ff;color:#4c1d95;font-weight:700;text-align:left;padding:8px 10px;border:1px solid #e9d5ff;font-size:12px">${h}</th>`).join('');
                        const body = rows.map(r => '<tr>' + r.map(c => `<td style="padding:7px 10px;border:1px solid #eef2f7;font-size:12px;color:#374151;vertical-align:top">${c}</td>`).join('') + '</tr>').join('');
                        out.push(`<table style="border-collapse:collapse;width:100%;margin:12px 0;box-shadow:0 1px 2px rgba(0,0,0,0.03);border-radius:6px;overflow:hidden"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`);
                    } else {
                        out.push(lines[i]);
                    }
                }
                let html = out.join('\n');

                // 3. Inline markdown.
                html = html
                    .replace(/^#### (.*)$/gm, '<h5 style="font-weight:700;color:#7c3aed;margin:12px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.4px">$1</h5>')
                    .replace(/^### (.*)$/gm, '<h4 style="font-weight:700;color:#7c3aed;margin:14px 0 6px;font-size:14px">$1</h4>')
                    .replace(/^## (.*)$/gm, '<h3 style="font-weight:800;color:#5b21b6;margin:22px 0 10px;font-size:16px;border-bottom:2px solid #e9d5ff;padding-bottom:6px">$1</h3>')
                    .replace(/^# (.*)$/gm, '<h2 style="font-weight:800;color:#4c1d95;margin:24px 0 12px;font-size:20px">$1</h2>')
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
                    .replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>')
                    .replace(/^\s*\d+\. (.+)$/gm, '<li>$1</li>');

                // 4. Wrap consecutive <li> into <ul>.
                html = html.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, m => `<ul style="margin:6px 0 12px;padding-left:22px;list-style:disc;line-height:1.6">${m}</ul>`);

                // 5. Paragraphs.
                html = html.split(/\n\n+/).map(block => {
                    if (/^<(h\d|ul|table|blockquote|hr|div)/.test(block.trim())) return block;
                    if (!block.trim()) return '';
                    return `<p style="margin:10px 0;line-height:1.7">${block.replace(/\n/g, '<br/>')}</p>`;
                }).join('\n');

                // 6. Status dots.
                html = html
                    .replace(/🔴/g, '<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:#dc2626;vertical-align:middle;margin:0 4px"></span>')
                    .replace(/🟡/g, '<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:#f59e0b;vertical-align:middle;margin:0 4px"></span>')
                    .replace(/🟢/g, '<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:#16a34a;vertical-align:middle;margin:0 4px"></span>');
                return html;
            };

            const downloadReportMarkdown = () => {
                if (!selectedRow || !selectedRow.latestReco) return;
                const content = `# Rapport d'analyse IA\n\n**Variété :** ${selectedRow.variete}\n**Ferme :** ${selectedRow.ferme}\n**Culture :** ${selectedRow.culture || '—'}\n**Généré le :** ${new Date(selectedRow.latestReco.generated_at).toLocaleString('fr-FR')}\n\n---\n\n${selectedRow.latestReco.message || ''}`;
                const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `rapport-ia-${selectedRow.ferme}-${selectedRow.variete}-${new Date().toISOString().slice(0,10)}.md`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            };

            const printReportPdf = async () => {
                if (!selectedRow || !selectedRow.latestReco) return;
                const title = `Rapport Agronomique — ${selectedRow.variete} (${selectedRow.ferme})`;
                const date = new Date(selectedRow.latestReco.generated_at).toLocaleString('fr-FR');
                const body = renderMarkdown(selectedRow.latestReco.message || '');
                const fermeName = { F1: 'Framboise Larache', F5: 'Myrtille/Framboise Laaouamra', Avocatier: 'Avocatier' }[selectedRow.ferme] || selectedRow.ferme;
                const filename = `Rapport_${selectedRow.variete}_${selectedRow.ferme}_${new Date(selectedRow.latestReco.generated_at).toISOString().slice(0,10)}.pdf`;

                // Load html2pdf.js on demand from CDN
                if (!window.html2pdf) {
                    try {
                        await new Promise((resolve, reject) => {
                            const s = document.createElement('script');
                            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
                            s.onload = resolve;
                            s.onerror = reject;
                            document.head.appendChild(s);
                        });
                    } catch (e) {
                        alert("Impossible de charger le générateur PDF. Vérifie ta connexion.");
                        return;
                    }
                }

                const wrapper = document.createElement('div');
                wrapper.innerHTML = `<div style="font-family:'Helvetica Neue','Segoe UI',-apple-system,sans-serif;color:#1f2937;line-height:1.65;font-size:11pt;padding:0 10px"><style>
                    @page { size: A4; margin: 18mm 16mm 20mm 16mm; }
                    * { box-sizing: border-box; }
                    body { font-family: 'Helvetica Neue', 'Segoe UI', -apple-system, sans-serif; color: #1f2937; line-height: 1.65; font-size: 11pt; margin: 0; padding: 0; }
                    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #5b21b6; padding-bottom: 14px; margin-bottom: 20px; }
                    .brand { display: flex; align-items: center; gap: 12px; }
                    .logo { width: 120px; height: auto; }
                    .brand-name { font-size: 15pt; font-weight: 800; color: #1f2937; margin: 0; letter-spacing: -0.3px; }
                    .brand-sub { font-size: 9pt; color: #6b7280; margin: 0; }
                    .doc-meta { text-align: right; font-size: 9pt; color: #6b7280; }
                    .doc-meta .doc-type { font-size: 11pt; font-weight: 700; color: #5b21b6; margin-bottom: 2px; }
                    h1.report-title { font-size: 18pt; color: #1f2937; font-weight: 800; margin: 0 0 6px; letter-spacing: -0.5px; }
                    .subtitle { font-size: 11pt; color: #6b7280; margin: 0 0 18px; }
                    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; background: #faf9ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 14px 18px; margin: 0 0 24px; }
                    .meta-cell { font-size: 9.5pt; padding: 4px 0; color: #374151; }
                    .meta-cell strong { color: #4c1d95; font-weight: 700; display: inline-block; min-width: 95px; }
                    h1, h2, h3, h4, h5 { page-break-after: avoid; break-after: avoid; }
                    h2 { font-size: 14pt; color: #4c1d95; margin: 22px 0 10px; font-weight: 800; letter-spacing: -0.2px; }
                    h3 { font-size: 12pt; color: #5b21b6; margin: 18px 0 8px; font-weight: 700; border-bottom: 1.5px solid #e9d5ff; padding-bottom: 4px; }
                    h4 { font-size: 11pt; color: #6b21a8; margin: 14px 0 6px; font-weight: 700; }
                    h5 { font-size: 9pt; color: #7c3aed; margin: 12px 0 4px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
                    p { margin: 8px 0; }
                    ul, ol { margin: 8px 0 10px; padding-left: 22px; }
                    li { margin: 3px 0; }
                    table { border-collapse: collapse; width: 100%; margin: 10px 0 16px; font-size: 9.5pt; page-break-inside: avoid; }
                    table thead { display: table-header-group; }
                    th { background: #f5f3ff !important; color: #4c1d95 !important; font-weight: 700; text-align: left; padding: 8px 10px; border: 1px solid #e9d5ff; font-size: 9pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    td { padding: 6px 10px; border: 1px solid #eef2f7; font-size: 9.5pt; vertical-align: top; }
                    tr:nth-child(even) td { background: #fafafb; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    strong { color: #1f2937; font-weight: 700; }
                    em { font-style: italic; color: #4b5563; }
                    .footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e5e7eb; font-size: 8.5pt; color: #9ca3af; text-align: center; }
                </style>
                    <div class="header">
                        <div class="brand">
                            <img class="logo" src="https://berrygood-farms-dashboard.web.app/assets/icon-192.png" alt="Berry Good Farms" />
                            <div>
                                <div class="brand-name">Berry Good Farms</div>
                                <div class="brand-sub">${fermeName}</div>
                            </div>
                        </div>
                        <div class="doc-meta">
                            <div class="doc-type">RAPPORT AGRONOMIQUE</div>
                            <div>Référence : ${selectedRow.variete}-${new Date(selectedRow.latestReco.generated_at).toISOString().slice(0,10)}</div>
                            <div>${date}</div>
                        </div>
                    </div>

                    <h1 class="report-title">Analyse et recommandations — ${selectedRow.variete}</h1>
                    <p class="subtitle">Consultation agronomique sur les résultats d'analyse laboratoire</p>

                    <div class="meta-grid">
                        <div class="meta-cell"><strong>Ferme :</strong> ${selectedRow.ferme}</div>
                        <div class="meta-cell"><strong>Culture :</strong> ${selectedRow.culture || '—'}</div>
                        <div class="meta-cell"><strong>Variété :</strong> ${selectedRow.variete}</div>
                        <div class="meta-cell"><strong>Nb analyses :</strong> ${selectedRow.events.length}</div>
                        <div class="meta-cell"><strong>Généré le :</strong> ${date}</div>
                    </div>

                    ${body}

                    <div style="margin-top:40px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:8.5pt;color:#9ca3af;text-align:center">
                        Berry Good Farms · Outil d'aide à la décision agronomique · À valider par le responsable technique
                    </div>
                </div>`;

                document.body.appendChild(wrapper);
                try {
                    await window.html2pdf().set({
                        margin: [12, 10, 14, 10],
                        filename: filename,
                        image: { type: 'jpeg', quality: 0.98 },
                        html2canvas: { scale: 2, useCORS: true },
                        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                        pagebreak: { mode: ['avoid-all', 'css'] },
                    }).from(wrapper.firstElementChild).save();
                } catch (e) {
                    console.error('html2pdf failed', e);
                    alert("Erreur lors de la génération du PDF : " + (e.message || 'inconnue'));
                } finally {
                    document.body.removeChild(wrapper);
                }
            };

            return (
                <div className="fade-in">
                    <style>{`
                        .afv5-root { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; align-items: start; }
                        @media (max-width: 1280px) { .afv5-root { grid-template-columns: 1fr; } }
                        .afv5-card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); overflow: hidden; }
                        .afv5-head { padding: 18px 22px; border-bottom: 1px solid #f1f5f9; }
                        .afv5-filter-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
                        .afv5-select { padding: 7px 12px; border-radius: 8px; border: 1px solid #e5e7eb; background: #fff; font-size: 12px; color: #374151; cursor: pointer; }
                        .afv5-chip { padding: 7px 14px; border-radius: 8px; border: 1px solid #e5e7eb; background: #fff; font-size: 12px; color: #374151; cursor: pointer; font-weight: 600; }
                        .afv5-chip.active { background: var(--berry); color: #fff; border-color: var(--berry); }
                        .afv5-legend { display: flex; gap: 16px; padding: 10px 22px; font-size: 11px; color: #6b7280; flex-wrap: wrap; border-bottom: 1px solid #f1f5f9; background: #fafbfc; }
                        .afv5-legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 5px; vertical-align: middle; }
                        .afv5-months-row { display: grid; grid-template-columns: 240px 1fr 72px; border-bottom: 1px solid #f1f5f9; background: #fafbfc; }
                        .afv5-months-spacer { padding: 8px 16px; font-size: 10px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; }
                        .afv5-months { display: grid; grid-template-columns: repeat(${periodMonths}, 1fr); padding: 0 16px; font-size: 10px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; }
                        .afv5-months span { padding: 8px 0; text-align: center; }
                        .afv5-row { display: grid; grid-template-columns: 240px 1fr 72px; min-height: 88px; border-bottom: 1px solid #f1f5f9; cursor: pointer; transition: background .15s; }
                        .afv5-row:hover { background: #fafbfc; }
                        .afv5-row.selected { background: #f5f3ff; border-left: 3px solid var(--berry); }
                        .afv5-identity { padding: 14px 16px; display: flex; align-items: center; gap: 12px; }
                        .afv5-avatar { width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #f5f3ff, #e9d5ff); display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
                        .afv5-track { position: relative; padding: 16px; display: flex; align-items: center; }
                        .afv5-track-line { position: absolute; left: 16px; right: 16px; top: 50%; height: 2px; background: #f1f5f9; border-radius: 1px; }
                        .afv5-marker { position: absolute; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 12px; color: #fff; transition: transform .15s; box-shadow: 0 2px 6px rgba(0,0,0,0.15); transform: translate(-50%, -50%); border: 2px solid #fff; }
                        .afv5-marker:hover { transform: translate(-50%, -50%) scale(1.2); z-index: 3; }
                        .afv5-status-cell { padding: 14px 8px; display: flex; align-items: center; justify-content: center; }
                        .afv5-badge { font-size: 9px; font-weight: 700; padding: 4px 8px; border-radius: 10px; text-transform: uppercase; white-space: nowrap; }
                        .afv5-ai-panel { position: sticky; top: 16px; }
                        .afv5-ai-section { padding: 14px 18px; border-bottom: 1px solid #f1f5f9; }
                        .afv5-ai-section:last-child { border-bottom: none; }
                        .afv5-priority-card { border-radius: 8px; padding: 12px 14px; display: flex; gap: 10px; align-items: flex-start; }
                        .afv5-action-btn { display: flex; align-items: center; gap: 8px; padding: 9px 12px; width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; cursor: pointer; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 6px; text-decoration: none; transition: all .15s; }
                        .afv5-action-btn:hover { background: #f9fafb; border-color: var(--berry); color: var(--berry); }
                        .afv5-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                    `}</style>

                    <div className="afv5-root">
                        {/* ========== LEFT: Timeline ========== */}
                        <div className="afv5-card">
                            <div className="afv5-head">
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
                                    <div>
                                        <h3 style={{margin:0,fontSize:16,color:'#1e293b',fontWeight:700}}>
                                            Suivi des Analyses par Variété
                                        </h3>
                                        <div style={{fontSize:11,color:'#6b7280',marginTop:4}}>
                                            {ferme} — {rows.length} variété(s) · {analyses.length} analyse(s) total
                                        </div>
                                    </div>
                                    <div style={{display:'flex',gap:8}}>
                                        <button onClick={() => setShowForm(true)} style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'9px 16px',cursor:'pointer',fontWeight:600,fontSize:12}}>
                                            <i className="fa-solid fa-plus" style={{marginRight:6}}/>Nouvelle analyse
                                        </button>
                                    </div>
                                </div>
                                <div className="afv5-filter-bar">
                                    <select value={filters.variete} onChange={e => setFilters(f => ({...f, variete: e.target.value}))} className="afv5-select">
                                        <option value="">Toutes variétés</option>
                                        {varieteList.map(v => <option key={v} value={v}>{v}</option>)}
                                    </select>
                                    <select value={filters.type_analyse} onChange={e => setFilters(f => ({...f, type_analyse: e.target.value}))} className="afv5-select">
                                        <option value="">Tous types</option>
                                        {Object.entries(TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                    </select>
                                    {[{k:'3m',l:'3 mois'},{k:'6m',l:'6 mois'},{k:'12m',l:'12 mois'}].map(p => (
                                        <button key={p.k} onClick={() => setFilters(f => ({...f, period: p.k}))} className={'afv5-chip' + (filters.period === p.k ? ' active' : '')}>
                                            {p.l}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Legend */}
                            <div className="afv5-legend">
                                {Object.entries(TYPE_CONFIG).map(([k, v]) => (
                                    <span key={k}>
                                        <span className="afv5-legend-dot" style={{background: v.color}}/>
                                        {v.label}
                                    </span>
                                ))}
                            </div>

                            {/* Months header */}
                            <div className="afv5-months-row">
                                <div className="afv5-months-spacer">Variété</div>
                                <div className="afv5-months">
                                    {monthLabels.map((m, i) => <span key={i}>{m}</span>)}
                                </div>
                                <div/>
                            </div>

                            {/* Rows */}
                            {loading ? (
                                <div style={{textAlign:'center',padding:60}}>
                                    <i className="fa-solid fa-spinner fa-spin" style={{fontSize:28,color:'var(--berry)'}}/>
                                </div>
                            ) : rows.length === 0 ? (
                                <div style={{textAlign:'center',padding:60,color:'#9ca3af'}}>
                                    <i className="fa-solid fa-flask-vial" style={{fontSize:36,marginBottom:12,opacity:0.3}}/>
                                    <div style={{fontSize:13,marginBottom:4}}>Aucune analyse pour cette ferme.</div>
                                    <div style={{fontSize:11}}>Les analyses AGQ sont importées automatiquement par email.</div>
                                </div>
                            ) : (
                                rows.map(row => {
                                    const statusCfg = STATUS_CONFIG[row.status];
                                    return (
                                        <div key={row.id} className={'afv5-row' + (selectedRow && selectedRow.id === row.id ? ' selected' : '')} onClick={() => setSelectedRowId(row.id)}>
                                            <div className="afv5-identity">
                                                <div className="afv5-avatar">{cultureEmoji(row.culture)}</div>
                                                <div style={{minWidth:0,flex:1}}>
                                                    <div style={{fontWeight:700,fontSize:13,color:'#1e293b',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{row.variete}</div>
                                                    <div style={{fontSize:10,color:'#6b7280',marginTop:2}}>{row.ferme} · {row.culture || '—'}</div>
                                                    <div style={{fontSize:10,color:'#9ca3af',marginTop:1}}>{row.events.length} analyse(s)</div>
                                                </div>
                                            </div>
                                            <div className="afv5-track">
                                                <div className="afv5-track-line"/>
                                                {row.events.map(ev => {
                                                    const cfg = TYPE_CONFIG[ev.type_analyse] || TYPE_CONFIG.foliaire;
                                                    const pct = markerPct(ev.date_analyse || ev.date_resultat);
                                                    if (pct === null) return null;
                                                    return (
                                                        <div
                                                            key={ev.id}
                                                            className="afv5-marker"
                                                            onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev); setSelectedRowId(row.id); }}
                                                            style={{ left: `calc(16px + (100% - 32px) * ${pct / 100})`, top: '50%', background: cfg.color }}
                                                            title={cfg.label + ' — ' + (ev.date_analyse ? new Date(ev.date_analyse).toLocaleDateString('fr-FR') : '?')}
                                                        >
                                                            <i className={'fa-solid ' + cfg.icon}/>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className="afv5-status-cell">
                                                <span className="afv5-badge" style={{background: statusCfg.bg, color: statusCfg.color}}>{statusCfg.label}</span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* ========== RIGHT: AI Panel ========== */}
                        <div className="afv5-card afv5-ai-panel">
                            <div className="afv5-ai-section">
                                <div style={{display:'flex',alignItems:'center',gap:10}}>
                                    <div style={{width:36,height:36,borderRadius:10,background:'#f5f3ff',display:'flex',alignItems:'center',justifyContent:'center'}}>
                                        <i className="fa-solid fa-robot" style={{color:'var(--berry)',fontSize:16}}/>
                                    </div>
                                    <div>
                                        <div style={{fontSize:14,fontWeight:700,color:'#1e293b'}}>Analyse IA</div>
                                        <div style={{fontSize:10,color:'#9ca3af'}}>Recommandations agronomiques</div>
                                    </div>
                                </div>
                            </div>

                            {selectedRow ? (
                                <>
                                    <div className="afv5-ai-section">
                                        <div style={{fontSize:10,color:'#6b7280',textTransform:'uppercase',fontWeight:700,letterSpacing:'0.5px'}}>Variété sélectionnée</div>
                                        <div style={{fontSize:15,fontWeight:700,color:'#1e293b',marginTop:4}}>{selectedRow.variete}</div>
                                        <div style={{fontSize:11,color:'#6b7280',marginTop:2}}>{selectedRow.ferme} · {selectedRow.culture || '—'} · {selectedRow.events.length} analyse(s)</div>
                                    </div>

                                    <div className="afv5-ai-section">
                                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                                            <div style={{fontSize:10,fontWeight:700,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.5px'}}>Contexte général</div>
                                            {!editingContexte && (
                                                <button onClick={() => { setContexteDraft(varieteContexte); setEditingContexte(true); }}
                                                    style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:'var(--berry)',fontWeight:600,padding:0}}>
                                                    <i className="fa-solid fa-pen" style={{marginRight:4}}/>{varieteContexte ? 'Modifier' : 'Ajouter'}
                                                </button>
                                            )}
                                        </div>
                                        {editingContexte ? (
                                            <>
                                                <textarea value={contexteDraft} onChange={e => setContexteDraft(e.target.value)}
                                                    rows={4} placeholder="Décrivez le contexte actuel de cette variété (sol, âge, historique, problèmes récurrents...)"
                                                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12,resize:'vertical',boxSizing:'border-box'}}/>
                                                <div style={{display:'flex',gap:6,marginTop:6,justifyContent:'flex-end'}}>
                                                    <button onClick={() => setEditingContexte(false)} style={{padding:'5px 12px',borderRadius:6,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:11}}>Annuler</button>
                                                    <button onClick={saveContexte} disabled={savingContexte} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontSize:11,fontWeight:600}}>
                                                        {savingContexte ? 'Enregistrement…' : 'Enregistrer'}
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <div style={{fontSize:12,color: varieteContexte ? '#374151' : '#9ca3af',lineHeight:1.5,fontStyle: varieteContexte ? 'normal' : 'italic'}}>
                                                {varieteContexteLoading ? <i className="fa-solid fa-spinner fa-spin"/> : (varieteContexte || 'Aucun contexte défini pour cette variété.')}
                                            </div>
                                        )}
                                    </div>

                                    <div className="afv5-ai-section">
                                        <div className="afv5-priority-card" style={{background: STATUS_CONFIG[selectedRow.status].bg}}>
                                            <i className="fa-solid fa-circle-exclamation" style={{color: STATUS_CONFIG[selectedRow.status].color, fontSize:18,marginTop:2}}/>
                                            <div>
                                                <div style={{fontSize:10,fontWeight:700,color: STATUS_CONFIG[selectedRow.status].color,textTransform:'uppercase',letterSpacing:'0.5px'}}>
                                                    Priorité {STATUS_CONFIG[selectedRow.status].label}
                                                </div>
                                                <div style={{fontSize:12,color:'#374151',marginTop:4,lineHeight:1.5}}>
                                                    {selectedRow.latestReco
                                                        ? (selectedRow.latestReco.message || '').replace(/[*#]/g, '').slice(0, 140) + '…'
                                                        : (selectedRow.events.length === 0 ? 'Aucune analyse disponible.' : 'Aucune analyse IA générée pour cette variété. Cliquez sur "Générer l\'analyse IA" ci-dessous.')}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {selectedRow.latestReco ? (
                                        <>
                                            <div className="afv5-ai-section">
                                                <div style={{fontSize:10,fontWeight:700,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:8}}>Recommandations clés</div>
                                                <div style={{fontSize:12,lineHeight:1.6,color:'#374151',maxHeight:200,overflow:'hidden',position:'relative'}}>
                                                    <div dangerouslySetInnerHTML={{__html: renderMarkdown((selectedRow.latestReco.message || '').slice(0, 400))}} />
                                                    <div style={{position:'absolute',bottom:0,left:0,right:0,height:40,background:'linear-gradient(to bottom, transparent, #fff)'}}/>
                                                </div>
                                                <button onClick={() => setFullReportOpen(true)} disabled={generatingAI} style={{marginTop:10,width:'100%',background: generatingAI ? '#d8b4fe' : 'linear-gradient(135deg, #7c3aed, #5b21b6)',color:'#fff',border:'none',borderRadius:8,padding:'10px 14px',cursor: generatingAI ? 'wait' : 'pointer',fontWeight:600,fontSize:12,display:'flex',alignItems:'center',justifyContent:'center',gap:6,boxShadow:'0 2px 8px rgba(124,58,237,0.25)'}}>
                                                    <i className="fa-solid fa-file-lines"/>Rapport complet
                                                </button>
                                                {generatingAI ? (
                                                    <div style={{marginTop:8,background:'linear-gradient(135deg, #f5f3ff, #ede9fe)',border:'1px solid #e9d5ff',borderRadius:10,padding:'12px 14px'}}>
                                                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                                                            <i className="fa-solid fa-circle-notch fa-spin" style={{color:'#7c3aed',fontSize:14}}/>
                                                            <div style={{fontSize:12,fontWeight:700,color:'#4c1d95'}}>{progressLabel(progressState)}</div>
                                                        </div>
                                                        <div style={{fontSize:10,color:'#6b7280',marginBottom:8}}>
                                                            {[progressModel || 'Opus 4.6', progressDetail, fmtElapsed(elapsedS)].filter(Boolean).join(' · ')}
                                                        </div>
                                                        <div style={{height:5,background:'#e9d5ff',borderRadius:3,overflow:'hidden'}}>
                                                            <div style={{height:'100%',width: Math.min(elapsedS / 300 * 100, 95) + '%',background:'linear-gradient(90deg, #7c3aed, #5b21b6)',transition:'width 1s linear'}}/>
                                                        </div>
                                                    </div>
                                                ) : userProfile?.role === 'admin' && (
                                                    <button
                                                        onClick={() => {
                                                            const last = selectedRow.events[selectedRow.events.length - 1];
                                                            if (last) generateIA(last.id, last, true);
                                                        }}
                                                        disabled={selectedRow.events.length === 0}
                                                        style={{marginTop:6,width:'100%',background:'#fff',color:'#6b7280',border:'1px solid #e5e7eb',borderRadius:8,padding:'8px 14px',cursor:'pointer',fontWeight:600,fontSize:11,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
                                                        <i className="fa-solid fa-rotate"/>Régénérer
                                                    </button>
                                                )}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="afv5-ai-section">
                                            {generatingAI ? (
                                                <div style={{background:'linear-gradient(135deg, #f5f3ff, #ede9fe)',border:'1px solid #e9d5ff',borderRadius:10,padding:'14px 16px'}}>
                                                    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                                                        <i className="fa-solid fa-circle-notch fa-spin" style={{color:'#7c3aed',fontSize:16}}/>
                                                        <div style={{fontSize:13,fontWeight:700,color:'#4c1d95'}}>{progressLabel(progressState)}</div>
                                                    </div>
                                                    <div style={{fontSize:11,color:'#6b7280',marginBottom:10}}>
                                                        {[progressModel || 'Opus 4.6', progressDetail, fmtElapsed(elapsedS)].filter(Boolean).join(' · ')}
                                                    </div>
                                                    <div style={{height:6,background:'#e9d5ff',borderRadius:3,overflow:'hidden'}}>
                                                        <div style={{height:'100%',width: Math.min(elapsedS / 300 * 100, 95) + '%',background:'linear-gradient(90deg, #7c3aed, #5b21b6)',transition:'width 1s linear'}}/>
                                                    </div>
                                                    <div style={{fontSize:10,color:'#9ca3af',marginTop:6,textAlign:'center',fontStyle:'italic'}}>Progression estimée — 2 à 5 min pour un rapport complet</div>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => {
                                                        const last = selectedRow.events[selectedRow.events.length - 1];
                                                        if (last) generateIA(last.id, last);
                                                    }}
                                                    disabled={selectedRow.events.length === 0}
                                                    style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'12px',cursor:'pointer',fontWeight:600,fontSize:12,width:'100%',opacity: selectedRow.events.length === 0 ? 0.5 : 1}}
                                                >
                                                    <i className="fa-solid fa-wand-magic-sparkles" style={{marginRight:6}}/>Générer l'analyse IA
                                                </button>
                                            )}
                                        </div>
                                    )}

                                    <div className="afv5-ai-section">
                                        <div style={{fontSize:10,fontWeight:700,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:10}}>Actions rapides</div>
                                        <button className="afv5-action-btn" onClick={() => {
                                            const last = selectedRow.events[selectedRow.events.length - 1];
                                            if (last?.scan_resultat_url) setPdfPreviewUrl(last.scan_resultat_url);
                                        }} disabled={!selectedRow.events.some(e => e.scan_resultat_url)}>
                                            <i className="fa-solid fa-file-pdf" style={{color:'#dc2626'}}/>Voir le PDF
                                        </button>
                                        <button className="afv5-action-btn" onClick={() => alert('Création de tâche : fonctionnalité à venir')}>
                                            <i className="fa-solid fa-list-check" style={{color:'#f59e0b'}}/>Créer une tâche
                                        </button>
                                        <button className="afv5-action-btn" onClick={() => {
                                            const last = selectedRow.events[selectedRow.events.length - 1];
                                            if (navigator.share && last?.scan_resultat_url) {
                                                navigator.share({ title: 'Analyse ' + selectedRow.variete, url: last.scan_resultat_url });
                                            } else if (last?.scan_resultat_url) {
                                                navigator.clipboard?.writeText(last.scan_resultat_url);
                                                alert('Lien copié dans le presse-papiers');
                                            }
                                        }}>
                                            <i className="fa-solid fa-share-nodes" style={{color:'#2563eb'}}/>Partager
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div style={{padding:40,textAlign:'center',color:'#9ca3af',fontSize:12}}>
                                    Sélectionnez une variété dans la timeline pour afficher l'analyse IA.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ========== Event popover ========== */}
                    {selectedEvent && (
                        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setSelectedEvent(null); }}>
                            <div className="modal-content" style={{maxWidth:420}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:12}}>
                                    <div>
                                        <h3 style={{margin:0,fontSize:15,color:'var(--berry)'}}>
                                            <i className={'fa-solid ' + (TYPE_CONFIG[selectedEvent.type_analyse]?.icon || 'fa-flask-vial')} style={{marginRight:8}}/>
                                            {TYPE_CONFIG[selectedEvent.type_analyse]?.label || selectedEvent.type_analyse}
                                        </h3>
                                        <div style={{fontSize:11,color:'#6b7280',marginTop:4}}>
                                            {selectedEvent.ferme} · {selectedEvent.variete || '—'} · {selectedEvent.date_analyse ? new Date(selectedEvent.date_analyse).toLocaleDateString('fr-FR') : '?'}
                                        </div>
                                    </div>
                                    <button onClick={() => setSelectedEvent(null)} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#9ca3af',padding:0,lineHeight:1}}>×</button>
                                </div>
                                {selectedEvent.phenologie && (
                                    <div style={{display:'inline-flex',alignItems:'center',gap:5,background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,padding:'5px 10px',fontSize:11,color:'#16a34a',fontWeight:600,marginBottom:10}}>
                                        <i className="fa-solid fa-seedling"/>
                                        {(STADES_PHENOLOGIQUES[selectedEvent.culture] || ALL_STADES).find(s => s.id === selectedEvent.phenologie)?.label || selectedEvent.phenologie}
                                    </div>
                                )}
                                {selectedEvent.terrain_raw && <p style={{margin:'0 0 10px',fontSize:12,color:'#374151',fontStyle:'italic'}}>"{selectedEvent.terrain_raw}"</p>}
                                {selectedEvent.source === 'email_agq' && (
                                    <div style={{background:'#f5f3ff',border:'1px solid #e9d5ff',borderRadius:8,padding:'6px 12px',fontSize:11,color:'#7c3aed',fontWeight:600,marginBottom:10,display:'inline-flex',alignItems:'center',gap:6}}>
                                        <i className="fa-solid fa-envelope"/>Import automatique AGQ
                                    </div>
                                )}
                                {(selectedEvent.photo_urls || []).length > 0 && (
                                    <div style={{marginBottom:12}}>
                                        <div style={{fontSize:10,fontWeight:700,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6}}>Photos terrain</div>
                                        <div style={{display:'flex',gap:6,overflowX:'auto'}}>
                                            {selectedEvent.photo_urls.map((p, i) => (
                                                <div key={i} style={{flexShrink:0,width:72,height:72,borderRadius:8,overflow:'hidden',cursor:'pointer',border:'1px solid #e5e7eb'}} onClick={() => {
                                                    const urls = selectedEvent.photo_urls.map(x => x.url);
                                                    setPhotoZoomList(urls); setPhotoZoomIdx(i); setPhotoZoom(urls[i]);
                                                }}>
                                                    <img src={p.url} style={{width:'100%',height:'100%',objectFit:'cover'}} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {Object.keys(selectedEvent.parsed_values || {}).length > 0 && (
                                    <div style={{background:'#f9fafb',borderRadius:8,padding:12,marginBottom:12}}>
                                        <div style={{fontSize:10,fontWeight:700,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:8}}>Valeurs extraites</div>
                                        <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                                            {Object.entries(selectedEvent.parsed_values).map(([k, v]) => (
                                                <span key={k} style={{background:'#eff6ff',color:'#1e40af',fontSize:10,padding:'3px 8px',borderRadius:10,fontWeight:600,border:'1px solid #bfdbfe'}}>{k}: {String(v)}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div style={{display:'flex',gap:8,marginTop:4}}>
                                    {selectedEvent.scan_resultat_url && (
                                        <button onClick={() => { setPdfPreviewUrl(selectedEvent.scan_resultat_url); setSelectedEvent(null); }} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'10px',background:'#f0fdf4',color:'#16a34a',borderRadius:8,border:'1px solid #bbf7d0',cursor:'pointer',fontSize:12,fontWeight:600}}>
                                            <i className="fa-solid fa-file-pdf"/>Voir le PDF
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            generateIA(selectedEvent.id, selectedEvent);
                                            setSelectedEvent(null);
                                        }}
                                        disabled={generatingAI}
                                        style={{flex:1,padding:'10px',background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,cursor: generatingAI ? 'wait' : 'pointer',fontSize:12,fontWeight:600}}
                                    >
                                        <i className="fa-solid fa-wand-magic-sparkles" style={{marginRight:6}}/>Générer IA
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ========== PDF preview modal ========== */}
                    {pdfPreviewUrl && (
                        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setPdfPreviewUrl(null); }}>
                            <div className="modal-content" style={{maxWidth:'90vw',width:900,height:'90vh',padding:0,display:'flex',flexDirection:'column'}}>
                                <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                                        <i className="fa-solid fa-file-pdf" style={{fontSize:18,color:'#dc2626'}}/>
                                        <div>
                                            <div style={{fontSize:14,fontWeight:700,color:'#1e293b'}}>Rapport AGQ</div>
                                            <div style={{fontSize:11,color:'#6b7280'}}>Aperçu du PDF</div>
                                        </div>
                                    </div>
                                    <div style={{display:'flex',gap:8}}>
                                        <a href={pdfPreviewUrl} download target="_blank" rel="noopener noreferrer" style={{padding:'8px 14px',borderRadius:8,border:'1px solid #e5e7eb',background:'#fff',fontSize:12,fontWeight:600,color:'#374151',textDecoration:'none',display:'flex',alignItems:'center',gap:6}}>
                                            <i className="fa-solid fa-download"/>Télécharger
                                        </a>
                                        <button onClick={() => setPdfPreviewUrl(null)} style={{background:'none',border:'none',fontSize:24,cursor:'pointer',color:'#9ca3af',padding:'0 8px',lineHeight:1}}>×</button>
                                    </div>
                                </div>
                                <iframe src={pdfPreviewUrl} style={{flex:1,border:'none',width:'100%'}} title="PDF preview"/>
                            </div>
                        </div>
                    )}

                    {/* ========== Full AI report modal ========== */}
                    {fullReportOpen && selectedRow && selectedRow.latestReco && (
                        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setFullReportOpen(false); }}>
                            <div className="modal-content" style={{maxWidth:820,width:'90vw',maxHeight:'90vh',padding:0,display:'flex',flexDirection:'column'}}>
                                <div style={{padding:'18px 24px',borderBottom:'1px solid #e5e7eb',display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexShrink:0,background:'linear-gradient(135deg, #f5f3ff, #ede9fe)'}}>
                                    <div style={{display:'flex',alignItems:'center',gap:12}}>
                                        <div style={{width:44,height:44,borderRadius:12,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 6px rgba(0,0,0,0.05)'}}>
                                            <i className="fa-solid fa-robot" style={{color:'var(--berry)',fontSize:20}}/>
                                        </div>
                                        <div>
                                            <div style={{fontSize:16,fontWeight:800,color:'#1e293b'}}>Rapport d'analyse IA</div>
                                            <div style={{fontSize:12,color:'#6b7280',marginTop:2}}>
                                                <strong>{selectedRow.variete}</strong> · {selectedRow.ferme} · {selectedRow.culture || '—'} · Généré le {new Date(selectedRow.latestReco.generated_at).toLocaleString('fr-FR')}
                                            </div>
                                        </div>
                                    </div>
                                    <button onClick={() => setFullReportOpen(false)} style={{background:'none',border:'none',fontSize:26,cursor:'pointer',color:'#9ca3af',padding:'0 4px',lineHeight:1}}>×</button>
                                </div>

                                <div style={{padding:'12px 24px',borderBottom:'1px solid #f1f5f9',display:'flex',gap:8,flexShrink:0,background:'#fff'}}>
                                    <button onClick={downloadReportMarkdown} style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:8,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:12,fontWeight:600,color:'#374151'}}>
                                        <i className="fa-brands fa-markdown"/>Télécharger Markdown
                                    </button>
                                    <button onClick={printReportPdf} style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:8,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:12,fontWeight:600,color:'#374151'}}>
                                        <i className="fa-solid fa-file-pdf"/>Télécharger PDF
                                    </button>
                                    <button onClick={() => {
                                        navigator.clipboard?.writeText(selectedRow.latestReco.message || '');
                                        alert('Rapport copié dans le presse-papiers');
                                    }} style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:8,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:12,fontWeight:600,color:'#374151'}}>
                                        <i className="fa-solid fa-copy"/>Copier
                                    </button>
                                    {selectedRow.events.some(e => e.scan_resultat_url) && (
                                        <button onClick={() => {
                                            const last = selectedRow.events[selectedRow.events.length - 1];
                                            setFullReportOpen(false);
                                            setPdfPreviewUrl(last.scan_resultat_url);
                                        }} style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:8,border:'1px solid #e5e7eb',background:'#fff',cursor:'pointer',fontSize:12,fontWeight:600,color:'#374151'}}>
                                            <i className="fa-solid fa-file-pdf" style={{color:'#dc2626'}}/>Voir PDF source
                                        </button>
                                    )}
                                </div>

                                <div style={{flex:1,overflowY:'auto',padding:'24px 32px',background:'#fafbfc'}}>
                                    <div
                                        style={{background:'#fff',borderRadius:12,padding:'28px 32px',boxShadow:'0 1px 3px rgba(0,0,0,0.04)',fontSize:14,lineHeight:1.7,color:'#374151'}}
                                        dangerouslySetInnerHTML={{__html: renderMarkdown(selectedRow.latestReco.message || '')}}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {cachedToast && (
                        <div style={{position:'fixed',bottom:24,right:24,background:'#1e293b',color:'#fff',padding:'10px 16px',borderRadius:10,fontSize:12,fontWeight:600,boxShadow:'0 4px 16px rgba(0,0,0,0.2)',display:'flex',alignItems:'center',gap:8,zIndex:9999}}>
                            <i className="fa-solid fa-bolt" style={{color:'#fbbf24'}}/>{cachedToast}
                        </div>
                    )}

                    {/* ========== Photo zoom modal ========== */}
                    {photoZoom && (
                        <div className="modal-overlay" onClick={() => setPhotoZoom(null)} style={{zIndex:9999,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                            <button onClick={(e) => { e.stopPropagation(); setPhotoZoom(null); }} style={{position:'absolute',top:20,right:20,background:'rgba(255,255,255,0.2)',border:'none',color:'#fff',borderRadius:'50%',width:40,height:40,cursor:'pointer',fontSize:20,display:'flex',alignItems:'center',justifyContent:'center',zIndex:10}}>
                                <i className="fa-solid fa-xmark"/>
                            </button>
                            {photoZoomList.length > 1 && photoZoomIdx > 0 && (
                                <button onClick={(e) => { e.stopPropagation(); const ni = photoZoomIdx-1; setPhotoZoomIdx(ni); setPhotoZoom(photoZoomList[ni]); }} style={{position:'absolute',left:20,top:'50%',transform:'translateY(-50%)',background:'rgba(255,255,255,0.2)',border:'none',color:'#fff',borderRadius:'50%',width:44,height:44,cursor:'pointer',fontSize:20,zIndex:10}}>
                                    <i className="fa-solid fa-chevron-left"/>
                                </button>
                            )}
                            {photoZoomList.length > 1 && photoZoomIdx < photoZoomList.length - 1 && (
                                <button onClick={(e) => { e.stopPropagation(); const ni = photoZoomIdx+1; setPhotoZoomIdx(ni); setPhotoZoom(photoZoomList[ni]); }} style={{position:'absolute',right:20,top:'50%',transform:'translateY(-50%)',background:'rgba(255,255,255,0.2)',border:'none',color:'#fff',borderRadius:'50%',width:44,height:44,cursor:'pointer',fontSize:20,zIndex:10}}>
                                    <i className="fa-solid fa-chevron-right"/>
                                </button>
                            )}
                            <img src={photoZoom} onClick={e => e.stopPropagation()} style={{maxWidth:'90vw',maxHeight:'90vh',objectFit:'contain',borderRadius:8}} />
                            <div style={{position:'absolute',bottom:20,color:'#fff',fontSize:12,opacity:0.7}}>{photoZoomIdx+1} / {photoZoomList.length}</div>
                        </div>
                    )}

                    {/* ========== Modal new analysis ========== */}
                    {showForm && (
                        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
                            <div className="modal-content" style={{maxWidth:480}}>
                                <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-flask-vial" style={{marginRight:8}}/>Nouvelle demande d'analyse</h3>
                                <div style={{marginBottom:12}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Type d'analyse *</label>
                                    <select value={form.type_analyse} onChange={e => setForm(f => ({...f, type_analyse: e.target.value}))} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                        {Object.entries(TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                    </select>
                                </div>
                                {form.type_analyse === 'foliaire' && parcelles.length > 0 && (
                                    <div style={{marginBottom:12}}>
                                        <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Parcelle *</label>
                                        <select value={form.parcelle} onChange={e => setForm(f => ({...f, parcelle: e.target.value}))} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            {parcelles.map(p => <option key={p} value={p}>{p}</option>)}
                                        </select>
                                    </div>
                                )}
                                <div style={{marginBottom:12}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Variété (optionnel)</label>
                                    <input type="text" value={form.variete} onChange={e => setForm(f => ({...f, variete: e.target.value}))} placeholder="ex. Maravilla, Cascade, Hass..." style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,boxSizing:'border-box'}}/>
                                </div>
                                <div style={{marginBottom:12}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Stade phénologique (optionnel)</label>
                                    <select value={form.phenologie} onChange={e => setForm(f => ({...f, phenologie: e.target.value}))} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                        <option value="">— Sélectionner —</option>
                                        {(() => {
                                            const pL = (form.parcelle || '').toLowerCase();
                                            const cultureInf = pL.includes('hass') || pL.includes('fuerte') ? 'Avocatier' : pL.includes('framboise') ? 'Framboise' : pL.includes('myrtille') ? 'Myrtille' : null;
                                            return (STADES_PHENOLOGIQUES[cultureInf] || ALL_STADES).map(s => <option key={s.id} value={s.id}>{s.label}</option>);
                                        })()}
                                    </select>
                                </div>
                                <div style={{marginBottom:12}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Observations / Notes</label>
                                    <textarea value={form.note} onChange={e => setForm(f => ({...f, note: e.target.value}))} rows={3} placeholder="Symptômes observés, stade de culture..." style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,resize:'vertical'}}/>
                                </div>
                                <div style={{marginBottom:16}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Photo de la parcelle (optionnel)</label>
                                    <label style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',borderRadius:8,border:'2px dashed #e5e7eb',cursor:'pointer',background:'#f9fafb',fontSize:12,color:'#6b7280',width:'100%',boxSizing:'border-box'}}>
                                        <i className="fa-solid fa-camera" style={{fontSize:18,color:'var(--berry)'}}/>
                                        <span>{form.photo ? 'Photo sélectionnée ✓' : 'Choisir une photo'}</span>
                                        <input type="file" accept="image/*" capture="environment" onChange={handlePhotoFile} style={{display:'none'}}/>
                                    </label>
                                    {form.photoPreview && <img src={form.photoPreview} style={{marginTop:8,width:'100%',maxHeight:160,objectFit:'cover',borderRadius:8,border:'1px solid #e5e7eb'}} alt="preview"/>}
                                </div>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                    <button onClick={() => setShowForm(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleCreate} disabled={submitting} style={{padding:'8px 18px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor: submitting ? 'wait' : 'pointer',fontWeight:600,fontSize:13}}>
                                        {submitting ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}/>Envoi…</> : <><i className="fa-solid fa-paper-plane" style={{marginRight:6}}/>Soumettre</>}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { AgroAnalyseFoliairesTab };
