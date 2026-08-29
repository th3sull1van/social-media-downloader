# HAR baselines

Baselines are sanitized, reviewable summaries of the versioned HAR fixtures. Update them explicitly and review the diff. Never update a baseline automatically in CI.

Use:

```bash
bun run har:report
bun run har:compare -- --report=.artifacts/har-report.json --baseline=tests/fixtures/har/expected/baseline.json
```

A baseline change must state why the observed fixture inventory changed.