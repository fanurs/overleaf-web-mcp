import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { importSession } from '../src/cookies.js'

const source = (name: string) => readFileSync(new URL('../extension/' + name, import.meta.url), 'utf8')
const fixture = {
  name: 'fixture_session',
  value: 'synthetic-only',
  domain: '.overleaf.com',
  path: '/',
  hostOnly: false,
  httpOnly: true,
  session: true,
}

function helper() {
  const nodes = new Map<
    string,
    {
      value: string
      disabled: boolean
      textContent: string
      onclick?: (event: { isTrusted: boolean }) => Promise<void>
    }
  >()
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, { value: '', disabled: false, textContent: '' })
    return nodes.get(id)!
  }
  const chrome = {
    tabs: {
      query: vi.fn(async (query: { active?: boolean }) =>
        query.active
          ? [{ id: 1, url: 'https://www.overleaf.com/project/' + 'a'.repeat(24) }]
          : [{ id: 2, url: 'https://overleaf-mcp.fanurs.com/connect' }]
      ),
    },
    cookies: { getAll: vi.fn(async () => [fixture]) },
    scripting: { executeScript: vi.fn(async () => [{ result: true }]) },
  }
  const context = createContext({ chrome, document: { querySelector: node }, URL, Date, TextEncoder })
  runInContext(
    source('session.js').replaceAll('export ', '') + '\n' + source('popup.js').replace(/^import .*\n/u, ''),
    context
  )
  return { node, chrome, context }
}

describe('explicit session transfer', () => {
  it('has only the two required sites and no background transfer mechanism', () => {
    const manifest = JSON.parse(source('manifest.json'))
    expect(manifest.host_permissions).toEqual(['https://www.overleaf.com/*', 'https://overleaf-mcp.fanurs.com/*'])
    expect(manifest.permissions).toEqual(['cookies', 'scripting'])
    expect(manifest.background).toBeUndefined()
    expect(manifest.content_scripts).toBeUndefined()
    expect(manifest.externally_connectable).toBeUndefined()
  })

  it('reads no cookies on load or synthetic clicks, checks setup first, and uploads only on an explicit click', async () => {
    const test = helper()
    await vi.waitFor(() => expect(test.node('#project').value).toContain('/project/'))
    expect(test.chrome.cookies.getAll).not.toHaveBeenCalled()
    await test.node('#connect').onclick!({ isTrusted: false })
    expect(test.chrome.scripting.executeScript).not.toHaveBeenCalled()
    await test.node('#connect').onclick!({ isTrusted: true })
    expect(test.chrome.cookies.getAll).toHaveBeenCalledWith({ url: 'https://www.overleaf.com/project' })
    expect(test.chrome.scripting.executeScript.mock.invocationCallOrder[0]).toBeLessThan(
      test.chrome.cookies.getAll.mock.invocationCallOrder[0]!
    )
    expect(test.chrome.scripting.executeScript).toHaveBeenCalledTimes(2)
    expect(test.node('#status').textContent).toContain('not yet verified')
    expect(test.node('#status').textContent).not.toContain(fixture.value)
  })

  it('does not read cookies if setup authentication is missing', async () => {
    const test = helper()
    await vi.waitFor(() => expect(test.node('#project').value).toContain('/project/'))
    test.chrome.scripting.executeScript.mockResolvedValue([{ result: false }])
    await test.node('#connect').onclick!({ isTrusted: true })
    expect(test.chrome.cookies.getAll).not.toHaveBeenCalled()
    expect(test.node('#status').textContent).toContain('sign into it')
  })

  it('round trips HttpOnly cookies through the real importer and excludes foreign domains and injected lines', async () => {
    const test = helper()
    test.context.inputCookies = [
      fixture,
      { ...fixture, domain: '.google.com' },
      { ...fixture, domain: '.overleaf.com.attacker.example' },
      { ...fixture, name: 'bad\nline' },
    ]
    const text = runInContext('sessionText(inputCookies)', test.context) as string
    const jar = await importSession(text)
    const cookies = await jar.getCookies('https://www.overleaf.com')
    expect(cookies).toHaveLength(1)
    expect(cookies[0]?.httpOnly).toBe(true)
    expect(await jar.getCookieString('https://google.com')).toBe('')
  })

  it('refuses to upload after navigation to another site and rejects redirects', async () => {
    const test = helper()
    const fetch = vi.fn(async () => Response.json({ linked: true }))
    test.context.fetch = fetch
    test.context.location = { origin: 'https://other.example', pathname: '/connect' }
    expect(await runInContext("uploadSession('fixture','project')", test.context)).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    test.context.location = { origin: 'https://overleaf-mcp.fanurs.com', pathname: '/connect' }
    expect(await runInContext("uploadSession('fixture','project')", test.context)).toBe(true)
    expect(fetch).toHaveBeenCalledWith(
      '/api/link',
      expect.objectContaining({ redirect: 'error', credentials: 'same-origin' })
    )
  })
})
