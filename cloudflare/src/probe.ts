import type { CookieJar } from 'tough-cookie'

import { parseBootstrapMeta, requireCsrfToken } from '../../src/http/bootstrap.js'
import { OverleafHttpClient } from '../../src/http/client.js'
import { openProjectConnection } from '../../src/protocol/connect.js'
import { mergeCookies, OVERLEAF_ORIGIN } from './cookies.js'
import { WorkerWebSocket } from './websocket.js'
import { overleafFetcher } from './transport.js'

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
  const fetcher = overleafFetcher(jar)
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
