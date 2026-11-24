import { createContext, runInContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

import { SETUP_HTML, SETUP_JS } from '../src/page.js'

class Element {
  textContent = ''
  value = ''
  hidden = false
  disabled = false
  href = ''
  children: Element[] = []
  onclick?: () => Promise<void>
  append(element: Element) {
    this.children.push(element)
  }
  replaceChildren() {
    this.children = []
  }
  removeAttribute(name: string) {
    if (name === 'href') this.href = ''
  }
}
function page(initial: object) {
  const nodes = new Map<string, Element>()
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new Element())
    return nodes.get(id)!
  }
  let status = initial
  let now = 0
  const timers: Array<() => Promise<void>> = []
  const clocks: Array<() => void> = []
  const fetch = vi.fn(async (path: string, options: { body?: string }) => {
    if (path === '/api/status') return Response.json(status)
    if (path === '/api/login/start') {
      expect(JSON.parse(options.body!)).toEqual({ projectId: 'a'.repeat(24) })
      status = { linked: false, usage: [], login: { elapsedMs: 2500, expiresAt: Date.now() + 237500, watching: false } }
      return Response.json({
        loginUrl: 'https://live.browser.run/ui/view?private-fixture',
        expiresAt: Date.now() + 237500,
      })
    }
    return Response.json({ watching: true })
  })
  const context = createContext({
    document: { querySelector: node, querySelectorAll: () => [], createElement: () => new Element() },
    URL,
    Date,
    performance: { now: () => now },
    fetch,
    setTimeout: (fn: () => Promise<void>) => {
      timers.push(fn)
      return timers.length
    },
    clearTimeout: () => {},
    setInterval: (fn: () => void) => {
      clocks.push(fn)
      return clocks.length
    },
    clearInterval: () => {},
  })
  runInContext(SETUP_JS, context)
  return {
    node,
    fetch,
    timers,
    clocks,
    setStatus: (value: object) => {
      status = value
    },
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('browser-only setup page', () => {
  it('starts no browser on load, begins automatic checks only when its login link is opened, and keeps manual completion', async () => {
    const test = page({ linked: false, usage: [] })
    await vi.waitFor(() => expect(test.node('#result').textContent).toContain('not connected'))
    expect(test.fetch.mock.calls.map(call => call[0])).toEqual(['/api/status', '/api/status'])
    test.node('#project').value = 'https://www.overleaf.com/project/' + 'a'.repeat(24)
    await test.node('#start').onclick!()
    expect(test.node('#elapsed').textContent).toContain('2.5 s')
    expect(test.node('#login-view').href).toContain('private-fixture')
    await test.timers.at(-1)!()
    expect(test.node('#result').textContent).toBe('Click Open Overleaf sign-in window now.')
    expect(test.fetch.mock.calls.some(call => call[0] === '/api/login/watch')).toBe(false)
    await test.node('#login-view').onclick!()
    expect(test.fetch.mock.calls.some(call => call[0] === '/api/login/watch')).toBe(true)
    expect(SETUP_HTML).toContain('id="finish">Finish connecting')
  })

  it('restores a running timer from server elapsed time and removes the credential link on automatic closure', async () => {
    const test = page({
      linked: false,
      usage: [],
      login: { elapsedMs: 10000, expiresAt: Date.now() + 100000, watching: true },
    })
    await vi.waitFor(() => expect(test.clocks).toHaveLength(1))
    test.advance(2200)
    test.clocks[0]!()
    expect(test.node('#elapsed').textContent).toContain('12.2 s')
    test.setStatus({
      linked: true,
      usage: [
        {
          startedAt: Date.now(),
          browserMs: 12000,
          elapsedMs: 12800,
          timing: 'cloudflare',
          outcome: 'connected',
          completion: 'automatic',
        },
      ],
    })
    await vi.waitFor(() => expect(test.timers.length).toBeGreaterThan(0))
    await test.timers.at(-1)!()
    expect(test.node('#login-panel').hidden).toBe(true)
    expect(test.node('#login-view').href).toBe('')
    expect(test.node('#usage-summary').textContent).toContain('12.0 s reported by Cloudflare')
    expect(test.node('#result').textContent).toContain('Click Test connection')
  })

  it('labels missing launch measurements as unknown, not zero browser time', async () => {
    const test = page({
      linked: false,
      usage: [{ startedAt: Date.now(), elapsedMs: 600, timing: 'unavailable', outcome: 'launch_failed' }],
    })
    await vi.waitFor(() => expect(test.node('#usage-summary').textContent).toContain('unknown'))
    expect(test.node('#usage-summary').textContent).toContain('0.6 s elapsed')
    expect(test.node('#usage').children[0]!.children[1]!.textContent).toBe('Unknown (0.6 s elapsed)')
  })
})
