/**
 * Minimal DOM facade for HAR replay of Reddit/Facebook scanners.
 * Implements exactly the surface the scanners use (getAttribute, hasAttribute,
 * querySelector(All) with the scanner's selector strings) over regex-parsed HTML.
 * Not a general DOM: selectors are matched with a small engine supporting
 * tag / tag[attr], tag[attr*="v"], tag[attr="v"], [attr], and descendant combinators.
 */

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Parses an opening tag string into { tag, attrs }.
 * @param {string} openTagHtml e.g. '<img src="x" alt="y">'
 */
export function parseOpenTag(openTagHtml) {
  const m = openTagHtml.match(/^<([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*)>?$/);
  if (!m) return null;
  const attrs = {};
  for (const am of m[2].matchAll(/([a-zA-Z][a-zA-Z0-9-]*)(?:="([^"]*)")?/g)) {
    attrs[am[1].toLowerCase()] = am[2] !== undefined ? decodeEntities(am[2]) : '';
  }
  return { tag: m[1].toLowerCase(), attrs };
}

/**
 * Finds all elements matching one simple selector (single compound, no commas).
 * Supports: tag, tag[attr], tag[attr*="v"], tag[attr="v"], [attr*="v"].
 */
function matchSimple(html, simple) {
  const parts = simple.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];

  /** @type {Array<{ node: any, index: number, openTagHtml: string }>} */
  let candidates = [];

  // Candidate enumeration from the LAST part (most specific), then filter ancestors.
  const last = parts[parts.length - 1];
  const lastTagMatch = last.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
  const lastTag = lastTagMatch ? lastTagMatch[1].toLowerCase() : '*';
  const lastPreds = [...last.matchAll(/\[([a-zA-Z-]+)(?:\*?="([^"]*)")?\]/g)];

  const tagRegex = lastTag === '*' ? /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g
    : new RegExp(`<${lastTag}\\b[^>]*>`, 'gi');
  for (const em of html.matchAll(tagRegex)) {
    const parsed = parseOpenTag(em[0]);
    if (!parsed) continue;
    let ok = true;
    for (const [attr, , ] of lastPreds) {
      // placeholder, replaced below
      void attr;
    }
    for (const pred of lastPreds) {
      const attr = pred[1].toLowerCase();
      const value = pred[2];
      if (value === undefined) {
        if (!(attr in parsed.attrs)) { ok = false; break; }
      } else if (pred[0].includes('*="')) {
        if (!(attr in parsed.attrs) || !parsed.attrs[attr].includes(value)) { ok = false; break; }
      } else {
        if (parsed.attrs[attr] !== value) { ok = false; break; }
      }
    }
    if (ok) candidates.push(/** @type {any} */ ({ node: parsed, index: em.index || 0, openTagHtml: em[0] }));
  }

  // Ancestor checks (outer parts), searching the HTML BEFORE the candidate.
  for (let p = parts.length - 2; p >= 0; p--) {
    const ancestorSpec = parts[p];
    const aTagMatch = ancestorSpec.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
    const aTag = aTagMatch ? aTagMatch[1].toLowerCase() : '*';
    const aPreds = [...ancestorSpec.matchAll(/\[([a-zA-Z-]+)(?:\*?="([^"]*)")?\]/g)];
    candidates = candidates.filter((c) => {
      const before = html.slice(0, c.index);
      const aRegex = aTag === '*' ? /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g
        : new RegExp(`<${aTag}\\b[^>]*>`, 'gi');
      for (const am of before.matchAll(aRegex)) {
        const parsed = parseOpenTag(am[0]);
        if (!parsed) continue;
        let ok = true;
        for (const pred of aPreds) {
          const attr = pred[1].toLowerCase();
          const value = pred[2];
          if (value === undefined) {
            if (!(attr in parsed.attrs)) { ok = false; break; }
          } else if (pred[0].includes('*="')) {
            if (!(attr in parsed.attrs) || !parsed.attrs[attr].includes(value)) { ok = false; break; }
          } else {
            if (parsed.attrs[attr] !== value) { ok = false; break; }
          }
        }
        if (ok) return true;
      }
      return false;
    });
  }

  return candidates;
}

/**
 * querySelectorAll over raw HTML with a comma-separated selector list.
 * @param {string} html
 * @param {string} selector
 * @returns {any[]}
 */
export function querySelectorAllHtml(html, selector) {
  if (!html || !selector) return [];
  const results = [];
  const seen = new Set();
  for (const simple of selector.split(',')) {
    for (const c of matchSimple(html, simple)) {
      const key = `${c.index}:${c.node.tag}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(makeElement(c.node, html, c.index));
    }
  }
  return results;
}

/**
 * Wraps a parsed opening tag into the element surface the scanners use.
 */
/**
 * @param {any} parsed
 * @param {string} parentHtml
 * @param {number} index
 */
export function makeElement(parsed, parentHtml, index) {
  const el = {
    tagName: parsed.tag,
    attrs: parsed.attrs,
    __html: parentHtml ? parentHtml.slice(index, index + 20000) : '',
    getAttribute(name) {
      const v = this.attrs[String(name).toLowerCase()];
      return v === undefined ? null : v;
    },
    hasAttribute(name) {
      return String(name).toLowerCase() in this.attrs;
    },
    get src() { return this.attrs.src || ''; },
    get currentSrc() { return this.attrs.src || ''; },
    get href() { return this.attrs.href || ''; },
    get naturalWidth() { return parseInt(this.attrs.width || '0', 10) || 0; },
    get naturalHeight() { return parseInt(this.attrs.height || '0', 10) || 0; },
    get clientWidth() { return 0; },
    get clientHeight() { return 0; },
    get innerText() { return this.attrs.title || ''; },
    get textContent() { return this.attrs.title || ''; },
    closest() { return null; },
    querySelector(sel) {
      const hits = querySelectorAllHtml(this.__html, sel);
      return hits[0] || null;
    },
    querySelectorAll(sel) {
      return querySelectorAllHtml(this.__html, sel);
    },
    get shadowRoot() { return null; }
  };
  return el;
}

/**
 * Builds a document-like facade exposing shreddit-post elements parsed from raw HTML.
 * Surface used by RedditScanner.extractMediaFromDocument.
 * @param {string} html
 */
export function makeRedditDocument(html) {
  const openings = [...html.matchAll(/<shreddit-post\s/g)];
  const posts = [];
  const seen = new Set();
  for (let i = 0; i < openings.length; i++) {
    const start = openings[i].index || 0;
    const end = i + 1 < openings.length ? openings[i + 1].index : Math.min(html.length, start + 60000);
    const chunk = html.slice(start, end);
    const openTag = chunk.match(/^<shreddit-post\s([^>]*)>/);
    if (!openTag) continue;
    const parsed = parseOpenTag(`<shreddit-post ${openTag[1]}>`);
    if (!parsed || !parsed.attrs.id || seen.has(parsed.attrs.id)) continue;
    seen.add(parsed.attrs.id);
    posts.push(makeElement(parsed, chunk, 0));
  }
  return {
    querySelectorAll(sel) {
      if (sel === 'shreddit-post') return posts;
      return [];
    }
  };
}
