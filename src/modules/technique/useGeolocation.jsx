/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: technique | Déclaration(s): useGeolocation */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== FINANCE TABS =====================
        // ===================== SECURITE BSNL =====================
        function useGeolocation() {
            const [geo, setGeo] = useState(null);
            useEffect(() => {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition(
                    pos => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
                    () => {},
                    { enableHighAccuracy: true, timeout: 10000 }
                );
            }, []);
            const refresh = () => {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition(
                    pos => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
                    () => {},
                    { enableHighAccuracy: true, timeout: 10000 }
                );
            };
            return [geo, refresh];
        }

export { useGeolocation };
