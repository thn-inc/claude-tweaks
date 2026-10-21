# Stage Ledger-Backed Proposals Through One CLI Call — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `plugin/bin/stage-item.js` a `--ledger <path>` mode that stages a proposal and appends its ledger row in one call, and collapse `plugin/skills/build/dispatch.md`'s hand-performed `sdd-ruling-{N}` / `build-deviation-{N}` carry-forward prose to that call.

**Architecture:** A new `plugin/bin/lib/stage-item/ledger.js` owns the ledger half (row numbering, row composition, `Ledger:` header fill, the locked stage-then-append sequence and its two failure branches); `stage-item.js` parses the new flags and maps the result to its existing 0/2/3 exit vocabulary. The call numbers the row first, writes the staged file with `Ledger: {path}#{n}` already filled, then appends row `n` naming the path that was actually written — so no row can ever name a file that was not written (the record's Release Note). Prose in `dispatch.md` shrinks to one command per kind in a fenced block.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T210418-record-3510/work/3510-spec.md` (record #3510)

Scope keywords: just-appended row

(`stage-item.js` itself is deliberately not a scope keyword: its ~40 existing callers use the non-ledger mode, whose behavior and stdout this plan keeps byte-identical — Global Constraints — so none of them changes.)

Waived AC3.1: `npm test` in full is Common Step 5's central `verify.js` run, not a task test (Verification section below).

## Global Constraints

- Exit codes follow the *Sanctioned-writer* vocabulary (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`): 0 written, 2 malformed invocation, 3 run dir missing/not anchored or a target unwritable — **no exit 1**.
- The ledger row is appended through `bin/lib/wrap-up/ledger-write.js`'s `parseLedgerTable`/`serializeLedgerTable` — never De-duplication on Append (spec Deliverables ¶1).
- The `STAGED` line is written via `bin/lib/log-decision/append.js`'s `formatEntry` + `appendEntry` (spec Deliverables ¶1).
- A `|` in the Item cell is escaped with `bin/lib/wrap-up/ledger-cells.js`'s `escapeLedgerCell`; a newline collapses to one space (`_shared/ledger-format.md`'s Format section).
- Every existing `stage-item.js` invocation (no `--ledger`) keeps its exact current behavior and stdout.
- The SKIP line must contain `(degraded): condition:` (spec AC item 2).
- `dispatch.md` after this change: `grep -c "stage-item.js" plugin/skills/build/dispatch.md` ≥ 2 (grep counts **lines** — line 14 is one paragraph line, so the commands must sit on their own lines) and `grep -c "update the just-appended row" plugin/skills/build/dispatch.md` = 0.
- `dispatch.md` is 27,128 B against the 52,500 B rail; this change shrinks it — no headroom risk.

## Review Focus

1. A one-liner carrying `|`, backticks or `$` — the row must stay five columns (`|` escaped once, by the CLI only). Pinned in Task 1's `escapes | in the Item` test.
2. A source file that already carries a `Ledger:` header line — the CLI must replace it, never write a second one. Pinned in Task 1.
3. The realistic first call: a ledger with only the header + separator rows — the row must get `#1`. Pinned in Task 1.
4. A worktree-local shadow `--run` — refused (exit 3) before the ledger is touched (`[IL-127]`). Pinned in Task 1.
5. The ledger append failing after the staged file landed — the staged file must be removed so no orphan `Ledger:` reference survives. Pinned in Task 1 (skipped on win32 / root, where chmod cannot deny the write).

---

### Task 1: `--ledger` mode in `stage-item.js`

**Files:**
- Create: `plugin/bin/lib/stage-item/ledger.js`
- Modify: `plugin/bin/stage-item.js` (header comment, `USAGE`, `parseArgs`, `run`)
- Test: `tests/bin-lib/stage-item/ledger.test.js`

**Interfaces:**
- Consumes: `parseLedgerTable(text)`, `serializeLedgerTable(table)`, `resolveLedgerPath({ runDir, worktree, explicit })` from `plugin/bin/lib/wrap-up/ledger-write.js`; `escapeLedgerCell` from `ledger-cells.js`; `writeStagedItem` from `./write`; `formatEntry`, `appendEntry` from `../log-decision/append`; `withLock` from `../file-lock`; `writeFileAtomic` from `../atomic-write`.
- Produces (in `plugin/bin/lib/stage-item/ledger.js`):
  - `fillLedgerHeader(text: string, ref: string) -> string` — the header block is the lines before the first empty line (the whole text when there is none). Replace the first `^Ledger:.*$` line inside it with `Ledger: {ref}`; when absent, insert `Ledger: {ref}` as the header block's last line.
  - `headerField(text: string, name: string) -> string | null` — trimmed value of the first `{name}:` line in the header block.
  - `appendLedgerRow(ledgerText: string, { phase: string, item: string, status: string }) -> { text: string, number: number }` — `number` = highest existing row `#` + 1, or 1 when the table has no rows; the row is `| {number} | {phase} | {item} | {status} | — |` with `item` newline-collapsed then `escapeLedgerCell`-escaped; throws (from `parseLedgerTable`) when the text has no ledger table.
  - `carryForward({ runDir, ledgerPath, ledgerRef, id, sourcePath, content, allocate, phase, item, label, section, now }) -> { code: 0 | 3, file?, id?, renamed?, requestedId?, number?, warnings: string[] }` — the whole sequence below, under `withLock(path.join(runDir, '.ledger.lock'), …)`.
- CLI flags (ledger mode is entered by `--ledger`): `--ledger <path>` (resolved against `deps.cwd()`; written verbatim into the `Ledger:` header), `--item <text>` (required), `--label <noun>` (required), `--phase <phase>` (default `build`), `--section <heading>` (default `/build`).

**`carryForward` sequence** (the decisions the implementer cannot infer):
1. Read `ledgerPath`; `appendLedgerRow` on the text without writing — a throw → log SKIP `{label} carry-forward (degraded)` with text `condition: ledger {ledgerRef} has no ledger table ({err.message}) → fallback: nothing staged or appended; "{summary}" reaches no console`, return code 3.
2. `fillLedgerHeader(content, `${ledgerRef}#${number}`)`, then `writeStagedItem({ runDir, id, sourcePath, content: filled, allocate })`.
3. Staged write throws → append the row with Item = `item` (no suffix), write the ledger (`writeFileAtomic`), log SKIP step `{label} carry-forward (degraded)`, text `condition: staged write failed for {id} ({err.message}) → fallback: ledger row #{number} left open with no staged file; the resolve gate drills it`, return code 3.
4. Staged write ok → append the row with Item = `{item} (staged/{basename(result.file)})`, write the ledger. That write throws → `fs.unlinkSync(result.file)` (best-effort), log SKIP same step, text `condition: ledger append to {ledgerRef} failed ({err.message}) → fallback: staged/{basename} removed; "{summary}" reaches no console`, return code 3.
5. Log STAGED step `{label} carried forward`, text `"{summary}". Stage path: staged/{basename(result.file)}`, reversibility `high`. A failing log write is a `warnings` entry, never a non-zero code.
- `{summary}` = `headerField(content, 'Title')` when present, else `item`. SKIP lines use reversibility `n/a`. Every log goes through `appendEntry({ runDir, section, entry: formatEntry({ status, now, step, text, reversibility }) })`; a log write that throws becomes a `warnings` entry.

**CLI `run` ledger branch:** validate before reading anything — `--ledger` without `--item` or `--label` (or with an empty value), or `--ledger` together with `--json`, is a usage error (exit 2). After `resolveTarget` succeeds (exit 3 path unchanged), resolve the ledger with `resolveLedgerPath({ runDir: target.dir, worktree: <nearest ancestor of deps.cwd() holding a .git entry, file or dir>, explicit: path.resolve(deps.cwd(), o.ledger) })`; not ok → stderr `stage-item.js: --ledger {o.ledger} rejected ({reason}{: detail})` and exit 2. Then `carryForward`, print each warning to stderr, and on code 0 print `result.file`, the existing reallocation line when `renamed`, then `stage-item.js: appended ledger row #{number} to {o.ledger}`; then the existing #3370 unmapped-prefix warning. Return the code.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/stage-item/ledger.test.js`, driving `run` from `plugin/bin/stage-item` with the same `fixture()`/`fakeDeps()` shape as `tests/bin-lib/stage-item/cli.test.js` (main checkout with a `.git` dir, run dir `main/.claude-tweaks/pipelines/run-a`, a worktree shadow), plus a ledger at `main/docs/plans/2026-10-20-x-ledger.md` and a ruling source `ruling.md` = `Title: keep the guard\nKind: sdd-ruling\nRuling: Ruling: keep the guard — cheaper\nStaged-at: abc123\n\nratify / reverse\n`. `ARGS(extra)` = `['--run', runDir, '--id', 'sdd-ruling-1', '--file', src, '--allocate', '--ledger', 'docs/plans/2026-10-20-x-ledger.md', '--label', 'SDD ruling', '--item', 'SDD ruling — keep the guard: ratify or reverse at the Review Console', ...extra]`, cwd = main. The ledger fixture holds one prior row `| 1 | review | prior finding | open | — |` unless a test says otherwise.

```js
test('AC2.1: stages sdd-ruling, appends the row it numbers into the Ledger: header, names the path actually written after a reallocation, logs STAGED', () => {
  // pre-create staged/sdd-ruling-1.md so --allocate renumbers to -2
  assert.equal(code, 0);
  const staged = fs.readFileSync(path.join(runDir, 'staged', 'sdd-ruling-2.md'), 'utf8');
  assert.match(staged, /^Ledger: docs\/plans\/2026-10-20-x-ledger\.md#2$/m);
  assert.equal((staged.match(/^Ledger:/gm) || []).length, 1);
  assert.ok(ledgerText().includes('| 2 | build | SDD ruling — keep the guard: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |'));
  assert.ok(ledgerText().includes('| 1 | review | prior finding | open | — |'));
  assert.equal(out.join('').split('\n')[0], path.join(fs.realpathSync(runDir), 'staged', 'sdd-ruling-2.md'));
  assert.match(decisions(), /^- STAGED \d\d:\d\d:\d\d — SDD ruling carried forward: "keep the guard"\. Stage path: staged\/sdd-ruling-2\.md\. Reversibility: high\.$/m);
  assert.match(decisions(), /^## \/build$/m);
});

test('AC2.2: a failed staged write leaves the row open with no (staged/ suffix and logs the degraded SKIP', () => {
  // make runDir/staged a regular file so writeStagedItem's mkdir throws
  assert.equal(code, 3);
  assert.ok(ledgerText().includes('| 2 | build | SDD ruling — keep the guard: ratify or reverse at the Review Console | open | — |'));
  assert.equal(ledgerText().includes('(staged/'), false);
  assert.match(decisions(), /^- SKIP \d\d:\d\d:\d\d — SDD ruling carry-forward \(degraded\): condition: staged write failed for sdd-ruling-1 \(.+\) → fallback: ledger row #2 left open with no staged file; the resolve gate drills it\. Reversibility: n\/a\.$/m);
  assert.doesNotMatch(decisions(), /STAGED/);
});
```

Further tests in the same file (names and assertions):
- `an empty-table ledger gets item #1` — ledger has header + separator only; row `| 1 | build | … (staged/sdd-ruling-1.md) | open | — |` present; staged header `Ledger: docs/plans/2026-10-20-x-ledger.md#1`.
- `escapes | in the Item and collapses a newline, keeping five columns` — `--item 'SDD ruling — a|b\nc: ratify or reverse at the Review Console'`; the appended row contains `a\|b c:` and `splitLedgerRow(row).length === 7`.
- `replaces an existing Ledger: header line instead of adding a second` — source header carries `Ledger: stale#9`; staged file has exactly one `^Ledger:` line, value `docs/plans/2026-10-20-x-ledger.md#2`.
- `--ledger without --item or --label, or with --json, is a malformed invocation (exit 2), nothing written` — three runs; each exit 2; `staged/` absent; ledger byte-identical.
- `--ledger naming a non-ledger file or a missing ledger is exit 2, nothing staged` — `docs/plans/notes.md` (exists) and `docs/plans/missing-ledger.md`; exit 2; `staged/` absent.
- `a ledger with no table logs a degraded SKIP and exits 3, nothing staged` — ledger text `# Open Items\n\nno table\n`; exit 3; `staged/` absent; decisions match `/SDD ruling carry-forward \(degraded\): condition: ledger .* has no ledger table/`.
- `a worktree-shadow --run with --ledger is refused (exit 3) before the ledger is touched` — ledger byte-identical, shadow `staged/` absent.
- `a failed ledger append removes the staged file and logs the degraded SKIP` — `{ skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }`; `chmod 0o555` on `docs/plans` (restore in `finally`); exit 3; `staged/sdd-ruling-1.md` absent; decisions match `/condition: ledger append to docs\/plans\/2026-10-20-x-ledger\.md failed .* → fallback: staged\/sdd-ruling-1\.md removed/`.
- `without --ledger, stdout and files are unchanged` — the existing success call prints exactly one line (the path) and creates no `decisions.md`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/stage-item/ledger.test.js`
Expected: FAIL — `unknown argument: --ledger` exits 2 on every ledger-mode case.

- [ ] **Step 3: Implement `plugin/bin/lib/stage-item/ledger.js` and the CLI branch** per the Interfaces block and the `carryForward` sequence above. Extend `stage-item.js`'s header comment with a `--ledger` paragraph (one call: number → stage with `Ledger:` filled → append → STAGED; the two failure branches; the `.ledger.lock` in the run dir) and `USAGE` with `[--ledger <path> --item <text> --label <noun> [--phase <phase>] [--section <heading>]]`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/stage-item/ledger.test.js tests/bin-lib/stage-item/cli.test.js tests/bin-lib/stage-item/write.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/stage-item/ledger.js plugin/bin/stage-item.js tests/bin-lib/stage-item/ledger.test.js
git commit -m "Add stage-item.js --ledger mode — stage and append a ledger row in one call, refs #3510"
```

### Task 2: Collapse `dispatch.md`'s carry-forward prose to the CLI call

**Files:**
- Modify: `plugin/skills/build/dispatch.md` (line 14's contract-beats-spec clause, its `|`-escape sentence, its ruling procedure; a new block after line 19)
- Modify: `tests/build-sdd-ledger-residue-carryforward.test.js` (tests `AC2.3: …` at lines 46-57 and `review #3401: …` at lines 124-130)
- Modify: `docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md` (lines 28, 30)
- Test: `tests/build-sdd-ledger-residue-carryforward.test.js`, `tests/build-contract-beats-spec-literal.test.js` (unchanged — must stay green)

**Interfaces:**
- Consumes: Task 1's CLI flags exactly (`--ledger`, `--label`, `--item`, `--allocate`).

**Pins found by phrase grep** (`git grep -n -F` over `tests plugin docs` for "just-appended row", "not an Update Item", "never skips a ruling row", "takes the staged extension from the source", "ledger first, then the file", "(1) append the ledger row", "exits non-zero, write no", "carry-forward (degraded)", "SDD ruling carried forward", "Kind: sdd-ruling"): `tests/build-sdd-ledger-residue-carryforward.test.js` lines 49-56 and 125-129; `docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md` lines 28 and 31; `tests/bin-lib/console/resolve.test.js:50` (a staged-file fixture — unaffected, the header shape is unchanged). `tests/build-contract-beats-spec-literal.test.js`'s slice literals (`update-the-spec deviation`, `build-deviation-`, ``in place of `sdd-ruling-{N}` ``, ``every `sdd-ruling` name in that procedure``, `dispositions read apply / decline rather than ratify / reverse`) are all kept by the replacement text below.

**Replacement text** (exact copy; line 14 stays one line):

(a) In the contract-beats-spec clause, replace ``(`architecture-alignment.md`'s `stage-item.js --allocate` command, classification `Update the spec`), in place of `sdd-ruling-{N}` — every `sdd-ruling` name in that procedure (the ledger Item's staged path, the `Kind:` header, the `STAGED` and degraded `SKIP` log lines) becomes `build-deviation`,`` with ``(classification `Update the spec`), through the `build-deviation-{N}` line of the carry-forward commands at the end of this file, in place of `sdd-ruling-{N}` — every `sdd-ruling` name in that procedure (the `--id`, and so the staged path every log line names, and the `Kind:` header) becomes `build-deviation`,``.

(b) Replace ``Escape every `|` in a carried one-liner as `\|` (`_shared/ledger-format.md`'s Format section) — a `Ruling:` line routinely quotes a regex alternation or a table fragment.`` with ``Escape every `|` in a carried one-liner as `\|` (`_shared/ledger-format.md`'s Format section) — a `Ruling:` line routinely quotes a regex alternation or a table fragment — except a ruling's Item, which the carry-forward call below escapes itself, so pass it unescaped.``

(c) Replace everything from ``For each load-bearing ruling, ledger first, then the file:`` through ``so every ruling gets its own row and item number.`` with:

``For each load-bearing ruling, write the staged file's text to a temp file ending in `.md` (the staged extension comes from the source): a header block `Title:` (the one-liner, truncated to the console's row width) / `Kind: sdd-ruling` / `Ruling:` (the `progress.md` line verbatim) / `Staged-at:` (short HEAD sha), a blank line, then the ruling text, the task number when the line carries one, and the two dispositions (ratify / reverse). Then carry it forward with one `stage-item.js --ledger` call — the `sdd-ruling-{N}` line of the carry-forward commands at the end of this file (`{N}` a per-invocation counter from 1; `--allocate` for the same clobber reason `build-deviation-{N}` carries it). That call is the whole procedure, and the row it writes is the one `open` row the mapping above copies for a `Ruling:` line — never a second row. It numbers the row first and stages the file with its `Ledger: {ledger path}#{item-number}` header already filled; it appends the row through `bin/lib/wrap-up/ledger-write.js`'s table parser, never Add Item's De-duplication on Append, so two rulings sharing the template stem each get their own row; the row's Item names the path the call actually wrote, after any `--allocate` renumbering; and it logs `STAGED {time} — SDD ruling carried forward: "{Title}". Stage path: staged/sdd-ruling-{N}.md. Reversibility: high.` under `## /build`. When the staged write fails it appends the row `open` with no `(staged/…)` suffix, so `_shared/ledger-format.md`'s unapplied-staged-proposal exclusion cannot hide it, and logs `SKIP {time} — SDD ruling carry-forward (degraded): condition: staged write failed for sdd-ruling-{N} ({error}) → fallback: ledger row #{item} left open with no staged file; the resolve gate drills it. Reversibility: n/a.` itself; a failed ledger append removes the staged file and logs its own `SKIP`, so no row ever names a file that was not written. Pass `--item` single-quoted with any `'` in the one-liner written as `'\''` — never double-quoted: a ruling routinely carries backticks and `$`, which a double-quoted shell argument executes as command substitution, and a stray `"` truncates the entry.``

(d) Append after line 19 (blank line first):

````markdown
**Carry-forward commands (#3510).** One call per load-bearing ruling, run from the worktree root; `{ledger path}` is this build's open items ledger, repo-relative. The second line is the contract-beats-spec form, its temp file's header reading `Kind: build-deviation`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "$PIPELINE_RUN_DIR" --id "sdd-ruling-{N}" --file {tmp}.md --allocate --ledger "{ledger path}" --label "SDD ruling" --item 'SDD ruling — {one-liner}: ratify or reverse at the Review Console'
node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "$PIPELINE_RUN_DIR" --id "build-deviation-{N}" --file {tmp}.md --allocate --ledger "{ledger path}" --label "SDD ruling" --item 'SDD ruling — {one-liner}: apply or decline at the Review Console'
```
````

(e) Journey: line 28 `naming the \`open\` ledger row appended just before it` → `naming the \`open\` ledger row the same \`stage-item.js --ledger\` call appended right after it`; line 30 `The ledger row was written first so the staged file can name its item number, and the path in the STAGED line is the one \`stage-item.js\` actually wrote even when \`--allocate\` had to renumber it.` → `The one \`stage-item.js --ledger\` call numbers the row before writing the staged file, so the file names its item number, and appends the row only once the file exists; the path in the STAGED line and the row is the one it actually wrote even when \`--allocate\` had to renumber it.`

- [ ] **Step 1: Rewrite the two pinned tests** in `tests/build-sdd-ledger-residue-carryforward.test.js`:

```js
test('AC1.1: dispatch.md carries the carry-forward on at least two stage-item.js lines and no hand-rewrite clause', () => {
  assert.ok(DISPATCH.split('\n').filter((l) => l.includes('stage-item.js')).length >= 2);
  assert.ok(!DISPATCH.includes('update the just-appended row'));
});

test('AC2.3: the run-directory branch stages each ruling through one stage-item.js --ledger call', () => {
  assert.match(DISPATCH, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/stage-item\.js" --run "\$PIPELINE_RUN_DIR" --id "sdd-ruling-\{N\}" --file \{tmp\}\.md --allocate --ledger "\{ledger path\}" --label "SDD ruling" --item 'SDD ruling — \{one-liner\}: ratify or reverse at the Review Console'/);
  assert.match(DISPATCH, /--id "build-deviation-\{N\}" --file \{tmp\}\.md --allocate --ledger "\{ledger path\}" --label "SDD ruling" --item 'SDD ruling — \{one-liner\}: apply or decline at the Review Console'/);
  assert.match(DISPATCH, /`Title:`.*?`Kind: sdd-ruling`.*?`Ruling:`.*?`Staged-at:`/);
  assert.match(DISPATCH, /`Ledger: \{ledger path\}#\{item-number\}` header already filled/);
  assert.match(DISPATCH, /STAGED \{time\} — SDD ruling carried forward: "\{Title\}"\. Stage path: staged\/sdd-ruling-\{N\}\.md\. Reversibility: high\./);
  assert.match(DISPATCH, /never Add Item's De-duplication on Append/);
  assert.match(DISPATCH, /the row's Item names the path the call actually wrote, after any `--allocate` renumbering/);
});

test('review #3401 → #3510: the CLI owns the failure branch; the hand-performed rewrite and ordering clauses are gone', () => {
  assert.match(DISPATCH, /SKIP \{time\} — SDD ruling carry-forward \(degraded\): condition: staged write failed for sdd-ruling-\{N\} \(\{error\}\) → fallback: ledger row #\{item\} left open with no staged file/);
  assert.match(DISPATCH, /so no row ever names a file that was not written/);
  assert.match(DISPATCH, /the carry-forward call below escapes itself, so pass it unescaped/);
  for (const gone of ['ledger first, then the file', 'the same operation, not an Update Item', "rewrite the row's Item text", '(1) append the ledger row']) {
    assert.ok(!DISPATCH.includes(gone), `stale hand-performed clause still present: ${gone}`);
  }
});
```

Delete the old `AC2.3` and `review #3401` tests these replace. Keep every other test in the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/build-sdd-ledger-residue-carryforward.test.js`
Expected: FAIL — the three new tests fail on the current `dispatch.md` (no `--ledger` command line; `update the just-appended row` present).

- [ ] **Step 3: Apply replacement text (a)–(d) to `dispatch.md` and (e) to the journey.**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/build-sdd-ledger-residue-carryforward.test.js tests/build-contract-beats-spec-literal.test.js`
Expected: PASS, 0 failures. Then `grep -c "stage-item.js" plugin/skills/build/dispatch.md` prints ≥ `2` and `grep -c "update the just-appended row" plugin/skills/build/dispatch.md` prints `0`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/dispatch.md tests/build-sdd-ledger-residue-carryforward.test.js docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md
git commit -m "Collapse dispatch.md's SDD ruling carry-forward to one stage-item.js --ledger call, refs #3510"
```

## Verification (Common Step 5, runs centrally)

AC3.1: `npm test` passes in full — run by `/build` Common Step 5 through `verify.js`, not by a task.
