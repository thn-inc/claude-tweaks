# Escaped-Blank Redirect Targets (#4294) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The write gate's glued-redirect scan resolves `echo $M\ >x`-shaped redirects (a `$`, `${ }` or backtick word part, then an escaped blank, then `>`), and the record's escaped-blank and line-continuation cases are pinned by name.

**Architecture:** #4281 (`1961010a1`) already made `tokenize` return bash word values, so classes 1 and 2 resolve on main (probed at `dc02e2700`); Task 1 pins them as characterization tests, per plan-review ruling Q3. The one code change is in `gluedRedirectOpEnd` (`plugin/bin/lib/hooks/git-command.js:1504`): a new module-private helper accepts a prefix whose last escaped blank follows only closed expansions, and holds the text after that blank to the existing plain-word rule. `bash-prefilter.js`'s `hasFileRedirection` reuses `redirectRawTargets`, so the prefilter follows with no edit of its own.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T225941-record-4294/work/4294-spec.md` (record #4294; its "Plan Review Clarifications" section overrides the Deliverables and Acceptance Criteria where they differ)

Scope keywords: gluedRedirectOpEnd, BALANCED_GROUP_RE, redirectRawTargets

Scope sweep (no-change hits): `plugin/bin/lib/hooks/bash-prefilter.js` calls `redirectRawTargets` unchanged and follows the parser (pinned by Task 2's prefilter test); `docs/hooks.md`'s Bash-prefilter section describes that reuse, not the glued-word rule. Behavior-change prose sweep: `grep -rln "gluedRedirectOpEnd\|BALANCED_GROUP_RE" plugin tests docs .claude/skills` printed only `git-command.js` and the journey; the rule's prose in `policy-schema-coverage.md` ("hold no `$`, backtick, or `(`") is Task 2's edit.

## Global Constraints

- Plan-review rulings (user, 2026-10-30), verbatim outcomes: Q1, `cd \'/wt\' && git commit` → `/r/'/wt'` and `echo x > \'/abs/f\'` → `/r/'/abs/f'`, and no #4281 pin is reverted. Q2, #4281 supersedes "keeping every other backslash pair verbatim": `tokenize("cp a C:\\r\\x \\'/wt\\'")` gives `C:rx` and `'/wt'`, the typed text stays in `typed`, `spanKinds[i].length === tokens[i].length` still holds, and no task restores verbatim pairs. Q3, "each going red when the change is reverted" covers the class-3 pins only; the six class-1/2 cases are characterization tests, each shown red against an uncommitted scratch mutant of `tokenize`'s unescaping lines, with that result quoted in the build report. Q4, `echo $M\ $N>x` and `echo ${M}\ ${N}>x` stay `[]`, pinned as known misses citing #4328.
- `echo $M>x` staying `[]` is the documented gap and must not change.
- Every expected target in a test comment carries a real-shell verdict, from "Shell verdicts" below. Expected paths go through `path.resolve`, never a bare POSIX string.
- Test titles name the record and the behavior (`#4294: …`) and cite AC clause ids, never review-round labels.
- Commits: `{Verb} {what} — {detail}` style, with `refs #4294` — never `closes` or `fixes`. End each commit message with the line `Claude-Session: https://claude.ai/code/session_017vXcAbioHEbyiUeSQDLQRz`.
- `plugin/skills/_shared/policy-schema-coverage.md` is 38,423 B against the 52,500 B rail (`RAIL_BYTES`); Task 2 adds under 1 KB, leaving about 13 KB. Do not touch the `proseList` anchor phrases in its heredoc paragraph (`tests/hooks-gate-coverage.test.js`).
- Governing project skill `.claude/skills/shell-scanner-bash-differential/SKILL.md`, applicable rules verbatim:
  - "Run every case you add or change under `/bin/bash` (3.2, macOS) and a bash 5 (`/opt/homebrew/bin/bash` here)." "Write the verdict into the test comment, the way `tests/hooks-gate-coverage.test.js` does (\"bash 3.2 and 5 write /main/f.js for each\"). When the versions disagree, note it (\"bash 3.2 cannot parse the odd-quote heredoc one\") and side with whichever shell writes. Never derive an expected target from the scanner's own output or from memory of the bash manual."
  - "Every new rule can regress a shape that already worked. Run the full case list through `git-command.js` at the merge-base and at earlier revisions of the branch, in a scratch `git worktree add --detach`. Diff the targets. Anything that moves from denied to allowed needs its own bash verdict."
  - "In a scratch worktree, delete or invert each rule one at a time and run the four suites. A mutant that every test survives means one of two things: a pin is missing (add a case that fails on the mutant), or the rule is dead (remove it)."
  - "A pin tagged with a record gets the same check against the release before that record: load that release's `git-command.js` from a scratch worktree, and if the pin passes there too, it pins nothing the record changed. Give it an input that fails there, or retitle it as a pre-existing pin."
  - "A new guarded program word or parser needs its own line in the differential corpus in `tests/hooks-bash-prefilter.test.js`."
  - "Test titles name the record and the behavior (`#4149: …`), never review-round labels (m1, F2, round N)."
  - "Expected paths the scanner resolves go through `path.resolve` (`MAIN_F` in `tests/hooks-gate-coverage.test.js`), or the pin fails on win32."
- Governing project skill `.claude/skills/regex-scan-linearity/SKILL.md`: the helper is three forward scans over one token and adds no regex, so it stays linear per token, as `gluedRedirectOpEnd` is; no perf budget is added. The other project skills naming these files (`windows-checkout-test-parity`, `skill-prose-conformance-tests`) reduce here to the `path.resolve` rule above and the anchor rule for the coverage doc.

## Shell verdicts (recorded 2026-11-03, the skill's bounded runner, `/bin/bash` 3.2, `/opt/homebrew/bin/bash` 5, `/bin/zsh`; all three agree on every row)

Cwd `/r`, `M`/`N` unset unless assigned, `d` and `a` stub commands. All of these also went through a scratch copy of this plan's helper at base `dc02e2700`.

| Command | Shells write | Base | With the helper |
|---|---|---|---|
| `echo $M\ >x`, `echo ${M}\ >x`, ``echo `d`\ >x``, `echo $M\ bar>x`, `M=a; echo $M\ >x`, `echo $1\ >x`, `echo $M\<TAB>>x`, `echo $M\ $N\ >x`, `echo ${M}a\ b>x`, `echo ${M:-${N}}\ >x`, `echo a$M\ >x`, `echo "q"$M\ >x`, `echo $M\ "q">x`, `echo $M\ 'q'>x`, `echo $M\ >>x`, `echo $M\ >\|x`, `echo $M\ &>x`, `A=$M\ >x`, `cd $M\ >x`, `echo $(d $M\ >x)` | x | `[]` | x |
| `echo $\{M\ >x`, ``echo \`$M\ >x``, `echo \($M\ >x`, `echo $M\ \$N>x`, `echo $M\ "$N">x`, `echo $M\ \(a>x`, `echo $\[$M\ >x` (an escaped or quoted `{`, `[`, backtick, `(` or `$` is text) | x | `[]` | x |
| `echo ${M\ >x}`, `echo ${M:-${N}\ >x}`, `echo a(b)\ >x`, `echo $M\ (a)>x`, ``echo `d\ >x``, `echo $M\ "a>x`, `echo "a\ >x`, `echo $M\>x`, `echo $(($M\ >1))`, `echo $[1\ >x]`, `echo $[$M\ >x]`, `[[ $M\ >x ]]`, `(( $M\ >1 ))`, `echo $M\ >&2`, `echo $M\ >/dev/null` | none | `[]` | `[]` |
| Known misses, fail-open, unchanged: `echo $M>x`, `echo $M\ $N>x`, `echo ${M}\ ${N}>x`, ``echo $M\ `d`>x``, `echo $M\a>x` (#4328 owns a bare `$` part); `echo "$(a $M\ >x)"` (nested, as `"$(a>x)"` is at base); `echo $(d)\ >x`, `echo $((1))\ >x`, ``echo `d e`\ >x``, ``echo `$M\ >x`` (see Review Focus) | x | `[]` | `[]` |
| Known misses, a `$VAR` target behind a second `$` or a backtick, which `substituteVars` skips: `WT=y; echo $M\ >$WT/x`, ``WT=y; echo `d`\ >$WT/x`` (`WT=y; echo foo>$WT/x` is the resolved one-`$` form) | y/x | `[]` | `[]` |
| Named false denies, matching what base already does for the plain word (`echo ${M:-a foo>x}` gives `/r/x}`, `echo $(( a b>1 ))` gives `/r/1`): `echo ${M:-a $N\ >x}`, `echo $(( $M\ >1 ))` | none | `[]` | `/r/x}`, `/r/1` |

Classes 1 and 2, same three shells: `mkdir a\ b` makes `/r/a b`; `mkdir -p {root}/a\ b/c` makes `{root}/a b/c`; `cp a my\ file.js` writes `/r/my file.js`; `cd {root}/a\ b && touch f` writes `{root}/a b/f`; `echo x >{root}/ma\<newline>in/x` writes `{root}/main/x`; `mkdir -p \<newline>{root}/abs/dir` makes `{root}/abs/dir`. AC2: `echo "a\" b>c "` none; `echo foo>x` x; `echo foo\\>x` x; `echo foo\>x` none; `echo a\"b>c` c; `echo "hi">x` x; `(ls)>out` out; `cd \'wt\' && touch f` writes `/r/'wt'/f`; `echo x > \'/abs/f\'` writes `/r/'/abs/f'`.

## Review Focus

- A `${` the escaped blank sits inside (`echo ${M\ >x}`, `echo ${M:-${N}\ >x}`): must stay `[]`, since bash writes nothing. Pinned in Task 2.
- An unterminated backtick or quote around the escaped blank (``echo `d\ >x``, `echo $M\ "a>x`, `echo "a\ >x`): must stay `[]`, a bash EOF error. Pinned in Task 2.
- A `$NAME` after the last escaped blank (`echo $M\ $N>x`): stays `[]` as `$N>x` does (Q4, #4328). Pinned in Task 2.
- A `>` inside `"$( … )"` (`echo "$(a $M\ >x)"`): `isNested`, unchanged, must still reject it. Pinned in Task 2.
- A closed `$( )`, an arithmetic `$(( ))` or a backtick holding a blank before the escaped blank (`echo $(d)\ >x`, ``echo `d e`\ >x``): bash writes x and the scanner stays `[]`. Neither the record nor #4328 names them, so they are pinned as known misses in Task 2 and handed back in Task 2's report for a follow-up record.
- A `$[ ]` arithmetic word (`echo $[1\ >x]`, `echo $[$M\ >x]`): the `$` rule kept it `[]` at base and the helper relaxes that rule, so the helper rejects a bare `$[` before the blank. Pinned in Task 2. An expansion the single token cannot see opening (`echo ${M:-a $N\ >x}`, `echo $(( $M\ >1 ))`) reads as a false deny, the same fail-closed read base gives the plain word, and is pinned as named.

---

### Task 1: Pin the record's escaped-blank, line-continuation and carry-over cases

**Role:** integration

**Files:**
- Test: `tests/hooks-gate-coverage.test.js` (insert after the `#4210 F2` test, which ends at line 1042)
- Test: `tests/hooks-git-command.test.js` (insert after the `#4281: spanKinds stays aligned…` test, which ends at line 858)

**Interfaces:**
- Consumes: `fileWriteTargets(command, cwd)`, `mkdirTargets(command, cwd)`, `gitTargets(command, cwd)` (from `gitCommand`, both test files already import what they use; add a name only if a run reports it undefined), `tokenize(seg)`.
- Produces: nothing later tasks call.

- [ ] **Step 1: Write the tests in `tests/hooks-gate-coverage.test.js`**

```js
// #4294 classes 1 and 2 are bash word values since #4281, so these are characterization pins of
// #4281's tokenize, shown red against a scratch mutant of its unescaping lines. bash 3.2, bash 5 and
// zsh write each target.
const at4294 = (action, f) => [{ action, file: path.resolve(f) }];
for (const [command, actual, expected] of [
  ['mkdir a\\ b', mkdirTargets, at4294('mkdir', '/r/a b')],
  ['mkdir -p /r/a\\ b/c', mkdirTargets, at4294('mkdir', '/r/a b/c')],
  ['cp a my\\ file.js', fileWriteTargets, at4294('copy', '/r/my file.js')],
  ['cd /r/a\\ b && git commit -m x', gitTargets, [{ action: 'commit', dir: path.resolve('/r/a b') }]],
  ['echo x >/ma\\\nin/x', fileWriteTargets, at4294('write', '/main/x')],
  ['mkdir -p \\\n/abs/dir', mkdirTargets, at4294('mkdir', '/abs/dir')],
]) {
  test(`AC1.1 #4294: ${JSON.stringify(command)} resolves bash's target (characterization of #4281)`, () => {
    assert.deepStrictEqual(actual(command, '/r'), expected);
  });
}

// #4294 AC2, #4212's carried-over expectations as amended at plan review (Q1): an escaped quote is a
// literal path character, so bash 3.2, bash 5 and zsh write under the cwd. `echo a\"b>c` writes c;
// `echo "a\" b>c "` and `echo foo\>x` write nothing; `echo foo\\>x` writes x. `echo $M>x` writes x
// too, a known miss #4328 owns.
test('AC2.1 #4294: #4212\'s carried-over redirect expectations hold', () => {
  const at = (f) => [{ action: 'write', file: path.resolve('/r', f) }];
  assert.deepStrictEqual(fileWriteTargets('echo "a\\" b>c "', '/r'), []);
  assert.deepStrictEqual(fileWriteTargets('echo foo>x', '/r'), at('x'));
  assert.deepStrictEqual(fileWriteTargets('echo foo\\\\>x', '/r'), at('x'));
  assert.deepStrictEqual(fileWriteTargets('echo foo\\>x', '/r'), []);
  assert.deepStrictEqual(fileWriteTargets('echo $M>x', '/r'), []);
  assert.deepStrictEqual(fileWriteTargets('echo a\\"b>c', '/r'), at('c'));
  assert.deepStrictEqual(gitTargets("cd \\'/wt\\' && git commit -m x", '/r'), [{ action: 'commit', dir: path.resolve('/r', "'/wt'") }]);
  assert.deepStrictEqual(fileWriteTargets("echo x > \\'/abs/f\\'", '/r'), at("'/abs/f'"));
});

// #4294 AC3: #4210's cases still resolve. bash 3.2, bash 5 and zsh write x and out.
test('AC3.1 #4294: #4210\'s quoted-span and one-word-group redirects still resolve', () => {
  assert.deepStrictEqual(fileWriteTargets('echo "hi">x', '/r'), [{ action: 'write', file: path.resolve('/r', 'x') }]);
  assert.deepStrictEqual(fileWriteTargets('(ls)>out', '/r'), [{ action: 'write', file: path.resolve('/r', 'out') }]);
});
```

- [ ] **Step 2: Write the test in `tests/hooks-git-command.test.js`**

```js
test('AC1.1 #4294: tokenize unescapes a blank and deletes a line continuation, with the mask shrinking to the value (characterization of #4281)', () => {
  // Q2: tokens are bash word values and the typed text stays in typed.
  const q2 = tokenize("cp a C:\\r\\x \\'/wt\\'");
  assert.deepStrictEqual(q2.tokens, ['cp', 'a', 'C:rx', "'/wt'"]);
  assert.strictEqual(q2.typed[2], 'C:\\r\\x');
  for (const [seg, word, value, kinds] of [
    ['mkdir a\\ b', 1, 'a b', 'beb'],
    ['echo a\\"b', 1, 'a"b', 'beb'],
    ['echo x >/ma\\\nin/x', 2, '>/main/x', 'bbbbbbbb'],
    ['mkdir -p \\\n/abs', 2, '/abs', 'bbbb'],
  ]) {
    const { tokens, spanKinds } = tokenize(seg);
    assert.strictEqual(tokens[word], value, seg);
    assert.strictEqual(spanKinds[word], kinds, seg);
    tokens.forEach((tok, i) => assert.strictEqual(spanKinds[i].length, tok.length, `${seg} word ${i}`));
  }
});
```

- [ ] **Step 3: Run them; they pass at base, as characterization**

Run: `node --test --test-name-pattern="#4294" tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 4: Prove the class 1/2 pins discriminate (Q3; scratch mutant, never committed)**

In the scratch checkout `{scratch}` the controller created and names in your brief (detached at `dc02e270013c9ce0bb5d7ac4bdb78272822dcaa1`; it removes it after Task 2), copy the two test files over its copies, then mutate that copy's `plugin/bin/lib/hooks/git-command.js` `tokenize`, one mutant at a time, running Step 3's command there and restoring after each:
1. Delete `if (c === '\\' && next === '\n') { j += 1; continue; }`. Expected: FAIL on both continuation rows (`echo x >/ma\<newline>in/x`, `mkdir -p \<newline>/abs/dir`) and the mask test.
2. Change `(isBare || '$`"\\'.includes(next))` to `('$`"\\'.includes(next))`. Expected: FAIL on all four escaped-blank rows and the mask test.

Each run's raw output goes to `$PIPELINE_RUN_DIR/evidence/4294-tokenize-mutants.txt` (absolute path, `mkdir -p` first, plain Bash redirect). Quote the two summaries in your report: Q3 requires them in the build report. Confirm `git status --porcelain` in this worktree lists no change from the mutants.

- [ ] **Step 5: Commit**

```bash
git add tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js
git commit -m "Pin the escaped-blank, continuation and carry-over redirect cases — refs #4294"
```

### Task 2: Resolve a glued redirect after an escaped blank that follows closed expansions

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js:1492-1520` (`gluedRedirectOpEnd` and its comment block)
- Test: `tests/hooks-gate-coverage.test.js` (insert after Task 1's tests)
- Test: `tests/hooks-bash-prefilter.test.js` (corpus line in `DIFFERENTIAL_CORPUS`, and a new test after the `AC3.1 #4210` test near line 213)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:28` (the "Bare shell redirection is covered (#3080)." paragraph)
- Modify: `docs/journeys/write-a-glued-redirect-from-the-main-checkout-4015.md` (step 2's "Should understand", step 3's gap list, an Origin line)

**Interfaces:**
- Consumes: `gluedRedirectOpEnd(raw, kinds, nest)`: `raw` the pre-substitution token, `kinds` its `spanKinds` string (`b`/`e`/`s`/`d`/`x`), `k` the index of the first bare `>`.
- Consumes: `{scratch}`, the same scratch checkout, named in your brief.
- Produces: `escapedBlankPrefixOk(raw: string, kinds: string, k: number): boolean`, module-private, not exported.

- [ ] **Step 1: Write the failing tests in `tests/hooks-gate-coverage.test.js`**

```js
// #4294 class 3: an escaped blank ends a `$NAME`, `${ … }` or backtick word part, so a glued `>` after
// it is a redirect. bash 3.2, bash 5 and zsh write x for each.
for (const command of [
  'echo $M\\ >x', 'echo ${M}\\ >x', 'echo `d`\\ >x', 'echo $M\\ bar>x', 'M=a; echo $M\\ >x', 'echo $1\\ >x',
  'echo $M\\\t>x', 'echo $M\\ $N\\ >x', 'echo ${M}a\\ b>x', 'echo ${M:-${N}}\\ >x',
  'echo a$M\\ >x', 'echo "q"$M\\ >x', 'echo $M\\ "q">x', "echo $M\\ 'q'>x",
  'echo $M\\ >>x', 'echo $M\\ >|x', 'echo $M\\ &>x', 'A=$M\\ >x', 'cd $M\\ >x', 'echo $(d $M\\ >x)',
  // An escaped or quoted `{`, `[`, backtick, `(` or `$` is text, so it opens nothing.
  'echo $\\{M\\ >x', 'echo $\\[$M\\ >x', 'echo \\`$M\\ >x', 'echo \\($M\\ >x', 'echo $M\\ \\$N>x', 'echo $M\\ "$N">x', 'echo $M\\ \\(a>x',
]) {
  test(`AC1.1 #4294: ${JSON.stringify(command)} resolves its glued redirect after closed expansions and an escaped blank`, () => {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', 'x') }]);
  });
}

// bash 3.2, bash 5 and zsh write nothing for each: a bad substitution, a syntax error, an unterminated
// backtick or quote, an escaped `>`, a comparison, an fd dup or a sink.
test('AC1.1 #4294: an escaped blank inside an open expansion or before a non-operator `>` resolves no target', () => {
  for (const command of [
    'echo ${M\\ >x}', 'echo ${M:-${N}\\ >x}', 'echo a(b)\\ >x', 'echo $M\\ (a)>x', 'echo `d\\ >x', 'echo $M\\ "a>x', 'echo "a\\ >x',
    'echo $M\\>x', 'echo $(($M\\ >1))', 'echo $[1\\ >x]', 'echo $[$M\\ >x]', '[[ $M\\ >x ]]', '(( $M\\ >1 ))', 'echo $M\\ >&2', 'echo $M\\ >/dev/null',
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], JSON.stringify(command));
  }
});

// Known misses: bash 3.2, bash 5 and zsh write x for each, and the scanner resolves no target. `echo $M>x`
// is the documented gap (plan review Q4); a bare `$`, backtick or non-blank escape after the last escaped
// blank is the same shape, owned by #4328. A `>` in "$( … )" stays nested. A closed `$( )`, an arithmetic
// `$(( ))` or a backtick holding a blank before the escaped blank is not read as closed. A `$VAR` target
// behind a second `$` or a backtick is one substituteVars skips: those two write y/x.
test('#4294: known misses stay without a target', () => {
  for (const command of [
    'echo $M>x', 'echo $M\\ $N>x', 'echo ${M}\\ ${N}>x', 'echo $M\\ `d`>x', 'echo $M\\a>x',
    'echo "$(a $M\\ >x)"', 'echo $(d)\\ >x', 'echo $((1))\\ >x', 'echo `d e`\\ >x', 'echo `$M\\ >x`',
    'WT=y; echo $M\\ >$WT/x', 'WT=y; echo `d`\\ >$WT/x',
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], JSON.stringify(command));
  }
});

// Named false denies: bash 3.2, bash 5 and zsh write nothing, and the scanner names a fragment, because one
// token cannot see the expansion an earlier token opened. Base reads the plain word the same way
// (`echo ${M:-a foo>x}` gives /r/x}, `echo $(( a b>1 ))` gives /r/1), and a deny is the safe side of it.
test('#4294: an expansion opened in an earlier token reads as a false deny, as the plain word does', () => {
  assert.deepStrictEqual(fileWriteTargets('echo ${M:-a $N\\ >x}', '/r'), [{ action: 'write', file: path.resolve('/r', 'x}') }]);
  assert.deepStrictEqual(fileWriteTargets('echo $(( $M\\ >1 ))', '/r'), [{ action: 'write', file: path.resolve('/r', '1') }]);
});
```

Prefilter (`tests/hooks-bash-prefilter.test.js`): add `'echo $M\\ >tracked.js',` to `DIFFERENTIAL_CORPUS` under the comment `// #4294: a glued redirect after a $NAME word and an escaped blank.`, and after the `AC3.1 #4210` test:

```js
test('AC1.1 #4294: the differential corpus lists the escaped-blank shape, and it takes the full-handler path', () => {
  assert.ok(DIFFERENTIAL_CORPUS.includes('echo $M\\ >tracked.js'));
  assert.strictEqual(shouldRunFull('pre-tool-use', bash('echo $M\\ >tracked.js')), true);
  assert.strictEqual(hasFileRedirection('echo $M\\ >tracked.js'), true);
  assert.strictEqual(hasFileRedirection('echo $M>tracked.js'), false);
});
```

Use the same `bash(...)` payload helper the `AC3.1 #4210` test uses.

- [ ] **Step 2: Run them to verify the class-3 pins fail**

Run: `node --test --test-name-pattern="#4294" tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js`
Expected: FAIL. Every row of the "resolves its glued redirect" loop, the false-deny test and the new prefilter test fail; the other new gate tests and Task 1's pass at base.

- [ ] **Step 3: Implement `escapedBlankPrefixOk(raw, kinds, k)` above `gluedRedirectOpEnd` and call it**

In `gluedRedirectOpEnd`, the rejection becomes: return null when `!plain` and neither the `BALANCED_GROUP_RE` exception nor `escapedBlankPrefixOk(raw, kinds, k)` holds. In that function's comment block, change "The one exception is a prefix" to "One exception is a prefix" and add one sentence naming this second exception and `#4294`. The helper, whose guards the tests above were proved against in a scratch copy:

```js
// #4294: a prefix whose LAST escaped blank (`\ ` or an escaped tab, kind `e`) follows only closed
// expansions. Before that blank: no bare `(` or `$[`, no stray (`x`) character, every bare `${` closed by a
// bare `}` (counted, so `${M:-${N}}` closes) and every bare backtick paired. After it: the plain-word
// rule above (no stray, no bare `$`, backtick or `(`), so `$M\ $N>x` stays out as `$N>x` does (#4328).
function escapedBlankPrefixOk(raw, kinds, k) {
  let blank = -1;
  for (let j = 0; j < k; j += 1) if (kinds[j] === 'e' && (raw[j] === ' ' || raw[j] === '\t')) blank = j;
  // No blank (-1): the after-part is the whole prefix, which the caller already found not plain.
  for (let j = blank + 1; j < k; j += 1) {
    if (kinds[j] === 'x' || (kinds[j] === 'b' && '$`('.includes(raw[j]))) return false;
  }
  let braces = 0;
  let tick = false;
  for (let j = 0; j < blank; j += 1) {
    if (kinds[j] === 'x') return false;
    if (kinds[j] !== 'b') continue;
    const c = raw[j];
    if (c === '(') return false;
    if (c === '`') tick = !tick;
    else if (c === '$' && raw[j + 1] === '[' && kinds[j + 1] === 'b') return false;
    else if (c === '$' && raw[j + 1] === '{' && kinds[j + 1] === 'b') { braces += 1; j += 1; }
    else if (c === '}' && braces > 0) braces -= 1;
  }
  return braces === 0 && !tick;
}
```

- [ ] **Step 4: Run them to verify they pass, then the four scanner suites**

Run: `node --test --test-name-pattern="#4294" tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js`
Expected: PASS.
Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js`
Expected: PASS, 0 failures (AC3.1: the existing suites pass unchanged).

- [ ] **Step 5: Prove each guard with a mutant (scratch, never committed)**

In the scratch checkout, copy this branch's `git-command.js` and the three test files over its copies. One mutant at a time, run Step 4's first command there, expect FAIL, restore. Run each rather than predicting its rows; a mutant every test survives gets a discriminating case, or its rule is deleted as dead.
1. Start the after-part loop at `blank + 2`. Row expected red: `echo $M\ $N>x`.
2. Drop `kinds[j] === 'x' ||` in the after-part loop. `echo $M\ "a>x`.
3. Drop `kinds[j] === 'b' &&` in the after-part loop. `echo $M\ \$N>x`.
4. Drop `$` from the after-part set. `echo $M\ $N>x`.
5. Drop the backtick from the after-part set. ``echo $M\ `d`>x``.
6. Drop `(` from the after-part set. `echo $M\ (a)>x`.
7. Drop the before-part `kinds[j] === 'x'` return. `echo "a\ >x`.
8. Replace the before-part `if (kinds[j] !== 'b') continue;` with nothing. ``echo \`$M\ >x``.
9. Drop the before-part `(` return. `echo a(b)\ >x`.
10. Make the backtick toggle a no-op. ``echo `d\ >x``.
10a. Drop the `$[` return. `echo $[1\ >x]`.
10b. Drop `kinds[j + 1] === 'b'` from the `$[` branch. `echo $\[$M\ >x`.
11. Make the `${` branch a no-op. `echo ${M\ >x}`.
12. Drop `kinds[j + 1] === 'b'` from the `${` branch. `echo $\{M\ >x`.
13. Make the `}` branch a no-op. `echo ${M}\ >x`.
14. Replace `braces === 0 && !tick` with `true`. `echo ${M\ >x}`, ``echo `d\ >x``.
15. Accept any `e` character as the blank (drop the space-or-tab test). `echo $M\a>x`.
16. Revert the call in `gluedRedirectOpEnd`. Every row of the "resolves its glued redirect" loop: AC1's "red when the change is reverted", each row its own test, so the count is the row count.

Raw output goes to `$PIPELINE_RUN_DIR/evidence/4294-guard-mutants.txt`. Report one line per mutant: which rows went red.

- [ ] **Step 6: Base comparison (scratch)**

Step 5 left `{scratch}` holding this branch's copy, so first restore base there (`git -C "{scratch}" checkout dc02e270013c9ce0bb5d7ac4bdb78272822dcaa1 -- plugin/bin/lib/hooks/git-command.js`, its own Bash call). A scratchpad node script then `require`s both copies' `git-command.js` and diffs `fileWriteTargets(cmd, '/r')` over every command in this task's and Task 1's lists plus every string command in `tests/hooks-gate-coverage.test.js`'s redirect tests (the `#4015`, `#4210` and `#4303` tests). Also run the same diff with `pathImpl` set to `path.win32` on both sides only if the helper's change could reach path resolution; it does not, since the helper touches no path, so say so instead of running it. Expected: the only differences are the `/r/x` targets this task's first loop lists, moving from `[]` to `x`, and the two named false denies, each with a shell verdict above. Raw output goes to `$PIPELINE_RUN_DIR/evidence/4294-base-comparison.txt`.

- [ ] **Step 7: Update the prose**

`plugin/skills/_shared/policy-schema-coverage.md` line 28: change "the one exception is a word that is exactly one balanced bare group" to "one exception is a word that is exactly one balanced bare group", and after "…`diff <(a) <(b)>out`)." add: "The other exception is an escaped blank (`\ ` or an escaped tab) with everything before it closed, no bare `(` and every `${ … }` and backtick pair closed, and the rest of the word held to that same rule, so `echo $M\ >x`, `echo ${M}\ bar>x` and ``echo `d`\ >x`` resolve `x` while `echo ${M\ >x}` and `echo $M\ $N>x` do not (#4294); `echo $M>x` resolves no target either, a tracked gap (#4328), and neither does a `$VAR` target after such a word (`echo $M\ >$WT/x`). An expansion an earlier word opened is not seen, so `echo ${M:-a $N\ >x}` names the fragment `x}`, a false deny, as `echo ${M:-a foo>x}` does. A target is read as its bash value, so an escaped blank (`> my\ file`) and a backslash-newline (`>/ma\`+newline+`in/x`) inside it join as bash joins them (#4281)."

Journey, step 2's "Should understand", after "(`echo foo\ bar>x`)." add: "So is a `$NAME`, `${ … }` or backtick part closed before an escaped blank (`echo $M\ >x`, #4294); the text after that blank follows the same rule, so `echo $M>x` and `echo $M\ $N>x` stay without a target (#4328)." In the same paragraph, change "The one exception is a single balanced group" to "One exception is a single balanced group". Step 3's gap list, after "(`$((1))>x`, `((i>0))>x`)," add: "a glued `>` after a bare `$NAME` (`echo $M>x`, #4328), a glued `>` after an escaped blank that follows a `$( )`, a `$(( ))` or a backtick holding a blank (`echo $(d)\ >x`), a `$VAR` target after such a word (`echo $M\ >$WT/x`)," Origin, a new bullet before "Related journeys": "- Updated during build of #4294. An escaped blank after closed expansions (`echo $M\ >x`) now resolves its glued redirect; the escaped-blank and line-continuation path words the record named were already bash values since #4281 and are pinned by name."

Run: `node --test tests/hooks-gate-coverage.test.js`
Expected: PASS (the prose-list anchors are untouched).

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js plugin/skills/_shared/policy-schema-coverage.md docs/journeys/write-a-glued-redirect-from-the-main-checkout-4015.md
git commit -m "Resolve a glued redirect after closed expansions and an escaped blank — refs #4294"
```

## Spec coverage

| Spec item | Where |
|---|---|
| Deliverable 1 (`tokenize` unescapes, deletes a backslash-newline, mask aligned) | Already shipped by #4281, its verbatim clause superseded by Q2; pinned by Task 1 Steps 1-2, proved by Step 4's mutants |
| Deliverable 2 (glued scan after `$`/backtick and an escaped blank, not `$M>x`) | Task 2 |
| Deliverable 3 (`isUnresolvable` stops rejecting unescaped backslashes) | Already shipped by #4281 (it holds no backslash rule); covered by Task 1's class-1 pins |
| Deliverable 4 (journey and coverage-doc prose) | Task 2 Step 7 |
| AC1.1 | Task 1 (classes 1, 2, per Q3) and Task 2 (class 3, red on revert: Step 5 mutant 16) |
| AC2.1 | Task 1's second gate test, with Q1's relative targets |
| AC3.1 | Task 1's third gate test; Task 2 Step 4's four-suite run |
| AC4.1 | Common Step 5 and `/claude-tweaks:test`'s full-suite run |
