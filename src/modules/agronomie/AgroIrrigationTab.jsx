/* Module: agronomie | Déclaration(s): AgroIrrigationTab */
import { computeNutrients } from './computeNutrients.jsx';
import { displayCulture } from './displayCulture.jsx';

function AgroIrrigationTab({ data, getAlias, getFerme, farmFilter }) {
            const agro = data.agroData;
            const baseProducts = agro.fertigationProducts;
            const [programs, setPrograms] = React.useState(agro.fertigationPrograms);
            const [dynamicProducts, setDynamicProducts] = React.useState([]);
            const [apiStatus, setApiStatus] = React.useState('idle');
            const [apiSource, setApiSource] = React.useState('local');

            // Couleurs auto pour les produits dynamiques
            const autoColors = ['#E91E63','#9C27B0','#673AB7','#3F51B5','#009688','#FF5722','#795548','#607D8B','#CDDC39','#00BCD4','#FF9800','#4CAF50','#2196F3','#F44336','#8BC34A'];

            // Charger les données depuis l'API Cloud Functions
            React.useEffect(() => {
                setApiStatus('loading');
                fetch('/api/fertigation')
                    .then(r => r.json())
                    .then(json => {
                        if (json.success && json.data && Object.keys(json.data).length > 0) {
                            // Normaliser les noms SQL (trim, double spaces)
                            const normName = (n) => n.trim().replace(/\s+/g, ' ');
                            const allArticles = new Set();
                            const converted = {};
                            Object.entries(json.data).forEach(([parcelle, parcInfo]) => {
                                const weeks = {};
                                Object.entries(parcInfo.weeks || {}).forEach(([weekKey, weekInfo]) => {
                                    const days = {};
                                    Object.entries(weekInfo.days || {}).forEach(([dayKey, dayProducts]) => {
                                        const normalized = {};
                                        Object.entries(dayProducts).forEach(([article, qty]) => {
                                            const name = normName(article);
                                            allArticles.add(name);
                                            normalized[name] = (normalized[name] || 0) + qty;
                                        });
                                        days[dayKey] = normalized;
                                    });
                                    weeks[weekKey] = { ...weekInfo, days };
                                });
                                converted[parcelle] = { culture: parcInfo.culture, ferme: parcInfo.ferme, weeks };
                            });
                            // Créer des produits dynamiques pour chaque article SQL non déjà dans baseProducts
                            const baseNames = new Set(baseProducts.map(p => p.name));
                            const newProducts = [];
                            let colorIdx = 0;
                            allArticles.forEach(article => {
                                if (!baseNames.has(article)) {
                                    newProducts.push({
                                        name: article,
                                        key: article, // key = nom SQL directement
                                        color: autoColors[colorIdx % autoColors.length],
                                        unit: 'Kg',
                                        isSimple: false,
                                        composition: { N: 0, P: 0, K: 0, CaO: 0, MgO: 0 } // défaut, enrichi ci-dessous
                                    });
                                    colorIdx++;
                                }
                            });
                            // Enrichir les compositions depuis le catalogue TIMAC (déclaré dans AgroCompositionTab)
                            // Lookup rapide par nom normalisé
                            const compoLookup = {};
                            (agro.fertigationProducts || []).forEach(p => {
                                if (p.composition) compoLookup[p.name.toUpperCase().trim()] = p.composition;
                            });
                            // Ajouter les compositions connues du backend _RAW_COMPOSITIONS
                            const knownCompositions = {
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
                                'SULFATE D\'AMMONIAQUE': { N:21, P:0, K:0, CaO:0, MgO:0 },
                                'MKP': { N:0, P:52, K:34, CaO:0, MgO:0 },
                                'CO ACTYL H': { N:0, P:0, K:0, CaO:0, MgO:0 },
                                'CO-ACTYL-H': { N:0, P:0, K:0, CaO:0, MgO:0 },
                                'SULFATE DE ZINC': { N:0, P:0, K:0, CaO:0, MgO:0 },
                                'SULFATE DE MANGANESE': { N:0, P:0, K:0, CaO:0, MgO:0 },
                                'SC CALCUIM': { N:0, P:0, K:0, CaO:50, MgO:0 },
                                'N-K-P': { N:10, P:10, K:10, CaO:0, MgO:0 },
                                'ACIDE SULFIRIQUE': { N:0, P:0, K:0, CaO:0, MgO:0 },
                                'MAGICAL': { N:0, P:0, K:0, CaO:12, MgO:4 },
                                'FERTILAEDER ORIS PZN': { N:3, P:15, K:0, CaO:0, MgO:0 },
                            };
                            Object.entries(knownCompositions).forEach(([name, comp]) => {
                                compoLookup[name.toUpperCase().trim()] = comp;
                            });
                            newProducts.forEach(p => {
                                const match = compoLookup[p.name.toUpperCase().trim()];
                                if (match) p.composition = match;
                            });
                            setDynamicProducts(newProducts);
                            setPrograms(converted);
                            setApiStatus('ok');
                            setApiSource('api');
                        } else {
                            setApiStatus('error');
                        }
                    })
                    .catch(() => { setApiStatus('error'); });
            }, []);

            // Tous les produits = base (avec key=name SQL) + dynamiques
            var allProducts = baseProducts.map(function(p) { return Object.assign({}, p, { key: p.name }); }).concat(dynamicProducts);

            // ---- Cascade Ferme → Culture → Parcelle ----
            const [fermeFilter, setFermeFilter] = React.useState(farmFilter || 'Toutes');
            const [cultureFilter, setCultureFilter] = React.useState('Toutes');
            const [selParc, setSelParc] = React.useState('');
            const [weekIdx, setWeekIdx] = React.useState(0);
            const [popup, setPopup] = React.useState(null);
            const [viewMode, setViewMode] = React.useState('commercial');
            const [nutrientPopup, setNutrientPopup] = React.useState(null);

            // Toutes les parcelles avec leur culture/ferme (ferme = celle définie par l'utilisateur dans Parcelles)
            const allParcNames = Object.keys(programs).sort();
            var getParcFerme = function(p) { return getFerme(p, (programs[p] || {}).ferme); };

            // Fermes disponibles
            const allFermes = ['Toutes', ...new Set(allParcNames.map(p => getParcFerme(p)).filter(Boolean))].sort();

            // Filtrer par ferme
            const parcByFerme = fermeFilter === 'Toutes' ? allParcNames : allParcNames.filter(p => getParcFerme(p) === fermeFilter);

            // Cultures disponibles dans la ferme sélectionnée
            const culturesInFerme = ['Toutes', ...new Set(parcByFerme.map(p => displayCulture(programs[p].culture)).filter(Boolean))].sort();

            // Filtrer par culture
            var parcNamesAll = cultureFilter === 'Toutes' ? parcByFerme : parcByFerme.filter(p => displayCulture(programs[p].culture) === cultureFilter);

            // Filtrage spécifique par ferme pour Programme Ferti
            var fertiAllowedParcelles = {
                'F1': ['maravilla green can', 'maravilla logn can', 'maravilla long can', 'maravilla mow down'],
                'F5': ['breeze myrtille', 'cascade myrtille', 'f5 breeze', 'f5 cascade', 'f5 corina', 'yazmin cut back']
            };
            var parcNames = parcNamesAll;
            if (farmFilter && fertiAllowedParcelles[farmFilter]) {
                var allowed = fertiAllowedParcelles[farmFilter];
                // Filtrer depuis TOUTES les parcelles (pas seulement celles de la ferme)
                // car certaines parcelles (Breeze, Cascade) ont une ferme SQL différente (S8)
                var baseList = cultureFilter === 'Toutes' ? allParcNames : allParcNames.filter(function(p) { return displayCulture(programs[p].culture) === cultureFilter; });
                parcNames = baseList.filter(function(p) {
                    var name = p.toLowerCase();
                    var alias = (getAlias(p) || '').toLowerCase();
                    return allowed.some(function(a) { return name.indexOf(a) !== -1 || alias.indexOf(a) !== -1; });
                });
            }

            // Reset cascade: ferme change → reset culture & parcelle
            React.useEffect(() => { setCultureFilter('Toutes'); setSelParc(''); }, [fermeFilter]);
            // Culture change → reset parcelle
            React.useEffect(() => { setSelParc(''); }, [cultureFilter]);

            // Auto-select: si selParc n'est pas dans parcNames filtré, prendre le premier
            var effectiveParc = (selParc && programs[selParc] && parcNames.includes(selParc)) ? selParc : (parcNames[0] || '');

            const parcData = programs[effectiveParc] || { weeks: {} };
            const weekKeys = Object.keys(parcData.weeks || {}).sort().reverse();
            const safeWeekIdx = Math.min(weekIdx, Math.max(weekKeys.length - 1, 0));
            const curWeekKey = weekKeys[safeWeekIdx] || '';
            const weekData = (parcData.weeks || {})[curWeekKey] || { days: {} };

            // Calculer dates début (lundi) et fin (dimanche) de la semaine
            var weekDateRange = '';
            if (curWeekKey) {
                try {
                    var parts = curWeekKey.split('-W');
                    var yr = parseInt(parts[0]);
                    var wk = parseInt(parts[1]);
                    // ISO: semaine 1 contient le 4 janvier
                    var jan4 = new Date(yr, 0, 4);
                    var dayOfWeek = jan4.getDay() || 7; // lundi=1 ... dimanche=7
                    var monday = new Date(jan4);
                    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (wk - 1) * 7);
                    var sunday = new Date(monday);
                    sunday.setDate(monday.getDate() + 6);
                    var fmtD = function(d) { return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short' }); };
                    weekDateRange = fmtD(monday) + ' — ' + fmtD(sunday);
                } catch(e) {}
            }
            const days = ['lun','mar','mer','jeu','ven','sam','dim'];
            const dayLabels = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
            const dayData = weekData.days || {};

            // Produits actifs pour la SEMAINE en cours uniquement
            var usedKeys = {};
            try {
                Object.values(dayData).forEach(function(dayProds) {
                    Object.keys(dayProds || {}).forEach(function(k) {
                        if (dayProds[k] > 0) usedKeys[k] = true;
                    });
                });
            } catch(e) { /* safety */ }
            var displayProducts = allProducts.filter(function(p) { return usedKeys[p.key]; });

            // Format FR: virgule décimale
            var fmtFR = function(v, dec) { return v ? v.toFixed(dec !== undefined ? dec : 1).replace('.', ',') : '—'; };

            // Surface de la parcelle sélectionnée (pour mode Par Ha)
            var parcSup = 1;
            var matchParc = (agro.parcelles || []).find(function(p) { return p.parcelle === effectiveParc; });
            if (matchParc && matchParc.sup > 0) parcSup = matchParc.sup;
            var isPerHa = viewMode === 'active';
            var divHa = isPerHa ? parcSup : 1;

            // Fonctions utilitaires
            var getVal = function(day, key) { return (dayData[day] || {})[key] || 0; };
            var getValView = function(day, key) { return getVal(day, key) / divHa; };
            var totalDay = function(day) { return displayProducts.reduce(function(s, p) { return s + getVal(day, p.key); }, 0); };
            var totalDayView = function(day) { return totalDay(day) / divHa; };
            var dayNutrients = function(day) { return computeNutrients(dayData[day], displayProducts); };
            var hasProduct = function(key) { return days.some(function(d) { return getVal(d, key) > 0; }); };
            var dayActiveProducts = function(dayKey) { return displayProducts.filter(function(p) { return getVal(dayKey, p.key) > 0; }).map(function(p) { return Object.assign({}, p, { qty: getVal(dayKey, p.key) }); }); };

            // Détail nutriment par produit pour un jour ou la semaine
            var nutrientDetail = function(elt, scope) {
                var details = [];
                var compKey = elt === 'P' ? 'P' : elt === 'K' ? 'K' : elt;
                var daysToScan = scope === 'week' ? days : [scope];
                displayProducts.forEach(function(p) {
                    if (!p.composition || !p.composition[compKey]) return;
                    var totalQty = 0;
                    daysToScan.forEach(function(d) { totalQty += getVal(d, p.key); });
                    if (totalQty <= 0) return;
                    var pct = p.composition[compKey];
                    var apport = Math.round(totalQty * pct / 100 * 100) / 100;
                    if (apport > 0) details.push({ name: p.name, qty: totalQty / divHa, pct: pct, apport: apport / divHa, color: p.color });
                });
                return details.sort(function(a,b) { return b.apport - a.apport; });
            };

            // ---- CONVERSION OXYDES → ÉLÉMENTS ----
            var OX2EL = { P: 0.4364, K: 0.8302, Ca: 0.7147, Mg: 0.6031 };
            // Nutriments en éléments (N, P, K, Ca, Mg) pour un jour
            var dayElements = function(day) {
                var n = dayNutrients(day);
                return {
                    N: n.N / divHa, P: n.P * OX2EL.P / divHa, K: n.K * OX2EL.K / divHa,
                    Ca: n.CaO * OX2EL.Ca / divHa, Mg: n.MgO * OX2EL.Mg / divHa
                };
            };
            var nutColors = { N:'#2E86C1', P:'#E74C3C', K:'#F39C12', Ca:'#8E44AD', Mg:'#1ABC9C' };
            var nutLabelsPerHa = { N:'N (kg/Ha)', P:'P (kg/Ha)', K:'K (kg/Ha)', Ca:'Ca (kg/Ha)', Mg:'Mg (kg/Ha)' };
            var nutLabelsTotal = { N:'N (kg)', P:'P₂O₅ (kg)', K:'K₂O (kg)', CaO:'CaO (kg)', MgO:'MgO (kg)' };
            var nutLabels = isPerHa ? nutLabelsPerHa : nutLabelsTotal;
            var nutrientElementsOxide = ['N','P','K','CaO','MgO'];
            var nutrientElementsPure = ['N','P','K','Ca','Mg'];

            // Totaux semaine en éléments
            var elWeek = { N:0, P:0, K:0, Ca:0, Mg:0 };
            days.forEach(function(d) {
                var e = dayElements(d);
                elWeek.N += e.N; elWeek.P += e.P; elWeek.K += e.K; elWeek.Ca += e.Ca; elWeek.Mg += e.Mg;
            });
            var activeElRows = nutrientElementsPure.filter(function(elt) { return elWeek[elt] > 0.001; });

            // Totaux semaine oxydes (pour mode Total)
            var nutrientWeekTotals = {};
            nutrientElementsOxide.forEach(function(elt) {
                nutrientWeekTotals[elt] = days.reduce(function(s, d) { return s + dayNutrients(d)[elt]; }, 0);
            });
            var activeNutrientRows = nutrientElementsOxide.filter(function(elt) { return nutrientWeekTotals[elt] > 0; });

            // ---- ORIGINE AZOTE ----
            var nOriginMap = {
                'Nitrate de Calcium':   { NO3: 100, NH4: 0, org: 0 },
                'Nitrate de Potasse':   { NO3: 100, NH4: 0, org: 0 },
                'Nitrate de Magnesie':  { NO3: 100, NH4: 0, org: 0 },
                'Acide Nitrique':       { NO3: 100, NH4: 0, org: 0 },
                'NITRATE DE POTASSE':   { NO3: 100, NH4: 0, org: 0 },
                'NITRATE  DE POTASSE':  { NO3: 100, NH4: 0, org: 0 },
                'Ammonitrate':          { NO3: 50, NH4: 50, org: 0 },
                'AMMONITRATE':          { NO3: 50, NH4: 50, org: 0 },
                'MAP':                  { NO3: 0, NH4: 100, org: 0 },
                'MKP':                  { NO3: 0, NH4: 0, org: 0 },
                'UREE 46 %':           { NO3: 0, NH4: 0, org: 100 },
                "SULFATE D'AMMONIAQUE": { NO3: 0, NH4: 100, org: 0 },
                'SULFACIDE':            { NO3: 0, NH4: 100, org: 0 },
                'KSC I':    { NO3: 40, NH4: 40, org: 20 },
                'KSC II':   { NO3: 50, NH4: 30, org: 20 },
                'KSC III':  { NO3: 40, NH4: 40, org: 20 },
                'KSC V':    { NO3: 30, NH4: 40, org: 30 },
                'KSC 7 PERLA': { NO3: 60, NH4: 20, org: 20 },
                'KSC MIX':  { NO3: 0, NH4: 0, org: 0 },
                'AZO PRO':       { NO3: 20, NH4: 30, org: 50 },
                'AZO-PRO 31':    { NO3: 20, NH4: 30, org: 50 },
                'AZO-PRO NP':    { NO3: 20, NH4: 30, org: 50 },
                'AZO-PRO NK':    { NO3: 20, NH4: 30, org: 50 },
                'BIO ACTYL':     { NO3: 0, NH4: 0, org: 100 },
                'FERTIACTYL GZ': { NO3: 50, NH4: 50, org: 0 },
                'FERTIACTYL GREEN EXTREME': { NO3: 0, NH4: 0, org: 0 },
                'N-K-P':         { NO3: 33, NH4: 33, org: 34 },
                'FERTILAEDER ORIS PZN': { NO3: 0, NH4: 0, org: 100 },
                'RHIZO BORE':    { NO3: 50, NH4: 50, org: 0 },
                'RHIZO MNZN':    { NO3: 50, NH4: 50, org: 0 },
                'CO-ACTYL-NP':   { NO3: 0, NH4: 0, org: 100 },
            };
            var nOriginLookup = {};
            Object.entries(nOriginMap).forEach(function(e) { nOriginLookup[e[0].toUpperCase().trim()] = e[1]; });

            var dayNOrigin = function(day) {
                var result = { NO3: 0, NH4: 0, org: 0 };
                displayProducts.forEach(function(p) {
                    var qty = getVal(day, p.key);
                    if (qty <= 0 || !p.composition || !p.composition.N) return;
                    var nTotal = qty * p.composition.N / 100 / divHa;
                    var origin = nOriginLookup[p.name.toUpperCase().trim()];
                    if (origin) {
                        result.NO3 += nTotal * origin.NO3 / 100;
                        result.NH4 += nTotal * origin.NH4 / 100;
                        result.org += nTotal * origin.org / 100;
                    } else {
                        result.NO3 += nTotal * 0.5;
                        result.NH4 += nTotal * 0.5;
                    }
                });
                return result;
            };

            var nOriginWeek = { NO3: 0, NH4: 0, org: 0 };
            days.forEach(function(d) {
                var o = dayNOrigin(d);
                nOriginWeek.NO3 += o.NO3; nOriginWeek.NH4 += o.NH4; nOriginWeek.org += o.org;
            });

            // ---- MILLIÉQUIVALENTS (meq) ----
            // meq = kg_element × 1000 / (masse_atomique / valence)
            var MEQ = { NO3: 1000/14, NH4: 1000/14, K: 1000/39.1, Ca: 1000/20.04, Mg: 1000/12.155, P: 1000/31 };

            var dayMeq = function(day) {
                var e = dayElements(day);
                var o = dayNOrigin(day);
                return {
                    NO3: o.NO3 * MEQ.NO3, NH4: o.NH4 * MEQ.NH4,
                    K: e.K * MEQ.K, Ca: e.Ca * MEQ.Ca, Mg: e.Mg * MEQ.Mg, P: e.P * MEQ.P
                };
            };

            var meqWeek = { NO3: 0, NH4: 0, K: 0, Ca: 0, Mg: 0, P: 0 };
            days.forEach(function(d) {
                var m = dayMeq(d);
                meqWeek.NO3 += m.NO3; meqWeek.NH4 += m.NH4; meqWeek.K += m.K;
                meqWeek.Ca += m.Ca; meqWeek.Mg += m.Mg; meqWeek.P += m.P;
            });

            // %cations en meq
            var totalCatMeq = meqWeek.K + meqWeek.Ca + meqWeek.Mg + meqWeek.NH4;
            var pctK = totalCatMeq > 0 ? meqWeek.K / totalCatMeq * 100 : 0;
            var pctCa = totalCatMeq > 0 ? meqWeek.Ca / totalCatMeq * 100 : 0;
            var pctMg = totalCatMeq > 0 ? meqWeek.Mg / totalCatMeq * 100 : 0;
            var pctNH4 = totalCatMeq > 0 ? meqWeek.NH4 / totalCatMeq * 100 : 0;

            // %cations par jour
            var dayPctCat = function(day) {
                var m = dayMeq(day);
                var tot = m.K + m.Ca + m.Mg + m.NH4;
                return {
                    K: tot > 0 ? m.K/tot*100 : 0, Ca: tot > 0 ? m.Ca/tot*100 : 0,
                    Mg: tot > 0 ? m.Mg/tot*100 : 0, NH4: tot > 0 ? m.NH4/tot*100 : 0
                };
            };

            // ---- RATIOS (meq) ----
            var ratioNO3_NH4 = meqWeek.NH4 > 0 ? meqWeek.NO3 / meqWeek.NH4 : (meqWeek.NO3 > 0 ? 999 : 0);
            var ratioN_K = meqWeek.K > 0 ? (meqWeek.NO3 + meqWeek.NH4) / meqWeek.K : 0;
            var ratioN_P = meqWeek.P > 0 ? (meqWeek.NO3 + meqWeek.NH4) / meqWeek.P : 0;
            var ratioK_Mg = meqWeek.Mg > 0 ? meqWeek.K / meqWeek.Mg : 0;
            var ratioCa_Mg = meqWeek.Mg > 0 ? meqWeek.Ca / meqWeek.Mg : 0;
            var ratioK_Ca_Mg_N = (meqWeek.NO3 + meqWeek.NH4) > 0 ? (meqWeek.K + meqWeek.Ca + meqWeek.Mg) / (meqWeek.NO3 + meqWeek.NH4) : 0;

            // Ratios par jour en meq
            var dayRatioMeq = function(day) {
                var m = dayMeq(day);
                var nTot = m.NO3 + m.NH4;
                return {
                    NO3_NH4: m.NH4 > 0 ? m.NO3/m.NH4 : (m.NO3 > 0 ? 999 : 0),
                    N_K: m.K > 0 ? nTot/m.K : 0,
                    N_P: m.P > 0 ? nTot/m.P : 0,
                    K_Mg: m.Mg > 0 ? m.K/m.Mg : 0,
                    Ca_Mg: m.Mg > 0 ? m.Ca/m.Mg : 0,
                    KCaMg_N: nTot > 0 ? (m.K+m.Ca+m.Mg)/nTot : 0
                };
            };

            // ---- EC ENGRAIS (estimé) ----
            // Formule du PJ : EC = (NO3_mM + K_mM + Ca_mM*2 + Mg_mM*2) * 0.095 + 0.19
            // Pour obtenir mM depuis kg/Ha, on divise par le volume d'irrigation (L/Ha)
            // Volume standard par défaut: 5000 L/Ha/jour (5 m³)
            var irrigVolLHa = 5000;
            var dayEC = function(day) {
                var e = dayElements(day);
                var o = dayNOrigin(day);
                // Conversion kg → mmol: kg × 1e6 (mg) / MW / volume_L
                var NO3_mM = o.NO3 * 1e6 / 62 / irrigVolLHa; // MW NO3 = 62
                var K_mM = e.K * 1e6 / 39.1 / irrigVolLHa;
                var Ca_mM = e.Ca * 1e6 / 40.08 / irrigVolLHa;
                var Mg_mM = e.Mg * 1e6 / 24.31 / irrigVolLHa;
                var sumCat = NO3_mM + K_mM + Ca_mM * 2 + Mg_mM * 2;
                return sumCat > 0 ? sumCat * 0.095 + 0.19 : 0;
            };
            var weekECavg = 0;
            var ecCount = 0;
            days.forEach(function(d) { var ec = dayEC(d); if (ec > 0) { weekECavg += ec; ecCount++; } });
            weekECavg = ecCount > 0 ? weekECavg / ecCount : 0;

            const thSt = {padding:'8px 10px',fontSize:12,fontWeight:700,textAlign:'center',borderBottom:'2px solid #2D8B4E',background:'#2D8B4E',color:'#fff'};
            const tdSt = {padding:'6px 8px',fontSize:12,textAlign:'center',borderBottom:'1px solid #eee'};
            const tdLbl = {padding:'6px 8px',fontSize:12,fontWeight:600,borderBottom:'1px solid #eee',whiteSpace:'nowrap'};

            return (
                <div className="fade-in">
                    {/* ---- POPUP DETAIL JOUR ---- */}
                    {popup && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',animation:'fadeIn 0.2s'}} onClick={() => setPopup(null)}>
                            <div style={{background:'#fff',borderRadius:16,boxShadow:'0 20px 60px rgba(0,0,0,0.3)',maxWidth:520,width:'92%',maxHeight:'85vh',overflow:'auto',animation:'fadeIn 0.25s'}} onClick={e => e.stopPropagation()}>
                                <div style={{padding:'16px 20px',background:'linear-gradient(135deg,#2D8B4E,#1B5E20)',borderRadius:'16px 16px 0 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                    <div>
                                        <div style={{color:'#fff',fontWeight:800,fontSize:16}}><i className="fa-solid fa-calendar-day" style={{marginRight:8}}></i>{popup.dayLabel}</div>
                                        <div style={{color:'#ffffffbb',fontSize:12}}>{getAlias(selParc)} — {parcData.culture}</div>
                                    </div>
                                    <button onClick={() => setPopup(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'#fff',width:32,height:32,borderRadius:8,cursor:'pointer',fontSize:16}}>✕</button>
                                </div>
                                <div style={{padding:'16px 20px'}}>
                                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:12,padding:'8px 12px',background:'#E8F5E9',borderRadius:8}}>
                                        <span style={{fontWeight:700,color:'#2D8B4E'}}>Total du jour</span>
                                        <span style={{fontWeight:800,color:'#2D8B4E',fontSize:16}}>{fmtFR(totalDay(popup.dayKey))} kg</span>
                                    </div>
                                    <div style={{fontSize:11,color:'var(--gray-400)',marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:1}}>
                                        {viewMode === 'commercial' ? 'Produits appliqués — Noms Commerciaux' : 'Matières Actives (quantités redistribuées)'}
                                    </div>
                                    {dayActiveProducts(popup.dayKey).map((p, i) => {
                                        const dayTotal = totalDay(popup.dayKey);
                                        const pct = dayTotal > 0 ? (p.qty / dayTotal * 100) : 0;
                                        return (
                                            <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid #f5f5f5'}}>
                                                <div style={{width:8,height:8,borderRadius:4,background:p.color || '#F5A623',flexShrink:0}}></div>
                                                <div style={{flex:1}}>
                                                    <div style={{fontSize:13,fontWeight:700,color:'#333'}}>{p.name}</div>
                                                    {!p.isSimple && p.composition && (p.composition.N + p.composition.P + p.composition.K) > 0 && <div style={{fontSize:10,color:'#D81B60',marginTop:1}}><i className="fa-solid fa-cubes" style={{marginRight:3,fontSize:8}}></i>{p.composition.N}-{p.composition.P}-{p.composition.K}</div>}
                                                    {p.isSimple && viewMode === 'active' && p.composition && <div style={{fontSize:10,color:'#1565C0',marginTop:1}}><i className="fa-solid fa-flask" style={{marginRight:3,fontSize:8}}></i>{p.composition.N}-{p.composition.P}-{p.composition.K}</div>}
                                                    <div style={{marginTop:4,height:6,background:'#f0f0f0',borderRadius:3,overflow:'hidden'}}>
                                                        <div style={{width:pct+'%',height:'100%',background:p.color || '#F5A623',borderRadius:3,transition:'width 0.3s'}}></div>
                                                    </div>
                                                </div>
                                                <div style={{textAlign:'right',flexShrink:0}}>
                                                    <div style={{fontWeight:700,fontSize:14,color:'var(--berry)'}}>{fmtFR(p.qty)} {p.unit}</div>
                                                    <div style={{fontSize:10,color:'var(--gray-400)'}}>{pct.toFixed(0)}%</div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {dayActiveProducts(popup.dayKey).length === 0 && (
                                        <div style={{textAlign:'center',padding:20,color:'var(--gray-400)'}}>Aucun produit ce jour</div>
                                    )}
                                    {/* Apports nutritifs du jour */}
                                    {viewMode === 'active' && popup && dayNutrients(popup.dayKey).N + dayNutrients(popup.dayKey).P + dayNutrients(popup.dayKey).K + dayNutrients(popup.dayKey).CaO + dayNutrients(popup.dayKey).MgO > 0 && (
                                        <div style={{marginTop:10,padding:'8px 12px',background:'#E3F2FD',borderRadius:8,border:'1px solid #90CAF9',fontSize:11}}>
                                            <div style={{fontWeight:700,color:'#1565C0',marginBottom:4}}><i className="fa-solid fa-flask" style={{marginRight:4}}></i>Apports nutritifs du jour</div>
                                            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                                                {dayNutrients(popup.dayKey).N > 0 && <span style={{color:'#2E86C1',fontWeight:700}}>N: {fmtFR(dayNutrients(popup.dayKey).N, 2)} kg</span>}
                                                {dayNutrients(popup.dayKey).P > 0 && <span style={{color:'#E74C3C',fontWeight:700}}>P₂O₅: {fmtFR(dayNutrients(popup.dayKey).P, 2)} kg</span>}
                                                {dayNutrients(popup.dayKey).K > 0 && <span style={{color:'#F39C12',fontWeight:700}}>K₂O: {fmtFR(dayNutrients(popup.dayKey).K, 2)} kg</span>}
                                                {dayNutrients(popup.dayKey).CaO > 0 && <span style={{color:'#8E44AD',fontWeight:700}}>CaO: {fmtFR(dayNutrients(popup.dayKey).CaO, 2)} kg</span>}
                                                {dayNutrients(popup.dayKey).MgO > 0 && <span style={{color:'#1ABC9C',fontWeight:700}}>MgO: {fmtFR(dayNutrients(popup.dayKey).MgO, 2)} kg</span>}
                                            </div>
                                        </div>
                                    )}
                                    <div style={{marginTop:12,display:'flex',gap:8}}>
                                        <div style={{flex:1,padding:'8px 12px',background:'#E3F2FD',borderRadius:8,textAlign:'center'}}>
                                            <div style={{fontSize:10,color:'#1565C0',fontWeight:600}}>EC engrais</div>
                                            <div style={{fontWeight:800,color:'#1565C0',fontSize:15}}>{weekData.ec || '—'}</div>
                                        </div>
                                        <div style={{flex:1,padding:'8px 12px',background:'#C8E6C9',borderRadius:8,textAlign:'center'}}>
                                            <div style={{fontSize:10,color:'#1B5E20',fontWeight:600}}>DCE/h irrig.</div>
                                            <div style={{fontWeight:800,color:'#1B5E20',fontSize:15}}>{weekData.dce || '—'}</div>
                                        </div>
                                        <div style={{flex:1,padding:'8px 12px',background:'#FFF8E1',borderRadius:8,textAlign:'center'}}>
                                            <div style={{fontSize:10,color:'#F57F17',fontWeight:600}}>Nb produits</div>
                                            <div style={{fontWeight:800,color:'#F57F17',fontSize:15}}>{dayActiveProducts(popup.dayKey).length}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ---- POPUP DETAIL NUTRIMENT ---- */}
                    {nutrientPopup && (() => {
                        var elt = nutrientPopup.elt;
                        var scope = nutrientPopup.scope; // dayKey or 'week'
                        var details = nutrientDetail(elt, scope);
                        var totalApport = details.reduce(function(s,d) { return s + d.apport; }, 0);
                        var scopeLabel = scope === 'week' ? 'Semaine' : ({'lun':'Lundi','mar':'Mardi','mer':'Mercredi','jeu':'Jeudi','ven':'Vendredi','sam':'Samedi','dim':'Dimanche'}[scope] || scope);
                        return (
                            <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',animation:'fadeIn 0.2s'}} onClick={() => setNutrientPopup(null)}>
                                <div style={{background:'#fff',borderRadius:16,boxShadow:'0 20px 60px rgba(0,0,0,0.3)',maxWidth:560,width:'94%',maxHeight:'85vh',overflow:'auto',animation:'fadeIn 0.25s'}} onClick={e => e.stopPropagation()}>
                                    <div style={{padding:'16px 20px',background:nutColors[elt],borderRadius:'16px 16px 0 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                        <div>
                                            <div style={{color:'#fff',fontWeight:800,fontSize:16}}><i className="fa-solid fa-flask" style={{marginRight:8}}></i>{nutLabels[elt]} — Détail du calcul</div>
                                            <div style={{color:'#ffffffbb',fontSize:12}}>{getAlias(effectiveParc)} — {scopeLabel}</div>
                                        </div>
                                        <button onClick={() => setNutrientPopup(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'#fff',width:32,height:32,borderRadius:8,cursor:'pointer',fontSize:16}}>✕</button>
                                    </div>
                                    <div style={{padding:'16px 20px'}}>
                                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:12,padding:'8px 12px',background:'#E3F2FD',borderRadius:8}}>
                                            <span style={{fontWeight:700,color:nutColors[elt]}}>Total {nutLabels[elt]}</span>
                                            <span style={{fontWeight:800,color:nutColors[elt],fontSize:16}}>{fmtFR(totalApport, 2)} kg</span>
                                        </div>
                                        <div style={{fontSize:10,color:'var(--gray-400)',marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:1}}>
                                            Formule : Quantité (kg) × Teneur (%) / 100 = Apport (kg)
                                        </div>
                                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                            <thead>
                                                <tr style={{borderBottom:'2px solid '+nutColors[elt]}}>
                                                    <th style={{textAlign:'left',padding:'6px 8px',fontWeight:700}}>Produit</th>
                                                    <th style={{textAlign:'center',padding:'6px 8px',fontWeight:700}}>Quantité</th>
                                                    <th style={{textAlign:'center',padding:'6px 8px',fontWeight:700}}>Teneur %</th>
                                                    <th style={{textAlign:'center',padding:'6px 8px',fontWeight:700}}>Apport (kg)</th>
                                                    <th style={{textAlign:'center',padding:'6px 8px',fontWeight:700}}>%</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {details.map(function(d, i) {
                                                    var pctTotal = totalApport > 0 ? (d.apport / totalApport * 100) : 0;
                                                    return (
                                                        <tr key={i} style={{borderBottom:'1px solid #eee'}}>
                                                            <td style={{padding:'6px 8px'}}>
                                                                <div style={{display:'flex',alignItems:'center',gap:6}}>
                                                                    <div style={{width:6,height:6,borderRadius:3,background:d.color,flexShrink:0}}></div>
                                                                    <strong>{d.name}</strong>
                                                                </div>
                                                            </td>
                                                            <td style={{textAlign:'center',padding:'6px 8px'}}>{fmtFR(d.qty)} kg</td>
                                                            <td style={{textAlign:'center',padding:'6px 8px',color:nutColors[elt],fontWeight:700}}>{d.pct}%</td>
                                                            <td style={{textAlign:'center',padding:'6px 8px',fontWeight:700,color:nutColors[elt]}}>{fmtFR(d.apport, 2)} kg</td>
                                                            <td style={{textAlign:'center',padding:'6px 8px'}}>
                                                                <div style={{display:'flex',alignItems:'center',gap:4}}>
                                                                    <div style={{flex:1,height:6,background:'#f0f0f0',borderRadius:3,overflow:'hidden'}}>
                                                                        <div style={{width:pctTotal+'%',height:'100%',background:nutColors[elt],borderRadius:3}}></div>
                                                                    </div>
                                                                    <span style={{fontSize:10,minWidth:30}}>{pctTotal.toFixed(0)}%</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                                {details.length === 0 && <tr><td colSpan={5} style={{padding:20,textAlign:'center',color:'#999'}}>Aucun produit ne contribue à {nutLabels[elt]}</td></tr>}
                                            </tbody>
                                            {details.length > 0 && <tfoot>
                                                <tr style={{background:'#f5f5f5',fontWeight:700}}>
                                                    <td style={{padding:'8px'}}>TOTAL</td>
                                                    <td style={{textAlign:'center',padding:'8px'}}>{fmtFR(details.reduce(function(s,d){return s+d.qty;},0))} kg</td>
                                                    <td style={{textAlign:'center',padding:'8px'}}>—</td>
                                                    <td style={{textAlign:'center',padding:'8px',color:nutColors[elt]}}>{fmtFR(totalApport, 2)} kg</td>
                                                    <td style={{textAlign:'center',padding:'8px'}}>100%</td>
                                                </tr>
                                            </tfoot>}
                                        </table>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* ---- FERME BUTTONS ---- */}
                    {!farmFilter && <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                        {allFermes.map(f => (
                            <button key={f} onClick={() => setFermeFilter(f)}
                                className={`chip c-berry ${fermeFilter===f ? 'active' : ''}`}>
                                {f === 'Toutes' ? <><i className="fa-solid fa-layer-group" style={{marginRight:4}}></i>Toutes</> : f}
                            </button>
                        ))}
                    </div>}

                    {/* ---- CULTURE + PARCELLE + TOGGLE + SEMAINE ---- */}
                    <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16,alignItems:'flex-end'}}>
                        <div style={{minWidth:160}}>
                            <label style={{fontSize:11,color:'var(--gray-400)',display:'block',marginBottom:4}}>Culture</label>
                            <select value={cultureFilter} onChange={e => setCultureFilter(e.target.value)}
                                style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,background:'#fff'}}>
                                {culturesInFerme.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div style={{flex:1,minWidth:260}}>
                            <label style={{fontSize:11,color:'var(--gray-400)',display:'block',marginBottom:4}}>Parcelle Culturale</label>
                            <select value={effectiveParc} onChange={e => { setSelParc(e.target.value); setWeekIdx(0); }}
                                style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,background:'#fff'}}>
                                {parcNames.map(p => <option key={p} value={p}>{getAlias(p)} — {programs[p].culture} ({getParcFerme(p)})</option>)}
                            </select>
                        </div>
                        {/* Toggle Total / Par Ha */}
                        <div className="chip-group">
                            <button className={`chip c-green ${viewMode==='commercial' ? 'active' : ''}`} onClick={() => setViewMode('commercial')}>
                                <i className="fa-solid fa-tag" style={{marginRight:4}}></i>Total
                            </button>
                            <button className={`chip c-blue ${viewMode==='active' ? 'active' : ''}`} onClick={() => setViewMode('active')}>
                                <i className="fa-solid fa-flask" style={{marginRight:4}}></i>Par Ha
                            </button>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <button onClick={() => setWeekIdx(Math.min(weekIdx+1, weekKeys.length-1))} disabled={weekIdx >= weekKeys.length-1}
                                style={{padding:'6px 12px',borderRadius:6,border:'1px solid #ddd',background:weekIdx >= weekKeys.length-1 ? '#f5f5f5':'#fff',cursor:weekIdx >= weekKeys.length-1?'default':'pointer',fontSize:12}}>
                                <i className="fa-solid fa-chevron-left"></i> Sem. précédente
                            </button>
                            <div style={{minWidth:200,textAlign:'center'}}>
                                <div style={{fontWeight:700,fontSize:13,color:'var(--berry)'}}>{weekData.label || curWeekKey}</div>
                                {weekDateRange && <div style={{fontSize:10,color:'var(--gray-400)',marginTop:2}}>{weekDateRange}</div>}
                            </div>
                            <button onClick={() => setWeekIdx(Math.max(weekIdx-1, 0))} disabled={weekIdx <= 0}
                                style={{padding:'6px 12px',borderRadius:6,border:'1px solid #ddd',background:weekIdx <= 0 ? '#f5f5f5':'#fff',cursor:weekIdx <= 0?'default':'pointer',fontSize:12}}>
                                Sem. suivante <i className="fa-solid fa-chevron-right"></i>
                            </button>
                        </div>
                    </div>

                    <div className="panel" style={{padding:0,overflow:'auto'}}>
                        <div style={{padding:'12px 16px',background:'linear-gradient(135deg,#2D8B4E11,#8B225211)',borderBottom:'1px solid #eee',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
                            <div>
                                <span style={{fontSize:11,color:'var(--gray-400)'}}>Culture</span>
                                <span style={{fontWeight:700,fontSize:14,marginLeft:8,color:'var(--green)'}}>{parcData.culture}</span>
                                <span style={{fontSize:11,color:'var(--gray-400)',marginLeft:12}}>Ferme</span>
                                <span style={{fontWeight:700,fontSize:14,marginLeft:4,color:'var(--berry)'}}>{getParcFerme(effectiveParc)}</span>
                            </div>
                            <div style={{fontSize:11,color:'var(--gray-400)'}}><i className="fa-solid fa-hand-pointer" style={{marginRight:4}}></i>Cliquez sur un jour pour voir le détail</div>
                        </div>
                        <table style={{width:'100%',borderCollapse:'collapse'}}>
                            <thead>
                                <tr>
                                    <th style={{...thSt,textAlign:'left',minWidth:220}}>{viewMode === 'commercial' ? 'Produit (Total kg)' : 'Produit (kg/Ha — ' + parcSup + ' Ha)'}</th>
                                    {dayLabels.map((d,i) => (
                                        <th key={i} style={{...thSt,cursor:'pointer',transition:'all 0.2s'}}
                                            onClick={() => setPopup({dayIdx:i, dayKey:days[i], dayLabel:d})}
                                            onMouseEnter={e => { e.target.style.background='#1B5E20'; e.target.style.transform='scale(1.05)'; }}
                                            onMouseLeave={e => { e.target.style.background='#2D8B4E'; e.target.style.transform='scale(1)'; }}>
                                            {d} <i className="fa-solid fa-up-right-from-square" style={{fontSize:8,marginLeft:3,opacity:0.7}}></i>
                                        </th>
                                    ))}
                                    <th style={{...thSt,background:'var(--berry)'}}>Total Sem.</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayProducts.map((p, idx) => {
                                    const active = hasProduct(p.key);
                                    const weekTotal = days.reduce((s, d) => s + getVal(d, p.key), 0) / divHa;
                                    return (
                                        <tr key={idx} style={{background: active ? '#FFF8E1' : (idx%2===0?'#fff':'#fafafa')}}>
                                            <td style={{...tdLbl, color: active ? '#8B4513':'#999'}}>
                                                <div style={{display:'flex',alignItems:'center',gap:6}}>
                                                    <div style={{width:6,height:6,borderRadius:3,background:p.color,flexShrink:0}}></div>
                                                    <span>{p.name}</span>
                                                    {!p.isSimple && p.composition && (p.composition.N + p.composition.P + p.composition.K) > 0 && <span style={{fontSize:9,background:'#FCE4EC',color:'#D81B60',padding:'1px 5px',borderRadius:4,marginLeft:4}}>{p.composition.N}-{p.composition.P}-{p.composition.K}</span>}
                                                </div>
                                                <div style={{fontSize:9,color:'#999',marginLeft:12}}>({p.unit}{isPerHa ? '/Ha' : ''})</div>
                                            </td>
                                            {days.map((d,di) => {
                                                const v = getValView(d, p.key);
                                                return <td key={di} style={{...tdSt, fontWeight: v ? 600:400, color: v ? '#333':'#ddd', cursor:'pointer'}}
                                                    onClick={() => setPopup({dayIdx:di, dayKey:d, dayLabel:dayLabels[di]})}>{fmtFR(v, isPerHa ? 2 : 1)}</td>;
                                            })}
                                            <td style={{...tdSt, fontWeight:700, color: weekTotal ? 'var(--berry)':'#ddd', background: '#fdf0f5'}}>{fmtFR(weekTotal, isPerHa ? 2 : 1)}</td>
                                        </tr>
                                    );
                                })}
                                {/* === ÉLÉMENTS N, P, K, Ca, Mg (Par Ha uniquement) === */}
                                {isPerHa && activeElRows.length > 0 && (
                                    <React.Fragment>
                                        <tr><td colSpan={days.length + 2} style={{padding:10,background:'#fff'}}></td></tr>
                                        <tr><td colSpan={days.length + 2} style={{padding:'5px 8px',fontSize:10,fontWeight:700,color:'#1565C0',background:'#E3F2FD',borderBottom:'2px solid #90CAF9',textTransform:'uppercase',letterSpacing:1}}>
                                            <i className="fa-solid fa-flask" style={{marginRight:4}}></i>Équilibre (kg/Ha)
                                        </td></tr>
                                        {activeElRows.map(elt => (
                                            <tr key={'el_'+elt} style={{background:'#E3F2FD',cursor:'pointer'}} title={'Détail ' + elt}>
                                                <td style={{...tdLbl,fontWeight:700,color:nutColors[elt],fontSize:11,cursor:'pointer'}} onClick={() => setNutrientPopup({elt: elt==='Ca'?'CaO':elt==='Mg'?'MgO':elt, scope:'week'})}>
                                                    <i className="fa-solid fa-flask" style={{marginRight:4,fontSize:9}}></i>
                                                    {nutLabelsPerHa[elt]} <i className="fa-solid fa-magnifying-glass-chart" style={{fontSize:8,marginLeft:4,opacity:0.6}}></i>
                                                </td>
                                                {days.map((d,i) => { var v = dayElements(d)[elt]; return <td key={i} style={{...tdSt,fontWeight:v>0.001?700:400,color:v>0.001?nutColors[elt]:'#ddd',fontSize:11,cursor:v>0.001?'pointer':'default'}}
                                                    onClick={() => v>0.001 && setNutrientPopup({elt: elt==='Ca'?'CaO':elt==='Mg'?'MgO':elt, scope:d})}>{fmtFR(v, 2)}</td>; })}
                                                <td style={{...tdSt,fontWeight:700,color:nutColors[elt],background:'#BBDEFB',fontSize:11}}>{fmtFR(elWeek[elt], 2)}</td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                )}

                                {/* === ORIGINE AZOTE === */}
                                {isPerHa && elWeek.N > 0 && (
                                    <React.Fragment>
                                        <tr><td colSpan={days.length + 2} style={{padding:'5px 8px',fontSize:10,fontWeight:700,color:'#1565C0',background:'#E3F2FD',borderBottom:'2px solid #90CAF9',textTransform:'uppercase',letterSpacing:1}}>
                                            <i className="fa-solid fa-atom" style={{marginRight:4}}></i>Origine Azote (kg/Ha)
                                        </td></tr>
                                        <tr style={{background:'#E8F5E9'}}>
                                            <td style={{...tdLbl,fontWeight:600,color:'#2E7D32',fontSize:11}}><span style={{display:'inline-block',width:8,height:8,borderRadius:4,background:'#4CAF50',marginRight:4}}></span>N-NO₃⁻</td>
                                            {days.map((d,i) => { var v = dayNOrigin(d).NO3; return <td key={i} style={{...tdSt,fontSize:11,color:v?'#2E7D32':'#ddd',fontWeight:v?600:400}}>{fmtFR(v, 2)}</td>; })}
                                            <td style={{...tdSt,fontWeight:700,color:'#2E7D32',background:'#C8E6C9',fontSize:11}}>{fmtFR(nOriginWeek.NO3, 2)}</td>
                                        </tr>
                                        <tr style={{background:'#FFF8E1'}}>
                                            <td style={{...tdLbl,fontWeight:600,color:'#E65100',fontSize:11}}><span style={{display:'inline-block',width:8,height:8,borderRadius:4,background:'#FF9800',marginRight:4}}></span>N-NH₄⁺</td>
                                            {days.map((d,i) => { var v = dayNOrigin(d).NH4; return <td key={i} style={{...tdSt,fontSize:11,color:v?'#E65100':'#ddd',fontWeight:v?600:400}}>{fmtFR(v, 2)}</td>; })}
                                            <td style={{...tdSt,fontWeight:700,color:'#E65100',background:'#FFE0B2',fontSize:11}}>{fmtFR(nOriginWeek.NH4, 2)}</td>
                                        </tr>
                                        {nOriginWeek.org > 0 && (
                                            <tr style={{background:'#F3E5F5'}}>
                                                <td style={{...tdLbl,fontWeight:600,color:'#6A1B9A',fontSize:11}}><span style={{display:'inline-block',width:8,height:8,borderRadius:4,background:'#9C27B0',marginRight:4}}></span>N org./uréique</td>
                                                {days.map((d,i) => { var v = dayNOrigin(d).org; return <td key={i} style={{...tdSt,fontSize:11,color:v?'#6A1B9A':'#ddd',fontWeight:v?600:400}}>{fmtFR(v, 2)}</td>; })}
                                                <td style={{...tdSt,fontWeight:700,color:'#6A1B9A',background:'#E1BEE7',fontSize:11}}>{fmtFR(nOriginWeek.org, 2)}</td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                )}

                                {/* === RATIOS IONIQUES (meq) === */}
                                {isPerHa && elWeek.N > 0 && (
                                    <React.Fragment>
                                        <tr><td colSpan={days.length + 2} style={{padding:'5px 8px',fontSize:10,fontWeight:700,color:'#37474F',background:'#ECEFF1',borderBottom:'2px solid #90A4AE',textTransform:'uppercase',letterSpacing:1}}>
                                            <i className="fa-solid fa-scale-balanced" style={{marginRight:4}}></i>Ratios ioniques (meq)
                                        </td></tr>
                                        {[
                                            {label:'NO₃⁻/NH₄⁺', key:'NO3_NH4', color:'#37474F', bg:'#ECEFF1', bgW:'#CFD8DC', weekVal:ratioNO3_NH4},
                                            {label:'N/K',        key:'N_K',     color:'#006064', bg:'#E0F7FA', bgW:'#B2EBF2', weekVal:ratioN_K},
                                            {label:'N/P',        key:'N_P',     color:'#4E342E', bg:'#EFEBE9', bgW:'#D7CCC8', weekVal:ratioN_P},
                                            {label:'K/Mg',       key:'K_Mg',    color:'#1B5E20', bg:'#E8F5E9', bgW:'#C8E6C9', weekVal:ratioK_Mg},
                                            {label:'Ca/Mg',      key:'Ca_Mg',   color:'#4A148C', bg:'#F3E5F5', bgW:'#E1BEE7', weekVal:ratioCa_Mg},
                                            {label:'(K+Ca+Mg)/N',key:'KCaMg_N', color:'#BF360C', bg:'#FFF3E0', bgW:'#FFCCBC', weekVal:ratioK_Ca_Mg_N},
                                        ].map(r => (
                                            <tr key={'r_'+r.key} style={{background:r.bg}}>
                                                <td style={{...tdLbl,fontWeight:700,color:r.color,fontSize:11}}><i className="fa-solid fa-chart-pie" style={{marginRight:4,fontSize:9}}></i>{r.label}</td>
                                                {days.map((d,i) => { var dr = dayRatioMeq(d); var v = dr[r.key]; var s = v >= 999 ? '∞' : (v > 0 ? fmtFR(v, 2) : '—');
                                                    return <td key={i} style={{...tdSt,fontSize:11,fontWeight:v?700:400,color:v?r.color:'#ddd'}}>{s}</td>; })}
                                                <td style={{...tdSt,fontWeight:800,color:r.color,background:r.bgW,fontSize:11}}>{r.weekVal >= 999 ? '∞' : (r.weekVal > 0 ? fmtFR(r.weekVal, 2) : '—')}</td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                )}

                                {/* === % CATIONS (meq) === */}
                                {isPerHa && totalCatMeq > 0 && (
                                    <React.Fragment>
                                        <tr><td colSpan={days.length + 2} style={{padding:'5px 8px',fontSize:10,fontWeight:700,color:'#880E4F',background:'#FCE4EC',borderBottom:'2px solid #F48FB1',textTransform:'uppercase',letterSpacing:1}}>
                                            <i className="fa-solid fa-percent" style={{marginRight:4}}></i>Équilibre cationique (% meq)
                                        </td></tr>
                                        {[
                                            {label:'%K',   elt:'K',   color:'#F39C12', bg:'#FFF8E1', bgW:'#FFE082', weekVal:pctK},
                                            {label:'%Ca',  elt:'Ca',  color:'#8E44AD', bg:'#F3E5F5', bgW:'#CE93D8', weekVal:pctCa},
                                            {label:'%Mg',  elt:'Mg',  color:'#1ABC9C', bg:'#E0F2F1', bgW:'#80CBC4', weekVal:pctMg},
                                            {label:'%NH₄⁺',elt:'NH4', color:'#E65100', bg:'#FFF3E0', bgW:'#FFCC80', weekVal:pctNH4},
                                        ].map(c => (
                                            <tr key={'pct_'+c.elt} style={{background:c.bg}}>
                                                <td style={{...tdLbl,fontWeight:700,color:c.color,fontSize:11}}><i className="fa-solid fa-chart-pie" style={{marginRight:4,fontSize:9}}></i>{c.label}</td>
                                                {days.map((d,i) => { var p = dayPctCat(d); var v = p[c.elt]; return <td key={i} style={{...tdSt,fontSize:11,fontWeight:v>0?700:400,color:v>0?c.color:'#ddd'}}>{v > 0 ? fmtFR(v, 1)+'%' : '—'}</td>; })}
                                                <td style={{...tdSt,fontWeight:800,color:c.color,background:c.bgW,fontSize:11}}>{c.weekVal > 0 ? fmtFR(c.weekVal, 1)+'%' : '—'}</td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                )}

                                {/* === TOTAL + EC === */}
                                <tr style={{background:'#E8F5E9'}}>
                                    <td style={{...tdLbl,fontWeight:800,color:'#2D8B4E',fontSize:13}}>{isPerHa ? 'Total kg/Ha/jour' : 'Total kg/jour'}</td>
                                    {days.map((d,i) => <td key={i} style={{...tdSt,fontWeight:800,color:'#2D8B4E',fontSize:13,cursor:'pointer'}}
                                        onClick={() => setPopup({dayIdx:i, dayKey:d, dayLabel:dayLabels[i]})}>{fmtFR(totalDayView(d), isPerHa ? 2 : 1)}</td>)}
                                    <td style={{...tdSt,fontWeight:800,color:'var(--berry)',fontSize:13,background:'#fce4ec'}}>{fmtFR(days.reduce((s,d) => s + totalDayView(d), 0), isPerHa ? 2 : 1)}</td>
                                </tr>
                                {isPerHa && (
                                    <tr style={{background:'#E3F2FD'}}>
                                        <td style={{...tdLbl,fontWeight:700,color:'#1565C0',fontSize:11}}>
                                            <i className="fa-solid fa-bolt" style={{marginRight:4,fontSize:9}}></i>EC engrais (dS/m)
                                        </td>
                                        {days.map((d,i) => { var ec = dayEC(d); return <td key={i} style={{...tdSt,fontWeight:ec?700:400,color:ec?'#1565C0':'#ddd',fontSize:11}}>{ec ? fmtFR(ec, 2) : '—'}</td>; })}
                                        <td style={{...tdSt,fontWeight:800,color:'#1565C0',background:'#BBDEFB',fontSize:11}}>{weekECavg ? fmtFR(weekECavg, 2) : '—'}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Info compositions catalogue TIMAC */}
                    <div style={{marginTop:12,padding:'10px 16px',background:'#E8F5E9',borderRadius:10,border:'1px solid #A5D6A7',display:'flex',alignItems:'center',gap:10}}>
                        <i className="fa-solid fa-flask-vial" style={{color:'#2D8B4E',fontSize:18}}></i>
                        <div>
                            <div style={{fontWeight:700,fontSize:12,color:'#2D8B4E'}}>Compositions NPK — Catalogue TIMAC AGRO</div>
                            <div style={{fontSize:11,color:'#1B5E20'}}>Tous les produits ont leur composition renseignée. En vue Matières Actives, les apports N, P₂O₅, K₂O, CaO, MgO sont calculés automatiquement.</div>
                        </div>
                    </div>

                    <div style={{marginTop:16,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12}}>
                        <div className="kpi-card" style={{borderLeftColor:'#2D8B4E'}}>
                            <div className="kpi-value">{fmtFR(days.reduce((s,d) => s + totalDay(d), 0))} kg</div>
                            <div className="kpi-label">Total Semaine</div>
                            <div className="kpi-sub">{fmtFR(days.reduce((s,d) => s + totalDay(d), 0) / 6)} kg/jour moy.</div>
                        </div>
                        <div className="kpi-card" style={{borderLeftColor:'#1565C0'}}>
                            <div className="kpi-value">{weekData.ec || '—'}</div>
                            <div className="kpi-label">EC Engrais</div>
                            <div className="kpi-sub">Conductivité électrique</div>
                        </div>
                        <div className="kpi-card" style={{borderLeftColor:'#1B5E20'}}>
                            <div className="kpi-value">{weekData.dce || '—'}</div>
                            <div className="kpi-label">DCE/h d'irrigation</div>
                            <div className="kpi-sub">Débit cible engrais</div>
                        </div>
                        <div className="kpi-card" style={{borderLeftColor:'var(--berry)'}}>
                            <div className="kpi-value">{displayProducts.filter(p => hasProduct(p.key)).length}</div>
                            <div className="kpi-label">{viewMode === 'commercial' ? 'Produits actifs' : 'Matières actives'}</div>
                            <div className="kpi-sub">sur {displayProducts.length} {viewMode === 'commercial' ? 'produits' : 'matières'}</div>
                        </div>
                    </div>

                    <div style={{marginTop:12,fontSize:11,color:'var(--gray-400)',textAlign:'center'}}>
                        {apiSource === 'api'
                            ? <><i className="fa-solid fa-database" style={{color:'#2D8B4E'}}></i> <strong style={{color:'#2D8B4E'}}>Données Firestore</strong> — {weekKeys.length} semaines — {allParcNames.length} parcelles</>
                            : apiStatus === 'loading'
                                ? <><i className="fa-solid fa-spinner fa-spin"></i> Chargement des données...</>
                                : <><i className="fa-solid fa-triangle-exclamation" style={{color:'#E65100'}}></i> <strong style={{color:'#E65100'}}>API non connectée</strong> — Aucune donnée de fertigation. Déployez les Cloud Functions pour connecter Firestore.</>
                        }
                    </div>
                </div>
            );
        }

export { AgroIrrigationTab };
