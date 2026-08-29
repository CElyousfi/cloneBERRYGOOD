/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): FinStockTab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';

function FinStockTab({ data }) {
            const fin = data.finStock;
            const stockTotal = fin.stockTheorique.reduce((s, c) => s + c.valeur, 0);

            return (
                <div className="fade-in">
                    <div className="kpi-grid">
                        <KPICard icon="fa-boxes-stacked" iconClass="berry" value={(stockTotal/1000000).toFixed(1)} label="Valeur Stock Théorique (M DH)" />
                        <KPICard icon="fa-sync" iconClass={fin.ecart < 0 ? 'red' : 'green'} value={fin.ecart.toLocaleString('fr-FR')} label={`Écart Réconciliation (DH)`} />
                        <KPICard icon="fa-wallet" iconClass="gold" value={(fin.caisse.solde/1000).toFixed(1)} label="Solde Caisse (K DH)" />
                    </div>

                    <div className="two-col">
                        <Panel title="Stock par Catégorie" icon="fa-boxes-stacked">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Catégorie</th>
                                        <th>Nb Réfs</th>
                                        <th>Valeur (DH)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {fin.stockTheorique.map((c, i) => (
                                        <tr key={i}>
                                            <td><strong>{c.categorie}</strong></td>
                                            <td>{c.nbRefs}</td>
                                            <td>{c.valeur.toLocaleString('fr-FR')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Panel>

                        <Panel title="Suivi Caisse" icon="fa-wallet">
                            <div style={{padding: 16}}>
                                <div style={{marginBottom: 12}}>
                                    <div style={{fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase'}}>Solde</div>
                                    <div style={{fontSize: 22, fontWeight: 700, color: 'var(--green)'}}>{fin.caisse.solde.toLocaleString('fr-FR')} DH</div>
                                </div>
                                <div style={{marginBottom: 12}}>
                                    <div style={{fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase'}}>Dernier Mouvement</div>
                                    <div style={{fontSize: 14, color: 'var(--dark)'}}>{fin.caisse.dernierMvt}</div>
                                </div>
                                <div>
                                    <div style={{fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase'}}>Responsable Achats</div>
                                    <div style={{fontSize: 14, color: 'var(--dark)', fontWeight: 600}}>{fin.caisse.respAchat}</div>
                                </div>
                            </div>
                        </Panel>
                    </div>

                    <Panel title="PV de Réconciliation" icon="fa-file-upload">
                        <div style={{padding: 16, textAlign: 'center', color: 'var(--gray-400)'}}>
                            <i className="fa-solid fa-cloud-arrow-up" style={{fontSize: 32, marginBottom: 12}}></i>
                            <div style={{fontSize: 12, marginBottom: 12}}>Cliquez pour uploader le PV de réconciliation du {fin.derniereReconciliation}</div>
                            <button style={{padding: '8px 16px', background: 'var(--berry)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600}}>
                                Choisir un fichier
                            </button>
                        </div>
                    </Panel>

                    <div style={{marginTop: 16, padding: 16, background: 'var(--blue-pale)', borderRadius: 12, fontSize: 12, color: 'var(--gray-600)'}}>
                        <strong>Caisse suivie par le responsable Achats (<strong>Achraf EL INAK</strong>)</strong>
                    </div>
                </div>
            );
        }

export { FinStockTab };
