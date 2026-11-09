---
files:
  - plugin/bin/lib/hooks/harness-refusal.js
  - plugin/bin/lib/hooks/post-tool-use-failure.js
  - plugin/bin/lib/hooks/bash-prefilter.js
  - plugin/bin/friction-events.js
  - plugin/skills/reflect/full-mode.md
---

# Count Dispatched Agents' Isolation Refusals

**Persona:** the claude-tweaks maintainer. They run a `/claude-tweaks:flow` pipeline whose steps dispatch subagents. Some of those agents share the session's worktree; others get their own `isolation: "worktree"` copy. Afterwards they read the run's reflection at `/claude-tweaks:wrap-up` to decide whether a dispatch prompt needs fixing.
**Goal:** the reflect Friction Lens counts every Claude Code worktree-isolation Bash refusal the run paid for. That includes refusals hit by agents in their own isolation worktrees and refusals hit after an isolation worktree vanished. It also tells the maintainer's own refusals apart from dispatched agents'.
**Entry point:** a dispatched agent runs a Bash command the harness guard refuses, for example `d=.; sed -n 1,2p $d/README.md`. Inside its own isolation worktree it sees "This agent is isolated in the worktree … Refusing to run it — a worktree-isolated agent's git operations must target its own worktree."
**Success state:** the wrap-up reflection reports the refusals split by `actor`: N from the session, M from dispatched agents. Any `variant: worktree-gone` refusal is named on its own line. The maintainer can trace a burst of agent refusals back to the dispatch prompt that caused them, as #3480's lens-agent refusals led to #3675's prompt fix.

## Steps

### 1. An agent hits the guard: inside its isolation worktree
- **URL:** the agent's refused Bash tool call
- **Action:** the dispatched agent runs a command the guard can't verify. The guard refuses it with the `This agent …` noun, because the worktree is the agent's own rather than the session's. The parent session's `PostToolUseFailure` hook fires with the full refusal text and the agent's `agent_id`; this was measured on Claude Code 2.1.302 on 2026-10-28.
- **Should feel:** the same friction as before for the agent: an identical refusal and retry path. The hook only observes.
- **Should understand:** `post-tool-use-failure.js` classifies the text through `harness-refusal.js`'s `classifyRefusal`. The noun gives `actor` (`session` or `agent`). The signature gives `variant`: `Refusing to run it` gives `guard`, and `Refusing to run there` gives `worktree-gone`. The event logged is `wd-guard-refusal` with `reason: harness-worktree-isolation` and both fields. The Bash prefilter now passes a failed call whose payload carries either signature.
- **Red flags:**
  - an agent refusal produces no `wd-guard-refusal` event at all (the pre-#3819 behavior);
  - a different-worktree refusal ending `Refusing to run it there` is logged as `worktree-gone`;
  - an Edit-tool refusal ("… so its writes are limited to that folder") is logged as a Bash refusal.

### 2. An isolation worktree disappears: mid-run
- **URL:** a Bash call from an agent whose working directory was removed
- **Action:** the guard refuses with the worktree-gone template: "… its working directory "…" no longer exists … Refusing to run there …". The hook logs it as `variant: worktree-gone`.
- **Should feel:** alarming in the right way. Lost isolation is a different failure from a command-shape refusal, and it should stand out rather than blend into the count.
- **Should understand:** the event lands where `resolveDenialRunDir` points. With a trusted owned run (a formal pipeline run bound to the session), it lands in that run. With none, the cwd is gone, so no ad-hoc dir can be keyed and the event goes to the fallback guess, which the Friction Lens's primary read drops.
- **Red flags:** a worktree-gone refusal in a formal pipeline run is missing from that run's `events.jsonl`.

### 3. Read the breakdown: wrap-up
- **URL:** `/claude-tweaks:wrap-up`, whose reflect Friction Lens runs `node plugin/bin/friction-events.js --run <run dir>`
- **Action:** the lens reports `harness-worktree-isolation` refusals split by `actor`, and names every `worktree-gone` event individually.
- **Should feel:** attributable. The maintainer knows at a glance whether the friction was their own or a dispatch prompt's.
- **Should understand:**
  - An event logged before #3819 carries no `actor`/`variant`. It counts as `session`/`guard`, which is all the old matcher could see.
  - The agent and worktree-gone counts are lower bounds. An agent's refusals from its own still-live isolation worktree go into an ad-hoc dir keyed to that worktree, which `friction-events.js` merges only once the worktree is removed. A worktree-gone refusal with no owned run is dropped, as step 2 describes.
  - One isolation refusal is not counted at all. Claude Code 2.1.302 also refuses with "The working-directory isolation context for this agent was lost, so this command would run in the parent session's directory instead of this agent's worktree (…). Refusing to run it." That text carries neither noun, so `classifyRefusal` returns null and no `wd-guard-refusal` event is logged. A lost-context refusal the maintainer remembers but the breakdown lacks is this known gap, not a broken hook.
- **Red flags:**
  - every refusal reads `actor: session` in a run that dispatched isolated agents which visibly hit the guard;
  - a `worktree-gone` event is folded into the total without being named.

## Origin
- Created during build of #3819 (count the subagent and worktree-gone isolation refusals)
- Steps 1-3 built in this session
- Related specs: #2783 (the post-tool-use-failure hook), #3304 (refusal text in one module plus drift pin), #3480 / #3675 (the lens-agent refusals and the dispatch-prompt fix this signal produced)
