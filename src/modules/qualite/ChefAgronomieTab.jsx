/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: qualite | Déclaration(s): ChefAgronomieTab */
import { AgroAnalyseFoliairesTab } from '../agronomie/AgroAnalyseFoliairesTab.jsx';
import { AgroFarmroadTab } from '../agronomie/AgroFarmroadTab.jsx';
import { AgroForecastTab } from '../agronomie/AgroForecastTab.jsx';
import { AgroIrrigationTab } from '../agronomie/AgroIrrigationTab.jsx';
import { AgroPhytoTab } from '../agronomie/AgroPhytoTab.jsx';
import { AgroSurveillanceTab } from '../agronomie/AgroSurveillanceTab.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { ClimatProductionTab } from '../technique/ClimatProductionTab.jsx';
import { GDDTrackingTab } from '../technique/GDDTrackingTab.jsx';
import { IrrigationRecoTab } from '../technique/IrrigationRecoTab.jsx';
import { MeteoTab } from '../technique/MeteoTab.jsx';

function ChefAgronomieTab({ data, farmFilter, getAlias, getFerme, currentProfile, profileData, userProfile }) {
            const [subTab, setSubTab] = useState('meteo');
            const tabs = [
                { id: 'meteo', label: 'Météo', icon: 'fa-cloud-sun' },
                { id: 'farmroad', label: 'FarmRoad', icon: 'fa-tower-broadcast' },
                { id: 'forecast', label: 'Forecast Int\u00E9rieur', icon: 'fa-wand-magic-sparkles' },
                { id: 'gdd', label: 'Maturation GDD', icon: 'fa-seedling' },
                { id: 'climat_prod', label: 'Climat-Production', icon: 'fa-chart-line' },
                { id: 'phyto', label: 'Phytosanitaire', icon: 'fa-bug' },
                { id: 'ferti', label: 'Programme Ferti', icon: 'fa-droplet' },
                { id: 'foliaire', label: 'Analyses Foliaires', icon: 'fa-flask-vial' },
                { id: 'surveillance', label: 'Surveillance Agro', icon: 'fa-camera' },
                { id: 'irrigation', label: 'Irrigation', icon: 'fa-faucet-drip' },
            ];
            return (
                <div className="fade-in">
                    <div className="chip-group" style={{marginBottom:16}}>
                        {tabs.map(t => (
                            <button key={t.id} className={`chip c-berry ${subTab===t.id ? 'active' : ''}`} onClick={() => setSubTab(t.id)} style={{padding:'8px 18px',fontSize:12.5}}>
                                <i className={'fa-solid ' + t.icon} style={{marginRight:4}}></i> {t.label}
                            </button>
                        ))}
                    </div>
                    {subTab === 'meteo' && <MeteoTab data={data} farmFilter={farmFilter} />}
                    {subTab === 'farmroad' && <AgroFarmroadTab data={data} />}
                    {subTab === 'forecast' && <AgroForecastTab />}
                    {subTab === 'gdd' && <GDDTrackingTab />}
                    {subTab === 'climat_prod' && <ClimatProductionTab />}
                    {subTab === 'phyto' && <AgroPhytoTab data={data} getAlias={getAlias} getFerme={getFerme} farmFilter={farmFilter} />}
                    {subTab === 'ferti' && <AgroIrrigationTab data={data} getAlias={getAlias} getFerme={getFerme} farmFilter={farmFilter} />}
                    {subTab === 'foliaire' && <AgroAnalyseFoliairesTab ferme={farmFilter} currentProfile={currentProfile} profileData={profileData} userProfile={userProfile} />}
                    {subTab === 'surveillance' && <AgroSurveillanceTab ferme={farmFilter} currentProfile={currentProfile} profileData={profileData} />}
                    {subTab === 'irrigation' && <IrrigationRecoTab farmFilter={farmFilter} />}
                </div>
            );
        }

export { ChefAgronomieTab };
