# Skill-Prose-Conformance-Tests Byte-Pinning Example Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct `.claude/skills/skill-prose-conformance-tests/SKILL.md`'s byte-pinning worked example, which still cites a `SWEEP_SNIPPET` pattern in `tests/curation-judge-stagepath.test.js` that #738 replaced with a direct CLI-verb probe.

**Architecture:** Replace the stale paragraph (plus its two code fences and the connecting sentence) with the corrected paragraph the issue's own "Proposed" block supplies verbatim. Pure prose edit, one file.

**Tech Stack:** Markdown only — no code, no test runner involvement.

**Spec:** `.claude-tweaks/pipelines/2026-10-03T060551-record-2738-2737/spec-2737/work/2737-spec.md` (record #2737)

## Global Constraints

- The replacement paragraph must match the issue's "Proposed" block exactly, verbatim.
- Nothing else in `SKILL.md` changes.

## Review Focus

- The replaced span must fully remove both now-stale code fences (the `assert.ok(...)` fence and the `spawnSync(...)` fence) — a partial replacement leaving one fence orphaned would break the surrounding prose.
- The following section (`**Lighter variant: pin only the flags...`) must be untouched and must still read coherently immediately after the new paragraph.
- No other heading or section in the file may shift.
- `grep -n "SWEEP_SNIPPET"` against `SKILL.md` must return nothing after the edit.

---

### Task 1: Replace the stale byte-pinning worked example

**Files:**
- Modify: `.claude/skills/skill-prose-conformance-tests/SKILL.md:90-102`

**Interfaces:**
- Consumes: nothing (pure prose restructuring)
- Produces: nothing downstream depends on new symbols

- [ ] **Step 1: Confirm the exact span to replace**

Run:
```bash
grep -n "SWEEP_SNIPPET" .claude/skills/skill-prose-conformance-tests/SKILL.md
sed -n '89,103p' .claude/skills/skill-prose-conformance-tests/SKILL.md
```
Expected: three `SWEEP_SNIPPET` matches (in the paragraph text and both code fences), and the second command shows line 89 blank, line 90 starting `Reach for **byte-pinning**...`, line 100 a closing ```` ``` ````, line 101 blank, line 102 ending `...asserting that the contract's sentence about it is true.`, line 103 blank, line 104 starting `**Lighter variant: pin only the flags...`.

- [ ] **Step 2: Replace lines 90-102 with the corrected paragraph**

Use the Edit tool to replace the exact block from `Reach for **byte-pinning**...` (line 90) through `...asserting that the contract's sentence about it is true.` (line 102) — including both code fences in between — with this single paragraph (verbatim, from the issue's own Proposed block):

```markdown
Reach for **byte-pinning** when the probe has to wrap the snippet in fixture-specific surroundings — then assert it byte-identical **and** execute it. `tests/curation-judge-stagepath.test.js` no longer demonstrates this: #738 promoted the shadow sweep from a bash snippet embedded in `curation-engine.md` §4 to a first-party CLI verb (`bin/hooks.js sweep-shadow`, `bin/lib/hooks/sweep-shadow.js`), and the test's own header comment says its probes now spawn that verb directly against a fixture checkout instead of byte-pinning a `SWEEP_SNIPPET` string — a live-tool probe, not a byte-pinned snippet execution. `tests/staged-patch-contract.test.js` covers the other half — it probes `git apply --check`'s real accept/reject discrimination on this machine instead of asserting that the contract's sentence about it is true.
```

Preserve the existing blank line immediately after this paragraph (before `**Lighter variant...`).

- [ ] **Step 3: Verify the stale pattern is gone and the surrounding text is intact**

Run:
```bash
grep -n "SWEEP_SNIPPET" .claude/skills/skill-prose-conformance-tests/SKILL.md
grep -n "no longer demonstrates this" .claude/skills/skill-prose-conformance-tests/SKILL.md
sed -n '88,94p' .claude/skills/skill-prose-conformance-tests/SKILL.md
```
Expected: the first command returns no output (no matches); the second command returns exactly one match on the new paragraph; the third command shows the new paragraph followed immediately by a blank line and then `**Lighter variant: pin only the flags, not the side effects.**...` — nothing else shifted.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/skill-prose-conformance-tests/SKILL.md
git commit -m "Fix skill-prose-conformance-tests byte-pinning example — refs #2737"
```
