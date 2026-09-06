/** Replay only captured highlight queries; never contact Instagram or print private payloads. */
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { decodeEntryBody } from './har-replay.js';

export function readHighlightCapture(harPath) {
  const entries = JSON.parse(fs.readFileSync(harPath, 'utf8')).log.entries;
  const queries = [];
  let profileFeed;
  for (const entry of entries) {
    const params = new URLSearchParams(entry.request.postData?.text || '');
    const name = params.get('fb_api_req_friendly_name');
    if (name === 'PolarisProfilePostsQuery' && params.get('doc_id') === '26519258537772635' && entry.response.status === 200) {
      profileFeed = { name, docId: params.get('doc_id'), variables: JSON.parse(params.get('variables')),
        body: JSON.parse(decodeEntryBody(entry)) };
    }
    if (!['PolarisProfileStoryHighlightsTrayContentQuery', 'PolarisStoriesV3HighlightsPageQuery'].includes(name)) continue;
    if (entry.response.status !== 200) continue;
    queries.push({ name, docId: params.get('doc_id'), variables: JSON.parse(params.get('variables')),
      body: JSON.parse(decodeEntryBody(entry)) });
  }
  if (queries.length < 2) throw new Error('Highlight tray and media responses are required');
  return { queries, profileFeed };
}

export function createHighlightReplay(capture, respond = null,
  source = fs.readFileSync(new URL('../src/plugins/instagram/main-world/injected.js', import.meta.url), 'utf8')) {
  const messages = [];
  const requests = [];
  let sequence = 0;
  let listener;
  const context = vm.createContext({
    URLSearchParams,
    console: { log() {}, info() {}, warn() {}, error() {} },
    document: { cookie: '', querySelector: () => null, querySelectorAll: () => [] },
    setTimeout: (fn) => { queueMicrotask(fn); return 0; },
    addEventListener: (type, fn) => { if (type === 'message') listener = fn; },
    postMessage: message => messages.push(message),
    fetch: async (url, options) => {
      const params = new URLSearchParams(options?.body || '');
      const request = { url, name: params.get('fb_api_req_friendly_name'), docId: params.get('doc_id'),
        variables: JSON.parse(params.get('variables') || '{}') };
      requests.push(request);
      if (respond) return respond(request);
      const query = [...capture.queries, capture.profileFeed].find(q => q?.name === request.name);
      if (!query) return { ok: false, status: url.includes('web_profile_info') ? 429 : 404 };
      if (request.docId !== query.docId || Object.keys(query.variables).some(key =>
        JSON.stringify(query.variables[key]) !== JSON.stringify(request.variables[key]))) {
        throw new Error('Request differs from captured highlight operation');
      }
      return { ok: true, json: async () => structuredClone(query.body) };
    }
  });
  vm.runInContext('window = globalThis; window.top = window;', context);
  vm.runInContext(source, context);
  const realm = vm.runInContext('globalThis', context);
  return {
    messages, requests,
    async send(type = 'FETCH_IG_HIGHLIGHTS', payload = /** @type {any} */ ({ userId: capture.queries[0].variables.user_id })) {
      const requestId = `request-${++sequence}`;
      await listener({ source: realm, data: { source: 'SMD_CONTENT', nonce: 'fixture-nonce', requestId, type,
        payload } });
      return messages.find(message => message.requestId === requestId);
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const capture = readHighlightCapture(process.argv[2]);
  const replay = createHighlightReplay(capture);
  const result = await replay.send();
  const expected = capture.queries.find(q => q.body.data?.xdt_api__v1__feed__reels_media__connection)
    .body.data.xdt_api__v1__feed__reels_media__connection.edges.flatMap(({ node }) =>
      node.items.map(item => ({ ...item, _highlightTitle: node.title })));
  const actual = result?.payload?.items || [];
  const matches = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(JSON.stringify({ expected: expected.length, actual: actual.length, exactPayloadAndOrderMatch: matches,
    success: result?.success, uncapturedRequests: replay.requests.filter(r => !r.name).length }));
  if (!matches || !result?.success) process.exitCode = 1;
}
