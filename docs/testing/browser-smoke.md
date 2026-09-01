# Browser smoke validation

Deterministic fixture and HAR replay cannot validate Chrome lifecycle or rendering. When a change crosses these boundaries, perform an opt-in browser smoke run in a disposable test profile.

Minimum checks:

- Manifest V3 loads without errors.
- The popup opens.
- The content script loads on the target page.
- Platform and target detection work.
- The expected message reaches the service worker.
- The offscreen document opens when packaging is requested.
- A small test download completes without exposing private data.

Do not use a live account as a replacement for deterministic fixture/replay validation. Record browser version, extension revision, target scenario, and result in the pull request. A browser runner is not currently installed in this repository, so this checklist is manual and opt-in rather than part of `bun run validate`.
