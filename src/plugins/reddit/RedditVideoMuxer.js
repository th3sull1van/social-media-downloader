/**
 * Social Media Downloader — Reddit Video Muxer
 * Resolves DASH video and audio streams and multiplexes MP4 moov/mdat boxes in-browser.
 */

export class RedditVideoMuxer {
  static _activeMuxes = 0;
  static _maxConcurrentMuxes = 2;
  /** @type {Array<{ grant: () => void }>} */
  static _muxWaiters = [];

  static async _withMuxSlot(fn, signal = undefined) {
    signal?.throwIfAborted();
    if (RedditVideoMuxer._activeMuxes < RedditVideoMuxer._maxConcurrentMuxes) {
      RedditVideoMuxer._activeMuxes++;
    } else {
      await new Promise((resolve, reject) => {
        let settled = false;
        const onAbort = () => {
          if (settled) return;
          settled = true;
          const idx = RedditVideoMuxer._muxWaiters.indexOf(waiter);
          if (idx !== -1) RedditVideoMuxer._muxWaiters.splice(idx, 1);
          reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        };
        const waiter = {
          grant() {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            resolve(undefined);
          }
        };
        RedditVideoMuxer._muxWaiters.push(waiter);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }

    try {
      signal?.throwIfAborted();
      return await fn();
    } finally {
      // Atomic slot handoff: if a waiter is queued, transfer the active slot directly
      // without decrementing _activeMuxes so a concurrent caller cannot barge past the cap.
      const next = RedditVideoMuxer._muxWaiters.shift();
      if (next) {
        next.grant();
      } else {
        RedditVideoMuxer._activeMuxes = Math.max(0, RedditVideoMuxer._activeMuxes - 1);
      }
    }
  }

  static async checkUrlExists(url, signal = undefined) {
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-cache', signal });
      return res.ok;
    } catch {
      signal?.throwIfAborted();
      return false;
    }
  }

  /**
   * Discovers highest resolution video stream and companion audio stream.
   * @param {string} baseUrl
   * @param {string} [fallbackUrl]
   * @returns {Promise<{ videoUrl: string | null, audioUrl: string | null, audioFallbacks: string[], hasAudio: boolean }>}
   */
  static async resolveStreams(baseUrl, fallbackUrl, signal = undefined) {
    const base = baseUrl.replace(/\/DASH_[^\/?#]+.*$/, '').replace(/\/?$/, '/');
    const videoResolutions = ['DASH_1080.mp4', 'DASH_720.mp4', 'DASH_480.mp4', 'DASH_360.mp4', 'DASH_240.mp4'];
    const audioCandidates = ['DASH_AUDIO_128.mp4', 'DASH_audio.mp4', 'DASH_AUDIO_64.mp4', 'DASH_AUDIO_32.mp4', 'CMAF_AUDIO_128.mp4', 'CMAF_AUDIO_64.mp4'];

    // Probe video and audio candidates in parallel instead of up to 11 sequential round-trips.
    const [videoChecks, audioChecks] = await Promise.all([
      Promise.all(videoResolutions.map(async (res) => {
        const candidate = base + res;
        return (await RedditVideoMuxer.checkUrlExists(candidate, signal)) ? candidate : null;
      })),
      Promise.all(audioCandidates.map(async (aud) => {
        const candidate = base + aud;
        return (await RedditVideoMuxer.checkUrlExists(candidate, signal)) ? candidate : null;
      }))
    ]);
    signal?.throwIfAborted();

    let bestVideoUrl = videoChecks.find(Boolean) || null;
    if (!bestVideoUrl && fallbackUrl) {
      bestVideoUrl = fallbackUrl.replace(/\?.*$/, '');
    }

    const availableAudio = audioChecks.filter(Boolean);
    const audioUrl = availableAudio[0] || null;

    return {
      videoUrl: bestVideoUrl,
      audioUrl,
      audioFallbacks: availableAudio.slice(1),
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
  static async fetchStreamWithProgress(url, onProgress, startPct = 0, weightPct = 100, signal = undefined) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} when fetching ${url}`);

    const contentLength = res.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    const reader = res.body?.getReader();
    if (!reader) {
      return await res.arrayBuffer();
    }

    // When the payload size is known up-front, write straight into a pre-sized
    // buffer instead of collecting chunk copies (avoids a ~2x transient peak).
    // `received` still comes from actual bytes so a wrong content-length can't
    // over-read; only the pre-sized array is returned when sizes agree.
    let received = 0;
    let totalBuffer = total > 0 ? new Uint8Array(total) : null;
    const chunks = [];

    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      signal?.throwIfAborted();
      while (true) {
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        if (totalBuffer) {
          if (received + value.length > totalBuffer.length) {
            // Content-length lied (payload larger than announced). Fall back to
            // collecting chunks instead of overflowing the pre-sized buffer.
            chunks.push(totalBuffer.subarray(0, received));
            totalBuffer = null;
            chunks.push(value);
          } else {
            totalBuffer.set(value, received);
          }
        } else {
          chunks.push(value);
        }
        received += value.length;

        if (total && onProgress) {
          const pct = Math.min(99, Math.round(startPct + (received / total) * weightPct));
          onProgress(pct, `Downloading... ${Math.round(received / 1024)} KB`);
        }
      }
    } catch (err) {
      // Release the stream reader so an aborted/failed fetch does not leak the
      // underlying resource (AGENTS §96 cancellation propagation).
      reader.cancel().catch(() => {});
      throw err;
    } finally {
      signal?.removeEventListener('abort', cancel);
      reader.releaseLock();
    }

    if (!totalBuffer) {
      totalBuffer = new Uint8Array(received);
      let position = 0;
      for (const chunk of chunks) {
        totalBuffer.set(chunk, position);
        position += chunk.length;
      }
    } else if (received < totalBuffer.length) {
      // Content-length overstated the payload (truncated body). Return only the
      // bytes actually streamed, discarding the zero-filled tail.
      totalBuffer = totalBuffer.slice(0, received);
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
  static async downloadMuxedVideo(videoUrl, audioUrl, onProgress, signal = undefined) {
    if (!videoUrl) {
      throw new Error('Unable to resolve Reddit video stream URL');
    }
    return RedditVideoMuxer._withMuxSlot(async () => {
      signal?.throwIfAborted();
      if (!audioUrl) {
        if (onProgress) onProgress(10, 'Downloading video...');
        const videoBuffer = await RedditVideoMuxer.fetchStreamWithProgress(videoUrl, onProgress, 10, 85, signal);
        if (onProgress) onProgress(100, 'Ready!');
        return new Blob([videoBuffer], { type: 'video/mp4' });
      }

      if (onProgress) onProgress(5, 'Downloading video track...');
      const videoBuffer = await RedditVideoMuxer.fetchStreamWithProgress(videoUrl, onProgress, 5, 55, signal);

      if (onProgress) onProgress(60, 'Downloading audio track...');
      const audioBuffer = await RedditVideoMuxer.fetchStreamWithProgress(audioUrl, onProgress, 60, 30, signal);

      signal?.throwIfAborted();
      if (onProgress) onProgress(90, 'Multiplexing tracks...');

      try {
        const mergedBlob = await RedditVideoMuxer.mergeMp4Streams(videoBuffer, audioBuffer, true);
        if (onProgress) onProgress(100, 'Completed!');
        return mergedBlob;
      } catch (err) {
        // Surface the mux failure instead of silently returning a video-only blob with
        // no audio (that masked a structural bug: broken chunk-offset tables).
        throw new Error(`Failed to mux video and audio: ${err?.message || err}`);
      }
    }, signal);
  }

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
   * @param {boolean} [audioRequired=false] true when a resolved audio URL was provided
   * @returns {Promise<Blob>}
   */
  static async mergeMp4Streams(videoArrayBuffer, audioArrayBuffer, audioRequired = false) {
    const videoBytes = new Uint8Array(videoArrayBuffer);
    const audioBytes = new Uint8Array(audioArrayBuffer);

    const videoBoxes = RedditVideoMuxer.parseMp4Boxes(videoBytes);
    const audioBoxes = RedditVideoMuxer.parseMp4Boxes(audioBytes);

    const audioWasProvided = audioRequired || audioBytes.length > 0;
    if (!videoBoxes.ftyp || !videoBoxes.moov || !videoBoxes.mdat) {
      if (audioWasProvided) throw new Error('Invalid video or audio MP4 structure');
      return new Blob([videoArrayBuffer], { type: 'video/mp4' });
    }
    if (!audioWasProvided) return new Blob([videoArrayBuffer], { type: 'video/mp4' });
    if (!audioBoxes.moov || !audioBoxes.mdat) throw new Error('Invalid audio MP4 structure');
    if (videoBoxes.moofCount > 0 || audioBoxes.moofCount > 0 || videoBoxes.mdatCount !== 1 || audioBoxes.mdatCount !== 1) {
      throw new Error('Unsupported fragmented or multi-mdat MP4 stream');
    }

    const audioTrak = RedditVideoMuxer.findBoxDeep(audioBytes, audioBoxes.moov.start + 8, audioBoxes.moov.end, 'trak');
    if (!audioTrak) throw new Error('Invalid audio MP4 track');

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

    // Rescale audio tkhd.duration and elst.segment_duration from the audio mvhd.timescale
    // into the video mvhd.timescale (ISO/IEC 14496-12 §8.3.2.3 & §8.6.6.3).
    const videoTimescale = RedditVideoMuxer.readMvhdTimescale(moov, 8, 8 + videoMoovLen);
    const audioTimescale = RedditVideoMuxer.readMvhdTimescale(audioBytes, audioBoxes.moov.start + 8, audioBoxes.moov.end);
    if (videoTimescale > 0 && audioTimescale > 0 && videoTimescale !== audioTimescale) {
      RedditVideoMuxer.rescaleTrackMovieTimescale(moov, audioTrakOffset, audioTrakOffset + audioTrakLen, audioTimescale, videoTimescale);
    }

    // Avoid audio/video track id collision across any number of tracks in video moov.
    const maxVideoTrackId = RedditVideoMuxer.readMaxTrackId(moov, 8, 8 + videoMoovLen);
    const newAudioId = maxVideoTrackId + 1;
    RedditVideoMuxer.renumberTrack(moov, audioTrakOffset, audioTrakOffset + audioTrakLen, newAudioId);
    RedditVideoMuxer.bumpNextTrackId(moov, 8, 8 + videoMoovLen, newAudioId + 1);

    const videoMdatHdr = new Uint8Array(8);
    new DataView(videoMdatHdr.buffer).setUint32(0, videoMdatContent.length + 8);
    videoMdatHdr.set([109, 100, 97, 116], 4); // 'mdat'

    const audioMdatHdr = new Uint8Array(8);
    new DataView(audioMdatHdr.buffer).setUint32(0, audioMdatContent.length + 8);
    audioMdatHdr.set([109, 100, 97, 116], 4); // 'mdat'

    return new Blob(
      [ftyp, moov, videoMdatHdr, videoMdatContent, audioMdatHdr, audioMdatContent],
      { type: 'video/mp4' }
    );
  }

  /** Box types that contain nested boxes (used when walking the tree for stco/tkhd/mvhd/elst). */
  static get CONTAINER_BOXES() {
    return new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts']);
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
        if (size < 16) { offset += size; continue; }
        const boxView = new DataView(bytes.buffer, bytes.byteOffset + offset, size);
        const count = boxView.getUint32(12);
        if (count > Math.floor((size - 16) / 4)) { offset += size; continue; }
        for (let i = 0; i < count; i++) {
          const updated = boxView.getUint32(16 + i * 4) + delta;
          if (updated < 0 || updated > 0xFFFFFFFF) {
            throw new Error('MP4 stco chunk offset overflow');
          }
          boxView.setUint32(16 + i * 4, updated);
        }
      } else if (type === 'co64') {
        if (size < 16) { offset += size; continue; }
        const boxView = new DataView(bytes.buffer, bytes.byteOffset + offset, size);
        const count = boxView.getUint32(12);
        if (count > Math.floor((size - 16) / 8)) { offset += size; continue; }
        for (let i = 0; i < count; i++) {
          const updated = boxView.getBigUint64(16 + i * 8) + BigInt(delta);
          if (updated < 0n) {
            throw new Error('MP4 co64 chunk offset underflow');
          }
          boxView.setBigUint64(16 + i * 8, updated);
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
    return RedditVideoMuxer.readTkhdTrackId(bytes, tkhd.start, tkhd.end);
  }

  static readMaxTrackId(bytes, start, end) {
    let maxId = 0;
    let offset = start;
    while (offset + 8 <= end) {
      const hdrView = new DataView(bytes.buffer, bytes.byteOffset + offset, Math.min(8, end - offset));
      const size = hdrView.getUint32(0);
      const type = RedditVideoMuxer.readBoxType(bytes, offset + 4);
      if (size < 8 || offset + size > end) break;
      if (type === 'trak') {
        const id = RedditVideoMuxer.readTrackId(bytes, offset + 8, offset + size);
        if (id > maxId) maxId = id;
      }
      offset += size;
    }
    return maxId || RedditVideoMuxer.readTrackId(bytes, start, end);
  }

  static readTkhdTrackId(bytes, tkhdStart, tkhdEnd = bytes.length) {
    if (tkhdStart < 0 || tkhdStart + 12 > tkhdEnd || tkhdEnd > bytes.length) return 0;
    const version = bytes[tkhdStart + 8] & 0xff;
    const trackIdOffset = version === 1 ? 28 : 20;
    if (tkhdStart + trackIdOffset + 4 > tkhdEnd) return 0;
    return new DataView(bytes.buffer, bytes.byteOffset + tkhdStart, bytes.length - tkhdStart)
      .getUint32(trackIdOffset);
  }

  /** Rewrites the track id inside a tkhd box (handles version 0 and 1). */
  static renumberTrack(bytes, start, end, newId) {
    const tkhd = RedditVideoMuxer.findBoxDeep(bytes, start, end, 'tkhd');
    if (!tkhd || tkhd.end < tkhd.start + 12) return;
    const version = bytes[tkhd.start + 8] & 0xff;
    const trackIdOffset = version === 1 ? 28 : 20;
    if (tkhd.start + trackIdOffset + 4 > tkhd.end) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset + tkhd.start, tkhd.end - tkhd.start);
    view.setUint32(trackIdOffset, newId >>> 0);
  }

  /** Reads mvhd.timescale (version 0: offset 20; version 1: offset 28 from box start). */
  static readMvhdTimescale(bytes, start, end) {
    const mvhd = RedditVideoMuxer.findBoxDeep(bytes, start, end, 'mvhd');
    if (!mvhd || mvhd.end < mvhd.start + 12) return 0;
    const version = bytes[mvhd.start + 8] & 0xff;
    const offset = version === 1 ? 28 : 20;
    if (mvhd.start + offset + 4 > mvhd.end) return 0;
    return new DataView(bytes.buffer, bytes.byteOffset + mvhd.start, mvhd.end - mvhd.start).getUint32(offset);
  }

  /** Rescales movie-timescale durations in tkhd and elst inside a trak box. */
  static rescaleTrackMovieTimescale(bytes, start, end, fromScale, toScale) {
    if (!fromScale || !toScale || fromScale === toScale) return;
    const tkhd = RedditVideoMuxer.findBoxDeep(bytes, start, end, 'tkhd');
    if (tkhd && tkhd.end >= tkhd.start + 12) {
      const version = bytes[tkhd.start + 8] & 0xff;
      const view = new DataView(bytes.buffer, bytes.byteOffset + tkhd.start, tkhd.end - tkhd.start);
      if (version === 1 && tkhd.start + 44 <= tkhd.end) {
        const dur = view.getBigUint64(36);
        if (dur !== 0xFFFFFFFFFFFFFFFFn) {
          view.setBigUint64(36, (dur * BigInt(toScale) + BigInt(Math.floor(fromScale / 2))) / BigInt(fromScale));
        }
      } else if (version === 0 && tkhd.start + 32 <= tkhd.end) {
        const dur = view.getUint32(28);
        if (dur !== 0xFFFFFFFF) {
          const rescaled = Math.min(0xFFFFFFFE, Math.round((dur * toScale) / fromScale));
          view.setUint32(28, rescaled >>> 0);
        }
      }
    }
    const elst = RedditVideoMuxer.findBoxDeep(bytes, start, end, 'elst');
    if (elst && elst.end >= elst.start + 16) {
      const version = bytes[elst.start + 8] & 0xff;
      const view = new DataView(bytes.buffer, bytes.byteOffset + elst.start, elst.end - elst.start);
      const count = view.getUint32(12);
      const entrySize = version === 1 ? 20 : 12;
      for (let i = 0; i < count; i++) {
        const entryOff = 16 + i * entrySize;
        if (elst.start + entryOff + entrySize > elst.end) break;
        if (version === 1) {
          const segDur = view.getBigUint64(entryOff);
          view.setBigUint64(entryOff, (segDur * BigInt(toScale) + BigInt(Math.floor(fromScale / 2))) / BigInt(fromScale));
        } else {
          const segDur = view.getUint32(entryOff);
          view.setUint32(entryOff, Math.min(0xFFFFFFFE, Math.round((segDur * toScale) / fromScale)) >>> 0);
        }
      }
    }
  }

  /** Keeps mvhd.next_track_ID ahead of the highest assigned id. */
  static bumpNextTrackId(bytes, start, end, nextId) {
    const mvhd = RedditVideoMuxer.findBoxDeep(bytes, start, end, 'mvhd');
    if (!mvhd || mvhd.end < mvhd.start + 12) return;
    const version = bytes[mvhd.start + 8] & 0xff;
    const offset = version === 1 ? 116 : 104;
    if (mvhd.start + offset + 4 > mvhd.end) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset + mvhd.start, mvhd.end - mvhd.start);
    view.setUint32(offset, nextId >>> 0);
  }

  static parseMp4Boxes(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    const boxes = { moofCount: 0, mdatCount: 0 };

    while (offset + 8 <= bytes.length) {
      const rawSize = view.getUint32(offset);
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      if (rawSize === 1) break;
      const size = rawSize === 0 ? bytes.length - offset : rawSize;
      if (size < 8 || offset + size > bytes.length) break;

      if (type === 'moof') boxes.moofCount++;
      if (type === 'mdat') boxes.mdatCount++;
      boxes[type] = { start: offset, end: offset + size, size };
      offset += size;
    }
    return boxes;
  }
}
