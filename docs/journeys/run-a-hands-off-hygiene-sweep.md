---
files:
  - plugin/skills/sweep/SKILL.md
  - plugin/skills/tidy/SKILL.md
  - plugin/skills/specify/SKILL.md
  - plugin/skills/backlog/refine-headless.md
---

# Run a Hands-Off Hygiene Sweep

**Persona:** A claude-tweaks maintainer who wants the whole backlog hygiene chain — tidy, shape, grant — run in one command before a dispatch session, without answering anything.
**Goal:** Run `/claude-tweaks:sweep` once and get a tidied, shaped, and (where authorized) granted queue, ending on the attention report and a paste-ready `/claude-tweaks:dispatch` line.
**Entry point:** A terminal at the project checkout; type `/claude-tweaks:sweep` (optionally `--budget <n|all>` and/or `--scope <name>[,<name>...]`).
**Success state:** Tidy, specify's bare drain, and backlog refine's headless posture all ran under one shared run directory and one `decisions.md`; the run closes with `/claude-tweaks:backlog attention`'s own rendered report and a `## Next Actions` block recommending `/claude-tweaks:tidy --approve` (when Step 2's tidy pass staged anything this run — the cheapest, zero-judgment item leads), or otherwise `/claude-tweaks:dispatch` (or a needs-you launcher, if one is pending).

## Steps

### 1. Invoke sweep — terminal
- **URL:** `/claude-tweaks:sweep` (or `/claude-tweaks:sweep --budget 10 --scope github`)
- **Action:** Run the bare command, or pass `--budget` (forwarded verbatim to Step 2's specify drain) and/or `--scope` (normalized to tidy's own `--scope=` grammar for Step 1). No mode keyword, no record reference — sweep always runs hands-off and whole-queue.
- **Should feel:** Like pressing one button for everything that doesn't need a human — no questions asked between here and the closing report.
- **Should understand:** Sweep resolves one standalone run directory (`{ISO}-sweep-standalone/`) and invalidates the session's record snapshot before Step 1 runs, so a record another actor wrote earlier this session isn't read stale.
- **Red flags:** An `AskUserQuestion` firing mid-sweep; a mode keyword or record reference being accepted instead of rejected as an error.

### 2. Tidy runs first, under the shared run dir
- **Action:** `/claude-tweaks:tidy --source sweep` runs in forced auto mode: findings route per the resolved `tidy-aggressiveness` tier, applied/staged counts log to the shared `decisions.md`, and tidy's own `## Next Actions`/confirm question are suppressed — tidy reports counts back to sweep instead of rendering its own report.
- **Should feel:** Invisible plumbing — nothing renders here except sweep's own eventual summary.
- **Should understand:** Anything tidy stages (rather than auto-applies) waits in this run's `staged/` for a later `/claude-tweaks:tidy --approve` — sweep never approves on its own.
- **Red flags:** Tidy's own confirm-gate question appearing; a separate tidy report rendering mid-sweep.

### 3. Specify drains the queue next
- **Action:** `/claude-tweaks:specify --source sweep` runs bare-drain headlessly (no suggestion menu), honoring `--budget` if one was passed, else specify's own `specify-budget` policy default. The session's record snapshot is invalidated again first, so specify sees tidy's mutations.
- **Should feel:** The same silent handoff as Step 2 — counts accumulate, nothing renders yet.
- **Should understand:** Under `work-backend: local-files` this step (and Step 4's grant sub-stage) preflight-stops as a no-op — headless shaping is `github-issues`-only; sweep still ran tidy and still renders the close-out.
- **Red flags:** A shaping suggestion menu appearing; specify reading a stale pre-tidy snapshot.

### 4. Backlog refine grants headlessly
- **Action:** `/claude-tweaks:backlog refine --source sweep` runs the headless posture (`refine-headless.md`) — labeling lanes plus the grant chain, zero clicks. The record snapshot is invalidated once more first.
- **Should feel:** The one step that can actually change what's authorized to build — and still runs with nobody watching.
- **Should understand:** This is the one call in the whole codebase that a headless caller may legally make **because** sweep itself never claims, builds, or merges anything — that boundary is what makes sweep a legal parent of a grant-writing unit, and `tests/sweep-orchestrator.test.js` pins the statement of that boundary in the skill.
- **Red flags:** Sweep invoking `/claude-tweaks:dispatch`, `/claude-tweaks:flow`, or `/claude-tweaks:build` anywhere in its own steps — its legality rests on never doing so.

### 5. Read the close-out — terminal
- **URL:** same session, sweep's final rendered reply
- **Action:** Read `/claude-tweaks:backlog attention`'s own rendered report (invoked directly as sweep's close-out, not restated), then the `## Next Actions` block beneath it.
- **Should understand:** When Step 2's tidy pass staged anything this run, `/claude-tweaks:tidy --approve` leads the block (bolded, recommended) ahead of `/claude-tweaks:dispatch` and any needs-you launcher — clearing an already-vetted, zero-judgment batch is cheaper than either heavier pick. When nothing was staged, the block falls back to the original order (`/claude-tweaks:dispatch`, or a needs-you launcher, leading).
