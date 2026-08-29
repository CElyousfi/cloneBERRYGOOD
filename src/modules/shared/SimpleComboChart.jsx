/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): SimpleComboChart */


function SimpleComboChart({ data, xKey, lineKey, barKey, lineColor, barColor, height = 200, lineMode = 'continuous' }) {
            if (!data || !data.length) return null;
            const padding = { top: 20, right: 50, bottom: 30, left: 50 };
            const W = 600;
            const chartW = W - padding.left - padding.right;
            const chartH = height - padding.top - padding.bottom;
            const n = data.length;
            const maxLine = Math.max(1, ...data.map(d => Number(d[lineKey]) || 0)) * 1.1;
            const maxBar = Math.max(1, ...data.map(d => Number(d[barKey]) || 0)) * 1.1;
            const xLabelEvery = Math.max(1, Math.ceil(n / 12));
            const xAt = (i) => padding.left + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);
            const barW = (n === 1 ? chartW * 0.4 : (chartW / n) * 0.6);
            const yFor = (val) => padding.top + chartH - ((Number(val) || 0) / maxLine) * chartH;

            const peakPoints = data.map((d, i) => ({ x: xAt(i), y: yFor(d[lineKey]), val: Number(d[lineKey]) || 0 }));

            let pathD;
            if (lineMode === 'sawtooth') {
                const yZero = padding.top + chartH;
                const resetDx = Math.max(2, (n > 1 ? (chartW / (n - 1)) : chartW) * 0.04);
                const segs = [];
                segs.push(`M ${peakPoints[0].x} ${peakPoints[0].y}`);
                for (let i = 0; i < n; i++) {
                    const p = peakPoints[i];
                    if (i > 0) segs.push(`L ${p.x} ${p.y}`);
                    segs.push(`L ${p.x + resetDx} ${yZero}`);
                    if (i < n - 1) segs.push(`M ${p.x + resetDx} ${yZero}`);
                }
                pathD = segs.join(' ');
            } else {
                pathD = peakPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            }

            return React.createElement('svg', { width: '100%', height: height, viewBox: `0 0 ${W} ${height}`, preserveAspectRatio: 'xMidYMid meet' },
                [0, 0.25, 0.5, 0.75, 1].map((tick, i) => {
                    const y = padding.top + chartH * (1 - tick);
                    return React.createElement('g', { key: 'g' + i },
                        React.createElement('line', { x1: padding.left, y1: y, x2: W - padding.right, y2: y, stroke: '#f0f0f0', strokeDasharray: '3 3' }),
                        React.createElement('text', { x: padding.left - 5, y: y + 4, textAnchor: 'end', fontSize: '10', fill: lineColor }, Math.round(maxLine * tick)),
                        React.createElement('text', { x: W - padding.right + 5, y: y + 4, textAnchor: 'start', fontSize: '10', fill: barColor }, Math.round(maxBar * tick))
                    );
                }),
                data.map((d, i) => {
                    const val = Number(d[barKey]) || 0;
                    const bh = Math.max(0, (val / maxBar) * chartH);
                    const bx = xAt(i) - barW / 2;
                    const by = padding.top + chartH - bh;
                    return React.createElement('rect', { key: 'b' + i, x: bx, y: by, width: barW, height: bh, fill: barColor, rx: 4, opacity: 0.7 });
                }),
                React.createElement('path', { d: pathD, fill: 'none', stroke: lineColor, strokeWidth: 2 }),
                peakPoints.map((p, i) => React.createElement('circle', { key: 'd' + i, cx: p.x, cy: p.y, r: 3, fill: lineColor })),
                data.map((d, i) => (i % xLabelEvery === 0 || i === n - 1) ? React.createElement('text', { key: 'x' + i, x: xAt(i), y: height - 8, textAnchor: 'middle', fontSize: '11', fill: '#666' }, d[xKey]) : null)
            );
        }

export { SimpleComboChart };
