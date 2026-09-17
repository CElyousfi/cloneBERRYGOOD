/* Module: agronomie | Déclaration(s): ProductivityTreatmentDetail */
import { ProductivityHistogramSvg } from './ProductivityHistogramSvg.jsx';
import { ProductivityTrendSvg } from './ProductivityTrendSvg.jsx';

function ProductivityTreatmentDetail({ treatment, trendSeries, onClose }) {
            if (!treatment) return null;
            return (
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--gray-200)', padding: 16, marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <div>
                            <h3 style={{ margin: 0 }}>{treatment.title}</h3>
                            <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>
                                {treatment.totalGrowers} growers · Moyenne {treatment.average?.toLocaleString('fr-FR')} {treatment.unit} · Seuil top 25 % : <strong style={{ color: '#e67e22' }}>{treatment.top25Threshold?.toLocaleString('fr-FR')}</strong>
                            </div>
                        </div>
                        <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--gray-500)' }}><i className="fa-solid fa-xmark"></i></button>
                    </div>
                    <ProductivityHistogramSvg treatment={treatment} />
                    {trendSeries && trendSeries.length > 1 && (
                        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--gray-200)' }}>
                            <h4 style={{ margin: '0 0 12px 0', color: 'var(--gray-700)' }}>
                                <i className="fa-solid fa-chart-line" style={{ marginRight: 6 }}></i>
                                Évolution hebdomadaire ({trendSeries.length} semaines)
                            </h4>
                            <ProductivityTrendSvg series={trendSeries} unit={treatment.unit} />
                        </div>
                    )}
                </div>
            );
        }

export { ProductivityTreatmentDetail };
