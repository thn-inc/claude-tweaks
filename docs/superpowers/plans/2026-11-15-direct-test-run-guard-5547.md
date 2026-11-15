# Direct Test Run Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tools/run-tests.js` a drop-in for a direct `node --test <flags> <files>`, and add a repo-local PreToolUse guard that denies multi-file, looped and script-spawned direct test runs and names the runner command to use instead.

**Architecture:** Two maintainer-side pieces and one docs sweep; nothing under `plugin/` changes. The runner gains an operand parser (test files, node test flags) that feeds its existing subset path. The guard is one new file, `tools/direct-test-run-guard.js`: a pure classifier built on the plugin's existing shell scanner, a script scan, and a hook entry registered in `.claude/settings.json`. A conformance test then runs the classifier over the repo's own documented commands, so guidance cannot drift back to a denied form.

**Tech Stack:** Node (CI runs Node 20; the local machine runs 26.13.1), `node:test`, `node:assert`. No new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T222337-spec-5547/work/5547-spec.md` (record #5547). Acceptance criteria are cited as `AC{item}.{clause}`.

## Global Constraints

- No file under `plugin/` changes (AC14.1). The guard `require`s `plugin/bin/lib/hooks/git-command.js` from its own checkout (`path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'git-command.js')`), the way `tools/run-tests.js` requires `../plugin/bin/lib/suite-slot`.
- No test-concurrency default, slot count or slot-lane rule is lowered or added (AC14.1, AC5.2). `resolveConcurrency`, `resolveSlots` and `slotLane` keep their results for every existing input.
- `CLAUDE.md` is at exactly 150 lines and must stay at 150 or fewer (AC13.1). This plan edits no line of it.
- Commit message style: `{Verb} {what} — {detail}, refs #5547`, imperative, no conventional-commit prefix. Every commit message ends with the line `Claude-Session: https://claude.ai/code/session_01Ngy9oWebZDKZcjphy4K2Sc`.
- Run tests one file at a time with `node --test <file>` while iterating. Never run two or more test files in one direct `node --test`, and never loop over test files: that is the bypass this change removes.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Project maturity is `established`: "For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them." Task 1 changes how `tools/run-tests.js` reads its arguments; AC6 is that characterization.

Rules quoted verbatim from the project skills that govern the files this plan touches:

- `.claude/skills/suite-slot-test-env` (tests that spawn `tools/run-tests.js`): "`withSandbox` in `tests/run-tests-isolation.test.js` predates the helper and strips the same keys inline for `tools/run-tests.js` children." and "A test that waits on a slot-holding child bounds it with the spawn's own `timeout` and `killSignal: 'SIGKILL'` (`spawnVerifyWithScript` in `cli.test.js`), so a stuck child becomes a failed assertion, never a stuck suite. Never assert a wall-clock budget to catch a hang: under bounded test concurrency and sibling sessions, elapsed time tracks machine load, not the code."
- `.claude/skills/git-ground-truth-test-env` (the AC1.2 environment assertions): "Prove both under the runner. Run `node tools/run-tests.js --files-from <list>`, never only a bare `node --test`: the runner's env is part of the test's input."
- `.claude/skills/windows-checkout-test-parity` (every new function with OS-dependent path handling): "Put the platform translation in a function whose OS inputs are arguments", because "`process.platform` is process-global, so a stub leaks into every other test in the same worker", and "Take the module itself as a parameter, defaulting to the platform-native one, and let the two OS-independent namespaces stand in for the real platforms on any host, including ubuntu-only CI". Also: "A shape assertion (`startsWith('"')`, `includes('engine-probe')`) stays green when an escaping pass is dropped. Pin the whole output, with one input per rule."
- `.claude/skills/skill-prose-conformance-tests` (Task 4's docs conformance test): "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`." and "Prove the assertion can go red before trusting its green". `tests/raw-markdown-read-conformance.test.js` enforces the first rule on every `tests/**/*.test.js` file.
- `.claude/skills/node-test-output-evidence` (the runner now hands caller-typed paths to `node --test`): "A caller that runs `node --test` on a path it does not control refuses, before it spawns, every character that makes a path match anything but itself: `[ ] { } ( ) ! + @`, plus `*`, `?` and `\`." Task 1 applies this to file operands, except `\`, which is the native separator in a Windows operand.
- `.claude/skills/shell-scanner-bash-differential` and `.claude/skills/pre-tool-use-gate-exemptions` govern changes to `plugin/bin/lib/hooks/git-command.js` and to the plugin's own gates. This plan edits neither; it only adds a consumer outside `plugin/`, so none of their rules apply beyond the one command line Task 4 rewrites in the first.

Facts established while planning (2026-11-15), which tasks rely on:

- Live probe of a project PreToolUse hook under two headless `claude -p` runs in a scratch repo: `$CLAUDE_PROJECT_DIR` was the repo root when launched there and the linked worktree when launched inside one; both held the hook script. The stdin payload had the keys `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort`, `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`. Printing `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` on stdout with exit 0 blocked the call and the reason reached the model. Not observed, documentation only: after `EnterWorktree` the variable stays at the project root where the session started, and a running session's file watcher normally picks up a changed settings file.
- `plugin/bin/lib/hooks/git-command.js`'s `forEachCommandSegment(command, cwd, handler)` calls `handler(tokens, effectiveCwd, quoting, again)` once per command segment. Probed outputs: `for f in a b; do node --test "$f"; done` gives segments `["for","f","in","a","b"]`, `["do","node","--test","$f"]`, `["done"]`; `cd evals && node --test tests/` gives the node segment an effective cwd of `<cwd>/evals`; `F=tests/a.test.js; node --test "$F"` gives `["node","--test","tests/a.test.js"]` (assignments are substituted); `sh -c "node --test a b"` gives `["sh","-c","node --test a b"]` (the inner text is one token); `FOO=1 /opt/homebrew/bin/node --test tests/*.test.js | tail -5` gives `["FOO=1","/opt/homebrew/bin/node","--test","tests/*.test.js"]` then `["tail","-5"]`; `find tests -name "*.test.js" -exec node --test {} \;` gives one segment led by `find`; `ls x | xargs -n1 node --test` gives `["xargs","-n1","node","--test"]`; `node --test $(git diff --name-only main)` gives `["node","--test","$(git","diff","--name-only","main)"]`.
- `node --help` on Node 26.13.1 marks these test flags as taking a value: `--experimental-test-tag-filter`, `--experimental-test-isolation`, `--test-concurrency`, `--test-coverage-branches`, `--test-coverage-exclude`, `--test-coverage-functions`, `--test-coverage-include`, `--test-coverage-lines`, `--test-global-setup`, `--test-isolation`, `--test-name-pattern`, `--test-random-seed`, `--test-reporter`, `--test-reporter-destination`, `--test-rerun-failures`, `--test-shard`, `--test-skip-pattern`, `--test-timeout`. Node 20's list is a subset.
- `node tools/run-tests.js tests/hooks-bash-prefilter.test.js` on the base commit dies with an uncaught `ENOTDIR` (`tools/run-tests.js:90`).
- No test and no file under `plugin/` pins the command lines Task 4 rewrites (`git grep -F` for six of them over `tests plugin` returned nothing).

## Review Focus

1. A file operand typed from a subdirectory, or as an absolute path: both must reach the same repo-relative file (Task 1, AC1.1 tests).
2. A file operand holding a glob metacharacter that survived the shell (`'tests/[ab].test.js'`): Node 21+ would run whatever the pattern matches. The runner must refuse it before spawning (Task 1 test `refuses a file operand holding a glob metacharacter`).
3. A Bash command that only mentions a test run as data: `git commit -m "run node --test a.test.js b.test.js"`, `echo "node --test a b"`, `git grep -n "node --test"`. The guard must allow all three (Task 2 allow rows).
4. A script the agent corrected: once `mutant-run.js` spawns `tools/run-tests.js` with `--test-reporter=tap`, the scan must allow it even though the text still contains `--test-reporter=tap` and `child_process` (Task 3, AC8.1).
5. A relative `--test-reporter-destination` typed from a subdirectory: the child's working directory is the checkout root, so the path is read from there. The runner passes the flag unchanged and its header comment says so (Task 1 test `passes node test flags through unchanged`).

---

### Task 1: Runner accepts test-file operands and node test flags

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/run-tests.js`
- Test: `tests/run-tests-isolation.test.js`
- Modify: `tests/run-tests-shard.test.js` (only if a pinned `extractRunFlags` result changes; it must not)
- Modify: `tests/run-tests-default-run.test.js` (only if a pinned `resolveRunMode` result changes; it must not)

**Interfaces:**
- Consumes: the file's existing `readFileList`, `listTestFiles`, `buildTestArgs`, `resolveConcurrency`, `subsetFallbackReason`, `slotLane`, `extractRunFlags`, `resolveRunMode`.
- Produces (all exported from `tools/run-tests.js`):
  - `NODE_TEST_VALUE_FLAGS`: a frozen array of exactly the 18 flag names listed under "Facts established while planning". Task 2 imports it.
  - `parseRunnerOperands(rest, { cwd, repoRoot, isFile, pathImpl = path })` returning `{ roots: string[], files: string[], filesFrom: string|null, nodeFlags: string[], concurrency: number|null }`. `rest` is `extractRunFlags(...).rest`. `isFile(absPath)` returns a boolean. `files` are repo-relative, in typed order, deduplicated. `nodeFlags` are normalized to `--flag=value` (a value flag typed in space form is joined) and never contain `--test-concurrency`. Throws an `Error` whose message is the text after `run-tests.js: ` for every refusal below. Pure apart from `isFile`.
  - `buildTestArgs(files, roots, { platform, nodeMajor, concurrency, nodeFlags = [] })`: `nodeFlags` follow `--test-concurrency=<n>` and precede the files or globs.

Decisions the implementer cannot make alone:

- **Operand classes.** A dash argument starting with `--test-` or `--experimental-test-` is a node flag. `--files-from <list>` keeps its meaning. Any other dash argument throws `unknown option <arg>`. A non-dash operand ending in `.test.js` is a file. Any other non-dash operand that `isFile` finds as a regular file (resolved against `cwd`, then against `repoRoot`) throws `<operand> is not a *.test.js file`; today that input dies with an uncaught `ENOTDIR`. Every remaining non-dash operand is a directory root, handled exactly as today (resolved against the repo root, a missing root tolerated as today).
- **File operands** resolve against `cwd`, then relativize against `repoRoot`. Refusals, each naming the operand as typed: resolves outside the checkout; does not exist (`isFile` false); holds one of `[ ] { } ( ) ! + @ * ?`. A relative and an absolute spelling of one file are one entry.
- **Combinations.** File operands with directory roots, with `--files-from`, or (checked in `main`, beside the existing `--files-from` checks) with `--shard`, `--record-durations` or `--full`, exit 1 with one `run-tests.js:` line. Node flags combine with roots, with `--files-from` and with file operands. `--files-from` still takes exactly one list and no roots; its existing error text is unchanged.
- **Subset path.** A run with file operands sets `roots = null` and `files` to the parsed list, so it takes `slotLane(slotBase, true)` and the existing subset handling, including the win32 overflow fallback. In that fallback's stderr line, a file-operand run is named `the <n> named test files` where a `--files-from` run says `--files-from <list>`.
- **Concurrency.** `--test-concurrency=<n>` with a positive integer overrides `resolveConcurrency`'s result for this run (it wins over `CT_TEST_CONCURRENCY`). Any other value throws `--test-concurrency needs a positive integer`. The child receives exactly one `--test-concurrency` argument.
- **`subsetFallbackReason`'s file count** currently assumes `args.length - 2`. With node flags present, count the arguments that do not start with `-` instead; the existing pinned messages stay byte-identical.
- **`resolveRunMode` and `extractRunFlags` keep their signatures and results.** Any non-empty `rest` still means no impact selection.
- **Header comment.** Extend the file's header to document the file-operand form, the flag pass-through, that the child's working directory is the checkout root (so a relative path inside a flag value is read from there), and that a checkout older than this change needs `--files-from <list>`.

- [ ] **Step 1: Write the failing tests** in `tests/run-tests-isolation.test.js`, using the file's own `withSandbox`, `copyRunner` and fixtures (`tests/fixtures/run-tests/tmpdir-probe.fixture.js`, `fail-probe.fixture.js`), in the layout the existing `--files-from` test builds (`<sandbox>/repo root/tools/run-tests.js`, fixtures under `<sandbox>/repo root/tests/`).

Unit tests over `parseRunnerOperands` (inject `isFile`; pass `pathImpl: path.posix` and again `path.win32` for the path cases):

| Test name | Input `rest` | Expected |
|---|---|---|
| `AC1.1 AC1.2: file operands become a repo-relative subset, relative or absolute, from the root or a subdirectory` | `['tests/a.test.js', '<root>/tests/b.test.js']` with `cwd` = root; `['a.test.js']` with `cwd` = `<root>/tests`; the same file typed both ways | `files` `['tests/a.test.js','tests/b.test.js']`; `['tests/a.test.js']`; one entry |
| `AC2.2: a value flag in space form takes the next argument, never as an operand` | `['--test-name-pattern', 'x', 'tests/a.test.js']` | `nodeFlags` `['--test-name-pattern=x']`, `files` `['tests/a.test.js']` |
| `passes node test flags through unchanged` | `['--test-reporter=tap', '--test-reporter-destination=out/r.tap', '--test-only', '--experimental-test-coverage', 'tests/a.test.js']` | `nodeFlags` equal to the four flags, in order |
| `AC5.1: --test-concurrency is taken out of the flags and returned as a number` | `['--test-concurrency=3', 'tests/a.test.js']`; `['--test-concurrency', '3']` | `concurrency` `3`, `nodeFlags` `[]` |
| `--test-concurrency refuses a value that is not a positive integer` | `['--test-concurrency=0']`, `=abc`, `=2.5` | throws `/--test-concurrency needs a positive integer/` |
| `AC4.1 AC4.2 AC4.3 AC4.4 AC4.5 AC4.6: refuses a missing file, a file outside the checkout, an existing file that is not a test file, files mixed with a root or with --files-from, and an unknown option` | `['tests/missing.test.js']`; `['../other/x.test.js']`; `['tests/helpers/util.js']` (with `isFile` true for it); `['tests', 'tests/a.test.js']`; `['--files-from', 'l.txt', 'tests/a.test.js']`; `['--watch', 'tests/a.test.js']` | each throws, the message naming the operand or option as typed |
| `refuses a file operand holding a glob metacharacter` | `['tests/[ab].test.js']`, and one input per character of `[ ] { } ( ) ! + @ * ?` | each throws naming the operand |
| `AC6.1: directory roots and --files-from parse as before` | `[]`; `['perf']`; `['tests', 'tools/upstream-drift/tests']`; `['--files-from', 'l.txt']`; `['perf', '--test-reporter=tap']` | `roots`/`filesFrom` as typed, `files` `[]`, no throw |

Unit tests over the other changed helpers:

- `AC5.1: buildTestArgs places node flags after --test-concurrency and before the files`: `buildTestArgs(['a.test.js'], null, { platform: 'linux', nodeMajor: 20, concurrency: 3, nodeFlags: ['--test-reporter=tap'] })` deep-equals `['--test', '--test-concurrency=3', '--test-reporter=tap', 'a.test.js']`; with `nodeFlags` omitted the result equals today's.
- `AC5.2: resolveConcurrency results are unchanged`: re-assert `resolveConcurrency({}, 12) === 6`, `resolveConcurrency({ CI: 'true' }, 12) === 11`, `resolveConcurrency({ CT_TEST_CONCURRENCY: '3' }, 12) === 3`.
- `subsetFallbackReason counts files, not flags`: on `win32` with 400 long file arguments plus `--test-reporter=tap`, the message still says `a 400-file subset`.
- `NODE_TEST_VALUE_FLAGS is the 18 value-taking node test flags`: deep-equal to the sorted list from "Facts established while planning".

Process-level tests (real child over a copied runner, `timeout` and `killSignal: 'SIGKILL'` on every spawn):

- `AC1.1 AC1.2 AC1.3 AC3.1: file operands run exactly those files on the subset lane with the runner's environment`. Two probe fixtures as `tests/one.test.js` and `tests/two.test.js`, a failing fixture as `tests/unlisted.test.js`. Hold the base lane's only slot with a live lock for this process's pid (the pattern in `a --files-from subset does not wait behind a held full-suite slot`), then run `[runner, 'tests/one.test.js', path.join(root, 'tests', 'two.test.js')]` from `cwd: root`. Assert exit 0, `tests 2` in stdout, and from the probe's output file: `TMPDIR` under a `ct-test-runs` directory, `CT_TEST_SUITE_SLOT_HELD === '1'`, and `maintenance.auto=false` plus `gc.auto=0` among the `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` pairs (extend the probe fixture to record those pairs if it does not already; the existing `gives the suite maintenance-off git config` test shows how they are read). Run it a second time from `cwd: path.join(root, 'tests')` with operands `['one.test.js', 'two.test.js']` and assert the same two tests ran.
- `AC2.1: --test-reporter=tap puts node's TAP on stdout with no runner line in it`. Run `[runner, '--test-reporter=tap', 'tests/one.test.js']`; assert stdout starts with `TAP version 13`, contains `# pass 1`, and has no line starting `run-tests.js:`.
- `AC4.1 AC4.2 AC4.3 AC4.4 AC4.5 AC4.6: argument errors exit 1 with one run-tests.js line and start no test run`. For each of: a missing file operand; a file outside the checkout; an existing `tests/helper.js` that is not a test file; `tests/one.test.js` with root `tests`; `tests/one.test.js` with `--files-from <list>`, with `--shard 1/2`, with `--record-durations out.json`, with `--full`; `--watch tests/one.test.js`. Assert status 1, exactly one stderr line matching `/^run-tests\.js: /`, and no `tests \d` in stdout.
- `AC5.1: --test-concurrency=3 reaches the child and wins over CT_TEST_CONCURRENCY`. Run with `CT_TEST_CONCURRENCY=5` in the env and `--test-concurrency=3 tests/one.test.js`; have the probe fixture record `process.execArgv` (extend it if needed) and assert it contains `--test-concurrency=3` and no other `--test-concurrency`.
- `AC6.1 AC6.2: a directory root, --files-from, --full and --shard still run as before`. One run each of `[runner, 'tests']` (all three fixtures run, exit 1 from the failing one), `[runner, '--files-from', list]` (two tests, exit 0), `[runner, '--full']` and `[runner, '--shard', '1/1']` (both take the whole-suite path; the copied layout has no verify modules, as in the existing AC3.7 test). The bare `npm test` and `--record-durations` paths are covered unmodified by the existing `AC3.7` test in this file and by `tests/run-tests-shard.test.js`.

Guard-branch discrimination: every refusal row above uses an input on which only that refusal decides (the missing file is inside the checkout and has no glob character; the outside file exists; the non-test file exists and sits inside the checkout; the glob operand exists as a literal file in the fixture tree). Deleting any one refusal must turn its row red.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/run-tests-isolation.test.js`
Expected: FAIL after Step 1 (`parseRunnerOperands is not a function`, `NODE_TEST_VALUE_FLAGS` undefined, and the process-level file-operand tests exit with `ENOTDIR`)

- [ ] **Step 3: Implement** `NODE_TEST_VALUE_FLAGS`, `parseRunnerOperands`, the `buildTestArgs` and `subsetFallbackReason` changes, the `main` wiring and the header comment in `tools/run-tests.js`, per the decisions above. Keep `main`'s existing `--files-from` branch and its messages; route file operands into the same `roots = null` path.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/run-tests-isolation.test.js`
Expected: PASS, 0 failures. Then, one file at a time: `node --test tests/run-tests-shard.test.js`, `node --test tests/run-tests-default-run.test.js`, `node --test tests/package-json-test-script.test.js`, `node --test tests/count-node-procs.test.js`. Expected: PASS for each, with no edit to their existing assertions (AC6.2).

- [ ] **Step 5: Commit**

```bash
git add tools/run-tests.js tests/run-tests-isolation.test.js tests/fixtures/run-tests
git commit -m "Accept test-file operands and node test flags in run-tests.js — a drop-in for a direct node --test, refs #5547" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oWebZDKZcjphy4K2Sc"
```

---

### Task 2: Guard classifier for typed commands

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `tools/direct-test-run-guard.js`
- Test: `tests/direct-test-run-guard.test.js`
- Waived `plugin/bin/lib/hooks/git-command.js`: required by the guard for `forEachCommandSegment`, read in Step 3, never changed.

**Interfaces:**
- Consumes: `NODE_TEST_VALUE_FLAGS` and `parseRunnerOperands` from `tools/run-tests.js` (Task 1); `forEachCommandSegment` from `plugin/bin/lib/hooks/git-command.js` (probed shapes under "Facts established while planning").
- Produces (exported from `tools/direct-test-run-guard.js`):
  - `classifyCommand(command, { cwd, hasRunner, isDirectory, pathImpl = path })` returning `{ decision: 'allow' }` or `{ decision: 'deny', kind: 'typed', reason: string, replacement: string }`. `hasRunner(dir)` says whether `tools/run-tests.js` exists in `dir` or an ancestor and returns that checkout root or `null`; `isDirectory(absPath)` returns a boolean. No other I/O. Never throws: any internal error returns `{ decision: 'allow' }`.
  - `hasDirectTestRun(text, { cwd, pathImpl = path })` returning a boolean: true when any command segment of `text` (wrappers included) is a direct test run as defined below, a single-file one included. `classifyCommand` is built on the same detection. Task 3's shell-script scan uses it.
  - `SAFEGUARDS_TEXT`: the one sentence naming the four safeguards, shared with Task 3's reason.

Decisions the implementer cannot make alone:

- **Direct test run.** In a segment's tokens, skip leading `NAME=value` assignments and a leading `do`, `then` or `else`. The program is a direct test run when it is `node` (the token's basename is `node` or `node.exe`), or `npx` followed, after its own options, by `node@<anything>`; and either `--test` appears among the node options before the first script operand, or the first script operand ends in `.test.js`. Node options before the script are read with `NODE_TEST_VALUE_FLAGS` plus `-r`, `--require`, `--import` and `--loader` as value-taking in space form, so a flag value is never counted as a file. Inside a `for` loop, a `node` program whose first script operand is that loop's variable (`$f`, `"$f"` or `${f}`) is also a direct test run when any word of the loop's word list ends in `.test.js`: the scanner leaves a loop variable unsubstituted, so this is the only way `for f in tests/*.test.js; do node "$f"; done` is seen. A loop-variable script in a `for` loop whose word list holds no `.test.js` word, or in a `while`/`until` loop with no `--test`, is not a direct test run (the files cannot be known).
- **File operands** are the non-option tokens after `--test` (for the `--test` form), or the single script token (for the `node x.test.js` form).
- **Deny when** a direct test run has two or more file operands; or an operand holds one of `* ? [ {`; or an operand holds `$` or a backtick (an expansion the scanner could not resolve); or an operand resolves to a directory or ends in `/`; or the `--test` form has no file operand; or the direct test run is repeated. Repeated means: its segment lies inside a loop, that is after a segment starting with `for`, `while` or `until` and before that loop's own `done` segment (nesting counted); or the segment is led by `xargs`, `parallel`, or `find` with `-exec`/`-execdir`/`-ok` before the `node` token. A direct test run after a loop has closed is not repeated.
- **Wrappers.** A wrapper is `sh`, `bash` or `zsh` followed by `-c`, as the segment's own program or as the command an `xargs`, `parallel` or `find -exec` segment runs. Classify the token after `-c` recursively with the same options, plus a `repeated` flag that is true when the wrapper's segment is itself repeated (inside a loop, or led by `xargs`, `parallel` or `find -exec`). With the flag set, any direct test run in the inner text denies, a single-file one included. Depth limit 3; deeper allows. A deny from inside a wrapper is returned as is.
- **Allow when** none of the above denies; when the segment's effective cwd or any operand resolves under `<checkout>/evals`; or when `hasRunner(effectiveCwd)` is `null`.
- **Replacement line.** The denied segment's own text from its first token to its last, with the node program and `--test` replaced by `node <rel>` where `<rel>` is the path from the segment's effective cwd to `<checkout>/tools/run-tests.js` (`tools/run-tests.js` at the root), leading assignments kept, every other token kept in order and re-quoted only where the original was quoted. An unresolved expansion is kept as typed (`node --test $(git diff --name-only main)` gives `node tools/run-tests.js $(git diff --name-only main)`). Inside a `for` loop, a loop-variable operand is replaced by the loop's word list when every word is literal or a glob (no `$`, no backtick), with the body's other tokens kept. For `while`/`until` loops over a variable, `xargs`/`find` forms, and a `for` loop whose word list holds an expansion, the replacement is the fixed text `node <rel> <the test files this loop runs>`.
- **Directory prefix (decided by the user at plan review).** When the denied segment's effective cwd differs from the Bash call's cwd, the replacement line starts with `cd <dir> && `, where `<dir>` is the effective cwd relative to the call's cwd, double-quoted when it holds a space. The line then runs as pasted from the call's own directory.
- **Reason text** (exact; `{replacement}` on its own line):

```
This repository's guard blocked a direct test run. {SAFEGUARDS_TEXT}
Run the same files through the runner, which takes the same files and node test flags:

{replacement}

In a checkout older than this guard, write the files to a list and use: node tools/run-tests.js --files-from <list>
A single test file outside a loop can still be run directly.
```

`SAFEGUARDS_TEXT` is: `A direct node --test over several files, or in a loop, skips what tools/run-tests.js gives a run: git auto-maintenance off for fixture repos, a per-run TMPDIR removed on exit, the machine-wide suite slot, and bounded file concurrency.`

When the deny came from an unresolved expansion (an operand holding `$` or a backtick), the reason carries one more line, directly above the `In a checkout older than this guard` line (decided by the user at plan review): `The runner takes *.test.js files only and refuses anything else the expansion names, so make it name test files only.`

- [ ] **Step 1: Write the failing tests** in a new `tests/direct-test-run-guard.test.js`. Use `cwd: '/repo'`, `hasRunner: (d) => (d === '/repo' || d.startsWith('/repo/') ? '/repo' : null)`, `isDirectory: (p) => p === '/repo/tests' || p === '/repo/evals/tests'`, `pathImpl: path.posix`.

`AC7.1 AC7.2: the classifier is pure and pins these verdicts` — one assertion per row, the row's command in the failure message:

| Command | Verdict |
|---|---|
| `node --test tests/a.test.js` | allow |
| `node tests/a.test.js` | allow |
| `node --test --test-name-pattern foo tests/a.test.js` | allow |
| `node --test --test-reporter tap tests/a.test.js` | allow |
| `F=tests/a.test.js; node --test "$F"` | allow |
| `node tools/run-tests.js tests/a.test.js tests/b.test.js` | allow |
| `node scripts/x.js --test` | allow |
| `cd evals && node --test tests/` | allow |
| `node --test evals/tests/a.test.js evals/tests/b.test.js` | allow |
| `git commit -m "run node --test a.test.js b.test.js"` | allow |
| `echo "node --test a.test.js b.test.js"` | allow |
| `git grep -n "node --test" -- docs` | allow |
| `for f in a b; do :; done && node --test tests/a.test.js` | allow |
| `for f in scripts/a.js scripts/b.js; do node "$f"; done` | allow |
| `while read f; do node "$f"; done < list.txt` | allow |
| `node --test "$TEST_FILE"` | deny |
| `for i in 1 2 3; do node --test tests/a.test.js; done` | deny |
| `for i in 1 2 3; do sh -c "node --test tests/a.test.js"; done` | deny |
| `seq 3 \| xargs -n1 sh -c 'node --test tests/a.test.js'` | deny |
| `node --test tests/a.test.js tests/b.test.js` | deny |
| `node --test --test-reporter=tap tests/bin-lib/verify/*.test.js` | deny |
| `node --test` | deny |
| `node --test tests/` | deny |
| `node --test tests` | deny |
| `node --test $(git diff --name-only main)` | deny |
| `FOO=1 /opt/homebrew/bin/node --test tests/a.test.js tests/b.test.js \| tail -5` | deny |
| `npx -y node@20 --test tests/a.test.js tests/b.test.js` | deny |
| `for f in tests/a.test.js tests/b.test.js; do node --test "$f"; done` | deny |
| `for f in tests/*.test.js; do node "$f"; done` | deny |
| `while read f; do node --test "$f"; done < list.txt` | deny |
| `ls tests/*.test.js \| xargs -n1 node --test` | deny |
| `find tests -name "*.test.js" -exec node --test {} \;` | deny |
| `sh -c "node --test tests/a.test.js tests/b.test.js"` | deny |

Further tests:

- `allows everything when no runner is above the working directory`: the first deny row with `hasRunner: () => null` allows.
- `never throws`: `classifyCommand` with `command` `undefined`, `''`, a 200,000-character string of `(`, and with `hasRunner` throwing, each returns `{ decision: 'allow' }`.
- `the replacement keeps flags, files, assignments and the rest of the pipeline out`: exact-string pins (whole output, one input per rule):
  - `node --test tests/a.test.js tests/b.test.js` gives `node tools/run-tests.js tests/a.test.js tests/b.test.js`
  - `node --test --test-reporter=tap tests/bin-lib/verify/*.test.js` gives `node tools/run-tests.js --test-reporter=tap tests/bin-lib/verify/*.test.js`
  - `FOO=1 /opt/homebrew/bin/node --test tests/a.test.js tests/b.test.js | tail -5` gives `FOO=1 node tools/run-tests.js tests/a.test.js tests/b.test.js`
  - `cd tests && node --test a.test.js b.test.js` gives `cd tests && node ../tools/run-tests.js a.test.js b.test.js`
  - `node --test $(git diff --name-only main)` gives `node tools/run-tests.js $(git diff --name-only main)`
  - `for f in tests/*.test.js; do node "$f"; done` gives `node tools/run-tests.js tests/*.test.js`
  - `for i in 1 2 3; do node --test tests/a.test.js; done` gives `node tools/run-tests.js tests/a.test.js`
  - `npx -y node@20 --test tests/a.test.js tests/b.test.js` gives `npx -y node@20 tools/run-tests.js tests/a.test.js tests/b.test.js`
  - `for f in tests/a.test.js tests/b.test.js; do node --test "$f"; done` gives `node tools/run-tests.js tests/a.test.js tests/b.test.js`
  - `node --test "tests/my file.test.js" tests/b.test.js` gives `node tools/run-tests.js "tests/my file.test.js" tests/b.test.js`
- `the reason names the four safeguards, the replacement on its own line, --files-from, and the single-file allowance`: for the first deny row, assert the full reason string equals the template above with that row's replacement.
- `AC9.1 AC9.2: every replacement line is allowed by the classifier and accepted by the runner's parser`: for each deny row whose replacement is a concrete command (every deny row except the `while read`, `xargs` and `find` rows, whose replacement is the fixed placeholder text), assert `classifyCommand(replacement, opts).decision === 'allow'`, then tokenize the part of the replacement after `tools/run-tests.js` and assert `parseRunnerOperands(tokens, { cwd, repoRoot: '/repo', isFile: () => true, pathImpl: path.posix })` does not throw. Before tokenizing, a glob token and a `$(...)` or `"$NAME"` expansion are each replaced by two literal test file names, as the shell would produce (the `node --test $(git diff --name-only main)` and `node --test "$TEST_FILE"` rows are covered this way; decided by the user at plan review). For a replacement that starts with `cd <dir> && `, the classifier gets the whole line and the parser gets the part after `&&` with `cwd` set to that directory.
- `the unresolved-expansion reason says the runner takes test files only`: the reason for `node --test $(git diff --name-only main)` equals the template with the extra line in place; the reason for `node --test tests/a.test.js tests/b.test.js` does not contain that line.
- `win32 paths`: with `pathImpl: path.win32`, `cwd: 'C:/repo'` and a `hasRunner` that returns `'C:\\repo'` for it, `node --test tests/a.test.js tests/b.test.js` denies and `"C:/nodejs/node.exe" --test tests/a.test.js` allows.
- `hasDirectTestRun finds a single-file run and ignores quoted text`: true for `node --test tests/a.test.js`, for `sh -c "node tests/a.test.js"` and for `for f in x; do node --test "$f"; done`; false for `echo "node --test a.test.js"` and for `node tools/run-tests.js tests/a.test.js`.

Guard-branch discrimination, stated for the reviewer: each deny rule has an input on which only that rule decides, and deleting the rule must turn that input's assertion red.

| Rule | Deciding input |
|---|---|
| Two or more operands | `node --test tests/a.test.js tests/b.test.js` |
| Glob character | `node --test --test-reporter=tap tests/bin-lib/verify/*.test.js` (one operand) |
| No operand | `node --test` |
| Directory by `isDirectory` | `node --test tests` (no trailing slash) |
| Trailing slash | `node --test tests/`, asserted a second time with `isDirectory: () => false` |
| Unresolved expansion | `node --test "$TEST_FILE"` (one operand, no loop; the `$(git diff ...)` row also trips the operand count) |
| Inside a loop | `for i in 1 2 3; do node --test tests/a.test.js; done` (one literal operand per pass; the `"$f"` row also trips the expansion rule), with the closed-loop allow row as its counterpart |
| Loop variable as the script | `for f in tests/*.test.js; do node "$f"; done`, with the `scripts/a.js scripts/b.js` allow row as its counterpart |
| `xargs` and `find -exec` | their own rows |
| Wrapper recursion | the `sh -c` row |
| Repeated wrapper | `for i in 1 2 3; do sh -c "node --test tests/a.test.js"; done` and the `seq 3 \| xargs -n1 sh -c` row (one literal operand inside; only the `repeated` flag decides) |
| Directory prefix | the `cd tests &&` replacement pin |
| `evals/` exemption | `cd evals && node --test tests/`, which denies if the exemption is deleted |
| No runner above the cwd | the `hasRunner: () => null` test |

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/direct-test-run-guard.test.js`
Expected: FAIL with `Cannot find module` for `tools/direct-test-run-guard.js`

- [ ] **Step 3: Implement** `classifyCommand` and `SAFEGUARDS_TEXT` in `tools/direct-test-run-guard.js` per the decisions above. The module requires only `path`, `tools/run-tests.js` and `plugin/bin/lib/hooks/git-command.js`. It must not require `child_process` (AC10.4).

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/direct-test-run-guard.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add tools/direct-test-run-guard.js tests/direct-test-run-guard.test.js
git commit -m "Add the direct test run classifier — denies multi-file and looped node --test with a runner replacement, refs #5547" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oWebZDKZcjphy4K2Sc"
```

---

### Task 3: Script scan, hook entry and registration

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/direct-test-run-guard.js`
- Modify: `.claude/settings.json`
- Test: `tests/direct-test-run-guard.test.js`
- Read-only, run in Step 4: `tests/agent-trust-scope-repo-posture.test.js` must stay green with the new `hooks` key (AC11.1).

**Interfaces:**
- Consumes: `classifyCommand`, `hasDirectTestRun`, `SAFEGUARDS_TEXT` (Task 2).
- Produces (exported from `tools/direct-test-run-guard.js`):
  - `scanScript(text, kind)` with `kind` `'js'` or `'shell'`, returning a boolean. `'js'`: true when the text holds the exact string literal `--test` in single, double or backtick quotes AND the substring `child_process`. `'shell'`: true when `hasDirectTestRun(text, …)` is true (a script is a repeatable run by nature, so a single-file direct run inside one is enough).
  - `judge(payload, deps)` returning `{ decision: 'allow' }` or `{ decision: 'deny', reason }`. `payload` is the parsed hook stdin. `deps` is `{ hasRunner, isDirectory, readScript(absPath) -> string|null, pathImpl }`. Applies `classifyCommand` to `payload.tool_input.command` with `cwd` `payload.cwd`, then the script scan.
  - A CLI entry under `if (require.main === module)`: reads stdin to end, calls `judge` with real `fs`-backed deps, prints the deny JSON or nothing, and always exits 0.

Decisions the implementer cannot make alone:

- **Which calls are scanned.** Only `payload.tool_name === 'Bash'`. For each command segment (same walker): the script is the first non-option operand of a program whose basename is `node`, `bash`, `sh` or `zsh` (not `-c` forms, which Task 2 handles), or the program token itself when it holds a `/` and ends in `.sh`, `.js`, `.mjs` or `.cjs`. Kind is `'js'` for `.js`/`.mjs`/`.cjs` or a `node` program, else `'shell'`.
- **Which scripts are skipped without being read.** A script that resolves inside the checkout (`hasRunner(dirname)` non-null) under `tools/`, `plugin/`, `tests/`, `perf/`, `evals/` or `scripts/` (the spec's list, no other directory). Everything else is read through `readScript`, which returns `null` for a missing file, a directory, a file over 262,144 bytes, or any error; `null` allows.
- **Scope.** The scan runs only when `hasRunner(payload.cwd)` is non-null.
- **Script deny reason** (exact):

```
This repository's guard blocked a script that starts node --test itself: {script path as typed}. {SAFEGUARDS_TEXT}
Have the script start the runner instead, from inside the checkout it tests, with the same flags and files:

node tools/run-tests.js --test-reporter=tap <files>

In JavaScript: spawnSync(process.execPath, ['tools/run-tests.js', ...flags, ...files], { cwd: checkoutRoot }). The exit code and stdout are node's own.
In a checkout older than this guard, write the files to a list and use: node tools/run-tests.js --files-from <list>
```

- **Output.** A deny prints exactly `JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })` on stdout. An allow prints nothing. Unparseable stdin, a non-Bash tool, a missing command, or any thrown error prints nothing. Exit status is 0 on every path.
- **Registration.** Add to `.claude/settings.json`, keeping every existing key and its order, a top-level `hooks` key:

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [
        { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/tools/direct-test-run-guard.js\"", "timeout": 10 }
      ]
    }
  ]
}
```

- [ ] **Step 1: Write the failing tests**, appended to `tests/direct-test-run-guard.test.js`.

- `AC8.1: a scratch script that spawns node --test is denied, and allowed once it spawns the runner`. In a temp directory outside the repo write `mutant-run.js` holding `const { spawnSync } = require('child_process'); spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/a.test.js']);`. `judge({ tool_name: 'Bash', cwd: ROOT, tool_input: { command: 'node ' + file } }, realDeps)` denies and the reason equals the template with the path as typed. Rewrite the file to `spawnSync(process.execPath, ['tools/run-tests.js', '--test-reporter=tap', 'tests/a.test.js'])` (still requiring `child_process`): allows. A file with `'--test'` and no `child_process`: allows. A file with `child_process` and only `'--test-only'`: allows.
- `AC8.2: a shell script holding a direct test run is denied`: `loop.sh` holding `node --test a.test.js b.test.js`, run as `bash <file>` and as `<file>` by path, both deny.
- `AC8.3 AC8.4: repo tooling is allowed unread, and an unreadable or missing script is allowed`: with a `readScript` that throws when called, `node tools/test-impact.js trace` and `node plugin/bin/verify.js` allow; `node /no/such/script.js` with real deps allows; a script over 262,144 bytes that would otherwise deny allows.
- `scanScript discriminates each condition`: the four `'js'` cases above as direct calls, plus `'shell'` with `node --test a.test.js` (true) and `echo done` (false).
- `AC10.1 AC10.2 AC10.3: the guard as a real process denies, allows and tolerates garbage`: `spawnSync(process.execPath, [GUARD], { input, encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL' })` for three inputs: a payload with command `node --test tests/a.test.js tests/b.test.js` and `cwd: ROOT` (status 0; stdout parses to an object whose `hookSpecificOutput.permissionDecision` is `deny`, `hookEventName` is `PreToolUse`, and whose reason contains `node tools/run-tests.js tests/a.test.js tests/b.test.js`); a payload with `node --test tests/a.test.js` (status 0, empty stdout); the string `not json` (status 0, empty stdout).
- `AC10.4: the guard requires no child_process`: read `tools/direct-test-run-guard.js` with `readText` and assert it matches no `require\(['"](node:)?child_process['"]\)`. Control: the same regex matches the string `require('child_process')`.
- `AC11.1: .claude/settings.json registers the guard for Bash and the file exists`: `JSON.parse` the settings file; assert `hooks.PreToolUse` has an entry with `matcher === 'Bash'` whose hooks include one with `type === 'command'` and `command === 'node "$CLAUDE_PROJECT_DIR/tools/direct-test-run-guard.js"'`; assert `tools/direct-test-run-guard.js` exists; assert the `permissions`, `worktree`, `enabledPlugins` and `extraKnownMarketplaces` keys are still present.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/direct-test-run-guard.test.js`
Expected: FAIL after Step 1 (`judge is not a function`, and `hooks` missing from `.claude/settings.json`)

- [ ] **Step 3: Implement** `scanScript`, `judge`, the CLI entry and the settings registration per the decisions above.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/direct-test-run-guard.test.js`
Expected: PASS, 0 failures. Then `node --test tests/agent-trust-scope-repo-posture.test.js`. Expected: PASS (AC11.1).

- [ ] **Step 5: Commit**

```bash
git add tools/direct-test-run-guard.js tests/direct-test-run-guard.test.js .claude/settings.json
git commit -m "Scan script-spawned test runs and register the guard as a project hook — fails open on every error, refs #5547" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oWebZDKZcjphy4K2Sc"
```

---

### Task 4: Guidance and docs use the runner form

**Role:** integration

**Files:**
- Modify: `.claude/skills/shell-scanner-bash-differential/SKILL.md:97`
- Modify: `.claude/skills/pretooluse-updatedinput-normalizer/SKILL.md:71`
- Modify: `.claude/skills/node-test-output-evidence/SKILL.md:116` (and the glob example at line 47)
- Modify: `.claude-tweaks/verify-scope.json` (the `checks.tests.journeys` command only)
- Read-only, run in Step 4: `tests/verify-scope-declaration.test.js` must stay green with the rewritten `journeys` command.
- Modify: `.claude/skills/dispatch-queue-exclusion-addition/SKILL.md:49`
- Modify: `.claude/skills/upstream-repin/SKILL.md:73`
- Modify: `docs/journeys/document-a-flag-a-person-never-types-2964.md:56`
- Modify: `docs/plugin-structure.md` (the 16 command lines at 159, 161, 164, 171, 173, 175, 177, 178, 197, 199, 219, 220, 282, 294, 299, 300; the `tools/` entry at line 101)
- Modify: `docs/donts.md`
- Modify: `docs/hooks.md`
- Test: `tests/direct-test-run-guard.test.js`
- Waived `CLAUDE.md`: read by the conformance test only; its single-file `node --test path/to/file.test.js` advice is allowed by the guard and no line changes (AC13.1).
- Waived `plugin/bin/lib/hooks/pre-tool-use.js`: named in the spec's Current State only; not read or changed.
- Waived `plugin/bin/lib/hooks/bash-prefilter.js`: named in a spec Gotcha about `if` predicates; the plan registers no `if`, so it is not read or changed.
- Waived `tests/helpers/git-template.js`: named in the spec's Technical Approach as background; not read or changed.
- Waived `plugin/bin/verify.js`: named in the spec's Technical Approach as the rejected route; only Task 3's test names it, as an allowed command.

**Interfaces:**
- Consumes: `classifyCommand` (Task 2).
- Produces: nothing later tasks use.

Decisions the implementer cannot make alone:

- **Rewrite rule.** Each listed command keeps its files, globs, flags and trailing comment, with `node --test` replaced by `node tools/run-tests.js`. Example: `node --test tests/bin-lib/code-health/*.test.js   # Code-health unit suite only` becomes `node tools/run-tests.js tests/bin-lib/code-health/*.test.js   # Code-health unit suite only`. Single-file commands in the same files stay as they are. `docs/plugin-structure.md:312` (`cd evals && npm install && node --test tests/`) stays as it is.
- **`.claude-tweaks/verify-scope.json`** (added while planning; not in the spec's file list). Its `checks.tests.journeys` command is a ten-file direct `node --test` that `plugin/bin/verify.js` starts for a journey-only change, so it is the same bypass, launched by a tool where no Bash hook sees it. Replace its leading `node --test` with `node tools/run-tests.js` and keep the ten files in order. Change nothing else in the file: the `retry` templates (`node --test {file}`) are single-file and stay.
- **`node-test-output-evidence/SKILL.md:47`** holds the illustrative span `` `node --test '[ab].test.js'` ``, which the guard denies (a glob character) and which cannot take the runner form without losing its point. Reword only that clause so the example is no longer one `node` command span: `` passing `'[ab].test.js'` to `node --test` runs `a.test.js` ``. The rest of the sentence and the line stay.
- **`shell-scanner-bash-differential/SKILL.md:97`** becomes: `- mutant: edit a copy in a scratch worktree and run `node tools/run-tests.js tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js` there. A mutation loop or script calls that same command once per mutant, from inside the mutant's own checkout (add `--test-reporter=tap` to parse the result); it never starts `node --test` itself.`
- **`docs/donts.md`**, one new rule beside the existing rule about dispatching agents that run `git` or `node --test` (line 22), in the file's "rule plus one clause of why" style: `- Don't run two or more test files, a loop over test files, or a script that spawns `node --test` outside `tools/run-tests.js` — a direct run skips the runner's git-maintenance-off env, per-run TMPDIR, suite slot and bounded concurrency; `node tools/run-tests.js <flags> <files>` takes the same arguments, and `tools/direct-test-run-guard.js` denies the direct form (#5547)`
- **`docs/plugin-structure.md` line 101** (`tools/` entry): after the existing `--files-from` clause add that explicit `*.test.js` operands and node test flags (`--test-*`, `--experimental-test-*`) are accepted and run on the subset lane, resolved against the caller's working directory; and add an entry for `direct-test-run-guard.js` (#5547): the repo-local PreToolUse guard registered in `.claude/settings.json`, what it denies, what it allows, that it prints a deny JSON or nothing and always exits 0, and that its tests are in `tests/direct-test-run-guard.test.js`. Also update the `npm test` comment at line 158 only if it states that positional arguments are roots only.
- **`docs/hooks.md`**, one sentence at the end of the opening rules list: `This repository also registers one repo-local hook outside this dispatcher, in `.claude/settings.json`: `tools/direct-test-run-guard.js` (#5547), a maintainer-side PreToolUse guard for direct multi-file test runs. It is not part of the plugin payload or of this contract.`
- **Behavior-change prose sweep.** After the edits, run `git grep -n -i -e "positional arg" -e "root arguments" -e "root paths" -- tools/run-tests.js docs/plugin-structure.md docs/decisions docs/journeys .claude/skills CLAUDE.md` and reword any sentence that still says the runner's positional arguments are directory roots only. Known hits before this change: `tools/run-tests.js:13`, `:26`, `:516` (Task 1 owns the header; `:516`'s message is unchanged by decision) and `tests/package-json-test-script.test.js:23` (a comment about `roots`; no change).

- [ ] **Step 1: Write the failing test**, appended to `tests/direct-test-run-guard.test.js`.

`AC12.1: every documented node --test command is one the guard allows`. A helper `documentedTestCommands(text)` returns every fenced-code line and every inline code span that starts with a node program (`node`, a path ending in `node`, or `npx ... node@<version>`; optionally after `cd <dir> && ` or `NAME=value ` words) and contains `--test` as a whole word. An inline span with nothing after `--test` is a mention of the tool, not a command, and is skipped: 39 such spans exist today (`CLAUDE.md:14` and `:25`, `docs/donts.md:22`, several skill descriptions), and this plan edits none of them. A fenced line is always a command, bare or not. Before classifying, each placeholder is replaced by the literal word `placeholder`: `<name>` and `{name}`, where the name is letters, digits, `-` or `_` and the `{` is not preceded by `$` (today: `node --test <file>`, `node --test {file}`, `NODE_PATH="{worktree}/node_modules" node --test "{disc-path}/{test-file}"`). The test reads, through `readText`, every `.claude/skills/**/SKILL.md`, `docs/plugin-structure.md`, every `docs/journeys/*.md`, `docs/donts.md` and `CLAUDE.md`; asserts the total number of extracted commands is at least 10 (a floor, so an extractor that finds nothing cannot pass); and asserts `classifyCommand(cmd, opts).decision === 'allow'` for each, with `opts` built from the real repo root, naming the file and command on failure. `path/to/file.test.js` counts as one literal operand.

The same test also reads `.claude-tweaks/verify-scope.json` through `readText` and applies the shared assertion to every command string in it: each value of `checks.tests`, each value of `retry`, and `impact.command`, placeholders normalized the same way.

`the extractor skips a bare mention and keeps a real command`: `documentedTestCommands` returns nothing for the text ``a bare `node --test` run``; one command for ``run `node --test <file>` ``, which the shared assertion accepts; and one command for a fenced block holding the single line `node --test`, which the shared assertion rejects.

`AC12.2: the conformance check fails on the pre-change mutant instruction`. Freeze the pre-change line as a constant in the test:

```js
const PRE_CHANGE_MUTANT_LINE = '- mutant: edit a copy in a scratch worktree and run `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js` there.';
```

Factor the per-command assertion into one function used by both tests; the control asserts `documentedTestCommands(PRE_CHANGE_MUTANT_LINE)` has length 1 and that the shared assertion throws for it.

`AC13.1: CLAUDE.md is 150 lines or fewer`: count the lines of `readText('CLAUDE.md')`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/direct-test-run-guard.test.js`
Expected: FAIL after Step 1 (the AC12.1 test names `shell-scanner-bash-differential/SKILL.md` and the other listed files)

- [ ] **Step 3: Make the edits** listed under Files, per the decisions above.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/direct-test-run-guard.test.js`
Expected: PASS, 0 failures. Then, one file at a time: `node --test tests/claude-md-budget.test.js` (AC13.1), `node --test tests/raw-markdown-read-conformance.test.js` and `node --test tests/verify-scope-declaration.test.js`. Expected: PASS for each. Do not run the rewritten journeys command here: it takes the machine-wide subset slot, and the build's final verification runs that suite once through `verify.js`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills .claude-tweaks/verify-scope.json docs/journeys/document-a-flag-a-person-never-types-2964.md docs/plugin-structure.md docs/donts.md docs/hooks.md tests/direct-test-run-guard.test.js
git commit -m "Rewrite documented multi-file test commands to the runner form — pinned by a guard conformance test, refs #5547" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oWebZDKZcjphy4K2Sc"
```

---

### Task 5: Real-input probe over recorded Bash commands

**Role:** integration

**Files:**
- Read-only: `tools/guard-refusals/transcripts.js`, whose transcript-store walk the probe uses.
- No tracked file changes. The probe script stays in the scratchpad; its result goes to the run directory.

**Interfaces:**
- Consumes: `judge` (Task 3), the transcript-store walk in `tools/guard-refusals/transcripts.js`.
- Produces: one evidence file and one `decisions.md` entry.

Why: the classifier's tests are the author's model of what agents type. The local transcript store holds what they actually typed. A false deny on a common command would block every session in this repo once the hook is live.

- [ ] **Step 1: Write a scratch script** (in the session scratchpad, not the repo) that walks this project's transcripts from the last 14 days with `tools/guard-refusals/transcripts.js`, collects every Bash `tool_use` command and its recorded `cwd`, runs `judge` on each with real deps, and prints: the number of commands read; the number denied, split by `typed` and `script`; the 25 most frequent denied commands, truncated to 200 characters; and, as an independent count the classifier did not compute, the number of commands whose raw text matches `/\bnode\b[^|;&\n]*\s--test(\s|$)/`.

- [ ] **Step 2: Run it and reconcile.** Every denied command must be a real multi-file, looped or script-spawned direct test run. Read all 25 listed commands and a random 25 of the rest. Every command the independent regex counts but the classifier allowed must be a single-file run, a run under `evals/`, or text inside a quoted argument; read a sample of 25. A false deny or a missed multi-file run is a defect: fix the classifier in `tools/direct-test-run-guard.js`, add the offending command as a row in Task 2's table, re-run that test file, and commit the fix.

- [ ] **Step 3: Record the result.**

```bash
mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-15T222337-spec-5547/evidence"
```

Write the probe's full output to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-15T222337-spec-5547/evidence/guard-transcript-probe.txt` with a plain Bash redirect. Then write a one-line text file holding the criterion it supports (AC7, "the classifier pins these verdicts", checked against recorded commands), the command shape, and the counts (read, denied typed, denied script, regex count, false denies found and fixed), and log it:

```bash
node /Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.170.0/bin/log-decision.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-15T222337-spec-5547" --section "/build" --status AUTO --step "AC evidence" --text-file "<the text file>" --reversibility n/a
```

---

## Spec coverage map

| Criterion | Covered by |
|---|---|
| AC1.1, AC1.2, AC1.3 | Task 1 unit and process tests |
| AC2.1, AC2.2 | Task 1 `--test-reporter=tap` process test; space-form unit test |
| AC3.1 | Task 1 process test with the base lane held |
| AC4.1 to AC4.6 | Task 1 refusal unit rows and the argument-error process test |
| AC5.1, AC5.2 | Task 1 concurrency tests |
| AC6.1, AC6.2 | Task 1 `parse as before` row, the four-invocation process test, and Step 4's unmodified suites |
| AC7.1, AC7.2 | Task 2 verdict table; Task 5 probe |
| AC8.1, AC8.2, AC8.3, AC8.4 | Task 3 script-scan tests |
| AC9.1, AC9.2 | Task 2 replacement round-trip test |
| AC10.1, AC10.2, AC10.3, AC10.4 | Task 3 real-process and source tests |
| AC11.1 | Task 3 registration test; Step 4's posture suite |
| AC12.1, AC12.2 | Task 4 conformance test and its frozen control |
| AC13.1 | Task 4 line-count test; Step 4's budget suite |
| AC14.1 | Final verification: `git diff --name-only origin/main...HEAD -- plugin` prints nothing; Task 1's `AC5.2` test |
