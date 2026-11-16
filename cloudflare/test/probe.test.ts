import { CookieJar } from 'tough-cookie'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { encodeEventPacket, parseSocketPacket } from '../../src/protocol/socketio09-codec.js'
import { runProbe } from '../src/probe.js'

const projectId = '000000000000000000000001'

class ProtocolSocket extends EventTarget {
  readyState = 0
  readonly events: string[] = []

  constructor(private readonly failRead = false) {
    super()
  }

  accept(): void {
    this.readyState = 1
    queueMicrotask(() =>
      this.message(
        encodeEventPacket('joinProjectResponse', [
          {
            publicId: 'fixture.client',
            project: { _id: projectId, rootFolder: [], rootDoc_id: 'fixture-document' },
            permissionsLevel: 'owner',
            protocolVersion: 2,
          },
        ])
      )
    )
  }

  message(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  send(value: string): void {
    const packet = parseSocketPacket(value)
    if (packet.type !== 'event') return
    this.events.push(packet.name)
    if (packet.name !== 'joinDoc' && packet.name !== 'leaveDoc') throw new Error('Unexpected non-read operation')
    const args =
      packet.name === 'leaveDoc'
        ? [null]
        : this.failRead
          ? ['fixture refusal']
          : [null, ['Synthetic test text'], 1, null, {}, 'sharejs']
    queueMicrotask(() => this.message(`6:::${packet.ackId}+${JSON.stringify(args)}`))
  }

  close(): void {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

function installServer(socket: ProtocolSocket) {
  const fetcher = vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    expect(url.origin).toBe('https://www.overleaf.com')
    expect(options?.redirect).toBe('manual')
    if (url.pathname === '/project') {
      return new Response(
        '<meta name="ol-user_id" content="fixture-owner"><meta name="ol-csrfToken" content="fixture-csrf">'
      )
    }
    if (url.pathname === '/socket.io/1/') {
      expect(url.searchParams.get('projectId')).toBe(projectId)
      return new Response('FIXTURE:60:60:websocket', {
        headers: { 'Set-Cookie': 'GCLB=fixture-route; Path=/; Secure; Max-Age=60' },
      })
    }
    expect(url.pathname).toBe('/socket.io/1/websocket/FIXTURE')
    expect(new Headers(options?.headers).get('Cookie')).toContain('GCLB=fixture-route')
    return { status: 101, webSocket: socket } as unknown as Response
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => vi.unstubAllGlobals())

describe('complete read-only probe through the upstream protocol engine', () => {
  it('reads without sending write messages, returns no document text, and closes the socket', async () => {
    const socket = new ProtocolSocket()
    const fetcher = installServer(socket)
    const result = await runProbe(new CookieJar(), projectId)
    expect(result).toEqual({
      authenticated: true,
      projectJoined: true,
      documentRead: true,
      characters: 19,
      protocol: 'sharejs',
    })
    expect(JSON.stringify(result)).not.toContain('Synthetic test text')
    expect(socket.events).toEqual(['joinDoc', 'leaveDoc'])
    expect(socket.readyState).toBe(3)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('closes the socket when the document read fails', async () => {
    const socket = new ProtocolSocket(true)
    installServer(socket)
    await expect(runProbe(new CookieJar(), projectId)).rejects.toMatchObject({ code: 'REMOTE_ERROR' })
    expect(socket.readyState).toBe(3)
    expect(socket.events).not.toContain('applyOtUpdate')
  })
  it('does not follow an upstream redirect or send a cookie to another origin', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 302, headers: { Location: 'https://other.example' } })
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(runProbe(new CookieJar(), projectId)).rejects.toMatchObject({ code: 'REMOTE_ERROR' })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('manual')
  })
})
