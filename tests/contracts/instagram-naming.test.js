/**
 * Social Media Downloader — Instagram Naming Regression Tests
 * Guards the filename conventions against captured-traffic regressions:
 *  - image items keep the authentic CDN basename (numeric _n pattern);
 *  - video items must NEVER use opaque CDN session tokens ("AQ...", 92-107 chars,
 *    the 22-byte-adjacent UX bug reported with superlong names like
 *    "AQNoX5vro6wrX...mp4") — they get shortcode/structured names instead;
 *  - all filenames keep valid extensions and stay collision-free per item set.
 */
import assert from 'node:assert';
import { InstagramNaming } from '../../src/plugins/instagram/InstagramNaming.js';
import { InstagramPlugin } from '../../src/plugins/instagram/InstagramPlugin.js';

function makeItem(overrides) {
  return /** @type {any} */ ({
    id: 'x1',
    platform: 'instagram',
    type: 'image',
    sourceType: 'photo_post',
    url: 'https://instagram.fpoa1-1.fna.fbcdn.net/v/t51.2885-15/111_n.jpg',
    downloadUrl: 'https://instagram.fpoa1-1.fna.fbcdn.net/v/t51.2885-15/111_n.jpg',
    extension: 'jpg',
    metadata: {},
    ...overrides
  });
}

export async function runInstagramNamingTests() {
  // 1. Authentic CDN basename is kept for the classic numeric _n pattern.
  {
    const item = makeItem({
      metadata: { postId: 'p1', shortcode: 'ABC123' }
    });
    const name = InstagramNaming.getOriginalFilename(item);
    assert.strictEqual(name, '111_n.jpg');
  }

  // 2. Opaque video session token must NOT become the filename (the reported bug).
  {
    const token = 'AQNoX5vro6wrX_HKZG6w9mJxG8ogPVoP1fKnJmt1nImhNDzyv8g94oiQFnPqBq2DCgA1pPjlByvafrhXj8uy_Yrf3zdxj9f4RUXkulM';
    const item = makeItem({
      type: 'video',
      sourceType: 'video_post',
      extension: 'mp4',
      downloadUrl: `https://instagram.fmcz13-1.fna.fbcdn.net/o1/v/t2/f2/m78/${token}.mp4?_nc_ht=instagram`,
      metadata: { postId: 'p1', shortcode: 'DZ-fSOiq-f', category: 'posts', isVideo: true }
    });
    const name = InstagramNaming.getOriginalFilename(item);
    assert.ok(!name.includes('AQNo'), 'opaque CDN token must not leak into the filename');
    assert.ok(name.length < 60, `video filename must be short, got ${name.length}`);
    assert.strictEqual(name, 'DZ-fSOiq-f.mp4');
  }

  // 3. Carousel video slides get the shortcode_slideN pattern.
  {
    const token = 'AQM4GnoygaCwfBU0_mT8xE5yiqhH3mJUMno5DSlDuhJZj9bCe-g5P6bU9KHauBcQoxAv2AlGh4qmkA22HuknkZg3e7';
    const item = makeItem({
      type: 'video',
      sourceType: 'carousel_item',
      extension: 'mp4',
      downloadUrl: `https://instagram.fmcz13-1.fna.fbcdn.net/o1/v/t2/f2/m78/${token}.mp4`,
      metadata: { postId: 'p2', shortcode: 'Da1KoQamC_2', slideIndex: 2, slideTotal: 5, isCarousel: true, isVideo: true }
    });
    const name = InstagramNaming.getOriginalFilename(item);
    assert.strictEqual(name, 'Da1KoQamC_2_slide2.mp4');
  }

  // 4. Story video without shortcode gets the story_ prefix.
  {
    const item = makeItem({
      type: 'video',
      sourceType: 'story_item',
      extension: 'mp4',
      downloadUrl: 'https://instagram.fmcz13-1.fna.fbcdn.net/o1/v/t2/f2/m78/AQNOblahblah.mp4',
      id: 'story_media_123',
      metadata: { category: 'stories', isVideo: true }
    });
    const name = InstagramNaming.getOriginalFilename(item);
    assert.ok(name.startsWith('story_'), `story videos must use the story_ pattern, got ${name}`);
    assert.ok(name.length < 60);
  }

  // 5. Unparseable URL falls back to the item id pattern, never the raw token.
  {
    const item = makeItem({
      type: 'video',
      sourceType: 'video_post',
      extension: 'mp4',
      downloadUrl: 'https://instagram.cdn/o1/v/t2/f2/m78/AQNoX5.mp4',
      metadata: { postId: '42', isVideo: true }
    });
    const name = InstagramNaming.getOriginalFilename(item);
    assert.ok(!name.startsWith('AQNo'), 'token must not leak');
    assert.ok(name.includes('42'), `structured fallback must include the postId, got ${name}`);
  }

  // 6. Full plugin path: filenames stay short and extension-correct for both types.
  //    (Distinct posts: two items sharing one postId would dedup to one file by design.)
  {
    const image = makeItem({
      id: 'img_post',
      url: 'https://instagram.cdn/v/t51/714823214_18556244662067792_4244871484690731199_n.jpg',
      metadata: { postId: 'p_img', shortcode: 'AbCdEf' }
    });
    const video = makeItem({
      id: 'vid_post',
      type: 'video',
      sourceType: 'video_post',
      extension: 'mp4',
      url: 'https://instagram.cdn/o1/v/t2/f2/m78/AQNoX5blahblahblah.mp4',
      downloadUrl: 'https://instagram.cdn/o1/v/t2/f2/m78/AQNoX5blahblahblah.mp4',
      metadata: { postId: 'p_vid', shortcode: 'GhIjKl', isVideo: true }
    });
    const imgName = InstagramPlugin.getFilename(image, { targetName: 'user' }).split('/').pop();
    const vidName = InstagramPlugin.getFilename(video, { targetName: 'user' }).split('/').pop();
    assert.ok(imgName.length <= 60, `image name too long: ${imgName}`);
    assert.ok(vidName.length <= 60, `video name too long: ${vidName}`);
    assert.ok(/\.mp4$/i.test(vidName), `video must keep .mp4 extension, got ${vidName}`);
    assert.ok(!vidName.startsWith('AQNo'));
  }

  // 7. The authentic pattern constant matches real basenames and rejects tokens.
  {
    assert.ok(InstagramNaming.AUTHENTIC_BASENAME_PATTERN.test('714823214_18556244662067792_4244871484690731199_n.jpg'));
    assert.ok(InstagramNaming.AUTHENTIC_BASENAME_PATTERN.test('111_n.jpg'));
    assert.ok(InstagramNaming.AUTHENTIC_BASENAME_PATTERN.test('49158360_1249558495196037_9020443228779839488_n.mp4'));
    assert.ok(!InstagramNaming.AUTHENTIC_BASENAME_PATTERN.test('AQNoX5vro6wrX_HKZG6w9mJxG8ogPVoP1fKnJmt1nImhNDzyv8g94oiQ.mp4'));
    assert.ok(!InstagramNaming.AUTHENTIC_BASENAME_PATTERN.test('random_video.mp4'));
    assert.ok(!InstagramNaming.AUTHENTIC_BASENAME_PATTERN.test('2F2AQPnO-2F5B9A8A_malformed.mp4'));
  }
}
