/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaisseImportReportView */
import { formatMAD } from '../finance/formatMAD.jsx';
import { CaissePerSheetTable } from './CaissePerSheetTable.jsx';
import { CaisseWarnings } from './CaisseWarnings.jsx';

// Rapport final d'un import réel pour un fichier.
        function CaisseImportReportView({ r, fileName, multi }) {
            return (
                <div style={{border:'1px solid rgba(45,139,78,0.3)',borderRadius:8,padding:12,marginTop:8,background:'rgba(45,139,78,0.05)'}}>
                    {multi && <div style={{fontWeight:600,fontSize:11.5,marginBottom:6}}><i className="fa-solid fa-file-excel" style={{marginRight:5,color:'var(--green)'}}></i>{fileName}</div>}
                    <div style={{fontWeight:600,fontSize:12,color:'var(--green)',marginBottom:4}}><i className="fa-solid fa-check" style={{marginRight:5}}></i>Import réussi</div>
                    <div style={{fontSize:11.5}}>{r.imported} importée(s), {r.skipped} ignorée(s) sur {r.parsed} lue(s)</div>
                    <div style={{fontSize:11.5,marginTop:3,color:'var(--gray-600)'}}>Solde actuel : <strong>{formatMAD(r.solde_actuel)}</strong></div>
                    <CaissePerSheetTable rows={r.per_sheet} />
                    <CaisseWarnings warnings={r.warnings} ignored={r.ignored_sheets} />
                </div>
            );
        }

export { CaisseImportReportView };
