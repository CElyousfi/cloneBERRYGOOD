/* emargementChefsPrintWindow — construit le document imprimable des états
 * d'émargement chefs et le pousse dans la fenêtre ouverte par l'appelant.
 *
 * Extrait de QuinzaineTab (3 554 lignes) : la fonction ne lisait RIEN de la
 * portée du composant — ni état, ni props, ni hook. Tout lui arrive par ses
 * deux arguments, ce qui en faisait 122 lignes de génération de HTML logées
 * dans un composant React sans raison de s'y trouver.
 *
 * @param {{dates?: string[], fermes?: object, divers?: object, periode?: string}} _d
 *   données d'émargement renvoyées par l'API.
 * @param {Window} _pw fenêtre déjà ouverte par l'appelant. Elle DOIT l'être
 *   avant l'await côté appelant : un window.open() différé après une opération
 *   asynchrone est bloqué comme popup par le navigateur.
 */
function _openEmargChefsPrintWindow(_d, _pw) {
  var _dates = _d.dates || [];
  var _fermes = _d.fermes || {};
  var _divers = _d.divers || {};
  var _periode = _d.periode || '';

  function _fmtD(iso) { return iso ? iso.slice(8,10)+'/'+iso.slice(5,7) : ''; }
  function _n(v) { return Number(v)||0; }

  function _buildFermeSection(fk, isLast) {
    var f = _fermes[fk];
    if (!f || !f.parcelles || f.parcelles.length === 0) return '';
    var FLABELS = { F1:'Framboise (F1)', F5:'Myrtille (F5)', Avocatier:'Avocatier' };
    var thDates = _dates.map(function(d){return '<th>'+_fmtD(d)+'</th>';}).join('');

    var bodyRows = '';
    f.parcelles.forEach(function(p) {
      // Ligne parcelle — header groupe (fond bleu-gris)
      bodyRows += '<tr class="parc-row"><td class="lbl parc-hdr" colspan="'+(2+_dates.length)+'">&#9654; '+p.label+'</td></tr>';
      // Sous-lignes : une par équipe de transport
      (p.equipes || []).forEach(function(eq) {
        var cells = _dates.map(function(d) {
          var day = eq.byDay && eq.byDay[d];
          if (!day || _n(day.ouvriers)===0) return '<td class="empty">&mdash;</td>';
          var jhStr = _n(day.jh)%1===0 ? _n(day.jh).toFixed(0) : _n(day.jh).toFixed(1);
          return '<td>'+day.ouvriers+'<br><small>'+jhStr+' JH</small></td>';
        }).join('');
        var totJH = eq.totalJH || 0;
        var totOuv = Object.values(eq.byDay || {}).reduce(function(s,d){return s+_n(d.ouvriers);},0);
        bodyRows += '<tr><td class="lbl eq-transport-lbl">&nbsp;&nbsp;&nbsp;'+eq.nom+'</td>'+cells+'<td class="tot">'+totOuv+'<br><small>'+(totJH%1===0?totJH.toFixed(0):totJH.toFixed(1))+' JH</small></td></tr>';
      });
    });

    // Ligne total ferme
    var totCells = _dates.map(function(d) {
      var tJH = 0, tOuv = 0;
      (f.parcelles||[]).forEach(function(p){
        (p.equipes||[]).forEach(function(eq){
          var day=eq.byDay&&eq.byDay[d];
          if(day){tJH+=_n(day.jh);tOuv+=_n(day.ouvriers);}
        });
      });
      if (tJH===0) return '<td class="empty tot">&mdash;</td>';
      return '<td class="tot"><strong>'+tOuv+'</strong><br><small>'+(tJH%1===0?tJH.toFixed(0):tJH.toFixed(1))+' JH</small></td>';
    }).join('');
    var gTot = _n(f.totalJH);
    bodyRows += '<tr class="total-row"><td class="lbl"><strong>TOTAL '+FLABELS[fk].toUpperCase()+'</strong></td>'+totCells+'<td class="tot"><strong>'+(gTot%1===0?gTot.toFixed(0):gTot.toFixed(1))+' JH</strong></td></tr>';

    return '<section style="'+(isLast?'':'page-break-after:always;')+'">' +
      '<div class="titre">BERRYGOOD FARMS &mdash; &Eacute;tat d\'&eacute;margement</div>' +
      '<div class="stit">'+FLABELS[fk]+' &mdash; '+_periode+'</div>' +
      '<table><thead><tr><th class="lcol">Parcelle / &Eacute;quipe</th>'+thDates+'<th>TOTAL</th></tr></thead>' +
      '<tbody>'+bodyRows+'</tbody></table>' +
      '<div class="sign">Signature Chef de Ferme : ___________________________________ &nbsp;&nbsp; Date : ___________</div>' +
      '</section>';
  }

  function _buildDiversSection() {
    var lignes = _divers.lignes || [];
    var thDates = _dates.map(function(d){return '<th>'+_fmtD(d)+'</th>';}).join('');
    var bodyRows = '';
    if (lignes.length === 0) {
      bodyRows = '<tr><td colspan="'+(2+_dates.length)+'" style="color:#888;padding:16px;text-align:center">Aucune entr&eacute;e Location &amp; Engins pour cette p&eacute;riode.</td></tr>';
    } else {
      lignes.forEach(function(l) {
        var cells = _dates.map(function(d) {
          var day = l.byDay && l.byDay[d];
          if (!day || _n(day.q)===0) return '<td class="empty">&mdash;</td>';
          return '<td>'+_n(day.q)+'<br><small>'+_n(day.m).toFixed(0)+' DH</small></td>';
        }).join('');
        bodyRows += '<tr><td class="lbl parc-lbl">'+(l.beneficiaire||'')+'<br><small style="color:#555">'+((l.fonction||''))+'</small></td>'+cells+'<td class="tot">'+_n(l.totQ).toFixed(1)+'<br><small>'+_n(l.totM).toFixed(0)+' DH</small></td></tr>';
      });
      var totCells = _dates.map(function(d) {
        var tM = lignes.reduce(function(s,l){ return s+(_n((l.byDay&&l.byDay[d]&&l.byDay[d].m)||0)); },0);
        if (tM===0) return '<td class="empty tot">&mdash;</td>';
        return '<td class="tot"><strong>'+tM.toFixed(0)+' DH</strong></td>';
      }).join('');
      bodyRows += '<tr class="total-row"><td class="lbl"><strong>TOTAL</strong></td>'+totCells+'<td class="tot"><strong>'+_n(_divers.totalMontant).toFixed(0)+' DH</strong></td></tr>';
    }
    return '<section>' +
      '<div class="titre">BERRYGOOD FARMS &mdash; Location &amp; Engins</div>' +
      '<div class="stit">'+_periode+'</div>' +
      '<table><thead><tr><th class="lcol">B&eacute;n&eacute;ficiaire / Fonction</th>'+thDates+'<th>TOTAL</th></tr></thead>' +
      '<tbody>'+bodyRows+'</tbody></table>' +
      '<div class="sign">Signature : ___________________________________ &nbsp;&nbsp; Date : ___________</div>' +
      '</section>';
  }

  var html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
    '<title>Emargement Chefs &mdash; '+_periode+'</title><style>' +
    'body{font-family:Arial,sans-serif;font-size:9pt;margin:0;padding:0}' +
    'section{padding:10px 14px;box-sizing:border-box}' +
    '@media print{section{page-break-after:always}section:last-child{page-break-after:auto}@page{size:A4 landscape;margin:8mm}}' +
    '.titre{font-size:13pt;font-weight:bold;color:#1a237e;margin-bottom:2px}' +
    '.stit{font-size:10pt;color:#555;margin-bottom:8px}' +
    'table{border-collapse:collapse;width:100%;table-layout:fixed}' +
    'th,td{border:1px solid #ccc;padding:3px 4px;text-align:center;font-size:8pt;vertical-align:middle}' +
    'th{background:#e8eaf6;font-size:7.5pt}' +
    '.lcol{width:200px;text-align:left}' +
    '.lbl{text-align:left;padding-left:5px}' +
    '.parc-lbl{padding-left:14px}' +
    '.eq-lbl{background:#c5cae9;font-weight:bold;font-size:8.5pt;padding-left:5px}' +
    '.eq-row td{background:#c5cae9}' +
    '.parc-row td{background:#c5cae9;font-weight:bold;font-size:8.5pt;padding-left:5px}' +
    '.eq-transport-lbl{padding-left:20px;font-size:8pt}' +
    '.tot{background:#f5f5f5;font-weight:bold}' +
    '.total-row td{background:#e8f5e9;font-weight:bold}' +
    '.empty{color:#bbb}' +
    'small{font-size:7pt;color:#555}' +
    '.sign{margin-top:20px;font-size:10pt;color:#333;border-top:1px solid #ccc;padding-top:10px}' +
    '</style></head><body>' +
    _buildFermeSection('F1', false) +
    _buildFermeSection('F5', false) +
    _buildFermeSection('Avocatier', false) +
    _buildDiversSection() +
    '</body></html>';

  var pw = _pw;
  pw.document.write(html);
  pw.document.close();
  setTimeout(function(){ pw.print(); }, 700);
}

export { _openEmargChefsPrintWindow };
