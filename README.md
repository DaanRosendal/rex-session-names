# rex-session-names

A Claude Code and Codex plugin that names Rex sessions after the agent's task. For example, `Review MR 123 | project` becomes `review-mr-123`.

One background watcher per Rex server follows terminal title and process events. It finds the session through Rex, so it works when Codex's shared server has stale `REX_SESSION` and `REX_BLOCK` variables. It does not read conversations or call a model.

The watcher keeps running after the agent session ends or the plugin is removed, until Rex exits. To stop it, run `pkill -f 'start.mjs watch'`. Names stay as they are.

## Naming rules

- Sessions named in Rex's generated style, two lowercase words joined by a hyphen like `sparkling-creek`, are renamed automatically. Other names are left alone. A manual name in that style, such as `release-notes`, is replaced too, and the old name is not restored.
- Task titles become lowercase names of up to four words, separated by hyphens. Activity spinners, permission markers, and the project suffix are removed.
- Once a pane names the session, it keeps control while it runs. Background tabs and split panes cannot take over. If that agent exits, another agent pane can take over.
- A rename made outside the plugin stops automatic naming for that session, including after watcher restarts, even if the new name has two words. Names written by another tool or agent count as outside renames.
- Rename a session to `auto` to enable automatic naming again.
- Names stay in place when an agent or the watcher exits. Tab labels and status indicators are untouched.

The watcher uses titles owned by the current foreground agent. Generic titles such as `Codex` and titles left behind by exited processes are ignored.

## Install

Needs Node.js 22.18 or newer and `rex` on the `PATH`. Both hosts load the same watcher.

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

Claude loads the repository's root plugin. Codex's marketplace installs only `codex/`, keeping Git metadata and tests out of the hook bundle fingerprinted at startup.

## State

Both hosts share `~/.local/state/rex-session-names/`. The watcher keeps a private PID file and ownership state per Rex server instance. State records session IDs, the last automatic name, the owning pane, and manual overrides. Set `REX_SESSION_NAMES_DATA` to use another directory.

## Develop

```bash
npm test
npm run test:integration
claude plugin validate .
```

The integration test creates its own Rex server and agent-like terminals. It does not use your existing sessions or call a model.

To install the checkout in Codex:

```bash
codex plugin marketplace add "$PWD"
codex plugin add rex-session-names@rex-session-names
```
