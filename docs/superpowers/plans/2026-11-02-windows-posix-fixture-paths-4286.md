# Windows POSIX-literal fixture paths (#4286) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 20 Windows-only test failures in 8 test files pass by building each expected value and each fake-fs or fake-reader key with the same path operation the code under test applies.

**Architecture:** Test-only change. `plugin/` is not touched. On POSIX `path.resolve`/`path.join` of these literals are identities, so Linux suites stay green before and after. The red signal for each task is a scratch win32 path simulation (`--require` preload that swaps `require('path')` for `path.win32`, drive cwd `D:\a\repo`), and the final proof is a real `windows-regression.yml` dispatch (AC3, run at Common Step 5 by the controller).

**Tech Stack:** Node `node:test`, `node:assert`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T214829-record-4286/work/4286-spec.md`

## Global Constraints

- "No `process.platform` branch and no `toPosix` on these values. They are native fs paths, not display IDs."
- "Leave a path the code passes through unresolved as a literal"
- "Define each fixture root once per file (for example `const REPO = path.resolve('/repo')`) and derive the rest from it."
- "Grep each file for every remaining POSIX absolute literal, not only the failing assertions"
- No test is deleted or skipped; test count per file is unchanged. No `plugin/` file changes.
- Base test counts: apply-refine-labels 36, atomic-write 10, json-store 7, verify/impact 37, visual-decide/server 10, friction-events-cli 42, hooks-context 83, revise-pr-summary-cli 10.

**Governing skill, quoted (`.claude/skills/windows-checkout-test-parity/SKILL.md`):**

- "Expecting a POSIX absolute literal (`'/main-checkout'`) where the code under test runs that path through `path.resolve` | On win32, `path.resolve('/main-checkout')` is `C:\main-checkout`, so the pin fails only on a Windows checkout. Wrap the expected value in `path.resolve(...)` too. A path the code passes through unresolved stays literal"
- "Fixing only the assertions a failure excerpt or a spec names | The filer's excerpt shows the first failing tests, and a spec written from it can miss siblings with the same shape."
- "A win32 path simulation on a POSIX host is evidence, not a Windows run" — "Report it as a simulation and never as a Windows run."

## Review Focus

- A literal converted that the code passes through verbatim (for example `--body-file '/b.md'`, `deps.cwd()`, `dirname('/runs/x/spec-7')`): on win32 the converted expectation would then be wrong while Linux stays green. The per-file tables below rule each one.
- `friction-events-cli.test.js`'s #4704 tests, which landed after the record's failing-test list and carry the same `/run/primary` and `/main` shape: not in the record's list, but they fail the same way.
- A fake key the code never reaches: a fake that goes silent turns a union or reversal test vacuous. AC2 covers this by mutation.
- Weakening an assertion while converting it (a `startsWith` replaced by an `includes`, an exact value replaced by a regex): every conversion keeps the assertion's strength or tightens it.

---

### Task 1: Library-level expectations (five test files)

**Role:** integration

**Files:**
- Test: `tests/bin-lib/atomic-write.test.js`
- Test: `tests/bin-lib/json-store.test.js`
- Test: `tests/bin-lib/verify/impact.test.js`
- Test: `tests/bin-lib/visual-decide/server.test.js`
- Test: `tests/hooks-context.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks use.

**Rulings by file (the code under test decides each):**

| File | Convert | Stays literal, because |
|---|---|---|
| `atomic-write` | `writeCalls[0].p.startsWith('/x/y/store.txt.tmp-')` to `startsWith(path.join('/x/y', 'store.txt.tmp-'))`; `unlinkCalls[0].startsWith('/x/store.txt.tmp-')` to `startsWith(path.join('/x', 'store.txt.tmp-'))` (`path.join(dir, basename + '.tmp-pid')`) | the `writeFileAtomic('/x/…')` input and `renameCalls[0].to`: the target is passed to `rename` verbatim |
| `json-store` | `writes[0].startsWith('/x/store.json.tmp-')` to `startsWith(path.join('/x', 'store.json.tmp-'))`, adding `const path = require('path');` | `mkdirCalls[0].p` (`path.dirname('/x/y/store.json')` keeps the input's separators on win32) and `renameCalls[0].to` (verbatim) |
| `verify/impact` | the `gitLocations` expectation only: `commonDir: path.resolve(ROOT, '.git')` (the code runs `path.resolve(cwd, commonDir)`) | `ROOT`, `COMMON`, `MAP_PATH`, used with `path.join` in `resolveMapPath`; `'/m'` is an opaque value |
| `visual-decide/server` | `assert.equal(resolveSafe(root, '/').replace(/\/$/, ''), root)` to `assert.equal(resolveSafe(root, '/'), path.join(root, '/'))` (the code returns `path.normalize(path.join(root, decoded))`) | `root`, an input; URL paths such as `/a.txt` |
| `hooks-context` | in `readRunStateWithParent: reads through the injected reader…`: define `const parent = path.join('/runs/2026-07-01T090000-spec-7-8')` and `const child = path.join(parent, 'spec-7')`, use both for the call and the `seen` expectation (the code calls `path.dirname` on the joined child) | `'/runs/x/spec-7'` and `parentRunDir: '/runs/x'` (`path.dirname` of a literal keeps its separators); every `worktree:` value (round-tripped through JSON); `/nope`, `/nonexistent/run`, and `/tmp/wt-*`, which `findRunsByWorktreePath` compares to themselves |

- [ ] **Step 1: Run the simulation to see these red (AC1.1 context)**

Run: `node "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/49a4663a-06a7-4f12-92b6-0ef60a61797c/scratchpad/sim-run.js" "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/49a4663a-06a7-4f12-92b6-0ef60a61797c/scratchpad/sim-task1-before.txt"`
Expected: the output lists `writeFileAtomic: writes to a pid-suffixed tmp path…`, `writeFileAtomic: a write failure is cleaned up…`, `writeJsonFile: two calls use distinct tmp paths…`, `resolveSafe rejects escapes and accepts in-tree paths`, `readRunStateWithParent: reads through the injected reader…`. `verify/impact` does not load under the simulation (`pass=null`), and fs-backed or subprocess tests fail for harness reasons, so read only the named tests.

- [ ] **Step 2: Apply the Convert column; leave the Stays-literal column alone**

- [ ] **Step 3: Grep each of the five files for remaining POSIX absolute literals**

Run: `grep -nE "['\"\`]/[A-Za-z]" tests/bin-lib/atomic-write.test.js tests/bin-lib/json-store.test.js tests/bin-lib/verify/impact.test.js tests/bin-lib/visual-decide/server.test.js tests/hooks-context.test.js`
Expected: every hit is covered by the Stays-literal column. A hit it does not cover: read the code under test and convert if the code resolves or joins it, then report the hit.

- [ ] **Step 4: Run the simulation again (AC1.1 context)**

Run: `node "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/49a4663a-06a7-4f12-92b6-0ef60a61797c/scratchpad/sim-run.js" "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/49a4663a-06a7-4f12-92b6-0ef60a61797c/scratchpad/sim-task1-after.txt"`
Expected: none of the five named tests from Step 1 is listed. Quote this output as a simulation, never as a Windows run.

- [ ] **Step 5: Run the real suites (AC1.1, AC1.2)**

Run: `node --test tests/bin-lib/atomic-write.test.js tests/bin-lib/json-store.test.js tests/bin-lib/verify/impact.test.js tests/bin-lib/visual-decide/server.test.js tests/hooks-context.test.js`
Expected: 0 failed, 0 skipped, and counts equal to the Global Constraints base counts.

- [ ] **Step 6: Commit**

```bash
git add tests/bin-lib/atomic-write.test.js tests/bin-lib/json-store.test.js tests/bin-lib/verify/impact.test.js tests/bin-lib/visual-decide/server.test.js tests/hooks-context.test.js
git commit -m "Build library test path expectations with the code's path operation — refs #4286"
```

### Task 2: CLI fixtures and the fakes they key (three test files)

**Role:** integration

**Files:**
- Test: `tests/apply-refine-labels.test.js`
- Test: `tests/friction-events-cli.test.js`
- Test: `tests/revise-pr-summary-cli.test.js`
- Waived `plugin/bin/lib/flow/pr-checklist.js`: read only, `readRunReversals` is what `path.join`s the fake's keys.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks use.

**Rulings by file:**

| File | Convert | Stays literal, because |
|---|---|---|
| `apply-refine-labels` | define `const RUN_DIR = path.resolve('/repo/.claude-tweaks/pipelines/run-1');` and use it for every `deps.calls.appendEntry[0].runDir` expectation (the code runs `path.resolve(cwd, opts.run)`); add a `path` require if absent | the `--run` argv values; `parseArgs`'s `opts.run` expectation (no resolve in `parseArgs`); `cwd`/`mainRoot` fakes; `/tmp/*.md` comment files (passed to `gh` verbatim); `section: '/backlog'` |
| `friction-events-cli` | define `const PRIMARY = path.resolve('/run/primary');` and `const MAIN = path.resolve('/main');`. `PRIMARY` keys every fake `readEvents` and `fixtureEvents`, and every `excludeDir` and `_runDir` expectation. `findRunsByWorktreePath[0].target` for `--worktree` is `path.resolve('/wt/explicit')`. `MAIN` replaces every `'/main'` in `MAIN_CHECKOUT.repoRoot`, `cwd:`, `state.worktree`, the `repoInfo` expectation and `--worktree` argv; `repoRoot: '/Main'` becomes `path.resolve('/Main')` | `--run '/run/primary'` argv (the code resolves it, which is what the test exercises); `'/wt/current'` (`deps.cwd()` is passed through unresolved); `/run/adhoc-*`, `MINE`, `OTHER`, `FORMAL` (sibling dirs come back from the fake verbatim); `'/main/.claude/worktrees/removed'` (only compared unequal); `section: '/flow'` |
| `revise-pr-summary-cli` | define `const RD = '/rd';`, `const DECISIONS = path.join(RD, 'decisions.md');`, and spec keys `path.join(RD, 'spec-1', 'decisions.md')`, `path.join(RD, 'spec-2', 'decisions.md')`; use these as every fake-fs key and in the sorted-keys assertion `['/b.md', DECISIONS]` | `--run-dir` argv; `/b.md`, `/s.md`, `/o.md`, `/missing.md`, `/nope.md` (read and written verbatim); `/not-a-dir`; the `seen` tuple `['/rd', '/wt', '--run-dir']` (verbatim) |

- [ ] **Step 1: Run the simulation to see these red**

Run: `node "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/49a4663a-06a7-4f12-92b6-0ef60a61797c/scratchpad/sim-run.js" "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/49a4663a-06a7-4f12-92b6-0ef60a61797c/scratchpad/sim-task2-before.txt"`
Expected: lists the record's 4 `apply-refine-labels` and 5 `revise-pr-summary-cli` tests, the record's 5 `friction-events-cli` tests, and `#4704: from the main checkout with no session id, no path sibling is unioned`, `#4704: … the skipped path sibling is named on stderr…`, `#4704: repoRoot and the worktree path are compared through the same canonicalizer…`. Harness failures to ignore: `real subprocess…`, `#3641 …`, `#2016: run() filters…`, `#4704: the real CLI…`, `#4704: a miscased --worktree…`.

- [ ] **Step 2: Apply the Convert column; leave the Stays-literal column alone**

- [ ] **Step 3: Grep the three files for remaining POSIX absolute literals**

Run: `grep -nE "['\"\`]/[A-Za-z]" tests/apply-refine-labels.test.js tests/friction-events-cli.test.js tests/revise-pr-summary-cli.test.js`
Expected: every hit is covered by the Stays-literal column. A hit it does not cover: read the code under test and convert if the code resolves or joins it, then report the hit.

- [ ] **Step 4: Run the simulation again**

Run: `node "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/49a4663a-06a7-4f12-92b6-0ef60a61797c/scratchpad/sim-run.js" "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/49a4663a-06a7-4f12-92b6-0ef60a61797c/scratchpad/sim-task2-after.txt"`
Expected: only the harness failures named in Step 1 remain for these three files. Quote this output as a simulation, never as a Windows run.

- [ ] **Step 5: Run the real suites (AC1.1, AC1.2)**

Run: `node --test tests/apply-refine-labels.test.js tests/friction-events-cli.test.js tests/revise-pr-summary-cli.test.js`
Expected: 0 failed, 0 skipped, counts 36, 42 and 10 per file.

- [ ] **Step 6: Commit**

```bash
git add tests/apply-refine-labels.test.js tests/friction-events-cli.test.js tests/revise-pr-summary-cli.test.js
git commit -m "Build CLI test fixtures and fake keys with the code's path operation — refs #4286"
```

**AC2.1 and AC2.2 are run by the controller after this task, not by the implementer:** a scratch copy of `tests/` and `plugin/` (never this worktree) swaps each fake reader's key to `'/nowhere'` and runs both files on the host, expecting the union and reversal tests to fail. Evidence goes to `$PIPELINE_RUN_DIR/evidence/ac2-discrimination.txt` and one `AC evidence` entry in `decisions.md`.

**AC3.1 is run by the controller after the last code change:** `gh workflow run windows-regression.yml --ref {branch}`, read per the skill's rule (match each failing test by name against the record's list, map every other failure to its own class record).

---

## Self-review

- **Spec coverage:** every Deliverable is covered by the Convert and Stays-literal tables and the grep steps. AC1.1 and AC1.2: Step 5 of each task. AC2.1, AC2.2, AC3.1: controller steps above.
- **Placeholders:** none. Sibling beyond the record's list: three `#4704` friction tests, ruled in Task 2.
- **Probes behind the rulings:** `readRunStateWithParent`, `writeFileAtomic`, `writeJsonFile`, `gitLocations`, `resolveSafe`, `run` in all three CLIs and `readRunReversals` were read. The simulation at base reproduced every listed test except impact's, which does not load under it.
