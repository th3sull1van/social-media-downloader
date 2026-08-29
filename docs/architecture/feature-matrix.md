# Platform Capability Matrix

Capabilities are declared by each plugin (`getCapabilities()`) and consumed by
Core and the UI to decide which generic controls appear (SPEC §31, §58, §136).
This matrix describes *capabilities*, not implementation.

| Capability | Instagram | Facebook | Reddit |
|---|---:|---:|---:|
| Profile scan | ✓ | ✓ | ✓ |
| Post scan | ✓ | — | ✓ |
| Gallery / carousel | ✓ | ✓ | ✓ |
| Stories | ✓ | — | — |
| Highlights | ✓ | — | — |
| HD profile picture (avatar) | ✓ | — | — |
| Albums / collections | — | ✓ | — |
| Subreddit / feed scan | — | — | ✓ |
| Audio media | — | — | ✓ |
| DASH video | — | — | ✓ |
| RedGifs | — | — | ✓ |
| Muxing | — | — | ✓ |
| Duplicate handling (cross-post dedup) | — | — | ✓ |
| Pagination | ✓ | ✓ | ✓ |
| Resolution: direct | ✓ | ✓ | ✓ |
| Resolution: custom | ✓ | ✓ | ✓ |
| Resolution: background | — | — | ✓ |
| Download: generated | — | — | ✓ |
| Download: chunked | — | — | ✓ |
| Runtime: main world | ✓ | ✓ | — |
| Runtime: content script | ✓ | ✓ | ✓ |
| ZIP | Core | Core | Core |
| Queue | Core | Core | Core |
| Progress | Core | Core | Core |
| Cancellation | Core | Core | Core |

Source of truth: `getCapabilities()` in each plugin
(`src/plugins/{instagram,facebook,reddit}/*Plugin.js`).
