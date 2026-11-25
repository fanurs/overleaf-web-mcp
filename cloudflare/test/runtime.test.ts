import { CookieJar } from 'tough-cookie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeEventPacket, parseSocketPacket } from '../../src/protocol/socketio09-codec.js'
import { applyShareJs } from '../../test/helpers/overleaf-socket.js'
import { createCloudRuntime } from '../src/runtime.js'
import { runEditTest, type EditTestResult } from '../src/self-test.js'

const id = 'a'.repeat(24)
function fixture(options: { failCompile?: boolean; failCreate?: boolean } = {}) {
  let content = 'Original fixture text'
  let version = 1
  let name = 'Fixture'
  let trashed = false
  let writes = 0
  const sockets: Socket[] = []
  const calls: string[] = []
  class Socket extends EventTarget {
    readyState = 0
    message(data: string) {
      this.dispatchEvent(new MessageEvent('message', { data }))
    }
    accept() {
      this.readyState = 1
      queueMicrotask(() =>
        this.message(
          encodeEventPacket('joinProjectResponse', [
            {
              publicId: 'fixture.client',
              permissionsLevel: 'owner',
              protocolVersion: 2,
              project: {
                _id: id,
                rootDoc_id: 'doc',
                rootFolder: [{ _id: 'folder', name: '', docs: [{ _id: 'doc', name: 'main.tex' }] }],
              },
            },
          ])
        )
      )
    }
    send(text: string) {
      const packet = parseSocketPacket(text)
      if (packet.type !== 'event') return
      if (packet.name === 'joinDoc')
        queueMicrotask(() =>
          this.message(
            `6:::${packet.ackId}+${JSON.stringify([null, content.split('\n'), version, null, {}, 'sharejs'])}`
          )
        )
      else if (packet.name === 'leaveDoc') queueMicrotask(() => this.message(`6:::${packet.ackId}+[null]`))
      else if (packet.name === 'applyOtUpdate') {
        const update = packet.args[1] as { v: number; op: Array<{ p: number; i?: string; d?: string }> }
        expect(update.v).toBe(version)
        content = applyShareJs(content, update.op)
        version++
        writes++
        queueMicrotask(() => {
          this.message(`6:::${packet.ackId}+[null]`)
          this.message(encodeEventPacket('otUpdateApplied', [{ doc: 'doc', v: update.v }]))
        })
      } else throw new Error('Unexpected socket action')
    }
    close() {
      this.readyState = 3
      this.dispatchEvent(new Event('close'))
    }
  }
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    expect(url.origin).toBe('https://www.overleaf.com')
    expect(init?.redirect).toBe('manual')
    calls.push(url.pathname)
    if (url.pathname === '/project')
      return new Response(
        '<meta name="ol-user_id" content="fixture-owner"><meta name="ol-csrfToken" content="fixture-csrf">'
      )
    if (url.pathname === '/project/new') {
      if (options.failCreate) throw new Error('private-response-body')
      name = (JSON.parse(init!.body as string) as { projectName: string }).projectName
      return Response.json({ project_id: id })
    }
    if (url.pathname === '/api/project')
      return Response.json({
        projects: [
          { _id: id, name, accessLevel: 'owner', trashed },
          { _id: 'b'.repeat(24), name: 'Unrelated private project', accessLevel: 'owner' },
        ],
      })
    if (url.pathname === '/socket.io/1/') return new Response('FIXTURE:60:60:websocket')
    if (url.pathname === '/socket.io/1/websocket/FIXTURE') {
      const socket = new Socket()
      sockets.push(socket)
      return { status: 101, webSocket: socket } as unknown as Response
    }
    if (url.pathname === `/project/${id}/compile`)
      return Response.json({
        status: options.failCompile ? 'failure' : 'success',
        outputFiles: options.failCompile
          ? []
          : ['output.pdf', 'output.log'].map(path => ({ path, type: path.split('.')[1], build: 'a-b' })),
        stats: {},
      })
    if (url.pathname.endsWith('/output/output.log'))
      return new Response('Output written on output.pdf (1 page, 100 bytes).\n')
    if (url.pathname === `/project/${id}/trash`) {
      trashed = true
      return Response.json({})
    }
    throw new Error('Unexpected request')
  })
  vi.stubGlobal('fetch', fetcher)
  return { fetcher, sockets, calls, content: () => content, writes: () => writes, trashed: () => trashed }
}
afterEach(() => vi.unstubAllGlobals())

describe('Cloudflare runtime through the real HTTP, service and OT engines', () => {
  it('filters projects, reads and verifies an edit, refuses stale revisions and other projects, and closes sockets', async () => {
    const server = fixture()
    const runtime = await createCloudRuntime(new CookieJar(), id)
    try {
      const projects = await runtime.service.list_projects({})
      expect(projects.projects.map(project => project.id)).toEqual([id])
      const original = await runtime.service.read_file({ projectId: id, filePath: 'main.tex' })
      await runtime.service.write_file({
        projectId: id,
        filePath: 'main.tex',
        revision: original.revision,
        edits: [{ oldText: 'Original', newText: 'Edited' }],
      })
      expect(server.content()).toBe('Edited fixture text')
      await expect(
        runtime.service.write_file({
          projectId: id,
          filePath: 'main.tex',
          revision: original.revision,
          content: 'wrong',
        })
      ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
      const before = server.calls.length
      await expect(
        runtime.service.read_file({ projectId: 'b'.repeat(24), filePath: 'main.tex' })
      ).rejects.toMatchObject({ code: 'POLICY_DENIED' })
      await expect(
        runtime.service.write_file({
          projectId: id,
          filePath: 'main.tex',
          revision: original.revision,
          localPath: '/secret',
        })
      ).rejects.toMatchObject({ code: 'POLICY_DENIED' })
      expect(server.calls).toHaveLength(before)
      expect(server.writes()).toBe(1)
    } finally {
      await runtime.close()
    }
    expect(server.sockets.every(socket => socket.readyState === 3)).toBe(true)
  })

  it('completes and trashes its disposable test without leaking content into progress', async () => {
    const server = fixture()
    const progress: EditTestResult[] = []
    const result = await runEditTest(new CookieJar(), async value => {
      progress.push(structuredClone(value))
    })
    expect(result).toMatchObject({
      status: 'passed',
      readVerified: true,
      writeVerified: true,
      conflictRefused: true,
      compileVerified: true,
      trashed: true,
    })
    expect(server.writes()).toBe(1)
    expect(server.sockets.every(socket => socket.readyState === 3)).toBe(true)
    expect(JSON.stringify(progress)).not.toContain('Private connection test.')
    expect(server.calls.filter(path => path === '/project/new')).toHaveLength(1)
  })

  it('still trashes and closes after a failed compile, without repeating a write or compile', async () => {
    const server = fixture({ failCompile: true })
    const result = await runEditTest(new CookieJar(), async () => {})
    expect(result).toMatchObject({ status: 'failed', trashed: true, writeVerified: true })
    expect(server.writes()).toBe(1)
    expect(server.calls.filter(path => path.endsWith('/compile'))).toHaveLength(1)
    expect(server.sockets.every(socket => socket.readyState === 3)).toBe(true)
  })

  it('does not repeat project creation after an ambiguous network failure', async () => {
    const server = fixture({ failCreate: true })
    const result = await runEditTest(new CookieJar(), async () => {})
    expect(result.status).toBe('failed')
    expect(result.projectId).toBeUndefined()
    expect(server.calls.filter(path => path === '/project/new')).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('private-response-body')
  })
})
