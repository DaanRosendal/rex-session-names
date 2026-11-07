const TERMINAL = 'com.superlogical.terminal'
const AGENTS = new Set(['codex', 'claude', 'claude-code'])
const MAX_NAME_WORDS = 4
const MAX_NAME_LENGTH = 128
const GENERATED = /^[a-z]+-[a-z]+$/

export function parse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function taskTitle(title) {
  return String(title ?? '')
    .replace(/^\[ [!.] \] Action Required(?: \| |$)/, '')
    .replace(/^[\u2800-\u28ff✳✻✽✶✢·●*]\s*/u, '')
    .split(' | ')[0]
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
}

export function sessionName(title) {
  const task = taskTitle(title)
  if (/^(codex|claude(?: code)?|new (?:task|session)|untitled|ready)$/i.test(task)) return ''
  const name = (
    task
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
    .slice(0, MAX_NAME_WORDS)
    .join('-')
  return [...name].slice(0, MAX_NAME_LENGTH).join('').replace(/-$/, '')
}

function sameProcess(owner, foreground) {
  return owner && foreground && owner.pid === foreground.pid && owner.name === foreground.name
}

export class SessionNames {
  titles = new Map()
  dirty = false

  constructor(run, state = {}) {
    this.run = run
    this.sessions = new Map(Object.entries(state))
  }

  prune(liveIds) {
    for (const session of this.sessions.keys()) {
      if (!liveIds.has(session)) {
        this.sessions.delete(session)
        this.dirty = true
      }
    }
  }

  markClean() {
    this.dirty = false
  }

  save(session, value) {
    this.sessions.set(session, value)
    this.dirty = true
  }

  async refresh(session) {
    const view = parse(await this.run(['session', 'inspect', session, '--json']))
    if (!view || typeof view.label !== 'string') return
    const owned = this.sessions.get(session)
    if (view.label === 'auto') this.sessions.delete(session)
    else if (owned === null) return
    else if (owned ? view.label !== owned.label : !GENERATED.test(view.label)) {
      this.save(session, null)
      return
    }

    const blocks = (view.windows ?? [])
      .flatMap(win => (win.layers ?? []).flatMap(layer => layer.blocks ?? []))
      .filter(block => block.creator_name === TERMINAL)
    if (owned?.block)
      blocks.sort((a, b) => Number(b.block_id === owned.block) - Number(a.block_id === owned.block))

    for (const block of blocks) {
      const args = ['block', 'call', '-s', session, '-b', block.block_id]
      const [processInfo, title, status] = await Promise.all([
        this.run([...args, 'process']).then(parse),
        this.run([...args, 'title']).then(parse),
        this.run([...args, 'program_status']).then(parse),
      ])
      const foreground = processInfo?.foreground
      const isAgent =
        AGENTS.has(foreground?.name) ||
        (status?.records ?? []).some(
          record =>
            AGENTS.has(record.effective_app ?? record.app) && sameProcess(record.owner, foreground),
        )
      if (
        block.block_id === owned?.block &&
        (!processInfo || !title || !status || (isAgent && !sameProcess(title.owner, foreground)))
      )
        return
      if (!isAgent || !sameProcess(title?.owner, foreground)) continue
      this.titles.set(`${session}/${block.block_id}`, taskTitle(title.title))
      const name = sessionName(title.title)
      if (!name) return
      if (name !== view.label) {
        const current = parse(await this.run(['session', 'inspect', session, '--json']))
        if (!current) return
        if (current.label !== view.label) {
          this.save(session, null)
          return
        }
        if ((await this.run(['session', 'rename', '--', session, name])) === undefined) return
      }
      this.save(session, { label: name, block: block.block_id })
      return
    }
  }

  async handle(event) {
    if (event?.type === 'session_destroyed') {
      const session = event.payload?.session_id
      if (typeof session !== 'string') return
      this.sessions.delete(session)
      for (const key of this.titles.keys())
        if (key.startsWith(`${session}/`)) this.titles.delete(key)
      this.dirty = true
      return
    }
    if (event?.type === 'session_created') {
      const session = event.payload?.session?.session_id
      if (typeof session === 'string') await this.refresh(session)
      return
    }
    if (event?.type !== 'session_event') return
    const { session_id: session, event: change } = event.payload ?? {}
    if (typeof session !== 'string' || !change) return
    if (change.type === 'session_label_changed') {
      const view = parse(await this.run(['session', 'inspect', session, '--json']))
      if (!view) return
      if (view.label === 'auto') {
        this.sessions.delete(session)
        this.dirty = true
        await this.refresh(session)
      } else if (this.sessions.get(session)?.label !== view.label) {
        this.save(session, null)
      }
    } else if (change.type === 'block_event') {
      const { block_id: block, creator_name: creator, name, payload } = change.payload ?? {}
      if (creator !== TERMINAL || typeof block !== 'string') return
      if (name === 'title_changed') {
        if (typeof payload?.title !== 'string') return
        const key = `${session}/${block}`
        const title = taskTitle(payload.title)
        if (this.titles.get(key) === title) return
        this.titles.set(key, title)
      } else if (!['process_changed', 'program_status_changed', 'child_exited'].includes(name))
        return
      await this.refresh(session)
    } else if (['block_created', 'block_closed', 'window_closed'].includes(change.type)) {
      if (change.type === 'block_closed')
        this.titles.delete(`${session}/${change.payload?.block_id}`)
      await this.refresh(session)
    }
  }
}
