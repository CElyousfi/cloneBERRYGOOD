/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): caisseFileToB64 */


// ---- Import Excel Sub (Achats/DG/Finance) ----
        // Réécrit : prévisualisation (dry-run) avant écriture, glisser-déposer multi-fichiers,
        // barre de progression, rapport détaillé par feuille. Le parsing reste 100% backend.

        function caisseFileToB64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }

export { caisseFileToB64 };
