import type { CookieJar } from 'tough-cookie'

import { decryptSession, encryptSession } from './crypto.js'
import { checkedLiveView, type HostedBrowser } from './hosted-browser.js'
import type { SessionStorage } from './session.js'

export const LOGIN_TIMEOUT_MS = 4 * 60 * 1000
export const LOGIN_CHECK_MS = 5000
export const LOGIN_OPEN_TIMEOUT_MS = 60000
export const DAILY_LOGIN_ATTEMPTS = 2

export type LoginOutcome = 'connected' | 'cancelled' | 'expired' | 'not_opened' | 'failed' | 'launch_failed'
export interface LoginUsage {
  id: string
  startedAt: number
  endedAt: number
  elapsedMs: number
  browserMs?: number
  timing: 'cloudflare' | 'estimated' | 'unavailable'
  outcome: LoginOutcome
  completion?: 'automatic' | 'manual'
}
interface PendingLogin {
  sessionId: string
  projectId: string
  expiresAt: number
  startedAt?: number // Older deployments stored only expiresAt.
  id?: string
  watching?: boolean
  closing?: LoginOutcome
  completion?: 'automatic' | 'manual'
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
  #started(pending: PendingLogin): number {
    return pending.startedAt ?? pending.expiresAt - LOGIN_TIMEOUT_MS
  }
  async #record(record: LoginUsage): Promise<void> {
    const month = new Date(record.startedAt).toISOString().slice(0, 7)
    const months = (await this.#read<string[]>('usage-months')) ?? []
    // Index first: a failed record write leaves a harmless empty month, never a lost record.
    if (!months.includes(month)) await this.#write('usage-months', [...months, month].sort())
    const records = (await this.#read<LoginUsage[]>(`usage:${month}`)) ?? []
    await this.#write(`usage:${month}`, [...records.filter(item => item.id !== record.id), record])
  }
  async history(all = false): Promise<LoginUsage[]> {
    const months = (await this.#read<string[]>('usage-months')) ?? []
    const records: LoginUsage[] = []
    for (const month of [...months].reverse()) {
      records.push(...((await this.#read<LoginUsage[]>(`usage:${month}`)) ?? []).reverse())
      if (!all && records.length >= 20) break
    }
    return all ? records : records.slice(0, 20)
  }
  async status() {
    const pending = await this.#read<PendingLogin>('login')
    return pending
      ? {
          startedAt: this.#started(pending),
          expiresAt: pending.expiresAt,
          watching: !!pending.watching,
          closing: !!pending.closing,
          elapsedMs: Math.max(0, this.#now() - this.#started(pending)),
        }
      : undefined
  }
  async expire(): Promise<void> {
    const pending = await this.#read<PendingLogin>('login')
    if (!pending) return
    if (pending.closing) await this.cancel(pending.closing, pending.completion)
    else if (pending.expiresAt <= this.#now()) await this.cancel('expired')
    else if (!pending.watching && this.#started(pending) + LOGIN_OPEN_TIMEOUT_MS <= this.#now()) {
      await this.cancel('not_opened')
    }
  }
  async cancel(outcome: LoginOutcome = 'cancelled', completion?: 'automatic' | 'manual'): Promise<void> {
    const pending = await this.#read<PendingLogin>('login')
    if (!pending) return
    pending.closing ??= outcome
    if (completion) pending.completion ??= completion
    pending.id ??= crypto.randomUUID()
    // Persist the close intent before contacting the provider. Retry even before the deadline.
    await this.#write('login', pending)
    await this.options.setAlarm(this.#now() + LOGIN_CHECK_MS)
    try {
      await this.options.browser.close(pending.sessionId)
    } catch {
      throw new Error('LOGIN_CLOSE_PENDING')
    }
    const endedAt = this.#now()
    // A missing provider history entry is an estimate, never a fabricated exact usage value.
    const usage = await this.options.browser.usage(pending.sessionId).catch(() => undefined)
    await this.#record({
      id: pending.id,
      startedAt: this.#started(pending),
      endedAt,
      elapsedMs: Math.max(0, endedAt - this.#started(pending)),
      ...(usage ? { browserMs: usage.durationMs } : {}),
      timing: usage ? 'cloudflare' : 'estimated',
      outcome: pending.closing,
      ...(pending.completion ? { completion: pending.completion } : {}),
    })
    await this.storage.delete('login')
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
      await this.#write('login-budget', { day, attempts: attempts + 1 })
      const startedAt = this.#now()
      const id = crypto.randomUUID()
      let sessionId: string
      try {
        sessionId = await this.options.browser.launch()
      } catch (error) {
        const endedAt = this.#now()
        await this.#record({
          id,
          startedAt,
          endedAt,
          elapsedMs: endedAt - startedAt,
          timing: 'unavailable',
          outcome: 'launch_failed',
        })
        throw error
      }
      pending = { id, sessionId, projectId, startedAt, expiresAt: startedAt + LOGIN_TIMEOUT_MS }
      try {
        await this.#write('login', pending)
        await this.options.setAlarm(startedAt + LOGIN_OPEN_TIMEOUT_MS)
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
      await this.cancel('failed')
      throw error
    }
  }
  async watch(): Promise<void> {
    await this.expire()
    const pending = await this.#read<PendingLogin>('login')
    if (!pending) throw new Error('LOGIN_REQUIRED')
    pending.watching = true
    await this.#write('login', pending)
    await this.options.setAlarm(Math.min(this.#now() + LOGIN_CHECK_MS, pending.expiresAt))
  }
  async tick(save: (jar: CookieJar, projectId: string) => Promise<void>): Promise<void> {
    await this.expire()
    const pending = await this.#read<PendingLogin>('login')
    if (!pending) return
    if (!pending.watching) {
      await this.options.setAlarm(Math.min(this.#started(pending) + LOGIN_OPEN_TIMEOUT_MS, pending.expiresAt))
      return
    }
    // Set the next alarm first so a failed check or object restart cannot lose the deadline.
    await this.options.setAlarm(Math.min(this.#now() + LOGIN_CHECK_MS, pending.expiresAt))
    try {
      const jar = await this.options.browser.readSession(pending.sessionId)
      if (!jar) return
      await save(jar, pending.projectId)
      await this.cancel('connected', 'automatic')
    } catch (error) {
      if (error instanceof Error && error.message === 'LOGIN_CLOSE_PENDING') throw error
      await this.cancel('failed')
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
