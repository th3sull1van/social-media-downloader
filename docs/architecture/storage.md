# Storage

## Durable data

`StorageService` owns `chrome.storage.local` access. Settings live in
`core.settings`; exact-download signatures live in `core.dedup_history`, capped
at 50,000 entries. A download job loads one `Set` for historical lookups instead
of reading storage per media item. Clearing history invalidates active snapshots
and prevents older jobs from writing the cleared history back. Writes are serialized.
Binary identity and completion requirements are defined in SPECIFICATION.md §48.
Old CRC-32 signatures remain harmless historical entries; new jobs cannot match them.

## Temporary media

ZIP and generated-file transports write to extension-origin OPFS under
`smd_temp/<resource UUID>/payload`. Each resource has its own directory and a
small `resource.json` containing its extension Blob URL. No site credentials,
account data or remote media URL are stored in this metadata.

The service worker associates Blob URLs with browser download IDs. On `complete`
or `interrupted`, the offscreen revokes the URL and removes only its directory.
Files remain available while Chrome downloads them, including jobs longer than
ten minutes. Failure before browser handoff and cancellation during production
also discard the corresponding temporary file. A published file is preserved
until browser ownership is resolved; cancelling ZIP production cannot delete a
file already handed to Chrome.

On worker startup, the background queries in-progress downloads before allowing
new producers. The offscreen retains resources whose metadata URL matches an
active download and removes other owned resources. The old `smd_zip_temp`
directory is removed only when no extension Blob download might still use it.
A failed browser query prevents recovery deletion. Missing paths are already
clean; other I/O errors are returned and logged, with ownership retained for retry.

Generated files and ZIP entries use acknowledged blocks of at most 512 KiB
before Base64 encoding. This bounds serialization buffers, not the complete
memory footprint of a resolver: Reddit MP4 muxing and exact deduplication still
materialize binary media where required by their current algorithms.

## Site storage boundary

The current runtime does not create IndexedDB databases or Cache Storage entries
on `reddit.com`, Instagram or Facebook. Extension-origin OPFS cleanup therefore
must not be presented as proof that site-attributed storage is fixed. Never clear
all storage for a site as a download cleanup strategy. Identify a particular
extension-owned legacy resource before adding a migration for it.

Private HARs and local reports remain under ignored `fixtures-private/` and
`.artifacts/`. The download output directory is never a temporary-cleanup target.
