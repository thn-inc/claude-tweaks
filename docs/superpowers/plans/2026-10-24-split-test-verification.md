# Split test/verification.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `plugin/skills/test/verification.md` from 52,496 B to at most 47,500 B by moving its `### Flake handling (tests check only)` section into a new sibling sub-file, with every citation repointed.

**Architecture:** The Flake handling block (current lines 220-234, three headings, 11,061 B) is read only when a `tests` check fails or the runner prints a flaky caveat, so it moves verbatim to `plugin/skills/test/flake-handling.md`. A short pointer stub stays at the old heading. Cross-file deictics ("above") inside the moved text are rewritten to name `verification.md`. Expected result: verification.md ≈ 41.9 KB, flake-handling.md ≈ 11.4 KB.

**Tech Stack:** Markdown skill prose; `node --test` conformance suites.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T170202-record-4059/work/4059-spec.md` (record #4059)

**Execution:** batched
**Batch:** send every task to one implementer as a single brief; review the combined diff once.

## Global Constraints

- `wc -c plugin/skills/test/verification.md` ≤ 47,500 B; the new sub-file < 52,500 B (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`).
- No per-file byte pin may be added to any test (decision 0024; `tests/skill-size-single-source.test.js` fails on one). The 47,500 B target is checked by a scratch `wc -c`, not a committed test.
- Moved text is byte-identical to `git show 8d62aea9f:plugin/skills/test/verification.md` apart from heading level and the intra-file anchors listed in Task 1 Step 3.
- Commit messages: `{Verb} {what} — {detail}`, reference `refs #4059`, never `closes`/`fixes`.

## Review Focus

- A **passing** run that the runner flaky-retried still owes the `AUTO … Flaky retry:` decision line, which lives in the moved text: the stub must send the reader to the sub-file on a `CAVEAT: flaky-retried:`/`flaky-allowlist:` line, not only on failure (pinned by Task 1's stub test).
- Deictics in the moved text that pointed "above" at verification.md sections must name `verification.md`; "the two paths below" stays correct in the new file.
- `verification.md` line 174 (Declared pre-existing failures) says "Flake handling lists below" — must be repointed to the sub-file.
- Old citations in the journey's history bullets read as "verification.md's Flake handling" — repointed, without rewriting the history they record.
- A heading-substring false positive: `'## Named-file isolation'` is a substring of `'#### Named-file isolation'`, so the negative assertion on verification.md must use the `####` form.

---

### Task 1: Move Flake handling into `flake-handling.md`

**Files:**
- Create: `plugin/skills/test/flake-handling.md`
- Modify: `plugin/skills/test/verification.md:122,174,220-234`
- Test: `tests/verification-flake-handling.test.js`

**Interfaces:**
- Produces: the file `plugin/skills/test/flake-handling.md` with headings `# Flake handling (tests check only)`, `## Named-file isolation`, `## Whole-suite re-run`; Task 2 cites it as `test/flake-handling.md`.

- [ ] **Step 1: Retarget the test**

In `tests/verification-flake-handling.test.js`:
- Tests 1-3 (`#1925`, `#2026`, `#2029`) read `plugin/skills/test/flake-handling.md` instead of `verification.md`; rename their titles' `verification.md:` prefix to `flake-handling.md:`.
- Heading assertions become `text.includes('# Flake handling (tests check only)')`, `'## Named-file isolation'`, `'## Whole-suite re-run'`.
- The cross-reference assertion (old line 35) moves to a read of `verification.md`: `assert.ok(v.includes("`flake-handling.md`'s Whole-suite re-run path is the fallback for that"))`.
- Add `test('AC3.1: verification.md keeps only a pointer stub at the moved heading (#4059)', …)`, reading `verification.md`:
  - `includes('### Flake handling (tests check only)')` and `includes('read `flake-handling.md` in this skill\'s directory')`
  - `includes('CAVEAT: flaky-retried:')` within the stub paragraph (slice from the `### Flake handling` heading to `### Gate behavior`)
  - `!includes('#### Named-file isolation')`, `!includes('#### Whole-suite re-run')`, `!includes('One re-run, never more')`, `!includes('Bracketed path segments')`
  - `!includes('Flake handling lists below')`, and `includes('any unattributed signal `flake-handling.md` lists')`
- Add `test('AC3.1: external citations name test/flake-handling.md (#4059)', …)` asserting `plugin/skills/dispatch/sequential-execution.md` includes `` `test/flake-handling.md` `` and not `` `test/verification.md`'s Flake handling ``.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/verification-flake-handling.test.js`
Expected: FAIL (ENOENT reading `flake-handling.md`; stub/citation assertions fail).

- [ ] **Step 3: Create `flake-handling.md` and cut the section**

New file content, in order:
1. `# Flake handling (tests check only)`
2. One intro paragraph: `Loaded from `verification.md`'s Step 3 when a `tests`-family check fails or the runner prints a `CAVEAT: flaky-retried:`/`CAVEAT: flaky-allowlist:` line. "Step 3" below is `verification.md`'s report step.`
3. The two paragraphs of current lines 222 and 224, verbatim except `A file baseline adjudication (above) classes` → ``A file baseline adjudication (`verification.md`) classes``.
4. `## Named-file isolation` + current lines 228 and 230 verbatim except `"Isolating pre-existing failures by file" above still applies` → ``verification.md`'s "Isolating pre-existing failures by file" still applies`` and `Check the ledger first: "Pre-existing failures" above covers` → ``Check the ledger first: `verification.md`'s "Pre-existing failures" covers``.
5. `## Whole-suite re-run` + current line 234 verbatim except `"Isolating pre-existing failures by file" above does not apply` → ``verification.md`'s "Isolating pre-existing failures by file" does not apply`` and `exactly as the scoped invocation in "Re-verify scoping" above does` → ``exactly as the scoped invocation in `verification.md`'s "Re-verify scoping" does``.

In `verification.md`:
- Replace lines 222-234 (keep the `### Flake handling (tests check only)` heading at 220) with one paragraph: `Read `flake-handling.md` in this skill's directory when a `tests`-family check fails, or when the runner printed a `CAVEAT: flaky-retried:` or `CAVEAT: flaky-allowlist:` line. It holds the runner-owned flaky retry and the decision line a retried pass owes, the agent's one isolation pass when that retry does not resolve a failure (named-file isolation or a whole-suite re-run, chosen by `report.json`'s `checks.{suite}.retryDecision.reason`), and the flaky-allowlist proposal.`
- Line 122: `nothing to isolate; "Flake handling"'s Whole-suite re-run path below is the fallback for that` → ``nothing to isolate; `flake-handling.md`'s Whole-suite re-run path is the fallback for that`` (keep the `case.` wrap line).
- Line 174: `any unattributed signal Flake handling lists below` → ``any unattributed signal `flake-handling.md` lists``.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/verification-flake-handling.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/bin-lib/verify/snippet-conformance.test.js`
Expected: PASS (AC2.1 targeted set; Task 2 completes the citation half).

Run: `wc -c plugin/skills/test/verification.md plugin/skills/test/flake-handling.md`
Expected: verification.md ≤ 47500, flake-handling.md < 52500 (AC1.1).

AC4.1 scratch check (not committed): a node script that takes `git show 8d62aea9f:plugin/skills/test/verification.md` lines from `### Flake handling` to `### Gate behavior`, applies the heading-level and the five anchor substitutions listed in Step 3, and compares it with `flake-handling.md` minus its heading/intro lines. Expected: identical.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/flake-handling.md plugin/skills/test/verification.md tests/verification-flake-handling.test.js
git commit -m "Move Flake handling out of test/verification.md — new flake-handling.md sub-file, pointer stub left (refs #4059)"
```

### Task 2: Repoint external citations and register the sub-file

**Files:**
- Modify: `plugin/skills/dispatch/sequential-execution.md:102`
- Modify: `docs/journeys/run-a-deterministic-verification-check.md:2-22,101,209,210,213,214`
- Modify: `docs/plugin-structure.md:99`

**Interfaces:**
- Consumes: `plugin/skills/test/flake-handling.md` (Task 1).

- [ ] **Step 1: Edit citations**
  - `sequential-execution.md:102`: `(`test/verification.md`'s Flake handling)` → `(`test/flake-handling.md`)`.
  - Journey frontmatter `files:` — add `  - plugin/skills/test/flake-handling.md` after `plugin/skills/test/verification.md`.
  - Journey line 101: `(`verification.md`'s "Flake handling")` → `(`flake-handling.md`)`.
  - Journey lines 209/210/213/214 (history bullets): keep the history, repoint the location — 209 `` `verification.md`'s "Flake handling" replaced `` → `` the "Flake handling" section (now `test/flake-handling.md`) replaced ``; 210 `` routes to `verification.md`'s whole-suite re-run `` → `` routes to the whole-suite re-run (now in `test/flake-handling.md`) ``; 213 and 214 `` `verification.md` routes that reason to the whole-suite re-run `` → `` the Flake handling section (now `test/flake-handling.md`) routes that reason to the whole-suite re-run ``.
  - `docs/plugin-structure.md:99` test row: add `flake-handling.md` after `stamp-composition.md` in the file list, and after the Step 2.5 clause in the description add `; Step 3's flake handling — the runner-owned flaky retry and the agent's named-file / whole-suite isolation pass (#4059), loaded only when a tests check fails or the runner prints a flaky caveat`.
  - `docs/skill-graph.md`: no edit — no skill-to-skill edge changes.

- [ ] **Step 2: Verify**

Run: `node --test tests/verification-flake-handling.test.js`
Expected: PASS (AC3.1 external-citation test now green).

Run: `git grep -n -e "Flake handling" -e "Named-file isolation" -e "Whole-suite re-run" -- plugin docs tests`
Expected: every hit is in `plugin/skills/test/flake-handling.md`, the `### Flake handling` stub in `verification.md`, `tests/verification-flake-handling.test.js`, or a journey line already naming `test/flake-handling.md` — none points at a heading inside `verification.md` (AC3.1).

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/dispatch/sequential-execution.md docs/journeys/run-a-deterministic-verification-check.md docs/plugin-structure.md
git commit -m "Repoint Flake handling citations to test/flake-handling.md — dispatch, journey, plugin-structure (refs #4059)"
```

Full suite (AC2.1's "full suite stays green") runs at `/build` Common Step 5 through `verify.js`, not inside this plan.
