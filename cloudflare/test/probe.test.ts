import { CookieJar } from 'tough-cookie'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { encodeEventPacket, parseSocketPacket } from '../../src/protocol/socketio09-codec.js'
import type { JoinProjectData } from '../../src/protocol/project-connection.js'
import { runProbe } from '../src/probe.js'

const projectId = '000000000000000000000001'
const project: JoinProjectData['project'] = {
  _id: projectId,
  rootFolder: [{ _id: 'fixture-folder', name: '', docs: [{ _id: 'fixture-document', name: 'main.tex' }] }],
  rootDoc_id: 'fixture-document',
}

class ProtocolSocket extends EventTarget {
  readyState = 0
  readonly events: string[] = []
  readonly readIds: string[] = []

  constructor(
    private readonly failRead = false,
    private readonly projectData: JoinProjectData['project'] = project
  ) {
    super()
  }

  accept(): void {
    this.readyState = 1
    queueMicrotask(() =>
      this.message(
        encodeEventPacket('joinProjectResponse', [
          {
            publicId: 'fixture.client',
            project: this.projectData,
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
    if (packet.name === 'joinDoc') this.readIds.push(packet.args[0] as string)
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
      documentSelection: 'configured_root',
    })
    expect(JSON.stringify(result)).not.toContain('Synthetic test text')
    expect(socket.events).toEqual(['joinDoc', 'leaveDoc'])
    expect(socket.readyState).toBe(3)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it.each([undefined, '', 'stale-root', 'fixture-binary'])(
    'reads an existing TeX document when the reported root is %s',
    async rootDoc_id => {
      const data: JoinProjectData['project'] = {
        _id: projectId,
        rootFolder: [
          {
            _id: 'folder',
            name: '',
            docs: [{ _id: 'notes', name: 'a-notes.txt' }],
            fileRefs: [{ _id: 'fixture-binary', name: 'figure.pdf' }],
            folders: [
              {
                _id: 'nested',
                name: 'parts',
                docs: [
                  { _id: 'text-b', name: 'b.tex' },
                  { _id: 'text-a', name: 'a.tex' },
                ],
              },
            ],
          },
        ],
        ...(rootDoc_id === undefined ? {} : { rootDoc_id }),
      }
      const socket = new ProtocolSocket(false, data)
      installServer(socket)
      const result = await runProbe(new CookieJar(), projectId)
      expect(result).toMatchObject({
        authenticated: true,
        projectJoined: true,
        documentRead: true,
        documentSelection: 'project_document',
      })
      expect(socket.readIds).toEqual(['text-a'])
      expect(socket.events).toEqual(['joinDoc', 'leaveDoc'])
      expect(socket.readyState).toBe(3)
      expect(JSON.stringify(result)).not.toMatch(/parts|notes|fixture|Synthetic/)
    }
  )

  it('can verify a project containing a text document without any TeX file', async () => {
    const socket = new ProtocolSocket(false, {
      _id: projectId,
      rootFolder: [{ _id: 'folder', name: '', docs: [{ _id: 'notes', name: 'notes.txt' }] }],
    })
    installServer(socket)
    expect(await runProbe(new CookieJar(), projectId)).toMatchObject({
      documentRead: true,
      documentSelection: 'project_document',
    })
    expect(socket.readIds).toEqual(['notes'])
  })

  it('retains the configured root even when a different TeX document sorts first', async () => {
    const socket = new ProtocolSocket(false, {
      ...project,
      rootFolder: [
        {
          _id: 'folder',
          name: '',
          docs: [
            { _id: 'other', name: 'a.tex' },
            { _id: 'fixture-document', name: 'main.tex' },
          ],
        },
      ],
    })
    installServer(socket)
    expect(await runProbe(new CookieJar(), projectId)).toMatchObject({ documentSelection: 'configured_root' })
    expect(socket.readIds).toEqual(['fixture-document'])
  })

  it('reports no readable document without joining a folder or binary file and still closes', async () => {
    const socket = new ProtocolSocket(false, {
      _id: projectId,
      rootDoc_id: 'binary',
      rootFolder: [{ _id: 'folder', name: '', fileRefs: [{ _id: 'binary', name: 'image.pdf' }] }],
    })
    installServer(socket)
    await expect(runProbe(new CookieJar(), projectId)).rejects.toThrow('NO_READABLE_DOCUMENT')
    expect(socket.events).toEqual([])
    expect(socket.readyState).toBe(3)
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
