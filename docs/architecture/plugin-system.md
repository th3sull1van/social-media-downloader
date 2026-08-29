# Social Media Downloader — Plugin System & Adding New Platforms

## How to Implement a New Platform Plugin

To add support for a new social media platform (e.g. Pinterest, Bluesky, TikTok):

1. **Create the plugin folder under `src/plugins/<platform>/`**:
   - `PlatformDetector.js`: URL matching and target detection.
   - `PlatformNormalizer.js`: Normalizes platform items into canonical `MediaItem`s.
   - `PlatformNaming.js`: Generates safe folder and archive paths.
   - `PlatformPlugin.js`: Implements the `PlatformPlugin` contract.

2. **Register the plugin in `src/background/background.js`**:
   ```javascript
   import { NewPlatformPlugin } from '../plugins/newplatform/NewPlatformPlugin.js';
   defaultRegistry.register(NewPlatformPlugin);
   ```

3. **Declare permissions in `manifest.json`**:
   - Add host permissions (e.g. `*://*.newplatform.com/*`).
   - Add matches to `content_scripts`.

4. **Add Translations**:
   - Add any platform-specific UI strings to `_locales/`.

5. **Run Validation & Tests**:
   ```bash
   bun run test
   ```
