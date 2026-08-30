/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: rh | Déclaration(s): PointageValidationViewWrapper */


// Adaptateur app-scope → composant séparé window.PointageValidationView.
        // Le menu « Validation du pointage » rend ceci (nouveau workflow), plus
        // PointageTab(isValidation) directement.
        function PointageValidationViewWrapper(props) {
            const View = window.PointageValidationView;
            if (!View) {
                return <div style={{padding:24,color:'var(--red)'}}>Module Validation du pointage indisponible.</div>;
            }
            return <View {...props} />;
        }

export { PointageValidationViewWrapper };
