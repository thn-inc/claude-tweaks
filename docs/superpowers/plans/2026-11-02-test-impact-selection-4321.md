# Test-Impact Selection Firing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the common non-source paths forcing a full `tests` run, and record every impact outcome in `timing.json` so later fallbacks can be measured.

**Architecture:** `selectScope` names the paths that supersede a subset. `verify.js` carries a five-field impact outcome on the `verify` event, and `derivePhases` keeps it on the `timing.json` verify entry. Four impact rules join `.claude-tweaks/verify-scope.json`, so the traced map picks the tests for those paths.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T233957-record-4321/work/4321-spec.md`

## Global Constraints

- Keep `tools/test-impact/**` and `tools/run-tests.js` as deliberate full-run rules.
- The impact fields on the verify event and entry are present only when the declaration has an `impact` block.
- Every impact rule also carries `"suites": "*"` and `"static": true`: `tests/verify-scope-declaration.test.js` pins the legacy fallback.
- Quoted from `.claude/skills/verify-scope-rule-kind/SKILL.md` (this plan adds no rule kind, but commits rules the installed build reads): "Make the new shape also carry the value the old reader accepts (`"suites": "*"` for an impact rule: older readers run everything, current ones ignore it), pin that in `tests/verify-scope-declaration.test.js`".
- Quoted from the same skill: "Every unreadable or unprovable input falls back to the full command with a named reason."
- Quoted from `.claude/skills/windows-checkout-test-parity/SKILL.md`, for any fixture command: "Build the command with that file's `nodeCmd(script, ...args)`". The new tests reuse `impact-cli.test.js`'s committed `scripts/*.js` fixtures, so they spawn no `node -e` at all.
- `.claude/skills/skill-prose-conformance-tests/SKILL.md`'s `verify-scope.json` rule concerns `checks.tests.journeys` readers: no new test here reads `docs/journeys/`, so it does not apply. `parse-signal-discipline`'s and `test-impact-tracer-read-shape`'s hits name other modules, and neither the tracer nor its parser changes.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

**Decisions from the map (commit `f9dfd856`, 1040 tests), against Deliverable 2's open questions:**

- `.release-please-manifest.json`: a test reads it (`tests/bin-lib/residue/cli.test.js`, exact `f` entry), so the spec's "`suites: []` unless a test reads it" resolves to an impact rule.
- `.github/workflows/**`: traced by exact `f` reads (`tests/merge-verification.test.js` reads `test.yml`) and `d` listings, so it is an impact rule.
- `perf/**`: decided by the maintainer in the spec's `## Plan Review Decisions` (Reading B): an impact rule selecting only the tests that read `perf/`, with budgets left to the scheduled `test-perf.yml` workflow and no `perf` suite added. Tests do read `perf/`: `tests/wall-clock-budget-conformance.test.js` (`f`), `tests/package-json-test-script.test.js` and `tests/plan-citations-resolve.test.js` (`d`). No coverage is lost: today's superseded full run is `npm test`, which never runs `perf/` either.

Waived AC4.1: per the spec's `## Plan Review Decisions` (Reading B) the count covers only runs on a released build carrying Deliverable 1, so no build can test it; it stays open for `/claude-tweaks:wrap-up` through the ledger row in Task 2 Step 6, with Deliverable 3.
Waived AC4.2: same reason as AC4.1.

Round-2 decision (Reading A): a verify run that never reads the declaration (no `--scope`, or `--stamp-suite`) writes no `impact` field and is outside the AC4 count, not a fallback. Deliverable 1 is unchanged for those runs: the field is already absent whenever `sel.impact` is. The Task 2 Step 6 ledger row filters on the field.

Round-3 decisions (Reading A): only a `tests` entry with `impact.fallback: null`, `impact.superseded: false` and `impact.selected >= 1` is an AC4 impact subset; `selected: 0` is not, and the Task 2 Step 6 ledger row says so. `supersedingPaths` keeps array-rule files that name the impact suite, as Task 1 Step 5 has it.

## Review Focus

1. A rule selecting only another suite (`docs/**` → `['docs']`) beside an unmatched path: it must stay out of `supersedingPaths`, or the measurement blames the wrong rule. Task 1 Step 1 pins it.
2. A non-impact rule that names the impact suite in an array (not `"*"`): it supersedes too, so its file must be listed, or a superseded entry reads with no paths. Task 1 Step 1 pins it.
3. `.claude-tweaks/verify-scope.json` under the new `.claude/**` glob: it must stay unmatched, or a change to the declaration itself stops failing closed. Task 2 Step 1 pins it.
4. A list-file problem that re-runs selection after the first answer: the event must carry the second answer's fallback. Task 1 Step 3 pins it.
5. An unanchored run (`no-anchor`), which returns early from `selectScope`: its reason must still reach the entry. Task 1 Step 3 pins it.

---

### Task 1: Carry the impact outcome into `timing.json`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/verify/scope.js` (`impactResult`, `selectScope`)
- Modify: `plugin/bin/verify.js` (the `appendEvent(target.dir, 'verify', …)` call)
- Modify: `plugin/bin/lib/timing/derive.js` (the `best.row.verify.push` entry)
- Modify: `plugin/skills/test/impact-selection.md` (the Report section; 10 KB, far under the 52,500 B rail)
- Modify: `docs/journeys/read-where-a-pipeline-run-spent-its-minutes-1928.md`, `docs/journeys/verify-only-the-tests-a-change-can-affect-4024.md`
- Test: `tests/bin-lib/verify/scope.test.js`, `tests/bin-lib/timing/derive.test.js`, `tests/bin-lib/verify/impact-cli.test.js`

**Interfaces:**
- Produces: `impactResult` gains `supersedingPaths: string[]`, always present, `[]` unless superseded. Verify event and timing entry field `impact: { suite, fallback, superseded, selected, supersedingPaths }`, absent when `sel.impact` is absent.

- [ ] **Step 1: Write the failing scope tests in `tests/bin-lib/verify/scope.test.js`**

Add `supersedingPaths: []` to the `FULL_RUN` constant and to the three literal shapes at lines 150, 233 and 242. (`git grep -n "changedTests: \[" tests` shows these are the only whole-shape asserts on a `selectScope` result; `tests/bin-lib/verify/impact.test.js`'s hits assert `selectImpactTests`, which does not change.) Replace the four `SUPERSEDED` asserts with their paths:

```js
assert.deepStrictEqual(r.impact, { ...SUPERSEDED, supersedingPaths: ['unknown/path.txt'] }); // line 202
assert.deepStrictEqual(r.impact, { ...SUPERSEDED, supersedingPaths: ['shared/k.js'] });      // line 209
assert.deepStrictEqual(r.impact, { ...SUPERSEDED, supersedingPaths: ['lib/k.js'] });         // lines 213, 216
```

Add:

```js
test('supersedingPaths names unmatched and suite-selecting files only (#4321)', () => {
  const files = ['docs/a.md', 'lib/k.js', 'shared/k.js', 'src/x.js', 'unknown/path.txt'];
  const r = isel(files, Object.fromEntries(files.map((f) => [f, 'M'])));
  assert.strictEqual(r.impact.superseded, true);
  assert.deepStrictEqual(r.impact.supersedingPaths, ['lib/k.js', 'shared/k.js', 'unknown/path.txt']);
});

test('a rule selecting only another suite supersedes nothing (#4321)', () => {
  const r = isel(['docs/a.md'], { 'docs/a.md': 'M' });
  assert.strictEqual(r.impact.superseded, false);
  assert.deepStrictEqual(r.impact.supersedingPaths, []);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/verify/scope.test.js`
Expected: FAIL (`supersedingPaths` is missing from the actual shape).

- [ ] **Step 3: Write the failing timing and CLI tests**

In `tests/bin-lib/timing/derive.test.js`:

```js
test('a verify row keeps the impact outcome only when the event carries one (#4321)', () => {
  const impact = { suite: 'tests', fallback: 'map-missing', superseded: false, selected: null, supersedingPaths: [] };
  const events = fixtureEvents().map((e) => (e.type === 'verify' && e.mode === 'full' ? { ...e, impact } : e));
  const p = byName(derivePhases({ events, manifest: fixtureManifest(), now: new Date('2026-09-05T14:13:00.000Z') }));
  assert.deepEqual(p.test.verify[0].impact, impact);
  assert.equal(Object.hasOwn(p.tasks.verify[0], 'impact'), false);
});
```

In `tests/bin-lib/verify/impact-cli.test.js`, add two helpers. `requires derivePhases from plugin/bin/lib/timing/derive.js`.

- `runDirOf(r)`: creates `{repo}/.claude-tweaks/pipelines/2026-11-02T000000-record-1` and appends `.claude-tweaks/pipelines/\n` to `{gitDir}/info/exclude`, so the run dir never reads as a changed path under the `.claude-tweaks/**` fixture rule. Create `info/` with `{ recursive: true }` first.
- `timingEntry(runDir)`: reads `events.jsonl` (the real writer's output), prepends `{ type: 'skill_invoked', skill: 'claude-tweaks:test', ts: '2000-01-01T00:00:00.000Z' }`, runs `derivePhases({ events, now: new Date(Date.now() + 60000) })`, and returns that output's `phases.find((p) => p.phase === 'test').verify[0]`.

Tests, each running `runCli([...ARGS, '--run', runDir], r.repo)` unless stated:

```js
test('AC1.1 AC1.2: a subset run records its selected count in the timing entry (#4321)', …
  // writeMap(r); commitFile(r, 'src/x.js', 'x2\n');
  assert.deepStrictEqual(timingEntry(runDir).impact, { suite: 'tests', fallback: null, superseded: false, selected: 1, supersedingPaths: [] });

test('AC1.1 AC1.2: a fallback records its reason in the timing entry (#4321)', …
  // no map; commitFile(r, 'src/x.js', 'x2\n');
  assert.deepStrictEqual(timingEntry(runDir).impact, { suite: 'tests', fallback: 'map-missing', superseded: false, selected: null, supersedingPaths: [] });

test('AC1.1 AC1.2: a superseded run records its paths in the timing entry (#4321)', …
  // writeMap(r); commit scripts/extra.js (a "*" rule) and notes/u.txt (no rule; create notes/ first)
  assert.deepStrictEqual(timingEntry(runDir).impact, { suite: 'tests', fallback: null, superseded: true, selected: null, supersedingPaths: ['notes/u.txt', 'scripts/extra.js'] });

test('an unanchored run records no-anchor in the timing entry (#4321)', …
  // the args of the existing "no stamp and an explicit --base" test, plus --run
  assert.strictEqual(timingEntry(runDir).impact.fallback, 'no-anchor');

test('a list-file problem records the re-selected fallback in the timing entry (#4321)', { skip: process.platform === 'win32' }, …
  // the fixture of the existing "a selected test path holding a line break" test, plus --run
  assert.match(timingEntry(runDir).impact.fallback, /^files-list-unwritable: /);

test('no impact block leaves the impact field off the event and the timing entry (#4321)', …
  // the decl of the existing "no impact block" test, with --run on its second run
  assert.strictEqual(Object.hasOwn(timingEntry(runDir), 'impact'), false);
```

`git diff --name-only` output is sorted, so `supersedingPaths` above is in that order.

- [ ] **Step 4: Run them to verify they fail**

Run: `node --test tests/bin-lib/timing/derive.test.js tests/bin-lib/verify/impact-cli.test.js`
Expected: FAIL (`impact` is undefined on the entry), except the last test, which passes today and goes red only if the field leaks.

- [ ] **Step 5: Implement**

`scope.js`:
- `impactResult` defaults gain `supersedingPaths: []`.
- `selectScope` collects `const supersedingPaths = []`. Push the file in the unmatched branch, in `rule.suites === '*'` on a non-impact rule, and on an array rule when `decl.impact && rule.suites.includes(decl.impact.suite)`. An impact rule's legacy `"*"` never reaches these branches.
- The superseded result becomes `impactResult(suite, { superseded: true, supersedingPaths })`.

`verify.js`: add to the event, after `reportPath`:

```js
...(sel && sel.impact ? { impact: {
  suite: sel.impact.suite, fallback: sel.impact.fallback, superseded: sel.impact.superseded,
  selected: sel.impact.selected, supersedingPaths: sel.impact.supersedingPaths,
} } : {}),
```

`derive.js`: the pushed entry gains `...(v.impact ? { impact: v.impact } : {})`, with the comment's reason (#4321: why an impact run ran full, measured across runs).

`impact-selection.md`, Report section: add `supersedingPaths` to the `scope.impact` field list and state "the files that superseded the subset: unmatched paths and files a non-impact rule sends to the suite; `[]` otherwise". Add one sentence: "The `verify` event, and through it `timing.json`'s verify entry, carries `impact: {suite, fallback, superseded, selected, supersedingPaths}`, so the outcome outlives `report.json`, which each run overwrites."

Journeys: in `read-where-…-1928.md`'s Should understand for the `verify` event, add the same `impact` fact, present only under an impact declaration. In `verify-only-…-4024.md`'s Step 4 Should understand, add that `timing.json` keeps the reason, the superseded flag, the selected count and the superseding paths after the worktree is reaped. Add an Origin line: `Updated during the build of #4321`.

- [ ] **Step 6: Run the suites to verify they pass**

Run: `node --test tests/bin-lib/verify/scope.test.js tests/bin-lib/timing/derive.test.js tests/bin-lib/verify/impact-cli.test.js tests/timing-prose-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

Stage the eight files above by explicit path. Message: `Carry the impact outcome into timing.json — refs #4321`, ending with the `Claude-Session:` trailer the brief gives.

### Task 2: Add the impact rules for the common superseding paths

**Role:** integration

**Files:**
- Modify: `.claude-tweaks/verify-scope.json`
- Test: `tests/verify-scope-declaration.test.js`
- Modify: `docs/plans/2026-11-02-test-impact-selection-ledger.md` (Step 6)

**Interfaces:**
- Consumes: nothing from Task 1 in code. Step 5's replay reads `.impact.superseded`, which already exists.

- [ ] **Step 1: Write the failing declaration tests**

In `tests/verify-scope-declaration.test.js`, in the test at line 77, change the fail-closed list and its comment so it keeps pinning fail-closed on names no rule covers. `.claude-tweaks/verify-scope.json` stays in it: it proves `.claude/**` does not reach `.claude-tweaks/`:

```js
// No catch-all: a path no rule names (package.json, .gitignore) fails closed to full.
for (const p of ['package.json', '.gitignore', '.claude-tweaks/verify-scope.json']) {
```

Add:

```js
test('the common superseding paths are impact rules, never a full run (#4321)', () => {
  const { decl } = readDeclaration(DECL);
  for (const m of ['.claude/**', '.github/workflows/**', 'perf/**', '.release-please-manifest.json']) {
    const rule = decl.rules.find((x) => x.match === m);
    assert.ok(rule && rule.impact === true, `${m} must be an impact rule`);
    assert.strictEqual(rule.static, true, `${m} keeps the static checks`);
  }
});

test('AC3.1: a project-skill-only delta is impact-selected, not superseded (#4321)', () => {
  const { decl } = readDeclaration(DECL);
  const parsed = parseImpactMap(JSON.stringify(encodeImpactMap({
    commit: 'b'.repeat(40), tracedAt: '2026-11-02T00:00:00Z', exitCode: 0, node: 'v20.0.0',
    tests: { 'tests/a.test.js': { f: ['.claude/skills/x/SKILL.md'] }, 'tests/b.test.js': { f: ['plugin/bin/verify.js'] } },
  })));
  const ctx = { map: parsed.map, problem: null, headTests: ['tests/a.test.js', 'tests/b.test.js'] };
  const sel = selectScope({ decl, files: ['.claude/skills/x/SKILL.md'], stamp: STAMP, statuses: { '.claude/skills/x/SKILL.md': 'M' }, impact: ctx });
  assert.strictEqual(sel.mode, 'scoped');
  assert.deepStrictEqual(sel.unmatched, []);
  assert.strictEqual(sel.impact.superseded, false);
  assert.deepStrictEqual(sel.impact.files, ['tests/a.test.js']);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/verify-scope-declaration.test.js`
Expected: FAIL (`.claude/** must be an impact rule`).

- [ ] **Step 3: Add the rules**

Insert directly above the `docs/journeys/**` rule, each as `{ "match": "<glob>", "impact": true, "suites": "*", "static": true }`: `.claude/**`, `.github/workflows/**`, `perf/**`, `.release-please-manifest.json`.

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test tests/verify-scope-declaration.test.js`
Expected: PASS, including the `AC2.1` release-reader and `#4024 expand-contract` tests.

- [ ] **Step 5: Replay the 59 PRs (AC2.1)**

The script and input are scratch, already written, and uncommitted. Run from the worktree root, with the full output going to the evidence log:

```bash
mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T233957-record-4321/evidence"
```

```bash
node "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-dispatch-record-4593/5799247f-6f2c-45e0-9656-5044fb4c1207/scratchpad/replay-4321.js" "$PWD" "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-dispatch-record-4593/5799247f-6f2c-45e0-9656-5044fb4c1207/scratchpad/prs-4321.json" "$PWD/.claude-tweaks/verify-scope.json" > "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T233957-record-4321/evidence/replay-59-prs.txt"
```

Expected: `"prs": 59`, `"supersededByUnmatched"` at most 5. On the rules before Step 3 the same command printed 37 superseded, 35 by unmatched, 20 eligible, 2 with no impact paths, which matches the record's figures.

Write one `AC evidence` line naming AC2, the command shape and the counts to a session temp file, then log it with `log-decision.js --run {run-dir} --section "/build" --status AUTO --step "AC evidence" --text-file {file}`, citing `evidence/replay-59-prs.txt`.

- [ ] **Step 6: Commit, with the deferred re-measure on the ledger**

Append to the ledger table as the next row number (rows 1 to 4 are flow's pre-flight notes from the two runs, so this is row 5). The version is unknown until release-please cuts it, so the row names the release by what it must contain. Per the spec's round-2 decision (Reading A), the count filters on the `impact` field: an entry without it (no `--scope`, or `--stamp-suite`) is outside the count and is not a fallback. Per the round-3 decision (Reading A), only a `tests` entry with `impact.fallback: null`, `impact.superseded: false` and `impact.selected >= 1` counts as an impact subset; `selected: 0` does not:

`| 5 | ops | Re-measure impact outcomes across 10 or more pipeline runs on a released build carrying Deliverable 1, from timing.json verify entries that carry an impact field (AC4, Deliverable 3; entries with no impact field are outside the count, not fallbacks); AC4 holds only if a tests entry has impact.fallback null, impact.superseded false and impact.selected >= 1 (selected 0 does not count); otherwise fix or file the dominant fallback with counts. (reason-not-auto: requires pipeline runs on a released build) | open | Defer-reason: blocked-dependency — needs the first v* release containing PR #4969's Deliverable 1, then 10 or more pipeline runs on it |`

Stage `.claude-tweaks/verify-scope.json`, `tests/verify-scope-declaration.test.js` and the ledger by explicit path. Message: `Add impact rules for the common superseding paths — refs #4321`, with the `Claude-Session:` trailer.

## Controller checks after the tasks

- **AC3.1 live:** in a scratch clone under the session scratchpad whose `main` is this branch's tip, with this repo's map copied into its `.git/`, commit a one-line edit to a `.claude/skills/*/SKILL.md` on a feature branch and run `node plugin/bin/verify.js --scope .claude-tweaks/verify-scope.json --integration-branch main --no-stamp`. Expected: an `Impact: N of M test file(s) selected` line, or a named fallback, never `superseded`. Keep the output at `evidence/ac3-live.txt` and log an `AC evidence` line.
- **Real input (Task 1):** after Common Step 5's verify, run `node plugin/bin/phase-timing.js` over this run's directory and confirm its own `timing.json` verify entry carries `impact`, compared with `events.jsonl`'s `verify` line (the independent count).
