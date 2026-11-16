# Guard rewrite: own-worktree `git -C` and unquoted `$?` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two rewrite rules, `drop-git-C-cwd` and `quote-exit-status`, to the PreToolUse guard normalizer so the harness worktree guard stops refusing read-only `git -C .` / `git -C <own worktree>` calls and `word=$?` arguments after a `git`/`gh` call.

**Architecture:** Both rules live in `plugin/bin/lib/hooks/guard-rewrite.js` beside the five existing ones, reuse its `scan()` contexts (`TOP`), `atCommandStart`, `inDoubt` and `commandWordsPlain`, and return `null` on any doubt. `drop-git-C-cwd` shares one cwd-spelling predicate with `dropRedundantCd` (extracted, not duplicated). Proof is the existing bash+zsh equivalence harness, must-decline pins, the seeded property test, a new write-target invariance test, a `perf/` linearity file, three new §7 rows with detectors, and a live harness probe.

**Tech Stack:** Node 18+ CommonJS, `node --test`, bash + zsh for equivalence.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T004706-record-5588/work/5588-spec.md` (record #5588)

Scope keywords: guard-rewrite, RULE_IDS, five shapes, drop-redundant-cd

## Global Constraints

- `guard-rewrite.js` "may require only `path`, `../path-guard` and `../shared-primitives`" (spec Gotchas). No new `require`.
- Rule order (Deliverable 3, verbatim): `RULES` becomes: `drop-redundant-cd`, `inline-literal-assignment`, `plugin-root-placeholder`, `node-eval-separator`, `quote-escaped-space`, `drop-git-C-cwd`, `quote-exit-status`. The comment above `RULES` gives both reasons for `drop-git-C-cwd`'s place (after the two inlining rules so `W=/abs/wt; git -C "$W" log` is inlined and then judged; after `quote-escaped-space` so `git -C /w/my\ wt log` is requoted and then judged in the same pass).
- `drop-git-C-cwd` read-subcommand allowlist (verbatim from Technical Approach): `log`, `show`, `diff`, `status`, `grep`, `rev-parse`, `rev-list`, `ls-files`, `ls-tree`, `merge-base`, `cat-file`, `blame`, `describe`, `for-each-ref`, `show-ref` and `check-ignore`.
- `quote-exit-status` word class: `A-Za-z0-9_.:=/-` (one or more) followed by `$?` at the word's end. Declaring command words: `export`, `declare`, `local`, `readonly`, `typeset`, `env`.
- `.claude/skills/pretooluse-updatedinput-normalizer` (verbatim): "A rule returns a rewritten string only when it can prove the result means the same thing under both shells the Bash tool runs, bash and zsh. On any doubt it returns `null`, and `rewriteForGuard` returns `null` on any throw. The proofs are allowlists, never denylists"; "A new rule adds positive cases to the equivalence list, one must-decline case per bail condition, zsh-only cases marked `shells: ['zsh']` where the form is a bash syntax error, and keeps the harness self-check that the comparison can go red ("equivalence harness discriminates")."; "A must-decline pin proves its bail condition only when every other check accepts its input."; "`guardRewriteOutput` builds `{ hookEventName: 'PreToolUse', updatedInput: { ...toolInput, command } }` and nothing else."; "Place a new rule by what it reads and what it writes, and update the comment above `RULES`."; "A new or renamed rule id lands in `RULES` and its order comment; `docs/hooks.md`'s guard-normalizer bullet; `docs/reference/pretooluse-updatedinput-worktree-guard.md`; `_shared/scratch-worktree.md` section 7's normalizer paragraph and its "five shapes" count; and the `RULE_IDS.length` assertion in `tests/guard-refusals/probe-doc.test.js`"; "Section 7's table records the guard's own behavior ... Never flip a row to "passes" because the normalizer handles it."
- `.claude/skills/regex-scan-linearity` (verbatim): "Wall-clock budgets live in `perf/{name}-linearity.test.js`, run by `npm run test:perf`, never by `npm test`."; "The file header names the record, says it is deliberately not part of `npm test`, gives `Run with: npm run test:perf`, and lists each shape found with its pre-fix time."; "Assert the verdict as well as the time"; "Assert a long output with `assert.ok(value === expected, ...)` and a length-only message"; "Each case goes red when its fix is reverted. Prove it once by reverting." Shape 1 ("An unanchored global regex restarting inside every long token") applies to the `quote-exit-status` word scan: give it a left-boundary lookbehind of the class.
- `.claude/skills/windows-checkout-test-parity`: CI is Linux only, so the win32 cwd cases are pinned with `path.win32` injected (`pathImpl: path.win32`, injected `canonicalRealpath`), as the existing `win32()` fixture does.
- `.claude/skills/shell-scanner-bash-differential` governs `git-command.js` and the prefilter: this plan changes neither (the write-target test only calls `gitTargets`/`fileWriteTargets`/`mkdirTargets`). If a task finds it must change them, STOP and report.
- Decision rule (spec, author 2026-11-16): an unsettled choice takes the reading that keeps a run on the previous plugin release working, puts the rule in code, and stays inside Key Files; state the choice in the PR body.
- Commit subjects: `{Verb} {what} — {detail}`, `refs #5588`, never `closes`/`fixes`.

## Review Focus

1. A `git -C <cwd>` where `git` is reached through a pipeline tail (`ls | git -C . log`) — `atCommandStart` accepts after `|`; the rewrite is still the same command. Pin it as a positive case in Task 1.
2. Two `git -C` calls in one command where one qualifies and one does not (`git -C . log; git -C "$W" log`) — the whole rule must decline. Pin in Task 1.
3. `$?` words inside a `$( … )` (`echo "$(git log -1; echo r=$?)"` has `$?` in DQ; `x=$(git log; echo r=$?)` has it in SUB) — only `TOP` is rewritten. Pin the SUB case unchanged in Task 2.
4. A word starting with `=` (`echo =$?`) — zsh's `=cmd` expansion changes meaning once quoted; decline. Pin in Task 2.
5. A `git -C` operand with a trailing `/` on a win32 cwd (`git -C "D:\w\cwd/" log`) — shared predicate tolerates it exactly as `drop-redundant-cd` does. Pin in Task 1.

---

### Task 1: `drop-git-C-cwd` rule and the shared cwd-spelling predicate

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/guard-rewrite.js` (header comment lines 1-46; `dropRedundantCd` 671-691; `RULES` 693-705)
- Test: `tests/bin-lib/hooks/guard-rewrite.test.js`
- Test: `tests/guard-refusals/probe-doc.test.js` (lines 72-74: count 5 → 6, message names six)
- Modify: `docs/hooks.md` (line 24: add `drop-git-C-cwd` to the Rule ids list), `docs/reference/pretooluse-updatedinput-worktree-guard.md` (line 79: add the id to "Rule ids:") — so `probe-doc.test.js` stays green at this task's commit (plan review); the "five"→"seven" wording waits for Task 6

**Interfaces:**
- Produces: `spellsCwd(target: string, { cwd, pathImpl, realpath }): boolean` (module-private) — true iff `pathImpl.isAbsolute(target)`, target holds no `~` or `$`, `trimSlashes(target) === trimSlashes(cwd)`, and `realpath(target)` is non-null and equals `realpath(cwd)`. `dropRedundantCd` calls it in place of its own lines 686-689 (behavior unchanged; its existing tests stay green).
- Produces: `dropGitCCwd(s, { cwd, pathImpl, realpath }): string | null`, registered as `['drop-git-C-cwd', dropGitCCwd]` after `quote-escaped-space`.
- Produces: the operand sub-pattern shared with `LEADING_CD` — extract `CD_OPERAND` source (`'([^']*)'|"((?:[^"$`\\]|\\[^$`"\\\n])*)"|([A-Za-z0-9_.\/:@%+,=-]+)`) and build `LEADING_CD` from it, so both rules accept exactly the same three operand forms.

Rule semantics (Deliverable 1 and its Decided notes, all must hold, else return `null` for the whole command):
- Quick exits: text lacks `-C`; text contains `GIT_` anywhere.
- `sc = scan(s)`; `inDoubt(s, sc)` → null; `commandWordsPlain(s, sc)` false → null.
- Candidates: every `git` at index `i` with `sc.kind[i] === TOP`, `atWordStart`, `atCommandStart(s, sc.kind, i)`, and followed by a word break. A `git` not at command start (`env git`, `command git`, `xargs git`, `X=1 git`, inside `$( … )`) is not a candidate and is left alone.
- For a candidate whose next word is `-C`: operand must match one of the three `CD_OPERAND` forms followed by blanks (a glued `-C<dir>` is not a `-C` word → not a candidate, command unchanged). Operand text (unquoted value) holding `$`, a backtick, `*`, `?`, `[`, or `~` → decline. A second `-C` word in the same simple command (up to the next unquoted `;`, `&`, `|`, newline or `)`) → decline. The word after the operand must be in the read allowlist (Global Constraints) and end at a word break or end of text; otherwise decline.
- A candidate `git` whose first option is not `-C` but whose simple command has a `-C` word later (`git --no-pager -C /w/wt log`) → decline.
- Operand `.` (bare or quoted `'.'`/`"."`) → drop. Any other operand → drop only if `spellsCwd(value, ctx)` AND the text holds no whole word `cd`, `pushd` or `popd` anywhere (regex `/(?<![A-Za-z0-9_-])(?:cd|pushd|popd)(?![A-Za-z0-9_-])/`, quoted or not) AND (plan-review clarification, spec `## Plan Review Clarifications`) this `git` is the first command of the text, preceded only by leading literal assignments (its index equals `leadingAssignments(s).bodyStart`) — a snapshot function, alias, zsh `AUTO_CD` or an earlier function could otherwise move the directory first. Not spelling the cwd, or a literal operand on a later command → decline.
- Edit: replace `git<blanks>-C<blanks><operand><blanks>` with `git ` (exactly one blank before the subcommand). Apply all edits with `replaceSpans`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/bin-lib/hooks/guard-rewrite.test.js` (helper: `const posix = (command, cwd = '/w/wt', realpath = (p) => path.posix.resolve(p)) => rewriteForGuard({ command, cwd, pluginRoot: ROOT, pathImpl: path.posix, deps: { isLinkedWorktree: () => true, canonicalRealpath: realpath } })`):

```js
test('AC1.1: drop-git-C-cwd turns git -C . log into git log, and runs after drop-redundant-cd', () => {
  assert.deepStrictEqual(rw('git -C . log --oneline -3'), { command: 'git log --oneline -3', applied: ['drop-git-C-cwd'] });
  assert.deepStrictEqual(rw(`cd "${CWD}" && git -C . status --short`), { command: 'git status --short', applied: ['drop-redundant-cd', 'drop-git-C-cwd'] });
  assert.deepStrictEqual(rw("git -C '.' diff"), { command: 'git diff', applied: ['drop-git-C-cwd'] });
  assert.deepStrictEqual(rw('ls | git -C . log'), { command: 'ls | git log', applied: ['drop-git-C-cwd'] }, 'Review Focus 1: after a pipe');
});
test('AC2.1: drop-git-C-cwd drops a literal spelling of the cwd', () => {
  assert.deepStrictEqual(posix('git -C "/w/wt" grep -n x -- a/*.js'), { command: 'git grep -n x -- a/*.js', applied: ['drop-git-C-cwd'] });
});
test('AC2.1: /w/wt/ is rewritten', () => {
  assert.deepStrictEqual(posix('git -C "/w/wt/" log'), { command: 'git log', applied: ['drop-git-C-cwd'] });
});
// AC2.2 — one test per case, each returns null:
//   git -C "/w/other" log            (not the cwd)
//   cd sub && git -C "/w/wt" log     (a cd word; pins the cd/pushd/popd check: realpath stub must resolve "/w/wt" to the cwd)
//   pushd sub; git -C "/w/wt" log    and   popd; git -C "/w/wt" log
//   git -C "/w/wt" -C sub log        (second -C)
//   git --no-pager -C "/w/wt" log    (-C not first option)
//   git -C "$W" log                  (operand holds $)
// AC2.3 — one test per case, each returns null with cwd /w/wt:
//   -C "/w/wt/."   -C "/w/wt/sub/.."   -C "/W/WT"   -C "/w/wt-evil"
//   a symlink spelling: cwd /w/wt, command git -C "/w/link" log, realpath stub mapping /w/link → /w/wt (spelling compare is the only decline)
//   the glued form git -C/w/wt log
// AC2.4 — one test each, null:  git -C "/w/wt" commit -m x   ;   GIT_DIR=x git -C "/w/wt" log
// Plan-review clarification — one test each, null: z foo && git -C "/w/wt" log ; sub && git -C "/w/wt" log ;
//   f() { :; }; f; git -C "/w/wt" log ;  and positive: ls && git -C . log → 'ls && git log' (the . form needs no first-command test)
test('drop-git-C-cwd declines on a glob, ~ or backtick operand and on doubt', () => { /* git -C "/w/w*" log; git -C ~ log (cwd os.homedir()); git -C . log `id`; git -C . log <<EOF\nx\nEOF — each null */ });
test('drop-git-C-cwd declines when one of two git -C calls does not qualify', () => {
  assert.strictEqual(rw('git -C . log; git -C "$W" log'), null); // Review Focus 2
});
test('drop-git-C-cwd declines when a command word is not plain (source, eval, a computed word)', () => { /* `. ./f; git -C . log`, `eval x; git -C . log`, `$G -C . log` each null */ });
test('drop-git-C-cwd leaves git reached through env, command, xargs or an assignment prefix', () => { /* env git -C . log; command git -C . log; xargs git -C . log; X=1 git -C . log — each null */ });
test('drop-git-C-cwd runs after the inlining and quoting rules', () => {
  assert.deepStrictEqual(posix('W=/w/wt; git -C "$W" log'), { command: 'W=/w/wt; git log', applied: ['inline-literal-assignment', 'drop-git-C-cwd'] });
  assert.deepStrictEqual(posix('git -C /w/my\\ wt log', '/w/my wt'), { command: 'git log', applied: ['quote-escaped-space', 'drop-git-C-cwd'] });
});
test('drop-git-C-cwd under path.win32 shares drop-redundant-cd residuals', () => {
  // win32() fixture: cwd D:\w\cwd
  // git -C "D:\w\cwd" log → 'git log';  git -C "D:\w\cwd/" log → 'git log' (Review Focus 5)
  // git -C "D:/w/cwd" log, git -C "/d/w/cwd" log, git -C "d:\w\cwd" log (case-folding realpath) → null
});
```

Every AC2.2/AC2.3/AC2.4 decline test must pass an input on which only the named check declines (normalizer skill: "A must-decline pin proves its bail condition only when every other check accepts its input"): the operand spells the cwd and the realpath stub resolves it, except in the case under test.

Also update the existing test `'the allowlist keeps plain command words rewriting: …'` (line 321): its `git -C . status` row now also applies `drop-git-C-cwd`; move that row out of the loop into its own assertion expecting `{ command: 'P=/x; git status; node /x/z.js', applied: ['inline-literal-assignment', 'drop-git-C-cwd'] }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/hooks/guard-rewrite.test.js`
Expected: FAIL — the AC1.1/AC2.1 positive tests get `null`.

- [ ] **Step 3: Implement `spellsCwd`, `CD_OPERAND`, `dropGitCCwd` and register the rule**

Update the module header: list `drop-git-C-cwd` (same argv; `git -C .` and `git -C <cwd spelling>` run git in the directory it is already in) and its residual (rests on `drop-redundant-cd`'s premise that the shell starts in the cwd the hook input names; a `-C` spelling's effect on the harness's permission rules is not measured, hence the read allowlist). Update the comment above `RULES`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/hooks/guard-rewrite.test.js`
Expected: PASS (the existing drop-redundant-cd tests included).

- [ ] **Step 5: Prove each decline by mutation**

For each bail condition (GIT_ test, cd/pushd/popd test, second-`-C`, first-option, `$`/glob/`~` operand, read allowlist, `commandWordsPlain`, atCommandStart, spellsCwd's spelling compare), delete only that check in a scratch copy made from a `git archive` extract (never edit the worktree file in place for this), run the test file there, and record which pin went red. Write the list (check → red test name) into the task report; it goes into the PR body (Deliverable 4).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/guard-rewrite.js tests/bin-lib/hooks/guard-rewrite.test.js tests/guard-refusals/probe-doc.test.js docs/hooks.md docs/reference/pretooluse-updatedinput-worktree-guard.md
git commit -m "Add drop-git-C-cwd guard rewrite rule — drops git -C . and git -C <own worktree> on read subcommands, refs #5588"
```

---

### Task 2: `quote-exit-status` rule

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/guard-rewrite.js` (header, `RULES`)
- Test: `tests/bin-lib/hooks/guard-rewrite.test.js`
- Test: `tests/guard-refusals/probe-doc.test.js` (count 6 → 7, message names seven)
- Modify: `docs/hooks.md`, `docs/reference/pretooluse-updatedinput-worktree-guard.md` (add `quote-exit-status` to each Rule ids list, as Task 1 did)

**Interfaces:**
- Consumes: `scan`, `inDoubt`, `atWordStart`, `atCommandStart`, `replaceSpans`, `WORD_BREAK` (existing).
- Produces: `quoteExitStatus(s): string | null`, registered last as `['quote-exit-status', quoteExitStatus]`.

Rule semantics (Deliverable 2): quick exits — no `$?`; text contains `IFS`; text does not name `git` or `gh` as a whole word (`/(?<![A-Za-z0-9_.\/-])(?:git|gh)(?![A-Za-z0-9_.\/-])/`). `sc = scan(s)`; `inDoubt` → null. Scan words with a sticky/global regex anchored by a left-boundary lookbehind of its own class (`/(?<![A-Za-z0-9_.:=\/-])[A-Za-z0-9_.:=\/-]+\$\?/g`, regex-scan-linearity shape 1). Keep a match only when: `sc.kind[start] === TOP` and the `$` at `end-2` is `TOP`; `atWordStart`; the char after it is a word break or end of text; the word does not start with `=`; and the word's own simple command (the text from the previous unquoted `;`, `&`, `|`, newline or `(` at TOP up to the word) has a first word that is a `PLAIN_COMMAND_WORD`, is not an assignment (`/^[A-Za-z_][A-Za-z0-9_]*\+?=/`), is not in `RESERVED_WORDS` or `KEYWORD_PREFIXES` (`if`/`then`/`else`/`elif`, `{`, `do`, `time`, `!`, …), is not one of `export`, `declare`, `local`, `readonly`, `typeset`, `env`, and is not the word itself; and no redirection operator (`<`, `>`) appears between that segment start and the word. Any other position (plan review: `if git log; then rc=$?; fi` would become `then "rc=$?"`, a command) leaves that word unquoted. Edit: wrap the word in `"…"`. No kept match → null. A bare `$?` never matches (one or more class chars required).

- [ ] **Step 1: Write the failing tests**

Add to `tests/bin-lib/hooks/guard-rewrite.test.js`:

```js
test('AC3.1: quote-exit-status double-quotes exit=$? after a git command', () => {
  assert.deepStrictEqual(rw('git merge-base --is-ancestor A B; echo exit=$?'), { command: 'git merge-base --is-ancestor A B; echo "exit=$?"', applied: ['quote-exit-status'] });
  assert.deepStrictEqual(rw('gh pr view 1 --json n > f; echo rc:$?'), { command: 'gh pr view 1 --json n > f; echo "rc:$?"', applied: ['quote-exit-status'] });
});
// AC3.2 — one test per case, each returns null (each must otherwise reach the rule: names git, has a $? word):
//   git log -1; echo $?             (bare $?)
//   git log -1; X=$?                (assignment / command position)
//   git log -1; export rc=$?        (declaring command word; also declare/local/readonly/typeset/env, one pin each)
//   git log -1; echo "exit=$?"      (already double-quoted)
//   git log -1; echo 'exit=$?'      (single-quoted)
//   ls f; echo exit=$?              (no git/gh)
//   IFS=: ; git log -1; echo exit=$?  (IFS)
//   git log -1; echo =$?            (leading =, Review Focus 4)
//   x=$(git log -1; echo r=$?)      (inside $( … ), Review Focus 3)
//   git log -1; echo exit=$? `id`   (inDoubt)
//   if git log; then rc=$?; fi      (after a keyword prefix — plan review)
//   git log; { rc=$?; }             (after a reserved word)
//   git log; 2>/dev/null rc=$?      (after a redirection)
test('quote-exit-status leaves digit and .github text alone (whole-word git/gh only)', () => { /* echo digit; echo exit=$? → null; ls .github; echo exit=$? → null */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/hooks/guard-rewrite.test.js`
Expected: FAIL — AC3.1 gets `null`.

- [ ] **Step 3: Implement `quoteExitStatus` and register it; update the header (same argv: a word of literal class characters plus `$?` expands identically quoted and unquoted in bash and zsh, no field splitting since `$?` is digits and `IFS` is excluded) and the `RULES` comment**

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/hooks/guard-rewrite.test.js`
Expected: PASS

- [ ] **Step 5: Prove each decline by mutation** (as Task 1 Step 5: IFS, git/gh word, `=` lead, command/assignment position, declaring words, TOP-only, word-break end), recording check → red test.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/guard-rewrite.js tests/bin-lib/hooks/guard-rewrite.test.js tests/guard-refusals/probe-doc.test.js docs/hooks.md docs/reference/pretooluse-updatedinput-worktree-guard.md
git commit -m "Add quote-exit-status guard rewrite rule — double-quotes word=\$? after a git or gh call, refs #5588"
```

---

### Task 3: Equivalence, property and write-target invariance proofs

**Role:** integration

**Files:**
- Test: `tests/bin-lib/hooks/guard-rewrite.test.js`

**Interfaces:**
- Consumes: rule ids `drop-git-C-cwd`, `quote-exit-status` (Tasks 1-2); `gitTargets(command, cwd, opts)`, `fileWriteTargets(command, cwd, opts)`, `mkdirTargets(command, cwd, opts)` from `plugin/bin/lib/hooks/git-command.js`; `guardRewriteOutput(input, rewrite)`.

- [ ] **Step 1: Add the git stub and the positive cases**

Write `STUB/git` (mode 0o755): a `#!/bin/sh` script that, while `$1` is `-C`, runs `cd "$2" || exit 1; shift 2`, then prints the JSON of its remaining argv plus `$PWD` via the real node (`exec "${process.execPath}" -e 'console.log(JSON.stringify([process.env.PWD, ...process.argv.slice(1)]))' -- "$@"`), and exits 0. `CWD` is already a realpath (SANDBOX is realpath'd), satisfying "a temporary directory whose real path is the test's cwd". Add to `POSITIVE`:
`{ rule: 'drop-git-C-cwd', command: 'git -C . log --oneline -3' }`, `{ rule: 'drop-git-C-cwd', command: \`git -C "${CWD}" grep -n x -- a/*.js\` }`, `{ rule: 'drop-git-C-cwd', command: \`git -C '${CWD}/' status --short\` }`, `{ rule: 'quote-exit-status', command: 'git merge-base --is-ancestor A B; echo exit=$?' }`, `{ rule: 'quote-exit-status', command: 'git status; echo a/b:c=$?' }`.

- [ ] **Step 2: Add the drop-git-C-cwd must-decline equivalence cases (AC4)**

A test over cases whose naive drop differs under both shells: `git -C sub log` (a real `CWD/sub` dir), `git -C "${CWD}/sub" log`, and `cd sub && git -C "${CWD}" log` (naive `cd sub && git log` prints `CWD/sub`). Assert `rw()` is `null` and the naive rewrite's stdout differs from the original's under every shell in `SHELLS`. Assert `'equivalence harness discriminates'` still passes unchanged.

- [ ] **Step 3: Extend the property grammar (Deliverable 4)**

Add to `GRAMMAR.safe`: `'git -C . log'`, `'git -C . status; echo st=$?'`, `\`git -C "${CWD}" log\``, `'git log; echo exit=$?'`. Add to `GRAMMAR.risky`: `'git -C . -C sub log'`, `'cd sub && git -C . log'`, `'git -C "$P" log'`, `'export rc=$?'`, `'echo =$?'`, `'if true; then rc=$?; fi'`, `'{ rc=$?; }'`. Prepend `STUB` to the property test's `PATH` (it only stubs `ls`, `node`, `git`, none of which the old grammar runs). Keep the `rewritten >= 50` / `declined >= 50` floors; run and report the new diagnostic counts.

- [ ] **Step 4: Write the write-target invariance test (Deliverable 5, AC5)**

```js
const { gitTargets, fileWriteTargets, mkdirTargets } = require('../../../plugin/bin/lib/hooks/git-command');
const WRITE_CASES = [ // one writing command per rule that can write
  { rule: 'drop-redundant-cd', command: `cd "${CWD}" && git commit -m x && mkdir d && echo a > f` },
  { rule: 'inline-literal-assignment', command: 'P=/x; echo a > $P/f' },
  { rule: 'plugin-root-placeholder', command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/x.js" > out.txt' },
  { rule: 'node-eval-separator', command: `node -e ${EVAL} "$A" > out.txt` },
  { rule: 'quote-escaped-space', command: 'echo a > /a/b\\ c' },
  { rule: 'quote-exit-status', command: 'git commit -m x; echo exit=$? > log.txt' },
];
function targetsOf(command) { return { git: gitTargets(command, CWD), write: fileWriteTargets(command, CWD), mkdir: mkdirTargets(command, CWD) }; }
function assertSameTargets(rewrite) { for (const { command } of [...POSITIVE, ...WRITE_CASES]) { const out = rewrite(command); assert.ok(out, command); assert.deepStrictEqual(targetsOf(out.command), targetsOf(command), command); } }
test('AC5.1, AC5.2: every rewrite keeps gitTargets, fileWriteTargets and mkdirTargets equal', () => {
  for (const { rule, command } of WRITE_CASES) assert.deepStrictEqual(rw(command).applied, [rule], command);
  assertSameTargets(rw);
});
test('AC5.3: the invariance check goes red for a stub rule that drops a real cd sub &&', () => {
  fs.mkdirSync(path.join(CWD, 'sub'), { recursive: true });
  const dropCdSub = (c) => ({ command: c.replace('cd sub && ', ''), applied: ['stub'] });
  assert.throws(() => { const c = 'cd sub && git commit -m x'; assert.deepStrictEqual(targetsOf(dropCdSub(c).command), targetsOf(c)); });
});
```

Each WRITE_CASES entry must produce at least one non-empty target list on the original (assert it), so the equality is not vacuous. Adjust a case's shape only if its target list comes back empty, keeping one writing case per rule.

- [ ] **Step 5: AC8 tests**

```js
const { guardRewriteOutput } = require('../../../plugin/bin/lib/hooks/guard-rewrite');
test('AC8.1: guardRewriteOutput carries no permissionDecision for either new rule', () => {
  for (const command of ['git -C . log', 'git status; echo exit=$?']) {
    const out = guardRewriteOutput({ tool_name: 'Bash', cwd: CWD, tool_input: { command, description: 'd' } }, (o) => rewriteForGuard({ ...o, deps: linked }));
    assert.deepStrictEqual(Object.keys(out).sort(), ['hookEventName', 'updatedInput']);
    assert.strictEqual(out.updatedInput.description, 'd');
  }
});
test('AC8.2: guardRewriteOutput returns null outside a linked worktree for either new rule', () => { /* default rewrite, cwd CWD (plain dir): both commands → null */ });
```

- [ ] **Step 6: Run and verify**

Run: `node --test tests/bin-lib/hooks/guard-rewrite.test.js tests/hooks-bash-prefilter.test.js tests/hooks-pre-tool-use.test.js`
Expected: PASS, with no "zsh not present" diagnostic on this host (report it if present).

- [ ] **Step 7: Commit**

```bash
git add tests/bin-lib/hooks/guard-rewrite.test.js
git commit -m "Prove the two new guard rewrites under bash and zsh and pin write targets — refs #5588"
```

---

### Task 4: Linearity budget for the new scans

**Role:** integration

**Files:**
- Create: `perf/guard-rewrite-linearity.test.js`

- [ ] **Step 1: Write the perf file (AC10)**

Header per regex-scan-linearity conventions (record #5588, "deliberately NOT part of `npm test`", `Run with: npm run test:perf`, the shapes probed). Cases, each asserting verdict and time (`< 500` ms) on `rewriteForGuard({ command, cwd: '/w/wt', pathImpl: path.posix, deps: { isLinkedWorktree: () => true, canonicalRealpath: (p) => path.posix.resolve(p) } })`:
- many `git -C` words: `'git -C . log; '.repeat(4000) + 'true'` → verdict: rewritten, `out.command === 'git log; '.repeat(4000) + 'true'` (assert with `assert.ok(a === b, 'length …')`).
- many `$?` words: `'git log; ' + 'echo a=$? '.repeat(6000)` → rewritten (each word quoted).
- a long run of prefix characters with no `$?`: `'git log; echo ' + 'a/'.repeat(30000) + ' $?'` → `null` (bare `$?`).
- a long run of prefix characters ending in `$?`: `'git log; echo ' + 'a.'.repeat(30000) + '$?'` → rewritten.
Stay under the 64 KiB `MAX_COMMAND` ceiling (check each length).

- [ ] **Step 2: Run**

Run: `node --test perf/guard-rewrite-linearity.test.js`
Expected: PASS. Then remove the left-boundary lookbehind from the `quote-exit-status` regex in a scratch extract and confirm the prefix-run case goes red (or over the budget); record the time.

- [ ] **Step 3: Commit**

```bash
git add perf/guard-rewrite-linearity.test.js
git commit -m "Pin guard-rewrite's new scans as linear in perf — refs #5588"
```

---

### Task 5: Section 7 rows and their detectors

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/scratch-worktree.md` (§7 table, rows at lines 241-283; 33,126 B now, rail 52,500 B — three rows add ~1.5 KB)
- Modify: `tools/guard-refusals/shapes.js` (`DETECTORS`, lines 385-490)
- Test: `tests/guard-refusals/shapes.test.js`, `tests/skill-fence-guard-shapes.test.js`
- Modify: `plugin/skills/_shared/pr-run-comments.md` (only if a new detector flags a fence there)

- [ ] **Step 1: Add three refused rows** after the `git` runtime-operand row (line 258), each `| Shape | Example | refused | wording | Workaround | 2026-11-16 (#5588) |`:
1. `git -C .` — Example `` `git -C . rev-parse --short HEAD` `` — wording "points git at a directory computed at runtime (-C .)" — Workaround: drop `-C .` (`git rev-parse --short HEAD`).
2. `git -C <own worktree>` with a glob pathspec (the same `-C` without a glob, and the glob without `-C`, pass) — Example `` `git -C "<worktree>" grep -c X -- tools/guard-refusals/*.js` `` — wording "redirects git through a glob pattern that expands at runtime" — Workaround: drop `-C` when it names the session's own worktree (`git grep -c X -- tools/guard-refusals/*.js`).
3. A `git` command chained onto an unquoted `$?` (a quoted `"exit=$?"` passes; a bare `"$?"` is refused too) — Example `` `git merge-base --is-ancestor HEAD HEAD; echo exit=$?` `` — wording "names git in a form too complex to verify" — Workaround: quote it, `echo "exit=$?"`.
Then reword the paragraph under the table (line 285) to say the normalizer rewrites seven shapes and append the two: "`git -C .` or `git -C <cwd>` dropped on a read subcommand, a `word=$?` argument double-quoted after a `git`/`gh` call". Do not flip any row to passes.

- [ ] **Step 2: Add three detectors bound to the rows' exact Example cells** (`row` copied from the table, `\|` escapes intact): `git-C-dot` — a `git` command word followed by `-C` and the operand `.` (bare or quoted); `git-C-glob` — a `git -C <operand>` command with an unquoted `*`, `?` or `[` in a later word of the same simple command (any operand); `git-chained-status` — a `git` command word followed later in the same text by an unquoted `$?` word (test over `stripQuoted(t)`). Use the module's `CMD`/`CMD_POSITION` prefix so `digit`, `.github` and `github.com` do not match.

- [ ] **Step 3: Run**

Run: `node --test tests/guard-refusals/shapes.test.js tests/skill-fence-guard-shapes.test.js`
Expected: PASS with no new `ALLOWLIST` entry (AC7.1, AC7.3). AC7.2: at authoring the three shapes appear in `pr-run-comments.md` line 228 and `scratch-worktree.md` line 255 only as inline prose, not fences (`git grep -n -E 'git -C \.|\$\?' -- plugin/skills/_shared/pr-run-comments.md plugin/skills/_shared/scratch-worktree.md`); if `skill-fence-guard-shapes` flags a fence, rewrite that fence into the row's Workaround form (expected candidates: `pr-run-comments.md`, `scratch-worktree.md`); never add an allowlist entry. If the passes-row sweep fires a new detector, narrow the detector, not the row.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/_shared/scratch-worktree.md tools/guard-refusals/shapes.js tests/guard-refusals/shapes.test.js
git commit -m "Record git -C cwd and chained \$? refusals in section 7 with detectors — refs #5588"
```

---

### Task 6: Every site that names the rules

**Role:** integration

**Files:**
- Modify: `docs/hooks.md` (line 24 bullet)
- Modify: `docs/reference/pretooluse-updatedinput-worktree-guard.md` (line 79 paragraph; Not measured section)
- Modify: `docs/REGISTRY.md` (line 31)
- Modify: `docs/skill-authoring.md` (line 172)
- Modify: `docs/journeys/measure-worktree-guard-refusals-4028.md` (line 47)
- Modify: `docs/journeys/work-around-a-refused-worktree-bash-command-2776.md` (line 32)
- Modify: `.claude/skills/pretooluse-updatedinput-normalizer/SKILL.md`
- Test: `tests/guard-refusals/probe-doc.test.js` (lines 72-74)

- [ ] **Step 1: Confirm `probe-doc.test.js`** reads `assert.strictEqual(RULE_IDS.length, 7, 'docs/hooks.md, the probe reference doc and scratch-worktree.md section 7 say "seven shapes" — update them with the rule count')` (Tasks 1-2 set the count and the two ids); fix the message wording if it still says another number.

- [ ] **Step 2: Reword each site** to "seven" and name `drop-git-C-cwd` and `quote-exit-status` with a one-clause description (hooks.md: same parenthetical style as the others; reference doc: add both ids to the "Rule ids:" list, and a "Not measured" bullet: "how a permission rule written for the `git -C` spelling treats the plain spelling `drop-git-C-cwd` leaves, which is why the rule is restricted to read subcommands"). Do not touch any line pinned in `probe-doc.test.js`'s `PINNED`. In the normalizer skill: add Key-Patterns decline bullets for both rules (the shared `spellsCwd` test and cd/pushd/popd/`GIT_`/read-allowlist bails; the `IFS`/whole-word git-gh/declaring-word/`=`-lead bails), and change the Project Conventions "its "five shapes" count" to "its shape count".

- [ ] **Step 3: Verify (AC6)**

Run: `git grep -n -E "five (Bash |rule )?(shapes|ids)" -- docs plugin/skills plugin/bin tests/guard-refusals`
Expected: no output (exit 1). AC6.2 control (recorded at authoring, 2026-11-16, before the change): the same command printed 8 lines, one each in `docs/REGISTRY.md`, `docs/hooks.md`, the two journeys, the reference doc, `docs/skill-authoring.md`, `scratch-worktree.md`, `probe-doc.test.js`. Also run `git grep -n -i -e "five shapes" -e "five rule" -e "5 rules" -e "rewrites five" -- docs plugin .claude/skills tests tools` and resolve every hit. Then `node --test tests/guard-refusals/probe-doc.test.js` → PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/hooks.md docs/reference/pretooluse-updatedinput-worktree-guard.md docs/REGISTRY.md docs/skill-authoring.md docs/journeys/measure-worktree-guard-refusals-4028.md docs/journeys/work-around-a-refused-worktree-bash-command-2776.md .claude/skills/pretooluse-updatedinput-normalizer/SKILL.md tests/guard-refusals/probe-doc.test.js
git commit -m "Name the seven guard rewrite rules at every site that lists them — refs #5588"
```

---

### Task 7: Live probe 3 with the built plugin

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `docs/reference/pretooluse-updatedinput-worktree-guard.md` (new `## Probe 3` section after Probe 2)

- [ ] **Step 1: Write the probe prompt** to a session temp file (Write tool): ask the model to run, verbatim and one per Bash call, (1) `pwd`, (2) `git -C . rev-parse --short HEAD`, (3) `git -C "<the path pwd printed>" grep -c X -- tools/guard-refusals/*.js` with the path pasted literally, (4) `git merge-base --is-ancestor HEAD HEAD; echo exit=$?`, and to report each tool result.

- [ ] **Step 2: Run the plugin run and the control** from this worktree:

```bash
claude -p -w probe-5588-plugin --plugin-dir "<this worktree>/plugin" --model haiku --dangerously-skip-permissions --setting-sources local --output-format stream-json --verbose --include-hook-events --max-budget-usd 1 < "<prompt file>" > "$PIPELINE_RUN_DIR/evidence/guard-rewrite-probe3.jsonl"
claude -p -w probe-5588-ctl --model haiku --dangerously-skip-permissions --setting-sources local --output-format stream-json --verbose --include-hook-events --max-budget-usd 1 < "<prompt file>" > "$PIPELINE_RUN_DIR/evidence/guard-rewrite-probe3-control.jsonl"
```

(`$PIPELINE_RUN_DIR` written as its literal absolute path; `mkdir -p` the evidence dir first.) Extract each TOOL_USE command, the hook's `updatedInput`, and each TOOL_RESULT's `is_error` and text. Before running, record `git worktree list` output; after, remove only the two probe worktrees this step created — confirm each path and branch name is new in `git worktree list` versus that record and ends in `probe-5588-plugin`/`probe-5588-ctl` — (`git worktree remove` on each path, then `git branch -D` of their branches) and confirm with `git worktree list`. Touch no other worktree or branch.

- [ ] **Step 3: Write `## Probe 3`** with: Claude Code version (`claude --version`, 2.1.325 at authoring), the date, the two command lines, per form the control's refusal text and the plugin run's result plus the `updatedInput` command, and a line naming the evidence files. If the probe cannot run (no `claude`, no `-w`), STOP: write nothing, report AC9 unmet.

- [ ] **Step 4: Verify and commit**

Run: `node --test tests/guard-refusals/probe-doc.test.js` → PASS.

```bash
git add docs/reference/pretooluse-updatedinput-worktree-guard.md
git commit -m "Record live probe 3 of the two new guard rewrites — refs #5588"
```

- [ ] **Step 5: AC evidence entry**: one `log-decision.js --section "/build" --status AUTO --step "AC evidence"` line via `--text-file`, naming AC9.1-AC9.2, the command shape, and the evidence paths.

---

## Spec coverage map

| AC | Task / test |
|---|---|
| AC1.1, AC1.2 | Task 1 `AC1.1` test |
| AC2.1-AC2.4 | Task 1 `AC2.*` tests |
| AC3.1, AC3.2 | Task 2 |
| AC4.1, AC4.2 | Task 3 Steps 1-2 |
| AC5.1-AC5.3 | Task 3 Step 4 |
| AC6.1-AC6.3 | Task 6 |
| AC7.1, AC7.2, AC7.3 | Task 5 Step 3 |
| AC8.1, AC8.2 | Task 3 Step 5 |
| AC9.1-AC9.2 | Task 7 |
| AC10.1-AC10.2 | Task 4 |
| AC11.1 | /build Common Step 5 (`npm test -- --full` via verify) |

Waived tools/guard-refusals.js: read only for the #5587 re-derivation the spec conditions on #5587 having landed; #5587 is OPEN at authoring (logged in `decisions.md`), so the Current State counts stay as measured.

Check B classification (scope-keyword sweep hits not in a task, all no-change): `CHANGELOG.md` and `docs/plans/2026-10-24-guard-accepted-command-forms-ledger.md` (append-only history); `plugin/bin/lib/hooks/bash-prefilter.js` and `pre-tool-use.js` (wire the module lazily; no rule-specific text); `tests/hooks-bash-prefilter.test.js:112` and `tests/hooks-dispatcher.test.js:1070` (`git -C . status` exercises full-handler routing and a main-checkout `gitRepo()`, where `rewriteForGuard` returns null — unaffected); `tests/visual-decision-contract-conformance.test.js`, `tools/test-durations.json` (keyword coincidence). The other five hits are already in Task 6.
