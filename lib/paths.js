/**
 * Filesystem locations shared by the Host half, the MCP server, and the
 * browser profile.
 *
 * Every path derives from `DSH_HOME`, so a caller never hardcodes a machine
 * layout. The Host half and the spawned server agree because both read the
 * same variable from the environment.
 *
 * @module dsh-waimai/paths
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Resolve the DeepSeek Harness home directory.
 *
 * @returns the absolute `DSH_HOME`, falling back to `~/.dsh`.
 */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return resolve(fromEnv.trim())
  return join(homedir(), '.dsh')
}

/**
 * Directory holding this plugin's runtime state.
 *
 * @returns the absolute plugin state directory.
 */
export function stateDir() {
  return join(dshHome(), 'waimai')
}

/**
 * Chromium user-data directory that keeps the takeaway site login between runs.
 *
 * @returns the absolute persistent browser profile path.
 */
export function browserProfileDir() {
  return join(stateDir(), 'browser-profile')
}

/**
 * Directory receiving failure screenshots.
 *
 * @returns the absolute screenshot directory.
 */
export function screenshotDir() {
  return join(stateDir(), 'screenshots')
}

/** Append-only JSONL audit trail for every payment attempt. */
export function orderLogPath() {
  return join(stateDir(), 'order-log.jsonl')
}

/** Debug log for the spawned MCP server, which may not write to stdout. */
export function serverLogPath() {
  return join(stateDir(), 'mcp-server.log')
}
