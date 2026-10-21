# Retire compose-subject `--shell` and sweep plugin/skills for eval fences — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sweep test proving that no fenced block in `plugin/skills/**` evals `compose-subject.js --shell` output, then retire the now-unconsumed `--shell` flag.

**Architecture:** The record's premise that four local-merge fences still `eval` the composer is no longer true. #3522 (`52aabeb84`) already moved every local-merge and pr-first fence to `--out-dir "{subject-dir}"` with `git merge -F` / `gh pr merge --body-file`, and pinned those five named files in `tests/merge-subject-composer-conformance.test.js`. What remains is generalizing that pin into a whole-tree sweep (AC1) and deleting `--shell` from `plugin/bin/lib/compose-subject.js`, the flag's last non-test consumer surface. Deleting it is the "remove the old" half of expand-contract.

**Tech Stack:** Node 18+, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T220853-record-3537/work/3537-spec.md`

**Scope keywords:** `--shell`, `SUBJECT_EXPORTS`, `SUBJECT_TITLE`

## Global Constraints

- Composed bundles stay under the 51,200-byte ceiling (`tests/bin-lib/skill-audit/context-cost.test.js`). This plan edits no `plugin/skills/**/*.md` file, so no bundle grows. The byte-pin and rail checks are n/a.
- Every shipped fence keeps its `|| exit 1`-equivalent stop on a non-zero composer exit. #3522 already did this, and the sweep must not weaken it.
- Commit messages say `refs #3537`, never `closes`/`fixes`.

## Review Focus

- A future skill that re-introduces `SUBJECT_EXPORTS=$(… compose-subject.js … --shell)` in an **indented** fence, as list-item fences are in `_shared/local-merge-auto-finish.md`, must still be caught. Task 1's extractor accepts leading whitespace before the backticks.
- A `compose-subject.js` call inside a fence of a nested directory, such as `plugin/skills/wrap-up/modes/x.md`, must be reached. Task 1's go-red control writes into a nested temp subdirectory.
- A sweep that silently walks zero files passes vacuously. Task 1 asserts that the walked set contains the five known merge sites.
- After retirement, an old command line passing `--shell` must fail loudly (exit 1, `unknown argument: --shell`) and never silently fall through to JSON output. Task 2 pins this.
- `--out-dir` stdout still prints the single-quoted title through `shellQuote`. Task 2 keeps `shellQuote` exported and keeps the AC2.2 out-dir test intact.

---

### Task 1: Whole-tree sweep — no fence evals compose-subject `--shell` output

**Files:**
- Modify: `tests/merge-subject-composer-conformance.test.js` (append a helper plus two tests at the end)

**Interfaces:**
- Produces: `sweepShellEvalFences(root: string) -> { files: string[], hits: Array<{ file: string, fence: string }> }`. It is file-local to the test.

- [ ] **Step 1: Write the sweep and its go-red control**

Add `fs`/`os` requires. `sweepShellEvalFences(root)` walks `root` recursively and collects `*.md`, skipping `node_modules`. It reads each file through `readText` and extracts fenced blocks: an opening line matching `/^\s*```/` through the next line matching `/^\s*```\s*$/`. A fence is a hit when it contains `compose-subject.js` AND any of `--shell`, `SUBJECT_EXPORTS`, or `/\beval\b/`. It returns `files` (repo-relative to `root`) and `hits`.

```js
test('AC1.1: no fenced block anywhere in plugin/skills/** evals compose-subject.js --shell output', () => {
  const { files, hits } = sweepShellEvalFences(path.join(ROOT, 'plugin/skills'));
  for (const rel of [PR_FIRST, ...LOCAL_SITES]) {
    assert.ok(files.includes(path.relative(path.join(ROOT, 'plugin/skills'), path.join(ROOT, rel))), `sweep reached ${rel}`);
  }
  assert.deepEqual(hits, []);
});

test('AC1.1 go-red: the same sweep flags a frozen pre-#3522 eval fence, indented and nested', () => {
  // temp root: nested/dir/a.md holds PRE_EVAL_LOCAL_SITE inside an indented ```bash fence;
  // b.md holds PRE_EVAL_PR_FIRST_SITE in a top-level fence; c.md holds a clean --out-dir fence.
  const { hits } = sweepShellEvalFences(tmpRoot);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.file).sort(), [path.join('nested', 'dir', 'a.md'), 'b.md']);
  // cleanup in finally (fs.rmSync recursive)
});
```

The control calls the exact `sweepShellEvalFences` function the positive test calls (plan-authoring Go-red control check).

- [ ] **Step 2: Run the suite**

Run: `node --test tests/merge-subject-composer-conformance.test.js`
Expected: PASS. This step is append-shaped: #3522 already cleaned the live tree, so the positive test passes on arrival. Red is proven by the go-red test, which exercises the same function against frozen pre-change fences.

- [ ] **Step 3: Prove discrimination by mutation**

Temporarily change the hit predicate to require a token that never appears, e.g. `'--shellX'`. Re-run the suite and expect the go-red test to FAIL with `hits.length` 0 !== 2. Restore the predicate, re-run, and expect PASS. Leave no scratch edits behind (`git diff` shows only the intended change).

- [ ] **Step 4: Commit**

```bash
git add tests/merge-subject-composer-conformance.test.js
git commit -m "Sweep plugin/skills for compose-subject --shell eval fences — AC1 of refs #3537"
```

### Task 2: Retire `--shell` from compose-subject.js

**Files:**
- Modify: `plugin/bin/lib/compose-subject.js` (header usage/output comment lines 17-30, `USAGE` line 73, `parseArgs` lines 97/101/120, output branch lines 382-383)
- Modify: `tests/bin-lib/compose-subject.test.js` (every `--shell` use, listed below)
- Modify: `docs/plugin-structure.md` lines 61 and 192 (drop `--shell` from the flag lists and the "eval-able --shell output" wording)
- Modify: `docs/journeys/merge-a-record-with-a-conventional-subject-2251.md` (append one Origin bullet)

Consumer enumeration (grep `--shell` / `opts.shell` / `SUBJECT_TITLE` across `plugin/`, `tests/`, `docs/`, `evals/`, `scripts/`, `tools/`, `.claude/`):
- `plugin/skills/**`: none since #3522, which Task 1 pins.
- `plugin/bin/compose-subject.js`: a thin wrapper with no flag text.
- `tests/bin-lib/compose-subject.test.js`: these are the migrations below.
- `tests/merge-subject-composer-conformance.test.js`: only frozen pre-change fixtures and absence asserts. Keep them unchanged.
- `docs/plugin-structure.md`: two lines.
- The 2251 journey: a historical Origin bullet. Append, don't rewrite.

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `parseArgs` returns opts without a `shell` key. `run` has two output modes: JSON (default) and `--out-dir`. `shellQuote` stays exported because `--out-dir` stdout uses it.

- [ ] **Step 1: Write the failing test**

Replace the `'--out-dir and --shell together is a usage error, exit 1'` test with:

```js
test('--shell is retired (#3537): an unknown argument, exit 1, nothing composed or written', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2251', '--shell'], deps), 1);
  assert.match(out.stderr, /unknown argument: --shell/);
  assert.equal(out.stdout, '');
  assert.equal(out.calls.length, 0);
  assert.equal(parseArgs(['2251']).shell, undefined);
  const { USAGE } = require('../../plugin/bin/lib/compose-subject.js');
  assert.doesNotMatch(USAGE, /--shell/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node -e 'process.exit(require("./plugin/bin/lib/compose-subject.js").parseArgs(["2251","--shell"]).error ? 0 : 1)'`
Expected: FAIL (exit 1). `parseArgs` still accepts `--shell`, so it returns no `error`. Then run `node --test tests/bin-lib/compose-subject.test.js` and expect the new `--shell is retired` test to FAIL.

- [ ] **Step 3: Remove `--shell` from `plugin/bin/lib/compose-subject.js`**

Remove the `shell` opt, its parse branch, the `--out-dir`/`--shell` mutual-exclusion check, the `else if (opts.shell)` output branch, and `[--shell]` from `USAGE` and the header usage line. Rewrite the header's Output paragraph: JSON by default, or `--out-dir` files. Add one line saying `--shell` (eval-able `SUBJECT_TITLE=`/`SUBJECT_BODY=` assignments) was retired in #3537 after #3522 moved every fence to `--out-dir`. Keep `shellQuote` and its export.

- [ ] **Step 4: Migrate the remaining `--shell` uses in `tests/bin-lib/compose-subject.test.js`**

- `parseArgs` test (line ~65): drop `'--shell'` from the argv and the `o.shell` assert. Rename it to `'parseArgs: comma-joined and space-separated numbers, --tag, --repo'`.
- `'--shell prints two eval-able sh assignments…'` (line ~185): delete the test. Move its trailing `assert.equal(shellQuote("a'b"), "'a'\\''b'")` into `'AC2.2: --out-dir stdout is the single-quoted title on one line'`.
- `AC1.1`, `AC2.1`, `AC2.2`, `AC2.3` (scope tests, lines ~492-516), the `--pr` test (~566), the non-ASCII test (~621), the explicit-scope test (~627), and the empty-list test (~635): drop `'--shell'` from argv. Assert on `JSON.parse(out.stdout).title` instead of `out.stdout`. For example, `/^SUBJECT_TITLE='feat\(api\): /` becomes `assert.match(JSON.parse(out.stdout).title, /^feat\(api\): /)`. Unanchored matches like `/\(bin\)/` apply to `.title` unchanged.
- `'AC2.1: --out-dir writes … equal to the --shell values'` (~658): rename it to `'AC2.1: --out-dir writes title.txt/body.md/message.txt equal to the JSON values'` and delete its trailing `--shell` comparison block.
- `parseArgs(['2251', '--scope', '--shell'])` and `parseArgs(['2251', '--out-dir', '--shell'])`: replace `'--shell'` with `'--tag'`. They stay "followed by another flag" errors.

- [ ] **Step 5: Run the composer suites**

Run: `node --test tests/bin-lib/compose-subject.test.js tests/merge-subject-composer-conformance.test.js`
Expected: PASS, with 0 failures.

- [ ] **Step 6: Update docs**

In `docs/plugin-structure.md` line 61, change "as JSON or --shell assignments, or (--out-dir …)" to "as JSON, or (--out-dir …)". In line 192, drop `[--shell]` from the usage and "eval-able --shell output" from the description. Append to the 2251 journey Origin: `- Updated during build of #3537 (retire --shell): the composer's eval-able --shell output is gone; JSON and --out-dir are the only output forms, and a plugin/skills/** sweep pins that no fence evals composer output`.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/compose-subject.js tests/bin-lib/compose-subject.test.js docs/plugin-structure.md docs/journeys/merge-a-record-with-a-conventional-subject-2251.md
git commit -m "Retire compose-subject --shell — no shipped fence consumes it since #3522 (refs #3537)"
```

### Task 3: AC2 verification

**Files:** none (verification only).

- [ ] **Step 1: Run the AC2 command and the bundle ceiling suite**

Run: `node --test tests/merge-subject-composer-conformance.test.js tests/bin-lib/compose-subject.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 failures. This covers AC2.1: the named suites pass and the composed bundles stay under the 51,200-byte ceiling.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (migrate four fences) | Already shipped by #3522 (`52aabeb84`). Task 1's sweep pins it tree-wide. |
| Deliverable 2 (conformance test + 2251 journey local-merge forms) | Already shipped by #3522. Task 2 Step 6 appends the #3537 journey note. |
| Deliverable 3 (extend sweep, retire `--shell`) | Tasks 1 and 2 |
| AC1.1 | Task 1 |
| AC2.1 | Task 3 |
