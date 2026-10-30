# Calibration Window Timestamp Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `calibration-report.js`'s "last N runs" window holds the N most recent runs by the timestamp in their run ids. Entries whose id carries no timestamp are left out of the window, and the read-out says how many were left out.

**Architecture:** `aggregate()` in `plugin/bin/lib/calibration/aggregate.js` stops sorting run ids as plain strings. It parses each id's leading timestamp into a 14-digit `YYYYMMDDHHMMSS` key. It drops ids that have no such key, sorts the rest by key (tie-break: the full run id), and takes the last `windowN`. The result's `window` gains an `excluded` count. `calibration-report.js`'s text header prints that count.

**Tech Stack:** Node 18+ built-ins only; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T174945-record-4464/work/4464-spec.md` (record #4464)

Scope keywords: calibration/aggregate, calibration-report.js, window.runIds

## Global Constraints

- No new dependencies; CommonJS `'use strict'` modules matching the neighboring files.
- `calibration-report.js` still exits 0 in every non-usage case and 2 on a malformed `--runs` (unchanged contract, `docs/plugin-structure.md` line 170).
- Release note (verbatim from the spec): "the calibration read-out in /claude-tweaks:tidy now reflects your most recent runs."
- Commit messages: `{Verb} {what} — {detail}` style, ending `refs #4464` (never `closes`/`fixes`).

## Review Focus

1. Two runs with the same timestamp (the real archive has `2026-08-09T094731-spec-246-247-254` and `2026-08-09T094731-spec-246-247-254-untracked-halves`). The order must be deterministic, with ties broken by the full run id. Pinned in Task 1 (`ties on timestamp break by run id`).
2. An archive where no entry has a timestamp. The window is empty, `excluded` equals the entry count, and the CLI still prints its sections with exit 0. Pinned in Task 2 (`header with only undated entries`).
3. A TSV-only legacy run id such as `spec-259`, which becomes a stub run through `calibration-report.js`'s #917 synthesis. It must be excluded and counted, never placed in the window. Pinned in Task 2's header test, which uses a TSV `spec-259` row.
4. Timestamp shapes found in the real archive that are not `YYYY-MM-DDTHHMMSS-`. The minute-precision `2026-07-19T1900-record-39` and the compact `20260911T131119-backlog-standalone` are dated runs: they parse and are ordered by time, not by text. Pinned in Task 1 (`compact and minute-precision ids order by time`).
5. `windowN` larger than the number of dated runs. The window holds only the dated runs, and undated ones never pad it. Pinned in Task 1 (`undated runs never pad a short window`).

---

### Task 1: Timestamp-ordered window selection in `aggregate()`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/calibration/aggregate.js` (lines 7-10: window selection; the returned `window` object)
- Test: `tests/bin-lib/calibration/aggregate.test.js` (replace the `window selects the last N runIds by name sort` test; add the tests below)

**Interfaces:**
- Consumes: nothing new.
- Produces: `runIdTimestamp(runId: string): string | null`, exported from `aggregate.js` alongside `aggregate`. It returns the 14-digit `YYYYMMDDHHMMSS` key, or `null` when the id has no leading timestamp. `aggregate(...)`'s return `window` becomes `{ runIds: string[], excluded: number }`, where `excluded` counts the input runs whose `runIdTimestamp` is `null`.
- Consumer enumeration (`window.runIds`/`aggregate`): `plugin/bin/calibration-report.js`, which is pick-one: it renders `runIds.length` and serializes the result for `--json`. The other consumers are tests only: `tests/bin-lib/calibration/aggregate.test.js` and `tests/bin-lib/calibration/cli.test.js` (Task 2). No other caller exists (`git grep -n "calibration/aggregate"`).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/calibration/aggregate.test.js`, importing `runIdTimestamp` as well. Replace the existing `aggregate: window selects the last N runIds by name sort` test with these:

```js
test('AC1.1: with the 2026-10-27 archive shape, the window is the 20 most recent hyphenated-timestamp runs', () => {
  const dated = [];
  for (let d = 1; d <= 25; d++) dated.push(`2026-10-${String(d).padStart(2, '0')}T120000-record-${d}`);
  const undated = ['spec-339', 'spec-852', 'unresolved-provenance'];
  const olderDated = ['20260911T131119-backlog-standalone', '2026-07-19T1900-record-39'];
  // input deliberately unsorted: undated and older ids interleaved
  const ids = [...undated.slice(0, 1), ...dated.slice().reverse(), ...olderDated, ...undated.slice(1)];
  const runs = ids.map((runId) => ({ runId, decisionLines: [], events: { counts: {} } }));
  const result = aggregate({ tsv: { rows: [] }, runs, rowIds: [], windowN: 20 });
  assert.deepStrictEqual(result.window.runIds, dated.slice(5));
  assert.strictEqual(result.window.excluded, 3);
});

test('runIdTimestamp: parses hyphenated, minute-precision and compact ids; null for undated', () => {
  assert.strictEqual(runIdTimestamp('2026-10-27T055458-tidy-standalone'), '20261027055458');
  assert.strictEqual(runIdTimestamp('2026-07-19T1900-record-39'), '20260719190000');
  assert.strictEqual(runIdTimestamp('20260911T131119-backlog-standalone'), '20260911131119');
  assert.strictEqual(runIdTimestamp('2026-10-01T120000'), '20261001120000');
  assert.strictEqual(runIdTimestamp('spec-339'), null);
  assert.strictEqual(runIdTimestamp('unresolved-provenance'), null);
  assert.strictEqual(runIdTimestamp('run-1'), null);
});

test('compact and minute-precision ids order by time, not by text', () => {
  const ids = ['2026-10-01T0001-c', '20261001T000000-a', '2026-09-30T235959-b'];
  const runs = ids.map((runId) => ({ runId, decisionLines: [], events: { counts: {} } }));
  const result = aggregate({ tsv: { rows: [] }, runs, rowIds: [], windowN: 2 });
  assert.deepStrictEqual(result.window.runIds, ['20261001T000000-a', '2026-10-01T0001-c']);
  assert.strictEqual(result.window.excluded, 0);
});

test('ties on timestamp break by run id', () => {
  const ids = ['2026-08-09T094731-spec-246-247-254-untracked-halves', '2026-08-09T094731-spec-246-247-254'];
  const runs = ids.map((runId) => ({ runId, decisionLines: [], events: { counts: {} } }));
  const result = aggregate({ tsv: { rows: [] }, runs, rowIds: [], windowN: 20 });
  assert.deepStrictEqual(result.window.runIds, ['2026-08-09T094731-spec-246-247-254', '2026-08-09T094731-spec-246-247-254-untracked-halves']);
});

test('undated runs never pad a short window', () => {
  const ids = ['2026-08-01T000000-a', 'run-1', '2026-08-02T000000-b', 'spec-12'];
  const runs = ids.map((runId) => ({ runId, decisionLines: ['- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.'], events: { counts: {} } }));
  const result = aggregate({ tsv: { rows: [] }, runs, rowIds: [], windowN: 20 });
  assert.deepStrictEqual(result.window.runIds, ['2026-08-01T000000-a', '2026-08-02T000000-b']);
  assert.strictEqual(result.window.excluded, 2);
  assert.strictEqual(result.consoleDist['approve-all'], 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/calibration/aggregate.test.js`
Expected: FAIL. `runIdTimestamp` is not a function, and the AC1.1 deepStrictEqual fails because name sort puts `unresolved-provenance`/`spec-*` last.

- [ ] **Step 3: Implement `runIdTimestamp(runId)` and the timestamp-ordered window in `plugin/bin/lib/calibration/aggregate.js`**

`runIdTimestamp` matches two anchored shapes and returns `null` for anything else:
- Hyphenated: `^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})?(?:-|$)`. Missing seconds become `00`.
- Compact: `^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:-|$)`.

In `aggregate`, replace the string sort. First split `runs` into dated runs (key non-null) and the `excluded` count. Then sort the dated runs by key, using `runId` as the tie-break with the same `<`/`>` comparison the old code used, and take `slice(-windowN)`. Return `window: { runIds, excluded }`. Every other part of `aggregate` is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/calibration/aggregate.test.js`
Expected: PASS, all tests (the five pre-existing ones use dated `2026-08-DDT000000-run` ids and still pass).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/calibration/aggregate.js tests/bin-lib/calibration/aggregate.test.js
git commit -m "Order the calibration window by run-id timestamp — undated archive entries are excluded and counted, refs #4464"
```

### Task 2: Read-out header names the excluded count; CLI fixtures and docs follow the new rule

**Role:** integration

**Files:**
- Modify: `plugin/bin/calibration-report.js` (`renderText`, the `Window:` line at line 80)
- Modify: `tests/bin-lib/calibration/cli.test.js`. Every fixture run id that carries no timestamp (`run-1`, `run-2`, `` `run-${i}` ``, in archive dir names and TSV rows) becomes a dated id. Use `2026-08-01T000000-run-1`, `2026-08-02T000000-run-2`, and `` `2026-08-${String(i).padStart(2, '0')}T000000-run-${i}` ``, and update the matching `includes(...)` assertions in the #917 test. Under the new rule an undated fixture would be excluded and every existing assertion would read an empty window. Add the two tests below.
- Modify: `docs/plugin-structure.md` line 170. "the last N archived runs' decisions.md/events.jsonl (default 20)" becomes "the N most recent archived runs' decisions.md/events.jsonl by run-id timestamp (default 20; entries with no run-id timestamp, such as legacy `spec-N` ids and non-run dirs, are excluded and counted in the header)".
- Modify (only if a cited line moves): `tests/path-guard-conformance.test.js`. The `calibration-report.js` allowlist `reason` cites "line 52" and "line 113" (the two `existsSync` sites). Re-check both with `grep -n existsSync plugin/bin/calibration-report.js` after the edit, and update the numbers if they changed. The `existsSync: 2` count is unchanged.
- No change: `plugin/skills/tidy/scan-procedures.md:320` (renders the output verbatim, so no window wording) and `plugin/skills/tidy/SKILL.md:106`. Also no change: `docs/skill-graph.md:344`, `docs/journeys/keep-test-suite-denials-out-of-the-friction-counts-4186.md`, `plugin/skills/wrap-up/review-console.md:59` and `plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md:44`. Each cites `calibration-report.js` for its inputs or friction filtering and states no window-selection rule.

**Interfaces:**
- Consumes: Task 1's `window: { runIds: string[], excluded: number }` from `aggregate()`.
- Produces: the header line. With `excluded === 0` it is unchanged: `Window: last {k} archived run(s).` With `excluded > 0` it is `Window: last {k} archived run(s); {x} archive entr{y|ies} without a run-id timestamp excluded.` (`entry` when `x === 1`, `entries` otherwise).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/calibration/cli.test.js`, after converting the existing fixtures to dated ids as listed above:

```js
test('header names how many undated archive entries were excluded', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-excluded-'));
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'),
    '2026-08-01\t2026-08-01T000000-run-1\tskills\tclosed\t0\tna\n2026-08-02\tspec-259\tskills\tclosed\t0\tna\n',
  );
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive');
  for (const runId of ['2026-08-01T000000-run-1', '2026-08-02T000000-run-2', 'unresolved-provenance']) {
    fs.mkdirSync(path.join(archiveDir, runId), { recursive: true });
  }
  const jsonOut = JSON.parse(run(['--json'], root));
  assert.deepStrictEqual(jsonOut.window.runIds, ['2026-08-01T000000-run-1', '2026-08-02T000000-run-2']);
  assert.strictEqual(jsonOut.window.excluded, 2);
  assert.match(run([], root), /^Window: last 2 archived run\(s\); 2 archive entries without a run-id timestamp excluded\.$/m);
});

test('header with only undated entries reports an empty window and exits 0', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-undated-'));
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', 'unresolved-provenance'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'), '');
  const out = run([], root);
  assert.match(out, /^Window: last 0 archived run\(s\); 1 archive entry without a run-id timestamp excluded\.$/m);
  assert.match(out, /Console terminal-decision distribution/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/calibration/cli.test.js`
Expected: FAIL. The two new header tests fail on the `Window:` regex, because the old header has no excluded clause. The converted fixtures pass.

- [ ] **Step 3: Implement the header in `renderText` in `plugin/bin/calibration-report.js`.** Build it from `result.window.runIds.length` and `result.window.excluded`, using the exact copy in the Interfaces block. Change nothing else in the file. Then apply the `docs/plugin-structure.md` line 170 edit, and re-check the path-guard allowlist line numbers as listed in Files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/calibration/cli.test.js tests/bin-lib/calibration/aggregate.test.js tests/path-guard-conformance.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Real-input probe (AC1.1 on the real archive).** From the worktree, run the finished CLI against the main checkout's real archive and save its output as evidence:

```bash
mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-28T174945-record-4464/evidence"
```

```bash
node plugin/bin/calibration-report.js --json --root "/Users/thomasholknielsen/Code Workspaces/claude-tweaks" > "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-28T174945-record-4464/evidence/ac1-real-archive.json"
```

Check this against an independent count that the reader did not compute. Take the union of the archive's directory names and the TSV's column-2 run ids, keep those matching `^\d{4}-\d{2}-\d{2}T\d{4}(\d{2})?(-|$)` or `^\d{8}T\d{6}(-|$)`, order them by normalized timestamp, and take the last 20. Do this with a scratch script that is not committed. Record both lists. `window.runIds` must equal that list exactly, and every entry must be a hyphenated `2026-10-…` id (AC1.1). Write the independent list to `evidence/ac1-independent.txt` in the same directory. Then log one `decisions.md` entry with `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file {file}`. The file holds one line: AC1.1's wording, the command shape, the window size, the `excluded` count, the match/mismatch verdict, and both evidence paths.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/calibration-report.js tests/bin-lib/calibration/cli.test.js docs/plugin-structure.md
git commit -m "Name the excluded undated entries in the calibration read-out header — fixtures move to dated run ids, refs #4464"
```

(Add `tests/path-guard-conformance.test.js` to the `git add` only if Step 3 changed it.)

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1: order runs by parsed timestamp | Task 1 |
| Deliverable 1: exclude non-run archive entries from the window | Task 1 (`excluded`), Task 2 (TSV stub and non-run dir in the CLI) |
| Approach: say in the read-out how many were excluded | Task 2 header |
| AC1.1: the window lists the 20 most recent hyphenated-timestamp runs with the 2026-10-27 archive shape | Task 1 `AC1.1` test; Task 2 Step 5 real-archive probe |
