/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: technique | Déclaration(s): MeteoPrevisionExterieure */
import { Panel } from '../shared/Panel.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { fetchOpenMeteoHourly } from './fetchOpenMeteoHourly.jsx';

import * as MeteoCalc from '../shared/lib/meteoCalc.js';
// ===================== PREVISION EXTERIEURE (24h chart, J-1/J/J+1) =====================
        function MeteoPrevisionExterieure({ ferme, fermeInfo, meteoResult }) {
            const [day, setDay] = useState('today'); // 'yesterday' | 'today' | 'tomorrow'
            const [yesterdayHours, setYesterdayHours] = useState(null);
            const [yesterdayLoading, setYesterdayLoading] = useState(false);
            const MC = (typeof window !== 'undefined' && MeteoCalc) ? MeteoCalc : null;

            // Build dateISO list from meteoResult.previsions, find index of today.
            const previsions = meteoResult.previsions || [];
            const horaire24 = meteoResult.horaire24ParJour || {};
            const todayIdx = previsions.findIndex(function(p){ return p.isToday; });
            const idxOf = { yesterday: todayIdx - 1, today: todayIdx, tomorrow: todayIdx + 1 };
            const targetIdx = idxOf[day];

            // Yesterday's dateISO = today's dateISO - 1 day. Computed even when targetIdx === -1
            // (Meteoblue does not expose yesterday → previsions[todayIdx - 1] is missing).
            const todayISO = (todayIdx >= 0 && previsions[todayIdx]) ? previsions[todayIdx].dateISO : null;
            const yesterdayISO = (function() {
                if (!todayISO) return null;
                var d = new Date(todayISO + 'T12:00:00');
                d.setDate(d.getDate() - 1);
                return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            })();

            // On-demand Open-Meteo fetch for "Hier" (Meteoblue has no past data).
            useEffect(function() {
                if (day !== 'yesterday' || yesterdayHours != null || !yesterdayISO) return;
                var cancelled = false;
                setYesterdayLoading(true);
                fetchOpenMeteoHourly(ferme, yesterdayISO).then(function(rows) {
                    if (cancelled) return;
                    setYesterdayHours(rows || []);
                    setYesterdayLoading(false);
                }).catch(function() {
                    if (cancelled) return;
                    setYesterdayHours([]);
                    setYesterdayLoading(false);
                });
                return function() { cancelled = true; };
            }, [day, yesterdayISO, ferme, yesterdayHours]);

            const isYesterday = day === 'yesterday';
            // Synthetic targetDay for "Hier": Meteoblue has no previsions entry for it.
            const targetDay = isYesterday
                ? (yesterdayISO ? { dateISO: yesterdayISO, eto: null, isToday: false } : null)
                : ((targetIdx >= 0 && targetIdx < previsions.length) ? previsions[targetIdx] : null);
            // No "day before yesterday" data → no deltas for "Hier" (out of scope).
            const prevDay = isYesterday ? null : ((targetIdx - 1 >= 0 && targetIdx - 1 < previsions.length) ? previsions[targetIdx - 1] : null);

            if (isYesterday && yesterdayLoading) {
                return (
                    <Panel title="Prévision extérieure" icon="fa-chart-area">
                        <div style={{textAlign:'center', padding:60}}>
                            <i className="fa-solid fa-spinner fa-spin" style={{fontSize:32, color:'var(--berry)'}}></i>
                            <div style={{marginTop:12, color:'var(--gray-400)'}}>Chargement données d'hier (Open-Meteo)...</div>
                        </div>
                    </Panel>
                );
            }

            if (!targetDay) {
                return (
                    <Panel title="Prévision extérieure" icon="fa-chart-area">
                        <div style={{textAlign:'center', padding:30, color:'var(--gray-400)', fontSize:12}}>
                            <i className="fa-solid fa-circle-info" style={{marginRight:6}}></i>
                            Données indisponibles pour {day === 'yesterday' ? 'hier' : (day === 'tomorrow' ? 'demain' : 'aujourd\'hui')}.
                        </div>
                    </Panel>
                );
            }

            const sourceHours = isYesterday ? (yesterdayHours || []) : (horaire24[targetDay.dateISO] || []);
            const hours = sourceHours.slice().sort(function(a,b){ return a.hour - b.hour; });
            const prevHours = prevDay ? (horaire24[prevDay.dateISO] || []) : [];

            // Open-Meteo returned nothing for "Hier" (network/CORS error) → explicit message.
            if (isYesterday && !hours.length) {
                return (
                    <Panel title="Prévision extérieure" icon="fa-chart-area">
                        <div style={{textAlign:'center', padding:30, color:'var(--gray-400)', fontSize:12}}>
                            <i className="fa-solid fa-circle-info" style={{marginRight:6}}></i>
                            Données d'hier indisponibles (source Open-Meteo).
                        </div>
                    </Panel>
                );
            }

            // Compute series
            const tempArr = hours.map(function(h){ return Number(h.tempRaw); });
            const rhArr = hours.map(function(h){ return Number(h.humidityRaw); });
            const swArr = hours.map(function(h){ return Number(h.radiation) || 0; });
            const etoArr = hours.map(function(h){ return Number(h.eto) || 0; });
            const vpdArr = MC ? MC.computeHourlyVPD(tempArr, rhArr) : tempArr.map(function(){ return 0; });
            const cumRadArr = MC ? MC.computeCumRadiation(swArr) : swArr.map(function(){ return 0; });

            // Availability flags — if Meteoblue agro-1h is not included in the subscription,
            // shortwave_radiation / evapotranspiration arrays will be missing → all-zero series.
            const hasRadiation = swArr.some(function(v){ return v > 0; });
            const hasEto = etoArr.some(function(v){ return v > 0; });

            // Synthese cards
            const tMax = tempArr.length ? Math.max.apply(null, tempArr) : 0;
            const tMin = tempArr.length ? Math.min.apply(null, tempArr) : 0;
            const tMoy = tempArr.length ? tempArr.reduce(function(a,b){return a+b;},0) / tempArr.length : 0;
            const cumRad = cumRadArr.length ? cumRadArr[cumRadArr.length - 1] : 0;
            const etoSum = etoArr.reduce(function(a,b){return a+b;},0);
            const vpdPeak = MC ? MC.peakIndex(vpdArr) : { idx: -1, val: null };
            const etoPeak = MC ? MC.peakIndex(etoArr) : { idx: -1, val: null };

            // Deltas vs previous day
            const prevTempArr = prevHours.map(function(h){ return Number(h.tempRaw); });
            const prevRhArr = prevHours.map(function(h){ return Number(h.humidityRaw); });
            const prevSwArr = prevHours.map(function(h){ return Number(h.radiation) || 0; });
            const prevEtoArr = prevHours.map(function(h){ return Number(h.eto) || 0; });
            const prevVpdArr = MC ? MC.computeHourlyVPD(prevTempArr, prevRhArr) : [];
            const prevCumRadArr = MC ? MC.computeCumRadiation(prevSwArr) : [];
            const prevTMoy = prevTempArr.length ? prevTempArr.reduce(function(a,b){return a+b;},0)/prevTempArr.length : null;
            const prevCumRad = prevCumRadArr.length ? prevCumRadArr[prevCumRadArr.length - 1] : null;
            const prevEtoSum = prevEtoArr.reduce(function(a,b){return a+b;},0);
            const prevVpdMax = prevVpdArr.length ? Math.max.apply(null, prevVpdArr) : null;

            function fmtDelta(curr, prev, unit, decimals) {
                if (prev == null || isNaN(prev)) return null;
                const d = curr - prev;
                const abs = Math.abs(d).toFixed(decimals == null ? 1 : decimals);
                return { dir: d >= 0 ? 'up' : 'down', text: abs + unit + ' ' + (d >= 0 ? 'plus haut' : 'plus bas') + ' qu\'hier' };
            }

            // Chart geometry
            const W = 900, H = 360, pad = { t: 24, b: 36, l: 78, r: 96 };
            const innerW = W - pad.l - pad.r;
            const innerH = H - pad.t - pad.b;
            const N = hours.length || 24;
            const xStep = innerW / Math.max(1, N - 1);
            const xAt = function(i) { return pad.l + i * xStep; };

            // Left axis (°C, also used for VPD via independent scaling — see VPD path)
            const tHi = Math.max(20, Math.ceil(tMax + 2));
            const tLo = Math.min(0, Math.floor(tMin - 2));
            const yT = function(v) { return pad.t + innerH * (1 - (v - tLo) / (tHi - tLo || 1)); };

            // Right axis (J/cm² cumulative)
            const radMax = Math.max(360, Math.ceil((cumRadArr.length ? cumRadArr[cumRadArr.length - 1] : 0) / 90) * 90);
            const yR = function(v) { return pad.t + innerH * (1 - v / (radMax || 1)); };

            // VPD scaled to left axis range visually (0..max VPD ↦ tLo..tHi top half)
            const vpdMax = Math.max(2, Math.ceil((vpdArr.length ? Math.max.apply(null, vpdArr) : 0) * 10) / 10);
            const yV = function(v) { return pad.t + innerH * (1 - v / vpdMax); };

            // ETo bars: scaled to a small fraction of inner height, anchored at bottom
            const etoMax = Math.max(0.2, etoArr.length ? Math.max.apply(null, etoArr) : 0.2);
            const etoBarMaxH = innerH * 0.45;
            const etoBarH = function(v) { return Math.max(0, (v / etoMax) * etoBarMaxH); };
            // y position of an ETo value on the right axis (0 at bottom, etoMax at top of bars zone)
            const yE = function(v) { return pad.t + innerH - (v / etoMax) * etoBarMaxH; };
            const barW = Math.max(6, xStep * 0.55);

            const tempPath = hours.map(function(h, i) { return (i === 0 ? 'M' : 'L') + xAt(i) + ',' + yT(h.tempRaw); }).join(' ');
            const radPath = cumRadArr.map(function(v, i) { return (i === 0 ? 'M' : 'L') + xAt(i) + ',' + yR(v); }).join(' ');
            const vpdPath = vpdArr.map(function(v, i) { return (i === 0 ? 'M' : 'L') + xAt(i) + ',' + yV(v); }).join(' ');

            // Day label fr
            const jourNomsFull = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
            const moisNoms = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
            const dObj = new Date(targetDay.dateISO + 'T12:00:00');
            const dayLabel = jourNomsFull[dObj.getDay()] + ' ' + dObj.getDate() + ' ' + moisNoms[dObj.getMonth()];

            const segBtnStyle = function(active) { return {
                padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: active ? 'var(--green-pale, #dff5dd)' : 'transparent',
                color: active ? 'var(--green, #2e7d32)' : 'var(--gray-500)',
                borderRadius: 999,
            }; };

            function exportCSV() {
                const rows = [['heure','temperature_C','humidite_pct','radiation_W_m2','radiation_cum_J_cm2','VPD_kPa','ETo_mm']];
                hours.forEach(function(h, i) {
                    rows.push([h.heure, h.tempRaw, h.humidityRaw, swArr[i], cumRadArr[i].toFixed(2), vpdArr[i].toFixed(3), (etoArr[i] || 0).toFixed(3)]);
                });
                const csv = rows.map(function(r){ return r.join(','); }).join('\n');
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'prevision_exterieure_' + ferme + '_' + targetDay.dateISO + '.csv';
                document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            }

            const cards = [
                {
                    color: '#5DADE2', label: 'Température',
                    value: 'H: ' + Math.round(tMax) + '°C  B: ' + Math.round(tMin) + '°C  Moy: ' + Math.round(tMoy) + '°C',
                    delta: isYesterday ? null : fmtDelta(tMoy, prevTMoy, '°C', 0),
                },
                {
                    color: '#E74C3C', label: 'Radiation accumulée',
                    value: hasRadiation ? ('Accumulation quotidienne : ' + Math.round(cumRad) + ' J/cm²') : 'Non disponible (package agro-1h non inclus)',
                    delta: (isYesterday || !hasRadiation) ? null : fmtDelta(cumRad, prevCumRad, ' J/cm²', 0),
                },
                {
                    color: '#8E44AD', label: 'Déficit de pression de vapeur (VPD)',
                    value: vpdPeak.idx >= 0 ? ('Le plus élevé à ' + hours[vpdPeak.idx].heure + ' (' + vpdPeak.val.toFixed(2) + ' kPa)') : '—',
                    delta: (!isYesterday && prevVpdMax != null && vpdPeak.val != null)
                        ? (function(){ var d = ((vpdPeak.val - prevVpdMax) / (prevVpdMax || 1)) * 100; return { dir: d >= 0 ? 'up' : 'down', text: Math.abs(Math.round(d)) + '% ' + (d >= 0 ? 'plus haut' : 'plus bas') + ' qu\'hier' }; })()
                        : null,
                },
                {
                    color: '#2E7D32', label: 'Évapotranspiration (ETo)',
                    value: hasEto
                        ? (etoPeak.idx >= 0 ? ('Le plus élevé à ' + hours[etoPeak.idx].heure + ' — Total : ' + etoSum.toFixed(2) + ' mm') : '—')
                        : ('Total journalier : ' + (targetDay.eto != null ? targetDay.eto.toFixed(2) : '—') + ' mm (horaire indispo)'),
                    delta: (isYesterday || !hasEto) ? null : fmtDelta(etoSum, prevEtoSum, 'mm', 2),
                },
            ];

            return (
                <Panel title="Prévision extérieure" icon="fa-chart-area" actions={
                    <div style={{display:'flex', alignItems:'center', gap:8}}>
                        <div style={{display:'inline-flex', background:'var(--gray-50)', borderRadius:999, padding:3}}>
                            {[
                                { k:'yesterday', label:'Hier' },
                                { k:'today',     label:'Aujourd\'hui' },
                                { k:'tomorrow',  label:'Demain' },
                            ].map(function(opt) {
                                return <button key={opt.k} onClick={function(){ setDay(opt.k); }} style={segBtnStyle(day === opt.k)}>
                                    {day === opt.k && <i className="fa-solid fa-check" style={{marginRight:5, fontSize:10}}></i>}
                                    {opt.label}
                                </button>;
                            })}
                        </div>
                        <button onClick={exportCSV} title="Exporter en CSV" style={{padding:'6px 12px', fontSize:11, fontWeight:600, color:'var(--gray-600)', background:'#fff', border:'1px solid var(--gray-200)', borderRadius:8, cursor:'pointer'}}>
                            Exporter <i className="fa-solid fa-download" style={{marginLeft:4}}></i>
                        </button>
                    </div>
                }>
                    <div style={{fontSize:12, color:'var(--gray-500)', marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                        <span>Prévisions extérieures, {dayLabel} — {fermeInfo.nom}</span>
                        {!(hasRadiation && hasEto) && (
                            <span title="Radiation horaire et ETo horaire nécessitent le package Meteoblue agro-1h" style={{fontSize:10, padding:'3px 8px', borderRadius:8, background:'rgba(243,156,18,0.1)', color:'var(--orange)', fontWeight:600}}>
                                <i className="fa-solid fa-circle-info" style={{marginRight:4}}></i>
                                {!hasRadiation && !hasEto ? 'Radiation & ETo horaires indisponibles' : (!hasRadiation ? 'Radiation horaire indisponible' : 'ETo horaire indisponible')}
                            </span>
                        )}
                    </div>
                    <svg viewBox={'0 0 ' + W + ' ' + H} style={{width:'100%', height:'auto', display:'block'}}>
                        {/* Grid + left axes: °C (blue, intérieur) + VPD kPa (violet, extérieur) */}
                        {[0,1,2,3,4].map(function(i) {
                            const tVal = tLo + (tHi - tLo) * (1 - i/4);
                            const vpdVal = vpdMax * (1 - i/4);
                            const y = pad.t + innerH * (i/4);
                            return <g key={'g'+i}>
                                <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="var(--gray-100)" strokeWidth="1"/>
                                <text x={pad.l - 36} y={y + 4} textAnchor="end" fontSize="10" fill="#8E44AD" fontWeight="600">{vpdVal.toFixed(1)}</text>
                                <text x={pad.l - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#5DADE2" fontWeight="600">{Math.round(tVal)}</text>
                            </g>;
                        })}
                        {/* Right J/cm² axis (radiation cumulée) */}
                        {hasRadiation && [0,1,2,3,4].map(function(i) {
                            const v = radMax * (1 - i/4);
                            const y = pad.t + innerH * (i/4);
                            return <text key={'r'+i} x={W - pad.r + 8} y={y + 4} textAnchor="start" fontSize="10" fill="#E74C3C" fontWeight="600">{Math.round(v)}</text>;
                        })}
                        {/* Right ETo axis (mm), aligné sur la zone des barres (bas du chart) */}
                        {hasEto && [0, 0.5, 1].map(function(frac, i) {
                            const v = etoMax * frac;
                            const y = yE(v);
                            return <text key={'e'+i} x={W - pad.r + 42} y={y + 4} textAnchor="start" fontSize="10" fill="#2E7D32" fontWeight="600">{v.toFixed(1)}</text>;
                        })}
                        <text x={pad.l - 50} y={pad.t + innerH/2} fontSize="10" fill="#8E44AD" fontWeight="700" transform={'rotate(-90 ' + (pad.l - 50) + ' ' + (pad.t + innerH/2) + ')'}>kPa</text>
                        <text x={pad.l - 22} y={pad.t + innerH/2} fontSize="10" fill="#5DADE2" fontWeight="700" transform={'rotate(-90 ' + (pad.l - 22) + ' ' + (pad.t + innerH/2) + ')'}>°C</text>
                        {hasRadiation && <text x={W - pad.r + 30} y={pad.t + innerH/2} fontSize="10" fill="#E74C3C" fontWeight="700" transform={'rotate(-90 ' + (W - pad.r + 30) + ' ' + (pad.t + innerH/2) + ')'}>J/cm²</text>}
                        {hasEto && <text x={W - pad.r + 70} y={pad.t + innerH - etoBarMaxH/2} fontSize="10" fill="#2E7D32" fontWeight="700" transform={'rotate(-90 ' + (W - pad.r + 70) + ' ' + (pad.t + innerH - etoBarMaxH/2) + ')'}>mm ETo</text>}

                        {/* X axis ticks every 2h */}
                        {hours.map(function(h, i) {
                            if (h.hour % 2 !== 0) return null;
                            const hh = h.hour;
                            const ampm = hh === 0 ? '12:00 AM' : (hh < 12 ? hh + ':00 AM' : (hh === 12 ? '12:00 PM' : (hh - 12) + ':00 PM'));
                            return <text key={'x'+i} x={xAt(i)} y={H - 12} textAnchor="middle" fontSize="9" fill="var(--gray-400)">{ampm}</text>;
                        })}

                        {/* ETo bars (anchored at bottom) */}
                        {hasEto && hours.map(function(h, i) {
                            const bH = etoBarH(etoArr[i]);
                            if (bH <= 0) return null;
                            return <rect key={'b'+i} x={xAt(i) - barW/2} y={pad.t + innerH - bH} width={barW} height={bH} fill="#2E7D32" opacity="0.85" rx="1"/>;
                        })}

                        {/* Cumulative radiation (red) */}
                        {hasRadiation && <path d={radPath} fill="none" stroke="#E74C3C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>}
                        {/* VPD (purple) */}
                        <path d={vpdPath} fill="none" stroke="#8E44AD" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        {/* Temperature (light blue) */}
                        <path d={tempPath} fill="none" stroke="#5DADE2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        {/* T° max & T° min annotations directement sur la courbe */}
                        {(function() {
                            if (!tempArr.length) return null;
                            var iMax = 0, iMin = 0;
                            for (var k = 1; k < tempArr.length; k++) {
                                if (tempArr[k] > tempArr[iMax]) iMax = k;
                                if (tempArr[k] < tempArr[iMin]) iMin = k;
                            }
                            return <g>
                                <circle cx={xAt(iMax)} cy={yT(tempArr[iMax])} r="4" fill="#5DADE2" stroke="white" strokeWidth="1.5"/>
                                <text x={xAt(iMax)} y={yT(tempArr[iMax]) - 9} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1B7AB8" stroke="white" strokeWidth="3" paintOrder="stroke">{Math.round(tempArr[iMax])}°</text>
                                <circle cx={xAt(iMin)} cy={yT(tempArr[iMin])} r="4" fill="#5DADE2" stroke="white" strokeWidth="1.5"/>
                                <text x={xAt(iMin)} y={yT(tempArr[iMin]) + 16} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1B7AB8" stroke="white" strokeWidth="3" paintOrder="stroke">{Math.round(tempArr[iMin])}°</text>
                            </g>;
                        })()}
                    </svg>

                    {/* 4 synthesis cards */}
                    <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginTop:14}}>
                        {cards.map(function(c, i) {
                            return <div key={i} style={{padding:'12px 14px', background:'var(--gray-50)', borderRadius:12, border:'1px solid var(--gray-100)'}}>
                                <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:6}}>
                                    <span style={{width:10, height:10, borderRadius:'50%', background:c.color, display:'inline-block'}}></span>
                                    <span style={{fontSize:12, fontWeight:700, color:'var(--gray-700, #444)'}}>{c.label}</span>
                                </div>
                                <div style={{fontSize:12, color:'var(--gray-600)', minHeight:32}}>{c.value}</div>
                                {c.delta && <div style={{marginTop:8, display:'inline-block', padding:'4px 10px', background:'#fff', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:11, color:'var(--gray-500)'}}>
                                    <i className={'fa-solid ' + (c.delta.dir === 'up' ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down')} style={{marginRight:5, color: c.delta.dir === 'up' ? 'var(--orange)' : 'var(--green)'}}></i>
                                    {c.delta.text}
                                </div>}
                            </div>;
                        })}
                    </div>
                </Panel>
            );
        }

export { MeteoPrevisionExterieure };
