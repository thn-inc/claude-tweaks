# Post-merge claim liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reconcile post-merge pass's per-run `.post-merge.lock` claim reclaim only a dead (or provably stale) holder and release only when the caller still owns it, so a stalled-but-live pass can no longer be taken over and then delete its successor's claim.

**Architecture:** Keep the existing exclusive-create file claim and its atomic rename-aside takeover in `plugin/bin/lib/reconcile/post-merge.js`, but write an owner token (`{pid}-{random}`) into the claim file, judge staleness by holder liveness (reusing `plugin/bin/lib/file-lock.js`'s `isAlive` probe, newly exported), keep an age backstop (`CLAIM_MAX_HOLD_MS`) for a holder pid that reads alive (a reused pid), fall back to the existing mtime rule only for a claim with no readable owner, and make `releaseClaim` a compare-and-delete against the caller's token. `file-lock.js`'s `acquireLock` itself cannot serve this call site; the reason is stated in a comment there (Task 1, Step 3).

**Tech Stack:** Node 18+ CommonJS, `node --test`, `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T203719-record-4797/work/4797-spec.md` (its `## Decisions` section answers the earlier plan-review question: Reading B).

## Decision: the live-holder age backstop (`CLAIM_MAX_HOLD_MS`)

The record's Decisions section chose Reading B: keep an age backstop that reclaims a claim whose holder pid still reads alive, sized the way `plugin/bin/lib/reconcile/background-lock.js` sizes `STALE_LOCK_MS` (a real duration bound times about 2.5x headroom), so a live but slow holder is never mistaken for abandoned.

**Value: `CLAIM_MAX_HOLD_MS = 60 * 60 * 1000` (60 minutes).** Derivation:

- The claim is held for exactly one run's Steps 4.0 + 4.0b (`processCandidate`'s `takeClaim` … `finally releaseClaim`). The pass budget (`budget.js`) is checked only between runs, so it bounds the pass, not one run's hold. The merge-mode inline path (`postMergeOne`, `bin/post-merge-run.js`) has no budget at all. So the bound is one run's sequential `gh` work, not `BACKGROUND_BUDGET_MS`.
- Every `gh` call in that path is synchronous and bounded by `GH_TIMEOUT_MS`, which the `gh-timeout-ms` policy key (or `CLAUDE_TWEAKS_GH_TIMEOUT_MS`) can raise to its schema ceiling of 60 s, and each call may be retried once: at most 120 s per call. A claimant cannot see the holder's timeout config, so the backstop is sized at that ceiling, not at the 5 s default.
- Reference run (one Fixes record, one below-floor parent): `closing-links` post-merge mode makes `pr view`, the merge-commit `api` read, `repo view`, the will-close issue read plus its settle re-reads and at most one reopen; Step 4.0b fetches the parent, lists its sub-issues, and comments and closes it. That is about 12 sequential calls, plus the in-session settle poll, capped at `MAX_SETTLE_MS` (60 s).
- Bound: 12 × 120 s + 60 s = 1500 s = 25 minutes. With about 2.4x headroom that rounds to 60 minutes. At the 5 s default the same run takes about 2 minutes, so a live, merely slow holder is never reclaimed. A crashed holder whose pid was reused still stalls its run for at most an hour, instead of forever.
- A claim with no readable owner keeps the `CLAIM_STALE_MS` (10 min) reclaim. Release still requires the owner token.
- The value and this derivation go in the spec (`work/4797-spec.md`'s Decisions section, Task 1 Step 3) and in a code comment next to the constant.

## Global Constraints

- `CLAIM_STALE_MS` stays `10 * 60 * 1000` and `CLAIM_FILENAME` stays `'.post-merge.lock'` (a plain file, created `wx`). Older installed reconcilers create and respect this same file concurrently with the new code, so the lock's path and its file shape must not change.
- A claim file with no readable owner (empty content: written by an older reconciler, or caught in the instant between create and token write) keeps the old rule: it is in flight under `CLAIM_STALE_MS` and reclaimable at or past it.
- `takeClaim`'s reasons stay exactly `in-flight` and `claim-failed`. Archive deferral and `classifyEntry` route on them.
- No new dependency. Never block or poll. The reconcile pass is synchronous per run and has a budget to respect.
- Commit subjects use `{Verb} {what} — {detail}` and reference the record as `refs #4797`, never `closes`/`fixes`.
- Governing project skill: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` states, verbatim, "Decide the shape before writing the file, and reuse `withLock` rather than hand-rolling a second mutex." This plan keeps the existing hand-rolled claim, so it must say at the call site why `file-lock.js` cannot serve (Task 1, Step 3). That is also the record's second Deliverable. No other `.claude/skills/` rule names these files: `caching-and-locks.md` covers holding `file-lock.js` across a long call, which this plan does not do.
- Line numbers below are not given: `post-merge.js` moved upstream (merged into this branch at 9299db52a). Locate code by function and constant name.

## Review Focus

- A claim held by a live pid but older than `CLAIM_STALE_MS` must read `in-flight`, and its file must stay byte-for-byte unchanged. This is the record's core bug (AC1.1). Tested in Task 1 at the unit level and through `postMerge`.
- A claim whose holder pid is dead must be reclaimed at once, even with a fresh mtime. Otherwise a crashed holder stalls the run for 10 minutes for no reason. Tested in Task 1.
- Pid reuse: a claim whose pid reads alive but whose mtime is older than `CLAIM_MAX_HOLD_MS` (60 min, derived above) is treated as provably stale. One just under it is still in flight. Both edges tested in Task 1.
- Token write failure after the `wx` create: the half-made empty claim is removed and `claim-failed` returned, so nothing ownerless is left behind for 10 minutes. Tested in Task 1.
- Mixed-version interop: an empty (old-format) claim must still be honored for `CLAIM_STALE_MS`. The existing tests `claim: a fresh lock file means in-flight…` and `claim: a lock 11 minutes old is taken over…` already write `''`, so they pin this case unchanged. Task 1 keeps them passing and does not rewrite them. The reverse direction cannot be fixed here: an older installed reconciler still takes over any claim past `CLAIM_STALE_MS` by mtime and releases unconditionally, until every installed build upgrades. The call-site comment (Task 1) and `docs/reconcile-checks.md` (Task 2) say so.
- The residual-window comment inside `takeClaim` is restated under the new rule (Task 1, Step 3).

---

### Task 1: Owner-token, liveness-checked claim in post-merge.js

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/file-lock.js` (add `isAlive` to `module.exports`)
- Modify: `plugin/bin/lib/reconcile/post-merge.js` (constants beside `CLAIM_STALE_MS`, `takeClaim`/`releaseClaim`, `processCandidate`'s claim `finally`, `classifyEntry`'s comment, `module.exports`)
- Modify: `.claude-tweaks/pipelines/2026-11-02T203719-record-4797/work/4797-spec.md` (record the chosen value and derivation under `## Decisions`)
- Test: `tests/bin-lib/reconcile/post-merge.test.js`
- Test: `tests/bin-lib/file-lock.test.js`

**Interfaces:**
- Consumes: `require('../file-lock').isAlive(pid: number) -> boolean`. It already exists in `file-lock.js` and is only being exported.
- Produces:
  - `takeClaim(runDir: string, nowMs: number, fsApi = fs, { isAlive = fileLock.isAlive } = {}) -> { ok: true, token: string } | { ok: false, reason: 'in-flight' | 'claim-failed' }`
  - `releaseClaim(runDir: string, token: string | undefined, fsApi = fs) -> void`. It unlinks `{runDir}/.post-merge.lock` only when the file's current content `=== token`. A falsy `token` is a no-op. Never throws.
  - `CLAIM_MAX_HOLD_MS = 60 * 60 * 1000`, exported.
  - `releaseClaim` and `CLAIM_MAX_HOLD_MS` are added to `module.exports`.

- [ ] **Step 1: Append the failing tests to `tests/bin-lib/reconcile/post-merge.test.js`**

Add `releaseClaim` and `CLAIM_MAX_HOLD_MS` to the file's top-level destructured require (the `require('../../../plugin/bin/lib/reconcile/post-merge')` block). Then change the one existing return-shape assertion in `R3 two takeovers: the taker that loses the rename…` from `assert.deepEqual(winner, { ok: true });` to `assert.equal(winner.ok, true);`. Then append these tests after `takeClaim: a non-EEXIST create error is claim-failed`. Use a helper `heldLock(dir, content, ageMs)` that writes `content` to `lockOf(dir)` and sets its atime and mtime to `(NOW - ageMs) / 1000`:

```js
test('AC1.1 takeClaim: a live holder past CLAIM_STALE_MS is in-flight and its claim is untouched', () => {
  const dir = addRun(mainCheckout(), '2026-10-30T090000-spec-1');
  const held = `${process.pid}-held`;
  heldLock(dir, held, CLAIM_STALE_MS + 60 * 1000);
  assert.deepEqual(takeClaim(dir, NOW), { ok: false, reason: 'in-flight' });
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), held);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.stale-')), []);
});

test('AC1.1 postMerge: a live holder past CLAIM_STALE_MS skips in-flight, defers, and calls no fake', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  heldLock(dir, `${process.pid}-held`, CLAIM_STALE_MS + 60 * 1000);
  const links = fakeClosingLinks(ENVELOPE);
  const r = await run(root, { prs: { 11: merged() }, links, close: fakeCloseParents() });
  assert.deepEqual(r.entries, [{ runDir: dir, pr: 11, action: 'skipped', reason: 'in-flight' }]);
  assert.deepEqual(r.deferred, [dir]);
  assert.equal(links.calls.length, 0);
  assert.ok(fs.existsSync(lockOf(dir)));
});

test('takeClaim: a dead holder is reclaimed at once, fresh mtime or not, and the new claim carries our token', () => {
  const dir = addRun(mainCheckout(), '2026-10-30T090000-spec-1');
  heldLock(dir, '424242-dead', 1000);
  const r = takeClaim(dir, NOW, fs, { isAlive: (pid) => pid !== 424242 });
  assert.equal(r.ok, true);
  assert.match(r.token, new RegExp(`^${process.pid}-`));
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), r.token);
});

test('takeClaim: a live holder just under CLAIM_MAX_HOLD_MS is still in-flight', () => {
  const dir = addRun(mainCheckout(), '2026-10-30T090000-spec-1');
  const held = `${process.pid}-held`;
  heldLock(dir, held, CLAIM_MAX_HOLD_MS - 60 * 1000);
  assert.deepEqual(takeClaim(dir, NOW), { ok: false, reason: 'in-flight' });
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), held);
});

test('takeClaim: a live-reading holder older than CLAIM_MAX_HOLD_MS (a reused pid) is reclaimed', () => {
  const dir = addRun(mainCheckout(), '2026-10-30T090000-spec-1');
  heldLock(dir, `${process.pid}-held`, CLAIM_MAX_HOLD_MS + 60 * 1000);
  const r = takeClaim(dir, NOW);
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), r.token);
  assert.equal(CLAIM_MAX_HOLD_MS, 60 * 60 * 1000);
});

test('AC2.1 releaseClaim: a caller whose claim was taken over leaves the successor claim in place', () => {
  const dir = addRun(mainCheckout(), '2026-10-30T090000-spec-1');
  const first = takeClaim(dir, NOW);
  assert.equal(first.ok, true);
  // The first holder is judged dead: a successor takes the claim over.
  const second = takeClaim(dir, NOW, fs, { isAlive: () => false });
  assert.equal(second.ok, true);
  assert.notEqual(second.token, first.token);
  releaseClaim(dir, first.token);
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), second.token, 'the stale release left the successor claim');
  releaseClaim(dir, second.token);
  assert.ok(!fs.existsSync(lockOf(dir)), 'the owner release removes it');
});

test('releaseClaim: no token removes nothing', () => {
  const dir = addRun(mainCheckout(), '2026-10-30T090000-spec-1');
  const r = takeClaim(dir, NOW);
  releaseClaim(dir, undefined);
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), r.token);
});

test('takeClaim: a token write that fails removes the half-made claim and is claim-failed', () => {
  const dir = addRun(mainCheckout(), '2026-10-30T090000-spec-1');
  const fsApi = { ...fs, writeSync: () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } };
  assert.deepEqual(takeClaim(dir, NOW, fsApi), { ok: false, reason: 'claim-failed' });
  assert.ok(!fs.existsSync(lockOf(dir)));
});
```

Also append to `tests/bin-lib/file-lock.test.js` (and add `isAlive` to its `require('../../plugin/bin/lib/file-lock')` destructure):

```js
test('isAlive: this process is alive; a non-positive or non-integer pid is not', () => {
  assert.equal(isAlive(process.pid), true);
  assert.equal(isAlive(0), false);
  assert.equal(isAlive(-1), false);
  assert.equal(isAlive(1.5), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js`
Expected: FAIL. The new tests fail: `releaseClaim`/`CLAIM_MAX_HOLD_MS` are undefined, a live 11-minute claim is taken over, and `r.token` is undefined.

- [ ] **Step 3: Implement the claim in `plugin/bin/lib/reconcile/post-merge.js`, export `isAlive` from `plugin/bin/lib/file-lock.js`, and record the decision in the spec**

- `file-lock.js`: change `module.exports` to `{ acquireLock, releaseLock, withLock, isAlive }`. Change nothing else.
- `post-merge.js`: `const { isAlive: pidAlive } = require('../file-lock');`. Add `const CLAIM_MAX_HOLD_MS = 60 * 60 * 1000;` next to `CLAIM_STALE_MS`, with a comment carrying the derivation from this plan's Decision section in a few lines: one run's hold is bounded by its sequential gh calls (each at most 2 × the 60 s `gh-timeout-ms` ceiling) plus `closing-links`' 60 s settle cap; about 12 calls for a one-record, one-parent run gives 25 minutes; about 2.4x headroom, as `background-lock.js`'s `STALE_LOCK_MS` keeps, gives 60 minutes; a live-reading pid past that is a reused pid.
- Staleness rule, as an internal pure helper `claimIsStale(content, mtimeMs, nowMs, isAlive) -> boolean`:
  - The owner pid is `Number(content.split('-')[0])` when `content` matches `/^\d+-/`. Otherwise there is no owner.
  - No owner: stale iff `nowMs - mtimeMs >= CLAIM_STALE_MS` (today's rule, unchanged).
  - Owner: stale iff `!isAlive(pid) || nowMs - mtimeMs > CLAIM_MAX_HOLD_MS`.
- `takeClaim`:
  - Create = `openSync(lock, 'wx')`, then `writeSync(fd, token)` with token `` `${process.pid}-${Math.random().toString(36).slice(2)}` ``, then `closeSync`.
  - If the write throws: close, unlink the lock, and return `claim-failed`.
  - On `EEXIST`: read the content (`readFileSync`) and the mtime (`statSync`). `ENOENT` on either means `in-flight`; any other error means `claim-failed`. If not stale, return `in-flight`.
  - Otherwise rename aside exactly as today. Then re-judge the aside's own content and mtime with the same helper, replacing today's mtime-only re-check. If the aside is not stale, link it back, unlink the aside, and return `in-flight`.
  - Otherwise unlink the aside and retry the create once. Same `EEXIST` → `in-flight` mapping as today.
  - Every `fs` call goes through `fsApi`, including `readFileSync` and `writeSync`.
- Restate the "Residual window" comment inside `takeClaim` (the link-back branch) under the new rule: the holder may release between our rename and this link, and the link then re-creates a claim carrying the holder's token that nobody holds. The next pass judges that token's pid: once the holder process has exited it reads dead and is reclaimed at once; while it still runs, the claim reads `in-flight` until it exits or the claim passes `CLAIM_MAX_HOLD_MS`. An ownerless aside linked back keeps the `CLAIM_STALE_MS` rule.
- `releaseClaim(runDir, token, fsApi = fs)`: if `!token` return. Read the lock's content. Unlink only when the content `=== token`. Swallow every error.
- `processCandidate`: `finally { releaseClaim(dir, claim.token); }`.
- Rewrite the comment above `takeClaim`. It must:
  - State the liveness, age-backstop and owner-token rule.
  - State why `file-lock.js`'s `acquireLock` cannot serve here:
    - (a) Its reclaim is rm-then-mkdir, so two reclaimers of one dead lock can both win. The rename-aside takeover is what the `R3` tests pin.
    - (b) It polls up to 500 ms and returns `null` both for "held" and for an I/O error. This pass needs a non-blocking take with distinct `in-flight`/`claim-failed` reasons that drive archive deferral.
    - (c) Its lock is a directory with a 5 s ownerless fallback. Older installed reconcilers create and respect `.post-merge.lock` as a plain empty file, so that fallback would steal their live claim after 5 seconds.
  - Close with: hence only its `isAlive` probe is reused.
  - Add the interop note: until every installed build upgrades, an older reconciler still takes over any claim past `CLAIM_STALE_MS` by mtime alone and releases unconditionally, so a mixed-version pair keeps the old race; only new-on-new passes get the liveness and owner checks.
- Update `classifyEntry`'s comment. It currently says "a re-run past CLAIM_STALE_MS recovers a dead one". Change it to say a re-run takes over a dead holder's claim at once, and an ownerless one past `CLAIM_STALE_MS`.
- Add `releaseClaim, CLAIM_MAX_HOLD_MS` to `module.exports`.
- Spec: append to the `## Decisions` section of `.claude-tweaks/pipelines/2026-11-02T203719-record-4797/work/4797-spec.md` one bullet `**Chosen value:** CLAIM_MAX_HOLD_MS = 60 min`, followed by the derivation from this plan's Decision section in two or three sentences.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js tests/bin-lib/file-lock.test.js tests/post-merge-run-cli.test.js`
Expected: PASS. Every test passes, including the existing `R3`, `claim:` and `postMergeOne` tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/file-lock.js plugin/bin/lib/reconcile/post-merge.js tests/bin-lib/reconcile/post-merge.test.js tests/bin-lib/file-lock.test.js .claude-tweaks/pipelines/2026-11-02T203719-record-4797/work/4797-spec.md
git commit -m "Check post-merge claim holder liveness — owner-token claim, compare-and-delete release (refs #4797)"
```

### Task 2: Sweep the prose that describes the old age-only claim

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/merge-mode.md` (the `verdict` `in-flight` bullet)
- Modify: `docs/reconcile-checks.md` (the *Per-run claim file* bullet under "Two concurrency guards")
- Test: `tests/wrap-up-merge-mode-conformance.test.js` (the `'already-in-flight-archived'` pin)

`Expected: FAIL after Step 1`

**Interfaces:**
- Consumes: Task 1's rule. A dead holder is reclaimed at once. An ownerless claim is reclaimed past `CLAIM_STALE_MS` (10 min). A live holder is reclaimed only past `CLAIM_MAX_HOLD_MS` (60 min). Release is owner-checked.
- Produces: nothing code-facing.

- [ ] **Step 1: Update the conformance pin `'already-in-flight-archived'` in `tests/wrap-up-merge-mode-conformance.test.js`**

Replace the regex with one matching this exact new sentence tail (regex-escape it as the neighbouring entries do):

`` `next` `rerun-after-stale-claim` marks an archived run (the adopted path is under `archive/`), whose holder is another merge-mode invocation, because the reconciler never walks `archive/`: the line also names `/claude-tweaks:wrap-up #{n} merge` again, in case that holder died — a re-run takes over a dead holder's claim at once, and a claim naming no holder once it is past its 10-minute stale window (`CLAIM_STALE_MS`) ``

The separate `states the claim stale window` test must keep matching `past its (\d+)-minute stale window \(`CLAIM_STALE_MS`\)` unchanged.

- [ ] **Step 2: Run the conformance test to verify it fails**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js`
Expected: FAIL. `merge-mode.md` still carries the old "once the claim is past its 10-minute stale window" wording.

- [ ] **Step 3: Rewrite the prose**

- `plugin/skills/wrap-up/merge-mode.md`, the `verdict` `in-flight` bullet: replace the clause from `the line also names` to `in case that holder died.` with the Step 1 tail, ending with a full stop.
- `docs/reconcile-checks.md`, the *Per-run claim file* bullet. Keep its first two sentences (the `wx` create, background vs inline passes) and its last sentence (the dotfile name). Replace the middle with these facts:
  - The claim file holds its owner's `{pid}-{token}`.
  - A claim whose holder pid is alive skips `in-flight` however old it is, up to `CLAIM_MAX_HOLD_MS` (the reused-pid backstop, sized from one run's worst-case gh time; its derivation sits beside the constant). Name the constant only. Do not restate its value: no test pins a number in this doc.
  - A dead holder's claim is taken over at once.
  - A claim naming no holder (an older reconciler's empty file) keeps the `CLAIM_STALE_MS` (10 minutes) rule.
  - A takeover is still atomic: renamed aside, re-judged, and only the rename winner retries the create.
  - Any other I/O error skips `claim-failed`.
  - The lock is removed after the marker write, and only by its owner (a compare-and-delete on the token), so a taken-over pass never deletes its successor's claim.
  - Until every installed build upgrades, an older reconciler still takes over by age alone and releases unconditionally, so a mixed-version pair keeps the old race.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js tests/bin-lib/reconcile/post-merge.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/merge-mode.md docs/reconcile-checks.md tests/wrap-up-merge-mode-conformance.test.js
git commit -m "Describe the liveness-checked post-merge claim — merge-mode and reconcile-checks prose (refs #4797)"
```

Waived AC3.1: `npm test` passing is verified by `/claude-tweaks:build`'s Common Step 5 final verification and the `/claude-tweaks:test` gate, not by a plan task.
