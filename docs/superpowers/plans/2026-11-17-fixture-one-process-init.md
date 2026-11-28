# Fixture One-Process Init Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Test fixtures stop spending two extra git processes per repo on `git config user.name` / `user.email`, and every fixture `git init` uses a template with no sample hooks, with test coverage unchanged.

**Architecture:** Two helpers in `tests/helpers/git-fixtures.js` (`initRepo`, `writeIdentity`) write the identity straight into the repo's config file with `fs`. The runner's existing #5768 template (`writeGitTemplateDir` in `tools/run-tests.js`) stops copying `*.sample` hooks, and `tests/helpers/git-template.js` builds the same template for a bare `node --test` run. A sweep replaces the fixture identity calls, and a scan test with a reasoned per-file allowlist keeps them out.

**Tech Stack:** Node 18+ built-ins, `node --test`, git trace2 (`GIT_TRACE2_EVENT=<dir>`, one file per git process).

**Spec:** `.claude-tweaks/pipelines/2026-11-17T073856-record-5771/work/5771-spec.md`

## Global Constraints

- "Same tests" means no existing test is deleted, skipped, renamed, merged or loosened. A test count may grow by tests this record itself adds.
- The name and email each fixture commits with stay the same (byte-identical values).
- Do not reduce test concurrency or skip tests.
- Sibling-owned files stay untouched: `tests/hooks-pre-tool-use.test.js`, `tests/hooks-pre-tool-use-forge-memo.test.js`, `tests/bin-lib/verify/cli-helpers.js` (#5324); `tests/bin-lib/reconcile/prune-remote.test.js`, `tests/bin-lib/pre-review-catchup/cli.test.js`, `tests/bin-lib/issues/claims-git-cas.test.js` (#5769); everything under `tests/bin-lib/learned-skills/` and `tests/helpers/learned-skills-capture.js` (#5770, PR #5780 still open); `tests/statusline.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js`, `tests/bin-lib/reconcile/archive-merged-record-guards.test.js`, `tests/bin-lib/staged-patch/stack-check.test.js` (#5772).
- Build on #5768's template directory (`writeGitTemplateDir`, exported as `GIT_TEMPLATE_DIR`); never add a second template directory.
- Leave #5378, #5372, #5302, #5387 alone. Do not pursue `core.fsync=none`, `worktree add --no-checkout`, or Apple's git.
- Running several test files from a script: `node tools/run-tests.js <files>` (a hook blocks a script that starts `node --test` over several files itself).
- Quote raw command output for every test count and process count reported; never summarize from memory.
- Governing skill `git-ground-truth-test-env` (verbatim): "The runner also exports `GIT_TEMPLATE_DIR` (#5768), so every repo a test creates gets `maintenance.auto`, `gc.auto` and `receive.autogc` set in its own config. A control that expects maintenance to run, git's default repo config or a developer's init template masks the same way: drop `GIT_TEMPLATE_DIR` from the env its git calls use."
- Governing skill `git-ground-truth-test-env` (verbatim): "**Prove both under the runner.** Run `node tools/run-tests.js --files-from <list>`, never only a bare `node --test`: the runner's env is part of the test's input."
- Governing skill `windows-checkout-test-parity`: its hidden-`.git`-file rule ("Open the existing file `r+`, `ftruncateSync` it to 0") does not apply — `writeIdentity` only reads a `.git` pointer file and appends to `config` files, never rewrites a `.git` pointer.

## Review Focus

- An identity value carrying `"`, `\`, `#` or `;` reads back from `git config` exactly as given (Task 1 test).
- `writeIdentity` on a bare repo and on a linked worktree writes the config `git config` itself would (the common dir's), not a stray file (Task 1 test).
- A test that appends to `.git/info/exclude` or writes `.git/hooks/<name>` without `mkdir` still works: the template keeps `hooks/` and `info/` (Task 2 test).
- An inherited `GIT_TEMPLATE_DIR` whose `hooks/` holds samples next to a real hook: samples dropped, the real hook kept (Task 2 test).
- A repo whose config already has a `[user]` section: `writeIdentity` throws rather than writing a second, multi-valued identity (Task 1 test).

---

### Task 1: `initRepo` and `writeIdentity` helpers

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tests/helpers/git-fixtures.js`
- Test: `tests/helpers-git-template.test.js`

**Interfaces:**
- Produces: `initRepo(dir: string, { name?: string, email?: string, branch?: string, bare?: boolean, ...fixtureGitOpts } = {}) -> string` (returns `dir`; runs exactly one `fixtureGit(['init', '-q', ...(bare ? ['--bare'] : []), ...(branch ? ['-b', branch] : []), dir], fixtureGitOpts)`, then `writeIdentity` when `name` or `email` is given).
- Produces: `writeIdentity(repoDir: string, { name?: string, email?: string }) -> void` — starts no process. Config file: `<repoDir>/.git/config` when `.git` is a directory; when `.git` is a file, its `gitdir:` target, then that dir's `commondir` (resolved against it) when present, `+ /config`; `<repoDir>/config` when `repoDir` itself holds a `HEAD` file and an `objects` directory (bare); otherwise throws `Error` matching `/not a git repository/`. Throws `/already has a \[user\] section/` when the config already holds a `[user]` header (case-insensitive). Appends `[user]\n` then `\tname = "<v>"\n` and/or `\temail = "<v>"\n`, each value escaped `\` → `\\`, `"` → `\"`, newline → `\n`, tab → `\t`.
- Both exported from `tests/helpers/git-fixtures.js` next to the existing exports.

- [ ] **Step 1: Write the failing tests** in `tests/helpers-git-template.test.js` (reuse the file's `mk`, `withEnv`, `tracedArgvs`, `git`):
  - `AC1.1: initRepo starts exactly one git process for an init with an identity` — under `withEnv('GIT_TRACE2_EVENT', trace, …)` call `initRepo(path.join(mk('ct-gt-ir-'), 'r'), { name: 'Test', email: 'test@example.com' })`; assert `fs.readdirSync(trace).length === 1` and `tracedArgvs(trace)[0]` includes `'init'`; then (outside the trace) `git(dir, ['config', 'user.name'])` is `'Test'` and `user.email` is `'test@example.com'`.
  - `initRepo honours branch and bare` — `{ branch: 'trunk' }` → `symbolic-ref --short HEAD` is `trunk`; `{ bare: true, name: 'T', email: 't@t' }` → `rev-parse --is-bare-repository` is `true` and `config --local user.name` is `T`.
  - `writeIdentity values read back exactly as git config would` — for name JS literal `'A "Q" \\ B; #x'` (one backslash at runtime) and email `e@x.test`, in a plain repo, a bare repo, and a linked worktree (`git worktree add` from a committed repo): `git config user.name` / `user.email` in that directory equal the inputs, and after `git commit --allow-empty` in the plain repo, `git log -1 --format=%an <%ae>` equals `A "Q" \ B; #x <e@x.test>`. The commit and the `log` run with `gitEnv()` minus every `GIT_AUTHOR_*` and `GIT_COMMITTER_*` key (git prefers those env values over config, and CI exports `GIT_AUTHOR_NAME: ci`); the test asserts those keys are absent from that env. For the worktree, assert the main repo's `config --local user.name` also returns it (written to the common config).
  - `writeIdentity refuses a second identity and a non-repo` — a repo after one `writeIdentity` throws `/already has a \[user\] section/` on the second; `writeIdentity(mk('ct-gt-nr-'), …)` throws `/not a git repository/`.

- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js tests/helpers-git-template.test.js`
Expected: FAIL (`initRepo is not a function`)

- [ ] **Step 3: Implement `initRepo` and `writeIdentity` in `tests/helpers/git-fixtures.js`** per the Interfaces block; add a comment naming #5771 and the measured cost (an identity pair is two git processes per fixture).

- [ ] **Step 4: Run to verify they pass**

Run: `node tools/run-tests.js tests/helpers-git-template.test.js`
Expected: PASS, every pre-existing test name still listed and passing.

- [ ] **Step 5: Commit** — `git add tests/helpers/git-fixtures.js tests/helpers-git-template.test.js` then commit `Add one-process initRepo and writeIdentity fixture helpers — refs #5771`.

### Task 2: Sample-free template in a runner child and a bare `node --test` run

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `tools/run-tests.js` (`writeGitTemplateDir`; the child env at the `spawn` near line 948)
- Modify: `tests/helpers/git-template.js`
- Test: `tests/run-tests-isolation.test.js`, `tests/helpers-git-template.test.js`

**Interfaces:**
- Consumes: Task 1's `initRepo`.
- Produces: `writeGitTemplateDir` unchanged in signature; its template now has an empty `hooks/` (non-inherited path) and copies no `hooks/*.sample` from an inherited template (every other inherited entry still copied). `info/` (with git's `exclude`) and `description` stay.
- Produces: `runnerChildEnv(env: object, { runRoot: string, templateDir: string|null }) -> object` exported from `tools/run-tests.js`, returning exactly the env object the runner hands its `node --test` child today (`gitFixtureConfigEnv(env)`, `GIT_TEMPLATE_DIR` when `templateDir`, `TMPDIR`/`TMP`/`TEMP`, `CT_TEST_SUITE_SLOT_HELD: '1'`, `CT_HOOKS_REPO_INFO_STORE`); the runner's spawn uses it (pure extraction, no value changes).
- Produces: loading `tests/helpers/git-template.js` sets `process.env.GIT_TEMPLATE_DIR` to a fresh `writeGitTemplateDir(<mkdtemp ct-git-tpl-dir->/t, process.env)` result, removed on exit, unless `process.env.CT_TEST_SUITE_SLOT_HELD === '1'` and `GIT_TEMPLATE_DIR` is already set (a runner child). A `null` result leaves the env unchanged.

- [ ] **Step 1: Write the failing tests**
  - `tests/run-tests-isolation.test.js`: `AC2.1: writeGitTemplateDir ships empty hooks/ and an info/ dir, and drops an inherited template's sample hooks` — non-inherited: `hooks/` is a directory with no entry ending `.sample`, `info/exclude` exists; inherited template holding `hooks/pre-commit.sample` and `hooks/post-checkout`: result has `hooks/post-checkout`, no `.sample`.
  - `tests/run-tests-isolation.test.js`: `runnerChildEnv returns the runner's child env` — assert the exact keys/values above for a given `{ runRoot, templateDir }`, and no `GIT_TEMPLATE_DIR` key when `templateDir` is `null`.
  - `tests/helpers-git-template.test.js`: `AC2.1 AC2.2: a fixture repo made in a runner child and in a bare node --test run holds no sample hook` — two `spawnSync(process.execPath, ['-e', script])` children, `script` requiring `tests/helpers/git-fixtures.js` (absolute path) and printing `initRepo(...)` and `gitRepo()` dirs as JSON. Runner child: env = `runnerChildEnv(<base>, { runRoot: mk(...), templateDir: writeGitTemplateDir(mk(...) + '/t', <base>) })`. Bare child: `<base>` with `GIT_TEMPLATE_DIR` and `CT_TEST_SUITE_SLOT_HELD` deleted. `<base>` = `process.env` minus `GIT_TEMPLATE_DIR`, `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`, with `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` pointing at `EMPTY_CONFIG`. For every printed repo: `.git/hooks` is a directory with no `*.sample`, `.git/info` is a directory. Control: a plain `git init` under `<base>` without the helper does hold `*.sample` files (asserted).

- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js tests/run-tests-isolation.test.js tests/helpers-git-template.test.js`
Expected: FAIL (sample hooks present; `runnerChildEnv is not a function`)

- [ ] **Step 3: Implement** per the Interfaces block. In `writeGitTemplateDir`'s non-inherited branch create `hooks/` with `fs.mkdirSync` instead of copying it; in the inherited branch pass a `cpSync` `filter` that drops `hooks/*.sample`. Update the function's header comment.

- [ ] **Step 4: Run to verify they pass**

Run: `node tools/run-tests.js tests/run-tests-isolation.test.js tests/helpers-git-template.test.js`
Expected: PASS, all pre-existing test names still listed and passing.

- [ ] **Step 5: Commit** — `Drop sample hooks from the fixture git template and apply it to a bare node --test run — refs #5771`.

### Sweep tasks (Tasks 3–6)

Each sweep task follows the same rule. For every `git config user.name` / `git config user.email` fixture call in its files (the identity pair after an init or clone):
- Where the init is a plain fixture `git init [-q] [-b X] [--bare] <dir>` with the default env, replace the init and the pair with one `initRepo(dir, { name, email, branch, bare })`.
- Otherwise keep the init (or clone) as written and replace the pair with `writeIdentity(dir, { name, email })` right after it.
- Keep each fixture's name and email byte-identical. A local helper that wraps the identity pair changes once, in the helper.
- A call where `git config` itself is the behaviour under test stays; report it as `path: reason` in the task report for Task 7's allowlist.
- Touch nothing else in the file.

Find the sites with Task 7's pattern: `git grep -n -P "config['\"\x60]?\s*,?\s*['\"\x60]?(?:--(?:local|global|add)['\"\x60]?\s*,?\s*['\"\x60]?)?user\.(?:name|email)\b" -- <files>`; control: at the merge base this matches every file listed below (302 lines over 95 files repo-wide, `tests/` + `perf/`).

Each task's verification: `node tools/run-tests.js <its files plus the test files that require its helpers>` before the edit and after, the same test names and the same pass counts (quote both raw summary lines), and the grep above printing nothing for the swept files.

### Task 3: [batch] Sweep the Key Files and their helper

**Role:** integration

**Files:**
- Modify: `tests/bin-lib/wrap-up/facts.test.js`
- Modify: `tests/hooks-session-start.test.js`
- Modify: `tests/console-execute.test.js`
- Modify: `tests/bin-lib/hooks/reconcile-background.test.js`
- Modify: `tests/bin-lib/flow/check-artifact-overwrite-cli.test.js`
- Modify: `tests/helpers/reconcile-fixtures.js`

- [ ] **Step 1: Run the files' tests (before), quote the summary.**
- [ ] **Step 2: Apply the sweep rule.**
- [ ] **Step 3: Run the tests (after) and the grep; same names and counts, grep empty.**
- [ ] **Step 4: Commit** — `Replace fixture identity config calls in the key test files — refs #5771`.

### Task 4: [batch] Sweep the remaining helpers and the reconcile suites

**Role:** integration

**Files:**
- Modify: `tests/helpers/reentry-fixture.js`, `tests/helpers/statusline-fixtures.js`, `tests/bin-lib/reconcile/archive-merged-helpers.js`, `tests/bin-lib/reconcile/prune-remote-fixtures.js`, `tests/bin-lib/issues/claims-git-cas-fixtures.js`, `tests/bin-lib/reconcile/reap-merged.test.js`, `tests/bin-lib/reconcile/squash-provenance.test.js`, `tests/bin-lib/reconcile/red-tip.test.js`, `tests/bin-lib/reconcile/reap-merged-owning-run.test.js`, `tests/bin-lib/reconcile/reap-merged-held.test.js`, `tests/bin-lib/reconcile/ledger-residue.test.js`, `tests/bin-lib/reconcile/archive-merged-work-boundary.test.js`, `tests/bin-lib/reconcile/archive-merged-linked-worktree.test.js`, `tests/bin-lib/reconcile/archive-branches.test.js`, `tests/reconcile.test.js`, `tests/reconcile-archive-residue.test.js`

Template helpers build once per process: replacing their identity pair changes the template build only. Verification includes the helpers' consumers (`git grep -l` each helper's basename under `tests/`), excluding none — consumers that are sibling-owned files are run, not edited.

- [ ] **Step 1: Run the files' tests and the helpers' consumers (before), quote the summary.**
- [ ] **Step 2: Apply the sweep rule.**
- [ ] **Step 3: Run the tests (after) and the grep; same names and counts, grep empty.**
- [ ] **Step 4: Commit** — `Replace fixture identity config calls in the reconcile suites and shared helpers — refs #5771`.

### Task 5: [batch] Sweep the remaining `tests/bin-lib/` suites

**Role:** integration

**Files:**
- Modify: `tests/bin-lib/blast-radius-cli.test.js`, `tests/bin-lib/code-health/scope.test.js`, `tests/bin-lib/console/cli.test.js`, `tests/bin-lib/console/control-mode-cli.test.js`, `tests/bin-lib/console/memory-write.test.js`, `tests/bin-lib/console/reference-repair-apply.test.js`, `tests/bin-lib/console/upstream-route-cli.test.js`, `tests/bin-lib/dispatch/first-call-artifact-check.test.js`, `tests/bin-lib/docs-health/cli-check-freshness.test.js`, `tests/bin-lib/docs-health/freshness.test.js`, `tests/bin-lib/docs-health/scope.test.js`, `tests/bin-lib/express/policy.test.js`, `tests/bin-lib/flow/artifact-overwrite-check.test.js`, `tests/bin-lib/flow/preflight-cli.test.js`, `tests/bin-lib/flow/preflight.test.js`, `tests/bin-lib/git-z.test.js`, `tests/bin-lib/harness-health/durable-integration.test.js`, `tests/bin-lib/harness-health/scope.test.js`, `tests/bin-lib/health-core/churn.test.js`, `tests/bin-lib/health-core/durable-state.test.js`, `tests/bin-lib/hooks/reconcile-summary.test.js`, `tests/bin-lib/init/release-bootstrap-cli.test.js`, `tests/bin-lib/init/release-bootstrap.test.js`, `tests/bin-lib/journey-health/cli-next-target.test.js`, `tests/bin-lib/journey-health/durable-integration.test.js`, `tests/bin-lib/journey-health/scope.test.js`, `tests/bin-lib/release-preflight/cli.test.js`, `tests/bin-lib/residue/cli.test.js`, `tests/bin-lib/residue/probes-git.test.js`, `tests/bin-lib/residue/probes-pipeline-runs.test.js`, `tests/bin-lib/residue/probes-release-remote.test.js`, `tests/bin-lib/review-context/build.test.js`, `tests/bin-lib/staged-patch/cli.test.js`, `tests/bin-lib/verify/changed-files.test.js`, `tests/bin-lib/verify/ci-cli.test.js`, `tests/bin-lib/verify/cli-baseline.test.js`, `tests/bin-lib/verify/impact-cli.test.js`, `tests/bin-lib/verify/qa-stamp-cli.test.js`, `tests/bin-lib/wrap-up/engine-cli.test.js`, `tests/bin-lib/wrap-up/finish-console-cli.test.js`, `tests/bin-lib/wrap-up/pack-cli.test.js`, `tests/bin-lib/wrap-up/verify-json-cli.test.js`

- [ ] **Step 1: Run the files' tests (before), quote the summary.**
- [ ] **Step 2: Apply the sweep rule.**
- [ ] **Step 3: Run the tests (after) and the grep; same names and counts, grep empty.**
- [ ] **Step 4: Commit** — `Replace fixture identity config calls in the bin-lib suites — refs #5771`.

### Task 6: [batch] Sweep the remaining top-level suites

**Role:** integration

**Files:**
- Modify: `tests/archive-run-verb.test.js`, `tests/blast-radius-cli-e2e.test.js`, `tests/blast-radius-snippet.test.js`, `tests/ceremony-derivation-mode-gate.test.js`, `tests/console-failed-execution-residue-conformance.test.js`, `tests/control-mode-packet-gather.test.js`, `tests/curation-judge-stagepath.test.js`, `tests/delete-ledger-verb.test.js`, `tests/diff-facts-cli-e2e.test.js`, `tests/dispatch-flow-rundir-handoff-fixture.test.js`, `tests/hooks-gate-coverage.test.js`, `tests/hooks-js-flag-strict.test.js`, `tests/hooks-ledger-row-carried.test.js`, `tests/hooks-ledger-row.test.js`, `tests/hooks-policy-exemption.test.js`, `tests/hooks-teardown-run.test.js`, `tests/load-delta-cli.test.js`, `tests/read-claims-cli.test.js`, `tests/resolve-ledger-verb.test.js`, `tests/review-console-unattended-no-ask-conformance.test.js`, `tests/review-merge-provenance-check.test.js`, `tests/run-integrity.test.js`, `tests/staged-patch-contract.test.js`, `tests/sweep-stray-run-dirs.test.js`, `tests/teardown-gate.test.js`, `tests/tidy-residue-markers.test.js`

- [ ] **Step 1: Run the files' tests (before), quote the summary.**
- [ ] **Step 2: Apply the sweep rule.**
- [ ] **Step 3: Run the tests (after) and the grep; same names and counts, grep empty.**
- [ ] **Step 4: Commit** — `Replace fixture identity config calls in the top-level suites — refs #5771`.

### Task 7: Identity-config scan test with a reasoned allowlist

**Role:** integration

**Files:**
- Create: `tests/fixture-identity-config-scan.test.js`

**Interfaces:**
- Consumes: the sweep tasks' reported `path: reason` behaviour-under-test sites.
- Produces: `ALLOWLIST` (posix path relative to the repo root → non-empty reason string) and `identityConfigSites(text) -> number[]` (1-based line numbers) inside the test file.

The matcher is the sweep grep's pattern, `config['"`]?\s*,?\s*['"`]?(?:--(?:local|global|add)['"`]?\s*,?\s*['"`]?)?user\.(?:name|email)\b`, assembled from string pieces so this file's own source holds no match. It walks every `*.js` under `tests/` (recursive, `fs`, no git). Initial `ALLOWLIST`: every sibling-owned file in Global Constraints, reason `owned by #<n>` (#5324, #5769, #5770, #5772 as listed); `tests/helpers-git-template.test.js`, reason: `reads user.email back with git config to prove an identity reached a template copy; two test titles name the command`; plus each sweep-reported site. `perf/` is outside the scanned tree (its four sites are timing fixtures, not suite tests; say so in a comment).

- [ ] **Step 1: Write the tests**
  - `AC3.1: no test file outside the allowlist spawns git config user.name or user.email` — `offenders` (`path:line` for every match in a non-allowlisted file) deep-equals `[]`; the message lists them.
  - `the scan walked the test tree` — at least 500 `*.js` files visited and the allowlisted `tests/helpers-git-template.test.js` yields at least one match (floor against a vacuous walk).
  - `identityConfigSites matches every call shape and no inline -c identity` — positives: `git(['config', 'user.name', 'T'])`, `execFileSync('git', ['-C', d, 'config', 'user.email', 'e'])`, `` `git config user.name T` ``, `git(dir, 'config', '--local', 'user.email')`; negatives: `['-c', 'user.name=T']`, `'-c user.email=e'`, `GIT_AUTHOR_NAME`.
  - `every allowlist entry names an existing file and carries a reason`.
- [ ] **Step 2: Run**

Run: `node tools/run-tests.js tests/fixture-identity-config-scan.test.js`
Expected: PASS after Tasks 3–6 (before them, AC3.1 fails listing the unswept sites).

- [ ] **Step 3: Commit** — `Add a scan test that keeps fixture identity config calls out of the test tree — refs #5771`.

### Task 8 (controller, not dispatched): Evidence and counts

Run by the orchestrating session after Task 7, results written to `$PIPELINE_RUN_DIR/evidence/` with a plain Bash redirect and logged with `log-decision.js --status AUTO --step "AC evidence" --text-file`.

- **AC4.1** go-red: in a scratch copy of HEAD (archive extract), restore one swept site from the merge base (`git show <base>:tests/console-execute.test.js`), run the scan test there, capture the red output to `evidence/scan-red.txt`; AC4.2: the PR body quotes that output.
- **AC5.1** counts: touched-file list = every `*.test.js` file Tasks 1–7 changed plus the test files that require a changed helper (helper files themselves are never listed — the runner rejects a non-`*.test.js` entry). The before list is that HEAD list minus files absent at the base (`tests/fixture-identity-config-scan.test.js`); the PR body says the after count includes this record's added tests. For the merge base and for HEAD, each in an archive extract (`git init` + snapshot commit outside the trace window), run `GIT_TRACE2_EVENT=<empty abs dir> CT_TEST_CONCURRENCY=6 node tools/run-tests.js --files-from <list>` back to back; count trace files (total git processes) and those whose `start` argv has a `config` subcommand (all, and identity keys). Write both to `evidence/counts.txt`.
- **AC3.1** traced: a separate traced `--files-from` pass at HEAD over the swept `*.test.js` files minus every `ALLOWLIST` key (and minus sibling-owned consumers) holds zero identity `config` processes (`evidence/identity-trace.txt`); trace2 carries no file attribution, so the AC5.1 trace cannot stand in for it.
- **PR body (aim reading):** state that #5768's template is changed to drop `*.sample` hooks (`info/` and `description` kept), under the record's Decision aim clause, because its premise that the template already had no sample hooks was false.
- **AC6.1 AC6.2**: the before and after runs list the same test names per pre-existing file, all passing, and the per-file test count grows only by this record's added tests (`evidence/test-names.diff`).
- **AC7.1**: full suite via `/claude-tweaks:test`; the Windows regression job via the platform-proof workflow before merge (second call).

| AC clause | Evidence |
|---|---|
| AC4.1 | `evidence/scan-red.txt` (scan test red in an extract with one restored site) |
| AC4.2 | PR body quotes `evidence/scan-red.txt` |
| AC5.1 | `evidence/counts.txt` (trace2 counts, merge base and HEAD extracts, back to back) |
| AC6.1 | `evidence/test-names.diff` (same names, all passing) |
| AC6.2 | `evidence/test-names.diff` plus the sweep tasks' before/after summaries; whole-branch review reads the diff for removed or loosened assertions |
| AC7.1 | `/claude-tweaks:test` stamp; Windows regression job run before merge |
