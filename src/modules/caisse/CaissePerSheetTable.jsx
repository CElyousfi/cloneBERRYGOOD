/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaissePerSheetTable */
import { formatMAD } from '../finance/formatMAD.jsx';

// Tableau "par feuille" partagé entre la preview et le rapport final.
        function CaissePerSheetTable({ rows }) {
            if (!rows || !rows.length) return null;
            return (
                <div style={{marginTop:8,maxHeight:170,overflowY:'auto',border:'1px solid var(--gray-100)',borderRadius:6}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:10.5}}>
                        <thead>
                            <tr style={{background:'var(--gray-100)',position:'sticky',top:0}}>
                                <th style={{textAlign:'left',padding:'4px 6px'}}>Feuille</th>
                                <th style={{textAlign:'right',padding:'4px 6px'}}>Lignes</th>
                                <th style={{textAlign:'right',padding:'4px 6px',color:'var(--green)'}}>Entrées</th>
                                <th style={{textAlign:'right',padding:'4px 6px',color:'var(--red)'}}>Sorties</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((s, i) => (
                                <tr key={s.key + i} style={{borderTop:'1px solid var(--gray-100)'}}>
                                    <td style={{padding:'4px 6px'}}>{s.label}{s.warnings > 0 && <i className="fa-solid fa-triangle-exclamation" title={s.warnings + ' alerte(s)'} style={{marginLeft:5,color:'var(--gold)',fontSize:9}}></i>}</td>
                                    <td style={{textAlign:'right',padding:'4px 6px'}}>{s.rows_parsed}</td>
                                    <td style={{textAlign:'right',padding:'4px 6px',color:'var(--green)'}}>{formatMAD(s.montant_in)}</td>
                                    <td style={{textAlign:'right',padding:'4px 6px',color:'var(--red)'}}>{formatMAD(s.montant_out)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        }

export { CaissePerSheetTable };
