# verify.js: --scope with --baseline Implementation Plan (#3511)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bin/verify.js` accepts `--baseline <ref>` alongside `--scope`, resolving each failing check's per-file template from an explicit `--baseline-cmd` or the declaration's `retry.{suite}` template, instead of exiting 2.

**Architecture:** `args.js` has no fs access, so under `--scope` it stops enforcing the two `--baseline-cmd` guards that need the declaration (at-least-one, names-a-`--cmd`). `verify.js`'s `--scope` block, which already reads the declaration, takes those checks over and builds the effective name→template map handed to `adjudicate()`. The unscoped path is unchanged.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T194624-record-3511/work/3511-spec.md`

**Scope keywords:** `baselineCmds`, `--baseline-cmd`

## Global Constraints

- Exit codes stay as documented: 0 pass (incl. adjudicated), 1 failure / not adjudicated, 2 malformed invocation.
- Without `--scope`, every existing `--baseline`/`--baseline-cmd` usage error and message is unchanged (`tests/bin-lib/verify/args.test.js:314-331` stay green untouched).
- `plugin/skills/test/verification.md` is 46,342 B against the 52,500 B `RAIL_BYTES` rail; this plan adds < 1.5 KB (headroom stays > 4.5 KB).
- Commit messages: `{Verb} {what} — {detail}`, `refs #3511`, never `closes`/`fixes`.

## Review Focus

1. `--scope` + `--baseline` + explicit `--baseline-cmd` for one suite, retry template for another: explicit wins per name, template fills the rest (Task 2 test `AC1.1 explicit wins`).
2. `--baseline-cmd` naming `types`/`lint` that has a `--cmd`: still accepted under `--scope` (allowed set = `--cmd` names ∪ declared suites).
3. String-form `checks.tests` (suite `tests`) with `retry.tests`: resolves exactly like a map-form suite — the name is `tests`.
4. `--baseline` under `--scope` where the declaration has no `retry` at all and no `--baseline-cmd`: exit 2 naming the gap, never a silent `not adjudicated` at the end of a 10-minute run (Task 2 test).
5. `--scope` mode `none` with `--baseline`: nothing runs, nothing adjudicates, exit 0 — unaffected (no new code path; covered by existing `rawPass` gate).

---

### Task 1: args.js — defer the declaration-dependent `--baseline-cmd` guards under `--scope`

**Files:**
- Modify: `plugin/bin/lib/verify/args.js:278-288` (validateCheckRun), `:7-31` (USAGE)
- Test: `tests/bin-lib/verify/args.test.js`

**Interfaces:**
- Produces: `parseArgs` returns `baseline` set and `baselineCmds: []` for `--scope x --baseline r`; returns a `baselineCmds` entry whose name matches no `--cmd` when `--scope` is present. Template-`{file}` and duplicate-name checks still throw in both modes.

- [ ] **Step 1: Write the failing tests** (append after `args.test.js:331`)

```js
test('--scope: --baseline without --baseline-cmd parses — the declaration retry template is resolved by verify.js (#3511)', () => {
  const got = parseArgs(['--scope', 'd.json', '--integration-branch', 'main', '--baseline', 'origin/main']);
  assert.strictEqual(got.baseline, 'origin/main');
  assert.deepStrictEqual(got.baselineCmds, []);
});
test('--scope: --baseline-cmd naming a suite with no --cmd parses — verify.js checks it against the declaration (#3511)', () => {
  const got = parseArgs(['--scope', 'd.json', '--integration-branch', 'main', '--baseline', 'x', '--baseline-cmd', 'unit=node --test {file}']);
  assert.deepStrictEqual(got.baselineCmds.map((b) => b.name), ['unit']);
});
test('--scope: a --baseline-cmd template without {file} and a duplicate name are still usage errors (#3511)', () => {
  const s = ['--scope', 'd.json', '--integration-branch', 'main', '--baseline', 'x'];
  assert.throws(() => parseArgs([...s, '--baseline-cmd', 'unit=npm test']), /must contain \{file\}/);
  assert.throws(() => parseArgs([...s, '--baseline-cmd', 'unit=a {file}', '--baseline-cmd', 'unit=b {file}']), /duplicate --baseline-cmd name: unit/);
});
test('USAGE states --baseline-cmd is optional under --scope (#3511)', () => {
  assert.match(USAGE, /under --scope, --baseline-cmd is optional/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/verify/args.test.js`
Expected: FAIL after Step 1 — `--baseline requires at least one --baseline-cmd` / `names no declared --cmd` / USAGE assertion.

- [ ] **Step 3: Implement in `validateCheckRun`**

Guard the `--baseline requires at least one --baseline-cmd` throw with `&& !raw.scope`, and the `names no declared --cmd` throw with `!raw.scope &&`. Add a USAGE `\nnote:` line: `under --scope, --baseline-cmd is optional and may name a declared suite — each failing check falls back to the declaration's retry.{suite} template (#3511).` Add a one-line comment at each relaxed guard naming verify.js's scope block as the owner.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/verify/args.test.js`
Expected: PASS, all prior tests included.

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/verify/args.js tests/bin-lib/verify/args.test.js` then `git commit -m "Defer scoped --baseline-cmd guards to verify.js — args.js cannot read the declaration (refs #3511)"`

### Task 2: verify.js — resolve the baseline template map from the declaration

**Files:**
- Modify: `plugin/bin/verify.js` — the `if (parsed.scope)` block (right after the `--cmd`-vs-declaration check, ~line 335) and the `adjudicate({ baselineCmds: … })` call (~line 531)
- Test: `tests/bin-lib/verify/cli.test.js` (append after the `#3043` baseline block, ~line 2275)

**Interfaces:**
- Consumes: Task 1's relaxed `parseArgs`; `decl.suites: string[]`, `decl.retry: {[suite]: template}` (declaration.js).
- Produces: a local `baselineCmdMap: Map<string, string>` built once before the scope block as `new Map(parsed.baselineCmds.map((b) => [b.name, b.template]))`, passed to `adjudicate` in place of the inline `new Map(...)`.

- [ ] **Step 1: Write the failing tests**

Fixture helper `scopedBaselineRepo({ retry })`: `baselineRepo()` (base commit with failing `tests/env.test.js` + passing `tests/ok.test.js`), capture `branch = symbolic-ref --short HEAD`, `git checkout -q -b feature`, then `commitFile` a declaration `{ checks: { tests: { unit: <SUITE command>, other: 'node -e 0' } }, retry, rules: [{ match: 'src/**', suites: ['unit'], static: false }, { match: '.claude-tweaks/**', suites: [], static: false }] }` and `src/a.js`. Return `{ ...r, branch, scoped: ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--baseline', branch, '--no-stamp'] }`. `retry` defaults to `{ unit: 'node --test --test-reporter=tap {file}' }`. Run every CLI call with `r.opts` (nestedRunEnv).

```js
test('AC1.1: --scope + --baseline with no --baseline-cmd adjudicates via the declaration retry template — exit 0, never 2, report carries scope and baselineAdjudicated (#3511)', async () => {
  const r = scopedBaselineRepo();
  const { code, stdout, stderr } = await runCli(r.scoped, r.opts);
  assert.notStrictEqual(code, 2, stderr);
  assert.strictEqual(code, 0, stdout + stderr);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  // No prior stamp anchor → selectScope forces mode full (scope.js), exactly #3401's incident shape.
  assert.strictEqual(report.scope.mode, 'full');
  assert.deepStrictEqual(report.scope.suites, ['unit', 'other']);
  assert.strictEqual(report.baselineAdjudicated.verdict, 'pass');
  assert.deepStrictEqual(report.baselineAdjudicated.baselineFailing, ['tests/env.test.js']);
});
test('AC1.1: --scope + --baseline-cmd naming a declared suite with no --cmd is accepted and wins over the retry template (#3511)', async () => {
  const r = scopedBaselineRepo({ retry: { unit: 'node -e "process.exit(9)" {file}' } });
  const { code, stdout, stderr } = await runCli([...r.scoped, '--baseline-cmd', 'unit=node --test --test-reporter=tap {file}'], r.opts);
  assert.strictEqual(code, 0, stdout + stderr);
});
test('--scope: a --baseline-cmd naming neither a --cmd nor a declared suite is a usage error (exit 2) before any check runs (#3511)', async () => {
  const r = scopedBaselineRepo();
  const { code, stderr } = await runCli([...r.scoped, '--baseline-cmd', 'web=node --test {file}'], r.opts);
  assert.strictEqual(code, 2);
  assert.match(stderr, /--baseline-cmd "web" names no --cmd or declared suite \(--cmd: none; suites: unit, other\)/);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify', 'unit.log')));
});
test('--scope: --baseline with no --baseline-cmd and no declared retry template is a usage error (exit 2) (#3511)', async () => {
  const r = scopedBaselineRepo({ retry: undefined });
  const { code, stderr } = await runCli(r.scoped, r.opts);
  assert.strictEqual(code, 2);
  assert.match(stderr, /--baseline: no --baseline-cmd and the declaration has no retry template/);
});
```

(`retry: undefined` must drop the key so the declaration has no `retry`; JSON.stringify does.) The explicit-wins test proves precedence: the retry template exits 9 with no TAP output, so had it been used the file could not classify and the run would exit 1.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="3511" tests/bin-lib/verify/cli.test.js`
Expected: FAIL after Step 1 — the first exits 1 with `Baseline: not adjudicated — no --baseline-cmd for failing check unit` (Task 1 already lets it parse); the third exits 1 (no name check yet); the fourth exits 1. The second already passes after Task 1 (its explicit template reaches `adjudicate` as before) — it pins precedence over the retry template once Step 3 adds the fallback, and goes red if Step 3 lets the template overwrite an explicit entry.

- [ ] **Step 3: Implement in the `--scope` block, directly after the `--cmd`-vs-declaration check**

When `parsed.baseline` is set: (a) for each `parsed.baselineCmds` entry whose name is in neither `parsed.cmds` names nor `decl.suites`, `scopeUsageExit` with ``--baseline-cmd "${name}" names no --cmd or declared suite (--cmd: ${cmdNames || 'none'}; suites: ${decl.suites.join(', ') || 'none'})`` and return; (b) for each `name` in `decl.suites` not already in `baselineCmdMap` with `decl.retry[name]` set, `baselineCmdMap.set(name, decl.retry[name])`; (c) if `baselineCmdMap.size === 0`, `scopeUsageExit('--baseline: no --baseline-cmd and the declaration has no retry template (declared suites: …) — pass --baseline-cmd <suite>=<template-with-{file}> or declare retry')` and return. Replace the `adjudicate` call's inline `new Map(...)` with `baselineCmdMap`. Comment cites #3511.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/verify/cli.test.js`
Expected: PASS, every pre-existing test included.

- [ ] **Step 5: Go-red check (AC2.1)** — temporarily re-add `if (raw.baseline !== null && raw.baselineCmds.length === 0) throw new UsageError('--baseline requires at least one --baseline-cmd');` unguarded in `args.js`, run the AC1.1 no-`--baseline-cmd` test, confirm it FAILS on `code === 2`, then restore. Record the output in the commit body's first line as `go-red: AC1.1 fails with code 2 when the guard is restored`.

- [ ] **Step 6: Commit** — `git add plugin/bin/verify.js tests/bin-lib/verify/cli.test.js` then `git commit -m "Resolve scoped --baseline templates from the declaration — explicit --baseline-cmd first, else retry.{suite} (refs #3511)"`

### Task 3: Prose — state the combined invocation once, cite it elsewhere

**Files:**
- Modify: `plugin/skills/test/verification.md:79-85` (Scoped invocation), `:134-138` (Baseline adjudication)
- Modify: `plugin/skills/flow/steps-and-gates.md:163` (test gate row)
- Modify: `docs/plugin-structure.md:167` (`--baseline` clause)
- Test: `tests/bin-lib/verify/snippet-conformance.test.js`

**Interfaces:** Consumes Tasks 1-2's behavior; message strings must match Task 2 exactly.

- [ ] **Step 1: Write the failing test** — in the existing `'the scoped re-verify invocation parses clean…'` test, add `assert.strictEqual(parsed.baseline, 'origin/main', 'a scoped site passes --baseline on the same invocation (#3511)');`, and add:

```js
test('verification.md states the map-form baseline resolution rule (#3511)', () => {
  const section = DOC.slice(DOC.indexOf('### Baseline adjudication'), DOC.indexOf('### Declared pre-existing failures'));
  assert.ok(section.includes('`retry.{name}`'), 'names the retry fallback');
  assert.ok(section.includes('names no `--cmd` or declared suite'), 'names the one usage error');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/verify/snippet-conformance.test.js`
Expected: FAIL after Step 1 — `parsed.baseline` is null; the two phrases are absent.

- [ ] **Step 3: Edit the prose**

- Scoped snippet: insert `--baseline origin/{ref}` after `--integration-branch {ref}`.
- After the snippet's following paragraph, add a paragraph: `**Baseline on the same invocation (#3511).** When the declaration gives a \`retry.{suite}\` template, a scoped site adjudicates a failure on this same command — the \`--baseline origin/{ref}\` shown above — never by abandoning the scoped form for a second, unscoped full run; \`--baseline-cmd\` resolves per Baseline adjudication's map-form rule below. With no \`retry\` template, drop \`--baseline\` (the runner refuses it, exit 2).`
- Baseline adjudication, after the indented invocation: a paragraph stating that block is the unscoped (explicit `--cmd`) form, and that **under `--scope`** `--baseline-cmd` is optional — each failing check takes an explicit `--baseline-cmd {name}=…` when given, else the declaration's `retry.{name}` template; a `--baseline-cmd` may name a `--cmd` or any declared suite, and one that names no `--cmd` or declared suite is a usage error (exit 2), as is `--baseline` with no `--baseline-cmd` and no declared `retry` template.
- `steps-and-gates.md` test row Gate-condition cell: append ` A scoped re-verify adjudicates a failure against the integration branch on the same invocation — \`test/verification.md\`'s Re-verify scoping and Baseline adjudication.`
- `docs/plugin-structure.md:167`: after `(#3043; contract in skills/test/verification.md's Baseline adjudication)` add `— under --scope, --baseline-cmd is optional and may name a declared suite, falling back to the declaration's retry.{suite} template (#3511)`.

- [ ] **Step 4: Run** `node --test tests/bin-lib/verify/snippet-conformance.test.js tests/test-skill-affected-conformance.test.js tests/verification-flake-handling.test.js tests/verification-skip-before-execute.test.js tests/timing-prose-conformance.test.js` — Expected: PASS. Then `wc -c plugin/skills/test/verification.md` — Expected: < 52500.

- [ ] **Step 5: Commit** — `git add plugin/skills/test/verification.md plugin/skills/flow/steps-and-gates.md docs/plugin-structure.md tests/bin-lib/verify/snippet-conformance.test.js` then `git commit -m "State scoped --baseline in verification.md — one invocation adjudicates a scoped failure (refs #3511)"`

### Task 4: Full suite (AC3.1)

- [ ] Run `npm test > {scratch}/npm-test-3511.txt 2>&1; echo exit=$?` (foreground) — Expected: `exit=0`; folded into Build Common Step 5's runner verification.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (verify.js accepts `--baseline` with `--scope`; suite name or retry fallback) | 1, 2 |
| Deliverable 2 (verification.md table + Baseline section; steps-and-gates cites) | 3 |
| Deliverable 3 (cli.test.js pins combined invocation + usage error only when neither matches) | 2 |
| AC1.1 | Task 2 tests `AC1.1: …` |
| AC2.1 | Task 2 Step 5 go-red |
| AC3.1 | Task 4 |

## Build deviations (Common Step 4.5 — all Beneficial)

| # | Plan said | Built | Why |
|---|---|---|---|
| 1 | Task 2 changes only verify.js's scope block | Also `runChecks({ continueSuitesAfterFailure })` in `plugin/bin/lib/verify/run.js`, on for every `--baseline` run (ae842f7) | `baseline.js` refuses any fail-fast-skipped check; this repo's declaration runs `tests` then `journeys`, so a failing `tests` would still leave the #3401 run "not adjudicated" |
| 2 | Task 3 edits verification.md, steps-and-gates.md, plugin-structure.md:167 | Also plugin-structure.md:53 and docs/journeys/run-a-deterministic-verification-check.md (ade0a67..c5753a2) | Deviation 1 made the unconditional fail-fast sentences false |
| 3 | `envOf` untouched | `envOf` resolves through the effective `cmds` set (2582dbe) | Whole-branch review: a declared-only suite's `--cmd-env` never reached the per-file baseline/isolated runs — a false-pass path the new combination made reachable |
