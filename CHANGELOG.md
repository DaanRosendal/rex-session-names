# Changelog

## 0.2.0

- Replace a running watcher when a newer plugin version starts, including a 0.1.0 watcher, so updates take effect.
- Reconnect to Rex when the event stream ends, and exit when Rex restarts or stays unreachable.
- Add `doctor` and `stop` commands to the watcher.
- Check that a lock's PID still runs the watcher before trusting it, and create and reclaim locks without races.
- Keep an automatic name when the rename call times out but Rex applied it.
- Ship one `plugin/` directory for both hosts. The script is now `name-watcher.mjs`, and Codex reads the Claude manifest and hook file.
- Start the watcher on every session start source instead of a fixed list. Codex asks you to trust the hook again.

## 0.1.0

- Name Rex sessions after the task in the agent's terminal title, for Claude Code and Codex.
