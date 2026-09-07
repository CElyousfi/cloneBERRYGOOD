/* Popup du détail des charges sociales de la quinzaine.
 *
 * Extrait de QuinzaineTab. Bloc de rendu pur — aucun hook, aucun effet :
 * toutes ses entrées arrivent en props.
 */
function QuinzaineChargesSocialesPopup({ _chargesSociales, _nomOuvrierQz, currentPeriode, f2, setQuinzPopupKey }) {
    // Le détail par OUVRIER, non déclarés compris (à charges
    // nulles) : sans eux, la liste se lirait comme l'effectif
    // de la quinzaine alors qu'elle n'en montre qu'une part —
    // et des charges basses passeraient pour une anomalie de
    // calcul au lieu de ce qu'elles sont.
    const _csDetail = _chargesSociales ? _chargesSociales.detail : [];
    const _csTh = {padding:'8px 10px',textAlign:'right',fontSize:11,color:'var(--gray-500)',fontWeight:600,borderBottom:'1px solid var(--gray-200)'};
    const _csThL = {..._csTh, textAlign:'left'};
    const _csTd = {padding:'6px 10px',textAlign:'right',fontSize:12};
    const _csTdL = {..._csTd, textAlign:'left', fontWeight:500};
    return (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
            onClick={() => setQuinzPopupKey(null)}>
            <div style={{background:'#fff',borderRadius:16,maxWidth:1180,width:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}
                onClick={e => e.stopPropagation()}>
                <div style={{padding:'20px 24px',background:'linear-gradient(135deg, #3949ab 0%, #5c6bc0 100%)',borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,zIndex:1}}>
                    <div>
                        <div style={{fontSize:18,fontWeight:700}}><i className="fa-solid fa-building-columns" style={{marginRight:8}}></i>Charges Sociales — {currentPeriode}</div>
                        <div style={{fontSize:12,opacity:0.85,marginTop:4}}>
                            {_chargesSociales ? _chargesSociales.nbDeclares : 0} déclaré{(_chargesSociales && _chargesSociales.nbDeclares !== 1) ? 's' : ''} sur {_csDetail.length} ouvrier{_csDetail.length !== 1 ? 's' : ''}
                            {' — '}{Math.round(_chargesSociales ? _chargesSociales.total : 0).toLocaleString('fr-FR')} DH
                        </div>
                    </div>
                    <button onClick={() => setQuinzPopupKey(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div style={{padding:'16px 24px'}}>
                    {_csDetail.length === 0 ? (
                        <div style={{color:'var(--gray-400)',fontSize:13,fontStyle:'italic',textAlign:'center',padding:'24px 0'}}>Registre de paie non chargé — aucun détail à afficher.</div>
                    ) : (
                    <table style={{width:'100%',borderCollapse:'collapse'}}>
                        <thead>
                            <tr>
                                <th style={_csThL}>Ouvrier</th>
                                <th style={_csThL}>Statut</th>
                                <th style={_csTh}>Jours</th>
                                <th style={_csTh}>Brut</th>
                                {/* CNSS et AMO sur DEUX colonnes : ce sont deux
                                    cotisations, à deux taux, sur deux lignes du
                                    bulletin. Un total qu'on ne peut pas
                                    décomposer est un total qu'on ne peut pas
                                    vérifier contre une fiche de paie. */}
                                <th style={_csTh} title="Cotisation salariale CNSS, 4,48 % du brut.">CNSS 4,48%</th>
                                <th style={_csTh} title="Assurance Maladie Obligatoire, part salariale, 2,26 % du brut.">AMO 2,26%</th>
                                <th style={_csTh} title="Brut − CNSS − AMO : ce que l'ouvrier touche.">Net à payer</th>
                                <th style={_csTh} title="Charges patronales, 19,26 % du brut.">Patronales 19,26%</th>
                                <th style={_csTh} title="Brut + charges patronales.">Coût employeur</th>
                            </tr>
                        </thead>
                        <tbody>
                            {_csDetail.map((w, i) => (
                                <tr key={w.matricule} style={{background: i % 2 ? '#f8f9fc' : '#fff', borderBottom:'1px solid var(--gray-100)'}}>
                                    <td style={_csTdL}>{_nomOuvrierQz(w.matricule)}<span style={{color:'var(--gray-400)',fontSize:10,marginLeft:6}}>{w.matricule}</span></td>
                                    <td style={{..._csTdL, fontWeight:400}}>
                                        <span style={{background: w.declare ? 'var(--green-pale)' : 'var(--gray-100)', color: w.declare ? 'var(--green)' : 'var(--gray-500)', padding:'2px 8px', borderRadius:6, fontSize:10, fontWeight:700}}>
                                            {w.declare ? 'Déclaré' : 'Non déclaré'}
                                        </span>
                                    </td>
                                    <td style={_csTd}>{w.jours}</td>
                                    <td style={_csTd}>{f2(w.brut)}</td>
                                    <td style={{..._csTd, color:'#c0392b'}}>{w.cnss > 0 ? '−' + f2(w.cnss) : '—'}</td>
                                    <td style={{..._csTd, color:'#c0392b'}}>{w.amo > 0 ? '−' + f2(w.amo) : '—'}</td>
                                    <td style={{..._csTd, color:'var(--green)', fontWeight:600}}>{f2(w.net)}</td>
                                    <td style={{..._csTd, color:'#3949ab'}}>{w.patronales > 0 ? '+' + f2(w.patronales) : '—'}</td>
                                    <td style={{..._csTd, fontWeight:700}}>{f2(w.coutEmployeur)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr style={{background:'#eef0ff',fontWeight:700}}>
                                <td style={_csTdL} colSpan={2}>TOTAL</td>
                                <td style={_csTd}>{_csDetail.reduce((s, w) => s + w.jours, 0)}</td>
                                <td style={_csTd}>{f2(_csDetail.reduce((s, w) => s + w.brut, 0))}</td>
                                <td style={{..._csTd, color:'#c0392b'}}>−{f2(_chargesSociales.cnss)}</td>
                                <td style={{..._csTd, color:'#c0392b'}}>−{f2(_chargesSociales.amo)}</td>
                                <td style={{..._csTd, color:'var(--green)'}}>{f2(_csDetail.reduce((s, w) => s + w.net, 0))}</td>
                                <td style={{..._csTd, color:'#3949ab'}}>+{f2(_chargesSociales.patronales)}</td>
                                <td style={_csTd}>{f2(_csDetail.reduce((s, w) => s + w.coutEmployeur, 0))}</td>
                            </tr>
                        </tfoot>
                    </table>
                    )}
                    <div style={{marginTop:12,fontSize:10.5,color:'var(--gray-500)'}}>
                        <i className="fa-solid fa-circle-info" style={{marginRight:6}}></i>
                        Un ouvrier NON déclaré n'appelle ni cotisation salariale ni charge patronale :
                        son brut EST son coût. C'est le modèle, pas un oubli — et c'est ce qui explique
                        des charges basses au regard de la masse salariale.
                    </div>
                </div>
            </div>
        </div>
    );
}

export { QuinzaineChargesSocialesPopup };
