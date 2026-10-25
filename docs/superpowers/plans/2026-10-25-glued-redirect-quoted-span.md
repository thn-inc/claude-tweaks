# Glued Redirect After a Quoted Span or Subshell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `worktree-always` redirect scan resolve a redirect glued to a word that holds a quoted span (`echo "hi">x`) or is a one-word subshell/substitution (`(ls)>out`), while every quoted `>` stays literal.

**Architecture:** `tokenize` (`plugin/bin/lib/hooks/git-command.js`) gains a per-token character mask, `spanKinds`, saying which characters of each merged token came from a bare, escaped, single-quoted, double-quoted or stray (unterminated) span. Its bare-word alternative stops at a quote character (and is backslash-aware), and its double-quote alternative becomes backslash-aware, so a word like `foo>"x y"` is one token, matching bash and `splitSegments`. `redirectWriteTargets` replaces `GLUED_REDIRECT_RE` with a mask-driven scan: the operator must be a bare `>`, and the text before it must be quoted spans plus plain bare text, or exactly one balanced one-word group (`(ls)`, `$(date)`, `<(b)`). `bash-prefilter.js`'s `hasFileRedirection` already calls the same `redirectWriteTargets` with the same `quoting` object, so it follows automatically. Its comment, the prefilter corpus and the docs are updated.

**Tech Stack:** Node 18+ CommonJS, `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-10-25T090732-record-4210/work/4210-spec.md` (record #4210)

## Global Constraints

- `bash-prefilter.js` stays dependency-light: no new `require` in it or in `git-command.js` (both require only `fs`/`path`/each other today).
- Ambiguity resolves to **no target** (allow). When the scan cannot prove a `>` is a bare redirect operator, it returns nothing. It never guesses.
- `tokenize`'s existing return fields `tokens`, `singleQuoted`, `doubleQuoted` keep their meaning: `singleQuoted[i]` is true when any span of `tokens[i]` was single-quoted, and `doubleQuoted[i]` the same for double quotes. `substituteVars` still reads `singleQuoted`.
- Tests: `node --test`. Test names cite the spec's AC clause ids (`AC1.1`, `AC1.2`, `AC2.1`, `AC3.1`) plus `#4210`.
- Commits: `{Verb} {what} — {detail} (refs #4210)`, never `closes`/`fixes`. End each message with the line `Claude-Session: https://claude.ai/code/session_011PxqhDJqgUgFWvEZmruaq3`.
- Out of scope, report but do not fix: `echo ">x"` resolving `x` today (the start-anchored scan ignores quoting), and `if (( x>y )); then` resolving `y` (`compoundBodyEnd` only skips a `((` in the first token). Both fail closed and predate this record.

## Review Focus

1. **An escaped quote inside double quotes** (`echo "a\">x"`): bash reads one double-quoted word `a">x`, so there is no redirect. The backslash-aware double-quote alternative is what keeps that `>` quoted. Pinned in Task 1.
2. **An unterminated quote** (`echo "hi>x`): no closing quote, so the scan must resolve nothing rather than a junk target. A stray span in the prefix rejects it. Pinned in Task 1.
3. **Other parsers see the tokenizer change.** A mid-word quote now merges the way bash does: `cd foo"bar"` is `cd foobar`, where today the `"` stayed in the token and poisoned the cwd. Pinned in Task 1 (`cd foo"bar"; echo x > a` → `/r/foobar/a`). The full `tests/hooks-*.test.js` set is the regression net.
4. **A `$VAR` target after a quoted prefix** (`WT=/w; echo "hi">$WT/x`): the target is read from the post-substitution token. Pinned in Task 1.
5. **Prefilter/parser agreement** on the new shapes. `hasFileRedirection` must take the full path for `echo "hi">x` and `(ls)>out`, and skip for `echo foo">"x` and `((i>0))`. Pinned in Task 3.

---

### Task 1: Span mask in `tokenize`; glued scan on bare spans after a quoted span

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`tokenize` at ~77-117; `forEachCommandSegment`'s handler call at ~268 and its comment at ~234-244; remove `GLUED_REDIRECT_RE` at ~555-562; `redirectWriteTargets` and its comment at ~850-878)
- Test: `tests/hooks-gate-coverage.test.js` (add after the `AC1.2 AC2.1 #4015` test, ~line 385)

**Interfaces:**
- Produces: `tokenize(seg)` returns `{ tokens, singleQuoted, doubleQuoted, spanKinds }`. `spanKinds[i]` is a string exactly as long as `tokens[i]`, one character per character of the token: `b` bare, `e` backslash-escaped (both the `\` and the character it escapes, in a bare span), `s` single-quoted, `d` double-quoted, `x` stray (an unterminated quote character or a lone trailing backslash). Quote delimiters are not part of `tokens[i]`, so they have no mask character.
- Produces: the handler's `quoting` argument becomes `{ raw, singleQuoted, doubleQuoted, spanKinds }`. `redirectWriteTargets(t, effCwd, quoting)` runs the glued scan only when `quoting.spanKinds` is present. Without it the scan is start-anchored only, as today.
- Produces (Task 2 extends it): an internal `gluedRedirectOpEnd(raw, kinds)` returns the index just past the glued operator in `raw`, or `null`.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-gate-coverage.test.js`

```js
// #4210: the word before a glued `>` may hold a quoted span — only the `>`
// itself has to be bare. A `>` inside any quote, or escaped, stays literal.
test('AC1.1 #4210: a redirect glued to a word that holds a quoted span resolves its target', () => {
  for (const [command, file] of [
    ['echo "hi">x', 'x'], ['printf "%s\\n" "$v">out.txt', 'out.txt'], ['echo foo>"x y"', 'x y'],
    ["echo 'hi'>>x", 'x'], ['echo "hi">\'x\'', 'x'], ['echo "hi"> x', 'x'], ['WT=/w; echo "hi">$WT/x', '/w/x'],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', file) }], command);
  }
});

test('AC1.1 #4210: a quoted, escaped, or unterminated `>` beside a bare span resolves no target', () => {
  for (const command of [
    'echo "foo>x"', "echo 'foo>x'", 'echo foo">"x', 'node -e "x>y"',
    'echo "a\\">x"', 'echo "hi"\\>x', 'echo "hi>x', 'echo "hi">x"',
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
});

test('#4210: a mid-word quote merges the way bash does, so `cd foo"bar"` changes into foobar', () => {
  assert.deepStrictEqual(fileWriteTargets('cd foo"bar"; echo x > a', '/r'), [{ action: 'write', file: path.resolve('/r', 'foobar', 'a') }]);
});
```

(`echo "hi">x"` ends with a stray `"`, so its target `x"` is unresolvable and drops out. That keeps it in the no-target list.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="#4210" tests/hooks-gate-coverage.test.js`
Expected: FAIL. The first test fails on `echo "hi">x` (actual `[]`) and the third on `cd foo"bar"` (actual `[]`).

- [ ] **Step 3: Implement the mask in `tokenize`**

Replace the token regex with this one (the alternative order matters):

```js
const re = /"((?:[^"\\]|\\[\s\S])*)"|'([^']*)'|((?:\\[\s\S]|[^\s"'\\])+)|(\S)/g;
```

Group 1 is a double-quoted span. It is backslash-aware, like `splitSegments`: `\"` does not close it, and the value keeps its backslashes as typed. Group 2 is single-quoted. Group 3 is a bare run that stops at a quote and treats `\` plus the next character as one unit. Group 4 is a stray character: an unterminated `"`/`'`, or a lone trailing `\`. Merging adjacent matches (`m.index === prevEnd`) is unchanged. Build each match's mask alongside its value: `d`/`s` repeated for groups 1 and 2; for group 3, `e` for each `\` and the character after it and `b` for every other character; `x` for group 4. Append the mask on merge, exactly as the value is appended, and return `spanKinds` beside the existing arrays. Keep `isSQ`/`isDQ` from groups 2/1 as now. Update the comment above `tokenize` to describe `spanKinds` and the two alternative changes (quote-splitting bare runs, backslash-aware double quotes).

- [ ] **Step 4: Pass the mask through and rewrite the glued scan**

In `forEachCommandSegment`, destructure `spanKinds` and pass `{ raw: rawT, singleQuoted, doubleQuoted, spanKinds }`, then update the comment's description of `quoting`. Delete `GLUED_REDIRECT_RE` and its comment block. Add `gluedRedirectOpEnd(raw, kinds)` beside `matchRedirectOperator`:

- `k` = the first index where `raw[k] === '>'` and `kinds[k] === 'b'`. If there is none, or `k === 0` (the start-anchored scan's case), return `null`.
- Accept the prefix `raw.slice(0, k)` only when every index `j < k` is `s` or `d`, or is `b` with `raw[j]` not one of `` $ ` ( ``. Any `e` or `x` in the prefix, or a bare `$`, backtick or `(`, rejects it. (These are the same exclusions as the old regex, now applied to bare characters only. `)`, `&`, digits and `<` stay allowed, so `ls)>out.txt`, `foo&>x` and `foo2>x` keep resolving.)
- The operator is `>>` or `>|` when `raw[k + 1]` is `>` or `|` and `kinds[k + 1] === 'b'`. Otherwise it is `>`. Return `k + operatorLength`.

In `redirectWriteTargets`, replace the glued branch with: when `rawTarget === null && quoting && quoting.spanKinds`, compute `opEnd = gluedRedirectOpEnd(quoting.raw[i], quoting.spanKinds[i])`. When it is non-null, read the target from the post-substitution token `t[i]`. Let `raw = quoting.raw[i]`, `head = raw.slice(0, opEnd)` and `tail = raw.slice(opEnd)`. The target is `tail` when `t[i] === raw`, `t[i].slice(head.length)` when `t[i].startsWith(head)`, and `tail` when `t[i].endsWith(tail)`; otherwise there is no target. (`substituteVars` rewrites at most one `$` reference per token, so exactly one side changed.) The rest of the loop is unchanged: `''` consumes the next token, and the fd-dup, `(` and `resolveWriteTarget` exclusions still apply. Update the `Glued-word redirects (#4015)` comment above `redirectWriteTargets` to describe the mask rule and cite #4210.

- [ ] **Step 5: Run the tests to verify they pass, then the hook suites**

Run: `node --test --test-name-pattern="#4210" tests/hooks-gate-coverage.test.js`
Expected: PASS.

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/hooks-pre-tool-use.test.js tests/hooks-post-tool-use.test.js`
Expected: PASS, with 0 failures. Every existing `#4015`/`#3080`/`#3989` case still holds. If an existing test fails because of the tokenizer change, stop and report it with the failing assertion. Do not edit the existing test to fit.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js tests/hooks-gate-coverage.test.js
git commit -m "Resolve a glued redirect after a quoted span — tokenize records per-character span kinds, the glued scan needs only a bare \`>\` (refs #4210)"
```

### Task 2: A redirect after a balanced one-word group

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`gluedRedirectOpEnd` from Task 1)
- Test: `tests/hooks-gate-coverage.test.js` (after Task 1's tests)

**Interfaces:**
- Consumes: `gluedRedirectOpEnd(raw, kinds)` and the `spanKinds` mask from Task 1.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-gate-coverage.test.js` (append after Task 1's tests)

```js
// #4210: a one-word subshell, command substitution, or process substitution
// ends at its `)`, so a `>` right after it is a redirect. `((` is arithmetic.
test('AC2.1 #4210: a redirect after a balanced one-word subshell or substitution resolves its target', () => {
  for (const [command, file] of [
    ['(ls)>out', 'out'], ['(ls)>>out', 'out'], ['diff <(a) <(b)>out', 'out'], ['echo $(date)>x', 'x'],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', file) }], command);
  }
});

test('AC2.1 #4210: arithmetic and nested groups stay target-free', () => {
  for (const command of ['((i>0))', '(( x>y ))', '((i>0))>x', '(a(b))>x', '$((1))>x', '"a"(ls)>x']) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="AC2.1 #4210" tests/hooks-gate-coverage.test.js`
Expected: FAIL. The first test fails on `(ls)>out` (actual `[]`).

- [ ] **Step 3: Implement**

In `gluedRedirectOpEnd`, when the Task 1 prefix rule rejects the prefix, also accept it when every index `j < k` is `b` and the prefix matches `/^[$<]?\([^()\\$`<>"']*\)$/`. That is one group with no nesting and no `$`, backtick, backslash, `<`, `>` or quote inside. A `((` opener fails because its content would hold a `(`. Add one comment line above the regex naming the three shapes (`(ls)`, `$(date)`, `<(b)`). Extend the `redirectWriteTargets` comment's #4210 sentence to mention it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js`
Expected: PASS, with 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js tests/hooks-gate-coverage.test.js
git commit -m "Resolve a redirect after a one-word subshell or substitution — (ls)>out, \$(date)>x, <(b)>out; ((i>0)) stays arithmetic (refs #4210)"
```

### Task 3: Prefilter corpus and docs

**Files:**
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js` (the `hasFileRedirection` comment, lines 61-71: replace "The glued-word shape (`echo foo>x`, #4015) is reached because the handler's quoting flags are forwarded to redirectWriteTargets." with a sentence naming the glued shapes `echo foo>x` (#4015), `echo "hi">x` and `(ls)>out` (#4210), reached because the handler's `quoting` object, `spanKinds` included, is forwarded to redirectWriteTargets. No code change.)
- Modify: `tests/hooks-bash-prefilter.test.js` (`DIFFERENTIAL_CORPUS` ~line 39; the `hasFileRedirection detects` list ~135-136; the `does not trigger on` list ~142-143; a new AC3.1 test after the #4015 one ~152)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (line 27, inside the "Bare shell redirection is covered (#3080)" paragraph: 22,685 bytes against the 52,500-byte rail, so there is plenty of room)
- Modify: `docs/journeys/write-a-glued-redirect-from-the-main-checkout-4015.md` (steps 1-3 "Should understand", Origin)

**Interfaces:**
- Consumes: Task 1's and Task 2's resolved shapes.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-bash-prefilter.test.js`

Add `'echo "hi">tracked.js',` to `DIFFERENTIAL_CORPUS` under a `// #4210: a glued redirect after a quoted span.` comment. Add `'echo "hi">out.js'` and `'(ls)>out.js'` to the `hasFileRedirection detects` list. Add `'echo foo">"x'` and `'((i>0))'` to the `does not trigger on` list. Then add:

```js
test('AC3.1 #4210: the differential corpus lists the quoted-word shape, and it takes the full-handler path', () => {
  assert.ok(DIFFERENTIAL_CORPUS.includes('echo "hi">tracked.js'));
  assert.strictEqual(shouldRunFull('pre-tool-use', bash('echo "hi">tracked.js')), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="AC3.1 #4210" tests/hooks-bash-prefilter.test.js`
Expected: FAIL (the corpus does not list the shape yet). Once the corpus line exists, the test passes only with Tasks 1-2 in place.

- [ ] **Step 3: Update the prose**

`policy-schema-coverage.md` line 27. Replace this exact text:
`or glued to a preceding unquoted word (`echo foo>x`, #4015 — not when that word is quoted or carries a backslash, `$`, backtick, or `(` (arithmetic like `((i>0))`) before the `>`; and never inside a `[[ … ]]` or `(( … ))` body)`
with:
`or glued to a preceding word (`echo foo>x`, #4015) — including one that holds a quoted span (`echo "hi">x`, `echo foo>"x y"`) or is a one-word subshell, command substitution, or process substitution (`(ls)>out`, `$(date)>x`, `diff <(a) <(b)>out`, #4210). Only a `>` outside every quote counts, so `echo "foo>x"` and `echo foo">"x` stay literal, and not when the word's unquoted part carries a backslash, `$`, backtick, or `(` (arithmetic like `((i>0))`) before the `>`; and never inside a `[[ … ]]` or `(( … ))` body`

Journey file:
- Step 1, "Should understand": replace "(`GLUED_REDIRECT_RE`)" with "(`gluedRedirectOpEnd`, reading `tokenize`'s per-character `spanKinds` mask)". Add that the word may hold a quoted span (`echo "hi">x`) or be a one-word group (`(ls)>out`), since only the `>` itself has to be unquoted (#4210).
- Step 2, "Should understand": replace "only when the word before it holds no quote, backslash, `$`, backtick, or `(`" with "only when the `>` itself is outside every quote, and the unquoted part of the word before it holds no backslash, `$`, backtick, or `(`. The one exception is a single balanced group such as `(ls)` or `$(date)`". Add `echo foo">"x` to step 2's URL list.
- Step 3, "Should understand": replace the sentence "They are a glued redirect after a quoted word (`echo "hi">x`) and a one-word subshell (`(ls)>out`)." with "They are a `>` after a nested or arithmetic group (`$((1))>x`, `((i>0))>x`)."
- Origin: append "#4210 made `tokenize` record a per-character span mask, so a redirect glued after a quoted span or a one-word group is seen."

- [ ] **Step 4: Run the tests and the perf budget**

Run: `node --test tests/hooks-bash-prefilter.test.js tests/hooks-gate-coverage.test.js`
Expected: PASS, with 0 failures.

Run: `npm run test:perf`
Expected: PASS (AC3.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/bash-prefilter.js tests/hooks-bash-prefilter.test.js plugin/skills/_shared/policy-schema-coverage.md docs/journeys/write-a-glued-redirect-from-the-main-checkout-4015.md
git commit -m "Pin the quoted-span glued redirect in the prefilter corpus — document #4210's shapes in the coverage block and the journey (refs #4210)"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (bare-span record, quoted-span shapes) | Task 1 |
| Deliverable 2 (quoted `>` stays literal) | Task 1 |
| Deliverable 3 (subshell/process substitution, `((i>0))`) | Task 2 |
| Deliverable 4 (prefilter, corpus, coverage doc, journey) | Task 3 |
| AC1.1 (`echo "hi">x` resolves; quoted forms resolve nothing) | Task 1 Step 1 |
| AC1.2 (gate-coverage pins both and goes red on revert) | Task 1 Step 2 (red before implementation), plus the whole-branch review's revert probe |
| AC2.1 (`(ls)>out` resolves, `((i>0))` does not) | Task 2 Step 1 |
| AC3.1 (corpus lists the quoted-word shape; test:perf passes) | Task 3 Steps 1 and 4 |
