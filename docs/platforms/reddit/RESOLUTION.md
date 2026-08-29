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
