/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: rh | Déclaration(s): PointageValidationViewWrapper */


// Adaptateur app-scope → composant séparé PointageValidationView.
        // Le menu « Validation du pointage » rend ceci (nouveau workflow), plus
        // PointageTab(isValidation) directement.
import { PointageValidationView } from './PointageValidationView.jsx';

        function PointageValidationViewWrapper(props) {
            const View = PointageValidationView;
            if (!View) {
                return <div style={{padding:24,color:'var(--red)'}}>Module Validation du pointage indisponible.</div>;
            }
            return <View {...props} />;
        }

export { PointageValidationViewWrapper };
