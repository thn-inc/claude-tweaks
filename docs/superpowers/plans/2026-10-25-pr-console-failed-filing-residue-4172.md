# PR-Console Failed-Outcome Residue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PR-rendered Review Console whose executed items include a `filing-failed` or `reverse-failed` outcome counts as console residue — archival refuses with `console-residue` naming the item until `console-residue.js --ack`, and the SessionStart banner lists it.

**Architecture:** Today `resolveConsoleExecution` (`plugin/bin/lib/reconcile/console-execute.js`) computes per-item outcomes but writes only `executedAt`/`resolved` to `console.json`, so the outcome survives only in the PR reply comment. Task 1 persists each item's `outcome` (and `note`) onto its `console.json` item. Task 2 teaches `plugin/bin/lib/console/residue.js` to count a failed outcome as an unresolved item — `readConsoleState`, the archive-run verb, the reconcile sweep, `console-residue.js` and the SessionStart banner all already read residue through `readRunResidue`, so they inherit it. Task 3 makes both archival refusals name the item; Task 4 updates the contract prose.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T134357-record-4172/work/4172-spec.md`

Scope keywords: readRunResidue, consoleResidue

## Global Constraints

- Failed outcomes are exactly `filing-failed` and `reverse-failed` (the two outcomes `resolveConsoleExecution` records as "not cleared" for a decided-but-failed item). `declined`, `executed`, `dropped`, `reversed` are never residue.
- `UNRESOLVED_RESOLUTIONS` stays exactly `new Set(['pending', 'keep-staged'])` — its other consumers (`console-backfill.js`, `backfill.js`, `backfill-apply.js`) must not start treating PR outcomes as backfill work.
- Existing refusal text stays byte-compatible: `archival refused — console-residue (1 unresolved item(s) no human has reviewed; review them, then run console-residue.js --ack --run ` is pinned by `tests/archive-run-verb.test.js`; item naming is appended, never inserted.
- `console.json` changes are additive (new `outcome`/`note` fields on items) — no field renamed or removed (expand-contract; the installed build reads this repo's run dirs with older code).
- Consoles executed before this change carry no `outcome` and stay non-residue (no backfill from PR comments — out of scope).

## Review Focus

- A PR console item id is not a staged filename (`staged-5`, `f1`) — `splitMissing` must never reclassify a failed-outcome item as `missing` (that would silently drop it from the count). Pinned in Task 2.
- An acknowledged (`residueAcknowledgedAt`) PR console with a failed item must archive — the ack path is the only way out. Pinned in Task 3.
- A PR console whose `items` field is absent or not an array must still write (`executedAt`/`resolved`) without throwing — guarded by Task 1's `Array.isArray` branch (no test: `resolveConsoleExecution` already maps a non-array to `[]` upstream of the write).
- A live-session console (items with `resolution`, no `outcome`) must count exactly as before — pinned by the existing `residue.test.js` suite staying green.
- A multi-spec run's `spec-N/console.json` with a failed outcome blocks the parent run, same as a top-level one. Pinned in Task 2.

---

### Task 1: Persist per-item outcomes into console.json

**Files:**
- Modify: `plugin/bin/lib/reconcile/console-execute.js` (the step-3 write in `resolveConsoleExecution`, ~line 669, plus the comment above it)
- Test: `tests/resolve-console.test.js`

**Interfaces:**
- Produces: after `resolveConsoleExecution` returns `status: 'executed'`, `console.json.items[i]` = the original item plus `outcome: string` (one of `executed | declined | reversed | reverse-failed | dropped | filing-failed`) and, when the outcome object carries one, `note: string` (the same text the reply comment uses, e.g. `FILING_FAILED_NOTE` = `'filing failed — see decisions.md'`, `REVERSE_FAILED_NOTE`). `executed` items get no `note`. Item order unchanged. When `consoleJson.items` is not an array, `items` is not written (left as-is).

- [ ] **Step 1: Write the failing tests** (append after the existing `a finding row named in filingFailed reads filing-failed…` test; reuse `runRuling`, `FINDING_ITEMS`, `RULING_ITEMS`)

```js
test('#4172: console.json persists each item\'s outcome — filing-failed carries its note, executed carries none', async () => {
  const { written } = await runRuling(FINDING_ITEMS, { approve: ['1', 'f1'], decline: [], filingFailed: ['f1'] });
  const byId = Object.fromEntries(written.items.map((i) => [i.id, i]));
  assert.equal(byId.f1.outcome, 'filing-failed');
  assert.equal(byId.f1.note, FILING_FAILED_NOTE);
  assert.equal(byId.f1.findingItem, 'tiebreak:3f2a9c1b7d04');
  assert.equal(byId['1'].outcome, 'executed');
  assert.equal('note' in byId['1'], false);
});

test('#4172: console.json persists a reverse-failed ruling outcome', async () => {
  const { written } = await runRuling(RULING_ITEMS, { approve: ['1'], decline: [], reverseFailed: ['r1'] });
  const r1 = written.items.find((i) => i.id === 'r1');
  assert.equal(r1.outcome, 'reverse-failed');
  assert.equal(r1.note, REVERSE_FAILED_NOTE);
});
```

(If `REVERSE_FAILED_NOTE` is not yet imported at the top of the test file, add it to the existing destructured require from `console-execute`.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/resolve-console.test.js`
Expected: FAIL after Step 1 — `byId.f1.outcome` is `undefined`.

- [ ] **Step 3: Implement** in `resolveConsoleExecution`: build `nextConsoleJson` as `{ ...consoleJson, ...(Array.isArray(consoleJson.items) ? { items: consoleJson.items.map((item, i) => ({ ...item, outcome: outcomes[i].outcome, ...(outcomes[i].note ? { note: outcomes[i].note } : {}) })) } : {}), executedAt, resolved: allCleared }`. `outcomes` is index-aligned with `items` (it is `items.map(...)`). Update the step-3 comment to say the write also records each item's outcome, which `console/residue.js` reads.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/resolve-console.test.js tests/hooks-resolve-console.test.js tests/console-on-pr.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/console-execute.js tests/resolve-console.test.js
git commit -m "Persist each PR console item's outcome in console.json — resolve-console (refs #4172)"
```

### Task 2: Count failed PR outcomes as console residue

**Files:**
- Modify: `plugin/bin/lib/console/residue.js` (header comment, `unresolvedItems`, `splitMissing`, exports)
- Modify: `plugin/bin/console-residue.js` (header comment lines 2-4 only: also names failed PR outcomes)
- Test: `tests/bin-lib/console/residue.test.js`
- Test: `plugin/bin/lib/hooks/session-residue.js` (unchanged consumer — the SessionStart banner reads `readRunResidue`; re-run in Step 4)
- Test: `tests/bin-lib/console/resolve.test.js` (existing `unresolvedItems` caller; re-run in Step 4)
- Test: `tests/bin-lib/console/backfill-apply.test.js` (existing `unresolvedItems` caller; re-run in Step 4)

**Return-shape widening (checked):** `unresolvedItems` callers in `tests/bin-lib/console/{resolve,residue,backfill-apply,shadow-dup-proposal}.test.js` all pass live consoles (no `outcome` field), so their deep-equals are unaffected; `consoleResidue` has no deep-equal pin (`grep -rn "consoleResidue(" tests` — none).

**Interfaces:**
- Consumes: Task 1's `outcome`/`note` item fields.
- Produces: `FAILED_OUTCOMES` (exported, `new Set(['filing-failed', 'reverse-failed'])`). `unresolvedItems(consoleJson)` returns, in item order, every item whose `resolution` ∈ `UNRESOLVED_RESOLUTIONS` (returned unchanged, as today) **and** every item whose `outcome` ∈ `FAILED_OUTCOMES`, returned as a normalized copy `{ ...item, section: item.section ?? item.kind, resolution: item.outcome, reason: item.reason ?? item.note }` so `formatResidueLines`/`itemLines` render it without change. `splitMissing` never moves an item whose `resolution` ∈ `FAILED_OUTCOMES` into `missing` (its id names a PR row, not a staged file).

- [ ] **Step 1: Write the failing tests** (new tests in `residue.test.js`; a PR console fixture has `executedAt`, `resolved: false`, `prNumber`, `commentIds`, and items with NO staged files on disk)

```js
const PR_CONSOLE = (outcomes, extra = {}) => ({
  prNumber: 42, commentIds: ['IC_1'], executedAt: '2026-10-25T10:00:00.000Z', resolved: false,
  items: outcomes.map(([id, outcome, note]) => ({ id, kind: 'staged', summary: `s-${id}`, outcome, ...(note ? { note } : {}) })),
  ...extra,
});

test('FAILED_OUTCOMES is exactly filing-failed and reverse-failed', () => {
  assert.deepStrictEqual([...FAILED_OUTCOMES].sort(), ['filing-failed', 'reverse-failed']);
});

test('AC1.1: an executed PR console holding a filing-failed item is residue, never missing', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(PR_CONSOLE([
    ['1', 'executed'], ['f1', 'filing-failed', 'filing failed — see decisions.md'], ['d1', 'dropped', 'dropped — nothing filed'],
  ])));
  const { consoles } = readRunResidue(dir);
  assert.strictEqual(consoles.length, 1);
  assert.deepStrictEqual(consoles[0].items.map((i) => [i.id, i.resolution, i.section, i.reason]), [['f1', 'filing-failed', 'staged', 'filing failed — see decisions.md']]);
  assert.deepStrictEqual(consoles[0].missing, []);
  assert.strictEqual(consoles[0].acknowledged, false);
});

test('#4172: a reverse-failed ruling item is residue', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(PR_CONSOLE([['r1', 'reverse-failed', 'reverse not filed — see decisions.md']])));
  assert.deepStrictEqual(readRunResidue(dir).consoles[0].items.map((i) => i.resolution), ['reverse-failed']);
});

test('AC2.1: an executed PR console with only executed/dropped/declined/reversed items is not residue', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(PR_CONSOLE([
    ['1', 'executed'], ['d1', 'dropped'], ['x', 'declined'], ['r1', 'reversed'],
  ])));
  assert.deepStrictEqual(readRunResidue(dir).consoles, []);
});

test('#4172: a spec-N PR console with a filing-failed item is residue for the parent run', () => {
  const dir = tmpRun();
  fs.mkdirSync(path.join(dir, 'spec-12'));
  fs.writeFileSync(path.join(dir, 'spec-12', 'console.json'), JSON.stringify(PR_CONSOLE([['f1', 'filing-failed', 'n']])));
  assert.deepStrictEqual(readRunResidue(dir).consoles.map((c) => path.relative(dir, c.path)), [path.join('spec-12', 'console.json')]);
});

test('#4172: formatResidueLines names a filing-failed PR item with its note', () => {
  const dir = tmpRun();
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(PR_CONSOLE([['f1', 'filing-failed', 'filing failed — see decisions.md']])));
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  assert.ok(lines.includes('  - f1 — staged: filing-failed (filing failed — see decisions.md)'), lines.join('\n'));
});

test('AC1.1: the SessionStart banner scan lists a clean run whose PR console holds a filing-failed item', () => {
  // Same project/pipelines layout as the AC3 legacy test above, but top-level with run-state {status:'clean'}.
  // Call scanUnresolvedConsoles(project, { pluginRoot: '/p' }) and assert runs[0].dir === run and
  // runs[0].lines.some((l) => l.includes('f1 — staged: filing-failed')).
});
```

(The banner test follows the existing AC3 test's fixture shape: `mkdtemp` project, `.claude-tweaks/pipelines/{RUN_ID}` with `run-state.json` `{ "status": "clean" }`; import `scanUnresolvedConsoles` the way the AC3 test does.) Also add one live-console regression line to the AC1 test file: an item with `resolution: 'pending'` and an `outcome` field absent still counts exactly as before — covered by the existing suite; no new test.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/console/residue.test.js`
Expected: FAIL after Step 1 — `FAILED_OUTCOMES` is undefined / `consoles` is empty.

- [ ] **Step 3: Implement** `FAILED_OUTCOMES`, the widened `unresolvedItems`, and the `splitMissing` exemption in `residue.js` per the Interfaces block; update both files' header comments (one sentence each) to say a PR console's `filing-failed`/`reverse-failed` outcome is also residue (#4172).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/console/residue.test.js tests/bin-lib/console/residue-cli.test.js tests/bin-lib/hooks/session-residue.test.js tests/bin-lib/console/resolve.test.js tests/bin-lib/console/cli.test.js tests/bin-lib/console/backfill-apply.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/residue.js plugin/bin/console-residue.js tests/bin-lib/console/residue.test.js
git commit -m "Count a PR console's filing-failed and reverse-failed outcomes as console residue (refs #4172)"
```

### Task 3: Name the residue items in both archival refusals

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`consoleResidue`, `archiveMergedRun`'s skip return ~line 2048, the PR-by-number skip ~line 2386, exports)
- Modify: `plugin/bin/hooks.js` (archive-run's `consoleState === 'residue'` branch, ~line 1259)
- Test: `tests/archive-run-verb.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Consumes: Task 2's `readRunResidue` output (items carry `id` and normalized `resolution`).
- Produces: `consoleResidue(runDir)` returns `{ items: number, unreadable: string[], names: string[] }` — `names` is one `"{id} ({resolution})"` string per open item, in console then item order (`'(no id)'` for an item without a string id). `consoleResidueHint(runDir) -> string` (exported): `` `unresolved: ${names.join(', ')} — review, then run console-residue.js --ack --run "${runDir}"` `` when `names` is non-empty, else `` `repair or remove ${unreadable.join(', ')}` ``. Every reconcile-sweep skip with reason `console-residue` carries `hint: consoleResidueHint(dir)` (`reconcile/index.js` already forwards `hint`).
- archive-run refusal: the existing line, with ` — unresolved: {names.join(', ')}` appended before the trailing newline when `names` is non-empty.

- [ ] **Step 1: Write the failing tests**

In `tests/archive-run-verb.test.js` (after the `archive-run names both remedies…` test), with a helper writing a PR console (no staged files):

```js
function prConsole(runDir, outcomes, extra = {}) {
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    prNumber: 42, commentIds: ['IC_1'], executedAt: '2026-10-25T10:00:00.000Z', resolved: false,
    items: outcomes.map(([id, outcome]) => ({ id, kind: 'staged', summary: id, outcome })), ...extra,
  }));
}

test('AC1.1: archive-run refuses an executed PR console holding a filing-failed item, naming it', () => {
  const { root, runDir } = runDirFixture('clean');
  prConsole(runDir, [['1', 'executed'], ['f1', 'filing-failed']]);
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /archival refused — console-residue \(1 unresolved item\(s\) no human has reviewed; review them, then run console-residue\.js --ack --run .*\) — unresolved: f1 \(filing-failed\)\n$/);
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must not be moved');
});

test('AC1.1: console-residue.js --ack clears a filing-failed PR console and archive-run then archives', () => {
  const { root, runDir } = runDirFixture('clean');
  prConsole(runDir, [['f1', 'filing-failed']]);
  execFileSync('node', [path.join(__dirname, '..', 'plugin', 'bin', 'console-residue.js'), '--ack', '--run', runDir], { cwd: root, encoding: 'utf8' });
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
});

test('AC2.1: archive-run archives an executed PR console with only executed/dropped items', () => {
  const { root, runDir } = runDirFixture('clean');
  prConsole(runDir, [['1', 'executed'], ['d1', 'dropped']]);
  const result = runHook(['archive-run', '--run', runDir], { cwd: root });
  assert.doesNotMatch(result.stdout, /archival refused/);
  assert.ok(!fs.existsSync(runDir), 'run dir must be moved');
});
```

In `tests/bin-lib/reconcile/archive-merged.test.js`, a copy of the `…a resolved console holds a keep-staged item — stays in place with console-residue (#3949)` test (same `PATH_STUB_SKIP`, `makeRepo`, `installGhWrapper` CLOSED-PR shape, a distinct runId suffix `-prfailed`), whose console.json is the PR shape with items `[['1','executed'],['f1','filing-failed']]` and no staged file, asserting `skip.reason === 'console-residue'` and `assert.match(skip.hint, /unresolved: f1 \(filing-failed\) — review, then run console-residue\.js --ack --run /)`. Plus a unit test: `consoleResidue(dir)` on that PR console deep-equals `{ items: 1, unreadable: [], names: ['f1 (filing-failed)'] }`, and `readConsoleState(dir)` is `'residue'`; the same console with only `executed`/`dropped` items reads `'resolved'`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/archive-run-verb.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL — the refusal line has no ` — unresolved:` suffix; `skip.hint` is undefined; `names` missing. (The two archive-run AC1-ack/AC2 tests already pass after Task 2 — they pin the end-to-end behavior.)

- [ ] **Step 3: Implement** `names` in `consoleResidue`, `consoleResidueHint`, the `hint` on both `console-residue` skip sites in `archive-merged.js` (in `archiveMergedRun`, set `hint` when `decision.reason === 'console-residue'`; at the PR-by-number site, add `hint` to the pushed entry only for `console-residue`), and the archive-run suffix in `hooks.js` (destructure `names` from the existing `consoleResidue(runDir)` call).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/archive-run-verb.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/hooks-dispatcher.test.js tests/hooks-session-start.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/hooks.js tests/archive-run-verb.test.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Name the unresolved console items in both console-residue archival refusals (refs #4172)"
```

### Task 4: Contract prose

**Files:**
- Modify: `plugin/skills/_shared/console-execution.md` (Write order after execution, the sentence ending "together, in one write.")
- Modify: `plugin/skills/_shared/console-on-pr.md` (the `## {run-dir}/console.json` section — one sentence after the JSON block)
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md:36` (the console-residue parenthetical)
- Modify: `docs/reconcile-checks.md:243`
- Modify: `docs/plugin-structure.md` (the residue.js description on line 37 and the console-residue.js line 160)

**Interfaces:**
- Consumes: Tasks 1-3's behavior. Prose only; no code.

- [ ] **Step 1: Edit** each site with the minimal wording:
  - console-execution.md: the completion write also records each item's `outcome` (and `note`) on its `console.json` item; a `filing-failed` or `reverse-failed` outcome is console residue — archival refuses (`console-residue`) until `console-residue.js --ack` (#4172).
  - console-on-pr.md: after execution each item also carries `"outcome"` (and `"note"` for a non-executed one) — `console-execution.md`'s Write order.
  - cleanup-procedures-execution.md / reconcile-checks.md / plugin-structure.md: wherever residue is defined as `pending`/`keep-staged` items, add "or a PR console item whose outcome is `filing-failed`/`reverse-failed`".

- [ ] **Step 2: Verify** prose conformance suites still pass and no file crossed its size rail:

Run (AC3.1): `node --test tests/console-resolve-conformance.test.js tests/timing-prose-conformance.test.js` then `npm test > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/b4f34c75-d786-4f97-8bf3-7fbf8f2fccc8/scratchpad/npm-test-4172.txt 2>&1; echo exit=$?` (the full suite; prose is pinned by conformance tests repo-wide)
Expected: PASS, `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/_shared/console-execution.md plugin/skills/_shared/console-on-pr.md plugin/skills/wrap-up/cleanup-procedures-execution.md docs/reconcile-checks.md docs/plugin-structure.md
git commit -m "Document PR console failed outcomes as console residue (refs #4172)"
```
