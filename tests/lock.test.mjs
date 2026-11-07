import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { claimLock } from '../codex/hooks/lock.mjs'

test('only one watcher can claim a server, and its PID file is private', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rex-lock-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'server.pid')
  const release = await claimLock(path)
  assert.equal(typeof release, 'function')
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.equal(await claimLock(path), undefined)
  assert.equal(await readFile(path, 'utf8'), String(process.pid))
  await release()
  await assert.rejects(stat(path), { code: 'ENOENT' })
})

test('an abandoned lock is reclaimed without racing a fresh partial write', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rex-lock-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'server.pid')
  await writeFile(path, '')
  assert.equal(await claimLock(path), undefined)
  const old = new Date(Date.now() - 10000)
  await utimes(path, old, old)
  const release = await claimLock(path)
  assert.equal(typeof release, 'function')
  await release()
})
