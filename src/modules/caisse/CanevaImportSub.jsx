/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CanevaImportSub */
import { CanevaFinanceQueue } from './CanevaFinanceQueue.jsx';
import { CanevaUploadCard } from './CanevaUploadCard.jsx';

// Aiguillage de l'onglet Import canevas selon le rôle.
        function CanevaImportSub({ currentProfile, profileData, onDone }) {
            if (currentProfile === 'finance' || currentProfile === 'dg') {
                return <CanevaFinanceQueue currentProfile={currentProfile} profileData={profileData} onDone={onDone} />;
            }
            return <CanevaUploadCard currentProfile={currentProfile} profileData={profileData} onDone={onDone} />;
        }

export { CanevaImportSub };
