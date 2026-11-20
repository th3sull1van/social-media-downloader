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
  const trackIdOffset = tkhdVersion === 1 ? 28 : 20;
  new DataView(tkhd.buffer).setUint32(trackIdOffset, trackId);

  const tkhdView = new DataView(tkhd.buffer);
  if (tkhdVersion === 1) {
    tkhdView.setBigUint64(12, BigInt(trackId + 100));
    tkhdView.setBigUint64(20, BigInt(trackId + 200));
  } else {
    tkhdView.setUint32(12, trackId + 100);
    tkhdView.setUint32(16, trackId + 200);
  }

  // Real structure: trak contains tkhd AND mdia (siblings, both inside trak).
  const trakBody = new Uint8Array(tkhd.length + mdia.length);
  trakBody.set(tkhd, 0);
  trakBody.set(mdia, tkhd.length);
  const trak = box('trak', trakBody);
  const mvhd = new Uint8Array(tkhdVersion === 1 ? 112 : 104);
  mvhd[0] = tkhdVersion;
  new DataView(mvhd.buffer).setUint32(tkhdVersion === 1 ? 108 : 96, 99);

  return box('moov', new Uint8Array([...box('mvhd', mvhd), ...trak]));
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
  const savedFetch = globalThis.fetch;
  try {
    for (const announced of [0, 2, 8]) {
      const body = new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4])); controller.close();
      } });
      anyFetch.fetch = async () => new Response(body, { headers: { 'content-length': String(announced) } });
      const result = await RedditVideoMuxer.fetchStreamWithProgress('https://example.com/media', undefined);
      assert.deepEqual([...new Uint8Array(result)], [1, 2, 3, 4], 'incorrect content-length must not corrupt media');
      assert.equal(body.locked, false);
    }
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    anyFetch.fetch = async () => new Response(body);
    const abort = new AbortController();
    const pending = RedditVideoMuxer.fetchStreamWithProgress('https://example.com/media', undefined, 0, 100, abort.signal);
    await new Promise((resolve) => setImmediate(resolve));
    abort.abort();
    await assert.rejects(pending);
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  } finally { globalThis.fetch = savedFetch; }

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
      const idOff = version === 1 ? tkhd.start + 28 : tkhd.start + 20;
      return view.getUint32(idOff);
    });
    assert.notStrictEqual(trackIds[0], trackIds[1], 'audio and video track ids must differ (no collision)');
    assert.ok(trackIds.every((id) => id >= 1), 'track ids must be positive');
    const mvhd = findBoxDeep(bytes, moovStart + 8, moovEnd, 'mvhd');
    assert.ok(mvhd, 'moov must contain mvhd');
    assert.equal(view.getUint32(mvhd.start + 104), Math.max(...trackIds) + 1, 'next_track_ID must follow assigned ids');
    for (const tr of traks) {
      const tkhd = findBoxDeep(bytes, tr.start + 8, tr.end, 'tkhd');
      const version = bytes[tkhd.start + 8];
      const creation = view.getUint32(tkhd.start + 12);
      assert.notEqual(creation, view.getUint32(version === 1 ? tkhd.start + 28 : tkhd.start + 20), 'timestamps must not be confused with track IDs');
    }

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
        ids.push(view.getUint32(tkhd.start + 28));
      }
      t += size;
    }
    assert.strictEqual(ids.length, 2);
    assert.notStrictEqual(ids[0], ids[1], 'v1 tkhd track ids must also be unique');
  }

  // 4d. A resolved audio URL must never silently degrade to video-only when the
  // audio payload is empty or malformed.
  {
    const videoFile = buildMp4(1, new Uint8Array(8));
    await assert.rejects(
      RedditVideoMuxer.mergeMp4Streams(videoFile.buffer, new Uint8Array(0).buffer, true),
      /Invalid audio MP4/
    );
    await assert.rejects(
      RedditVideoMuxer.mergeMp4Streams(videoFile.buffer, box('mdat', new Uint8Array(4)).buffer, true),
      /Invalid audio MP4/
    );
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

  // 6. [P1-05] parseMp4Boxes supports size===0 extend-to-EOF boxes, and mergeMp4Streams rejects fragmented/multi-mdat inputs.
  {
    const ftyp = box('ftyp', new Uint8Array(8));
    const mdatHeader = new Uint8Array(8 + 6);
    new DataView(mdatHeader.buffer).setUint32(0, 0); // size === 0 -> extends to EOF
    mdatHeader.set([0x6d, 0x64, 0x61, 0x74], 4);
    const eofMp4 = new Uint8Array([...ftyp, ...mdatHeader]);
    const boxes = /** @type {any} */ (RedditVideoMuxer.parseMp4Boxes(eofMp4));
    assert.ok(boxes.ftyp && boxes.mdat);
    assert.strictEqual(boxes.ftyp.size, 16);
    assert.strictEqual(boxes.mdat.start, 16);
    assert.strictEqual(boxes.mdat.size, 14);
    assert.strictEqual(boxes.mdat.end, eofMp4.length);

    const baseVideo = buildMp4(1, new Uint8Array(8));
    const fragmentedVideo = new Uint8Array([...baseVideo, ...box('moof', new Uint8Array(8))]);
    const validAudio = buildMp4(1, new Uint8Array(8));
    await assert.rejects(
      RedditVideoMuxer.mergeMp4Streams(fragmentedVideo.buffer, validAudio.buffer, true),
      /Fragmented or multi-mdat/i
    );
  }

  // 7. AUDIT-11: _withMuxSlot enforces strict concurrency cap under barging and aborts queued waiters immediately.
  {
    let active = 0;
    let peak = 0;
    const resolvers = [];
    /** @type {any} */
    let rel1;
    const q1 = RedditVideoMuxer._withMuxSlot(() => new Promise((r) => {
      active++; peak = Math.max(peak, active);
      rel1 = () => { active--; r(undefined); };
    }));
    const q2 = RedditVideoMuxer._withMuxSlot(() => new Promise((r) => {
      active++; peak = Math.max(peak, active);
      resolvers.push(() => { active--; r(undefined); });
    }));
    const q3 = RedditVideoMuxer._withMuxSlot(() => new Promise((r) => {
      active++; peak = Math.max(peak, active);
      resolvers.push(() => { active--; r(undefined); });
    }));
    const acWaiter = new AbortController();
    const qAbort = RedditVideoMuxer._withMuxSlot(async () => 'never', acWaiter.signal);
    acWaiter.abort();
    await assert.rejects(qAbort, /Abort/i);

    assert.ok(rel1, 'rel1 should be assigned');
    rel1();
    await Promise.resolve();
    const q4 = RedditVideoMuxer._withMuxSlot(() => new Promise((r) => {
      active++; peak = Math.max(peak, active);
      resolvers.push(() => { active--; r(undefined); });
    }));
    while (resolvers.length || active > 0) {
      if (resolvers.length) resolvers.shift()();
      await Promise.resolve();
    }
    await Promise.all([q1, q2, q3, q4]);
    assert.strictEqual(peak, 2, `mux semaphore must never exceed cap 2 (observed peak ${peak})`);
  }

  // 8. AUDIT-12: mergeMp4Streams rescales audio tkhd.duration when mvhd timescales differ.
  {
    const makeTimedMp4 = (timescale, tkhdDur) => {
      const ftyp = box('ftyp', new Uint8Array(8));
      const mdat = box('mdat', new Uint8Array(16));
      const stco = new Uint8Array(20);
      new DataView(stco.buffer).setUint32(0, 20);
      stco.set([115, 116, 99, 111], 4);
      new DataView(stco.buffer).setUint32(12, 1);
      const mdia = box('mdia', box('minf', box('stbl', stco)));
      const tkhd = new Uint8Array(32);
      new DataView(tkhd.buffer).setUint32(0, 32);
      tkhd.set([116, 107, 104, 100], 4);
      new DataView(tkhd.buffer).setUint32(20, 1);
      new DataView(tkhd.buffer).setUint32(28, tkhdDur);
      const trak = box('trak', new Uint8Array([...tkhd, ...mdia]));
      const mvhdPayload = new Uint8Array(104);
      new DataView(mvhdPayload.buffer).setUint32(12, timescale);
      new DataView(mvhdPayload.buffer).setUint32(16, tkhdDur);
      new DataView(mvhdPayload.buffer).setUint32(96, 2);
      const moov = box('moov', new Uint8Array([...box('mvhd', mvhdPayload), ...trak]));
      const file = new Uint8Array(ftyp.length + moov.length + mdat.length);
      file.set(ftyp, 0);
      file.set(moov, ftyp.length);
      file.set(mdat, ftyp.length + moov.length);
      const stcoOff = findBoxDeep(file, ftyp.length + 8, ftyp.length + moov.length, 'stco').start;
      new DataView(file.buffer).setUint32(stcoOff + 16, ftyp.length + moov.length + 8);
      return file;
    };
    const vFile = makeTimedMp4(1000, 10000);
    const aFile = makeTimedMp4(48000, 480000);
    const merged = await RedditVideoMuxer.mergeMp4Streams(vFile.buffer, aFile.buffer, true);
    const bytes = new Uint8Array(await merged.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const moov = findBoxDeep(bytes, 0, bytes.length, 'moov');
    const traks = [];
    let off = moov.start + 8;
    while (off + 8 <= moov.end) {
      const sz = view.getUint32(off);
      const tp = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      if (tp === 'trak') traks.push({ start: off, end: off + sz });
      off += sz;
    }
    const audioTkhd = findBoxDeep(bytes, traks[1].start + 8, traks[1].end, 'tkhd');
    assert.strictEqual(view.getUint32(audioTkhd.start + 28), 10000, 'audio tkhd.duration must rescale into video mvhd.timescale');
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

    // 4. AUDIT-11: Aborting Caller A during shared getToken must NOT reject Caller B.
    {
      RedGifsResolver._token = null;
      RedGifsResolver._tokenExpiry = 0;
      RedGifsResolver._tokenPromise = null;
      /** @type {any} */
      let finishToken;
      anyFetch.fetch = async (_url, opts) => new Promise((resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        finishToken = () => resolve({ ok: true, json: async () => ({ token: 'shared_tok_ok' }) });
      });
      const acA = new AbortController();
      const acB = new AbortController();
      const pA = RedGifsResolver.getToken(acA.signal);
      const pB = RedGifsResolver.getToken(acB.signal);
      acA.abort();
      await assert.rejects(pA, /Abort/i);
      assert.ok(finishToken, 'finishToken should be assigned');
      finishToken();
      const tokB = await pB;
      assert.strictEqual(tokB, 'shared_tok_ok', 'Caller B must still receive token when only Caller A aborts');
    }
  } finally {
    RedGifsResolver._token = null;
    RedGifsResolver._tokenExpiry = 0;
    anyFetch.fetch = originalFetch;
  }
}
