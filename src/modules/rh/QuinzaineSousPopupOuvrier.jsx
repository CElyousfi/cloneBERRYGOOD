/* Sous-popup « jour par jour » d'un ouvrier, ouvert depuis n'importe quelle
 * carte de la quinzaine.
 *
 * Extrait de QuinzaineTab. Ne lit que six valeurs de la portée du composant,
 * toutes passées en props — c'est le bloc le moins couplé des popups, et le
 * premier sorti pour cette raison.
 */
function QuinzaineSousPopupOuvrier({ f2, numKey, quinzPaieBaremes, quinzRegistry, quinzSubWorker, setQuinzSubWorker }) {
    const _sw = quinzSubWorker;
    const _swDays = (_sw.quinzaineDays || []);
    const _swColor = _sw.popupColor || 'var(--berry)';
    // Pay bulletin compute
    const _reg = quinzRegistry[numKey(_sw.matricule)] || {};
    const _declare = !!(_reg.declare);
    const _primeFonctionJour = Number(_reg.primeFonctionJournaliere || 0);
    const _anciennete = Number(_reg.baselineJours || 0);
    const _PU = window.PaieUtils;
    const _firstDay = _sw.jours ? [..._sw.jours].sort()[0] : null;
    const _smag = (_PU && _PU.resolveSmagForDate)
        ? _PU.resolveSmagForDate(quinzPaieBaremes, _firstDay)
        : { smagBrutJournalier: quinzPaieBaremes.smagBrutJournalier || 0, smagNetJournalier: quinzPaieBaremes.smagNetJournalier || 0 };
    const _ancPalier = (_PU && _PU.trouverPalierAnciennete)
        ? _PU.trouverPalierAnciennete(_anciennete, quinzPaieBaremes.paliers || [])
        : { pourcentage: 0 };
    const _ancTaux = (_ancPalier.pourcentage || 0) / 100;
    const _paie = (_PU && _PU.computePayslip)
        ? _PU.computePayslip({
            declare: _declare,
            smagBrut: _smag.smagBrutJournalier,
            smagNet: _smag.smagNetJournalier,
            jT: (_sw.parcelleJours != null ? _sw.parcelleJours : _sw.journees),
            jF: 0,
            ancienneteTaux: _ancTaux,
            primeFonctionJour: _primeFonctionJour,
            primesOptionnelles: [],
            baremes: quinzPaieBaremes,
        })
        : null;
    const _hasRegistry = Object.keys(_reg).length > 0;
    return (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.6)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
            onClick={() => setQuinzSubWorker(null)}>
            <div style={{background:'#fff',borderRadius:16,maxWidth:600,width:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 24px 64px rgba(0,0,0,0.4)'}}
                onClick={e => e.stopPropagation()}>
                <div style={{padding:'16px 20px',background:`linear-gradient(135deg, ${_swColor} 0%, ${_swColor}cc 100%)`,borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div>
                        <div style={{fontSize:16,fontWeight:700,display:'flex',alignItems:'center',gap:8}}>
                            {_sw.nom}
                            {_hasRegistry && (
                                <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:10,background: _declare ? 'rgba(255,255,255,0.25)' : 'rgba(231,76,60,0.7)',letterSpacing:0.5}}>
                                    {_declare ? 'DÉCLARÉ CNSS' : 'NON DÉCLARÉ'}
                                </span>
                            )}
                        </div>
                        <div style={{fontSize:11,opacity:0.85,marginTop:2}}>
                            {_sw.matricule} · {_sw.operationsStr}
                        </div>
                        <div style={{fontSize:12,marginTop:4,display:'flex',gap:16}}>
                            {_sw.parcelleJours != null
                                ? <span><strong>{_sw.parcelleJours}</strong> jours <span style={{fontSize:10,opacity:0.7}}>({_sw.journees} tot.)</span></span>
                                : <span><strong>{_sw.journees}</strong> / {_swDays.length} jours</span>
                            }
                            {_sw.parcelleCout != null
                                ? <span><strong>{_sw.parcelleCout.toLocaleString('fr-FR')}</strong> DH net <span style={{fontSize:10,opacity:0.7}}>(part parcelle)</span></span>
                                : <span><strong>{_sw.coutTotal.toLocaleString('fr-FR')}</strong> DH net BDP</span>
                            }
                        </div>
                    </div>
                    <button onClick={() => setQuinzSubWorker(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div style={{padding:'16px 20px'}}>
                    {/* Jours travaillés */}
                    <div style={{fontSize:11,color:'var(--gray-500)',marginBottom:8}}>
                        {_sw.parcelleDays
                            ? <><span style={{color:'#27ae60',marginRight:4}}>●</span><strong>{_sw.parcelleDays.length}</strong> jours sur cette parcelle <span style={{color:'var(--gray-400)'}}>({[..._sw.jours].length} au total)</span></>
                            : <><span style={{color:'#27ae60',marginRight:4}}>●</span>Jours pointés ({[..._sw.jours].length} jour{[..._sw.jours].length !== 1 ? 's' : ''})</>
                        }
                    </div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:16}}>
                        {[..._sw.jours].sort().map(day => {
                            const label = (() => { const d = new Date(day + 'T00:00:00'); return d.toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit'}); })();
                            const _inParcelle = !_sw.parcelleDays || _sw.parcelleDays.includes(day);
                            return (
                                <div key={day} style={{display:'flex',alignItems:'center',gap:4,padding:'5px 10px',borderRadius:8,
                                    background: _inParcelle ? '#eafaf1' : '#f0f0f0',
                                    border: `1px solid ${_inParcelle ? '#27ae60' : '#bbb'}`,
                                    fontSize:11, fontWeight: _inParcelle ? 600 : 400,
                                    color: _inParcelle ? '#1a7a4a' : '#888'}}>
                                    <span style={{fontSize:12}}>{_inParcelle ? '●' : '○'}</span>{label}
                                </div>
                            );
                        })}
                    </div>

                    {/* Pay bulletin */}
                    {_paie && (
                    <div style={{background:'var(--berry-pale)',borderRadius:10,padding:14}}>
                        <div style={{fontSize:11,color:'var(--gray-400)',marginBottom:10}}>
                            Estimation paie quinzaine — modèle complet ({_declare ? 'déclaré' : 'non déclaré'}).
                        </div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:16}}>
                            {/* Bulletin ouvrier */}
                            <div style={{flex:'1 1 180px',minWidth:180}}>
                                <div style={{fontSize:11,fontWeight:700,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:0.5,marginBottom:8}}>Bulletin ouvrier</div>
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>{_declare ? `SMAG base : ${f2(_paie.smagBase)} DH/j × ${_paie.jT} j` : `Base net (non déclaré) : ${f2(_paie.smagBase)} DH/j × ${_paie.jT} j`}</span>
                                    <span style={{fontWeight:600}}>{f2(_paie.base)}</span>
                                </div>
                                {_declare && (
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>Ancienneté {Math.round(_paie.ancienneteTaux * 100)}% ({_anciennete} jr)</span>
                                    <span style={{fontWeight:600,color: _paie.anciennete > 0 ? 'var(--berry)' : 'var(--gray-400)'}}>{_paie.anciennete > 0 ? `+${f2(_paie.anciennete)}` : '0,00'}</span>
                                </div>
                                )}
                                {_paie.primeFonction > 0 && (
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>Prime fonction</span>
                                    <span style={{fontWeight:600,color:'var(--berry)'}}>+{f2(_paie.primeFonction)}</span>
                                </div>
                                )}
                                {_declare && (
                                <div style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid var(--gray-200)',paddingTop:8,marginTop:4,marginBottom:8}}>
                                    <span style={{fontWeight:700,color:'var(--gray-700)'}}>= Salaire brut</span>
                                    <span style={{fontWeight:700,fontSize:14,color:'var(--gray-700)'}}>{f2(_paie.brut)} DH</span>
                                </div>
                                )}
                                {_declare && (
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>CNSS ({(_paie.tauxCnss * 100).toFixed(2).replace('.', ',')}%)</span>
                                    <span style={{fontWeight:600,color:'var(--red)'}}>−{f2(_paie.cnss)}</span>
                                </div>
                                )}
                                {_declare && (
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>AMO ({(_paie.tauxAmo * 100).toFixed(2).replace('.', ',')}%)</span>
                                    <span style={{fontWeight:600,color:'var(--red)'}}>−{f2(_paie.amo)}</span>
                                </div>
                                )}
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'2px solid var(--green)',paddingTop:8,marginTop:4}}>
                                    <span style={{fontWeight:800,color:'var(--green)',fontSize:13}}>= Net à payer</span>
                                    <span style={{fontWeight:800,fontSize:17,color:'var(--green)'}}>{f2(_paie.net)} DH</span>
                                </div>
                            </div>
                            {/* Séparateur */}
                            <div style={{width:1,alignSelf:'stretch',background:'var(--gray-200)'}}></div>
                            {/* Coût employeur */}
                            <div style={{flex:'1 1 180px',minWidth:180}}>
                                <div style={{fontSize:11,fontWeight:700,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:0.5,marginBottom:8}}>Coût employeur</div>
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>Salaire brut</span>
                                    <span style={{fontWeight:600}}>{f2(_paie.brut)}</span>
                                </div>
                                {_declare && (
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>Charges patronales ({(_paie.tauxChargesPatronales * 100).toFixed(2).replace('.', ',')}%)</span>
                                    <span style={{fontWeight:600,color:'var(--gray-500)'}}>+{f2(_paie.chargesPatronales)}</span>
                                </div>
                                )}
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'2px solid var(--berry)',paddingTop:8,marginTop:4}}>
                                    <span style={{fontWeight:800,color:'var(--berry)',fontSize:13}}>= Coût employeur</span>
                                    <span style={{fontWeight:800,fontSize:17,color:'var(--berry)'}}>{f2(_paie.coutEmployeur)} DH</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export { QuinzaineSousPopupOuvrier };
