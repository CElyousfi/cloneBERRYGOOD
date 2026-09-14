/* Chantier production readiness (2026-09-14) — extrait tel quel depuis
   FinCATab.jsx (mêmes lignes, aucun changement de logique) pour que le
   Dashboard (FinDashboardTab, via AuthenticatedApp.jsx) calcule EXACTEMENT
   le même CA que l'onglet Finance — une seule implémentation, jamais deux
   chiffres qui pourraient diverger pour la même réalité. Voir
   docs/DATA_SOURCES.md (totalCA / totalCAExport / totalCALocal /
   totalKgExport). Pure : pas de fetch, pas de React — les deux appelants
   (FinCATab.jsx, AuthenticatedApp.jsx) font le fetch et lui passent les
   données brutes. */
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';

// Config hectares statique (données physiques de la ferme) — identique à
// l'ancienne constante locale de FinCATab.jsx.
const VARIETES_HA = {
    'Maravilla GC|F1': { label: 'S1/S4 Maravilla MD', ha: 4.2, culture: 'Framboise' },
    'Maravilla LC|F1': { label: 'S3/S7 Maravilla MT', ha: 5.2, culture: 'Framboise' },
    'Yazmin|F1': { label: 'S2/S5 Yazmin MD', ha: 2.0, culture: 'Framboise' },
    'Yazmin|F5': { label: 'S10/S13 Yazmin F5', ha: 4.7, culture: 'Framboise' },
    'Reyna|F5': { label: 'S9 Reyna', ha: 3.0, culture: 'Framboise' },
    'Corina|F5': { label: 'Corina S8', ha: 2.5, culture: 'Myrtille' },
    'Cascade|F5': { label: 'Cascade S8-1', ha: 1.5, culture: 'Myrtille' },
    'Breeze|F5': { label: 'Breeze S8-2', ha: 1.0, culture: 'Myrtille' },
};
const TOTAL_HA_CONFIG = 54.8;

/**
 * @param {{liquidations?: Array, expeditions?: Array, marcheLocalBons?: Array}} input
 * @returns {{totalExport: number, totalLocal: number, totalCA: number, totalKgExport: number, caDetail: Array, totalHaConfig: number}}
 */
function computeCADetail({ liquidations, expeditions, marcheLocalBons } = {}) {
    // --- Agréger CA Export depuis les liquidations (même logique que CPC tab) ---
    const liqCAByVariety = {};
    {
        const expByReceipt = {};
        (expeditions || []).forEach(exp => {
            const rid = (exp.receiptId || '').trim();
            if (rid) expByReceipt[rid] = exp;
        });
        const addLiqCA = (variete, ferme, kg, montant) => {
            const key = variete + '|' + ferme;
            if (!liqCAByVariety[key]) liqCAByVariety[key] = { kg: 0, montant: 0 };
            liqCAByVariety[key].kg += kg;
            liqCAByVariety[key].montant += montant;
        };
        (liquidations || []).forEach(liq => {
            (liq.rows || []).forEach(row => {
                const kg = row.receiptQtyKg || 0;
                const gs = row.gsNet || 0;
                if (kg <= 0 && gs <= 0) return;
                const vName = row.variety || row.varietyCode || '';
                const norm = normalizeParcelle(vName);
                let variete = norm ? norm.variete : vName;
                let ferme = norm ? norm.ferme : null;

                const rid = (row.receiptId || '').trim();
                const matchedExp = rid ? expByReceipt[rid] : null;
                if (matchedExp) {
                    if (!ferme) ferme = matchedExp.ferme;
                    if (variete === 'Maravilla' && (!norm || !norm.sousVariete)) {
                        const expNorm = normalizeParcelle(matchedExp.variety);
                        if (expNorm && expNorm.sousVariete === 'Green Cane') variete = 'Maravilla GC';
                        else if (expNorm && expNorm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                        else if (expNorm && expNorm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                    }
                }
                if (variete === 'Maravilla' && norm && norm.sousVariete) {
                    if (norm.sousVariete === 'Green Cane' || norm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                    else if (norm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                }
                if (variete === 'Maravilla') {
                    const haGC = 4.2, haLC = 5.2, haT = haGC + haLC;
                    addLiqCA('Maravilla GC', 'F1', kg * haGC / haT, gs * haGC / haT);
                    addLiqCA('Maravilla LC', 'F1', kg * haLC / haT, gs * haLC / haT);
                    return;
                }
                if (variete === 'Yazmin' && !matchedExp) {
                    const haF1 = 2.0, haF5 = 4.7, haT = haF1 + haF5;
                    addLiqCA('Yazmin', 'F1', kg * haF1 / haT, gs * haF1 / haT);
                    addLiqCA('Yazmin', 'F5', kg * haF5 / haT, gs * haF5 / haT);
                    return;
                }
                if (!ferme) ferme = 'F1';
                addLiqCA(variete, ferme, kg, gs);
            });
        });
    }

    // --- CA Marché Local (pfq_interne + bons_marche_local) ---
    const localCAByVariety = {};
    const localKgByVariety = {};
    if (marcheLocalBons && marcheLocalBons.length > 0) {
        marcheLocalBons.forEach(bon => {
            const rawVariete = bon.variete || bon.blocVariete || bon.designation || '';
            const norm = normalizeParcelle(rawVariete);
            let variete = norm ? norm.variete : (rawVariete || 'Autre');
            let ferme = bon.ferme || bon.blocFerme || (norm ? norm.ferme : 'F1');
            if (variete === 'Maravilla' && norm && norm.sousVariete) {
                if (norm.sousVariete === 'Green Cane' || norm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                else if (norm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
            }
            if (variete === 'Maravilla') {
                const montant = parseFloat(bon.totalDH) || 0;
                const kgLocal = parseFloat(bon.poidsLot) || 0;
                const haGC = 4.2, haLC = 5.2, haT = haGC + haLC;
                const kGC = 'Maravilla GC|F1', kLC = 'Maravilla LC|F1';
                if (!localCAByVariety[kGC]) localCAByVariety[kGC] = 0;
                if (!localCAByVariety[kLC]) localCAByVariety[kLC] = 0;
                if (!localKgByVariety[kGC]) localKgByVariety[kGC] = 0;
                if (!localKgByVariety[kLC]) localKgByVariety[kLC] = 0;
                localCAByVariety[kGC] += montant * haGC / haT;
                localCAByVariety[kLC] += montant * haLC / haT;
                localKgByVariety[kGC] += kgLocal * haGC / haT;
                localKgByVariety[kLC] += kgLocal * haLC / haT;
                return;
            }
            const key = variete + '|' + ferme;
            if (!localCAByVariety[key]) localCAByVariety[key] = 0;
            if (!localKgByVariety[key]) localKgByVariety[key] = 0;
            const montant = parseFloat(bon.totalDH) || ((parseFloat(bon.poidsLot) || 0) * (parseFloat(bon.prixDH) || 0));
            localCAByVariety[key] += montant;
            localKgByVariety[key] += parseFloat(bon.poidsLot) || 0;
        });
    }

    // --- Construire caDetail dynamiquement ---
    const allKeys = new Set([...Object.keys(liqCAByVariety), ...Object.keys(localCAByVariety)]);
    const totalExport = Object.values(liqCAByVariety).reduce((s, v) => s + v.montant, 0);
    const totalLocal = Object.values(localCAByVariety).reduce((s, v) => s + v, 0);
    const totalCA = totalExport + totalLocal;
    const totalKgExport = Object.values(liqCAByVariety).reduce((s, v) => s + v.kg, 0);

    const caDetail = [];
    allKeys.forEach(key => {
        const [variete, ferme] = key.split('|');
        const expData = liqCAByVariety[key] || { kg: 0, montant: 0 };
        const localMontant = localCAByVariety[key] || 0;
        const localKg = localKgByVariety[key] || 0;
        const configMatch = VARIETES_HA[key];
        const ha = configMatch ? configMatch.ha : 1;
        const ca = expData.montant + localMontant;
        const totalKg = expData.kg + localKg;
        if (ca <= 0) return;
        caDetail.push({
            variete: configMatch ? configMatch.label : `${variete} (${ferme})`,
            ferme,
            culture: configMatch ? configMatch.culture : 'Framboise',
            kg: totalKg,
            ca,
            prixMoyen: totalKg > 0 ? Math.round(ca / totalKg * 100) / 100 : 0,
            ha,
            caHa: Math.round(ca / ha),
            pctCA: totalCA > 0 ? Math.round(ca / totalCA * 100 * 10) / 10 : 0,
        });
    });
    caDetail.sort((a, b) => b.ca - a.ca);

    return { totalExport, totalLocal, totalCA, totalKgExport, caDetail, totalHaConfig: TOTAL_HA_CONFIG };
}

export { computeCADetail, VARIETES_HA, TOTAL_HA_CONFIG };
