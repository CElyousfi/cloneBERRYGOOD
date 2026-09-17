/* Module: magasin | Déclaration(s): MagInventaireTab */
import { useState } from '../shared/reactHooks.jsx';
import { InventairePrixView } from './InventairePrixView.jsx';
import { InventaireStockView } from './InventaireStockView.jsx';

// ===================== MAGASINIER: INVENTAIRE TAB =====================
        function MagInventaireTab({ currentProfile }) {
            const [subTab, setSubTab] = useState('stock');
            const subTabs = [
                { id: 'stock', label: 'Situation Stock', icon: 'fa-warehouse' },
                { id: 'prix', label: 'Évolution Prix', icon: 'fa-chart-line' },
            ];

            return (
                <div className="fade-in">
                    <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
                        {subTabs.map(t => (
                            <button key={t.id} onClick={() => setSubTab(t.id)}
                                style={{padding:'8px 16px',borderRadius:20,border: subTab === t.id ? '2px solid var(--berry)' : '1px solid #ddd',
                                    background: subTab === t.id ? 'rgba(139,34,82,0.08)' : '#fff',color: subTab === t.id ? 'var(--berry)' : '#666',
                                    fontWeight: subTab === t.id ? 700 : 500,fontSize:12,cursor:'pointer'}}>
                                <i className={`fa-solid ${t.icon}`} style={{marginRight:6}}></i>{t.label}
                            </button>
                        ))}
                    </div>
                    {subTab === 'stock' && <InventaireStockView />}
                    {subTab === 'prix' && <InventairePrixView />}
                </div>
            );
        }

export { MagInventaireTab };
