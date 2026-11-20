/**
 * Social Media Downloader — Centralized Logging Service
 * Namespaced logging with configurable levels, trace IDs, and secret sanitization.
 */

export const LogLevel = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4
};

export class Logger {
  /**
   * @param {string} namespace - e.g. "core:download", "instagram:scanner", "reddit:muxer"
   * @param {number} [level=LogLevel.INFO]
   */
  constructor(namespace = 'core', level = LogLevel.INFO) {
    this.namespace = namespace;
    this.level = level;
    this.traceId = null;
  }

  /**
   * Sets trace ID for workflow correlation.
   * @param {string} traceId
   * @returns {Logger}
   */
  withTrace(traceId) {
    const child = new Logger(this.namespace, this.level);
    child.traceId = traceId;
    return child;
  }

  /**
   * Creates a sub-logger.
   * @param {string} subNamespace
   * @returns {Logger}
   */
  child(subNamespace) {
    const child = new Logger(`${this.namespace}:${subNamespace}`, this.level);
    child.traceId = this.traceId;
    return child;
  }

  /**
   * Sanitizes objects and strings before logging to avoid leaking secrets.
   * @param {unknown} arg
   * @param {WeakSet<object>} [seen]
   * @returns {unknown}
   */
  static sanitize(arg, seen = undefined) {
    if (!arg) return arg;
    // Error instances lose message/stack under JSON.stringify (non-enumerable props),
    // which made every logged failure appear as {} — un-diagnosable in production.
    if (arg instanceof Error) {
      return Logger.sanitize({
        name: arg.name,
        message: arg.message,
        code: /** @type {any} */ (arg).code,
        stack: typeof arg.stack === 'string' ? arg.stack.split('\n').slice(0, 3).join(' | ') : undefined
      }, seen);
    }
    if (typeof arg === 'bigint') {
      return arg.toString();
    }
    if (typeof arg === 'string') {
      return arg
        .replace(/([?&;,\s]|^)(fb_dtsg|csrftoken|sessionid|c_user|xs|datr|lsd|jazoest|_nc_ohc|oh|oe|token|bearer|auth|password|api_key|apikey)=([^&;\s"']+)/gi, '$1$2=<REDACTED>')
        .replace(/"(fb_dtsg|csrftoken|sessionid|c_user|xs|datr|lsd|jazoest|_nc_ohc|oh|oe|token|authorization|cookie|password|secret|api_key|apikey)"\s*:\s*"[^"]*"/gi, '"$1":"<REDACTED>"')
        .replace(/((?:Authorization\s*:\s*)?(?:Bearer|Basic|Digest|Token)\s+)[A-Za-z0-9_\-.+/=]+/gi, '$1<REDACTED>')
        .replace(/((?:Set-)?Cookie\s*:\s*)[^\r\n]+/gi, '$1<REDACTED>');
    }
    if (typeof arg === 'object') {
      const tracker = seen || new WeakSet();
      if (tracker.has(arg)) return '[Circular]';
      tracker.add(arg);
      const redactSubstrings = [
        'fb_dtsg', 'csrftoken', 'sessionid', 'c_user', 'datr', 'jazoest',
        '_nc_ohc', 'token', 'authorization', 'cookie', 'password', 'secret',
        'api_key', 'apikey'
      ];
      const redactExactKeys = new Set(['xs', 'lsd', 'oh', 'oe']);
      if (Array.isArray(arg)) {
        return arg.map((item) => Logger.sanitize(item, tracker));
      }
      const out = {};
      for (const k of Object.keys(arg)) {
        const lower = k.toLowerCase();
        if (redactExactKeys.has(lower) || redactSubstrings.some((rk) => lower.includes(rk))) {
          out[k] = '<REDACTED>';
        } else {
          out[k] = Logger.sanitize(/** @type {any} */ (arg)[k], tracker);
        }
      }
      return out;
    }
    return arg;
  }

  _format(levelName, ...args) {
    const prefix = `[${new Date().toISOString()}][${levelName}][${this.namespace}]` +
      (this.traceId ? `[trace=${this.traceId}]` : '');
    return [prefix, ...args.map((arg) => Logger.sanitize(arg))];
  }

  error(...args) {
    if (this.level >= LogLevel.ERROR) {
      console.error(...this._format('ERROR', ...args));
    }
  }

  warn(...args) {
    if (this.level >= LogLevel.WARN) {
      console.warn(...this._format('WARN', ...args));
    }
  }

  info(...args) {
    if (this.level >= LogLevel.INFO) {
      console.info(...this._format('INFO', ...args));
    }
  }

  debug(...args) {
    if (this.level >= LogLevel.DEBUG) {
      console.debug(...this._format('DEBUG', ...args));
    }
  }

  trace(...args) {
    if (this.level >= LogLevel.TRACE) {
      console.trace(...this._format('TRACE', ...args));
    }
  }
}
