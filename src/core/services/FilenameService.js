/**
 * Social Media Downloader — Filename & Path Service
 * Sanitizes names, renders templates, and prevents path traversal attacks.
 */

export class FilenameService {
  static _encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

  /**
   * Computes UTF-8 byte length of a string.
   * @param {string} str
   * @returns {number}
   */
  static utf8ByteLength(str) {
    if (!str) return 0;
    if (FilenameService._encoder) return FilenameService._encoder.encode(str).length;
    return str.length;
  }

  /**
   * Truncates a string to at most `maxCodeUnits` UTF-16 code units and `maxBytes` UTF-8 bytes
   * without splitting UTF-16 surrogate pairs.
   * @param {string} str
   * @param {number} maxCodeUnits
   * @param {number} [maxBytes=Infinity]
   * @returns {string}
   */
  static truncateSafe(str, maxCodeUnits, maxBytes = Infinity) {
    if (!str) return '';
    let out = '';
    let bytes = 0;
    for (const ch of Array.from(str)) {
      if (out.length + ch.length > maxCodeUnits) break;
      const chBytes = FilenameService.utf8ByteLength(ch);
      if (bytes + chBytes > maxBytes) break;
      out += ch;
      bytes += chBytes;
    }
    return out;
  }

  /**
   * Sanitizes a single filename or directory segment.
   * Removes illegal filesystem characters and path traversal tokens.
   * @param {string} name
   * @param {number} [maxLen=80]
   * @param {string} [fallback='media']
   * @param {number} [maxBytes=180]
   * @returns {string}
   */
  static sanitize(name, maxLen = 80, fallback = 'media', maxBytes = 180) {
    if (!name || typeof name !== 'string') return fallback;

    let clean = name
      // Remove invisible / zero-width and directional override characters
      .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')
      // Remove control chars and filesystem reserved chars: < > : " / \ | ? *
      .replace(/[\x00-\x1F\x7F<>:"/\\|?*]/g, '_')
      // Collapse repeated spaces and underscores
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      // Trim underscores, periods, and spaces from ends (Windows forbids trailing dots/spaces)
      .replace(/^[\s._]+|[\s._]+$/g, '')
      .trim();

    if (clean.length > maxLen || FilenameService.utf8ByteLength(clean) > maxBytes) {
      clean = FilenameService.truncateSafe(clean, maxLen, maxBytes).replace(/^[\s._]+|[\s._]+$/g, '');
    }

    // Prevent Windows reserved DOS filenames (CON, PRN, AUX, NUL, COM1..9, LPT1..9).
    // Checked AFTER truncation so e.g. "CON_something" sliced to 3 chars cannot become "CON".
    const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
    if (reservedNames.test(clean)) {
      clean = `_${clean}`;
      if (clean.length > maxLen) {
        clean = clean.slice(0, maxLen).replace(/[\s.]+$/g, '');
      }
      if (clean === '_' || reservedNames.test(clean)) {
        clean = '';
      }
    }

    return clean || fallback;
  }

  /**
   * Sanitizes a filename while preserving its file extension intact.
   * @param {string} filename
   * @param {number} [maxLen=80]
   * @param {string} [fallback='media.jpg']
   * @param {number} [maxBytes=180]
   * @returns {string}
   */
  static sanitizeFilename(filename, maxLen = 80, fallback = 'media.jpg', maxBytes = 180) {
    if (!filename || typeof filename !== 'string') return fallback;
    const lastDot = filename.lastIndexOf('.');
    let base = filename;
    let ext = '';
    if (lastDot > 0 && lastDot < filename.length - 1 && filename.length - lastDot <= 10) {
      base = filename.slice(0, lastDot);
      ext = filename.slice(lastDot + 1);
    }
    const limit = Math.max(1, Math.floor(Number(maxLen)) || 80);
    let safeExt = ext ? FilenameService.sanitize(ext, 8, '', 16).toLowerCase() : '';
    if (safeExt && safeExt.length + 1 >= limit) {
      // A tiny caller-supplied limit cannot preserve a dot plus the whole
      // extension; keep the result bounded rather than exceeding maxLen.
      return safeExt.slice(0, limit);
    }
    const baseLimit = safeExt ? limit - safeExt.length - 1 : limit;
    const extBytes = safeExt ? FilenameService.utf8ByteLength(safeExt) + 1 : 0;
    const baseByteLimit = Math.max(1, maxBytes - extBytes);
    let safeBase = FilenameService.sanitize(base, Math.max(1, baseLimit), 'media', baseByteLimit);
    safeBase = FilenameService.truncateSafe(safeBase, baseLimit, baseByteLimit);
    // Windows reserves the name before the first dot, not only an exact
    // filename (CON.photos and CON.backup.jpg are both invalid).
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safeBase.split('.')[0])) {
      safeBase = FilenameService.truncateSafe(`_${safeBase}`, baseLimit, baseByteLimit);
    }
    if (!safeBase) safeBase = 'm'.slice(0, baseLimit);
    return safeExt ? `${safeBase}.${safeExt}` : safeBase;
  }

  /**
   * Sanitizes a multi-segment relative path (e.g. "Instagram/@username/posts/photo.jpg").
   * Strictly prevents directory traversal (`..`, absolute paths, drive letters).
   * @param {string} rawPath
   * @param {string} [fallback='Media/download']
   * @returns {string}
   */
  static sanitizePath(rawPath, fallback = 'Media/download') {
    if (!rawPath || typeof rawPath !== 'string') return fallback;

    // Normalize backslashes to forward slashes
    let normalized = rawPath.replace(/\\/g, '/');

    // Remove leading drive letters (e.g., C:) and leading slashes
    normalized = normalized.replace(/^[a-zA-Z]:/, '').replace(/^\/+/, '');

    const segments = normalized.split('/').filter(Boolean);
    const safeSegments = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      // Reject traversal tokens
      if (segment === '.' || segment === '..') {
        continue;
      }
      const isLast = i === segments.length - 1;
      let safeSegment = isLast && segment.includes('.')
        ? FilenameService.sanitizeFilename(segment, 80, 'media')
        : FilenameService.sanitize(segment, 80, '');
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safeSegment.split('.')[0])) {
        safeSegment = `_${safeSegment}`;
      }
      if (safeSegment) safeSegments.push(safeSegment);
    }

    return safeSegments.length > 0 ? safeSegments.join('/') : fallback;
  }

  /**
   * Renders a filename pattern with template tokens.
   * e.g., "r_{subreddit}_u_{author}_{id}.{ext}"
   * @param {string} pattern
   * @param {Record<string, unknown>} context
   * @param {string} [relDir='']
   * @returns {string}
   */
  static render(pattern, context = {}, relDir = '') {
    if (!pattern || typeof pattern !== 'string') return 'media';

    let result = pattern;
    for (const [key, val] of Object.entries(context)) {
      const safeVal = typeof val === 'string' ? FilenameService.sanitize(val, 60, '') : String(val ?? '');
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\{${escapedKey}\\}`, 'g');
      result = result.replace(regex, () => safeVal);
    }

    // Clean up empty token residues (e.g. "r__u_author")
    result = result.replace(/_+/g, '_').replace(/^_|_$/g, '');

    const safeFile = FilenameService.sanitizeFilename(result, 120, 'media');
    return relDir ? FilenameService.sanitizePath(`${relDir}/${safeFile}`) : safeFile;
  }

  /**
   * Generates a unique timestamp string (YYYY-MM-DD_HH-mm-ss).
   * @returns {string}
   */
  static getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const secs = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${mins}-${secs}`;
  }
}
