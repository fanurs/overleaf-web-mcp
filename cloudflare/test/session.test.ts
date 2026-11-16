import { describe, expect, it, vi } from 'vitest'

import { importSession, mergeCookies } from '../src/cookies.js'
import type { EncryptedSession } from '../src/crypto.js'
import type { runProbe } from '../src/probe.js'
import { SessionController, type SessionStorage } from '../src/session.js'

const fixture =
  '# Netscape HTTP Cookie File\n.overleaf.com\tTRUE\t/\tTRUE\t4102444800\tfixture_session\tprivate-fixture-value\n'
const projectId = '000000000000000000000001'
const request = (path: string, body?: unknown) =>
  new Request(`https://app.example/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

function memoryStorage(): SessionStorage {
  const entries = new Map<string, EncryptedSession>()
  return {
    get: async key => entries.get(key),
    put: async (key, value) => {
      entries.set(key, structuredClone(value))
    },
    delete: async key => entries.delete(key),
  }
}

describe('session lifecycle', () => {
  it('survives object recreation, stores encrypted cookies, and unlinks', async () => {
    const storage = memoryStorage()
    const probe = vi.fn<typeof runProbe>(async () => ({
      authenticated: true,
      projectJoined: true,
      documentRead: true,
      characters: 12,
      protocol: 'sharejs',
    }))
    const controller = new SessionController(storage, 'ab'.repeat(32), 'owner-a', probe)
    expect(await (await controller.handle(request('status'))).json()).toMatchObject({ linked: false })
    expect(await (await controller.handle(request('link', { cookies: fixture, projectId }))).json()).toMatchObject({
      linked: true,
      verified: false,
    })
    expect(JSON.stringify(await storage.get('session'))).not.toContain('private-fixture-value')
    const restored = new SessionController(storage, 'ab'.repeat(32), 'owner-a', probe)
    expect(await (await restored.handle(request('probe', {}))).json()).toMatchObject({
      documentRead: true,
      characters: 12,
    })
    expect(probe).toHaveBeenCalledOnce()
    expect(probe.mock.calls[0]?.[1]).toBe(projectId)
    await restored.handle(request('unlink', {}))
    expect((await restored.handle(request('probe', {}))).status).toBe(409)
  })
  it('sanitizes failure messages and does not retry a probe', async () => {
    const probe = vi.fn(async () => {
      throw new Error('private-fixture-value and private document text')
    })
    const controller = new SessionController(memoryStorage(), 'ab'.repeat(32), 'owner-a', probe)
    await controller.handle(request('link', { cookies: fixture, projectId }))
    const result = await (await controller.handle(request('probe', {}))).text()
    expect(result).not.toContain('private')
    expect(result).toContain('PROBE_FAILED')
    expect(probe).toHaveBeenCalledOnce()
  })
  it('serializes unlink behind an active read so a refresh cannot restore a removed session', async () => {
    const storage = memoryStorage()
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>(resolve => {
      started = resolve
    })
    const blocked = new Promise<void>(resolve => {
      release = resolve
    })
    const controller = new SessionController(storage, 'ab'.repeat(32), 'owner-a', async () => {
      started()
      await blocked
      return { authenticated: true, projectJoined: true, documentRead: true, characters: 0, protocol: 'sharejs' }
    })
    await controller.handle(request('link', { cookies: fixture, projectId }))
    const reading = controller.handle(request('probe', {}))
    await entered
    const unlinking = controller.handle(request('unlink', {}))
    release()
    await Promise.all([reading, unlinking])
    expect(await storage.get('session')).toBeUndefined()
  })
  it('rejects a path-like project ID before saving a session', async () => {
    const storage = memoryStorage()
    const controller = new SessionController(storage, 'ab'.repeat(32), 'owner-a')
    expect((await controller.handle(request('link', { cookies: fixture, projectId: '../other' }))).status).toBe(400)
    expect(await storage.get('session')).toBeUndefined()
  })
})

describe('cookie scope', () => {
  it('imports only Overleaf cookies and preserves absolute expiry', async () => {
    const jar = await importSession(fixture + '.example.com\tTRUE\t/\tTRUE\t4102444800\tother\tother-value\n')
    expect(await jar.getCookieString('https://example.com')).toBe('')
    expect(await jar.getCookieString('https://www.overleaf.com')).toContain('fixture_session=')
    await mergeCookies(jar, 'https://www.overleaf.com/project', ['renewed=fixture; Secure; Path=/; Max-Age=60'])
    const cookie = (await jar.getCookies('https://www.overleaf.com')).find(item => item.key === 'renewed')!
    const deadline = cookie.expiryTime()
    cookie.lastAccessed = new Date(Date.now() + 30000)
    expect(cookie.expiryTime()).toBe(deadline)
  })
  it('rejects empty, oversized and foreign-only jars', async () => {
    await expect(importSession('')).rejects.toThrow('SESSION_EMPTY')
    await expect(importSession('x'.repeat(65537))).rejects.toThrow('SESSION_TOO_LARGE')
    await expect(importSession('.example.com\tTRUE\t/\tTRUE\t4102444800\tother\tfixture\n')).rejects.toThrow(
      'SESSION_EMPTY'
    )
  })
})
