# Reference-Repair Hold Fails Closed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A floor denial computed by `permittedInitiative` reaches the Review Console resolver through a structured field, and a `staged/wrap-up-reference-*.md` file the resolver cannot classify resolves `pending` instead of `approve`.

**Architecture:** `permittedInitiative` (`plugin/bin/lib/issues/initiative-budget.js`) gains a boolean `hold` field on every result. The broken-reference sweep copies it verbatim into a required `Hold: yes|no` header line of each staged reference repair. `referenceRepairHoldReason` (`plugin/bin/lib/console/resolve.js`) stops failing open: like `sddRulingDeferralReason` (`plugin/bin/lib/console/sdd-ruling.js`), it approves only an explicit, well-formed `Hold: no` header and holds everything else.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T122100-record-4636/work/4636-spec.md`

Scope keywords: referenceRepairHoldReason, reference-repair-held, permittedInitiative

## Global Constraints

- Acceptance criterion (verbatim): "A floor denial computed by permittedInitiative reaches the resolver through a structured field, and a file the resolver cannot classify holds rather than approves, matching sddRulingDeferralReason."
- Deliverable: "Fix the defect at `plugin/bin/lib/console/resolve.js:646`, with a regression test." (The function is now at line 663, `referenceRepairHoldReason`.)
- Header = the lines before the first blank line (a line that is empty after stripping trailing whitespace), split on `/\r?\n/` — the same header rule `sddRulingDeferralReason` uses.
- Existing reason strings stay byte-identical: `reference-repair-held`, `reference-repair-unreadable`. One new reason string: `reference-repair-unclassified`.
- Expand-contract: a `Held: {reason}` header line still holds (files staged by v6.157.x in in-flight runs keep holding). A legacy file with neither `Held:` nor `Hold:` now resolves `pending — reference-repair-unclassified`. That is the intended fail-closed change: it costs one click, never an unattended apply.

## Review Focus

1. **A legacy staged file from an in-flight v6.157.x run with no `Hold:` line.** It must resolve `pending`, never `approve`. Pinned by Task 2's unclassified test (the "missing" case).
2. **CRLF line endings.** `Hold: no\r\n\r\nbody` must approve exactly as the LF form does. Pinned in Task 2.
3. **A `Hold:` line in the body (past the first blank line).** It is not a classification. With no header `Hold:` line the file is unclassified (pending), and a body `Hold: no` never approves. Pinned in Task 2 (the "misplaced" case).
4. **Case and trailing whitespace.** `hold: NO   ` in the header approves. Key and value are case-insensitive and trailing whitespace is ignored, as in `sddRulingDeferralReason`'s `Defers:` handling. Pinned in Task 2.
5. **`Held:` together with `Hold: no`.** An explicit hold reason wins and the file holds. Pinned in Task 2.

---

### Task 1: `permittedInitiative` returns a structured `hold` field

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/initiative-budget.js`
- Modify: `plugin/skills/_shared/initiative-budget.md` (Floor rule section, after the table)
- Test: `tests/bin-lib/issues/initiative-budget.test.js`

**Interfaces:**
- Produces: `permittedInitiative(input) -> { allowed: boolean, reason: string, hold: boolean }`. `hold` is always a boolean, on every return path.
  - `allowed: true` → `hold: false`.
  - Denials that may be approved at the console → `hold: false`. This is an allowlist: (a) the ceiling check (below `trusted`, so no `consoleAutoResolve` runs and a human resolves the console), (b) budget exhausted, (c) over the files-per-fix cap, (d) over the lines-per-fix cap.
  - Every other denial → `hold: true`. That covers no fix, an untaught kind, no files, a malformed file path, a missing or malformed changed-line count, a test file, a missing `brokenBy`, `brokenBy` not among this run's changed files, and a merge-sensitive path. It fails closed the same way `REPAIRABLE_KINDS` does: a denial this module was not taught to call approvable holds.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/issues/initiative-budget.test.js`, reusing its `base()` fixture and `DEFAULT_BUDGET`)

```js
test('#4636: every result carries a boolean hold — allowed results never hold', () => {
  const r = permittedInitiative(base());
  assert.strictEqual(r.allowed, true, r.reason);
  assert.strictEqual(r.hold, false);
});

test('#4636: budget, cap, and ceiling denials are approvable (hold false)', () => {
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

test('AC1.1 (#4636): floor denials hold — test file, merge-sensitive path, causal gate, malformed input', () => {
  const cases = [
    { ...base(), fix: { ...base().fix, files: ['tests/a.test.js'] } },
    { ...base(), sensitivePaths: ['docs/**'] },
    { ...base(), fix: { ...base().fix, brokenBy: 'not/changed.md' } },
    { ...base(), fix: { ...base().fix, brokenBy: '' } },
    { ...base(), fix: { ...base().fix, kind: 'typo' } },
    { ...base(), fix: { ...base().fix, files: [] } },
    { ...base(), fix: { ...base().fix, changedLines: undefined } },
    { ...base(), fix: null },
  ];
  for (const input of cases) {
    const r = permittedInitiative(input);
    assert.strictEqual(r.allowed, false, JSON.stringify(input));
    assert.strictEqual(r.hold, true, r.reason);
  }
  const none = permittedInitiative(undefined);
  assert.strictEqual(none.allowed, false);
  assert.strictEqual(none.hold, false, 'no input fails the ceiling check first — approvable, a human resolves');
});
```

Note: `permittedInitiative(undefined)` and `permittedInitiative({})` reach the ceiling check first (ceiling `undefined`), so they return `hold: false`. That is the ceiling row of the allowlist, and the last assertion pins it.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/initiative-budget.test.js`
Expected: FAIL — `#4636: every result carries a boolean hold` fails with `undefined !== false`.

- [ ] **Step 3: Implement the `hold` field in `plugin/bin/lib/issues/initiative-budget.js`**

Change `deny(reason)` to `deny(reason, { hold = true } = {})`, returning `{ allowed: false, reason, hold }`. Pass `{ hold: false }` at exactly the four approvable sites: ceiling, budget exhausted, files cap, lines cap. The `allowed: true` return gains `hold: false`. Update the JSDoc `@returns` to `{{allowed: boolean, reason: string, hold: boolean}}`, and add a comment above `deny` explaining that `hold` is what `wrap-up/reference-sweep.md` Step 4 copies into a staged repair's `Hold:` header line, defaulting to `true` (fail closed, the same inversion as `REPAIRABLE_KINDS`).

- [ ] **Step 4: Document the field in `plugin/skills/_shared/initiative-budget.md`**

After the Floor rule table's closing paragraph ("The budget is per run…"), add one paragraph. It says that every result also carries a boolean `hold`, which is `false` for an allowed fix and for the approvable denials (ceiling, budget, files cap, lines cap) and `true` for every other denial. It says that `wrap-up/reference-sweep.md` Step 4 copies `hold` into the staged repair's `Hold:` header, so the Review Console resolver reads the floor's own verdict and never the agent's.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/initiative-budget.test.js`
Expected: PASS (all tests, the existing ones included)

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/initiative-budget.js plugin/skills/_shared/initiative-budget.md tests/bin-lib/issues/initiative-budget.test.js
git commit -m "Add a structured hold field to permittedInitiative — refs #4636"
```

---

### Task 2: `referenceRepairHoldReason` fails closed on an unclassifiable header

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js:657-670` (`referenceRepairHoldReason` and its comment)
- Modify: `plugin/skills/wrap-up/reference-sweep.md` (Step 4, the "When staging a candidate…" paragraph)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md:50-52` (the `wrap-up-reference-*` clause)
- Modify: `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md:52-53` (the Reference repairs sentence and the red-flag clause)
- Modify: `docs/journeys/review-what-an-unattended-console-left-open-3370.md:33` (the `wrap-up-reference-*` parenthetical)
- Test: `tests/bin-lib/console/resolve.test.js:349-384`

**Interfaces:**
- Consumes: Task 1's `permittedInitiative(...).hold: boolean`. It is consumed only through the staged file's `Hold:` header line, never through a `require`.
- Produces: `referenceRepairHoldReason(item: { text: string|null, readError?: any }) -> null | 'reference-repair-held' | 'reference-repair-unreadable' | 'reference-repair-unclassified'`. The function stays module-private, and its signature is unchanged.

- [ ] **Step 1: Update the two existing approve-path fixtures and write the failing tests** in `tests/bin-lib/console/resolve.test.js`

Existing test `AC1.1: a staged wrap-up-reference- repair…` (line ~351): change the staged text `'repair'` to `'Hold: no\n\nrepair'`. Existing test `a Held: line past the staged reference repair header does not hold it` (line ~369): change the text to `'Hold: no\nTarget: docs/a.md\n\nHeld: quoted from the repaired file'`. Both still assert `approve`.

Append, using the file's existing `fixture`/`deps`/`resolveAll` helpers:

```js
test('#4636: a staged reference repair approves only on a well-formed header Hold: no', () => {
  for (const text of ['Hold: no\n\nbody', 'hold: NO   \nTarget: docs/a.md\n\nbody', 'Hold: no\r\n\r\nbody']) {
    const r = resolveAll({ runDir: fixture({ staged: { 'wrap-up-reference-1.md': text }, headers: [7] }), policy: 'console-auto', deps: deps() });
    assert.strictEqual(r.items[0].resolution, 'approve', JSON.stringify(text));
  }
});

test('#4636: Hold: yes, or Held: alongside Hold: no, holds', () => {
  for (const text of ['Hold: yes\n\nbody', 'Hold: no\nHeld: test file\n\nbody']) {
    const r = resolveAll({ runDir: fixture({ staged: { 'wrap-up-reference-1.md': text }, headers: [7] }), policy: 'console-auto', deps: deps() });
    assert.strictEqual(r.items[0].resolution, 'pending', JSON.stringify(text));
    assert.strictEqual(r.items[0].reason, 'reference-repair-held', JSON.stringify(text));
  }
});

test('AC1.1 (#4636): a staged reference repair the resolver cannot classify holds rather than approves', () => {
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
    const r = resolveAll({ runDir: fixture({ staged: { 'wrap-up-reference-1.md': text }, headers: [7] }), policy: 'console-auto', deps: deps() });
    assert.strictEqual(r.items[0].section, 'Reference repairs', label);
    assert.strictEqual(r.items[0].resolution, 'pending', label);
    assert.strictEqual(r.items[0].reason, 'reference-repair-unclassified', label);
  }
});
```

Leave the existing `Held:` test (line ~358) and the unreadable test (line ~373) unchanged. They must keep passing as written, which pins the back-compat half of the expand-contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL — `AC1.1 (#4636): a staged reference repair the resolver cannot classify holds rather than approves` fails with `'approve' !== 'pending'` (label `empty`).

- [ ] **Step 3: Rewrite `referenceRepairHoldReason` in `plugin/bin/lib/console/resolve.js`**

The algorithm is pinned to `sddRulingDeferralReason`'s header handling:
1. `item.readError || item.text === null` → `'reference-repair-unreadable'` (unchanged).
2. Header = the lines of `String(item.text).split(/\r?\n/)`, each with trailing whitespace stripped (`replace(/\s+$/, '')`), up to but excluding the first empty line.
3. Any header line matching `/^held:/i` → `'reference-repair-held'`.
4. `holds` = the header lines matching `/^hold:(.*)$/i`, each mapped to its captured value, trimmed and lowercased.
5. `holds.length !== 1` → `'reference-repair-unclassified'`. Otherwise `'no'` → `null`, `'yes'` → `'reference-repair-held'`, and anything else → `'reference-repair-unclassified'`.

Rewrite the comment above the function. It should say that the sweep writes a required `Hold: yes|no` header line copied from `permittedInitiative`'s structured `hold` field (`yes` for an ambiguous target), that a `Held: {reason}` line still holds (it is the reason, and files staged before #4636 still carry it), and that a header the resolver cannot classify holds rather than approves, matching `sddRulingDeferralReason` (#4636). Keep the `Prose twin: wrap-up/reference-sweep.md Step 4.` line.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Update the prose twins**

- `plugin/skills/wrap-up/reference-sweep.md` Step 4, the paragraph starting "When staging a candidate": every staged `staged/wrap-up-reference-{n}.md` header (the lines before the first blank line) carries exactly one `Hold: yes` or `Hold: no` line. Its value is `permittedInitiative`'s `hold` field, copied verbatim and never judged. The two exceptions are `Hold: yes` when Step 3 found the target ambiguous, and `Hold: no` at `supervised`, where no floor check runs and no unattended console resolves. On `Hold: yes`, also add a `Held: {reason}` line naming why (ambiguous target, or `permittedInitiative`'s reason string). `console-resolve.js --policy console-auto` approves only a header `Hold: no`. `Hold: yes` or a `Held:` line resolves `pending — reference-repair-held`, and a missing, duplicated, misplaced or malformed `Hold:` line resolves `pending — reference-repair-unclassified`. Replace the sentence "An over-budget or over-cap denial carries no `Held:` line." with the fact that over-budget, over-cap and ceiling denials come back `hold: false`.
- `plugin/skills/wrap-up/review-console-appendix.md` lines 50-52: the `wrap-up-reference-*` clause becomes "a `wrap-up-reference-*` item whose header carries `Hold: yes` or a `Held:` line (`reference-sweep.md` Step 4), whose header carries no single well-formed `Hold: no`/`Hold: yes` line, or whose file cannot be read, lands as `pending — reference-repair-held`, `pending — reference-repair-unclassified` or `pending — reference-repair-unreadable`, never auto-approved".
- `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md` line 52: Reference repairs resolve `approve` only when the header carries `Hold: no`. Otherwise they resolve `pending` (`reference-repair-held` / `reference-repair-unclassified` / `reference-repair-unreadable`). In the line 53 red flags, change "a `wrap-up-reference-` repair with a `Held:` header line reported `approve`" to "a `wrap-up-reference-` repair reported `approve` without a header `Hold: no` line, or with a `Held:` header line".
- `docs/journeys/review-what-an-unattended-console-left-open-3370.md` line 33: add `reference-repair-unclassified` to the `wrap-up-reference-*` parenthetical ("whose header carries `Hold: yes` or a `Held:` line, carries no single well-formed `Hold:` line, or whose file cannot be read — `reference-repair-held` / `reference-repair-unclassified` / `reference-repair-unreadable`, #4585, #4636").

- [ ] **Step 6: Run the prose-pinning suites that read these files**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/curation-judge-stagepath.test.js tests/review-console-unattended-no-ask-conformance.test.js tests/bin-lib/wrap-up/engine-plan.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/console/resolve.js plugin/skills/wrap-up/reference-sweep.md plugin/skills/wrap-up/review-console-appendix.md docs/journeys/resolve-the-unattended-console-in-one-process-1932.md docs/journeys/review-what-an-unattended-console-left-open-3370.md tests/bin-lib/console/resolve.test.js
git commit -m "Fail the reference-repair hold closed on an unclassifiable header — refs #4636"
```
