import { EventEmitter } from 'node:events'

import type { WebSocketPeer } from '../../src/protocol/socketio09-client.js'

/** Adapts Workers' authenticated fetch upgrade to the existing Socket.IO 0.9 peer. */
export class WorkerWebSocket extends EventEmitter implements WebSocketPeer {
  #socket: WebSocket | undefined
  #closed = false
  #abort = new AbortController()

  constructor(url: string, headers: Record<string, string>, fetcher: typeof fetch = fetch) {
    super()
    // Defer until SocketIo09Peer has attached its error and message listeners.
    queueMicrotask(() => void this.#open(url, headers, fetcher))
  }

  get readyState(): number {
    return this.#closed ? 3 : (this.#socket?.readyState ?? 0)
  }

  async #open(url: string, headers: Record<string, string>, fetcher: typeof fetch): Promise<void> {
    const timeout = setTimeout(() => this.#abort.abort(), 10000)
    try {
      const target = new URL(url)
      if (target.protocol !== 'wss:' || target.hostname !== 'www.overleaf.com') {
        throw new Error('WEBSOCKET_HOST_REFUSED')
      }
      target.protocol = 'https:'
      const response = await fetcher(target, {
        headers: { ...headers, Upgrade: 'websocket' },
        redirect: 'manual',
        signal: this.#abort.signal,
      })
      const socket = response.webSocket
      if (response.status !== 101 || !socket) throw new Error('WEBSOCKET_UPGRADE_REFUSED')
      this.#socket = socket
      socket.addEventListener('message', event => {
        if (!this.#closed) this.emit('message', event.data)
      })
      socket.addEventListener('error', () => this.#fail())
      socket.addEventListener('close', () => this.#finishClose())
      socket.accept()
      if (this.#closed) socket.close(1000)
    } catch {
      if (!this.#closed) this.#fail()
    } finally {
      clearTimeout(timeout)
    }
  }

  #fail(): void {
    if (this.#closed) return
    // Never expose a fetch error, which could contain request details.
    if (this.listenerCount('error')) this.emit('error', new Error('WEBSOCKET_FAILED'))
    this.close()
  }

  #finishClose(): void {
    if (this.#closed) return
    this.#closed = true
    this.emit('close')
  }

  send(value: string): void {
    if (!this.#socket || this.readyState !== 1) throw new Error('WEBSOCKET_NOT_OPEN')
    this.#socket.send(value)
  }

  close(): void {
    if (this.#closed) return
    this.#abort.abort()
    this.#socket?.close(1000)
    this.#finishClose()
  }
}
