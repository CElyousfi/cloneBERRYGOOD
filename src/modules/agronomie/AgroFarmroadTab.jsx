/* Module: agronomie | Déclaration(s): AgroFarmroadTab */
import { fetchMeteoblueData } from '../technique/fetchMeteoblueData.jsx';

// ===================== FARMROAD TAB =====================
        function AgroFarmroadTab({ data }) {
            var MEASURE_CONFIG = {
                TEMPERATURE_INSIDE: { label: 'Température', icon: 'fa-temperature-half', unit: '°C', color: '#E53935' },
                RH_INSIDE: { label: 'Humidité relative', icon: 'fa-droplet', unit: '%', color: '#1E88E5' },
                CO2_LEVEL: { label: 'CO₂', icon: 'fa-wind', unit: 'ppm', color: '#7CB342' },
                PAR_INTENSITY: { label: 'Lumière PAR', icon: 'fa-sun', unit: 'µmol/m²/s', color: '#FDD835' },
                RADIATION_INTENSITY_INSIDE: { label: 'Radiation', icon: 'fa-bolt', unit: 'W/m²', color: '#FF8F00' },
                SUBSTRATE_MOISTURE_CONTENT: { label: 'Humidité substrat', icon: 'fa-water', unit: '%', color: '#00ACC1' },
                DEWPOINT_INSIDE: { label: 'Point de rosée', icon: 'fa-temperature-arrow-down', unit: '°C', color: '#5E35B1' },
                ESTIMATED_VPD_INSIDE: { label: 'VPD', icon: 'fa-gauge', unit: 'kPa', color: '#D81B60' },
                BAROMETRIC_PRESSURE_INSIDE: { label: 'Pression', icon: 'fa-compass', unit: 'kPa', color: '#546E7A' }
            };
            var MEASURE_ORDER = ['TEMPERATURE_INSIDE', 'RH_INSIDE', 'CO2_LEVEL', 'PAR_INTENSITY', 'RADIATION_INTENSITY_INSIDE', 'SUBSTRATE_MOISTURE_CONTENT', 'DEWPOINT_INSIDE', 'ESTIMATED_VPD_INSIDE', 'BAROMETRIC_PRESSURE_INSIDE'];

            // Indicateurs agronomiques calculés en backend (cf. computeFarmroadKPIs)
            // thr.good(v) → vert, thr.warn(v) → orange, sinon rouge. Pas de thr → neutre.
            var KPI_FAMILIES = [
                { id: 'lumiere', label: 'Lumière', icon: 'fa-sun', color: '#FDD835', items: [
                    { key: 'dli', label: 'DLI', unit: 'mol/m²/j', dec: 1, tip: 'Daily Light Integral = Σ PAR × 900s / 1e6. Cible fraises ≥17, déficit <12.', thr: { good: function(v){return v>=17;}, warn: function(v){return v>=12;} } },
                    { key: 'radum', label: 'RADUM', unit: 'MJ/m²/j', dec: 1, tip: 'Cumul rayonnement journalier = Σ Rad × 900s / 1e6.' },
                    { key: 'hPARutile', label: 'h PAR>200', unit: 'h', dec: 1, tip: 'Heures avec photosynthèse active (PAR > 200 µmol/m²/s).' },
                    { key: 'hPARsat', label: 'h PAR>800', unit: 'h', dec: 1, tip: 'Heures de saturation lumineuse (gain marginal nul).' },
                ]},
                { id: 'thermique', label: 'Thermique', icon: 'fa-temperature-half', color: '#E53935', items: [
                    { key: 'dif', label: 'DIF', unit: '°C', dec: 1, tip: 'T° moy jour − T° moy nuit. Influe sur élongation et qualité fruit.' },
                    { key: 'tDay', label: 'T° jour', unit: '°C', dec: 1 },
                    { key: 'tNight', label: 'T° nuit', unit: '°C', dec: 1 },
                    { key: 'ampl24', label: 'Amplitude 24h', unit: '°C', dec: 1, tip: 'T°max − T°min du jour.' },
                    { key: 'hStressChaud', label: 'h T°>30', unit: 'h', dec: 1, tip: 'Heures de stress chaud.', thr: { good: function(v){return v===0;}, warn: function(v){return v<=3;} } },
                    { key: 'hStressFroid', label: 'h T°<5', unit: 'h', dec: 1, tip: 'Heures de stress froid.', thr: { good: function(v){return v===0;}, warn: function(v){return v<=2;} } },
                    { key: 'hChill', label: 'h chill <7°C', unit: 'h', dec: 1, tip: 'Cumul vernalisation.' },
                ]},
                { id: 'hydrique', label: 'Hydrique', icon: 'fa-droplet', color: '#1E88E5', items: [
                    { key: 'vpdJour', label: 'VPD jour', unit: 'kPa', dec: 2, tip: 'Cible 0.7-1.2 kPa. <0.4 = condensation, >1.5 = stress.', thr: { good: function(v){return v>=0.7 && v<=1.2;}, warn: function(v){return v>=0.4 && v<=1.5;} } },
                    { key: 'vpdNuit', label: 'VPD nuit', unit: 'kPa', dec: 2 },
                    { key: 'hStressVPDHaut', label: 'h VPD>1.5', unit: 'h', dec: 1, tip: 'Heures de stress hydrique haut.', thr: { good: function(v){return v===0;}, warn: function(v){return v<=2;} } },
                    { key: 'hStressVPDBas', label: 'h VPD<0.4', unit: 'h', dec: 1, tip: 'Heures de risque condensation pendant photopériode.', thr: { good: function(v){return v===0;}, warn: function(v){return v<=2;} } },
                ]},
                { id: 'phyto', label: 'Phyto', icon: 'fa-bug', color: '#8E24AA', items: [
                    { key: 'hMouillage', label: 'h mouillage', unit: 'h', dec: 1, tip: 'Heures où T°−Tdew < 2°C. Proxy risque Botrytis.', thr: { good: function(v){return v<2;}, warn: function(v){return v<6;} } },
                    { key: 'hHRsat', label: 'h HR>90%', unit: 'h', dec: 1, tip: 'Risque mildiou / oïdium.', thr: { good: function(v){return v<2;}, warn: function(v){return v<6;} } },
                    { key: 'indexBotrytis', label: 'Index Botrytis', unit: '/100', dec: 0, tip: 'Score composite: 40% mouillage + 30% T°∈[15-25] + 30% HR>85%.', thr: { good: function(v){return v<30;}, warn: function(v){return v<60;} } },
                ]},
                { id: 'co2etp', label: 'CO₂ & ETP', icon: 'fa-leaf', color: '#43A047', items: [
                    { key: 'co2Jour', label: 'CO₂ jour', unit: 'ppm', dec: 0 },
                    { key: 'co2Nuit', label: 'CO₂ nuit', unit: 'ppm', dec: 0 },
                    { key: 'hCO2sub', label: 'h CO₂<400 (j)', unit: 'h', dec: 1, tip: 'Heures où CO2 < 400 pendant photopériode active. Indique sur-ventilation ou enrichissement insuffisant.' },
                    { key: 'etpCapteur', label: 'ETP capteur', unit: 'mm/j', dec: 2, tip: 'Stanghellini simplifié: (0.288×RADUM + 0.288×VPDjour) / 2.45.' },
                    { key: 'gddJour', label: 'GDD jour', unit: '°Cj', dec: 1, tip: 'Degree-day journalier (base 7°C, plafond 30°C).' },
                    { key: 'ptq', label: 'PTQ', unit: 'mol/°Cj', dec: 2, tip: 'Photothermal Quotient = DLI / GDD_jour. Prédicteur fermeté/sucre.' },
                ]},
            ];

            var kpiColor = function(item, v) {
                if (v == null || !item.thr) return { bg: 'var(--gray-50)', val: 'var(--gray-700)', border: 'var(--gray-100)' };
                if (item.thr.good && item.thr.good(v)) return { bg: '#E8F5E9', val: '#2E7D32', border: '#C8E6C9' };
                if (item.thr.warn && item.thr.warn(v)) return { bg: '#FFF3E0', val: '#E65100', border: '#FFE0B2' };
                return { bg: '#FFEBEE', val: '#C62828', border: '#FFCDD2' };
            };

            var formatKPI = function(v, dec) {
                if (v == null) return '—';
                return dec === 0 ? String(Math.round(v)) : v.toFixed(dec);
            };

            var todayStr = new Date().toISOString().slice(0, 10);
            var _dateState = React.useState(todayStr);
            var selectedDate = _dateState[0], setSelectedDate = _dateState[1];
            var _frState = React.useState(null);
            var frData = _frState[0], setFrData = _frState[1];
            var _loading = React.useState(true);
            var loading = _loading[0], setLoading = _loading[1];
            var _popup = React.useState(null);
            var popup = _popup[0], setPopup = _popup[1];
            var _meteoData = React.useState(null);
            var meteoData = _meteoData[0], setMeteoData = _meteoData[1];

            var fetchData = function(date) {
                console.log('[FarmRoad] fetching date=' + date);
                setLoading(true);
                fetch('/api/farmroad?date=' + date)
                    .then(function(r) { return r.json(); })
                    .then(function(json) {
                        console.log('[FarmRoad] received', json.devices ? json.devices.length : 0, 'devices,', json.totalMeasurements, 'measurements');
                        setFrData(json);
                        setLoading(false);
                    })
                    .catch(function(err) { console.error('[FarmRoad] error', err); setLoading(false); });
            };

            React.useEffect(function() { fetchData(selectedDate); }, [selectedDate]);

            // Fetch ETo from MeteoBlue (F1 — uses shared cache)
            React.useEffect(function() {
                fetchMeteoblueData('F1')
                    .then(function(json) { if (json) setMeteoData(json); })
                    .catch(function(err) { console.warn('[FarmRoad] MeteoBlue error:', err); });
            }, []);

            var shiftDate = function(days) {
                var d = new Date(selectedDate + 'T12:00:00');
                d.setDate(d.getDate() + days);
                var ds = d.toISOString().slice(0, 10);
                if (ds > todayStr) return;
                setSelectedDate(ds);
            };

            var formatVal = function(v, decimals) {
                if (v == null) return '—';
                var dec = decimals != null ? decimals : 1;
                return typeof v === 'number' ? (v % 1 === 0 ? String(v) : v.toFixed(dec)) : v;
            };

            var formatDateLabel = function(ds) {
                if (ds === todayStr) return "Aujourd'hui";
                var yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
                if (ds === yesterday.toISOString().slice(0, 10)) return 'Hier';
                var d = new Date(ds + 'T12:00:00');
                var jours = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
                var mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];
                return jours[d.getDay()] + ' ' + d.getDate() + ' ' + mois[d.getMonth()];
            };

            // ---- ETo & Irrigation helpers ----
            var PUMP_CAPACITY = 90; // m3/hour

            var getSelectedETo = function() {
                if (!meteoData || !meteoData.data_day) return null;
                var dayData = meteoData.data_day;
                if (!dayData.time || !dayData.evapotranspiration) return null;
                var idx = dayData.time.indexOf(selectedDate);
                if (idx === -1) idx = dayData.time.indexOf(todayStr);
                if (idx === -1) return null;
                return Math.round(dayData.evapotranspiration[idx] * 10) / 10;
            };

            var computeIrrigationRec = function(panel, eto) {
                var m = panel.measurements;
                var ts = panel.timeseries || {};
                if (!m) return null;

                // --- Daily aggregates ---
                var temp = m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.avg : null;
                var tempMax = m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.max : null;
                var humidity = m.RH_INSIDE ? m.RH_INSIDE.avg : null;
                var vpd = m.ESTIMATED_VPD_INSIDE ? m.ESTIMATED_VPD_INSIDE.avg : null;
                var substrateMoisture = m.SUBSTRATE_MOISTURE_CONTENT ? m.SUBSTRATE_MOISTURE_CONTENT.last : (m.SUBSTRATE_MOISTURE_CONTENT ? m.SUBSTRATE_MOISTURE_CONTENT.avg : null);
                var substratAvg = m.SUBSTRATE_MOISTURE_CONTENT ? m.SUBSTRATE_MOISTURE_CONTENT.avg : null;
                var substratMin = m.SUBSTRATE_MOISTURE_CONTENT ? m.SUBSTRATE_MOISTURE_CONTENT.min : null;
                var substratMax = m.SUBSTRATE_MOISTURE_CONTENT ? m.SUBSTRATE_MOISTURE_CONTENT.max : null;

                // --- Analyse timeseries substrat ---
                var subTS = ts.SUBSTRATE_MOISTURE_CONTENT || [];
                var vpdTS = ts.ESTIMATED_VPD_INSIDE || [];
                var tempTS = ts.TEMPERATURE_INSIDE || [];

                // Substrat: taux de perte, heures critiques
                var substratTrend = { current: substrateMoisture, min: substratMin, max: substratMax, lossRate: null, criticalHours: [], fastDropHours: [] };
                if (subTS.length >= 8) {
                    // Taux de perte entre 6h (slot 24) et 18h (slot 72)
                    var daySlots = subTS.filter(function(s) { return s.slot >= 24 && s.slot <= 72; });
                    if (daySlots.length >= 4) {
                        var firstVal = daySlots[0].avg;
                        var lastVal = daySlots[daySlots.length - 1].avg;
                        var hoursSpan = (daySlots[daySlots.length - 1].slot - daySlots[0].slot) * 15 / 60;
                        if (hoursSpan > 0) {
                            substratTrend.lossRate = Math.round((firstVal - lastVal) / hoursSpan * 10) / 10;
                        }
                    }
                    // Identifier les heures ou substrat < 45%
                    subTS.forEach(function(s) {
                        if (s.avg < 45 && s.slot >= 20 && s.slot <= 80) {
                            substratTrend.criticalHours.push(s.hour);
                        }
                    });
                    // Identifier les periodes de chute rapide (>3%/h sur 4 slots = 1h)
                    for (var si = 0; si < subTS.length - 4; si++) {
                        var drop = subTS[si].avg - subTS[si + 4].avg;
                        if (drop > 3) {
                            substratTrend.fastDropHours.push({ hour: subTS[si].hour, drop: Math.round(drop * 10) / 10 });
                        }
                    }
                }

                // VPD: pic, heures de stress
                var vpdAnalysis = { peak: null, peakHour: null, stressSlots: 0 };
                if (vpdTS.length > 0) {
                    var maxVpd = 0;
                    vpdTS.forEach(function(s) {
                        if (s.avg > maxVpd) { maxVpd = s.avg; vpdAnalysis.peakHour = s.hour; }
                        if (s.avg > 1.2) vpdAnalysis.stressSlots++;
                    });
                    vpdAnalysis.peak = Math.round(maxVpd * 100) / 100;
                }

                // Temperature: pic, heures chaudes
                var tempAnalysis = { peak: null, peakHour: null, hotSlots28: 0, hotSlots32: 0 };
                if (tempTS.length > 0) {
                    var maxT = -Infinity;
                    tempTS.forEach(function(s) {
                        if (s.max > maxT) { maxT = s.max; tempAnalysis.peakHour = s.hour; }
                        if (s.avg > 28) tempAnalysis.hotSlots28++;
                        if (s.avg > 32) tempAnalysis.hotSlots32++;
                    });
                    tempAnalysis.peak = Math.round(maxT * 10) / 10;
                }

                // --- Kc saisonnier ---
                var month = new Date(selectedDate + 'T12:00:00').getMonth() + 1;
                var kc = 1.0;
                if (month >= 11 || month <= 1) kc = 0.85;
                else if (month >= 2 && month <= 3) kc = 0.95;
                else if (month >= 4 && month <= 6) kc = 1.15;
                var etc = eto != null ? Math.round(eto * kc * 10) / 10 : null;

                // --- Status & recommandations contextuelles ---
                var status = 'Normal'; var statusColor = '#4CAF50';
                var recommendations = [];

                // Analyse substrat
                if (substrateMoisture != null && substrateMoisture < 35) {
                    status = 'Urgent'; statusColor = '#E53935';
                    recommendations.push('Substrat a ' + formatVal(substrateMoisture) + '% (critique). Irriguer immediatement et augmenter le volume.');
                } else if (substrateMoisture != null && substrateMoisture < 45) {
                    if (status !== 'Urgent') { status = 'Attention'; statusColor = '#FF8F00'; }
                    recommendations.push('Substrat bas a ' + formatVal(substrateMoisture) + '%. Prevoir une irrigation supplementaire.');
                } else if (substrateMoisture != null && substrateMoisture > 75) {
                    recommendations.push('Substrat eleve (' + formatVal(substrateMoisture) + '%). Reduire le volume ou espacer les irrigations pour eviter l\'asphyxie racinaire.');
                } else if (substrateMoisture != null) {
                    recommendations.push('Substrat a ' + formatVal(substrateMoisture) + '% \u2014 zone optimale (45-75%).');
                }

                // Analyse tendance substrat
                if (substratTrend.lossRate != null && substratTrend.lossRate > 5) {
                    recommendations.push('Dessechement rapide: le substrat perd ' + substratTrend.lossRate + '%/h en journee. Rapprocher les irrigations entre 10h-14h.');
                } else if (substratTrend.lossRate != null && substratTrend.lossRate > 2) {
                    recommendations.push('Dessechement modere (' + substratTrend.lossRate + '%/h). Maintenir la frequence actuelle.');
                } else if (substratTrend.lossRate != null && substratTrend.lossRate <= 0) {
                    recommendations.push('Substrat stable ou en hausse \u2014 bon drainage et retention.');
                }

                // Chutes rapides
                if (substratTrend.fastDropHours.length > 0) {
                    var worst = substratTrend.fastDropHours.reduce(function(a, b) { return b.drop > a.drop ? b : a; });
                    recommendations.push('Chute rapide detectee a ' + worst.hour + ' (-' + worst.drop + '%/h). Ajouter une irrigation 30 min avant.');
                }

                // Analyse VPD
                if (vpdAnalysis.peak != null && vpdAnalysis.peak > 2.0) {
                    if (status !== 'Urgent') { status = 'Attention'; statusColor = '#FF8F00'; }
                    recommendations.push('VPD tres eleve (' + vpdAnalysis.peak + ' kPa a ' + vpdAnalysis.peakHour + '). Stress hydrique important \u2014 irriguer 1h avant le pic.');
                } else if (vpdAnalysis.peak != null && vpdAnalysis.peak > 1.2) {
                    recommendations.push('VPD modere (pic ' + vpdAnalysis.peak + ' kPa a ' + vpdAnalysis.peakHour + '). Surveiller le substrat a cette heure.');
                }
                if (vpdAnalysis.stressSlots > 12) {
                    recommendations.push(Math.round(vpdAnalysis.stressSlots * 15 / 60) + 'h de stress hydrique (VPD > 1.2 kPa). Augmenter la frequence d\'irrigation.');
                }

                // Analyse temperature
                if (tempAnalysis.hotSlots32 > 0) {
                    if (status !== 'Urgent') { status = 'Attention'; statusColor = '#FF8F00'; }
                    recommendations.push('Temperature >32\u00B0C pendant ' + Math.round(tempAnalysis.hotSlots32 * 15 / 60 * 10) / 10 + 'h (pic ' + tempAnalysis.peak + '\u00B0C a ' + tempAnalysis.peakHour + '). Irrigations courtes et frequentes pour refroidir.');
                } else if (tempAnalysis.hotSlots28 > 8) {
                    recommendations.push('Temperature >28\u00B0C pendant ' + Math.round(tempAnalysis.hotSlots28 * 15 / 60 * 10) / 10 + 'h. Ventilation et irrigation a surveiller.');
                }

                // --- Volume adaptatif ---
                var baseVolume = etc != null ? etc : 4.0;
                if (eto != null && eto > 5) baseVolume *= 1.2;
                if (substratTrend.lossRate != null && substratTrend.lossRate > 5) baseVolume *= 1.2;
                if (substrateMoisture != null && substrateMoisture < 40) baseVolume *= 1.3;
                if (substrateMoisture != null && substrateMoisture > 70) baseVolume *= 0.85;
                if (vpdAnalysis.peak != null && vpdAnalysis.peak > 2.0) baseVolume *= 1.15;
                if (humidity != null && humidity < 50) baseVolume *= 1.1;
                baseVolume = Math.round(baseVolume * 10) / 10;

                // --- Programme dynamique ---
                var irrigSlots = [];
                // 1) Recharge matinale (toujours)
                irrigSlots.push({ heure: '06:00', raison: 'Recharge matinale' });

                // 2) Pre-pic VPD: 1h avant le pic
                if (vpdAnalysis.peakHour) {
                    var peakParts = vpdAnalysis.peakHour.split(':');
                    var peakH = parseInt(peakParts[0]);
                    var preH = Math.max(8, peakH - 1);
                    var preHeure = (preH < 10 ? '0' : '') + preH + ':00';
                    if (preHeure !== '06:00') {
                        irrigSlots.push({ heure: preHeure, raison: 'Pre-pic VPD (' + vpdAnalysis.peakHour + ')' });
                    }
                }

                // 3) Pendant chute rapide substrat
                if (substratTrend.fastDropHours.length > 0) {
                    var worstDrop = substratTrend.fastDropHours.reduce(function(a, b) { return b.drop > a.drop ? b : a; });
                    var dropParts = worstDrop.hour.split(':');
                    var dropH = parseInt(dropParts[0]);
                    if (dropH >= 8 && dropH <= 16) {
                        var dropHeure = (dropH < 10 ? '0' : '') + dropH + ':30';
                        irrigSlots.push({ heure: dropHeure, raison: 'Chute substrat (-' + worstDrop.drop + '%/h)' });
                    }
                }

                // 4) Mi-journee si pas de slot entre 11h-13h
                var hasMidDay = irrigSlots.some(function(s) { var h = parseInt(s.heure.split(':')[0]); return h >= 11 && h <= 13; });
                if (!hasMidDay) {
                    irrigSlots.push({ heure: '11:30', raison: 'Equilibre mi-journee' });
                }

                // 5) Apres-midi si stress
                if (tempAnalysis.hotSlots28 > 4 || (vpdAnalysis.peak && vpdAnalysis.peak > 1.5)) {
                    var hasAfternoon = irrigSlots.some(function(s) { var h = parseInt(s.heure.split(':')[0]); return h >= 14 && h <= 15; });
                    if (!hasAfternoon) {
                        irrigSlots.push({ heure: '14:30', raison: 'Refroidissement apres-midi' });
                    }
                }

                // 6) Recharge fin de journee
                irrigSlots.push({ heure: '16:30', raison: 'Recharge pre-nuit' });

                // 7) Extra si substrat critique
                if (substrateMoisture != null && substrateMoisture < 35) {
                    irrigSlots.push({ heure: '09:00', raison: 'Urgence substrat bas' });
                    irrigSlots.push({ heure: '13:00', raison: 'Urgence substrat bas' });
                }

                // Dedupliquer et trier
                var seen = {};
                irrigSlots = irrigSlots.filter(function(s) {
                    var key = s.heure;
                    if (seen[key]) return false;
                    seen[key] = true;
                    return true;
                });
                irrigSlots.sort(function(a, b) { return a.heure.localeCompare(b.heure); });

                var numIrr = irrigSlots.length;
                var volPerSession = Math.round((baseVolume / numIrr) * 100) / 100;

                var areaHa = 0.5;
                var volumeM3 = Math.round(volPerSession * areaHa * 10 * 100) / 100;
                var durationMin = Math.max(2, Math.round(volumeM3 / PUMP_CAPACITY * 60));

                var programme = irrigSlots.map(function(s) {
                    return { heure: s.heure, raison: s.raison, duree: durationMin + ' min', volume: formatVal(volPerSession) + ' mm', volumeM3: formatVal(volumeM3) + ' m\u00B3' };
                });

                var totalM3 = Math.round(volumeM3 * numIrr * 10) / 10;

                return {
                    etc: etc, eto: eto, kc: kc,
                    substrateMoisture: substrateMoisture, substratAvg: substratAvg, substratMin: substratMin, substratMax: substratMax,
                    vpd: vpd, temp: temp, tempMax: tempMax, humidity: humidity,
                    substratTrend: substratTrend, vpdAnalysis: vpdAnalysis, tempAnalysis: tempAnalysis,
                    substratTimeseries: subTS,
                    status: status, statusColor: statusColor, recommendations: recommendations,
                    totalVolume: baseVolume, totalM3: totalM3,
                    numIrr: numIrr, volPerSession: volPerSession, volumeM3: volumeM3, durationMin: durationMin,
                    programme: programme
                };
            };

            // SVG Chart component (used for sparklines and popup)
            var ChartSVG = function(props) {
                var points = props.points || [];
                var color = props.color || 'var(--berry)';
                var width = props.width || 180;
                var height = props.height || 50;
                var showLabels = props.showLabels !== false;
                var showTooltips = props.showTooltips || false;
                var unit = props.unit || '';
                if (points.length < 2) return React.createElement('div', { style: { textAlign: 'center', color: '#ccc', fontSize: 12, padding: 10 } }, 'Pas assez de données');

                var vals = points.map(function(p) { return p.avg; });
                var allVals = points.reduce(function(a, p) { a.push(p.min, p.max); return a; }, []);
                var minV = Math.min.apply(null, allVals);
                var maxV = Math.max.apply(null, allVals);
                var range = maxV - minV || 1;
                var padX = showTooltips ? 35 : 2;
                var padTop = 4;
                var padBot = showLabels ? 18 : 4;
                var chartW = width - 2 * padX;
                var chartH = height - padTop - padBot;

                var getX = function(i) { return padX + (i / (points.length - 1)) * chartW; };
                var getY = function(v) { return padTop + chartH - ((v - minV) / range) * chartH; };

                var avgPath = points.map(function(p, i) { return (i === 0 ? 'M' : 'L') + getX(i).toFixed(1) + ',' + getY(p.avg).toFixed(1); }).join(' ');
                var bandPath = points.map(function(p, i) { return (i === 0 ? 'M' : 'L') + getX(i).toFixed(1) + ',' + getY(p.max).toFixed(1); }).join(' ')
                    + ' ' + points.slice().reverse().map(function(p, i) { return 'L' + getX(points.length - 1 - i).toFixed(1) + ',' + getY(p.min).toFixed(1); }).join(' ') + ' Z';

                var elements = [
                    React.createElement('path', { key: 'band', d: bandPath, fill: color, opacity: 0.1 }),
                    React.createElement('path', { key: 'avg', d: avgPath, fill: 'none', stroke: color, strokeWidth: showTooltips ? 2.5 : 2, strokeLinecap: 'round', strokeLinejoin: 'round' })
                ];

                // Grid lines + Y labels for large chart
                if (showTooltips) {
                    var steps = 4;
                    for (var s = 0; s <= steps; s++) {
                        var yVal = minV + (s / steps) * range;
                        var yPos = getY(yVal);
                        elements.push(React.createElement('line', { key: 'grid' + s, x1: padX, x2: width - padX, y1: yPos, y2: yPos, stroke: '#eee', strokeWidth: 1 }));
                        elements.push(React.createElement('text', { key: 'ylabel' + s, x: padX - 4, y: yPos + 3, textAnchor: 'end', fontSize: 10, fill: '#999' }, formatVal(yVal)));
                    }
                }

                // Time labels (15-min slots)
                if (showLabels) {
                    points.forEach(function(p, i) {
                        // Show label every hour (every 4 slots) for large chart, every 2h for small
                        var interval = showTooltips ? 4 : 8;
                        var slot = p.slot !== undefined ? p.slot : i;
                        if (slot % interval === 0) {
                            var label = typeof p.hour === 'string' ? p.hour : (p.hour + 'h');
                            elements.push(React.createElement('text', { key: 'h' + i, x: getX(i), y: height - 2, textAnchor: 'middle', fontSize: showTooltips ? 10 : 8, fill: '#999' }, label));
                        }
                    });
                }

                // Data points for large chart
                if (showTooltips) {
                    points.forEach(function(p, i) {
                        elements.push(React.createElement('circle', { key: 'dot' + i, cx: getX(i), cy: getY(p.avg), r: 3.5, fill: color, stroke: '#fff', strokeWidth: 1.5 }));
                        var tipLabel = typeof p.hour === 'string' ? p.hour : (p.hour + 'h');
                        elements.push(React.createElement('title', { key: 'tip' + i }, tipLabel + ': ' + formatVal(p.avg) + unit + ' (min ' + formatVal(p.min) + ', max ' + formatVal(p.max) + ')'));
                    });
                } else {
                    // Just last dot
                    var lastP = points[points.length - 1];
                    elements.push(React.createElement('circle', { key: 'lastdot', cx: getX(points.length - 1), cy: getY(lastP.avg), r: 3, fill: color }));
                }

                return React.createElement('svg', { width: width, height: height, style: { display: 'block' } }, elements);
            };

            // Loading state
            if (!frData && loading) {
                return React.createElement('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 } },
                    React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 32, color: 'var(--berry)' } })
                );
            }

            // Build panels from devices array
            var devices = (frData && frData.devices) || [];
            var farmName = (frData && frData.farms && frData.farms[0]) ? frData.farms[0].name.trim() : '';
            console.log('[FarmRoad] render: devices=' + devices.length + ', loading=' + loading);

            var panels = devices.map(function(dev) {
                var types = Object.keys(dev.measurements || {}).filter(function(t) { return t !== 'BATTERY_VOLTAGE'; });
                var orderedTypes = MEASURE_ORDER.filter(function(t) { return types.indexOf(t) >= 0; });
                types.forEach(function(t) { if (orderedTypes.indexOf(t) === -1) orderedTypes.push(t); });
                if (orderedTypes.length === 0) return null;

                var co2Avg = (dev.measurements && dev.measurements.CO2_LEVEL) ? dev.measurements.CO2_LEVEL.avg : 0;
                return { deviceId: dev.deviceId, co2Avg: co2Avg, measurements: dev.measurements, timeseries: dev.timeseries || {}, orderedTypes: orderedTypes, kpis: dev.kpis || null };
            }).filter(Boolean);

            // Trier par CO2 decroissant: le plus eleve = Canarienne, l'autre = Tunnel
            panels.sort(function(a, b) { return (b.co2Avg || 0) - (a.co2Avg || 0); });
            panels.forEach(function(p, i) {
                if (i === 0) { p.name = 'Canarienne'; p.icon = 'fa-cloud-sun'; }
                else { p.name = 'Tunnel'; p.icon = 'fa-seedling'; }
            });

            var isToday = selectedDate === todayStr;
            var canGoForward = (function() { var d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) <= todayStr; })();

            return React.createElement('div', null,
                // Popup modal
                popup && React.createElement('div', {
                    onClick: function(e) { if (e.target === e.currentTarget) setPopup(null); },
                    style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }
                },
                    React.createElement('div', { style: { background: '#fff', borderRadius: 16, padding: 24, maxWidth: 700, width: '100%', maxHeight: '90vh', overflow: 'auto', position: 'relative' } },
                        // Close button
                        React.createElement('button', {
                            onClick: function() { setPopup(null); },
                            style: { position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--gray-400)' }
                        }, React.createElement('i', { className: 'fa-solid fa-xmark' })),
                        // Title
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 } },
                            React.createElement('i', { className: 'fa-solid ' + popup.cfg.icon, style: { color: popup.cfg.color, fontSize: 20 } }),
                            React.createElement('h3', { style: { margin: 0, fontSize: 18, color: 'var(--gray-800)' } }, popup.cfg.label),
                            React.createElement('span', { style: { fontSize: 13, color: 'var(--gray-400)' } }, '— ' + popup.deviceName)
                        ),
                        React.createElement('div', { style: { fontSize: 13, color: 'var(--gray-400)', marginBottom: 16 } }, formatDateLabel(selectedDate) + ' (' + selectedDate + ')'),
                        // Big value
                        React.createElement('div', { style: { display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' } },
                            React.createElement('div', null,
                                React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)', marginBottom: 2 } }, 'Dernière valeur'),
                                React.createElement('div', { style: { fontSize: 36, fontWeight: 700, color: popup.cfg.color } }, formatVal(popup.mData.last), React.createElement('span', { style: { fontSize: 16, fontWeight: 400, marginLeft: 4 } }, popup.mData.unit || popup.cfg.unit))
                            ),
                            React.createElement('div', null,
                                React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)', marginBottom: 2 } }, 'Moyenne'),
                                React.createElement('div', { style: { fontSize: 24, fontWeight: 600, color: 'var(--gray-600)' } }, formatVal(popup.mData.avg))
                            ),
                            React.createElement('div', null,
                                React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)', marginBottom: 2 } }, 'Min / Max'),
                                React.createElement('div', { style: { fontSize: 24, fontWeight: 600, color: 'var(--gray-600)' } }, formatVal(popup.mData.min), ' / ', formatVal(popup.mData.max))
                            )
                        ),
                        // Large chart
                        React.createElement('div', { style: { background: 'var(--gray-50)', borderRadius: 12, padding: 16 } },
                            React.createElement(ChartSVG, { points: popup.tsData, color: popup.cfg.color, width: 620, height: 250, showLabels: true, showTooltips: true, unit: popup.mData.unit || popup.cfg.unit })
                        ),
                        // Hourly table
                        popup.tsData && popup.tsData.length > 0 && React.createElement('div', { style: { marginTop: 16 } },
                            React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 8 } }, 'Détail horaire'),
                            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 4, fontSize: 11 } },
                                popup.tsData.map(function(pt) {
                                    return React.createElement('div', { key: pt.hour, style: { background: '#fff', borderRadius: 6, padding: '4px 8px', border: '1px solid var(--gray-100)', textAlign: 'center' } },
                                        React.createElement('div', { style: { fontWeight: 700, color: popup.cfg.color } }, typeof pt.hour === 'string' ? pt.hour : (pt.hour + 'h')),
                                        React.createElement('div', { style: { color: 'var(--gray-600)' } }, formatVal(pt.avg)),
                                        React.createElement('div', { style: { color: 'var(--gray-400)', fontSize: 9 } }, formatVal(pt.min) + ' — ' + formatVal(pt.max))
                                    );
                                })
                            )
                        )
                    )
                ),

                // Header
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 } },
                    React.createElement('h2', { style: { margin: 0, fontSize: 20, color: 'var(--gray-800)' } },
                        React.createElement('i', { className: 'fa-solid fa-tower-broadcast', style: { marginRight: 8, color: 'var(--berry)' } }),
                        'FarmRoad — Capteurs'
                    ),
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                        frData && frData.totalMeasurements > 0 && React.createElement('span', { style: { fontSize: 11, color: 'var(--gray-400)', background: 'var(--gray-50)', padding: '3px 8px', borderRadius: 6 } },
                            frData.totalMeasurements, ' mesures'
                        ),
                        React.createElement('button', {
                            onClick: function() { fetchData(selectedDate); },
                            disabled: loading,
                            style: { background: 'var(--berry)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, opacity: loading ? 0.7 : 1 }
                        },
                            React.createElement('i', { className: 'fa-solid fa-arrows-rotate' + (loading ? ' fa-spin' : '') }),
                            'Rafraîchir'
                        )
                    )
                ),

                // Date navigation
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' } },
                    React.createElement('button', {
                        onClick: function() { shiftDate(-1); },
                        style: { background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 14 }
                    }, React.createElement('i', { className: 'fa-solid fa-chevron-left' })),
                    React.createElement('div', { style: { textAlign: 'center', minWidth: 140 } },
                        React.createElement('div', { style: { fontSize: 16, fontWeight: 700, color: 'var(--gray-800)' } }, formatDateLabel(selectedDate)),
                        React.createElement('div', { style: { fontSize: 12, color: 'var(--gray-400)' } }, selectedDate)
                    ),
                    React.createElement('button', {
                        onClick: function() { shiftDate(1); },
                        disabled: !canGoForward,
                        style: { background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 12px', cursor: !canGoForward ? 'default' : 'pointer', fontSize: 14, opacity: !canGoForward ? 0.3 : 1 }
                    }, React.createElement('i', { className: 'fa-solid fa-chevron-right' })),
                    !isToday && React.createElement('button', {
                        onClick: function() { setSelectedDate(todayStr); },
                        style: { background: 'var(--berry)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 12, marginLeft: 8 }
                    }, "Aujourd'hui"),
                    loading && React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { color: 'var(--berry)', marginLeft: 8 } })
                ),

                // No data
                panels.length === 0 && !loading && React.createElement('div', { className: 'panel', style: { textAlign: 'center', padding: 40, color: 'var(--gray-400)' } },
                    React.createElement('i', { className: 'fa-solid fa-satellite-dish', style: { fontSize: 40, marginBottom: 12, display: 'block' } }),
                    React.createElement('p', null, 'Aucune mesure disponible pour ', formatDateLabel(selectedDate))
                ),

                // Device panels
                panels.map(function(p) {
                    return React.createElement('div', { key: p.deviceId, className: 'panel', style: { marginBottom: 16, overflow: 'hidden' } },
                        React.createElement('div', { style: { padding: '14px 18px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 10 } },
                            React.createElement('i', { className: 'fa-solid ' + p.icon, style: { color: 'var(--berry)', fontSize: 16 } }),
                            React.createElement('h3', { style: { margin: 0, fontSize: 16, color: 'var(--gray-800)' } }, p.name),
                            React.createElement('span', { style: { fontSize: 11, color: 'var(--gray-400)', marginLeft: 'auto' } }, farmName)
                        ),
                        // ----- Indicateurs agronomiques (KPIs) -----
                        p.kpis && React.createElement('div', { style: { padding: '14px 16px 4px', background: 'linear-gradient(180deg, #FAFBFC 0%, #fff 100%)', borderBottom: '1px solid var(--gray-100)' } },
                            React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 } },
                                React.createElement('i', { className: 'fa-solid fa-chart-simple', style: { fontSize: 11 } }),
                                'Indicateurs agronomiques'
                            ),
                            KPI_FAMILIES.map(function(fam) {
                                return React.createElement('div', { key: fam.id, style: { marginBottom: 10 } },
                                    React.createElement('div', { style: { fontSize: 11, fontWeight: 600, color: fam.color, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 } },
                                        React.createElement('i', { className: 'fa-solid ' + fam.icon, style: { fontSize: 11 } }),
                                        fam.label
                                    ),
                                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 } },
                                        fam.items.map(function(it) {
                                            var v = p.kpis[it.key];
                                            var c = kpiColor(it, v);
                                            return React.createElement('div', {
                                                key: it.key,
                                                title: (it.tip || it.label) + (v != null ? '\nValeur: ' + formatKPI(v, it.dec) + ' ' + it.unit : ''),
                                                style: { background: c.bg, border: '1px solid ' + c.border, borderRadius: 8, padding: '6px 8px', cursor: 'help' }
                                            },
                                                React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-500)', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, it.label),
                                                React.createElement('div', { style: { fontSize: 16, fontWeight: 700, color: c.val, lineHeight: 1.1 } },
                                                    formatKPI(v, it.dec),
                                                    React.createElement('span', { style: { fontSize: 9, fontWeight: 400, color: 'var(--gray-400)', marginLeft: 3 } }, it.unit)
                                                )
                                            );
                                        })
                                    )
                                );
                            })
                        ),
                        React.createElement('div', { style: { padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 } },
                            p.orderedTypes.map(function(mType) {
                                var cfg = MEASURE_CONFIG[mType] || { label: mType, icon: 'fa-chart-line', unit: '', color: '#888' };
                                var mData = p.measurements[mType];
                                var tsData = p.timeseries[mType];
                                if (!mData) return null;

                                var chartColor = cfg.color || 'var(--berry)';
                                return React.createElement('div', {
                                    key: mType,
                                    onClick: function() { setPopup({ cfg: cfg, mData: mData, tsData: tsData || [], deviceName: p.name }); },
                                    style: { background: 'var(--gray-50)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--gray-100)', position: 'relative', overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow .2s' },
                                    onMouseEnter: function(e) { e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.1)'; },
                                    onMouseLeave: function(e) { e.currentTarget.style.boxShadow = 'none'; }
                                },
                                    React.createElement('div', { style: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: chartColor } }),
                                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
                                        React.createElement('i', { className: 'fa-solid ' + cfg.icon, style: { color: chartColor, fontSize: 14 } }),
                                        React.createElement('span', { style: { fontSize: 12, color: 'var(--gray-500)', fontWeight: 600 } }, cfg.label),
                                        React.createElement('i', { className: 'fa-solid fa-expand', style: { marginLeft: 'auto', fontSize: 10, color: 'var(--gray-300)' } })
                                    ),
                                    React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' } },
                                        React.createElement('div', { style: { fontSize: 28, fontWeight: 700, color: chartColor, lineHeight: 1.1 } },
                                            formatVal(mData.last),
                                            React.createElement('span', { style: { fontSize: 13, fontWeight: 400, marginLeft: 4, color: 'var(--gray-400)' } }, mData.unit || cfg.unit)
                                        ),
                                        React.createElement('div', { style: { textAlign: 'right', fontSize: 11, color: 'var(--gray-400)', lineHeight: 1.6 } },
                                            React.createElement('div', null, '↓ ', formatVal(mData.min), '  ↑ ', formatVal(mData.max)),
                                            React.createElement('div', null, '⌀ ', formatVal(mData.avg))
                                        )
                                    ),
                                    tsData && tsData.length >= 2 && React.createElement(ChartSVG, { points: tsData, color: chartColor, width: 200, height: 45, showLabels: true })
                                );
                            })
                        )
                    );
                }),

                // ===================== IRRIGATION RECOMMENDATIONS =====================
                panels.length > 0 && React.createElement('div', { style: { marginTop: 24 } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 } },
                        React.createElement('i', { className: 'fa-solid fa-faucet-drip', style: { color: 'var(--berry)', fontSize: 18 } }),
                        React.createElement('h2', { style: { margin: 0, fontSize: 20, color: 'var(--gray-800)' } }, 'Recommandations Irrigation \u2014 Stationnaire'),
                        React.createElement('span', { style: { fontSize: 11, color: 'var(--gray-400)', background: 'var(--gray-50)', padding: '3px 8px', borderRadius: 6, marginLeft: 'auto' } }, 'Pompe: ' + PUMP_CAPACITY + ' m\u00B3/h | Serre: 0.5 ha')
                    ),

                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 } },
                        panels.map(function(p) {
                            var eto = getSelectedETo();
                            var rec = computeIrrigationRec(p, eto);
                            if (!rec) return null;

                            return React.createElement('div', { key: 'irr-' + p.deviceId, className: 'panel', style: { overflow: 'hidden' } },
                                // Header avec status
                                React.createElement('div', { style: { padding: '14px 18px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 10 } },
                                    React.createElement('i', { className: 'fa-solid fa-droplet', style: { color: 'var(--berry)', fontSize: 16 } }),
                                    React.createElement('h3', { style: { margin: 0, fontSize: 16, color: 'var(--gray-800)' } }, p.name),
                                    React.createElement('span', { style: { marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: rec.statusColor + '18', color: rec.statusColor } }, rec.status)
                                ),
                                React.createElement('div', { style: { padding: 16 } },
                                    // Metriques cles
                                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 } },
                                        React.createElement('div', { style: { background: 'var(--gray-50)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' } },
                                            React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-400)', marginBottom: 2 } }, 'Substrat actuel'),
                                            React.createElement('div', { style: { fontSize: 20, fontWeight: 700, color: rec.substrateMoisture != null && rec.substrateMoisture < 45 ? '#E53935' : (rec.substrateMoisture > 75 ? '#FF8F00' : '#00ACC1') } },
                                                rec.substrateMoisture != null ? formatVal(rec.substrateMoisture) : '\u2014',
                                                React.createElement('span', { style: { fontSize: 10, fontWeight: 400 } }, ' %')
                                            ),
                                            React.createElement('div', { style: { fontSize: 9, color: 'var(--gray-400)' } },
                                                rec.substratMin != null ? formatVal(rec.substratMin) + '-' + formatVal(rec.substratMax) + '%' : ''
                                            )
                                        ),
                                        React.createElement('div', { style: { background: 'var(--gray-50)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' } },
                                            React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-400)', marginBottom: 2 } }, 'Perte substrat'),
                                            React.createElement('div', { style: { fontSize: 20, fontWeight: 700, color: rec.substratTrend.lossRate != null && rec.substratTrend.lossRate > 5 ? '#E53935' : (rec.substratTrend.lossRate > 2 ? '#FF8F00' : '#4CAF50') } },
                                                rec.substratTrend.lossRate != null ? rec.substratTrend.lossRate : '\u2014',
                                                React.createElement('span', { style: { fontSize: 10, fontWeight: 400 } }, ' %/h')
                                            ),
                                            React.createElement('div', { style: { fontSize: 9, color: 'var(--gray-400)' } }, '6h-18h')
                                        ),
                                        React.createElement('div', { style: { background: 'var(--gray-50)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' } },
                                            React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-400)', marginBottom: 2 } }, 'VPD pic'),
                                            React.createElement('div', { style: { fontSize: 20, fontWeight: 700, color: rec.vpdAnalysis.peak != null && rec.vpdAnalysis.peak > 1.5 ? '#FF8F00' : '#D81B60' } },
                                                rec.vpdAnalysis.peak != null ? rec.vpdAnalysis.peak : '\u2014',
                                                React.createElement('span', { style: { fontSize: 10, fontWeight: 400 } }, ' kPa')
                                            ),
                                            React.createElement('div', { style: { fontSize: 9, color: 'var(--gray-400)' } },
                                                rec.vpdAnalysis.peakHour ? 'a ' + rec.vpdAnalysis.peakHour : ''
                                            )
                                        ),
                                        React.createElement('div', { style: { background: 'var(--gray-50)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' } },
                                            React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-400)', marginBottom: 2 } }, 'ETc'),
                                            React.createElement('div', { style: { fontSize: 20, fontWeight: 700, color: '#1E88E5' } },
                                                rec.etc != null ? rec.etc : '\u2014',
                                                React.createElement('span', { style: { fontSize: 10, fontWeight: 400 } }, ' mm/j')
                                            ),
                                            React.createElement('div', { style: { fontSize: 9, color: 'var(--gray-400)' } }, 'Kc=' + rec.kc)
                                        )
                                    ),

                                    // Graphique evolution substrat
                                    rec.substratTimeseries && rec.substratTimeseries.length >= 2 && React.createElement('div', { style: { marginBottom: 12, background: 'var(--gray-50)', borderRadius: 10, padding: '10px 12px' } },
                                        React.createElement('div', { style: { fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 6 } },
                                            React.createElement('i', { className: 'fa-solid fa-water', style: { marginRight: 4, color: '#00ACC1' } }),
                                            'Evolution substrat (pot framboise)'
                                        ),
                                        React.createElement(ChartSVG, { points: rec.substratTimeseries, color: '#00ACC1', width: 340, height: 60, showLabels: true })
                                    ),

                                    // Recommandations contextuelles
                                    rec.recommendations.length > 0 && React.createElement('div', { style: { marginBottom: 14, padding: '10px 14px', background: '#FFF8E1', borderRadius: 10, border: '1px solid #FFE082' } },
                                        React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color: '#F57F17', marginBottom: 6 } },
                                            React.createElement('i', { className: 'fa-solid fa-lightbulb', style: { marginRight: 4 } }),
                                            'Analyse agronomique'
                                        ),
                                        rec.recommendations.map(function(txt, i) {
                                            return React.createElement('div', { key: i, style: { fontSize: 12, color: '#5D4037', marginBottom: 3, paddingLeft: 12, borderLeft: '2px solid #FFE082', lineHeight: 1.5 } }, txt);
                                        })
                                    ),

                                    // Barre resume
                                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 14, padding: '10px 14px', background: 'var(--berry)', borderRadius: 10, color: '#fff' } },
                                        React.createElement('div', { style: { textAlign: 'center' } },
                                            React.createElement('div', { style: { fontSize: 9, opacity: 0.8 } }, 'Volume/jour'),
                                            React.createElement('div', { style: { fontSize: 16, fontWeight: 700 } }, rec.totalVolume + ' mm'),
                                            React.createElement('div', { style: { fontSize: 10, opacity: 0.7 } }, rec.totalM3 + ' m\u00B3')
                                        ),
                                        React.createElement('div', { style: { textAlign: 'center' } },
                                            React.createElement('div', { style: { fontSize: 9, opacity: 0.8 } }, 'Irrigations'),
                                            React.createElement('div', { style: { fontSize: 16, fontWeight: 700 } }, rec.numIrr + 'x/jour')
                                        ),
                                        React.createElement('div', { style: { textAlign: 'center' } },
                                            React.createElement('div', { style: { fontSize: 9, opacity: 0.8 } }, 'Duree/session'),
                                            React.createElement('div', { style: { fontSize: 16, fontWeight: 700 } }, rec.durationMin + ' min')
                                        ),
                                        React.createElement('div', { style: { textAlign: 'center' } },
                                            React.createElement('div', { style: { fontSize: 9, opacity: 0.8 } }, 'ETo'),
                                            React.createElement('div', { style: { fontSize: 16, fontWeight: 700 } }, rec.eto != null ? rec.eto + ' mm' : '\u2014')
                                        )
                                    ),

                                    // Programme dynamique
                                    React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 8 } }, 'Programme recommande'),
                                    React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
                                        React.createElement('thead', null,
                                            React.createElement('tr', { style: { borderBottom: '2px solid var(--gray-200)' } },
                                                React.createElement('th', { style: { textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600, fontSize: 11 } }, 'Heure'),
                                                React.createElement('th', { style: { textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600, fontSize: 11 } }, 'Raison'),
                                                React.createElement('th', { style: { textAlign: 'center', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600, fontSize: 11 } }, 'Duree'),
                                                React.createElement('th', { style: { textAlign: 'right', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600, fontSize: 11 } }, 'Vol.')
                                            )
                                        ),
                                        React.createElement('tbody', null,
                                            rec.programme.map(function(row, i) {
                                                return React.createElement('tr', { key: i, style: { borderBottom: '1px solid var(--gray-100)' } },
                                                    React.createElement('td', { style: { padding: '6px 8px', fontWeight: 600, color: 'var(--gray-700)' } },
                                                        React.createElement('i', { className: 'fa-solid fa-clock', style: { marginRight: 4, color: 'var(--berry)', fontSize: 10 } }),
                                                        row.heure
                                                    ),
                                                    React.createElement('td', { style: { padding: '6px 8px', color: 'var(--gray-500)', fontSize: 11 } }, row.raison),
                                                    React.createElement('td', { style: { padding: '6px 8px', textAlign: 'center', color: 'var(--gray-600)' } }, row.duree),
                                                    React.createElement('td', { style: { padding: '6px 8px', textAlign: 'right', color: 'var(--gray-600)' } }, row.volumeM3)
                                                );
                                            })
                                        )
                                    ),

                                    // Note si ETo indisponible
                                    rec.eto == null && React.createElement('div', { style: { marginTop: 8, fontSize: 11, color: 'var(--gray-400)', fontStyle: 'italic' } },
                                        'ETo non disponible pour cette date. Estimation basee sur valeurs saisonnieres (4 mm/j).'
                                    )
                                )
                            );
                        })
                    )
                )
            );
        }

export { AgroFarmroadTab };
