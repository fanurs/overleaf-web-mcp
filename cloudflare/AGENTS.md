# Cloudflare deployment constraints

The owner requires zero Cloudflare usage charges for this integration.

- Keep the account on Workers Free and Zero Trust Free. Confirm the current plans before
  first deployment and whenever billing changes. Both were verified as Free on 2026-11-23.
- Never upgrade a plan or enable a paid service to resolve a build or runtime failure.
- Use the existing Worker and SQLite-backed Durable Object. The owner retired hosted
  cloud-browser login on 2026-11-25. Do not add a Browser Run binding, launch code, timers,
  or a hosted login fallback. Connect with the explicit local browser helper transfer.
- Preserve the existing encrypted duration/outcome history and authenticated JSON export.
  Distinguish provider-reported duration, estimates, and unavailable measurements. Never log
  credentials, control URLs, browser IDs, or document content. No new timed sessions are created.
- Do not introduce Containers, R2, AI services, paid plans, or paid fallbacks.
- Free-tier quota exhaustion must stop work with an error. Do not bypass the limit using a
  paid fallback. Account limits are shared with the owner's other projects.
- Explain that an account administrator's later upgrade changes the billing terms. Do not
  claim the application can guarantee a zero invoice after such a change. A spending alert
  or paid-plan cap is not equivalent to the Free plan's hard limits.
- Keep the Overleaf Access application and its owner-only policy separate from other projects.
- Keep source, deployment configuration, setup instructions, and material changes in this fork.
  Do not commit tokens, encryption keys, Overleaf session files, or document contents.
- Actual ChatGPT status, project listing, tree and file read calls passed on 2026-11-25.
  Editing passed on a disposable project. Do not use the real proposal for write tests.

- The optional local browser helper may transfer only Overleaf cookies to this exact private
  setup service, on the owner's explicit click. Keep its two-site permissions, authenticated
  same-origin upload, no-background behavior, and no-cookie-output boundary. Do not operate
  cookie-export APIs through the assistant's browser tools or install the helper for the owner.
  Package only the reviewed source allowlist, never a browser profile or credentials.
