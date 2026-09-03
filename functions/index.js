/* functions/index.js — BARREL de re-export. Aucune logique métier ici.
 *
 * Une Cloud Function est adressée PAR SON NOM D'EXPORT : le renommer supprime
 * l'ancienne fonction et en crée une neuve — URL HTTP changée, déclencheur
 * Firestore détaché, cron perdu, clients en vol cassés. Les 105 noms exposés
 * ici sont donc FIGÉS.
 *
 * Chaque module n'exporte que ses propres Cloud Functions : leur union est
 * exactement la surface d'origine. Elle est verrouillée par diff dans
 * tests/unit/backendExportSurface.test.js — toute addition, suppression ou
 * renommage y échoue.
 */
'use strict';

for (const mod of [
  require("./src/modules/admin/admin"),
  require("./src/modules/agronomie/agronomie"),
  require("./src/modules/caisse/caisse"),
  require("./src/modules/finance/finance"),
  require("./src/modules/magasin/magasin"),
  require("./src/modules/magasin/magasin.stock"),
  require("./src/modules/recolte/recolte.forecast"),
  require("./src/modules/recolte/recolte.production"),
  require("./src/modules/rh/rh.paie"),
  require("./src/modules/rh/rh.pointage"),
  require("./src/modules/securite/securite"),
  require("./src/modules/technique/technique"),
  // Agrégation historique du service e-mail : 14 fonctions (analyzeEmail,
  // fetchEmails, parseLiquidation*, parseTimacInvoice*…). Était en ligne dans
  // le monolithe ; sa place est ici, au point d'entrée.
  require("./emailService"),
]) {
  Object.assign(exports, mod);
}
