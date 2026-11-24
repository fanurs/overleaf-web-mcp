import { DurableObject } from 'cloudflare:workers'

import { verifyAccess, type AccessConfig } from './auth.js'
import { json, validSetupRequest } from './http.js'
import { CloudflareHostedBrowser } from './hosted-browser.js'
import { SETUP_HTML, SETUP_JS } from './page.js'
import { LOGIN_HTML, LOGIN_JS } from './login-page.js'
import { EXTENSION_ZIP } from './extension-package.js'
import { SessionController } from './session.js'

interface Env extends AccessConfig {
  SESSION_ENCRYPTION_KEY: string
  SESSIONS: DurableObjectNamespace<OverleafSession>
  BROWSER?: Fetcher
}

export class OverleafSession extends DurableObject<Env> {
  readonly #controller: SessionController

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.#controller = new SessionController(
      ctx.storage,
      env.SESSION_ENCRYPTION_KEY,
      ctx.id.toString(),
      undefined,
      env.BROWSER
        ? { browser: new CloudflareHostedBrowser(env.BROWSER), setAlarm: time => ctx.storage.setAlarm(time) }
        : undefined
    )
  }

  async fetch(request: Request): Promise<Response> {
    return await this.#controller.handle(request)
  }

  async alarm(): Promise<void> {
    await this.#controller.alarm()
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (
      !env.CF_ACCESS_TEAM_DOMAIN ||
      !env.CF_ACCESS_AUD ||
      !/^[0-9a-f]{64}$/iu.test(env.SESSION_ENCRYPTION_KEY ?? '')
    ) {
      return json({ code: 'SETUP_REQUIRED' }, 503)
    }
    let owner: string
    try {
      owner = await verifyAccess(request, env)
    } catch {
      return json({ code: 'ACCESS_REQUIRED' }, 401)
    }
    const url = new URL(request.url)
    if (url.pathname === '/mcp') {
      const origin = request.headers.get('Origin')
      if (origin && origin !== url.origin && origin !== 'https://chatgpt.com')
        return json({ code: 'ORIGIN_REFUSED' }, 403)
      return await env.SESSIONS.get(env.SESSIONS.idFromName(owner)).fetch(request)
    }
    const pageHeaders = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/connect')) {
      return new Response(SETUP_HTML, { headers: { ...pageHeaders, 'Content-Type': 'text/html; charset=utf-8' } })
    }
    if (request.method === 'GET' && url.pathname === '/setup.js') {
      return new Response(SETUP_JS, { headers: { ...pageHeaders, 'Content-Type': 'text/javascript; charset=utf-8' } })
    }
    if (request.method === 'GET' && url.pathname === '/connect/login') {
      return new Response(LOGIN_HTML, { headers: { ...pageHeaders, 'Content-Type': 'text/html; charset=utf-8' } })
    }
    if (request.method === 'GET' && url.pathname === '/login.js') {
      return new Response(LOGIN_JS, { headers: { ...pageHeaders, 'Content-Type': 'text/javascript; charset=utf-8' } })
    }
    if (request.method === 'GET' && url.pathname === '/connect/extension.zip') {
      const bytes = Uint8Array.from(atob(EXTENSION_ZIP), character => character.charCodeAt(0))
      return new Response(bytes, {
        headers: {
          ...pageHeaders,
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="overleaf-connection-helper.zip"',
        },
      })
    }
    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET' && !validSetupRequest(request)) return json({ code: 'ORIGIN_REFUSED' }, 403)
      const id = env.SESSIONS.idFromName(owner)
      return await env.SESSIONS.get(id).fetch(request)
    }
    return json({ code: 'NOT_FOUND', mode: 'remote-mcp' }, 404)
  },
} satisfies ExportedHandler<Env>
