# detectIntegrationModel gh-timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `detectIntegrationModel` bounds its `gh repo view` probe with the repo's resolved `gh` timeout, retries once on a timeout, and reports a degraded detection (through an opt-in callback) that `resolve-policy.js` surfaces on stderr and in its JSON (the reason code, Decision Q13) — for the `integration-model` key and for a `merge-verification` request that runs its own forge detection (which now honours the run's `--run` `integration-model` pin first); both lifecycle hooks (PreToolUse and SessionStart) pass an explicit hook bound instead, the PreToolUse PR-stamp gate never caches a degraded detection as `prExempt`, the `/test` bookkeeping precondition reports a distinct `degraded-detection` reason (Q11), and the Manifesto never pins a degraded detection as the run's `integration-model` (Q10).

**Architecture:** All detection logic stays in `plugin/bin/lib/policy-schema.js`: a new `resolveForgeProbeTimeoutMs(repoRoot, opts)` (explicit `opts.timeoutMs` > valid `CLAUDE_TWEAKS_GH_TIMEOUT_MS` > `{repoRoot}/.claude-tweaks/policy.yml`'s `gh-timeout-ms` > 5000), error classification, one retry after a timeout, and `opts.onDegrade(degrade)` when the retry fails too. The string return is unchanged for every caller. `policy-derived-defaults.js` threads the callback into an additive `degraded` field holding the degrade's reason code — on the `integration-model` entry, and on the `merge-verification` entry when its fallback ran detection itself — and reports the full degrade object through an opt-in `deps.onDegrade(key, degrade)` side channel (the #4141 `invalidRaw` pattern), from which `resolve-policy.js` renders one stderr line per degraded key. The merge-verification fallback reads the run's `config.yml` `integration-model` pin (handed in as `deps.runConfigRaw`) before it ever calls `resolveIntegrationModel`. `pre-tool-use.js`'s `resolveRunPinnedIntegrationModel` takes `{ timeoutMs, onDegrade }` as a parameter (the hook passes `HOOK_FORGE_PROBE_TIMEOUT_MS` and a degrade flag; `precondition.js` passes `{ onDegrade }` only and returns `degraded-detection` on a degrade), the gate treats a degraded result like its catch branch (no `prExempt` cached), and `session-start.js` passes the same bound into `reconcile()`, which forwards it. `bin/manifesto-write.js` (and `flow/manifesto.md`'s prose Write mechanism) treat a degraded `integration-model` entry like the EMPTY-value branch: no run pin, a distinct `SKIP`.

**Tech Stack:** Node 18+ CommonJS, `child_process.execFileSync`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T082910-record-4578/work/4578-spec.md` (record #4578, including its thirteen `Decision (plan review, 2026-10-31)` bullets, Q1–Q13, and the closing rule)

**Scope keywords:** detectIntegrationModel, resolveRunPinnedIntegrationModel, gh-timeout-ms

## Global Constraints

- `detectIntegrationModel(repoRoot, opts)` keeps returning a bare `'pr-first' | 'local-merge'` string for every caller (additive only).
- Timeout precedence: explicit `opts.timeoutMs` (positive integer) > `CLAUDE_TWEAKS_GH_TIMEOUT_MS` (valid only within `gh-timeout-ms`'s bounds, 1000–60000; invalid falls through) > `gh-timeout-ms` from `{repoRoot}/.claude-tweaks/policy.yml` (via `resolveValue`, so out-of-range → 5000) > 5000.
- The `git remote get-url origin` probe keeps its own local bound: `GIT_REMOTE_PROBE_TIMEOUT_MS = 5000`, never the `gh` budget.
- Classification of an `execFileSync` throw: `err.code === 'ETIMEDOUT'` or `err.signal` set → timeout; `err.code === 'ENOENT'` → gh absent; anything else → definitive non-zero exit.
- Retry only after a first-attempt timeout, at most once, with the same timeout. A first-attempt ENOENT or non-zero exit is definitive: one invocation, no degrade.
- Decision Q4: after a first-attempt timeout, ANY failed retry (a second timeout, a non-zero exit, or ENOENT) is a degraded detection — `onDegrade` is called exactly once.
- Degraded fallback value stays `local-merge`. A throwing `onDegrade` must not break "never throws".
- Degrade object: `{ reason: 'timeout', timeoutMs, attempts: 2 }` (retry timed out) or `{ reason: 'timeout-then-exit', timeoutMs, attempts: 2 }` (retry failed any other way).
- `formatForgeDegrade` text (exact): reason `timeout` → `forge detection timed out after {ms} ms (x2)`; reason `timeout-then-exit` → `forge detection timed out after {ms} ms, then gh failed on retry`.
- Stderr line (exact): `resolve-policy: degraded — integration-model: {formatForgeDegrade text}; resolved local-merge — pin integration-model in .claude-tweaks/policy.yml or raise gh-timeout-ms`, printed once per process, in every output mode.
- Decision Q13: JSON entry on a degraded detection: `{ value: 'local-merge', source: 'default', degraded: '{reason}' }`, where `{reason}` is the degrade object's reason code, `'timeout'` or `'timeout-then-exit'`. Non-degraded entries keep exactly `{ value, source }`. `--values` stdout unchanged. The stderr text is rendered from the degrade object (`formatForgeDegrade(degrade)`, which also needs `timeoutMs`), so `computeDerivedDefaults` reports the whole object through an opt-in side channel, `deps.onDegrade(key, degrade)` (called once per degraded key; a throwing callback is swallowed), the same pattern as #4141's `onInvalid`/`invalidRaw` map in `resolve-policy.js`: the entry shape stays exactly what the JSON documents.
- Decision Q6: each degrade reason has its own text and its own CLI test — `timeout` (two timeouts) keeps "(x2)"; `timeout-then-exit` prints "…, then gh failed on retry".
- Decision Q7: whenever `computeDerivedDefaults`'s merge-verification fallback actually calls `resolveIntegrationModel` — `merge-verification` requested WITHOUT `integration-model`, OR requested WITH an `integration-model` entry that is `invalid` (its value is not a reusable string, so the fallback re-detects) — it passes `onDegrade`; a reported degrade adds `degraded: '{reason}'` (Q13's reason code) to the `merge-verification` entry and reports `deps.onDegrade('merge-verification', degrade)` (its value stays whatever `deriveMergeVerification` derives from the degraded `local-merge`, i.e. `off`), and `resolve-policy.js` prints the merge-verification stderr line below once per process. When both keys are requested and `integration-model` resolved to a valid value, merge-verification reuses it (no second detection), so only the `integration-model` line and `deps.onDegrade('integration-model', …)` report the degrade — but when that reused `integration-model` entry is itself degraded, the `merge-verification` entry carries the same `degraded` reason code (plan review: its value was derived from the degraded detection; no second stderr line, no second `onDegrade` call — it is the same detection).
- Plan review (implementer judgment under the closing rule): the Manifesto's `merge-verification` lever never pins a value derived from a degraded detection either. In `lib/flow/manifesto-write.js`'s `computeLevers`, a `merge-verification` entry with `source: 'default'` and a `degraded` field yields `{ value: 'wait', source: 'degraded' }`. Rationale: `_shared/pr-first-merge.md` Step 2.5 treats "a run-level `off` over another project value" as an explicit `off` (a blind merge), so a degraded-derived `off` pinned in `config.yml` would merge without waiting once a later detection resolves `pr-first`; the same step already rules that an unresolved lever is treated as `wait`, "never as `off`". A `policy.yml` value (`source: 'policy'`) is untouched. `writeManifesto` logs `AUTO Manifesto: merge-verification derived from a degraded forge detection → written as wait (an unresolved lever never becomes off, _shared/pr-first-merge.md Step 2.5)` when that lever's source is `degraded`.
- Plan review (implementer judgment under the closing rule): `plugin/bin/lib/phase-exit/phase-exit.js`'s `realDeps.resolvePolicy` is the one other run-time `--run integration-model` reader that a Q10-unpinned run reaches by CLI with its own kill timeout (30 s `GIT_TIMEOUT_MS`). It runs `resolve-policy.js --run <dir> <key>` in JSON mode instead of `--values`, returns the entry's value as a string (empty for a null/error entry, exactly what `--values` printed), and throws `Error('forge detection degraded ({reason})')` when the entry carries `degraded`, so `runPhaseExit`'s existing unresolved branch logs `condition: integration-model unresolved (forge detection degraded (timeout)) → fallback: no phase-exit push this phase; the next phase exit retries` instead of routing a degraded `local-merge`. For the `integration-model` key its timeout is `GIT_REMOTE_PROBE_TIMEOUT_MS + 2 * resolveForgeProbeTimeoutMs(cwd) + GIT_TIMEOUT_MS` (the ladder's worst case plus the old bound as margin); every other key keeps `GIT_TIMEOUT_MS`. The `resolvePolicy(runDir, key, cwd) -> string` seam signature is unchanged, so injected test fakes keep working.
- Decision Q8: the merge-verification fallback honours the run's pinned `integration-model` before any forge detection. `resolve-policy.js` passes `runConfigRaw` (already returned by `resolvePolicyConfig`) into `computeDerivedDefaults` as `deps.runConfigRaw`; the fallback resolves `resolvePolicyKeys(['integration-model'], { policyRaw: null, runConfigRaw: deps.runConfigRaw })` and, when that entry's `source === 'run-config'` and it is not `invalid`, derives from that value (`integrationModel: () => pinned`) and never calls `resolveIntegrationModel` (so never `gh` for forge detection, never `onDegrade`). No run pin → `resolveIntegrationModel(r, { mcpReachable, onDegrade })` as before, which already honours a `policy.yml` pin. `deps.runConfigRaw` absent (tests, other callers) → treated as no run pin. Note: `deriveMergeVerification`'s branch (3) `readDefaultBranch` is a separate `gh repo view` (defaultBranchRef) lookup outside forge detection, reached only for a `pr-first` model with PR-triggered CI under `.github/workflows`; the Q8 pin tests use a fixture repo with no `.github/workflows`, so ladder branch (2) returns `off` before it, and any `gh` invocation counted there is forge detection.
- Decision Q9: the merge-verification stderr line reuses Deliverable 4's shape with only the key name swapped — exact: `resolve-policy: degraded — merge-verification: {formatForgeDegrade text}; resolved local-merge — pin integration-model in .claude-tweaks/policy.yml or raise gh-timeout-ms`. Its `{formatForgeDegrade text}` is the same two texts the `integration-model` key prints ("(x2)" / "…, then gh failed on retry"); no new wording anywhere.
- Decision Q5: `resolveRunPinnedIntegrationModel(mainRoot, runDir, opts = {})` forwards `opts.timeoutMs` and `opts.onDegrade` to `detectIntegrationModel` (each only when set). The PR-stamp gate passes `{ timeoutMs: HOOK_FORGE_PROBE_TIMEOUT_MS, onDegrade }`, where `onDegrade` sets a local `degraded` flag; after resolution, `degraded` → `modelResolved = false`, so no `prExempt` is written and the next covered call detects again. The test-only `deps.resolveIntegrationModel` override receives the same `{ onDegrade }` as a second argument (existing one-argument overrides ignore it).
- Decision Q2: `HOOK_FORGE_PROBE_TIMEOUT_MS = 5000` (per gh attempt). Hook worst case `GIT_REMOTE_PROBE_TIMEOUT_MS + 2 * HOOK_FORGE_PROBE_TIMEOUT_MS = 15000` ms — "the hook budget" is that 15 s bound. One constant, exported from `policy-schema.js`, imported by both hooks.
- Decision Q3: `resolveRunPinnedIntegrationModel(mainRoot, runDir, opts = {})`; the PreToolUse gate passes `{ timeoutMs: HOOK_FORGE_PROBE_TIMEOUT_MS, onDegrade }` (the Q5 shape); `plugin/bin/lib/pr-bookkeeping/precondition.js` passes no `timeoutMs` and follows the ladder.
- Decision Q11: `precondition.js` calls `resolveRunPinnedIntegrationModel(mainRoot, runDir, { onDegrade })` (no `timeoutMs` — Q3 still holds), where `onDegrade` sets a local flag. A degraded detection returns `{ ok: true, reason: 'degraded-detection' }` — never `not-pr-first` — checked before the `model !== 'pr-first'` branch. `ok: true` keeps the module's fail-open-on-ambiguity posture (its header comment): a degraded detection cannot prove a violation. `check-pr-bookkeeping.js` already prints `check-pr-bookkeeping.js: ok ({reason})` on stdout for every ok result, so it needs no change. `/claude-tweaks:test`'s Step 0 (PR-Bookkeeping Precondition Check) Exit 0 bullet surfaces it: stdout `ok (degraded-detection)` → log one `SKIP` (`condition: check-pr-bookkeeping.js reported degraded-detection (forge detection timed out) → fallback: pr-first bookkeeping precondition not verified this run`), then continue.
- Decision Q10: a degraded `integration-model` resolution never becomes the run's pin. `bin/manifesto-write.js` reads the resolved entry: `degraded` set → `integrationModel = null` and `integrationModelDegraded = entry.degraded` passed to `writeManifesto`, which logs a distinct `SKIP` (`condition: integration-model forge detection degraded ({reason}) → fallback: config.yml written without the run pin; later --run reads detect again`) instead of the empty-value text, and the CLI's stderr says `manifesto-write.js: integration-model forge detection degraded ({reason}) — config.yml written without the run pin (SKIP logged)`. `flow/manifesto.md`'s Write mechanism (the `confirm`/`hybrid` prose path) gains one clause: a `resolve-policy: degraded — integration-model:` line on the resolve's stderr is handled like the EMPTY-value branch (omit the pair, log a `SKIP` naming the degrade). `steps-and-gates.md` case 3 cites "its empty-resolve rule" by reference, so it needs no edit. `_shared/integration-model.md`'s Run-scoped stability ("resolves `integration-model` once, at run start, and pins the value") gains one sentence naming the degraded exception (Task 7).
- Decision Q12: an invalid `--run` `integration-model` value is not a pin — the Q8 fallback requires `source === 'run-config'` and not `invalid`, so a `bogus` run value runs detection (pinned by the Q8 test's control case).
- Decision Q1: `session-start.js`'s inline `reconcile()` call passes `forgeProbeTimeoutMs: HOOK_FORGE_PROBE_TIMEOUT_MS`; `reconcile()` forwards it as `timeoutMs` to `resolveIntegrationModel` only when set (an unset option adds no key, so `{ mcpReachable }` stays the exact forwarded shape).
- No top-level `require('./policy')` or `require('./shared-primitives')` in `policy-schema.js` (require cycle / cwd-anchored getter). Use the module's own `readFileSafe`, `parseFlatLines`, `isValidValue`, `resolveValue`, `SCHEMA_BY_KEY`.
- Every real spawn keeps `windowsHide: true` in an options object literal `tests/windows-hide-spawn-conformance.test.js` can see (governing skill `gh-api-module-pattern`: "it accepts a literal `windowsHide` key there, or a bare identifier as the whole options argument whose own `const X = { … }` literal names it ... A spread ... satisfies neither and fails the full suite").
- Task 3 edits `plugin/bin/lib/hooks/pre-tool-use.js`, governed by `pre-tool-use-gate-exemptions`. Decision Q5 narrows when the `prExempt` memo is written (stricter, never looser), so no new exemption is added, but the skill's test rule applies to the new gate tests: "Write the test, revert only the code fix (`git checkout -- {file}` on that one file, not `git stash`), confirm the new test — and only the new test — fails, then restore the fix. A green suite alone is not evidence the test discriminates." `phase-exit.js`'s `prPushReleased` only reads `prExempt` (it never writes it), so the skill's "A change to that branch's release conditions changes `prPushReleased` in the same commit" rule needs no edit there: the release conditions themselves are unchanged.
- Every new test uses a fake `gh` (never the network); stub tests take `{ skip: STUB_SKIP }` from `tests/helpers/path-stub.js`; test fixtures live under `os.tmpdir()`.
- Commit messages: `{Verb} {what} — {detail}`, reference `refs #4578`, never `closes`/`fixes`.

## Review Focus

- A fake `gh` killed on timeout must not leave an orphaned `sleep` holding the stdout pipe — `execFileSync` would then block for the full sleep. The fake's hang/slow modes `exec` or trap-kill their sleep; Task 1 Step 4 checks the file's wall time.
- A caller requesting `integration-model` twice (`resolve-policy.js integration-model integration-model`) still prints exactly one degrade line — Task 2 test.
- A pin (policy.yml or `--run` config.yml) short-circuits before any `gh` spawn — Task 1 and Task 2 each count fake-`gh` invocations under a pin and assert 0, for `integration-model` AND for a merge-verification-only request (Decision Q8).
- The merge-verification degrade line is Deliverable 4's line with the key swapped (Decision Q9) — no "derived from" wording anywhere in code, tests, or docs.
- `CLAUDE_TWEAKS_GH_TIMEOUT_MS` set to a non-integer or out-of-range value falls through to policy, not to 5000 and not a throw — Task 1 test.
- A degraded detection in the PR-stamp gate must leave `run-state.json` without `prExempt` (Decision Q5), while a clean `local-merge` still persists it — Task 3 tests both via the `deps.resolveIntegrationModel` override.
- `reconcile()` callers that never set `forgeProbeTimeoutMs` (CLI verb, background pass, tests) keep the forwarded shape `{ mcpReachable }` exactly — the existing `#1558` test in `tests/reconcile.test.js` stays green and Task 4 adds the set case.
- The JSON `degraded` field is the bare reason code (`timeout` / `timeout-then-exit`), never rendered text (Decision Q13); the stderr line still carries the ms, rendered from the side-channel degrade object.
- A degraded `integration-model` never reaches `config.yml` as the run pin (Decision Q10), on both the `manifesto-write.js` CLI path and the prose Write mechanism; a clean resolve still pins exactly as before.
- `precondition.js` reports `degraded-detection` (ok, fail-open) only for a reported degrade; a clean `local-merge` still reports `not-pr-first` (Decision Q11).

## Spec coverage

| AC clause | Task / test |
|---|---|
| AC1.1, AC1.2 | Task 1 — `gh-timeout-ms 20000 in policy.yml outlasts an 8 s gh` |
| AC2.1 | Task 1 — `CLAUDE_TWEAKS_GH_TIMEOUT_MS=20000 with no policy key` |
| AC2.2 | Task 1 — `explicit opts.timeoutMs 1000 beats env 20000 -> degraded local-merge` |
| AC3.1 | Task 1 — `timeout on the first call, success on the second` |
| AC4.1 | Task 1 — `immediate non-zero gh exit` |
| AC5.1, AC5.2 | Task 1 — `gh absent with a remote -> local-merge, no degrade`; existing `mcpReachable:true resolves pr-first …` tests kept green |
| AC6.1, AC6.2 | Task 2 — `degraded detection: JSON mode …` and `degraded detection: --values …` |
| AC7.1 | Task 1 — `a policy.yml pin never invokes gh`; Task 2 — `a policy.yml pin or a --run config.yml pin never invokes gh` |
| AC8.1 | Task 3 — `resolveRunPinnedIntegrationModel forwards opts.timeoutMs` and `the PreToolUse gate passes HOOK_FORGE_PROBE_TIMEOUT_MS within the 15 s hook budget` |
| AC9.1 | Task 1 Step 3 (header comment, forge-detection.md); Task 1 Step 4 grep |
| AC10.1 | `/claude-tweaks:build` Common Step 5 full-suite verification |
| AC11.1, AC11.2 | Task 4 — `reconcile(): forwards opts.forgeProbeTimeoutMs as timeoutMs` and `session-start passes HOOK_FORGE_PROBE_TIMEOUT_MS into reconcile` |
| AC12.1, AC12.2 | Task 3 — budget assertion `GIT_REMOTE_PROBE_TIMEOUT_MS + 2 * HOOK_FORGE_PROBE_TIMEOUT_MS <= 15000` and `HOOK_FORGE_PROBE_TIMEOUT_MS === 5000` |
| AC13.1, AC13.2, AC13.3 | Task 3 — `resolveRunPinnedIntegrationModel forwards opts.timeoutMs`; Task 5 — `precondition.js forwards onDegrade and no timeoutMs …` |
| AC14.1, AC14.2 | Task 1 — `timeout then non-zero exit on retry -> degraded, two invocations, one degrade` |
| AC15.1, AC15.2 | Task 3 — `resolveRunPinnedIntegrationModel forwards opts.onDegrade`; `bookkeeping-stamps gate (#4578 Q5): a degraded detection never persists prExempt` |
| AC16.1, AC16.2 | Task 1 — `formatForgeDegrade renders both exact degraded strings`; Task 2 — `degraded detection: timeout then a failed retry prints its own text (Q6)` |
| AC17.1 | Task 2 — `computeDerivedDefaults: a merge-verification-only request reports a degraded fallback detection (Q7)`, `computeDerivedDefaults: an invalid integration-model entry requested with merge-verification re-detects with onDegrade attached (Q7)` and `degraded detection: a merge-verification-only request prints its own degraded line and field (Q7)` |
| AC18.1, AC18.2 | Task 2 — `computeDerivedDefaults: a merge-verification-only request honours the run's config.yml integration-model pin before forge detection (Q8)` |
| AC18.3 | Task 2 — `merge-verification-only request: a --run config.yml integration-model pin never invokes gh (Q8, AC18.3)` |
| AC19.1, AC19.2 | Task 2 — `degraded detection: a merge-verification-only request prints its own degraded line and field (Q7, AC17.1, AC19.1)` and `degraded detection: merge-verification timeout then a failed retry prints the integration-model key's text (Q9, AC19.1, AC19.2)` |
| AC20.1, AC20.2 | Task 6 — `a degraded integration-model resolve omits the pin …`, `CLI: a degraded integration-model resolve exits 0 unpinned …`; Task 7 — `manifesto.md Write mechanism: a degraded resolve line is handled like the EMPTY value …`, `integration-model.md Run-scoped stability: a degraded detection is never pinned` |
| AC21.1 | Task 5 — `checkPrBookkeepingPrecondition (#4578 Q11): a degraded forge detection reports degraded-detection …` and `/test Step 0 names the degraded-detection reason …` |
| AC22.1 | Task 2 — the Q8 test's `integration-model: bogus` control (an invalid run value is not a pin; detection runs) |
| AC23.1, AC23.2 | Task 2 — `computeDerivedDefaults: a degraded forge detection adds the reason-code degraded field …` and `degraded detection: JSON mode prints … degraded: 'timeout'` (whose stderr assertion pins the text rendered from the side-channel degrade object) |

Waived AC11.3: provenance tag "(Plan-review Q1: Reading B.)" — no behavior to test.
Waived AC12.3: provenance tag "(Q2: Reading B.)" — no behavior to test.
Waived AC13.4: provenance tag "(Q3: Reading B.)" — no behavior to test.
Waived AC14.3: provenance tag "(Q4: Reading B.)" — no behavior to test.
Waived AC15.3: provenance tag "(Plan-review Q5: Reading B.)" — no behavior to test.
Waived AC16.3: provenance tag "(Q6: Reading B.)" — no behavior to test.
Waived AC17.2: provenance tag "(Q7: Reading B.)" — no behavior to test.
Waived AC18.4: provenance tag "(Plan-review Q8.)" — no behavior to test.
Waived AC19.3: provenance tag "(Q9.)" — no behavior to test.

Waived bin/verify-run-bookends.js: read-only style reference for the `degraded —` line.
Waived plugin/bin/lib/shared-primitives.js: read-only reference for the env > policy > default ladder; not changed.
Waived AC20.3: provenance tag "(Plan-review Q10: Reading B.)" — no behavior to test.
Waived AC21.2: provenance tag "(Q11: Reading B.)" — no behavior to test.
Waived AC22.2: provenance tag "(Q12: Reading B.)" — no behavior to test.
Waived AC23.3: provenance tag "(Q13: Reading A.)" — no behavior to test.
Waived AC24.1: closing rule — a plan-review process rule, no code behavior to test.
Waived AC24.2: closing rule — a plan-review process rule, no code behavior to test.
Waived AC24.3: closing rule — a plan-review process rule, no code behavior to test.

---

### Task 1: Timeout resolution, retry-once, and degrade callback in `detectIntegrationModel`

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tests/helpers/fake-gh.js`
- Modify: `plugin/bin/lib/policy-schema.js` (header comment 745-763, function 764-786, `module.exports` 917-920)
- Modify: `plugin/skills/_shared/forge-detection.md` (Code twin paragraph, line 21)
- Test: `tests/integration-model.test.js`

**Interfaces:**
- Produces (`tests/helpers/fake-gh.js`): `fakeGh({ first, rest = first }) -> { count(): number, restore(): void }` — installs a `gh` stub via `installStub` from `./path-stub`; the stub appends one line to a counter file in its own temp dir, then picks its mode by the prior line count (0 → `first`, else `rest`). Modes:
  - `'ok'` → `echo '{"owner":{"login":"o"},"name":"n"}'`
  - `'fail'` → `exit 1`
  - `'hang'` → `exec sleep 30`
  - `{ slow: N }` → `sleep N & p=$!; trap 'kill $p; exit 143' TERM; wait $p; echo '{"owner":{"login":"o"},"name":"n"}'`
  `restore()` restores PATH and removes the counter dir.
- Produces (exported from `policy-schema.js`):
  - `GIT_REMOTE_PROBE_TIMEOUT_MS` — `5000`
  - `HOOK_FORGE_PROBE_TIMEOUT_MS` — `5000`
  - `resolveForgeProbeTimeoutMs(repoRoot: string, opts?: { timeoutMs?: number }) -> number`
  - `detectIntegrationModel(repoRoot, opts?: { mcpReachable?: boolean, timeoutMs?: number, onDegrade?: (d) => void }) -> 'pr-first' | 'local-merge'`
  - `formatForgeDegrade(d: { reason: 'timeout' | 'timeout-then-exit', timeoutMs: number, attempts: 2 }) -> string`
- `resolveIntegrationModel(repoRoot, opts)` forwards `opts` unchanged (already does).

- [ ] **Step 1: Write the failing tests**

Create `tests/helpers/fake-gh.js` per the Interfaces block. In `tests/integration-model.test.js`, add (all `{ skip: STUB_SKIP }` except the pure ones; each uses `gitRepo({ remote: 'https://github.com/o/n.git' })`, saves/restores `process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS` (delete when originally unset, and delete it up front in "no env" tests) and calls `gh.restore()` in `finally`):

```js
test('detectIntegrationModel: gh-timeout-ms 20000 in policy.yml outlasts an 8 s gh -> pr-first (AC1.1, AC1.2)', ...)
  // policy.yml 'gh-timeout-ms: 20000\n'; fakeGh({ first: { slow: 8 } })
  // strictEqual(detectIntegrationModel(dir), 'pr-first'); strictEqual(gh.count(), 1)
test('detectIntegrationModel: CLAUDE_TWEAKS_GH_TIMEOUT_MS=20000 with no policy key outlasts an 8 s gh -> pr-first (AC2.1)', ...)
test('detectIntegrationModel: explicit opts.timeoutMs 1000 beats env 20000 -> degraded local-merge after two attempts (AC2.2)', ...)
  // env 20000; fakeGh({ first: 'hang' }); seen = []
  // detectIntegrationModel(dir, { timeoutMs: 1000, onDegrade: (d) => seen.push(d) }) === 'local-merge'
  // gh.count() === 2; deepStrictEqual(seen, [{ reason: 'timeout', timeoutMs: 1000, attempts: 2 }])
test('detectIntegrationModel: timeout on the first call, success on the second -> pr-first, two invocations, no degrade (AC3.1)', ...)
  // fakeGh({ first: 'hang', rest: 'ok' }); opts { timeoutMs: 1000, onDegrade }; seen stays []
test('detectIntegrationModel: timeout then non-zero exit on retry -> degraded local-merge, two invocations, one degrade (AC14.1, AC14.2)', ...)
  // fakeGh({ first: 'hang', rest: 'fail' }); opts { timeoutMs: 1000, onDegrade }
  // deepStrictEqual(seen, [{ reason: 'timeout-then-exit', timeoutMs: 1000, attempts: 2 }])
test('detectIntegrationModel: immediate non-zero gh exit -> local-merge, one invocation, no degrade (AC4.1)', ...)
  // fakeGh({ first: 'fail' })
test('detectIntegrationModel: a throwing onDegrade never escapes -> local-merge', ...)
  // fakeGh({ first: 'hang' }); onDegrade: () => { throw new Error('boom') }
test('detectIntegrationModel: gh absent with a remote -> local-merge, no degrade (AC5.1)', ...)
  // PATH = ghAbsentPath(); onDegrade never called. No stub, no skip.
test('resolveIntegrationModel: a policy.yml pin never invokes gh (AC7.1)', ...)
  // policy 'integration-model: pr-first\n'; fakeGh({ first: 'hang' }); === 'pr-first'; gh.count() === 0
test('resolveForgeProbeTimeoutMs: explicit > valid env > policy > 5000; invalid env falls through to policy', ...)
  // pure: no policy, no env -> 5000; policy 'gh-timeout-ms: 7000' -> 7000; + env '9000' -> 9000;
  // env 'abc' / '0' / '90000' with policy 7000 -> 7000; policy 'gh-timeout-ms: 90000' -> 5000;
  // opts.timeoutMs 1234 with env 9000 -> 1234; opts.timeoutMs 0 / -1 / 'x' ignored (-> env/policy value).
test('formatForgeDegrade renders both exact degraded strings', ...)
  // { reason: 'timeout', timeoutMs: 1000, attempts: 2 } -> 'forge detection timed out after 1000 ms (x2)'
  // { reason: 'timeout-then-exit', timeoutMs: 1000, attempts: 2 } -> 'forge detection timed out after 1000 ms, then gh failed on retry'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/integration-model.test.js`
Expected: FAIL — the 8 s tests return `local-merge` (hardcoded 5000), the retry tests see one invocation, and `resolveForgeProbeTimeoutMs` / `formatForgeDegrade` are not functions.

- [ ] **Step 3: Implement in `plugin/bin/lib/policy-schema.js`**

- `resolveForgeProbeTimeoutMs`: per Global Constraints; env validity via `isValidValue(SCHEMA_BY_KEY.get('gh-timeout-ms'), raw)`; policy read via `resolveValue('gh-timeout-ms', parseFlatLines(readFileSafe(path.join(repoRoot, '.claude-tweaks', 'policy.yml')))['gh-timeout-ms'])`. An explicit valid `opts.timeoutMs` returns before any file read.
- `detectIntegrationModel`: git probe in its own options literal with `timeout: GIT_REMOTE_PROBE_TIMEOUT_MS`; `mcpReachable` short-circuit unchanged; then resolve the timeout and run `gh repo view --json owner,name` through the existing #4505 GH_HOST seam — `execFileSync('gh', args, ghOptions(args, { cwd: repoRoot, stdio: [...], timeout: ghTimeoutMs, encoding: 'utf8', windowsHide: true }))` — an options literal carrying that timeout, kept inside the `ghOptions(...)` wrapper exactly as today (both literals keep a literal `windowsHide: true`; keep the existing "windowsHide restated in the call" comment). Classify per Global Constraints; retry only after a first-attempt timeout; on a failed retry call `opts.onDegrade` once with the Global Constraints degrade object inside a `try/catch`, then return `'local-merge'`.
- Rewrite the header comment: drop "Each check runs under a 5s timeout"; state the git probe's own bound, the gh timeout source and precedence, the retry-once rule, and degraded vs detected `local-merge`.
- Export `GIT_REMOTE_PROBE_TIMEOUT_MS`, `HOOK_FORGE_PROBE_TIMEOUT_MS` (comment: the per-attempt bound both lifecycle hooks pass; worst case git 5 s + two 5 s attempts = 15 s, record #4578 Decision Q2), `resolveForgeProbeTimeoutMs`, `formatForgeDegrade`.

Then update `plugin/skills/_shared/forge-detection.md`'s Code twin paragraph: add that the code twin's `gh repo view` probe is bounded by the resolved `gh-timeout-ms` (env `CLAUDE_TWEAKS_GH_TIMEOUT_MS` > `policy.yml` > 5000 default; a caller's explicit `timeoutMs` wins — the lifecycle hooks pass their own bound), is retried once after a timeout only, and that a failed retry is a *degraded* detection (still `local-merge`, reported to an opt-in `onDegrade` caller and by `resolve-policy.js`) — distinct from a *detected* `local-merge` (no remote, `gh` absent, `gh` exiting non-zero on the first attempt). No fixed 5 s figure.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/integration-model.test.js`
Expected: PASS, and the file completes in under ~35 s (two 8 s tests plus ~2 s per timeout case). A much longer wall time means the fake's sleep is orphaned — fix the fixture, not the timeouts.

Run: `git grep -n -F -e "Each check runs under" -e "5s timeout" -- plugin/bin/lib/policy-schema.js plugin/skills/_shared/forge-detection.md`
Expected: no output (AC9.1). Control: `git show HEAD:plugin/bin/lib/policy-schema.js | grep -n -F "Each check runs under"` prints line 751 before this task's commit.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/fake-gh.js plugin/bin/lib/policy-schema.js plugin/skills/_shared/forge-detection.md tests/integration-model.test.js
git commit -m "Honour gh-timeout-ms in detectIntegrationModel — retry once on timeout, report degrade via onDegrade, refs #4578"
```

### Task 2: Surface a degraded detection in `computeDerivedDefaults` and `resolve-policy.js`; the merge-verification fallback honours the run pin

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-derived-defaults.js` (integration-model block 41-47, header comment)
- Modify: `plugin/bin/resolve-policy.js` (after `computeDerivedDefaults`, header comment)
- Modify: `docs/plugin-structure.md` (the `resolve-policy.js` command-reference line, 240)
- Test: `tests/merge-verification.test.js`
- Test: `tests/resolve-policy-cli.test.js`

**Interfaces:**
- Consumes: `detectIntegrationModel(root, { mcpReachable, onDegrade })`, `formatForgeDegrade(degrade)` from Task 1; `resolvePolicyKeys` (already exported by `policy-schema.js`); `fakeGh` from `tests/helpers/fake-gh.js`.
- Produces: `computeDerivedDefaults(result, keys, root, deps)` accepts an additive `deps.runConfigRaw?: string | null` (Decision Q8) and `deps.onDegrade?: (key, degrade) => void` (Decision Q13's side channel, consumed by `resolve-policy.js` here and by Task 6's `manifesto-write.js` only through the entry's `degraded` field); `result['integration-model']` and (whenever the merge-verification fallback ran detection) `result['merge-verification']` per Global Constraints (additive `degraded` field only on a degraded detection).
- Return-shape widening check (done while authoring): `tests/merge-verification.test.js` and `tests/resolve-policy-cli.test.js` assert these entries with `deepStrictEqual` / exact-JSON comparisons on non-degraded paths; the field is added only on a degraded detection, so those assertions keep their exact `{ value, source }` shape — the new non-degraded-shape test below pins that.

- [ ] **Step 1: Write the failing tests**

`tests/merge-verification.test.js`:

```js
test('computeDerivedDefaults: a degraded forge detection adds the reason-code degraded field and reports the degrade object (Q13, AC23.1)', ...)
  // deps.detectIntegrationModel = (root, opts) => { opts.onDegrade({ reason: 'timeout', timeoutMs: 1000, attempts: 2 }); return 'local-merge'; }
  // seen = []; deps.onDegrade = (key, d) => seen.push([key, d])
  // deepEqual(out['integration-model'], { value: 'local-merge', source: 'default', degraded: 'timeout' })
  // deepEqual(seen, [['integration-model', { reason: 'timeout', timeoutMs: 1000, attempts: 2 }]])
  // and the same call with no deps.onDegrade still adds degraded: 'timeout' (the side channel is opt-in); a throwing deps.onDegrade never escapes
test('computeDerivedDefaults: a non-degraded detection keeps the entry shape exactly { value, source }', ...)
  // deps.detectIntegrationModel = () => 'local-merge'; deepEqual(out['integration-model'], { value: 'local-merge', source: 'default' }); deps.onDegrade never called
test('computeDerivedDefaults: a merge-verification-only request reports a degraded fallback detection (Q7)', ...)
  // keys ['merge-verification'] only; deps.resolveIntegrationModel = (root, opts) => { opts.onDegrade({ reason: 'timeout-then-exit', timeoutMs: 1000, attempts: 2 }); return 'local-merge'; }
  // (real deriveMergeVerification: local-merge -> 'off')
  // deepEqual(out['merge-verification'], { value: 'off', source: 'default', degraded: 'timeout-then-exit' })
  // deps.onDegrade saw exactly [['merge-verification', { reason: 'timeout-then-exit', timeoutMs: 1000, attempts: 2 }]]
  // and a second call whose resolveIntegrationModel never calls onDegrade keeps exactly { value: 'off', source: 'default' }
test('computeDerivedDefaults: an invalid integration-model entry requested with merge-verification re-detects with onDegrade attached (Q7)', ...)
  // keys ['integration-model', 'merge-verification']; result['integration-model'] = { value: null, source: 'default', invalid: true }
  // deps.resolveIntegrationModel = (root, opts) => { opts.onDegrade({ reason: 'timeout', timeoutMs: 1000, attempts: 2 }); return 'local-merge'; }
  // the invalid integration-model entry is left untouched (still invalid: true, no degraded field);
  // deepEqual(out['merge-verification'], { value: 'off', source: 'default', degraded: 'timeout' })
test('computeDerivedDefaults: merge-verification reusing a degraded integration-model carries the same degraded reason, with one onDegrade call (plan review)', ...)
  // keys ['integration-model', 'merge-verification']; result['integration-model'] = { value: null, source: 'default' }
  // deps.detectIntegrationModel = (root, opts) => { opts.onDegrade({ reason: 'timeout', timeoutMs: 1000, attempts: 2 }); return 'local-merge'; }
  // deps.resolveIntegrationModel = () => { resolveCalls++; return 'local-merge'; }   (reuse path: never called)
  // seen = []; deps.onDegrade = (k, d) => seen.push(k)
  // deepEqual(out['merge-verification'], { value: 'off', source: 'default', degraded: 'timeout' }); deepEqual(seen, ['integration-model']); resolveCalls === 0
  // control: a clean detection on the same reuse path keeps exactly { value: 'off', source: 'default' }
test('computeDerivedDefaults: a merge-verification-only request honours the run\'s config.yml integration-model pin before forge detection (Q8, AC18.1, AC18.2)', ...)
  // keys ['merge-verification']; deps.runConfigRaw = 'integration-model: pr-first\n'
  // deps.resolveIntegrationModel = () => { calls++; return 'local-merge'; }
  // deps.deriveMergeVerification = (root, d) => { seenModel = d.integrationModel(root); return 'merge-when-green'; }
  // strictEqual(calls, 0); strictEqual(seenModel, 'pr-first'); deepEqual(out['merge-verification'], { value: 'merge-when-green', source: 'default' })
  // control: same call with deps.runConfigRaw = 'integration-model: bogus\n' (invalid — not a pin, Decision Q12, AC22.1) and with runConfigRaw absent -> calls === 1 each
```

`tests/resolve-policy-cli.test.js` (`{ skip: STUB_SKIP }`): a temp git repo under `os.tmpdir()` with `origin` = `https://github.com/o/n.git`, `fakeGh({ first: 'hang' })`, spawn the CLI from that repo with env `{ ...process.env, CLAUDE_TWEAKS_GH_TIMEOUT_MS: '1000' }`:

```js
test('degraded detection: JSON mode prints local-merge, source default, a degraded field, and exactly one degraded stderr line (AC6.1)', ...)
  // args ['integration-model']; status 0; parsed['integration-model'] deepEqual
  //   { value: 'local-merge', source: 'default', degraded: 'timeout' }   (Q13: the reason code)
  // stderr lines matching /degraded — integration-model: / has length 1 and equals the exact Global Constraints line
  //   (rendered text, '... timed out after 1000 ms (x2) ...' — the ms comes from the side-channel degrade object)
test('degraded detection: --values prints only local-merge on stdout (AC6.2)', ...)
  // stdout === 'local-merge\n'; stderr still has the one degraded line
test('degraded detection: a key requested twice still prints one degraded line', ...)
  // args ['integration-model', 'integration-model']
test('degraded detection: timeout then a failed retry prints its own text (Q6, AC16.2)', ...)
  // fakeGh({ first: 'hang', rest: 'fail' }); args ['integration-model']
  // parsed['integration-model'].degraded === 'timeout-then-exit'
  // exactly one stderr line, equal to the Global Constraints line with the text 'forge detection timed out after 1000 ms, then gh failed on retry'; gh.count() === 2
test('degraded detection: a merge-verification-only request prints its own degraded line and field (Q7, AC17.1, AC19.1)', ...)
  // fakeGh({ first: 'hang' }); args ['merge-verification']
  // parsed['merge-verification'] deepEqual { value: 'off', source: 'default', degraded: 'timeout' }
  // exactly one stderr line matching /degraded — /, equal to the Decision Q9 merge-verification line:
  //   'resolve-policy: degraded — merge-verification: forge detection timed out after 1000 ms (x2); resolved local-merge — pin integration-model in .claude-tweaks/policy.yml or raise gh-timeout-ms'
test('degraded detection: merge-verification timeout then a failed retry prints the integration-model key\'s text (Q9, AC19.1, AC19.2)', ...)
  // fakeGh({ first: 'hang', rest: 'fail' }); args ['merge-verification']
  // parsed['merge-verification'].degraded === 'timeout-then-exit'
  // exactly one stderr line, equal to the Decision Q9 line with the text 'forge detection timed out after 1000 ms, then gh failed on retry'; assert.doesNotMatch(stderr, /derived from/); gh.count() === 2
test('a policy.yml pin or a --run config.yml pin never invokes gh (AC7.1)', ...)
  // policy 'integration-model: pr-first\n' -> --values stdout 'pr-first\n', gh.count() 0;
  // no policy + --run {tmp run dir}/config.yml 'integration-model: pr-first\n' -> 'pr-first\n', gh.count() 0
test('merge-verification-only request: a --run config.yml integration-model pin never invokes gh (Q8, AC18.3)', ...)
  // fakeGh({ first: 'hang' }); no policy.yml; the fixture repo has NO .github/workflows (ladder branch (2) -> off, so
  //   deriveMergeVerification's separate readDefaultBranch gh lookup is never reached — see Decision Q8's note)
  // for pin of 'pr-first' and of 'local-merge': --run {tmp run dir} whose config.yml is 'integration-model: {pin}\n'
  //   (and no merge-verification line); args ['--run', runDir, 'merge-verification']
  //   status 0; parsed['merge-verification'] deepEqual { value: 'off', source: 'default' } (no degraded field);
  //   no stderr line matching /degraded — /; gh.count() === 0
  // control (same test, counted as a delta of gh.count()): the same call with no --run -> +2 invocations and the Q9 degraded line printed — proves the
  //   fixture reaches forge detection when unpinned, so the pinned zero is not vacuous
```

The `--run` fixture dir must be outside every checkout (`os.tmpdir()`), which the anchored-or-outside guard accepts.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/merge-verification.test.js tests/resolve-policy-cli.test.js`
Expected: FAIL — no `degraded` field, no stderr line; the Q8 pin tests see the fallback call `resolveIntegrationModel` (unit) / two fake-`gh` invocations (CLI).

- [ ] **Step 3: Implement**

- `computeDerivedDefaults`: pass `{ mcpReachable, onDegrade }` to `detectModel`, capture the degrade, and add `degraded: degrade.reason` (Decision Q13) only when one was reported, then call `deps.onDegrade('integration-model', degrade)` inside a `try/catch` when that dep is a function. In the merge-verification fallback (every branch that does not reuse a valid `integration-model` string — not requested, or requested but invalid): first resolve the run pin per Decision Q8 from `deps.runConfigRaw`; a valid `run-config` pin → `integrationModel: () => pinned`, no `resolveModel` call; otherwise `resolveModel(r, { mcpReachable, onDegrade })`, and add `degraded: degrade.reason` to the `merge-verification` entry plus `deps.onDegrade('merge-verification', degrade)` when a degrade was reported. On the reuse path (a valid `integration-model` string resolved in this call), copy that entry's `degraded` field onto the `merge-verification` entry when present, with no `onDegrade` call (Global Constraints, plan review). Update the header comment (name `deps.runConfigRaw`, `deps.onDegrade` and the Q8 pin-first rule beside the existing #1421 note).
- `resolve-policy.js`: pass `runConfigRaw` from `resolvePolicyConfig`'s return and an `onDegrade: (key, d) => degrades.set(key, d)` collector (a `Map`, beside `invalidRaw`) into `computeDerivedDefaults(result, keys, root, { mcpReachable, runConfigRaw, onDegrade })`. After `computeDerivedDefaults`, for `integration-model` then `merge-verification`, when `degrades` holds that key, write its stderr line (Global Constraints / Decision Q9), rendering the text with `formatForgeDegrade(degrades.get(key))`, once (all output modes; stdout unchanged). Extend the header comment's Output paragraph with the degrade lines and the additive `degraded` reason-code field.
- `docs/plugin-structure.md` line 240 (the `resolve-policy.js` command-reference line): add one clause naming the degraded stderr line and the additive `degraded` JSON field (the reason code), for `integration-model` and a merge-verification request that runs its own detection, and that the merge-verification fallback honours a `--run` `integration-model` pin first (#4578).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/merge-verification.test.js tests/resolve-policy-cli.test.js tests/integration-model.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-derived-defaults.js plugin/bin/resolve-policy.js docs/plugin-structure.md tests/merge-verification.test.js tests/resolve-policy-cli.test.js
git commit -m "Surface degraded integration-model detection in resolve-policy — stderr line plus JSON degraded field, merge-verification honours the run pin, refs #4578"
```

### Task 3: Timeout and degrade parameters on `resolveRunPinnedIntegrationModel`; the PreToolUse gate passes the hook bound and never caches a degrade

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (import line 37, `resolveRunPinnedIntegrationModel` ~1658, gate model resolution ~2083 and the `prExempt` write after it ~2146-2158)
- Test: `tests/hooks-pre-tool-use.test.js` (beside the existing `resolveRunPinnedIntegrationModel: exported …` test)
- Test: `tests/hooks-bookkeeping-stamps-gate.test.js` (beside the `#1258` `prExempt` tests, ~1752)
- Modify: `docs/hooks.md` (the "The run's pin, not a fresh detection." bullet, line 45: its "Never persisted when the resolution itself threw" sentence gains the degraded-detection case — Decision Q5's behavior change)

**Interfaces:**
- Consumes: `HOOK_FORGE_PROBE_TIMEOUT_MS`, `GIT_REMOTE_PROBE_TIMEOUT_MS`, the `timeoutMs` and `onDegrade` options from Task 1; `fakeGh`.
- Produces: `resolveRunPinnedIntegrationModel(mainRoot: string, runDir: string, opts?: { timeoutMs?: number, onDegrade?: (d) => void }) -> 'pr-first' | 'local-merge'` — consumed by Task 5 (`precondition.js`, `{ onDegrade }` only). The test-only `deps.resolveIntegrationModel` override is called as `override(mainRoot, { onDegrade })`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/hooks-pre-tool-use.test.js` (an existing, passing file — the new tests alone go red):

```js
test('resolveRunPinnedIntegrationModel forwards opts.timeoutMs to forge detection (#4578 AC8.1, AC13.1)', { skip: STUB_SKIP }, () => {
  // repo with origin https://github.com/o/n.git, no pin; fakeGh({ first: 'hang' }); delete env CLAUDE_TWEAKS_GH_TIMEOUT_MS
  // const t0 = Date.now(); result = pre.resolveRunPinnedIntegrationModel(repo, runDir, { timeoutMs: 1000 })
  // strictEqual(result, 'local-merge'); strictEqual(gh.count(), 2); assert.ok(Date.now() - t0 < 4500)
  // (without forwarding, the 5000 ms default makes this take >= 10 s)
});
test('the PreToolUse gate passes HOOK_FORGE_PROBE_TIMEOUT_MS within the 15 s hook budget (#4578 AC8.1, AC12.1, AC12.2)', () => {
  // const { HOOK_FORGE_PROBE_TIMEOUT_MS, GIT_REMOTE_PROBE_TIMEOUT_MS } = require('../plugin/bin/lib/policy-schema');
  // strictEqual(HOOK_FORGE_PROBE_TIMEOUT_MS, 5000)
  // assert.ok(GIT_REMOTE_PROBE_TIMEOUT_MS + 2 * HOOK_FORGE_PROBE_TIMEOUT_MS <= 15000)
  // source scan of pre-tool-use.js: match /resolveRunPinnedIntegrationModel\(mainRoot,\s*ctx\.runDir,\s*\{\s*timeoutMs:\s*HOOK_FORGE_PROBE_TIMEOUT_MS,\s*onDegrade\s*\}\)/
  // (the Q5 call shape; Decision Q3 Global Constraint)
});
test('resolveRunPinnedIntegrationModel forwards opts.onDegrade to forge detection (#4578 Q5, AC15.1)', { skip: STUB_SKIP }, () => {
  // repo with origin, no pin; fakeGh({ first: 'hang' }); seen = []
  // pre.resolveRunPinnedIntegrationModel(repo, runDir, { timeoutMs: 1000, onDegrade: (d) => seen.push(d) }) === 'local-merge'
  // deepStrictEqual(seen, [{ reason: 'timeout', timeoutMs: 1000, attempts: 2 }])
});
```

All three go red before the change (the precondition.js call-shape scan moved to Task 5, which changes that call per Decision Q11).

Append to `tests/hooks-bookkeeping-stamps-gate.test.js`, beside `bookkeeping-stamps gate (#1258): a caught model-resolution exception never persists prExempt …` and using the same fixture helpers (`gitRepo`, `linkedWorktreeOf`, `commitMaterializedSpec`, `mkRunDir`, `editInput`):

```js
test('bookkeeping-stamps gate (#4578 Q5): a degraded detection never persists prExempt — the next call detects again (AC15.2)', () => {
  // pre.run({ input: editInput(...), runDir: run, runState: { status: 'active', worktree: wt }, cwd: wt },
  //   { resolveIntegrationModel: (root, o) => { if (o && typeof o.onDegrade === 'function') o.onDegrade({ reason: 'timeout', timeoutMs: 5000, attempts: 2 }); return 'local-merge'; } })
  // deepStrictEqual(out, {}) (fail-open allow); persisted.prExempt === undefined
});
test('bookkeeping-stamps gate (#4578 Q5): the override receives an onDegrade callback; a clean local-merge still persists prExempt', () => {
  // let got; override = (root, o) => { got = o; return 'local-merge'; }
  // typeof (got && got.onDegrade) === 'function'; persisted.prExempt === true
});
```

Both gate tests go red before the change: the override's second argument is undefined today, so the first override returns a clean `local-merge` without degrading and the gate persists `prExempt: true`, and the second sees no `onDegrade`. The guard inside the first override keeps it from throwing, which would otherwise reach the catch branch and pass for the wrong reason.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/hooks-pre-tool-use.test.js tests/hooks-bookkeeping-stamps-gate.test.js`
Expected: FAIL — the forwarding test takes ~10 s or more and fails its elapsed bound; the onDegrade forwarding test sees no degrade; the source scan does not match; the gate tests see no `onDegrade` on the override's second argument.

- [ ] **Step 3: Implement**

Add the `opts = {}` parameter and pass `timeoutMs` / `onDegrade` to `detectIntegrationModel`, each only when set; import `HOOK_FORGE_PROBE_TIMEOUT_MS` on line 37; in the gate, declare `let degraded = false; const onDegrade = () => { degraded = true; };`, call `override ? override(mainRoot, { onDegrade }) : resolveRunPinnedIntegrationModel(mainRoot, ctx.runDir, { timeoutMs: HOOK_FORGE_PROBE_TIMEOUT_MS, onDegrade })`, and after the try/catch set `if (degraded) modelResolved = false;` with a comment citing Decision Q5 (a degraded detection is a transient failure like the catch branch — never cached as `prExempt`). Extend the `modelResolved` comment and the `prExempt` comment block at 2137-2145 to name the degrade case. Extend the function's comment: the gate never inherits `gh-timeout-ms` (up to 60 s, retried once → 120 s) because it runs inside a PreToolUse lifecycle hook (no per-hook timeout in `hooks.json`, so Claude Code's default command-hook timeout applies) and must keep `docs/hooks.md`'s never-break-a-session invariant; 5000 ms per attempt gives a 15 s worst case (git 5 s + two 5 s attempts, record #4578 Decision Q2); `check-pr-bookkeeping.js` (via `precondition.js`) runs as a CLI, not a hook, and passes no `timeoutMs`, so it follows the ladder (Task 5).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-pre-tool-use.test.js tests/hooks-bookkeeping-stamps-gate.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-pre-tool-use.test.js tests/hooks-bookkeeping-stamps-gate.test.js docs/hooks.md
git commit -m "Bound the PR-stamp gate's forge probe explicitly — timeout parameter, never cache a degraded detection as prExempt, refs #4578"
```

### Task 4: SessionStart passes the hook bound into `reconcile()`

**Files:**
- Modify: `plugin/bin/lib/reconcile/index.js` (opts doc comment 103, model resolution 246-257)
- Modify: `plugin/bin/lib/hooks/session-start.js` (imports ~12, inline `reconcile({…})` call 259-261 and its comment)
- Test: `tests/reconcile.test.js` (beside the `#1558` forwarding test, ~1923)
- Test: `tests/hooks-session-start.test.js`

**Interfaces:**
- Consumes: `HOOK_FORGE_PROBE_TIMEOUT_MS` from Task 1.
- Produces: `reconcile(opts)` accepts `opts.forgeProbeTimeoutMs?: number`, forwarded as `timeoutMs` in the second argument to `resolveIntegrationModel` only when set.

- [ ] **Step 1: Write the failing tests**

`tests/reconcile.test.js`:

```js
test('reconcile(): forwards opts.forgeProbeTimeoutMs into resolveIntegrationModel as timeoutMs (#4578 AC11.1)', async () => {
  // const { mainDir } = pairedFixture(); calls = []; fake = (root, o) => { calls.push(o); return 'local-merge'; }
  // await reconcile({ cwd: mainDir, resolveIntegrationModel: fake, forgeProbeTimeoutMs: 5000 })
  // await reconcile({ cwd: mainDir, resolveIntegrationModel: fake })
  // deepStrictEqual(calls, [{ mcpReachable: false, timeoutMs: 5000 }, { mcpReachable: false }])
});
```

`tests/hooks-session-start.test.js`:

```js
test('session-start passes HOOK_FORGE_PROBE_TIMEOUT_MS into its inline reconcile() call (#4578 AC11.2)', () => {
  // source scan of plugin/bin/lib/hooks/session-start.js: slice from 'const result = await reconcile({' to the next '});'
  // assert.match(slice, /forgeProbeTimeoutMs:\s*HOOK_FORGE_PROBE_TIMEOUT_MS/)
  // assert.match(file, /HOOK_FORGE_PROBE_TIMEOUT_MS[^\n]*require\('\.\.\/policy-schema'\)/)
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/reconcile.test.js tests/hooks-session-start.test.js`
Expected: FAIL — the first call's forwarded options lack `timeoutMs`; the source scan does not match.

- [ ] **Step 3: Implement**

`reconcile/index.js`: build the forwarded options as `{ mcpReachable: opts.mcpReachable === true }` plus `timeoutMs: opts.forgeProbeTimeoutMs` when it is set; document `forgeProbeTimeoutMs` in the opts comment at line 103 and in the #1558 comment block (hook-context callers pass a bound; the `reconcile` CLI verb and the detached background pass do not, and follow the ladder). `session-start.js`: `const { HOOK_FORGE_PROBE_TIMEOUT_MS } = require('../policy-schema');` and add `forgeProbeTimeoutMs: HOOK_FORGE_PROBE_TIMEOUT_MS` to the inline call, with one comment line citing the PreToolUse gate's same bound (record #4578 Decision Q1).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/reconcile.test.js tests/hooks-session-start.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/index.js plugin/bin/lib/hooks/session-start.js tests/reconcile.test.js tests/hooks-session-start.test.js
git commit -m "Pass the hook-bounded forge probe timeout from SessionStart into reconcile — refs #4578"
```

### Task 5: The `/test` bookkeeping precondition reports a degraded detection as `degraded-detection` (Decision Q11)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/pr-bookkeeping/precondition.js` (model resolution 106-113)
- Modify: `plugin/skills/test/SKILL.md` (Step 0: PR-Bookkeeping Precondition Check, the **Exit 0** bullet)
- Test: `tests/bin-lib/pr-bookkeeping/precondition.test.js`

**Interfaces:**
- Consumes: `resolveRunPinnedIntegrationModel(mainRoot, runDir, { onDegrade })` from Task 3; `fakeGh` from Task 1.
- Produces: `checkPrBookkeepingPrecondition` gains the `{ ok: true, reason: 'degraded-detection' }` outcome. Its one production caller, `bin/check-pr-bookkeeping.js`, already prints `check-pr-bookkeeping.js: ok ({reason})` for every ok result — no change there.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/pr-bookkeeping/precondition.test.js`, reusing its `gitRepoWithCommit` / `linkedWorktreeOf` / `commitMaterializeFile` / `makeRunDir` / `writeRunState` helpers:

```js
test('checkPrBookkeepingPrecondition (#4578 Q11): a degraded forge detection reports degraded-detection, never not-pr-first (AC21.1)', { skip: STUB_SKIP }, () => {
  // main = gitRepoWithCommit(); git -C main remote add origin https://github.com/o/n.git; no policy.yml
  // wt = linkedWorktreeOf(main); commitMaterializeFile(wt, runId); runDir = makeRunDir(runId); writeRunState(runDir, { status: 'active', worktree: wt })
  // env CLAUDE_TWEAKS_GH_TIMEOUT_MS = '1000' (saved/restored; precondition passes no timeoutMs, so the ladder's env rung bounds it);
  // gh = fakeGh({ first: 'hang' }); try { r = checkPrBookkeepingPrecondition({ runDir, cwd: wt }) } finally { gh.restore() }
  // deepStrictEqual(r, { ok: true, reason: 'degraded-detection' }); strictEqual(gh.count(), 2)
});
test('checkPrBookkeepingPrecondition (#4578 Q11): a clean local-merge detection (gh exits non-zero at once) still reports not-pr-first', { skip: STUB_SKIP }, () => {
  // same fixture, fakeGh({ first: 'fail' }) -> r.reason === 'not-pr-first'; gh.count() === 1
});
test('precondition.js forwards onDegrade and no timeoutMs to resolveRunPinnedIntegrationModel — it follows the gh-timeout-ms ladder (#4578 AC13.2, AC13.3, AC21.1)', () => {
  // source scan of plugin/bin/lib/pr-bookkeeping/precondition.js:
  // match /resolveRunPinnedIntegrationModel\(mainRoot,\s*runDir,\s*\{\s*onDegrade\s*\}\)/; doesNotMatch /timeoutMs/
});
test('/test Step 0 names the degraded-detection reason the precondition returns (#4578 Q11 prose twin)', () => {
  // read plugin/skills/test/SKILL.md; slice from '## Step 0: PR-Bookkeeping Precondition Check' to '## Step 1:'
  // assert.match(slice, /ok \(degraded-detection\)/); assert.match(slice, /--status SKIP|`SKIP`/)
  // and the producer still carries the literal: assert.match(precondition.js source, /'degraded-detection'/)
});
```

`STUB_SKIP` and `fakeGh` come from `../../helpers/path-stub` and `../../helpers/fake-gh`. The first, third and fourth go red before the change (no `onDegrade` forwarded → `not-pr-first`; the call has two arguments; the prose has no such bullet); the second is a green control that keeps the new branch from swallowing a clean detection.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/pr-bookkeeping/precondition.test.js`
Expected: FAIL — the degraded case reports `not-pr-first`, the source scan sees the two-argument call, and `/test` Step 0 has no `ok (degraded-detection)` text.

- [ ] **Step 3: Implement**

`precondition.js`: `let degraded = false; const onDegrade = () => { degraded = true; };` then `model = resolveRunPinnedIntegrationModel(mainRoot, runDir, { onDegrade });` inside the existing try; after the try/catch and before `if (model !== 'pr-first')`, `if (degraded) return { ok: true, reason: 'degraded-detection' };` with a comment: a timed-out-twice forge detection cannot prove the run is pr-first or not, so this fails open like every other ambiguity here, but under its own reason so `/test` can log it (record #4578 Decision Q11); no `timeoutMs` is passed — this is a CLI, not a hook, so it follows the `gh-timeout-ms` ladder (Decision Q3). Update the `// checkPrBookkeepingPrecondition(...)` header comment's reason list if it names reasons.

`test/SKILL.md` Step 0, **Exit 0** bullet: add one sentence — stdout `check-pr-bookkeeping.js: ok (degraded-detection)` means forge detection timed out on both attempts, so the pr-first bookkeeping precondition was not verified: log one `SKIP` (`node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --text "condition: check-pr-bookkeeping.js reported degraded-detection (forge detection timed out) → fallback: pr-first bookkeeping precondition not verified this run" --reversibility n/a`) and continue to Step 1.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/pr-bookkeeping/precondition.test.js tests/bin-lib/pr-bookkeeping/cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/pr-bookkeeping/precondition.js plugin/skills/test/SKILL.md tests/bin-lib/pr-bookkeeping/precondition.test.js
git commit -m "Report a degraded forge detection as degraded-detection in the /test bookkeeping precondition — refs #4578"
```

### Task 6: `manifesto-write.js` never pins a degraded detection as the run's `integration-model` (Decision Q10)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/manifesto-write.js` (pin resolution 151-156)
- Modify: `plugin/bin/lib/flow/manifesto-write.js` (`writeManifesto` 196-255)
- Test: `tests/bin-lib/flow/manifesto-write.test.js`

**Interfaces:**
- Consumes: the `degraded` reason-code field Task 2 adds to the `integration-model` entry (`manifesto-write.js`'s `resolvePolicy` goes through `lib/flow/preflight.js`'s `resolvePolicyConfig` + `computeDerivedDefaults`, so the field arrives with no change there).
- Produces: `writeManifesto({ …, integrationModel, integrationModelDegraded = null, … })` — `integrationModelDegraded` is `null` or a reason code (`'timeout'` | `'timeout-then-exit'`, else `ManifestoInputError`); a non-null value forces no pin and logs the degraded `SKIP` in place of the empty-value one.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/flow/manifesto-write.test.js` (extend the `write(fx, …)` helper with an `integrationModelDegraded` option):

```js
test('a degraded integration-model resolve omits the pin, still writes the 13 levers, and logs the degraded SKIP, not the empty one (#4578 Q10, AC20.1, AC20.2)', () => {
  // write(fx, { integrationModel: null, integrationModelDegraded: 'timeout' })
  // config.yml has no /^integration-model:/m line; decisions.md has no '- integration-model:' header line
  // assert.match(text, /^- SKIP 17:24:30 — Manifesto: condition: integration-model forge detection degraded \(timeout\) → fallback: config\.yml written without the run pin; later --run reads detect again\. Reversibility: n\/a\.$/m)
  // assert.doesNotMatch(text, /integration-model resolved empty/)
});
test('writeManifesto: a degraded flag beside a non-null integrationModel still writes no pin; an unknown reason code is refused', () => {
  // write(fx, { integrationModel: 'local-merge', integrationModelDegraded: 'timeout-then-exit' }) -> no pin line
  // writeManifesto({ ..., integrationModelDegraded: 'bogus' }) throws ManifestoInputError, nothing written
});
test('CLI: a degraded integration-model resolve exits 0 unpinned and says so on stderr (#4578 Q10)', () => {
  // cliDeps(fx, { resolvePolicy: () => resolved({ 'integration-model': { value: 'local-merge', source: 'default', degraded: 'timeout' } }) })
  // exit 0; config.yml has no /^integration-model:/m line
  // assert.match(err.join(''), /integration-model forge detection degraded \(timeout\) — config\.yml written without the run pin \(SKIP logged\)/)
});
test('CLI: a clean local-merge resolve (no degraded field) still pins integration-model: local-merge', () => {
  // resolved({ 'integration-model': { value: 'local-merge', source: 'default' } }) -> config.yml has /^integration-model: local-merge$/m; stderr empty of 'degraded'
});
test('computeLevers: a derived merge-verification from a degraded detection becomes wait (source degraded); a policy value or a clean derived off is untouched (plan review)', () => {
  // computeLevers({ ..., resolved: resolved({ 'merge-verification': { value: 'off', source: 'default', degraded: 'timeout' } }) })
  //   -> the merge-verification lever deepEqual { key: 'merge-verification', value: 'wait', source: 'degraded' }
  // controls: { value: 'off', source: 'policy', degraded: 'timeout' } -> { value: 'off', source: 'policy' }; { value: 'off', source: 'default' } -> { value: 'off', source: 'default' }
});
test('writeManifesto: a degraded-sourced merge-verification lever writes wait and logs the AUTO line naming pr-first-merge Step 2.5', () => {
  // levers from the computeLevers call above; write -> config.yml has /^merge-verification: wait$/m
  // assert.match(text, /— Manifesto: merge-verification derived from a degraded forge detection → written as wait \(an unresolved lever never becomes off, _shared\/pr-first-merge\.md Step 2\.5\)/)
});
```

All but the clean-`local-merge` control go red before the change (no `integrationModelDegraded` parameter; the CLI pins the degraded `local-merge`; `computeLevers` passes the degraded `off` through).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/manifesto-write.test.js`
Expected: FAIL — the degraded resolve writes `integration-model: local-merge` and logs no degraded SKIP.

- [ ] **Step 3: Implement**

- `bin/manifesto-write.js`: `const integrationModelDegraded = pinEntry && typeof pinEntry.degraded === 'string' ? pinEntry.degraded : null;` and `integrationModel` becomes `null` whenever `integrationModelDegraded` is set; pass both to `writeManifesto`; stderr: degraded → `manifesto-write.js: integration-model forge detection degraded ({reason}) — config.yml written without the run pin (SKIP logged)`, else the existing empty line when `!integrationModel`. Extend the header comment's Writes paragraph (record #4578 Decision Q10).
- `lib/flow/manifesto-write.js` `writeManifesto`: accept `integrationModelDegraded = null`, validate it, force `pin = null` when set, and log `SKIP` `condition: integration-model forge detection degraded ({reason}) → fallback: config.yml written without the run pin; later --run reads detect again` in place of the empty-value `SKIP`. Extend its doc comment.
- `lib/flow/manifesto-write.js` `computeLevers`: before the generic `return { key, value: String(entry.value), source }`, a `merge-verification` entry with `source === 'default'` and a string `degraded` returns `{ key, value: 'wait', source: 'degraded' }` (Global Constraints, plan review); `writeManifesto` logs the `AUTO` line when the `merge-verification` lever's source is `degraded`. `'wait'` is a valid enum value, so `validateLever` passes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/manifesto-write.test.js tests/flow-mechanics-cli-cutover.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/manifesto-write.js plugin/bin/lib/flow/manifesto-write.js tests/bin-lib/flow/manifesto-write.test.js
git commit -m "Never pin a degraded integration-model detection in manifesto-write — omit the pin and log a SKIP, refs #4578"
```

### Task 7: The prose Write mechanism and the run-scoped-stability contract say a degraded detection is never pinned (Decision Q10)

**Role:** integration

**Files:**
- Modify: `plugin/skills/flow/manifesto.md` (Write mechanism paragraph, line 167)
- Modify: `plugin/skills/_shared/integration-model.md` (Run-scoped stability, line 29)
- Test: `tests/flow-manifesto-integration-model-pin.test.js`

**Interfaces:**
- Consumes: the `resolve-policy: degraded — integration-model:` stderr line Task 2 adds; Task 6's CLI behavior (the prose describes the same rule for the `confirm`/`hybrid` hand path).

- [ ] **Step 1: Write the failing tests**

`tests/flow-manifesto-integration-model-pin.test.js`:

```js
test('manifesto.md Write mechanism: a degraded resolve line is handled like the EMPTY value — no pin, a SKIP (#4578 Q10, AC20.1, AC20.2)', () => {
  // para = writeMechanismParagraph(readText(MANIFESTO))
  // assert.match(para, /resolve-policy: degraded — integration-model:/); assert.match(para, /never becomes the run pin/)
  // assert.match(para, /`merge-verification` entry carries a `degraded` field[^.]*`wait`/)   (plan review: the derived lever)
});
test('integration-model.md Run-scoped stability: a degraded detection is never pinned (#4578 Q10, AC20.2)', () => {
  // section = text between '## Run-scoped stability' and the next '## ' heading of plugin/skills/_shared/integration-model.md
  // assert.match(section, /degraded detection[^.]*never (becomes the run pin|pinned)/)
});
```

and add one row to `the degrade-line prefixes the readers print are the ones the skill prose tells callers to log as SKIP`'s `sites`: `['plugin/bin/resolve-policy.js', 'resolve-policy: degraded —', ['plugin/skills/flow/manifesto.md']]` (Task 2 makes `resolve-policy.js` print it).

All three go red before the change (neither file names the degrade; `manifesto.md` lacks the prefix).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/flow-manifesto-integration-model-pin.test.js`
Expected: FAIL — `manifesto.md` and `integration-model.md` name no degrade clause.

- [ ] **Step 3: Implement**

- `flow/manifesto.md` Write mechanism: after the EMPTY-value clause, add — when the resolve instead prints a `resolve-policy: degraded — integration-model:` line on stderr (forge detection timed out on both attempts), handle it exactly like the EMPTY value: omit the pair and log a `SKIP` naming the degrade, so a degraded detection never becomes the run pin and later `--run` reads detect again (#4578); and when the levers' `merge-verification` entry carries a `degraded` field (derived from that same detection), write the lever as `wait`, never the derived `off` — `_shared/pr-first-merge.md` Step 2.5's unresolved-lever rule.
- `_shared/integration-model.md` Run-scoped stability: add one sentence after "…never a fresh detection —" sentence: a degraded detection (the `gh` probe timed out on both attempts, `resolve-policy.js`'s `degraded —` line) never becomes the run pin — the Manifesto omits the pin and logs a `SKIP`, so the run proceeds unpinned and later `--run` reads detect again, the same path as an empty resolve (#4578).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/flow-manifesto-integration-model-pin.test.js tests/flow-mechanics-cli-cutover.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/manifesto.md plugin/skills/_shared/integration-model.md tests/flow-manifesto-integration-model-pin.test.js
git commit -m "Name the never-pin-a-degraded-detection rule in the Manifesto Write mechanism and the run-scoped-stability contract — refs #4578"
```

### Task 8: `phase-exit.js` treats a degraded `integration-model` read as unresolved and bounds it by the forge ladder (plan review)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/phase-exit/phase-exit.js` (`realDeps.resolvePolicy`, 85-87; imports 53-60)
- Test: `tests/bin-lib/phase-exit/phase-exit.test.js`

**Interfaces:**
- Consumes: the JSON `degraded` reason-code field (Task 2) and `resolveForgeProbeTimeoutMs` / `GIT_REMOTE_PROBE_TIMEOUT_MS` (Task 1, exported from `policy-schema.js`); `fakeGh` (Task 1).
- Produces: `realDeps.resolvePolicy(runDir, key, cwd) -> string` keeps its signature; it now throws `Error('forge detection degraded ({reason})')` for a degraded entry. `runPhaseExit`'s existing `integration-model unresolved ({detail})` branch is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/phase-exit/phase-exit.test.js`:

```js
test('realDeps.resolvePolicy: a degraded integration-model read throws "forge detection degraded (timeout)" instead of returning local-merge (#4578 plan review)', { skip: STUB_SKIP }, () => {
  // repo = temp git repo under os.tmpdir() with origin https://github.com/o/n.git, no policy.yml; runDir = a temp dir outside every checkout, no config.yml
  // env CLAUDE_TWEAKS_GH_TIMEOUT_MS = '1000' (saved/restored); gh = fakeGh({ first: 'hang' })
  // assert.throws(() => realDeps.resolvePolicy(runDir, 'integration-model', repo), /forge detection degraded \(timeout\)/); gh.count() === 2
});
test('realDeps.resolvePolicy: a pinned run returns the pin with no gh call, and a non-forge key still returns its plain value', { skip: STUB_SKIP }, () => {
  // runDir config.yml 'integration-model: pr-first\n' -> 'pr-first', gh.count() === 0
  // realDeps.resolvePolicy(runDir, 'integration-branch', repo) -> '' (unset, no default) — the --values-equivalent empty string
});
test('runPhaseExit: a degraded resolve logs the unresolved SKIP naming the degrade and pushes nothing (#4578 plan review)', () => {
  // makeDeps(...) with resolvePolicy: (r, key) => { if (key === 'integration-model') throw new Error('forge detection degraded (timeout)'); return ''; }
  // env.push.state === 'skipped'; the decisions.md text matches /integration-model unresolved \(forge detection degraded \(timeout\)\)/; no git push call recorded
});
test('phase-exit.js sizes the integration-model resolve timeout from the forge ladder (#4578 plan review)', () => {
  // source scan of plugin/bin/lib/phase-exit/phase-exit.js: match /GIT_REMOTE_PROBE_TIMEOUT_MS\s*\+\s*2\s*\*\s*resolveForgeProbeTimeoutMs\(/
});
```

`STUB_SKIP` / `fakeGh` from `../../helpers/path-stub` and `../../helpers/fake-gh`. The first and fourth go red before the change (`--values` prints `local-merge`; no ladder-sized timeout); the second and third are green controls that pin the unchanged seam and the existing unresolved branch.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/phase-exit/phase-exit.test.js`
Expected: FAIL — the degraded read returns `local-merge`; the source scan finds no ladder-sized timeout.

- [ ] **Step 3: Implement**

`realDeps.resolvePolicy`: spawn `process.execPath [RESOLVE_POLICY_JS, '--run', runDir, key]` (JSON mode) with `timeout: key === 'integration-model' ? GIT_REMOTE_PROBE_TIMEOUT_MS + 2 * resolveForgeProbeTimeoutMs(cwd) + GIT_TIMEOUT_MS : GIT_TIMEOUT_MS` in the existing options literal (keep `windowsHide: true`); `JSON.parse` stdout, read `parsed[key]`; a string `degraded` throws `new Error(\`forge detection degraded (${entry.degraded})\`)`; otherwise return `entry && entry.error === undefined && entry.value != null ? String(entry.value) : ''`. Require `{ GIT_REMOTE_PROBE_TIMEOUT_MS, resolveForgeProbeTimeoutMs }` from `../policy-schema` (phase-exit already pulls policy-schema in transitively through `../hooks/pre-tool-use`, so no new cycle). Comment: a Q10-unpinned run re-detects here, so the read must outlast the ladder and must not route a degraded `local-merge` (record #4578 plan review).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/phase-exit/phase-exit.test.js tests/phase-exit-call-sites-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/phase-exit/phase-exit.js tests/bin-lib/phase-exit/phase-exit.test.js
git commit -m "Treat a degraded integration-model read as unresolved in phase-exit and size its timeout from the forge ladder — refs #4578"
```
