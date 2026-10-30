# Worktree Policy Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A linked worktree with no `.claude-tweaks/policy.yml` of its own reads the main checkout's policy file, so every worktree-side policy read (and `pr-early-open.js`'s base branch) matches what the main checkout resolves.

**Architecture:** One locator, `plugin/bin/lib/policy-locate.js`, decides which `policy.yml` a given root reads: the root's own file when it exists, else — only for a linked worktree — the main checkout's, found through `bin/lib/hooks/worktree-detect.js`'s `mainCheckoutRoot` (the zero-subprocess helper `$RUN_ROOT` anchoring already uses). Every policy reader routes through it. `resolve-policy.js` and `pr-early-open.js` surface the fallback on stderr.

**Tech Stack:** Node 18+, CommonJS, `node --test`, zero runtime deps.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T124153-record-4492/work/4492-spec.md` (record #4492)

**Scope keywords:** policy.yml, readPolicyFile, resolvePolicyConfig, auditPolicy, resolveIntegrationModel

## Global Constraints

- A root whose own `.claude-tweaks/policy.yml` exists reads that file — the main checkout's is never read (a tracked, branch-local policy keeps today's behavior).
- From the main checkout, behavior is byte-identical to today (same file read, no new stderr).
- The fallback adds no git subprocess: `mainCheckoutRoot` is fs-only. It runs lazily — only when the root's own file is absent.
- A root that is not inside any git repo (resolvePolicyConfig's `process.cwd()` fallback) keeps today's behavior and never throws.
- `worktree-detect.js` is required lazily inside the locator (never at `policy.js`'s module top — see the `resolvePortServices` comment in `policy.js` for why).
- Commit messages: `{Verb} {what} — {detail}`, ending with `refs #4492` (never `closes`/`fixes`).

## Review Focus

- Root IS the main checkout (`mainCheckoutRoot(root)` realpath-equals `root`) with no policy file: reads nothing extra, no fallback, no note — pinned in Task 1 and Task 3.
- A submodule or non-repo root (`mainCheckoutRoot` returns `null`): no fallback, no throw — pinned in Task 1.
- A run's `config.yml` overlay still beats the main-checkout fallback policy — pinned in Task 2.
- The hook hot path: when the root's own file exists, `mainCheckoutRoot` is never called — pinned in Task 1.
- A worktree whose own file exists but lacks `integration-branch` still gets `pr-early-open.js`'s default-branch warning (linkedness is judged separately from which file was read) — pinned in Task 4.

---

### Task 1: The policy-file locator

**Files:**
- Create: `plugin/bin/lib/policy-locate.js`
- Test: `tests/policy-locate.test.js`

**Interfaces:**
- Produces:
  - `locatePolicyFile(root: string, deps?: { exists?: (p: string) => boolean, mainCheckoutRoot?: (p: string) => string|null, realpath?: (p: string) => string|null }) -> { path: string, source: 'local' | 'main-checkout' }` — `path` is always absolute; when nothing is found it is the root's own (absent) path with `source: 'local'`, so a caller's existing null-on-missing read is unchanged.
  - `isLinkedWorktreeRoot(root: string, deps?: { mainCheckoutRoot?, realpath? }) -> boolean` — true when `mainCheckoutRoot(root)` is non-null and its realpath differs from `root`'s.
  - `POLICY_REL` = `path.join('.claude-tweaks', 'policy.yml')`.
  - Defaults: `exists` = `(p) => lstatType(p).type !== 'missing'` from `./path-guard` (anything occupying the path — file, symlink, unreadable entry — counts as present and keeps today's local read; only a genuinely missing file falls back); `realpath` = `path-guard`'s `canonicalRealpath`, applied to BOTH sides of the main-vs-root comparison; `mainCheckoutRoot` = lazily required `./hooks/worktree-detect`'s `mainCheckoutRoot`. Never a bare `fs.existsSync`/`fs.realpathSync` — `tests/path-guard-conformance.test.js` counts those tokens in `plugin/bin/` and fails on a new one.

- [ ] **Step 1: Write the failing tests** in `tests/policy-locate.test.js`, all with fake `exists`/`mainCheckoutRoot`/`realpath` (identity realpath), no real repo. AC5.1 names "a fake `git` runner"; the locator spawns no git (Technical Approach: reuse the `$RUN_ROOT` helper, `mainCheckoutRoot`, which is fs-only), so the fake is that helper's seam — the same injectable-deps pattern `blast-radius-cli.js`'s tests use:
  - `AC5.1: worktree file present -> local, mainCheckoutRoot never called` — `exists` true for `/wt/.claude-tweaks/policy.yml`; `mainCheckoutRoot` throws if called; expect `{ path: '/wt/.claude-tweaks/policy.yml', source: 'local' }`.
  - `AC5.1: worktree file absent, main present -> main-checkout` — `mainCheckoutRoot('/wt')` returns `/main`, `exists` true only for `/main/.claude-tweaks/policy.yml`; expect `{ path: '/main/.claude-tweaks/policy.yml', source: 'main-checkout' }`.
  - `AC5.1: both absent -> local path, source local` — expect `{ path: '/wt/.claude-tweaks/policy.yml', source: 'local' }`.
  - `root is the main checkout -> local, no fallback` — `mainCheckoutRoot('/main')` returns `/main`, nothing exists; expect `source: 'local'`, path under `/main`.
  - `mainCheckoutRoot null (non-repo or submodule) -> local, no throw`.
  - `isLinkedWorktreeRoot`: `/wt` with main `/main` -> true; `/main` with main `/main` -> false; null main -> false.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/policy-locate.test.js`
Expected: FAIL with `Cannot find module '../plugin/bin/lib/policy-locate'`

- [ ] **Step 3: Implement `plugin/bin/lib/policy-locate.js`** with the exports above. Header comment names #4492, the zero-subprocess choice (`mainCheckoutRoot` is the `$RUN_ROOT` helper `_shared/pipeline-run-dir.md` anchors on — no second `--git-common-dir` parser), and the laziness rule.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/policy-locate.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-locate.js tests/policy-locate.test.js
git commit -m "Add policy-file locator — linked worktree falls back to the main checkout's policy.yml, refs #4492"
```

### Task 2: Route the shared policy readers through the locator

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (`resolveIntegrationModel` ~671, `resolvePolicyConfig` ~692-703, `auditPolicy` ~705)
- Modify: `plugin/bin/lib/policy.js` (`readPolicyFile` ~15-21)
- Test: `tests/policy-schema.test.js`, `tests/policy.test.js`
- Waived plugin/bin/lib/hooks/pre-tool-use.js: read-only here — its `worktree-always` gate reaches the locator through `policy.js`'s `isWorktreeAlwaysOn`; Step 4's `npm run test:perf` checks the hot-path budget.
- Waived plugin/skills/_shared/pipeline-run-dir.md: reference only — the `$RUN_ROOT` anchoring Task 1 reuses through `mainCheckoutRoot`.

**Interfaces:**
- Consumes: `locatePolicyFile(root, deps)` from Task 1.
- Produces:
  - `resolvePolicyConfig({ git, readFile, runDir, keys, onInvalid, locateDeps })` now returns `{ root, policyRaw, runConfigRaw, result, policyPath, policySource }` (`policySource`: `'local' | 'main-checkout'`). `locateDeps` (optional) is forwarded to `locatePolicyFile` — the test seam.
  - `readPolicyFile(repoRoot)`, `auditPolicy(repoRoot)`, `resolveIntegrationModel(repoRoot, opts)` keep their signatures and read `locatePolicyFile(repoRoot).path`.
  - `auditPolicy`'s `CLAUDE.md` read stays at `repoRoot` (CLAUDE.md is tracked, not the subject here).

- [ ] **Step 1: Write the failing tests**
  - `tests/policy-schema.test.js` — `resolvePolicyConfig: linked worktree with no policy reads the main checkout's` — fake `git` returning `/wt\n` for `rev-parse --show-toplevel`, fake `readFile` serving `/main/.claude-tweaks/policy.yml` = `integration-branch: develop\n`, `locateDeps: { exists: p => p === '/main/.claude-tweaks/policy.yml', mainCheckoutRoot: () => '/main', realpath: p => p }`; assert `result['integration-branch'].value === 'develop'`, `policySource === 'main-checkout'`, `policyPath === '/main/.claude-tweaks/policy.yml'`.
  - Same file — `resolvePolicyConfig: run config.yml still beats the main-checkout fallback` — as above plus `runDir: '/run'` and `/run/config.yml` = `integration-branch: staging\n`; assert value `staging`, source `run-config`.
  - Same file — `resolvePolicyConfig: main checkout reads its own file, policySource local` — toplevel `/main`, `mainCheckoutRoot` returns `/main`.
  - `tests/policy.test.js` — `readIntegrationBranch: a real linked worktree with no policy.yml reads the main checkout's` — `gitRepo()` + `linkedWorktreeOf(main)` from `tests/helpers/git-fixtures.js`, write `main/.claude-tweaks/policy.yml` = `integration-branch: develop\n` (untracked), assert `readIntegrationBranch(wt) === 'develop'`; then write `wt/.claude-tweaks/policy.yml` = `integration-branch: wt-own\n` and assert `'wt-own'`.
  - `tests/policy-schema.test.js` — `auditPolicy: a linked worktree audits the main checkout's policy.yml` — real fixture, main file holds `bogus-key: 1`; `auditPolicy(wt).unrecognizedKeys` includes `bogus-key`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/policy-schema.test.js tests/policy.test.js`
Expected: FAIL — the new cases read null / `policySource` undefined

- [ ] **Step 3: Implement** — replace each `path.join(root, '.claude-tweaks', 'policy.yml')` in the four functions with `locatePolicyFile(root, locateDeps).path` (`locateDeps` only in `resolvePolicyConfig`); add `policyPath`/`policySource` to `resolvePolicyConfig`'s return and update its header comment.

- [ ] **Step 4: Run to verify they pass, then the policy-adjacent suites and perf**

Run: `node --test tests/policy-schema.test.js tests/policy.test.js tests/resolve-policy-cli.test.js tests/resolve-policy-lib.test.js tests/resolve-policy-run-dir-anchoring.test.js tests/hooks-policy-exemption.test.js tests/bin-lib/blast-radius-cli.test.js`
Expected: PASS

Run: `npm run test:perf`
Expected: PASS (the hook hot path adds at most one `existsSync` when the root's file exists)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/bin/lib/policy.js tests/policy-schema.test.js tests/policy.test.js
git commit -m "Route policy readers through the locator — resolvePolicyConfig reports which file it read, refs #4492"
```

### Task 3: resolve-policy.js degrade note, end-to-end test, and the integration-branch contract

**Files:**
- Modify: `plugin/bin/resolve-policy.js` (after the `resolvePolicyConfig` call, ~144-150; header comment)
- Modify: `plugin/skills/_shared/integration-branch.md` (rank 3, ~line 23)
- Modify: `docs/plugin-structure.md` (the `resolve-policy.js` command line, ~231; the `plugin/bin/lib/` listing, ~19 — add `policy-locate`)
- Test: `tests/resolve-policy-worktree-fallback.test.js` (create)

**Interfaces:**
- Consumes: `resolvePolicyConfig(...).policySource` / `.policyPath` / `.root` from Task 2.
- Produces: stderr line, exact copy, written once per invocation in every output mode when `policySource === 'main-checkout'`:
  `resolve-policy: note: no .claude-tweaks/policy.yml in this worktree ({root}) — read the main checkout's {policyPath}`
  stdout and exit code unchanged.

- [ ] **Step 1: Write the failing end-to-end tests** (real `gitRepo()` + `linkedWorktreeOf(main)`; main gets a committed `.gitignore` containing `.claude-tweaks/` and an untracked `main/.claude-tweaks/policy.yml` = `integration-branch: develop\n`; spawn `plugin/bin/resolve-policy.js` with `execFileSync(process.execPath, …)` as `tests/resolve-policy-run-dir-anchoring.test.js` does):
  - `AC1.1 AC5.2: linked worktree, gitignored policy: --values integration-branch prints develop and the degrade note` — cwd `wt`; stdout `develop\n`; stderr matches `/^resolve-policy: note: no \.claude-tweaks\/policy\.yml in this worktree .* — read the main checkout's .*policy\.yml\n$/`.
  - `AC2.1: worktree's own policy.yml wins, no note` — write `wt/.claude-tweaks/policy.yml` = `integration-branch: wt-own\n`; stdout `wt-own\n`; stderr `''`.
  - `AC3.1: main checkout: byte-identical, no note` — cwd `main`; stdout `develop\n`; stderr `''`.
  - `JSON mode also notes the fallback, envelope unchanged` — cwd `wt`, args `integration-branch`; `JSON.parse(stdout)['integration-branch']` deep-equals `{ value: 'develop', source: 'policy' }`; stderr has the note.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/resolve-policy-worktree-fallback.test.js`
Expected: FAIL — first case prints the note-less output (until Task 2 lands it prints `develop` with empty stderr; with Task 2 in place the stderr assertion fails)

- [ ] **Step 3: Implement** the stderr line in `resolve-policy.js` (destructure `policySource`, `policyPath` from `resolvePolicyConfig`); add one sentence to the header comment. In `integration-branch.md` rank 3, append one sentence after "An unset key prints an empty line…": from a linked worktree with no `policy.yml` of its own the resolver reads the main checkout's file and says so on stderr (#4492). In `docs/plugin-structure.md`, extend the `resolve-policy.js` line with the same fact and add `policy-locate` to the `plugin/bin/lib/` helper list.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/resolve-policy-worktree-fallback.test.js tests/resolve-policy-cli.test.js tests/resolve-policy-run-dir-anchoring.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/resolve-policy.js plugin/skills/_shared/integration-branch.md docs/plugin-structure.md tests/resolve-policy-worktree-fallback.test.js
git commit -m "Note the main-checkout policy fallback in resolve-policy — one stderr line, stdout unchanged, refs #4492"
```

### Task 4: pr-early-open.js — resolve through the fallback, warn on a default-branch base from a worktree

**Files:**
- Modify: `plugin/bin/pr-early-open.js` (`realDeps` ~101-126; base resolution ~183-211; header comment ~11-18)
- Test: `tests/bin-lib/flow/pr-early-open.test.js`

**Interfaces:**
- Consumes: `resolvePolicyConfig(...).root` (Task 2); `isLinkedWorktreeRoot(root)` (Task 1).
- Produces: new dep `isLinkedWorktree: (root: string) => boolean` (real: `isLinkedWorktreeRoot`). When `--base` was not given, no `integration-branch` resolved, and `deps.isLinkedWorktree(root)` is true, write exactly one stderr line (exit code and stdout unchanged; the PR still opens against the default branch):
  `pr-early-open.js: warning: no integration-branch found (policy.yml or the run's config.yml) while running in linked worktree {root} — opening against the GitHub default branch "{base}"`

- [ ] **Step 1: Write the failing tests** (reuse `cliFixture`/`cliDeps`/`cliArgv`; `cliDeps` gains an `isLinkedWorktree` option defaulting to `() => false`, and an optional `toplevel` option the fake `git rev-parse --show-toplevel` returns instead of `fx.root`):
  - `AC1.1: CLI: a linked worktree with no policy.yml resolves the main checkout's integration-branch, no warning` — `cliFixture({ policy: 'integration-branch: develop\n' })`; `wt = linkedWorktreeOf(fx.root)` (real); `toplevel: wt`; real `isLinkedWorktree` (pass `isLinkedWorktreeRoot`); assert exit 0, `--base develop`, `err.join('')` has no `warning`.
  - `AC4.1: CLI: a linked worktree with no integration-branch anywhere warns and still opens against the default branch` — `cliFixture()`, `isLinkedWorktree: () => true`, `defaultBranch: 'trunk'`; assert exit 0, `--base trunk`, `err.join('')` matches `/warning: no integration-branch found .* linked worktree .* default branch "trunk"/`.
  - Extend the existing `base falls back to the GitHub default branch…` test: assert `h.err.join('')` does not contain `warning` (main checkout).
  - `CLI: --base given in a linked worktree never warns` — `isLinkedWorktree: () => true`, `--base dev`; no `warning`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/flow/pr-early-open.test.js`
Expected: FAIL after Step 1 — no warning written

- [ ] **Step 3: Implement** — keep `resolvePolicyConfig`'s returned `root`; add the `isLinkedWorktree` dep and the warning after `base` is computed. Update the header comment's base-resolution sentence (main-checkout fallback, the warning).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/flow/pr-early-open.test.js tests/pr-early-run-lifecycle.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/pr-early-open.js tests/bin-lib/flow/pr-early-open.test.js
git commit -m "Warn when pr-early-open falls back to the default branch from a worktree — base now resolves through the main checkout's policy, refs #4492"
```

### Task 5: Route the remaining direct policy.yml readers through the locator

The record's Current State: the blind spot "applies to every worktree-side policy read". These value readers bypass the shared functions and join the path themselves.

**Files:**
- Modify: `plugin/bin/preflight-records.js:111` (`resolveWorkLinks`)
- Modify: `plugin/bin/backlog-grant-gate.js:105` (`readPolicyRaw`)
- Modify: `plugin/bin/resolve-profile.js:134` (`policyPath`, root stays `process.cwd()`)
- Modify: `plugin/bin/lib/compose-context/resolve-conditions.js:52`
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js:739` (`resolveRiskFloor`)
- Test: `tests/bin-lib/compose-context/resolve-conditions.test.js`

Out of scope, deliberately unchanged: `release-local.js` and `code-health/candidates-agent-trust-scope.js` (operate on the tracked file as an artifact), `hooks/pre-tool-use.js`'s `POLICY_FILE` constant (path matching for its write exemption, not a value read), `hooks/worktree-detect.js`'s `findPolicyFile` (walk-up prefilter; already reaches the main checkout for a nested worktree).

**Interfaces:**
- Consumes: `locatePolicyFile(root)` (Task 1). Each site replaces only its `path.join(..., '.claude-tweaks', 'policy.yml')` with `locatePolicyFile(root).path`; `resolve-conditions.js` passes `exists: (p) => readFileSafe(p, d.readFile) !== null` so its injected `readFile` seam stays authoritative.

- [ ] **Step 1: Write the failing test** in `resolve-conditions.test.js`: `a linked worktree repoRoot with no policy.yml resolves worktree-policy from the main checkout's` — real `gitRepo()` + `linkedWorktreeOf`, main policy `worktree-always: true\n`, run dir under main; `resolveConditions({ runDir, repoRoot: wt }, { execFileSync: ghPresent }).conditions['worktree-policy'] === 'always'`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/compose-context/resolve-conditions.test.js`
Expected: FAIL after Step 1 — `worktree-policy` reads the unset default

- [ ] **Step 3: Implement** the five one-line swaps.

- [ ] **Step 4: Run to verify, plus each touched file's own suite**

Run: `node --test tests/bin-lib/compose-context/ tests/preflight-records*.test.js tests/backlog-grant-gate*.test.js tests/resolve-profile*.test.js tests/bin-lib/wrap-up/`
Expected: PASS (an unmatched glob is not an error to chase — run the suites that exist)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/preflight-records.js plugin/bin/backlog-grant-gate.js plugin/bin/resolve-profile.js plugin/bin/lib/compose-context/resolve-conditions.js plugin/bin/lib/wrap-up/engine-verify.js tests/bin-lib/compose-context/resolve-conditions.test.js
git commit -m "Route direct policy.yml readers through the locator — worktree-side reads match the main checkout, refs #4492"
```

### Task 6: Full verification (folded into /build Common Step 5)

- [ ] Run: `npm test > /tmp/npm-test-4492.log 2>&1; tail -20 /tmp/npm-test-4492.log` — Expected: `ℹ fail 0`.

---

**Not a code task — Deliverable 4 (PR closes #4494 and #4499):** the run's draft PR (#4630) carries `Fixes #4492` from `--fixes`. Adding `Fixes #4494` / `Fixes #4499` is a PR-metadata decision for the merge path (`_shared/pr-checklist-refresh.md`'s Fixes-block rewrite), logged to `decisions.md` at build time for the second call.
