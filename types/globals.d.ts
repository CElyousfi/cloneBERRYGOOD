/**
 * globals.d.ts — surface globale du frontend, pour `npm run typecheck`.
 *
 * Le code applicatif est en modules ES (src/modules) : tout ce qui vient du
 * dépôt s'importe. Seules les bibliothèques tierces chargées par CDN dans
 * public/index.html restent des globales du navigateur (React, ReactDOM,
 * Firebase compat, XLSX, jsPDF, pdf-lib, pdf.js, Leaflet, driver.js), plus
 * ExcelJS, injecté à la demande par l'export Campagne.
 *
 * Elles sont typées `any` À DESSEIN : leur forme réelle vit dans les bundles
 * tiers, pas ici. Le but de ce fichier est de faire disparaître un faux
 * positif structurel, pas de re-décrire ces bibliothèques.
 *
 * `index.html` est la liste qui fait foi des scripts chargés.
 */

declare const React: any;
declare const ReactDOM: any;
declare const XLSX: any;
declare const ExcelJS: any;
declare const PDFLib: any;
declare const jspdf: any;
declare const pdfjsLib: any;
declare const firebase: any;
declare const L: any;

/** Constante de compilation (vite.config.js `define`) : build de démo sans authentification. */
declare const __SB_DEMO_NO_AUTH__: boolean;

interface Window {
  React: any;
  XLSX: any;

  /* Copies backend (functions/lib/*) portant encore le shim UMD historique
     `if (typeof window !== 'undefined') window.X = …` — inerte sous Node. */
  AnalytiqueUtils: any;
  BdcWorkflow: any;
  CampagneExportUtils: any;
  CampagneUtils: any;
  CoutMainOeuvre: any;
  CultureUtils: any;
  LecturePaieExcel: any;
  PaieUtils: any;
  PlafondDeclaration: any;
  ScanAttachmentUtils: any;
  StockGuard: any;
  StockMovementGuard: any;
}
