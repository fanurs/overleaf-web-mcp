import { Cookie, CookieJar } from 'tough-cookie'

import { parseNetscapeCookies } from '../../src/http/cookies.js'

export const OVERLEAF_ORIGIN = 'https://www.overleaf.com'

/** Accept only cookies for the fixed Overleaf origin, not an arbitrary uploaded cookie collection. */
export async function importSession(text: string): Promise<CookieJar> {
  if (new TextEncoder().encode(text).byteLength > 65536) throw new Error('SESSION_TOO_LARGE')
  const imported = await parseNetscapeCookies(text)
  const jar = new CookieJar()
  for (const cookie of await imported.getCookies(OVERLEAF_ORIGIN)) {
    if (cookie.domain !== 'overleaf.com' && cookie.domain !== 'www.overleaf.com') continue
    cookie.secure = true
    await jar.setCookie(cookie, OVERLEAF_ORIGIN)
  }
  if ((await jar.getCookies(OVERLEAF_ORIGIN)).length === 0) throw new Error('SESSION_EMPTY')
  return jar
}

export async function mergeCookies(jar: CookieJar, url: string, values: string[]): Promise<void> {
  if (new URL(url).origin !== OVERLEAF_ORIGIN) throw new Error('COOKIE_ORIGIN_REFUSED')
  for (const value of values) {
    const cookie = Cookie.parse(value)
    if (!cookie) continue
    // Freeze Max-Age at arrival; reading the jar must not extend a cookie's lifetime.
    if (typeof cookie.maxAge === 'number' && cookie.maxAge > 0) {
      cookie.expires = new Date(Math.min(Date.now() + cookie.maxAge * 1000, 8.64e15))
      cookie.maxAge = null
    }
    await jar.setCookie(cookie, url)
  }
}
