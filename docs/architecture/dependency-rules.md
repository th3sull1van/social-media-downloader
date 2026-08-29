# Social Media Downloader — Architectural Dependency Rules

## Invariants

1. **Core MUST NOT import Platform Implementations**:
   - `src/core/` cannot import `src/plugins/instagram/`, `src/plugins/facebook/`, `src/plugins/reddit/`, or `src/plugins/meta-shared/`.
   - Core interacts with plugins only through the `PlatformPlugin` contract and `PluginRegistry`.

2. **Platform Plugins MUST NOT import each other**:
   - `instagram` cannot import `facebook` or `reddit`.
   - `facebook` cannot import `instagram` or `reddit`.
   - `reddit` cannot import `instagram` or `facebook`.

3. **Meta Shared is only for Instagram and Facebook**:
   - `src/plugins/meta-shared/` may be imported by `src/plugins/instagram/` and `src/plugins/facebook/`.
   - `reddit` and `core` must never import `meta-shared`.

4. **Automated Enforcement**:
   - Run `bun run check:dependencies` to verify all imports across the codebase.
