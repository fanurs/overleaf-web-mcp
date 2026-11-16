import { describe, expect, it, vi } from 'vitest'

import { SocketIo09Peer } from '../../src/protocol/socketio09-client.js'
import { WorkerWebSocket } from '../src/websocket.js'

class Socket extends EventTarget {
  readyState = 0
  send = vi.fn()
  accept(): void {
    this.readyState = 1
  }
  close(): void {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
  message(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

describe('Workers WebSocket adapter', () => {
  it('upgrades with session headers and preserves upstream heartbeat handling', async () => {
    const socket = new Socket()
    const fetcher = vi.fn<typeof fetch>(async () => ({ status: 101, webSocket: socket }) as unknown as Response)
    const adapted = new WorkerWebSocket(
      'wss://www.overleaf.com/socket.io/1/websocket/fixture',
      { Cookie: 'synthetic' },
      fetcher
    )
    const peer = new SocketIo09Peer(adapted)
    await vi.waitFor(() => expect(adapted.readyState).toBe(1))
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://www.overleaf.com/socket.io/1/websocket/fixture')
    const options = fetcher.mock.calls[0]?.[1] as RequestInit
    expect(options.headers).toMatchObject({ Cookie: 'synthetic', Upgrade: 'websocket' })
    expect(options.redirect).toBe('manual')
    socket.message('2::')
    expect(socket.send).toHaveBeenCalledWith('2::')
    peer.close()
    expect(socket.readyState).toBe(3)
  })
  it('refuses redirects and arbitrary hosts without leaking details', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('secret request details')
    })
    const adapted = new WorkerWebSocket('wss://attacker.example/socket', { Cookie: 'synthetic' }, fetcher)
    const error = new Promise<Error>(resolve => adapted.once('error', resolve))
    expect((await error).message).toBe('WEBSOCKET_FAILED')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('closes a delayed upgrade after the caller has cancelled', async () => {
    const socket = new Socket()
    let release!: (response: Response) => void
    const fetcher = (() =>
      new Promise<Response>(resolve => {
        release = resolve
      })) as typeof fetch
    const adapted = new WorkerWebSocket('wss://www.overleaf.com/socket', {}, fetcher)
    await Promise.resolve()
    adapted.close()
    release({ status: 101, webSocket: socket } as unknown as Response)
    await vi.waitFor(() => expect(socket.readyState).toBe(3))
  })
})
