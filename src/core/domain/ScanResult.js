/**
 * Social Media Downloader — ScanResult Domain Model
 * Encapsulates the output of a platform scan operation.
 */

/**
 * @typedef {"success" | "partial" | "empty" | "unsupported" | "authentication_required" | "rate_limited" | "network_failure" | "parse_failure" | "resolver_failure" | "cancelled"} ScanStatus
 */

/**
 * @typedef {Object} ScanResult
 * @property {string} platform
 * @property {import('./PlatformTarget.js').PlatformTarget} target
 * @property {import('./MediaItem.js').MediaItem[]} items
 * @property {boolean} hasMore
 * @property {string=} nextCursor
 * @property {ScanStatus} status
 * @property {string=} errorMessage
 * @property {string=} errorCode
 * @property {Record<string, unknown>} metadata
 */

export class ScanResultModel {
  /**
   * Creates a standardized ScanResult.
   * @param {Object} params
   * @param {string} params.platform
   * @param {import('./PlatformTarget.js').PlatformTarget} params.target
   * @param {import('./MediaItem.js').MediaItem[]} [params.items]
   * @param {boolean} [params.hasMore]
   * @param {string} [params.nextCursor]
   * @param {ScanStatus} [params.status]
   * @param {string} [params.errorMessage]
   * @param {string} [params.errorCode]
   * @param {Record<string, unknown>} [params.metadata]
   * @returns {ScanResult}
   */
  static create({
    platform,
    target,
    items = [],
    hasMore = false,
    nextCursor,
    status = 'success',
    errorMessage,
    errorCode,
    metadata = {}
  }) {
    if (!platform) throw new TypeError('ScanResult requires platform');
    if (!target) throw new TypeError('ScanResult requires target');

    let finalStatus = status;
    if (status === 'success' && items.length === 0 && !hasMore) {
      finalStatus = 'empty';
    }

    return {
      platform: platform.toLowerCase(),
      target,
      items: Array.isArray(items) ? [...items] : [],
      hasMore: !!hasMore,
      nextCursor: nextCursor || undefined,
      status: finalStatus,
      errorMessage: errorMessage || undefined,
      errorCode: errorCode || undefined,
      metadata: { ...metadata }
    };
  }

}
