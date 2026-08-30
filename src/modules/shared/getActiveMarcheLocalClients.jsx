/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): getActiveMarcheLocalClients */


// Helper unique : clients marché local ACTIFS (exclut les archivés).
        // Filtre archived CÔTÉ CODE (`archived !== true`) — surtout PAS de
        // where('archived','!=',true) qui exclurait les docs sans champ archived.
        // Source de vérité du référentiel = seed backend tracké
        // functions/scripts/seedComptesClientsMarcheLocal.js (5 clients actifs).
        async function getActiveMarcheLocalClients(db) {
            const snap = await db.collection('clients_marche_local').get();
            const all = snap.docs.map(d => d.data()).filter(Boolean);
            const active = all.filter(d => d.archived !== true);
            // Un nom canonique a souvent 2 docs : 1 actif + 1 archivé (doublon
            // historique). Un nom présent parmi les actifs n'est JAMAIS "archivé",
            // sinon on retirerait à tort le client de la liste (régression 2b :
            // dropdown vide). archivedNames = noms archivés SANS aucun doc actif
            // correspondant (ex. IMAD/AMIN, archivés et sans actif).
            const activeNames = new Set(active.map(d => d.nom).filter(Boolean));
            const archivedNames = new Set(
                all.filter(d => d.archived === true).map(d => d.nom).filter(Boolean)
                   .filter(n => !activeNames.has(n))
            );
            return { active, archivedNames };
        }

export { getActiveMarcheLocalClients };
