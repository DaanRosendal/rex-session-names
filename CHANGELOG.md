# Changelog

## [0.3.0] - 2026-11-18

### Added

- Add `REX_SESSION_NAMES_APPS` to choose which agents name sessions, replacing the default `claude`, `claude-code` and `codex`. A title that is only a listed agent's name no longer becomes a session name ([`77a1732`](https://github.com/DaanRosendal/rex-session-names/commit/77a1732))
- Document how to start the watcher for an agent other than Claude Code and Codex ([`f830ebd`](https://github.com/DaanRosendal/rex-session-names/commit/f830ebd))

## [0.2.0] - 2026-11-16

### Changed

- Ship one `plugin/` directory for both hosts. The script is now `name-watcher.mjs`, and Codex reads the Claude manifest and hook file ([`dc36203`](https://github.com/DaanRosendal/rex-session-names/commit/dc36203)) ([#1](https://github.com/DaanRosendal/rex-session-names/pull/1))
- Replace a running watcher when a newer plugin version starts, including a 0.1.0 watcher, so updates take effect ([`dc36203`](https://github.com/DaanRosendal/rex-session-names/commit/dc36203))
- Start the watcher on every session start source instead of a fixed list, so Codex asks you to trust the hook again ([`dc36203`](https://github.com/DaanRosendal/rex-session-names/commit/dc36203))

### Added

- Add `doctor` and `stop` commands to the watcher ([`dc36203`](https://github.com/DaanRosendal/rex-session-names/commit/dc36203))
- Reconnect to Rex when the event stream ends, and exit when Rex restarts or stays unreachable ([`dc36203`](https://github.com/DaanRosendal/rex-session-names/commit/dc36203))

### Fixed

- Check that a lock's PID still runs the watcher before trusting it, and create and reclaim locks without races ([`dc36203`](https://github.com/DaanRosendal/rex-session-names/commit/dc36203))
- Keep an automatic name when the rename call times out but Rex applied it ([`dc36203`](https://github.com/DaanRosendal/rex-session-names/commit/dc36203))

## [0.1.0] - 2026-11-07

### Added

- Name Rex sessions after the task in the agent's terminal title, for Claude Code and Codex ([`5722119`](https://github.com/DaanRosendal/rex-session-names/commit/5722119))

[0.3.0]: https://github.com/DaanRosendal/rex-session-names/releases/tag/v0.3.0
[0.2.0]: https://github.com/DaanRosendal/rex-session-names/releases/tag/v0.2.0
[0.1.0]: https://github.com/DaanRosendal/rex-session-names/releases/tag/v0.1.0
