/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): FarmBanner */
import { FARM_NAMES } from './FARM_NAMES.jsx';
import { generateMockData } from './generateMockData.jsx';

// ===================== COMPONENTS =====================

        // Farm Banner Component
        function FarmBanner({ farm, chefName, effectifData }) {
            const farmInfo = effectifData || (generateMockData(farm).effectif[farm]) || { horsRecolte: 0, recolte: 0, postesFixes: 0 };
            const totalEffectif = (farmInfo.horsRecolte || 0) + (farmInfo.recolte || 0) + (farmInfo.postesFixes || 0);

            const farmClass = farm === 'F1' ? 'f1' : (farm === 'F5' ? 'f5' : 'avocatier');
            const farmIcon = farm === 'Avocatier' ? 'fa-tree' : 'fa-leaf';

            return (
                <div className={`farm-banner ${farmClass}`}>
                    <div className="farm-banner-left">
                        <div className="farm-banner-icon">
                            <i className={`fa-solid ${farmIcon}`}></i>
                        </div>
                        <div className="farm-banner-text">
                            <h2>{FARM_NAMES[farm]}</h2>
                            <p>Chef: {chefName} | Aujourd'hui</p>
                        </div>
                    </div>
                    <div className="farm-banner-stats">
                        <div className="farm-banner-stat">
                            <div className="value">{totalEffectif}</div>
                            <div className="label">Effectif Total</div>
                        </div>
                        <div className="farm-banner-stat">
                            <div className="value">{farmInfo.recolte}</div>
                            <div className="label">Récolte</div>
                        </div>
                        <div className="farm-banner-stat">
                            <div className="value">{farmInfo.horsRecolte}</div>
                            <div className="label">Hors Récolte</div>
                        </div>
                        <div className="farm-banner-stat">
                            <div className="value">{farmInfo.postesFixes}</div>
                            <div className="label">Ouvrier Avocatier</div>
                        </div>
                    </div>
                </div>
            );
        }

export { FarmBanner };
