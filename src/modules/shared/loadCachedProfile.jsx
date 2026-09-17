/* Module: shared | Déclaration(s): loadCachedProfile */
import { CACHED_PROFILE_KEY } from './CACHED_PROFILE_KEY.jsx';

function loadCachedProfile() {
            try {
                const raw = localStorage.getItem(CACHED_PROFILE_KEY);
                if (!raw) return null;
                const obj = JSON.parse(raw);
                return (obj && typeof obj === 'object' && obj.uid) ? obj : null;
            } catch (e) { return null; }
        }

export { loadCachedProfile };
