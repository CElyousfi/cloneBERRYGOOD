/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): useToast */
import { ToastContext } from './ToastContext.jsx';

function useToast() { return React.useContext(ToastContext); }

export { useToast };
