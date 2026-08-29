/**
 * Social Media Downloader — Reddit Video Muxer
 * Resolves DASH video and audio streams and multiplexes MP4 moov/mdat boxes in-browser.
 */

export class RedditVideoMuxer {
  static async checkUrlExists(url) {
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Discovers highest resolution video stream and companion audio stream.
   * @param {string} baseUrl
   * @param {string} [fallbackUrl]
   * @returns {Promise<{ videoUrl: string | null, audioUrl: string | null, hasAudio: boolean }>}
   */
  static async resolveStreams(baseUrl, fallbackUrl) {
    const base = baseUrl.replace(/\/DASH_[^\/?#]+.*$/, '').replace(/\/?$/, '/');
    const videoResolutions = ['DASH_1080.mp4', 'DASH_720.mp4', 'DASH_480.mp4', 'DASH_360.mp4', 'DASH_240.mp4'];
    const audioCandidates = ['DASH_AUDIO_128.mp4', 'DASH_audio.mp4', 'DASH_AUDIO_64.mp4', 'DASH_AUDIO_32.mp4'];

    let bestVideoUrl = null;
    let audioUrl = null;

    for (const res of videoResolutions) {
      const candidate = base + res;
      if (await RedditVideoMuxer.checkUrlExists(candidate)) {
        bestVideoUrl = candidate;
        break;
      }
    }

    if (!bestVideoUrl && fallbackUrl) {
      bestVideoUrl = fallbackUrl.replace(/\?.*$/, '');
    }

    for (const aud of audioCandidates) {
      const candidate = base + aud;
      if (await RedditVideoMuxer.checkUrlExists(candidate)) {
        audioUrl = candidate;
        break;
      }
    }

    return {
      videoUrl: bestVideoUrl,
      audioUrl: audioUrl,
      hasAudio: !!audioUrl
    };
  }

  /**
   * Fetches stream with progress reporting.
   * @param {string} url
   * @param {Function} [onProgress]
   * @param {number} [startPct=0]
   * @param {number} [weightPct=100]
   * @returns {Promise<ArrayBuffer>}
   */
  static async fetchStreamWithProgress(url, onProgress, startPct = 0, weightPct = 100) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} when fetching ${url}`);

    const contentLength = res.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    const reader = res.body?.getReader();
    if (!reader) {
      return await res.arrayBuffer();
    }

    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      if (total && onProgress) {
        const pct = startPct + (received / total) * weightPct;
        onProgress(Math.min(99, Math.round(pct)), `Downloading... ${Math.round(received / 1024)} KB`);
      }
    }

    const totalBuffer = new Uint8Array(received);
    let position = 0;
    for (const chunk of chunks) {
      totalBuffer.set(chunk, position);
      position += chunk.length;
    }

    return totalBuffer.buffer;
  }

  /**
   * Downloads video and audio streams and muxes them into a single MP4 Blob.
   * @param {string} videoUrl
   * @param {string | null} audioUrl
   * @param {Function} [onProgress]
   * @returns {Promise<Blob>}
   */
  static async downloadMuxedVideo(videoUrl, audioUrl, onProgress) {
    if (!audioUrl) {
      if (onProgress) onProgress(10, 'Downloading video...');
      const videoBuffer = await RedditVideoMuxer.fetchStreamWithProgress(videoUrl, onProgress, 10, 85);
      if (onProgress) onProgress(100, 'Ready!');
      return new Blob([videoBuffer], { type: 'video/mp4' });
    }

    if (onProgress) onProgress(5, 'Downloading video track...');
    const videoBuffer = await RedditVideoMuxer.fetchStreamWithProgress(videoUrl, onProgress, 5, 55);

    if (onProgress) onProgress(60, 'Downloading audio track...');
    const audioBuffer = await RedditVideoMuxer.fetchStreamWithProgress(audioUrl, onProgress, 60, 30);

    if (onProgress) onProgress(90, 'Multiplexing tracks...');

    try {
      const mergedBlob = await RedditVideoMuxer.mergeMp4Streams(videoBuffer, audioBuffer);
      if (onProgress) onProgress(100, 'Completed!');
      return mergedBlob;
    } catch (err) {
      // Surface the mux failure instead of silently returning a video-only blob with
      // no audio (that masked a structural bug: broken chunk-offset tables).
      throw new Error(`Failed to mux video and audio: ${err?.message || err}`);
    }
  }

  /**
   * Merges MP4 moov and mdat boxes from separate video and audio streams.
   * @param {ArrayBuffer} videoArrayBuffer
   * @param {ArrayBuffer} audioArrayBuffer
   * @returns {Promise<Blob>}
   */
  /**
   * Merges MP4 moov and mdat boxes from separate video and audio streams.
   *
   * Correctness: chunk-offset tables (stco/co64) hold ABSOLUTE file pointers and
   * MUST be relocated to the new interleaved layout. The audio track id MUST also
   * not collide with the video track id. The previous implementation copied the
   * audio trak verbatim and left both stco tables pointing at the original
   * (pre-merge) file offsets and both track ids identical — producing a structurally
   * broken MP4 (silent / undecodable audio). This was the core of debt F-10.
   * @param {ArrayBuffer} videoArrayBuffer
   * @param {ArrayBuffer} audioArrayBuffer
   * @returns {Promise<Blob>}
   */
  static async mergeMp4Streams(videoArrayBuffer, audioArrayBuffer) {
    const videoBytes = new Uint8Array(videoArrayBuffer);
    const audioBytes = new Uint8Array(audioArrayBuffer);

    const videoBoxes = RedditVideoMuxer.parseMp4Boxes(videoBytes);
    const audioBoxes = RedditVideoMuxer.parseMp4Boxes(audioBytes);

    if (!videoBoxes.ftyp || !videoBoxes.moov || !audioBoxes.moov || !videoBoxes.mdat || !audioBoxes.mdat) {
      return new Blob([videoArrayBuffer], { type: 'video/mp4' });
    }

    const audioTrak = RedditVideoMuxer.findBoxDeep(audioBytes, audioBoxes.moov.start + 8, audioBoxes.moov.end, 'trak');
    if (!audioTrak) {
      return new Blob([videoArrayBuffer], { type: 'video/mp4' });
    }

    const ftyp = videoBytes.subarray(videoBoxes.ftyp.start, videoBoxes.ftyp.end);
    const videoMoovContent = videoBytes.subarray(videoBoxes.moov.start + 8, videoBoxes.moov.end);
    const audioTrakContent = audioBytes.subarray(audioTrak.start, audioTrak.end);
    const videoMdatContent = videoBytes.subarray(videoBoxes.mdat.start + 8, videoBoxes.mdat.end);
    const audioMdatContent = audioBytes.subarray(audioBoxes.mdat.start + 8, audioBoxes.mdat.end);

    const ftypLen = ftyp.length;
    const videoMoovLen = videoMoovContent.length;
    const audioTrakLen = audioTrakContent.length;
    const moovLen = 8 + videoMoovLen + audioTrakLen;

    const moov = new Uint8Array(moovLen);
    const moovView = new DataView(moov.buffer);
    moovView.setUint32(0, moovLen);
    moov.set([109, 111, 111, 118], 4); // 'moov'
    moov.set(videoMoovContent, 8);
    const audioTrakOffset = 8 + videoMoovLen;
    moov.set(audioTrakContent, audioTrakOffset);

    // Absolute offset of each mdat content block in the FINAL file.
    const moovEnd = ftypLen + moovLen;
    const videoMdatContentStart = moovEnd + 8;
    const audioMdatContentStart = videoMdatContentStart + videoMdatContent.length + 8;

    const deltaVideo = videoMdatContentStart - (videoBoxes.mdat.start + 8);
    const deltaAudio = audioMdatContentStart - (audioBoxes.mdat.start + 8);

    // Relocate chunk offsets. The video stco lives in the video moov region; the
    // audio stco lives in the embedded audio trak region.
    RedditVideoMuxer.patchChunkOffsets(moov, 8, 8 + videoMoovLen, deltaVideo);
    RedditVideoMuxer.patchChunkOffsets(moov, audioTrakOffset, audioTrakOffset + audioTrakLen, deltaAudio);

    // Avoid audio/video track id collision.
    const videoTrackId = RedditVideoMuxer.readTrackId(moov, 8, 8 + videoMoovLen);
    const newAudioId = videoTrackId === 1 ? 2 : 1;
    RedditVideoMuxer.renumberTrack(moov, audioTrakOffset, audioTrakOffset + audioTrakLen, newAudioId);
    RedditVideoMuxer.bumpNextTrackId(moov, 8, 8 + videoMoovLen, Math.max(videoTrackId, newAudioId) + 1);

    const out = new Uint8Array(
      ftypLen + moovLen + 8 + videoMdatContent.length + 8 + audioMdatContent.length
    );
    const outView = new DataView(out.buffer);
    let p = 0;
    out.set(ftyp, p); p += ftypLen;
    out.set(moov, p); p += moovLen;

    outView.setUint32(p, videoMdatContent.length + 8);
    out.set([109, 100, 97, 116], p + 4); // 'mdat'
    p += 8;
    out.set(videoMdatContent, p); p += videoMdatContent.length;

    outView.setUint32(p, audioMdatContent.length + 8);
    out.set([109, 100, 97, 116], p + 4);
    p += 8;
    out.set(audioMdatContent, p);

    return new Blob([out], { type: 'video/mp4' });
  }

  /** Box types that contain nested boxes (used when walking the tree for stco/tkhd/mvhd). */
  static get CONTAINER_BOXES() {
    return new Set(['moov', 'trak', 'mdia', 'minf', 'dinf', 'stbl', 'edts', 'udta', 'mvex', 'tref', 'nmhd', 'gmhd']);
  }

  static readBoxType(bytes, at) {
    return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  }

  /** Recursively relocates stco/co64 chunk offsets within [start, end) by delta bytes. */
  static patchChunkOffsets(bytes, start, end, delta) {
    if (delta === 0) return;
    let offset = start;
    while (offset + 8 <= end) {
      const hdrView = new DataView(bytes.buffer, bytes.byteOffset + offset, Math.min(8, end - offset));
      const size = hdrView.getUint32(0);
      const type = RedditVideoMuxer.readBoxType(bytes, offset + 4);
      if (size < 8 || offset + size > end) break;

      if (type === 'stco') {
        const boxView = new DataView(bytes.buffer, bytes.byteOffset + offset, size);
        const count = boxView.getUint32(12);
        for (let i = 0; i < count; i++) {
          boxView.setUint32(16 + i * 4, boxView.getUint32(16 + i * 4) + delta);
        }
      } else if (type === 'co64') {
        const boxView = new DataView(bytes.buffer, bytes.byteOffset + offset, size);
        const count = boxView.getUint32(12);
        for (let i = 0; i < count; i++) {
          boxView.setBigUint64(16 + i * 8, boxView.getBigUint64(16 + i * 8) + BigInt(delta));
        }
      } else if (RedditVideoMuxer.CONTAINER_BOXES.has(type)) {
        RedditVideoMuxer.patchChunkOffsets(bytes, offset + 8, offset + size, delta);
      }
      offset += size;
    }
  }

  /** Deep (recursive) box search including nested containers. */
  static findBoxDeep(bytes, start, end, targetType) {
    let offset = start;
    while (offset + 8 <= end) {
      const hdrView = new DataView(bytes.buffer, bytes.byteOffset + offset, Math.min(8, end - offset));
      const size = hdrView.getUint32(0);
      const type = RedditVideoMuxer.readBoxType(bytes, offset + 4);
      if (size < 8 || offset + size > end) break;
      if (type === targetType) return { start: offset, end: offset + size, size };
      if (RedditVideoMuxer.CONTAINER_BOXES.has(type)) {
        const found = RedditVideoMuxer.findBoxDeep(bytes, offset + 8, offset + size, targetType);
        if (found) return found;
      }
      offset += size;
    }
    return null;
  }

  static readTrackId(bytes, start, end) {
    const tkhd = RedditVideoMuxer.findBoxDeep(bytes, start, end, 'tkhd');
    if (!tkhd) return 0;
    return RedditVideoMuxer.readTkhdTrackId(bytes, tkhd.start);
  }

  static readTkhdTrackId(bytes, tkhdStart) {
    const version = bytes[tkhdStart + 8] & 0xff;
    const view = new DataView(bytes.buffer, bytes.byteOffset + tkhdStart, bytes.length - tkhdStart);
    const trackIdOffset = version === 1 ? 24 : 16;
    return view.getUint32(trackIdOffset);
  }

  /** Rewrites the track id inside a tkhd box (handles version 0 and 1). */
  static renumberTrack(bytes, start, end, newId) {
    const tkhd = RedditVideoMuxer.findBoxDeep(bytes, start, end, 'tkhd');
    if (!tkhd) return;
    const version = bytes[tkhd.start + 8] & 0xff;
    const view = new DataView(bytes.buffer, bytes.byteOffset + tkhd.start, tkhd.end - tkhd.start);
    const trackIdOffset = version === 1 ? 24 : 16;
    view.setUint32(trackIdOffset, newId >>> 0);
  }

  /** Keeps mvhd.next_track_ID ahead of the highest assigned id. */
  static bumpNextTrackId(bytes, start, end, nextId) {
    const mvhd = RedditVideoMuxer.findBoxDeep(bytes, start, end, 'mvhd');
    if (!mvhd) return;
    const version = bytes[mvhd.start + 8] & 0xff;
    const view = new DataView(bytes.buffer, bytes.byteOffset + mvhd.start, mvhd.end - mvhd.start);
    const offset = version === 1 ? 108 : 100;
    view.setUint32(offset, nextId >>> 0);
  }

  static parseMp4Boxes(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    const boxes = {};

    while (offset < bytes.length - 8) {
      const size = view.getUint32(offset);
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      if (size <= 0 || offset + size > bytes.length + 8) break;

      boxes[type] = { start: offset, end: offset + size, size };
      offset += size;
    }
    return boxes;
  }

  static findBox(bytes, start, end, targetType) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = start;

    while (offset < end - 8) {
      const size = view.getUint32(offset);
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      if (size <= 0 || offset + size > end) break;

      if (type === targetType) {
        return { start: offset, end: offset + size, size };
      }
      offset += size;
    }
    return null;
  }
}
