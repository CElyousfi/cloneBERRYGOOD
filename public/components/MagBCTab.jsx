/*
 * MagBCTab.jsx — Onglet magasinier "Bons de Consommation" (engrais / phyto /
 * tous) : liste filtrable + tri + export Excel, création d'un bon (articles,
 * parcelle ou groupe de parcelles, scan), création d'article au catalogue et
 * pop-up de détail d'un bon.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE, aucun identifiant top-level ne
 * fuite (cf. crashes #75/#77 — mémoire umd-global-collision-smoke-load). Trois
 * globaux exposés, et rien d'autre :
 *   window.MagBCTab, window.MagBCEngraisTab, window.MagBCPhytoTab
 *
 * Extrait de public/app.jsx à comportement IDENTIQUE (règle de modularisation
 * progressive, CLAUDE.md). Dépendances qui étaient dans le scope d'app.jsx et
 * qui sont désormais lues sur window :
 *   - window.useStockLocations()  (public/lib/useStockLocations.js)
 *   - window.cachedFetch()        (défini dans app.jsx, exposé sur window)
 * Déjà globales avant l'extraction : window.CampagneUtils,
 * window.ParcelleGroupUtils, XLSX (CDN SheetJS), React (CDN).
 *
 * Props (MagBCTab) :
 *   - type          : '' | 'engrais' | 'pesticide'
 *   - label, icon   : surcharges d'affichage (déduites de type si absentes)
 *   - currentProfile: id du profil courant (string)
 *   - profileData   : objet profil (name, …)
 */
(function () {
  'use strict';

  var _r = window.React;
  if (!_r) return;
  var React = _r;
  var useState = _r.useState;
  var useEffect = _r.useEffect;

        // ===================== MAGASINIER: BONS CONSOMMATION ENGRAIS TAB =====================
        function MagBCEngraisTab({ currentProfile, profileData }) {
            return <MagBCTab type="engrais" label="Engrais" icon="fa-flask" currentProfile={currentProfile} profileData={profileData} />;
        }

        // ===================== MAGASINIER: BONS CONSOMMATION PHYTO TAB =====================
        function MagBCPhytoTab({ currentProfile, profileData }) {
            return <MagBCTab type="pesticide" label="Phytosanitaire" icon="fa-bug" currentProfile={currentProfile} profileData={profileData} />;
        }

        // ===================== MAGASINIER: BONS CONSOMMATION (shared) =====================
        function MagBCTab({ type: typeProp, label: labelProp, icon: iconProp, currentProfile, profileData }) {
            const type = typeProp || '';
            const label = labelProp || (type === 'engrais' ? 'Engrais' : type === 'pesticide' ? 'Phytosanitaire' : 'Tous');
            const icon = iconProp || 'fa-flask';
            const [bcs, setBcs] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [stocks, setStocks] = useState([]);
            const [catalogueArticles, setCatalogueArticles] = useState([]);
            const [showCreateArticle, setShowCreateArticle] = useState(false);
            const [newArticle, setNewArticle] = useState({ reference: '', nom: '', unite: 'kg', categorie: 'autre', taux_tva: 20 });
            const [creatingArt, setCreatingArt] = useState(false);
            const [createArticleLineIdx, setCreateArticleLineIdx] = useState(null);
            const canCreateArticle = currentProfile === 'achats' || currentProfile === 'dg';
            const [parcelles, setParcelles] = useState([]);
            const [refParcelles, setRefParcelles] = useState({ courante: [], precedente: [] });
            // Groupes de parcelles = raccourci de saisie (parcelle combinée). Le
            // backend éclate la ligne en N parcelles RÉELLES au prorata des Ha.
            const [parcelleGroupes, setParcelleGroupes] = useState([]);
            const FARMS = ['F1', 'F5'];
            // Magasins dérivés de la config stock (get-locations) — source unique, plus de hardcode.
            const MAGASINS = window.useStockLocations().magasins;
            const STATIONS = ['Station F1', 'Station F2', 'Station F3', 'Station F4', 'Station F5', 'Station F6'];
            const emptyItem = { article: '', quantite: '', unite: 'kg', parcelle: '', parcelle_ref: '', culture: '', ferme: '', groupe_id: '' };
            const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], lieu_source_type: 'magasin', lieu_source_id: 'F1', items: [{ ...emptyItem }] });
            const [scanFileBC, setScanFileBC] = useState(null);
            const [scanPreviewBC, setScanPreviewBC] = useState(null);
            // Campagne (année fiscale Juillet→Juin) : '2025-2026', etc.
            // Source unique : window.CampagneUtils (lib/campagneUtils.js). Fallback
            // défensif si le lib n'est pas encore chargé (renvoie '' comme l'ancien helper).
            const bcCampagneOf = (dateStr) => (window.CampagneUtils ? (window.CampagneUtils.campagneOf(dateStr) || '') : (() => { const m = (dateStr || '').match(/^(\d{4})-(\d{2})/); if (!m) return ''; const y = +m[1], mo = +m[2]; const start = mo >= 7 ? y : y - 1; return start + '-' + (start + 1); })());
            const [bcCampagne, setBcCampagne] = useState(() => bcCampagneOf(new Date().toISOString().slice(0, 10)));
            // Culture : filtre GLOBAL au bon (pas une donnée du bon). '' = toutes.
            // Jamais envoyé au backend — même convention que bcCampagne.
            const [bcCulture, setBcCulture] = useState('');

            const [query, setQuery] = useState('');
            const [filterSource, setFilterSource] = useState('');
            const [dateFrom, setDateFrom] = useState('');
            const [dateTo, setDateTo] = useState('');
            const [sortField, setSortField] = useState('date');
            const [sortDir, setSortDir] = useState('desc');
            const [detailBc, setDetailBc] = useState(null);
            const isImportBC = (bc) => bc._isImport || (bc.numero || '').startsWith('IMP-') || bc.created_by?.userId === 'import_caneva';
            const loadBcs = () => {
                Promise.all([
                    fetch('/api/stock?action=list-bc&type=' + type).then(r => r.json()).catch(() => ({ success: false })),
                    fetch('/api/stock?action=list-movements&type=consommation&limit=3000').then(r => r.json()).catch(() => ({ success: false })),
                ]).then(([bcJson, movJson]) => {
                    const list = bcJson.success ? (bcJson.bcs || []) : [];
                    const movs = movJson.success ? (movJson.movements || []) : [];
                    // Append movements without bc_id (imports / direct mouvements) as virtual BC rows
                    const extras = movs.filter(m => !m.bc_id).map(m => ({
                        id: 'mov_' + m.id,
                        numero: m.numero,
                        date: m.date,
                        ferme: m.ferme,
                        lieu_source: m.lieu_source || null,
                        items: (m.items || []).map(i => ({ article: i.article_nom || i.article_ref, quantite: i.quantite, unite: i.unite, parcelle: m.lieu_destination?.id || '', ferme: m.ferme })),
                        created_by: m.created_by || {},
                        _isImport: (m.numero || '').startsWith('IMP-') || m.created_by?.userId === 'import_caneva',
                    }));
                    setBcs([...list, ...extras]);
                }).finally(() => setLoading(false));
            };
            useEffect(() => { loadBcs(); }, []);
            useEffect(() => { window.cachedFetch('/api/stock?action=stock-levels').then(json => { if (json.success) setStocks(json.stocks || []); }).catch(() => {}); }, []);
            useEffect(() => { fetch('/api/stock?action=list-articles').then(r=>r.json()).then(j=>{ if(j.success) { const seen = new Set(); setCatalogueArticles((j.articles||[]).filter(a => { if(seen.has(a.nom)) return false; seen.add(a.nom); return true; })); } }).catch(()=>{}); }, []);
            useEffect(() => { window.cachedFetch('/api/parcelles').then(json => { if (json.success) setParcelles(json.parcelles || []); }).catch(() => {}); }, []);
            useEffect(() => {
                fetch('/api/pointage-rh?action=parcelles-campagne-list')
                    .then(r => r.json())
                    .then(j => { if (j.success) setRefParcelles({ courante: j.campagne_courante || [], precedente: j.campagne_precedente || [] }); })
                    .catch(() => {});
            }, []);
            useEffect(() => {
                // Groupes de parcelles (lecture ouverte à tout profil authentifié).
                // `valide: false` = un membre n'a plus de Ha SB → groupe non
                // proposé à la saisie (le backend le refuserait de toute façon).
                fetch('/api/pointage-rh?action=sb-groupes-list')
                    .then(r => r.json())
                    .then(j => { if (j.success) setParcelleGroupes((j.groupes || []).filter(g => g.valide)); })
                    .catch(() => {});
            }, []);

            const catalogUnit = (article) => { const a = catalogueArticles.find(x => (x.nom||'').toLowerCase() === (article||'').toLowerCase()); return a && a.unite ? (a.unite || '').toLowerCase() : null; };
            const suggestRef = (nom) => 'ART-' + (nom || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
            const openCreateArticle = (lineIdx, prefillNom) => {
                const nom = (prefillNom || '').trim();
                setNewArticle({ reference: nom ? suggestRef(nom) : '', nom, unite: 'kg', categorie: 'autre', taux_tva: 20 });
                setCreateArticleLineIdx(typeof lineIdx === 'number' ? lineIdx : null);
                setShowCreateArticle(true);
            };
            const handleCreateArticle = async () => {
                if (!newArticle.nom.trim() || !newArticle.reference.trim()) return alert('Le nom et la référence sont requis');
                setCreatingArt(true);
                try {
                    const r = await fetch('/api/stock?action=create-article', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newArticle, created_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }) });
                    const j = await r.json();
                    if (j.success) {
                        const listR = await fetch('/api/stock?action=list-articles');
                        const listJ = await listR.json();
                        if (listJ.success) { const seen = new Set(); setCatalogueArticles((listJ.articles||[]).filter(a => { if(seen.has(a.nom)) return false; seen.add(a.nom); return true; })); }
                        if (createArticleLineIdx != null) {
                            const li = createArticleLineIdx;
                            const items = [...form.items];
                            items[li] = { ...items[li], article: newArticle.nom, unite: (newArticle.unite || 'kg').toLowerCase() };
                            setForm({ ...form, items });
                        }
                        setShowCreateArticle(false);
                        setCreateArticleLineIdx(null);
                        setNewArticle({ reference: '', nom: '', unite: 'kg', categorie: 'autre', taux_tva: 20 });
                    } else { alert(j.error || 'Erreur lors de la création'); }
                } catch (e) { alert('Erreur réseau'); }
                setCreatingArt(false);
            };

            const filteredParcelles = parcelles;
            const bcCampagneToday = bcCampagneOf(new Date().toISOString().slice(0, 10));
            const campagnePrecedente = (() => { const y = parseInt(bcCampagneToday.slice(0, 4), 10) - 1; return y + '-' + (y + 1); })();
            const useConsoSelector = currentProfile === 'magasinier' && (refParcelles.courante.length > 0 || refParcelles.precedente.length > 0);
            const bcCampagnesDispo = [
                ...(refParcelles.courante.length > 0 ? [bcCampagneToday] : []),
                ...(refParcelles.precedente.length > 0 ? [campagnePrecedente] : []),
            ];
            if (!bcCampagnesDispo.length) bcCampagnesDispo.push(bcCampagneToday);
            const refForCampagne = bcCampagne === bcCampagneToday ? refParcelles.courante : refParcelles.precedente;
            // Culture/ferme d'un libellé de parcelle, quelle que soit la source du select.
            const metaForParcelle = (label) => {
                const ref = refForCampagne.find(p => p.label === label);
                if (ref) return { culture: ref.culture || '', ferme: ref.ferme || '' };
                const parc = parcelles.find(p => p.Parcelle_Physique === label);
                return { culture: parc?.Culture || '', ferme: parc?.Ferme || '' };
            };
            // Valeur unique parmi les membres d'un groupe, sinon '' (groupe à cheval
            // sur deux cultures/fermes → on ne devine pas).
            const uniqueMemberMeta = (groupe, field) => {
                const vals = [...new Set((groupe.membres || []).map(m => metaForParcelle(m.label)[field]).filter(Boolean))];
                return vals.length === 1 ? vals[0] : '';
            };
            // --- Filtre Culture (global au bon) -------------------------------
            // Référentiel Smart Berry lu AU RENDU : sbLoad() est asynchrone au boot
            // d'app.jsx, un useState initial figerait un objet vide.
            const sbMap = window.SB_PARCELLE_REF || {};
            // Défensif : lib absente → on ne filtre rien (comportement actuel).
            const cultureOk = (parcelle, filtre) => {
                const CU = window.CultureUtils;
                if (!CU || !filtre) return true;
                return CU.matchesCulture(parcelle, filtre, sbMap);
            };
            // Un membre de groupe n'a qu'un `label` : on lui rattache la culture
            // connue du référentiel de saisie avant de résoudre.
            const groupeOk = (groupe, filtre) => {
                if (!filtre || !window.CultureUtils) return true;
                // Groupe à cheval sur deux cultures : proposé si AU MOINS un membre
                // matche (même prudence que uniqueMemberMeta : on ne devine pas).
                return (groupe.membres || []).some(m => cultureOk({ label: m.label, culture: metaForParcelle(m.label).culture }, filtre));
            };
            const refForCampagneCulture = refForCampagne.filter(p => cultureOk(p, bcCulture));
            const filteredParcellesCulture = filteredParcelles.filter(p => cultureOk(p, bcCulture));
            const parcelleGroupesCulture = parcelleGroupes.filter(g => groupeOk(g, bcCulture));
            const aucuneParcellePourCulture = !!bcCulture
                && parcelleGroupesCulture.length === 0
                && (useConsoSelector ? refForCampagneCulture.length : filteredParcellesCulture.length) === 0;
            // Changement de culture : les lignes dont la destination sort de la
            // liste filtrée perdent leur parcelle (article/qté/unité intacts).
            const changeBcCulture = (val) => {
                setBcCulture(val);
                // '' = plus de filtre (rien ne devient invalide) ; lib absente = pas de filtre du tout.
                if (!val || !window.CultureUtils) return;
                const items = form.items.map(it => {
                    if (!it.parcelle && !it.groupe_id) return it;
                    let keep;
                    if (it.groupe_id) {
                        const g = parcelleGroupes.find(x => x.id === it.groupe_id);
                        keep = !!g && groupeOk(g, val);
                    } else {
                        const src = useConsoSelector
                            ? refForCampagne.find(p => p.label === it.parcelle)
                            : filteredParcelles.find(p => p.Parcelle_Physique === it.parcelle);
                        keep = !!src && cultureOk(src, val);
                    }
                    return keep ? it : { ...it, parcelle: '', parcelle_ref: '', culture: '', ferme: '', groupe_id: '' };
                });
                setForm({ ...form, items });
            };

            const selectParcelleForItem = (idx, val) => {
                const items = [...form.items];
                if ((val || '').startsWith('GRP::')) {
                    // Parcelle combinée : on ne pose que le libellé du groupe +
                    // groupe_id. L'éclatement en parcelles réelles est fait par le
                    // backend (create-bc), au prorata des Ha du référentiel SB.
                    const g = parcelleGroupes.find(x => x.id === val.slice(5));
                    items[idx] = { ...items[idx], parcelle: g ? g.label : '', parcelle_ref: '', groupe_id: g ? g.id : '', culture: g ? uniqueMemberMeta(g, 'culture') : '', ferme: g ? uniqueMemberMeta(g, 'ferme') : '' };
                    setForm({ ...form, items });
                    return;
                }
                const ref = refForCampagne.find(p => p.label === val);
                if (ref) {
                    items[idx] = { ...items[idx], parcelle: val, parcelle_ref: ref.ref || '', culture: ref.culture || '', ferme: ref.ferme || '', groupe_id: '' };
                } else {
                    const parc = parcelles.find(p => p.Parcelle_Physique === val);
                    items[idx] = { ...items[idx], parcelle: val, parcelle_ref: '', culture: parc?.Culture || '', ferme: parc?.Ferme || '', groupe_id: '' };
                }
                setForm({ ...form, items });
            };

            const updateItem = (idx, field, value) => { const items = [...form.items]; items[idx] = { ...items[idx], [field]: value }; setForm({ ...form, items }); };
            const addItem = () => setForm({ ...form, items: [...form.items, { ...emptyItem }] });
            const removeItem = (idx) => { if (form.items.length > 1) setForm({ ...form, items: form.items.filter((_, i) => i !== idx) }); };
            const getStock = (article) => { const s = stocks.find(x => x.article === article); return s ? s.stock : 0; };

            const uploadScanBC = async (base64) => {
                if (!base64) return null;
                const res = await fetch('/api/stock?action=upload-scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_base64: base64, filename: 'scan_bc.jpg', contentType: 'image/jpeg' }) });
                const json = await res.json();
                return json.success ? json.url : null;
            };

            const handleCreate = async () => {
                const validItems = form.items.filter(i => i.article && i.quantite);
                if (!validItems.length) { alert('Ajoutez au moins un article'); return; }
                for (const it of validItems) {
                    if (!it.parcelle) { alert('Parcelle requise pour l\'article ' + it.article); return; }
                }
                for (const it of validItems) {
                    const dispo = getStock(it.article);
                    if (parseFloat(it.quantite) > dispo) {
                        if (!confirm('Stock insuffisant pour ' + it.article + ' (dispo: ' + dispo + '). Continuer quand meme ?')) return;
                    }
                }
                let scanUrl = null;
                if (scanFileBC) { scanUrl = await uploadScanBC(scanFileBC); }
                fetch('/api/stock?action=create-bc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: type || 'engrais', date: form.date, lieu_source: { type: form.lieu_source_type, id: form.lieu_source_id }, items: validItems.map(i => ({ article: i.article, quantite: i.quantite, unite: i.unite, parcelle: i.parcelle, parcelle_ref: i.parcelle_ref || '', culture: i.culture, ferme: i.ferme, groupe_id: i.groupe_id || '' })), scan_url: scanUrl, authorized_by: { profileId: currentProfile, name: profileData?.name || currentProfile }, created_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { alert('Bon de consommation ' + json.numero + ' cree'); setShowForm(false); loadBcs(); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur reseau'));
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            const matchesBC = (bc) => {
                if (dateFrom && bc.date && bc.date < dateFrom) return false;
                if (dateTo && bc.date && bc.date > dateTo) return false;
                if (filterSource === 'import' && !isImportBC(bc)) return false;
                if (filterSource === 'saisie' && isImportBC(bc)) return false;
                if (!query) return true;
                const q = query.toLowerCase();
                return (bc.numero||'').toLowerCase().includes(q)
                    || (bc.items||[]).some(i => (i.article||'').toLowerCase().includes(q) || (i.parcelle||'').toLowerCase().includes(q))
                    || (bc.ferme||'').toLowerCase().includes(q);
            };
            const sortValueBC = (bc, field) => {
                if (field === 'numero') return bc.numero || '';
                if (field === 'date') return bc.date || '';
                if (field === 'parcelles') return [...new Set((bc.items||[]).map(i => i.parcelle).filter(Boolean))].join(',');
                if (field === 'fermes') return [...new Set((bc.items||[]).map(i => i.ferme).filter(Boolean))].join(',') || (bc.ferme || '');
                if (field === 'cree_par') return bc.created_by?.name || '';
                return '';
            };
            const filteredBcs = bcs.filter(matchesBC).slice().sort((a, b) => {
                const va = sortValueBC(a, sortField), vb = sortValueBC(b, sortField);
                if (va < vb) return sortDir === 'asc' ? -1 : 1;
                if (va > vb) return sortDir === 'asc' ? 1 : -1;
                // Tie-break par numéro pour garder les lignes d'un même bon groupées
                const na = a.numero || '', nb = b.numero || '';
                if (na < nb) return sortDir === 'asc' ? -1 : 1;
                if (na > nb) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });
            const lieuSourceOf = (bc) => (bc.lieu_source && bc.lieu_source.id) || bc.lieu_source_id || '—';
            const toggleSort = (field) => {
                if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                else { setSortField(field); setSortDir('asc'); }
            };
            const sortArrow = (field) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
            const sortThStyle = { cursor: 'pointer', userSelect: 'none' };

            const exportBcExcel = () => {
                if (!filteredBcs.length) { alert('Aucun bon à exporter'); return; }
                const aoa = [['N° Bon', 'Date', 'Lieu départ', 'Ferme', 'Parcelle', 'Article', 'Quantité', 'Unité', 'Culture', 'Créé par']];
                filteredBcs.forEach(bc => {
                    const lieuDepart = bc.lieu_source?.id || bc.lieu_source_id || '—';
                    const creePar = bc.created_by?.name || '';
                    const items = bc.items || [];
                    if (!items.length) {
                        aoa.push([bc.numero || '', bc.date || '', lieuDepart, bc.ferme || '', '', '', '', '', '', creePar]);
                    } else {
                        items.forEach(i => {
                            aoa.push([
                                bc.numero || '',
                                bc.date || '',
                                lieuDepart,
                                i.ferme || bc.ferme || '',
                                i.parcelle || '',
                                i.article || '',
                                i.quantite != null ? i.quantite : '',
                                i.unite || '',
                                i.culture || '',
                                creePar,
                            ]);
                        });
                    }
                });
                const ws = XLSX.utils.aoa_to_sheet(aoa);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Bons de Consommation');
                XLSX.writeFile(wb, 'Bons_Consommation_' + new Date().toISOString().slice(0, 10) + '.xlsx');
            };

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                            <h3 style={{margin:0}}><i className={'fa-solid ' + icon} style={{marginRight:8}}></i>Bons de Consommation {label} ({filteredBcs.length})</h3>
                            <button onClick={exportBcExcel} title="Exporter la liste filtrée en Excel"
                                style={{background:'#1d6f42',color:'#fff',border:'none',borderRadius:8,padding:'7px 14px',cursor:'pointer',fontWeight:600,fontSize:12}}>
                                <i className="fa-solid fa-file-excel" style={{marginRight:6}}></i>Export Excel
                            </button>
                        </div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                            <input type="search" placeholder="Rechercher (n°, article, parcelle…)" value={query} onChange={e => setQuery(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12,minWidth:240}} />
                            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Date début" style={{padding:'6px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}} />
                            <span style={{fontSize:11,color:'var(--gray-400)'}}>→</span>
                            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="Date fin" style={{padding:'6px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}} />
                            <select value={filterSource} onChange={e => setFilterSource(e.target.value)} title="Source" style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                <option value="">Toutes sources</option>
                                <option value="saisie">Saisie</option>
                                <option value="import">Import</option>
                            </select>
                            {currentProfile === 'magasinier' && <button onClick={() => { setForm({ date: new Date().toISOString().split('T')[0], lieu_source_type: 'magasin', lieu_source_id: 'F1', items: [{ ...emptyItem }] }); setBcCulture(''); setShowForm(true); }}
                                style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouveau bon
                            </button>}
                        </div>
                    </div>
                    <div className="table-responsive"><table className="data-table">
                        <thead><tr>
                            <th style={sortThStyle} onClick={() => toggleSort('numero')}>N° bon{sortArrow('numero')}</th>
                            <th style={sortThStyle} onClick={() => toggleSort('date')}>Date{sortArrow('date')}</th>
                            <th>Lieu (départ)</th>
                            <th style={sortThStyle} onClick={() => toggleSort('parcelles')}>Parcelle/Destination{sortArrow('parcelles')}</th>
                            <th>Article</th>
                            <th>Unité</th>
                            <th style={{textAlign:'right'}}>Quantité</th>
                        </tr></thead>
                        <tbody>
                            {filteredBcs.map((bc) => {
                                const lieuDepart = lieuSourceOf(bc);
                                const items = (bc.items && bc.items.length) ? bc.items : [null];
                                return items.map((item, itemIndex) => {
                                    const isFirst = itemIndex === 0;
                                    const rowStyle = {
                                        cursor: 'pointer',
                                        borderTop: isFirst ? '2px solid #e0e0e0' : '1px solid #f3f3f3',
                                    };
                                    return (
                                        <tr key={bc.id + '_' + itemIndex} onClick={() => setDetailBc(bc)} style={rowStyle}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,34,82,0.04)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
                                            <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{isFirst ? bc.numero : ''}</td>
                                            <td style={{fontSize:12}}>{isFirst ? (bc.date || '—') : ''}</td>
                                            <td style={{fontSize:12}}>{isFirst ? lieuDepart : ''}</td>
                                            <td style={{fontWeight:600,fontSize:12}}>{item ? (item.parcelle || bc.parcelle || '—') : (bc.parcelle || '—')}</td>
                                            <td style={{fontSize:12}}>{item ? (item.article || '—') : '—'}</td>
                                            <td style={{fontSize:12}}>{item ? (item.unite || '—') : '—'}</td>
                                            <td style={{fontSize:12,textAlign:'right'}}>{item && item.quantite != null ? item.quantite : '—'}</td>
                                        </tr>
                                    );
                                });
                            })}
                            {filteredBcs.length === 0 && <tr><td colSpan="7" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucun bon de consommation {label.toLowerCase()}.</td></tr>}
                        </tbody>
                    </table></div>

                    {showForm && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
                            <div className="modal-content" style={{maxWidth:800,maxHeight:'90vh',overflowY:'auto'}}>
                                <h3 style={{marginTop:0,color:'var(--berry)'}}><i className={'fa-solid ' + icon} style={{marginRight:8}}></i>Nouveau Bon de Consommation {label}</h3>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Lieu de départ *</label>
                                        <div style={{display:'flex',gap:6}}>
                                            <select value={form.lieu_source_type} onChange={e => setForm({...form, lieu_source_type: e.target.value, lieu_source_id: e.target.value === 'magasin' ? MAGASINS[0] : STATIONS[0]})} style={{padding:'8px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                                <option value="magasin">Magasin</option><option value="station">Station</option>
                                            </select>
                                            <select value={form.lieu_source_id} onChange={e => setForm({...form, lieu_source_id: e.target.value})} style={{flex:1,padding:'8px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                                {(form.lieu_source_type === 'magasin' ? MAGASINS : STATIONS).map(l => <option key={l} value={l}>{l}</option>)}
                                            </select>
                                        </div></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date</label>
                                        <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    {useConsoSelector && (
                                        <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Campagne</label>
                                            <select value={bcCampagne} onChange={e => setBcCampagne(e.target.value)} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                                {bcCampagnesDispo.map(c => <option key={'camp-' + c} value={c}>{c}</option>)}
                                            </select></div>
                                    )}
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Culture</label>
                                        <select value={bcCulture} onChange={e => changeBcCulture(e.target.value)} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value="">Toutes les cultures</option>
                                            {((window.CultureUtils && window.CultureUtils.CULTURES) || []).map(c => <option key={'cult-' + c} value={c}>{c}</option>)}
                                        </select>
                                        {aucuneParcellePourCulture && <div style={{fontSize:10,color:'#888',marginTop:4}}>Aucune parcelle pour cette culture</div>}</div>
                                </div>
                                <div style={{marginBottom:16}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}><i className="fa-solid fa-paperclip" style={{marginRight:4}}></i>Scanner le bon de consommation</label>
                                    <input type="file" accept="image/*,application/pdf" onChange={e => { const f = e.target.files[0]; if (f) { if (f.size > 10*1024*1024) { alert('Max 10 Mo'); return; } const r = new FileReader(); r.onload = ev => { setScanFileBC(ev.target.result); setScanPreviewBC(f.type.startsWith('image/') ? ev.target.result : f.name); }; r.readAsDataURL(f); }}} style={{fontSize:12}} />
                                    {scanPreviewBC && (typeof scanPreviewBC === 'string' && scanPreviewBC.startsWith('data:image') ? <img src={scanPreviewBC} alt="Scan" style={{maxHeight:80,marginTop:6,borderRadius:6}} /> : <span style={{fontSize:11,color:'var(--green)',marginLeft:8}}><i className="fa-solid fa-check"></i> Fichier sélectionné</span>)}
                                </div>
                                <h4 style={{fontSize:13,marginBottom:8}}>Articles a consommer</h4>
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                    <thead><tr style={{background:'#f8f8f8'}}><th style={{padding:'6px 8px',textAlign:'left'}}>Article</th><th style={{padding:'6px 8px',textAlign:'left',minWidth:140}}>Parcelle dest. *</th><th style={{padding:'6px 8px',width:70}}>Qte</th><th style={{padding:'6px 8px',width:60}}>Unite</th><th style={{padding:'6px 8px',width:70}}>Stock</th><th style={{width:30}}></th></tr></thead>
                                    <tbody>
                                        {form.items.map((it, idx) => { const dispo = getStock(it.article); const insuffisant = it.article && it.quantite && parseFloat(it.quantite) > dispo; return (
                                            <tr key={idx}><td>
                                                <input list={'stock-list-'+type} value={it.article} onChange={e => { const val = e.target.value; const items = [...form.items]; const next = { ...items[idx], article: val }; const u = catalogUnit(val); if (u) next.unite = u; items[idx] = next; setForm({ ...form, items }); }} placeholder="Article" style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} />
                                                <datalist id={'stock-list-'+type}>{catalogueArticles.map(a => <option key={a.id} value={a.nom}>{a.nom} (stock: {getStock(a.nom)})</option>)}</datalist>
                                                {canCreateArticle && (() => { const v = (it.article || '').trim(); if (!v || catalogueArticles.some(a => a.nom.toLowerCase() === v.toLowerCase())) return null; return (
                                                    <button type="button" onClick={() => openCreateArticle(idx, v)} title="Créer cet article au catalogue" style={{marginTop:3,padding:'2px 6px',borderRadius:5,border:'1px dashed var(--berry)',background:'var(--berry-pale)',color:'var(--berry)',cursor:'pointer',fontSize:10,fontWeight:600,whiteSpace:'nowrap'}}>
                                                        <i className="fa-solid fa-plus" style={{marginRight:3}}></i>Créer « {v.length > 18 ? v.slice(0,18)+'…' : v} »
                                                    </button>
                                                ); })()}
                                            </td>
                                            <td>
                                                <select value={it.groupe_id ? ('GRP::' + it.groupe_id) : it.parcelle} onChange={e => selectParcelleForItem(idx, e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:11}}>
                                                    <option value="">-- Parcelle --</option>
                                                    {parcelleGroupesCulture.length > 0 && (
                                                        <optgroup label="Groupes">
                                                            {parcelleGroupesCulture.map(g => <option key={'grp-' + g.id} value={'GRP::' + g.id}>{g.label} ({(g.membres || []).length} parcelles)</option>)}
                                                        </optgroup>
                                                    )}
                                                    {useConsoSelector ? (
                                                        <React.Fragment>
                                                            <optgroup label="Mes parcelles">
                                                                {refForCampagneCulture.map(p => <option key={'ref-' + p.label} value={p.label}>{p.label}</option>)}
                                                            </optgroup>
                                                        </React.Fragment>
                                                    ) : (
                                                        filteredParcellesCulture.map(p => <option key={p.Parcelle_Physique} value={p.Parcelle_Physique}>{p.Parcelle_Physique} — {p.Culture || '?'}</option>)
                                                    )}
                                                </select>
                                                {it.ferme && <div style={{fontSize:10,color:'#888',marginTop:2}}>{it.ferme} — {it.culture}</div>}
                                                {it.groupe_id && (() => {
                                                    // Aperçu LECTURE SEULE du split (le calcul qui fait foi est
                                                    // refait côté backend à la création du bon).
                                                    const g = parcelleGroupes.find(x => x.id === it.groupe_id);
                                                    if (!g || !window.ParcelleGroupUtils) return null;
                                                    const apercu = window.ParcelleGroupUtils.formatApercu(it.quantite, g.membres || [], it.unite);
                                                    return <div style={{fontSize:10,color:'var(--green)',marginTop:2,fontWeight:600}}>
                                                        <i className="fa-solid fa-object-group" style={{marginRight:4}}></i>
                                                        {apercu || 'Saisir une quantité pour voir la répartition'}
                                                    </div>;
                                                })()}
                                            </td>
                                            <td><input type="number" value={it.quantite} onChange={e => updateItem(idx,'quantite',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border: insuffisant ? '2px solid #e74c3c' : '1px solid #ddd',fontSize:12}} /></td>
                                            <td><select value={it.unite} onChange={e => updateItem(idx,'unite',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}}>{[...new Set(['kg', 'L', 'unité', 'carton', 'sac', 'bidon', ...(it.unite ? [it.unite] : [])])].map(u => <option key={u} value={u}>{u}</option>)}</select></td>
                                            <td style={{textAlign:'center',fontSize:11,color: insuffisant ? '#e74c3c' : 'var(--green)',fontWeight:600}}>{it.article ? dispo : '—'}</td>
                                            <td><button onClick={() => removeItem(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#e74c3c',fontSize:13}}><i className="fa-solid fa-trash"></i></button></td></tr>
                                        ); })}
                                    </tbody>
                                </table>
                                <button onClick={addItem} style={{marginTop:8,background:'none',border:'1px dashed #ddd',borderRadius:8,padding:'6px 16px',cursor:'pointer',fontSize:12,color:'var(--blue)'}}>+ Ajouter article</button>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                    <button onClick={() => setShowForm(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleCreate} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Creer le bon</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {showCreateArticle && (
                        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setShowCreateArticle(false); setCreateArticleLineIdx(null); } }} style={{zIndex:10001}}>
                            <div className="modal-content" style={{maxWidth:500,width:'90vw'}}>
                                <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-box" style={{marginRight:8}}></i>Nouvel Article</h3>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Référence *</label>
                                        <input value={newArticle.reference} onChange={e => setNewArticle({...newArticle, reference: e.target.value})} placeholder="REF-001" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Nom *</label>
                                        <input value={newArticle.nom} onChange={e => setNewArticle({...newArticle, nom: e.target.value})} placeholder="Nom de l'article" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Unité</label>
                                        <select value={newArticle.unite} onChange={e => setNewArticle({...newArticle, unite: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value="kg">kg</option><option value="L">L</option><option value="unité">unité</option><option value="carton">carton</option><option value="sac">sac</option><option value="bidon">bidon</option>
                                        </select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Catégorie</label>
                                        <select value={newArticle.categorie} onChange={e => setNewArticle({...newArticle, categorie: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value="autre">Autre</option><option value="engrais">Engrais</option><option value="phyto">Phyto</option><option value="emballage">Emballage</option><option value="materiel">Matériel</option>
                                        </select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>TVA %</label>
                                        <select value={newArticle.taux_tva} onChange={e => setNewArticle({...newArticle, taux_tva: parseFloat(e.target.value)})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value={0}>0%</option><option value={7}>7%</option><option value={10}>10%</option><option value={14}>14%</option><option value={20}>20%</option>
                                        </select></div>
                                </div>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                    <button onClick={() => { setShowCreateArticle(false); setCreateArticleLineIdx(null); }} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleCreateArticle} disabled={creatingArt} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13,opacity:creatingArt?0.6:1}}>
                                        {creatingArt ? 'Création...' : 'Créer l\'article'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {detailBc && (() => {
                        const bc = detailBc;
                        const fmtTs = (v) => {
                            if (!v) return null;
                            try {
                                if (typeof v === 'string') return v.length > 10 ? new Date(v).toLocaleString('fr-FR') : v;
                                if (v.seconds != null) return new Date(v.seconds * 1000).toLocaleString('fr-FR');
                                if (v._seconds != null) return new Date(v._seconds * 1000).toLocaleString('fr-FR');
                                if (v instanceof Date) return v.toLocaleString('fr-FR');
                            } catch (e) { return null; }
                            return null;
                        };
                        const items = bc.items || [];
                        const hasParcelle = items.some(i => i.parcelle);
                        const hasCulture = items.some(i => i.culture);
                        const scan = bc.scan_url || '';
                        const isHttpScan = /^https?:\/\//i.test(scan);
                        const isImgScan = isHttpScan && /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(scan);
                        const isGsScan = /^gs:\/\//i.test(scan);
                        const infoRow = (lbl, value) => value == null || value === '' ? null : (
                            <div style={{display:'flex',gap:8,padding:'3px 0'}}>
                                <span style={{minWidth:140,color:'var(--gray-400)',fontSize:12}}>{lbl}</span>
                                <span style={{fontSize:12,fontWeight:600,color:'#1e293b'}}>{value}</span>
                            </div>
                        );
                        return (
                            <div onClick={() => setDetailBc(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(2px)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
                                <div onClick={e => e.stopPropagation()} style={{background:'#fff',borderRadius:12,maxWidth:640,width:'100%',maxHeight:'85vh',overflow:'auto',padding:24,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,gap:12}}>
                                        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                                            <h3 style={{margin:0,color:'var(--berry)'}}><i className={'fa-solid ' + icon} style={{marginRight:8}}></i>Bon de Consommation {bc.numero || ''}</h3>
                                            {bc.status && <span className="status-badge" style={{fontSize:10}}>{bc.status}</span>}
                                        </div>
                                        <button onClick={() => setDetailBc(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:20,color:'var(--gray-400)',lineHeight:1}} title="Fermer">✕</button>
                                    </div>

                                    <div style={{marginBottom:16}}>
                                        {infoRow('Date', bc.date)}
                                        {infoRow('Lieu départ', bc.lieu_source?.id || bc.lieu_source_id)}
                                        {infoRow('Ferme', bc.ferme)}
                                        {infoRow('Type', bc.type)}
                                        {infoRow('Créé par', bc.created_by?.name)}
                                        {infoRow('Créé le', fmtTs(bc.created_at))}
                                        {infoRow('Autorisé par', bc.authorized_by?.name)}
                                    </div>

                                    {items.length > 0 && (
                                        <div style={{marginBottom:16}}>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Articles</h4>
                                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                                <thead><tr style={{background:'#f8f8f8',textAlign:'left'}}>
                                                    <th style={{padding:'6px 8px'}}>Article</th>
                                                    <th style={{padding:'6px 8px',textAlign:'right'}}>Quantité</th>
                                                    <th style={{padding:'6px 8px'}}>Unité</th>
                                                    {hasParcelle && <th style={{padding:'6px 8px'}}>Parcelle</th>}
                                                    {hasCulture && <th style={{padding:'6px 8px'}}>Culture</th>}
                                                </tr></thead>
                                                <tbody>
                                                    {items.map((i, idx) => (
                                                        <tr key={idx} style={{borderBottom:'1px solid #f0f0f0'}}>
                                                            <td style={{padding:'6px 8px'}}>{i.article || '—'}</td>
                                                            <td style={{padding:'6px 8px',textAlign:'right'}}>{i.quantite != null ? i.quantite : '—'}</td>
                                                            <td style={{padding:'6px 8px'}}>{i.unite || '—'}</td>
                                                            {hasParcelle && <td style={{padding:'6px 8px'}}>{i.parcelle || '—'}</td>}
                                                            {hasCulture && <td style={{padding:'6px 8px'}}>{i.culture || '—'}</td>}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {scan && (
                                        <div style={{marginBottom:16}}>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Scan du bon</h4>
                                            {isImgScan ? (
                                                <a href={scan} target="_blank" rel="noopener noreferrer">
                                                    <img src={scan} alt="Scan du bon" style={{maxWidth:'100%',maxHeight:280,borderRadius:8,border:'1px solid #eee',cursor:'zoom-in'}} />
                                                </a>
                                            ) : isHttpScan ? (
                                                <a href={scan} target="_blank" rel="noopener noreferrer" style={{color:'var(--blue)',fontSize:12}}><i className="fa-solid fa-paperclip" style={{marginRight:6}}></i>Voir le scan</a>
                                            ) : isGsScan ? (
                                                <span style={{fontSize:12,color:'var(--gray-400)'}}><i className="fa-solid fa-paperclip" style={{marginRight:6}}></i>Scan disponible (stockage interne)</span>
                                            ) : (
                                                <span style={{fontSize:12,color:'var(--gray-400)'}}><i className="fa-solid fa-paperclip" style={{marginRight:6}}></i>Scan disponible</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            );
        }

  window.MagBCTab = MagBCTab;
  window.MagBCEngraisTab = MagBCEngraisTab;
  window.MagBCPhytoTab = MagBCPhytoTab;
})();
