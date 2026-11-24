export function parseProject(value) {
  const url = new URL(value)
  const match = /^\/project\/([a-f0-9]{24})\/?$/u.exec(url.pathname)
  if (url.origin !== 'https://www.overleaf.com' || url.username || url.password || !match) {
    throw new Error('PROJECT_INVALID')
  }
  return match[1]
}

export function sessionText(cookies) {
  const lines = ['# Netscape HTTP Cookie File']
  for (const cookie of cookies) {
    if (!['overleaf.com', 'www.overleaf.com'].includes(cookie.domain.replace(/^\./u, ''))) continue
    if (!cookie.name || !cookie.path.startsWith('/') || /[\r\n\t]/u.test(cookie.name + cookie.value + cookie.path)) {
      continue
    }
    const expires = cookie.session ? 0 : Math.floor(cookie.expirationDate)
    if (!Number.isFinite(expires) || expires < 0 || (!cookie.session && expires <= Date.now() / 1000)) continue
    const domain = (cookie.httpOnly ? '#HttpOnly_' : '') + cookie.domain
    lines.push(
      [domain, cookie.hostOnly ? 'FALSE' : 'TRUE', cookie.path, 'TRUE', expires, cookie.name, cookie.value].join('\t')
    )
  }
  if (lines.length === 1) throw new Error('SESSION_EMPTY')
  const text = lines.join('\n') + '\n'
  if (new TextEncoder().encode(text).length > 65536) throw new Error('SESSION_TOO_LARGE')
  return text
}

// Fixed functions executed in the authenticated setup tab's isolated extension world.
// No page script can request a transfer, choose a destination, or receive cookie values.
export async function inspectSetup() {
  if (location.origin !== 'https://overleaf-mcp.fanurs.com' || location.pathname !== '/connect') return false
  try {
    const response = await fetch('/api/status', { credentials: 'same-origin', redirect: 'error', cache: 'no-store' })
    if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) return false
    const value = await response.json()
    return value.mode === 'read-only-probe'
  } catch {
    return false
  }
}

export async function uploadSession(cookies, projectId) {
  if (location.origin !== 'https://overleaf-mcp.fanurs.com' || location.pathname !== '/connect') return false
  try {
    const response = await fetch('/api/link', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Overleaf-Setup': '1' },
      body: JSON.stringify({ cookies, projectId }),
    })
    if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) return false
    return (await response.json()).linked === true
  } catch {
    return false
  }
}
