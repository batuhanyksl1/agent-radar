import { expect, test } from 'claude-code/testing'

import { describeTool, flattenTree, nowLine, parsePersona } from '../hooks/register'
import { buildScene } from '../hooks/scene'
import type { Run } from '../types'
import { MESSAGES, pickLang, tr } from '../web/i18n.js'

const PANE = {
  plugin: 'agent-radar',
  component: 'Pane',
  requestId: 'agent-radar',
  props: {
    title: 'Agent Radar',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const FILES: Record<string, string> = {
  'ada.md': '---\nname: ada\ndescription: "Ada — Tech Lead, Engineering. Use for architecture calls."\n---\nBody.\n',
  'kenji.md': '---\nname: kenji\ndescription: "Kenji — iOS Engineer, Engineering. Use for Swift work."\n---\nBody.\n',
}

const run = (id: string, over: Partial<Run> = {}): Run => ({
  id, type: id, description: 'task', status: 'running', startedAt: 0, active: [], tools: [], toolCount: 0, ...over,
})

test('pane: handoff tree, live line, waiting reason, tool history, state file and web command', async ($, on) => {
  on('command.register', () => ({ value: { command: 'radar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/x' : e.name === 'LANG' ? 'en_US.UTF-8' : undefined }))
  on('fs.list', (_, e) => {
    if (String(e.path) !== '/home/x/.claude/agents') throw new Error('ENOENT')
    return { value: Object.keys(FILES).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_, e) => ({ value: FILES[String(e.path).split('/').pop() ?? ''] ?? '' }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  const written: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    written.push({ path: String(e.path), text: String(e.text) })
    return { value: undefined }
  })
  const ran: string[][] = []
  on('process.run', (_, e) => {
    ran.push([...(e.argv as string[])])
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('command.run', () => ({ text: '' }))
  on('agent.list', () => ({
    value: [
      { id: 'a1', type: 'ada', description: 'Plan the release', status: 'waiting' },
      { id: 'a2', type: 'kenji', description: 'Fix the paywall', status: 'running', parentId: 'a1' },
    ],
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.UserPromptSubmit', () => ({}))
  let n = 0
  on('agent.spawn', () => ({ model: 'haiku', agentId: `a${++n}` }))
  on('tool.call', (_, e) => (e.tool === 'Bash' ? { isError: true, result: {} } : { result: {} }))

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await $.classic.UserPromptSubmit({ prompt: 'Ship the paywall redesign', session_title: 'Paywall redesign' } as never)
  const base = { tool_use_id: 't0', prompt: 'x', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'opus', background: false, fork: false }
  await $.agent.spawn({ ...base, description: 'Plan the release', subagentType: 'ada' } as never)
  await $.agent.spawn({ ...base, description: 'Fix the paywall', subagentType: 'kenji', parentAgentId: 'a1' } as never)
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/repo/apps/ios/README.md', agentId: 'a2' } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'sleep 5', description: 'Run the tests', agentId: 'a2' } as never)

  // /radar-web publishes the state, starts the server and opens the page
  const web = await $.command.run({ command: 'radar-web', args: '' } as never)
  expect((web as { text?: string }).text).toContain('http://127.0.0.1:4747')
  const state = written.findLast(w => w.path.startsWith('/home/x/.claude/agent-radar/state/') && w.path.endsWith('.json'))
  const parsed = JSON.parse(state?.text ?? '{}')
  expect(parsed.runs.map((r: { type: string }) => r.type)).toEqual(['ada', 'kenji'])
  expect(parsed.cwd).toBe('/repo')
  expect(parsed.title).toBe('Paywall redesign')
  expect(parsed.people.find((p: { slug: string }) => p.slug === 'ada')).toEqual({ slug: 'ada', name: 'Ada', role: 'Tech Lead', group: 'Engineering' })
  expect(ran[0]?.[2]).toContain('web/server.mjs')
  expect(ran[1]).toEqual(['open', 'http://127.0.0.1:4747'])

  {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /Plan the release/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Thinking/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Waiting on Kenji/ })).toBeDefined()
    await ui.press({ key: 'run:a2' })
    expect(await ui.find({ type: 'Text', text: /✓ Read …\/ios\/README\.md/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✕ Bash/ })).toBeDefined()
    await ui.press({ key: 'run:a2' })
    await ui.unmount()
  }
  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Paywall redesign/ })).toBeDefined()
    await ui.press({ key: 'run:a2' })
    expect(await ui.find({ type: 'Text', text: /✓ Read …\/ios\/README\.md/ })).toBeDefined()
    await ui.press({ key: 'run:a2' })
    await ui.unmount()
  }
})

test('approval flag: shown only while a person is asked, cleared once the call settles', async ($, on) => {
  on('command.register', () => ({ value: { command: 'radar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/x' : undefined }))
  on('fs.list', () => ({ value: [] }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  const written: string[] = []
  on('fs.write', (_, e) => {
    written.push(String(e.text))
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('command.run', () => ({ text: '' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => ({ result: {} }))
  // The published state of the main loop, as the web page reads it.
  const rootAsk = async () => {
    await $.command.run({ command: 'radar-web', args: '' } as never)
    return JSON.parse(written.at(-1) ?? '{}').root.ask as string | undefined
  }
  let during: string | undefined
  let isPersonAsked = false
  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.PermissionRequest', async () => {
    isPersonAsked = true
    during = await rootAsk()
    return { decision: { behavior: 'allow' } }
  })

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'git push', description: 'Push' } as never)

  expect(isPersonAsked).toBe(true)
  expect(during).toContain('Bash')
  expect(await rootAsk()).toBeUndefined()
})

test('scene: cards, waiting reason, live animation, timeline, and another language', () => {
  const people = [
    { slug: 'ada', name: 'Ada', role: 'Tech Lead', group: 'Engineering' },
    { slug: 'kenji', name: 'Kenji', role: 'iOS Engineer', group: 'Engineering' },
  ]
  const root = run('__main__', { toolCount: 3 })
  const runs = [
    run('a1', { type: 'ada', description: 'Plan <the> release', status: 'waiting', startedAt: 1000 }),
    run('a2', {
      type: 'kenji', description: 'Fix the paywall', parentId: 'a1', startedAt: 2000, toolCount: 2,
      tools: [{ id: '1', tool: 'Read', summary: 'a.ts', startedAt: 2500, endedAt: 3000 }],
      active: [{ id: '2', tool: 'Bash', summary: 'Run the tests', startedAt: 4000 }],
    }),
    run('a3', { type: 'general-purpose', description: 'Old job', status: 'completed', startedAt: 500, endedAt: 900 }),
  ]
  const scene = buildScene(root, runs, people, 6000, true)
  expect(scene.source.startsWith('<svg')).toBe(true)
  expect(scene.source).toContain('Plan &lt;the&gt; release')
  expect(scene.source).toContain('⏳ Waiting on Kenji')
  expect(scene.source).toContain('▸ Bash: Run the tests')
  expect(scene.source).toContain('Timeline')
  expect(scene.source).toContain('<animate')
  expect(scene.source.length).toBeLessThan(131072)
  expect(scene.alt).toBe('1 agents running, 1 waiting, 1 done, 5 tool calls.')
  expect(buildScene(root, runs, people, 6000, false).source).not.toContain('Old job')
  const de = buildScene(root, runs, people, 6000, true, 'de').source
  expect(de).not.toContain('Timeline')
  expect(de).toContain(tr('de', 'timeline'))
})

test('tree: a child sits under its parent; a live child keeps a finished parent', () => {
  const runs = [run('a', { status: 'completed' }), run('b', { parentId: 'a' }), run('c', { status: 'completed' })]
  expect(flattenTree(runs, () => true).map(r => r.prefix + r.run.id)).toEqual(['├─ a', '│  └─ b', '└─ c'])
  expect(flattenTree(runs, r => r.status === 'running').map(r => r.prefix + r.run.id)).toEqual(['└─ a', '   └─ b'])
})

test('what an agent is doing or waiting on', () => {
  const name = (t: string) => t.toUpperCase()
  const line = (r: Run, all: Run[] = [], now = 0) => nowLine(r, all, name, now, 'en')?.text
  expect(line(run('x', { ask: 'Bash: git push' }))).toBe('🔒 Needs your approval: Bash: git push')
  expect(line(run('x', { status: 'idle' }))).toContain('waiting for a message')
  expect(line(run('x', { status: 'waiting', active: [{ id: '1', tool: 'Agent', summary: 'kenji: fix', startedAt: 0 }] })))
    .toBe('⏳ Waiting on handed-off work: kenji: fix')
  expect(line(run('x'))).toContain('Thinking')
  expect(line(run('x', { active: [{ id: '1', tool: 'Bash', summary: 'Run the tests', startedAt: 0 }] }), [], 2000)).toBe('▸ Bash: Run the tests · 2s')
  expect(line(run('p'), [run('k', { parentId: 'p' })])).toBe('⏳ Waiting on K')
  expect(line(run('x', { status: 'completed' }))).toBeUndefined()
  expect(nowLine(run('x', { status: 'idle' }), [], name, 0, 'tr')?.text).toContain('yeni mesaj bekliyor')
})

test('tool summaries and agent definitions', () => {
  expect(describeTool('Bash', { command: 'git status', description: 'Check status' })).toEqual({ tool: 'Bash', summary: 'Check status' })
  expect(describeTool('Agent', { subagent_type: 'kenji', description: 'fix it' })).toEqual({ tool: 'Agent', summary: 'kenji: fix it' })
  expect(describeTool('mcp__linear__get_issue', { id: 'ENG-1' }).tool).toBe('linear:get_issue')
  expect(parsePersona('reviewer', '---\nname: reviewer\ndescription: Reviews diffs for bugs. Use after edits.\nteam: Quality\n---\n'))
    .toEqual({ slug: 'reviewer', name: 'reviewer', role: 'Reviews diffs for bugs', group: 'Quality' })
  expect(parsePersona('ada', FILES['ada.md'] ?? '')).toEqual({ slug: 'ada', name: 'Ada', role: 'Tech Lead', group: 'Engineering' })
})

test('i18n: every language has every key; locale tags map to a bundled language', () => {
  const keys = Object.keys(MESSAGES.en ?? {})
  expect(Object.keys(MESSAGES).length).toBe(14)
  for (const [lang, m] of Object.entries(MESSAGES)) expect([lang, Object.keys(m)]).toEqual([lang, keys])
  expect(pickLang('tr_TR.UTF-8')).toBe('tr')
  expect(pickLang('pt_PT')).toBe('pt-BR')
  expect(pickLang('zh-CN')).toBe('zh-Hans')
  expect(pickLang('C')).toBe('en')
  expect(tr('xx', 'main')).toBe('Main session')
})
