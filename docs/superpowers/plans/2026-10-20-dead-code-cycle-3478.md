# Break the candidates-dead-code ↔ focus-generators hub cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No `candidates-*.js` vertical imports helpers from a sibling vertical. The shared helpers move into a leaf module with no registry dependency, so `candidates-dead-code.js` stops being a hub that the registry's autoload cascade re-enters mid-load.

**Architecture:** Move `SOURCE_EXTS`, `isGlobDiscoveredTestFile`, `extractModuleExports` (with its `IDENTIFIER_RE`), `listTrackedFiles`, and `listTrackedSourceFiles` out of `candidates-dead-code.js` and into a new leaf module, `plugin/bin/lib/code-health/source-scan.js`. The leaf requires only `child_process`/`path`. Repoint the seven verticals that destructure these helpers from `./candidates-dead-code` to `./source-scan`, and have them take `escapeRegExp` from `../shared-primitives` directly. `candidates-dead-code.js` then imports the helpers from the leaf, stops re-exporting them, and moves its registry require back to the top of the file like every sibling. The #2869 export-before-require ordering is no longer load-bearing. The registry ↔ vertical self-registration loop stays: `focus-generators.js` assigns `module.exports` before it autoloads, and that loop never was the hazard.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T184822-record-3478/work/3478-spec.md` (record #3478)

**Scope keywords:** candidates-dead-code

## Global Constraints

- Break the cycle at the source by extracting the helpers into a leaf module, not by reordering requires again (Deliverable 1).
- The regression test loads `candidates-dead-code.js` in a fresh child process and must be proven red against the current tree (Deliverable 2). AC1.1 (no warning on a direct require) already holds at base `44b59b5ea` because of #2869, so a stderr-only assertion cannot go red. The test therefore also asserts the cycle edge itself, which is red at base (see the `premise reversed:` line in the run's `decisions.md`).
- `candidates-dead-code.js` must not require `./scope` or `next-slice` (the cursor-neutrality test in `candidates-dead-code.test.js`). The leaf module keeps its own `SOURCE_EXTS` copy rather than importing `scope.js`'s, so dead-code does not import `scope.js` transitively either.
- Move helper bodies verbatim. This is a relocation, not a behavior change.

## Review Focus

- A vertical required directly as the first module in a fresh process, in every order. The existing all-modules fresh-process test (`candidates-require-order.test.js` test 3) keeps covering this, and it must stay green.
- `FOCUS_GENERATORS['dead-code']` stays registered whichever file loads first. The existing "dead-code stays registered under both load orders" test and `focus-generators.test.js` cover this, and they must stay green with the registry require moved back to the top of dead-code.
- A future vertical that re-introduces a sibling import. The new test discovers edges dynamically from every module loaded in the fresh process, not from a fixed list.
- The leaf module quietly growing a registry or sibling dependency. The new test asserts the leaf's own outgoing edges.
- Behavior parity of the moved helpers. The existing helper unit tests in `candidates-dead-code.test.js` and `candidates-prelaunch.test.js`, repointed to `source-scan`, must pass unchanged.

---

### Task 1: Leaf module, vertical repointing, and the fresh-process cycle test

**Files:**
- Create: `plugin/bin/lib/code-health/source-scan.js`
- Modify: `plugin/bin/lib/code-health/candidates-dead-code.js` (lines 107-130, 256-310, 400-445, 553-577: remove moved helpers, import them from `./source-scan`, drop `escapeRegExp`/`isGlobDiscoveredTestFile`/`extractModuleExports`/`listTrackedFiles`/`listTrackedSourceFiles` from `module.exports`, move `const { registerGenerator } = require('./focus-generators');` back near the top requires, and replace the trailing #2869 comment and call with a plain `registerGenerator('dead-code', scanDeadCode);`)
- Modify: `plugin/bin/lib/code-health/candidates-abstraction-police.js:55-76` (require `./source-scan` and `../shared-primitives`; delete the require-order comment block; header lines 14-25 and 52 point at `source-scan.js`)
- Modify: `plugin/bin/lib/code-health/candidates-test-hygiene.js:55-76` (same as abstraction-police; header line 14)
- Modify: `plugin/bin/lib/code-health/candidates-experiment-cleanup.js` (lines 28, 60-61, 105: `listTrackedSourceFiles` from `./source-scan`; comment mentions point at `source-scan.js`)
- Modify: `plugin/bin/lib/code-health/candidates-security-hardening.js` (lines 41, 120, 135-144: `listTrackedFiles` from `./source-scan`; delete the order-rationale comment; header mentions point at `source-scan.js`)
- Modify: `plugin/bin/lib/code-health/candidates-prelaunch.js` (lines 57, 64-70: same)
- Modify: `plugin/bin/lib/code-health/candidates-app-store-readiness.js` (lines 25, 50-54: same)
- Modify: `plugin/bin/lib/code-health/candidates-scale-readiness.js` (lines 23, 160-168: same)
- Modify: `plugin/bin/lib/code-health/scope.js:526` (comment: the hand-declared copy now lives in `source-scan.js`)
- Test: `tests/bin-lib/code-health/candidates-require-order.test.js` (add the new test; delete test 2, "candidates-security-hardening.js requires ./focus-generators before ./candidates-dead-code", which pins the order this task makes irrelevant; update the header comment)
- Test: `tests/bin-lib/code-health/candidates-dead-code.test.js:213,561` (require moved helpers from `source-scan`), `:868-877` (cursor-neutrality expected import list adds `"require('./source-scan')"`, sorted)
- Test: `tests/bin-lib/code-health/candidates-prelaunch.test.js:221` (require from `source-scan`)
- Test: `tests/bin-lib/code-health/candidates-experiment-cleanup.test.js:360-365` (comment only: drop the dead-code require-order rationale)

**Interfaces:**
- Produces: `source-scan.js` exports `{ SOURCE_EXTS, isGlobDiscoveredTestFile, extractModuleExports, listTrackedFiles, listTrackedSourceFiles }`. Signatures are unchanged from their current definitions in `candidates-dead-code.js`: `isGlobDiscoveredTestFile(relFile: string) -> boolean`, `extractModuleExports(text: string) -> Array<{symbol, startLine, endLine}>`, `listTrackedFiles(rootDir: string) -> {files: string[], discoveryFailed: boolean, reason?: string}`, `listTrackedSourceFiles(rootDir: string) -> same shape`.
- `candidates-dead-code.js` exports after the change: `detectEntrypoints, extractPathLikeStrings, collectStrings, isReferenced, isFileOrphan, referencedFileSpecifiers, scanDeadCode, candidatesDeadCode`.

- [ ] **Step 1: Write the failing test.** Add it to `candidates-require-order.test.js`:

```js
test('AC1.1 AC2.1: candidates-dead-code.js loads in a fresh process with no circular-dependency warning and no vertical requires a sibling vertical', () => {
  const deadCodePath = path.join(CODE_HEALTH_DIR, 'candidates-dead-code.js');
  // Records every (requiring file basename, request) edge in a fresh process.
  const script = [
    "const Module = require('module'); const p = require('path');",
    'const edges = []; const orig = Module.prototype.require;',
    'Module.prototype.require = function (id) { edges.push([p.basename(this.filename || ""), id]); return orig.apply(this, arguments); };',
    `require(${JSON.stringify(deadCodePath)});`,
    'process.stdout.write(JSON.stringify(edges));',
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, `load exited non-zero: ${result.stderr}`);
  assert.doesNotMatch(result.stderr || '', /inside circular dependency/i);
  const edges = JSON.parse(result.stdout);
  const isVertical = (f) => /^candidates-.*\.js$/.test(f);
  assert.ok(edges.some(([from, id]) => from === 'candidates-dead-code.js' && id === './source-scan'), 'dead-code must take its helpers from ./source-scan');
  assert.ok(edges.filter(([from]) => isVertical(from)).length >= 9, 'every vertical must have been loaded (vacuity guard)');
  const siblingEdges = edges.filter(([from, id]) => isVertical(from) && /^\.\/candidates-/.test(id));
  assert.deepEqual(siblingEdges, [], 'a vertical requires a sibling vertical — move the shared helper into ./source-scan');
  const leafEdges = edges.filter(([from, id]) => from === 'source-scan.js' && /^\.\/(focus-generators|candidates-)/.test(id));
  assert.deepEqual(leafEdges, [], 'source-scan.js must stay a leaf: no registry or vertical requires');
});
```

The vacuity guard counts edges *from* verticals. Each of the 9 verticals requires at least `./focus-generators`, so the count is at least 9.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="AC1.1 AC2.1" tests/bin-lib/code-health/candidates-require-order.test.js`
Expected: FAIL after Step 1, on the `./source-scan` edge assertion (the module does not exist yet). Temporarily comment out that one assertion and re-run: it then FAILs on `siblingEdges`, listing the seven `./candidates-dead-code` edges from abstraction-police, test-hygiene, experiment-cleanup, security-hardening, prelaunch, app-store-readiness, and scale-readiness. Restore the assertion. This proves the cycle edge goes red at base.

- [ ] **Step 3: Create `source-scan.js` and repoint.** Move the five helpers and the two constants (`SOURCE_EXTS`, plus `TEST_GLOB_BASENAME_RE` and `IDENTIFIER_RE`, which the helpers need) verbatim, with their existing doc comments, under a short module header. The header says the module is the leaf home for helpers shared across focus verticals, and that it must never require `./focus-generators` or any `candidates-*.js` (#3478). Apply every Files-list edit above. In the two verticals that need `escapeRegExp`, take it as `const { escapeRegExp } = require('../shared-primitives');`.

- [ ] **Step 4: Run the code-health suites to verify they pass**

Run: `node --test "tests/bin-lib/code-health/*.test.js" tests/code-health-*.test.js tests/helpers-strip-comments.test.js`
Expected: PASS, 0 failures.
Then run the literal AC1.1 probe: `node -e "require('./plugin/bin/lib/code-health/candidates-dead-code')" 2>&1 | grep -c "circular dependency"`
Expected: `0`

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/code-health/ tests/bin-lib/code-health/
git commit -m "Break the candidates-dead-code hub cycle — shared helpers move to leaf source-scan.js, refs #3478"
```

### Task 2: Retire the require-order pitfall in the project skill and the journey

**Files:**
- Modify: `.claude/skills/code-health-focus-vertical/SKILL.md:53` (pitfall 1) and the Anti-patterns row "Fixing the require order only in the file that failed"
- Modify: `docs/journeys/code-health-focus-sweep.md:3` (`files:` frontmatter gains `plugin/bin/lib/code-health/source-scan.js`), `:44` (`isGlobDiscoveredTestFile` now lives in `source-scan.js`)

**Interfaces:**
- Consumes: Task 1's `source-scan.js` export names.

- [ ] **Step 1: Rewrite pitfall 1** as **"Import shared helpers from `./source-scan`, never from a sibling vertical."** The text says: the registry autoloads every vertical, so a vertical that destructures from a sibling re-enters that sibling mid-load, and Node binds the names to `undefined` with an `inside circular dependency` warning. #2693, #2908, and #3330 each hit this through `./candidates-dead-code`, and #3478 moved the helpers into the leaf `source-scan.js`. A helper a new vertical needs from a sibling moves into `source-scan.js` first. Keep the fresh-process testing advice (`spawnSync(process.execPath, ['-e', ...])`, since an in-process require hits the module cache) and point at the edge test in `candidates-require-order.test.js`. Drop the "require `./focus-generators` first" ordering rule. Reword the Anti-patterns row to: "Importing a helper from a sibling `candidates-*.js` | Re-creates the hub cycle; the fresh-process edge test in `candidates-require-order.test.js` fails it".

- [ ] **Step 2: Verify no stale ordering instruction survives**

Run: `grep -rn "focus-generators\` before\|before \`./candidates-dead-code\`\|require('./candidates-dead-code')" .claude/skills plugin/bin/lib/code-health tests/bin-lib/code-health`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/code-health-focus-vertical/SKILL.md docs/journeys/code-health-focus-sweep.md
git commit -m "Retire the code-health require-order pitfall — verticals import shared helpers from source-scan.js, refs #3478"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (break the cycle at the source, leaf module) | Task 1 Step 3 |
| Deliverable 2 (fresh-process regression test, red at base) | Task 1 Steps 1-2 |
| AC1.1 (no circular-dependency warning on a direct require) | Task 1 Step 1 test (`AC1.1 AC2.1`) and Step 4 probe |
| AC2.1 (new fresh-process test fails before, passes after) | Task 1 Steps 2 and 4 |
| AC3.1 (`node --test "tests/bin-lib/code-health/*.test.js"` passes) | Task 1 Step 4 (AC3.1) |
