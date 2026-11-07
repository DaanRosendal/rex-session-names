import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionNames, sessionName } from '../codex/hooks/names.mjs'

const SESSION = 'session:s1'
const BLOCK = 'block:b1'
const TERMINAL = 'com.superlogical.terminal'

function agent(title = '⠹ Review MR 123 | project', pid = 10, app = 'codex') {
  return {
    title,
    foreground: { pid, name: app },
    owner: { pid, name: app },
    records: [],
  }
}

function setup(label = 'sparkling-creek', saved = {}) {
  const blocks = new Map([[BLOCK, agent()]])
  const session = { label }
  const calls = []
  const run = async args => {
    calls.push(args)
    const [noun, verb] = args
    if (noun === 'session' && verb === 'inspect') {
      return JSON.stringify({
        label: session.label,
        windows: [
          {
            window_id: 'window:w1',
            layers: [
              {
                blocks: [...blocks.keys()].map(block_id => ({
                  block_id,
                  creator_name: TERMINAL,
                })),
              },
            ],
          },
        ],
      })
    }
    if (noun === 'session' && verb === 'rename') {
      session.label = args.at(-1)
      return ''
    }
    if (noun === 'block' && verb === 'call') {
      const block = blocks.get(args[args.indexOf('-b') + 1])
      if (!block) return undefined
      const method = args.at(-1)
      if (method === 'process') return JSON.stringify({ foreground: block.foreground })
      if (method === 'title') return JSON.stringify({ title: block.title, owner: block.owner })
      if (method === 'program_status') return JSON.stringify({ records: block.records })
    }
  }
  return { blocks, session, calls, run, names: new SessionNames(run, saved) }
}

function event(type, payload = {}) {
  return {
    type: 'session_event',
    payload: { session_id: SESSION, event: { type, payload } },
  }
}

function titleEvent(title, block = BLOCK) {
  return event('block_event', {
    creator_name: TERMINAL,
    block_id: block,
    name: 'title_changed',
    payload: { title },
  })
}

for (const [title, expected] of [
  ['⠹ Review MR 123 | project', 'review-mr-123'],
  ['[ ! ] Action Required | Review MR 123 | project', 'review-mr-123'],
  ['[ . ] Action Required | Review MR 123 | project', 'review-mr-123'],
  ['✳ Fix login redirect', 'fix-login-redirect'],
  ['Fix the slow startup time', 'fix-the-slow-startup'],
  ['Déboguer café', 'deboguer-cafe'],
  ['$(touch /tmp/owned)', 'touch-tmp-owned'],
  ['Codex | project', ''],
  ['Claude Code', ''],
  ['New task', ''],
  ['', ''],
]) {
  test(`task title ${JSON.stringify(title)} produces ${JSON.stringify(expected)}`, () => {
    assert.equal(sessionName(title), expected)
  })
}

test('names a generated session from its agent terminal, never a tab', async () => {
  const { session, names, calls } = setup()
  await names.refresh(SESSION)
  assert.equal(session.label, 'review-mr-123')
  assert.ok(calls.some(args => args[0] === 'session' && args[1] === 'rename'))
  assert.ok(!calls.some(args => args[0] === 'window'))
})

test('follows real task changes and ignores spinner and question markers', async () => {
  const { blocks, session, names, calls } = setup()
  await names.refresh(SESSION)
  const before = calls.length
  await names.handle(titleEvent('⠸ Review MR 123 | project'))
  await names.handle(titleEvent('[ ! ] Action Required | Review MR 123 | project'))
  assert.equal(calls.length, before)
  blocks.get(BLOCK).title = 'Fix login redirect'
  await names.handle(titleEvent('Fix login redirect'))
  assert.equal(session.label, 'fix-login-redirect')
})

test('preserves existing names outside the generated-name pattern', async () => {
  const { session, names } = setup('my-release-notes')
  await names.refresh(SESSION)
  assert.equal(session.label, 'my-release-notes')
})

test('a manual two-word name remains pinned across task changes and worker restarts', async () => {
  const { blocks, session, names, run } = setup()
  await names.refresh(SESSION)
  session.label = 'release-notes'
  await names.handle(event('session_label_changed', { label: session.label }))
  blocks.get(BLOCK).title = 'Fix login redirect'
  await names.handle(titleEvent('Fix login redirect'))
  assert.equal(session.label, 'release-notes')
  const restarted = new SessionNames(run, Object.fromEntries(names.sessions))
  await restarted.refresh(SESSION)
  assert.equal(session.label, 'release-notes')
})

test('automatic ownership survives a worker restart', async () => {
  const { blocks, session, names, run } = setup()
  await names.refresh(SESSION)
  const restarted = new SessionNames(run, Object.fromEntries(names.sessions))
  blocks.get(BLOCK).title = 'Fix login redirect'
  await restarted.refresh(SESSION)
  assert.equal(session.label, 'fix-login-redirect')
})

test('renaming to auto explicitly releases a pinned session', async () => {
  const { session, names } = setup('release-notes', { [SESSION]: null })
  session.label = 'auto'
  await names.handle(event('session_label_changed', { label: 'auto' }))
  assert.equal(session.label, 'review-mr-123')
})

test('a background pane cannot steal an active agent pane ownership', async () => {
  const { blocks, session, names } = setup()
  await names.refresh(SESSION)
  blocks.set('block:b2', agent('Fix login redirect', 20))
  await names.handle(titleEvent('Fix login redirect', 'block:b2'))
  assert.equal(session.label, 'review-mr-123')
  blocks.get(BLOCK).foreground = { pid: 30, name: 'zsh' }
  await names.refresh(SESSION)
  assert.equal(session.label, 'fix-login-redirect')
})

test('Claude titles use the same naming rules', async () => {
  const { blocks, session, names } = setup()
  blocks.set(BLOCK, agent('✳ Fix login redirect', 10, 'claude'))
  await names.refresh(SESSION)
  assert.equal(session.label, 'fix-login-redirect')
})

test('native program status identifies an agent with a different executable name', async () => {
  const { blocks, session, names } = setup()
  const block = blocks.get(BLOCK)
  block.foreground.name = 'node'
  block.owner.name = 'node'
  block.records.push({ app: 'codex', owner: block.owner })
  await names.refresh(SESSION)
  assert.equal(session.label, 'review-mr-123')
})

test('ordinary terminals and stale title owners cannot name a session', async () => {
  const { blocks, session, names } = setup()
  const block = blocks.get(BLOCK)
  block.foreground.name = 'zsh'
  await names.refresh(SESSION)
  assert.equal(session.label, 'sparkling-creek')
  block.owner.name = 'zsh'
  await names.refresh(SESSION)
  assert.equal(session.label, 'sparkling-creek')
  block.records.push({ app: 'codex', owner: { pid: 99, name: 'codex' } })
  await names.refresh(SESSION)
  assert.equal(session.label, 'sparkling-creek')
})

test('a generic title waits for the task without claiming a name', async () => {
  const { blocks, session, names } = setup()
  blocks.get(BLOCK).title = 'Codex'
  await names.refresh(SESSION)
  assert.equal(session.label, 'sparkling-creek')
  blocks.get(BLOCK).title = 'Fix login redirect'
  await names.handle(titleEvent('Fix login redirect'))
  assert.equal(session.label, 'fix-login-redirect')
})

test('a manual rename during terminal inspection is preserved', async () => {
  const { session, run } = setup()
  const names = new SessionNames(async args => {
    if (args.at(-1) === 'title') session.label = 'release-notes'
    return run(args)
  })
  await names.refresh(SESSION)
  assert.equal(session.label, 'release-notes')
})

test('a queued event from an older automatic rename does not pin a newer name', async () => {
  const { blocks, session, names } = setup()
  await names.refresh(SESSION)
  blocks.get(BLOCK).title = 'Fix login redirect'
  await names.refresh(SESSION)
  await names.handle(event('session_label_changed', { label: 'review-mr-123' }))
  blocks.get(BLOCK).title = 'Repair database migration'
  await names.refresh(SESSION)
  assert.equal(session.label, 'repair-database-migration')
})

test('a failed rename is retried when the next agent status arrives', async () => {
  const { session, run } = setup()
  let fail = true
  const names = new SessionNames(args =>
    args[1] === 'rename' && fail ? Promise.resolve(undefined) : run(args),
  )
  await names.refresh(SESSION)
  assert.equal(session.label, 'sparkling-creek')
  fail = false
  await names.handle(
    event('block_event', {
      creator_name: TERMINAL,
      block_id: BLOCK,
      name: 'program_status_changed',
    }),
  )
  assert.equal(session.label, 'review-mr-123')
})

test('unreadable terminal metadata leaves the session name alone', async () => {
  const { session, run } = setup()
  const names = new SessionNames(args =>
    args.at(-1) === 'process' ? Promise.resolve(undefined) : run(args),
  )
  await names.refresh(SESSION)
  assert.equal(session.label, 'sparkling-creek')
})

test('an unreadable owner cannot hand its session name to a background pane', async () => {
  const { blocks, session, names, run } = setup()
  await names.refresh(SESSION)
  blocks.set('block:b2', agent('Background task', 20))
  const restarted = new SessionNames(
    args =>
      args.includes(BLOCK) && args.at(-1) === 'process' ? Promise.resolve(undefined) : run(args),
    Object.fromEntries(names.sessions),
  )
  await restarted.refresh(SESSION)
  assert.equal(session.label, 'review-mr-123')
})

test('destroyed sessions release their persisted ownership', async () => {
  const { names } = setup()
  await names.refresh(SESSION)
  await names.handle({
    type: 'session_destroyed',
    payload: { session_id: SESSION },
  })
  assert.deepEqual(Object.fromEntries(names.sessions), {})
})
