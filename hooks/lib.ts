import type { Act, Run } from '../types'
import { tr } from '../web/i18n.js'

export const LIVE = new Set(['pending', 'running', 'waiting', 'idle'])

export function cut(text: string, n: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, Math.max(1, n - 1))}…` : one
}

export function ago(ms: number, lang: string): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}${tr(lang, 'uSec')}`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}${tr(lang, 'uMin')}` : `${Math.round(m / 60)}${tr(lang, 'uHour')}`
}

export function took(a: Act, now: number, lang: string): string {
  const ms = (a.endedAt ?? now) - a.startedAt
  return ms < 1000 ? `${(ms / 1000).toFixed(1)}${tr(lang, 'uSec')}` : ago(ms, lang)
}

/** The tool's name as shown: handoffs and messages are named in the reader's language. */
export function toolLabel(tool: string, lang: string): string {
  if (tool === 'Agent' || tool === 'Task') return tr(lang, 'toolHandoff')
  if (tool === 'SendMessage') return tr(lang, 'toolMessage')
  return tool
}

export type TreeRow = { run: Run; prefix: string; cont: string; depth: number; parent: number }

/** Flattens the handoff tree to rows: roots are the main session's agents, children follow `parentId`. */
export function flattenTree(list: Run[], keep: (r: Run) => boolean): TreeRow[] {
  const ids = new Set(list.map(r => r.id))
  const kids = new Map<string, Run[]>()
  for (const r of list) {
    const parent = r.parentId && ids.has(r.parentId) ? r.parentId : ''
    kids.set(parent, [...(kids.get(parent) ?? []), r])
  }
  const visible = (r: Run): boolean => keep(r) || (kids.get(r.id) ?? []).some(visible)
  const rows: TreeRow[] = []
  const walk = (parent: string, indent: string, depth: number, parentRow: number) => {
    const children = (kids.get(parent) ?? []).filter(visible)
    children.forEach((r, i) => {
      const last = i === children.length - 1
      const cont = indent + (last ? '   ' : '│  ')
      rows.push({ run: r, prefix: indent + (last ? '└─ ' : '├─ '), cont, depth, parent: parentRow })
      walk(r.id, cont, depth + 1, rows.length - 1)
    })
  }
  walk('', '', 1, -1)
  return rows
}

export function statusMark(st: string, lang: string): { mark: string; color?: string; label: string } {
  if (st === 'running') return { mark: '●', color: 'green', label: tr(lang, 'stRunning') }
  if (st === 'pending') return { mark: '●', color: 'green', label: tr(lang, 'stStarting') }
  if (st === 'waiting') return { mark: '◐', color: 'yellow', label: tr(lang, 'stWaiting') }
  if (st === 'idle') return { mark: '◐', color: 'yellow', label: tr(lang, 'stIdle') }
  if (st === 'failed') return { mark: '✕', color: 'red', label: tr(lang, 'stFailed') }
  if (st === 'killed') return { mark: '✕', color: 'red', label: tr(lang, 'stStopped') }
  return { mark: '✓', label: tr(lang, 'stDone') }
}

const isHandoff = (a: Act) => a.tool === 'Agent' || a.tool === 'Task'

/** One line saying what the agent is doing right now, or what it is waiting on. */
export function nowLine(
  r: Run,
  all: Run[],
  nameOf: (type: string) => string,
  now: number,
  lang: string,
): { text: string; color?: string } | undefined {
  if (r.ask) return { text: `🔒 ${tr(lang, 'nowAsk', { x: r.ask })}`, color: 'red' }
  if (!LIVE.has(r.status)) return undefined
  const liveKids = all.filter(k => k.parentId === r.id && LIVE.has(k.status) && k.status !== 'idle')
  const working = r.active.filter(a => !isHandoff(a))
  if (r.status === 'running' && working.length > 0) {
    return {
      text: working.map(a => `▸ ${toolLabel(a.tool, lang)}: ${a.summary} · ${took(a, now, lang)}`).join('   '),
      color: 'cyan',
    }
  }
  if (liveKids.length > 0) {
    return { text: `⏳ ${tr(lang, 'nowWaitAgents', { x: liveKids.map(k => nameOf(k.type)).join(', ') })}`, color: 'yellow' }
  }
  const handoff = r.active.find(isHandoff)
  if (handoff) return { text: `⏳ ${tr(lang, 'nowWaitHandoff', { x: handoff.summary })}`, color: 'yellow' }
  const first = working[0]
  if (first) return { text: `⏳ ${tr(lang, 'nowWaitTool', { x: `${toolLabel(first.tool, lang)}: ${first.summary}` })}`, color: 'yellow' }
  if (r.status === 'idle') return { text: `⏸ ${tr(lang, 'nowIdle')}`, color: 'yellow' }
  if (r.status === 'waiting') return { text: `⏳ ${tr(lang, 'nowWaitBg')}`, color: 'yellow' }
  if (r.status === 'pending') return { text: tr(lang, 'nowStarting'), color: 'cyan' }
  return { text: `💭 ${tr(lang, 'nowThinking')}`, color: 'cyan' }
}
