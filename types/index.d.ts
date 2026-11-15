/** A named agent definition found under an `agents/` folder. */
export type Persona = {
  slug: string
  name: string
  role: string
  /** Optional team/department; colors the avatar. */
  group: string
}

/** One tool call; still in flight while `endedAt` is absent. */
export type Act = {
  id: string
  /** Tool name as the engine gives it; MCP tools as `server:tool`. */
  tool: string
  summary: string
  startedAt: number
  endedAt?: number
  isError?: boolean
}

/** One loop: the main session or a subagent. */
export type Run = {
  id: string
  type: string
  description: string
  status: string
  startedAt: number
  parentId?: string
  endedAt?: number
  active: Act[]
  /** Finished calls, newest last (capped). */
  tools: Act[]
  toolCount: number
  /** A call held for the person's approval, e.g. "Bash: git push". */
  ask?: string
}

export type Meta = { sid: string; cwd: string; home: string; title: string; lang: string }

declare module 'claude-code' {
  interface PluginState {
    'agent-radar': {
      roster: Shaped<Persona[]>
      runs: Shaped<Run[]>
      main: Shaped<Run>
      meta: Shaped<Meta>
      open: Shaped<string>
      showDone: Shaped<boolean>
    }
  }
}
