/* Module: rh | Déclaration(s): SuiviTab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ===================== SUIVI MODIFICATIONS TAB =====================
        function SuiviTab({ data }) {
            const [filterType, setFilterType] = useState('');
            const [filterJour, setFilterJour] = useState('');

            const jours = [...new Set(data.suiviModifs.map(m => m.date))];
            let modifs = data.suiviModifs;
            if (filterType) modifs = modifs.filter(m => m.type === filterType);
            if (filterJour) modifs = modifs.filter(m => m.date === filterJour);

            const totalPDA = data.suiviModifs.filter(m => m.type === 'PDA');
            const totalRH = data.suiviModifs.filter(m => m.type === 'RH');
            const lignesPDA = totalPDA.reduce((s, m) => s + m.nbLignes, 0);
            const lignesRH = totalRH.reduce((s, m) => s + m.nbLignes, 0);

            return (
                <div className="fade-in">
                    <div className="kpi-grid">
                        <KPICard
                            icon="fa-mobile-screen"
                            iconClass="blue"
                            value={totalPDA.length}
                            label="Synchros PDA"
                            subItems={[{ value: lignesPDA, label: 'lignes importées' }]}
                        />
                        <KPICard
                            icon="fa-user-pen"
                            iconClass="berry"
                            value={totalRH.length}
                            label="Modifications RH"
                            subItems={[{ value: lignesRH, label: 'lignes modifiées' }]}
                        />
                        <KPICard
                            icon="fa-database"
                            iconClass="green"
                            value={lignesPDA + lignesRH}
                            label="Total Lignes Traitées"
                        />
                    </div>

                    <div className="filters-bar" style={{display:'flex', gap: 12, marginBottom: 16, alignItems:'center', flexWrap:'wrap'}}>
                        <label style={{fontSize: 12, fontWeight: 600}}>Filtres:</label>
                        <select className="filter-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                            <option value="">Tous les types</option>
                            <option value="PDA">Bulk PDA uniquement</option>
                            <option value="RH">Modifications RH uniquement</option>
                        </select>
                        <select className="filter-select" value={filterJour} onChange={(e) => setFilterJour(e.target.value)}>
                            <option value="">Tous les jours</option>
                            {jours.map(j => <option key={j} value={j}>{j}</option>)}
                        </select>
                    </div>

                    <Panel title="Historique des Modifications - Quinzaine en cours" icon="fa-timeline">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Heure</th>
                                    <th>Type</th>
                                    <th>Source</th>
                                    <th>Ferme</th>
                                    <th>Lignes</th>
                                    <th>Description</th>
                                </tr>
                            </thead>
                            <tbody>
                                {modifs.map((m, i) => (
                                    <tr key={i}>
                                        <td style={{fontWeight: 500}}>{m.date}</td>
                                        <td style={{color:'var(--gray-400)'}}>{m.heure}</td>
                                        <td>
                                            <span className={`status-badge ${m.type === 'PDA' ? 'active' : 'warning'}`}>
                                                <i className={`fa-solid ${m.type === 'PDA' ? 'fa-mobile-screen' : 'fa-user-pen'}`} style={{marginRight: 4}}></i>
                                                {m.type === 'PDA' ? 'Bulk PDA' : 'Modif RH'}
                                            </span>
                                        </td>
                                        <td>{m.source}</td>
                                        <td>
                                            <span style={{
                                                padding: '2px 8px',
                                                borderRadius: 8,
                                                fontSize: 11,
                                                fontWeight: 600,
                                                background: m.ferme === 'F1' ? 'var(--berry-pale)' : (m.ferme === 'F5' ? 'var(--green-pale)' : 'var(--orange-pale)'),
                                                color: m.ferme === 'F1' ? 'var(--berry)' : (m.ferme === 'F5' ? 'var(--green)' : 'var(--orange)')
                                            }}>{m.ferme}</span>
                                        </td>
                                        <td><strong>{m.nbLignes}</strong></td>
                                        <td style={{fontSize: 12}}>{m.description}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Panel>

                    <div style={{marginTop: 16, padding: 16, background: 'var(--berry-pale)', borderRadius: 12, fontSize: 12, color: 'var(--gray-600)'}}>
                        <strong><i className="fa-solid fa-circle-info" style={{marginRight: 6}}></i>Source:</strong> BR_Pointage (Firestore Mirror) — Synchronisation toutes les heures.
                        Les modifications PDA proviennent des scanners QR code à l'entrée/sortie des fermes.
                        Les modifications RH sont les ajustements manuels du Responsable RH.
                    </div>
                </div>
            );
        }

export { SuiviTab };
