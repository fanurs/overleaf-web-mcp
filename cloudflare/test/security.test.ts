import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'

import { verifyAccess } from '../src/auth.js'
import { decryptSession, encryptSession } from '../src/crypto.js'
import { boundedJson, validSetupRequest } from '../src/http.js'

describe('session encryption', () => {
  const secret = 'ab'.repeat(32)
  it('round trips and uses a different IV each time', async () => {
    const first = await encryptSession('private cookie fixture', secret, 'owner-a')
    const second = await encryptSession('private cookie fixture', secret, 'owner-a')
    expect(first.iv).not.toBe(second.iv)
    expect(JSON.stringify(first)).not.toContain('private cookie fixture')
    expect(await decryptSession(first, secret, 'owner-a')).toBe('private cookie fixture')
  })
  it('rejects other owners, other keys, and changed ciphertext', async () => {
    const value = await encryptSession('synthetic fixture', secret, 'owner-a')
    await expect(decryptSession(value, secret, 'owner-b')).rejects.toThrow()
    await expect(decryptSession(value, 'cd'.repeat(32), 'owner-a')).rejects.toThrow()
    const changed = { ...value, ciphertext: (value.ciphertext[0] === 'A' ? 'B' : 'A') + value.ciphertext.slice(1) }
    await expect(decryptSession(changed, secret, 'owner-a')).rejects.toThrow()
  })
})

describe('Access assertions', () => {
  it('requires the signature, issuer, audience, expiry and identity', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'fixture', alg: 'RS256' }] })
    const config = { CF_ACCESS_TEAM_DOMAIN: 'fixture.cloudflareaccess.com', CF_ACCESS_AUD: 'app-a' }
    const make = async (
      audience = 'app-a',
      expires = '1m',
      issuer = 'https://fixture.cloudflareaccess.com',
      subject = 'owner'
    ) =>
      await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime(expires)
        .sign(privateKey)
    const request = (token: string) =>
      new Request('https://app.example/connect', { headers: { 'Cf-Access-Jwt-Assertion': token } })
    expect(await verifyAccess(request(await make()), config, keys)).toBe('https://fixture.cloudflareaccess.com|owner')
    await expect(verifyAccess(new Request('https://app.example'), config, keys)).rejects.toThrow()
    await expect(verifyAccess(request(await make('app-b')), config, keys)).rejects.toThrow()
    await expect(verifyAccess(request(await make('app-a', '-1m')), config, keys)).rejects.toThrow()
    await expect(
      verifyAccess(request(await make('app-a', '1m', 'https://attacker.example')), config, keys)
    ).rejects.toThrow()
    await expect(
      verifyAccess(request(await make('app-a', '1m', 'https://fixture.cloudflareaccess.com', '')), config, keys)
    ).rejects.toThrow()
    const wrong = await generateKeyPair('RS256')
    const forged = await new SignJWT({ sub: 'owner' })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setIssuer('https://fixture.cloudflareaccess.com')
      .setAudience('app-a')
      .setIssuedAt()
      .setExpirationTime('1m')
      .sign(wrong.privateKey)
    await expect(verifyAccess(request(forged), config, keys)).rejects.toThrow()
  })
})

describe('setup request boundaries', () => {
  it('rejects cross-origin requests and missing setup headers', () => {
    const make = (origin: string, marker = '1') =>
      new Request('https://app.example/api/link', {
        method: 'POST',
        headers: { Origin: origin, 'X-Overleaf-Setup': marker, 'Content-Type': 'application/json' },
        body: '{}',
      })
    expect(validSetupRequest(make('https://app.example'))).toBe(true)
    expect(validSetupRequest(make('https://attacker.example'))).toBe(false)
    expect(validSetupRequest(make('https://app.example', ''))).toBe(false)
  })
  it('bounds actual streamed bytes without trusting Content-Length', async () => {
    const request = new Request('https://app.example', { method: 'POST', body: 'x'.repeat(70001) })
    await expect(boundedJson(request)).rejects.toThrow('BODY_TOO_LARGE')
  })
})
