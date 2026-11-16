import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { link, open, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)

// Versions before 0.2.0 wrote the bare PID, so a plain integer is a lock from an older watcher.
const LEGACY_VERSION = '0.0.0'
const STOP_WAIT_MS = 3000
// The second form is the command line of a 0.1.0 watcher, which ran from the Codex copy of the plugin.
const WATCHER_COMMAND =
  /(?:name-watcher\.mjs|rex-session-names[^ ]*\/codex\/hooks\/watcher\.mjs) watch/
// Reclaiming a stale lock is serialised by a guard file, which a crashed claimant can leave behind.
const RECLAIM_GUARD_EXPIRY_MS = 10000

export function parseLock(text) {
  try {
    const info = JSON.parse(text)
    const held = Number.isSafeInteger(info) ? { pid: info, version: LEGACY_VERSION } : info
    return Number.isSafeInteger(held?.pid) && held.pid > 0 ? held : undefined
  } catch {
    return undefined
  }
}

export async function readLock(path) {
  return parseLock(await readFile(path, 'utf8').catch(() => ''))
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

// A recycled PID can belong to any process, so a lock only counts while its PID runs this script.
export async function isWatcher(pid) {
  try {
    const { stdout } = await exec('ps', ['-o', 'command=', '-p', String(pid)])
    return WATCHER_COMMAND.test(stdout)
  } catch (error) {
    return error.code === 'ENOENT' && isAlive(pid)
  }
}

export function compareVersions(a, b) {
  const numbers = version => String(version).split('-')[0].split('.').map(Number)
  const left = numbers(a)
  const right = numbers(b)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0)
    if (diff !== 0) return Math.sign(diff)
  }
  return 0
}

export async function terminate(pid) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  const deadline = Date.now() + STOP_WAIT_MS
  while (isAlive(pid) && Date.now() < deadline) await sleep(50)
  try {
    process.kill(pid, 'SIGKILL')
  } catch {}
}

// Hard-linking a finished file makes the lock appear with its content in one step.
async function create(path, info) {
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify({ ...info, pid: process.pid }), { mode: 0o600 })
  try {
    await link(temp, path)
  } finally {
    await unlink(temp).catch(() => {})
  }
}

// Only the claimant holding the guard may remove a stale lock, and only if it is still the one it judged stale.
async function reclaim(path, text) {
  const guard = `${path}.reclaim`
  let file
  try {
    file = await open(guard, 'wx', 0o600)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const age = Date.now() - ((await stat(guard).catch(() => undefined))?.mtimeMs ?? Date.now())
    if (age > RECLAIM_GUARD_EXPIRY_MS) await unlink(guard).catch(() => {})
    return false
  }
  try {
    if ((await readFile(path, 'utf8').catch(() => '')) === text) await unlink(path).catch(() => {})
  } finally {
    await file.close()
    await unlink(guard).catch(() => {})
  }
  return true
}

// Returns a release function, or undefined when a running watcher already holds the lock.
export async function claimLock(path, info = {}, holds = isWatcher) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await create(path, info)
      return async () => {
        if ((await readLock(path))?.pid === process.pid) await unlink(path).catch(() => {})
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const text = await readFile(path, 'utf8').catch(() => '')
      const held = parseLock(text)
      if (held && (await holds(held.pid))) return
      if (!(await reclaim(path, text))) return
    }
  }
}
