# IL-162 Removal-Condition Truncation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the sentence that `docs/incident-log.md`'s IL-162 entry stops in the middle of, in its **Removal condition** paragraph.

**Architecture:** A one-file prose fix. Git history shows the sentence was already cut off in the commit that added IL-162 (`89c66224ab` on PR #2973, squashed to `0c9205fce`), so there is no original wording to restore. The ending is rebuilt instead, following the shape of the previous entry's Removal condition and the `[IL-162]` rule in `docs/donts.md`.

**Tech Stack:** Markdown; `node --test` (full suite as regression only).

**Spec:** `.claude-tweaks/pipelines/2026-10-19T043251-record-3187/work/3187-spec.md`

## Global Constraints

- Change only the truncated paragraph: leave other IL entries and the IL-162 body text above the Removal condition alone.
- Keep the line wrap the file already uses (about 100 columns) and the `**Removal condition:**` lead-in.
- `docs/incident-log.md` must end with a trailing newline.
- Commit message: `{Verb} {what} — {detail}` style, `refs #3187` (never `closes`/`fixes`).

## Review Focus

- The rebuilt clause must agree with `docs/donts.md:198`'s `[IL-162]` rule (cap the input before an unbounded-quantifier regex runs over externally-sized text). A clause that describes a different mechanism would mislead whoever later decides to retire the entry.
- Other tests read `docs/incident-log.md` (19 files under `tests/` mention it, none mention IL-162), so the full suite must stay green.
- No other `## ` section may end mid-sentence (Acceptance Criterion 2). Re-run the section-ending scan after the edit.

---

### Task 1: Complete IL-162's Removal condition sentence

**Files:**
- Modify: `docs/incident-log.md:1781-1782`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks use.

- [ ] **Step 1: Confirm the truncation (pre-check)**

Run: `sed -n 1781,1784p docs/incident-log.md`
Expected: line 1782 ends `...or a shared bounded-match helper such`, followed by a blank line and `## IL-163 — ...`.

- [ ] **Step 2: Replace lines 1781-1782 with the completed sentence**

Exact replacement text (wrapped to match the file):

```markdown
**Removal condition:** retire this entry and its `docs/donts.md` rule once a mechanical check (a
lint for unbounded quantifiers over externally-sized input, or a shared bounded-match helper such
regex call sites are required to route through) flags a regex run over transcript, tool-output,
or issue-body text with no input-length cap in front of it.
```

- [ ] **Step 3: Verify every section ends with a full sentence (AC1.1 complete sentence, AC1.2 trailing newline, AC2.1 no other truncated entry)**

Run: `grep -n "bounded-match helper such$" docs/incident-log.md`
Expected: no output (exit 1).
Run: `tail -c 1 docs/incident-log.md | xxd`
Expected: `0a`.
Visually scan each `## IL-` section's last line, or run a sentence-boundary scan: the only flagged sections should be ones whose closing punctuation sits inside a quote (`."`).

- [ ] **Step 4: Commit**

```bash
git add docs/incident-log.md
git commit -m "Complete IL-162's truncated Removal condition — sentence cut off since the entry was added (refs #3187)"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (finish the sentence) → Step 2. Deliverable 2 (check git history) → already done while planning (Architecture). AC 1 (complete sentence + trailing newline) → Step 3. AC 2 (no other truncated entry) → Step 3's scan.
- **Placeholders:** none.
- **Proportion:** one task, one paragraph, which is the right size for the spec.
