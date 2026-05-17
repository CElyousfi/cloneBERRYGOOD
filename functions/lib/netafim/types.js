// @ts-check
'use strict';

/**
 * Type definitions for the Netafim GrowSphere V3 integration (ferme BAHIA).
 *
 * Reference: "Connect to Growsphere API V3" (Aug 18 2024, Tsafi Y. / Netafim IT).
 * OAuth 2.0 client_credentials, POST endpoints, paginated responses.
 */

/**
 * @typedef {Object} NetafimConfig
 * @property {boolean} enabled
 * @property {string}  client_id
 * @property {string}  client_secret
 * @property {string}  base_url             e.g. "https://apim.netafim.com"
 * @property {string}  token_url            e.g. "https://apim.netafim.com/oauth2/token"
 * @property {number}  [daily_call_limit]   defaults to 25 (Netafim hard cap 30)
 * @property {string}  [farm_label]         defaults to "BAHIA"
 */

/**
 * @typedef {Object} NetafimToken
 * @property {string} token
 * @property {number} expiresAt   epoch ms
 */

/**
 * @typedef {Object} NetafimValve
 * @property {string} [vlvName]
 * @property {string} [vlvIoId]
 * @property {string} [channelId]
 * @property {string} [ioId]
 * @property {string} [irriBlockId]
 * @property {string} [irriBlockName]
 * @property {number} [shiftNumber]
 * @property {string} [irriTime]          "HH:mm:ss"
 * @property {number} [irriQtyInLiter]
 * @property {number} [irriQtyInM3]
 * @property {number} [irriQtyInGallon]
 * @property {number} [irriDepthInMm]
 * @property {number} [irriDepthInInch]
 * @property {number} [flowInGPM]
 * @property {number} [flowInM3h]
 * @property {string} [mainlineId]
 */

/**
 * @typedef {Object} NetafimIrrigationLog
 * @property {string} id
 * @property {string} [farmId]
 * @property {string} [thingId]
 * @property {string} [logMessageProcessedUtc]
 * @property {string} [deviceUuid]
 * @property {string} [programUuid]
 * @property {string} [prgName]
 * @property {string} [date]              "YYYY-MM-DDTHH:mm:ss.SSSSSS+TZ"
 * @property {string} [startTime]         "HH:mm:ss"
 * @property {string} [startTimestamp]    "YYYY-MM-DDTHH:mm:ss.SSSSSS+00:00"
 * @property {string|boolean} [completed]
 * @property {number} [averageEC]
 * @property {number} [averagePH]
 * @property {NetafimValve} [valve]
 */

/**
 * Paginated response from any GrowSphere V3 endpoint.
 * @typedef {Object} NetafimPage
 * @property {number} pageNumber
 * @property {number} pageSize
 * @property {number} rowCount
 * @property {number} pageCount
 * @property {Array<Object>} items
 */

/**
 * @typedef {Object} NetafimReadingPoint
 * @property {number|null} ec
 * @property {number|null} ph
 * @property {number|null} volume     Liters
 */

/**
 * Doc compatible with the existing `irrigation_readings` collection
 * (consumed by functions/lib/irrigation/*). Drainage is always empty for
 * BAHIA — there are no manual drainage stations on the Netafim controller.
 *
 * @typedef {Object} BahiaIrrigationReading
 * @property {'BAHIA'} ferme
 * @property {string}  date                "YYYY-MM-DD"
 * @property {string|null} heure           "HH:mm"
 * @property {string|null} parcelle        irriBlockId (stable Netafim id)
 * @property {string|null} parcelleLabel
 * @property {string|null} valveName
 * @property {number|null} shiftNumber
 * @property {number|null} duree           minutes
 * @property {number|null} volumeM3
 * @property {number|null} flowM3h
 * @property {string|null} programName
 * @property {string|null} programUuid
 * @property {string|null} netafimId
 * @property {number|null} startTimestamp  epoch ms
 * @property {Array<NetafimReadingPoint>} points
 * @property {Array<NetafimReadingPoint>} drainage
 * @property {Object} meta
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {string} createdBy
 */

module.exports = {};
