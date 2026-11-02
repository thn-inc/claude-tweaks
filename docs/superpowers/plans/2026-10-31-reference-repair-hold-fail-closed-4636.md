# Reference-Repair Hold Fails Closed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A floor denial computed by `permittedInitiative` reaches the Review Console resolver through a structured JSON field in `engine-state.json`, and a `staged/wrap-up-reference-*.md` repair the resolver cannot classify resolves `pending` instead of `approve`.

**Architecture:** `permittedInitiative` (`plugin/bin/lib/issues/initiative-budget.js`) gains a boolean `hold` on every result, derived from the floor conditions whichever check fails first. The broken-reference sweep writes it as `findings[].hold` in its `references` payload (which `engine-record.js` already stores verbatim into `engine-state.json`) and copies it into a required `Hold: yes|no` header of the staged file. `resolve.js` approves a repair only when that JSON field reads `hold: false` and the header agrees; any disagreement, absence or malformed value holds. No engine or CLI change is needed: `pickStoredFields` keeps `payload.findings` as given.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T161745-record-4636/work/4636-spec.md`

Scope keywords: referenceRepairHoldReason, reference-repair-held, permittedInitiative

## Global Constraints

- Acceptance criterion (verbatim): "A floor denial computed by permittedInitiative reaches the resolver through a structured field, and a file the resolver cannot classify holds rather than approves, matching sddRulingDeferralReason."
- Plan Review Decision (verbatim): "`permittedInitiative`'s `hold` travels as a JSON field the reference sweep writes into `engine-state.json`'s `references` findings, which `plugin/bin/lib/console/resolve.js` already reads; the resolver holds the repair unless that JSON field reads `hold: false` and the staged file's `Hold:` header agrees. Any disagreement, absence or malformed value holds (fails closed)."
- Plan Review Decision (verbatim): "`hold` is computed from the floor conditions regardless of which check fails first: a test-file, causal-set or merge-sensitive repair that is also over budget or over a size cap still gets `hold: true`."
- Plan Review Decision (verbatim): "Task 1 (the per-denial-path decision logic) carries `Review risk: high`."
- Deliverable (verbatim): "Fix the defect at `plugin/bin/lib/console/resolve.js:646`, with a regression test." The function is now `referenceRepairHoldReason`, at line 722.
- Header = the lines before the first empty line, split on `/\r?\n/`, each with trailing whitespace stripped by `trimEnd()` (the header rule `sddRulingDeferralReason` uses, without its `/\s+$/` regex).
- Existing reason strings stay byte-identical: `reference-repair-held`, `reference-repair-unreadable`. One new reason string: `reference-repair-unclassified`.
- Expand-contract: a `Held: {reason}` header line still holds (files staged by earlier versions in in-flight runs keep holding). A repair staged before this change has no JSON `hold`, so it resolves `pending`. That is the intended fail-closed change: it costs one click, never an unattended apply.
- Existing denial `reason` strings and their order stay unchanged. `tests/bin-lib/issues/initiative-budget.test.js` already pins them, and it has no whole-result `deepEqual`, so the widened return shape defangs nothing (grep: `git grep -n permittedInitiative -- tests plugin/bin` shows one test module and no other code caller).
- `.claude/skills/review-console-section-addition/SKILL.md`, quoted: "**A new `pending` reason on an existing row needs the same sibling grep.** None of sites 1–5 moves when a row gains a reason it resolves pending under". `git grep -n -E 'reference-repair-(held|unreadable)' -- plugin docs/journeys tests` gives the site list Task 3 covers: `resolve.js`, `reference-sweep.md`, `review-console-appendix.md`, the two journeys, `resolve.test.js`.
- `.claude/skills/prose-code-twin-pin/SKILL.md`, quoted: "Iterate the export by default". The reasons are exported as a frozen `REFERENCE_REPAIR_REASONS` and iterated against the appendix.
- Size: `curation-engine.md` is 27,411 B, `reference-sweep.md` 6,215 B, `review-console-appendix.md` 17,042 B, `initiative-budget.md` 6,214 B, all well under the 52,500 B rail.

## Review Focus

1. **A repair staged before this change, with no `Hold:` line and no JSON `hold`.** It must resolve `pending`, never `approve`. Pinned in Task 2's unclassified test (`missing`, and the JSON cases).
2. **Header and JSON disagree, either way.** `Hold: no` with `hold: true`, and `Hold: yes` with `hold: false`, both hold. Pinned in Task 2.
3. **An absolute `stagePath`.** The judge records an absolute path and the resolver matches on its basename. Pinned in Task 2's real-writer test.
4. **CRLF, case and trailing whitespace.** `hold: NO   ` and `Hold: no\r\n\r\nbody` read as `no`. Pinned in Task 2.
5. **A `Hold:` or `Held:` line in the body, or `Held:` beside `Hold: no`.** A body line classifies nothing; an explicit hold reason wins. Pinned in Task 2.

---

### Task 1: `permittedInitiative` returns a structured `hold` field

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/initiative-budget.js`
- Modify: `plugin/skills/_shared/initiative-budget.md` (Floor rule section, after the paragraph starting "The budget is per run")
- Test: `tests/bin-lib/issues/initiative-budget.test.js`

**Interfaces:**
- Produces: `permittedInitiative(input) -> { allowed: boolean, reason: string, hold: boolean }`. `hold` is a boolean on every return path.
  - `hold: true` when any floor condition fails, whichever check fails first: no fix, an untaught kind, no files, a malformed file path, a missing or malformed changed-line count, a test file, a missing `brokenBy`, `brokenBy` not among this run's changed files, a merge-sensitive path.
  - `hold: false` otherwise. That covers `allowed: true` and a clean fix denied only by the ceiling, the budget, the files cap or the lines cap.
  - `reason` is the first failing check in today's order, unchanged.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/issues/initiative-budget.test.js`, reusing its `base()` fixture and `DEFAULT_BUDGET`)

```js
test('#4636: an allowed fix does not hold', () => {
  const r = permittedInitiative(base());
  assert.strictEqual(r.allowed, true, r.reason);
  assert.strictEqual(r.hold, false);
});

test('#4636: a clean fix denied only by the ceiling, budget or a cap is approvable (hold false)', () => {
  const cases = [
    { ...base(), ceiling: 'supervised' },
    { ...base(), spent: DEFAULT_BUDGET.maxFixes },
    { ...base(), fix: { ...base().fix, files: ['a.md', 'b.md', 'c.md'] } },
    { ...base(), fix: { ...base().fix, changedLines: DEFAULT_BUDGET.maxLinesPerFix + 1 } },
  ];
  for (const input of cases) {
    const r = permittedInitiative(input);
    assert.strictEqual(r.allowed, false, JSON.stringify(input));
    assert.strictEqual(r.hold, false, r.reason);
  }
});

const FLOOR_DENIALS = {
  'test file': (b) => ({ ...b, fix: { ...b.fix, files: ['tests/a.test.js'] } }),
  'merge-sensitive path': (b) => ({ ...b, sensitivePaths: ['docs/**'] }),
  'brokenBy outside the causal set': (b) => ({ ...b, fix: { ...b.fix, brokenBy: 'not/changed.md' } }),
  'no brokenBy': (b) => ({ ...b, fix: { ...b.fix, brokenBy: '' } }),
  'untaught kind': (b) => ({ ...b, fix: { ...b.fix, kind: 'typo' } }),
  'no files': (b) => ({ ...b, fix: { ...b.fix, files: [] } }),
  'malformed file path': (b) => ({ ...b, fix: { ...b.fix, files: [''] } }),
  'no changed-line count': (b) => ({ ...b, fix: { ...b.fix, changedLines: undefined } }),
  'no fix': (b) => ({ ...b, fix: null }),
};

test('AC1.1 (#4636): every floor denial holds', () => {
  for (const [label, make] of Object.entries(FLOOR_DENIALS)) {
    const r = permittedInitiative(make(base()));
    assert.strictEqual(r.allowed, false, label);
    assert.strictEqual(r.hold, true, label);
  }
  assert.strictEqual(permittedInitiative(undefined).hold, true, 'no input names no fix');
});

test('AC1.1 (#4636): a floor denial holds whichever check fails first', () => {
  const earlier = {
    'ceiling': (i) => ({ ...i, ceiling: 'supervised' }),
    'budget': (i) => ({ ...i, spent: DEFAULT_BUDGET.maxFixes }),
    'lines cap': (i) => (i.fix ? { ...i, fix: { ...i.fix, changedLines: DEFAULT_BUDGET.maxLinesPerFix + 1 } } : i),
    'files cap': (i) => (i.fix ? { ...i, fix: { ...i.fix, files: [...(i.fix.files || []), 'x1.md', 'x2.md', 'x3.md'] } } : i),
  };
  for (const [floor, make] of Object.entries(FLOOR_DENIALS)) {
    for (const [check, worsen] of Object.entries(earlier)) {
      if (floor === 'no changed-line count' && check === 'lines cap') continue; // lines cap replaces the missing count
      const r = permittedInitiative(worsen(make(base())));
      assert.strictEqual(r.allowed, false, `${floor} + ${check}`);
      assert.strictEqual(r.hold, true, `${floor} + ${check}: ${r.reason}`);
    }
  }
});

test('#4636: the reported reason stays the first failing check', () => {
  const r = permittedInitiative({ ...base(), spent: DEFAULT_BUDGET.maxFixes, fix: { ...base().fix, files: ['tests/a.test.js'] } });
  assert.match(r.reason, /budget exhausted/);
  assert.strictEqual(r.hold, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/initiative-budget.test.js`
Expected: FAIL — `#4636: an allowed fix does not hold` fails with `undefined !== false`.

- [ ] **Step 3: Implement the `hold` field in `plugin/bin/lib/issues/initiative-budget.js`**

Replace the early returns with one ordered list of checks, so the floor conditions are stated once and `hold` cannot drift from them:

```js
const checks = [
  { floor: false, fails: /* ceiling not allowed */, reason: /* today's text */ },
  { floor: true,  fails: /* no fix */,              reason: 'no fix supplied' },
  // ... kind (floor), budget (not), no files (floor), malformed path (floor), files cap (not),
  // no line count (floor), lines cap (not), test file (floor), no brokenBy (floor),
  // brokenBy not changed (floor), merge-sensitive (floor) — today's order, today's reason text.
];
const failed = checks.filter((c) => c.fails);
if (failed.length === 0) return { allowed: true, reason: /* today's text */, hold: false };
return { allowed: false, reason: failed[0].reason, hold: failed.some((c) => c.floor) };
```

Every `fails` is evaluated for every input, so normalize first: `fix` to an object or `null`, `files` to an array (an absent `files` is the no-files failure), and pick string entries before the test-path and sensitive-path matches. Remove `deny`. Update the JSDoc `@returns` to `{{allowed: boolean, reason: string, hold: boolean}}`, and add a comment above `checks` saying `hold` is what `wrap-up/reference-sweep.md` Step 4 writes into the finding's `hold` field and the staged file's `Hold:` header, and that `floor: true` marks a condition no human click at an unattended console may skip.

- [ ] **Step 4: Document the field in `plugin/skills/_shared/initiative-budget.md`**

After the paragraph starting "The budget is per run", add one paragraph. It says that every result also carries a boolean `hold`, computed from the floor conditions whichever check fails first: `true` when kind, causal link, tests or merge-sensitive fails, or when the fix itself is missing or malformed; `false` for an allowed fix and for a fix denied only by the ceiling, the budget or a size cap. It says `wrap-up/reference-sweep.md` Step 4 writes `hold` into the finding's JSON and the staged file's `Hold:` header, and that the Review Console resolver approves only when both say no.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/initiative-budget.test.js`
Expected: PASS (all tests, the existing ones included)

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/initiative-budget.js plugin/skills/_shared/initiative-budget.md tests/bin-lib/issues/initiative-budget.test.js
git commit -m "Add a structured hold field to permittedInitiative — refs #4636"
```

---

### Task 2: The resolver holds unless the JSON `hold` and the staged header both say no

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (`referenceRepairHoldReason` and its comment, `stagedItems`, `engineItems`, `module.exports`)
- Test: `tests/bin-lib/console/resolve.test.js` (lines 337-349, 351-358, 370-373, plus appended tests)

**Interfaces:**
- Consumes: Task 1's `hold` only as data: `engineState.results.references.findings[].hold`, never through a `require`.
- Produces: exported frozen `REFERENCE_REPAIR_REASONS = { HELD: 'reference-repair-held', UNCLASSIFIED: 'reference-repair-unclassified', UNREADABLE: 'reference-repair-unreadable' }`, for Task 3's prose. `referenceRepairHoldReason(item, findings) -> null | one of those`, module-private, where `findings` is the array of `references` findings naming this file.

- [ ] **Step 1: Update the existing fixtures and write the failing tests** in `tests/bin-lib/console/resolve.test.js`

The M9 test (`every ENGINE_ROW_SECTIONS row classifies a staged finding…`, line ~337): a `references` staged finding with no staged file now resolves `pending` with reason `reference-repair-unclassified`. Assert that for `references`, and the section stance for the other rows.

`AC1.1: a staged wrap-up-reference- repair…` (line ~351): give the finding `hold: false` and change the staged text `'repair'` to `'Hold: no\n\nrepair'`. `a Held: line past the staged reference repair header does not hold it` (line ~370): change the text to `'Hold: no\nTarget: docs/a.md\n\nHeld: quoted from the repaired file'` and pass `engineState: refState()` (below). Both still assert `approve`.

Append, using the file's `fixture`/`deps`/`resolveAll` helpers:

```js
const refState = (hold = false, stagePath = 'staged/wrap-up-reference-1.md') => ({
  results: { references: { result: 'findings', findings: [{ targetPath: 'docs/a.md', action: 'staged', stagePath, hold }] } },
});
const resolveRef = (text, engineState) => resolveAll({ runDir: fixture({ engineState, staged: { 'wrap-up-reference-1.md': text }, headers: [7] }), policy: 'console-auto', deps: deps() }).items[0];

test('AC1.1 (#4636): a repair approves only when the JSON hold is false and the header agrees', () => {
  for (const text of ['Hold: no\n\nbody', 'hold: NO   \nTarget: docs/a.md\n\nbody', 'Hold: no\r\n\r\nbody']) {
    assert.strictEqual(resolveRef(text, refState()).resolution, 'approve', JSON.stringify(text));
  }
});

test('AC1.1 (#4636): a floor denial the JSON carries holds even under a header that says no', () => {
  const item = resolveRef('Hold: no\n\nbody', refState(true));
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'reference-repair-held');
});

test('#4636: Hold: yes, or Held: beside Hold: no, holds under a JSON hold of false', () => {
  for (const text of ['Hold: yes\n\nbody', 'Hold: no\nHeld: test file\n\nbody']) {
    const item = resolveRef(text, refState());
    assert.strictEqual(item.resolution, 'pending', JSON.stringify(text));
    assert.strictEqual(item.reason, 'reference-repair-held', JSON.stringify(text));
  }
});

test('AC1.1 (#4636): a staged header the resolver cannot classify holds rather than approves', () => {
  const unclassified = {
    empty: '',
    missing: 'Target: docs/a.md\n\nbody',
    misplaced: 'Target: docs/a.md\n\nHold: no',
    bulleted: '- Hold: no\n\nbody',
    duplicated: 'Hold: no\nHold: no\n\nbody',
    conflicting: 'Hold: no\nHold: yes\n\nbody',
    'unknown value': 'Hold: maybe\n\nbody',
    'empty value': 'Hold:\n\nbody',
  };
  for (const [label, text] of Object.entries(unclassified)) {
    const item = resolveRef(text, refState());
    assert.strictEqual(item.section, 'Reference repairs', label);
    assert.strictEqual(item.resolution, 'pending', label);
    assert.strictEqual(item.reason, 'reference-repair-unclassified', label);
  }
});

test('AC1.1 (#4636): a missing or malformed JSON hold holds under a header that says no', () => {
  const finding = (extra) => ({ targetPath: 'docs/a.md', action: 'staged', stagePath: 'staged/wrap-up-reference-1.md', ...extra });
  const state = (findings) => ({ results: { references: { result: 'findings', findings } } });
  const cases = {
    'no engine-state.json': null,
    'no references row': { results: {} },
    'row not findings': { results: { references: { result: 'clean', findings: [finding({ hold: false })] } } },
    'findings not an array': { results: { references: { result: 'findings', findings: 'x' } } },
    'no finding names the file': state([finding({ stagePath: 'staged/wrap-up-reference-2.md', hold: false })]),
    'stagePath not a string': state([finding({ stagePath: 7, hold: false })]),
    'hold absent': state([finding({})]),
    'hold a string': state([finding({ hold: 'false' })]),
    'hold null': state([finding({ hold: null })]),
    'hold zero': state([finding({ hold: 0 })]),
    'action applied': state([finding({ action: 'applied', hold: false })]),
    'two findings name the file': state([finding({ hold: false }), finding({ hold: false })]),
  };
  for (const [label, engineState] of Object.entries(cases)) {
    const item = resolveRef('Hold: no\n\nbody', engineState);
    assert.strictEqual(item.resolution, 'pending', label);
    assert.strictEqual(item.reason, 'reference-repair-unclassified', label);
  }
});

test('#4636: a JSON hold of true holds beside a second finding on the same file', () => {
  const finding = (hold) => ({ targetPath: 'docs/a.md', action: 'staged', stagePath: 'staged/wrap-up-reference-1.md', hold });
  const item = resolveRef('Hold: no\n\nbody', { results: { references: { result: 'findings', findings: [finding(false), finding(true)] } } });
  assert.strictEqual(item.resolution, 'pending');
});

test('#4636: a staged references finding with no staged file holds, whatever its JSON hold', () => {
  for (const hold of [false, true, undefined]) {
    const engineState = { results: { references: { result: 'findings', findings: [{ targetPath: 'docs/a.md', action: 'staged', hold }] } } };
    const r = resolveAll({ runDir: fixture({ engineState, headers: [7] }), policy: 'console-auto', deps: deps() });
    const item = r.items.find((i) => i.id === 'references:docs/a.md');
    assert.strictEqual(item.resolution, 'pending', String(hold));
    assert.strictEqual(item.reason, 'reference-repair-unclassified', String(hold));
  }
});

test('AC1.1 (#4636): the hold survives the real engine writer, matched by an absolute stagePath', () => {
  const { initState, recordResult } = require('../../../plugin/bin/lib/wrap-up/engine-record');
  const run = (hold) => {
    const runDir = fixture({ staged: { 'wrap-up-reference-1.md': 'Hold: no\n\nbody' }, headers: [7] });
    const worklist = [{ id: 'references', target: 'Broken references', gate: 'open', gateReason: 'renamed', disposition: 'apply' }];
    initState({ runDir, worklist, now: new Date('2026-11-02T00:00:00Z') });
    recordResult({ runDir, now: new Date('2026-11-02T00:00:00Z'), payload: {
      rowId: 'references', result: 'findings', gapDetection: 'run',
      findings: [{ kind: 'pointer-repair', summary: 'a to b', targetPath: 'docs/a.md', action: 'staged', stagePath: path.join(runDir, 'staged', 'wrap-up-reference-1.md'), hold }],
    } });
    return resolveAll({ runDir, policy: 'console-auto', deps: deps() }).items.find((i) => i.id === 'wrap-up-reference-1.md');
  };
  assert.strictEqual(run(false).resolution, 'approve');
  assert.strictEqual(run(true).resolution, 'pending');
});
```

Leave the existing `Held:` test (line ~360) and the unreadable test (line ~375) unchanged. They must keep passing as written, with no JSON `hold`, which pins the back-compat half of the expand-contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL — `AC1.1 (#4636): a staged header the resolver cannot classify holds rather than approves` fails with `'approve' !== 'pending'` (label `empty`).

- [ ] **Step 3: Rewrite `referenceRepairHoldReason` in `plugin/bin/lib/console/resolve.js`**

`referenceRepairHoldReason(item, findings)`, in this order:

1. `item.readError || item.text === null` → `UNREADABLE` (unchanged).
2. Header = the lines of `String(item.text).split(/\r?\n/)`, each `trimEnd()`ed, up to but excluding the first empty line.
3. Any header line matching `/^held:/i` → `HELD`.
4. Any of `findings` with `hold === true` → `HELD`.
5. `holds` = the header lines matching `/^hold:(.*)$/i`, each mapped to its captured value, trimmed and lowercased. `holds.length !== 1` → `UNCLASSIFIED`. `'yes'` → `HELD`. Anything other than `'no'` → `UNCLASSIFIED`.
6. The header says no. `findings.length === 1 && findings[0].action === 'staged' && findings[0].hold === false` → `null`, else `UNCLASSIFIED`.

Add `referenceFindingsByFile(snapshot) -> Map<basename, finding[]>`: read `snapshot.engineState.results.references`; return an empty map unless `result === 'findings'` and `findings` is an array; skip an entry that is not an object or whose `stagePath` is not a string; key by `path.basename(stagePath)`. `stagedItems` calls it once and passes `map.get(s.name) || []`.

In `engineItems`, a `references` finding with `action === 'staged'` that is not already an item via `staged/` pushes `resolution: 'pending', reason: REFERENCE_REPAIR_REASONS.UNCLASSIFIED`, since it has no header to agree. Every other row keeps its stance.

Rewrite the comment above the function: the floor's verdict is `permittedInitiative`'s `hold`, which the sweep writes into the finding's JSON (`engine-state.json`) and the staged header; a repair approves only when both say no, and any disagreement, absence or malformed value holds, matching `sddRulingDeferralReason` (#4636); a `Held: {reason}` line still holds, since files staged before #4636 carry it. Keep the `Prose twin: wrap-up/reference-sweep.md Step 4.` line. Export `REFERENCE_REPAIR_REASONS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/resolve.js tests/bin-lib/console/resolve.test.js
git commit -m "Fail the reference-repair hold closed on the JSON verdict and header — refs #4636"
```

---

### Task 3: The sweep writes the verdict, and the prose states the new rule

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/reference-sweep.md` (Step 4)
- Modify: `plugin/skills/wrap-up/curation-engine.md` (the `findings[]` field table)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md:50-52`
- Modify: `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md:53-54`
- Modify: `docs/journeys/review-what-an-unattended-console-left-open-3370.md` (lines 33 and 67)
- Test: `tests/bin-lib/console/resolve.test.js`

Scope-keyword hits outside this list, each read: `plugin/skills/wrap-up/console-template.md:136` describes the `Why` column's reason string, which is unchanged, so no edit. `docs/superpowers/plans/2026-10-30-reference-repair-staged-prefix-4585.md` is #4585's finished plan, a record of what was true then, so no edit.

**Interfaces:**
- Consumes: Task 1's `hold`; Task 2's `REFERENCE_REPAIR_REASONS`.

- [ ] **Step 1: Write the failing test** (append to `tests/bin-lib/console/resolve.test.js`, reusing its `APPENDIX` text and importing `REFERENCE_REPAIR_REASONS`)

```js
test('#4636: review-console-appendix.md names every reference-repair pending reason', () => {
  const reasons = Object.values(REFERENCE_REPAIR_REASONS);
  assert.ok(reasons.length >= 3);
  const text = APPENDIX.replace(/\s+/g, ' ');
  for (const reason of reasons) assert.ok(text.includes(`pending — ${reason}`), reason);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL — `#4636: review-console-appendix.md names every reference-repair pending reason` fails naming `reference-repair-unclassified`.

- [ ] **Step 3: Update the prose**

- `plugin/skills/wrap-up/reference-sweep.md` Step 4. Under **`supervised`**, each candidate still goes through `permittedInitiative`, which denies it on the ceiling; nothing is applied and its `hold` is still recorded. Replace the paragraph's Held rules (from "When its target is ambiguous" through "carries no `Held:` line.") with: every staged candidate records `permittedInitiative`'s `hold` twice, copied verbatim and never judged: as the finding's boolean `hold` field in the row's payload, and as exactly one `Hold: yes` or `Hold: no` line in the staged file's header (the lines before the first blank line). A target Step 3 found ambiguous takes `hold: true`/`Hold: yes` whatever the floor said. On `Hold: yes`, also add a `Held: {reason}` line naming why. Over-budget, over-cap and ceiling denials of an otherwise clean fix come back `hold: false`. `console-resolve.js --policy console-auto` approves only when the finding's `hold` is `false` and the header says `Hold: no`; a true value on either side or a `Held:` line resolves `pending — reference-repair-held`, and a missing, duplicated, misplaced or malformed value on either side resolves `pending — reference-repair-unclassified`. Under `--dry-run` the same two records are written, since everything stages there.
- `plugin/skills/wrap-up/curation-engine.md`: add a row after `findings[].stagePath`: `findings[].hold` | `references` staged findings | Boolean: `permittedInitiative`'s verdict, copied verbatim (`reference-sweep.md` Step 4). Not validated at record time and stored as given; the console resolver reads it and holds the repair on anything but `false`.
- `plugin/skills/wrap-up/review-console-appendix.md` lines 50-52: the `wrap-up-reference-*` clause becomes "a `wrap-up-reference-*` item the initiative floor held (a `references` finding with `hold: true`, or a header carrying `Hold: yes` or a `Held:` line — `reference-sweep.md` Step 4) lands as `pending — reference-repair-held`; one whose finding or header is missing, duplicated or malformed, so the two cannot agree on `Hold: no`, lands as `pending — reference-repair-unclassified`; one whose file cannot be read lands as `pending — reference-repair-unreadable`; none is auto-approved".
- `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md`: in the line 53 sentence starting "A reference repair the Broken references row stages", it resolves `approve` under Reference repairs only when its `engine-state.json` finding carries `hold: false` and its staged header agrees with `Hold: no`; otherwise it resolves `pending` (`reference-repair-held` / `reference-repair-unclassified` / `reference-repair-unreadable`), never auto-approved. In the line 54 red flags, change "a `wrap-up-reference-` repair with a `Held:` header line reported `approve`" to "a `wrap-up-reference-` repair reported `approve` without both a finding `hold: false` and a header `Hold: no`, or with a `Held:` header line".
- `docs/journeys/review-what-an-unattended-console-left-open-3370.md` line 33: the `wrap-up-reference-*` parenthetical becomes "a `wrap-up-reference-*` repair the floor held, whose finding and header do not both say no, or whose file cannot be read — `reference-repair-held` / `reference-repair-unclassified` / `reference-repair-unreadable`, #4585, #4636". Line 67: append "Updated by #4636: an unclassifiable `wrap-up-reference-*` repair is a `pending` class too."

- [ ] **Step 4: Run the suites that read these files**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/curation-judge-stagepath.test.js tests/review-console-unattended-no-ask-conformance.test.js tests/bin-lib/wrap-up/engine-plan.test.js tests/bin-lib/wrap-up/engine-record.test.js`
Expected: PASS

- [ ] **Step 5: Confirm the sibling sweep**

Run: `git grep -n -E 'reference-repair-(held|unreadable)' -- plugin docs/journeys`
Expected: every hit's sentence also names `reference-repair-unclassified` or sits in `resolve.js`'s frozen reasons.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/wrap-up/reference-sweep.md plugin/skills/wrap-up/curation-engine.md plugin/skills/wrap-up/review-console-appendix.md docs/journeys/resolve-the-unattended-console-in-one-process-1932.md docs/journeys/review-what-an-unattended-console-left-open-3370.md tests/bin-lib/console/resolve.test.js
git commit -m "Have the reference sweep write the hold verdict twice and state the rule — refs #4636"
```
