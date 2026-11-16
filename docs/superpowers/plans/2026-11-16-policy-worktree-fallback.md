# Policy-file worktree fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a linked worktree whose project keeps `.claude-tweaks/policy.yml` out of git, every shared policy reader reads the main checkout's file, so `pr-early-open.js` targets the configured `integration-branch`.

**Architecture:** One new module, `plugin/bin/lib/policy-file.js`, decides which `policy.yml` path a root reads: the root's own file when it exists, else — only when the root is a linked-worktree top (`.git` is a file) — the main checkout's, found with `worktree-detect.js`'s `mainCheckoutRoot()` (the same zero-subprocess walk `$RUN_ROOT` resolution uses, `run-dir-resolve.js`). `policy-schema.js` and `policy.js` route their path joins through it; `resolvePolicyConfig` reports which file it read; `resolve-policy.js` and `pr-early-open.js` surface the fallback on stderr.

**Tech Stack:** Node 18+ CommonJS, zero runtime deps, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T094830-record-4492/work/4492-spec.md` (record #4492)

## Global Constraints

- Plugin ships zero runtime npm deps; `plugin/bin/**` code only.
- Source-scan lint (`tests/path-guard-conformance.test.js`): no `fs.existsSync` / `fs.realpathSync` token in new or edited `plugin/bin` code — use `plugin/bin/lib/path-guard`'s `lstatType(p, { fsImpl })` (returns `{ type: 'missing' | 'unreadable' | 'symlink' | 'file' | 'directory' | 'other' }`).
- No new `child_process` spawn anywhere in this change (the locator is fs-only), so `tests/windows-hide-spawn-conformance.test.js` is unaffected.
- Hook hot path (`hooks/pre-tool-use.js` → `policy.isWorktreeAlwaysOn`): the fallback runs only when the root's own file is missing; `worktree-detect.js` is `require`d lazily inside that branch, never at module top (the reason is `policy.js`'s `resolvePortServices` comment: a top-level require of the `hooks/` chain reaches every consumer).
- Spec Gotcha, verbatim: "A worktree cwd that is not inside any git repo must keep the current `process.cwd()` fallback, not throw." The locator never throws; any lookup failure returns the root's own path, source `checkout`.
- Spec Gotcha, verbatim: "On Windows, `--git-common-dir` can return a relative or forward-slash path. Resolve it against the cwd before taking its parent." Here satisfied by `mainCheckoutRoot`, which resolves the `.git` file's `gitdir:` value with `path.resolve(dir, m[1])`; Task 1 pins a relative `gitdir:`.
- `bin/hooks.sh`'s `policy_verdict` (a shell copy of `resolveWorktreeAlways`) is called only with `main_root`'s main-checkout root, where behavior is unchanged — do not edit `hooks.sh`; `tests/hooks-launcher.test.js` AC9 parity must stay green (its fixtures are plain directories, never linked worktrees).
- Every `--files-from <(printf …)` command below means: write those paths one per line to a scratch list file with the Write tool, then run `node tools/run-tests.js --files-from {that file}` (a process substitution may be refused by the worktree guard).
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #4492`, plus the trailer `Claude-Session: https://claude.ai/code/session_016yg3zqLjqT73sN6wwunbTF`. Never `closes`/`fixes` in a commit.
- Governing project skills, rules quoted verbatim:
  - `git-ground-truth-test-env`: "**A reader call in a test passes an explicit env.** Build it from `process.env` minus the variables the reader keys on." and "**Prove both under the runner.** Run `node tools/run-tests.js --files-from <list>`, never only a bare `node --test`: the runner's env is part of the test's input."
  - `windows-checkout-test-parity` Decision Framework row: "A path emitted as an ID in a report, JSON row or glob | `toPosix` at the producer, never on a path later opened with `fs`" — the locator's `path` is an `fs` path: keep it native, never `toPosix` it.
  - `gh-api-module-pattern/cli-wrapper-contract.md`: "**A guard added to an existing `run(argv, deps)` reaches the environment through `deps` too.**" — `pr-early-open.js`'s linked-worktree probe goes through a `deps.isLinkedWorktreeRoot` seam (default the real one), so CLI tests can fake it.
  - `policy-key-addition`: not applicable — no key is added or reshaped.

Mechanism (logged to `decisions.md` before dispatch): Deliverable 1's "resolved the same way as `$RUN_ROOT`" is `mainCheckoutRoot()` — `_shared/pipeline-run-dir.md`'s Anchoring section names it as what `resolve-run-dir --root-only` follows — and the spec's Technical Approach says to "Reuse the existing `$RUN_ROOT` resolution … rather than writing a second `--git-common-dir` parser"; it costs zero git spawns, not one. Accepted divergence, shared with `$RUN_ROOT`: a layout whose worktree admin dir is not under `.git/worktrees/` (a `--separate-git-dir` main repo) resolves no main checkout, so it gets no fallback (today's behavior) — say so in the module header. AC5.1 is kept as written: its three locator cases are tested through `resolvePolicyConfig` with a fake `git` runner (keyed on argv, as `tests/bin-lib/blast-radius-cli.test.js`'s `fakeGit` is), in Task 2; Task 1's seam tests are additional.

Root contract: `locatePolicyFile(root)` takes a checkout top level. A caller passing a cwd (`resolve-profile.js`, `release-notes-publish.js` without `--root`) keeps today's cwd-as-root reading: from a subdirectory it reads `{subdir}/.claude-tweaks/policy.yml` (absent) in the main checkout and in a worktree alike, so the change adds no divergence there; sessions run with cwd at the checkout top level, where the fallback applies. The locator reads the real filesystem at every caller, including callers whose own read seam (`readFile`, `readPolicy`) a test fakes: existence comes from the disk, contents from the seam. A test that fakes contents for a root with no `.git` on disk gets the own path back (no `.git` → no fallback), so existing fake-read tests are unaffected.

Scope note: the spec's Current State says every policy reader goes through the three named functions; `git grep -n -F "'policy.yml'" -- plugin/bin` (run at plan time) shows 16 sites, so the three are not the one shared place. Its stated goal — "fixes every policy key and every reader at once" — needs every reader: `policy-schema.js`'s `resolveForgeProbeTimeoutMs`/`resolveIntegrationModel` and `policy.js`'s `readRiskPolicy` (Task 2), and the eight direct readers in other modules (Task 5). Left as is on purpose: `hooks/pre-tool-use.js:97`'s `POLICY_FILE` (a write-target exemption path, not a read) and `hooks/worktree-detect.js:196`'s `findPolicyFile` (an ancestor-walk fast-reject that already finds the main checkout's file from a worktree nested under it, and whose false negative only skips a gate that allows in a linked worktree anyway).

## Review Focus

1. A root that is the main checkout with no `policy.yml` (most consumer projects) must not walk anywhere: `.git` is a directory, so no fallback — Task 1 `main checkout, file absent` test.
2. A submodule root (`.git` file pointing at `.git/modules/…`): `mainCheckoutRoot` returns null, so no fallback and no superproject policy leaks in — Task 1 `submodule` test.
3. A worktree whose own `policy.yml` is a dangling symlink or unreadable: treated as present (only `missing` falls back), reading yields null exactly as today — Task 1 `own file unreadable/symlink` test.
4. A `.git` file with a relative `gitdir:` (git ≥ 2.48 `worktree.useRelativePaths`, and the Windows gotcha) still resolves the main checkout — Task 1 real-fs test.
5. The hook gate in a linked worktree now sees `worktree-always: true` from the main checkout; `checkWorktreeRequired` still allows because `isLinkedWorktree` is checked right after — Task 4 runs `tests/hooks-pre-tool-use.test.js` and `tests/hooks-session-start.test.js` plus `perf/hooks-prefilter.test.js`.

---

### Task 1: Policy-file locator module

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/policy-file.js`
- Test: `tests/bin-lib/policy-file.test.js`
- Waived `plugin/skills/_shared/pipeline-run-dir.md`: reference only — its Anchoring section names `mainCheckoutRoot` (via `run-dir-resolve.js`) as `$RUN_ROOT`'s resolver; read in this task's Step 3, not edited.

**Interfaces:**
- Produces:
  - `POLICY_REL_PATH` — `path.join('.claude-tweaks', 'policy.yml')`
  - `isLinkedWorktreeRoot(root: string, deps?: { fsImpl?, mainCheckoutRoot?: (p) => string|null }) -> boolean` — true only when `lstatType(path.join(root, '.git')).type === 'file'` and `mainCheckoutRoot(root)` returns a non-null path. Never throws (a throwing seam → false).
  - `locatePolicyFile(root: string, deps?: same) -> { path: string, source: 'checkout' | 'main-checkout' }` — own path when `lstatType(own).type !== 'missing'`; else, when `isLinkedWorktreeRoot(root)` and the main checkout's `lstatType(mainPolicy).type !== 'missing'`, `{ path: mainPolicy, source: 'main-checkout' }`; else `{ path: own, source: 'checkout' }`. A non-string `root` returns `{ path: null, source: 'checkout' }`. `mainCheckoutRoot` defaults to a lazy `require('./hooks/worktree-detect').mainCheckoutRoot`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/policy-file.test.js`. Fake-seam unit tests (an `fsImpl` whose `lstatSync` answers from a `Map` of path → `'file' | 'dir' | Error{code}`; a `mainCheckoutRoot` stub that records calls):
  - `AC5.1: worktree file present — returns the worktree's own path, source checkout, mainCheckoutRoot never called`
  - `AC5.1: worktree file absent, main present — returns the main checkout's path, source main-checkout`
  - `AC5.1: both absent — returns the worktree's own path, source checkout`
  - `AC3.1: main checkout, file absent — .git is a directory, no fallback, mainCheckoutRoot never called`
  - `submodule: .git file but mainCheckoutRoot returns null — own path, source checkout`
  - `own file unreadable (EACCES) or a symlink — treated as present, no fallback`
  - `a throwing mainCheckoutRoot — own path, source checkout, no throw`
  - `non-string root — { path: null, source: 'checkout' }`
  - `isLinkedWorktreeRoot: true for a .git file with a main root; false for a .git directory, a missing .git, and a null main root`
  
  Real-fs tests (no git binary — a hand-built `.git` file, as `tests/hooks-worktree-detect.test.js` does for the submodule shape), using the real `mainCheckoutRoot`, expected paths built from `fs.realpathSync(main)`:
  - `real fs: absolute gitdir — worktree without policy.yml reads main's`
  - `real fs: relative gitdir (gitdir: ../main/.git/worktrees/wt) — still resolves main's`

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/policy-file.test.js`
Expected: FAIL with `Cannot find module '../../plugin/bin/lib/policy-file'`

- [ ] **Step 3: Implement `plugin/bin/lib/policy-file.js`** per the Interfaces block, header comment naming #4492 and the `$RUN_ROOT` reuse (`run-dir-resolve.js` → `mainCheckoutRoot`). Use `lstatType` from `./path-guard`; no `existsSync`/`realpathSync` tokens.

- [ ] **Step 4: Run to verify it passes**

Run: `node tools/run-tests.js --files-from <(printf '%s\n' tests/bin-lib/policy-file.test.js tests/path-guard-conformance.test.js)`
Expected: PASS, 0 failures. Then delete the `fs.statSync`-equivalent `.git`-is-file check (make `isLinkedWorktreeRoot` return `mainCheckoutRoot(root) !== null`) and confirm the `AC3.1` test goes red; restore.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-file.js tests/bin-lib/policy-file.test.js
git commit -m "Add policy-file locator — main-checkout fallback for a linked worktree (refs #4492)"
```

### Task 2: Route the shared readers through the locator

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` — `resolvePolicyConfig` (~line 975), `auditPolicy` (~988), `resolveIntegrationModel` (~952), `resolveForgeProbeTimeoutMs` (~830)
- Modify: `plugin/bin/lib/policy.js` — `readPolicyFile` (line 17), `readRiskPolicy` (line 122)
- Test: `tests/policy-schema.test.js`, `tests/policy.test.js`
- Consumers of the widened `resolvePolicyConfig` return (all destructure, none deep-compares the whole object — grep `resolvePolicyConfig` over `plugin/bin` and `tests`, 15 call sites, run in Step 4): no change needed.

**Interfaces:**
- Consumes: `locatePolicyFile`, `POLICY_REL_PATH` (Task 1).
- Produces: `resolvePolicyConfig(...)` returns `{ root, policyRaw, runConfigRaw, result, policyPath, policySource }` — `policyPath` the file read, `policySource` `'checkout' | 'main-checkout'`. `readPolicyFile(repoRoot)` reads `locatePolicyFile(repoRoot).path`. `auditPolicy`, `resolveIntegrationModel`, `resolveForgeProbeTimeoutMs`, `readRiskPolicy` read the located path; `auditPolicy`'s `CLAUDE.md` read stays at `repoRoot`.

- [ ] **Step 1: Write the failing tests.** Real-fs fixture helper in each file: `main/` with a `.git` directory and `main/.git/worktrees/wt/`, `wt/` with `.git` = `gitdir: {main}/.git/worktrees/wt`, `main/.claude-tweaks/policy.yml` = `integration-branch: develop\nworktree-always: true\n`.
  - `tests/policy-schema.test.js` — the AC5.1 three-case set through `resolvePolicyConfig`, its `git` a fake runner keyed on argv (`rev-parse --show-toplevel` → `{wt}\n`, anything else throws), as `tests/bin-lib/blast-radius-cli.test.js`'s `fakeGit` is:
    - `AC5.1: resolvePolicyConfig, fake git runner — worktree file present: reads it, policySource checkout`
    - `AC5.1: resolvePolicyConfig, fake git runner — worktree absent, main present: reads main's, policySource main-checkout`
    - `AC5.1: resolvePolicyConfig, fake git runner — both absent: policyRaw null, policySource checkout, every key at its default`
    - `AC1.1: resolvePolicyConfig from a linked worktree without policy.yml reads the main checkout's — integration-branch develop, policySource main-checkout` (fake `git` returning `{wt}\n` for `rev-parse --show-toplevel`, real `readFile`)
    - `AC2.1: resolvePolicyConfig — a worktree policy.yml wins; the main checkout's is not read` (worktree file `integration-branch: release\n`; a `readFile` wrapper records paths; assert the main path is absent from the record)
    - `AC3.1: resolvePolicyConfig from the main checkout — policySource checkout, same result as before` 
    - `auditPolicy from a linked worktree audits the main checkout's policy.yml` (main file carries an unknown key `bogus-key: 1`; assert `unrecognizedKeys` includes it)
  - `tests/policy.test.js`:
    - `AC1.1: readIntegrationBranch and isWorktreeAlwaysOn read the main checkout's policy from a linked worktree root`
    - `readRiskPolicy from a linked worktree reads the main checkout's control-mode`

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/policy-schema.test.js tests/policy.test.js`
Expected: FAIL — the new tests read `null`/unset (`policySource` undefined).

- [ ] **Step 3: Implement** — replace each `path.join(root|repoRoot, '.claude-tweaks', 'policy.yml')` in the six functions above with `locatePolicyFile(...).path` (a `null` path reads as `null` raw, matching `resolveForgeProbeTimeoutMs`'s existing non-string guard). `require('./policy-file')` at the top of both modules is fine — it pulls only `path-guard`; `worktree-detect` stays lazy inside the locator.

- [ ] **Step 4: Run to verify they pass**

Run: `node tools/run-tests.js --files-from <(printf '%s\n' tests/policy-schema.test.js tests/policy.test.js tests/forge-probe-env.test.js tests/merge-verification.test.js tests/bin-lib/console/cli.test.js tests/hooks-launcher.test.js tests/path-guard-conformance.test.js)`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/bin/lib/policy.js tests/policy-schema.test.js tests/policy.test.js
git commit -m "Read policy.yml through the locator — shared readers see the main checkout's file from a worktree (refs #4492)"
```

### Task 3: resolve-policy.js degrade note, end-to-end worktree test, ladder note

**Role:** integration

**Files:**
- Modify: `plugin/bin/resolve-policy.js` — `resolvePolicy` (~line 124) returns `policySource`, `policyPath`, `root`; `warningLines` (~189) emits the note; header comment documents it
- Modify: `plugin/skills/_shared/integration-branch.md` — rank 3 (lines 17-23): one added sentence (12,354 B now; rail 52,500 B — ample headroom)
- Test: `tests/resolve-policy-worktree-fallback.test.js` (create)

**Interfaces:**
- Consumes: `resolvePolicyConfig`'s `policySource`/`policyPath` (Task 2).
- Produces: `resolvePolicy` result gains `root`, `policySource`, `policyPath`; `warningLines(out)` emits, first and in every output mode when `out.policySource === 'main-checkout'`, exactly:
  `resolve-policy: note — {root} has no .claude-tweaks/policy.yml; read the main checkout's {policyPath}\n`
  In-process callers (`calibration-report.js`, `dispatch-prompt.js`) spread `out` into `warningLines`, so they get the note unchanged-code.

- [ ] **Step 1: Write the failing test** `tests/resolve-policy-worktree-fallback.test.js` — real git: `gitRepo()` main, commit a `.gitignore` of `.claude-tweaks/` (via `fixtureGit`), write `main/.claude-tweaks/policy.yml` = `integration-branch: develop\n`, `linkedWorktreeOf(main)`; spawn `plugin/bin/resolve-policy.js` with `runCliSync` and an explicit env built from `process.env` minus every `GIT_CONFIG*` name (git-ground-truth rule 1):
  - `AC1.1/AC5.2: from a linked worktree of a project that gitignores .claude-tweaks/, --values integration-branch prints develop and notes the fallback on stderr` — stdout `develop\n`; stderr equals the note with `{root}` = the worktree realpath and `{policyPath}` = `path.join(fs.realpathSync(main), '.claude-tweaks', 'policy.yml')`
  - `AC2.1: a worktree with its own policy.yml uses it — prints release, no note` (write `wt/.claude-tweaks/policy.yml` = `integration-branch: release\n`)
  - `AC3.1: from the main checkout — prints develop, stderr empty`
  - `JSON mode from the worktree carries the same stderr note and the unchanged { value, source } entry`

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/resolve-policy-worktree-fallback.test.js`
Expected: FAIL — stdout empty line / no note (Task 2 already landed, so stdout passes and the note assertion fails; either is a FAIL).

- [ ] **Step 3: Implement** the Produces block in `resolve-policy.js`; add the note to the header comment's stderr contract. In `integration-branch.md` rank 3, after the existing "An unset key prints an empty line…" sentence, add: "From a linked worktree whose own checkout has no `policy.yml` (a project that keeps it out of git), the resolver reads the main checkout's file instead and says so on stderr (#4492), so this rank answers the same in a worktree as in the main checkout."

- [ ] **Step 4: Run to verify it passes**

Run: `node tools/run-tests.js --files-from <(printf '%s\n' tests/resolve-policy-worktree-fallback.test.js tests/resolve-policy-cli.test.js tests/resolve-policy-entry.test.js tests/resolve-policy-lib.test.js tests/resolve-policy-run-dir-anchoring.test.js tests/resolve-policy-control-mode.test.js)`
Expected: PASS, 0 failures. Then remove the `warningLines` note branch and confirm the AC1.1 test goes red; restore.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/resolve-policy.js plugin/skills/_shared/integration-branch.md tests/resolve-policy-worktree-fallback.test.js
git commit -m "Note the main-checkout policy fallback on resolve-policy stderr (refs #4492)"
```

### Task 4: pr-early-open.js default-branch warning, hot-path proof

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/pr-early-open.js` — base resolution (~lines 198-222), `realDeps` (~103), header comment
- Test: `tests/bin-lib/flow/pr-early-open.test.js` (CLI section, after line ~788)
- Waived `plugin/bin/lib/hooks/pre-tool-use.js`: read only — the Gotcha's hot-path check is Step 4's test + perf run, no edit.

**Interfaces:**
- Consumes: `isLinkedWorktreeRoot` (Task 1); `resolvePolicyConfig`'s `root` (already returned).
- Produces: `realDeps.isLinkedWorktreeRoot` (default the Task 1 export). When no `--base` and no configured `integration-branch`, and `deps.isLinkedWorktreeRoot(root)` is true, stderr gets exactly:
  `pr-early-open.js: warning: no integration-branch found (this worktree's policy.yml, the main checkout's, or the run's config.yml) — the draft PR targets the GitHub default branch "{base}" from linked worktree {root}\n`
  emitted after `base` is resolved and before `openPrEarly`; exit code and stdout unchanged.

- [ ] **Step 1: Write the failing tests** (reuse `cliFixture`/`cliDeps`; for the worktree cases make `fx.wt` a real `linkedWorktreeOf(fx.root)` and have the fake `git` answer `rev-parse --show-toplevel` with `fx.wt`):
  - `AC1.1: CLI from a linked worktree without policy.yml resolves base develop from the main checkout's policy` — main policy `integration-branch: develop\n`; `--base` arg of `gh pr create` is `develop`; no warning
  - `AC4.1: CLI from a linked worktree with no integration-branch anywhere warns on stderr and still opens against the GitHub default` — `defaultBranch: 'trunk'`; exit 0; base `trunk`; stderr equals the warning with `{root}` = `fx.wt`
  - `AC3.1: CLI from the main checkout falling back to the GitHub default prints no warning` — extend the existing `base falls back to the GitHub default branch` test with `assert.equal(h.err.join(''), '')`

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/flow/pr-early-open.test.js`
Expected: FAIL after Step 1 — AC4.1 finds no warning (AC1.1 already passes after Task 2; that is expected).

- [ ] **Step 3: Implement** the Produces block; document the warning in the header comment.

- [ ] **Step 4: Run to verify it passes, plus the hot-path proof**

Run: `node tools/run-tests.js --files-from <(printf '%s\n' tests/bin-lib/flow/pr-early-open.test.js tests/hooks-pre-tool-use.test.js tests/hooks-session-start.test.js tests/hooks-launcher.test.js tests/hooks-worktree-detect.test.js)`
Expected: PASS, 0 failures.
Run: `node --test perf/hooks-prefilter.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/pr-early-open.js tests/bin-lib/flow/pr-early-open.test.js
git commit -m "Warn when pr-early-open falls back to the GitHub default branch from a worktree (refs #4492)"
```

### Task 5: Route the remaining direct readers

**Role:** integration

**Files:**
- Modify: `plugin/bin/backlog-grant-gate.js:118`, `plugin/bin/lib/compose-context/resolve-conditions.js:52`, `plugin/bin/lib/reconcile/post-merge.js:218`, `plugin/bin/lib/wrap-up/engine-verify.js:782`, `plugin/bin/parent-gate.js:191`, `plugin/bin/preflight-records.js:193`, `plugin/bin/release-notes-publish.js:78`, `plugin/bin/resolve-profile.js:135`
- Test: each module's existing suites (Step 2 list); no new test file — the behavior is Task 1's, already pinned there.

**Interfaces:**
- Consumes: `locatePolicyFile(root).path` (Task 1).

- [ ] **Step 1: Swap each site's `path.join({root}, '.claude-tweaks', 'policy.yml')` for `locatePolicyFile({root}).path`**, keeping each site's own read and error handling exactly as it is (ENOENT → null stays ENOENT → null). `resolve-profile.js`'s `fs.existsSync(policyPath)` stays (it is on the path-guard allowlist with its current count — do not change the count). A `null` path (non-string root) cannot occur at these sites (each root is a string); no guard needed. Each module adds its own `require` of `plugin/bin/lib/policy-file.js` at the correct relative depth (`./lib/policy-file` from `plugin/bin/`, `../policy-file` from `plugin/bin/lib/{dir}/`). The root each site already passes is kept — `resolve-profile.js`'s `deps.cwd()` and `release-notes-publish.js`'s `root` included — per the plan's Root contract paragraph; no site gains a git call to find its top level.

- [ ] **Step 2: Run the affected suites**

Run: `git grep -l -e backlog-grant-gate -e resolve-conditions -e reconcile/post-merge -e engine-verify -e parent-gate -e preflight-records -e release-notes-publish -e resolve-profile -- tests` and run that list plus `tests/path-guard-conformance.test.js` through `node tools/run-tests.js --files-from {list file}`.
Expected: PASS, 0 failures. Then `git grep -n -F "'policy.yml'" -- plugin/bin` lists only `lib/policy-file.js`, `lib/hooks/pre-tool-use.js` and `lib/hooks/worktree-detect.js` (control: the same command at plan time listed all 16 sites above).

- [ ] **Step 3: Commit**

```bash
git add plugin/bin/backlog-grant-gate.js plugin/bin/lib/compose-context/resolve-conditions.js plugin/bin/lib/reconcile/post-merge.js plugin/bin/lib/wrap-up/engine-verify.js plugin/bin/parent-gate.js plugin/bin/preflight-records.js plugin/bin/release-notes-publish.js plugin/bin/resolve-profile.js
git commit -m "Route the remaining policy.yml readers through the locator (refs #4492)"
```
