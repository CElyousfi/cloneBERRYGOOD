/* Module: shared | Déclaration(s): SimpleBarChart */


// ===================== CUSTOM SVG CHARTS =====================
        function SimpleBarChart({ data, dataKeys, colors, xKey, height = 250 }) {
            if (!data || !data.length) return null;
            const padding = { top: 20, right: 20, bottom: 30, left: 40 };
            const maxVal = Math.max(...data.flatMap(d => dataKeys.map(k => Number(d[k]) || 0)));
            const safeMax = (maxVal > 0 && isFinite(maxVal)) ? maxVal : 1;
            const barGroupWidth = 100 / data.length;
            const barWidth = barGroupWidth / (dataKeys.length + 1);

            return (
                React.createElement('svg', { width: '100%', height: height, viewBox: `0 0 600 ${height}`, preserveAspectRatio: 'xMidYMid meet' },
                    React.createElement('g', null,
                        [0, 0.25, 0.5, 0.75, 1].map((tick, i) => {
                            const y = padding.top + (height - padding.top - padding.bottom) * (1 - tick);
                            return React.createElement('g', { key: i },
                                React.createElement('line', { x1: padding.left, y1: y, x2: 600 - padding.right, y2: y, stroke: '#f0f0f0', strokeDasharray: '3 3' }),
                                React.createElement('text', { x: padding.left - 5, y: y + 4, textAnchor: 'end', fontSize: '10', fill: '#999' }, Math.round(safeMax * tick))
                            );
                        }),
                        data.map((d, di) => {
                            const groupX = padding.left + (di / data.length) * (600 - padding.left - padding.right);
                            const groupW = (600 - padding.left - padding.right) / data.length;
                            return React.createElement('g', { key: di },
                                dataKeys.map((key, ki) => {
                                    const val = Number(d[key]) || 0;
                                    const barH = Math.max(0, (val / safeMax) * (height - padding.top - padding.bottom));
                                    const bw = groupW / (dataKeys.length + 1);
                                    const bx = groupX + (ki + 0.5) * bw;
                                    const by = padding.top + (height - padding.top - padding.bottom) - barH;
                                    return React.createElement('rect', { key: ki, x: bx, y: by, width: bw * 0.8, height: barH, fill: colors[ki % colors.length], rx: '4', opacity: '0.85', title: `${key}: ${val}` });
                                }),
                                React.createElement('text', { x: groupX + groupW / 2, y: height - 8, textAnchor: 'middle', fontSize: '11', fill: '#666' }, d[xKey])
                            );
                        })
                    )
                )
            );
        }

export { SimpleBarChart };
