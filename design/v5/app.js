/* Interface v5 — coquille pilotant l'application réelle.
   La chrome (rail, colonne de navigation, en-tête, volet) est neuve ; le contenu
   est l'application Smart BERRY d'origine, dont la navigation est lue en direct
   dans le cadre. Tous les écrans et tous les boutons restent donc fonctionnels. */
(function () {
  'use strict';
  var I = window.SB.I, CARDS = window.SB.CARDS;
  var $ = function (s) { return document.querySelector(s); };
  function svg(d) { return '<svg viewBox="0 0 24 24">' + d + '</svg>'; }

  var frame = $('#frame');
  var doc = null;            // document de l'application
  var navItems = [];         // éléments de navigation lus dans l'app
  var mode = 'home';         // 'home' | 'app'

  /* Raccourcis du rail -> libellé d'écran de l'application */
  var RAIL = [
    { t:'Vue d\'ensemble', i:I.grid,  target:null },
    { t:'Trésorerie',      i:I.cash,  target:'Trésorerie' },
    { t:'Factures',        i:I.file,  target:'Factures Fournisseurs' },
    { t:'Achats',          i:I.doc,   target:'Suivi BDC' },
    { t:'Stock',           i:I.box,   target:'Gestion de Stock' },
    { t:'Paie',            i:I.users, target:'OJRA (Paie)' },
    { t:'Pointage',        i:I.clock, target:'Pointage Quotidien' },
    { t:'Production',      i:I.chart, target:'Production' },
    { t:'Agronomie',       i:I.leaf,  target:'Dashboard Récolte' }
  ];

  /* ---------- Accès au document de l'application -------------------------- */
  function appDoc() {
    try { return frame.contentDocument || frame.contentWindow.document; }
    catch (e) { return null; }
  }
  function ready() {
    var d = appDoc();
    return d && d.querySelector('.nav-item, .bnav-item') ? d : null;
  }
  function waitApp(cb, n) {
    n = n || 0;
    var d = ready();
    if (d) { doc = d; cb(d); return; }
    if (n > 90) return;
    setTimeout(function () { waitApp(cb, n + 1); }, 250);
  }

  /* ---------- Lecture de la navigation réelle ----------------------------- */
  function readNav(d) {
    var more = [].slice.call(d.querySelectorAll('.bnav-item'))
      .filter(function (x) { return /Plus/i.test(x.innerText); })[0];
    if (more) { try { more.click(); } catch (e) {} }
    var seen = {}, out = [];
    [].slice.call(d.querySelectorAll('.nav-item, .bnav-item, .more-menu-item'))
      .forEach(function (el) {
        var t = (el.innerText || '').trim();
        if (!t || /^Plus$/i.test(t) || seen[t]) return;
        seen[t] = 1;
        out.push({ label: t, el: el });
      });
    return out;
  }
  function readProfiles(d) {
    return [].slice.call(d.querySelectorAll('.profile-chip')).map(function (el) {
      return { label: (el.innerText || '').trim(), el: el, on: /active/.test(el.className) };
    });
  }
  function currentTitle(d) {
    var h = d.querySelector('.content-header h1');
    return h ? (h.innerText || '').trim() : '';
  }

  /* ---------- Rendu de la chrome ------------------------------------------ */
  function renderRail() {
    var r = $('#rail'); r.innerHTML = '';
    RAIL.forEach(function (m, n) {
      var b = document.createElement('button');
      b.className = 'it' + (n === 0 && mode === 'home' ? ' on' : '');
      b.title = m.t; b.innerHTML = svg(m.i);
      b.onclick = function () { m.target ? open(m.target) : home(); };
      r.appendChild(b);
    });
  }

  function renderNav() {
    var ls = $('#navls'); ls.innerHTML = '';
    if (!navItems.length) {
      ls.innerHTML = '<div style="padding:12px;color:#9B9B9B;font-size:12px">Chargement…</div>';
      return;
    }
    var title = doc ? currentTitle(doc) : '';
    navItems.forEach(function (it) {
      var b = document.createElement('button');
      b.className = (it.label === title ? 'on' : '');
      b.innerHTML = svg(I.file) + '<span>' + it.label + '</span>';
      b.onclick = function () { open(it.label); };
      ls.appendChild(b);
    });
    $('#navcnt').textContent = navItems.length + ' écran' + (navItems.length > 1 ? 's' : '');
  }

  function renderProfiles() {
    if (!doc) return;
    var ps = readProfiles(doc), sel = $('#prof');
    sel.innerHTML = '';
    ps.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.label; o.textContent = p.label; o.selected = p.on;
      sel.appendChild(o);
    });
    sel.onchange = function () {
      var hit = readProfiles(doc).filter(function (x) { return x.label === sel.value; })[0];
      if (!hit) return;
      try { hit.el.click(); } catch (e) {}
      setTimeout(function () {
        navItems = readNav(doc); renderNav(); syncTitle();
      }, 900);
    };
  }

  function syncTitle() {
    if (!doc) return;
    var t = currentTitle(doc);
    if (t) { $('#scr').textContent = t; }
    renderNavActive(t);
  }
  function renderNavActive(t) {
    [].forEach.call($('#navls').children, function (b) {
      b.classList.toggle('on', (b.textContent || '').trim() === t);
    });
  }

  /* ---------- Navigation --------------------------------------------------- */
  function open(label) {
    mode = 'app';
    $('#home').style.display = 'none';
    $('#appview').style.display = 'flex';
    [].forEach.call($('#rail').children, function (c, i) {
      c.classList.toggle('on', RAIL[i] && RAIL[i].target === label);
    });
    if (!doc) { waitApp(function () { open(label); }); return; }
    var hit = navItems.filter(function (x) { return x.label === label; })[0];
    if (!hit) {                       // libellé raccourci absent du profil courant
      navItems = readNav(doc);
      hit = navItems.filter(function (x) { return x.label === label; })[0];
      renderNav();
    }
    if (hit) { try { hit.el.click(); } catch (e) {} }
    setTimeout(syncTitle, 600);
    setTimeout(syncTitle, 1600);
  }
  function home() {
    mode = 'home';
    $('#appview').style.display = 'none';
    $('#home').style.display = '';
    $('#scr').textContent = 'Vue d\'ensemble';
    [].forEach.call($('#rail').children, function (c, i) { c.classList.toggle('on', i === 0); });
  }
  $('#backHome').onclick = home;

  /* ---------- Vue d'ensemble ---------------------------------------------- */
  function bars(v) {
    var mx = Math.max.apply(null, v);
    return '<div class="bars" style="height:38px">' + v.map(function (x, n) {
      return '<i class="' + (n === v.length - 2 ? 'k' : '') + '" style="height:' +
             Math.round(x / mx * 100) + '%"></i>';
    }).join('') + '</div>';
  }
  var GO = { treso:'Trésorerie', bons:'Production', intrants:'Gestion de Stock',
             bdc:'Suivi BDC', paie:'OJRA (Paie)', pointage:'Pointage Quotidien',
             parcelles:'Dashboard Récolte', factures:'Factures Fournisseurs' };
  (function renderHome() {
    var prof = 'DG';
    var h = '<div class="hero"><div><h1>Bonjour <span style="color:#9B9B9B">' + prof +
            '</span></h1><p>L\'état de l\'exploitation, campagne 2025-2026.</p></div></div><div class="ov">';
    CARDS.forEach(function (c) {
      h += '<div class="c" data-go="' + c.go + '"><div class="h">' + svg(c.i) + c.h + '</div>' +
           '<div class="t">' + c.t + (c.v ? '<div class="v">' + c.v + '</div>' : '') +
           (c.bars ? bars(c.bars) : '') + '</div><div class="f">' + c.f + '</div></div>';
    });
    $('#home').innerHTML = '<div class="pad">' + h + '</div></div>';
    [].forEach.call($('#home').querySelectorAll('[data-go]'), function (c) {
      c.onclick = function () {
        var t = GO[c.getAttribute('data-go')];
        if (t) open(t);
      };
    });
  })();

  /* ---------- Recherche ---------------------------------------------------- */
  $('#q').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var v = e.target.value.toLowerCase().trim(); if (!v) return;
    var hit = navItems.filter(function (x) { return x.label.toLowerCase().indexOf(v) >= 0; })[0];
    if (hit) { open(hit.label); e.target.value = ''; e.target.blur(); }
  });

  /* ---------- Démarrage ---------------------------------------------------- */
  renderRail();
  frame.src = '/app.html';
  waitApp(function (d) {
    navItems = readNav(d);
    renderNav(); renderProfiles(); syncTitle();
    // l'app peut re-rendre : on resynchronise périodiquement
    setInterval(function () {
      if (!doc) return;
      var n = readNav(doc);
      if (n.length !== navItems.length) { navItems = n; renderNav(); }
      syncTitle();
    }, 2500);
  });
})();
