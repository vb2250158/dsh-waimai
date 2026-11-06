#!/usr/bin/env node
/** Standalone MCP service; configuration and credentials belong to its deployment. */
import { startService } from './mcp-service.js'

try {
  const service = await startService({ port: Number(process.env.WAIMAI_PORT || 3815),
    directory: process.env.WAIMAI_STATE_DIR || '', tokenFile: process.env.WAIMAI_TOKEN_FILE || '',
    hostTokenFile: process.env.WAIMAI_HOST_TOKEN_FILE || '' })
  console.error(`waimai MCP listening at ${service.url}`)
  let closing = false
  const close = async () => { if (closing) return; closing = true; await service.close() }
  process.once('SIGINT', () => void close())
  process.once('SIGTERM', () => void close())
} catch {
  console.error('Waimai service failed to start; check port, absolute state directory and distinct token files.')
  process.exitCode = 1
}
