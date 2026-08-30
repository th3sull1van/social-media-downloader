/**
 * Social Media Downloader — Download Job Domain Model
 * Tracks lifecycle, progress, format, and state of a download batch or individual item.
 */

/**
 * @typedef {"IDLE" | "QUEUED" | "DOWNLOADING" | "DOWNLOADING_BLOBS" | "PACKAGING_ZIP" | "COMPLETED" | "FAILED" | "FAILED_SIZE" | "CANCELLED"} JobStatus
 */

/**
 * @typedef {"individual" | "zip"} DownloadFormat
 */

/**
 * @typedef {Object} DownloadJob
 * @property {string} id
 * @property {string} platform
 * @property {string} targetName
 * @property {string=} targetFilename
 * @property {DownloadFormat} format
 * @property {number} total
 * @property {number} completed
 * @property {number} failed
 * @property {number=} skippedDuplicates Number of duplicate media items skipped
 * @property {JobStatus} status
 * @property {number=} zipPercent
 * @property {string=} error
 * @property {number=} receiptDownloadId Last successful chrome download id (receipt "show in folder" anchor)
 * @property {boolean=} filenameOverridden Set when a competing download manager renamed the output
 * @property {number} createdAt
 * @property {number} updatedAt
 */

export class DownloadJobModel {
  /**
   * Creates a new DownloadJob instance.
   * @param {Object} params
   * @param {string} params.platform
   * @param {string} params.targetName
   * @param {DownloadFormat} [params.format]
   * @param {number} params.total
   * @param {string} [params.targetFilename]
   * @returns {DownloadJob}
   */
  static create({
    platform,
    targetName,
    format = 'individual',
    total = 0,
    targetFilename
  }) {
    const now = Date.now();
    return {
      id: `job_${now}_${Math.random().toString(36).slice(2, 7)}`,
      platform: String(platform || 'unknown').toLowerCase(),
      targetName: String(targetName || 'Media_Collection'),
      targetFilename: targetFilename || undefined,
      format: format === 'zip' ? 'zip' : 'individual',
      total: Math.max(0, total),
      completed: 0,
      failed: 0,
      skippedDuplicates: 0,
      status: 'QUEUED',
      zipPercent: 0,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Checks if job is in an active (running) state.
   * @param {DownloadJob} job
   * @returns {boolean}
   */
  static isActive(job) {
    if (!job) return false;
    return ['QUEUED', 'DOWNLOADING', 'DOWNLOADING_BLOBS', 'PACKAGING_ZIP'].includes(job.status);
  }

}
