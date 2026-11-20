import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { readCompactFixture } from '../../tools/fixture-replay.js';
import { createHighlightReplay } from '../../tools/replay-instagram-highlights.js';
import { replayContentScriptData } from '../../tools/replay-content.js';
import { InstagramNormalizer } from '../../src/plugins/instagram/InstagramNormalizer.js';
import { InstagramPlugin } from '../../src/plugins/instagram/InstagramPlugin.js';

export async function runInstagramHighlightsTests() {
  const capture = readCompactFixture(fileURLToPath(new URL('../fixtures/extracted/instagram/instagram-highlights-v3.json', import.meta.url)));
  const trayQuery = capture.queries[0];
  const mediaQuery = capture.queries[1];
  const reels = mediaQuery.body.data.xdt_api__v1__feed__reels_media__connection.edges.map(edge => edge.node);
  const expected = reels.flatMap(reel => reel.items.map(item => ({ ...item, _highlightTitle: reel.title })));
  const replay = createHighlightReplay(capture);
  const result = await replay.send();
  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.payload.items)), expected);
  assert.equal(expected.length, 26);
  assert.equal(replay.requests.length, 2, 'captured GraphQL path needs no REST request');
  assert.equal(replay.messages.filter(m => m.source === 'SMD_IG_BATCH_HIGHLIGHTS').length, 1);

  const content = await replayContentScriptData({ nodes: [], storyItems: [], highlightItems: result.payload.items });
  assert.equal(content.contentItems.length, 24, 'two captured media IDs occur in more than one album');
  assert.equal(content.fieldMismatches.length, 0);
  const seen = new Set();
  const normalized = expected.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).map(item => InstagramNormalizer.normalizeStory(item, 'highlights', item._highlightTitle));
  assert.deepEqual(content.contentItems.map(item => item.id), normalized.map(item => item.id));
  assert.deepEqual(content.contentItems.map(item => InstagramPlugin.getArchivePath(item, { targetName: 'example_user' })),
    normalized.map(item => InstagramPlugin.getArchivePath(item, { targetName: 'example_user' })));
  assert.ok(content.contentItems.every(item => item.metadata.category === 'highlights'));

  // A prior cancellation must not suppress a new independent highlight scan.
  await replay.send('CANCEL_SCAN');
  assert.equal((await replay.send()).payload.items.length, 26);

  // Reuse the captured feed when REST profile lookup is rate-limited.
  const profileReplay = createHighlightReplay(capture);
  const profile = await profileReplay.send('FETCH_IG_PROFILE', { username: 'example_user' });
  assert.equal(profile.payload.profile.id, trayQuery.variables.user_id);
  assert.equal(profileReplay.requests.filter(r => r.name === 'PolarisProfilePostsQuery').length, 1);
  const wrongAuthor = structuredClone(capture);
  wrongAuthor.profileFeed.body.data.xdt_api__v1__feed__user_timeline_graphql_connection.edges[0].node.user.username = 'another_user';
  assert.equal((await createHighlightReplay(wrongAuthor).send('FETCH_IG_PROFILE', { username: 'example_user' })).payload.profile.id, undefined);

  // Resolve target numeric user ID from page script when REST profile lookup is rate-limited and user has 0 posts.
  const scriptDomReplay = createHighlightReplay(capture, null, undefined, {
    querySelectorAll: selector => selector.includes('script')
      ? [{ textContent: '{"page_id":"profilePage_2199952056","profile_id":"2199952056","username":"zero_post_user"}' }]
      : [],
    querySelector: selector => selector.includes('og:image')
      ? { getAttribute: () => 'https://scontent.cdninstagram.com/v/test_avatar.jpg' }
      : null
  });
  const scriptProfile = await scriptDomReplay.send('FETCH_IG_PROFILE', { username: 'zero_post_user' });
  assert.equal(scriptProfile.payload.profile.id, '2199952056');
  assert.equal(scriptProfile.payload.profile.hdProfilePicUrl, 'https://scontent.cdninstagram.com/v/test_avatar.jpg');

  // Posts and stories expose transport failures instead of converting them to
  // successful empty scans; already collected post nodes remain partial.
  {
    const postsReplay = createHighlightReplay(capture, async request => {
      if (request.name === 'PolarisProfilePostsQuery') {
        const body = structuredClone(capture.profileFeed.body);
        const timeline = body.data.xdt_api__v1__feed__user_timeline_graphql_connection;
        timeline.edges = timeline.edges.slice(0, 1);
        timeline.page_info = { has_next_page: true, end_cursor: 'synthetic-next' };
        return { ok: true, json: async () => body };
      }
      return { ok: false, status: 429 };
    });
    const posts = await postsReplay.send('FETCH_IG_POSTS', { username: 'example_user', maxCount: 5000 });
    assert.equal(posts.success, false);
    assert.equal(posts.status, 'partial');
    assert.ok(posts.payload.nodes.length > 0);

    const storiesReplay = createHighlightReplay(capture, async request =>
      request.name ? { ok: false, status: 500 } : { ok: false, status: 429 });
    const stories = await storiesReplay.send('FETCH_IG_STORIES', { userId: 'synthetic-user' });
    assert.equal(stories.success, false);
    assert.equal(stories.status, 'network_failure');
    assert.equal(stories.payload.items.length, 0);
  }

  for (const mode of ['empty', 'tray-error', 'media-error', 'legacy', 'cancel']) {
    let harness;
    harness = createHighlightReplay(capture, async request => {
      if (request.name === trayQuery.name) {
        const body = structuredClone(trayQuery.body);
        if (mode === 'empty') body.data.highlights.edges = [];
        if (mode === 'tray-error') return { ok: true, json: async () => ({ errors: [{ message: 'synthetic error' }] }) };
        return { ok: true, json: async () => body };
      }
      if (request.name === mediaQuery.name) {
        if (mode === 'cancel') {
          await harness.send('CANCEL_SCAN');
          return { ok: true, json: async () => structuredClone(mediaQuery.body) };
        }
        return { ok: true, json: async () => ({ errors: [{ message: 'synthetic error' }] }) };
      }
      if (mode === 'legacy') return { ok: true, json: async () => ({ reels: Object.fromEntries(reels.map(reel => [reel.id, reel])) }) };
      return { ok: false, status: 429 };
    });
    const response = await harness.send();
    if (mode === 'tray-error' || mode === 'media-error') assert.equal(response.success, false, mode);
    else assert.equal(response.payload.items.length, mode === 'legacy' ? 26 : 0, mode);
    if (mode === 'cancel') assert.equal(harness.messages.filter(m => m.source === 'SMD_IG_BATCH_HIGHLIGHTS').length, 0);
  }

  // [P1-06] Repeated end_cursor must terminate fetchAllPosts immediately instead of looping.
  {
    let postRequests = 0;
    const cursorLoopReplay = createHighlightReplay(capture, async (request) => {
      if (request.name === 'PolarisProfilePostsQuery' || request.name === 'PolarisProfilePostsTabContentQuery_connection') {
        postRequests++;
        const body = structuredClone(capture.profileFeed.body);
        const timeline = body.data.xdt_api__v1__feed__user_timeline_graphql_connection;
        timeline.edges = timeline.edges.slice(0, 1);
        timeline.page_info = { has_next_page: true, end_cursor: 'stuck-cursor' };
        return { ok: true, json: async () => body };
      }
      return { ok: false, status: 429 };
    });
    const loopRes = await cursorLoopReplay.send('FETCH_IG_POSTS', { username: 'example_user', maxCount: 5000 });
    assert.equal(loopRes.success, true);
    assert.equal(postRequests, 2, 'repeating end_cursor must stop after the second page');
    assert.equal(loopRes.payload.nodes.length, 2);
  }

  // v1.2.2 primary stories path: PolarisStoriesV3ReelPageStandaloneQuery returns items without REST calls.
  {
    const graphqlRequests = [];
    const storiesGraphqlReplay = createHighlightReplay(capture, async (request) => {
      graphqlRequests.push(request);
      if (request.name === 'PolarisStoriesV3ReelPageStandaloneQuery') {
        return {
          ok: true,
          json: async () => ({
            data: {
              xdt_api__v1__feed__reels_media: {
                reels_media: [{ id: '12345', items: [{ id: 'st_1', pk: 'st_1', media_type: 1 }] }]
              }
            }
          })
        };
      }
      return { ok: false, status: 500 };
    });
    const stRes = await storiesGraphqlReplay.send('FETCH_IG_STORIES', { userId: '12345' });
    assert.equal(stRes.success, true);
    assert.equal(stRes.status, 'success');
    assert.equal(stRes.payload.items.length, 1);
    assert.equal(graphqlRequests.length, 1);
    assert.equal(graphqlRequests[0].name, 'PolarisStoriesV3ReelPageStandaloneQuery');
  }

  // [P1-01] history.replaceState during an in-flight scan notifies navigation without cancelling the active scan.
  {
    const injectedSource = fs.readFileSync(new URL('../../src/plugins/instagram/main-world/injected.js', import.meta.url), 'utf8');
    const messages = [];
    /** @type {any} */
    let listener = null;
    const context = vm.createContext({
      URLSearchParams,
      console: { log() {}, info() {}, warn() {}, error() {} },
      document: { cookie: '', querySelector: () => null, querySelectorAll: () => [] },
      location: { href: 'https://www.instagram.com/example_user/' },
      history: {
        pushState(_s, _t, url) { if (url) context.location.href = String(url); },
        replaceState(_s, _t, url) { if (url) context.location.href = String(url); }
      },
      setTimeout: (fn) => { queueMicrotask(fn); return 0; },
      addEventListener: (type, fn) => { if (type === 'message') listener = fn; },
      postMessage: (msg) => messages.push(msg),
      require: (mod) => {
        const q = capture.queries.find((x) => mod.startsWith(x.name));
        return q ? q.docId : undefined;
      },
      fetch: async (_url, options) => {
        const params = new URLSearchParams(options?.body || '');
        const name = params.get('fb_api_req_friendly_name');
        const query = capture.queries.find((q) => q.name === name);
        if (name === mediaQuery.name) {
          context.history.replaceState({}, '', 'https://www.instagram.com/example_user/?img_index=2');
        }
        if (!query) return { ok: false, status: 429 };
        return { ok: true, json: async () => structuredClone(query.body) };
      }
    });
    vm.runInContext('window = globalThis; window.top = window;', context);
    vm.runInContext(injectedSource, context);
    const realm = vm.runInContext('globalThis', context);
    assert.equal(typeof listener, 'function');
    await listener({
      source: realm,
      data: {
        source: 'SMD_CONTENT',
        nonce: 'nav-nonce',
        requestId: 'req-nav-1',
        type: 'FETCH_IG_HIGHLIGHTS',
        payload: { userId: trayQuery.variables.user_id }
      }
    });
    const navMsg = messages.find((m) => m.source === 'SMD_IG_NAVIGATION_CHANGED');
    const hlReply = messages.find((m) => m.requestId === 'req-nav-1');
    assert.ok(navMsg, 'replaceState must post SMD_IG_NAVIGATION_CHANGED');
    assert.equal(navMsg.nonce, 'nav-nonce');
    assert.equal(hlReply.success, true, 'replaceState must not cancel the active highlight scan');
    assert.equal(hlReply.payload.items.length, 26);
  }

  // [instagram-profile-v5] Benign partial GraphQL field_exception on an intact timeline page
  // must NOT flip scanStatus to 'partial' (which previously surfaced scanFailed when 100% of
  // media succeeded), and hardcoded DOC_IDS must match November 2026 Relay operation IDs.
  {
    const v5Fixture = readCompactFixture(fileURLToPath(new URL('../fixtures/extracted/instagram/instagram-profile-v5.json', import.meta.url)));
    assert.equal(v5Fixture.timelineQueries.length, 2);

    const v5Requests = [];
    const v5Replay = createHighlightReplay({ queries: [], profileFeed: null }, async (request) => {
      v5Requests.push(request);
      const q = v5Fixture.timelineQueries.find((entry) => entry.name === request.name);
      if (q) return { ok: true, json: async () => structuredClone(q.body) };
      return { ok: false, status: 404 };
    });
    const v5Res = await v5Replay.send('FETCH_IG_POSTS', { username: 'example_user', maxCount: 5000 });
    assert.equal(v5Res.success, true, 'benign sub-field field_exception must not fail an intact timeline scan');
    assert.equal(v5Res.status, 'success');
    assert.equal(v5Res.payload.nodes.length, 42);
    assert.equal(v5Requests[0].docId, '29682302384688964');
    assert.equal(v5Requests[1].docId, '29246820014972723');

    // Negative case: when errors[] accompanies a null/broken edge or media-less node, scan MUST report partial.
    const brokenBody = structuredClone(v5Fixture.timelineQueries[0].body);
    brokenBody.data.xdt_api__v1__feed__user_timeline_graphql_connection.page_info = { has_next_page: false, end_cursor: null };
    brokenBody.data.xdt_api__v1__feed__user_timeline_graphql_connection.edges[27] = { node: null };
    const brokenReplay = createHighlightReplay({ queries: [], profileFeed: null }, async (request) => {
      if (request.name === 'PolarisProfilePostsQuery') return { ok: true, json: async () => structuredClone(brokenBody) };
      return { ok: false, status: 404 };
    });
    const brokenRes = await brokenReplay.send('FETCH_IG_POSTS', { username: 'example_user', maxCount: 5000 });
    assert.equal(brokenRes.success, false, 'errors[] with null edge must still report partial');
    assert.equal(brokenRes.status, 'partial');
    assert.equal(brokenRes.payload.nodes.length, 32);

    // Highlights GraphQL also tolerates benign field_exception on intact tray edges & reel media items (0 REST fallbacks).
    const hlErrRequests = [];
    const hlErrReplay = createHighlightReplay(capture, async (request) => {
      hlErrRequests.push(request);
      if (request.name === trayQuery.name) {
        const b = structuredClone(trayQuery.body);
        b.errors = [{ message: 'A server error field_exception occured.' }];
        return { ok: true, json: async () => b };
      }
      if (request.name === mediaQuery.name) {
        const b = structuredClone(mediaQuery.body);
        b.errors = [{ message: 'A server error field_exception occured.' }];
        return { ok: true, json: async () => b };
      }
      return { ok: false, status: 500 };
    });
    const hlErrRes = await hlErrReplay.send();
    assert.equal(hlErrRes.success, true, 'benign field_exception on intact highlight edges/items must stay success');
    assert.equal(hlErrRes.status, 'success');
    assert.equal(hlErrRes.payload.items.length, 26);
    assert.equal(hlErrRequests.every((r) => Boolean(r.name)), true, 'must not fall back to REST when GraphQL items are intact');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await runInstagramHighlightsTests();
