# Resolve policy in-process in driver/merge.js (#5432) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `plugin/bin/lib/driver/merge.js`'s two policy reads call `resolve-policy.js`'s in-process core through an injected seam instead of spawning `node resolve-policy.js` under `CLI_TIMEOUT_MS`.

**Architecture:** A new driver dep, `deps.resolvePolicyCore(opts, coreDeps)`, wired in `run.js`'s `realDeps` to the real `resolvePolicy` core. `merge.js` builds `coreDeps` with `callerDeps({ cwd: ctx.mainCheckout, env: deps.env, stderr: () => {} })`, the same shape `phase-exit.js:92-101` uses. Each site maps the core's `{ code, result }` / `{ code, message }` / throw onto its existing outcome text.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-14T214602-spec-5432/work/5432-spec.md`

## Global Constraints

- `readIntegrationModel` keeps `integration-model read failed: …` on a throw and `integration-model did not resolve pr-first (…)` otherwise, byte-identical to today (the parenthetical is the trimmed value, `empty`, or `exit {code}`).
- `readLever` keeps reading every failure as `unresolved` and running as `wait`; its two `Step 2.5` log texts are unchanged.
- A result-code comparison uses the exported `EXIT_OK`, never a retyped `0`.
- The script entry of `plugin/bin/resolve-policy.js` and its output are unchanged (no edit to that file).
- **Seam name (premise reversed):** the spec names the seam `deps.resolvePolicy`, but the driver's deps object already carries `resolvePolicy: (keys) => defaultResolvePolicy(keys)` (`run.js:476`), which `steps.js:177` calls with a keys-only signature. Reusing that name would break `steps.js`. The seam is `deps.resolvePolicyCore`.

## Review Focus

1. **The core returns `{ code: 1, message }` (an unanchored or missing run dir).** `readIntegrationModel` must read it as `integration-model did not resolve pr-first (exit 1)`, never as a throw, and `readLever` as `unresolved`. Pinned in Task 1 Step 1.
2. **The `integration-model` entry is an `{ error }` entry or has a `null` value.** `scalarValue` turns both into `''`, which must render as `(empty)`, the same as the old empty stdout. Pinned in Task 1 Step 1.
3. **The `merge-verification` entry carries `error`, or a non-string value.** It reads as unresolved exactly as the JSON path did. Covered by the existing lever-shape tests once their replies are converted to core shape.
4. **The forge probe writes host notes to the passed `stderr`.** They must not reach the driver's stderr; `merge.js` passes `stderr: () => {}`. Pinned by the seam-arguments test.
5. **`steps.js`'s existing `deps.resolvePolicy(keys)` keeps working.** The run-level tests in `run.test.js` already drive it; they must stay green unchanged.

---

### Task 1: Move merge.js's two policy reads onto `deps.resolvePolicyCore`

**Files:**
- Modify: `plugin/bin/lib/driver/merge.js:12-17` (header comment), `:120-182` (`readIntegrationModel`, `readLever`)
- Modify: `plugin/bin/lib/driver/run.js:476` (add `resolvePolicyCore` beside `resolvePolicy`)
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md:36`
- Test: `tests/bin-lib/driver/merge.test.js`
- Test: `tests/bin-lib/driver/run.test.js:509, 5142-5143, 5256-5257`

**Interfaces:**
- Consumes: `resolvePolicy({ keys, runDir }, deps)` → `{ code: EXIT_OK, result, invalidRaw, degrades }` or `{ code: 1, message }`; `callerDeps({ cwd, env, stderr })`; `scalarValue(entry)`; `EXIT_OK` (all from `plugin/bin/resolve-policy.js`).
- Produces: driver dep `resolvePolicyCore(opts: { keys: string[], runDir: string }, coreDeps) → core result`. It is real in `run.js`'s `realDeps` as `(opts, coreDeps) => require('../../resolve-policy').resolvePolicy(opts, coreDeps)` (lazy require, like its neighbours).

- [ ] **Step 1: Convert the test fakes and write the failing tests**

In `tests/bin-lib/driver/merge.test.js`:
- `mergeHarness` gains `resolvePolicyCore: (opts, coreDeps) => dispatch('policyCore', opts.keys, coreDeps.cwd(), { runDir: opts.runDir, env: coreDeps.env, coreDeps })`.
- `defaultMergeScript`'s two `resolve-policy.js` entries become `policyCore` matchers:
  - The `integration-model` reply defaults to `modelReply('pr-first')`.
  - The `merge-verification` reply defaults to `leverReply({ value: 'merge-when-green', source: 'run-config' })`.
- `leverReply(entry)` returns `{ code: 0, result: entry === undefined ? {} : { 'merge-verification': entry }, invalidRaw: new Map(), degrades: new Map() }`.
- Add `modelReply(value)`, which returns the same shape with `{ 'integration-model': { value, source: 'run-config' } }`.
- `isModelRead` and `isLeverRead` match `c.kind === 'policyCore'` with `c.args` including `'integration-model'` and `'merge-verification'` respectively.
- `resolverThrow()` stays an `Error` carrying `stderr: 'spawn exploded\n'`, so the AC2 detail stays `integration-model read failed: spawn exploded`.
- Convert every `integrationModel:` / `verification:` knob reply (46 sites):
  - A `{ code: 0, stdout: 'X\n' }` reply becomes `modelReply('X')`.
  - A `{ code: N≠0, … }` reply becomes `{ code: N, message: 'x' }`.

  The assertions do not change.
- The happy-path test at `:343` stops asserting the `resolve-policy.js` node argv. It asserts instead:
  - The kind sequence is `['ghAvailable', 'gh', 'policyCore', 'readFile', 'policyCore', 'judgments']`.
  - The two calls' `args` are `['integration-model']` and `['merge-verification']`.
  - Each call's `runDir` is `CTX.runDir` and its `cwd` is `CTX.mainCheckout`.
  - No `node` call names `resolve-policy.js` anywhere in `h.calls`.

New tests (each fails at base because the fake is never called):
- `seam: both reads pass the harness env and the main checkout through callerDeps, with a discarding stderr`. Assert on each `policyCore` call:
  - `call.env` is `h.deps.env`, the same object; run with `deps: { env: { HARNESS: 'custom' } }` and assert `deepEqual` to it. This is AC3: a site that ignores `deps.env` fails.
  - `call.coreDeps.cwd()` is `CTX.mainCheckout`.
  - `typeof call.coreDeps.stderr === 'function'`, and calling it with `'note'` writes nothing to `process.stderr`. Capture this with a `process.stderr.write` stub restored in `finally`.
- `AC2: a non-OK core result is not-pr-first with the exit code`, using `integrationModel: { code: 1, message: '--run dir does not exist or is not a directory: /x' }`. Assert:
  - `r.reason` is `not-pr-first`.
  - `r.detail` is `integration-model did not resolve pr-first (exit 1)`.
  - No lever read happened.
- `AC2: an error-entry or null integration-model value reads (empty)`: replies `{ code: 0, result: { 'integration-model': { error: 'x' } } }` and `modelReply(null)` both give `integration-model did not resolve pr-first (empty)`.
- `AC2: a non-OK core result for merge-verification runs as wait (unresolved)`: `verification: { code: 1, message: 'x' }` gives an entry detail matching `/lever wait \(unresolved\)/` and the log text `lever unresolved ("") — proceeding as wait`.

In `tests/bin-lib/driver/run.test.js`:
- The harness at `:509` gains `resolvePolicyCore: (opts, coreDeps) => dispatch('policyCore', opts.keys, coreDeps.cwd(), { runDir: opts.runDir, env: coreDeps.env })`.
- Its replies at `:5142-5143` and `:5256-5257` become `policyCore` matchers with core-shaped replies. Copy the two helper shapes locally; the file does not import merge.test.js.

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/run.test.js`
Expected: FAIL. Every converted test reports `unexpected node …resolve-policy.js …` from the harness dispatcher, because merge.js still calls `deps.node`.

- [ ] **Step 3: Implement in `plugin/bin/lib/driver/merge.js` and `run.js`**

`merge.js`:
- Add the import `const { callerDeps, scalarValue, EXIT_OK } = require('../../resolve-policy');`.
- Add one helper, `function readPolicy(s, key)`, returning `s.deps.resolvePolicyCore({ keys: [key], runDir: s.runDir }, callerDeps({ cwd: s.ctx.mainCheckout, env: s.deps.env, stderr: () => {} }))`.
- `readIntegrationModel`:
  - A throw keeps its message.
  - When `out.code !== EXIT_OK`, return `` `integration-model did not resolve pr-first (exit ${out.code})` ``.
  - Otherwise take `const v = scalarValue(out.result['integration-model']).trim()`. When `v !== 'pr-first'`, return `` `… (${neutralize(v) || 'empty'})` ``.
- `readLever`:
  - On a throw, or `out.code !== EXIT_OK`, it stays unresolved.
  - Otherwise `entry = out.result['merge-verification']`, under the existing `entry && typeof entry === 'object' && !entry.error && typeof entry.value === 'string'` test.
  - The `try { JSON.parse }` block goes.
- Rewrite the header comment's "Every external call except two in-process reads goes through `deps`" sentence. It now names three in-process exceptions: the decisions.md read, the realpath fallback, and the policy core's own git root lookup inside `callerDeps`. The core itself is reached through `deps.resolvePolicyCore`.
- The comments above both functions drop "spawn" wording: a throwing core is the failure they describe.

`run.js:476`: add `resolvePolicyCore: (opts, coreDeps) => require('../../resolve-policy').resolvePolicy(opts, coreDeps),` beside `resolvePolicy`.

- [ ] **Step 4: Run the tests and see them pass; count processes (AC1)**

Run: `node --test tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/run.test.js`
Expected: PASS, 0 fail.

Write `tests/bin-lib/driver/merge.test.js` into a list file at `/tmp`'s session scratch path, then run `node tools/count-node-procs.js --files-from {list}`.
Expected: the per-file row shows no `resolve-policy.js` CLI process.

Revert-check: put back the old `deps.node(bin('resolve-policy.js'), …)` call in `readIntegrationModel`. The seam test and the happy-path test must go red. Restore afterwards.

- [ ] **Step 5: Skill bullet, then commit**

In `.claude/skills/gh-api-module-pattern/SKILL.md:36`:
- Replace "Three callers still spawn the script and are out of scope for that record: `plugin/bin/lib/dispatch/queue-pull.js` and `plugin/bin/calibration-report.js` (#5382), and `plugin/bin/lib/driver/merge.js` (#5432, filed for its conversion)." with "Two callers still spawn the script: `plugin/bin/lib/dispatch/queue-pull.js` and `plugin/bin/calibration-report.js` (#5382)."
- Add to the earlier caller list: "`plugin/bin/lib/driver/merge.js` (#5432) reaches the core through its own `deps.resolvePolicyCore` seam (the driver's `deps.resolvePolicy` is the keys-only express resolver `steps.js` uses)".

```bash
git add plugin/bin/lib/driver/merge.js plugin/bin/lib/driver/run.js tests/bin-lib/driver/merge.test.js tests/bin-lib/driver/run.test.js .claude/skills/gh-api-module-pattern/SKILL.md
git commit -m "Resolve policy in-process in driver/merge.js — resolvePolicyCore seam replaces the resolve-policy.js spawns, refs #5432"
```

## Self-review

- **Spec coverage:**
  - Deliverable 1 → Step 3, with the seam name reversed; see Global Constraints.
  - Deliverable 2 → Step 3 and the Step 1 tests.
  - Deliverable 3 → Step 3 (`EXIT_OK`).
  - Deliverable 4 → Step 5.
  - AC1 → Step 4's count.
  - AC2 → the Step 1 non-OK and throw tests, plus the existing AC2/AC8.1 tests converted.
  - AC3 → the seam test.
  - AC4 → there is no edit to `resolve-policy.js`.
  - AC5 → Common Step 5 runs the full suite; Windows CI runs at review.
- **Placeholders:** none.
