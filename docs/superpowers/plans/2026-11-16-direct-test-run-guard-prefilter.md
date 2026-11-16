# Direct-Test-Run Guard Prefilter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop starting a node process for Bash calls the direct-test-run guard can never deny, with every deny and allow verdict unchanged.

**Architecture:** A POSIX sh prefilter, `tools/direct-test-run-guard.sh`, is sourced into the hook's own shell by the command registered in `.claude/settings.json`. It reads the payload line, takes the `tool_input.command` string, and ends the hook (exit 0, nothing started) only when every fragment of the command starts with a plain word that is none of the program words the guard reads. Every other call is handed to `tools/direct-test-run-guard.js` with the stdin bytes unchanged, by `exec` on the common path. A missing or broken prefilter falls through to `node "$d.js"` in the hook command itself.

**Tech Stack:** POSIX sh (dash, bash 3.2, Git Bash), Node built-in test runner (`node:test`), no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T193722-spec-5794/work/5794-spec.md` (record #5794)

**Amended after the whole-branch review (commit 550e984a6a):** the node-start branch no longer uses `command exec node` with a here-document. It pipes the line to node, so every path ends in `exit 0` whatever node returns (with the exec, a guard file node could not load ended the hook with status 1). The Architecture paragraph, the Global Constraint on `command exec` and Task 1's sh text below describe the earlier form; `tools/direct-test-run-guard.sh` is the current text.

## Global Constraints

- The registered hook command is exactly (one line): `d="$CLAUDE_PROJECT_DIR/tools/direct-test-run-guard"; [ -r "$d.sh" ] && command . "$d.sh"; node "$d.js"; exit 0`
- The prefilter may only ever add node runs. Any input it cannot read plainly goes to node. It never prints, and the hook always exits 0.
- POSIX sh only in `tools/direct-test-run-guard.sh`: no `[[`, `local`, arrays, `$'...'`, `${v//...}`, `echo -e`, `==` in `[ ]`. No `set -e`, no `set -u`. Variables are prefixed `dtrg_`.
- The skip path uses shell builtins only: no command substitution, no pipeline, no external program.
- Caps: a payload over 8192 bytes goes to node, and so does one where any of the three scans reads more than 256 pieces (pieces between quotes in the payload, pieces between backslashes in the command string, fragments of the command). The spec's "escape cap" is the second of these; the other two were added at plan time, when a command of 8,000 semicolons measured 60 ms.
- A backslash in the command sends the call to node. The spec lists the backslash among the escapes the prefilter decodes; the plan tightens that on purpose. Decoding `\\` needs a rule that tells an escaped backslash before a quote from an escaped quote, and it buys nothing: the common case (`grep "a\|b"`) is cut at the `|` and goes to node on the quote that follows.
- The file body is one brace group (the spec's "one compound command"), so the shell parses all of it before it runs any of it.
- After `command exec node … <<DTRG_EOF` the next line pipes the same line to node. It runs only when the exec did not happen: bash 3.2 writes a here-document to a temp file, and when that fails `command exec` returns instead of ending the shell, so without the pipe a call that needs node would reach `exit 0` unjudged. No test can pin this line: bash falls back from an unusable `TMPDIR` to `/tmp` (measured: `TMPDIR=/nonexistent` changes nothing), and dash and bash 5 use a pipe. It is listed as unproven in the mutant evidence.
- A payload over the cap is read whole by the shell's `read` before it is handed to node, at about 0.4 ms per KB (measured: 64 KB costs 86 ms against 53 ms for the old command; 1 MB costs 479 ms against 55 ms). In one day of recorded calls 337 of 1,264,622 payloads were over 8192 bytes, the largest was 20,645 bytes and none was over 64 KB, so the mean added cost is 0.001 ms a call. The plan accepts that cost and budgets it in Task 3 instead of adding a bounded read, which POSIX sh does not have (`read -n` is bash only).
- Tests read tracked text files through `tests/helpers/read-skill.js`'s `readText`, never `fs.readFileSync(p, 'utf8')` (`tests/raw-markdown-read-conformance.test.js`). A Buffer read (no encoding) of the prefilter is allowed where raw bytes are the point.
- No wall-clock assertion under `tests/` (`tests/wall-clock-budget-conformance.test.js`); timing goes in `perf/`.
- Every spawn in a test passes `timeout: 30000, killSignal: 'SIGKILL', windowsHide: true`.
- Paths reach a shell through the environment or argv, never spliced into script text. A PATH value is joined with `path.delimiter`, never a literal colon (`tests/path-stub-helper.test.js` scans for it).
- No test file gains a string literal whose whole content is `--test`: beside `child_process`, the guard's own script scan reads that as a script that spawns a test run.
- New test names start with `#5794` and cite the spec's clause ids (`AC{item}.{clause}`); the file already holds #5547's tests named `AC7.1`, `AC11.1` and so on, which keep their names.
- Commit style: `{Verb} {what} — {detail}`, then a blank line, `refs #5794`, a blank line, and the trailer `Claude-Session: https://claude.ai/code/session_01CcCLFu9wmBNz5xcrXCxWBo`. Stage files by explicit path. One plain `git` command per Bash call (no `&&` chains, no `cd`).
- Run tests with `node --test tests/direct-test-run-guard.test.js` (one file, allowed) or `node tools/run-tests.js <files>`; never a multi-file `node --test`.
- Measured facts this plan relies on (2026-11-16, Claude Code 2.1.325, macOS; a headless `claude -p --setting-sources project` run in a scratch project whose PreToolUse hook wrote its stdin and `$0` to files): the payload is one compact JSON line ending in one `\n`, with keys `session_id, transcript_path, cwd, prompt_id, permission_mode, effort, hook_event_name, tool_name, tool_input{command, description}, tool_use_id`; the hook shell is `/bin/sh`.
- The registered command string was run once in each fault state under `/bin/sh` (bash 3.2), `/bin/dash` and bash 5: missing file, CRLF file and syntax-broken file each exit 0 with empty stdout. A plain `. file` instead exits 2 under dash on a missing or broken file, which would block every Bash call, so the `[ -r ] && command .` form is required.
- The prefilter text in Task 1 was run at authoring time against 144 decision rows (the rows Task 1's tests name) under `/bin/sh`, `/bin/dash` and bash 5, each with and without `LC_ALL=en_US.UTF-8`: 0 mismatches. 29 single-rule mutants each flipped at least one row under `/bin/sh`; the `LC_ALL=C` mutant flips rows only under bash 3.2 (macOS `/bin/sh`), because dash and bash 5 match bytes without it. An earlier text with the same decisions on every recorded call was replayed over one day of recorded Bash calls (1,264,622 calls, 72,800 distinct): 0 calls skipped that the guard or any of five widened oracles denies, identical verdicts in the three shells, 50.1% of calls skip node.

Governing project skills, quoted:

- `shell-scanner-bash-differential`, "Shell mirror of a JS oracle": "**Every shell and every awk.** Run the shell side under each POSIX shell found on PATH (sh, dash, bash) and each awk (BWK awk on macOS, mawk on Debian/Ubuntu, gawk on Fedora/Arch and in Git Bash). A variant that is absent, or that cannot be measured on a platform, is skipped with a named reason, never dropped silently." "**Bytes, not characters.** JS `\s` matches non-ASCII whitespace. awk under a UTF-8 locale behaves differently across implementations, so run awk with `LC_ALL=C` and spell each non-ASCII whitespace character as its UTF-8 byte sequence (`\302\240` for U+00A0, and so on)." "**An oracle-drift guard.** Each fixture states its expected verdict. Assert the JS oracle still returns it before comparing the shell, so a change to the JS side fails as `oracle drift`, not as a confusing shell mismatch." "**Go-red controls per pinned literal.** For each literal the copy depends on (a whitespace member such as `\r`, an alias key), copy the script, mutate that one literal, and assert the parity check fails on the fixture that pins it." (This prefilter uses no awk; the shell rule, the byte rule via `LC_ALL=C`, the oracle-drift guard and the go-red control apply.)
- `shell-scanner-bash-differential`, "Every rule earns a mutant that turns a test red": "In a scratch worktree, delete or invert each rule one at a time and run the four suites. A mutant that every test survives means one of two things: a pin is missing (add a case that fails on the mutant), or the rule is dead (remove it)."
- `shell-scanner-bash-differential`, "A new consumer of the segment walker is replayed over recorded commands": "Before the final review, replay the recorded Bash commands from the local transcript store (`$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`, the store `tools/guard-refusals.js` reads) through the consumer's throwing inner function (`judgeOrThrow`), never its catching wrapper, which turns a throw into a silent allow. Count denies and throws, take an independent count of the shape the consumer targets (a plain regex for `node … --test`) and sample the allowed ones".
- `windows-checkout-test-parity`: "A test reads a tracked text file through `tests/helpers/read-skill.js`'s `readText`, never a raw `fs.readFileSync(p, 'utf8')`". "Build it from the same string with `.replace(/\n/g, '\r\n')`, so the two cases differ only in line endings". "Passing a literal `/bin/sh` to `execFileSync`/`spawnSync` | On win32 it resolves to `<drive>:\bin\sh` and throws `ENOENT`". "Splicing a native path into script text a test then runs: a `node -e` or `require('…')` JS string literal, a heredoc, a `sh -c` command | The literal or the shell treats the backslashes as escapes, so the script sees a mangled path on win32 only". "Reading `env.PATH` from a `{ ...process.env }` copy, or asserting `copy.PATH === process.env.PATH` | win32's `process.env` is a case-insensitive proxy whose stored key is `Path`."
- `regex-scan-linearity`: "Wall-clock budgets live in `perf/{name}-linearity.test.js`, run by `npm run test:perf`, never by `npm test`. `tests/wall-clock-budget-conformance.test.js` fails any `performance.now()` comparison under `tests/`". (The spec names `perf/direct-test-run-prefilter.test.js`; it follows `perf/hooks-prefilter.test.js`, the existing hook-cost budget file.)
- `prose-code-twin-pin` (written for skill prose against `plugin/bin`; the sh word list against the JS constants is the same kind of pair): "Writing a pinning test that only checks one direction (code has every prose row, but not the reverse) when the two sides name the same closed vocabulary | Assert set equality both ways". "Step 2's question is answered only when the test reaches the constant that makes the decision." `PROGRAM_WORDS` spreads the five constants the classifier reads (`NODE_NAMES`, `SHELLS`, `LEAD_KEYWORDS`, `PREFIX_OPTIONS`, `REPEATING_LEADS`) and adds five words the guard compares inline (`npx`, `eval`, `source`, `.`, `find`). The word-list test pins the sh list to it both ways; the test that reaches the decision is `#5794 AC2.1 AC2.2 AC2.3`, which runs every command any test saw denied through the prefilter, so a deny rule keyed on a new first word fails there with its own deny row.
- `single-source-constant-guard` and `test-impact-tracer-read-shape` name neither these files nor this kind of change (a scan guard over `tests/` and `plugin/bin/`; a change to `tools/test-impact/tracer.js`): no rule of theirs applies.

## Review Focus

1. A program name built from pieces (`X=de; no$X --test a.test.js b.test.js`): the guard's scanner substitutes it and denies; the prefilter must send it to node. Pinned in Task 1 (first word holding `$` or `=`).
2. A multi-line command whose later line starts a test run: every newline starts a fragment. Pinned in Task 1 (`ls\nnode --test a.test.js b.test.js`).
3. A separator inside quotes (`git commit -m "a; node x"`): the prefilter cuts there and goes to node; it must never fail or print. Pinned in Task 1.
4. A payload shape it does not know (pretty-printed JSON, a second `command` key, a `command` that is not a string, a line with no JSON at all): node runs and reads the same bytes. Pinned in Tasks 1 and 2.
5. A glob character in the command (`* x`) in a directory that holds files: the shell must not expand it into a plain file name. Pinned in Task 1 (the `set -f` row).

## Spec coverage map

| Clause | Where |
|---|---|
| AC1.1, AC1.2, AC1.3, AC1.4 | Task 2, test `#5794 AC1.1 AC1.2 AC1.3 AC1.4: the registered command prints what the node guard prints` |
| AC2.1, AC2.2, AC2.3 | Task 1, test `#5794 AC2.1 AC2.2 AC2.3: every command a test saw denied reaches node` |
| AC3.1, AC3.2 | Task 2, test `#5794 AC3.1 AC3.2: node reads the bytes the hook received` |
| AC4.1, AC4.2 | Task 2, test `#5794 AC4.1 AC4.2: the skip path starts nothing` |
| AC5.1, AC5.2, AC5.3 | Task 2, the three `#5794 AC5.…` tests |
| AC6.1 | Task 1, test `#5794 AC6.1: the sh word list is the guard's PROGRAM_WORDS` |
| AC6.2 | Verification evidence, item 1 (mutants) |
| AC7.1, AC7.2, AC7.3, AC7.4 | Verification evidence, item 2 (replay); the PR body carries the counts |
| AC8.1, AC8.2, AC8.3, AC8.4 | Verification evidence, item 3 (cost); the PR body carries the table |
| AC9.1, AC9.2 | Task 3, tests `#5794 AC9.1 AC9.2: …` |
| AC10.1, AC10.2 | The PR body's Windows paragraph, written at Common Step 7 from this plan's header facts |
| AC10.3 | Task 2, test `#5794 AC10.3: the prefilter is checked out with LF line endings` |
| AC10.4 | Task 1 (`perPrefilterShell` skips with stated reasons); Verification evidence, item 4 (Windows dispatch) |
| AC11.1 | Task 4 (docs); Common Step 5's full verification |

---

### Task 1: The prefilter and its decision tests

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tools/direct-test-run-guard.sh`
- Modify: `tools/direct-test-run-guard.js` (one new export, `PROGRAM_WORDS`)
- Test: `tests/direct-test-run-guard.test.js`

**Interfaces:**
- Produces: `PROGRAM_WORDS` (frozen array of strings, no duplicates) exported from `tools/direct-test-run-guard.js`.
- Produces: in `tools/direct-test-run-guard.sh`, the shell function `direct_test_run_guard_needs_node <payload>` (status 0: node must judge the call; status 1: skip) and `direct_test_run_guard_main`; sourcing the file with the shell variable `DIRECT_TEST_RUN_GUARD_LIB` set defines the functions and runs nothing.
- Produces: in the test file, `PREFILTER` (absolute path of the sh file), `perPrefilterShell(title, fn)` (`fn` gets `{ name, file }`), `hookPayload(command, extra?)` (the payload as one compact JSON line, no newline; `extra` is spread into `tool_input`) and `prefilterVerdicts(shellFile, payloadLines, { env, cwd }?)` returning an array of `'node'` or `'skip'`. Task 2 uses them.

- [ ] **Step 1: Write the failing tests**

All in `tests/direct-test-run-guard.test.js`. Change the import so every deny any test sees is recorded (the rest of the file keeps calling the same two names):

```js
const guard = require('../tools/direct-test-run-guard');
const { classifyCommand, hasDirectTestRun, scanScript, judge, realDeps, SAFEGUARDS_TEXT, PROGRAM_WORDS } = guard;
// Every command a test in this file sees denied, by either throwing entry point, under any options: the
// last test in the file runs each one through the sh prefilter.
const DENIED_COMMANDS = new Set();
function recordDeny(command, verdict) {
  if (typeof command === 'string' && verdict.decision === 'deny') DENIED_COMMANDS.add(command);
  return verdict;
}
const classifyCommandOrThrow = (command, options) => recordDeny(command, guard.classifyCommandOrThrow(command, options));
const judgeOrThrow = (payload, deps) => recordDeny(payload && payload.tool_input && payload.tool_input.command, guard.judgeOrThrow(payload, deps));
```

Add, after the `bash` payload helper (`ROOT` and `GUARD` are defined just above it), the shared prefilter helpers. Copy the shell list and `perShell` from `tests/hooks-launcher.test.js` lines 24 to 47 as `PREFILTER_SHELLS` and `perPrefilterShell` (`findOnPath` from `./helpers/path-stub`; `sh` required; `dash` skipped on win32 with that file's stated reason; `bash` and `dash` skipped by name when missing):

```js
const PREFILTER = path.join(ROOT, 'tools', 'direct-test-run-guard.sh');
// One PreToolUse payload as Claude Code 2.1.325 writes it (captured 2026-11-16): one compact JSON line.
const hookPayload = (command, extra = {}) => JSON.stringify({
  session_id: '1c62e9ba-c9f3-4896-a17e-e1f7fa768871',
  transcript_path: '/home/u/.claude/projects/-repo/1c62e9ba-c9f3-4896-a17e-e1f7fa768871.jsonl',
  cwd: ROOT,
  prompt_id: '6ee4cc1c-2e11-418f-960f-ba371fab8215',
  permission_mode: 'default',
  effort: { level: 'medium' },
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command, description: 'Run it', ...extra },
  tool_use_id: 'toolu_014brzUtdmTepXVxeaXhFJAj',
});
// Sources the prefilter once (its test seam) and asks it about each line of stdin.
const PREFILTER_DRIVER = 'DIRECT_TEST_RUN_GUARD_LIB=1; . "$1"; while IFS= read -r l || [ -n "$l" ]; do if direct_test_run_guard_needs_node "$l"; then echo node; else echo skip; fi; done';
function prefilterVerdicts(shellFile, payloadLines, { env = process.env, cwd } = {}) {
  const res = spawnSync(shellFile, ['-c', PREFILTER_DRIVER, 'sh', PREFILTER], {
    input: payloadLines.join('\n') + '\n', encoding: 'utf8', env, cwd, timeout: 30000, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stderr, '');
  const verdicts = res.stdout.split('\n').filter(Boolean);
  assert.equal(verdicts.length, payloadLines.length);
  return verdicts;
}
```

A payload line never holds a raw newline (JSON escapes it), so one line per payload is exact. `UTF8_ENV` is `{ ...process.env, LC_ALL: 'en_US.UTF-8' }`: tests 5 and 6 run under it, because under bash 3.2 a UTF-8 locale is where a missing `LC_ALL=C` shows (a host without that locale still passes).

Tests to add. Each uses `perPrefilterShell` (so it runs under sh, dash and bash) unless it says otherwise, and each asserts the whole verdict array against the expected one, naming the command on a mismatch:

1. `#5794 AC6.1: the sh word list is the guard's PROGRAM_WORDS` (one test, no shell). Read the prefilter with `readText`, take the one line that follows the comment line starting `# program-words:`, strip the leading blanks and the trailing `) return 0 ;;`, split on `|`, and compare with one function, `sameWords(list)`, which throws unless `[...list].sort()` deep-equals `[...PROGRAM_WORDS].sort()`. Also assert `PROGRAM_WORDS` holds `node`, `find`, `.` and `until`, has no duplicate, and is frozen. Go-red control in the same test: `assert.throws(() => sameWords(list.filter((w) => w !== 'find')))` and `assert.throws(() => sameWords([...list, 'coproc']))`.
2. `#5794 the prefilter skips a call whose fragments all start with a plain command name`. Rows, each expected `skip`, and each first asserted allowed by the oracle (`guard.judgeOrThrow(bash(command), realDeps()).decision === 'allow'`, message `oracle drift`): `git status --short && ls`, `ls -la`, `git -C "/a b/c" log --oneline | head -5`, `gh pr view 12 --json title`, `cd "/a b" && git status`, `npm test`, `echo "node --test a.test.js b.test.js"`, `git add a.js\ngit status` (a real newline in the command), `git status\t--short` (a real tab), `loop.sh`, `a-b_c.d+e 1`, `grep -n "x" f.js`, `ls \u00a0node x` (a no-break space after a blank: the first word is still `ls`), and the empty command `''`.
3. `#5794 the prefilter sends every program word to node`: for each `w` of `PROGRAM_WORDS`, the commands `` `${w} x` `` and `` `ls && ${w} x` `` are `node`.
4. `#5794 the prefilter cuts at every separator`: with `T = 'node --test tests/a.test.js tests/b.test.js'`, each of `` `ls; ${T}` ``, `` `ls && ${T}` ``, `` `ls || ${T}` ``, `` `ls | ${T}` ``, `` `ls & ${T}` ``, `` `(${T})` ``, `` `{ ${T}; }` ``, `` 'echo `' + T + '`' ``, `` `echo $(${T})` ``, `` `ls\n${T}` `` (real newline), `` `\t${T}` `` (leading real tab), `` `git commit -m "a; ${T}"` `` is `node`. And the row that pins each separator alone, with a blank on both sides so the separator is no part of a word: `` `ls ${sep} node x` `` is `node` for `sep` in `;`, `&`, `|`, `(`, `)`, `{`, `}`, a backtick and a real newline.
5. `#5794 the prefilter sends a first word it cannot read plainly to node` (under `UTF8_ENV`): for each character `c` of ``/="'$<>!~:@%*?[]#,^\`` (the last one a backslash), the command `` `x${c}y z` `` is `node`; so are `xéy z`, `ls;\u00a0node x`, `env\u00a0node x`, `./x.sh`, `/usr/bin/time ls`, `FOO=1 ls`, `"ls"`, `X=de; no$X --test a.test.js b.test.js`, `'C:\work\loop.sh'` (single backslashes in the command) and `C:/work/loop.sh`.
6. `#5794 the prefilter sends what it cannot read to node` (under `UTF8_ENV`):
   - Escapes: `grep "a\|b" f` and `ls \` (one backslash each in the command text); a carriage return, a form feed, a backspace and U+0007 in the command.
   - Shapes, as raw lines: `{"tool_name":"Bash","tool_input":{}}`; `{"tool_name":"Bash","tool_input":{"command":null}}`; `{"tool_name":"Bash","tool_input":{"command": "ls"}}` (a blank after the colon); `{"tool_name":"Bash","tool_input":{"description":"command","other":"ls"}}` (a `command` value and no `command` key); `not json`; the empty line; and `hookPayload('ls', { description: 'command' })` (a second `command` piece after the command).
   - Size cap, in bytes: with `base = Buffer.byteLength(hookPayload('ls '))`, `hookPayload('ls ' + 'a'.repeat(8192 - base))` is `skip` and `hookPayload('ls ' + 'a'.repeat(8193 - base))` is `node`; `hookPayload('ls ' + 'é'.repeat(4000))` (under 8192 characters, over 8192 bytes) is `node`.
   - Piece caps, each pair differing by one piece: with `p0 = hookPayload('ls', { description: '' }).split('"').length`, a description of `256 - p0` quote characters is `skip` and one of `257 - p0` is `node`; `'ls' + '\ta'.repeat(255)` (real tabs) is `skip` and `.repeat(256)` is `node`; `'ls;'.repeat(256)` is `skip` and `.repeat(257)` is `node`.
   - No glob expansion: with `cwd` a temp directory holding one empty file named `plainfile`, `* x` is `node`.
7. `#5794 under a shell that does not split words every call goes to node` (one test, skipped with reason `zsh not on PATH` when `findOnPath('zsh')` is null): under zsh, `git status --short && ls` is `node`.
8. Last test in the file, `#5794 AC2.1 AC2.2 AC2.3: every command a test saw denied reaches node`: the commands are `ROUND_TRIP.map(([c]) => c)` plus `[...DENIED_COMMANDS]`, deduplicated. Assert there are at least 50 (so the test cannot pass empty; state the measured count in the task report), then assert `prefilterVerdicts` returns `node` for every one, naming the command on failure. It must stay the last test so `DENIED_COMMANDS` holds every earlier test's denies; say so in a comment above it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/direct-test-run-guard.test.js`
Expected: FAIL after Step 1 — the new tests fail because `PROGRAM_WORDS` is undefined and `tools/direct-test-run-guard.sh` does not exist (the driver's `.` fails); every pre-existing test still passes.

- [ ] **Step 3: Export `PROGRAM_WORDS` and create the prefilter**

In `tools/direct-test-run-guard.js`, directly after the `PREFIX_OPTIONS` declaration, add:

```js
// Every word the classifier or the script scan reads at a program position: the node names and npx, the
// shells and `eval` (whose text is walked), `source` and `.`, and the words that move the program further
// along a segment (LEAD_KEYWORDS, PREFIX_OPTIONS, REPEATING_LEADS, find). tools/direct-test-run-guard.sh
// sends a call to node when any fragment of the command starts with one of them, and a test pins its list
// to this one. npx, eval, source, `.` and find are compared inline below: a rule keyed on a new first word
// adds the word here, and the test that runs every denied command through the prefilter fails until it does.
const PROGRAM_WORDS = Object.freeze([...new Set([
  ...NODE_NAMES, 'npx', ...SHELLS, 'eval', 'source', '.', ...LEAD_KEYWORDS, ...PREFIX_OPTIONS.keys(), ...REPEATING_LEADS.keys(), 'find',
])]);
```

Add `PROGRAM_WORDS` to `module.exports`.

Create `tools/direct-test-run-guard.sh` with exactly this content, LF line endings and no shebang line (the file is sourced, never executed):

```sh
# tools/direct-test-run-guard.sh — the prefilter in front of tools/direct-test-run-guard.js (#5794).
#
# .claude/settings.json sources this file into the hook's own shell on every Bash call:
#   d="$CLAUDE_PROJECT_DIR/tools/direct-test-run-guard"; [ -r "$d.sh" ] && command . "$d.sh"; node "$d.js"; exit 0
# It reads the hook payload and starts node only when the command could be one the guard denies.
# Every other call ends here, in the shell that was already running: no fork, no exec.
#
# When node can be skipped. The guard denies a typed direct test run, or a script that starts one,
# and both need a program word at a program position: node, npx, a shell, eval, source or `.`, a
# program named by path, or a word that moves the program further along (a keyword, a prefix
# command, xargs, parallel, find). So a call is skipped only when every fragment of the command,
# cut at every ; & | ( ) { } backtick and newline whether quoted or not, starts with a word made of
# A-Za-z0-9_.+- alone that is none of those words. A quote, $, =, /, backslash, redirection
# character or non-ASCII byte in a first word sends the call to node, and so does anything this
# file cannot read plainly: another JSON escape, a payload of another shape, or one over the caps.
# Cutting inside quotes only adds fragments, so it can add node runs and never remove one.
#
# Faults. Everything below this comment is one brace group, so the shell parses all of it before
# it runs any of it: a syntax fault anywhere (CRLF line endings, conflict markers, a cut-off file)
# is found before anything reads stdin. `command .` then returns, and the hook command's own
# `node "$d.js"` runs the guard on the untouched stdin, as the registration did before #5794. The
# hook command ends in `exit 0`, and nothing here prints.
#
# POSIX sh only: dash, bash 3.2 (macOS /bin/sh) and Git Bash run it. No [[, local, arrays, $'...'
# or ${v//...}. Claude Code passes a hook command to `sh -c` on macOS and Linux and to Git Bash on
# Windows. Each scan is one field split and a loop over at most 256 pieces, so the work is linear
# in the payload and bounded by the caps.
#
# Test seam: with DIRECT_TEST_RUN_GUARD_LIB set, sourcing this file only defines the functions.

{
# dtrg_scan <payload>: status 0 when node must judge the call, 1 when no rule of the guard can
# deny it. It changes IFS and turns globbing off; direct_test_run_guard_needs_node restores both.
dtrg_scan() {
  dtrg_payload=$1
  [ "${#dtrg_payload}" -le 8192 ] || return 0
  set -f

  # 1. The JSON text of the one "command" string, read between the payload's quotes. A piece that
  # ends in a backslash ended at an escaped quote, so the string goes on. A second `command` piece
  # anywhere is a shape this does not read. In a shell that does not split an unquoted expansion
  # the loop sees one piece and the state never reaches 3.
  IFS='"'
  dtrg_state=0
  dtrg_json=
  dtrg_n=0
  for dtrg_f in $dtrg_payload; do
    dtrg_n=$((dtrg_n + 1))
    [ "$dtrg_n" -le 256 ] || return 0
    case $dtrg_state in
      0) case $dtrg_f in command) dtrg_state=1 ;; esac ;;
      1) case $dtrg_f in :) dtrg_state=2 ;; command) ;; *) dtrg_state=0 ;; esac ;;
      2) case $dtrg_f in
           *\\) dtrg_json=$dtrg_json$dtrg_f\" ;;
           *) dtrg_json=$dtrg_json$dtrg_f; dtrg_state=3 ;;
         esac ;;
      3) case $dtrg_f in command) return 0 ;; esac ;;
    esac
  done
  [ "$dtrg_state" -eq 3 ] || return 0

  # 2. Its JSON escapes, read between backslashes: a quote, a newline and a tab are read (a tab
  # as a blank) and any other escape goes to node. An escaped backslash leaves an empty piece
  # between its two backslashes, so a backslash in the command goes to node too.
  IFS='\'
  dtrg_nl='
'
  dtrg_cmd=
  dtrg_first=1
  dtrg_n=0
  for dtrg_f in $dtrg_json; do
    dtrg_n=$((dtrg_n + 1))
    [ "$dtrg_n" -le 256 ] || return 0
    if [ -n "$dtrg_first" ]; then
      dtrg_cmd=$dtrg_f
      dtrg_first=
    else
      case $dtrg_f in
        n*) dtrg_cmd=$dtrg_cmd$dtrg_nl${dtrg_f#n} ;;
        t*) dtrg_cmd="$dtrg_cmd ${dtrg_f#t}" ;;
        \"*) dtrg_cmd=$dtrg_cmd$dtrg_f ;;
        *) return 0 ;;
      esac
    fi
  done

  # 3. The first word of every fragment.
  dtrg_seps=";&|(){}\`$dtrg_nl"
  IFS=$dtrg_seps
  dtrg_n=0
  for dtrg_f in $dtrg_cmd; do
    dtrg_n=$((dtrg_n + 1))
    [ "$dtrg_n" -le 256 ] || return 0
    IFS=' '
    set -- $dtrg_f
    IFS=$dtrg_seps
    case ${1-} in
      '') ;;
      *[!A-Za-z0-9_.+-]*) return 0 ;;
      # program-words: PROGRAM_WORDS in direct-test-run-guard.js, pinned by tests/direct-test-run-guard.test.js
      node|node.exe|npx|sh|bash|zsh|eval|source|.|do|then|else|if|elif|while|until|env|time|nice|nohup|command|exec|timeout|gtimeout|sudo|xargs|parallel|find) return 0 ;;
    esac
  done
  return 1
}

# direct_test_run_guard_needs_node <payload>: dtrg_scan under byte-wise matching, with IFS,
# globbing and LC_ALL put back, so node starts in the environment the hook was given.
direct_test_run_guard_needs_node() {
  dtrg_ifs=$IFS
  dtrg_lc_set=${LC_ALL+x}
  dtrg_lc=${LC_ALL-}
  LC_ALL=C
  dtrg_scan "$1"
  dtrg_rc=$?
  IFS=$dtrg_ifs
  set +f
  if [ -n "$dtrg_lc_set" ]; then LC_ALL=$dtrg_lc; else unset LC_ALL; fi
  return "$dtrg_rc"
}

# The hook entry. Claude Code writes one JSON line and a newline: that shape is judged, and node,
# when needed, replaces this shell and reads the line back from a here-document (no fork). When
# that exec does not happen (bash writes a here-document to a temp file, so an unwritable TMPDIR
# fails it) the line is piped to node instead. Any other stdin (no final newline, more than one
# line, nothing) goes to node byte for byte.
direct_test_run_guard_main() {
  dtrg_js=$CLAUDE_PROJECT_DIR/tools/direct-test-run-guard.js
  dtrg_stdin=
  if IFS= read -r dtrg_stdin; then
    dtrg_tail=
    if IFS= read -r dtrg_tail; then
      { printf '%s\n%s\n' "$dtrg_stdin" "$dtrg_tail"; cat; } | node "$dtrg_js"
    elif [ -n "$dtrg_tail" ]; then
      printf '%s\n%s' "$dtrg_stdin" "$dtrg_tail" | node "$dtrg_js"
    elif direct_test_run_guard_needs_node "$dtrg_stdin" && command -v node >/dev/null 2>&1; then
      command exec node "$dtrg_js" <<DTRG_EOF
$dtrg_stdin
DTRG_EOF
      printf '%s\n' "$dtrg_stdin" | node "$dtrg_js"
    fi
  else
    printf '%s' "$dtrg_stdin" | node "$dtrg_js"
  fi
  exit 0
}

[ -n "${DIRECT_TEST_RUN_GUARD_LIB-}" ] || direct_test_run_guard_main
}
```

The word list on the line after `# program-words:` holds exactly the members of `PROGRAM_WORDS`; if the array differs from this line, the array is the source and the line follows it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/direct-test-run-guard.test.js`
Expected: PASS, every test, with the dash and bash variants run (not skipped) on macOS and Linux.

- [ ] **Step 5: Commit**

Stage `tools/direct-test-run-guard.sh`, `tools/direct-test-run-guard.js` and `tests/direct-test-run-guard.test.js` by path and commit: `Add the direct-test-run guard prefilter — sh decides when node must judge a Bash call`.

---

### Task 2: Register the prefilter and prove the hook end to end

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `.claude/settings.json` (the one PreToolUse Bash hook command)
- Modify: `.gitattributes` (one line)
- Test: `tests/direct-test-run-guard.test.js`

**Interfaces:**
- Consumes: `PREFILTER`, `perPrefilterShell`, `hookPayload`, `GUARD`, `ROOT`, `withTempDir` from the test file (Task 1 and earlier).
- Produces: `HOOK_COMMAND`, the command string read from `.claude/settings.json`, and `runHook(shellFile, input, env)` in the test file.

- [ ] **Step 1: Write the failing tests**

All in `tests/direct-test-run-guard.test.js`, above the last test (`#5794 AC2.1 AC2.2 AC2.3` stays last):

```js
const HOOK_COMMAND_TEXT = 'd="$CLAUDE_PROJECT_DIR/tools/direct-test-run-guard"; [ -r "$d.sh" ] && command . "$d.sh"; node "$d.js"; exit 0';
const HOOK_COMMAND = JSON.parse(readText(path.join(ROOT, '.claude', 'settings.json'))).hooks.PreToolUse.find((e) => e.matcher === 'Bash').hooks[0].command;
// Runs the registered command the way Claude Code does: `<sh> -c <command>` with the payload on stdin.
function runHook(shellFile, input, env) {
  return spawnSync(shellFile, ['-c', HOOK_COMMAND], { input, env, timeout: 30000, killSignal: 'SIGKILL', windowsHide: true });
}
```

`input` is a Buffer or string; results are read as Buffers (`res.stdout.toString()`).

Environments, each built from a copy of `process.env` with every key matching `/^path$/i` deleted first (win32 stores the key as `Path`):
- `nodeEnv(projectDir, extra)`: `PATH` is `path.dirname(process.execPath) + path.delimiter + <the original PATH value>`, plus `CLAUDE_PROJECT_DIR: projectDir` and `extra`. `node` in the hook then is the node running the test.
- `emptyPathEnv(projectDir, extra)`: `PATH` is an empty temp directory (removed after the test), plus the same two.

A project fixture helper, `withHookProject(prefilter, guardSource, fn)`: a temp dir with a `tools/` directory, into which it writes `guardSource` as `direct-test-run-guard.js` and, unless `prefilter` is `null`, `direct-test-run-guard.sh` with those bytes. `fn` gets `{ dir, seen }`, `seen` a path inside the dir. Two guard sources, each one line:
- `RECORDER`: `const fs = require('fs'); const c = []; process.stdin.on('data', (d) => c.push(d)); process.stdin.on('end', () => fs.writeFileSync(process.env.DTRG_SEEN, Buffer.concat(c)));` — "node ran" means the `seen` file (passed as `DTRG_SEEN`) exists, and its bytes are what node read.
- `REAL_GUARD`: `require('child_process').spawnSync(process.execPath, [process.env.DTRG_REAL], { stdio: 'inherit' });` — runs the real guard (`DTRG_REAL: GUARD`) on the same stdin and stdout.

The good prefilter bytes are `fs.readFileSync(PREFILTER)` (a Buffer read, no encoding). The four faulty prefilter states are: `null` (missing); the CRLF copy (`readText(PREFILTER).replace(/\n/g, '\r\n')`, asserted to hold `\r\n` and no `\r\r\n`); a copy with the line `<<<<<<< HEAD` inserted after the line `dtrg_scan() {`; and a copy with that line inserted after the last call line (the line starting `[ -n "${DIRECT_TEST_RUN_GUARD_LIB-}" ]`), which only the brace group turns into a fault found before anything runs.

`D` below is `hookPayload('node --test tests/a.test.js tests/b.test.js')`, and `DENIED` is `hookPayload('node --test tests/direct-test-run-guard.test.js tests/run-tests-isolation.test.js')` (two files that exist in this checkout).

Tests (each `perPrefilterShell` unless it says otherwise):

1. Edit the existing `AC11.1: .claude/settings.json registers the guard for Bash and the file exists` (one test, name unchanged): its command assertion compares against `HOOK_COMMAND_TEXT` and also requires `h.timeout === 10`; add `assert.equal(fs.existsSync(PREFILTER), true)`; its other assertions stay.
2. `#5794 AC10.3: the prefilter is checked out with LF line endings` (one test): `readText(path.join(ROOT, '.gitattributes'))` holds the line `tools/direct-test-run-guard.sh text eol=lf`, and `fs.readFileSync(PREFILTER).includes(0x0d)` is `false`.
3. `#5794 AC1.1 AC1.2 AC1.3 AC1.4: the registered command prints what the node guard prints`, with `nodeEnv(ROOT)`: for the inputs `DENIED + '\n'` and `hookPayload('for f in tests/*.test.js; do node --test $f; done') + '\n'`, `runHook` exits 0 and its stdout equals, byte for byte, the stdout of `spawnSync(process.execPath, [GUARD], { input, … })`, which parses as JSON whose `hookSpecificOutput.permissionDecision` is `deny`. For `node --test tests/direct-test-run-guard.test.js`, `node tools/run-tests.js tests/direct-test-run-guard.test.js` and `git status --short && ls`, `runHook` exits 0 with empty stdout.
4. `#5794 AC3.1 AC3.2: node reads the bytes the hook received`, in `withHookProject(good, RECORDER, …)` with `nodeEnv(dir, { DTRG_SEEN: seen })`: for each input below (remove `seen` between inputs), exit status 0, empty stdout, node ran, and `fs.readFileSync(seen)` equals the input bytes. Inputs: `D + '\n'`; `D` (no final newline); `JSON.stringify(JSON.parse(D), null, 2) + '\n'`; the same without the final newline; `D + '\nextra'`; `D + '\nextra\n'`; `hookPayload('git status') + '\n\n'`; `''`; `'\n'`; `'not json\n'`; and `hookPayload('node "a b.js" c.js # æøå \u2028 \\ $HOME `id`') + '\n'`.
5. `#5794 AC4.1 AC4.2: the skip path starts nothing`: in `withHookProject(good, RECORDER, …)`, input `hookPayload('git status --short && ls') + '\n'` with `nodeEnv(dir, { DTRG_SEEN: seen })` exits 0 with empty stdout and empty stderr, and node did not run. Then with `emptyPathEnv(dir, { DTRG_SEEN: seen })` (no `node` and no `cat` to find): status 0, empty stdout, empty stderr. `shellFile` is an absolute path from `findOnPath`, so the empty PATH does not stop the spawn.
6. `#5794 AC5.1 AC5.2 AC5.3: a missing, CRLF or broken prefilter still reaches the guard`: for each of the four faulty states, (a) in `withHookProject(state, RECORDER, …)` with `nodeEnv(dir, { DTRG_SEEN: seen })`, each of the inputs `D + '\n'` and `hookPayload('git status --short && ls') + '\n'` exits 0 with empty stdout, node ran, and it read exactly the input bytes (a faulty prefilter skips nothing); (b) in `withHookProject(state, REAL_GUARD, …)` with `nodeEnv(dir, { DTRG_REAL: GUARD })`, input `DENIED + '\n'` exits 0 and stdout parses as a deny.
7. `#5794 AC5.2: with no node on PATH the hook exits 0 and prints nothing`: with `emptyPathEnv(dir, { DTRG_SEEN: seen })` and input `D + '\n'`: with the good prefilter, status 0 and empty stdout; with `prefilter` `null`, status 0 and empty stdout (stderr may name the missing node: do not assert on it).
8. `#5794 AC5.2: garbage and empty stdin print nothing`, with `nodeEnv(ROOT)` (the real guard): inputs `'not json\n'`, `''` and `'{"tool_name":"Bash"}\n'` each exit 0 with empty stdout.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/direct-test-run-guard.test.js`
Expected: FAIL after Step 1 — `AC11.1` fails (the command is still the node form), `#5794 AC10.3` fails (no `.gitattributes` line) and `#5794 AC4.1 AC4.2` fails (node runs for the harmless call); the fidelity and fault tests may pass, because the old command pipes stdin straight to node.

- [ ] **Step 3: Register the prefilter**

In `.claude/settings.json`, replace the hook object's `command` value with the Global Constraints string (JSON-escaped: every `"` inside it becomes `\"`), keeping `"type": "command"` and `"timeout": 10`. In `.gitattributes`, append:

```
# Sourced by the hook's sh on every Bash call (#5794): a CRLF checkout would be a syntax error in every line.
tools/direct-test-run-guard.sh text eol=lf
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/direct-test-run-guard.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

Stage `.claude/settings.json`, `.gitattributes` and `tests/direct-test-run-guard.test.js` by path and commit: `Register the guard prefilter — the hook sources it and falls back to node on any fault`.

---

### Task 3: Timing budget

**Role:** integration

**Files:**
- Create: `perf/direct-test-run-prefilter.test.js`

**Interfaces:**
- Consumes: `tools/direct-test-run-guard.sh` and its `DIRECT_TEST_RUN_GUARD_LIB` seam (Task 1), and the command registered in `.claude/settings.json` (Task 2). The perf file defines its own driver and payload builder; it does not require the test file (requiring a test file runs its tests).

- [ ] **Step 1: Write the budget test**

Follow `perf/hooks-prefilter.test.js` for the header comment, the `findOnPath('sh')` lookup and the `process.hrtime.bigint()` timer. One sh process per measurement: the driver is `DIRECT_TEST_RUN_GUARD_LIB=1; . "$1"; IFS= read -r l; i=0; while [ "$i" -lt "$2" ]; do direct_test_run_guard_needs_node "$l"; i=$((i + 1)); done`, run as `<sh> -c <driver> sh <prefilter path> 200` with one payload line on stdin. A measurement is the wall time of that process. Measure in 7 rounds, each round timing every payload once in turn (so a busy stretch on the machine falls on all of them), and keep each payload's minimum.

Payload lines, built with the same key set as the test file's `hookPayload` and padded to exactly 8192 bytes unless stated:
- `word`: the command `ls ` plus `a` characters. `word1k`: the same at 1024 bytes.
- `blanks`: `ls ` plus blanks.
- `fragments`: `ls ` plus `;` characters (the fragment cap).
- `quotes`: `ls ` plus `"` characters, two bytes each in the JSON (the quote-piece cap inside the command).
- `newlines`: `ls ` plus real newlines, two bytes each in the JSON (the backslash-piece cap).
- `description`: the command `ls` and a description of `"` characters (the quote-piece cap after the command).

Assertions, for `sh` and, when on PATH, `dash` (skipped by name when missing):
- `#5794 AC9.1 AC9.2: work is linear in the payload`: `word` takes under 24 times `word1k` (linear is 8; measured 2.9).
- `#5794 AC9.1 AC9.2: a worst-case payload at the caps costs under 12 times a plain payload of the same size`: each of `blanks`, `fragments`, `quotes`, `newlines` and `description` takes under 12 times `word` (measured 2.5 to 7.8 across four runs at load averages 29 to 104; with one cap removed the matching payload measured 20 to 66 times).
- `#5794 AC9.1 AC9.2: a worst-case call stays under 25 ms`: each of the six 8192-byte payloads takes under 5000 ms for its 200 calls (measured at most 12.2 ms a call; a node start measured 50 ms on the same machine).
- `#5794 AC9.2: a payload over the cap costs under 3 times the old registration` (one test per shell): in a temp project whose `tools/direct-test-run-guard.js` is the one line `process.stdin.resume();` beside a copy of the prefilter, with a 65,536-byte payload line plus a newline on stdin, the registered command (read from `.claude/settings.json` through `readText`) takes under 3 times `node "$CLAUDE_PROJECT_DIR/tools/direct-test-run-guard.js"` run through the same shell, each the minimum of 5 runs (measured 86 ms against 53 ms under sh and 65 ms against 46 ms under dash). The shell's `read` takes the line a byte at a time, so this path is linear with a larger constant than node's; the budget keeps it from growing unseen.

State in the header comment the numbers measured on the authoring machine when the file is written (shell, load average, the per-call times).

- [ ] **Step 2: Run it**

Run: `node --test perf/direct-test-run-prefilter.test.js`
Expected: PASS. Report the measured per-call times and the load average in the task report.

- [ ] **Step 3: Commit**

Stage `perf/direct-test-run-prefilter.test.js` by path and commit: `Budget the guard prefilter's worst cases — linear in the payload, bounded at the caps`.

---

### Task 4: Docs

**Role:** transcription

**Files:**
- Modify: `docs/hooks.md` (the bullet that starts "This repository also registers one repo-local hook outside this dispatcher")
- Modify: `docs/plugin-structure.md` (the `direct-test-run-guard.js` entry in the `tools/` tree, about line 155)
- Modify: `docs/journeys/run-several-test-files-through-the-runner-5547.md` (frontmatter `files:` and Step 1's second "Should understand" bullet)

- [ ] **Step 1: Edit the three files**

`docs/hooks.md`: replace that bullet with:

```markdown
- This repository also registers one repo-local hook outside this dispatcher, in `.claude/settings.json`: `tools/direct-test-run-guard.js` (#5547), a maintainer-side PreToolUse guard for direct multi-file test runs, behind `tools/direct-test-run-guard.sh` (#5794), a POSIX sh prefilter the hook command sources into its own shell. The prefilter starts node only when a fragment of the command starts with a program word the guard reads or with a word it cannot read plainly; any other call ends in the shell. A missing or broken prefilter falls through to the node guard. Neither file is part of the plugin payload or of this contract.
```

`docs/plugin-structure.md`: directly after the `direct-test-run-guard.js (…)` entry, add an entry in the same style and indentation:

```
direct-test-run-guard.sh (#5794 — the POSIX sh prefilter the hook command in `.claude/settings.json` sources into its own shell before the guard above: it reads the payload line and ends the hook with no process started unless a fragment of the command, cut at every `;`, `&`, `|`, parenthesis, brace, backtick and newline, starts with one of the guard's `PROGRAM_WORDS` or with a word holding anything but `A-Za-z0-9_.+-`; every other input, a payload over 8192 bytes or with more than 256 pieces in one scan included, is handed to the node guard with stdin unchanged; a missing or broken copy falls through to the node guard; tests in tests/direct-test-run-guard.test.js, timing in perf/direct-test-run-prefilter.test.js),
```

Match the neighbouring entries' trailing punctuation (read the lines around 155 first).

Journey: add `  - tools/direct-test-run-guard.sh` to the frontmatter `files:` list after the `.js` line, and replace the bullet "The hook still ran. `.claude/settings.json` registers `tools/direct-test-run-guard.js` for every Bash call; it costs one short node start and exits 0 on every path." with:

```markdown
  - The hook still ran. `.claude/settings.json` registers the guard for every Bash call, behind a sh prefilter (`tools/direct-test-run-guard.sh`): a call that names node, as this one does, costs one short node start, a call whose fragments all start with a plain command name (`ls`, `git status`) ends in the hook's own shell, and every path exits 0.
```

- [ ] **Step 2: Run the suites that read these files**

Run: `node tools/run-tests.js tests/direct-test-run-guard.test.js tests/plan-citations-resolve.test.js`
Expected: PASS (the guard test's AC12.1 reads every journey for a direct test command).

- [ ] **Step 3: Commit**

Stage the three files by path and commit: `Describe the guard prefilter — hooks, structure and journey docs`.

---

## Verification evidence (controller, after Task 4; scratch code, results recorded)

Each result is written in full to `$PIPELINE_RUN_DIR/evidence/{name}.txt` and summarised in one `decisions.md` entry (`log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file …`) naming the criterion, the command shape and the counts. The scripts stay uncommitted.

1. **AC6.2 mutants** (`evidence/mutants.txt`): in a `git archive` extract of HEAD, one mutant at a time on `tools/direct-test-run-guard.sh`, each followed by `node --test tests/direct-test-run-guard.test.js` in the extract; every mutant must turn at least one test red: drop each separator from `dtrg_seps` in turn (9); drop `node|`, `|find`, `|until` and `|.` from the word list; delete the `*[!A-Za-z0-9_.+-]*` line; delete the `n*`, `t*` and `\"*` branches in turn, turn `n*` into a blank, and turn the `*) return 0` escape branch into an append; delete the 8192 cap and each of the three 256 caps; delete `set -f`; delete the state-3 `command) return 0` branch, the state check, and the state-1 reset; delete `LC_ALL=C` (red under bash 3.2 as `/bin/sh` with a UTF-8 locale installed; dash and bash 5 match bytes without it, so on a host whose `sh` is dash this one is reported as not provable there). Each of the three 256 caps is also removed for a run of `perf/direct-test-run-prefilter.test.js` in the extract, which must fail on the matching payload. Remove the brace group's two lines (red on the marker-after-the-call-line state). Delete the pipe line after the here-document: expected to survive, and reported as unproven (Global Constraints say why).
2. **AC7.1 to AC7.4 replay** (`evidence/replay.txt`): every Bash command in the local transcript stores for this repository, each judged by `judgeOrThrow` with the real file system and by five widened oracles (typed deny with every operand a directory, with none, under win32 path rules; script scan with every script read as one that starts a test run, under POSIX and win32 rules), against the committed prefilter's verdict under `/bin/sh`, `/bin/dash` and bash 5. Report files, calls, distinct commands, denies and throws per oracle, commands the prefilter skipped that any oracle denies (must be 0), the share of calls that skip node, and the independent count of commands matching a plain `node … --test` regex with each of those the prefilter skipped listed.
3. **AC8.1 to AC8.4 cost** (`evidence/cost.txt`): CPU per call from `resource.getrusage(RUSAGE_CHILDREN)` over at least 30 runs each, old command and new command, for `git status --short && ls` and for `node --test tests/a.test.js tests/b.test.js`, with the bare `sh -c :` cost and the load average of the same run.
4. **AC10.4 Windows** (`evidence/windows.txt`): a `windows-regression.yml` dispatch on the branch after the last code change; the run URL, the comparison base it printed, and the failing-file list.
