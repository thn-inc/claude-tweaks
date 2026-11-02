# Reference-Repair Hold Fails Closed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A floor denial computed by `permittedInitiative` reaches the Review Console resolver through a structured JSON field in `engine-state.json`, the resolver re-checks the test-path and merge-sensitive floors itself from the staged file's own diff, a `staged/wrap-up-reference-*.md` repair the resolver cannot classify resolves `pending` instead of `approve`, and an approved repair is applied from that same staged diff, so what the resolver checked is what lands.

**Architecture:** `permittedInitiative` (`plugin/bin/lib/issues/initiative-budget.js`) gains a boolean `hold` on every result, derived from the floor conditions whichever check fails first. The broken-reference sweep writes it as `findings[].hold` in its `references` payload (which `engine-record.js` already stores verbatim into `engine-state.json`), copies it into a required `Hold: yes|no` header of the staged file, and must write the repair's real diff into that file, composed on a temp copy. A new leaf module, `plugin/bin/lib/console/reference-repair.js`, holds the decision: it approves a repair only when the JSON field reads `hold: false`, the header agrees, the staged diff's `diff --git` paths parse and none is a test path or a merge-sensitive match. `console-resolve.js`'s `readPolicy` resolves `merge-sensitive-paths` and passes it through `deps.sensitivePaths`; an unreadable value holds. The causal check stays on the agent-written `hold`, because its `brokenBy` input comes from the agent anyway. Phase 4 applies an approved repair with `git apply` from the staged file; one that no longer applies is rewritten `approve` → `pending` through `console-resolve.js --set-item`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T203149-record-4636/work/4636-spec.md`

Scope keywords: referenceRepairHoldReason, reference-repair-held, permittedInitiative

## Global Constraints

- Acceptance criterion (verbatim): "A floor denial computed by permittedInitiative reaches the resolver through a structured field, and a file the resolver cannot classify holds rather than approves, matching sddRulingDeferralReason."
- Plan Review Decision (verbatim): "`permittedInitiative`'s `hold` travels as a JSON field the reference sweep writes into `engine-state.json`'s `references` findings, which `plugin/bin/lib/console/resolve.js` already reads; the resolver holds the repair unless that JSON field reads `hold: false` and the staged file's `Hold:` header agrees. Any disagreement, absence or malformed value holds (fails closed)."
- Plan Review Decision (verbatim): "`hold` is computed from the floor conditions regardless of which check fails first: a test-file, causal-set or merge-sensitive repair that is also over budget or over a size cap still gets `hold: true`."
- Plan Review Decision (verbatim): "Task 1 (the per-denial-path decision logic) carries `Review risk: high`."
- Plan Review Decision (verbatim): "At `unattended`, the resolver runs the test-path and merge-sensitive checks itself and holds on a hit. It reads the paths from the `diff --git` lines of the staged `wrap-up-reference-*` file, never from the agent-written `target`, `files` or `summary`, and holds when that file has no parseable diff. The reference sweep must write the diff into every staged repair. The causal check stays on the agent-written `hold`, because its `brokenBy` input comes from the agent anyway."
- Plan Review Decision (verbatim): "a non-string `stagePath` counts as no staged file; the "whichever check fails first" test skips the `no files` + `files cap` pair; Task 3 carries `Review risk: high`; `supervised` stays approvable and an unknown or non-string ceiling holds."
- Plan Review Decision (verbatim): "An approved reference repair is applied from the staged diff with `git apply`, so what the resolver checked is what lands; `plugin/skills/wrap-up/execution-and-verification.md` changes accordingly, with a test for this direction. A diff that no longer applies leaves the row pending for a human."
- Plan Review Decision (verbatim): "They carry `Hold: yes` plus a `Held:` line and no diff, and the resolver holds them before it reads any diff. Every other staged repair must carry a real diff."
- Plan Review Decision (verbatim): "the sweep composes each diff on a temp copy with `git diff --no-index`, leaving the shared worktree untouched, including under `--dry-run`; a `sensitivePaths` value that is not an array holds (`!Array.isArray`); the fan-out payload JSON template gains `hold`."
- Probed composition recipe: in a fresh temp directory outside the repo, copy the file to `a/{path}`, write the repaired text to `b/{path}`, and run `git diff --no-index --no-prefix -- a/{path} b/{path}` from that directory. It prints `diff --git a/{path} b/{path}` with the real repo path, spaces included, and `git apply --check` accepts it under a `Hold:` preamble. `git diff --no-index` exits 1 when the files differ, which is success here. Comparing the repo file against a temp copy directly would print a rename header naming the temp path, so that shape is never used.
- Probed: `git apply --check` run from a subdirectory of the repo exits 0 without checking a path outside that subdirectory, so every apply and check runs as `git -C "{worktree root}" apply`, the form `_shared/staged-patch.md`'s Staging-time gate already requires.
- `merge-sensitive-paths` is a comma-separated string when configured and `[]` when unset (`plugin/skills/_shared/policy-schema.md`, probed through `resolvePolicyConfig`), so it goes through `plugin/bin/lib/express/policy.js`'s `sensitivePathsOf`, the parse the express lane already shares. A `resolvePolicyConfig` entry carrying `error`, or a missing entry, is unreadable: `sensitivePaths: null`, never `[]`.
- Deliverable (verbatim): "Fix the defect at `plugin/bin/lib/console/resolve.js:646`, with a regression test." The function is now `referenceRepairHoldReason`, at line 722.
- Header = the lines before the first empty line, split on `/\r?\n/`, each with trailing whitespace stripped by `trimEnd()` (the header rule `sddRulingDeferralReason` uses, without its `/\s+$/` regex).
- Existing reason strings stay byte-identical: `reference-repair-held`, `reference-repair-unreadable`. Two new reason strings: `reference-repair-unclassified` (the resolver's) and `reference-repair-stale` (Task 4's post-execution rewrite; the resolver never returns it).
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
6. **A diff that says one thing while the agent's fields say another.** `Hold: no`, `hold: false` and a `diff --git` line naming a test or merge-sensitive path holds. Pinned in Task 2.
7. **A `diff --git` line the parser cannot read** (quoted, no `a/`/`b/` prefix, `..`, an ambiguous rename) beside a readable one. One unreadable line makes the whole file unclassified. Pinned in Task 2.
8. **An unreadable `merge-sensitive-paths`.** It holds, never reads as an empty list. Pinned in Task 2.
9. **An ambiguous candidate with no diff.** `Hold: yes` plus `Held:` and no diff resolves `reference-repair-held`, not `reference-repair-unclassified`. Pinned in Task 2.
10. **What lands is what was checked.** A repair approved at the console is applied from the staged diff, a stale diff never lands, and an edit outside that diff is impossible. Pinned in Task 4's real-git test.
11. **A repair whose diff stopped applying.** Its stored `approve` is rewritten `pending`, so it surfaces as residue rather than reading as done. Pinned in Task 4.

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
  - `hold: true` when any floor condition fails, whichever check fails first: an unknown or non-string ceiling (not a member of `autonomy.js`'s `CEILINGS`, matched exactly), no fix, an untaught kind, no files, a malformed file path, a missing or malformed changed-line count, a test file, a missing `brokenBy`, `brokenBy` not among this run's changed files, a merge-sensitive path.
  - `hold: false` otherwise. That covers `allowed: true` and a clean fix denied only by a `supervised` ceiling, the budget, the files cap or the lines cap.
  - `reason` is the first failing check in today's order, unchanged.
- Produces: `matchesPath(filePath, pattern)` added to `initiative-budget.js`'s exports, for Task 2's resolver floor. `isTestPath` is already exported.

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
      if (floor === 'no files' && check === 'files cap') continue; // files cap replaces the empty list
      const r = permittedInitiative(worsen(make(base())));
      assert.strictEqual(r.allowed, false, `${floor} + ${check}`);
      assert.strictEqual(r.hold, true, `${floor} + ${check}: ${r.reason}`);
    }
  }
});

test('#4636: an unknown or non-string ceiling holds; supervised does not', () => {
  for (const ceiling of ['bogus', 'Trusted', 'TRUSTED', 7, null, undefined, {}]) {
    const r = permittedInitiative({ ...base(), ceiling });
    assert.strictEqual(r.allowed, false, String(ceiling));
    assert.strictEqual(r.hold, true, String(ceiling));
  }
  assert.strictEqual(permittedInitiative({ ...base(), ceiling: 'supervised' }).hold, false);
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
  // The one check whose floor flag depends on the value: `supervised` is a clean denial, an unknown ceiling is not.
  { floor: !CEILINGS.includes(ceiling), fails: /* ceiling not allowed */, reason: /* today's text */ },
  { floor: true,  fails: /* no fix */,              reason: 'no fix supplied' },
  // ... kind (floor), budget (not), no files (floor), malformed path (floor), files cap (not),
  // no line count (floor), lines cap (not), test file (floor), no brokenBy (floor),
  // brokenBy not changed (floor), merge-sensitive (floor) — today's order, today's reason text.
];
const failed = checks.filter((c) => c.fails);
if (failed.length === 0) return { allowed: true, reason: /* today's text */, hold: false };
return { allowed: false, reason: failed[0].reason, hold: failed.some((c) => c.floor) };
```

Every `fails` is evaluated for every input, so normalize first: `fix` to an object or `null`, `files` to an array (an absent `files` is the no-files failure), and pick string entries before the test-path and sensitive-path matches. Remove `deny`. Require `CEILINGS` from `./autonomy` (`autonomy.js` requires only `./record`, so no cycle). Export `matchesPath`. Update the JSDoc `@returns` to `{{allowed: boolean, reason: string, hold: boolean}}`, and add a comment above `checks` saying `hold` is what `wrap-up/reference-sweep.md` Step 4 writes into the finding's `hold` field and the staged file's `Hold:` header, and that `floor: true` marks a condition no human click at an unattended console may skip.

- [ ] **Step 4: Document the field in `plugin/skills/_shared/initiative-budget.md`**

After the paragraph starting "The budget is per run", add one paragraph. It says that every result also carries a boolean `hold`, computed from the floor conditions whichever check fails first: `true` when kind, causal link, tests or merge-sensitive fails, when the ceiling is unknown, or when the fix itself is missing or malformed; `false` for an allowed fix and for a fix denied only by a `supervised` ceiling, the budget or a size cap. It says `wrap-up/reference-sweep.md` Step 4 writes `hold` into the finding's JSON and the staged file's `Hold:` header, and that the Review Console resolver approves only when both say no and its own test-path and merge-sensitive check over the staged diff finds no hit.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/initiative-budget.test.js`
Expected: PASS (all tests, the existing ones included)

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/initiative-budget.js plugin/skills/_shared/initiative-budget.md tests/bin-lib/issues/initiative-budget.test.js
git commit -m "Add a structured hold field to permittedInitiative — refs #4636"
```

---

### Task 2: The resolver holds unless the JSON `hold`, the staged header and its own floor check all clear the repair

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/console/reference-repair.js`
- Modify: `plugin/bin/lib/console/resolve.js` (`referenceRepairHoldReason` removed, `stagedItems`, `engineItems`, `readSnapshot`, `module.exports`)
- Modify: `plugin/bin/console-resolve.js` (`readPolicy`, `resolverDeps`)
- Test: `tests/bin-lib/console/resolve.test.js` (lines 337-349, 351-358, 370-373, plus appended tests)
- Test: `tests/bin-lib/console/cli.test.js`

**Interfaces:**
- Consumes: Task 1's `hold` only as data: `engineState.results.references.findings[].hold`, never through a `require`. Task 1's `isTestPath` and `matchesPath` through a `require` of `../issues/initiative-budget`.
- Produces, from `reference-repair.js`, a leaf module like `sdd-ruling.js` that never requires `resolve.js`:
  - frozen `REFERENCE_REPAIR_REASONS = { HELD: 'reference-repair-held', UNCLASSIFIED: 'reference-repair-unclassified', UNREADABLE: 'reference-repair-unreadable', STALE: 'reference-repair-stale' }`, re-exported by `resolve.js` for Task 3's prose test. `STALE` is written only by Task 4's `--set-item` call; a comment says so.
  - `referenceRepairHoldReason(item, findings, sensitivePaths) -> null | one of those`. `findings` is the array of `references` findings naming this file. `sensitivePaths` is `string[]`, or `null` when unreadable.
  - `referenceFindingsByFile(engineState) -> Map<basename, finding[]>`.
  - `stagedDiffPaths(text) -> string[] | null`.
- Produces: `resolveAll` reads `deps.sensitivePaths`. `readSnapshot` carries it as `snapshot.sensitivePaths`, normalized to `null` unless it is an array of strings, so a caller that omits it holds rather than approves.
- Produces: `readPolicy(...)` also returns `sensitivePaths`.

- [ ] **Step 1: Update the existing fixtures and write the failing tests** in `tests/bin-lib/console/resolve.test.js`

Add `sensitivePaths: []` to the file's `deps()` helper.

The M9 test (`every ENGINE_ROW_SECTIONS row classifies a staged finding…`, line ~337): a `references` staged finding with no staged file now resolves `pending` with reason `reference-repair-unclassified`. Assert that for `references`, and the section stance for the other rows.

`AC1.1: a staged wrap-up-reference- repair…` (line ~351): give the finding `hold: false` and change the staged text `'repair'` to `` `Hold: no\n\n${REF_DIFF}` ``. `a Held: line past the staged reference repair header does not hold it` (line ~370): change the text to `` `Hold: no\nTarget: docs/a.md\n\nHeld: quoted from the repaired file\n${REF_DIFF}` `` and pass `engineState: refState()` (below). Both still assert `approve`. Declare `REF_DIFF` and `refState` above the first of these tests.

Append, using the file's `fixture`/`deps`/`resolveAll` helpers:

```js
const REF_DIFF = 'diff --git a/docs/a.md b/docs/a.md\n--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1 +1 @@\n-old\n+new\n';
const refState = (hold = false, stagePath = 'staged/wrap-up-reference-1.md') => ({
  results: { references: { result: 'findings', findings: [{ targetPath: 'docs/a.md', action: 'staged', stagePath, hold }] } },
});
const resolveRef = (text, engineState, over = {}) => resolveAll({ runDir: fixture({ engineState, staged: { 'wrap-up-reference-1.md': text }, headers: [7] }), policy: 'console-auto', deps: deps(over) }).items[0];

test('AC1.1 (#4636): a repair approves only when the JSON hold is false, the header agrees and the diff is clean', () => {
  for (const text of [`Hold: no\n\n${REF_DIFF}`, `hold: NO   \nTarget: docs/a.md\n\n${REF_DIFF}`, `Hold: no\r\n\r\n${REF_DIFF.replace(/\n/g, '\r\n')}`]) {
    assert.strictEqual(resolveRef(text, refState()).resolution, 'approve', JSON.stringify(text));
  }
});

test('AC1.1 (#4636): a floor denial the JSON carries holds even under a header that says no', () => {
  const item = resolveRef(`Hold: no\n\n${REF_DIFF}`, refState(true));
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'reference-repair-held');
});

test('#4636: Hold: yes, or Held: beside Hold: no, holds under a JSON hold of false', () => {
  for (const text of [`Hold: yes\n\n${REF_DIFF}`, `Hold: no\nHeld: test file\n\n${REF_DIFF}`]) {
    const item = resolveRef(text, refState());
    assert.strictEqual(item.resolution, 'pending', JSON.stringify(text));
    assert.strictEqual(item.reason, 'reference-repair-held', JSON.stringify(text));
  }
});

test('AC1.1 (#4636): a staged header the resolver cannot classify holds rather than approves', () => {
  const unclassified = {
    empty: '',
    missing: `Target: docs/a.md\n\n${REF_DIFF}`,
    misplaced: `Target: docs/a.md\n\nHold: no\n${REF_DIFF}`,
    bulleted: `- Hold: no\n\n${REF_DIFF}`,
    duplicated: `Hold: no\nHold: no\n\n${REF_DIFF}`,
    conflicting: `Hold: no\nHold: yes\n\n${REF_DIFF}`,
    'unknown value': `Hold: maybe\n\n${REF_DIFF}`,
    'empty value': `Hold:\n\n${REF_DIFF}`,
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
    const item = resolveRef(`Hold: no\n\n${REF_DIFF}`, engineState);
    assert.strictEqual(item.id, 'wrap-up-reference-1.md', label);
    assert.strictEqual(item.resolution, 'pending', label);
    assert.strictEqual(item.reason, 'reference-repair-unclassified', label);
  }
});

test('#4636: a JSON hold of true holds beside a second finding on the same file', () => {
  const finding = (hold) => ({ targetPath: 'docs/a.md', action: 'staged', stagePath: 'staged/wrap-up-reference-1.md', hold });
  const item = resolveRef(`Hold: no\n\n${REF_DIFF}`, { results: { references: { result: 'findings', findings: [finding(false), finding(true)] } } });
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'reference-repair-held');
});

test('#4636: a staged references finding with no staged file holds, whatever its JSON hold', () => {
  for (const stagePath of [undefined, 7, null, {}]) {
    for (const hold of [false, true, undefined]) {
      const engineState = { results: { references: { result: 'findings', findings: [{ targetPath: 'docs/a.md', action: 'staged', stagePath, hold }] } } };
      const r = resolveAll({ runDir: fixture({ engineState, headers: [7] }), policy: 'console-auto', deps: deps() });
      const item = r.items.find((i) => i.id === 'references:docs/a.md');
      assert.ok(item, `${String(stagePath)}/${String(hold)}`);
      assert.strictEqual(item.resolution, 'pending', `${String(stagePath)}/${String(hold)}`);
      assert.strictEqual(item.reason, 'reference-repair-unclassified', `${String(stagePath)}/${String(hold)}`);
    }
  }
});

test('AC1.1 (#4636): the hold survives the real engine writer, matched by an absolute stagePath', () => {
  const { initState, recordResult } = require('../../../plugin/bin/lib/wrap-up/engine-record');
  const run = (hold) => {
    const runDir = fixture({ staged: { 'wrap-up-reference-1.md': `Hold: no\n\n${REF_DIFF}` }, headers: [7] });
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

test('#4636: the resolver holds a test or merge-sensitive path in the diff, whatever the agent wrote', () => {
  const diffOf = (p) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-old\n+new\n`;
  const testFile = resolveRef(`Hold: no\nTarget: docs/a.md\n\n${diffOf('tests/a.test.js')}`, refState());
  assert.strictEqual(testFile.resolution, 'pending');
  assert.strictEqual(testFile.reason, 'reference-repair-held');
  const second = resolveRef(`Hold: no\n\n${REF_DIFF}${diffOf('tests/b.test.js')}`, refState());
  assert.strictEqual(second.reason, 'reference-repair-held', 'any path in the file counts, not the first');
  const rename = resolveRef('Hold: no\n\ndiff --git a/docs/a.md b/tests/a.test.js\nrename from docs/a.md\nrename to tests/a.test.js\n', refState());
  assert.strictEqual(rename.reason, 'reference-repair-held', 'either side of a rename counts');
  const sensitive = resolveRef(`Hold: no\n\n${REF_DIFF}`, refState(), { sensitivePaths: ['docs/**'] });
  assert.strictEqual(sensitive.reason, 'reference-repair-held');
  const clean = resolveRef(`Hold: no\n\n${REF_DIFF}`, refState(), { sensitivePaths: ['plugin/**'] });
  assert.strictEqual(clean.resolution, 'approve');
});

test('#4636: a floor hit outranks an unclassifiable header', () => {
  const item = resolveRef('Target: docs/a.md\n\ndiff --git a/tests/a.test.js b/tests/a.test.js\n', refState());
  assert.strictEqual(item.reason, 'reference-repair-held');
});

test('#4636: a staged file with no parseable diff holds', () => {
  const cases = {
    'no diff': 'Hold: no\n\nbody',
    'hunks only': 'Hold: no\n\n--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1 +1 @@\n-old\n+new\n',
    'indented header': `Hold: no\n\n    ${REF_DIFF}`,
    'quoted path': 'Hold: no\n\ndiff --git "a/docs/caf\\303\\251.md" "b/docs/caf\\303\\251.md"\n',
    'no a/ b/ prefix': 'Hold: no\n\ndiff --git docs/a.md docs/a.md\n',
    'dot-dot segment': 'Hold: no\n\ndiff --git a/docs/../tests/a.test.js b/docs/../tests/a.test.js\n',
    'one readable, one not': `Hold: no\n\n${REF_DIFF}diff --git "a/x.md" "b/x.md"\n`,
    'ambiguous rename': 'Hold: no\n\ndiff --git a/one b/two b/three b/four\n',
  };
  for (const [label, text] of Object.entries(cases)) {
    const item = resolveRef(text, refState());
    assert.strictEqual(item.resolution, 'pending', label);
    assert.strictEqual(item.reason, 'reference-repair-unclassified', label);
  }
});

test('#4636: a path with spaces parses, so a clean one approves and a test one holds', () => {
  const spaced = (p) => `Hold: no\n\ndiff --git a/${p} b/${p}\n`;
  assert.strictEqual(resolveRef(spaced('docs/my guide.md'), refState()).resolution, 'approve');
  assert.strictEqual(resolveRef(spaced('tests/my a.test.js'), refState()).reason, 'reference-repair-held');
});

test('#4636: an ambiguous candidate carries no diff and holds before any diff is read', () => {
  for (const sensitivePaths of [[], null]) {
    const item = resolveRef('Hold: yes\nHeld: two plausible new targets\nTarget: docs/a.md\n\nold -> one of b or c\n', refState(true), { sensitivePaths });
    assert.strictEqual(item.resolution, 'pending');
    assert.strictEqual(item.reason, 'reference-repair-held');
  }
});

test('#4636: unreadable merge-sensitive paths hold', () => {
  for (const sensitivePaths of [null, undefined, 'docs/**', [7]]) {
    const item = resolveRef(`Hold: no\n\n${REF_DIFF}`, refState(), { sensitivePaths });
    assert.strictEqual(item.resolution, 'pending', String(sensitivePaths));
    assert.strictEqual(item.reason, 'reference-repair-unclassified', String(sensitivePaths));
  }
});
```

In `tests/bin-lib/console/cli.test.js`, append, reusing `mainCheckoutWithRun` and `baseDeps`:

```js
test('#4636: console-resolve.js reads merge-sensitive-paths from policy and holds a repair the diff shows on one', async () => {
  const text = 'Hold: no\n\ndiff --git a/docs/a.md b/docs/a.md\n--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1 +1 @@\n-old\n+new\n';
  const outcome = async (policyExtra) => {
    const fx = mainCheckoutWithRun({ staged: { 'wrap-up-reference-1.md': text }, policyExtra });
    fs.writeFileSync(path.join(fx.runDir, 'engine-state.json'), JSON.stringify({ results: { references: { result: 'findings', findings: [{ targetPath: 'docs/a.md', action: 'staged', stagePath: path.join(fx.runDir, 'staged', 'wrap-up-reference-1.md'), hold: false }] } } }));
    const { d } = baseDeps(fx, []);
    assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
    return JSON.parse(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8')).items.find((i) => i.id === 'wrap-up-reference-1.md');
  };
  assert.strictEqual((await outcome('')).resolution, 'approve');
  assert.strictEqual((await outcome('merge-sensitive-paths: plugin/**\n')).resolution, 'approve');
  const held = await outcome('merge-sensitive-paths: plugin/**,docs/**\n');
  assert.strictEqual(held.resolution, 'pending');
  assert.strictEqual(held.reason, 'reference-repair-held');
});
```

Leave the existing `Held:` test (line ~360) and the unreadable test (line ~375) unchanged. They must keep passing as written, with no JSON `hold`, which pins the back-compat half of the expand-contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL — `AC1.1 (#4636): a staged header the resolver cannot classify holds rather than approves` fails with `'approve' !== 'pending'` (label `empty`).

- [ ] **Step 3: Write `plugin/bin/lib/console/reference-repair.js` and wire it in**

`stagedDiffPaths(text)`: split on `/\r?\n/`, take each line starting with `diff --git `. For the rest of the line:

1. Same-path form first, recovered from the length as `plugin/bin/lib/review-context/build.js`'s private `diffHeaderPath` does, because a path may contain spaces: `s.startsWith('a/')`, `(s.length - 5) % 2 === 0`, `p = s.slice(2, 2 + (s.length - 5) / 2)`, and `s === `a/${p} b/${p}``.
2. Otherwise a rename or copy: `s` starts with `a/` and holds exactly one ` b/`. Both sides are its paths.
3. Otherwise the line is unreadable.

A path that is empty, or has an empty, `.` or `..` segment after splitting on `/`, is unreadable. Any unreadable line, or no such line at all, returns `null`. Use `indexOf`, not a regex, so the scan stays linear on a long line. Copy the same-path recovery rather than exporting it from `review-context/build.js`, whose module this leaf must not load; say so in a comment naming that function.

`referenceRepairHoldReason(item, findings, sensitivePaths)`, in this order:

1. `item.readError || item.text === null` → `UNREADABLE` (unchanged).
2. Header = the lines of `String(item.text).split(/\r?\n/)`, each `trimEnd()`ed, up to but excluding the first empty line.
3. Any header line matching `/^held:/i` → `HELD`.
4. Any of `findings` with `hold === true` → `HELD`.
5. `paths = stagedDiffPaths(item.text)`. Any of `paths` that `isTestPath` accepts, or that `matchesPath` accepts for any of `sensitivePaths` when that is an array → `HELD`.
6. `holds` = the header lines matching `/^hold:(.*)$/i`, each mapped to its captured value, trimmed and lowercased. `holds.length !== 1` → `UNCLASSIFIED`. `'yes'` → `HELD`. Anything other than `'no'` → `UNCLASSIFIED`.
7. `paths === null` or `!Array.isArray(sensitivePaths)` → `UNCLASSIFIED`.
8. The header says no. `findings.length === 1 && findings[0].action === 'staged' && findings[0].hold === false` → `null`, else `UNCLASSIFIED`.

`referenceFindingsByFile(engineState)`: read `engineState.results.references`; return an empty map unless `result === 'findings'` and `findings` is an array; skip an entry that is not an object or whose `stagePath` is not a string; key by `path.basename(stagePath)`. Guard a `null` `engineState`.

In `resolve.js`: remove the old function and its comment. `readSnapshot` adds `sensitivePaths: Array.isArray(deps.sensitivePaths) && deps.sensitivePaths.every((p) => typeof p === 'string') ? deps.sensitivePaths : null`. `stagedItems` calls `referenceFindingsByFile(snapshot.engineState)` once and passes `map.get(s.name) || []` and `snapshot.sensitivePaths`. Check that `readSnapshot` is the only route to `stagedItems` (`git grep -n stagedItems -- plugin/bin`).

In `engineItems`, `const base = typeof f.stagePath === 'string' && f.stagePath ? path.basename(f.stagePath) : null` for every row, so a non-string `stagePath` counts as no staged file and never reaches `path.basename`. A `references` finding with `action === 'staged'` that is not already an item via `staged/` pushes `resolution: 'pending', reason: REFERENCE_REPAIR_REASONS.UNCLASSIFIED`, since it has no header to agree. Every other row keeps its stance.

Put the comment above `referenceRepairHoldReason`: the floor's verdict is `permittedInitiative`'s `hold`, which the sweep writes into the finding's JSON (`engine-state.json`) and the staged header; a repair approves only when both say no and this module's own test-path and merge-sensitive check over the staged file's `diff --git` lines finds no hit, since those paths are the repair itself rather than an agent's account of it (#4636). Any disagreement, absence or malformed value holds, matching `sddRulingDeferralReason`. The causal check stays on the agent-written `hold`, whose `brokenBy` comes from the agent anyway. A `Held: {reason}` line still holds, since files staged before #4636 carry it. Keep a `Prose twin: wrap-up/reference-sweep.md Step 4.` line. `resolve.js` re-exports `REFERENCE_REPAIR_REASONS`.

In `console-resolve.js`: `readPolicy` adds `'merge-sensitive-paths'` to its `keys` and returns `sensitivePaths`: `null` when `result['merge-sensitive-paths']` is missing or carries `error`, else `sensitivePathsOf(entry)` from `./lib/express/policy`. The run's call site passes it as `sensitivePaths` in `resolverDeps`, before the `...(deps.resolverDeps || {})` spread. `docs/plugin-structure.md`'s `plugin/bin/lib/console/` entry gains one sentence for `reference-repair.js`, placed after `sdd-ruling.js`'s.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/cli.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/reference-repair.js plugin/bin/lib/console/resolve.js plugin/bin/console-resolve.js docs/plugin-structure.md tests/bin-lib/console/resolve.test.js tests/bin-lib/console/cli.test.js
git commit -m "Fail the reference-repair hold closed on the JSON verdict, header and staged diff — refs #4636"
```

---

### Task 3: The sweep writes the verdict and the diff, and the prose states the new rule

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/wrap-up/reference-sweep.md` (Step 4)
- Modify: `plugin/skills/wrap-up/curation-engine.md` (the `findings[]` field table)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md:50-52`
- Modify: `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md:53-54`
- Modify: `docs/journeys/review-what-an-unattended-console-left-open-3370.md` (lines 33 and 67)
- Test: `tests/bin-lib/console/resolve.test.js`

Scope-keyword hits outside this list, each read: `plugin/skills/wrap-up/console-template.md:136` describes the `Why` column's reason string, which is unchanged, so no edit. `docs/superpowers/plans/2026-10-30-reference-repair-staged-prefix-4585.md` is #4585's finished plan, a record of what was true then, so no edit.

**Interfaces:**
- Consumes: Task 1's `hold`; Task 2's `REFERENCE_REPAIR_REASONS` and its `diff --git` reading.

- [ ] **Step 1: Write the failing test** (append to `tests/bin-lib/console/resolve.test.js`, reusing its `APPENDIX` text and importing `REFERENCE_REPAIR_REASONS`)

```js
test('#4636: review-console-appendix.md names every reference-repair pending reason', () => {
  const reasons = Object.values(REFERENCE_REPAIR_REASONS);
  assert.ok(reasons.length >= 4);
  const text = APPENDIX.replace(/\s+/g, ' ');
  for (const reason of reasons) assert.ok(text.includes(`pending — ${reason}`), reason);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL — `#4636: review-console-appendix.md names every reference-repair pending reason` fails naming `reference-repair-unclassified`.

- [ ] **Step 3: Update the prose**

- `plugin/skills/wrap-up/reference-sweep.md` Step 4. Under **`supervised`**, each candidate still goes through `permittedInitiative`, which denies it on the ceiling; nothing is applied and its `hold` is still recorded. Replace the paragraph's Held rules (from "When its target is ambiguous" through "carries no `Held:` line.") with: every staged candidate records `permittedInitiative`'s `hold` twice, copied verbatim and never judged: as the finding's boolean `hold` field in the row's payload, and as exactly one `Hold: yes` or `Hold: no` line in the staged file's header (the lines before the first blank line). A target Step 3 found ambiguous takes `hold: true`/`Hold: yes` whatever the floor said, plus a `Held: {reason}` line naming why, and carries no diff: nothing has been decided to compose one from. On any other `Hold: yes`, also add a `Held: {reason}` line naming why. Over-budget, over-cap and `supervised` denials of an otherwise clean fix come back `hold: false`. Then add, as a required sentence: every other staged repair's body carries the repair's real diff, one `diff --git a/{path} b/{path}` block per file, with those lines unindented and at the start of the line. Give the composition recipe from Global Constraints as a fenced command: a fresh temp directory outside the repo holding `a/{path}` and `b/{path}`, then `git diff --no-index --no-prefix -- a/{path} b/{path}` from there, its exit 1 being success, its output pasted verbatim under the header and never hand-typed, so a staged candidate leaves the shared worktree untouched, including under `--dry-run`. Then run `_shared/staged-patch.md`'s Staging-time gate on the file (`git -C "{worktree root}" apply --check "{stagePath}"`); on its malformed branch, recompose once, and if it still fails, stage it `hold: true`/`Hold: yes` with a `Held: diff did not apply at staging` line and no diff, rather than that gate's description-only `.md`. Name that a repair with no parseable diff never auto-approves, and that the resolver reads the repair's paths from those lines rather than from `targetPath`, `files` or `summary`. `console-resolve.js --policy console-auto` approves only when the finding's `hold` is `false`, the header says `Hold: no`, and no path in the diff is a test file or matches `merge-sensitive-paths`; a true value on either side, a `Held:` line or such a path resolves `pending — reference-repair-held`, and a missing, duplicated, misplaced or malformed value on either side, or a missing or unparseable diff, resolves `pending — reference-repair-unclassified`. Under `--dry-run` the same records are written, since everything stages there.
- `plugin/skills/wrap-up/curation-engine.md`: in the section 3 payload JSON template, add `"hold": false,` after `"stagePath": null,` in the example finding. Add a row after `findings[].stagePath`: `findings[].hold` | `references` staged findings | Boolean: `permittedInitiative`'s verdict, copied verbatim (`reference-sweep.md` Step 4). Not validated at record time and stored as given; the console resolver reads it and holds the repair on anything but `false`. The resolver reads the repair's paths from the staged file's own diff, never from this payload.
- `plugin/skills/wrap-up/review-console-appendix.md` lines 50-52: the `wrap-up-reference-*` clause becomes "a `wrap-up-reference-*` item the initiative floor held (a `references` finding with `hold: true`, a header carrying `Hold: yes` or a `Held:` line, or a staged diff naming a test file or a merge-sensitive path — `reference-sweep.md` Step 4) lands as `pending — reference-repair-held`; one whose finding or header is missing, duplicated or malformed, so the two cannot agree on `Hold: no`, or whose staged diff is missing or unparseable, lands as `pending — reference-repair-unclassified`; one whose file cannot be read lands as `pending — reference-repair-unreadable`; none is auto-approved". After the `--set-item` sentence at line 63 (`apply` → `keep-staged`), add that a reference repair whose diff no longer applies at Phase 4 is rewritten `approve` → `pending — reference-repair-stale` the same way (`execution-and-verification.md`'s Reference repairs bullet). Task 3's prose test requires this sentence.
- `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md`: in the line 53 sentence starting "A reference repair the Broken references row stages", it resolves `approve` under Reference repairs only when its `engine-state.json` finding carries `hold: false`, its staged header agrees with `Hold: no`, and the resolver's own check of the staged file's `diff --git` lines finds no test file or merge-sensitive path; otherwise it resolves `pending` (`reference-repair-held` / `reference-repair-unclassified` / `reference-repair-unreadable`), never auto-approved. In the line 54 red flags, change "a `wrap-up-reference-` repair with a `Held:` header line reported `approve`" to "a `wrap-up-reference-` repair reported `approve` without both a finding `hold: false` and a header `Hold: no`, with a `Held:` header line, with a staged diff naming a test file or merge-sensitive path, or with no parseable staged diff".
- `docs/journeys/review-what-an-unattended-console-left-open-3370.md` line 33: the `wrap-up-reference-*` parenthetical becomes "a `wrap-up-reference-*` repair the floor held, whose finding and header do not both say no, whose staged diff is missing or names a test file or merge-sensitive path, or whose file cannot be read — `reference-repair-held` / `reference-repair-unclassified` / `reference-repair-unreadable`, #4585, #4636". Line 67: append "Updated by #4636: an unclassifiable `wrap-up-reference-*` repair is a `pending` class too."

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

---

### Task 4: An approved repair is applied from the staged diff, and a stale diff goes back to pending

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/wrap-up/execution-and-verification.md` (the **Reference repairs** bullet, line 14)
- Modify: `plugin/bin/lib/console/item-resolution.js` (`REWRITE_FROM`, the header comment)
- Modify: `plugin/bin/console-resolve.js` (`USAGE`, the second-shape header comment)
- Test: `tests/bin-lib/console/item-resolution.test.js` (lines 38-39 and 87, plus appended tests)
- Test: `tests/bin-lib/console/reference-repair-apply.test.js` (new)

**Interfaces:**
- Consumes: Task 2's `stagedDiffPaths` and `REFERENCE_REPAIR_REASONS.STALE`; Task 3's composition recipe.
- Produces: `REWRITE_FROM = { 'keep-staged': ['apply'], pending: ['approve'] }`, each list frozen. `--set-item` already validates `--resolution` against the table's keys, so the CLI takes `pending` with no flag change.

- [ ] **Step 1: Update the pins and write the failing tests**

In `tests/bin-lib/console/item-resolution.test.js`: line 38's `deepStrictEqual` gains `pending: ['approve']`, and line 39 also asserts `Object.isFrozen(REWRITE_FROM.pending)`. Line 87's case is `['a target outside REWRITE_FROM', STORED(), /not rewritable to filed/, { resolution: 'filed' }]`. Add, in that same table, `['an apply item to pending', STORED(), /apply, not rewritable to pending/, { resolution: 'pending' }]`. Append:

```js
test('#4636: rewrites an approve item to pending, recording what it replaced', () => {
  const before = STORED();
  before.items[0] = { id: 'wrap-up-reference-1.md', section: 'Reference repairs', resolution: 'approve', reason: 'stance' };
  const consolePath = consoleFile(before);
  const r = call(consolePath, { id: 'wrap-up-reference-1.md', resolution: 'pending', reason: 'reference-repair-stale' });
  assert.strictEqual(r.status, 'rewrote');
  assert.strictEqual(r.from, 'approve');
  const after = JSON.parse(fs.readFileSync(consolePath, 'utf8')).items[0];
  assert.strictEqual(after.resolution, 'pending');
  assert.strictEqual(after.reason, 'reference-repair-stale');
  assert.strictEqual(after.rewrittenFrom, 'approve');
});
```

Create `tests/bin-lib/console/reference-repair-apply.test.js`. Each test builds a real temp git repo (`git init`, a committed `docs/a.md`, `core.autocrlf=false`), and a helper `compose(repo, rel, next)` that follows the recipe: a fresh temp directory, `a/{rel}` copied from the repo, `b/{rel}` written, `spawnSync('git', ['diff', '--no-index', '--no-prefix', '--', `a/${rel}`, `b/${rel}`], { cwd })`, asserting status 1.

```js
test('#4636: the composition recipe names the real path and leaves the repo untouched', () => {
  for (const rel of ['docs/a.md', 'docs/sub dir/my guide.md']) {
    const repo = repoWith(rel, 'one\nold\nthree\n');
    const diff = compose(repo, rel, 'one\nnew\nthree\n');
    assert.deepStrictEqual(stagedDiffPaths(`Hold: no\n\n${diff}`), [rel]);
    assert.strictEqual(git(repo, 'status', '--porcelain'), '');
  }
});

test('#4636: what the resolver checked is what git apply lands', () => {
  const rel = 'docs/a.md';
  const repo = repoWith(rel, 'one\nold\nthree\n');
  const staged = stagedFile(`Hold: no\nTarget: ${rel}\n\n${compose(repo, rel, 'one\nnew\nthree\n')}`);
  assert.strictEqual(apply(repo, '--check', staged), 0);
  assert.strictEqual(apply(repo, staged), 0);
  assert.strictEqual(fs.readFileSync(path.join(repo, rel), 'utf8'), 'one\nnew\nthree\n');
  assert.deepStrictEqual(git(repo, 'status', '--porcelain').trim().split('\n'), [` M ${rel}`]);
});

test('#4636: a diff that no longer applies is refused and changes nothing', () => {
  const rel = 'docs/a.md';
  const repo = repoWith(rel, 'one\nold\nthree\n');
  const staged = stagedFile(`Hold: no\n\n${compose(repo, rel, 'one\nnew\nthree\n')}`);
  fs.writeFileSync(path.join(repo, rel), 'one\nmoved on\nthree\n');
  assert.notStrictEqual(apply(repo, '--check', staged), 0);
  assert.strictEqual(fs.readFileSync(path.join(repo, rel), 'utf8'), 'one\nmoved on\nthree\n');
});

test('#4636: the Reference repairs bullet applies from the staged diff and routes a stale one to pending', () => {
  const bullet = EXECUTION.split('\n').find((l) => l.startsWith('- **Reference repairs**'));
  assert.ok(bullet);
  assert.ok(bullet.includes('apply --check'), 'checks first');
  assert.ok(bullet.includes('--set-item'), 'names the rewrite');
  assert.ok(bullet.includes('--resolution pending'), 'names the target');
  assert.ok(bullet.includes(REFERENCE_REPAIR_REASONS.STALE), 'names the reason');
  assert.ok(bullet.includes('git -C'), 'runs from the worktree root');
});
```

`apply(repo, ...args)` runs `git -C {repo} apply ...args` and returns the exit status. `stagedFile(text)` writes to a temp file outside the repo. `EXECUTION` reads `plugin/skills/wrap-up/execution-and-verification.md`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/console/item-resolution.test.js tests/bin-lib/console/reference-repair-apply.test.js`
Expected: FAIL — the rewrite-table pin, and `#4636: the Reference repairs bullet applies from the staged diff` on `apply --check`.

- [ ] **Step 3: Implement**

`item-resolution.js`: `REWRITE_FROM = Object.freeze({ 'keep-staged': Object.freeze(['apply']), pending: Object.freeze(['approve']) })`. The header comment gains one sentence: a Reference-repairs `approve` whose staged diff no longer applies at Phase 4 goes to `pending` the same way (#4636).

`console-resolve.js`: `USAGE`'s second line reads `--resolution keep-staged|pending`. The header comment names the `approve` → `pending` rewrite beside the existing one.

`execution-and-verification.md`'s Reference repairs bullet: after the sentence ending "confirm them under Verify execution instead", replace "A staged repair approved here is an ordinary edit in this step's commit, not an initiative fix, and carries no trailer" with: a staged repair approved here is applied from its own staged file, so the edit that lands is the diff the resolver checked: `git -C "{worktree root}" apply --check "{staged path}"`, then `git -C "{worktree root}" apply "{staged path}"`, always the `-C` form, since from a subdirectory `git apply` skips a path outside it and still exits 0. Never re-derive the edit from `Target:` or `summary`, and never hand-edit. The result is an ordinary edit in this step's commit, not an initiative fix, and carries no trailer. Keep the trailer clause that follows. Then add: when the check fails, or the file holds no `diff --git` line (an ambiguous candidate a human approved), apply nothing and run `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "$PIPELINE_RUN_DIR" --set-item '{name}' --resolution pending --reason 'reference-repair-stale: {first stderr line, or "no staged diff"}'`, so the row surfaces as residue for a human. `--set-item` exits 5 on a console this CLI did not auto-resolve; a human is present on that path, so name the row and its staged path in the Phase 4 report as not applied instead. Keep it one bullet: Step 1's test reads one line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/console/item-resolution.test.js tests/bin-lib/console/reference-repair-apply.test.js tests/bin-lib/console/cli.test.js tests/console-failed-execution-residue-conformance.test.js tests/wrap-up-verify-execution-pin.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/execution-and-verification.md plugin/bin/lib/console/item-resolution.js plugin/bin/console-resolve.js tests/bin-lib/console/item-resolution.test.js tests/bin-lib/console/reference-repair-apply.test.js
git commit -m "Apply an approved reference repair from its staged diff and send a stale one back to pending — refs #4636"
```
