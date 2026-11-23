# Cloudflare connection test

This is a prepared, read-only deployment for the personal ChatGPT Overleaf integration.
It verifies authenticated HTTP, the legacy Socket.IO connection, and reading a disposable
project's root document from Cloudflare. It does not yet offer an MCP endpoint or document editing.
The live Overleaf connection must pass before the editing adapter is built out.

The implementation uses a Worker and a SQLite Durable Object, both available on Workers Free.
There is no container, model API, or local server that must stay running. A temporary hosted
browser is used only for sign-in, then closed; normal document access uses the saved session.
Overleaf's existing protocol engine is reused. The socket closes after each test.

## Deploy this checkpoint

Use `fanurs/overleaf-web-mcp`, branch `release/1.3.0-cloudflare`. The GitHub branch contains
the connection test; creating the fork alone does not deploy it. Follow the four steps below.
Cloudflare account setup and the Overleaf sign-in are completed by the owner. No password,
API key, or session file needs to be sent to the assistant or put in GitHub.

The setup reuses the account and Google identity provider already used by PDF Reader.
Keep Workers and Zero Trust on their existing Free plans. The deploy uses a SQLite Durable
Object and a Browser Run binding on Workers Free, with no Containers, R2 bucket, or paid plan.

### Free-only billing requirement

Workers Free and Zero Trust Free are required, not merely preferred. Verify the account's
current plans before the first deployment and whenever account billing changes. This account
was checked on 2026-11-23: Workers Free ($0) and Zero Trust Free ($0/month).

On Workers Free, excess Worker requests and Durable Object operations fail at their free
limits; they do not switch to paid overages. Build minutes also have a fixed Free allowance.
These account-level limits are shared with the account's other projects. Reaching them may
make the service unavailable until the limits reset. This is the intended behavior.

Do not upgrade the account to fix a failed build, CPU limit, or quota error. Do not enable
paid services or add usage-billed dependencies. The code deploys a Worker, a SQLite
Durable Object, and a Browser Run binding on the Free plan. It has no billing-subscription setup step. A later account-wide upgrade would
change the billing behavior for this project too; the application cannot prevent an account
administrator from changing the subscription. Paid-plan spending alerts or caps are not a
replacement for staying on Free.

Cloudflare's enforcement is documented at
<https://developers.cloudflare.com/workers/platform/limits/#daily-requests>,
<https://developers.cloudflare.com/durable-objects/platform/pricing/>, and
<https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/>.

### 1. Set up Access

Open <https://one.dash.cloudflare.com/> and select your existing account.
Go to **Access controls > Applications > Create new application > Self-hosted and private**,
then **Add public hostname**. Some dashboard versions label these **Add an application** and
**Self-hosted**.

- Name the application `Overleaf MCP - private access`.
- Use hostname `overleaf-mcp.fanurs.com`, covering every path.
- Create a separate **Allow** policy named `Overleaf MCP - owner only`, containing your exact
  email addresses. The current policy allows `fanurs.tce@gmail.com` and `cteh@andrew.cmu.edu`.
  Do not share a policy with an unrelated project.
- Reuse the existing Google identity provider used by PDF Reader.
- Save, then copy the new application's **Application Audience (AUD) Tag**.

Keep this application separate from PDF Reader. Its audience must be the new application's
value. No new Google client key is expected when reusing the existing provider.

### 2. Create the Worker from GitHub

Open <https://dash.cloudflare.com/> and select the account containing `fanurs.com`.
Go to **Workers & Pages > Create application > GitHub** and choose
`fanurs/overleaf-web-mcp`. If the repository is missing, grant the Cloudflare GitHub app access
to that fork and return to the list.

A public fork can appear in the list even without the app permission needed for automatic
deployments. If the Worker says the Git account is disconnected, use **Settings > Builds >
Manage** and add only this fork to the existing Cloudflare GitHub app's selected repositories.
Review its repository permissions before saving. Existing repository selections stay unchanged.

Use these settings after the code is pushed:

| Setting | Value |
| --- | --- |
| Worker name | `overleaf-mcp` |
| Production branch | `release/1.3.0-cloudflare` |
| Root directory | Repository root, not `cloudflare/` |
| Build command | `npm run check:cloudflare && npm run test:cloudflare` |
| Deploy command | `npm run deploy:cloudflare` |
| Build variable | `NODE_VERSION=24` |
| Preview builds | Disabled |
| API token | Create a separate build token named `overleaf-mcp-deploy` |

Cloudflare's automatic token can edit Workers, KV/R2 storage, and Worker routes across the
account. Review that permission before creating it. The token is stored by Cloudflare; do not
reuse another application's token just because the form selects it by default.

If the creation form offers **Production branch**, select the branch above before deploying.
The current dashboard may instead start the first build from the repository's default branch.
In that case, cancel that initial build, then open **Settings > Builds**, set **Production
branch** to `release/1.3.0-cloudflare`, and save. A new commit pushed to that branch starts the
correct build. **Retry build** on the canceled `main` build repeats `main`, even after changing
the production branch, so do not use that retry to switch branches.

The successful branch build provisions the SQLite Durable Object and custom domain.
The Worker initially returns `SETUP_REQUIRED` until its runtime settings are filled in.
There is no need to copy Cloudflare's build token into chat or into GitHub secrets.

### 3. Add runtime settings

In the Worker, open **Settings > Variables and Secrets**. These are runtime settings, not build settings.

| Name | Type | Value |
| --- | --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | Text | The existing team domain ending in `.cloudflareaccess.com`, as used by PDF Reader |
| `CF_ACCESS_AUD` | Text | The new Overleaf Access application's audience tag |
| `SESSION_ENCRYPTION_KEY` | Secret | A new 64-character hexadecimal value generated on your own computer |

To generate the secret on a computer with Node.js, run this command, then paste its output only
into Cloudflare's secret field:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Save/deploy the runtime settings. Open <https://overleaf-mcp.fanurs.com/connect> and sign in.
This address will work only after deployment and domain setup. `workers.dev` and preview URLs
are disabled so there is no alternate unprotected address.

### 4. Sign into Overleaf in your browser

Open <https://overleaf-mcp.fanurs.com/connect> and sign into the private setup page with an
allowed account. This only protects our service; it does not sign the service into Overleaf.
Use the same setup-page identity each time, because each identity has separate session storage.

1. Paste the selected Overleaf project's URL. The probe reads its root document without edits.
2. Click **Sign in to Overleaf**, then **Open Overleaf sign-in window** within one minute.
3. In Cloudflare's Live View, sign into Overleaf normally, including institutional or Google
   login if needed. Credentials are entered on those sites inside a temporary cloud browser.
4. Return to the setup page and click **I've signed in - finish connecting**. The service saves
   only Overleaf cookies, encrypted, and closes the entire temporary browser.
5. Click **Test connection**. Success returns `authenticated`, `projectJoined`, and
   `documentRead` as true, a character count, and a protocol name. No document text is returned.

No local program, extension, terminal command, or uploaded session file is required by this
flow. The optional advanced upload fallback remains for users who already have an exported
session. A session is an account login, not an Overleaf-issued project-scoped permission;
this probe restricts its read to the selected project. A future MCP adapter must enforce its
project allowlist separately. If the saved session expires, repeat this browser sign-in flow.
**Remove saved session** deletes the active stored credentials and cancels any pending login.
Revoking the login at Overleaf is a separate action.

#### Free limits and cleanup

Browser Run is used only during interactive sign-in. It is not used for each document read.
Workers Free permits ten browser minutes per day across the account and rejects further
attempts with HTTP 429. This service also limits each verified identity to two launches per
UTC day, including failed launches. A login has a four-minute absolute deadline enforced by a
Durable Object alarm, plus a one-minute provider inactivity timeout. Refreshing a Live View
link does not extend the deadline or launch another browser. Cancellation, completion, and
expiry close the browser. Cleanup failures keep the encrypted browser ID for an alarm retry.
Cloudflare Free is the billing guard; these application limits are additional usage controls.

The Live View URL temporarily grants control of the login browser. Deliver it only through the
owner-authenticated setup response and never log it, commit it, or paste it into chat. URLs are
restricted to HTTPS `live.browser.run/ui/`, expire for new connections after one minute, and
become unusable when the browser closes. Session recording is not requested. The service
never stores identity-provider cookies, passwords, page HTML, or screenshots.

#### Verified checkpoint and remaining uncertainty

On November 23, 2026, a short dashboard-created Browser Run session reached the normal
Overleaf login page with recording off. The session was explicitly closed and the dashboard
confirmed no active sessions. That proves the login page is reachable, not that a particular
university/Google login or the later authenticated protocol probe succeeds. Those still need
the owner to sign in. Do not bypass a provider security refusal or solve it by upgrading plans.

The `BROWSER` binding is deployed from `wrangler.jsonc`; it requires no separately stored
Cloudflare API token. The code uses the official `@cloudflare/puppeteer` package, pinned to
2.0.1. No new Overleaf API routes are introduced: the flow navigates the ordinary login page
and uses the existing upstream authenticated-project-page signal.

References for this flow:
<https://developers.cloudflare.com/browser-run/features/live-view/>,
<https://developers.cloudflare.com/browser-run/features/human-in-the-loop/>,
<https://developers.cloudflare.com/browser-run/puppeteer/>, and
<https://developers.cloudflare.com/browser-run/limits/>.

## Later ChatGPT connection

Do not add this probe to ChatGPT yet. After the live read succeeds, the next implementation adds
the remote MCP tools, revision-checked edits, and compilation. Then enable Access Managed OAuth,
configure the ChatGPT callback, and connect `https://overleaf-mcp.fanurs.com/mcp` in ChatGPT.
The assistant will provide those exact steps when the MCP endpoint exists.

## Developer checks

```bash
npm ci
npm run check
npm run check:cloudflare
npm run lint
npm run format:check
npm test
npm run build
npm run build:cloudflare
npm run test:cloudflare:runtime
```

`build:cloudflare` is a dry run and does not publish. Automated tests exercise signed Access
assertions, origin checks, encrypted storage, session recovery and removal, cookie scope,
and WebSocket lifecycle behavior with synthetic fixtures. The runtime check starts the built
Worker and SQLite Durable Object in local workerd and verifies the actual request routing,
signed assertions, account isolation, session storage, and removal. Its only allowed external
request is a mocked signing-key response; it never contacts Overleaf or Cloudflare.

These checks do not establish that Overleaf
accepts a session from a Cloudflare IP address or that production CPU limits are met.
Check real Cloudflare request/CPU/duration usage during the live test before enabling edits.

The preparation baseline is upstream commit `f611b307bcc133479b5d532d091dbdb863a4c20d` (1.2.0).
Future implementation tasks belong in the fork's GitHub issues once **Settings > Features >
Issues** is enabled. Until then, the draft pull request records the design and acceptance checks.
Nothing here publishes a package to npm or changes the upstream repository.

## References

- <https://developers.cloudflare.com/workers/ci-cd/builds/>
- <https://developers.cloudflare.com/workers/ci-cd/builds/configuration/>
- <https://developers.cloudflare.com/workers/examples/websockets/>
- <https://developers.cloudflare.com/durable-objects/platform/pricing/>
- <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/>
