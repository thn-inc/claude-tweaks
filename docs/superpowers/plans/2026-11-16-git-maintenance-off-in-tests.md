# Git Maintenance Off in Test Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No `git maintenance run --auto` process starts inside a `tools/run-tests.js` run, whichever way a test's git process lost the runner's `GIT_CONFIG_*` environment.

**Architecture:** The runner already exports `maintenance.auto=false`/`gc.auto=0` through `GIT_CONFIG_COUNT` (#5297). Environment config is lost on the receive side of a local push, in product code that scrubs it (`stack-check.js`'s `gitEnv`), and in tests that overwrite the count. Repository config is the one layer all three still read. The runner therefore writes a per-run git template directory (git's default template files plus a `config` holding the maintenance-off keys and `receive.autogc=false`) into its run root and exports `GIT_TEMPLATE_DIR`, so every repository a test creates with `git init`/`git clone` carries the settings in its own `.git/config`. The one test that overwrote the inherited count appends to it instead.

**Tech Stack:** Node 18+ (`node --test`), git >= 2.29 (`maintenance.auto`), trace2 (`GIT_TRACE2_EVENT=<dir>`).

**Spec:** `.claude-tweaks/pipelines/2026-11-16T171948-record-5768/work/5768-spec.md`

## Global Constraints

- Product code keeps its environment scrubbing (spec Deliverable 2): `plugin/bin/lib/staged-patch/stack-check.js` is not edited.
- Sibling-owned files are not edited (spec Current State): `tests/bin-lib/issues/claims-git-cas.test.js`, `tests/bin-lib/reconcile/prune-remote.test.js`, `tests/bin-lib/pre-review-catchup/cli.test.js`, `tests/bin-lib/learned-skills/`, `tests/bin-lib/staged-patch/stack-check.test.js`.
- No test is deleted, skipped or loosened, and test concurrency is unchanged (AC4).
- `git-ground-truth-test-env` skill, verbatim: "`tools/run-tests.js` exports `GIT_CONFIG_COUNT` with `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` to every test (`gitFixtureConfigEnv`, #5297). A reader that hands the question back to git whenever `GIT_CONFIG*` is set then defers in every test, so each \"defers to git\" test passes whatever the reader does." — the same holds for the new `GIT_TEMPLATE_DIR`: a test whose control case expects maintenance to start must drop `GIT_TEMPLATE_DIR` from the env its git calls use, or the control is masked.
- `git-ground-truth-test-env` skill, verbatim: "**Prove both under the runner.** Run `node tools/run-tests.js --files-from <list>`, never only a bare `node --test`: the runner's env is part of the test's input."
- `windows-checkout-test-parity` skill, verbatim: "Isolating a fixture's git from system config (`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_SYSTEM=/dev/null`) when the code under test runs git with the host's config | Git for Windows keeps `core.autocrlf=true` in its system config." — this plan changes no system or global config; the template adds repository-level keys only.
- `windows-checkout-test-parity` skill, verbatim: "Passing `os.devNull` to git as a config path (`GIT_CONFIG_GLOBAL: os.devNull`) | On win32 `os.devNull` is `\\.\nul`, which Git for Windows rejects on every call" — any new test config path is a real empty file or the literal `/dev/null`.
- `suite-slot-test-env` skill: a test that spawns `tools/run-tests.js` builds its child env through the existing `withSandbox`/`runRunner` helpers in `tests/run-tests-isolation.test.js`, never raw `process.env`.
- Every git spawn added under `tools/` passes `windowsHide: true`.

## Review Focus

1. A caller that already exports `GIT_TEMPLATE_DIR` (a developer's own template, or a nested runner inheriting the outer one): its files and its `config` keys must survive into the new template, with the maintenance-off keys appended after them.
2. A runner launched from inside a git hook (inherited `GIT_DIR`/`GIT_WORK_TREE`): the scratch `git init` that harvests the default template files must not write into the inherited repository.
3. `git` missing or failing during template build: the runner must still run the suite (fail open, one stderr line), never crash before the slot is released.
4. Bare repositories: the template `config` must not carry `core.bare` or other keys `git init` writes itself, so a non-bare repo made from it is not marked bare and vice versa.
5. Existing control assertions that expect maintenance to start (`tests/helpers-git-template.test.js`'s `disableReceiveAutoGc` control and "template build runs with auto-maintenance off") must keep discriminating under the runner once `GIT_TEMPLATE_DIR` is exported.

Each line is pinned by a test in Task 1 (1-4) or Task 2 (5).

---

### Task 1: Runner-written git template directory

**Files:**
- Modify: `tools/run-tests.js` (new `writeGitTemplateDir` beside `gitFixtureConfigEnv` ~line 578; export it; wire into the spawn env ~line 841)
- Modify: `tests/fixtures/run-tests/tmpdir-probe.fixture.js` (record `GIT_TEMPLATE_DIR` and its `config` text)
- Test: `tests/run-tests-isolation.test.js`

**Interfaces:**
- Produces: `writeGitTemplateDir(dir: string, env: object, { git?: (args: string[], opts: object) => void } = {}) -> string | null` and the constant `GIT_TEMPLATE_CONFIG: string` (`'[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n[receive]\n\tautogc = false\n'`), both exported from `tools/run-tests.js`. Returns `dir` once `dir/config` is written; `null` when any step throws (the caller logs and omits `GIT_TEMPLATE_DIR`).

Behavior of `writeGitTemplateDir`:
1. `fs.mkdirSync(dir, { recursive: true })`.
2. Run `git init -q <dir>-src` with `env` minus `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR` (default `git` = `execFileSync('git', args, { ...opts, stdio: 'ignore', windowsHide: true })`), so git's own default template (or an inherited `GIT_TEMPLATE_DIR`) is materialized.
3. Copy `hooks/`, `info/` and `description` from `<dir>-src/.git` into `dir` when present (`fs.cpSync`, recursive). Never copy `<dir>-src/.git/config`: it holds the `core.*` keys `git init` writes per repository (Review Focus 4).
4. Write `dir/config` = (text of `env.GIT_TEMPLATE_DIR/config` when that file exists, followed by a newline when it does not end in one) + `GIT_TEMPLATE_CONFIG`.
5. Remove `<dir>-src` (best effort) and return `dir`.

- [ ] **Step 1: Write the failing tests** in `tests/run-tests-isolation.test.js` (import `writeGitTemplateDir`, `GIT_TEMPLATE_CONFIG`):
  - `AC1.1: writeGitTemplateDir writes the maintenance-off keys and keeps git's default template files` — into a fresh temp dir with `process.env` minus every `GIT_TEMPLATE_DIR`/`GIT_CONFIG_*` key; assert the return equals the dir, `git config --file <dir>/config --get maintenance.auto` is `false`, `gc.auto` is `0`, `receive.autogc` is `false`, `core.bare` is absent (exit 1), and `<dir>/info` and `<dir>/hooks` exist.
  - `AC1.1: a repo initialized from the template carries the keys, bare and non-bare` — `git init -q` and `git init -q --bare` with `GIT_TEMPLATE_DIR=<dir>`; `git config --local --get maintenance.auto` is `false` in both; `core.bare` is `false` and `true` respectively.
  - `writeGitTemplateDir keeps an inherited GIT_TEMPLATE_DIR's files and config ahead of its own keys` — inherited template holding `config` = `[core]\n\tct-probe = yes` (no trailing newline) and `info/marker`; assert `<dir>/info/marker` exists, `git config --file <dir>/config --get core.ct-probe` is `yes`, and `maintenance.auto` is `false`.
  - `writeGitTemplateDir ignores an inherited GIT_DIR` — env `GIT_DIR` pointing at another temp repo's `.git`; after the call that repo's `.git/config` bytes are unchanged and the return is the dir.
  - `writeGitTemplateDir returns null when git fails` — injected `git` that throws; return is `null`.
  - `run-tests.js gives the suite a GIT_TEMPLATE_DIR inside its run root whose config turns maintenance off` — via `withSandbox(...PROBE)`/`runRunner` with `GIT_TEMPLATE_DIR` removed from `sb.env`; the probe's recorded `gitTemplateDir` sits inside the recorded `tmpdir`, and its recorded `gitTemplateConfig` ends with `GIT_TEMPLATE_CONFIG`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node tools/run-tests.js tests/run-tests-isolation.test.js`
Expected: FAIL (`writeGitTemplateDir is not a function`, and the probe records no `gitTemplateDir`).

- [ ] **Step 3: Implement `writeGitTemplateDir` and the wiring**

In `main`'s spawn block, after `createRunRoot`: `const templateDir = writeGitTemplateDir(path.join(runRoot, 'git-template'), process.env);` — on `null` print one `run-tests.js: could not build the git template (…) — repositories tests create keep git's own defaults` line to stderr (wrap the call so the error message reaches the line). Add `...(templateDir ? { GIT_TEMPLATE_DIR: templateDir } : {})` to the child env. Keep `gitFixtureConfigEnv` exactly as it is. Update the comment above the spawn to say why both exist (env config reaches every git process that keeps it; repository config reaches the rest). In the probe fixture add `gitTemplateDir: process.env.GIT_TEMPLATE_DIR` and `gitTemplateConfig` (the file's text, or `null` when unreadable) to the recorded JSON.

- [ ] **Step 4: Run them to verify they pass**

Run: `node tools/run-tests.js tests/run-tests-isolation.test.js`
Expected: PASS, every pre-existing test in the file still passing.

- [ ] **Step 5: Commit**

```bash
git add tools/run-tests.js tests/run-tests-isolation.test.js tests/fixtures/run-tests/tmpdir-probe.fixture.js
git commit -m "Write a maintenance-off git template for every test run — refs #5768"
```

### Task 2: Keep it closed, and keep the existing controls honest

**Files:**
- Test: `tests/helpers-git-template.test.js`

**Interfaces:**
- Consumes: `writeGitTemplateDir`, `GIT_TEMPLATE_CONFIG` from `tools/run-tests.js` (Task 1).

- [ ] **Step 1: Write the failing test** `AC3.1: under the runner's git template a bare-origin push and a fixture commit start no maintenance process`:
  - Build a template with `writeGitTemplateDir(mk('ct-gt-tpl-') + '/t', envWithoutTemplate)`.
  - A helper `run(withTemplate)` builds env = `gitEnv()` minus `GIT_TEMPLATE_DIR` and every `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` (the scrubbed shapes the attribution found), with `GIT_CONFIG_SYSTEM` pointing at a file holding `[maintenance]\n\tautoDetach = false\n` (keeps any maintenance in the foreground so its trace file is complete; it reaches receive-pack, as probed), plus `GIT_TEMPLATE_DIR` when `withTemplate`. With it: `init --bare` an origin, `init` a work repo, add the remote, then trace (`GIT_TRACE2_EVENT=<dir>`) one `add` + `commit` and one `push -q origin main`.
  - Assert `run(true)` has zero argvs containing `maintenance` and more than zero argvs overall; assert `run(false)` has at least one `maintenance` argv whose parent is the commit and one from the push (control).
- [ ] **Step 2: Make the two existing controls drop `GIT_TEMPLATE_DIR`** (Review Focus 5): in `disableReceiveAutoGc stops receive-pack maintenance` and `template build runs with auto-maintenance off`, the env their git calls use excludes `GIT_TEMPLATE_DIR` (extend the latter's `mine` regex with `|^GIT_TEMPLATE_DIR$`; give `pushArgvs` an env without it). Assertions unchanged.
- [ ] **Step 3: Run under the runner**

Run: `node tools/run-tests.js tests/helpers-git-template.test.js`
Expected: PASS, test count = previous count + 1.
- [ ] **Step 4: Prove the new test discriminates** — temporarily make `GIT_TEMPLATE_CONFIG` an empty string in `tools/run-tests.js`, re-run Step 3's command, expect the AC3.1 test FAIL with the maintenance assertion; restore the constant. Save the red output to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T171948-record-5768/evidence/ac3-red.txt` for the PR body.
- [ ] **Step 5: Commit**

```bash
git add tests/helpers-git-template.test.js
git commit -m "Test that a template-made origin and repo start no maintenance — refs #5768"
```

### Task 3: Append to the inherited GIT_CONFIG entries in archive-run-verb's AC10.1

**Files:**
- Modify: `tools/run-tests.js` (export `appendGitConfigEnv(env, pairs) -> object`; reimplement `gitFixtureConfigEnv(env)` as `appendGitConfigEnv(env, [['maintenance.auto','false'],['gc.auto','0']])` with identical output)
- Modify: `tests/archive-run-verb.test.js` (AC10.1 test ~line 794)
- Test: `tests/run-tests-isolation.test.js`

**Interfaces:**
- Produces: `appendGitConfigEnv(env: object, pairs: Array<[string, string]>) -> object` — a new env with `pairs` appended after any inherited `GIT_CONFIG_COUNT` entries; never mutates `env`; returns an unchanged copy when `GIT_CONFIG_COUNT` is present and not a non-negative integer (the rule `gitFixtureConfigEnv` already has).

- [ ] **Step 1: Write the failing test** `appendGitConfigEnv appends the given pairs after inherited entries` — input `{ GIT_CONFIG_COUNT: '2', KEY_0/VALUE_0, KEY_1/VALUE_1 }`, pairs `[['branch.main.remote','origin']]` → COUNT `3`, KEY_2/VALUE_2 = the pair, input unmutated. The three existing `gitFixtureConfigEnv` tests stay unchanged and keep passing.
- [ ] **Step 2: Run it to verify it fails**: `node tools/run-tests.js tests/run-tests-isolation.test.js` → FAIL (`appendGitConfigEnv is not a function`).
- [ ] **Step 3: Implement**, then change AC10.1's env to `{ GIT_AUTHOR_NAME: 'ct-env-only-author', ...gitConfigOnly(appendGitConfigEnv(process.env, [['branch.main.remote','origin'],['branch.main.merge','refs/heads/main']])) }`, where `gitConfigOnly` keeps only `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` keys (so `hookEnv`'s removal of `GIT_DIR` and friends is not undone). Update the test's comment: the runner's maintenance-off entries stay in place.
- [ ] **Step 4: Run**: `node tools/run-tests.js tests/run-tests-isolation.test.js tests/archive-run-verb.test.js` → PASS, same test counts as before plus the one new test.
- [ ] **Step 5: Commit**

```bash
git add tools/run-tests.js tests/run-tests-isolation.test.js tests/archive-run-verb.test.js
git commit -m "Append archive-run AC10.1's git config to the runner's entries — refs #5768"
```

### Task 4: Measure before and after, and write the attribution

**Files:** none committed (scratch scripts under the session scratchpad; evidence under the run dir).

- [ ] **Step 1:** With the trace preload (`NODE_OPTIONS=--require <scratchpad>/trace-preload.js`, `CT_TRACE_ROOT=<dir>`, one trace directory per test file), run `node tools/run-tests.js --files-from <all-files list>` back to back: first in a detached worktree at the merge-base (`git merge-base HEAD origin/main`), then at HEAD.
- [ ] **Step 2:** Run `trace-analyze.js` over both trace roots; write the per-file table (test file, maintenance count, parent git command, reason the config missed it) and the two totals (maintenance processes, git processes) for the files in the table less the sibling-owned files, to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T171948-record-5768/evidence/maintenance-attribution.md`.
- [ ] **Step 3:** Independent count over each root, not computed by the analyzer: `grep -rh '"event":"start"' <root> | grep -c '"maintenance"'` (only a process's own `start` line, never a parent's `child_start` line naming it) agrees with the analyzer's maintenance total.
- [ ] **Step 4:** Any maintenance process left at HEAD is listed with the reason it cannot be closed; if one is closable, fix it in a further task before proceeding.
