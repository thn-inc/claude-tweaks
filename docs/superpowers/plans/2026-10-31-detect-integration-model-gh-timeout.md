# detectIntegrationModel gh-timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `detectIntegrationModel` bounds its `gh repo view` probe with the repo's resolved `gh` timeout, retries once on a timeout, and reports a degraded detection (through an opt-in callback) that `resolve-policy.js` surfaces on stderr and in its JSON; both lifecycle hooks (PreToolUse and SessionStart) pass an explicit hook bound instead.

**Architecture:** All detection logic stays in `plugin/bin/lib/policy-schema.js`: a new `resolveForgeProbeTimeoutMs(repoRoot, opts)` (explicit `opts.timeoutMs` > valid `CLAUDE_TWEAKS_GH_TIMEOUT_MS` > `{repoRoot}/.claude-tweaks/policy.yml`'s `gh-timeout-ms` > 5000), error classification, one retry after a timeout, and `opts.onDegrade(degrade)` when the retry fails too. The string return is unchanged for every caller. `policy-derived-defaults.js` threads the callback into an additive `degraded` field and `resolve-policy.js` prints one stderr line. `pre-tool-use.js`'s `resolveRunPinnedIntegrationModel` takes the timeout as a parameter (the hook passes `HOOK_FORGE_PROBE_TIMEOUT_MS`; `precondition.js` passes nothing), and `session-start.js` passes the same bound into `reconcile()`, which forwards it.

**Tech Stack:** Node 18+ CommonJS, `child_process.execFileSync`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T143830-record-4578/work/4578-spec.md` (record #4578, including its four `Decision (plan review, 2026-10-31)` bullets)

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
- JSON entry on a degraded detection: `{ value: 'local-merge', source: 'default', degraded: '{formatForgeDegrade text}' }`. Non-degraded entries keep exactly `{ value, source }`. `--values` stdout unchanged.
- Decision Q2: `HOOK_FORGE_PROBE_TIMEOUT_MS = 5000` (per gh attempt). Hook worst case `GIT_REMOTE_PROBE_TIMEOUT_MS + 2 * HOOK_FORGE_PROBE_TIMEOUT_MS = 15000` ms — "the hook budget" is that 15 s bound. One constant, exported from `policy-schema.js`, imported by both hooks.
- Decision Q3: `resolveRunPinnedIntegrationModel(mainRoot, runDir, opts = {})`; the PreToolUse gate passes `{ timeoutMs: HOOK_FORGE_PROBE_TIMEOUT_MS }`; `plugin/bin/lib/pr-bookkeeping/precondition.js` keeps its two-argument call and follows the ladder.
- Decision Q1: `session-start.js`'s inline `reconcile()` call passes `forgeProbeTimeoutMs: HOOK_FORGE_PROBE_TIMEOUT_MS`; `reconcile()` forwards it as `timeoutMs` to `resolveIntegrationModel` only when set (an unset option adds no key, so `{ mcpReachable }` stays the exact forwarded shape).
- No top-level `require('./policy')` or `require('./shared-primitives')` in `policy-schema.js` (require cycle / cwd-anchored getter). Use the module's own `readFileSafe`, `parseFlatLines`, `isValidValue`, `resolveValue`, `SCHEMA_BY_KEY`.
- Every real spawn keeps `windowsHide: true` in an options object literal `tests/windows-hide-spawn-conformance.test.js` can see (governing skill `gh-api-module-pattern`: "it accepts a literal `windowsHide` key there, or a bare identifier as the whole options argument whose own `const X = { … }` literal names it ... A spread ... satisfies neither and fails the full suite").
- Every new test uses a fake `gh` (never the network); stub tests take `{ skip: STUB_SKIP }` from `tests/helpers/path-stub.js`; test fixtures live under `os.tmpdir()`.
- Commit messages: `{Verb} {what} — {detail}`, reference `refs #4578`, never `closes`/`fixes`.

## Review Focus

- A fake `gh` killed on timeout must not leave an orphaned `sleep` holding the stdout pipe — `execFileSync` would then block for the full sleep. The fake's hang/slow modes `exec` or trap-kill their sleep; Task 1 Step 4 checks the file's wall time.
- A caller requesting `integration-model` twice (`resolve-policy.js integration-model integration-model`) still prints exactly one degrade line — Task 2 test.
- A pin (policy.yml or `--run` config.yml) short-circuits before any `gh` spawn — Task 1 and Task 2 each count fake-`gh` invocations under a pin and assert 0.
- `CLAUDE_TWEAKS_GH_TIMEOUT_MS` set to a non-integer or out-of-range value falls through to policy, not to 5000 and not a throw — Task 1 test.
- `reconcile()` callers that never set `forgeProbeTimeoutMs` (CLI verb, background pass, tests) keep the forwarded shape `{ mcpReachable }` exactly — the existing `#1558` test in `tests/reconcile.test.js` stays green and Task 4 adds the set case.

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
| AC13.1, AC13.2, AC13.3 | Task 3 — `resolveRunPinnedIntegrationModel forwards opts.timeoutMs`; `precondition.js keeps the two-argument call` |
| AC14.1, AC14.2 | Task 1 — `timeout then non-zero exit on retry -> degraded, two invocations, one degrade` |

Waived AC11.3: provenance tag "(Plan-review Q1: Reading B.)" — no behavior to test.
Waived AC12.3: provenance tag "(Q2: Reading B.)" — no behavior to test.
Waived AC13.4: provenance tag "(Q3: Reading B.)" — no behavior to test.
Waived AC14.3: provenance tag "(Q4: Reading B.)" — no behavior to test.

Waived bin/verify-run-bookends.js: read-only style reference for the `degraded —` line.
Waived plugin/bin/lib/shared-primitives.js: read-only reference for the env > policy > default ladder; not changed.
Waived _shared/integration-model.md: run-scoped pin left untouched by design (spec Gotchas); its "Fails at any check → local-merge, fail-open" sentence stays true.
Waived docs/hooks.md: cited for the never-break-a-session invariant only; not changed.

---

### Task 1: Timeout resolution, retry-once, and degrade callback in `detectIntegrationModel`

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tests/helpers/fake-gh.js`
- Modify: `plugin/bin/lib/policy-schema.js` (header comment 745-763, function 764-779, `module.exports` 911-914)
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
- `detectIntegrationModel`: git probe in its own options literal with `timeout: GIT_REMOTE_PROBE_TIMEOUT_MS`; `mcpReachable` short-circuit unchanged; then resolve the timeout and run `gh repo view --json owner,name` in an options literal carrying that timeout (both literals keep `windowsHide: true`). Classify per Global Constraints; retry only after a first-attempt timeout; on a failed retry call `opts.onDegrade` once with the Global Constraints degrade object inside a `try/catch`, then return `'local-merge'`.
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

### Task 2: Surface a degraded detection in `computeDerivedDefaults` and `resolve-policy.js`

**Files:**
- Modify: `plugin/bin/lib/policy-derived-defaults.js` (integration-model block 41-47, header comment)
- Modify: `plugin/bin/resolve-policy.js` (after `computeDerivedDefaults`, header comment)
- Modify: `docs/plugin-structure.md` (the `resolve-policy.js` command-reference line, 234)
- Test: `tests/merge-verification.test.js`
- Test: `tests/resolve-policy-cli.test.js`

**Interfaces:**
- Consumes: `detectIntegrationModel(root, { mcpReachable, onDegrade })`, `formatForgeDegrade(degrade)` from Task 1; `fakeGh` from `tests/helpers/fake-gh.js`.
- Produces: `result['integration-model']` per Global Constraints (additive `degraded` field only on a degraded detection).

- [ ] **Step 1: Write the failing tests**

`tests/merge-verification.test.js`:

```js
test('computeDerivedDefaults: a degraded forge detection adds the degraded field to the integration-model entry', ...)
  // deps.detectIntegrationModel = (root, opts) => { opts.onDegrade({ reason: 'timeout', timeoutMs: 1000, attempts: 2 }); return 'local-merge'; }
  // deepEqual(out['integration-model'], { value: 'local-merge', source: 'default', degraded: 'forge detection timed out after 1000 ms (x2)' })
test('computeDerivedDefaults: a non-degraded detection keeps the entry shape exactly { value, source }', ...)
  // deps.detectIntegrationModel = () => 'local-merge'; deepEqual(out['integration-model'], { value: 'local-merge', source: 'default' })
```

`tests/resolve-policy-cli.test.js` (`{ skip: STUB_SKIP }`): a temp git repo under `os.tmpdir()` with `origin` = `https://github.com/o/n.git`, `fakeGh({ first: 'hang' })`, spawn the CLI from that repo with env `{ ...process.env, CLAUDE_TWEAKS_GH_TIMEOUT_MS: '1000' }`:

```js
test('degraded detection: JSON mode prints local-merge, source default, a degraded field, and exactly one degraded stderr line (AC6.1)', ...)
  // args ['integration-model']; status 0; parsed['integration-model'] deepEqual
  //   { value: 'local-merge', source: 'default', degraded: 'forge detection timed out after 1000 ms (x2)' }
  // stderr lines matching /degraded — integration-model: / has length 1 and equals the exact Global Constraints line
test('degraded detection: --values prints only local-merge on stdout (AC6.2)', ...)
  // stdout === 'local-merge\n'; stderr still has the one degraded line
test('degraded detection: a key requested twice still prints one degraded line', ...)
  // args ['integration-model', 'integration-model']
test('a policy.yml pin or a --run config.yml pin never invokes gh (AC7.1)', ...)
  // policy 'integration-model: pr-first\n' -> --values stdout 'pr-first\n', gh.count() 0;
  // no policy + --run {tmp run dir}/config.yml 'integration-model: pr-first\n' -> 'pr-first\n', gh.count() 0
```

The `--run` fixture dir must be outside every checkout (`os.tmpdir()`), which the anchored-or-outside guard accepts.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/merge-verification.test.js tests/resolve-policy-cli.test.js`
Expected: FAIL — no `degraded` field, no stderr line.

- [ ] **Step 3: Implement**

- `computeDerivedDefaults`: pass `{ mcpReachable, onDegrade }` to `detectModel`, capture the degrade, and add `degraded: formatForgeDegrade(degrade)` only when one was reported. Update the header comment.
- `resolve-policy.js`: after `computeDerivedDefaults`, when `result['integration-model']?.degraded` is set, write the Global Constraints stderr line once (all output modes; stdout unchanged). Extend the header comment's Output paragraph with the degrade line and the additive `degraded` field.
- `docs/plugin-structure.md` line 234: add one clause naming the degraded stderr line and the additive `degraded` JSON field (#4578).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/merge-verification.test.js tests/resolve-policy-cli.test.js tests/integration-model.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-derived-defaults.js plugin/bin/resolve-policy.js docs/plugin-structure.md tests/merge-verification.test.js tests/resolve-policy-cli.test.js
git commit -m "Surface degraded integration-model detection in resolve-policy — stderr line plus JSON degraded field, refs #4578"
```

### Task 3: Timeout parameter on `resolveRunPinnedIntegrationModel`; the PreToolUse gate passes the hook bound

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (import line 37, `resolveRunPinnedIntegrationModel` 1621-1660, gate call site 2073)
- Test: `tests/hooks-pre-tool-use.test.js` (beside the existing `resolveRunPinnedIntegrationModel: exported …` test, ~1249)

**Interfaces:**
- Consumes: `HOOK_FORGE_PROBE_TIMEOUT_MS`, `GIT_REMOTE_PROBE_TIMEOUT_MS`, the `timeoutMs` option from Task 1; `fakeGh`.
- Produces: `resolveRunPinnedIntegrationModel(mainRoot: string, runDir: string, opts?: { timeoutMs?: number }) -> 'pr-first' | 'local-merge'`. `plugin/bin/lib/pr-bookkeeping/precondition.js:109` keeps `resolveRunPinnedIntegrationModel(mainRoot, runDir)` (no change).

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
  // source scan of pre-tool-use.js: match /resolveRunPinnedIntegrationModel\(mainRoot,\s*ctx\.runDir,\s*\{\s*timeoutMs:\s*HOOK_FORGE_PROBE_TIMEOUT_MS\s*\}\)/
});
test('precondition.js keeps the two-argument resolveRunPinnedIntegrationModel call — it follows the gh-timeout-ms ladder (#4578 AC13.2, AC13.3)', () => {
  // source scan of plugin/bin/lib/pr-bookkeeping/precondition.js:
  // match /resolveRunPinnedIntegrationModel\(mainRoot,\s*runDir\)/
});
```

The third test is green before the change (it pins Decision Q3's "passes nothing" half against a future edit); the first two go red.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/hooks-pre-tool-use.test.js`
Expected: FAIL — the forwarding test takes ~10 s or more and fails its elapsed bound; the source scan does not match.

- [ ] **Step 3: Implement**

Add the `opts = {}` parameter and pass `{ timeoutMs: opts.timeoutMs }` to `detectIntegrationModel` only when it is set; import `HOOK_FORGE_PROBE_TIMEOUT_MS` on line 37; change the gate call site at 2073 to `resolveRunPinnedIntegrationModel(mainRoot, ctx.runDir, { timeoutMs: HOOK_FORGE_PROBE_TIMEOUT_MS })`. Extend the function's comment: the gate never inherits `gh-timeout-ms` (up to 60 s, retried once → 120 s) because it runs inside a PreToolUse lifecycle hook (no per-hook timeout in `hooks.json`, so Claude Code's default command-hook timeout applies) and must keep `docs/hooks.md`'s never-break-a-session invariant; 5000 ms per attempt gives a 15 s worst case (git 5 s + two 5 s attempts, record #4578 Decision Q2); `check-pr-bookkeeping.js` (via `precondition.js`) runs as a CLI, not a hook, and passes nothing, so it follows the ladder.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-pre-tool-use.test.js tests/hooks-bookkeeping-stamps-gate.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-pre-tool-use.test.js
git commit -m "Bound the PR-stamp gate's forge probe explicitly — timeout parameter, hook never inherits gh-timeout-ms, refs #4578"
```

### Task 4: SessionStart passes the hook bound into `reconcile()`

**Files:**
- Modify: `plugin/bin/lib/reconcile/index.js` (opts doc comment 95, model resolution 239-249)
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

`reconcile/index.js`: build the forwarded options as `{ mcpReachable: opts.mcpReachable === true }` plus `timeoutMs: opts.forgeProbeTimeoutMs` when it is set; document `forgeProbeTimeoutMs` in the opts comment at line 95 and in the #1558 comment block (hook-context callers pass a bound; the `reconcile` CLI verb and the detached background pass do not, and follow the ladder). `session-start.js`: `const { HOOK_FORGE_PROBE_TIMEOUT_MS } = require('../policy-schema');` and add `forgeProbeTimeoutMs: HOOK_FORGE_PROBE_TIMEOUT_MS` to the inline call, with one comment line citing the PreToolUse gate's same bound (record #4578 Decision Q1).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/reconcile.test.js tests/hooks-session-start.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/index.js plugin/bin/lib/hooks/session-start.js tests/reconcile.test.js tests/hooks-session-start.test.js
git commit -m "Pass the hook-bounded forge probe timeout from SessionStart into reconcile — refs #4578"
```
