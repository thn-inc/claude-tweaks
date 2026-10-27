# Reconcile Abandoned-Interrupted Through Run-Liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `classifyRunDir`'s `abandoned-interrupted` kind require a `runLiveness` verdict (dead past the 24-hour floor, or a bounded unknown fallback past 72 hours), and make reconcile's archive check report `ownerlessNonClean` and `ownerlessNonCleanZeroSince` so the 72-hour legacy route has a measurable removal condition.

**Architecture:** `run-liveness/index.js` exports its private `runIdMs` and `LIVE_PROBES`. `archive-merged.js` gains `recordedWorktreeIsMainCheckout(dir, state)`, and `isMainCheckoutAdHoc` becomes that predicate plus the ad-hoc check. `classifyRunDir` gains `ctx.runVerdict(dir, now)`, whose default `defaultRunVerdict` calls `runLiveness` with the path probe forced to `missing` for a main-checkout run. The verdict is asked only after the cheap guards. `archiveMerged` counts owner-less non-clean run dirs after its loops. `reconcile()` copies the count onto its result. `format-summary.js` renders it, and `cache.js` persists it together with the zero-since stamp.

**Tech Stack:** Node 18+ CommonJS, `node --test`, real-git fixtures (`makeRepo()` in `tests/bin-lib/reconcile/archive-merged.test.js`, `dryRunFixture()` in `tests/reconcile.test.js`).

**Spec:** `.claude-tweaks/pipelines/2026-10-26T123848-spec-4336-4419-4420-4421/spec-4421/work/4421-spec.md`

## Global Constraints

- `STALE_INTERRUPTED_TTL_MS` stays defined as `ORPHAN_MINT_TTL_MS`. `ORPHAN_MINT_TTL_MS` is untouched (value, comment, export).
- `classifyRunDir`'s kind order (`CLASSIFY_ORDER`) and its return shape `{ kind, ttlMs, evidence }` do not change. `abandoned-interrupted`'s `evidence` stays an object.
- The `shipped-unclosed` gate at `archiveMerged`'s call site (`kind === 'abandoned-interrupted' && checkRunIntegrity(dir, { cache }).state !== 'shipped-unclosed'`) does not change.
- `ctx.liveness` (the `adhoc-session-ended` verdict, default `adHocSessionLiveness`) stays a separate hook from `ctx.runVerdict`. Neither one calls the other.
- `ctx.runVerdict` runs only after the cheap guards, in this order: status `interrupted`, not the caller's own session, `events.jsonl` readable, and silence past the 24-hour floor.
- Silence is measured from `lastOwnMs`, falling back to `runIdMs(dir)`. If both are `null`, the run is not abandoned. Both floors use a strict `>`.
- (a) the verdict is `dead`, the evidence array is present, no entry has `result === 'error'`, and silence is `> STALE_INTERRUPTED_TTL_MS`. (b) the verdict is `unknown`, the evidence array is present, no `LIVE_PROBES` entry is `positive`, and silence is `> LEGACY_DEAD_MS`. `owner-events` is not a live probe. A `runVerdict` that throws is read as not abandoned.
- `runIdMs` and `LIVE_PROBES` are imported from `plugin/bin/lib/run-liveness`, never copied. `plugin/bin/lib/run-liveness/index.js` changes only its export list and its header comment.
- A skipped or errored pass leaves `ownerlessNonClean` absent, never `0`. That covers: archive not requested, budget-exceeded, no main checkout, a dry run, an unreadable pipelines dir, and the `reconcile-threw` fallback. The same pass never writes or clears either cache key. A pipelines dir that does not exist counts as `0`.
- `ownerlessNonClean` and `ownerlessNonCleanZeroSince` are written to `reconcile-cache.json` only when present. `readCache` keeps a key only when its value is valid: a non-negative integer for the count, and a `Date.parse`-able string for the stamp. A key that is absent stays absent, never `null`, so the existing "absent file reads as empty defaults" `deepEqual` pins in `tests/bin-lib/reconcile/cache.test.js` hold unchanged.
- The removal-condition sentence goes into `docs/reconcile-checks.md` and `docs/hooks.md` verbatim from the spec deliverable, backticks included. Task 5's test pins it:

  > remove it when `ownerlessNonCleanZeroSince` is at least 7 days old in this repository's `reconcile-cache.json`, on a plugin build newer than v6.153.0.
- One commit per task, in task order. This is five commits; the spec's three-commit grouping is split along reviewable seams.
- `docs/hooks.md` holds one very long line per paragraph. Edit sentences in place and never reflow.

## Review Focus

1. **A dead verdict that carries an error entry.** A fake can produce it; `runLiveness` cannot. It must not take route (a) (Task 2 test "AC2.2 dead with an error entry").
2. **`owner-events` reading `positive` on an `unknown` verdict.** This happens between 24 h and 72 h. It must not block route (b) after 72 h, because the two clocks agree. It must not count as a live probe (Task 2 real-probe test "AC3.1 other-host", whose rung assertion shows `owner-events` `positive` at 50 h).
3. **A run directory with no run-id prefix and no own event.** With no reference time, it is never abandoned (Task 2 test "AC5.1 no reference time").
4. **A dir whose `run-state.json` exists but does not parse, or parses to an array.** It is not counted. A dir that `iterRunDirsWithState` skips because its archive twin is already `clean` is not counted either (Task 3 test "AC6.1 counts only absent or owner-less non-clean").
5. **Two consecutive passes that both read `0`.** The second pass keeps the first pass's `ownerlessNonCleanZeroSince`; it does not re-stamp it (Task 4 test "AC6.2").

---

### Task 1: Share `runIdMs`/`LIVE_PROBES` and add `recordedWorktreeIsMainCheckout`

**Files:**
- Modify: `plugin/bin/lib/run-liveness/index.js`. Add `runIdMs` and `LIVE_PROBES` to `module.exports`. Bodies unchanged.
- Modify: `plugin/bin/lib/reconcile/archive-merged.js`
  - Add `recordedWorktreeIsMainCheckout` next to `isMainCheckoutAdHoc`, around line 137.
  - Rewrite `isMainCheckoutAdHoc` as `const state = readAdHocState(dir); return !!state && recordedWorktreeIsMainCheckout(dir, state);`.
  - Export the new predicate.
- Test: `tests/bin-lib/run-liveness/index.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Produces: `require('plugin/bin/lib/run-liveness').runIdMs(runDir: string) -> number | null`, the same function `probeOwnEvents` uses.
- Produces: `LIVE_PROBES: string[]` = `['owner-pid', 'heartbeat', 'worktree-lock', 'last-commit']`.
- Produces: `recordedWorktreeIsMainCheckout(dir: string, state: object | null) -> boolean`.
  - It is true only when `state.worktree` is a non-empty string, `resolveLeaf(state.worktree)` is `resolved`, and its `path` equals `canonicalRealpath(path.resolve(dir, '..', '..', '..'))`.
  - Any unprovable path gives false.
  - It does no ad-hoc check.

- [ ] **Step 1: Write the failing tests**
  - In `index.test.js`, import `runIdMs` and `LIVE_PROBES`:
    - `runIdMs: a run-id basename gives its UTC start in ms; no prefix gives null`. Check `runIdMs('/x/2026-08-01T090000-record-1') === Date.parse('2026-08-01T09:00:00Z')` and `runIdMs('/x/run') === null`.
    - `LIVE_PROBES is the four live probes, in PROBE_ORDER`. `deepStrictEqual` to the list above, and `PROBE_ORDER.filter((p) => LIVE_PROBES.includes(p))` deep-equals `LIVE_PROBES`.
  - In `archive-merged.test.js`, import `recordedWorktreeIsMainCheckout`. These tests use the existing `mkAdHocRunDir` helper; its `basename` and `worktree` options already exist.
    - `AC4.1: recordedWorktreeIsMainCheckout is true for a non-ad-hoc run dir stamped with its main checkout, where isMainCheckoutAdHoc is false`. Use `mkAdHocRunDir({ ageMs: 0, worktree: (root) => root, basename: '2026-08-01T090000-record-4421' })`. The predicate on the dir's read state is `true`, and `isMainCheckoutAdHoc(dir) === false`.
    - `recordedWorktreeIsMainCheckout is false for a linked, missing or absent worktree`. False for each of:
      - an existing `root/.claude/worktrees/live` dir;
      - `root/.claude/worktrees/gone`;
      - `{}`;
      - `null`;
      - `{ worktree: 7 }`.
    - `recordedWorktreeIsMainCheckout matches through a symlinked dir path`. Same shape as the existing "AC3.1 #4179 … symlinked path" test. `skip` on win32.

- [ ] **Step 2: Run the RED probe**

Run: `node -e "const a = require('./plugin/bin/lib/reconcile/archive-merged'), l = require('./plugin/bin/lib/run-liveness'); process.exit(typeof a.recordedWorktreeIsMainCheckout === 'function' && typeof l.runIdMs === 'function' && Array.isArray(l.LIVE_PROBES) ? 0 : 1)"`
Expected: FAIL (exit 1). None of the three is exported today. Then `node --test tests/bin-lib/run-liveness/index.test.js` fails with "runIdMs is not a function".

- [ ] **Step 3: Implement** the exports and the predicate as described under Interfaces. In `isMainCheckoutAdHoc`'s comment, name the predicate it now delegates to.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/run-liveness/index.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/reconcile.test.js`
Expected: PASS. The existing `#4179` `isMainCheckoutAdHoc` and `adhoc-session-ended` tests keep their decisions.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/run-liveness/index.js plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/run-liveness/index.test.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Share runIdMs and LIVE_PROBES from run-liveness and add recordedWorktreeIsMainCheckout — any run dir, ad-hoc or not (#4421)"
```

### Task 2: Route `abandoned-interrupted` through `ctx.runVerdict`

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js`
  - Add `defaultRunVerdict(dir, now)`.
  - Destructure `runVerdict = defaultRunVerdict` in `classifyRunDir`.
  - Rewrite the `abandoned-interrupted` branch as the algorithm below.
  - `isAbandonedInterrupted(runDir, state, sessionId, now = Date.now(), ctx = {})` passes `{ ...ctx, dir: runDir, state, sessionId, kinds: ['abandoned-interrupted'] }` to `classifyRunDir`, so the wrapper's own keys win.
  - `archiveMerged` accepts `runVerdict` and passes it into both of its `classifyRunDir` calls.
  - Reword the comments that describe the old rule. These are the `STALE_INTERRUPTED_TTL_MS` comment, the `isAbandonedInterrupted` "honest scope" paragraph (it names "the two checks below: the 24h staleness window" — make it the verdict plus the floors), and the `classifyRunDir` header's I/O list, which should name the injectable `runVerdict` evaluated after the cheap guards.
  - Export `defaultRunVerdict`.
- Modify: `plugin/bin/lib/run-liveness/index.js`, header comment only. The consumer line also names "`archive-merged.js`'s `abandoned-interrupted` kind, through `defaultRunVerdict` (#4421)".
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`
  - Migrate these existing callers to inject `DEAD` (defined below), each keeping its decision (AC1.1):
    - The four `fixtureAbandonedShippedRun` tests ("auto-closed via closeRunState", "owned by the calling session", "recent fallback-attributed events", "archive move fails"): `archiveMerged({ …, runVerdict: DEAD })`.
    - The two `#4032` `multiRunWorktreeFixture` tests: `runVerdict: DEAD` on every `archiveMerged` call.
    - `isAbandonedInterrupted: false when owner === sessionId…`, `#1737: … at most one read of events.jsonl` and `… unreadable/absent events.jsonl is UNKNOWN evidence`: pass `Date.now()` as the fourth argument, then a trailing `{ runVerdict: DEAD }`. The `#1737` count stays 1, because the fake reads nothing.
    - `isAbandonedInterrupted: false for a non-interrupted status`: trailing `{ runVerdict: DEAD }`.
- Callers checked, no change needed (dependency-caller enumeration over `archiveMerged(`, `isAbandonedInterrupted(`, `classifyRunDir(` and `reconcile(`):
  - `tests/bin-lib/hooks/reconcile-background.test.js` (#1687, the real CLI, so no injection is possible):
    - The owned run is still stopped by the own-session guard.
    - The unowned run has no owner block, its worktree is torn down, and its own events are from 2020. The real verdict is `dead` through the legacy witness, so it is still archived.
  - `tests/reconcile.test.js` `#4179` ad-hoc tests: `interrupted` main-checkout ad-hoc dirs.
    - Those with no `events.jsonl` stop at the readable guard.
    - The two with a 5-day-old event reach the real default: the adjustment applies, there is no owner block, and the legacy witness gives `dead`. That is followed by the unchanged `shipped-unclosed` gate and then the same `adhoc-session-ended` fall-through as today.
    - The archived/not-archived outcome is the same.
  - `tests/bin-lib/reconcile/archive-merged-linked-worktree.test.js`: no `interrupted` state.
  - The `classifyRunDir` unit tests near "classifyRunDir: none for a fresh, ordinary run dir": `status: 'active'`.

**Interfaces:**
- Consumes: `runLiveness`, `runIdMs`, `LIVE_PROBES` (`plugin/bin/lib/run-liveness`); `LEGACY_DEAD_MS` (`run-liveness/constants`); `recordedWorktreeIsMainCheckout` (Task 1).
- Produces: `defaultRunVerdict(dir: string, now: number) -> { verdict, evidence }`. It is `runLiveness(dir, { now, probes })`, where `probes` is `{ pathType: () => ({ type: 'missing' }) }` when `recordedWorktreeIsMainCheckout(dir, readRunState(dir))`, else `{}`. It reads state from disk, the same file `runLiveness` reads.
- Produces: `ctx.runVerdict(dir, now) -> { verdict, evidence }` on `classifyRunDir`, and `archiveMerged({ runVerdict })`.
- Produces: `classifyRunDir` `abandoned-interrupted` result `{ kind: 'abandoned-interrupted', ttlMs: STALE_INTERRUPTED_TTL_MS | LEGACY_DEAD_MS, evidence: { lastOwnMs, verdict } }`. `ttlMs` is the floor that applied.

The branch body, which the signatures do not determine. The `owner`/`ownLive` lines are unchanged:

```js
if (!ownLive) {
  const { readable, lastOwnMs: last } = ownEventRecency(dir);
  const ref = last !== null ? last : runIdMs(dir);
  const silentMs = ref === null ? null : now - ref;
  if (readable && silentMs !== null && silentMs > STALE_INTERRUPTED_TTL_MS) {
    let result = null;
    try { result = runVerdict(dir, now); } catch { result = null; }
    const evidence = result && Array.isArray(result.evidence) ? result.evidence : null;
    const verdict = result ? result.verdict : undefined;
    const dead = !!evidence && verdict === 'dead' && !evidence.some((e) => e && e.result === 'error');
    const fallback = !!evidence && verdict === 'unknown' && silentMs > LEGACY_DEAD_MS
      && !evidence.some((e) => e && LIVE_PROBES.includes(e.probe) && e.result === 'positive');
    if (dead || fallback) {
      return { kind: 'abandoned-interrupted', ttlMs: dead ? STALE_INTERRUPTED_TTL_MS : LEGACY_DEAD_MS, evidence: { lastOwnMs: last, verdict } };
    }
  }
}
```

- [ ] **Step 1: Write the failing tests.** Shared helpers go at the top of the new block:

```js
const { PROBE_ORDER, runLiveness } = require('../../../plugin/bin/lib/run-liveness');
const H = 60 * 60 * 1000;
// A runVerdict fake: every entry negative unless `over[probe]` overrides it.
const verdictOf = (verdict, over = {}) => () => ({
  verdict, evidence: PROBE_ORDER.map((probe) => ({ probe, result: 'negative', detail: 'x', ...(over[probe] || {}) })),
});
const DEAD = verdictOf('dead');
// An interrupted run dir under a fake main checkout with one own event `ageMs` ago
// (none when ageMs is null). Returns { root, dir, state }.
function interruptedRun({ ageMs, state = {}, runId = '2026-08-01T090000-record-4421', lines } = {}) { … }
```

Tests (name, then assertions; `now = Date.now()` fixed per test, `other = 'sess-b'`):

- `AC2.1: a live verdict, or unknown with any positive live probe, is never abandoned-interrupted`
  - The fixture's own event is 100 h old.
  - `isAbandonedInterrupted(dir, state, other, now, { runVerdict: verdictOf('live') }) === false`.
  - For each `p` of the four live probes, `{ runVerdict: verdictOf('unknown', { [p]: { result: 'positive' } }) }` gives `false`.
- `AC2.2: a probe-error fixture with a recent own event is not abandoned, and an error never takes route (a)`. Each of these is `false`:
  - own event 1 h old, `verdictOf('unknown', { 'owner-pid': { result: 'error' } })`;
  - own event 30 h old, `verdictOf('dead', { 'worktree-lock': { result: 'error' } })`;
  - own event 100 h old, a `runVerdict` that throws;
  - own event 100 h old, `() => ({ verdict: 'dead' })`, which has no evidence array.
- `AC3.1: unknown with no positive live probe is abandoned after 72 hours of silence and not sooner`
  - With `verdictOf('unknown')`: 71 h gives `false` and 73 h gives `true`.
  - With `verdictOf('unknown', { 'owner-events': { result: 'positive' } })` at 73 h: `true`.
  - **Real-probe rows, no `runVerdict` injected.** Owner block `{ sessionId: 'sess-a', host: 'other-host.invalid', pid: 4242, pidSource: 'env', pidStartedAt: 'x', heartbeatAt: <the event time> }`, `state.sessionId: 'sess-a'`, worktree `root/gone`.
    - Rung first: `runLiveness(dir, { now })` has `verdict === 'unknown'` and owner-pid detail `other-host`.
    - Then 50 h gives `false` and 80 h gives `true`.
    - The same pair for a mismatch: `owner.sessionId: 'sess-old'`. Its rung is an owner-pid entry of `error` / `owner-session-mismatch`.
- `AC3.2: a dead owner-block run is never abandoned sooner than 24 hours after its last own event`
  - `DEAD` at 23 h gives `false`; at 25 h it gives `true`.
  - **Real-probe row.** Owner block with `host: os.hostname(), pid: 2147483646`; worktree `root/gone`.
    - Rung first: `runLiveness(dir, { now })` has `verdict === 'dead'` and owner-pid detail `gone`.
    - 23 h gives `false` and 25 h gives `true`.
- `AC4.1: a non-ad-hoc main-checkout run whose owner pid is gone reads dead through the adjustment and is abandoned after the floor`
  - Fixture: `root = fs.realpathSync(makeRepo())`. Its init commit is seconds old. The dir is `root/.claude-tweaks/pipelines/2026-08-01T090000-record-4421`, with `worktree: root` and the owner block from AC3.2.
  - Rungs first:
    - `runLiveness(dir, { now }).verdict === 'live'` (unadjusted; last-commit `positive`).
    - `runLiveness(dir, { now, probes: { pathType: () => ({ type: 'missing' }) } }).verdict === 'dead'`.
    - `defaultRunVerdict(dir, now).verdict === 'dead'`.
    - `isMainCheckoutAdHoc(dir) === false`.
  - Then, with no `runVerdict` injected, 25 h gives `true` and 23 h gives `false`. `classifyRunDir({ dir, state, sessionId: other, kinds: ['abandoned-interrupted'] }, now).evidence.verdict === 'dead'`.
- `AC5.1: a readable log with no own event and a run id under 24 hours old is not abandoned`
  - The run id is built from `now - 2 * H` as `YYYY-MM-DDTHHMMSS`.
  - `events.jsonl` holds one `attribution: 'fallback'` line.
  - With `{ runVerdict: DEAD }` it is `false`. A control with the run id from `now - 30 * H` is `true`.
- `AC5.1 no reference time: a basename with no run id and no own event is never abandoned`
  - The dir is `root/run`, with a fallback-only log and `DEAD`. It gives `false`.
- `the verdict is asked only after the cheap guards`
  - A counting `runVerdict` that throws. Each of these gives `false` with zero calls:
    - status `active`;
    - own session (`state.sessionId === sessionId`);
    - no `events.jsonl`;
    - own event 1 h old.
  - Then a 30 h row calls it exactly once.
- `archiveMerged threads runVerdict into the classifier`
  - Use `fixtureAbandonedShippedRun({ runId: '2026-08-01T090000-spec-4421-live' })` with `archiveMerged({ cwd: root, sessionId: 'this-session', runVerdict: verdictOf('live') })`.
  - The run dir is not in `archived` and still exists with `status: 'interrupted'`.

- [ ] **Step 2: Run the RED probe**

Run: `node -e "const fs = require('fs'), os = require('os'), p = require('path'); const d = p.join(fs.mkdtempSync(p.join(os.tmpdir(), 'ct-4421-')), '2026-08-01T090000-record-4421'); fs.mkdirSync(d); fs.writeFileSync(p.join(d, 'events.jsonl'), JSON.stringify({ type: 'skill_invoked', ts: '2026-08-01T09:05:00.000Z' }) + '\n'); const r = require('./plugin/bin/lib/reconcile/archive-merged').isAbandonedInterrupted(d, { status: 'interrupted' }, 'sess-b', Date.now(), { runVerdict: () => ({ verdict: 'live', evidence: [] }) }); console.log('abandoned=' + r); process.exit(r === false ? 0 : 1)"`
Expected: FAIL (exit 1). It prints `abandoned=true`, because today's `isAbandonedInterrupted` ignores a trailing `ctx` and classifies on silence alone. Then `node --test tests/bin-lib/reconcile/archive-merged.test.js` fails on the `AC2.1`, `AC2.2` (30 h and throw rows), `AC3.1` (71 h and 50 h rows), `AC5.1` and `archiveMerged threads runVerdict` tests.

- [ ] **Step 3: Implement** the algorithm above, the hook, the wrapper pass-through, the `archiveMerged` option, the comment rewording, and the `run-liveness/index.js` header line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-linked-worktree.test.js tests/reconcile.test.js tests/bin-lib/hooks/reconcile-background.test.js tests/bin-lib/run-liveness/index.test.js`
Expected: PASS
Run: `git grep -n -e "STALE_INTERRUPTED_TTL_MS = ORPHAN_MINT_TTL_MS" -e "const ORPHAN_MINT_TTL_MS = 24 \* 60 \* 60 \* 1000" -- plugin/bin/lib/reconcile/archive-merged.js`
Expected: exactly two hits, both definitions unchanged.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/lib/run-liveness/index.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Route abandoned-interrupted through run-liveness — dead past 24h, or unknown with no live positive past 72h (#4421)"
```

### Task 3: Count `ownerlessNonClean` in `archiveMerged`

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js`
  - Add `countOwnerlessNonClean(root)` and export it.
  - At the end of `archiveMerged`, after `pruneResidueFailures`, return `{ archived, skipped, residuePlan, residueErrors, ...(dryRun || count === null ? {} : { ownerlessNonClean: count }) }`.
  - The early `if (!root)` return is unchanged and carries no field.
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`
- Result consumers, enumerated (`git grep -n "archiveMerged(" -- plugin`):
  - `plugin/bin/lib/reconcile/index.js:523` is the only production caller. It is pick-one: it reads named fields, so a new key is ignored until Task 4.
  - `plugin/bin/sweep-stray-run-dirs.js:26` is a comment.
  - Tests: no `deepEqual` pins a whole `archiveMerged` result except the `#4032` `deepStrictEqual(cached, uncached)` test. Both of its calls are `dryRun: true`, so neither carries the field.

**Interfaces:**
- Produces: `countOwnerlessNonClean(root: string) -> number | null`.
  - It returns `null` when `fs.readdirSync(path.join(root, '.claude-tweaks', 'pipelines'))` throws anything but `ENOENT`, and `0` on `ENOENT`.
  - Otherwise it counts each `{ dir, state }` from `iterRunDirsWithState(root)` that matches either rule:
    - `state === null` and `run-state.json` is absent (`fs.existsSync`). An unparseable file is not counted.
    - `state` is a plain object, its `owner` is not a plain object, and `state.status !== 'clean'`. A missing status counts.
  - It reuses the iterator's `RUN_ID_RE`, archive-twin and `archiving`-claim filters, so `archive/` is never counted.
- Produces: `archiveMerged(...) -> { archived, skipped, residuePlan, residueErrors, ownerlessNonClean? }`.

- [ ] **Step 1: Write the failing tests**
  - `AC6.1: ownerlessNonClean counts absent or owner-less non-clean run dirs after this pass's archival`
    - `root = fs.realpathSync(makeRepo())`. Under `pipelines/`:
      - two owner-less non-clean dirs (`config.yml` plus `{ status: 'active', worktree: root/gone-N }`);
      - one dir with `config.yml` and no `run-state.json`;
      - one owner-block dir (`config.yml` plus `{ status: 'active', owner: { sessionId: 's', host: 'h', pid: 1 } }`);
      - one clean owner-less dir (`{ status: 'clean' }`);
      - one owner-less orphaned mint (`{ status: 'active' }`, no `config.yml`, mtime backdated `ORPHAN_MINT_TTL_MS * 2` after its write), which this pass archives;
      - `pipelines/archive/2026-08-01T090000-old/run-state.json` = `{ status: 'active' }`.
    - `archiveMerged({ cwd: root, runVerdict: DEAD })` has `archived` containing the orphaned mint and `ownerlessNonClean === 3`.
    - **Review Focus 4 rows.** Add a dir whose `run-state.json` is `{not json`, and one that is `[]`, each with `config.yml`. Also add a dir `2026-08-01T090000-twin` whose `run-state.json` is `{ status: 'active' }` and whose `archive/2026-08-01T090000-twin/run-state.json` is `{ status: 'clean' }`. The count stays `3`.
  - `AC6.2: only owner-block runs count 0`
    - Two owner-block dirs give `ownerlessNonClean === 0`.
    - A repo with no `pipelines/` dir also gives `0`.
  - `AC6.4: a dry run, a pass with no main checkout, and an unreadable pipelines dir leave ownerlessNonClean absent`
    - `'ownerlessNonClean' in archiveMerged({ cwd: root, dryRun: true })` is false.
    - It is also false for `archiveMerged({ cwd: <a non-repo mkdtemp> })`.
    - `countOwnerlessNonClean(root)` returns `null` when `root/.claude-tweaks/pipelines` is a regular file (`ENOTDIR`).

- [ ] **Step 2: Run the RED probe**

Run: `node -e "const fs = require('fs'), os = require('os'), p = require('path'); const root = fs.realpathSync(fs.mkdtempSync(p.join(os.tmpdir(), 'ct-4421-cnt-'))); fs.mkdirSync(p.join(root, '.git')); const d = p.join(root, '.claude-tweaks', 'pipelines', '2026-10-26T000001-record-1'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(p.join(d, 'config.yml'), 'x: 1\n'); fs.writeFileSync(p.join(d, 'run-state.json'), JSON.stringify({ status: 'active' })); const r = require('./plugin/bin/lib/reconcile/archive-merged').archiveMerged({ cwd: root }); console.log(JSON.stringify(r)); process.exit(r.ownerlessNonClean === 1 ? 0 : 1)"`
Expected: FAIL (exit 1). The printed result has no `ownerlessNonClean` key. An empty `.git` directory is enough for `mainCheckoutRoot`, and the run is skipped `no-worktree`. Then `node --test tests/bin-lib/reconcile/archive-merged.test.js` fails on the `AC6.1` and `AC6.2` tests.

- [ ] **Step 3: Implement** `countOwnerlessNonClean` and the return field as described under Interfaces. Give the function a comment stating why absent files count: `runLiveness`'s legacy route serves them too (spec).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-linked-worktree.test.js tests/reconcile.test.js`
Expected: PASS

**Real-input probe** (read-only, before the whole-branch review). Run `countOwnerlessNonClean` against the main checkout:

```bash
node -e "console.log(require('./plugin/bin/lib/reconcile/archive-merged').countOwnerlessNonClean('/Users/thomasholknielsen/Code Workspaces/claude-tweaks'))"
```

Reconcile the result against the independent tally recorded at authoring time (2026-10-26). That tally is a plain `readdirSync` over `RUN_ID_RE` dirs, with no archive-twin filter, and read `{"absent":430,"ownerlessNonClean":95,"ownerBlock":0,"clean":32,"unparseable":0,"nonObject":0,"total":557}`. That is 525 before the iterator's filters. Count the dirs whose `archive/{name}/run-state.json` is `clean`; the reader's value must equal 525 minus that count, give or take any run dirs created or archived since. Record both numbers in the ledger.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Count owner-less non-clean run dirs after archival — ownerlessNonClean on the archive result (#4421)"
```

### Task 4: Carry `ownerlessNonClean` through the reconcile result, summary line and cache

**Files:**
- Modify: `plugin/bin/lib/reconcile/cache.js`
  - In `readCache`, conditionally spread the two keys, and add them to its shape comment.
  - Add and export `applyOwnerlessNonClean`.
- Modify: `plugin/bin/lib/reconcile/index.js`
  - In the archive block: `if (typeof r.ownerlessNonClean === 'number') result.ownerlessNonClean = r.ownerlessNonClean;`.
  - In `finalize`'s `!dryRun` write, widen the gate with `|| typeof result.ownerlessNonClean === 'number'`, and set `update` to `applyOwnerlessNonClean(update, result.ownerlessNonClean, Date.now())` when it is a number.
  - The initial `result` literal (line 149) does not gain the key.
- Modify: `plugin/bin/lib/reconcile/format-summary.js`
  - Add a `formatOwnerlessLine` that returns `ownerless non-clean: ${n} ${pluralize('run dir', n)}` when `Number.isInteger(n)`, `0` included, else `null`.
  - Push it right after the residue-plan line.
  - Its header's list of line kinds gains it.
- Test: `tests/bin-lib/reconcile/cache.test.js`, `tests/reconcile.test.js`
- Consumers of `reconcile()`'s result, enumerated:
  - `plugin/bin/hooks.js` `reconcile`: `--json` passes the field through. The default path calls `formatSummary`, which renders the new line. The catch fallback's literal `out` has no key, so the field stays absent.
  - `reconcile-background`'s status `summary` (`hooks.js`): pick-one, reads named counts only, unchanged.
  - `session-start.js`'s `FAST_CHECKS` pass: never runs archive, so the field stays absent.
  - `residue-summary.js`'s `formatReconcileSummary`: unchanged; the spec names `format-summary.js` as the summary.
- Other `readCache` writers keep the keys through their `{ ...readCache(root), … }` spread: `origin-head.js`, `pr-state-cache.js`, `release-merged.js`, and `cache.js`'s own batch and residue writers.

**Interfaces:**
- Consumes: `archiveMerged(...).ownerlessNonClean` (Task 3).
- Produces: `applyOwnerlessNonClean(cache: object, count: number, nowMs: number) -> object`. It is pure: a new object with `ownerlessNonClean: count`.
  - When `count === 0`, it also sets `ownerlessNonCleanZeroSince` to the existing stamp, or `new Date(nowMs).toISOString()` when there is none.
  - When `count > 0`, the returned object has no `ownerlessNonCleanZeroSince` key.
- Produces: `readCache(root)` adds `ownerlessNonClean` only when it is an integer `>= 0`, and `ownerlessNonCleanZeroSince` only when it is a string with a finite `Date.parse`.
- Produces: `reconcile()` result `ownerlessNonClean?: number`.

- [ ] **Step 1: Write the failing tests**
  - `cache.test.js`:
    - `AC6.2 AC6.3: applyOwnerlessNonClean stamps the first zero, keeps it, and clears it above zero`. Each assertion in order:
      - `applyOwnerlessNonClean({}, 0, Date.parse('2026-10-26T00:00:00Z'))` deep-equals `{ ownerlessNonClean: 0, ownerlessNonCleanZeroSince: '2026-10-26T00:00:00.000Z' }`.
      - Applying `0` again at a later `nowMs` keeps `'2026-10-26T00:00:00.000Z'`.
      - Applying `2` gives `{ ownerlessNonClean: 2 }` with no `ownerlessNonCleanZeroSince` key.
    - `readCache keeps valid ownerless keys and drops invalid ones`. The round-trip `{ ownerlessNonClean: 0, ownerlessNonCleanZeroSince: '2026-10-26T00:00:00.000Z' }` survives. These are dropped: `-1`, `1.5`, `'3'`, `'not a date'`, `null`.
  - `tests/reconcile.test.js`. These use `dryRunFixture()`. `owned(n)` writes `n` owner-block dirs (`config.yml` plus an `owner` object), and `cacheJson(root)` is `JSON.parse` of `cachePath(root)`'s file.
    - `AC6.2 AC7.1: a pass over only owner-block runs reports 0 on the result, the summary line and the cache, and stamps ownerlessNonCleanZeroSince`
      - `r = await run({})`, then:
        - `r.ownerlessNonClean === 0`;
        - `formatSummary(r)` matches `/^ownerless non-clean: 0 run dirs$/m`;
        - `cacheJson(root).ownerlessNonClean === 0`;
        - `typeof cacheJson(root).ownerlessNonCleanZeroSince === 'string'`.
      - A second `run({})` leaves the stamp byte-equal (Review Focus 5).
    - `AC6.3: a later pass with a count above 0 clears ownerlessNonCleanZeroSince`
      - After the AC6.2 passes, add one owner-less non-clean dir and `run({})`.
      - `r.ownerlessNonClean === 1`, `cacheJson(root).ownerlessNonClean === 1`, and `'ownerlessNonCleanZeroSince' in cacheJson(root) === false`.
    - `AC6.4: a skipped pass leaves both fields absent`
      - With owner-less dirs present, `run({ checks: ['console'] })` and `run({ dryRun: true })` both give a result with no `ownerlessNonClean` key.
      - The cache file is absent, or has neither key.

- [ ] **Step 2: Run the RED probe**

Run: `node -e "const s = require('./plugin/bin/lib/reconcile/format-summary').formatSummary({ ownerlessNonClean: 3 }); const c = require('./plugin/bin/lib/reconcile/cache'); console.log(JSON.stringify(s)); process.exit(s === 'ownerless non-clean: 3 run dirs' && typeof c.applyOwnerlessNonClean === 'function' ? 0 : 1)"`
Expected: FAIL (exit 1). It prints `"reconcile: nothing to do"`, and `applyOwnerlessNonClean` does not exist. Then `node --test tests/bin-lib/reconcile/cache.test.js` fails with "applyOwnerlessNonClean is not a function".

- [ ] **Step 3: Implement** the three module changes listed under Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/cache.test.js tests/reconcile.test.js tests/bin-lib/hooks/reconcile-background.test.js tests/bin-lib/hooks/reconcile-summary.test.js tests/bin-lib/reconcile/pr-state-cache.test.js tests/bin-lib/reconcile/release-merged.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/cache.js plugin/bin/lib/reconcile/index.js plugin/bin/lib/reconcile/format-summary.js tests/bin-lib/reconcile/cache.test.js tests/reconcile.test.js
git commit -m "Report ownerlessNonClean on the reconcile result, summary and cache — with ownerlessNonCleanZeroSince (#4421)"
```

### Task 5: Document the migration and the legacy-route removal condition

**Files:**
- Modify: `docs/reconcile-checks.md`. Add a section directly after the lifecycle-classifier section, before `## No-run-state.json terminal path…`. Its heading is "abandoned-interrupted through run-liveness, and ownerlessNonClean (#4421)", with the two identifiers in code spans. It covers:
  1. The rule: the cheap guards, then route (a) and route (b), with the exact conditions from Global Constraints. Name `ctx.runVerdict`/`defaultRunVerdict` and the main-checkout adjustment through `recordedWorktreeIsMainCheckout`.
  2. **The 24-hour floor:** `STALE_INTERRUPTED_TTL_MS` is unchanged (maintainer ruling 2026-10-22). Revisit trigger: "revisit once the owner block has shipped for a release".
  3. **The bounded fallback (b):** maintainer ruling 2026-10-26. Without it, owner-block runs that read `unknown` forever would never be archived, where they were archived at 24 hours before.
  4. **The changed equivalence rows:** every row of this plan's PR-body equivalence table whose Changed column is not `no`, verbatim.
  5. **`ownerlessNonClean`:** what it counts, measured after the pass's archival; why absent `run-state.json` counts; absent on a skipped, dry-run or errored pass; and `ownerlessNonCleanZeroSince`'s set/keep/clear rule.
  6. **Removal condition:** a bold lead-in, "Removal condition for the 72-hour legacy route", then `run-liveness/index.js`'s `legacy` witness in parentheses, then a colon and the Global Constraints sentence, verbatim. Follow it with: "After the route is removed, fallback (b) still drains owner-less runs, so other checkouts do not leak."

  Also, in the lifecycle-classifier section's first paragraph, add `ctx.runVerdict` beside the `liveness` sentence.
- Modify: `docs/hooks.md:59`. Edit in place, no reflow.
  - "Two routes consume it: … ; and `checkResumeFreshness` and `parentLiveDetail` (#4420), …" becomes "Three routes consume it: …", with a third clause: "and `archive-merged.js`'s `abandoned-interrupted` kind (#4421), through `defaultRunVerdict`, which forces the path probe to `missing` for a run whose recorded worktree is the main checkout and archives only on `dead` past 24 h or on `unknown` with no positive live probe past 72 h".
  - "The remaining consumers are #3977 and #4421." becomes "The remaining consumer is #3977."
  - Append the same bold removal-condition sentence as `docs/reconcile-checks.md` item 6, verbatim.
- Modify: `docs/plugin-structure.md:44`, which has the same two stale sentences ("Two routes consume it", "The remaining consumers are #3977 and #4421."). Give it the three-route wording, without the removal condition.
- Test: `tests/reconcile.test.js`, beside the existing `docs/reconcile-checks.md prerequisite table` test.

**Interfaces:**
- Consumes: the PR-body equivalence table below, and the Global Constraints' removal sentence.

- [ ] **Step 1: Write the failing test**

```js
test('AC7.2: docs/reconcile-checks.md and docs/hooks.md state the legacy-route removal condition verbatim (#4421)', () => {
  const sentence = 'remove it when `ownerlessNonCleanZeroSince` is at least 7 days old in this repository\'s `reconcile-cache.json`, on a plugin build newer than v6.153.0.';
  for (const doc of ['reconcile-checks.md', 'hooks.md']) {
    const text = readText(path.join(__dirname, '..', 'docs', doc)).replace(/\s+/g, ' ');
    assert.ok(text.includes(sentence), `${doc} must carry the removal condition verbatim`);
  }
  const hooks = readText(path.join(__dirname, '..', 'docs', 'hooks.md'));
  assert.ok(!hooks.includes('The remaining consumers are #3977 and #4421.'), 'docs/hooks.md still lists #4421 as a future consumer');
});
```

- [ ] **Step 2: Run the RED probe**

Run: `node -e "const fs = require('fs'); const ok = ['docs/reconcile-checks.md', 'docs/hooks.md'].every((f) => fs.readFileSync(f, 'utf8').replace(/\s+/g, ' ').includes('is at least 7 days old in this repository')); process.exit(ok ? 0 : 1)"`
Expected: FAIL (exit 1). Neither doc carries the removal condition today. Then `node --test --test-name-pattern="AC7.2" tests/reconcile.test.js` fails on the `includes` assertion.

- [ ] **Step 3: Write the doc edits** listed under Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/reconcile.test.js`
Expected: PASS
Run: `git grep -n -i -e "remaining consumers are #3977 and #4421" -e "Two routes consume it" -- docs plugin ':!docs/superpowers/plans'`
Expected: no output. Plans are history; the #4420 plan quotes the old sentence.

- [ ] **Step 5: Commit**

```bash
git add docs/reconcile-checks.md docs/hooks.md docs/plugin-structure.md tests/reconcile.test.js
git commit -m "Document abandoned-interrupted through run-liveness and the legacy-route removal condition (#4421)"
```

## AC coverage

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 2 Step 4. Every existing `abandoned-interrupted` fixture keeps its decision: the four `fixtureAbandonedShippedRun` tests, the two `#4032` tests, the four direct `isAbandonedInterrupted` tests, `reconcile-background.test.js`'s two `#1687` tests, and `reconcile.test.js`'s `#4179` tests. The intentional changes are the rows marked changed in the PR-body table. |
| AC1.2 | Task 2 Files: the migrated fixtures inject `runVerdict: DEAD` via `archiveMerged({ runVerdict })` or the trailing `ctx`. |
| AC2.1 | Task 2 `AC2.1` |
| AC2.2 | Task 2 `AC2.2` |
| AC3.1 | Task 2 `AC3.1` (fake rows plus the real other-host and mismatch rows) |
| AC3.2 | Task 2 `AC3.2` (fake plus the real pid-gone row) |
| AC4.1 | Task 1 `AC4.1` (predicate); Task 2 `AC4.1` (real probes, default hook) |
| AC5.1 | Task 2 `AC5.1` and `AC5.1 no reference time` |
| AC6.1 | Task 3 `AC6.1` |
| AC6.2 | Task 3 `AC6.2`; Task 4 `AC6.2 AC7.1` and the cache-unit `AC6.2 AC6.3` |
| AC6.3 | Task 4 `AC6.3` and the cache-unit `AC6.2 AC6.3` |
| AC6.4 | Task 3 `AC6.4`; Task 4 `AC6.4` |
| AC7.1 | Task 4 `AC6.2 AC7.1` (`formatSummary` line plus the `reconcile-cache.json` key) |
| AC7.2 | Task 5 `AC7.2` |
| AC8.1 | Central `verify.js` full suite after the last task (`/build` Common Step 5) |

Waived `plugin/bin/lib/run-liveness/constants.js`: Task 2 imports its `LEGACY_DEAD_MS` unchanged; the spec's Key Files names it as the source of the fallback's floor, not as a file to edit.

## PR-body equivalence table (Task 0; the controller pastes this into the PR's #4421 section; the rows marked changed also go into `docs/reconcile-checks.md`, Task 5)

All rows have status `interrupted`. "Stale" is measured from the last own event, or from the run id when there is none. "Main checkout" means the recorded worktree resolves to the main checkout; such a run reads its lock and commit probes as `no-worktree`, through `defaultRunVerdict`'s adjustment.

| Owner block | Owner-pid detail | Worktree | Own events | Own session | Old | New | Changed |
|---|---|---|---|---|---|---|---|
| any | any | any | any | yes | not abandoned | not abandoned | no |
| any | any | any | log unreadable or absent | no | not abandoned | not abandoned | no |
| any | any | any | recent (24 h or less) | no | not abandoned | not abandoned | no |
| absent | `no-owner-block` | none, linked-and-gone, or main checkout | stale over 72 h | no | abandoned | abandoned (`dead`, legacy witness, route a) | no |
| absent | `no-owner-block` | none, linked-and-gone, or main checkout | stale 24–72 h | no | abandoned | not yet (`unknown`); abandoned past 72 h by route b | yes: the legacy witness needs 72 h |
| absent | `no-owner-block` | any | none own; run id under 24 h | no | abandoned on first pass | not abandoned | yes: measured from the run id (AC5) |
| absent | `no-owner-block` | none or linked-and-gone | none own; run id 24–72 h | no | abandoned | not yet; abandoned once the run id is 72 h old | yes: measured from the run id |
| absent | `no-owner-block` | linked-and-present, lock free, commit 10 min–72 h | stale over 24 h | no | abandoned at 24 h | abandoned past 72 h by route b (no legacy witness while the commit is newer than 72 h) | yes: 24 h becomes 72 h |
| present | `gone` or `pid-reused` | none, linked-and-gone, or main checkout | stale over 24 h | no | abandoned | abandoned (`dead`, pid witness, route a) | no (AC4 for main checkout) |
| present | `no-pid` or `alive-no-start-time`, with a SessionEnd witness | none, linked-and-gone, or main checkout | stale over 24 h | no | abandoned | abandoned (`dead`, session-end witness, route a) | no |
| present | `no-pid` or `alive-no-start-time`, no SessionEnd | none, linked-and-gone, or main checkout | stale 24–72 h | no | abandoned | not yet; route b past 72 h | yes: no death witness |
| present | `other-host` | none, linked-and-gone, or main checkout | stale 24–72 h | no | abandoned | not yet; route b past 72 h | yes: no death witness (AC3) |
| present | mismatch (`owner-session-mismatch`) | any without a live positive | stale 24–72 h | no | abandoned | not yet; route b past 72 h | yes: the owner probes error (AC3) |
| present | error (hostname/`pidAlive`/start-time probe throws, `start-time-unavailable`, `invalid-start-time`) | any without a live positive | stale 24–72 h | no | abandoned | not yet; route b past 72 h | yes: `unknown` |
| present | `alive` (start time matches) | any | stale over 24 h | no | abandoned | never while alive (`live`) | yes: a live owner blocks (AC2) |
| any | any | linked-and-present, lock in use or commit under 10 min | stale over 24 h | no | abandoned | never (`live`) | yes: a live probe blocks (AC2) |
| any | `gone`/`pid-reused` or `no-owner-block` | linked-and-present, lock or commit probe errors | stale 24–72 h | no | abandoned | not yet (`unknown`); route b past 72 h | yes: an error never takes route a |
| present | any non-positive | any without a live positive | stale over 72 h | no | abandoned | abandoned (route a or b) | no |
