# prose-code-twin-pin Anti-Patterns Trim (#3200) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trim the five over-long Anti-Pattern rows of `.claude/skills/prose-code-twin-pin/SKILL.md` so each states its reusable constraint without narrating the incident that revealed it.

**Architecture:** Docs-only, in-place replacement of five markdown table rows in one maintainer-side skill file (`.claude/skills/` is not part of the shipped `plugin/` payload). Each row keeps its file:identifier citations, its `#NNNN` citation and its actionable instruction; commit hashes, who caught it, and "shipped without X" sentences go.

**Tech Stack:** Markdown; verification via `plugin/bin/lib/skill-audit/bloat.js`'s `bloatReport`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T191810-record-3200/work/3200-spec.md` (materialized from GitHub issue #3200)

## Global Constraints

- Edit only rows L117-L121 of `.claude/skills/prose-code-twin-pin/SKILL.md` (the record's L99-L103, re-derived at HEAD `ffe20b98` — the file grew 18 lines since the record was filed). Rows L114-L116 and L122-L124 stay byte-identical.
- Row L119 keeps #3138's corrected claim (`IGNORED_PATTERNS` hardcodes the two phrases) — #3138 is closed and its wording already landed; do not revert it.
- Row L121's replacement is the record's own **Proposed** text, verbatim.
- Bloat-scanner row threshold at HEAD: 476 B (corpus median 238 B over 89 rows, ×2).

## Review Focus

- A trimmed row that drops its actionable instruction (the grep command or the assertion shape) — check each new row still says what to do differently.
- A trimmed row that drops the file:identifier citation the reader greps for (`resolve.js`/`REGISTRY`, `closing-tally.js`/`IGNORED_PATTERNS`, `scan.js`/`SECRET_NAME`, `pr-body.js`/`composePrEarlyBody`, `preflight.js`/`parseChecklist`).
- An accidental edit to a neighboring row (L114-L116, L122-L124) — diff must touch exactly five lines.
- Table breakage: a stray unescaped `|` inside a cell (L117 keeps none; the original L120 `\|` alternation example is removed, not re-added).
- L121 still over the 476 B threshold after the trim (1036 B) — expected: the record pins that row's exact replacement text; it is the worked example, not a size target.

---

### Task 1: Replace the five over-long Anti-Pattern rows

**Files:**
- Modify: `.claude/skills/prose-code-twin-pin/SKILL.md:117-121`

**Interfaces:**
- Consumes: none
- Produces: none (docs-only)

- [ ] **Step 1: Baseline the scan (red)**

Run (from the worktree root):
`node -e 'const fs=require("fs"),p=require("path");const {bloatReport}=require("./plugin/bin/lib/skill-audit/bloat.js");const d=".claude/skills";const c=fs.readdirSync(d).map(x=>p.join(d,x,"SKILL.md")).filter(f=>fs.existsSync(f));console.log(bloatReport(p.join(d,"prose-code-twin-pin/SKILL.md"),c))'`
Expected: FAIL signature — `long-row L117: 760 B`, `L118: 782 B`, `L119: 1013 B`, `L120: 879 B`, `L121: 1627 B` all listed (plus L122-L124).

- [ ] **Step 2: Replace each row in place, exact text**

Replace line 117 (starts `| Writing a pinning test that only checks one direction`) with:

```
| Writing a pinning test that only checks one direction (code has every prose row, but not the reverse) when the two sides name the same closed vocabulary | Assert set equality both ways — a prose row with no code twin drifts as much as the reverse. **Exception: a code side routing a superset of producers** (`resolve.js`'s SECTION_MAP) — pin containment per producer, deriving the producers live (`tests/bin-lib/console/resolve.test.js` iterates `REGISTRY`, #2773) |
```

Replace line 118 (starts `| Guarding a self-filtering scan with a loose floor`) with:

```
| Guarding a self-filtering scan with a loose floor (`checked >= N`, N below the live match count) | A scan that skips inputs it finds nothing in can lose them silently when a regex or the prose drifts; a floor only catches total collapse. Pin the exact matched set (`assert.deepStrictEqual(checkedIds.sort(), [...])`, as `resolve.test.js`'s registry audit does, #2773) — `parse-signal-discipline`'s "couldn't parse" vs "doesn't apply" rule applied to a test's own scan |
```

Replace line 119 (starts `| Scoping the prose side of a twin`) with:

```
| Scoping the prose side of a twin to the one file whose table the code was modeled on, when the code keys on a shared prefix | A prefix-gated classifier sees every file's lines under that prefix. `plugin/bin/lib/closing-tally/closing-tally.js` (#2729) hardcodes two other files' `Backlog refine:` lines in `IGNORED_PATTERNS`, so rewording either falls back to `unclassified`. Grep the key repo-wide (`grep -rn 'Backlog refine: ' plugin/skills/`) and pin the live templates |
```

Replace line 120 (starts `| Searching for the code twin only among object keys`) with:

```
| Searching for the code twin only among object keys, `switch` cases, and array literals | A regex alternation is a closed vocabulary too, and can be born out of sync: `plugin/skills/harness-health/dream-pass.md`'s credential-word list against `plugin/bin/lib/dream/scan.js`'s `SECRET_NAME` (#2968), pinned both ways by `tests/bin-lib/dream/scan.test.js`. When step 1 greps for a twin, also grep each term inside regex source strings (`grep -rn 'PASSWD' plugin/bin/`) |
```

Replace line 121 (starts `| Reading "table or enumerated list"`) with the record's Proposed text:

```
| Reading "table or enumerated list" so literally that a fenced template block is skipped, or looking for the code twin only among data literals | A composer function's output is a twin too, and its prose side is usually a fenced example, not a table — e.g. `plugin/bin/lib/flow/pr-body.js`'s `composePrEarlyBody` against the `markdown`-tagged "Composed shape" fence in `plugin/skills/_shared/pr-early-run-lifecycle.md` Step 3 (#2997). A test asserting each side's literals separately, never one against the other, is the citation-sweep shape the second row above rejects: a changed phase row or delimiter on either side leaves both suites green. Extract the fence by structure (the only `markdown`-tagged fence under the heading), call the composer with the fence's own placeholders as its arguments, and `assert.strictEqual` the two strings. Also grep each fixed line of a fenced template against `plugin/bin/` — it can surface a second code copy (e.g. `plugin/bin/lib/flow/preflight.js`'s `parseChecklist` retypes two of the markers) |
```

- [ ] **Step 3: Re-run the scan (green)**

Run the Step 1 command again.
Expected: no `long-row` line for L117, L118, L119 or L120; `long-row L121: 1036 B` (record-pinned text); L122-L124 unchanged at 1335/1417/1225 B. Then `git diff --stat` shows exactly `1 file changed, 5 insertions(+), 5 deletions(-)`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/prose-code-twin-pin/SKILL.md
git commit -m "Trim prose-code-twin-pin Anti-Pattern rows — drop incident narration, keep constraint and citations (refs #3200)"
```

---

## Self-review

- **Spec coverage:** AC "trim all five flagged rows" → Task 1 Step 2 (five replacements); Deliverables' L103 Proposed text → row 121 verbatim; "keep the file:identifier citation and the actionable instruction" → Review Focus lines 1-2 and the Step 2 texts.
- **Placeholders:** none.
- **Out of scope, noted:** rows L122-L124 (added after the record was filed) also exceed the threshold; logged to the open-items ledger rather than folded in.
