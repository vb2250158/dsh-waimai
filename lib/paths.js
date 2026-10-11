/**
 * Filesystem locations shared by the Host half, the MCP server, and the
 * retained runtime records.
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
 * Retained legacy Chromium profile; HTTP tools do not read it.
 *
 * @returns the absolute persistent browser profile path.
 */
export function browserProfileDir() {
  return join(stateDir(), 'browser-profile')
}

/**
 * Retained legacy screenshots; HTTP tools do not capture browser pages.
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
