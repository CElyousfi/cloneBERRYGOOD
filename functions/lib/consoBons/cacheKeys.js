'use strict';
// @ts-check

/**
 * cacheKeys.js — Clés de cache de la consommation par parcelle, partagées entre
 * le PRODUCTEUR de la réponse (`pointageService.js`, action
 * `campagne-conso-parcelle`) et son INVALIDATEUR (`functions/index.js`, action
 * `classer-article`).
 *
 * POURQUOI CE FICHIER
 * -------------------
 * La réponse de `campagne-conso-parcelle` est mise en cache 30 MINUTES. La
 * catégorie engrais/pesticide y est résolue à la LECTURE, depuis
 * `articles_catalog` : classer un article change donc la réponse — mais le
 * cache resservirait l'ancienne pendant une demi-heure. L'utilisateur classe,
 * recharge, ne voit rien changer et conclut que la fonctionnalité est cassée.
 * Le classement DOIT purger ces entrées.
 *
 * La clé réelle est suffixée par le PÉRIMÈTRE de l'appelant
 * (`pointageCacheKey` : `_all`, `_f1`, `_f1_framboise`, …) : il n'existe pas
 * UNE entrée à supprimer mais une par périmètre déjà consulté. L'invalidation
 * se fait donc par PRÉFIXE, sur `<prefix><campagne>`, ce qui couvre tous les
 * suffixes de périmètre sans avoir à les énumérer (les énumérer serait un
 * fail-open silencieux : un nouveau périmètre garderait un cache périmé).
 *
 * ⚠️ Le préfixe est DUPLIQUÉ en littéral dans `pointageService.js` (monolithe
 * sans injection de dépendances, cf. TODO_REFACTO.md). La divergence est
 * attrapée par `tests/unit/classer-article-cablage.test.js`.
 */

/**
 * Préfixe de la clé de cache de `campagne-conso-parcelle`. Le libellé de
 * campagne ('2026-2027') puis le périmètre sont concaténés à la suite.
 * `v3` = version de FORME de la réponse (cf. pointageService.js).
 */
const CONSO_PARCELLE_CACHE_PREFIX = 'campagne_conso_parcelle_v3_';

module.exports = { CONSO_PARCELLE_CACHE_PREFIX };
