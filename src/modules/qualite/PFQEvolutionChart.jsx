/* Module: qualite | Déclaration(s): PFQEvolutionChart */
import { useState } from '../shared/reactHooks.jsx';

// PFQ Evolution Chart Component
        function PFQEvolutionChart({ data, blocLabel }) {
            const [showTotal, setShowTotal] = useState(true);
            const [showCondition, setShowCondition] = useState(true);
            const [showAppearance, setShowAppearance] = useState(false);
            const [showBrix, setShowBrix] = useState(false);

            const width = 600;
            const height = 250;
            const padding = { top: 20, right: 20, bottom: 30, left: 50 };
            const plotWidth = width - padding.left - padding.right;
            const plotHeight = height - padding.top - padding.bottom;

            const maxScore = 100;
            const minScore = 0;
            const dataPoints = (data || []).slice().reverse();
            const xStep = dataPoints.length > 1 ? plotWidth / (dataPoints.length - 1) : 0;

            const getY = (score) => padding.top + plotHeight - (((Number(score) || 0) - minScore) / (maxScore - minScore)) * plotHeight;
            const getX = (idx) => padding.left + (dataPoints.length === 1 ? plotWidth / 2 : idx * xStep);

            const pathData = (dataKey) => {
                return dataPoints.map((d, i) => {
                    const x = getX(i);
                    const y = getY(d[dataKey]);
                    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                }).join(' ');
            };

            return (
                <div>
                    <div style={{marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap'}}>
                        <button onClick={() => setShowTotal(!showTotal)} style={{padding: '6px 12px', fontSize: 12, border: showTotal ? '2px solid var(--berry)' : '1px solid var(--gray-200)', background: showTotal ? 'rgba(139,34,82,0.1)' : 'white', borderRadius: 6, cursor: 'pointer'}}>
                            <span style={{display: 'inline-block', width: 10, height: 10, background: 'var(--berry)', borderRadius: 2, marginRight: 6, marginBottom: 1}}></span>
                            Total PFQ {showTotal ? '✓' : ''}
                        </button>
                        <button onClick={() => setShowCondition(!showCondition)} style={{padding: '6px 12px', fontSize: 12, border: showCondition ? '2px solid var(--red)' : '1px solid var(--gray-200)', background: showCondition ? 'rgba(231,76,60,0.1)' : 'white', borderRadius: 6, cursor: 'pointer'}}>
                            <span style={{display: 'inline-block', width: 10, height: 10, background: 'var(--red)', borderRadius: 2, marginRight: 6, marginBottom: 1}}></span>
                            Condition {showCondition ? '✓' : ''}
                        </button>
                        <button onClick={() => setShowAppearance(!showAppearance)} style={{padding: '6px 12px', fontSize: 12, border: showAppearance ? '2px solid var(--orange)' : '1px solid var(--gray-200)', background: showAppearance ? 'rgba(230,126,34,0.1)' : 'white', borderRadius: 6, cursor: 'pointer'}}>
                            <span style={{display: 'inline-block', width: 10, height: 10, background: 'var(--orange)', borderRadius: 2, marginRight: 6, marginBottom: 1}}></span>
                            Apparence {showAppearance ? '✓' : ''}
                        </button>
                        <button onClick={() => setShowBrix(!showBrix)} style={{padding: '6px 12px', fontSize: 12, border: showBrix ? '2px solid #9C27B0' : '1px solid var(--gray-200)', background: showBrix ? 'rgba(156,39,176,0.1)' : 'white', borderRadius: 6, cursor: 'pointer'}}>
                            <span style={{display: 'inline-block', width: 10, height: 10, background: '#9C27B0', borderRadius: 2, marginRight: 6, marginBottom: 1}}></span>
                            Brix {showBrix ? '✓' : ''}
                        </button>
                    </div>

                    <svg width={width} height={height} style={{border: '1px solid var(--gray-200)', borderRadius: 8}}>
                        {/* Grid lines */}
                        {[0, 20, 40, 60, 80, 100].map((val, i) => {
                            const y = getY(val);
                            return (
                                <g key={`grid-${i}`}>
                                    <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="var(--gray-200)" strokeDasharray="4,4" />
                                    <text x={padding.left - 10} y={y + 4} fontSize="10" textAnchor="end" fill="var(--gray-400)">{val}</text>
                                </g>
                            );
                        })}

                        {/* Axes */}
                        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="var(--gray-400)" strokeWidth="1" />
                        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="var(--gray-400)" strokeWidth="1" />

                        {/* Y-axis label */}
                        <text x="12" y="30" fontSize="11" fill="var(--gray-600)" fontWeight="600">PFQ Score (0-100)</text>

                        {/* Data lines */}
                        {showTotal && <path d={pathData('totalPFQ')} fill="none" stroke="var(--berry)" strokeWidth="2" />}
                        {showCondition && <path d={pathData('conditionPoints')} fill="none" stroke="var(--red)" strokeWidth="2" />}
                        {showAppearance && <path d={pathData('appearancePoints')} fill="none" stroke="var(--orange)" strokeWidth="2" />}
                        {showBrix && <path d={pathData('brixPFQ')} fill="none" stroke="#9C27B0" strokeWidth="2" />}

                        {/* X-axis labels */}
                        {dataPoints.map((d, i) => {
                            if (i % 1 === 0) {
                                const x = getX(i);
                                return (
                                    <text key={`label-${i}`} x={x} y={height - padding.bottom + 16} fontSize="10" textAnchor="middle" fill="var(--gray-600)">
                                        {d.date.substring(0, 5)}
                                    </text>
                                );
                            }
                        })}
                    </svg>

                    <div style={{fontSize: 11, color: 'var(--gray-400)', marginTop: 8, fontStyle: 'italic'}}>
                        Bloc: {blocLabel} | 7 derniers jours
                    </div>
                </div>
            );
        }

export { PFQEvolutionChart };
