# Queue-pull oracle sh shims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The queue-pull parity oracle's `gh`, `git` and `mktemp` PATH shims become POSIX `sh` scripts, so a shimmed call no longer costs a node start, and every go-red control still holds.

**Architecture:** `writeShims` in `tests/bin-lib/dispatch/queue-pull-oracle.js` generates the shims from the sandbox's table, with every table value written in through `shQuote`. The shims write one NUL-framed log format (the node gh fallback writes it too), which one exported reader, `readShimLog`, turns back into today's `{ tag, why?, cwd?, argv }` objects. The `gh` shim answers exact-argv, effect-free entries itself and `exec`s a node fallback (today's `ghShim`) for everything else.

**Tech Stack:** Node 18+ `node --test`, POSIX `sh` (dash on CI ubuntu, `/bin/sh` and `/bin/dash` on macOS), git.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T130826-spec-5366/work/5366-spec.md` (record #5366)

Scope keywords: gh-argv.jsonl, git-argv.jsonl, shimMain, writeShims, mktempShim, gitShim

## Global Constraints

- Every shim keeps today's exit codes and stderr text: `gh-shim: no canned response for: {argv joined by spaces, first 300 chars}` (exit 97); `git-shim: refused ({why}): {argv joined, first 300 chars}` (exit 97); `git-shim: injected failure: {sub argv joined}` (exit 128); `mktemp-shim: refused ({why}): {args joined}` (exit 97).
- The git shim's `why` strings stay byte-identical: `GIT_DIR/GIT_WORK_TREE set`, `unknown global option {opt}`, `config key not allowed: {key}`, `unresolvable directory {dir}`, `outside the sandbox: {real}`.
- The only `-c` key allowed is `core.quotepath`, compared case-insensitively (`Core.QuotePath` is allowed; `Core.HooksPath` is refused).
- Generated shims are POSIX `sh` (`#!/bin/sh`): no arrays, no `${var:off:len}`, no `[[`, no `local`. They must behave the same under dash and macOS `/bin/sh`. Probed on 2026-11-13: `printf '%s\0'` writes NUL in both; `cd ""` is a no-op in dash but an error in `/bin/sh`, so an empty `-C` value is handled explicitly and never passed to `cd`; a failed redirection on the special builtin `:` exits dash, so the exclusive create uses `true` with `2>/dev/null` written before the `>` target; `$((n + 1))` reads a leading-zero `n` as octal in some shells, so strip leading zeros first.
- A shim never forks a subshell for its own checks (no `$(...)`, no `( ... )`, no pipe): a fork is a process, and process count is what this change cuts. Checks run in the shim's own shell; a delegated git call `exec`s the real git.
- The whole-fence parity skill (`.claude/skills/skill-prose-conformance-tests/whole-fence-parity-oracle.md`) governs these files. Its rules, quoted verbatim:
  - "**Shim `gh` and `git` on PATH from one canned table.** Fence and port answer from the same table of `{argv, stdout, stderr?, status?}` entries, so a difference is a behaviour difference, not a fixture difference. The `git` shim refuses any `-C` path or cwd outside the sandbox."
  - "**Share deterministic seams.** The oracle's `mktemp` shim and the port's temp-name seam read one counter file, so both sides name files identically. A frozen-clock preload stubs `Date` on both sides."
  - "**Pin the environment explicitly.** Spawn with an explicit env, not the inherited one: pin cwd, `OLDPWD`, `PWD` and `HOME` to the sandbox, unset `CDPATH`, and set `GIT_CEILING_DIRECTORIES` above the sandbox."
- Commit subjects use `{Verb} {what} — {detail}` (imperative, no conventional prefix), ending with the `Claude-Session:` trailer the controller gives you.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- Session #5230 (PR #5323) edits the same two files: `MCP_MD`, the `module.exports` line, `queue-pull.test.js` around lines 54, 2521 and 2776, and the end of that file. Do not touch those regions beyond the `module.exports` additions this plan names, and put every new test in the new file `tests/bin-lib/dispatch/queue-pull-shims.test.js`, not at the end of `queue-pull.test.js`.

- CI runs Node 20 (local is newer): use no syntax or API Node 20 lacks.

**Decided by the user at plan review** (spec `## Plan Review Clarifications`): the new go-red tests live in `tests/bin-lib/dispatch/queue-pull-shims.test.js` (fast; survives #5319's heavy skip; clear of #5230's appends); AC6 allows the parity skill's stale sentences plus the pipeline artifacts (plan, ledger, materialized spec); an unresolvable `-C` prints its path normalized lexically against the physical previous dir.

## Acceptance coverage

| AC clause | Where |
|---|---|
| AC1.1 (`bin/gh`, `bin/git`, `bin/mktemp` start with `#!/bin/sh`, a test checks) | Task 2, 3, 4 shebang tests |
| AC1.2 (the only node shim left is the gh fallback) | Task 2 removes `gitShim`, Task 3 `mktempShim`, Task 4 moves `ghShim` to `<shimDir>/gh-fallback` |
| AC2.1 (parity file passes, no skips, Mac + CI ubuntu) | Task 5; PR CI |
| AC3.1, AC3.2 (unmatched gh argv and missing graphql alias exit 97 + `UNHANDLED`) | Task 4's near-miss test + the existing `#5227 oracle: the gh shim exits 97…` test |
| AC3.3 (git refusals: outside, chained relative, symlink, `GIT_DIR`/`GIT_WORK_TREE`, `-c` keys, unknown option, unresolvable) | Task 2's new tests + the two existing git shim tests |
| AC3.4 (`gitFail` prefixes exit 128) | existing gitFail test + Task 2's `setScenario` test |
| AC3.5 (each new test seen red against a mutant) | the mutant step of Tasks 1-4 (a mutant of the generator or reader in `queue-pull-oracle.js`, one per new test); the PR body names the mutants |
| AC4.1 (sh gh shim agrees with `ghAnswer` on every exact effect-free entry) | Task 4's agreement test |
| AC5.1, AC5.2, AC5.3 (before/after measurement in the PR body) | Post-execution (controller) below |
| AC6.1 (diff scope as amended at plan review, #5319 repointed) | Post-execution below |

## Review Focus

1. A gh argv holding a newline, quotes, `$`, a backtick or an empty string (every graphql call is like this): it must round-trip through the log exactly, and an exact entry holding such an argument must still match. Pinned by Task 1's round-trip test and Task 4's agreement test.
2. A `-C` that leaves the sandbox through a symlink, or a chained relative `-C ..`: it must be refused, not delegated. Pinned in Task 2.
3. An empty `-C` value, or a trailing `-c` with no value: `-C ""` is allowed (git treats it as a no-op), and a missing `-c` value is refused as `config key not allowed: ` (empty key), as today. Pinned in Task 2.
4. A counter file holding `08` (leading zero): the next name is `tmp.qp00000009`, not an octal error. Pinned in Task 3.
5. `setScenario` mid-sandbox (the D1 reproduction): the regenerated gh answers and git fail prefixes take effect for the next call. Pinned in Task 4.

---

### Task 1: One NUL-framed shim log and its reader

**Role:** integration

**Files:**
- Modify: `tests/bin-lib/dispatch/queue-pull-oracle.js` (`shimLog` ~793, `readJsonl` ~479 and `collectResult` ~557, the two log resets ~503 and ~524, the header comment ~12, `gitShim`'s delegated entry ~860, `module.exports`)
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js` (the four direct log reads at ~172, ~203, ~236, ~2787; import `readShimLog` in the existing import list at ~63)
- Create: `tests/bin-lib/dispatch/queue-pull-shims.test.js`

Reader inventory (every read of these logs, from a grep for `gh-argv`, `git-argv`, `ghArgv`, `gitArgv`): `collectResult` (feeds `r.ghArgv`/`r.gitArgv` to every parity assertion, which keep their shape) and the four direct reads above. Nothing else reads them.

**Interfaces:**
- Produces: `SHIM_LOGS = { gh: 'gh-argv.nul', git: 'git-argv.nul' }` (file names under `<root>/logs`); `appendShimRecord(file, { tag, why = '', cwd = '', argv })` (node writer, one `fs.appendFileSync` call per record); `readShimLog(logsDir, kind)` → `[{ tag, argv }]` for `kind === 'gh'`, `[{ tag, cwd, argv }]` plus `why` when it is non-empty for `kind === 'git'`; an absent file reads as `[]`. Record framing, for every writer: the fields `tag`, `why`, `cwd`, `String(argv.length)`, then each argv element, each followed by one NUL byte. `readShimLog` throws `Error('readShimLog: malformed record in {file}: {detail}')` when a record's argc is not a decimal integer or the file ends mid-record.
- The `delegated` git entry no longer carries `status` (no reader uses it).

- [ ] **Step 1: Write the failing tests** in `queue-pull-shims.test.js` (its header comment names #5366 and says it holds the oracle shims' fast tests):
  - `readShimLog round-trips awkward argv`: append two gh records with `argv: ['api', 'graphql', '-f', 'query=query{ a: issue(number:1){ x } }\n"q" $HOME `id` \'s\'', '']` and `['issue', 'view', '1']` with tags `ok` and `UNHANDLED`; `assert.deepEqual(readShimLog(dir, 'gh'), [{ tag: 'ok', argv: [...] }, { tag: 'UNHANDLED', argv: [...] }])`.
  - `readShimLog keeps cwd and why for git`: one `REFUSED` record with `why: 'unknown global option --bare'` and one `delegated` record with no `why`; the first object has `why`, the second has no `why` key (`assert.equal('why' in second, false)`).
  - `readShimLog throws on a truncated record`: write `'ok\0\0\0' + '3\0a\0'` (argc 3, one element) → `assert.throws(() => readShimLog(dir, 'gh'), /malformed record/)`; and `'ok\0\0\0x\0'` → throws.
  - `an absent log reads as []`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/bin-lib/dispatch/queue-pull-shims.test.js`
Expected: FAIL (the file or `readShimLog` does not exist yet)

- [ ] **Step 3: Implement** `appendShimRecord`, `readShimLog` and `SHIM_LOGS` in `queue-pull-oracle.js`. Repoint `shimLog` (used by today's node shims) to `appendShimRecord`; reset `SHIM_LOGS` files where the two `.jsonl` resets are today; `collectResult` reads `readShimLog(sandbox.logs, 'gh'|'git')`; drop `readJsonl` if nothing else uses it. In `queue-pull.test.js`, replace each of the four `fs.readFileSync(path.join(sb.logs, '…-argv.jsonl'), …).map(JSON.parse)` reads with `readShimLog(sb.logs, 'gh'|'git')`; change nothing else on those lines. Update the header comment's `<root>/logs` line.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test tests/bin-lib/dispatch/queue-pull-shims.test.js`
Expected: PASS
Run: `node --test --test-name-pattern "#5227 oracle: the (git|gh) shim" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS, 4 tests, 0 skipped on macOS/Linux (the three go-red tests plus the `remote get-url origin` test at ~2777, which holds the ~2787 read)

- [ ] **Step 5: Prove each new test can fail.** Commit the implementation first (Step 6), then mutate the generator or reader code in `queue-pull-oracle.js` (never a generated file: `createSandbox` regenerates it) only in a scratch checkout of that commit, per the dispatch prompt's scratch-checkout steps — never in this shared worktree — run the named test there, see it red, and tear the scratch checkout down. Quote each red run's failing assertion line in your report. Mutants: drop the argc field from the writer (round-trip red); always emit `why` (git `why` test red); accept a short record instead of throwing (truncation test red); throw on an absent file (absent test red).

- [ ] **Step 6: Commit**

  `git add tests/bin-lib/dispatch/queue-pull-oracle.js tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-pull-shims.test.js`, subject `Frame the queue-pull oracle's shim logs as NUL records — one writer format, one reader`.

### Task 2: The git shim as a generated sh script

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `tests/bin-lib/dispatch/queue-pull-oracle.js` (`writeShims` ~275, `createSandbox` ~323-418 including `setScenario`, `gitShim` ~822-863 removed, `shimMain`, header comment ~9-11 and ~20)
- Test: `tests/bin-lib/dispatch/queue-pull-shims.test.js`

**Interfaces:**
- Consumes: Task 1's record framing and `SHIM_LOGS.git`; `shQuote(text)`.
- Produces: `writeShims({ bin, shimDir, root, realGit, table, gh })`, which writes `bin/git`, `bin/mktemp`, `bin/node` and (when `gh` is true) `bin/gh`, plus anything the gh shim needs under `shimDir` (`<root>/shim`, created by `createSandbox`, not on PATH). `createSandbox` calls it once, and `setScenario(next)` calls it again with the new `shimTable(next)` after rewriting `shim-table.json`. Export `writeShims`. In this task `bin/gh` and `bin/mktemp` stay today's node shims.

The generated `bin/git` (`#!/bin/sh`) does, in this order, matching `gitShim` exactly (anything not listed is unchanged behavior):
0. `unset CDPATH`; save the shell's `PWD` as `qp_pwd`; `cd -P .` and take `$PWD` as the physical cwd, which every log record carries.
1. `QP_LOG_DIR` empty → stderr `git-shim: QP_LOG_DIR is required`, exit 97 (today's shim would crash on that input).
2. `GIT_DIR` or `GIT_WORK_TREE` non-empty (today's `process.env.X ||` test treats an empty value as unset) → refuse `GIT_DIR/GIT_WORK_TREE set`.
3. Parse the leading global options the way `gitSubArgv` does (`queue-pull-fixtures.js:97`): `-C` and `-c` take the next argument (missing → empty string), `--no-optional-locks`, `--no-pager` and `--literal-pathspecs` stand alone, `--version` and the first non-`-` argument end the options, any other `-` argument is the unknown option. Run this as a `for a in "$@"` pass that only reads, counting the option tokens consumed.
4. Unknown option → refuse `unknown global option {opt}`; this beats a bad `-c` key anywhere in the argv.
5. The first `-c` value whose key (text before the first `=`) is not `core.quotepath` case-insensitively (a `case` pattern of bracketed letter pairs) → refuse `config key not allowed: {key}`.
6. Check the physical cwd from step 0. Then, for each `-C` value in order (a second read-only pass), skip an empty value; prefix a relative value with `./` (`case $d in /*) ;; *) d=./$d ;; esac`), because `cd -P -- -` jumps to `$OLDPWD` in dash and bash instead of entering a directory named `-`; then `cd -P -- "$d"`. On failure refuse `unresolvable directory {d}`, where `{d}` is the value normalized lexically against the current physical dir, as `path.resolve` would: absolute values as given, relative ones joined to the current physical dir, then `.` segments, `..` segments (each dropping the segment before it) and repeated or trailing `/` removed (decided at plan review). Each physical dir (cwd included) must equal the baked root or start with `root + '/'`, else refuse `outside the sandbox: {dir}`. Afterwards `cd -P -- {the physical cwd}` and set `PWD` back to `qp_pwd`, so the real git inherits today's cwd and env.
7. In a shell function (its own `"$@"`, after `shift`ing the counted option tokens): a sub-argv that starts with any baked `gitFail` prefix → log `injected`, stderr `git-shim: injected failure: {sub joined}`, exit 128; a sub-argv of exactly `remote get-url origin` → log `canned`, print the baked remote URL plus a newline, exit 0.
8. Otherwise log `delegated` and `exec` the baked real git with the original `"$@"`.

Every log write is one `printf '%s\0' "$tag" "$why" "$cwd" "$#" "$@" >> "$QP_LOG_DIR/git-argv.nul"`, where `cwd` is the physical cwd from step 0 (the original argv, not the shifted sub-argv). Refusals log `REFUSED` with `why`. Root, real git path, remote URL and every fail-prefix token go in through `shQuote`.

- [ ] **Step 1: Write the failing tests** in `queue-pull-shims.test.js` (oracle skip: `{ skip: oracleSkip() }`; each builds `createSandbox(S0())` or a variant and cleans up in `finally`):
  - `the git shim is a sh script`: the first line of `sb.bin/git` is `#!/bin/sh`.
  - `the git shim refuses a -C that leaves the sandbox through a symlink`: `fs.symlinkSync(REPO, path.join(sb.root, 'out'))`; `git -C {root}/out rev-parse HEAD` exits 97, stderr starts `git-shim: refused (outside the sandbox: ` + `fs.realpathSync(REPO)`.
  - `the git shim resolves chained relative -C like git`: `git -C proj -C .. -C .. rev-parse HEAD` run with cwd `sb.root` is refused (outside); `git -C proj -C . rev-parse --show-toplevel` with cwd `sb.root` exits 0 and prints `sb.proj`.
  - `the git shim treats -C "" as a no-op and a trailing -c as an empty key`: `git -C '' rev-parse --show-toplevel` (cwd `sb.proj`) exits 0; `git -c` exits 97 with stderr `git-shim: refused (config key not allowed: ): -c\n`.
  - `the git shim refuses an unknown option before a bad -c key`: `git -c core.hooksPath=/x --bare status` → stderr `git-shim: refused (unknown global option --bare): -c core.hooksPath=/x --bare status\n`.
  - `the git shim logs a delegated call with its physical cwd and execs git`: `git rev-parse --show-toplevel` exits 0; `readShimLog(sb.logs, 'git')` is `[{ tag: 'delegated', cwd: sb.proj, argv: ['rev-parse', '--show-toplevel'] }]`.
  - `the git shim refuses -C - through a symlink named -`: `fs.symlinkSync(REPO, path.join(sb.proj, '-'))`; `git -C - rev-parse HEAD` (cwd `sb.proj`) exits 97, stderr starts `git-shim: refused (outside the sandbox: `.
  - `the git shim normalizes an unresolvable relative -C`: `git -C ./missing/../gone/ status` (cwd `sb.proj`) → exit 97, stderr `git-shim: refused (unresolvable directory ${sb.proj}/gone): -C ./missing/../gone/ status\n`.
  - `the git shim requires QP_LOG_DIR`: with `QP_LOG_DIR: ''` → exit 97, stderr `git-shim: QP_LOG_DIR is required\n`.
  - `setScenario regenerates the git fail prefixes`: after `sb.setScenario({ ...S0(), gitFail: [['status']] })`, `git status` exits 128 with `git-shim: injected failure: status\n`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/bin-lib/dispatch/queue-pull-shims.test.js`
Expected: FAIL (the shebang test fails first: `bin/git` is a node script)

- [ ] **Step 3: Implement** the generator in `queue-pull-oracle.js` as `gitShimScript({ root, realGit, table })` → string, called by `writeShims`. Remove `gitShim` and its `ALLOWED_CONFIG_KEYS`/`refusedConfig` helpers and the `git` branch of `shimMain`. Keep `gitSubArgv`, `gitFailMatch` and `isGetUrlOrigin` in `queue-pull-fixtures.js`: `fakeRun` still uses them. Add `<root>/shim` to `createSandbox` and update the header comment's `<root>/bin` lines.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test tests/bin-lib/dispatch/queue-pull-shims.test.js`
Expected: PASS
Run: `node --test --test-name-pattern "#5227 oracle: the git shim" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS, 3 tests (their stderr and log assertions are unchanged)

- [ ] **Step 5: Prove each new test can fail.** Commit the implementation first (Step 6), then mutate the generator or reader code in `queue-pull-oracle.js` (never a generated file: `createSandbox` regenerates it) only in a scratch checkout of that commit, per the dispatch prompt's scratch-checkout steps — never in this shared worktree — run the named test there, see it red, and tear the scratch checkout down. Quote each red run's failing assertion line in your report. One mutant per new test: `#!/bin/bash` shebang (shebang test); plain `cd` for `cd -P` (symlink test); resolve `-C` lexically without the physical walk (chained test); pass an empty `-C` to `cd` (empty `-C` test); check config keys before the unknown option (precedence test); drop the `./` prefix (`-C -` test); skip normalization (unresolvable test); `exec` before logging (delegated test); drop the `QP_LOG_DIR` check (required test); bake the table once in `createSandbox` instead of in `setScenario` (setScenario test). Also make the config `case` match `core.*` and see the existing ten-setting test in `queue-pull.test.js` go red.

- [ ] **Step 6: Commit** the oracle and the new test file, subject `Write the queue-pull oracle's git shim as sh — exec the real git, no node start`.

### Task 3: The mktemp shim as sh, and bin/node on /bin/sh

**Role:** integration

**Files:**
- Modify: `tests/bin-lib/dispatch/queue-pull-oracle.js` (`writeShims`, `mktempShim` ~867-884 removed, `shimMain`, `nodeShim` ~296 shebang)
- Test: `tests/bin-lib/dispatch/queue-pull-shims.test.js`

**Interfaces:**
- Consumes: `writeShims` from Task 2.
- Produces: `bin/mktemp` (`#!/bin/sh`) with `mktempShim`'s contract: any argument → refuse `arguments are not supported`; `TMPDIR` or `QP_TMPNAME_COUNTER_FILE` empty → refuse `TMPDIR and QP_TMPNAME_COUNTER_FILE are required`; an absent or empty counter file is 0 (today's `Number('')` and the module's `tmpName` seam both read empty as 0); otherwise its content (as `read` gives it) must be one or more digits, else refuse `counter file holds "{content}"` (wrapped in double quotes as `JSON.stringify` printed it; content with quotes or backslashes need not be escaped — the text is a diagnostic); leading zeros are stripped before `$((n + 1))`; the next name is `{TMPDIR}/tmp.qp{n+1, %08d}`, created exclusively with mode 0600 (`umask 077`, `set -C`, `true 2>/dev/null > "$f"`). If that file already exists → refuse `file exists: {path}` (a deliberate new behaviour: today's node shim dies with an uncaught EEXIST, exit 1). Then write `n+1` to the counter file and print the path plus a newline. `bin/node` keeps its body with `#!/bin/sh` as the first line.

- [ ] **Step 1: Write the failing tests** in `queue-pull-shims.test.js` (spawn `bin/mktemp` from a `createSandbox(S0())` with `sb.runEnv({ tmpdir, sessionId })`):
  - `the mktemp shim is a sh script and counts`: first line `#!/bin/sh`; two calls print `{tmpdir}/tmp.qp00000001` and `{tmpdir}/tmp.qp00000002`; each file exists with `(stat.mode & 0o777) === 0o600`; the counter file holds `2`.
  - `the mktemp shim reads a leading-zero counter as decimal`: counter file `08` → prints `tmp.qp00000009`; an empty counter file → prints `tmp.qp00000001`.
  - `the mktemp shim refuses`: an argument (`-d`) → exit 97, stderr `mktemp-shim: refused (arguments are not supported): -d\n`; counter `abc` → stderr `mktemp-shim: refused (counter file holds "abc"): \n`; an existing next file → exit 97, stderr starts `mktemp-shim: refused (file exists: `.
  - `bin/node is a sh script`: first line `#!/bin/sh`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/bin-lib/dispatch/queue-pull-shims.test.js`
Expected: FAIL (`bin/mktemp` is a node script)

- [ ] **Step 3: Implement** `mktempShimScript()` → string, written by `writeShims`; remove `mktempShim` and its `shimMain` branch; change `nodeShim`'s first line to `#!/bin/sh`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test tests/bin-lib/dispatch/queue-pull-shims.test.js`
Expected: PASS

- [ ] **Step 5: Prove each new test can fail.** Commit the implementation first (Step 6), then mutate the generator or reader code in `queue-pull-oracle.js` (never a generated file: `createSandbox` regenerates it) only in a scratch checkout of that commit, per the dispatch prompt's scratch-checkout steps — never in this shared worktree — run the named test there, see it red, and tear the scratch checkout down. Quote each red run's failing assertion line in your report. Mutants: drop `umask 077` (mode assertion red); keep leading zeros (leading-zero test red); refuse an empty file (empty-counter assertion red); drop `set -C` (existing-file refusal red); drop the argument check (argument refusal red); `#!/bin/bash` for bin/node (bin/node shebang test red).

- [ ] **Step 6: Commit**, subject `Write the queue-pull oracle's mktemp shim as sh — same counter seam as the module's tmpName`.

### Task 4: The gh shim as sh with a node fallback, and the prose that described the old cost

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `tests/bin-lib/dispatch/queue-pull-oracle.js` (`writeShims`, `ghShim` ~797 kept as the fallback, `shimMain`, header comment ~9 and ~20)
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (header comment lines ~13-14 and `ghAnswer`'s comment ~66: "The one matcher the PATH shim and fakeRun share")
- Modify: `.claude/skills/skill-prose-conformance-tests/whole-fence-parity-oracle.md` (rule 4 and the "Cost to plan for" paragraph)
- Test: `tests/bin-lib/dispatch/queue-pull-shims.test.js`

**Interfaces:**
- Consumes: `writeShims`, the record framing, `shimTable`, `ghAnswer`, the fixtures' scenario builders (`S0`, `S1`, `S2`, `SEmpty`, `SMalformed`, `SPortable`, `D1Second`, `S1LiveDep`, `FAULTS`).
- Produces: `bin/gh` (`#!/bin/sh`) and `<shimDir>/gh-fallback` (`#!{process.execPath}` requiring this module and calling `shimMain('gh')`, today's node shim moved off PATH). `bin/gh` holds one `if` arm per table entry with an `argv` array and no `effect`, in table order: `[ $# -eq {n} ] && [ "$1" = {shQuote(a0)} ] && …` (positional 10 and up as `${10}`). On a hit it appends one `SHIM_LOGS.gh` record (tag `injected` when `status` is non-zero, else `ok`, empty `why` and `cwd`), writes `stdout` then `stderr` (`printf '%s'`, values through `shQuote`), and exits with `status` (default 0). Large stdouts may live in a per-entry file under `shimDir` that the arm sources with `.`; never `cat` (a spawn). A miss on every arm `exec`s `gh-fallback "$@"`, so `api graphql`, effect entries and unmatched calls keep today's node path, `UNHANDLED` and exit 97 included.

- [ ] **Step 1: Write the failing tests** in `queue-pull-shims.test.js`:
  - `the gh shim is a sh script`: first line of `sb.bin/gh` is `#!/bin/sh`; `gh-fallback` is not in `sb.bin`.
  - `the sh gh shim agrees with ghAnswer on every exact entry`: for each scenario in `[S0(), S1(), S1({ full: true }), S1({ parity: true }), S2(), SEmpty(), SMalformed(), SMalformed('labels'), SMalformed('body'), SMalformed('blocker'), SPortable(), D1Second(), S1LiveDep(), ...FAULTS.map((f) => f.scenario())]`, write the shims into a fresh temp root with `writeShims`; then, for each distinct effect-free `argv` entry, spawn `bin/gh` with that argv (env: `PATH` the bin plus `/usr/bin:/bin`, `QP_LOG_DIR`, `QP_SHIM_TABLE` holding the table JSON). Assert stdout, stderr and status equal `ghAnswer(table.gh, argv)`, the last log record's tag is `injected`/`ok` to match, and at least one checked argv has 10 or more elements (so the `${10}` form is exercised). Dedupe identical `(argv, answer)` pairs across scenarios to keep the spawn count down.
  - `a near miss of an exact entry falls back and fails loudly`: `QUEUE_ARGV` with its last element changed, and `QUEUE_ARGV` plus one trailing element, each → exit 97, stderr `gh-shim: no canned response for: …`, last record tag `UNHANDLED`.
  - `setScenario regenerates the gh answers`: a sandbox whose table answers `['probe']` with `a\n`; after `sb.setScenario` with an entry answering `['probe']` with `b\n`, `gh probe` prints `b\n`.
  - The existing `#5227 oracle: the gh shim exits 97 and logs UNHANDLED…` test in `queue-pull.test.js` stays unchanged and must pass (its graphql calls and its effect entry go through the fallback).

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/bin-lib/dispatch/queue-pull-shims.test.js`
Expected: FAIL (`bin/gh` is a node script)

- [ ] **Step 3: Implement** `ghShimScript({ shimDir, table })` and the fallback file in `writeShims`; `shimMain` keeps only `gh`. Update the comments: the oracle header (`<root>/bin` and `<root>/shim` lines; "The shim files re-enter this module through shimMain()" becomes "the gh fallback re-enters …"); `queue-pull-fixtures.js` lines 13-14 and the `ghAnswer` comment, saying the sh shim answers exact effect-free entries generated from the same table and `ghAnswer` stays the matcher for graphql, effects and misses; the parity skill's rule 4 (one added sentence: the shims are generated `sh` scripts and an exact gh entry is answered without a node start) and its "Cost to plan for" paragraph (the 470 s and 8,539 figures are #5227's, before #5366; name what is still a node start: the fence's own CLIs and graphql/effect gh calls). Keep the edits to those sentences.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test tests/bin-lib/dispatch/queue-pull-shims.test.js`
Expected: PASS
Run: `node --test --test-name-pattern "#5227 oracle: the gh shim" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS

- [ ] **Step 5: Prove each new test can fail.** Commit the implementation first (Step 6), then mutate the generator or reader code in `queue-pull-oracle.js` (never a generated file: `createSandbox` regenerates it) only in a scratch checkout of that commit, per the dispatch prompt's scratch-checkout steps — never in this shared worktree — run the named test there, see it red, and tear the scratch checkout down. Quote each red run's failing assertion line in your report. Mutants: `#!/bin/bash` (shebang test); `[ $# -ge {n} ]` for `-eq` (near-miss test, over-length argv, red); swap stdout and stderr in the arm (agreement test red); tag `ok` regardless of status (agreement test red); write `bin/gh` once in `createSandbox` only (setScenario test red).

- [ ] **Step 6: Commit** the four files, subject `Write the queue-pull oracle's gh shim as sh — exact answers without a node start, node fallback for graphql and misses`.

### Task 5: Whole-file verification

**Role:** transcription

**Files:**
- Test: `tests/bin-lib/dispatch/queue-pull.test.js`, `tests/bin-lib/dispatch/queue-pull-shims.test.js`

- [ ] **Step 1: Run the parity file whole**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js > {scratch}/qp-full.txt 2>&1; echo exit=$?`
Expected: `exit=0`, the TAP summary shows `# fail 0` and `# skipped 0`

- [ ] **Step 2: Run the shim file**

Run: `node --test tests/bin-lib/dispatch/queue-pull-shims.test.js`
Expected: PASS, 0 skipped. (macOS `/bin/sh` is bash in POSIX mode; the dash leg is PR CI on ubuntu, whose `/bin/sh` is dash, and is the binding proof for it.)

## Post-execution (controller, not dispatched)

- AC5's measurement: re-run `tests/bin-lib/dispatch/queue-pull.test.js` with the scratch counting preload and `/usr/bin/time -l` exactly as the baseline run did (baseline taken at 79cd5710d before Task 1), and quote both runs' node starts by class, wall time and user+sys CPU in the PR body with the commands. Nothing from the measurement is committed.
- AC6: #5319's body already points its moved bullet at #5366 (edited 2026-11-13). The diff outside `tests/bin-lib/dispatch/` is this plan, the ledger, the materialized spec and the parity skill's sentences (Task 4) — AC6 as amended at plan review.
