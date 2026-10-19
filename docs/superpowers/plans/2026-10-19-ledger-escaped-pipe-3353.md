# Ledger Escaped-Pipe Parsing (#3353) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ledger-table readers treat GFM's `\|` as a literal pipe inside a cell, so an open row whose Item contains `\|` still counts as `open` and can be resolved by `flipLedgerRow`.

**Architecture:** One zero-dependency splitter, `splitLedgerRow(row)`, in a new module `plugin/bin/lib/wrap-up/ledger-cells.js`. It splits on unescaped `|` only and returns raw, untrimmed segments, so `segments.join('|')` reproduces the input byte for byte. The three ledger-row readers in the repo switch from `row.split('|')` to it: `pack.js` `parseLedger`, `ledger-write.js` `flipLedgerRow`, and the statusline's `findOpenLedger`.

**Tech Stack:** Node 18+ CommonJS, `node:test` + `node:assert`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T185754-record-3353/work/3353-spec.md` (materialized from GitHub issue #3353)

## Global Constraints

- No new dependencies. The new module requires nothing, not even `fs` or `path`.
- `plugin/bin/lib/{name}/` modules are flat sibling directories, so the new file goes in the existing `plugin/bin/lib/wrap-up/`.
- Commit message style: `{Verb} {what} — {detail} (refs #3353)` with the trailing line `Claude-Session: https://claude.ai/code/session_01SoEQL3G1rJNHzYEbZyk6HY`. Never `closes`/`fixes`.
- Stage specific files only, and never use `git stash`.
- Run tests in the foreground. Run only the targeted suites per task; the full `npm test` runs once at build verification.

## Review Focus

1. **The real observed row** (`| 12 | review | Surface: web\|mobile\|desktop … | open | — |`): has several escapes in one cell. Task 2 pins it.
2. **`\\|` (escaped backslash followed by a delimiter):** must split. The backslash consumes only the one character after it. Task 1 pins it.
3. **A trailing lone backslash** (`| a \`): kept literally, never throws, never drops the character. Task 1 pins it.
4. **The Resolution cell after a flip:** a new resolution text containing `\|` is written as given. A row's Item `\|` survives the flip unchanged. Task 3 pins it.
5. **Rows without any backslash:** behavior is identical to `split('|')`. Task 1 pins it by comparing against `split('|')` on plain rows.

---

### Task 1: Escape-aware ledger row splitter

**Files:**
- Create: `plugin/bin/lib/wrap-up/ledger-cells.js`
- Test: `tests/bin-lib/wrap-up/ledger-cells.test.js`

**Interfaces:**
- Produces: `splitLedgerRow(row: string) => string[]`. It splits `row` on every `|` that is not consumed by a preceding backslash. A `\` consumes itself plus the next character, both kept verbatim in the current segment. Segments are untrimmed, and `splitLedgerRow(row).join('|') === row` for every input. Exported as `module.exports = { splitLedgerRow }`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/wrap-up/ledger-cells.test.js` (require `../../../plugin/bin/lib/wrap-up/ledger-cells`):
  - `splitLedgerRow keeps an escaped pipe inside its cell`: `splitLedgerRow('| 1 | build | a\\|b | open | — |')` deepStrictEquals `['', ' 1 ', ' build ', ' a\\|b ', ' open ', ' — ', '']`.
  - `splitLedgerRow splits after an escaped backslash`: `splitLedgerRow('| a\\\\| b |')` deepStrictEquals `['', ' a\\\\', ' b ', '']`.
  - `splitLedgerRow keeps a trailing lone backslash`: `splitLedgerRow('| a \\')` deepStrictEquals `['', ' a \\']`.
  - `splitLedgerRow matches split('|') on rows with no backslash`: for `'| 1 | build | item | open | — |'` and `'|||'` and `''`, the result deepStrictEquals `row.split('|')`.
  - `splitLedgerRow round-trips byte-identically`: for each of the inputs above, `splitLedgerRow(row).join('|') === row`.

- [ ] **Step 2: Run to verify failure**
  Run: `node --test tests/bin-lib/wrap-up/ledger-cells.test.js`
  Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/wrap-up/ledger-cells'`.

- [ ] **Step 3: Implement `splitLedgerRow(row)`** in `plugin/bin/lib/wrap-up/ledger-cells.js` as a single left-to-right character walk. On `\`, append it and the next character (if any) to the current segment and skip both. On `|`, push the current segment and start a new one. Otherwise, append. Push the final segment. Add a header comment naming GFM's `\|` table escape and #3353.

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/bin-lib/wrap-up/ledger-cells.test.js`
  Expected: PASS (5 tests).

- [ ] **Step 5: Commit**
  ```bash
  git add plugin/bin/lib/wrap-up/ledger-cells.js tests/bin-lib/wrap-up/ledger-cells.test.js
  git commit -m "Add splitLedgerRow — ledger row splitter honoring GFM's escaped pipe (refs #3353)" -m "Claude-Session: https://claude.ai/code/session_01SoEQL3G1rJNHzYEbZyk6HY"
  ```

### Task 2: parseLedger and the statusline count escaped-pipe rows by their real status

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js:412` (`parseLedger`'s cell split)
- Modify: `plugin/bin/claude-tweaks-statusline.js:343` (`findOpenLedger`'s cell split)
- Test: `tests/bin-lib/wrap-up/pack.test.js`, `tests/statusline.test.js`

**Interfaces:**
- Consumes: `splitLedgerRow` from Task 1 (`require('./ledger-cells')` in pack.js; `require('./lib/wrap-up/ledger-cells')` in the statusline).

- [ ] **Step 1: Write the failing tests**
  - In `tests/bin-lib/wrap-up/pack.test.js`, add `parseLedger counts an open row whose Item holds an escaped pipe as open (#3353)`. The ledger text has the header and separator plus two rows: `| 1 | build | a\\|b | open | — |` and the real observed shape `| 12 | review | Quoted Surface: web\\|mobile\\|desktop | open | — |`. Assert `r.open === 2`, `r.unrecognized === 0`, and `r.unrecognizedValues` deepStrictEquals `[]`.
  - In `tests/statusline.test.js`, add `findOpenLedger counts an open row whose Item holds an escaped pipe (#3353)` using `withLedgers` with `'a-ledger.md': \`${LEDGER_HEADER}| 1 | build | a\\|b | open | — |\n\``. Assert `sl.findOpenLedger(cwd)` matches `/ledger: 1 open/`.

- [ ] **Step 2: Run to verify failure**
  Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/statusline.test.js`
  Expected: FAIL. The pack test reports `open` 0 (with `unrecognized` 2). The statusline test gets `null`.

- [ ] **Step 3: Implement.** In `parseLedger`, replace `row.split('|')` with `splitLedgerRow(row)`. The `.slice(1, -1).map((c) => c.trim())` chain and `cells.slice(4).join('|')` stay unchanged. In `findOpenLedger`, replace `line.split('|')` with `splitLedgerRow(line)`, with the rest of the expression unchanged.

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/statusline.test.js`
  Expected: PASS, every test.

- [ ] **Step 5: Commit**
  ```bash
  git add plugin/bin/lib/wrap-up/pack.js plugin/bin/claude-tweaks-statusline.js tests/bin-lib/wrap-up/pack.test.js tests/statusline.test.js
  git commit -m "Count escaped-pipe ledger rows by their real status — parseLedger and statusline use splitLedgerRow (refs #3353)" -m "Claude-Session: https://claude.ai/code/session_01SoEQL3G1rJNHzYEbZyk6HY"
  ```

### Task 3: flipLedgerRow resolves an escaped-pipe row

**Files:**
- Modify: `plugin/bin/lib/wrap-up/ledger-write.js:106` (`flipLedgerRow`'s cell split)
- Test: `tests/bin-lib/wrap-up/ledger-write.test.js`

**Interfaces:**
- Consumes: `splitLedgerRow` from Task 1 (`require('./ledger-cells')`).

- [ ] **Step 1: Write the failing test** `flipLedgerRow resolves a row whose Item holds an escaped pipe, touching only Status/Resolution (#3353)` in `tests/bin-lib/wrap-up/ledger-write.test.js`. Build input text from `SAMPLE` with row 1 replaced by `| 1 | build | Surface: web\\|mobile\\|desktop | open | — |`. Call `flipLedgerRow(text, { item: 1, status: 'fixed', resolution: 'Fixed — abc1234' })`. Assert:
  - the result's row-1 line strictly equals `| 1 | build | Surface: web\\|mobile\\|desktop | fixed | Fixed — abc1234 |`
  - every other line of the result strictly equals the input's line at the same index (compare `split('\n')` arrays with row 1 excluded).

- [ ] **Step 2: Run to verify failure**
  Run: `node --test tests/bin-lib/wrap-up/ledger-write.test.js`
  Expected: FAIL with `ledger row for item #1 does not have the expected 5-column shape`.

- [ ] **Step 3: Implement.** In `flipLedgerRow`, replace `row.split('|')` with `splitLedgerRow(row)`. The 7-slot check, the `cells[4]`/`cells[5]` rewrite and `cells.join('|')` stay unchanged. Update the adjacent comment to say the split honors `\|`.

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/bin-lib/wrap-up/ledger-write.test.js`
  Expected: PASS, every test.

- [ ] **Step 5: Commit**
  ```bash
  git add plugin/bin/lib/wrap-up/ledger-write.js tests/bin-lib/wrap-up/ledger-write.test.js
  git commit -m "Resolve escaped-pipe ledger rows — flipLedgerRow splits with splitLedgerRow (refs #3353)" -m "Claude-Session: https://claude.ai/code/session_01SoEQL3G1rJNHzYEbZyk6HY"
  ```

---

## Self-review

- **Spec coverage:**
  - Deliverable 1 (shared splitter honoring `\|`, escape kept on serialize) is Task 1.
  - Deliverable 2 is Tasks 2 and 3. The repo-wide reader sweep (`grep -rn "split('|')" plugin/bin`, plus a `^\|\s*\d+\s*\|` row-matcher grep) found exactly three ledger-row splitters: `pack.js:412`, `ledger-write.js:106` and `claude-tweaks-statusline.js:343`.
  - Deliverable 3 is the tests in Tasks 1-3.
  - The AC "counted as open" is Task 2. The AC "byte-identical apart from Status/Resolution" is Task 3. The AC `npm test` is /build Common Step 5.
- **Go-red:** each new test fails on the current code. Task 1 fails on the missing module. Task 2 fails because the current split reads `b` or `mobile\` as the Status. Task 3 fails on the shape refusal.
- **Placeholders:** none.
