# Hung-Forge Degrade Memo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `gh` hangs, the PreToolUse PR-stamp gate pays the forge probe at most once per 60 s per run instead of on every covered call, without ever caching a degraded detection as `prExempt`.

**Architecture:** `resolveRunPinnedIntegrationModel` (`plugin/bin/lib/hooks/pre-tool-use.js`) gains an opt-in `degradeMemoTtlMs` option. After the run-pin check falls through, and only when that option is set and `runDir` is a non-empty string, it reads `forgeDegradedAt` from `{runDir}/run-state.json`. A fresh memo short-circuits detection: report a memoized degrade through `onDegrade`, return `'local-merge'`. Otherwise it detects; a degrade stamps `forgeDegradedAt`, and a clean result clears a present memo. Only the gate passes the option; `precondition.js` (a CLI) keeps live detection. The gate's own Q5 logic (`degraded` → no `prExempt`) is unchanged, because a memo hit calls `onDegrade`.

**Tech Stack:** Node 18+, `node --test`, the existing `ctxLib.readRunState` / `ctxLib.writeRunState` (`plugin/bin/lib/hooks/context.js`), `fakeGh` (`tests/helpers/fake-gh.js`).

**Spec:** `.claude-tweaks/pipelines/2026-11-01T182344-spec-4830/work/4830-spec.md`

## Global Constraints

- Memo field: `forgeDegradedAt` in `{run-dir}/run-state.json`, epoch milliseconds (number).
- TTL constant: `FORGE_DEGRADE_MEMO_TTL_MS = 60000` in `plugin/bin/lib/policy-schema.js`, exported beside `HOOK_FORGE_PROBE_TIMEOUT_MS`.
- Freshness rule: `Number.isFinite(at) && 0 <= now - at && now - at < ttlMs`. Anything else (absent, `null`, non-number, future, expired) means probe.
- Never write `prExempt` from the memo path (#4578 Q5). Clear with `forgeDegradedAt: null` (writeRunState merges, so `null` overwrites).
- A pinned run (`resolvePolicyConfig` source `run-config` or `policy`) never reads the memo.
- `precondition.js`'s call (`resolveRunPinnedIntegrationModel(mainRoot, runDir, { onDegrade })`) must behave exactly as today: no memo read, no memo write.
- Existing tests `bookkeeping-stamps gate (#4578 Q5): a degraded detection never persists prExempt` and `... the override receives an onDegrade callback; a clean local-merge still persists prExempt` stay green unchanged.
- Every new test goes red against pre-change code (prove by reverting the source change) — AC7.1; each task's Step 2 run is that red proof.
- Waived AC7.2: the full `npm test` run is `/build` Common Step 5's job, not a per-task step.
- Fake-`gh` tests carry `{ skip: STUB_SKIP }` (`tests/helpers/path-stub.js`), like the existing #4578 tests.
- No new exemption: a memo hit must reach exactly the gate outcome a fresh degrade reaches (allow, no `prExempt`). `.claude/skills/pre-tool-use-gate-exemptions` governs exemptions on this file's deny gates; this change adds none and changes no allow/deny decision, only whether the probe runs.

## Review Focus

- **A future `forgeDegradedAt` (clock skew, hand edit) must not suppress detection forever.** Pinned in Task 1 (`isFreshForgeDegradeMemo` future case) and Task 2 (future memo probes).
- **The CLI caller must not inherit the memo.** `precondition.js` passes no `degradeMemoTtlMs`, so a fresh memo is ignored there. Pinned in Task 2 (no-opt-in test).
- **A recovered forge must be able to enforce again.** After expiry a clean probe clears the memo and the gate resumes normal behavior, including `prExempt` for a clean `local-merge`. Pinned in Task 2 (clear on clean) and Task 3 (gate-level recovery).
- **A garbled `run-state.json` must not throw out of the hook.** `ctxLib.readRunState` already returns `null` on a parse failure; treat `null` state as "no memo". Pinned in Task 2 (garbled file probes, no throw).
- **The boundary at exactly TTL.** `now - at === ttlMs` counts as expired. Pinned in Task 1.

---

### Task 1: TTL constant and freshness predicate

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (constant beside `HOOK_FORGE_PROBE_TIMEOUT_MS`, ~line 756; export list ~line 1009)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (new helper near `resolveRunPinnedIntegrationModel`, ~line 1670; export list ~line 2521)
- Test: `tests/hooks-pre-tool-use.test.js` (append after the existing #4578 resolver tests, before the `#1967` block)

**Interfaces:**
- Produces: `FORGE_DEGRADE_MEMO_TTL_MS` (number, 60000) exported from `policy-schema.js`.
- Produces: `isFreshForgeDegradeMemo(at: unknown, now: number, ttlMs: number) -> boolean` exported from `pre-tool-use.js`.

- [ ] **Step 1: Write the failing tests**

```js
test('FORGE_DEGRADE_MEMO_TTL_MS is 60 s (#4830)', () => {
  const { FORGE_DEGRADE_MEMO_TTL_MS } = require('../plugin/bin/lib/policy-schema');
  assert.strictEqual(FORGE_DEGRADE_MEMO_TTL_MS, 60000);
});

test('isFreshForgeDegradeMemo: fresh only for a finite past timestamp younger than the TTL (#4830)', () => {
  const f = pre.isFreshForgeDegradeMemo;
  assert.strictEqual(f(1000, 1000, 60000), true);        // age 0
  assert.strictEqual(f(1000, 60999, 60000), true);       // age TTL-1
  assert.strictEqual(f(1000, 61000, 60000), false);      // age === TTL -> expired
  assert.strictEqual(f(5000, 1000, 60000), false);       // future
  for (const bad of [undefined, null, '1000', NaN, Infinity, {}]) assert.strictEqual(f(bad, 1000, 60000), false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="4830" tests/hooks-pre-tool-use.test.js`
Expected: FAIL after Step 1 (`FORGE_DEGRADE_MEMO_TTL_MS` undefined; `pre.isFreshForgeDegradeMemo is not a function`). Before Step 1 the pattern matches no test, so the run exits 0. Covers AC4.1's freshness rule at the unit level.

- [ ] **Step 3: Add the constant and the predicate**

The constant's comment states the derived worst case: at most one 15 s hook probe (`GIT_REMOTE_PROBE_TIMEOUT_MS` + `FORGE_PROBE_ATTEMPTS` x `HOOK_FORGE_PROBE_TIMEOUT_MS`) per TTL of hooked activity while `gh` stays hung (#4830). The predicate implements the Global Constraints freshness rule exactly.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test --test-name-pattern="4830" tests/hooks-pre-tool-use.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-pre-tool-use.test.js
git commit -m "Add FORGE_DEGRADE_MEMO_TTL_MS and isFreshForgeDegradeMemo — #4830 degrade memo freshness rule"
```

### Task 2: Opt-in degrade memo in `resolveRunPinnedIntegrationModel`

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (`resolveRunPinnedIntegrationModel`, ~lines 1640-1685, and its header comment)
- Test: `tests/hooks-pre-tool-use.test.js` (after Task 1's tests)

Waived plugin/bin/lib/hooks/context.js: read only (`readRunState`, `writeRunState` used unchanged)
Waived tests/helpers/fake-gh.js: read only (the counting fake is used unchanged)

**Interfaces:**
- Consumes: `isFreshForgeDegradeMemo` (Task 1); `ctxLib.readRunState(runDir)`, `ctxLib.writeRunState(runDir, patchOrFn)`.
- Produces: `resolveRunPinnedIntegrationModel(mainRoot, runDir, opts)` where `opts` gains `degradeMemoTtlMs?: number` (positive integer enables the memo) and `now?: () => number` (default `Date.now`, a test seam). On a memo hit it calls `opts.onDegrade({ memoized: true, degradedAt })` (deliberately no `reason` key, so nothing mistakes it for a `FORGE_DEGRADE_REASON` code) and returns `'local-merge'` without spawning `gh` or `git`.

Behavior after the pin check falls through, when `Number.isInteger(opts.degradeMemoTtlMs) && opts.degradeMemoTtlMs > 0` and `runDir` is a non-empty string:
1. `state = ctxLib.readRunState(runDir)`. If `isFreshForgeDegradeMemo(state && state.forgeDegradedAt, now(), ttl)`, take the memo hit above.
2. Otherwise detect as today, wrapping `onDegrade` to record whether it fired, and still forward it to the caller's `onDegrade`.
3. Degraded → `ctxLib.writeRunState(runDir, { forgeDegradedAt: now() })`. Clean → `ctxLib.writeRunState(runDir, (s) => (s.forgeDegradedAt == null ? null : { forgeDegradedAt: null }))` (no write when there is nothing to clear).

Without the option, the function is byte-for-byte today's behavior.

Test fixture for every test below: `unpinnedRepoWithOrigin()` (existing helper), a fresh `fs.mkdtempSync(path.join(os.tmpdir(), 'ct-4830-run-'))` run dir per test (never `runDirForId`, which is shared across tests), `withoutGhTimeoutEnv`, `timeoutMs: 1000`, and an injected `now`. Helper for reading state: `JSON.parse(fs.readFileSync(path.join(run, 'run-state.json'), 'utf8'))`.

- [ ] **Step 1: Write the failing tests** (all `{ skip: STUB_SKIP }`, names prefixed `#4830 memo:`)

```js
// a) degrade stamps the memo; a second call inside the TTL spawns no gh and reports a memoized degrade
//    gh = fakeGh({ first: 'hang' }); opts = { timeoutMs: 1000, degradeMemoTtlMs: 60000, now: () => T, onDegrade: (d) => seen.push(d) }
//    call 1 -> 'local-merge'; gh.count() === 2; state.forgeDegradedAt === T; seen[0].reason === 'timeout'
//    call 2 with now: () => T + 59999 -> 'local-merge'; gh.count() === 2; seen[1] deepEquals { memoized: true, degradedAt: T }
// b) an expired memo re-probes and refreshes the stamp
//    pre-write run-state.json { forgeDegradedAt: T }; now: () => T + 60000; 'hang' -> gh.count() === 2; state.forgeDegradedAt === T + 60000
// c) a future memo and a non-numeric memo both probe
//    forgeDegradedAt: T + 1000 with now T -> gh.count() === 2; then a fresh run dir with forgeDegradedAt: 'x' -> count rises by 2
// d) a garbled run-state.json probes and does not throw
//    write 'not json' to run-state.json -> 'hang' -> no throw, gh.count() === 2, then forgeDegradedAt is a number
// e) a clean detection clears a stale memo
//    pre-write { forgeDegradedAt: T - 60000 }; fakeGh({ first: 'fail' }) -> 'local-merge'; state.forgeDegradedAt === null; seen deepEquals []
// f) a pinned run ignores a fresh memo
//    repo policy.yml 'integration-model: local-merge\n'; pre-write { forgeDegradedAt: T }; 'hang' -> gh.count() === 0; seen deepEquals []
// g) without degradeMemoTtlMs (precondition.js's call shape) a fresh memo is ignored and nothing is written
//    pre-write { forgeDegradedAt: T }; opts = { timeoutMs: 1000, onDegrade, now: () => T } -> gh.count() === 2;
//    run-state.json byte-identical to what was pre-written
// h) an empty runDir with the option set probes and writes nothing (the runDir guard decides this alone)
//    run with process.chdir() into a fresh mkdtemp dir (restore cwd in finally):
//    resolveRunPinnedIntegrationModel(repo, '', { timeoutMs: 1000, degradeMemoTtlMs: 60000, now: () => T }) -> 'local-merge', gh.count() === 2,
//    and fs.existsSync(path.join(thatTmpDir, 'run-state.json')) === false
```

Guard discrimination: deleting the `degradeMemoTtlMs` guard turns g) red (count 0, state rewritten). Deleting the `runDir` guard turns h) red: measured on 2026-11-01, `ctxLib.writeRunState('', patch)` does not throw. It writes `run-state.json` into the process cwd, which is why h) chdirs into a temp dir. Each freshness clause is isolated by Task 1's cases.

Write each comment block as its own `test(...)` with these exact assertions.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="#4830 memo" tests/hooks-pre-tool-use.test.js`
Expected: FAIL after Step 1. a) fails on `forgeDegradedAt === T` (undefined) and on call 2's count (4); b) and e) fail on their state assertions. Coverage: b) is AC2.1/AC2.2 (expiry re-probes, stamp refreshed); c) is AC4.1; f) is AC5.1; e) is AC3.1's memo-clearing half at resolver level. f) and g) pass before the change (they pin behavior the change must keep) — confirm they still pass after Step 3.

- [ ] **Step 3: Implement the memo in `resolveRunPinnedIntegrationModel`**

Per the behavior list above. Extend the function's header comment with one paragraph: why the memo exists (#4830), that only the gate opts in, that a memo hit is reported through `onDegrade` so the gate's Q5 rule still withholds `prExempt`, and that the memo expires or is cleared on a clean detection.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test --test-name-pattern="#4830|4578" tests/hooks-pre-tool-use.test.js`
Expected: PASS (the existing #4578 resolver tests included)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-pre-tool-use.test.js
git commit -m "Memoize a degraded forge detection per run in resolveRunPinnedIntegrationModel — #4830 opt-in TTL memo"
```

### Task 3: Wire the gate and prove the probe count end to end

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (the gate's call, ~line 2107; `require('../policy-schema')` at line 37)
- Modify: `tests/hooks-pre-tool-use.test.js` (`GATE_CALL_SHAPE` and its go-red self-test, ~lines 1303-1338)
- Test: `tests/hooks-bookkeeping-stamps-gate.test.js` (after the existing #4578 Q5 tests, ~line 1811)

**Interfaces:**
- Consumes: Task 1's `FORGE_DEGRADE_MEMO_TTL_MS`; Task 2's `degradeMemoTtlMs` option.
- Produces: the gate call `resolveRunPinnedIntegrationModel(mainRoot, ctx.runDir, { timeoutMs: HOOK_FORGE_PROBE_TIMEOUT_MS, degradeMemoTtlMs: FORGE_DEGRADE_MEMO_TTL_MS, onDegrade })`. The override branch (`deps.resolveIntegrationModel`) is unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/hooks-bookkeeping-stamps-gate.test.js`, require `fakeGh` and `STUB_SKIP`. Each test adds `git -C {main} remote add origin https://github.com/o/n.git` to the fixture's main repo, so detection gets past the git remote probe to the fake `gh`.

```js
// #4830 AC1, { skip: STUB_SKIP }: three covered calls inside the TTL probe gh once
//   gh = fakeGh({ first: 'hang' }); fixture as the Q5 tests (gitRepo/linkedWorktreeOf/commitMaterializedSpec/mkRunDir) + origin remote
//   call 1: runState { status: 'active', worktree: wt }; calls 2 and 3: runState re-read from run-state.json (a fresh hook process loads it)
//   every call returns {}; gh.count() === 2 after call 3 (current code: 6)
//   persisted.forgeDegradedAt is a number; persisted.prExempt === undefined
// #4830 AC3, { skip: STUB_SKIP }: an expired memo plus a recovered (definitive) gh clears the memo and persists prExempt
//   mkRunDir(..., { forgeDegradedAt: Date.now() - 120000 }); gh = fakeGh({ first: 'fail' })
//   returns {}; persisted.forgeDegradedAt === null; persisted.prExempt === true
```

Update `GATE_CALL_SHAPE` to require `degradeMemoTtlMs: FORGE_DEGRADE_MEMO_TTL_MS` between `timeoutMs` and `onDegrade`, and the self-test's `live` string to match. The self-test's existing negative cases stay as they are.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="4830|4578|call-shape|HOOK_FORGE" tests/hooks-bookkeeping-stamps-gate.test.js tests/hooks-pre-tool-use.test.js`
Expected: FAIL. This run is the AC7.1 red proof for the gate-level tests. The AC1 test covers AC1.1, AC1.2, AC1.3 and AC1.4 and reports a count of 6. The AC3 test covers AC3.1. The two unchanged #4578 Q5 gate tests cover AC6.1 and AC6.2. AC1 reports a count of 6; AC3 fails on `forgeDegradedAt === null` (undefined); the call-shape test fails until the gate passes the new key. The AC1 test takes about 10 s (two real 5 s hook-bounded attempts); that is expected, so don't shorten it.

- [ ] **Step 3: Pass the option at the gate**

Import `FORGE_DEGRADE_MEMO_TTL_MS` beside `HOOK_FORGE_PROBE_TIMEOUT_MS` and add it to the call. Edit the Q5 comment above `if (degraded) modelResolved = false;` in place. Its "the next covered call detects again" is no longer exact; it becomes: the next covered call detects again once the run's degrade memo expires (#4830). Add: a memo hit arrives through `onDegrade` too, so it never persists `prExempt` either.

- [ ] **Step 4: Run to verify they pass**

Run: the Step 2 command
Expected: PASS, including both pre-existing #4578 Q5 gate tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-pre-tool-use.test.js tests/hooks-bookkeeping-stamps-gate.test.js
git commit -m "Pass the degrade memo TTL from the PR-stamp gate — #4830 one probe per minute while gh hangs"
```

### Task 4: Document the memo in `docs/hooks.md` and the #4578 journey

**Files:**
- Modify: `docs/hooks.md` (the "The run's pin, not a fresh detection." bullet, line 45)
- Modify: `docs/journeys/resolve-the-integration-model-on-a-slow-gh-host-4578.md` (step 4's "Should understand" line, line 46). It still calls the per-call cost "a known, undecided follow-up (#4830)". Rewrite it to say the gate now probes at most once per `FORGE_DEGRADE_MEMO_TTL_MS` (60 s) per run while `gh` stays hung, and notices recovery within that window. Add a Red flags entry: a run-state `forgeDegradedAt` with a `prExempt` beside it.
- No change (behavior-change sweep, `grep -rnE "detects again|detect again|never cached as|degraded detection" plugin docs`): `plugin/bin/manifesto-write.js:28` and `plugin/bin/lib/flow/manifesto-write.js:211,270` describe `resolve-policy.js --run` CLI reads, which do not opt in; `plugin/skills/_shared/integration-model.md:29` and `plugin/skills/flow/manifesto.md:167` describe the run pin, which is unchanged.

- [ ] **Step 1: Edit the bullet in place**

After the sentence ending `...so the next covered call detects again;`, say that a degraded detection is instead memoized as `run-state.json`'s `forgeDegradedAt` for `FORGE_DEGRADE_MEMO_TTL_MS` (60 s, #4830). Covered calls inside that window skip the probe and take the same fail-open, no-`prExempt` path. Expiry re-probes, a clean detection clears the memo, a pinned run never reads it, and the `check-pr-bookkeeping` CLI does not opt in. Keep the rest of the bullet byte-identical.

- [ ] **Step 2: Verify**

Run: `grep -c "forgeDegradedAt" docs/hooks.md` → Expected: `1` or more. Then `node --test tests/` restricted to suites that read `docs/hooks.md`: `grep -rl "hooks.md" tests | xargs node --test` → Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/hooks.md docs/journeys/resolve-the-integration-model-on-a-slow-gh-host-4578.md
git commit -m "Document the forge degrade memo in docs/hooks.md and the #4578 journey — #4830"
```

## Phase-exit confirmation (no task)

`plugin/bin/lib/phase-exit/phase-exit.js`'s `prPushReleased` mirrors the gate's release rules (#4026). The memo changes no release outcome, only whether the probe runs, so it needs no change. Confirm by reading `prPushReleased` during Task 3 and note the result in the Task 3 report.
