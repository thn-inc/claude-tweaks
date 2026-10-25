---
files:
  - plugin/bin/hooks.js
  - plugin/bin/lib/reconcile/index.js
  - plugin/bin/lib/reconcile/cache.js
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/reconcile/origin-head.js
  - plugin/bin/lib/reconcile/residue-summary.js
  - plugin/bin/lib/reconcile/format-summary.js
  - plugin/bin/lib/hooks/session-start.js
  - docs/reconcile-checks.md
---

# Preview Reconcile and See Why an Escalation Failed

**Persona:** A maintainer of a `pr-first` repo who suspects reconcile is about to file or reopen a "structurally stuck" backlog issue for a run dir they are still cleaning up by hand. They want to see what a pass would do before letting one run, and to learn why an escalation or resolve that should already have happened left nothing behind.
**Goal:** Preview a reconcile pass with no side effects: no cache write, no GitHub write. Separately, read the recorded reason when an escalation or resolve failed, instead of guessing from a quiet pass.
**Entry point:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --dry-run --json`, run from any checkout or worktree of the repo.
**Success state:** The dry run returns a `residuePlan` naming each stuck path and what tracking would have done (`would-escalate`, `would-track`, `would-clear`, `would-resolve`). Afterwards `.claude-tweaks/reconcile-cache.json` is byte-identical and no issue was filed or touched. On a real pass, any failed escalate or resolve shows up with its reason in `residueErrors`, in the residue summary line and at the next session start.

## Steps

### 1. Preview the pass
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --dry-run --json`
- **Action:** Run the dry run and read `residuePlan`. Each entry is `{ action, reason, path, count? }`. For example, `would-escalate` with `count: 3` means the next real pass files or appends the consolidated structurally-stuck record for that path.
- **Should feel:** Safe to run repeatedly. Two consecutive dry runs give the same plan, because the first one did not advance any failure counter.
- **Should understand:**
  - Several things that used to write on a dry run now skip:
    - the cache stamp (`lastRunAt`)
    - the PR-state persist
    - the origin/HEAD repair (`originHeadRepair: { outcome: 'skipped', reason: 'dry-run' }`)
    - the declined-learning prune
    - reap's skip events
  - The shared `git fetch` is the one deliberate exception: it still refreshes remote-tracking refs so the preview reflects current origin state.
  - `release` still reports `dry-run-not-supported` in `skipped`.
- **Red flags:**
  - `reconcile-cache.json`'s mtime or bytes change after a dry run.
  - `residuePlan` is `null` on a dry run that ran archive. `null` means "not a dry run"; `[]` means "dry run, nothing to do".

### 2. Read the compact form
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --dry-run` (no `--json`)
- **Action:** Look for the `residue (dry run): would escalate {a}, would track {b}, would clear {c}` line. Zero counts are omitted; `would-resolve` counts toward `would clear`.
- **Should feel:** One glance answers "is this pass going to file anything?".
- **Should understand:** The line appears only when the plan is non-empty. No line on a dry run means nothing is stuck past its TTL.
- **Red flags:** The line shows `would escalate` for a dir you know is a live, in-flight run. That points at a staleness-gate problem, not at this preview.

### 3. Find why a real pass's escalation or resolve failed
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --json`, the `residueErrors` key
- **Action:** Read each `{ reason, path, op, error, at }`:
  - `op: 'escalate'` means filing, appending or reopening the backlog record failed.
  - `op: 'resolve'` means closing it, or removing the path from it, failed. Examples are an HTTP 502 or a rate limit.
  - `at: null` marks a failure from this pass's prune of a path that no longer exists. That entry is already dropped from the cache, so this JSON is its only record.
- **Should feel:** Diagnosable. A stuck resolve that retries every pass now names its reason instead of leaving an entry with nothing to show why.
- **Should understand:**
  - Tracked failures live on the cache entry as `lastResidueError` and survive later failing passes on the same path.
  - They disappear only when the entry itself is dropped: the path recovered or got archived, or a later resolve succeeded.
  - `residueErrors` is filled on every pass that resolved a repo root, over-budget passes included.
- **Red flags:**
  - `residueErrors` is `[]` while an issue you expected to close is still open with its path listed. Check whether the resolve ran at all.

### 4. See it without running anything
- **URL:** the residue summary line (`node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile-summary`, `/claude-tweaks:flow`'s closing report) and the next session's start-up context
- **Action:** Read the summary line's optional tail, `, {n} residue error(s) (last: {op} — {reason})`. After a background pass, read the SessionStart background-reconcile line: `{n} residue error(s) (last: {op} — {error})`.
- **Should feel:** The failure finds you. A failing background pass, whose stdio is ignored, still reaches you on the next session.
- **Should understand:**
  - The tail is omitted when nothing has failed, so a clean repo's summary line is unchanged.
  - The background status file carries a count and the latest error, not the full list. Run step 3 for the list.
- **Red flags:** The same error repeats session after session. The underlying `gh` problem (auth, rate limit, a deleted issue) needs a human. Escalation is one-shot, so a failed escalate is not retried on its own.

## Origin
- Created during build of #4180 (reconcile: make `--dry-run` write nothing, and record why an escalate or resolve failed).
- All steps were built in this session.
- Related records:
  - #2724 (first dry-run guard on the exempt clear)
  - #4202 (checkout-scoped gone-path predicate)
  - #4032 (reconcile timings; its dry-run PR-state persist is reversed here)
  - #644 (residue counter and one-shot escalation)
