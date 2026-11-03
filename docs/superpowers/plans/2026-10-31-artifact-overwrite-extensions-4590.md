# Artifact-overwrite check: step-renumber and Origin-line extension tests (#4590) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two extension tests to `checkArtifactOverwrite`. The first accepts a renumbered `### N.` journey step heading. The second accepts a reference-preserving `Origin:` line. With both in place, a later spec that inserts a step, or adds itself to the Origin line, no longer trips the multi-spec HARD-GATE.

**Architecture:** Two new pure per-hunk predicates in `plugin/bin/lib/flow/artifact-overwrite-check.js`, beside `isListReflow` and `isStepMarkupReformat`, both exported. Each is checked in the per-hunk loop of `checkArtifactOverwrite` right after test 3, before the lazy blame. Prose that enumerates the extension tests is updated to five.

**Tech Stack:** Node 18+ CommonJS, `node --test`, real throwaway git repos in fixtures (the test file's existing `repo()`/`write()`/`commit()` helpers).

**Spec:** `.claude-tweaks/pipelines/2026-10-30T231455-record-4590/work/4590-spec.md` (GitHub #4590)

## Global Constraints

- Fail closed: anything neither new predicate positively recognizes falls through to the existing blame path, unchanged.
- Existing three tests keep their behavior and their order; the two new ones run after test 3 and before the blame fetch.
- No new dependencies. Tests use only the helpers already in `tests/bin-lib/flow/artifact-overwrite-check.test.js`.
- Commit messages: `{Verb} {what} — {detail}` style, ending with `refs #4590` (never `closes`/`fixes`), plus the trailer `Claude-Session: https://claude.ai/code/session_01YPgdwSSj28FgeDVv7T1KXW`.
- Premise note (logged in `decisions.md` as a `premise reversed:` entry): in the real incident (4706f21db) the Origin edit was a `- ` bullet that test 2 already passes. Only the two renumbered `### N.` heading hunks failed. Test 5 is still built as the spec's AC3 requires.

## Review Focus

1. Two deleted headings with identical text: each needs its own added counterpart. Matching consumes an added line once (multiset), so one added heading cannot satisfy two deleted ones. Pinned in Task 1.
2. A renumbered heading whose added counterpart is a list-form step (`2. **Name** — x`), not a heading: not a renumber, stays an overwrite. Pinned in Task 1.
3. A deleted `Origin:` line with no `Origin:` line among the hunk's added lines: an overwrite, not a vacuous pass. Pinned in Task 2.
4. A hunk mixing a renumbered heading with a deleted body line: neither predicate passes it, so it falls to blame. Pinned in Task 1.
5. The real incident range `729a5ae5e..4706f21db` must report clean with the step-renumber test alone. Pinned in Task 1 as a live replay that skips when the commits are unreachable.

---

### Task 1: Step-renumber extension test (test 4)

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/flow/artifact-overwrite-check.js`
- Test: `tests/bin-lib/flow/artifact-overwrite-check.test.js`

**Interfaces:**
- Produces: `isStepRenumber(hunk: {deletedLines: Array<{lineNo:number, content:string}>, addedLines: string[]}) => boolean`, exported from the module.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/flow/artifact-overwrite-check.test.js`; add `isStepRenumber` to the destructured `require(MOD)`)
  - `test('AC1.1: inserting a step ahead of two existing ### N. steps (headings renumbered, text unchanged) passes clean', …)`. In a real repo, commit A (`refs #10`) adds `docs/journeys/demo.md` with `# Demo`, then `### 1. Read the banner — A session starts.` + `- **Action:** Open it.`, then a blank line, then `### 2. Read the footer — A session ends.` + `- **Action:** Close it.`. Commit B (`refs #11`) inserts `### 1. Sign in — A session begins.` + `- **Action:** Log in.` + a blank line ahead of them, and renumbers the old steps to `### 2.`/`### 3.` with their text unchanged. Assert `result.clean === true`, with `JSON.stringify(result.overwrites)` as the message.
  - `test('AC2.1: a renumbered heading whose text also changes still reports an overwrite', …)`: same as AC1.1, except the renumbered old step 2 also reads `### 3. Read the footer — A session closes.`. Assert `clean === false`, `overwrites.length === 1`, and `overwrites[0].commit` equals commit B's sha.
  - Unit tests via `parseHunks` on literal `-U0` diffs (Review Focus 1, 2, 4):
    - `-### 3. X` / `+### 4. X` → `isStepRenumber` true.
    - Two deleted `### 2. X` and `### 3. X` against one added `### 4. X` → false.
    - `-### 3. X` / `+4. **X**` → false. Use a step without ` — ` text so the list form normalizes to `4. X`; the added line is still not a heading.
    - `-### 3. X` + `-Body line.` / `+### 4. X` → false.
    - A deletion-only hunk → false.
  - `test('the real #4488/#4484 journey step insertion (729a5ae5e..4706f21db) passes with no manual ruling', …)`: copy the existing `80e3dad2d` replay test's skip guard (`git cat-file -t 4706f21db` must print `commit`). Run `checkArtifactOverwrite({ base: '729a5ae5e', head: '4706f21db', paths: ['docs/journeys/route-a-review-finding-the-release-gate-can-see-4488.md'], cwd: repoRoot })` and assert `clean === true`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: FAIL (`isStepRenumber is not a function`, and AC1.1 / the live replay report `clean: false`)

- [ ] **Step 3: Implement `isStepRenumber(hunk)` and wire it in**

Rules: blank deleted lines are ignored, but at least one non-blank line must be deleted. Every non-blank deleted line must match a numbered step heading, `/^\s*#{1,6}\s+(\d+)\.\s+(.*)$/`. Each one must consume a distinct added line that is also a numbered step heading, with a different number and equal text. "Text" is the line after `normalizeStepMarkup` with its leading `N. ` stripped. In `checkArtifactOverwrite`'s per-hunk loop, add `if (isStepRenumber(hunk)) continue; // Test 4 — step renumber` right after the Test 3 line. Add a "4. Step renumber" paragraph to the header comment's numbered list, in the existing style. Update the counts there: "either of three independent tests" → "either of four", and "fails all three tests" → "fails all four tests". Task 2 bumps them to five. Update the blame-reason string's "neither a list reflow nor a step-markup reformat" to name the renumber test too.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: PASS, every test

- [ ] **Step 5: Go-red check (AC4.1, scratch, not committed)**

Temporarily delete the `if (isStepRenumber(hunk)) continue;` line. Re-run the file into `$PIPELINE_RUN_DIR/evidence/ac4-step-renumber-go-red.txt` (`mkdir -p` first, absolute run-dir path). The AC1.1 test and the live replay must fail. Restore the line with the Edit tool, not `git checkout`. Then log one `AUTO` entry with `--section "/build" --step "AC evidence"` via `log-decision.js --text-file`, naming AC4.1, the command, the fail count and the evidence path.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/flow/artifact-overwrite-check.js tests/bin-lib/flow/artifact-overwrite-check.test.js
git commit -m "Treat a renumbered journey step heading as an extension — artifact-overwrite test 4 …"
```

---

### Task 2: Reference-preserving Origin-line extension test (test 5) + prose to five

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/flow/artifact-overwrite-check.js`
- Modify: `plugin/skills/flow/multispec-artifact-namespacing.md` (lines 47-79: "three independent tests", the numbered list, "failing *all three* tests", the fixture-coverage sentence)
- Modify: `docs/plugin-structure.md:229` (the check-artifact-overwrite CLI entry lists the safe-deletion tests; add the two new ones)
- Test: `tests/bin-lib/flow/artifact-overwrite-check.test.js`

**Interfaces:**
- Consumes: Task 1's `isStepRenumber` (already wired in).
- Produces: `isReferencePreservingOriginLine(hunk) => boolean`, exported.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/flow/artifact-overwrite-check.test.js`; add `isReferencePreservingOriginLine` to the destructured `require(MOD)`)
  - `test('AC3.1: an Origin: line that gains a #N reference and keeps the existing one passes clean', …)`. Commit A (`refs #10`) adds a journey whose last line is `Origin: created during build of #10`. Commit B (`refs #11`) appends a step and rewrites that line to `Origin: created during build of #10; step 2 added during build of #11`. Assert `clean === true`.
  - `test('AC3.2: an Origin: line rewrite that drops the existing #N reference reports an overwrite', …)`: same, but B's line is `Origin: step 2 added during build of #11`. Assert `clean === false` and `overwrites[0].commit` equals commit B's sha.
  - Unit (Review Focus 3): `-Origin: built in #10` with no added `Origin:` line (only `+Something else.`) → `isReferencePreservingOriginLine` false. `-Origin: built in #10` / `+Origin: built in #10 and #11` → true.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: FAIL (`isReferencePreservingOriginLine is not a function`; AC3.1 reports `clean: false`)

- [ ] **Step 3: Implement `isReferencePreservingOriginLine(hunk)` and wire it in**

Rules: at least one deleted line, and every deleted line matches `/^\s*Origin:/`. Take the hunk's added lines matching the same regex, in order. There must be at least as many as there are deleted lines. Pair the i-th deleted line with the i-th added `Origin:` line; every `#(\d+)` in the deleted line must appear in its pair. Wire it in as `if (isReferencePreservingOriginLine(hunk)) continue; // Test 5 — reference-preserving Origin line` after Test 4. In the header comment, add a "5. Reference-preserving Origin line" paragraph and change the counts to five. Update the blame-reason string to name all four non-blame tests. In `multispec-artifact-namespacing.md`, add list items 4 (step renumber) and 5 (reference-preserving `Origin:` line) in the existing style, and change "three independent tests" → "five independent tests" and "failing *all three* tests" → "failing *all five* tests". Add "step renumber, reference-preserving Origin line" to the fixture-coverage parenthesis, and the `729a5ae5e..4706f21db` live replay beside the #1988–#1997 one. In `docs/plugin-structure.md:229`, extend the "either … or … or …" list with the two new tests.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js tests/bin-lib/flow/check-artifact-overwrite-cli.test.js tests/multispec-artifact-namespacing-conformance.test.js`
Expected: PASS, every test

- [ ] **Step 5: Go-red check (AC4.1, scratch)**

Same procedure as Task 1 Step 5, with the `isReferencePreservingOriginLine` wiring line removed. Write to `$PIPELINE_RUN_DIR/evidence/ac4-origin-line-go-red.txt`; AC3.1 must fail. Restore the line, then log the `AC evidence` entry.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/flow/artifact-overwrite-check.js tests/bin-lib/flow/artifact-overwrite-check.test.js plugin/skills/flow/multispec-artifact-namespacing.md docs/plugin-structure.md
git commit -m "Treat a reference-preserving Origin: line as an extension — artifact-overwrite test 5 …"
```

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 Step 1 test `AC1.1: …` |
| AC2.1 | Task 1 Step 1 test `AC2.1: …` |
| AC3.1 | Task 2 Step 1 test `AC3.1: …` |
| AC3.2 | Task 2 Step 1 test `AC3.2: …` |
| AC4.1 | Task 1 Step 5 and Task 2 Step 5 go-red runs (scratch, evidence persisted to the run dir) |

## Self-review

- **Spec coverage:** Deliverable 1 → Task 1. Deliverable 2 → Task 2. Deliverable 3 (header comment + `multispec-artifact-namespacing.md`) → Tasks 1 and 2, plus the `docs/plugin-structure.md` CLI entry found by the behavior-change prose sweep. AC1.1 and AC2.1 → Task 1; AC3.1 and AC3.2 → Task 2; AC4.1 → Task 1 Step 5 and Task 2 Step 5.
- **Not in this plan:** `docs/journeys/catch-a-silent-journey-overwrite.md` restates the three tests (lines 49, 54). It is a journey, so `/build` Common Step 6 (`/claude-tweaks:journeys`) updates it.
- **Placeholders:** none.
