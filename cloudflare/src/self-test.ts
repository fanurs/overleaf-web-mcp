import type { CookieJar } from 'tough-cookie'
import { asMcpError } from '../../src/core/errors.js'
import { createCloudRuntime } from './runtime.js'

export interface EditTestResult {
  status: 'running' | 'passed' | 'failed'
  stage: string
  startedAt: number
  finishedAt?: number
  projectId?: string
  projectName: string
  readVerified?: boolean
  writeVerified?: boolean
  conflictRefused?: boolean
  compileVerified?: boolean
  trashed?: boolean
  code?: string
}

/** Only a newly created disposable project is permitted by this runtime's initially empty policy. */
export async function runEditTest(
  jar: CookieJar,
  save: (result: EditTestResult) => Promise<void>
): Promise<EditTestResult> {
  const result: EditTestResult = {
    status: 'running',
    stage: 'create',
    startedAt: Date.now(),
    projectName: `mcp-connection-test-${crypto.randomUUID().slice(0, 12)}`,
  }
  // Persist before the non-idempotent create. Never silently repeat an interrupted create.
  await save(result)
  let instance: Awaited<ReturnType<typeof createCloudRuntime>> | undefined
  try {
    instance = await createCloudRuntime(jar)
    const created = await instance.service
      .create_project({ name: result.projectName, template: 'blank' })
      .catch(error => {
        const id = asMcpError(error).details?.projectId
        if (typeof id === 'string' && /^[a-f0-9]{24}$/u.test(id) && instance!.runtime.policy!.allowsProject(id))
          result.projectId = id
        throw error
      })
    result.projectId = created.projectId
    result.stage = 'read'
    await save(result)
    const original = await instance.service.read_file({ projectId: created.projectId, filePath: 'main.tex' })
    result.readVerified = true
    result.stage = 'write'
    await save(result)
    const content = '\\documentclass{article}\n\\begin{document}\nPrivate connection test.\n\\end{document}\n'
    await instance.service.write_file({
      projectId: created.projectId,
      filePath: 'main.tex',
      revision: original.revision,
      content,
      writeMode: 'untracked',
    })
    const live = await instance.service.read_file({ projectId: created.projectId, filePath: 'main.tex' })
    if (live.content !== content) throw new Error('TEST_READBACK_FAILED')
    result.writeVerified = true
    result.stage = 'conflict'
    await save(result)
    try {
      await instance.service.write_file({
        projectId: created.projectId,
        filePath: 'main.tex',
        revision: original.revision,
        content: 'must never be stored',
        writeMode: 'untracked',
      })
      throw new Error('TEST_CONFLICT_NOT_REFUSED')
    } catch (error) {
      if (asMcpError(error).code !== 'REVISION_CONFLICT') throw error
      result.conflictRefused = true
    }
    result.stage = 'compile'
    await save(result)
    const built = await instance.service.compile_project({
      projectId: created.projectId,
      rootFilePath: 'main.tex',
      timeoutMs: 20000,
    })
    if (!built.summary.builtCleanly) throw new Error('TEST_COMPILE_FAILED')
    result.compileVerified = true
  } catch (error) {
    result.code = asMcpError(error).code
  } finally {
    if (instance && result.projectId) {
      result.stage = 'cleanup'
      await save(result)
      try {
        await instance.service.manage_project({
          projectId: result.projectId,
          action: 'trash',
          confirmName: result.projectName,
        })
        // Verify cleanup, without permanently deleting anything.
        result.trashed = (await instance.runtime.account.listProjects({ includeTrashed: true })).projects.some(
          project => project.id === result.projectId && project.trashed
        )
      } catch (error) {
        result.code ??= asMcpError(error).code
      }
    }
    await instance?.close()
  }
  result.finishedAt = Date.now()
  result.status =
    result.readVerified && result.writeVerified && result.conflictRefused && result.compileVerified && result.trashed
      ? 'passed'
      : 'failed'
  result.stage = 'finished'
  await save(result)
  return result
}
