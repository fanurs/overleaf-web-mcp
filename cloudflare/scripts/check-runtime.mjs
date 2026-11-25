import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'

// Exercise the production bundle in workerd without an account or a real session.
const origin = 'https://overleaf.example'
const issuer = 'https://fixture.cloudflareaccess.com'
const { publicKey, privateKey } = await generateKeyPair('RS256')
const keys = { keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'fixture' }] }
let keyRequests = 0
const options = {
  cf: false,
  modules: true,
  scriptPath: fileURLToPath(new URL('../dist/worker.js', import.meta.url)),
  compatibilityDate: '2026-11-16',
  compatibilityFlags: ['nodejs_compat'],
  durableObjects: { SESSIONS: { className: 'OverleafSession', useSQLite: true } },
  outboundService(request) {
    assert.equal(request.url, `${issuer}/cdn-cgi/access/certs`, 'Unexpected outbound request')
    keyRequests++
    return Response.json(keys)
  },
}

async function token(subject, audience = 'app-a') {
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

function createRuntime(value) {
  return new Miniflare({ ...convertV4MiniflareOptions(value), telemetry: { enabled: false } })
}

const unconfigured = createRuntime(options)
try {
  assert.equal((await unconfigured.dispatchFetch(`${origin}/connect`)).status, 503)
} finally {
  await unconfigured.dispose()
}

const runtime = createRuntime({
  ...options,
  bindings: {
    CF_ACCESS_TEAM_DOMAIN: 'fixture.cloudflareaccess.com',
    CF_ACCESS_AUD: 'app-a',
    SESSION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  },
})

try {
  const ownerA = await token('owner-a')
  const ownerB = await token('owner-b')
  async function request(path, assertion, body, requestOrigin = origin) {
    return await runtime.dispatchFetch(`${origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(assertion ? { 'Cf-Access-Jwt-Assertion': assertion } : {}),
        ...(body === undefined
          ? {}
          : { Origin: requestOrigin, 'Content-Type': 'application/json', 'X-Overleaf-Setup': '1' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  async function json(path, assertion, body, status = 200, requestOrigin = origin) {
    const response = await request(path, assertion, body, requestOrigin)
    assert.equal(response.status, status, path)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    return await response.json()
  }

  assert.equal((await request('/connect')).status, 401)
  assert.equal((await request('/connect', await token('owner-a', 'wrong-app'))).status, 401)
  const page = await request('/connect', ownerA)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/u)
  assert.match(await page.text(), /Overleaf connection/u)
  assert.match(await (await request('/setup.js', ownerA)).text(), /api\/status/u)
  for (const path of ['/connect/login', '/login.js']) {
    assert.equal((await request(path)).status, 401)
    assert.equal((await json(path, ownerA, undefined, 410)).code, 'HOSTED_LOGIN_RETIRED')
  }
  for (const action of ['start', 'watch', 'finish', 'cancel']) {
    assert.equal((await json(`/api/login/${action}`, ownerA, {}, 410)).code, 'HOSTED_LOGIN_RETIRED')
  }
  const retired = await json('/api/status', ownerA)
  assert.equal(retired.hostedLogin, false)
  assert.deepEqual(retired.usage, [])
  assert.deepEqual(await json('/api/login/history', ownerA), { sessions: [] })
  assert.equal((await request('/connect/extension.zip')).status, 401)
  const helper = await request('/connect/extension.zip', ownerA)
  assert.equal(helper.headers.get('content-type'), 'application/zip')
  assert.match(helper.headers.get('content-disposition'), /overleaf-connection-helper.zip/u)
  assert.equal(new Uint8Array(await helper.arrayBuffer())[0], 0x50)
  assert.equal((await json('/api/status', ownerA)).linked, false)

  const link = {
    cookies: '# Netscape HTTP Cookie File\nwww.overleaf.com\tFALSE\t/\tTRUE\t0\toverleaf_session2\tsynthetic-session\n',
    projectId: 'a'.repeat(24),
  }
  assert.equal((await json('/api/link', ownerA, link, 403, 'https://other.example')).code, 'ORIGIN_REFUSED')
  assert.equal((await json('/api/status', ownerA)).linked, false)
  assert.deepEqual(await json('/api/link', ownerA, link), { linked: true, verified: false })
  assert.equal((await json('/api/status', ownerA)).linked, true)
  assert.equal((await json('/api/status', ownerB)).linked, false)
  async function mcp(assertion, method, params = {}, requestOrigin) {
    return await runtime.dispatchFetch(`${origin}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        ...(assertion ? { 'Cf-Access-Jwt-Assertion': assertion } : {}),
        ...(requestOrigin ? { Origin: requestOrigin } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
  }
  async function rpc(response) {
    const text = await response.text()
    return JSON.parse(
      text.startsWith('event:')
        ? text
            .split('\n')
            .find(line => line.startsWith('data:'))
            .slice(5)
        : text
    )
  }
  assert.equal((await mcp(undefined, 'tools/list')).status, 401)
  assert.equal((await mcp(ownerA, 'tools/list', {}, 'https://hostile.example')).status, 403)
  const listed = await rpc(await mcp(ownerA, 'tools/list'))
  assert.equal(listed.result.tools.length, 12)
  assert.ok(!listed.result.tools.some(tool => tool.name === 'manage_project'))
  const statusA = await rpc(await mcp(ownerA, 'tools/call', { name: 'connection_status', arguments: {} }))
  const statusB = await rpc(await mcp(ownerB, 'tools/call', { name: 'connection_status', arguments: {} }))
  assert.equal(statusA.result.structuredContent.projectId, link.projectId)
  assert.equal(statusB.result.structuredContent.linked, false)
  assert.equal(JSON.stringify(statusA).includes('synthetic-session'), false)
  const locked = await rpc(
    await mcp(ownerA, 'tools/call', {
      name: 'write_file',
      arguments: {
        projectId: link.projectId,
        filePath: 'main.tex',
        revision: 'fixture',
        content: 'new',
      },
    })
  )
  assert.equal(locked.result.isError, true)
  assert.match(JSON.stringify(locked), /POLICY_DENIED/u)
  assert.equal((await json('/api/probe', ownerB, {}, 409)).code, 'SESSION_REQUIRED')
  assert.equal((await json('/api/unlink', ownerA, {})).linked, false)
  assert.equal((await json('/api/status', ownerA)).linked, false)
  assert.equal((await json('/api/probe', ownerA, {}, 409)).code, 'SESSION_REQUIRED')
  assert.ok(keyRequests > 0, 'The Worker must verify the assertion using the fixture keys')
  console.log(
    'Cloudflare runtime check passed: authentication, routing, isolated SQLite sessions, link/unlink, origin checks.'
  )
} finally {
  await runtime.dispose()
}
