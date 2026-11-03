---
files:
  - plugin/bin/lib/flow/pr-early-open.js
  - plugin/bin/pr-checklist.js
  - plugin/skills/_shared/pr-early-run-lifecycle.md
---

# Resume a Run on a PR an Earlier Run Opened

**Persona:** Maintainer of a `pr-first` claude-tweaks repo whose overnight dispatch fleet re-runs a record on a branch whose draft PR is still OPEN. That is the #3903 shape: run `2026-10-30T063836-record-3903` reused PR #4541, which an earlier run had opened. Every phase-exit checklist update was then refused with "run marker mismatch" until someone rewrote the PR body by hand.
**Goal:** The resumed run takes over the still-open PR without anyone touching it. Its body names the new run, and the phase checklist ticks at every phase exit.
**Entry point:** `/claude-tweaks:flow #{n}` (directly, or through a dispatch firing) starts on a branch whose draft PR is OPEN and whose body's first line is `<!-- claude-tweaks-run: {earlier-run-id} -->`. The PR is found either by head branch, or as the PR `run-state.json` recorded.
**Success state:** The new run's `decisions.md` carries `reusing open PR #{pr} for {branch}`, then `rebound reused PR #{pr} to run {run-id}`, before the first push. The build phase exit's `bin/pr-checklist.js --phase build` reports `action: written`. The maintainer should feel the PR simply belongs to whichever run is working on it.

## Steps

### 1. Run start finds the open PR and rebinds its body — `_shared/pr-early-run-lifecycle.md` Step 1, `bin/pr-early-open.js`
- **URL:** `https://github.com/{owner}/{repo}/pull/{pr}`
- **Action:** `pr-early-open.js` lists PRs for the branch, with `body` in the `--json` fields, and finds the OPEN one. It logs `reusing open PR #{pr} for {branch}`. Because the body's first line names another run, even after pr-checklist's own marker repair, it composes this run's body and writes it with `gh pr edit {pr} --body-file`. It logs `rebound reused PR #{pr} to run {run-id}`, records the PR, and pushes.
- **Should feel:** Silent and automatic, with no card and no prompt. It is one extra decision line in the log.
- **Should understand:** Only a body that names a different run is rewritten. A body that already names this run, or one with no run marker at all (pr-checklist adds this run's), is left untouched. The rewrite starts a fresh phase checklist for this run, as the reopened-PR rebind (#3887) does.
- **Red flags:** A `reusing open PR` line with no `rebound reused PR` line while the PR body still names the earlier run. A `gh pr edit` on a PR whose body already named this run.

### 2. A resumed run re-verifies its recorded PR — `_shared/pr-early-run-lifecycle.md` "Resume: reconcile a recorded PR"
- **URL:** `https://github.com/{owner}/{repo}/pull/{pr}`
- **Action:** When `run-state.json` already records the PR, `pr-early-open.js` views it, with `body` in the `--json` fields. If it is still OPEN and its body names another run, it rebinds the body the same way, then proceeds with no list call and no push.
- **Should feel:** The same as step 1. Resuming through the recorded PR or through the branch makes no difference.
- **Should understand:** The recorded-PR path never re-records or pushes; it only fixes the body.
- **Red flags:** A second PR opened for the same branch; a push from the recorded-PR path.

### 3. A failed rebind degrades instead of stopping — `bin/pr-early-open.js`
- **URL:** —
- **Action:** If `gh pr edit` fails (network, permissions, a rejected edit), the run logs `SKIP … rebind of reused PR #{pr} failed ({error}); phase-checklist updates will exit 4 until its body names run {run-id}` and continues with the PR still recorded.
- **Should feel:** Like a visible, named gap rather than a mystery: the log says exactly why the checklist will stay frozen.
- **Should understand:** The bookkeeping-stamps gate is unaffected, because the PR is recorded. Only the checklist waits on a body rewrite.
- **Red flags:** The run stopping on a failed rebind, or a failed rebind with no `SKIP` line.

### 4. Phase exits tick the checklist — `bin/pr-checklist.js`
- **URL:** `https://github.com/{owner}/{repo}/pull/{pr}`
- **Action:** At the build phase exit, `pr-checklist.js --run {run-dir} --phase build --fixes {n}` reads the rebound body. Its first line names this run, so the CLI flips the `build` row and reports `action: written`.
- **Should feel:** Ordinary, the same as on a PR this run opened itself.
- **Should understand:** Before #4580, this same call exited 4 (`refused on PR #{pr} — run marker mismatch (body names run {earlier-run-id}, expected {run-id})`) at every phase exit.
- **Red flags:** `PR checklist refresh: refused on PR #{pr} — run marker mismatch` in a run whose log shows a successful `rebound reused PR` line.

## Origin
- Created during build of #4580 (Rebind the run PR body when a resumed run reuses a still-open PR)
- Steps 1-4 built in this session
- Related: `retry-a-record-whose-first-attempt-left-a-branch-3887.md` (the CLOSED/reopen counterpart), `flip-a-pr-checklist-row-at-a-phase-exit-3263.md` (the checklist CLI), #3903 (the incident run)
