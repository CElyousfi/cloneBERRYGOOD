/* Popup des états d'émargement : feuilles à signer par équipe, en français ou en arabe.
 *
 * Extrait de QuinzaineTab (3 554 lignes à l'origine). Bloc de rendu pur — aucun
 * hook, aucun effet : toutes ses entrées arrivent en props.
 */
import * as EmargementPdf from '../shared/lib/emargementPdf.js';

import * as EmargementExcel from '../shared/lib/emargementExcel.js';
import * as PaieUtils from '../shared/lib/paieUtils.js';
import { nomOuvrier } from './nomOuvrier.jsx';
function QuinzaineEmargementPopup({ coutMap, cultureFilter, currentPeriode, emargementLang, emargementLoading, farmFilter, getEqPrefix, matchCulture, moHorsRecolteRows, moPostesRows, numKey, parJour, prefixToName, quinzPaieBaremes, quinzRegistry, recolteEquipeRows, setEmargementLang, setEmargementLoading, setEmargementOpen, transportByEquipe, transportConfig }) {
    const _PU = PaieUtils;
    const _firstDayQz = parJour.length > 0 ? parJour[0].jour : null;
    const _smag = (_PU && _PU.resolveSmagForDate)
        ? _PU.resolveSmagForDate(quinzPaieBaremes, _firstDayQz)
        : { smagBrutJournalier: quinzPaieBaremes.smagBrutJournalier || 0, smagNetJournalier: quinzPaieBaremes.smagNetJournalier || 0 };

    // Construire liste complète des ouvriers de la période
    const _allMoRows = [
        ...moHorsRecolteRows,
        ...moPostesRows,
        ...recolteEquipeRows.filter(r => (r.periode||'').trim() === currentPeriode.trim() && (!farmFilter || r.ferme === farmFilter) && matchCulture(r, cultureFilter)),
    ];
    const _wMap = {};
    _allMoRows.forEach(function (r) {
        if (!r.matricule) return;
        if (!_wMap[r.matricule]) _wMap[r.matricule] = { mat: r.matricule, nom: r.nom || r.matricule, jours: new Set() };
        if (r.jour) _wMap[r.matricule].jours.add(r.jour);
    });

    const _buildWorker = function (mat, jours) {
        const reg = quinzRegistry[numKey(mat)] || {};
        const isDecl = !!(reg.declare);
        const jh = jours.size;
        const firstDayW = jh > 0 ? [...jours].sort()[0] : _firstDayQz;
        const smagW = (_PU && _PU.resolveSmagForDate) ? _PU.resolveSmagForDate(quinzPaieBaremes, firstDayW) : _smag;
        const pfJ = Number(reg.primeFonctionJournaliere || 0);
        const ancTaux = (_PU && _PU.trouverPalierAnciennete)
            ? ((_PU.trouverPalierAnciennete(Number(reg.baselineJours || 0), quinzPaieBaremes.paliers || []).pourcentage || 0) / 100)
            : 0;
        const ps = (_PU && _PU.computePayslip) ? _PU.computePayslip({ declare: isDecl, smagBrut: smagW.smagBrutJournalier, smagNet: smagW.smagNetJournalier, jT: jh, jF: 0, ancienneteTaux: ancTaux, primeFonctionJour: pfJ, primesOptionnelles: [], baremes: quinzPaieBaremes }) : null;
        const eqPrefix = getEqPrefix(mat);
        const transportJour = coutMap[eqPrefix] || 0;
        // Décomposition brut
        const salaireBase = Math.round(smagW.smagBrutJournalier * jh);
        const primeFonctionTotal = Math.round(pfJ * jh);
        const brutAvantAnc = salaireBase + primeFonctionTotal;
        const ancienneteTotal = Math.round(brutAvantAnc * ancTaux);
        return {
            matricule: mat,
            nom: nomOuvrier(reg.prenom, reg.nom, _wMap[mat].nom) || _wMap[mat].nom,
            equipe: prefixToName[eqPrefix] || eqPrefix || '—',
            journees: jh,
            declare: isDecl,
            net: ps ? Math.round(ps.net) : Math.round(jh * smagW.smagNetJournalier),
            brut: ps ? Math.round(ps.brut) : 0,
            salaireBase,
            primeFonctionTotal,
            primeFonctionJour: pfJ,
            ancienneteTotal,
            anciennetePct: Math.round(ancTaux * 100),
            transportJour,
            transportTotal: Math.round(transportJour * jh),
        };
    };

    const _allWorkers = Object.values(_wMap)
        .map(function (w) { return _buildWorker(w.mat, w.jours); })
        .sort(function (a, b) { return a.equipe.localeCompare(b.equipe) || a.nom.localeCompare(b.nom); });

    const _declared = _allWorkers.filter(function (w) { return w.declare; });
    const _nonDeclared = _allWorkers.filter(function (w) { return !w.declare; });

    const _transportEquipes = transportConfig
        .filter(function (t) { return transportByEquipe && transportByEquipe[t.prefix]; })
        .map(function (t) {
            const tb = transportByEquipe[t.prefix];
            return { equipe: t.equipe, caporal: t.caporal || '—', coutParOuvrier: coutMap[t.prefix] || t.coutParOuvrier || 0, nbJH: tb.workers || 0, montant: Math.round(tb.cout || 0) };
        });

    const _hasPdf = !!(EmargementPdf);
    const _hasXlsx = !!(EmargementExcel && typeof XLSX !== 'undefined' && XLSX);

    const _rowStyle = function (color) {
        return { width: '100%', padding: '10px 16px', borderRadius: 8, background: color, color: '#fff', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 };
    };
    const _fmtBtn = function (disabled, title) {
        return { border: '1px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 5, padding: '4px 8px', fontSize: 11, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap', flexShrink: 0 };
    };

    return (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.55)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
            onClick={() => setEmargementOpen(false)}>
            <div style={{background:'#fff',borderRadius:14,maxWidth:480,width:'100%',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}
                onClick={function (e) { e.stopPropagation(); }}>
                {/* Header */}
                <div style={{padding:'16px 20px',borderBottom:'2px solid var(--gray-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div>
                        <h3 style={{margin:0,fontSize:16,color:'#3949ab'}}>
                            <i className="fa-solid fa-file-signature" style={{marginRight:8}}></i>États d'émargement &amp; Bulletins
                        </h3>
                        <div style={{fontSize:11,color:'var(--gray-500)',marginTop:2}}>Quinzaine : {currentPeriode || '—'}</div>
                    </div>
                    <button onClick={() => setEmargementOpen(false)}
                        style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--gray-400)',padding:4}}>
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                {/* Stats rapides */}
                <div style={{padding:'10px 20px',background:'#f8f9fa',display:'flex',gap:16,flexWrap:'wrap',borderBottom:'1px solid var(--gray-100)'}}>
                    <span style={{fontSize:11,color:'var(--gray-600)'}}>
                        <i className="fa-solid fa-user-check" style={{marginRight:4,color:'#27ae60'}}></i>
                        {_declared.length} déclarés
                    </span>
                    <span style={{fontSize:11,color:'var(--gray-600)'}}>
                        <i className="fa-solid fa-user-xmark" style={{marginRight:4,color:'#e74c3c'}}></i>
                        {_nonDeclared.length} sans CNSS
                    </span>
                    <span style={{fontSize:11,color:'var(--gray-600)'}}>
                        <i className="fa-solid fa-bus" style={{marginRight:4,color:'#3949ab'}}></i>
                        {_transportEquipes.length} équipes transport
                    </span>
                </div>

                {/* Boutons de téléchargement */}
                <div style={{padding:'16px 20px'}}>
                    {!_hasPdf && (
                        <div style={{background:'#fef3cd',border:'1px solid #ffc107',borderRadius:8,padding:'8px 12px',marginBottom:12,fontSize:12,color:'#856404'}}>
                            <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                            jsPDF non chargé — rafraîchissez la page.
                        </div>
                    )}

                    {/* Ouvriers SANS CNSS */}
                    <div style={_rowStyle('#e74c3c')}>
                        <i className="fa-solid fa-file-arrow-down" style={{fontSize:16,flexShrink:0}}></i>
                        <div style={{flex:1,textAlign:'left'}}>
                            <div>Ouvriers SANS CNSS</div>
                            <div style={{fontSize:11,fontWeight:400,opacity:0.85}}>{_nonDeclared.length} ouvriers — {_nonDeclared.reduce(function (s,w){return s+w.journees;},0)} jours — {(_nonDeclared.reduce(function (s,w){return s+w.net;},0)).toLocaleString('fr-FR')} DH</div>
                        </div>
                        <button disabled={!_hasPdf} style={_fmtBtn(!_hasPdf, 'PDF')}
                            onClick={function () { if (EmargementPdf) EmargementPdf.genSansCnss(_nonDeclared, currentPeriode); }}>
                            <i className="fa-solid fa-file-pdf" style={{marginRight:3}}></i>PDF
                        </button>
                        <button disabled={!_hasXlsx} style={_fmtBtn(!_hasXlsx, 'XLS')}
                            onClick={function () { if (EmargementExcel) EmargementExcel.genSansCnssXlsx(_nonDeclared, currentPeriode); }}>
                            <i className="fa-solid fa-file-excel" style={{marginRight:3}}></i>XLS
                        </button>
                    </div>

                    {/* Ouvriers Déclarés CNSS */}
                    <div style={_rowStyle('#27ae60')}>
                        <i className="fa-solid fa-file-arrow-down" style={{fontSize:16,flexShrink:0}}></i>
                        <div style={{flex:1,textAlign:'left'}}>
                            <div>Ouvriers Déclarés CNSS</div>
                            <div style={{fontSize:11,fontWeight:400,opacity:0.85}}>{_declared.length} ouvriers — {_declared.reduce(function (s,w){return s+w.journees;},0)} jours — {(_declared.reduce(function (s,w){return s+w.net;},0)).toLocaleString('fr-FR')} DH</div>
                        </div>
                        <button disabled={!_hasPdf} style={_fmtBtn(!_hasPdf, 'PDF')}
                            onClick={function () { if (EmargementPdf) EmargementPdf.genAvecCnss(_declared, currentPeriode); }}>
                            <i className="fa-solid fa-file-pdf" style={{marginRight:3}}></i>PDF
                        </button>
                        <button disabled={!_hasXlsx} style={_fmtBtn(!_hasXlsx, 'XLS')}
                            onClick={function () { if (EmargementExcel) EmargementExcel.genAvecCnssXlsx(_declared, currentPeriode); }}>
                            <i className="fa-solid fa-file-excel" style={{marginRight:3}}></i>XLS
                        </button>
                    </div>

                    {/* Transporteurs */}
                    <div style={_rowStyle('#3949ab')}>
                        <i className="fa-solid fa-file-arrow-down" style={{fontSize:16,flexShrink:0}}></i>
                        <div style={{flex:1,textAlign:'left'}}>
                            <div>Transporteurs</div>
                            <div style={{fontSize:11,fontWeight:400,opacity:0.85}}>{_transportEquipes.length} équipes — {(_transportEquipes.reduce(function (s,e){return s+e.montant;},0)).toLocaleString('fr-FR')} DH</div>
                        </div>
                        <button disabled={!_hasPdf} style={_fmtBtn(!_hasPdf, 'PDF')}
                            onClick={function () { if (EmargementPdf) EmargementPdf.genTransporteurs(_transportEquipes, currentPeriode); }}>
                            <i className="fa-solid fa-file-pdf" style={{marginRight:3}}></i>PDF
                        </button>
                        <button disabled={!_hasXlsx} style={_fmtBtn(!_hasXlsx, 'XLS')}
                            onClick={function () { if (EmargementExcel) EmargementExcel.genTransporteursXlsx(_transportEquipes, currentPeriode); }}>
                            <i className="fa-solid fa-file-excel" style={{marginRight:3}}></i>XLS
                        </button>
                    </div>

                    {/* Bulletins de paie — Déclarés */}
                    <div style={_rowStyle(_declared.length > 0 ? '#8B2252' : '#aaa')}>
                        <i className="fa-solid fa-file-lines" style={{fontSize:16,flexShrink:0}}></i>
                        <div style={{flex:1,textAlign:'left'}}>
                            <div>Bulletins de paie — Déclarés</div>
                            <div style={{fontSize:11,fontWeight:400,opacity:0.85}}>{_declared.length} bulletins · 1 page/ouvrier</div>
                        </div>
                        {/* Sélecteur de langue FR / AR */}
                        <div style={{display:'flex',gap:2,flexShrink:0,marginRight:4}}>
                            <button onClick={function(e){e.stopPropagation();if(!emargementLoading)setEmargementLang('fr');}}
                                disabled={emargementLoading}
                                style={{border:'1px solid rgba(255,255,255,0.6)',background:emargementLang==='fr'?'rgba(255,255,255,0.95)':'rgba(255,255,255,0.15)',color:emargementLang==='fr'?'#8B2252':'#fff',borderRadius:4,padding:'3px 7px',fontSize:11,fontWeight:700,cursor:emargementLoading?'not-allowed':'pointer',opacity:emargementLoading?0.45:1}}>
                                FR
                            </button>
                            <button onClick={function(e){e.stopPropagation();if(!emargementLoading)setEmargementLang('ar');}}
                                disabled={emargementLoading}
                                style={{border:'1px solid rgba(255,255,255,0.6)',background:emargementLang==='ar'?'rgba(255,255,255,0.95)':'rgba(255,255,255,0.15)',color:emargementLang==='ar'?'#8B2252':'#fff',borderRadius:4,padding:'3px 7px',fontSize:11,fontWeight:700,cursor:emargementLoading?'not-allowed':'pointer',opacity:emargementLoading?0.45:1}}>
                                AR
                            </button>
                        </div>
                        <button disabled={!_hasPdf || _declared.length === 0 || emargementLoading} style={_fmtBtn(!_hasPdf || _declared.length === 0 || emargementLoading, 'PDF')}
                            onClick={async function () {
                                if (!EmargementPdf) return;
                                setEmargementLoading(true);
                                try {
                                    var personnelRef = {};
                                    try {
                                        var token = await firebase.auth().currentUser.getIdToken();
                                        var rhResp = await fetch('/api/rh?action=personnel-ref', { headers: { 'Authorization': 'Bearer ' + token } });
                                        var rhData = await rhResp.json();
                                        if (rhData.success) personnelRef = rhData.data || {};
                                    } catch(e) {}
                                    var enriched = _declared.map(function(w) {
                                        var ref = personnelRef[String(w.matricule)] || {};
                                        return Object.assign({}, w, { cin: ref.cin || null, cnss: ref.cnss || null });
                                    });
                                    var _parJourDays = parJour.map(function(d) { return d.jour; }).filter(Boolean).sort();
                                    var _bulletinDateDebut = _parJourDays.length > 0 ? _parJourDays[0] : null;
                                    var _bulletinDateFin   = _parJourDays.length > 0 ? _parJourDays[_parJourDays.length - 1] : null;
                                    var opts = { dateDebut: _bulletinDateDebut, dateFin: _bulletinDateFin };
                                    if (emargementLang === 'ar' && EmargementPdf.genBulletinsAr) {
                                        await EmargementPdf.genBulletinsAr(enriched, currentPeriode, _smag.smagBrutJournalier, opts);
                                    } else {
                                        await EmargementPdf.genBulletins(enriched, currentPeriode, _smag.smagBrutJournalier, opts);
                                    }
                                } finally {
                                    setEmargementLoading(false);
                                }
                            }}>
                            <i className={emargementLoading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-file-pdf'} style={{marginRight:3}}></i>{emargementLoading ? '...' : 'PDF'}
                        </button>
                        <button disabled={!_hasXlsx || _declared.length === 0} style={_fmtBtn(!_hasXlsx || _declared.length === 0, 'XLS')}
                            onClick={function () { if (EmargementExcel) EmargementExcel.genBulletinsXlsx(_declared, currentPeriode); }}>
                            <i className="fa-solid fa-file-excel" style={{marginRight:3}}></i>XLS
                        </button>
                    </div>
                </div>

                <div style={{padding:'0 20px 14px',fontSize:10,color:'var(--gray-400)',textAlign:'center'}}>
                    Les PDFs sont générés localement — aucune donnée transmise à un serveur externe.
                </div>
            </div>
        </div>
    );
}

export { QuinzaineEmargementPopup };
