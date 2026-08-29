# Instagram — Resolution

- **Model:** Instagram does **not** implement `resolveMedia()`; the Core
  `DownloadManager` downloads directly from `item.downloadUrl || item.url`.
- **Full resolution:** `src/plugins/meta-shared/MetaCdn.js` upgrades preview
  URLs to the uncropped, full-resolution CDN URL at scan time (the `ig-fullres`
  tests verify this), so items already carry the best available URL.
- **Artifact:** produces `MediaItem`s that resolve to a `DirectArtifact`
  (`kind: 'direct'`) in Core.
- **Invariants:** full-resolution media preference and carousel ordering are
  preserved (SPEC §88, AGENTS §82).

Resolution failures surface as structured `ParseError` / `ResolverError`
(SPEC §74) rather than silent empty results.
