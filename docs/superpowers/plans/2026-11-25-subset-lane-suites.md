# subsetLaneSuites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a verify-scope declaration list small declared suites under a new top-level `subsetLaneSuites` key, so a `verify.js` run whose only full-command local suites are listed ones takes the subset slot lane instead of queueing behind whole-suite runs.

**Architecture:** `readDeclaration` parses and validates the new top-level key (top level, because readers ignore unknown top-level keys but reject unknown `concurrency` keys). `verify.js`'s `fullSuiteRuns` predicate gains one exclusion: a suite listed in `decl.subsetLaneSuites` whose command is the declaration's own (no `--cmd` of that name). The lane rule itself (`chooseLane`) is unchanged.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T101455-record-5368/work/5368-spec.md`

Scope keywords: fullSuiteRuns, chooseLane, subsetLaneSuites

## Global Constraints

- Key name exactly `subsetLaneSuites`; top-level in `.claude-tweaks/verify-scope.json`, never inside `concurrency`.
- Parsed declaration always carries `subsetLaneSuites` (`[]` when the key is absent); no other parsed field changes for existing declarations.
- `impact.suite` can never be listed.
- A `--cmd` suite always counts toward the full lane, even under a listed name.
- Nothing else about lane choice changes (`chooseLane` in `plugin/bin/lib/verify/slot.js` keeps its rule; only its comment is updated).

## Review Focus

- A listed suite selected together with an unlisted declared suite (e.g. `journeys` + a full `tests`) must still take the full lane — the exclusion is per-suite, not per-run. Pinned in Task 2 (`AC3.1` control: listed + unlisted local).
- A listed name that is also given via `--cmd` must take the full lane (AC4) — the only signal is `parsed.cmds` naming it, not a command-string comparison.
- Run without `--scope` (no declaration read): `decl` is null, so the predicate must not dereference `decl.subsetLaneSuites` — guard on `decl`.
- `impact` block invalid while `subsetLaneSuites` names `impact.suite`: the error list may carry both errors; never a throw.
- Older installed readers: the committed `verify-scope.json` gains the key; `declaration.js`'s ci comment already establishes no top-level unknown-key check exists, so no reader-release gate is needed.

---

### Task 1: Parse and validate `subsetLaneSuites` in `readDeclaration`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/verify/declaration.js` (new block after the `localRuns` block, ~line 197; return object ~line 340)
- Test: `tests/bin-lib/verify/declaration.test.js`

**Interfaces:**
- Produces: `readDeclaration(...).decl.subsetLaneSuites: string[]` — `[]` when absent, else the validated list in declaration order.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/verify/declaration.test.js`, reusing its `fakeFs` and `EXAMPLE`; read via `readDeclaration('/d.json', fakeFs({'/d.json': JSON.stringify(decl)}))`)

```js
test('AC6.1: a declaration without subsetLaneSuites parses with subsetLaneSuites [] (#5368)', () => {
  const r = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify(EXAMPLE) }));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.decl.subsetLaneSuites, []);
});
test('subsetLaneSuites naming declared suites is returned as given (#5368)', () => {
  // { ...EXAMPLE, subsetLaneSuites: ['web'] } → ok, decl.subsetLaneSuites deepEqual ['web']
});
test('AC5.1: subsetLaneSuites that is not an array of strings is rejected naming the key (#5368)', () => {
  // 'web' (a string) → ok:false, errors include 'subsetLaneSuites: must be an array of declared suite names'
  // ['web', 3]       → ok:false, errors include 'subsetLaneSuites: entries must be strings, got number'
});
test('AC5.2: subsetLaneSuites naming an undeclared suite is rejected (#5368)', () => {
  // ['e2e'] → errors include 'subsetLaneSuites: unknown suite "e2e" (declared: api, web)'
});
test('AC5.3: subsetLaneSuites repeating a name is rejected (#5368)', () => {
  // ['web', 'web'] → errors include 'subsetLaneSuites: "web" is listed more than once'
});
test('AC5.4: subsetLaneSuites naming impact.suite is rejected (#5368)', () => {
  // EXAMPLE plus impact: { suite: 'api', command: 'x {files}', tests: ['**/*.test.ts'] } and subsetLaneSuites ['api']
  // → errors include 'subsetLaneSuites: "api" is impact.suite — its full command is the whole-suite run the full lane exists for'
});
```

Each error is asserted with `assert.ok(r.errors.includes(<exact string>), r.errors.join('\n'))`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bin-lib/verify/declaration.test.js`
Expected: FAIL — the new tests fail (`subsetLaneSuites` undefined / no error).

- [ ] **Step 3: Implement** the block in `declaration.js` after `localRuns`, with a comment in the `ci`/`localRuns` style (#5368: top-level so an older reader ignores it; marks declared suites whose own command is small enough for the subset lane). Validation order: non-array → the "must be an array" error and stop; else per entry: non-string → "entries must be strings, got {typeof}"; undeclared → unknown-suite error (same `(declared: …)` tail as `retry`); seen before → "listed more than once" (report each duplicate name once); equals `raw.impact && raw.impact.suite` → the impact.suite error. Add `subsetLaneSuites` to the returned `decl` after `localRuns`.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/bin-lib/verify/declaration.test.js tests/verify-scope-declaration.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit** — `git add` the two files; message `Add subsetLaneSuites to the verify declaration — refs #5368`.

### Task 2: Listed declared suites stay out of the full lane

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/verify.js:1095-1105` (comment + `fullSuiteRuns` predicate)
- Modify: `plugin/bin/lib/verify/slot.js:44` (comment only: the caller excludes `subsetLaneSuites` declared commands)
- Modify: `plugin/skills/test/suite-slots.md` (Lanes table rows + one key line; file is 8,880 B, rail 52,500 B — ample headroom)
- Modify: `docs/plugin-structure.md:103` (chooseLane parenthetical: add "or a declared suite listed in `subsetLaneSuites`" to the subset side)
- Modify: `.claude-tweaks/verify-scope.json` (add `"subsetLaneSuites": ["journeys"]` at top level, after `"localRuns"`)
- Test: `tests/bin-lib/verify/ci-cli.test.js` (AC1, AC3 — the fake-`gh` CI fixtures `repoWith`/`fakeGhEnv`/`withSlots` live only here), `tests/bin-lib/verify/impact-cli.test.js` (AC2 — `impactRepo`/`declOf` live only here), `tests/bin-lib/verify/cli-slot.test.js` (AC4). Deviation from the spec's test-file list: the spec named only `cli-slot.test.js`, but the CI and impact fixtures are file-local to the other two suites; the tests go beside the existing #5119 lane tests that use them rather than duplicating fixtures.
- No-change (swept): `plugin/skills/test/impact-selection.md` and `plugin/bin/lib/verify/scope.js:104` say "runs its full command" about impact fallback, not lane choice; `verify.js:1161-1166` and `baseline.js:453` concern adjudication's own full-lane slot, unchanged.

**Interfaces:**
- Consumes: `decl.subsetLaneSuites: string[]` from Task 1 (`decl` is null without `--scope`).

- [ ] **Step 1: Write the failing tests**

In `ci-cli.test.js`, beside the `#5119` slot tests (use `{ skip: SKIP }`, `withSlots(env, dir)`, green fake gh):

```js
// decl via repoWith({ declExtra: { checks: { tests: { tests: 'npm test', journeys: markerCommand(m) } }, retry: { tests: 'node --test --test-reporter=tap {file}' }, localRuns: 'on-request', subsetLaneSuites: ['journeys'] } })
test('AC1.1: a CI-answered run whose only local suite is listed takes the subset lane (#5368)', ...)
  // runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch], ...)
  // code 0; journeys marker written; reportOf(r).slot.lane === 'subset'; fs.readdirSync(dir) deepEqual ['subset']
test('AC3.1: the same run without subsetLaneSuites takes the full lane (#5368)', ...)
  // same decl minus subsetLaneSuites → slot.lane === 'full'
test('AC3.2: a listed suite beside an unlisted declared suite still takes the full lane (#5368)', ...)
  // declare a third suite `other: markerCommand(m2)` (no ci entry), subsetLaneSuites ['journeys'] → slot.lane === 'full'
```

In `impact-cli.test.js`, beside `AC4.1` (#5119):

```js
test('AC2.1: an impact subset plus a listed declared suite takes the subset lane (#5368)', ...)
  // impactRepo(declOf({}, { checks: { tests: { tests: 'node scripts/full.js', small: <node -e marker cmd> } }, subsetLaneSuites: ['small'] }))
  // with RULES (or an override rule) selecting both the impact subset and `small`; writeMap; commitFile src/x.js
  // runCli(ARGS, r.repo, { env: slotEnv(slotDir) }) → code 0; subset command ran; small ran; report().slot.lane === 'subset'
```

In `cli-slot.test.js`:

```js
test('AC4.1: --cmd under a listed name takes the full lane (#5368)', ...)
  // scopedRepo([{ match: '**', suites: ['other'], static: false }], { subsetLaneSuites: ['other'] }); commit a change;
  // runCli(['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `other=${r.unitCmd}`], { cwd: r.repo, env: slotEnv(tmpDir()) })
  // code 0; reportAt(r).slot.lane === 'full'
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bin-lib/verify/ci-cli.test.js tests/bin-lib/verify/impact-cli.test.js tests/bin-lib/verify/cli-slot.test.js`
Expected: FAIL — AC1.1 and AC2.1 report `full`; AC3.x and AC4.1 pass already (controls).

- [ ] **Step 3: Implement** in `verify.js`: build `const subsetLaneNames = new Set(decl ? decl.subsetLaneSuites : [])` and `const cmdNames = new Set(parsed.cmds.map((c) => c.name))`; add `&& !(subsetLaneNames.has(c.name) && !cmdNames.has(c.name))` to the `fullSuiteRuns` predicate. Update the comment above it to name the exclusion (#5368). Update `slot.js:44`'s comment.

- [ ] **Step 4: Docs + declaration.** `suite-slots.md` Lanes table: full row → "any local suite runs its full command: a `--cmd`, or a declared suite command not listed in `subsetLaneSuites`"; subset row adds "or a declared suite listed in `subsetLaneSuites` runs its own command". Below the table, one bullet: `subsetLaneSuites` (top-level declaration key, an array of declared suite names, never `impact.suite`) marks small declared suites that should not queue behind whole-suite runs; a `--cmd` under a listed name still takes the full lane; `report.json`'s `slot.lane` reports the lane chosen. Update `docs/plugin-structure.md:103`. Add the key to `.claude-tweaks/verify-scope.json`.

- [ ] **Step 5: Run to verify pass**

Run: `node --test tests/bin-lib/verify/ci-cli.test.js tests/bin-lib/verify/impact-cli.test.js tests/bin-lib/verify/cli-slot.test.js tests/bin-lib/verify/slot.test.js tests/bin-lib/verify/declaration.test.js tests/verify-scope-declaration.test.js`
Expected: PASS (all).

- [ ] **Step 6: Commit** — `git add` each modified file by path; message `Keep listed small declared suites out of the full slot lane — refs #5368`.
