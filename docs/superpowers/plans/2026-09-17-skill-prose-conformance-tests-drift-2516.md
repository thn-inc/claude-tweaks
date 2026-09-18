# Skill drift: skill-prose-conformance-tests Project Conventions (#2516) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `.claude/skills/skill-prose-conformance-tests/SKILL.md`'s Project Conventions bullet describing `npm test`'s file-selection mechanism so it names the current `tools/run-tests.js` implementation instead of the retired shell `find` invocation.

**Architecture:** Single-line prose replacement in one markdown file — no code, no behavioral surface, no new tests.

**Tech Stack:** Markdown.

**Spec:** `.claude-tweaks/pipelines/2026-09-17T212020-record-2516/work/2516-spec.md` (materialized from GitHub issue #2516)

## Global Constraints

- Replace the bullet verbatim with the spec's Proposed text — no paraphrasing, no additional edits elsewhere in the file.
- `tests/package-json-test-script.test.js` already pins `package.json` itself (not this skill markdown) and is unaffected by this change — do not modify it.

---

### Task 1: Update the Project Conventions bullet

**Files:**
- Modify: `.claude/skills/skill-prose-conformance-tests/SKILL.md:179`

**Interfaces:**
- Consumes: nothing (no upstream task)
- Produces: nothing (no downstream task)

- [ ] **Step 1: Confirm current text**

Run: `grep -n "find tests tools/upstream-drift/tests" .claude/skills/skill-prose-conformance-tests/SKILL.md`
Expected: FAIL (i.e. matches) — prints line 179 with the stale `find`-based bullet, proving the target text is still present before editing.

- [ ] **Step 2: Replace the bullet**

Replace the line at `.claude/skills/skill-prose-conformance-tests/SKILL.md:179`:

Current:
```
- `npm test` resolves its file list with `find tests tools/upstream-drift/tests -name '*.test.js'` — a new file under `tests/**` is picked up with no registration step.
```

With:
```
- `npm test` resolves its file list via `tools/run-tests.js`'s `listTestFiles` walk over `tests/` and `tools/upstream-drift/tests/` for `*.test.js` files — a portable Node reimplementation of the former shell `find ... | sort` invocation, replaced for Windows `cmd.exe` compatibility (#2043). Same file set, same behavior: a new file under `tests/**` is still picked up with no registration step.
```

- [ ] **Step 3: Verify the replacement**

Run: `grep -n "find tests tools/upstream-drift/tests" .claude/skills/skill-prose-conformance-tests/SKILL.md`
Expected: PASS — no output (the stale phrase is gone).

Run: `grep -n "listTestFiles.*walk over" .claude/skills/skill-prose-conformance-tests/SKILL.md`
Expected: PASS — one match, the new bullet.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/skill-prose-conformance-tests/SKILL.md
git commit -m "Fix skill drift: skill-prose-conformance-tests Project Conventions bullet now names tools/run-tests.js"
```

---

## Self-review

- **Spec coverage:** the spec's single Deliverable (bullet text update) and single Acceptance Criterion (bullet describes the current mechanism) are both covered by Task 1.
- **Placeholders:** none.
- **Type consistency:** n/a — no code.
