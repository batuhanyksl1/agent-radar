import { request } from 'node:http'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { appendFile, mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

const line = value => JSON.stringify(value) + '\n'
const message = (id, content, usage, model = 'claude-test') => ({ type: 'assistant', timestamp: '2026-11-17T10:00:01Z', message: { id, model, content, usage } })

async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

test('state usage, chat, hide and local API security', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-server-'))
  const stateDir = join(dir, 'state')
  const projects = join(dir, 'projects')
  let child
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill()
      await new Promise(resolve => child.once('exit', resolve))
    }
    await rm(dir, { recursive: true, force: true })
  })
  const project = join(projects, 'project-a')
  const main = join(project, 'claude-session.jsonl')
  const subdir = join(project, 'claude-session', 'subagents')
  const sub = join(subdir, 'agent-agent1.jsonl')
  await mkdir(stateDir)
  await mkdir(subdir, { recursive: true })
  const usage = { input_tokens: 10, cache_creation_input_tokens: 3, cache_read_input_tokens: 4, output_tokens: 5 }
  await writeFile(main, [
    line({ type: 'user', timestamp: '2026-11-17T10:00:00Z', message: { content: 'Hello' } }),
    line({ type: 'user', isMeta: true, timestamp: '2026-11-17T10:00:00Z', message: { content: 'Hidden meta' } }),
    line({ type: 'user', timestamp: '2026-11-17T10:00:00Z', message: { content: '<system-reminder>secret</system-reminder>' } }),
    line(message('m1', [{ type: 'text', text: 'First' }], usage)),
    line(message('m1', [{ type: 'tool_use', id: 'tool1', name: 'Bash', input: { command: 'echo yes' } }], usage)),
    line({ type: 'user', timestamp: '2026-11-17T10:00:02Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tool1', is_error: true, content: 'private output' }, { type: 'text', text: 'Follow up' }] } }),
  ].join(''))
  await writeFile(sub, line(message('s1', [{ type: 'text', text: 'Agent says hi' }], { input_tokens: 2, output_tokens: 1 })))
  const state = {
    sid: 'sid1', cwd: '/repo', title: 'Test', updatedAt: Date.now(),
    transcript: main, shownAt: 0,
    root: { id: '__main__', status: 'running' },
    runs: [{ id: 'agent1', status: 'running' }], people: [],
  }
  await writeFile(join(stateDir, 'sid1.json'), JSON.stringify(state))
  await writeFile(join(stateDir, 'fallback.json'), JSON.stringify({ ...state, sid: 'fallback', transcript: undefined }))
  await writeFile(join(stateDir, 'outside.json'), JSON.stringify({ ...state, sid: 'outside', transcript: join(dir, 'outside.jsonl'), runs: [] }))
  await writeFile(join(dir, 'outside.jsonl'), line(message('o1', [{ type: 'text', text: 'Never read' }], usage)))
  await symlink(join(dir, 'outside.jsonl'), join(project, 'escape.jsonl'))
  await writeFile(join(stateDir, 'link.json'), JSON.stringify({ ...state, sid: 'link', transcript: join(project, 'escape.jsonl'), runs: [] }))
  const port = await freePort()
  child = spawn(process.execPath, ['web/server.mjs', String(port)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, AGENT_RADAR_STATE: stateDir, AGENT_RADAR_PROJECTS: projects },
    stdio: 'ignore',
  })
  const url = `http://127.0.0.1:${port}`
  let ready = false
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) break
    try { await fetch(url + '/api/state'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 20)) }
  }
  assert.equal(ready, true, 'server starts')
  const get = async path => fetch(url + path).then(r => r.json())
  const post = async body => fetch(url + '/api/hide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  const first = await get('/api/state')
  const session = first.sessions.find(s => s.sid === 'sid1')
  assert.equal(session.transcript, undefined)
  assert.deepEqual(session.usage.main, { model: 'claude-test', in: 13, cached: 4, out: 5 })
  assert.deepEqual(session.usage.agent1, { model: 'claude-test', in: 2, cached: 0, out: 1 })
  assert.equal(first.sessions.find(s => s.sid === 'outside').usage.main, undefined)
  assert.deepEqual((await get('/api/state')).sessions.find(s => s.sid === 'sid1').usage.main, session.usage.main)

  const chat = await get('/api/chat?sid=sid1&run=main')
  assert.equal(chat.found, true)
  assert.equal(chat.total, 4)
  assert.deepEqual(chat.items.map(item => [item.role, item.text, item.tool, item.summary, item.isError]), [
    ['user', 'Hello', undefined, undefined, undefined],
    ['assistant', 'First', undefined, undefined, undefined],
    ['tool', undefined, 'Bash', 'echo yes', true],
    ['user', 'Follow up', undefined, undefined, undefined],
  ])
  assert.deepEqual((await get('/api/chat?sid=sid1&run=main&after=1')).items.map(item => item.i), [2, 3])
  assert.equal((await get('/api/chat?sid=sid1&run=agent1')).items[0].text, 'Agent says hi')
  assert.equal((await get('/api/chat?sid=fallback&run=main')).items[0].text, 'Hello')
  assert.deepEqual(await get('/api/chat?sid=outside&run=main'), { found: false, total: 0, items: [] })
  assert.deepEqual(await get('/api/chat?sid=link&run=main'), { found: false, total: 0, items: [] })

  const next = line(message('m2', [{ type: 'text', text: 'Later' }], { input_tokens: 7, output_tokens: 2 }))
  await appendFile(main, next.slice(0, -1))
  assert.equal((await get('/api/state')).sessions.find(s => s.sid === 'sid1').usage.main.in, 13)
  await appendFile(main, '\n')
  assert.deepEqual((await get('/api/state')).sessions.find(s => s.sid === 'sid1').usage.main, { model: 'claude-test', in: 20, cached: 4, out: 7 })
  await writeFile(main, line(message('m3', [{ type: 'text', text: 'Replaced' }], { input_tokens: 1, output_tokens: 1 })))
  assert.deepEqual((await get('/api/state')).sessions.find(s => s.sid === 'sid1').usage.main, { model: 'claude-test', in: 1, cached: 0, out: 1 })

  assert.equal((await post({ sid: 'sid1', hidden: true })).status, 200)
  assert.equal((await post({ sid: 'sid1', run: 'agent1', hidden: true })).status, 200)
  const hidden = (await get('/api/state')).sessions.find(s => s.sid === 'sid1')
  assert.equal(hidden.hidden, true)
  assert.deepEqual(hidden.hiddenRuns, ['agent1'])
  await writeFile(join(stateDir, 'sid1.json'), JSON.stringify({ ...state, shownAt: Date.now() + 1000 }))
  const shown = (await get('/api/state')).sessions.find(s => s.sid === 'sid1')
  assert.equal(shown.hidden, false)
  assert.deepEqual(shown.hiddenRuns, [])

  // fetch() refuses to send a foreign Host header, so this one goes through node:http.
  const foreign = await new Promise((resolve, reject) => {
    request(url + '/api/state', { headers: { host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode) }).on('error', reject).end()
  })
  assert.equal(foreign, 403)
  assert.equal((await fetch(url + '/api/chat?sid=../bad&run=main')).status, 400)
  assert.equal((await fetch(url + '/api/hide', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 400)
  assert.equal((await fetch(url + '/api/hide', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'http://evil.test' }, body: '{}' })).status, 403)
})
