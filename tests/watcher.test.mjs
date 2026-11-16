import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const manifest = fileURLToPath(new URL('../plugin/.claude-plugin/plugin.json', import.meta.url))
const plugin = fileURLToPath(new URL('../plugin/src/name-watcher.mjs', import.meta.url))

async function fakeRex(dir) {
  const bin = join(dir, 'bin')
  await mkdir(bin)
  await writeFile(
    join(bin, 'rex'),
    `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(process.env.FAKE_REX_LOG, args.join(' ') + '\\n')
const out = text => process.stdout.write((text ?? '') + '\\n')
if (args.includes('events')) {
  for (const line of JSON.parse(process.env.FAKE_REX_EVENTS ?? '[]')) out(line)
} else if (args.includes('whoami')) {
  if (process.env.FAKE_REX_DOWN) process.exit(1)
  const counter = process.env.FAKE_REX_LOG + '.whoami'
  let calls = 0
  try { calls = Number(readFileSync(counter, 'utf8')) } catch {}
  writeFileSync(counter, String(calls + 1))
  const instances = JSON.parse(process.env.FAKE_REX_INSTANCES)
  out(JSON.stringify({ endpoint: 'unix:///fake', instance_id: instances[Math.min(calls, instances.length - 1)] }))
}
else if (args.includes('window')) out(process.env.FAKE_REX_WINDOWS)
else if (args.includes('inspect')) out(process.env.FAKE_REX_VIEW)
else if (args.includes('ls')) out(process.env.FAKE_REX_SESSIONS)
else if (args.includes('call')) out('{}')
`,
  )
  await chmod(join(bin, 'rex'), 0o755)
  return bin
}

const withoutRexVariables = env =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('REX_')))

async function scenario(run) {
  const dir = await mkdtemp(join(tmpdir(), 'rex-session-names-fake-'))
  let env
  try {
    const bin = await fakeRex(dir)
    const log = join(dir, 'calls.log')
    await writeFile(log, '')
    env = {
      ...withoutRexVariables(process.env),
      PATH: bin + delimiter + process.env.PATH,
      REX_SESSION_NAMES_DATA: join(dir, 'data'),
      FAKE_REX_LOG: log,
      FAKE_REX_INSTANCES: JSON.stringify(['fake', 'next']),
    }
    await run({
      dir,
      env,
      calls: async () => (await readFile(log, 'utf8')).split('\n').filter(Boolean),
    })
  } finally {
    await exec(process.execPath, [plugin, 'stop'], { env }).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

const WAIT_MS = 5000

async function until(check, what) {
  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await sleep(25)
  }
  assert.fail(`timed out waiting for ${what}`)
}

const lockFile = dir =>
  join(
    dir,
    'data',
    `${createHash('sha256').update('unix:///fake/fake').digest('hex').slice(0, 16)}.pid`,
  )

// Extra arguments after the script show up in the process command line, which is how a watcher is recognised.
function idle(t, ...marker) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)', ...marker], {
    stdio: 'ignore',
  })
  t.after(() => child.kill('SIGKILL'))
  return child
}

const alive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function holdLock(dir, content) {
  await mkdir(join(dir, 'data'), { recursive: true })
  await writeFile(lockFile(dir), content)
}

const watcherLock = (dir, not) =>
  until(async () => {
    const lock = JSON.parse(await readFile(lockFile(dir), 'utf8').catch(() => 'null'))
    return lock?.pid && lock.pid !== not && lock
  }, 'a new watcher')

const start = env => exec(process.execPath, [plugin, 'start'], { env: { ...env, REX_SERVER: 'x' } })

const sessionCreated = id =>
  JSON.stringify({ type: 'session_created', payload: { session: { session_id: id } } })

test('the watcher survives malformed Rex data and keeps reading events', async () => {
  await scenario(async ({ dir, env, calls }) => {
    Object.assign(env, {
      FAKE_REX_INSTANCES: JSON.stringify(['next']),
      FAKE_REX_SESSIONS: JSON.stringify({ sessions: [null, 5, { session_id: 'session:a' }] }),
      FAKE_REX_VIEW: JSON.stringify({
        label: 'quiet-pine',
        windows: [null, { layers: null }, { layers: [null, { blocks: null }] }],
      }),
      FAKE_REX_EVENTS: JSON.stringify([
        'not json',
        'null',
        JSON.stringify({ type: 'session_destroyed', payload: {} }),
        JSON.stringify({
          type: 'session_event',
          payload: { session_id: 'session:a', event: { type: 'block_event', payload: null } },
        }),
        sessionCreated('session:b'),
      ]),
    })
    const { stderr } = await exec(process.execPath, [plugin, 'watch', 'unix:///fake', 'fake'], {
      env,
    })
    assert.equal(stderr, '')
    assert.ok(
      (await calls()).some(call => call.includes('inspect session:b')),
      'the event after the bad ones was handled',
    )
    assert.deepEqual(
      (await readdir(join(dir, 'data'))).filter(name => name.endsWith('.pid')),
      [],
    )
  })
})

test('a failing state write neither stops the watcher nor leaves its lock behind', async () => {
  await scenario(async ({ dir, env, calls }) => {
    const key = createHash('sha256').update('unix:///fake/fake').digest('hex').slice(0, 16)
    await mkdir(join(dir, 'data', `${key}.json`), { recursive: true })
    Object.assign(env, {
      FAKE_REX_INSTANCES: JSON.stringify(['next']),
      FAKE_REX_SESSIONS: JSON.stringify({ sessions: [{ session_id: 'session:a' }] }),
      FAKE_REX_VIEW: JSON.stringify({ label: 'quiet-pine', windows: [] }),
      FAKE_REX_EVENTS: JSON.stringify([
        JSON.stringify({
          type: 'session_event',
          payload: { session_id: 'session:a', event: { type: 'session_label_changed' } },
        }),
        sessionCreated('session:b'),
      ]),
    })
    const { stderr } = await exec(process.execPath, [plugin, 'watch', 'unix:///fake', 'fake'], {
      env,
    })
    assert.equal(stderr, '')
    assert.ok(
      (await calls()).some(call => call.includes('inspect session:b')),
      'the event after the failed write was handled',
    )
    assert.deepEqual(
      (await readdir(join(dir, 'data'))).filter(name => name.endsWith('.pid')),
      [],
    )
  })
})

test('start does nothing outside a Rex terminal', async () => {
  await scenario(async ({ env, calls }) => {
    await exec(process.execPath, [plugin, 'start'], { env })
    assert.deepEqual(await calls(), [])
  })
})

for (const variable of ['REX_SESSION', 'REX_BLOCK', 'REX_SERVER']) {
  test(`start asks Rex for its endpoint when ${variable} is set`, async () => {
    await scenario(async ({ dir, env, calls }) => {
      await exec(process.execPath, [plugin, 'start'], {
        env: { ...env, [variable]: 'unix:///fake' },
      })
      await watcherLock(dir)
      assert.ok((await calls()).some(call => call.includes('whoami')))
    })
  })
}

test('the watcher reconnects when the event stream ends', async () => {
  await scenario(async ({ dir, env, calls }) => {
    Object.assign(env, {
      FAKE_REX_SESSIONS: JSON.stringify({ sessions: [{ session_id: 'session:a' }] }),
      FAKE_REX_VIEW: JSON.stringify({ label: 'quiet-pine', windows: [] }),
      FAKE_REX_EVENTS: JSON.stringify([sessionCreated('session:b')]),
    })
    await exec(process.execPath, [plugin, 'watch', 'unix:///fake', 'fake'], { env })
    const log = await calls()
    assert.equal(log.filter(call => call.includes(' events ')).length, 2)
    assert.equal(log.filter(call => call.includes(' ls ')).length, 2)
    await assert.rejects(readFile(lockFile(dir)), { code: 'ENOENT' })
  })
})

test('SIGTERM stops a watcher that is waiting to reconnect and releases its lock', async t => {
  await scenario(async ({ dir, env, calls }) => {
    Object.assign(env, {
      FAKE_REX_INSTANCES: JSON.stringify(['fake']),
      FAKE_REX_SESSIONS: JSON.stringify({ sessions: [] }),
    })
    const watcher = spawn(process.execPath, [plugin, 'watch', 'unix:///fake', 'fake'], {
      env,
      stdio: 'ignore',
    })
    t.after(() => watcher.kill('SIGKILL'))
    const exited = new Promise(done => watcher.once('exit', done))
    await until(async () => (await calls()).some(call => call.includes(' events ')), 'a stream')
    watcher.kill('SIGTERM')
    await exited
    await assert.rejects(readFile(lockFile(dir)), { code: 'ENOENT' })
  })
})

test('start replaces a running watcher of an older version', async t => {
  await scenario(async ({ dir, env }) => {
    const old = idle(t, 'name-watcher.mjs', 'watch')
    await holdLock(dir, JSON.stringify({ pid: old.pid, version: '0.0.1' }))
    await start(env)
    assert.equal(alive(old.pid), false)
    const held = await watcherLock(dir, old.pid)
    assert.equal(held.version, JSON.parse(await readFile(manifest, 'utf8')).version)
  })
})

test('start replaces a legacy watcher that wrote only its PID', async t => {
  await scenario(async ({ dir, env }) => {
    const old = idle(
      t,
      '/cache/rex-session-names/rex-session-names/0.1.0/codex/hooks/watcher.mjs',
      'watch',
    )
    await holdLock(dir, String(old.pid))
    await start(env)
    assert.equal(alive(old.pid), false)
    await watcherLock(dir, old.pid)
  })
})

test('start leaves a watcher of the same or a newer version running', async t => {
  await scenario(async ({ dir, env, calls }) => {
    env.FAKE_REX_INSTANCES = JSON.stringify(['fake'])
    const current = JSON.parse(await readFile(manifest, 'utf8')).version
    for (const version of [current, '99.0.0']) {
      const running = idle(t, 'name-watcher.mjs', 'watch')
      const content = JSON.stringify({ pid: running.pid, version })
      await holdLock(dir, content)
      await start(env)
      assert.equal(alive(running.pid), true)
      assert.equal(await readFile(lockFile(dir), 'utf8'), content)
    }
    assert.equal(
      (await calls()).filter(call => call.includes(' events ')).length,
      0,
      'no new watcher ran',
    )
  })
})

test('start ignores a lock whose PID now belongs to an unrelated process', async t => {
  await scenario(async ({ dir, env }) => {
    const stranger = idle(t)
    await holdLock(dir, JSON.stringify({ pid: stranger.pid, version: '0.0.1' }))
    await start(env)
    assert.equal(alive(stranger.pid), true)
    await watcherLock(dir, stranger.pid)
  })
})

test('stop ends every watcher, clears locks and spares unrelated processes', async t => {
  await scenario(async ({ dir, env }) => {
    const watcher = idle(t, 'name-watcher.mjs', 'watch')
    await holdLock(dir, JSON.stringify({ pid: watcher.pid, version: '0.1.0' }))
    const { stdout } = await exec(process.execPath, [plugin, 'stop'], { env })
    assert.equal(stdout.trim(), 'Stopped 1 watcher(s).')
    assert.equal(alive(watcher.pid), false)
    await assert.rejects(readFile(lockFile(dir)), { code: 'ENOENT' })

    const stranger = idle(t)
    await holdLock(dir, JSON.stringify({ pid: stranger.pid }))
    const again = await exec(process.execPath, [plugin, 'stop'], { env })
    assert.equal(again.stdout.trim(), 'No watcher is running.')
    assert.equal(alive(stranger.pid), true)
    await assert.rejects(readFile(lockFile(dir)), { code: 'ENOENT' })
  })
})

test('doctor reports Rex, the plugin version and each watcher', async t => {
  await scenario(async ({ dir, env }) => {
    const watcher = idle(t, 'name-watcher.mjs', 'watch')
    await holdLock(dir, JSON.stringify({ pid: watcher.pid, version: '0.1.0' }))
    const { stdout } = await exec(process.execPath, [plugin, 'doctor'], { env })
    assert.match(stdout, /Plugin version: \d+\.\d+\.\d+/)
    assert.match(stdout, /Rex: reachable at unix:\/\/\/fake/)
    assert.match(stdout, new RegExp(`running, pid ${watcher.pid}, version 0\\.1\\.0`))

    await assert.rejects(
      exec(process.execPath, [plugin, 'doctor'], { env: { ...env, FAKE_REX_DOWN: '1' } }),
      {
        code: 1,
        stdout: /Rex: not reachable/,
      },
    )
  })
})
