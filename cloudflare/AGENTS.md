# Cloudflare deployment constraints

The owner requires zero Cloudflare usage charges for this integration.

- Keep the account on Workers Free and Zero Trust Free. Confirm the current plans before
  first deployment and whenever billing changes. Both were verified as Free on 2026-11-23.
- Never upgrade a plan or enable a paid service to resolve a build or runtime failure.
- Use only the existing Worker and SQLite-backed Durable Object. Do not introduce Containers,
  Browser Run, R2, AI services, external paid services, or usage-billed dependencies.
- Free-tier quota exhaustion must stop work with an error. Do not bypass the limit using a
  paid fallback. Account limits are shared with the owner's other projects.
- Explain that an account administrator's later upgrade changes the billing terms. Do not
  claim the application can guarantee a zero invoice after such a change. A spending alert
  or paid-plan cap is not equivalent to the Free plan's hard limits.
- Keep the Overleaf Access application and its owner-only policy separate from other projects.
- Keep source, deployment configuration, setup instructions, and material changes in this fork.
  Do not commit tokens, encryption keys, Overleaf session files, or document contents.
- Until a live Overleaf read and the ChatGPT MCP actions have passed, describe this checkpoint
  as a connection test, not as a working editing plugin.
