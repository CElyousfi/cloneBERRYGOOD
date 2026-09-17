/* Module: finance | Déclaration(s): FuelKmChart */


function FuelKmChart({ suiviKm }) {
            if (!suiviKm || !suiviKm.points || suiviKm.points.length < 2) return null;
            const pts = suiviKm.points;
            const padding = { top: 20, right: 20, bottom: 30, left: 50 };
            const W = 600, H = 200;
            const chartW = W - padding.left - padding.right;
            const chartH = H - padding.top - padding.bottom;
            const maxVal = Math.max(...pts.map(p => p.l100km)) * 1.15;
            const minVal = Math.min(...pts.map(p => p.l100km)) * 0.85;
            const range = maxVal - minVal || 1;

            const points = pts.map((p, i) => ({
                x: padding.left + (i / (pts.length - 1)) * chartW,
                y: padding.top + chartH - ((p.l100km - minVal) / range) * chartH,
                val: p.l100km,
                date: p.date,
            }));
            const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            const avgY = padding.top + chartH - ((suiviKm.moyenneL100 - minVal) / range) * chartH;
            const labelInterval = Math.max(1, Math.floor(pts.length / 8));

            return React.createElement('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' },
                // Grid
                [0, 0.25, 0.5, 0.75, 1].map((tick, i) => {
                    const y = padding.top + chartH * (1 - tick);
                    const val = (minVal + range * tick).toFixed(1);
                    return React.createElement('g', { key: i },
                        React.createElement('line', { x1: padding.left, y1: y, x2: W - padding.right, y2: y, stroke: '#f0f0f0', strokeDasharray: '3 3' }),
                        React.createElement('text', { x: padding.left - 5, y: y + 4, textAnchor: 'end', fontSize: '9', fill: '#999' }, val)
                    );
                }),
                // Average line
                React.createElement('line', { x1: padding.left, y1: avgY, x2: W - padding.right, y2: avgY, stroke: '#E74C3C', strokeWidth: '1', strokeDasharray: '6 3' }),
                React.createElement('text', { x: W - padding.right + 2, y: avgY + 3, fontSize: '9', fill: '#E74C3C' }, 'moy'),
                // Area
                React.createElement('path', { d: pathD + ` L ${points[points.length-1].x} ${padding.top + chartH} L ${points[0].x} ${padding.top + chartH} Z`, fill: '#3498DB', opacity: '0.1' }),
                // Line
                React.createElement('path', { d: pathD, fill: 'none', stroke: '#3498DB', strokeWidth: '2' }),
                // Dots
                points.map((p, i) => React.createElement('circle', { key: i, cx: p.x, cy: p.y, r: '3', fill: '#3498DB' })),
                // X labels
                points.map((p, i) => i % labelInterval === 0 ? React.createElement('text', { key: 'l'+i, x: p.x, y: H - 5, textAnchor: 'middle', fontSize: '8', fill: '#999' }, pts[i].date.split(' ')[0].substring(0, 5)) : null)
            );
        }

export { FuelKmChart };
