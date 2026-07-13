/*
 * QuinzaineRecapCards.jsx — Cartes Récap Quinzaine (rendu partagé).
 *
 * Composant de rendu PUR extrait de DashboardTab et QuinzaineTab.
 * Aucune logique de calcul ici — les calculs restent dans chaque écran.
 *
 * Props :
 *   recapItems   {Array}   Tableau de cartes :
 *                            { label, icon, color, montant, popupKey?, subItems? }
 *   totalGlobal  {number}  Somme de tous les montants (pour % et barre).
 *   nbJours      {number}  Nombre de jours de la quinzaine (pour badge Moy/jour).
 *   badges       {Array}   Badges affichés dans l'en-tête (au-dessus de la grille).
 *                            Chaque badge : { bg, color, icon, text }
 *   clickable    {bool}    true → onClick+cursor:pointer sur chaque carte.
 *                          false → hover seul, pas de onClick.
 *   externalPopup {bool}  true → désactive le modal interne ; le parent gère son propre popup.
 *   popup        {object|null}
 *                  Quand clickable=true :
 *                    { current, setCurrent, data }
 *                      data = { quinzaineData, quinzParFerme, moParJour,
 *                               qRecolteRows, recolteTopWorkers,
 *                               tDates, qTransportRows, transportDetail,
 *                               traitWD, traitDetail,
 *                               condDetailQ, chargDetailQ, ferieDetailQ,
 *                               totalTraitement, totalConditionnement,
 *                               totalChargement, totalJourFerie,
 *                               currentQuinz, farmFilter, nbJours,
 *                               openWorkerDetail }
 *                  Quand clickable=false : null.
 *
 * Hypothèses (documentées dans le commit) :
 *  - Le composant ne gère PAS le wrapper extérieur (Panel / quinzaine-card).
 *    Chaque écran conserve son propre wrapper pour éviter toute régression layout.
 *  - Le pop-up est inclus dans ce composant car son state (popup.current) est
 *    étroitement lié aux onClick des cartes.
 *  - Les variables CSS (--berry, --orange, --green, etc.) sont définies globalement
 *    dans index.html et disponibles dans ce scope.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js.
 * IIFE → expose UNIQUEMENT window.QuinzaineRecapCards (pas de collision top-level).
 */
(function () {
  'use strict';

  var useState = React.useState;

  function QuinzaineRecapCards(props) {
    var recapItems = props.recapItems || [];
    var totalGlobal = props.totalGlobal || 0;
    var nbJours = props.nbJours || 0;
    var badges = props.badges || [];
    var clickable = !!props.clickable;
    var popup = props.popup || null; // { current, setCurrent, data }
    var externalPopup = !!props.externalPopup; // true → skip built-in modal, caller renders its own

    // ── Grille de cartes ──────────────────────────────────────────────────────

    var cards = recapItems.map(function (item, i) {
      var cardStyle = {
        background: '#fff',
        borderRadius: 12,
        padding: 16,
        border: '2px solid ' + item.color,
        boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
        transition: 'all 0.2s',
      };
      if (clickable) {
        cardStyle.cursor = 'pointer';
      }

      var handleClick = clickable && popup
        ? function () { popup.setCurrent(item.popupKey); }
        : undefined;

      return (
        <div key={i}
          style={cardStyle}
          onClick={handleClick}
          onMouseEnter={function (e) {
            e.currentTarget.style.transform = 'translateY(-3px)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
          }}
          onMouseLeave={function (e) {
            e.currentTarget.style.transform = '';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)';
          }}
        >
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
            <div style={{width:36,height:36,borderRadius:10,background:item.color,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:14}}>
              <i className={'fa-solid ' + item.icon}></i>
            </div>
            <div style={{fontSize:12,fontWeight:700,color:'var(--gray-600)'}}>{item.label}</div>
          </div>
          {/* montant === null → donnée pas encore prête (registre/barèmes paie en cours de
              chargement) : skeleton au lieu d'une valeur intermédiaire fausse (anti-flicker). */}
          <div style={{fontSize:22,fontWeight:800,color:item.color}}>
            {item.montant === null
              ? <span style={{opacity:0.35,letterSpacing:2}}>· · ·</span>
              : Math.round(item.montant).toLocaleString('fr-FR') + ' DH'}
          </div>
          {totalGlobal > 0 && item.montant !== null && (
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:4}}>
              <span style={{fontSize:10,color:'var(--gray-400)'}}>{Math.round(item.montant / totalGlobal * 100)}% du total</span>
              {clickable && (
                <span style={{fontSize:9,color:item.color}}><i className="fa-solid fa-up-right-from-square" style={{marginRight:3}}></i>Détail</span>
              )}
            </div>
          )}
          {item.subItems && (
            <div style={{marginTop:8,borderTop:'1px solid var(--gray-100)',paddingTop:8}}>
              {item.subItems.map(function (sub, j) {
                return (
                  <div key={j} style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--gray-500)',marginBottom:2}}>
                    <span>{sub.label}</span>
                    <span style={{fontWeight:600}}>{Math.round(sub.montant).toLocaleString('fr-FR')} DH</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });

    // ── Barre de répartition ─────────────────────────────────────────────────

    var repartition = null;
    if (totalGlobal > 0) {
      var barSegments = recapItems.filter(function (it) { return it.montant > 0; }).map(function (item, i) {
        return (
          <div key={i}
            style={{width: (item.montant / totalGlobal * 100) + '%', background: item.color, borderRadius: 2}}
            title={item.label + ': ' + Math.round(item.montant / totalGlobal * 100) + '%'}
          ></div>
        );
      });
      var legendItems = recapItems.filter(function (it) { return it.montant > 0; }).map(function (item, i) {
        return (
          <span key={i} style={{fontSize:10,color:'var(--gray-500)',display:'flex',alignItems:'center',gap:4}}>
            <span style={{width:8,height:8,borderRadius:2,background:item.color,display:'inline-block'}}></span>
            {item.label} ({Math.round(item.montant / totalGlobal * 100)}%)
          </span>
        );
      });
      repartition = (
        <div style={{background:'var(--gray-50)',borderRadius:10,padding:12}}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--gray-500)',marginBottom:8}}>Répartition des coûts</div>
          <div style={{display:'flex',height:8,borderRadius:4,overflow:'hidden',gap:1}}>
            {barSegments}
          </div>
          <div style={{display:'flex',gap:12,marginTop:6,flexWrap:'wrap'}}>
            {legendItems}
          </div>
        </div>
      );
    }

    // ── Note "Cliquez" (DashboardTab seulement) ──────────────────────────────

    var clickHint = clickable
      ? <div style={{fontSize:10,color:'var(--gray-400)',textAlign:'center',marginTop:8}}>
          <i className="fa-solid fa-hand-pointer" style={{marginRight:4}}></i>Cliquez sur une catégorie pour voir le détail
        </div>
      : null;

    // ── Pop-up détail (DashboardTab seulement) ────────────────────────────────

    var modal = null;
    if (clickable && popup && popup.current && !externalPopup) {
      var d = popup.data || {};
      var currentQuinz = d.currentQuinz || '';
      var farmFilter = d.farmFilter || '';
      var quinzainePopup = popup.current;
      var setQuinzainePopup = popup.setCurrent;

      // Couleur et icône de la catégorie active
      var popupColor = quinzainePopup === 'mo' ? 'var(--berry)'
        : quinzainePopup === 'recolte' ? 'var(--orange)'
        : quinzainePopup === 'transport' ? 'var(--green)'
        : 'var(--blue)';
      var popupIcon = quinzainePopup === 'mo' ? 'fa-users'
        : quinzainePopup === 'recolte' ? 'fa-coins'
        : quinzainePopup === 'transport' ? 'fa-bus'
        : 'fa-spray-can-sparkles';
      var popupTitle = quinzainePopup === 'mo' ? "Main d'Oeuvre"
        : quinzainePopup === 'recolte' ? 'Prime Récolte'
        : quinzainePopup === 'transport' ? 'Prime Transport'
        : 'Prime Traitement';

      // ── Sections de contenu du pop-up ────────────────────────────────────

      var popupBody = null;

      if (quinzainePopup === 'mo') {
        var quinzaineData = d.quinzaineData || null;
        var quinzParFerme = d.quinzParFerme || [];
        var moParJour = d.moParJour || [];
        var totalMainOeuvre = (recapItems.find(function (it) { return it.popupKey === 'mo'; }) || {}).montant || 0;
        popupBody = (
          <div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:20}}>
              <div style={{textAlign:'center',padding:14,background:'var(--berry-pale)',borderRadius:10}}>
                <div style={{fontSize:24,fontWeight:800,color:'var(--berry)'}}>{Math.round(totalMainOeuvre).toLocaleString('fr-FR')} DH</div>
                <div style={{fontSize:10,color:'var(--gray-500)'}}>Coût total M.O</div>
              </div>
              <div style={{textAlign:'center',padding:14,background:'var(--gray-50)',borderRadius:10}}>
                <div style={{fontSize:24,fontWeight:800,color:'var(--dark)'}}>{quinzaineData && quinzaineData.totalJournees ? quinzaineData.totalJournees : '-'}</div>
                <div style={{fontSize:10,color:'var(--gray-500)'}}>Journées ouvrières</div>
              </div>
              <div style={{textAlign:'center',padding:14,background:'var(--gray-50)',borderRadius:10}}>
                <div style={{fontSize:24,fontWeight:800,color:'var(--dark)'}}>{nbJours > 0 ? Math.round(totalMainOeuvre / nbJours).toLocaleString('fr-FR') : '-'} DH</div>
                <div style={{fontSize:10,color:'var(--gray-500)'}}>Moyenne / jour</div>
              </div>
            </div>
            {!farmFilter && quinzParFerme.length > 0 && (
              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',marginBottom:8}}><i className="fa-solid fa-building" style={{marginRight:6,color:'var(--berry)'}}></i>Par Ferme</div>
                <table className="data-table" style={{fontSize:11}}>
                  <thead><tr><th>Ferme</th><th style={{textAlign:'right'}}>Journées</th><th style={{textAlign:'right'}}>Récolte</th><th style={{textAlign:'right'}}>Hors Récolte</th><th style={{textAlign:'right'}}>Ouvriers Avocatier</th><th style={{textAlign:'right'}}>Coût (DH)</th></tr></thead>
                  <tbody>
                    {quinzParFerme.map(function (f, i) {
                      return <tr key={i}><td style={{fontWeight:600}}>{f.ferme}</td><td style={{textAlign:'right'}}>{f.journees}</td><td style={{textAlign:'right'}}>{f.recolte}</td><td style={{textAlign:'right'}}>{f.horsRecolte}</td><td style={{textAlign:'right'}}>{f.postesFixes}</td><td style={{textAlign:'right',fontWeight:700,color:'var(--berry)'}}>{Math.round(f.cout).toLocaleString('fr-FR')}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {moParJour.length > 0 && (
              <div>
                <div style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',marginBottom:8}}><i className="fa-solid fa-calendar-days" style={{marginRight:6,color:'var(--berry)'}}></i>Par Jour</div>
                <table className="data-table" style={{fontSize:11}}>
                  <thead><tr><th>Jour</th><th style={{textAlign:'right'}}>Nb Ouvriers</th><th style={{textAlign:'right'}}>Journées</th>{!farmFilter && <th style={{textAlign:'right'}}>F1</th>}{!farmFilter && <th style={{textAlign:'right'}}>F5</th>}{!farmFilter && <th style={{textAlign:'right'}}>Avo</th>}<th style={{textAlign:'right'}}>Coût (DH)</th></tr></thead>
                  <tbody>
                    {moParJour.map(function (j, i) {
                      return <tr key={i}><td style={{fontWeight:500}}>{j.jourLabel}</td><td style={{textAlign:'right'}}>{j.nbOuv}</td><td style={{textAlign:'right'}}>{Math.round(j.journees*100)/100}</td>{!farmFilter && <td style={{textAlign:'right'}}>{j.F1||0}</td>}{!farmFilter && <td style={{textAlign:'right'}}>{j.F5||0}</td>}{!farmFilter && <td style={{textAlign:'right'}}>{j.Avocatier||0}</td>}<td style={{textAlign:'right',fontWeight:700,color:'var(--berry)'}}>{Math.round(j.cout).toLocaleString('fr-FR')}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      }

      else if (quinzainePopup === 'recolte') {
        var qRecolteRows = d.qRecolteRows || [];
        var recolteByWorker = d.recolteByWorker || {};
        var recolteTopWorkers = d.recolteTopWorkers || [];
        var totalPrimeRecolte = (recapItems.find(function (it) { return it.popupKey === 'recolte'; }) || {}).montant || 0;
        var openWorkerDetail = d.openWorkerDetail || null;
        popupBody = (
          <div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:20}}>
              <div style={{textAlign:'center',padding:14,background:'rgba(243,156,18,0.1)',borderRadius:10}}>
                <div style={{fontSize:24,fontWeight:800,color:'var(--orange)'}}>{Math.round(totalPrimeRecolte).toLocaleString('fr-FR')} DH</div>
                <div style={{fontSize:10,color:'var(--gray-500)'}}>Total primes récolte</div>
              </div>
              <div style={{textAlign:'center',padding:14,background:'var(--gray-50)',borderRadius:10}}>
                <div style={{fontSize:24,fontWeight:800,color:'var(--dark)'}}>{qRecolteRows.length}</div>
                <div style={{fontSize:10,color:'var(--gray-500)'}}>Lignes pointage</div>
              </div>
              <div style={{textAlign:'center',padding:14,background:'var(--gray-50)',borderRadius:10}}>
                <div style={{fontSize:24,fontWeight:800,color:'var(--dark)'}}>{Object.keys(recolteByWorker).length}</div>
                <div style={{fontSize:10,color:'var(--gray-500)'}}>Ouvriers avec prime</div>
              </div>
            </div>
            <div style={{fontSize:11,color:'var(--gray-500)',marginBottom:8,padding:'8px 12px',background:'var(--gray-50)',borderRadius:8}}>
              <i className="fa-solid fa-info-circle" style={{marginRight:4,color:'var(--orange)'}}></i>
              Barème: &lt;20kg = 0 DH | 20-24kg = 20 DH | 25-29kg = 40 DH | 30-39kg = 60+3/kg | 40+kg = 100+4/kg
            </div>
            <div style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',marginBottom:8}}><i className="fa-solid fa-ranking-star" style={{marginRight:6,color:'var(--orange)'}}></i>Top 20 Ouvriers</div>
            <table className="data-table" style={{fontSize:11}}>
              <thead><tr><th>#</th><th>Matricule</th><th>Nom</th><th>Ferme</th><th style={{textAlign:'right'}}>Jours</th><th style={{textAlign:'right'}}>Total Kg</th><th style={{textAlign:'right'}}>Moy/jour</th><th style={{textAlign:'right'}}>Prime (DH)</th></tr></thead>
              <tbody>
                {recolteTopWorkers.map(function (w, i) {
                  return (
                    <tr key={i} style={{cursor:'pointer'}} onClick={function () { setQuinzainePopup(null); if (openWorkerDetail) openWorkerDetail(w.matricule); }}>
                      <td><span className={'rank ' + (i < 3 ? 'rank-' + (i+1) : 'rank-other')}>{i+1}</span></td>
                      <td style={{fontFamily:'monospace',fontWeight:600}}>{w.matricule}</td>
                      <td style={{fontWeight:500}}>{w.nom}</td>
                      <td><span className="status-badge" style={{background:'var(--berry-pale)',color:'var(--berry)',fontSize:10}}>{w.ferme}</span></td>
                      <td style={{textAlign:'right'}}>{w.jours}</td>
                      <td style={{textAlign:'right',fontWeight:600}}>{Math.round(w.totalKg)}</td>
                      <td style={{textAlign:'right',color:'var(--gray-500)'}}>{w.jours > 0 ? Math.round(w.totalKg / w.jours) : 0} kg</td>
                      <td style={{textAlign:'right',fontWeight:700,color:'var(--orange)'}}>{Math.round(w.prime).toLocaleString('fr-FR')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }

      else if (quinzainePopup === 'transport') {
        var tDates = d.tDates || [];
        var qTransportRows = d.qTransportRows || [];
        var transportDetail = d.transportDetail || [];
        var totalTransport = (recapItems.find(function (it) { return it.popupKey === 'transport'; }) || {}).montant || 0;
        popupBody = (
          <div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:20}}>
              <div style={{textAlign:'center',padding:14,background:'rgba(39,174,96,0.1)',borderRadius:10}}>
                <div style={{fontSize:24,fontWeight:800,color:'var(--green)'}}>{Math.round(totalTransport).toLocaleString('fr-FR')} DH</div>
                <div style={{fontSize:10,color:'var(--gray-500)'}}>Total prime transport</div>
              </div>
              <div style={{textAlign:'center',padding:14,background:'var(--gray-50)',borderRadius:10}}>
                <div style={{fontSize:24,fontWeight:800,color:'var(--dark)'}}>{tDates.length}</div>
                <div style={{fontSize:10,color:'var(--gray-500)'}}>Jours travaillés</div>
              </div>
              <div style={{textAlign:'center',padding:14,background:'var(--gray-50)',borderRadius:10}}>
                <div style={{fontSize:24,fontWeight:800,color:'var(--dark)'}}>{qTransportRows.length}</div>
                <div style={{fontSize:10,color:'var(--gray-500)'}}>Ouvriers-jours transportés</div>
              </div>
            </div>
            <div style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',marginBottom:8}}><i className="fa-solid fa-bus" style={{marginRight:6,color:'var(--green)'}}></i>Par Équipe de Transport</div>
            <table className="data-table" style={{fontSize:11}}>
              <thead><tr><th>Équipe</th><th>Caporal</th><th style={{textAlign:'right'}}>Coût/ouv</th><th style={{textAlign:'right'}}>Total ouv-jours</th><th style={{textAlign:'right'}}>Total (DH)</th></tr></thead>
              <tbody>
                {transportDetail.map(function (t, i) {
                  return <tr key={i}><td style={{fontWeight:600}}><span style={{background:'var(--green-pale)',color:'var(--green)',padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:700,marginRight:4}}>{t.prefix}</span>{t.equipe}</td><td style={{color:'var(--gray-500)'}}>{t.caporal}</td><td style={{textAlign:'right'}}>{t.cout} DH</td><td style={{textAlign:'right'}}>{t.totalWorkers}</td><td style={{textAlign:'right',fontWeight:700,color:'var(--green)'}}>{Math.round(t.total).toLocaleString('fr-FR')}</td></tr>;
                })}
                <tr style={{fontWeight:700,borderTop:'2px solid var(--gray-200)'}}><td colSpan="3">Total</td><td style={{textAlign:'right'}}>{transportDetail.reduce(function (s, t) { return s + t.totalWorkers; }, 0)}</td><td style={{textAlign:'right',color:'var(--green)'}}>{Math.round(totalTransport).toLocaleString('fr-FR')} DH</td></tr>
              </tbody>
            </table>
          </div>
        );
      }

      else if (quinzainePopup === 'traitement') {
        var traitWD = d.traitWD || { size: 0 };
        var traitDetail = d.traitDetail || [];
        var totalTraitement = d.totalTraitement || 0;
        popupBody = (
          <div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:20}}>
              <div style={{textAlign:'center',padding:14,background:'rgba(52,152,219,0.1)',borderRadius:10}}>
                <div style={{fontSize:24,fontWeight:800,color:'var(--blue)'}}>{Math.round(totalTraitement).toLocaleString('fr-FR')} DH</div>
                <div style={{fontSize:10,color:'var(--gray-500)'}}>Total prime traitement</div>
              </div>
              <div style={{textAlign:'center',padding:14,background:'var(--gray-50)',borderRadius:10}}>
                <div style={{fontSize:24,fontWeight:800,color:'var(--dark)'}}>{traitWD.size}</div>
                <div style={{fontSize:10,color:'var(--gray-500)'}}>Ouvriers-jours traitement</div>
              </div>
              <div style={{textAlign:'center',padding:14,background:'var(--gray-50)',borderRadius:10}}>
                <div style={{fontSize:24,fontWeight:800,color:'var(--dark)'}}>10 DH</div>
                <div style={{fontSize:10,color:'var(--gray-500)'}}>Prime / ouvrier / jour</div>
              </div>
            </div>
            <div style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',marginBottom:8}}><i className="fa-solid fa-calendar-days" style={{marginRight:6,color:'var(--blue)'}}></i>Par Jour</div>
            {traitDetail.length > 0 ? (
              <table className="data-table" style={{fontSize:11}}>
                <thead><tr><th>Jour</th><th style={{textAlign:'right'}}>Nb Ouvriers</th><th style={{textAlign:'right'}}>Montant (DH)</th></tr></thead>
                <tbody>
                  {traitDetail.map(function (t, i) {
                    return <tr key={i}><td style={{fontWeight:500}}>{t.jourLabel}</td><td style={{textAlign:'right'}}>{t.nb}</td><td style={{textAlign:'right',fontWeight:700,color:'var(--blue)'}}>{t.montant.toLocaleString('fr-FR')}</td></tr>;
                  })}
                  <tr style={{fontWeight:700,borderTop:'2px solid var(--gray-200)'}}><td>Total</td><td style={{textAlign:'right'}}>{traitWD.size}</td><td style={{textAlign:'right',color:'var(--blue)'}}>{Math.round(totalTraitement).toLocaleString('fr-FR')} DH</td></tr>
                </tbody>
              </table>
            ) : (
              <div style={{textAlign:'center',padding:30,color:'var(--gray-400)'}}>
                <i className="fa-solid fa-info-circle" style={{fontSize:24,marginBottom:8,display:'block'}}></i>
                <div style={{fontSize:12}}>Aucun jour de traitement phyto enregistré cette quinzaine</div>
                <div style={{fontSize:10,marginTop:4}}>Les opérations "Traitement" dans BEE ONE génèrent une prime de 10 DH/ouvrier/jour</div>
              </div>
            )}
          </div>
        );
      }

      else if (quinzainePopup === 'autres_primes') {
        var traitWD2 = d.traitWD || { size: 0 };
        var condDetailQ = d.condDetailQ || [];
        var chargDetailQ = d.chargDetailQ || [];
        var ferieDetailQ = d.ferieDetailQ || [];
        var totalTraitement2 = d.totalTraitement || 0;
        var totalConditionnement = d.totalConditionnement || 0;
        var totalChargement = d.totalChargement || 0;
        var totalJourFerie = d.totalJourFerie || 0;
        var totalAutresPrimes = (recapItems.find(function (it) { return it.popupKey === 'autres_primes'; }) || {}).montant || 0;
        var autresList = [
          { label: 'Traitement', icon: 'fa-spray-can-sparkles', color: 'var(--blue)', montant: totalTraitement2, jh: traitWD2.size },
          { label: 'Conditionnement', icon: 'fa-box-open', color: '#e67e22', montant: totalConditionnement, jh: condDetailQ.reduce(function (s, w) { return s + w.jh; }, 0) },
          { label: 'Chargement', icon: 'fa-truck-loading', color: '#8e44ad', montant: totalChargement, jh: chargDetailQ.reduce(function (s, w) { return s + w.jh; }, 0) },
          { label: 'Jour Férié', icon: 'fa-star', color: '#c0392b', montant: totalJourFerie, jh: ferieDetailQ.reduce(function (s, w) { return s + w.jh; }, 0) },
        ];
        popupBody = (
          <div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:12,marginBottom:20}}>
              {autresList.map(function (p, i) {
                return (
                  <div key={i} style={{padding:14,background:p.color + '11',borderRadius:10,borderLeft:'3px solid ' + p.color}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div><i className={'fa-solid ' + p.icon} style={{color:p.color,marginRight:6}}></i><span style={{fontWeight:600,fontSize:12}}>{p.label}</span></div>
                      <span style={{fontSize:10,color:'var(--gray-500)'}}>{p.jh} JH</span>
                    </div>
                    <div style={{fontSize:20,fontWeight:800,color:p.color,marginTop:6}}>{Math.round(p.montant).toLocaleString('fr-FR')} DH</div>
                  </div>
                );
              })}
            </div>
            <div style={{padding:12,background:'rgba(142,68,173,0.06)',borderRadius:10,textAlign:'center'}}>
              <div style={{fontSize:10,color:'var(--gray-500)'}}>Total Autres Primes</div>
              <div style={{fontSize:28,fontWeight:800,color:'#8e44ad'}}>{Math.round(totalAutresPrimes).toLocaleString('fr-FR')} DH</div>
            </div>
          </div>
        );
      }

      modal = (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
          onClick={function () { setQuinzainePopup(null); }}>
          <div style={{background:'#fff',borderRadius:16,maxWidth:900,width:'100%',maxHeight:'90vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}
            onClick={function (e) { e.stopPropagation(); }}>
            {/* Header */}
            <div style={{padding:'16px 24px',borderBottom:'2px solid var(--gray-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:40,height:40,borderRadius:10,background:popupColor,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:16}}>
                  <i className={'fa-solid ' + popupIcon}></i>
                </div>
                <div>
                  <h3 style={{margin:0,fontSize:17,color:'var(--berry)'}}>{popupTitle}</h3>
                  <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>{currentQuinz}{farmFilter ? ' — ' + farmFilter : ''}</div>
                </div>
              </div>
              <button onClick={function () { setQuinzainePopup(null); }}
                style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'var(--gray-400)',padding:4}}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div style={{padding:'20px 24px'}}>
              {popupBody}
            </div>
          </div>
        </div>
      );
    }

    // ── Rendu final ───────────────────────────────────────────────────────────

    return (
      <React.Fragment>
        {/* Badges en-tête */}
        {badges.length > 0 && (
          <div style={{display:'flex',gap:8,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
            {badges.map(function (b, i) {
              return (
                <span key={i} style={{background:b.bg,color:b.color,padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                  <i className={'fa-solid ' + b.icon} style={{marginRight:4}}></i>{b.text}
                </span>
              );
            })}
          </div>
        )}
        {/* Grille de cartes */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))',gap:16,marginBottom:16}}>
          {cards}
        </div>
        {/* Barre de répartition */}
        {repartition}
        {/* Hint "Cliquez" */}
        {clickHint}
        {/* Pop-up modal */}
        {modal}
      </React.Fragment>
    );
  }

  window.QuinzaineRecapCards = QuinzaineRecapCards;
})();
