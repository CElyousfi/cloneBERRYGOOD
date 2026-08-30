/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: magasin | Déclaration(s): MagParcTab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';

function MagParcTab({ data }) {
            const vidangesUrgentes = data.parcAuto.filter(v => v.kmRestant < 1000).length;
            const consoMoyFlotte = (data.parcAuto.reduce((s, v) => s + v.consoMoy, 0) / data.parcAuto.length).toFixed(1);

            return (
                <div className="fade-in">
                    <div className="kpi-grid">
                        <KPICard icon="fa-car" iconClass="berry" value={data.parcAuto.length} label="Total Véhicules" />
                        <KPICard icon="fa-triangle-exclamation" iconClass="red" value={vidangesUrgentes} label="Vidanges Urgentes" />
                        <KPICard icon="fa-gas-pump" iconClass="orange" value={consoMoyFlotte} label="Conso Moyenne (L/100km)" />
                    </div>

                    <Panel title="Parc Automobile" icon="fa-car">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Immatriculation</th>
                                    <th>Type</th>
                                    <th>Marque</th>
                                    <th>Affectation</th>
                                    <th>Km Actuel</th>
                                    <th>Proch. Vidange</th>
                                    <th>Km Restant</th>
                                    <th>Carte Total</th>
                                    <th>Conso Moy</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.parcAuto.map((v, i) => {
                                    const statusKm = v.kmRestant < 1000 ? 'danger' : (v.kmRestant < 3000 ? 'warning' : 'active');
                                    return (
                                        <tr key={i}>
                                            <td><strong>{v.immat}</strong></td>
                                            <td>{v.type}</td>
                                            <td>{v.marque}</td>
                                            <td>{v.affectation}</td>
                                            <td>{v.kmActuel.toLocaleString('fr-FR')}</td>
                                            <td>{v.kmProchVidange.toLocaleString('fr-FR')}</td>
                                            <td><span className={`status-badge ${statusKm}`}>{v.kmRestant}</span></td>
                                            <td>{v.carteTotal || '-'}</td>
                                            <td>{v.consoMoy}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </Panel>

                    <div style={{marginTop: 16, padding: 16, background: 'var(--blue-pale)', borderRadius: 12, fontSize: 12, color: 'var(--gray-600)'}}>
                        <strong><i className="fa-solid fa-circle-info" style={{marginRight: 6}}></i>Source:</strong> Kilométrage récupéré depuis l'extranet TOTAL Energies — Cartes carburant entreprise.
                    </div>
                </div>
            );
        }

export { MagParcTab };
