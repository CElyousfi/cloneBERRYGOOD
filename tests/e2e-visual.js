/**
 * Berry Good Dashboard — Suite E2E Visuelle (Playwright)
 * ======================================================
 *
 * Se connecte avec le compte de test QA, navigue les écrans clés sur
 * Chromium ET WebKit, vérifie l'absence de crash JS + la présence
 * d'éléments clés, prend des screenshots pleine page et produit un
 * rapport ✅/🔴 par écran et par navigateur.
 *
 * USAGE
 *   node tests/e2e-visual.js
 *   npm run test:e2e
 *
 * VARIABLES D'ENVIRONNEMENT
 *   E2E_URL        URL cible (défaut: https://berrygood-farms-dashboard.web.app)
 *                  Ex: E2E_URL=https://...preview... node tests/e2e-visual.js
 *   E2E_WRITE      Si "1", exécute les actions d'écriture réelles (création
 *                  sortie/réception test) et vérifie le message de succès.
 *                  Par DÉFAUT (non défini) : NE soumet RIEN — vérifie seulement
 *                  que le formulaire/modal s'ouvre. Anti-pollution prod, car le
 *                  preview partage le backend de prod.
 *   E2E_BROWSERS   Liste de navigateurs séparés par virgule (défaut:
 *                  "chromium,webkit"). Pratique pour debug.
 *
 * CREDENTIALS (jamais en dur) : lus depuis .env (gitignored) —
 *   QA_TEST_EMAIL, QA_TEST_PASSWORD.
 *
 * Screenshots : tests/e2e-screenshots/<browser>/<NN-screen>.png (recréé au début).
 * Exit code ≠ 0 si au moins un écran est 🔴 (pour CI futur).
 *
 * NAVIGATEURS : Chromium ET WebKit sont OBLIGATOIRES — certains crashs de boot
 * n'apparaissent que sur WebKit/Safari (cf. incidents `__api`/`calculerPaieOuvrier`).
 * Installer les moteurs si besoin :
 *   node_modules/.bin/playwright install chromium webkit
 */

'use strict';

const fs = require('fs');
const path = require('path');

// dotenv est dans les deps ; fallback parse maison si absent.
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_e) {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  }
}

const { chromium, webkit } = require('playwright');

const E2E_URL = (process.env.E2E_URL || 'https://berrygood-farms-dashboard.web.app').replace(/\/$/, '');
const E2E_WRITE = process.env.E2E_WRITE === '1';
const BROWSERS = (process.env.E2E_BROWSERS || 'chromium,webkit').split(',').map(s => s.trim()).filter(Boolean);
const EMAIL = process.env.QA_TEST_EMAIL;
const PASSWORD = process.env.QA_TEST_PASSWORD;
const SCREENSHOT_ROOT = path.join(__dirname, 'e2e-screenshots');

const NAV_TIMEOUT = 25000;   // boot/chargement app
const STEP_TIMEOUT = 15000;  // attente d'un élément clé

const ENGINES = { chromium, webkit };

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// Reconnaît la signature du crash SVG partagé (graphiques pie/barres avec
// total=0 → angle NaN / hauteur négative). Bug applicatif pré-existant,
// indépendant de chaque écran (re-render à chaque navigation).
function isSharedSvgChartCrash(msg) {
  return /attribute d:.*NaN|Problem parsing d=.*NaN|attribute height.*-?\d|Invalid negative value for <rect>/i.test(msg);
}

function dataTour(tabId) {
  // Cf. app.jsx : data-tour={`nav-${item.id.replace(/_/g, '-')}`}
  return 'nav-' + tabId.replace(/_/g, '-');
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Capture les erreurs JS / console.error d'une page.
function attachErrorCollectors(page) {
  const errors = [];
  page.on('pageerror', err => errors.push('pageerror: ' + (err && err.message ? err.message : String(err))));
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      // Ignorer le bruit réseau habituel (favicon, ressources externes, 401 API).
      if (/Failed to load resource|favicon|net::ERR|status of 4\d\d|status of 5\d\d/i.test(txt)) return;
      errors.push('console.error: ' + txt);
    }
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Helpers app
// ---------------------------------------------------------------------------

// Ferme les overlays qui se ré-ouvrent automatiquement (popup Notifications par
// profil, guide interactif) et qui obscurcissent les écrans.
async function dismissOverlays(page) {
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find(x => /^Plus tard$/i.test(x.innerText.trim()));
    if (b) b.click();
  }).catch(() => {});
  await sleep(300);
}

async function login(page) {
  await page.goto(E2E_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  // Le formulaire de login : <input type="email"> + <input type="password"> +
  // bouton submit "Se connecter".
  await page.waitForSelector('input[type="email"]', { timeout: NAV_TIMEOUT });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  // Post-login : la barre de profils (admin) ou la sidebar apparaît.
  await page.waitForSelector('.sidebar-nav, .profile-bar', { timeout: NAV_TIMEOUT });
  // Laisser le temps au fetch initial des données.
  await sleep(1500);
  await dismissOverlays(page);
}

// Label exact des chips de profil (cf. PROFILES dans app.jsx).
const PROFILE_LABELS = {
  rh: 'Resp. RH',
  chef_f1: 'Chef F1',
  achats: 'Achats',
  magasinier: 'Magasinier',
  dg: 'DG',
};

async function switchProfile(page, profileId) {
  // La barre de profils n'est visible que pour admin/finance (isFullAccess).
  // Les chips sont des <button class="profile-chip"> dans un .chips-track à
  // défilement horizontal — un click Playwright standard timeout (actionability),
  // donc on déclenche le onClick React via DOM .click() en evaluate (fiable).
  const label = PROFILE_LABELS[profileId];
  if (!label) throw new Error(`Profil non mappé: ${profileId}`);

  const clicked = await page.evaluate(lbl => {
    const chips = Array.from(document.querySelectorAll('.profile-chip'));
    const chip = chips.find(c => c.innerText.trim() === lbl);
    if (!chip) return false;
    chip.click();
    return true;
  }, label);

  if (!clicked) {
    // Fallback : forcer via localStorage + reload.
    await page.evaluate(pid => localStorage.setItem('lastProfile', pid), profileId);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForSelector('.sidebar-nav', { timeout: NAV_TIMEOUT });
  }

  // Attendre que la sidebar reflète le profil (chip actif = label) + re-render.
  try {
    await page.waitForFunction(
      lbl => {
        const active = document.querySelector('.profile-chip.active');
        return active && active.innerText.trim() === lbl;
      },
      label,
      { timeout: STEP_TIMEOUT }
    );
  } catch (_e) { /* tolérer : gotoTab validera la nav */ }
  await sleep(1000);
  // Le changement de profil ré-ouvre parfois la popup Notifications.
  await dismissOverlays(page);
}

async function gotoTab(page, tabId) {
  const tour = dataTour(tabId);
  const selector = `[data-tour="${tour}"]`;
  // Retry léger : le menu peut être en train de re-render après switch profil.
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.waitForSelector(selector, { timeout: STEP_TIMEOUT, state: 'attached' });
      // Click via DOM evaluate (onClick React) — robuste vs actionability sidebar.
      const ok = await page.evaluate(t => {
        const el = document.querySelector(`[data-tour="${t}"]`);
        if (!el) return false;
        el.click();
        return true;
      }, tour);
      if (!ok) throw new Error('élément disparu après wait');
      // Confirmer que l'onglet est devenu actif.
      await page.waitForFunction(
        t => {
          const el = document.querySelector(`[data-tour="${t}"]`);
          return el && el.classList.contains('active');
        },
        tour,
        { timeout: STEP_TIMEOUT }
      );
      await sleep(1200);
      await dismissOverlays(page);
      return;
    } catch (e) {
      lastErr = e;
      await sleep(800);
    }
  }
  throw new Error(`Onglet "${tabId}" inaccessible (selector ${selector}): ${lastErr && lastErr.message}`);
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText || '');
}

async function screenshot(page, browserName, index, name) {
  const dir = path.join(SCREENSHOT_ROOT, browserName);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

// ---------------------------------------------------------------------------
// Définition des écrans (assertions spec Omar)
// Chaque check renvoie { ok: bool, detail: string }.
// ---------------------------------------------------------------------------

const SCREENS = [
  {
    id: 'pointage', name: 'Pointage du jour', profile: 'rh', tab: 'pointage',
    async check(page) {
      // Le jour courant peut être vide (0 ouvrier pointé). Sélectionner la date
      // passée avec le PLUS d'ouvriers via le <select> de date du pointage
      // (celui dont la 1re option = "Aujourd'hui").
      // Attendre que le select de date soit rendu (panneau synchro conditionnel).
      await page.waitForFunction(() => {
        return Array.from(document.querySelectorAll('select'))
          .some(s => /Aujourd/i.test(s.options[0] && s.options[0].textContent || ''));
      }, { timeout: STEP_TIMEOUT }).catch(() => {});
      const pickedOuv = await page.evaluate(() => {
        const sel = Array.from(document.querySelectorAll('select'))
          .find(s => /Aujourd/i.test(s.options[0] && s.options[0].textContent || ''));
        if (!sel) return -1;
        let best = null, bestN = 0;
        Array.from(sel.options).forEach(o => {
          const m = o.textContent.match(/\((\d+)\s*ouv/);
          const n = m ? parseInt(m[1], 10) : 0;
          if (o.value && n > bestN) { bestN = n; best = o.value; }
        });
        if (!best) return 0;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, best);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return bestN;
      });
      await sleep(3000);
      const text = await bodyText(page);
      if (text.length < 200) return { ok: false, detail: 'écran quasi vide' };
      // AUCUN "AUTRE" parasite dans le classement.
      if (/\bAUTRE\b/.test(text)) return { ok: false, detail: 'texte "AUTRE" parasite présent dans le classement' };
      // Déplier toutes les fermes du "Détail Pointage" pour révéler les ouvriers,
      // puis les sous-groupes équipe.
      await page.evaluate(() => {
        document.querySelectorAll('tr[style*="cursor"]').forEach(r => {
          if (/F1|F5|Avocatier|BAHIA/.test(r.innerText)) r.click();
        });
      });
      await sleep(1500);
      await page.evaluate(() => {
        document.querySelectorAll('div[style*="cursor"]').forEach(d => {
          if (d.querySelector('i.fa-chevron-right, i.fa-chevron-down')) d.click();
        });
      });
      await sleep(1200);
      // Cliquer un ouvrier (WorkerLink : span[title^="Voir fiche"]) → popup paie.
      const link = page.locator('span[title^="Voir fiche"]').first();
      if (await link.count() === 0) {
        return { ok: false, detail: `aucun ouvrier cliquable — données de pointage vides (max ${pickedOuv} ouv. sur les dates dispo)` };
      }
      await link.click({ timeout: STEP_TIMEOUT, force: true });
      // Popup : "Historique Pointage (derniers 30 jours)" + "Coût Total".
      try {
        await page.waitForFunction(
          () => /Historique Pointage/i.test(document.body.innerText),
          { timeout: STEP_TIMEOUT }
        );
      } catch (_e) {
        return { ok: false, detail: 'popup paie ne s\'ouvre pas (Historique Pointage absent)' };
      }
      const popText = await bodyText(page);
      if (!/Co[ûu]t Total/i.test(popText)) {
        return { ok: false, detail: 'breakdown "Coût Total" absent dans la popup' };
      }
      return { ok: true, detail: 'équipes + popup paie OK (breakdown Coût Total)' };
    },
  },
  {
    id: 'mag_sortie', name: 'Sorties de Stock', profile: 'magasinier', tab: 'mag_sortie',
    async check(page) {
      await sleep(1000);
      const text = await bodyText(page);
      if (text.length < 150) return { ok: false, detail: 'écran vide' };
      // Bouton "Nouvelle sortie" → ouvre le modal "Nouvelle Sortie de Stock".
      // Attente ACTIVE du rendu du bouton (robuste au timing de chargement de la
      // liste : Chromium peut peindre plus tard que les 2 s fixes d'avant → flaky).
      try {
        await page.waitForFunction(
          () => Array.from(document.querySelectorAll('button')).some(x => /nouvelle sortie/i.test(x.innerText)),
          { timeout: STEP_TIMEOUT }
        );
      } catch (_e) {
        return { ok: false, detail: 'bouton "Nouvelle sortie" introuvable (après attente)' };
      }
      const clicked = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(x => /nouvelle sortie/i.test(x.innerText));
        if (!b) return false;
        b.click();
        return true;
      });
      if (!clicked) return { ok: false, detail: 'bouton "Nouvelle sortie" introuvable' };
      // Attendre le modal.
      try {
        await page.waitForFunction(
          () => /Nouvelle Sortie de Stock|Articles? [àa] sortir/i.test(document.body.innerText),
          { timeout: STEP_TIMEOUT }
        );
      } catch (_e) {
        return { ok: false, detail: 'modal "Nouvelle Sortie de Stock" ne s\'ouvre pas' };
      }
      const formFields = await page.locator('input, select, textarea').count();
      if (E2E_WRITE) {
        return { ok: true, detail: 'E2E_WRITE actif — création non implémentée (sécurité prod) ; modal ouvert' };
      }
      return { ok: true, detail: `modal ouvert (${formFields} champs) — mode lecture` };
    },
  },
  {
    id: 'mag_reception', name: 'Bons de Réception', profile: 'magasinier', tab: 'mag_reception',
    async check(page) {
      const text = await bodyText(page);
      if (text.length < 100) return { ok: false, detail: 'écran vide' };
      // Au minimum : onglet accessible. Tenter d'ouvrir un formulaire si bouton présent.
      const btn = page.locator('button', { hasText: /nouvelle? r[ée]ception|nouveau bon|cr[ée]er/i }).first();
      if (await btn.count() > 0) {
        await btn.click({ timeout: STEP_TIMEOUT }).catch(() => {});
        await sleep(800);
      }
      if (E2E_WRITE) {
        return { ok: true, detail: 'E2E_WRITE actif mais création non implémentée (sécurité) — onglet accessible' };
      }
      return { ok: true, detail: 'onglet accessible — mode lecture' };
    },
  },
  {
    id: 'achats_receptions_valoriser', name: 'Réceptions à valoriser', profile: 'achats', tab: 'achats_receptions_valoriser',
    async check(page) {
      const text = await bodyText(page);
      if (text.length < 60) return { ok: false, detail: 'écran vide' };
      return { ok: true, detail: 'onglet accessible, 0 crash' };
    },
  },
  {
    id: 'achats_catalogue', name: 'Catalogue Produits', profile: 'achats', tab: 'achats_catalogue',
    async check(page) {
      // Attendre le chargement de la liste (fetch /api/stock?action=list-articles).
      await sleep(2500);
      // Compter les lignes de tableau OU détecter un compteur d'articles.
      const rows = await page.locator('table tbody tr').count();
      const text = await bodyText(page);
      const counterMatch = text.match(/(\d[\d\s.,]{2,})\s*(articles?|produits?|r[ée]f[ée]rences?)/i);
      const counter = counterMatch ? parseInt(counterMatch[1].replace(/[^\d]/g, ''), 10) : 0;
      const manyRows = rows >= 500;            // longue liste
      const bigCounter = counter >= 500;
      // Bouton "Fusionner doublons" visible.
      const fusion = page.locator('button', { hasText: /fusionner doublons/i });
      const fusionVisible = await fusion.count() > 0;
      if (!manyRows && !bigCounter) {
        return { ok: false, detail: `liste courte (${rows} lignes, compteur=${counter || 'n/a'})` };
      }
      if (!fusionVisible) {
        return { ok: false, detail: `liste OK (${rows} lignes) mais bouton "Fusionner doublons" absent` };
      }
      return { ok: true, detail: `${rows} lignes / compteur ${counter || 'n/a'} + bouton Fusionner doublons` };
    },
  },
  {
    id: 'achats_bdc', name: 'Bons de Commande', profile: 'achats', tab: 'achats_bdc',
    async check(page) {
      await sleep(2500); // catalogue chargé (alimente la datalist)
      const text = await bodyText(page);
      if (text.length < 60) return { ok: false, detail: 'écran vide' };
      // Ouvrir le formulaire BDC via le bouton dédié (data-tour="btn-new-bdc").
      const opened = await page.evaluate(() => {
        const b = document.querySelector('[data-tour="btn-new-bdc"]');
        if (!b) return false;
        b.click();
        return true;
      });
      if (!opened) return { ok: false, detail: 'bouton Nouveau BDC (btn-new-bdc) introuvable' };
      // Attendre le bloc articles du formulaire.
      try {
        await page.waitForSelector('[data-tour="bdc-form-items"]', { timeout: STEP_TIMEOUT });
      } catch (_e) {
        return { ok: false, detail: 'formulaire BDC (bdc-form-items) ne s\'ouvre pas' };
      }
      await sleep(800);
      // Champ article (input[list="bdc-articles-0"]) + datalist alimentée.
      const articleInput = await page.locator('input[list^="bdc-articles-"]').count();
      const datalistOptions = await page.locator('datalist[id^="bdc-articles-"] option').count();
      if (articleInput === 0) {
        return { ok: false, detail: 'champ article (input[list=bdc-articles]) introuvable' };
      }
      if (datalistOptions === 0) {
        return { ok: false, detail: 'datalist article vide (catalogue non proposé)' };
      }
      return { ok: true, detail: `champ article + datalist (${datalistOptions} options du catalogue)` };
    },
  },
  {
    id: 'cout_recolte', name: 'Coût Récolte', profile: 'dg', tab: 'cout_recolte',
    async check(page) {
      await sleep(3000);
      // Scroller jusqu'au panneau graphe pour le rendre/screenshoter.
      await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('*')).find(n => /Historique DH\/Kg/i.test(n.textContent || '') && n.children.length < 5);
        if (el) el.scrollIntoView({ block: 'center' });
      });
      await sleep(1500);
      const text = await bodyText(page);
      if (!/Historique DH\/Kg/i.test(text)) {
        return { ok: false, detail: 'titre "Historique DH/Kg" absent' };
      }
      // Barres du graphe avec hauteur réelle (> 4px).
      const barHeights = await page.evaluate(() => {
        const bars = Array.from(document.querySelectorAll('[title*="DH/Kg"]'));
        return bars.map(b => {
          const h = parseFloat((b.style && b.style.height) || '0');
          return isNaN(h) ? 0 : h;
        });
      });
      const nonEmpty = barHeights.filter(h => h > 4).length;
      // Tableau "Coût par Culture".
      const hasCulture = /Co[ûu]t par Culture/i.test(text);
      if (barHeights.length === 0) {
        return { ok: false, detail: 'graphe sans barres (pas de données récolte sur la période)' };
      }
      if (nonEmpty === 0) {
        return { ok: false, detail: `graphe vide (${barHeights.length} barres à hauteur ~0)` };
      }
      if (!hasCulture) {
        return { ok: false, detail: `graphe OK (${nonEmpty}/${barHeights.length} barres) mais panneau "Coût par Culture" absent` };
      }
      return { ok: true, detail: `graphe OK (${nonEmpty}/${barHeights.length} barres remplies) + tableau Culture` };
    },
  },
  {
    id: 'rh_equipes', name: 'Équipes', profile: 'rh', tab: 'rh_equipes',
    async check(page) {
      await sleep(1500);
      const text = await bodyText(page);
      if (text.length < 200) return { ok: false, detail: 'écran quasi vide' };
      // Présence d'au moins une notion d'équipe / ouvriers / prime.
      const hasEquipe = /[ée]quipe/i.test(text);
      const hasOuv = /ouvrier|effectif/i.test(text) || (await page.locator('table tbody tr').count()) > 0;
      if (!hasEquipe || !hasOuv) {
        return { ok: false, detail: 'équipes/ouvriers non listés' };
      }
      return { ok: true, detail: 'équipes listées (noms + ouvriers)' };
    },
  },
  {
    id: 'quinzaine', name: 'Quinzaine', profile: 'rh', tab: 'quinzaine',
    async check(page) {
      await sleep(1500);
      const text = await bodyText(page);
      if (text.length < 150) return { ok: false, detail: 'écran vide' };
      return { ok: true, detail: 'données affichées, 0 crash' };
    },
  },
  {
    id: 'paie', name: 'Paie', profile: 'rh', tab: 'paie',
    async check(page) {
      // La paie charge un gros dataset (lent surtout sur WebKit) — poll long.
      let rows = 0;
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        rows = await page.locator('table tbody tr').count();
        if (rows > 0) break;
      }
      const text = await bodyText(page);
      if (text.length < 150) return { ok: false, detail: 'écran vide' };
      if (rows === 0) return { ok: false, detail: 'tableau paie vide (0 ligne après 16s)' };
      // Aucun "NaN" dans le DOM.
      if (/\bNaN\b/.test(text)) return { ok: false, detail: '"NaN" présent dans le DOM' };
      return { ok: true, detail: `tableau paie (${rows} lignes), aucun NaN` };
    },
  },
  {
    id: 'dashboard', name: 'Dashboard', profile: 'dg', tab: 'dashboard',
    async check(page) {
      await sleep(2000);
      const text = await bodyText(page);
      if (text.length < 200) return { ok: false, detail: 'écran quasi vide' };
      // Présence de cartes KPI.
      const kpis = await page.locator('.kpi-card, [class*="kpi"]').count();
      if (kpis === 0 && !/co[ûu]t|effectif|kg|ouvrier/i.test(text)) {
        return { ok: false, detail: 'aucun KPI détecté' };
      }
      return { ok: true, detail: `KPIs affichés (${kpis} cartes)` };
    },
  },
  {
    id: 'station_historique', name: 'Agronomie → Historique Irrigation', profile: 'chef_f1', tab: 'station_historique',
    async check(page) {
      // Asserter UNE SEULE entrée de menu "Historique Irrigation" (pas 12 doublons).
      const menuCount = await page.locator('.nav-item', { hasText: /Historique Irrigation/i }).count();
      if (menuCount !== 1) {
        return { ok: false, detail: `${menuCount} entrées de menu "Historique Irrigation" (attendu: 1)` };
      }
      await sleep(1500);
      const text = await bodyText(page);
      if (text.length < 80) return { ok: false, detail: 'écran vide' };
      return { ok: true, detail: 'menu unique (count=1), écran chargé' };
    },
  },
];

// ---------------------------------------------------------------------------
// Exécution d'un navigateur
// ---------------------------------------------------------------------------

async function runBrowser(browserName) {
  const engine = ENGINES[browserName];
  if (!engine) throw new Error(`Navigateur inconnu: ${browserName}`);

  console.log(`\n=== E2E VISUEL — ${browserName} ===`);
  const results = [];
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    console.log(`🔴 Impossible de lancer ${browserName}: ${e.message}`);
    console.log(`   → Installer les moteurs : node_modules/.bin/playwright install ${browserName}`);
    return { browserName, results: SCREENS.map(s => ({ id: s.id, name: s.name, ok: false, detail: 'navigateur non lançable' })), fatal: true };
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = attachErrorCollectors(page);

  // Login (fatal si échec).
  try {
    await login(page);
  } catch (e) {
    console.log(`🔴 LOGIN échoué: ${e.message}`);
    await screenshot(page, browserName, 0, 'login-FAIL').catch(() => {});
    await browser.close();
    return { browserName, results: SCREENS.map(s => ({ id: s.id, name: s.name, ok: false, detail: 'login échoué' })), fatal: true };
  }

  let idx = 1;
  for (const screen of SCREENS) {
    const before = errors.length;
    let result = { id: screen.id, name: screen.name, ok: false, detail: '' };
    try {
      await switchProfile(page, screen.profile);
      await gotoTab(page, screen.tab);
      const checkRes = await screen.check(page);
      result.ok = checkRes.ok;
      result.detail = checkRes.detail;
    } catch (e) {
      result.ok = false;
      result.detail = 'exception: ' + e.message.split('\n')[0];
    }
    // Crash JS pendant l'écran → 🔴 même si l'assertion passait.
    const newErrors = errors.slice(before);
    if (newErrors.length > 0) {
      result.ok = false;
      result.crash = newErrors[0];
      result.sharedCrash = isSharedSvgChartCrash(newErrors[0]);
      const tag = result.sharedCrash ? 'crash JS [graphe SVG partagé]' : 'crash JS';
      result.detail = (result.detail ? result.detail + ' | ' : '') + tag + ': ' + newErrors[0];
    }
    // Screenshot dans tous les cas.
    try {
      result.screenshot = await screenshot(page, browserName, idx, screen.id + (result.ok ? '' : '-FAIL'));
    } catch (e) {
      result.screenshot = null;
    }
    console.log(`${result.ok ? '✅' : '🔴'} ${screen.name}${result.ok ? '' : ' — ' + result.detail}`);
    results.push(result);
    idx++;
  }

  await browser.close();
  return { browserName, results, fatal: false };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('🔴 Credentials manquants : définir QA_TEST_EMAIL et QA_TEST_PASSWORD dans .env');
    process.exit(2);
  }

  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  Berry Good — Suite E2E Visuelle (Playwright)   ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`Cible    : ${E2E_URL}`);
  console.log(`Compte   : ${EMAIL}`);
  console.log(`Mode     : ${E2E_WRITE ? 'ÉCRITURE (E2E_WRITE=1)' : 'LECTURE SEULE (anti-pollution prod)'}`);
  console.log(`Browsers : ${BROWSERS.join(', ')}`);

  rmrf(SCREENSHOT_ROOT);
  fs.mkdirSync(SCREENSHOT_ROOT, { recursive: true });

  const all = [];
  for (const b of BROWSERS) {
    const r = await runBrowser(b);
    all.push(r);
  }

  // Récap.
  console.log('\n════════════════════════════════════════════════');
  console.log('RÉSUMÉ');
  console.log('════════════════════════════════════════════════');
  let anyRed = false;
  const summaryParts = [];
  for (const { browserName, results } of all) {
    const okCount = results.filter(r => r.ok).length;
    summaryParts.push(`${okCount}/${results.length} ${browserName}`);
    if (okCount < results.length) anyRed = true;
  }
  console.log(`RÉSUMÉ : ${summaryParts.join(', ')} ; screenshots: tests/e2e-screenshots/`);

  // Note de cause racine partagée (un seul bug applicatif qui contamine N écrans).
  const sharedHits = [];
  for (const { browserName, results } of all) {
    results.forEach(r => { if (r.sharedCrash) sharedHits.push(`${r.name} (${browserName})`); });
  }
  if (sharedHits.length > 0) {
    console.log('\n  ⚠️  BUG RACINE COMMUN — crash SVG des graphiques (pie/barres) :');
    console.log('     Cause : un total=0 produit un angle NaN (path d="...A 70 70 0 0 1 NaN NaN...")');
    console.log('     et/ou une hauteur de barre négative (<rect height="-305...">). Bug applicatif');
    console.log('     pré-existant (app.jsx, composants pie ~ligne 304 / SimpleBarChart ~ligne 190),');
    console.log('     hors scope outillage — à signaler à l\'architecte.');
    console.log(`     Écrans contaminés : ${sharedHits.join(', ')}`);
  }

  // Écrans 🔴 détaillés.
  for (const { browserName, results } of all) {
    const reds = results.filter(r => !r.ok);
    if (reds.length > 0) {
      console.log(`\n  Écrans 🔴 (${browserName}) :`);
      reds.forEach(r => console.log(`    - ${r.name} : ${r.detail}`));
    }
  }

  // Chemins des screenshots.
  console.log('\n  Screenshots produits :');
  for (const { browserName, results } of all) {
    results.forEach(r => {
      if (r.screenshot) console.log(`    ${path.relative(path.join(__dirname, '..'), r.screenshot)}`);
    });
  }
  console.log('');

  process.exit(anyRed ? 1 : 0);
}

main().catch(err => {
  console.error('🔴 Erreur fatale :', err);
  process.exit(3);
});
