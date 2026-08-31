# Social Media Downloader — Execution Contexts

Browser extensions under Manifest V3 operate across distinct execution environments with specific privileges and constraints:

| Context | Can Access DOM? | Extension APIs? | Lifetime | Primary Responsibility |
| :--- | :--- | :--- | :--- | :--- |
| **Popup UI** | Own document | Full | User interactive | Preview grid, selection, filter tabs, scan triggers, progress |
| **Content Script** | Isolated Page DOM | Runtime / Storage / Messaging | Page lifetime | In-page UI, Instagram DOM/GraphQL scanning, Facebook photo-tab navigation scans, Reddit scan requests (via SW) |
| **Service Worker** | No | Full (`downloads`, `offscreen`, etc.) | Event-driven / Background | Orchestration, download management (direct + muxed blobs), Reddit JSON API scans, filename routing |
| **Offscreen Document** | Dedicated document | Limited (`runtime.sendMessage`) | Background on-demand | OPFS-backed, chunked ZIP packaging in `STORE` mode with 1GB guard ceiling (hand-written engine) |
| **Main World** | Page DOM & JS | None | Page lifetime | Polaris / Comet GraphQL query execution, session token harvest |
