/* Tableau « Détail par Ouvrier » de la quinzaine : une ligne par matricule, avec son équipe, ses jours et son coût.
 *
 * Extrait de QuinzaineTab. Bloc de rendu pur — aucun hook, aucun effet :
 * toutes ses entrées arrivent en props.
 */
import * as PaieUtils from '../shared/lib/paieUtils.js';

function QuinzaineDetailParOuvrier({ cultureFilter, currentPeriode, detailEquipeFilter, detailOuvrierFullscreen, detailSearch, farmFilter, getEqPrefix, matchCulture, moHorsRecolteRows, moPostesRows, numKey, parJour, prefixToName, quinzPaieBaremes, quinzRegistry, recolteEquipeRows, setDetailEquipeFilter, setDetailOuvrierFullscreen, setDetailSearch }) {
    // Build map: matricule → { equipe, equipePrefix, nom, joursSet }
    // Sources: moHorsRecolteRows + moPostesRows + recolteEquipeRows (filtrés période/ferme)
    const _allMoRowsDetail = [
        ...moHorsRecolteRows,
        ...moPostesRows,
        ...recolteEquipeRows.filter(r => (r.periode||'').trim() === currentPeriode.trim() && (!farmFilter || r.ferme === farmFilter) && matchCulture(r, cultureFilter)),
    ];
    const _wDetailMap = {};
    _allMoRowsDetail.forEach(function(r) {
        if (!r.matricule) return;
        const _key = numKey(r.matricule);
        if (!_wDetailMap[_key]) {
            const _prefix = getEqPrefix(r.matricule) || 'NV';
            const _reg = quinzRegistry[_key] || {};
            const _nom = window.nomOuvrier(_reg.prenom, _reg.nom, r.nom || r.matricule);
            _wDetailMap[_key] = {
                matricule: r.matricule,
                nom: _nom,
                equipePrefix: _prefix,
                equipe: prefixToName[_prefix] || _prefix,
                joursSet: new Set(),
                declare: !!(_reg.declare),
                primeFonctionJournaliere: Number(_reg.primeFonctionJournaliere || 0),
                baselineJours: Number(_reg.baselineJours || 0),
            };
        }
        if (r.jour) _wDetailMap[_key].joursSet.add(r.jour);
    });

    // Résoudre SMAG pour la période (même pattern que le module de coût)
    const _PUd = PaieUtils;
    const _firstDayD = parJour.length > 0 ? parJour[0].jour : null;
    const _smagD = (_PUd && _PUd.resolveSmagForDate)
        ? _PUd.resolveSmagForDate(quinzPaieBaremes, _firstDayD)
        : { smagBrutJournalier: (quinzPaieBaremes.smagBrutJournalier || 97.44), smagNetJournalier: (quinzPaieBaremes.smagNetJournalier || 0) };
    const _smagBrutJ = _smagD.smagBrutJournalier || 97.44;
    const TAUX_CNSS = 0.0448;
    const TAUX_AMO = 0.0226;

    // Calcule net/jour et net quinzaine pour un worker
    const _calcNet = function(w) {
        var jours = w.joursSet.size;
        if (jours === 0) return { netJour: 0, netTotal: 0 };
        var ancTaux = 0;
        if (_PUd && _PUd.trouverPalierAnciennete) {
            var pal = _PUd.trouverPalierAnciennete(w.baselineJours, quinzPaieBaremes.paliers || []);
            ancTaux = (pal.pourcentage || 0) / 100;
        }
        var smagBase = _smagBrutJ * jours;
        var primeFonc = w.primeFonctionJournaliere * jours;
        var anciennete = smagBase * ancTaux;
        var brutTotal = smagBase + primeFonc + anciennete;
        var cnss = w.declare ? brutTotal * TAUX_CNSS : 0;
        var amo = w.declare ? brutTotal * TAUX_AMO : 0;
        var netTotal = Math.round(brutTotal - cnss - amo);
        var netJour = jours > 0 ? Math.round((brutTotal - cnss - amo) / jours) : 0;
        return { netJour: netJour, netTotal: netTotal };
    };

    // Collect all days from parJour
    const _days = parJour.map(function(d) { return d.jour; });

    // Build sorted worker list
    let _workerList = Object.values(_wDetailMap)
        .sort(function(a, b) {
            const eq = a.equipe.localeCompare(b.equipe);
            if (eq !== 0) return eq;
            return a.matricule.localeCompare(b.matricule);
        });

    // Collect distinct equipes for filter dropdown
    const _equipes = [];
    const _equipesSeen = new Set();
    _workerList.forEach(function(w) {
        if (!_equipesSeen.has(w.equipe)) { _equipesSeen.add(w.equipe); _equipes.push(w.equipe); }
    });

    // Apply equipe filter
    if (detailEquipeFilter) {
        _workerList = _workerList.filter(function(w) { return w.equipe === detailEquipeFilter; });
    }

    // Apply search filter (matricule or nom, case-insensitive)
    if (detailSearch.trim()) {
        const _sq = detailSearch.trim().toLowerCase();
        _workerList = _workerList.filter(function(w) {
            return (w.matricule || '').toLowerCase().includes(_sq) || (w.nom || '').toLowerCase().includes(_sq);
        });
    }

    const _exceeded = _workerList.length > 500;
    if (_exceeded) _workerList = _workerList.slice(0, 500);

    // Group by equipe for sub-totals
    const _groupedEquipes = [];
    let _curEq = null;
    _workerList.forEach(function(w) {
        if (w.equipe !== _curEq) {
            _curEq = w.equipe;
            _groupedEquipes.push({ equipe: w.equipe, workers: [] });
        }
        _groupedEquipes[_groupedEquipes.length - 1].workers.push(w);
    });

    if (_days.length === 0 || _workerList.length === 0) return null;

    // ─ Tableau réutilisable (normal + fullscreen) ─
    const _renderTable = function(isFS) {
        return (
            <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch',borderRadius: isFS ? 0 : 10,border: isFS ? 'none' : '1px solid var(--gray-200)'}}>
                <table style={{borderCollapse:'collapse',fontSize:12,minWidth:'100%'}}>
                    <thead>
                        <tr style={{background:'var(--gray-50)',position:'sticky',top:0,zIndex:2}}>
                            <th style={{padding:'7px 8px',textAlign:'left',fontWeight:600,color:'var(--gray-600)',position:'sticky',left:0,background:'var(--gray-50)',borderRight:'1px solid var(--gray-200)',zIndex:3,whiteSpace:'nowrap',minWidth:70,maxWidth:90,overflow:'hidden',textOverflow:'ellipsis'}}>Équipe</th>
                            <th style={{padding:'7px 6px',textAlign:'left',fontWeight:600,color:'var(--gray-600)',whiteSpace:'nowrap',minWidth:55,maxWidth:55,borderRight:'1px solid var(--gray-100)'}}>Mat.</th>
                            <th style={{padding:'7px 8px',textAlign:'left',fontWeight:600,color:'var(--gray-600)',position:'sticky',left:125,background:'var(--gray-50)',borderRight:'1px solid var(--gray-200)',zIndex:3,whiteSpace:'nowrap',minWidth:100,maxWidth:140,overflow:'hidden',textOverflow:'ellipsis'}}>Nom</th>
                            {_days.map(function(jour) {
                                const _d = new Date(jour);
                                const _dow = _d.getDay();
                                const _isWE = _dow === 0 || _dow === 6;
                                const _dayNum = _d.getDate();
                                return (
                                    <th key={jour} style={{padding:'4px 2px',textAlign:'center',fontWeight:600,color: _isWE ? 'var(--berry)' : 'var(--gray-600)',width:26,minWidth:26,maxWidth:26,background: _isWE ? '#fdf2f8' : 'var(--gray-50)',borderRight:'1px solid var(--gray-100)'}}>
                                        {_dayNum}
                                    </th>
                                );
                            })}
                            <th style={{padding:'7px 8px',textAlign:'center',fontWeight:700,color:'var(--gray-700)',background:'var(--gray-100)',whiteSpace:'nowrap',minWidth:52,borderRight:'1px solid var(--gray-200)'}}>Total</th>
                            <th style={{padding:'7px 6px',textAlign:'center',fontWeight:700,color:'#7c6b00',background:'#fffde7',whiteSpace:'nowrap',minWidth:55,borderRight:'1px solid #e8d500'}}>Net/j</th>
                            <th style={{padding:'7px 8px',textAlign:'center',fontWeight:700,color:'var(--berry)',background:'#e8f5e9',whiteSpace:'nowrap',minWidth:65,position:'sticky',right:0,zIndex:3}}>Net Q</th>
                        </tr>
                    </thead>
                    <tbody>
                        {_groupedEquipes.map(function(grp) {
                            const _grpTotalDays = grp.workers.reduce(function(s, w) { return s + w.joursSet.size; }, 0);
                            const _grpNetTotal = grp.workers.reduce(function(s, w) { return s + _calcNet(w).netTotal; }, 0);
                            return [
                                <tr key={'eq-' + grp.equipe} style={{background:'var(--gray-100)'}}>
                                    <td colSpan={3 + _days.length + 3} style={{padding:'5px 10px',fontWeight:700,fontSize:11,color:'var(--gray-600)',position:'sticky',left:0,borderBottom:'1px solid var(--gray-200)'}}>
                                        {grp.equipe} — {grp.workers.length} ouvrier{grp.workers.length > 1 ? 's' : ''} — {_grpTotalDays} jour{_grpTotalDays > 1 ? 's' : ''} totaux
                                        <span style={{marginLeft:12,color:'var(--berry)',fontWeight:700}}>{_grpNetTotal.toLocaleString('fr-FR')} DH net</span>
                                    </td>
                                </tr>,
                                ...grp.workers.map(function(w, wIdx) {
                                    const _net = _calcNet(w);
                                    const _bg = wIdx % 2 === 0 ? '#fff' : '#fafbfc';
                                    return (
                                        <tr key={w.matricule} style={{background: _bg,borderBottom:'1px solid var(--gray-100)'}}>
                                            <td style={{padding:'5px 8px',color:'var(--gray-500)',fontSize:11,position:'sticky',left:0,background: _bg,borderRight:'1px solid var(--gray-200)',zIndex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:90}}>{w.equipe}</td>
                                            <td style={{padding:'5px 6px',fontFamily:'monospace',fontSize:11,color:'var(--gray-600)',whiteSpace:'nowrap',borderRight:'1px solid var(--gray-100)',maxWidth:55}}>{w.matricule}</td>
                                            <td style={{padding:'5px 8px',fontWeight:500,color:'var(--gray-700)',position:'sticky',left:125,background: _bg,borderRight:'1px solid var(--gray-200)',zIndex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:140}}>{w.nom}</td>
                                            {_days.map(function(jour) {
                                                const _d = new Date(jour);
                                                const _dow = _d.getDay();
                                                const _isWE = _dow === 0 || _dow === 6;
                                                const _worked = w.joursSet.has(jour);
                                                return (
                                                    <td key={jour} style={{padding:'4px 2px',textAlign:'center',width:26,minWidth:26,maxWidth:26,color: _worked ? 'var(--berry)' : 'var(--gray-300)',background: _isWE ? '#fdf2f818' : '',fontWeight: _worked ? 700 : 400,borderRight:'1px solid var(--gray-100)'}}>
                                                        {_worked ? '✓' : ''}
                                                    </td>
                                                );
                                            })}
                                            <td style={{padding:'5px 8px',textAlign:'center',fontWeight:700,color:'var(--gray-700)',background:'var(--gray-100)',borderRight:'1px solid var(--gray-200)'}}>{w.joursSet.size}</td>
                                            <td style={{padding:'5px 6px',textAlign:'center',fontWeight:500,color:'#7c6b00',background:'#fffde7',borderRight:'1px solid #e8d500'}}>{_net.netJour}</td>
                                            <td style={{padding:'5px 8px',textAlign:'center',fontWeight:700,color:'var(--berry)',background:'#e8f5e9',position:'sticky',right:0,zIndex:1}}>{_net.netTotal.toLocaleString('fr-FR')}</td>
                                        </tr>
                                    );
                                }),
                            ];
                        })}
                    </tbody>
                    <tfoot>
                        {(() => {
                            const _totalJH = _workerList.reduce(function(s, w) { return s + w.joursSet.size; }, 0);
                            const _totalNetQ = _workerList.reduce(function(s, w) { return s + _calcNet(w).netTotal; }, 0);
                            return (
                                <tr style={{background:'var(--berry)',color:'#fff',fontWeight:700}}>
                                    <td colSpan={3} style={{padding:'8px 12px',textAlign:'left',position:'sticky',left:0,background:'var(--berry)',zIndex:2}}>TOTAL QUINZAINE</td>
                                    {_days.map(function(jour) {
                                        return <td key={jour} style={{width:26,minWidth:26,maxWidth:26}}></td>;
                                    })}
                                    <td style={{padding:'8px 8px',textAlign:'right',background:'rgba(0,0,0,0.15)',fontWeight:700}}>{_totalJH} j</td>
                                    <td style={{padding:'8px 8px',textAlign:'right',background:'#fffde7',color:'#7c6b00'}}></td>
                                    <td style={{padding:'8px 12px',textAlign:'right',background:'#e8f5e9',color:'var(--berry)',position:'sticky',right:0,zIndex:2,fontWeight:700}}>{_totalNetQ.toLocaleString('fr-FR')} DH</td>
                                </tr>
                            );
                        })()}
                    </tfoot>
                </table>
            </div>
        );
    };

    return (
        <>
            {/* Vue plein écran */}
            {detailOuvrierFullscreen && (
                <div style={{position:'fixed',inset:0,zIndex:1000,background:'#fff',overflowY:'auto',padding:24}}>
                    <div style={{marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
                        <div style={{fontSize:16,fontWeight:700,color:'var(--gray-700)',display:'flex',alignItems:'center',gap:8}}>
                            <i className="fa-solid fa-users" style={{color:'var(--berry)'}}></i>
                            Détail par Ouvrier
                            <span style={{fontSize:13,fontWeight:400,color:'var(--gray-500)'}}>— {currentPeriode}</span>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                            <input type="text" placeholder="Rechercher matricule ou nom…" value={detailSearch} onChange={function(e){setDetailSearch(e.target.value);}}
                                style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'6px 12px',fontSize:13,width:220,outline:'none'}} />
                            <select value={detailEquipeFilter} onChange={function(e){setDetailEquipeFilter(e.target.value);}}
                                style={{padding:'5px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12,color:'var(--gray-700)',background:'#fff',cursor:'pointer'}}>
                                <option value="">Toutes les équipes</option>
                                {_equipes.map(function(eq) { return <option key={eq} value={eq}>{eq}</option>; })}
                            </select>
                            <button onClick={function(){setDetailOuvrierFullscreen(false);}}
                                style={{background:'#f44336',color:'#fff',border:'none',borderRadius:8,padding:'7px 14px',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
                                <i className="fa-solid fa-xmark"></i> Fermer
                            </button>
                        </div>
                    </div>
                    {_exceeded && (
                        <div style={{marginBottom:8,padding:'6px 12px',background:'#fff3cd',borderRadius:8,fontSize:12,color:'#856404',border:'1px solid #ffc107'}}>
                            <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                            Affichage limité à 500 ouvriers.
                        </div>
                    )}
                    {_renderTable(true)}
                </div>
            )}
            {/* Vue normale */}
            <div style={{marginTop:24}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
                    <div style={{fontSize:14,fontWeight:700,color:'var(--gray-700)',display:'flex',alignItems:'center',gap:8}}>
                        <i className="fa-solid fa-users" style={{color:'var(--berry)'}}></i>
                        Détail par Ouvrier
                        <span style={{fontSize:12,fontWeight:400,color:'var(--gray-500)'}}>— {currentPeriode}</span>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                        <input type="text" placeholder="Rechercher matricule ou nom…" value={detailSearch} onChange={function(e){setDetailSearch(e.target.value);}}
                            style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'6px 12px',fontSize:13,width:220,outline:'none'}} />
                        <select value={detailEquipeFilter} onChange={function(e){setDetailEquipeFilter(e.target.value);}}
                            style={{padding:'5px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12,color:'var(--gray-700)',background:'#fff',cursor:'pointer'}}>
                            <option value="">Toutes les équipes</option>
                            {_equipes.map(function(eq) { return <option key={eq} value={eq}>{eq}</option>; })}
                        </select>
                        <button onClick={function(){setDetailOuvrierFullscreen(true);}} title="Plein écran"
                            style={{background:'#6366f1',color:'#fff',border:'none',borderRadius:8,padding:'5px 10px',fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',gap:5}}>
                            <i className="fa-solid fa-expand"></i>
                        </button>
                    </div>
                </div>
                {_exceeded && (
                    <div style={{marginBottom:8,padding:'6px 12px',background:'#fff3cd',borderRadius:8,fontSize:12,color:'#856404',border:'1px solid #ffc107'}}>
                        <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                        Affichage limité à 500 ouvriers.
                    </div>
                )}
                {_renderTable(false)}
            </div>
        </>
    );
}

export { QuinzaineDetailParOuvrier };
