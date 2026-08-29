/**
 * Social Media Downloader — Filename & Path Service
 * Sanitizes names, renders templates, and prevents path traversal attacks.
 */

export class FilenameService {
  /**
   * Sanitizes a single filename or directory segment.
   * Removes illegal filesystem characters and path traversal tokens.
   * @param {string} name
   * @param {number} [maxLen=80]
   * @param {string} [fallback='media']
   * @returns {string}
   */
  static sanitize(name, maxLen = 80, fallback = 'media') {
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

    // Prevent Windows reserved DOS filenames (CON, PRN, AUX, NUL, COM1..9, LPT1..9)
    const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
    if (reservedNames.test(clean)) {
      clean = `_${clean}`;
    }

    if (clean.length > maxLen) {
      clean = clean.slice(0, maxLen).replace(/^[\s._]+|[\s._]+$/g, '');
    }

    return clean || fallback;
  }

  /**
   * Sanitizes a filename while preserving its file extension intact.
   * @param {string} filename
   * @param {number} [maxLen=80]
   * @param {string} [fallback='media.jpg']
   * @returns {string}
   */
  static sanitizeFilename(filename, maxLen = 80, fallback = 'media.jpg') {
    if (!filename || typeof filename !== 'string') return fallback;
    const lastDot = filename.lastIndexOf('.');
    let base = filename;
    let ext = '';
    if (lastDot > 0 && lastDot < filename.length - 1 && filename.length - lastDot <= 10) {
      base = filename.slice(0, lastDot);
      ext = filename.slice(lastDot + 1);
    }
    const extLen = ext ? ext.length + 1 : 0;
    const safeBase = FilenameService.sanitize(base, Math.max(10, maxLen - extLen), 'media');
    const safeExt = ext ? FilenameService.sanitize(ext, 8, '').toLowerCase() : '';
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
      const safeSegment = isLast && segment.includes('.')
        ? FilenameService.sanitizeFilename(segment, 80, 'media')
        : FilenameService.sanitize(segment, 80, '');
      if (safeSegment) {
        safeSegments.push(safeSegment);
      }
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
      const regex = new RegExp(`\\{${key}\\}`, 'g');
      result = result.replace(regex, safeVal);
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
