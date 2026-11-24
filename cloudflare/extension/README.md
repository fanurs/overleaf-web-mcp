# Connect an existing Overleaf session without a cloud browser

This small Chrome/Edge extension transfers Overleaf cookies directly to the existing private
service at https://overleaf-mcp.fanurs.com. It starts no Cloudflare browser and needs no local
server. It has no background worker, timers, telemetry, automatic transfer, or local storage.
Transfer happens only after you click **Connect this Overleaf session** in its popup.

This is still an experimental connection test. Saving cookies does not prove Overleaf will
accept them from Cloudflare. The read-only **Test connection** step must succeed before MCP
editing work proceeds. Do not bypass an Overleaf security refusal.

## Install once

1. Download `overleaf-connection-helper.zip` from the private setup page, then extract it.
2. In Edge open `edge://extensions`; in Chrome open `chrome://extensions`. Enable
   **Developer mode**, click **Load unpacked**, and select the extracted folder containing
   `manifest.json`. Browser extension installation must be done by the owner.
3. The requested permissions are cookies and script execution for exactly
   `https://overleaf.com/*`, `https://www.overleaf.com/*`, and
   `https://overleaf-mcp.fanurs.com/*`. The root Overleaf domain is needed to read domain cookies
   shared with www; no other Overleaf subdomain is permitted. Review and accept these
   only for your own copy of this helper. It has no Google or university-site permission.

## Connect

1. Open https://overleaf-mcp.fanurs.com/connect and sign into the same private setup identity
   you used previously. Keep that tab open in the same browser window as Overleaf.
2. Open the Overleaf project while signed into Overleaf. Open **Overleaf connection helper -
   Fanurs** from the browser's Extensions menu. The project URL should be filled in; check it.
3. Click **Connect this Overleaf session**. Keep the popup open until it says **Session saved**.
   Return to the setup tab and click **Test connection**. No countdown or cloud-browser
   allowance is used. If the test fails, report only the error code, never the cookies.

After a successful test, the helper can be disabled or removed. It is only needed again when
the saved Overleaf session expires. Your computer need not stay on for the hosted service.

## Credential boundary

Cookies grant the service an Overleaf account session, not a project-scoped permission.
The server currently reads only the selected project's root document and reports success flags.
The helper reads cookies applicable to the exact selected project URL from the cookie store belonging to that open
project tab, filters to the
exact `overleaf.com`/`www.overleaf.com` domains, and sends them as a Netscape cookie file to the
existing authenticated `/api/link` route through the setup tab. It never exports a file, copies
to the clipboard, displays a cookie value, logs it, or sends it to chat or GitHub. Google and
university cookies and stored passwords are not read. The server encrypts the session at rest.

The destination is fixed in source. An arbitrary web page cannot call the helper, and the popup
does not receive messages or caller-supplied scripts. Script execution is used only to make
the fixed same-origin upload from the authenticated setup tab, retaining Access and origin
checks. Redirects during credential upload are refused. No broad CORS exception is added.

Removing the helper does not delete the server session. Use **Remove saved session** on the
setup page for that. Revoking the account session at Overleaf is a separate action.

Source APIs:
https://developer.chrome.com/docs/extensions/reference/api/cookies
https://developer.chrome.com/docs/extensions/reference/api/scripting

## Update an existing installation to 0.1.1

Download the current ZIP from https://overleaf-mcp.fanurs.com/connect/extension.zip and extract
its files into the same folder used for **Load unpacked**, replacing the old helper files.
Open `edge://extensions` or `chrome://extensions` and click **Reload** on the helper card.
Accept/enable access to the listed Overleaf domains if the browser asks. Open the helper again
and confirm it shows **Helper version 0.1.1** before clicking Connect.

Version 0.1.0 omitted the root `overleaf.com` host permission. Chromium filters each cookie by
its own domain, so an allowed www tab is not sufficient for a domain cookie in this API. The
updated version also explicitly selects the open project's cookie store and exact URL, instead
of assuming the popup's default store. It distinguishes withheld permission, a missing project
tab/store, no returned cookies, and rejected formats without displaying names or values.

Implementation reference for Chromium's cookie-domain permission filter:
https://chromium.googlesource.com/chromium/src/+/7716401d9f3fe45aa9928105e2e6a0a288c059c1/chrome/browser/extensions/api/cookies/cookies_helpers.cc
