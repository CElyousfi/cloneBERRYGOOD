/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CanevaSummaryView */


// Résumé d'un dry-run canevas : compteurs, jours nouveaux/modifiés, écarts, warnings.
        function CanevaSummaryView({ s }) {
            if (!s) return null;
            const c = s.counts || {};
            const chip = (label, val, color) => (
                <span style={{padding:'3px 9px',borderRadius:20,background: color ? color+'14' : 'var(--gray-100)',color: color || 'var(--gray-700)',fontSize:11}}>{label} <strong>{val}</strong></span>
            );
            return (
                <div style={{marginTop:10}}>
                    <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
                        {chip('Réceptions', c.receptions || 0)}
                        {chip('Transferts', c.transferts || 0)}
                        {chip('Consommations', c.consommations || 0)}
                        {chip('Sorties', c.sorties || 0)}
                        {chip('Lignes', c.lineItems || 0)}
                    </div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
                        {chip('Jours nouveaux', (s.jours_nouveaux || []).length, 'var(--green)')}
                        {chip('Jours inchangés', (s.jours_identiques || []).length, 'var(--gray-400)')}
                        {chip('Jours à remplacer', (s.jours_modifies || []).length, 'var(--red)')}
                    </div>
                    {s.guard && s.guard.shrink && s.guard.shrink.flagged && (
                        <div style={{padding:8,background:'rgba(212,168,71,0.12)',border:'1px solid rgba(212,168,71,0.35)',borderRadius:6,fontSize:11,marginBottom:8}}>
                            <i className="fa-solid fa-triangle-exclamation" style={{color:'var(--gold)',marginRight:5}}></i>
                            Baisse importante du volume : {s.guard.shrink.new} mouvements vs {s.guard.shrink.current} actuels ({s.guard.shrink.pct}%).
                        </div>
                    )}
                    {(s.jours_modifies || []).length > 0 && (
                        <div style={{padding:8,background:'rgba(231,76,60,0.07)',border:'1px solid rgba(231,76,60,0.25)',borderRadius:6,fontSize:11,marginBottom:8}}>
                            <strong style={{color:'var(--red)'}}><i className="fa-solid fa-clock-rotate-left" style={{marginRight:5}}></i>Données historiques qui seront effacées :</strong>
                            <ul style={{margin:'4px 0 0 0',paddingLeft:16}}>
                                {s.jours_modifies.slice(0, 12).map((j, i) => <li key={i}>{j.date} — {j.nb_bons_existants} bon(s) existant(s) remplacé(s)</li>)}
                                {s.jours_modifies.length > 12 && <li>… +{s.jours_modifies.length - 12} autre(s) jour(s)</li>}
                            </ul>
                        </div>
                    )}
                    <div style={{fontSize:11,color:'var(--gray-600)',marginBottom:6}}>
                        Validation vs Stock réel : <strong style={{color:'var(--green)'}}>{(s.validation||{}).matches || 0} OK</strong>
                        {(s.validation||{}).mismatch_count > 0 && <span> · <strong style={{color:'var(--gold)'}}>{s.validation.mismatch_count} écart(s)</strong></span>}
                    </div>
                    {(s.validation||{}).mismatches && s.validation.mismatches.length > 0 && (
                        <details style={{marginBottom:6}}>
                            <summary style={{fontSize:11,cursor:'pointer',color:'var(--gray-500)'}}>Voir les écarts</summary>
                            <div style={{maxHeight:150,overflowY:'auto',marginTop:6}}>
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                                    <thead><tr style={{background:'var(--gray-100)'}}>
                                        <th style={{textAlign:'left',padding:'3px 5px'}}>Ferme</th><th style={{textAlign:'left',padding:'3px 5px'}}>Article</th>
                                        <th style={{textAlign:'right',padding:'3px 5px'}}>Calculé</th><th style={{textAlign:'right',padding:'3px 5px'}}>Réel</th><th style={{textAlign:'right',padding:'3px 5px'}}>Δ</th>
                                    </tr></thead>
                                    <tbody>
                                        {s.validation.mismatches.map((m, i) => (
                                            <tr key={i} style={{borderTop:'1px solid var(--gray-100)'}}>
                                                <td style={{padding:'3px 5px'}}>{m.farm}</td><td style={{padding:'3px 5px'}}>{m.article}</td>
                                                <td style={{textAlign:'right',padding:'3px 5px'}}>{m.computed}</td><td style={{textAlign:'right',padding:'3px 5px'}}>{m.reel}</td>
                                                <td style={{textAlign:'right',padding:'3px 5px',color: Math.abs(m.delta) > 0 ? 'var(--red)' : 'inherit'}}>{m.delta}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </details>
                    )}
                    {(s.warnings || []).length > 0 && (
                        <div style={{padding:8,background:'rgba(212,168,71,0.1)',borderRadius:6,fontSize:10.5,marginBottom:6}}>
                            {s.warnings.slice(0, 5).map((w, i) => <div key={i}><i className="fa-solid fa-circle-info" style={{marginRight:5,color:'var(--gold)'}}></i>{w}</div>)}
                        </div>
                    )}
                </div>
            );
        }

export { CanevaSummaryView };
