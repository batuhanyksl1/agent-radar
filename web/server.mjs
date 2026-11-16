// Agent Radar: local web server, bound to loopback only.
import { createServer } from 'node:http'
import { open, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.argv[2]) || 4747
const HERE = dirname(fileURLToPath(import.meta.url))
const STATE = process.env.AGENT_RADAR_STATE || join(homedir(), '.claude', 'agent-radar', 'state')
const PROJECTS = resolve(process.env.AGENT_RADAR_PROJECTS || join(homedir(), '.claude', 'projects'))
const HIDDEN = join(dirname(STATE), 'hidden.json')
const ID = /^[A-Za-z0-9_-]{1,80}$/
const paths = new Map()
const usageFiles = new Map()
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/i18n.js': ['i18n.js', 'text/javascript; charset=utf-8'],
  '/demo.js': ['demo.js', 'text/javascript; charset=utf-8'],
}
let lastHit = Date.now()

async function existing(path) {
  const full = resolve(path)
  try {
    const root = await realpath(PROJECTS)
    if (!full.startsWith(PROJECTS + sep) && !full.startsWith(root + sep)) return undefined
    const actual = await realpath(full)
    if (!actual.startsWith(root + sep)) return undefined
    const info = await stat(actual)
    return info.isFile() ? { path: actual, mtime: info.mtimeMs } : undefined
  } catch { return undefined }
}

async function findAgent(id) {
  let best
  let projects = []
  try { projects = await readdir(PROJECTS, { withFileTypes: true }) } catch { return undefined }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const base = join(PROJECTS, project.name)
    let sessions = []
    try { sessions = await readdir(base, { withFileTypes: true }) } catch { continue }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const found = await existing(join(base, session.name, 'subagents', `agent-${id}.jsonl`))
      if (found && (!best || found.mtime > best.mtime)) best = found
    }
  }
  return best?.path
}

async function transcriptFor(session, runKey) {
  if (runKey !== 'main' && !session.runs?.some(run => run.id === runKey)) return undefined
  const key = `${session.sid}:${runKey}`
  const cached = paths.get(key)
  if (cached && await existing(cached)) return cached
  let main = typeof session.transcript === 'string' ? (await existing(session.transcript))?.path : undefined
  if (!main && Array.isArray(session.runs)) {
    for (const run of session.runs) {
      if (!ID.test(run.id ?? '')) continue
      const agent = await findAgent(run.id)
      if (!agent) continue
      const sessionDir = dirname(dirname(agent))
      main = (await existing(join(dirname(sessionDir), `${basename(sessionDir)}.jsonl`)))?.path
      if (main) break
    }
  }
  let result = main
  if (runKey !== 'main') {
    result = main ? (await existing(join(main.slice(0, -6), 'subagents', `agent-${runKey}.jsonl`)))?.path : undefined
    if (!result) result = await findAgent(runKey)
  }
  if (result) paths.set(key, result)
  return result
}

async function fileUsage(path) {
  const info = await stat(path)
  let entry = usageFiles.get(path)
  if (!entry || info.size < entry.size) {
    entry = { size: 0, offset: 0, seenIds: new Set(), model: '', in: 0, cached: 0, out: 0 }
    usageFiles.set(path, entry)
  }
  if (info.size > entry.offset) {
    const file = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(info.size - entry.offset)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, entry.offset)
      const text = buffer.subarray(0, bytesRead).toString('utf8')
      const end = text.lastIndexOf('\n')
      if (end >= 0) {
        entry.offset += Buffer.byteLength(text.slice(0, end + 1))
        for (const raw of text.slice(0, end).split('\n')) {
          let row
          try { row = JSON.parse(raw) } catch { continue }
          const msg = row.type === 'assistant' ? row.message : undefined
          if (typeof msg?.model === 'string') entry.model = msg.model
          if (!msg?.id || entry.seenIds.has(msg.id)) continue
          entry.seenIds.add(msg.id)
          const u = msg.usage ?? {}
          entry.in += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
          entry.cached += u.cache_read_input_tokens ?? 0
          entry.out += u.output_tokens ?? 0
        }
      }
    } finally { await file.close() }
  }
  entry.size = info.size
  return { model: entry.model, in: entry.in, cached: entry.cached, out: entry.out }
}

async function hiddenData() {
  try {
    const data = JSON.parse(await readFile(HIDDEN, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? Object.assign(Object.create(null), data) : Object.create(null)
  } catch { return Object.create(null) }
}

async function saveHidden(data) {
  const tmp = `${HIDDEN}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(data))
  await rename(tmp, HIDDEN)
}

async function sessions() {
  const now = Date.now()
  let names = []
  try { names = await readdir(STATE) } catch { return [] }
  const hidden = await hiddenData()
  let changed = false
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = join(STATE, name)
    try {
      const { mtimeMs } = await stat(file)
      if (now - mtimeMs > 7 * 24 * 3600_000) { await unlink(file); continue }
      if (now - mtimeMs > 24 * 3600_000) continue
      const data = JSON.parse(await readFile(file, 'utf8'))
      if (!ID.test(data.sid ?? '')) continue
      const isAlive = now - (data.updatedAt ?? mtimeMs) < 45_000
      let entry = hidden[data.sid]
      if (entry && (data.shownAt ?? 0) > entry.at) {
        delete hidden[data.sid]
        entry = undefined
        changed = true
      }
      const usage = Object.create(null)
      for (const key of ['main', ...(data.runs ?? []).map(run => run.id).filter(id => ID.test(id))]) {
        const path = await transcriptFor(data, key)
        if (!path) continue
        if (isAlive || now - (data.updatedAt ?? mtimeMs) < 3600_000) {
          try { usage[key] = await fileUsage(path) } catch { /* file changed during read */ }
        } else if (usageFiles.has(path)) {
          const u = usageFiles.get(path)
          usage[key] = { model: u.model, in: u.in, cached: u.cached, out: u.out }
        }
      }
      const { transcript, ...publicData } = data
      out.push({ ...publicData, isAlive, hidden: !!entry?.session, hiddenRuns: entry?.runs ?? [], usage })
    } catch { /* a half-written or broken file is skipped */ }
  }
  if (changed) await saveHidden(hidden)
  out.sort((a, b) => Number(b.isAlive) - Number(a.isAlive) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return out
}

async function sessionById(sid) {
  try { return JSON.parse(await readFile(join(STATE, `${sid}.json`), 'utf8')) } catch { return undefined }
}

function chatItems(rows) {
  const items = []
  const tools = new Map()
  for (const row of rows) {
    const at = Date.parse(row.timestamp ?? '') || 0
    const content = row.message?.content
    if (row.type === 'user' && row.isMeta) continue
    if (row.type === 'user' && typeof content === 'string') {
      if (content.startsWith('<') && /system-reminder|command-name|local-command/.test(content)) continue
      items.push({ i: items.length, role: 'user', text: content.slice(0, 20_000), at })
      continue
    }
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (row.type === 'user' && block.type === 'tool_result') {
        const item = tools.get(block.tool_use_id)
        if (item && block.is_error) item.isError = true
      } else if (block.type === 'text' && typeof block.text === 'string') {
        const role = row.type === 'user' ? 'user' : row.type === 'assistant' ? 'assistant' : undefined
        if (role) items.push({ i: items.length, role, text: block.text.slice(0, 20_000), at })
      } else if (row.type === 'assistant' && block.type === 'tool_use') {
        const input = block.input ?? {}
        // A subagent hands its report back through a tool call: that text is its last message.
        if (block.name === 'SubagentHandback' && typeof input.message === 'string' && input.message.trim()) {
          items.push({ i: items.length, role: 'assistant', text: input.message.slice(0, 20_000), at })
          continue
        }
        const summary = ['description', 'command', 'file_path', 'path', 'pattern', 'query', 'url', 'prompt']
          .map(key => input[key]).find(value => typeof value === 'string' && value.trim())
        const item = { i: items.length, role: 'tool', tool: block.name, summary: String(summary ?? '').slice(0, 140), at }
        items.push(item)
        if (block.id) tools.set(block.id, item)
      }
    }
  }
  return items
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function requestBody(req) {
  const parts = []
  let size = 0
  for await (const part of req) {
    size += part.length
    if (size <= 4096) parts.push(part)
  }
  if (size > 4096) return undefined
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { return undefined }
}

const server = createServer(async (req, res) => {
  lastHit = Date.now()
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  const path = url.pathname
  try {
    if (path.startsWith('/api')) {
      const hosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`]
      if (!hosts.includes(req.headers.host)) return json(res, 403, { error: 'forbidden' })
      if (req.method === 'POST') {
        if (req.headers.origin && !hosts.some(host => req.headers.origin === `http://${host}`)) return json(res, 403, { error: 'forbidden' })
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 400, { error: 'bad content type' })
      }
      if (path === '/api/state' && req.method === 'GET') return json(res, 200, { now: Date.now(), sessions: await sessions() })
      if (path === '/api/chat' && req.method === 'GET') {
        const sid = url.searchParams.get('sid')
        const run = url.searchParams.get('run') ?? 'main'
        const after = url.searchParams.get('after')
        if (!ID.test(sid ?? '') || !ID.test(run) || (after !== null && !/^-?\d+$/.test(after))) return json(res, 400, { error: 'bad query' })
        const session = await sessionById(sid)
        const transcript = session && await transcriptFor(session, run)
        if (!transcript) return json(res, 200, { found: false, total: 0, items: [] })
        const rows = (await readFile(transcript, 'utf8')).split('\n').flatMap(raw => {
          try { return [JSON.parse(raw)] } catch { return [] }
        })
        const items = chatItems(rows)
        return json(res, 200, { found: true, total: items.length, items: after === null ? items.slice(-200) : items.filter(item => item.i > Number(after)).slice(0, 200) })
      }
      if (path === '/api/hide' && req.method === 'POST') {
        const body = await requestBody(req)
        if (!body || !ID.test(body.sid ?? '') || (body.run !== undefined && !ID.test(body.run)) || typeof body.hidden !== 'boolean') return json(res, 400, { error: 'bad body' })
        const hidden = await hiddenData()
        const entry = hidden[body.sid] ?? { at: 0, session: false, runs: [] }
        entry.at = Date.now()
        if (body.run) entry.runs = body.hidden ? [...new Set([...entry.runs, body.run])] : entry.runs.filter(id => id !== body.run)
        else entry.session = body.hidden
        if (!entry.session && !entry.runs.length) delete hidden[body.sid]
        else hidden[body.sid] = entry
        await saveHidden(hidden)
        return json(res, 200, { ok: true })
      }
      return json(res, 404, { error: 'not found' })
    }
    const file = STATIC[path]
    if (file) {
      res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store' })
      res.end(await readFile(join(HERE, file[0])))
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(String(err))
  }
})

server.on('error', err => {
  process.exit(err && err.code === 'EADDRINUSE' ? 0 : 1)
})
server.listen(PORT, '127.0.0.1')
setInterval(() => {
  if (Date.now() - lastHit > 12 * 3600_000) process.exit(0)
}, 60_000).unref()
