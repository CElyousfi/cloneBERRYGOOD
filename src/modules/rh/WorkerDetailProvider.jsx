/* Module: rh | Déclaration(s): WorkerDetailProvider */
import { useState } from '../shared/reactHooks.jsx';
import { WorkerDetailContext } from './WorkerDetailContext.jsx';
import { WorkerDetailModal } from './WorkerDetailModal.jsx';

function WorkerDetailProvider({ children }) {
            const [workerPopup, setWorkerPopup] = useState(null);
            const [workerLoading, setWorkerLoading] = useState(false);

            const openWorkerDetail = (matricule) => {
                setWorkerLoading(true);
                fetch(`/api/pointage-rh?action=worker-detail&matricule=${encodeURIComponent(matricule)}`)
                    .then(r => r.json())
                    .then(json => { if (json.success && json.worker) setWorkerPopup(json.worker); })
                    .catch(err => console.warn(err))
                    .finally(() => setWorkerLoading(false));
            };

            return (
                <WorkerDetailContext.Provider value={{ open: openWorkerDetail }}>
                    {children}
                    <WorkerDetailModal workerPopup={workerPopup} setWorkerPopup={setWorkerPopup} workerLoading={workerLoading} />
                </WorkerDetailContext.Provider>
            );
        }

export { WorkerDetailProvider };
