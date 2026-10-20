# Pipe-Safe Ledger Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `|` inside an open-items ledger Item or Resolution cell no longer breaks `wrap-up-engine.js finish-console`'s step-3 flip or the readers' column split.

**Architecture:** One rule — a cell's own `|` is written `\|` — stated once in `_shared/ledger-format.md`'s Format section. A new tiny codec module (`plugin/bin/lib/wrap-up/ledger-cells.js`) owns escape / unescaped-pipe split / unescape; `flipLedgerRow` (writer + gate), `parseLedger` and the statusline's `findOpenLedger` (readers) use it. Prose writers (`/claude-tweaks:ledger` Add Item / Update Item, `review/step3-routing.md`'s append, `build/dispatch.md`'s SDD carry-forward) cite the rule rather than restating it.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T232504-record-3512/work/3512-spec.md` (record #3512)

**Chosen mechanism (Deliverable 1's "pick one"):** escape `|` → `\|` on write, split only on a `|` not preceded by `\`, unescape `\|` → `|` on read. Rejected alternative: rejecting a pipe at append time with a `∣` (U+2223) substitution — it silently changes quoted regexes/table fragments, the exact content SDD rulings carry. Round-trip note: text already containing `\|` escapes to `\\|`; the splitter still treats that `|` as escaped, and unescape (`\|` → `|`) yields the original `\|` back — so round-trip is exact for every input.

## Global Constraints

- Escape form is exactly `\|` (backslash + pipe); never `∣` or an HTML entity.
- The rule is stated once, in `plugin/skills/_shared/ledger-format.md`'s `### Format` section; every other prose site cites `_shared/ledger-format.md`'s Format section instead of restating it.
- Commit style: `{Verb} {what} — {detail}`, body line `refs #3512` (never `closes`/`fixes`), trailer `Claude-Session: https://claude.ai/code/session_014jZCLvzHYqSD85nVGenWvD`.
- Never `git stash`. Discrimination proofs use `git show HEAD:<path>` into a scratch path (spec AC2).
- Run tests in the foreground; redirect long output to a `.txt` file (never `.log`).

## Review Focus

1. A legacy row carrying a *raw* `|` in its Item (written before this rule) — `flipLedgerRow` must still refuse it (no guessing), and its error must name the `\|` rule and the Format section so the operator knows the fix. Pinned in Task 1.
2. Resolution text passed to `finish-console` that itself contains `|` (e.g. `ratified — a|b`) — must be escaped on write so the flipped row stays 5 columns. Pinned in Task 1.
3. A cell whose text already contains a literal `\|` (a sed/grep pattern) — escape→split→unescape must return it unchanged. Pinned in Task 1's codec round-trip test.
4. `parseLedger`'s Defer-reason backstop on a `build` row whose Item contains an escaped pipe — the Resolution's `Defer-reason:` must still be found (columns not shifted). Pinned in Task 2.
5. Statusline open-count on a ledger whose open row's Item contains an escaped pipe — must still count it. Pinned in Task 2.

---

### Task 1: Ledger cell codec + pipe-safe `flipLedgerRow`

**Files:**
- Create: `plugin/bin/lib/wrap-up/ledger-cells.js`
- Modify: `plugin/bin/lib/wrap-up/ledger-write.js` (`flipLedgerRow`, header comment, one `require`)
- Modify: `tests/path-guard-conformance.test.js:151` — only the `reason` string's line numbers for `lib/wrap-up/ledger-write.js` (27/29/36/37/47 shift by however many lines the new `require` adds); token counts (`realpathSync: 4, existsSync: 5`) must stay unchanged — do not add any `existsSync`/`realpathSync` token.
- Test: `tests/bin-lib/wrap-up/ledger-cells.test.js` (new), `tests/bin-lib/wrap-up/ledger-write.test.js`, `tests/bin-lib/wrap-up/finish-console-cli.test.js`

**Interfaces:**
- Produces (from `plugin/bin/lib/wrap-up/ledger-cells.js`, `module.exports = { escapeLedgerCell, unescapeLedgerCell, splitLedgerRow, ledgerRowCells }`):
  - `escapeLedgerCell(text: string) -> string` — every `|` becomes `\|`.
  - `unescapeLedgerCell(text: string) -> string` — every `\|` becomes `|`.
  - `splitLedgerRow(row: string) -> string[]` — split on `|` not preceded by `\` (regex `/(?<!\\)\|/`); raw, untrimmed, still-escaped cells, same slot semantics as `row.split('|')` (slot 0 = text before the leading `|`, last slot = text after the trailing `|`).
  - `ledgerRowCells(row: string) -> string[]` — `splitLedgerRow(row).slice(1, -1)`, each cell trimmed then unescaped. For a well-formed row: `[#, Phase, Item, Status, Resolution]`.
- `flipLedgerRow(text, { item, status, resolution })` keeps its signature; it now splits with `splitLedgerRow` and writes `escapeLedgerCell(resolution.trim())` (or `—` when empty) into slot 5.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/wrap-up/ledger-cells.test.js`:
```js
test('AC1.1: escape → split → unescape round-trips an Item carrying a|b as 5 cells with the original text', () => {
  const row = `| 7 | build | ${escapeLedgerCell('SDD ruling — match a|b|c')} | open | — |`;
  assert.strictEqual(splitLedgerRow(row).length, 7);
  assert.deepStrictEqual(ledgerRowCells(row), ['7', 'build', 'SDD ruling — match a|b|c', 'open', '—']);
});
test('a cell already containing a literal \\| round-trips unchanged', () => {
  const original = String.raw`grep 'x\|y'`;
  const row = `| 1 | review | ${escapeLedgerCell(original)} | fixed | ok |`;
  assert.strictEqual(ledgerRowCells(row)[2], original);
});
test('escapeLedgerCell / unescapeLedgerCell are inverses on pipe-free and pipe-bearing text', () => {
  for (const s of ['plain', 'a|b', '|lead', 'trail|', 'a||b']) assert.strictEqual(unescapeLedgerCell(escapeLedgerCell(s)), s);
  assert.strictEqual(escapeLedgerCell('a|b'), String.raw`a\|b`);
});
```

Additions to `tests/bin-lib/wrap-up/ledger-write.test.js`:
```js
test('AC1.1: flipLedgerRow flips a row whose Item carries an escaped pipe, keeping the Item text intact', () => {
  const text = SAMPLE.replace('| 1 | build | First item |', String.raw`| 1 | build | Ruling: a\|b |`);
  const next = flipLedgerRow(text, { item: 1, status: 'accepted', resolution: 'ratified' });
  assert.match(next, /\| 1 \| build \| Ruling: a\\\|b \| accepted \| ratified \|/);
  const row = next.split('\n').find((l) => l.startsWith('| 1 |'));
  assert.deepStrictEqual(ledgerRowCells(row), ['1', 'build', 'Ruling: a|b', 'accepted', 'ratified']);
});
test('flipLedgerRow escapes a pipe in the resolution text it writes', () => {
  const next = flipLedgerRow(SAMPLE, { item: 2, status: 'accepted', resolution: 'ratified — x|y' });
  const row = next.split('\n').find((l) => l.startsWith('| 2 |'));
  assert.strictEqual(splitLedgerRow(row).length, 7);
  assert.strictEqual(ledgerRowCells(row)[4], 'ratified — x|y');
});
test('flipLedgerRow still refuses a legacy row with a raw (unescaped) pipe, naming the \\| rule', () => {
  const text = SAMPLE.replace('| 1 | build | First item |', '| 1 | build | First a|b item |');
  assert.throws(() => flipLedgerRow(text, { item: 1, status: 'fixed', resolution: 'x' }), /5-column shape[\s\S]*\\\|[\s\S]*ledger-format\.md/);
});
```
(Import `splitLedgerRow`, `ledgerRowCells` from `../../../plugin/bin/lib/wrap-up/ledger-cells`.)

Addition to `tests/bin-lib/wrap-up/finish-console-cli.test.js`:
```js
test('AC1.1: finish-console --approve-all flips a row whose Item carries an escaped pipe, completing all three steps', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(path.join(runDir, 'ledger.md'), LEDGER_SAMPLE.replace('Needs a memory capture', String.raw`SDD ruling — match a\|b`));
  const payload = JSON.stringify({ memory: [{ file: 'memory/foo.md', indexFile: 'MEMORY.md' }], ledger: [{ item: 1, status: 'accepted', resolution: 'ratified — keep a|b' }] });
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: payload });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 memory, 0 upstream, 1 ledger update/);
  assert.ok(fs.existsSync(path.join(runDir, 'verify-expectations.json')), 'step 1');
  assert.match(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'), /Ledger item #1 -> accepted/, 'step 2');
  const row = fs.readFileSync(path.join(runDir, 'ledger.md'), 'utf8').split('\n').find((l) => l.startsWith('| 1 |'));
  assert.deepStrictEqual(ledgerRowCells(row), ['1', 'review', 'SDD ruling — match a|b', 'accepted', 'ratified — keep a|b'], 'step 3');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/ledger-cells.test.js`
Expected: FAIL — `Cannot find module .../ledger-cells`. (Run the new file alone: `node --test` given several paths exits 0 when one of them is missing. The appended cases in `ledger-write.test.js` / `finish-console-cli.test.js` fail the same way via their new `ledger-cells` import; once the module exists, the flip cases fail with "does not have the expected 5-column shape" until Step 3's `flipLedgerRow` change lands.)

- [ ] **Step 3: Implement `ledger-cells.js` and switch `flipLedgerRow` to it**

`flipLedgerRow`: `const cells = splitLedgerRow(row);` keep the `cells.length !== 7` refusal, but its message becomes: ``ledger row for item #${item} does not have the expected 5-column shape — a raw `|` inside a cell must be written `\|` (_shared/ledger-format.md's Format section)``; write `cells[5] = \` ${escapeLedgerCell(String(resolution || '').trim()) || '—'} \``. Leave `parseLedgerTable`'s row detection (`/^\|\s*(\d+)\s*\|/`) as is. Update the module header comment to say rows are split/written through `./ledger-cells.js`. Update `tests/path-guard-conformance.test.js`'s `lib/wrap-up/ledger-write.js` reason line numbers to the post-edit lines (re-read the file to get them); token counts unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/ledger-cells.test.js tests/bin-lib/wrap-up/ledger-write.test.js tests/bin-lib/wrap-up/finish-console-cli.test.js tests/path-guard-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Prove discrimination against the pre-change module (spec AC2)**

`git show HEAD:plugin/bin/lib/wrap-up/ledger-write.js > {scratchpad}/ledger-write.pre.js`, then run the new `flipLedgerRow escaped-pipe` test body against the pre-change copy (a scratch copy of the test with the require path pointed at it). Expected: it throws "does not have the expected 5-column shape". Quote the raw output in the task report. Never `git stash`, never edit the tracked file in place.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/wrap-up/ledger-cells.js plugin/bin/lib/wrap-up/ledger-write.js tests/bin-lib/wrap-up/ledger-cells.test.js tests/bin-lib/wrap-up/ledger-write.test.js tests/bin-lib/wrap-up/finish-console-cli.test.js tests/path-guard-conformance.test.js
git commit -m "Make flipLedgerRow pipe-safe — escape | as \| via a shared ledger-cells codec"
```

### Task 2: Pipe-safe ledger readers (`parseLedger`, statusline `findOpenLedger`)

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js:403-445` (`parseLedger`'s per-row cell split)
- Modify: `plugin/bin/claude-tweaks-statusline.js:340-345` (`findOpenLedger`'s per-line cell split) + one `require('./lib/wrap-up/ledger-cells')`
- Test: `tests/bin-lib/wrap-up/pack.test.js`, `tests/statusline.test.js`

**Interfaces:**
- Consumes: `ledgerRowCells(row)` and `splitLedgerRow(row)` from Task 1's `plugin/bin/lib/wrap-up/ledger-cells.js`.
- `parseLedger(text, { excludeRecords })` keeps its signature and return shape exactly (no new fields — existing tests assert the shape).

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/wrap-up/pack.test.js`:
```js
test('AC1.1: parseLedger reads a row whose Item carries an escaped pipe as 5 columns (status recognized, Defer-reason found)', () => {
  const text = [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    String.raw`| 1 | build | Ruling: a\|b\|c | deferred | Defer-reason: genuinely-larger |`,
    String.raw`| 2 | review | quote x\|y | fixed | done |`,
    String.raw`| 3 | test | open item p\|q | open | — |`,
  ].join('\n');
  const r = parseLedger(text);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.unrecognized, 0);
  assert.strictEqual(r.open, 1);
  assert.deepStrictEqual(r.byPhase.build, { open: 0, total: 1, unrecognized: 0 });
  assert.strictEqual(r.missingDeferReason, 0);
});
```
`tests/statusline.test.js` (alongside the existing `findOpenLedger` cases, same `withFixtureDir`/`LEDGER_HEADER` helpers):
```js
test('findOpenLedger counts an open row whose Item carries an escaped pipe', () => {
  // ledger 'a-ledger.md': `${LEDGER_HEADER}| 1 | build | match a\\|b | open | — |\n| 2 | test | x\\|y | fixed | done |\n`
  // expect: sl.findOpenLedger(cwd) matches /ledger: 1 open/
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/statusline.test.js`
Expected: FAIL — `parseLedger` reports `unrecognized: 3` / wrong `byPhase`; `findOpenLedger` returns `null`.

- [ ] **Step 3: Switch both readers to the codec**

`parseLedger`: `const cells = ledgerRowCells(row);` (replaces `row.split('|').slice(1, -1).map((c) => c.trim())`); keep `cells.slice(4).join('|')` for Resolution. `findOpenLedger`: `const cells = splitLedgerRow(line).map((c) => c.trim());` — same index (`cells[4] === 'open'`) as today.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/statusline.test.js`
Expected: PASS, 0 failures. Then revert-check each new test against `git show HEAD:` copies of `pack.js` / `claude-tweaks-statusline.js` in a scratch path (it must fail there); quote the output.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/pack.js plugin/bin/claude-tweaks-statusline.js tests/bin-lib/wrap-up/pack.test.js tests/statusline.test.js
git commit -m "Split ledger rows on unescaped pipes in parseLedger and the statusline — readers honor the \| rule"
```

### Task 3: State the rule once; cite it at every prose writer

**Files:**
- Modify: `plugin/skills/_shared/ledger-format.md` — `### Format` section, new paragraph after the example fence, before `### Item Numbering`
- Modify: `plugin/skills/ledger/SKILL.md` — `### Add Item` (new bullet after **De-duplication:**) and `### Update Item` (one sentence)
- Modify: `plugin/skills/review/step3-routing.md` — the "After routing, append all findings to the ledger as usual" paragraph
- Modify: `plugin/skills/build/dispatch.md` — immediately after `as the ledger Item description.` in the SDD carry-forward
- Test: `tests/ledger-pipe-escape-rule-conformance.test.js` (new)

**Interfaces:**
- Consumes: the module/function names from Task 1 (`bin/lib/wrap-up/ledger-cells.js`, `escapeLedgerCell`, `splitLedgerRow`, `ledgerRowCells`, `flipLedgerRow`).

Exact text to insert:

`_shared/ledger-format.md` (new paragraph):
> **A `|` inside a cell is written `\|`.** Every writer escapes it on append or rewrite — an agent appending an Item or Resolution that quotes a regex alternation, a table fragment, or an SDD `Ruling:` one-liner, and `finish-console`'s flips through `bin/lib/wrap-up/ledger-cells.js`'s `escapeLedgerCell` — and every reader splits a row only on an unescaped `|`, then unescapes (`splitLedgerRow` / `ledgerRowCells`). GitHub renders `\|` in a table cell as a literal pipe, so the row still reads as written. A row carrying a raw `|` inside a cell no longer has five columns: `flipLedgerRow` refuses it rather than guess which cell is which, so `finish-console --approve-all` stops at step 3 after steps 1-2 have already landed.

`ledger/SKILL.md` Add Item bullet: `**Pipes:** escape every \`|\` in the Item or Resolution text as \`\|\` — \`_shared/ledger-format.md\`'s Format section.` Update Item sentence: `A rewritten Resolution follows the same pipe rule (\`_shared/ledger-format.md\`'s Format section).`

`review/step3-routing.md` (appended to the "After routing…" paragraph's first sentence): ` A finding whose text quotes a \`|\` is escaped per \`_shared/ledger-format.md\`'s Format section before its row is appended.`

`build/dispatch.md` (new sentence after `as the ledger Item description.`): `Escape every \`|\` in a carried one-liner as \`\|\` (\`_shared/ledger-format.md\`'s Format section) — a \`Ruling:\` line routinely quotes a regex alternation or a table fragment.`

- [ ] **Step 1: Write the failing conformance test**

`tests/ledger-pipe-escape-rule-conformance.test.js` — one shared assertion helper `assertRuleSites({ format, ledgerSkill, routing, dispatch })` called by the positive test on the real files and by a go-red control on a copy of `ledger-format.md` with the rule paragraph removed (control expects the helper to throw):
- `format` matches `/\*\*A `\|` inside a cell is written `\\\|`\.\*\*/` and names `ledger-cells.js`, `escapeLedgerCell`, `splitLedgerRow`, `ledgerRowCells`, `flipLedgerRow`.
- `ledgerSkill`, `routing`, `dispatch` each contain `_shared/ledger-format.md`'s Format section` within a sentence that also contains `` `|` `` (cite, not restate: none of them contains `escapeLedgerCell`).
- Test names cite `AC1.1` for the format paragraph's writer rule.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/ledger-pipe-escape-rule-conformance.test.js`
Expected: FAIL — the rule paragraph is absent.

- [ ] **Step 3: Insert the four texts above verbatim**

- [ ] **Step 4: Run the new test plus every suite pinning these four files**

Run: `node --test tests/ledger-pipe-escape-rule-conformance.test.js tests/build-sdd-ledger-residue-carryforward.test.js tests/step3-routing-prose-exempt-conformance.test.js tests/flow-ledger-creation-timing-conformance.test.js tests/deferral-gate-conformance.test.js tests/build-review-finding-deferral-gate.test.js tests/staged-patch-contract.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/ceremony-profile-roster.test.js tests/build-dispatch-status-token-and-tree-immutability.test.js tests/foreground-execution-instruction.test.js tests/build-ac-forwarding-verification.test.js tests/build-sdd-final-review-capture.test.js`
Expected: PASS, 0 failures (context-cost covers the composed-bytes ceilings; all four files are far under the 51,200-byte per-file ceiling — ledger-format.md 33,646, step3-routing.md 26,424, dispatch.md 24,837, ledger/SKILL.md 13,635 bytes before the edit).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/ledger-format.md plugin/skills/ledger/SKILL.md plugin/skills/review/step3-routing.md plugin/skills/build/dispatch.md tests/ledger-pipe-escape-rule-conformance.test.js
git commit -m "State the ledger \| rule once in ledger-format.md — cite it at every ledger-row writer"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (pick one mechanism, apply at every writer, unescape in `parseLedger`/`flipLedgerRow`, state in Format section) | 1 (codec, flip), 2 (readers), 3 (rule + writer cites) |
| Deliverable 2 (`flipLedgerRow` tolerates escaped pipe) | 1 |
| Deliverable 3 (dispatch.md + step3-routing.md cite) | 3 |
| Deliverable 4 (tests: flip pipe case, `parseLedger` round-trip, finish-console 3 steps) | 1, 2 |
| AC1.1 | 1 (flip + finish-console + `ledgerRowCells` round-trip), 2 (`parseLedger`) |
| AC2.1 | every task's Step 4; Task 1 Step 5 (go-red vs `git show HEAD:` copy) |
| AC3.1 | Common Step 5 full `npm test` (central, not per-task) |
