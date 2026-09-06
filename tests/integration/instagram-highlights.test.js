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
