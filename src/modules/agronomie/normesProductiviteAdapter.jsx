/* Chantier production readiness — docs/DATA_SOURCES.md.
   Adapte la réponse réelle de /api/hors-recolte-suivi?action=get-normes
   (functions/src/modules/recolte/recolte.production.js, action get-normes)
   vers la forme que les écrans attendent depuis generateMockData (avant ce
   chantier). Pure, testable sans React : voir
   tests/unit/normesProductiviteAdapter.test.js.

   Pourquoi un adapter plutôt qu'un branchement direct : l'API réelle nomme
   le champ `normeParJourParOuvrier` (et ne porte pas `unite` par défaut côté
   fallback hardcoded systématiquement rempli) alors que les 4 écrans
   consommateurs (ParametresTab, PlanificationTab, CaporalSaisieTab,
   DashboardTab) lisent tous `normeTunnelsParJourParOuvrier` — renommer les
   champs de l'API pour matcher le front violerait la consigne « ne pas
   renommer les champs Firestore » ; l'inverse (renommer 4 écrans) est un
   changement de surface plus risqué pour un simple alias. On adapte ici,
   une fois, à la frontière. */

/**
 * @param {{success?:boolean, normes?:Array<{tache?:string, ferme?:string, normeParJourParOuvrier?:number, unite?:string, id?:string}>, source?:'firestore'|'hardcoded'}|null|undefined} apiResponse
 * @returns {{normesProductivite: Array<{tache:string, ferme?:string, normeTunnelsParJourParOuvrier:number, unite:string, id?:string}>, source: 'firestore'|'hardcoded'|null}}
 */
function adaptNormesProductivite(apiResponse) {
    if (!apiResponse || apiResponse.success !== true || !Array.isArray(apiResponse.normes)) {
        // Pas de donnée : état vide, jamais un repli fabriqué côté front.
        return { normesProductivite: [], source: null };
    }
    const normesProductivite = apiResponse.normes.map((n) => ({
        tache: n.tache || '',
        ...(n.ferme ? { ferme: n.ferme } : {}),
        normeTunnelsParJourParOuvrier: Number(n.normeParJourParOuvrier) || 0,
        unite: n.unite || 'tunnels/jour/ouvrier',
        ...(n.id ? { id: n.id } : {}),
    }));
    const source = apiResponse.source === 'hardcoded' ? 'hardcoded' : 'firestore';
    return { normesProductivite, source };
}

export { adaptNormesProductivite };
