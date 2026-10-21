# Group identical fan-out rows in the skill load delta table (#3456) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `load-delta.js`'s text table collapses entry points that moved by an identical (ΔFloor, ΔClosure, new-unresolved) into one row, so a `_shared/*.md` edit no longer prints a wall of identical rows.

**Architecture:** One pure grouping pass inside `renderText` (text path only), between `rows` and the row-printing loop. `--json` never reaches `renderText`, so its output is untouched by construction; a test pins it anyway. The step file that tells the reviewer how to read the table, and its verbatim-quote test, gain the grouped row's shape.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T065136-record-3456/work/3456-spec.md` (materialized from GitHub issue #3456)

Scope keywords: renderText, load-delta

## Global Constraints

- `node plugin/bin/load-delta.js --json` output is byte-identical before and after the change on the same fixture (spec AC2).
- A group of one renders exactly as today's row (`| {entry}{mark} | {floor} | {signed dFloor} | {closure} | {signed dClosure} | {miss} |`) — every existing table test keeps passing unedited.
- Commit messages: `{Verb} {what} — {detail}`, `refs #3456` (never `closes`/`fixes`).

## Review Focus

1. Two entries with the same ΔFloor/ΔClosure but different **New unresolved** must stay separate rows (the key includes the unresolved list, not just the deltas) — pinned in Task 1's `renderText` unit test.
2. An `(added)`/`(removed)` entry must never merge into a group of plain entries with the same deltas (the mark would be lost) — the mark is part of the key; pinned in the same unit test.
3. A group of exactly 2 still collapses (the spec says "rows that share", no threshold); the 3-name cap only applies to the listing — pinned in the unit test.
4. Grouped rows' absolute Floor/Closure columns differ per entry — render `min–max` (en dash, each side `toLocaleString('en-US')`), or the single value when all equal — pinned by the fixture test (`21–25`, `42–46`) and the unit test (equal floors render one value).
5. Row order: groups appear at their first member's position in the existing (sorted) row order — pinned by the fixture test (`plugin:a` group before `plugin:d`).

---

### Task 1: Group identical rows in `renderText`, document the grouped row, pin both

**Files:**
- Modify: `plugin/bin/load-delta.js` (`renderText`, ~lines 223-234; add a grouping helper beside `newUnresolvedCell`)
- Modify: `plugin/skills/review/step3-skill-load-delta.md` (outcome 3, line 30; "Reading the table" bullet on `_shared/*.md`, line 35)
- Test: `tests/load-delta-cli.test.js` (new fixture test + `renderText` unit test; extend the outcome-line quote test's literal list)

Consumers of `renderText` (`git grep -n -F renderText -- tests plugin`): only `plugin/bin/load-delta.js:360` (the CLI's own text path) — `calibration-report.js` has an unrelated same-named function. Only test reader of the step file: `tests/load-delta-cli.test.js:361,372`. The prose `one row per entry point` appears only in the step file (`git grep -n -F 'one row per entry point' -- tests plugin docs` → `step3-skill-load-delta.md:30`).

**Interfaces:**
- Produces: `renderText(result, changedFiles, opts)` — signature unchanged; table body rows now grouped. Internal helper `groupRows(rows) -> Array<{ members: Row[] }>` (name free; not exported).

- [ ] **Step 1: Write the failing tests** in `tests/load-delta-cli.test.js`

  a. `test('AC1.1/AC1.2/AC2.1: a _shared edit moving 4 entries by one ΔClosure renders one grouped row; a different delta stays its own row; --json is per-entry and unchanged', …)` — fixture via `makeRepo`:
     - base: `plugin/skills/_shared/x.md` = `'shared\n'`; `plugin/skills/a/SKILL.md` = CITE; `b` = `${CITE}b\n`; `c` = `${CITE}cc\n`; `e` = `${CITE}eee\n`; `d` = `` `${CITE}Read \`part.md\` in this skill's directory.\n` ``; `plugin/skills/d/part.md` = `'p\n'`, where `CITE = 'Read \`_shared/x.md\`.\n'`.
     - head (uncommitted): append `'one added row\n'` to `_shared/x.md`, append `'more\n'` to `d/part.md`.
     - Text (`call([], dir).stdout`) — the table body is exactly these two rows (assert the lines after the `|---|` separator deep-equal):
       `| 4 entries: plugin:a, plugin:b, plugin:c, … +1 more | 21–25 | 0 | 42–46 | +14 | — |`
       `| plugin:d | 63 | 0 | 91 | +19 | — |`
     - JSON (`call(['--json'], dir)`): `roots[0].entries` deep-equals the five per-entry objects, e.g. `{ entry: 'plugin:a', floor: 21, dFloor: 0, closure: 42, dClosure: 14, newUnresolved: [] }`, … `plugin:b` 23/44, `plugin:c` 24/45, `plugin:d` 63/91/19, `plugin:e` 25/46 — the exact pre-change output (probed at authoring time against HEAD `247d90868`, see Self-review).
  b. `test('renderText groups by mark, deltas and new-unresolved; a pair groups; equal floors render one value', …)` — call the exported `renderText` with `{ status: 'ok', base: 'a'.repeat(40), baseKind: 'base', baseLabel: 'r', roots: [{ pluginRoot: 'plugin', entries: [...] }] }` and `[]`; entries (already sorted):
     - `p:a` floor 10 dFloor 0 closure 50 dClosure 5 newUnresolved `[]`
     - `p:b` floor 10 dFloor 0 closure 60 dClosure 5 newUnresolved `[]`
     - `p:c` floor 10 dFloor 0 closure 70 dClosure 5 newUnresolved `[{ citingFile: 'plugin/skills/c/SKILL.md', token: 'gone.md' }]`
     - `p:d` floor 5 dFloor 5 closure 5 dClosure 5 newUnresolved `[]` `added: true`
     - `p:e` floor 5 dFloor 5 closure 5 dClosure 5 newUnresolved `[]` (no mark)
     Expected body rows, in order:
       `| 2 entries: p:a, p:b | 10 | 0 | 50–60 | +5 | — |`
       `| p:c | 10 | 0 | 70 | +5 | 1: \`gone.md\` |`
       `| p:d (added) | 5 | +5 | 5 | +5 | — |`
       `| p:e | 5 | +5 | 5 | +5 | — |`
  c. AC3.1: extend `'step3-skill-load-delta.md quotes every outcome line the CLI prints, verbatim'`'s literal list with `'{count} entries: {e1}, {e2}, {e3}, … +{k} more'`.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `node --test tests/load-delta-cli.test.js`
  Expected: FAIL — the three new/extended tests (per-entry rows printed; step file lacks the grouped literal); every other test passes.

- [ ] **Step 3: Implement grouping in `plugin/bin/load-delta.js`**

  - Group key per row: `entryMark(r)`, `r.dFloor`, `r.dClosure`, and the row's `newUnresolved` mapped to `${u.citingFile}\u0000${u.token}`, sorted, joined — combined with a separator that cannot occur in them (`\u0001`). Groups keep first-appearance order (a `Map` keyed by that string preserves insertion order).
  - A group of one prints today's row unchanged.
  - A group of n ≥ 2 prints `| {n} entries: {names} | {range(floors)} | {signed dFloor} | {range(closures)} | {signed dClosure} | {miss} |`, where `{names}` is the first three members' `entry + entryMark(member)` joined with `, `, followed by `, … +{n-3} more` only when n > 3; `range(xs)` is `fmt(min)` when min === max, else `` `${fmt(min)}–${fmt(max)}` `` (U+2013); `{miss}` is `newUnresolvedCell` of the first member (identical across the group by the key).
  - Update the file's header comment line about the table if it names one-row-per-entry (it does not today — leave the header as is otherwise).

- [ ] **Step 4: Update `plugin/skills/review/step3-skill-load-delta.md`**

  - Outcome 3 (line 30): replace `— one row per entry point whose floor or closure changed;` with `— one row per entry point whose floor or closure changed, except that entry points with the same ΔFloor, ΔClosure, and New unresolved share one row, \`{count} entries: {e1}, {e2}, {e3}, … +{k} more\` (the first three names; the \`… +{k} more\` tail only past three), whose Floor and Closure cells show the \`min–max\` range across its members;` — rest of the line unchanged.
  - "Reading the table" bullet `A change to a \`_shared/*.md\` file shows on every entry point whose closure contains it.` — append: ` Those entries usually share one grouped row; an entry point listed on its own row moved by a different amount.`
  - File is ~4.5 KB against the 52,500 B rail — headroom is not a concern (`wc -c` before editing to confirm).

- [ ] **Step 5: Run tests to verify they pass**

  Run: `node --test tests/load-delta-cli.test.js`
  Expected: PASS, all tests (the existing `text outcome 3` test still matches its single-member rows).

- [ ] **Step 6: Commit**

  ```bash
  git add plugin/bin/load-delta.js plugin/skills/review/step3-skill-load-delta.md tests/load-delta-cli.test.js
  git commit -m "Group identical fan-out rows in the skill load delta table — one row per (ΔFloor, ΔClosure, new-unresolved) group, --json unchanged (refs #3456)"
  ```

---

## Self-review

- **Spec coverage:** Deliverable 1 (collapse rows, keep differing rows) → Step 3, tests 1a/1b. Deliverable 2 (`--json` unchanged) → JSON path untouched; test 1a pins the per-entry objects (AC2.1). Deliverable 3 (step file + quote test) → Steps 4 and 1c (AC3.1). AC1.1, AC1.2 → test 1a; AC2.1 → test 1a; AC3.1 → test 1c.
- **Fixture probe (authoring time, HEAD `247d90868`):** the fixture above, run through the current CLI, printed per-entry rows `plugin:a 21/0/42/+14`, `plugin:b 23/0/44/+14`, `plugin:c 24/0/45/+14`, `plugin:d 63/0/91/+19`, `plugin:e 25/0/46/+14`, and the JSON `{"status":"ok","base":"<sha>","roots":[{"pluginRoot":"plugin","entries":[{"entry":"plugin:a","floor":21,"dFloor":0,"closure":42,"dClosure":14,"newUnresolved":[]}, …]}]}` — the values test 1a pins.
- **Placeholders:** none.
