# pathToFileURL-Expectation Pitfall Row (#3917) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution:** batched
**Batch:** send every task to one implementer as a single brief; review the combined diff once.

**Goal:** Add one anti-pattern row to `.claude/skills/windows-checkout-test-parity/SKILL.md` covering a test that hard-codes a POSIX `file:///Users/…` literal as the expected `pathToFileURL(dir).href` link (#3886).

**Architecture:** Prose-only edit to a maintainer-side project skill (not shipped plugin payload). One new Markdown table row is inserted after the current last row of the `## Anti-Patterns` table. No code, no tests.

**Tech Stack:** Markdown.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T092746-record-3917/work/3917-spec.md` (materialized from GitHub issue #3917)

## Global Constraints

- The row text is fixed by the spec and inserted verbatim. Do not reword it, re-wrap it, or swap `…` (U+2026) for `...`.
- Touch only `.claude/skills/windows-checkout-test-parity/SKILL.md`. No other row moves or changes.
- Commit message style: `{Verb} {what} — {detail}`, body `refs #3917`. Never `closes`/`fixes`.

## Review Focus

- The row lands inside the table, not after it. A blank line between the previous row and the new one would end the table and render the new row as a stray paragraph.
- Column count: the row has exactly two cells (three `|` delimiters at line level), matching the table's `| Pattern | Why It Fails in This Project |` header.
- Unicode `…` survives the edit. An ASCII `...` substitution would silently diverge from the spec text.
- The cited facts still hold in `tests/statusline.test.js`: `linkedName(dir)` derives from `pathToFileURL` (line 26–27), the `Code%20Workspaces` literal check (line 265), and the trailing-`/`-before-BEL regex (line 275), in the two `renderProject` link tests (lines 260 and 269). These were verified at plan time. Re-check only if the file has changed.
- No existing test pins this skill's anti-pattern rows by content (`git grep -n "windows-checkout-test-parity" -- tests` hits only a comment in `tests/bin-lib/visual-decide/cli.test.js`). The sweep suites that walk `.claude/skills` (`tests/argument-hint-mirrors.test.js`, `tests/impeccable-retired-scripts-sweep.test.js`) must stay green, and the full suite at Common Step 5 covers them.

---

### Task 1: Insert the pathToFileURL pitfall row

**Files:**
- Modify: `.claude/skills/windows-checkout-test-parity/SKILL.md:178` (insert one line after it, before the blank line and `## Reference` at line 180)

**Interfaces:**
- Consumes: none
- Produces: none

- [ ] **Step 1: Confirm the row is absent (AC1.1 pre-check)**

Run: `grep -c "pathToFileURL" .claude/skills/windows-checkout-test-parity/SKILL.md`
Expected: `0`

- [ ] **Step 2: Insert the row**

Insert this exact line directly after line 178, the row beginning `| Building a transcript \`Read\` fixture's \`file_path\` with \`path.join(tmpDir, …)\``. No blank line may come between the two rows:

```
| Hard-coding a POSIX `file:///Users/…` literal as the expected output of a `pathToFileURL(dir).href` link | On win32, `pathToFileURL` resolves a POSIX-style fixture path against the current drive, so production correctly prints `file:///D:/Users/…` and the literal fails on Windows only (`tests/statusline.test.js`'s two `renderProject` link tests, #3886). Derive the expected link from `pathToFileURL` itself (the file's `linkedName(dir)`) instead of a `process.platform` branch holding two literals, and keep each test's own point as a separate literal check that does not depend on the derivation (`Code%20Workspaces`, a `/` before the BEL) |
```

- [ ] **Step 3: Verify AC1.1 (the row is present and names #3886 and `pathToFileURL`)**

Run: `grep -n "^| Hard-coding a POSIX" .claude/skills/windows-checkout-test-parity/SKILL.md`
Expected: one hit at line 179, containing both `#3886` and `pathToFileURL`.

Run: `sed -n '178,181p' .claude/skills/windows-checkout-test-parity/SKILL.md`
Expected: line 178 is the `Building a transcript` row, line 179 is the new row, line 180 is blank, and line 181 is `## Reference`.

- [ ] **Step 4: Verify AC2.1 (`npm test` stays green)**

This check is folded into `/claude-tweaks:build` Common Step 5 (full-suite verification via `skills/test/verification.md`). The implementer runs no suite here.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/windows-checkout-test-parity/SKILL.md
git commit -m "Add pathToFileURL-expectation pitfall row to windows-checkout-test-parity — derive the expected link, keep literal checks separate

refs #3917"
```

---

## Self-review

- **Spec coverage:** The Deliverable (one verbatim row after the `Building a transcript…` row) is Task 1 Step 2. AC1.1 is Step 3. AC2.1 is Step 4, folded into Common Step 5.
- **Placeholders:** none.
- **Proportion:** a one-row transcription, one task.
