# Windows `/` Display IDs (#4288) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every repo-display ID that 13 Windows-failing tests compare with a `/` literal or a `/`-keyed allowlist is `/`-separated on win32 too: two production producers build their IDs with a `/` template, five test-owned listings go through `toPosix`, and one test derives its expected command from `substituteFile`.

**Architecture:** Display IDs and native paths are two contracts (`.claude/skills/windows-checkout-test-parity/SKILL.md`, "Display IDs and native paths are two contracts"). An ID is normalized where it is produced; a path later opened with `fs` stays native. No production behavior changes on Linux or macOS: `path.join` and `path.relative` already emit `/` there, so every Linux test passes before and after, and the `windows-regression.yml` dispatch (AC3.1) is the discrimination proof.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `plugin/bin/lib/shared-primitives.js`'s `toPosix(p, sep = path.sep)`.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T065631-spec-4288/work/4288-spec.md` (record #4288)

## Global Constraints

- Display IDs use `/` on every OS. A path handed to `fs` stays native. Never apply `toPosix` to a path that is later opened, joined into an `fs` call, or compared with a native path.
- The producers use a `/` template literal, not `toPosix(path.join(…))`: `` `docs/superpowers/plans/${f}` ``, `` `${entry.name}/${child.file}` ``, `` `${entry.name}/${child.newest.file}` `` (spec Deliverables).
- Test-side listings import `toPosix` from `plugin/bin/lib/shared-primitives.js` and wrap the listing where it is built.
- `impact-cli.test.js` pins `strictEqual` against `substituteFile(template, listPath, { token: '{files}' }).command`, the same call `plugin/bin/verify.js:633` makes.
- No new dependencies. CI runs Node 20 (`npx -y node@20 --test …` reproduces it locally).
- Line numbers in the spec are as of `988cc584d`. The sites below are re-derived on this branch's base `3ad36593f`.
- Out of scope: `scope.test.js` and `residue/artifacts.test.js` also hold failures of other classes (P1, E) tracked in their own records (#4290 overlaps `scope.test.js`). AC3.1 counts this class only.

## Re-derived sites (named-location drift)

| Spec site | On this branch | Disposition |
|---|---|---|
| `plugin/bin/release-local.js:340` `listPlanFiles` | line 376: `.map((f) => path.join('docs/superpowers/plans', f))` | Task 1 |
| `plugin/bin/lib/residue/probes/artifacts.js:77/110/140` | lines 77, 110, 140, unchanged | Task 1 |
| `tests/bin-lib/code-health/scope.test.js:812` | line 813: `relFiles` | Task 2 |
| `tests/ceremony-profile-roster.test.js:58` | line 65 already reads `toPosix(path.relative(SKILLS, file))` (#4296) | **Dropped**: already fixed. Still in the AC1.1 run and the AC2.1 go-red |
| `tests/integration-branch-conformance.test.js:42` | line 45: `const rel = path.relative(SKILLS_DIR, file);` | Task 2 |
| `tests/integration-model.test.js:228` | line 231: `const rel = path.relative(SKILLS_DIR, file);` | Task 2 |
| `tests/merge-verification-gate-conformance.test.js:49` | line 55: `const rel = path.relative(SKILLS, file);` (checked against `LEVER_FILES`) | Task 2. Lines 36 and 44 build failure messages only, compared with nothing `/`-keyed: left alone |
| `tests/payload-boundary.test.js:522/541` | lines 528 and 546: `const relFile = path.relative(ROOT, file);` (checked against `BOUNDARY_ALLOW` via `isAllowed`) | Task 2. Lines 574 and 579 build messages for an expected-empty list: left alone |
| `tests/bin-lib/verify/impact-cli.test.js:115` | line 135: `assert.match(report.checks.tests.command, /^node scripts\/subset\.js \S+impact-files\.txt$/, …)` | Task 3 |

**Sole-site proofs** (run on this branch):

- `git grep -n "path.join(entry.name" -- plugin/bin/lib/residue/probes/artifacts.js` returns exactly lines 77, 110 and 140.
- `grep -n "\.file\b\|basis\." plugin/bin/lib/residue/probes/artifacts.js`: `basis.file` is read only at line 197 (the evidence string), so the walkers' `file` value is display-only. Line 227 reads `basis.basisMs` alone.
- `git grep -n "listPlanFiles" -- plugin/bin`: its only consumer is `plugin/bin/lib/release/precheck.js:59`. That consumer passes each ID to `deps.readFile` (`release-local.js:349`: `fs.readFileSync(abs(p))`, with `abs = (p) => path.join(root, p)`), and `path.join` accepts `/` on win32. It also reports each ID as `planClaims[].file`, which is display.

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 4 Step 1 (the nine-file `node --test` run, plus Node 20), after Tasks 1-3 |
| AC2.1 | Task 4 Step 2: one-entry-removed go-red per conformance suite, all four |
| AC2.2 | Task 4 Step 2: the "every file … or is allowlisted" test goes `not ok` on the removed entry's file, so the posix `rel` still equals a real allowlist key |
| AC3.1 | Task 4 Step 3: the `windows-regression.yml` dispatch, read per file from `verify-report.json` and the isolated logs |

## Review Focus

1. **An allowlist key later rejoined into an `fs` path.** The "allowlist has no stale entries" tests in `integration-branch-conformance` and `integration-model` run `path.join(SKILLS_DIR, rel)` on the `/`-keyed allowlist key, not on the listing. Task 2 must leave those keys and that join unchanged. They stay pinned by those stale-entry tests in the AC1.1 run.
2. **A checkout path that needs quoting on POSIX too** (a space in the temp dir). `substituteFile` quotes it on Linux as well, and the old `\S+` regex already failed there. The Task 3 expectation is derived from the same call, so it matches whatever quoting applies. The existing `'{files} path with a space is quoted'` test (`impact-cli.test.js:250`) pins only `listPath` and the run's success, not the command, so Task 3 adds the same derived `strictEqual` there too: `assert.strictEqual(report.checks.tests.command, substituteFile('node scripts/subset.js {files}', report.scope.impact.listPath, { token: '{files}' }).command)`.
3. **A newest file three directories deep.** The `/` template composes recursively (`a/b/c.png`). On Linux the old and new forms are byte-identical, so no Linux test can tell them apart. The Windows dispatch is the proof (AC3.1).
4. **Reverting a producer, or dropping a test-side `toPosix`, stays green on Linux.** `toPosix`'s default `sep` is `/` there (the skill's "A call site that takes the default `sep` is not covered" note). This build records it as a known limit in the ledger. The discrimination proof is the `windows-regression` run's per-file read in Task 4, never the Linux suite.
5. **A test-side `toPosix` applied to an `fs` path by mistake.** It would still pass on Linux. Task 2's reviewer checks every wrapped expression: it is the value compared with `/` keys or literals, and is never passed to `fs.*`, `readText`, or `path.join` as a base.

---

### Task 1: `/`-joined display IDs at the two production producers

**Files:**
- Modify: `plugin/bin/release-local.js:376`
- Modify: `plugin/bin/lib/residue/probes/artifacts.js:77`, `:110`, `:140`
- Test (unchanged, must stay green): `tests/bin-lib/release-local/cli.test.js:35`, `tests/bin-lib/residue/artifacts.test.js:63`

**Interfaces:**
- Consumes: nothing new.
- Produces: `defaultDeps(root).listPlanFiles(): string[]` returns `docs/superpowers/plans/{name}.md` IDs, `/`-joined on every OS. `newestFileMtimeMs(dir)`, `zipAndNewest(dir).newest` and `legacyShapeAndAge(rel, base)`'s newest `file` are `/`-joined paths relative to the scanned dir. All signatures are unchanged.

- [ ] **Step 1: Run the two existing pins before the change, to record the Linux baseline**

Run: `node --test tests/bin-lib/release-local/cli.test.js tests/bin-lib/residue/artifacts.test.js`
Expected: both files pass (`# fail 0`). On Linux the native join already emits `/`, which is why AC3.1's Windows run, not this suite, discriminates.

- [ ] **Step 2: Replace the four `path.join` display-ID builds with `/` templates**

- `release-local.js:376`: `.map((f) => `docs/superpowers/plans/${f}`)`
- `artifacts.js:77`: `file: `${entry.name}/${child.file}``
- `artifacts.js:110` and `:140`: `file: `${entry.name}/${child.newest.file}``

Leave every `path.join(dir, entry.name)` / `path.join(base, entry.name)` `fs` path native, along with the finding `failed`/`subject` strings at lines 187 and 195 (outside this record's class, and not compared with a `/` literal by any failing test). Update the comment above `listPlanFiles` with one clause saying the IDs are `/`-joined display IDs, rejoined to `root` by `deps.readFile`.

- [ ] **Step 3: Run the same pins**

Run: `node --test tests/bin-lib/release-local/cli.test.js tests/bin-lib/residue/artifacts.test.js tests/bin-lib/release-local/hardening.test.js`
Expected: `# fail 0`.

- [ ] **Step 4: Commit**

```bash
git add plugin/bin/release-local.js plugin/bin/lib/residue/probes/artifacts.js
git commit -m "Build listPlanFiles and the residue newest-file IDs with / — they are display IDs, compared with / literals on every OS"
```

(Body: `Refs #4288`, then the `Claude-Session:` trailer.)

### Task 2: `toPosix` on the five test-owned listings compared with `/` keys

**Files:**
- Modify: `tests/bin-lib/code-health/scope.test.js:813`
- Modify: `tests/integration-branch-conformance.test.js:45` (+ import)
- Modify: `tests/integration-model.test.js:231` (+ import)
- Modify: `tests/merge-verification-gate-conformance.test.js:55` (+ import)
- Modify: `tests/payload-boundary.test.js:528`, `:546` (+ import)

**Interfaces:**
- Consumes: `toPosix(p: string, sep = path.sep): string` from `plugin/bin/lib/shared-primitives.js`. Import it as `const { toPosix } = require('../plugin/bin/lib/shared-primitives');` from `tests/`, and as `require('../../../plugin/bin/lib/shared-primitives')` from `tests/bin-lib/code-health/`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Wrap each listing where it is built**

- `scope.test.js:813`: `const relFiles = (root) => sourceFiles(root).map((f) => toPosix(path.relative(root, f))).sort();`
- `integration-branch-conformance.test.js:45`, `integration-model.test.js:231`, `merge-verification-gate-conformance.test.js:55`: `const rel = toPosix(path.relative(…, file));`. In each file, keep the `readText(file)` / `fs.readFileSync(file)` reads on the native `file`.
- `payload-boundary.test.js:528` and `:546`: `const relFile = toPosix(path.relative(ROOT, file));`. Leave `baseDir = path.dirname(file)` and `resolveInsidePlugin(...)` on native paths.

Add a one-line comment at each wrapped site, matching `ceremony-profile-roster.test.js:64`: `// Compared against /-keyed {allowlist | literals}, so it is a display ID (#4288).`

- [ ] **Step 2: Run the five suites**

Run: `node --test tests/bin-lib/code-health/scope.test.js tests/integration-branch-conformance.test.js tests/integration-model.test.js tests/merge-verification-gate-conformance.test.js tests/payload-boundary.test.js`
Expected: `# fail 0`.

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/code-health/scope.test.js tests/integration-branch-conformance.test.js tests/integration-model.test.js tests/merge-verification-gate-conformance.test.js tests/payload-boundary.test.js
git commit -m "Route five test listings through toPosix — they are compared with /-keyed allowlists and literals, which a win32 path.relative never matched"
```

### Task 3: `impact-cli.test.js` pins the substituted subset command

**Files:**
- Modify: `tests/bin-lib/verify/impact-cli.test.js:135` (+ import)

**Interfaces:**
- Consumes: `substituteFile(template: string, file: string, { platform = process.platform, token = '{file}' } = {}): { ok: boolean, command?: string, reason?: string }` from `plugin/bin/lib/verify/file-template.js`.
- Produces: nothing.

- [ ] **Step 1: Replace the POSIX-only regex with the derived command**

In `test('selects the subset (AC1.1 report shape)', …)`, replace the `assert.match(report.checks.tests.command, /^node scripts\/subset\.js \S+impact-files\.txt$/, …)` line with:

```js
const sub = substituteFile('node scripts/subset.js {files}', imp.listPath, { token: '{files}' });
assert.ok(sub.ok, `substituteFile refused the list path: ${sub.reason}`);
assert.strictEqual(report.checks.tests.command, sub.command, 'the recorded command is the substituted subset command');
```

The template literal equals `declOf()`'s default `command` (`impact-cli.test.js:55`). Also add the same derived `strictEqual` to `test('{files} path with a space is quoted', …)` (`impact-cli.test.js:250`), reading the command from that test's own `report` (Review Focus 2). On Linux that test's list path holds a space, so `substituteFile` single-quotes it. That proves the derived expectation tracks quoting, which the old `\S+` regex could not express. Import `substituteFile` with the file's existing `path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', …)` require shape.

- [ ] **Step 2: Run the suite**

Run: `node --test tests/bin-lib/verify/impact-cli.test.js`
Expected: `# fail 0`.

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/verify/impact-cli.test.js
git commit -m "Pin impact-cli's subset command against substituteFile's own output — win32 double-quotes the list path by design"
```

### Task 4: Verification (folded into build Common Step 5)

**Files:** none modified. Results go to the open-items ledger.

- [ ] **Step 1 (AC1.1): run the record's nine files on Linux**

Run: `node --test tests/bin-lib/code-health/scope.test.js tests/bin-lib/release-local/cli.test.js tests/bin-lib/residue/artifacts.test.js tests/bin-lib/verify/impact-cli.test.js tests/ceremony-profile-roster.test.js tests/integration-branch-conformance.test.js tests/integration-model.test.js tests/merge-verification-gate-conformance.test.js tests/payload-boundary.test.js`
Expected: `# fail 0`. Also run it under Node 20: `npx -y node@20 --test …` with the same file list.

- [ ] **Step 2 (AC2.1, AC2.2): go-red for the four conformance suites, in a scratch detached worktree at this branch's HEAD**

Remove one allowlisted entry per suite, run that suite alone, and restore the file in the same script:

- `integration-branch-conformance`: `_shared/issue-claims.md`
- `integration-model`: `_shared/integration-model.md`
- `merge-verification-gate-conformance`: `flow/manifesto.md` from `LEVER_FILES`
- `ceremony-profile-roster`: the first `## Mentions that are not skips` row of `plugin/skills/_shared/ceremony-profile.md`

Expected: each suite's baseline exit is `0` and its mutated exit is `1`, with the "every file … cites … or is allowlisted" / "… or a citation" / "#1926 AC5" test listed `not ok`. That shows the posix listing still matches real allowlist entries (AC2.2). Probed while authoring this plan at `e0e028efb`: all four go red. Re-run after Task 2 and record the four results in the ledger.

- [ ] **Step 3 (AC3.1): Windows proof, dispatched after the last code-changing step (simplify included)**

Run: `gh workflow run windows-regression.yml --repo thn-inc/claude-tweaks --ref worktree-flow-spec-4288`. When it completes, `gh run download {run-id} --repo thn-inc/claude-tweaks -n verify-report` and read `verify-report.json`'s `baselineAdjudicated.failingFiles` and each of the nine files' `tests-isolated-*.log` `not ok` lines by test name.

Expected: none of the 13 named tests appears as `not ok`, and no file outside the baseline is newly failing. `scope.test.js` / `residue/artifacts.test.js` may still list other-class failures (P1, E); count only this class. The run's overall `success` alone is not proof.

- [ ] **Step 4: Record the results**

Add a ledger row for each of AC1.1, AC2.1/AC2.2 and AC3.1, with the run ID and the per-file reading. Add one `observation` row stating Review Focus 4's limit: a reverted producer or a dropped test-side `toPosix` stays green on Linux.
