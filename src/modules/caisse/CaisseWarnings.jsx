/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaisseWarnings */


function CaisseWarnings({ warnings, ignored }) {
            if ((!warnings || !warnings.length) && (!ignored || !ignored.length)) return null;
            return (
                <div style={{marginTop:8}}>
                    {warnings && warnings.length > 0 && (
                        <div style={{padding:8,background:'rgba(212,168,71,0.1)',border:'1px solid rgba(212,168,71,0.3)',borderRadius:6,fontSize:10.5,color:'var(--gray-800)',marginBottom:6}}>
                            <strong><i className="fa-solid fa-triangle-exclamation" style={{marginRight:5,color:'var(--gold)'}}></i>{warnings.length} alerte(s)</strong>
                            <ul style={{margin:'4px 0 0 0',paddingLeft:16}}>
                                {warnings.slice(0, 6).map((w, i) => <li key={i}>{w.sheet ? <em>{w.sheet}</em> : null} {w.message}{w.raw ? ` (« ${w.raw} »)` : ''}</li>)}
                                {warnings.length > 6 && <li>… +{warnings.length - 6} autre(s)</li>}
                            </ul>
                        </div>
                    )}
                    {ignored && ignored.length > 0 && (
                        <div style={{fontSize:10.5,color:'var(--gray-500)'}}>
                            <i className="fa-solid fa-circle-info" style={{marginRight:5}}></i>
                            Feuilles ignorées : {ignored.map(s => s.name).join(', ')}
                        </div>
                    )}
                </div>
            );
        }

export { CaisseWarnings };
