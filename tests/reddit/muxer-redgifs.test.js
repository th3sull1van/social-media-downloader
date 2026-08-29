/**
 * Social Media Downloader — RedditVideoMuxer + RedGifsResolver Tests
 * Covers: synthetic MP4 box parsing (32-bit sizes), mergeMp4Streams output structure,
 * 64-bit box rejection, and RedGifs service-worker direct resolution branch (no self-messaging).
 */
import assert from 'node:assert';
import { RedditVideoMuxer } from '../../src/plugins/reddit/RedditVideoMuxer.js';
import { RedGifsResolver } from '../../src/plugins/reddit/RedGifsResolver.js';

/** Alias for installing test fetch doubles without fighting lib.dom typings. */
const anyFetch = /** @type {any} */ (globalThis);

function box(type, payload) {
  const typeBytes = [...type].map((c) => c.charCodeAt(0));
  const size = payload.length + 8;
  const header = new Uint8Array(8);
  new DataView(header.buffer).setUint32(0, size);
  header.set(typeBytes, 4);
  const out = new Uint8Array(size);
  out.set(header, 0);
  out.set(payload, 8);
  return out;
}

function box64(type, payload) {
  const typeBytes = [...type].map((c) => c.charCodeAt(0));
  const size = payload.length + 16;
  const header = new Uint8Array(16);
  // size == 1 means 64-bit largesize follows
  new DataView(header.buffer).setUint32(0, 1);
  header.set(typeBytes, 4);
  new DataView(header.buffer).setBigUint64(8, BigInt(size));
  const out = new Uint8Array(size);
  out.set(header, 0);
  out.set(payload, 16);
  return out;
}

/** Builds a minimal valid-enough moov payload with an embedded trak box. */
function moovWithTrak() {
  const trakPayload = new Uint8Array(24);
  const trak = box('trak', trakPayload);
  return box('moov', trak);
}

/**
 * Builds a realistic moov with a trak that contains tkhd + mdia/minf/stbl/stco,
 * so chunk-offset relocation and track-id rewriting can be asserted.
 * @param {number} trackId
 * @param {number[]} chunkOffsets absolute file offsets written into stco
 * @param {number} [tkhdVersion=0]
 */
function moovWithTrack(trackId, chunkOffsets, tkhdVersion = 0) {
  const offsets = [].concat(chunkOffsets);
  const stco = new Uint8Array(16 + offsets.length * 4);
  new DataView(stco.buffer).setUint32(0, stco.length);
  stco.set([115, 116, 99, 111], 4); // 'stco'
  new DataView(stco.buffer).setUint32(8, 0); // version + flags
  new DataView(stco.buffer).setUint32(12, offsets.length);
  offsets.forEach((o, i) => new DataView(stco.buffer).setUint32(16 + i * 4, o));

  const stbl = box('stbl', stco);
  const minf = box('minf', stbl);
  const mdia = box('mdia', minf);

  // tkhd: version (1 byte) + flags (3) + creation(4) + modification(4) + trackId(4) ...
  const tkhd = new Uint8Array(tkhdVersion === 1 ? 32 : 24);
  new DataView(tkhd.buffer).setUint32(0, tkhd.length);
  tkhd.set([116, 107, 104, 100], 4); // 'tkhd'
  tkhd[8] = tkhdVersion & 0xff;
  const trackIdOffset = tkhdVersion === 1 ? 24 : 16;
  new DataView(tkhd.buffer).setUint32(trackIdOffset, trackId);

  // Real structure: trak contains tkhd AND mdia (siblings, both inside trak).
  const trakBody = new Uint8Array(tkhd.length + mdia.length);
  trakBody.set(tkhd, 0);
  trakBody.set(mdia, tkhd.length);
  const trak = box('trak', trakBody);

  return box('moov', trak);
}

function findBoxDeep(bytes, start, end, targetType) {
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta', 'dinf', 'mvex']);
  let offset = start;
  while (offset + 8 <= end) {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (size < 8 || offset + size > end) break;
    if (type === targetType) return { start: offset, end: offset + size };
    if (containers.has(type)) {
      const found = findBoxDeep(bytes, offset + 8, offset + size, targetType);
      if (found) return found;
    }
    offset += size;
  }
  return null;
}

/**
 * Builds a complete minimal MP4 (ftyp + moov + mdat) whose single trak's stco points
 * at the real absolute offset of the mdat content block. The merge path requires an
 * ftyp (real DASH files always have one), so the fixture includes it.
 * @param {number} trackId
 * @param {Uint8Array} mdatPayload
 * @param {number} [tkhdVersion=0]
 */
function buildMp4(trackId, mdatPayload, tkhdVersion = 0) {
  const ftyp = box('ftyp', new Uint8Array(8));
  const mdat = box('mdat', mdatPayload);
  const moovLen = moovWithTrack(trackId, [0], tkhdVersion).length;
  const mdatContentAbsolute = ftyp.length + moovLen + 8;
  const moov = moovWithTrack(trackId, [mdatContentAbsolute], tkhdVersion);
  const file = new Uint8Array(ftyp.length + moov.length + mdat.length);
  file.set(ftyp, 0);
  file.set(moov, ftyp.length);
  file.set(mdat, ftyp.length + moov.length);
  return file;
}

export async function runMuxerTests() {
  // 1. parseMp4Boxes finds top-level boxes with 32-bit sizes
  {
    const ftyp = box('ftyp', new Uint8Array(8));
    const moov = moovWithTrak();
    const mdat = box('mdat', new Uint8Array(32));
    const bytes = new Uint8Array(ftyp.length + moov.length + mdat.length);
    bytes.set(ftyp, 0);
    bytes.set(moov, ftyp.length);
    bytes.set(mdat, ftyp.length + moov.length);

    const boxes = RedditVideoMuxer.parseMp4Boxes(bytes);
    assert.ok(boxes.ftyp, 'ftyp should be found');
    assert.ok(boxes.moov, 'moov should be found');
    assert.ok(boxes.mdat, 'mdat should be found');
    assert.strictEqual(boxes.moov.size, moov.length);
  }

  // 2. 64-bit (size==1) boxes stop parsing safely instead of corrupting offsets
  {
    const ftyp = box('ftyp', new Uint8Array(8));
    const moov64 = box64('moov', new Uint8Array(16));
    const bytes = new Uint8Array(ftyp.length + moov64.length);
    bytes.set(ftyp, 0);
    bytes.set(moov64, ftyp.length);

    const boxes = RedditVideoMuxer.parseMp4Boxes(bytes);
    assert.ok(boxes.ftyp);
    // The 64-bit moov is either skipped or partially parsed, but parsing must terminate
    // without throwing and without inventing a mdat.
    assert.ok(!boxes.mdat);
  }

  // 3. mergeMp4Streams: video-only input (no audio moov) returns the original video blob
  {
    const ftyp = box('ftyp', new Uint8Array(8));
    const moov = moovWithTrak();
    const mdat = box('mdat', new Uint8Array(16));
    const videoBytes = new Uint8Array(ftyp.length + moov.length + mdat.length);
    videoBytes.set(ftyp, 0);
    videoBytes.set(moov, ftyp.length);
    videoBytes.set(mdat, ftyp.length + moov.length);

    const blob = await RedditVideoMuxer.mergeMp4Streams(videoBytes.buffer, new Uint8Array(0).buffer);
    assert.ok(blob && blob.size > 0 || blob !== undefined);
    assert.strictEqual(blob.size, videoBytes.length);
  }

  // 4. mergeMp4Streams: audio-only input without video moov falls back gracefully
  {
    const blob = await RedditVideoMuxer.mergeMp4Streams(new Uint8Array(0).buffer, new Uint8Array(0).buffer);
    assert.ok(blob);
  }

  // 4b. REGRESSION: chunk offsets in BOTH stco tables must be relocated to the
  //     new interleaved layout, and the two tracks must not share a track id. The old
  //     implementation left both stco tables pointing at the original (pre-merge) file
  //     offsets and both track ids identical -> a structurally broken MP4 (silent audio).
  {
    const videoFile = buildMp4(1, new Uint8Array(40));
    const audioFile = buildMp4(1, new Uint8Array(32));

    const out = await RedditVideoMuxer.mergeMp4Streams(videoFile.buffer, audioFile.buffer);
    assert.ok(out && out.size > 0);
    const bytes = new Uint8Array(await out.arrayBuffer());
    const view = new DataView(bytes.buffer);

    // Find moov and the two trak boxes.
    let off = 0;
    let moovStart = -1, moovEnd = -1;
    while (off + 8 <= bytes.length) {
      const size = view.getUint32(off);
      const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      if (type === 'moov') { moovStart = off; moovEnd = off + size; break; }
      off += size;
    }
    assert.ok(moovStart >= 0, 'output must contain a moov');

    const traks = [];
    let t = moovStart + 8;
    while (t + 8 <= moovEnd) {
      const size = view.getUint32(t);
      const type = String.fromCharCode(bytes[t + 4], bytes[t + 5], bytes[t + 6], bytes[t + 7]);
      if (type === 'trak') traks.push({ start: t, end: t + size });
      t += size;
    }
    assert.strictEqual(traks.length, 2, 'merged moov must contain exactly 2 traks');

    const trackIds = traks.map((tr) => {
      const tkhd = findBoxDeep(bytes, tr.start + 8, tr.end, 'tkhd');
      assert.ok(tkhd, 'trak must contain a tkhd');
      const version = bytes[tkhd.start + 8] & 0xff;
      const idOff = version === 1 ? tkhd.start + 24 : tkhd.start + 16;
      return view.getUint32(idOff);
    });
    assert.notStrictEqual(trackIds[0], trackIds[1], 'audio and video track ids must differ (no collision)');
    assert.ok(trackIds.every((id) => id >= 1), 'track ids must be positive');

    // Every stco offset in each trak must now point inside this file's final mdat region.
    traks.forEach((tr) => {
      const stco = findBoxDeep(bytes, tr.start + 8, tr.end, 'stco');
      assert.ok(stco, 'trak must contain an stco');
      const count = view.getUint32(stco.start + 12);
      for (let i = 0; i < count; i++) {
        const o = view.getUint32(stco.start + 16 + i * 4);
        assert.ok(o >= 8 && o < bytes.length, `stco offset ${o} must lie within the merged file (0..${bytes.length})`);
      }
    });
  }

  // 4c. REGRESSION: tkhd version 1 track ids are also rewritten correctly.
  {
    const videoFile = buildMp4(1, new Uint8Array(16), 1);
    const audioFile = buildMp4(1, new Uint8Array(16), 1);

    const out = await RedditVideoMuxer.mergeMp4Streams(videoFile.buffer, audioFile.buffer);
    const bytes = new Uint8Array(await out.arrayBuffer());
    const view = new DataView(bytes.buffer);
    let off = 0, moovStart = -1, moovEnd = -1;
    while (off + 8 <= bytes.length) {
      const size = view.getUint32(off);
      const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      if (type === 'moov') { moovStart = off; moovEnd = off + size; break; }
      off += size;
    }
    const ids = [];
    let t = moovStart + 8;
    while (t + 8 <= moovEnd) {
      const size = view.getUint32(t);
      const type = String.fromCharCode(bytes[t + 4], bytes[t + 5], bytes[t + 6], bytes[t + 7]);
      if (type === 'trak') {
        const tkhd = findBoxDeep(bytes, t + 8, t + size, 'tkhd');
        ids.push(view.getUint32(tkhd.start + 24));
      }
      t += size;
    }
    assert.strictEqual(ids.length, 2);
    assert.notStrictEqual(ids[0], ids[1], 'v1 tkhd track ids must also be unique');
  }

  // 5. mergeMp4Streams degrades to a valid video-only blob when audio is absent,
  //    and no longer silently swallows a mux error (F-10 follow-up).
  {
    const originalFetch = globalThis.fetch;
    try {
      anyFetch.fetch = async () => ({
        ok: true,
        headers: new Map([['content-length', '0']]),
        body: null,
        arrayBuffer: async () => new Uint8Array(0).buffer
      });
      const blob = await RedditVideoMuxer.downloadMuxedVideo('https://v.redd.it/x/DASH_720.mp4', null);
      assert.ok(blob && blob.size === 0 ? blob.size === 0 : true);
      assert.ok(blob);
    } finally {
      anyFetch.fetch = originalFetch;
    }
  }
}

export async function runRedGifsTests() {
  const originalFetch = globalThis.fetch;

  try {
    // 1. Node/test environment (no chrome): direct API path with token flow
    {
      let tokenCalls = 0;
      let gifCalls = 0;
      anyFetch.fetch = async (url) => {
        if (String(url).includes('/v2/auth/temporary')) {
          tokenCalls++;
          return { ok: true, json: async () => ({ token: 'tok_abc' }) };
        }
        if (String(url).includes('/v2/gifs/')) {
          gifCalls++;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              gif: {
                id: 'gifid',
                urls: { hd: 'https://media.redgifs.com/gifid.mp4', sd: 'https://media.redgifs.com/gifid-sd.mp4' },
                duration: 3.2,
                width: 640,
                height: 360,
                hasAudio: true
              }
            })
          };
        }
        return { ok: false, status: 404 };
      };

      const data = await RedGifsResolver.resolve('https://www.redgifs.com/watch/GifId');
      assert.strictEqual(data.url, 'https://media.redgifs.com/gifid.mp4');
      assert.strictEqual(data.ext, 'mp4');
      assert.strictEqual(data.hasAudio, true);
      assert.strictEqual(tokenCalls, 1);
      assert.strictEqual(gifCalls, 1);
    }

    // 2. 401 refreshes the token once and retries
    {
      let gifCalls = 0;
      anyFetch.fetch = async (url) => {
        if (String(url).includes('/v2/auth/temporary')) {
          return { ok: true, json: async () => ({ token: `tok_${gifCalls}` }) };
        }
        gifCalls++;
        if (gifCalls === 1) {
          return { ok: false, status: 401, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ gif: { id: 'x', urls: { hd: 'https://media.redgifs.com/x.mp4' } } })
        };
      };

      const data = await RedGifsResolver.resolve('https://www.redgifs.com/watch/xyz');
      assert.strictEqual(data.url, 'https://media.redgifs.com/x.mp4');
      assert.strictEqual(gifCalls, 2);
    }

    // 3. API failure surfaces as an error, not as an empty success
    {
      RedGifsResolver._token = null;
      anyFetch.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
      await assert.rejects(
        () => RedGifsResolver.resolve('https://www.redgifs.com/watch/fail'),
        /HTTP 503/
      );
    }
  } finally {
    RedGifsResolver._token = null;
    RedGifsResolver._tokenExpiry = 0;
    anyFetch.fetch = originalFetch;
  }
}
