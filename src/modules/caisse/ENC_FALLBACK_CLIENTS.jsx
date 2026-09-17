/* Module: caisse | Déclaration(s): ENC_FALLBACK_CLIENTS */


// ---- Import Encaissements (canevas marché local) — DRY-RUN (sous-lot 4.2) ----
        // UI fine uniquement : toute la logique métier (parse, contrôles, modèle)
        // vit dans EncaissementsCanevas (shared/lib/encaissementsCanevas.js).
        // GARDE-FOU : AUCUN write Firestore, AUCUN bouton « Appliquer ». Le chemin
        // d'écriture est le sous-lot 4.3.
import * as EncaissementsCanevas from '../shared/lib/encaissementsCanevas.js';

        const ENC_FALLBACK_CLIENTS = [
            'MUSTAPHA CHAFIK A', 'Mr MONAIM LOCAL', 'IRAQI MOHAMED',
            'Hamdouch Omar', 'Fruit congel du nord',
        ];

export { ENC_FALLBACK_CLIENTS };
