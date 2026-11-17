import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  claimLock,
  compareVersions,
  isAlive,
  isWatcher,
  parseLock,
  readLock,
  terminate,
} from '../plugin/src/lock.mjs'
import { idle } from './helpers/idle.mjs'

const running = async () => true
const dead = async () => false

async function lockPath(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rex-lock-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return join(dir, 'server.pid')
}

test('only one watcher can claim a server, and its lock is private', async t => {
  const path = await lockPath(t)
  const release = await claimLock(path, { version: '1.2.3' }, running)
  assert.equal(typeof release, 'function')
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.deepEqual(await readLock(path), { version: '1.2.3', pid: process.pid })
  assert.equal(await claimLock(path, {}, running), undefined)
  await release()
  await assert.rejects(stat(path), { code: 'ENOENT' })
  const next = await claimLock(path, {}, running)
  assert.equal(typeof next, 'function')
  await next()
})

test('simultaneous claims on a free lock have exactly one winner', async t => {
  const path = await lockPath(t)
  const results = await Promise.all(Array.from({ length: 8 }, () => claimLock(path, {}, running)))
  assert.equal(results.filter(Boolean).length, 1)
})

test('simultaneous claims on a stale lock have exactly one winner', async t => {
  const path = await lockPath(t)
  const holds = async pid => pid === process.pid
  for (let round = 0; round < 300; round++) {
    await writeFile(path, JSON.stringify({ pid: 999999999 }))
    const results = await Promise.all(Array.from({ length: 8 }, () => claimLock(path, {}, holds)))
    assert.equal(results.filter(Boolean).length, 1, `round ${round}`)
    await rm(path)
  }
})

test('a reclaim guard blocks other claimants until it expires', async t => {
  const path = await lockPath(t)
  await writeFile(path, JSON.stringify({ pid: 999999999 }))
  await writeFile(`${path}.reclaim`, '')
  assert.equal(await claimLock(path, {}, dead), undefined)
  const earlier = new Date(Date.now() - 60000)
  await utimes(`${path}.reclaim`, earlier, earlier)
  assert.equal(await claimLock(path, {}, dead), undefined, 'the expired guard is only cleared')
  const release = await claimLock(path, {}, dead)
  assert.equal(typeof release, 'function')
  await release()
})

test('a lock whose holder is gone is reclaimed', async t => {
  const path = await lockPath(t)
  await writeFile(path, JSON.stringify({ pid: 999999999, version: '0.1.0' }))
  const release = await claimLock(path, {}, dead)
  assert.equal((await readLock(path)).pid, process.pid)
  await release()
})

test('a legacy lock, an empty lock and a garbled lock are all reclaimed', async t => {
  for (const content of ['12345', '', '{"pid":']) {
    const path = await lockPath(t)
    await writeFile(path, content)
    const release = await claimLock(path, {}, dead)
    assert.equal(typeof release, 'function', JSON.stringify(content))
    await release()
  }
})

test('release leaves a lock that belongs to another process', async t => {
  const path = await lockPath(t)
  const release = await claimLock(path)
  await writeFile(path, JSON.stringify({ pid: process.pid + 1 }))
  await release()
  assert.equal((await readLock(path)).pid, process.pid + 1)
})

test('a plain PID from an older watcher reads as version 0.0.0', () => {
  assert.deepEqual(parseLock('4242'), { pid: 4242, version: '0.0.0' })
  assert.deepEqual(parseLock('{"pid":7,"version":"1.0.0"}'), { pid: 7, version: '1.0.0' })
  for (const bad of ['', 'null', '[]', '-5', '0', '1.5', '{"pid":"7"}', '{"pid":']) {
    assert.equal(parseLock(bad), undefined, bad)
  }
})

test('versions compare numerically', () => {
  assert.equal(compareVersions('0.1.0', '0.1.1'), -1)
  assert.equal(compareVersions('0.1.1', '0.2.0'), -1)
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1)
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1)
  assert.equal(compareVersions('0.2.0-beta.1', '0.2.0'), 0)
})

test('isWatcher recognises only a process running the watcher script', async t => {
  const watcher = idle(t, 'name-watcher.mjs', 'watch')
  const other = idle(t)
  const legacy = idle(
    t,
    '/cache/rex-session-names/rex-session-names/0.1.0/codex/hooks/watcher.mjs',
    'watch',
  )
  const sibling = idle(
    t,
    '/cache/rex-tab-status/rex-tab-status/1.0.0/plugin/src/watcher.mjs',
    'watch',
  )
  const hook = idle(t, 'name-watcher.mjs', 'start')
  assert.equal(await isWatcher(watcher.pid), true)
  assert.equal(await isWatcher(legacy.pid), true, 'a 0.1.0 watcher')
  assert.equal(await isWatcher(sibling.pid), false, 'the watcher of another plugin')
  assert.equal(await isWatcher(hook.pid), false, 'a start hook')
  assert.equal(await isWatcher(other.pid), false)
  assert.equal(await isWatcher(999999999), false)
})

test('terminate stops a process and ignores one that is already gone', async t => {
  const child = idle(t)
  const exited = new Promise(done => child.once('exit', done))
  await terminate(child.pid)
  await exited
  assert.equal(isAlive(child.pid), false)
  await terminate(child.pid)
})
