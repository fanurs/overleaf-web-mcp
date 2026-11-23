import puppeteer, { type BrowserWorker } from '@cloudflare/puppeteer'
import { Cookie, CookieJar } from 'tough-cookie'

import { OVERLEAF_ORIGIN } from './cookies.js'

export interface HostedBrowser {
  launch(): Promise<string>
  view(sessionId: string): Promise<string>
  readSession(sessionId: string): Promise<CookieJar | undefined>
  close(sessionId: string): Promise<void>
}

interface BrowserCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expires: number
}

/** This boundary excludes Google/SSO cookies even if a provider returns extra cookies. */
export async function overleafCookies(cookies: BrowserCookie[]): Promise<CookieJar> {
  const jar = new CookieJar()
  for (const item of cookies) {
    const domain = item.domain.replace(/^\./u, '')
    if (domain !== 'overleaf.com' && domain !== 'www.overleaf.com') continue
    if (!item.name || /[\r\n\t]/u.test(item.name + item.value)) continue
    const cookie = new Cookie({
      key: item.name,
      value: item.value,
      domain,
      hostOnly: !item.domain.startsWith('.'),
      path: item.path || '/',
      secure: true,
      httpOnly: item.httpOnly,
      expires: item.expires > 0 ? new Date(item.expires * 1000) : 'Infinity',
    })
    await jar.setCookie(cookie, OVERLEAF_ORIGIN)
  }
  if (!(await jar.getCookies(OVERLEAF_ORIGIN)).length) throw new Error('SESSION_EMPTY')
  if (new TextEncoder().encode(JSON.stringify(await jar.serialize())).length > 65536) {
    throw new Error('SESSION_TOO_LARGE')
  }
  return jar
}

export function checkedLiveView(value: string): string {
  const url = new URL(value)
  if (url.origin !== 'https://live.browser.run' || !url.pathname.startsWith('/ui/') || url.username || url.password) {
    throw new Error('LOGIN_VIEW_INVALID')
  }
  return url.href
}

/** Dedicated cloud browsers only; never attaches to the user's ordinary browser. */
export class CloudflareHostedBrowser implements HostedBrowser {
  constructor(private readonly binding: BrowserWorker) {}

  async launch(): Promise<string> {
    const browser = await puppeteer.launch(this.binding, { keep_alive: 60000, recording: false })
    try {
      const page = (await browser.pages())[0] ?? (await browser.newPage())
      await page.goto(`${OVERLEAF_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 })
      return browser.sessionId()
    } catch (error) {
      await browser.close()
      throw error
    } finally {
      await browser.disconnect()
    }
  }

  async view(sessionId: string): Promise<string> {
    const browser = await puppeteer.connect(this.binding, sessionId)
    try {
      const page = (await browser.pages())[0]
      if (!page) throw new Error('LOGIN_BROWSER_CLOSED')
      const cdp = await page.createCDPSession()
      const { devtoolsFrontendUrl } = await cdp.send('Cloudflare.getLiveView', {
        mode: 'full',
        expiresInMs: 60000,
      })
      return checkedLiveView(devtoolsFrontendUrl)
    } finally {
      await browser.disconnect()
    }
  }

  async readSession(sessionId: string): Promise<CookieJar | undefined> {
    const browser = await puppeteer.connect(this.binding, sessionId)
    try {
      for (const page of await browser.pages()) {
        const url = new URL(page.url())
        if (url.origin !== OVERLEAF_ORIGIN || !/^\/project(?:\/|$)/u.test(url.pathname)) continue
        // Only a boolean leaves the page. Neither CSRF tokens nor page contents are returned.
        const signedIn = await page.evaluate(
          () => !!document.querySelector('meta[name="ol-csrfToken"]')?.getAttribute('content')
        )
        if (!signedIn) continue
        const cdp = await page.createCDPSession()
        const { cookies } = await cdp.send('Network.getCookies', { urls: [`${OVERLEAF_ORIGIN}/project`] })
        return await overleafCookies(cookies)
      }
      return undefined
    } finally {
      await browser.disconnect()
    }
  }

  async close(sessionId: string): Promise<void> {
    try {
      const browser = await puppeteer.connect(this.binding, sessionId)
      try {
        await browser.close()
      } finally {
        await browser.disconnect()
      }
    } catch (error) {
      // A browser that already expired is closed. A network failure must retain cleanup state.
      if ((await puppeteer.sessions(this.binding)).some(session => session.sessionId === sessionId)) throw error
    }
  }
}
