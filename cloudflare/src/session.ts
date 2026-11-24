import { CookieJar } from 'tough-cookie'

import { McpError } from '../../src/core/errors.js'
import { FifoQueue } from '../../src/core/queue.js'
import { importSession } from './cookies.js'
import { decryptSession, encryptSession, type EncryptedSession } from './crypto.js'
import { boundedJson, json } from './http.js'
import { HostedLogin, type HostedLoginOptions } from './hosted-login.js'
import { runProbe } from './probe.js'

interface SessionData {
  jar: string
  projectId: string
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

  async handle(request: Request): Promise<Response> {
    return await this.#queue.run(async () => {
      try {
        const path = new URL(request.url).pathname
        if (request.method === 'GET' && path === '/api/status') {
          return json({
            linked: (await this.storage.get('session')) !== undefined,
            mode: 'read-only-probe',
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
            return json(result)
          } finally {
            // Preserve any renewed cookies even when a later protocol step failed.
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
        return json({ code, changedDocuments: false }, 400)
      }
    })
  }
}
