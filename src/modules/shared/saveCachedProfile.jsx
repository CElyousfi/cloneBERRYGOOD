/* Module: shared | Déclaration(s): saveCachedProfile */
import { CACHED_PROFILE_KEY } from './CACHED_PROFILE_KEY.jsx';

function saveCachedProfile(profile, uid) {
            try {
                if (profile && typeof profile === 'object') {
                    localStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile));
                }
            } catch (e) {}
        }

export { saveCachedProfile };
