/* Module: agronomie | Déclaration(s): ProductivityBoxplotMultiSvg */
import { computeBoxStats } from '../recolte/computeBoxStats.jsx';

function ProductivityBoxplotMultiSvg({ treatments, myFarm }) {
            if (!treatments || treatments.length === 0) return null;
            const items = treatments.map(t => {
                const yields = (t.growers || []).map(g => g.yield).filter(y => typeof y === 'number');
                const stats = computeBoxStats(yields);
                const f1 = (t.growers || []).find(g => g.code === '172') || null;
                const f5 = (t.growers || []).find(g => g.code === '195') || null;
                return { t, stats, f1, f5 };
            }).filter(it => it.stats);
            if (items.length === 0) return null;

            const boxW = 90, gap = 50;
            const padL = 70, padR = 30, padT = 30, padB = 130;
            const innerW = items.length * (boxW + gap);
            const W = Math.max(800, padL + padR + innerW);
            const H = 460;

            let maxY = 0;
            items.forEach(({ stats, f1, f5 }) => {
                maxY = Math.max(maxY, stats.max);
                if (f1) maxY = Math.max(maxY, f1.yield);
                if (f5) maxY = Math.max(maxY, f5.yield);
            });
            maxY = maxY * 1.05 || 1;

            const yScale = (y) => H - padB - (y / maxY) * (H - padT - padB);
            const xCenter = (i) => padL + i * (boxW + gap) + boxW / 2;

            const ticks = [];
            const tickStep = Math.pow(10, Math.floor(Math.log10(maxY))) / 2;
            for (let t = 0; t <= maxY; t += tickStep) ticks.push(t);

            const unit = (items[0] && items[0].t.unit) || '';

            const showF1 = !myFarm || myFarm === 'F1';
            const showF5 = !myFarm || myFarm === 'F5';

            const truncate = (s, n) => (s && s.length > n) ? s.slice(0, n - 1) + '…' : (s || '');

            return (
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--gray-200)', padding: 16, marginBottom: 16 }}>
                    <h3 style={{ margin: '0 0 4px 0' }}>Positionnement BGF — vue d'ensemble</h3>
                    <div style={{ fontSize: 12, color: 'var(--gray-600)', marginBottom: 10 }}>
                        Boxplot par traitement ({items.length}) · médiane, Q1/Q3, moustaches Tukey 1.5×IQR, outliers
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--gray-700)', marginBottom: 8, flexWrap: 'wrap' }}>
                        {showF1 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e74c3c', display: 'inline-block' }}></span>
                                BGF F1 (172)
                            </span>
                        )}
                        {showF5 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#3498db', display: 'inline-block' }}></span>
                                BGF F5 (195)
                            </span>
                        )}
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#e67e22' }}>
                            <span style={{ fontWeight: 700 }}>×</span> Moyenne
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', border: '1px solid #333', display: 'inline-block' }}></span>
                            Outliers
                        </span>
                    </div>
                    <div style={{ width: '100%', overflowX: 'auto', background: '#fafbfc', borderRadius: 6, padding: 8 }}>
                        <svg width={W} height={H} style={{ display: 'block' }}>
                            {ticks.map((t, i) => (
                                <g key={'tick' + i}>
                                    <line x1={padL} y1={yScale(t)} x2={W - padR} y2={yScale(t)} stroke="#e9ecef" strokeWidth="1" />
                                    <text x={padL - 6} y={yScale(t) + 4} textAnchor="end" fontSize="10" fill="#6c757d">{Math.round(t).toLocaleString('fr-FR')}</text>
                                </g>
                            ))}
                            {items.map(({ t, stats, f1, f5 }, i) => {
                                const cx = xCenter(i);
                                const xL = cx - boxW / 2;
                                const xR = cx + boxW / 2;
                                const yQ1 = yScale(stats.q1);
                                const yQ3 = yScale(stats.q3);
                                const yMed = yScale(stats.median);
                                const yWL = yScale(stats.whiskerLow);
                                const yWH = yScale(stats.whiskerHigh);
                                const yMean = yScale(stats.mean);
                                const tooltip = (t.title || '') +
                                    '\nn=' + stats.n +
                                    '\nmin=' + Math.round(stats.min).toLocaleString('fr-FR') +
                                    ' · Q1=' + Math.round(stats.q1).toLocaleString('fr-FR') +
                                    ' · méd=' + Math.round(stats.median).toLocaleString('fr-FR') +
                                    ' · Q3=' + Math.round(stats.q3).toLocaleString('fr-FR') +
                                    ' · max=' + Math.round(stats.max).toLocaleString('fr-FR') +
                                    '\nmoyenne=' + Math.round(stats.mean).toLocaleString('fr-FR');
                                return (
                                    <g key={'box' + i}>
                                        <title>{tooltip}</title>
                                        {/* Whiskers */}
                                        <line x1={cx} y1={yWH} x2={cx} y2={yQ3} stroke="#333" strokeWidth="1" />
                                        <line x1={cx} y1={yQ1} x2={cx} y2={yWL} stroke="#333" strokeWidth="1" />
                                        <line x1={cx - boxW / 4} y1={yWH} x2={cx + boxW / 4} y2={yWH} stroke="#333" strokeWidth="1" />
                                        <line x1={cx - boxW / 4} y1={yWL} x2={cx + boxW / 4} y2={yWL} stroke="#333" strokeWidth="1" />
                                        {/* Box */}
                                        <rect x={xL} y={yQ3} width={boxW} height={Math.max(1, yQ1 - yQ3)} fill="#fff" stroke="#333" strokeWidth="1" />
                                        {/* Median */}
                                        <line x1={xL} y1={yMed} x2={xR} y2={yMed} stroke="#e67e22" strokeWidth="2" />
                                        {/* Mean as × */}
                                        <text x={cx} y={yMean + 4} textAnchor="middle" fontSize="14" fontWeight="700" fill="#e67e22">×</text>
                                        {/* Outliers */}
                                        {stats.outliers.map((o, k) => (
                                            <circle key={'o' + k} cx={cx} cy={yScale(o)} r="3" fill="none" stroke="#333" strokeWidth="1" />
                                        ))}
                                        {/* BGF points */}
                                        {showF1 && f1 && (
                                            <g>
                                                <circle cx={cx} cy={yScale(f1.yield)} r="5" fill="#e74c3c" stroke="#fff" strokeWidth="1" />
                                                <text x={xR + 4} y={yScale(f1.yield) - 2} fontSize="10" fill="#e74c3c" fontWeight="700">BGF 172</text>
                                                <text x={xR + 4} y={yScale(f1.yield) + 10} fontSize="10" fill="#e74c3c">{Math.round(f1.yield).toLocaleString('fr-FR')}</text>
                                            </g>
                                        )}
                                        {showF5 && f5 && (
                                            <g>
                                                <circle cx={cx} cy={yScale(f5.yield)} r="5" fill="#3498db" stroke="#fff" strokeWidth="1" />
                                                <text x={xR + 4} y={yScale(f5.yield) - 2} fontSize="10" fill="#3498db" fontWeight="700">BGF 195</text>
                                                <text x={xR + 4} y={yScale(f5.yield) + 10} fontSize="10" fill="#3498db">{Math.round(f5.yield).toLocaleString('fr-FR')}</text>
                                            </g>
                                        )}
                                        {/* X-axis label */}
                                        <text x={cx} y={H - padB + 16} textAnchor="end" fontSize="10" fill="#495057"
                                            transform={'rotate(-35 ' + cx + ',' + (H - padB + 16) + ')'}>
                                            {truncate(t.title, 38)}
                                        </text>
                                        <text x={cx} y={H - padB + 30} textAnchor="end" fontSize="9" fill="#868e96"
                                            transform={'rotate(-35 ' + cx + ',' + (H - padB + 30) + ')'}>
                                            n={stats.n}{t.category ? ' · ' + t.category : ''}
                                        </text>
                                    </g>
                                );
                            })}
                            {/* Y-axis unit label */}
                            <text x={12} y={padT + 4} fontSize="10" fill="#6c757d">{unit}</text>
                        </svg>
                    </div>
                </div>
            );
        }

export { ProductivityBoxplotMultiSvg };
