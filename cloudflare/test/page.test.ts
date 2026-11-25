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
  const status = initial
  const timers: Array<() => Promise<void>> = []
  const clocks: Array<() => void> = []
  const fetch = vi.fn(async (path: string) => {
    if (path === '/api/status') return Response.json(status)
    if (path === '/api/probe') return Response.json(probeResult)
    throw new Error('Unexpected request: ' + path)
  })
  const context = createContext({
    document: { querySelector: node, querySelectorAll: () => [], createElement: () => new Element() },
    window: { open: vi.fn(), addEventListener: vi.fn() },
    URL,
    Date,
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
  }
}

describe('helper-only setup page', () => {
  it('ignores legacy pending login state without polling, timers or launch controls', async () => {
    const test = page({
      linked: true,
      usage: [],
      login: { elapsedMs: 10000, expiresAt: Date.now() + 100000, watching: true },
    })
    await vi.waitFor(() => expect(test.node('#result').textContent).toContain('Overleaf session saved'))
    expect(test.fetch.mock.calls.map(call => call[0])).toEqual(['/api/status', '/api/status'])
    expect(test.clocks).toHaveLength(0)
    expect(test.timers).toHaveLength(0)
    expect(SETUP_HTML).toContain('can no longer launch cloud browsers')
    expect(SETUP_HTML).toContain('Download complete time log')
    expect(SETUP_HTML).not.toContain('id="start"')
    expect(SETUP_HTML).not.toContain('id="finish"')
    expect(SETUP_HTML).not.toContain('/connect/login')
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
