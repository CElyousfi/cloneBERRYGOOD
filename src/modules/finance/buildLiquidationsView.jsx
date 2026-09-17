/* Module: finance | Déclaration(s): buildLiquidationsView */


// ===================== FIN LIQUIDATIONS TAB =====================
        // Transforms Firestore `liquidations` collection docs into the shape expected
        // by FinLiquidationsTab. No fallback to demo data — empty defaults if Firestore
        // has nothing yet. `factures`, `aVenir`, `planning` are filled by other fetches.
        function buildLiquidationsView(docs, selectedFruit) {
            const filtered = selectedFruit ? docs.filter(d => (d.fruit || 'framboise') === selectedFruit) : docs;
            const extractYear = (d) => {
                const m = (d.subject || '').match(/week\s*\d+[-\/](\d{4})/i);
                if (m) return parseInt(m[1]);
                if (d.date) return new Date(d.date).getFullYear();
                return 2025;
            };

            const historique = filtered
                .filter(d => d.rows && d.rows.length > 0 && d.week != null)
                .map(d => {
                    // Dedup rows by receiptId — a same receipt can appear on multiple rows (grade splits)
                    // Matches QualiteLiquidationsTab logic for consistent totals.
                    const byRid = {};
                    (d.rows || []).forEach(r => {
                        const rid = r.receiptId || ('row_' + Math.random());
                        if (!byRid[rid]) byRid[rid] = { kg: 0, gsNet: 0 };
                        byRid[rid].kg += (r.receiptQtyKg || 0);
                        byRid[rid].gsNet += (r.gsNet || 0);
                    });
                    const qteKg = Object.values(byRid).reduce((s, r) => s + r.kg, 0);
                    const gsNetSum = Object.values(byRid).reduce((s, r) => s + r.gsNet, 0);
                    const montantBrut = d.base || gsNetSum;
                    // In Driscoll's PDF: column 4 is "DED Rasp" (framboise) or "Plant Deduction" (myrtille).
                    // Both represent the plants deduction on seedling bills — unified here as prelevPlants.
                    const prelevPlants = (d.dedPlants || 0) + (d.dedRasp || 0);
                    const prelevPret = d.cropAdvance || 0;
                    const fruitAdvance = d.fruitAdvance || 0;
                    const montantNet = d.netPayable != null && d.netPayable !== 0
                        ? d.netPayable
                        : Math.max(montantBrut - prelevPlants - prelevPret - fruitAdvance, 0);
                    const prixMoyen = qteKg > 0 ? montantBrut / qteKg : 0;
                    const year = extractYear(d);
                    return {
                        semaine: `S${String(d.week).padStart(2,'0')}-${year}`,
                        week: d.week,
                        year,
                        qteKg: Math.round(qteKg * 100) / 100,
                        prixMoyen: Math.round(prixMoyen * 100) / 100,
                        montantBrut: Math.round(montantBrut * 100) / 100,
                        prelevPlants: Math.round(prelevPlants * 100) / 100,
                        prelevPret: Math.round(prelevPret * 100) / 100,
                        fruitAdvance: Math.round(fruitAdvance * 100) / 100,
                        montantNet: Math.round(montantNet * 100) / 100,
                        dateEncaissement: d.date ? new Date(d.date).toLocaleDateString('fr-FR') : '-',
                        status: 'Encaissée',
                        fruit: d.fruit || 'framboise',
                        liquidationNumber: d.liquidationNumber,
                        period: d.period,
                        rows: d.rows,
                    };
                })
                .sort((a, b) => (a.year * 100 + a.week) - (b.year * 100 + b.week));

            const totalKg = historique.reduce((s, h) => s + h.qteKg, 0);
            const totalBrut = historique.reduce((s, h) => s + h.montantBrut, 0);
            const totalEncaisse = historique.reduce((s, h) => s + h.montantNet, 0);
            const totalPlantsPreleve = historique.reduce((s, h) => s + h.prelevPlants, 0);
            const totalCropAdvancePreleve = historique.reduce((s, h) => s + h.prelevPret, 0);
            const totalFruitAdvancePreleve = historique.reduce((s, h) => s + (h.fruitAdvance || 0), 0);

            const plantsPrelevs = historique.filter(h => h.prelevPlants > 0).map(h => ({ semaine: h.semaine, montant: h.prelevPlants }));
            const cropPrelevs = historique.filter(h => h.prelevPret > 0).map(h => ({ semaine: h.semaine, montant: h.prelevPret }));
            const fruitPrelevs = historique.filter(h => (h.fruitAdvance || 0) > 0).map(h => ({ semaine: h.semaine, montant: h.fruitAdvance }));

            return {
                historique,
                aVenir: [],
                planning: [],
                totalKg,
                totalBrut,
                totalNet: totalEncaisse,
                totalEncaisse,
                enCours: Math.max(totalBrut - totalEncaisse, 0),
                deductions: {
                    plants: {
                        designation: 'Plants Framboise',
                        totalFacture: 0,
                        totalPreleve: totalPlantsPreleve,
                        resteADeduire: 0,
                        factures: [],
                        prelevements: plantsPrelevs,
                    },
                    cropAdvance: {
                        designation: "Prêt Driscoll's (Crop Advance)",
                        totalMontant: 0,
                        totalPreleve: totalCropAdvancePreleve,
                        resteADeduire: 0,
                        prelevements: cropPrelevs,
                    },
                    fruitAdvance: {
                        designation: 'Fruit Advance',
                        totalMontant: 0,
                        totalPreleve: totalFruitAdvancePreleve,
                        resteADeduire: 0,
                        prelevements: fruitPrelevs,
                    },
                },
            };
        }

export { buildLiquidationsView };
