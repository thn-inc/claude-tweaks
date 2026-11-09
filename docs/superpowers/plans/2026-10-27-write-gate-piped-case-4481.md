# Write gate reads a case compound that starts a pipeline as if its cd persisted (#4481) Implementation Plan

**Goal:** A `case` compound that is the first element of a pipeline ends, like a later-element one, under both the pipeline's start and the cwd its arm left, and an empty array assignment `x=()` no longer puts the next word in command position.

**Spec:** `.claude-tweaks/pipelines/2026-10-27T184830-spec-4481/work/4481-spec.md` (materialized from GitHub issue #4481)

---

### Task 1: Fail closed on a first-element case pipeline and stop `x=()` opening command position

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js`
- Test: `tests/hooks-gate-coverage.test.js`

- [ ] **Step 1: Failing test** — add rows to the case-compound pin block near `tests/hooks-gate-coverage.test.js:1864-1867` (the `true | case …` rows), each with a bash 3.2 and 5 verdict comment:
  - `fileWriteTargets('case x in a) cd /wt;; esac | cat; echo x > f', '/r')` includes `/r/f`;
  - `fileWriteTargets('case x in a|x) cd M;; esac | cat; echo hi > f', '/r')` includes `/r/f`;
  - `fileWriteTargets('a=() case x | cd /tmp; echo hi > f.js', '/r')` includes `/r/f.js`.
  Run: `node --test tests/hooks-gate-coverage.test.js` — Expected: FAIL on the three new rows.
- [ ] **Step 2: Implement** —
  - Deliverable 1: `endCommand` (`git-command.js` ~2425) keeps the start cwd only when `L.pipeStart !== null` at the moment `caseSeen` is set; when the case is the pipeline's first element, the arm's `;;` resets `caseSeen` (~2610) before the `|` arrives, and the `|` then takes `spanStart` — the arm's post-`cd` cwd — as `pipeStart`. Make a pipeline whose first element is a case compound start at the cwd in effect before the case and end under both that start and the cwd the arm left (`pipeKeep`), as the later-element shape already does. The existing pins (`case x in a|x) cd /main;; esac; echo x > f.js` → M/f, `true | case x in a|x) cd /main;; esac; echo x > f.js` → both) must keep passing.
  - Deliverable 2: `emptyParens` (~2061) returns true for any empty `( )`, so `a=()` sets `atCmd` (~2104/2110) and the next word reads as a reserved word. Return true only for a function definition's `()` (the word before the `(` is a function name, not an assignment word ending in `=`); correct the comment at ~2058-2060 ("bash accepts no other empty `( )`" — an empty array assignment `a=()` is valid).
- [ ] **Step 3: Run** `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js` — PASS. Revert each fix in turn and confirm its own new row goes red.
- [ ] **Step 4: Commit** — one commit, `Fix write gate reading a first-element piped case as keeping its cd — and x=() opening command position`, `refs #4481`.

---

## Self-review

- **Spec coverage:** Deliverables 1-3 and all five Acceptance Criteria are covered by Task 1's Steps 1-3 (revert-to-red is Step 3; "scanner suites pass" is Step 3's run).
- **Placeholders:** none.
