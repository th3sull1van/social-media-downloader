/**
 * Social Media Downloader — Typed Error Hierarchy
 * Provides structured error handling without silently swallowing failures.
 */

export class AppError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, code = 'APP_ERROR', details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
// Only errors with real throw/throw-and-catch sites are kept. Reintroduce
// subclasses at their first actual throw site, not before.
export class AuthenticationRequiredError extends AppError {
  constructor(platform, details = {}) {
    super(`Authentication required for ${platform}`, 'AUTHENTICATION_REQUIRED', { platform, ...details });
  }
}

export class RateLimitedError extends AppError {
  constructor(platform, retryAfter, details = {}) {
    super(`Rate limited by ${platform}. Retry after: ${retryAfter || 'unknown'}`, 'RATE_LIMITED', { platform, retryAfter, ...details });
  }
}
