'use strict';

/**
 * Collecteur pour `npm run test:unit` (glob tests/unit/**\/*.test.js).
 * La source de vérité des tests est
 * functions/lib/mappingConso/__tests__/resolver.test.js — node:test enregistre
 * les tests au require, ce fichier les exécute donc dans le runner unitaire.
 */
require('../../functions/lib/mappingConso/__tests__/resolver.test.js');
