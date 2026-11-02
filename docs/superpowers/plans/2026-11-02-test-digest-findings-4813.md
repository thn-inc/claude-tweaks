# Settle 15 Digest Findings in Tests (#4813) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every one of #4813's 15 test-hygiene findings: temp-dir leaks, loose or misleading assertions, misnamed fixtures, a missing behavioral pin, a too-narrow matcher, and a slow spawn-per-call suite.

**Architecture:** Test-only changes, one task per finding family. No production module changes. `plugin/bin/lib/hooks/pre-tool-use.js` is read only: its `DELETE_ONLY_PUSH_ALLOWLIST` (line ~389) is the code under the new pin.

**Tech Stack:** Node 18+ `node --test`, `node:assert`, real git fixtures under `os.tmpdir()`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T042606-record-4813/work/4813-spec.md`

## Global Constraints

- Node floor 18; CI runs Node 20. For cleanup use `node:test`'s module-level `after` (already used by `tests/resolve-policy-control-mode.test.js`) or a `try/finally` where the file already uses that style.
- Scope (CLAUDE.md Working Approach, quoted): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- `.claude/skills/bin-source-scan-conformance` (quoted): "Changing an existing scan's matcher | Add the planted case that motivated the change to its self-test first, and watch it fail against the old code".
- `.claude/skills/windows-checkout-test-parity` (quoted): "It never works for a command the gate admits by whole-command allowlist: `pre-tool-use.js`'s `CQ_DOUBLE` refuses any `\`, so `git -C "D:\a\…" push origin --delete x` never matched `DELETE_ONLY_PUSH_ALLOWLIST` and was denied on win32 only (#4385)."
- `.claude/skills/parse-signal-discipline/fix-shape-late-items.md` (quoted): "Pin each hiding place with its own case (`tests/bin-lib/issues/accept-verdict.test.js`: a block that does not own its line, fence text before the block, and a note holding `-->`)."
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #4813`. Never `closes`/`fixes`.
- Waived `plugin/bin/lib/hooks/pre-tool-use.js`: read only. Task 4 pins its existing allowlist, and the finding is a missing test, not a source defect.
- Waived AC2.1: already satisfied. 15 lines across #1426's comments carry `→ #4813` (`gh api repos/thn-inc/claude-tweaks/issues/1426/comments --paginate` count, 2026-11-02).

## Review Focus

1. A cleanup hook removing a fixture a later test in the same file still uses. Removal must run after all tests (`after`) or after the owning test only (`finally`), never between tests that share a fixture.
2. Windows: Task 4's double-quoted `-C` case must skip on win32 with a stated reason (a native path holds `\`, which `CQ_DOUBLE` refuses by design). Without the skip it fails on Windows only.
3. The in-process `json()` helper (Task 5) diverging from the CLI: dropped `undefined` fields, CRLF input, block keys. The parity test in Task 5 pins this.
4. The widened DEMO_ matcher (Task 3) flagging a real non-label constant. The whole-tree walk must stay green, and `DEMO_CREDENTIAL_RE`/`DEMO_ACCOUNT` stay excluded.
5. `fs.rmSync` on a git fixture with read-only object files. Always pass `{ recursive: true, force: true }`.

---

### Task 1: Remove leaked os.tmpdir() fixture roots (Deliverables 2, 4, 5, 11, 15)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tests/bin-lib/flow/artifact-overwrite-check.test.js` (`repo()` at :38)
- Modify: `tests/bin-lib/claim-targets/claim-targets.test.js` (mkdtemp sites at :1066, :1840, :1866, :1878)
- Modify: `tests/bin-lib/wrap-up/engine-verify.test.js` (`acceptanceLabelingRow` at :1655)
- Modify: `tests/bin-lib/issues/claims-git-cas.test.js` (`makeBareOriginAndClone` :89, `makeBranchlessOriginAndClone` :513)

**Interfaces:** none produced.

- [ ] **Step 1: Measure the leak before the change**

Measure each suite against its own fresh, empty temp root, so sibling sessions sharing `os.tmpdir()` cannot move the count (Node's `os.tmpdir()` honours `TMPDIR`). For each suite: `mkdir` an empty scratch dir `{S}`, run `TMPDIR="{S}" node --test {suite}`, then `ls "{S}"`. Count only the in-scope prefixes:
- `artifact-overwrite-check.test.js`: `ct-artifact-overwrite-`
- `claim-targets.test.js`: `ct-claim-log-resume-`, `ct-claim-log-anchored-`, `ct-claim-log-unanchored-`
- `claims-git-cas.test.js`: `claims-git-cas-`
- `engine-verify.test.js`: only the seven prefixes `acceptanceLabelingRow` is passed (`verify-acceptance-accept-pass-`, `verify-acceptance-mixed-pass-`, `-mixed-pass2-`, `-mixed-pass3-`, `-mixed-pass4-`, `verify-acceptance-outranked-`, `verify-acceptance-nopending-`). Other `verify-acceptance-*` and `verify-clean-reporoot-` leaks in that file belong to other tests and are out of D5's scope. `acceptanceLabelingRow`'s own `repoRoot` is checked by code review of Step 4 instead.
Expected: each in-scope prefix appears at least once.

- [ ] **Step 2: artifact-overwrite-check — register every `repo()` dir**

Import `after` from `node:test` beside `test`. Keep a module-level `const fixtureDirs = []`, push `dir` inside `repo()`, and `after(() => { for (const d of fixtureDirs) fs.rmSync(d, { recursive: true, force: true }); })`.

- [ ] **Step 3: claim-targets — register the four mkdtemp roots**

Same pattern: import `after`, a module-level `tmpRoots` array, and push each of the four mkdtemp results (`root` at :1066 and :1840, `runDir` at :1866 and :1878). One `after` removes them all.

- [ ] **Step 4: engine-verify — clean up inside `acceptanceLabelingRow`**

Wrap the body after `makeTmpDir(dirPrefix)` in `try { … } finally { fs.rmSync(runDir, …); fs.rmSync(repoRoot, …); }`. Hoist `makeNativeRepoRoot()` into a `const repoRoot` before the `try` so `finally` can remove it. Return value unchanged. This matches the file's own `try/finally` style.

- [ ] **Step 5: claims-git-cas — register both helpers' roots**

Import `after`, a module-level `fixtureRoots` array, and push `root` in both `makeBareOriginAndClone` and `makeBranchlessOriginAndClone`. One `after` removes them. The return shapes stay the same.

- [ ] **Step 6: Verify no leak and green suites**

Re-run Step 1's per-suite measurement, each against a fresh empty `{S}`.
Expected: all four suites pass, and no in-scope prefix remains in any `{S}`.

- [ ] **Step 7: Commit**

`git add` the four files; message `Remove leaked tmp fixture roots in four test suites — artifact-overwrite, claim-targets, engine-verify, claims-git-cas (refs #4813)`.

### Task 2: Pin the accept-verdict second-close case to its real reason (Deliverables 3, 14)

**Role:** transcription

**Files:**
- Modify: `tests/bin-lib/issues/accept-verdict.test.js` (:166-180)

**Interfaces:** none.

- [ ] **Step 1: Move the row into its own test with an exact reason**

Remove the row `['a second close on the line', \`${good} -->\`, /raw|malformed/]` from `AC4.1: a block must own its line, …`. Add a new test right after it:

```js
// MARKER_LINE's greedy capture takes the first ` -->` into the JSON, so the
// line still matches and the raw-bracket rule is what rejects it.
test('AC4.1: a second close on the marker line is caught by the raw-bracket rule', () => {
  assertRejected(parseOwner(`${good} -->`), /^raw < or > in verdict JSON$/, 'a second close on the line');
});
```

- [ ] **Step 2: Run and confirm pass**

Run: `node --test tests/bin-lib/issues/accept-verdict.test.js`
Expected: PASS.

- [ ] **Step 3: Go-red check (scratch, not committed)**

Temporarily change `/[<>]/` in `plugin/bin/lib/issues/accept-verdict.js` (the raw-bracket line, ~:144) to `/[<]/`, then re-run. The new test must FAIL. Revert with `git checkout -- plugin/bin/lib/issues/accept-verdict.js` and confirm `git diff --stat` shows only the test file.

- [ ] **Step 4: Commit**

`Pin the accept-verdict second-close case to the raw-bracket reason — the greedy capture, not line ownership, rejects it (refs #4813)`.

### Task 3: Widen the DEMO_ reader-walk matcher (Deliverable 6)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tests/accept-label-reader-conformance.test.js` (`DEMO_MATCH_RE` :159, `demoLabelUse` :208, self-tests :243-249 and :319-329)

**Interfaces:** none.

- [ ] **Step 1: Add planted self-test rows first**

In `guard self-test: a copy-only module gains a reader …` add:
`assert.deepEqual(copyOnlyViolations(copyLine + '\nconst b = DEMO_PENDING_BATCH;', copy), [{ line: 2, text: 'DEMO_PENDING_BATCH' }]);`
In `guard self-test: the reader walk names a planted mis-parse …` add:
`assert.equal(demoLabelUse('const DEMO_PENDING_BATCH = 1;'), 'DEMO_PENDING_BATCH');`
`assert.equal(demoLabelUse('const n = LABELS.DEMO_LABEL_BATCH;'), 'DEMO_LABEL_BATCH');`
Keep the existing `DEMO_CREDENTIAL_RE`/`DEMO_ACCOUNT` → `null` row.

- [ ] **Step 2: Run to verify the new rows fail**

Run: `node --test tests/accept-label-reader-conformance.test.js`
Expected: FAIL after Step 1, on the new rows (the closed list's `\b` stops `DEMO_PENDING` matching inside `DEMO_PENDING_BATCH`).

- [ ] **Step 3: One shared matcher**

Define one source, `const DEMO_LABEL_SOURCE = String.raw\`\bDEMO_(?!CREDENTIAL_RE\b|ACCOUNT\b)[A-Z0-9_]+\b|\bdemo:\``. Build `DEMO_MATCH_RE = new RegExp(DEMO_LABEL_SOURCE, 'g')` and have `demoLabelUse` use `new RegExp(DEMO_LABEL_SOURCE).exec(src)`. Update `demoLabelUse`'s comment: any `DEMO_*` identifier counts except the two named non-label constants, so a new label-shaped name such as `DEMO_PENDING_BATCH` must be classified.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/accept-label-reader-conformance.test.js`
Expected: PASS, including the whole-tree walk (`plugin/bin` names only `DEMO_PENDING`, `DEMO_APPROVED`, `DEMO_CHANGES_REQUESTED`, `DEMO_CREDENTIAL_RE` and `DEMO_ACCOUNT` today).

- [ ] **Step 5: Commit**

`Widen the DEMO_ reader-walk matcher past its closed list — a DEMO_*_BATCH name now needs classifying (refs #4813)`.

### Task 4: Behavioral pin for the double-quoted `git -C "<repo>"` delete push (Deliverable 7)

**Role:** transcription
**Review risk:** high

**Files:**
- Modify: `tests/hooks-policy-exemption.test.js` (after the #3900 test at :188-193)

**Interfaces:** none.

- [ ] **Step 1: Add the test**

```js
test('#3900 AC1.1: git -C "<repo>" (double-quoted) push origin --delete feature-x from a non-isolated checkout is allowed',
  { skip: process.platform === 'win32' && 'win32: a native path holds backslashes, which CQ_DOUBLE refuses by design (#4385)' },
  () => {
    const repo = gitRepoWithCommit();
    withPolicy(repo, 'worktree-always: true\n');
    assert.ok(!/["$`\\]/.test(repo), `fixture path must be double-quote-safe: ${repo}`);
    const out = pre.run({ input: bashInput(`git -C "${repo}" push origin --delete feature-x`, repo), runDir: null, runState: null, cwd: repo });
    assertAllowed(out);
  });
```

- [ ] **Step 2: Run and confirm pass**

Run: `node --test tests/hooks-policy-exemption.test.js`
Expected: PASS.

- [ ] **Step 3: Go-red check (scratch, not committed)**

Temporarily remove the double-quoted alternative from `CQ_ARG` in `plugin/bin/lib/hooks/pre-tool-use.js` (or replace `CQ_DOUBLE` with a never-matching pattern), re-run, and confirm the new test FAILS while the single-quoted #3900 test still passes. Revert with `git checkout -- plugin/bin/lib/hooks/pre-tool-use.js` and confirm `git diff --stat` shows only the test file.

- [ ] **Step 4: Commit**

`Pin the double-quoted git -C delete push through pre.run — regex-only pins could not catch a gate-path regression (refs #4813)`.

### Task 5: Run resolve-policy-control-mode's JSON checks in-process (Deliverable 12)

**Role:** integration

**Files:**
- Modify: `tests/resolve-policy-control-mode.test.js` (header :1-7, `json()` :44-48)

**Interfaces:**
- Produces: `json(policy, ...keys)`, same signature and return shape as today, now in-process. `cliJson(policy, ...keys)` is the old spawned form, kept only for the parity test.

- [ ] **Step 1: Time the suite before the change**

Run: `node --test tests/resolve-policy-control-mode.test.js` and note the `# duration_ms` line (≈19000 ms on 2026-11-02).

- [ ] **Step 2: Rename the spawned helper and add the in-process one**

Rename the current `json` to `cliJson` (unchanged body). Add:
`function json(policy, ...keys) { return JSON.parse(JSON.stringify(resolvePolicyKeys(keys, { policyRaw: policy === undefined ? null : policy, runConfigRaw: null }))); }`
The JSON round-trip mirrors the CLI's `JSON.stringify(result)`. It is what drops an `undefined` `value`, which the release-hook test's `{ source: 'policy' }` expectation relies on. `values()` and every direct `spawnSync` case stay on the CLI, because they pin its stdout/stderr contract.

- [ ] **Step 3: Add the parity test**

```js
test('the in-process json() helper matches the CLI JSON output', () => {
  const cases = [
    [undefined, 'control-mode', 'owned-owners'],
    ['control-mode: maybe\n', 'control-mode'],
    ['release-hook: ""\n', 'release-hook'],
    ['deploy-command: "never closed\n', 'deploy-command'],
    ['risk-path-globs:\r\n  auth: [src/auth/**]\r\nautonomy: trusted\r\n', 'risk-path-globs', 'autonomy'],
    ['risk-categories: data-export,pii\n', 'risk-categories'],
  ];
  for (const [policy, ...keys] of cases) {
    assert.deepStrictEqual(json(policy, ...keys), cliJson(policy, ...keys), `${JSON.stringify(policy)} ${keys.join(',')}`);
  }
});
```

- [ ] **Step 4: Update the header comment**

Say that JSON-shape checks run `resolvePolicyKeys` in-process (pinned equal to the CLI by the parity test), while `--values` output, stderr warnings and invocation errors still spawn the CLI in a throwaway repo under `os.tmpdir()`.

- [ ] **Step 5: Run and compare timing**

Run: `node --test tests/resolve-policy-control-mode.test.js`
Expected: PASS, with 59 tests and a `# duration_ms` well below Step 1's.

- [ ] **Step 6: Commit**

`Run resolve-policy-control-mode's JSON checks in-process — CLI spawns kept for --values/stderr, a parity test pins equality (refs #4813)`.

### Task 6: Clarity fixes in four suites (Deliverables 1, 8, 9, 10, 13)

**Role:** transcription

**Files:**
- Modify: `tests/bin-lib/flow/pr-early-open.test.js` (:215 test name; comment above :802)
- Modify: `tests/bin-lib/dispatch/dispatch-resume-cli.test.js` (:79, :97, :337)
- Modify: `tests/bin-lib/run-liveness/probes.test.js` (:182-196)
- Modify: `tests/acceptance-scan-server-filter.test.js` (:206-227)

**Interfaces:** none.

- [ ] **Step 1: pr-early-open — test name (D1) and the #4554 scope comment (D9)**

Rename the :215 test to `'AC2.1: a reused PR whose body already names this run, or names no run at all, gets no gh pr edit, on either reuse path'`. Above the `CLI: a gh timeout exits 1 …(#4554)` test, add exactly:

```js
// cliDeps stubs ghAvailable, so this pins only the CLI's error routing (the timeout
// hint, never the gh-absent message). The probe's own rule that a timed-out
// `gh --version` means present is pinned by tests/bin-lib/repo-resolve.test.js's
// ghAvailable cases (#4554).
```

- [ ] **Step 2: dispatch-resume-cli — rename the fixture key (D8)**

Rename the `makeEnv` config key `gitAvailable` to `ghAvailable` at all three sites (:79 default, :97 `ghAvailable: () => cfg.ghAvailable`, :337 `makeEnv({ ghAvailable: false })`).

- [ ] **Step 3: probes — make the read-count coupling explicit (D10)**

Keep the spy. Add exactly this comment above `const realRead = fs.readFileSync;`:

```js
  // Pins that ownEventAt takes both answers from one snapshot of events.jsonl (#4560's
  // double-read fix). The spy counts fs.readFileSync calls, so a change to readEventLines'
  // I/O primitive turns the count to 0 and fails loud rather than passing silently.
```

Give the final assertion the message `'ownEventAt must answer both fields from one read of events.jsonl (#4560); 0 reads means readEventLines stopped using fs.readFileSync — re-point this spy, do not drop the check'`.

- [ ] **Step 4: acceptance-scan-server-filter — drop the loop-syntax regex pin (D13)**

In `searched fetches warn at the search ceiling, per date slice`, delete the second `assertClaimPinned` (the `/for \(const \[\w+, (\w+)\] of slices\) …/` pattern) and its whole three-line comment (:213-215). Put exactly this comment in their place:

```js
  // The per-slice comparison is pinned by behaviour in "the extracted closed-record fence warns
  // per slice at the cap, naming the slice that reached it". The whole-fetch `raw.length >= CAP`
  // test is gone: a comparison over the combined rows cannot tell which slice is full.
```

Keep the `CAP` pin and both `raw.length` absence checks.

- [ ] **Step 5: Run the four suites**

Run: `node --test tests/bin-lib/flow/pr-early-open.test.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/run-liveness/probes.test.js tests/acceptance-scan-server-filter.test.js`
Expected: PASS. `grep -n gitAvailable tests/bin-lib/dispatch/dispatch-resume-cli.test.js` prints nothing.

- [ ] **Step 6: Commit**

`Clarify four test suites — pr-early-open naming and #4554 scope, ghAvailable fixture key, probes read-count rationale, drop a loop-syntax pin (refs #4813)`.

---

## Controller follow-up (not a dispatched task)

After the whole-branch review, post one disposition comment on #4813. Tabulate each of the 15 Deliverables with its fix commit, so AC1.1's "closed out with its reason recorded on this record" has its record. Deliverables 9, 10 and 13 settle as explicit scope/rationale changes rather than new behavior, and the comment says so.

## Spec coverage map

| Clause | Covered by |
|---|---|
| AC1.1 Each deliverable is fixed, or closed out with its reason recorded on this record | Tasks 1-6 (each Deliverable mapped in its heading) plus the Controller follow-up |
| AC2.1 Each promoted entry line in #1426 carries this record's ref | Waived above (already satisfied, counted) |
