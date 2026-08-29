# Facebook — Resolution

- **Model:** Facebook does **not** implement `resolveMedia()`; Core downloads
  directly from `item.downloadUrl || item.url`.
- **Full resolution:** `src/plugins/meta-shared/MetaCdn.js` upgrades `fbcdn.net`
  previews to the full-resolution URL at scan time (the `fb-fullres` tests
  verify this).
- **Artifact:** resolves to a `DirectArtifact` (`kind: 'direct'`) in Core.
- **Invariants:** full-resolution preference and source-tab/album identity are
  preserved (SPEC §88, AGENTS §82).

Resolution failures surface as structured `ParseError` / `ResolverError`
(SPEC §74).
