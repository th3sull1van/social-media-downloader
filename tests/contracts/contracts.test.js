/**
 * Social Media Downloader — Platform Plugin Contract Tests
 * Validates that Instagram, Facebook, and Reddit plugins satisfy all required
 * contract methods and shapes (SPEC §27, §91; AGENTS §69).
 */
import assert from 'node:assert';
import { defaultRegistry } from '../../src/core/application/PluginRegistry.js';
import { InstagramPlugin } from '../../src/plugins/instagram/InstagramPlugin.js';
import { FacebookPlugin } from '../../src/plugins/facebook/FacebookPlugin.js';
import { RedditPlugin } from '../../src/plugins/reddit/RedditPlugin.js';
import { RedditMessages } from '../../src/plugins/reddit/RedditMessages.js';

export async function runContractTests() {
  const plugins = [InstagramPlugin, FacebookPlugin, RedditPlugin];

  for (const Plugin of plugins) {
    // 1. Identification
    assert.ok(typeof Plugin.id === 'string' && Plugin.id.length > 0, `Plugin must have a string id`);
    assert.ok(typeof Plugin.version === 'string', `${Plugin.id} must have a version string`);

    // 2. Matching method
    assert.ok(typeof Plugin.matches === 'function', `${Plugin.id} must implement matches()`);

    // 3. Capabilities declaration
    assert.ok(typeof Plugin.getCapabilities === 'function', `${Plugin.id} must implement getCapabilities()`);
    const caps = Plugin.getCapabilities();
    assert.ok(typeof caps === 'object', `${Plugin.id} capabilities must be an object`);
    assert.ok(typeof caps.scan === 'object', `${Plugin.id} capabilities.scan must be an object`);
    assert.ok(typeof caps.media === 'object', `${Plugin.id} capabilities.media must be an object`);
    assert.ok(typeof caps.resolution === 'object', `${Plugin.id} capabilities.resolution must be an object`);
    assert.ok(typeof caps.download === 'object', `${Plugin.id} capabilities.download must be an object`);

    // 4. Target Detection
    assert.ok(typeof Plugin.detectTarget === 'function', `${Plugin.id} must implement detectTarget()`);

    // 5. Normalization
    assert.ok(typeof Plugin.normalize === 'function', `${Plugin.id} must implement normalize()`);

    // 6. Filename & Archive path generators
    assert.ok(typeof Plugin.getFilename === 'function', `${Plugin.id} must implement getFilename()`);
    assert.ok(typeof Plugin.getArchivePath === 'function', `${Plugin.id} must implement getArchivePath()`);

    // 7. Filters
    assert.ok(typeof Plugin.getFilters === 'function', `${Plugin.id} must implement getFilters()`);
    const filters = Plugin.getFilters();
    assert.ok(Array.isArray(filters) && filters.length > 0, `${Plugin.id} must provide filter definitions`);

    // 8-11. Lifecycle / health / page-context methods are capability-scoped
    // (SPEC §27, AGENTS §32): plugins implement only what is consumed. No
    // runtime caller exists for getPlatformInfo, initialize, destroy,
    // validateEnvironment, selfTest, or getPageContext, so the contract test
    // must not require them.
  }

  // 12. Reddit plugin exposes message handling (SPEC §54) — platform message types
  //     are owned by the Reddit plugin, not by Core (AGENTS §27).
  assert.strictEqual(typeof RedditPlugin.handleMessage, 'function', 'RedditPlugin must implement handleMessage()');
  assert.strictEqual(RedditMessages.REDDIT_SCAN, 'REDDIT_SCAN');
  assert.strictEqual(RedditMessages.REDDIT_FETCH_AVATAR, 'REDDIT_FETCH_AVATAR');
  assert.strictEqual(RedditMessages.RESOLVE_REDGIFS, 'RESOLVE_REDGIFS');
  assert.strictEqual(RedditMessages.TRIGGER_SCAN_REDGIFS, 'TRIGGER_SCAN_REDGIFS');

  // A non-Reddit message type must not be handled (returns undefined).
  const notHandled = await RedditPlugin.handleMessage('SCAN_START', {});
  assert.strictEqual(notHandled, undefined, 'RedditPlugin.handleMessage must return undefined for non-Reddit types');

  // 13. Plugin Registry integration
  defaultRegistry.register(InstagramPlugin);
  defaultRegistry.register(FacebookPlugin);
  defaultRegistry.register(RedditPlugin);

  assert.strictEqual(defaultRegistry.list().length, 3);
  assert.strictEqual(defaultRegistry.get('instagram'), InstagramPlugin);
  assert.strictEqual(defaultRegistry.get('facebook'), FacebookPlugin);
  assert.strictEqual(defaultRegistry.get('reddit'), RedditPlugin);

  // Context detection test
  const igDetected = defaultRegistry.detect({ hostname: 'www.instagram.com' });
  assert.strictEqual(igDetected, InstagramPlugin);

  const fbDetected = defaultRegistry.detect({ hostname: 'www.facebook.com' });
  assert.strictEqual(fbDetected, FacebookPlugin);

  const redditDetected = defaultRegistry.detect({ hostname: 'www.reddit.com' });
  assert.strictEqual(redditDetected, RedditPlugin);

  // Host matching must not accept spoofed suffixes or throw on malformed URLs.
  assert.strictEqual(InstagramPlugin.matches({ hostname: 'evilinstagram.com' }), false);
  assert.strictEqual(FacebookPlugin.matches({ hostname: 'facebook.com.evil.test' }), false);
  assert.strictEqual(RedditPlugin.matches({ hostname: 'reddit.com.evil.test' }), false);
  assert.strictEqual(InstagramPlugin.matches({ url: 'not a URL' }), false);
  assert.strictEqual(FacebookPlugin.matches({ url: 'https://WWW.FACEBOOK.COM./x' }), true);
  assert.strictEqual(RedditPlugin.matches({ url: 'https://old.redd.it./x' }), true);

  const unknownDetected = defaultRegistry.detect({ hostname: 'www.twitter.com' });
  assert.strictEqual(unknownDetected, null);
}
