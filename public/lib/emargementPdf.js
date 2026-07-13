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
    // ─────────────────────────────────────────────────────────────────────────────
    function genBulletins(workers, periode, smagBrutJournalier) {
        // workers: [{
        //   matricule, nom, equipe, journees,
        //   brut,               // total brut = salaire de base + prime fonction + ancienneté
        //   salaireBase,        // smagBrutJournalier × journees
        //   primeFonctionTotal, // primeFonctionJour × journees (0 si aucune)
        //   ancienneteTotal,    // montant ancienneté
        //   anciennetePct,      // taux ancienneté en %
        //   primeFonctionJour,  // tarif journalier prime fonction
        //   transportJour,      // tarif transport journalier (0 si pas de transport)
        //   transportTotal,     // transportJour × journees
        // }]
        if (!workers || workers.length === 0) { alert('Aucun ouvrier déclaré pour cette période.'); return; }

        var doc = newDoc();
        if (!doc) return;
        var isFirst = true;

        workers.forEach(function (w) {
            if (!isFirst) doc.addPage();
            isFirst = false;

            var y = 14;

            // ── Header ──
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(C.berry[0], C.berry[1], C.berry[2]);
            doc.text('Berry Good Farms', 14, y);

            doc.setFontSize(13);
            doc.setTextColor(C.black[0], C.black[1], C.black[2]);
            doc.text('BULLETIN DE PAIE', 105, y, { align: 'center' });

            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(C.gray[0], C.gray[1], C.gray[2]);
            doc.text('Période : ' + (periode || '—'), 196, y, { align: 'right' });
            y += 5;

            doc.setDrawColor(C.berry[0], C.berry[1], C.berry[2]);
            doc.setLineWidth(0.5);
            doc.line(14, y, 196, y);
            y += 5;

            // ── Infos ouvrier ──
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(C.black[0], C.black[1], C.black[2]);
            doc.text('Matricule : ', 14, y);
            doc.setFont('helvetica', 'normal');
            doc.text(String(w.matricule || '—'), 38, y);

            doc.setFont('helvetica', 'bold');
            doc.text('Nom : ', 100, y);
            doc.setFont('helvetica', 'normal');
            doc.text((w.nom || '—').toUpperCase(), 112, y);
            y += 5;

            doc.setFont('helvetica', 'bold');
            doc.text('Équipe : ', 14, y);
            doc.setFont('helvetica', 'normal');
            doc.text(w.equipe || '—', 32, y);

            doc.setFont('helvetica', 'bold');
            doc.text('Nbr jours : ', 100, y);
            doc.setFont('helvetica', 'normal');
            doc.text(String(w.journees || 0), 120, y);
            y += 6;

            // ── Section Rémunération ──
            doc.setFillColor(C.berry[0], C.berry[1], C.berry[2]);
            doc.setTextColor(C.white[0], C.white[1], C.white[2]);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.rect(14, y, 182, 5, 'F');
            doc.text('RÉMUNÉRATION', 16, y + 3.5);
            y += 6;

            var remuRows = [];
            var _smagBrut = smagBrutJournalier || (w.journees > 0 ? (w.brut / w.journees) : 0);
            remuRows.push([
                'Salaire de base',
                String(w.journees || 0) + ' j × ' + fmtDH(_smagBrut) + ' DH',
                fmtDH(w.salaireBase || (_smagBrut * (w.journees || 0))) + ' DH',
            ]);
            if ((w.primeFonctionTotal || 0) > 0) {
                remuRows.push([
                    'Prime de fonction',
                    String(w.journees || 0) + ' j × ' + fmtDH(w.primeFonctionJour || 0) + ' DH',
                    fmtDH(w.primeFonctionTotal) + ' DH',
                ]);
            }
            if ((w.ancienneteTotal || 0) > 0) {
                remuRows.push([
                    'Majoration ancienneté (' + (w.anciennetePct || 0) + '%)',
                    '',
                    fmtDH(w.ancienneteTotal) + ' DH',
                ]);
            }

            doc.autoTable({
                startY: y,
                body: remuRows,
                styles: { fontSize: 8, cellPadding: 2 },
                columnStyles: {
                    0: { cellWidth: 90 },
                    1: { cellWidth: 60, halign: 'center', textColor: C.gray },
                    2: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
                },
                margin: { left: 14, right: 14 },
                theme: 'plain',
                showHead: false,
            });

            y = doc.lastAutoTable.finalY + 2;

            // Ligne BRUT
            doc.setDrawColor(C.gray[0], C.gray[1], C.gray[2]);
            doc.setLineWidth(0.3);
            doc.line(14, y, 196, y);
            y += 4;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(C.black[0], C.black[1], C.black[2]);
            doc.text('BRUT :', 14, y);
            doc.text(fmtDH(w.brut) + ' DH', 196, y, { align: 'right' });
            y += 6;

            // ── Section Transport (si applicable) ──
            if ((w.transportTotal || 0) > 0) {
                doc.setFillColor(52, 73, 171);
                doc.setTextColor(C.white[0], C.white[1], C.white[2]);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8);
                doc.rect(14, y, 182, 5, 'F');
                doc.text('INDEMNITÉS (non imposables)', 16, y + 3.5);
                y += 6;

                doc.setFont('helvetica', 'normal');
                doc.setTextColor(C.black[0], C.black[1], C.black[2]);
                doc.setFontSize(8);

                doc.text('Indemnité de transport', 16, y);
                doc.text(String(w.journees || 0) + ' j × ' + fmtDH(w.transportJour || 0) + ' DH', 106, y, { align: 'center' });
                doc.setFont('helvetica', 'bold');
                doc.text(fmtDH(w.transportTotal) + ' DH', 196, y, { align: 'right' });
                y += 7;

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(C.gray[0], C.gray[1], C.gray[2]);
                doc.text('Total brut + indemnités :', 14, y);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(C.black[0], C.black[1], C.black[2]);
                doc.text(fmtDH((w.brut || 0) + (w.transportTotal || 0)) + ' DH', 196, y, { align: 'right' });
                y += 7;
            }

            // ── Retenues (aucune dans le modèle validé) ──
            // Commenté selon modèle validé Omar 2026-06 : AUCUNE retenue salariale
            // CNSS salariale = 0 pour tous les ouvriers

            // ── Section Avances (transport) ──
            if ((w.transportTotal || 0) > 0) {
                doc.setFillColor(231, 76, 60);
                doc.setTextColor(C.white[0], C.white[1], C.white[2]);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8);
                doc.rect(14, y, 182, 5, 'F');
                doc.text('AVANCES', 16, y + 3.5);
                y += 6;

                doc.setFont('helvetica', 'normal');
                doc.setTextColor(C.black[0], C.black[1], C.black[2]);
                doc.setFontSize(8);
                doc.text('Avance transport (déjà versée)', 16, y);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(231, 76, 60);
                doc.text('- ' + fmtDH(w.transportTotal) + ' DH', 196, y, { align: 'right' });
                y += 7;
            }

            // ── NET À PAYER ──
            doc.setDrawColor(C.berry[0], C.berry[1], C.berry[2]);
            doc.setLineWidth(0.8);
            doc.line(14, y, 196, y);
            y += 5;

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(C.black[0], C.black[1], C.black[2]);
            doc.text('NET À PAYER :', 14, y);
            doc.setTextColor(C.berry[0], C.berry[1], C.berry[2]);
            doc.text(fmtDH(w.brut) + ' DH', 196, y, { align: 'right' });
            y += 8;

            // Note
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(7);
            doc.setTextColor(C.gray[0], C.gray[1], C.gray[2]);
            doc.text('* Modèle validé : aucune retenue salariale CNSS. Indemnité transport non imposable neutralisée par l\'avance.', 14, y);
        });

        var periodeSafe = (periode || 'quinzaine').replace(/[^a-zA-Z0-9_-]/g, '_');
        download(doc, 'Bulletins_Paie_Declares_' + periodeSafe + '.pdf');
    }

    window.EmargementPdf = { genSansCnss: genSansCnss, genAvecCnss: genAvecCnss, genTransporteurs: genTransporteurs, genBulletins: genBulletins };
})();
