import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, expect, it, vi } from 'vitest'
import { McpError } from '../../src/core/errors.js'
import { remoteMcpHandler, REMOTE_TOOLS } from '../../src/mcp/remote.js'
import { encryptSession, type EncryptedSession } from '../src/crypto.js'
import { importSession } from '../src/cookies.js'
import { SessionController } from '../src/session.js'
import * as runtimeModule from '../src/runtime.js'

const projectId = 'a'.repeat(24)
const origin = 'https://overleaf.example'
function request(method: string, params: unknown = {}, id = 1) {
  return new Request(origin + '/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
}
async function result(response: Response) {
  const text = await response.text()
  return JSON.parse(
    text.startsWith('event:')
      ? text
          .split('\n')
          .find(line => line.startsWith('data:'))!
          .slice(5)
      : text
  ) as Record<string, any>
}

describe('remote MCP transport and boundaries', () => {
  it('works with the SDK client and advertises only the supported tools, without opening Overleaf', async () => {
    const call = vi.fn()
    const handler = remoteMcpHandler({ call, status: async () => ({ linked: true, projectId }) })
    const client = new Client({ name: 'fixture', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(origin + '/mcp'), {
      fetch: async (input, init) => await handler.fetch(new Request(input, init)),
    })
    try {
      await client.connect(transport)
      const listed = await client.listTools()
      expect(listed.tools.map(tool => tool.name)).toEqual(['connection_status', ...REMOTE_TOOLS])
      const write = listed.tools.find(tool => tool.name === 'write_file')!
      expect(write.inputSchema.properties).not.toHaveProperty('localPath')
      expect(write.annotations?.destructiveHint).toBe(true)
      const status = await client.callTool({ name: 'connection_status', arguments: {} })
      expect(status.structuredContent).toEqual({ linked: true, projectId })
      expect(call).not.toHaveBeenCalled()
    } finally {
      await client.close()
      await handler.close()
    }
  })

  it('serves legacy requests, refuses disk paths and unknown operations, and redacts unexpected errors', async () => {
    const call = vi.fn(async () => {
      throw new Error('private-cookie-value private-document-text')
    })
    const handler = remoteMcpHandler({ call, status: async () => ({ linked: false }) })
    try {
      const init = await result(
        await handler.fetch(
          request('initialize', {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'fixture', version: '1' },
          })
        )
      )
      expect(init.result.protocolVersion).toBe('2025-06-18')
      const disk = await result(
        await handler.fetch(
          request('tools/call', {
            name: 'write_file',
            arguments: { projectId, filePath: 'main.tex', revision: 'fixture', localPath: '/secret' },
          })
        )
      )
      expect(disk.result?.isError || disk.error).toBeTruthy()
      const forbidden = await result(
        await handler.fetch(
          request('tools/call', { name: 'manage_project', arguments: { projectId, action: 'delete' } })
        )
      )
      expect(forbidden.result?.isError || forbidden.error).toBeTruthy()
      expect(call).not.toHaveBeenCalled()
      const failed = await result(
        await handler.fetch(
          request('tools/call', { name: 'read_file', arguments: { projectId, filePath: 'main.tex' } })
        )
      )
      expect(failed.result.isError).toBe(true)
      expect(JSON.stringify(failed)).not.toContain('private-')
      expect(JSON.stringify(failed)).toContain('REMOTE_ERROR')
      expect((await handler.fetch(new Request(origin + '/mcp'))).status).toBe(405)
    } finally {
      await handler.close()
    }
  })

  it('keeps safe write outcomes without exposing upstream error text or private details', async () => {
    const handler = remoteMcpHandler({
      status: async () => ({}),
      call: async () => {
        throw new McpError('REVISION_CONFLICT', 'private-source-text', {
          details: { outcome: 'unknown', source: 'private-cookie' },
        })
      },
    })
    try {
      const reply = await result(
        await handler.fetch(
          request('tools/call', { name: 'read_file', arguments: { projectId, filePath: 'main.tex' } })
        )
      )
      expect(JSON.stringify(reply)).toContain('unknown')
      expect(JSON.stringify(reply)).not.toContain('private-')
    } finally {
      await handler.close()
    }
  })
})

describe('saved session MCP isolation', () => {
  const fixture =
    '# Netscape HTTP Cookie File\n.overleaf.com\tTRUE\t/\tTRUE\t4102444800\tfixture_session\tprivate-cookie\n'
  function storage() {
    const entries = new Map<string, EncryptedSession>()
    return {
      get: async (key: string) => entries.get(key),
      put: async (key: string, value: EncryptedSession) => {
        entries.set(key, value)
      },
      delete: async (key: string) => entries.delete(key),
    }
  }
  it('lists tools without a saved login, refuses calls without login and denies edits before verification', async () => {
    const controller = new SessionController(storage(), 'ab'.repeat(32), 'owner-a')
    expect((await result(await controller.handle(request('tools/list')))).result.tools).toHaveLength(12)
    const noSession = await result(
      await controller.handle(
        request('tools/call', { name: 'read_file', arguments: { projectId, filePath: 'main.tex' } })
      )
    )
    expect(JSON.stringify(noSession)).toContain('AUTH_EXPIRED')
    await controller.handle(
      new Request(origin + '/api/link', { method: 'POST', body: JSON.stringify({ projectId, cookies: fixture }) })
    )
    const blocked = await result(
      await controller.handle(
        request('tools/call', {
          name: 'write_file',
          arguments: { projectId, filePath: 'main.tex', revision: 'fixture', content: 'new' },
        })
      )
    )
    expect(JSON.stringify(blocked)).toContain('POLICY_DENIED')
    const batch = new Request(origin + '/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[]',
    })
    expect((await controller.handle(batch)).status).toBe(400)
  })

  it('finishes a write and closes the runtime before queued unlink, then does not resurrect the session', async () => {
    const saved = storage()
    const jar = await importSession(fixture)
    await saved.put(
      'session',
      await encryptSession(
        JSON.stringify({ jar: JSON.stringify(await jar.serialize()), projectId, editTest: { status: 'passed' } }),
        'ab'.repeat(32),
        'owner-a'
      )
    )
    let release!: () => void
    const blocked = new Promise<void>(resolve => {
      release = resolve
    })
    const close = vi.fn(async () => {})
    const write = vi.fn(async () => {
      await blocked
      return { revision: 'next', protocol: 'sharejs', trackChangesActive: false, writeMode: 'untracked' }
    })
    const factory = vi
      .spyOn(runtimeModule, 'createCloudRuntime')
      .mockResolvedValue({ service: { write_file: write }, close } as unknown as Awaited<
        ReturnType<typeof runtimeModule.createCloudRuntime>
      >)
    try {
      const controller = new SessionController(saved, 'ab'.repeat(32), 'owner-a')
      const writing = controller.handle(
        request('tools/call', {
          name: 'write_file',
          arguments: { projectId, filePath: 'main.tex', revision: 'fixture', content: 'new' },
        })
      )
      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
      const unlink = controller.handle(new Request(origin + '/api/unlink', { method: 'POST', body: '{}' }))
      expect(await saved.get('session')).toBeDefined()
      release()
      expect((await result(await writing)).result.isError).not.toBe(true)
      await unlink
      expect(close).toHaveBeenCalledOnce()
      expect(await saved.get('session')).toBeUndefined()
      expect(factory.mock.calls[0]?.[1]).toBe(projectId)
    } finally {
      factory.mockRestore()
    }
  })
})
