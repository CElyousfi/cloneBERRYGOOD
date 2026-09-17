/* Module: agronomie | Déclaration(s): ProductivityFarmSummaryBanner */


function ProductivityFarmSummaryBanner({ report, myFarm, farmFilter, onFarmFilter }) {
            const summary = report.summary || { f1: { present: 0, inTop25: 0, avgRank: null, avgRankTotal: null }, f5: { present: 0, inTop25: 0, avgRank: null, avgRankTotal: null } };
            const card = (farmKey, label, color) => {
                const s = summary[farmKey] || { present: 0, inTop25: 0, avgRank: null, avgRankTotal: null };
                const pctTop25 = s.present > 0 ? Math.round((s.inTop25 / s.present) * 100) : 0;
                const bgColor = pctTop25 >= 75 ? '#e7f5e7' : pctTop25 >= 25 ? '#fff8e6' : '#fdecea';
                const accentColor = pctTop25 >= 75 ? '#2ecc71' : pctTop25 >= 25 ? '#f39c12' : '#e74c3c';
                const isSelected = farmFilter === farmKey.toUpperCase() || (myFarm && myFarm === farmKey.toUpperCase());
                return (
                    <div onClick={() => onFarmFilter(farmFilter === farmKey.toUpperCase() ? 'both' : farmKey.toUpperCase())}
                        style={{
                            flex: 1, minWidth: 240, padding: 16, borderRadius: 10,
                            border: '2px solid ' + (isSelected ? color : 'transparent'),
                            background: bgColor, cursor: 'pointer', position: 'relative',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <div style={{ width: 12, height: 12, background: color, borderRadius: 3 }}></div>
                            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--gray-800)' }}>{label}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--gray-600)' }}>Top 25 %</div>
                                <div style={{ fontSize: 24, fontWeight: 800, color: accentColor }}>
                                    {s.inTop25}/{s.present} <span style={{ fontSize: 14, color: 'var(--gray-600)' }}>({pctTop25}%)</span>
                                </div>
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--gray-600)' }}>Rang moyen</div>
                                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--gray-700)' }}>
                                    {s.avgRank !== null ? s.avgRank.toFixed(1) : '—'}
                                    {s.avgRankTotal !== null && <span style={{ fontSize: 14, color: 'var(--gray-500)' }}>/{Math.round(s.avgRankTotal)}</span>}
                                </div>
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--gray-600)' }}>Traitements</div>
                                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--gray-700)' }}>{s.present}</div>
                            </div>
                        </div>
                    </div>
                );
            };
            return (
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                    {(!myFarm || myFarm === 'F1') && card('f1', 'F1 — Framboise Larache (172)', '#e74c3c')}
                    {(!myFarm || myFarm === 'F5') && card('f5', 'F5 — Myrtille/Framboise Laaouamra (195)', '#3498db')}
                </div>
            );
        }

export { ProductivityFarmSummaryBanner };
