# Write-gate fail-opens (#4303) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `plugin/bin/lib/hooks/git-command.js`'s write walk report the path bash writes for the seven fail-open shapes in #4303 (U1, U2, U3, U4, U6, S49, S50), make `(( a>1 || b>2 ))` resolve no target (U14), and add the missing pins (S51, U13, U9).

**Architecture:** Each fix lands in the function that misreads the shape: the redirect scan (U6), the flag-cluster readers (U3, U4), `visitSegment`'s `cdLead` (U2), `groupEvents`' frame stack (S49), `segmentSpansWith` (U14), `walkShellChunk`'s per-span cwd bookkeeping (U1) and `joinCwds` (S50). Every verdict comes from real bash 3.2 and 5, never from the scanner or from memory. Unknowns fail closed: a spurious target is acceptable, a missed one is not.

**Tech Stack:** Node 18+ (CI runs Node 20), `node --test`, `/bin/bash` (3.2) and `/opt/homebrew/bin/bash` (5) as the oracle, GNU coreutils at `/opt/homebrew/opt/coreutils/libexec/gnubin` for the `-t` cases.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T143627-spec-4303/work/4303-spec.md` (record #4303)

## Global Constraints

- Follow `.claude/skills/shell-scanner-bash-differential` for every scanner change: a bash 3.2 and 5 verdict before the case is written, a base comparison, a mutant per rule, timing-free cap pins in `tests/`, wall clock only in `perf/`.
- Each new test comment states the bash verdict ("bash 3.2 and 5 write /main/f.js"). Where the versions split, side with the one that writes and say so.
- Test titles name the record and the behavior (`#4303: …`), never review-round labels.
- Expected paths go through `path.resolve` (`MAIN_F` = `path.resolve('/main/f.js')`), or the pin fails on win32.
- Unknowns fail closed: keep every possible cwd, never drop one to stay exact.
- The four scanner suites are `tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js`. Run them plus `perf/heredoc-scan-linearity.test.js` at the end of every task.
- Commit subject: `{Verb} {what} — {detail} (refs #4303)`, imperative, no conventional prefix, ending with the trailer `Claude-Session: https://claude.ai/code/session_01KtovsYaPQiXAyvhqrcq5XL`. Never "closes".
- The Bash guard refuses compound commands and `git` tokens inside complex arguments: write drivers as node scripts in the scratchpad (`/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/8a7d36f1-2ea9-4e44-8e25-9c9510abd62c/scratchpad/flow4303/`) and use plain `git -C <worktree>` calls.
- Never `git stash`.

## Bash verdicts already established (probe: `scratchpad/flow4303/probe-bash.js`, both versions agree)

| Command (cwd has dirs M, T, src) | bash 3.2 and 5 write |
|---|---|
| `echo x >& M/f`, `echo x >&M/f`, `echo x 1>&M/f` | `M/f` |
| `echo x 2>&M/f` | nothing ("ambiguous redirect") |
| `echo x >& 1` | nothing (fd dup) |
| `cd M \| true; echo x > f`, `true \| cd M; echo x > f`, `{ cd M; } \| cat; echo x > f` | `./f` |
| `cd M \|\| cd T; echo x > f` | `M/f` |
| `cd nope && cd T; echo x > f` | `./f` |
| `cd M \|\| cd T && echo x > f` (scanner today: `T/f`) | `M/f` |
| `cd nope && true \|\| echo x > f` (scanner today: `nope/f`) | `./f` |
| `cd nope && cd T \|\| echo x > f` (scanner today: `T/f`) | `./f` |
| `x=$((true); cd M; echo x > f)` (a `$(` holding a subshell; scanner today: `M/f`, must stay) | `M/f` |
| `cd M && echo $(true; cd T; true) > f` (scanner today: `M/f`, must stay) | `M/f` |
| `x=$(cd T) cd M; …`, ``x=`cd T` cd M; …``, `x=$(cd T)y cd M; …` | `M/f` |
| `cp -rt M src` (GNU) | `M/src/a` |
| `cp -tM src`, `cp -vtM src`, `cp --target=M src` (GNU) | target `M` (fail only for want of `-r`) |
| `cp -tr M src` (GNU) | target `r` (the rest of the cluster is `-t`'s value) |
| `perl -0pi …`, `perl -00pi …`, `perl -l0pi …` | edit `M/g` |
| `perl -pi.bak -e … M/g` | edit `M/g`, write `M/g.bak` |
| `cd M; y=$(( (1 & 3) )); echo x > f`, `x=$[1 & 3]; cd M; echo x > f` | `M/f` |

## Review Focus

- A session whose cwd is the main checkout running `cd "$WT_LITERAL" && cmd; git commit -m x`: after Task 6 the commit resolves under both the worktree and the start cwd, so it is denied. That is the deliberate fail-closed side of U1 (a failed `cd` skips `cmd` and the commit runs in the start cwd). Pin it as deliberate in Task 6, and keep `cd X && git commit` (one and-or list) exact.
- `perl -pi.bak` and `sed -ni.bak`: the same cluster regex that hid `-0pi` hides any cluster holding a backup suffix. Task 2 pins both.
- `cp --target=M` / `--targ M`: GNU accepts any unique prefix of `--target-directory` (cp, mv, install and ln have no other `--t…` option). Task 2 pins the prefix form.
- `$(( a>1 || b>2 ))` (the `$((` form, not only the `((` command): the same `||` cut gives spurious targets there. Task 5 pins both forms.
- A group piped into a pipeline (`{ cd M; } | cat`): the old `}` join reported `{start, M}`; after Task 6 the start cwd must still be in the set. Task 6 pins it.

## Acceptance-criteria coverage

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 9 Step 1 (e2e deny from a linked worktree), plus each task's unit pins |
| AC2.1 | Task 5 Step 1 |
| AC3.1 | Task 9 Step 4 |
| AC4.1 | Task 9 Step 5 |
| AC5.1 | Task 9 Step 6 |

Every Step 2 below is pre-run by `plan-audit.js` Check C before dispatch, when the new tests do not exist yet and a `--test-name-pattern` run matches nothing. Each Step 2 therefore uses `Expected: FAIL after Step 1`.

---

### Task 1: `>&` with a file target (U6)

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`isFdDupTarget`, `matchRedirectOperator`, `redirectWriteTargets`; the operator-list comments near `isFdDupTarget` and above `REDIRECT_OP_RE`, which say `>&N` is never matched)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:146` (`GATE_COVERAGE.bashRedirections`, and its comment at lines 141-145)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (the `Bash redirections:` line of the gate-coverage block and the "Bare shell redirection is covered" paragraph; the file is 27,269 B against the 52,500 B `RAIL_BYTES` rail)
- Test: `tests/hooks-gate-coverage.test.js`

**Interfaces:**
- Produces: `GATE_COVERAGE.bashRedirections` = `['>', '>>', '>|', '&>', '&>>', '>&']`.

- [ ] **Step 1: Write the failing tests** (after the `#3080` redirect tests)

```js
// #4303: csh-style `>& file` sends stdout and stderr to the file. bash 3.2 and 5 write M/f for
// `>& M/f`, `>&M/f` and `1>&M/f`; `2>&M/f` is an ambiguous redirect and writes nothing.
test('#4303: `>&` with a file target resolves the file, as bash writes it', () => {
  for (const cmd of ['echo x >& /main/f.js', 'echo x >&/main/f.js', 'echo x 1>&/main/f.js', 'cd /main && echo x >& f.js']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'write', file: MAIN_F }], cmd);
  }
});
test('#4303: `>&` with an fd, `-`, or a non-stdout fd prefix resolves no target', () => {
  for (const cmd of ['echo x >&2', 'echo x >& 2', 'echo x >&-', 'echo x >&3-', 'echo x 2>&1', 'echo x 2>&/main/f.js']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [], cmd);
  }
});
```

Also extend the existing `'policy-schema-coverage.md\'s coverage block lists exactly the Bash redirections the gate checks'` test only by the code/prose change below (no edit to the test itself).

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern="#4303: .>&." tests/hooks-gate-coverage.test.js`
Expected: FAIL after Step 1. Today's targets: `/r/&`, `/r/&/main/f.js`, `/main/&` for the cd case, `/r/&` for `>& 2`, `/r/&/main/f.js` for `2>&/main/f.js`.

- [ ] **Step 3: Implement**

In `redirectWriteTargets`, once `rawTarget` is known and before the `isFdDupTarget` check: when the operator is `>` with no fd prefix or the prefix `1`, and `rawTarget` begins with `&`, it is the csh form. `&` plus digits (optionally `-`), or `&-`, stays an fd dup (no target). A bare `&` takes the next token (consume it, as the `''` case does): digits (optionally `-`) or `-` there are still an fd dup (`>& 2`, no target), and anything else is the file. Otherwise the text after `&` is the file. With an fd prefix of 2 or more, an `&`-target that is not an fd dup resolves no target (bash: ambiguous redirect). `fileWriteTargets` always passes `spanKinds`, so the live branch reads the fd prefix from the digits of `head` (the text before `opEnd`). The start-anchored fallback reads it from `matchRedirectOperator`; extend that function to return the prefix rather than adding a second regex. Add `'>&'` to `GATE_COVERAGE.bashRedirections` and to the prose's `Bash redirections:` line. Add one sentence to the "Bare shell redirection is covered" paragraph, directly after the "An fd duplication (`>&2`, `2>&1`) … cheap." sentence and before the heredoc reader lists that `proseList` pins: "`>& file`, `>&file` and `1>&file` write the file (csh form, stdout and stderr together); `>& 2`, `>&-` and `2>&1` duplicate a descriptor, and `N>&file` for N of 2 or more is a bash error, so none of them is a file target." Update the three stale operator-list comments named under Files.

- [ ] **Step 4: Run the four scanner suites**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit** — `Resolve a csh-style >& file target in the write gate — >& f, >&f and 1>&f write f (refs #4303)`

---

### Task 2: Flag clusters — `-t` and in-place (U3, U4)

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`explicitTargetDir` and its three call sites, `hasInPlaceFlag`, `inPlaceEditTargets`)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (the in-place sentence: "`-i`, `-i.bak`, `--in-place`, or a bundled `-pi`/`-ni`")
- Test: `tests/hooks-gate-coverage.test.js`

**Interfaces:**
- Produces: `explicitTargetDir(rest: string[], valueLetters: string) -> string|null` — `valueLetters` are the command's short options that take a value (cp, mv: `'St'`; install: `'mogSt'`; ln: `'St'`). `hasInPlaceFlag(flags: string[], cmd: 'sed'|'perl') -> boolean`.

- [ ] **Step 1: Write the failing tests**

```js
// #4303: GNU getopt reads `-t` inside a short-option cluster: its value is the rest of the
// cluster, else the next word, and `--target-directory` may be abbreviated (cp, mv, install and
// ln have no other `--t…` option). bash 3.2 and 5 with GNU cp: `cp -rt M src` writes M/src;
// `cp -tM src`, `cp -vtM src` and `cp --target=M src` target M; `cp -tr M src` targets r.
for (const [cmd, dir] of [
  ['cp -rt /main a', '/main'], ['cp -tM a', 'M'], ['cp -vt/main a', '/main'], ['cp --target=/main a', '/main'],
  ['cp --targ /main a', '/main'], ['mv -vt /main a', '/main'], ['install -Dt /main f', '/main'], ['ln -st /main a', '/main'],
  ['cp -tr /main a', 'r'],
]) {
  test(`#4303: \`${cmd}\` resolves its -t directory`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r').map((t) => t.file), [path.resolve('/r', dir)]);
  });
}
// #4303: a digit or a backup suffix in a cluster does not hide -i. bash 3.2 and 5: perl -0pi,
// -00pi and -l0pi edit M/g; perl -pi.bak edits M/g and writes M/g.bak.
for (const cmd of ["perl -0pi -e 's/a/b/' /main/f.js", "perl -00pi -e 's/a/b/' /main/f.js", "perl -l0pi -e 's/a/b/' /main/f.js",
  "perl -0777pi -e 's/a/b/' /main/f.js", "perl -pi.bak -e 's/a/b/' /main/f.js", "sed -ni.bak 's/a/b/p' /main/f.js"]) {
  test(`#4303: \`${cmd}\` is an in-place edit`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'edit', file: MAIN_F }]);
  });
}
// A value-taking letter before i ends the cluster, so its i is that option's value, not -i.
for (const cmd of ["perl -Mi -e 'print' /main/f.js", "perl -0p -e 's/a/b/' /main/f.js", "sed -n -e 'p' /main/f.js"]) {
  test(`#4303: \`${cmd}\` is a read, not an edit`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), []);
  });
}
```

Real perl exits 2 on `-Mi` ("Can't locate i.pm") and writes nothing, so its expected `[]` holds.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern="#4303: .(cp|mv|install|ln|perl|sed) " tests/hooks-gate-coverage.test.js`
Expected: FAIL after Step 1, for every write case (the read cases pass today).

- [ ] **Step 3: Implement**

`explicitTargetDir(rest, valueLetters)`: for each word, `--target-directory=V` or any `--t…` prefix of `--target-directory` (with `=V`, else the next word); a short cluster `-XYZ` read left to right, where the first letter in `valueLetters` takes the rest of the cluster as its value (or the next word when nothing follows it), and is the target only when that letter is `t`. Stop at `--`. A small internal `readShortCluster(word, valueLetters) -> {letter, value|null}` is fine; export nothing new. Pass each command's letters at the three call sites (`grep -n 'explicitTargetDir(' plugin/bin/lib/hooks/git-command.js`: cp/mv, install, ln). The cp/mv `nonFlags` loop is read only when no target directory was found, so it needs no change.

`hasInPlaceFlag(flags, cmd)`: `--in-place[=…]` stays. A short cluster is read left to right: for perl, `0` and `l` consume the digits after them, `i` means in-place, and `e E I m M F x d D C` end the cluster (the rest is their value); for sed, `i` means in-place and `e f l` end the cluster. Any other letter is a plain switch. Pass `cmd` from `inPlaceEditTargets` (add the parameter there). Update the prose sentence to: "`-i`, `-i.bak`, `--in-place`, or `-i` inside a short-option cluster (`-pi`, `-ni`, `-0pi`, `-pi.bak`), read left to right up to the first option that takes a value".

- [ ] **Step 4: Run the four scanner suites** — PASS, 0 fail. Run `tests/hooks-pre-tool-use.test.js` too (it pins in-place cases).

- [ ] **Step 5: Commit** — `Read -t and -i inside short-option clusters in the write gate — cp -rt, -tDIR, --target=, perl -0pi and -pi.bak (refs #4303)`

---

### Task 3: An assignment-prefixed `cd` whose value splits into several tokens (U2)

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`visitSegment`)
- Test: `tests/hooks-gate-coverage.test.js` (add rows to the `#4149 group cd` table's neighbourhood as a `#4303` table)

**Interfaces:**
- Produces: `assignmentWordEnd(rawT: string[], spanKinds: string[], i: number) -> number` — the index just past the assignment word starting at token `i` (`i` itself when `rawT[i]` is not an assignment): the word runs on through later tokens until every bare `$(`, `(` and backtick it opened is closed, counted on `b` characters of `spanKinds`.

- [ ] **Step 1: Write the failing tests**

```js
// #4303: an assignment word holding a `$( … )` or backtick with spaces is one word to bash, so
// the `cd` after it changes the shell's cwd. bash 3.2 and 5 write M/f for each.
for (const cmd of ['x=$(cd /tmp) cd /main; echo hi | tee f.js', 'x=`cd /tmp` cd /main; cp a f.js', 'x=$(cd /tmp)y cd /main; cp a f.js',
  'a=1 x=$(echo a b) cd /main; cp a f.js']) {
  test(`#4303: \`${cmd}\` changes into the cd after the assignment`, () => {
    assert.ok(fileWriteTargets(cmd, '/r').some((t) => t.file === MAIN_F), JSON.stringify(fileWriteTargets(cmd, '/r')));
  });
}
// bash 3.2 and 5 refuse to parse this ("unexpected EOF") and write nothing; the scanner keeps
// the trailing write as a deliberate fail-closed tradeoff (this pin passes today and must stay).
test('#4303: an assignment whose substitution never closes is no cd lead (deliberate fail-closed tradeoff)', () => {
  assert.deepStrictEqual(fileWriteTargets('x=$(cd /tmp cd /main; cp a /r2/f.js', '/r').map((t) => t.file), [path.resolve('/r2/f.js')]);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern="#4303: .*(cd after the assignment|never closes)" tests/hooks-gate-coverage.test.js`
Expected: FAIL after Step 1, for the four cd-after-assignment rows (`/r/f.js` only today); the never-closes pin passes.

- [ ] **Step 3: Implement** — in `visitSegment`, replace the `SIMPLE_ASSIGNMENT_RE` skip loop with `cdLead = assignmentWordEnd(rawT, spanKinds, cdLead)` repeated while it advances; read `t[cdLead]` (the substituted array is index-aligned with `rawT`).

- [ ] **Step 4: Run the four scanner suites** — PASS.

- [ ] **Step 5: Commit** — `Read an assignment word across split substitution tokens before a cd — x=$(cd Q) cd M moves to M (refs #4303)`

---

### Task 4: An `&` inside arithmetic is no background (S49, S51)

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`groupEventsWith`: frame kinds, the lone-`&` branch, a `$[ … ]` frame)
- Test: `tests/hooks-gate-coverage.test.js` (the `#4149 lone & walk` table's neighbourhood)

**Interfaces:**
- Produces: every frame `groupEventsWith` pushes carries `cmd: boolean` — `true` for the root, `(`/`{` groups, `$(` and `<(`/`>(`; `false` for `$((`/`((` frames, a bare `(` pushed by `nest(1, false)`, and the new `$[` frame (`kind: 'p'`, `bracket: true`, closed by its matching `]`, counting nested `[`).

- [ ] **Step 1: Write the failing tests**

```js
// #4303: inside `$(( ))` or `$[ ]`, `&` is bitwise and, also inside a bare `(` there, so the cd
// before it holds. bash 3.2 and 5: `cd M; y=$(( (1 & 3) )); echo x > f` and `x=$[1 & 3]; cd M; …`
// write M/f, and the S49 shape commits in M. Each row sits inside `x=$(true; … )`: at the top level
// an `&` is already routed as a sub-run background, so only a substitution reaches the frame check.
// Confirm each wrapped row with the oracle before keeping it.
for (const [cmd, expected] of [
  ['x=$(true; cd /main && y=$(( (1 & 3) )) && cp a f.js)', [{ action: 'copy', file: MAIN_F }]],
  ['x=$(true; cd /main && y=$[1 & 3] && cp a f.js)', [{ action: 'copy', file: MAIN_F }]],
  ['x=$(true; cd /main && y=$[ (1 & 3) + a[1] ] && cp a f.js)', [{ action: 'copy', file: MAIN_F }]],
  ['x=$(true; cd /main && (( (1 & 3) )) && cp a f.js)', [{ action: 'copy', file: MAIN_F }]],
  ['cd /main && y=$[1 & 3] && cp a f.js', [{ action: 'copy', file: MAIN_F }]],
]) {
  test(`#4303: \`${cmd}\` keeps the cd past an arithmetic &`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), expected);
  });
}
test('#4303: the S49 shape commits in the main checkout', () => {
  assert.ok(gitTargets('x=$(true; cd /main && y=$(( (1 & 3) )) && git commit -am x)', '/r').some((t) => t.dir === path.resolve('/main')));
});
// #4303 (S51): an `&` inside a top-level backtick backgrounds only the backtick's own list.
// bash 3.2 and 5 write M/f.js.
test('#4303: an & inside a top-level backtick does not undo the outer cd', () => {
  assert.deepStrictEqual(fileWriteTargets('cd /main && x=`true | true & true` && echo x > f.js', '/r'), [{ action: 'write', file: MAIN_F }]);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern="#4303: .*(arithmetic &|S49 shape|top-level backtick)" tests/hooks-gate-coverage.test.js`
Expected: FAIL after Step 1. The four wrapped rows (`/r/f.js` today), the top-level `$[1 & 3]` row and S49 fail; the S51 pin passes (it pins existing behavior, and its `|| span.sub` mutant turns it red: `/r/f.js`).

- [ ] **Step 3: Implement** — mark frames as in Interfaces; the lone-`&` branch cuts only when `top().cmd`. In the word loop, `$[` pushes the bracket frame (as `$(` breaks out to `nest`), and a `]` while `top().bracket` decrements its nested-`[` count or pops it.

- [ ] **Step 4: Run the four scanner suites** — PASS.

- [ ] **Step 5: Commit** — `Cut a background only in a command frame — an & inside $(( )) or $[ ] is arithmetic (refs #4303)`

---

### Task 5: `segmentSpans` keeps arithmetic whole (U14)

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`segmentSpansWith`)
- Test: `tests/hooks-gate-coverage.test.js` (next to `'AC2.1 #4210: arithmetic and nested groups stay target-free'`)

**Interfaces:** none new; `segmentSpans(command)` keeps its `{ text, end, sub }` shape.

- [ ] **Step 1: Write the failing tests**

```js
// #4303: `||`, `&&`, `|` and `;` inside `(( ))` or `$(( ))` are arithmetic, so nothing cuts there
// and the `>` stays a comparison. bash 3.2 and 5 write no file for either.
for (const cmd of ['(( a>1 || b>2 ))', 'echo $(( a>1 || b>2 ))', '(( a>1 && b>2 )) && cp a /main/f.js', 'x=$(( a>1 | b>2 ))']) {
  test(`AC2.1 #4303: \`${cmd}\` resolves no comparison target`, () => {
    const files = fileWriteTargets(cmd, '/r').map((t) => t.file);
    assert.ok(!files.includes(path.resolve('/r/1')) && !files.includes(path.resolve('/r/2')), JSON.stringify(files));
  });
}
test('#4303: a write after an arithmetic command is still read', () => {
  assert.deepStrictEqual(fileWriteTargets('(( a>1 && b>2 )) && cp a /main/f.js', '/r'), [{ action: 'copy', file: MAIN_F }]);
});
// `$((true); …)` is a `$(` holding a subshell, not arithmetic: bash 3.2 and 5 write M/f.
test('#4303: a $(( that is a substitution holding a subshell still cuts its commands', () => {
  assert.ok(fileWriteTargets('x=$((true); cd /main; cp a f.js)', '/r').some((t) => t.file === MAIN_F));
});
```

The existing `((cd x && ls) | cat)` and multi-line `((`/`$((` pins (the `#4149: ... reports the write` table) must stay green.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern="AC2.1 #4303" tests/hooks-gate-coverage.test.js`
Expected: FAIL after Step 1 (spurious `/r/1` and `/r/2` today). The other two Task 5 tests pass today and must stay green.

- [ ] **Step 3: Implement** — in `segmentSpansWith`, an unquoted `$((` or a `((` at a word start is consumed whole up to its closing `))`, across lines and skipping quoted spans (like the existing double-quoted span), only when it is arithmetic: the `(` after its first `(` matches a `)` directly followed by `)`. That is the test `groupEventsWith` already applies via `parenMatches`. Anything else, `$((true); …)` included, is cut as before.

- [ ] **Step 4: Run the four scanner suites** — PASS.

- [ ] **Step 5: Commit** — `Keep (( )) and $(( )) whole when splitting segments — a || inside arithmetic is no separator (refs #4303)`

---

### Task 6: `&&`, `||` and pipelines decide which cwd a `cd` leaves (U1)

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`walkShellChunk`: per-span cwd bookkeeping for the outer walk and the sub run; the doc comment above `CWD_SET_CAP`)
- Test: `tests/hooks-gate-coverage.test.js`; update existing pins whose verdict changes (listed in Step 4)
- Consumers of the wider cwd set (run their suites in Step 4):
  - pre-tool-use's worktree-always and E1 checks, and the shadow guard (list-all; fail-closed widening is intended): `tests/hooks-pre-tool-use.test.js`, `tests/hooks-pipeline-shadow-guard.test.js`
  - `teardownTargets` (list-all, fail closed): `tests/teardown-gate.test.js`
  - `bash-prefilter.js`'s `hasFileRedirection` (pick-one boolean, unaffected): `tests/hooks-bash-prefilter.test.js`
  - `post-tool-use.js`'s commit breadcrumbs and closing-keyword check (`gitTargets(command, ctx.cwd)`, list-all; a widened dir logs that dir's HEAD as a commit): `tests/hooks-post-tool-use-commit-dedup.test.js`, `tests/hooks-post-tool-use-closing-keyword.test.js`

**Interfaces:**
- Consumes: Task 5's spans (a separator inside arithmetic no longer reaches this logic).
- Produces: nothing exported.

**Rules.** An and-or list carries two sets besides `cur`: `skipOk`, the cwds where the list may already have succeeded and be skipping ahead, and `skipFail`, the same for failure. Both start empty. `spanStart` is the set of cwds the span runs under. When the span closes a group, `spanStart` is joined with that group's `saved`. After each span:

- `ok = joinCwds(cur, skipOk)`
- `fail = joinCwds(spanStart, skipFail)`

Then, by the separator at the span's end (`outer[span.end]` and the character after it):

| Separator | Effect |
|---|---|
| `&&` | the next span runs under `ok`; `skipFail = fail`, `skipOk = []` |
| `\|\|` | the next span runs under `fail` (a failed cd leaves the cwd); `skipOk = ok`, `skipFail = []` |
| `\|` | a pipeline element runs in a subshell: the next element runs under the pipeline's first `spanStart`, and no and-or bookkeeping happens until the pipeline ends; at its end `cur = ` that first `spanStart` and the pipeline counts as one span |
| `;`, newline, end | `cur = joinCwds(ok, fail)`; `skipOk = skipFail = []` |
| lone `&` (bg event) | `skipOk = skipFail = []` (the list ran in the background; `cur = listStart` as today) |

A group open saves the and-or state on its frame and clears it; its close restores the outer state. The sub run (`subCur`) keeps its own and-or state. A separator belongs to the substitution when `g.nesting > 0` at the span's end, never by whether `subCur` is set: an outer piece before the separator resets `subCur` to null. A substitution's separators never touch the outer list's state, so `cd /main && echo $(true; cd /tmp; true) > f.js` keeps writing only `/main/f.js`.

Bash 3.2 and 5 agree on every verdict below (`scratchpad/flow4303/probe-bash.js`, `probe-bash2.js`).

- [ ] **Step 1: Write the failing tests**

```js
// #4303: `&&` and `||` make a cd's effect depend on whether it succeeds, and a pipeline element
// runs in a subshell. Each verdict is bash 3.2 and 5 (M = /main, T = /tmp, start = /r).
{
  const here = path.resolve('/r/f.js');
  const files = (cmd) => fileWriteTargets(cmd, '/r').map((t) => t.file).sort();
  for (const [cmd, mustHold] of [
    ['cd /main || cd /tmp; echo x > f.js', [MAIN_F]],              // bash: M/f
    ['cd /nope && cd /tmp; echo x > f.js', [here]],                 // bash: ./f
    ['cd /main || cd /tmp && echo x > f.js', [MAIN_F]],             // bash: M/f
    ['cd /nope && true || echo x > f.js', [here]],                  // bash: ./f
    ['cd /nope && cd /tmp || echo x > f.js', [here]],               // bash: ./f
    ['true | cd /main; echo x > f.js', [here]],                     // bash: ./f
    ['{ cd /main; } | cat; echo x > f.js', [here]],                 // bash: ./f
  ]) {
    test(`#4303 and-or: \`${cmd}\` keeps the cwd bash may write from`, () => {
      for (const f of mustHold) assert.ok(files(cmd).includes(f), JSON.stringify(files(cmd)));
    });
  }
  test('#4303 and-or: a pipeline element\'s cd never reaches the next list', () => {
    assert.deepStrictEqual(files('cd /main | true; echo x > f.js'), [here]);
  });
  test('#4303 and-or: the command after cd && runs only where the cd went', () => {
    assert.deepStrictEqual(files('cd /main && cp a f.js'), [MAIN_F]);
  });
  test('#4303 and-or: the command after cd || runs only where a failed cd left it', () => {
    assert.deepStrictEqual(files('cd /main || cp a f.js'), [here]);
  });
  test('#4303 and-or: a substitution\'s separators leave the outer list alone', () => {
    assert.deepStrictEqual(files('cd /main && echo $(true; cd /tmp; true) > f.js'), [MAIN_F]);
  });
  // Deliberate fail-closed tradeoff: after the list ends, a failed cd would have left the start
  // cwd, so a later write resolves under both.
  test('#4303 and-or: after `cd X && cmd;` a later write resolves under X and the start cwd (deliberate fail-closed tradeoff)', () => {
    assert.deepStrictEqual(files('cd /main && true; cp a f.js'), [MAIN_F, here].sort());
  });
  test('#4303 and-or: gitTargets follows the same rules', () => {
    assert.ok(gitTargets('cd /main || cd /tmp; git commit -m x', '/r').some((t) => t.dir === path.resolve('/main')));
    assert.deepStrictEqual(gitTargets('cd /main && git commit -m x', '/r').map((t) => t.dir), [path.resolve('/main')]);
  });
}
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern="#4303 and-or" tests/hooks-gate-coverage.test.js`
Expected: FAIL after Step 1. Five pins pass today and must stay green: the `{ cd /main; } | cat` row (today `/main/f.js`, `/r/f.js`), `cd /main && cp a f.js`, the substitution row, and both `gitTargets` assertions.

- [ ] **Step 3: Implement** the rules above in `walkShellChunk`. Update the doc comment's description of the walk, and the group-cd comment in the test file, to state the and-or and pipeline rules.

- [ ] **Step 4: Run the four scanner suites and the consumer suites, then update the pins whose verdict changed.** Run `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js tests/hooks-pre-tool-use.test.js tests/hooks-pipeline-shadow-guard.test.js tests/hooks-post-tool-use-commit-dedup.test.js tests/hooks-post-tool-use-closing-keyword.test.js`. These pins now also report the start cwd: `tests/hooks-gate-coverage.test.js` lines 1179, 1180, 1204, 1206, 1216, 1220-1224, 1227 and 1228, and `tests/hooks-git-command.test.js` lines 651 and 653. Re-find them with `grep -nE "cd [^'\"\`]*(&&|\|\|)[^'\"\`]*(; |\\\\n)" tests/` after any earlier task shifts lines. Two pins must NOT change, because their `;` is inside the `$( )`: gate-coverage line 1264 and git-command line 667. For each pin that changes, confirm with the oracle that a failed cd would write there, keep its `MAIN_F` assertion, and widen the expectation to the new set. Never delete a pin, and list every changed pin in the commit body. A pin that moves in a way bash does not support is a bug in Step 3, not a pin to update. If a post-tool-use suite goes red because a widened dir logs a breadcrumb, keep the walk's rule. Capture a follow-up with `/claude-tweaks:capture` (spec-shaped body, `Defer-reason: tangential`) so that post-tool-use logs a commit breadcrumb only for a dir whose HEAD moved. Report it as a follow-up. Do not narrow the walk for that one consumer.

- [ ] **Step 5: Commit** — `Model && / || and pipeline subshells in the cd walk — a conditional or piped cd keeps every cwd bash may leave (refs #4303)`

---

### Task 7: The cwd cap keeps the triggering group's cwd (S50)

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`joinCwds`, the comment above `CWD_SET_CAP`)
- Test: `tests/hooks-gate-coverage.test.js` (the `#4149 cwd cap` block)

**Interfaces:**
- Produces: past the cap, `joinCwds(a, b, overflow)` returns `[...o, ...b.filter((c) => !o.includes(c) && !a.includes(c))]` with `o = overflow()`, so the cwds the triggering step adds are kept. It returns `o` alone when that list is longer than `CWD_SET_CAP + 2`, so a set never exceeds `CWD_SET_CAP + 2`. Keeping all of `b` is unbounded: one relative-cd tail after the collapse gives 20 cwds, and 200 tails give 418 (`scratchpad/flow4303/checks/t7-bound.js`).

- [ ] **Step 1: Write the failing tests** (inside the `#4149 cwd cap` block, reusing `distinct` and `opts`)

```js
// #4303 (S50): the group whose `}` overflows the cap keeps its own cwd. With a sibling-layout
// worktree, bash 3.2 and 5 write M/s0/f.js for `cp a ../f.js` after `{ cd M/s0/deep; }`.
test('#4303 cwd cap: the group that overflows the cap keeps its own cwd', () => {
  const cmd = distinct((i) => `{ cd /a${i}; }; `, 15) + '{ cd /main/s0/deep; }; cp a ../f.js';
  const files = fileWriteTargets(cmd, '/r', opts).map((t) => t.file);
  assert.ok(files.includes(path.resolve('/main/s0/f.js')), JSON.stringify(files));
});
test('#4303 cwd cap: a set past the cap holds at most CWD_SET_CAP + 2 cwds', () => {
  // The handler's fourth argument is true on every visit of a piece after the first, so the run
  // length of visits is the piece's cwd count.
  let most = 0;
  let n = 0;
  forEachShellSegment(distinct((i) => `{ cd /a${i}; }; `, 40) + 'true', '/r', (t, cwd, q, repeat) => {
    n = repeat ? n + 1 : 1;
    most = Math.max(most, n);
  }, opts);
  assert.ok(most <= 18, `${most} cwds`);
});
test('#4303 cwd cap: relative-cd tails after the collapse stay within CWD_SET_CAP + 2 cwds', () => {
  let most = 0;
  let n = 0;
  const cmd = distinct((i) => `{ cd /a${i}; }; `, 15) + '{ cd s; }; ' + 'echo $(true; true) cd t; '.repeat(200) + 'true';
  forEachShellSegment(cmd, '/r', (t, cwd, q, repeat) => {
    n = repeat ? n + 1 : 1;
    most = Math.max(most, n);
  }, opts);
  assert.ok(most <= 18, `${most} cwds`);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern="#4303 cwd cap" tests/hooks-gate-coverage.test.js`
Expected: FAIL after Step 1, for the overflowing-group test. Both bound tests pass today and must stay green after Step 3; the relative-tail one is what catches an unbounded `joinCwds`.

- [ ] **Step 3: Implement** the Interfaces line; update the comment above `CWD_SET_CAP` ("collapses … to the overflow cwd, the walk's own starting cwd, and the cwds of the step that overflowed").

- [ ] **Step 4: Run the four scanner suites and `node --test perf/heredoc-scan-linearity.test.js`** — PASS. The existing cap assertions (`files.length <= 9`, the visit bounds, push/mkdir, no-overflowCwd) hold under the new rule unchanged.

- [ ] **Step 5: Commit** — `Keep the overflowing step's cwds when the cwd set collapses — the triggering group's cd stays visible (refs #4303)`

---

### Task 8: The heredoc nesting cap and effective bounds (U13, U9)

**Files:**
- Test: `tests/hooks-gate-coverage.test.js` (the two `{ timeout: 10000 }` tests near the `#4149 nesting` block, and a new nesting-cap test after the `#3989` heredoc tests)

**Interfaces:**
- Produces (test file only): `boundedTargets(fn: 'fileWriteTargets'|'gitTargets', command: string, cwd: string, opts?: object) -> Array` — runs the call in a child `node` via `child_process.spawnSync(process.execPath, ['-e', script, ...args], { timeout: 10000, encoding: 'utf8' })`, asserts the child was not killed (`r.signal === null`, `r.status === 0`) and returns the parsed JSON stdout.

- [ ] **Step 1: Write the tests**

```js
// #4303 (U13): heredoc bodies are planned to MAX_HEREDOC_NESTING (8) levels; deeper, a body is
// walked whole, so a data body there stays visible (fail closed). One level less still strips.
{
  const nest = (levels, inner) => {
    let s = inner;
    for (let k = levels; k >= 1; k -= 1) s = `bash <<'E${k}'\n${s}\nE${k}`;
    return s;
  };
  const dataBody = "cat <<'X'\necho x > /main/f.js\nX";
  test('#4303: a data body below the heredoc nesting cap is stripped', () => {
    assert.deepStrictEqual(fileWriteTargets(nest(7, dataBody), '/r'), []);
  });
  test('#4303: a data body past the heredoc nesting cap stays visible (deliberate fail-closed tradeoff)', () => {
    assert.deepStrictEqual(fileWriteTargets(nest(8, dataBody), '/r'), [{ action: 'write', file: MAIN_F }]);
  });
}
```

`nest(7)` strips and `nest(8)` stays visible today (checked by `scratchpad/flow4303/checks/`).

Replace the bodies of `'#4149 nesting: a nest of unclosed "$( stays bounded'` and `'#4149 nesting: a closed nest deeper than the cap takes the plain quote reading'` with `boundedTargets('fileWriteTargets', …)` and drop their `{ timeout: 10000 }` option.

- [ ] **Step 2: Run the tests to verify they pass**

Run: `node --test tests/hooks-gate-coverage.test.js`
Expected: PASS (test-only task: both nesting-cap pins describe current behavior). Then prove each bound: in a scratch copy, make the nesting cap check `depth < 100` and see the past-cap test fail; make `NEST_LEVEL_CAP` `Infinity` and see `boundedTargets` fail by timeout instead of hanging (record both outputs for the commit body).

- [ ] **Step 3: Commit** — `Pin the heredoc nesting cap and bound the cap tests in a child process — a cap regression fails instead of hanging (refs #4303)`

---

### Task 9: Differential, base comparison, mutants, e2e

**Files:**
- Create (scratchpad only): `scratchpad/flow4303/oracle.js`, `scratchpad/flow4303/base-compare.js`, `scratchpad/flow4303/mutants.js`
- Test: `tests/hooks-gate-coverage.test.js` (one e2e test)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (any remaining verdict change: the and-or/pipeline rule and the arithmetic `&` in the paragraph that describes the walk)

- [ ] **Step 1: Write the e2e test (AC1.1)**, titled `AC1.1 e2e #4303: every #4303 shape from a linked worktree into the main checkout is DENIED` — modelled on `'e2e #4149: a command past the cwd cap from a linked worktree is DENIED …'` (same repo + linked-worktree setup, `decisionFor` from the worktree), assert `'deny'` for one shape per fix with the main checkout's absolute path substituted for M: U1 `cd ${main} || cd /tmp; echo x > f.js`, U2 `x=$(cd /tmp) cd ${main}; cp a f.js`, U3 `cp -rt ${main} a`, U4 `perl -0pi -e 's/a/b/' ${main}/f.js`, U6 `echo x >& ${main}/f.js`, S49 `x=$(true; cd ${main} && y=$(( (1 & 3) )) && git commit -am x)`, S50 (15 groups then `{ cd ${main}/s0/deep; }; cp a ../f.js`). Assert not-deny for `cd ${wt} && cp a f.js` from the worktree. Assert not-deny for `(( a>1 || b>2 ))` with the main checkout as the session cwd: it is denied today as `main/1` and `main/2`, and from the worktree it is already allowed.

- [ ] **Step 2: Run the e2e test**

Run: `node --test --test-name-pattern="AC1.1 e2e #4303" tests/hooks-gate-coverage.test.js`
Expected: PASS (Tasks 1-8 are in place).

- [ ] **Step 3: Verify with the oracle differential** — `oracle.js` runs every case added in Tasks 1-8 plus a generated set (an alphabet of `cd M`, `cd T`, `&&`, `||`, `|`, `;`, `&`, `$(`, backticks, `$(( ))`, `$[ ]`, groups, `>`/`>&`, `cp -t`, `perl -0pi`) under `/bin/bash` and `/opt/homebrew/bin/bash` in a scratch tree (logging `git` stub first on `PATH`, GNU coreutils second), and compares what each shell wrote with `fileWriteTargets`/`gitTargets`. Expected: no shell write the scanner misses. Each spurious target must be one of the stated fail-closed tradeoffs. Turn every new divergence into a pinned case before moving on.

- [ ] **Step 4: Verify the base comparison (AC3.1)** — `git -C <worktree> worktree add --detach <scratch>/base d9aa6b82d`, then `base-compare.js` loads both copies of `git-command.js` and diffs `fileWriteTargets(cmd, '/r')` over the `#4149 routine` table, the #4210 cases, and every existing pin's command. Expected: no shape moves from target-free to denied-from-a-worktree other than the listed ones; every change is a superset that adds the start cwd (Task 6) or a listed fix.

- [ ] **Step 5: Verify every new rule has a red-turning mutant (AC4.1)** — `mutants.js` applies one mutant at a time to a copy in a scratch worktree and runs the four suites there: drop the csh `>&` branch; revert `readShortCluster` to standalone `-t`; revert the in-place cluster walk; revert `assignmentWordEnd` to the regex loop; make the `&` branch ignore `cmd`; drop the `$[` frame; drop the arithmetic consume in `segmentSpansWith`; each Task 6 rule separately (the `&&` row, the `||` row, the pipeline row, the list-end join, the background reset, the group save/restore, and the `g.nesting > 0` ownership test); revert `joinCwds`; drop `|| span.sub` in the background route (S51). Expected: every mutant turns at least one test red. A surviving mutant gets a discriminating case, or the rule is removed as dead.

- [ ] **Step 6: Full verification (AC5.1)** — the four scanner suites, `node --test perf/heredoc-scan-linearity.test.js`, and `npm test` redirected to a file in the scratchpad (`npm test > <scratchpad>/flow4303/npm-test.txt 2>&1`), reading the totals from the file. Expected: 0 fail.

- [ ] **Step 7: Commit** — `Pin the #4303 shapes end to end from a linked worktree — every fail-open is denied, arithmetic stays target-free (refs #4303)`
