# Staged-Patch Stacked Check Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 14 minor follow-ups #3290's final review deferred on the staged-patch stacked check: robustness fixes in `stack-check.js`, a STAGED conflict line that names every conflict, a documented git floor, and tests that go red when each fix is reverted.

**Architecture:** Five small, separately reviewable changes. They cover the pure checker (`plugin/bin/lib/staged-patch/stack-check.js`), its CLI (`plugin/bin/check-staged-stack.js`), the console wiring (`plugin/bin/console-resolve.js`), and the prose contract test (`tests/staged-patch-contract.test.js`). Each test fixture is a real `git diff` captured in a throwaway repo, never a hand-typed hunk, following the convention the existing suites already use.

**Tech Stack:** Node 18+ (`node:test`, `node:assert/strict`), git CLI via `spawnSync`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T225455-record-3679/work/3679-spec.md`

Scope keywords: headerSources, isUnsafe, rederive, merge-file, checkPatchStack, readSnapshot, check-staged-stack

## Global Constraints

- `npm test` passes with no new skips.
- Every deliverable has a committed test, or a changed assertion, that fails when its fix is reverted (AC1.1). Prove each one red by reverting the fix locally before committing. Never commit the revert.
- Fixtures use `FIXTURE_ENV` (`GIT_CONFIG_GLOBAL: '/dev/null'`, `GIT_CONFIG_NOSYSTEM: '1'`) and real captured diffs, like the neighbouring tests.
- Commit messages: `{Verb} {what} — {detail}`, and reference the record only as `refs #3679` (never `closes`/`fixes`).
- Surgical: do not reformat adjacent code, and keep `checkStack`'s return shape unchanged (consumers: `check-staged-stack.js`, `console-resolve.js` via `stackVerdicts`, and the tests).

## Premise corrections (verified at authoring)

- **`git merge-file` exit codes.** The spec says "report an exit above 1 as a git error". That is wrong: merge-file exits with the **number of conflicts**, capped at 127, and with 255 (-1) on error. Probe on git 2.56.0: two conflicts exit `2`, a missing input exits `255` with `error: Could not stat nope1`. So the boundary is **status > 127 → git error, 1..127 → conflict**. #3290's ledger row 7 states it the same way ("exit 255 (a git error)").
- **The #3290 ledger no longer exists.** `docs/plans/2026-10-19-staged-patch-stacked-check-ledger.md` was deleted at #3290's wrap-up (`df3ed1d9f`). AC3.1 is therefore met in this run's own ledger (`docs/plans/2026-10-22-staged-patch-stack-check-hardening-ledger.md`), with one row per #3290 row 1-15 naming its closing test and commit (Task 6).
- **The Windows `GIT_CONFIG_GLOBAL` half is already done.** #3696 replaced `os.devNull` on win32 with `/dev/null` (`gitEnv`). Windows run 39684954538 at `679fe165` passes the three `gitEnv` pins and 22/23 of `stack-check.test.js`. The one failure, test 14 ("a content-and-mode change is not re-derived"), is a filemode fixture issue on Windows, unrelated to `GIT_CONFIG_GLOBAL`, and goes to the ledger as a follow-up. What remains is the git 2.32 floor (`GIT_CONFIG_GLOBAL` was introduced in git 2.32): document it (Task 3).

## Review Focus

- A preamble line that happens to begin `rename from ` or `copy from ` (free-text `Invariant:`/`Finding:` wording) must never make a valid patch read as unsafe. Task 1 covers this with a `checkStack` test.
- A patch written with CRLF line endings: header source names must not carry `\r`. Task 1 adds a direct `headerSources` unit test.
- A Windows-style `..\` path from numstat must be refused, not read. Task 1 covers it through the injectable git seam.
- A target that conflicts with two earlier patches, or that two later patches conflict on: the operator must see every conflict in the stderr line. Task 3 covers this with a three-patch same-anchor test.
- A console run in an unattended session: deleting the `checkPatchStack` wiring must flip a stacked conflict to a test failure, not silently go back to per-patch verdicts. Task 4 covers this end to end through `run()`.

---

### Task 1: stack-check robustness — header scan, unsafe split, merge-file error, created-by-earlier reason

**Files:**
- Modify: `plugin/bin/lib/staged-patch/stack-check.js` (`headerSources` ~L52, `isUnsafe` ~L56, `rederive` missing-file check ~L204-208, merge-file branch ~L238-239, `gitEnv` comment ~L24, `module.exports` L275)
- Test: `tests/bin-lib/staged-patch/stack-check.test.js`

**Interfaces:**
- Produces: `headerSources(text: string) -> string[]`, now exported from `stack-check.js`. Scans only from the first `^diff --git ` line, and strips a trailing `\r` from each source name. Returns `[]` when there is no `diff --git` line.
- Produces: `isUnsafe(rel)` splits on `/` **and** `\` (`rel.split(/[\\/]/)`). Not exported.
- Produces: `rederive` refusal reasons, used verbatim by Task 2/3 tests:
  - `` `${rel} is not in the worktree; an earlier staged patch, ${basename}, creates it` `` — when a target file is missing from the worktree and an earlier patch's `apply --numstat -z` paths include it (the first such patch, in apply order). Otherwise keep `` `${rel} is not a file in the worktree` ``. Move the `patches.indexOf(target)` / not-in-patches throw above the missing-file check so the earlier patches are known.
  - `` `git merge-file failed on ${rel}: ${first stderr line}` `` when merge-file status > 127. Status 1..127 keeps `` `conflict in ${rel}` ``.
- Produces: the `gitEnv` comment states that `GIT_CONFIG_GLOBAL` needs git >= 2.32. On older git the user's global config is read, and only the explicit `--src-prefix=a/ --dst-prefix=b/`, `--no-color` and `--no-ext-diff` pins still hold.

- [ ] **Step 1: Write the failing tests** (append to `stack-check.test.js`; reuse `gitFixture`, `stagedDir`, `stage`, `captureDiff`, `numstatReporting`, `gitIntercepting`, `NINE`)

```js
test('AC1.1: a preamble line reading "rename from ../x" does not skip a valid patch', (t) => {
  // stage() writes PREAMBLE + diff; write this one by hand with an extra preamble line
  // file = 'Target: f.txt\nrename from ../escape.txt\nInvariant: x\n\n' + captureDiff(t, BASE, editLine('l1','l1-edit'))
  // checkStack({worktree, patches:[p], target:p}) -> ok === true, skipped deepEqual []
});
test('AC1.1: headerSources reads sources from the diff only and strips CRLF', () => {
  // headerSources('Target: x\r\nrename from ../evil\r\n\r\ndiff --git a/a b/b\r\nsimilarity index 90%\r\nrename from a.txt\r\nrename to b.txt\r\n')
  //   deepEqual ['a.txt']
  // headerSources('no diff here\nrename from a.txt\n') deepEqual []
});
test('AC1.1: a copied path with a backslash .. segment is skipped as unsafe and never read', (t) => {
  // same shape as the existing '.. segment' test, numstatReporting('..\\escape.txt', calls)
  // skipped deepEqual [{ patch: 'unsafe.patch', error: 'unsafe path ..\\escape.txt' }]; no non-numstat apply call
});
test('AC1.1: a git merge-file error (exit 255) is reported as a git error, not a conflict', (t) => {
  // NINE fixture, r1 l2->L2, r2 l5->L5 (the re-derivable pair)
  // git = gitIntercepting((a) => a[0] === 'merge-file' ? { status: 255, stdout: '', stderr: 'error: Could not stat ours\n' } : null)
  // rederive(...) deepEqual { ok: false, reason: 'git merge-file failed on f.txt: error: Could not stat ours' }
});
test('AC1.1: rederive names the earlier staged patch that creates a missing target file', (t) => {
  // worktree: gitFixture(t) (f.txt only)
  // create-1.patch: a fixture where g.txt 'one\n' is added with `add -N` then `git diff` (as the existing create-mode test does)
  // modify-2.patch: a fixture with f.txt + committed g.txt 'one\n', g.txt -> 'one more\n', `git diff`
  // rederive({ patches: [create, modify], target: modify })
  //   deepEqual { ok: false, reason: 'g.txt is not in the worktree; an earlier staged patch, create-1.patch, creates it' }
});
```

The modify fixture needs a second committed file, so add a local helper `repoWith(t, files)` that commits a `{name: content}` map. Use it only in these new tests and in Task 2's, and leave `gitFixture` unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/staged-patch/stack-check.test.js`
Expected: FAIL after Step 1. The 5 new tests fail (`headerSources` is not exported, the preamble patch is skipped as unsafe, the backslash path is not skipped, the reason reads `conflict in f.txt`, and the reason reads `g.txt is not a file in the worktree`). Every pre-existing test passes.

- [ ] **Step 3: Implement the four fixes and the `gitEnv` comment in `stack-check.js`** per the Interfaces block. Export `headerSources`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/staged-patch/`
Expected: PASS, 0 fail.

- [ ] **Step 5: Prove each new test red by reverting its fix** (one fix at a time, run the file, restore). Record which test went red for each fix in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/staged-patch/stack-check.js tests/bin-lib/staged-patch/stack-check.test.js
git commit -m "Harden the staged-patch stack walk — diff-only header scan, backslash unsafe paths, merge-file errors, created-by-earlier reason, refs #3679"
```

### Task 2: stack-check coverage — rename/new/delete/binary, rederive branches, readSnapshot order

**Files:**
- Test: `tests/bin-lib/staged-patch/stack-check.test.js`

**Interfaces:**
- Consumes: Task 1's `repoWith(t, files)` helper and its refusal reason strings. Also `readSnapshot({ runDir, deps })` from `plugin/bin/lib/console/resolve.js` (already exported; with `deps.checkPatchStack` set it calls it once with the `.patch` paths in apply order).

- [ ] **Step 1: Write the tests.** Each one is green on the Task 1 code, and each names the revert that turns it red.

```js
// Patch kinds (AC1.1)
test('AC1.1: a rename-with-content-change patch stacks cleanly (source copied from the header)', ...)
  // fixture: git mv f.txt h.txt, edit h.txt l5->L5, git add -A, `git diff --cached -M`; worktree NINE f.txt
  // checkStack -> ok true, skipped [] . Red when headerSources returns [] (source never copied).
test('AC1.1: two patches creating the same new file conflict, naming both', ...)
  // new-1.patch g.txt 'one\n', new-2.patch g.txt 'two\n' (add -N + git diff each)
  // targetConflict deepEqual { patch: 'new-2.patch', conflictsWith: 'new-1.patch', error: matches /already exists/ }
test('AC1.1: an edit stacked on a patch that deletes the file conflicts with the deleter', ...)
  // review-1.patch: git rm f.txt, `git diff --cached`; review-2.patch: NINE l5->L5
  // targetConflict.patch 'review-2.patch', conflictsWith 'review-1.patch'
test('AC1.1: a full-index binary patch applies; a binary diff without --binary is skipped with git\'s error', ...)
  // repoWith {'f.txt': NINE, 'bin.dat': Buffer [0,1,2,3,255,0,7]}, edit to [0,1,9,3,255,0,7,8]
  // `git diff --binary` -> ok true; plain `git diff` -> skipped[0].error matches /without full index line/

// rederive branches (AC1.1)
test('AC1.1: rederive reports a target already satisfied by an earlier patch', ...)
  // r1 and r2 both NINE l2->L2 -> { ok: false, reason: 'already satisfied by an earlier patch' }
test('AC1.1: rederive refuses an unsafe copied path', ...)
  // numstatReporting('../escape.txt', []) on a NINE l5 patch -> { ok: false, reason: 'unsafe path ../escape.txt' }
test('AC1.1: rederive throws when the target is not in patches', ...)
  // assert.throws(() => rederive({ patches: [r1], target: r2 }), /is not in patches/)
test('AC1.1: a multi-file target reports the file that conflicts, not the one that merged', ...)
  // repoWith {'f.txt': NINE, 'g.txt': NINE}; r1: f.txt l2->L2 AND g.txt l5->P5; r2: f.txt l5->L5 AND g.txt l5->T5
  // rederive(r2) deepEqual { ok: false, reason: 'conflict in g.txt' }
test('AC1.1: rederive refuses a rename and a delete as non-modification hunks', ...)
  // the rename and delete patches above -> each deepEqual { ok: false, reason: 'non-modification hunk' }
test('AC1.1: a numstat or summary failure is reported with git\'s first line', ...)
  // gitIntercepting: a[1] === '--summary' -> { status: 1, stderr: 'error: corrupt patch at line 9\n' }
  //   -> { ok: false, reason: 'error: corrupt patch at line 9' }; same for '--numstat' (summary real)

// order agreement (AC1.1)
test('M4: stagedApplyOrder agrees with the order readSnapshot hands the stacked check', ...)
  // runDir tmp with staged/ holding names ['review-2.patch','.hidden.patch','x.md','review-10.patch','.review-0.patch','review-2.patch.shadow-dup'] (any content) and an empty decisions.md
  // seen = []; readSnapshot({ runDir, deps: { readFile, readdir, gitApplyCheck: () => ({ok:true}), readGrants: () => ({}), checkPatchStack: (paths) => { seen.push(paths.map(basename)); return {}; } } })
  // deepEqual seen[0] === stagedApplyOrder(names) === ['review-10.patch', 'review-2.patch']
```

Replace the existing `M4: stagedApplyOrder drops dotfiles and equals the .patch subsequence…` test, which mirrors the filter and sort, with the `readSnapshot` test above. Also change the existing `AC1.1: same-anchor insertions are not re-derived` assertion from `assert.match(r.reason, /conflict/)` to `assert.deepEqual(r, { ok: false, reason: 'conflict in f.txt' })`.

- [ ] **Step 2: Run them**

Run: `node --test tests/bin-lib/staged-patch/stack-check.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 3: Prove discrimination.** Revert `headerSources` to `return []` → the rename test is red. Make `readSnapshot`'s sort descending in a local scratch edit → the order test is red. Make the merge-file branch report every non-zero status as `conflict in ${rel}` → the multi-file test still passes (a real conflict), so it pins the file name, not the boundary. Restore every scratch edit. Quote the red output lines in the report.

- [ ] **Step 4: Commit**

```bash
git add tests/bin-lib/staged-patch/stack-check.test.js
git commit -m "Cover the stacked check on rename, create, delete and binary patches and every rederive refusal — refs #3679"
```

### Task 3: CLI — every conflict on the stderr line, rederiveReason branches, shadow refusal, docs

**Files:**
- Modify: `plugin/bin/check-staged-stack.js:158-162` (stderr conflict line) and its header comment line 8 ("one stderr line naming every conflict that involves --patch")
- Modify: `docs/plugin-structure.md:39` and `:176`
- Modify: `docs/journeys/stage-a-patch-that-conflicts-with-an-earlier-one-3290.md:28` (step 2's Action: when more than one conflict involves `--patch`, the same line carries each one, joined by `; `)
- Test: `tests/bin-lib/staged-patch/cli.test.js`

**Interfaces:**
- Produces: the exit-1 stderr line stays **one line**, and starts exactly as today with `targetConflict`. It names every conflict in `result.conflicts` whose `patch` or `conflictsWith` is the target, in walk order, joined with `; `:
  `check-staged-stack.js: staged/{p} does not apply on top of staged/{q} in apply order ({error}); staged/{p2} does not apply on top of staged/{q2} in apply order ({error2})\n`. JSON payload unchanged.
- Produces (docs, line 176): after "exit 2 malformed invocation or --patch does not apply at its position nor alone", add "(the latter still prints the JSON line on stdout)". Change "one stderr line naming both staged/ paths" to "one stderr line naming every conflict that involves --patch". Line 39: append "; needs git >= 2.32 (GIT_CONFIG_GLOBAL) — on older git the user's global config is read, and only the a/ b/ prefix, --no-color and --no-ext-diff pins hold".

- [ ] **Step 1: Write the failing tests** (append to `cli.test.js`)

```js
test('AC1.1: the exit-1 stderr line names every conflict that involves --patch', (t) => {
  // three same-anchor patches review-1/2/3 (insertAboveAnchor new1/new2/new3); --patch review-1
  // exit 1; stderr is ONE line; it matches /staged\/review-2\.patch does not apply on top of staged\/review-1\.patch/
  //   and /staged\/review-3\.patch does not apply on top of staged\/review-1\.patch/
});
test('AC1.1: rederive refusal lands in rederiveReason and keeps exit 1', ...)
  // same-anchor pair, --patch review-2 --rederive-out <main>/x.patch -> exit 1, rederived null,
  //   rederiveReason 'conflict in f.txt', out file absent
test('AC1.1: a rederive that throws lands in rederiveReason as could not run', ...)
  // NINE re-derivable pair; deps.git = real git except merge-file -> { status: null, stdout: '', stderr: '' }
  // exit 1; rederiveReason matches /^could not run: git merge-file .* did not complete/
test('AC1.1: --rederive-out on a non-conflicting --patch writes nothing and reports no reason', ...)
  // clean pair (l1, a3), --rederive-out <main>/x.patch -> exit 0, rederived null, rederiveReason null, file absent
test('AC1.1: when --patch is the earlier side of the conflict no rederive is attempted', ...)
  // same-anchor pair, --patch review-1 with --rederive-out -> exit 1, targetConflict.conflictsWith 'review-1.patch',
  //   rederived null, rederiveReason null, file absent
test('AC1.1: docs/plugin-structure.md states exit 2 still prints the JSON line and the git 2.32 floor', ...)
  // read docs/plugin-structure.md; the check-staged-stack.js line matches /exit 2 [^,]*still prints the JSON line/
  // the plugin/bin/lib/staged-patch/ line includes 'git >= 2.32'
```

Replace the shadow test's vacuous `existsSync(fx.shadow/staged/review-1.patch)` assertion. The new version stages the re-derivable NINE pair (`l2`→`L2`, `l5`→`L5`) **inside the shadow's** `staged/` and passes `--rederive-out` into `path.join(fx.shadow, 'rederived.patch')`. It then asserts exit 3, `out.join('') === ''`, and `fs.existsSync(path.join(fx.shadow, 'rederived.patch')) === false`. Name it `AC1.1: a --patch under a worktree-shadow run dir is refused (exit 3) and writes neither JSON nor the rederive file`. The shadow fixture's worktree must hold NINE, so call `fixture(t, NINE)`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/staged-patch/cli.test.js`
Expected: FAIL after Step 1. Only the every-conflict test and the docs test fail; the rederiveReason tests pin current behaviour and pass. The shadow test passes on current code; prove it red in Step 5.

- [ ] **Step 3: Implement** the stderr line and the two docs edits per the Interfaces block.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/staged-patch/`
Expected: PASS, 0 fail.

- [ ] **Step 5: Prove discrimination.** Temporarily make `run()` skip the `resolveTarget` refusal (return-3 branch). The new shadow test must go red, because the JSON prints and `rederived.patch` gets written. Temporarily revert the stderr line to `targetConflict` only, and the every-conflict test must go red. Restore both.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/check-staged-stack.js docs/plugin-structure.md docs/journeys/stage-a-patch-that-conflicts-with-an-earlier-one-3290.md tests/bin-lib/staged-patch/cli.test.js
git commit -m "Name every conflict on the stacked-check stderr line and cover each rederiveReason branch — refs #3679"
```

### Task 4: console-resolve — test the checkPatchStack wiring and its fail-closed throw

**Files:**
- Modify: `plugin/bin/console-resolve.js:257` (export `checkPatchStack`)
- Test: `tests/bin-lib/console/cli.test.js`

**Interfaces:**
- Produces: `checkPatchStack(worktree: string) -> (paths: string[]) -> {[basename]: {ok: true} | {ok: false, error: string}}`, exported from `console-resolve.js` (body unchanged).

- [ ] **Step 1: Write the tests**

```js
test('AC1.1: run() wires the stacked check — a same-anchor pair the per-patch check passes resolves the second to stale (#3290)', async () => {
  // mainCheckoutWithRun({ staged: { 'review-1.patch': P1, 'review-2.patch': P2 } }) where P1/P2 are
  //   'Target: f.txt\nInvariant: x\nFinding: low x — y\nStaged-at: abc\n\n' + a real captured same-anchor diff of f.txt (BASE as in stack-check.test.js);
  //   write f.txt = BASE into fx.root (the worktree checkPatchStack(cwd()) reads)
  // fakeExec answers `git apply` (the solo check) with '' -> solo ok for both
  // await run(['--run', fx.runDir, '--policy', 'console-auto'], d) === 0
  // console.json items: review-1.patch resolution 'apply', review-2.patch resolution 'stale'
});
test('AC1.1: checkPatchStack fails closed when the walk cannot run', () => {
  // const v = checkPatchStack(path.join(os.tmpdir(), 'no-such-worktree-3679'))(['/x/staged/a.patch', '/x/staged/b.patch'])
  // deepEqual keys ['a.patch','b.patch']; each ok false, error matches /^stacked check could not run: /
  // checkPatchStack(anything)([]) deepEqual {}
});
```

- [ ] **Step 2: Run**

Run: `node --test tests/bin-lib/console/cli.test.js`
Expected: the throw test FAILs until `checkPatchStack` is exported. The wiring test passes.

- [ ] **Step 3: Export `checkPatchStack`.**

- [ ] **Step 4: Run** `node --test tests/bin-lib/console/cli.test.js`. Expected: PASS, 0 fail.

- [ ] **Step 5: Prove discrimination.** Delete the `checkPatchStack: checkPatchStack(cwd()),` line, and the wiring test must go red (review-2 resolves `apply`). Make the catch rethrow, and the throw test must go red. Restore both.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/console-resolve.js tests/bin-lib/console/cli.test.js
git commit -m "Pin console-resolve's stacked-check wiring and its fail-closed branch — refs #3679"
```

### Task 5: staged-patch contract test — a go-red control per assertion, plus the re-run and re-anchor pins

**Files:**
- Test: `tests/staged-patch-contract.test.js:243-285` (`assertStackedGate` and its single go-red control)

**Interfaces:**
- Produces: `assertStackedGate(text)`. Every assertion carries a unique message string, and the controls key on those strings.

- [ ] **Step 1: Rework `assertStackedGate`.**
  - (a) Replace `assert.ok(gate.includes('apply order'), 'gate slice uses apply order')`. That line matches the STAGED log template incidentally. The replacement asserts that the single `**Apply order.**` paragraph lies inside the gate's `### Stacked check` subsection (`orderStart` between the subsection start and `CONSOLE_HEADING`), with message `'the Apply order paragraph lives in the gate\'s Stacked check subsection'`.
  - (b) Add the re-run-once pin. The exit-1-with-`rederived` bullet (`- **exit 1 with \`rederived\`**`) must contain `re-run only the` + `stacked check, once` and `never re-derives again` (whitespace-normalized), with message `'exit-1-rederived bullet bounds the re-run to once'`.
  - (c) Add the re-anchor pin. The exit-1-null bullet must contain ``Re-anchor only when `targetConflict.patch` is this patch and the edit admits another anchor`` and `re-run both checks once`, with message `'exit-1-null bullet states the re-anchor condition'`.
  - Keep every other assertion, and give any assertion that lacks a message a unique one.

- [ ] **Step 2: Replace the single go-red control with a table-driven control per assertion.** Each row is `[name, mutate(text) -> text, messageRegex]`. Each control asserts `assert.throws(() => assertStackedGate(mutate(readText(CONTRACT))), { message: messageRegex })`. Every mutation edits only the slice its assertion reads, so earlier assertions still pass and the named one is the one that fires. Rows:
  1. Delete the `### Stacked check` heading line → `/gate names the Stacked check subsection/`
  2. In the gate slice only, replace `bin/check-staged-stack.js` with `bin/x.js` → `/gate names the stacked-check CLI/`
  3. In the gate slice, remove `--rederive-out` → `/gate passes --rederive-out/`
  4. In the gate slice, replace `staged/{targetConflict.conflictsWith}` with `staged/{x}` → `/conflict STAGED line names both patches/`
  5. In the exit-0 bullet, replace `nothing else` with `more` → `/exit-0 bullet says normal entry and nothing else/`
  6. Append a second `**Apply order.** x` paragraph at EOF → `/exactly one Apply order paragraph/`
  7. In the Apply order paragraph, replace `byte-wise` with `natural` → `/names the byte-wise sort/`
  8. In the Apply order paragraph, replace `bin/lib/console/resolve.js` with `bin/x.js` → `/names the console resolver/`
  9. Move the Apply order paragraph to EOF → `/lives in the gate's Stacked check subsection/`
  10. In the console slice, replace `apply order` with `listed order` → `/console apply slice uses apply order/`
  11. Insert `in the order the console lists them` into the console slice → `/no longer uses the console display order/`
  12. In the exit-1-rederived bullet, replace `stacked check, once` with `stacked check` → `/bounds the re-run to once/`
  13. In the same bullet, remove `never re-derives again` → `/bounds the re-run to once/`
  14. In the exit-1-null bullet, replace `admits another anchor` with `allows it` → `/states the re-anchor condition/`
  15. In the same bullet, replace `re-run both checks once` with `re-run both checks` → `/states the re-anchor condition/`

  Read the exact substrings from `plugin/skills/_shared/staged-patch.md` lines 108-145 before writing each mutation. Assert inside each control that the mutation changed the text (`assert.notEqual(mutated, text)`), so a substring that no longer matches can never yield a control that passes vacuously.

- [ ] **Step 3: Run**

Run: `node --test tests/staged-patch-contract.test.js`
Expected: PASS, 0 fail. The positive test still passes on the live contract, and every control throws with its own message.

- [ ] **Step 4: Prove discrimination for the new pins.** Temporarily edit `staged-patch.md` to drop `, once` from the exit-1-rederived bullet; the positive test must fail. Restore it.

- [ ] **Step 5: Commit**

```bash
git add tests/staged-patch-contract.test.js
git commit -m "Give each staged-patch stacked-gate assertion its own go-red control and pin the re-run and re-anchor bounds — refs #3679"
```

### Task 6 (controller): map #3290 ledger rows 1-15 to their closing tests

**Files:**
- Modify: `docs/plans/2026-10-22-staged-patch-stack-check-hardening-ledger.md`

- [ ] **Step 1:** Add one `build` row per #3290 ledger row 1-15 (the text is in `git show df3ed1d9f^:docs/plans/2026-10-19-staged-patch-stacked-check-ledger.md`), status `fixed`. Each Resolution names the closing test name(s) and the Task 1-5 commit sha. Row 6 also cites #3696 and Windows run 39684954538. Row 11's "byte-wise vs JS UTF-16 sort" sub-item resolves as no effect, because staged names are ASCII slugs (`stagedApplyOrder`'s M4 order test pins the ASCII order). Add one `open` row for the Windows-only failure of `a content-and-mode change is not re-derived`: on a `core.fileMode=false` checkout the fixture's diff carries no mode line, so the patch re-derives (run 39684954538). It is out of scope here.
- [ ] **Step 2:** Commit the ledger by explicit path: `git commit -m "Map #3290's deferred ledger rows to their closing tests — refs #3679" -- docs/plans/2026-10-22-staged-patch-stack-check-hardening-ledger.md`

Waived AC2.1: `npm test` passing with no new skips is verified centrally at Common Step 5 (verify.js), not by a task test.
Waived AC3.1: a ledger write the controller does in Task 6, checked by reading the ledger, not by a test.
