/* Module: agronomie | Déclaration(s): ProductivityTrendSvg */


function ProductivityTrendSvg({ series, unit }) {
            if (!series || series.length === 0) return null;
            const W = 760, H = 280;
            const padL = 55, padR = 110, padT = 20, padB = 40;
            const weeks = series.map(s => s.week);
            const yields = [];
            series.forEach(s => {
                if (s.f1) yields.push(s.f1.yield);
                if (s.f5) yields.push(s.f5.yield);
                if (s.average) yields.push(s.average);
                if (s.top25Threshold) yields.push(s.top25Threshold);
            });
            const maxY = Math.max(...yields) * 1.1;
            const wMin = Math.min(...weeks), wMax = Math.max(...weeks);
            const xScale = (w) => padL + ((w - wMin) / Math.max(1, wMax - wMin)) * (W - padL - padR);
            const yScale = (y) => H - padB - (y / maxY) * (H - padT - padB);
            const lineFor = (getter, color, strokeDash) => {
                const pts = series.map(s => { const y = getter(s); return y == null ? null : { x: xScale(s.week), y: yScale(y) }; }).filter(Boolean);
                if (pts.length === 0) return null;
                const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ');
                return (
                    <g>
                        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeDasharray={strokeDash || 'none'} />
                        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={color} />)}
                    </g>
                );
            };
            const ticks = [];
            const tickStep = Math.pow(10, Math.floor(Math.log10(maxY))) / 2;
            for (let t = 0; t <= maxY; t += tickStep) ticks.push(t);
            return (
                <div style={{ width: '100%', overflowX: 'auto', background: '#fafbfc', borderRadius: 6, padding: 8 }}>
                    <svg width={W} height={H}>
                        {ticks.map((t, i) => (
                            <g key={i}>
                                <line x1={padL} y1={yScale(t)} x2={W - padR} y2={yScale(t)} stroke="#e9ecef" />
                                <text x={padL - 6} y={yScale(t) + 4} textAnchor="end" fontSize="10" fill="#6c757d">{Math.round(t).toLocaleString('fr-FR')}</text>
                            </g>
                        ))}
                        {weeks.map((w, i) => (
                            <text key={i} x={xScale(w)} y={H - padB + 16} textAnchor="middle" fontSize="11" fill="#6c757d">W{w}</text>
                        ))}
                        {lineFor(s => s.average, '#9b59b6', '4 2')}
                        {lineFor(s => s.top25Threshold, '#e67e22', '6 3')}
                        {lineFor(s => s.f1 ? s.f1.yield : null, '#e74c3c', null)}
                        {lineFor(s => s.f5 ? s.f5.yield : null, '#3498db', null)}
                        <g transform={'translate(' + (W - padR + 8) + ', ' + (padT + 10) + ')'}>
                            <g><rect width="10" height="10" fill="#e74c3c" /><text x="14" y="9" fontSize="11">F1 (172)</text></g>
                            <g transform="translate(0, 18)"><rect width="10" height="10" fill="#3498db" /><text x="14" y="9" fontSize="11">F5 (195)</text></g>
                            <g transform="translate(0, 36)"><line x1="0" y1="5" x2="10" y2="5" stroke="#9b59b6" strokeWidth="2" strokeDasharray="4 2" /><text x="14" y="9" fontSize="11">Moyenne</text></g>
                            <g transform="translate(0, 54)"><line x1="0" y1="5" x2="10" y2="5" stroke="#e67e22" strokeWidth="2" strokeDasharray="6 3" /><text x="14" y="9" fontSize="11">Top 25 %</text></g>
                        </g>
                        <text x={padL} y={padT - 5} fontSize="11" fill="#6c757d">{unit || ''}</text>
                    </svg>
                </div>
            );
        }

export { ProductivityTrendSvg };
