---
files:
  - plugin/bin/hooks.js
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/reconcile/escalate-residue.js
  - plugin/skills/_shared/pr-first-merge-post-merge.md
  - plugin/skills/wrap-up/auto-merge-short-circuit.md
  - plugin/skills/wrap-up/cleanup-procedures-execution.md
---

# Learn That a Merged Run Still Needs You

**Persona:** A claude-tweaks maintainer who granted `auto:merge`, let a fast-lane `pr-first` run merge itself unattended, and next morning reads the closing report and `decisions.md` to decide whether anything is left to do. This is the #3130 shape: the PR merged, no review console was ever rendered, and `staged/reflect-1.md` and `staged/wrap-up-skill-1.md` sat unapproved.
**Goal:** Tell from the run's own report whether cleanup will finish by itself or whether staged proposals are waiting on a human, without opening `.claude-tweaks/pipelines/` by hand.
**Entry point:** `_shared/pr-first-merge-post-merge.md` Step 4.2's `node bin/hooks.js reconcile --checks mirror,release,archive`, run right after the fast-lane auto-merge short-circuit merges the PR.
**Success state:** A run whose `staged/` still holds pending items is reported as `merged` with a "needs human action" note, never as cleanup that converges at the next trigger point. Reconcile keeps the run dir in place, and a run left untouched eventually surfaces in the consolidated `structurally-stuck` record. Wrap-up's own `archive-run` refuses to archive an auto-merge short-circuit run with pending items too, naming each pending path.

## Steps

### 1. Reconcile names why it kept the run
- **Action:** `archiveMerged` finds the run's PR MERGED, no `console.json`, and a non-dotfile under `staged/` or any `spec-{N}/staged/`. It skips with `console-never-rendered-staged-pending`, never plain `console-never-rendered` (which now means only that staged state was not known). The summary line reads `skipped: 1 run dir (console-never-rendered-staged-pending 1)`.
- **Should feel:** Specific. The reason says what is waiting (staged items) and why nothing else will clear it (no console was rendered).
- **Should understand:** An empty or absent `staged/` still archives on #3249's fast path. An unreadable `staged` entry counts as pending, failing toward keeping the run.
- **Red flags:** A pending-staged MERGED run reported as plain `console-never-rendered`, or archived at all.

### 2. Step 4.2 decides about this run from the run itself
- **Action:** The merging agent checks its own `$PIPELINE_RUN_DIR`: `console.json` absent and a non-dotfile under `staged/` or `spec-*/staged/`, where an unreadable `staged/` counts as pending to match reconcile's fail-closed read. If so, it logs `AUTO {time} — pr-first-merge Step 4.2: this run is console-never-rendered-staged-pending — needs human action …` and carries "needs human action" into the closing report. If its own check is clean but the summary still names the reason, it reports "{N} other run dir(s) need human action" without claiming it for itself.
- **Should feel:** Trustworthy. The report talks about this run only when this run is the stuck one, and an old stuck run elsewhere in the repo never gets pinned on today's merge.
- **Should understand:** The outcome is still `merged`; the note is extra. A transient gh/network failure is still logged as "left for the next trigger point", because that case does converge.
- **Red flags:** "left for the next trigger point" printed for a run with pending staged items; "needs human action" attributed to this run when its own `staged/` is empty.

### 3. A forgotten run escalates where a human looks
- **Action:** `console-never-rendered-staged-pending` is in `STRUCTURALLY_STUCK_REASONS`. Once the run dir sits untouched past the 7-day `STRUCTURALLY_STUCK_TTL_MS` and stays stuck for `RESIDUE_ESCALATE_THRESHOLD` consecutive passes, `trackStuckSkip` adds its path to the consolidated `structurally-stuck` record. That record names the remedy: apply or delete the files under `staged/` (and any `spec-*/staged/`), or write a resolved `console.json`, and the next reconcile archives the dir and drops it from the record.
- **Should feel:** Bounded. A run you forgot about can't sit unnoticed forever, and a run merged an hour ago doesn't page anyone.
- **Should understand:** A closed run escalates the same way: since #3668 the clean-status sweep tracks this reason too, but only for a run whose `decisions.md` carries the auto-merge short-circuit's own line (`Fast-lane`/`Manifesto-authorized auto-merge: issue #N, assess-agent-autonomy verdict auto-merge`) and no `Review Console: terminal decision` — a closed run that kept `staged/` after an in-terminal console stays untracked. The fast-lane short-circuit deliberately writes no `console.json`, because a PushNotification FYI is not an approval (`auto-merge-short-circuit.md`'s "Why no console.json" note).
- **Red flags:** A freshly merged, still-live run counted toward `structurally-stuck`; a stuck-record body with no remedy for this reason.

### 4. Wrap-up cleanup refuses to archive the pending proposals away
- **Action:** Wrap-up's cleanup (Section B) runs `close-run` then `node bin/hooks.js archive-run --run "$RUN_DIR"`. The verb finds no `console.json`, the short-circuit's own line in `decisions.md`, and pending items, and prints `claude-tweaks: archival refused — console-never-rendered-staged-pending (the auto-merge short-circuit rendered no console; pending: staged/reflect-1.md, staged/wrap-up-skill-1.md) — apply or delete …`. The run dir stays in `pipelines/`, and the agent carries the refusal into the closing report as needs-human-action rather than retrying.
- **Should feel:** Protective. The proposals the merge never showed you are named by path, not moved into `archive/` where nobody looks.
- **Should understand:** Only runs whose console the short-circuit replaced are refused. A terminal run that kept `staged/` files after an in-terminal console, a fleet-approved close proposal, or a `tidy --approve` run still archives as before. A `.DS_Store`-only `staged/` counts as nothing pending.
- **Red flags:** A short-circuit run with pending items archived (the #3130 shape); an ordinary resolved run refused; a refusal that names no paths.

## Origin
- Created during build of #3297 (post-merge reconcile reports a console-never-rendered run with pending staged items as converging later)
- Steps 1-3 built in this session
- Updated during build of #3668: step 3's closed-run escalation, step 4 (archive-run refusal) added
- Related journeys: `keep-a-live-run-whose-reused-branch-backed-a-merged-pr-3416.md` (the same archive path's staged-items check), `recover-a-run-stranded-by-a-stale-pr-number-3543.md` (the other escalated skip reason), `trust-a-singleton-auto-merge-to-refuse-without-a-verdict-2941.md` (the fast-lane merge that leads here)
