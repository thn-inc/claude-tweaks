# detectIntegrationModel gh-timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `detectIntegrationModel` bounds its `gh repo view` probe with the repo's resolved `gh` timeout, retries once on a timeout, and reports a degraded detection (through an opt-in callback) that `resolve-policy.js` surfaces on stderr and in its JSON.

**Architecture:** All detection logic stays in `plugin/bin/lib/policy-schema.js`: a new `resolveForgeProbeTimeoutMs(repoRoot, opts)` (explicit `opts.timeoutMs` > valid `CLAUDE_TWEAKS_GH_TIMEOUT_MS` > `{repoRoot}/.claude-tweaks/policy.yml`'s `gh-timeout-ms` > 5000), error classification (timeout / absent / exit), one retry on timeout, and `opts.onDegrade(degrade)` called only when a timeout survives the retry. The string return is unchanged for every caller. `policy-derived-defaults.js` threads the callback into an additive `degraded` field; `resolve-policy.js` prints one stderr line; `pre-tool-use.js` passes an explicit hook-bounded `timeoutMs`.

**Tech Stack:** Node 18+ CommonJS, `child_process.execFileSync`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T093830-record-4578/work/4578-spec.md` (record #4578)

**Scope keywords:** detectIntegrationModel, gh-timeout-ms

## Global Constraints

- `detectIntegrationModel(repoRoot, opts)` keeps returning a bare `'pr-first' | 'local-merge'` string for every caller (additive only).
- Timeout precedence: explicit `opts.timeoutMs` (positive integer) > `CLAUDE_TWEAKS_GH_TIMEOUT_MS` (valid only within `gh-timeout-ms`'s bounds, 1000–60000; invalid falls through) > `gh-timeout-ms` from `{repoRoot}/.claude-tweaks/policy.yml` (via `resolveValue`, so out-of-range → 5000) > 5000.
- The `git remote get-url origin` probe keeps its own short local bound: `GIT_REMOTE_PROBE_TIMEOUT_MS = 5000`, never the `gh` budget.
- Retry once only on a timeout (`err.code === 'ETIMEDOUT'` or `err.signal` set). `ENOENT` (gh absent) and any other non-zero exit are definitive: no retry, no degrade.
- Degraded fallback value stays `local-merge`.
- No top-level `require('./policy')` or `require('./shared-primitives')` in `policy-schema.js` (require cycle / cwd-anchored getter). Use the module's own `readFileSafe`, `parseFlatLines`, `isValidValue`, `resolveValue`, `SCHEMA_BY_KEY`.
- Stderr line text (exact): `resolve-policy: degraded — integration-model: forge detection timed out after {ms} ms (x2); resolved local-merge — pin integration-model in .claude-tweaks/policy.yml or raise gh-timeout-ms`
- JSON `degraded` field value (exact): `forge detection timed out after {ms} ms (x2)`
- `--values` stdout unchanged (bare value only).
- Every new test uses a fake `gh` (never the network); stub tests take `{ skip: STUB_SKIP }` from `tests/helpers/path-stub.js`.
- Commit messages: `{Verb} {what} — {detail}`, reference `refs #4578`, never `closes`/`fixes`.

## Review Focus

- A fake `gh` killed on timeout must not leave an orphaned `sleep` holding the stdout pipe — `execFileSync` would then block for the full sleep and the timeout tests would silently take 8 s+ each. The fake's hang/slow modes `exec` or trap-kill their sleep (Task 1 fixture); Task 1 Step 4 checks the file's wall time.
- A caller requesting `integration-model` twice (`resolve-policy.js integration-model integration-model`) must still print exactly one degrade line — Task 2 prints once per process, not per requested key.
- A pin (policy.yml or `--run` config.yml) must short-circuit before any `gh` spawn — Task 1 and Task 2 each count fake-`gh` invocations under a pin and assert 0.
- `CLAUDE_TWEAKS_GH_TIMEOUT_MS` set to a non-integer or out-of-range value must fall through to policy, not to 5000 and not throw — Task 1 test.
- Reconcile's inline SessionStart pass calls `resolveIntegrationModel` and now inherits `gh-timeout-ms` × 2 for the probe. This record's Deliverable 5 bounds only the pre-tool-use hook; reconcile's other `gh` calls already inherit `gh-timeout-ms` via `shared-primitives.js`. Not changed here — carried as a ledger row for review to route.

## Spec coverage

| AC clause | Task / test |
|---|---|
| AC1.1, AC1.2 | Task 1 — `gh-timeout-ms 20000 in policy.yml outlasts an 8 s gh` (red today: hardcoded 5000 returns local-merge) |
| AC2.1 | Task 1 — `CLAUDE_TWEAKS_GH_TIMEOUT_MS=20000 with no policy key` |
| AC2.2 | Task 1 — `explicit opts.timeoutMs 1000 beats env 20000 -> degraded local-merge` |
| AC3.1 | Task 1 — `timeout on the first call, success on the second` |
| AC4.1 | Task 1 — `immediate non-zero gh exit` |
| AC5.1 | Task 1 — `gh absent with a remote -> local-merge, no degrade` |
| AC5.2 | existing `mcpReachable:true resolves pr-first …` tests in `tests/integration-model.test.js` (kept green) |
| AC6.1, AC6.2 | Task 2 — `degraded detection: JSON mode …` and `degraded detection: --values …` |
| AC7.1 | Task 1 — `a policy.yml pin never invokes gh`; Task 2 — `a policy.yml pin or a --run config.yml pin never invokes gh` |
| AC8.1 | Task 3 — `resolveRunPinnedIntegrationModel passes an explicit hook-bounded timeoutMs` |
| AC9.1 | Task 1 Step 3 — header comment and forge-detection.md rewrite; Task 1 Step 4 verification greps both for `5s`/`5 s` |
| AC10.1 | `/claude-tweaks:build` Common Step 5 full-suite verification |

Waived bin/verify-run-bookends.js: read-only style reference for the `degraded —` line.
Waived plugin/bin/lib/shared-primitives.js: read-only reference for the env > policy > default ladder; not changed.
Waived _shared/integration-model.md: run-scoped pin left untouched by design (spec Gotchas).
Waived docs/hooks.md: cited for the never-break-a-session invariant only; not changed.

---

### Task 1: Timeout resolution, retry-once, and degrade callback in `detectIntegrationModel`

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (header comment ~623-641, function ~642-659, `module.exports` ~782)
- Modify: `plugin/skills/_shared/forge-detection.md` (Code twin paragraph, line 21)
- Test: `tests/integration-model.test.js`

**Interfaces:**
- Produces (exported from `policy-schema.js`):
  - `GIT_REMOTE_PROBE_TIMEOUT_MS` — number, `5000`
  - `resolveForgeProbeTimeoutMs(repoRoot: string, opts?: { timeoutMs?: number }) -> number`
  - `detectIntegrationModel(repoRoot: string, opts?: { mcpReachable?: boolean, timeoutMs?: number, onDegrade?: (degrade: { reason: 'timeout', timeoutMs: number, attempts: 2 }) => void }) -> 'pr-first' | 'local-merge'`
  - `formatForgeDegrade(degrade) -> string` — returns `forge detection timed out after ${degrade.timeoutMs} ms (x2)`
- `resolveIntegrationModel(repoRoot, opts)` forwards `opts` unchanged (already does).

- [ ] **Step 1: Write the failing tests**

Add a fake-`gh` fixture to `tests/integration-model.test.js` using `installStub` / `STUB_SKIP` from `./helpers/path-stub`:

`fakeGh({ first, rest = first })` — writes a counter file in a temp dir; installs a `gh` stub whose script appends one line to the counter, then branches on the prior line count (0 → `first`, else `rest`). Modes:
- `'ok'` → `echo '{"owner":{"login":"o"},"name":"n"}'`
- `'fail'` → `exit 1`
- `'hang'` → `exec sleep 30` (exec so a timeout kill reaches sleep itself)
- `{ slow: N }` → `sleep N & p=$!; trap 'kill $p; exit 143' TERM; wait $p; echo '{"owner":{"login":"o"},"name":"n"}'`

Returns `{ count(): number, restore() }`. Each test uses `gitRepo({ remote: 'https://github.com/o/n.git' })` and restores PATH/env in `finally`.

Tests (all `{ skip: STUB_SKIP }`):

```js
test('detectIntegrationModel: gh-timeout-ms 20000 in policy.yml outlasts an 8 s gh -> pr-first', ...)
  // policy.yml: 'gh-timeout-ms: 20000\n'; fakeGh({ first: { slow: 8 } })
  // assert.strictEqual(detectIntegrationModel(dir), 'pr-first'); assert.strictEqual(gh.count(), 1)
test('detectIntegrationModel: CLAUDE_TWEAKS_GH_TIMEOUT_MS=20000 with no policy key outlasts an 8 s gh -> pr-first', ...)
test('detectIntegrationModel: explicit opts.timeoutMs 1000 beats env 20000 -> degraded local-merge after two attempts', ...)
  // env CLAUDE_TWEAKS_GH_TIMEOUT_MS=20000; fakeGh({ first: 'hang' })
  // const seen = []; result = detectIntegrationModel(dir, { timeoutMs: 1000, onDegrade: (d) => seen.push(d) })
  // result 'local-merge'; gh.count() === 2; deepStrictEqual(seen, [{ reason: 'timeout', timeoutMs: 1000, attempts: 2 }])
test('detectIntegrationModel: timeout on the first call, success on the second -> pr-first, exactly two invocations, no degrade', ...)
  // fakeGh({ first: 'hang', rest: 'ok' }); opts { timeoutMs: 1000, onDegrade }
test('detectIntegrationModel: immediate non-zero gh exit -> local-merge, one invocation, no degrade', ...)
  // fakeGh({ first: 'fail' })
test('detectIntegrationModel: gh absent with a remote -> local-merge, no degrade', ...)
  // PATH = ghAbsentPath(); onDegrade never called. (Not STUB_SKIP — no stub.)
test('resolveIntegrationModel: a policy.yml pin never invokes gh', ...)
  // policy.yml 'integration-model: pr-first\n'; fakeGh({ first: 'hang' }); resolveIntegrationModel(dir) === 'pr-first'; gh.count() === 0
test('resolveForgeProbeTimeoutMs: precedence explicit > valid env > policy > 5000; invalid env falls through to policy', ...)
  // no policy, no env -> 5000; policy 'gh-timeout-ms: 7000' -> 7000; + env '9000' -> 9000;
  // env 'abc' / '0' / '90000' with policy 7000 -> 7000; policy 'gh-timeout-ms: 90000' -> 5000;
  // opts.timeoutMs 1234 with env 9000 -> 1234; opts.timeoutMs 0 / -1 / 'x' ignored.
  // (Pure — no stub, no skip.)
test('formatForgeDegrade renders the exact JSON degraded string', ...)
  // formatForgeDegrade({ reason: 'timeout', timeoutMs: 1000, attempts: 2 }) === 'forge detection timed out after 1000 ms (x2)'
```

Save/restore `process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS` (delete when originally unset) in every test that touches it, and delete it in tests that rely on "no env" so an operator's shell value cannot leak in.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/integration-model.test.js`
Expected: FAIL — the 8 s tests return `local-merge` (hardcoded 5000), the retry test sees one invocation, and `resolveForgeProbeTimeoutMs` / `formatForgeDegrade` are not functions.

- [ ] **Step 3: Implement in `plugin/bin/lib/policy-schema.js`**

- `resolveForgeProbeTimeoutMs`: per Global Constraints; env validity via `isValidValue(SCHEMA_BY_KEY.get('gh-timeout-ms'), raw)`; policy read via `resolveValue('gh-timeout-ms', parseFlatLines(readFileSafe(path.join(repoRoot, '.claude-tweaks', 'policy.yml')))['gh-timeout-ms'])`.
- `detectIntegrationModel`: git probe under `GIT_REMOTE_PROBE_TIMEOUT_MS`; `mcpReachable` short-circuit unchanged; `gh repo view --json owner,name` under the resolved timeout, at most two attempts, retrying only when the thrown error classifies as timeout. A definitive failure returns `'local-merge'` with no callback. A timeout on both attempts calls `opts.onDegrade?.({ reason: 'timeout', timeoutMs, attempts: 2 })` inside a try/catch (a throwing callback must not break "never throws") and returns `'local-merge'`.
- Rewrite the header comment: drop "Each check runs under a 5s timeout"; state the timeout source and precedence, the retry-once rule, and degraded vs detected.
- Export `GIT_REMOTE_PROBE_TIMEOUT_MS`, `resolveForgeProbeTimeoutMs`, `formatForgeDegrade`.

Then update `plugin/skills/_shared/forge-detection.md`'s Code twin paragraph: add that the code twin's `gh repo view` probe is bounded by the resolved `gh-timeout-ms` (env `CLAUDE_TWEAKS_GH_TIMEOUT_MS` > `policy.yml` > 5000 default; a caller's explicit `timeoutMs` wins), is retried once on a timeout only, and that a timeout surviving the retry is a *degraded* detection (still `local-merge`, reported to an opt-in `onDegrade` caller and by `resolve-policy.js`) — distinct from a *detected* `local-merge` (no remote, `gh` absent, `gh` exiting non-zero). No fixed 5 s figure.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/integration-model.test.js`
Expected: PASS, and the file completes in under ~30 s (two 8 s tests plus ~1–2 s each for timeout cases). A much longer wall time means the fake's sleep is orphaned — fix the fixture, not the timeouts.

Run: `grep -n -E "5 ?s timeout|Each check runs under" plugin/bin/lib/policy-schema.js plugin/skills/_shared/forge-detection.md`
Expected: no output (AC9.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/skills/_shared/forge-detection.md tests/integration-model.test.js
git commit -m "Honour gh-timeout-ms in detectIntegrationModel — retry once on timeout, report degrade via onDegrade, refs #4578"
```

### Task 2: Surface a degraded detection in `computeDerivedDefaults` and `resolve-policy.js`

**Files:**
- Modify: `plugin/bin/lib/policy-derived-defaults.js` (integration-model block ~41-47, header comment)
- Modify: `plugin/bin/resolve-policy.js` (after `computeDerivedDefaults`, header comment)
- Test: `tests/merge-verification.test.js`
- Test: `tests/resolve-policy-cli.test.js`

**Interfaces:**
- Consumes: `detectIntegrationModel(root, { mcpReachable, onDegrade })`, `formatForgeDegrade(degrade)` from Task 1.
- Produces: `result['integration-model']` is `{ value, source: 'default' }` on a non-degraded detection (unchanged) and `{ value: 'local-merge', source: 'default', degraded: 'forge detection timed out after {ms} ms (x2)' }` on a degraded one.

- [ ] **Step 1: Write the failing tests**

`tests/merge-verification.test.js`:

```js
test('computeDerivedDefaults: a degraded forge detection adds the degraded field to the integration-model entry', ...)
  // deps.detectIntegrationModel = (root, opts) => { opts.onDegrade({ reason: 'timeout', timeoutMs: 1000, attempts: 2 }); return 'local-merge'; }
  // deepEqual(out['integration-model'], { value: 'local-merge', source: 'default', degraded: 'forge detection timed out after 1000 ms (x2)' })
test('computeDerivedDefaults: a non-degraded detection keeps the entry shape exactly { value, source }', ...)
  // deps.detectIntegrationModel = () => 'local-merge'; deepEqual(out['integration-model'], { value: 'local-merge', source: 'default' })
```

`tests/resolve-policy-cli.test.js` (fake-gh tests `{ skip: STUB_SKIP }`): build a temp git repo with `origin` = `https://github.com/o/n.git`, a `gh` stub that appends to a counter then `exec sleep 30`, and spawn the CLI with env `{ ...process.env, PATH: stubDir + delimiter + PATH, CLAUDE_TWEAKS_GH_TIMEOUT_MS: '1000' }`:

```js
test('degraded detection: JSON mode prints local-merge, source default, a degraded field, and exactly one degraded stderr line', ...)
  // args ['integration-model']; status 0; parsed['integration-model'] deepEqual
  //   { value: 'local-merge', source: 'default', degraded: 'forge detection timed out after 1000 ms (x2)' }
  // stderr lines matching /degraded — integration-model: / has length 1 and equals the exact Global Constraints line
test('degraded detection: --values prints only local-merge on stdout', ...)
  // stdout === 'local-merge\n'
test('degraded detection: a key requested twice still prints one degraded line', ...)
  // args ['integration-model', 'integration-model']
test('a policy.yml pin or a --run config.yml pin never invokes gh', ...)
  // policy 'integration-model: pr-first\n' -> stdout 'pr-first', counter 0;
  // no policy + --run dir config.yml 'integration-model: pr-first\n' -> 'pr-first', counter 0
```

Build these fixtures under `os.tmpdir()` (never inside this repo), matching the file header's rule.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/merge-verification.test.js tests/resolve-policy-cli.test.js`
Expected: FAIL — no `degraded` field, empty stderr (or the 8 s probe never retried).

- [ ] **Step 3: Implement**

- `computeDerivedDefaults`: pass `{ mcpReachable, onDegrade }` to `detectModel`, capture the degrade, and add `degraded: formatForgeDegrade(degrade)` only when one was reported. Update the header comment.
- `resolve-policy.js`: after `computeDerivedDefaults`, when `result['integration-model']?.degraded` is set, write the Global Constraints stderr line once (all output modes; stdout unchanged). Extend the header comment's Output paragraph with the degrade line and the additive `degraded` field.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/merge-verification.test.js tests/resolve-policy-cli.test.js tests/integration-model.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-derived-defaults.js plugin/bin/resolve-policy.js tests/merge-verification.test.js tests/resolve-policy-cli.test.js
git commit -m "Surface degraded integration-model detection in resolve-policy — stderr line plus JSON degraded field, refs #4578"
```

### Task 3: Hook-bounded probe timeout in `resolveRunPinnedIntegrationModel`

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (~1620-1660, `module.exports`)
- Test: `tests/hooks-bookkeeping-stamps-gate.test.js`

**Interfaces:**
- Consumes: `GIT_REMOTE_PROBE_TIMEOUT_MS` and the `timeoutMs` option from Task 1.
- Produces: exported `HOOK_FORGE_PROBE_TIMEOUT_MS = 2500`.

- [ ] **Step 1: Write the failing test**

Append to `tests/hooks-bookkeeping-stamps-gate.test.js` (an existing, passing file — the new test alone goes red):

```js
test('resolveRunPinnedIntegrationModel passes an explicit hook-bounded timeoutMs (#4578)', () => {
  // const { HOOK_FORGE_PROBE_TIMEOUT_MS } = pre; const { GIT_REMOTE_PROBE_TIMEOUT_MS } = require('../plugin/bin/lib/policy-schema');
  // assert.ok(Number.isInteger(HOOK_FORGE_PROBE_TIMEOUT_MS) && HOOK_FORGE_PROBE_TIMEOUT_MS > 0)
  // budget: GIT_REMOTE_PROBE_TIMEOUT_MS + 2 * HOOK_FORGE_PROBE_TIMEOUT_MS <= 10000 (the pre-#4578 worst case: two 5 s probes)
  // source scan: slice pre-tool-use.js from 'function resolveRunPinnedIntegrationModel(' to the next '\n}\n';
  //   assert.match(body, /detectIntegrationModel\(root,\s*\{\s*timeoutMs:\s*HOOK_FORGE_PROBE_TIMEOUT_MS\s*\}\)/)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/hooks-bookkeeping-stamps-gate.test.js`
Expected: FAIL — `HOOK_FORGE_PROBE_TIMEOUT_MS` undefined.

- [ ] **Step 3: Implement**

Add `const HOOK_FORGE_PROBE_TIMEOUT_MS = 2500;` near `resolveRunPinnedIntegrationModel`, pass `{ timeoutMs: HOOK_FORGE_PROBE_TIMEOUT_MS }`, and export it. Comment at the call site: the hook never inherits `gh-timeout-ms` (up to 60 s, retried once → 120 s) because it runs inside a PreToolUse lifecycle hook (no per-hook timeout in `hooks.json`, so Claude Code's default command-hook timeout applies) and must keep `docs/hooks.md`'s never-break-a-session invariant; 2500 ms keeps the worst case (git probe 5000 + two 2500 ms attempts = 10 s) equal to the pre-#4578 worst case. Note that `check-pr-bookkeeping.js` reuses this function and so shares the bound.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/hooks-bookkeeping-stamps-gate.test.js tests/hooks-pre-tool-use.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-bookkeeping-stamps-gate.test.js
git commit -m "Bound the PR-stamp gate's forge probe explicitly — hook never inherits gh-timeout-ms, refs #4578"
```
