# Owner Liveness: One Judge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `refreshOwnerBlock`'s takeover decision and `runLiveness` judge the stamped owner pid through one function, so a failed start-time probe gets one verdict everywhere; the top-level `ownerPid` run-state field gets a recorded removal condition.

**Architecture:** `probeOwnerPid` moves out of `run-liveness/index.js` into a new leaf module `run-liveness/owner-pid-probe.js` (no requires at all), because `index.js` transitively requires `hooks/context.js` (through `hooks/run-integrity.js` and `run-liveness/probes.js`) and `context.js` therefore cannot require `index.js` without a cycle. `context.js`'s `stampedOwnerProvablyAlive` delegates to that probe and maps its tagged result to a boolean. Docs record the one-judge rule and the `ownerPid` removal condition.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T153206-record-4153/work/4153-spec.md` (record #4153)

Scope keywords: stampedOwnerProvablyAlive, probeOwnerPid, ownerPid

## Global Constraints

- No user-visible change (spec Release Note): run-owner liveness is judged one way across hooks and run cleanup.
- `owner-pid-probe.js` must contain no `require(` call (leaf module — the property `context.js` depends on).
- `index.js`'s exported surface (`PROBE_ORDER`, `gatherEvidence`, `decideVerdict`, `runLiveness`) and every `probeOwnerPid` result/detail string stay byte-identical.
- Commit style: `{Verb} {what} — {detail}`, ending with `refs #4153` and the trailer `Claude-Session: https://claude.ai/code/session_01DA8XWvNjoKiZWdBXJ9uucK`. Never `closes`/`fixes`.

## Review Focus

- A stored `pidStartedAt` that is not a string (e.g. a number) on a live pid: before this change `refreshOwnerBlock` read it as pid reuse and took the block over; after it, it is `error`/`invalid-start-time` and the block is kept — pinned by Task 2's table row.
- A stored `pid` of `0`, a negative, or above int32: now `negative`/`no-pid`, so the block may be taken over (previously `isPidAlive(0)` decided) — pinned by Task 2's table row.
- A throwing `hostname`/`isPidAlive`/`pidStartTime` probe: still never takes the block over (`error`) — the existing `a throwing liveness probe counts as alive — no re-stamp` test keeps pinning it.
- A require cycle reintroduced into `owner-pid-probe.js` would hand `context.js` a partial `module.exports` silently — pinned by Task 1's leaf test.
- `alive-no-start-time` (a live pid with no stored start time) must keep the block: it is a run-liveness `negative`, but not one that rules the stamped process out — pinned by Task 2's table row.

---

### Task 1: Extract `probeOwnerPid` into a leaf module

**Files:**
- Create: `plugin/bin/lib/run-liveness/owner-pid-probe.js`
- Modify: `plugin/bin/lib/run-liveness/index.js:26-94` (remove `MAX_PID`, `errorMessage`, `call`, `probeOwnerPid`; import them)
- Test: `tests/bin-lib/run-liveness/owner-pid-probe.test.js` (create)

**Interfaces:**
- Produces: `owner-pid-probe.js` exports `{ MAX_PID, errorMessage, call, probeOwnerPid }`. `probeOwnerPid(owner, p)` — `owner` is the run-state `owner` block or `null`; `p` is `{ hostname(): string, pidAlive(pid): boolean, pidStartTime(pid): string|null }`; returns `{ result: 'positive'|'negative'|'error', detail: string, witness?: true }` exactly as today.

- [ ] **Step 1: Write the failing test** — `tests/bin-lib/run-liveness/owner-pid-probe.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '../../../plugin/bin/lib/run-liveness/owner-pid-probe.js');

test('owner-pid-probe.js is a leaf module: it requires nothing, so hooks/context.js can require it without a cycle (#4153)', () => {
  const src = fs.readFileSync(FILE, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\brequire\s*\(/);
  const m = require(FILE);
  assert.deepStrictEqual(Object.keys(m).sort(), ['MAX_PID', 'call', 'errorMessage', 'probeOwnerPid']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/run-liveness/owner-pid-probe.test.js`
Expected: FAIL with "ENOENT"

- [ ] **Step 3: Create `owner-pid-probe.js` and re-wire `index.js`**

Move `MAX_PID` (with its comment), `errorMessage`, `call`, and `probeOwnerPid` verbatim from `index.js` into the new file, with a header stating it is the owner-pid probe shared by `runLiveness` and `hooks/context.js`'s `stampedOwnerProvablyAlive` (#4153) and must require nothing (`index.js` reaches `hooks/context.js` through `run-integrity.js` and `probes.js`). In `index.js`, delete those four declarations and add `const { MAX_PID, call, errorMessage, probeOwnerPid } = require('./owner-pid-probe');` beside the other requires (drop `MAX_PID` from the import if `index.js` no longer references it). Update `index.js`'s header comment to name the new module for the owner-pid probe.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/run-liveness/owner-pid-probe.test.js tests/bin-lib/run-liveness/index.test.js tests/reconcile.test.js`
Expected: PASS, 0 failures (index.test.js's existing `start-time-unavailable` and `AC8.1 ... invalid-start-time` cases prove the move kept behavior)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/run-liveness/owner-pid-probe.js plugin/bin/lib/run-liveness/index.js tests/bin-lib/run-liveness/owner-pid-probe.test.js
git commit -m "Extract probeOwnerPid into a leaf module — context.js can require it without a cycle, refs #4153"
```

### Task 2: Route `stampedOwnerProvablyAlive` through the probe

**Files:**
- Modify: `plugin/bin/lib/hooks/context.js:13-14` (require), `:840-854` (`stampedOwnerProvablyAlive` + comment)
- Test: `tests/hooks-context.test.js` (append after the `refreshOwnerBlock never throws` test, ~line 578)

**Interfaces:**
- Consumes: `probeOwnerPid` from `../run-liveness/owner-pid-probe` (Task 1).
- Produces: `stampedOwnerProvablyAlive(owner, { hostname, aliveFn, startFn }) -> boolean` — same signature and sole caller (`refreshOwnerBlock`); not exported.

- [ ] **Step 1: Write the failing test** — append to `tests/hooks-context.test.js`, reusing that file's `refreshFixture`, `refreshDeps`, `refresh`, `RT0`:

```js
// #4153: one judge — refreshOwnerBlock's takeover decision reads the same owner-pid
// probe runLiveness reports. Each row: owner-block override, probes, the owner-pid
// evidence entry, and whether a different current pid re-stamps the block.
test('AC1.1: refreshOwnerBlock and runLiveness give the same answer on the stamped owner pid, an unreadable start time included', () => {
  const { gatherEvidence } = require('../plugin/bin/lib/run-liveness');
  const rows = [
    { name: 'start time cannot be read', startOf: { 200: 'T200' }, entry: ['error', 'start-time-unavailable'], restamp: false },
    { name: 'stored start time is not a ps string', over: { pidStartedAt: 12345 }, entry: ['error', 'invalid-start-time'], restamp: false },
    { name: 'alive, start time matches', entry: ['positive', 'alive'], restamp: false },
    { name: 'alive, no stored start time', over: { pidStartedAt: null }, entry: ['negative', 'alive-no-start-time'], restamp: false },
    { name: 'pid reused', startOf: { 100: 'other', 200: 'T200' }, entry: ['negative', 'pid-reused'], restamp: true },
    { name: 'gone', alive: false, entry: ['negative', 'gone'], restamp: true },
    { name: 'stamped on another host', over: { host: 'elsewhere' }, entry: ['negative', 'other-host'], restamp: true },
    { name: 'stored pid is not a usable pid', over: { pid: 0 }, entry: ['negative', 'no-pid'], restamp: true },
  ];
  for (const row of rows) {
    const fx = refreshFixture(row.over || {});
    const deps = refreshDeps({ cur: 200, alive: row.alive ?? true, startOf: row.startOf });
    const probes = {
      hostname: deps.hostname, pidAlive: deps.isPidAlive, pidStartTime: deps.pidStartTime,
      lockInUse: () => false, lastCommitAt: () => null, ownEventAt: () => ({ lastOwnMs: null, lastSessionEndMs: null }),
    };
    const e = gatherEvidence(fx.dir, { now: RT0, probes }).evidence.find((x) => x.probe === 'owner-pid');
    assert.deepStrictEqual([e.result, e.detail], row.entry, row.name);
    assert.strictEqual(refresh(fx, { deps }) === 'restamp', row.restamp, row.name);
  }
});
```

(`refreshDeps`' destructuring default for `startOf` applies when `row.startOf` is `undefined`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern "AC1.1" tests/hooks-context.test.js`
Expected: FAIL on row `stored start time is not a ps string` (old code: `'T100' !== 12345` reads as pid reuse → `restamp`), assertion `true !== false`. (Row `stored pid is not a usable pid` also discriminates: old code asks `isPidAlive(0)` and keeps the block.)

- [ ] **Step 3: Implement** — in `context.js`, `const { probeOwnerPid } = require('../run-liveness/owner-pid-probe');` beside the existing run-liveness requires; replace `stampedOwnerProvablyAlive`'s body with one `probeOwnerPid(owner, { hostname, pidAlive: aliveFn, pidStartTime: startFn })` call returning `result !== 'negative' || detail === 'alive-no-start-time'`. Rewrite its comment: the verdict is run-liveness's owner-pid probe (one judge, #4153) — only a negative that rules the stamped process out (`other-host`, `no-pid`, `gone`, `pid-reused`) allows takeover; `positive`, `alive-no-start-time`, and every `error` (`start-time-unavailable`, `invalid-start-time`, a probe that threw) keep the block — the `error` cases are what `runLiveness` reads as `unknown`, and a question that could not be answered never takes a block over.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-context.test.js tests/bin-lib/run-liveness/index.test.js`
Expected: PASS, 0 failures (the existing `a failed start-time probe on a live owner is unknown, never dead` and `a throwing liveness probe counts as alive — no re-stamp` tests stay green)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/context.js tests/hooks-context.test.js
git commit -m "Route stampedOwnerProvablyAlive through run-liveness's owner-pid probe — one verdict for an unreadable start time, refs #4153"
```

### Task 3: Removal condition for `ownerPid` and cross-references

**Files:**
- Modify: `docs/hooks.md:59` (the "The `owner` block and `runLiveness` (#3973)" paragraph)
- Modify: `docs/plugin-structure.md:44` (the `plugin/bin/lib/run-liveness/` line)
- Modify: `plugin/bin/lib/hooks/context.js:796-807` (`ownerPidPatch` and `ownerBlock` comments)
- Modify: `plugin/bin/lib/hooks/session-start.js:69-76` (`restampOwnerPidOnResume` comment)

**Interfaces:** none (prose and comments only).

- [ ] **Step 1: `docs/hooks.md`** — in the owner-block paragraph, replace `beside \`ownerPid\` (#3845, unchanged)` with `beside \`ownerPid\` (#3845)` and append, after that sentence, a **Removal condition for top-level `ownerPid` (#4153)** sentence with these facts: `owner.pid` is the newer stamp of the same process; `ownerPid` survives only because `isNestedSession` (session-end's nested-session guard) reads it; retire it — `ownerPidPatch` stops stamping it and session-start's `restampOwnerPidOnResume` is deleted — once `isNestedSession` reads `owner.pid`, which first needs every writer that stamps `ownerPid` to stamp the owner block too (`record-worktree` stamps `ownerPid` from `CLAUDE_PID` alone but writes the owner block only with `CLAUDE_CODE_SESSION_ID`); checked when that reader migration lands. In the re-stamp sentence ("only when the stored owner process is not provably alive: …"), state that the decision is `run-liveness/owner-pid-probe.js`'s `probeOwnerPid` — the same probe `runLiveness` reports as its owner-pid entry — and that only `other-host`, `no-pid`, `gone` and `pid-reused` allow a re-stamp; every `error` (including a `null` start time, `start-time-unavailable`) keeps the block.
- [ ] **Step 2: `docs/plugin-structure.md`** — in the run-liveness line, add `owner-pid-probe.js (probeOwnerPid, the owner-pid probe shared by index.js's runLiveness and hooks/context.js's stampedOwnerProvablyAlive — requires nothing, #4153)` before `index.js (...)`.
- [ ] **Step 3: comments** — `ownerPidPatch`: one sentence that `owner.pid` (#3973, `ownerBlock` below) stamps the same process and that `ownerPid`'s removal condition is in docs/hooks.md's owner-block paragraph (#4153). `ownerBlock`: one sentence that its `pid` supersedes top-level `ownerPid` (#3845, `ownerPidPatch` above), kept only for `isNestedSession`. `restampOwnerPidOnResume`: one sentence that `refreshOwnerBlock` re-stamps `owner.pid` for the same resume, and that this function goes when `ownerPid` is retired (docs/hooks.md).
- [ ] **Step 4: Verify**

Run: `grep -n "Removal condition for top-level" docs/hooks.md` → one hit. Run: `grep -n "owner-pid-probe" docs/plugin-structure.md docs/hooks.md` → one hit in each. Run: `grep -n "#4153" plugin/bin/lib/hooks/context.js plugin/bin/lib/hooks/session-start.js` → hits in both files. Run: `node --test tests/hooks-context.test.js tests/hooks-session-start.test.js` → PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add docs/hooks.md docs/plugin-structure.md plugin/bin/lib/hooks/context.js plugin/bin/lib/hooks/session-start.js
git commit -m "Record the ownerPid removal condition and cross-reference both owner stamps — refs #4153"
```

## Scope sweep (plan-audit Check B, classified)

The `Scope keywords:` sweep matched these files outside the task list. None changes: this record records a removal condition for `ownerPid`, it does not remove or re-route it, and `probeOwnerPid`'s behaviour is moved, not edited.

- `plugin/bin/hooks.js` (record-worktree), `plugin/bin/lib/hooks/post-tool-use.js` (stampAdHocRunDir) — `ownerPid` writers; named by Task 3's removal condition, unchanged.
- `tests/hooks-dispatcher.test.js`, `tests/hooks-denial-run-dir.test.js`, `tests/hooks-post-tool-use-adhoc-rundir.test.js`, `tests/hooks-run-attribution.test.js`, `tests/hooks-session-start.test.js` — pin today's `ownerPid` stamping and `isNestedSession`; must stay green, unchanged.
- `plugin/bin/lib/run-liveness/process-probe.js` and its test — owner-block probes; unchanged.
- `plugin/bin/lib/file-lock.js` — an unrelated lock-holder local named `ownerPid`.
- `docs/journeys/run-a-nested-claude-session-inside-a-pipeline-run-3845.md` — describes `ownerPid` behaviour that does not change; `/claude-tweaks:journeys` (Common Step 6) decides whether its `files:` gains `owner-pid-probe.js`.
- `docs/superpowers/plans/2026-10-24-run-liveness-owner-block-3973.md`, `docs/plans/2026-10-25-owner-liveness-one-judge-ledger.md` — historical plan / this run's ledger.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (route through run-liveness's probe) | Tasks 1, 2 |
| Deliverable 2 (removal condition in docs/hooks.md) | Task 3 Step 1 |
| Deliverable 3 (cross-reference comments at both stamping sites) | Task 3 Step 3 |
| AC1.1 (same answer for an unreadable start time, test in tests/hooks-context.test.js) | Task 2 Step 1 |
| AC2.1 (docs/hooks.md names when ownerPid is removed) | Task 3 Steps 1, 4 |
| AC3.1 (`npm test` passes) | Common Step 5 verification (full suite, run centrally) |
