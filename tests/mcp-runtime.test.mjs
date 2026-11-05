/** Real stdio MCP coverage for deployment-selected Node executables and queued replacement. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Config } from '../lib/index.js'
import { WaimaiMcpBridge } from '../lib/mcp-bridge.js'

/** Own one private Home and record only the actual child PID and executable before normal MCP startup. */
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'waimai-mcp-runtime-'))
  const registered = new Map()
  const warnings = []
  const proof = join(root, 'runtime.jsonl')
  const preload = join(root, 'runtime-proof.cjs')
  const bridge = new WaimaiMcpBridge({
    ...(typeof options === 'function' ? options(root) : options),
    logger: { info() {}, warn(message) { warnings.push(message) } },
    ctx: { tools: { register(definition) {
      registered.set(definition.name, definition)
      return () => registered.delete(definition.name)
    } } },
  })
  t.after(async () => {
    try { await bridge.stop() } finally {
      assert.equal(dirname(resolve(root)), resolve(tmpdir()))
      assert.ok(root.startsWith(join(tmpdir(), 'waimai-mcp-runtime-')))
      await rm(root, { recursive: true, force: true })
    }
  })
  await writeFile(preload,
    "require('node:fs').appendFileSync(process.env.MCP_RUNTIME_PROOF, JSON.stringify({ pid: process.pid, executable: process.execPath }) + '\\n')\n")
  // The bridge merges its caller's environment. Empty ambient values so the test
  // cannot hand production credentials or a production Home to the real server.
  const env = Object.fromEntries(Object.keys(process.env).map(key => [key, '']))
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(SystemRoot|WINDIR|PATH|PATHEXT|TEMP|TMP)$/i.test(key)) env[key] = value
  }
  Object.assign(env, {
    DSH_HOME: root, HOME: root, USERPROFILE: root,
    NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
    MCP_RUNTIME_PROOF: proof,
  })
  return {
    root, bridge, env, registered, warnings, proof,
    rows: async () => (await readFile(proof, 'utf8')).trim().split('\n').map(line => JSON.parse(line)),
  }
}

/** An owned MCP child must have exited after its transport closes. */
function assertExited(pid) {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
}

test('the MCP interpreter defaults to the Host without changing the configuration default', async t => {
  assert.equal(Config({}).get().mcpNodeExecutable, '')
  const h = await fixture(t)
  await h.bridge.start(h.env)
  assert.equal(h.bridge.connected, true)
  assert.ok(h.registered.size > 0)
  const [row] = await h.rows()
  assert.equal(row.executable, process.execPath)
  assert.equal(row.pid, h.bridge.transport.pid)
  await h.bridge.stop()
  assert.equal(h.registered.size, 0)
  assertExited(row.pid)
})

test('a configured executable with spaces runs the real MCP server and queued changes can reset it', async t => {
  const filename = process.platform === 'win32' ? 'Takeaway runtime.exe' : 'Takeaway runtime'
  const h = await fixture(t, root => ({ nodeExecutable: join(root, filename) }))
  const executable = join(h.root, filename)
  await copyFile(process.execPath, executable)
  assert.equal(Config({ mcpNodeExecutable: executable }).get().mcpNodeExecutable, executable)
  await h.bridge.start(h.env)
  const originalNames = h.bridge.toolNames
  const resetting = h.bridge.restart(h.env, process.execPath)
  const replacing = h.bridge.restart(h.env, executable)
  await Promise.all([replacing, resetting])
  const rows = await h.rows()
  assert.deepEqual(rows.map(row => row.executable), [executable, process.execPath, executable])
  assert.equal(new Set(rows.map(row => row.pid)).size, 3)
  assert.deepEqual(h.bridge.toolNames, originalNames)
  assert.equal(h.registered.size, originalNames.length)
  assert.equal(h.bridge.transport.pid, rows[2].pid)
  assertExited(rows[0].pid)
  assertExited(rows[1].pid)
  assert.equal(h.warnings.length, 0)
})

test('an explicit unavailable interpreter stays failed without silently using the Host and can recover', async t => {
  const h = await fixture(t, root => ({ nodeExecutable: join(root, 'missing-node.exe') }))
  await h.bridge.start(h.env)
  assert.equal(h.bridge.connected, false)
  assert.equal(h.registered.size, 0)
  assert.ok(h.warnings.some(message => message.includes('MCP server unavailable')))
  await assert.rejects(access(h.proof), { code: 'ENOENT' })
  await h.bridge.restart(h.env, process.execPath)
  assert.equal(h.bridge.connected, true)
  assert.ok(h.registered.size > 0)
  assert.deepEqual((await h.rows()).map(row => row.executable), [process.execPath])
})
