/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): sbLoad */


// ===== RÉFÉRENTIEL PARCELLES SMART BERRY =====
        // window.SB_PARCELLE_REF = { 'LABEL BEE ONE UPPERCASE' : { nom_sb, ha, ... } } — valeurs user-saved
        // window.SB_PARCELLE_CAMPAGNE = { 'LABEL BEE ONE UPPERCASE' : sup (number) } — r.sup depuis campagne-list
        // Chargé une fois au démarrage. Mis à jour après chaque save. Voir aussi loadData() dans QuinzaineTab.
        function sbLoad() {
            fetch('/api/pointage-rh?action=sb-referentiel-list')
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    if (!d.success) return;
                    window.SB_PARCELLE_REF = {};
                    (d.parcelles || []).forEach(function(p) {
                        window.SB_PARCELLE_REF[(p.label_bee_one || p.id || '').toUpperCase().trim()] = p;
                    });
                })
                .catch(function() {});
        }

export { sbLoad };
