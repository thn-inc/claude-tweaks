# Windows Quoted Native Path Guards (#4281) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the worktree, write, shadow run-dir, policy.yml and teardown guards deny a Bash command that names a quoted native path (`"D:\…"`, `'D:\…'`), instead of failing open on every backslash.

**Architecture:** `tokenize` (`plugin/bin/lib/hooks/git-command.js`) returns each word's bash value, with the per-character `spanKinds` mask (#4210) realigned to that value, plus the typed text the heredoc-reader checks still read. `isUnresolvable` stops rejecting a backslash, since one left in a value is now a literal path character. An injectable `pathImpl` (default `path`) is passed from each parser's `opts` down to every path resolution, so a `path.win32` pin runs on Linux. Native-path test fixtures are single-quoted through one shared helper.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T135603-spec-4281/work/4281-spec.md` (record #4281)

**Scope keywords:** isUnresolvable, tokenize, resolveWriteTarget, resolveCd, pathImpl

**Premise-refs:** plugin/bin/lib/hooks/git-command.js, plugin/bin/lib/hooks/pre-tool-use.js, plugin/bin/lib/hooks/bash-prefilter.js, .github/workflows/windows-regression.yml

## Global Constraints

- The change is security-relevant: a genuinely unprovable token must still yield no target. Only a provable literal may become a target (record Gotchas).
- Real bash is the oracle (`.claude/skills/shell-scanner-bash-differential/SKILL.md`). Every word-value rule below was run under `/bin/bash` (3.2) and `/opt/homebrew/bin/bash` (5) on 2026-10-25. Cite the verdict in each new test's comment, in the form `bash 3.2 and 5: …`.
- Test titles name the record and the behavior (`#4281: …`), and carry the AC clause id when they cover one (`AC2.1 #4281: …`). Never use review-round labels.
- Existing fail-open pins in `tests/hooks-git-command.test.js` stay green with their assertions unchanged: escaped quote (`cd "pa\"th"`, `git -C "we\"ird"`), `$VAR`, backtick, `cd -P` (AC4).
- The `#4149 routine` table and every other case in `tests/hooks-gate-coverage.test.js` stay green unchanged.
- Commit style: `{Verb} {what} — {detail}`, body `Refs #4281`, trailer `Claude-Session: https://claude.ai/code/session_01VQ5xwJKNNfTkMXnRsmxndL`. Never write "closes"/"fixes".

## Verified bash verdicts (bash 3.2 and 5 agree unless noted)

| Command word | Value |
|---|---|
| `"D:\a\_temp\x"` and `'D:\a\_temp\x'` | `D:\a\_temp\x` |
| `D:\a\_temp\x` (unquoted) | `D:a_tempx` |
| `"a\$b" "a\`b" "a\"b" "a\\b" "a\xb"` | `a$b`, ``a`b``, `a"b`, `a\b`, `a\xb` |
| `a\$b a\\b a\ b` (unquoted) | `a$b`, `a\b`, `a b` |
| `a\`+newline+`b`, bare or inside `"…"` | `ab` |
| `a\` at the end of the command | bash 3.2: `a`, bash 5: `a\` (**versions disagree**) |
| `'D:\'` | `D:\` |
| `A\=b` | runs the command `A=b` (exit 127), not an assignment |
| `\>x` | the word `>x`, not a redirection |

## Review Focus

1. A stray trailing backslash (`cd /x\` at the end of a segment). The bash versions disagree on its value, so it must stay unresolvable, as at base. Pinned in Task 1.
2. A drive-relative value (`D:a.js`, which is what an unquoted `D:\a.js` becomes) under `path.win32`. It names a per-drive cwd the hook cannot see, so it must yield no target, never a resolution against the session cwd. Pinned in Task 2.
3. An escaped `=` (`A\=/evil; cd $A && git commit`). Bash runs `A=/evil` as a command, so `A` stays unset. Value-level tokens must not turn it into an assignment and fabricate the `/evil` target. Pinned in Task 1.
4. A leading-escaped redirect-looking word (`cp a \>x`). It is the file argument `>x`, not a redirection, so `dropRedirections` must keep it. Pinned in Task 1.
5. Heredoc-reader detection on a native-path shell opener (`C:\bin\sh <<EOF`, `bas\h <<EOF`). Program names keep reading the typed text, so the `#3989` shell carve-out pins in `tests/hooks-gate-coverage.test.js` stay green. Pinned by those existing tests (Task 1 Step 4 runs them).

---

### Task 1: Word values in `tokenize`, and the narrowed backslash rule

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js`:
  - `tokenize` (:348-415) and its header comment
  - `isUnresolvable` (:422-444) and its header comment
  - `updateAssignment` (:490) and the `cdLead` loop in `visitSegment` (:586-588)
  - `dropRedirections` (:2131)
  - `checkReaderCommand` (:1183) and `planHeredocBodies` (:1444), so both read `.typed`
- Test: `tests/hooks-git-command.test.js`
- Test: `tests/hooks-bash-prefilter.test.js`, one `DIFFERENTIAL_CORPUS` line

**Interfaces:**
- Produces: `tokenize(seg)` returns `{ tokens, typed, singleQuoted, doubleQuoted, leadQuoted, spanKinds }`:
  - `tokens[i]` is the bash value.
  - `typed[i]` is today's typed text, byte-identical to the current `tokens[i]`.
  - `spanKinds[i].length === tokens[i].length`.
  - An escaped character (a bare `\x` pair, or inside double quotes one of `\$`, ``\` ``, `\"`, `\\`) is one value character of kind `e`.
  - A backslash-newline pair, bare or double-quoted, contributes no character.
  - Every other double-quoted backslash stays as a `d` character.
  - A stray character keeps kind `x`.
- Produces: `isUnresolvable(raw)` no longer tests `raw.includes('\\')`. It rejects a value that ends in `\` instead (the stray, version-split case). All other rules are unchanged.
- Produces: an assignment word needs a bare `=`. `updateAssignment(vars, t, kinds)` and the `cdLead` loop take the token's kinds and require `kinds[t.indexOf('=')] === 'b'`. They also require every name character to be `b`.
- Produces: `dropRedirections(tokens, leadQuoted, spanKinds)` treats a token whose first kind is `e` as literal, the way it treats `leadQuoted`.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-git-command.test.js`. Require `tokenize` from the module. Each test comment cites its bash verdict from the table above.
  - `#4281: tokenize returns each word's bash value`:
    - `tokenize('tee "D:\\a\\_temp\\x"').tokens` deep-equals `['tee', 'D:\\a\\_temp\\x']`.
    - `tokenize("tee 'D:\\a\\_temp\\x'").tokens` is the same.
    - `tokenize('tee D:\\a\\_temp\\x').tokens[1] === 'D:a_tempx'`.
    - `tokenize('p "a\\$b" "a\\`b" "a\\"b" "a\\\\b" "a\\xb"').tokens.slice(1)` deep-equals `['a$b', 'a`b', 'a"b', 'a\\b', 'a\\xb']`.
    - `tokenize('p a\\ b').tokens[1] === 'a b'`.
    - `tokenize('p a\\\nb').tokens[1] === 'ab'`, and the same for `'p "a\\\nb"'`.
  - `#4281: spanKinds stays aligned with the value, and an escaped character is kind e`:
    - For every input above, `spanKinds[i].length === tokens[i].length`.
    - `tokenize('p "a\\$b"').spanKinds[1] === 'ded'`.
    - `tokenize('p a\\ b').spanKinds[1] === 'beb'`.
  - `#4281: typed keeps the word as typed`: `tokenize('tee D:\\a\\x').typed[1] === 'D:\\a\\x'`.
  - `#4281: a quoted backslash path is a provable cd target`:
    - `gitTargets("cd '/tmp/a\\b' && git commit -m x", '/repo')` deep-equals `[{ action: 'commit', dir: path.resolve('/tmp/a\\b') }]`.
  - `#4281: a trailing stray backslash stays unresolvable (bash 3.2 drops it, bash 5 keeps it)`:
    - `gitTargets('git commit -m x; cd /tmp/a\\', '/repo')` still lists the commit.
    - `gitTargets('cd /tmp/a\\', '/repo')` deep-equals `[]`.
    - `fileWriteTargets('tee /tmp/a\\', '/r')` deep-equals `[]`.
  - `#4281: an escaped = is a command word, not an assignment`: `gitTargets('A\\=/evil; cd $A && git commit -m x', '/repo')` deep-equals `[]`.
  - `#4281: a leading-escaped redirect word is a file argument`: `fileWriteTargets('cp a \\>x', '/r')` deep-equals `[{ action: 'copy', file: path.resolve('/r', '>x') }]`.

  In `tests/hooks-bash-prefilter.test.js`, append to `DIFFERENTIAL_CORPUS` with a `// #4281: a bare redirect to a quoted native path.` comment: `'echo x > "D:\\r\\tracked.js"'`. The existing corpus tests then require a parser target and the full-handler path.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/c186f969-523f-49e1-b364-8fdcb09e6cd7/scratchpad/4281-t1-red.txt 2>&1; tail -40 /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/c186f969-523f-49e1-b364-8fdcb09e6cd7/scratchpad/4281-t1-red.txt`
Expected: FAIL. The value tests fail (tokens keep the typed backslashes), and the quoted-cd and corpus tests fail (`isUnresolvable` rejects the backslash). The `\>x` test also fails: at base `\>x` reaches `resolveWriteTarget` with its backslash, which is unresolvable, giving `[]`. The stray-backslash and escaped-`=` tests pass at base. They are regression pins for a naive value change, confirmed in Step 5.

- [ ] **Step 3: Implement** the Interfaces above in `git-command.js`:
  - Build each token's value and kinds together inside the existing regex loop.
  - Keep `typed` as the old concatenation.
  - Rewrite `tokenize`'s and `isUnresolvable`'s header comments to state the new contract. Name the stray-backslash rule and its bash 3.2/5 split.
  - `visitSegment` passes `spanKinds[0]` to `updateAssignment`. It passes the per-index kinds to the `cdLead` loop and `spanKinds` to `dropRedirections` (via `fileWriteTargets`'s `quoting.spanKinds`).
  - `checkReaderCommand` and `planHeredocBodies` read `tokenize(...).typed` where they read `.tokens` today.
  - Keep everything else on `tokens`/`spanKinds`, including `advanceNesting`, the redirect scan and `substituteVars`. They already treat kind `e` as literal.

- [ ] **Step 4: Run the tests to verify they pass, plus the scanner suites**

Run: `node --test tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/hooks-gate-coverage.test.js tests/teardown-gate.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/c186f969-523f-49e1-b364-8fdcb09e6cd7/scratchpad/4281-t1-green.txt 2>&1; tail -15 /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/c186f969-523f-49e1-b364-8fdcb09e6cd7/scratchpad/4281-t1-green.txt`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Go-red the three regression pins.** One mutant at a time in the worktree, reverting each with `git checkout -- plugin/bin/lib/hooks/git-command.js` before the next:
  1. Drop the trailing-backslash rule.
  2. Drop the bare-`=` check.
  3. Drop the `e` lead check in `dropRedirections`.

  Re-run `tests/hooks-git-command.test.js` for each. Expected: the matching `#4281` test fails each time. Quote the failing test name in the report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js
git commit -m "Read each Bash word's value in tokenize — a quoted backslash is a literal path character

Refs #4281

Claude-Session: https://claude.ai/code/session_01VQ5xwJKNNfTkMXnRsmxndL"
```

### Task 2: `pathImpl` threading, the drive-relative rule, and the win32 pins

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js`:
  - `resolveCd`, `isAbsolutePlain`, `resolveWriteTarget`, `findGitLead`, `resolveGitCommand`
  - `forEachShellSegment` → `walkShellChunk` → `visitUnderEach` → `visitSegment`
  - `resolvedGitSegments`, `fileWriteTargets`, `mkdirTargets`, `redirectWriteTargets`
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js`: `teardownTargets` (:502-539)
- Test: `tests/hooks-git-command.test.js`

**Interfaces:**
- Consumes: Task 1's `tokenize` values (a quoted `D:\repo\a.js` reaches the sinks as `D:\repo\a.js`).
- Produces: `opts.pathImpl`, default `path`, on `gitTargets(command, cwd, opts)`, `fileWriteTargets(command, cwd, opts)`, `mkdirTargets(command, cwd, opts)` and `forEachShellSegment(command, cwd, handler, opts)`.
  - The walk passes it to `visitSegment`'s `resolveCd(effCwd, raw, pathImpl)`.
  - Handlers get it as `quoting.pathImpl`, so `redirectWriteTargets(t, effCwd, quoting)` and each `resolveWriteTarget(effCwd, raw, pathImpl)` call use it.
  - `resolveGitCommand(t, effCwd, pathImpl)` passes it to `findGitLead(t, dir, pathImpl)` and the existing `skipGlobalFlags(..., pathImpl)`.
- Produces: `teardownTargets(ctx, { pathImpl } = {})`. The Bash branch passes `{ ...walkOptions(cwd), pathImpl }` to `forEachCommandSegment`. `rest[0]` resolves through `resolveWriteTarget(dir, rest[0], pathImpl)`, exported from git-command.js, instead of a bare `path.resolve`. An unprovable value then yields no target. `post-tool-use.js`'s `teardownTargets(ctx)` call is unchanged.
- Produces: a drive-relative value is unresolvable when `pathImpl.sep === '\\'`. The value matches `/^[A-Za-z]:(?![\\/])/`. The check applies in `resolveCd`, `skipGlobalFlags`'s `-C` branch and `resolveWriteTarget`.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-git-command.test.js`. Put the AC2 positives in one function `assertQuotedNativePins(mod, preToolUse)`, called with the real modules, so Step 5's control reuses it.
  - `AC2.1 AC2.2 #4281: a quoted native tee target resolves through path.win32, pinned as an exact string`:
    - `fileWriteTargets('tee "D:\\repo\\a.js"', 'D:\\repo', { pathImpl: path.win32 }).map((t) => t.file)` deep-equals `['D:\\repo\\a.js']`.
  - `AC2.3 #4281: mkdir, git -C and a cd before worktree remove resolve through path.win32`:
    - `mkdirTargets('mkdir -p "D:\\repo\\x"', 'D:\\repo', { pathImpl: path.win32 })` deep-equals `[{ action: 'mkdir', file: 'D:\\repo\\x' }]`.
    - `gitTargets('git -C "D:\\repo\\wt" push', 'D:\\repo', { pathImpl: path.win32 })` deep-equals `[{ action: 'push', dir: 'D:\\repo\\wt' }]`.
    - `teardownTargets({ input: { tool_name: 'Bash', tool_input: { command: 'cd "D:\\repo" && git worktree remove wt' } }, cwd: 'D:\\x' }, { pathImpl: path.win32 })` deep-equals `[{ path: 'D:\\repo\\wt', source: 'bash' }]`.
  - `AC2.4 #4281: an unquoted native path is no target (bash reads D:repoa.js, a drive-relative path)`:
    - `fileWriteTargets('tee D:\\repo\\a.js', 'D:\\repo', { pathImpl: path.win32 })` deep-equals `[]`.
    - `gitTargets('cd D:\\repo && git commit -m x', 'D:\\x', { pathImpl: path.win32 })` deep-equals `[]`.
  - `AC3.1 AC3.2 #4281: go-red — putting the backslash rule back into isUnresolvable fails every quoted AC2 case`:
    - Read git-command.js's source and insert `raw.includes('\\\\') ||` before `raw.includes('$')` inside `isUnresolvable`. Assert the replace matched exactly once.
    - Write it to `path.join(os.tmpdir(), 'ct-4281-mutant-' + process.pid, 'git-command.js')`. It requires only `path`.
    - Require it, then run each AC2.2/AC2.3 assertion against the mutant inside `assert.throws`, one `assert.throws` per case.
    - For the teardown case, require a copy of pre-tool-use's `teardownTargets` bound to the mutant. If pre-tool-use cannot be rebound cleanly, assert the mutant's `gitTargets` for the same `cd "D:\\repo" && git worktree remove wt` command yields no `D:\\repo` dir instead. Name which form you used in the test comment.
    - Remove the temp dir in `after`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-git-command.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/c186f969-523f-49e1-b364-8fdcb09e6cd7/scratchpad/4281-t2-red.txt 2>&1; tail -30 /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/c186f969-523f-49e1-b364-8fdcb09e6cd7/scratchpad/4281-t2-red.txt`
Expected: FAIL. With no `pathImpl` threading, the AC2.2 and AC2.3 cases resolve `D:\repo\a.js` through POSIX `path` as a relative name, and `teardownTargets` ignores its second argument. AC2.4's `tee` case may already be `[]` or a POSIX-relative target. Record which.

- [ ] **Step 3: Implement** the Interfaces above. In `teardownTargets`, keep the `rest.length !== 1 || rest[0].startsWith('-')` guard ahead of the new resolver call.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/hooks-gate-coverage.test.js tests/teardown-gate.test.js tests/hooks-pre-tool-use.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/c186f969-523f-49e1-b364-8fdcb09e6cd7/scratchpad/4281-t2-green.txt 2>&1; tail -15 /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/c186f969-523f-49e1-b364-8fdcb09e6cd7/scratchpad/4281-t2-green.txt`
Expected: PASS, `# fail 0`. AC4.1's escaped-quote, `$VAR`, backtick and `cd -P` pins are among these, with unchanged assertions.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-git-command.test.js
git commit -m "Thread pathImpl through the guard parsers — a quoted native path resolves through path.win32

Refs #4281

Claude-Session: https://claude.ai/code/session_01VQ5xwJKNNfTkMXnRsmxndL"
```

### Task 3: Shared fixture-quoting helper, the five H test files, and the parity skill row

**Files:**
- Create: `tests/helpers/shell-quote.js`
- Modify:
  - `tests/hooks-pre-tool-use.test.js`
  - `tests/hooks-dispatcher.test.js`
  - `tests/hooks-pipeline-shadow-guard.test.js`
  - `tests/hooks-policy-exemption.test.js`
  - `tests/teardown-gate.test.js`
  - `.claude/skills/windows-checkout-test-parity/SKILL.md`, a new row at the end of its Anti-Patterns table (after :179)
- Test: `tests/helpers-shell-quote.test.js` (create)

**Interfaces:**
- Produces: `module.exports = { shellQuote }`. `shellQuote(p: string): string` returns `'` + `p` with every `'` replaced by `'\''` + `'`, a POSIX single-quoted word whose bash value is `p` exactly.

- [ ] **Step 1: Write the failing test** `tests/helpers-shell-quote.test.js`, `#4281: shellQuote yields a word whose bash value is the input`:
  - `shellQuote('D:\\a\\_temp\\x') === "'D:\\a\\_temp\\x'"`.
  - `shellQuote("it's") === "'it'\\''s'"`.
  - Round-trip: for `['D:\\a\\_temp\\x', "it's", '/tmp/a b', 'x$y`z']`, `spawnSync('/bin/bash', ['-c', `printf %s ${shellQuote(v)}`]).stdout.toString() === v`.
  - Skip the round-trip off POSIX with a stated reason (`{ skip: process.platform === 'win32' && 'no /bin/bash on win32' }`).

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/helpers-shell-quote.test.js`
Expected: FAIL (non-zero exit) with `Cannot find module './shell-quote'`.

- [ ] **Step 3: Implement `shellQuote`**, then route the five files' fixtures through it:
  - Every path interpolated into a Bash command fixture in the five files: `bashInput(`…${p}…`)` lines, `tool_input: { command: `…${p}…` }` payloads, and `'tee ' + abs` concatenations.
  - Quoted or unquoted today, each becomes `${shellQuote(p)}` with the surrounding quotes removed.
  - Cover at least the 24 tests named in the spec's "Failing tests" list, found by title.
  - Leave alone a fixture whose path deliberately exercises a different quoting shape, such as an escaped-quote or `$VAR` case. Note each one left in the commit body.
  - Add the parity-skill row, in that table's voice: `| Interpolating a native path into a Bash command fixture unquoted (`tee ${target}`, `cd ${parent} && …`) in a hook test | Bash strips an unquoted backslash, so `D:\a\_temp\x` reaches the guard as `D:a_tempx`, a drive-relative path no real session sends, and the test fails on win32 only (the 24 class-H failures behind #4281). Single-quote it through `tests/helpers/shell-quote.js`'s `shellQuote`, which keeps the backslashes as bash does; a double-quoted fixture works too, but the helper also survives a `'` or `$` in the path |`

- [ ] **Step 4: Verify AC5.1 and AC1.1**

Run: `grep -n 'bashInput(`[^`]*\${' tests/hooks-pre-tool-use.test.js tests/hooks-dispatcher.test.js tests/hooks-pipeline-shadow-guard.test.js tests/hooks-policy-exemption.test.js tests/teardown-gate.test.js | grep -v 'shellQuote('`
Expected: no output, or only lines whose `${…}` is a non-path value (a message, a sha). List them in the report.

Run: `node --test tests/helpers-shell-quote.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/hooks-pre-tool-use.test.js tests/hooks-dispatcher.test.js tests/hooks-pipeline-shadow-guard.test.js tests/hooks-policy-exemption.test.js tests/teardown-gate.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/c186f969-523f-49e1-b364-8fdcb09e6cd7/scratchpad/4281-t3-green.txt 2>&1; tail -15 /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/c186f969-523f-49e1-b364-8fdcb09e6cd7/scratchpad/4281-t3-green.txt`
Expected: PASS, `# fail 0`. This is AC1.1's suite list plus the helper's test.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/shell-quote.js tests/helpers-shell-quote.test.js tests/hooks-pre-tool-use.test.js tests/hooks-dispatcher.test.js tests/hooks-pipeline-shadow-guard.test.js tests/hooks-policy-exemption.test.js tests/teardown-gate.test.js .claude/skills/windows-checkout-test-parity/SKILL.md
git commit -m "Quote native paths in hook test fixtures through one helper — bash keeps a quoted backslash

Refs #4281

Claude-Session: https://claude.ai/code/session_01VQ5xwJKNNfTkMXnRsmxndL"
```

### Task 4: Differential check against real bash and the merge base (scratch, not committed)

**Files:**
- Scratch only: `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/c186f969-523f-49e1-b364-8fdcb09e6cd7/scratchpad/4281-diff/`. Any divergence becomes a pinned test in `tests/hooks-git-command.test.js` with its own fix.

**Interfaces:**
- Consumes: Tasks 1-2's `fileWriteTargets`, `gitTargets` and `mkdirTargets`.

- [ ] **Step 1: Base comparison.** `git worktree add --detach <scratch>/base <merge-base>` (`git merge-base HEAD origin/main`). For every command string in:
  - the `tests/hooks-gate-coverage.test.js` `#4149 routine` table,
  - `tests/hooks-bash-prefilter.test.js`'s `DIFFERENTIAL_CORPUS`, and
  - 40 generated commands over the alphabet `{ ', ", \, $V, `x`, $(x), cd, &&, ;, >, \n, D:\a, /m/f }`,

  diff `fileWriteTargets`/`gitTargets`/`mkdirTargets` at base and at HEAD, cwd `/m`. Every command whose targets shrank (denied at base, allowed now) needs a bash 3.2/5 verdict. Pin it, or fix it if bash writes where HEAD reports nothing.

- [ ] **Step 2: Differential fuzz.** Run each generated command under `/bin/bash` and `/opt/homebrew/bin/bash` in a scratch dir, with `printf`-style probes in place of writes. A write bash makes where HEAD reports no target is a leak: fix and pin it. A HEAD target bash never writes is a spurious deny: accept it only as a stated fail-closed tradeoff in a test comment.

- [ ] **Step 3: Timing through the hook.** Time `node plugin/bin/hooks.js pre-tool-use` on a 40 KB command of repeated `"D:\a\b" ` words and on one of repeated `a\ ` escapes, base vs HEAD. Expected: HEAD within 1.5× base. Report both numbers. Add nothing to `tests/`.

- [ ] **Step 4: Report** the counts (commands compared, targets moved in each direction, divergences found and pinned) in the task report with the raw output paths. The controller logs them to `decisions.md`.

---

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (tokenize values, quote flags kept) | Task 1 |
| Deliverable 2 (narrowed `isUnresolvable`) | Task 1 |
| Deliverable 3 (`pathImpl`, drive-relative unprovable) | Task 2 |
| Deliverable 4 (shared quoting helper, H fixtures) | Task 3 |
| Deliverable 5 (parity skill Anti-Patterns row) | Task 3 |
| AC1.1 (the seven suites pass on Linux) | Task 3 Step 4, then Common Step 5's full `verify.js` run |
| AC2.1, AC2.2, AC2.3, AC2.4 | Task 2 Step 1 |
| AC3.1, AC3.2 (go-red) | Task 2 Step 1 |
| AC4.1 (fail-open pins unchanged) | Global Constraints; Task 2 Step 4 |
| AC5 ("every interpolated path inside a Bash-command fixture goes through the shared quoting helper"; the `bashInput(` grep) | Task 3 Steps 3-4 |
| AC6.1 (`windows-regression.yml` on the branch: the 5 files at 0 class-H failures, no newly failing file) | Controller, after simplify: dispatch `windows-regression.yml` on the branch, read the per-file isolated logs |
