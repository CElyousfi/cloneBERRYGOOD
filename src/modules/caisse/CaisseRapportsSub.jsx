/* Module: caisse | Déclaration(s): CaisseRapportsSub */
import { formatMAD } from '../finance/formatMAD.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { getCaisseColor } from './getCaisseColor.jsx';

// ---- Rapports Sub ----
        function CaisseRapportsSub({ caisses }) {
            const [loading, setLoading] = useState(false);
            const [reportData, setReportData] = useState(null);
            const [weekStart, setWeekStart] = useState(() => {
                const now = new Date();
                const dayOfWeek = now.getDay();
                const daysSinceSat = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
                const sat = new Date(now);
                sat.setDate(now.getDate() - daysSinceSat);
                return sat.toISOString().slice(0, 10);
            });

            const loadReport = () => {
                setLoading(true);
                fetch('/api/caisse?action=weekly-report&week_start=' + weekStart).then(r => r.json()).then(json => {
                    if (json.success) setReportData(json);
                }).catch(() => {}).finally(() => setLoading(false));
            };
            React.useEffect(() => { loadReport(); }, [weekStart]);

            const exportPDF = () => {
                if (!reportData || !window.jspdf) return alert('jsPDF non disponible');
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF();
                doc.setFontSize(16);
                doc.text('Rapport Hebdomadaire Caisse', 14, 20);
                doc.setFontSize(10);
                doc.text(`Semaine du ${reportData.weekStart} au ${reportData.weekEnd}`, 14, 28);
                let y = 40;
                (reportData.report || []).forEach(r => {
                    if (y > 260) { doc.addPage(); y = 20; }
                    doc.setFontSize(12);
                    doc.text(r.nom, 14, y); y += 7;
                    doc.setFontSize(9);
                    doc.text(`Solde ouverture: ${formatMAD(r.solde_ouverture)}`, 20, y); y += 5;
                    doc.text(`Alimentations: +${formatMAD(r.alimentations)}`, 20, y); y += 5;
                    doc.text(`Dépenses: -${formatMAD(r.depenses)}`, 20, y); y += 5;
                    doc.text(`Sorties: -${formatMAD(r.sorties)}`, 20, y); y += 5;
                    doc.text(`Transferts entrants: +${formatMAD(r.transfers_in)}`, 20, y); y += 5;
                    doc.text(`Transferts sortants: -${formatMAD(r.transfers_out)}`, 20, y); y += 5;
                    doc.setFontSize(10);
                    doc.text(`Solde clôture: ${formatMAD(r.solde_cloture)}`, 20, y); y += 12;
                });
                doc.save(`Rapport_Caisse_${weekStart}.pdf`);
            };

            // Generate week options (last 12 weeks)
            const weekOptions = [];
            for (let i = 0; i < 12; i++) {
                const d = new Date();
                const dayOfWeek = d.getDay();
                const daysSinceSat = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
                d.setDate(d.getDate() - daysSinceSat - (i * 7));
                const endDate = new Date(d);
                endDate.setDate(d.getDate() + 6);
                weekOptions.push({ value: d.toISOString().slice(0, 10), label: `${d.toLocaleDateString('fr-FR')} → ${endDate.toLocaleDateString('fr-FR')}` });
            }

            return (
                <div>
                    <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:20,flexWrap:'wrap'}}>
                        <select value={weekStart} onChange={e=>setWeekStart(e.target.value)} style={{padding:'8px 14px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}}>
                            {weekOptions.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                        </select>
                        <button onClick={exportPDF} disabled={!reportData} style={{padding:'8px 14px',borderRadius:8,background:'var(--red)',color:'white',border:'none',cursor:'pointer',fontSize:12,fontWeight:600}}>
                            <i className="fa-solid fa-file-pdf" style={{marginRight:4}}></i>Exporter PDF
                        </button>
                    </div>

                    {loading ? (
                        <div style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:20,color:'var(--berry)'}}></i></div>
                    ) : reportData ? (
                        <div style={{display:'flex',flexDirection:'column',gap:16}}>
                            {(reportData.report || []).map(r => (
                                <div key={r.caisse_id} style={{background:'white',borderRadius:12,border:'1px solid var(--gray-200)',overflow:'hidden'}}>
                                    <div style={{padding:'12px 20px',background:'var(--berry-pale)',borderBottom:'1px solid var(--gray-200)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                        <span style={{fontWeight:600,fontSize:14,color:'var(--berry)'}}>
                                            <i className={`fa-solid ${getCaisseColor(r.caisse_id).icon}`} style={{marginRight:8}}></i>{r.nom}
                                        </span>
                                        <span style={{fontSize:11,color:'var(--gray-400)'}}>{r.nb_transactions} transaction(s)</span>
                                    </div>
                                    <div style={{padding:16}}>
                                        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12}}>
                                            <div style={{padding:12,background:'var(--gray-100)',borderRadius:8,textAlign:'center'}}>
                                                <div style={{fontSize:10,color:'var(--gray-400)',textTransform:'uppercase',marginBottom:4}}>Solde Ouverture</div>
                                                <div style={{fontSize:16,fontWeight:700}}>{formatMAD(r.solde_ouverture)}</div>
                                            </div>
                                            <div style={{padding:12,background:'rgba(45,139,78,0.06)',borderRadius:8,textAlign:'center'}}>
                                                <div style={{fontSize:10,color:'var(--green)',textTransform:'uppercase',marginBottom:4}}>Alimentations</div>
                                                <div style={{fontSize:16,fontWeight:700,color:'var(--green)'}}>+{formatMAD(r.alimentations)}</div>
                                            </div>
                                            <div style={{padding:12,background:'rgba(231,76,60,0.06)',borderRadius:8,textAlign:'center'}}>
                                                <div style={{fontSize:10,color:'var(--red)',textTransform:'uppercase',marginBottom:4}}>Dépenses</div>
                                                <div style={{fontSize:16,fontWeight:700,color:'var(--red)'}}>-{formatMAD(r.depenses)}</div>
                                            </div>
                                            <div style={{padding:12,background:'rgba(52,152,219,0.06)',borderRadius:8,textAlign:'center'}}>
                                                <div style={{fontSize:10,color:'var(--blue)',textTransform:'uppercase',marginBottom:4}}>Transferts</div>
                                                <div style={{fontSize:14,fontWeight:600}}>
                                                    <span style={{color:'var(--green)'}}>+{formatMAD(r.transfers_in)}</span>{' / '}
                                                    <span style={{color:'var(--red)'}}>-{formatMAD(r.transfers_out)}</span>
                                                </div>
                                            </div>
                                            <div style={{padding:12,background:'var(--berry-pale)',borderRadius:8,textAlign:'center'}}>
                                                <div style={{fontSize:10,color:'var(--berry)',textTransform:'uppercase',marginBottom:4}}>Solde Clôture</div>
                                                <div style={{fontSize:18,fontWeight:700,color:'var(--berry)'}}>{formatMAD(r.solde_cloture)}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Grand total row */}
                            {reportData.report && reportData.report.length > 1 && (() => {
                                const totals = reportData.report.reduce((acc, r) => ({
                                    solde_ouverture: acc.solde_ouverture + r.solde_ouverture,
                                    alimentations: acc.alimentations + r.alimentations,
                                    depenses: acc.depenses + r.depenses,
                                    solde_cloture: acc.solde_cloture + r.solde_cloture,
                                }), { solde_ouverture: 0, alimentations: 0, depenses: 0, solde_cloture: 0 });
                                return (
                                    <div style={{padding:16,background:'linear-gradient(135deg, var(--berry) 0%, var(--berry-light) 100%)',borderRadius:12,color:'white'}}>
                                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:16}}>
                                            <div style={{fontSize:14,fontWeight:600}}>
                                                <i className="fa-solid fa-calculator" style={{marginRight:8}}></i>TOTAL TOUTES CAISSES
                                            </div>
                                            <div style={{display:'flex',gap:24,textAlign:'center'}}>
                                                <div><div style={{fontSize:10,opacity:0.7}}>Ouverture</div><div style={{fontWeight:700}}>{formatMAD(totals.solde_ouverture)}</div></div>
                                                <div><div style={{fontSize:10,opacity:0.7}}>Alimentations</div><div style={{fontWeight:700,color:'#81ecec'}}>+{formatMAD(totals.alimentations)}</div></div>
                                                <div><div style={{fontSize:10,opacity:0.7}}>Dépenses</div><div style={{fontWeight:700,color:'#fab1a0'}}>-{formatMAD(totals.depenses)}</div></div>
                                                <div><div style={{fontSize:10,opacity:0.7}}>Clôture</div><div style={{fontWeight:700,fontSize:18}}>{formatMAD(totals.solde_cloture)}</div></div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    ) : null}
                </div>
            );
        }

export { CaisseRapportsSub };
