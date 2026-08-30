/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: rh | Déclaration(s): WorkerLink */
import { WorkerDetailContext } from './WorkerDetailContext.jsx';

// ===================== WORKER DETAIL SHARED COMPONENTS =====================
        function WorkerLink({ matricule, nom, children, style: extraStyle }) {
            const ctx = React.useContext(WorkerDetailContext);
            if (!ctx) return <span>{children || nom || matricule}</span>;
            return (
                <span onClick={(e) => { e.stopPropagation(); ctx.open(matricule); }}
                    style={{cursor:'pointer', color:'var(--berry)', fontWeight:600, borderBottom:'1px dashed var(--berry)', ...extraStyle}}
                    title={`Voir fiche ${matricule}`}>
                    {children || nom || matricule}
                </span>
            );
        }

export { WorkerLink };
