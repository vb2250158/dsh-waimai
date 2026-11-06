/** Exclusive process ownership of account sessions and purchase journals. */
import { mkdir, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** Acquire an exclusive state lease; stale leases require operator inspection, never automatic stealing. */
export async function acquireStateOwner(directory) {
  await mkdir(directory, { recursive: true })
  const path = join(directory, '.mcp-owner.lock')
  const file = await open(path, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })) }
  catch (error) { await file.close(); await unlink(path); throw error }
  let released = false
  return async () => {
    if (released) return
    released = true
    await file.close()
    await unlink(path)
  }
}
