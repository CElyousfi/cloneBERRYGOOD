/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): FuelWeeklyChart */


function FuelWeeklyChart({ data, cardMapping }) {
            if (!data || !data.length) return React.createElement('div', {style:{textAlign:'center',color:'var(--gray-400)',padding:20}}, 'Pas de données hebdomadaires');
            const allWeeks = data[0].semaines.map(s => s.semaine);
            const cardColors = ['#E67E22', '#3498DB', '#2ECC71', '#9B59B6', '#E74C3C'];
            const maxLitres = Math.max(...data.flatMap(c => c.semaines.map(s => s.litres)));
            const padding = { top: 20, right: 20, bottom: 40, left: 50 };
            const W = 800, H = 260;
            const chartW = W - padding.left - padding.right;
            const chartH = H - padding.top - padding.bottom;

            // Show every 4th week label to avoid clutter
            const labelInterval = Math.max(1, Math.floor(allWeeks.length / 10));

            return React.createElement('div', null,
                React.createElement('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' },
                    // Grid
                    [0, 0.25, 0.5, 0.75, 1].map((tick, i) => {
                        const y = padding.top + chartH * (1 - tick);
                        return React.createElement('g', { key: 'g'+i },
                            React.createElement('line', { x1: padding.left, y1: y, x2: W - padding.right, y2: y, stroke: '#f0f0f0', strokeDasharray: '3 3' }),
                            React.createElement('text', { x: padding.left - 5, y: y + 4, textAnchor: 'end', fontSize: '9', fill: '#999' }, Math.round(maxLitres * tick) + 'L')
                        );
                    }),
                    // Lines per card
                    data.map((card, ci) => {
                        const pts = card.semaines.map((s, wi) => ({
                            x: padding.left + (wi / Math.max(1, allWeeks.length - 1)) * chartW,
                            y: padding.top + chartH - (s.litres / (maxLitres || 1)) * chartH,
                        }));
                        const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                        return React.createElement('g', { key: 'c'+ci },
                            React.createElement('path', { d: pathD, fill: 'none', stroke: cardColors[ci], strokeWidth: '2', opacity: '0.85' }),
                            pts.filter((_, i) => i === pts.length - 1).map((p, i) =>
                                React.createElement('circle', { key: 'dot'+i, cx: p.x, cy: p.y, r: '3', fill: cardColors[ci] })
                            )
                        );
                    }),
                    // X-axis labels
                    allWeeks.map((w, i) => i % labelInterval === 0 ?
                        React.createElement('text', { key: 'w'+i, x: padding.left + (i / Math.max(1, allWeeks.length - 1)) * chartW, y: H - 5, textAnchor: 'middle', fontSize: '8', fill: '#999', transform: `rotate(-30, ${padding.left + (i / Math.max(1, allWeeks.length - 1)) * chartW}, ${H - 10})` }, w.replace(/^\d{4}-/, ''))
                        : null
                    )
                ),
                // Legend
                React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, justifyContent: 'center' } },
                    data.map((card, ci) => {
                        const name = (cardMapping[card.carte] || {}).collaborateur || card.carte;
                        return React.createElement('span', { key: ci, style: { fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 } },
                            React.createElement('span', { style: { width: 12, height: 3, background: cardColors[ci], display: 'inline-block', borderRadius: 2 } }),
                            name
                        );
                    })
                )
            );
        }

export { FuelWeeklyChart };
