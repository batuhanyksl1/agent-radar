# LinkedIn post kit

## Before posting

Screenshots use sample data with made-up
names; none of it is from a real project.

## Images, in this order

1. `docs/screenshots/overview.png`: the hero. Three sessions on one screen.
2. `docs/screenshots/history.png`: a card opened to an agent's tool history.
3. `docs/screenshots/pane.png`: the pane inside Claude Code.
4. `docs/screenshots/japanese.png`: the same screen in Japanese.

LinkedIn crops tall images in the feed; image 1 is the one that has to work
alone. A 20–30 second screen recording of the `?demo` page would do better than
stills if you have time to make one.

---

## Post (main version)

My AI agents started managing other AI agents. Then I lost track of all of them.

That is not a joke. With Claude Code I run a main session that hands work to a "tech lead" agent, which hands it to an iOS engineer, a backend engineer and a QA lead, one of whom hands part of it to a docs writer. Three levels deep, several sessions open at once.

It works. But when it is running, the transcript tells you almost nothing:

→ Who is actually working right now?
→ Who has been "waiting" for four minutes, and on what?
→ Which agent is stuck on a permission prompt I never saw?
→ Where did the last ten minutes go?

So I built Agent Radar: a live view of every agent in every open Claude Code session.

What it shows:

🌳 The handoff tree. Every agent is a card, sitting under the agent that gave it the work.
⚡ What each one is doing this second: "Bash: xcodebuild build · 51s".
⏳ What each one is waiting on: "Waiting on Kenji, Priya, Lena" or "Needs your approval: pnpm db:migrate".
📊 A timeline of every tool call, so you can see the failed build that ate a minute.
🖥️ All open sessions on one page. I keep it on my second monitor.
🌍 14 languages.

Two things surprised me while building it.

First, the most useful line on the screen is not "running". It is the reason an agent is NOT running. Half of my "why is this slow" moments turned out to be an agent quietly waiting for me.

Second, I built the whole thing inside one Claude Code session, with Claude Code. The tool that watches the agents was written by the agents.

It is a Claude Code plugin plus a tiny local web page. Everything stays on your machine: the server listens on localhost only and sends nothing anywhere.

It is open source (MIT). Fork it, break it, make it better:
https://github.com/batuhanyksl1/agent-radar

One honest caveat: it is built on Claude Code's plugin hooks API, which is still in early access, so it needs a build that supports it.

If you run multi-agent setups: what do you wish you could see while they work?

#ClaudeCode #AIAgents #DeveloperTools #OpenSource #AgenticAI

---

## Post (short version)

Running Claude Code with agents that delegate to other agents is great, until you ask "what is everyone doing right now?" and the transcript has no answer.

I built Agent Radar to answer it:

🌳 Who handed work to whom, as a tree
⚡ What each agent is doing this second
⏳ What each one is waiting on (often: me)
📊 Every tool call on a timeline
🖥️ All open sessions on one live page

Local only, open source, 14 languages. Built inside a single Claude Code session, with Claude Code.

https://github.com/batuhanyksl1/agent-radar

#ClaudeCode #AIAgents #OpenSource

---

## First comment (post it yourself right after)

How it works, for the curious: the plugin listens to three events (an agent being spawned, a tool call starting and ending, a call held for approval), keeps a small state per session, and draws it twice: as an SVG pane inside Claude Code and as a local web page that reads a JSON file per session. No database, no dependencies, no network calls. The README has the details and a `?demo` mode if you want to look before installing.

---

## Notes on the claims in the post

Everything stated is true of the project as it stands. Check these against your
own situation before posting:

- "I keep it on my second monitor": keep it only if you do.
- "Half of my 'why is this slow' moments": a personal observation, not a
  measurement. Reword if it does not match your experience.
- "built the whole thing inside one Claude Code session": true of the first
  version (plugin, pane, web page, translations, this kit).
- The early-access caveat matters: people on a build without hooks modules
  will install it and see nothing. Keeping that line avoids disappointed
  comments.
- The post does not say when Claude Code gained nested agents or multi-session
  features, because I could not verify a date or wording for that. If you want
  that framing, add it in your own words.
