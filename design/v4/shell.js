/* Interface v4 — coquille. Le tableau de bord est écrit de zéro ; les écrans
   métier restent l'application Smart BERRY réelle, chargée dans un cadre, donc
   à fonctionnalités strictement inchangées. */
(function () {
  'use strict';

  var ICON = {
    grid:  '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    doc:   '<path d="M6 2h8l4 4v16H6zM14 2v5h5"/>',
    cash:  '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    leaf:  '<path d="M20 4C10 4 4 9 4 17v3M4 20c10 0 16-5 16-13"/>',
    box:   '<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 22v-9"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0113 0M17 11.5a3 3 0 100-6M21.5 20a5.6 5.6 0 00-4-5.4"/>',
    cog:   '<circle cx="12" cy="12" r="3.1"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>'
  };
  function svg(d){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">'+d+'</svg>'; }

  /* Modules — l'onglet ciblé est celui de l'application réelle. */
  var MODULES = [
    { k:'dashboard', t:'Vue d\'ensemble', i:'grid',  tab:null },
    { k:'finance',   t:'Finance',         i:'cash',  tab:'Trésorerie' },
    { k:'qualite',   t:'Qualité',         i:'chart', tab:'Production' },
    { k:'rh',        t:'RH & Paie',       i:'users', tab:'OJRA (Paie)' },
    { k:'recolte',   t:'Récolte',         i:'leaf',  tab:'Dashboard Récolte' },
    { k:'stock',     t:'Stock',           i:'box',   tab:'Gestion de Stock' },
    { k:'achats',    t:'Achats',          i:'doc',   tab:'Suivi BDC' },
    { k:'pointage',  t:'Pointage',        i:'clock', tab:'Pointage Quotidien' },
    { k:'admin',     t:'Paramètres',      i:'cog',   tab:'Validations' }
  ];

  /* Cartes du tableau de bord — structure de l'exploitation.
     Les valeurs proviennent du jeu de démonstration (aucune donnée réelle :
     Firestore refuse toute lecture non authentifiée). */
  var CARDS = [
    { i:'cash',  h:'Trésorerie',  go:'finance',
      txt:'Solde net projeté sur <b>8 semaines</b>, calendrier Driscoll\'s samedi → vendredi.',
      big:'0 MAD', foot:'Ouvrir la trésorerie' },
    { i:'chart', h:'Production',  go:'qualite',
      txt:'Écarts de production et réconciliation des bons d\'apport.',
      spark:[35,58,42,78,50,66,38,72,45,60], foot:'Voir les écarts' },
    { i:'box',   h:'Stock',       go:'stock',
      txt:'Valeur théorique du stock, <b>4 catégories</b> suivies.',
      big:'1,4 M', foot:'Ouvrir le magasin' },
    { i:'doc',   h:'Achats',      go:'achats',
      txt:'Bons de commande en attente de réception et factures fournisseurs.',
      big:'0', foot:'Suivi des BDC' },
    { i:'users', h:'RH & Paie',   go:'rh',
      txt:'Paie OJRA de la quinzaine, primes et transport.',
      big:'0 MAD', foot:'Ouvrir la paie' },
    { i:'clock', h:'Pointage',    go:'pointage',
      txt:'Pointage du jour par ferme — <b>F1</b>, <b>F5</b> et Avocatier.',
      line:[18,26,20,32,24,38,30,42,34,45], foot:'Voir le pointage' },
    { i:'leaf',  h:'Agronomie',   go:'recolte',
      txt:'Avancement de culture, irrigation et suivi phytosanitaire.',
      big:'—', foot:'Ouvrir l\'agronomie' },
    { i:'grid',  h:'Modules',     go:'dashboard',
      txt:'<b>120 écrans</b> répartis en <b>12 modules</b>, extraits du monolithe d\'origine.',
      big:'12', foot:'Parcourir les modules' }
  ];

  var CHIPS = [
    { t:'Trésorerie',        go:'finance',  i:'cash'  },
    { t:'Bons d\'apport',    go:'qualite',  i:'doc'   },
    { t:'Pointage du jour',  go:'pointage', i:'clock' },
    { t:'Inventaire',        go:'stock',    i:'box'   },
    { t:'Paie OJRA',         go:'rh',       i:'users' }
  ];

  var $ = function (s) { return document.querySelector(s); };

  /* Rail */
  var rail = $('#rail');
  MODULES.forEach(function (m, n) {
    var b = document.createElement('button');
    b.className = 'r' + (n === 0 ? ' on' : '');
    b.title = m.t;
    b.innerHTML = svg(ICON[m.i]);
    b.onclick = function () {
      [].forEach.call(rail.children, function (c) { c.classList.remove('on'); });
      b.classList.add('on');
      m.k === 'dashboard' ? showDash() : openModule(m);
    };
    rail.appendChild(b);
  });

  /* Cartes */
  function sparkHTML(v) {
    var mx = Math.max.apply(null, v);
    return '<div class="spark">' + v.map(function (x, n) {
      return '<i class="' + (n === v.length - 2 ? 'k' : '') + '" style="height:' +
        Math.round(x / mx * 100) + '%"></i>';
    }).join('') + '</div>';
  }
  function lineHTML(v) {
    var mx = Math.max.apply(null, v), w = 100, h = 34;
    var d = v.map(function (x, n) {
      return (n ? 'L' : 'M') + (n / (v.length - 1) * w).toFixed(1) + ' ' +
        (h - x / mx * h).toFixed(1);
    }).join(' ');
    return '<div class="line"><svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><path d="' + d + '"/></svg></div>';
  }

  var cards = $('#cards');
  CARDS.forEach(function (c) {
    var el = document.createElement('div');
    el.className = 'card';
    el.innerHTML =
      '<div class="ch">' + svg(ICON[c.i]) + c.h + '</div>' +
      '<div class="txt">' + c.txt +
        (c.big   ? '<div class="big">' + c.big + '</div>' : '') +
        (c.spark ? sparkHTML(c.spark) : '') +
        (c.line  ? lineHTML(c.line)   : '') +
      '</div>' +
      '<div class="foot">' + c.foot + '</div>';
    el.onclick = function () { jump(c.go); };
    cards.appendChild(el);
  });

  /* Raccourcis */
  var chips = $('#chips');
  CHIPS.forEach(function (c) {
    var b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = svg(ICON[c.i]) + c.t;
    b.onclick = function () { jump(c.go); };
    chips.appendChild(b);
  });

  [].forEach.call(document.querySelectorAll('.ask .row'), function (r) {
    r.onclick = function () { jump(r.getAttribute('data-go')); };
  });
  $('#toMetrics').onclick = function () { jump('finance'); };

  function jump(k) {
    var m = MODULES.filter(function (x) { return x.k === k; })[0];
    if (!m || m.k === 'dashboard') { showDash(); return; }
    var n = MODULES.indexOf(m);
    [].forEach.call(rail.children, function (c, i) { c.classList.toggle('on', i === n); });
    openModule(m);
  }

  /* L'application réelle, chargée dans un cadre : fonctionnalités inchangées. */
  function openModule(m) {
    $('#dash').classList.add('off');
    $('#modview').classList.add('on');
    $('#modtitle').textContent = m.t;
    var f = $('#frame');
    var want = '/app.html' + (m.tab ? '#tab=' + encodeURIComponent(m.tab) : '');
    if (f.getAttribute('data-src') !== want) { f.setAttribute('data-src', want); f.src = want; }
  }
  function showDash() {
    $('#modview').classList.remove('on');
    $('#dash').classList.remove('off');
    [].forEach.call(rail.children, function (c, i) { c.classList.toggle('on', i === 0); });
  }
  $('#back').onclick = showDash;

  /* Profil affiché dans le titre */
  var prof = 'DG';
  try { prof = localStorage.getItem('lastProfile') || 'DG'; } catch (e) {}
  $('#who').textContent = prof.toUpperCase();

  /* Recherche : filtre les cartes */
  $('#q').addEventListener('input', function (e) {
    var v = e.target.value.toLowerCase().trim();
    [].forEach.call(cards.children, function (el, i) {
      var hit = !v || (CARDS[i].h + ' ' + CARDS[i].txt).toLowerCase().indexOf(v) >= 0;
      el.style.display = hit ? '' : 'none';
    });
  });
})();
