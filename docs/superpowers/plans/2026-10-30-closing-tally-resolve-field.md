# Closing-tally Resolve-lane field (#4566) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/claude-tweaks:backlog refine #N` run that resolves decisions reports them as `resolved` in its closing tally instead of an all-zero tally with every resolve line unclassified.

**Architecture:** `plugin/bin/lib/closing-tally/closing-tally.js` gains one tally field, `resolved`, fed by one new `PATTERNS` entry matching a new Resolve-lane log template. The template lives in `plugin/skills/backlog/refine-closing-summary.md`'s template block (the tally's documented vocabulary), and `plugin/skills/backlog/refine-record.md` Step 4's log step cites it instead of prescribing its own `Backlog refine #{n}:` line.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T215002-record-4566/work/4566-spec.md` (materialized from GitHub issue #4566)

## Global Constraints

- Field name `resolved`, label `resolved`, positioned in `FIELDS` immediately after `needsDecision` and before `skipped` — so `skipped` and `failed` stay the line's last two fields. Rendered tally line shape: `{n} priority set · {n} Related updated · {n} granted · {n} flagged back · {n} dependency-repair · {n} needs-decision · {n} resolved · {n} skipped · {n} failed`.
- Template (exact, inside refine-closing-summary.md's fenced template block, placed after the last `AUTO {time} — Backlog refine: skipped …` line and before the `FAILED {time}` line): `AUTO {time} — Backlog refine: resolved decision on #{n} as {choice(s)} — {labels/state changed}.`
- Classifier pattern: `{ field: 'resolved', re: /Backlog refine: resolved decision on #/ }`.
- Keep the per-record max-of-two-forms rule unchanged (spec Deliverable 2) — `resolved` has only the template source, so it counts by occurrence like every other template-only field.
- AC: "Every existing closing-tally test passes unchanged apart from the added field." Existing tests change only to add `resolved: 0` to literal count objects / `0 resolved ·` to literal tally-line strings. The legacy `IGNORED_PATTERNS` entry `/Backlog refine #\d+:/` and its test (`#3267: known /backlog narration (Resolve-lane "Backlog refine #N:" lines) is not reported as unclassified`) stay — only the code comment above `IGNORED_PATTERNS` is updated to call it the pre-#4566 Resolve-lane form.
- Governing project skill `.claude/skills/prose-code-twin-pin/SKILL.md`, verbatim: "A prefix-gated classifier sees every file's lines under that prefix. `plugin/bin/lib/closing-tally/closing-tally.js` (#2729) hardcodes two other files' `Backlog refine:` lines in `IGNORED_PATTERNS`, so rewording either falls back to `unclassified`. Grep the key repo-wide (`grep -rn 'Backlog refine: ' plugin/skills/`) and pin the live templates". Task 2's test reads the live template from refine-closing-summary.md, never a retyped copy.
- Module comment rule (closing-tally.js header): "a new field belongs there [refine-closing-summary.md] first, then here."
- Commit messages: `{Verb} {what} — {detail}`, `refs #4566` (never `closes`/`fixes`), trailer `Claude-Session: https://claude.ai/code/session_01YPgdwSSj28FgeDVv7T1KXW`.

## Review Focus

1. The real observed lines (from run `2026-10-30T043043-backlog-standalone`) carry a doubled prefix — `- AUTO 05:53:50 — Backlog refine: Backlog refine: resolved decision on #3944 as keep (human-confirmed) — …` — they must count as `resolved` for #3944 (issue capture is the first `#N` after the first `Backlog refine:`). Pinned in Task 1.
2. A `log-decision.js --step "refine #{n}"` line (`- AUTO t — refine #70: Backlog refine: resolved decision on #70 as keep — none.`) must not be swallowed by the legacy `/Backlog refine #\d+:/` ignore pattern. Pinned in Task 2 (filled live template with that step prefix).
3. A choice text containing another `#N` (e.g. `as close — duplicate of #12`) must still attribute to the record after `on #`. Covered by capture order; Task 1's test uses `#3944`/`#4456` lines whose tails cite `#3977`/`#4445` — asserting 2 resolved (not miscounted).
4. Two resolve lines for the same record (two decision comments resolved in one run) count 2 — same-source occurrence rule. Covered by unchanged mechanics; not separately tested (out of spec scope).
5. A resolve line under a section other than `## /backlog` still counts (template lines are section-agnostic, same as every other `Backlog refine:` template). Unchanged behavior.

---

### Task 1: Add the `resolved` tally field

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/closing-tally/closing-tally.js` (FIELDS line 13, LABELS 17-26, PATTERNS 33-43, comments at 10-12, 60-67, 196-198)
- Test: `tests/bin-lib/closing-tally/closing-tally.test.js`
- Test: `tests/bin-lib/closing-tally/cli.test.js`

**Interfaces:**
- Produces: `FIELDS` includes `'resolved'` after `'needsDecision'`; `LABELS.resolved === 'resolved'`; `computeClosingTally(text).counts.resolved`.

- [ ] **Step 1: Write the failing tests**

In `cli.test.js`, a new test `--run counts two Resolve-lane lines as 2 resolved with nothing unclassified (#4566, real input)`: write a temp `{dir}/decisions.md` holding `## /backlog` plus the two observed lines verbatim (copy them from `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-30T043043-backlog-standalone/decisions.md`, both lines, unedited), run `run(['--run', dir], deps)`, assert exit 0, `envelope.counts.resolved === 2`, `envelope.unclassified` deepEqual `[]`, and `envelope.line === '0 priority set · 0 Related updated · 0 granted · 0 flagged back · 0 dependency-repair · 0 needs-decision · 2 resolved · 0 skipped · 0 failed'`.

Update existing literals only to add the field: closing-tally.test.js's FIXTURE deepEqual gains `resolved: 0`; `ZERO` gains `resolved: 0`; both `renderTallyLine` expected strings and cli.test.js's line-29 string gain `0 resolved · ` between `needs-decision · ` and the skipped count.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/closing-tally/`
Expected: FAIL (the new test sees `counts.resolved` undefined and two unclassified lines; updated literals mismatch).

- [ ] **Step 3: Implement**

Add the field, label and pattern per Global Constraints. Update the three comments: the field-order example (lines 10-12) and `renderTallyLine`'s example (196-198) gain `0 resolved · `; the `IGNORED_PATTERNS` comment's last clause becomes: refine-record.md Step 4's pre-#4566 Resolve-lane per-record line (`Backlog refine #{n}: …`), retained so a run dir written by an older installed build does not surface it as drift — the current form is refine-closing-summary.md's `resolved decision on #{n}` template, counted under `resolved`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/closing-tally/ tests/backlog-refine-flagback-divergence.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Go-red proof**

Temporarily delete the new `PATTERNS` entry, re-run `node --test tests/bin-lib/closing-tally/cli.test.js` — Expected: the new test FAILS; restore it.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/closing-tally/closing-tally.js tests/bin-lib/closing-tally/closing-tally.test.js tests/bin-lib/closing-tally/cli.test.js
git commit -m "Add a resolved field to closing-tally — refs #4566"
```

---

### Task 2: Resolve-lane log template, Step 4 citation, live-template pin

**Role:** integration

**Files:**
- Modify: `plugin/skills/backlog/refine-closing-summary.md` (template block lines 16-30; tally example line 50; the paragraph at line 32)
- Modify: `plugin/skills/backlog/refine-record.md` (Step 4 item 5, line 212)
- Modify: `docs/journeys/refine-the-backlog-through-decision-lanes.md` (line 47's tally example string)
- Test: `tests/bin-lib/closing-tally/closing-tally.test.js`

**Interfaces:**
- Consumes: Task 1's `computeClosingTally(text).counts.resolved`.

- [ ] **Step 1: Write the failing test**

In closing-tally.test.js, test `#4566: refine-closing-summary.md's live Resolve-lane template counts as resolved, not unclassified`: read `plugin/skills/backlog/refine-closing-summary.md`; find lines starting `AUTO {time} — Backlog refine: resolved decision on` — assert exactly 1. Fill it twice (`{time}`→`10:00:00`, `{choice(s)}`→`keep`, `{labels/state changed}`→`needs:decision removed`; `{n}`→`70` then `71`), strip the leading `AUTO {time} — ` stand-in and prefix each with `- AUTO 10:00:00 — refine #{n}: ` (the shape `log-decision.js --step "refine #{n}"` writes), join under `## /backlog`. Assert `counts` deepEqual `{ ...ZERO, resolved: 2 }` and `unclassified` deepEqual `[]`.

Also in the same test, assert refine-record.md cites the template: its text matches `/refine-closing-summary\.md`'s Resolve-lane template/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/closing-tally/closing-tally.test.js`
Expected: FAIL — template line count 0.

- [ ] **Step 3: Edit the prose**

- refine-closing-summary.md: insert the template line (Global Constraints) in the block. After the block's existing "The closing summary below counts these lines by type — …" sentence, add one sentence: the `resolved decision` line is written by `refine-record.md` Step 4 (the Resolve lane), not this file's apply pass, and feeds the tally's `resolved` count. Tally example (line 50) gains `0 resolved · ` before `0 skipped`.
- refine-record.md Step 4 item 5: replace the `` `Backlog refine #{n}: {choice(s)} — {labels/state changed}` `` prescription with: `{text-file}` holds one line, `refine-closing-summary.md`'s Resolve-lane template minus its `AUTO {time} — ` prefix (log-decision.js writes that) — keep the rest of the sentence (Text-from-git-or-a-user paragraph, free-text rationale) unchanged.
- Journey doc line 47: the tally example string gains `0 resolved · ` before `0 skipped`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/closing-tally/ tests/backlog-refine-flagback-divergence.test.js tests/backlog-refine-grant-divergence.test.js tests/backlog-refine-closing-render.test.js tests/backlog-refine-resolve-lane.test.js tests/standalone-run-dir-closeout-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Go-red proof**

Temporarily remove the inserted template line from refine-closing-summary.md, re-run Step 4's closing-tally test — Expected: FAIL; restore.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/backlog/refine-closing-summary.md plugin/skills/backlog/refine-record.md docs/journeys/refine-the-backlog-through-decision-lanes.md tests/bin-lib/closing-tally/closing-tally.test.js
git commit -m "Log Resolve-lane decisions through a closing-summary template — refs #4566"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Task 2 Step 3; Deliverable 2 → Task 1 Step 3; Deliverable 3 → Task 1 Step 1 (two real resolve lines via `--run`) and Task 2 Step 1. AC1 → Task 1's cli test (`--run`, `2 resolved`, empty `unclassified`). AC2 → Task 1 Step 1's literal-only updates + Step 4 run.
- **Placeholders:** none.
- **Type consistency:** `resolved` field/label used identically in both tasks.
