# Cloudflare deployment constraints

The owner requires zero Cloudflare usage charges for this integration.

- Keep the account on Workers Free and Zero Trust Free. Confirm the current plans before
  first deployment and whenever billing changes. Both were verified as Free on 2026-11-23.
- Never upgrade a plan or enable a paid service to resolve a build or runtime failure.
- Use the existing Worker and SQLite-backed Durable Object. Browser Run on Workers Free is
  allowed only for the owner-authorized browser-only Overleaf login flow. Use a dedicated
  temporary browser, a four-minute absolute deadline, one-minute idle timeout, and explicit
  closure after completion or cancellation. Never enable session recordings.
- Keep at most two hosted login attempts per verified identity per UTC day. Cloudflare
  separately enforces its shared ten-minute daily Free browser allowance. Do not retry quota
  failures automatically. Do not introduce Containers, R2, AI services, paid plans, or paid fallbacks.
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
