# resolve-run-dir stale non-canonical standalone dir (#2870) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `resolve-run-dir` from handing back the stale, never-closed `20260911T131119-backlog-standalone` directory, which has no `run-state.json`, as the current run. Pin the original symptom with a regression test, and give that directory an explicit disposition.

**Architecture:** #2838 (`397e3db5e`) already makes `--spec-slug X --create` (no `--standalone`) skip Step 2, so AC1's literal command now mints fresh. The live mechanism is still open, though. `newestMatch()` in `plugin/bin/lib/hooks/run-dir-resolve.js` string-sorts candidate names. A non-canonical `YYYYMMDDTHHMMSS-…` name sorts after every canonical `YYYY-MM-DDTHHMMSS-…` name, because `'0' > '-'`. So read-only Step 2 resolution adopts the stale directory as "newest" forever. Probed live on 2026-10-19: `PIPELINE_RUN_DIR= node plugin/bin/hooks.js resolve-run-dir --spec-slug backlog-standalone` printed `…/20260911T131119-backlog-standalone`. #848 already ruled that non-canonical run dirs are never adopted. `context.js`'s `RUN_ID_RE` filter and `findNonCanonicalRunDirs` (reported by reconcile) implement that ruling, but `newestMatch()` never applied it. The fix restricts `newestMatch()` candidates to `RUN_ID_RE`.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T045125-record-2870/work/2870-spec.md`

## Global Constraints

- Keep one definition of `RUN_ID_RE`. `context.js` already `require('./run-dir-resolve')` at its top (line 9), so `run-dir-resolve.js` must NOT require `context.js` (that would be circular). Instead, move the regex definition (`/^\d{4}-\d{2}-\d{2}T/`, unchanged) into `run-dir-resolve.js`. Export it there, and have `context.js` alias it: `const RUN_ID_RE = runDirResolve.RUN_ID_RE;`. `context.js`'s own export of `RUN_ID_RE` stays, so its six consumers are untouched.
- Read-only adopt-newest behavior for canonical names stays exactly as today (#2838's AC).
- No change to `_shared/run-dir-resolution.md`'s byte-pinned Bash snippet. The #1962 dead-dir skip is precedent: a CLI candidate-filter refinement does not touch the reference snippet.
- Commit messages use `refs #2870`, never `closes`/`fixes`.

## Review Focus

- A non-canonical match coexisting with an older canonical match: read-only resolution must return the canonical one. Pinned in Task 1 test (b).
- A non-canonical match as the only match: read-only resolution returns `ok:false` (`unresolved`) and creates nothing. Pinned in Task 1 test (c).
- `--create` with the exact incident fixture (decisions.md content, no run-state.json) mints a fresh canonical dir. Pinned in Task 1 test (a). This one is already green on main via #2838; it is a regression pin, not new behavior.
- The `archive/` sibling must never become a candidate. Already excluded by the slug filter and now also by `RUN_ID_RE`. No new test needed.

---

### Task 1: Filter `newestMatch()` to canonical run-id names, plus regression tests

**Files:**
- Modify: `plugin/bin/lib/hooks/run-dir-resolve.js` (define and export `RUN_ID_RE`; filter in `newestMatch`)
- Modify: `plugin/bin/lib/hooks/context.js:73-77` (replace the regex literal with `runDirResolve.RUN_ID_RE`, keep the comment)
- Test: `tests/hooks-run-dir-resolve.test.js`

**Interfaces:**
- Produces: `module.exports.RUN_ID_RE` on `run-dir-resolve.js` (same regex object `context.js` re-exports)

- [ ] **Step 1: Write the failing tests.** Append three tests after the existing `#2838` block. Each uses `mkRunDir(main, '20260911T131119-backlog-standalone')` and writes `decisions.md` containing `'## /backlog\n- AUTO 15:11:19 — refine #1894: stale\n'`. No run-state.json.
  - (a) `#2870: --create with --spec-slug never hands back a non-canonical dir lacking run-state.json — mints fresh`. Call `resolve({cwd: main, env: {}, specSlug: 'backlog-standalone', create: true, now: new Date('2026-10-01T12:00:00Z')})`. Assert `ok === true`, `created === true`, `path !== stale`, and `basename === '2026-10-01T120000-backlog-standalone'`.
  - (b) `#2870: read-only resolution prefers an older canonical match over a non-canonical name that string-sorts last`. Also create `mkRunDir(main, '2026-09-20T080000-backlog-standalone')`. Read-only `resolve({cwd: main, env: {}, specSlug: 'backlog-standalone'})`. Assert `path === canonical`.
  - (c) `#2870: read-only resolution never adopts a non-canonical dir even when it is the only match`. Read-only resolve. Assert `ok === false`, `reason === 'unresolved'`, `created === false`.
- [ ] **Step 2: Run them.** Run: `node --test tests/hooks-run-dir-resolve.test.js`. Expected: FAIL on (b) and (c). (a) passes already because of #2838 (a regression pin).
- [ ] **Step 3: Implement.** In `run-dir-resolve.js`, add `const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T/;` with a comment citing #848/#2870. In `newestMatch`'s filter, add `RUN_ID_RE.test(e.name)`, and add it to `module.exports`. In `context.js`, change the definition line to `const RUN_ID_RE = runDirResolve.RUN_ID_RE;`.
- [ ] **Step 4: Run.** Run: `node --test tests/hooks-run-dir-resolve.test.js tests/hooks-context.test.js tests/hooks-resolve-run-dir-cli.test.js tests/hooks-archive-terminal.test.js`. Expected: PASS. Then revert the `newestMatch` filter alone and confirm (b) and (c) go red. Restore it.
- [ ] **Step 5: Commit.** `git add` the three files by path, then commit `Restrict resolve-run-dir newest-match to canonical run-id names — refs #2870`.

## Operational step (run by /build directly, not a dispatched task): dispose of the stale directory

This step produces no diff, so no implementer or reviewer has anything to act on. /build executes it inline, the way Spec Step 2.5 runs an auto-executable manual step, and logs it to decisions.md.

**Files:** none tracked. The run dir tree under `$RUN_ROOT/.claude-tweaks/pipelines/` is gitignored and exempt from the worktree-always gate.

- [ ] **Step 1:** Run `mv "$RUN_ROOT/.claude-tweaks/pipelines/20260911T131119-backlog-standalone" "$RUN_ROOT/.claude-tweaks/pipelines/archive/"`. Use the literal path. Precedent: `archive/20260809T143602-backlog-standalone` and other non-canonical names are already archived this way. `close-run`/`archive-run` refuse non-run-id-shaped dirs (`pipelinesRunIdShape`), so a manual move is the only route.
- [ ] **Step 2:** Verify that `PIPELINE_RUN_DIR= node plugin/bin/hooks.js resolve-run-dir --spec-slug backlog-standalone` no longer prints that path.
- [ ] **Step 3:** Log the disposition with `log-decision.js --status AUTO --reversibility high` (it can be moved back).

## Self-review

- **Spec coverage:** AC1 is covered by Task 1 (a) plus #2838, and Task 1's filter covers the read-only path of the same symptom. AC2 is covered by the Task 1 tests (a)–(c), which use the exact incident fixture. AC3 is covered by the Operational step.
- **Placeholders:** none.
