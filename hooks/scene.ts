import type { Act, Persona, Run } from '../types'
import { tr } from '../web/i18n.js'
import { LIVE, ago, cut, flattenTree, nowLine, toolLabel, took } from './lib'

/** The drawing's own width; the surface scales it to the pane. */
const W = 600
const PAD = 14
const INDENT = 30
const GAP = 10
const MAX_CARDS = 40

const KIND = {
  read: { color: '#60a5fa', label: 'kRead' },
  write: { color: '#c084fc', label: 'kWrite' },
  run: { color: '#34d399', label: 'kRun' },
  handoff: { color: '#fbbf24', label: 'kHandoff' },
  web: { color: '#22d3ee', label: 'kWeb' },
  other: { color: '#94a3b8', label: 'kOther' },
  error: { color: '#f87171', label: 'kError' },
} as const

type KindKey = keyof typeof KIND

export function kindOf(a: Act): KindKey {
  if (a.isError) return 'error'
  const t = a.tool
  if (t === 'Read' || t === 'Grep' || t === 'Glob') return 'read'
  if (t === 'Edit' || t === 'Write' || t === 'NotebookEdit') return 'write'
  if (t === 'Bash') return 'run'
  if (t === 'Agent' || t === 'Task' || t === 'SendMessage') return 'handoff'
  if (t === 'WebFetch' || t === 'WebSearch') return 'web'
  return 'other'
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hueOf(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return h
}

function initials(name: string, lang: string): string {
  const parts = name.split(/[\s-]+/).filter(Boolean)
  const a = parts[0]?.charAt(0) ?? '?'
  const b = parts.length > 1 ? (parts[1]?.charAt(0) ?? '') : (parts[0]?.charAt(1) ?? '')
  return (a + b).toLocaleUpperCase(lang)
}

const STATUS: Record<string, { color: string; key: string }> = {
  pending: { color: '#34d399', key: 'stStarting' },
  running: { color: '#34d399', key: 'stRunning' },
  waiting: { color: '#fbbf24', key: 'stWaiting' },
  idle: { color: '#fbbf24', key: 'stIdle' },
  completed: { color: '#8b8b98', key: 'stDone' },
  failed: { color: '#f87171', key: 'stFailed' },
  killed: { color: '#f87171', key: 'stStopped' },
}

const LINE_COLOR: Record<string, string> = { cyan: '#67e8f9', yellow: '#fbbf24', red: '#f87171' }

export type Scene = { source: string; alt: string; width: number; height: number }

/**
 * The pane's live scene as one SVG: summary tiles, a card per agent joined to
 * the agent that handed it the work, and a timeline of tool calls. Motion is
 * SMIL, so it runs without redrawing the pane.
 */
export function buildScene(root: Run, runs: Run[], people: Persona[], now: number, withDone: boolean, lang = 'en'): Scene {
  const T = (key: string, params?: Record<string, string | number>) => tr(lang, key, params)
  const bySlug = new Map(people.map(p => [p.slug, p]))
  const nameOf = (type: string) => bySlug.get(type)?.name ?? type
  const allRows = flattenTree(runs, r => withDone || LIVE.has(r.status))
  const rows = allRows.slice(0, MAX_CARDS)
  const hiddenRows = allRows.length - rows.length
  const out: string[] = []

  const running = runs.filter(r => r.status === 'running' || r.status === 'pending').length
  const waiting = runs.filter(r => r.status === 'waiting' || r.status === 'idle' || r.ask).length
  const done = runs.filter(r => !LIVE.has(r.status)).length
  const failed = runs.filter(r => r.status === 'failed' || r.status === 'killed').length
  const toolTotal = root.toolCount + runs.reduce((n, r) => n + r.toolCount, 0)

  // ── summary tiles ───────────────────────────────────────────────
  const tiles = [
    { n: running, label: T('tileRunning'), color: '#34d399', pulse: running > 0 },
    { n: waiting, label: T('tileWaiting'), color: '#fbbf24', pulse: false },
    { n: done, label: failed > 0 ? T('tileDoneErr', { n: failed }) : T('tileDone'), color: failed > 0 ? '#f87171' : '#8b8b98', pulse: false },
    { n: toolTotal, label: T('tileTools'), color: '#60a5fa', pulse: false },
  ]
  const tileW = (W - PAD * 2 - GAP * 3) / 4
  let y = PAD
  tiles.forEach((t, i) => {
    const x = PAD + i * (tileW + GAP)
    out.push(
      `<rect class="card" x="${x}" y="${y}" width="${tileW}" height="54" rx="12" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.09"/>`,
      `<circle cx="${x + 16}" cy="${y + 19}" r="4" fill="${t.color}">${
        t.pulse ? '<animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite"/>' : ''
      }</circle>`,
      `<text class="t" x="${x + 28}" y="${y + 27}" font-size="22" font-weight="700" fill="#ececf1">${t.n}</text>`,
      `<text class="d" x="${x + 14}" y="${y + 45}" font-size="11" fill="#9a9aa6">${esc(t.label)}</text>`,
    )
  })
  y += 54 + GAP + 4

  // ── cards ─────────────────────────────────────────────────────
  type Card = { run: Run; depth: number; parent: number; x: number; y: number; w: number; h: number; isMain: boolean }
  const cards: Card[] = []
  const place = (run: Run, depth: number, parent: number, isMain: boolean) => {
    const x = PAD + depth * INDENT
    const live = isMain ? run.active.length > 0 : LIVE.has(run.status)
    const h = live ? 84 : 62
    cards.push({ run, depth, parent, x, y, w: W - PAD - x, h, isMain })
    y += h + GAP
  }
  place({ ...root, status: 'running' }, 0, -1, true)
  for (const row of rows) place(row.run, row.depth, row.parent + 1, false)

  // connectors: an elbow from the parent's trunk to the child's avatar
  const isLiveCard = (c: Card) => LIVE.has(c.run.status) && c.run.status !== 'idle'
  for (const c of [...cards.filter(c => !isLiveCard(c)), ...cards.filter(isLiveCard)]) {
    if (c.parent < 0) continue
    const p = cards[c.parent]
    if (!p) continue
    const trunk = p.x + 15
    const cy = c.y + 26
    const live = LIVE.has(c.run.status) && c.run.status !== 'idle'
    const color = live ? (STATUS[c.run.status]?.color ?? '#34d399') : '#8b8b98'
    out.push(
      `<path d="M${trunk} ${p.y + p.h} V${cy - 8} Q${trunk} ${cy} ${trunk + 8} ${cy} H${c.x}" fill="none" stroke="${color}" stroke-opacity="${live ? 0.9 : 0.35}" stroke-width="${live ? 1.6 : 1.2}"${
        live ? ' stroke-dasharray="3 5" stroke-linecap="round"' : ''
      }>${live ? '<animate attributeName="stroke-dashoffset" values="16;0" dur="0.9s" repeatCount="indefinite"/>' : ''}</path>`,
    )
  }

  for (const c of cards) {
    const r = c.run
    const p = bySlug.get(r.type)
    const stRaw = STATUS[r.status]
    const st = { color: stRaw?.color ?? '#8b8b98', label: stRaw ? T(stRaw.key) : r.status }
    const live = c.isMain || LIVE.has(r.status)
    const active = r.status === 'running' || r.status === 'pending'
    const name = c.isMain ? T('main') : (p?.name ?? r.type)
    const role = c.isMain ? T('you') : (p?.role ?? '')
    const hue = c.isMain ? 268 : hueOf(p?.group || r.type)
    const accent = r.ask ? '#f87171' : st.color
    const cx = c.x + 26
    const cy = c.y + 26
    const textX = c.x + 52
    const room = Math.floor((c.w - 64) / 6.1)

    out.push(
      `<g opacity="${live ? 1 : 0.62}">`,
      `<rect class="card" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="14" fill="#ffffff" fill-opacity="${live ? 0.06 : 0.03}" stroke="${live ? accent : '#ffffff'}" stroke-opacity="${live ? 0.45 : 0.09}"/>`,
    )
    if (active && !c.isMain) {
      out.push(
        `<circle cx="${cx}" cy="${cy}" r="15" fill="none" stroke="${accent}" stroke-width="2"><animate attributeName="r" values="15;25" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0" dur="1.6s" repeatCount="indefinite"/></circle>`,
      )
    }
    out.push(
      `<circle cx="${cx}" cy="${cy}" r="15" fill="hsl(${hue} 62% 46%)"/>`,
      `<text x="${cx}" y="${cy + 4}" font-size="11" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(c.isMain ? '◆' : initials(name, lang))}</text>`,
      `<circle class="ring" cx="${cx + 11}" cy="${cy + 11}" r="5" fill="${accent}" stroke="#17171c" stroke-width="2"/>`,
    )

    // line 1: name, role; state and elapsed time on the right
    const elapsed = c.isMain ? '' : ` · ${ago((r.endedAt ?? now) - r.startedAt, lang)}`
    const pill = `${r.ask ? T('stAsk') : st.label}${elapsed}`
    const nameW = name.length * 7.6 + 8
    const roleRoom = Math.max(0, Math.floor((c.w - 64 - nameW - pill.length * 6.2 - 16) / 5.8))
    out.push(
      `<text x="${textX}" y="${c.y + 22}"><tspan class="t" font-size="13" font-weight="700" fill="#ececf1">${esc(name)}</tspan>${
        role && roleRoom > 3 ? `<tspan class="d" dx="8" font-size="11" fill="#9a9aa6">${esc(cut(role, roleRoom))}</tspan>` : ''
      }</text>`,
      c.isMain
        ? ''
        : `<text x="${c.x + c.w - 14}" y="${c.y + 22}" font-size="11" font-weight="600" fill="${accent}" text-anchor="end">${esc(pill)}</text>`,
    )

    // line 2: the task
    const task = c.isMain ? T('mainSummary', { n: r.toolCount, m: runs.length }) : r.description
    out.push(`<text class="d" x="${textX}" y="${c.y + 39}" font-size="11.5" fill="#b9b9c4">${esc(cut(task, room))}</text>`)

    // line 3: what it is doing or waiting on
    if (live) {
      const line = nowLine(r, runs, nameOf, now, lang)
      const show = c.isMain && r.active.length === 0 ? undefined : line
      if (show) {
        out.push(
          `<text x="${textX}" y="${c.y + 57}" font-size="11.5" font-weight="600" fill="${LINE_COLOR[show.color ?? ''] ?? '#67e8f9'}">${esc(cut(show.text, room))}<title>${esc(show.text)}</title></text>`,
        )
      }
    }

    // tool strip: recent calls oldest to newest; a call in flight blinks at the end
    const stripY = c.y + c.h - 17
    const slots = Math.max(0, Math.floor((c.w - 64 - 60) / 11))
    const recent = [...r.tools.slice(-Math.max(0, slots - r.active.length)), ...r.active]
    recent.forEach((a, i) => {
      const k = KIND[kindOf(a)]
      const running = a.endedAt === undefined
      out.push(
        `<rect x="${textX + i * 11}" y="${stripY}" width="8" height="8" rx="2" fill="${k.color}">${
          running ? '<animate attributeName="opacity" values="1;0.2;1" dur="0.9s" repeatCount="indefinite"/>' : ''
        }<title>${esc(`${toolLabel(a.tool, lang)}${a.summary ? `: ${a.summary}` : ''} · ${running ? T('inFlight') : took(a, now, lang)}`)}</title></rect>`,
      )
    })
    out.push(
      `<text class="d" x="${c.x + c.w - 14}" y="${stripY + 8}" font-size="10.5" fill="#9a9aa6" text-anchor="end">${esc(T('nTools', { n: r.toolCount }))}</text>`,
      '</g>',
    )
  }
  if (hiddenRows > 0) {
    out.push(`<text class="d" x="${PAD}" y="${y + 8}" font-size="11" fill="#9a9aa6">${esc(T('moreAgents', { n: hiddenRows }))}</text>`)
    y += 20
  }

  // ── timeline ─────────────────────────────────────────────
  const lanes = cards.filter(c => c.run.tools.length + c.run.active.length > 0 || !c.isMain)
  const starts = lanes.flatMap(c => [c.isMain ? Infinity : c.run.startedAt, ...c.run.tools.map(a => a.startedAt), ...c.run.active.map(a => a.startedAt)])
  const t0 = Math.min(...starts, now)
  const span = Math.max(1000, now - t0)
  if (lanes.length > 0 && Number.isFinite(t0)) {
    y += 8
    out.push(
      `<text class="t" x="${PAD}" y="${y + 10}" font-size="12" font-weight="700" fill="#ececf1">${esc(T('timeline'))}</text>`,
      `<text class="d" x="${W - PAD}" y="${y + 10}" font-size="10.5" fill="#9a9aa6" text-anchor="end">${esc(`${T('lastSpan', { x: ago(span, lang) })} · ${T('hoverHint')}`)}</text>`,
    )
    y += 22
    const labelW = 96
    const x0 = PAD + labelW
    const x1 = W - PAD
    const sx = (t: number) => x0 + ((t - t0) / span) * (x1 - x0)
    const laneH = 20
    const top = y
    for (let i = 0; i <= 4; i++) {
      const gx = x0 + ((x1 - x0) * i) / 4
      out.push(`<line class="grid" x1="${gx}" y1="${top}" x2="${gx}" y2="${top + lanes.length * laneH}" stroke="#ffffff" stroke-opacity="0.07"/>`)
    }
    for (const c of lanes) {
      const r = c.run
      const mid = y + laneH / 2
      const label = c.isMain ? T('main') : nameOf(r.type)
      const st = STATUS[r.status] ?? { color: '#8b8b98' }
      out.push(`<text class="d" x="${PAD + Math.min(c.depth, 3) * 8}" y="${mid + 4}" font-size="11" fill="#b9b9c4">${esc(cut(label, 14 - Math.min(c.depth, 3)))}</text>`)
      if (!c.isMain) {
        const a = sx(Math.max(t0, r.startedAt))
        const b = sx(r.endedAt ?? now)
        out.push(`<rect x="${a.toFixed(1)}" y="${mid - 2}" width="${Math.max(2, b - a).toFixed(1)}" height="4" rx="2" fill="${st.color}" fill-opacity="0.28"/>`)
      }
      for (const act of [...r.tools, ...r.active]) {
        const running = act.endedAt === undefined
        const a = sx(Math.max(t0, act.startedAt))
        const b = sx(act.endedAt ?? now)
        const k = KIND[kindOf(act)]
        out.push(
          `<rect x="${a.toFixed(1)}" y="${mid - 6}" width="${Math.max(3, b - a).toFixed(1)}" height="12" rx="3" fill="${k.color}" fill-opacity="0.9">${
            running ? '<animate attributeName="opacity" values="1;0.3;1" dur="0.9s" repeatCount="indefinite"/>' : ''
          }<title>${esc(`${label} · ${toolLabel(act.tool, lang)}${act.summary ? `: ${act.summary}` : ''} · ${running ? T('inFlight') : took(act, now, lang)}`)}</title></rect>`,
        )
      }
      y += laneH
    }
    // legend
    y += 12
    let lx = PAD
    for (const key of Object.keys(KIND) as KindKey[]) {
      const k = { color: KIND[key].color, label: T(KIND[key].label) }
      out.push(
        `<rect x="${lx}" y="${y - 8}" width="8" height="8" rx="2" fill="${k.color}"/>`,
        `<text class="d" x="${lx + 12}" y="${y}" font-size="10.5" fill="#9a9aa6">${esc(k.label)}</text>`,
      )
      lx += 26 + k.label.length * 6.1
    }
    y += 6
  }

  const height = Math.ceil(y + PAD)
  const style =
    '<style>text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}' +
    '@media (prefers-color-scheme: light){.t{fill:#17171c}.d{fill:#5b5b66}.card{fill:#000;stroke:#000}.grid{stroke:#000}.ring{stroke:#fff}}</style>'
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">${style}${out.join('')}</svg>`

  const alt = T('altSummary', { a: running, b: waiting, c: done, d: toolTotal })
  return { source, alt, width: W, height }
}
