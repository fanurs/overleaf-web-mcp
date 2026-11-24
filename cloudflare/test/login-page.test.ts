import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { LOGIN_HTML, LOGIN_JS } from '../src/login-page.js'

function setup() {
  const nodes = new Map<
    string,
    { disabled: boolean; textContent: string; onclick?: (event: { isTrusted: boolean }) => Promise<void> }
  >()
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, { disabled: false, textContent: '' })
    return nodes.get(id)!
  }
  const listeners = new Map<string, () => void>()
  const document = {
    querySelector: node,
    visibilityState: 'visible',
    hasFocus: () => true,
    addEventListener: (key: string, fn: () => void) => listeners.set(key, fn),
  }
  const location = { href: 'https://overleaf-mcp.fanurs.com/connect/login?project=' + 'a'.repeat(24), replace: vi.fn() }
  const fetch = vi.fn(async (path: string) =>
    Response.json(
      path === '/api/login/start'
        ? { loginUrl: 'https://live.browser.run/ui/fixture', expiresAt: Date.now() + 60000 }
        : {}
    )
  )
  runInContext(
    LOGIN_JS,
    createContext({
      document,
      location,
      URL,
      performance: { now: () => 0 },
      fetch,
      setInterval: () => 1,
      clearInterval: () => {},
      window: { addEventListener: document.addEventListener },
    })
  )
  return { node, document, location, fetch, listeners }
}

describe('untimed preparation', () => {
  it('does no work on load or a synthetic click and refuses a hidden or unfocused start', async () => {
    const test = setup()
    expect(test.fetch).not.toHaveBeenCalled()
    await test.node('#begin').onclick!({ isTrusted: false })
    test.document.visibilityState = 'hidden'
    await test.node('#begin').onclick!({ isTrusted: true })
    test.document.visibilityState = 'visible'
    test.document.hasFocus = () => false
    await test.node('#begin').onclick!({ isTrusted: true })
    expect(test.fetch).not.toHaveBeenCalled()
    expect(LOGIN_HTML).toContain('60 seconds total, including startup')
  })

  it('starts only on an explicit foreground click and hands off in the same tab', async () => {
    const test = setup()
    await test.node('#begin').onclick!({ isTrusted: true })
    expect(test.fetch.mock.calls.map(call => call[0])).toEqual(['/api/login/start', '/api/login/watch'])
    expect(test.location.replace).toHaveBeenCalledWith('https://live.browser.run/ui/fixture')
    test.listeners.get('pagehide')!()
    expect(test.fetch).toHaveBeenCalledTimes(2)
    await test.node('#begin').onclick!({ isTrusted: true })
    expect(test.fetch).toHaveBeenCalledTimes(2)
  })

  it('cancels if the user switches away during startup and never retries or opens Live View', async () => {
    const test = setup()
    let finish!: (response: Response) => void
    test.fetch.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const starting = test.node('#begin').onclick!({ isTrusted: true })
    test.document.visibilityState = 'hidden'
    test.listeners.get('visibilitychange')!()
    finish(Response.json({ loginUrl: 'https://live.browser.run/ui/fixture' }))
    await starting
    expect(test.fetch.mock.calls.filter(call => call[0] === '/api/login/start')).toHaveLength(1)
    expect(test.fetch.mock.calls.some(call => call[0] === '/api/login/cancel')).toBe(true)
    expect(test.fetch.mock.calls.some(call => call[0] === '/api/login/watch')).toBe(false)
    expect(test.location.replace).not.toHaveBeenCalled()
  })
})
