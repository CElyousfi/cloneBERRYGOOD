/* Référentiel parcelles Smart Berry — état partagé entre écrans.
 *
 * Anciennement deux globales du navigateur (window.SB_PARCELLE_REF,
 * window.SB_PARCELLE_CAMPAGNE). Même cycle de vie : `undefined` tant que rien
 * n'a chargé, rempli par sbLoad() au démarrage, réécrit après chaque
 * sauvegarde (Parcelles & Référentiel, Campagne, Bons de consommation).
 *
 *   REF      : { 'LABEL BEE ONE UPPERCASE' : { nom_sb, ha, … } } — valeurs saisies
 *   CAMPAGNE : { 'LABEL BEE ONE UPPERCASE' : sup (number) }      — r.sup depuis campagne-list
 */
const sbParcelle = { REF: undefined, CAMPAGNE: undefined };

export { sbParcelle };
