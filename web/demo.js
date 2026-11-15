// Sample sessions for `?demo`: screenshots and a first look without a running
// session. Times are relative to now, so in-flight calls keep ticking.
export function demoSessions(now) {
  const t = s => now - (600 - s) * 1000
  const act = (id, tool, summary, s, e, isError) => ({
    id, tool, summary, startedAt: t(s), ...(e ? { endedAt: t(e) } : {}), ...(isError ? { isError } : {}),
  })
  const run = (id, o) => ({ id, type: id, description: '', status: 'running', startedAt: t(0), active: [], tools: [], toolCount: 0, ...o })
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
    sid: 'demo-1', cwd: '/Users/alex/code/checkout-app', title: 'Ship the paywall redesign', updatedAt: now, isAlive: true, people,
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
    sid: 'demo-2', cwd: '/Users/alex/code/analytics-pipeline', title: 'Why did retention drop in week 46?', updatedAt: now, isAlive: true, people,
    root: run('__main__', { toolCount: 7, tools: [act('m1', 'Grep', '"retention"', 505, 507), act('m2', 'Agent', 'amara: Cohort breakdown', 520, 521)] }),
    runs: [
      run('am', { type: 'amara', description: 'Cohort breakdown by signup week and platform', startedAt: t(520), toolCount: 8,
        tools: [act('1', 'Read', 'queries/retention.sql', 523, 525), act('2', 'Bash', 'psql -f queries/retention.sql', 530, 552),
          act('3', 'Write', 'reports/week46.md', 560, 566)], active: [act('4', 'Bash', 'python cohort_plot.py', 578)] }),
      run('ex', { type: 'Explore', parentId: 'am', description: 'Find where the event schema changed', status: 'completed', startedAt: t(532), endedAt: t(558), toolCount: 6,
        tools: [act('1', 'Grep', '"session_start"', 534, 536), act('2', 'Read', 'events/schema.ts', 538, 540), act('3', 'Bash', 'git log -S session_start', 542, 556)] }),
    ],
  }
  const s3 = {
    sid: 'demo-3', cwd: '/Users/alex/code/marketing-site', title: 'Fix the flaky hero test', updatedAt: now, isAlive: true, people,
    root: run('__main__', { toolCount: 5, tools: [act('m1', 'Read', 'tests/hero.spec.ts', 540, 542), act('m2', 'Edit', 'tests/hero.spec.ts', 560, 564)], active: [act('m3', 'Bash', 'pnpm test --repeat 20', 570)] }),
    runs: [],
  }
  return [s1, s2, s3]
}
