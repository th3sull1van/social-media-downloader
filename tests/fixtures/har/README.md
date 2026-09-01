# Sanitized HAR source fixtures

This directory is reserved for minimal, real HAR captures that have been
sanitized and approved for version control. They are source/network evidence;
routine tests use the extracted fixtures under `tests/fixtures/extracted/`.

Required layout:

```text
tests/fixtures/har/
├── instagram/
├── facebook/
└── reddit/
```

A HAR fixture must retain the response shape required by the real production
replay path. Synthetic JSON is not a HAR substitute. The compact extracted
fixture is a separate, allowlisted test input and is validated with
`bun run check:fixtures`.

Before adding a fixture:

```bash
bun tools/validation/har-check.js --report=.artifacts/har-report.json
```

To regenerate compact fixtures from local raw captures:

```bash
bun run fixtures:extract
bun run check:fixtures
```

The fixture must contain no cookies, authorization headers, session identifiers, tokens, private URLs, PII or private media. Keep private captures under `fixtures-private/`, which is ignored by Git.

CI validates the compact fixture set and the public HAR inventory. The platform
matrix at `docs/testing/har-validation-matrix.md` must be updated with new
scenarios and coverage. Raw captures belong under `fixtures-private/`, which is
ignored by Git and is used only by `bun run validate:raw`.
