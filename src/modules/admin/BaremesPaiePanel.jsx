/* Module: admin | Déclaration(s): BaremesPaiePanel */
import { Panel } from '../shared/Panel.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { PAIE_BAREMES_DEFAULT } from './PAIE_BAREMES_DEFAULT.jsx';

function BaremesPaiePanel() {
            const [baremes, setBaremes] = useState(PAIE_BAREMES_DEFAULT);
            const [loaded, setLoaded] = useState(false);
            const [saving, setSaving] = useState(false);
            const [saveMsg, setSaveMsg] = useState('');
            useEffect(() => {
                firebase.firestore().collection('app_settings').doc('paie_baremes').get()
                    .then(doc => { if (doc.exists) setBaremes({ ...PAIE_BAREMES_DEFAULT, ...doc.data() }); })
                    .catch(() => {})
                    .finally(() => setLoaded(true));
            }, []);
            const setNum = (k, v) => setBaremes(b => ({ ...b, [k]: Number(v) }));
            const setPalier = (i, k, v) => setBaremes(b => {
                const arr = [...(b.paliers || [])];
                arr[i] = { ...arr[i], [k]: k === 'label' ? v : Number(v) };
                return { ...b, paliers: arr };
            });
            const addPalier = () => setBaremes(b => ({ ...b, paliers: [...(b.paliers || []), { seuilJours: 0, pourcentage: 0, label: '' }] }));
            const removePalier = (i) => setBaremes(b => ({ ...b, paliers: (b.paliers || []).filter((_, idx) => idx !== i) }));
            // SMAG daté (smagHistory) : entrées [{dateFrom:'YYYY-MM-DD', smagBrutJournalier, smagNetJournalier}]
            const setSmagHist = (i, k, v) => setBaremes(b => {
                const arr = [...(b.smagHistory || [])];
                arr[i] = { ...arr[i], [k]: k === 'dateFrom' ? v : Number(v) };
                return { ...b, smagHistory: arr };
            });
            const addSmagHist = () => setBaremes(b => ({ ...b, smagHistory: [...(b.smagHistory || []), { dateFrom: new Date().toISOString().slice(0, 10), smagBrutJournalier: b.smagBrutJournalier || 0, smagNetJournalier: b.smagNetJournalier || 0 }] }));
            const removeSmagHist = (i) => setBaremes(b => ({ ...b, smagHistory: (b.smagHistory || []).filter((_, idx) => idx !== i) }));
            const sortSmagHist = () => setBaremes(b => ({ ...b, smagHistory: [...(b.smagHistory || [])].sort((a, c) => (a.dateFrom < c.dateFrom ? -1 : a.dateFrom > c.dateFrom ? 1 : 0)) }));
            const save = async () => {
                setSaving(true); setSaveMsg('');
                try {
                    await firebase.firestore().collection('app_settings').doc('paie_baremes').set({
                        ...baremes, updatedAt: Date.now(),
                    }, { merge: true });
                    setSaveMsg('Enregistré ✓');
                    setTimeout(() => setSaveMsg(''), 2500);
                } catch (e) { setSaveMsg('Erreur: ' + e.message); }
                finally { setSaving(false); }
            };
            if (!loaded) return null;
            const inputStyle = { padding: '4px 6px', borderRadius: 6, border: '1px solid var(--gray-300)', fontSize: 11, width: 100 };
            return (
                <Panel title="Barèmes Paie (SMAG, charges, ancienneté)" icon="fa-money-bill-wave">
                    <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:12, marginBottom:16}}>
                        <label style={{fontSize:11, display:'flex', flexDirection:'column', gap:4}}>
                            <span style={{fontWeight:600, color:'var(--gray-500)'}}>SMAG brut journalier (DH)</span>
                            <input type="number" step="0.01" value={baremes.smagBrutJournalier} onChange={e => setNum('smagBrutJournalier', e.target.value)} style={inputStyle} />
                        </label>
                        <label style={{fontSize:11, display:'flex', flexDirection:'column', gap:4}}>
                            <span style={{fontWeight:600, color:'var(--gray-500)'}}>SMAG net journalier (DH)</span>
                            <input type="number" step="0.01" value={baremes.smagNetJournalier} onChange={e => setNum('smagNetJournalier', e.target.value)} style={inputStyle} />
                        </label>
                        <label style={{fontSize:11, display:'flex', flexDirection:'column', gap:4}}>
                            <span style={{fontWeight:600, color:'var(--gray-500)'}}>Jours / mois</span>
                            <input type="number" step="1" value={baremes.joursParMois} onChange={e => setNum('joursParMois', e.target.value)} style={inputStyle} />
                        </label>
                        <label style={{fontSize:11, display:'flex', flexDirection:'column', gap:4}}>
                            <span style={{fontWeight:600, color:'var(--gray-500)'}}>Charges patronales (%)</span>
                            <input type="number" step="0.01" value={(baremes.tauxChargesPatronales * 100).toFixed(2)}
                                onChange={e => setBaremes(b => ({...b, tauxChargesPatronales: Number(e.target.value) / 100}))} style={inputStyle} />
                        </label>
                        <label style={{fontSize:11, display:'flex', flexDirection:'column', gap:4}}>
                            <span style={{fontWeight:600, color:'var(--gray-500)'}}>Cotisations salariales (%)</span>
                            <input type="number" step="0.01" value={(baremes.tauxCotisationsSalariales * 100).toFixed(2)}
                                onChange={e => setBaremes(b => ({...b, tauxCotisationsSalariales: Number(e.target.value) / 100}))} style={inputStyle} />
                        </label>
                    </div>
                    <h4 style={{fontSize:12, fontWeight:700, marginBottom:8, color:'var(--berry)'}}>Paliers prime d'ancienneté</h4>
                    <table className="data-table" style={{fontSize:11, marginBottom:12}}>
                        <thead><tr>
                            <th>Label</th>
                            <th style={{textAlign:'right'}}>Seuil (jours travaillés)</th>
                            <th style={{textAlign:'right'}}>Prime (%)</th>
                            <th style={{width:40}}></th>
                        </tr></thead>
                        <tbody>
                            {(baremes.paliers || []).map((p, i) => (
                                <tr key={i}>
                                    <td><input value={p.label || ''} onChange={e => setPalier(i, 'label', e.target.value)} style={{...inputStyle, width:'90%'}} /></td>
                                    <td style={{textAlign:'right'}}><input type="number" value={p.seuilJours} onChange={e => setPalier(i, 'seuilJours', e.target.value)} style={{...inputStyle, textAlign:'right'}} /></td>
                                    <td style={{textAlign:'right'}}><input type="number" step="0.5" value={p.pourcentage} onChange={e => setPalier(i, 'pourcentage', e.target.value)} style={{...inputStyle, textAlign:'right', width:70}} /></td>
                                    <td><button onClick={() => removePalier(i)} style={{background:'transparent', border:'none', color:'var(--red)', cursor:'pointer'}} title="Supprimer"><i className="fa-solid fa-trash"></i></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <h4 style={{fontSize:12, fontWeight:700, marginTop:16, marginBottom:4, color:'var(--berry)'}}>SMAG daté (historique)</h4>
                    <div style={{fontSize:10, color:'var(--gray-400)', marginBottom:8}}>
                        Le SMAG applicable à une date est l'entrée datée la plus récente ≤ cette date. En l'absence d'entrée applicable, les champs plats ci-dessus servent de défaut.
                    </div>
                    <table className="data-table" style={{fontSize:11, marginBottom:12}}>
                        <thead><tr>
                            <th>Applicable à partir du</th>
                            <th style={{textAlign:'right'}}>SMAG brut/j (DH)</th>
                            <th style={{textAlign:'right'}}>SMAG net/j (DH)</th>
                            <th style={{width:40}}></th>
                        </tr></thead>
                        <tbody>
                            {(baremes.smagHistory || []).map((h, i) => (
                                <tr key={i}>
                                    <td><input type="date" value={h.dateFrom || ''} onChange={e => setSmagHist(i, 'dateFrom', e.target.value)} style={{...inputStyle, width:'90%'}} /></td>
                                    <td style={{textAlign:'right'}}><input type="number" step="0.01" value={h.smagBrutJournalier} onChange={e => setSmagHist(i, 'smagBrutJournalier', e.target.value)} style={{...inputStyle, textAlign:'right'}} /></td>
                                    <td style={{textAlign:'right'}}><input type="number" step="0.01" value={h.smagNetJournalier} onChange={e => setSmagHist(i, 'smagNetJournalier', e.target.value)} style={{...inputStyle, textAlign:'right'}} /></td>
                                    <td><button onClick={() => removeSmagHist(i)} style={{background:'transparent', border:'none', color:'var(--red)', cursor:'pointer'}} title="Supprimer"><i className="fa-solid fa-trash"></i></button></td>
                                </tr>
                            ))}
                            {(!baremes.smagHistory || baremes.smagHistory.length === 0) && (
                                <tr><td colSpan={4} style={{color:'var(--gray-400)', fontStyle:'italic', padding:'8px 4px'}}>Aucune entrée datée — le SMAG plat ci-dessus s'applique partout.</td></tr>
                            )}
                        </tbody>
                    </table>
                    <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:12}}>
                        <button onClick={addSmagHist} style={{padding:'6px 12px', background:'var(--gray-100)', color:'var(--gray-500)', border:'1px solid var(--gray-300)', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                            <i className="fa-solid fa-plus" style={{marginRight:4}}></i> Ajouter une période SMAG
                        </button>
                        <button onClick={sortSmagHist} style={{padding:'6px 12px', background:'var(--gray-100)', color:'var(--gray-500)', border:'1px solid var(--gray-300)', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                            <i className="fa-solid fa-arrow-down-1-9" style={{marginRight:4}}></i> Trier par date
                        </button>
                    </div>

                    <div style={{display:'flex', gap:8, alignItems:'center'}}>
                        <button onClick={addPalier} style={{padding:'6px 12px', background:'var(--gray-100)', color:'var(--gray-500)', border:'1px solid var(--gray-300)', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                            <i className="fa-solid fa-plus" style={{marginRight:4}}></i> Ajouter un palier
                        </button>
                        <button onClick={save} disabled={saving} style={{padding:'6px 16px', background:'var(--berry)', color:'white', border:'none', borderRadius:8, fontSize:11, fontWeight:600, cursor: saving ? 'wait' : 'pointer'}}>
                            {saving ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                        {saveMsg && <span style={{fontSize:11, color: saveMsg.startsWith('Erreur') ? 'var(--red)' : 'var(--green)', fontWeight:600}}>{saveMsg}</span>}
                    </div>
                </Panel>
            );
        }

export { BaremesPaiePanel };
