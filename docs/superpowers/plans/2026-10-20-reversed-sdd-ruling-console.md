# Reversed SDD Ruling on the PR Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the PR-hosted Review Console, an `sdd-ruling-*` item that is unticked or named in `resolve-console --decline` is recorded as `reversed` (not `declined, no reason given`) and counts as cleared for the Resolve gate.

**Architecture:** The console render (prose in `_shared/console-on-pr.md`, performed by an agent session; no Node writer exists) stamps `"isRulingRow": true` on each `sdd-ruling-*` item's `console.json` object, the same way it stamps `isMergeRow` (omitted on every other item, never `false`). `console-execute.js` reads that flag. `decideConsoleExecute` forwards it onto the resolved item, the same way it forwards `isMergeRow`. `resolveConsoleExecution` maps an unapproved flagged item to outcome `reversed` and counts `reversed` as cleared when it ticks Resolve. The prose in `_shared/console-execution.md` is rewritten to match, and a conformance test pins it to the exported code literals.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T135813-record-3636/work/3636-spec.md` (record #3636)

**Scope keywords:** isRulingRow, no reason given

## Premise correction (from build)

The spec's Key Files names `plugin/bin/lib/console/resolve.js` as the file that must "carry the ruling flag through resolve-console --approve/--decline". That module is `bin/console-resolve.js`'s unattended auto-resolver (#1932). `hooks.js resolve-console` (`plugin/bin/hooks.js` ~line 1223) calls `console-execute.js`'s `resolveConsoleExecution` directly, and that function reads `console.json` items itself. No carry-through is needed, so `console/resolve.js` is left untouched. `decideConsoleExecute` is a detection function: it reports ticks (`approved`), not outcomes. Its share of the "reversed outcome" deliverable is forwarding the flag, which is exactly what the executing session needs: `console-execution.md`'s Execution routing already routes an unapproved ruling to reverse.

## Global Constraints

- Flag name `isRulingRow`; written only as `true`, omitted on every other item, never `false`. A non-`true` value (e.g. `false`, `"true"`) is treated as unflagged.
- Reversed reply-comment label is exactly `reversed`; the declined note stays exactly `declined, no reason given`.
- `console.json.resolved` and the Resolve-box tick become true when every outcome is `executed` or `reversed`.
- A console rendered before this change (no flag) keeps today's behavior: its ruling reads `declined`.

## Review Focus

- A flagged ruling that is **ticked** (ratify) must still read `executed`, not `reversed`. Test: Task 1, `ratified ruling stays executed`.
- A flagged ruling reversed alongside a **declined `isMergeRow`** item: Resolve must stay unticked, because the declined item is not cleared. Test: Task 1, `reversed ruling plus declined merge row leaves Resolve unticked`.
- `isRulingRow: false` or a string `"true"` must not trigger reversal. Test: Task 1, `non-true flag reads unflagged`.
- A ruling named in both `--approve` and `--decline`: decline wins, as it does today for every item, so it reads `reversed`. Covered by the AC2.1 test, which passes it in `--decline` only. The existing precedence `!declineSet.has(id) && …` is unchanged.
- `renderExecutedLines` summary shows `id:reversed`, and the "Resolve left unticked" suffix is absent when only reversals remain. Test: Task 1, AC1.1 asserts `result.resolved === true`, which is what drives that suffix.

---

### Task 1: `reversed` outcome in console-execute.js

**Files:**
- Modify: `plugin/bin/lib/reconcile/console-execute.js`
- Test: `tests/resolve-console.test.js`
- Test: `tests/console-execute.test.js`

**Interfaces:**
- Produces: exported constants `DECLINED_NOTE = 'declined, no reason given'` and `REVERSED_LABEL = 'reversed'` from `console-execute.js` (Task 2's conformance test imports both). `resolveConsoleExecution` outcomes gain `{ id, kind, outcome: 'reversed', note: 'reversed', isMergeRow, isRulingRow: true }` for an unapproved flagged item. `decideConsoleExecute` resolved items carry `isRulingRow: true` when the source item has `isRulingRow === true`, and omit the key otherwise.

- [ ] **Step 1: Write the failing tests**

In `tests/resolve-console.test.js` (reuse `makeRunDir`/`writeConsoleJson`/`fakeGh`/`primaryCommentBody`; pass `items` via `writeConsoleJson`'s overrides, e.g. `[{ id: '1', kind: 'batch', summary: 'fix A' }, { id: 'r1', kind: 'staged', summary: 'SDD ruling', isRulingRow: true }]` with `primaryCommentBody(['1', 'r1'])`):

- `AC1.1: a flagged ruling item, unticked and in neither list, resolves to reversed and a cleared Resolve`: approve `['1']`, decline `[]`. Assert `r1` outcome `'reversed'`; `result.resolved === true`; the marker-edit body matches the ticked-Resolve regex `/<!--\s*console-item:\s*resolve\s*-->\s*\n-\s*\[x\]/i`; the reply body (`pr comment` call's `--body` arg) contains `` `r1`: reversed `` and does not contain `no reason given`; the written console.json has `resolved: true`.
- `AC2.1: the same flagged ruling named in --decline resolves to reversed`: approve `['1']`, decline `['r1']`. Same assertions on `r1` and `resolved`.
- `AC2.2: an unflagged item named in --decline still reads declined`: approve `['r1']`, decline `['1']`. Assert `1` outcome `'declined'`, note `'declined, no reason given'`, `resolved === false`.
- `ratified ruling stays executed`: approve `['1', 'r1']`. Assert `r1` outcome `'executed'`.
- `reversed ruling plus declined merge row leaves Resolve unticked`: items `1` (`isMergeRow: true`) and `r1` (flagged), decline `['1']`. Assert `r1` is `reversed`, `1` is `declined`, `resolved === false`.
- `non-true flag reads unflagged`: two items `f` (`isRulingRow: false`) and `s` (`isRulingRow: 'true'`), both unticked, decline `[]`. Assert both are `declined`.

In `tests/console-execute.test.js`, next to the isMergeRow forwarding test:

- `decideConsoleExecute: isRulingRow forwarded onto the resolved item when true, omitted otherwise`: same shape as the isMergeRow test (use `RESOLVED_COMMENTS`). Assert `items[0].isRulingRow === true` for a flagged item, and `'isRulingRow' in items[0] === false` for an unflagged one.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/resolve-console.test.js tests/console-execute.test.js`
Expected: FAIL. The new AC1.1/AC2.1 tests report outcome `'declined'`, and the isRulingRow forwarding test fails.

- [ ] **Step 3: Implement in `plugin/bin/lib/reconcile/console-execute.js`**

- Add `const DECLINED_NOTE = 'declined, no reason given';` and `const REVERSED_LABEL = 'reversed';` near `EXECUTED_REPLY_MARKER`, and export both.
- `decideConsoleExecute`'s `resolvedItems` map: add `...(item.isRulingRow === true ? { isRulingRow: true } : {})`, beside the isMergeRow spread.
- `resolveConsoleExecution`'s `outcomes` map: the executed branch is unchanged. When the item is not executed and `item.isRulingRow === true`, return `{ id, kind, outcome: 'reversed', note: REVERSED_LABEL, isMergeRow, isRulingRow: true }`. Otherwise return the existing declined object with `note: DECLINED_NOTE`. Update the comment above the map to say that a flagged ruling routes to reversed (`_shared/console-execution.md`).
- Rename `allExecuted` to `allCleared` = `outcomes.length > 0 && outcomes.every((o) => o.outcome === 'executed' || o.outcome === 'reversed')`. Use it for `tickResolveBoxIfAllExecuted(...)`, `resolved:` in `nextConsoleJson`, and the returned `resolved`. Update the comment above it to say that reversals count as cleared.
- `buildExecutedReplyBody` needs no change: it already prints `o.note` for any non-executed outcome.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/resolve-console.test.js tests/console-execute.test.js tests/hooks-resolve-console.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/console-execute.js tests/resolve-console.test.js tests/console-execute.test.js
git commit -m "Record a flagged sdd-ruling item as reversed in resolve-console — counts as cleared for Resolve (refs #3636)"
```

### Task 2: Prose — ruling flag in console-on-pr.md, accelerator note in console-execution.md, label pin

**Files:**
- Modify: `plugin/skills/_shared/console-on-pr.md`
- Modify: `plugin/skills/_shared/console-execution.md`
- Test: `tests/build-sdd-ledger-residue-carryforward.test.js`

**Interfaces:**
- Consumes: `DECLINED_NOTE`, `REVERSED_LABEL` from `plugin/bin/lib/reconcile/console-execute.js` (Task 1).

Byte headroom (Read-limit rail `RAIL_BYTES` = 52,500): `console-on-pr.md` is 14,066 B, `console-execution.md` is 17,892 B. Each edit adds under 1 KB, so both stay far below the rail.

- [ ] **Step 1: Write the failing tests**

In `tests/build-sdd-ledger-residue-carryforward.test.js`:
- Replace the line-151 pin (`a ruling the chat answer ratifies must be passed in \`--approve\` (an id in neither list is recorded \`declined\`)`) with a pin on the new clause `a ruling the chat answer ratifies must be passed in \`--approve\` (an unticked ruling id in neither list is recorded \`reversed\`)`.
- Replace the pin `` `AUTO` line naming `reversed → #{new record}` (or the logged refusal cause) is the authoritative record `` with a pin on `` `AUTO` line naming `reversed → #{new record}` (or the logged refusal cause) stays the record of which reversal record was filed ``.
- New test `AC3.1 #3636: console-execution.md's accelerator note labels a reversed ruling with console-execute.js's own literals`. Import `{ DECLINED_NOTE, REVERSED_LABEL }` from `../plugin/bin/lib/reconcile/console-execute`. Assert, with `ws(...)`, that CONSOLE_EXECUTION contains `` records a flagged ruling item (`console.json`'s `isRulingRow: true`, `_shared/console-on-pr.md`) as `${REVERSED_LABEL}` `` and `` every other `--decline` id as `${DECLINED_NOTE}` ``. Assert it does not match `/since `console.json` items carry no staged path/`. Assert that no line containing `no reason given` also contains `ruling`: `CONSOLE_EXECUTION.split('\n').filter((l) => /no reason given/.test(l) && /ruling/i.test(l))` deep-equals `[]`.
- New test `#3636: console-on-pr.md documents the isRulingRow flag on sdd-ruling-* items`. Assert CONSOLE_ON_PR matches ``ws('carries `"isRulingRow": true` on its `console.json` item object')`` and `ws('omitted on every other item, never `false`')`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/build-sdd-ledger-residue-carryforward.test.js`
Expected: FAIL. The new pins do not match the current prose.

- [ ] **Step 3: Edit the prose**

`plugin/skills/_shared/console-on-pr.md`, the `An sdd-ruling-* row` paragraph (Item ID scheme): append the sentence `Its `console.json` item object carries `"isRulingRow": true` (#3636) — like `isMergeRow` above, omitted on every other item, never `false` — the flag `resolve-console` and the reconciler's detection read to record an unticked or `--decline`d ruling as `reversed`, not `declined`.` Keep the hard-wrap at ~100 columns.

`plugin/skills/_shared/console-execution.md`:
- In the Detection paragraph, change `(for the one `isMergeRow: true` item, when present) that flag itself` to `(for the one `isMergeRow: true` item, when present, and each `isRulingRow: true` `sdd-ruling-*` item) that flag itself`.
- In the Live-session accelerator's chat-answers-first bullet, replace the text from `a ruling the chat answer ratifies must be passed in` through `is the authoritative record.` with: `a ruling the chat answer ratifies must be passed in `--approve` (an unticked ruling id in neither list is recorded `reversed`, as any other unticked id is recorded `declined`); perform the reverse (Execution routing above) before this call — the reply comment `resolve-console` posts records a flagged ruling item (`console.json`'s `isRulingRow: true`, `_shared/console-on-pr.md`) as `reversed` and every other `--decline` id as `declined, no reason given`, and a reversed ruling counts as cleared, so it never holds Resolve unticked (a console rendered before the flag existed carries none, so its ruling still reads `declined`). The `decisions.md` `AUTO` line naming `reversed → #{new record}` (or the logged refusal cause) stays the record of which reversal record was filed.` The pinned spans must not break across a line inside backticks. The `ws()` helper tolerates any whitespace between words, including line breaks. Hard-wrap so the physical line carrying `declined, no reason given` contains no `ruling` word, because the AC3.1 line check enforces that.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/build-sdd-ledger-residue-carryforward.test.js tests/console-execution.test.js tests/console-on-pr.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/console-on-pr.md plugin/skills/_shared/console-execution.md tests/build-sdd-ledger-residue-carryforward.test.js
git commit -m "Document the isRulingRow console.json flag and pin the reversed label to console-execute.js (refs #3636)"
```

AC4 (`npm test` passes in full) is verified centrally at build Common Step 5, not inside either task.
