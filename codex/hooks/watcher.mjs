import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { claimLock } from './lock.mjs'
import { parse, SessionNames } from './names.mjs'
import { rexArgs, runner } from './rex-cli.mjs'

const filename = fileURLToPath(import.meta.url)

async function safely(task) {
  try {
    await task()
  } catch {}
}

async function watch(server, instance) {
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
    names.markClean()
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
    const ids = sessions.map(session => session?.session_id).filter(id => typeof id === 'string')
    names.prune(new Set(ids))
    for (const id of ids) await safely(() => names.refresh(id))
    await safely(persist)
    for await (const line of input) {
      await safely(() => names.handle(parse(line)))
      await safely(persist)
    }
  } finally {
    stop()
    try {
      await safely(persist)
    } finally {
      await release()
      process.removeListener('SIGTERM', stop)
      process.removeListener('SIGINT', stop)
    }
  }
}

async function main() {
  if (process.argv[2] === 'watch') return watch(process.argv[3], process.argv[4])
  if (process.argv[2] !== 'start') throw new Error('Usage: node hooks/watcher.mjs start')
  if (!process.env.REX_SESSION && !process.env.REX_BLOCK && !process.env.REX_SERVER) return
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
