// @ts-check
'use strict';

/**
 * isoDateInTz.js — Date ISO (YYYY-MM-DD) dans un fuseau donné, sans dépendre
 * d'un motif de locale.
 *
 * L'idiome `new Intl.DateTimeFormat('en-CA', …).format(d)` était utilisé un peu
 * partout pour obtenir "YYYY-MM-DD" : il est faux. Le motif de date courte d'une
 * locale vient du CLDR et change d'une version d'ICU à l'autre — sur ICU 72
 * (CLDR 42) `en-CA` rend "08/15/2026", pas "2026-08-15". La clé de jour écrite
 * en base dépendait donc de l'ICU embarqué par le runtime.
 *
 * On lit les champs via `formatToParts` et on les assemble nous-mêmes : le
 * résultat ne dépend plus du motif, seulement du fuseau. Le calendrier et le
 * système de chiffres sont épinglés (grégorien, latin) pour que le rendu ne
 * puisse pas basculer sur une locale exotique du process.
 */

/** Locale neutre : grégorien + chiffres latins, quel que soit l'environnement. */
const NEUTRAL_LOCALE = 'en-US-u-ca-gregory-nu-latn';

/**
 * Date ISO (YYYY-MM-DD) correspondant à un instant dans un fuseau IANA.
 *
 * @param {Date|number} [date] instant de référence (défaut : maintenant)
 * @param {string} [timeZone] fuseau IANA (défaut : UTC)
 * @returns {string} YYYY-MM-DD
 * @throws {RangeError} si l'instant est invalide (comme `toISOString`)
 */
function isoDateInTz(date, timeZone) {
  const d = date == null ? new Date() : (date instanceof Date ? date : new Date(date));
  if (Number.isNaN(d.getTime())) throw new RangeError('isoDateInTz: invalid time value');

  const parts = new Intl.DateTimeFormat(NEUTRAL_LOCALE, {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  let y = '', m = '', day = '';
  for (const p of parts) {
    if (p.type === 'year') y = p.value;
    else if (p.type === 'month') m = p.value;
    else if (p.type === 'day') day = p.value;
  }
  return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** Fuseau de toutes les fermes — le Maroc repasse à UTC+0 pendant le Ramadan. */
const CASABLANCA_TZ = 'Africa/Casablanca';

/**
 * Date ISO (YYYY-MM-DD) à l'heure locale des fermes (Africa/Casablanca).
 * @param {Date|number} [date] instant de référence (défaut : maintenant)
 * @returns {string} YYYY-MM-DD
 */
function isoDateCasablanca(date) {
  return isoDateInTz(date, CASABLANCA_TZ);
}

module.exports = { isoDateInTz, isoDateCasablanca, CASABLANCA_TZ };
