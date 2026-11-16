import { CookieJar } from 'tough-cookie'

import { McpError } from '../../src/core/errors.js'
import { FifoQueue } from '../../src/core/queue.js'
import { importSession } from './cookies.js'
import { decryptSession, encryptSession, type EncryptedSession } from './crypto.js'
import { boundedJson, json } from './http.js'
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
])

/** Serialized access avoids a refresh overwriting a new login or undoing an unlink. */
export class SessionController {
  readonly #queue = new FifoQueue()

  constructor(
    private readonly storage: SessionStorage,
    private readonly secret: string,
    private readonly owner: string,
    private readonly probe = runProbe
  ) {}

  async #save(data: SessionData): Promise<void> {
    await this.storage.put('session', await encryptSession(JSON.stringify(data), this.secret, this.owner))
  }

  async handle(request: Request): Promise<Response> {
    return await this.#queue.run(async () => {
      try {
        const path = new URL(request.url).pathname
        if (request.method === 'GET' && path === '/api/status') {
          return json({ linked: (await this.storage.get('session')) !== undefined, mode: 'read-only-probe' })
        }
        if (request.method !== 'POST') return json({ code: 'NOT_FOUND' }, 404)
        if (path === '/api/unlink') {
          await this.storage.delete('session')
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
              : 'PROBE_FAILED'
        return json({ code, changedDocuments: false }, 400)
      }
    })
  }
}
