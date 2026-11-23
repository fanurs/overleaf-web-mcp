import { describe, expect, it, vi } from 'vitest'

import { checkedLiveView, overleafCookies, type HostedBrowser } from '../src/hosted-browser.js'
import { LOGIN_TIMEOUT_MS } from '../src/hosted-login.js'
import type { EncryptedSession } from '../src/crypto.js'
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
  it('persists an encrypted pending login across recreation, then saves cookies and closes the browser', async () => {
    const test = setup()
    const initial = await test.create().handle(request('login/start', { projectId }))
    const body = await initial.json<{ loginUrl: string; expiresAt: number }>()
    expect(body.loginUrl).toMatch(/^https:\/\/live.browser.run\/ui\//)
    expect(test.setAlarm).toHaveBeenCalledWith(body.expiresAt)
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
    await controller.handle(request('login/start', { projectId }))
    expect(await (await controller.handle(request('login/finish', {}))).json()).toMatchObject({
      code: 'LOGIN_NOT_FINISHED',
    })
    expect(test.entries.has('session')).toBe(false)
    expect(test.browser.close).not.toHaveBeenCalled()
  })

  it('does not extend the deadline or create a second browser when refreshing its link', async () => {
    const test = setup()
    const controller = test.create()
    const first = await (await controller.handle(request('login/start', { projectId }))).json<{ expiresAt: number }>()
    test.advance(20000)
    const second = await (await controller.handle(request('login/start', { projectId }))).json<{ expiresAt: number }>()
    expect(first.expiresAt).toBe(second.expiresAt)
    expect(test.browser.launch).toHaveBeenCalledOnce()
    expect(await (await controller.handle(request('login/start', { projectId: 'b'.repeat(24) }))).json()).toMatchObject(
      { code: 'LOGIN_PROJECT_CHANGED' }
    )
  })

  it('closes at the absolute deadline even after object recreation', async () => {
    const test = setup()
    await test.create().handle(request('login/start', { projectId }))
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
    await controller.handle(request('login/start', { projectId }))
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
      expect((await controller.handle(request('login/start', { projectId }))).status).toBe(200)
      await controller.handle(request('login/cancel', {}))
    }
    expect(await (await test.create().handle(request('login/start', { projectId }))).json()).toMatchObject({
      code: 'LOGIN_DAILY_LIMIT',
    })
    expect(test.browser.launch).toHaveBeenCalledTimes(2)
    test.advance(86400000)
    expect((await test.create().handle(request('login/start', { projectId }))).status).toBe(200)
  })

  it('refuses invalid projects, cleans up a bad Live View URL, and never leaks provider errors', async () => {
    const test = setup()
    const controller = test.create()
    expect((await controller.handle(request('login/start', { projectId: '../bad' }))).status).toBe(400)
    expect(test.browser.launch).not.toHaveBeenCalled()
    vi.mocked(test.browser.view).mockResolvedValue('https://attacker.example/ui/?secret')
    const result = await (await controller.handle(request('login/start', { projectId }))).text()
    expect(result).toContain('LOGIN_VIEW_INVALID')
    expect(result).not.toContain('secret')
    expect(test.browser.close).toHaveBeenCalledOnce()
    expect(test.entries.has('login')).toBe(false)
  })

  it("cannot decrypt another identity's pending browser and cancels a browser when unlinking", async () => {
    const test = setup()
    const controller = test.create()
    await controller.handle(request('login/start', { projectId }))
    expect((await test.create('owner-b').handle(request('login/finish', {}))).status).toBe(400)
    expect(test.browser.readSession).not.toHaveBeenCalled()
    await controller.handle(request('unlink', {}))
    expect(test.browser.close).toHaveBeenCalledOnce()
    expect(test.entries.has('login')).toBe(false)
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
