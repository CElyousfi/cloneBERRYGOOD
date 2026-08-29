/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): FinPlantsTab */
import { PARCELLES_CULTURALES } from '../agronomie/PARCELLES_CULTURALES.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';

// ============================================================
        // FinPlantsTab — Répartition des factures plants par variété
        // Permet de lisser le coût des plants sur 1 ou 2 années
        // ============================================================
        function FinPlantsTab({ data, currentProfile }) {
            const [invoices, setInvoices] = React.useState(null);
            const [loading, setLoading] = React.useState(true);
            const [error, setError] = React.useState(null);
            const [allocationConfig, setAllocationConfig] = React.useState({}); // { invoiceId: { years: 1|2, startYear: 2025, ferme: 'F1', variete: 'Maravilla', sousVariete: 'Long Cane' } }
            const [editingId, setEditingId] = React.useState(null);
            const [savingConfig, setSavingConfig] = React.useState(false);

            // Variétés disponibles (cycle 2 actuel)
            const varieteOptions = React.useMemo(() => {
                const list = (PARCELLES_CULTURALES || []).filter(p => p.cycle === 2 && p.enProduction !== false);
                return list.map(p => ({
                    key: p.variete + '|' + (p.sousVariete || '') + '|' + p.ferme,
                    variete: p.variete,
                    sousVariete: p.sousVariete,
                    ferme: p.ferme,
                    ha: p.ha,
                    label: (p.sousVariete ? p.variete + ' ' + p.sousVariete : p.variete) + ' (' + p.ferme + ' · ' + p.ha + ' Ha)',
                }));
            }, []);

            // Détection automatique de la variété à partir du libellé facture
            const detectVarieteFromLabel = (label) => {
                if (!label) return null;
                const u = label.toUpperCase();
                if (u.includes('MARAVILLA')) {
                    if (u.includes('GREEN') || u.includes('GG')) return { variete: 'Maravilla', sousVariete: 'Green Cane', ferme: 'F1' };
                    if (u.includes('MOTTE') || u.includes('LONG') || u.includes('LG')) return { variete: 'Maravilla', sousVariete: 'Long Cane', ferme: 'F1' };
                    if (u.includes('MOW')) return { variete: 'Maravilla', sousVariete: 'Mow Down', ferme: 'F1' };
                    return { variete: 'Maravilla', sousVariete: 'Long Cane', ferme: 'F1' };
                }
                if (u.includes('YAZMIN') || u.includes('YASMIN')) {
                    if (u.includes('MOTTE') || u.includes('BI') || u.includes('CUT')) return { variete: 'Yazmin', sousVariete: 'Bi Cycle', ferme: 'F5' };
                    if (u.includes('MOW')) return { variete: 'Yazmin', sousVariete: 'Mow Down', ferme: 'F5' };
                    return { variete: 'Yazmin', sousVariete: null, ferme: 'F5' };
                }
                if (u.includes('REYNA') || u.includes('REINA')) return { variete: 'Reyna', sousVariete: null, ferme: 'F5' };
                if (u.includes('CORINA') || u.includes('CORRINA')) return { variete: 'Corina', sousVariete: null, ferme: 'F5' };
                if (u.includes('BREEZE')) return { variete: 'Breeze', sousVariete: null, ferme: 'F5' };
                if (u.includes('CASCADE')) return { variete: 'Cascade', sousVariete: null, ferme: 'F5' };
                return null;
            };

            // Charger factures + config d'affectation
            React.useEffect(() => {
                Promise.all([
                    fetch('/api/email-analysis?action=plant-invoices').then(r => r.json()),
                    typeof firebase !== 'undefined' && firebase.firestore
                        ? firebase.firestore().collection('plants_allocation_config').get().then(snap => {
                            const cfg = {};
                            snap.forEach(d => { cfg[d.id] = d.data(); });
                            return cfg;
                        }).catch(() => ({}))
                        : Promise.resolve({}),
                ]).then(([invJson, cfg]) => {
                    if (invJson.success) {
                        setInvoices(invJson.invoices || []);
                        // Auto-détection des variétés non configurées
                        const initialCfg = { ...cfg };
                        (invJson.invoices || []).forEach(inv => {
                            if (!initialCfg[inv.id]) {
                                const detected = detectVarieteFromLabel(inv.variete);
                                initialCfg[inv.id] = detected
                                    ? { ...detected, years: 1, startYear: new Date(inv.date.split('/').reverse().join('-')).getFullYear() || 2025 }
                                    : { years: 1, startYear: 2025 };
                            }
                        });
                        setAllocationConfig(initialCfg);
                    } else {
                        setError(invJson.error || 'Erreur chargement factures');
                    }
                    setLoading(false);
                }).catch(err => { setError(err.message); setLoading(false); });
            }, []);

            // Sauvegarder une config en Firestore
            const saveConfig = async (invoiceId, config) => {
                if (typeof firebase === 'undefined' || !firebase.firestore) return;
                setSavingConfig(true);
                try {
                    await firebase.firestore().collection('plants_allocation_config').doc(invoiceId).set({
                        ...config, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    });
                    setAllocationConfig(prev => ({ ...prev, [invoiceId]: config }));
                } catch (e) { alert('Erreur sauvegarde: ' + e.message); }
                setSavingConfig(false);
            };

            if (loading) return <div style={{textAlign:'center',padding:60}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:24,color:'var(--berry)'}}></i><p style={{marginTop:12,color:'var(--gray-500)'}}>Chargement factures plants...</p></div>;
            if (error) return <div style={{textAlign:'center',padding:60,color:'var(--red)'}}><i className="fa-solid fa-triangle-exclamation"></i> {error}</div>;
            if (!invoices) return null;

            // Calcul de la répartition par variété et par année
            const allocationByVariete = {};
            const allocationByYear = {};
            const totalGlobal = invoices.reduce((s, i) => s + (i.montant || 0), 0);

            invoices.forEach(inv => {
                const cfg = allocationConfig[inv.id] || { years: 1, startYear: new Date().getFullYear() };
                const montant = inv.montant || 0;
                const yearsCount = cfg.years || 1;
                const startYear = cfg.startYear || new Date().getFullYear();
                const annualShare = montant / yearsCount;
                const varieteKey = (cfg.variete || 'Non assigné') + '|' + (cfg.sousVariete || '') + '|' + (cfg.ferme || '');

                if (!allocationByVariete[varieteKey]) {
                    allocationByVariete[varieteKey] = {
                        variete: cfg.variete || 'Non assigné',
                        sousVariete: cfg.sousVariete,
                        ferme: cfg.ferme || '-',
                        total: 0,
                        invoices: [],
                        byYear: {},
                    };
                }
                allocationByVariete[varieteKey].total += montant;
                allocationByVariete[varieteKey].invoices.push({ ...inv, config: cfg });

                for (let i = 0; i < yearsCount; i++) {
                    const y = startYear + i;
                    allocationByVariete[varieteKey].byYear[y] = (allocationByVariete[varieteKey].byYear[y] || 0) + annualShare;
                    allocationByYear[y] = (allocationByYear[y] || 0) + annualShare;
                }
            });

            const allYears = [...new Set(Object.keys(allocationByYear).map(Number))].sort();
            const sortedVarietes = Object.values(allocationByVariete).sort((a, b) => b.total - a.total);
            const unassigned = invoices.filter(inv => !allocationConfig[inv.id]?.variete);

            return (
                <div className="fade-in">
                    {/* Header KPIs */}
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:20}}>
                        <KPICard icon="fa-file-invoice" iconClass="berry" value={invoices.length} label="Factures Plants" />
                        <KPICard icon="fa-coins" iconClass="green" value={Math.round(totalGlobal/1000) + 'k'} label="Total Facturé (DH)" />
                        <KPICard icon="fa-circle-check" iconClass="blue" value={invoices.length - unassigned.length} label="Variétés Affectées" />
                        <KPICard icon="fa-circle-exclamation" iconClass={unassigned.length > 0 ? 'red' : 'green'} value={unassigned.length} label="Non Affectées" />
                    </div>

                    {/* Répartition par variété */}
                    <Panel title="Répartition par Variété" icon="fa-chart-pie" actions={
                        <span style={{fontSize:11,color:'var(--gray-400)'}}>{sortedVarietes.length} variété(s)</span>
                    }>
                        {sortedVarietes.length === 0 ? (
                            <div style={{textAlign:'center',padding:30,color:'var(--gray-400)'}}>Aucune répartition configurée</div>
                        ) : (
                            <div style={{overflowX:'auto'}}>
                                <table className="data-table" style={{fontSize:12}}>
                                    <thead>
                                        <tr>
                                            <th>Variété</th>
                                            <th>Sous-variété</th>
                                            <th>Ferme</th>
                                            <th style={{textAlign:'right'}}>Nb Factures</th>
                                            <th style={{textAlign:'right'}}>Total Facturé</th>
                                            {allYears.map(y => <th key={y} style={{textAlign:'right'}}>{y}</th>)}
                                            <th style={{textAlign:'right'}}>%</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedVarietes.map((v, i) => {
                                            const pct = totalGlobal > 0 ? (v.total / totalGlobal * 100) : 0;
                                            return (
                                                <tr key={i} style={v.variete === 'Non assigné' ? {background:'rgba(231,76,60,0.05)'} : {}}>
                                                    <td><strong>{v.variete}</strong></td>
                                                    <td style={{color:'var(--gray-500)'}}>{v.sousVariete || '-'}</td>
                                                    <td><span style={{padding:'2px 8px',borderRadius:12,fontSize:10,fontWeight:600,background:'rgba(45,139,78,0.1)',color:'#2D8B4E'}}>{v.ferme}</span></td>
                                                    <td style={{textAlign:'right'}}>{v.invoices.length}</td>
                                                    <td style={{textAlign:'right',fontFamily:'monospace',fontWeight:700}}>{Math.round(v.total).toLocaleString('fr-FR')}</td>
                                                    {allYears.map(y => (
                                                        <td key={y} style={{textAlign:'right',fontFamily:'monospace',color: v.byYear[y] ? '#2D8B4E' : '#ccc'}}>
                                                            {v.byYear[y] ? Math.round(v.byYear[y]).toLocaleString('fr-FR') : '-'}
                                                        </td>
                                                    ))}
                                                    <td style={{textAlign:'right',color:'var(--gray-500)'}}>{pct.toFixed(1)}%</td>
                                                </tr>
                                            );
                                        })}
                                        <tr style={{background:'var(--berry-pale)',fontWeight:700}}>
                                            <td colSpan={4}>TOTAL</td>
                                            <td style={{textAlign:'right',fontFamily:'monospace'}}>{Math.round(totalGlobal).toLocaleString('fr-FR')}</td>
                                            {allYears.map(y => (
                                                <td key={y} style={{textAlign:'right',fontFamily:'monospace'}}>{Math.round(allocationByYear[y] || 0).toLocaleString('fr-FR')}</td>
                                            ))}
                                            <td style={{textAlign:'right'}}>100%</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Panel>

                    {/* Configuration par facture */}
                    <Panel title="Configuration des Factures" icon="fa-cog" actions={
                        <span style={{fontSize:11,color:'var(--gray-400)'}}>{invoices.length} facture(s)</span>
                    }>
                        <div style={{background:'rgba(52,152,219,0.08)',border:'1px solid rgba(52,152,219,0.2)',borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:12,color:'#2c3e50'}}>
                            <i className="fa-solid fa-circle-info" style={{marginRight:6,color:'var(--blue)'}}></i>
                            Affectez chaque facture à une variété et choisissez de lisser le coût sur 1 ou 2 années.
                            La variété est pré-détectée depuis le libellé de la facture, vérifiez et ajustez si nécessaire.
                        </div>
                        <div style={{overflowX:'auto'}}>
                            <table className="data-table" style={{fontSize:11}}>
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Référence</th>
                                        <th>Variété Driscoll's</th>
                                        <th>Quantité</th>
                                        <th style={{textAlign:'right'}}>Montant</th>
                                        <th>Affecté à</th>
                                        <th>Lissage</th>
                                        <th>Année départ</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invoices.map(inv => {
                                        const cfg = allocationConfig[inv.id] || {};
                                        const isEditing = editingId === inv.id;
                                        const selectedKey = cfg.variete ? cfg.variete + '|' + (cfg.sousVariete || '') + '|' + (cfg.ferme || '') : '';
                                        const isAssigned = !!cfg.variete;
                                        return (
                                            <tr key={inv.id} style={!isAssigned ? {background:'rgba(231,76,60,0.05)'} : {}}>
                                                <td>{inv.date}</td>
                                                <td><strong style={{color:'var(--blue)'}}>{inv.ref}</strong></td>
                                                <td>{inv.variete}</td>
                                                <td>{inv.qte ? inv.qte.toLocaleString('fr-FR') : '-'}</td>
                                                <td style={{textAlign:'right',fontWeight:600,fontFamily:'monospace'}}>{Math.round(inv.montant).toLocaleString('fr-FR')}</td>
                                                <td>
                                                    {isEditing ? (
                                                        <select value={selectedKey} onChange={e => {
                                                            const [variete, sousVariete, ferme] = e.target.value.split('|');
                                                            setAllocationConfig(prev => ({ ...prev, [inv.id]: { ...prev[inv.id], variete, sousVariete: sousVariete || null, ferme } }));
                                                        }} style={{padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:11,minWidth:200}}>
                                                            <option value="">— Choisir —</option>
                                                            {varieteOptions.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                                                        </select>
                                                    ) : (
                                                        cfg.variete ? (
                                                            <span style={{padding:'2px 8px',borderRadius:12,fontSize:10,fontWeight:600,background:'rgba(139,34,82,0.08)',color:'var(--berry)'}}>
                                                                {cfg.variete}{cfg.sousVariete ? ' ' + cfg.sousVariete : ''} ({cfg.ferme})
                                                            </span>
                                                        ) : <span style={{color:'var(--red)',fontWeight:600}}>Non assigné</span>
                                                    )}
                                                </td>
                                                <td>
                                                    {isEditing ? (
                                                        <select value={cfg.years || 1} onChange={e => setAllocationConfig(prev => ({ ...prev, [inv.id]: { ...prev[inv.id], years: parseInt(e.target.value) } }))}
                                                            style={{padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:11}}>
                                                            <option value={1}>1 an</option>
                                                            <option value={2}>2 ans</option>
                                                        </select>
                                                    ) : (
                                                        <span style={{padding:'2px 8px',borderRadius:12,fontSize:10,fontWeight:600,background: cfg.years === 2 ? 'rgba(212,168,71,0.15)' : 'rgba(45,139,78,0.1)',color: cfg.years === 2 ? '#8B6914' : '#2D8B4E'}}>
                                                            {cfg.years || 1} an{(cfg.years || 1) > 1 ? 's' : ''}
                                                        </span>
                                                    )}
                                                </td>
                                                <td>
                                                    {isEditing ? (
                                                        <input type="number" value={cfg.startYear || new Date().getFullYear()} onChange={e => setAllocationConfig(prev => ({ ...prev, [inv.id]: { ...prev[inv.id], startYear: parseInt(e.target.value) } }))}
                                                            style={{padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:11,width:80}} />
                                                    ) : cfg.startYear || '-'}
                                                </td>
                                                <td style={{textAlign:'right'}}>
                                                    {isEditing ? (
                                                        <div style={{display:'flex',gap:4}}>
                                                            <button onClick={async () => { await saveConfig(inv.id, allocationConfig[inv.id]); setEditingId(null); }} disabled={savingConfig}
                                                                style={{background:'var(--green)',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',fontSize:10,cursor:'pointer',fontWeight:600}}>
                                                                <i className="fa-solid fa-check"></i>
                                                            </button>
                                                            <button onClick={() => setEditingId(null)} style={{background:'#ccc',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',fontSize:10,cursor:'pointer'}}>
                                                                <i className="fa-solid fa-times"></i>
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button onClick={() => setEditingId(inv.id)}
                                                            style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',fontSize:10,cursor:'pointer',fontWeight:600}}>
                                                            <i className="fa-solid fa-pen"></i> Modifier
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </Panel>
                </div>
            );
        }

export { FinPlantsTab };
