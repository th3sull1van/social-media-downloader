/**
 * Social Media Downloader — Offscreen ZIP Packager
 * Manifest V3 Offscreen Document dedicated for JSZip packaging in STORE mode.
 * Safe memory ceiling with real-time packaging progress reporting.
 */

const state = {
  zip: null,
  jobBytes: 0,
  completed: 0,
  sizeLimitHit: false,
  cancelled: false,
  lastPct: -1,
  lastObjectUrl: null,
  revokeTimer: null,
  /** @type {Set<string>} */
  generatedBlobUrls: new Set()
};

// Memory guard: 1 GB ceiling
const MAX_ZIP_BYTES = 1024 * 1024 * 1024;

function reportProgress(patch) {
  try {
    chrome.runtime.sendMessage({ type: 'ZIP_OFFSCREEN_PROGRESS', patch }).catch(() => {});
  } catch (e) {}
}

function resetState() {
  state.zip = new JSZip();
  state.jobBytes = 0;
  state.completed = 0;
  state.sizeLimitHit = false;
  state.cancelled = false;
  state.lastPct = -1;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function addFile(name, bufferOrB64) {
  if (!state.zip) return { ok: false, reason: 'no_active_zip' };
  if (state.cancelled) return { ok: false, reason: 'cancelled' };

  let bytes;
  if (typeof Blob !== 'undefined' && bufferOrB64 instanceof Blob) {
    bytes = new Uint8Array(await bufferOrB64.arrayBuffer());
  } else if (bufferOrB64 instanceof ArrayBuffer) {
    bytes = new Uint8Array(bufferOrB64);
  } else if (bufferOrB64 && bufferOrB64.buffer instanceof ArrayBuffer) {
    bytes = bufferOrB64;
  } else if (typeof bufferOrB64 === 'string') {
    bytes = base64ToBytes(bufferOrB64);
  } else {
    return { ok: false, reason: 'invalid_data' };
  }

  if (state.jobBytes + bytes.byteLength > MAX_ZIP_BYTES) {
    state.sizeLimitHit = true;
    return { ok: false, reason: 'size_limit', jobBytes: state.jobBytes };
  }
  state.jobBytes += bytes.byteLength;
  state.zip.file(name, bytes, { binary: true, compression: 'STORE' });
  state.completed++;

  reportProgress({
    status: state.sizeLimitHit ? 'FAILED_SIZE' : 'DOWNLOADING_BLOBS',
    completed: state.completed
  });

  return { ok: true, jobBytes: state.jobBytes };
}

async function finishZip(zipFilename, discard) {
  if (!state.zip) return { ok: false, reason: 'no_active_zip' };
  const zip = state.zip;
  state.zip = null;

  if (discard) return { ok: false, reason: 'discarded', completed: state.completed };
  if (state.cancelled) return { ok: false, reason: 'cancelled', completed: state.completed };
  if (state.sizeLimitHit) return { ok: false, reason: 'size_limit', completed: state.completed };

  reportProgress({ status: 'PACKAGING_ZIP' });

  try {
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (metadata) => {
      const pct = Math.round((metadata.percent || 0) / 5) * 5;
      if (pct !== state.lastPct) {
        state.lastPct = pct;
        reportProgress({ status: 'PACKAGING_ZIP', zipPercent: pct });
      }
    });

    const objectUrl = URL.createObjectURL(zipBlob);
    state.lastObjectUrl = objectUrl;
    clearTimeout(state.revokeTimer);
    state.revokeTimer = setTimeout(() => {
      if (state.lastObjectUrl) {
        URL.revokeObjectURL(state.lastObjectUrl);
        state.lastObjectUrl = null;
      }
    }, 600_000);

    return { ok: true, objectUrl, completed: state.completed };
  } catch (err) {
    return { ok: false, reason: err?.message || 'zip_failed', completed: state.completed };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  switch (message.type) {
    case 'OFFSCREEN_BEGIN_ZIP':
      resetState();
      sendResponse({ ok: true });
      return;

    case 'OFFSCREEN_ADD_FILE':
      addFile(message.name, message.dataB64 || message.buffer).then(sendResponse);
      return true;

    case 'OFFSCREEN_FINISH_ZIP':
      finishZip(message.zipFilename, message.discard).then(sendResponse);
      return true;

    case 'OFFSCREEN_ABORT_ZIP':
      state.cancelled = true;
      sendResponse({ ok: true });
      return;

    // Creates a blob URL for generated artifacts (muxed MP4, RedGifs transcodes).
    // The service worker cannot call URL.createObjectURL itself. Binary arrives
    // base64-encoded (runtime.sendMessage JSON-serializes messages).
    case 'OFFSCREEN_CREATE_BLOB_URL': {
      try {
        if (typeof message.dataB64 !== 'string' || message.dataB64.length === 0) {
          sendResponse({ ok: false, reason: 'invalid_data' });
          return;
        }
        const bytes = base64ToBytes(message.dataB64);
        const blob = new Blob([bytes], { type: message.mimeType || 'application/octet-stream' });
        const objectUrl = URL.createObjectURL(blob);
        state.generatedBlobUrls.add(objectUrl);
        sendResponse({ ok: true, objectUrl });
      } catch (err) {
        sendResponse({ ok: false, reason: err?.message || 'blob_url_failed' });
      }
      return;
    }

    case 'OFFSCREEN_REVOKE_BLOB_URLS': {
      const urls = Array.isArray(message.urls) ? message.urls : [];
      for (const url of urls) {
        if (state.generatedBlobUrls.has(url)) {
          URL.revokeObjectURL(url);
          state.generatedBlobUrls.delete(url);
        }
      }
      sendResponse({ ok: true });
      return;
    }
  }
});
