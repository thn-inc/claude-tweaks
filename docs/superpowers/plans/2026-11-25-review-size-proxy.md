# Review Size Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:review` Step 2.5's record-size proxy counts code, not the pipeline's own bookkeeping files and lockfiles, and a comment-only schema edit no longer fires the risk proxy.

**Architecture:** A pure module (`plugin/bin/lib/review-context/size-proxy.js`) turns `git diff --numstat` text plus the parsed verify-scope declaration into `{ files, lines, size, excluded }`. A new `size-proxy` verb on `plugin/bin/build-review-context.js` gathers those inputs from git and prints the result as one JSON line. `review-effort-derivation.md` step 3 calls the verb and falls back to the unfiltered `--stat` totals on any failure.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T084251-record-5148/work/5148-spec.md`

Scope keywords: size-proxy, ALWAYS_STUB_BASENAMES

## Global Constraints

- Size thresholds are unchanged: **high** at 10+ files or 300+ lines; **medium** at 3-9 files or 50-299 lines; **low** otherwise. `lines` = added + deleted.
- `excluded[].reason` is exactly `bookkeeping` or `lockfile`.
- `*.md` is **not** excluded in general; `*.jsonl` stays counted. Only declared bookkeeping paths and lockfile basenames are excluded.
- A rule is bookkeeping by shape only: `Array.isArray(rule.suites) && rule.suites.length === 0 && rule.static === false && !rule.impact`. First matching rule wins (the `selectScope` loop: `decl.rules.findIndex((r) => globToRegExp(r.match).test(file))`). Never re-implement glob matching — use `globToRegExp` from `plugin/bin/lib/issues/blast-radius.js`.
- With `decl === null` (no declaration or unreadable), fall back to `BOOKKEEPING_RULES` from `plugin/bin/lib/init/verify-scope-starter.js`. A non-null declaration replaces the fallback list entirely.
- The size proxy fails toward the higher count: CLI failure → use unfiltered `--stat` totals, never a guessed lower tier.
- Do not add text to `plugin/skills/review/code-mode-steps.md` (it sits at its read rail, #5076).
- CLI exit codes: 0 ok, 2 malformed invocation, 1 git failure (stdout empty on 1).
- Governing skill `gh-api-module-pattern` (`git-seam.md`), quoted: "**A module that parses git's output pins that output's format against the user's and the repo's git config.** … For a path list, pass `-z`, which prints every path verbatim (`plugin/bin/lib/verify/changed-files.js`). For patch text, pass every flag explicitly". And: "**An argv array stops shell injection, not flag injection.** … For `git` the separator is **`--end-of-options`, not `--`**". → the numstat call is `git -c core.quotePath=false diff --numstat -z --no-renames --no-color --no-ext-diff --end-of-options {base}...{branch}`.
- Governing skill `bin-source-scan-conformance`: every `execFileSync` in `plugin/bin/` passes `windowsHide: true` — reuse `build.js`'s `realGit` (already compliant) rather than a new spawn.
- Byte-pin: `plugin/skills/review/review-effort-derivation.md` is 9,301 B against `RAIL_BYTES` 52,500 B — ample headroom; no cut needed.
- Existing prose pins in `review-effort-derivation.md` must survive verbatim: `**high** at 10+ files`, `cross-package interface gives risk proxy \`medium\``, `10+ files gives size proxy \`high\``, `label low, diff heuristic high`, `labels never lower a tier the diff already earns` (`tests/review-effort-label-diff-conformance.test.js`), and the mint/`--print-dir`/labels-on-stdin text pinned by `tests/bin-lib/review-context/prose.test.js`.

## Review Focus

- A rename in the diff: `--no-renames` must make it a delete + add, never an `old => new` path that matches no rule.
- A path containing spaces or non-ASCII: `-z` + `core.quotePath=false` keep it matching its glob.
- A `--files-from` list with blank lines / trailing whitespace: trimmed and ignored, as `build.js` does.
- A declaration that is present but invalid (`readDeclaration` → `ok: false`): treated as `decl: null` (fallback list), not as "no exclusions".
- A file that is both a lockfile and under a bookkeeping glob: excluded once (bookkeeping checked first), never double-listed.

---

### Task 1: Pure size-proxy module

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/review-context/size-proxy.js`
- Modify: `plugin/bin/lib/review-context/build.js` (export `ALWAYS_STUB_BASENAMES` in `module.exports`; no other change)
- Test: `tests/bin-lib/review-context/size-proxy.test.js`

**Interfaces:**
- Consumes: `globToRegExp(glob) -> RegExp` (`../issues/blast-radius`), `BOOKKEEPING_RULES: string[]` (`../init/verify-scope-starter`), `ALWAYS_STUB_BASENAMES: Set<string>` (`./build`).
- Produces (all exported from `size-proxy.js`):
  - `parseNumstat(text: string) -> Array<{ file: string, lines: number }>` — records split on `\0` when the text contains one, else on `\n`; each record is `added\tdeleted\tpath` (path = everything after the second tab); `-\t-` (binary) → `lines: 0`; empty records skipped.
  - `classifyPath(file: string, decl: object|null) -> 'bookkeeping'|'lockfile'|null` — bookkeeping checked first (declared rules first-match by shape, or `BOOKKEEPING_RULES` when `decl` is null), then lockfile by basename (`/` or `\` separated).
  - `sizeTier(files: number, lines: number) -> 'low'|'medium'|'high'`.
  - `computeSizeProxy({ numstat: string, decl: object|null, ownWork?: string[]|null }) -> { files, lines, size, excluded: [{ file, lines, reason }] }` — when `ownWork` is a non-null array, entries not in it are dropped before classification (not listed in `excluded`).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/review-context/size-proxy.test.js` (decl objects are hand-built `{ rules: [...] }` in `readDeclaration`'s normalized shape):
  - `AC1.1: 13 files / 350 lines with 10 bookkeeping files / 290 lines → files 3, lines 60, size medium` — fixture: 3 code files totalling 60 lines, 10 paths under `.claude-tweaks/pipelines/r/work/1-spec.md`, `docs/superpowers/plans/*.md`, `docs/plans/x-ledger.md` totalling 290; `decl: null`. Assert `{files: 3, lines: 60, size: 'medium'}`, `excluded.length === 10`, every reason `'bookkeeping'`, and the 10 paths deep-equal (sorted).
  - `AC2.1: package-lock.json (274 lines) is excluded as lockfile; tests/fixtures/x.jsonl is counted` — also assert a nested `sub/yarn.lock` is excluded.
  - `AC3.1: a declaration replaces the fallback list — a plan file is counted when only the ledger rule is declared` — rules `[{ match: 'docs/plans/*-ledger.md', suites: [], static: false }]`; `docs/superpowers/plans/p.md` counted, ledger excluded.
  - `AC3.2: with decl null the same plan file is excluded through BOOKKEEPING_RULES`.
  - `AC4.1: first matching rule wins — a suite-selecting rule ahead of a bookkeeping rule keeps the path counted` — rules `[{ match: '**/*.md', suites: '*', static: true }, { match: 'docs/plans/*-ledger.md', suites: [], static: false }]`; ledger path counted. Also an `impact: true, suites: null` rule first → counted, and `{suites: [], static: true}` → counted (shape requires `static: false`).
  - `AC5.1: a binary file (-\t-\tpath) counts as one file with 0 lines`.
  - `AC6.1: ownWork restricts the count to the listed paths`.
  - `parseNumstat` reads both NUL- and newline-separated input and keeps a path containing a space and a tab-free non-ASCII name intact.
  - `sizeTier` boundaries: `(2,49)→low`, `(3,0)→medium`, `(0,50)→medium`, `(9,299)→medium`, `(10,0)→high`, `(0,300)→high`.
  - A path that is a lockfile under a bookkeeping glob is listed once with reason `bookkeeping`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/review-context/size-proxy.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/review-context/size-proxy'`.

- [ ] **Step 3: Implement** `size-proxy.js` with the four exports above (header comment citing #5148 and stating it is pure: no fs, no git), and add `ALWAYS_STUB_BASENAMES` to `build.js`'s `module.exports`. Thresholds live as named constants in the module.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/review-context/size-proxy.test.js tests/bin-lib/review-context/build.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Go-red proof (AC9.1)** — temporarily revert each exclusion rule in turn (make `classifyPath` return `null` for bookkeeping; then for lockfile; then drop the `static === false` shape check; then drop the first-match `findIndex` in favor of `some`) and confirm the matching AC test goes red each time; restore. Record each red test name in the task report. Do not commit the mutations.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/review-context/size-proxy.js plugin/bin/lib/review-context/build.js tests/bin-lib/review-context/size-proxy.test.js
git commit -m "Add review size-proxy module — excludes bookkeeping and lockfiles from the size count (refs #5148)"
```

### Task 2: `size-proxy` CLI verb

**Role:** integration

**Files:**
- Modify: `plugin/bin/build-review-context.js` (header comment, `USAGE`, `realDeps`, `runCommand`)
- Modify: `plugin/bin/lib/review-context/size-proxy.js` (add `collectSizeProxy`)
- Modify: `plugin/bin/lib/review-context/build.js` (export `realGit`)
- Modify: `docs/plugin-structure.md` (line ~84 `plugin/bin/lib/review-context/` entry gains `size-proxy.js`; line ~407 CLI entry gains `size-proxy --base <ref> --branch <ref> [--files-from <path>]` and its `{files, lines, size, excluded}` output)
- Test: `tests/bin-lib/review-context/exit-code.test.js`, `tests/bin-lib/review-context/size-proxy.test.js`

**Interfaces:**
- Consumes: Task 1's `computeSizeProxy`; `readDeclaration(filePath) -> {ok, decl, missing?}` and `DECLARATION_PATH` (`../verify/declaration`); `realGit(args, opts)` from `./build`.
- Produces: `collectSizeProxy({ base, branch, filesFrom?, cwd?, git, readFile = fs.readFileSync, readDecl = readDeclaration }) -> computeSizeProxy result`. It runs the numstat argv from Global Constraints via the injected `git`, resolves the repo root with `git(['rev-parse', '--show-toplevel'])`, reads `path.join(root, DECLARATION_PATH)` (an `ok: false` result → `decl: null`), and reads `--files-from` relative to `cwd`, newline-split, trimmed, blanks dropped (same as `buildContext`). CLI verb: `size-proxy --base <ref> --branch <ref> [--files-from <path>]` → one JSON line, exit 0.

- [ ] **Step 1: Write the failing tests**
  - In `exit-code.test.js`: `AC7.1: size-proxy with no --base exits 2 and prints usage` (assert `code === 2`, stderr matches `/size-proxy requires --base and --branch/`). `AC7.2: size-proxy with an unknown ref exits 1 and prints nothing on stdout` — real process via `spawnCli(CLI, ['size-proxy', '--base', 'no-such-ref-5148', '--branch', 'HEAD'])` from the repo checkout: `code === 1`, `stdout === ''`, stderr starts `build-review-context.js:`. `size-proxy` with `--print-dir` exits 2 (mint-only, matching `build`).
  - In `size-proxy.test.js`: `collectSizeProxy passes the pinned numstat argv` — fake `git` records calls; assert the exact argv `['-c', 'core.quotePath=false', 'diff', '--numstat', '-z', '--no-renames', '--no-color', '--no-ext-diff', '--end-of-options', 'main...HEAD']`, and that a `readDecl` returning `{ ok: false }` yields the fallback classification (a `docs/superpowers/plans/x.md` path excluded). `collectSizeProxy with filesFrom reads the list relative to cwd and drops blanks`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/review-context/exit-code.test.js tests/bin-lib/review-context/size-proxy.test.js`
Expected: FAIL after Step 1 — `unknown command: size-proxy` and `collectSizeProxy is not a function`.

- [ ] **Step 3: Implement** `collectSizeProxy`, export `realGit`, and wire the verb into `build-review-context.js`: new `realDeps.sizeProxy` (calls `collectSizeProxy` with `git = (a, o) => realGit(a, { cwd, env, ...o })`), `--print-dir` rejected on it, missing `--base`/`--branch` → stderr `build-review-context.js: size-proxy requires --base and --branch` + `USAGE`, exit 2. A git throw reaches `run()`'s existing catch (exit 1, stdout untouched). Update the file header, `USAGE`, and both `docs/plugin-structure.md` entries.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/review-context/`
Expected: PASS, 0 failures.

- [ ] **Step 5: Smoke run on this branch**

Run: `node plugin/bin/build-review-context.js size-proxy --base origin/main --branch HEAD`
Expected: exit 0, one JSON line whose `excluded` lists this run's `.claude-tweaks/pipelines/**` spec, the `docs/plans/*-ledger.md` ledger and this plan with reason `bookkeeping`.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/build-review-context.js plugin/bin/lib/review-context/size-proxy.js plugin/bin/lib/review-context/build.js docs/plugin-structure.md tests/bin-lib/review-context/exit-code.test.js tests/bin-lib/review-context/size-proxy.test.js
git commit -m "Add build-review-context.js size-proxy verb (refs #5148)"
```

### Task 3: Wire the size proxy and the schema comment-only exception into review-effort derivation

**Role:** integration

**Files:**
- Modify: `plugin/skills/review/review-effort-derivation.md` (step 3's risk-proxy and record-size-proxy bullets; step 4's #4028 example only if its wording no longer matches)
- Test: `tests/bin-lib/review-context/prose.test.js`
- Test: `tests/review-effort-label-diff-conformance.test.js` (existing pins on this file — run, no edit expected)

**Interfaces:**
- Consumes: Task 2's verb exactly as `node "${CLAUDE_PLUGIN_ROOT}/bin/build-review-context.js" size-proxy --base {base} --branch {branch} [--files-from {path}]`.

- [ ] **Step 1: Write the failing prose tests** in `prose.test.js` (whitespace-collapsed matching per `skill-prose-conformance-tests`):
  - `AC8.1: review-effort-derivation.md names the size-proxy call, its --stat fallback, and the comment-only schema exception` — asserts the text contains `build-review-context.js" size-proxy --base`, `--files-from` tied to the Merge-Provenance Check, a fallback sentence naming the unfiltered `git diff --stat` totals with a one-line notice, the phrase `never lower than the filtered count`, the comment-only exception naming `git diff -w {base}...{branch} -- {file}`, and that unclassifiable hunks fire the trigger.
  - `the {reasoning} slot names the filtered counts and the exclusions` — asserts the example form `excluded 10 files / 290 lines: bookkeeping 9, lockfile 1`.
  - Control: `code-mode-steps.md` does not contain `size-proxy` (the read-rail constraint).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/review-context/prose.test.js`
Expected: FAIL after Step 1 — the three new tests fail.

- [ ] **Step 3: Edit step 3 of `review-effort-derivation.md`:**
  - Record-size proxy: counts come from `size-proxy`'s `size` (files/lines after excluding declared bookkeeping paths and lockfiles); pass the own-work file list as `--files-from` when Step 2's Merge-Provenance Check detected merge commits. A non-zero exit or unparseable output → today's unfiltered `--stat` totals plus a one-line notice; that fallback is never lower than the filtered count. Keep `**high** at 10+ files` and the threshold sentences verbatim.
  - Risk proxy: the schema/migration trigger fires only when `git diff -w {base}...{branch} -- {file}` changes at least one line that is neither blank nor a comment (markers `--`, `#`, `//`, `/*`, `*`, `*/` after leading whitespace); unclassifiable hunks fire it. Other triggers unchanged; a lockfile still counts toward the new-dependency check.
  - State that the `{reasoning}` in Step 2.5's `diff heuristic: {reasoning}` slot names the filtered counts and exclusions, e.g. `size low (3 files / 60 lines; excluded 10 files / 290 lines: bookkeeping 9, lockfile 1)`.
  - The "If `git diff --stat` produces no output" bullet stays.
  - Re-read step 4's #4028 example; keep every pinned phrase listed in Global Constraints.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/review-context/prose.test.js tests/review-effort-label-diff-conformance.test.js tests/session-tmp-placeholder-quoting-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/review-effort-derivation.md tests/bin-lib/review-context/prose.test.js
git commit -m "Size review effort by code, not bookkeeping — wire size-proxy into review-effort derivation (refs #5148)"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (module), AC1.1, AC2.1, AC3.1, AC3.2, AC4.1, AC5.1, AC6.1 | Task 1 |
| Deliverable 2 (bookkeeping), 3 (lockfile, shared set) | Task 1 |
| Deliverable 4 (CLI verb, header, USAGE, plugin-structure), AC7.1, AC7.2 | Task 2 |
| Deliverables 5-7 (derivation prose), AC8.1 | Task 3 |
| Deliverable 8 (tests), AC9.1 | Tasks 1-3; AC9.1 go-red proof in Task 1 Step 5 |
