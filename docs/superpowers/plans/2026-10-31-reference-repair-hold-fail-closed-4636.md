# Reference-Repair Hold Fails Closed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A floor denial computed by `permittedInitiative` reaches the Review Console resolver through a structured JSON field in `engine-state.json`, the resolver re-checks the test-path and merge-sensitive floors itself from the staged file's own diff, a `staged/wrap-up-reference-*.md` repair the resolver cannot classify resolves `pending` instead of `approve`, and an approved repair is applied from that same staged diff, so what the resolver checked is what lands.

**Architecture:** `permittedInitiative` (`plugin/bin/lib/issues/initiative-budget.js`) gains a boolean `hold` on every result, derived from the floor conditions whichever check fails first. The broken-reference sweep writes it as `findings[].hold` in its `references` payload (which `engine-record.js` already stores verbatim into `engine-state.json`), copies it into a required `Hold: yes|no` header of the staged file, and must write the repair's real diff into that file, composed on a temp copy. A new leaf module, `plugin/bin/lib/console/reference-repair.js`, holds the decision: it approves a repair only when the JSON field reads `hold: false`, the header agrees, the staged diff passes a strict parser (every path line in every section agrees with that section's `diff --git` line, every section has one, and anything else is unreadable) and no parsed path is a test path or a merge-sensitive match. `console-resolve.js`'s `readPolicy` resolves `merge-sensitive-paths` and passes it through `deps.sensitivePaths`; an unreadable value holds. The causal check stays on the agent-written `hold`, because its `brokenBy` input comes from the agent anyway. Phase 4 applies an approved repair with `git apply` from the staged file, on the single-spec and multi-spec consoles alike; one that no longer applies is rewritten `approve` → `pending` through `console-resolve.js --set-item`. A repair staged with no diff (an ambiguous candidate, or a diff that could not be composed) is held; a human approving one names the target, the diff is composed by the same recipe, `console-resolve.js --check-repair` re-runs the floor on it, and it lands with `git apply`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T204704-record-4636/work/4636-spec.md`

Scope keywords: referenceRepairHoldReason, reference-repair-held, permittedInitiative

## Global Constraints

- Acceptance criterion (verbatim): "A floor denial computed by permittedInitiative reaches the resolver through a structured field, and a file the resolver cannot classify holds rather than approves, matching sddRulingDeferralReason."
- Plan Review Decision (verbatim): "`permittedInitiative`'s `hold` travels as a JSON field the reference sweep writes into `engine-state.json`'s `references` findings, which `plugin/bin/lib/console/resolve.js` already reads; the resolver holds the repair unless that JSON field reads `hold: false` and the staged file's `Hold:` header agrees. Any disagreement, absence or malformed value holds (fails closed)."
- Plan Review Decision (verbatim): "`hold` is computed from the floor conditions regardless of which check fails first: a test-file, causal-set or merge-sensitive repair that is also over budget or over a size cap still gets `hold: true`."
- Plan Review Decision (verbatim): "Task 1 (the per-denial-path decision logic) carries `Review risk: high`."
- Plan Review Decision (verbatim): "At `unattended`, the resolver runs the test-path and merge-sensitive checks itself and holds on a hit. It reads the paths from the `diff --git` lines of the staged `wrap-up-reference-*` file, never from the agent-written `target`, `files` or `summary`, and holds when that file has no parseable diff. The reference sweep must write the diff into every staged repair. The causal check stays on the agent-written `hold`, because its `brokenBy` input comes from the agent anyway."
- Plan Review Decision (verbatim): "a non-string `stagePath` counts as no staged file; the "whichever check fails first" test skips the `no files` + `files cap` pair; Task 3 carries `Review risk: high`; `supervised` stays approvable and an unknown or non-string ceiling holds."
- Plan Review Decision (verbatim): "An approved reference repair is applied from the staged diff with `git apply`, so what the resolver checked is what lands; `plugin/skills/wrap-up/execution-and-verification.md` changes accordingly, with a test for this direction. A diff that no longer applies leaves the row pending for a human."
- Plan Review Decision (verbatim): "They carry `Hold: yes` plus a `Held:` line and no diff, and the resolver holds them before it reads any diff. Every other staged repair must carry a real diff, except one whose diff could not be composed (see below)."
- Plan Review Decision (verbatim): "**Approving a repair with no diff: the human names the target (answered 2026-11-02).** The approving human picks the target, the diff is composed by the same recipe as any other, the floor check re-runs on it, and it lands with `git apply`. At `unattended` the row stays pending."
- Plan Review Decision (verbatim): "**A diff that cannot be composed: hold it with no diff (answered 2026-11-02).** It is staged as held the same way as an ambiguous candidate, so a human sees it on the console."
- Plan Review Decision (verbatim): "**The floor check uses a strict diff parser, proved by probe on 2026-11-02.** Reading only `diff --git` lines is not enough. All three of these patches pass under a `docs/a.md` header, and `git apply` changes `tests/x.test.js`: `---`/`+++` lines naming the test file; a second section with no `diff --git` line; `rename from tests/x.test.js`. `git apply --numstat` lists only the new path for the rename, so it is not a sufficient path source on its own. Every path line in a section (`---`, `+++`, `rename`, `copy`) must agree with that section's `diff --git` line, every section must have one, and anything else holds. Hunk content lines that resemble path lines must not be misread. All three patches become test fixtures."
- Plan Review Decision (verbatim): "the multi-spec console applies an approved reference repair the same way as the single-spec console; the stale rewrite does not use `$PIPELINE_RUN_DIR` or treat every exit 5 as a human being present, and handles exit 3; Task 3 Step 5's grep expectation names `reference-repair.js`; `docs/plugin-structure.md:165` is updated for the widened `--set-item`."
- Merge-sensitive matching is `plugin/bin/lib/issues/blast-radius.js`'s `isSensitivePath`, the matcher the merge-check floor and the express lane use, in both the resolver and `permittedInitiative`. Probed from the source: `initiative-budget.js`'s private `matchesPath` compiles `**/x` to `^.*/x$`, so a root-level `package-lock.json` under `**/package-lock.json` reads clear there and sensitive at merge. `isSensitivePath` matches a superset for every documented form, so the move only ever holds more. `blast-radius.js` requires nothing, so there is no cycle. `matchesPath` is deleted.
- Probed 2026-11-02 against this repo's git: the recipe's `---`/`+++` lines end in a tab when the path holds a space (`--- a/docs/sub dir/my guide.md\t`), so a path line is compared after removing one trailing tab. A traditional patch before any `diff --git` line (`--- a/tests/x.test.js` / `+++ …` / `@@`) also passes `git apply --check` and changes the test file, so the parser refuses a line starting `---`, `+++` or `@@` ahead of the first section too. `git apply` ignores other prose ahead of the first section, so that prose stays allowed.
- Size: `plugin/skills/flow/multispec-review-console.md` is 51,535 B against the 52,500 B rail. Task 4's addition there is one clause of under 200 B and the file stays under the rail; nothing else is added to it.
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
12. **The three proved bypasses, plus a traditional patch ahead of the first section.** Each is run through real `git apply --check` to show it would change the test file, then through the resolver to show it holds. Pinned in Task 4's real-git test and Task 2.
13. **Hunk content resembling path lines.** A removed line reading `-- a/tests/x.test.js` renders as `--- a/tests/x.test.js` inside a hunk and must not be read as a path line. Hunks are consumed by their `@@` counts. Pinned in Task 2.
14. **A no-diff repair a human approves.** Target named by the human at the console stop, same recipe, floor re-run, `git apply`. What a floor hit on the composed diff does is an open question on the record (plan review, 2026-11-02); this plan does not rule on it. Pinned in Task 4 for the clear case.
15. **A staged file that changed after the resolver approved it.** A row from an auto-resolved console re-runs `--check-repair` on the staged file before `apply`, so a resumed sweep's rewrite cannot land unchecked. Pinned in Task 4's bullet test.
16. **A root-level `package-lock.json` under `**/package-lock.json`.** Holds in the resolver and in `permittedInitiative`. Pinned in Tasks 1 and 2.
17. **A reference repair on any console path.** `On approval` and `On override`, single-spec and multi-spec, all reach the one Phase 4 bullet; multi-spec step 1 never applies a `wrap-up-reference-*` file, and `modify {#}` on such a row is refused. Pinned in Task 4.

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
- `isTestPath` is already exported, for Task 2's resolver floor. `matchesPath` is deleted; the merge-sensitive check calls `isSensitivePath` from `./blast-radius`.

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

test('#4636: a root-level file under a **/ pattern is merge-sensitive', () => {
  const r = permittedInitiative({ ...base(), fix: { ...base().fix, files: ['package-lock.json'] }, sensitivePaths: ['**/package-lock.json'] });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.hold, true);
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

Every `fails` is evaluated for every input, so normalize first: `fix` to an object or `null`, `files` to an array (an absent `files` is the no-files failure), and pick string entries before the test-path and sensitive-path matches. Remove `deny`. Require `CEILINGS` from `./autonomy` (`autonomy.js` requires only `./record`, so no cycle). Delete `matchesPath` and require `isSensitivePath` from `./blast-radius`, passing it only the string entries of `sensitivePaths`, since `matchesPath` skipped a non-string pattern and `isSensitivePath` assumes strings. Update the JSDoc `@returns` to `{{allowed: boolean, reason: string, hold: boolean}}`, and add a comment above `checks` saying `hold` is what `wrap-up/reference-sweep.md` Step 4 writes into the finding's `hold` field and the staged file's `Hold:` header, and that `floor: true` marks a condition no human click at an unattended console may skip.

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
- Consumes: Task 1's `hold` only as data: `engineState.results.references.findings[].hold`, never through a `require`. Task 1's `isTestPath` through a `require` of `../issues/initiative-budget`, and `isSensitivePath` through a `require` of `../issues/blast-radius`.
- Produces, from `reference-repair.js`, a leaf module like `sdd-ruling.js` that never requires `resolve.js`:
  - frozen `REFERENCE_REPAIR_REASONS = { HELD: 'reference-repair-held', UNCLASSIFIED: 'reference-repair-unclassified', UNREADABLE: 'reference-repair-unreadable', STALE: 'reference-repair-stale' }`, re-exported by `resolve.js` for Task 3's prose test. `STALE` is written only by Task 4's `--set-item` call; a comment says so.
  - `referenceRepairHoldReason(item, findings, sensitivePaths) -> null | one of those`. `findings` is the array of `references` findings naming this file. `sensitivePaths` is `string[]`, or `null` when unreadable.
  - `referenceFindingsByFile(engineState) -> Map<basename, finding[]>`.
  - `stagedDiffPaths(text) -> string[] | null`, the strict parser.
  - `referenceRepairFloorReason(text, sensitivePaths) -> null | HELD | UNCLASSIFIED`, the floor check alone: a parsed test or merge-sensitive path is `HELD`, then a `null` parse or unreadable `sensitivePaths` is `UNCLASSIFIED`. `referenceRepairHoldReason` uses its parts and Task 4's `--check-repair` calls it whole.
- Produces: `resolveAll` reads `deps.sensitivePaths`. `readSnapshot` carries it as `snapshot.sensitivePaths`, normalized to `null` unless it is an array of strings, so a caller that omits it holds rather than approves.
- Produces: `readPolicy(...)` also returns `sensitivePaths`.

- [ ] **Step 1: Update the existing fixtures and write the failing tests** in `tests/bin-lib/console/resolve.test.js`

Add `sensitivePaths: []` to the file's `deps()` helper, and import `stagedDiffPaths` and `referenceRepairFloorReason` from `plugin/bin/lib/console/reference-repair`.

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

const HUNK = '@@ -1,3 +1,3 @@\n one\n-old\n+new\n three\n';
const BYPASSES = {
  '---/+++ naming the test file': `diff --git a/docs/a.md b/docs/a.md\n--- a/tests/x.test.js\n+++ b/tests/x.test.js\n${HUNK}`,
  'second section with no diff --git line': `diff --git a/docs/a.md b/docs/a.md\n--- a/docs/a.md\n+++ b/docs/a.md\n${HUNK}--- a/tests/x.test.js\n+++ b/tests/x.test.js\n${HUNK}`,
  'rename from the test file': 'diff --git a/docs/a.md b/docs/a.md\nsimilarity index 100%\nrename from tests/x.test.js\nrename to docs/b.md\n',
  'traditional patch before any section': `--- a/tests/x.test.js\n+++ b/tests/x.test.js\n${HUNK}`,
};

test('#4636: the proved diff bypasses hold', () => {
  for (const [label, body] of Object.entries(BYPASSES)) {
    assert.strictEqual(stagedDiffPaths(`Hold: no\n\n${body}`), null, label);
    const item = resolveRef(`Hold: no\n\n${body}`, refState());
    assert.strictEqual(item.resolution, 'pending', label);
    assert.strictEqual(item.reason, 'reference-repair-unclassified', label);
  }
});

test('#4636: every other path line or header the parser cannot square with its section holds', () => {
  const head = 'diff --git a/docs/a.md b/docs/a.md\n';
  const cases = {
    '--- only disagrees': `${head}--- a/tests/x.test.js\n+++ b/docs/a.md\n${HUNK}`,
    '+++ only disagrees': `${head}--- a/docs/a.md\n+++ b/tests/x.test.js\n${HUNK}`,
    'hunk with no path lines': `${head}${HUNK}`,
    '/dev/null side': `${head}--- /dev/null\n+++ b/docs/a.md\n${HUNK}`,
    'copy from elsewhere': `${head}copy from tests/x.test.js\ncopy to docs/a.md\n`,
    'rename to elsewhere': `${head}rename from docs/a.md\nrename to tests/x.test.js\n`,
    'unknown header line': `${head}new file mode 100644\n--- a/docs/a.md\n+++ b/docs/a.md\n${HUNK}`,
    'binary': `${head}GIT binary patch\nliteral 0\n`,
    'short hunk': `${head}--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1,3 +1,3 @@\n one\n`,
    'malformed hunk header': `${head}--- a/docs/a.md\n+++ b/docs/a.md\n@@ nope @@\n one\n`,
    'stray line after a hunk': `${head}--- a/docs/a.md\n+++ b/docs/a.md\n${HUNK}trailing prose\n`,
  };
  for (const [label, body] of Object.entries(cases)) {
    assert.strictEqual(stagedDiffPaths(`Hold: no\n\n${body}`), null, label);
  }
});

test('#4636: hunk content that looks like a path line is content', () => {
  const lookalike = 'diff --git a/docs/a.md b/docs/a.md\n--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1,3 +1,3 @@\n one\n--- a/tests/x.test.js\n+++ b/tests/x.test.js\n three\n';
  assert.deepStrictEqual(stagedDiffPaths(`Hold: no\n\n${lookalike}`), ['docs/a.md']);
  const noNewline = 'diff --git a/docs/a.md b/docs/a.md\n--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n';
  assert.deepStrictEqual(stagedDiffPaths(`Hold: no\n\n${noNewline}`), ['docs/a.md']);
});

test('#4636: well-formed sections parse: prose ahead, a path with a space, a tab-ended path line, two sections, a real rename', () => {
  assert.deepStrictEqual(stagedDiffPaths(`Hold: no\n\nold -> new\n\n${REF_DIFF}`), ['docs/a.md']);
  assert.deepStrictEqual(stagedDiffPaths(`diff --git a/docs/my a.md b/docs/my a.md\nindex d09312f..2ddd079 100644\n--- a/docs/my a.md\t\n+++ b/docs/my a.md\t\n${HUNK}`), ['docs/my a.md']);
  assert.deepStrictEqual(stagedDiffPaths(`${REF_DIFF}diff --git a/docs/b.md b/docs/b.md\n--- a/docs/b.md\n+++ b/docs/b.md\n${HUNK}`), ['docs/a.md', 'docs/b.md']);
  assert.deepStrictEqual(stagedDiffPaths('diff --git a/docs/a.md b/docs/b.md\nsimilarity index 100%\nrename from docs/a.md\nrename to docs/b.md\n'), ['docs/a.md', 'docs/b.md']);
});

test('#4636: referenceRepairFloorReason is the floor check alone', () => {
  assert.strictEqual(referenceRepairFloorReason(`Hold: no\n\n${REF_DIFF}`, []), null);
  assert.strictEqual(referenceRepairFloorReason(REF_DIFF, []), null, 'reads no header');
  assert.strictEqual(referenceRepairFloorReason(REF_DIFF, ['docs/**']), 'reference-repair-held');
  assert.strictEqual(referenceRepairFloorReason(REF_DIFF, null), 'reference-repair-unclassified');
  assert.strictEqual(referenceRepairFloorReason('no diff', []), 'reference-repair-unclassified');
  assert.strictEqual(referenceRepairFloorReason('diff --git a/tests/a.test.js b/tests/a.test.js\n', null), 'reference-repair-held');
  assert.strictEqual(referenceRepairFloorReason('diff --git a/package-lock.json b/package-lock.json\n', ['**/package-lock.json']), 'reference-repair-held', 'root-level file under **/');
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

`stagedDiffPaths(text)` is one forward walk over `text.split(/\r?\n/)`, dropping one final empty element so the text's own last newline is not read as a line, in four states, returning `null` the moment anything is unreadable, and the paths in order of first appearance, de-duplicated, at the end. `null` too when no section was seen.

- **Before the first section:** a line starting `diff --git ` opens a section. A line starting `---`, `+++` or `@@` returns `null`, because `git apply` acts on a traditional patch here. Anything else is prose `git apply` ignores: the header, a summary line.
- **In a section's header** (after a `diff --git` line, before any hunk). Parse the `diff --git` line's remainder `s` into its two sides:
  1. Same-path form first, recovered from the length as `plugin/bin/lib/review-context/build.js`'s private `diffHeaderPath` does, because a path may contain spaces: `s.startsWith('a/')`, `(s.length - 5) % 2 === 0`, `p = s.slice(2, 2 + (s.length - 5) / 2)`, and `s === `a/${p} b/${p}``. Both sides are `p`.
  2. Otherwise a rename or copy: `s` starts with `a/` and holds exactly one ` b/`. The sides are what precede and follow it.
  3. Otherwise the line is unreadable.

  A side that is empty, or has an empty, `.` or `..` segment after splitting on `/`, is unreadable. Then each following line must be one of: `--- a/{from side}` and `+++ b/{to side}`, each compared after removing one trailing tab; `rename from {from side}`, `rename to {to side}`, `copy from {from side}`, `copy to {to side}`; or one starting `index `, `old mode `, `new mode `, `similarity index `, `dissimilarity index `. Any other line returns `null`, so `/dev/null`, `new file mode`, `deleted file mode`, `Binary files` and `GIT binary patch` hold; the recipe edits an existing text file and never produces them. A `@@` line needs both `---` and `+++` already seen in this section, and starts a hunk. A `diff --git ` line opens the next section, and a blank line moves to the between state.
- **In a hunk:** the `@@` line must match `/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/` (an omitted count is 1). Consume lines until both counts reach 0: a line starting ` ` or an empty line takes one from each, `-` one from the old count, `+` one from the new, `\` neither, and anything else or the end of the text returns `null`. This is what keeps hunk content from being read as a path line.
- **Between** (after a hunk, or a blank line in a section's header): a `\` line right after a hunk is consumed, a blank line is skipped, `@@` starts another hunk in the same section (only after a hunk), `diff --git ` opens the next section, and anything else returns `null`. That is what refuses a second section with no `diff --git` line.

Use `indexOf`/`startsWith` for the path handling, and only the anchored `@@` regex above, so the walk stays linear on a long line. Copy the same-path recovery rather than exporting it from `review-context/build.js`, whose module this leaf must not load; say so in a comment naming that function. The comment above `stagedDiffPaths` names the three bypasses it refuses and that `git apply --numstat` is not a sufficient path source, since it lists only the new path of a rename.

`referenceRepairFloorReason(text, sensitivePaths)`: `paths = stagedDiffPaths(text)`; any path `isTestPath` accepts, or that `isSensitivePath(path, sensitivePaths)` accepts when `sensitivePaths` is an array → `HELD`; `paths === null` or `!Array.isArray(sensitivePaths)` → `UNCLASSIFIED`; else `null`. Note that a `null` parse has no paths to hit, so a bypass is `UNCLASSIFIED`, which holds the same.

`referenceRepairHoldReason(item, findings, sensitivePaths)`, in this order:

1. `item.readError || item.text === null` → `UNREADABLE` (unchanged).
2. Header = the lines of `String(item.text).split(/\r?\n/)`, each `trimEnd()`ed, up to but excluding the first empty line.
3. Any header line matching `/^held:/i` → `HELD`.
4. Any of `findings` with `hold === true` → `HELD`.
5. `floor = referenceRepairFloorReason(item.text, sensitivePaths)`. `floor === HELD` → `HELD`, ahead of the header, so a floor hit outranks an unclassifiable one.
6. `holds` = the header lines matching `/^hold:(.*)$/i`, each mapped to its captured value, trimmed and lowercased. `holds.length !== 1` → `UNCLASSIFIED`. `'yes'` → `HELD`. Anything other than `'no'` → `UNCLASSIFIED`.
7. `floor === UNCLASSIFIED` → `UNCLASSIFIED`.
8. The header says no. `findings.length === 1 && findings[0].action === 'staged' && findings[0].hold === false` → `null`, else `UNCLASSIFIED`.

`referenceFindingsByFile(engineState)`: read `engineState.results.references`; return an empty map unless `result === 'findings'` and `findings` is an array; skip an entry that is not an object or whose `stagePath` is not a string; key by `path.basename(stagePath)`. Guard a `null` `engineState`.

In `resolve.js`: remove the old function and its comment. `readSnapshot` adds `sensitivePaths: Array.isArray(deps.sensitivePaths) && deps.sensitivePaths.every((p) => typeof p === 'string') ? deps.sensitivePaths : null`. `stagedItems` calls `referenceFindingsByFile(snapshot.engineState)` once and passes `map.get(s.name) || []` and `snapshot.sensitivePaths`. Check that `readSnapshot` is the only route to `stagedItems` (`git grep -n stagedItems -- plugin/bin`).

In `engineItems`, `const base = typeof f.stagePath === 'string' && f.stagePath ? path.basename(f.stagePath) : null` for every row, so a non-string `stagePath` counts as no staged file and never reaches `path.basename`. A `references` finding with `action === 'staged'` that is not already an item via `staged/` pushes `resolution: 'pending', reason: REFERENCE_REPAIR_REASONS.UNCLASSIFIED`, since it has no header to agree. Every other row keeps its stance.

Put the comment above `referenceRepairHoldReason`: the floor's verdict is `permittedInitiative`'s `hold`, which the sweep writes into the finding's JSON (`engine-state.json`) and the staged header; a repair approves only when both say no and this module's own test-path and merge-sensitive check over the strictly parsed staged diff finds no hit, since those paths are the repair itself rather than an agent's account of it (#4636). Any disagreement, absence or malformed value holds, matching `sddRulingDeferralReason`. The causal check stays on the agent-written `hold`, whose `brokenBy` comes from the agent anyway. A `Held: {reason}` line still holds, since files staged before #4636 carry it. Keep a `Prose twin: wrap-up/reference-sweep.md Step 4.` line. `resolve.js` re-exports `REFERENCE_REPAIR_REASONS`.

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

- `plugin/skills/wrap-up/reference-sweep.md` Step 4. Under **`supervised`**, each candidate still goes through `permittedInitiative`, which denies it on the ceiling; nothing is applied and its `hold` is still recorded. Replace the paragraph's Held rules (from "When its target is ambiguous" through "carries no `Held:` line.") with: every staged candidate records `permittedInitiative`'s `hold` twice, copied verbatim and never judged: as the finding's boolean `hold` field in the row's payload, and as exactly one `Hold: yes` or `Hold: no` line in the staged file's header (the lines before the first blank line). Every staged file's header also carries `Target: {repo path of the file holding the reference}`, and its body a `{old} → {new}` line (for an ambiguous one, `{old} → one of {candidates}`), since a human approving a no-diff repair needs both. A target Step 3 found ambiguous takes `hold: true`/`Hold: yes` whatever the floor said, plus a `Held: {reason}` line naming why, and carries no diff: nothing has been decided to compose one from. On any other `Hold: yes`, also add a `Held: {reason}` line naming why. Over-budget, over-cap and `supervised` denials of an otherwise clean fix come back `hold: false`. Then add, as a required sentence: every other staged repair's body carries the repair's real diff, one `diff --git a/{path} b/{path}` block per file, with those lines unindented and at the start of the line. Give the composition recipe from Global Constraints as a fenced command: a fresh temp directory outside the repo holding `a/{path}` and `b/{path}`, then `git diff --no-index --no-prefix -- a/{path} b/{path}` from there, its exit 1 being success, its output pasted verbatim under the header and never hand-typed, so a staged candidate leaves the shared worktree untouched, including under `--dry-run`. Then run `_shared/staged-patch.md`'s Staging-time gate on the file (`git -C "{worktree root}" apply --check "{stagePath}"`); on its malformed branch, recompose once. When the diff cannot be composed at all (the recipe exits anything but 1, the repaired text cannot be produced) or the recomposed one still fails the gate, stage it held with no diff, the way an ambiguous candidate is: `hold: true`, `Hold: yes`, a `Held: {why the diff could not be composed}` line, rather than that gate's description-only `.md`, so a human sees it on the console. Name that a repair with no parseable diff never auto-approves, and that the resolver reads the repair's paths from a strict parse of that diff rather than from `targetPath`, `files` or `summary`: every `---`, `+++`, `rename` and `copy` line must agree with its section's `diff --git` line and every section must have one, so the pasted output is never edited. `console-resolve.js --policy console-auto` approves only when the finding's `hold` is `false`, the header says `Hold: no`, and no path in the diff is a test file or matches `merge-sensitive-paths`; a true value on either side, a `Held:` line or such a path resolves `pending — reference-repair-held`, and a missing, duplicated, misplaced or malformed value on either side, or a missing or unparseable diff, resolves `pending — reference-repair-unclassified`. Under `--dry-run` the same records are written, since everything stages there.
- `plugin/skills/wrap-up/curation-engine.md`: in the section 3 payload JSON template, add `"hold": false,` after `"stagePath": null,` in the example finding. Add a row after `findings[].stagePath`: `findings[].hold` | `references` staged findings | Boolean: `permittedInitiative`'s verdict, copied verbatim (`reference-sweep.md` Step 4). Not validated at record time and stored as given; the console resolver reads it and holds the repair on anything but `false`. The resolver reads the repair's paths from the staged file's own diff, never from this payload.
- `plugin/skills/wrap-up/review-console-appendix.md` lines 50-52: the `wrap-up-reference-*` clause becomes "a `wrap-up-reference-*` item the initiative floor held (a `references` finding with `hold: true`, a header carrying `Hold: yes` or a `Held:` line, or a staged diff naming a test file or a merge-sensitive path — `reference-sweep.md` Step 4) lands as `pending — reference-repair-held`; one whose finding or header is missing, duplicated or malformed, so the two cannot agree on `Hold: no`, or whose staged diff is missing or unparseable, lands as `pending — reference-repair-unclassified`; one whose file cannot be read lands as `pending — reference-repair-unreadable`; none is auto-approved". After the `--set-item` sentence at line 63 (`apply` → `keep-staged`), add that a reference repair whose diff no longer applies at Phase 4 is rewritten `approve` → `pending — reference-repair-stale` the same way (`execution-and-verification.md`'s Reference repairs bullet). Task 3's prose test requires this sentence.
- `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md`: in the line 53 sentence starting "A reference repair the Broken references row stages", it resolves `approve` under Reference repairs only when its `engine-state.json` finding carries `hold: false`, its staged header agrees with `Hold: no`, and the resolver's own strict parse of the staged diff finds no test file or merge-sensitive path; otherwise it resolves `pending` (`reference-repair-held` / `reference-repair-unclassified` / `reference-repair-unreadable`), never auto-approved. In the line 54 red flags, change "a `wrap-up-reference-` repair with a `Held:` header line reported `approve`" to "a `wrap-up-reference-` repair reported `approve` without both a finding `hold: false` and a header `Hold: no`, with a `Held:` header line, with a staged diff naming a test file or merge-sensitive path, or with no parseable staged diff".
- `docs/journeys/review-what-an-unattended-console-left-open-3370.md` line 33: the `wrap-up-reference-*` parenthetical becomes "a `wrap-up-reference-*` repair the floor held, whose finding and header do not both say no, whose staged diff is missing or names a test file or merge-sensitive path, or whose file cannot be read — `reference-repair-held` / `reference-repair-unclassified` / `reference-repair-unreadable`, #4585, #4636". Line 67: append "Updated by #4636: an unclassifiable `wrap-up-reference-*` repair is a `pending` class too."

- [ ] **Step 4: Run the suites that read these files**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/curation-judge-stagepath.test.js tests/review-console-unattended-no-ask-conformance.test.js tests/bin-lib/wrap-up/engine-plan.test.js tests/bin-lib/wrap-up/engine-record.test.js`
Expected: PASS

- [ ] **Step 5: Confirm the sibling sweep**

Run: `git grep -n -E 'reference-repair-(held|unreadable)' -- plugin docs/journeys`
Expected: every hit's sentence also names `reference-repair-unclassified` or sits in `reference-repair.js`'s frozen reasons.

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
- Modify: `plugin/bin/console-resolve.js` (`USAGE`, `parseArgs`, `run`, the header comment)
- Modify: `plugin/skills/flow/multispec-review-console.md` (`## On approval` steps 1 and 6, `## On override` step 2)
- Modify: `plugin/skills/wrap-up/review-console-interactive.md` (a new Reference repairs rows paragraph, `## On override` step 2, the drills-individually bullet)
- Modify: `docs/plugin-structure.md` (the `--set-item` line, line 165)
- Test: `tests/bin-lib/console/item-resolution.test.js` (lines 38-39 and 87, plus appended tests)
- Test: `tests/bin-lib/console/reference-repair-apply.test.js` (new)
- Test: `tests/bin-lib/console/cli.test.js`

**Interfaces:**
- Consumes: Task 2's `stagedDiffPaths`, `referenceRepairFloorReason`, `readPolicy`'s `sensitivePaths` and `REFERENCE_REPAIR_REASONS.STALE`; Task 3's composition recipe.
- Produces: `REWRITE_FROM = { 'keep-staged': ['apply'], pending: ['approve'] }`, each list frozen. `--set-item` already validates `--resolution` against the table's keys, so the CLI takes `pending` with no flag change.
- Produces: a third `console-resolve.js` shape, `--run <dir> --check-repair <file>`, the floor check Phase 4 re-runs on a diff a human's target produced. It prints `console-resolve.js: {file} clear` and exits 0, or prints the reason and exits 5 (`reference-repair-held` or `reference-repair-unclassified`). An unreadable file is exit 5 with `reference-repair-unreadable`. It writes nothing and needs no ceiling. Exit 2 and 3 keep their meanings. It takes none of `--policy`, `--dry-run`, `--json`, `--set-item`.

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

test('#4636: each proved bypass really changes the test file under git apply, and the parser refuses it', () => {
  const hunk = '@@ -1,3 +1,3 @@\n one\n-old\n+new\n three\n';
  const patches = {
    '---/+++ naming the test file': `diff --git a/docs/a.md b/docs/a.md\n--- a/tests/x.test.js\n+++ b/tests/x.test.js\n${hunk}`,
    'second section with no diff --git line': `diff --git a/docs/a.md b/docs/a.md\n--- a/docs/a.md\n+++ b/docs/a.md\n${hunk}--- a/tests/x.test.js\n+++ b/tests/x.test.js\n${hunk}`,
    'rename from the test file': 'diff --git a/docs/a.md b/docs/a.md\nsimilarity index 100%\nrename from tests/x.test.js\nrename to docs/b.md\n',
    'traditional patch before any section': `--- a/tests/x.test.js\n+++ b/tests/x.test.js\n${hunk}`,
  };
  for (const [label, body] of Object.entries(patches)) {
    const repo = repoWith('docs/a.md', 'one\nold\nthree\n');
    fs.mkdirSync(path.join(repo, 'tests'));
    fs.writeFileSync(path.join(repo, 'tests/x.test.js'), 'one\nold\nthree\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'test file');
    const staged = stagedFile(`Hold: no\n\n${body}`);
    assert.strictEqual(apply(repo, staged), 0, label);
    assert.ok(git(repo, 'status', '--porcelain').includes('tests/x.test.js'), `${label}: git apply touched the test file`);
    assert.strictEqual(stagedDiffPaths(fs.readFileSync(staged, 'utf8')), null, label);
  }
});

test('#4636: the recipe composes under the parser for a clean file, and a test file is held', () => {
  const clean = repoWith('docs/a.md', 'one\nold\nthree\n');
  const cleanText = `Hold: no\nTarget: docs/a.md\n\n${compose(clean, 'docs/a.md', 'one\nnew\nthree\n')}`;
  assert.strictEqual(referenceRepairFloorReason(cleanText, []), null);
  const held = repoWith('tests/a.test.js', 'one\nold\nthree\n');
  const heldText = `Hold: no\nTarget: tests/a.test.js\n\n${compose(held, 'tests/a.test.js', 'one\nnew\nthree\n')}`;
  assert.strictEqual(referenceRepairFloorReason(heldText, []), REFERENCE_REPAIR_REASONS.HELD);
});

test('#4636: the Reference repairs bullet applies from the staged diff and routes a stale one to pending', () => {
  const bullet = EXECUTION.split('\n').find((l) => l.startsWith('- **Reference repairs**'));
  assert.ok(bullet);
  assert.ok(bullet.includes('apply --check'), 'checks first');
  assert.ok(bullet.includes('--set-item'), 'names the rewrite');
  assert.ok(bullet.includes('--resolution pending'), 'names the target');
  assert.ok(bullet.includes(REFERENCE_REPAIR_REASONS.STALE), 'names the reason');
  assert.ok(bullet.includes('git -C'), 'runs from the worktree root');
  assert.ok(bullet.includes('{item-run-dir}'), 'names the row\'s own directory');
  assert.ok(!bullet.includes('$PIPELINE_RUN_DIR'), 'not the per-spec variable');
  assert.ok(bullet.includes('--check-repair'), 're-runs the floor on a human-named target');
  assert.ok(bullet.includes('auto-resolve'), 're-runs the floor on an auto-resolved row before apply');
  assert.ok(/exit 3/.test(bullet) && /exit 5/.test(bullet), 'routes both refusals');
});

const between = (text, start, end) => { const i = text.indexOf(start); assert.ok(i >= 0, start); const j = text.indexOf(end, i + start.length); return text.slice(i, j < 0 ? undefined : j); };

test('#4636: every console path reaches the one Phase 4 bullet', () => {
  const approval = between(MULTISPEC, '## On approval', '## On override');
  const stepOne = approval.split('\n').find((l) => l.startsWith('1. '));
  assert.ok(stepOne.includes('wrap-up-reference-'), 'multi-spec step 1 does not apply a reference repair');
  const stepSix = approval.split('\n').find((l) => l.startsWith('6. '));
  assert.ok(stepSix.includes('Reference repairs') && stepSix.includes('execution-and-verification.md'), 'multi-spec step 6 cites the bullet');
  const multiOverride = between(MULTISPEC, '## On override', '\n3. ');
  assert.ok(multiOverride.includes('Reference repairs'), 'multi-spec override routes the row');
  const interactiveOverride = between(INTERACTIVE, '## On override', '\n3. ');
  assert.ok(interactiveOverride.includes('Reference repairs') && interactiveOverride.includes('execution-and-verification.md'), 'single-spec override routes the row');
});

test('#4636: a no-diff repair names its target at the console stop, and modify is refused', () => {
  const para = INTERACTIVE.split('\n').find((l) => l.startsWith('**Reference repairs rows'));
  assert.ok(para);
  assert.ok(para.includes('target {#}'), 'the Override verb');
  assert.ok(para.includes('modify {#}'), 'refuses modify');
  const drills = INTERACTIVE.split('\n').find((l) => l.startsWith('- **The "drills individually" class**'));
  assert.ok(drills.includes('Reference repairs'), 'the row kind joins the class');
  assert.ok(/no-diff/.test(drills));
});
```

`apply(repo, ...args)` runs `git -C {repo} apply ...args` and returns the exit status. `stagedFile(text)` writes to a temp file outside the repo. `EXECUTION` reads `plugin/skills/wrap-up/execution-and-verification.md`; `MULTISPEC` reads `plugin/skills/flow/multispec-review-console.md`; `INTERACTIVE` reads `plugin/skills/wrap-up/review-console-interactive.md`.

In `tests/bin-lib/console/cli.test.js`, append, reusing `mainCheckoutWithRun` and `baseDeps`:

```js
test('#4636: --check-repair runs the floor on a named file, writing nothing', async () => {
  const fx = mainCheckoutWithRun({ staged: {}, policyExtra: 'merge-sensitive-paths: plugin/**\n' });
  const file = (name, text) => { const p = path.join(fx.runDir, name); fs.writeFileSync(p, text); return p; };
  const diff = (p) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-old\n+new\n`;
  const check = async (p) => { const { d, out } = baseDeps(fx, []); const code = await run(['--run', fx.runDir, '--check-repair', p], d); return { code, out: out() }; };
  assert.strictEqual((await check(file('clean.md', `Hold: no\n\n${diff('docs/a.md')}`))).code, 0);
  const sensitive = await check(file('sensitive.md', diff('plugin/a.md')));
  assert.strictEqual(sensitive.code, 5);
  assert.match(sensitive.out, /reference-repair-held/);
  const test_ = await check(file('test.md', diff('tests/a.test.js')));
  assert.strictEqual(test_.code, 5);
  assert.match(test_.out, /reference-repair-held/);
  const none = await check(file('none.md', 'no diff'));
  assert.strictEqual(none.code, 5);
  assert.match(none.out, /reference-repair-unclassified/);
  const gone = await check(path.join(fx.runDir, 'absent.md'));
  assert.strictEqual(gone.code, 5);
  assert.match(gone.out, /reference-repair-unreadable/);
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'console.json')), 'writes no console');
});

test('#4636: --check-repair refuses the other shapes\' flags', () => {
  for (const extra of [['--policy', 'console-auto'], ['--dry-run'], ['--json'], ['--set-item', 'x', '--resolution', 'pending', '--reason', 'r']]) {
    assert.throws(() => parseArgs(['--run', 'd', '--check-repair', 'f', ...extra]), /--check-repair/);
  }
});
```

Match `baseDeps`'s real return shape when writing these (read it first; the `out()` accessor above is illustrative of "what the CLI wrote to stdout or stderr").

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/console/item-resolution.test.js tests/bin-lib/console/reference-repair-apply.test.js`
Expected: FAIL — the rewrite-table pin, and `#4636: the Reference repairs bullet applies from the staged diff` on `apply --check`.

- [ ] **Step 3: Implement**

`item-resolution.js`: `REWRITE_FROM = Object.freeze({ 'keep-staged': Object.freeze(['apply']), pending: Object.freeze(['approve']) })`. The header comment gains one sentence: a Reference-repairs `approve` whose staged diff no longer applies at Phase 4 goes to `pending` the same way (#4636).

`console-resolve.js`: `USAGE`'s second line reads `--resolution keep-staged|pending`, and a third line gives `--run <dir> --check-repair <file>`. The header comment names the `approve` → `pending` rewrite beside the existing one, and describes the third shape and its exits. `parseArgs` adds `--check-repair` to `valued` and refuses it beside `--policy`, `--dry-run`, `--json` or `--set-item`, with a message naming `--check-repair`. In `run`, after the anchoring check and before the ceiling check, a `checkRepair` function reads the file (a read failure is the `reference-repair-unreadable` exit 5), takes `sensitivePaths` from `readPolicy`, and calls `referenceRepairFloorReason`. It prints the verdict line to stdout in both cases.

`multispec-review-console.md`, three clauses and nothing else, under 500 B in all against its 965 B of headroom. `## On approval` step 6 reads: "Apply config updates (docs, CLAUDE.md, rules) and each approved Reference repairs row, per `wrap-up/execution-and-verification.md`'s Reference repairs bullet, `{item-run-dir}` the dir it came from". Step 1 gains, beside its `sdd-ruling-*` carve-out: "; a `wrap-up-reference-*` file is not applied here (step 6)". `## On override` step 2 gains: "; a Reference repairs row per step 6, its verbs per `wrap-up/review-console-interactive.md`".

`review-console-interactive.md`: after the `Low-confidence and Contested rows` paragraph, add one paragraph starting `**Reference repairs rows (#4636):**`. It says a row is applied only by `execution-and-verification.md`'s Reference repairs bullet, never by `On override`'s step 2 apply or a `_shared/staged-patch.md` re-derivation. It says `modify {#}` on such a row is refused with a one-line notice (`` #{#} is a reference repair — its diff is never hand-edited; reply `target {#} {new}` to recompose it ``), since what lands must be what was checked, and that `target {#} {new}` names the new target for the pointer, on a row with or without a diff: the diff is composed afresh by `reference-sweep.md` Step 4's recipe against the staged file's `Target:` file, and goes through that bullet's floor re-run. It says `skip {#}` is unchanged. `## On override` step 2 gains: "a Reference repairs row goes to Phase 4's `execution-and-verification.md` bullet instead, its verbs per the Reference repairs rows paragraph". The drills-individually bullet: "Two row kinds belong to it" becomes "Three row kinds belong to it", adding "(c) a no-diff Reference repairs row: the bullet's named target has to come from a human, so the same console stop asks one `AskUserQuestion` per such row, offering the candidates its staged body names, plus `Skip`; a skipped row is not applied". Its drill order gains this kind after the restructural rows. The qualifying-rows list above the options (line 36) gains the reason `no target`, as in `#18 — no target (reference repair)`.

`docs/plugin-structure.md` line 165: the command reads `--set-item <id> --resolution keep-staged|pending --reason <text>`, and the description reads "Post-execution item rewrite (#4170, #4636) — one stored item `apply` → `keep-staged` after its Queue write failed, or `approve` → `pending` after a reference repair's staged diff stopped applying". Add one line below it for `--run <dir> --check-repair <file>`: "Floor check on a composed reference repair (#4636) — prints `clear` or the reason; writes nothing; exit 0 clear, 2 malformed, 3 unanchored --run, 5 held, unclassified or unreadable".

`execution-and-verification.md`'s Reference repairs bullet: after the sentence ending "confirm them under Verify execution instead", replace "A staged repair approved here is an ordinary edit in this step's commit, not an initiative fix, and carries no trailer" with: a staged repair approved here is applied from its own staged file, so the edit that lands is the diff the resolver checked: `git -C "{worktree root}" apply --check "{staged path}"`, then `git -C "{worktree root}" apply "{staged path}"`, always the `-C` form, since from a subdirectory `git apply` skips a path outside it and still exits 0. Never re-derive the edit from `Target:` or `summary`, and never hand-edit. The result is an ordinary edit in this step's commit, not an initiative fix, and carries no trailer. Keep the trailer clause that follows. Then add, in order. On a row from an auto-resolved console (`console.json`'s `mode: auto-resolve`), first run `console-resolve.js --run "{item-run-dir}" --check-repair "{staged path}"`, so a staged file rewritten since the resolver read it (a resumed sweep) cannot land unchecked; its exit 5 applies nothing and runs the `--set-item` below with `--reason` the reason word it printed. When the check fails on a file holding a diff, apply nothing and run `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "{item-run-dir}" --set-item '{name}' --resolution pending --reason 'reference-repair-stale'`, `{item-run-dir}` being the directory whose `console.json` holds the row (a `spec-{N}` dir or the parent on a multi-spec run), so the row surfaces as residue for a human. The reason is that fixed literal, since git's stderr can carry a quote or `$` in a path; git's first stderr line goes to one `AUTO` via `log-decision.js --text-file` instead. A non-zero exit from that call means the rewrite may not stand: exit 5 is this CLI refusing, so the stored `approve` stands (a console it did not auto-resolve, a missing console, an id it cannot find, whether or not a human is present), and exit 3 is an unanchored `--run` or a failed write, where stderr says whether the rewrite landed before a `decisions.md` failure. On either, name the row and its staged path in the Phase 4 report as not applied and log one `SKIP` via `log-decision.js --text-file` naming the exit and stderr. A row the human gave a target (a no-diff repair's console-stop answer, or `target {#} {new}` on any row, `review-console-interactive.md`'s Reference repairs rows paragraph) composes its diff by `reference-sweep.md` Step 4's recipe against the staged file's `Target:` file into a session temp file with a `Hold: no` / `Target: {file}` header, leaving the staged file as it is; runs `console-resolve.js --run "{item-run-dir}" --check-repair "{temp file}"`; and on exit 0 runs the same `apply --check` then `apply` against the temp file. PENDING, plan review 2026-11-02: what a floor hit (exit 5) does here is an open question on the record; the next build states it in this sentence. A file holding no `diff --git` line with no target named (a console ticked on the PR, which cannot ask; an `unattended` run never reaches `approve` on one) applies nothing and takes the same not-applied report. Keep it one bullet: Step 1's test reads one line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/console/item-resolution.test.js tests/bin-lib/console/reference-repair-apply.test.js tests/bin-lib/console/cli.test.js tests/console-failed-execution-residue-conformance.test.js tests/wrap-up-verify-execution-pin.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/execution-and-verification.md plugin/skills/wrap-up/review-console-interactive.md plugin/skills/flow/multispec-review-console.md plugin/bin/lib/console/item-resolution.js plugin/bin/console-resolve.js docs/plugin-structure.md tests/bin-lib/console/item-resolution.test.js tests/bin-lib/console/reference-repair-apply.test.js tests/bin-lib/console/cli.test.js
git commit -m "Apply an approved reference repair from its staged diff and send a stale one back to pending — refs #4636"
```
