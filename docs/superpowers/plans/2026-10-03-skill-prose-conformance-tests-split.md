# Skill-Prose-Conformance-Tests Sidecar Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `.claude/skills/skill-prose-conformance-tests/SKILL.md` back under the plugin's 46080-byte soft bloat ceiling by extracting its three most specialized, least-frequently-needed procedures into a lazy-loaded sidecar file.

**Architecture:** Cut the three sections verbatim from `SKILL.md`, paste them unmodified into a new `advanced-proof-patterns.md` in the same directory, and replace the cut span in `SKILL.md` with a short pointer paragraph that names when to read the sidecar.

**Tech Stack:** Markdown only — no code, no test runner involvement (`bloatReport()` is exercised only against synthetic fixtures in `tests/bin-lib/skill-audit/bloat.test.js`; no `npm test` suite currently scans the live `.claude/skills` corpus for this ceiling, so this task has no red/green test cycle — verification is by direct byte count and content diff).

**Spec:** `.claude-tweaks/pipelines/2026-10-03T060551-record-2738-2737/spec-2738/work/2738-spec.md` (record #2738)

## Global Constraints

- The extracted span must land in the sidecar **byte-for-byte identical** to its current form in `SKILL.md` — no rewording, no reformatting.
- `SKILL.md`'s only other change is the pointer paragraph replacing the cut span — nothing else in the file may change.
- `SKILL.md` must measure under 46080 bytes after the edit.

## Review Focus

- Pointer paragraph must still mention all three extracted procedures by name/topic, so a reader scanning `SKILL.md` alone can find the right trigger to load the sidecar.
- The cut must not accidentally include or exclude the blank-line separators that delimit sections elsewhere in the file (would shift surrounding spacing).
- The sidecar file must not silently pick up a stray trailing blank line or truncated last paragraph from a miscounted `sed` range.
- No other section of `SKILL.md` (Anti-Patterns table above, Reference section below) may shift content as a side effect of the edit.
- The new sidecar file is a sibling of `SKILL.md`, not nested under a different directory, so relative lazy-load conventions in this skill's directory keep working.

---

### Task 1: Extract the three advanced-proof-pattern sections into a sidecar file

**Files:**
- Modify: `.claude/skills/skill-prose-conformance-tests/SKILL.md:227-274` (replace with pointer paragraph)
- Create: `.claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md`

**Interfaces:**
- Consumes: nothing (pure prose restructuring, no code interfaces)
- Produces: nothing downstream depends on new symbols; the pointer paragraph's exact wording is the only "contract" a future reader relies on

- [ ] **Step 1: Capture the current over-budget byte count and the exact span to extract**

Run:
```bash
wc -c .claude/skills/skill-prose-conformance-tests/SKILL.md
sed -n '225,276p' .claude/skills/skill-prose-conformance-tests/SKILL.md
```
Expected: `48580 .claude/skills/skill-prose-conformance-tests/SKILL.md` (or close — some drift is fine since the record's premise was re-verified at materialize time; what matters is the printed count is over 46080) and the second command's output shows line 226 blank, line 227 starting `## Proving discrimination without editing the tree`, line 259 blank, line 260 `## Bumping the repo-wide Anti-Patterns row-count pin`, line 270 blank, line 271 `## Choosing a pin/sniff signal empirically`, line 274 blank, line 275 `## Reference`.

- [ ] **Step 2: Create the sidecar file with the extracted span verbatim**

```bash
{
  echo '# Advanced Proof Patterns — skill-prose-conformance-tests'
  echo ''
  echo 'Lazy-loaded from `SKILL.md` (this skill'"'"'s directory). Read this file when a go-red proof needs zero-mutation verification, a change adds or removes an Anti-Patterns row, or a new detection signal needs corpus validation before it'"'"'s trusted.'
  echo ''
  sed -n '227,274p' .claude/skills/skill-prose-conformance-tests/SKILL.md
} > .claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md
```

- [ ] **Step 3: Verify the sidecar's extracted body is byte-for-byte identical to the original span**

Run:
```bash
diff <(sed -n '227,274p' .claude/skills/skill-prose-conformance-tests/SKILL.md) <(tail -n +5 .claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md)
```
Expected: no output (the two spans are identical — `tail -n +5` skips the new file's own 4-line header: title, blank, intro, blank).

- [ ] **Step 4: Replace the extracted span in SKILL.md with the pointer paragraph**

Use the Edit tool (not sed, since the replacement text itself contains characters sed would need escaping) to replace the exact block spanning lines 227-274 — from `## Proving discrimination without editing the tree` through the blank line immediately before `## Reference` — with:

```markdown
## Advanced proof patterns — lazy-loaded

Three specialized procedures — proving a pin's red state with zero tree mutation, bumping the repo-wide Anti-Patterns row-count pin, and choosing a pin/sniff signal empirically from a corpus scan — are lazy-loaded from `advanced-proof-patterns.md` alongside this file. Read it when a go-red proof needs zero-mutation verification, a change adds or removes an Anti-Patterns row, or a new detection signal needs corpus validation before it's trusted.
```

followed by one blank line before `## Reference` (matching the file's existing blank-line-between-sections convention).

- [ ] **Step 5: Verify SKILL.md is back under the soft ceiling and the surrounding sections are untouched**

Run:
```bash
wc -c .claude/skills/skill-prose-conformance-tests/SKILL.md
grep -n "^## " .claude/skills/skill-prose-conformance-tests/SKILL.md
```
Expected: byte count under 46080, and the heading list shows `## Anti-Patterns`, `## Advanced proof patterns — lazy-loaded`, `## Reference` in that order (the three extracted headings are gone from `SKILL.md`; no other heading moved or disappeared).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/skill-prose-conformance-tests/SKILL.md .claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md
git commit -m "docs: Split advanced proof patterns out of skill-prose-conformance-tests — refs #2738"
```
