import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { parse, SessionNames } from './names.mjs'

const exec = promisify(execFile)
const filename = fileURLToPath(import.meta.url)

function rexArgs(server, args) {
  return ['--autostart=false', '--timeout', '2s', ...(server ? ['--server', server] : []), ...args]
}

function runner(server) {
  return async args => {
    try {
      return (
        await exec('rex', rexArgs(server, args), {
          timeout: 2500,
          maxBuffer: 4 * 1024 * 1024,
        })
      ).stdout
    } catch {
      return undefined
    }
  }
}

export async function claimLock(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600)
      await file.writeFile(String(process.pid))
      await file.close()
      return async () => {
        if ((await readFile(path, 'utf8').catch(() => '')) === String(process.pid))
          await unlink(path).catch(() => {})
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const pid = Number(await readFile(path, 'utf8').catch(() => ''))
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        const file = await stat(path).catch(() => undefined)
        if (!file || Date.now() - file.mtimeMs < 5000) return
        await unlink(path).catch(() => {})
        continue
      }
      try {
        process.kill(pid, 0)
        return
      } catch (error) {
        if (error.code !== 'ESRCH') return
      }
      await unlink(path).catch(() => {})
    }
  }
}

export async function watch(server, instance) {
  const data =
    process.env.REX_SESSION_NAMES_DATA ?? join(homedir(), '.local', 'state', 'rex-session-names')
  await mkdir(data, { recursive: true, mode: 0o700 })
  const key = createHash('sha256').update(`${server}/${instance}`).digest('hex').slice(0, 16)
  const release = await claimLock(join(data, `${key}.pid`))
  if (!release) return
  const stateFile = join(data, `${key}.json`)
  const run = runner(server)
  const saved = parse(await readFile(stateFile, 'utf8').catch(() => '{}'))
  const names = new SessionNames(
    run,
    saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {},
  )
  const persist = async () => {
    if (!names.dirty) return
    const temp = `${stateFile}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(Object.fromEntries(names.sessions)), {
      mode: 0o600,
    })
    await rename(temp, stateFile)
    names.dirty = false
  }
  const events = spawn('rex', rexArgs(server, ['events', '--all', '--json']), {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const lines = createInterface({ input: events.stdout })
  const input = lines[Symbol.asyncIterator]()
  const stop = () => events.kill('SIGTERM')
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  events.on('error', () => lines.close())
  try {
    const sessions = parse(await run(['ls', '--json']))?.sessions
    if (!Array.isArray(sessions)) return
    const live = new Set(sessions.map(session => session.session_id))
    for (const session of names.sessions.keys()) {
      if (!live.has(session)) {
        names.sessions.delete(session)
        names.dirty = true
      }
    }
    for (const session of sessions) await names.refresh(session.session_id)
    await persist()
    for await (const line of input) {
      await names.handle(parse(line))
      await persist()
    }
  } finally {
    stop()
    await persist()
    await release()
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGINT', stop)
  }
}

async function main() {
  if (process.argv[2] === 'watch') return watch(process.argv[3], process.argv[4])
  if (process.argv[2] !== 'start') throw new Error('Usage: node hooks/start.mjs start')
  const info = parse(await runner()(['whoami', '--json']))
  if (!info?.endpoint || !info?.instance_id) return
  const child = spawn(process.execPath, [filename, 'watch', info.endpoint, info.instance_id], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

if (process.argv[1] && resolve(process.argv[1]) === filename) {
  main().catch(error => {
    console.error(`rex-session-names: ${error.message}`)
    process.exitCode = 1
  })
}
