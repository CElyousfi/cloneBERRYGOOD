/* Ouvre l'onglet demandé par la coquille (#tab=<libellé>) puis masque le
   bandeau de démonstration, déjà affiché par la coquille. */
(function () {
  'use strict';
  function want() {
    var m = /(?:^|[#&])tab=([^&]+)/.exec(location.hash || '');
    return m ? decodeURIComponent(m[1]) : null;
  }
  function click(label, tries) {
    tries = tries || 0;
    if (tries > 40) return;
    var more = [].slice.call(document.querySelectorAll('.bnav-item'))
      .filter(function (x) { return /Plus/i.test(x.innerText); })[0];
    var el = [].slice.call(document.querySelectorAll('.bnav-item,.more-menu-item,.nav-item'))
      .filter(function (x) { return x.innerText.trim() === label; })[0];
    if (!el && more) {
      more.click();
      el = [].slice.call(document.querySelectorAll('.more-menu-item'))
        .filter(function (x) { return x.innerText.trim() === label; })[0];
    }
    if (el) { el.click(); return; }
    setTimeout(function () { click(label, tries + 1); }, 300);
  }
  var t = want();
  if (t) { setTimeout(function () { click(t, 0); }, 1200); }
  // le bandeau démo est porté par la coquille : inutile de le doubler ici
  var hide = setInterval(function () {
    var b = document.getElementById('testui-badge');
    if (b) { b.style.display = 'none'; clearInterval(hide); }
  }, 300);
  setTimeout(function () { clearInterval(hide); }, 12000);
})();
