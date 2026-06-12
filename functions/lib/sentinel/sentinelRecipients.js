'use strict'
// @ts-check

const { formatPhoneE164 } = require('../phone/formatPhoneE164')

/**
 * Pure filtering/mapping logic for the Sentinel recipients endpoint.
 *
 * Reuses the same field semantics as
 * `resolveRecipientsForProfile` in functions/whatsappService.js :
 *   - whatsappEnabled === true
 *   - disabled !== true
 *   - whatsappPhone non-empty AND valid E.164 (Moroccan) after normalization
 *
 * @typedef {Object} RawUser
 * @property {boolean} [whatsappEnabled]
 * @property {boolean} [disabled]
 * @property {string} [whatsappPhone]
 * @property {string} [ferme]
 * @property {string} [profileId]
 *
 * @typedef {Object} SentinelRecipient
 * @property {string|null} ferme
 * @property {string} whatsappPhone E.164 normalized (e.g. "+2126...")
 * @property {string|null} profileId Null kept on purpose: Sentinel routes by farm, not by profile
 */

/**
 * Filter + project a list of user documents into Sentinel recipients.
 * Outputs EXACTLY and ONLY { ferme, whatsappPhone, profileId } — no PII.
 *
 * whatsappPhone is normalized to E.164 (+212...) like the rest of the stack.
 * A user whose whatsappPhone is non-empty but invalid is EXCLUDED (same
 * implicit behavior as whatsappService when formatPhoneE164 returns null).
 *
 * @param {RawUser[]} users
 * @returns {SentinelRecipient[]}
 */
function filterSentinelRecipients(users) {
  if (!Array.isArray(users)) return []
  const out = []
  for (const u of users) {
    if (!u || typeof u !== 'object') continue
    if (u.whatsappEnabled !== true) continue
    if (u.disabled === true) continue
    if (!u.whatsappPhone) continue
    const phone = formatPhoneE164(u.whatsappPhone)
    // Invalid number after normalization -> exclude recipient
    if (!phone) continue
    out.push({
      // ferme empty/null/absent -> null (DG/broadcast all farms semantics)
      ferme: u.ferme ? u.ferme : null,
      whatsappPhone: phone,
      profileId: u.profileId || null,
    })
  }
  return out
}

module.exports = { filterSentinelRecipients }
