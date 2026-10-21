# Decision-Line Status Word Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/specify` corrects a spec-mandated `decisions.md` line whose status word breaks `_shared/auto-decision-log.md`'s Status semantics, and `/build`'s SDD invocation tells rulings that a project contract outranks spec-mandated literal text.

**Architecture:** Prose-only change to three skill files, each pinned by a `node --test` prose-conformance test that reads the live skill text (the existing `tests/specify-*.test.js` / `tests/build-*.test.js` pattern). No runtime code.

**Tech Stack:** Markdown skill files; `node --test` with `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T183400-record-3557/work/3557-spec.md` (record #3557)

Scope keywords: Mandated decision-line status word, contract beats spec-mandated literal text

## Global Constraints

- Cite `_shared/auto-decision-log.md`'s Status semantics; never restate the status vocabulary table.
- The specify check rewrites a non-conformant line; it never adds a mid-flow stop or `AskUserQuestion` in `auto` mode.
- The build instruction directs a ruling, never a question; it reuses the existing `build-deviation-*` staged-item convention (Common Step 4.5's "Update the spec" category, `build/architecture-alignment.md`).
- `plugin/skills/build/dispatch.md` line 14 is one very long line: insert the new sentence inline without reflowing or rewrapping any surrounding text.
- New test files are sized like their neighbors (`tests/specify-premise-verification-prose.test.js`, `tests/build-review-finding-deferral-gate.test.js`): header comment naming the record, `read()` helper over `ROOT`, a handful of `test()` blocks.
- Commit messages: `{Verb} {what} — {detail}`, body line `refs #3557` (never "closes"/"fixes").
- Byte headroom against `RAIL_BYTES` (52,500 B): `shaping-mode.md` 19,328 B, `record-creation-subissues.md` 27,450 B, `dispatch.md` 25,887 B at base; each grows by under 1 KB, leaving more than 24 KB headroom on every file.

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 Step 1 tests |
| AC2.1 | Task 2 Step 1 tests |
| AC3.1, AC3.2 | Task 1 and Task 2 `AC3.1 + AC3.2` tests |
| AC4.1 | Task 1 Step 4 / Task 2 Step 4 (pass) and Task 1 Step 5 / Task 2 Step 5 (go-red in a scratch worktree) |

## Review Focus

1. A test that only greps a common word ("STAGED", "contract") would pass without the instruction — each test must anchor on the instruction's own bold label and assert on content inside that paragraph's slice, so reverting the paragraph turns it red.
2. `tests/specify-premise-verification-prose.test.js` asserts `Premise verification (#1769)` precedes `**Ceremony**` in `record-creation-subissues.md`; the new paragraph must sit between them without containing the literal `**Ceremony**`.
3. Other prose tests read `build/dispatch.md` line 14 (`tests/build-review-finding-deferral-gate.test.js`, `tests/build-sdd-ledger-residue-carryforward.test.js`, `tests/foreground-execution-instruction.test.js`, `tests/build-dispatch-status-token-and-tree-immutability.test.js`) — the insertion must not split any phrase those tests match; run the full suite.
4. A `STAGED` line that does name its `staged/` artifact is conformant and must be left alone — the instruction text must say the rewrite fires only on a mismatch.
5. `docs/skill-graph.md` must carry the new specify → `_shared/auto-decision-log.md` edge (CLAUDE.md's Cross-references rule).

---

### Task 1: `/specify` mandated decision-line status-word check

**Files:**
- Modify: `plugin/skills/specify/shaping-mode.md` (insert a new paragraph directly after the paragraph beginning "Run `_shared/premise-verification.md`'s check against the composed", before `**Near-duplicate candidate check (#1944)`)
- Modify: `plugin/skills/specify/record-creation-subissues.md` (insert a new paragraph directly after the `**Premise verification (#1769)**` paragraph, before `**Ceremony**`)
- Modify: `docs/skill-graph.md` (add a row to the `## specify` section's table for `_shared/auto-decision-log.md`)
- Test: `tests/specify-decision-line-status-word.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: the bold label `**Mandated decision-line status word (#3557).**`, present verbatim in both specify files.

- [ ] **Step 1: Write the failing test** `tests/specify-decision-line-status-word.test.js`

Test names cite their clauses: `AC1.1: shaping-mode.md carries the mandated decision-line status-word check`, `AC1.1: record-creation-subissues.md carries the same check`, `AC3.1 + AC3.2: the specify check rewrites rather than prompts (no mid-flow stop)` (asserts each slice matches `/rewrite/i` and `/never stop mid-flow to ask/` and `doesNotMatch(/AskUserQuestion/)`). Factor the per-file slice assertions into one `assertCheck(text, fileLabel)` function that every test calls — Step 5's go-red runs exercise the same function.

For each of `SHAPING_MODE` and `SUBISSUES`, slice from the label `Mandated decision-line status word (#3557)` to the next blank line (`\n\n`) and assert on that slice:
- the label is present (`indexOf !== -1`);
- `/_shared\/auto-decision-log\.md`'s Status semantics/`;
- `/`STAGED` line must name the `staged\/` artifact/`;
- `/`AUTO`/` and `/`SKIP` for a degrade trace/`;
- `/rewrite/i` and `/never stop mid-flow to ask/`;
- `/only on a mismatch|On a mismatch/` (Review Focus 4).
Ordering tests:
- shaping-mode: label index > index of "Run `_shared/premise-verification.md`'s check against the composed" and < index of `**Near-duplicate candidate check (#1944)`.
- subissues: label index > index of `Premise verification (#1769)` and < index of `**Ceremony**`; subissues slice must match `/before `gh issue create` \/ `writeRecord`/`; shaping slice must match `/before the record is written or stamped `ready`/`.
Skill graph: the `## specify` section of `docs/skill-graph.md` (slice from `/^## specify$/m`, 6000 chars) matches `/_shared\/auto-decision-log\.md/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/specify-decision-line-status-word.test.js`
Expected: FAIL (label not found)

- [ ] **Step 3: Add the paragraph to both specify files**

Exact copy for `shaping-mode.md`:

> **Mandated decision-line status word (#3557).** When the composed spec mandates a literal `decisions.md` line — a Deliverable or Acceptance Criterion quoting the exact line a skill must log — check its status word against `_shared/auto-decision-log.md`'s Status semantics before the record is written or stamped `ready`. A `STAGED` line must name the `staged/` artifact it writes; a line that writes no staged artifact uses `AUTO`, or `SKIP` for a degrade trace. On a mismatch, rewrite the line to the contract-conformant status word in the composed body before writing it; never stop mid-flow to ask. A conformant line is left as written.

For `record-creation-subissues.md`, the same paragraph with "before the record is written or stamped `ready`" replaced by "before `gh issue create` / `writeRecord`", and "composed spec" replaced by "composed sub-issue body".

Skill-graph row (append to the `## specify` table, matching the existing `| \`_shared/...\` | ... |` shape):

> | `_shared/auto-decision-log.md` | `shaping-mode.md`'s and `record-creation-subissues.md`'s Mandated decision-line status word check (#3557) cites the Status semantics table: a spec-mandated literal `decisions.md` line is rewritten to a conformant status word before the record is written. |

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/specify-decision-line-status-word.test.js tests/specify-premise-verification-prose.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Prove discrimination (AC4.1)** — in a scratch `git worktree add`, delete the paragraph from `shaping-mode.md` and confirm the new test fails; repeat for `record-creation-subissues.md`. Never edit the shared worktree in place for this.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/specify/shaping-mode.md plugin/skills/specify/record-creation-subissues.md docs/skill-graph.md tests/specify-decision-line-status-word.test.js
git commit -m "Add mandated decision-line status-word check to /specify — both composition paths rewrite a non-conformant STAGED/AUTO/SKIP line" -m "refs #3557"
```

### Task 2: `/build` SDD instruction — contract beats spec-mandated literal text

**Files:**
- Modify: `plugin/skills/build/dispatch.md:14` (insert inline, immediately after the sentence `Severity alone ("minor", "fine to defer") is never a reason.` and before ` **Carry forward surviving SDD ledger residue before Finish:**` — one space separates sentences; no reflow)
- Test: `tests/build-contract-beats-spec-literal.test.js` (create)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the bold label `**Project contract beats spec-mandated literal text (#3557).**` inside `dispatch.md`'s subagent paragraph.

- [ ] **Step 1: Write the failing test** `tests/build-contract-beats-spec-literal.test.js`

Test names cite their clauses: `AC2.1: build/dispatch.md carries the contract-beats-spec-literal instruction`, `AC3.1 + AC3.2: the build instruction directs a ruling, not a question` (the `/ruling/` + `doesNotMatch(/AskUserQuestion/)` assertions below).

Read `plugin/skills/build/dispatch.md`; slice from the label `Project contract beats spec-mandated literal text (#3557)` to the next `**` bold label that follows it (`indexOf('**Carry forward surviving SDD ledger residue', start)`). Assert on that slice:
- label present;
- `/also direct `\/superpowers:subagent-driven-development`/`;
- `/_shared\/\*\.md/`;
- `/conforms to the contract/`;
- `/update-the-spec deviation/` and `/build-deviation-/`;
- `/never kept on the grounds that the spec spelled it out/`;
- `/ruling/` and `doesNotMatch(/AskUserQuestion/)` (AC 3 — a ruling, not a question).
Placement: label index > index of `**Review findings go through the deferral gate (#3004).**` and < index of `**Carry forward surviving SDD ledger residue before Finish:**`; and the label sits on the same line as `**subagent** (default):` (no newline between them — Gotcha: no reflow).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-contract-beats-spec-literal.test.js`
Expected: FAIL (label not found)

- [ ] **Step 3: Insert the sentence**

Exact copy:

> **Project contract beats spec-mandated literal text (#3557).** In the same invocation instruction, also direct `/superpowers:subagent-driven-development` that spec-mandated literal text — a quoted `decisions.md` line, a status word, an exact message — never overrides a project contract (`_shared/*.md`): when the two conflict, every ruling (pre-flight, fix-loop, or final-review) conforms to the contract, and the departure is recorded as an update-the-spec deviation — Common Step 4.5's "Update the spec" category, staged as `build-deviation-{N}` (`architecture-alignment.md`). The spec's text is never kept on the grounds that the spec spelled it out.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/build-contract-beats-spec-literal.test.js tests/build-review-finding-deferral-gate.test.js tests/build-sdd-ledger-residue-carryforward.test.js tests/foreground-execution-instruction.test.js tests/build-dispatch-status-token-and-tree-immutability.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Prove discrimination (AC4.1)** — in a scratch `git worktree add`, remove the inserted sentence and confirm the new test fails; record the failing output. Together with Task 1 Step 5 this covers AC4.1 for both tests.

- [ ] **Step 6: Run the full suite**

Run: `npm test > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/90313db4-5994-4b2a-8a0e-7e9ceaae8cf6/scratchpad/npm-test-3557.txt 2>&1; echo exit=$?`
Expected: `exit=0`

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/build/dispatch.md tests/build-contract-beats-spec-literal.test.js
git commit -m "Add contract-beats-spec-literal ruling instruction to /build's SDD invocation — conform and stage build-deviation" -m "refs #3557"
```
