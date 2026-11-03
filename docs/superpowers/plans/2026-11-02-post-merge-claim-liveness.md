# Post-merge claim liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reconcile post-merge pass's per-run `.post-merge.lock` claim reclaim only a dead holder, an idle one, or an ownerless stale one, keep a live holder's claim fresh with a heartbeat on every `gh` call, and release only when the caller still owns the claim. A stalled-but-live pass can then no longer be taken over, and a pass whose claim was taken over can no longer delete its successor's claim.

**Architecture:** Keep the existing exclusive-create file claim and its atomic rename-aside takeover in `plugin/bin/lib/reconcile/post-merge.js`. Write an owner token (`{pid}-{random}`) into the claim file. Judge a token-carrying claim by holder liveness (`plugin/bin/lib/file-lock.js`'s `isAlive`, newly exported) plus an idle backstop (`CLAIM_MAX_IDLE_MS`). Keep the existing mtime rule (`CLAIM_STALE_MS`) for a claim with no readable owner. While a run holds the claim, `processCandidate` wraps the run's shared `gh` function so that every `gh` call first refreshes the claim's mtime, owner-checked. `releaseClaim` becomes a compare-and-delete on the caller's token. `file-lock.js`'s `acquireLock` cannot serve this call site, and the comment above `takeClaim` says why (Task 1).

**Tech Stack:** Node 18+ CommonJS, `node --test`, `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T095826-record-4797/work/4797-spec.md`. Its `## Decisions` section carries the round-2 answer (Reading B, heartbeat) that supersedes this plan's earlier 60-minute total-hold backstop.

## Decision: the idle backstop (`CLAIM_MAX_IDLE_MS`) and the heartbeat

- **Heartbeat site.** All of Step 4.0's and Step 4.0b's `gh` calls go through the one function `setupContext` builds, `ctx.timedGh` (or `deps.gh` in tests). `processRun` hands it to `closing-links.js`'s `run` as `deps.gh`, and to `closeBelowFloorParents` as `gh`. `parent-gate.js` routes every read through `ghCaller(gh)`, and its in-process `fetch-sub-issues.js` run through `runner: (args) => caller.call(args)`. Wrapping that one function in `processCandidate`, after the claim is taken, covers every current and future loop in both steps. The refresh therefore lives in the shared gh-call path, as the Decisions require, not in a per-record loop.
- **Value: `CLAIM_MAX_IDLE_MS = 2.5 × 2 × GH_TIMEOUT_CEILING_MS = 300 000 ms (5 minutes)`.** `GH_TIMEOUT_CEILING_MS` is the `gh-timeout-ms` policy key's schema `max`, read from `POLICY_KEYS` (60 000 ms). It is not hand-typed. A claimant cannot see the holder's timeout configuration, so the backstop is sized at the ceiling, not at the 5 s default. The key's own summary allows one retry ("killed and retried once"), so a single logical `gh` call is bounded at 2 × 60 s = 120 s. That is the 120 s figure in the Decisions. The 2.5× headroom is the ratio `background-lock.js` keeps (`STALE_LOCK_MS` = 2.5 × `BACKGROUND_BUDGET_MS`).
- **Premise note.** In this path no `gh` call is actually retried: `timedGh` is a single `execFileSyncTimed` with `timeout: GH_TIMEOUT_MS`. So one call is bounded at 60 s, and the 120 s figure already carries 2× headroom. The value stays the decided 5 minutes.
- **Limit (non-`gh` stretches).** Work between `gh` calls is not heartbeated. In this path that work is `closing-links.js`' settle sleep (`POLL_STEP_MS`, 3 s, between re-reads that are themselves `gh` calls), JSON parsing, and the `decisions.md` append. Each takes seconds at most, so none approaches the backstop. The plan found no stretch that needs a refresh of its own.
- **Residual window, stated rather than fixed.** A holder suspended for longer than the backstop (laptop sleep, `SIGSTOP`) reads idle, and a later pass takes its claim over. When the holder resumes, it may finish the one run it was in. From then on its heartbeat refuses to touch the successor's claim and its release leaves that claim in place. Aborting the resumed holder mid-run is out of scope: `closing-links.js` and `below-floor-parent-close.js` each catch a throwing `gh` and turn it into an exit code or a per-parent skip, so an abort cannot propagate without changing both modules.
- A claim with no readable owner keeps the `CLAIM_STALE_MS` (10 min) reclaim, and release still requires the owner token. The value and this derivation go in the spec's `## Decisions` (Task 1, Step 3) and in a code comment next to the constant.

## Global Constraints

- `CLAIM_STALE_MS` stays `10 * 60 * 1000` and `CLAIM_FILENAME` stays `'.post-merge.lock'`, a plain file created `wx`. Older installed reconcilers create and respect this same file concurrently with the new code, so the lock's path and file shape must not change.
- A claim file with no readable owner keeps the old rule: in flight under `CLAIM_STALE_MS`, reclaimable at or past it. An empty file is ownerless. An older reconciler writes one, and a new one is momentarily empty between its create and its token write.
- `takeClaim`'s failure reasons stay exactly `in-flight` and `claim-failed`. Archive deferral and `classifyEntry` route on them.
- A `deps.takeClaim` fake that returns `{ ok: true }` with no token must keep working. Heartbeat and release are no-ops for a falsy token and never throw.
- No new dependency. Never block or poll.
- Every `fs` call inside `takeClaim`, `heartbeatClaim` and `releaseClaim` goes through the `fsApi` parameter. The `R3` tests inject racing wrappers through it.
- Commit subjects use `{Verb} {what} — {detail}` and reference the record as `refs #4797`, never `closes`/`fixes`.
- Governing project skill, quoted verbatim from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`: "Decide the shape before writing the file, and reuse `withLock` rather than hand-rolling a second mutex." This plan keeps the existing hand-rolled claim, so the call site must state why `file-lock.js` cannot serve (Task 1). That is also the record's second Deliverable. `caching-and-locks.md` covers holding `file-lock.js` across a long call, which this plan does not do. No other `.claude/skills/` rule names these files: `driver-skill-outcome-taxonomy` and `bin-source-scan-conformance` cite `post-merge.js` and its test only for `classifyEntry` and the closing-links producer-coverage test, neither of which this plan touches.
- Source-scan lint: no `fs.existsSync`/`fs.realpathSync` in `plugin/bin/` (`tests/path-guard-conformance.test.js`). The new code needs neither. Tests may use them.
- Locate code by function and constant name, not line number.

## Review Focus

- A live, progressing holder past `CLAIM_STALE_MS` total hold time must read `in-flight`, with its claim file byte-for-byte unchanged (AC1.1). Tested at unit level and through `postMerge` (Task 1).
- A holder whose claim was taken over and later resumes must neither refresh the successor's mtime (heartbeat owner check) nor delete its claim (release owner check, AC2.1). Both are tested, and each owner check has a test that only that check decides (Task 1).
- A dead holder's claim is reclaimed at once, even with a fresh mtime. Only the liveness check decides that test (Task 1).
- Reused pid: a claim whose pid reads alive but which has been idle longer than `CLAIM_MAX_IDLE_MS` is reclaimed, and one just under it is not. Both edges are tested (Task 1).
- Mixed-version interop: an empty (old-format) claim is still honored for `CLAIM_STALE_MS`. The existing tests `claim: a fresh lock file means in-flight…`, `claim: a lock 11 minutes old is taken over…` and the three `R3` tests already write `''`, so they pin this unchanged. The reverse direction cannot be fixed here: an older reconciler still takes over a claim idle past `CLAIM_STALE_MS` by mtime alone, and still releases unconditionally. The heartbeat narrows that race, because a progressing new holder's mtime stays fresh to an old reader too. The call-site comment and `docs/reconcile-checks.md` say so (Tasks 1 and 2).

---

### Task 1: Owner-token, liveness-checked, heartbeated claim in post-merge.js

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/file-lock.js` (add `isAlive` to `module.exports`, nothing else)
- Modify: `plugin/bin/lib/reconcile/post-merge.js` (constants beside `CLAIM_STALE_MS`, `takeClaim`, new `heartbeatClaim`, `releaseClaim`, `processCandidate`'s claim block, the `takeClaim` and `classifyEntry` comments, `module.exports`)
- Modify: `.claude-tweaks/pipelines/2026-11-03T095826-record-4797/work/4797-spec.md` (record the chosen value and derivation under `## Decisions`)
- Test: `tests/bin-lib/reconcile/post-merge.test.js`
- Test: `tests/bin-lib/file-lock.test.js`

**Interfaces:**
- Consumes: `require('../file-lock').isAlive(pid: number) -> boolean`. It already exists and is only being exported. `require('../policy-schema').POLICY_KEYS`. `post-merge.js` already requires `../policy-schema` for `resolvePolicyKeys`, so add to that destructure.
- Produces (all exported from `post-merge.js`):
  - `takeClaim(runDir: string, nowMs: number, fsApi = fs, { isAlive = pidAlive } = {}) -> { ok: true, token: string } | { ok: false, reason: 'in-flight' | 'claim-failed' }`
  - `heartbeatClaim(runDir: string, token: string | undefined, nowMs: number, fsApi = fs) -> boolean`: sets the lock's atime and mtime to `nowMs` only when the file's content `=== token`. Returns `true` when it refreshed. A falsy token, a mismatched or missing file, or any I/O error returns `false`. Never throws.
  - `releaseClaim(runDir: string, token: string | undefined, fsApi = fs) -> void`: unlinks the lock only when its content `=== token`. A falsy token is a no-op. Never throws.
  - `CLAIM_MAX_IDLE_MS` (300 000) and `GH_TIMEOUT_CEILING_MS` (60 000).

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/reconcile/post-merge.test.js`:

- Add `heartbeatClaim, releaseClaim, CLAIM_MAX_IDLE_MS, GH_TIMEOUT_CEILING_MS` to the top-level destructured require of `post-merge`.
- Change the one return-shape assertion in `R3 two takeovers: the taker that loses the rename…` from `assert.deepEqual(winner, { ok: true });` to `assert.equal(winner.ok, true);`.
- Append the following after `takeClaim: a non-EEXIST create error is claim-failed`, with a helper `setMtime(dir, ms)` that runs `fs.utimesSync(lockOf(dir), ms / 1000, ms / 1000)` and a helper `mtimeOf(dir)` returning `fs.statSync(lockOf(dir)).mtimeMs`:

```js
test('AC1.1 takeClaim: a live holder that took the claim past CLAIM_STALE_MS ago and heartbeats is in-flight, its claim untouched', () => {
  const dir = addRun(mainCheckout(), '2026-10-30T090000-spec-1');
  const takenAt = NOW - CLAIM_STALE_MS - 60 * 1000;
  const holder = takeClaim(dir, takenAt);
  assert.equal(holder.ok, true);
  setMtime(dir, takenAt); // the claim's create time; without the heartbeat below it is idle and taken over
  assert.equal(heartbeatClaim(dir, holder.token, NOW - 60 * 1000), true);
  assert.deepEqual(takeClaim(dir, NOW), { ok: false, reason: 'in-flight' });
  assert.equal(fs.readFileSync(lockOf(dir), 'utf8'), holder.token);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.stale-')), []);
});

test('AC1.1 postMerge: a live, heartbeating holder past CLAIM_STALE_MS skips in-flight, defers, and calls no fake', async () => {
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

test('CLAIM_MAX_IDLE_MS is 2.5 x a retried gh call at the gh-timeout-ms schema ceiling', () => {
  const { POLICY_KEYS } = require('../../../plugin/bin/lib/policy-schema');
  assert.equal(GH_TIMEOUT_CEILING_MS, POLICY_KEYS.find((k) => k.key === 'gh-timeout-ms').max);
  assert.equal(CLAIM_MAX_IDLE_MS, 2.5 * 2 * GH_TIMEOUT_CEILING_MS);
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
});

test('heartbeat: every gh call through the shared path refreshes the held claim, in Step 4.0 and in Step 4.0b', async () => {
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const seen = [];
  const probe = (gh, label) => {
    setMtime(dir, NOW - 4 * 60 * 1000);
    gh(['api', 'user']);
    seen.push([label, mtimeOf(dir)]);
  };
  const links = (argv, d) => { probe(d.gh, '4.0'); d.stdout(`${JSON.stringify(ENVELOPE)}\n`); return 0; };
  const close = (args) => { probe(args.gh, '4.0b'); return { closed: [], skipped: [] }; };
  const r = await run(root, { prs: { 11: merged() }, links, close });
  assert.equal(r.entries[0].action, 'ran');
  assert.deepEqual(seen.map(([label]) => label), ['4.0', '4.0b']);
  for (const [label, m] of seen) assert.ok(Math.abs(m - NOW) < 1000, `the ${label} gh call refreshed the claim`);
  assert.ok(!fs.existsSync(lockOf(dir)), 'the owner release removed the claim');
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
Expected: FAIL. `heartbeatClaim`, `releaseClaim` (as an export), `CLAIM_MAX_IDLE_MS`, `GH_TIMEOUT_CEILING_MS` and `isAlive` (as an export) are undefined, and `r.token` is undefined.

- [ ] **Step 3: Implement**

`file-lock.js`: change `module.exports` to `{ acquireLock, releaseLock, withLock, isAlive }`. Change nothing else.

`post-merge.js`:

- Requires: `const { isAlive: pidAlive } = require('../file-lock');`, and add `POLICY_KEYS` to the existing `require('../policy-schema')` destructure.
- Constants, next to `CLAIM_STALE_MS`:
  - `const GH_TIMEOUT_CEILING_MS = POLICY_KEYS.find((k) => k.key === 'gh-timeout-ms').max;`
  - `const CLAIM_MAX_IDLE_MS = 2.5 * 2 * GH_TIMEOUT_CEILING_MS;`
  - Put a comment above them carrying this plan's Decision section in a few lines: the holder heartbeats on every `gh` call, so the idle time is at most one logical call (2 × the 60 s ceiling, per the key's retry-once allowance; no call in this path actually retries) plus seconds of non-`gh` work; 2.5× headroom, `background-lock.js`'s ratio, gives 5 minutes; a live-reading pid idle past that is a reused pid or a suspended holder.
- Staleness, as an internal pure helper `claimIsStale(content: string, mtimeMs: number, nowMs: number, isAlive) -> boolean`:
  - The owner pid is `Number(m[1])` when `content` matches `/^(\d+)-/`. Otherwise there is no owner.
  - No owner: stale iff `nowMs - mtimeMs >= CLAIM_STALE_MS` (today's rule, unchanged).
  - Owner: stale iff `!isAlive(pid) || nowMs - mtimeMs > CLAIM_MAX_IDLE_MS`.
- `takeClaim`:
  - Create: `openSync(lock, 'wx')`, then `writeSync(fd, token)` with token `` `${process.pid}-${Math.random().toString(36).slice(2)}` ``, then `closeSync`. If the write throws: close, unlink the lock, and return `claim-failed`.
  - On `EEXIST`: read the content (`readFileSync(lock, 'utf8')`) and the mtime (`statSync`). `ENOENT` on either means `in-flight`. Any other error means `claim-failed`. If not stale, return `in-flight`.
  - Otherwise rename aside exactly as today. Then re-judge the aside's own content and mtime with the same helper, replacing today's mtime-only re-check; an unreadable aside keeps the first reading. If the aside is not stale, link it back, unlink the aside and return `in-flight`. Otherwise unlink the aside and retry the create once, with the same `EEXIST` → `in-flight` mapping as today.
- Restate the "Residual window" comment in the link-back branch under the new rule. The holder may release between our rename and this link, and the link then re-creates a claim carrying the holder's token that nobody holds. The next pass judges that token's pid: once the holder process has exited it reads dead and is taken over at once; while it still runs, no heartbeat refreshes the orphan, so it is taken over once idle past `CLAIM_MAX_IDLE_MS`. An ownerless aside linked back keeps the `CLAIM_STALE_MS` rule.
- `heartbeatClaim` and `releaseClaim`, per the Interfaces block. `releaseClaim` reads the content and unlinks only on `=== token`. Comment the read-then-unlink gap: only a takeover could fill it, and a holder that heartbeated moments ago is neither dead nor idle.
- `processCandidate`, once `claim.ok`:
  - Build `const runCtx = { ...ctx, timedGh: (args, input) => { heartbeatClaim(dir, claim.token, now()); return ctx.timedGh(args, input); } };`.
  - Pass `runCtx` instead of `ctx` to `processRun`.
  - Release in the `finally` with `releaseClaim(dir, claim.token)`.
  - One comment line: the heartbeat lives here, on the shared `gh` function, so every loop in Steps 4.0 and 4.0b is covered.
- Rewrite the comment above `takeClaim`. It must:
  - State the owner-token, liveness, idle-backstop and heartbeat rule.
  - State why `file-lock.js`'s `acquireLock` cannot serve here:
    - (a) Its reclaim is rm-then-mkdir, so two reclaimers of one dead lock can both win. The rename-aside takeover is what the `R3` tests pin.
    - (b) It polls up to `LOCK_WAIT_MS` and returns `null` both for "held" and for an I/O error. This pass needs a non-blocking take with distinct `in-flight`/`claim-failed` reasons that drive archive deferral.
    - (c) Its lock is a directory with a 5 s ownerless fallback. Older installed reconcilers create and respect `.post-merge.lock` as a plain empty file, so that fallback would steal their live claim after 5 seconds.
    - (d) It has no refresh, so a long hold cannot stay fresh to a reader that judges by age.
  - Close with: hence only its `isAlive` probe is reused.
  - Add the interop note: until every installed build upgrades, an older reconciler still takes over a claim idle past `CLAIM_STALE_MS` by mtime alone and releases unconditionally. The heartbeat keeps a progressing holder fresh to it too.
  - Add the suspended-holder residual, from this plan's Decision section, in one or two sentences.
- `classifyEntry`'s comment currently says "a re-run past CLAIM_STALE_MS recovers a dead one". Change it to: a re-run takes over a dead holder's claim at once, and an ownerless one past `CLAIM_STALE_MS`.
- Add `heartbeatClaim, releaseClaim, CLAIM_MAX_IDLE_MS, GH_TIMEOUT_CEILING_MS` to `module.exports`.

Spec: append to `## Decisions` in `.claude-tweaks/pipelines/2026-11-03T095826-record-4797/work/4797-spec.md` one bullet, `**Chosen value:** CLAIM_MAX_IDLE_MS = 5 min (2.5 × 2 × the gh-timeout-ms schema max of 60 s, read from POLICY_KEYS)`. Follow it with two sentences. First, the heartbeat wraps the shared `timedGh` in `processCandidate`, so every Step 4.0/4.0b `gh` call refreshes the claim. Second, no call in this path retries, so 120 s already carries 2× headroom, and the only non-`gh` stretches (the 3 s settle sleep, parsing, the `decisions.md` append) are seconds long.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js tests/bin-lib/file-lock.test.js tests/post-merge-run-cli.test.js`
Expected: PASS. Every test passes, including the existing `R3`, `claim:` and `postMergeOne` tests.

Guard discrimination, to check by deleting each guard once and re-running:
- The heartbeat's `=== token` compare: deleting it turns `heartbeatClaim: refreshes only a claim still carrying our token` red.
- The release's compare: deleting it turns `AC2.1` red.
- `!isAlive(pid)`: deleting it turns `a dead holder is reclaimed at once` red.
- The `CLAIM_MAX_IDLE_MS` clause: deleting it turns `a reused pid is reclaimed` red.
- The heartbeat wrapper in `processCandidate`: removing it turns the `heartbeat: every gh call…` test red.
- Restoring `{ ok: true }` without a token turns `AC2.1` red.
- Removing the `heartbeatClaim` call from the `AC1.1 takeClaim` test (not the code) turns that test red: the claim then reads 11 minutes idle. That proves the test exercises the heartbeat rather than a fresh create mtime.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/file-lock.js plugin/bin/lib/reconcile/post-merge.js tests/bin-lib/reconcile/post-merge.test.js tests/bin-lib/file-lock.test.js .claude-tweaks/pipelines/2026-11-03T095826-record-4797/work/4797-spec.md
git commit -m "Check post-merge claim holder liveness — owner token, gh-call heartbeat, compare-and-delete release (refs #4797)"
```

### Task 2: Sweep the prose that describes the old age-only claim

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/merge-mode.md` (the `verdict` `in-flight` bullet; 13,868 B against the 52,500 B rail, so headroom is ample)
- Modify: `docs/reconcile-checks.md` (the *Per-run claim file* bullet under "Two concurrency guards")
- Modify: `docs/journeys/merge-a-parked-unattended-pr-3784.md` (the **In flight.** bullet, which carries the same "past its 10-minute stale window" claim; no test pins this sentence)
- Test: `tests/wrap-up-merge-mode-conformance.test.js` (the `'already-in-flight-archived'` pin)

`Expected: FAIL after Step 1`

**Interfaces:**
- Consumes: Task 1's rule:
  - A dead holder is taken over at once.
  - A live holder is taken over only after it has not refreshed its claim for `CLAIM_MAX_IDLE_MS`.
  - An ownerless claim is taken over past `CLAIM_STALE_MS` (10 min).
  - Release is owner-checked.
- Produces: nothing code-facing.

Sweep grep, already run for this plan; its hits are this task's file list plus `post-merge.js`'s own comments, which are Task 1's: `git grep -n -i -e "post-merge.lock" -e "CLAIM_STALE_MS" -e "per-run claim" -e "stale window" -- plugin docs .claude/skills ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'`. `console-execute.js`'s `RECLAIM_STALE_MS` is an unrelated constant and needs no change.

- [ ] **Step 1: Update the conformance pin `'already-in-flight-archived'` in `tests/wrap-up-merge-mode-conformance.test.js`**

Replace the regex with one matching this exact sentence tail, regex-escaped as the neighbouring entries are:

`` `next` `rerun-after-stale-claim` marks an archived run (the adopted path is under `archive/`), whose holder is another merge-mode invocation, because the reconciler never walks `archive/`: the line also names `/claude-tweaks:wrap-up #{n} merge` again, in case that holder died — a re-run takes over a dead holder's claim at once, and a claim naming no holder once it is past its 10-minute stale window (`CLAIM_STALE_MS`) ``

The separate `merge-mode.md states the claim stale window as post-merge.js has it` test must keep matching `past its (\d+)-minute stale window \(`CLAIM_STALE_MS`\)` unchanged.

- [ ] **Step 2: Run the conformance test to verify it fails**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js`
Expected: FAIL. `merge-mode.md` still carries the old "again once the claim is past its 10-minute stale window" wording.

- [ ] **Step 3: Rewrite the prose**

- `plugin/skills/wrap-up/merge-mode.md`, the `verdict` `in-flight` bullet: replace the clause from `the line also names` to `in case that holder died.` with the Step 1 tail, ending with a full stop.
- `docs/journeys/merge-a-parked-unattended-pr-3784.md`, the **In flight.** bullet: replace "once the claim is past its 10-minute stale window." with "in case that holder died: a re-run takes over a dead holder's claim at once, and a claim naming no holder once it is past its 10-minute stale window."
- `docs/reconcile-checks.md`, the *Per-run claim file* bullet. Keep its first two sentences (the `wx` create; background vs inline passes) and its last sentence (the dotfile name). Replace the middle with these facts:
  - The claim file holds its owner's `{pid}-{token}`.
  - While a run holds the claim, every `gh` call it makes first refreshes the claim's mtime (the heartbeat, on the shared `gh` function), owner-checked.
  - A claim whose holder pid is alive skips `in-flight` unless it has gone unrefreshed for `CLAIM_MAX_IDLE_MS` (a reused pid or a suspended holder; the derivation sits beside the constant). Name the constant only, never its value: no test pins a number in this doc.
  - A dead holder's claim is taken over at once.
  - A claim naming no holder (an older reconciler's empty file) keeps the `CLAIM_STALE_MS` (10 minutes) rule.
  - A takeover is still atomic: renamed aside, re-judged, and only the rename winner retries the create. Any other I/O error skips `claim-failed`.
  - The lock is removed after the marker write, and only by its owner (a compare-and-delete on the token), so a taken-over pass never deletes its successor's claim. A holder suspended past the idle backstop may still finish the run it was in.
  - Until every installed build upgrades, an older reconciler still takes over by age alone and releases unconditionally, so a mixed-version pair keeps the old race for a claim idle past `CLAIM_STALE_MS`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js tests/bin-lib/reconcile/post-merge.test.js`
Expected: PASS.

Then re-run the sweep grep from this task's header. Expected: no hit that still says a live claim is judged by mtime alone or that a re-run waits out the stale window for a dead holder.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/merge-mode.md docs/reconcile-checks.md docs/journeys/merge-a-parked-unattended-pr-3784.md tests/wrap-up-merge-mode-conformance.test.js
git commit -m "Describe the liveness-checked, heartbeated post-merge claim — merge-mode, journey and reconcile-checks prose (refs #4797)"
```

Waived AC3.1: `npm test` passing is verified by `/claude-tweaks:build`'s Common Step 5 final verification and the `/claude-tweaks:test` gate, not by a plan task.
