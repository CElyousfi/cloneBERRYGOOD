/* Instructions à effet de bord du monolithe — ordre d'origine strictement préservé. */
// EN PREMIER : le contournement local (?testui=1) patche window.fetch et
// firebaseAuth avant que _origFetch ne capture fetch et que l'app ne lise l'auth.
import './shared/lib/localTestBypass.js';
import './shared/legacyGlobals.js';
import { DESIGNATION_MAP } from './agronomie/DESIGNATION_MAP.jsx';
import { PARCELLES_CULTURALES } from './agronomie/PARCELLES_CULTURALES.jsx';
import { sbParcelleHa } from './agronomie/sbParcelleHa.jsx';
import { sbParcelleNom } from './agronomie/sbParcelleNom.jsx';
import { BUDGET_BGF } from './finance/BUDGET_BGF.jsx';
import { WorkerDetailProvider } from './rh/WorkerDetailProvider.jsx';
import { APP_VERSION } from './shared/APP_VERSION.jsx';
import { App } from './shared/App.jsx';
import { ErrorBoundary } from './shared/ErrorBoundary.jsx';
import { ToastProvider } from './shared/ToastProvider.jsx';
import { _origFetch } from './shared/_origFetch.jsx';
import { deriveSubFerme } from './shared/deriveSubFerme.jsx';
import { remapLegacyTab } from './shared/remapLegacyTab.jsx';
import { sbLoad } from './shared/sbLoad.jsx';

import * as AuthResilience from './shared/lib/authResilience.js';
window.__APP_VERSION = APP_VERSION;

(async function checkVersion() {
            // Garde : si authResilience.js n'a pas chargé (improbable, il est non-defer),
            // on s'abstient plutôt que de recharger en boucle.
            var AR = AuthResilience;
            try {
                const resp = await fetch('/app-version.txt?t=' + Date.now(), { cache: 'no-store' });
                if (resp.ok) {
                    const serverVersion = (await resp.text()).trim();
                    const isNew = AR
                        ? AR.isNewAppVersion(APP_VERSION, serverVersion)
                        : (!!serverVersion && serverVersion !== APP_VERSION);
                    if (isNew) {
                        console.log('New version detected:', serverVersion, '!= ', APP_VERSION, '— soft toast, no auto-reload');
                        // NE PAS recharger automatiquement. Signaler la nouvelle version
                        // EN PREMIER (avant le SW update, qui peut rejeter/traîner selon
                        // le navigateur) pour que <NewVersionToast> s'affiche de façon fiable.
                        window.__newAppVersion = serverVersion;
                        try { window.dispatchEvent(new CustomEvent('app-version-changed', { detail: { version: serverVersion } })); } catch(e) {}
                        // Mettre à jour le SW sans le désinstaller (nécessaire pour Share Target).
                        // Best-effort, n'empêche jamais l'affichage du toast.
                        try {
                            if ('serviceWorker' in navigator) {
                                const regs = await navigator.serviceWorker.getRegistrations();
                                for (const r of regs) { try { await r.update(); } catch(e) {} }
                            }
                        } catch(e) {}
                        return;
                    }
                }
            } catch(e) {}
        })();

window.fetch = async function(url, opts) {
            if (typeof url === 'string' && url.startsWith('/api/')) {
                opts = opts || {};
                opts.headers = opts.headers || {};
                try {
                    if (firebaseAuth && firebaseAuth.currentUser) {
                        const token = await firebaseAuth.currentUser.getIdToken();
                        opts.headers['Authorization'] = 'Bearer ' + token;
                    }
                } catch(e) {}
            }
            return _origFetch.call(this, url, opts);
        };

// Consommé par public/components/AffectationAnalytiqueTable.jsx (hors scope d'app.jsx).
        window.deriveSubFerme = deriveSubFerme;

sbLoad();

// Consommé par public/components/AffectationAnalytiqueTable.jsx (hors scope d'app.jsx).
        window.sbParcelleHa = sbParcelleHa;

// Consommé par public/components/CampagneAnalytiqueTab.jsx (hors scope d'app.jsx).
        window.sbParcelleNom = sbParcelleNom;

// Load budget from static JSON (shared across all devices)
        fetch('/budget_bgf.json?t=' + Date.now())
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data) {
                    Object.assign(BUDGET_BGF, data);
                    // Also store in localStorage for backward compat
                    try { localStorage.setItem('budgetBGFConfig', JSON.stringify(data)); } catch(e) {}
                }
            })
            .catch(() => {
                // Fallback: try localStorage
                try {
                    const stored = localStorage.getItem('budgetBGFConfig');
                    if (stored) Object.assign(BUDGET_BGF, JSON.parse(stored));
                } catch(e) {}
            });

// Consommé par public/components/AffectationAnalytiqueTable.jsx (hors scope d'app.jsx).
        // ⚠️ Sans cette exposition, le composant extrait retomberait silencieusement sur
        // `[]` (le `typeof X !== 'undefined'` d'origine ne lève pas) → tous les Ha à 0.
        window.PARCELLES_CULTURALES = PARCELLES_CULTURALES;

PARCELLES_CULTURALES.forEach(pc => {
            const entry = { variete: pc.variete, sousVariete: pc.sousVariete, ferme: pc.ferme, culture: pc.culture };
            (pc.designations || []).forEach(d => {
                DESIGNATION_MAP[d] = entry;
                DESIGNATION_MAP[d.toUpperCase()] = entry;
            });
        });

// Noms liquidation/expédition (variété seule → variete+ferme)
        Object.assign(DESIGNATION_MAP, {
            'Maravilla':  { variete: 'Maravilla', sousVariete: null, ferme: 'F1', culture: 'Framboise' },
            'Maravilla GC': { variete: 'Maravilla', sousVariete: 'Green Cane', ferme: 'F1', culture: 'Framboise' },
            'Yazmin Sol': { variete: 'Yazmin',    sousVariete: null, ferme: 'F5', culture: 'Framboise' },
            'Yazmin':     { variete: 'Yazmin',    sousVariete: null, ferme: 'F5', culture: 'Framboise' },
            'Reyna':      { variete: 'Reyna',     sousVariete: null, ferme: 'F5', culture: 'Framboise' },
            'Corrina':    { variete: 'Corina',    sousVariete: null, ferme: 'F5', culture: 'Myrtille' },
            'Corina':     { variete: 'Corina',    sousVariete: null, ferme: 'F5', culture: 'Myrtille' },
            'Adelita':    { variete: 'Adelita',   sousVariete: null, ferme: 'F5', culture: 'Framboise' },
            'Breeze':     { variete: 'Breeze',    sousVariete: null, ferme: 'F5', culture: 'Myrtille' },
            'Cascade':    { variete: 'Cascade',   sousVariete: null, ferme: 'F5', culture: 'Myrtille' },
        });

// ===================== MAIN APP =====================
        var __savedProfile = 'rh';

try { __savedProfile = localStorage.getItem('lastProfile') || 'rh'; } catch(e) {}

var __savedTab = 'dashboard';

try {
            __savedTab = localStorage.getItem('lastTab') || 'dashboard';
            var __remapped = remapLegacyTab(__savedTab);
            if (__remapped !== __savedTab) {
                __savedTab = __remapped;
                // Écrase la valeur persistée pour ne pas re-déclencher au reload.
                try { localStorage.setItem('lastTab', __savedTab); } catch(e) {}
            }
        } catch(e) {}

ReactDOM.render(<ErrorBoundary><ToastProvider><WorkerDetailProvider><App /></WorkerDetailProvider></ToastProvider></ErrorBoundary>, document.getElementById('root'));

export { __savedProfile, __savedTab };
