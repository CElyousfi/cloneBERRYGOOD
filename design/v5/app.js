/* Interface v5 — rendu. Composants entièrement neufs : aucun balisage, aucune
   classe et aucun jeton repris de l'application d'origine. */
(function () {
  'use strict';
  var M = window.SB.MODULES, S = window.SB.SCREENS, CARDS = window.SB.CARDS, I = window.SB.I;
  var $ = function (s) { return document.querySelector(s); };
  function svg(d) { return '<svg viewBox="0 0 24 24">' + d + '</svg>'; }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  var cur = 'overview';

  /* ---------- Rail ------------------------------------------------------- */
  var rail = $('#rail');
  M.forEach(function (m) {
    var b = el('button', 'it', svg(m.i));
    b.title = m.t;
    b.onclick = function () { go(m.screens[0]); };
    b.setAttribute('data-mod', m.k);
    rail.appendChild(b);
  });

  /* ---------- Navigation contextuelle ------------------------------------ */
  function renderNav() {
    var mod = M.filter(function (m) { return m.k === S[cur].mod; })[0];
    $('#navmod').textContent = mod.t;
    $('#navcnt').textContent = mod.screens.length + ' écran' + (mod.screens.length > 1 ? 's' : '');
    var ls = $('#navls'); ls.innerHTML = '';
    mod.screens.forEach(function (k) {
      var sc = S[k];
      var b = el('button', k === cur ? 'on' : '', svg(sc.ico) + '<span>' + sc.nav + '</span>');
      b.onclick = function () { go(k); };
      ls.appendChild(b);
    });
    [].forEach.call(rail.children, function (c) {
      c.classList.toggle('on', c.getAttribute('data-mod') === mod.k);
    });
  }

  /* ---------- Écrans ------------------------------------------------------ */
  function renderOverview(sc) {
    var prof = 'DG';
    try { prof = (localStorage.getItem('lastProfile') || 'DG').toUpperCase(); } catch (e) {}
    var h = '<div class="hero"><div><h1>' + sc.title + ' <span style="color:#9B9B9B">' + prof +
            '</span></h1><p>' + sc.sub + '</p></div><div class="sp"></div>' +
            '<button class="btn">' + svg(I.doc) + 'Exporter</button>' +
            '<button class="btn pri">' + svg(I.grid) + 'Nouvel élément</button></div>';
    h += '<div class="ov">';
    CARDS.forEach(function (c, n) {
      h += '<div class="c" data-go="' + c.go + '">' +
             '<div class="h">' + svg(c.i) + c.h + '</div>' +
             '<div class="t">' + c.t +
               (c.v ? '<div class="v">' + c.v + '</div>' : '') +
               (c.bars ? bars(c.bars) : '') +
             '</div><div class="f">' + c.f + '</div></div>';
    });
    h += '</div>';
    return h;
  }
  function bars(v) {
    var mx = Math.max.apply(null, v);
    return '<div class="bars" style="height:38px">' + v.map(function (x, n) {
      return '<i class="' + (n === v.length - 2 ? 'k' : '') + '" style="height:' +
             Math.round(x / mx * 100) + '%"></i>';
    }).join('') + '</div>';
  }

  function renderTable(sc) {
    var h = '<div class="hero"><div><h1>' + sc.title + '</h1><p>' + sc.sub + '</p></div>' +
            '<div class="sp"></div>' +
            '<button class="btn">' + svg(I.doc) + 'Exporter</button>' +
            '<button class="btn pri">' + svg(I.grid) + 'Ajouter</button></div>';

    if (sc.metrics) {
      h += '<div class="metrics">' + sc.metrics.map(function (m) {
        return '<div class="metric"><div class="k">' + m.k + '</div><div class="v">' + m.v +
               '</div><div class="d">' + (m.d || '') + '</div></div>';
      }).join('') + '</div>';
    }

    h += '<div class="filters"><div class="seg">' +
         (sc.filters || []).map(function (f, n) {
           return '<button class="' + (n === 0 ? 'on' : '') + '">' + f + '</button>';
         }).join('') + '</div><div class="sp"></div>' +
         '<label class="find">' + svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/>') +
         '<input placeholder="Filtrer…"></label></div>';

    var isNum = function (i) { return (sc.num || []).indexOf(i) >= 0; };
    h += '<div class="tbl"><div class="sc"><table><thead><tr>' +
         sc.cols.map(function (c, i) { return '<th class="' + (isNum(i) ? 'n' : '') + '">' + c + '</th>'; }).join('') +
         '</tr></thead><tbody>';
    if (!sc.rows || !sc.rows.length) {
      h += '<tr><td colspan="' + sc.cols.length + '"><div class="empty">' +
           '<div class="t">Aucune donnée</div>' +
           'Les données réelles ne sont pas chargées dans cette démonstration.</div></td></tr>';
    } else {
      sc.rows.forEach(function (r) {
        h += '<tr>' + r.map(function (v, i) {
          return '<td class="' + (isNum(i) ? 'n' : (i === 0 ? '' : 's')) + '">' + v + '</td>';
        }).join('') + '</tr>';
      });
    }
    h += '</tbody></table></div></div>';
    return h;
  }

  function renderAside(sc) {
    var a = sc.aside;
    if (!a) { $('#aside').style.display = 'none'; return; }
    $('#aside').style.display = '';
    var h = '<div class="sec"><h3>' + (a.title || 'Détail') + '</h3>';
    if (a.kv) h += a.kv.map(function (p) {
      return '<div class="kv"><span>' + p[0] + '</span><b>' + p[1] + '</b></div>';
    }).join('');
    if (a.bars) {
      var mx = Math.max.apply(null, a.bars);
      h += '<div class="bars">' + a.bars.map(function (x, n) {
        return '<i class="' + (n === 0 ? 'k' : '') + '" style="height:' +
               Math.round(x / mx * 100) + '%"></i>';
      }).join('') + '</div><div class="lgd"><span>plus élevé</span><span>plus faible</span></div>';
    }
    h += '</div>';
    if (a.note) h += '<div class="sec"><h3>Note</h3><p class="note">' + a.note + '</p></div>';
    $('#aside').innerHTML = h;
  }

  /* ---------- Navigation -------------------------------------------------- */
  function go(k) {
    if (!S[k]) return;
    cur = k;
    var sc = S[k];
    $('#doc').innerHTML = '<div class="pad">' +
      (sc.kind === 'overview' ? renderOverview(sc) : renderTable(sc)) + '</div>';
    renderNav();
    renderAside(sc);
    $('#doc').scrollTop = 0;
    [].forEach.call($('#doc').querySelectorAll('[data-go]'), function (c) {
      c.onclick = function () { go(c.getAttribute('data-go')); };
    });
    try { location.hash = 'e=' + k; } catch (e) {}
  }

  /* Recherche globale : saute au premier écran correspondant */
  $('#q').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var v = e.target.value.toLowerCase().trim();
    if (!v) return;
    var hit = Object.keys(S).filter(function (k) {
      return (S[k].nav + ' ' + S[k].title).toLowerCase().indexOf(v) >= 0;
    })[0];
    if (hit) { go(hit); e.target.value = ''; e.target.blur(); }
  });

  var start = (/e=([a-z]+)/.exec(location.hash || '') || [])[1];
  go(S[start] ? start : 'overview');
})();
