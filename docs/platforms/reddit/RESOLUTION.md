# Reddit — Resolution

Reddit **implements** `resolveMedia()` (`RedditPlugin.resolveMedia`), so the
plugin owns how each item becomes a `DownloadArtifact`:

- **DASH video** (`metadata.baseUrl`): `RedditVideoMuxer` discovers video + audio
  streams and produces a **muxed MP4** (`kind: 'generated'`). This preserves the
  DASH audio/video pairing that a raw fetch would lose.
- **RedGifs** (`sourceType === 'redgifs'`): `RedGifsResolver` returns the direct
  HD/SD MP4 URL (`kind: 'direct'`).
- **Everything else:** a `DirectArtifact` from `downloadUrl || url`.

The Core `DownloadManager` calls `resolveMedia()` whenever the plugin provides it
and executes the returned artifact by `kind` — it never inspects
`metadata.isRedGifs` / `sourceType` / `baseUrl` itself (SPEC §37, §164).

**Invariants:** gallery ordering, DASH audio/video association, muxing
correctness, RedGifs resolution, duplicate handling and profile discovery are
preserved (SPEC §88, AGENTS §82).

The optional `context.signal` reaches DASH discovery and stream reads. Cancelling
stops pending reads and releases reader locks. Incorrect `Content-Length` headers
fall back to collected chunks or trim the returned buffer to the actual bytes;
headers must never introduce zero-filled padding or a null chunk accumulator.
The muxer still holds whole tracks in memory; bounded Core transport removes the
additional whole-file Base64 message, not the muxer's existing binary buffers.
