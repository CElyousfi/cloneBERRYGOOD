/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): APP_VERSION */


// Version de l'app. CORRECTIF (b) "soft checkVersion" :
        // on ne recharge PLUS la page automatiquement quand app-version.txt change
        // (le reload brutal faisait clignoter le login + perdait l'état, source de
        // fausses "déconnexions"). À la place on signale une nouvelle version via un
        // CustomEvent que <NewVersionToast> écoute → reload UNIQUEMENT sur clic
        // utilisateur. La comparaison de version est la fonction pure testable
        // AuthResilience.isNewAppVersion (public/lib/authResilience.js).
        const APP_VERSION = '20260415b';

export { APP_VERSION };
