# Route every gh call's timeout through GH_TIMEOUT_MS — Implementation Plan

> **For agentic workers:** `/claude-tweaks:build` controls execution strategy; ignore any other handoff text. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `engine-verify.js`, `residue.js` and `policy-schema.js`'s forge probe take their `gh` bound from the one `CLAUDE_TWEAKS_GH_TIMEOUT_MS` > `gh-timeout-ms` > 5000 ladder, and `resolveForgeProbeTimeoutMs` stops restating it.

**Architecture:** `shared-primitives.js` gains one root-parameterised, non-memoized ladder function. `resolveForgeProbeTimeoutMs` keeps its explicit-`opts.timeoutMs` rung and delegates the rest to it through a lazy require (which removes the stated cycle). `engine-verify.js`'s gh runner reads `GH_TIMEOUT_MS` per call; `residue.js`'s `run` closure adds it to every `gh` argv.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T153423-spec-4856-5050/spec-4856/work/4856-spec.md` (record #4856). `console-resolve.js` is #5050's — do not touch it.

**Scope keywords:** GH_TIMEOUT_MS, resolveForgeProbeTimeoutMs, ghTimeoutMsAt, CLAUDE_TWEAKS_GH_TIMEOUT_MS, makeDefaultRunner

## Global Constraints

- Ladder: env `CLAUDE_TWEAKS_GH_TIMEOUT_MS` (a positive integer inside the `gh-timeout-ms` policy key's own `[min, max]`) > policy `gh-timeout-ms` > `5000`. An invalid env value falls through; nothing throws.
- Git calls keep their own bound (`engine-verify.js`'s git runner stays at 5000 and never follows the gh ladder).
- AC1.1 (Tasks 2, 3, 4): with `CLAUDE_TWEAKS_GH_TIMEOUT_MS=12000`, each of `engine-verify.js`, `residue.js` and `resolveForgeProbeTimeoutMs` passes `timeout: 12000` to its gh spawn.
- AC2.1 (Tasks 3, 5): `grep -n 'timeout: 5000\|timeout: 30000' plugin/bin/lib/wrap-up/engine-verify.js` prints nothing.
- AC3.1 (Task 5): `npm test` passes.
- `tests/gh-host-seam-conformance.test.js` pins `residue.js`'s `const wrap = argv[0] === 'gh' ? ghOptions : `, `execFileSync(argv[0], args, wrap(args, {` and `probeForge({ scope, run, ` — keep all three text-identical.
- Edit in place; no unrelated cleanup. Commit style: `{Verb} {what} — {detail}`, ending with the `Claude-Session:` line from the build context.

## Review Focus

- A policy-less root plus env `9e3` or `' 9000'`: the old forge ladder fell through to 5000, the shared check accepts both (intended, Task 2 pins it).
- `resolveForgeProbeTimeoutMs(undefined | null | 42)` must still return the default, never throw.
- Two different roots with different `gh-timeout-ms` values in one process must resolve independently (the new function must not memoize).
- `CLAUDE_TWEAKS_GH_TIMEOUT_MS` must not change `engine-verify.js`'s git bound.
- `residue.js`: a non-`gh` argv gets no injected `timeout` (Task 4 asserts it); a `timeout` in a caller's `execOpts` still wins by spread order (no caller passes one for `gh` today, so it is not separately tested).

---

### Task 1: Root-parameterised ladder in shared-primitives

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/shared-primitives.js` (`timeoutFromEnv`, `ghTimeoutFromEnv`, `ghTimeoutFromPolicy`, `resolveGhTimeoutMs`, exports)
- Test: `tests/bin-lib/shared-primitives.test.js` (next to the `GH_TIMEOUT_MS resolution (#2567)` tests; reuse its `writePolicyFile`)

**Interfaces:**
- Produces: `ghTimeoutMsAt(repoRoot: string | unknown, opts?: { env?: object }): number` exported from `shared-primitives.js`. Ladder above; `opts.env` replaces `process.env` as the env source; a non-string `repoRoot` has no policy file and resolves the default; a non-object `opts.env` (`null`, a string) is treated as absent and reads `process.env`; **not memoized**. `GH_TIMEOUT_MS` keeps its memoized getter and now resolves through `ghTimeoutMsAt`, with `process.cwd()` evaluated inside the caught region: when `process.cwd()` throws (a reaped worktree's deleted cwd) the policy rung yields nothing, so env or `5000` still resolves and the getter never throws.

- [ ] **Step 1: Write the failing tests** (new `test(...)` blocks, `ghTimeoutMsAt` imported from `../../plugin/bin/lib/shared-primitives`):
  - `ghTimeoutMsAt: policy 7000 and env {} -> 7000`; `env {CLAUDE_TWEAKS_GH_TIMEOUT_MS:'12000'}` -> `12000`.
  - `env '9e3'` -> `9000` and `env ' 9000'` -> `9000` (policy-less root).
  - `env 'abc' | '0' | '90000'` with policy 7000 -> `7000`.
  - `repoRoot` `undefined | null | 42` with `env {}` -> `5000`; with env `'9000'` -> `9000`.
  - two temp roots, policies `7000` and `8000`, called alternately with `env {}` -> `7000, 8000, 7000` (no memoization).
  - no `opts` argument reads `process.env`: set `CLAUDE_TWEAKS_GH_TIMEOUT_MS='15000'`, restore in `finally`, expect `15000`; `opts.env` of `null` behaves the same.
  - the `GH_TIMEOUT_MS` getter with `process.cwd` stubbed to throw: with env `'12000'` it yields `12000`, with no env it yields `5000` (evict the module first, as `freshGhTimeoutMs` does; restore `process.cwd` in `finally`).
- [ ] **Step 2: Run to verify failure:** `node --test tests/bin-lib/shared-primitives.test.js` — Expected: FAIL (`ghTimeoutMsAt is not a function`).
- [ ] **Step 3: Implement.** `timeoutFromEnv(envVar, boundsOf, env = process.env)` reads from `env`; `ghTimeoutFromEnv(env)` and `ghTimeoutFromPolicy(repoRoot)` take their source as a parameter (the lazy `require('./policy')`/`try`/`catch` stays); add `ghTimeoutMsAt(repoRoot, { env } = {})` = `ghTimeoutFromEnv(env) ?? ghTimeoutFromPolicy(repoRoot) ?? DEFAULT_GH_TIMEOUT_MS`; `resolveGhTimeoutMs()` returns `ghTimeoutMsAt(process.cwd())`; export it as a plain property. The git/push callers of `timeoutFromEnv` keep working through the default `env`.
- [ ] **Step 4: Run to verify pass:** `node --test tests/bin-lib/shared-primitives.test.js` — Expected: all pass, including the existing `GH_TIMEOUT_MS` tests.
- [ ] **Step 5: Commit** `Add ghTimeoutMsAt — root-parameterised gh timeout ladder (#4856)` (stage the two files by path).

### Task 2: `resolveForgeProbeTimeoutMs` delegates to the shared ladder

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (`resolveForgeProbeTimeoutMs`, its header comment at ~814-822)
- Test: `tests/forge-probe-env.test.js`; `tests/integration-model-gh-timeout.test.js`

**Interfaces:**
- Consumes: `ghTimeoutMsAt` (Task 1).
- Produces: `resolveForgeProbeTimeoutMs(repoRoot, opts)` unchanged in signature and export: a positive-integer `opts.timeoutMs` returns before any read; otherwise `require('./shared-primitives').ghTimeoutMsAt(repoRoot, { env: opts && opts.env })`, the `require` inside the function body.

- [ ] **Step 1: Write the failing test** in `tests/forge-probe-env.test.js`: `resolveForgeProbeTimeoutMs accepts the shared env spellings 9e3 and " 9000"` — on a policy-less temp root (`tmp('timeout')`), `{ env: { CLAUDE_TWEAKS_GH_TIMEOUT_MS: '9e3' } }` -> `9000` and `' 9000'` -> `9000`. Add a third case, `resolveForgeProbeTimeoutMs(root, { env: null })` with policy `7000` -> `7000` (the never-throws contract). Also add, in `tests/integration-model-gh-timeout.test.js`, `AC: detectIntegrationModel's gh probe passes timeout 12000 under CLAUDE_TWEAKS_GH_TIMEOUT_MS=12000` using `captureGhTimeout({ envValue: '12000', modulePaths: [require.resolve('../plugin/bin/lib/policy-schema')], exercise })` from `tests/helpers/gh-timeout-probe.js`, where `exercise(setEnv)` calls `setEnv()` and then `require('../plugin/bin/lib/policy-schema').detectIntegrationModel(process.cwd())`; expect `12000` (this one already passes — it is the AC's regression guard).
- [ ] **Step 2: Run to verify failure:** `node --test tests/forge-probe-env.test.js` — Expected: FAIL on the `9e3` test (`5000 !== 9000`); the AC test passes.
- [ ] **Step 3: Implement.** Replace the body after the explicit-`timeoutMs` rung with the delegation; delete the `isValidValue`/`readFileSafe`/`parseFlatLines`/`resolveValue` ladder copy but leave those helpers (other code uses them); rewrite the header comment to say the ladder lives in `shared-primitives.ghTimeoutMsAt` and the lazy require is why there is no load-time cycle.
- [ ] **Step 4: Run to verify pass:** `node --test tests/forge-probe-env.test.js tests/integration-model.test.js tests/integration-model-gh-timeout.test.js tests/policy-schema.test.js` — Expected: all pass (the existing `resolveForgeProbeTimeoutMs` ladder tests in `integration-model.test.js` are the regression net and stay unedited).
- [ ] **Step 5: Commit** `Delegate resolveForgeProbeTimeoutMs to the shared gh ladder — drop its restated copy (#4856)`.

### Task 3: `engine-verify.js` gh runner follows `GH_TIMEOUT_MS`

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js` (imports; `makeDefaultRunner` and its two call sites, lines ~23-63)
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js` (the `#1230` test at ~3728-3761)

**Interfaces:**
- Produces: `makeDefaultRunner(cmd: string, wrap?: Function, boundOf?: () => number)`; `defaultGit` passes `() => GIT_BOUND_MS` (a named `const GIT_BOUND_MS = 5000`), `defaultGh` passes `() => sharedPrimitives.GH_TIMEOUT_MS`, read per call. `defaultGit`/`defaultGh` exports and call shape `(args, cwd, ctx)` unchanged.

- [ ] **Step 1: Write the failing test and fix the pinned one.** Add `#4856: defaultGh passes timeout 12000 under CLAUDE_TWEAKS_GH_TIMEOUT_MS=12000` using `captureGhTimeout({ envValue: '12000', modulePaths: [require.resolve('../../../plugin/bin/lib/wrap-up/engine-verify')], exercise })`, `exercise(setEnv)` = `setEnv()` then `require(...engine-verify).defaultGh(['--version'], process.cwd())`; expect `12000`. In the `#1230` test, keep both-calls-carry-a-timeout and `gitCall[2].timeout === 5000`, drop the `gitCall[2].timeout === ghCall[2].timeout` equality (gh now follows the ladder, git does not), and retitle it `#1230: defaultGit and defaultGh both carry a timeout; git's is its own 5000 bound`. Also set `CLAUDE_TWEAKS_GH_TIMEOUT_MS='12000'` around that test's `defaultGit` call (restore in `finally`, evict the module as it already does) and assert git's `timeout` is still `5000`.
- [ ] **Step 2: Run to verify failure:** `node --test tests/bin-lib/wrap-up/engine-verify.test.js` — Expected: FAIL only on the new test (`5000 !== 12000`).
- [ ] **Step 3: Implement** as the Interfaces block says: `const sharedPrimitives = require('../shared-primitives'); const { isPathContained } = sharedPrimitives;` replacing the existing single-name import; `timeout: boundOf()` replaces the literal; refresh the factory comment to say why gh and git bounds differ.
- [ ] **Step 4: Verify.** `node --test tests/bin-lib/wrap-up/engine-verify.test.js` — Expected: all pass. Then `grep -n 'timeout: 5000\|timeout: 30000' plugin/bin/lib/wrap-up/engine-verify.js` — Expected: no output (scratch check, not committed).
- [ ] **Step 5: Commit** `Route engine-verify's gh runner through GH_TIMEOUT_MS — git keeps its own bound (#4856)`.

### Task 4: `residue.js` bounds its gh calls

**Files:**
- Modify: `plugin/bin/residue.js` (the shared-primitives import at line 15; the `run` closure at line 112; the `runner` comment at 60-65)
- Create: `tests/bin-lib/residue/gh-timeout.test.js`

**Interfaces:**
- Decided at plan review: `engine-verify.js` and `residue.js` read the memoized `GH_TIMEOUT_MS` (process env, process cwd's policy), not their injected `ctx.env` / `deps.env`, as every other gh call site does.
- Produces: through the CLI's `run` closure, a `gh` argv reaches `deps.runner(cmd, opts)` with `opts.timeout === sharedPrimitives.GH_TIMEOUT_MS` (read per call); a `timeout` in the caller's `execOpts` still wins; a non-`gh` argv gets none added.

- [ ] **Step 1: Write the failing test** in the new file: set `CLAUDE_TWEAKS_GH_TIMEOUT_MS='12000'`, evict `plugin/bin/lib/shared-primitives` and `plugin/bin/residue` from `require.cache`, require `residue` fresh, build a temp git repo (copy `initRepo` from `tests/bin-lib/residue/cli.test.js`), and call `fresh.run(['--base', 'HEAD', '--no-suite'], { runner, cwd: () => root, stdout: () => {}, stderr: () => {} })` where `runner(argv, opts)` records `[argv, opts]`, returns `'[]'` for a `gh` argv and delegates to `fresh.realDeps.runner` otherwise. Assert exit code `0`, that the recorded `gh pr list` call has `opts.timeout === 12000`, and that the recorded `git rev-parse` call carries no `timeout` key. Restore the env var and evict both modules in `finally`.
- [ ] **Step 2: Run to verify failure:** `node --test tests/bin-lib/residue/gh-timeout.test.js` — Expected: FAIL (`undefined !== 12000`).
- [ ] **Step 3: Implement.** `const sharedPrimitives = require('./lib/shared-primitives'); const { LARGE_MAX_BUFFER_BYTES } = sharedPrimitives;`; in `run`'s closure add `...(cmd[0] === 'gh' ? { timeout: sharedPrimitives.GH_TIMEOUT_MS } : {})` between the `homeDir` entry and `...execOpts`; rewrite the `runner` comment so it no longer says every probe except `git ls-remote` is local-only (the forge probe's `gh pr list` contacts the forge and is bounded by the `run` closure), and state there that the runner returns `null` for every failure, so a timed-out `gh pr list` reports the probe's generic `gh unavailable or not authenticated` reason (accepted at plan review; a distinct timeout reason is out of scope).
- [ ] **Step 4: Verify.** `node --test tests/bin-lib/residue tests/gh-host-seam-conformance.test.js tests/residue-own-pr-conformance.test.js` — Expected: all pass (the conformance text pins are unchanged).
- [ ] **Step 5: Commit** `Bound residue's forge probe with GH_TIMEOUT_MS — a stalled gh no longer hangs the sweep (#4856)`.

### Task 5: Whole-suite proof

- [ ] **Step 1:** `grep -n 'timeout: 5000\|timeout: 30000' plugin/bin/lib/wrap-up/engine-verify.js` — Expected: no output.
- [ ] **Step 2:** Run the full suite through `bin/verify.js` as `/claude-tweaks:build`'s Common Step 5 prescribes — Expected: pass.
