import type { CookieJar } from 'tough-cookie'

import type { OverleafServiceRuntime } from '../../src/contracts/service.js'
import { asMcpError, McpError } from '../../src/core/errors.js'
import { AccessPolicy } from '../../src/core/policy.js'
import { parseBootstrapMeta, requireCsrfToken } from '../../src/http/bootstrap.js'
import { OverleafHttpClient } from '../../src/http/client.js'
import { AccountApi } from '../../src/overleaf/account.js'
import { CompileApi } from '../../src/overleaf/compile.js'
import { DocumentsApi } from '../../src/overleaf/documents.js'
import { EntitiesApi } from '../../src/overleaf/entities.js'
import { ProjectsApi } from '../../src/overleaf/projects.js'
import { SectionsApi } from '../../src/overleaf/sections-api.js'
import { resolveProjectPath, type EntityType } from '../../src/overleaf/tree.js'
import { ProjectConnectionCache } from '../../src/protocol/connection-cache.js'
import { openProjectConnection } from '../../src/protocol/connect.js'
import { createOverleafService } from '../../src/service/operations.js'
import { mergeCookies, OVERLEAF_ORIGIN } from './cookies.js'
import { overleafFetcher } from './transport.js'
import { WorkerWebSocket } from './websocket.js'

const unavailable = (): Promise<never> =>
  Promise.reject(new McpError('POLICY_DENIED', 'This operation is not enabled on the remote server.'))

/** One call owns its runtime; its caller must close it in finally. No disk session or idle daemon. */
export async function createCloudRuntime(jar: CookieJar, projectId?: string) {
  // An empty allowlist is used only by the explicit disposable test. Creating its own project
  // adds that ID to this runtime's policy; it can never touch the connected manuscript.
  const policy = await AccessPolicy.create({
    allowedProjects: projectId ? [projectId] : [],
    localReadRoots: [],
    localWriteRoots: [],
    allowedEffects: [
      'overleaf-read',
      'overleaf-write',
      'compile',
      ...(projectId ? [] : (['project-lifecycle'] as const)),
    ],
  })
  const fetcher = overleafFetcher(jar)
  const csrf = { token: undefined as string | undefined }
  const http = new OverleafHttpClient({
    baseUrl: OVERLEAF_ORIGIN,
    jar,
    defaultTimeoutMs: 10000,
    readAttempts: 1,
    csrfToken: () => csrf.token,
    fetcher,
    persistSetCookies: async (url, values) => await mergeCookies(jar, url, values),
  })
  const bootstrap = parseBootstrapMeta(await (await http.request('GET', '/project')).text())
  csrf.token = requireCsrfToken(bootstrap)
  const connections = new ProjectConnectionCache({
    capacity: 1,
    idleTtlMs: 1000,
    beforeConnect: id => policy.assertProject(id),
    factory: async id =>
      await openProjectConnection({
        baseUrl: OVERLEAF_ORIGIN,
        projectId: id,
        jar,
        supportedProtocolVersions: [2],
        timeoutMs: 10000,
        applyTimeoutMs: 10000,
        fetcher,
        ...(bootstrap.userId === undefined ? {} : { currentUserId: bootstrap.userId }),
        webSocketFactory: (url, options) => new WorkerWebSocket(url, options.headers),
      }),
  })
  const account = new AccountApi(http, policy)
  const documents = new DocumentsApi(connections, {
    maxDocLength: Math.min(bootstrap.maxDocLength ?? 200000, 200000),
    maxUpdateChars: 10000,
    recoveryTimeoutMs: 10000,
    policy,
    ...(bootstrap.userId === undefined ? {} : { currentUserId: bootstrap.userId }),
  })
  const entities = new EntitiesApi(http, connections, policy)
  const freshTree = async (id: string) => {
    await connections.invalidate(id)
    return await entities.getProjectTree(id)
  }
  const resolvePath = async (id: string, path: string, type: EntityType) =>
    resolveProjectPath((await freshTree(id)).entities, path, type)
  const sections = new SectionsApi(documents, { getProjectTree: freshTree, policy })
  const compile = new CompileApi(
    http,
    resolvePath,
    20000,
    async id => {
      await connections.invalidate(id)
      return await entities.getRootDocument(id)
    },
    policy
  )
  const projects = new ProjectsApi({
    http,
    baseUrl: OVERLEAF_ORIGIN,
    findProject: async id => await account.findProject(id),
    resolvePath,
    getProjectTree: freshTree,
    invalidate: async id => await connections.invalidate(id),
    policy,
  })
  const runtime: OverleafServiceRuntime = {
    policy,
    account,
    documents,
    entities,
    sections,
    compile,
    projects,
    authStatus: unavailable,
    async createFile(id, path, content = '', writeMode = 'untracked') {
      policy.assertProject(id)
      policy.assertEffect('overleaf-read', 'overleaf-write')
      if (writeMode === 'tracked' && (content === '' || bootstrap.userId === undefined)) {
        throw new McpError('INVALID_ARGUMENT', 'Tracked creation requires content and a known author.')
      }
      await entities.createEmptyFile(id, path)
      try {
        const original = await documents.readFile(id, path)
        if (content !== '') return await documents.writeFile(id, path, original.revision, content, writeMode)
        return {
          revision: original.revision,
          protocol: original.protocol,
          trackChangesActive: original.trackChangesActive,
          writeMode: 'untracked',
        }
      } catch (error) {
        const failure = asMcpError(error)
        throw new McpError(
          failure.code,
          'The file was created. Read it before any further write; do not create it again.',
          { retryable: false, details: { ...failure.details, created: true }, cause: error }
        )
      }
    },
    comments: {
      listComments: unavailable,
      replyToComment: unavailable,
      addComment: unavailable,
      setCommentStatus: unavailable,
    },
    trackedChanges: { listTrackedChanges: unavailable, manageTrackedChanges: unavailable },
    history: { monitorProjectHistory: unavailable },
    sync: { planSync: unavailable, syncDirectory: unavailable, deleteEntities: unavailable, batchUpload: unavailable },
    tags: { manageTags: unavailable },
    search: { searchProject: unavailable },
  }
  return { service: createOverleafService(runtime), runtime, close: async () => await connections.closeAll() }
}
