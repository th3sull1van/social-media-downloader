# Sanitized HAR fixtures

This directory is reserved for minimal, real HAR captures that have been sanitized and approved for version control.

Required layout:

```text
tests/fixtures/har/
├── instagram/
├── facebook/
└── reddit/
```

A fixture must retain the response shape required by the real production replay path. Synthetic JSON is not a HAR substitute.

Before adding a fixture:

```bash
bun tools/validation/har-check.js --report=.artifacts/har-report.json
```

The fixture must contain no cookies, authorization headers, session identifiers, tokens, private URLs, PII or private media. Keep private captures under `fixtures-private/`, which is ignored by Git.

CI requires at least one sanitized fixture. The platform matrix at `docs/testing/har-validation-matrix.md` must be updated with its scenario and coverage.
