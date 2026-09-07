/* Popup GÉNÉRIQUE des cartes de la quinzaine (main-d'oeuvre, primes, transport). Une seule popup sert toutes les cartes qui n'ont pas de traitement particulier.
 *
 * Extrait de QuinzaineTab. Bloc de rendu pur — aucun hook, aucun effet :
 * toutes ses entrées arrivent en props.
 */
function QuinzainePopupGenerique({ calcPrime, chargDetailQ, condDetailQ, coutMap, currentPeriode, data, f2, ferieDetailQ, fermeRateMap, getEqPrefix, moHorsRecolteRows, moPostesRows, moRecolteRows, numKey, parJour, prefixToName, qRecolteRows, quinzGroupBy, quinzPaieBaremes, quinzPopupKey, quinzRegistry, quinzSearch, sbNetForWorker, setQuinzChargesPopup, setQuinzGroupBy, setQuinzPopupKey, setQuinzSearch, setQuinzSubWorker, traitRows, transportRows }) {
    const _qpKey = quinzPopupKey;
    const _isMoCard = _qpKey === 'mo_recolte' || _qpKey === 'mo_horsrecolte' || _qpKey === 'mo_postes';
    const _qpTitle = _qpKey === 'mo_recolte' ? 'MO Récolte'
        : _qpKey === 'mo_horsrecolte' ? 'MO Hors Récolte'
        : _qpKey === 'mo_postes' ? 'Postes Fixes'
        : _qpKey === 'recolte' ? 'Prime Récolte'
        : _qpKey === 'transport' ? 'Prime Transport'
        : 'Autres Primes';
    const _qpColor = _qpKey === 'mo_recolte' ? 'var(--berry)'
        : _qpKey === 'mo_horsrecolte' ? '#c0392b'
        : _qpKey === 'mo_postes' ? '#7f8c8d'
        : _qpKey === 'recolte' ? 'var(--orange)'
        : _qpKey === 'transport' ? 'var(--green)'
        : '#8e44ad';
    const _qpIcon = _qpKey === 'mo_recolte' ? 'fa-seedling'
        : _qpKey === 'mo_horsrecolte' ? 'fa-person-digging'
        : _qpKey === 'mo_postes' ? 'fa-user-tie'
        : _qpKey === 'recolte' ? 'fa-coins'
        : _qpKey === 'transport' ? 'fa-bus'
        : 'fa-spray-can-sparkles';

    // Build source rows per card type
    // Note: r.cout dans les rows BDP transport est toujours 0 → calculé depuis coutMap.
    const _primeChargJour = data.primesConfig?.primeChargement?.coutParJour || 10;
    let _qpSrc = [];
    if (_qpKey === 'mo_recolte') {
        _qpSrc = moRecolteRows;
    } else if (_qpKey === 'mo_horsrecolte') {
        _qpSrc = moHorsRecolteRows;
    } else if (_qpKey === 'mo_postes') {
        _qpSrc = moPostesRows;
    } else if (_qpKey === 'recolte') {
        _qpSrc = qRecolteRows.map(r => ({
            matricule: r.matricule, nom: r.nom, ferme: r.ferme || '—',
            jour: r.jour, operation: 'Récolte',
            parcelle: r.parcelle || r.refParcelle || '',
            cout: calcPrime(r.kg || 0, r.variete, r.jour),
        }));
    } else if (_qpKey === 'autres_primes') {
        const _trSrc = traitRows.map(r => ({ ...r, operation: 'Traitement', cout: 10 }));
        const _condSrc = condDetailQ.map(w => ({
            matricule: w.matricule, nom: w.nom || w.matricule, ferme: w.ferme || '—',
            jour: w.jour || w.date || '', operation: 'Conditionnement', parcelle: w.parcelle || '',
            cout: 10,
        }));
        const _chargSrc = chargDetailQ.map(w => ({
            matricule: w.matricule, nom: w.nom || w.matricule, ferme: w.ferme || '—',
            jour: w.jour || w.date || '', operation: 'Chargement', parcelle: w.parcelle || '',
            cout: _primeChargJour,
        }));
        const _ferieSrc = ferieDetailQ.map(w => ({
            matricule: w.matricule, nom: w.nom || w.matricule, ferme: w.ferme || '—',
            jour: w.date || w.jour || '', operation: 'Jour Férié', parcelle: '',
            cout: w.cout || 0,
        }));
        _qpSrc = [..._trSrc, ..._condSrc, ..._chargSrc, ..._ferieSrc];
    } else {
        // transport: r.cout BDP = 0 → coût = tarif journalier par équipe
        _qpSrc = transportRows.map(r => ({
            ...r,
            cout: coutMap[getEqPrefix(r.matricule)] || 0,
        }));
    }

    // Aggregate per worker
    const _qpWMap = {};
    _qpSrc.forEach(r => {
        const mat = r.matricule;
        if (!_qpWMap[mat]) {
            const _qpReg = quinzRegistry[numKey(mat)] || {};
            const _qpNom = window.nomOuvrier(_qpReg.prenom, _qpReg.nom || r.nom, mat) || mat;
            _qpWMap[mat] = {
                matricule: mat, nom: _qpNom, ferme: r.ferme || '—',
                jours: new Set(), operations: new Set(), parcelles: new Set(),
                fermeJours: {}, parcelleJours: {}, heures: 0, cout: 0,
            };
        }
        if (r.jour) {
            _qpWMap[mat].jours.add(r.jour);
            if (r.ferme) _qpWMap[mat].fermeJours[r.jour] = r.ferme;
            // Jours pointés PAR parcelle — le regroupement « Parcelle » affiche la
            // part affectée à la parcelle, pas la quinzaine complète de l'ouvrier
            // (bug : sous-totaux gonflés ~3×, cf. comparaison Affectation Analytique).
            if (r.parcelle) {
                if (!_qpWMap[mat].parcelleJours[r.parcelle]) _qpWMap[mat].parcelleJours[r.parcelle] = new Set();
                _qpWMap[mat].parcelleJours[r.parcelle].add(r.jour);
            }
        }
        const op = r.operation || r.operationFamille;
        if (op) _qpWMap[mat].operations.add(op);
        if (r.parcelle) _qpWMap[mat].parcelles.add(r.parcelle); // Parcelle_Culturale uniquement, pas refParcelle (n° BDP)
        _qpWMap[mat].heures += r.heures || 0;
        _qpWMap[mat].cout += r.cout || 0;
    });
    const _qpWorkers = Object.values(_qpWMap)
        .sort((a, b) => (a.nom || '').localeCompare(b.nom || ''))
        .map(w => ({
            ...w,
            journees: w.jours.size,
            parcelleJournees: Object.fromEntries(Object.entries(w.parcelleJours).map(([p, s]) => [p, s.size])),
            operationsStr: [...w.operations].join(', ') || '—',
            parcellesArr: [...w.parcelles],
            parcellesStr: (() => { const a = [...w.parcelles]; if (!a.length) return '—'; if (a.length <= 3) return a.join(', '); return a.slice(0, 2).join(', ') + ' +' + (a.length - 2); })(),
            heuresTotal: Math.round(w.heures * 10) / 10,
            coutTotal: (() => {
                if (_isMoCard) {
                    // Smart Berry model — même calcul que les totaux cartes
                    const _firstDay = w.jours.size > 0 ? [...w.jours].sort()[0] : null;
                    const _sbNet = sbNetForWorker(w.matricule, w.jours.size, _firstDay);
                    if (_sbNet !== null) return _sbNet;
                    // Fallback BDP si registry pas encore chargé
                    return Math.round(Object.entries(w.fermeJours).reduce((s, [, ferme]) => s + (fermeRateMap[ferme] || 0), 0));
                }
                return Math.round(w.cout);
            })(),
        }));
    const _qpTotalJ = _qpWorkers.reduce((s, w) => s + w.journees, 0);

    // Grouping
    const _qpGetEq = (mat) => {
        const m = String(mat || '').toUpperCase().trim();
        if (m.startsWith('HAFI') || m.startsWith('HA')) return 'HA';
        const p2 = m.substring(0, 2);
        return /^[A-Z]{2}$/.test(p2) ? p2 : 'BGF';
    };
    const _qpGroupMap = {};
    _qpWorkers.forEach(w => {
        let gKeys = [];
        if (quinzGroupBy === 'equipe') gKeys = [_qpGetEq(w.matricule)];
        else if (quinzGroupBy === 'ferme') gKeys = [w.ferme || '—'];
        else gKeys = w.parcellesArr.length > 0 ? w.parcellesArr : ['—'];
        gKeys.forEach(gk => {
            if (!_qpGroupMap[gk]) {
                const gLabel = quinzGroupBy === 'equipe'
                    ? (prefixToName[gk] || `Équipe ${gk}`)
                    : gk;
                _qpGroupMap[gk] = { key: gk, label: gLabel, workers: [] };
            }
            if (!_qpGroupMap[gk].workers.find(x => x.matricule === w.matricule)) {
                _qpGroupMap[gk].workers.push(w);
            }
        });
    });
    const _qpGroups = Object.values(_qpGroupMap)
        .sort((a, b) => b.workers.length - a.workers.length);

    return (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
            onClick={() => { setQuinzPopupKey(null); setQuinzSubWorker(null); setQuinzSearch(''); }}>
            <div style={{background:'#fff',borderRadius:16,maxWidth:900,width:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}
                onClick={e => e.stopPropagation()}>
                <div style={{padding:'20px 24px',background:`linear-gradient(135deg, ${_qpColor} 0%, ${_qpColor}cc 100%)`,borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,zIndex:1}}>
                    <div>
                        <div style={{fontSize:18,fontWeight:700}}><i className={`fa-solid ${_qpIcon}`} style={{marginRight:8}}></i>{_qpTitle} — {currentPeriode}</div>
                        <div style={{fontSize:12,opacity:0.85,marginTop:4}}>{_qpWorkers.length} ouvrier{_qpWorkers.length !== 1 ? 's' : ''} — {_qpTotalJ} jours hommes{_isMoCard ? ' — ' + _qpWorkers.reduce((s, w) => s + w.coutTotal, 0).toLocaleString('fr-FR') + ' DH net' : ''}</div>
                    </div>
                    <button onClick={() => { setQuinzPopupKey(null); setQuinzSubWorker(null); setQuinzSearch(''); }} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div style={{padding:'12px 24px',borderBottom:'1px solid var(--gray-200)',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{fontSize:11,color:'var(--gray-500)',marginRight:4}}>Regrouper par :</span>
                    {[['equipe','Équipe'],['ferme','Ferme'],['parcelle','Parcelle']].map(([mode, label]) => (
                        <button key={mode}
                            onClick={() => setQuinzGroupBy(mode)}
                            style={{padding:'4px 12px',borderRadius:8,border:`1px solid ${quinzGroupBy === mode ? _qpColor : 'var(--gray-300)'}`,fontSize:11,
                                cursor:'pointer',fontWeight:600,
                                background: quinzGroupBy === mode ? _qpColor : 'transparent',
                                color: quinzGroupBy === mode ? '#fff' : 'var(--gray-600)'}}>
                            {label}
                        </button>
                    ))}
                    {quinzGroupBy === 'parcelle' && (
                        <span style={{fontSize:10,color:'var(--gray-400)',fontStyle:'italic'}}>
                            Jours & DH = part affectée à la parcelle (jours / total quinzaine)
                        </span>
                    )}
                    <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6,background:'var(--gray-50)',borderRadius:8,border:'1px solid var(--gray-300)',padding:'4px 10px'}}>
                        <i className="fa-solid fa-magnifying-glass" style={{fontSize:11,color:'var(--gray-400)'}}></i>
                        <input
                            type="text"
                            placeholder="Matricule, nom ou opération…"
                            value={quinzSearch}
                            onChange={e => setQuinzSearch(e.target.value)}
                            style={{border:'none',outline:'none',fontSize:12,background:'transparent',width:160,color:'var(--gray-700)'}}
                        />
                        {quinzSearch && (
                            <button onClick={() => setQuinzSearch('')} style={{border:'none',background:'none',cursor:'pointer',color:'var(--gray-400)',fontSize:12,padding:'0 2px',lineHeight:1}}>×</button>
                        )}
                    </div>
                </div>
                <div style={{padding:'16px 24px'}}>
                    {(() => {
                        const _sq = quinzSearch.trim().toLowerCase();
                        return _sq
                            ? _qpWorkers.filter(w => (w.nom || '').toLowerCase().includes(_sq) || (w.matricule || '').toLowerCase().includes(_sq) || (w.operationsStr || '').toLowerCase().includes(_sq)).length === 0
                            : _qpWorkers.length === 0;
                    })() ? (
                        <div style={{color:'var(--gray-400)',fontSize:13,fontStyle:'italic',textAlign:'center',padding:'24px 0'}}>Aucun ouvrier.</div>
                    ) : (
                    <div className="table-responsive">
                    <table className="data-table" style={{fontSize:12,margin:0}}>
                        <thead>
                            <tr style={{background:'var(--gray-50)'}}>
                                {_isMoCard && <th style={{padding:'6px 6px',textAlign:'center',width:28}}></th>}
                                <th style={{padding:'6px 10px'}}>Matricule</th>
                                <th style={{padding:'6px 10px'}}>Nom</th>
                                <th style={{padding:'6px 10px'}}>Opérations</th>
                                {!_isMoCard && <th style={{padding:'6px 10px'}}>Parcelles</th>}
                                <th style={{padding:'6px 10px',textAlign:'center'}}>Jours</th>
                                {!_isMoCard && <th style={{padding:'6px 10px',textAlign:'center'}}>Heures</th>}
                                <th style={{padding:'6px 10px',textAlign:'right'}}>{_isMoCard ? 'Net à payer (DH)' : 'Coût (DH)'}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(() => {
                                const _sq = quinzSearch.trim().toLowerCase();
                                const _filteredGroups = _qpGroups.map(g => ({
                                    ...g,
                                    workers: _sq
                                        ? g.workers.filter(w => (w.nom || '').toLowerCase().includes(_sq) || (w.matricule || '').toLowerCase().includes(_sq) || (w.operationsStr || '').toLowerCase().includes(_sq))
                                        : g.workers,
                                })).filter(g => g.workers.length > 0);
                                return _filteredGroups.map(g => {
                                // Mode « Parcelle » : jours = jours pointés SUR la parcelle ; net = prorata
                                // (net quinzaine × jours parcelle / jours quinzaine). Les autres modes sont
                                // des partitions (équipe/ferme) → valeurs quinzaine complètes inchangées.
                                const _gJours = (w) => quinzGroupBy === 'parcelle' ? (w.parcelleJournees[g.key] || 0) : w.journees;
                                const _gCout = (w) => (quinzGroupBy === 'parcelle' && w.journees > 0)
                                    ? Math.round(w.coutTotal * (w.parcelleJournees[g.key] || 0) / w.journees)
                                    : w.coutTotal;
                                return (
                                <React.Fragment key={g.key}>
                                    <tr style={{background:'var(--green-pale, #eef7ef)'}}>
                                        {_isMoCard && <td style={{padding:'8px 6px'}}></td>}
                                        <td colSpan={_isMoCard ? 3 : 4} style={{padding:'8px 10px',fontWeight:700,color:'var(--green, #2e7d32)'}}>
                                            <span style={{fontFamily:'monospace',fontSize:10,marginRight:6,opacity:0.7}}>{g.key}</span>
                                            {quinzGroupBy === 'equipe' ? g.label : g.key}
                                            <span style={{fontWeight:600,color:'var(--gray-500)',marginLeft:8}}>— {g.workers.length} ouvrier{g.workers.length !== 1 ? 's' : ''}</span>
                                        </td>
                                        <td style={{padding:'8px 10px',textAlign:'center',fontWeight:700,color:'var(--green, #2e7d32)'}}>{g.workers.reduce((s, w) => s + _gJours(w), 0)}</td>
                                        {!_isMoCard && <td style={{padding:'8px 10px',textAlign:'center',fontWeight:700,color:'var(--green, #2e7d32)'}}>{Math.round(g.workers.reduce((s, w) => s + w.heuresTotal, 0) * 10) / 10}h</td>}
                                        <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:'var(--green, #2e7d32)'}}>{g.workers.reduce((s, w) => s + _gCout(w), 0).toLocaleString('fr-FR')}</td>
                                    </tr>
                                    {g.workers.map((w, wi) => (
                                        <tr key={g.key + '-' + wi}
                                            style={{transition:'background 0.15s', cursor:'pointer'}}
                                            onClick={() => setQuinzSubWorker({...w, groupLabel: g.label, quinzaineDays: parJour.map(d => d.jour).sort(), popupColor: _qpColor, parcelleJours: quinzGroupBy === 'parcelle' ? _gJours(w) : null, parcelleCout: quinzGroupBy === 'parcelle' ? _gCout(w) : null, parcelleDays: quinzGroupBy === 'parcelle' ? [...(w.parcelleJours[g.key] || new Set())] : null})}
                                            onMouseEnter={e => e.currentTarget.style.background='#f0e6ec'}
                                            onMouseLeave={e => e.currentTarget.style.background=''}>
                                            {_isMoCard && (() => {
                                                const _wr = quinzRegistry[numKey(w.matricule)] || {};
                                                const _wDecl = !!(_wr.declare);
                                                const _wHasReg = Object.keys(_wr).length > 0;
                                                const _dotColor = _wHasReg ? (_wDecl ? '#27ae60' : '#e74c3c') : '#bbb';
                                                const _dotTitle = _wHasReg ? (_wDecl ? 'Déclaré CNSS' : 'Non déclaré CNSS') : 'Statut CNSS inconnu';
                                                return <td style={{padding:'6px 6px',textAlign:'center'}}><span style={{color:_dotColor,fontSize:14}} title={_dotTitle}>●</span></td>;
                                            })()}
                                            <td style={{fontFamily:'monospace',fontSize:10,padding:'6px 10px',color:'var(--gray-400)'}}>{w.matricule}</td>
                                            <td style={{fontWeight:600,padding:'6px 10px'}}>{w.nom}</td>
                                            <td style={{fontSize:11,color:'var(--gray-500)',padding:'6px 10px'}}>{w.operationsStr}</td>
                                            {!_isMoCard && <td style={{fontSize:10,color:'var(--gray-400)',padding:'6px 10px'}}>{w.parcellesStr}</td>}
                                            <td style={{textAlign:'center',padding:'6px 10px',fontWeight:600}}>
                                                {_gJours(w)}
                                            </td>
                                            {!_isMoCard && <td style={{textAlign:'center',padding:'6px 10px',color:'var(--gray-600)'}}>{w.heuresTotal > 0 ? w.heuresTotal + 'h' : '—'}</td>}
                                            <td style={{textAlign:'right',padding:'6px 10px',fontWeight:700}}>{_gCout(w) > 0 ? _gCout(w).toLocaleString('fr-FR') : '—'}</td>
                                        </tr>
                                    ))}
                                </React.Fragment>
                            );
                            });
                            })()}
                        </tbody>
                        <tfoot>
                            <tr style={{background:'var(--gray-50)',fontWeight:700}}>
                                {_isMoCard && <td style={{padding:'6px 6px'}}></td>}
                                <td colSpan={_isMoCard ? 3 : 4} style={{padding:'6px 10px'}}>Total — {_qpWorkers.length} ouvrier{_qpWorkers.length !== 1 ? 's' : ''}</td>
                                <td style={{textAlign:'center',padding:'6px 10px'}}>{_qpTotalJ}</td>
                                {!_isMoCard && <td style={{textAlign:'center',padding:'6px 10px'}}>{Math.round(_qpWorkers.reduce((s, w) => s + w.heuresTotal, 0) * 10) / 10}h</td>}
                                <td style={{textAlign:'right',padding:'6px 10px'}}>{_qpWorkers.reduce((s, w) => s + w.coutTotal, 0).toLocaleString('fr-FR')}</td>
                            </tr>
                        </tfoot>
                    </table>
                    </div>
                    )}

                    {/* Encadré Charges Sociales — uniquement cartes MO */}
                    {_isMoCard && (() => {
                        const _PU2 = window.PaieUtils;
                        const _firstDayQ = parJour.length > 0 ? parJour[0].jour : null;
                        const _smagQ = (_PU2 && _PU2.resolveSmagForDate)
                            ? _PU2.resolveSmagForDate(quinzPaieBaremes, _firstDayQ)
                            : { smagBrutJournalier: quinzPaieBaremes.smagBrutJournalier || 0, smagNetJournalier: quinzPaieBaremes.smagNetJournalier || 0 };
                        let totalBrutDeclare = 0, totalChargesDeclare = 0, totalCoutEmpDeclare = 0;
                        let cntDeclare = 0, cntNonDeclare = 0;
                        const _workerPayeDetails = [];
                        _qpWorkers.forEach(w => {
                            const _rw = quinzRegistry[numKey(w.matricule)] || {};
                            const _isDecl = !!(_rw.declare);
                            const _pfJ = Number(_rw.primeFonctionJournaliere || 0);
                            const _anc = Number(_rw.baselineJours || 0);
                            const _ancP = (_PU2 && _PU2.trouverPalierAnciennete)
                                ? _PU2.trouverPalierAnciennete(_anc, quinzPaieBaremes.paliers || [])
                                : { pourcentage: 0 };
                            const _ancT = (_ancP.pourcentage || 0) / 100;
                            if (_isDecl) cntDeclare++; else cntNonDeclare++;
                            if (!_PU2 || !_PU2.computePayslip) return;
                            const _ps = _PU2.computePayslip({
                                declare: _isDecl,
                                smagBrut: _smagQ.smagBrutJournalier,
                                smagNet: _smagQ.smagNetJournalier,
                                jT: w.journees, jF: 0,
                                ancienneteTaux: _ancT, primeFonctionJour: _pfJ,
                                primesOptionnelles: [], baremes: quinzPaieBaremes,
                            });
                            if (_isDecl) {
                                totalBrutDeclare += _ps.brut;
                                totalChargesDeclare += _ps.chargesPatronales;
                                totalCoutEmpDeclare += _ps.coutEmployeur;
                                _workerPayeDetails.push({
                                    nom: w.nom, matricule: w.matricule, journees: w.journees,
                                    brut: _ps.brut, chargesPatronales: _ps.chargesPatronales,
                                    coutEmployeur: _ps.coutEmployeur,
                                    tauxCharges: _ps.tauxChargesPatronales || 0,
                                });
                            }
                        });
                        if (Object.keys(quinzRegistry).length === 0) return null;
                        return (
                            <div style={{marginTop:16,background:'#f0f4ff',borderRadius:10,padding:14,border:'1px solid #c5d0e6'}}>
                                <div style={{fontSize:11,fontWeight:700,color:'#3949ab',textTransform:'uppercase',letterSpacing:0.5,marginBottom:10}}>
                                    <i className="fa-solid fa-shield-halved" style={{marginRight:6}}></i>Charges Sociales
                                </div>
                                <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                                    <div style={{flex:'1 1 120px',textAlign:'center',background:'#fff',borderRadius:8,padding:'8px 12px',border:'1px solid #e8ecf8'}}>
                                        <div style={{fontSize:11,color:'var(--gray-500)',marginBottom:4}}>Déclarés CNSS</div>
                                        <div style={{fontSize:18,fontWeight:800,color:'#27ae60'}}>{cntDeclare}</div>
                                    </div>
                                    <div style={{flex:'1 1 120px',textAlign:'center',background:'#fff',borderRadius:8,padding:'8px 12px',border:'1px solid #e8ecf8'}}>
                                        <div style={{fontSize:11,color:'var(--gray-500)',marginBottom:4}}>Non déclarés</div>
                                        <div style={{fontSize:18,fontWeight:800,color:'#e74c3c'}}>{cntNonDeclare}</div>
                                    </div>
                                    <div style={{flex:'1 1 160px',textAlign:'center',background:'#fff',borderRadius:8,padding:'8px 12px',border:'1px solid #e8ecf8'}}>
                                        <div style={{fontSize:11,color:'var(--gray-500)',marginBottom:4}}>Brut total déclarés</div>
                                        <div style={{fontSize:15,fontWeight:700,color:'var(--gray-700)'}}>{f2(totalBrutDeclare)} DH</div>
                                    </div>
                                    <div onClick={() => setQuinzChargesPopup(_workerPayeDetails.slice().sort((a,b) => b.chargesPatronales - a.chargesPatronales))}
                                        style={{flex:'1 1 160px',textAlign:'center',background:'#fff',borderRadius:8,padding:'8px 12px',border:'2px solid #3949ab',cursor:'pointer'}}>
                                        <div style={{fontSize:11,color:'#3949ab',marginBottom:4,fontWeight:600}}>Charges patronales <i className="fa-solid fa-arrow-up-right-from-square" style={{fontSize:9}}></i></div>
                                        <div style={{fontSize:15,fontWeight:700,color:'#3949ab'}}>+{f2(totalChargesDeclare)} DH</div>
                                    </div>
                                    <div onClick={() => setQuinzChargesPopup(_workerPayeDetails.slice().sort((a,b) => b.coutEmployeur - a.coutEmployeur))}
                                        style={{flex:'1 1 160px',textAlign:'center',background:'linear-gradient(135deg,#3949ab,#5c6bc0)',borderRadius:8,padding:'8px 12px',color:'#fff',cursor:'pointer'}}>
                                        <div style={{fontSize:11,opacity:0.85,marginBottom:4}}>Coût employeur déclarés <i className="fa-solid fa-arrow-up-right-from-square" style={{fontSize:9}}></i></div>
                                        <div style={{fontSize:15,fontWeight:800}}>{f2(totalCoutEmpDeclare)} DH</div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
}

export { QuinzainePopupGenerique };
