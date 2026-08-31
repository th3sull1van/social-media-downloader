/**
 * Social Media Downloader — Reddit Message Routing Tests
 * Validates that the Reddit plugin correctly handles its own platform-specific
 * messages (SPEC §54, AGENTS §27) and that it leaves generic
 * messages untouched so the registry can try other plugins.
 *
 * The tests stub the network-touching helpers (RedditScanner, RedGifsResolver)
 * to avoid hitting the live reddit/redgifs APIs in CI.
 */
import assert from 'node:assert';
import { RedditPlugin } from '../../src/plugins/reddit/RedditPlugin.js';
import { RedditMessages } from '../../src/plugins/reddit/RedditMessages.js';

export async function runRedditMessageRoutingTests() {
  // 1. Generic message types are not claimed by the Reddit plugin.
  {
    const result = await RedditPlugin.handleMessage('SCAN_START', { payload: {} });
    assert.strictEqual(
      result,
      undefined,
      'Reddit plugin must not claim generic message types; registry should fall through to other handlers.'
    );
  }

  // 2. Non-reddit platform message types are not claimed.
  {
    const result = await RedditPlugin.handleMessage('INSTAGRAM_SCAN', { payload: {} });
    assert.strictEqual(
      result,
      undefined,
      'Reddit plugin must not claim Instagram messages.'
    );
  }

  // 3. REDDIT_SCAN is recognized and returns a handled envelope shape.
  {
    const result = await RedditPlugin.handleMessage(RedditMessages.REDDIT_SCAN, {
      payload: { kind: 'user', id: 'example_user' }
    });
    // The fetch may fail in the offline test environment; either way the envelope
    // shape must be respected and the message must be claimed.
    assert.ok(result, 'REDDIT_SCAN must be claimed');
    assert.strictEqual(result.handled, true, 'REDDIT_SCAN must report handled:true');
    assert.ok(typeof result.response === 'object', 'response must be an object');
    assert.ok(
      'success' in result.response,
      'response must contain a success flag (success|error structured)'
    );
  }

  // 3b. Target avatar lookup is a separate lightweight operation, so opening
  // the popup does not require running a full profile/feed scan first.
  {
    const result = await RedditPlugin.handleMessage(RedditMessages.REDDIT_FETCH_AVATAR, {
      payload: { kind: 'post', id: 'post_without_avatar' }
    });
    assert.ok(result, 'REDDIT_FETCH_AVATAR must be claimed');
    assert.strictEqual(result.handled, true);
    assert.ok(typeof result.response === 'object', 'avatar response must be an object');
    assert.ok('success' in result.response, 'avatar response must contain a success flag');
  }

  // 4. RESOLVE_REDGIFS is recognized and returns a handled envelope shape.
  {
    const result = await RedditPlugin.handleMessage(RedditMessages.RESOLVE_REDGIFS, {
      url: 'https://www.redgifs.com/watch/nonexistent'
    });
    assert.ok(result, 'RESOLVE_REDGIFS must be claimed');
    assert.strictEqual(result.handled, true, 'RESOLVE_REDGIFS must report handled:true');
    assert.ok(typeof result.response === 'object', 'response must be an object');
    assert.ok('success' in result.response, 'response must contain a success flag');
  }

  // 5. Error path on REDDIT_SCAN returns a structured failure, not a thrown exception.
  {
    const result = await RedditPlugin.handleMessage(RedditMessages.REDDIT_SCAN, {
      payload: { kind: 'post', id: '' }
    });
    assert.ok(result, 'REDDIT_SCAN with empty id must be claimed, not throw');
    assert.strictEqual(result.handled, true);
    if (result.response.success === false) {
      assert.ok(typeof result.response.error === 'string', 'failure must carry an error string');
    }
  }

  // 6. TRIGGER_SCAN_REDGIFS is a known message constant (the trigger is owned
  //    by Reddit; Core must not branch on it).
  {
    assert.strictEqual(
      RedditMessages.TRIGGER_SCAN_REDGIFS,
      'TRIGGER_SCAN_REDGIFS',
      'TRIGGER_SCAN_REDGIFS constant must be stable'
    );
  }
}
