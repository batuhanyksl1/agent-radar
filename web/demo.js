// Sample sessions for `?demo`: screenshots and a first look without a running
// session. Times are relative to now, so in-flight calls keep ticking.
// Hiding works in memory here, and conversations come from demoChat, so the
// demo never calls the API.
const demoHidden = { 'demo-2': { session: false, runs: ['dq'] } }

export function demoHide(sid, run, hidden) {
  const h = demoHidden[sid] ??= { session: false, runs: [] }
  if (!run) h.session = hidden
  else h.runs = hidden ? [...new Set([...h.runs, run])] : h.runs.filter(r => r !== run)
}

export function demoSessions(now) {
  const t = s => now - (600 - s) * 1000
  const act = (id, tool, summary, s, e, isError) => ({
    id, tool, summary, startedAt: t(s), ...(e ? { endedAt: t(e) } : {}), ...(isError ? { isError } : {}),
  })
  const run = (id, o) => ({ id, type: id, description: '', status: 'running', startedAt: t(0), active: [], tools: [], toolCount: 0, ...o })
  const use = (model, i, c, o) => ({ model, in: i, cached: c, out: o })
  const hide = sid => ({ hidden: !!demoHidden[sid]?.session, hiddenRuns: [...(demoHidden[sid]?.runs ?? [])] })
  const people = [
    { slug: 'sofia', name: 'Sofia', role: 'Product Lead', group: 'Product' },
    { slug: 'marcus', name: 'Marcus', role: 'Tech Lead', group: 'Engineering' },
    { slug: 'kenji', name: 'Kenji', role: 'Senior iOS Engineer', group: 'Engineering' },
    { slug: 'priya', name: 'Priya', role: 'Backend Engineer', group: 'Engineering' },
    { slug: 'lena', name: 'Lena', role: 'QA Lead', group: 'Quality' },
    { slug: 'diego', name: 'Diego', role: 'Growth Marketer', group: 'Marketing' },
    { slug: 'amara', name: 'Amara', role: 'Data Analyst', group: 'Data' },
    { slug: 'noah', name: 'Noah', role: 'Docs Writer', group: 'Engineering' },
  ]
  const s1 = {
    sid: 'demo-1', cwd: '/Users/alex/code/checkout-app', title: 'Ship the paywall redesign', updatedAt: now, isAlive: true, people, ...hide('demo-1'),
    usage: { main: use('claude-opus-5', 61240, 1840200, 12480), s: use('claude-sonnet-5', 22410, 402100, 4210), t: use('claude-opus-5', 18930, 311800, 3620),
      e: use('claude-sonnet-5', 40120, 905300, 8930), a: use('claude-sonnet-5', 15800, 260400, 2950), l: use('claude-sonnet-5', 9030, 120700, 1610),
      n: use('claude-haiku-5-5', 6420, 64100, 2240), g: use('claude-haiku-5-5', 3110, 21800, 540), m: use('claude-sonnet-5', 4820, 38900, 760) },
    root: run('__main__', { toolCount: 14, tools: [
      act('m1', 'Read', 'docs/ROADMAP.md', 372, 374), act('m2', 'Agent', 'sofia: Update the spec and tickets', 398, 399),
      act('m3', 'Agent', 'marcus: Run the nine code lanes', 400, 401), act('m4', 'Bash', 'git status', 468, 471) ] }),
    runs: [
      run('s', { type: 'sofia', description: 'Update the spec and close out the tickets', startedAt: t(398), toolCount: 9,
        tools: [act('1', 'Read', 'docs/adr/007-pricing.md', 403, 406), act('2', 'Grep', '"paywall"', 408, 410), act('3', 'linear:get_issue', 'ENG-212', 418, 422),
          act('4', 'Edit', 'docs/adr/008-paywall.md', 438, 444), act('5', 'Bash', 'npm run lint', 468, 493), act('6', 'linear:update_issue', 'ENG-212', 498, 501)],
        active: [act('7', 'Bash', 'Sync ticket states', 584)] }),
      run('t', { type: 'marcus', description: 'Run the nine code lanes for the redesign', status: 'waiting', startedAt: t(400), toolCount: 6,
        tools: [act('1', 'Read', 'docs/ARCHITECTURE.md', 403, 405), act('2', 'Glob', 'apps/ios/**/*.swift', 408, 409)],
        active: [act('3', 'Agent', 'kenji: Paywall screen', 428), act('4', 'Agent', 'priya: Entitlements model', 429), act('5', 'Agent', 'lena: Regression plan', 430)] }),
      run('e', { type: 'kenji', parentId: 't', description: 'Paywall screen: subscription state and restore flow', startedAt: t(428), toolCount: 17,
        tools: [act('1', 'Read', 'PaywallView.swift', 431, 433), act('2', 'Read', 'Tokens.swift', 434, 435), act('3', 'Edit', 'PaywallView.swift', 448, 454),
          act('4', 'Bash', 'xcodebuild build', 458, 538, true), act('5', 'Edit', 'PaywallView.swift', 543, 548)],
        active: [act('6', 'Bash', 'xcodebuild build', 553), act('7', 'Read', 'Typography.swift', 590)] }),
      run('a', { type: 'priya', parentId: 't', description: 'Entitlements model and webhook handler', startedAt: t(429), toolCount: 5,
        tools: [act('1', 'Read', 'db/schema.ts', 432, 434), act('2', 'Grep', '"entitlement"', 438, 441), act('3', 'WebFetch', 'docs.stripe.com/webhooks', 448, 468),
          act('4', 'Write', 'db/migrations/0042_entitlements.sql', 480, 486)], ask: 'Bash: pnpm db:migrate' }),
      run('l', { type: 'lena', parentId: 't', description: 'Regression plan for checkout', startedAt: t(430), toolCount: 4,
        tools: [act('1', 'Read', 'tests/e2e/checkout.spec.ts', 433, 436), act('2', 'Grep', '"restore"', 440, 442)],
        active: [act('3', 'Agent', 'noah: Test matrix doc', 470)] }),
      run('n', { type: 'noah', parentId: 'l', description: 'Write the test matrix doc', startedAt: t(470), toolCount: 3,
        tools: [act('1', 'Read', 'docs/testing.md', 473, 475), act('2', 'Write', 'docs/test-matrix.md', 500, 512)], active: [act('3', 'Edit', 'docs/test-matrix.md', 592)] }),
      run('g', { type: 'general-purpose', parentId: 't', description: 'Measure bundle size before and after', status: 'completed', startedAt: t(408), endedAt: t(429), toolCount: 2,
        tools: [act('1', 'Bash', 'du -sh build/', 413, 414), act('2', 'Bash', 'pnpm size', 416, 427)] }),
      run('m', { type: 'diego', description: 'Draft the launch announcement', status: 'failed', startedAt: t(378), endedAt: t(396), toolCount: 2,
        tools: [act('1', 'Read', 'README.md', 380, 382), act('2', 'WebSearch', 'paywall redesign case studies', 384, 394, true)] }),
    ],
  }
  const s2 = {
    sid: 'demo-2', cwd: '/Users/alex/code/analytics-pipeline', title: 'Why did retention drop in week 46?', updatedAt: now, isAlive: true, people, ...hide('demo-2'),
    usage: { main: use('claude-opus-5', 88400, 2410700, 15320), am: use('claude-sonnet-5', 30210, 512900, 6140), dq: use('claude-sonnet-5', 7720, 90300, 1180) },
    root: run('__main__', { toolCount: 7, tools: [act('m1', 'Grep', '"retention"', 505, 507), act('m2', 'Agent', 'amara: Cohort breakdown', 520, 521)] }),
    runs: [
      run('am', { type: 'amara', description: 'Cohort breakdown by signup week and platform', startedAt: t(520), toolCount: 8,
        tools: [act('1', 'Read', 'queries/retention.sql', 523, 525), act('2', 'Bash', 'psql -f queries/retention.sql', 530, 552),
          act('3', 'Write', 'reports/week46.md', 560, 566)], active: [act('4', 'Bash', 'python cohort_plot.py', 578)] }),
      run('ex', { type: 'Explore', parentId: 'am', description: 'Find where the event schema changed', status: 'completed', startedAt: t(532), endedAt: t(558), toolCount: 6,
        tools: [act('1', 'Grep', '"session_start"', 534, 536), act('2', 'Read', 'events/schema.ts', 538, 540), act('3', 'Bash', 'git log -S session_start', 542, 556)] }),
      run('dq', { type: 'priya', description: 'Backfill the missing week-46 events', startedAt: t(540), toolCount: 3,
        tools: [act('1', 'Read', 'jobs/backfill.py', 543, 545), act('2', 'Bash', 'python backfill.py --dry-run --week 46', 548, 561)], ask: 'Bash: python backfill.py --week 46' }),
    ],
  }
  const s3 = {
    sid: 'demo-3', cwd: '/Users/alex/code/marketing-site', title: 'Fix the flaky hero test', updatedAt: now, isAlive: true, people, ...hide('demo-3'),
    usage: { main: use('claude-opus-5', 20480, 301200, 4410), pw: use('claude-haiku-5-5', 5120, 40800, 880) },
    root: run('__main__', { toolCount: 5, tools: [act('m1', 'Read', 'tests/hero.spec.ts', 540, 542), act('m2', 'Edit', 'tests/hero.spec.ts', 560, 564)], active: [act('m3', 'Bash', 'pnpm test --repeat 20', 570)] }),
    runs: [
      run('pw', { type: 'general-purpose', description: 'Run the e2e suite 50 times to catch the flake', startedAt: t(200), toolCount: 2,
        tools: [act('1', 'Read', 'playwright.config.ts', 203, 205)], active: [act('2', 'Bash', 'pnpm playwright test --repeat-each 50', 210)] }),
    ],
  }
  return [s1, s2, s3]
}

// A conversation for the chat panel, shaped like GET /api/chat.
export function demoChat(now, sid, run, after) {
  const s = demoSessions(now).find(x => x.sid === sid)
  const r = s && (run === 'main' ? s.root : s.runs.find(x => x.id === run))
  if (!r || run === 'ex') return { found: false, total: 0, items: [] }
  const items = []
  const say = (role, text, at) => items.push({ role, text, at })
  const tool = (a) => items.push({ role: 'tool', tool: a.tool, summary: a.summary, ...(a.isError ? { isError: true } : {}), at: a.startedAt })
  const calls = [...r.tools, ...r.active]
  if (run === 'main' && sid === 'demo-2') {
    // A long one, to show that only the last 200 items are kept.
    say('user', s.title + ' Pull the numbers and tell me what changed.', r.startedAt)
    const loop = [['Grep', '"retention"'], ['Read', 'queries/retention.sql'], ['Bash', 'psql -c "select count(*) from events"'], ['Read', 'events/schema.ts']]
    for (let k = 0; k < 236; k++) {
      if (k % 12 === 0) say('assistant', `Checked batch ${k / 12 + 1} of the week-46 events. Nothing unusual yet.`, r.startedAt + k * 1000)
      else { const [tl, sm] = loop[k % loop.length]; tool({ tool: tl, summary: sm, startedAt: r.startedAt + k * 1000 }) }
    }
  } else if (run === 'main') {
    say('user', `${s.title}. Start with the roadmap, then split the work.`, r.startedAt)
    say('assistant', 'I will read the roadmap first and then hand the spec and the code lanes to the team.', r.startedAt)
    for (const a of calls) tool(a)
    say('assistant', 'The spec and the code lanes are running. Current status:\n\n```\nspec      in progress\nios       building\nbackend   waiting for approval\n```\nI will report back when the lanes finish.', now)
    const tail = ['Kenji fixed the first build error; rebuilding.', 'Lena has the regression plan drafted.', 'Priya is waiting for your approval to run the migration.', 'Sofia closed ENG-212.']
    const k = Math.min(tail.length, Math.floor((Date.now() - now) / 7000))
    for (let j = 0; j < k; j++) say('assistant', tail[j], now + (j + 1) * 7000)
  } else {
    say('user', `${r.description}.\n\nWork in this repository only, keep the change small, and report what you changed and how you checked it.`, r.startedAt)
    say('assistant', 'Starting with the files that already cover this.', r.startedAt)
    calls.forEach((a, j) => { tool(a); if (j === 1) say('assistant', 'I have the context I need. Making the change now.', a.endedAt ?? a.startedAt) })
    if (r.ask) say('assistant', `Next I need to run \`${r.ask.replace(/^Bash: /, '')}\`, which is waiting for approval.`, now)
    if (r.status === 'completed') say('assistant', 'Done. Bundle size went from 2.41 MB to 2.36 MB (-2%).\n\n```\nbefore  2.41 MB\nafter   2.36 MB\n```', r.endedAt)
    if (r.status === 'failed') say('assistant', 'I could not finish: the web search failed twice, so there are no case studies to cite yet.', r.endedAt)
  }
  const all = items.map((it, i) => ({ i, ...it }))
  const out = after === undefined ? all.slice(-200) : all.filter(it => it.i > after).slice(0, 200)
  return { found: true, total: all.length, items: out }
}
