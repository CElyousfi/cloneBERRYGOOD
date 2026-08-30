/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): NewVersionToast */
import { useEffect, useState } from './reactHooks.jsx';

// CORRECTIF (b) — toast "nouvelle version" non bloquant. La page ne se
        // recharge QUE sur clic utilisateur (plus de window.location.reload auto).
        // Écoute l'évènement 'app-version-changed' émis par checkVersion, et gère
        // aussi le cas où la version a changé AVANT le montage (window.__newAppVersion).
        function NewVersionToast() {
            const [show, setShow] = useState(false);
            useEffect(() => {
                if (window.__newAppVersion) setShow(true);
                const onChange = () => setShow(true);
                window.addEventListener('app-version-changed', onChange);
                return () => window.removeEventListener('app-version-changed', onChange);
            }, []);
            if (!show) return null;
            return (
                <div
                    onClick={() => window.location.reload()}
                    role="button"
                    style={{position:'fixed',bottom:20,right:20,zIndex:99999,background:'var(--berry, #8B2252)',color:'#fff',padding:'12px 18px',borderRadius:12,fontSize:13,fontWeight:600,cursor:'pointer',boxShadow:'0 4px 20px rgba(0,0,0,0.25)',display:'flex',alignItems:'center',gap:10,maxWidth:320}}>
                    <i className="fa-solid fa-arrows-rotate"></i>
                    <span>Nouvelle version disponible — cliquez pour recharger</span>
                </div>
            );
        }

export { NewVersionToast };
