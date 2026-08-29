/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaisseImportUnsupportedCard */
import { formatMAD } from '../finance/formatMAD.jsx';

// Carte d'une caisse sans format Excel configuré (ex. Marché Local F1/F5).
        function CaisseImportUnsupportedCard({ caisse, cc }) {
            return (
                <div style={{background:'white',borderRadius:12,border:'1px dashed var(--gray-200)',padding:16,position:'relative',overflow:'hidden',opacity:0.85}}>
                    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                        <div style={{width:36,height:36,borderRadius:10,background:cc.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>
                            <i className={`fa-solid ${cc.icon}`} style={{color:cc.color,fontSize:14}}></i>
                        </div>
                        <div>
                            <div style={{fontWeight:600,fontSize:13}}>{caisse.nom}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)'}}>{formatMAD(caisse.solde_actuel)}</div>
                        </div>
                    </div>
                    <div style={{padding:12,background:'var(--gray-100)',borderRadius:8,fontSize:11,color:'var(--gray-600)',lineHeight:1.5}}>
                        <i className="fa-solid fa-circle-info" style={{marginRight:6,color:'var(--gray-400)'}}></i>
                        Aucun modèle Excel défini pour cette caisse. Les données proviennent de la saisie manuelle.
                        <div style={{marginTop:6,color:'var(--gray-400)',fontSize:10.5}}>Pour activer l'import, fournissez un fichier Excel modèle à l'équipe Smart BERRY.</div>
                    </div>
                </div>
            );
        }

export { CaisseImportUnsupportedCard };
