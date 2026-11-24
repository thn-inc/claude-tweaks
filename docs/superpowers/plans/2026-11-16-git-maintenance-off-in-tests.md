# Git Maintenance Off in Test Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No `git maintenance run --auto` process starts inside a `tools/run-tests.js` run, whichever way a test's git process lost the runner's `GIT_CONFIG_*` environment.

**Architecture:** The runner already exports `maintenance.auto=false`/`gc.auto=0` through `GIT_CONFIG_COUNT` (#5297). Environment config is lost on the receive side of a local push, in product code that scrubs it (`stack-check.js`'s `gitEnv`), and in tests that overwrite the count. Repository config is the one layer all three still read. The runner therefore writes a per-run git template directory (git's default template files plus a `config` holding the maintenance-off keys and `receive.autogc=false`) into its run root and exports `GIT_TEMPLATE_DIR`, so every repository a test creates with `git init`/`git clone` carries the settings in its own `.git/config`. The one test that overwrote the inherited count appends to it instead.

**Tech Stack:** Node 18+ (`node --test`), git >= 2.29 (`maintenance.auto`), trace2 (`GIT_TRACE2_EVENT=<dir>`).

**Spec:** `.claude-tweaks/pipelines/2026-11-16T175307-record-5768/work/5768-spec.md` (re-materialized for the resumed run; its two `**Decision (2026-11-16, record author)**` paragraphs settle AC4's counts and Deliverable 4's "shared builder").

**Record decisions applied:** (a) AC4 — no existing test is deleted, skipped, renamed, merged or loosened; a touched file's count may grow by the tests this record adds. (b) Deliverable 4 — the runner-written template is the central mechanism, so the regression test pushes into a plain `git init --bare` origin and commits in a plain `git init` repo in a runner child; `originWithTwoClones` is not bypassed. The template applies only under `tools/run-tests.js`, so the "bare `node --test`" clause of decision (b) does not apply; the PR body says so.

## Global Constraints

- Product code keeps its environment scrubbing (spec Deliverable 2): `plugin/bin/lib/staged-patch/stack-check.js` is not edited.
- Sibling-owned files are not edited (spec Current State): `tests/bin-lib/issues/claims-git-cas.test.js`, `tests/bin-lib/reconcile/prune-remote.test.js`, `tests/bin-lib/pre-review-catchup/cli.test.js`, `tests/bin-lib/learned-skills/`, `tests/bin-lib/staged-patch/stack-check.test.js`.
- No existing test is deleted, skipped, renamed, merged or loosened, and test concurrency is unchanged (AC4 with the record's decision (a)); a touched file's count grows only by the tests this plan adds.
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
6. The developer's own git config (`init.templateDir` in `~/.gitconfig`, the system config, or an inherited `GIT_CONFIG_COUNT`/`GIT_CONFIG_PARAMETERS` entry) must not decide what the scratch `git init` harvests: the runner's template is git's built-in default (or an explicitly inherited `GIT_TEMPLATE_DIR`) plus the maintenance-off keys, the same on every machine.

Each line is pinned by a test in Task 1 (1-4, 6) or Task 2 (5).

## Spec coverage

| AC clause | Where |
|---|---|
| AC1.1 traced run shows zero maintenance in the table's non-sibling files | Task 4 Steps 1-3 |
| AC1.2 any that remain are listed in the PR body with the reason | Task 4 Steps 4-5 |
| AC2.1 before/after maintenance and git process counts in the PR body | Task 4 Steps 0-2 and 5 (before at the merge-base and after at HEAD, back to back) |
| AC3.1 the Deliverable 4 test fails when the fix is reverted | Task 2 Step 4 (wiring revert and keys revert) |
| AC3.2 the PR body quotes that red output | Task 4 Step 5 |
| AC4.1 every touched test file keeps its pre-existing tests, all passing | Task 1 Step 4, Task 2 Step 3, Task 3 Step 4 (runs), Task 4 Step 5 (per-file counts before/after in the PR body) |
| AC4.2 no test deleted, skipped, renamed, merged or loosened; concurrency unchanged | Global Constraints; Task 4 Step 5 (counts); the whole-branch review reads the diff for it |
| AC5.1 the full suite and the Windows regression job pass | `/build` Common Step 5 (full verify) and the PR's CI, including the Windows job |

Waived tests/helpers/git-template.js: read, not edited — `disableReceiveAutoGc` and `withMaintenanceOff` stay as they are; the runner's template closes the receive side for every bare origin, including the ones the builders make (record decision (b)).
Waived tests/helpers/git-fixtures.js: read, not edited — `originWithTwoClones` keeps its `disableReceiveAutoGc` call; no shared-builder change is needed once the template is the central mechanism (record decision (b)).

---

### Task 1: Runner-written git template directory

**Role:** integration
**Review risk:** high (branches on inherited env state — `GIT_TEMPLATE_DIR`, `GIT_DIR`, the developer's git config — and changes the env of every test the runner starts)

**Files:**
- Modify: `tools/run-tests.js` (new `writeGitTemplateDir` beside `gitFixtureConfigEnv` ~line 578; export it; wire into the spawn env ~line 841)
- Modify: `tests/fixtures/run-tests/tmpdir-probe.fixture.js` (record `GIT_TEMPLATE_DIR` and its `config` text)
- Test: `tests/run-tests-isolation.test.js`

**Interfaces:**
- Produces: `writeGitTemplateDir(dir: string, env: object, { git?: (args: string[], opts: object) => void } = {}) -> string | null` and the constant `GIT_TEMPLATE_CONFIG: string` (`'[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n[receive]\n\tautogc = false\n'`), both exported from `tools/run-tests.js`. Returns `dir` once `dir/config` is written; `null` when any step throws (the caller logs and omits `GIT_TEMPLATE_DIR`).

Behavior of `writeGitTemplateDir`:
1. `fs.mkdirSync(dir, { recursive: true })`.
2. Run `git init -q <dir>-src` with an env built from `env` by dropping **every** key that starts with `GIT_` (this covers `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_QUARANTINE_PATH`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n` — Review Focus 2 and 6), then adding back `GIT_TEMPLATE_DIR` only when the inherited value names an existing directory (`fs.statSync(...).isDirectory()`; a missing or non-directory inherited value is dropped, so git falls back to its built-in default), plus `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL=<dir>-empty-gitconfig` (a real empty file written first — never `os.devNull`, which Git for Windows rejects as a config path) (default `git` = `execFileSync('git', args, { ...opts, stdio: 'ignore', windowsHide: true })`), so git's built-in default template (or a usable inherited `GIT_TEMPLATE_DIR`, which git reads from the environment ahead of any config) is materialized, never a developer's `init.templateDir` (Review Focus 6).
3. Copy `hooks/`, `info/` and `description` from `<dir>-src/.git` into `dir` when present (`fs.cpSync`, recursive). Never copy `<dir>-src/.git/config`: it holds the `core.*` keys `git init` writes per repository (Review Focus 4).
4. Write `dir/config` = (text of `<usable inherited GIT_TEMPLATE_DIR>/config` when that read succeeds, followed by a newline when it does not end in one; nothing when there is no usable inherited template or the read throws — a missing or unreadable inherited `config` never drops the template) + `GIT_TEMPLATE_CONFIG`.
5. Remove `<dir>-src` and `<dir>-empty-gitconfig` (best effort) and return `dir`.

- [ ] **Step 1: Write the failing tests** in `tests/run-tests-isolation.test.js` (import `writeGitTemplateDir`, `GIT_TEMPLATE_CONFIG`):
  - `AC1.1: writeGitTemplateDir writes the maintenance-off keys and keeps git's default template files` — into a fresh temp dir with `process.env` minus every `GIT_TEMPLATE_DIR`/`GIT_CONFIG_*` key; assert the return equals the dir, `git config --file <dir>/config --get maintenance.auto` is `false`, `gc.auto` is `0`, `receive.autogc` is `false`, `core.bare` is absent (exit 1), and `<dir>/info` and `<dir>/hooks` exist.
  - `AC1.1: a repo initialized from the template carries the keys, bare and non-bare` — `git init -q` and `git init -q --bare` with `GIT_TEMPLATE_DIR=<dir>`; `git config --local --get maintenance.auto` is `false` in both; `core.bare` is `false` and `true` respectively.
  - `writeGitTemplateDir keeps an inherited GIT_TEMPLATE_DIR's files and config ahead of its own keys` — inherited template holding `config` = `[core]\n\tct-probe = yes` (no trailing newline) and `info/marker`; assert `<dir>/info/marker` exists, `git config --file <dir>/config --get core.ct-probe` is `yes`, and `maintenance.auto` is `false`.
  - `writeGitTemplateDir ignores an inherited GIT_DIR and object-store variables` — env `GIT_DIR` pointing at another temp repo's `.git`, `GIT_OBJECT_DIRECTORY` at that repo's `.git/objects`, and `GIT_ALTERNATE_OBJECT_DIRECTORIES` at a third temp dir; after the call that repo's `.git/config` bytes and the sorted listing of its `.git/objects` (recursive) are unchanged, the third dir is still empty, and the return is the dir.
  - `writeGitTemplateDir falls back to git's default when the inherited GIT_TEMPLATE_DIR is missing or its config is unreadable` — (i) `GIT_TEMPLATE_DIR` names a path that does not exist: return is the dir, `<dir>/info/exclude` exists, `maintenance.auto` is `false`; (ii) `GIT_TEMPLATE_DIR` names a dir whose `config` is a directory (a read that throws on every platform) and which holds `info/marker`: return is the dir, `<dir>/info/marker` exists, `maintenance.auto` is `false`.
  - `writeGitTemplateDir ignores the developer's init.templateDir` — env `GIT_CONFIG_GLOBAL` pointing at a temp gitconfig holding `[init]\n\ttemplateDir = <devTpl>`, where `<devTpl>/info/dev-marker` exists, and `GIT_CONFIG_COUNT=1`/`GIT_CONFIG_KEY_0=init.templateDir`/`GIT_CONFIG_VALUE_0=<devTpl>` (both channels); no `GIT_TEMPLATE_DIR`. Assert `<dir>/info/dev-marker` does not exist and `<dir>/info/exclude` does (git's built-in default). Control in the same test: a plain `git init -q` of a scratch repo under that same env does carry `info/dev-marker`, so the fixture really sets a template.
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
  - The template under test is the one the runner exported, not one the test builds: under the runner (`process.env.CT_TEST_SUITE_SLOT_HELD === '1'`) use `process.env.GIT_TEMPLATE_DIR` as-is — when the runner's wiring is gone it is `undefined`, and the with-template run then behaves like the control and fails the maintenance assertion. Only outside the runner (a bare `node --test`, where no template is exported) build one with `writeGitTemplateDir(mk('ct-gt-tpl-') + '/t', process.env)` so the file still runs green there.
  - A helper `run(templateDir)` builds env = `gitEnv()` minus `GIT_TEMPLATE_DIR` and every `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` (the scrubbed shapes the attribution found), with `GIT_CONFIG_SYSTEM` pointing at a file holding `[maintenance]\n\tautoDetach = false\n` (keeps any maintenance in the foreground so its trace file is complete; it reaches receive-pack, as probed), plus `GIT_TEMPLATE_DIR=templateDir` when `templateDir` is defined. With it: a plain `git init -q --bare` origin, a plain `git init -q` work repo, add the remote, then trace (`GIT_TRACE2_EVENT=<dir>`) one `add` + `commit` and one `push -q origin main`.
  - Assert `run(template)` has zero argvs containing `maintenance` and more than zero argvs overall; assert `run(undefined)` has at least one `maintenance` argv whose parent is the commit and one from the push (control).
- [ ] **Step 2: Make the two existing controls drop `GIT_TEMPLATE_DIR`** (Review Focus 5): in `disableReceiveAutoGc stops receive-pack maintenance` and `template build runs with auto-maintenance off`, the env their git calls use excludes `GIT_TEMPLATE_DIR` (extend the latter's `mine` regex with `|^GIT_TEMPLATE_DIR$`; give `pushArgvs` an env without it). Assertions unchanged.
- [ ] **Step 3: Run under the runner**

Run: `node tools/run-tests.js tests/helpers-git-template.test.js`
Expected: PASS, test count = previous count + 1.
- [ ] **Step 4: Prove the new test discriminates, against two reverts of the fix** — first `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T175307-record-5768/evidence"` (a plain Bash call — the run dir is under the main checkout and has no `evidence/` yet). (i) Revert the wiring: temporarily delete the `GIT_TEMPLATE_DIR` spread from the runner's child env in `tools/run-tests.js`, re-run Step 3's command, expect the AC3.1 test FAIL on the maintenance assertion, save the output with a plain Bash redirect to `…/evidence/ac3-red-wiring.txt`. (ii) Revert the keys: restore the spread, temporarily make `GIT_TEMPLATE_CONFIG` an empty string, re-run, expect the same FAIL, save to `…/evidence/ac3-red-keys.txt`. Restore, and confirm with `git diff --exit-code tools/run-tests.js` that the file matches Task 1's commit before committing. Both files feed the PR body (Task 4 Step 5).
- [ ] **Step 5: Commit**

```bash
git add tests/helpers-git-template.test.js
git commit -m "Test that a template-made origin and repo start no maintenance — refs #5768"
```

### Task 3: Append to the inherited GIT_CONFIG entries in archive-run-verb's AC10.1

**Why this target (from the attribution):** the merge-base trace (`/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-11-16T171948-record-5768/maintenance-attribution-baseline.md`, under the main checkout — the same relative path inside this worktree resolves to nothing) attributes exactly one maintenance process to a test that replaced the runner's `GIT_CONFIG_COUNT` entries: `tests/archive-run-verb.test.js`'s `1× git -C <path> commit`, from the AC10.1 test that builds `GIT_CONFIG_COUNT=2` with its own `branch.main.*` keys. The other file the spec names in that class, `tests/bin-lib/residue/cli.test.js`, has no maintenance process in the trace (it does not appear in the table), so Deliverable 3 ("a test that the attribution shows starting maintenance") does not reach it and it is not edited. AC10.1 does not depend on replacing the entries — it needs `branch.main.remote`/`merge` from env config only — so it appends.

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

**Files:** none committed. Scratch scripts live in the session scratchpad (`$SCRATCH` below); evidence goes under the run dir (`$RUN` = `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T175307-record-5768`), written by plain Bash redirects.

**Before and after are measured back to back (AC2 as written; settled at plan review).** The stalled first attempt's trace (run `2026-11-16T171948-record-5768`: 759 maintenance processes, 405 in the 35 non-sibling files, 14153 git processes in those files; table at `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-11-16T171948-record-5768/maintenance-attribution-baseline.md`) is a cross-check only, never the "before" figure: it is hours old and its raw trace lives in a per-session scratchpad. The "before" is re-taken in Step 0, immediately before the "after" in Step 1, on the same machine, with the same scripts and file list.

**The scripts (re-create them with the Write tool if `$SCRATCH` was cleared):**

`$SCRATCH/trace-preload.js` — points each test-file process's `GIT_TRACE2_EVENT` at its own directory, so every git process it or its children start is attributed to that file:

```js
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.env.CT_TRACE_ROOT;
const main = process.argv[1] || '';
if (root && /\.test\.js$/.test(main)) {
  const rel = path.relative(process.env.CT_TRACE_REPO || process.cwd(), main).split(path.sep).join('/');
  const dir = path.join(root, rel.replace(/[\/]/g, '__'));
  fs.mkdirSync(dir, { recursive: true });
  process.env.GIT_TRACE2_EVENT = dir;
}
```

`$SCRATCH/list-files.js` — writes the runner's own full file list (`listTestFiles` over `tests` and `tools/upstream-drift/tests`) to `argv[3]`:

```js
'use strict';
const path = require('path');
const fs = require('fs');
const repo = process.argv[2];
const rt = require(path.join(repo, 'tools', 'run-tests.js'));
const files = rt.listTestFiles(repo, ['tests', path.join('tools', 'upstream-drift', 'tests')]).map((f) => path.relative(repo, f));
fs.writeFileSync(process.argv[3], files.join('\n') + '\n');
console.log(files.length);
```

`$SCRATCH/trace-analyze.js <trace-root> --json <out>` — per test-file directory: every process's own `start` event (`sid` → `argv`), the ones whose argv contains `maintenance`, and each one's parent and grandparent command (from the `sid` path), grouped; prints one tab-separated line per file with maintenance > 0 and a `TOTAL files= git= maintenance=` line; writes `[{file, git, maintenance, byParent}]` to `<out>`:

```js
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const jsonOut = process.argv.indexOf('--json') > 0 ? process.argv[process.argv.indexOf('--json') + 1] : null;
const short = (argv) => {
  const a = argv.slice();
  a[0] = path.basename(a[0]);
  return a.map((x) => (x.includes('/') || x.includes('\\') ? '<path>' : x)).slice(0, 4).join(' ');
};
const rows = [];
let total = 0;
let maint = 0;
for (const fileDir of fs.readdirSync(root).sort()) {
  const dir = path.join(root, fileDir);
  if (!fs.statSync(dir).isDirectory()) continue;
  const procs = new Map();
  for (const f of fs.readdirSync(dir)) {
    let text;
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.event === 'start') procs.set(ev.sid, ev.argv);
    }
  }
  const m = [];
  for (const [sid, argv] of procs) {
    if (!argv.some((a) => a === 'maintenance')) continue;
    const parentSid = sid.includes('/') ? sid.slice(0, sid.lastIndexOf('/')) : null;
    const parent = parentSid && procs.get(parentSid);
    const grand = parentSid && parentSid.includes('/') ? procs.get(parentSid.slice(0, parentSid.lastIndexOf('/'))) : null;
    m.push({ parent: parent ? short(parent) : '(top-level)', grandparent: grand ? short(grand) : null });
  }
  total += procs.size;
  maint += m.length;
  const byParent = {};
  for (const x of m) {
    const k = x.parent + (x.grandparent ? ` <- ${x.grandparent}` : '');
    byParent[k] = (byParent[k] || 0) + 1;
  }
  rows.push({ file: fileDir.replace(/__/g, '/'), git: procs.size, maintenance: m.length, byParent });
}
rows.sort((a, b) => b.maintenance - a.maintenance || a.file.localeCompare(b.file));
for (const r of rows) if (r.maintenance) console.log(`${r.maintenance}\t${r.git}\t${r.file}\t${JSON.stringify(r.byParent)}`);
console.log(`TOTAL files=${rows.length} git=${total} maintenance=${maint}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
```

`$SCRATCH/trace-table.js <before.json> [<after.json>]` — the markdown table: one row per file with maintenance > 0 in either run, columns test file / maintenance before / after / git processes before / after / parent git command (before) / why the config missed it; the five sibling-owned paths from Global Constraints are flagged and left out of the totals line. Reasons: a `git-receive-pack` parent → receive side of a local push; a `-C <path> commit` parent → the test replaced the runner's `GIT_CONFIG_COUNT` entries; anything else → env config scrubbed before git ran:

```js
'use strict';
const fs = require('fs');
const before = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const after = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : null;
const SIBLING = ['tests/bin-lib/issues/claims-git-cas.test.js', 'tests/bin-lib/reconcile/prune-remote.test.js', 'tests/bin-lib/pre-review-catchup/cli.test.js', 'tests/bin-lib/learned-skills/', 'tests/bin-lib/staged-patch/stack-check.test.js'];
const sibling = (f) => SIBLING.some((s) => (s.endsWith('/') ? f.startsWith(s) : f === s));
const idx = (rows) => new Map(rows.map((r) => [r.file, r]));
const b = idx(before);
const a = after ? idx(after) : new Map();
const files = [...new Set([...before, ...(after || [])].filter((r) => r.maintenance > 0).map((r) => r.file))].sort((x, y) => (b.get(y)?.maintenance || 0) - (b.get(x)?.maintenance || 0));
const reason = (k) => {
  if (k.startsWith('git-receive-pack')) return 'receive side of a local push: git strips GIT_CONFIG_* from receive-pack, and the bare origin had no receive.autogc=false';
  if (k.includes('-C <path> commit')) return 'test replaced the runner\'s GIT_CONFIG_COUNT/KEY_0/KEY_1 with its own entries';
  return 'env config scrubbed before git ran (stack-check gitEnv or a GIT_CONFIG_*-free env); only repo config could reach it';
};
const lines = ['| Test file | Maintenance (before) | Maintenance (after) | Git processes (before) | Git processes (after) | Parent git command (before) | Why the config missed it |', '|---|---|---|---|---|---|---|'];
let tb = 0, ta = 0, gb = 0, ga = 0;
for (const f of files) {
  const rb = b.get(f) || { maintenance: 0, git: 0, byParent: {} };
  const ra = a.get(f) || { maintenance: 0, git: 0, byParent: {} };
  const parents = Object.entries(rb.byParent).map(([k, n]) => `${n}× \`${k}\``).join('<br>');
  const reasons = [...new Set(Object.keys(rb.byParent).map(reason))].join('; ');
  const name = sibling(f) ? `${f} (sibling-owned, excluded from totals)` : f;
  lines.push(`| ${name} | ${rb.maintenance} | ${after ? ra.maintenance : '—'} | ${rb.git} | ${after ? ra.git : '—'} | ${parents || '—'} | ${reasons || '—'} |`);
  if (!sibling(f)) { tb += rb.maintenance; ta += ra.maintenance; gb += rb.git; ga += ra.git; }
}
lines.push('', `Totals over the ${files.filter((f) => !sibling(f)).length} non-sibling files: maintenance ${tb} before${after ? `, ${ta} after` : ''}; git processes ${gb} before${after ? `, ${ga} after` : ''}.`);
console.log(lines.join('\n'));
```

Write each of the four scripts with the Write tool to fresh `$SCRATCH` names (`m5768-trace-preload.js`, `m5768-list-files.js`, `m5768-trace-analyze.js`, `m5768-trace-table.js`) exactly as above — never reuse a same-named file left in a scratchpad by an earlier session.

- [ ] **Step 0: Before, at the merge-base.** `mkdir -p "$RUN/evidence"`. `git fetch origin main`, then `git merge-base HEAD origin/main` → `{base}` (record it; if a later catch-up merge moves the merge-base, the PR body names the `{base}` measured). Create a detached checkout of `{base}` outside the repo: `git worktree add --detach "$SCRATCH/m5768-base" {base}`; when the harness refuses that, use an archive extract instead (`git archive {base}` piped to `tar -x -C "$SCRATCH/m5768-base"`, then in it `git init -q`, `git add -A`, and one snapshot commit, so the suite's git-reading tests have a repository). From `$SCRATCH/m5768-base`: `node "$SCRATCH/m5768-list-files.js" "$PWD" "$SCRATCH/m5768-files-before.txt"`, then `CT_TRACE_ROOT="$SCRATCH/m5768-trace-before" CT_TRACE_REPO="$PWD" NODE_OPTIONS="--require $SCRATCH/m5768-trace-preload.js" node tools/run-tests.js --files-from "$SCRATCH/m5768-files-before.txt" > "$SCRATCH/m5768-trace-before.txt" 2>&1` (foreground, timeout 1200000). Record its pass/fail/skip summary lines; a test that fails only because the base checkout is detached or an extract is not a measurement problem, but list any failing file in the PR body. Run `m5768-trace-analyze.js` over the before root (`--json "$SCRATCH/m5768-trace-before.json"`) and compare its non-sibling totals with the first attempt's 405 / 14153 as a sanity check (a large gap is investigated before Step 1, not explained away).
- [ ] **Step 1: After, at HEAD, straight after Step 0** (Tasks 1-3 committed), from the worktree root: `node "$SCRATCH/m5768-list-files.js" "$PWD" "$SCRATCH/m5768-files-after.txt"`, then `CT_TRACE_ROOT="$SCRATCH/m5768-trace-after" CT_TRACE_REPO="$PWD" NODE_OPTIONS="--require $SCRATCH/m5768-trace-preload.js" node tools/run-tests.js --files-from "$SCRATCH/m5768-files-after.txt" > "$SCRATCH/m5768-trace-after.txt" 2>&1` (foreground, timeout 1200000). The run must pass; its pass/skip counts equal Step 0's plus the tests Tasks 1-3 add. Then remove the detached checkout (`git worktree remove --force "$SCRATCH/m5768-base"`, that one path only) or the extract directory.
- [ ] **Step 2:** `node "$SCRATCH/m5768-trace-analyze.js" "$SCRATCH/m5768-trace-after" --json "$SCRATCH/m5768-trace-after.json"`, then `node "$SCRATCH/m5768-trace-table.js" "$SCRATCH/m5768-trace-before.json" "$SCRATCH/m5768-trace-after.json" > "$RUN/evidence/maintenance-attribution.md"`, and copy both summary-line sets and the two JSON files into `$RUN/evidence/` (plain `cp`), so the evidence outlives the scratchpad.
- [ ] **Step 3:** Independent count over each root, not computed by the analyzer: `grep -rh '"event":"start"' <root> | grep -c '"maintenance"'` (only a process's own `start` line, never a parent's `child_start` line naming it) agrees with the analyzer's maintenance total for that root.
- [ ] **Step 4:** Any maintenance process left at HEAD in a non-sibling file is listed with the reason it cannot be closed; if one is closable, fix it in a further task (and re-run Steps 1-3) before proceeding.
- [ ] **Step 5: Evidence in the PR body.** Write an `### Evidence (#5768)` section with the Write tool to `$SCRATCH/pr-evidence.md`: the attribution table from Step 2; the before/after totals (maintenance and git processes over the non-sibling files, and over all files); the two independent `grep -c` counts; the AC3 red output from `$RUN/evidence/ac3-red-wiring.txt` and `$RUN/evidence/ac3-red-keys.txt` (the failing assertion lines, fenced); the AC4 per-file test counts before (from Step 0's run, per touched file) and after (Step 1's run); and the interpretation notes (the `{base}` measured; the template applies only under the runner, so decision (b)'s bare `node --test` clause does not apply and the AC3.1 test builds its own template there; `residue/cli.test.js` untouched because the attribution shows no maintenance there). Append it to PR #5784's body below the fixes block (`gh pr view 5784 --json body --jq .body > "$SCRATCH/pr-body-now.md"`, add the section after `<!-- fixes-end -->` and before the session link, `gh pr edit 5784 --body-file <file>`), then read the body back and confirm the section is there.
