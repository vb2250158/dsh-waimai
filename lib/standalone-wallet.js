/** Official order-independent wallet setup for the standalone service. No credentials enter settings files. */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { writeJsonState } from './automation.js'

const settingsSchema = z.object({ version: z.literal(1), provider: z.enum(['alipay-wallet', 'alipay-h5']), maxAmountCents: z.number().int().positive().safe() }).strict()
const commands = { status: 'check-wallet', start: 'apply-wallet', bind: 'bind-wallet' }

/** Accept only the terminal JSON result from the official CLI, never diagnostic log lines. */
export function walletReceipt(stdout) {
  try {
    const value = JSON.parse(stdout.slice(stdout.lastIndexOf('\n{') + 1))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch { return null }
}

/** Safe public wallet state; neither tokens nor arbitrary provider messages are forwarded. */
export function walletView(raw) {
  if (raw?.code === 200 && raw.message === '已开启支付宝支付功能') return { state: 'authorized' }
  if (raw?.code === 200 && raw.status === 'applied_unbound') return { state: 'pending' }
  if (raw?.code === 500 && raw.message === '未开通') return { state: 'unbound' }
  return { state: 'unavailable' }
}

/** Local saved payment policy and private official-wallet commands, serialized across browser clients. */
export class StandaloneWallet {
  constructor({ directory, executable, capCents, run }) {
    this.path = join(directory, 'payment-settings.json'); this.executable = executable; this.capCents = capCents
    this.runCli = run || (args => this.execute(args)); this.queue = Promise.resolve()
  }
  execute(args) {
    if (!this.executable || !isAbsolute(this.executable)) return Promise.reject(Error('Wallet CLI unavailable'))
    return new Promise((resolveResult, reject) => {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        /^(SystemRoot|WINDIR|APPDATA|LOCALAPPDATA|USERPROFILE|HOMEDRIVE|HOMEPATH|HOME|TEMP|TMP|PATH|PATHEXT)$/i.test(key)))
      execFile(this.executable, [...args, '--json'], { encoding: 'utf8', timeout: 30000, maxBuffer: 1048576,
        shell: false, windowsHide: true, env }, (error, stdout) => {
        const result = walletReceipt(stdout)
        if (result) resolveResult(result)
        else reject(Error(error ? 'Wallet command failed' : 'Wallet response invalid'))
      })
    })
  }
  async saved() {
    try { return settingsSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))) }
    catch (error) { if (error.code === 'ENOENT') return null; throw Error('Payment settings unreadable') }
  }
  async inspect() {
    const settings = await this.saved()
    const wallet = settings?.provider === 'alipay-h5' ? { state: 'h5-configured' }
      : this.executable ? walletView(await this.runCli(['check-wallet'])) : { state: 'not-installed' }
    return { ...wallet, configured: Boolean(settings), provider: settings?.provider ?? null,
      maxAmountCents: settings?.maxAmountCents ?? this.capCents, serviceCapCents: this.capCents,
      policyReady: Boolean(settings && settings.maxAmountCents <= this.capCents && ['authorized', 'h5-configured'].includes(wallet.state)),
      ready: Boolean(settings && settings.maxAmountCents <= this.capCents && wallet.state === 'authorized') }
  }
  configure(args) {
    const task = this.queue.then(async () => {
      if (args.operation === 'save') {
        const settings = settingsSchema.parse({ version: 1, provider: args.provider ?? 'alipay-wallet', maxAmountCents: args.maxAmountCents })
        if (settings.maxAmountCents > this.capCents) throw Error('Payment cap exceeded')
        if (settings.provider === 'alipay-wallet' && walletView(await this.runCli(['check-wallet'])).state !== 'authorized') throw Error('Wallet not authorized')
        await writeJsonState(this.path, settings)
        return this.inspect()
      }
      if (!Object.hasOwn(commands, args.operation)) throw Error('Invalid wallet operation')
      if (args.operation === 'status') return this.inspect()
      const raw = await this.runCli(args.operation === 'start' ? ['apply-wallet', '--agent-name', '外卖助手'] : ['bind-wallet', '-c', args.code])
      const view = walletView(raw)
      if (args.operation === 'start' && typeof raw.accessUrl === 'string') {
        const url = new URL(raw.accessUrl)
        if (url.protocol !== 'https:' || url.hostname !== 'u.alipay.cn' || url.username || url.password || url.port) throw Error('Invalid wallet destination')
        const result = { state: 'pending', authorizationUrl: url.href }
        const root = resolve(tmpdir(), 'openclaw', 'alipay-bot-cli', 'qrcode') + sep
        const path = raw.mediaPaths?.length === 1 && raw.mediaPaths[0]
        if (typeof path === 'string' && resolve(path).startsWith(root) && path.endsWith('.png')) {
          const bytes = await readFile(path)
          if (bytes.length <= 262144 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) result.qrImage = 'data:image/png;base64,' + bytes.toString('base64')
        }
        return result
      }
      return view
    })
    this.queue = task.then(() => {}, () => {})
    return task
  }
  /** Validate saved policy and amount only; H5 account checks belong to the service gate before new orders. */
  async requireReady(amountCents) {
    const state = await this.configure({ operation: 'status' })
    if (!state.policyReady || !Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > Math.min(state.maxAmountCents, this.capCents)) {
      throw Error('Complete payment settings before buying')
    }
    return state
  }
}
