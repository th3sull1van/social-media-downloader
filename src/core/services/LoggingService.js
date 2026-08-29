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
   * @returns {unknown}
   */
  static sanitize(arg) {
    if (!arg) return arg;
    // Error instances lose message/stack under JSON.stringify (non-enumerable props),
    // which made every logged failure appear as {} — un-diagnosable in production.
    if (arg instanceof Error) {
      return {
        name: arg.name,
        message: arg.message,
        code: /** @type {any} */ (arg).code,
        stack: typeof arg.stack === 'string' ? arg.stack.split('\n').slice(0, 3).join(' | ') : undefined
      };
    }
    if (typeof arg === 'string') {
      return arg
        .replace(/(fb_dtsg|csrftoken|token|bearer|auth|password)=([^&;\s]+)/gi, '$1=<REDACTED>')
        .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]+/gi, '$1<REDACTED>');
    }
    if (typeof arg === 'object') {
      try {
        const copy = JSON.parse(JSON.stringify(arg));
        const redactKeys = ['fb_dtsg', 'csrftoken', 'token', 'authorization', 'cookie', 'password', 'secret'];
        const walk = (obj) => {
          if (!obj || typeof obj !== 'object') return;
          for (const k of Object.keys(obj)) {
            if (redactKeys.some(rk => k.toLowerCase().includes(rk))) {
              obj[k] = '<REDACTED>';
            } else if (typeof obj[k] === 'object') {
              walk(obj[k]);
            }
          }
        };
        walk(copy);
        return copy;
      } catch (e) {
        return '[Complex Object]';
      }
    }
    return arg;
  }

  _format(levelName, ...args) {
    const prefix = `[${new Date().toISOString()}][${levelName}][${this.namespace}]` +
      (this.traceId ? `[trace=${this.traceId}]` : '');
    return [prefix, ...args.map(Logger.sanitize)];
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
