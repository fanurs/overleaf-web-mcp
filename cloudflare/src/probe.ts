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
  documentSelection?: 'configured_root' | 'project_document'
}

/** Reads one document through the upstream protocol engine. Never writes or changes the compile root. */
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
    // A readable project need not report an explicit compile root. Select only an actual
    // editable document in its joined tree, never a binary file, folder, or invented ID.
    const documents = connection.getTree().filter(entity => entity.type === 'doc')
    documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    const root = documents.find(entity => entity.id === connection.rootDocId)
    const selected = root ?? documents.find(entity => /\.tex$/iu.test(entity.path)) ?? documents[0]
    if (!selected) throw new Error('NO_READABLE_DOCUMENT')
    return await connection.withDocument(selected.id, document =>
      Promise.resolve({
        authenticated: true,
        projectJoined: true,
        documentRead: true,
        characters: document.content.length,
        protocol: document.protocol,
        documentSelection: root ? 'configured_root' : 'project_document',
      })
    )
  } finally {
    connection.close()
  }
}
