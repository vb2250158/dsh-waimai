/**
 * Host-side MCP client bridge for the takeaway server.
 *
 * Spawns `lib/mcp-server.js` as a child process, discovers its tools, and
 * publishes them on the harness tool registry as `mcp__waimai__<rawName>`.
 *
 * The bridge exists because a declared `@deepseek-ai/dsh-mcp-client` row cannot
 * locate this package's server file: the loader evaluates `!!js` through
 * `new Function`, so neither `require` nor `import.meta` is in scope, and a
 * relative `args` entry resolves against the DSH process working directory.
 * Owning the spawn here makes the path a value derived from `import.meta.url`,
 * and lets configuration changes reach the child without restarting DSH.
 *
 * @module dsh-waimai/mcp-bridge
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

/** Absolute path of the MCP server entry, derived from this module's location. */
const SERVER_ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'mcp-server.js')

/** Per-call timeout in ms; browser automation is slow but must not hang forever. */
const TOOL_CALL_TIMEOUT_MS = 120_000

/** `output.schema` for every bridged tool: the MCP content array, which is all the model reads. */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: { content: { type: 'array', items: {} } },
  required: ['content'],
  additionalProperties: false,
}

/**
 * Join the text blocks of one MCP content array.
 *
 * @param content - untrusted MCP content blocks.
 * @param toolName - tool name used in the empty-result placeholder.
 * @returns the newline-joined text projection.
 */
function extractText(content, toolName) {
  if (!Array.isArray(content)) return `(${toolName} returned no model-visible content)`
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'image') parts.push('[图片结果未投影到文本]')
  }
  return parts.length > 0 ? parts.join('\n') : `(${toolName} returned no model-visible content)`
}

/**
 * Copy `process.env` into a plain string map.
 *
 * The MCP transport rejects non-string values, and Windows environment blocks
 * can contain entries Node surfaces as undefined.
 *
 * @returns a string-only environment copy.
 */
function cleanEnv() {
  const result = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}

/**
 * Build one harness tool definition for an MCP tool.
 *
 * @param client - connected MCP client.
 * @param tool - the upstream tool description returned by `tools/list`.
 * @param serverName - namespace used in the public tool name.
 * @returns the unregistered tool definition.
 */
function buildToolDefinition(client, tool, serverName) {
  const rawName = tool.name
  return {
    name: `mcp__${serverName}__${rawName}`,
    description: tool.description ?? '',
    parameters: tool.inputSchema ?? { type: 'object', properties: {}, additionalProperties: true },
    output: {
      schema: OUTPUT_SCHEMA,
      /**
       * Project the MCP result for the model.
       *
       * @param _args - model arguments, unused by the text projection.
       * @param value - the canonical MCP result value.
       * @returns one text content block.
       */
      render(_args, value) {
        const content = value !== null && typeof value === 'object' ? value.content : undefined
        return [{ type: 'text', text: extractText(content, rawName) }]
      },
    },
    /**
     * Forward one call to the MCP server.
     *
     * @param args - model arguments validated against the upstream schema.
     * @param exec - harness execution context carrying cancellation.
     * @returns the MCP result value consumed by `output.render`.
     */
    async execute(args, exec) {
      const result = await client.callTool(
        { name: rawName, arguments: args ?? {} },
        { signal: exec?.signal, timeout: TOOL_CALL_TIMEOUT_MS },
      )
      const content = Array.isArray(result.content) ? result.content : []
      // An MCP isError result becomes a rejected tool call so the runtime
      // records failure instead of presenting prose as success.
      if (result.isError === true) throw new Error(extractText(content, rawName))
      return { content }
    },
  }
}

/**
 * Owns one MCP client generation: child process, connection, and live tool registrations.
 *
 * Every lifecycle operation runs through one promise chain, so a concurrent
 * `start` and `stop` can never leak a process or a half-registered tool set.
 */
export class WaimaiMcpBridge {
  /**
   * @param options - owning context, logger, and the public tool namespace.
   */
  constructor({ ctx, logger, serverName = 'waimai' }) {
    this.ctx = ctx
    this.logger = logger
    this.serverName = serverName
    this.client = undefined
    this.transport = undefined
    /** Public tool name to its unregister disposer; the live generation. */
    this.disposers = new Map()
    /** Serializes every lifecycle operation. */
    this.chain = Promise.resolve()
  }

  /** Public tool names currently registered by this bridge. */
  get toolNames() {
    return [...this.disposers.keys()]
  }

  /** Whether a live client generation is connected. */
  get connected() {
    return this.client !== undefined
  }

  /**
   * Spawn the server, connect, and publish its tools.
   *
   * @param env - extra environment entries for the child process.
   * @returns settlement after tools are registered, or after a contained failure.
   */
  start(env) {
    return this.enqueue(() => this.spawnGeneration(env))
  }

  /**
   * Unregister tools, disconnect, and let the child exit.
   *
   * @returns settlement after the generation is gone.
   */
  stop() {
    return this.enqueue(() => this.teardownGeneration())
  }

  /**
   * Replace the current generation so new configuration reaches the child.
   *
   * @param env - environment for the replacement generation.
   * @returns settlement after the swap.
   */
  restart(env) {
    return this.enqueue(async () => {
      await this.teardownGeneration()
      await this.spawnGeneration(env)
    })
  }

  /**
   * Call one MCP tool directly, bypassing the model.
   *
   * Automation tasks use this to run a scripted order without spending an
   * agent turn; the agent skill uses the registered tools instead.
   *
   * @param name - upstream tool name, without the `mcp__` prefix.
   * @param args - tool arguments.
   * @returns the parsed `{ success, data }` payload the server returned.
   * @throws when the bridge is not connected.
   */
  async call(name, args) {
    const client = this.client
    if (client === undefined) throw new Error('waimai MCP bridge is not connected')
    const result = await client.callTool(
      { name, arguments: args ?? {} },
      { timeout: TOOL_CALL_TIMEOUT_MS },
    )
    const text = extractText(result.content, name)
    try {
      return JSON.parse(text)
    } catch {
      // A tool that answered with prose is reported verbatim rather than dropped.
      return { success: false, error: text }
    }
  }

  /** Open one client generation; a failure is contained and logged, never thrown at the plugin. */
  async spawnGeneration(env) {
    if (this.client !== undefined) return
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_ENTRY],
      env: { ...cleanEnv(), ...env },
      stderr: 'pipe',
    })
    transport.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text.length > 0) this.logger.info(`waimai-mcp: ${text}`)
    })
    const client = new Client({ name: 'dsh-waimai-host', version: '0.1.0' })
    try {
      await client.connect(transport)
      const listed = await client.listTools()
      const registered = new Map()
      try {
        for (const tool of listed.tools) {
          const definition = buildToolDefinition(client, tool, this.serverName)
          registered.set(definition.name, this.ctx.tools.register(definition))
        }
      } catch (error) {
        // A conflict on one name means a foreign registration squats on this
        // namespace; roll back so the model sees all tools or none.
        for (const dispose of registered.values()) dispose()
        throw error
      }
      this.client = client
      this.transport = transport
      this.disposers = registered
      this.logger.info(`waimai: registered ${registered.size} takeaway tools`)
    } catch (error) {
      this.logger.warn(`waimai: MCP server unavailable: ${String(error)}`)
      await client.close().catch(() => {})
      await transport.close().catch(() => {})
    }
  }

  /** Close the current generation; an already-closed generation is a no-op. */
  async teardownGeneration() {
    for (const dispose of this.disposers.values()) dispose()
    this.disposers = new Map()
    const client = this.client
    const transport = this.transport
    this.client = undefined
    this.transport = undefined
    if (client !== undefined) await client.close().catch(() => {})
    await transport?.close().catch(() => {})
  }

  /**
   * Queue an operation behind every earlier lifecycle operation.
   *
   * @param operation - work to run once the chain reaches it.
   * @returns that operation's own settlement.
   */
  enqueue(operation) {
    const task = this.chain.then(operation, operation)
    // Keep the chain fulfilled so one failure cannot strand later operations.
    this.chain = task.then(() => {}, () => {})
    return task
  }
}
