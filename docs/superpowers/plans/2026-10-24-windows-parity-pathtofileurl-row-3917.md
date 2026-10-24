# pathToFileURL-expectation pitfall row (#3917) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one anti-pattern row to the repo-local `windows-checkout-test-parity` skill covering a POSIX `file:///Users/…` literal pinned as a `pathToFileURL(dir).href` expectation (#3886).

**Architecture:** One verbatim table-row insertion into an existing markdown anti-pattern table. No code, no new files. The row text is fixed by the spec.

**Tech Stack:** Markdown (`.claude/skills/**/SKILL.md`, maintainer-side, not shipped in `plugin/`).

**Spec:** `.claude-tweaks/pipelines/2026-10-24T072008-record-3917/work/3917-spec.md` (materialized from GitHub issue #3917)

## Global Constraints

- The row text is the spec's "Proposed row, verbatim" fence, byte-for-byte (including the `…` ellipsis characters, not `...`).
- Insert position: immediately after the "Building a transcript `Read` fixture's `file_path` …" row (currently line 178), so it becomes the last table row before the blank line and `## Reference`.
- Touch nothing else in the file.

## Review Focus

- The row's cited facts must hold at build time: `tests/statusline.test.js` defines `linkedName(dir)` (line 26: `color.link(\`${pathToFileURL(dir).href}/\`, path.basename(dir))`) and its two `renderProject` link tests assert `Code%20Workspaces` and a `/` before the BEL (lines 263-272) — verified while authoring this plan.
- The table must stay one contiguous table: no blank line inserted between row 178 and the new row, and the blank line before `## Reference` kept.
- The new row must have exactly two cells (three `|` delimiters at row level), matching the `| Pattern | Why It Fails in This Project |` header.

---

### Task 1: Add the pathToFileURL row

**Files:**
- Modify: `.claude/skills/windows-checkout-test-parity/SKILL.md:178` (insert one line after it)

**Interfaces:**
- Consumes: none
- Produces: none

- [ ] **Step 1: Confirm the row is absent (AC1 pre-check)**

Run: `grep -c "pathToFileURL" .claude/skills/windows-checkout-test-parity/SKILL.md`
Expected: FAIL — prints `0` (exit 1).

- [ ] **Step 2: Insert the row**

Insert this line verbatim directly after line 178 (the "Building a transcript `Read` fixture's `file_path`" row):

```
| Hard-coding a POSIX `file:///Users/…` literal as the expected output of a `pathToFileURL(dir).href` link | On win32, `pathToFileURL` resolves a POSIX-style fixture path against the current drive, so production correctly prints `file:///D:/Users/…` and the literal fails on Windows only (`tests/statusline.test.js`'s two `renderProject` link tests, #3886). Derive the expected link from `pathToFileURL` itself (the file's `linkedName(dir)`) instead of a `process.platform` branch holding two literals, and keep each test's own point as a separate literal check that does not depend on the derivation (`Code%20Workspaces`, a `/` before the BEL) |
```

- [ ] **Step 3: Verify AC1.1 (row present, names #3886 and pathToFileURL) and table shape**

Run: `grep -n "Hard-coding a POSIX \`file:///Users/…\` literal" .claude/skills/windows-checkout-test-parity/SKILL.md`
Expected: exactly one hit at line 179, and that line contains both `#3886` and `pathToFileURL`. Line 180 is blank and line 181 is `## Reference`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/windows-checkout-test-parity/SKILL.md
git commit -m "Add pathToFileURL-expectation pitfall row to windows-checkout-test-parity skill — refs #3917"
```

AC2.1 (`npm test` stays green) is covered by `/build`'s Common Step 5 final verification, not a per-task step.

---

## Self-review

- **Spec coverage:** Deliverable (one verbatim row at the named position) → Task 1 Step 2. AC1 → Step 3. AC2 → Common Step 5.
- **Placeholders:** none.
- **Proportion:** one task, one line of content; plan length is dominated by the verbatim row the spec fixes.
