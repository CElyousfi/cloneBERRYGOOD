function _xlsxAvailable() { return typeof XLSX !== 'undefined' && !!XLSX; }

function _buildAndDownload(rows, colWidths, sheetName, filename) {
    if (!_xlsxAvailable()) { alert('SheetJS non chargé — rafraîchissez la page.'); return; }
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = colWidths.map(function(w) { return { wch: w }; });
    // Fusion de la ligne de titre (ligne 0) sur toutes les colonnes
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: colWidths.length - 1 } }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
}

function genSansCnssXlsx(workers, periode) {
    var rows = [
        ['ÉTAT D\'ÉMARGEMENT — OUVRIERS SANS CNSS — ' + (periode || '')],
        ['Matricule', 'Nom et Prénom', 'Équipe', 'Nb Jours', 'Net à payer (DH)', 'Émargement'],
    ];
    (workers || []).forEach(function(w) {
        rows.push([
            w.matricule || '',
            w.nom || '',
            w.equipe || '',
            w.journees || 0,
            Number(w.net || 0),
            '',
        ]);
    });
    var total = (workers || []).reduce(function(s, w) { return s + (w.net || 0); }, 0);
    rows.push(['', '', 'TOTAL', (workers || []).reduce(function(s,w){return s+(w.journees||0);},0), Number(total), '']);
    _buildAndDownload(rows, [14, 28, 20, 10, 18, 20], 'Sans CNSS', 'Emargement_Sans_CNSS_' + (periode || 'periode') + '.xlsx');
}

function genAvecCnssXlsx(workers, periode) {
    var rows = [
        ['ÉTAT D\'ÉMARGEMENT — OUVRIERS DÉCLARÉS CNSS — ' + (periode || '')],
        ['Matricule', 'Nom et Prénom', 'Équipe', 'Nb Jours', 'Net à payer (DH)', 'Émargement'],
    ];
    (workers || []).forEach(function(w) {
        rows.push([
            w.matricule || '',
            w.nom || '',
            w.equipe || '',
            w.journees || 0,
            Number(w.net || 0),
            '',
        ]);
    });
    var total = (workers || []).reduce(function(s, w) { return s + (w.net || 0); }, 0);
    rows.push(['', '', 'TOTAL', (workers || []).reduce(function(s,w){return s+(w.journees||0);},0), Number(total), '']);
    _buildAndDownload(rows, [14, 28, 20, 10, 18, 20], 'Déclarés CNSS', 'Emargement_Declares_' + (periode || 'periode') + '.xlsx');
}

function genTransporteursXlsx(equipes, periode) {
    var rows = [
        ['ÉTAT D\'ÉMARGEMENT — TRANSPORT PERSONNEL — ' + (periode || '')],
        ['Équipe', 'Caporal', 'Coût/place (DH)', 'Nb JH', 'Montant (DH)', 'Émargement'],
    ];
    (equipes || []).forEach(function(e) {
        rows.push([
            e.equipe || '',
            e.caporal || '',
            Number(e.coutParOuvrier || 0),
            e.nbJH || 0,
            Number(e.montant || 0),
            '',
        ]);
    });
    var total = (equipes || []).reduce(function(s, e) { return s + (e.montant || 0); }, 0);
    rows.push(['', 'TOTAL', '', (equipes || []).reduce(function(s,e){return s+(e.nbJH||0);},0), Number(total), '']);
    _buildAndDownload(rows, [22, 24, 16, 10, 16, 20], 'Transporteurs', 'Emargement_Transporteurs_' + (periode || 'periode') + '.xlsx');
}

function genBulletinsXlsx(workers, periode) {
    var rows = [
        ['BULLETINS DE PAIE — OUVRIERS DÉCLARÉS CNSS — ' + (periode || '')],
        ['Matricule', 'Nom et Prénom', 'Équipe', 'Journées', 'Salaire Base (DH)', 'Prime Fonction (DH)', 'Ancienneté %', 'Ancienneté (DH)', 'Brut (DH)', 'CNSS 4,48% (DH)', 'AMO 2,26% (DH)', 'Net à payer (DH)'],
    ];
    (workers || []).forEach(function(w) {
        var brut = w.brut || 0;
        var cnss = Math.round(brut * 0.0448);
        var amo  = Math.round(brut * 0.0226);
        rows.push([
            w.matricule || '',
            w.nom || '',
            w.equipe || '',
            w.journees || 0,
            Number(w.salaireBase || 0),
            Number(w.primeFonctionTotal || 0),
            (w.anciennetePct || 0) + '%',
            Number(w.ancienneteTotal || 0),
            Number(brut),
            Number(cnss),
            Number(amo),
            Number(w.net || 0),
        ]);
    });
    var sumOf = function(key) { return (workers || []).reduce(function(s,w){return s+(w[key]||0);},0); };
    var totalBrut = sumOf('brut');
    rows.push([
        '', '', 'TOTAL', sumOf('journees'),
        Number(sumOf('salaireBase')), Number(sumOf('primeFonctionTotal')), '',
        Number(sumOf('ancienneteTotal')), Number(totalBrut),
        Number(Math.round(totalBrut * 0.0448)), Number(Math.round(totalBrut * 0.0226)),
        Number(sumOf('net')),
    ]);
    _buildAndDownload(rows, [14, 28, 18, 10, 18, 18, 12, 16, 14, 16, 14, 16], 'Bulletins', 'Bulletins_Paie_' + (periode || 'periode') + '.xlsx');
}

export { genSansCnssXlsx, genAvecCnssXlsx, genTransporteursXlsx, genBulletinsXlsx };
