import type { CookieJar } from 'tough-cookie'
import { readBoundedBody } from '../../src/core/bounded-body.js'
import { McpError } from '../../src/core/errors.js'
import { mergeCookies, OVERLEAF_ORIGIN } from './cookies.js'

/** Fixed-origin, bounded transport shared by probes and MCP calls. */
export function overleafFetcher(jar: CookieJar) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (target.origin !== OVERLEAF_ORIGIN) throw new Error('OVERLEAF_ORIGIN_REFUSED')
    // Never let an upstream redirect carry the saved cookie to a different origin.
    const response = await fetch(input, { ...init, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new McpError(
        'AUTH_EXPIRED',
        'Overleaf redirected the authenticated connection test. Link the session again.'
      )
    }
    // Freeze Max-Age at arrival for both the HTTP client and Socket.IO handshake.
    const headers = new Headers(response.headers)
    const values = headers.getSetCookie()
    if (values.length) {
      await mergeCookies(jar, target.href, values)
      headers.delete('set-cookie')
    }
    if (!response.body) return new Response(null, { status: response.status, headers })
    const body = await readBoundedBody(response.body, 2 * 1024 * 1024)
    if (body.truncated)
      throw new McpError('PROTOCOL_UNSUPPORTED', 'Overleaf response exceeded the connection test limit.')
    return new Response(Uint8Array.from(body.bytes).buffer, { status: response.status, headers })
  }
}
