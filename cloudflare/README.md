# Cloudflare connection test

This is a prepared, read-only deployment for the personal ChatGPT Overleaf integration.
It verifies authenticated HTTP, the legacy Socket.IO connection, and reading a disposable
project's root document from Cloudflare. It does not yet offer an MCP endpoint or document editing.
The live Overleaf connection must pass before the editing adapter is built out.

The implementation uses a Worker and a SQLite Durable Object, both available on Workers Free.
There is no container, hosted browser, model API, or local server that must stay running.
Overleaf's existing protocol engine is reused. The socket closes after each test.

## Deploy this checkpoint

Use `fanurs/overleaf-web-mcp`, branch `release/1.3.0-cloudflare`. The GitHub branch contains
the connection test; creating the fork alone does not deploy it. Follow the four steps below.
Cloudflare account setup and the Overleaf sign-in are completed by the owner. No password,
API key, or session file needs to be sent to the assistant or put in GitHub.

The setup reuses the account and Google identity provider already used by PDF Reader.
Keep Workers and Zero Trust on their existing Free plans. The deploy uses a SQLite Durable
Object, with no Containers, Browser Run, R2 bucket, or paid service.

### 1. Set up Access

Open <https://one.dash.cloudflare.com/> and select your existing account.
Go to **Access controls > Applications > Create new application > Self-hosted and private**,
then **Add public hostname**. Some dashboard versions label these **Add an application** and
**Self-hosted**.

- Name the application `Overleaf MCP - private access`.
- Use hostname `overleaf-mcp.fanurs.com`, covering every path.
- Add an **Allow** policy containing your exact email address.
- Reuse the existing Google identity provider used by PDF Reader.
- Save, then copy the new application's **Application Audience (AUD) Tag**.

Keep this application separate from PDF Reader. Its audience must be the new application's
value. No new Google client key is expected when reusing the existing provider.

### 2. Create the Worker from GitHub

Open <https://dash.cloudflare.com/> and select the account containing `fanurs.com`.
Go to **Workers & Pages > Create application > GitHub** and choose
`fanurs/overleaf-web-mcp`. If the repository is missing, grant the Cloudflare GitHub app access
to that fork and return to the list.

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

### 4. Link Overleaf and run the read-only test

Open <https://www.overleaf.com/project>, choose **New Project > Blank Project**, and name it
`MCP connection test`. Keep the starter document and use this disposable project's URL below.

Install Node.js from <https://nodejs.org/en/download> if necessary. A Chrome-family browser is
also needed for the temporary login helper. In a terminal on your own computer, run:

```bash
npx --yes overleaf-web-mcp@1.2.0 login
```

A separate browser window opens. Complete the normal Overleaf sign-in yourself. It closes
after the session is saved. The command's JSON result reports the cookie file path.

On the protected setup page:

1. Select that saved session file. On macOS, **Command+Shift+G** in the file chooser accepts a
   pasted file path; on Windows, paste the path into the file name box.
2. Paste the blank test project's URL.
3. Click **Save session**, then **Test connection**.

The expected result contains `authenticated: true`, `projectJoined: true`, and
`documentRead: true`, plus a character count and protocol name. Copy that small result back
to the assistant. Failure results contain a code and no document text or session credentials.

The file gives access to your Overleaf session. Transfer it only to your protected service.
It is encrypted in Durable Object storage and excluded from diagnostics. The **Remove saved
session** button deletes the active stored session. Signing out/revoking the Overleaf session
is a separate action in Overleaf. No helper needs to stay running after linking.

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
