/* Module: agronomie | Déclaration(s): ProductivityTreatmentsTable */


function ProductivityTreatmentsTable({ treatments, myFarm, onSelectTreatment, selectedTitle }) {
            if (!treatments || treatments.length === 0) {
                return <div style={{ padding: 20, background: '#fff', borderRadius: 8, textAlign: 'center', color: 'var(--gray-500)' }}>Aucun traitement concerné par les filtres actuels.</div>;
            }
            const cell = (stats, color) => {
                if (!stats) return <td style={{ padding: 8, color: 'var(--gray-400)', textAlign: 'center' }}>—</td>;
                const isLast = stats.rank === stats.rankTotal;
                const bg = stats.inTop25 ? '#e7f5e7' : isLast ? '#fdecea' : 'transparent';
                return (
                    <td style={{ padding: 8, background: bg, textAlign: 'center', fontSize: 13 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                            <span style={{ fontWeight: 700 }}>{stats.yield.toLocaleString('fr-FR')}</span>
                            <span style={{ padding: '2px 8px', borderRadius: 12, background: color, color: '#fff', fontSize: 12, fontWeight: 700, minWidth: 36, textAlign: 'center' }}>{stats.rank}/{stats.rankTotal}</span>
                            {stats.inTop25 && <i className="fa-solid fa-trophy" style={{ color: '#f1c40f', fontSize: 12 }} title="Top 25%"></i>}
                        </div>
                        {stats.vsAveragePct !== null && (
                            <div style={{ fontSize: 11, color: stats.vsAveragePct >= 0 ? '#2ecc71' : '#e74c3c', marginTop: 2 }}>
                                {stats.vsAveragePct >= 0 ? '+' : ''}{stats.vsAveragePct}% vs moy
                            </div>
                        )}
                    </td>
                );
            };
            return (
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--gray-200)', overflow: 'auto', marginBottom: 16 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead style={{ background: 'var(--gray-100, #f1f3f5)', position: 'sticky', top: 0 }}>
                            <tr>
                                <th style={{ padding: 10, textAlign: 'left' }}>Traitement</th>
                                <th style={{ padding: 10, textAlign: 'left' }}>Catégorie</th>
                                <th style={{ padding: 10, textAlign: 'right' }}>Moyenne</th>
                                <th style={{ padding: 10, textAlign: 'right' }}>Seuil Top 25 %</th>
                                {(!myFarm || myFarm === 'F1') && <th style={{ padding: 10, textAlign: 'center', background: '#fdecea' }}>F1 (172)</th>}
                                {(!myFarm || myFarm === 'F5') && <th style={{ padding: 10, textAlign: 'center', background: '#eaf3fd' }}>F5 (195)</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {treatments.map((t, i) => (
                                <tr key={t.title + i} onClick={() => onSelectTreatment(t.title)}
                                    style={{
                                        cursor: 'pointer', borderTop: '1px solid var(--gray-200)',
                                        background: selectedTitle === t.title ? '#fff8e6' : (i % 2 === 0 ? '#fff' : '#fafbfc'),
                                    }}>
                                    <td style={{ padding: 8, fontWeight: 600 }}>{t.title}</td>
                                    <td style={{ padding: 8, fontSize: 12, color: 'var(--gray-600)', textTransform: 'capitalize' }}>{t.category || '—'}</td>
                                    <td style={{ padding: 8, textAlign: 'right' }}>{t.average ? t.average.toLocaleString('fr-FR') : '—'} <span style={{ color: 'var(--gray-500)', fontSize: 11 }}>{t.unit}</span></td>
                                    <td style={{ padding: 8, textAlign: 'right', color: '#e67e22', fontWeight: 600 }}>{t.top25Threshold ? t.top25Threshold.toLocaleString('fr-FR') : '—'}</td>
                                    {(!myFarm || myFarm === 'F1') && cell(t.f1, '#e74c3c')}
                                    {(!myFarm || myFarm === 'F5') && cell(t.f5, '#3498db')}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        }

export { ProductivityTreatmentsTable };
