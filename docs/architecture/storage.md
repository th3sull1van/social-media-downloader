# Storage

> The extension currently has no settings surface: no code reads or writes
> `chrome.storage`, so no `StorageService` abstraction exists. The `storage` +
> `unlimitedStorage` permissions remain reserved; reintroduce a namespaced
> wrapper (keys `core.*`, `instagram.*`, `facebook.*`, `reddit.*`, SPEC §49 /
> AGENTS §47) at the first real settings feature.

## Durable vs temporary

- **Durable** settings/configuration would live under an owning namespace and
  survive browser restarts. None exist yet.
- **Temporary** data — caches, intermediate blobs, DASH fragments, diagnostics,
  HAR captures — is kept separate and explicitly ignored by Git
  (`fixtures-private/`, `.artifacts/`, `downloads/`) and given lifecycle/cleanup
  where practical (SPEC §50, AGENTS §48).

## Security

Storage values may contain platform strings and must be treated as untrusted
input. Sensitive credentials, tokens and cookies are never persisted; logging
redacts `cookie`, `authorization`, `token`, `password`, `secret` and
platform-specific tokens (`fb_dtsg`, `csrftoken`) via `Logger.sanitize()`.
