/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaisseTransactionsSub */
import { formatMAD } from '../finance/formatMAD.jsx';
import { CAISSE_STATUTS_EDITABLES, CAISSE_TYPES_EDITABLES, CAISSE_FIELD_LABELS } from './CAISSE_EDIT_CONSTS.jsx';
import { STATUS_LABELS } from '../shared/STATUS_LABELS.jsx';
import { useMemo, useState } from '../shared/reactHooks.jsx';
import { TXN_TYPE_LABELS } from './TXN_TYPE_LABELS.jsx';

// ---- Transactions List Sub ----
        function CaisseTransactionsSub({ caisses: caissesProp, isSaisie, isControle, onRefresh }) {
            const [transactions, setTransactions] = useState([]);
            // Transaction en cours de modification (pop-up d'édition). null = fermée.
            const [editTx, setEditTx] = useState(null);
            const [loading, setLoading] = useState(true);
            const [filterCaisse, setFilterCaisse] = useState('');
            const [filterStatus, setFilterStatus] = useState('');
            // Filtres par axes analytiques — client-side (les bons sont déjà chargés).
            const [filterAxes, setFilterAxes] = useState({ ferme: '', culture: '', parcelle: '', code_analytique: '' });
            const [filterDateFrom, setFilterDateFrom] = useState('');
            const [filterDateTo, setFilterDateTo] = useState('');
            const [selectedTx, setSelectedTx] = useState(null);
            const [localCaisses, setLocalCaisses] = useState([]);
            const [searchInput, setSearchInput] = useState('');       // Immediate input value
            const [searchQuery, setSearchQuery] = useState('');       // Debounced (200ms) — used by memo
            const searchInputRef = React.useRef(null);
            const [quickPeriod, setQuickPeriod] = useState('all');    // 'all' | 'today' | 'last7' | 'thisMonth' | 'lastMonth'
            const [quickType, setQuickType] = useState('all');        // 'all' | 'depenses' | 'recettes' | 'transferts' | 'controle'

            // Sprint 2 — multi-select + bulk actions
            const [selectedIds, setSelectedIds] = useState(() => new Set());
            const [bulkLoading, setBulkLoading] = useState(false);
            const [reassignOpen, setReassignOpen] = useState(false);
            const [reassignValue, setReassignValue] = useState('');
            const [toast, setToast] = useState(null); // { message, kind: 'success' | 'error' }
            const reassignDialogRef = React.useRef(null);

            // Sprint 2 — Tri par colonne. Default: date desc (chronologique inverse).
            // Cycle au clic header : null → asc → desc → null
            const [sortConfig, setSortConfig] = useState({ key: 'date', dir: 'desc' });

            // Use prop if non-empty, else fall back to locally-fetched caisses
            const caisses = (caissesProp && caissesProp.length > 0) ? caissesProp : localCaisses;

            // Debounce the search input → searchQuery (200ms)
            React.useEffect(() => {
                const t = setTimeout(() => setSearchQuery(searchInput), 200);
                return () => clearTimeout(t);
            }, [searchInput]);

            // -------- Sprint 2 — chaîne useMemo (anomaliesByTx calculé UNE seule fois) --------
            // transactions → searchedTransactions → filteredByType → anomaliesByTx
            //   → controlFiltered → (sortedTransactions Sprint 8) → totals
            //
            // Note : 'controle' est un quickType "synthétique" non géré par filterByQuickType.
            // filterByQuickType retourne la liste inchangée pour les types inconnus, donc
            // pour quickType='controle' on a filteredByType === searchedTransactions, puis
            // controlFiltered applique la formule (hasAnomaly && !accepted) || status !== 'valide'.

            const searchedTransactions = useMemo(
                () => (window.CaisseUtils ? window.CaisseUtils.searchTransactions(transactions, searchQuery) : transactions),
                [transactions, searchQuery]
            );

            const filteredByQuickType = useMemo(
                () => (window.CaisseUtils ? window.CaisseUtils.filterByQuickType(searchedTransactions, quickType) : searchedTransactions),
                [searchedTransactions, quickType]
            );

            // Filtres ferme / culture / parcelle / analytique. Placés AVANT la
            // détection d'anomalies pour que le compteur « À contrôler » suive
            // la vue affichée, comme le fait déjà le filtre de type.
            const filteredByType = useMemo(
                () => (window.CaisseUtils && window.CaisseUtils.filterByAxes
                    ? window.CaisseUtils.filterByAxes(filteredByQuickType, filterAxes)
                    : filteredByQuickType),
                [filteredByQuickType, filterAxes]
            );

            // Options des listes déroulantes : dérivées de TOUS les bons chargés,
            // pas de la vue filtrée — sinon choisir une ferme viderait les autres
            // listes et on ne pourrait plus revenir en arrière.
            const axeOptions = useMemo(() => {
                const CU = window.CaisseUtils;
                const d = (champ) => (CU && CU.distinctAxeValues ? CU.distinctAxeValues(transactions, champ) : []);
                return { ferme: d('ferme'), culture: d('culture'), parcelle: d('parcelle'), code_analytique: d('code_analytique') };
            }, [transactions]);

            const axesActifs = Object.keys(filterAxes).filter((k) => filterAxes[k] !== '').length;
            const setAxe = (champ, valeur) => setFilterAxes((cur) => ({ ...cur, [champ]: valeur }));
            const resetAxes = () => setFilterAxes({ ferme: '', culture: '', parcelle: '', code_analytique: '' });

            // detectAnomaliesBatch (Sprint 2) — combine Sprint 1 per-tx rules + 5 cross-dataset rules
            const anomaliesByTx = useMemo(() => {
                if (!window.CaisseUtils || !window.CaisseUtils.detectAnomaliesBatch) {
                    // Fallback Sprint 1 si le batch n'est pas chargé
                    const map = new Map();
                    if (window.CaisseUtils) {
                        const now = new Date();
                        for (const tx of filteredByType) {
                            const found = window.CaisseUtils.detectCaisseAnomalies(tx, now);
                            if (found && found.length > 0) map.set(tx.id || tx.reference, found);
                        }
                    }
                    return map;
                }
                return window.CaisseUtils.detectAnomaliesBatch(filteredByType, new Date());
            }, [filteredByType]);

            // Helper : tx a-t-elle des anomalies non acceptées ?
            const _hasUnacceptedAnomaly = (tx) => {
                const key = tx.id || tx.reference;
                if (!anomaliesByTx.has(key)) return false;
                return !tx.anomalies_acceptees_par; // tx avec acceptance → ne compte plus
            };

            // controlFiltered — appliquée seulement si quickType === 'controle'
            const controlFiltered = useMemo(() => {
                if (quickType !== 'controle') return filteredByType;
                return filteredByType.filter((tx) => _hasUnacceptedAnomaly(tx) || tx.status !== 'valide');
            }, [filteredByType, anomaliesByTx, quickType]);

            // N badge "À contrôler" — comptage sur filteredByType (pas controlFiltered, sinon
            // le compteur change avec lui-même quand la chip est active)
            const controlCount = useMemo(() => {
                return filteredByType.reduce((acc, tx) => {
                    return acc + ((_hasUnacceptedAnomaly(tx) || tx.status !== 'valide') ? 1 : 0);
                }, 0);
            }, [filteredByType, anomaliesByTx]);

            // Sprint 2 — Tri stable par colonne via sortConfig.
            // Stable sort via tiebreaker sur l'index original (Array.sort est stable depuis ES2019
            // mais on garde le tiebreaker explicite pour la robustesse).
            const sortedTransactions = useMemo(() => {
                if (!sortConfig || !sortConfig.key || !sortConfig.dir) return controlFiltered;
                const sign = sortConfig.dir === 'asc' ? 1 : -1;
                const key = sortConfig.key;
                // Build comparator value selector per column key
                const getKey = (tx) => {
                    if (key === 'date')            return tx.date || '';
                    if (key === 'caisse_id')       return (caisses.find((c) => c.id === tx.caisse_id) || {}).nom || tx.caisse_id || '';
                    if (key === 'type')            return (TXN_TYPE_LABELS[tx.type] || {}).label || tx.type || '';
                    if (key === 'reference')       return tx.reference || '';
                    if (key === 'description')     return (tx.description || '').toLowerCase();
                    if (key === 'code_analytique') return (tx.code_analytique || '').toLowerCase();
                    if (key === 'montant')         return Number(tx.montant) || 0;
                    if (key === 'status')          return (STATUS_LABELS[tx.status] || {}).label || tx.status || '';
                    // Axes analytiques (ferme / campagne / culture / parcelle)
                    if (key === 'ferme')           return (tx.ferme || '').toLowerCase();
                    if (key === 'campagne')        return tx.campagne || '';
                    if (key === 'culture')         return (tx.culture || '').toLowerCase();
                    if (key === 'parcelle')        return (tx.parcelle || '').toLowerCase();
                    return '';
                };
                const indexed = controlFiltered.map((tx, i) => ({ tx, i, k: getKey(tx) }));
                indexed.sort((a, b) => {
                    if (a.k < b.k) return -1 * sign;
                    if (a.k > b.k) return  1 * sign;
                    return a.i - b.i; // tiebreaker stable
                });
                return indexed.map((x) => x.tx);
            }, [controlFiltered, sortConfig, caisses]);

            const displayedTransactions = sortedTransactions;

            // Helper : cycle on header click — null → asc → desc → null
            const cycleSort = (key) => {
                setSortConfig((cur) => {
                    if (!cur || cur.key !== key) return { key, dir: 'asc' };
                    if (cur.dir === 'asc')        return { key, dir: 'desc' };
                    if (cur.dir === 'desc')       return { key: null, dir: null };
                    return { key, dir: 'asc' };
                });
            };
            // Droit de modifier un bon — MIROIR COSMÉTIQUE de la garde backend
            // (update-transaction). La garde qui fait foi est côté serveur : ce
            // helper ne sert qu'à ne pas proposer un bouton qui échouerait.
            const canEditTx = (tx) => {
                if (!tx || !window.CaisseSaisieSub) return false;
                if (CAISSE_STATUTS_EDITABLES.indexOf(tx.status) === -1) return false;
                if (CAISSE_TYPES_EDITABLES.indexOf(tx.type) === -1) return false;
                // Tout profil ayant accès à la caisse voit l'action. La propriété
                // (« Achats ne modifie que ses propres saisies ») est vérifiée par
                // le BACKEND, qui renvoie un 403 explicite. La masquer ici rendait
                // la fonctionnalité invisible sans dire pourquoi.
                return !!(isSaisie || isControle);
            };

            // Rendu lisible d'une valeur d'historique selon le champ.
            const formatChangeValue = (field, value) => {
                if (field === 'montant') return formatMAD(Number(value) || 0);
                if (field === 'caisse_id') return (caisses.find(c => c.id === value) || {}).nom || value || '—';
                if (field === 'type') return (TXN_TYPE_LABELS[value] || {}).label || value || '—';
                if (field === 'files') return `${value} photo(s)`;
                return (value === '' || value === undefined || value === null) ? '—' : String(value);
            };

            // Helper : indicator glyph per column
            const sortIndicator = (key) => {
                if (!sortConfig || sortConfig.key !== key || !sortConfig.dir) return '⇅';
                return sortConfig.dir === 'asc' ? '↑' : '↓';
            };

            // Totaux footer (recalculés sur la liste affichée)
            const totals = useMemo(
                () => (window.CaisseUtils ? window.CaisseUtils.computeTotals(displayedTransactions) : { count: displayedTransactions.length, totalDepensesOp: 0, totalRecettes: 0, totalTransfers: 0, soldeNet: 0 }),
                [displayedTransactions]
            );

            // Apply quick period chip → updates filterDateFrom/filterDateTo (which re-triggers API load)
            const applyQuickPeriod = (period) => {
                setQuickPeriod(period);
                const range = window.CaisseUtils ? window.CaisseUtils.quickPeriodToDateRange(period) : null;
                if (range === null) {
                    setFilterDateFrom('');
                    setFilterDateTo('');
                } else {
                    setFilterDateFrom(range.from);
                    setFilterDateTo(range.to);
                }
            };

            // When user manually changes a date picker, deactivate the quick period chip
            const onManualDateChange = (which, value) => {
                if (which === 'from') setFilterDateFrom(value);
                else setFilterDateTo(value);
                if (quickPeriod !== 'all') setQuickPeriod('all');
            };

            // Keyboard shortcut: '/' to focus search, 'Escape' to clear + blur (when focused)
            React.useEffect(() => {
                const onKeyDown = (e) => {
                    const tag = (e.target && e.target.tagName) || '';
                    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
                    if (e.key === '/' && !inField) {
                        e.preventDefault();
                        if (searchInputRef.current) searchInputRef.current.focus();
                    } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
                        setSearchInput('');
                        if (searchInputRef.current) searchInputRef.current.blur();
                    }
                };
                window.addEventListener('keydown', onKeyDown);
                return () => window.removeEventListener('keydown', onKeyDown);
            }, []);

            // Fetch caisses directly if prop is empty (defensive — avoid empty dropdown)
            React.useEffect(() => {
                if (!caissesProp || caissesProp.length === 0) {
                    fetch('/api/caisse?action=list-caisses').then(r => r.json()).then(json => {
                        if (json.success) setLocalCaisses(json.caisses || []);
                    }).catch(() => {});
                }
            }, [caissesProp]);

            const load = () => {
                setLoading(true);
                let url = '/api/caisse?action=list-transactions&limit=500';
                if (filterCaisse) url += '&caisse_id=' + encodeURIComponent(filterCaisse);
                if (filterStatus) url += '&status=' + encodeURIComponent(filterStatus);
                if (filterDateFrom) url += '&date_from=' + filterDateFrom;
                if (filterDateTo) url += '&date_to=' + filterDateTo;
                fetch(url).then(r => r.json()).then(json => {
                    if (json.success) setTransactions(json.transactions || []);
                    else { console.warn('list-transactions error:', json.error); setTransactions([]); }
                }).catch(err => { console.warn('list-transactions failed:', err); setTransactions([]); }).finally(() => setLoading(false));
            };

            React.useEffect(() => { load(); }, [filterCaisse, filterStatus, filterDateFrom, filterDateTo]);

            const exportExcel = () => {
                if (!window.XLSX) return alert('XLSX non disponible');
                // Export the visible (post-filter, post-search) list so what you see is what you export.
                const exportList = (typeof displayedTransactions !== 'undefined' && displayedTransactions) ? displayedTransactions : transactions;
                const ws = XLSX.utils.json_to_sheet(exportList.map(tx => ({
                    Date: tx.date, Caisse: caisses.find(c=>c.id===tx.caisse_id)?.nom||tx.caisse_id,
                    Type: TXN_TYPE_LABELS[tx.type]?.label||tx.type, Référence: tx.reference,
                    Description: tx.description, Montant: tx.montant, 'Code Analytique': tx.code_analytique, Statut: STATUS_LABELS[tx.status]?.label||tx.status,
                    Ferme: tx.ferme||'', Campagne: tx.campagne||'', Culture: tx.culture||'', Parcelle: tx.parcelle||'',
                    'Saisi par': tx.saisie_by?.name||'',
                })));
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
                XLSX.writeFile(wb, `Caisse_Transactions_${new Date().toISOString().slice(0,10)}.xlsx`);
            };

            // Chip style helpers
            const chipStyle = (active) => ({
                padding: '5px 12px', borderRadius: 14, fontSize: 11.5, fontWeight: active ? 600 : 500,
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
                border: active ? '1px solid var(--berry)' : '1px solid var(--gray-200)',
                background: active ? 'var(--berry)' : 'var(--gray-100)',
                color: active ? 'white' : 'var(--gray-800)',
            });
            const periodChips = [
                { id: 'all',       label: 'Tout' },
                { id: 'today',     label: "Aujourd'hui" },
                { id: 'last7',     label: '7 jours' },
                { id: 'thisMonth', label: 'Ce mois' },
                { id: 'lastMonth', label: 'Mois dernier' },
            ];
            const typeChips = [
                { id: 'all',        label: 'Tous' },
                { id: 'depenses',   label: 'Dépenses' },
                { id: 'recettes',   label: 'Recettes' },
                { id: 'transferts', label: 'Transferts' },
                { id: 'controle',   label: 'À contrôler', badge: controlCount },
            ];

            // Accepter toutes les anomalies des tx visibles (vue À contrôler uniquement)
            const [acceptLoading, setAcceptLoading] = useState(false);
            const acceptAllVisibleAnomalies = async () => {
                if (acceptLoading) return;
                const ids = displayedTransactions
                    .filter((tx) => _hasUnacceptedAnomaly(tx))
                    .map((tx) => tx.id)
                    .filter(Boolean);
                if (ids.length === 0) { alert('Aucune anomalie à accepter dans la vue actuelle.'); return; }
                if (!window.confirm(`Accepter les anomalies de ${ids.length} transaction(s) ? Elles ne seront plus marquées 🚩 et ne compteront plus dans "À contrôler".`)) return;
                setAcceptLoading(true);
                try {
                    const r = await fetch('/api/caisse?action=accept-anomalies-batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ids }),
                    });
                    const json = await r.json();
                    if (json && json.success) {
                        load(); // re-fetch to pick up anomalies_acceptees_par from server
                    } else {
                        alert('Erreur acceptation : ' + ((json && json.error) || 'inconnue'));
                    }
                } catch (err) {
                    alert('Erreur réseau : ' + err.message);
                } finally {
                    setAcceptLoading(false);
                }
            };

            // ---- Selection helpers ----
            const toggleOne = (id, ev) => {
                if (ev) ev.stopPropagation();
                setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                });
            };
            // visibleIds : ids actuellement affichés (post-recherche, post-filtres)
            // (Sprint 8 ajoutera le tri — fonctionnera toujours, displayedTransactions sera la liste finale)
            const visibleIds = useMemo(() => displayedTransactions.map((tx) => tx.id).filter(Boolean), [displayedTransactions]);
            const allVisibleSelected = useMemo(() => {
                if (visibleIds.length === 0) return false;
                for (const id of visibleIds) if (!selectedIds.has(id)) return false;
                return true;
            }, [visibleIds, selectedIds]);
            const toggleAllVisible = (checked) => {
                setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (checked) { for (const id of visibleIds) next.add(id); }
                    else         { for (const id of visibleIds) next.delete(id); }
                    return next;
                });
            };
            const clearSelection = () => setSelectedIds(new Set());

            // Toast helper — auto-dismiss after 2s
            const showToast = (message, kind) => {
                setToast({ message, kind: kind || 'success' });
                setTimeout(() => setToast((cur) => (cur && cur.message === message ? null : cur)), 2200);
            };

            // ---- Bulk action handlers ----
            const _postBulk = async (action, body) => {
                setBulkLoading(true);
                try {
                    const r = await fetch('/api/caisse?action=' + action, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    const json = await r.json();
                    if (!json || !json.success) { showToast('Erreur : ' + ((json && json.error) || 'inconnue'), 'error'); return null; }
                    return json;
                } catch (err) {
                    showToast('Erreur réseau : ' + err.message, 'error');
                    return null;
                } finally {
                    setBulkLoading(false);
                }
            };
            // bulkValidate SUPPRIMÉ : plus de validation en masse. Un bon qui
            // engage le solde se valide un par un dans la revue DG.
            const bulkMarkRevoir = async () => {
                const ids = Array.from(selectedIds);
                if (ids.length === 0) return;
                const motif = window.prompt(`Marquer ${ids.length} transaction(s) "À revoir". Motif (optionnel) :`, '');
                if (motif === null) return;
                const json = await _postBulk('mark-revoir-batch', { ids, motif });
                if (json) {
                    showToast(`${json.count || ids.length} transactions marquées à revoir`);
                    clearSelection();
                    load();
                }
            };
            const bulkReassign = async () => {
                if (selectedIds.size === 0) return;
                setReassignValue('');
                setReassignOpen(true);
                // Open native <dialog> via ref after state update
                setTimeout(() => { if (reassignDialogRef.current && reassignDialogRef.current.showModal) reassignDialogRef.current.showModal(); }, 0);
            };
            const confirmReassign = async () => {
                const ids = Array.from(selectedIds);
                const code = (reassignValue || '').trim();
                if (!code) { alert('Veuillez choisir un analytique'); return; }
                const json = await _postBulk('reassign-analytique-batch', { ids, code_analytique: code });
                if (json) {
                    showToast(`Analytique réaffecté sur ${json.count || ids.length} transaction(s)`);
                    if (reassignDialogRef.current && reassignDialogRef.current.close) reassignDialogRef.current.close();
                    setReassignOpen(false);
                    clearSelection();
                    load();
                }
            };
            const cancelReassign = () => {
                if (reassignDialogRef.current && reassignDialogRef.current.close) reassignDialogRef.current.close();
                setReassignOpen(false);
            };
            const bulkExport = () => {
                if (!window.XLSX) return alert('XLSX non disponible');
                const ids = selectedIds;
                const subset = displayedTransactions.filter((tx) => ids.has(tx.id));
                if (subset.length === 0) return;
                const ws = XLSX.utils.json_to_sheet(subset.map((tx) => ({
                    Date: tx.date,
                    Caisse: caisses.find((c) => c.id === tx.caisse_id)?.nom || tx.caisse_id,
                    Type: (TXN_TYPE_LABELS[tx.type] || {}).label || tx.type,
                    Référence: tx.reference,
                    Description: tx.description,
                    Montant: tx.montant,
                    'Code Analytique': tx.code_analytique,
                    Statut: (STATUS_LABELS[tx.status] || {}).label || tx.status,
                    Ferme: tx.ferme || '',
                    Campagne: tx.campagne || '',
                    Culture: tx.culture || '',
                    Parcelle: tx.parcelle || '',
                    'Saisi par': (tx.saisie_by && tx.saisie_by.name) || '',
                })));
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Sélection');
                XLSX.writeFile(wb, `Caisse_Selection_${new Date().toISOString().slice(0, 10)}.xlsx`);
            };

            // Distinct analytiques (sorted) for the reassign dialog
            const distinctAnalytiques = useMemo(() => {
                const set = new Set();
                for (const tx of transactions) {
                    const a = (tx && tx.code_analytique || '').toString().trim();
                    if (a) set.add(a);
                }
                return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
            }, [transactions]);

            return (
                <div>
                    {/* Quick filter chips — period */}
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8,alignItems:'center'}}>
                        <span style={{fontSize:10.5,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:0.5,marginRight:6,fontWeight:600}}>Période</span>
                        {periodChips.map(c => (
                            <button key={c.id} data-chip-period={c.id} onClick={() => applyQuickPeriod(c.id)} style={chipStyle(quickPeriod === c.id)}>{c.label}</button>
                        ))}
                    </div>
                    {/* Quick filter chips — type */}
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16,alignItems:'center'}}>
                        <span style={{fontSize:10.5,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:0.5,marginRight:6,fontWeight:600}}>Type</span>
                        {typeChips.map(c => (
                            <button key={c.id} data-chip-type={c.id} onClick={() => setQuickType(c.id)} style={chipStyle(quickType === c.id)}>
                                {c.label}
                                {c.id === 'controle' && c.badge > 0 && (
                                    <span style={{marginLeft:6,padding:'1px 7px',borderRadius:10,background:'#E74C3C',color:'white',fontSize:10,fontWeight:700}}>{c.badge}</span>
                                )}
                            </button>
                        ))}
                    </div>
                    {/* Filters */}
                    <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16,alignItems:'center'}}>
                        {/* Global search */}
                        <div data-testid="caisse-search" style={{position:'relative',flex:'1 1 280px',maxWidth:420,minWidth:220}}>
                            <i className="fa-solid fa-magnifying-glass" style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',fontSize:12,color:'var(--gray-400)',pointerEvents:'none'}}></i>
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchInput}
                                onChange={e => setSearchInput(e.target.value)}
                                placeholder="Rechercher (description, référence, montant, bénéficiaire)…  ( / )"
                                aria-label="Recherche transactions"
                                style={{width:'100%',padding:'8px 32px 8px 32px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}}
                            />
                            {searchInput && (
                                <button onClick={() => { setSearchInput(''); if (searchInputRef.current) searchInputRef.current.focus(); }}
                                    aria-label="Effacer la recherche"
                                    style={{position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'var(--gray-400)',cursor:'pointer',padding:4,fontSize:14}}>
                                    <i className="fa-solid fa-xmark"></i>
                                </button>
                            )}
                        </div>
                        <select value={filterCaisse} onChange={e=>setFilterCaisse(e.target.value)} style={{padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}}>
                            <option value="">Toutes les caisses</option>
                            {caisses.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                        </select>
                        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}}>
                            <option value="">Tous statuts</option>
                            <option value="brouillon">Brouillon</option>
                            <option value="soumis">Saisi</option>
                            <option value="a_revoir">À revoir</option>
                            <option value="valide">Validé</option>
                            <option value="rejete">Rejeté</option>
                        </select>
                        {/* Libellés VISIBLES : un input[type=date] n'affiche jamais son
                            placeholder, les deux champs passaient donc pour des dates
                            déjà saisies au lieu d'un filtre à remplir. */}
                        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--gray-600)'}}>
                            Du
                            <input type="date" value={filterDateFrom} onChange={e=>onManualDateChange('from', e.target.value)} aria-label="Filtrer à partir du"
                                style={{padding:'8px 12px',borderRadius:8,fontSize:12,
                                    border: filterDateFrom ? '1px solid var(--berry)' : '1px solid var(--gray-200)'}} />
                        </label>
                        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--gray-600)'}}>
                            Au
                            <input type="date" value={filterDateTo} onChange={e=>onManualDateChange('to', e.target.value)} aria-label="Filtrer jusqu'au"
                                style={{padding:'8px 12px',borderRadius:8,fontSize:12,
                                    border: filterDateTo ? '1px solid var(--berry)' : '1px solid var(--gray-200)'}} />
                        </label>
                        {(filterDateFrom || filterDateTo) && (
                            <button onClick={()=>{ onManualDateChange('from',''); onManualDateChange('to',''); }}
                                aria-label="Effacer le filtre de dates"
                                style={{padding:'7px 10px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:12,color:'var(--gray-600)'}}>
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        )}
                        <button onClick={exportExcel} style={{padding:'8px 14px',borderRadius:8,background:'var(--green)',color:'white',border:'none',cursor:'pointer',fontSize:12,fontWeight:600,marginLeft:'auto'}}>
                            <i className="fa-solid fa-file-excel" style={{marginRight:4}}></i>Exporter
                        </button>
                    </div>

                    {/* Filtres par axes analytiques — ferme / culture / parcelle / analytique.
                        Client-side : les bons sont déjà chargés, aucun aller-retour serveur. */}
                    <div data-testid="caisse-axes-filters"
                        style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:12}}>
                        <span style={{fontSize:11,fontWeight:700,color:'var(--gray-400)',letterSpacing:0.4}}>AFFECTATION</span>
                        {[
                            { champ: 'ferme',           label: 'Toutes les fermes' },
                            { champ: 'culture',         label: 'Toutes les cultures' },
                            { champ: 'parcelle',        label: 'Toutes les parcelles' },
                            { champ: 'code_analytique', label: 'Tous les analytiques' },
                        ].map(({ champ, label }) => (
                            <select key={champ} value={filterAxes[champ]} onChange={e=>setAxe(champ, e.target.value)}
                                aria-label={label}
                                style={{padding:'8px 12px',borderRadius:8,fontSize:12,maxWidth:230,
                                    border: filterAxes[champ] ? '1px solid var(--berry)' : '1px solid var(--gray-200)',
                                    background: filterAxes[champ] ? 'var(--berry-pale)' : 'white',
                                    fontWeight: filterAxes[champ] ? 600 : 400}}>
                                <option value="">{label}</option>
                                <option value={(window.CaisseUtils && window.CaisseUtils.AXE_NON_RENSEIGNE) || '__VIDE__'}>— Non renseigné —</option>
                                {axeOptions[champ].map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                        ))}
                        {axesActifs > 0 && (
                            <button onClick={resetAxes}
                                style={{padding:'7px 12px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:12,color:'var(--gray-600)'}}>
                                <i className="fa-solid fa-xmark" style={{marginRight:4}}></i>
                                Réinitialiser ({axesActifs})
                            </button>
                        )}
                    </div>

                    {/* Sprint 2 — Sticky bulk actions bar (visible when selection > 0) */}
                    {selectedIds.size > 0 && (
                        <div data-testid="caisse-bulk-bar"
                            style={{position:'sticky',top:0,zIndex:5,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',padding:'10px 14px',marginBottom:12,background:'var(--berry)',color:'white',borderRadius:10,boxShadow:'0 2px 8px rgba(139,34,82,0.25)'}}>
                            <span style={{fontWeight:600,fontSize:13,marginRight:8}}>
                                <i className="fa-solid fa-square-check" style={{marginRight:6}}></i>
                                {selectedIds.size} sélectionnée{selectedIds.size > 1 ? 's' : ''}
                            </span>
                            {/* Validation en masse RETIRÉE (décision Omar, 2026-08-26) : un bon
                                qui engage le solde se valide un par un, dans la revue DG, en
                                ayant vu le montant et le justificatif. Les actions groupées
                                restantes ne touchent pas au solde. */}
                            <button onClick={bulkMarkRevoir} disabled={bulkLoading}
                                style={{padding:'6px 12px',borderRadius:6,border:'none',background:'#F39C12',color:'white',cursor:'pointer',fontSize:12,fontWeight:600,opacity:bulkLoading?0.6:1}}>
                                <i className="fa-solid fa-rotate-right" style={{marginRight:4}}></i>Marquer à revoir
                            </button>
                            <button onClick={bulkReassign} disabled={bulkLoading}
                                style={{padding:'6px 12px',borderRadius:6,border:'1px solid white',background:'transparent',color:'white',cursor:'pointer',fontSize:12,fontWeight:600,opacity:bulkLoading?0.6:1}}>
                                <i className="fa-solid fa-tags" style={{marginRight:4}}></i>Réaffecter analytique…
                            </button>
                            <button onClick={bulkExport} disabled={bulkLoading}
                                style={{padding:'6px 12px',borderRadius:6,border:'1px solid white',background:'transparent',color:'white',cursor:'pointer',fontSize:12,fontWeight:600,opacity:bulkLoading?0.6:1}}>
                                <i className="fa-solid fa-file-excel" style={{marginRight:4}}></i>Exporter sélection
                            </button>
                            <button onClick={clearSelection} disabled={bulkLoading}
                                aria-label="Désélectionner tout"
                                style={{marginLeft:'auto',padding:'6px 10px',borderRadius:6,border:'none',background:'rgba(255,255,255,0.18)',color:'white',cursor:'pointer',fontSize:12,fontWeight:600}}>
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    )}

                    {/* Reassign analytique dialog (HTML5 <dialog> natif) */}
                    {reassignOpen && (
                        <dialog ref={reassignDialogRef} onClose={() => setReassignOpen(false)}
                            style={{border:'none',borderRadius:12,padding:0,maxWidth:480,width:'90%',boxShadow:'0 10px 30px rgba(0,0,0,0.2)'}}>
                            <div style={{padding:'20px 22px'}}>
                                <h3 style={{margin:'0 0 14px',fontSize:15,color:'var(--berry)'}}>
                                    <i className="fa-solid fa-tags" style={{marginRight:6}}></i>
                                    Réaffecter l'analytique
                                </h3>
                                <div style={{fontSize:12.5,color:'var(--gray-600)',marginBottom:14}}>
                                    Appliquer un nouvel analytique aux {selectedIds.size} transaction(s) sélectionnée(s).
                                </div>
                                <label style={{fontSize:11.5,fontWeight:600,color:'var(--gray-800)',display:'block',marginBottom:6}}>Code analytique</label>
                                <select value={reassignValue} onChange={(e) => setReassignValue(e.target.value)}
                                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,marginBottom:14}}>
                                    <option value="">— Choisir un analytique —</option>
                                    {distinctAnalytiques.map((a) => (<option key={a} value={a}>{a}</option>))}
                                </select>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                    <button onClick={cancelReassign}
                                        style={{padding:'8px 14px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:12}}>Annuler</button>
                                    <button onClick={confirmReassign} disabled={bulkLoading || !reassignValue}
                                        style={{padding:'8px 14px',borderRadius:8,border:'none',background:'var(--berry)',color:'white',cursor:'pointer',fontSize:12,fontWeight:600,opacity:(bulkLoading || !reassignValue)?0.5:1}}>
                                        {bulkLoading ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:4}}></i>Application…</> : 'Appliquer'}
                                    </button>
                                </div>
                            </div>
                        </dialog>
                    )}

                    {/* Toast (bottom-right) */}
                    {toast && (
                        <div data-testid="caisse-toast"
                            style={{position:'fixed',right:18,bottom:18,zIndex:1000,padding:'10px 16px',borderRadius:8,background:toast.kind==='error'?'#E74C3C':'#1A7A3F',color:'white',fontSize:12.5,fontWeight:600,boxShadow:'0 4px 14px rgba(0,0,0,0.18)'}}>
                            <i className={`fa-solid ${toast.kind==='error'?'fa-triangle-exclamation':'fa-circle-check'}`} style={{marginRight:6}}></i>
                            {toast.message}
                        </div>
                    )}

                    {loading ? (
                        <div style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:20,color:'var(--berry)'}}></i></div>
                    ) : transactions.length === 0 ? (
                        <div style={{textAlign:'center',padding:40,color:'var(--gray-400)',fontSize:13}}>Aucune transaction trouvée</div>
                    ) : displayedTransactions.length === 0 ? (
                        <div style={{textAlign:'center',padding:40,color:'var(--gray-400)',fontSize:13}}>
                            <i className="fa-solid fa-filter" style={{marginRight:6}}></i>
                            Aucun résultat {searchQuery ? `pour « ${searchQuery} »` : 'pour les filtres appliqués'}
                            <div style={{marginTop:8,display:'flex',gap:8,justifyContent:'center'}}>
                                {searchQuery && <button onClick={() => setSearchInput('')} style={{padding:'4px 12px',borderRadius:6,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:11}}>Effacer la recherche</button>}
                                {quickType !== 'all' && <button onClick={() => setQuickType('all')} style={{padding:'4px 12px',borderRadius:6,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:11}}>Réinitialiser type</button>}
                                {quickPeriod !== 'all' && <button onClick={() => applyQuickPeriod('all')} style={{padding:'4px 12px',borderRadius:6,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:11}}>Réinitialiser période</button>}
                            </div>
                        </div>
                    ) : (
                        <div>
                            {/* "Accepter toutes les anomalies visibles" — visible uniquement en vue 'controle' */}
                            {quickType === 'controle' && (() => {
                                const nUnaccepted = displayedTransactions.filter(_hasUnacceptedAnomaly).length;
                                if (nUnaccepted === 0) return null;
                                return (
                                    <div data-testid="caisse-accept-all-bar" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'10px 14px',marginBottom:10,background:'rgba(212,168,71,0.08)',border:'1px solid rgba(212,168,71,0.3)',borderRadius:10}}>
                                        <div style={{fontSize:12.5,color:'var(--gray-800)'}}>
                                            <i className="fa-solid fa-flag" style={{color:'#E67E22',marginRight:6}}></i>
                                            <strong>{nUnaccepted}</strong> transaction(s) visibles avec anomalies non acceptées.
                                        </div>
                                        <button onClick={acceptAllVisibleAnomalies} disabled={acceptLoading}
                                            style={{padding:'7px 14px',borderRadius:8,border:'none',background:'var(--berry)',color:'white',cursor:'pointer',fontSize:12,fontWeight:600,opacity:acceptLoading?0.6:1}}>
                                            {acceptLoading
                                                ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:5}}></i>Acceptation…</>
                                                : <><i className="fa-solid fa-check-double" style={{marginRight:5}}></i>Accepter toutes les anomalies visibles</>}
                                        </button>
                                    </div>
                                );
                            })()}
                        <div style={{background:'white',borderRadius:12,border:'1px solid var(--gray-200)',overflow:'hidden'}}>
                            <div style={{overflowX:'auto'}}>
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                    <thead><tr style={{background:'var(--gray-100)'}}>
                                        <th style={{padding:'10px 6px',textAlign:'center',fontWeight:600,color:'var(--gray-600)',width:32}} title="Anomalies détectées">⚠</th>
                                        <th style={{padding:'10px 6px',textAlign:'center',width:32}}>
                                            <input type="checkbox" data-testid="caisse-select-all"
                                                checked={allVisibleSelected} onChange={(e) => toggleAllVisible(e.target.checked)}
                                                aria-label="Sélectionner toutes les transactions visibles"
                                                style={{cursor:'pointer'}} />
                                        </th>
                                        {(() => {
                                            const baseTh = { padding:'10px 12px', fontWeight:600, color:'var(--gray-600)', cursor:'pointer', userSelect:'none' };
                                            const cols = [
                                                { key: 'date',            label: 'Date',        align: 'left'  },
                                                { key: 'caisse_id',       label: 'Caisse',      align: 'left'  },
                                                { key: 'type',            label: 'Type',        align: 'left'  },
                                                { key: 'reference',       label: 'Réf.',        align: 'left'  },
                                                { key: 'description',     label: 'Description', align: 'left'  },
                                                { key: 'code_analytique', label: 'Analytique',  align: 'left'  },
                                                { key: 'ferme',           label: 'Ferme',       align: 'left'  },
                                                // Campagne volontairement ABSENTE du tableau : déductible de
                                                // la colonne Date, elle ne payait pas sa largeur. Elle reste
                                                // dans le détail, l'export et la recherche.
                                                { key: 'culture',         label: 'Culture',     align: 'left'  },
                                                { key: 'parcelle',        label: 'Parcelle',    align: 'left'  },
                                                { key: 'montant',         label: 'Montant',     align: 'right' },
                                                { key: 'status',          label: 'Statut',      align: 'center'},
                                            ];
                                            return cols.map((c) => (
                                                <th key={c.key} data-sort-key={c.key}
                                                    onClick={() => cycleSort(c.key)}
                                                    title={`Trier par ${c.label}`}
                                                    style={{ ...baseTh, textAlign: c.align }}>
                                                    {c.label}
                                                    <span style={{marginLeft:6,fontSize:10,color: (sortConfig && sortConfig.key === c.key && sortConfig.dir) ? 'var(--berry)' : 'var(--gray-400)'}}>
                                                        {sortIndicator(c.key)}
                                                    </span>
                                                </th>
                                            ));
                                        })()}
                                        {/* « Saisi par » retirée du tableau pour que tout tienne
                                            en un seul écran. L'info reste dans la pop-up de
                                            détail et dans les deux exports Excel. */}
                                        <th style={{padding:'10px 6px',textAlign:'center',fontWeight:600,color:'var(--gray-600)',width:44}} title="Modifier le bon">✎</th>
                                    </tr></thead>
                                    <tbody>
                                        {displayedTransactions.map((tx, i) => {
                                            const tt = TXN_TYPE_LABELS[tx.type]||{};
                                            const ss = STATUS_LABELS[tx.status]||{};
                                            const txAnomalies = anomaliesByTx.get(tx.id || tx.reference) || null;
                                            const hasAnomaly = !!txAnomalies;
                                            const anomaliesAccepted = hasAnomaly && !!tx.anomalies_acceptees_par;
                                            // Fond ligne : jaune pâle si anomalies non acceptées, blanc sinon
                                            const baseBg = (hasAnomaly && !anomaliesAccepted) ? '#FEF9E7' : '';
                                            // Tooltip pour anomalies acceptées
                                            const acceptedTooltip = (() => {
                                                if (!anomaliesAccepted) return '';
                                                const who = (tx.anomalies_acceptees_par && tx.anomalies_acceptees_par.name) || '—';
                                                const when = tx.anomalies_acceptees_at ? new Date(tx.anomalies_acceptees_at.toMillis ? tx.anomalies_acceptees_at.toMillis() : tx.anomalies_acceptees_at).toLocaleDateString('fr-FR') : '—';
                                                const list = txAnomalies.map(a => `• ${a.message}`).join('\n');
                                                return `Anomalies acceptées par ${who} le ${when}\n\n${list}`;
                                            })();
                                            return (
                                                <tr key={tx.id||i} data-anomaly={hasAnomaly ? '1' : '0'} data-anomaly-accepted={anomaliesAccepted ? '1' : '0'} onClick={()=>setSelectedTx(tx)} style={{borderBottom:'1px solid var(--gray-100)',cursor:'pointer',transition:'background 0.15s',background:baseBg}}
                                                    onMouseEnter={e=>e.currentTarget.style.background='var(--berry-pale)'} onMouseLeave={e=>e.currentTarget.style.background=baseBg}>
                                                    <td style={{padding:'10px 6px',textAlign:'center'}}>
                                                        {hasAnomaly && !anomaliesAccepted && (
                                                            <span title={txAnomalies.map(a => `• ${a.message}`).join('\n')}
                                                                style={{display:'inline-block',cursor:'help',fontSize:14,lineHeight:1}}
                                                                aria-label={`${txAnomalies.length} anomalie(s)`}>🚩</span>
                                                        )}
                                                        {hasAnomaly && anomaliesAccepted && (
                                                            <span title={acceptedTooltip}
                                                                style={{display:'inline-block',cursor:'help',fontSize:14,lineHeight:1,opacity:0.7}}
                                                                aria-label={`${txAnomalies.length} anomalie(s) acceptée(s)`}>ℹ️</span>
                                                        )}
                                                    </td>
                                                    <td style={{padding:'10px 6px',textAlign:'center'}} onClick={(e) => e.stopPropagation()}>
                                                        {tx.id && (
                                                            <input type="checkbox" checked={selectedIds.has(tx.id)}
                                                                onChange={(e) => toggleOne(tx.id, e)}
                                                                aria-label={`Sélectionner ${tx.reference || tx.id}`}
                                                                style={{cursor:'pointer'}} />
                                                        )}
                                                    </td>
                                                    <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>{tx.date}</td>
                                                    <td style={{padding:'10px 12px',fontSize:11}}>{caisses.find(c=>c.id===tx.caisse_id)?.nom||tx.caisse_id}</td>
                                                    <td style={{padding:'10px 12px'}}>
                                                        <span style={{padding:'3px 8px',borderRadius:12,background:tt.bg||'#eee',color:tt.color||'#333',fontSize:10,fontWeight:600,whiteSpace:'nowrap'}}>
                                                            <i className={`fa-solid ${tt.icon||''}`} style={{marginRight:3}}></i>{tt.label||tx.type}
                                                        </span>
                                                    </td>
                                                    <td style={{padding:'10px 12px',fontSize:11,fontFamily:'monospace'}}>{tx.reference}</td>
                                                    <td style={{padding:'10px 12px',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tx.description}</td>
                                                    <td style={{padding:'10px 12px',fontSize:11}}>{tx.code_analytique}</td>
                                                    <td style={{padding:'10px 12px',fontSize:11,whiteSpace:'nowrap'}}>{tx.ferme||''}</td>
                                                    <td style={{padding:'10px 12px',fontSize:11,whiteSpace:'nowrap'}}>{tx.culture||''}</td>
                                                    <td style={{padding:'10px 12px',fontSize:11,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={tx.parcelle||''}>{tx.parcelle||''}</td>
                                                    <td style={{padding:'10px 12px',textAlign:'right',fontWeight:600,color:['depense','sortie','transfer_out'].includes(tx.type)?'var(--red)':'var(--green)'}}>
                                                        {['depense','sortie','transfer_out'].includes(tx.type)?'-':'+'}{formatMAD(tx.montant)}
                                                    </td>
                                                    <td style={{padding:'10px 12px',textAlign:'center'}}>
                                                        <span style={{padding:'3px 8px',borderRadius:12,background:ss.bg||'#eee',color:ss.color||'#333',fontSize:10,fontWeight:600}}>{ss.label||tx.status}</span>
                                                    </td>
                                                    {/* Action Modifier directement dans la ligne — la pop-up de
                                                        détail garde le même bouton, mais l'action ne doit pas
                                                        dépendre d'un clic préalable pour être découverte. */}
                                                    <td style={{padding:'10px 6px',textAlign:'center'}} onClick={(e) => e.stopPropagation()}>
                                                        {canEditTx(tx) && (
                                                            <button onClick={()=>setEditTx(tx)}
                                                                title={tx.status === 'valide'
                                                                    ? 'Modifier — le bon repassera en « Saisi » et devra être re-validé'
                                                                    : 'Modifier ce bon'}
                                                                aria-label={`Modifier ${tx.reference || tx.id}`}
                                                                style={{background:'none',border:'1px solid var(--gray-200)',borderRadius:8,cursor:'pointer',
                                                                    padding:'4px 8px',color:'var(--berry)',fontSize:12,lineHeight:1}}>
                                                                <i className="fa-solid fa-pen-to-square"></i>
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    {/* Sticky footer — totaux suivent les filtres */}
                                    <tfoot>
                                        <tr style={{position:'sticky',bottom:0,background:'var(--gray-100)',borderTop:'2px solid var(--berry)',boxShadow:'0 -2px 6px rgba(0,0,0,0.04)'}}>
                                            {/* 14 = ⚠ + case à cocher + 11 colonnes triables + action ✎ */}
                                            <td colSpan={14} style={{padding:'12px 14px',fontSize:12}}>
                                                <div style={{display:'flex',flexWrap:'wrap',gap:'4px 18px',alignItems:'center',fontWeight:500,color:'var(--gray-800)'}}>
                                                    <span><strong style={{color:'var(--berry)'}}>{totals.count}</strong> transactions</span>
                                                    <span style={{color:'var(--gray-400)'}}>·</span>
                                                    <span>Dépenses op : <strong style={{color:'var(--red)'}}>−{formatMAD(totals.totalDepensesOp)}</strong></span>
                                                    <span style={{color:'var(--gray-400)'}}>·</span>
                                                    <span>Recettes : <strong style={{color:'var(--green)'}}>+{formatMAD(totals.totalRecettes)}</strong></span>
                                                    <span style={{color:'var(--gray-400)'}}>·</span>
                                                    <span>Transferts inter-caisses : <strong style={{color: totals.totalTransfers === 0 ? 'var(--gray-600)' : (totals.totalTransfers > 0 ? 'var(--green)' : 'var(--red)')}}>{totals.totalTransfers >= 0 ? '+' : '−'}{formatMAD(Math.abs(totals.totalTransfers))}</strong></span>
                                                    <span style={{color:'var(--gray-400)'}}>·</span>
                                                    <span style={{marginLeft:'auto',fontSize:13}}>Solde net : <strong style={{color: totals.soldeNet >= 0 ? 'var(--green)' : 'var(--red)',fontSize:14}}>{totals.soldeNet >= 0 ? '+' : '−'}{formatMAD(Math.abs(totals.soldeNet))}</strong></span>
                                                </div>
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                        </div>
                    )}

                    {/* Transaction Detail Modal */}
                    {selectedTx && (
                        <div className="modal-overlay" onClick={()=>setSelectedTx(null)}>
                            <div className="modal-content" onClick={e=>e.stopPropagation()} style={{maxWidth:560}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                                    <h3 style={{margin:0,fontSize:16}}>Détail Transaction</h3>
                                    <button onClick={()=>setSelectedTx(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--gray-400)'}}>
                                        <i className="fa-solid fa-xmark"></i>
                                    </button>
                                </div>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px 20px',fontSize:13}}>
                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>Référence</span><div style={{fontWeight:600,fontFamily:'monospace'}}>{selectedTx.reference}</div></div>
                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>Date</span><div style={{fontWeight:600}}>{selectedTx.date}</div></div>
                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>Caisse</span><div style={{fontWeight:600}}>{caisses.find(c=>c.id===selectedTx.caisse_id)?.nom||selectedTx.caisse_id}</div></div>
                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>Type</span><div>{(() => { const t = TXN_TYPE_LABELS[selectedTx.type]||{}; return <span style={{padding:'3px 10px',borderRadius:12,background:t.bg||'#eee',color:t.color||'#333',fontSize:11,fontWeight:600}}><i className={`fa-solid ${t.icon||''}`} style={{marginRight:4}}></i>{t.label||selectedTx.type}</span>; })()}</div></div>
                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>Montant</span><div style={{fontWeight:700,fontSize:18,color:['depense','sortie','transfer_out'].includes(selectedTx.type)?'var(--red)':'var(--green)'}}>{formatMAD(selectedTx.montant)}</div></div>
                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>Statut</span><div>{(() => { const s = STATUS_LABELS[selectedTx.status]||{}; return <span style={{padding:'3px 10px',borderRadius:12,background:s.bg||'#eee',color:s.color||'#333',fontSize:11,fontWeight:600}}>{s.label||selectedTx.status}</span>; })()}</div></div>
                                    <div style={{gridColumn:'1/-1'}}><span style={{color:'var(--gray-400)',fontSize:11}}>Description</span><div>{selectedTx.description || '—'}</div></div>
                                    {selectedTx.code_analytique && <div style={{gridColumn:'1/-1'}}><span style={{color:'var(--gray-400)',fontSize:11}}>Code Analytique</span><div>{selectedTx.code_analytique}</div></div>}
                                    {/* Axes analytiques — affichés même vides, pour signaler un bon non affecté */}
                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>Ferme</span><div>{selectedTx.ferme || '—'}</div></div>
                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>Campagne</span><div>{selectedTx.campagne || '—'}</div></div>
                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>Culture</span><div>{selectedTx.culture || '—'}</div></div>
                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>Parcelle</span><div>{selectedTx.parcelle || '—'}</div></div>
                                    <div><span style={{color:'var(--gray-400)',fontSize:11}}>Saisi par</span><div>{selectedTx.saisie_by?.name||'—'}</div></div>
                                    {selectedTx.valide_par && <div><span style={{color:'var(--gray-400)',fontSize:11}}>Validé par</span><div>{selectedTx.valide_par?.name||'—'}</div></div>}
                                    {selectedTx.rejete_par && <div style={{gridColumn:'1/-1'}}><span style={{color:'var(--gray-400)',fontSize:11}}>Rejeté par</span><div>{selectedTx.rejete_par?.name||'—'} — <em style={{color:'var(--red)'}}>{selectedTx.motif_rejet}</em></div></div>}
                                </div>
                                {selectedTx.files && selectedTx.files.length > 0 && (
                                    <div style={{marginTop:16}}>
                                        <div style={{fontSize:11,color:'var(--gray-400)',marginBottom:8}}>Pièces jointes</div>
                                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                                            {selectedTx.files.map((f,j) => (
                                                <img key={j} src={f.data || f.url} alt={f.name} style={{width:80,height:80,objectFit:'cover',borderRadius:8,border:'1px solid var(--gray-200)',cursor:'pointer'}}
                                                    onClick={()=>window.open(f.data||f.url,'_blank')} />
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {/* History */}
                                {selectedTx.history && selectedTx.history.length > 0 && (
                                    <div style={{marginTop:16}}>
                                        <div style={{fontSize:11,color:'var(--gray-400)',marginBottom:8}}>Historique</div>
                                        <div style={{display:'flex',flexDirection:'column',gap:4}}>
                                            {selectedTx.history.map((h,j) => (
                                                <div key={j} style={{fontSize:11,color:'var(--gray-600)',padding:'4px 8px',background:'var(--gray-100)',borderRadius:6}}>
                                                    <strong>{h.action}</strong> par {h.by?.name||'—'} le {h.at ? new Date(h.at).toLocaleString('fr-FR') : '—'}
                                                    {h.motif && <span style={{color:'var(--red)'}}> — {h.motif}</span>}
                                                    {h.devalidated && <span style={{color:'var(--orange)',fontWeight:600}}> — dévalidé</span>}
                                                    {/* Détail avant → après d'une modification (action 'modification') */}
                                                    {Array.isArray(h.changes) && h.changes.length > 0 && (
                                                        <div style={{marginTop:3,paddingLeft:8,borderLeft:'2px solid var(--gray-200)',display:'flex',flexDirection:'column',gap:1}}>
                                                            {h.changes.map((c,k) => (
                                                                <div key={k}>
                                                                    {CAISSE_FIELD_LABELS[c.field] || c.field}{' '}
                                                                    <span style={{color:'var(--gray-400)',textDecoration:'line-through'}}>{formatChangeValue(c.field, c.from)}</span>
                                                                    {' → '}
                                                                    <strong>{formatChangeValue(c.field, c.to)}</strong>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {/* Actions — modification d'un bon après création */}
                                {canEditTx(selectedTx) && (
                                    <div style={{marginTop:20,paddingTop:16,borderTop:'1px solid var(--gray-200)',display:'flex',justifyContent:'flex-end',gap:10}}>
                                        <button onClick={()=>{ const tx = selectedTx; setSelectedTx(null); setEditTx(tx); }}
                                            style={{padding:'9px 18px',borderRadius:10,border:'none',background:'var(--berry)',color:'white',cursor:'pointer',fontSize:13,fontWeight:600}}>
                                            <i className="fa-solid fa-pen-to-square" style={{marginRight:6}}></i>Modifier
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Modale d'édition — réutilise le formulaire de saisie en mode édition */}
                    {editTx && window.CaisseSaisieSub && (
                        <div className="modal-overlay" onClick={()=>setEditTx(null)}>
                            <div className="modal-content" onClick={e=>e.stopPropagation()} style={{maxWidth:680,padding:0,background:'transparent',border:'none',boxShadow:'none'}}>
                                <window.CaisseSaisieSub
                                    caisses={caisses}
                                    editTx={editTx}
                                    onCancel={()=>setEditTx(null)}
                                    onDone={()=>{ setEditTx(null); load(); onRefresh && onRefresh(); }}
                                />
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { CaisseTransactionsSub };
