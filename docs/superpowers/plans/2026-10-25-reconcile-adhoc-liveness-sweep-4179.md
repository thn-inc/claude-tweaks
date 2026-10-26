# Reconcile: Sweep Main-Checkout Ad-Hoc Dirs by Session Liveness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile archives a `{ts}-adhoc-standalone` run dir stamped with the main checkout once `run-liveness` says its session is dead and a grace period has passed, and such a dir stops escalating into the consolidated structurally-stuck record.

**Architecture:** `archive-merged.js`'s `classifyRunDir` gains one kind, `adhoc-session-ended`, for a genuine ad-hoc dir whose recorded worktree is the main checkout: past `ADHOC_SESSION_ENDED_GRACE_MS` by dir mtime AND an injectable liveness function returns `'dead'`. The default liveness function calls `runLiveness` with the worktree-scoped probes neutralised, because the main checkout's lock and last commit belong to every session, not this one. `archiveMerged`'s main loop archives that kind exactly as it archives `adhoc-superseded`, and `isAdHocIntrinsicSkip` then exempts every genuine ad-hoc dir (linked or main checkout) at `no-branch`/`no-worktree`/`no-pr`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/archive/2026-10-25T111716-record-4179/work/4179-spec.md` (record #4179)

Scope keywords: isAdHocIntrinsicSkip, adhoc-superseded, ADHOC_EXEMPT_WHY, classifyRunDir

## Global Constraints

- Leave the 30-day TTL path for linked-worktree dirs unchanged (`adhoc-superseded`, `ADHOC_SUPERSEDED_TTL_MS`).
- The sweep consumes `plugin/bin/lib/run-liveness` (`runLiveness`) — that module is read-only for this record; no edits under `plugin/bin/lib/run-liveness/`.
- A still-live main-checkout ad-hoc dir is never archived, regardless of age. Only a `'dead'` verdict archives; `'live'` and `'unknown'` never do.
- The resolve of an already-escalated entry goes through the existing `trackStuckSkip` → `clearResidue(..., { why: ADHOC_EXEMPT_WHY })` path (#2724's mechanism), behind the existing `dryRun` guard.
- Commit messages: `{Verb} {what} — {detail}`, body line `refs #4179`, never `closes`/`fixes`.

## Premise evidence (real-input probe, run at authoring time)

`runLiveness` was run against all 30 main-checkout ad-hoc dirs on disk under `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/` (scratch script, not committed):

- As-is (`runLiveness(dir)`): **30/30 `unknown`** — the `worktree-lock` and `last-commit` probes read the main checkout itself.
- With `{ probes: { pathType: () => ({ type: 'missing' }) } }`: **19 `dead`** (every dir whose newest own event is older than 72 h, via the legacy witness: `owner-pid:negative:no-owner-block heartbeat:negative:no-owner-block worktree-lock:negative:no-worktree last-commit:negative:no-worktree owner-events:negative:silent`) and **11 `unknown`** (the 11 with an own event inside 72 h, `owner-events:positive:recent`). None of the 30 carries an `owner` block.

So the default liveness function MUST neutralise the worktree probes; consuming `runLiveness` as-is would never sweep anything. Logged to the run's `decisions.md` (`Spec Step 3 premise probe`).

## Deliverable 3 disposition

Deliverable 3 ("Until then, add one remedy line … to `structurallyStuckBody`") is conditioned on Deliverable 1 not having landed. Deliverables 1 and 2 land in this same change, after which no main-checkout ad-hoc dir escalates (Task 2), and an already-escalated one is resolved off the record by `trackStuckSkip`. A remedy line would describe a state the record can no longer reach. `escalate-residue.js` is therefore not modified. This is recorded as a decision in the run's `decisions.md` and named in the PR body; it is not a silent skip.

## Build deviations (Common Step 4.5, recorded after execution)

- **Own-session guard (Beneficial).** `adhoc-session-ended` skips a dir whose run-state `sessionId` equals the reconcile caller's `sessionId`. This mirrors `abandoned-interrupted`'s `ownLive` and was added from the whole-branch review (ab3f1794a). The spec does not ask for it; it is defense in depth.
- **Production-default liveness integration test (Beneficial).** `archiveMerged({ cwd, sessionId })` with no `liveness` stub sweeps a real legacy fixture end to end (ab3f1794a).
- **Docs beyond `docs/reconcile-checks.md` (Beneficial).** `docs/hooks.md`, `docs/plugin-structure.md`, the #2724 journey, and the `run-liveness/index.js` header comment carried claims this change made false ("keeps escalating", "No caller consumes the verdict yet"), so they were swept too (107af4c50, ab3f1794a).
- **Deliverable 3 (Update the spec).** Not built — see "Deliverable 3 disposition" above. Staged for the Review Console as `staged/build-deviation-1.md`.

## Scope sweep (plan-audit Check B)

The keyword sweep also matched two historical plans, reviewed and deliberately not modified — a shipped plan is a record of what was decided then, not live documentation:

- `docs/superpowers/plans/2026-10-24-reconcile-stuck-adhoc-exemption-2724.md` — read-only (history)
- `docs/superpowers/plans/2026-10-24-run-liveness-owner-block-3973.md` — read-only (history)

## Review Focus

1. A main-checkout ad-hoc dir whose liveness stays `unknown` forever (a probe error such as an unreadable `events.jsonl`) is now neither swept nor escalated. Expected: it is left in place (never archived on `unknown`). Pinned by Task 1's `unknown` test; the visibility loss is accepted and named in `docs/reconcile-checks.md`.
2. A liveness function that throws must read as "not dead", never crash the reconcile pass. Pinned by Task 1's throwing-stub test.
3. A linked-worktree ad-hoc dir must never reach the liveness function (cost and semantics unchanged). Pinned by Task 1's linked-worktree test asserting the stub was never called.
4. A main-checkout stamp reached through a symlinked path (`/var` vs `/private/var`) must still be recognised as the main checkout. Pinned by flipping the existing #2724 symlink test in Task 2 and by Task 1's main-checkout detection reusing the same realpath comparison.
5. A dir that classifies `abandoned-interrupted` but fails the `checkRunIntegrity` gate (most main-checkout ad-hoc dirs are `status: interrupted`) must still fall through to `adhoc-session-ended`. Pinned by Task 1's integration fixture using `status: 'interrupted'` with an old events log.

---

### Task 1: `adhoc-session-ended` classifier kind and archive dispatch

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` — new constant + helpers beside `isAdHocIntrinsicSkip` (`:97-120`); `CLASSIFY_ORDER` and `classifyRunDir` (`:1709-1767`); `archiveMerged` signature (`:2062-2064`), main-loop classify calls (`:2142-2156`) and the `adhoc-superseded` dispatch (`:2248-2260`); exports (`:2425-2437`); the "five" comments at `:137` and `:1693`.
- Test: `tests/bin-lib/reconcile/archive-merged.test.js` (classifier unit tests, next to the #2724 block at `:1986`, reusing `mkAdHocRunDir`)
- Test: `tests/reconcile.test.js` (archiveMerged integration + default liveness, next to the #1604 block at `:772`, reusing `bareRepoRoot`/`mintAdHocDir`)

**Interfaces:**
- Produces:
  - `ADHOC_SESSION_ENDED_GRACE_MS = 7 * 24 * 60 * 60 * 1000` (exported).
  - `isMainCheckoutAdHoc(dir) -> boolean` (exported) — true only for a genuine ad-hoc dir (`readAdHocState(dir)` non-null) whose `state.worktree` resolves (`resolveLeaf`, state `'resolved'`) to the same path as `canonicalRealpath(path.resolve(dir, '..', '..', '..'))`. Any unprovable path → false. Move this comparison out of `isAdHocIntrinsicSkip` into the helper (Task 2 rewrites `isAdHocIntrinsicSkip` and no longer needs it).
  - `adHocSessionLiveness(dir) -> 'live'|'dead'|'unknown'` (exported) — `runLiveness(dir, { probes: { pathType: () => ({ type: 'missing' }) } }).verdict`. Comment why: the main checkout's worktree lock and last commit are shared by every session, so they are not evidence about this one (cite the premise numbers above).
  - `classifyRunDir(ctx)`: `ctx.liveness` (function `dir -> verdict`, default `adHocSessionLiveness`). New kind `'adhoc-session-ended'` → `{ kind, ttlMs: ADHOC_SESSION_ENDED_GRACE_MS, evidence: { verdict: 'dead' } }` when `isMainCheckoutAdHoc(dir) && isStaleDir(dir, ADHOC_SESSION_ENDED_GRACE_MS, now)` and then the liveness call returns exactly `'dead'`. Evaluate liveness last (it spawns processes). A liveness call that throws counts as not dead.
  - `CLASSIFY_ORDER = ['orphaned-mint', 'abandoned-interrupted', 'adhoc-superseded', 'adhoc-session-ended', 'merged', 'structurally-stuck']`.
  - `archiveMerged({ ..., liveness })` — optional; threaded into the main loop's first `classifyRunDir` call (kinds `['orphaned-mint', 'abandoned-interrupted', 'adhoc-superseded', 'adhoc-session-ended']`) and the abandoned-interrupted fallthrough re-classify (kinds `['adhoc-superseded', 'adhoc-session-ended']`). The dispatch becomes `if (kind === 'adhoc-superseded' || kind === 'adhoc-session-ended')` → `finishArchiveAttempt(..., () => archiveRunDir(root, dir))`, unchanged otherwise.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/reconcile/archive-merged.test.js` (import `ADHOC_SESSION_ENDED_GRACE_MS`, `isMainCheckoutAdHoc` alongside the existing imports; `mkAdHocRunDir({ ageMs, worktree: (root) => root })` gives a main-checkout dir):

```js
test('AC1.1 #4179: a main-checkout ad-hoc dir past the grace period with a dead session classifies adhoc-session-ended', () => {
  const { dir } = mkAdHocRunDir({ ageMs: ADHOC_SESSION_ENDED_GRACE_MS * 2, worktree: (root) => root });
  const r = classifyRunDir({ dir, kinds: ['adhoc-session-ended'], liveness: () => 'dead' });
  assert.equal(r.kind, 'adhoc-session-ended');
  assert.equal(r.ttlMs, ADHOC_SESSION_ENDED_GRACE_MS);
});

test('AC2.1 #4179: a live or unknown session is never adhoc-session-ended, however old', () => {
  const { dir } = mkAdHocRunDir({ ageMs: ADHOC_SESSION_ENDED_GRACE_MS * 10, worktree: (root) => root });
  for (const v of ['live', 'unknown']) {
    assert.equal(classifyRunDir({ dir, kinds: ['adhoc-session-ended'], liveness: () => v }).kind, 'none', v);
  }
});

test('#4179: a dead session inside the grace period is not yet adhoc-session-ended, and liveness is not asked', () => {
  const { dir } = mkAdHocRunDir({ ageMs: 60 * 60 * 1000, worktree: (root) => root });
  let asked = 0;
  assert.equal(classifyRunDir({ dir, kinds: ['adhoc-session-ended'], liveness: () => { asked++; return 'dead'; } }).kind, 'none');
  assert.equal(asked, 0);
});

test('#4179: a throwing liveness function reads as not dead', () => {
  const { dir } = mkAdHocRunDir({ ageMs: ADHOC_SESSION_ENDED_GRACE_MS * 2, worktree: (root) => root });
  assert.equal(classifyRunDir({ dir, kinds: ['adhoc-session-ended'], liveness: () => { throw new Error('boom'); } }).kind, 'none');
});

test('#4179: a linked-worktree ad-hoc dir never reaches the liveness function', () => {
  const { dir } = mkAdHocRunDir({ ageMs: ADHOC_SESSION_ENDED_GRACE_MS * 2 });
  let asked = 0;
  assert.equal(classifyRunDir({ dir, kinds: ['adhoc-session-ended'], liveness: () => { asked++; return 'dead'; } }).kind, 'none');
  assert.equal(asked, 0);
  assert.equal(isMainCheckoutAdHoc(dir), false);
});

test('#4179: a non-ad-hoc dir stamped with the main checkout is not adhoc-session-ended', () => {
  const { dir } = mkAdHocRunDir({ ageMs: ADHOC_SESSION_ENDED_GRACE_MS * 2, worktree: (root) => root, basename: '2026-10-17T081451-record-1' });
  assert.equal(classifyRunDir({ dir, kinds: ['adhoc-session-ended'], liveness: () => 'dead' }).kind, 'none');
});
```

In `tests/reconcile.test.js`, after the #1604 block:

```js
test('AC1.1 AC4.1 #4179: archiveMerged archives a main-checkout ad-hoc dir whose session is dead and past the grace period', () => {
  const { archiveMerged, ADHOC_SESSION_ENDED_GRACE_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const runId = '2026-08-01T200000-adhoc-standalone';
  const dir = mintAdHocDir(root, runId, { worktree: root, status: 'interrupted', sessionId: 'sess-1', lastEvent: 'session-end' }, ADHOC_SESSION_ENDED_GRACE_MS * 2);
  const result = archiveMerged({ cwd: root, liveness: () => 'dead' });
  assert.ok(!fs.existsSync(dir));
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)));
  assert.ok(result.archived.includes(dir));
});

test('AC2.1 #4179: archiveMerged leaves a main-checkout ad-hoc dir in place while its session is live', () => {
  const { archiveMerged, ADHOC_SESSION_ENDED_GRACE_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const dir = mintAdHocDir(root, '2026-08-01T210000-adhoc-standalone', { worktree: root, status: 'active', sessionId: 'sess-1' }, ADHOC_SESSION_ENDED_GRACE_MS * 3);
  const result = archiveMerged({ cwd: root, liveness: () => 'live' });
  assert.ok(fs.existsSync(dir));
  assert.ok(!result.archived.includes(dir));
});

test('#4179: adHocSessionLiveness reads a legacy main-checkout ad-hoc dir with a 5-day-silent events log as dead, where runLiveness as-is does not', () => {
  const { adHocSessionLiveness } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { runLiveness } = require('../plugin/bin/lib/run-liveness');
  const root = bareRepoRoot(); // its seed commit is seconds old: last-commit reads positive as-is
  const dir = mintAdHocDir(root, '2026-08-01T220000-adhoc-standalone', { worktree: root, status: 'interrupted', sessionId: 'sess-1', lastEvent: 'session-end' });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify({ type: 'gate-denial', ts: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(), sessionId: 'sess-1' })}\n`);
  assert.equal(adHocSessionLiveness(dir), 'dead');
  assert.notEqual(runLiveness(dir).verdict, 'dead');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="4179" tests/bin-lib/reconcile/archive-merged.test.js tests/reconcile.test.js`
Expected: FAIL — `ADHOC_SESSION_ENDED_GRACE_MS`/`isMainCheckoutAdHoc`/`adHocSessionLiveness` are undefined, and the integration dir is not archived.

- [ ] **Step 3: Implement** the Interfaces block above in `plugin/bin/lib/reconcile/archive-merged.js`. Require `runLiveness` from `'../run-liveness'` at the top. Update the `:137` ("these five wrappers") and `:1693` ("all five at once") comments to stop counting, and extend the `:2239-2247` comment to name the new kind and why it shares `archiveRunDir`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/reconcile.test.js`
Expected: PASS (all tests in both files, not only the new ones).

- [ ] **Step 5: AC4.1 — prove the sweep test goes red on pre-change code.** Temporarily edit the main-loop dispatch back to `if (kind === 'adhoc-superseded')` by hand (never `git stash` — the stash stack is shared across worktrees), rerun `node --test --test-name-pattern="AC4.1" tests/reconcile.test.js`, confirm FAIL, restore the edit, confirm PASS. Quote both outputs in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/reconcile/archive-merged.test.js tests/reconcile.test.js
git commit -m "Sweep main-checkout ad-hoc dirs by session liveness — adhoc-session-ended kind archives a dead session past a 7-day grace

refs #4179"
```

### Task 2: Exempt every genuine ad-hoc dir from structurally-stuck escalation

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` — `isAdHocIntrinsicSkip` and its comment (`:97-120`), `ADHOC_EXEMPT_WHY` (`:105`).
- Test: `tests/bin-lib/reconcile/archive-merged.test.js` — flip the two #2724 main-checkout tests (`:2017-2032`), add the escalated-entry resolve test.

**Interfaces:**
- Consumes: `readAdHocState(dir)` (existing), Task 1's sweep (the reason the exemption is now safe).
- Produces: `isAdHocIntrinsicSkip(dir, reason) -> boolean` — `ADHOC_INTRINSIC_STUCK_REASONS.has(reason) && !!readAdHocState(dir)`. The comment says each genuine ad-hoc dir now has a sweep: `adhoc-superseded` (linked worktree, 30 days) or `adhoc-session-ended` (main checkout, dead session + 7 days).
- `ADHOC_EXEMPT_WHY` = `'is an ad-hoc session directory: no branch, worktree or PR is its normal state, and reconcile archives it once its session has ended (adhoc-superseded for a linked worktree, adhoc-session-ended for the main checkout)'`.

- [ ] **Step 1: Write the failing tests** — rename and invert the two existing tests, and add one:

```js
test('AC3.1 #4179: a dir stamped with the main checkout as its worktree no longer classifies structurally-stuck', () => {
  const { dir } = mkAdHocRunDir({ ageMs: STRUCTURALLY_STUCK_TTL_MS * 2, worktree: (root) => root });
  for (const r of ['no-branch', 'no-worktree', 'no-pr']) assert.equal(isStructurallyStuck(dir, r), false, r);
});
```

The symlink variant keeps its body and asserts `isStructurallyStuck(dir, 'no-branch') === false` (rename it `AC3.1 #4179: a main-checkout stamp reached through a symlinked path no longer classifies structurally-stuck`).

```js
test('AC3.2 #4179: an escalated main-checkout ad-hoc entry is resolved off the record with the ad-hoc reason text', () => {
  const { root, dir } = mkAdHocRunDir({ ageMs: STRUCTURALLY_STUCK_TTL_MS * 2, worktree: (r) => r });
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) recordResidueFailure(root, 'structurally-stuck', dir, { lastError: 'stuck at no-pr' });
  const escalated = [];
  const resolved = [];
  trackStuckSkip(root, 'o/r', dir, 'no-pr', {
    escalate: (a) => { escalated.push(a); },
    resolve: (a) => { resolved.push(a); return { status: 'path-removed' }; },
  });
  assert.equal(escalated.length, 0);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].targetPath, dir);
  assert.match(resolved[0].why, /adhoc-session-ended for the main checkout/);
  assert.deepEqual(listResidueFailures(root), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="AC3\.[12] #4179" tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL after Step 1 — the main-checkout dir still classifies structurally-stuck, and the resolve never fires.

- [ ] **Step 3: Implement** the Interfaces block in `plugin/bin/lib/reconcile/archive-merged.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/escalate-residue.test.js tests/reconcile.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Exempt main-checkout ad-hoc dirs from structurally-stuck escalation — adhoc-session-ended now sweeps them

refs #4179"
```

### Task 3: Docs — reconcile-checks, hooks, and the #2724 journey

**Files:**
- Modify: `docs/reconcile-checks.md:269-290`
- Modify: `docs/hooks.md:16` (last two sentences) and `docs/hooks.md:52` (TTL list; "No caller consumes the verdict yet (#3977, #3979)")
- Modify: `docs/journeys/shape-the-stuck-runs-record-without-reconcile-erasing-it-2724.md:41-44`

**Interfaces:**
- Consumes: Task 1/2 names — `adhoc-session-ended`, `ADHOC_SESSION_ENDED_GRACE_MS` (7 days), `adHocSessionLiveness`, `isMainCheckoutAdHoc`, the new `ADHOC_EXEMPT_WHY`.

- [ ] **Step 1: Edit `docs/reconcile-checks.md`.** In the classifier section: the `kind ∈ {…}` list gains `'adhoc-session-ended'` after `'adhoc-superseded'`; "five independent" / "The five pre-consolidation predicates" stay (they describe history) but add one sentence that `adhoc-session-ended` was added later (#4179) with no wrapper predicate; the fallthrough sentence re-classifies "scoped to `adhoc-superseded` and `adhoc-session-ended`". Rewrite the exemption paragraph's first sentence (Deliverable 4): every genuine ad-hoc dir is exempt at `no-branch`/`no-worktree`/`no-pr`; a linked-worktree dir is archived by `adhoc-superseded` (30 days after its worktree stops being registered), a main-checkout dir by `adhoc-session-ended` (its session reads `dead` from `adHocSessionLiveness` — `runLiveness` with the worktree probes neutralised, since the main checkout's lock and last commit are every session's — and 7 days have passed by dir mtime). Add one sentence: a main-checkout dir whose verdict stays `unknown` is left in place, neither swept nor escalated. Keep the rest of the paragraph (clearResidue, resolve statuses, `why`, dry-run) unchanged.

- [ ] **Step 2: Edit `docs/hooks.md`.** Line 16's closing sentence ("Until then a linked-worktree ad-hoc dir is exempt … keeps escalating.") becomes: a main-checkout ad-hoc dir, which `adhoc-superseded` can never claim, is swept by `adhoc-session-ended` once its session reads `dead` and 7 days have passed (#4179), and every genuine ad-hoc dir is exempt from `structurally-stuck` escalation at `no-branch`/`no-worktree`/`no-pr` (#2724, widened by #4179). Line 52: add `adhoc-session-ended 7 d` to the `isStaleDir` TTL list, and replace "No caller consumes the verdict yet (#3977, #3979)." with "One caller consumes the verdict: `archive-merged.js`'s `adhoc-session-ended` sweep (#4179), through `adHocSessionLiveness`, which neutralises the lock and commit probes for a main-checkout dir; the remaining consumers are #3977 and #3979."

- [ ] **Step 3: Edit the #2724 journey.** Line 41's "whose `run-state.json` records a linked worktree" → "(linked worktree or main checkout)"; line 42's "their own 30-day `adhoc-superseded` sweep" → "their own sweep (`adhoc-superseded` after 30 days for a linked worktree, `adhoc-session-ended` once the session is dead plus 7 days for the main checkout)"; line 44's edge case ("An ad-hoc dir stamped with the main checkout keeps escalating…") becomes "An ad-hoc dir stamped with the main checkout no longer escalates: `adhoc-session-ended` archives it once its session is dead (#4179). One whose liveness stays `unknown` stays in place."

- [ ] **Step 4: Verify no stale claim survives.** Run, each expecting no output:

```bash
git grep -n -i "keeps escalating" -- docs plugin
git grep -n "No caller consumes the verdict yet" -- docs plugin
git grep -n "can never be claimed by .adhoc-superseded., so it stays tracked" -- docs plugin
```

- [ ] **Step 5: Commit**

```bash
git add docs/reconcile-checks.md docs/hooks.md docs/journeys/shape-the-stuck-runs-record-without-reconcile-erasing-it-2724.md
git commit -m "Document the adhoc-session-ended sweep — reconcile-checks, hooks, and the #2724 journey

refs #4179"
```
