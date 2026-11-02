# Settle 7 below-floor digest findings in review (#4809) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the seven `review` findings promoted from digest #1426. Each is either fixed or closed out with its reason recorded on PR/record #4809.

**Architecture:** Four independent file groups, one task each, plus one orchestrator-only close-out task:
- Task 1: the skip convention and a guard test's name in one test file.
- Task 2: one Step 4.0b prose clause plus the self-test and pin for its guard.
- Task 3: one `/review` gate-table row split plus its pin.
- Task 4: a fail-closed fix to `dispatch-resume.js`'s real run-dir listing, a test against the real dependency, and the contract bullet that generalizes it.

Deliverable 5 and AC 2 are already satisfied on the base and are only recorded (Task 5).

**Tech Stack:** Node 18+ CommonJS, `node --test`, Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T024954-record-4809/work/4809-spec.md` (materialized from GitHub issue #4809)

## Global Constraints

- Commit message style: `{Verb} {what} — {detail}`, ending `refs #4809` (never `closes`/`fixes`), with the trailer `Claude-Session: https://claude.ai/code/session_01X7gPFDahTL6p9rLWhJMaoN`.
- Every inline code span in `plugin/skills/_shared/pr-first-merge-post-merge.md` Step 4.0b stays on one line, and no line ends in a bare `gh`. `tests/below-floor-parent-close-conformance.test.js`'s `brokenSpanLines` enforces this.
- Row 1 of `/review`'s Step 1.5 Gate table must keep its exact current text. `tests/review-step1-5-verifiedhead-gate.test.js:53` pins it.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Never run `git stash` in any form. Anchor with `pwd` and `git rev-parse --show-toplevel` before each commit. Both must print `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4809`.

## Review Focus

- A missing `.claude-tweaks/pipelines` directory (a fresh checkout) must still list as "no runs" (`[]`), never exit 4. Task 4 Step 1 pins it.
- A pipelines path that exists but cannot be listed (a file, or a permission error) must exit 4, never read as "no bound run". Task 4 Step 1 pins it through `run()`.
- An explicit `merge-verification: off` must not STOP `/review` on a red PR check. A derived `off` still must. Task 3 Step 1 pins both rows.
- A `Fixes other/repo#N` line in a no-PR merge commit must never be read as this repo's #N. Task 2 Step 1 pins the clause.
- A replay test skipped for an unreachable commit must report a visible skip, never a silent pass. Task 1 Step 3 shows it with a temporary probe.

---

### Task 1: Uniform visible skips and an honest guard-test name in artifact-overwrite-check.test.js (Deliverables 1, 2)

**Files:**
- Modify: `tests/bin-lib/flow/artifact-overwrite-check.test.js:372-386` (AC1 replay), `:462-474` (#2702/#2727/#2776 replay), `:721-732` (non-Origin test)
- Probe only (revert): `plugin/bin/lib/flow/artifact-overwrite-check.js:291`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks use.

- [ ] **Step 1: Convert the two bare-`return` skips.** Give both replay tests a `(t)` parameter. Replace each bare `return;` with `t.skip('{sha} not reachable in this checkout'); return;`, where `{sha}` is `b247a02d3` for the AC1 test and `80e3dad2d` for the reformat test. Each comment should say what the #4488 test's comment at :630-632 says: a visible skip, because a silent pass would read as a verified replay.
- [ ] **Step 2: Rename the non-discriminating guard test (:721).** New name: `isReferencePreservingOriginLine: a deleted body line citing no #N beside the Origin rewrite is not reference-preserving`. Add a comment explaining why it does not isolate the non-`Origin:` guard: `Body line.` is not an `Origin:` line, cites no `#N`, and the hunk adds back one `Origin:` line for two deleted. Any of those checks rejects it. The `#N`-carrying test further down (`a deleted non-Origin line carrying a #N ...`) is the one that pins the guard. Keep the fixture and assertion unchanged. First run `git grep -n "a deleted non-Origin line beside the Origin rewrite"` and update any other hit.
- [ ] **Step 3: Prove the visible skip.** Temporarily change the AC1 test's `cat-file` sha to `0000000aa` and run `node --test --test-reporter=spec tests/bin-lib/flow/artifact-overwrite-check.test.js`. Expected: that test prints as skipped (`# SKIP`/`﹣`, with the message `b247a02d3 not reachable in this checkout`). Revert the probe, then confirm it is gone with `git diff`.
- [ ] **Step 4: Mutation-prove the guard pin.** Temporarily delete `ORIGIN_LINE_RE.test(c) && ` from `plugin/bin/lib/flow/artifact-overwrite-check.js:291`. Run `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`. Expected: the `#N`-carrying test fails and the renamed test still passes, which confirms the finding. Revert, then confirm `git diff plugin/bin/lib/flow/artifact-overwrite-check.js` is empty. Quote both runs' pass/fail lines in your report.
- [ ] **Step 5: Run** `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`. Expected: PASS, 0 failures.
- [ ] **Step 6: Commit** `tests/bin-lib/flow/artifact-overwrite-check.test.js` only: `Report replay skips visibly and rename the non-discriminating Origin guard test — refs #4809`.

---

### Task 2: Same-repo clause in Step 4.0b's no-PR path and a go-red self-test for brokenSpanLines (Deliverables 3, 4)

**Review risk:** high (it narrows which `Fixes` records count toward the below-floor parent-close eligibility set)

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md:93-94`
- Test: `tests/below-floor-parent-close-conformance.test.js` (add after the `#4602 AC2.1` test that calls `brokenSpanLines`, around :947)

**Interfaces:**
- Consumes: the file-local `brokenSpanLines(text)`, `read`, `section`, `collapse`, `POST_MERGE_REL` and `STEP_40B` already defined in the test file.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the pin and the self-test**

```js
test('#4809: Step 4.0b reads only bare same-repo Fixes lines after a no-PR local merge', () => {
  const step40b = collapse(section(read(POST_MERGE_REL), STEP_40B, '### Step 4.1'));
  assert.ok(step40b.includes('a `Fixes {owner}/{repo}#{n}` line names another repository\'s record and is not in the set'));
  assert.ok(step40b.includes('`bin/lib/compose-subject.js` writes only the bare form'));
});

test('#4809: brokenSpanLines reports a wrapped span and a line-ending gh, and ignores fenced blocks', () => {
  const bad = ['ok `a` line', 'opens `a span', 'closes it` here', 'then run gh', '```', 'odd ` inside a fence', '```', 'clean'].join('\n');
  assert.deepEqual(brokenSpanLines(bad), ['opens `a span', 'closes it` here', 'then run gh']);
  assert.deepEqual(brokenSpanLines('all `fine` here\n```\n`\n```'), []);
});
```

- [ ] **Step 2: Run the pin to verify it fails**

Run: `node --test --test-name-pattern="bare same-repo Fixes" tests/below-floor-parent-close-conformance.test.js`
Expected: FAIL after Step 1. The clause is not in Step 4.0b yet.

- [ ] **Step 3: Edit the prose.** Replace `After a no-PR local merge, read the `Fixes #{n}` lines of the pushed merge commit's message,` with `After a no-PR local merge, read the bare same-repo `Fixes #{n}` lines of the pushed merge commit's message — a `Fixes {owner}/{repo}#{n}` line names another repository's record and is not in the set (`bin/lib/compose-subject.js` writes only the bare form) —`. Keep the following `taking the union across every merge commit when a call site pushes several:` line. Re-wrap so that no backtick span crosses a line break and no line ends in `gh`.
- [ ] **Step 4: Go-red the self-test.** First, temporarily delete the `if (fenced) continue;` line in `brokenSpanLines`, run the file, and confirm the self-test fails. Revert. Then temporarily delete `|| /\bgh$/.test(line)`, run, confirm it fails, and revert. Quote each failing line in your report. Confirm with `git diff` that only the two new tests remain as the test-file change.
- [ ] **Step 5: Run** `node --test tests/below-floor-parent-close-conformance.test.js`. Expected: PASS, 0 failures, including `#4602 AC2.1`.
- [ ] **Step 6: Commit** both files: `Restrict Step 4.0b's no-PR Fixes read to bare same-repo lines and self-test brokenSpanLines — refs #4809`.

---

### Task 3: Explicit `merge-verification: off` carve-out in /review's Step 1.5 Gate table (Deliverable 6)

**Review risk:** high (a STOP/proceed gate that branches on an explicit-versus-derived `off` crossed with the PR-check state)

**Files:**
- Modify: `plugin/skills/review/code-mode-steps.md:109`
- Test: `tests/review-step1-5-verifiedhead-gate.test.js` (one new test after the Gate-table test at :51)

**Interfaces:**
- Consumes: the file-local `CODE_MODE_STEPS` text constant in the test file.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the pin**

```js
test('#4809: Step 1.5 Gate table splits red on an explicit merge-verification: off, matching pr-check-gate.md', () => {
  assert.match(CODE_MODE_STEPS, /\| `pr-checks\.js` reports `red` and `merge-verification` is not an explicit `off` \(`_shared\/pr-check-gate\.md`'s `red` bullet\) \| \*\*STOP\*\*/);
  assert.match(CODE_MODE_STEPS, /\| `TEST_PASSED=true` \(pipeline\) \+ runner stamp `verifiedHead: true` \+ `pr-checks\.js` reports `red` under an explicit `merge-verification: off` \(same bullet\) \| Proceed to Step 2 — with the caveat naming the failing checks, logged as that bullet's `AUTO` line \|/);
});
```

- [ ] **Step 2: Run the pin to verify it fails**

Run: `node --test --test-name-pattern="explicit merge-verification: off" tests/review-step1-5-verifiedhead-gate.test.js`
Expected: FAIL after Step 1. The row has not been split yet.

- [ ] **Step 3: Split the row.** Change row 2's first cell to `` `pr-checks.js` reports `red` and `merge-verification` is not an explicit `off` (`_shared/pr-check-gate.md`'s `red` bullet) `` and keep its action cell unchanged. Directly below it, add a row with first cell `` `TEST_PASSED=true` (pipeline) + runner stamp `verifiedHead: true` + `pr-checks.js` reports `red` under an explicit `merge-verification: off` (same bullet) `` and action cell. The stamp conditions mirror row 1, so `verifiedHead: false` still routes to the re-trigger row. The action cell is ``Proceed to Step 2 — with the caveat naming the failing checks, logged as that bullet's `AUTO` line``. Leave row 1 untouched.
- [ ] **Step 4: Run** `node --test tests/review-step1-5-verifiedhead-gate.test.js`, then run every suite that reads this file: `git grep -l "code-mode-steps.md" -- tests`, one `node --test {file}` per hit. Expected: PASS, 0 failures.
- [ ] **Step 5: Commit** both files: `Carve explicit merge-verification off out of /review's red PR-check STOP — refs #4809`.

---

### Task 4: Fail closed on an unlistable pipelines dir in dispatch-resume, and the real-dependency test rule (Deliverable 7)

**Review risk:** high (it changes the listing behind the concurrent-resume and sibling-session detection, with an errno-based fail-closed branch)

**Files:**
- Modify: `plugin/bin/dispatch-resume.js` (the `realDeps.listRunDirsWithState` entry, around :127, plus one new helper above `realDeps`)
- Modify: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (new bullet directly after the first bullet, the one ending "where #610's one post-review high landed.")
- Test: `tests/bin-lib/dispatch/dispatch-resume-cli.test.js` ("the real wiring" section, after `the real exists dep` test)

**Interfaces:**
- Consumes: `listRunDirsWithState(cwd, opts)` from `plugin/bin/lib/hooks/context.js`. On a `readdirSync` failure of any kind, it yields nothing (`catch { return; }` at :254).
- Produces: `realDeps.listRunDirsWithState(cwd, opts) -> Array<{dir, state}>`, same shape as before. It throws when `{mainCheckoutRoot(cwd) || cwd}/.claude-tweaks/pipelines` exists but cannot be listed, and returns `[]` when that directory is absent (ENOENT).

- [ ] **Step 1: Write the failing real-dependency tests**

```js
test('the real listRunDirsWithState dep: a missing pipelines dir lists nothing, an unlistable one throws', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-dispatch-resume-'));
  try {
    assert.deepStrictEqual(realDeps.listRunDirsWithState(dir), []);
    fs.mkdirSync(path.join(dir, '.claude-tweaks'));
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'pipelines'), 'not a directory');
    assert.throws(() => realDeps.listRunDirsWithState(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verdict mode: the real run-dir listing on an unlistable pipelines dir -> exit 4, never a clean scan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-dispatch-resume-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude-tweaks'));
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'pipelines'), 'not a directory');
    const env = makeEnv();
    env.deps.listRunDirsWithState = (_cwd, opts) => realDeps.listRunDirsWithState(dir, opts);
    const r = exec(env);
    assert.equal(r.code, 4);
    assert.match(r.err, /run dir listing/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="unlistable" tests/bin-lib/dispatch/dispatch-resume-cli.test.js`
Expected: FAIL after Step 1. The shared listing swallows ENOTDIR, so the first test's `assert.throws` fails and the second exits 0 instead of 4.

- [ ] **Step 3: Implement `listRunDirsFailClosed(cwd, opts) -> Array<{dir, state}>` in `plugin/bin/dispatch-resume.js`.** Compute `base = path.join(mainCheckoutRoot(cwd) || cwd, '.claude-tweaks', 'pipelines')`, the same anchor `iterRunDirsWithState` uses. Call `fs.readdirSync(base)`. On an error with `code === 'ENOENT'`, return `[]`. On any other error, rethrow. Otherwise return `listRunDirsWithState(cwd, opts)`. Set `realDeps.listRunDirsWithState: listRunDirsFailClosed`. Confirm that `mainCheckoutRoot` in this file is the same main-checkout resolver `context.js` uses (`wtDetect.mainCheckoutRoot`). If it is not, import that one. Give the helper a two-line comment saying why it exists: the shared listing reads an unlistable dir as "no runs", which would pass the bound-run scan as clean. Do not change `plugin/bin/lib/hooks/context.js`.
- [ ] **Step 4: Sibling-check path.** `realDeps.listRunDirsWithState` also feeds `findConflictingSession`, through `listingWithPriorRun` in verdict mode and `siblingConflict(ctx, deps.listRunDirsWithState)` in `--bound-run` mode. When an in-use worktree lock matches the record and a session id is set, that function calls the listing with no catch. An unlistable pipelines dir now throws there, and `siblingConflict`'s `read('sibling-session check', …)` maps it to exit 4. That outcome is intended. dispatch-resume already exits 4 on a throwing sibling check (`a throwing sibling check -> exit 4`). Before this change, the swallowed listing emptied the own-session exclusion and reported this session's own lock as a false `live-sibling`. Add one `--bound-run` test (unlistable sibling-check path) that wires the real `findConflictingSession`, following the pattern the existing tests around :1031-1044 use: `env.deps.findSibling = (ref, opts) => findConflictingSession(ref, { ...opts, run: () => {porcelain with one locked in-use worktree matching #N} })`, with `env.deps.listRunDirsWithState` pointed at the unlistable tmp root as in Step 1. Assert `code === 4` and `err` matching `/sibling-session check/`. It must fail before Step 3. Name it so `--test-name-pattern="unlistable"` selects it too.
- [ ] **Step 4b: Run** `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js`, plus `tests/path-guard-conformance.test.js` and `tests/windows-hide-spawn-conformance.test.js`. Expected: PASS, 0 failures, including the existing `verdict mode: a failing run-dir listing -> exit 4` and `realDeps carries the production seams` tests.
- [ ] **Step 5: Add the contract bullet** to `cli-wrapper-contract.md`, directly after the first bullet. Content: a fail-closed branch around an injected dependency needs one test of the real dependency's failure shape, not only a stub that throws. A stub proves the wrapper catches a throw, not that the real dependency ever throws. Cite `plugin/bin/dispatch-resume.js`'s run-dir listing as the example: `read('run dir listing', …)` at :342 mapped a throw to exit 4, but the real `listRunDirsWithState` swallows a `readdirSync` failure into an empty listing, so the branch was unreachable. #4809 added `listRunDirsFailClosed` and the tests that drive the real dependency. Keep it to one bullet, matching the house style of the neighboring bullets: a bold lead sentence, then the incident.
- [ ] **Step 6: Commit** all three files: `Fail closed on an unlistable pipelines dir in dispatch-resume and require real-dependency failure tests — refs #4809`.

---

### Task 5: Record the close-outs (orchestrator only, no implementer)

- [ ] **Step 1:** Post one comment on issue #4809 (the record, per AC1.1's "recorded on this record"), and mirror it under a `## Close-outs` heading in draft PR #4917's body. The text:
  - Deliverable 5 (hooks-js-verb-registration covering a flag on an existing verb) is already shipped. `.claude/skills/hooks-js-verb-registration/SKILL.md`'s `## Adding a flag to an existing verb` section landed in 273a29a92 (#4677). Since 7fff4f768 (#4777), every verb is flag-strict, so "a non-flag-strict verb" no longer exists. No change needed.
  - AC 2 holds. All seven promoted entries on #1426 end `→ #4809`: comments 6536261010, 6538582537, 6541542322, 6542640259, 6545541673 and 6545562270.
  - Deliverables 1, 2, 3, 4, 6 and 7 are fixed by Tasks 1-4.

---

## Self-review

- **Spec coverage:** D1 and D2 → Task 1. D3 and D4 → Task 2. D5 → Task 5 (already shipped, verified above). D6 → Task 3. D7 → Task 4. AC1.1 (each deliverable fixed or closed out with its reason recorded) → Tasks 1-5. AC2.1 (each promoted #1426 entry carries this record's ref) → Task 5 (verified on #1426).
- **Spec-named paths left unchanged on purpose:** `.claude/skills/hooks-js-verb-registration/SKILL.md` already covers D5 (Task 5 records it). `plugin/skills/_shared/pr-check-gate.md`'s `red` bullet is already the correct rule for D6, and Task 3 brings `/review`'s table into line with it rather than editing the bullet.
Waived AC1.1: settled per deliverable by Tasks 1-4's own tests and Task 5's close-out comment on issue #4809, not by one test.
Waived AC2.1: a forge-state fact verified by reading #1426's comments (Task 5), not a repo test.
Waived .claude/skills/hooks-js-verb-registration/SKILL.md: read only. D5 is already shipped there.
Waived plugin/skills/_shared/pr-check-gate.md: read only. Its `red` bullet is the rule Task 3 aligns `/review` to.

- **Probe-only path:** `plugin/bin/lib/flow/artifact-overwrite-check.js` is touched only by Task 1 Step 4's reverted mutation. It is never committed.
- **Headroom:** `plugin/skills/review/code-mode-steps.md` is 1395 bytes under the rail. Task 3 adds about 200 bytes, so no remedy is needed.
- **Placeholders:** none. Every probe is reverted, and each task's Step lists its revert check.
- **Type consistency:** `listRunDirsFailClosed(cwd, opts)` keeps `listRunDirsWithState`'s signature and return shape. The only behavioural change for `boundRunConflict`, `listingWithPriorRun` and `findConflictingSession` is that an unlistable (not missing) pipelines dir now throws. That surfaces as exit 4, through `run dir listing` or `sibling-session check`, and Task 4 Steps 1 and 4 pin both.
