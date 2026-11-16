# Refused-Read Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `--replay` mode to `tools/guard-refusals.js` that gives every refused read-only command a disposition, record the read shapes no rewrite rule fixes as section 7 rows with detectors, and keep the skill fence scan green.

**Architecture:** A new pure module `tools/guard-refusals/replay.js` takes the rows the normal run already builds (plus each row's `cwd`) and injectable `rewrite`/`scanner`/`detect` functions, and returns `{ dispositions, writeTargetsMoved, ruleNotApplied, byClass, byPattern }`. `tools/guard-refusals.js` calls it under `--replay` and adds a `replay` key to its output. Two new detectors and three widened ones live in `tools/guard-refusals/shapes.js`, bound to new or amended rows of `plugin/skills/_shared/scratch-worktree.md` section 7.

**Tech Stack:** Node 18+, CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T090732-record-5590/work/5590-spec.md` (record #5590). Read it before any task.

## Global Constraints

- No scanner under `plugin/` is edited (`plugin/bin/lib/hooks/git-command.js`, `guard-rewrite.js`, `pre-tool-use.js` are read-only here).
- The existing `source-token`, `eval-token` and `complete-token` detectors keep their ids; the ids `git-C-dot`, `git-C-glob`, `git-chained-status` belong to #5588 and are not renamed.
- Section 7 rows are "last observed": never delete or flip an existing row; add the new observation with its date.
- Committed text (tests, fixtures, docs, PR) never quotes a command from a real transcript: fixtures are hand-written.
- `tests/skill-fence-guard-shapes.test.js` gains no new ALLOWLIST entry.
- Live-probe facts for new section 7 rows (already probed by the build session, copy verbatim): date 2026-11-16, platform macOS (darwin, zsh), Claude Code 2.1.325, session kind `subagent` (a dispatched Task agent in a guard-isolated worktree), record #5590.
- `RULE_SINCE` = `{ 'drop-redundant-cd': '2026-10-25', 'inline-literal-assignment': '2026-10-25', 'plugin-root-placeholder': '2026-10-25', 'node-eval-separator': '2026-10-25', 'quote-escaped-space': '2026-10-25', 'drop-git-C-cwd': null, 'quote-exit-status': null }` — the first five shipped in v6.154.1 (CHANGELOG.md, 2026-10-25, commit d5efeed1c7); #5588's two rules are in no release yet (latest is v6.170.0, 2026-11-15; #5588 merged 2026-11-16).

## Review Focus

1. A row with no `cwd`, or a truncated command — expected: no rewrite, no `writeTargetsMoved` check, never a crash (Task 2 test `rows without cwd or truncated are never rewritten`).
2. A subagent row (file under `/subagents/`) must not be dropped and must count as `subagent` in `ruleNotApplied` splits (Task 2 test `ruleNotApplied splits main and subagent`).
3. A `scanner` or `rewrite` that throws on one command — expected: that row is `unexplained`/skipped for that check, the run continues (Task 2 test `a throwing scanner does not abort the replay`).
4. `--shape-patterns` file missing, non-JSON, or an entry with an invalid regex — expected: exit 2 with a message, never a stack trace (Task 3 test).
5. A heredoc body with braces but no quote, or a quote after the brace closes — must not be flagged (Task 1 negatives, live-probed as passing).

---

### Task 1: Detectors and section 7 rows

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/guard-refusals/shapes.js`
- Modify: `plugin/skills/_shared/scratch-worktree.md` (section 7 table only)
- Modify: `tests/guard-refusals/shapes.test.js`
- Modify: `tests/fixtures/guard-refusals/banned-shapes.md` (one fence per new detector id, under a `## {id}` heading)
- Modify: `tests/skill-fence-guard-shapes.test.js` (one rule, no ALLOWLIST entry — see Step 6)

**Interfaces:**
- Produces: `DETECTORS` gains ids `git-word-argument` and `heredoc-brace-quote`; `UNDETECTED_ROWS` gains one key (the other-checkout row's Example cell). `detectShapes(text, opts)` unchanged signature.

Live observations (2026-11-16, build session, copy the quoted wording verbatim into the rows):
- `echo COMPLETE`, `echo Eval`, `echo SOURCE`, `grep -c "Source" README.md` refused: "runs a string through COMPLETE / Eval / SOURCE / Source, which can't be verified to stay inside the worktree". `grep -c "[S]ource" README.md` ran.
- Refused "names git more than once in a single command, which cannot be verified to stay inside the worktree": `git grep -c "git-discipline" -- <file>`, `git log --oneline -1 -- git`, `-- GIT`, `-- x/git`, `-- x/git-y`, `--grep "git"`. Ran: `"[g]it-discipline"`, `-- gitx`, `-- x-git`, `-- git.md`, `-- git-y.md`, `-- plugin/skills/_shared/git-discipline.md`, `--grep=git`, `--grep "a git b"`, `--grep "a git-b c"`, `-- "git x"`, `ls -d git-nonexistent`, `grep -c "git-discipline" README.md`, and `git rev-parse --short HEAD && git log --oneline -1`. Rule: inside a simple command whose command word is `git` (path prefix allowed), an argument word whose value after quote removal has a basename (text after the last `/`) matching `/^git(-[\w-]*)?$/i`.
- Refused "redirects git to the shared checkout via -C": `git -C "<main checkout>" rev-parse --short HEAD` and `... status --short`; "changes directory to the shared checkout (<path>) before running git": `cd "<main checkout>" && git log --oneline -1`; "redirects git to the shared checkout via --git-dir": `git --git-dir=<main>/.git --work-tree=<main> status --short`. Ran from the worktree: `git log origin/main --oneline -1` and `git log main --oneline -1` (refs are shared). No form reads the other checkout's working-tree state.
- Heredoc (the pre-#5589 `adopted-branch-collision-check.md` fence, script path literal): the 14-line body was refused with a quoted AND an unquoted delimiter ("is too complex to verify that it stays inside the worktree"); a 1-line body `console.log(JSON.stringify(process.argv.slice(1)));` ran with both; 14 lines of `console.log(n);` ran. Bisected: refused when a `'` or `"` sits inside an open `{` in the heredoc body (`const r = { a: 'x' };`, `{a:'x'}`, `{ 'x'` with no close, and `{` / `'x'` / `}` on three lines, under `cat <<'EOF'` too). Ran: `{ a: 1 }`, `{a:x}`, `{a:x} 'y'` (quote after the brace closed), `'y' {a:x}`, `['x', 'y']`, `node -e "const r = { a: 'x' }; ..."` (not a heredoc), `echo "{a:'x'}"`.

- [ ] **Step 1: Write failing tests in `tests/guard-refusals/shapes.test.js`**

```js
test('#5590: complete, eval and source tokens are refused in any letter case', () => {
  assert.deepStrictEqual(detectShapes('echo COMPLETE'), ['complete-token']);
  assert.deepStrictEqual(detectShapes('echo Eval'), ['eval-token']);
  assert.deepStrictEqual(detectShapes('grep -c "Source" README.md'), ['source-token']);
  assert.deepStrictEqual(detectShapes('grep -c "[S]ource" README.md'), []);
  assert.deepStrictEqual(detectShapes('echo Evaluate Completed Sourced'), []);
});
test('#5590: git-word-argument flags a git argument whose basename is git or git-*', () => {
  for (const c of ['git grep -c "git-discipline" -- f.md', 'git log --oneline -1 -- git', 'git log -1 -- GIT', 'git log -1 -- x/git-y', 'git log -1 --grep "git"', '/usr/bin/git log -1 -- git'])
    assert.deepStrictEqual(detectShapes(c), ['git-word-argument'], c);
});
test('#5590: git-word-argument passes the live-run forms', () => {
  for (const c of ['git grep -c "[g]it-discipline" -- f.md', 'git log -1 -- gitx', 'git log -1 -- x-git', 'git log -1 -- git.md', 'git log -1 -- plugin/skills/_shared/git-discipline.md', 'git log -1 --grep=git', 'git log -1 --grep "a git-b c"', 'git log -1 -- "git x"', 'ls -d git-nonexistent', 'grep -c "git-discipline" README.md', 'git rev-parse --short HEAD && git log --oneline -1', 'git status; ls git'])
    assert.deepStrictEqual(detectShapes(c), [], c);
});
test('#5590: heredoc-brace-quote flags a quote inside an open brace in a heredoc body', () => {
  for (const c of ["node /lit/x.js a <<'EOF'\nconst r = { a: 'x' };\nEOF", 'cat <<EOF\n{a:"x"}\nEOF', "cat <<'EOF'\n{\n'x'\n}\nEOF", "cat <<'EOF'\n{ 'x'\nEOF"])
    assert.deepStrictEqual(detectShapes(c), ['heredoc-brace-quote'], c);
});
test('#5590: heredoc-brace-quote passes braces without a quote, a quote outside braces, and non-heredoc text', () => {
  for (const c of ["cat <<'EOF'\n{ a: 1 }\nEOF", "cat <<'EOF'\n{a:x} 'y'\nEOF", "cat <<'EOF'\n'y' {a:x}\nEOF", "cat <<'EOF'\n['x', 'y']\nEOF", `node -e "const r = { a: 'x' }"`, `echo "{a:'x'}"`, "node /lit/x.js <<'EOF'\nconsole.log(JSON.stringify(process.argv.slice(1)));\nEOF"])
    assert.deepStrictEqual(detectShapes(c), [], c);
});
```

Also raise the `section 7 yields` floor for refused rows from 17 to the new count (17 + 3 new refused rows = 20).

- [ ] **Step 2: Run and see them fail**

Run: `node --test tests/guard-refusals/shapes.test.js`
Expected: FAIL on the five new tests.

- [ ] **Step 3: Implement in `tools/guard-refusals/shapes.js`**

- `wholeWord(word)` and `keyword(word)` compare case-insensitively (`shellWords(text).some((w) => w.toLowerCase() === word)`; `keyword` regex gets the `i` flag). Ids, rows and order unchanged.
- `gitWordArgument(text)`: for each `commandSegments(views(text).bare, 'git')` range, `shellWords(text.slice(s, e))`; true when any word after the first has a basename matching `/^git(-[\w-]*)?$/i`.
- `heredocBraceQuote(text)`: one pass over `lexShell(text)` kinds; a brace depth counter that runs only over `heredoc` chars and resets to 0 at each non-heredoc char other than `\n`; true on a `'` or `"` at depth > 0.
- Append two DETECTORS entries (before `backslash-space` is fine), each `row` equal to its new section 7 Example cell (Step 4).
- `UNDETECTED_ROWS[<other-checkout row Example cell>] = 'whether a -C operand or cd target is another checkout is known only at run time: the path text alone cannot tell the shared checkout from any other directory'`; update the comment above it.

- [ ] **Step 4: Edit section 7 of `plugin/skills/_shared/scratch-worktree.md`**

Add three refused rows (place them next to the related existing rows), each with the refusal wording quoted above, a workaround, and Last verified `2026-11-16 (#5590; macOS zsh, Claude Code 2.1.325, subagent session)`:
1. A git read of another checkout by `-C`, `--git-dir` or `cd`. Example: `` `git -C "<main checkout>" rev-parse --short HEAD`; `cd "<main checkout>" && git log --oneline -1` ``. Workaround: run ref and history reads from the session's own worktree against the branch or remote ref (`git log origin/main --oneline -1`, `git log main --oneline -1`; refs are shared); the other checkout's working-tree state (`status`, uncommitted diff) has no accepted form from inside the worktree.
2. A `git` command whose argument word is `git` or `git-…` as a whole word or path basename, any case. Example: `` `git grep -c "git-discipline" -- f.md`; `git log --oneline -1 -- git` ``. Workaround: bracket a letter (`"[g]it-discipline"`), or name the file with its extension.
3. A heredoc body with a quote inside an open `{`, either delimiter quoting. Example: `` `node "/lit/bin/node-eval-file.js" a <<'EOF'`; `const r = { a: 'x' };`; `EOF` `` (the test joins spans with newlines, making this a real heredoc). Workaround: `Write` the script to a file and run `node /abs/file.js`; braces without a quote pass.

Amend (do not replace) the `complete`, `eval` and `source` rows: add to the Shape cell "any letter case (`echo COMPLETE`, `echo Eval`, `grep -c "Source" f` refused; `"[S]ource"` runs)" and prefix their Last verified cell with `2026-11-16 (#5590; macOS zsh, Claude Code 2.1.325, subagent session): any letter case; `, keeping the existing dates. Keep every Example cell byte-identical.

The file is ~33 KB against the 52,500-byte rail; check `wc -c` after editing.

- [ ] **Step 5: Add fixture fences**

In `tests/fixtures/guard-refusals/banned-shapes.md`, one `## git-word-argument` fence and one `## heredoc-brace-quote` fence (hand-written, each firing only its own id), so `AC2.1` sees every detector id.

- [ ] **Step 6: Keep the fence scan green**

Run: `node --test tests/skill-fence-guard-shapes.test.js`
Measured before planning: the widened token detectors and `git-word-argument` flag no fence under `plugin/skills`; `heredoc-brace-quote` flags exactly one, `dispatch/queue-pull-script.md`'s line-17 fence, which the ALLOWLIST already holds for #4217 under four other detectors. Per the spec's Gotcha ("a fence that both #4217's detectors and a new detector flag belongs to #4217; leave it"), add to the test — not to ALLOWLIST — a `LATER_SHAPE_IDS = new Set(['git-word-argument', 'heredoc-brace-quote'])` (#5590) and drop, before `applyAllowlist`, any hit whose id is in it and whose `file:line` is the site of a hit that a ratchet entry covers. Add a go-red check: a later-id hit on a site no ratchet covers stays an offender. If the scan flags anything else, rewrite that fence when the count is at most 10; otherwise STOP and report it (the spec routes >10 to `UNDETECTED_ROWS` plus a capture, which the build session decides).

- [ ] **Step 7: Run both suites**

Run: `node --test tests/guard-refusals/shapes.test.js tests/skill-fence-guard-shapes.test.js tests/guard-refusals/probe-doc.test.js`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add tools/guard-refusals/shapes.js plugin/skills/_shared/scratch-worktree.md tests/guard-refusals/shapes.test.js tests/fixtures/guard-refusals/banned-shapes.md tests/skill-fence-guard-shapes.test.js
git commit -m "Record the read shapes no rewrite fixes as section 7 rows — refs #5590"
```

---

### Task 2: The replay module

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tools/guard-refusals/replay.js`
- Create: `tests/guard-refusals/replay.test.js`
- Modify: `tools/guard-refusals.js` (move `REWRITE_DEPS` out, import it from `./guard-refusals/replay`; nothing else)

**Interfaces:**
- Consumes: rows shaped like `summarize()`'s `rows` in `tools/guard-refusals.js` plus `cwd` (`{ toolUseId, file, tool, guard, command, truncated, reason, effect, readClass, ts, cwd }`); `detectShapes` from `./shapes`; `RULE_IDS` from `../../plugin/bin/lib/hooks/guard-rewrite`.
- Produces: `replay(rows, { rewrite, scanner, detect, patterns = null }) -> { dispositions, writeTargetsMoved, writeTargetsChecked, ruleNotApplied, byClass, byPattern }`, plus exports `RULE_SINCE`, `chainLength(text)`, `pluginVersion(command)`, `defaultDeps()`.
  - `rewrite(command, cwd) -> { command, applied } | null`; default wraps `rewriteForGuard` with `guard-refusals.js`'s `REWRITE_DEPS` stubs (move `REWRITE_DEPS` here and import it there).
  - `scanner = { gitTargets, fileWriteTargets, mkdirTargets }`, each `(command, cwd) -> array`; default from `plugin/bin/lib/hooks/git-command`.
  - `detect(text) -> string[]`; default `(t) => detectShapes(t, { placeholders: false })`.

Semantics (spec Deliverables 1, 2, 5; decisions stated in the PR):
- `dispositions`: `{ plugin: { 'still-denied', 'no-longer-denied', 'scanner-failed' }, harness: { 'other-checkout', rewritten, 'refused-shape', 'long-chain', unexplained }, refusedShapeById: {id: n}, rows: [{ toolUseId, disposition, detector? }] }` over rows with `effect === 'read'`. Plugin rows (`guard` starts `plugin:`): `still-denied` when `gitTargets(command, cwd)` holds an action in `GATE_COVERAGE.gitActions` (`pre-tool-use.js`) or `fileWriteTargets`/`mkdirTargets` return a non-empty list; cwd fallback `'/'` when absent. Harness rows (`guard === 'harness-command'`), first match wins: `other-checkout` (`readClass`); `rewritten` (rule changes it and `detect(rewritten)` is empty); `refused-shape` with `detector` = first id of `detect(rewritten ?? original)` (when rewritten text is clean the row was already `rewritten`); `long-chain` (`chainLength(command) >= 4`); else `unexplained`.
- `chainLength(text)`: simple commands at the top level, split at `;`, `&&`, `||`, `|`, newline in `plain` lexShell state outside `$(…)`/backtick/`(…)` nesting; empty segments not counted.
- `writeTargetsMoved`: over every Bash row (any guard, any effect) with an absolute cwd, not truncated, that `rewrite` changes: 1 when any of the three scanner lists differs (`JSON.stringify`) between original and rewritten; `writeTargetsChecked` counts the rows compared.
- `ruleNotApplied`: harness-command Bash rows, any effect, whose rewrite applies and whose rewritten text `detect` leaves empty, counted only when EVERY applied rule has a non-null `RULE_SINCE[rule]` and `ts >= RULE_SINCE[rule] + 1 day` for each (strictly after the release day, UTC; spec Plan Review Clarifications); the row then counts under each of its applied rules. Shape `{ total, byRule: { [rule]: { total, byVersion: { [version]: { main, subagent } } } } }`; `total` counts distinct rows. `version = pluginVersion(command)`: the `x.y.z` after `/plugins/cache/<marketplace>/claude-tweaks/`, else `'unknown'`. A row is `subagent` when its `file` path has a `subagents` directory segment.
- `byClass`: `{ 'git-C-own', 'exit-status', 'collision-fence' }`, each `{ total, unknownVersion, byVersion }` over all rows, keyed by SESSION version: the first `pluginVersion` any row with the same `file` yields, else `'unknown'` (spec Plan Review Clarifications). `git-C-own`: `effect === 'read'` and the text holds `git -C .` (bare or quoted dot) or `git -C` followed by the row's cwd (bare, single- or double-quoted, optional trailing `/`). `exit-status`: `effect === 'read'` and a `$?` at a `plain` lexShell position. `collision-fence`: any effect, text includes both `node-eval-file.js` and `remote-branch-collision`.
- `byPattern`: when `patterns` (array of `{ id, pattern }`, `pattern` a RegExp source) is given, `{ [id]: { count, rewritten } }` over all rows; `rewritten` = matching rows a rule changes. `null` when no patterns.
- A `rewrite`/`scanner`/`detect` throw on one row: that row's check is skipped (a harness row → `unexplained`; a plugin row → `scanner-failed`, never `no-longer-denied`; not compared for `writeTargetsMoved`); the replay never throws.
- `byPattern[id].rewritten` feeds the close/narrow/keep rule: a shape counts as changed only when `rewritten === count` (spec Plan Review Clarifications).

- [ ] **Step 1: Write the failing tests** in `tests/guard-refusals/replay.test.js` (hand-written rows, no transcript text):
  - `AC1`: plugin `git log` read row; scanner stub whose `gitTargets` returns `[{ action: 'commit', dir: '/wt' }]` → `still-denied`; stub returning `[]` everywhere → `no-longer-denied`.
  - `AC2` (default deps, cwd `/wt`): `ls /a\ b/c` → `rewritten`; `grep -n "source" f.md` → `refused-shape` with `detector: 'source-token'`; row with `readClass: 'other-checkout'` (reason `git-redirect-shared`) → `other-checkout`; `cat f` reason `too-complex` → `unexplained`; `cat a && cat b && cat c && cat d && cat e` → `long-chain`.
  - `AC3`: default rewrite on `ls "/wt/a b"` spelled `ls /wt/a\ b` → `writeTargetsMoved === 0`, `writeTargetsChecked === 1`; a stub rewrite that turns `cd /other && git commit -m x` into `git commit -m x` with the real scanner → `writeTargetsMoved === 1`.
  - `AC4`: harness row `ls /a\ b/c`, cwd `/wt`, command naming `/Users/x/.claude/plugins/cache/m/claude-tweaks/6.160.0/bin/x.js`, `ts: '2026-11-01T00:00:00Z'` → `ruleNotApplied.byRule['quote-escaped-space'].byVersion['6.160.0'].main === 1`; same row with `ts: '2026-10-20T00:00:00Z'` → not counted; same row under a `.../s1/subagents/a.jsonl` file → `subagent === 1`; a row that also needs `drop-git-C-cwd` (unreleased, e.g. `git -C /wt log -- /a\ b`) → not counted.
  - Review Focus 3 covers both a throwing scanner on a plugin row (→ `scanner-failed`) and a throwing rewrite on a harness row (→ `unexplained`).
  - `byClass` session version: a `git -C . log` row with no cache path in a file where another row names `6.160.0` counts under `byVersion['6.160.0']`; alone in its file it counts under `unknownVersion`.
  - `AC11`: `Object.keys(RULE_SINCE)` deep-equals `RULE_IDS` (sorted both); a go-red copy check: a map missing one key fails the same comparison helper. `byClass` returns one entry for each of the three classes on rows built to hit each; `byPattern` with one pattern counts its matches.
  - `chainLength`: `a | b` 2, `a && b; c || d` 4, `echo "a;b"` 1, `x=$(a; b)` 1, heredoc body lines not counted.
  - Review Focus 1-3 tests named as listed there.
- [ ] **Step 2: Run** `node --test tests/guard-refusals/replay.test.js` — expected FAIL (module missing).
- [ ] **Step 3: Implement `tools/guard-refusals/replay.js`** with a header comment stating the semantics above (the decisions are the module's contract).
- [ ] **Step 4: Run** `node --test tests/guard-refusals/replay.test.js tests/guard-refusals/cli.test.js` — expected PASS.
- [ ] **Step 5: Commit** — `git add tools/guard-refusals/replay.js tests/guard-refusals/replay.test.js tools/guard-refusals.js` then `git commit -m "Add the refused-read replay module — refs #5590"`.

---

### Task 3: CLI wiring, shape patterns, docs

**Files:**
- Modify: `tools/guard-refusals.js`
- Create: `tools/guard-refusals/caller-shape-patterns.json`
- Modify: `tests/guard-refusals/cli.test.js`
- Modify: `docs/plugin-structure.md:151`

**Interfaces:**
- Consumes: `replay`, `defaultDeps` from Task 2.
- Produces: CLI flags `--replay` (bool) and `--shape-patterns <file>` (value; requires `--replay`, else exit 2). With `--replay`, the `--json` output gains a final `replay` key (keys of the default output unchanged); the text output gains a `replay` section: harness and plugin disposition counts, `refused-shape` by detector, `writeTargetsMoved N of M`, the `rule-not-applied` table (one line per rule × version with main/subagent), `byClass` (total, unknown-version line), and `byPattern` when given.

- [ ] **Step 1: Failing CLI tests** (writeStore fixtures): `--replay --json` adds `replay` with `dispositions`, `writeTargetsMoved`, `ruleNotApplied`, `byClass`, `byPattern: null`; `Object.keys(out)` without `--replay` is unchanged; AC11 — a one-entry `--shape-patterns` file prints `byPattern.{id}.count`; `byClass` has the three keys; `--shape-patterns` without `--replay`, a missing file, invalid JSON, a non-array, and an entry with a bad regex each exit 2 with a message; the text table contains `rule-not-applied` and `writeTargetsMoved`. Update the header comment and USAGE.
- [ ] **Step 2: Run** `node --test tests/guard-refusals/cli.test.js` — FAIL.
- [ ] **Step 3: Implement** in `run()`: build replay rows as `out.rows` joined with `scan.rows`' `cwd` by `toolUseId`; read and validate the patterns file through `deps.fs` before scanning.
- [ ] **Step 4: `caller-shape-patterns.json`** — the shapes #4990 and #4931 list, ids and JS regex sources: `mkdir-chain-playwright` (`mkdir -p` … `&&` … `playwright-cli`), `cd-worktree-prefix` (`^\s*cd\s+"?/[^"&;]*"?\s*&&`), `heredoc-python-node` (`(?:python3?|node)\s+-\s*<<`), `shell-function-wrapper` (`\b\w+\s*\(\)\s*\{`), `playwright-var-filename` (`playwright-cli[^\n]*--filename[= ]"?\$`), `playwright-pwd-filename` (`playwright-cli[^\n]*--filename[= ]"?[^\s"]*\$PWD`), `playwright-for-loop` (`\bfor\s+\w+\s+in\b[^\n]*;\s*do\b[^\n]*playwright-cli`), `playwright-pipe-head` (`playwright-cli[^\n|]*\|\s*head\b`). Add a test that each pattern compiles and matches one hand-written positive.
- [ ] **Step 5: Docs** — extend the `guard-refusals.js` entry at `docs/plugin-structure.md:151` with `[--replay] [--shape-patterns <file>]` and one clause on the `replay` key, and list `replay.js` and `caller-shape-patterns.json` under `guard-refusals/`.
- [ ] **Step 6: Run** `node --test tests/guard-refusals/` — PASS.
- [ ] **Step 7: Commit** — the four files, `git commit -m "Wire --replay and --shape-patterns into guard-refusals — refs #5590"`.

---

## Build-session steps (not dispatched)

Run by the orchestrating `/build` session after Task 3, never by an implementer (they write GitHub state or read the real transcript store):

1. AC5: `node tools/guard-refusals.js --since-days 30 --replay --json` and the text form; check no plugin read row is `still-denied`, `writeTargetsMoved` 0, `unexplained` ≤ 5% of read rows that are neither `other-checkout` nor `long-chain`; record numerator/denominator and which of #4448/#4244/#4572 are in the tree.
2. `--since-days 14 --replay` for the `rule-not-applied` total (> 20 → one `/claude-tweaks:capture`; else count in the PR) and for the three `byClass` baselines (`--until 2026-11-16T…`).
3. The parked measurement record via `/claude-tweaks:capture` (labelled `parked`, cites #4216).
4. One comment each on #4990 and #4931 from `--shape-patterns tools/guard-refusals/caller-shape-patterns.json`, per the spec's close/narrow/keep rule; verify bodies and labels unchanged.
5. PR body: replay output blocks, counts only.
