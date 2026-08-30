/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): SimpleAreaChart */


function SimpleAreaChart({ data, dataKeys, colors, xKey, height = 220, showLabelsFor }) {
            if (!data || !data.length) return null;
            const padding = { top: 30, right: 20, bottom: 30, left: 40 };
            const chartW = 600 - padding.left - padding.right;
            const chartH = height - padding.top - padding.bottom;
            const rawMax = Math.max(...data.flatMap(d => dataKeys.map(k => Number(d[k]) || 0))) * 1.1;
            const maxVal = (rawMax > 0 && isFinite(rawMax)) ? rawMax : 1;
            const n = data.length;
            // Down-sample dots/labels/x-axis when there are too many points
            const dotEvery = n > 120 ? Math.ceil(n / 60) : 1;
            const xLabelEvery = Math.max(1, Math.ceil(n / 12));
            const valLabelEvery = Math.max(1, Math.ceil(n / 15));

            return React.createElement('svg', { width: '100%', height: height, viewBox: `0 0 600 ${height}`, preserveAspectRatio: 'xMidYMid meet' },
                [0, 0.25, 0.5, 0.75, 1].map((tick, i) => {
                    const y = padding.top + chartH * (1 - tick);
                    return React.createElement('g', { key: i },
                        React.createElement('line', { x1: padding.left, y1: y, x2: 600 - padding.right, y2: y, stroke: '#f0f0f0', strokeDasharray: '3 3' }),
                        React.createElement('text', { x: padding.left - 5, y: y + 4, textAnchor: 'end', fontSize: '10', fill: '#999' }, Math.round(maxVal * tick))
                    );
                }),
                dataKeys.map((key, ki) => {
                    const points = data.map((d, i) => ({
                        x: padding.left + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW),
                        y: padding.top + chartH - ((Number(d[key]) || 0) / maxVal) * chartH,
                        val: Number(d[key]) || 0
                    }));
                    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                    const areaD = pathD + ` L ${points[points.length - 1].x} ${padding.top + chartH} L ${points[0].x} ${padding.top + chartH} Z`;
                    return React.createElement('g', { key: ki },
                        React.createElement('path', { d: areaD, fill: colors[ki % colors.length], opacity: '0.12' }),
                        React.createElement('path', { d: pathD, fill: 'none', stroke: colors[ki % colors.length], strokeWidth: '2' }),
                        points.filter((_, i) => i % dotEvery === 0 || i === n - 1).map((p, i) => React.createElement('circle', { key: i, cx: p.x, cy: p.y, r: dotEvery > 1 ? '2' : '3', fill: colors[ki % colors.length] })),
                        showLabelsFor === key && points.filter((_, i) => i % valLabelEvery === 0 || i === n - 1).map((p, i) => React.createElement('g', { key: 'lbl' + i },
                            React.createElement('rect', { x: p.x - 18, y: p.y - 24, width: 36, height: 18, rx: 9, fill: colors[ki % colors.length] }),
                            React.createElement('text', { x: p.x, y: p.y - 12, textAnchor: 'middle', fontSize: '10', fill: '#fff', fontWeight: 700 }, Math.round(p.val))
                        ))
                    );
                }),
                data.map((d, i) => (i % xLabelEvery === 0 || i === n - 1) ? React.createElement('text', { key: i, x: padding.left + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW), y: height - 8, textAnchor: 'middle', fontSize: '11', fill: '#666' }, d[xKey]) : null)
            );
        }

export { SimpleAreaChart };
