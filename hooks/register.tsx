import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Act, Persona, Run } from '../types'
import { pickLang, tr } from '../web/i18n.js'
import { LIVE, ago, cut, flattenTree, nowLine, statusMark, toolLabel, took } from './lib'
import { buildScene } from './scene'

export { flattenTree, nowLine } from './lib'

const PANE = 'agent-radar'
const MAIN = '__main__'
const HISTORY = 40
const PORT = 4747
const URL_WEB = `http://127.0.0.1:${PORT}`

const roster = atom({ plugin: 'agent-radar', key: 'roster' } as const, [], { shape: 'roster-1' })
const runs = atom({ plugin: 'agent-radar', key: 'runs' } as const, [], { shape: 'runs-1' })
const main = atom(
  { plugin: 'agent-radar', key: 'main' } as const,
  { id: MAIN, type: 'main', description: '', status: 'running', startedAt: 0, active: [], tools: [], toolCount: 0 },
  { shape: 'main-1' },
)
const meta = atom(
  { plugin: 'agent-radar', key: 'meta' } as const,
  { sid: '', cwd: '', home: '', title: '', lang: 'en' },
  { shape: 'meta-1' },
)
const open = atom({ plugin: 'agent-radar', key: 'open' } as const, '', { shape: 'open-1' })
const showDone = atom({ plugin: 'agent-radar', key: 'showDone' } as const, true, { shape: 'done-1' })

// Folds a burst of changes into one write of the state file (module lifetime).
let isPublishQueued = false
let tick = 0

function shortPath(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts.length <= 2 ? p : `…/${parts.slice(-2).join('/')}`
}

/** A tool call as one short line: which tool, and on what. */
export function describeTool(tool: string, args: Record<string, unknown>): { tool: string; summary: string } {
  const s = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')
  let name = tool
  if (tool.startsWith('mcp__')) name = tool.split('__').slice(1).join(':')
  switch (tool) {
    case 'Bash':
      return { tool: name, summary: cut(s('description') || s('command'), 70) }
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return { tool: name, summary: shortPath(s('file_path') || s('notebook_path')) }
    case 'Grep':
      return { tool: name, summary: cut(`"${s('pattern')}"${s('path') ? ` · ${shortPath(s('path'))}` : ''}`, 70) }
    case 'Glob':
      return { tool: name, summary: cut(s('pattern'), 70) }
    case 'Agent':
    case 'Task':
      return { tool: 'Agent', summary: cut(`${s('subagent_type') || 'general-purpose'}: ${s('description')}`, 70) }
    case 'WebFetch':
      return { tool: name, summary: cut(s('url'), 70) }
    case 'WebSearch':
      return { tool: name, summary: cut(s('query'), 70) }
    case 'Skill':
      return { tool: name, summary: s('skill') }
    case 'SendMessage':
      return { tool: name, summary: cut(`→ ${s('to')}${s('summary') ? `: ${s('summary')}` : ''}`, 70) }
  }
  const first = Object.entries(args).find(
    ([k, v]) => typeof v === 'string' && k !== 'tool' && k !== 'tool_use_id' && k !== 'agentId',
  )
  return { tool: name, summary: first ? cut(String(first[1]), 60) : '' }
}

function field(front: string, key: string): string {
  const m = front.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))
  return m ? (m[1] ?? '').trim().replace(/^["'](.*)["']$/, '$1') : ''
}

/**
 * Reads an agent definition's frontmatter. A description written
 * `Name — Role, Team. When to use…` gives the card a name, a role and a team;
 * any other description is shown as the role, under the agent's own name.
 */
export function parsePersona(slug: string, text: string): Persona {
  const fm = text.match(/^---\n([\s\S]*?)\n---/)
  const front = fm ? (fm[1] ?? '') : ''
  const description = field(front, 'description')
  const group = field(front, 'team') || field(front, 'group')
  const dash = description.match(/^(.{1,40}?)\s+[—–]\s+(.+)$/)
  if (dash) {
    const head = (dash[2] ?? '').split(/\.\s/)[0] ?? ''
    const comma = head.lastIndexOf(', ')
    return {
      slug,
      name: (dash[1] ?? slug).trim(),
      role: (comma > 0 ? head.slice(0, comma) : head).replace(/\.$/, '').trim(),
      group: group || (comma > 0 ? head.slice(comma + 2).replace(/\.$/, '').trim() : ''),
    }
  }
  return { slug, name: field(front, 'name') || slug, role: cut(description.split(/\.\s/)[0] ?? '', 48), group }
}

async function loadRoster($: EngineInterface, cwd: string) {
  const home = (await $.env.get('HOME')) ?? ''
  const found = new Map<string, Persona>()
  // The project's agents win over the person's own of the same name.
  for (const dir of [`${home}/.claude/agents`, `${cwd}/.claude/agents`]) {
    let entries: { name: string }[] = []
    try {
      entries = await $.fs.list(dir)
    } catch {
      continue
    }
    for (const ent of entries) {
      if (!ent.name.endsWith('.md')) continue
      try {
        const slug = ent.name.slice(0, -3)
        found.set(slug, parsePersona(slug, await $.fs.read(`${dir}/${ent.name}`)))
      } catch {
        // an unreadable file is skipped
      }
    }
  }
  await update($, roster, () => [...found.values()])
}

/** Writes this session's state where the web page's server reads it. */
async function publish($: EngineInterface) {
  const m = await read($, meta)
  if (m.sid === '' || m.home === '') return
  const body = {
    sid: m.sid,
    cwd: m.cwd,
    title: m.title,
    updatedAt: Date.now(),
    root: await read($, main),
    runs: await read($, runs),
    people: await read($, roster),
  }
  try {
    await $.fs.write(`${m.home}/.claude/agent-radar/state/${m.sid}.json`, JSON.stringify(body))
  } catch {
    // the page then misses this session; the pane is unaffected
  }
}

function queuePublish($: EngineInterface) {
  if (isPublishQueued) return
  isPublishQueued = true
  $.clock.after(400, () => {
    isPublishQueued = false
    void publish($)
  })
}

/** Changes the record of one loop: the main session's, or a subagent's by id. */
async function patch($: EngineInterface, id: string | undefined, fn: (r: Run) => Run) {
  if (!id) await update($, main, fn)
  else await update($, runs, list => (list.some(r => r.id === id) ? list.map(r => (r.id === id ? fn(r) : r)) : list))
  queuePublish($)
}

async function setTitle($: EngineInterface, title: string | undefined, isFallback: boolean) {
  const next = cut(title ?? '', 80)
  if (next === '') return
  const m = await read($, meta)
  if (m.title === next || (isFallback && m.title !== '')) return
  await update($, meta, v => ({ ...v, title: next }))
  queuePublish($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('HOME')) ?? ''
    const lang = pickLang(
      (await $.env.get('AGENT_RADAR_LANG')) || (await $.env.get('LC_ALL')) || (await $.env.get('LANG')) || 'en',
    )
    await update($, meta, m => ({ ...m, sid: m.sid || crypto.randomUUID(), cwd: e.cwd, home, lang }))
    await $.command.register({ name: 'radar', description: tr(lang, 'cmdPane') })
    await $.command.register({ name: 'radar-web', description: tr(lang, 'cmdWeb') })
    await loadRoster($, e.cwd)
    await update($, main, r => (r.startedAt ? r : { ...r, startedAt: Date.now() }))
    queuePublish($)

    $.clock.every(3000, () => {
      void (async () => {
        const live = await $.agent.list()
        const byId = new Map(live.map(a => [a.id, a]))
        await update($, runs, list => {
          let changed = false
          const known = new Set(list.map(r => r.id))
          const out: Run[] = list.map(r => {
            const st = (byId.get(r.id)?.status as string | undefined) ?? (LIVE.has(r.status) ? 'completed' : r.status)
            if (st === r.status) return r
            changed = true
            const ended = !LIVE.has(st)
            return { ...r, status: st, endedAt: ended ? Date.now() : undefined, ...(ended ? { active: [], ask: undefined } : {}) }
          })
          // An agent that was already running when the plugin loaded is adopted.
          for (const a of live) {
            if (known.has(a.id)) continue
            changed = true
            out.push({
              id: a.id,
              type: a.type,
              description: a.description,
              status: a.status,
              startedAt: Date.now(),
              active: [],
              tools: [],
              toolCount: 0,
              ...(a.parentId ? { parentId: a.parentId } : {}),
            })
          }
          return changed ? out.slice(-150) : list
        })
        // A heartbeat every ~12 s tells the page the session is still open.
        if (++tick % 4 === 0 || live.length > 0) queuePublish($)
      })()
    })
    void $.ui.open({ id: PANE, title: tr(lang, 'appName') })

    return next(e)
  })

  // The session's name: the title the app gives it, else its first prompt.
  on('classic.SessionStart', async ($, e, next) => {
    await setTitle($, e.session_title, false)
    return next(e)
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await setTitle($, e.session_title, false)
    if (e.source === undefined || e.source === 'user') await setTitle($, e.prompt, true)
    return next(e)
  })

  on('command.run', { command: 'radar' }, async $ => {
    const { cwd, lang } = await read($, meta)
    await loadRoster($, cwd)
    await $.ui.open({ id: PANE, title: tr(lang, 'appName') })

    return { text: tr(lang, 'paneOpened') }
  })

  on('command.run', { command: 'radar-web' }, async $ => {
    const { lang } = await read($, meta)
    await publish($)
    const server = `${$.plugin.root}/web/server.mjs`
    // The server outlives this session; a second copy exits at once on the taken port.
    const started = await $.process.run(['/bin/sh', '-lc', `nohup node "${server}" ${PORT} >/dev/null 2>&1 &`], {
      timeoutMs: 15000,
    })
    if (started.exitCode !== 0) {
      return { text: tr(lang, 'webFailed', { x: started.stderr.slice(0, 200) || `exit ${started.exitCode}` }) }
    }
    const opener = (await $.env.get('AGENT_RADAR_OPEN')) || 'open'
    try {
      await $.process.run([opener, URL_WEB], { timeoutMs: 10000 })
    } catch {
      // no opener on this system: the link in the answer is enough
    }

    return { text: tr(lang, 'webOpened', { x: URL_WEB }) }
  })

  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    if ('agentId' in res && res.agentId) {
      const run: Run = {
        id: res.agentId,
        type: e.subagentType,
        description: e.description,
        status: 'running',
        startedAt: Date.now(),
        active: [],
        tools: [],
        toolCount: 0,
        ...(e.parentAgentId ? { parentId: e.parentAgentId } : {}),
      }
      await update($, runs, list => [...list.filter(r => r.id !== run.id), run].slice(-150))
      queuePublish($)
    }

    return res
  })

  on('tool.check', async ($, e, next) => {
    const res = await next(e)
    if (res.decision === 'ask') {
      const d = describeTool(e.tool, (e.input ?? {}) as Record<string, unknown>)
      await patch($, e.agentId, r => ({ ...r, ask: `${d.tool}: ${d.summary}` }))
    }

    return res
  })

  on('tool.call', async ($, e, next) => {
    const d = describeTool(e.tool, e as unknown as Record<string, unknown>)
    const act: Act = { id: e.tool_use_id, tool: d.tool, summary: d.summary, startedAt: Date.now() }
    await patch($, e.agentId, r => ({ ...r, ask: undefined, active: [...r.active.filter(a => a.id !== act.id), act] }))
    let isError = false
    try {
      const res = await next(e)
      isError = ('isError' in res && res.isError === true) || ('deny' in res && typeof res.deny === 'string')
      return res
    } catch (err) {
      isError = true
      throw err
    } finally {
      const done: Act = { ...act, endedAt: Date.now(), ...(isError ? { isError: true } : {}) }
      await patch($, e.agentId, r => ({
        ...r,
        active: r.active.filter(a => a.id !== act.id),
        tools: [...r.tools, done].slice(-HISTORY),
        toolCount: r.toolCount + 1,
      }))
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
    const people = await read($, roster)
    const history = await read($, runs)
    const root = await read($, main)
    const expanded = await read($, open)
    const withDone = await read($, showDone)
    const { lang, title } = await read($, meta)
    const T = (key: string, params?: Record<string, string | number>) => tr(lang, key, params)
    const now = Date.now()

    const bySlug = new Map(people.map(p => [p.slug, p]))
    const nameOf = (type: string) => bySlug.get(type)?.name ?? type
    const liveCount = history.filter(r => LIVE.has(r.status) && r.status !== 'idle').length
    const tree = flattenTree(history, r => withDone || LIVE.has(r.status))
    const toggle = (id: string) => () => update($, open, v => (v === id ? '' : id))

    const toolList = (r: Run, indent: string) => {
      const items = [...r.tools].reverse()
      return (
        <Box flexDirection="column">
          {r.active.map(a => (
            <Text wrap="truncate-end">
              <Text dimColor>{indent}</Text>
              <Text color="cyan">… {toolLabel(a.tool, lang)}</Text> {a.summary}{' '}
              <Text dimColor>· {T('inFlight')} {took(a, now, lang)}</Text>
            </Text>
          ))}
          {items.length === 0 && r.active.length === 0 && <Text dimColor>{indent}{T('noTools')}</Text>}
          {items.map(a => (
            <Text wrap="truncate-end">
              <Text dimColor>{indent}</Text>
              <Text color={a.isError ? 'red' : undefined}>{a.isError ? '✕' : '✓'} {toolLabel(a.tool, lang)}</Text> {a.summary}{' '}
              <Text dimColor>· {took(a, now, lang)} · {T('ago', { x: ago(now - (a.endedAt ?? now), lang) })}</Text>
            </Text>
          ))}
          {r.toolCount > r.tools.length && (
            <Text dimColor>{indent}{T('olderCalls', { n: r.toolCount - r.tools.length })}</Text>
          )}
        </Box>
      )
    }

    const doneToggle = (
      <Button key="toggle-done" dimColor onPress={() => update($, showDone, v => !v)}>
        {withDone ? T('hideDone') : T('showDone')}
      </Button>
    )

    if (Svg) {
      const scene = buildScene(root, history, people, now, withDone, lang)
      const picked = expanded === MAIN ? root : history.find(r => r.id === expanded)
      const chips = [{ id: MAIN, label: T('main') }, ...tree.map(t => ({ id: t.run.id, label: nameOf(t.run.type) }))]
      // The frame does not size itself, so width and height are given: the
      // width is estimated from the pane's cells and kept in a readable range.
      const cols = (e.props as { bodyColumns?: number }).bodyColumns
      const drawW = Math.round(Math.min(1300, Math.max(420, cols ? cols * 8.5 - 8 : 900)))
      return (
        <Box flexDirection="column" gap={1}>
          {title !== '' && <Text bold>{title}</Text>}
          <Svg
            source={scene.source}
            alt={scene.alt}
            width={drawW}
            height={Math.round((scene.height * drawW) / scene.width)}
            isInteractive
          />
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Text dimColor>{T('history')}:</Text>
            {chips.map(c => (
              <Button key={`run:${c.id}`} variant={expanded === c.id ? 'primary' : 'secondary'} onPress={toggle(c.id)}>
                {c.label}
              </Button>
            ))}
            {doneToggle}
          </Box>
          {picked && (
            <Box flexDirection="column">
              <Text bold>
                {picked.id === MAIN ? T('main') : nameOf(picked.type)}
                <Text dimColor> · {T('nTools', { n: picked.toolCount })}</Text>
              </Text>
              {toolList(picked, '')}
            </Box>
          )}
        </Box>
      )
    }

    // The terminal draws no SVG: the same facts as a tree of text.
    const rootNow = nowLine({ ...root, status: 'running' }, history, nameOf, now, lang)
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold>
            {title !== '' ? `${title} · ` : ''}
            {liveCount} {T('tileRunning')} · {T('mainSummary', { n: root.toolCount, m: history.length })}
          </Text>
          {doneToggle}
        </Box>

        <Box flexDirection="column">
          <Button key="run:__main__" onPress={toggle(MAIN)}>
            ◆ {T('main')} <Text dimColor>({T('you')}) · {T('nTools', { n: root.toolCount })}</Text>
          </Button>
          {rootNow && root.active.length > 0 && (
            <Text color={rootNow.color} wrap="wrap">
              {'   '}
              {rootNow.text}
            </Text>
          )}
          {expanded === MAIN && toolList(root, '     ')}

          {tree.length === 0 && (
            <Text dimColor>{'   '}{history.length === 0 ? T('noHandoffs') : T('noneRunning')}</Text>
          )}
          {tree.map(({ run: r, prefix, cont }) => {
            const p = bySlug.get(r.type)
            const { mark, color, label } = statusMark(r.status, lang)
            const live = LIVE.has(r.status)
            const line = nowLine(r, history, nameOf, now, lang)
            return (
              <Box flexDirection="column">
                <Box flexDirection="row">
                  <Text dimColor>{prefix}</Text>
                  <Button key={`run:${r.id}`} onPress={toggle(r.id)}>
                    <Text color={color}>{mark} </Text>
                    <Text bold={live} dimColor={!live}>{p ? p.name : r.type}</Text>
                    {p && p.role !== '' && <Text dimColor> {p.role}</Text>}
                    <Text dimColor>
                      {' '}— {r.description} · {label} · {ago((r.endedAt ?? now) - r.startedAt, lang)} ·{' '}
                      {T('nTools', { n: r.toolCount })} {expanded === r.id ? '▾' : '▸'}
                    </Text>
                  </Button>
                </Box>
                {line && (
                  <Text color={line.color} wrap="wrap">
                    <Text dimColor>{cont}</Text>
                    {line.text}
                  </Text>
                )}
                {expanded === r.id && toolList(r, `${cont}  `)}
              </Box>
            )
          })}
        </Box>
        <Text dimColor>{T('rowHint')}</Text>
      </Box>
    )
  })
}
