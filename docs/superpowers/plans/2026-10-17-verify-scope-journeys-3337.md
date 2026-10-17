# verify-scope.json: map docs/journeys/** to the journey suites (#3337) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A delta of only `docs/journeys/**` stops classifying as `unmatched (fail-closed)` and re-verifies with only the test files that read journey files, instead of the full ~11,340-test suite.

**Architecture:** `.claude-tweaks/verify-scope.json` switches `checks.tests` from a single command string to a suite map — `tests` (unchanged `npm test`) plus a new `journeys` suite whose command runs exactly the seven test files that read the live `docs/journeys/` tree. A new rule maps `docs/journeys/**` to `["journeys"]` with `static: false`. The declaration's own pin test (`tests/verify-scope-declaration.test.js`) is updated from "one suite, every rule `*` or `[]`" to the new two-suite shape and gains a journey-delta classification test. No engine code changes: `plugin/bin/lib/verify/declaration.js` already accepts a suite map (`checks.tests` as an object, lines 57-64) and `scope.js` already selects a named subset.

**Tech Stack:** JSON declaration, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T075913-spec-3337/work/3337-spec.md` (materialized from GitHub issue #3337)

## Global Constraints

- The `docs/journeys/**` rule maps to the journey suite only — never `"*"`, never `[]` (spec Deliverable 1; `[]` would map a source-of-truth tree to nothing, which the declaration test's A8 invariant forbids).
- Source trees `plugin/**`, `plugin/skills/**`, `tests/**`, `tools/**` keep `"suites": "*"` (#1924's invariant, still pinned).
- The `tests` suite keeps the exact command `npm test` and its existing `retry.tests` template `node --test {file}`; the `flaky` block is unchanged.
- `.claude-tweaks/` is maintainer-side (not in the `plugin/` payload, ADR 0015) — no shipped prose changes. The installed build (6.140.0) already parses suite maps (`grep -c "isPlainObject(checks.tests)"` on the installed `declaration.js` → 2).

## Verified facts (authoring-time probes)

- **Live journey readers** (static sweep, run 2026-10-17 at worktree HEAD `5870e298a`): every `tests/**/*.js` file containing `docs/journeys`/`'journeys'`, plus every test whose scan roots include `docs` (`SWEPT_DIRS`/`SWEEP_ROOTS`/`SCAN_ROOTS`), classified by reading each hit. Live-tree readers (read the repo's own `docs/journeys/`, not a tmp fixture or a string literal):
  - `tests/argument-hint-mirrors.test.js` — `SWEEP_ROOTS` includes `docs`
  - `tests/dispatch-named-form-exclusion-reasons.test.js` — reads `docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md`
  - `tests/impeccable-retired-scripts-sweep.test.js` — `SWEPT_DIRS` includes `docs` (`git ls-files -- docs`)
  - `tests/plan-citations-resolve.test.js` — `SCAN_ROOTS` includes `docs`
  - `tests/tidy-release-note-repair-conformance.test.js` — reads `docs/journeys/tidy-standalone-auto-report.md` (including its `files:` frontmatter line `  - plugin/skills/tidy/release-note-repair.md`)
  - `tests/tidy-report-rules.test.js` — reads `docs/journeys/tidy-standalone-auto-report.md`
  - `tests/timing-prose-conformance.test.js` — reads two `docs/journeys/*-1928.md`/`*-1929.md` files
  - Excluded after reading (fixture or literal only): `wrap-up-engine-journey-crlf`, `bin-lib/wrap-up/{facts,engine-cli,engine-plan,engine-record,engine-render,registry}`, `bin-lib/journey-health/{scope,cli-next-target}`, `bin-lib/flow/{artifact-overwrite-check,check-artifact-overwrite-cli}`, `bin-lib/issues/{grouping,acceptance}`, `bin-lib/console/resolve`, `multispec-artifact-namespacing-conformance`, `scope-resolution-conformance`, `bin-lib/docs-health/scope`, `sweep-stray-run-dirs`, `timing-nested-parent-roster` (scans `plugin/skills` only).
- **Verbatim-command run-once:** the journeys suite command (below) ran once at HEAD: `# tests 72`, `# pass 71`, `# fail 1`, ~1.4 s wall. The one failure is `timing-prose-conformance.test.js` "#1928: multi-spec.md cites the run-dir layout sub-file and stays under its read budget" (`multi-spec.md is 20903 B`) — **pre-existing on `origin/main`** (introduced by #3036's merge, the same red CI tip `reconcile` reported). This is why the `journeys` suite gets its own `retry` template (below): without one, `verify.js`'s baseline adjudication cannot classify a journeys-suite failure against `origin/main` and a journey-only scoped run would fail hard while main is red.
- **Engine behavior (code path, not prose):** `scope.js` `selectScope` — a file matching a rule with `suites: ["journeys"]`, `static: false`, and no other changed file → `selected = {journeys}`, `everySuite` false (2 declared suites) → `mode: 'scoped'`, `suites: ['journeys']`, `unmatched: []`. A journeys file plus any `plugin/**` file → `all = true`, `isStatic = true` → `mode: 'full'`. `verify.js:356-361` filters the caller's `--cmd` set to the selected suites, and `verify.js:371-385` (H2) refuses a scoped/full run whose `--cmd` set lacks a selected suite — callers pass `--cmd journeys=…` alongside `--cmd tests=…`, as `plugin/skills/test/verification.md`'s Scoped-invocation paragraph already instructs for a suite-map declaration ("pass every declared suite").

## Review Focus

1. **A new test that starts reading `docs/journeys/` is not in the journeys list** → a journey-only delta under-verifies it in the pipeline. Expected: CI's full `npm test` on the PR still runs it (merge-verification `merge-when-green`), so the gap is a slower catch, never a silent ship. Pinned partially by Task 1's existence assertion (a renamed/deleted listed file goes red); a full static coverage pin was rejected — the "reads the live tree" signal is not mechanically separable from fixture/literal mentions (engine-plan/engine-record/grouping hold `docs/journeys/…` string literals with no file read), and a heuristic that misclassifies would be a silent-wrong pin (`parse-signal-discipline`).
2. **A mixed delta (journey file + source file)** must still be full. Pinned in Task 1's new test.
3. **A journey-only delta must not be `none`/`static-only`** (would skip the readers entirely). Pinned in Task 1's new test (`mode === 'scoped'`, `suites` deep-equals `['journeys']`).
4. **The bookkeeping `[]` rules must not swallow `docs/journeys/**`** (rule order / glob overlap). Pinned: the existing A8 test plus the new test's `unmatched`/`suites` assertions on a real journey filename.
5. **Pre-existing red main tip** must not make a journey-only scoped run unadjudicable. Handled by `retry.journeys`; pinned by Task 1's assertion that `decl.retry.journeys` contains `{file}`.

---

### Task 1: Declare the journeys suite and its rule, and repin the declaration test

**Files:**
- Modify: `.claude-tweaks/verify-scope.json` (whole file — 20 lines)
- Test: `tests/verify-scope-declaration.test.js` (modify test 1 at lines 19-28; add one test after line 38)

**Interfaces:**
- Consumes: `readDeclaration(path)` → `{ok, decl: {checks: {tests: string | {[suite]: cmd}}, suites: string[], retry: {[suite]: template}, rules: [{match, suites, static}], flaky}}` (`plugin/bin/lib/verify/declaration.js`); `selectScope({decl, files, stamp})` → `{mode, suites, static, base, unmatched, matched}` (`plugin/bin/lib/verify/scope.js`).
- Produces: declared suite name `journeys` — every `verify.js --scope .claude-tweaks/verify-scope.json` caller in this repo now passes `--cmd journeys="<command below>"` (and `--baseline-cmd journeys="node --test {file}"` at pipeline sites) alongside `--cmd tests="npm test"`.

- [ ] **Step 1: Write the failing test**

In `tests/verify-scope-declaration.test.js`, replace test 1 (lines 19-28) with:

```js
test('this repo declares its own verify scope and it passes readDeclaration (#1924 AC5, #3337)', () => {
  assert.ok(fs.existsSync(DECL), 'missing .claude-tweaks/verify-scope.json');
  const r = readDeclaration(DECL);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.deepStrictEqual(r.decl.suites, ['tests', 'journeys']);
  assert.strictEqual(r.decl.checks.tests.tests, 'npm test');
  for (const rule of r.decl.rules) {
    if (rule.match === 'docs/journeys/**') {
      assert.deepStrictEqual(rule.suites, ['journeys'], 'docs/journeys/** maps to the journeys suite only');
      continue;
    }
    assert.ok(rule.suites === '*' || (Array.isArray(rule.suites) && rule.suites.length === 0), `rule ${rule.match} must be "*" or []`);
  }
  for (const rule of r.decl.rules) {
    if (/^(plugin|tests|tools)\//.test(rule.match)) assert.strictEqual(rule.suites, '*', `${rule.match} must map to every suite`);
  }
});
```

and insert, immediately after the existing `'a ledger-row delta resolves to none; a skill-prose delta resolves to full (#1924 AC5)'` test (after its closing `});`):

```js
test('a journey-only delta runs only the journeys suite; a mixed delta stays full (#3337)', () => {
  const { decl } = readDeclaration(DECL);
  const sel = (files) => selectScope({ decl, files, stamp: STAMP });
  const journeyOnly = sel(['docs/journeys/recover-from-a-dispatch-config-deny-3225.md']);
  assert.strictEqual(journeyOnly.mode, 'scoped');
  assert.deepStrictEqual(journeyOnly.suites, ['journeys']);
  assert.deepStrictEqual(journeyOnly.unmatched, []);
  assert.strictEqual(journeyOnly.static, false);
  assert.strictEqual(sel(['docs/journeys/a.md', 'docs/plans/x-ledger.md']).mode, 'scoped');
  assert.strictEqual(sel(['docs/journeys/a.md', 'plugin/bin/verify.js']).mode, 'full');
  const files = decl.checks.tests.journeys.split(/\s+/).filter((t) => t.startsWith('tests/'));
  assert.ok(files.length > 0, 'journeys suite names no test files');
  for (const f of files) assert.ok(fs.existsSync(path.join(REPO_ROOT, f)), `journeys suite names a missing file: ${f}`);
  assert.ok(decl.retry.journeys && decl.retry.journeys.includes('{file}'), 'journeys suite needs a retry template for baseline adjudication');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/verify-scope-declaration.test.js`
Expected: FAIL — test 1 with `deepStrictEqual` `['tests']` vs `['tests', 'journeys']`, and the new test with `mode` `'full'` vs `'scoped'` (the journey path is currently unmatched).

- [ ] **Step 3: Write minimal implementation**

Replace `.claude-tweaks/verify-scope.json` with:

```json
{
  "checks": {
    "tests": {
      "tests": "npm test",
      "journeys": "node --test tests/argument-hint-mirrors.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/impeccable-retired-scripts-sweep.test.js tests/plan-citations-resolve.test.js tests/tidy-release-note-repair-conformance.test.js tests/tidy-report-rules.test.js tests/timing-prose-conformance.test.js"
    }
  },
  "retry": { "tests": "node --test {file}", "journeys": "node --test {file}" },
  "flaky": {
    "files": ["tests/bin-lib/log-decision/append.test.js", "tests/bin-lib/verify/cli.test.js", "tests/bin-lib/gif/palette.test.js", "tests/statusline.test.js"],
    "maxRetries": 1
  },
  "rules": [
    { "match": "plugin/skills/**", "suites": "*", "static": true },
    { "match": "plugin/**", "suites": "*", "static": true },
    { "match": "tests/**", "suites": "*", "static": true },
    { "match": "tools/**", "suites": "*", "static": true },
    { "match": "docs/journeys/**", "suites": ["journeys"], "static": false },
    { "match": "docs/plans/*-ledger.md", "suites": [], "static": false },
    { "match": ".claude-tweaks/pipelines/**", "suites": [], "static": false },
    { "match": "docs/superpowers/plans/**", "suites": [], "static": false },
    { "match": "docs/superpowers/specs/**", "suites": [], "static": false }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/verify-scope-declaration.test.js`
Expected: PASS (all 5 tests).

Then run the new suite command itself: `node --test tests/argument-hint-mirrors.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/impeccable-retired-scripts-sweep.test.js tests/plan-citations-resolve.test.js tests/tidy-release-note-repair-conformance.test.js tests/tidy-report-rules.test.js tests/timing-prose-conformance.test.js`
Expected: 72 tests, 71 pass, 1 fail — the pre-existing `multi-spec.md is 20903 B` failure (on `origin/main` before this change; not caused by this task). Any other failure is a regression.

- [ ] **Step 5: Commit**

```bash
git add .claude-tweaks/verify-scope.json tests/verify-scope-declaration.test.js
git commit -m "Map docs/journeys/** to a journeys verify suite — journey-only deltas stop forcing a full re-verify

refs #3337"
```

### Controller verification (after Common Step 5's full pass — not an implementer step)

Real-input probe for both Acceptance Criteria, run in the worktree once a full-pass stamp exists:

1. **AC1** — with a journey-only delta relative to the stamp (Common Step 6's journey commit, or a working-tree edit to one journey file), run `verify.js --scope .claude-tweaks/verify-scope.json --integration-branch origin/main --cmd tests="npm test" --cmd journeys="<journeys command>" --no-stamp` and confirm stdout's `Scope:` line reads mode `scoped`, `suites: journeys`, `unmatched: 0`.
2. **AC2** — edit `docs/journeys/tidy-standalone-auto-report.md`'s `files:` frontmatter line `  - plugin/skills/tidy/release-note-repair.md` away (working tree only), re-run the same scoped command, confirm the journeys check fails on `tidy-release-note-repair-conformance.test.js`; then `git checkout -- docs/journeys/tidy-standalone-auto-report.md` and confirm the file is restored (`git diff --stat` empty for it).

---

## Self-review

- **Spec coverage:** Deliverable 1 (rule selecting only the journey suites) → Task 1 Step 3. Deliverable 2 (escape hatch if a file-subset suite can't be expressed) → not needed: the suite map expresses it; recorded under Architecture. AC1 → Task 1's new test (engine classification) + controller probe 1 (the real `verify.js` run). AC2 → controller probe 2 (revert a journey frontmatter field, scoped run goes red).
- **Placeholders:** none.
- **Type consistency:** suite name `journeys` and command string identical across the JSON, the test, and the controller probe.
- **Review Focus:** 5 lines, each pinned in Task 1 or handled with a stated backstop (line 1).
