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
function page(initial: object, probeResult?: object) {
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
    if (path === '/api/probe') return Response.json(probeResult)
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
    window: { open: vi.fn(), addEventListener: vi.fn() },
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
  it('opens preparation without allocating a browser or starting a timer and keeps manual completion', async () => {
    const test = page({ linked: false, usage: [] })
    await vi.waitFor(() => expect(test.node('#result').textContent).toContain('not connected'))
    test.node('#project').value = 'https://www.overleaf.com/project/' + 'a'.repeat(24)
    await test.node('#start').onclick!()
    expect(test.fetch.mock.calls.map(call => call[0])).toEqual(['/api/status', '/api/status'])
    expect(test.clocks).toHaveLength(0)
    expect(test.node('#result').textContent).toContain('No cloud browser starts')
    expect(SETUP_HTML).toContain('id="finish">Finish connecting')
    expect(SETUP_HTML).toContain('60 seconds total')
    expect(SETUP_HTML).not.toContain('four minutes')
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
    expect(test.node('#usage-summary').textContent).toContain('12.0 s reported by Cloudflare')
    expect(test.node('#result').textContent).toContain('Click Test connection')
  })

  it('shows a saved helper session instead of an old expired cloud attempt', async () => {
    const test = page({
      linked: true,
      usage: [{ startedAt: Date.now(), elapsedMs: 240000, timing: 'estimated', outcome: 'expired' }],
    })
    await vi.waitFor(() => expect(test.node('#result').textContent).toContain('Overleaf session saved'))
    expect(test.node('#usage-summary').textContent).toContain('240.0 s estimated')
  })

  it('explains a successful read that used an existing document without changing project settings', async () => {
    const test = page(
      { linked: true, usage: [] },
      {
        authenticated: true,
        projectJoined: true,
        documentRead: true,
        characters: 19,
        protocol: 'sharejs',
        documentSelection: 'project_document',
      }
    )
    await vi.waitFor(() => expect(test.node('#result').textContent).toContain('Overleaf session saved'))
    await test.node('#probe').onclick!()
    expect(test.node('#result').textContent).toContain('Connection verified')
    expect(test.node('#result').textContent).toContain('read another existing text document')
    expect(test.fetch.mock.calls.map(call => call[0]).filter(path => path !== '/api/status')).toEqual(['/api/probe'])
    expect(test.clocks).toHaveLength(0)
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
