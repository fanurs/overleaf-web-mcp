import { CookieJar } from 'tough-cookie'

import { McpError } from '../../src/core/errors.js'
import { FifoQueue } from '../../src/core/queue.js'
import { importSession } from './cookies.js'
import { decryptSession, encryptSession, type EncryptedSession } from './crypto.js'
import { boundedJson, json } from './http.js'
import { HostedLogin, type HostedLoginOptions } from './hosted-login.js'
import { runProbe } from './probe.js'
import { remoteMcpHandler, type RemoteTool } from '../../src/mcp/remote.js'
import { OPERATIONS } from '../../src/contracts/operations.js'
import { parseOperationInput } from '../../src/contracts/parse.js'
import { readBoundedBody } from '../../src/core/bounded-body.js'
import { createCloudRuntime } from './runtime.js'
import { runEditTest, type EditTestResult } from './self-test.js'

interface SessionData {
  jar: string
  projectId: string
  verifiedAt?: number
  editTest?: EditTestResult
}

export interface SessionStorage {
  get(key: string): Promise<EncryptedSession | undefined>
  put(key: string, value: EncryptedSession): Promise<unknown>
  delete(key: string): Promise<unknown>
}

const SAFE_CODES = new Set([
  'BODY_REQUIRED',
  'BODY_TOO_LARGE',
  'SESSION_TOO_LARGE',
  'SESSION_EMPTY',
  'PROJECT_ID_INVALID',
  'ROOT_DOCUMENT_MISSING',
  'NO_READABLE_DOCUMENT',
  'SESSION_KEY_INVALID',
  'LOGIN_REQUIRED',
  'LOGIN_NOT_FINISHED',
  'LOGIN_DAILY_LIMIT',
  'LOGIN_PROJECT_CHANGED',
  'LOGIN_CLOSE_PENDING',
  'LOGIN_BROWSER_CLOSED',
  'LOGIN_VIEW_INVALID',
])

/** Serialized access avoids a refresh overwriting a new login or undoing an unlink. */
export class SessionController {
  readonly #queue = new FifoQueue()
  readonly #login: HostedLogin | undefined

  constructor(
    private readonly storage: SessionStorage,
    private readonly secret: string,
    private readonly owner: string,
    private readonly probe = runProbe,
    hostedLogin?: HostedLoginOptions
  ) {
    this.#login = hostedLogin ? new HostedLogin(storage, secret, owner, hostedLogin) : undefined
  }

  async alarm(): Promise<void> {
    await this.#queue.run(async () => {
      await this.#login?.tick(async (jar, projectId) => {
        await this.#save({ jar: JSON.stringify(await jar.serialize()), projectId })
      })
    })
  }

  async #save(data: SessionData): Promise<void> {
    await this.storage.put('session', await encryptSession(JSON.stringify(data), this.secret, this.owner))
  }

  async #load(): Promise<SessionData | undefined> {
    const saved = await this.storage.get('session')
    return saved ? (JSON.parse(await decryptSession(saved, this.secret, this.owner)) as SessionData) : undefined
  }

  async #remote(request: Request): Promise<Response> {
    // Stateless HTTP only; no idle SSE, subscriptions or request batches that could race writes.
    if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405)
    if (request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json')
      return json({ code: 'JSON_REQUIRED' }, 415)
    const parsed = await boundedJson(request, 262144)
    if (Array.isArray(parsed)) return json({ code: 'BATCH_NOT_SUPPORTED' }, 400)
    const handler = remoteMcpHandler({
      status: async () => {
        const data = await this.#load()
        return {
          linked: !!data,
          projectId: data?.projectId,
          readVerifiedAt: data?.verifiedAt,
          editingVerified: data?.editTest?.status === 'passed',
          cloudBrowserSeconds: 0,
          setupUrl: 'https://overleaf-mcp.fanurs.com/connect',
        }
      },
      call: async (name: RemoteTool, input: unknown) => {
        const data = await this.#load()
        if (!data) throw new McpError('AUTH_EXPIRED', 'No Overleaf session is saved. Open the connection setup page.')
        if (!('readOnlyHint' in OPERATIONS[name].annotations) && data.editTest?.status !== 'passed') {
          throw new McpError(
            'POLICY_DENIED',
            'Complete the disposable editing test on the setup page before editing or compiling through ChatGPT.'
          )
        }
        const parsedInput = parseOperationInput(name, input)
        if ('localPath' in parsedInput) throw new McpError('POLICY_DENIED', 'Server disk paths are not available.')
        const jar = await CookieJar.deserialize(data.jar)
        let runtime: Awaited<ReturnType<typeof createCloudRuntime>> | undefined
        try {
          runtime = await createCloudRuntime(jar, data.projectId)
          const call = runtime.service[name] as (args: unknown) => Promise<unknown>
          return await call(parsedInput)
        } finally {
          await runtime?.close()
          await this.#save({ ...data, jar: JSON.stringify(await jar.serialize()) })
        }
      },
    })
    try {
      const response = await handler.fetch(request, { parsedBody: parsed })
      // Draining the single exchange also waits for legacy SSE completion before releasing the
      // owner's FIFO lock. No live Overleaf runtime or response stream survives the request.
      const body = response.body ? await readBoundedBody(response.body, 2 * 1024 * 1024) : undefined
      if (body?.truncated) return json({ code: 'RESULT_TOO_LARGE', retryable: false }, 413)
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'no-store')
      return new Response(body ? Uint8Array.from(body.bytes).buffer : null, { status: response.status, headers })
    } finally {
      await handler.close()
    }
  }

  async handle(request: Request): Promise<Response> {
    return await this.#queue.run(async () => {
      try {
        const path = new URL(request.url).pathname
        if (path === '/mcp') return await this.#remote(request)
        if (request.method === 'GET' && path === '/api/status') {
          const data = await this.#load()
          return json({
            linked: !!data,
            mode: 'remote-mcp',
            projectId: data?.projectId,
            verifiedAt: data?.verifiedAt,
            editTest: data?.editTest,
            hostedLogin: !!this.#login,
            login: await this.#login?.status(),
            usage: (await this.#login?.history()) ?? [],
            serverTime: Date.now(),
          })
        }
        if (request.method === 'GET' && path === '/api/login/history') {
          const response = json({ sessions: (await this.#login?.history(true)) ?? [] })
          response.headers.set('Content-Disposition', 'attachment; filename=overleaf-login-usage.json')
          return response
        }
        if (request.method !== 'POST') return json({ code: 'NOT_FOUND' }, 404)
        await this.#login?.expire()
        if (path.startsWith('/api/login/')) {
          if (!this.#login) return json({ code: 'HOSTED_LOGIN_UNAVAILABLE' }, 503)
          if (path === '/api/login/start') {
            const input = await boundedJson(request)
            if (
              typeof input !== 'object' ||
              input === null ||
              !('ready' in input) ||
              input.ready !== true ||
              !('projectId' in input) ||
              typeof input.projectId !== 'string'
            )
              return json({ code: 'INVALID_INPUT' }, 400)
            return json(await this.#login.start(input.projectId))
          }
          if (path === '/api/login/watch') {
            await this.#login.watch()
            return json({ watching: true })
          }
          if (path === '/api/login/cancel') {
            await this.#login.cancel()
            return json({ loginClosed: true })
          }
          if (path === '/api/login/finish') {
            if (
              !(await this.#login.status()) &&
              (await this.#login.history())[0]?.outcome === 'connected' &&
              (await this.storage.get('session'))
            ) {
              return json({ linked: true, verified: false, loginClosed: true })
            }
            const { jar, projectId } = await this.#login.finish()
            await this.#save({ jar: JSON.stringify(await jar.serialize()), projectId })
            await this.#login.cancel('connected', 'manual')
            return json({ linked: true, verified: false, loginClosed: true })
          }
        }
        if (path === '/api/unlink') {
          await this.storage.delete('session')
          await this.#login?.cancel()
          return json({ linked: false })
        }
        if (path === '/api/link') {
          const input = await boundedJson(request)
          if (typeof input !== 'object' || input === null) return json({ code: 'INVALID_INPUT' }, 400)
          const { cookies, projectId } = input as Record<string, unknown>
          if (typeof cookies !== 'string' || typeof projectId !== 'string' || !/^[a-f0-9]{24}$/u.test(projectId)) {
            return json({ code: 'INVALID_INPUT' }, 400)
          }
          const jar = await importSession(cookies)
          await this.#login?.cancel()
          await this.#save({ jar: JSON.stringify(await jar.serialize()), projectId })
          return json({ linked: true, verified: false })
        }
        if (path === '/api/probe') {
          const saved = await this.storage.get('session')
          if (!saved) return json({ code: 'SESSION_REQUIRED' }, 409)
          const data = JSON.parse(await decryptSession(saved, this.secret, this.owner)) as SessionData
          const jar = await CookieJar.deserialize(data.jar)
          try {
            const result = await this.probe(jar, data.projectId)
            data.verifiedAt = Date.now()
            return json(result)
          } finally {
            // Preserve any renewed cookies even when a later protocol step failed.
            await this.#save({ ...data, jar: JSON.stringify(await jar.serialize()) })
          }
        }
        if (path === '/api/edit-test') {
          const data = await this.#load()
          if (!data) return json({ code: 'SESSION_REQUIRED' }, 409)
          if (data.editTest?.status === 'passed') return json(data.editTest)
          if (data.editTest && !data.editTest.trashed)
            return json({ code: 'TEST_REVIEW_REQUIRED', editTest: data.editTest }, 409)
          const jar = await CookieJar.deserialize(data.jar)
          try {
            return json(
              await runEditTest(jar, async result => {
                data.editTest = { ...result }
                await this.#save(data)
              })
            )
          } finally {
            await this.#save({ ...data, jar: JSON.stringify(await jar.serialize()) })
          }
        }
        return json({ code: 'NOT_FOUND' }, 404)
      } catch (error) {
        // Do not forward upstream messages, stack traces, filenames, tokens, or document text.
        const code =
          error instanceof McpError
            ? error.code
            : error instanceof Error && SAFE_CODES.has(error.message)
              ? error.message
              : new URL(request.url).pathname.startsWith('/api/login/')
                ? 'LOGIN_FAILED'
                : 'PROBE_FAILED'
        return json(
          new URL(request.url).pathname === '/mcp'
            ? { code: 'MCP_REQUEST_FAILED', retryable: false }
            : { code, changedDocuments: false },
          400
        )
      }
    })
  }
}
