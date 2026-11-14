# Resolve Policy In-Process in Shipped Callers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `facts.js`, `phase-exit.js`, `dispatch-prompt.js` and `release-tip-check.js` from spawning `node resolve-policy.js` to calling its exported `resolvePolicy` core, and convert the six test files that spawn `resolve-policy.js` directly to `runCli`.

**Architecture:** `plugin/bin/resolve-policy.js` gains four small exports that every in-process caller shares: exit-code constants, `scalarValue(entry)` (the `--values` rule), `warningLines(out, { values })` (the stderr lines `run` prints) and `callerDeps({ cwd, env, homeDir, stderr, gitTimeoutMs })` (core deps with a time-bounded `git`). Each caller replaces its spawn with `resolvePolicy({ keys, runDir }, callerDeps({ cwd: <the dir it gave the child>, … }))` inside its existing `try/catch`, and deletes the code for states the core cannot return (unparseable stdout, a wrong line count, a missing entry, the child kill-timeout).

**Tech Stack:** Node 18+ CommonJS, `node --test`, `tests/helpers/run-cli.js` (`runCli`, `runCliSync`, `spawnCli`), `tools/count-node-procs.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-14T095442-spec-5384/work/5384-spec.md` (record #5384)

Scope keywords: policyReadTimeoutMs, policyEntryValue, parsePolicyValues, resolveBound, resolveBudgets

## Global Constraints

- Non-goals (verbatim from spec): `plugin/bin/lib/dispatch/queue-pull.js` stays on subprocesses; `plugin/bin/calibration-report.js` (#5382) untouched; skill prose bash fences untouched; "Any change to which value a key resolves to" is out of scope.
- The script entry of `resolve-policy.js` and its stdout/stderr/exit code do not change (an older installed caller still spawns it). `tests/resolve-policy-entry.test.js`'s script-entry cases stay green unmodified.
- The core receives exactly the directory each caller passed as the child's `cwd` today: `facts.js` → the `cwd` given to `gatherFacts` (the facts root); `phase-exit.js` → `wt` (the `--worktree`); `dispatch-prompt.js` → its `cwd` (`d.cwd()`); `release-tip-check.js` → `root` (`--root` resolved against `cwd()`).
- `env`: a caller with `deps.env` passes it; a caller with none passes the inherited `process.env` (`facts.js`, `phase-exit.js`, `release-tip-check.js`).
- Add no second copy of the `--run` anchoring guard — callers get it by calling the core.
- A module that branches on the core's result imports the exit-code constant from `resolve-policy.js`; never retype `0`/`1`.
- Governing skill `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`, quoted verbatim:
  - "A module that calls a CLI's `run(argv, deps)` or its exported core in-process and branches on one of its exit codes imports that code from the CLI, and so does any bound it re-applies."
  - "Moving a caller from `run` to the core shrinks what it can receive: the usage exit 2 and the unreadable-output state are gone, so delete every statement and fake of them in the same change."
  - "Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`, and a library function on the CLI's path takes that `env` as an option whose default is the inherited environment, so a `gh` or `git` stub on an injected `PATH` is not skipped."
  - "The helper's `env` defaults to `{}` and is the whole environment the CLI sees, so a CLI that starts `git` or `gh` needs `PATH` (and `SystemRoot` on Windows) in the `env` the test passes. Module-level state under `plugin/bin` (the forge probe's memos, for example) survives between in-process calls in one test file; a case that depends on it passes `fresh: true`"
  - "each converted CLI keeps one or two `spawnCli` smoke tests for the script entry, shebang and exit code."
- Governing skill `bin-source-scan-conformance` / `windows-checkout-test-parity`: none of the new code adds a spawn or a path literal assertion; every existing `execFileSync` in touched code keeps `windowsHide: true`. A test that builds a `sh` stub is POSIX-only and skips on `win32` the way its neighbours do (`STUB_SKIP` in `phase-exit.test.js`).
- Scope rule for implementers (verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Every test in a converted file runs its `runCli` calls one at a time (no `Promise.all`, no concurrent subtests). The `env` passed to `runCli` is complete: include `PATH`, `HOME` (and `USERPROFILE`/`SystemRoot` on Windows) and `TMPDIR` where children need them; give `runCli` and any compared `spawnCli` the identical explicit `env`. A converted file's local helper maps `code` onto the field name its assertions already use (`status`, `exitCode`) so test bodies do not change.
- A test left on a real process carries a one-line comment naming the process property it proves.

## Review Focus

1. **A `--worktree` subdirectory or a `cwd` that is not the repo root** — the core must resolve the repo root through `git rev-parse --show-toplevel` at the caller's directory, so `phase-exit.js` given a subdirectory still reads the checkout's `policy.yml`. Pinned in Task 4 (`AC7 phase-exit: a subdirectory worktree resolves the checkout's pinned integration-branch`).
2. **A hung `git`** — the core's only unbounded call was `git rev-parse`; the bounded `git` must make a hung git fall back to `cwd` within the bound, not hang the caller. Pinned in Task 1 (`callerDeps: a git that never exits is killed at gitTimeoutMs and the root falls back to cwd`).
3. **A degraded forge detection in `phase-exit.js`** — must still throw `forge detection degraded (…)` (not route `local-merge`) after the move in-process. Kept by Task 4's existing `realDeps.resolvePolicy` forge tests, which stay unmodified apart from their ids.
4. **An invalid policy value under `dispatch-prompt.js`** — the warning line the child used to print on the parent's stderr must still appear. Pinned in Task 3 (`AC5/AC7 dispatch-prompt: an invalid autonomy value still writes the resolve-policy warning line to stderr`).
5. **A `gh` stub on an injected `PATH` in a converted test** — in-process, the forge child must receive the injected `env`, or the real `gh` runs silently. Pinned in Task 6 (`integration-model`: the `PATH`-stub cases assert the stub's call counter moved).

---

### Task 1: Shared in-process caller surface in `resolve-policy.js`

**Role:** integration

**Files:**
- Modify: `plugin/bin/resolve-policy.js`
- Test: `tests/resolve-policy-entry.test.js`
- Waived `plugin/bin/lib/policy-schema.js`: read only — Step 1's hung-git test relies on `resolvePolicyConfig`'s root fallback (lines 942-946) and the build's premise check read `detectIntegrationModel`'s bounded probes; no edit.
- Waived `lib/policy-schema.js`: the spec's Gotchas name for `plugin/bin/lib/policy-schema.js`, read as above.
- Waived `tests/bin-lib/exit-code-conformance.test.js`: run in Step 4, no edit.
- Waived `tests/bin-lib/cli-entry-conformance.test.js`: run in Step 4, no edit.

**Interfaces:**
- Produces (all exported from `plugin/bin/resolve-policy.js`, beside the existing `resolvePolicy, run, realDeps`):
  - `EXIT_OK = 0`, `EXIT_INVOCATION = 1` — `resolvePolicy` returns `{ code: EXIT_INVOCATION, message }` and `run` returns `EXIT_OK`/`EXIT_INVOCATION` (replace the literals).
  - `scalarValue(entry) -> string` — `''` for a missing entry, an `error` entry, or a `null`/`undefined` value; else `String(entry.value)`. `run`'s `--values` mode uses it.
  - `warningLines(out, { values }) -> string[]` — each line exactly as `run` writes it today, newline-terminated: first the degraded line for `integration-model` then `merge-verification` (every mode), then, only when `values` is true, one invalid-value warning per requested key in request order. `out` is `{ keys, result, invalidRaw, degrades }` (the core's success return plus the requested `keys`). `run` writes `warningLines(...)` through `deps.stderr` in place of its two inline loops.
  - `callerDeps({ cwd, env = process.env, homeDir, stderr, gitTimeoutMs = GIT_TIMEOUT_MS }) -> deps` — `{ cwd: () => cwd, env, git, readFile }` plus `homeDir`/`stderr` only when given. `git(args, { cwd, env })` runs `gitRoot` with `timeout: gitTimeoutMs`. `GIT_TIMEOUT_MS` comes from `plugin/bin/lib/shared-primitives.js`. No `stdout` key — the core never prints.
  - `gitRoot(args, { cwd, env, timeout })` passes `timeout` to `execFileSync` when given (absent for `realDeps.git`, so the script path is unchanged).

- [ ] **Step 1: Write the failing tests** in `tests/resolve-policy-entry.test.js`:
  - `test('scalarValue: the --values rule', …)` — `scalarValue(undefined) === ''`, `scalarValue({ error: 'unknown-key' }) === ''`, `scalarValue({ value: null }) === ''`, `scalarValue({ value: 3 }) === '3'`, `scalarValue({ value: 'pr-first' }) === 'pr-first'`.
  - `test('warningLines equals what run prints on stderr, in --values and JSON mode', …)` — fixture repo with `policy.yml` `autonomy: bogus\n`; for argv `['--values','autonomy']` and `['autonomy']`, `runCliSync(CLI, argv, { cwd, env: ENV })`'s `stderr` equals `warningLines({ keys:['autonomy'], ...resolvePolicy({ keys:['autonomy'] }, callerDeps({ cwd, env: ENV })) }, { values })` joined; the `--values` case is non-empty and contains `resolve-policy: warning: autonomy has invalid value "bogus"`, the JSON case is `''`.
  - `test('callerDeps: the core resolves the given cwd, not the process cwd (AC7)', …)` — fixture repo with `autonomy: trusted`, `resolvePolicy({ keys:['autonomy'] }, callerDeps({ cwd: fixture, env: ENV })).result.autonomy.value === 'trusted'` (this repo's own `policy.yml` does not set `trusted` — assert that too, so the test fails if `cwd` is ignored).
  - `test('callerDeps: a git that never exits is killed at gitTimeoutMs and the root falls back to cwd', { skip: process.platform === 'win32' }, …)` — `sh` stub `git` (`sleep 30`) on an injected-only `PATH`; `callerDeps({ cwd: fixture, env: { PATH: stubDir }, gitTimeoutMs: 300 })`; the call returns `code: EXIT_OK` within 5000 ms (measure with `Date.now()`), and the fixture's own `policy.yml` value is read (root fell back to `cwd`, `policy-schema.js:942-946`).
  - `test('EXIT_INVOCATION is what a refused --run returns', …)` — `resolvePolicy({ keys:['autonomy'], runDir: '/no/such/dir' }, callerDeps({ cwd: fixture, env: ENV })).code === EXIT_INVOCATION` and `EXIT_INVOCATION === 1`, `EXIT_OK === 0`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/resolve-policy-entry.test.js`
Expected: FAIL — `scalarValue is not a function` (and the other new exports undefined).

- [ ] **Step 3: Implement the exports** listed in Interfaces in `plugin/bin/resolve-policy.js`; update the header comment's `Exports {…}` line to list them.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/resolve-policy-entry.test.js tests/resolve-policy-lib.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS (the pre-existing script-entry cases unchanged).

- [ ] **Step 5: Commit** — `git add plugin/bin/resolve-policy.js tests/resolve-policy-entry.test.js` then `git commit -m "Export the in-process caller surface from resolve-policy.js — scalarValue, warningLines, callerDeps, exit codes"`

### Task 2: `facts.js` resolves its budgets through the core

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/wrap-up/facts.js` (`resolveBudgets` at lines 120-136, `gatherFacts` signature)
- Test: `tests/bin-lib/wrap-up/facts.test.js`
- Waived `tests/bin-lib/wrap-up/engine-cli.test.js`: no edit — stops starting `resolve-policy.js` because `facts.js` no longer spawns it; run in Step 4, measured in Task 7.
- Waived `tests/wrap-up-engine-journey-crlf.test.js`: as above.
- Waived `tests/wrap-up-engine-run-dir-anchoring.test.js`: as above.
- Waived `plugin/bin/wrap-up-engine.js`: no edit — calls `gatherFacts({ cwd: factsRoot, base })`, whose new options default.

**Interfaces:**
- Consumes: `resolvePolicy`, `callerDeps`, `scalarValue`, `EXIT_OK` (Task 1).
- Produces: `gatherFacts({ cwd, base, env = process.env, resolvePolicy = <core> })` — `env` and `resolvePolicy` are optional; `computeClaudeMdBudgetTargets(cwd, { env, resolvePolicy })` threads them to `resolveBudgets(cwd, { env, resolvePolicy })`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/wrap-up/facts.test.js`:
  - `test('AC5 facts: a resolvePolicy that throws falls back to the 30/150 schema defaults', …)` — fixture repo whose 6-line `CLAUDE.md` sits over a configured `harness-health-always-loaded-budget: 5`; `gatherFacts({ cwd, base, resolvePolicy: () => { throw new Error('boom'); } })` → the CLAUDE.md target's `budget === 150` and `claudeMdOverBudget === false`.
  - `test('AC2 facts: gatherFacts resolves budgets through the injected resolvePolicy', …)` — a counting `resolvePolicy` fake (records each call's `keys` and returns `{ code: 0, result: { 'harness-health-scoped-rule-budget': { value: 30 }, 'harness-health-always-loaded-budget': { value: 5 } } }`) is called exactly once with both budget keys, and the CLAUDE.md target's `budget === 5`. The process-level half of AC2 (no `resolve-policy.js` child for `wrap-up-engine.js plan`) is Task 7's `count-node-procs.js` measurement, one of the spec's two sanctioned forms. Do not monkeypatch `child_process`: `facts.js` destructures `execFileSync` at load, so a wrapper installed later never sees its calls.
  - Relabel the existing `gatherFacts claudeMdOverBudget honors a policy.yml budget …` test `AC7 facts: …` — it is the non-default-`cwd` proof (the fixture's `policy.yml` is read only when `cwd` reaches the core).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/facts.test.js`
Expected: FAIL — the injected `resolvePolicy` is ignored (`gatherFacts` takes no such option yet).

- [ ] **Step 3: Implement** `resolveBudgets(cwd, { env = process.env, resolvePolicy = core } = {})`: call `resolvePolicy({ keys: ['harness-health-scoped-rule-budget', 'harness-health-always-loaded-budget'] }, callerDeps({ cwd, env }))` inside the existing `try`, then `Number(scalarValue(result[key]))` for each; a throw returns the defaults. No `code` check: with no `runDir` the core never returns a non-zero code (its only `code: 1` sources are the `--run` guard and existence check, `resolve-policy.js:96-108`) — say so in one comment line. Rewrite the comment above it to say it reads the core in-process, keep the "never a second budget constant" and fallback sentences, and add the bound sentence: the root lookup is bounded by `callerDeps`' `GIT_TIMEOUT_MS`, and nothing else on this path is bounded (no forge key is read).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/facts.test.js tests/bin-lib/wrap-up/engine-cli.test.js tests/wrap-up-engine-journey-crlf.test.js tests/wrap-up-engine-run-dir-anchoring.test.js`
Expected: PASS.

- [ ] **Step 5: Revert-to-red proof (AC7)** — temporarily replace `callerDeps({ cwd, env })` with `callerDeps({ cwd: process.cwd(), env })`, re-run the AC7 test, confirm FAIL, restore. Note the result in the task report.

- [ ] **Step 6: Commit** — `git add plugin/bin/lib/wrap-up/facts.js tests/bin-lib/wrap-up/facts.test.js` then `git commit -m "Resolve the wrap-up fact pack's budgets in-process — no resolve-policy.js child"`

### Task 3: `dispatch-prompt.js` resolves its policy keys through the core

**Role:** integration

**Files:**
- Modify: `plugin/bin/dispatch-prompt.js` (import at line 44, `parsePolicyValues`/`realDeps.resolvePolicyValues` at lines 95-117, the call at line 206)
- Test: `tests/bin-lib/dispatch/dispatch-prompt-cli.test.js`

**Interfaces:**
- Consumes: `resolvePolicy`, `callerDeps`, `scalarValue`, `warningLines`, `EXIT_OK` (Task 1).
- Produces: `realDeps.resolvePolicyValues(cwd, { env, stderr })` — same return string as today (`POLICY_KEYS.map(k => \`${k}=${value.trim() || '(unset)'}\`).join(', ')`), now from the core; it writes `warningLines(out, { values: true })` through `stderr` before returning (the lines the child printed on the inherited stderr). No `code` check — it passes no `runDir`, so the core cannot return non-zero; a throw propagates to `run`'s existing `catch` (exit 1). The call-site comment states the bound: the root lookup by `callerDeps`' `GIT_TIMEOUT_MS`, forge detection by `gh-timeout-ms` × `FORGE_PROBE_ATTEMPTS` plus `GIT_REMOTE_PROBE_TIMEOUT_MS`, the local policy read unbounded. `run` calls `d.resolvePolicyValues(cwd, { env: d.env, stderr: d.stderr })`. `formatPolicyValues(result) -> string` replaces `parsePolicyValues(out)` in the exports. The `policyReadTimeoutMs` import is deleted.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/dispatch/dispatch-prompt-cli.test.js`:
  - Replace `resolvePolicyValues parsing counts lines after the trailing newline` (a line-count state the core cannot produce) with `test('formatPolicyValues: unset and error entries print (unset)', …)` — `formatPolicyValues({ autonomy: { value: 'unattended' }, 'integration-model': { value: null }, … })` includes `autonomy=unattended` and `integration-model=(unset)`; an `{ error: 'unknown-key' }` entry prints `(unset)`.
  - `test('AC4/AC7 dispatch-prompt: real resolvePolicyValues reads the fixture policy.yml at the given cwd', …)` — fixture repo with `policy.yml` setting each of the five `POLICY_KEYS` to a non-default valid value and `integration-model: pr-first` pinned (no forge probe); `realDeps.resolvePolicyValues(fixture, { env: ENV, stderr })` equals the literal string the old `parsePolicyValues` produced for that fixture (compute it once from `spawnCli(resolve-policy.js, ['--values', POLICY_KEYS.join(',')])` on the same fixture inside the test, so the expectation is the subprocess's own answer).
  - `test('AC5/AC7 dispatch-prompt: an invalid autonomy value still writes the resolve-policy warning line to stderr', …)` — fixture `autonomy: bogus`; the collected stderr contains `resolve-policy: warning: autonomy has invalid value "bogus"`.
  - Keep `a failing resolver or unreadable template exits 1 and writes nothing` unchanged; relabel it `AC5 dispatch-prompt: …`.
  - Keep the golden `sha256` assertion (`dispatch-prompt-cli.test.js:81-88`) unchanged (AC4).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/dispatch/dispatch-prompt-cli.test.js`
Expected: FAIL — `formatPolicyValues is not a function`.

- [ ] **Step 3: Implement** per Interfaces. Delete `parsePolicyValues` and the line-count error message.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/dispatch/dispatch-prompt-cli.test.js tests/dispatch-prompt-cli-prose.test.js tests/bin-lib/cli-entry-conformance.test.js`
Expected: PASS.

- [ ] **Step 4b: Revert-to-red proof (AC7)** — temporarily pass `callerDeps({ cwd: process.cwd(), env })` in `resolvePolicyValues`, re-run the AC4/AC7 fixture test, confirm FAIL, restore; then temporarily drop the `env` thread (`callerDeps({ cwd })`) and confirm a test injecting an env-only value fails — if no test reads an env-only value, say so and name `dispatch-prompt.js` as reading `env` only for forge detection in the task report.

- [ ] **Step 5: Commit** — `git add plugin/bin/dispatch-prompt.js tests/bin-lib/dispatch/dispatch-prompt-cli.test.js` then `git commit -m "Resolve dispatch-prompt policy keys in-process — keep the resolver's warning lines on stderr"`

### Task 4: `phase-exit.js` resolves through the core; retire the kill-timeout

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/phase-exit/phase-exit.js` (header line 9, imports lines 60-61, `RESOLVE_POLICY_JS` line 70, `policyReadTimeoutMs`/`policyEntryValue` lines 77-98, `realDeps.resolvePolicy` lines 114-124, exports line 460)
- Test: `tests/bin-lib/phase-exit/phase-exit.test.js`
- Sweep (Step 5): every non-history hit of `policyReadTimeoutMs`, `policyEntryValue`, `RESOLVE_POLICY_JS`, `printed no entry for`

**Interfaces:**
- Consumes: `resolvePolicy`, `callerDeps`, `scalarValue`, `EXIT_OK` (Task 1). Task 3 already removed `dispatch-prompt.js`'s `policyReadTimeoutMs` import.
- Produces: `realDeps.resolvePolicy(runDir, key, cwd) -> string` — unchanged signature and contract: calls the core with `callerDeps({ cwd })` (bounded git, inherited env); `code !== EXIT_OK` throws `new Error(\`resolve-policy: ${out.message}\`)` (so `errLine` gives the same detail line the child's stderr gave); a `degraded` entry throws `forge detection degraded (${entry.degraded})`; else returns `scalarValue(entry)`. `policyReadTimeoutMs` and `policyEntryValue` are removed from the module and its exports. A comment at the call site states: forge detection is bounded by `gh-timeout-ms` × `FORGE_PROBE_ATTEMPTS` plus `GIT_REMOTE_PROBE_TIMEOUT_MS`, the root lookup by `callerDeps`' `GIT_TIMEOUT_MS`, and the local `policy.yml`/`config.yml` read is unbounded by decision (spec `## Plan Review Clarifications`, Reading A), so no kill timeout is kept.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/phase-exit/phase-exit.test.js`:
  - `test('AC3 phase-exit: a config.yml pinning local-merge resolves local-merge through the core, with no gh call', { skip: STUB_SKIP }, …)` — `forgeFixture('integration-model: local-merge\n')` with `fakeGh({ first: 'hang' })`; `realDeps.resolvePolicy(runDir, 'integration-model', repo) === 'local-merge'`, `gh.count() === 0`.
  - `test('AC3 phase-exit: a missing run dir reports the same detail line as the subprocess did', …)` — expected string `resolve-policy: --run dir does not exist or is not a directory: ${missing}`; assert `realDeps.resolvePolicy(missing, 'integration-model', repo)` throws with exactly that message, and `runPhaseExit` given that resolver logs `integration-model unresolved (resolve-policy: --run dir does not exist or is not a directory: …)`.
  - `test('AC7 phase-exit: a subdirectory worktree resolves the checkout\'s pinned integration-branch', …)` — `policy.yml` `integration-branch: develop` in the fixture repo, `cwd` = a subdirectory; returns `develop`.
  - `test('phase-exit.js no longer exports the retired child-process helpers', …)` — `require(phase-exit).policyReadTimeoutMs === undefined` and `.policyEntryValue === undefined` (the retirement pin; the process count itself is Task 7's measurement — do not monkeypatch `child_process`, which `phase-exit.js` destructures at load).
  - Relabel the existing `a degraded resolve logs the unresolved SKIP …` test `AC5 phase-exit: …`.
  - Delete (states the core cannot produce, or the retired kill-timeout): the two `policyEntryValue:` tests, the three `policyReadTimeoutMs:` tests, the wiring scan (`PHASE_EXIT_SRC`/`LADDER_RE`/`GUARD_RE`/`WIRING_RE`/`policyReadTimeoutMsBody`/`wiringFindings`) and both its tests. Record each deleted test's name and reason for the PR body. Keep the four `realDeps.resolvePolicy:` forge tests and `a run-pinned integration-branch returns its string value` unchanged (they now run in-process; `withForgeEnv` still works because `callerDeps` reads `process.env` at call time).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/phase-exit/phase-exit.test.js`
Expected: FAIL — the retirement pin finds both exports still defined. The AC3 and AC7 tests are characterization pins of today's behaviour and may already pass; they must stay green after Step 3.

- [ ] **Step 3: Implement** per Interfaces; drop the now-unused imports (`GIT_REMOTE_PROBE_TIMEOUT_MS`, `FORGE_PROBE_ATTEMPTS`, `resolveForgeProbeTimeoutMs`, `RESOLVE_POLICY_JS`) only where nothing else in the file uses them; update the header line 9 comment.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/phase-exit/phase-exit.test.js tests/phase-exit-call-sites-conformance.test.js tests/bin-lib/dispatch/dispatch-prompt-cli.test.js`
Expected: PASS.

- [ ] **Step 4b: Revert-to-red proof (AC7)** — temporarily pass `callerDeps({ cwd: process.cwd() })` in `realDeps.resolvePolicy`, re-run the AC7 subdirectory test, confirm FAIL, restore; then temporarily pass `callerDeps({ cwd, env: {} })` and confirm a `realDeps.resolvePolicy` forge test (which relies on `CLAUDE_TWEAKS_GH_TIMEOUT_MS` and the `fakeGh` `PATH` in `process.env`) fails, restore.

- [ ] **Step 5: Retirement sweep** — Run: `git grep -n -e policyReadTimeoutMs -e policyEntryValue -e RESOLVE_POLICY_JS -e 'printed no entry for' -- . ':!.claude-tweaks/pipelines' ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md' ':!CHANGELOG.md'`. Control (run once, record the match in the task report): `git grep -n -F policyReadTimeoutMs d3962cda8 -- plugin/bin/lib/phase-exit/phase-exit.js` matches. Expected after the fix: no output; fix or delete every hit.

- [ ] **Step 6: Commit** — `git add plugin/bin/lib/phase-exit/phase-exit.js tests/bin-lib/phase-exit/phase-exit.test.js` (plus any swept file) then `git commit -m "Resolve phase-exit policy in-process — retire the child kill-timeout"`

### Task 5: `release-tip-check.js` reads the bound through the core

**Role:** integration

**Files:**
- Modify: `plugin/bin/release-tip-check.js` (header line 10, `resolveBound` line 122)
- Modify: `plugin/bin/lib/release-tip/check.js` (`readBound` lines 99-113, comment lines 124-126, call line 179)
- Test: `tests/bin-lib/release-tip/cli.test.js`
- Test: `tests/bin-lib/release-tip/check.test.js`

**Interfaces:**
- Consumes: `resolvePolicy`, `callerDeps`, `EXIT_OK` (Task 1).
- Produces: `run(argv, deps)` accepts optional `deps.resolvePolicy` (default: the core). `resolveBound()` now returns the core's object `{ code, result, message }` = `resolvePolicy({ keys: ['release-tip-moves'], runDir }, callerDeps({ cwd: root }))`. `checkReviewedTip` calls it inside `try`; a throw → `out('failed', 'release-tip-moves unreadable', err.message)`. `readBound(r)`: `r.code !== EXIT_OK` → detail `` `resolve-policy: ${r.message}` `` (the line the child's stderr carried today); then the existing entry checks against `r.result['release-tip-moves']`. The `!r` (`produced no result`), `not JSON` and `exited N` branches are deleted (states the core cannot produce). The call-site comment in `release-tip-check.js` states the bound: the root lookup by `callerDeps`' `GIT_TIMEOUT_MS`, the local policy and `config.yml` read unbounded, no forge key read.

- [ ] **Step 1: Write the failing tests**:
  - `tests/bin-lib/release-tip/check.test.js` `unreadable lever → failed`: replace the three spawn-shaped rows with core-shaped ones — `['refused', { code: 1, message: 'boom' }, /^resolve-policy: boom$/]`, `['entry missing', { code: 0, result: {} }, /missing from the resolver output/]`; add `['resolveBound throws (AC5)', THROWS, /kaboom/]` where the harness makes `resolveBound` throw `new Error('kaboom')`; `boundOf` returns `{ code: 0, result: { 'release-tip-moves': … } }`. Delete the `not JSON` row (record it for the PR body).
  - `tests/bin-lib/release-tip/cli.test.js`: rename `a code move reads the bound through the real resolve-policy.js spawn → delta` to `AC2/AC7 a code move reads the bound through the core at --root → delta` and add a `policy.yml` `release-tip-moves: 3` in `fx.work` asserting `v.bound === 3`, `v.source === 'policy'` (proves `root` reached the core; fails when `cwd` is ignored). Add `test('AC5 a resolvePolicy that throws → failed verdict, exit 0', …)` passing `resolvePolicy: () => { throw new Error('kaboom'); }` through `cli`'s deps.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/release-tip/check.test.js tests/bin-lib/release-tip/cli.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** per Interfaces; update `release-tip-check.js`'s header comment line 10 and `check.js`'s `resolveBound()` comment (lines 124-126) to describe the core object.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/release-tip/check.test.js tests/bin-lib/release-tip/cli.test.js`
Expected: PASS.

- [ ] **Step 5: Revert-to-red proof (AC7)** — temporarily pass `callerDeps({ cwd: process.cwd() })`, re-run the AC7 cli test, confirm FAIL, restore.

- [ ] **Step 6: Commit** — `git add plugin/bin/release-tip-check.js plugin/bin/lib/release-tip/check.js tests/bin-lib/release-tip/check.test.js tests/bin-lib/release-tip/cli.test.js` then `git commit -m "Read the release tip-move bound in-process — core result, no spawn"`

### Task 6: Convert the six direct test files to `runCli`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tests/merge-verification.test.js`
- Modify: `tests/integration-model.test.js`
- Modify: `tests/resolve-policy-run-dir-anchoring.test.js`
- Modify: `tests/declare-claude-tweaks-opt-out.test.js`
- Modify: `tests/policy-verify-suite-slots.test.js`
- Modify: `tests/policy-schema.test.js`

**Interfaces:**
- Consumes: `runCliSync`, `spawnCli` from `tests/helpers/run-cli.js`; `CLI = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-policy.js')` (absolute).

- [ ] **Step 1: Convert each file's local spawn helper** to `runCliSync(CLI, args, { cwd, env })`, mapping the result onto the field its assertions already read (`status`/`stdout`/`stderr`, or the thrown-on-non-zero shape `execFileSync` gave — throw an `Error` carrying `status`/`stdout`/`stderr` on `code !== 0`). In `tests/resolve-policy-run-dir-anchoring.test.js` rename the local `runCli` helper to `runResolver` to avoid shadowing the import. Pass a complete `env` (`{ PATH, HOME, TMPDIR, … }` plus each test's own stub vars); where a test relied on inheriting `process.env` (e.g. `CLAUDE_TWEAKS_GH_TIMEOUT_MS`, `GH_*`), put those keys in the explicit `env`.
- [ ] **Step 2: Keep at most four real processes across the six files.** Keep one `spawnCli` smoke test for the script entry where a file's subject is the process (a closed stderr, exit-code shape); each carries a one-line comment naming the property it proves. Use `fresh: true` on any `integration-model`/`merge-verification` case whose `gh` stub or forge answer differs from an earlier call in the file (the forge probe memo in `repo-resolve.js`).
- [ ] **Step 3: AC7 per file** — each file keeps or gains one in-process test that passes a non-default `cwd` (a fixture repo) or `env` (a `PATH` stub) and asserts a value only that `cwd`/`env` yields; for the `PATH`-stub cases in `integration-model.test.js`/`merge-verification.test.js`, assert the stub's call counter moved (Review Focus 5).
- [ ] **Step 3b: Revert-to-red proof (AC7)** — for each file's AC7 test, temporarily drop the injected value it covers (pass the real repo as `cwd`, or omit the stub `PATH` from `env`), confirm the test FAILs, restore. Record one line per file in the task report.
- [ ] **Step 4: Run**

Run: `node --test tests/merge-verification.test.js tests/integration-model.test.js tests/resolve-policy-run-dir-anchoring.test.js tests/declare-claude-tweaks-opt-out.test.js tests/policy-verify-suite-slots.test.js tests/policy-schema.test.js`
Expected: PASS, same test count per file as before (or fewer, each deletion and its reason recorded). Then run each file alone with `node --test {file}` to confirm no case depends on another file's module state.

- [ ] **Step 5: Commit** — `git add` the six files, `git commit -m "Call resolve-policy.js in-process from its six direct test files"`

### Task 7: Measure, prove, and write the PR evidence

**Role:** integration

**Files:**
- Waived all source files: measurement only. Evidence goes to `$PIPELINE_RUN_DIR/evidence/`.

- [ ] **Step 1: After-measurement** — Run: `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from <list of the twelve files> --json "$PIPELINE_RUN_DIR/evidence/procs-after.json" > "$PIPELINE_RUN_DIR/evidence/procs-after.txt" 2>&1` (absolute run-dir path; the baseline `procs-baseline.json`/`.txt` is already there: 112 `resolve-policy.js` processes, measured 2026-11-14 on d3962cda8). Expected: `resolve-policy.js` total across the twelve ≤ 4 (AC1), and 0 for `tests/bin-lib/wrap-up/engine-cli.test.js`, `tests/wrap-up-engine-journey-crlf.test.js`, `tests/wrap-up-engine-run-dir-anchoring.test.js` (AC2).
- [ ] **Step 1b: AC6.1 smoke tests** — for each converted caller CLI (`plugin/bin/phase-exit.js`, `plugin/bin/dispatch-prompt.js`, `plugin/bin/release-tip-check.js`, `plugin/bin/wrap-up-engine.js`), find in its suite a real-process test asserting exit 0 and stdout on a success path and one asserting a non-zero exit and stderr on a refusal path (`git grep -n -e spawnCli -e spawnSync -e execFileSync -- {suite}`). Add the missing one with `spawnCli` in that suite, commented with the property it proves, and commit (`git commit -m "Pin the script entry of each converted caller CLI"`). These start no `resolve-policy.js` process once Tasks 2-5 land.
- [ ] **Step 2: Independent count** — count `resolve-policy.js` from the after JSON with a `node -e` over `cliProcs["resolve-policy.js"]`, and reconcile with the printed table.
- [ ] **Step 3: AC evidence entries** — one `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file {file}` per AC1/AC2/AC8, each naming the criterion, the command shape, the counts and the evidence path.
- [ ] **Step 4: PR body material (AC8.1)** — before/after table (both runs, `CT_TEST_CONCURRENCY=6`, same machine within the same hour), the list of tests left on a real process with the property each proves, the list of deleted tests with reasons, the per-caller `cwd`/`env` passed to the core (Global Constraints), every `plugin/bin/lib` file changed to pass an injected value (`facts.js`, `phase-exit.js`, `release-tip/check.js`), the failure-line mapping per caller (old non-zero-exit output → `{ code: EXIT_INVOCATION, message }`), and the two reversed premises from `decisions.md`.

---

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (four callers call `resolvePolicy`) | 2, 3, 4, 5 |
| Deliverable 2 (same fallback/error per caller) | 2 (AC5 facts), 3 (AC5), 4 (AC3, AC5), 5 (AC5) |
| Deliverable 3 (delete impossible-state code and fakes) | 3 (line count), 4 (missing entry, kill timeout), 5 (not JSON, exited N) |
| Deliverable 4 (six direct files call `runCli`) | 6 |
| Deliverable 5 / AC8 (before/after table) | 7 |

Waived AC8.1: PR-body content, not code — no test can pin it; Task 7 Step 4 writes it from the two `count-node-procs.js` evidence files, and the review phase checks the PR body against them.
| AC1.1 (≤ 4 processes), AC1.2 (deleted tests stated) | 6, 7 |
| AC2.1 (engine `plan` starts no `resolve-policy.js`) | 2 (AC2 facts), 7 |
| AC3.1 (local-merge pin), AC3.2 (missing run dir line) | 4 |
| AC4.1 (dispatch prompt unchanged) | 3 |
| AC5.1 (throw → documented failure) | 2, 3, 4, 5 |
| AC6.1 (success-path `spawnCli` test per converted CLI), AC6.2 (refusal-path test) | 7 (Step 1b) |
| AC7.1 (non-default `cwd`/`env` per converted file) | 1, 2, 3, 4, 5, 6 |
| AC9.1 (full suite + Windows CI) | Common Step 5 verification and the PR's CI (Windows job dispatched after the last code change) |
| Gotcha: kill-timeout bound | 1 (bounded git), 4 (call-site comment) |
| Gotcha: `policyReadTimeoutMs` deletion | 4 |
| Gotcha: exit-code constants | 1 |
