/**
 * globals.d.ts — surface globale du frontend, pour `npm run typecheck`.
 *
 * Les modules de `public/lib/` sont chargés par balise <script> et se publient
 * eux-mêmes sur `window` (`window.CaisseUtils = { … }`), puis se consomment
 * entre eux par ce même objet. Rien ne le déclare à TypeScript, d'où un
 * "Property 'CaisseUtils' does not exist on type 'Window'" à chaque usage.
 *
 * Ces namespaces sont typés `any` À DESSEIN : ce sont des sacs de fonctions
 * assemblés à l'exécution, dont la forme réelle vit dans le fichier qui les
 * publie (et dans son JSDoc). Les typer ici en dur créerait une seconde source
 * de vérité qui divergerait au premier ajout de fonction. Le but de ce fichier
 * est de faire disparaître un faux positif structurel, pas de re-décrire l'app.
 *
 * `index.html` est la liste qui fait foi des scripts chargés.
 */

interface Window {
  /* Librairies tierces chargées par CDN (cf. index.html). */
  React: any;
  XLSX: any;

  /* Namespaces publiés par public/lib/*.js */
  AnalytiqueUtils: any;
  ArticleSelect: any;
  AuthResilience: any;
  BcScanMatch: any;
  BdcReceptionUtils: any;
  BdcWorkflow: any;
  CaisseUtils: any;
  CampagneBudgetPivot: any;
  CampagneBudgetQuinzaine: any;
  CampagneExportUtils: any;
  CampagneParcelleQuinzaine: any;
  CampagneProduction: any;
  CampagneRapprochement: any;
  CampagneRythme: any;
  CampagneUtils: any;
  CoutMainOeuvre: any;
  CultureUtils: any;
  EncaissementsCanevas: any;
  FactureExportUtils: any;
  FeatureFlags: any;
  GrowthUtils: any;
  ImageDownscale: any;
  InflightDedup: any;
  InventaireUtils: any;
  LecturePaieExcel: any;
  MeteoCalc: any;
  PaieDataCache: any;
  PaieUtils: any;
  ParcelleGroupUtils: any;
  PlafondDeclaration: any;
  PrimesImportParse: any;
  PrimesV2: any;
  QuinzaineUtils: any;
  RapprochementPaie: any;
  RecolteKpiUtils: any;
  ScanAttachmentUtils: any;
  ScanHistoryDisplay: any;
  StockDestinations: any;
  StockGuard: any;
  StockLocationsLib: any;
  StockMovementGuard: any;
  UniteConsoUtils: any;
  useStockLocations: any;
}

/** `XLSX` est aussi lu sans préfixe `window.` dans certains modules. */
declare const XLSX: any;
