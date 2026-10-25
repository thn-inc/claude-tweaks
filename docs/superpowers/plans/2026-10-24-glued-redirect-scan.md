# Glued-Redirect Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `worktree-always` redirect scan resolve a redirect glued to a preceding unquoted word (`echo foo>x`) as a write target, without reading quoted `>` text as one.

**Architecture:** `tokenize` gains a `doubleQuoted` flag array beside `singleQuoted`. `forEachCommandSegment` passes a third handler argument, `quoting = { raw, singleQuoted, doubleQuoted }`. `redirectWriteTargets` takes it as an optional third parameter. When a token matches no start-anchored operator, the token was built from bare text with no quoted span, and its raw (pre-substitution) text has no quote, backslash, `$` or backtick before the first `>`, a new `GLUED_REDIRECT_RE` extracts the operator and target. `bash-prefilter.js`'s `hasFileRedirection` forwards the same `quoting` argument, so the prefilter and the parser stay in step.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T200414-record-4015/work/4015-spec.md`

Scope keywords: redirectWriteTargets, hasFileRedirection, forEachCommandSegment

## Global Constraints

- Ambiguity resolves to "no target" (allow). Never fabricate a target the text cannot prove (the module's own posture, `git-command.js`'s redirection comment block).
- `bash-prefilter.js` stays dependency-light: no new `require`.
- Every existing caller of `forEachCommandSegment` keeps working unchanged. Those callers are `gitTargets`, `resolvedGitSegments`, `mkdirTargets`, `powershellOpaqueCommand`'s walk, `pre-tool-use.js:501`, and `tests/hooks-git-command.test.js:561`. All of them read only `(t, effCwd)`, so a third argument is ignored.
- `npm run test:perf` still passes.
- Plan-audit Check B's keyword sweep also matched `docs/hooks.md`, `pre-tool-use.js`, `tests/hooks-git-command.test.js`, `tests/teardown-gate.test.js`, two journeys, and the #3989 plan. None of them needs an edit. They are `forEachCommandSegment` consumers that ignore the new third argument, or prose describing the scan without naming the glued-target shapes; the one prose site that does name them is `policy-schema-coverage.md`.

## Review Focus

1. A `>` produced by variable expansion (`V="a>b"; echo $V`). Bash never re-parses an expansion result, so this must resolve no target. The task's quoted/escaped test pins it.
2. A backslash-escaped `>` (`echo foo\>x`) and a quote inside a bare word (`echo foo">"x`). Both are literal in bash and must resolve no target. Pinned in the same test.
3. Glued fd duplication and sinks (`echo foo>&2`, `echo foo>/dev/null`). These must resolve no target, while a digit-ending word (`echo foo2>x`) is not an fd prefix and must resolve `x`. Both directions are pinned.
4. The glued operator variants (`>>`, `>|`, `&>`) and a glued operator whose target is the next token (`echo foo> x`). Each must resolve exactly one target. Pinned in the positive test.
5. A quoted `>` inside a git commit message (`git commit -m "a>b"`), the everyday shape that would make a false positive hurt. It must resolve no target. Pinned in the quoted test.

Not covered, by design: a glued redirect inside an assignment-only segment (`X=1>f`). `updateAssignment` consumes that one-token segment before any scan; this predates the change.

---

### Task 1: Glued-word redirect resolution in the parser and the prefilter

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`tokenize` ~92-111, `forEachCommandSegment` ~238-263, redirect operator block ~538-550, `redirectWriteTargets` ~820-834)
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js` (`hasFileRedirection` ~61-76)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (the "Bare shell redirection is covered (#3080)" paragraph, line 27: 22438 bytes against a 52500-byte rail, so there is headroom)
- Test: `tests/hooks-gate-coverage.test.js` (after the `#3080: a \`>\` inside a quoted string` test, ~line 360)
- Test: `tests/hooks-bash-prefilter.test.js` (`DIFFERENTIAL_CORPUS` ~line 37, the `hasFileRedirection` detect/skip lists ~132-144)

**Interfaces:**
- Produces: `tokenize(seg) -> { tokens: string[], singleQuoted: boolean[], doubleQuoted: boolean[] }`. `doubleQuoted[i]` is true when any part of `tokens[i]` came from a double-quoted span, mirroring `singleQuoted`'s merge rule.
- Produces: `forEachCommandSegment(command, cwd, handler)` calls `handler(t, effCwd, quoting)`, where `quoting = { raw: string[], singleQuoted: boolean[], doubleQuoted: boolean[] }` and `raw` is the pre-substitution token list.
- Produces: `redirectWriteTargets(t, effCwd, quoting?) -> string[]`. With `quoting` absent, behavior is exactly today's (start-anchored only).
- Consumer classification: `fileWriteTargets` and `hasFileRedirection` are the only callers of `redirectWriteTargets`. Both must forward `quoting`, and both list every target. Every other `forEachCommandSegment` consumer ignores the new argument.

- [ ] **Step 1: Write the failing tests**

In `tests/hooks-gate-coverage.test.js`:

```js
// #4015: bash ends a word at an unquoted `>`, so a redirect glued to a
// preceding word writes its target just like a spaced one.
test('AC1.1 AC2.1 #4015: a redirect glued to a preceding unquoted word resolves its target', () => {
  for (const [command, file] of [
    ['echo foo>x', 'x'], ['cat a.txt>b.txt', 'b.txt'], ['echo foo>>x', 'x'], ['echo foo>|x', 'x'],
    ['echo foo&>x', 'x'], ['echo foo2>x', 'x'], ['echo foo> x', 'x'], ['WT=/w; echo foo>$WT/x', '/w/x'],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', file) }], command);
  }
});

test('AC1.2 AC2.1 #4015: a `>` that is quoted, escaped, expanded, an fd dup, a sink, or in a heredoc body resolves no target', () => {
  for (const command of [
    'echo "foo>x"', "echo 'foo>x'", 'echo foo\\>x', 'echo foo">"x', 'node -e "x>y"', 'git commit -m "a>b"',
    'V="a>b"; echo $V', 'echo foo>&2', 'echo foo>/dev/null', 'node x.js <<EOF\nif (a>0) b();\nEOF',
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
});
```

In `tests/hooks-bash-prefilter.test.js`:
- append `'echo foo>tracked.js'` to `DIFFERENTIAL_CORPUS`, after `'echo x > tracked.js'`, with a `// #4015: a redirect glued to a word.` comment
- add `'echo foo>out.js'` and `'cat a.txt>b.txt'` to the `hasFileRedirection detects` list
- add `'echo "foo>x"'` and `"echo 'foo>x'"` to the `does not trigger on` list
- add:

```js
test('AC3.1 #4015: the differential corpus lists the glued shape, and it takes the full-handler path', () => {
  assert.ok(DIFFERENTIAL_CORPUS.includes('echo foo>tracked.js'));
  assert.strictEqual(shouldRunFull('pre-tool-use', bash('echo foo>tracked.js')), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js`
Expected: FAIL. `AC1.1 AC2.1 #4015` fails with an empty target array for `echo foo>x`. `AC3.1 #4015`, the corpus "produces at least one guard-parser target" sanity test, and the `hasFileRedirection detects: echo foo>out.js` case also fail. The AC1.2 test passes, because it is a guard against the fix over-reaching.

- [ ] **Step 3: Implement**

- `tokenize`: track `isDQ = m[1] !== undefined` alongside `isSQ`, with the same merge rule, and return `doubleQuoted`. Update its header comment to name both flags.
- `forEachCommandSegment`: destructure `doubleQuoted` from `tokenize`, and call `handler(t, effCwd, { raw: rawT, singleQuoted, doubleQuoted })`.
- Beside `REDIRECT_OP_RE`, add `const GLUED_REDIRECT_RE = /^[^"'\\$\`>]+(>>|>\||>)(.*)$/;` with a comment. The comment says that bash ends a word at an unquoted `>`. It also says why the prefix excludes quotes, backslash, `$` and backtick: each can make the `>` literal or put it inside an expansion, and ambiguity resolves to no target.
- `redirectWriteTargets(t, effCwd, quoting)`: when `matchRedirectOperator(t[i])` is `null`, and `quoting` is given, and `!quoting.singleQuoted[i] && !quoting.doubleQuoted[i]`, and `GLUED_REDIRECT_RE.test(quoting.raw[i])`, take `rawTarget` from `GLUED_REDIRECT_RE.exec(t[i])[2]`. Everything after that stays as today: `''` consumes the next token, then the fd-dup/`(`/`resolveWriteTarget` exclusions. Testing `raw` while reading `t` means a `$NAME` substituted before the `>` can never fabricate an operator, and a substitution after it (the target) still resolves.
- `fileWriteTargets`: the handler takes `(t, effCwd, quoting)` and passes `quoting` to `redirectWriteTargets`.
- `bash-prefilter.js` `hasFileRedirection`: the handler takes `(t, _cwd, quoting)` and calls `redirectWriteTargets(t, '.', quoting)`. Extend the `#3080` comment by one sentence: the glued-word shape (#4015) is reached because the quoting flags are forwarded.
- `policy-schema-coverage.md` line 27: replace "standalone (`cmd > f`) or glued (`cmd >f`)" with "standalone (`cmd > f`), glued to its target (`cmd >f`), or glued to a preceding unquoted word (`echo foo>x`, #4015 — not when that word is quoted or carries a backslash, `$`, or backtick before the `>`)".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js tests/hooks-git-command.test.js`
Expected: PASS, 0 failures.

Then revert only the `redirectWriteTargets` glued branch (keep the tests), re-run, and confirm that `AC1.1 AC2.1 #4015` and `AC3.1 #4015` go red. Restore the branch. This is AC2.1's "goes red when the change is reverted"; quote the red output in the report.

Run: `npm run test:perf`
Expected: PASS (AC3.1).

- [ ] **Step 5: Commit**

```bash
git -C "$WORKTREE" add plugin/bin/lib/hooks/git-command.js plugin/bin/lib/hooks/bash-prefilter.js plugin/skills/_shared/policy-schema-coverage.md tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js
git -C "$WORKTREE" commit -m "Resolve a redirect glued to a word in the worktree-always scan — tokenize carries a double-quoted flag (refs #4015)"
```
