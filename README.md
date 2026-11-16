# rex-session-names

A Claude Code and Codex plugin that names [Rex](https://www.superlogical.com/rex) sessions after the agent's task. For example, the terminal title `Review MR 123 | project` becomes the session name `review-mr-123`.

A background watcher follows terminal title and process events through Rex. It does not read conversations, call a model, or add instructions to your agents.

## How it differs from `rex skill setup --session-naming`

Rex ships an opt-in flag that tells agents to name the session after their task. This plugin takes a different route:

- **Title driven.** The name comes from the title the agent already sets on its terminal. No model call, no agent instructions, nothing to opt into per agent.
- **One pane owns the name.** Once a pane names the session, it keeps control while it runs. A second agent in another tab or a split pane cannot rename the whole session.
- **Manual names stay.** A rename made by you or another tool stops automatic naming for that session.

## Requirements

- macOS or Linux, with a Rex terminal and `rex` on the `PATH`
- Node.js 22.18 or newer
- Claude Code 2.1.325 or newer, or Codex 0.169 or newer

## Install

### Claude Code

```bash
claude plugin marketplace add https://github.com/DaanRosendal/rex-session-names.git
claude plugin install rex-session-names@rex-session-names
```

### Codex

```bash
codex plugin marketplace add https://github.com/DaanRosendal/rex-session-names.git
codex plugin add rex-session-names@rex-session-names
```

Start a new session after installing. In Codex, review and trust the hook in `/hooks` before it can run.

## Naming rules

- Sessions named in Rex's generated style, two lowercase words joined by a hyphen like `sparkling-creek`, are renamed automatically. Other names are left alone. A manual name in that style, such as `release-notes`, is replaced too, and the old name is not restored.
- Task titles become lowercase names of up to four words, separated by hyphens. Activity spinners, permission markers, and the project suffix are removed.
- A rename made outside the plugin stops automatic naming for that session, including after watcher restarts, even if the new name has two words. Names written by another tool or agent count as outside renames.
- Rename a session to `auto` to enable automatic naming again.
- If the pane that owns the name exits, another agent pane can take over.
- Names stay in place when an agent or the watcher exits. Tab labels and status indicators are untouched.

The watcher uses titles owned by the current foreground agent. Generic titles such as `Codex` and titles left behind by exited processes are ignored.

## Stop and uninstall

One watcher runs per Rex server. It outlives the agent session, so removing the plugin does not end it. Names stay as they are.

```bash
pkill -f 'name-watcher.mjs watch'
claude plugin uninstall rex-session-names@rex-session-names
codex plugin remove rex-session-names@rex-session-names
```

While the plugin is installed, a new agent session starts the watcher again. After a plugin update, the next session start replaces a running watcher of an older version.

## Troubleshooting

`doctor` prints the plugin version, whether Rex answers, and each watcher with its PID and version. `stop` ends every watcher. Both live in the installed plugin. For Claude Code:

```bash
plugin="$(ls -d ~/.claude/plugins/cache/rex-session-names/rex-session-names/*/ | sort -V | tail -1)"
node "${plugin}src/name-watcher.mjs" doctor
```

For Codex, use `~/.codex/plugins/cache/...` in place of `~/.claude/plugins/cache/...`.

## Known limits

- It needs a Claude Code or Codex pane in Rex that sets a task title. Agents that set no title are not named.
- After a Rex restart, the watcher stops. The next agent session start launches a new one.
- State records session IDs, the last automatic name, the owning pane, and manual overrides in `~/.local/state/rex-session-names/`. Set `REX_SESSION_NAMES_DATA` to use another directory.

## Contributing

Run `npm test` and `npm run validate`. See [CHANGELOG.md](CHANGELOG.md) for releases and [SECURITY.md](SECURITY.md) to report a vulnerability.
