# teardown-run Never Archives — Section C Step 5 Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/wrap-up` Section C step 5's `teardown-run` call from archiving the run directory before cleanup items 6 and 7 run. Settle the polarity question for good: `teardown-run` stops archiving at all.

**Architecture:** The decision this plan takes (Deliverable 3) is to flip `teardown-run`'s default. Archival leaves the verb entirely, and `hooks.js archive-run` (cleanup item 8, Section B) plus the reconciler become the only archival paths. Both of them enforce #1130's console-unresolved gate. `teardown-run`'s old `archiveRunDir` call bypasses that gate, so a second defect closes with the flip. `--remote-ref-only` stays an accepted flag that now does nothing, with a two-step removal condition recorded beside `KNOWN_FLAGS`. The three skill-prose callers keep passing it during the transition, and Section C step 5 gains it (Deliverable 1 / AC1).

**Tech Stack:** Node 18+ CommonJS (`plugin/bin/`), `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T185807-record-3490/work/3490-spec.md` (record #3490)

**Scope keywords:** teardown-run, remote-ref-only, remoteRefOnly

## Global Constraints

- Section C step 5's `teardown-run` call passes `--remote-ref-only` (AC1.1).
- A conformance test pins that choice and fails when the flag or the stated reason is removed (AC2.1).
- `npm test` passes with no new attributable failures (AC3.1).
- Expand-contract: `--remote-ref-only` stays in `KNOWN_FLAGS`/`USAGE` (the unknown-flag guard would otherwise refuse a call from older prose held in a session's context) and gets a recorded removal condition phrased against the running build (`[IL-133]`), never the install pointer.
- `teardown-run` keeps its never-non-zero-exit, try/skip/report posture (`docs/hooks.md`).
- Commit style: `{Verb} {what} — {detail}`, body `refs #3490` (never `closes`/`fixes`).

## Decision record (Deliverable 3)

Caller audit (`git grep -n "teardown-run\|teardownRun" -- plugin tests docs .claude/skills`):
- Code callers of `teardownRun`: `plugin/bin/hooks.js` only.
- Skill-prose callers: `cleanup-procedures-execution.md` Section C step 5 (no flag today, the defect), step 5.5 (`--remote-ref-only`), `flow/multispec-review-console.md` Shared teardown step 7 (`--remote-ref-only`).
- Docs: `docs/journeys/recover-a-teardown-with-no-recorded-worktree.md` quotes the `--remote-ref-only` archive-skip output line. Its Success state does not promise archival. `docs/journeys/trust-a-post-merge-cleanup-verdict-3023.md` runs `teardown-run` against an already-archived run dir, so it is unaffected.
- No caller wants `teardown-run` to archive. A human who runs it by hand and expected archival now gets a run dir that is left in place, with an output line naming `archive-run`. Under `pr-first` the reconciler's merged-run archival still converges it. That is a recoverable degrade. The opposite polarity is the failure this record exists for: archiving too early silently strands items 6 and 7.

Removal condition for `--remote-ref-only`, recorded verbatim in `plugin/bin/hooks.js` beside `KNOWN_FLAGS['teardown-run']`:

> `--remote-ref-only` (#3088) has been inert since #3490, because teardown-run never archives. Remove it in two releases. (1) Drop it from the three skill-prose call sites (`wrap-up/cleanup-procedures-execution.md` Section C steps 5 and 5.5, `flow/multispec-review-console.md` Shared teardown step 7) and from their pins in `tests/scratch-worktree-remote-branch-delete.test.js`, in any release after the one that ships #3490. (2) Only in a release after (1) has shipped, remove it from `KNOWN_FLAGS` and `USAGE` here. Until then a session can still hold pre-(1) prose in context while the running build's hooks.js is newer, and the unknown-flag guard would refuse that call.

## Review Focus

1. A hand-run `teardown-run --merged --remote-ref-only` from the CLI must still be accepted, not refused as an unknown flag. Pinned by Task 1's CLI test.
2. A plain `teardown-run --merged` with no flag (old muscle memory, or a future prose caller that forgets it) must leave the run dir in place. Pinned by Task 1's AC1 rewrite.
3. A locked worktree must still not abort the remaining steps after archival leaves the verb. Pinned by Task 1's AC2 rewrite (`state: closed` + branch/ref lines still present).
4. An already-archived `--run` path (AC7, #1323) must still resolve root and report `archive: skipped —`. That is unchanged and covered by the existing AC7.
5. Prose that still claims `teardown-run` archives, or that `--remote-ref-only` "skips its archival step". Swept by Task 2's grep step.

---

### Task 1: `teardown-run` never archives; `--remote-ref-only` accepted but inert

**Files:**
- Modify: `plugin/bin/lib/hooks/teardown-run.js` (header comment lines 1-12; lines 130-133 comment; 191-194 comment; Step 2 block lines 234-250; drop the `archiveRunDir` require on line 17)
- Modify: `plugin/bin/hooks.js` (line 143 `KNOWN_FLAGS['teardown-run']` comment; lines 1114-1115 stop reading/threading `remoteRefOnly`)
- Modify: `docs/journeys/recover-a-teardown-with-no-recorded-worktree.md` (Step 3 own-worktree bullet's quoted output line; one Origin line)
- Test: `tests/hooks-teardown-run.test.js` (AC1, AC2, AC17 rewritten; one new CLI test)

**Interfaces:**
- Consumes: none.
- Produces: `teardownRun(runDir, opts)`. Its signature is unchanged, but `opts.remoteRefOnly` is no longer read. Step 2 always emits exactly this line: `archive: skipped — teardown-run does not archive (archival is the caller's own last cleanup step: hooks.js archive-run)`. Task 2's prose quotes that text.

- [ ] **Step 1: Rewrite the tests**

In `tests/hooks-teardown-run.test.js`:
- Rename AC1 to `'AC1 (#3490): a merged run with an unlocked worktree closes state, removes the worktree, deletes branch and remote ref — and never archives the run dir'`. Replace its `/archive: moved to archive/` assertion with `/archive: skipped — teardown-run does not archive/`. Replace the archive-dir existence assertion and `!fs.existsSync(runDir)` with `assert.ok(fs.existsSync(path.join(runDir, 'decisions.md')))` and `assert.ok(!fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)))`. Keep the worktree/branch/ref assertions.
- Rename AC2 to `'AC2: a locked worktree skips step 3 (skipped — worktree locked), never throws, and does not block the remaining steps'`. Replace `/archive: moved to archive/` with `/state: closed/` and `/branch: skipped — no --merged\/--abandoned given/`.
- Rename AC17 to `'AC17 (#3088, #3490): --remote-ref-only is still accepted (inert) and the remote-ref delete still runs, leaving the run directory in place'`. Change its regex to `/archive: skipped — teardown-run does not archive/`.
- Add `'#3490: the CLI still accepts --remote-ref-only (never refused as an unknown flag) and never archives'`. Build `fixtureRepo()`, `writeRunState(runDir, { status: 'active', worktree: wt, sessionId: 'me' })`, and run `execFileSync(process.execPath, [path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js'), 'teardown-run', '--run', runDir, '--abandoned', '--remote-ref-only'], { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'me' } })`. `--abandoned` keeps the gh seam unreached. Assert the stdout matches `/claude-tweaks: teardown-run 2026-08-01T090000-spec-9/` and `/archive: skipped — teardown-run does not archive/`, does not match `/unknown flag/i`, and that `fs.existsSync(path.join(runDir, 'decisions.md'))`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/hooks-teardown-run.test.js`
Expected: FAIL. AC1, AC2, AC17 and the new CLI test fail, because `archive: moved to archive` and `archive: skipped — --remote-ref-only` are still emitted.

- [ ] **Step 3: Implement**

In `teardown-run.js`, replace the Step 2 `if (opts.remoteRefOnly) … else { archiveRunDir … }` block with the single unconditional `lines.push(...)` named in Interfaces. Drop the `archiveRunDir` require. Update the header comment to four composed mechanics (state, worktree removal, local branch delete, remote ref delete). Add one sentence: archival left this verb in #3490 and is `archive-run`'s job, the path that enforces #1130's console gate. Reword the two stale comments (130-133: "before Step 1 flips run-state.json"; drop the "BEFORE Step 2 archives it" clause; 191-194: `notYetArchived` stays unread because Step 2's own line already names `archive-run`). In `hooks.js`, delete the `const remoteRefOnly = …` line, stop passing `remoteRefOnly` to `teardownRun`, and add the Decision record's removal-condition comment verbatim above `'teardown-run': [...]` in `KNOWN_FLAGS`. `USAGE` keeps `[--remote-ref-only]`. Update the journey's quoted output line to the new text. Change "`--remote-ref-only` suppresses only the archival step" to "`teardown-run` never archives (#3490; `--remote-ref-only` is kept, inert, for the transition)". Add Origin line `- Updated during build of #3490: teardown-run no longer archives at all; the archive-skip line now reads "teardown-run does not archive".`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-teardown-run.test.js tests/hooks-dispatcher.test.js tests/hooks-help-guard.test.js tests/hooks-worktree-local-fallback-disclosure.test.js tests/path-guard-conformance.test.js`
Expected: PASS (all tests, 0 fail).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/teardown-run.js plugin/bin/hooks.js tests/hooks-teardown-run.test.js docs/journeys/recover-a-teardown-with-no-recorded-worktree.md
git commit -m "Stop teardown-run archiving the run dir — archival is archive-run's job; --remote-ref-only kept inert with a removal condition" -m "refs #3490"
```

### Task 2: Section C step 5 passes `--remote-ref-only`; prose states teardown-run never archives

**Files:**
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md` (Section C step 5 lines 260-278; step 5.5 lines 293-294). 41,486 B against the 52,500 B rail: about 11 KB of headroom, and this task's net growth is under 300 B.
- Modify: `plugin/skills/flow/multispec-review-console.md` ("When to run" step 6, line 38; Shared teardown step 7, line 207). 47,936 B, about 4.5 KB of headroom; the net change is about 0 B.
- Test: `tests/scratch-worktree-remote-branch-delete.test.js` (two new tests)

**Interfaces:**
- Consumes: Task 1's Step 2 output line text (quoted in prose only where already quoted).
- Produces: none.

- [ ] **Step 1: Write the failing tests**

In `tests/scratch-worktree-remote-branch-delete.test.js`, add a helper `function assertStep5KeepsArchivalLast(text)`. It slices `text` from `'5. **Steps 5-6, subsumed into one call.**'` to `'5.5. **Own-worktree remote-branch delete'`, asserts both anchors exist in order, and then asserts:
- `assert.match(step5, /teardown-run --run "\$RUN_DIR"[\s\\]*--merged --remote-ref-only/)`
- `assert.match(step5, /never archives the\s+run directory/)`
- `assert.match(step5, /items 6 and 7/)`
- `assert.doesNotMatch(step5, /idempotent if Section B already archived/)`

Then add two tests:
- `test('AC1.1 / AC2.1 (#3490): Section C step 5 passes --remote-ref-only and states why archival stays last', () => assertStep5KeepsArchivalLast(CLEANUP_PROCEDURES_EXECUTION))`
- `test('AC2.1 go-red control (#3490): the step 5 pin fails when the flag or the stated reason is removed', …)`. It builds `noFlag` by replacing, inside the step 5 slice only, every ` --remote-ref-only` with `''`. It builds `noReason` by replacing `/never archives the\s+run directory/` with `'archives the run directory'`. Both are spliced back into the full text, and the test asserts `assert.throws(() => assertStep5KeepsArchivalLast(noFlag))` and `assert.throws(() => assertStep5KeepsArchivalLast(noReason))`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scratch-worktree-remote-branch-delete.test.js`
Expected: FAIL. The AC1.1 test fails on the `--merged --remote-ref-only` match, because step 5's command has no flag today.

- [ ] **Step 3: Edit the prose**

Section C step 5's command becomes `teardown-run --run "$RUN_DIR" \` / `--merged --remote-ref-only  # or --abandoned --remote-ref-only when the branch was discarded, not merged`. Replace "One command performs archival (idempotent if Section B already archived this run — a second pass is a harmless no-op), worktree removal" with "One command performs worktree removal". After the "replacing what used to be 4-5 hand-assembled commands per run." sentence, add: "It never archives the run directory (#3490): Sections D and E (items 6 and 7) still read files under `$RUN_DIR` after this step, so archival stays Section B's job alone, last (item 8, `cleanup-procedures.md`'s Ordering rule). `teardown-run` stopped archiving altogether in #3490; `--remote-ref-only` says so at the call site and stays, inert, for the transition (removal condition: `bin/hooks.js`'s `KNOWN_FLAGS` comment)." In step 5.5, change "`--remote-ref-only` skips archival (Step 2) only — the run directory stays" to "`teardown-run` never archives (#3490), so the run directory stays". In `multispec-review-console.md` line 38, change "passes `--remote-ref-only` so it never archives" to "never archives (#3490; it passes `--remote-ref-only`, the inert explicit form)". On line 207, change "`--remote-ref-only` skips its archival step (the same narrowing `cleanup-procedures-execution.md` Section C step 5.5 uses)" to "`teardown-run` never archives (#3490; `--remote-ref-only`, as in `cleanup-procedures-execution.md` Section C steps 5 and 5.5, states it explicitly)".

- [ ] **Step 4: Sweep and run**

Run: `git grep -n -F "skips its archival step" -- plugin docs; git grep -n -F "skips archival (Step 2)" -- plugin docs; git grep -n -F "idempotent if Section B" -- plugin docs` (separate calls)
Expected: no output from any of the three.
Run: `node --test tests/scratch-worktree-remote-branch-delete.test.js`
Expected: PASS (all tests, 0 fail).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/cleanup-procedures-execution.md plugin/skills/flow/multispec-review-console.md tests/scratch-worktree-remote-branch-delete.test.js
git commit -m "Pass --remote-ref-only in wrap-up Section C step 5 — archival stays item 8, after items 6 and 7" -m "refs #3490"
```

### Final verification (folded into /build Common Step 5)

Run: `npm test` (redirect to a file). Expected: no new attributable failures versus the base (AC3.1).

Waived AC3.1: a whole-suite outcome, not a unit-test assertion — verified by this final `npm test` run (Common Step 5's runner stamp), never by a test step.

## Build deviations (Common Step 4.5 — all Beneficial, applied)

1. Task 2 also corrected three sentences Task 1 made false in `cleanup-procedures-execution.md` Section C ("a narrower form", "narrowed to just that one step", step 5.5's "with archival suppressed"), and `docs/journeys/multi-spec-review-console.md:37` (SDD ruling, staged as `sdd-ruling-1`). Same stale-claim class as Review Focus 5.
2. The final-review fix wave (3a614017a) made AC7 (#1323) root-dependent. The Review Focus 4 claim that AC7 is "unchanged and covered" was wrong: after the flip it could no longer fail. AC7 now asserts the integration-branch refusal, proven red under the #1323 bug. It also made the `!root` archive line the unconditional one, completed the removal checklist (`git grep -n -F -- --remote-ref-only`), and fixed stale comments.
3. Simplify (4cab761c9) emits the archive-skip line once, above the `!root` guard. Output order is unchanged.
