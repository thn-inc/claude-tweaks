# Post-merge claim liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reconcile post-merge pass's per-run `.post-merge.lock` claim reclaim only a dead holder, an idle one, or an ownerless stale one. Keep a live holder's claim fresh with a heartbeat on every `gh` call, and stop a holder whose claim was taken over before its next `gh` call. Release only when the caller still owns the claim.

**Architecture:** Keep the existing exclusive-create file claim and its atomic rename-aside takeover in `plugin/bin/lib/reconcile/post-merge.js`, and write an owner token (`{pid}-{random}`) into the claim file. A token-carrying claim is judged by holder liveness (`plugin/bin/lib/file-lock.js`'s `isAlive`, newly exported) plus an idle backstop (`CLAIM_MAX_IDLE_MS`). An ownerless claim keeps the `CLAIM_STALE_MS` mtime rule. `processCandidate` wraps the run's one shared `gh` function in a compare-and-refresh guard. Before each call the guard checks that the claim still carries this holder's token and refreshes its mtime. If the claim was taken over, the guard refuses that call and every later one. Once that happens, `processRun` writes nothing more and returns `in-flight`. `releaseClaim` becomes a compare-and-delete on the caller's token.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T224014-record-4797/work/4797-spec.md`. Its `## Decisions` carries three rounds of answers; round 3 (Q1 Reading B, Q2 stop in the heartbeat, Q3 5 minutes stated honestly) supersedes this file's previous version.

## Decision: the idle backstop and the heartbeat stop

- **Heartbeat site.** Every Step 4.0 and Step 4.0b `gh` call goes through the one function `setupContext` builds, `ctx.timedGh` (`deps.gh` in tests). `processRun` passes it to `closing-links.js`'s `closingLinks` as `deps.gh` and to `closeBelowFloorParents` as `gh`. `parent-gate.js` routes every read through `ghCaller(gh)`, including its in-process `fetch-sub-issues.js` runner (`runner: (args) => caller.call(args)`). Wrapping that one function in `processCandidate`, after the claim is taken, covers every current and future loop in both steps. The Decisions require that placement.
- **Stop (round 3 Q2).** The wrapper is a compare-and-refresh. If the claim no longer carries our token (a successor wrote its own, the file is gone, or it cannot be read), the wrapper sets a sticky `lost` flag and throws without calling `gh`. Every later call throws the same way. `closing-links.js` and `below-floor-parent-close.js` already catch a throwing `gh` and turn it into an exit code or a per-parent `gh-failed` skip, so neither module changes. `post-merge.js` closes the remaining side effects itself:
  - the `appendDecision` it hands `closingLinks` drops every line once `lost` is set, so its `Closing links (post-merge) (degraded)` SKIP never lands in a run the successor now owns;
  - `processRun` returns `in-flight` straight after Step 4.0 once `lost` is set, so Step 4.0b never starts;
  - `processRun`'s one write helper writes no marker, no attempt line and no SKIP marker once `lost` is set.
- **Value (round 3 Q3).** `CLAIM_MAX_IDLE_MS = Math.max(5 * 60 * 1000, 2.5 * GH_TIMEOUT_CEILING_MS)` = 300 000 ms today. `GH_TIMEOUT_CEILING_MS` is the `gh-timeout-ms` schema `max`, read from `POLICY_KEYS` (60 000 ms). In this path a `gh` call runs once and is never retried: `timedGh` is one `execFileSyncTimed` with `timeout: GH_TIMEOUT_MS`. 2.5 × the ceiling (150 s, `background-lock.js`'s `STALE_LOCK_MS` / `BACKGROUND_BUDGET_MS` ratio) is the floor. It is rounded up to 5 minutes to cover non-`gh` work between calls, because reclaiming a live holder by mistake costs more than reclaiming a dead one a few minutes late. If the ceiling is ever raised, the backstop follows it.
- **Limit (non-`gh` stretches).** Work between `gh` calls is not heartbeated. In this path that work is `closing-links.js`'s settle sleep (`POLL_STEP_MS`, 3 s, between re-reads that are themselves `gh` calls), JSON parsing, and the `decisions.md` append, each seconds at most. None approaches the backstop, so no stretch needs its own refresh.
- **Residual windows, stated rather than fixed.**
  - A `gh` call already in flight when the holder is suspended completes on wake: the guard decides before a call, not during it.
  - Between the guard's read and its call, a successor's takeover can still land; the next call is then refused.
  - A parent Step 4.0b closed before the takeover stays closed. The successor's run finds it already `CLOSED`, a no-op, as `docs/reconcile-checks.md` already states.
- A claim with no readable owner keeps the `CLAIM_STALE_MS` (10 min) reclaim, and release still requires the owner token. The value and this derivation go in a code comment next to the constant, and in the spec's `## Decisions` (Task 1, Step 3).

## Global Constraints

- `CLAIM_STALE_MS` stays `10 * 60 * 1000` and `CLAIM_FILENAME` stays `'.post-merge.lock'`, a plain file created `wx`. Older installed reconcilers create and respect this same file concurrently with the new code, so the lock's path and file shape must not change.
- A claim file with no readable owner keeps the old rule: in flight under `CLAIM_STALE_MS`, reclaimable at or past it. An empty file is ownerless. An older reconciler writes one, and a new one is momentarily empty between its create and its token write.
- `takeClaim`'s failure reasons stay exactly `in-flight` and `claim-failed`; archive deferral and `classifyEntry` route on them. A taken-over holder's entry reuses `in-flight`: no new reason word, so `classifyEntry`, `RERUN_REASONS`, the six-reason deferral list and `merge-mode.md`'s verdict routing need no change.
- A `deps.takeClaim` fake that returns `{ ok: true }` with no token must keep working. For a falsy token, heartbeat and release are no-ops that never throw, and the `gh` guard passes every call straight through.
- No new dependency. Never block or poll.
- Every `fs` call inside `takeClaim`, `heartbeatClaim` and `releaseClaim` goes through the `fsApi` parameter. The `R3` tests inject racing wrappers through it.
- Commit subjects use `{Verb} {what} — {detail}` and reference the record as `refs #4797`, never `closes`/`fixes`.
- Governing project skill, quoted verbatim from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`: "Decide the shape before writing the file, and reuse `withLock` rather than hand-rolling a second mutex." This plan keeps the existing hand-rolled claim, so the call site states why `file-lock.js` cannot serve (Task 1). That is also the record's second Deliverable. `caching-and-locks.md`'s `file-lock.js` bullet covers holding `file-lock.js` across a long call, which this plan does not do. `prose-code-twin-pin`'s "*A number the prose states* is an exported constant" governs `merge-mode.md`'s "10-minute stale window (`CLAIM_STALE_MS`)", which `tests/wrap-up-merge-mode-conformance.test.js` already pins and Task 3 keeps. `bin-source-scan-conformance` and `driver-skill-outcome-taxonomy` cite `post-merge.js` and its test only for the closing-links producer-coverage test and `classifyEntry`, neither of which changes behavior here.
- Source-scan lint: no `fs.existsSync`/`fs.realpathSync` in `plugin/bin/` (`tests/path-guard-conformance.test.js`). The new code needs neither. Tests may use them.
- Locate code by function and constant name, not line number.

## Review Focus

- A live, refreshing holder past `CLAIM_STALE_MS` total hold time reads `in-flight`, and its claim file is byte-for-byte unchanged (AC1.1). This is tested at unit level and through `postMerge` (Task 1).
- A holder whose claim was taken over mid-run never makes another `gh` call. It writes no marker, no attempt line and no closing-links line, deletes nothing, and returns `in-flight`, deferred (Task 2). If it resumes and releases, the release leaves the successor's claim in place (AC2.1, Task 1). Each owner check has a test that only that check decides.
- A dead holder's claim is reclaimed at once, even with a fresh mtime. Only the liveness check decides that test (Task 1).
- Reused pid: a claim whose pid reads alive but has been idle longer than `CLAIM_MAX_IDLE_MS` is reclaimed, and one just under it is not. Both edges are tested (Task 1).
- Mixed-version interop: an empty (old-format) claim is still honored for `CLAIM_STALE_MS`. The existing tests `claim: a fresh lock file means in-flight…`, `claim: a lock 11 minutes old is taken over…` and the three `R3` tests write `''`, so they pin this unchanged. The reverse direction cannot be fixed here: an older reconciler still takes over a claim idle past `CLAIM_STALE_MS` by mtime alone, and still releases unconditionally. The heartbeat narrows that race, because a progressing new holder's mtime stays fresh to an old reader too. The call-site comment and `docs/reconcile-checks.md` say so (Tasks 1 and 3).

---

### Task 1: Owner-token, liveness-checked claim primitives in post-merge.js

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/file-lock.js` (add `isAlive` to `module.exports`, nothing else)
- Modify: `plugin/bin/lib/reconcile/post-merge.js` (constants beside `CLAIM_STALE_MS`, `takeClaim`, new `heartbeatClaim`, `releaseClaim`, the `releaseClaim` call in `processCandidate`'s `finally`, the `takeClaim` and `classifyEntry` comments, `module.exports`)
- Modify: `.claude-tweaks/pipelines/2026-11-03T224014-record-4797/work/4797-spec.md` (record the chosen value under `## Decisions`)
- Test: `tests/bin-lib/reconcile/post-merge.test.js`
- Test: `tests/bin-lib/file-lock.test.js`

**Interfaces:**
- Consumes: `require('../file-lock').isAlive(pid: number) -> boolean`, which already exists and is only being exported. `require('../policy-schema').POLICY_KEYS`: `post-merge.js` already requires `../policy-schema` for `resolvePolicyKeys`, so add `POLICY_KEYS` to that destructure.
- Produces (all exported from `post-merge.js`):
  - `takeClaim(runDir: string, nowMs: number, fsApi = fs, { isAlive = pidAlive } = {}) -> { ok: true, token: string } | { ok: false, reason: 'in-flight' | 'claim-failed' }`
  - `heartbeatClaim(runDir: string, token: string | undefined, nowMs: number, fsApi = fs) -> boolean`. Returns `true` when the lock's content `=== token`, which means we still own it, and then sets its atime and mtime to `nowMs` (a `utimesSync` failure is swallowed; ownership is still `true`). A falsy token, a mismatched, missing or unreadable file returns `false`. Never throws.
  - `releaseClaim(runDir: string, token: string | undefined, fsApi = fs) -> void`. Unlinks the lock only when its content `=== token`. A falsy token is a no-op. Never throws.
  - `CLAIM_MAX_IDLE_MS` (300 000) and `GH_TIMEOUT_CEILING_MS` (60 000).

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/reconcile/post-merge.test.js`:

- Add `heartbeatClaim, releaseClaim, CLAIM_MAX_IDLE_MS, GH_TIMEOUT_CEILING_MS` to the top-level destructured require of `post-merge`.
- Return-shape widening: in `R3 two takeovers: the taker that loses the rename…`, change `assert.deepEqual(winner, { ok: true });` to `assert.equal(winner.ok, true);`. It is the only test that `deepEqual`s a successful `takeClaim` result (grep `deepEqual(.*{ ok: true }` over `tests/` shows that one hit).
- After `takeClaim: a non-EEXIST create error is claim-failed`, add a helper `setMtime(dir, ms)` that runs `fs.utimesSync(lockOf(dir), ms / 1000, ms / 1000)` and a helper `mtimeOf(dir)` returning `fs.statSync(lockOf(dir)).mtimeMs`. Then append:

```js
test('AC1.1 takeClaim: a live holder that took the claim past CLAIM_STALE_MS ago and refreshes it is in-flight, its claim untouched', () => {
  const dir = addRun(mainCheckout(), '2026-10-30T090000-spec-1');
  const takenAt = NOW - CLAIM_STALE_MS - 60 * 1000;
  const holder = takeClaim(dir, takenAt);
  assert.equal(holder.ok, true);
  setMtime(dir, takenAt); // the claim's create time; without the refresh below it is idle and taken over
  assert.equal(heartbeatClaim(dir, holder.token, NOW - 60 * 1000), true);
  assert.deepEqual(takeClaim(dir, NOW), { ok: false, reason: 'in-flight' });
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), holder.token);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.stale-')), []);
});

test('AC1.1 postMerge: a live, refreshing holder past CLAIM_STALE_MS skips in-flight, defers, and calls no fake', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const takenAt = NOW - CLAIM_STALE_MS - 60 * 1000;
  const holder = takeClaim(dir, takenAt);
  setMtime(dir, takenAt);
  heartbeatClaim(dir, holder.token, NOW - 60 * 1000);
  const links = fakeClosingLinks(ENVELOPE);
  const r = await run(root, { prs: { 11: merged() }, links, close: fakeCloseParents() });
  assert.deepEqual(r.entries, [{ runDir: dir, pr: 11, action: 'skipped', reason: 'in-flight' }]);
  assert.deepEqual(r.deferred, [dir]);
  assert.equal(links.calls.length, 0);
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), holder.token);
});

test('takeClaim: a dead holder is reclaimed at once, fresh mtime or not, and the new claim carries our token', () => {
  const dir = addRun(mainCheckout(), '2026-10-30T090000-spec-1');
  fs.writeFileSync(lockOf(dir), '424242-dead');
  setMtime(dir, NOW - 1000);
  const r = takeClaim(dir, NOW, fs, { isAlive: (pid) => pid !== 424242 });
  assert.equal(r.ok, true);
  assert.match(r.token, new RegExp(`^${process.pid}-`));
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), r.token);
});

test('takeClaim: a live holder idle just under CLAIM_MAX_IDLE_MS is still in-flight', () => {
  const dir = addRun(mainCheckout(), '2026-10-30T090000-spec-1');
  const held = `${process.pid}-held`;
  fs.writeFileSync(lockOf(dir), held);
  setMtime(dir, NOW - CLAIM_MAX_IDLE_MS + 60 * 1000);
  assert.deepEqual(takeClaim(dir, NOW), { ok: false, reason: 'in-flight' });
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), held);
});

test('takeClaim: a live-reading holder idle past CLAIM_MAX_IDLE_MS (a reused pid) is reclaimed', () => {
  const dir = addRun(mainCheckout(), '2026-10-30T090000-spec-1');
  fs.writeFileSync(lockOf(dir), `${process.pid}-held`);
  setMtime(dir, NOW - CLAIM_MAX_IDLE_MS - 60 * 1000);
  const r = takeClaim(dir, NOW);
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), r.token);
});

test('CLAIM_MAX_IDLE_MS is 5 minutes, at least 2.5 x the gh-timeout-ms schema ceiling', () => {
  const { POLICY_KEYS } = require('../../../plugin/bin/lib/policy-schema');
  assert.equal(GH_TIMEOUT_CEILING_MS, POLICY_KEYS.find((k) => k.key === 'gh-timeout-ms').max);
  assert.equal(GH_TIMEOUT_CEILING_MS, 60 * 1000);
  assert.ok(CLAIM_MAX_IDLE_MS >= 2.5 * GH_TIMEOUT_CEILING_MS);
  assert.equal(CLAIM_MAX_IDLE_MS, 5 * 60 * 1000);
});

test('heartbeatClaim: refreshes only a claim still carrying our token', () => {
  const dir = addRun(mainCheckout(), '2026-10-30T090000-spec-1');
  const mine = takeClaim(dir, NOW);
  const old = NOW - 4 * 60 * 1000;
  setMtime(dir, old);
  assert.equal(heartbeatClaim(dir, mine.token, NOW), true);
  assert.ok(Math.abs(mtimeOf(dir) - NOW) < 1000, 'our claim was refreshed');
  fs.writeFileSync(lockOf(dir), `${process.pid}-successor`);
  setMtime(dir, old);
  assert.equal(heartbeatClaim(dir, mine.token, NOW), false);
  assert.ok(Math.abs(mtimeOf(dir) - old) < 1000, "the successor's mtime is untouched");
  assert.equal(heartbeatClaim(dir, undefined, NOW), false);
  fs.unlinkSync(lockOf(dir));
  assert.equal(heartbeatClaim(dir, mine.token, NOW), false, 'a missing claim is not ours');
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

In `tests/bin-lib/file-lock.test.js`, add `isAlive` to the `require('../../plugin/bin/lib/file-lock')` destructure and append:

```js
test('isAlive: this process is alive; a non-positive or non-integer pid is not', () => {
  assert.equal(isAlive(process.pid), true);
  assert.equal(isAlive(0), false);
  assert.equal(isAlive(-1), false);
  assert.equal(isAlive(1.5), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js tests/bin-lib/file-lock.test.js`
Expected: FAIL after Step 1. `heartbeatClaim`, `releaseClaim` (as an export), `CLAIM_MAX_IDLE_MS`, `GH_TIMEOUT_CEILING_MS` and `isAlive` (as an export) are undefined, and `r.token` is undefined.

- [ ] **Step 3: Implement**

`file-lock.js`: change `module.exports` to `{ acquireLock, releaseLock, withLock, isAlive }`. Change nothing else.

`post-merge.js`:

- Requires: `const { isAlive: pidAlive } = require('../file-lock');`, and add `POLICY_KEYS` to the existing `require('../policy-schema')` destructure.
- Constants, next to `CLAIM_STALE_MS`:
  - `const GH_TIMEOUT_CEILING_MS = POLICY_KEYS.find((k) => k.key === 'gh-timeout-ms').max;`
  - `const CLAIM_MAX_IDLE_MS = Math.max(5 * 60 * 1000, 2.5 * GH_TIMEOUT_CEILING_MS);`
  - A comment above them carries the Decision section's "Value" bullet in a few lines:
    - the holder refreshes the claim before every `gh` call, so its idle time is at most one call plus seconds of non-`gh` work;
    - a call here runs once, with no retry, bounded by the 60 s schema ceiling;
    - the backstop is at least 2.5× that ceiling (150 s, `background-lock.js`'s ratio), rounded up to 5 minutes, because reclaiming a live holder costs more than reclaiming a dead one late;
    - a live-reading pid idle past it is a reused pid or a suspended holder.
- Staleness, as an internal pure helper `claimIsStale(content: string, mtimeMs: number, nowMs: number, isAlive) -> boolean`:
  - The owner pid is `Number(m[1])` when `content` matches `/^(\d+)-/`. Otherwise there is no owner.
  - No owner: stale iff `nowMs - mtimeMs >= CLAIM_STALE_MS` (today's rule, unchanged).
  - Owner: stale iff `!isAlive(pid) || nowMs - mtimeMs > CLAIM_MAX_IDLE_MS`.
- `takeClaim`:
  - Create: `openSync(lock, 'wx')`, then `writeSync(fd, token)` with token `` `${process.pid}-${Math.random().toString(36).slice(2)}` `` (`file-lock.js`'s own token shape), then `closeSync`. If the write throws: close, unlink the lock, and return `claim-failed`.
  - On `EEXIST`: read the content (`readFileSync(lock, 'utf8')`), then the mtime (`statSync`). `ENOENT` on either means `in-flight`; any other error means `claim-failed`. If not stale, return `in-flight`.
  - Otherwise rename aside exactly as today. Then re-judge the aside's own content and mtime with the same helper, replacing today's mtime-only re-check; an unreadable aside keeps the first reading. If the aside is not stale, link it back, unlink the aside and return `in-flight`. Otherwise unlink the aside and retry the create once, with the same `EEXIST` → `in-flight` mapping as today.
- Restate the "Residual window" comment in the link-back branch under the new rule. The holder may release between our rename and this link. The link then re-creates a claim that carries the holder's token but that nobody holds. The next pass judges that token's pid. Once the holder process has exited, it reads dead and is taken over at once. While the process still runs, nothing refreshes the orphan, so it is taken over once idle past `CLAIM_MAX_IDLE_MS`. An ownerless aside that is linked back keeps the `CLAIM_STALE_MS` rule.
- `heartbeatClaim` and `releaseClaim`, per the Interfaces block. `releaseClaim` reads the content and unlinks only on `=== token`. Comment the read-then-unlink gap: only a takeover could fill it, and a holder that refreshed moments ago is neither dead nor idle.
- `processCandidate`'s `finally`: `releaseClaim(dir, claim.token)`.
- Rewrite the comment above `takeClaim`. It must:
  - State the owner-token, liveness and idle-backstop rule, and that the holder refreshes the claim before every `gh` call (Task 2 wires that).
  - State why `file-lock.js`'s `acquireLock` cannot serve here:
    - (a) Its reclaim is rm-then-mkdir, so two reclaimers of one dead lock can both win. The rename-aside takeover is what the `R3` tests pin.
    - (b) It polls up to `LOCK_WAIT_MS` and returns `null` both for "held" and for an I/O error. This pass needs a non-blocking take with distinct `in-flight`/`claim-failed` reasons that drive archive deferral.
    - (c) Its lock is a directory with a 5 s ownerless fallback. Older installed reconcilers create and respect `.post-merge.lock` as a plain empty file, so that fallback would steal their live claim after 5 seconds.
    - (d) It has no refresh, so a long hold cannot stay fresh to a reader that judges by age.
  - Close with: hence only its `isAlive` probe is reused.
  - Add the interop note: until every installed build upgrades, an older reconciler still takes over a claim idle past `CLAIM_STALE_MS` by mtime alone and releases unconditionally. The refresh keeps a progressing holder fresh to it too.
- `classifyEntry`'s comment currently says "so a re-run past CLAIM_STALE_MS recovers a dead one". Change it to: a re-run takes over a dead holder's claim at once, and a claim naming no holder past `CLAIM_STALE_MS`.
- Add `heartbeatClaim, releaseClaim, CLAIM_MAX_IDLE_MS, GH_TIMEOUT_CEILING_MS` to `module.exports`.

Spec: append to `## Decisions` in `.claude-tweaks/pipelines/2026-11-03T224014-record-4797/work/4797-spec.md` one bullet: `**Chosen value:** CLAIM_MAX_IDLE_MS = Math.max(5 min, 2.5 × GH_TIMEOUT_CEILING_MS) = 5 min today, GH_TIMEOUT_CEILING_MS being the gh-timeout-ms schema max (60 s) read from POLICY_KEYS. This corrects the round-2 Sizing bullet's "(120 s)": a gh call on this path runs once, with no retry.` Follow it with one sentence: the heartbeat wraps the shared `timedGh` in `processCandidate`, so every Step 4.0/4.0b `gh` call refreshes the claim, and the only non-`gh` stretches (the 3 s settle sleep, parsing, the `decisions.md` append) are seconds long.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js tests/bin-lib/file-lock.test.js tests/post-merge-run-cli.test.js`
Expected: PASS. Every test passes, including the existing `R3`, `claim:` and `postMergeOne` tests.

Guard discrimination: delete each guard once, re-run, and confirm the named test turns red:
- `heartbeatClaim`'s `=== token` compare: `heartbeatClaim: refreshes only a claim still carrying our token`.
- `releaseClaim`'s compare: `AC2.1 releaseClaim`.
- `!isAlive(pid)`: `takeClaim: a dead holder is reclaimed at once`.
- The `CLAIM_MAX_IDLE_MS` clause: `a live-reading holder idle past CLAIM_MAX_IDLE_MS (a reused pid) is reclaimed`.
- Replacing `Math.max(…)` with `2.5 * GH_TIMEOUT_CEILING_MS`: `CLAIM_MAX_IDLE_MS is 5 minutes…`.
- Restoring a token-less `{ ok: true }`: `AC2.1 releaseClaim`.
- Removing the `heartbeatClaim` call from the `AC1.1 takeClaim` test (the test, not the code): that test turns red, because the claim then reads 11 minutes idle. This proves the test exercises the refresh rather than a fresh create mtime.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/file-lock.js plugin/bin/lib/reconcile/post-merge.js tests/bin-lib/reconcile/post-merge.test.js tests/bin-lib/file-lock.test.js .claude-tweaks/pipelines/2026-11-03T224014-record-4797/work/4797-spec.md
git commit -m "Check post-merge claim holder liveness — owner token, idle backstop, compare-and-delete release (refs #4797)"
```

### Task 2: Heartbeat and taken-over stop on the shared gh path

**Role:** integration
**Review risk:** high (touches the claim release path and the pass's write decisions)

**Files:**
- Modify: `plugin/bin/lib/reconcile/post-merge.js` (`processCandidate`'s claim block and its `defer`; `processRun`'s parameters, its `runClosingLinks` deps, its post-Step-4.0 return and its `write` helper; `module.exports`)
- Test: `tests/bin-lib/reconcile/post-merge.test.js`

**Interfaces:**
- Consumes: Task 1's `takeClaim` (returns `token`), `heartbeatClaim`, `releaseClaim`. `require('../log-decision/append').appendEntry`: add it to the existing `append` destructure. It is `closing-links.js`'s own default `appendDecision` target (`appendDecision: ({ runDir, section, entry }) => appendEntry({ runDir, section, entry })`).
- Produces:
  - `CLAIM_LOST_DETAIL` (exported string): `'claim taken over by another pass; stopped before the next gh call'`.
  - `processRun({ …, claimLost = () => false, appendDecision = appendEntry })`.
  - A taken-over run's entry is `{ runDir, pr, action: 'skipped', reason: 'in-flight', detail: CLAIM_LOST_DETAIL }`, plus `parentsClosed: n` when Step 4.0b had already closed `n > 0` parents. It is deferred.

- [ ] **Step 1: Write the failing tests**

Add `CLAIM_LOST_DETAIL` to the top-level destructured require. Append after Task 1's tests:

```js
test('heartbeat: every gh call through the shared path refreshes the held claim, in Step 4.0 and in Step 4.0b', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const seen = [];
  const probe = (gh, label) => {
    setMtime(dir, NOW - 4 * 60 * 1000);
    gh(['api', 'user']);
    seen.push([label, mtimeOf(dir)]);
  };
  const links = (argv, d) => { probe(d.gh, '4.0'); return { code: 0, envelope: ENVELOPE }; };
  const close = (args) => { probe(args.gh, '4.0b'); return { closed: [], skipped: [] }; };
  const r = await run(root, { prs: { 11: merged() }, links, close });
  assert.equal(r.entries[0].action, 'ran');
  assert.deepEqual(seen.map(([label]) => label), ['4.0', '4.0b']);
  for (const [label, m] of seen) assert.ok(Math.abs(m - NOW) < 1000, `the ${label} gh call refreshed the claim`);
  assert.ok(!fs.existsSync(lockOf(dir)), 'the owner release removed the claim');
});

test('Q2: a holder whose claim is taken over during Step 4.0 makes no further gh call, writes nothing, and skips in-flight, deferred', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const ghCalls = [];
  const successor = `${process.pid}-successor`;
  const close = fakeCloseParents();
  const links = (opts, d) => {
    d.gh(['pr', 'view', '11']);
    fs.writeFileSync(lockOf(dir), successor); // a successor takes the claim over
    let refused = null;
    try { d.gh(['issue', 'close', '101']); } catch (e) { refused = e; }
    assert.ok(refused, 'the call after the takeover throws');
    assert.throws(() => d.gh(['issue', 'view', '102']), 'every later call throws too');
    d.appendDecision({ runDir: opts.run, entry: '- SKIP 00:00:00 — Closing links (post-merge) (degraded): x. Reversibility: n/a.' });
    return { code: 5, envelope: null };
  };
  const r = await run(root, { prs: { 11: merged() }, links, close, extra: { gh: (args) => { ghCalls.push(args.join(' ')); return '{}'; } } });
  assert.deepEqual(ghCalls, ['pr view 11'], 'only the call made before the takeover ran');
  assert.deepEqual(r.entries, [{ runDir: dir, pr: 11, action: 'skipped', reason: 'in-flight', detail: CLAIM_LOST_DETAIL }]);
  assert.deepEqual(r.deferred, [dir]);
  assert.equal(close.calls.length, 0, 'Step 4.0b never starts');
  assert.equal(decisionsOf(dir), '', 'no closing-links line, no attempt line, no marker');
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), successor, 'the successor claim stays');
});

test('Q2: a takeover during Step 4.0b stops the pass before its marker; the parents it closed are reported', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const successor = `${process.pid}-successor`;
  const close = (args) => {
    args.gh(['issue', 'close', '100']);
    fs.writeFileSync(lockOf(dir), successor);
    assert.throws(() => args.gh(['issue', 'close', '200']));
    return { closed: [{ parent: 100, maxTier: 'low' }], skipped: [{ parent: 200, reason: 'gh-failed', detail: CLAIM_LOST_DETAIL }] };
  };
  const r = await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close });
  assert.deepEqual(r.entries, [{ runDir: dir, pr: 11, action: 'skipped', reason: 'in-flight', detail: CLAIM_LOST_DETAIL, parentsClosed: 1 }]);
  assert.deepEqual(r.deferred, [dir]);
  assert.equal(decisionsOf(dir), '', 'no parent line, no marker');
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), successor);
});

test('a claim with no token (a takeClaim fake) never refuses a gh call', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const ghCalls = [];
  const links = (opts, d) => { d.gh(['pr', 'view', '11']); d.gh(['issue', 'view', '101']); return { code: 0, envelope: ENVELOPE }; };
  const r = await run(root, {
    prs: { 11: merged() }, links, close: fakeCloseParents(),
    extra: { takeClaim: () => ({ ok: true }), gh: (args) => { ghCalls.push(args.join(' ')); return '{}'; } },
  });
  assert.equal(r.entries[0].action, 'ran');
  assert.deepEqual(ghCalls, ['pr view 11', 'issue view 101']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js`
Expected: FAIL after Step 1. `CLAIM_LOST_DETAIL` is undefined, no gh call refreshes the claim, and a taken-over holder still runs its calls and writes its marker.

- [ ] **Step 3: Implement**

- `processCandidate`, once `claim.ok`:
  - `const guard = { lost: false };`
  - `const ownsClaim = () => { if (!guard.lost && claim.token && !heartbeatClaim(dir, claim.token, now())) guard.lost = true; return !guard.lost; };`. A falsy token never loses: a `deps.takeClaim` fake has no claim to check.
  - `const runCtx = { ...ctx, timedGh: (args, input) => { if (!ownsClaim()) throw Object.assign(new Error(CLAIM_LOST_DETAIL), { code: 'ECLAIMLOST' }); return ctx.timedGh(args, input); } };`
  - Call `processRun({ dir, pr, ...runCtx, claimLost: () => guard.lost, now, params, retryHint, includeRecords })`.
  - `defer: entry.reason === TRANSIENT_REASON || entry.reason === 'in-flight'`.
  - One comment: the heartbeat lives on the shared `gh` function, so every loop in Steps 4.0 and 4.0b is covered and a taken-over holder stops before its next call. State the in-flight-call residual from this plan's Decision section in one sentence.
- `processRun`:
  - New parameters `claimLost = () => false` and `appendDecision = appendEntry`.
  - Add to `runClosingLinks`'s deps: `appendDecision: (args) => { if (!claimLost()) appendDecision(args); }`.
  - Right after `runClosingLinks` returns: `if (claimLost()) return lostEntry(0);`, where `lostEntry(parentsClosed)` returns the Interfaces block's entry.
  - In `write(items, ran, parentsClosed = 0, extra = {})`, before `writeEntries`: `if (claimLost()) return lostEntry(parentsClosed);`. The parent path already passes `closed.length` as `parentsClosed`. The attempt-line and SKIP-marker paths pass none, so they report 0.
- Add `CLAIM_LOST_DETAIL` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js tests/post-merge-run-cli.test.js tests/post-merge-parent-left-open-e2e.test.js tests/reconcile.test.js`
Expected: PASS.

Guard discrimination: delete each guard once, re-run, and confirm the named test turns red:
- The wrapper's `heartbeatClaim` call (keep the pass-through): `heartbeat: every gh call…` and both `Q2` tests.
- Not separately discriminable, by design: `ownsClaim`'s `!guard.lost &&` short-circuit only skips re-reading a claim already known lost. A re-read gives the same answer, because no later writer can restore our token. The flag itself is what `claimLost` reads, and the three guards below pin it.
- The `appendDecision` guard: the first `Q2` test's `decisionsOf(dir) === ''`.
- The post-Step-4.0 `claimLost()` return: the first `Q2` test's `close.calls.length === 0`.
- The `write` guard: the second `Q2` test's `decisionsOf(dir) === ''`.
- The `in-flight` defer: both `Q2` tests' `r.deferred`.
- The `claim.token &&` clause: `a claim with no token…`.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/post-merge.js tests/bin-lib/reconcile/post-merge.test.js
git commit -m "Heartbeat the post-merge claim on every gh call — a taken-over holder stops before its next call and writes nothing (refs #4797)"
```

### Task 3: Sweep the prose that describes the old age-only claim

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/merge-mode.md` (the `verdict` `in-flight` bullet; 14,466 B against the 52,500 B rail, ample headroom)
- Modify: `docs/reconcile-checks.md` (the *Per-run claim file* bullet under "Two concurrency guards")
- Modify: `docs/journeys/merge-a-parked-unattended-pr-3784.md` (the **In flight.** bullet; no test pins this sentence)
- Test: `tests/wrap-up-merge-mode-conformance.test.js` (the `'already-in-flight-archived'` pin)

No-change classification of the sweep's other hits: `docs/plugin-structure.md`'s `post-merge-run.js` row, `plugin/bin/post-merge-run.js`'s header and `merge-mode.md` line 31 describe `in-flight` as "another process holds the run's claim". That stays true for a taken-over holder, whose successor now holds it.

**Interfaces:**
- Consumes the rule from Tasks 1 and 2:
  - A dead holder is taken over at once.
  - A live holder is taken over only after it has not refreshed its claim for `CLAIM_MAX_IDLE_MS`.
  - A claim naming no holder is taken over past `CLAIM_STALE_MS` (10 min).
  - A taken-over holder stops before its next `gh` call.
  - Release is owner-checked.
- Produces: nothing code-facing.

Sweep grep, already run for this plan. Its hits are this task's file list, the no-change rows above, unrelated claim-registry prose, and `post-merge.js`'s own comments, which are Tasks 1 and 2's. Run from the worktree root: `git grep -n -i -e "post-merge.lock" -e "CLAIM_STALE_MS" -e "per-run claim" -e "stale window" -e "post-merge claim" -e "run's claim" -- plugin docs .claude/skills ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'`. `console-execute.js`'s `RECLAIM_STALE_MS` is an unrelated constant.

- [ ] **Step 1: Update the conformance pin `'already-in-flight-archived'` in `tests/wrap-up-merge-mode-conformance.test.js`**

Replace the regex with one matching this exact sentence tail, regex-escaped as the neighbouring entries are:

`` `next` `rerun-after-stale-claim` marks an archived run (the adopted path is under `archive/`), whose holder is another merge-mode invocation, because the reconciler never walks `archive/`: the line also names `/claude-tweaks:wrap-up #{n} merge` again, in case that holder died — a re-run takes over a dead holder's claim at once, and a claim naming no holder once it is past its 10-minute stale window (`CLAIM_STALE_MS`) ``

The separate `merge-mode.md states the claim stale window as post-merge.js has it` test must keep matching `` past its (\d+)-minute stale window \(`CLAIM_STALE_MS`\) `` unchanged.

- [ ] **Step 2: Run the conformance test to verify it fails**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js`
Expected: FAIL after Step 1. `merge-mode.md` still carries the old "again once the claim is past its 10-minute stale window" wording.

- [ ] **Step 3: Rewrite the prose**

- `plugin/skills/wrap-up/merge-mode.md`, the `verdict` `in-flight` bullet: replace the clause from `the line also names` to `in case that holder died.` with the Step 1 tail, ending with a full stop.
- `docs/journeys/merge-a-parked-unattended-pr-3784.md`, the **In flight.** bullet: replace "once the claim is past its 10-minute stale window." with "in case that holder died: a re-run takes over a dead holder's claim at once, and a claim naming no holder once it is past its 10-minute stale window."
- `docs/reconcile-checks.md`, the *Per-run claim file* bullet. Keep its first two sentences (the `wx` create; background vs inline passes) and its last sentence (the dotfile name). Replace the middle with these facts:
  - The claim file holds its owner's `{pid}-{token}`.
  - While a run holds the claim, every `gh` call it makes first checks that the claim still names it and refreshes the claim's mtime (the heartbeat, on the shared `gh` function).
  - A claim whose holder pid is alive skips `in-flight` unless it has gone unrefreshed for `CLAIM_MAX_IDLE_MS` (a reused pid or a suspended holder; the derivation sits beside the constant). Name the constant only, never its value: no test pins a number in this doc.
  - A dead holder's claim is taken over at once.
  - A claim naming no holder (an older reconciler's empty file) keeps the `CLAIM_STALE_MS` (10 minutes) rule.
  - A takeover is still atomic: renamed aside, re-judged, and only the rename winner retries the create. Any other I/O error skips `claim-failed`.
  - A holder whose claim was taken over refuses its next `gh` call and every later one, writes no marker, attempt line or closing-links line, and skips `in-flight`, deferred. A call already in flight when it was suspended still completes.
  - The lock is removed after the marker write, and only by its owner (a compare-and-delete on the token), so a taken-over pass never deletes its successor's claim.
  - Until every installed build upgrades, an older reconciler still takes over by age alone and releases unconditionally, so a mixed-version pair keeps the old race for a claim idle past `CLAIM_STALE_MS`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js tests/bin-lib/reconcile/post-merge.test.js`
Expected: PASS.

Then re-run the sweep grep from this task's header. Expected: no hit still says that a live claim is judged by mtime alone, or that a re-run waits out the stale window for a dead holder. Absence control: the same grep against the pre-change base (`git grep -n -i -e "stale window" {base} -- plugin/skills/wrap-up/merge-mode.md docs/journeys/merge-a-parked-unattended-pr-3784.md`) matches both files' old sentences. After the change, it matches only the new "naming no holder" clause.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/merge-mode.md docs/reconcile-checks.md docs/journeys/merge-a-parked-unattended-pr-3784.md tests/wrap-up-merge-mode-conformance.test.js
git commit -m "Describe the liveness-checked, heartbeated post-merge claim — merge-mode, journey and reconcile-checks prose (refs #4797)"
```

Waived AC3.1: `npm test` passing is verified by `/claude-tweaks:build`'s Common Step 5 final verification and the `/claude-tweaks:test` gate, not by a plan task.

Waived `plugin/bin/lib/file-lock.js` as a reuse target beyond `isAlive`: Task 1's call-site comment records why `acquireLock`/`withLock` cannot serve (the record's second Deliverable).
