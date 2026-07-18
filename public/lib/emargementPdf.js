'use strict';
(function () {
    var C = {
        berry:     [192, 57, 43],
        green:     [29, 158, 117],
        gray:      [102, 102, 102],
        lightGray: [240, 240, 240],
        white:     [255, 255, 255],
        black:     [0, 0, 0],
        // Berry Good brand colors (bulletins)
        berryBrand:     [144, 39, 143],
        greenBrand:     [130, 179, 58],
        berryPaleBg:    [248, 240, 248],
    };

    function newDoc() {
        var jsPDF = (window.jspdf && window.jspdf.jsPDF) || (window.jsPDF);
        if (!jsPDF) { alert('jsPDF non chargé'); return null; }
        return new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    }

    // Format number : 1234.5 → "1 234,50"
    function fmtDH(n) {
        return Number(n || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }

    function addHeader(doc, title, periode, yStart) {
        // Logo text
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(C.berry[0], C.berry[1], C.berry[2]);
        doc.text('Berry Good Farms', 14, yStart);

        // Title
        doc.setFontSize(14);
        doc.setTextColor(C.black[0], C.black[1], C.black[2]);
        doc.text(title, 105, yStart, { align: 'center' });

        // Période
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(C.gray[0], C.gray[1], C.gray[2]);
        doc.text('Période : ' + (periode || '—'), 196, yStart, { align: 'right' });

        // Ligne séparatrice
        doc.setDrawColor(C.berry[0], C.berry[1], C.berry[2]);
        doc.setLineWidth(0.5);
        doc.line(14, yStart + 4, 196, yStart + 4);

        return yStart + 8;
    }

    function download(doc, filename) {
        doc.save(filename);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. ÉMARGEMENT SANS CNSS (non déclarés)
    // ─────────────────────────────────────────────────────────────────────────────
    function genSansCnss(workers, periode) {
        // workers: [{ matricule, nom, equipe, journees, net (= smagNet × jours) }]
        var doc = newDoc();
        if (!doc) return;

        var y = addHeader(doc, 'État D\'Émargement  OUVRIERS  SANS CNSS', periode, 18);

        var rows = workers.map(function (w) {
            return [
                w.matricule || '—',
                (w.nom || '').toUpperCase(),
                w.equipe || '—',
                String(w.journees || 0),
                fmtDH(w.net),
                '',
            ];
        });

        var total = workers.reduce(function (s, w) { return { jours: s.jours + (w.journees || 0), net: s.net + (w.net || 0) }; }, { jours: 0, net: 0 });

        doc.autoTable({
            startY: y,
            head: [['Matricule', 'Nom Et Prénom', 'Équipe', 'Nbr Jours', 'Montant', 'Émargement']],
            body: rows,
            foot: [['', 'TOTAL', '', String(total.jours) + ' j', fmtDH(total.net), '']],
            styles: { fontSize: 9, cellPadding: 3 },
            headStyles: { fillColor: C.berry, textColor: C.white, fontStyle: 'bold' },
            footStyles: { fillColor: C.lightGray, fontStyle: 'bold' },
            columnStyles: {
                0: { cellWidth: 16 },
                1: { cellWidth: 68 },
                2: { cellWidth: 22 },
                3: { cellWidth: 14, halign: 'center' },
                4: { cellWidth: 22, halign: 'right' },
                5: { cellWidth: 40 },
            },
            alternateRowStyles: { fillColor: [252, 252, 252] },
            margin: { left: 14, right: 14 },
        });

        var periodeSafe = (periode || 'quinzaine').replace(/[^a-zA-Z0-9_-]/g, '_');
        download(doc, 'Emargement_Sans_CNSS_' + periodeSafe + '.pdf');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. ÉMARGEMENT DÉCLARÉS
    // ─────────────────────────────────────────────────────────────────────────────
    function genAvecCnss(workers, periode) {
        // workers: [{ matricule, nom, equipe, journees, net (= brut) }]
        var doc = newDoc();
        if (!doc) return;

        var y = addHeader(doc, 'État D\'Émargement  OUVRIERS  DÉCLARÉS CNSS', periode, 18);

        var rows = workers.map(function (w) {
            return [
                w.matricule || '—',
                (w.nom || '').toUpperCase(),
                w.equipe || '—',
                String(w.journees || 0),
                fmtDH(w.net),
                '',
            ];
        });

        var total = workers.reduce(function (s, w) { return { jours: s.jours + (w.journees || 0), net: s.net + (w.net || 0) }; }, { jours: 0, net: 0 });

        doc.autoTable({
            startY: y,
            head: [['Matricule', 'Nom Et Prénom', 'Équipe', 'Nbr Jours', 'Net à payer', 'Émargement']],
            body: rows,
            foot: [['', 'TOTAL', '', String(total.jours) + ' j', fmtDH(total.net), '']],
            styles: { fontSize: 9, cellPadding: 3 },
            headStyles: { fillColor: C.green, textColor: C.white, fontStyle: 'bold' },
            footStyles: { fillColor: C.lightGray, fontStyle: 'bold' },
            columnStyles: {
                0: { cellWidth: 16 },
                1: { cellWidth: 68 },
                2: { cellWidth: 22 },
                3: { cellWidth: 14, halign: 'center' },
                4: { cellWidth: 22, halign: 'right' },
                5: { cellWidth: 40 },
            },
            alternateRowStyles: { fillColor: [252, 252, 252] },
            margin: { left: 14, right: 14 },
        });

        var periodeSafe = (periode || 'quinzaine').replace(/[^a-zA-Z0-9_-]/g, '_');
        download(doc, 'Emargement_Declares_' + periodeSafe + '.pdf');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. ÉMARGEMENT TRANSPORTEURS
    // ─────────────────────────────────────────────────────────────────────────────
    function genTransporteurs(equipes, periode) {
        // equipes: [{ equipe, caporal, coutParOuvrier, nbJH, montant }]
        var doc = newDoc();
        if (!doc) return;

        var y = addHeader(doc, 'État D\'Émargement  TRANSPORT PERSONNEL', periode, 18);

        var rows = equipes.map(function (e) {
            return [
                e.equipe || '—',
                e.caporal || '—',
                fmtDH(e.coutParOuvrier) + ' DH/j',
                String(e.nbJH || 0),
                fmtDH(e.montant),
                '',
            ];
        });

        var total = equipes.reduce(function (s, e) { return { nbJH: s.nbJH + (e.nbJH || 0), montant: s.montant + (e.montant || 0) }; }, { nbJH: 0, montant: 0 });

        doc.autoTable({
            startY: y,
            head: [['Équipe', 'Caporal', 'Coût/place', 'Nb JH', 'Montant', 'Émargement']],
            body: rows,
            foot: [['TOTAL', '', '', String(total.nbJH), fmtDH(total.montant), '']],
            styles: { fontSize: 9, cellPadding: 3 },
            headStyles: { fillColor: [52, 73, 171], textColor: C.white, fontStyle: 'bold' },
            footStyles: { fillColor: C.lightGray, fontStyle: 'bold' },
            columnStyles: {
                0: { cellWidth: 38 },
                1: { cellWidth: 38 },
                2: { cellWidth: 24, halign: 'right' },
                3: { cellWidth: 14, halign: 'center' },
                4: { cellWidth: 24, halign: 'right' },
                5: { cellWidth: 44 },
            },
            alternateRowStyles: { fillColor: [252, 252, 252] },
            margin: { left: 14, right: 14 },
        });

        var periodeSafe = (periode || 'quinzaine').replace(/[^a-zA-Z0-9_-]/g, '_');
        download(doc, 'Emargement_Transporteurs_' + periodeSafe + '.pdf');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. BULLETINS DE PAIE (un PDF, une page par ouvrier déclaré)
    //    Format : Smart Berry / Berry Good Farms
    //    NOTE : fonction async — le caller doit l'appeler avec await
    // ─────────────────────────────────────────────────────────────────────────────
    function formatDateFR(dateStr) {
        if (!dateStr) return '';
        var d = new Date(dateStr);
        var mois = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
        return d.getDate().toString().padStart(2,'0') + ' ' + mois[d.getMonth()] + ' ' + d.getFullYear();
    }

    async function genBulletins(workers, periode, smagBrutJournalier, options) {
        // workers: [{
        //   matricule, nom, prenom, equipe, journees, declare,
        //   cin,               // peut être null/undefined
        //   cnss,              // peut être null/undefined
        //   salaireBase,       // smagBrutJournalier × journees (déjà calculé dans app.jsx)
        //   primeFonctionTotal,
        //   primeFonctionJour,
        //   ancienneteTotal,
        //   anciennetePct,
        //   transportJour,
        //   transportTotal,
        //   brut,              // brut du modèle dashboard (non utilisé pour le calcul bulletin)
        // }]

        // ── Chargement logo ──
        var logoDataUrl = null;
        try {
            var resp = await fetch('/assets/icon-512.png');
            var blob = await resp.blob();
            logoDataUrl = await new Promise(function (resolve) {
                var reader = new FileReader();
                reader.onloadend = function () { resolve(reader.result); };
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            // Logo non disponible, continuer sans
        }

        // Constantes entreprise
        var ENTREPRISE = {
            nom:      'BERRY GOOD FARMS',
            forme:    'Sarl au capital de 100 000,00 Dhs',
            adresse1: '44 Imm. A, Rés. Al Boustane, cité Dakhla - Agadir',
            tp:       '67500683',
            rc:       '38125',
            if_:      '26107029',
            ice:      '002106859000069',
            noCnss:   '3633882',
        };

        // Taux légaux CNSS / AMO
        var TAUX_CNSS = 0.0448;
        var TAUX_AMO  = 0.0226;

        var periodeLabel = (options && options.dateDebut && options.dateFin)
            ? 'Du ' + formatDateFR(options.dateDebut) + ' au ' + formatDateFR(options.dateFin)
            : 'Période : ' + String(periode || '');

        if (!workers || workers.length === 0) { alert('Aucun ouvrier déclaré pour cette période.'); return; }

        var doc = newDoc();
        if (!doc) return;
        var isFirst = true;

        workers.forEach(function (w) {
            if (!isFirst) doc.addPage();
            isFirst = false;

            var jours            = w.journees || 0;
            var dailyRate        = smagBrutJournalier || 0;
            var sHoraire         = dailyRate / 8;
            var smagBaseTotal    = dailyRate * jours;                          // code 111
            var primeFonctionTot = (w.primeFonctionJour || 0) * jours;        // code 499
            // Ancienneté: base = smagBaseTotal + primeFonctionTotal
            var ancPct           = w.anciennetePct || 0;
            var ancBase          = smagBaseTotal + primeFonctionTot;
            var ancMontant       = ancBase * ancPct / 100;                     // code 121
            var brutTotal        = smagBaseTotal + ancMontant + primeFonctionTot;
            var transportTotal   = w.transportTotal || 0;                      // non imposable
            var cnssRetenue      = brutTotal * TAUX_CNSS;                     // code 601 — base = brutTotal (hors transport)
            var amoRetenue       = brutTotal * TAUX_AMO;                      // code 631 — base = brutTotal (hors transport)
            var totalRetenues    = cnssRetenue + amoRetenue;
            var netImposable     = brutTotal - totalRetenues;
            var netAPayer        = Math.round(netImposable);                   // transport + avance se neutralisent
            var arrondi          = netAPayer - netImposable;                   // code 9999

            var y = 10;

            // ── BLOC 1 : Header société ──
            // Fond violet très pâle sur toute la bande
            var headerH = 30;
            doc.setFillColor(C.berryPaleBg[0], C.berryPaleBg[1], C.berryPaleBg[2]);
            doc.rect(14, y - 4, 182, headerH, 'F');

            // Logo (35mm × 20mm) — colonne gauche
            if (logoDataUrl) {
                doc.addImage(logoDataUrl, 'PNG', 16, y - 2, 35, 20);
            }

            // Nom société — colonne droite (à partir de x=55)
            var xSoc = 55;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(13);
            doc.setTextColor(C.berryBrand[0], C.berryBrand[1], C.berryBrand[2]);
            doc.text(ENTREPRISE.nom, xSoc, y + 2);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(C.black[0], C.black[1], C.black[2]);
            doc.text(ENTREPRISE.forme, xSoc, y + 7);
            doc.text(ENTREPRISE.adresse1, xSoc, y + 11);
            doc.text(
                'TP: ' + ENTREPRISE.tp + '  |  RC: ' + ENTREPRISE.rc,
                xSoc, y + 15
            );
            doc.text(
                'IF: ' + ENTREPRISE.if_ + '  |  ICE: ' + ENTREPRISE.ice,
                xSoc, y + 19
            );
            y += headerH;

            // ── BLOC 2 : Bande titre "BULLETIN DE PAIE" ──
            doc.setFillColor(C.berryBrand[0], C.berryBrand[1], C.berryBrand[2]);
            doc.rect(14, y - 1, 182, 9, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(C.white[0], C.white[1], C.white[2]);
            doc.text('BULLETIN DE PAIE', 105, y + 5, { align: 'center' });

            // Période dans la même bande, à droite
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text(periodeLabel, 193, y + 5, { align: 'right' });
            y += 12;

            // ── BLOC 3 : Info salarié (2 colonnes côte à côte) ──
            // Colonne gauche : identité civile / professionnelle
            // Colonne droite : identification CNSS / CIN
            var colW = 88;
            var xLeft = 14;
            var xRight = 14 + colW + 6;
            var yBlock = y;
            var lineH = 5.5;

            // Fond léger pour les deux blocs (hauteur 32 pour éviter le chevauchement)
            doc.setFillColor(C.berryPaleBg[0], C.berryPaleBg[1], C.berryPaleBg[2]);
            doc.rect(xLeft, yBlock - 2, colW, 32, 'F');
            doc.rect(xRight, yBlock - 2, colW, 32, 'F');

            // En-têtes des deux blocs (fond vert brand, texte blanc, hauteur 8 pour texte visible)
            doc.setFillColor(C.greenBrand[0], C.greenBrand[1], C.greenBrand[2]);
            doc.rect(xLeft, yBlock - 2, colW, 8, 'F');
            doc.rect(xRight, yBlock - 2, colW, 8, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            doc.setTextColor(C.white[0], C.white[1], C.white[2]);
            doc.text('SALARIÉ', xLeft + 2, yBlock + 3);
            doc.text('IDENTIFICATION', xRight + 2, yBlock + 3);

            // Contenu colonne gauche (commence 3mm sous la fin du header)
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(C.black[0], C.black[1], C.black[2]);
            var yL = yBlock + 9;
            doc.setFont('helvetica', 'bold'); doc.text('Nom', xLeft + 2, yL);
            doc.setFont('helvetica', 'normal'); doc.text(': ' + (w.nom || '—').toUpperCase(), xLeft + 20, yL);
            yL += lineH;
            if (w.prenom) {
                doc.setFont('helvetica', 'bold'); doc.text('Prénom', xLeft + 2, yL);
                doc.setFont('helvetica', 'normal'); doc.text(': ' + w.prenom, xLeft + 20, yL);
                yL += lineH;
            }
            doc.setFont('helvetica', 'bold'); doc.text('Équipe', xLeft + 2, yL);
            doc.setFont('helvetica', 'normal'); doc.text(': ' + (w.equipe || '—'), xLeft + 20, yL);
            yL += lineH;
            doc.setFont('helvetica', 'bold'); doc.text('Catégorie', xLeft + 2, yL);
            doc.setFont('helvetica', 'normal'); doc.text(': ' + (w.declare ? 'Ouvrier CNSS' : 'Ouvrier Sans CNSS'), xLeft + 20, yL);

            // Contenu colonne droite
            var yR = yBlock + 9;
            doc.setFont('helvetica', 'bold'); doc.text('Matricule', xRight + 2, yR);
            doc.setFont('helvetica', 'normal'); doc.text(': ' + (w.matricule || '—'), xRight + 28, yR);
            yR += lineH;
            doc.setFont('helvetica', 'bold'); doc.text('CIN', xRight + 2, yR);
            doc.setFont('helvetica', 'normal'); doc.text(': ' + (w.cin || '—'), xRight + 28, yR);
            yR += lineH;
            doc.setFont('helvetica', 'bold'); doc.text('CNSS', xRight + 2, yR);
            doc.setFont('helvetica', 'normal'); doc.text(': ' + (w.cnss || '—'), xRight + 28, yR);
            yR += lineH;
            doc.setFont('helvetica', 'bold'); doc.text('N° CNSS Emp.', xRight + 2, yR);
            doc.setFont('helvetica', 'normal'); doc.text(': ' + ENTREPRISE.noCnss, xRight + 28, yR);

            y = Math.max(yL, yR) + 8;

            // ── BLOC 3b : Ligne Sal. de base / S. Horaire / Période (compact) ──
            doc.autoTable({
                startY: y,
                head: [['Sit. F.', 'Nb. Enf.', 'Déduc.', 'Date Naiss.', 'Date Entrée', 'Sal. de base', 'S. Horaire', 'Période Paie']],
                body: [[
                    '—', '—', '—', '—', '—',
                    fmtDH(dailyRate),
                    fmtDH(sHoraire),
                    periodeLabel,
                ]],
                styles:     { fontSize: 7, cellPadding: 2 },
                headStyles: { fillColor: C.lightGray, textColor: C.black, fontStyle: 'bold', fontSize: 7 },
                columnStyles: {
                    0: { cellWidth: 15 },
                    1: { cellWidth: 17 },
                    2: { cellWidth: 15 },
                    3: { cellWidth: 23 },
                    4: { cellWidth: 23 },
                    5: { cellWidth: 26, halign: 'right' },
                    6: { cellWidth: 24, halign: 'right' },
                    7: { cellWidth: 39, halign: 'right' },
                },
                margin: { left: 14, right: 14 },
                theme: 'grid',
            });
            y = doc.lastAutoTable.finalY + 4;

            // ── BLOC 4 : Table des lignes de paie ──
            var bodyRows       = [];
            var boldRows       = [];   // indices des lignes "Total..." à mettre en gras + fond gris
            var totalRows      = [];   // indices pour ligne "Totaux" et "NET À PAYER" (fond berry)
            var niHeaderRows   = [];   // indices header "INDEMNITÉS NON IMPOSABLES" (bleu pâle)
            var niTotalRows    = [];   // indices total indemnités non imposables (bleu très pâle, gras)
            var avHeaderRows   = [];   // indices header "AVANCES PERÇUES" (rouge pâle)
            var avTotalRows    = [];   // indices total avances (rouge pâle, gras)

            var hasTransport = transportTotal > 0;

            // 111 — Salaire de base
            bodyRows.push(['111', 'Salaire de base', fmtDH(dailyRate), String(jours), fmtDH(smagBaseTotal), '']);

            // 121 — Prime d'ancienneté (si applicable)
            if (ancPct > 0) {
                bodyRows.push(['121', 'Prime d\'ancienneté', fmtDH(ancBase), ancPct + '%', fmtDH(ancMontant), '']);
            }

            // Total Traitements & Salaires
            var totalTraitements = smagBaseTotal + ancMontant;
            boldRows.push(bodyRows.length);
            bodyRows.push(['', 'Total Traitements & Salaires', '', '', fmtDH(totalTraitements), '']);

            // 499 — Prime de fonction (si applicable)
            if (primeFonctionTot > 0) {
                bodyRows.push(['499', 'Prime de fonction', '', '', fmtDH(primeFonctionTot), '']);
            }

            // Total Autres Indemnités
            boldRows.push(bodyRows.length);
            bodyRows.push(['', 'Total Autres Indemnités', '', '', fmtDH(primeFonctionTot), '']);

            // ── Section Indemnités non imposables (transport) ──
            if (hasTransport) {
                niHeaderRows.push(bodyRows.length);
                bodyRows.push(['', 'INDEMNITÉS NON IMPOSABLES', '', '', '', '']);

                bodyRows.push(['', 'Indemnité de transport', fmtDH(w.transportJour || 0), String(jours), fmtDH(transportTotal), '']);

                niTotalRows.push(bodyRows.length);
                bodyRows.push(['', 'Total Indemnités n.i.', '', '', fmtDH(transportTotal), '']);
            }

            // 601 — CNSS (base = brutTotal, hors transport non imposable)
            bodyRows.push(['601', 'Cotisation CNSS', fmtDH(brutTotal), '4,48%', '', fmtDH(cnssRetenue)]);

            // 631 — AMO (base = brutTotal, hors transport non imposable)
            bodyRows.push(['631', 'Cotisation Mutuelle/AMO', fmtDH(brutTotal), '2,26%', '', fmtDH(amoRetenue)]);

            // Total Retenues Sociales
            boldRows.push(bodyRows.length);
            bodyRows.push(['', 'Total Retenues Sociales', '', '', '', fmtDH(totalRetenues)]);

            // 792 — IR (0 pour ouvriers agricoles)
            bodyRows.push(['792', 'Prélèvement Impôt IR', fmtDH(netImposable), '', '', '0,00']);

            // Total Impôts
            boldRows.push(bodyRows.length);
            bodyRows.push(['', 'Total Impôts', '', '', '', '0,00']);

            // ── Section Avances perçues (avance transport en espèces) ──
            if (hasTransport) {
                avHeaderRows.push(bodyRows.length);
                bodyRows.push(['', 'AVANCES PERÇUES', '', '', '', '']);

                bodyRows.push(['', 'Avance transport (espèces)', '', '', '', fmtDH(transportTotal)]);

                avTotalRows.push(bodyRows.length);
                bodyRows.push(['', 'Total Avances', '', '', '', fmtDH(transportTotal)]);
            }

            // 9999 — Arrondi (si non nul) — calculé après avances
            if (Math.abs(arrondi) >= 0.005) {
                bodyRows.push(['9999', 'Arrondi', '', '', '', fmtDH(arrondi)]);
            }

            // Ligne Totaux — gains = brutTotal + transport, retenues = totalRetenues + transport
            var totauxIdx    = bodyRows.length;
            var totauxGains  = brutTotal + transportTotal;
            var totauxRetenu = totalRetenues + transportTotal;
            totalRows.push(totauxIdx);
            bodyRows.push(['', 'Totaux', '', '', fmtDH(totauxGains), fmtDH(totauxRetenu)]);

            // Ligne NET À PAYER — transport et avance se neutralisent, NET inchangé
            var netIdx = bodyRows.length;
            totalRows.push(netIdx);
            bodyRows.push(['', 'NET À PAYER', '', '', fmtDH(netAPayer), '']);

            doc.autoTable({
                startY: y,
                head: [['CODE', 'DÉSIGNATION', 'Base', 'Taux', 'Gain', 'Retenu']],
                body: bodyRows,
                styles:     { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: C.berry, textColor: C.white, fontStyle: 'bold', fontSize: 8 },
                columnStyles: {
                    0: { cellWidth: 16, halign: 'center' },
                    1: { cellWidth: 72 },
                    2: { cellWidth: 28, halign: 'right' },
                    3: { cellWidth: 20, halign: 'center' },
                    4: { cellWidth: 28, halign: 'right' },
                    5: { cellWidth: 28, halign: 'right' },
                },
                didParseCell: function (data) {
                    if (data.section !== 'body') return;
                    var row = data.row.index;
                    if (boldRows.indexOf(row) !== -1) {
                        data.cell.styles.fontStyle  = 'bold';
                        data.cell.styles.fillColor  = C.lightGray;
                    }
                    if (totalRows.indexOf(row) !== -1) {
                        data.cell.styles.fontStyle  = 'bold';
                        data.cell.styles.fillColor  = [220, 230, 220];
                    }
                    // Header "INDEMNITÉS NON IMPOSABLES" — bleu très pâle
                    if (niHeaderRows.indexOf(row) !== -1) {
                        data.cell.styles.fillColor  = [230, 244, 255];
                        data.cell.styles.textColor  = [52, 73, 171];
                        data.cell.styles.fontStyle  = 'bold';
                    }
                    // Total indemnités non imposables — bleu pâle, gras
                    if (niTotalRows.indexOf(row) !== -1) {
                        data.cell.styles.fillColor  = [240, 248, 255];
                        data.cell.styles.fontStyle  = 'bold';
                    }
                    // Header "AVANCES PERÇUES" — rouge très pâle
                    if (avHeaderRows.indexOf(row) !== -1) {
                        data.cell.styles.fillColor  = [255, 235, 235];
                        data.cell.styles.textColor  = [192, 57, 43];
                        data.cell.styles.fontStyle  = 'bold';
                    }
                    // Total avances — rouge pâle, gras, texte rouge
                    if (avTotalRows.indexOf(row) !== -1) {
                        data.cell.styles.fillColor  = [255, 245, 245];
                        data.cell.styles.textColor  = [192, 57, 43];
                        data.cell.styles.fontStyle  = 'bold';
                    }
                    // NET À PAYER : colonne Gain en berry
                    if (row === netIdx && data.column.index === 4) {
                        data.cell.styles.textColor = C.berry;
                        data.cell.styles.fontSize  = 9;
                    }
                },
                margin: { left: 14, right: 14 },
                theme: 'grid',
            });
            y = doc.lastAutoTable.finalY + 5;

            // ── BLOC 5 : Tableau des cumuls ──
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(C.black[0], C.black[1], C.black[2]);
            doc.text('Cumuls de la période', 14, y);
            y += 3;

            doc.autoTable({
                startY: y,
                head: [['Jours travaillés', 'Salaire Brut Imposable', 'Sal. net imposable', 'Retenues sociales', 'Impôt (IR)']],
                body: [[
                    String(jours),
                    fmtDH(brutTotal),
                    fmtDH(netAPayer),
                    fmtDH(totalRetenues),
                    '0,00',
                ]],
                styles:     { fontSize: 8, cellPadding: 2, halign: 'right' },
                headStyles: { fillColor: C.lightGray, textColor: C.black, fontStyle: 'bold', fontSize: 7.5 },
                columnStyles: {
                    0: { halign: 'center' },
                    1: { halign: 'right' },
                    2: { halign: 'right' },
                    3: { halign: 'right' },
                    4: { halign: 'right' },
                },
                margin: { left: 14, right: 14 },
                theme: 'grid',
            });
            y = doc.lastAutoTable.finalY + 5;

            // ── BLOC 6 : Situation congés ──
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(C.black[0], C.black[1], C.black[2]);
            doc.text('Situation congé au : ' + periodeLabel, 14, y);
            y += 3;

            doc.autoTable({
                startY: y,
                head: [['Solde Ex précédent', 'Droit Ex. encours', 'Congé pris Ex. encours', 'Solde congé']],
                body: [['—', '—', '—', '—']],
                styles:     { fontSize: 8, cellPadding: 2, halign: 'center' },
                headStyles: { fillColor: C.lightGray, textColor: C.black, fontStyle: 'bold', fontSize: 7.5 },
                margin: { left: 14, right: 14 },
                theme: 'grid',
            });
            y = doc.lastAutoTable.finalY + 5;

        });

        var periodeSafe = (periode || 'quinzaine').replace(/[^a-zA-Z0-9_-]/g, '_');
        download(doc, 'Bulletins_Paie_Declares_' + periodeSafe + '.pdf');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // ARABIC SUPPORT — reshaper + font loader + genBulletinsAr
    // ─────────────────────────────────────────────────────────────────────────────

    // Arabic letter → [isolated, final, initial, medial] Unicode Presentation Forms-B
    var _AR_FORMS = {
        'ء':['ﺀ',null,null,null],
        'آ':['ﺁ','ﺂ',null,null],
        'أ':['ﺃ','ﺄ',null,null],
        'ؤ':['ﺅ','ﺆ',null,null],
        'إ':['ﺇ','ﺈ',null,null],
        'ئ':['ﺉ','ﺊ','ﺋ','ﺌ'],
        'ا':['ﺍ','ﺎ',null,null],
        'ب':['ﺏ','ﺐ','ﺑ','ﺒ'],
        'ة':['ﺓ','ﺔ',null,null],
        'ت':['ﺕ','ﺖ','ﺗ','ﺘ'],
        'ث':['ﺙ','ﺚ','ﺛ','ﺜ'],
        'ج':['ﺝ','ﺞ','ﺟ','ﺠ'],
        'ح':['ﺡ','ﺢ','ﺣ','ﺤ'],
        'خ':['ﺥ','ﺦ','ﺧ','ﺨ'],
        'د':['ﺩ','ﺪ',null,null],
        'ذ':['ﺫ','ﺬ',null,null],
        'ر':['ﺭ','ﺮ',null,null],
        'ز':['ﺯ','ﺰ',null,null],
        'س':['ﺱ','ﺲ','ﺳ','ﺴ'],
        'ش':['ﺵ','ﺶ','ﺷ','ﺸ'],
        'ص':['ﺹ','ﺺ','ﺻ','ﺼ'],
        'ض':['ﺽ','ﺾ','ﺿ','ﻀ'],
        'ط':['ﻁ','ﻂ','ﻃ','ﻄ'],
        'ظ':['ﻅ','ﻆ','ﻇ','ﻈ'],
        'ع':['ﻉ','ﻊ','ﻋ','ﻌ'],
        'غ':['ﻍ','ﻎ','ﻏ','ﻐ'],
        'ف':['ﻑ','ﻒ','ﻓ','ﻔ'],
        'ق':['ﻕ','ﻖ','ﻗ','ﻘ'],
        'ك':['ﻙ','ﻚ','ﻛ','ﻜ'],
        'ل':['ﻝ','ﻞ','ﻟ','ﻠ'],
        'م':['ﻡ','ﻢ','ﻣ','ﻤ'],
        'ن':['ﻥ','ﻦ','ﻧ','ﻨ'],
        'ه':['ﻩ','ﻪ','ﻫ','ﻬ'],
        'و':['ﻭ','ﻮ',null,null],
        'ى':['ﻯ','ﻰ',null,null],
        'ي':['ﻱ','ﻲ','ﻳ','ﻴ'],
    };
    // Letters that only connect to the right (no initial/medial form with next letter)
    var _AR_RJOIN = {'ء':1,'آ':1,'أ':1,'ؤ':1,'إ':1,'ا':1,'ة':1,'د':1,'ذ':1,'ر':1,'ز':1,'و':1,'ى':1};

    function _isAr(ch) { var c = ch.charCodeAt(0); return (c >= 0x0600 && c <= 0x06FF) || (c >= 0xFE70 && c <= 0xFEFF); }

    // Reshape Arabic text and reverse for LTR jsPDF rendering
    function _reshapeAr(text) {
        if (!text) return '';
        var chars = Array.from(String(text));
        var out = [];
        for (var i = 0; i < chars.length; i++) {
            var ch = chars[i];
            var forms = _AR_FORMS[ch];
            if (!forms) { out.push(ch); continue; }
            var prevConn = i > 0 && _isAr(chars[i-1]) && !_AR_RJOIN[chars[i-1]];
            var nextConn = i < chars.length-1 && _isAr(chars[i+1]) && !!_AR_FORMS[chars[i+1]];
            var fi = (!prevConn && !nextConn) ? 0 : (!prevConn && nextConn) ? 2 : (prevConn && nextConn) ? 3 : 1;
            out.push(forms[fi] !== null && forms[fi] !== undefined ? forms[fi] : (forms[0] || ch));
        }
        return out.reverse().join('');
    }

    // Cache the font ArrayBuffer once loaded
    var _arFontBase64 = null;

    async function _loadArFont(doc) {
        if (!_arFontBase64) {
            var urls = [
                '/assets/fonts/Amiri-Regular.ttf',
                'https://cdn.jsdelivr.net/npm/amiri@0.113.0/Amiri-Regular.ttf',
            ];
            var buf = null;
            for (var i = 0; i < urls.length && !buf; i++) {
                try {
                    var r = await fetch(urls[i]);
                    if (r.ok) buf = await r.arrayBuffer();
                } catch(e) {}
            }
            if (!buf) throw new Error('Impossible de charger la police Amiri. Vérifiez votre connexion.');
            // Convert ArrayBuffer to base64
            var bytes = new Uint8Array(buf);
            var binary = '';
            for (var j = 0; j < bytes.byteLength; j++) binary += String.fromCharCode(bytes[j]);
            _arFontBase64 = window.btoa(binary);
        }
        doc.addFileToVFS('Amiri-Regular.ttf', _arFontBase64);
        doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal');
    }

    // Arabic label map
    var _AR = {
        companyName:    _reshapeAr('بيري قود فارمز'),
        bulletinTitle:  _reshapeAr('كشف الراتب'),
        salarie:        _reshapeAr('بيانات الموظف'),
        identification: _reshapeAr('التعريف'),
        nom:            _reshapeAr('الاسم'),
        prenom:         _reshapeAr('اللقب'),
        equipe:         _reshapeAr('الفريق'),
        categorie:      _reshapeAr('الفئة'),
        matricule:      _reshapeAr('رقم التسجيل'),
        cin:            _reshapeAr('رقم بطاقة التعريف'),
        cnss:           _reshapeAr('رقم CNSS'),
        cnssEmp:        _reshapeAr('رقم CNSS المشغل'),
        ouvrierCnss:    _reshapeAr('عامل مصرح CNSS'),
        ouvrierSansCnss:_reshapeAr('عامل غير مصرح'),
        code:           _reshapeAr('الرمز'),
        designation:    _reshapeAr('البيان'),
        base:           _reshapeAr('الأساس'),
        taux:           _reshapeAr('النسبة'),
        gain:           _reshapeAr('المكسب'),
        retenu:         _reshapeAr('المقتطع'),
        salaireBase:    _reshapeAr('الراتب الأساسي'),
        primeAnc:       _reshapeAr('علاوة الأقدمية'),
        totalTraitements:_reshapeAr('مجموع الأجور'),
        primeFonction:  _reshapeAr('علاوة المهمة'),
        totalIndemnites:_reshapeAr('مجموع التعويضات'),
        indemNi:        _reshapeAr('تعويضات غير خاضعة'),
        indemTransport: _reshapeAr('تعويض النقل'),
        totalNi:        _reshapeAr('مجموع غير خاضع'),
        cnssRet:        _reshapeAr('اشتراك CNSS'),
        amo:            _reshapeAr('اشتراك AMO'),
        totalRetenues:  _reshapeAr('مجموع الاشتراكات'),
        ir:             _reshapeAr('الضريبة على الدخل'),
        totalImpots:    _reshapeAr('مجموع الضرائب'),
        avances:        _reshapeAr('السلفات'),
        avanceTransp:   _reshapeAr('سلفة النقل'),
        totalAvances:   _reshapeAr('مجموع السلفات'),
        arrondi:        _reshapeAr('التقريب'),
        totaux:         _reshapeAr('المجاميع'),
        netAPayer:      _reshapeAr('الصافي للصرف'),
        cumuls:         _reshapeAr('مجاميع الفترة'),
        joursTravailles:_reshapeAr('أيام العمل'),
        brutImposable:  _reshapeAr('الأجر الإجمالي'),
        netImposable:   _reshapeAr('الصافي الخاضع'),
        retSociales:    _reshapeAr('الاشتراكات'),
        impotIr:        _reshapeAr('الضريبة'),
        conge:          _reshapeAr('وضعية الإجازة'),
        soldePrev:      _reshapeAr('رصيد سنة سابقة'),
        droitEnc:       _reshapeAr('حق السنة الجارية'),
        congePris:      _reshapeAr('إجازة مأخوذة'),
        soldeConge:     _reshapeAr('رصيد الإجازة'),
        sitF:           _reshapeAr('وضع عائلي'),
        nbEnf:          _reshapeAr('عدد الأطفال'),
        deduc:          _reshapeAr('تخفيضات'),
        dateNaiss:      _reshapeAr('تاريخ الميلاد'),
        dateEntree:     _reshapeAr('تاريخ الالتحاق'),
        salBase:        _reshapeAr('الأجر الأساسي'),
        salHoraire:     _reshapeAr('الأجر الساعي'),
        periodePaie:    _reshapeAr('فترة الأجر'),
        de:             _reshapeAr('من'),
        au_:            _reshapeAr('إلى'),
        periode_:       _reshapeAr('الفترة'),
        congeAu:        _reshapeAr('وضعية الإجازة بتاريخ'),
    };

    // Helper: reshape dynamic text (worker names, equipe, etc.)
    function _ar(text) { return _reshapeAr(String(text || '—')); }

    async function genBulletinsAr(workers, periode, smagBrutJournalier, options) {
        if (!workers || workers.length === 0) { alert('Aucun ouvrier déclaré pour cette période.'); return; }

        // Lazy-load html2canvas
        if (!window.html2canvas) {
            await new Promise(function(resolve, reject) {
                var s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                s.onload = resolve;
                s.onerror = function() { reject(new Error('Impossible de charger html2canvas.')); };
                document.head.appendChild(s);
            });
        }

        var TAUX_CNSS = 0.0448;
        var TAUX_AMO  = 0.0226;

        function fmtDHAr(n) {
            return Number(n || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        }
        function fmtDateAr(dateStr) {
            if (!dateStr) return '';
            var d = new Date(dateStr);
            return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
        }

        var ENTREPRISE = {
            nom: 'BERRY GOOD FARMS', forme: 'Sarl au capital de 100 000,00 Dhs',
            adresse1: '44 Imm. A, Rés. Al Boustane, cité Dakhla - Agadir',
            tp: '67500683', rc: '38125', if_: '26107029', ice: '002106859000069', noCnss: '3633882',
        };

        var periodeLabel;
        if (options && options.dateDebut && options.dateFin) {
            periodeLabel = 'من ' + fmtDateAr(options.dateDebut) + ' إلى ' + fmtDateAr(options.dateFin);
        } else {
            periodeLabel = 'الفترة : ' + String(periode || '');
        }

        function buildHtml(w) {
            var jours            = w.journees || 0;
            var dailyRate        = smagBrutJournalier || 0;
            var sHoraire         = dailyRate / 8;
            var smagBaseTotal    = dailyRate * jours;
            var primeFonctionTot = (w.primeFonctionJour || 0) * jours;
            var ancPct           = w.anciennetePct || 0;
            var ancBase          = smagBaseTotal + primeFonctionTot;
            var ancMontant       = ancBase * ancPct / 100;
            var brutTotal        = smagBaseTotal + ancMontant + primeFonctionTot;
            var transportTotal   = w.transportTotal || 0;
            var cnssRetenue      = brutTotal * TAUX_CNSS;
            var amoRetenue       = brutTotal * TAUX_AMO;
            var totalRetenues    = cnssRetenue + amoRetenue;
            var netImposable     = brutTotal - totalRetenues;
            var netAPayer        = Math.round(netImposable);
            var hasTransport     = transportTotal > 0;

            var payRows = '';
            payRows += '<tr><td>111</td><td>الراتب الأساسي</td><td>' + fmtDHAr(dailyRate) + '</td><td>' + jours + '</td><td>' + fmtDHAr(smagBaseTotal) + '</td><td></td></tr>';
            if (ancPct > 0) {
                payRows += '<tr><td>121</td><td>علاوة الأقدمية</td><td>' + fmtDHAr(ancBase) + '</td><td>' + ancPct + '%</td><td>' + fmtDHAr(ancMontant) + '</td><td></td></tr>';
            }
            payRows += '<tr class="subtotal"><td></td><td>مجموع الأجور</td><td></td><td></td><td>' + fmtDHAr(smagBaseTotal + ancMontant) + '</td><td></td></tr>';
            if (primeFonctionTot > 0) {
                payRows += '<tr><td>499</td><td>علاوة المهمة</td><td></td><td></td><td>' + fmtDHAr(primeFonctionTot) + '</td><td></td></tr>';
            }
            payRows += '<tr class="subtotal"><td></td><td>مجموع التعويضات</td><td></td><td></td><td>' + fmtDHAr(primeFonctionTot) + '</td><td></td></tr>';
            if (hasTransport) {
                payRows += '<tr class="ni-header"><td></td><td colspan="5">تعويضات غير خاضعة للضريبة</td></tr>';
                payRows += '<tr><td></td><td>تعويض النقل</td><td>' + fmtDHAr(w.transportJour||0) + '</td><td>' + jours + '</td><td>' + fmtDHAr(transportTotal) + '</td><td></td></tr>';
                payRows += '<tr class="subtotal ni"><td></td><td>مجموع غير خاضع</td><td></td><td></td><td>' + fmtDHAr(transportTotal) + '</td><td></td></tr>';
            }
            payRows += '<tr><td>601</td><td>اشتراك CNSS</td><td>' + fmtDHAr(brutTotal) + '</td><td>4,48%</td><td></td><td>' + fmtDHAr(cnssRetenue) + '</td></tr>';
            payRows += '<tr><td>631</td><td>اشتراك AMO</td><td>' + fmtDHAr(brutTotal) + '</td><td>2,26%</td><td></td><td>' + fmtDHAr(amoRetenue) + '</td></tr>';
            payRows += '<tr class="subtotal"><td></td><td>مجموع الاشتراكات</td><td></td><td></td><td></td><td>' + fmtDHAr(totalRetenues) + '</td></tr>';
            payRows += '<tr><td>792</td><td>الضريبة على الدخل (IR)</td><td>' + fmtDHAr(netImposable) + '</td><td></td><td></td><td>0,00</td></tr>';
            payRows += '<tr class="subtotal"><td></td><td>مجموع الضرائب</td><td></td><td></td><td></td><td>0,00</td></tr>';
            if (hasTransport) {
                payRows += '<tr class="av-header"><td></td><td colspan="5">السلفات المقبوضة</td></tr>';
                payRows += '<tr><td></td><td>سلفة النقل</td><td></td><td></td><td></td><td>' + fmtDHAr(transportTotal) + '</td></tr>';
                payRows += '<tr class="subtotal av"><td></td><td>مجموع السلفات</td><td></td><td></td><td></td><td>' + fmtDHAr(transportTotal) + '</td></tr>';
            }
            payRows += '<tr class="total"><td></td><td>المجاميع</td><td></td><td></td><td>' + fmtDHAr(brutTotal + transportTotal) + '</td><td>' + fmtDHAr(totalRetenues + transportTotal) + '</td></tr>';
            payRows += '<tr class="net"><td></td><td>الصافي للصرف</td><td></td><td></td><td class="net-amount">' + fmtDHAr(netAPayer) + '</td><td></td></tr>';

            return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
                '<link rel="preconnect" href="https://fonts.googleapis.com">' +
                '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
                '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">' +
                '<style>' +
                '* { margin:0; padding:0; box-sizing:border-box; }' +
                'body { font-family: Cairo, Arial, sans-serif; font-size: 9pt; color: #111; background:#fff; width:210mm; }' +
                '.page { width:210mm; min-height:297mm; padding:8mm 10mm; }' +
                /* Header */
                '.header { background:#F8F0F8; padding:6mm 4mm; display:flex; align-items:center; gap:8mm; margin-bottom:3mm; }' +
                '.header img { width:28mm; height:18mm; object-fit:contain; }' +
                '.header-info { flex:1; }' +
                '.company-name { color:#90278F; font-size:13pt; font-weight:700; }' +
                '.company-sub { font-size:7.5pt; color:#333; margin-top:1mm; }' +
                /* Title banner */
                '.title-bar { background:#90278F; color:#fff; text-align:center; padding:3mm; font-size:12pt; font-weight:700; margin-bottom:3mm; border-radius:2px; display:flex; justify-content:space-between; align-items:center; }' +
                '.title-bar .periode { font-size:8pt; font-weight:400; }' +
                /* Employee info */
                '.info-grid { display:grid; grid-template-columns:1fr 1fr; gap:3mm; margin-bottom:3mm; }' +
                '.info-box { background:#F8F0F8; padding:3mm; }' +
                '.info-box-header { background:#82B33A; color:#fff; padding:2mm 3mm; font-size:8pt; font-weight:700; margin-bottom:2mm; }' +
                '.info-row { display:flex; gap:2mm; font-size:8pt; padding:0.5mm 0; }' +
                '.info-label { font-weight:600; white-space:nowrap; }' +
                '.info-value { color:#333; }' +
                /* Salary base row */
                'table { width:100%; border-collapse:collapse; margin-bottom:3mm; font-size:8pt; }' +
                'th { background:#EFEFEF; padding:2mm; font-weight:600; border:1px solid #ccc; text-align:center; font-size:7.5pt; }' +
                'td { padding:2mm; border:1px solid #ddd; text-align:center; }' +
                /* Pay lines */
                '.pay-table td:nth-child(2) { text-align:right; }' +
                '.pay-table td:nth-child(1) { text-align:center; width:10mm; }' +
                '.pay-table td:nth-child(3), .pay-table td:nth-child(4), .pay-table td:nth-child(5), .pay-table td:nth-child(6) { text-align:left; direction:ltr; }' +
                'tr.subtotal td { background:#EFEFEF; font-weight:600; }' +
                'tr.total td { background:#DCE6DC; font-weight:700; }' +
                'tr.net td { background:#DCE6DC; font-weight:700; }' +
                'td.net-amount { color:#C0392B; font-size:10pt; font-weight:700; }' +
                'tr.ni-header td { background:#E6F4FF; color:#3449AB; font-weight:600; }' +
                'tr.av-header td { background:#FFEBEB; color:#C0392B; font-weight:600; }' +
                'tr.ni.subtotal td { background:#F0F8FF; }' +
                'tr.av.subtotal td { background:#FFF5F5; color:#C0392B; }' +
                '.section-label { font-size:8pt; font-weight:700; margin:2mm 0 1mm; }' +
                '</style></head><body><div class="page">' +

                /* Header */
                '<div class="header">' +
                (w._logoDataUrl ? '<img src="' + w._logoDataUrl + '" alt="logo">' : '') +
                '<div class="header-info">' +
                '<div class="company-name">بيري قود فارمز — BERRY GOOD FARMS</div>' +
                '<div class="company-sub">' + ENTREPRISE.forme + '</div>' +
                '<div class="company-sub">' + ENTREPRISE.adresse1 + '</div>' +
                '<div class="company-sub">TP: ' + ENTREPRISE.tp + ' | RC: ' + ENTREPRISE.rc + ' | IF: ' + ENTREPRISE.if_ + ' | ICE: ' + ENTREPRISE.ice + '</div>' +
                '</div></div>' +

                /* Title */
                '<div class="title-bar"><span class="periode">' + periodeLabel + '</span><span>كشف الراتب</span></div>' +

                /* Employee info */
                '<div class="info-grid">' +
                '<div class="info-box"><div class="info-box-header">بيانات الموظف</div>' +
                '<div class="info-row"><span class="info-label">الاسم الكامل :</span><span class="info-value">' + (w.nom || '—').toUpperCase() + (w.prenom ? ' ' + w.prenom : '') + '</span></div>' +
                '<div class="info-row"><span class="info-label">الفريق :</span><span class="info-value">' + (w.equipe || '—') + '</span></div>' +
                '<div class="info-row"><span class="info-label">الفئة :</span><span class="info-value">' + (w.declare ? 'عامل مصرح CNSS' : 'عامل غير مصرح') + '</span></div>' +
                '</div>' +
                '<div class="info-box"><div class="info-box-header">التعريف</div>' +
                '<div class="info-row"><span class="info-label">رقم التسجيل :</span><span class="info-value">' + (w.matricule || '—') + '</span></div>' +
                '<div class="info-row"><span class="info-label">رقم بطاقة التعريف :</span><span class="info-value">' + (w.cin || '—') + '</span></div>' +
                '<div class="info-row"><span class="info-label">رقم CNSS :</span><span class="info-value">' + (w.cnss || '—') + '</span></div>' +
                '<div class="info-row"><span class="info-label">رقم CNSS المشغل :</span><span class="info-value">' + ENTREPRISE.noCnss + '</span></div>' +
                '</div></div>' +

                /* Salary base row */
                '<table><thead><tr>' +
                '<th>وضع عائلي</th><th>عدد الأطفال</th><th>تخفيضات</th><th>تاريخ الميلاد</th><th>تاريخ الالتحاق</th><th>الأجر الأساسي</th><th>الأجر الساعي</th><th>فترة الأجر</th>' +
                '</tr></thead><tbody><tr>' +
                '<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>' +
                '<td style="direction:ltr">' + fmtDHAr(dailyRate) + '</td>' +
                '<td style="direction:ltr">' + fmtDHAr(sHoraire) + '</td>' +
                '<td>' + periodeLabel + '</td>' +
                '</tr></tbody></table>' +

                /* Pay lines */
                '<table class="pay-table"><thead><tr>' +
                '<th>الرمز</th><th>البيان</th><th>الأساس</th><th>النسبة</th><th>المكسب</th><th>المقتطع</th>' +
                '</tr></thead><tbody>' + payRows + '</tbody></table>' +

                /* Cumuls */
                '<div class="section-label">مجاميع الفترة</div>' +
                '<table><thead><tr>' +
                '<th>أيام العمل</th><th>الأجر الإجمالي</th><th>الصافي الخاضع</th><th>الاشتراكات</th><th>الضريبة (IR)</th>' +
                '</tr></thead><tbody><tr>' +
                '<td>' + jours + '</td>' +
                '<td style="direction:ltr">' + fmtDHAr(brutTotal) + '</td>' +
                '<td style="direction:ltr">' + fmtDHAr(netAPayer) + '</td>' +
                '<td style="direction:ltr">' + fmtDHAr(totalRetenues) + '</td>' +
                '<td>0,00</td>' +
                '</tr></tbody></table>' +

                /* Congés */
                '<div class="section-label">وضعية الإجازة — ' + periodeLabel + '</div>' +
                '<table><thead><tr>' +
                '<th>رصيد سنة سابقة</th><th>حق السنة الجارية</th><th>إجازة مأخوذة</th><th>رصيد الإجازة</th>' +
                '</tr></thead><tbody><tr><td>—</td><td>—</td><td>—</td><td>—</td></tr></tbody></table>' +

                '</div></body></html>';
        }

        // Load logo once
        var logoDataUrl = null;
        try {
            var resp = await fetch('/assets/icon-512.png');
            var blob = await resp.blob();
            logoDataUrl = await new Promise(function(resolve) {
                var reader = new FileReader();
                reader.onloadend = function() { resolve(reader.result); };
                reader.readAsDataURL(blob);
            });
        } catch(e) {}

        // Create hidden iframe for rendering
        var iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:794px;height:1123px;border:none;visibility:hidden;';
        document.body.appendChild(iframe);

        var doc = newDoc();
        var isFirst = true;

        for (var i = 0; i < workers.length; i++) {
            var w = Object.assign({}, workers[i], { _logoDataUrl: logoDataUrl });
            var html = buildHtml(w);

            // Write HTML into iframe
            iframe.contentDocument.open();
            iframe.contentDocument.write(html);
            iframe.contentDocument.close();

            // Wait for fonts to load
            await new Promise(function(resolve) { setTimeout(resolve, 600); });

            // Capture
            var canvas = await window.html2canvas(iframe.contentDocument.body, {
                scale: 2,
                useCORS: true,
                allowTaint: false,
                backgroundColor: '#ffffff',
                width: 794,
                height: 1123,
                windowWidth: 794,
                windowHeight: 1123,
            });

            if (!isFirst) doc.addPage();
            isFirst = false;
            doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
        }

        document.body.removeChild(iframe);

        var periodeSafe = (periode || 'quinzaine').replace(/[^a-zA-Z0-9_-]/g, '_');
        download(doc, 'Bulletins_Paie_AR_' + periodeSafe + '.pdf');
    }

    window.EmargementPdf = { genSansCnss: genSansCnss, genAvecCnss: genAvecCnss, genTransporteurs: genTransporteurs, genBulletins: genBulletins, genBulletinsAr: genBulletinsAr };
})();
