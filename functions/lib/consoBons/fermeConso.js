'use strict';
// @ts-check

/**
 * fermeConso.js — RÈGLE UNIQUE de dérivation parcelle → ferme pour les DEUX
 * écrans de consommation (Campagne › Engrais/Pesticides et Agronomie ›
 * Engrais & Pesticides).
 *
 * ── POURQUOI CE MODULE ─────────────────────────────────────────────────────
 * Les deux écrans jumeaux utilisaient deux dérivations DIFFÉRENTES, et chacune
 * échouait sur une famille de libellés distincte — mesuré sur les 19 libellés
 * réellement présents dans `consumption_vouchers` (prod, 2026-08-26) :
 *
 *   libellé                  deriveFermeFromParcelle   resolveFermeFromParcelle
 *   ------------------------ ------------------------- ------------------------
 *   F2 - HAAS                Avocatier                 INCONNU   ← écran vide
 *   F3 -HAAS                 Avocatier                 INCONNU   ← pour chef_avo
 *   F4 -HAAS                 Avocatier                 INCONNU
 *   BREEZE MYRTILLE S8-2     null      ← écran vide    F5
 *   CASCADE MYRTILLE S8-1    null      ← pour chef_f5  F5
 *   AVOCAT F5                Avocatier                 F5        ← divergence
 *
 * Conséquences mesurées AVANT correction : `chef_avo` voyait 0 parcelle sur
 * l'écran Campagne alors que ses 20,5 ha avaient consommé 60 lignes, et
 * `chef_f5` perdait ses 2 parcelles S8 (40 lignes) sur l'écran Agronomie. Pas
 * de fuite — les deux échouaient du bon côté — mais un chef devant un tableau
 * vide sans explication le signale comme un bug.
 *
 * ── LA RÈGLE ───────────────────────────────────────────────────────────────
 * COMPOSITION des deux règles existantes, dans cet ordre. On n'en réécrit
 * aucune : `resolveFermeFromParcelle` est explicitement FIGÉE pour l'isomorphie
 * avec le pointage/paie (cf. son en-tête, §7 du spec), et
 * `deriveFermeFromParcelle` est la barrière de sécurité de `conso-valorisee`.
 *
 *   1. `deriveFermeFromParcelle(label)` — convention de la VALORISATION :
 *      HAAS/AVOCAT prime sur tout token Fx, puis BAHIA, puis token F1..F6.
 *      Résout les avocatiers `F2/F3/F4 - HAAS`.
 *   2. Si (1) ne tranche pas (null), repli sur `resolveFermeFromParcelle`, dont
 *      la règle de SECTEUR (S1-S7 → F1, S8-S14 → F5) rattrape les libellés de
 *      myrtille sans token de ferme (`BREEZE MYRTILLE S8-2`).
 *   3. Sinon → `null`, FAIL-CLOSED : jamais rattaché au périmètre d'un chef.
 *
 * ── ARBITRAGE `AVOCAT F5` ──────────────────────────────────────────────────
 * Les deux règles divergeaient : Avocatier pour l'une, F5 pour l'autre. On
 * retient **Avocatier** (étape 1), pour trois raisons :
 *  - c'est déjà le comportement de `conso-valorisee` aujourd'hui : ne rien
 *    changer là où ça marche ;
 *  - `chef_f5` est cloisonné sur la culture Myrtille (CHEF_PROFILE_CULTURE), une
 *    parcelle d'avocatier ne lui serait de toute façon jamais montrée ;
 *  - `chef_avo` est le responsable métier de l'avocatier, quelle que soit la
 *    ferme physique qui l'héberge.
 * Le §8.2 de `refParcelleFerme.js` tranche l'inverse (F5), mais UNIQUEMENT pour
 * préserver l'isomorphie du POINTAGE/PAIE — un périmètre qui n'est pas le nôtre.
 * Cette divergence est donc volontaire et locale aux écrans de consommation.
 *
 * Sur les 19 libellés réels, cette règle résout les 19. `resolveFermeInconnue`
 * reste néanmoins exposé pour que l'appelant COMPTE et REMONTE les libellés non
 * résolus plutôt que de rendre un tableau vide silencieux.
 */

const { deriveFermeFromParcelle } = require('../valorisation/fermeParcelle');
const { resolveFermeFromParcelle } = require('../pointage/refParcelleFerme');

/**
 * Ferme d'une parcelle pour les écrans de consommation.
 *
 * @param {*} label libellé de parcelle (`Parcelle_Culturale`).
 * @returns {('F1'|'F2'|'F3'|'F4'|'F5'|'F6'|'Avocatier'|'BAHIA'|null)} null si
 *   indéterminable (fail-closed).
 */
function fermeDeParcelle(label) {
  const direct = deriveFermeFromParcelle(label);
  if (direct) return direct;

  // Repli SECTEUR (S1-S7 → F1, S8-S14 → F5). `refParcelle`/`variete` ne sont pas
  // disponibles ici : les bons ne portent que le libellé.
  const { ferme } = resolveFermeFromParcelle({ label: label });
  if (ferme && ferme !== 'INCONNU') return /** @type {any} */ (ferme);

  return null;
}

/**
 * Libellés de parcelle dont la ferme est indéterminable, dédoublonnés et triés.
 * Destiné à être remonté DANS LE PAYLOAD : un chef ne doit pas se retrouver
 * devant un écran vide sans explication.
 *
 * @param {Array<*>} labels libellés à tester.
 * @returns {Array<string>}
 */
function resolveFermeInconnue(labels) {
  const list = Array.isArray(labels) ? labels : [];
  const seen = {};
  for (const l of list) {
    const s = l == null ? '' : String(l).trim();
    if (!s) continue;
    if (fermeDeParcelle(s)) continue;
    seen[s] = true;
  }
  return Object.keys(seen).sort();
}

module.exports = {
  fermeDeParcelle,
  resolveFermeInconnue,
};
