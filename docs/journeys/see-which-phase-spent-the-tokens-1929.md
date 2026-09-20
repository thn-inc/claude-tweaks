---
files:
  - plugin/bin/lib/timing/transcript.js
  - plugin/bin/lib/timing/derive.js
  - plugin/bin/phase-timing.js
  - plugin/skills/flow/summary-template.md
  - plugin/skills/wrap-up/summary-template.md
  - plugin/skills/flow/multispec-summary.md
  - plugin/skills/wrap-up/verification-brief.md
  - plugin/skills/dispatch/SKILL.md
  - tests/timing-prose-conformance.test.js
---

# See Which Phase Spent the Tokens, Not Just the Minutes

**Persona:** the maintainer deciding which of the four filed guard false-positive records deserves attention first, and which pipeline phase is burning context — an internal tooling user reading the Timing table after a run; and the agent session rendering that table, which must not invent the numbers.
**Goal:** put a second axis beside every phase's minutes — tokens in/out, procedure bytes loaded, tool round-trips — from the session transcript's own `usage` records, plus a per-run count of guard denials, with every missing input stated as a note rather than a blank guess.
**Entry point:** a run directory with `events.jsonl` (and `run-state.json` naming the worktree and session id), and the session transcript Claude Code writes under `~/.claude/projects/`.
**Success state:** the Timing table reads `| Phase | Minutes | Verify | Tokens (in/out) | Proc. KB | Tool RTs |` with a `Guard denials: … gate · … wd-ambiguous · … wd-deny` footer, `timing.json` carries `totals.tokens`, `totals.procedureBytes`, `totals.toolRoundTrips`, `totals.guard`, and `transcripts[]`, and a run whose transcript cannot be found prints `tokens: transcript not found (…)` above a table with blank token columns.

## Steps

### 1. Let the summary find its own transcript
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --markdown --auto-transcript`
- **Action:** Render the Timing section exactly as the flow, wrap-up, and multi-spec summary templates now say — the flag is part of the pasted command.
- **Should feel:** The same table as before with three more columns and a footer; nothing to configure.
- **Should understand:** The locator reads only the run's own `run-state.json` — its worktree becomes the transcript directory's slug (every character outside letters, digits, and hyphens becomes a hyphen, so a worktree cwd yields `--claude`), and its session id names the file. It never looks in another session's directory or another user's home.
- **Red flags:** `tokens: transcript not found (no worktree or sessionId in run-state.json)` — the run was never stamped; the minutes are still right, the token columns are honestly blank.

### 2. Pass dispatch's two transcripts explicitly
- **URL:** `… --transcript <call-1 transcript> --transcript <call-2 transcript>`
- **Action:** The dispatch orchestrator, which holds both Task-call transcript paths, passes them itself; `--auto-transcript` never discovers them.
- **Should feel:** One timing line per group ends with `· {k} tokens in / {m} out`; the two transcripts are summed.
- **Should understand:** Each Task call has its own agent transcript; nested subagents inside it are already folded into that file by the harness.
- **Red flags:** A token clause on a group whose transcripts were not passed — the CLI printed a not-found note and the line should have omitted the clause.

### 3. Read the columns
- **URL:** `{run-dir}/timing.json`
- **Action:** Compare `tokens.input` against `minutes` per phase.
- **Should feel:** The wrap-up tail is minutes with few tokens (model latency over small tool results); plan and review are tokens with few minutes (procedure loading). The two axes disagree, which is the point.
- **Should understand:** `Proc. KB` counts bytes returned by `Read`s of skill files — the repo's `plugin/skills/**` and the installed plugin's `skills/` directory — attributed to the phase in which the result arrived. A row joins the innermost phase containing its timestamp, so a container's tokens are only what happened in its own gaps. `unattributed` collects rows before the first phase starts.
- **Red flags:** `Proc. KB` reading `0.0` on a phase you watched load a dozen skill files — the `Read` paths were not under a skills directory the rule recognizes.

### 4. Prioritize the guard records by cost
- **URL:** the `Guard denials:` footer, or `totals.guard` in `timing.json`
- **Action:** Read the three counts after a run that tripped the worktree or gate guards.
- **Should feel:** A number per guard type, not an anecdote.
- **Should understand:** Each `gate-denial`, `wd-ambiguous`, or `wd-deny` event is a wasted turn the run already paid for; the counts are reported, never used to gate anything.
- **Red flags:** Zeros on a run whose `events.jsonl` clearly holds guard events — the counter reads the same file the table does, so check that `--run` points at the right directory.
