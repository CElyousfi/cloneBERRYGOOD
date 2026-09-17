/* Module: admin | Déclaration(s): SousTraitantsConfigPanel */
import { FONCTIONS_ENUM } from '../rh/FONCTIONS_ENUM.jsx';
import { Panel } from '../shared/Panel.jsx';
import { useState } from '../shared/reactHooks.jsx';

// Configuration des sous-traitants / transporteurs (déplacée du Pointage Divers vers Paramètres).
        // Autonome : charge sa propre liste et la recharge après chaque save/delete.
        function SousTraitantsConfigPanel() {
            const [configItems, setConfigItems] = useState([]);
            const [editingItem, setEditingItem] = useState(null);
            const [loadingCfg, setLoadingCfg] = useState(true);

            const loadConfig = () => {
                fetch('/api/validation?action=divers-config').then(r => r.json())
                    .then(res => { if (res.success) setConfigItems(res.items || []); })
                    .catch(err => console.warn('Sous-traitants config load error:', err))
                    .finally(() => setLoadingCfg(false));
            };
            React.useEffect(() => { loadConfig(); }, []);

            const saveConfigItem = () => {
                if (!editingItem || !editingItem.beneficiaire || !editingItem.matricule || !editingItem.fonction || !editingItem.tache || editingItem.prixUnitaire === '' || editingItem.prixUnitaire === undefined || !editingItem.unite) {
                    alert('Tous les champs sont obligatoires (Nom, Matricule, Fonction, Tâche, Prix, Unité).');
                    return;
                }
                const matNorm = String(editingItem.matricule).trim().toUpperCase();
                if (!matNorm) { alert('Matricule obligatoire.'); return; }
                const dup = configItems.find(c => c.id !== editingItem.id && String(c.matricule || '').trim().toUpperCase() === matNorm);
                if (dup) { alert(`Matricule ${matNorm} déjà utilisé par "${dup.beneficiaire}".`); return; }
                const payload = { ...editingItem, matricule: matNorm, beneficiaire: String(editingItem.beneficiaire).trim() };
                fetch('/api/validation?action=divers-config-save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) })
                    .then(r => r.json()).then(res => { if (res.success) { setEditingItem(null); loadConfig(); } else { alert(res.error || 'Erreur'); } });
            };
            const deleteConfigItem = (id) => {
                if (!confirm('Supprimer ce sous-traitant ?')) return;
                fetch('/api/validation?action=divers-config-delete', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
                    .then(r => r.json()).then(res => { if (res.success) loadConfig(); });
            };

            const renderEditorRow = (keySuffix) => (
                <tr key={'edit_' + keySuffix} style={{background:'#fffde7'}}>
                    <td><input value={editingItem.beneficiaire} onChange={e => setEditingItem({...editingItem, beneficiaire: e.target.value})} placeholder="Nom transporteur" style={{width:'100%',padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}} /></td>
                    <td><input value={editingItem.matricule} onChange={e => setEditingItem({...editingItem, matricule: e.target.value.toUpperCase()})} placeholder="7071H1" style={{width:'100%',padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11,fontWeight:600,fontFamily:'monospace'}} /></td>
                    <td>
                        <select value={editingItem.fonction} onChange={e => {
                            const f = FONCTIONS_ENUM.find(x => x.key === e.target.value);
                            setEditingItem({...editingItem, fonction: e.target.value, unite: editingItem.unite || (f ? f.defaultUnite : 'JOUR')});
                        }} style={{padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}}>
                            <option value="">-- Choisir --</option>
                            {FONCTIONS_ENUM.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                    </td>
                    <td><input value={editingItem.tache} onChange={e => setEditingItem({...editingItem, tache: e.target.value})} placeholder="Tâche" style={{width:'100%',padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}} /></td>
                    <td><input type="number" value={editingItem.prixUnitaire} onChange={e => setEditingItem({...editingItem, prixUnitaire: e.target.value})} placeholder="0" style={{width:70,padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11,textAlign:'right'}} /></td>
                    <td>
                        <select value={editingItem.unite} onChange={e => setEditingItem({...editingItem, unite: e.target.value})} style={{padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}}>
                            <option value="JOUR">JOUR</option><option value="HEURE">HEURE</option><option value="VOYAGES">VOYAGES</option>
                        </select>
                    </td>
                    <td style={{textAlign:'center'}}>
                        <button onClick={saveConfigItem} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'var(--green)',color:'#fff',fontSize:10,cursor:'pointer',marginRight:4}}><i className="fa-solid fa-check"></i></button>
                        <button onClick={() => setEditingItem(null)} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'var(--gray-300)',color:'#fff',fontSize:10,cursor:'pointer'}}><i className="fa-solid fa-times"></i></button>
                    </td>
                </tr>
            );
            const renderRow = (c) => (editingItem && editingItem.id === c.id ? renderEditorRow(c.id) : (
                <tr key={c.id}>
                    <td><strong>{c.beneficiaire || <em style={{color:'var(--gray-400)'}}>(à compléter)</em>}</strong></td>
                    <td style={{fontFamily:'monospace',fontWeight:600}}>{c.matricule || <em style={{color:'#e74c3c'}}>—</em>}</td>
                    <td>{c.fonction}</td>
                    <td>{c.tache}</td>
                    <td style={{textAlign:'right',fontWeight:600}}>{Number(c.prixUnitaire).toLocaleString('fr-FR')} DH</td>
                    <td>{c.unite}</td>
                    <td style={{textAlign:'center'}}>
                        <button onClick={() => setEditingItem({ id: c.id, beneficiaire: c.beneficiaire || '', matricule: c.matricule || '', fonction: c.fonction, tache: c.tache, prixUnitaire: c.prixUnitaire, unite: c.unite })} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'#3498db',color:'#fff',fontSize:10,cursor:'pointer',marginRight:4}}><i className="fa-solid fa-pen"></i></button>
                        <button onClick={() => deleteConfigItem(c.id)} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'#e74c3c',color:'#fff',fontSize:10,cursor:'pointer'}}><i className="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            ));
            const groups = FONCTIONS_ENUM.map(f => ({ ...f, items: configItems.filter(c => c.fonction === f.key) }));
            const legacyItems = configItems.filter(c => !FONCTIONS_ENUM.some(f => f.key === c.fonction));
            if (legacyItems.length > 0) groups.push({ key: '__LEGACY__', label: '⚠️ Anciens (à reclasser)', items: legacyItems });

            return (
                <Panel title="Configuration Sous-traitants (Pointage Divers)" icon="fa-truck">
                    <div style={{fontSize:11,color:'var(--gray-500)',marginBottom:10}}>
                        <i className="fa-solid fa-circle-info" style={{marginRight:4}}></i>
                        Transporteurs / engins / tracteurs utilisés dans <strong>Pointage Divers</strong>. Le Transport Fruit est alimenté automatiquement par les bons d'apport.
                    </div>
                    <div style={{marginBottom:10}}>
                        <button onClick={() => setEditingItem({ beneficiaire: '', matricule: '', fonction: '', tache: '', prixUnitaire: '', unite: 'JOUR' })}
                            style={{padding:'6px 14px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                            <i className="fa-solid fa-plus" style={{marginRight:4}}></i>Ajouter
                        </button>
                    </div>
                    {loadingCfg ? <div style={{padding:16,color:'var(--gray-400)',fontSize:12}}>Chargement…</div> : (
                    <table className="data-table" style={{fontSize:12}}>
                        <thead>
                            <tr>
                                <th>Bénéficiaire (Nom)</th>
                                <th style={{width:110}}>Matricule</th>
                                <th style={{width:170}}>Fonction</th>
                                <th>Tâche</th>
                                <th style={{textAlign:'right',width:110}}>Prix Unitaire</th>
                                <th style={{width:80}}>Unité</th>
                                <th style={{textAlign:'center',width:90}}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {editingItem && !editingItem.id && renderEditorRow('new')}
                            {groups.map(g => (
                                <React.Fragment key={g.key}>
                                    <tr style={{background:'var(--gray-100)'}}>
                                        <td colSpan="7" style={{fontWeight:700,fontSize:11,color:'var(--gray-600)',padding:'6px 8px'}}>
                                            {g.label} <span style={{color:'var(--gray-400)',fontWeight:400}}>({g.items.length})</span>
                                        </td>
                                    </tr>
                                    {g.items.length === 0 ? (
                                        <tr><td colSpan="7" style={{textAlign:'center',color:'var(--gray-400)',fontStyle:'italic',padding:8,fontSize:11}}>— aucun —</td></tr>
                                    ) : g.items.map(renderRow)}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                    )}
                </Panel>
            );
        }

export { SousTraitantsConfigPanel };
