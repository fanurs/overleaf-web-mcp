import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

export interface AccessConfig {
  CF_ACCESS_TEAM_DOMAIN: string
  CF_ACCESS_AUD: string
}

const resolvers = new Map<string, JWTVerifyGetKey>()

export async function verifyAccess(request: Request, config: AccessConfig, keys?: JWTVerifyGetKey): Promise<string> {
  const team = config.CF_ACCESS_TEAM_DOMAIN
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/u.test(team) || !config.CF_ACCESS_AUD) {
    throw new Error('ACCESS_NOT_CONFIGURED')
  }
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!assertion || assertion.length > 16384) throw new Error('ACCESS_REQUIRED')
  const issuer = `https://${team}`
  if (!keys) {
    keys = resolvers.get(team)
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 })
      resolvers.set(team, keys)
    }
  }
  const { payload } = await jwtVerify(assertion, keys, {
    algorithms: ['RS256'],
    issuer,
    audience: config.CF_ACCESS_AUD,
    requiredClaims: ['sub', 'exp', 'iat'],
  })
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 256) {
    throw new Error('ACCESS_IDENTITY_INVALID')
  }
  return `${issuer}|${payload.sub}`
}
