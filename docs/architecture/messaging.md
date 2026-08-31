# Messaging

Messages are plain objects (`{ type, payload }`); handlers validate `type`
(and `action` for legacy callers) before acting. Message types are string
literals at their send/receive sites; Core keeps no registry of them.
Platform-specific message types are **owned by the plugin** that uses them.

> A shared `MessageBus`/`Envelope` abstraction and a `MessageTypes.js` constant
> registry were deliberately not kept: every call site inlines the same strings
> and nothing imported the module. Reintroduce a shared constant file only if a
> second consumer appears.

## Generic message types (Core-owned)

- Scan triggers: `TRIGGER_SCAN_ALL/POSTS/STORIES/HIGHLIGHTS/AVATAR/GALLERIES/VIDEOS`.
- Page state: `GET_PAGE_STATE`, `GET_PAGE_CONTEXT`.
- Download: `START_DOWNLOAD`, `DOWNLOAD_PROGRESS_UPDATE`, `GET_DOWNLOAD_STATUS`,
  `GET_DOWNLOAD_STATE`, `CANCEL_DOWNLOAD`.
- Offscreen ZIP: `OFFSCREEN_BEGIN_ZIP`, `OFFSCREEN_BEGIN_ENTRY`,
  `OFFSCREEN_WRITE_CHUNK`, `OFFSCREEN_END_ENTRY`, `OFFSCREEN_ABORT_ENTRY`,
  `OFFSCREEN_FINISH_ZIP`, `OFFSCREEN_ABORT_ZIP`, `OFFSCREEN_CREATE_BLOB_URL`,
  `OFFSCREEN_REVOKE_BLOB_URLS`, `ZIP_OFFSCREEN_PROGRESS`.
- Info: `GET_PLUGIN_INFO`.

## Platform message types (plugin-owned)

Reddit-specific types live in `src/plugins/reddit/RedditMessages.js`
(`REDDIT_SCAN`, `RESOLVE_REDGIFS`, `TRIGGER_SCAN_REDGIFS`) so that the service
worker does not need to know Reddit internals (SPEC §54, AGENTS §27).

## Service worker routing

`src/background/background.js` handles the generic message types directly and
**delegates unknown types to the plugins** through `plugin.handleMessage(type,
message)` via the registry. A plugin returns `{ handled: true, response }` when
it owns a type; otherwise the registry tries the next plugin. This keeps the
service worker an orchestrator, not a platform router (AGENTS §22, SPEC §12).

## Robustness

Handlers must tolerate late, duplicated, or stale messages: validate the
message type, expected state, and job identity before mutating anything
(SPEC §55, AGENTS §140/§141).
