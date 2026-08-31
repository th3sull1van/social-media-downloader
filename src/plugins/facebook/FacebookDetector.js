/**
 * Social Media Downloader — Facebook Target Detector
 */
import { PlatformTargetModel } from '../../core/domain/PlatformTarget.js';
import { FilenameService } from '../../core/services/FilenameService.js';

const FB_GENERIC_ROUTES = new Set([
  'home.php', 'watch', 'gaming', 'marketplace', 'groups', 'events', 'saved',
  'memories', 'pages', 'ads', 'messages', 'notifications', 'friends', 'bookmarks',
  'settings', 'help', 'login', 'recover', 'stories', 'reels', 'share', 'photo',
  'photos', 'media', 'permalink.php', 'story.php', 'search', 'photo.php', 'profile.php'
]);

const FB_GENERIC_TERMS = new Set([
  'facebook', 'notificações', 'notificacoes', 'notifications', 'notificaciones',
  'menu', 'navegação', 'navigation', 'feed', 'amigos', 'friends', 'fotos', 'photos',
  'álbuns', 'albuns', 'albums', 'sobre', 'about', 'watch', 'vídeos', 'videos',
  'marketplace', 'gaming', 'grupos', 'groups', 'mensagens', 'messages', 'pesquisar',
  'search', 'configurações', 'settings', 'ajuda', 'help', 'publicações', 'posts',
  'facebook_media', 'media_collection'
]);

function isHostOnDomain(hostname, domain) {
  if (typeof hostname !== 'string') return false;
  const normalized = hostname.toLowerCase().replace(/\.+$/, '');
  return normalized === domain || normalized.endsWith(`.${domain}`);
}

export class FacebookDetector {
  static matches(context) {
    if (!context) return false;
    let host = typeof context.hostname === 'string' ? context.hostname : '';
    if (!host && typeof context.url === 'string') {
      try { host = new URL(context.url).hostname; } catch (e) { return false; }
    }
    return isHostOnDomain(host, 'facebook.com');
  }

  static isGenericTerm(str) {
    if (!str || typeof str !== 'string') return true;
    const s = str.trim().toLowerCase();
    if (!s || s.length < 2) return true;
    if (FB_GENERIC_TERMS.has(s)) return true;
    if (s === 'facebook' || s.startsWith('facebook ') || (s.startsWith('facebook') && (s.includes('entre') || s.includes('log in') || s.includes('sign up')))) return true;
    return false;
  }

  static cleanTitle(title) {
    if (!title || typeof title !== 'string') return '';
    let cleaned = title
      .replace(/^\s*[\(\[]\s*\d+\+?\s*[\)\]]\s*/, '')
      .replace(/\s*(?:\||–|—|-|•)\s*Facebook(?:\s*\(.*\))?\s*$/i, '')
      .replace(/\s+(?:on|no|en|auf|sur|em)\s+Facebook\s*$/i, '')
      .replace(/\s*\|\s*Meta\s*$/i, '')
      .trim();

    const sectionMatch = cleaned.match(/^(.+?)\s*(?:[-–—|•:]\s*(?:Fotos|Photos|Sobre|About|Amigos|Friends|Vídeos|Videos|Reels|Álbuns|Albums))$/i);
    if (sectionMatch && sectionMatch[1] && !FacebookDetector.isGenericTerm(sectionMatch[1])) {
      cleaned = sectionMatch[1].trim();
    }

    return FacebookDetector.isGenericTerm(cleaned) ? '' : cleaned;
  }

  /**
   * Extracts a profile identity from the URL when the DOM offers none (SPA
   * photo-viewer dialogs wipe document.title and carry no og:title/h1).
   * Handles the observed link grammars (2026-08-29 capture):
   *   profile.php?id=<pid>            -> profile_<pid>
   *   /photo/?fbid=<fid>&set=pb.<pid>.<epoch>  -> profile_<pid>
   *   /photo/?fbid=<fid>&set=t.<pid>           -> profile_<pid>
   *   /photo/?fbid=<fid>&set=a.<album>[.<pid>[.<epoch>]] -> profile_<pid> (segment that differs from the album)
   *   /<slug>/photos/...              -> slug with dots spaced
   * Returns '' when nothing identity-bearing is found (caller decides fallback).
   */
  static nameFromUrl(urlStr) {
    try {
      const url = new URL(urlStr);
      const profileId = url.searchParams.get('id');
      if (profileId && /^\d+$/.test(profileId)) return `profile_${profileId}`;

      const setId = url.searchParams.get('set') || '';
      if (setId) {
        const segs = setId.split('.');
        if (/^pb$/i.test(segs[0]) && /^\d+$/.test(segs[1] || '')) return `profile_${segs[1]}`;
        if (/^t$/i.test(segs[0]) && /^\d+$/.test(segs[1] || '')) return `profile_${segs[1]}`;
        if (/^a$/i.test(segs[0])) {
          const pid = segs.slice(1).find((s) => /^\d+$/.test(s) && s.length >= 15 && s !== segs[1]);
          if (pid) return `profile_${pid}`;
        }
      }

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && parts[0] === 'people') {
        return parts[1].replace(/[-_+.]+/g, ' ').trim();
      }
      if (parts.length > 0 && !FB_GENERIC_ROUTES.has(parts[0].toLowerCase())) {
        return parts[0].replace(/\.\d+$/, '').replace(/\./g, ' ').trim();
      }
    } catch (e) {}
    return '';
  }

  static detectTarget(context = {}) {
    let urlStr = context.url || (typeof window !== 'undefined' ? window.location.href : '');
    let name = '';

    if (typeof document !== 'undefined') {
      name = FacebookDetector.cleanTitle(document.title);
      if (!name) {
        const h1 = document.querySelector('div[role="main"] h1, main h1, h1[dir="auto"], h1');
        const text = (h1?.textContent || '').trim();
        if (text && !FacebookDetector.isGenericTerm(text)) {
          name = text;
        }
      }
      if (!name) {
        const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
        if (ogTitle) {
          const cleanedOg = FacebookDetector.cleanTitle(ogTitle);
          if (cleanedOg && !FacebookDetector.isGenericTerm(cleanedOg)) {
            name = cleanedOg;
          }
        }
      }
    }

    if (!name && urlStr) {
      name = FacebookDetector.nameFromUrl(urlStr);
    }

    if (!name || FacebookDetector.isGenericTerm(name)) {
      name = 'Facebook_Media';
    }

    const safeName = FilenameService.sanitize(name, 80, 'Facebook_Media');

    return PlatformTargetModel.create({
      platform: 'facebook',
      type: 'album',
      id: safeName,
      name: safeName,
      url: urlStr,
      metadata: { rawName: name }
    });
  }
}
