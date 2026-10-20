# Git Path-List -z Sweep, Remaining Readers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every remaining `plugin/bin` git path reader (`--numstat`, `ls-files`, `status --porcelain`, full-format `ls-tree`, and the one `-U0` patch-header parser) reads non-ASCII paths raw instead of C-quoted, and `tests/git-path-read-conformance.test.js` pins it.

**Architecture:** New NUL-stream parsers go in the existing `plugin/bin/lib/git-z.js` (`parseNumstatZ`, `parseStatusPorcelainZ`, `parseLsTreeZ`) plus one C-quote decoder (`unquoteCPath`) for patch headers, which have no `-z` form. Each path reader switches to `-z` and the matching parser; ref-taking ones also gain `--end-of-options`. A reader that never turns git output into a path (emptiness test, exit code, display-only, counts for a caller-named path) carries a same-line marker comment instead, and the conformance pin accepts either `-z` or the marker on every such line.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T134331-record-3651/work/3651-spec.md` (record #3651)

## Global Constraints

- Every converted reader passes `-z` and splits on NUL through `plugin/bin/lib/git-z.js` — never `split('\n')` on path output.
- A ref-, range- or sha-taking reader passes `--end-of-options` before the ref (a `-- <pathspec>` tail still follows). Never `--` in its place.
- Exemption marker, same line as the git argv, exact prefix: `// git-path-read: not a path list (<reason>)`. Reasons used in this plan: `emptiness only`, `exit code only`, `display only`, `counts for a caller-named path`, `branch and dirty flag only`.
- Commit subjects: `{Verb} {what} — {detail}`, body line `refs #3651` (never `closes`/`fixes`), then the `Claude-Session:` trailer the controller supplies.
- Test fixtures name the path `docs/café.md` (spec AC1.1); assertions use the raw string `'docs/café.md'`, and where useful also assert the quoted form `'"docs/caf\\303\\251.md"'` is absent.

## Review Focus

1. A rename in `-z` numstat output (`a\td\t\0old\0new\0`) — `parseNumstatZ` must yield one record with `path` = new and `oldPath` = old, never a record with an empty path (Task 1 test).
2. A rename/copy in `-z` porcelain output puts the NEW path first (`XY new\0old\0`), reversed from non-z `old -> new` — `parseStatusPorcelainZ` must not swap them (Task 1 test).
3. A mixed-quoting patch header (`diff --git a/docs/old.md "b/docs/n\303\251w.md"`, produced by a rename to a non-ASCII name) — `analyzeDiff` must report `docs/néw.md` (Task 6 test).
4. `mktree` fed raw (unquoted) names without `-z` would mis-parse a special-character name; `writeTree` must switch to `mktree -z` in the same change as `readTreeEntries` (Task 5 round-trip test).
5. Emptiness readers must keep their exact current behavior — they get a comment only, no argv change (Tasks 3/4: diff of those lines is comment-only; existing suites stay green).

## Reader inventory (derived from read call sites, not literal text)

Derived by scanning every `plugin/bin` line carrying an `'ls-files'`, `'ls-tree'` or `'--numstat'` argv token, a `'status'` + `'--porcelain…'` argv pair, or an exec-called `git …` template string with those subcommands (prototype scan run at authoring; 37 hits, 15 already `-z`). Classification:

| Site | Kind | Disposition |
|---|---|---|
| `lib/blast-radius-cli.js:134` `diff --no-renames --numstat` | path reader (paths → classify/sensitive) | Task 2: `-z`, `--end-of-options`, `parseNumstatZ` |
| `lib/flow/artifact-overwrite-check.js:279` `log --numstat` | counts for a caller-named path | Task 2: marker |
| `lib/wrap-up/engine-verify.js:251,307` `status --porcelain=v1` | path reader (stat, `endsWith`) | Task 3: `-z`, `parseStatusPorcelainZ` |
| `lib/routine-template-parser.js:338` `status --porcelain` | path reader (`parsePorcelainNames`) | Task 3: `-z`, `parseStatusPorcelainZ` |
| `lib/hooks/worktree-reap.js:221`, `lib/reconcile/classify.js:34`, `lib/release/run.js:9`, `lib/verify/report.js:23`, `qa-stamp.js:78` | emptiness only | Task 3: marker |
| `lib/residue/probes/worktrees.js:100` | display only (raw lines onto an escalation issue) | Task 3: marker |
| `claude-tweaks-statusline.js:208` `status --porcelain -b` | branch and dirty flag only | Task 3: marker |
| `lib/reconcile/archive-merged.js:1289` `ls-files runDir` | path reader (`path.join` per line) | Task 4: `-z`, `splitNul` |
| `sweep-stray-run-dirs.js:71` `ls-files -- rel` | path reader (per-line `work/` test) | Task 4: `-z`, `splitNul` |
| `lib/reconcile/archive-merged.js:122,587,614`, `lib/wrap-up/engine-verify.js:365`, `lib/residue/probes/artifacts.js:159` | emptiness only | Task 4: marker |
| `lib/reconcile/archive-merged.js:585` `ls-files --error-unmatch` | exit code only | Task 4: marker |
| `lib/health-core/durable-state.js:274` `ls-tree treeSha` (+ `mktree` at :310) | path reader (tree entry names) | Task 5: `-z`, `--end-of-options`, `parseLsTreeZ`; `mktree -z` |
| `lib/issues/claims-git-cas.js:250` `ls-tree -r tip -- claims/` | path reader (path → sha map) | Task 5: `-z`, `--end-of-options`, `parseLsTreeZ` |
| `lib/flow/preflight.js:127` `ls-tree` built across lines (already `-z` via push) | already compliant, invisible to a line pin | Task 5: build the argv on one line |
| `lib/design-detect/surface-lines.js` `analyzeDiff` (`diff --git a/X b/Y`, `+++ b/Y`) | path reader of patch headers (no `-z` form exists) | Task 6: decode quoted headers with `unquoteCPath` |
| `lib/wrap-up/facts.js:86` `diff -U0 … -- *.md` | **not a path reader** — scans `-#` lines only (premise reversed, logged) | Task 6: pin test only, no code change |

Out of scope, named in the contract's shrunk "Not covered yet": `git worktree list --porcelain` readers (paths print raw, unquoted; only a newline in a path breaks them), `blame --line-porcelain`, and argv arrays split across lines (the line-based pin cannot see them).

---

### Task 1: NUL-stream parsers and a C-quote decoder in git-z.js

**Files:**
- Modify: `plugin/bin/lib/git-z.js`
- Test: `tests/bin-lib/git-z.test.js`

**Interfaces:**
- Produces (all exported from `plugin/bin/lib/git-z.js`):
  - `parseNumstatZ(raw: string|null) -> Array<{ path: string, oldPath?: string, additions: number, deletions: number }>` — `-` counts (binary) become `0`; a rename record yields `path` = new, `oldPath` = old.
  - `parseStatusPorcelainZ(raw: string|null) -> Array<{ xy: string, path: string, origPath?: string }>` — `xy` is the two status chars verbatim; for a rename/copy (`R` or `C` in `xy`) the next token is `origPath`.
  - `parseLsTreeZ(raw: string|null) -> Array<{ mode: string, type: string, sha: string, path: string }>` — full-format `ls-tree -z` records (`<mode> SP <type> SP <sha> TAB <path>`); a record with no TAB is skipped.
  - `unquoteCPath(s: string) -> string` — when `s` is wrapped in `"…"`, decode git's C-style escapes (`\\`, `\"`, `\a \b \t \n \v \f \r`, and `\NNN` octal bytes) into bytes and UTF-8-decode; otherwise return `s` unchanged.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/git-z.test.js`). The `-z` inputs are the real outputs captured at authoring from a scratch repo (git 2.x, `docs/café.md` modified, `docs/old.md` renamed to `docs/néw.md`):

```js
test('parseNumstatZ: plain, binary and rename records from real -z output', () => {
  assert.deepEqual(parseNumstatZ('1\t2\tdocs/café.md\u00000\t0\t\u0000docs/old.md\u0000docs/néw.md\u0000'), [
    { path: 'docs/café.md', additions: 1, deletions: 2 },
    { path: 'docs/néw.md', oldPath: 'docs/old.md', additions: 0, deletions: 0 },
  ]);
  assert.deepEqual(parseNumstatZ('-\t-\tassets/logo.png\u0000'), [{ path: 'assets/logo.png', additions: 0, deletions: 0 }]);
  assert.deepEqual(parseNumstatZ('1\t1\tdir/a\tb.md\u0000'), [{ path: 'dir/a\tb.md', additions: 1, deletions: 1 }]);
  assert.deepEqual(parseNumstatZ(''), []);
  assert.deepEqual(parseNumstatZ(null), []);
});

test('parseStatusPorcelainZ: raw paths, and the new-path-first rename order', () => {
  assert.deepEqual(parseStatusPorcelainZ(' M docs/café.md\u0000?? docs/ünt.yml\u0000'), [
    { xy: ' M', path: 'docs/café.md' },
    { xy: '??', path: 'docs/ünt.yml' },
  ]);
  assert.deepEqual(parseStatusPorcelainZ('R  docs/néw.md\u0000docs/old.md\u0000 M a.md\u0000'), [
    { xy: 'R ', path: 'docs/néw.md', origPath: 'docs/old.md' },
    { xy: ' M', path: 'a.md' },
  ]);
  assert.deepEqual(parseStatusPorcelainZ(''), []);
});

test('parseLsTreeZ: full-format records with raw names', () => {
  const sha = '1892bdfca6755927bb5dea46d624c4dbf38e2da4';
  assert.deepEqual(parseLsTreeZ(`100644 blob ${sha}\tdocs/café.md\u0000040000 tree ${sha}\tsub\u0000`), [
    { mode: '100644', type: 'blob', sha, path: 'docs/café.md' },
    { mode: '040000', type: 'tree', sha, path: 'sub' },
  ]);
  assert.deepEqual(parseLsTreeZ(''), []);
});

test('unquoteCPath: decodes octal UTF-8 bytes and escapes, leaves unquoted input alone', () => {
  assert.equal(unquoteCPath('"docs/caf\\303\\251.md"'), 'docs/café.md');
  assert.equal(unquoteCPath('"a\\tb\\"c\\\\d"'), 'a\tb"c\\d');
  assert.equal(unquoteCPath('docs/plain.md'), 'docs/plain.md');
});
```

Also add the four names to the file's existing `require` destructuring.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/git-z.test.js`
Expected: FAIL — `parseNumstatZ is not a function` (the four new tests fail; existing tests pass).

- [ ] **Step 3: Implement the four functions in `plugin/bin/lib/git-z.js`**, each built on `splitNul`, with a header comment per function in the file's existing style (name the git command and its `-z` record shape). `parseNumstatZ`: a token whose third tab-field is empty starts a rename and consumes the next two tokens (old, new); the path is everything after the second tab (tabs in a path survive). `unquoteCPath`: collect bytes into a `Buffer`, decode with `toString('utf8')`. Optional keys (`oldPath`, `origPath`) are omitted, never set to `undefined` — the tests compare with strict deep equality. Add all four to `module.exports`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/git-z.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/git-z.js tests/bin-lib/git-z.test.js
git commit -m "Add numstat, porcelain, ls-tree -z parsers and a C-quote decoder to git-z.js — the remaining path readers' shared parsing

refs #3651"
```

---

### Task 2: `--numstat` readers

**Files:**
- Modify: `plugin/bin/lib/blast-radius-cli.js` (lines 37-51, 134, 145: drop local `parseNumstat`, call `-z` + `parseNumstatZ`)
- Modify: `plugin/bin/lib/flow/artifact-overwrite-check.js:279` (marker: `counts for a caller-named path`)
- Modify: `plugin/bin/lib/dispatch/ceremony-derive.js` (lines 13, 43: comments naming `parseNumstat`'s shape → `git-z.js`'s `parseNumstatZ`)
- Modify: `plugin/skills/wrap-up/ceremony-derivation.md:29-37` (prose + composition line)
- Modify: `plugin/skills/build/dispatch.md:19` (the one "parsed first with `bin/lib/blast-radius-cli.js`'s `parseNumstat`" phrase)
- Test: `tests/bin-lib/blast-radius-cli.test.js`, `tests/diff-facts-parse-numstat-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `parseNumstatZ`.
- Produces: `blast-radius-cli.js` exports `{ computeBlastRadius, BlastRadiusError, preferOriginRef }` — `parseNumstat` is removed; its only consumers were this module, its test file, and the two skill files above (verified at authoring: `git grep -n parseNumstat -- plugin tests` → blast-radius-cli.js, ceremony-derive.js comments, dispatch.md, ceremony-derivation.md, blast-radius-cli.test.js, diff-facts-parse-numstat-conformance.test.js).

- [ ] **Step 1: Write the failing tests**
  - In `tests/bin-lib/blast-radius-cli.test.js`: change every fake `diff:` handler to return `-z` output (`'10\t2\tplugin/bin/foo.js\u00005\t0\ttests/foo.test.js\u0000'` etc.); delete the two `parseNumstat` unit tests (lines ~110-120 — their cases now live in Task 1's `parseNumstatZ` test) and drop `parseNumstat` from the `require`. Add:

```js
test('AC1.1: a real repo change to docs/café.md surfaces as the raw path', () => {
  // temp repo: commit docs/café.md, commit an edit to it; git dep runs execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  const readFile = (p) => (p.endsWith('policy.yml') ? 'merge-sensitive-paths: docs/café.md\n' : null);
  const out = computeBlastRadius({ base: baseSha }, { git, readFile });
  assert.deepStrictEqual(out.summary.sensitiveFilesTouched, ['docs/café.md']);
});

test('the diff call passes -z and --end-of-options before the range', () => {
  // fakeGit as in the happy-path test; after computeBlastRadius:
  const diffCall = git.calls.find((a) => a[0] === 'diff');
  assert.deepStrictEqual(diffCall, ['diff', '--no-renames', '--numstat', '-z', '--end-of-options', `${SHA}..HEAD`]);
});
```

  - In `tests/diff-facts-parse-numstat-conformance.test.js`: `assertNamesParser` requires `'git-z.js'` instead of `'blast-radius-cli.js'` (update the negative-control third case's text to match); the composition-runner test pipes `'3\t1\tsrc/a.js\u0000'` (NUL-terminated); update the header comment's module name.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/blast-radius-cli.test.js tests/diff-facts-parse-numstat-conformance.test.js`
Expected: FAIL — the AC1.1 test reports `sensitiveFilesTouched` as `[]` (the quoted path matches nothing) or the argv test differs; the conformance test fails on the missing `git-z.js` name.

- [ ] **Step 3: Implement**
  - `blast-radius-cli.js`: `git(['diff', '--no-renames', '--numstat', '-z', '--end-of-options', \`${mergeBase}..HEAD\`])`, parsed with `parseNumstatZ` from `./git-z`; remove `parseNumstat` and its comment; keep the `git diff --numstat failed` error text.
  - `artifact-overwrite-check.js:279`: append `// git-path-read: not a path list (counts for a caller-named path)`.
  - `ceremony-derivation.md` step 1: name `parseNumstatZ` (`bin/lib/git-z.js`) and make the composition line
    `git diff --numstat -z "$(git merge-base HEAD origin/main)" | node -e "const { parseNumstatZ } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/git-z.js'); const { computeDiffFacts } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/ceremony-derive.js'); console.log(JSON.stringify(computeDiffFacts(parseNumstatZ(require('fs').readFileSync(0, 'utf8')))))"`
  - `dispatch.md:19`: replace only "parsing the branch's `git diff --numstat` output first with `bin/lib/blast-radius-cli.js`'s `parseNumstat`" with "parsing the branch's `git diff --numstat -z` output first with `bin/lib/git-z.js`'s `parseNumstatZ`". Byte change is a few characters; dispatch.md is 25,865 B against the 52,500 B rail.
  - `ceremony-derive.js:13,43`: comment text only — "`git-z.js`'s `parseNumstatZ` shape".

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/blast-radius-cli.test.js tests/diff-facts-parse-numstat-conformance.test.js tests/bin-lib/dispatch/ceremony-derive.test.js tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — `git add` the seven files by path; subject `Read numstat path lists with -z — blast-radius parses NUL records via git-z.js`.

---

### Task 3: `status --porcelain` readers

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js` (lines 251-254, 307-312: plans-ledger, design-caches)
- Modify: `plugin/bin/lib/routine-template-parser.js` (lines 226-240, 338: `parsePorcelainNames` + its call)
- Modify (marker only, no argv change): `plugin/bin/lib/hooks/worktree-reap.js:221`, `plugin/bin/lib/reconcile/classify.js:34`, `plugin/bin/lib/release/run.js:9`, `plugin/bin/lib/verify/report.js:23`, `plugin/bin/qa-stamp.js:78` (`emptiness only`); `plugin/bin/lib/residue/probes/worktrees.js:100` (`display only`); `plugin/bin/claude-tweaks-statusline.js:208` (`branch and dirty flag only`)
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js`, `tests/routine-record-freshness.test.js`

**Interfaces:**
- Consumes: Task 1's `parseStatusPorcelainZ`.
- Produces: nothing new for later tasks; `parsePorcelainNames(out)` stays module-private and now takes `-z` output.

- [ ] **Step 1: Write the failing tests**
  - engine-verify: `AC1.1: plans-ledger names an untracked docs/plans/café.md raw` — a real temp repo whose `docs/plans/` holds an untracked `café-ledger.md` created after the run dir; the check's `detail` contains `docs/plans/café-ledger.md` and not `\\303`. And `AC1.1: design-caches flags an untracked docs/plans/café-audit.json` — `result === 'fail'`, `detail` contains `café-audit.json`. Update any fake `deps.git` returning non-z porcelain text in that file to `-z` records.
  - routine-template-parser: `AC1.1: an uncommitted edit to a non-ASCII record name counts as dirty` — temp repo with a committed `{dir}/café.yml` then a working-tree edit; `compareRoutineRecords` reports that record with the working copy winning (the same assertion the file's existing dirty-record test makes for an ASCII name).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js tests/routine-record-freshness.test.js`
Expected: FAIL after Step 1 — the new tests see the C-quoted name (engine-verify detail carries `\303\251`; the routine record is not treated as dirty).

- [ ] **Step 3: Implement**
  - engine-verify: both argv gain `'-z'` after `'--porcelain=v1'`; leftovers = `parseStatusPorcelainZ(status).filter((r) => r.xy === '??').map((r) => r.path)`.
  - routine-template-parser: argv gains `'-z'` after `'--porcelain'`; `parsePorcelainNames` iterates `parseStatusPorcelainZ(out)` and uses `record.path` (already the destination for a rename); drop the ` -> ` and quote-stripping code; update its comment.
  - The seven marker lines: append `// git-path-read: not a path list ({reason})` exactly, argv untouched.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js tests/routine-record-freshness.test.js tests/git-status-optional-locks.test.js tests/hooks-session-start.test.js tests/reconcile.test.js tests/bin-lib/residue/probes-git.test.js tests/bin-lib/verify/cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — subject `Read status --porcelain path lists with -z — engine-verify and routine records parse NUL records`.

---

### Task 4: `ls-files` readers

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js:1289-1295` (`archiveRunDir`'s tracked-outside-work guard)
- Modify: `plugin/bin/sweep-stray-run-dirs.js:71-72` (`hasTrackedWork`)
- Modify (marker only): `plugin/bin/lib/reconcile/archive-merged.js:122,587,614` and `plugin/bin/lib/wrap-up/engine-verify.js:365` and `plugin/bin/lib/residue/probes/artifacts.js:159` (`emptiness only`); `plugin/bin/lib/reconcile/archive-merged.js:585` (`exit code only`)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`, `tests/sweep-stray-run-dirs.test.js`

**Interfaces:**
- Consumes: `splitNul` (existing, git-z.js).

- [ ] **Step 1: Write the failing tests**
  - archive-merged: `AC1.1: a tracked non-ASCII spec under work/ does not refuse archival` — a real repo whose run dir tracks `work/café-spec.md` (and nothing else tracked outside `work/`); `archiveRunDir` does not return a `tracked-entry` refusal. Today the quoted line joins to a path outside `work/` and refuses.
  - sweep-stray: `AC1.1: hasTrackedWork sees a tracked work/café-spec.md` returns `true` for a run dir named `2026-01-01T000000-café` tracking `work/1-spec.md` (the quoted line starts with `"`, but the per-path test must run on the raw path).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/sweep-stray-run-dirs.test.js`
Expected: FAIL after Step 1 on the archive-merged test (`tracked-entry` refusal). If the sweep-stray test already passes (its regex happens to tolerate the quote), keep it as the regression pin and say so in the task report.

- [ ] **Step 3: Implement**
  - archive-merged:1289: `runGit(['ls-files', '-z', '--', runDir], root)`; `splitNul(lsFiles.stdout)` in place of `.split('\n').filter(Boolean)`.
  - sweep-stray:71: `runGit(['ls-files', '-z', '--', rel], root)`; `splitNul(res.stdout).some(...)`.
  - Six marker lines as listed, argv untouched.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-work-boundary.test.js tests/sweep-stray-run-dirs.test.js tests/bin-lib/residue/artifacts.test.js tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — subject `Read ls-files path lists with -z — archival guard and stray-run sweep split on NUL`.

---

### Task 5: full-format `ls-tree` readers

**Files:**
- Modify: `plugin/bin/lib/health-core/durable-state.js:264-311` (`readTreeEntries`, `writeTree`)
- Modify: `plugin/bin/lib/issues/claims-git-cas.js:250-268` (`readClaimBlobsGitBatch`)
- Modify: `plugin/bin/lib/flow/preflight.js:126-130` (build the `ls-tree` argv on one line)
- Test: `tests/bin-lib/health-core/durable-state.test.js`, `tests/bin-lib/issues/claims-git-cas.test.js`, `tests/bin-lib/flow/preflight.test.js`

**Interfaces:**
- Consumes: Task 1's `parseLsTreeZ`.

- [ ] **Step 1: Write the failing tests**
  - durable-state: `AC1.1: a tree entry named café.md round-trips through readTreeEntries and writeTree` — real repo; write a tree containing `café.md` via `git mktree -z`, read it back through the module's read path, and assert the entry map has key `'café.md'` and that writing the map back yields the same tree sha. Use whichever exported surface the existing durable-state tests already drive (`readTreeEntries`/`writeTree` are inner functions); if none reaches them, drive the public read/write of a namespace whose file is named `café.md`.
  - claims-git-cas: `AC1.1: readClaimBlobsGitBatch passes -z and --end-of-options` — fake runner records argv; assert the ls-tree call is `['ls-tree', '-r', '-z', '--end-of-options', tip, '--', 'claims/']`, and that NUL-delimited fake output `100644 blob {sha}\tclaims/issue-7.json\u0000` resolves issue 7. Update existing fakes that return newline-delimited ls-tree text to `-z` form.
  - preflight: no new test — existing suite must stay green with identical argv order.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/health-core/durable-state.test.js tests/bin-lib/issues/claims-git-cas.test.js`
Expected: FAIL after Step 1 — argv lacks `-z`; the café entry reads back as `"caf\303\251.md"`.

- [ ] **Step 3: Implement**
  - durable-state: `['-C', root, 'ls-tree', '-z', '--end-of-options', treeSha]` parsed by `parseLsTreeZ` into the same `Map<name, {mode,type,sha}>`; `writeTree` joins records with `'\0'` (trailing `'\0'` when non-empty) and runs `['-C', root, 'mktree', '-z']`. Update both header comments.
  - claims-git-cas: `runner(['ls-tree', '-r', '-z', '--end-of-options', tip, '--', 'claims/'])`, iterate `parseLsTreeZ(lsTreeText)`.
  - preflight: `const args = ['ls-tree', ...(recursive ? ['-r'] : []), '--name-only', '-z', '--end-of-options', branch, '--', pathspec];` replacing the push sequence — same argv order.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/health-core/durable-state.test.js tests/bin-lib/issues/claims-git-cas.test.js tests/bin-lib/flow/preflight.test.js tests/bin-lib/flow/preflight-cli.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — subject `Read full-format ls-tree with -z — durable-state and claims registry parse NUL records`.

---

### Task 6: `-U0` patch-header paths

**Files:**
- Modify: `plugin/bin/lib/design-detect/surface-lines.js:113-118` (`analyzeDiff` header matching)
- Test: `tests/bin-lib/design-detect/surface-lines.test.js`, `tests/bin-lib/wrap-up/facts.test.js`

**Interfaces:**
- Consumes: Task 1's `unquoteCPath`.

- [ ] **Step 1: Write the failing tests**
  - surface-lines: `AC1.1: a C-quoted header names the raw path` — `analyzeDiff('diff --git "a/src/caf\\303\\251.tsx" "b/src/caf\\303\\251.tsx"\n--- "a/src/caf\\303\\251.tsx"\n+++ "b/src/caf\\303\\251.tsx"\n@@ -1 +1 @@\n-<div className="a" />\n+<div className="b" />\n')` returns one file with `file === 'src/café.tsx'` and `surface === true`. Plus `a rename to a non-ASCII name with mixed quoting` — header `diff --git a/src/old.tsx "b/src/n\\303\\251w.tsx"` followed by a hunk → `file === 'src/néw.tsx'`.
  - facts: `AC1.1: removing a heading from docs/café.md still sets headingRenamed` — real repo, base commit with `docs/café.md` = `# Title\n\nbody\n`, HEAD edits it to drop `# Title`; the module's fact for headingRenamed is `true`. Expected to pass already (documents the premise reversal; it is the regression pin, not a red test).

- [ ] **Step 2: Run to verify the surface-lines tests fail**

Run: `node --test tests/bin-lib/design-detect/surface-lines.test.js tests/bin-lib/wrap-up/facts.test.js`
Expected: FAIL after Step 1 — the two surface-lines tests return `[]` (header unmatched); the facts test passes.

- [ ] **Step 3: Implement** — in `analyzeDiff`, the `diff --git` match accepts either side as `a/…`/`b/…` or a `"…"` C-quoted token (regex alternative `"(?:[^"\\]|\\.)*"`), and the `+++` match accepts `+++ "b/…"`; a quoted capture goes through `unquoteCPath` and then has its leading `b/` stripped. Unquoted headers keep today's greedy match exactly. Update the function comment.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/design-detect/surface-lines.test.js tests/bin-lib/wrap-up/facts.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — subject `Decode C-quoted patch headers in design-detect — a non-ASCII changed file no longer drops out of the surface gate`.

---

### Task 7: Extend the conformance pin and the contract

**Files:**
- Modify: `tests/git-path-read-conformance.test.js`
- Modify: `plugin/skills/_shared/git-path-read.md` (2,337 B; rail 52,500 B)
- Modify: `docs/plugin-structure.md:19` (git-z.js export list)

**Interfaces:**
- Consumes: every marker and argv from Tasks 2-5.

- [ ] **Step 1: Write the tests** in `tests/git-path-read-conformance.test.js`:
  - `PATH_LIST_TOKEN = /(['"])(?:ls-files|ls-tree|--numstat)\1/`, a status line = `/(['"])status\1/` and `/(['"])--porcelain(?:=v1)?\1/` on the same line, and `EXEC_TEMPLATE_READ = /\w*[eE]xec\w*\(\s*(['"`])git [^'"`\n]*(?:ls-files|ls-tree|--numstat|status[^'"`\n]*--porcelain)[^'"`\n]*\1/`. `EXEMPT_MARKER = /\/\/ git-path-read: not a path list \([^)]+\)/`.
  - `findUnzippedReads(files)` → violations for every such line with neither `-z` (argv: `Z_FLAG`; template: `TEMPLATE_Z_FLAG`) nor `EXEMPT_MARKER`.
  - Extend `findMissingEndOfOptions` to also check non-exempt lines carrying `'ls-tree'`, or `'--numstat'` together with `'diff'`/`'log'`/`'show'` (so `apply --numstat -z <patch>` in stack-check.js is not a ref read).
  - Tests: `AC2.1: no plugin/bin ls-files/ls-tree/numstat/status --porcelain read lacks -z or an exemption marker` (live corpus, `assert.deepEqual(findUnzippedReads(files), [])`); the extended end-of-options live test; scanner unit tests (an argv line without `-z` flags, with `-z` passes, with the marker passes, the statusline template string without the marker flags); and `AC2.1 go-red: removing -z from any one covered reader is a violation` — one shared helper `assertGoesRed(relFile, needle, replacement)` that reads the live file, asserts `needle` is present, asserts `findUnzippedReads` reports 0 on live and exactly 1 on the mutated text; called for one reader per category: blast-radius-cli.js (`'--numstat', '-z'`), engine-verify.js plans-ledger (`'--porcelain=v1', '-z'` first occurrence), archive-merged.js:1289 (`'ls-files', '-z', '--', runDir`), claims-git-cas.js (`'ls-tree', '-r', '-z'`). A control call with a needle whose removal leaves `-z` in place must throw (proves the helper can fail).
  - Update `AC3.1` to also require `parseNumstatZ`, `parseStatusPorcelainZ`, `parseLsTreeZ`, `unquoteCPath` and `git-path-read: not a path list` in the contract.

- [ ] **Step 2: Run, and revert-to-confirm (AC2.1)**

Run: `node --test tests/git-path-read-conformance.test.js` → PASS. Then, for one reader, delete `'-z'` from its live line in the working tree, re-run, see exactly that line reported, and restore it with the Edit tool (no `git checkout`/`git stash`). Record the red output line in the task report.

- [ ] **Step 3: Update `plugin/skills/_shared/git-path-read.md`**
  - Rule paragraph: add `ls-files`, full-format `ls-tree`, `--numstat` (diff/log/show), and `status --porcelain` to the covered commands.
  - Parsers: list `parseNumstatZ`, `parseStatusPorcelainZ` (rename = new path first), `parseLsTreeZ`, and `unquoteCPath` (patch headers have no `-z`; `design-detect/surface-lines.js` decodes them).
  - New "Exempt reads" paragraph: the marker `// git-path-read: not a path list (<reason>)` on the same line, for a read that never turns output into a path (emptiness, exit code, display, counts for a caller-named path); `wrap-up/facts.js`'s `-U0` scan is not a path read (it matches `-#` lines only).
  - "Pinned by": the new rule and the extended end-of-options rule.
  - "Not covered yet" shrinks to: `git worktree list --porcelain` readers (raw but newline-delimited), `blame --line-porcelain`, and argv arrays split across lines, which a line-based pin cannot see.

- [ ] **Step 4: Update `docs/plugin-structure.md:19`** — the git-z.js sentence lists the four new exports.

- [ ] **Step 5: Run**

Run: `node --test tests/git-path-read-conformance.test.js tests/bin-lib/git-z.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit** — subject `Pin -z on every plugin/bin path-list read — ls-files, ls-tree, numstat and porcelain readers join the contract`.
