import type { CookieJar } from 'tough-cookie'

import { readBoundedBody } from '../../src/core/bounded-body.js'
import { McpError } from '../../src/core/errors.js'
import { parseBootstrapMeta, requireCsrfToken } from '../../src/http/bootstrap.js'
import { OverleafHttpClient } from '../../src/http/client.js'
import { openProjectConnection } from '../../src/protocol/connect.js'
import { mergeCookies, OVERLEAF_ORIGIN } from './cookies.js'
import { WorkerWebSocket } from './websocket.js'

export interface ProbeResult {
  authenticated: true
  projectJoined: true
  documentRead: true
  characters: number
  protocol: string
}

/** Reads the disposable project's root document through the upstream protocol engine. Never writes. */
export async function runProbe(jar: CookieJar, projectId: string): Promise<ProbeResult> {
  if (!/^[a-f0-9]{24}$/u.test(projectId)) throw new Error('PROJECT_ID_INVALID')
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
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
  const http = new OverleafHttpClient({
    baseUrl: OVERLEAF_ORIGIN,
    jar,
    defaultTimeoutMs: 10000,
    readAttempts: 1,
    fetcher,
    persistSetCookies: async (url, values) => await mergeCookies(jar, url, values),
  })
  const response = await http.request('GET', '/project')
  const bootstrap = parseBootstrapMeta(await response.text())
  requireCsrfToken(bootstrap)
  const connection = await openProjectConnection({
    baseUrl: OVERLEAF_ORIGIN,
    projectId,
    jar,
    supportedProtocolVersions: [2],
    timeoutMs: 10000,
    fetcher,
    ...(bootstrap.userId === undefined ? {} : { currentUserId: bootstrap.userId }),
    webSocketFactory: (url, options) => new WorkerWebSocket(url, options.headers),
  })
  try {
    const documentId = connection.rootDocId
    if (!documentId) throw new Error('ROOT_DOCUMENT_MISSING')
    return await connection.withDocument(documentId, document =>
      Promise.resolve({
        authenticated: true,
        projectJoined: true,
        documentRead: true,
        characters: document.content.length,
        protocol: document.protocol,
      })
    )
  } finally {
    connection.close()
  }
}
