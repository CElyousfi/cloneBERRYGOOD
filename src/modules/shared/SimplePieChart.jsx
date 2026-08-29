/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): SimplePieChart */


function SimplePieChart({ data, colors, size = 200 }) {
            if (!data || !data.length) return null;
            const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);
            const cx = size / 2, cy = size / 2, r = size * 0.35, ir = size * 0.22;
            let cumAngle = -Math.PI / 2;

            // État vide propre : pas de total exploitable → aucun <path> (évite des angles NaN)
            if (!(total > 0) || !isFinite(total)) {
                return React.createElement('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
                    React.createElement('circle', { cx, cy, r, fill: 'none', stroke: '#eee', strokeWidth: size * 0.13 }),
                    React.createElement('text', { x: cx, y: cy + 4, textAnchor: 'middle', fontSize: '12', fill: '#999' }, 'Aucune donnée')
                );
            }

            const slices = data.map((d, i) => {
                const value = Number(d.value) || 0;
                const angle = (value / total) * Math.PI * 2;
                const startAngle = cumAngle;
                cumAngle += angle;
                const endAngle = cumAngle;
                const largeArc = angle > Math.PI ? 1 : 0;
                const x1o = cx + r * Math.cos(startAngle), y1o = cy + r * Math.sin(startAngle);
                const x2o = cx + r * Math.cos(endAngle), y2o = cy + r * Math.sin(endAngle);
                const x1i = cx + ir * Math.cos(endAngle), y1i = cy + ir * Math.sin(endAngle);
                const x2i = cx + ir * Math.cos(startAngle), y2i = cy + ir * Math.sin(startAngle);
                const pathD = `M ${x1o} ${y1o} A ${r} ${r} 0 ${largeArc} 1 ${x2o} ${y2o} L ${x1i} ${y1i} A ${ir} ${ir} 0 ${largeArc} 0 ${x2i} ${y2i} Z`;
                const midAngle = startAngle + angle / 2;
                const lx = cx + (r + 20) * Math.cos(midAngle);
                const ly = cy + (r + 20) * Math.sin(midAngle);
                const pct = Math.round((value / total) * 100);
                return { pathD, lx, ly, pct, name: d.name, i };
            });

            return React.createElement('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
                slices.map((slice) => React.createElement('g', { key: slice.i },
                    React.createElement('path', { d: slice.pathD, fill: colors[slice.i % colors.length], opacity: '0.85', title: `${slice.name}: ${data[slice.i].value}` }),
                    slice.pct > 5 && React.createElement('text', { x: slice.lx, y: slice.ly, textAnchor: 'middle', fontSize: '10', fill: '#333', fontWeight: '600' }, `${slice.name} ${slice.pct}%`)
                ))
            );
        }

export { SimplePieChart };
