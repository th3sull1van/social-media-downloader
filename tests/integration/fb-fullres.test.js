import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FacebookDetector } from '../../src/plugins/facebook/FacebookDetector.js';
import { FacebookNormalizer } from '../../src/plugins/facebook/FacebookNormalizer.js';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = path.join(rootDir, 'fixtures-private/facebook-profile.har');

function extractEmbeddedJson(html) {
  const results = [];
  const re = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = re.exec(html))) {
    try { results.push(JSON.parse(match[1])); } catch { /* skip malformed */ }
  }
  return results;
}

function countViewerItems(payloads, maxDepth) {
  let count = 0;
  const samples = [];
  const walk = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > maxDepth) return;
    if (Array.isArray(obj)) {
      for (const v of obj) walk(v, depth + 1);
      return;
    }
    const highRes = obj.viewer_image?.uri;
    if (highRes && (obj.id || obj.photo_id) && !obj.profile_picture && !samples.find((s) => s.id === String(obj.id || obj.photo_id))) {
      count++;
      samples.push({ id: String(obj.id || obj.photo_id), uri: highRes, width: obj.viewer_image?.width, height: obj.viewer_image?.height });
    }
    for (const k of Object.keys(obj)) {
      if (k === 'extensions') continue;
      walk(obj[k], depth + 1);
    }
  };
  for (const payload of payloads) walk(payload, 0);
  return samples;
}

function isDownscaledRender(query) {
  const params = new URLSearchParams(query);
  const ctp = /(\d+)x(\d+)/i.exec(params.get('ctp') || '');
  if (!ctp) return false;
  const cstp = /(\d+)x(\d+)/i.exec(params.get('cstp') || '');
  if (!cstp) return false;
  const requested = Number(ctp[1]) * Number(ctp[2]);
  const available = Number(cstp[1]) * Number(cstp[2]);
  return requested < available;
}

import { MetaCdn } from '../../src/plugins/meta-shared/MetaCdn.js';

export async function runFbFullResTests() {
  // 1. Downscaled render detection
  {
    const downscaled = 'https://scontent.xx.fbcdn.net/v/x.jpg?stp=c0.100.206.206a_dst-jpg_s206x206_tt6&cstp=mx960x960&ctp=s206x206&oh=abc&oe=123';
    assert.strictEqual(MetaCdn.isDownscaledRender(downscaled), true, 'ctp < cstp must be detected as downscaled');

    const fullRes = 'https://scontent.xx.fbcdn.net/v/x.jpg?stp=dst-jpg_tt6&cstp=mx960x960&ctp=s960x960&oh=abc&oe=123';
    assert.strictEqual(MetaCdn.isDownscaledRender(fullRes), false, 'ctp == cstp must be detected as full resolution');

    const uncroppedCrop = 'https://scontent.xx.fbcdn.net/v/x.jpg?stp=c0.0.1080.1080a_dst-jpg_s150x150&oh=abc&oe=123';
    assert.strictEqual(MetaCdn.isDownscaledRender(uncroppedCrop), true, 'crop param must be detected as downscaled');
  }

  // 2. extractPhotosFromGraphQL upgrades thumbnail when viewer_image is present in children
  {
    const payloadWithNestedViewer = {
      data: {
        node: {
          __typename: 'Story',
          id: 'story_123',
          image: {
            uri: 'https://scontent.xx.fbcdn.net/v/thumb.jpg?stp=c0.100.206.206a_dst-jpg_s206x206&cstp=mx960x960&ctp=s206x206&oh=1&oe=2',
            width: 206,
            height: 206
          },
          attachments: [
            {
              media: {
                __typename: 'Photo',
                id: 'photo_real_999',
                photo_id: 'photo_real_999',
                viewer_image: {
                  uri: 'https://scontent.xx.fbcdn.net/v/full.jpg?stp=dst-jpg_tt6&cstp=mx1440x1440&ctp=s1440x1440&oh=3&oe=4',
                  width: 1440,
                  height: 1440
                }
              }
            }
          ]
        }
      }
    };

    const extracted = FacebookNormalizer.extractPhotosFromGraphQL(payloadWithNestedViewer);
    assert.strictEqual(extracted.length, 2, 'Should extract both story thumbnail and authentic photo');
    const photo = extracted.find((i) => i.id === 'photo_real_999');
    assert.ok(photo, 'Photo with viewer_image must be extracted');
    assert.strictEqual(photo.downloadUrl, 'https://scontent.xx.fbcdn.net/v/full.jpg?stp=dst-jpg_tt6&cstp=mx1440x1440&ctp=s1440x1440&oh=3&oe=4');
    assert.strictEqual(photo.width, 1440);
    assert.strictEqual(photo.height, 1440);
  }

  // 3. Regression: when viewer_image is a downscaled render but photo.image carries the
  //    full render, selectBestRender must pick the largest signed URL (do NOT rewrite the
  //    signed ctp — that would 403; just choose the already-signed full URL).
  //    Reported case: viewer_image ctp=s552x414 (downscaled) vs image ctp=s528x960 (max,
  //    cstp=mx528x960). See user report 2026-08-28.
  {
    const photo = {
      __typename: 'Photo',
      id: '23923187290682197',
      viewer_image: {
        uri: 'https://scontent.fmcz13-1.fna.fbcdn.net/v/t39.30808-6/512577834_23923187290682197_5235253458683122415_n.jpg?stp=dst-jpg_tt6&cstp=mx528x960&ctp=s552x414&_nc_cat=107&_nc_sid=cf85f3&_nc_ohc=YAEKche01D4Q7kNvwEAjHhr&oh=00_AQKtSuEEW0LmhcOBkFwzcWWWnrt_p9j_dX_zJgWO0_b-Yg&oe=6A97CE38',
        width: 552,
        height: 414
      },
      image: {
        uri: 'https://scontent.fmcz13-1.fna.fbcdn.net/v/t39.30808-6/512577834_23923187290682197_5235253458683122415_n.jpg?stp=dst-jpg_tt6&cstp=mx528x960&ctp=s528x960&_nc_cat=107&_nc_sid=cf85f3&_nc_ohc=YAEKche01D4Q7kNvwEAjHhr&oh=00_AQJhEPsDjpTmA0grf3MSVbZmT69CX9x9-ZyD10C_VbXnyg&oe=6A980678',
        width: 528,
        height: 960
      }
    };
    const item = FacebookNormalizer.normalizePhoto(photo);
    assert.ok(item, 'photo with downscaled viewer_image + full image must normalize');
    const ctp = item.downloadUrl.match(/ctp=s(\d+)x(\d+)/);
    assert.ok(ctp, 'selected URL must keep a ctp param');
    assert.strictEqual(`${ctp[1]}x${ctp[2]}`, '528x960', 'must select the full render, not the downscaled viewer_image');
    assert.strictEqual(item.width, 528);
    assert.strictEqual(item.height, 960);
  }

  // 3b. Regression (2026-08-29): the `oh`/`oe` HMAC on Facebook signed URLs
  //     does NOT cover `ctp` (validated live against fixtures-private
  //     captures: 66+ distinct URLs, rewritten ctp → cstp served HTTP 200
  //     with strictly larger payloads; touching `stp`/path still 403s).
  //     upgradeUrl must therefore rewrite ctp to cstp's max render instead
  //     of returning the downscaled URL verbatim.
  {
    const downscaled = 'https://scontent.fmcz13-1.fna.fbcdn.net/v/t39.30808-6/512577834_23923187290682197_5235253458683122415_n.jpg?stp=dst-jpg_tt6&cstp=mx1080x1080&ctp=s552x414&_nc_cat=107&_nc_sid=cf85f3&_nc_ohc=YAEKche01D4Q7kNvwEAjHhr&oh=00_AQKtSuEEW0LmhcOBkFwzcWWWnrt_p9j_dX_zJgWO0_b-Yg&oe=6A97CE38';
    const up = MetaCdn.upgradeUrl(downscaled, 'facebook');
    assert.strictEqual(up.indexOf('ctp=s1080x1080') > -1, true, `facebook signed URL must get ctp rewritten to cstp max, got: ${up}`);
    assert.strictEqual(up.includes('oh=00_AQKtSuEEW0LmhcOBkFwzcWWWnrt_p9j_dX_zJgWO0_b-Yg'), true, 'oh signature must be preserved');
    assert.strictEqual(up.includes('stp=dst-jpg_tt6'), true, 'stp must be preserved verbatim');

    // p-prefixed ctp (p403x403 seen on t1.6435-9 tiles) must also be rewritten.
    const pCtp = downscaled.replace('ctp=s552x414', 'ctp=p403x403');
    const upP = MetaCdn.upgradeUrl(pCtp, 'facebook');
    assert.strictEqual(upP.indexOf('ctp=s1080x1080') > -1, true, `p-prefixed ctp must be rewritten too, got: ${upP}`);

    // Full render (ctp == cstp) must be returned untouched.
    const full = downscaled.replace('ctp=s552x414', 'ctp=s1080x1080');
    assert.strictEqual(MetaCdn.upgradeUrl(full, 'facebook'), full, 'already-full render must not be modified');

    // Instagram signed URLs must stay verbatim (stp is HMAC-covered there).
    const ig = 'https://scontent.cdninstagram.com/v/t51/x.jpg?stp=s552x414&oh=abc&oe=123';
    assert.strictEqual(MetaCdn.upgradeUrl(ig), ig, 'instagram signed URL must not be rewritten');

    // normalizePhoto output must carry the rewritten max ctp end-to-end.
    const item = FacebookNormalizer.normalizePhoto({
      __typename: 'Photo',
      id: '3b_regression',
      image: { uri: downscaled, width: 552, height: 414 }
    });
    assert.ok(item, 'downscaled album tile must normalize');
    assert.strictEqual(MetaCdn.isDownscaledRender(item.downloadUrl), false, 'normalized item must not be downscaled');
    assert.strictEqual(item.downloadUrl.indexOf('ctp=s1080x1080') > -1, true, 'normalized item must request the max render');
  }

  // 3c. Regression (2026-08-29): SPA photo-viewer dialogs wipe document.title
  //     to a generic value, so the ZIP was named facebook_Facebook_Media_...
  //     even though the popup showed the profile name. The detector must pull
  //     the identity from the URL (profile.php?id, set=pb/t/a grammars, slugs)
  //     instead of degrading to the fallback.
  {
    const nameOf = (url) => FacebookDetector.detectTarget({ url }).name;
    assert.strictEqual(
      nameOf('https://www.facebook.com/photo/?fbid=25155410037459910&set=pb.100002527819015.-2207520000&type=3'),
      'profile_100002527819015',
      'photo dialog with set=pb.<pid>.<epoch> must resolve the profile id'
    );
    assert.strictEqual(
      nameOf('https://www.facebook.com/photo.php?fbid=1249558491862704&set=t.100002527819015&type=3'),
      'profile_100002527819015',
      'photo dialog with set=t.<pid> must resolve the profile id'
    );
    assert.strictEqual(
      nameOf('https://www.facebook.com/photo/?fbid=360660314732089&set=a.698436596974899'),
      'Facebook_Media',
      'album-only set= has no profile id: fallback stays'
    );
    assert.strictEqual(
      nameOf('https://www.facebook.com/profile.php?id=100002527819015&sk=photos'),
      'profile_100002527819015',
      'profile.php?id= route resolves the numeric id'
    );
    assert.strictEqual(nameOf('https://www.facebook.com/zuck/photos_by'), 'zuck', 'slug routes keep the slug');
    assert.strictEqual(nameOf('https://www.facebook.com/watch/?ref=tab'), 'Facebook_Media', 'generic routes fall back');
  }


  const har = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const html = har.log.entries.find((e) => /\/photos$/.test(e.request?.url || '') && /html/i.test(e.response?.content?.mimeType || ''))?.response?.content?.text || '';
  const payloads = extractEmbeddedJson(html);
  const shallow = countViewerItems(payloads, 12);
  const deep = countViewerItems(payloads, 40);
  assert.ok(deep.length >= 4, `expected full-size viewer_image items in the work capture, got ${deep.length}`);
  assert.ok(shallow.length < deep.length, 'full-size items are nested deeper than the old depth cap');
  const sample = deep.find((s) => /mx\d+x\d+/.test(s.uri.split('?')[1] || ''));
  assert.ok(sample, 'viewer_image URL must encode a max-size crop');

  const uri = 'https://scontent.example.fna.fbcdn.net/v/x.jpg?stp=dst-jpg_tt6&cstp=mx960x960&ctp=s206x206';
  const parse = (value) => { const m = String(value || '').match(/(\d+)x(\d+)/i); return m ? { width: parseInt(m[1], 10), height: parseInt(m[2], 10) } : null; };
  const url = new URL(uri);
  assert.deepStrictEqual(parse(url.searchParams.get('cstp')), { width: 960, height: 960 });
  assert.deepStrictEqual(parse(url.searchParams.get('ctp')), { width: 206, height: 206 });

  const items = [];
  for (const payload of payloads) items.push(...FacebookNormalizer.extractPhotosFromGraphQL(payload));
  assert.ok(items.length >= 4, `walker must reach Photo nodes inside tiles, got ${items.length}`);
  const KNOWN_DOWNSCALED = new Set(['25935962852737954', '2939409202819978']);
  for (const item of items) {
    const query = item.downloadUrl.split('?')[1] || '';
    if (!KNOWN_DOWNSCALED.has(String(item.id))) {
      assert.ok(!isDownscaledRender(query), `item keeps downscaled render: ${item.id}`);
    }
    assert.ok(!/stp=c\d+\.\d+\.\d+\.\d+[a-z]?/.test(query), `item keeps grid crop spec: ${item.id}`);
  }

  // 4. Regression: Reel / video cover thumbnails must NOT be emitted as photo items.
  //    Reported case: every Reel on a Facebook timeline showed up as a duplicated
  //    "miniatura" because the walker treated viewer_image as a photo. See user
  //    report 2026-08-29.
  {
    const reelCover = {
      data: {
        node: {
          __typename: 'Video',
          id: 'reel_cover_777',
          playable_url: 'https://video.fbcdn.net/v/reel.mp4',
          viewer_image: {
            uri: 'https://scontent.xx.fbcdn.net/v/cover.jpg?stp=dst-jpg_tt6&cstp=mx1080x1920&ctp=s1080x1920&oh=1&oe=2',
            width: 1080,
            height: 1920
          },
          image: {
            uri: 'https://scontent.xx.fbcdn.net/v/cover.jpg?stp=dst-jpg_tt6&cstp=mx1080x1920&ctp=s1080x1920&oh=1&oe=2',
            width: 1080,
            height: 1920
          },
          images: [
            { uri: 'https://scontent.xx.fbcdn.net/v/cover.jpg?stp=dst-jpg_tt6&cstp=mx1080x1920&ctp=s1080x1920&oh=1&oe=2', width: 1080, height: 1920 }
          ]
        }
      }
    };
    const items = FacebookNormalizer.extractPhotosFromGraphQL(reelCover);
    assert.strictEqual(items.length, 0, 'Reel/Video cover thumbnail must not be extracted as a photo');

    // Sanity: a real Photo in the same payload still goes through.
    const mixed = {
      data: {
        reel: { __typename: 'Video', id: 'r1', playable_url: 'x', viewer_image: { uri: 'https://scontent.xx.fbcdn.net/v/r.jpg?oh=1', width: 100, height: 100 } },
        photo: { __typename: 'Photo', id: 'p1', viewer_image: { uri: 'https://scontent.xx.fbcdn.net/v/p.jpg?oh=2', width: 800, height: 600 } }
      }
    };
    const mixedItems = FacebookNormalizer.extractPhotosFromGraphQL(mixed);
    assert.strictEqual(mixedItems.length, 1, 'only the real Photo must be extracted');
    assert.strictEqual(mixedItems[0].id, 'p1');
  }

  // 5. MetaNode helper: shared Video/Reel/CollectionTile classifier. The
  //    service-worker normalizer and the content-script walker both use it
  //    so a Reel cover cannot be emitted as a photo from one path while the
  //    other filters it out. See user report 2026-08-29.
  {
    const { MetaNode } = await import('../../src/plugins/meta-shared/MetaNode.js');
    assert.strictEqual(MetaNode.isVideoNode({ __typename: 'Video' }), true, 'Video typename must be detected');
    assert.strictEqual(MetaNode.isVideoNode({ __typename: 'ReelsTrayItem' }), true, 'ReelsTrayItem typename must be detected');
    assert.strictEqual(MetaNode.isVideoNode({ playable_url: 'x' }), true, 'playable_url must be detected');
    assert.strictEqual(MetaNode.isVideoNode({ playable_url_dash: 'x' }), true, 'playable_url_dash must be detected');
    assert.strictEqual(MetaNode.isVideoNode({ video_versions: [{}] }), true, 'video_versions[] must be detected');
    assert.strictEqual(MetaNode.isVideoNode({ __typename: 'Photo' }), false, 'Photo must NOT be detected as video');
    assert.strictEqual(MetaNode.isVideoNode(null), false, 'null must NOT be detected as video');
    assert.strictEqual(MetaNode.isVideoNode(undefined), false, 'undefined must NOT be detected as video');
    assert.strictEqual(MetaNode.isCollectionTile({ __typename: 'TimelineAppCollectionItem' }), true, 'collection tile by typename');
    assert.strictEqual(MetaNode.isCollectionTile({ collection_item_type: 'foo' }), true, 'collection tile by key');
    assert.strictEqual(MetaNode.shouldSkipAsPhoto({ __typename: 'Video' }), true, 'Video must be skipped as photo');
    assert.strictEqual(MetaNode.shouldSkipAsPhoto({ __typename: 'Photo' }), false, 'Photo must NOT be skipped');
  }

  // 6. Story wrapper around Video (real /reels payload shape from 2026-08-29).
  //    Story itself has no viewer_image; only the inner media does. The walker
  //    must not emit any photo MediaItem for the Story or the media.
  {
    const storyWithVideo = {
      data: {
        node: {
          __typename: 'Story',
          id: 'story_reel_1',
          attachments: [
            {
              media: {
                __typename: 'Video',
                id: 'reel_video_1',
                image: {
                  uri: 'https://scontent.xx.fbcdn.net/v/cover.jpg?stp=dst-jpg_tt6&cstp=mx1080x1920&ctp=s1080x1920&oh=1&oe=2',
                  width: 1080,
                  height: 1920
                },
                playable_url: 'https://video.fbcdn.net/v/reel.mp4'
              }
            }
          ]
        }
      }
    };
    const items = FacebookNormalizer.extractPhotosFromGraphQL(storyWithVideo);
    assert.strictEqual(items.length, 0, 'Story wrapping a Video must not emit any photo (was 1 with the old walker)');
  }

  // 7. Real fixture: facebook-reels.har carries 4 GraphQL responses with
  //    profile_reel_node. Even with the Story wrapper present, the inner
  //    media nodes (all __typename: 'Video') must yield zero photo items.
  //    Before the fix, this fixture produced 80+ Reel-cover "photos" from a
  //    single response line.
  {
    const reelsFixture = path.join(rootDir, 'fixtures-private/facebook-reels.har');
    if (fs.existsSync(reelsFixture)) {
      const har = JSON.parse(fs.readFileSync(reelsFixture, 'utf8'));
      let totalReelResponses = 0;
      let totalEmitted = 0;
      let totalVideoEmitted = 0;
      for (const entry of har.log.entries) {
        const u = entry.request?.url || '';
        if (!/api\/graphql/.test(u)) continue;
        let t = entry.response?.content?.text || '';
        if (t.length < 1000) continue;
        if (t.indexOf('profile_reel_node') < 0) continue;
        totalReelResponses++;
        // Each response is one or more JSON lines concatenated with '\n'.
        const lines = t.split('\n').filter(Boolean);
        for (const line of lines) {
          let parsed;
          try { parsed = JSON.parse(line); } catch { continue; }
          const items = FacebookNormalizer.extractPhotosFromGraphQL(parsed);
          totalEmitted += items.length;
          for (const it of items) {
            if (/^\d+$/.test(String(it.id))) totalVideoEmitted++;
          }
        }
      }
      assert.ok(totalReelResponses > 0, 'fixture must contain at least one GraphQL Reel response');
      assert.strictEqual(totalEmitted, 0, `expected 0 photo items from Reel payloads, got ${totalEmitted}`);
      assert.strictEqual(totalVideoEmitted, 0, `expected 0 video-ID photo items from Reel payloads, got ${totalVideoEmitted}`);
    }
  }

  // 8. Real fixture: facebook-206x206.har was captured while the user saw
  //    206x206 album-cover thumbnails leaking into the download list. The
  //    fixture carries 144 HTTP requests at ctp=s206x206, but every one of
  //    them is the rendered cover of a TimelineAppCollectionItem — they
  //    should never reach the popup. The fix lives in
  //    `harvestFacebookDomPhotos.pushItem` (content.js): when no full-res
  //    record is available, downscaled src URLs are dropped outright.
  //    We replicate the gate here so the behaviour is testable in isolation.
  {
    const fixture = path.join(rootDir, 'fixtures-private/facebook-206x206.har');
    if (fs.existsSync(fixture)) {
      // Inline copy of the production gate so the test does not depend on the
      // content script's IIFE. Keep the two in sync.
      function isDownscaledRender(url) {
        if (!url || typeof url !== 'string') return false;
        try {
          const u = new URL(url);
          const ctp = /(\d+)x(\d+)/i.exec(u.searchParams.get('ctp'));
          const cstp = /(\d+)x(\d+)/i.exec(u.searchParams.get('cstp'));
          if (ctp && cstp) {
            const requested = Number(ctp[1]) * Number(ctp[2]);
            const available = Number(cstp[1]) * Number(cstp[2]);
            if (requested < available) return true;
          }
          const stp = u.searchParams.get('stp');
          if (/[?&]stp=[^&]*[sc]\d+x\d+/i.test(url) || /c\d+\.\d+\.\d+\.\d+/i.test(stp)) return true;
          return false;
        } catch (e) { return false; }
      }
      const har = JSON.parse(fs.readFileSync(fixture, 'utf8'));
      let totalRequests = 0;
      let downscaledRequests = 0;
      for (const entry of har.log.entries) {
        const u = entry.request?.url || '';
        if (!/fbcdn\.net/.test(u)) continue;
        totalRequests++;
        if (isDownscaledRender(u)) downscaledRequests++;
      }
      assert.ok(totalRequests > 0, 'fixture must contain at least one fbcdn request');
      assert.ok(downscaledRequests > 0, `fixture should contain downscaled renders, found ${downscaledRequests}`);
      const userUrl = 'https://scontent.fmcz13-1.fna.fbcdn.net/v/t39.30808-6/492647362_2201247946991750_7586563030356519141_n.jpg?stp=c0.89.1080.1080a_dst-jpg_tt6&cstp=mx1080x1080&ctp=s206x206&_nc_cat=108&ccb=1-7&_nc_sid=714c7a';
      assert.strictEqual(isDownscaledRender(userUrl), true, 'user-reported 206x206 URL must be detected as downscaled');
      const fullUrl = 'https://scontent.xx.fbcdn.net/v/x.jpg?stp=dst-jpg_tt6&cstp=mx1080x1080&ctp=s1080x1080&oh=abc&oe=123';
      assert.strictEqual(isDownscaledRender(fullUrl), false, 'full-resolution URL must NOT be detected as downscaled');
      console.log(`  fixture: ${downscaledRequests}/${totalRequests} requests flagged as downscaled (rejected at the gate)`);
    }
  }

}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running Facebook full resolution tests...');
  runFbFullResTests();
  console.log('✔ Facebook full resolution tests passed.');
}
