# rex-session-names

A plugin that names [Rex](https://www.superlogical.com/rex) sessions after the agent's task. It reads the title the agent already sets on its terminal. No model calls, and your conversations are never read.

| Terminal title                       | Session name              |
| ------------------------------------ | ------------------------- |
| `Review PR 123 \| project`           | `review-pr-123`           |
| `✳ Fix login redirect`               | `fix-login-redirect`      |
| `⠹ Migrate the users table to UUIDs` | `migrate-the-users-table` |

## Requirements

- macOS or Linux, with a Rex terminal and `rex` on the `PATH`
- Node.js 22.18 or newer
- A coding agent that sets a terminal title. Claude Code and Codex work out of the box and the plugin installs on both. Tested with Claude Code 2.1.325 and Codex 0.169. For any other agent, see below.

## Install

For Claude Code:

```bash
claude plugin marketplace add https://github.com/DaanRosendal/rex-session-names.git
claude plugin install rex-session-names@rex-session-names
```

For Codex:

```bash
codex plugin marketplace add https://github.com/DaanRosendal/rex-session-names.git
codex plugin add rex-session-names@rex-session-names
```

Start a new agent session afterwards. In Codex, trust the hook in `/hooks` first.

For any other agent, clone the repo, start the watcher from your shell profile or the agent's session start hook, and list the agent in `REX_SESSION_NAMES_APPS`.

```bash
git clone https://github.com/DaanRosendal/rex-session-names.git
node rex-session-names/plugin/src/name-watcher.mjs start
export REX_SESSION_NAMES_APPS=claude,codex,your-agent   # replaces the default list, then stop the watcher once
```

An agent is matched by its process name or by the `app` it reports to Rex. Its terminal title must be the task name, like `Fix login redirect`. Titles in other shapes, such as Pi's `π - task - folder`, give odd names.

## How it works

- Sessions with a generated name like `sparkling-creek` take the agent's task name.
- Rename a session yourself and automatic naming stops for it. Rename it to `auto` to turn it back on.
- If several agents run in one session, the first one to name it keeps the name. Later agents do not overwrite it.

## Stop and uninstall

A small background watcher keeps running after the agent exits:

```bash
pkill -f 'name-watcher.mjs watch'
claude plugin uninstall rex-session-names@rex-session-names
codex plugin remove rex-session-names@rex-session-names
```

## Contributing

Run `npm test` and `npm run validate`. Report vulnerabilities as described in [SECURITY.md](SECURITY.md).
