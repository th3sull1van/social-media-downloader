/**
 * Diagnostic: list every node in a Facebook HAR that extractPhotosFromGraphQL
 * would emit as a photo MediaItem, with the typename, path, and the reason the
 * current filter accepted it. Also walks api/graphql/ responses (Reels/aggregated
 * content) so cross-page navigations like /photos -> /reels are covered.
 *
 * Usage:
 *   bun tools/diag-fb-photo-leaks.js <har-path>
 *   bun tools/diag-fb-photo-leaks.js fixtures-private/facebook-reels.har
 */
import fs from 'node:fs';

const harPath = process.argv[2] || 'fixtures-private/facebook-profile.har';

function extractEmbeddedJson(html) {
  const out = [];
  const re = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1])); } catch { /* skip malformed */ }
  }
  return out;
}

// Some Facebook responses are JSON protected with a `for (;;);` prefix
// (CSRF guard). Strip the prefix and any leading `/*...*/` comment block.
function safeParseJson(raw) {
  if (!raw) return null;
  let t = String(raw).trimStart();
  if (t.startsWith('for')) {
    const i = t.indexOf('{');
    if (i < 0) return null;
    t = t.slice(i).replace(/;\s*$/, '');
  }
  if (t.startsWith('/*')) {
    const end = t.indexOf('*/');
    if (end < 0) return null;
    t = t.slice(end + 2).trimStart();
  }
  try { return JSON.parse(t); } catch { return null; }
}

const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
const VIDEO_HINTS = /video|reel|playable|stream|short/i;

// --- 1) collect payloads from every relevant response (HTML + GraphQL) ---
const sources = []; // { kind, url, payloads: parsed[] }
for (const e of har.log.entries) {
  const u = e.request?.url || '';
  const ct = e.response?.content?.mimeType || '';
  const text = e.response?.content?.text;
  if (!text) continue;
  if (!/api\/graphql|bnzai|bulk-route-definitions|relay-ef|ajax|graphql|html/i.test(u)) continue;

  // Path A: HTML pages. Pull every <script type="application/json"> blob.
  if (/html/i.test(ct) && !/^\s*[\{<\[]/.test(text)) {
    const payloads = extractEmbeddedJson(text);
    if (payloads.length) sources.push({ kind: 'html', url: u, payloads });
    continue;
  }

  // Path B: JSON or JSON-in-HTML. Facebook returns `text/html` for graphql
  // responses (CORS bypass) with the body starting with `{`. Also strip
  // known CSRF prefixes (`for (;;);`, `/*...*/`).
  const parsed = safeParseJson(text);
  if (!parsed) continue;
  const collected = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.data || node.payload || node.payloads) {
      if (node.data) visit(node.data);
      if (node.payload) visit(node.payload);
      if (node.payloads && typeof node.payloads === 'object') visit(node.payloads);
      return;
    }
    collected.push(node);
  };
  visit(parsed);
  if (collected.length) sources.push({ kind: 'graphql', url: u, payloads: collected });
}

console.log(`sources collected: ${sources.length} (HTML + GraphQL/ajax responses)`);

// --- 2) walker: emit every node that the current filter accepts as photo ---
function* walk(o, d = 0, path = '') {
  if (!o || typeof o !== 'object' || d > 40) return;
  if (Array.isArray(o)) {
    for (let i = 0; i < o.length; i++) yield* walk(o[i], d + 1, `${path}[${i}]`);
    return;
  }
  yield [o, d, path];
  for (const k of Object.keys(o)) {
    if (k === 'extensions' || (k === 'viewer' && d > 2)) continue;
    yield* walk(o[k], d + 1, `${path}.${k}`);
  }
}

const seen = new Map(); // id -> { count, samples, kinds }
let emitting = 0;

for (const src of sources) {
  for (const payload of src.payloads) {
    for (const [node, depth, path] of walk(payload)) {
      if (!node || typeof node !== 'object') continue;
      const hasCollectionTile = node.__typename === 'TimelineAppCollectionItem' || 'collection_item_type' in node;
      const isVideoNode =
        node.__typename === 'Video' ||
        node.__typename === 'ReelsTrayItem' ||
        !!node.playable_url ||
        !!node.playable_url_dash;
      const isPhoto =
        (node.__typename === 'Photo' || !!node.viewer_image?.uri) && !hasCollectionTile && !isVideoNode;
      const hasImageWithId =
        !!(node.image?.uri && (node.id || node.photo_id) && !node.profile_picture) &&
        !hasCollectionTile &&
        !isVideoNode;
      if (!(isPhoto || hasImageWithId)) continue;
      emitting++;
      const id = node.id || node.photo_id || 'NO_ID';
      const typename = node.__typename || '(no __typename)';
      const reason = isPhoto ? 'isPhoto' : 'hasImageWithId';
      const videoKeys = Object.keys(node).filter((k) => VIDEO_HINTS.test(k));
      const url = (node.viewer_image?.uri || node.image?.uri || '').slice(0, 90);
      const entry = seen.get(id) || { count: 0, samples: [] };
      entry.count++;
      if (entry.samples.length < 3) {
        entry.samples.push({ kind: src.kind, url: src.url.slice(0, 90), path, depth, typename, reason, videoKeys, urlShort: url });
      }
      seen.set(id, entry);
    }
  }
}

console.log(`emitting nodes (raw walker count): ${emitting}`);
console.log(`unique IDs: ${seen.size}`);

const dups = [...seen.entries()].filter(([, v]) => v.count > 1).sort((a, b) => b[1].count - a[1].count);
console.log('---');
if (dups.length === 0) {
  console.log('No duplicate IDs across emitting nodes.');
} else {
  console.log(`Duplicate IDs (likely Reel/video leaking as photo): ${dups.length}`);
  for (const [id, v] of dups) {
    console.log(`  id=${id} x${v.count}`);
    for (const s of v.samples) {
      console.log(`    [${s.kind}] depth=${s.depth} ${s.typename}|${s.reason}`);
      if (s.videoKeys.length) console.log(`      video-keys: ${s.videoKeys.join(',')}`);
      console.log(`      path: ${s.path}`);
      console.log(`      src : ${s.url}`);
      console.log(`      url : ${s.urlShort}`);
    }
  }
}

console.log('---');
console.log('All emitting nodes (for filtering review):');
for (const [id, v] of [...seen.entries()].sort((a, b) => b[1].count - a[1].count)) {
  const s = v.samples[0];
  console.log(`  id=${id}  [${s.kind}]  ${s.typename}|${s.reason}  depth=${s.depth}` + (s.videoKeys.length ? `  video-keys=${s.videoKeys.join(',')}` : ''));
}
