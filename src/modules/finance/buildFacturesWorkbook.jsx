/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): buildFacturesWorkbook */


// ===================== ACHATS: FACTURES TAB =====================
        // Construit + télécharge un classeur Excel des factures (récap + détail
        // articles). Lecture seule : ne lit que la liste déjà filtrée à l'écran.
        // La logique métier (TVA par ligne, garde-fou, réconciliation) vit dans
        // FactureExportUtils.
        //
        // Formatage : on écrit de VRAIES cellules numériques/date (numFmt via
        // cell.z) + autofilter + largeurs de colonnes. SheetJS community (build
        // CDN xlsx.full.min) ne supporte PAS le style riche (gras, couleurs) :
        // c'est une limite de la lib, documentée. On met les vrais formats +
        // l'autofilter, prioritaires pour un fichier transmissible à un comptable.
        function buildFacturesWorkbook(factures, opts) {
            opts = opts || {};
            const FE = window.FactureExportUtils;
            const list = Array.isArray(factures) ? factures : [];
            // Filtre campagne optionnel (bornes paramétrables, pas de hardcode).
            let scoped = list;
            if (opts.campaignStartYear != null) {
                const { start, end } = FE.campaignBounds(opts.campaignStartYear);
                scoped = list.filter(f => FE.isWithinPeriod(f.date_facture, start, end));
            }
            const NUM_FMT = '# ##0.00';       // monnaie : séparateur de milliers + 2 déc.
            const PCT_FMT = '0%';             // taux TVA entier (0% / 20%)
            const DATE_FMT = 'dd/mm/yyyy';
            const statusLabels = { non_payee: 'Non payée', en_validation: 'En validation', validee_achats: 'Validée Achats', validee_finance: 'Validée Finance', validee_dg: 'Validée DG', payee: 'Payée' };

            // -- Constructeurs de cellules typées --
            const txt = (v) => ({ t: 's', v: v == null ? '' : String(v) });
            const num = (v, z) => ({ t: 'n', v: Number(v) || 0, z: z || NUM_FMT });
            const cnt = (v) => ({ t: 'n', v: Number(v) || 0 });
            const dateCell = (dStr) => {
                const d = FE.parseFactureDate(dStr);
                if (!d) return txt(dStr || '');
                return { t: 'd', v: d, z: DATE_FMT };
            };

            // Construit une worksheet à partir d'une matrice de cellules typées
            // (objets cellule ou primitives → coercées en cellules texte).
            const buildSheet = (matrix, cols, autofilterRange) => {
                const aoa = matrix.map(row => row.map(c => {
                    if (c && typeof c === 'object' && 't' in c) return c.v;
                    return c == null ? '' : c;
                }));
                const ws = XLSX.utils.aoa_to_sheet(aoa);
                // Réinjecte le typage (t/z) cellule par cellule.
                matrix.forEach((row, r) => row.forEach((c, k) => {
                    if (c && typeof c === 'object' && 't' in c) {
                        const ref = XLSX.utils.encode_cell({ r, c: k });
                        if (!ws[ref]) ws[ref] = {};
                        ws[ref].t = c.t;
                        ws[ref].v = c.v;
                        if (c.z) ws[ref].z = c.z;
                    }
                }));
                if (cols) ws['!cols'] = cols;
                if (autofilterRange) ws['!autofilter'] = { ref: autofilterRange };
                return ws;
            };

            // --- Onglet 1 : Récap Factures ---
            const recapHeader = ['N° Interne', 'N° Facture', 'BDC', 'Fournisseur', 'Date', 'Total HT', 'TVA', 'Total TTC', 'Écarts', 'Anomalie TVA', 'Statut paiement'];
            const recap = [recapHeader.map(txt)];
            let sHt = 0, sTva = 0, sTtc = 0, nbAnomalies = 0;
            scoped.forEach(f => {
                const ht = Number(f.total_ht) || 0, tva = Number(f.total_tva) || 0, ttc = Number(f.total_ttc) || 0;
                sHt += ht; sTva += tva; sTtc += ttc;
                const ecarts = f.has_discrepancies ? ((f.discrepancies || []).length + ' écart(s)') : 'OK';
                const { reconciled, anomalieLabel } = FE.buildFactureLines(f);
                if (!reconciled) nbAnomalies++;
                recap.push([
                    txt(f.numero || ''), txt(f.numero_facture || ''), txt(f.bdc_numero || ''),
                    txt((f.fournisseur && f.fournisseur.nom) || ''), dateCell(f.date_facture),
                    num(ht), num(tva), num(ttc), txt(ecarts),
                    txt(reconciled ? '' : anomalieLabel),
                    txt(statusLabels[f.payment_status] || f.payment_status || ''),
                ]);
            });
            recap.push([txt('TOTAL'), txt(''), txt(''), txt(''), txt(''), num(sHt), num(sTva), num(sTtc), txt(''), txt(''), txt('')]);
            const lastDataRow = recap.length; // 1-based row of header is 1; autofilter spans header..last facture row
            // Récap par statut — helper PUR partagé (FactureExportUtils) qui aligne
            // "Nombre" sous TVA (idx 6) et le montant sous "Total TTC" (idx 7) sur
            // 11 colonnes. Sans cet alignement, les valeurs débordaient sur la
            // colonne "Fournisseur" (idx 3) et le montant manquait sous l'en-tête
            // "Total TTC" (bug DG corrigé v5fix). Conversion des descripteurs
            // neutres → cellules typées SheetJS.
            const toCell = (d) => d.kind === 'num' ? num(d.v) : d.kind === 'cnt' ? cnt(d.v) : txt(d.v);
            recap.push([]);
            FE.buildRecapStatutRows(scoped, statusLabels).forEach(r => recap.push(r.map(toCell)));

            const recapCols = [{ wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
            // Autofilter sur l'en-tête + les lignes factures (hors TOTAL/récap statut).
            const recapFilterRef = 'A1:' + XLSX.utils.encode_cell({ r: lastDataRow - 1, c: recapHeader.length - 1 });

            // --- Onglet 2 : Détail Articles (TVA par ligne, règle TIMAC) ---
            const detailHeader = ['N° Facture', 'Fournisseur', 'Date', 'Désignation', 'Quantité', 'PU HT', 'Montant HT', 'Taux TVA', 'Source taux', 'Montant TVA', 'Montant TTC', 'Réconciliation'];
            const detail = [detailHeader.map(txt)];
            scoped.forEach(f => {
                const { lines, anomalieLabel } = FE.buildFactureLines(f);
                lines.forEach(ln => {
                    detail.push([
                        txt(f.numero_facture || f.numero || ''),
                        txt((f.fournisseur && f.fournisseur.nom) || ''),
                        dateCell(f.date_facture),
                        txt(ln.designation),
                        ln.quantite ? cnt(ln.quantite) : txt(''),
                        ln.prix_unitaire ? num(ln.prix_unitaire) : txt(''),
                        num(ln.montant_ht),
                        ln.taux_tva == null ? txt('—') : num(ln.taux_tva, PCT_FMT),
                        txt(ln.taux_source === 'saisi' ? 'Saisi' : 'Non déterminé'),
                        ln.montant_tva == null ? txt('—') : num(ln.montant_tva),
                        ln.montant_ttc == null ? txt('—') : num(ln.montant_ttc),
                        txt(ln.reconciled ? 'OK' : anomalieLabel),
                    ]);
                });
            });
            const detailCols = [{ wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 14 }, { wch: 40 }];
            const detailFilterRef = 'A1:' + XLSX.utils.encode_cell({ r: detail.length - 1, c: detailHeader.length - 1 });

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, buildSheet(recap, recapCols, recapFilterRef), 'Récap Factures');
            XLSX.utils.book_append_sheet(wb, buildSheet(detail, detailCols, detailFilterRef), 'Détail Articles');

            const safe = String(opts.filterLabel || 'Toutes').replace(/[^\w-]+/g, '-');
            XLSX.writeFile(wb, 'Factures_' + safe + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
            return { nbAnomalies, count: scoped.length };
        }

export { buildFacturesWorkbook };
