/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaisseImportSub */
import { CAISSE_EXCEL_FORMATS } from './CAISSE_EXCEL_FORMATS.jsx';
import { CaisseImportCard } from './CaisseImportCard.jsx';
import { CaisseImportUnsupportedCard } from './CaisseImportUnsupportedCard.jsx';
import { getCaisseColor } from './getCaisseColor.jsx';

function CaisseImportSub({ caisses, onDone }) {
            return (
                <div>
                    <div style={{padding:14,background:'rgba(212,168,71,0.08)',border:'1px solid rgba(212,168,71,0.3)',borderRadius:10,marginBottom:20,fontSize:12.5,color:'var(--gray-800)'}}>
                        <i className="fa-solid fa-info-circle" style={{color:'var(--gold)',marginRight:8}}></i>
                        <strong>Mise à jour depuis Excel</strong> — Déposez le(s) fichier(s) de chaque caisse, cliquez sur <em>Prévisualiser</em> pour contrôler ce qui sera importé (totaux, solde projeté, alertes), puis <em>Confirmer l'import</em>. L'import est <strong>idempotent</strong> : les lignes déjà importées sont ignorées, sauf si vous cochez « Écraser les existants ».
                    </div>

                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(380px,1fr))',gap:14}}>
                        {caisses.map(c => {
                            const fmt = CAISSE_EXCEL_FORMATS[c.id];
                            const cc = getCaisseColor(c.id);
                            return fmt
                                ? <CaisseImportCard key={c.id} caisse={c} fmt={fmt} cc={cc} onDone={onDone} />
                                : <CaisseImportUnsupportedCard key={c.id} caisse={c} cc={cc} />;
                        })}
                    </div>
                </div>
            );
        }

export { CaisseImportSub };
