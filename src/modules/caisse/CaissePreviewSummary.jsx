/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaissePreviewSummary */
import { formatMAD } from '../finance/formatMAD.jsx';
import { CaissePerSheetTable } from './CaissePerSheetTable.jsx';
import { CaisseWarnings } from './CaisseWarnings.jsx';

// Résumé d'une prévisualisation dry-run pour un fichier.
        function CaissePreviewSummary({ s, fileName, multi }) {
            const projColor = s.solde.projete < 0 ? 'var(--red)' : 'var(--green)';
            return (
                <div style={{border:'1px solid var(--gray-200)',borderRadius:8,padding:12,marginTop:8,background:'#fafafa'}}>
                    {multi && <div style={{fontWeight:600,fontSize:11.5,marginBottom:6}}><i className="fa-solid fa-file-excel" style={{marginRight:5,color:'var(--green)'}}></i>{fileName}</div>}
                    <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:8,fontSize:11}}>
                        <span style={{padding:'3px 8px',borderRadius:20,background:'var(--gray-100)'}}>{s.parsed} lignes lues</span>
                        <span style={{padding:'3px 8px',borderRadius:20,background:'rgba(45,139,78,0.1)',color:'var(--green)'}}>{s.will_import} à importer</span>
                        {s.will_skip > 0 && <span style={{padding:'3px 8px',borderRadius:20,background:'var(--gray-100)',color:'var(--gray-500)'}}>{s.will_skip} déjà présentes</span>}
                    </div>
                    <div style={{display:'flex',gap:14,fontSize:11.5,marginBottom:10}}>
                        <div><span style={{color:'var(--gray-400)'}}>Entrées :</span> <strong style={{color:'var(--green)'}}>{formatMAD(s.totals.alimentations.montant)}</strong> <span style={{color:'var(--gray-400)'}}>({s.totals.alimentations.count})</span></div>
                        <div><span style={{color:'var(--gray-400)'}}>Sorties :</span> <strong style={{color:'var(--red)'}}>{formatMAD(s.totals.depenses.montant)}</strong> <span style={{color:'var(--gray-400)'}}>({s.totals.depenses.count})</span></div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:'white',borderRadius:6,border:'1px solid var(--gray-100)',fontSize:12}}>
                        <span style={{color:'var(--gray-400)'}}>Solde {formatMAD(s.solde.actuel)}</span>
                        <i className="fa-solid fa-arrow-right" style={{color:'var(--gray-300)'}}></i>
                        <strong style={{color:projColor,fontSize:13}}>{formatMAD(s.solde.projete)}</strong>
                        {s.solde.estimation && <span style={{fontSize:10,color:'var(--gold)'}} title="Estimation : des lignes existantes seront écrasées">(estimation)</span>}
                    </div>
                    <CaissePerSheetTable rows={s.per_sheet} />
                    <CaisseWarnings warnings={s.warnings} ignored={s.ignored_sheets} />
                    {s.sample && s.sample.length > 0 && (
                        <details style={{marginTop:8}}>
                            <summary style={{fontSize:11,cursor:'pointer',color:'var(--gray-500)'}}>Aperçu de {s.sample.length} ligne(s)</summary>
                            <div style={{maxHeight:150,overflowY:'auto',marginTop:6}}>
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                                    <tbody>
                                        {s.sample.map((r, i) => (
                                            <tr key={i} style={{borderTop:'1px solid var(--gray-100)'}}>
                                                <td style={{padding:'3px 5px',whiteSpace:'nowrap'}}>{r.date}</td>
                                                <td style={{padding:'3px 5px',color: r.type === 'alimentation' ? 'var(--green)' : 'var(--red)'}}>{r.type === 'alimentation' ? '↓' : '↑'}</td>
                                                <td style={{padding:'3px 5px',textAlign:'right',whiteSpace:'nowrap'}}>{formatMAD(r.montant)}</td>
                                                <td style={{padding:'3px 5px',color:'var(--gray-600)',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.description}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </details>
                    )}
                </div>
            );
        }

export { CaissePreviewSummary };
