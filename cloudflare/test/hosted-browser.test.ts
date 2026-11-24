import puppeteer, { type Browser, type BrowserWorker } from '@cloudflare/puppeteer'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CloudflareHostedBrowser } from '../src/hosted-browser.js'

const binding = { fetch: vi.fn() } as unknown as BrowserWorker

afterEach(() => vi.restoreAllMocks())

describe('Cloudflare hosted browser boundary', () => {
  it('prepares a fresh empty session and disconnects without closing the owner login window', async () => {
    const page = {
      url: () => 'about:blank',
      goto: vi.fn(),
      createCDPSession: vi.fn(async () => ({
        send: async () => ({ devtoolsFrontendUrl: 'https://live.browser.run/ui/view?private-fixture' }),
      })),
    }
    const browser = { pages: async () => [], newPage: vi.fn(async () => page), disconnect: vi.fn(), close: vi.fn() }
    vi.spyOn(puppeteer, 'connect').mockResolvedValue(browser as unknown as Browser)
    const client = new CloudflareHostedBrowser(binding)
    expect(await client.view('private-browser-id')).toMatch(/^https:\/\/live.browser.run\/ui\//)
    expect(browser.newPage).toHaveBeenCalledOnce()
    expect(page.goto).toHaveBeenCalledWith(
      'https://www.overleaf.com/login',
      expect.objectContaining({ timeout: 20000 })
    )
    expect(browser.disconnect).toHaveBeenCalledOnce()
    expect(browser.close).not.toHaveBeenCalled()
  })

  it('uses only completed provider timings for its own session, without exposing account history', async () => {
    const history = vi.spyOn(puppeteer, 'history')
    const client = new CloudflareHostedBrowser(binding)
    history.mockResolvedValue([
      { sessionId: 'unrelated', startTime: 1, endTime: 999 },
      { sessionId: 'owner', startTime: 1000, endTime: 3456, devtoolsFrontendUrl: 'private-control-url' },
    ])
    expect(await client.usage('owner')).toEqual({ durationMs: 2456 })
    history.mockResolvedValue([{ sessionId: 'owner', startTime: 1000 }])
    expect(await client.usage('owner')).toBeUndefined()
    history.mockResolvedValue([{ sessionId: 'owner', startTime: 1000, endTime: 1 }])
    expect(await client.usage('owner')).toBeUndefined()
  })
})
