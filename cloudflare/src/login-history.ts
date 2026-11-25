import { decryptSession } from './crypto.js'
import type { SessionStorage } from './session.js'

export interface LoginUsage {
  id: string
  startedAt: number
  endedAt: number
  elapsedMs: number
  browserMs?: number
  timing: 'cloudflare' | 'estimated' | 'unavailable'
  outcome: 'connected' | 'cancelled' | 'expired' | 'not_opened' | 'failed' | 'launch_failed'
  completion?: 'automatic' | 'manual'
}

/** Read the original encrypted records without a browser binding or a storage migration. */
export async function readLoginHistory(
  storage: SessionStorage,
  secret: string,
  owner: string,
  all = false
): Promise<LoginUsage[]> {
  async function read<T>(key: string): Promise<T | undefined> {
    const value = await storage.get(key)
    return value ? (JSON.parse(await decryptSession(value, secret, owner)) as T) : undefined
  }
  const months = (await read<string[]>('usage-months')) ?? []
  const records: LoginUsage[] = []
  for (const month of [...months].reverse()) {
    records.push(...((await read<LoginUsage[]>(`usage:${month}`)) ?? []).reverse())
    if (!all && records.length >= 20) break
  }
  return all ? records : records.slice(0, 20)
}
