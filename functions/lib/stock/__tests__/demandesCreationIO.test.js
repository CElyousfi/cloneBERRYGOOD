'use strict';

/**
 * Tests de COMPORTEMENT de `demandesCreationIO.enregistrerDemandesCreation`.
 *
 * ── POURQUOI CE FICHIER EXISTE ────────────────────────────────────────────
 * Cette fonction n'était gardée que par des assertions de SOURCE, dans
 * `tests/unit/identite-article-cablage.test.js`. La QA a posé deux mutants qui
 * ont SURVÉCU à ces 35 assertions :
 *
 *   R2 — un `throw` avant les notifications ;
 *   R3 — `if (ecarts.length)` → `if (ecarts.length && enregistres.length)`.
 *
 * R3 est le plus grave : sur un article ambigu il rend **0 dispatch**, laisse
 * le motif du bon affirmer « Le DG a été alerté », et ne fait rougir aucun
 * test de câblage. C'est le bloquant d'origine reproduit à l'identique.
 *
 * Un test de source vérifie la FORME du code. Seul un test d'exécution vérifie
 * CE QU'IL FAIT. Les dépendances étant injectées, on exécute ici la vraie
 * fonction, avec un Firestore factice.
 *
 * Cas tirés de la production : `OPAL` / `OPAL (L)` (deux fiches actives,
 * mesurées par la QA sur un vrai BDC) et `GENAKTIS` (un des 5 libellés qui ne
 * se rattachent à aucune fiche).
 */

const test = require('node:test');
const assert = require('node:assert');

const { enregistrerDemandesCreation } = require('../demandesCreationIO');
const identite = require('../identiteArticle');

/** Firestore factice : enregistre les écritures, peut échouer à la demande. */
function fauxFirestore(options) {
  const opts = options || {};
  const ecritures = [];
  return {
    ecritures,
    collection: (nom) => ({
      doc: (id) => ({
        set: async (data, opt) => {
          if (opts.echoueSur && opts.echoueSur(id)) {
            throw new Error('Firestore indisponible');
          }
          ecritures.push({ collection: nom, id, data, opt });
        },
      }),
    }),
  };
}

/** Collecteur de dispatchs, avec échec optionnel. */
function fauxDispatch(options) {
  const opts = options || {};
  const appels = [];
  const fn = async (payload) => {
    appels.push(payload);
    if (opts.echoue) throw new Error('WhatsApp indisponible');
    return { whatsapp: { sent: 1 } };
  };
  fn.appels = appels;
  return fn;
}

function io(db, dispatch, erreurs) {
  return {
    db,
    dispatchNotification: dispatch,
    increment: (n) => ({ __increment: n }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    logError: (m, e) => { if (erreurs) erreurs.push(m + ' ' + (e && e.message)); },
    maintenant: () => 1756700000000,
  };
}

const AMBIGU = {
  issue: identite.ISSUE_AMBIGU,
  libelle: 'OPAL',
  candidats: [
    { id: 'Ref-Pes0031', nom: 'OPAL' },
    { id: 'Ref-Pes0032', nom: 'Opal (L)' },
  ],
};
const INTROUVABLE = { issue: identite.ISSUE_INTROUVABLE, libelle: 'GENAKTIS' };
const SANS_LIBELLE = { issue: identite.ISSUE_INTROUVABLE, libelle: '' };

// ---------------------------------------------------------------------------
// R3 — le signal d'écart ne dépend PAS du succès des demandes.
// ---------------------------------------------------------------------------

test('R3 — un article AMBIGU seul déclenche UNE alerte, alors qu\'il n\'écrit AUCUNE demande', () => {
  const db = fauxFirestore();
  const dispatch = fauxDispatch();
  return enregistrerDemandesCreation(io(db, dispatch), [AMBIGU], { name: 'Youssef' }, { numero: 'BDC-0117' })
    .then((enregistres) => {
      assert.deepStrictEqual(enregistres, [], 'aucune fiche ne doit être créée pour un doublon');
      assert.strictEqual(db.ecritures.length, 0, 'aucune demande écrite');
      assert.strictEqual(
        dispatch.appels.length, 1,
        'C\'EST LE POINT : 0 dispatch ici, c\'est le bloquant d\'origine. '
          + 'Le signal d\'écart ne doit JAMAIS dépendre du succès des demandes.'
      );
      const msg = dispatch.appels[0].data.message;
      assert.ok(/FUSIONN/i.test(msg), 'le remède est une fusion : ' + msg);
      assert.ok(/[Nn]e pas créer/.test(msg), msg);
    });
});

test('l\'alerte nomme chaque fiche par son LIBELLÉ, pas seulement par son identifiant', () => {
  const db = fauxFirestore();
  const dispatch = fauxDispatch();
  return enregistrerDemandesCreation(io(db, dispatch), [AMBIGU], {}, {}).then(() => {
    const msg = dispatch.appels[0].data.message;
    // « Ref-Eng0052 / Ref-Eng0177 » ne dit pas au DG laquelle garder ; les
    // doublons diffèrent souvent par le libellé, et il lit ça sur son téléphone.
    assert.ok(msg.includes('OPAL') && msg.includes('Opal (L)'), msg);
    assert.ok(msg.includes('Ref-Pes0031') && msg.includes('Ref-Pes0032'), msg);
  });
});

test('une ligne SANS ARTICLE déclenche aussi une alerte, sans aucune demande', () => {
  const db = fauxFirestore();
  const dispatch = fauxDispatch();
  return enregistrerDemandesCreation(io(db, dispatch), [SANS_LIBELLE], {}, {}).then((e) => {
    assert.deepStrictEqual(e, []);
    assert.strictEqual(db.ecritures.length, 0);
    assert.strictEqual(dispatch.appels.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Le cas nominal, et le mélange des deux familles.
// ---------------------------------------------------------------------------

test('un article INTROUVABLE écrit UNE demande et déclenche UNE notification', () => {
  const db = fauxFirestore();
  const dispatch = fauxDispatch();
  return enregistrerDemandesCreation(io(db, dispatch), [INTROUVABLE], { name: 'Youssef' }, {})
    .then((enregistres) => {
      assert.deepStrictEqual(enregistres, ['GENAKTIS']);
      assert.strictEqual(db.ecritures.length, 1);
      assert.strictEqual(db.ecritures[0].collection, 'article_creation_requests');
      assert.match(db.ecritures[0].id, /^ACR-GENAKTIS-[0-9a-f]{8}$/);
      assert.deepStrictEqual(db.ecritures[0].opt, { merge: true }, 'merge : une demande se renforce, ne s\'écrase pas');
      assert.strictEqual(dispatch.appels.length, 1);
      assert.ok(dispatch.appels[0].data.message.includes('GENAKTIS'));
    });
});

test('mélange introuvable + ambigu : DEUX dispatchs, car deux gestes OPPOSÉS', () => {
  const db = fauxFirestore();
  const dispatch = fauxDispatch();
  return enregistrerDemandesCreation(io(db, dispatch), [INTROUVABLE, AMBIGU], {}, {}).then(() => {
    assert.strictEqual(db.ecritures.length, 1, 'seul l\'introuvable produit une demande');
    assert.strictEqual(dispatch.appels.length, 2);
    const messages = dispatch.appels.map((a) => a.data.message);
    assert.ok(messages.some((m) => /créer au catalogue/i.test(m)), 'un message « créer »');
    assert.ok(messages.some((m) => /FUSIONN/i.test(m)), 'un message « fusionner »');
    // Les mélanger rendrait l'alerte inactionnable : le DG ne saurait pas
    // lequel des deux gestes appliquer à quel article.
    assert.notStrictEqual(messages[0], messages[1]);
  });
});

test('aucune résolution fautive : rien n\'est écrit, personne n\'est dérangé', () => {
  const db = fauxFirestore();
  const dispatch = fauxDispatch();
  return enregistrerDemandesCreation(io(db, dispatch), [], {}, {}).then((e) => {
    assert.deepStrictEqual(e, []);
    assert.strictEqual(db.ecritures.length, 0);
    assert.strictEqual(dispatch.appels.length, 0, 'jamais d\'alerte vide');
  });
});

test('chaque template est `general_alert`, sur les deux canaux, vers le DG', () => {
  const db = fauxFirestore();
  const dispatch = fauxDispatch();
  return enregistrerDemandesCreation(io(db, dispatch), [INTROUVABLE, AMBIGU], {}, {}).then(() => {
    for (const appel of dispatch.appels) {
      // Un free-form serait droppé en silence par Meta hors fenêtre de 24 h.
      assert.strictEqual(appel.type, 'general_alert');
      assert.deepStrictEqual(appel.profiles, ['dg']);
      assert.deepStrictEqual(appel.channels, ['in_app', 'whatsapp']);
      assert.ok(appel.data.message.length > 0, 'un message vide ne prévient personne');
    }
  });
});

// ---------------------------------------------------------------------------
// R2 — rien ici ne peut faire échouer une réception.
// ---------------------------------------------------------------------------

test('R2 — une écriture Firestore qui échoue ne fait PAS échouer la réception', () => {
  // Cette fonction est appelée AVANT l'écriture du bon de livraison : une
  // exception remonterait au catch de `stockManagement`, rendrait 500, et le BL
  // ne serait jamais écrit. Une panne d'écriture ACCESSOIRE ferait perdre une
  // réception RÉELLE — l'inverse exact du contrat « la réception ne bloque
  // jamais ».
  const db = fauxFirestore({ echoueSur: () => true });
  const dispatch = fauxDispatch();
  const erreurs = [];
  return enregistrerDemandesCreation(io(db, dispatch, erreurs), [INTROUVABLE], {}, {})
    .then((enregistres) => {
      assert.deepStrictEqual(
        enregistres, [],
        'une demande NON écrite ne doit pas être annoncée comme écrite au magasinier'
      );
      assert.strictEqual(erreurs.length, 1, 'l\'échec doit être journalisé, pas avalé');
    });
});

test('R2 — une écriture qui échoue n\'empêche PAS l\'alerte d\'ambiguïté de partir', () => {
  const db = fauxFirestore({ echoueSur: () => true });
  const dispatch = fauxDispatch();
  return enregistrerDemandesCreation(io(db, dispatch, []), [INTROUVABLE, AMBIGU], {}, {})
    .then(() => {
      assert.strictEqual(
        dispatch.appels.length, 1,
        'l\'alerte de doublon est indépendante des demandes : elle doit partir quand même'
      );
      assert.ok(/FUSIONN/i.test(dispatch.appels[0].data.message));
    });
});

test('une écriture qui échoue sur UN article laisse passer les autres', () => {
  const db = fauxFirestore({ echoueSur: (id) => id.startsWith('ACR-TES-') });
  const dispatch = fauxDispatch();
  return enregistrerDemandesCreation(
    io(db, dispatch, []),
    [{ issue: identite.ISSUE_INTROUVABLE, libelle: 'TES' }, INTROUVABLE],
    {}, {}
  ).then((enregistres) => {
    assert.deepStrictEqual(enregistres, ['GENAKTIS'], 'seule la demande réellement écrite est annoncée');
    assert.strictEqual(db.ecritures.length, 1);
  });
});

test('un dispatch qui échoue ne fait pas échouer la réception non plus', () => {
  const db = fauxFirestore();
  const dispatch = fauxDispatch({ echoue: true });
  const erreurs = [];
  return enregistrerDemandesCreation(io(db, dispatch, erreurs), [INTROUVABLE, AMBIGU], {}, {})
    .then((enregistres) => {
      assert.deepStrictEqual(enregistres, ['GENAKTIS'], 'la demande écrite reste annoncée');
      assert.strictEqual(dispatch.appels.length, 2, 'le second dispatch est tenté malgré l\'échec du premier');
      assert.strictEqual(erreurs.length, 2);
    });
});

test('même tout en panne, la fonction rend la main sans lever', () => {
  const db = fauxFirestore({ echoueSur: () => true });
  const dispatch = fauxDispatch({ echoue: true });
  return enregistrerDemandesCreation(io(db, dispatch, []), [INTROUVABLE, AMBIGU, SANS_LIBELLE], {}, {})
    .then((enregistres) => {
      assert.deepStrictEqual(enregistres, [], 'aucune promesse non tenue');
    });
});
