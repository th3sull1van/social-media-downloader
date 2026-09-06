# Instagram Plugin — Known Limitations

1. **Private Profiles**: Media from private profiles can only be downloaded if the currently logged-in browser session is an approved follower.
2. **Expired Stories**: Stories older than 24 hours cannot be retrieved unless they have been pinned to a profile Highlight.
3. **GraphQL Rate Limits**: Rapid pagination across thousands of posts may trigger temporary Meta HTTP 429 throttling.
4. **Profile lookup fallback**: If REST profile lookup is unavailable, recovering
   the target ID from GraphQL requires a matching author in the first feed page.
   Profiles without such a post can still fail highlight discovery.
