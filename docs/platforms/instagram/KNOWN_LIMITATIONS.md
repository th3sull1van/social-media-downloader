# Instagram Plugin — Known Limitations

1. **Private Profiles**: Media from private profiles can only be downloaded if the currently logged-in browser session is an approved follower.
2. **Expired Stories**: Stories older than 24 hours cannot be retrieved unless they have been pinned to a profile Highlight.
3. **GraphQL Rate Limits**: Rapid pagination across thousands of posts may trigger temporary Meta HTTP 429 throttling.
4. **Profile lookup fallback**: If REST `web_profile_info` lookup is unavailable
   (e.g. HTTP 429), inline `<script>` inspection (`profile_id`, `page_id`,
   `props.id`) resolves numeric user IDs even on zero-post profiles before falling
   back to the first GraphQL feed page. Only profiles with neither REST data,
   inline script IDs, nor feed posts can fail ID discovery.
