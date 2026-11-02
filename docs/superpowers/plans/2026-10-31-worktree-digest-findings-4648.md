# Settle 3 Worktree Digest Findings (#4648) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the worktree code one shared branch-name validator, take the test-only compile check out of the shipped comment stripper, fix the stripper's stale header, and close out the claim-empty lens finding with a rationale.

**Architecture:** `isValidBranchName` moves out of `plugin/bin/lib/init/release-bootstrap.js` into a new flat module, `plugin/bin/lib/branch-name.js`. All three users require it from there, and `remote-branch-collision.js` drops its looser `isSafeBranchName`. `compiles`, `stripperVerdict` and `STRIPPER_VERDICT_MESSAGES` move from `plugin/bin/lib/strip-comments.js` (shipped) into `tests/helpers/strip-comments.js` (not shipped). The helper keeps re-exporting `stripComments`, so every test caller's import line stays the same.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T112340-record-4648/work/4648-spec.md`

**Scope keywords:** isSafeBranchName, isValidBranchName, stripperVerdict, STRIPPER_VERDICT_MESSAGES

## Global Constraints

- AC1: "Each Deliverables bullet is either fixed (with a test where behaviour changes) or closed out with a one-line rationale in the PR body."
- AC2: "Every promoted digest line in #1426 carries `→ #{this record}`."
- Release note: "No user-visible change."
- Governing skill `bin-source-scan-conformance` (verbatim): "Plugin code that needs the same scan (a code-health generator) requires the implementation directly, `require('../strip-comments')` from a `plugin/bin/lib/` subdirectory, never the test helper: `tests/` does not ship, so that require breaks in an installed build."
- Governing skill `bin-source-scan-conformance` (verbatim): "A new suite that imports the stripper is itself a caller, and two hand-written lists must name it by test-file stem: the header comment of `tests/helpers/strip-comments.js` and `parse-signal-discipline` item 15. `tests/strip-comments-callers-twin.test.js` pins both to the tree". No task here adds a stripper caller. The caller-list sentence in the helper header must keep its anchor `by test-file stem:` exactly once, and the list must end at its first `.` (the twin test parses up to that period).
- Governing skill `parse-signal-discipline` item 15 (verbatim): "State what the oracle cannot see, as the implementation's header does: a mis-parse whose stripped text still compiles passes unseen."
- Governing skill `lib-module-split` (verbatim): "Few call sites, all code, and the point is a new consumer boundary | Migrate". `isValidBranchName` has three code call sites and no skill-prose requires, so migrate them. Leave no re-export at the old path.
- Governing skill `lib-module-split` (verbatim): "Then run all four sweep shapes against the old path." The sweep was run at authoring time, and every hit outside history is listed in a task's Files block below.
- Scope and edit discipline (verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Commit style: `{Verb} {what} — {detail}`, body `refs #4648`, never `closes`/`fixes`. End each commit message with `Claude-Session: https://claude.ai/code/session_01JHXvgXbFhzLedVc73ZHFbr`.

## Review Focus

- A name with a trailing `/`, a `//` or a `.lock` suffix reaching `classifyRemoteBranch` must return `{ state: 'unreachable', reason: 'invalid-branch-name' }` without spawning git. Before this change it reached `ls-remote` (Task 1, Step 1).
- `pre-review-catchup.js --integration-branch main:refs/heads/x` and `release-bootstrap.js --branch 'a b'` must still exit 2. The existing CLI suites pin this, and both sit in Task 1's Step 4 run.
- A source-scan suite that imports `stripperVerdict` / `STRIPPER_VERDICT_MESSAGES` through the helper must get the same verdicts and message text. The existing callers and `tests/helpers-strip-comments.test.js` pin this (Task 2, Step 4).
- The code-health generators that require `../strip-comments` must still get `stripComments` (`tests/bin-lib/code-health/` suites, Task 2, Step 4).
- The shipped stripper must not require `node:vm` once the verdict moves out (Task 2, Step 1).

## Spec coverage map

| Spec item | Covered by |
|---|---|
| Deliverable 1 (claim-empty lens "3f" finding) | Task 3. Close-out rationale: the record that filed it, #3887, ships a real-git end-to-end test of `findPriorAttemptPr` plus `classifyRemoteBranch` (`tests/bin-lib/worktree/remote-branch-collision.test.js`, "AC1.1: a retry's fresh branch is foreign by ancestry but prior-attempt by PR…"). No claim survives beyond the truncated "(no real-git" fragment |
| Deliverable 2 (isValidBranchName vs isSafeBranchName) | Task 1 |
| Deliverable 3 (stripper header + test-only exports) | Task 2 |
| AC1.1 | Task 1 Step 1 and Task 2 Step 1 (behaviour-changing fixes get tests); Task 3 (D1 rationale in the PR body) |
| AC2.1 | Task 3 (evidence: the three #1426 digest lines, fingerprints `materiality-0ec21adc`, `materiality-0490401b`, `materiality-ac0a0d8e`, already end in `→ #4648`. Read back at authoring time from comments 6382411143 and 6525082273) |

---

### Task 1: One shared branch-name validator

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/branch-name.js`
- Modify: `plugin/bin/lib/init/release-bootstrap.js:266-279` (delete the comment, `INVALID_BRANCH_CHARS_RE` and `isValidBranchName`; require it from `../branch-name`; drop `isValidBranchName` from `module.exports` at line 487)
- Modify: `plugin/bin/release-bootstrap.js:12` (require `isValidBranchName` from `./lib/branch-name`)
- Modify: `plugin/bin/pre-review-catchup.js:33` (require from `./lib/branch-name`)
- Modify: `plugin/bin/lib/worktree/remote-branch-collision.js:50-59` (delete `isSafeBranchName` and its comment; line 101's guard calls `isValidBranchName` from `../branch-name`; drop the `isSafeBranchName` export at line 201)
- Modify: `docs/plugin-structure.md:204` (change "release-bootstrap.js's isValidBranchName" to "lib/branch-name.js's isValidBranchName"), and add a `plugin/bin/lib/branch-name.js` line beside the `plugin/bin/lib/strip-comments.js` line (line 76) in the same arrow format, naming `isValidBranchName` and its three callers
- Create: `tests/bin-lib/branch-name.test.js`
- Modify: `tests/bin-lib/init/release-bootstrap.test.js:190-197` (move this test into the new file, removing it here)
- Modify: `tests/bin-lib/worktree/remote-branch-collision.test.js:103-113` (and the line-8 import)

Waived plugin/skills/build/adopted-branch-collision-check.md: read only. Its `invalid-branch-name` prose (item 3: "with an empty branch means a detached `HEAD`") still holds under the stricter validator, and its line-43 lens-3f claim is Deliverable 1's close-out (Task 3).

**Interfaces:**
- Produces: `plugin/bin/lib/branch-name.js` exports `{ isValidBranchName }`, where `isValidBranchName(name: unknown) => boolean`. The function body, its `INVALID_BRANCH_CHARS_RE` constant and its 3-line "practical subset of `git check-ref-format --branch`" comment move byte-for-byte from `release-bootstrap.js:266-279`. The module requires nothing.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/branch-name.test.js`, add the existing `isValidBranchName: rejects whitespace/control chars, …(ledger row 34)` test from `release-bootstrap.test.js:190-197`, unchanged except that it requires `../../plugin/bin/lib/branch-name`. Delete it from `release-bootstrap.test.js`.

In `tests/bin-lib/worktree/remote-branch-collision.test.js`, replace the `isSafeBranchName` import with `const { isValidBranchName } = require('../../../plugin/bin/lib/branch-name');`. Then rewrite the `classifyRemoteBranch: a dash-led or malformed name never reaches git` test as:

```js
test('#4648 AC1.1: classifyRemoteBranch rejects every name isValidBranchName rejects, before git runs', () => {
  const git = () => {
    throw new Error('git must not be called');
  };
  for (const branch of ['--upload-pack=x', '', 'a b', 'a..b', undefined, 'a/', 'a//b', 'a.lock']) {
    assert.deepEqual(classifyRemoteBranch({ branch, git }), { state: 'unreachable', reason: 'invalid-branch-name' }, String(branch));
    assert.equal(isValidBranchName(branch), false, String(branch));
  }
  assert.equal(isValidBranchName('worktree-flow+spec-2704-2709'), true);
  assert.equal(isValidBranchName('flow/spec-1-2'), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/branch-name.test.js tests/bin-lib/worktree/remote-branch-collision.test.js`
Expected: FAIL after Step 1. `branch-name.test.js` fails with `Cannot find module` (`.../plugin/bin/lib/branch-name`), and the collision suite fails to load for the same reason. After Step 3 creates the module, the `'a/'` case would also fail on the old code: `isSafeBranchName` accepts it, so `ls-remote` runs and the reason is `ls-remote-failed`.

- [ ] **Step 3: Move the validator and migrate the three callers**

Create `plugin/bin/lib/branch-name.js` with a header naming its three callers: `bin/pre-review-catchup.js` (`--integration-branch`), `bin/release-bootstrap.js` plus `lib/init/release-bootstrap.js` (`--branch`, the rendered workflow), and `lib/worktree/remote-branch-collision.js` (the `refs/heads/{branch}` argument). Rewire every require listed under Files. In `remote-branch-collision.js`, keep the one-line purpose of the deleted `isSafeBranchName` comment ("a malformed name degrades to `unreachable` rather than reaching git") as a comment at the `classifyRemoteBranch` guard.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/branch-name.test.js tests/bin-lib/worktree/remote-branch-collision.test.js tests/bin-lib/init/release-bootstrap.test.js tests/bin-lib/pre-review-catchup/cli.test.js tests/pre-review-catchup-conformance.test.js tests/init-release-bootstrap-conformance.test.js tests/bin-lib/init/release-bootstrap-cli.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, 0 failures.

Run: `git grep -n -e isSafeBranchName -e "isValidBranchName.*init/release-bootstrap" -e "release-bootstrap.js's isValidBranchName" -- plugin tests docs .claude ':!docs/superpowers/plans/'`
Expected: no output (exit 1).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/branch-name.js plugin/bin/lib/init/release-bootstrap.js plugin/bin/release-bootstrap.js plugin/bin/pre-review-catchup.js plugin/bin/lib/worktree/remote-branch-collision.js docs/plugin-structure.md tests/bin-lib/branch-name.test.js tests/bin-lib/init/release-bootstrap.test.js tests/bin-lib/worktree/remote-branch-collision.test.js
git commit -m "Share one branch-name validator across worktree and release code — remote-branch-collision drops its looser isSafeBranchName"
```

### Task 2: Ship only the stripper, keep its compile oracle test-side

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/strip-comments.js:1-37` (header) and `:217-248` (delete `compiles`, `stripperVerdict`, `STRIPPER_VERDICT_MESSAGES` and the `node:vm` require; `module.exports = { stripComments }`)
- Modify: `tests/helpers/strip-comments.js` (it gains the three moved declarations, byte-for-byte, plus `require('node:vm')`; `stripComments` comes from `../../plugin/bin/lib/strip-comments`; exports `{ stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES }`)
- Modify: `tests/helpers-strip-comments.test.js:346-356` (the `#3903 AC2.1` test) and add one test
- Modify: `tests/helpers-strip-comments.test.js:325-333` (the `AC4.1: the implementation requires only node: built-ins` test). Its `assert.ok(required.length > 0)` goes red once the lib loses its only require (`node:vm`). Rewrite it so that the lib's requires deepEqual `[]` and every non-relative require of the helper starts with `node:`. Rename it `AC4.1 (#4648): the implementation requires nothing; the helper adds only node: built-ins`
- Modify: `docs/plugin-structure.md` (anchor on the text `plugin/bin/lib/strip-comments.js     →`, never a line number. Task 1 inserts a line beside it, so Task 2 runs after Task 1. The lib exports `stripComments` only; `stripperVerdict`/`STRIPPER_VERDICT_MESSAGES` are in tests/helpers/strip-comments.js)
- Modify: `.claude/skills/bin-source-scan-conformance/SKILL.md:30-38` and its lines 107 and 129 (wherever the text says the helper only re-exports, say it re-exports `stripComments` and itself defines `stripperVerdict`/`STRIPPER_VERDICT_MESSAGES`), and `:38` (a plugin caller gets no `stripperVerdict`)
- Modify: `.claude/skills/parse-signal-discipline/SKILL.md` item 15 (where it introduces `stripperVerdict` (#3573), add that it is defined in `tests/helpers/strip-comments.js`). Do not touch the caller list sentence.
- No change: `docs/journeys/act-on-a-red-path-guard-lint-3417.md`, `act-on-a-red-strip-comments-caller-pin-4008.md`, `act-on-a-red-wall-clock-budget-scan-3491.md`. Their `files:` already list both paths, and the quoted `STRIPPER_VERDICT_MESSAGES` text, which says "see tests/helpers/strip-comments.js", stays byte-identical and now points at the file that defines it.

**Interfaces:**
- Consumes: nothing from Task 1's code. It runs after Task 1 because both edit `docs/plugin-structure.md`.
- Produces: `require('plugin/bin/lib/strip-comments')` → `{ stripComments }` only. `require('tests/helpers/strip-comments')` → `{ stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES }`, where `helper.stripComments === lib.stripComments`.

- [ ] **Step 1: Write the failing tests**

In `tests/helpers-strip-comments.test.js`, rewrite the `#3903 AC2.1` test so that it asserts `helper.stripComments === lib.stripComments` (instead of `helper === lib`). Filter the helper's require specifiers to the relative ones and assert they equal `['../../plugin/bin/lib/strip-comments']`. Keep the "no second copy of the scanner" assertion. Add:

```js
test('#4648 AC1.1: the shipped stripper exports only stripComments; the compile oracle lives in the test helper', () => {
  const lib = require('../plugin/bin/lib/strip-comments');
  const helper = require('./helpers/strip-comments');
  assert.deepEqual(Object.keys(lib), ['stripComments']);
  assert.equal(typeof helper.stripperVerdict, 'function');
  assert.match(helper.STRIPPER_VERDICT_MESSAGES.misparsed, /see tests\/helpers\/strip-comments\.js$/);
  const libCode = lib.stripComments(readText(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'strip-comments.js')));
  assert.doesNotMatch(libCode, /node:vm|\bvm\.Script\b/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/helpers-strip-comments.test.js`
Expected: FAIL in `#4648 AC1.1`. `Object.keys(lib)` is `['stripComments', 'stripperVerdict', 'STRIPPER_VERDICT_MESSAGES']`.

- [ ] **Step 3: Move the oracle and rewrite the header**

Move the three declarations, and the comments directly above them, byte-for-byte into the helper below its header comment block. The header block must stay one contiguous run of `//` lines starting at line 2, because the twin test reads it that way. Then edit the helper header's "The implementation lives in …" sentence so it says the helper re-exports `stripComments` and itself defines `stripperVerdict`. Rewrite the lib header's "Known ambiguity" paragraph (lines 31-37) to state each of the following:
1. The `)`/`}` division misread, with its two examples, stays.
2. The stripper now also runs over a project's own JS/TS through the code-health generators named in the first paragraph, so no survey of plugin/bin or tests/ can rule that shape out. Delete the "No such shape exists in plugin/bin or tests/" sentence.
3. A plugin caller gets no mis-parse signal, so it must treat a scan as a heuristic.
4. The source-scan tests' backstop is `stripperVerdict` in `tests/helpers/strip-comments.js`. It catches only the compile-breaking direction. Keep the existing sentence that a misread which still compiles goes unseen, and what such a misread can do.

Update the first paragraph's "Callers reach it two ways" sentence the same way.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/helpers-strip-comments.test.js tests/strip-comments-callers-twin.test.js tests/path-guard-conformance.test.js tests/path-containment-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/git-status-optional-locks.test.js tests/wall-clock-budget-conformance.test.js tests/hooks-harness-refusal.test.js tests/bin-lib/console/backfill-cli.test.js tests/bin-lib/exit-code-conformance.test.js tests/bin-lib/code-health/candidates-experiment-cleanup.test.js tests/bin-lib/code-health/candidates-scale-readiness.test.js`
Expected: PASS, 0 failures.

Run: `git grep -n -e "No such shape exists in plugin/bin" -e "stripperVerdict\`, \`STRIPPER_VERDICT_MESSAGES\`; builtins-only" -- plugin docs .claude ':!docs/superpowers/plans/'`
Expected: no output (exit 1).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/strip-comments.js tests/helpers/strip-comments.js tests/helpers-strip-comments.test.js docs/plugin-structure.md .claude/skills/bin-source-scan-conformance/SKILL.md .claude/skills/parse-signal-discipline/SKILL.md
git commit -m "Keep the stripper's compile oracle out of the payload — stripperVerdict moves to the test helper and the header names foreign-code misreads"
```

### Task 3: Close-outs (controller, no dispatch)

**Role:** integration

**Files:**
- No repo file. Writes: `$PIPELINE_RUN_DIR/evidence/ac2-digest-pointers.txt`, one `decisions.md` `AC evidence` entry, and the PR #4697 body.

- [ ] **Step 1: Record the AC2.1 evidence**

Run `mkdir -p "$PIPELINE_RUN_DIR/evidence"`. Then redirect the output of `gh api repos/thn-inc/claude-tweaks/issues/comments/6382411143 --jq .body` and of `gh api repos/thn-inc/claude-tweaks/issues/comments/6525082273 --jq .body`, each filtered through `grep -E "materiality-(0ec21adc|0490401b|ac0a0d8e)"`, into that file. Expected: 3 lines, each ending `→ #4648`. Log one `AC evidence` entry with `log-decision.js --text-file`, naming AC2.1, the command shape, the count 3/3 and the evidence path.

- [ ] **Step 2: Put the D1 close-out rationale in the PR body**

Append a `## Close-outs` section to PR #4697's body (read the current body first and keep it intact). It holds one line per Deliverable: D1 closed with the rationale in the Spec coverage map; D2 fixed in Task 1's commit; D3 fixed in Task 2's commit.
