import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))

test('both hosts load the same plugin name and version', async () => {
  const claude = await json('../.claude-plugin/plugin.json')
  const marketplace = await json('../.agents/plugins/marketplace.json')
  const source = marketplace.plugins.find(plugin => plugin.name === 'rex-session-names').source
  assert.deepEqual(source, { source: 'local', path: './codex' })
  const codex = await json(`../${source.path}/.codex-plugin/plugin.json`)
  assert.equal(codex.name, claude.name)
  assert.equal(codex.version, claude.version)
})

test('each host starts the watcher with its own hook file', async () => {
  const claude = await json('../hooks/hooks.json')
  const codex = await json('../codex/hooks/start.json')
  for (const hooks of [claude, codex]) {
    const hook = hooks.hooks.SessionStart[0].hooks[0]
    assert.equal(hook.type, 'command')
    assert.match(hook.command, /watcher\.mjs" start$/)
    assert.equal(hook.async, true)
  }
})
