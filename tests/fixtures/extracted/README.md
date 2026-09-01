# Compact extracted fixtures

These fixtures are deterministic, sanitized projections of local captures. The
normal test suite reads these files directly; it does not need `fixtures-private/`
or a multi-megabyte HAR in order to exercise platform parsers and scanners.

The source workflow is:

```text
local HAR under fixtures-private/
        ↓
bun run fixtures:extract
        ↓
allowlisted projection + deterministic pseudonymization
        ↓
fail-closed fixture validation
        ↓
tests/fixtures/extracted/
```

The generated files contain no cookies, authorization headers, tokens, private
URLs, free-form account text, or private media. IDs, names, URLs and signatures
are synthetic while counts, ordering, dimensions, response categories and
platform-specific shape are retained.

Run the safety check with:

```bash
bun run check:fixtures
```

Raw HAR replay remains available through `bun run test:raw` and is required for
changes that affect real platform/network behavior. It is evidence for the
capture, not a dependency of routine tests or CI.
