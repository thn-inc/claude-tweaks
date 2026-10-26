# Skip test:true gate-denial events at the Review Console and in calibration-report (#4186) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution:** batched
**Batch:** send every task to one implementer as a single brief; review the combined diff once.

**Goal:** Test-suite-produced `gate-denial` events (`test: true`, #1337) stop reaching the wrap-up Review Console and `calibration-report.js`'s friction counts.

**Architecture:** `plugin/bin/friction-events.js`'s `readEvents` already drops `(type === 'gate-denial' || type === 'wd-guard-refusal') && test === true`. The Review Console's read-inputs step is model-executed prose that reads `events.jsonl` directly and surfaces `wd-deny`, `wd-push-mismatch`, `contract-violation`, `gate-denial` — routing it through `friction-events.js` would drop `wd-push-mismatch` (not in `FRICTION_EVENT_TYPES`) and add claim-boundary/attribution filters the console never applied, so the console states the exclusion instead (Deliverable 1's second option). `calibration-report.js` counts kinds via `plugin/bin/lib/calibration/events-reader.js`'s `readEventsKinds`; the exclusion goes there (the only reader feeding `aggregate()`'s `frictionCounts`).

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T110720-record-4186/work/4186-spec.md`

**Scope keywords:** readEventsKinds

## Global Constraints

- Exclusion predicate is byte-identical in meaning to `friction-events.js`'s: `(parsed.type === 'gate-denial' || parsed.type === 'wd-guard-refusal') && parsed.test === true`. Nothing else is filtered (no `attribution`, no `variant`, no claim boundary) — those are out of scope.
- `friction-events.js` is read-only for this record.

## Review Focus

- A `gate-denial` with `test: false` or no `test` field must still be counted (only literal `true` excludes).
- A `test: true` event of a type other than `gate-denial`/`wd-guard-refusal` (e.g. `commit`) must still be counted — the exclusion is type-scoped, same as friction-events.js.
- `wd-push-mismatch` must stay in the console's surfaced list (the reason the console is not routed through friction-events.js).
- Malformed lines / missing file behavior of `readEventsKinds` unchanged (existing tests cover).

## Consumer enumeration

`git grep -n readEventsKinds -- plugin tests` → `plugin/bin/calibration-report.js` (loadRuns, list-all: counts every event) and `tests/bin-lib/calibration/readers.test.js`. No other consumer.

---

### Task 1: Exclude test-produced denials from readEventsKinds

**Files:**
- Modify: `plugin/bin/lib/calibration/events-reader.js`
- Test: `tests/bin-lib/calibration/readers.test.js`
- Test: `tests/bin-lib/calibration/cli.test.js`

**Interfaces:**
- Produces: `readEventsKinds(filePath) -> { counts } | null` — unchanged signature; counts now omit `test: true` gate-denial/wd-guard-refusal lines.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/calibration/readers.test.js`:

```js
test('AC1.1: readEventsKinds drops test:true gate-denial/wd-guard-refusal, keeps the real one (#4186)', () => {
  const p = tmpFile('events.jsonl');
  fs.writeFileSync(p, [
    '{"type":"gate-denial","test":true}',
    '{"type":"gate-denial"}',
    '{"type":"gate-denial","test":false}',
    '{"type":"wd-guard-refusal","test":true}',
    '{"type":"commit","test":true}',
  ].join('\n') + '\n');
  assert.deepStrictEqual(readEventsKinds(p).counts, { 'gate-denial': 2, commit: 1 });
});
```

Append to `tests/bin-lib/calibration/cli.test.js`:

```js
test('AC1.1: calibration-report counts only the real gate-denial when a run also holds a test:true one (#4186)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-testdenial-'));
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'), '2026-08-01\trun-1\tskills\tclosed\t0\tna\n');
  const dir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', 'run-1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.md'), '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n');
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"type":"gate-denial","test":true}\n{"type":"gate-denial"}\n');
  const jsonOut = JSON.parse(run(['--json'], root));
  assert.strictEqual(jsonOut.frictionCounts['gate-denial'], 1);
  assert.match(run([], root), /gate-denial: 1\b/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/calibration/readers.test.js tests/bin-lib/calibration/cli.test.js`
Expected: FAIL — readers test gets `{ 'gate-denial': 3, 'wd-guard-refusal': 1, commit: 1 }`; CLI test gets `2`.

- [ ] **Step 3: Implement**

In `readEventsKinds`, after the `typeof parsed.type !== 'string'` guard, add one `continue` on the Global Constraints predicate, with a comment citing #4186 and `bin/friction-events.js`'s `readEvents` (#1337, widened #2282) as the source of the same rule.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/calibration/readers.test.js tests/bin-lib/calibration/cli.test.js`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Real-input probe (plan-authoring Real-input + Independent-count checks)**

Run from the worktree against the main checkout's archive:
`node plugin/bin/calibration-report.js --json --runs 100000 --root "/Users/thomasholknielsen/Code Workspaces/claude-tweaks"` before and after the change (`git show HEAD:plugin/bin/lib/calibration/events-reader.js` gives the baseline — run the baseline by temporary WIP comparison, never `git stash`), and independently count the raw lines: `grep -rh '"type":"gate-denial"' "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive" --include=events.jsonl | grep -c '"test":true'` (restricted to the run ids in the report's window). Reconcile: before − after gate-denial count == independent test:true count within the window. Record the numbers in the commit body.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/calibration/events-reader.js tests/bin-lib/calibration/readers.test.js tests/bin-lib/calibration/cli.test.js
git commit -m "Skip test:true gate-denial events in calibration-report counts — same exclusion friction-events.js applies

refs #4186"
```

### Task 2: State the exclusion at the Review Console's events read

**Files:**
- Modify: `plugin/skills/wrap-up/review-console.md:59`
- Test: `tests/review-console-events-test-exclusion-conformance.test.js` (create)

**Interfaces:** none.

Size: `review-console.md` is 32,718 B against the 52,500 B rail; this adds ~250 B (headroom ~19.5 KB).

- [ ] **Step 1: Write the failing test**

Create `tests/review-console-events-test-exclusion-conformance.test.js` (style: `tests/review-console-header-conformance.test.js`, `readText` from `tests/helpers/read-skill`):

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'review-console.md');

function eventsInputLine(text) {
  const line = text.split('\n').find((l) => /^4\. `events\.jsonl`/.test(l));
  assert.ok(line, 'Read inputs item 4 (events.jsonl) must exist');
  return line;
}

function assertExclusion(line) {
  for (const t of ['`wd-deny`', '`wd-push-mismatch`', '`contract-violation`', '`gate-denial`']) {
    assert.ok(line.includes(t), `events.jsonl input must still surface ${t}`);
  }
  assert.match(line, /`gate-denial`[^\n]*`test: true`/, 'must state the test:true gate-denial exclusion');
  assert.ok(line.includes('bin/friction-events.js'), 'must cite the read boundary that owns the same exclusion');
}

test('AC1.1: the Review Console events.jsonl read skips test:true gate-denial events (#4186)', () => {
  assertExclusion(eventsInputLine(readText(FILE)));
});

test('AC1.1 go-red control: the pre-#4186 line fails the same assertion', () => {
  const before = '4. `events.jsonl` — hook-recorded typed events; surface `wd-deny`, `wd-push-mismatch`, `contract-violation`, and `gate-denial` events';
  assert.throws(() => assertExclusion(before));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-console-events-test-exclusion-conformance.test.js`
Expected: FAIL on the first test (missing `test: true`); go-red control PASS.

- [ ] **Step 3: Implement**

Replace line 59 with exactly:

```
4. `events.jsonl` — hook-recorded typed events; surface `wd-deny`, `wd-push-mismatch`, `contract-violation`, and `gate-denial` events, skipping any `gate-denial` carrying `test: true` — the test suite's own exercise of the hook's deny logic (#1337), never operator friction; the same exclusion `bin/friction-events.js` and `bin/calibration-report.js` apply
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/review-console-events-test-exclusion-conformance.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/review-console.md tests/review-console-events-test-exclusion-conformance.test.js
git commit -m "State the test:true gate-denial exclusion at the Review Console's events read

refs #4186"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (console exclusion) | Task 2 |
| Deliverable 2 (calibration-report exclusion) | Task 1 |
| AC1.1 (fixture: one test + one real gate-denial → only real at console and in count) | Task 1 Steps 1/4 (count, fixture), Task 2 Steps 1/4 (console prose — the console is model-rendered from this line, so the pin is on the instruction it renders from) |
