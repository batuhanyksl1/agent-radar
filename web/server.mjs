// Agent Radar: the local web server. No dependencies; listens on 127.0.0.1 only.
// The plugin writes each session's state to ~/.claude/agent-radar/state/<sid>.json;
// this server reads those files and hands them to the page.
//   node web/server.mjs [port]      (default 4747)
import { createServer } from 'node:http'
import { readFile, readdir, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.argv[2]) || 4747
const HERE = dirname(fileURLToPath(import.meta.url))
const STATE = process.env.AGENT_RADAR_STATE || join(homedir(), '.claude', 'agent-radar', 'state')
const ALIVE_MS = 45_000
const KEEP_MS = 24 * 3600_000
const PURGE_MS = 7 * 24 * 3600_000
const IDLE_EXIT_MS = 12 * 3600_000

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/i18n.js': ['i18n.js', 'text/javascript; charset=utf-8'],
  '/demo.js': ['demo.js', 'text/javascript; charset=utf-8'],
}

let lastHit = Date.now()

async function sessions() {
  const now = Date.now()
  let names = []
  try {
    names = await readdir(STATE)
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = join(STATE, name)
    try {
      const { mtimeMs } = await stat(file)
      if (now - mtimeMs > PURGE_MS) {
        await unlink(file)
        continue
      }
      if (now - mtimeMs > KEEP_MS) continue
      const data = JSON.parse(await readFile(file, 'utf8'))
      out.push({ ...data, isAlive: now - (data.updatedAt ?? mtimeMs) < ALIVE_MS })
    } catch {
      // a half-written or broken file: skipped this round
    }
  }
  out.sort((a, b) => Number(b.isAlive) - Number(a.isAlive) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return out
}

const server = createServer(async (req, res) => {
  lastHit = Date.now()
  const path = (req.url ?? '/').split('?')[0]
  try {
    if (path === '/api/state') {
      const body = JSON.stringify({ now: Date.now(), sessions: await sessions() })
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(body)
      return
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
  // A taken port most likely means a copy of this server is already running.
  process.exit(err && err.code === 'EADDRINUSE' ? 0 : 1)
})
server.listen(PORT, '127.0.0.1')

setInterval(() => {
  if (Date.now() - lastHit > IDLE_EXIT_MS) process.exit(0)
}, 60_000).unref()
