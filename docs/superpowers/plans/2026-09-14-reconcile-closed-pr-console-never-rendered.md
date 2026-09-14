# Reconcile: distinct, tracked reason for a closed-unmerged PR's never-rendered console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix reconcile's `archiveMerged`'s by-number fallback (`bin/lib/reconcile/archive-merged.js`) so a run dir whose PR is confirmed `CLOSED` (never merged) and whose console was never rendered gets a distinct, escalation-tracked skip reason instead of silently freezing the escalation cache under the pre-existing `console-never-rendered` reason — then resolve the specific stuck directory this bug was filed against.

**Architecture:** The by-number fallback (added across #1962/#2226/#2228, ~archive-merged.js:1301-1327) reuses the general merged-PR path's `'console-never-rendered'` skip reason for a run whose PR is confirmed `CLOSED`. That reason is deliberately excluded from `STRUCTURALLY_STUCK_REASONS` (and from the `trackStuckSkip` call at line 1329) because — per the comment above that Set — it "already has its own clear resolution path (a human answering a console)". That assumption holds for an `OPEN` or freshly-`MERGED` PR (wrap-up will eventually render a console), but not for a `CLOSED` PR: nothing drives that run's pipeline to wrap-up anymore, so its console will never render. Splitting this into its own reason string (`console-never-rendered-pr-closed`), added to `STRUCTURALLY_STUCK_REASONS`, restores the existing 7-day-mtime + 3-strike escalation/visibility mechanism for this genuinely dead-ended state, without touching the MERGED sub-case (which keeps today's behavior — code landed there, so a console really may still be pending).

**Tech Stack:** Node.js (`node --test`), no external deps for this module.

**Spec:** `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-2231/.claude-tweaks/pipelines/2026-09-14T132657-record-2231/work/2231-spec.md` (GitHub record #2231)

## Global Constraints

- Preserve `archiveRunDir`'s moves-first, close-last ordering (spec Gotchas) — this plan does not modify `archiveRunDir` itself.
- Do not assume #2226's (MERGED-state gap) or #2228's (`stampedWorktree` gate) fixes apply here — this record's root cause is distinct (confirmed below).
- Match the surrounding code/comment style in `archive-merged.js` (heavy inline rationale comments, `#NNNN` issue references).

## Empirical findings (recorded here per AC1 and AC4 — not a task, context for every task below)

**AC1 — confirmed empirically, not assumed from the escalation cache:**

1. `.claude-tweaks/reconcile-cache.json`'s `residueFailures` entry for this dir reads exactly as the record describes: `{"count": 42, "lastError": "stuck at no-branch", "escalated": true}` (key `structurally-stuck:{main-checkout}/.claude-tweaks/pipelines/2026-08-26T155419-record-1413`).
2. A live `node bin/hooks.js reconcile --dry-run --json` run from the main checkout (2026-09-14) classifies this exact directory as: `{"runDir": ".../2026-08-26T155419-record-1413", "action": "skipped", "reason": "console-never-rendered"}` — **not** `no-branch`. The escalation cache's `lastError` is confirmed stale.
3. Code trace of `archive-merged.js`'s main loop (~line 1280 onward) explains why: `state.worktree` is stamped but no longer resolves to a live `git worktree list` entry, and `fallbackBranch` also returns nothing → `branch` is falsy → the `#1962` by-number fallback fires (`state.pr.number` = 1497 is present) → `resolvePrStateByNumber(root, 1497)` returns `{state: 'CLOSED', mergedAt: null, mergeCommit: null}` → since `state !== 'MERGED'`, the `localHasMerge` check is skipped → `readConsoleState(dir)` returns `'none'` (no `console.json`) → `skipped.push({reason: 'console-never-rendered'})`, `continue` — **this exits the loop iteration without ever calling `trackStuckSkip`** (that call, line ~1329, sits only on the fallthrough path reached when `byNumber.state` is neither `CLOSED` nor `MERGED`, or `state.pr.number` is absent).

**Root cause:** the by-number fallback's `CLOSED` branch has reclassified this directory to `'console-never-rendered'` on every recent pass, and that reason is (correctly, for the general MERGED case) excluded from `STRUCTURALLY_STUCK_REASONS`/`trackStuckSkip` — so the escalation cache simply stopped being touched for this directory once the `#1962`/`#2226`/`#2228` fallback started reaching it. `count: 42` / `lastError: "stuck at no-branch"` is a frozen snapshot from before that fallback existed (or before it started reliably reaching this dir), not a live read. This matches the record's own scenario (a).

**AC4 — secondary finding, recorded here and restated in Task 1's commit message:** the escalation cache's `lastError`/`count` fields are only ever refreshed on a `trackStuckSkip` call. Any skip reason excluded from `STRUCTURALLY_STUCK_REASONS` — by design, because it's supposed to have "its own clear resolution path" — silently stops updating a *pre-existing* cache entry for the same directory the moment the classification changes out from under it, rather than clearing or annotating that entry. A future triager reading only the cache (not re-deriving live state, as this investigation did) would misdiagnose this directory's actual current blocker. No code fix is prescribed for this general staleness pattern here (out of scope — it's a design tradeoff of the residue cache, not a bug in this specific reason), but it is worth a maintainer's attention if it recurs elsewhere.

**Gap confirmed (Deliverable 2, second bullet):** `console-never-rendered`'s exclusion rationale ("a human answering a console") does not hold for a `CLOSED` (never-merged) PR — no console will ever render because nothing drives that pipeline forward. This is the gap Task 1 fixes.

---

### Task 1: Distinct, tracked skip reason for a CLOSED PR's never-rendered console

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (the `STRUCTURALLY_STUCK_REASONS` Set at ~line 1030, and the by-number fallback's `consoleState === 'none'` branch at ~lines 1316-1319)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Consumes: `resolvePrStateByNumber(root, prNumber)` (existing, `pr-state.js`), `readConsoleState(runDir)` (existing, same file), `trackStuckSkip(root, repoSlug, dir, reason, opts)` (existing, same file) — no signature changes to any of these.
- Produces: a new skip reason string `'console-never-rendered-pr-closed'`, added as a member of the exported `STRUCTURALLY_STUCK_REASONS` Set. Later code (this repo's own `bin/lib/reconcile` consumers, and any external tooling reading `skipped[].reason`) sees this new value only when `archiveMerged` reaches the by-number fallback's `CLOSED` sub-case with no `console.json` present — every other `consoleState === 'none'` skip (the general merged-PR path via `decideArchive`, and the by-number fallback's `MERGED` sub-case) keeps emitting plain `'console-never-rendered'`, unchanged.

- [ ] **Step 1: Write the two failing tests**

Add to `tests/bin-lib/reconcile/archive-merged.test.js`, immediately after the existing `#2228` test block (after the test ending `archiveMerged: a run dir with no worktree stamp at all (never set) still reaches the #1962 by-number fallback and archives once its closed PR is confirmed`, i.e. right before whatever test currently follows it):

```javascript
// #2231: a run dir reaching the #1962 by-number fallback with a CLOSED
// (never-merged) PR and no console.json at all used to fall into the same
// 'console-never-rendered' bucket the general MERGED-PR path uses — a
// reason deliberately excluded from STRUCTURALLY_STUCK_REASONS because it
// "already has its own clear resolution path" (a human eventually answers
// a rendered console). That assumption is false for a CLOSED PR: nothing
// drives this run's pipeline to wrap-up anymore, so no console will ever
// render. The fallback now uses a distinct, tracked reason for exactly
// this sub-case, so it escalates like no-branch/no-worktree/no-pr instead
// of silently freezing the escalation cache.
test('archiveMerged: a CLOSED (never-merged) PR reached via the by-number fallback with no console.json gets the distinct console-never-rendered-pr-closed reason and is tracked toward escalation', () => {
  const root = fs.realpathSync(makeRepo());
  const runId = '2026-08-01T090000-record-2231-closedpr-noconsole';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', 'gone-record-2231'), // stamped, but never created here
    pr: { number: 2231001 }, // no branch field — mirrors #1413's own run-state.json shape
  }));
  // Deliberately no console.json — this is the "never rendered" case.
  const stuckBackdated = new Date(Date.now() - STRUCTURALLY_STUCK_TTL_MS * 2);
  fs.utimesSync(runDir, stuckBackdated, stuckBackdated);

  const wrapper = installGhWrapper({ number: 2231001, state: 'CLOSED', mergedAt: null, updatedAt: '2026-08-01T00:00:00Z', mergeCommit: null });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(!result.archived.includes(runDir));
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'console-never-rendered-pr-closed');
  assert.equal(fs.existsSync(runDir), true);

  // Tracked toward escalation (unlike plain 'console-never-rendered') —
  // this dir's mtime was backdated past the TTL above, so one pass is
  // enough to start the residue counter.
  const failures = listResidueFailures(root);
  assert.ok(
    failures.some((f) => f.reason === 'structurally-stuck' && f.path === runDir),
    `expected ${runDir} to start accumulating a structurally-stuck residue count, got ${JSON.stringify(failures)}`,
  );
});

// Companion case: the MERGED sub-case of the same fallback branch must
// keep emitting plain 'console-never-rendered' and must NOT be tracked —
// code landed there, so a console may genuinely still be pending; only the
// CLOSED sub-case changes in this fix.
test('archiveMerged: a MERGED PR reached via the by-number fallback with no console.json still uses plain console-never-rendered and is never tracked', () => {
  const { root, featureSha } = mergedFeatureBranchRepo('feat-2231-merged-noconsole');
  git(root, 'branch', '-D', 'feat-2231-merged-noconsole'); // branch ref gone too — nothing for fallbackBranch to recover
  const runId = '2026-08-01T090000-record-2231-mergedpr-noconsole';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', 'gone-record-2231-merged'),
    pr: { number: 2231002, branch: 'feat-2231-merged-noconsole' },
  }));
  // Deliberately no console.json.
  const stuckBackdated = new Date(Date.now() - STRUCTURALLY_STUCK_TTL_MS * 2);
  fs.utimesSync(runDir, stuckBackdated, stuckBackdated);

  const wrapper = installGhWrapper({
    number: 2231002, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    mergeCommit: { oid: featureSha },
  });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(!result.archived.includes(runDir));
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'console-never-rendered');

  const failures = listResidueFailures(root);
  assert.ok(
    !failures.some((f) => f.reason === 'structurally-stuck' && f.path === runDir),
    `a MERGED PR's never-rendered console must not be tracked toward escalation, got ${JSON.stringify(failures)}`,
  );
});
```

`installGhWrapper` and `mergedFeatureBranchRepo` are existing helpers already used by the neighboring `#1962`/`#2226` tests in this file — no new imports needed (`STRUCTURALLY_STUCK_TTL_MS` and `listResidueFailures` are already imported at the top of this file).

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: both new tests FAIL — the first on `assert.equal(skip.reason, 'console-never-rendered-pr-closed')` (actual value is `'console-never-rendered'`, since the reason string doesn't exist yet) and on the residue-tracking assertion (nothing tracks it today); the second test should already PASS as written (it pins today's actual behavior) — if it doesn't, stop and re-examine the fixture before proceeding, since Step 2's job is confirming the *first* test's premise, not introducing a second failure.

- [ ] **Step 3: Implement the fix**

In `plugin/bin/lib/reconcile/archive-merged.js`, update the `STRUCTURALLY_STUCK_REASONS` Set and its preceding comment (~line 1024-1030):

```javascript
// Skip reasons that might indicate a run dir stuck without external help,
// as opposed to a benign, transient in-flight state. 'console-unresolved'/
// 'console-never-rendered'/'local-behind-merge'/'merge-commit-unknown' are
// deliberately excluded — each already has its own clear resolution path
// (a human answering a console, a local fetch catching up) that doesn't
// need this generic staleness backstop. 'console-never-rendered-pr-closed'
// (#2231) is the one exception carved out of that exclusion: it fires only
// when the by-number fallback below confirms the run's PR is CLOSED
// (never merged) — at that point nothing drives the run's pipeline to
// wrap-up anymore, so no console will ever render, and the plain
// 'console-never-rendered' reason's "a human eventually answers it"
// rationale does not apply. The MERGED sub-case of that same fallback
// keeps using plain 'console-never-rendered', unchanged — code landed
// there, so a console may genuinely still be pending.
const STRUCTURALLY_STUCK_REASONS = new Set(['no-worktree', 'no-branch', 'no-pr', 'console-never-rendered-pr-closed']);
```

Then update the by-number fallback block's `consoleState === 'none'` branch (~lines 1316-1319 in the block starting at ~line 1301). Name the new local `consoleReason`, not `reason` — the outer `reason` (`const reason = stampedWorktree ? 'no-branch' : 'no-worktree';`, a few lines above this block) is already in scope here; shadowing it with another `const reason` inside this nested `if` is legal JS, not a syntax error, but confusing to read next to the outer binding of the same name and risky for a future edit that means to reference the outer one but silently picks up this inner one instead:

```javascript
          if (consoleState === 'none') {
            // #2231: a CLOSED (never-merged) PR's console will never
            // render — nothing drives this run's pipeline to wrap-up
            // anymore, so the plain 'console-never-rendered' reason's
            // usual "a human answers the console" resolution path
            // (STRUCTURALLY_STUCK_REASONS' own comment above) does not
            // apply here. Use a distinct, tracked reason so this
            // genuinely dead-ended state escalates like no-branch/
            // no-worktree/no-pr, instead of silently freezing the
            // escalation cache the way plain 'console-never-rendered'
            // does today (that reason stays untracked for the MERGED
            // case, where a console really may still be pending).
            const consoleReason = byNumber.state === 'CLOSED' ? 'console-never-rendered-pr-closed' : 'console-never-rendered';
            skipped.push({ runDir: dir, reason: consoleReason });
            if (consoleReason === 'console-never-rendered-pr-closed') trackStuckSkip(root, repoSlug, dir, consoleReason);
            continue;
          }
```

Use this `consoleReason` version — verify by reading the surrounding ~10 lines of actual current source before editing (the outer `reason` binding's exact declaration line may have shifted slightly from this plan's line numbers).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS — all tests in the file, including both new ones and every pre-existing test (in particular, re-confirm the `#1962`/`#2226`/`#2228` CLOSED/MERGED tests with a *rendered* `console.json` still archive as before — this fix only touches the `consoleState === 'none'` branch).

- [ ] **Step 5: Run the full reconcile test directory and the full suite**

Run: `node --test tests/bin-lib/reconcile/`
Expected: PASS, no regressions in sibling reconcile test files.

Run: `npm test 2>&1 | tail -60`
Expected: PASS (full suite) — if a failure count looks off, re-run only the affected file(s) in isolation before concluding anything is broken (see CLAUDE.md's flake-tolerance note), since concurrent sibling sessions may be running their own tests against this same checkout.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "$(cat <<'EOF'
Add tracked console-never-rendered-pr-closed reason for closed-unmerged PRs

The #1962/#2226/#2228 by-number fallback in archiveMerged reused the
general merged-PR path's 'console-never-rendered' skip reason for a run
whose PR is confirmed CLOSED (never merged). That reason is deliberately
excluded from STRUCTURALLY_STUCK_REASONS because it "already has its own
clear resolution path" (a human eventually answers a rendered console) —
true for an OPEN or MERGED PR, false for a CLOSED one, where nothing
drives the run's pipeline to wrap-up anymore and no console will ever
render. The fallback's CLOSED sub-case now uses a distinct, tracked
reason (console-never-rendered-pr-closed) so this genuinely dead-ended
state escalates via the existing 7-day/3-strike mechanism instead of
silently freezing the escalation cache — confirmed empirically against
#2231's own reported directory, whose stale cache entry (count: 42,
lastError: "stuck at no-branch") turned out to be exactly this: frozen
since before the by-number fallback started reclassifying it.

refs #2231

Claude-Session: https://claude.ai/code/session_01XPgYBNXXyq5i9bpHES5YAn
EOF
)"
```

---

### Task 2: Resolve the specific stuck directory named in #2231

**Files:** none (operational — `.claude-tweaks/pipelines/` is gitignored bookkeeping in the main checkout, not tracked/worktree content; no code or test changes in this task)

**Interfaces:**
- Consumes: `bin/hooks.js close-run --run <dir>` and `bin/hooks.js archive-run --run <dir>` (existing CLIs, unchanged by this plan), run against the main checkout (`/Users/thomasholknielsen/Code Workspaces/claude-tweaks`), never this worktree.
- Produces: the directory `.claude-tweaks/pipelines/2026-08-26T155419-record-1413` archived to `.claude-tweaks/pipelines/archive/2026-08-26T155419-record-1413`, satisfying AC3.

- [ ] **Step 1: Close the run (override the foreign-owner refusal explicitly)**

The run's `run-state.json` carries `sessionId: "ab4a7346-7d0b-46f0-9bfe-d0229e699d1b"` (a different, long-closed session) and `status: "active"` (non-terminal) — `archive-run` refuses a non-terminal run outright, and `close-run`'s default resolution refuses a foreign-owned run unless `--run` is passed explicitly (which names this exact directory, satisfying that override). This is a safe, deliberate close: the record's own body already confirms via `decisions.md` that "the record's own deliverable turned out to already be implemented and merged elsewhere... a stale duplicate of an already-closed gap, not a live defect. No code change made" — there is no live, unfinished work in this directory to lose.

Run (from the main checkout, `/Users/thomasholknielsen/Code Workspaces/claude-tweaks`):

```bash
node plugin/bin/hooks.js close-run --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-08-26T155419-record-1413"
```

Expected output: a line confirming the run closed (noting it was recorded by another session, and/or that no wrap-up invocation was recorded — both expected and non-blocking per the command's own printed guidance).

- [ ] **Step 2: Archive the now-terminal run**

```bash
node plugin/bin/hooks.js archive-run --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-08-26T155419-record-1413"
```

Expected output: confirmation the directory was archived (moved under `.claude-tweaks/pipelines/archive/`).

- [ ] **Step 3: Verify the directory no longer exists at its original path and reconcile no longer reports it**

```bash
test -d "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-08-26T155419-record-1413" && echo STILL-PRESENT || echo GONE
test -d "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-08-26T155419-record-1413" && echo ARCHIVED || echo NOT-ARCHIVED
cd "/Users/thomasholknielsen/Code Workspaces/claude-tweaks"
node plugin/bin/hooks.js reconcile --dry-run --json | node -e "
let data='';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  const j = JSON.parse(data);
  const hit = (j.runs || []).find(r => r.runDir.includes('2026-08-26T155419-record-1413'));
  console.log(hit ? 'STILL REPORTED: ' + JSON.stringify(hit) : 'NO LONGER REPORTED BY RECONCILE');
});
"
```

Expected: `GONE`, `ARCHIVED`, `NO LONGER REPORTED BY RECONCILE`. This directly satisfies AC3.

- [ ] **Step 4: No commit for this task**

Nothing here touches git-tracked content in this worktree (the archived directory lives entirely under the main checkout's gitignored `.claude-tweaks/pipelines/`) — there is nothing to commit. Note this resolution in the build's final handoff/PR description instead (Task 1's PR already covers the code fix; mention this directory's manual resolution as an additional line in that same PR body, per the record's AC3).
