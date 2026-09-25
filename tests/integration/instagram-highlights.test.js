import assert from 'node:assert/strict';
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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await runInstagramHighlightsTests();
