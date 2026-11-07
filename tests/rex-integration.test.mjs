import assert from 'node:assert/strict'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const skip = spawnSync('rex', ['--help'], { stdio: 'ignore' }).status === 0 ? false : 'rex is not installed'
const plugin = fileURLToPath(new URL('../codex/hooks/start.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/agent-terminal.mjs', import.meta.url))

async function eventually(check) {
  const deadline = Date.now() + 8000
  let error
  while (Date.now() < deadline) {
    try {
      await check()
      return
    } catch (e) {
      error = e
      await setTimeout(50)
    }
  }
  throw error
}

test(
  'real Rex events name sessions despite stale environment and preserve manual names across restarts',
  { timeout: 45000, skip },
  async () => {
    const dir = await mkdtemp('/tmp/rex-session-names-test-')
    const endpoint = `unix://${dir}/server.sock`
    const data = join(dir, 'plugin-data')
    const env = {
      ...process.env,
      REX_SERVER: endpoint,
      REX_SESSION: 'session:obsolete',
      REX_BLOCK: 'block:obsolete',
      REX_SESSION_NAMES_DATA: data,
    }
    const run = async args =>
      (
        await exec('rex', ['--server', endpoint, '--autostart=false', '--timeout', '3s', ...args], {
          env,
          timeout: 5000,
        })
      ).stdout
    let worker
    let exited
    let started = false
    let errors = ''
    const startWorker = instance => {
      worker = spawn(process.execPath, [plugin, 'watch', endpoint, instance], {
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      worker.stderr.on('data', chunk => {
        errors += chunk
      })
      exited = once(worker, 'exit')
    }
    const stopWorker = async () => {
      worker.kill('SIGTERM')
      const [code] = await exited
      worker = undefined
      assert.equal(code, 0, errors)
    }
    try {
      await writeFile(join(dir, 'init.lua'), '')
      await run([
        'server',
        'start',
        '--state-dir',
        join(dir, 'state'),
        '--config',
        join(dir, 'init.lua'),
      ])
      started = true
      const info = JSON.parse(await run(['whoami', '--json']))
      const created = JSON.parse(
        await run(['new', '--shell=none', '--json', '--', process.execPath, fixture]),
      )
      const session = created.session_id
      const block = created.initial_windows[0].block_ids[0]
      const label = async () =>
        JSON.parse(await run(['session', 'inspect', session, '--json'])).label
      const send = async (input, target = block) => {
        await run(['send', '-s', session, '-b', target, JSON.stringify(input)])
        await run(['send-key', '-s', session, '-b', target, 'enter'])
      }

      startWorker(info.instance_id)
      await eventually(async () => assert.equal(await label(), 'review-mr-123'))
      await Promise.all([
        exec(process.execPath, [plugin, 'start'], { env }),
        exec(process.execPath, [plugin, 'start'], { env }),
      ])
      const locks = (await readdir(data)).filter(name => name.endsWith('.pid'))
      assert.equal(locks.length, 1)
      assert.equal(await readFile(join(data, locks[0]), 'utf8'), String(worker.pid))

      await send({ title: 'Fix login redirect | project' })
      await eventually(async () => assert.equal(await label(), 'fix-login-redirect'))
      const sibling = JSON.parse(
        await run([
          'split',
          '-s',
          session,
          '-b',
          block,
          '--shell=none',
          '--json',
          '--',
          process.execPath,
          fixture,
        ]),
      )
      const other = sibling.block_ids.find(id => id !== block)
      assert.ok(other)
      await send({ title: 'Background build task' }, other)
      await eventually(async () => {
        const title = JSON.parse(await run(['block', 'call', '-s', session, '-b', other, 'title']))
        assert.equal(title.title, 'Background build task')
        assert.equal(await label(), 'fix-login-redirect')
      })

      await run(['session', 'rename', session, 'release-notes'])
      await send({ title: 'Repair database migration' })
      await stopWorker()
      startWorker(info.instance_id)
      await send({ title: 'A different task' })
      const stateFile = join(data, locks[0].replace(/\.pid$/, '.json'))
      await eventually(async () =>
        assert.equal(JSON.parse(await readFile(stateFile, 'utf8'))[session], null),
      )
      assert.equal(await label(), 'release-notes')

      await run(['session', 'rename', session, 'auto'])
      await eventually(async () => assert.equal(await label(), 'a-different-task'))
      await send({ exit: true })
      await eventually(async () => assert.equal(await label(), 'background-build-task'))

      const fresh = JSON.parse(
        await run(['new', '--shell=none', '--json', '--', process.execPath, fixture]),
      )
      await eventually(async () => {
        const view = JSON.parse(await run(['session', 'inspect', fresh.session_id, '--json']))
        assert.equal(view.label, 'review-mr-123')
      })

      const custom = JSON.parse(
        await run([
          'new',
          'my-release-notes',
          '--shell=none',
          '--json',
          '--',
          process.execPath,
          fixture,
        ]),
      )
      await stopWorker()
      assert.equal(
        JSON.parse(await run(['session', 'inspect', custom.session_id, '--json'])).label,
        'my-release-notes',
      )
      assert.equal(await label(), 'background-build-task')
      assert.equal(errors, '')
    } finally {
      if (worker) {
        worker.kill('SIGTERM')
        await exited
      }
      if (started) await run(['server', 'stop'])
      await rm(dir, { recursive: true, force: true })
    }
  },
)
