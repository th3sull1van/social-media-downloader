/**
 * Social Media Downloader — Facebook Naming Regression Tests
 * Guards the filename conventions against captured-traffic regressions:
 *  - photo items keep the authentic CDN basename (numeric `_n` pattern, e.g.
 *    "470799140_2097219780727901_3327205746481550348_n.jpg");
 *  - non-matching basenames (opaque CDN tokens, mutated URLs) fall back to the
 *    structured photo id so names stay readable and collision-free;
 *  - all filenames keep valid extensions.
 */
import assert from 'node:assert';
import { FacebookNaming } from '../../src/plugins/facebook/FacebookNaming.js';
import { FacebookPlugin } from '../../src/plugins/facebook/FacebookPlugin.js';

function makeItem(overrides) {
  return /** @type {any} */ ({
    id: '123456789',
    platform: 'facebook',
    type: 'image',
    sourceType: 'facebook_photo',
    url: 'https://scontent.example.fna.fbcdn.net/v/t39.30808-6/470799140_2097219780727901_3327205746481550348_n.jpg',
    downloadUrl: 'https://scontent.example.fna.fbcdn.net/v/t39.30808-6/470799140_2097219780727901_3327205746481550348_n.jpg',
    metadata: { photoId: '470799140_2097219780727901_3327205746481550348' },
    ...overrides
  });
}

export async function runFacebookNamingTests() {
  // 1. Authentic CDN basename kept, even with thumbnail/crop query params.
  {
    const item = makeItem({
      downloadUrl: 'https://scontent.example.fna.fbcdn.net/v/t39.30808-6/470799140_2097219780727901_3327205746481550348_n.jpg?stp=dst-jpg_tt6&cstp=mx1080x1080&ctp=s206x206&oh=X&oe=Y'
    });
    const name = FacebookNaming.getOriginalFilename(item);
    assert.strictEqual(name, '470799140_2097219780727901_3327205746481550348_n.jpg');
  }

  // 2. webp extension follows the CDN basename.
  {
    const item = makeItem({
      downloadUrl: 'https://scontent.example.fna.fbcdn.net/v/t51.82787-15/673837531_18545231431068371_3162027417784701290_n.webp?stp=dst-webp_fb50_s320x320'
    });
    assert.strictEqual(FacebookNaming.getOriginalFilename(item), '673837531_18545231431068371_3162027417784701290_n.webp');
  }

  // 3. Opaque CDN token (non-conforming basename) falls back to photoId.
  {
    const item = makeItem({
      metadata: { photoId: '998877665544' },
      downloadUrl: 'https://scontent.example.fna.fbcdn.net/v/t39.30808-6/AQNoX5vro6wrX_HKZG6w9mJxG8ogPVoP1fKnJmt1nImhNDzyv8g94oiQ.mp4?stp=dst-jpg_tt6'
    });
    assert.strictEqual(FacebookNaming.getOriginalFilename(item), '998877665544.mp4');
  }

  // 4. Plugin paths use the authentic basename and stay traversal-safe.
  {
    const item = makeItem({
      metadata: { photoId: '1608135675940108' },
      downloadUrl: 'https://scontent.example.fna.fbcdn.net/v/t39.30808-6/504386712_4171026199808250_5057666967336888674_n.jpg?stp=dst-jpg_tt6&cstp=mx1440x800&ctp=s1440x800'
    });
    const filename = FacebookPlugin.getFilename(item, { targetName: 'har_replay' });
    assert.strictEqual(filename, 'SMD/Facebook/har_replay/504386712_4171026199808250_5057666967336888674_n.jpg');
    const archivePath = FacebookPlugin.getArchivePath(item, { targetName: 'har_replay' });
    assert.ok(!archivePath.includes('..'), `path traversal in "${archivePath}"`);
    assert.ok(/\.jpg$/.test(archivePath), `archive path must keep extension, got "${archivePath}"`);
  }

  // 5. FacebookDetector extracts profile name correctly without generic "Facebook" tab titles.
  {
    const { FacebookDetector } = await import('../../src/plugins/facebook/FacebookDetector.js');

    // Title cleaning
    assert.strictEqual(FacebookDetector.cleanTitle('(2) Silvio Santos | Facebook'), 'Silvio Santos');
    assert.strictEqual(FacebookDetector.cleanTitle('Silvio Santos - Fotos | Facebook'), 'Silvio Santos');
    assert.strictEqual(FacebookDetector.cleanTitle('Silvio Santos - Álbuns | Facebook'), 'Silvio Santos');
    assert.strictEqual(FacebookDetector.cleanTitle('Silvio Santos no Facebook'), 'Silvio Santos');

    // Generic tab title "Facebook" must be rejected
    assert.strictEqual(FacebookDetector.cleanTitle('Facebook'), '');
    assert.strictEqual(FacebookDetector.cleanTitle('(1) Facebook'), '');
    assert.strictEqual(FacebookDetector.cleanTitle('Facebook • Fotos'), '');

    // URL fallback when title is generic
    const targetFromSlug = FacebookDetector.detectTarget({
      url: 'https://www.facebook.com/silvio.santos.5680/photos'
    });
    assert.strictEqual(targetFromSlug.name, 'silvio_santos');

    const targetFromPeople = FacebookDetector.detectTarget({
      url: 'https://www.facebook.com/people/Silvio-Santos/100012345/'
    });
    assert.strictEqual(targetFromPeople.name, 'Silvio_Santos');

    const targetFromProfileId = FacebookDetector.detectTarget({
      url: 'https://www.facebook.com/profile.php?id=1000889900'
    });
    assert.strictEqual(targetFromProfileId.name, 'profile_1000889900');
  }
}
