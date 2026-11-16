import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { claimLock, compareVersions, isWatcher, readLock, terminate } from './lock.mjs'
import { parse, SessionNames } from './names.mjs'
import { rexArgs, runner } from './rex-cli.mjs'

const filename = fileURLToPath(import.meta.url)
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30000
const MAX_FAILED_RECONNECTS = 20
// A stream that ends sooner than this without delivering an event counts as a failed connection.
const HEALTHY_STREAM_MS = 30000

const dataDir = () =>
  process.env.REX_SESSION_NAMES_DATA ?? join(homedir(), '.local', 'state', 'rex-session-names')

function paths(server, instance) {
  const key = createHash('sha256').update(`${server}/${instance}`).digest('hex').slice(0, 16)
  return { lockPath: join(dataDir(), `${key}.pid`), stateFile: join(dataDir(), `${key}.json`) }
}

async function version() {
  const manifest = new URL('../.claude-plugin/plugin.json', import.meta.url)
  return JSON.parse(await readFile(manifest, 'utf8')).version
}

async function safely(task) {
  try {
    await task()
  } catch {}
}

async function watch(server, instance) {
  await mkdir(dataDir(), { recursive: true, mode: 0o700 })
  const { lockPath, stateFile } = paths(server, instance)
  const release = await claimLock(lockPath, {
    version: await version(),
    startedAt: new Date().toISOString(),
  })
  if (!release) return
  const run = runner(server)
  const saved = parse(await readFile(stateFile, 'utf8').catch(() => undefined))
  const names = new SessionNames(run, saved)
  const persist = async () => {
    if (!names.dirty) return
    const temp = `${stateFile}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(Object.fromEntries(names.sessions)), {
      mode: 0o600,
    })
    await rename(temp, stateFile)
    names.markClean()
  }
  let events
  let stopping = false
  const abort = new AbortController()
  const stop = () => {
    stopping = true
    events?.kill('SIGTERM')
    abort.abort()
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)

  try {
    let delay = RECONNECT_MIN_MS
    let failures = 0
    while (!stopping) {
      const connectedAt = Date.now()
      events = spawn('rex', rexArgs(server, ['events', '--all', '--json']), {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const closed = new Promise(done => {
        events.once('close', done)
        events.once('error', done)
      })
      // The iterator must exist before any await, or a stream that ends early never finishes it.
      const lines = createInterface({ input: events.stdout })[Symbol.asyncIterator]()
      const sessions = parse(await run(['ls', '--json']))?.sessions
      if (Array.isArray(sessions)) {
        const ids = sessions
          .map(session => session?.session_id)
          .filter(id => typeof id === 'string')
        names.prune(new Set(ids))
        for (const id of ids) if (!stopping) await safely(() => names.refresh(id))
        await safely(persist)
      }
      let received = false
      for await (const line of lines) {
        if (stopping) break
        received = true
        await safely(() => names.handle(parse(line)))
        await safely(persist)
      }
      await closed
      if (stopping) break
      if (received) delay = RECONNECT_MIN_MS
      await sleep(delay, undefined, { signal: abort.signal }).catch(() => {})
      delay = Math.min(delay * 2, RECONNECT_MAX_MS)
      if (stopping) break
      const current = parse(await run(['whoami', '--json']))
      if (current && current.instance_id !== instance) break
      const healthy = received || Date.now() - connectedAt > HEALTHY_STREAM_MS
      failures = current && healthy ? 0 : failures + 1
      if (failures >= MAX_FAILED_RECONNECTS) break
    }
  } finally {
    stop()
    await safely(persist)
    await release()
  }
}

// Runs from the SessionStart hook, which must print nothing and never fail the session.
async function start() {
  if (!process.env.REX_SESSION && !process.env.REX_BLOCK && !process.env.REX_SERVER) return
  const info = parse(await runner()(['whoami', '--json']))
  if (!info?.endpoint || !info?.instance_id) return
  const held = await readLock(paths(info.endpoint, info.instance_id).lockPath)
  if (held && (await isWatcher(held.pid))) {
    if (compareVersions(await version(), held.version ?? '0') <= 0) return
    await terminate(held.pid)
  }
  const child = spawn(process.execPath, [filename, 'watch', info.endpoint, info.instance_id], {
    cwd: homedir(),
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

async function locks() {
  const found = []
  for (const name of (await readdir(dataDir()).catch(() => [])).filter(n => n.endsWith('.pid'))) {
    const path = join(dataDir(), name)
    const held = await readLock(path)
    found.push({ path, held, running: held ? await isWatcher(held.pid) : false })
  }
  return found
}

async function stopAll() {
  let stopped = 0
  for (const { path, held, running } of await locks()) {
    if (running) {
      await terminate(held.pid)
      stopped++
    }
    await unlink(path).catch(() => {})
  }
  console.log(stopped === 0 ? 'No watcher is running.' : `Stopped ${stopped} watcher(s).`)
}

async function doctor() {
  const info = parse(await runner()(['whoami', '--json']))
  console.log(`Plugin version: ${await version()}`)
  console.log(`Data directory: ${dataDir()}`)
  console.log(
    info?.endpoint ? `Rex: reachable at ${info.endpoint}` : 'Rex: not reachable. Is Rex running?',
  )
  const found = await locks()
  if (found.length === 0) console.log('Watchers: none')
  for (const { path, held, running } of found) {
    const state = running ? `running, pid ${held.pid}, version ${held.version}` : 'stale'
    console.log(`Watcher ${path.split('/').pop()}: ${state}`)
  }
  if (!info?.endpoint) process.exitCode = 1
}

async function main() {
  const [command, server, instance] = process.argv.slice(2)
  if (command === 'watch') return watch(server, instance)
  if (command === 'start') return start()
  if (command === 'stop') return stopAll()
  if (command === 'doctor') return doctor()
  throw new Error('Usage: node name-watcher.mjs start|stop|doctor')
}

if (process.argv[1] && resolve(process.argv[1]) === filename) {
  main().catch(error => {
    console.error(`rex-session-names: ${error.message}`)
    process.exitCode = 1
  })
}
