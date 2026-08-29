/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): ProductivityHistogramSvg */


function ProductivityHistogramSvg({ treatment }) {
            const growers = (treatment.growers || []).slice().sort((a, b) => b.yield - a.yield);
            if (growers.length === 0) return <div style={{ color: 'var(--gray-500)' }}>Aucun grower</div>;
            const avgIdx = treatment.average ? growers.findIndex(g => g.yield < treatment.average) : -1;
            const allBars = growers.slice();
            if (treatment.average && avgIdx >= 0) {
                allBars.splice(avgIdx, 0, { code: 'Average', yield: treatment.average, plantingWeek: null, _isAverage: true });
            } else if (treatment.average) {
                allBars.push({ code: 'Average', yield: treatment.average, _isAverage: true });
            }
            const W = Math.max(800, allBars.length * 40);
            const H = 380;
            const padL = 50, padR = 20, padT = 30, padB = 90;
            const maxY = Math.max(...allBars.map(b => b.yield)) * 1.05;
            const yScale = (y) => H - padB - (y / maxY) * (H - padT - padB);
            const barW = (W - padL - padR) / allBars.length * 0.75;
            const xPos = (i) => padL + (i + 0.5) * (W - padL - padR) / allBars.length;
            const top25Y = treatment.top25Threshold ? yScale(treatment.top25Threshold) : null;
            const avgY = treatment.average ? yScale(treatment.average) : null;
            const colorFor = (g) => {
                if (g._isAverage) return '#9b59b6';
                if (g.code === '172') return '#e74c3c';
                if (g.code === '195') return '#3498db';
                return '#f5b7b1';
            };
            const ticks = [];
            const tickStep = Math.pow(10, Math.floor(Math.log10(maxY))) / 2;
            for (let t = 0; t <= maxY; t += tickStep) ticks.push(t);
            return (
                <div style={{ width: '100%', overflowX: 'auto', background: '#fafbfc', borderRadius: 6, padding: 8 }}>
                    <svg width={W} height={H} style={{ display: 'block' }}>
                        {ticks.map((t, i) => (
                            <g key={i}>
                                <line x1={padL} y1={yScale(t)} x2={W - padR} y2={yScale(t)} stroke="#e9ecef" strokeWidth="1" />
                                <text x={padL - 6} y={yScale(t) + 4} textAnchor="end" fontSize="10" fill="#6c757d">{Math.round(t).toLocaleString('fr-FR')}</text>
                            </g>
                        ))}
                        {allBars.map((g, i) => {
                            const x = xPos(i) - barW / 2;
                            const y = yScale(g.yield);
                            const h = H - padB - y;
                            const isHighlight = g.code === '172' || g.code === '195' || g._isAverage;
                            return (
                                <g key={i}>
                                    <title>{g.code} · {g.yield.toLocaleString('fr-FR')} {treatment.unit}{g.plantingWeek ? ' · plant. W' + g.plantingWeek : ''}</title>
                                    <rect x={x} y={y} width={barW} height={h} fill={colorFor(g)}
                                        stroke={isHighlight ? '#000' : 'none'} strokeWidth="0.5" />
                                    <text x={xPos(i)} y={H - padB + 14} textAnchor="middle"
                                        fontSize={isHighlight ? 11 : 9} fontWeight={isHighlight ? 700 : 400}
                                        fill={colorFor(g)}
                                        transform={'rotate(-45 ' + xPos(i) + ',' + (H - padB + 14) + ')'}>{g.code}</text>
                                </g>
                            );
                        })}
                        {top25Y !== null && (
                            <g>
                                <line x1={padL} y1={top25Y} x2={W - padR} y2={top25Y} stroke="#e67e22" strokeWidth="2" strokeDasharray="6 4" />
                                <text x={W - padR - 4} y={top25Y - 4} textAnchor="end" fontSize="11" fill="#e67e22" fontWeight="700">
                                    Objectif Top 25 % = {treatment.top25Threshold.toLocaleString('fr-FR')}
                                </text>
                            </g>
                        )}
                        {avgY !== null && (
                            <g>
                                <line x1={padL} y1={avgY} x2={W - padR} y2={avgY} stroke="#9b59b6" strokeWidth="1.5" strokeDasharray="3 3" />
                                <text x={padL + 4} y={avgY - 4} fontSize="10" fill="#9b59b6">Moyenne</text>
                            </g>
                        )}
                    </svg>
                </div>
            );
        }

export { ProductivityHistogramSvg };
