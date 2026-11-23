import type { CookieJar } from 'tough-cookie'

import { decryptSession, encryptSession } from './crypto.js'
import { checkedLiveView, type HostedBrowser } from './hosted-browser.js'
import type { SessionStorage } from './session.js'

export const LOGIN_TIMEOUT_MS = 4 * 60 * 1000
export const DAILY_LOGIN_ATTEMPTS = 2

interface PendingLogin {
  sessionId: string
  projectId: string
  expiresAt: number
}

export interface HostedLoginOptions {
  browser: HostedBrowser
  setAlarm(time: number): Promise<unknown>
  now?: () => number
}

/** All calls run inside SessionController's queue, including alarm cleanup. */
export class HostedLogin {
  readonly #now: () => number

  constructor(
    private readonly storage: SessionStorage,
    private readonly secret: string,
    private readonly owner: string,
    private readonly options: HostedLoginOptions
  ) {
    this.#now = options.now ?? Date.now
  }

  async #read<T>(key: string): Promise<T | undefined> {
    const value = await this.storage.get(key)
    return value ? (JSON.parse(await decryptSession(value, this.secret, this.owner)) as T) : undefined
  }

  async #write(key: string, value: unknown): Promise<void> {
    await this.storage.put(key, await encryptSession(JSON.stringify(value), this.secret, this.owner))
  }

  async status(): Promise<{ expiresAt: number } | undefined> {
    const pending = await this.#read<PendingLogin>('login')
    return pending ? { expiresAt: pending.expiresAt } : undefined
  }

  async expire(): Promise<void> {
    const pending = await this.#read<PendingLogin>('login')
    if (pending && pending.expiresAt <= this.#now()) await this.cancel()
  }

  async cancel(): Promise<void> {
    const pending = await this.#read<PendingLogin>('login')
    if (!pending) return
    // Keep the encrypted ID until closure is confirmed, so an alarm can retry cleanup.
    try {
      await this.options.browser.close(pending.sessionId)
      await this.storage.delete('login')
    } catch {
      await this.options.setAlarm(this.#now() + 10000)
      throw new Error('LOGIN_CLOSE_PENDING')
    }
  }

  async start(projectId: string): Promise<{ loginUrl: string; expiresAt: number }> {
    if (!/^[a-f0-9]{24}$/u.test(projectId)) throw new Error('PROJECT_ID_INVALID')
    await this.expire()
    let pending = await this.#read<PendingLogin>('login')
    if (pending && pending.projectId !== projectId) throw new Error('LOGIN_PROJECT_CHANGED')
    if (!pending) {
      const day = new Date(this.#now()).toISOString().slice(0, 10)
      const budget = await this.#read<{ day: string; attempts: number }>('login-budget')
      const attempts = budget?.day === day ? budget.attempts : 0
      if (attempts >= DAILY_LOGIN_ATTEMPTS) throw new Error('LOGIN_DAILY_LIMIT')
      // Failed launches count too. Never retry a provider quota failure automatically.
      await this.#write('login-budget', { day, attempts: attempts + 1 })
      const expiresAt = this.#now() + LOGIN_TIMEOUT_MS
      const sessionId = await this.options.browser.launch()
      pending = { sessionId, projectId, expiresAt }
      try {
        await this.#write('login', pending)
        await this.options.setAlarm(expiresAt)
      } catch (error) {
        await this.options.browser.close(sessionId)
        throw error
      }
    }
    try {
      return {
        loginUrl: checkedLiveView(await this.options.browser.view(pending.sessionId)),
        expiresAt: pending.expiresAt,
      }
    } catch (error) {
      await this.cancel()
      throw error
    }
  }

  async finish(): Promise<{ jar: CookieJar; projectId: string }> {
    await this.expire()
    const pending = await this.#read<PendingLogin>('login')
    if (!pending) throw new Error('LOGIN_REQUIRED')
    const jar = await this.options.browser.readSession(pending.sessionId)
    if (!jar) throw new Error('LOGIN_NOT_FINISHED')
    return { jar, projectId: pending.projectId }
  }
}
