import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))

test('both marketplaces serve the same plugin directory', async () => {
  const claude = await json('../.claude-plugin/marketplace.json')
  const codex = await json('../.agents/plugins/marketplace.json')
  assert.equal(claude.name, codex.name)
  assert.deepEqual(
    claude.plugins.map(plugin => plugin.name),
    codex.plugins.map(plugin => plugin.name),
  )
  assert.equal(claude.plugins[0].source, './plugin')
  assert.deepEqual(codex.plugins[0].source, { source: 'local', path: './plugin' })
})

test('the plugin has one manifest, shared by both hosts, and no Codex manifest', async () => {
  const manifest = await json('../plugin/.claude-plugin/plugin.json')
  assert.equal(manifest.name, 'rex-session-names')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  const entries = await readdir(new URL('../plugin/', import.meta.url), { recursive: true })
  assert.ok(!entries.some(entry => entry.includes('.codex-plugin')))
})

test('the hook starts the watcher with the variable both hosts set', async () => {
  const hooks = await json('../plugin/hooks/hooks.json')
  const hook = hooks.hooks.SessionStart[0].hooks[0]
  assert.equal(hook.type, 'command')
  assert.equal(hook.command, 'node "${CLAUDE_PLUGIN_ROOT}/src/name-watcher.mjs" start')
  assert.equal(hook.async, true)
})

test('the marketplace entry names the manifest, and the hook script ships inside plugin/', async () => {
  const manifest = await json('../plugin/.claude-plugin/plugin.json')
  const marketplace = await json('../.claude-plugin/marketplace.json')
  assert.equal(marketplace.plugins[0].name, manifest.name)
  const entries = await readdir(new URL('../plugin/src/', import.meta.url))
  assert.ok(entries.includes('name-watcher.mjs'))
})

test('plugin source files import only each other and Node built-ins', async () => {
  const dir = new URL('../plugin/src/', import.meta.url)
  for (const name of await readdir(dir)) {
    const source = await readFile(new URL(name, dir), 'utf8')
    for (const [, specifier] of source.matchAll(/from '([^']+)'/g)) {
      assert.match(specifier, /^(node:[a-z_/]+|\.\/[a-z-]+\.mjs)$/, `${name} imports ${specifier}`)
    }
  }
})

test('the changelog leads with the manifest version', async () => {
  const { version } = await json('../plugin/.claude-plugin/plugin.json')
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  assert.equal(changelog.match(/^## \[(\S+)\]/m)[1], version)
})
