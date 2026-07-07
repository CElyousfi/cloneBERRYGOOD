'use strict';

// @ts-check

/**
 * Comparateur PUR de VALIDATION CROISÉE du pull pointage BDP reconstruit vs le
 * mirror BDR figé (sql_mirror_pointage). Aucun accès Firestore/SQL : prend deux
 * tableaux de lignes contrat en entrée, renvoie un diff structuré.
 *
 * Clé de rapprochement ligne à ligne :
 *   (Personnel_Matricule × DateStr × Operation × Ref_parcelle)
 *
 * Attendus :
 *   - Nombre_Jr : égalité STRICTE (grain journées prouvé/réfuté par le diff).
 *   - Cout / cout_beeone_ref : tolérance ±1 MAD (arrondis BDP vs mirror).
 */

const JR_KEYS = ['Personnel_Matricule', 'DateStr', 'Operation', 'Ref_parcelle'];

/**
 * @param {Object} row
 * @returns {string}
 */
function rowKey(row) {
  return JR_KEYS.map((k) => String((row && row[k]) == null ? '' : row[k]).trim()).join('||');
}

/**
 * Indexe un tableau de lignes par clé de rapprochement.
 * En cas de collision (plusieurs lignes même clé — grain non atomique), on
 * agrège Nombre_Jr et Cout pour comparer les totaux, et on compte les doublons.
 * @param {Array<Object>} rows
 * @returns {Map<string, {rows: Array<Object>, jr: number, cout: number}>}
 */
function indexByKey(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = rowKey(row);
    let entry = map.get(key);
    if (!entry) {
      entry = { rows: [], jr: 0, cout: 0 };
      map.set(key, entry);
    }
    entry.rows.push(row);
    entry.jr += Number(row.Nombre_Jr) || 0;
    const c = row.cout_beeone_ref != null ? row.cout_beeone_ref : row.Cout;
    entry.cout += Number(c) || 0;
  }
  return map;
}

/**
 * Compare deux jeux de lignes contrat.
 * @param {Array<Object>} temoinRows lignes reconstruites (sql_mirror_pointage_bdp_test)
 * @param {Array<Object>} mirrorRows lignes du mirror figé (sql_mirror_pointage)
 * @param {Object} [opts]
 * @param {number} [opts.tolCout=1] tolérance coût en MAD
 * @returns {Object} rapport de comparaison
 */
function comparePointage(temoinRows, mirrorRows, opts) {
  const tolCout = opts && typeof opts.tolCout === 'number' ? opts.tolCout : 1;
  const temoin = indexByKey(temoinRows);
  const mirror = indexByKey(mirrorRows);

  const manquantes_mirror = []; // présentes dans le témoin, absentes du mirror
  const manquantes_temoin = []; // présentes dans le mirror, absentes du témoin
  const diff_jr = [];
  const diff_cout = [];
  let identiques = 0;
  let communes = 0;
  let doublons_temoin = 0;
  let doublons_mirror = 0;

  for (const [key, tEntry] of temoin) {
    if (tEntry.rows.length > 1) doublons_temoin++;
    const mEntry = mirror.get(key);
    if (!mEntry) {
      manquantes_mirror.push(key);
      continue;
    }
    communes++;
    const jrEqual = tEntry.jr === mEntry.jr;
    const coutEqual = Math.abs(tEntry.cout - mEntry.cout) <= tolCout;
    if (!jrEqual) {
      diff_jr.push({ key, temoin: tEntry.jr, mirror: mEntry.jr, ecart: tEntry.jr - mEntry.jr });
    }
    if (!coutEqual) {
      diff_cout.push({
        key,
        temoin: Math.round(tEntry.cout * 100) / 100,
        mirror: Math.round(mEntry.cout * 100) / 100,
        ecart: Math.round((tEntry.cout - mEntry.cout) * 100) / 100,
      });
    }
    if (jrEqual && coutEqual) identiques++;
  }

  for (const [key, mEntry] of mirror) {
    if (mEntry.rows.length > 1) doublons_mirror++;
    if (!temoin.has(key)) manquantes_temoin.push(key);
  }

  return {
    lignes_temoin: (temoinRows || []).length,
    lignes_mirror: (mirrorRows || []).length,
    cles_temoin: temoin.size,
    cles_mirror: mirror.size,
    communes,
    resume: {
      identiques,
      diff_jr: diff_jr.length,
      diff_cout: diff_cout.length,
      manquantes_temoin: manquantes_temoin.length,
      manquantes_mirror: manquantes_mirror.length,
      doublons_temoin,
      doublons_mirror,
    },
    // Échantillons (bornés) pour lecture humaine.
    details: {
      diff_jr: diff_jr.slice(0, 50),
      diff_cout: diff_cout.slice(0, 50),
      manquantes_temoin: manquantes_temoin.slice(0, 50),
      manquantes_mirror: manquantes_mirror.slice(0, 50),
    },
  };
}

module.exports = { rowKey, indexByKey, comparePointage, JR_KEYS };
