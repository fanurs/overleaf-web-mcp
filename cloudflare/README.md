# Cloudflare connection test

This is Fanurs' private Cloudflare adapter for ChatGPT. The authenticated endpoint is
`https://overleaf-mcp.fanurs.com/mcp`, using Streamable HTTP behind Cloudflare Access.
The setup page is `https://overleaf-mcp.fanurs.com/connect`. A server deployment alone does
not connect ChatGPT. Managed OAuth and the ChatGPT plugin connection must also be completed.

It exposes `connection_status`, `list_projects`, `get_project_tree`, `read_file`, `write_file`,
`create_file`, `get_full_document`, `get_sections`, `get_section_content`, `write_section`,
`compile_project`, and `get_compile_log`. Only the project selected by the saved setup session
is allowed. The existing service/domain engine handles revisions, tracked edits, conflict
checks and read-back verification. The remote adapter exposes no account-management, deletion,
upload or server-disk tool. Writes accept text or exact-match edits, never `localPath`.
Documents are limited to 200,000 characters, updates to 10,000 characters, request bodies to
256 KiB and compile requests to 30 seconds (20 seconds by default). Large includes or outputs
may hit runtime/provider limits; no paid fallback is used.

A Worker and SQLite Durable Object run on Workers Free. There is no container, model API,
or local server that must stay running. The helper transfers an existing login without
Browser Run time. Document operations use that saved session directly and close every socket
at the end of each call. Metadata/discovery calls do not contact Overleaf. Calls are serialized
per verified Access identity, including completion of the legacy response stream, so unlink
cannot be overwritten by a still-running cookie refresh.

Before editing is enabled, click **Run disposable editing test**. It creates a separate project,
reads and edits its stub, refuses an old revision, compiles once, then trashes the test project.
The connected manuscript is outside that test runtime's allowlist. The result and progress are
saved privately, without document content. An interrupted/ambiguous creation is not automatically
repeated. Review the reported project before retrying a test that did not confirm cleanup.
Trash can be emptied by the owner later; the test never permanently deletes anything.

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

| Setting           | Value                                                     |
| ----------------- | --------------------------------------------------------- |
| Worker name       | `overleaf-mcp`                                            |
| Production branch | `release/1.3.0-cloudflare`                                |
| Root directory    | Repository root, not `cloudflare/`                        |
| Build command     | `npm run check:cloudflare && npm run test:cloudflare`     |
| Deploy command    | `npm run deploy:cloudflare`                               |
| Build variable    | `NODE_VERSION=24`                                         |
| Preview builds    | Disabled                                                  |
| API token         | Create a separate build token named `overleaf-mcp-deploy` |

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

| Name                     | Type   | Value                                                                             |
| ------------------------ | ------ | --------------------------------------------------------------------------------- |
| `CF_ACCESS_TEAM_DOMAIN`  | Text   | The existing team domain ending in `.cloudflareaccess.com`, as used by PDF Reader |
| `CF_ACCESS_AUD`          | Text   | The new Overleaf Access application's audience tag                                |
| `SESSION_ENCRYPTION_KEY` | Secret | A new 64-character hexadecimal value generated on your own computer               |

To generate the secret on a computer with Node.js, run this command, then paste its output only
into Cloudflare's secret field:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Save/deploy the runtime settings. Open <https://overleaf-mcp.fanurs.com/connect> and sign in.
This address will work only after deployment and domain setup. `workers.dev` and preview URLs
are disabled so there is no alternate unprotected address.

### 4. Connect an existing login without a timer

Open https://overleaf-mcp.fanurs.com/connect and sign into the private setup page with an
allowed account. This protects our service; it does not sign the service into Overleaf.
Use the same setup-page identity each time, because each identity has separate session storage.

1. Download the browser helper ZIP from the setup page and extract it. In Edge open
   `edge://extensions`, or in Chrome `chrome://extensions`. Enable **Developer mode**, choose
   **Load unpacked**, and select the extracted folder containing `manifest.json`.
2. Keep the signed-in setup tab open. In the same browser window, open your signed-in Overleaf
   project. Open **Overleaf connection helper - Fanurs** from the browser Extensions menu.
3. Check the project URL, then click **Connect this Overleaf session**. Keep the popup open
   until **Session saved** appears. Return to setup and click **Test connection**.

The helper only acts on an explicit click. It reads Overleaf cookies and transfers them directly
through the authenticated setup tab to the existing `/api/link` route. It adds no CORS exemption,
new secret, cloud service, background process, or paid dependency. The helper has cookie/script
permissions only for `overleaf.com`, `www.overleaf.com`, and `overleaf-mcp.fanurs.com`.
The root-domain permission covers Overleaf domain cookies; no wildcard subdomain permission
is granted. Version 0.1.1 selects the actual project tab's cookie store and reports permission
problems separately from an empty result. It has no Google/university
site permissions, background script, analytics, or local cookie storage. The ZIP is reproducibly
built from `cloudflare/extension/` and served behind Access at `/connect/extension.zip`.
See [extension/README.md](extension/README.md) for the complete permission boundary.

No Cloudflare browser is allocated by this method, so its cloud-browser usage is zero. Saving
cookies is not proof that Overleaf accepts them from Cloudflare; the live read test remains
required. If Overleaf refuses the session, report the error without bypassing the refusal.
The extension can be removed after a successful transfer and reinstalled if renewal is needed.
The owner's computer does not need to stay on for the hosted service after transfer.

A session is an account login, not an Overleaf-issued project-scoped permission. This probe
restricts its read to the selected project; a future MCP adapter must enforce its allowlist.
**Remove saved session** deletes the active stored credentials and cancels any pending login.
Revoking the login at Overleaf is a separate action.

#### Optional hosted sign-in

This remains available under **Alternative - temporary cloud sign-in** on the setup page.

1. Paste the project URL and click **Prepare cloud sign-in (no timer)**. This opens a separate
   preparation page without allocating a browser. The owner can leave it open indefinitely.
2. Only when ready, the owner clicks **Start 60-second sign-in** on that visible, focused page.
   An assistant must never click this button for the owner. The same tab becomes Live View.
   Startup is cancelled if the page loses focus or is hidden before the handoff completes.
3. Sign into Overleaf in the temporary browser. The service detects successful login, saves
   only Overleaf cookies encrypted, and closes the cloud browser. **Finish connecting** and
   **Cancel sign-in** remain available on the setup page along with the time log.
4. Return to setup and click **Test connection**. Success reports `authenticated`,
   `projectJoined`, and `documentRead` as true, a character count, and a protocol name.
   No document text is returned and no document is changed.

The sixty-second deadline includes startup. Once Live View opens, switching away does not
pause Cloudflare usage; the service cannot monitor attention inside that separate site.
No automatic attempt or retry is launched. Preparation pages and refreshes do not start timers.
The server refuses the old launch-request shape so a stale setup page cannot start the old flow.

#### Free limits and cleanup

Browser Run is used only by the optional hosted sign-in, never the helper transfer or normal
reads. Workers Free permits ten browser minutes per day shared across the account. This service
also limits each verified identity to two launches per UTC day, including failed launches.

The Durable Object requests shutdown at 60 seconds from the launch request, including startup.
A handoff that has not completed closes after 20 seconds without repeated login checks. Opened
logins are checked every five seconds, closing immediately after successful detection. The
one-minute provider inactivity timeout remains, but active checks or Live View can keep it alive;
the server deadline is the primary control. Cleanup and close intent persist across restarts.
Failures retry closure, never browser creation. Old four-minute pending records are tightened to
sixty seconds while preserving their original start time for the log.

Network/provider calls and alarm delivery can delay confirmed shutdown beyond the deadline.
The UI and logs do not claim a guaranteed exactly sixty-second billing maximum. The account's
Free plan is the billing guard; the application limits reduce usage. Do not upgrade to resolve
quota errors. The user is never asked to watch an allocated browser while waiting for an agent.

The Live View URL grants temporary control and is only delivered to the authenticated owner.
It is never logged, committed, or pasted into chat. URLs are restricted to HTTPS
`live.browser.run/ui/`, expire for new connections after one minute, and become unusable when
the browser closes. Session recording is not requested. The service does not store passwords,
identity-provider cookies, page HTML, or screenshots.

#### Per-attempt time log

The setup page shows a running elapsed-time estimate during login and a time/result record
for every attempt started with this version, including cancelled, expired, unopened, and failed
attempts. Provider-reported `endTime - startTime` is used when Cloudflare session history is
available at closure. Otherwise a clearly labeled estimate spans the start request through
confirmed closure. A rejected launch is marked `unavailable`, with request elapsed time but
no invented zero browser usage. These are operational measurements, not invoice guarantees.

The most recent 20 records are displayed. **Download complete time log (JSON)** exports every
record via the authenticated `/api/login/history` endpoint. Records are retained in encrypted
monthly batches in the existing owner-isolated Durable Object; no paid logging service or
recording is enabled. They contain timestamps, durations, an unrelated random record ID, and
outcome only. No browser-session ID, control URL, credentials, or document content is logged.
Removing an Overleaf session does not erase this usage history. Earlier attempts cannot be
reconstructed and are explicitly excluded. Different setup identities have separate logs;
Cloudflare's ten-minute allowance remains shared across the full Cloudflare account.

#### Verified connection and editing checkpoint

On November 23, 2026, a short dashboard-created Browser Run session reached the normal
Overleaf login page with recording off. The session was explicitly closed and the dashboard
confirmed no active sessions. The owner subsequently transferred an existing session with
helper 0.1.1. The live read test authenticated, joined the selected project, and read an
editable document through ShareJS without requiring a configured compile root. The
proposal was not modified.

The deployed remote adapter then passed a disposable editing test on November 23, 2026.
It created a temporary project, read its document, applied and verified a revision-checked
write, refused a stale revision, compiled successfully, and moved the project to Trash.
The recorded workflow took 2.38 seconds and used **0 Browser Run seconds**. This verifies
the live Overleaf engine through the setup service, not the separate ChatGPT OAuth path.
Do not bypass a provider security refusal or solve it by upgrading plans.

The `BROWSER` binding is deployed from `wrangler.jsonc`; it requires no separately stored
Cloudflare API token. The code uses the official `@cloudflare/puppeteer` package, pinned to
2.0.1. No new Overleaf API routes are introduced: the flow navigates the ordinary login page
and uses the existing upstream authenticated-project-page signal.

References for this flow:
<https://developers.cloudflare.com/browser-run/features/live-view/>,
<https://developers.cloudflare.com/browser-run/features/human-in-the-loop/>,
<https://developers.cloudflare.com/browser-run/puppeteer/>, and
<https://developers.cloudflare.com/browser-run/limits/>.

## ChatGPT connection

After the disposable editing test passes, configure **Managed OAuth** on the existing
Overleaf Access application, under **Additional settings** (called Advanced settings in
Cloudflare's documentation). Preserve the owner-only policy,
application audience and domains. Restrict registered redirect URIs to ChatGPT's OAuth
callback paths during setup, then the actual callback shown by the web connection; do not
allow arbitrary localhost, loopback or unrelated clients. Use the same
setup identity for OAuth so the verified subject maps to the existing saved session.

Cloudflare handles OAuth discovery, authorization, refresh and the exchange to the origin's
`Cf-Access-Jwt-Assertion`; the Worker independently validates its signature, issuer, audience
and expiration before routing to the identity's Durable Object. No custom OAuth secret store
or bearer-token bypass is added. Keep the deployed application's domain route protected and
its workers.dev/previews disabled.

Connect `https://overleaf-mcp.fanurs.com/mcp` to ChatGPT with OAuth. Verify `connection_status`
and a read before claiming the plugin works. The setup and real editing test are separate
from the ChatGPT authorization and tool-discovery checks. Repeat the helper transfer only
when Overleaf expires or revokes its session; no hosted browser is needed for normal use.

The private personal package was created at version 0.2.0 from
`plugin/overleaf-private/` on November 23, 2026. Its listing subsequently offered
"Open in desktop app". Saving a package containing a remote MCP configuration does not
establish the separate ChatGPT web connection. Use the web registration flow below;
the package listing is not evidence that ChatGPT can discover or call its tools.

On November 25, 2026, the owner approved Managed OAuth and the settings were saved and
read back from the existing Access application:

- Managed OAuth enabled, with localhost and loopback clients disabled.
- Allowed redirects during registration are
  `https://chatgpt.com/connector_platform_oauth_redirect` and
  `https://chatgpt.com/connector/oauth/*`. Once ChatGPT shows its exact redirect URI,
  narrow this list to that URI. The wildcard covers only the ChatGPT callback path,
  not arbitrary origins or other paths on ChatGPT.
- Access token lifetime is 15 minutes; refresh grant lifetime is one week. These are
  authorization lifetimes, not limits on paper-writing time or hosted browser usage.
- The existing owner-only email policy, Google identity provider, application audience,
  domain, and 24-hour browser session duration were preserved. Workers Free was verified
  again. No paid service or billing change was introduced.

Public read-only checks verified both resource metadata and authorization-server discovery,
including DCR and PKCE S256. An unauthenticated MCP initialization using curl returned
401 with the expected `WWW-Authenticate` resource-metadata URL. The generic Python
urllib client received Cloudflare error 1010 for its browser signature; this is a separate
edge restriction, and does not establish whether the actual ChatGPT client is allowed.
Do not disable global security protections to hide that distinction. ChatGPT's own
authorization, tool discovery, and a real tool read remain unverified.

### Register in ChatGPT web

1. Open <https://chatgpt.com/plugins> and choose **Add > Add custom MCP server**.
2. Name it **Overleaf Web** to distinguish it from the existing package listing. Set
   **Server URL** to `https://overleaf-mcp.fanurs.com/mcp` and **Authentication** to OAuth.
3. Leave client ID and client secret empty. If a registration method is requested, choose
   **Dynamic Client Registration (DCR)**. The server advertises DCR, not CIMD.
4. Review the risk notice and choose **Create as a plugin**. Complete sign-in using the
   same Google/Access identity that owns the saved setup session. This can differ from
   the email used for Overleaf itself.
5. Install/connect the resulting web plugin. Copy its exact OAuth redirect URI into the
   Access allowlist, replacing the registration-time callback patterns.
6. Invoke `connection_status` and read the linked project through ChatGPT. Only then
   claim that the web connection works. Keep proposal edits out of connection testing.

This registration and OAuth flow starts no hosted Overleaf browser. The setup work and
public authorization checks on November 25 used **0 Browser Run seconds**.

Managed OAuth reference:
<https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/>.

ChatGPT web connection and callback references:
<https://developers.openai.com/plugins/deploy/connect-chatgpt> and
<https://developers.openai.com/plugins/build/auth>.

## Developer checks

```bash
npm ci
npm run build:extension
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
