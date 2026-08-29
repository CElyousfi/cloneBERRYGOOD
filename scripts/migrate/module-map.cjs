// Module assignment rules — ordered; first match wins.
module.exports = [
  [/^Caisse|^Caneva|^CAISSE_|^ENC_|^TXN_TYPE_LABELS$|^canevaActor$|^caisseFileToB64$|^encBrut$|^getCaisseColor$|^isMode|^formatModePaiement$/, 'caisse'],
  [/^Security/, 'securite'],
  [/^Achats/, 'achats'],
  [/^Fin|^Budget|^BUDGET_|^treso|^formatMAD$|^buildFactures|^buildLiquidations|^computeAtterrissage$|^computeBudgetWeekly$|^computeProjection$|^importBudgetExcel$|^BDC_|^getBdcSociete$|^Fuel/, 'finance'],
  [/^Qualite|^DQR|^PFQ|^Chef|^deduplicateExpeditions$/, 'qualite'],
  [/^Agro|^AnalysesFoliaires|^Productivity|^Campagne|^CAMPAGNE_|^Planification|^Evolution|^computeNutrients$|^fetchSpray|^transformSpray|^PARCELLES_CULTURALES$|^VARIETE_CYCLE_CONFIG$|^parcelleConfig$|^getCycle|^isMonoCycle$|^getHa|^getPlantsByCycle$|^getParcelle|^normalizeParcelle$|^displayParcelle$|^displayCulture$|^matchCulture$|^sbParcelle|^DESIGNATION_MAP$|^computeMomentum$|^getKgExport$/, 'agronomie'],
  [/^Mag|^Inventaire/, 'magasin'],
  [/^Stationnaire|^Irrigation|^Meteo|^METEO_|^OPEN_METEO|^Climat|^GDD|^Drainage|^fetchMeteoblue|^transformMeteoblue|^fetchOpenMeteo|^meteoFermes$|^parsePictocode$|^parseWindDir$|^MapRenderer$|^useGeolocation$/, 'technique'],
  [/^DG|^Admin|^Parametres|^Backup|^WhatsApp|^Tutorial|^TUTORIAL_|^getTutorials$|^useTutorialEngine$|^Template|^JoursFeries|^SousTraitants|^Baremes|^PAIE_BAREMES_DEFAULT$/, 'admin'],
  [/^Pointage|^Paie|^Equipes|^Quinzaine|^Suivi|^Worker|^calculerPaie|^trouverPalier|^HeuresSup|^Transport|^JourFerie|^DiversQuinzaine|^nomOuvrier$|^__Paie|^FONCTIONS_ENUM$|^loadPointageDistinctDays$/, 'rh'],
  [/^Recolte|^CoutRecolte|^HorsRecolte|^Primes|^Caporal|^Chargement|^Conditionnement|^Traitement|^computeBoxStats$|^calculateRendement$/, 'recolte'],
];
