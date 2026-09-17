/* Module: technique | Déclaration(s): meteoFermes */


// ===================== METEOBLUE API CONFIG =====================
        // Les appels Meteoblue passent par /api/meteoblue (Cloud Function
        // + cache Firestore partagé 4h) au lieu de my.meteoblue.com
        // directement — évite l'exposition de la clé API côté client et
        // regroupe N onglets/utilisateurs sur un seul appel réel par
        // fenêtre de 4h (window.fetch injecte déjà le Bearer token
        // Firebase sur toute URL /api/*, cf. patch plus haut).
        const meteoFermes = {
            F1: { nom: 'Framboise Larache (F1)', lat: 35.08, lon: -6.14, altitude: 49, region: 'Larache' },
            F2: { nom: 'Avocat F2', lat: 35.08, lon: -6.14, altitude: 49, region: 'Larache' },
            F3: { nom: 'Avocat F3', lat: 35.08, lon: -6.14, altitude: 49, region: 'Larache' },
            F4: { nom: 'Avocat F4', lat: 35.08, lon: -6.14, altitude: 49, region: 'Larache' },
            F5: { nom: 'Myrtille/Framboise Laaouamra (F5)', lat: 35.08, lon: -6.14, altitude: 49, region: 'Laaouamra' },
            F6: { nom: 'Avocat F6', lat: 34.3425, lon: -6.5503, altitude: 120, region: 'Ain Atiq' },
            BAHIA: { nom: 'Avocat BAHIA', lat: 35.08, lon: -6.14, altitude: 49, region: 'Larache' },
            Avocatier: { nom: 'Ferme Avocatier', lat: 35.08, lon: -6.14, altitude: 49, region: 'Larache' }
        };

export { meteoFermes };
