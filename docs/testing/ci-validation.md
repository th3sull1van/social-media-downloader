# CI validation

CI runs `bun install --frozen-lockfile` followed by `bun run validate`.

The CI gate intentionally requires at least one sanitized, versioned HAR under `tests/fixtures/har/`. Private captures in `fixtures-private/` are ignored by Git and are evidence for local development only. They cannot be used to make CI appear covered.

## Required CI checks

- sanitized HAR fixture discovery and validation;
- TypeScript check;
- complete test runner;
- manifest integrity;
- architectural dependency rules;
- locale parity;
- replay suites included by `tests/run-tests.js` when their fixtures are present.

## Local validation

When private captures are available locally:

```bash
bun run validate:local
bun run har:report
```

`validate:local` includes private fixture inventory but marks those captures as private and does not claim they are safe to publish. `har:report` writes `.artifacts/har-report.json`, which is ignored by Git.

When CI reports that no public fixture exists, add a real sanitized HAR under `tests/fixtures/har/<platform>/` and update `docs/testing/har-validation-matrix.md`. The current repository includes one sanitized fixture for each platform. Do not copy a private capture unchanged and do not replace the HAR with a synthetic JSON object.

## What HAR replay does not prove

HAR replay validates captured parser and normalization behavior. It does not prove Chrome extension loading, CSP, popup rendering, service-worker lifecycle, real downloads, or host-page CSS isolation. Browser smoke coverage must remain a separate opt-in layer until a supported browser runner is added.
