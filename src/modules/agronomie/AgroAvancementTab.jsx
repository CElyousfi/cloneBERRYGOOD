/* Module: agronomie | Déclaration(s): AgroAvancementTab */
import { displayCulture } from './displayCulture.jsx';

// =============================================
        // AVANCEMENT CULTURE
        // =============================================
        function AgroAvancementTab({ data, getAlias, getFerme }) {
            const agro = data.agroData;
            const STADES = [
                { id:'enracinement', label:'Enracinement', icon:'fa-arrow-down-to-line', color:'#795548' },
                { id:'cannes_20', label:'Cannes 20cm', icon:'fa-ruler-vertical', color:'#8BC34A' },
                { id:'cannes_50', label:'Cannes 50cm', icon:'fa-ruler-vertical', color:'#4CAF50' },
                { id:'cannes_100', label:'Cannes 1m', icon:'fa-ruler-vertical', color:'#2E7D32' },
                { id:'differenciation', label:'Différenciation', icon:'fa-code-branch', color:'#FF9800' },
                { id:'floraison', label:'Floraison', icon:'fa-sun', color:'#E91E63' },
                { id:'fructification', label:'Fructification', icon:'fa-apple-whole', color:'#F44336' },
            ];

            const [avData, setAvData] = React.useState({});
            const [apiStatus, setApiStatus] = React.useState('idle');
            const [selParc, setSelParc] = React.useState(null);
            const [editInfo, setEditInfo] = React.useState(false);
            const [uploading, setUploading] = React.useState(false);
            const [recoLoading, setRecoLoading] = React.useState(false);
            const [recoError, setRecoError] = React.useState(null);
            const [showContext, setShowContext] = React.useState(false);
            const [aiContext, setAiContext] = React.useState(null);
            const [recoHistIdx, setRecoHistIdx] = React.useState(-1); // -1 = latest
            const [showPromptEditor, setShowPromptEditor] = React.useState(false);

            var DEFAULT_PROMPT = "Tu es un ingénieur agronome expert en cultures de petits fruits rouges (myrtilles, framboises) et avocatiers au Maroc (région d'Agadir / Souss-Massa).\n\nEn te basant sur ces informations, fournis une recommandation agronomique concise et actionnable:\n1. **État de la culture**: Analyse de l'état végétatif basé sur le stade et la photo si disponible\n2. **Fertigation**: Ajustements recommandés du programme en cours (N, P, K, Ca, Mg, oligo-éléments)\n3. **Protection phytosanitaire**: Risques identifiés vu la météo et le stade (maladies fongiques, ravageurs)\n4. **Actions prioritaires**: 2-3 actions concrètes pour les 7 prochains jours\n\nRéponds en français, de manière structurée et concise. Utilise des données chiffrées quand possible.";
            var savedPrompt = localStorage.getItem('aiPromptTemplate') || '';
            const [customPrompt, setCustomPrompt] = React.useState(savedPrompt);

            // Cascade Ferme → Culture
            const [fermeFilter, setFermeFilter] = React.useState('Toutes');
            const [cultureFilter, setCultureFilter] = React.useState('Toutes');

            const allParc = (agro.parcelles || []).sort(function(a,b) { return a.parcelle.localeCompare(b.parcelle); });
            var getParcFerme = function(p) { return getFerme(p, ''); };
            const allFermes = ['Toutes', ...new Set(allParc.map(function(p) { return getParcFerme(p.parcelle); }).filter(Boolean))].sort();
            const parcByFerme = fermeFilter === 'Toutes' ? allParc : allParc.filter(function(p) { return getParcFerme(p.parcelle) === fermeFilter; });
            const culturesInFerme = ['Toutes', ...new Set(parcByFerme.map(function(p) { return displayCulture(p.culture); }).filter(Boolean))].sort();
            const parcFiltered = cultureFilter === 'Toutes' ? parcByFerme : parcByFerme.filter(function(p) { return displayCulture(p.culture) === cultureFilter; });

            React.useEffect(function() { setCultureFilter('Toutes'); }, [fermeFilter]);

            // Normaliser un nom de parcelle (trim, espaces multiples, nbsp)
            var normParc = function(n) { return (n || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); };

            // Charger données Firestore
            React.useEffect(function() {
                setApiStatus('loading');
                fetch('/api/avancement')
                    .then(function(r) { return r.json(); })
                    .then(function(json) {
                        if (json.success) {
                            // Normaliser les clés pour matcher les noms SQL
                            var norm = {};
                            Object.entries(json.data || {}).forEach(function(e) { norm[normParc(e[0])] = e[1]; });
                            setAvData(norm);
                            setApiStatus('ok');
                        } else setApiStatus('error');
                    })
                    .catch(function() { setApiStatus('error'); });
            }, []);

            // Accéder aux données d'une parcelle (avec normalisation)
            var getAvInfo = function(parcelle) { return avData[normParc(parcelle)] || {}; };

            // Sauvegarder info parcelle
            var saveInfo = function(parcelle, info) {
                var key = normParc(parcelle);
                var updated = Object.assign({}, avData);
                updated[key] = Object.assign({}, updated[key] || {}, info);
                setAvData(updated);
                fetch('/api/avancement?parcelle=' + encodeURIComponent(parcelle), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ parcelle: parcelle, data: info })
                });
            };

            // Mettre à jour le stade
            var updateStade = function(parcelle, stadeId) {
                saveInfo(parcelle, { stade: stadeId, stadeDate: new Date().toISOString().slice(0, 10) });
            };

            // Upload photo
            var handlePhotoUpload = function(parcelle, file) {
                if (!file) return;
                setUploading(true);
                var reader = new FileReader();
                reader.onload = function(e) {
                    fetch('/api/upload-photo?parcelle=' + encodeURIComponent(parcelle), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            parcelle: parcelle,
                            image: e.target.result,
                            filename: file.name,
                            date: new Date().toISOString().slice(0, 10),
                            note: ''
                        })
                    })
                    .then(function(r) { return r.json(); })
                    .then(function(json) {
                        if (json.success) {
                            // Recharger les données
                            fetch('/api/avancement')
                                .then(function(r) { return r.json(); })
                                .then(function(j) { if (j.success) { var norm = {}; Object.entries(j.data || {}).forEach(function(e) { norm[normParc(e[0])] = e[1]; }); setAvData(norm); } });
                        }
                        setUploading(false);
                    })
                    .catch(function() { setUploading(false); });
                };
                reader.readAsDataURL(file);
            };

            // Compositions connues des engrais (% N, P₂O₅, K₂O, CaO, MgO)
            var FERT_COMPOSITIONS = {
                'NITRATE  DE POTASSE': { N:13, P:0, K:46, CaO:0, MgO:0 },
                'AZO PRO': { N:31, P:4, K:0, CaO:0, MgO:0 },
                'KSC V': { N:8, P:16, K:42, CaO:0, MgO:0 },
                'KSC I': { N:14, P:40, K:5, CaO:0, MgO:0 },
                'KSC II': { N:23, P:5, K:5, CaO:0, MgO:0 },
                'KSC MIX': { N:0, P:0, K:0, CaO:0, MgO:15 },
                'KSC 7 PERLA': { N:15, P:0, K:9, CaO:20, MgO:0 },
                'RHIZO HUMUS': { N:0, P:0, K:0, CaO:0, MgO:0 },
                'RHIZO AMINE': { N:0, P:0, K:0, CaO:0, MgO:0 },
                'RHIZO BORE': { N:5, P:0, K:19, CaO:3, MgO:0 },
                'RHIZO MNZN': { N:10, P:0, K:0, CaO:0, MgO:0 },
                'FERTIACTYL GREEN EXTREME': { N:0, P:0, K:0, CaO:0, MgO:0 },
                'FERTIACTYL GZ': { N:13, P:0, K:5, CaO:0, MgO:0 },
                'ECOVIGOR AA': { N:0, P:0, K:7, CaO:0, MgO:0 },
                'SULFACIDE': { N:15, P:0, K:0, CaO:0, MgO:0 },
                'UREE 46 %': { N:46, P:0, K:0, CaO:0, MgO:0 },
                "SULFATE D'AMMONIAQUE": { N:21, P:0, K:0, CaO:0, MgO:0 },
                'MKP': { N:0, P:52, K:34, CaO:0, MgO:0 },
                'SC CALCUIM': { N:0, P:0, K:0, CaO:50, MgO:0 },
                'N-K-P': { N:10, P:10, K:10, CaO:0, MgO:0 },
                'MAGICAL': { N:0, P:0, K:0, CaO:12, MgO:4 },
                'FERTILAEDER ORIS PZN': { N:3, P:15, K:0, CaO:0, MgO:0 },
            };
            var FERT_COMPO_LOOKUP = {};
            Object.entries(FERT_COMPOSITIONS).forEach(function(e) { FERT_COMPO_LOOKUP[e[0].toUpperCase().trim()] = e[1]; });
            var OX2EL_RECO = { P: 0.4364, K: 0.8302, Ca: 0.7147, Mg: 0.6031 };

            // Formater les données fertigation Per Ha en texte pour la recommandation IA
            var formatFertigationForReco = function(fertiData, parcelle, parcSup) {
                if (!fertiData || !fertiData[parcelle]) return '';
                var parcInfo = fertiData[parcelle];
                var weekKeys = Object.keys(parcInfo.weeks || {}).sort().reverse();
                if (weekKeys.length === 0) return '';
                // Prendre la semaine la plus récente
                var lastWeekKey = weekKeys[0];
                var weekInfo = parcInfo.weeks[lastWeekKey];
                var dayData = weekInfo.days || {};
                var days = ['lun','mar','mer','jeu','ven','sam','dim'];
                var dayLabels = { lun:'Lundi', mar:'Mardi', mer:'Mercredi', jeu:'Jeudi', ven:'Vendredi', sam:'Samedi', dim:'Dimanche' };
                var sup = parcSup > 0 ? parcSup : 1;

                // Collecter les produits utilisés cette semaine
                var usedProducts = {};
                days.forEach(function(d) {
                    Object.entries(dayData[d] || {}).forEach(function(e) {
                        var name = e[0].trim().replace(/\s+/g, ' ');
                        if (e[1] > 0) usedProducts[name] = true;
                    });
                });
                var productNames = Object.keys(usedProducts).sort();
                if (productNames.length === 0) return '';

                var lines = [];
                lines.push('PROGRAMME FERTIGATION — Semaine ' + lastWeekKey + ' — Par Hectare (surface: ' + sup.toFixed(2) + ' ha)');
                lines.push('');

                // Tableau produits par jour
                lines.push('Produits (kg/Ha):');
                productNames.forEach(function(prod) {
                    var dayVals = [];
                    var total = 0;
                    days.forEach(function(d) {
                        var qty = ((dayData[d] || {})[prod] || 0) / sup;
                        total += qty;
                        if (qty > 0) dayVals.push(dayLabels[d] + ': ' + qty.toFixed(1));
                    });
                    if (total > 0) {
                        lines.push('  ' + prod + ' — Total: ' + total.toFixed(1) + ' kg/Ha (' + dayVals.join(', ') + ')');
                    }
                });

                // Calculer les nutriments éléments (Per Ha)
                lines.push('');
                lines.push('ÉQUILIBRE NUTRITIONNEL (kg/Ha):');
                var totNut = { N:0, P:0, K:0, Ca:0, Mg:0 };
                productNames.forEach(function(prod) {
                    var comp = FERT_COMPO_LOOKUP[prod.toUpperCase().trim()];
                    if (!comp) return;
                    var totalQty = 0;
                    days.forEach(function(d) { totalQty += ((dayData[d] || {})[prod] || 0); });
                    if (totalQty <= 0) return;
                    totNut.N  += totalQty * (comp.N || 0) / 100 / sup;
                    totNut.P  += totalQty * (comp.P || 0) / 100 * OX2EL_RECO.P / sup;
                    totNut.K  += totalQty * (comp.K || 0) / 100 * OX2EL_RECO.K / sup;
                    totNut.Ca += totalQty * (comp.CaO || 0) / 100 * OX2EL_RECO.Ca / sup;
                    totNut.Mg += totalQty * (comp.MgO || 0) / 100 * OX2EL_RECO.Mg / sup;
                });
                lines.push('  N: ' + totNut.N.toFixed(2) + ' kg/Ha');
                lines.push('  P: ' + totNut.P.toFixed(2) + ' kg/Ha');
                lines.push('  K: ' + totNut.K.toFixed(2) + ' kg/Ha');
                lines.push('  Ca: ' + totNut.Ca.toFixed(2) + ' kg/Ha');
                lines.push('  Mg: ' + totNut.Mg.toFixed(2) + ' kg/Ha');

                // Ratios ioniques
                if (totNut.K > 0 && totNut.Ca > 0) {
                    var meqK = totNut.K * 1000 / 39.1;
                    var meqCa = totNut.Ca * 1000 / 20.04;
                    var meqMg = totNut.Mg * 1000 / 12.155;
                    lines.push('');
                    lines.push('RATIOS IONIQUES:');
                    if (meqCa > 0) lines.push('  K/Ca: ' + (meqK / meqCa).toFixed(2));
                    if (meqMg > 0) lines.push('  K/Mg: ' + (meqK / meqMg).toFixed(2));
                    if (meqMg > 0) lines.push('  Ca/Mg: ' + (meqCa / meqMg).toFixed(2));
                }

                return lines.join('\n');
            };

            // Construire le contexte qui sera envoyé à l'IA (pour aperçu)
            var buildAiContext = function(parcelle, callback) {
                var pInfo = getAvInfo(parcelle);
                var parcItem = allParc.find(function(p) { return p.parcelle === parcelle; }) || {};
                var parcSup = parcItem.sup || 1;
                var culture = parcItem.culture || '';
                var stade = pInfo.stade || '';
                var stadeLabel = (STADES.find(function(s) { return s.id === stade; }) || {}).label || stade || 'Non défini';
                var photoUrl = (pInfo.photos && pInfo.photos.length > 0) ? pInfo.photos[pInfo.photos.length - 1].url : '';

                fetch('/api/fertigation?parcelle=' + encodeURIComponent(parcelle))
                    .then(function(r) { return r.json(); })
                    .then(function(fertiJson) {
                        var fertiText = '';
                        if (fertiJson.success && fertiJson.data) {
                            var normData = {};
                            Object.entries(fertiJson.data).forEach(function(entry) {
                                var pKey = entry[0];
                                var pVal = entry[1];
                                var weeks = {};
                                Object.entries(pVal.weeks || {}).forEach(function(wEntry) {
                                    var days = {};
                                    Object.entries(wEntry[1].days || {}).forEach(function(dEntry) {
                                        var prods = {};
                                        Object.entries(dEntry[1]).forEach(function(aEntry) {
                                            var name = aEntry[0].trim().replace(/\s+/g, ' ');
                                            prods[name] = (prods[name] || 0) + aEntry[1];
                                        });
                                        days[dEntry[0]] = prods;
                                    });
                                    weeks[wEntry[0]] = { label: wEntry[1].label, days: days };
                                });
                                normData[pKey] = { culture: pVal.culture, ferme: pVal.ferme, weeks: weeks };
                            });
                            fertiText = formatFertigationForReco(normData, parcelle, parcSup);
                        }
                        var varieteText = pInfo.variete ? 'Variété: ' + pInfo.variete : '';
                        var fullFertiData = [varieteText, fertiText].filter(Boolean).join('\n\n');

                        var ctx = {
                            parcelle: parcelle,
                            culture: culture,
                            stade: stade,
                            stadeLabel: stadeLabel,
                            photoUrl: photoUrl,
                            fertigationData: fullFertiData,
                            parcSup: parcSup
                        };
                        setAiContext(ctx);
                        if (callback) callback(ctx);
                    })
                    .catch(function() { setAiContext(null); if (callback) callback(null); });
            };

            // Demander recommandation
            var requestReco = function(parcelle) {
                setRecoLoading(true);
                setRecoError(null);
                var sendReco = function(ctx) {
                    if (!ctx) { setRecoLoading(false); setRecoError('Impossible de charger le contexte fertigation'); return; }
                    console.log('[Reco] Envoi requête pour', ctx.parcelle, '| Photo:', !!ctx.photoUrl, '| Prompt custom:', !!customPrompt);
                    fetch('/api/recommandation', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            parcelle: ctx.parcelle,
                            stade: ctx.stade,
                            culture: ctx.culture,
                            photoUrl: ctx.photoUrl,
                            fertigationData: ctx.fertigationData,
                            customPrompt: customPrompt || null
                        })
                    })
                    .then(function(r) {
                        console.log('[Reco] HTTP', r.status);
                        return r.json().then(function(j) {
                            if (!r.ok) {
                                console.error('[Reco] Erreur:', j);
                                throw new Error(j.detail || j.error || 'Erreur serveur ' + r.status);
                            }
                            return j;
                        });
                    })
                    .then(function(json) {
                        console.log('[Reco] OK — modèle:', json.recommandation && json.recommandation.model);
                        if (json.success && json.recommandation) {
                            var key = normParc(parcelle);
                            var updated = Object.assign({}, avData);
                            var existing = updated[key] || {};
                            var history = (existing.recoHistory || []).slice();
                            history.push(json.recommandation);
                            if (history.length > 20) history.splice(0, history.length - 20);
                            updated[key] = Object.assign({}, existing, { lastReco: json.recommandation, recoHistory: history });
                            setAvData(updated);
                            setRecoHistIdx(-1);
                        }
                        setRecoLoading(false);
                    })
                    .catch(function(err) {
                        console.error('[Reco] ERREUR:', err.message);
                        setRecoError(err.message);
                        setRecoLoading(false);
                    });
                };

                if (aiContext && aiContext.parcelle === parcelle) {
                    sendReco(aiContext);
                } else {
                    buildAiContext(parcelle, sendReco);
                }
            };

            // Get stade index
            var getStadeIdx = function(parcelle) {
                var info = getAvInfo(parcelle);
                var idx = STADES.findIndex(function(s) { return s.id === info.stade; });
                return idx >= 0 ? idx : -1;
            };

            // Render pipeline stade
            var renderPipeline = function(parcelle, compact) {
                var currentIdx = getStadeIdx(parcelle);
                return React.createElement('div', { style: { display:'flex', alignItems:'center', gap: compact ? 2 : 4, flexWrap:'wrap' } },
                    STADES.map(function(s, i) {
                        var isActive = i <= currentIdx;
                        var isCurrent = i === currentIdx;
                        return React.createElement('div', { key: s.id, style: { display:'flex', alignItems:'center' } },
                            React.createElement('div', {
                                onClick: function() { if (!compact) updateStade(parcelle, s.id); },
                                style: {
                                    display:'flex', alignItems:'center', gap:4, padding: compact ? '3px 6px' : '5px 10px',
                                    borderRadius: 6, fontSize: compact ? 9 : 11, fontWeight: isActive ? 700 : 500,
                                    background: isCurrent ? s.color : isActive ? s.color + '33' : '#f0f0f0',
                                    color: isCurrent ? '#fff' : isActive ? s.color : '#bbb',
                                    border: isCurrent ? '2px solid ' + s.color : '1px solid ' + (isActive ? s.color + '44' : '#ddd'),
                                    cursor: compact ? 'default' : 'pointer', transition: 'all 0.2s',
                                    boxShadow: isCurrent ? '0 2px 8px ' + s.color + '44' : 'none'
                                },
                                title: compact ? s.label : 'Cliquer pour définir ce stade'
                            },
                                React.createElement('i', { className: 'fa-solid ' + s.icon, style: { fontSize: compact ? 8 : 10 } }),
                                !compact && React.createElement('span', null, s.label)
                            ),
                            i < STADES.length - 1 && React.createElement('div', {
                                style: { width: compact ? 8 : 16, height: 2, background: isActive ? s.color : '#ddd' }
                            })
                        );
                    })
                );
            };

            // Vue détail parcelle
            var renderDetail = function() {
                var p = allParc.find(function(pp) { return pp.parcelle === selParc; });
                if (!p) return null;
                var info = getAvInfo(selParc);
                var photos = info.photos || [];
                var reco = info.lastReco;
                var pSup = p.sup || 1;
                var stadeIdx = getStadeIdx(selParc);

                return React.createElement('div', { className: 'fade-in' },
                    // Bouton retour
                    React.createElement('button', {
                        onClick: function() { setSelParc(null); setEditInfo(false); setRecoHistIdx(-1); setShowContext(false); setAiContext(null); },
                        style: { padding:'8px 16px', borderRadius:8, border:'1px solid #ddd', background:'#fff', cursor:'pointer', fontSize:12, fontWeight:600, marginBottom:16 }
                    }, React.createElement('i', { className:'fa-solid fa-arrow-left', style:{marginRight:6} }), 'Retour'),

                    // Header parcelle
                    React.createElement('div', { className:'panel', style:{ padding:20, marginBottom:16 } },
                        React.createElement('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:16 } },
                            React.createElement('div', null,
                                React.createElement('h2', { style:{ margin:0, fontSize:20, color:'var(--berry)' } }, getAlias(selParc)),
                                React.createElement('div', { style:{ fontSize:12, color:'#999', marginTop:4 } },
                                    displayCulture(p.culture), ' — ', getParcFerme(selParc), ' — ', pSup, ' Ha'
                                )
                            ),
                            React.createElement('button', {
                                onClick: function() { setEditInfo(!editInfo); },
                                style: { padding:'6px 14px', borderRadius:8, border:'1px solid #ddd', background: editInfo ? 'var(--berry)' : '#fff', color: editInfo ? '#fff' : '#555', fontSize:12, fontWeight:600, cursor:'pointer' }
                            }, React.createElement('i', { className:'fa-solid fa-pen', style:{marginRight:4} }), editInfo ? 'Fermer' : 'Modifier infos')
                        ),

                        // Pipeline stades
                        React.createElement('div', { style:{ marginTop:16 } },
                            React.createElement('div', { style:{ fontSize:11, color:'var(--gray-400)', marginBottom:8, fontWeight:600 } }, 'STADE PHÉNOLOGIQUE — cliquer pour mettre à jour'),
                            renderPipeline(selParc, false),
                            stadeIdx >= 0 && React.createElement('div', { style:{ marginTop:8, fontSize:11, color:'#999' } },
                                'Stade actuel : ', React.createElement('strong', { style:{ color: STADES[stadeIdx].color } }, STADES[stadeIdx].label),
                                info.stadeDate ? ' — mis à jour le ' + info.stadeDate : ''
                            )
                        )
                    ),

                    // Formulaire infos
                    editInfo && React.createElement('div', { className:'panel', style:{ padding:20, marginBottom:16 } },
                        React.createElement('h3', { style:{ marginTop:0, fontSize:14 } },
                            React.createElement('i', { className:'fa-solid fa-circle-info', style:{marginRight:6, color:'var(--berry)'} }), 'Informations parcelle'
                        ),
                        React.createElement('div', { style:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 } },
                            ['datePlantation|Date de plantation|date', 'variete|Variété|text', 'densite|Densité (plants/Ha)|number', 'typeTunnel|Type de tunnel|text', 'localisation|Localisation GPS|text', 'notes|Notes|text'].map(function(field) {
                                var parts = field.split('|');
                                var key = parts[0], label = parts[1], type = parts[2];
                                return React.createElement('div', { key: key },
                                    React.createElement('label', { style:{ fontSize:11, color:'var(--gray-400)', display:'block', marginBottom:4 } }, label),
                                    React.createElement('input', {
                                        type: type, value: info[key] || '',
                                        onChange: function(e) { saveInfo(selParc, Object.assign({}, info, (function() { var o = {}; o[key] = e.target.value; return o; })())); },
                                        style: { width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid #ddd', fontSize:13, boxSizing:'border-box' }
                                    })
                                );
                            })
                        )
                    ),

                    // Background infos display (quand pas en édition)
                    !editInfo && (info.datePlantation || info.variete || info.densite || info.typeTunnel) && React.createElement('div', { className:'panel', style:{ padding:16, marginBottom:16 } },
                        React.createElement('div', { style:{ display:'flex', gap:24, flexWrap:'wrap', fontSize:12 } },
                            info.datePlantation && React.createElement('div', null,
                                React.createElement('span', { style:{color:'var(--gray-400)'} }, 'Plantation : '),
                                React.createElement('strong', null, info.datePlantation)
                            ),
                            info.variete && React.createElement('div', null,
                                React.createElement('span', { style:{color:'var(--gray-400)'} }, 'Variété : '),
                                React.createElement('strong', null, info.variete)
                            ),
                            info.densite && React.createElement('div', null,
                                React.createElement('span', { style:{color:'var(--gray-400)'} }, 'Densité : '),
                                React.createElement('strong', null, info.densite, ' plants/Ha')
                            ),
                            info.typeTunnel && React.createElement('div', null,
                                React.createElement('span', { style:{color:'var(--gray-400)'} }, 'Tunnel : '),
                                React.createElement('strong', null, info.typeTunnel)
                            ),
                            info.localisation && React.createElement('div', null,
                                React.createElement('span', { style:{color:'var(--gray-400)'} }, 'GPS : '),
                                React.createElement('strong', null, info.localisation)
                            )
                        )
                    ),

                    // Photos
                    React.createElement('div', { className:'panel', style:{ padding:20, marginBottom:16 } },
                        React.createElement('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 } },
                            React.createElement('h3', { style:{ margin:0, fontSize:14 } },
                                React.createElement('i', { className:'fa-solid fa-camera', style:{marginRight:6, color:'var(--green)'} }),
                                'Photos (', photos.length, ')'
                            ),
                            React.createElement('label', {
                                style:{ padding:'6px 14px', borderRadius:8, background:'var(--green)', color:'#fff', fontSize:12, fontWeight:600, cursor: uploading ? 'wait' : 'pointer' }
                            },
                                uploading
                                    ? React.createElement('span', null, React.createElement('i', { className:'fa-solid fa-spinner fa-spin', style:{marginRight:4} }), 'Upload...')
                                    : React.createElement('span', null, React.createElement('i', { className:'fa-solid fa-plus', style:{marginRight:4} }), 'Ajouter photo'),
                                React.createElement('input', {
                                    type:'file', accept:'image/*', style:{ display:'none' },
                                    onChange: function(e) { if (e.target.files[0]) handlePhotoUpload(selParc, e.target.files[0]); }
                                })
                            )
                        ),
                        photos.length === 0
                            ? React.createElement('div', { style:{ textAlign:'center', padding:30, color:'#ccc' } },
                                React.createElement('i', { className:'fa-solid fa-image', style:{ fontSize:40, display:'block', marginBottom:8, opacity:0.3 } }),
                                'Aucune photo pour cette parcelle'
                            )
                            : (function() {
                                // Grouper les photos par date
                                var photosByDate = {};
                                photos.slice().reverse().forEach(function(photo) {
                                    var d = photo.date || 'Sans date';
                                    if (!photosByDate[d]) photosByDate[d] = [];
                                    photosByDate[d].push(photo);
                                });
                                var dates = Object.keys(photosByDate).sort().reverse();
                                return React.createElement('div', null,
                                    dates.map(function(date) {
                                        return React.createElement('div', { key: date, style:{ marginBottom:16 } },
                                            React.createElement('div', { style:{ fontSize:11, fontWeight:700, color:'var(--gray-400)', marginBottom:8, display:'flex', alignItems:'center', gap:6 } },
                                                React.createElement('i', { className:'fa-solid fa-calendar', style:{color:'var(--green)'} }),
                                                date,
                                                React.createElement('span', { style:{ fontSize:9, color:'#bbb', fontWeight:400 } }, '(', photosByDate[date].length, ' photo', photosByDate[date].length > 1 ? 's' : '', ')')
                                            ),
                                            React.createElement('div', { style:{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:10 } },
                                                photosByDate[date].map(function(photo, idx) {
                                                    return React.createElement('div', { key: idx, style:{ borderRadius:8, overflow:'hidden', border:'1px solid #eee' } },
                                                        React.createElement('img', {
                                                            src: photo.url,
                                                            style:{ width:'100%', height:140, objectFit:'cover', cursor:'pointer' },
                                                            onClick: function() { window.open(photo.url, '_blank'); }
                                                        }),
                                                        photo.note && React.createElement('div', { style:{ padding:'4px 8px', fontSize:10, color:'#666', background:'#fafafa' } }, photo.note)
                                                    );
                                                })
                                            )
                                        );
                                    })
                                );
                            })()
                    ),

                    // Recommandation IA
                    (function() {
                        var history = info.recoHistory || [];
                        if (reco && history.length === 0) history = [reco];
                        var displayIdx = recoHistIdx < 0 ? history.length - 1 : Math.min(recoHistIdx, history.length - 1);
                        var displayReco = history.length > 0 ? history[Math.max(0, displayIdx)] : null;
                        var isLatest = displayIdx >= history.length - 1;

                        return React.createElement('div', { className:'panel', style:{ padding:20 } },
                            // Header
                            React.createElement('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8 } },
                                React.createElement('h3', { style:{ margin:0, fontSize:14 } },
                                    React.createElement('i', { className:'fa-solid fa-robot', style:{marginRight:6, color:'#9C27B0'} }),
                                    'Recommandation IA',
                                    history.length > 1 && React.createElement('span', { style:{ marginLeft:8, fontSize:10, color:'#999', fontWeight:400 } }, '(', history.length, ' recommandations)')
                                ),
                                React.createElement('div', { style:{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' } },
                                    // Bouton prompt
                                    React.createElement('button', {
                                        onClick: function() { setShowPromptEditor(!showPromptEditor); },
                                        style: { padding:'6px 12px', borderRadius:8, border: showPromptEditor ? '2px solid #2196F3' : '1px solid #ddd', background: showPromptEditor ? '#E3F2FD' : '#fff', color: showPromptEditor ? '#1565C0' : '#666', fontSize:11, fontWeight:600, cursor:'pointer' }
                                    },
                                        React.createElement('i', { className:'fa-solid fa-sliders', style:{marginRight:4} }),
                                        'Prompt'
                                    ),
                                    // Bouton aperçu contexte
                                    React.createElement('button', {
                                        onClick: function() {
                                            if (showContext && aiContext) { setShowContext(false); }
                                            else { buildAiContext(selParc); setShowContext(true); }
                                        },
                                        style: { padding:'6px 12px', borderRadius:8, border: showContext ? '2px solid #FF9800' : '1px solid #ddd', background: showContext ? '#FFF3E0' : '#fff', color: showContext ? '#E65100' : '#666', fontSize:11, fontWeight:600, cursor:'pointer' }
                                    },
                                        React.createElement('i', { className:'fa-solid fa-eye', style:{marginRight:4} }),
                                        showContext ? 'Masquer contexte' : 'Voir contexte IA'
                                    ),
                                    // Bouton analyser
                                    React.createElement('button', {
                                        onClick: function() { requestReco(selParc); }, disabled: recoLoading,
                                        style: { padding:'6px 14px', borderRadius:8, background:'#9C27B0', color:'#fff', border:'none', fontSize:12, fontWeight:600, cursor: recoLoading ? 'wait' : 'pointer', opacity: recoLoading ? 0.6 : 1 }
                                    },
                                        recoLoading
                                            ? React.createElement('span', null, React.createElement('i', { className:'fa-solid fa-spinner fa-spin', style:{marginRight:4} }), 'Analyse...')
                                            : React.createElement('span', null, React.createElement('i', { className:'fa-solid fa-wand-magic-sparkles', style:{marginRight:4} }), 'Analyser')
                                    )
                                )
                            ),

                            // Éditeur de prompt
                            showPromptEditor && React.createElement('div', { style:{ background:'#E3F2FD', border:'1px solid #90CAF9', borderRadius:8, padding:16, marginBottom:16, fontSize:12 } },
                                React.createElement('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 } },
                                    React.createElement('div', { style:{ fontWeight:700, color:'#1565C0', fontSize:13 } },
                                        React.createElement('i', { className:'fa-solid fa-sliders', style:{marginRight:6} }),
                                        'Paramétrage du prompt'
                                    ),
                                    React.createElement('div', { style:{ display:'flex', gap:6 } },
                                        customPrompt && React.createElement('button', {
                                            onClick: function() { setCustomPrompt(''); localStorage.removeItem('aiPromptTemplate'); },
                                            style:{ padding:'4px 10px', borderRadius:6, border:'1px solid #EF9A9A', background:'#FFEBEE', color:'#C62828', fontSize:10, fontWeight:600, cursor:'pointer' }
                                        }, React.createElement('i', { className:'fa-solid fa-rotate-left', style:{marginRight:3} }), 'Réinitialiser'),
                                        React.createElement('span', { style:{ fontSize:10, color: customPrompt ? '#2E7D32' : '#999', fontWeight:600, padding:'4px 8px', background: customPrompt ? '#E8F5E9' : '#f5f5f5', borderRadius:6 } },
                                            customPrompt ? React.createElement('span', null, React.createElement('i', { className:'fa-solid fa-check', style:{marginRight:3} }), 'Prompt personnalisé') : 'Prompt par défaut'
                                        )
                                    )
                                ),
                                React.createElement('div', { style:{ fontSize:10, color:'#666', marginBottom:8, lineHeight:1.5 } },
                                    'Personnalisez les instructions envoyées à Claude. Les données (parcelle, météo, fertigation, photo) sont ajoutées automatiquement.',
                                    React.createElement('br', null),
                                    'Laissez vide pour utiliser le prompt par défaut.'
                                ),
                                React.createElement('textarea', {
                                    value: customPrompt || '',
                                    placeholder: DEFAULT_PROMPT,
                                    onChange: function(e) {
                                        var val = e.target.value;
                                        setCustomPrompt(val);
                                        if (val) localStorage.setItem('aiPromptTemplate', val);
                                        else localStorage.removeItem('aiPromptTemplate');
                                    },
                                    style:{ width:'100%', minHeight:180, padding:12, borderRadius:8, border:'1px solid #BBDEFB', fontSize:12, lineHeight:1.6, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box', background:'#fff' }
                                }),
                                React.createElement('div', { style:{ marginTop:8, fontSize:10, color:'#999' } },
                                    React.createElement('i', { className:'fa-solid fa-circle-info', style:{marginRight:4} }),
                                    'Modèle : Claude Opus 4 — Les données contextuelles (parcelle, culture, stade, météo, fertigation, photo) sont injectées après votre prompt.'
                                )
                            ),

                            // Erreur
                            recoError && React.createElement('div', { style:{ background:'#FFEBEE', border:'1px solid #EF9A9A', borderRadius:8, padding:12, marginBottom:12, fontSize:12, color:'#C62828', display:'flex', alignItems:'center', gap:8 } },
                                React.createElement('i', { className:'fa-solid fa-triangle-exclamation', style:{fontSize:16} }),
                                React.createElement('div', null,
                                    React.createElement('strong', null, 'Erreur lors de l\'analyse'),
                                    React.createElement('div', { style:{ fontSize:11, marginTop:2, color:'#D32F2F' } }, recoError)
                                )
                            ),

                            // Aperçu du contexte envoyé à l'IA
                            showContext && React.createElement('div', { style:{ background:'#FFF8E1', border:'1px solid #FFE082', borderRadius:8, padding:16, marginBottom:16, fontSize:12 } },
                                React.createElement('div', { style:{ fontWeight:700, color:'#E65100', marginBottom:10, fontSize:13 } },
                                    React.createElement('i', { className:'fa-solid fa-paper-plane', style:{marginRight:6} }),
                                    'Données envoyées à Claude AI'
                                ),
                                !aiContext
                                    ? React.createElement('div', { style:{ textAlign:'center', padding:12, color:'#999' } },
                                        React.createElement('i', { className:'fa-solid fa-spinner fa-spin', style:{marginRight:4} }), 'Chargement du contexte...'
                                    )
                                    : React.createElement('div', null,
                                        // Parcelle / Culture / Stade
                                        React.createElement('div', { style:{ display:'flex', gap:16, flexWrap:'wrap', marginBottom:10 } },
                                            React.createElement('div', null,
                                                React.createElement('span', { style:{color:'#999'} }, 'Parcelle: '),
                                                React.createElement('strong', null, aiContext.parcelle)
                                            ),
                                            React.createElement('div', null,
                                                React.createElement('span', { style:{color:'#999'} }, 'Culture: '),
                                                React.createElement('strong', null, aiContext.culture || 'Non spécifiée')
                                            ),
                                            React.createElement('div', null,
                                                React.createElement('span', { style:{color:'#999'} }, 'Stade: '),
                                                React.createElement('strong', null, aiContext.stadeLabel || 'Non défini')
                                            ),
                                            React.createElement('div', null,
                                                React.createElement('span', { style:{color:'#999'} }, 'Surface: '),
                                                React.createElement('strong', null, aiContext.parcSup, ' Ha')
                                            )
                                        ),
                                        // Photo
                                        React.createElement('div', { style:{ marginBottom:10 } },
                                            React.createElement('div', { style:{ fontWeight:600, color:'#555', marginBottom:4 } },
                                                React.createElement('i', { className:'fa-solid fa-camera', style:{marginRight:4, color: aiContext.photoUrl ? '#4CAF50' : '#ccc'} }),
                                                aiContext.photoUrl ? 'Photo incluse' : 'Pas de photo'
                                            ),
                                            aiContext.photoUrl && React.createElement('img', {
                                                src: aiContext.photoUrl,
                                                style:{ width:120, height:80, objectFit:'cover', borderRadius:6, border:'1px solid #ddd' }
                                            })
                                        ),
                                        // Prompt
                                        React.createElement('div', { style:{ marginBottom:10 } },
                                            React.createElement('div', { style:{ fontWeight:600, color:'#555', marginBottom:4 } },
                                                React.createElement('i', { className:'fa-solid fa-sliders', style:{marginRight:4, color:'#2196F3'} }),
                                                customPrompt ? 'Prompt personnalisé' : 'Prompt par défaut',
                                                React.createElement('span', { style:{ marginLeft:6, fontSize:9, color:'#999' } }, 'Claude Opus 4')
                                            ),
                                            React.createElement('pre', {
                                                style:{ background:'#fff', border:'1px solid #e0e0e0', borderRadius:6, padding:10, fontSize:10, lineHeight:1.5, maxHeight:120, overflow:'auto', whiteSpace:'pre-wrap', margin:0 }
                                            }, customPrompt || DEFAULT_PROMPT)
                                        ),
                                        // Fertigation
                                        React.createElement('div', null,
                                            React.createElement('div', { style:{ fontWeight:600, color:'#555', marginBottom:4 } },
                                                React.createElement('i', { className:'fa-solid fa-droplet', style:{marginRight:4, color: aiContext.fertigationData ? '#2196F3' : '#ccc'} }),
                                                aiContext.fertigationData ? 'Programme fertigation inclus' : 'Pas de données fertigation'
                                            ),
                                            aiContext.fertigationData && React.createElement('pre', {
                                                style:{ background:'#fff', border:'1px solid #e0e0e0', borderRadius:6, padding:10, fontSize:10, lineHeight:1.5, maxHeight:200, overflow:'auto', whiteSpace:'pre-wrap', margin:0 }
                                            }, aiContext.fertigationData)
                                        )
                                    )
                            ),

                            // Navigation historique
                            history.length > 1 && React.createElement('div', { style:{ display:'flex', alignItems:'center', justifyContent:'center', gap:12, marginBottom:12, background:'#f5f5f5', borderRadius:8, padding:'8px 12px' } },
                                React.createElement('button', {
                                    onClick: function() { setRecoHistIdx(Math.max(0, displayIdx - 1)); },
                                    disabled: displayIdx <= 0,
                                    style:{ padding:'4px 10px', borderRadius:6, border:'1px solid #ddd', background:'#fff', cursor: displayIdx <= 0 ? 'default' : 'pointer', opacity: displayIdx <= 0 ? 0.3 : 1, fontSize:11 }
                                }, React.createElement('i', { className:'fa-solid fa-chevron-left' })),
                                React.createElement('span', { style:{ fontSize:11, color:'#666', fontWeight:600 } },
                                    (displayIdx + 1), ' / ', history.length,
                                    isLatest && React.createElement('span', { style:{ marginLeft:6, color:'#9C27B0', fontSize:9, background:'#F3E5F5', padding:'2px 6px', borderRadius:8 } }, 'dernière')
                                ),
                                React.createElement('button', {
                                    onClick: function() { setRecoHistIdx(Math.min(history.length - 1, displayIdx + 1)); },
                                    disabled: isLatest,
                                    style:{ padding:'4px 10px', borderRadius:6, border:'1px solid #ddd', background:'#fff', cursor: isLatest ? 'default' : 'pointer', opacity: isLatest ? 0.3 : 1, fontSize:11 }
                                }, React.createElement('i', { className:'fa-solid fa-chevron-right' })),
                                React.createElement('button', {
                                    onClick: function() { setRecoHistIdx(-1); },
                                    disabled: isLatest,
                                    style:{ padding:'4px 8px', borderRadius:6, border:'1px solid #ddd', background: isLatest ? '#f5f5f5' : '#9C27B0', color: isLatest ? '#ccc' : '#fff', cursor: isLatest ? 'default' : 'pointer', fontSize:10 }
                                }, 'Dernière')
                            ),

                            // Affichage recommandation
                            displayReco
                                ? React.createElement('div', { style:{ background:'#F3E5F5', borderRadius:8, padding:16, fontSize:13, lineHeight:1.8 } },
                                    // Meta header
                                    React.createElement('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, flexWrap:'wrap', gap:6 } },
                                        React.createElement('div', { style:{ fontSize:11, color:'#9C27B0', fontWeight:600 } },
                                            React.createElement('i', { className:'fa-solid fa-clock', style:{marginRight:4} }),
                                            (function() {
                                                if (!displayReco.timestamp) return displayReco.date || '—';
                                                var ts = new Date(displayReco.timestamp);
                                                var now = new Date();
                                                var diffMin = Math.floor((now - ts) / 60000);
                                                var dateStr = ts.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' });
                                                var timeStr = ts.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
                                                var ago = '';
                                                if (diffMin < 1) ago = "à l'instant";
                                                else if (diffMin < 60) ago = 'il y a ' + diffMin + ' min';
                                                else if (diffMin < 1440) ago = 'il y a ' + Math.floor(diffMin / 60) + 'h';
                                                else ago = 'il y a ' + Math.floor(diffMin / 1440) + 'j';
                                                return dateStr + ' ' + timeStr + ' (' + ago + ')';
                                            })(),
                                            displayReco.source === 'claude' && React.createElement('span', { style:{ marginLeft:8, background:'#9C27B0', color:'#fff', padding:'2px 8px', borderRadius:10, fontSize:9 } }, displayReco.model ? displayReco.model.replace('claude-', '').replace(/-202\d+/, '') : 'Claude AI'),
                                            displayReco.source === 'error' && React.createElement('span', { style:{ marginLeft:8, background:'#F44336', color:'#fff', padding:'2px 8px', borderRadius:10, fontSize:9 } }, 'Config requise'),
                                            displayReco.hasPhoto && React.createElement('span', { style:{ marginLeft:6, fontSize:10, color:'#666' } }, React.createElement('i', { className:'fa-solid fa-camera', style:{marginRight:2} }), 'Photo analysée'),
                                            displayReco.fertigationData && React.createElement('span', { style:{ marginLeft:6, fontSize:10, color:'#666' } }, React.createElement('i', { className:'fa-solid fa-droplet', style:{marginRight:2} }), 'Fertigation incluse')
                                        ),
                                        displayReco.stade && displayReco.stade !== 'N/A' && React.createElement('span', { style:{ fontSize:10, color:'#666' } }, 'Stade: ', (STADES.find(function(s) { return s.id === displayReco.stade || s.label === displayReco.stade; }) || {}).label || displayReco.stade)
                                    ),

                                    // Photo utilisée pour cette recommandation (si disponible dans l'historique)
                                    displayReco.photoUrl && React.createElement('div', { style:{ marginBottom:10 } },
                                        React.createElement('img', {
                                            src: displayReco.photoUrl,
                                            style:{ width:150, height:100, objectFit:'cover', borderRadius:8, border:'2px solid #CE93D8', cursor:'pointer' },
                                            onClick: function() { window.open(displayReco.photoUrl, '_blank'); },
                                            title: 'Photo envoyée pour cette analyse'
                                        })
                                    ),

                                    // Message
                                    React.createElement('div', {
                                        style:{ whiteSpace:'pre-wrap' },
                                        dangerouslySetInnerHTML: { __html: (displayReco.message || '')
                                            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                            .replace(/^### (.*$)/gm, '<h4 style="margin:12px 0 4px;color:#6A1B9A;font-size:14px">$1</h4>')
                                            .replace(/^## (.*$)/gm, '<h3 style="margin:14px 0 6px;color:#4A148C;font-size:15px">$1</h3>')
                                            .replace(/^- (.*$)/gm, '<div style="padding-left:12px">• $1</div>')
                                            .replace(/^\d+\. (.*$)/gm, '<div style="padding-left:12px;margin:2px 0">$&</div>')
                                        }
                                    }),

                                    // Contexte fertigation utilisé (collapsible)
                                    displayReco.fertigationData && React.createElement('details', { style:{ marginTop:12 } },
                                        React.createElement('summary', { style:{ fontSize:10, color:'#9C27B0', cursor:'pointer', fontWeight:600 } },
                                            React.createElement('i', { className:'fa-solid fa-droplet', style:{marginRight:4} }),
                                            'Fertigation envoyée pour cette analyse'
                                        ),
                                        React.createElement('pre', {
                                            style:{ background:'#fff', border:'1px solid #e0e0e0', borderRadius:6, padding:8, fontSize:9, lineHeight:1.4, maxHeight:150, overflow:'auto', whiteSpace:'pre-wrap', margin:'6px 0 0' }
                                        }, displayReco.fertigationData)
                                    )
                                )
                                : React.createElement('div', { style:{ textAlign:'center', padding:20, color:'#ccc', fontSize:12 } },
                                    'Cliquer "Voir contexte IA" pour prévisualiser les données, puis "Analyser" pour obtenir une recommandation'
                                )
                        );
                    })()
                );
            };

            // Vue liste
            var renderList = function() {
                return React.createElement('div', null,
                    parcFiltered.map(function(p) {
                        var info = getAvInfo(p.parcelle);
                        var stadeIdx = getStadeIdx(p.parcelle);
                        var photos = (info.photos || []);
                        return React.createElement('div', {
                            key: p.parcelle, className:'panel',
                            style:{ padding:16, marginBottom:12, cursor:'pointer', transition:'all 0.2s', border:'1px solid #eee' },
                            onClick: function() { setSelParc(p.parcelle); setRecoHistIdx(-1); setShowContext(false); setAiContext(null); }
                        },
                            React.createElement('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8, marginBottom:10 } },
                                React.createElement('div', null,
                                    React.createElement('span', { style:{ fontWeight:700, fontSize:14, color:'#333' } }, getAlias(p.parcelle)),
                                    React.createElement('span', { style:{ fontSize:11, color:'var(--gray-400)', marginLeft:12 } }, displayCulture(p.culture)),
                                    React.createElement('span', { style:{ fontSize:11, color:'var(--berry)', marginLeft:8, fontWeight:600 } }, getParcFerme(p.parcelle)),
                                    React.createElement('span', { style:{ fontSize:11, color:'var(--gray-400)', marginLeft:8 } }, p.sup, ' Ha')
                                ),
                                React.createElement('div', { style:{ display:'flex', alignItems:'center', gap:8 } },
                                    photos.length > 0 && React.createElement('span', { style:{ fontSize:10, color:'#999' } },
                                        React.createElement('i', { className:'fa-solid fa-camera', style:{marginRight:3} }), photos.length
                                    ),
                                    info.lastReco && React.createElement('span', { style:{ fontSize:10, color:'#9C27B0' } },
                                        React.createElement('i', { className:'fa-solid fa-robot' })
                                    ),
                                    React.createElement('i', { className:'fa-solid fa-chevron-right', style:{ color:'#ccc', fontSize:12 } })
                                )
                            ),
                            renderPipeline(p.parcelle, true)
                        );
                    })
                );
            };

            if (apiStatus === 'loading') {
                return React.createElement('div', { className:'fade-in', style:{ textAlign:'center', padding:60 } },
                    React.createElement('i', { className:'fa-solid fa-spinner fa-spin', style:{ fontSize:32, color:'var(--berry)' } }),
                    React.createElement('div', { style:{ marginTop:12, color:'#999' } }, 'Chargement...')
                );
            }

            return React.createElement('div', { className:'fade-in' },
                // Si une parcelle est sélectionnée, afficher le détail
                selParc ? renderDetail() : React.createElement(React.Fragment, null,
                    // Ferme buttons
                    React.createElement('div', { style:{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10 } },
                        allFermes.map(function(f) {
                            return React.createElement('button', {
                                key: f, onClick: function() { setFermeFilter(f); },
                                className: 'chip c-berry ' + (fermeFilter===f ? 'active' : '')
                            }, f === 'Toutes' ? React.createElement(React.Fragment, null, React.createElement('i', { className:'fa-solid fa-layer-group', style:{marginRight:4} }), 'Toutes') : f);
                        })
                    ),
                    // Culture buttons
                    React.createElement('div', { style:{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:16 } },
                        culturesInFerme.map(function(c) {
                            return React.createElement('button', {
                                key: c, onClick: function() { setCultureFilter(c); },
                                style: { padding:'6px 14px', borderRadius:8, border: cultureFilter===c ? '2px solid var(--green)' : '1px solid #ddd',
                                    background: cultureFilter===c ? 'var(--green)' : '#fff', color: cultureFilter===c ? '#fff' : '#555',
                                    fontWeight:700, fontSize:12, cursor:'pointer', transition:'all 0.2s' }
                            }, c === 'Toutes' ? React.createElement(React.Fragment, null, React.createElement('i', { className:'fa-solid fa-seedling', style:{marginRight:4} }), 'Toutes') : c);
                        })
                    ),
                    // Résumé
                    React.createElement('div', { style:{ fontSize:12, color:'var(--gray-400)', marginBottom:12 } },
                        parcFiltered.length, ' parcelles',
                        fermeFilter !== 'Toutes' && React.createElement('span', null, ' — ', fermeFilter),
                        cultureFilter !== 'Toutes' && React.createElement('span', null, ' — ', cultureFilter)
                    ),
                    // Liste des parcelles
                    renderList()
                )
            );
        }

export { AgroAvancementTab };
