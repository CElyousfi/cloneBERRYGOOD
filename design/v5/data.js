/* Spécification des écrans — architecture d'information reprise de l'application
   réelle (mêmes modules, mêmes colonnes), mais rendue par des composants neufs.
   Les valeurs sont un jeu de DÉMONSTRATION : Firestore refuse toute lecture non
   authentifiée, aucune donnée d'exploitation n'est chargée. */
window.SB = (function () {
  var I = {
    grid:'<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    cash:'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/>',
    doc :'<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/>',
    box :'<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 22v-9"/>',
    users:'<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0113 0M17 11.5a3 3 0 100-6M21.5 20a5.6 5.6 0 00-4-5.4"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    leaf:'<path d="M20 4C10 4 4 9 4 17v3M4 20c10 0 16-5 16-13"/>',
    chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    cog :'<circle cx="12" cy="12" r="3.1"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
    file:'<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    truck:'<path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z"/><circle cx="6" cy="18" r="1.7"/><circle cx="17" cy="18" r="1.7"/>'
  };

  function rows(n, f) { var a = []; for (var i = 0; i < n; i++) a.push(f(i)); return a; }
  var W = ['29/08 → 04/09','05/09 → 11/09','12/09 → 18/09','19/09 → 25/09',
           '26/09 → 02/10','03/10 → 09/10','10/10 → 16/10','17/10 → 23/10'];

  var MODULES = [
    { k:'overview', t:'Vue d\'ensemble', i:I.grid,  screens:['overview'] },
    { k:'finance',  t:'Finance',        i:I.cash,
      screens:['treso','factures','virements'] },
    { k:'achats',   t:'Achats',         i:I.doc,   screens:['bdc','fournisseurs'] },
    { k:'stock',    t:'Stock',          i:I.box,   screens:['intrants','inventaire'] },
    { k:'rh',       t:'RH & Paie',      i:I.users, screens:['paie','pointage'] },
    { k:'prod',     t:'Production',     i:I.chart, screens:['bons','ecarts'] },
    { k:'agro',     t:'Agronomie',      i:I.leaf,  screens:['parcelles'] },
    { k:'param',    t:'Paramètres',     i:I.cog,   screens:['param'] }
  ];

  var S = {
    overview:{ mod:'overview', ico:I.grid, nav:'Tableau de bord', kind:'overview',
      title:'Bonjour', sub:'L\'état de l\'exploitation, campagne 2025-2026.' },

    treso:{ mod:'finance', ico:I.cash, nav:'Trésorerie', kind:'table',
      title:'Trésorerie', sub:'Cash-flow prévisionnel sur 8 semaines, calendrier Driscoll\'s (samedi → vendredi).',
      metrics:[ {k:'Solde net projeté',v:'0 MAD',d:'sur 8 semaines'},
                {k:'Échéances 7 j',v:'0 MAD',d:'à décaisser'},
                {k:'Factures en retard',v:'0 MAD',d:'au-delà du terme'},
                {k:'Entrées attendues',v:'0 MAD',d:'Driscoll\'s'} ],
      filters:['8 semaines','13 semaines','26 semaines'],
      cols:['Semaine','Entrées Driscoll\'s','Factures','Loyers','Paie','Autres','Solde net','Cumul'],
      num:[1,2,3,4,5,6,7],
      rows:rows(8,function(i){ return [W[i],'—','—','—','—','—','0 MAD','0 MAD']; }),
      aside:{ title:'Répartition', kv:[['Entrées','0 MAD'],['Sorties','0 MAD'],['Net','0 MAD']],
        bars:[30,52,38,64,45,58,40,70], note:'Les factures fournisseurs et liquidations Driscoll\'s sont agrégées automatiquement. La paie peut être ajoutée comme item récurrent.' } },

    factures:{ mod:'finance', ico:I.file, nav:'Factures fournisseurs', kind:'table',
      title:'Factures fournisseurs', sub:'Rapprochement des factures avec les bons de commande et les réceptions.',
      metrics:[ {k:'À payer',v:'0 MAD',d:'toutes échéances'},
                {k:'En litige',v:'0',d:'écart de rapprochement'},
                {k:'Réglées ce mois',v:'0 MAD',d:''} ],
      filters:['Toutes','À payer','Réglées','En litige'],
      cols:['N° Interne','N° Facture','BDC','Fournisseur','Date','Total TTC'],
      num:[5], rows:[],
      aside:{ title:'Contrôle', kv:[['Sans BDC','0'],['Écart > 5 %','0'],['TVA à récupérer','0 MAD']],
        note:'Une facture sans bon de commande rattaché reste bloquée jusqu\'à validation par le responsable Achats.' } },

    virements:{ mod:'finance', ico:I.cash, nav:'Virements', kind:'table',
      title:'Virements', sub:'Ordres de virement préparés et transmis à la banque.',
      metrics:[ {k:'En préparation',v:'0',d:''}, {k:'Transmis',v:'0',d:'ce mois'},
                {k:'Montant total',v:'0 MAD',d:''} ],
      filters:['Tous','En préparation','Transmis'],
      cols:['Date','Bénéficiaire','Motif','Compte','Montant'], num:[4], rows:[],
      aside:{ title:'Rappel', note:'Chaque ordre requiert la double validation Finance puis Direction avant transmission.' } },

    bdc:{ mod:'achats', ico:I.doc, nav:'Bons de commande', kind:'table',
      title:'Bons de commande', sub:'Cycle achat : demande, validation, commande, réception, valorisation.',
      metrics:[ {k:'À réceptionner',v:'0',d:'BDC ouverts'},
                {k:'En attente validation',v:'0',d:'chef de service'},
                {k:'Engagé',v:'0 MAD',d:'campagne en cours'} ],
      filters:['Tous','À valider','À réceptionner','Clôturés'],
      cols:['N°','Date','Fournisseur','Ferme','Articles','Total TTC'], num:[4,5], rows:[],
      aside:{ title:'Circuit de validation',
        note:'Demande d\'achat → validation chef de service → bon de commande → réception magasin → valorisation comptable.',
        kv:[['Délai moyen','—'],['Taux de réception','—']] } },

    fournisseurs:{ mod:'achats', ico:I.truck, nav:'Fournisseurs', kind:'table',
      title:'Fournisseurs', sub:'Référentiel fournisseurs et conditions de règlement.',
      metrics:[ {k:'Référencés',v:'0',d:''}, {k:'Actifs campagne',v:'0',d:''} ],
      filters:['Tous','Actifs','Inactifs'],
      cols:['Raison sociale','ICE','Catégorie','Délai règlement','Encours'], num:[4], rows:[],
      aside:{ title:'Note', note:'L\'encours est calculé à partir des factures non réglées, déduction faite des avoirs.' } },

    intrants:{ mod:'stock', ico:I.box, nav:'Stock intrants', kind:'table',
      title:'Stock intrants', sub:'Soldes par lieu de stockage, article et unité.',
      metrics:[ {k:'Valeur théorique',v:'1,4 M',d:'MAD'},
                {k:'Catégories',v:'4',d:'suivies'},
                {k:'Écart réconciliation',v:'−12 500',d:'MAD'},
                {k:'Références',v:'24',d:'actives'} ],
      filters:['Tous lieux','F1','F5','Avocatier'],
      cols:['Lieu','Type','Article','Unité','Solde','Statut'], num:[4],
      rows:[ ['Magasin F1','Emballage','Barquette 250 g','unité','—','<span class="tag">Suivi</span>'],
             ['Magasin F1','Fertilisant','Nitrate de calcium','kg','—','<span class="tag">Suivi</span>'],
             ['Magasin F5','Phyto','Soufre mouillable','kg','—','<span class="tag">Suivi</span>'],
             ['Atelier','Pièce','Goutteur 2 L/h','unité','—','<span class="tag">Suivi</span>'] ],
      aside:{ title:'Par catégorie',
        kv:[['Emballages','850 000'],['Fertilisants','320 000'],['Pesticides','180 000'],['Pièces détachées','95 000']],
        bars:[85,32,18,10], note:'Valeurs en MAD, jeu de démonstration.' } },

    inventaire:{ mod:'stock', ico:I.box, nav:'Inventaire', kind:'table',
      title:'Inventaire', sub:'Comptages physiques et écarts par rapport au stock théorique.',
      metrics:[ {k:'Dernier comptage',v:'—',d:''}, {k:'Écart valorisé',v:'−12 500',d:'MAD'} ],
      filters:['En cours','Clôturés'],
      cols:['Date','Lieu','Article','Théorique','Compté','Écart'], num:[3,4,5], rows:[],
      aside:{ title:'Procédure', note:'Tout écart supérieur à 2 % doit faire l\'objet d\'un PV de réconciliation signé par le magasinier et le responsable Achats.' } },

    paie:{ mod:'rh', ico:I.users, nav:'Paie', kind:'table',
      title:'Paie', sub:'Calcul de la quinzaine : déclaré, ancienneté, paliers et primes de fonction.',
      metrics:[ {k:'Quinzaine',v:'—',d:'période en cours'},
                {k:'Ouvriers',v:'0',d:'déclarés'},
                {k:'Brut total',v:'0 MAD',d:''},
                {k:'Coût employeur',v:'0 MAD',d:'charges incluses'} ],
      filters:['Toutes fermes','F1','F5','Avocatier'],
      cols:['Matricule','Nom','Prénom','Déclaré','Prime fct (DH/j)','Ancienneté (j)','Palier','Jours période','Brut'],
      num:[3,4,5,7,8], rows:[],
      aside:{ title:'Barèmes',
        kv:[['SMAG horaire','—'],['Palier 1','—'],['Palier 2','—'],['Palier 3','—']],
        note:'Les paliers d\'ancienneté et la prime de fonction sont paramétrés dans Paramètres → Barèmes de paie.' } },

    pointage:{ mod:'rh', ico:I.clock, nav:'Pointage quotidien', kind:'table',
      title:'Pointage quotidien', sub:'Effectifs par ferme, récolte et hors récolte, avec coût journalier.',
      metrics:[ {k:'Total ouvriers',v:'0',d:'aujourd\'hui'},
                {k:'Récolte',v:'0',d:''}, {k:'Hors récolte',v:'0',d:''},
                {k:'Coût du jour',v:'0 MAD',d:''} ],
      filters:['Aujourd\'hui','Hier','Semaine'],
      cols:['Ferme','Récolte','Hors récolte','Total ouvriers','Veille','Variation','Coût (DH)'],
      num:[1,2,3,4,5,6],
      rows:[ ['F1','—','—','—','—','—','—'],['F5','—','—','—','—','—','—'],
             ['Avocatier','—','—','—','—','—','—'] ],
      aside:{ title:'Validation',
        kv:[['RH','En attente'],['Caporal','En attente'],['Chef','En attente']],
        note:'Le pointage doit être validé successivement par le caporal, le chef de ferme puis les RH avant intégration à la paie.' } },

    bons:{ mod:'prod', ico:I.chart, nav:'Bons d\'apport', kind:'table',
      title:'Bons d\'apport', sub:'Réception des lots par variété, parcelle et semaine de campagne.',
      metrics:[ {k:'Bons de la semaine',v:'0',d:''},
                {k:'Kg réceptionnés',v:'0',d:'toutes variétés'},
                {k:'Non réconciliés',v:'0',d:''} ],
      filters:['Semaine','Quinzaine','Campagne'],
      cols:['N° Bon','Date','Variété','Ferme','Parcelle','Sem.','Kg'], num:[5,6], rows:[],
      aside:{ title:'Réconciliation',
        note:'Chaque bon d\'apport est rapproché des expéditions et des liquidations Driscoll\'s. Les écarts alimentent l\'écran Écarts.',
        kv:[['Rapprochés','0'],['En écart','0']] } },

    ecarts:{ mod:'prod', ico:I.chart, nav:'Écarts de production', kind:'table',
      title:'Écarts de production', sub:'Différences entre kg apportés, expédiés et liquidés.',
      metrics:[ {k:'Écart net',v:'0 kg',d:'campagne'},
                {k:'Lots en écart',v:'0',d:''}, {k:'Valorisation',v:'0 MAD',d:''} ],
      filters:['Tous','> 5 %','Non justifiés'],
      cols:['Désignation','Type','Semaine','Quantité (kg)'], num:[3], rows:[],
      aside:{ title:'Seuils', kv:[['Tolérance','5 %'],['Alerte','10 %']],
        note:'Au-delà du seuil d\'alerte, l\'écart remonte automatiquement au tableau de bord Direction.' } },

    parcelles:{ mod:'agro', ico:I.leaf, nav:'Parcelles', kind:'table',
      title:'Parcelles', sub:'Suivi cultural : variété, cycle, surface et avancement.',
      metrics:[ {k:'Parcelles',v:'0',d:'en production'},
                {k:'Surface',v:'—',d:'hectares'}, {k:'Variétés',v:'—',d:''} ],
      filters:['Toutes','F1','F5','Avocatier'],
      cols:['Parcelle','Culture','Variété','Cycle','Surface (ha)','Plants','Avancement'],
      num:[4,5], rows:[],
      aside:{ title:'Campagne', kv:[['Début','—'],['Semaine en cours','—']],
        note:'L\'avancement de culture est calculé à partir des relevés de croissance et des degrés-jours cumulés.' } },

    param:{ mod:'param', ico:I.cog, nav:'Paramètres', kind:'table',
      title:'Paramètres', sub:'Référentiels, barèmes et droits d\'accès.',
      metrics:[ {k:'Profils',v:'20',d:'définis'}, {k:'Modules',v:'12',d:''}, {k:'Écrans',v:'120',d:''} ],
      filters:['Référentiels','Barèmes','Accès'],
      cols:['Paramètre','Portée','Valeur','Dernière modification'], num:[], rows:[],
      aside:{ title:'Traçabilité', note:'Toute modification de barème est horodatée et attribuée à son auteur ; l\'historique est consultable depuis Suivi Modifications.' } }
  };

  var CARDS = [
    { i:I.cash,  h:'Trésorerie', go:'treso',
      t:'Solde net projeté sur <b>8 semaines</b>, calendrier Driscoll\'s.', v:'0 MAD', f:'Ouvrir la trésorerie' },
    { i:I.chart, h:'Production', go:'bons',
      t:'Bons d\'apport réceptionnés et réconciliation des lots.', bars:[35,58,42,78,50,66,38,72], f:'Voir les bons' },
    { i:I.box,   h:'Stock',      go:'intrants',
      t:'Valeur théorique du stock, <b>4 catégories</b> suivies.', v:'1,4 M', f:'Ouvrir le magasin' },
    { i:I.doc,   h:'Achats',     go:'bdc',
      t:'Bons de commande en attente de réception.', v:'0', f:'Suivi des BDC' },
    { i:I.users, h:'RH & Paie',  go:'paie',
      t:'Paie de la quinzaine, primes et transport.', v:'0 MAD', f:'Ouvrir la paie' },
    { i:I.clock, h:'Pointage',   go:'pointage',
      t:'Effectifs du jour — <b>F1</b>, <b>F5</b> et Avocatier.', v:'0', f:'Voir le pointage' },
    { i:I.leaf,  h:'Agronomie',  go:'parcelles',
      t:'Avancement de culture, irrigation et phytosanitaire.', v:'—', f:'Ouvrir l\'agronomie' },
    { i:I.file,  h:'Factures',   go:'factures',
      t:'Rapprochement factures / BDC / réceptions.', v:'0', f:'Ouvrir les factures' }
  ];

  return { I:I, MODULES:MODULES, SCREENS:S, CARDS:CARDS };
})();
