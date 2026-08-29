/**
 * Social Media Downloader — Meta Shared CDN Utilities
 * Upgrades Instagram & Facebook CDN URLs safely without invalidating cryptographic HMAC signatures.
 */

export class MetaCdn {
  /**
   * Upgrades Meta (Instagram / Facebook) CDN media URL to full resolution.
   * Preserves HMAC signatures (oh, oe, _nc_*) to prevent HTTP 403 Forbidden.
   * @param {string} url
   * @returns {string}
   */
  static upgradeUrl(url, platform = 'instagram') {
    if (!url || typeof url !== 'string') return url;
    try {
      const parsed = new URL(url);

      // Instagram signed URLs (oh/_nc_ohc/_nc_sid) are returned VERBATIM:
      // `stp` is part of the HMAC — stripping it produces "URL signature
      // mismatch" (HTTP 403), observed on 2026-08-28 captures (571/676 media
      // requests 403, reproduced byte-exactly).
      if (platform !== 'facebook') {
        if (parsed.searchParams.has('oh') || parsed.searchParams.has('_nc_ohc') || parsed.searchParams.has('_nc_sid')) {
          return url;
        }
      }

      // Facebook (validated live against fixtures-private captures, 2026-08-29,
      // 66+ distinct signed URLs): the `oh`/`oe` HMAC covers the path and every
      // `_nc_*` param but NOT `ctp` — rewriting `ctp` to the dimensions carried
      // by `cstp` (the max render the CDN guarantees) returns HTTP 200 and a
      // strictly larger payload, while touching `stp`/path DOES 403. So the
      // max-res strategy for Facebook is: request cstp's full render via ctp.
      if (platform === 'facebook') {
        const cstp = /^m?x?(\d+)x(\d+)$/.exec(parsed.searchParams.get('cstp') || '');
        const ctp = /^s?p?(\d+)x(\d+)$/.exec(parsed.searchParams.get('ctp') || '');
        if (cstp) {
          const maxArea = Number(cstp[1]) * Number(cstp[2]);
          if (!ctp || Number(ctp[1]) * Number(ctp[2]) < maxArea) {
            if (ctp) parsed.searchParams.set('ctp', `s${cstp[1]}x${cstp[2]}`);
            else parsed.searchParams.append('ctp', `s${cstp[1]}x${cstp[2]}`);
            return parsed.toString();
          }
          return url;
        }
      }

      // Unsigned (or Instagram-unsigned) URLs: legacy crop/resize directives
      // may be stripped (they are applied by the CDN after the URL is generated).
      let modified = false;

      // 1. Remove Facebook thumbnail downscale parameter
      if (parsed.searchParams.has('cstp') && parsed.searchParams.has('ctp')) {
        parsed.searchParams.delete('ctp');
        modified = true;
      }

      const stp = parsed.searchParams.get('stp');
      if (stp && /[sp]?\d+x\d+/.test(stp)) {
        parsed.searchParams.delete('stp');
        modified = true;
      }

      // 2. Remove thumbnail crop/resize path segments: /s206x206/, /p206x206/, /c0.0.206.206a/, /s150x150/, etc.
      const pathRegex = /\/(?:[sp]\d+x\d+|c\d+\.\d+\.\d+\.\d+[a-z]?)(?=\/)/g;
      if (pathRegex.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(pathRegex, '');
        modified = true;
      }

      return modified ? parsed.toString() : url;
    } catch (e) {
      return url;
    }
  }

  /**
   * Detects whether a Meta CDN media URL is a downscaled thumbnail render.
   * @param {string} url
   * @returns {boolean}
   */
  static isDownscaledRender(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const u = new URL(url);
      const ctp = /(\d+)x(\d+)/i.exec(u.searchParams.get('ctp') || '');
      const cstp = /(\d+)x(\d+)/i.exec(u.searchParams.get('cstp') || '');
      if (ctp && cstp) {
        const requested = Number(ctp[1]) * Number(ctp[2]);
        const available = Number(cstp[1]) * Number(cstp[2]);
        if (requested < available) return true;
      }
      const stp = u.searchParams.get('stp') || '';
      if (/[?&]stp=[^&]*[sc]\d+x\d+/i.test(url) || /c\d+\.\d+\.\d+\.\d+/i.test(stp)) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }
}
