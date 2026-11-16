# AGENTS.md

A plugin for Claude Code and Codex that names Rex sessions after the agent's task. One background watcher follows terminal titles and process events, so no per-agent code exists. README.md describes the behavior.

## Layout

- `plugin/` is the only directory the hosts install. It holds the manifest, the SessionStart hook and the watcher in `src/`.
- `names.mjs` turns a terminal title into a name (`sessionName`) and decides when to rename a session (`SessionNames`). It never calls Rex directly, it uses the runner it is given.
- `name-watcher.mjs` is the entry point: `start` (the hook), `watch`, `stop` and `doctor`. Run `doctor` as `node plugin/src/name-watcher.mjs doctor`.
- `lock.mjs` is the per-server lock and `rex-cli.mjs` runs `rex`.
- `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` both point at `./plugin`. There is one manifest, `plugin/.claude-plugin/plugin.json`, and Codex reads it too.
- `tests/watcher.test.mjs` holds a fake `rex` script. `tests/names.test.mjs` uses an in-memory fake Rex.

## Commands

- `npm test`: unit tests. Needs Node 22 or newer.
- `npm run test:integration`: needs a real `rex` on the `PATH`. It starts its own server and emulates an agent.
- `npm run validate`: `claude plugin validate` on the plugin and the marketplace. Needs the `claude` CLI.
- `npm run format`: Prettier. CI fails on unformatted files.

## Gotchas

- The hook must print nothing, because Claude adds its output to the conversation.
- A running watcher keeps its old code after an update. `start` replaces it when the plugin version is higher, so bump the version for every change that users should receive. A dev checkout keeps the same version, so run `node plugin/src/name-watcher.mjs stop` after editing.
- A lock file only names a holder when its pid is a process running `name-watcher.mjs watch` (or the 0.1.0 `codex/hooks/watcher.mjs watch`), because a recycled pid must neither block a claim nor be sent a signal. A stale lock is removed under a guard file so two claimers never remove each other's.
- The script name is `name-watcher.mjs`, not `watcher.mjs`, so the pid check never matches rex-tab-status.
- The plugin renames sessions, never tabs. A session whose label is not in Rex's generated style (two lowercase words) is left alone, and a label we did not write marks the session as renamed by someone else. Renaming a session to `auto` hands it back.
- A `rex session rename` that times out may still have been applied, so `refresh` inspects the label again before it decides someone else renamed the session.
- State is keyed by Rex endpoint and instance id. The watcher exits when the instance id changes, and the next session start launches a new one.
- Codex reads `.claude-plugin/plugin.json` only because the plugin has no `.codex-plugin/`. Never add a partial `.codex-plugin/plugin.json`.
- Hosts copy and fingerprint the whole plugin directory. Keep it to the files the manifest test lists, and import only Node built-ins and sibling files.

## Style

- Comments state timeless facts about the code, never the change that introduced them.
- No em dashes and no semicolons in prose, comments, the changelog or release notes.
- Keep changelog entries and commit messages short.
- Keep the README short: a pitch, an example, requirements, install, a few behavior bullets, and stop and uninstall.

## Releasing

1. Set the version in `plugin/.claude-plugin/plugin.json`.
2. Add a `## [X.Y.Z] - YYYY-MM-DD` entry at the top of `CHANGELOG.md` in the [Common Changelog](https://common-changelog.org) format. Each change cites its commit, so commit the changes first and the entry after. The release workflow publishes the entry as the release notes.
3. Run `npm test`, `npm run validate` and `npm run format:check`.
4. Merge to `master`, because both marketplaces and the README install commands track the default branch. Then `git tag -a vX.Y.Z -m "<short summary>"` and push the tag.

Pushing the tag runs `.github/workflows/release.yml`. It checks the tag against the manifest, runs the tests and creates the GitHub release. Do not create the release by hand.
