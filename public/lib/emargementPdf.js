'use strict';
(function () {
    var C = {
        berry: [192, 57, 43],
        green: [29, 158, 117],
        gray:  [102, 102, 102],
        lightGray: [240, 240, 240],
        white: [255, 255, 255],
        black: [0, 0, 0],
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
                0: { cellWidth: 22 },
                1: { cellWidth: 60 },
                2: { cellWidth: 28 },
                3: { cellWidth: 20, halign: 'center' },
                4: { cellWidth: 28, halign: 'right' },
                5: { cellWidth: 35 },
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
                0: { cellWidth: 22 },
                1: { cellWidth: 60 },
                2: { cellWidth: 28 },
                3: { cellWidth: 20, halign: 'center' },
                4: { cellWidth: 28, halign: 'right' },
                5: { cellWidth: 35 },
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
                0: { cellWidth: 42 },
                1: { cellWidth: 42 },
                2: { cellWidth: 28, halign: 'right' },
                3: { cellWidth: 20, halign: 'center' },
                4: { cellWidth: 28, halign: 'right' },
                5: { cellWidth: 35 },
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
    // ─────────────────────────────────────────────────────────────────────────────
    function genBulletins(workers, periode, smagBrutJournalier) {
        // workers: [{
        //   matricule, nom, equipe, journees, declare,
        //   salaireBase,       // smagBrutJournalier × journees (déjà calculé dans app.jsx)
        //   primeFonctionTotal,
        //   primeFonctionJour,
        //   ancienneteTotal,
        //   anciennetePct,
        //   transportJour,
        //   transportTotal,
        //   brut,              // brut du modèle dashboard (non utilisé pour le calcul bulletin)
        // }]
        // Constantes entreprise
        var ENTREPRISE = {
            nom:       'Berry Good Farms',
            adresse:   'N44 IMMEUBLE A RESIDENCE AL BOSTAN CITE DAKHLA',
            noCnss:    '3633882',
            tel:       '',
            idFiscale: '',
            patente:   '',
            rc:        '',
        };

        // Taux légaux CNSS / AMO
        var TAUX_CNSS = 0.0448;
        var TAUX_AMO  = 0.0226;

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

            var y = 12;

            // ── BLOC 1 : Header entreprise (2 colonnes) ──
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(C.berry[0], C.berry[1], C.berry[2]);
            doc.text(ENTREPRISE.nom, 14, y);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(C.black[0], C.black[1], C.black[2]);
            doc.text(ENTREPRISE.adresse, 196, y, { align: 'right' });
            y += 5;

            doc.setFontSize(7.5);
            doc.setTextColor(C.gray[0], C.gray[1], C.gray[2]);
            if (ENTREPRISE.tel) { doc.text('Tél. : ' + ENTREPRISE.tel, 14, y); }
            doc.text('N° CNSS : ' + ENTREPRISE.noCnss, 196, y, { align: 'right' });
            y += 4;
            doc.text('ID. Fiscale : ' + (ENTREPRISE.idFiscale || ''), 196, y, { align: 'right' });
            y += 4;
            doc.text('Patente : ' + (ENTREPRISE.patente || ''), 196, y, { align: 'right' });
            y += 4;
            doc.text('R.C : ' + (ENTREPRISE.rc || ''), 196, y, { align: 'right' });
            y += 3;

            // Séparateur
            doc.setDrawColor(C.berry[0], C.berry[1], C.berry[2]);
            doc.setLineWidth(0.5);
            doc.line(14, y, 196, y);
            y += 6;

            // ── BLOC 2 : Titre ──
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(14);
            doc.setTextColor(C.black[0], C.black[1], C.black[2]);
            doc.text('BULLETIN DE PAIE', 105, y, { align: 'center' });
            y += 8;

            // ── BLOC 3 : Info salarié (2 lignes, style tableau) ──
            // Ligne 1 : Matricule | Nom et Prénom | Fonction | N° CNSS | N°CIN
            doc.autoTable({
                startY: y,
                head: [['MATR.', 'Nom et Prénom', 'Fonction', 'N° CNSS', 'N° CIN']],
                body: [[
                    String(w.matricule || '—'),
                    (w.nom || '—').toUpperCase(),
                    w.equipe || '—',
                    '—',
                    w.cin || '—',
                ]],
                styles:     { fontSize: 7.5, cellPadding: 2 },
                headStyles: { fillColor: C.lightGray, textColor: C.black, fontStyle: 'bold', fontSize: 7.5 },
                columnStyles: {
                    0: { cellWidth: 18 },
                    1: { cellWidth: 60 },
                    2: { cellWidth: 40 },
                    3: { cellWidth: 30 },
                    4: { cellWidth: 34 },
                },
                margin: { left: 14, right: 14 },
                theme: 'grid',
            });
            y = doc.lastAutoTable.finalY + 1;

            // Ligne 2 : Sit.F. | Nb.Enf. | Déduc. | Date Naiss. | Date Entrée | Sal.base | S.Horaire | Période
            doc.autoTable({
                startY: y,
                head: [['Sit. F.', 'Nb. Enf.', 'Déduc.', 'Date Naiss.', 'Date Entrée', 'Sal. de base', 'S. Horaire', 'Période Paie']],
                body: [[
                    '—', '—', '—', '—', '—',
                    fmtDH(dailyRate),
                    fmtDH(sHoraire),
                    periode || '—',
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
            doc.text('Situation congé au : ' + (periode || '—'), 14, y);
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

            // ── BLOC 7 : Réf. Règlement ──
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(C.black[0], C.black[1], C.black[2]);
            doc.text('Réf. Règlement', 14, y);
            y += 5;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.text('[ ] ESPECE     [ ] CHEQUE N° : ___________________________     [ ] VIREMENT DU : ___________________________', 14, y);
        });

        var periodeSafe = (periode || 'quinzaine').replace(/[^a-zA-Z0-9_-]/g, '_');
        download(doc, 'Bulletins_Paie_Declares_' + periodeSafe + '.pdf');
    }

    window.EmargementPdf = { genSansCnss: genSansCnss, genAvecCnss: genAvecCnss, genTransporteurs: genTransporteurs, genBulletins: genBulletins };
})();
