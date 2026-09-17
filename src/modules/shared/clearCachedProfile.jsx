/* Module: shared | Déclaration(s): clearCachedProfile */
import { CACHED_PROFILE_KEY } from './CACHED_PROFILE_KEY.jsx';

function clearCachedProfile() {
            try { localStorage.removeItem(CACHED_PROFILE_KEY); } catch (e) {}
        }

export { clearCachedProfile };
