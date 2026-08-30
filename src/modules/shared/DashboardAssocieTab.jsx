/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): DashboardAssocieTab */
import { QualiteLiquidationsTab } from '../qualite/QualiteLiquidationsTab.jsx';
import { QualiteProductionTab } from '../qualite/QualiteProductionTab.jsx';

// ===================== DASHBOARD ASSOCIÉ (M. LAZRAK) =====================
        function DashboardAssocieTab({ data, applyVarietyMapping, userProfile }) {
            const displayName = (userProfile && userProfile.displayName) || 'M. Tarik LAZRAK';
            return (
                <div className="fade-in">
                    <div style={{padding:'14px 18px', marginBottom:18, borderRadius:12, background:'linear-gradient(135deg, #fdf6ff 0%, #f5f0ff 100%)', border:'1.5px solid #e9d5ff'}}>
                        <div style={{fontSize:18, fontWeight:700, color:'#6b21a8'}}>
                            <i className="fa-solid fa-handshake" style={{marginRight:10, color:'#9333ea'}}></i>
                            Bonjour {displayName}
                        </div>
                        <div style={{fontSize:12, color:'var(--gray-500)', marginTop:4}}>Vue synthétique — Liquidations &amp; Production Cycle 2</div>
                    </div>

                    <QualiteLiquidationsTab data={data} applyVarietyMapping={applyVarietyMapping} compactView={true} />

                    <div style={{marginTop:24}}>
                        <QualiteProductionTab data={data} applyVarietyMapping={applyVarietyMapping} hideCycle1={true} userProfile={userProfile} cycle2OnlyView={true} />
                    </div>
                </div>
            );
        }

export { DashboardAssocieTab };
