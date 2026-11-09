/** Windows user-bound encrypted session storage outside the application installation. */
import { execFile } from 'node:child_process'
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { TradeError } from './trade-data.js'

/** Pass sensitive bytes through pipes, never command arguments, logs or temporary plaintext files. */
export function protectSession(value, decrypt = false) {
  if (process.platform !== 'win32') return Promise.reject(new TradeError('session-store-unavailable', '当前系统未配置登录凭据加密存储'))
  const operation = decrypt ? 'Unprotect' : 'Protect'
  const script = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$v=[Convert]::FromBase64String([Console]::In.ReadToEnd());$r=[Security.Cryptography.ProtectedData]::${operation}($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($r))`
  return new Promise((resolve, reject) => {
    const child = execFile(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
        if (error) reject(new TradeError('session-store-unavailable', '登录凭据加密存储不可用，未写入明文'))
        else resolve(Buffer.from(stdout.trim(), 'base64'))
      })
    child.stdin.on('error', () => { /* Process completion reports pipe failures without credential data. */ })
    child.stdin.end(value.toString('base64'))
  })
}

/** Atomic encrypted file owned by one account; normal shutdown does not remove it. */
export class AlipaySessionStore {
  constructor(path) { this.path = path }
  async load() {
    let raw
    try { raw = await readFile(this.path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    try {
      const value = JSON.parse((await protectSession(raw, true)).toString('utf8'))
      if (value.version !== 1 || !Array.isArray(value.authentication?.storageState?.cookies)
        || !value.authentication?.environment?.device?.userAgent) throw Error('Invalid session')
      return value.authentication
    } catch { throw new TradeError('session-store-invalid', '已保存的支付宝登录无法读取，请明确清除后重新登录') }
  }
  async save(authentication) {
    const encrypted = await protectSession(Buffer.from(JSON.stringify({ version: 1, authentication })))
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = this.path + '.' + randomUUID() + '.tmp'
    try { await writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' }); await rename(temporary, this.path) }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
  async clear() { await unlink(this.path).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}
