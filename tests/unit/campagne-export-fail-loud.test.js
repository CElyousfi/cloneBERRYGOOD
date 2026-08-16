'use strict';

/**
 * campagne-export-fail-loud.test.js — `buildCampagneExportXlsx` doit ÉCHOUER
 * BRUYAMMENT sur une entrée invalide, jamais rendre un classeur dégradé.
 *
 * POURQUOI CE FILET. La version d'origine entourait la lecture des budgets d'un
 * `if (campagneB)` : une campagne invalide ne levait rien, elle produisait un
 * classeur complet dont les 4 colonnes de suivi budgétaire étaient VIDES. Pour
 * un fichier qui part automatiquement chez cinq dirigeants (DG, DT, RH, chefs
 * F1/F5) sans relecture humaine, c'est le pire mode de défaillance possible :
 * un rapport « tout est à zéro » se lit comme une information, pas comme une
 * panne. L'action HTTP jumelle (`campagne-budget-list`) répond 400 dans ce cas ;
 * l'appel interne doit être aussi bruyant, pour que le job planifié du lot
 * suivant ALERTE au lieu d'envoyer un fichier faux.
 *
 * FAIL-FAST : la garde est en TÊTE de fonction, avant toute lecture Firestore
 * ou BDR. C'est ce qui rend ce test possible sans aucun stub d'I/O — s'il
 * fallait ouvrir une connexion pour découvrir que l'entrée est invalide, ce
 * serait déjà trop tard. Les stubs ci-dessous ne servent qu'au CHARGEMENT du
 * module (pointageService est un monolithe sans DI, cf. TODO_REFACTO.md).
 */

const test = require('node:test');
const assert = require('node:assert');

// Neutralise les lectures Firestore faites au chargement du module (warm du
// référentiel) — aucune n'est atteinte par les cas testés ici.
const { db } = require('../../functions/config/firebase');
db.collection = function () {
  return {
    get: async () => ({ forEach() {} }),
    doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }),
    where: function () { return this; },
  };
};

const { buildCampagneExportXlsx } = require('../../functions/pointageService');
const campagneBudget = require('../../functions/lib/campagneBudget/validate');
const { campagneCourante } = require('../../functions/lib/mappingConso/campagneUtils');

// ---------------------------------------------------------------------------

test('campagne invalide → throw, JAMAIS un classeur aux colonnes vides', async () => {
  await assert.rejects(
    () => buildCampagneExportXlsx({ culture: 'Framboise', campagne: 'nawak' }),
    /campagne invalide/,
    'une campagne illisible doit lever, pas produire un fichier'
  );
});

test('campagne aux bornes incohérentes → throw (2025/2028 n’est pas une campagne)', async () => {
  // normCampagne exige end === start + 1 : c'est exactement le genre de valeur
  // qu'un appelant peut fabriquer et qui, avalée, sortirait un budget vide.
  await assert.rejects(
    () => buildCampagneExportXlsx({ culture: 'Framboise', campagne: '2025/2028' }),
    /campagne invalide/
  );
});

test('culture manquante → throw (garde historique, non régressée)', async () => {
  await assert.rejects(
    () => buildCampagneExportXlsx({ campagne: '2025/2026' }),
    /culture requise/
  );
});

test('la garde est FAIL-FAST : elle lève avant toute lecture', async () => {
  // Si la validation redescendait après les lectures (Firestore, BR_Parcelle),
  // ces appels toucheraient les stubs — ou pire, le vrai pool mssql. On le
  // prouve en rendant TOUTE lecture Firestore explosive : le rejet doit rester
  // celui de la garde, jamais celui d'une lecture.
  const saved = db.collection;
  db.collection = function () { throw new Error('lecture Firestore atteinte'); };
  try {
    await assert.rejects(
      () => buildCampagneExportXlsx({ culture: 'Framboise', campagne: '' + 'x' }),
      /campagne invalide/,
      'la garde doit lever AVANT la première lecture'
    );
  } finally {
    db.collection = saved;
  }
});

test('le défaut (campagne courante) ne peut PAS déclencher la garde', async () => {
  // Vérification PURE, sans I/O : la garde ne doit jamais transformer un appel
  // nominal `buildCampagneExportXlsx({culture})` — celui du job planifié — en
  // échec. C'est la contrepartie du fail-fast : bruyant sur l'invalide, muet
  // sur le nominal.
  assert.ok(
    campagneBudget.normCampagne(campagneCourante()),
    'campagneCourante() doit toujours passer normCampagne'
  );
  // Et sur une dizaine d'années glissantes, pas seulement aujourd'hui.
  for (let y = 2024; y <= 2034; y += 1) {
    ['-01-15', '-06-30', '-07-01', '-12-31'].forEach((suffix) => {
      const c = campagneCourante(y + suffix);
      assert.ok(campagneBudget.normCampagne(c), `campagne ${c} (${y}${suffix}) rejetée`);
    });
  }
});
