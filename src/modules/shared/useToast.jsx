/* Module: shared | Déclaration(s): useToast */
import { ToastContext } from './ToastContext.jsx';

function useToast() { return React.useContext(ToastContext); }

export { useToast };
