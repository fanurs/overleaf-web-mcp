import { describe, expect, it, vi } from 'vitest'

import { checkedLiveView, overleafCookies, type HostedBrowser } from '../src/hosted-browser.js'
import { LOGIN_CHECK_MS, LOGIN_OPEN_TIMEOUT_MS, LOGIN_TIMEOUT_MS, type LoginUsage } from '../src/hosted-login.js'
import { encryptSession, type EncryptedSession } from '../src/crypto.js'
import { SessionController, type SessionStorage } from '../src/session.js'

const projectId = '000000000000000000000001'
const secret = 'ab'.repeat(32)
const cookie = {
  name: 'session',
  value: 'private-fixture-cookie',
  domain: '.overleaf.com',
  path: '/',
  secure: true,
  httpOnly: true,
  expires: -1,
}
type Status = { linked: boolean; login?: { closing: boolean }; usage: LoginUsage[] }

const request = (path: string, body?: unknown) =>
  new Request(`https://app.example/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

function setup() {
  let now = Date.UTC(2026, 10, 23, 12)
  const entries = new Map<string, EncryptedSession>()
  const storage: SessionStorage = {
    get: async key => entries.get(key),
    put: async (key, value) => {
      entries.set(key, structuredClone(value))
    },
    delete: async key => entries.delete(key),
  }
  const browser = {
    launch: vi.fn(async () => 'private-fixture-browser'),
    view: vi.fn(async () => 'https://live.browser.run/ui/view?fixture-private-link'),
    readSession: vi.fn<HostedBrowser['readSession']>(async () => await overleafCookies([cookie])),
    close: vi.fn(async () => {}),
    usage: vi.fn<HostedBrowser['usage']>(async () => undefined),
  } satisfies HostedBrowser
  const setAlarm = vi.fn<(time: number) => Promise<void>>(async () => {})
  const options = { browser, setAlarm, now: () => now }
  const create = (owner = 'owner-a') => new SessionController(storage, secret, owner, undefined, options)
  return {
    entries,
    storage,
    browser,
    setAlarm,
    create,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('hosted Overleaf login', () => {
  it('refuses the old start request and keeps the new absolute limit at sixty seconds', async () => {
    const test = setup()
    const response = await test.create().handle(request('login/start', { projectId }))
    expect(response.status).toBe(400)
    expect(test.browser.launch).not.toHaveBeenCalled()
    expect(LOGIN_TIMEOUT_MS).toBe(60000)
  })

  it('tightens a pending four-minute login from an older deployment without corrupting elapsed time', async () => {
    const test = setup()
    const startedAt = Date.UTC(2026, 10, 23, 12)
    await test.storage.put(
      'login',
      await encryptSession(
        JSON.stringify({
          sessionId: 'private-fixture-browser',
          projectId,
          expiresAt: startedAt + 240000,
        }),
        secret,
        'owner-a'
      )
    )
    test.advance(60000)
    await test.create().alarm()
    const body = await (await test.create().handle(request('status'))).json<Status>()
    expect(body.login).toBeUndefined()
    expect(body.usage).toMatchObject([{ outcome: 'expired', elapsedMs: 60000 }])
    expect(test.browser.close).toHaveBeenCalledOnce()
  })

  it('closes slow startup instead of returning an expired login link', async () => {
    const test = setup()
    test.browser.view.mockImplementation(async () => {
      test.advance(61000)
      return 'https://live.browser.run/ui/view?fixture-private-link'
    })
    const response = await test.create().handle(request('login/start', { projectId, ready: true }))
    expect(await response.json()).toMatchObject({ code: 'LOGIN_REQUIRED' })
    expect(test.browser.close).toHaveBeenCalledOnce()
    expect(test.entries.has('login')).toBe(false)
  })

  it('persists an encrypted pending login across recreation, then saves cookies and closes the browser', async () => {
    const test = setup()
    const initial = await test.create().handle(request('login/start', { projectId, ready: true }))
    const body = await initial.json<{ loginUrl: string; expiresAt: number }>()
    expect(body.loginUrl).toMatch(/^https:\/\/live.browser.run\/ui\//)
    expect(test.setAlarm).toHaveBeenCalledWith(body.expiresAt - LOGIN_TIMEOUT_MS + LOGIN_OPEN_TIMEOUT_MS)
    expect(JSON.stringify([...test.entries])).not.toContain('private-fixture')
    const restored = test.create()
    const status = await (await restored.handle(request('status'))).json<{ login: { expiresAt: number } }>()
    expect(status.login.expiresAt).toBe(body.expiresAt)
    expect(JSON.stringify(status)).not.toContain('private')
    expect(await (await restored.handle(request('login/finish', {}))).json()).toEqual({
      linked: true,
      verified: false,
      loginClosed: true,
    })
    expect(test.browser.close).toHaveBeenCalledWith('private-fixture-browser')
    expect(test.entries.has('login')).toBe(false)
    expect(JSON.stringify([...test.entries])).not.toContain('private-fixture-cookie')
  })

  it('keeps an unfinished login pending without saving a session', async () => {
    const test = setup()
    vi.mocked(test.browser.readSession).mockResolvedValue(undefined)
    const controller = test.create()
    await controller.handle(request('login/start', { projectId, ready: true }))
    expect(await (await controller.handle(request('login/finish', {}))).json()).toMatchObject({
      code: 'LOGIN_NOT_FINISHED',
    })
    expect(test.entries.has('session')).toBe(false)
    expect(test.browser.close).not.toHaveBeenCalled()
  })

  it('does not extend the deadline or create a second browser when refreshing its link', async () => {
    const test = setup()
    const controller = test.create()
    const first = await (
      await controller.handle(request('login/start', { projectId, ready: true }))
    ).json<{ expiresAt: number }>()
    await controller.handle(request('login/watch', {}))
    test.advance(20000)
    const second = await (
      await controller.handle(request('login/start', { projectId, ready: true }))
    ).json<{ expiresAt: number }>()
    expect(first.expiresAt).toBe(second.expiresAt)
    expect(test.browser.launch).toHaveBeenCalledOnce()
    expect(
      await (await controller.handle(request('login/start', { projectId: 'b'.repeat(24), ready: true }))).json()
    ).toMatchObject({ code: 'LOGIN_PROJECT_CHANGED' })
  })

  it('closes at the absolute deadline even after object recreation', async () => {
    const test = setup()
    await test.create().handle(request('login/start', { projectId, ready: true }))
    test.advance(LOGIN_TIMEOUT_MS)
    await test.create().alarm()
    expect(test.browser.close).toHaveBeenCalledOnce()
    expect(test.entries.has('login')).toBe(false)
    expect(await (await test.create().handle(request('login/finish', {}))).json()).toMatchObject({
      code: 'LOGIN_REQUIRED',
    })
  })

  it('retains cleanup state and reschedules after a closure failure', async () => {
    const test = setup()
    const controller = test.create()
    await controller.handle(request('login/start', { projectId, ready: true }))
    vi.mocked(test.browser.close).mockRejectedValueOnce(new Error('private remote details'))
    test.advance(LOGIN_TIMEOUT_MS)
    await expect(controller.alarm()).rejects.toThrow('LOGIN_CLOSE_PENDING')
    expect(test.entries.has('login')).toBe(true)
    expect(test.setAlarm).toHaveBeenCalledTimes(2)
    await controller.alarm()
    expect(test.entries.has('login')).toBe(false)
  })

  it('enforces the daily attempt cap across recreation and resets on the next UTC day', async () => {
    const test = setup()
    for (let i = 0; i < 2; i++) {
      const controller = test.create()
      expect((await controller.handle(request('login/start', { projectId, ready: true }))).status).toBe(200)
      await controller.handle(request('login/cancel', {}))
    }
    expect(await (await test.create().handle(request('login/start', { projectId, ready: true }))).json()).toMatchObject(
      {
        code: 'LOGIN_DAILY_LIMIT',
      }
    )
    expect(test.browser.launch).toHaveBeenCalledTimes(2)
    test.advance(86400000)
    expect((await test.create().handle(request('login/start', { projectId, ready: true }))).status).toBe(200)
  })

  it('refuses invalid projects, cleans up a bad Live View URL, and never leaks provider errors', async () => {
    const test = setup()
    const controller = test.create()
    expect((await controller.handle(request('login/start', { projectId: '../bad', ready: true }))).status).toBe(400)
    expect(test.browser.launch).not.toHaveBeenCalled()
    vi.mocked(test.browser.view).mockResolvedValue('https://attacker.example/ui/?secret')
    const result = await (await controller.handle(request('login/start', { projectId, ready: true }))).text()
    expect(result).toContain('LOGIN_VIEW_INVALID')
    expect(result).not.toContain('secret')
    expect(test.browser.close).toHaveBeenCalledOnce()
    expect(test.entries.has('login')).toBe(false)
  })

  it("cannot decrypt another identity's pending browser and cancels a browser when unlinking", async () => {
    const test = setup()
    const controller = test.create()
    await controller.handle(request('login/start', { projectId, ready: true }))
    expect((await test.create('owner-b').handle(request('login/finish', {}))).status).toBe(400)
    expect(test.browser.readSession).not.toHaveBeenCalled()
    await controller.handle(request('unlink', {}))
    expect(test.browser.close).toHaveBeenCalledOnce()
    expect(test.entries.has('login')).toBe(false)
  })
  it('automatically saves and closes within a check after sign-in, without a setup page request', async () => {
    const test = setup()
    test.browser.readSession.mockResolvedValueOnce(undefined)
    const controller = test.create()
    await controller.handle(request('login/start', { projectId, ready: true }))
    await controller.handle(request('login/watch', {}))
    test.advance(LOGIN_CHECK_MS)
    await test.create().alarm()
    expect(test.entries.has('session')).toBe(false)
    test.advance(LOGIN_CHECK_MS)
    test.browser.usage.mockResolvedValue({ durationMs: 9321 })
    await test.create().alarm()
    const status = await (await test.create().handle(request('status'))).json<Status>()
    expect(status.linked).toBe(true)
    expect(status.login).toBeUndefined()
    expect(status.usage).toMatchObject([
      { outcome: 'connected', completion: 'automatic', browserMs: 9321, timing: 'cloudflare', elapsedMs: 10000 },
    ])
    const reads = test.browser.readSession.mock.calls.length
    await test.create().alarm()
    expect(test.browser.readSession).toHaveBeenCalledTimes(reads)
    expect(test.browser.launch).toHaveBeenCalledOnce()
    // A simultaneous manual click is harmless after automatic completion.
    expect((await controller.handle(request('login/finish', {}))).status).toBe(200)
    expect(test.browser.close).toHaveBeenCalledOnce()
  })

  it('closes an unopened attempt without polling or consuming the full minute', async () => {
    const test = setup()
    await test.create().handle(request('login/start', { projectId, ready: true }))
    test.advance(LOGIN_OPEN_TIMEOUT_MS)
    await test.create().alarm()
    expect(test.browser.readSession).not.toHaveBeenCalled()
    const body = await (await test.create().handle(request('status'))).json<Status>()
    expect(body.usage).toMatchObject([{ outcome: 'not_opened', timing: 'estimated', elapsedMs: LOGIN_OPEN_TIMEOUT_MS }])
  })

  it('keeps an absolute deadline despite automatic checks and refreshed links', async () => {
    const test = setup()
    test.browser.readSession.mockResolvedValue(undefined)
    const controller = test.create()
    await controller.handle(request('login/start', { projectId, ready: true }))
    await controller.handle(request('login/watch', {}))
    test.advance(LOGIN_TIMEOUT_MS - 1000)
    await controller.alarm()
    expect(test.setAlarm).toHaveBeenLastCalledWith(Date.UTC(2026, 10, 23, 12) + LOGIN_TIMEOUT_MS)
    test.advance(1000)
    await controller.alarm()
    expect(test.browser.close).toHaveBeenCalledOnce()
    const body = await (await controller.handle(request('status'))).json<Status>()
    expect(body.usage[0]!.outcome).toBe('expired')
  })

  it('retries a failed manual completion close before expiry and retains its original outcome', async () => {
    const test = setup()
    const controller = test.create()
    await controller.handle(request('login/start', { projectId, ready: true }))
    test.advance(10000)
    test.browser.close.mockRejectedValueOnce(new Error('private provider message'))
    expect(await (await controller.handle(request('login/finish', {}))).json()).toMatchObject({
      code: 'LOGIN_CLOSE_PENDING',
    })
    let body = await (await controller.handle(request('status'))).json<Status>()
    expect(body.login?.closing).toBe(true)
    expect(body.linked).toBe(true)
    expect(body.usage).toEqual([])
    test.advance(LOGIN_CHECK_MS)
    await test.create().alarm()
    body = await (await controller.handle(request('status'))).json<Status>()
    expect(body.login).toBeUndefined()
    expect(body.usage).toMatchObject([{ outcome: 'connected', completion: 'manual', elapsedMs: 15000 }])
    expect(test.browser.readSession).toHaveBeenCalledOnce()
  })

  it('records launch and navigation failures without inventing zero usage or exposing credentials', async () => {
    const test = setup()
    test.browser.launch.mockImplementationOnce(async () => {
      test.advance(2000)
      throw new Error('private cookie/token')
    })
    const controller = test.create()
    expect((await controller.handle(request('login/start', { projectId, ready: true }))).status).toBe(400)
    let body = await (await controller.handle(request('status'))).json<Status>()
    expect(body.usage).toMatchObject([{ outcome: 'launch_failed', elapsedMs: 2000, timing: 'unavailable' }])
    expect(body.usage[0]!.browserMs).toBeUndefined()
    test.browser.view.mockRejectedValueOnce(new Error('private cookie/token'))
    expect((await controller.handle(request('login/start', { projectId, ready: true }))).status).toBe(400)
    body = await (await controller.handle(request('status'))).json<Status>()
    expect(body.usage[0]!.outcome).toBe('failed')
    expect(JSON.stringify(body)).not.toMatch(/private|sessionId|loginUrl/)
    expect(JSON.stringify([...test.entries])).not.toMatch(/launch_failed|private|connected/)
  })

  it('closes and records a failed automatic check without launching another browser', async () => {
    const test = setup()
    const controller = test.create()
    await controller.handle(request('login/start', { projectId, ready: true }))
    await controller.handle(request('login/watch', {}))
    test.browser.readSession.mockRejectedValueOnce(new Error('private remote response'))
    test.advance(LOGIN_CHECK_MS)
    await controller.alarm()
    const body = await (await controller.handle(request('status'))).json<Status>()
    expect(body.usage[0]!.outcome).toBe('failed')
    expect(test.entries.has('session')).toBe(false)
    expect(test.browser.launch).toHaveBeenCalledOnce()
  })

  it('retains every usage record across months and exports beyond the twenty displayed entries', async () => {
    const test = setup()
    for (let i = 0; i < 24; i++) {
      const controller = test.create()
      expect((await controller.handle(request('login/start', { projectId, ready: true }))).status).toBe(200)
      test.advance(1000)
      await controller.handle(request('login/cancel', {}))
      test.advance(86400000)
    }
    const controller = test.create()
    const status = await (await controller.handle(request('status'))).json<Status>()
    expect(status.usage).toHaveLength(20)
    const response = await controller.handle(request('login/history'))
    expect(response.headers.get('Content-Disposition')).toContain('overleaf-login-usage.json')
    const history = await response.json<{ sessions: LoginUsage[] }>()
    expect(history.sessions).toHaveLength(24)
    expect(new Set(history.sessions.map((item: { id: string }) => item.id)).size).toBe(24)
    await controller.handle(request('unlink', {}))
    expect(
      (await (await controller.handle(request('login/history'))).json<{ sessions: LoginUsage[] }>()).sessions
    ).toHaveLength(24)
    expect(JSON.stringify(history)).not.toMatch(/private|sessionId|loginUrl|projectId/)
  })

  it('treats provider usage lookup failures as estimates and still closes promptly', async () => {
    const test = setup()
    const controller = test.create()
    await controller.handle(request('login/start', { projectId, ready: true }))
    test.advance(2345)
    test.browser.usage.mockRejectedValueOnce(new Error('history unavailable'))
    await controller.handle(request('login/cancel', {}))
    const status = await (await controller.handle(request('status'))).json<Status>()
    expect(status.usage).toMatchObject([{ elapsedMs: 2345, timing: 'estimated', outcome: 'cancelled' }])
    expect(status.login).toBeUndefined()
  })
})

describe('hosted credential boundaries', () => {
  it('retains Overleaf cookies but excludes identity-provider and deceptive-domain cookies', async () => {
    const jar = await overleafCookies([
      cookie,
      { ...cookie, domain: '.google.com', name: 'google', value: 'private-google-cookie' },
      { ...cookie, domain: '.overleaf.com.attacker.example', name: 'bad' },
      { ...cookie, domain: 'www.overleaf.com', name: 'host-only' },
    ])
    const serialized = await jar.serialize()
    expect(serialized.cookies).toHaveLength(2)
    expect(serialized.cookies.find(c => c.key === 'host-only')?.hostOnly).toBe(true)
    expect(JSON.stringify(serialized)).not.toContain('private-google-cookie')
    expect(await jar.getCookieString('https://google.com')).toBe('')
  })
  it('accepts only HTTPS Cloudflare Live View links without URL credentials', () => {
    for (const value of [
      'http://live.browser.run/ui/view',
      'https://live.browser.run.attacker.example/ui/view',
      'https://attacker@live.browser.run/ui/view',
      'https://live.browser.run/other',
    ]) {
      expect(() => checkedLiveView(value)).toThrow('LOGIN_VIEW_INVALID')
    }
  })
})
