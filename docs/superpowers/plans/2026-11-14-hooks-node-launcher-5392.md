# Node-Resolving Hooks Launcher Implementation Plan (#5392)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `hooks.json` registration runs through a POSIX `sh` launcher that finds `node` even when the session's PATH lacks it. When no node can be found, the launcher warns the session and, under `worktree-always`, denies instead of letting every guard fail open.

**Architecture:** `plugin/bin/hooks.sh` resolves its own directory from `$0` and tries `command -v node`, then the path `session-start` saved in `~/.claude-tweaks/node-path`, then a fixed well-known list, and `exec`s the first hit on `hooks.js "$@"`. With no hit it drains stdin, prints fixed JSON literals (a warning on `session-start`/`user-prompt-submit`, and a deny on `pre-tool-use` when the main checkout's policy turns `worktree-always` on and the payload's `tool_name` is Bash, Edit, Write or NotebookEdit), and exits 0. An awk mirror of `parseFlatLines` makes the policy call, and a differential test pins it to `resolveWorktreeAlways`.

**Tech Stack:** POSIX `sh` (dash, bash 3.2, Git Bash), POSIX awk, Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-14T095432-spec-5393-5392/spec-5392/work/5392-spec.md`. Only the upper half binds. The "Original request" section is history, and its Open Question is decided: deny only under `worktree-always`.

Scope keywords: hooks.sh, node-path, CLAUDE_TWEAKS_NODE_CANDIDATES, saveNodePath

## Global Constraints

- The registration form is exactly `sh "${CLAUDE_PLUGIN_ROOT}/bin/hooks.sh" <event>`, each registration's event verb unchanged (20 entries).
- `hooks.sh` is POSIX `sh` and must run under dash (ubuntu `/bin/sh`) and bash 3.2 (macOS `/bin/sh`). Banned: `[[`, `local`, `function`, arrays, `$'…'`, `source`, `echo -e`, `<(…)`, `${v//…}`, `==` in `[ ]`. No `set -e` and no `set -u`.
- Its directory comes from `dir=${0%/*}`, with `dir=.` when `$0` holds no `/`. The registration always ends in `/bin/hooks.sh`, so the last separator is a `/` on Windows too. Every test invokes the launcher with that same spelling: `path.join(ROOT, 'plugin') + '/bin/hooks.sh'`.
- When a node is found: `exec <node> "$dir/hooks.js" "$@"`. Nothing before the exec reads stdin, and nothing before it writes to stderr, so stdout, stderr and exit status are exactly `hooks.js`'s. The saved-path read is `{ IFS= read -r p < "$f"; } 2>/dev/null`, and `default_candidates`' nvm alias read is `{ IFS= read -r a < "$nvm/alias/default"; } 2>/dev/null`: a bare `IFS= read -r p < "$f"` on a missing file prints `No such file` (bash 3.2, bash) or `cannot open` (dash) to stderr, measured at plan revision.
- First hit wins (spec Deliverables: "On a hit it `exec`s that node"). A hit that cannot run `hooks.js` (an asdf or mise shim with no version set, a Node older than 18) is not probed and no later rung is tried: it fails as before, a non-blocking error with every guard off, and `docs/hooks.md` says so (settled by plan review, round 2).
- When no node is found, the launcher drains stdin to EOF and ends with `exit 0` on every path. Only `pre-tool-use` under a policy-on root reads stdin before the drain, through `tool_class`'s fixed awk pattern on `tool_name` (Task 2); the `cat >/dev/null 2>&1` that follows is the drain on every path. It prints only fixed single-quoted JSON literals through `printf '%s\n' '…'`, and no input is ever interpolated: `tool_class` prints only `write` or `other`. The literals contain no `'` character.
- The no-node `pre-tool-use` deny covers Bash, Edit, Write and NotebookEdit only (plan review Q1 ruling, spec Current State). AskUserQuestion, Agent, Task and ExitWorktree get empty stdout, so the model can still ask the user or leave the worktree; the subagents Agent and Task spawn hit the same no-node hook.
- The test seam is one env var, `CLAUDE_TWEAKS_NODE_CANDIDATES`. When set (empty included), its value replaces the whole well-known list: every rung after the saved path. The value holds one absolute path per line, and an empty value means no candidates. It never replaces `command -v node` or the saved-path rung.
- The saved path lives in `$HOME/.claude-tweaks/node-path` (shell) and `path.join(process.env.HOME || os.homedir(), '.claude-tweaks', 'node-path')` (Node), so the writer uses the home the launcher reads on every platform: on win32 `os.homedir()` is `USERPROFILE`, which a user-set Git Bash `HOME` can differ from (settled by plan review, round 2). Its content is `process.execPath + '\n'`.
- The main checkout follows `wtDetect.mainCheckoutRoot` semantics from the hook process's own cwd (`pwd -P`), falling back to that cwd when unresolved. The stdin JSON's `cwd` is never parsed (plan review Q2 ruling, spec Current State): escaped quotes or backslashes in a path would break a shell pattern on a path that must never break. Accepted risk, stated in `docs/hooks.md` in the form Task 2 Step 0's probe outcome selects (Task 5's `{PROBE SENTENCE}` variants): after a `cd` into a different repository, the shell reads that repository's policy (or, if the process cwd does not follow the `cd`, the starting repository's), while the SessionStart/UserPromptSubmit warning still fires. The policy file is `{root}/.claude-tweaks/policy.yml`, and an empty root reads as `off`.
- `plugin/.gitattributes` carries `bin/hooks.sh text eol=lf`. It ships inside the payload, so a marketplace `git-subdir` clone under `core.autocrlf=true` still checks the script out LF. `sh` cannot run a CRLF script.
- **windows-checkout-test-parity, quoted:** "Pointing a spawned child at a fixture home with `HOME` alone (`env: { ...process.env, HOME: home }`) | `os.homedir()` reads `USERPROFILE` on win32 … `tests/helpers/fixture-home.js`'s shared `fixtureHomeEnv` does both — require it rather than re-implementing it"
- **windows-checkout-test-parity, quoted:** "A test that needs a `PATH` holding only real binaries (`git` but not `gh`) builds it with `pathWithOnly` from the same helper, and keeps running on Windows. … `tests/path-stub-helper.test.js` keeps `:`-joined PATHs out of `tests/`: join with `path.delimiter`."
- **windows-checkout-test-parity, quoted:** "Reading `env.PATH` from a `{ ...process.env }` copy … win32's `process.env` is a case-insensitive proxy whose stored key is `Path`." The env builders delete every key matching `/^path$/i` before setting `PATH`.
- **windows-checkout-test-parity, quoted:** "Passing a literal `/bin/sh` to `execFileSync`/`spawnSync` | On win32 it resolves to `<drive>:\bin\sh` and throws `ENOENT`". Tests resolve `sh`, `dash` and `bash` from `PATH`.
- **windows-checkout-test-parity, quoted:** "A test that pins one shell's behaviour skips where that shell is missing, and a skip on the merge gate is the same blind spot … the workflow has to install the shell." `ubuntu-latest` ships dash as `/bin/sh` and ships bash, so the merge gate never skips the dash or bash variants. Only windows-latest skips dash, with a stated reason.
- **windows-checkout-test-parity, quoted:** "Simulating an unreadable file or directory with `fs.chmodSync(path, 0o000)` … Pass `chmodDenialSkip('{root reason}')` from `tests/helpers/root.js` … `tests/permission-sim-root-skip-conformance.test.js` requires it of every file that calls `chmodSync(`, unless every chmod line is marked `// root-safe`."
- **windows-checkout-test-parity, quoted:** "Rewriting a file git created inside a copied or linked worktree (its `.git` pointer file) with `fs.writeFileSync` | Git for Windows marks `.git` hidden … Open the existing file `r+`, `ftruncateSync` it to 0, then `writeSync`".
- **skill-prose-conformance-tests, quoted:** "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`." `tests/raw-markdown-read-conformance.test.js` also flags a raw text read of `plugin/bin/hooks.sh`, so it goes through `readText` too. A Buffer read (`fs.readFileSync(p)`) is allowed.
- **skill-prose-conformance-tests, quoted:** "When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself." `tests/helpers/conformance-asserts.js`'s `missingFactsOf` and `assertEachPatternGoesRed` supply it.
- **bin-source-scan-conformance:** its stripper and `stripperVerdict` rules govern JS-text scans of `plugin/bin/**/*.js`. No task here adds one. Its rule that a test reading a `plugin/bin` source file goes through `readText` still applies.
- Every test title in `tests/hooks-launcher.test.js` starts with `hooks.sh `, so the Windows TAP log can be grepped for them (`ok N - hooks.sh …`).
- `session-start.js` uses neither `existsSync` nor `realpathSync`, because `tests/path-guard-conformance.test.js` counts both. Use `readFileSync` inside try/catch, `mkdirSync({ recursive: true })`, and `plugin/bin/lib/atomic-write.js`'s `writeFileAtomic`.
- No `plugin/skills/**` file changes, so the byte-pin rail is untouched.

Waived plugin/bin/lib/policy.js: read only. It supplies `resolveWorktreeAlways`, the oracle Task 2's differential test imports.
Waived plugin/bin/lib/policy-schema.js: read only. Task 2 Step 3's awk program mirrors its `parseFlatLines`, verified at plan time (below).
Waived plugin/bin/lib/hooks/worktree-detect.js: read only. Task 2's root-parity test imports its `mainCheckoutRoot` as the oracle.
Waived plugin/bin/lib/ports/registry.js: read only. Task 4 reuses its `~/.claude-tweaks/` home (`registryPath`'s `path.join(home, '.claude-tweaks', …)`).
Waived docs/incident-log.md: read only. `[IL-133]` is cited in Task 5's doc text and not edited.

**Plan-time facts (already established, cite them and do not re-derive):**
- Claude Code docs (code.claude.com/docs/en/hooks.md, "Exec form and shell form") say: "The `command` string is passed to a shell: `sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed." The same page ("Handler fields") says: "Handlers run in the current directory with Claude Code's environment." It also says the input JSON's `cwd` "follows Claude" after `EnterWorktree` and `cd`.
- The awk policy program, the `main_root` walk, `tool_class` and the saved-path read in Tasks 1–2 were re-run at plan revision (after the Q1/Q2 rulings), exactly as written below, under macOS `/bin/sh` (bash 3.2), `/bin/dash` and `/bin/bash`: 183 checks, `bad=0`. The policy program was checked against `resolveWorktreeAlways` on all 12 AC9 fixtures, the 6 edge fixtures and 14 Unicode fixtures (U+00A0, U+3000, U+2003, U+2028, U+202F, U+205F, U+1680, U+200A as leading, separating or trailing whitespace; U+FEFF and U+00A0 at line start; U+200B, U+0085 and a non-ASCII value byte, which `\s` does not cover). The walk was checked against `mainCheckoutRoot` on 12 cwd fixtures: main root, main subdir, linked worktree outside main and its subdir, harness worktree, relative-`gitdir` worktree, a CRLF `.git` file, a `.git` file whose `gitdir:` is its second line, a `chmod 000` `.git` file (both unresolved), non-repo dir, and non-repo subdir. `tool_class` was checked on the 8 registered tools, pretty-printed JSON, a `tool_name` string inside another tool's `tool_input`, `bash`, `BashX`, non-JSON, empty and a 2 MiB Write payload. The ASCII-only whitespace class of the first plan draft diverged from `\s` on the Unicode rows (plan review finding, `spec-5392/decisions.md` 18:15:11).
- `windows-regression.yml` TAP shape: run 43611162370's `verify-report` artifact `verify-logs/tests.log` carries `ok 20328 - hooks.json registers PostToolUseFailure for Bash, …`, so per-test lines are `ok N - {title}`. The probe was `gh run download 43611162370 --repo thn-inc/claude-tweaks -n verify-report -D {scratch}/win-probe`. `gh workflow run` has no read-only form and was not run, so it stays unverified until Task 6.

## Review Focus

1. **CRLF checkout of `hooks.sh`.** Git for Windows with `core.autocrlf=true` would check the script out CRLF, and `sh` then fails on every hook. The expected behavior is that it always checks out LF. Task 1's `hooks.sh AC11.1: hooks.sh is checked out LF` pins it.
2. **A saved node path whose binary was removed** (an nvm uninstall). The expected behavior is to skip to the next rung, never `exec` a missing file (exit 127). Task 1's `hooks.sh: a saved path naming a missing file falls through` pins it.
3. **A linked worktree whose `.git` holds a relative `gitdir:`** (`git worktree add --relative-paths`, git 2.48+). The expected behavior is that the policy is still read from the main checkout. Task 2's root-parity fixture R9 pins it.
4. **Policy lines the AC list omits:** an empty-valued `worktree-always:` after a `true` line, a tab separator, no space after the colon, an empty canonical line beside the alias. The expected behavior is the same verdict as the node gate. Task 2's `hooks.sh: policy edge cases agree with resolveWorktreeAlways` pins it.
5. **Paths with spaces** (`Code Workspaces`, `Program Files`, a `HOME` with a space). The expected behavior is that every rung still resolves. Task 1's saved-path tests use a home dir named `home with space`, and the suite runs from this repo's own spaced path.
6. **`tool_name` matched by a fixed pattern, not parsed** (injection input: the stdin JSON, which carries model-written text in `tool_input`). The expected behavior is a deny only for a top-level `"tool_name":"Bash|Edit|Write|NotebookEdit"` (optional space or tab around the colon), never for another tool whose `tool_input` string contains that text, since JSON escapes a `"` inside a string as `\"`. Nothing from stdin reaches stdout. Task 2's `hooks.sh: tool_name matching` pins it, and AC6.1 pins the four silent tools.
7. **Unicode whitespace in `policy.yml`** (a pasted NBSP or ideographic space). The expected behavior is the node gate's verdict, since `parseFlatLines` uses JS `\s`. Task 2's Unicode rows and the NBSP go-red control pin it.
8. **stderr when a rung misses** (no `~/.claude-tweaks/node-path`). The expected behavior is that the hook's stderr is exactly `hooks.js`'s. Task 1's `hooks.sh: a missing node-path file writes nothing to stderr` pins it.

Accepted, not tested: `tool_class` reads one line at a time, so a pretty-printer that puts `"tool_name"` and its value on separate lines would miss the match and allow (Claude Code sends the payload as one JSON line; the pretty-printed fixture keeps key and value on one line). A `.git` file whose `gitdir:` value is wrapped onto a following line, or padded with Unicode whitespace, is not mirrored (git never writes either). An unsearchable ancestor directory makes `main_root` return unresolved, as `mainCheckoutRoot`'s EACCES rule does, but no test can spawn a process whose cwd sits under it. `main_root` walks the physical `pwd -P` path, while the node gate walks the logical payload `cwd`; they differ only through a symlinked directory, which R13 pins against `mainCheckoutRoot(fs.realpathSync(cwd))`, the physical walk being the shell's accepted reading. Separately, any suite that spawns `hooks.js session-start` with the real `HOME` writes the test node's path into the developer's `~/.claude-tweaks/node-path`. That is the same write a real session start makes, and no caller's assertion depends on it. Task 4's Interfaces block records this classification.

Placeholders: `{wt}` is the run's worktree root, `{scratch}` is the session's scratchpad directory, and `{branch}` is the run's PR branch.

---

### Task 1: Launcher with node resolution

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/hooks.sh`
- Create: `plugin/.gitattributes`
- Create: `tests/hooks-launcher.test.js`

**Interfaces:**
- Produces (shell): `plugin/bin/hooks.sh <event> [args…]`. With a node found it is byte-identical to `node hooks.js <event> [args…]`. With none, it drains stdin, prints nothing and exits 0 for every event (Task 2 adds the messages).
- Consumes (test helpers): `gitRepo`, `linkedWorktreeOf` and `harnessWorktreeOf` from `tests/helpers/git-fixtures.js` (its `gitRepo` commits a HEAD, which `linkedWorktreeOf` needs; other helper files export a differently shaped `gitRepo`); `fixtureHomeEnv` from `tests/helpers/fixture-home.js`; `pathWithOnly` from `tests/helpers/path-stub.js`.
- Produces (test helpers, module-local in `tests/hooks-launcher.test.js`): `ROOT`, `LAUNCHER_ARG` (`path.join(ROOT, 'plugin') + '/bin/hooks.sh'`) and `HOOKS_JS`. `findOnPath(name) -> string | null` looks up `name`, plus `name.exe` on win32, along `process.env.PATH` split by `path.delimiter`. `SHELLS: Array<{ name, file }>` holds `sh` (required) plus `dash` and `bash` when found. `bareEnv(home) -> object` is `fixtureHomeEnv(home)` minus every `/^path$/i` key, `NVM_DIR`, `FNM_DIR` and `CLAUDE_TWEAKS_NODE_CANDIDATES`. `noNodeEnv(home, extra = {}) -> object` is `bareEnv(home)` plus `PATH: pathWithOnly(['sh', 'cat', 'awk'], { exclude: ['node'] })`, `CLAUDE_TWEAKS_NODE_CANDIDATES: ''` and `...extra`, and it throws unless `spawnSync(sh, ['-c', 'command -v node'], { env })` exits non-zero. `runLauncher(shell, args, { input = '', cwd = os.tmpdir(), env, launcher = LAUNCHER_ARG }) -> { status, stdout, stderr, error }` wraps `spawnSync` with `encoding: 'utf8'` and `windowsHide: true`. `fakeNode(dir, marker) -> string` writes an executable `#!/bin/sh` script that prints `marker`, then `cat >/dev/null`, with the chmod line marked `// root-safe`.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-launcher.test.js`. Each runs once per entry of `SHELLS` (title suffix ` [{name}]`), except the attribute test. A dash or bash entry that is missing reports as a named skip: `{ skip: !file && '{name} not on PATH (windows-latest Git Bash ships no dash)' }`.
  - `hooks.sh AC2.1: with node on PATH the output is byte-identical to node hooks.js`. PATH is `path.dirname(process.execPath)` prepended to the inherited PATH, and env carries `PIPELINE_RUN_DIR: ''` and `CT_HOOKS_TEST_MODE: '1'`. Three cases, each asserting `stdout` strictly equal and `status` equal between `runLauncher(sh, argv)` and `spawnSync(process.execPath, [HOOKS_JS, ...argv])` on the same input:
    - (a) `pre-tool-use` with a Bash `echo hi` payload (empty stdout).
    - (b) `pre-tool-use` with a Bash `git commit -m x` payload, cwd = a `gitRepo()` main checkout whose `.claude-tweaks/policy.yml` is `worktree-always: true` (a deny JSON; assert it is non-empty).
    - (c) `close-run --no-such-flag` (exit 1 on both, which proves `"$@"` carries several args).
  - `hooks.sh AC3.1: a saved node-path is used when PATH has no node`. `home = <tmp>/home with space`. Write `home/.claude-tweaks/node-path` as `process.execPath + '\n'`, then run `session-start` with input `{"session_id":"s","source":"startup"}` under `noNodeEnv(home)`. Assert exit 0 and that `JSON.parse(stdout).hookSpecificOutput.additionalContext` includes `INTERACTION_STYLE_DIRECTIVE` (imported from `plugin/bin/lib/hooks/interaction-style.js`) and does not include `restart Claude Code`.
  - `hooks.sh: a saved path naming a missing file falls through`. node-path is `<tmp>/gone/node\n`, and `CLAUDE_TWEAKS_NODE_CANDIDATES` = `fakeNode(…, 'list-hit')`. Assert stdout `list-hit\n`.
  - `hooks.sh: a missing node-path file writes nothing to stderr`. `home` has no `.claude-tweaks` directory, and `CLAUDE_TWEAKS_NODE_CANDIDATES` = `fakeNode(…, 'list-hit')`. Assert stdout `list-hit\n` and stderr `''`. This goes red without the `2>/dev/null` around the saved-path `read`.
  - `hooks.sh: a missing nvm alias file writes nothing to stderr`. Seam unset (`noNodeEnv(home)` with `CLAUDE_TWEAKS_NODE_CANDIDATES` deleted), `home` has no `.nvm` and no `.claude-tweaks`, and `fakeNode(home/.volta/bin, 'volta')`. Volta precedes every machine-state rung, so the result does not depend on the host. Assert stdout `volta\n` and stderr `''`. This goes red without the `2>/dev/null` around the nvm alias `read`.
  - `hooks.sh: the candidate seam is tried in order, first executable wins`. The seam holds three lines: `<tmp>/missing`, `fakeNode(a, 'first')` and `fakeNode(b, 'second')`. Assert `first\n`.
  - `hooks.sh: nvm default alias naming a literal version dir wins over volta`. Unset the seam: `noNodeEnv(home)` with `CLAUDE_TWEAKS_NODE_CANDIDATES` deleted. Write `home/.nvm/alias/default` = `v99.0.0\n` with `fakeNode(home/.nvm/versions/node/v99.0.0/bin, 'nvm')`, and also `fakeNode(home/.volta/bin, 'volta')`. Assert `nvm\n`. Then, with the alias set to `99.0.0`, assert `nvm\n`, which pins the `v` prefix. With `lts/*`, assert `volta\n`. With `22` (no `v22` dir), assert `volta\n`.
  - `hooks.sh: fnm default alias is tried last`. Skip when `/opt/homebrew/bin/node` or `/usr/local/bin/node` is a file. The reason states that the fixed rungs ahead of fnm are machine state; ubuntu-latest has `/usr/local/bin/node`, so CI skips. Set `FNM_DIR=<tmp>/fnm` with `fakeNode(FNM_DIR/aliases/default/bin, 'fnm')`, unset the seam, and give no nvm or volta in home. Assert `fnm\n`.
  - `hooks.sh AC8.1 (drain): the no-node branch reads stdin to EOF`. Run `post-tool-use` under `noNodeEnv` with a 2 MiB input. Assert `error` is undefined, status is 0 and stdout is `''`. This goes red with `EPIPE` when the `cat` drain is removed.
  - `hooks.sh AC11.1: hooks.sh is checked out LF`. `git -C ROOT check-attr eol -- plugin/bin/hooks.sh` prints `plugin/bin/hooks.sh: eol: lf`, and `fs.readFileSync(<hooks.sh>)` (a Buffer) has no byte `13`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-launcher.test.js`
Expected: FAIL. `sh` cannot open `plugin/bin/hooks.sh` (exit 127, or `No such file`), and `check-attr` prints `eol: unspecified`.

- [ ] **Step 3: Implement `plugin/bin/hooks.sh` and `plugin/.gitattributes`.**

`plugin/.gitattributes`: one line, `bin/hooks.sh text eol=lf`.

`hooks.sh` structure, in order:
1. A header comment naming #5392, the never-break-a-session invariant (`docs/hooks.md`), the POSIX constraint, the seam, and the Windows shell fact with its source.
2. `dir`/`hooks_js`.
3. `if command -v node >/dev/null 2>&1; then exec node "$hooks_js" "$@"; fi`.
4. Saved path: `p=`, then read the first line of `$HOME/.claude-tweaks/node-path` with `{ IFS= read -r p < "$HOME/.claude-tweaks/node-path"; } 2>/dev/null` (a missing trailing newline still counts; a missing file prints nothing), then `exec "$p" "$hooks_js" "$@"` when `[ -n "$p" ] && [ -f "$p" ] && [ -x "$p" ]`.
5. A `default_candidates` function. It prints one path per line: the nvm rungs (`nvm=${NVM_DIR:-$HOME/.nvm}`; `a=`, then the first line of `alias/default` through `{ IFS= read -r a < "$nvm/alias/default"; } 2>/dev/null`; skipped when empty or containing `/`; candidates `versions/node/$a/bin/node`, then `versions/node/v$a/bin/node` unless `$a` starts with `v`), `$HOME/.volta/bin/node`, `/opt/homebrew/bin/node`, `/usr/local/bin/node`, then fnm (`$FNM_DIR/aliases/default/bin/node` when `FNM_DIR` is set, else `$HOME/.local/share/fnm`, `$HOME/Library/Application Support/fnm` and `$HOME/.fnm`, each `/aliases/default/bin/node`).
6. The candidate loop below. It runs at top level, so `"$@"` stays the script's own arguments.
7. The no-node branch: `cat >/dev/null 2>&1`, then `exit 0`. Task 2 adds the `pre-tool-use` check before the `cat` and the message `case` between the `cat` and `exit 0`.

```sh
if [ "${CLAUDE_TWEAKS_NODE_CANDIDATES+set}" = set ]; then cands=$CLAUDE_TWEAKS_NODE_CANDIDATES
else cands=$(default_candidates)
fi
nl='
'
saved_ifs=$IFS; IFS=$nl; set -f
for c in $cands; do
  if [ -f "$c" ] && [ -x "$c" ]; then IFS=$saved_ifs; set +f; exec "$c" "$hooks_js" "$@"; fi
done
IFS=$saved_ifs; set +f
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-launcher.test.js`
Expected: PASS. On macOS the `[sh]` entries exercise bash 3.2 and `[dash]` exercises dash. The fnm test reports its named skip on machines with Homebrew or `/usr/local` node.

- [ ] **Step 5: Commit**

```bash
git -C "{wt}" add plugin/bin/hooks.sh plugin/.gitattributes tests/hooks-launcher.test.js
git -C "{wt}" commit -m "Add the node-resolving hooks launcher — PATH, saved path, then well-known installs" -m "refs #5392"
```

### Task 2: No-node branch messages, main-checkout policy check, differential

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/hooks.sh`
- Test: `tests/hooks-launcher.test.js`

**Interfaces:**
- Consumes: Task 1's `noNodeEnv`, `runLauncher`, `SHELLS`, `LAUNCHER_ARG`.
- Produces (shell functions in `hooks.sh`): `main_root` prints the main checkout root and returns 0, or returns 1 (unresolved). `policy_verdict <root>` prints `on` or `off`. `tool_class` reads stdin to EOF and prints `write` when a line matches `"tool_name"[ \t\r]*:[ \t\r]*"(Bash|Edit|Write|NotebookEdit)"`, else `other`.
- Produces (test helpers): `policyDir(content | null) -> dir` makes a fresh non-repo temp dir, with `.claude-tweaks/policy.yml` holding `content` unless `null`. `toolPayload(tool_name, tool_input = {}, cwd) -> string` is `JSON.stringify({ tool_name, tool_input, cwd })`. `verdictOf(shell, cwd, launcher = LAUNCHER_ARG) -> 'on' | 'off'` runs no-node `pre-tool-use` with a Bash payload. It returns `on` when stdout parses with `hookSpecificOutput.permissionDecision === 'deny'` and `off` when stdout is `''`, and throws on anything else or a non-zero status. `assertPolicyParity(fixtures, launcher = LAUNCHER_ARG)` takes rows `[id, content, expected]`. Per row and per shell it throws `policy parity: {id} [{shell}] shell={v} resolveWorktreeAlways={o}` when `verdictOf ≠ resolveWorktreeAlways(dir).on`, and `oracle drift: {id}` when the oracle ≠ `expected`.

- [ ] **Step 0: Record whether the hook process cwd and the payload `cwd` diverge (plan review Q2 ruling: the no-node branch resolves the main checkout from the process cwd and never parses `cwd` from stdin; this probe's result is what `docs/hooks.md` documents).** Build a scratch plugin `{scratch}/cwd-probe/` holding `.claude-plugin/plugin.json` = `{"name":"cwd-probe","version":"0.0.0"}` and `hooks/hooks.json`. The hooks.json registers one `PreToolUse` `Bash` command: `sh -c 'pwd -P >> "{scratch}/cwd-probe.txt"; cat >> "{scratch}/cwd-probe.txt"; echo >> "{scratch}/cwd-probe.txt"'`. Then, from a scratch git repo with a `sub/` dir, run `claude -p --plugin-dir "{scratch}/cwd-probe" --allowedTools Bash "Run two Bash calls, one per call: cd sub, then pwd"`. This exact command is unverified: it has no read-only form and was not run at plan time. Compare each logged `pwd -P` line with the payload's `cwd`. Record the outcome as one `decisions.md` `AC evidence` entry and the raw log at `$PIPELINE_RUN_DIR/evidence/hook-cwd-probe.txt`. Either outcome keeps the design: the main checkout resolved from either directory is the same unless a session `cd`s into a different repository. Task 5 writes the matching sentence. If the harness refuses the `claude -p` launch, log the downgrade explicitly ("hook cwd: docs citation only, live probe not run — {reason}") instead of a result.

- [ ] **Step 1: Write the failing tests** (each per `SHELLS` entry):
  - `hooks.sh AC4.1: no node: session-start and user-prompt-submit print one warning object`. `noNodeEnv(<empty tmp home>)`, stdin `not json`. For each event, assert status 0, that `stdout.trim()` is one line, that `JSON.parse` gives `Object.keys` deep-equal `['hookSpecificOutput']`, and that `hookEventName` is `SessionStart` or `UserPromptSubmit`. Assert `additionalContext` includes each of `restart Claude Code`, ``no `node` was found``, `Every claude-tweaks guard is off` and `stop making repository edits`.
  - `hooks.sh AC5.1: no node + worktree-always: pre-tool-use denies Bash, Edit, Write, NotebookEdit from main and from a linked worktree`. `main = gitRepo()`, with `main/.claude-tweaks/policy.yml` = `worktree-always: true\n` written but never committed, and `wt = linkedWorktreeOf(main)`. Precondition: `!fs.existsSync(wt/.claude-tweaks/policy.yml)` — test code may use `existsSync`. For cwd ∈ {main, wt} × the four tool payloads (`toolPayload(name, {}, cwd)`), assert status 0, `permissionDecision === 'deny'`, `hookEventName === 'PreToolUse'`, and `permissionDecisionReason` includes `restart Claude Code`.
  - `hooks.sh AC6.1: no node + worktree-always: pre-tool-use is silent for AskUserQuestion, Agent, Task, ExitWorktree`. The AC5.1 `main` and `wt`. For cwd ∈ {main, wt} × those four tool payloads, assert status 0 and stdout `''`. (It passes against Task 1's launcher, which prints nothing; AC5.1 is what makes the pair discriminate.)
  - `hooks.sh: tool_name matching`. cwd is the AC5.1 `main`. Rows `[id, input, expected]`, `deny` meaning a parsed `permissionDecision === 'deny'` and `silent` meaning stdout `''`, every row with status 0 and no spawn `error`:
    - `pretty`: `JSON.stringify({ tool_name: 'Bash', tool_input: {} }, null, 2)` → deny
    - `nested-string`: `toolPayload('AskUserQuestion', { q: '{"tool_name":"Bash"}' }, main)` → silent
    - `lowercase`: `toolPayload('bash', {}, main)` → silent
    - `prefix`: `toolPayload('BashX', {}, main)` → silent
    - `not-json`: `not json` → silent
    - `empty`: `''` → silent
    - `big`: `toolPayload('Write', { content: 'x'.repeat(2 * 1024 * 1024) }, main)` → deny (and no `EPIPE`: the awk read is the drain)
  - `hooks.sh AC7.1: no node: pre-tool-use is silent when the policy is absent or false`. A `gitRepo()` with no policy file, and one with `worktree-always: false`. Assert status 0 and stdout `''`.
  - `hooks.sh AC8.1: no node: the five other events are silent`. cwd is the AC5 policy-on main. For `session-end`, `pre-compact`, `post-tool-use`, `post-tool-use-failure` and `subagent-stop`, assert status 0 and stdout `''`.
  - `hooks.sh AC9: the shell policy check agrees with resolveWorktreeAlways` runs `assertPolicyParity(AC9_FIXTURES)` over exactly these 12 rows:

| id | content | expected |
|---|---|---|
| AC9.1 | `worktree-always: true\n` | on |
| AC9.2 | `worktree-always: true  # comment\n` | on |
| AC9.3 | `worktree-always: false\n` | off |
| AC9.4 | `worktree-always: true garbage\n` | off |
| AC9.5 | `worktree-always: "true"\n` | off |
| AC9.6 | `  worktree-always: true\n` | off |
| AC9.7 | `# policy\r\nworktree-always: true\r\n` | on |
| AC9.8 | `worktree-always: true\nworktree-always: false\n` | off |
| AC9.9 | `worktree.always: true\n` | on |
| AC9.10 | `worktree.always: true\nworktree-always: false\n` | off |
| AC9.11 | `''` (empty file) | off |
| AC9.12 | `null` (no file) | off |

  - `hooks.sh AC9 go-red: deleting \r from the whitespace class flips AC9.7`. `readText` the launcher and assert it contains the literal `ws = "([ \t\r\f\v]|` exactly once. Write a copy with that literal replaced by `ws = "([ \t\f\v]|` to `<tmp>/hooks.sh`, and assert the copy differs. Then `assert.throws(() => assertPolicyParity(AC9_FIXTURES, copy), /policy parity: AC9\.7 /)`.
  - `hooks.sh: policy edge cases agree with resolveWorktreeAlways` runs `assertPolicyParity` over `worktree-always: true\nworktree-always:\n` (on), `worktree-always:\ttrue\n` (on), `worktree-always:true\n` (on), `worktree-always:\nworktree.always: true\n` (on), `worktree-always-x: true\n` (off) and `worktree-always: true#x\n` (on).
  - `hooks.sh: Unicode whitespace in policy.yml agrees with resolveWorktreeAlways` runs `assertPolicyParity` over `UNICODE_FIXTURES`, written as JS `\u` escapes: U1 `worktree-always: true\n` (on), U2 `worktree-always: true \n` (on), U3 ` worktree-always: true\n` (off), U4 `﻿worktree-always: true\n` (off), U5 `worktree-always: true　\n` (on), U6 `worktree-always: true\n` (on), U7 `worktree-always: true \n` (on), U8 `worktree-always: true # c\n` (on), U9 `worktree-always: true \n` (on), U10 `worktree-always: true \n` (on), U11 `worktree-always: true \n` (on), U12 `worktree-always: true​\n` (off), U13 `worktree-always: trué\n` (off), U14 `worktree-always: true\u0085\n` (off).
  - `hooks.sh go-red: dropping NBSP from the whitespace class flips U1`. Same shape as the AC9 go-red: the literal `\302\240|` occurs exactly once; a copy without it must make `assertPolicyParity(UNICODE_FIXTURES, copy)` throw `/policy parity: U1 /`.
  - `hooks.sh: the policy is read from mainCheckoutRoot(cwd) || cwd`. For each fixture, assert `verdictOf(cwd) === (resolveWorktreeAlways(mainCheckoutRoot(cwd) || cwd).on ? 'on' : 'off')`, and assert the expected literal:
    - R1 main (on)
    - R2 `main/a/b` (on)
    - R3 `linkedWorktreeOf(main)` (on)
    - R4 R3's `x/y` subdir (on)
    - R5 `harnessWorktreeOf(main)` (on)
    - R6 `policyDir('worktree-always: true\n')` (on, precondition `mainCheckoutRoot(dir) === null`)
    - R7 that dir's `sub/` (off)
    - R8 a second main with `worktree-always: false` whose linked worktree's own `.claude-tweaks/policy.yml` is `true` (off)
    - R9 R3-style worktree whose `.git` is rewritten in place (`r+`/`ftruncateSync`/`writeSync`) to `gitdir: ${path.relative(wt, admin)}` with `/` separators (on)
    - R10 R3-style worktree whose `.git` is rewritten in place to `gitdir: ${admin}\r\n` (on)
    - R11 R3-style worktree whose `.git` is rewritten in place to `# note\ngitdir: ${admin}\n` (on: `mainCheckoutRoot`'s `/m` regex reads any line, not only the first)
    - R12 R3-style worktree whose `.git` is `chmod 0o000`, in its own test under `chmodDenialSkip('root reads a mode-000 file')` (off: both sides resolve no root and fall back to the worktree, which has no `policy.yml`), restoring the mode in a `finally`
    - R13 a symlink outside any repo pointing at R3's `x/y` (`fs.symlinkSync(target, link, 'junction')`; the type is ignored on POSIX and needs no privilege on win32), with the oracle `resolveWorktreeAlways(mainCheckoutRoot(fs.realpathSync(link)) || fs.realpathSync(link))` (on): the spawned process's cwd is the physical directory, which is the walk the shell takes

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-launcher.test.js`
Expected: FAIL. AC4.1, AC5.1, AC9.1, AC9.2, AC9.7 and AC9.9, the `pretty` and `big` matching rows, the "on" Unicode rows, plus R1–R6 and R9–R11, get empty stdout where JSON or a deny is expected.

- [ ] **Step 3: Implement the no-node branch in `hooks.sh`** around Task 1's `cat` drain, in this order: the `pre-tool-use` check, the drain, the message `case`, `exit 0`.

```sh
deny=
if [ "$1" = pre-tool-use ]; then
  root=$(main_root) || root=
  [ -n "$root" ] || root=$(pwd -P 2>/dev/null)
  if [ "$(policy_verdict "$root")" = on ] && [ "$(tool_class)" = write ]; then deny=1; fi
fi
cat >/dev/null 2>&1
case $1 in
  session-start) printf '%s\n' '{…SessionStart literal…}' ;;
  user-prompt-submit) printf '%s\n' '{…UserPromptSubmit literal…}' ;;
  pre-tool-use) [ -z "$deny" ] || printf '%s\n' '{…deny literal…}' ;;
esac
exit 0
```

`tool_class` runs only under a policy-on root, so a policy-off session never runs awk over the payload. Every other event prints nothing. The three functions below were verified at plan revision (see Plan-time facts) and are written exactly as shown. `LC_ALL=C` makes awk match bytes, so the UTF-8 sequences in `ws` (U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF: the non-ASCII members of JS `\s`) behave the same under gawk, mawk and macOS awk:

```sh
policy_verdict() {
  [ -n "$1" ] && [ -f "$1/.claude-tweaks/policy.yml" ] || { printf '%s\n' off; return 0; }
  LC_ALL=C awk '
BEGIN {
  ws = "([ \t\r\f\v]|\302\240|\341\232\200|\342\200[\200-\212]|\342\200[\250\251\257]|\342\201\237|\343\200\200|\357\273\277)"
  hc = 0; ha = 0
}
{
  line = $0
  if (line ~ ("^" ws)) next
  sub(ws "+$", "", line)
  if (substr(line, 1, 16) == "worktree-always:") { v = substr(line, 17); k = "c" }
  else if (substr(line, 1, 16) == "worktree.always:") { v = substr(line, 17); k = "a" }
  else next
  sub(/#.*/, "", v)
  sub("^" ws "+", "", v)
  sub(ws "+$", "", v)
  if (v == "") next
  if (k == "c") { canon = v; hc = 1 } else { alias = v; ha = 1 }
}
END {
  r = "off"
  if (hc) { if (canon == "true") r = "on" }
  else if (ha) { if (alias == "true") r = "on" }
  print r
}' "$1/.claude-tweaks/policy.yml" 2>/dev/null || printf '%s\n' off
}

main_root() {
  d=$(pwd -P 2>/dev/null) || return 1
  while [ -n "$d" ]; do
    [ -x "$d" ] || return 1
    if [ -d "$d/.git" ]; then printf '%s\n' "$d"; return 0; fi
    if [ -f "$d/.git" ]; then
      [ -r "$d/.git" ] || return 1
      g=$(LC_ALL=C awk '{ if (sub(/^gitdir:[ \t\r\f\v]*/, "")) { sub(/[ \t\r\f\v]+$/, ""); if ($0 != "") { print; exit } } }' "$d/.git" 2>/dev/null) || return 1
      [ -n "$g" ] || return 1
      case $g in /*|[A-Za-z]:*) ;; *) g=$d/$g ;; esac
      case $g in
        */.git/worktrees/*) (cd "${g%%/.git/worktrees/*}" 2>/dev/null && pwd -P); return ;;
      esac
      return 1
    fi
    [ "$d" = / ] && return 1
    d=${d%/*}
    [ -n "$d" ] || d=/
  done
  return 1
}

tool_class() {
  LC_ALL=C awk '
!w && /"tool_name"[ \t\r]*:[ \t\r]*"(Bash|Edit|Write|NotebookEdit)"/ { w = 1 }
END { print (w ? "write" : "other") }' 2>/dev/null || printf '%s\n' other
}
```

`main_root` mirrors `mainCheckoutRoot`'s two "could not look" exits, which the first plan draft walked past (plan review finding, 18:15:11): a directory the walk cannot search (`[ -x "$d" ]`, the shell side of its non-ENOENT `stat` error) and a `.git` file it cannot read both return unresolved, never an ancestor's root. Its awk reads every line for `gitdir:`, as the `/m` regex does, not only the first.

The spec fixes the substance of the literals but not their wording, so they are written as shown here, with no `'`:

- `session-start`: `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"claude-tweaks: hooks cannot run in this session because no `node` was found: not on the PATH Claude Code started with, not at the path saved by an earlier session, not at a well-known install location. Every claude-tweaks guard is off for this session (the node-run checks: the write gate, the commit and push checks, run event logging; in a worktree-always project the launcher instead denies Bash, Edit, Write and NotebookEdit). Tell the user this in your next reply and stop making repository edits. The fix is to quit and restart Claude Code from a shell where `node` resolves (`command -v node` prints a path)."}}`
- `user-prompt-submit`: the same object with `"hookEventName":"UserPromptSubmit"`.
- `pre-tool-use` deny: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"claude-tweaks: no `node` was found for this session, so its hooks cannot check this call, and this project requires an isolated worktree (worktree-always in .claude-tweaks/policy.yml). Every Bash, Edit, Write and NotebookEdit call is denied until restart; asking the user and leaving the worktree still work. Tell the user, then quit and restart Claude Code from a shell where `node` resolves (`command -v node` prints a path)."}}`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-launcher.test.js`
Expected: PASS. The go-red control passes because its `assert.throws` matches `policy parity: AC9.7 `.

- [ ] **Step 5: Commit**

```bash
git -C "{wt}" add plugin/bin/hooks.sh tests/hooks-launcher.test.js
git -C "{wt}" commit -m "Warn without node and deny under worktree-always — shell policy check pinned to resolveWorktreeAlways" -m "refs #5392"
```

### Task 3: Route every registration through the launcher

**Role:** integration

**Files:**
- Modify: `plugin/hooks/hooks.json` (all 20 `command` strings)
- Modify: `tests/hooks-dispatcher.test.js` (lines 750, 760, 773, 908, 922, 939, 948, 959)
- Modify: `tests/hooks-post-tool-use-failure.test.js:74`
- Modify: `perf/hooks-prefilter.test.js`
- Test: `tests/hooks-launcher.test.js`

**Interfaces:**
- Consumes: Task 1's `plugin/bin/hooks.sh`.
- Consumer inventory, from `git grep -n -I -E 'hooks\\\\?\.js" ?(pre-tool-use|post-tool-use|session-start|session-end|pre-compact|user-prompt-submit|subagent-stop)|\.command\b' -- tests perf tools evals` at plan time. The only assertions on a registration's command string are the 8 `tests/hooks-dispatcher.test.js` lines above and `tests/hooks-post-tool-use-failure.test.js:74`. No change is needed for: `tests/hooks-gate-coverage.test.js:308,318` (`includes('post-tool-use')` still matches); `tests/payload-boundary.test.js` (a), which needs `bin/hooks.sh` to exist and Task 1 created it; and `tests/bin-lib/code-health/candidates-dead-code.test.js:35` (its own fixture JSON, not the live file).

- [ ] **Step 1: Write the failing test, and retarget the existing regexes.**
  - `hooks.sh AC1.1: every hooks.json registration is the launcher form with its old event verb` reads `plugin/hooks/hooks.json` through `JSON.parse(fs.readFileSync(…, 'utf8'))`. JSON reads are allowed. It flattens to `[event, matcher | null, command, keys]` and asserts deep-equality with exactly these 20 rows, in file order. Every command is `sh "${CLAUDE_PLUGIN_ROOT}/bin/hooks.sh" <verb>`. Every hook object's keys are exactly `['command', 'type']`, sorted: no `args`, `shell` or `if`, so it stays shell form. Each group has one hook.

    SessionStart/null/session-start · UserPromptSubmit/null/user-prompt-submit · SessionEnd/null/session-end · PreCompact/null/pre-compact · PreToolUse/{Bash, Edit, Write, NotebookEdit, ExitWorktree, AskUserQuestion, Agent, Task}/pre-tool-use · PostToolUse/{Bash, Write, Skill, AskUserQuestion, EnterWorktree, ExitWorktree}/post-tool-use · PostToolUseFailure/Bash/post-tool-use-failure · SubagentStop/null/subagent-stop.
  - AC1.2: in `tests/hooks-dispatcher.test.js`, change each `/bin\/hooks\.js" pre-tool-use$/` and `/bin\/hooks\.js" post-tool-use$/` to `\.sh`, and change line 948's `'hooks.js" user-prompt-submit'` to `'hooks.sh" user-prompt-submit'`. In `tests/hooks-post-tool-use-failure.test.js:74`, change `/hooks\.js" post-tool-use-failure$/` to `/hooks\.sh" post-tool-use-failure$/`.
  - `perf/hooks-prefilter.test.js`:
    - `SH = findOnPath('sh')`, using the same lookup shape as Task 1, defined locally.
    - `runHook` spawns `SH` with `[path.join(ROOT, 'plugin') + '/bin/hooks.sh', 'pre-tool-use']`.
    - `runControl` stays bare `node -e ''`, so the existing `skipCost < fullCost / 2` ratio and the `skipCost < 60` ceiling above bare Node both include the launcher's cost (spec AC13: "`npm run test:perf`'s hook budget still passes with the launcher in the path"; settled by plan review, round 2, over rebasing the control onto `sh`, which would let total overhead reach about 120ms with both assertions green).
    - A fourth series, `runDirect`, is `node HOOKS pre-tool-use` on `SKIP_PAYLOAD`, reported in the failure messages so a breach shows the launcher's own share (`skip - direct`); no separate assertion.
    - Update the header and Budget basis comments to say that every Bash call now spawns `sh` → `exec node hooks.js` twice. Append the best-of-15 values this machine measured (platform, `node --version`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-launcher.test.js tests/hooks-dispatcher.test.js tests/hooks-post-tool-use-failure.test.js`
Expected: FAIL. AC1.1 and the 9 retargeted assertions see `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" …`.

- [ ] **Step 3: Rewrite the 20 `command` strings in `plugin/hooks/hooks.json`** to `"sh \"${CLAUDE_PLUGIN_ROOT}/bin/hooks.sh\" <same verb>"`, changing nothing else in the file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-launcher.test.js tests/hooks-dispatcher.test.js tests/hooks-post-tool-use-failure.test.js tests/payload-boundary.test.js tests/hooks-gate-coverage.test.js`
Expected: PASS.

Run: `npm run test:perf`
Expected: PASS: the existing ratio and 60ms ceiling, now measured through the launcher against bare Node. Record the printed or measured numbers (skip, full, control, direct) in the comment.

- [ ] **Step 5: Commit**

```bash
git -C "{wt}" add plugin/hooks/hooks.json tests/hooks-dispatcher.test.js tests/hooks-post-tool-use-failure.test.js tests/hooks-launcher.test.js perf/hooks-prefilter.test.js
git -C "{wt}" commit -m "Route every hook registration through hooks.sh — same event verbs, perf budget measured through the launcher" -m "refs #5392"
```

### Task 4: session-start saves the node path

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/session-start.js`
- Test: `tests/hooks-launcher.test.js`

**Interfaces:**
- Produces: `saveNodePath({ execPath = process.execPath, home = process.env.HOME || os.homedir() } = {}) -> 'written' | 'unchanged'`, exported from `session-start.js` beside `run`. It writes `path.join(home, '.claude-tweaks', 'node-path')` with `execPath + '\n'` through `writeFileAtomic`, after `fs.mkdirSync(dir, { recursive: true })`, but only when the file's current `readFileSync(…, 'utf8')` content differs. A read that throws counts as differing. A write failure throws, and the caller swallows it.
- Dependency callers: every suite that spawns `hooks.js session-start` or calls `sessionStart.run` now performs this best-effort write in the spawning env's home. No caller's assertions read that file, so no caller needs a stub. The selection that proves it is the full `npm test -- --full` in Task 6, not a hand-picked list.

- [ ] **Step 1: Write the failing tests.** All spawn `process.execPath` with `[HOOKS_JS, 'session-start']`, input `{"session_id":"s","source":"startup"}`, cwd a fresh non-repo temp dir, and env `fixtureHomeEnv(home)`.
  - `hooks.sh AC10.1: session-start writes process.execPath when node-path is absent`. Content is `process.execPath + '\n'`.
  - `hooks.sh AC10.1: session-start rewrites a different stored path`. The pre-written `/nonexistent/node\n` becomes `process.execPath + '\n'`.
  - `hooks.sh AC10.1: session-start leaves an up-to-date node-path untouched`. Pre-write the correct content and `fs.utimesSync` it to `2001-01-01`. After the run, `mtimeMs` equals the set value.
  - `hooks.sh AC10.1: an unwritable ~/.claude-tweaks keeps stdout and exit 0`. Run A uses a writable empty home. Run B uses a home where `.claude-tweaks` is a regular file (runs everywhere, including under root). Assert both exit 0 and `B.stdout === A.stdout`. Then add a second test under `chmodDenialSkip('root bypasses directory modes')` with `.claude-tweaks` as a `0o500` directory: same assertions, and node-path absent afterwards.
  - `hooks.sh AC10.1: session-start writes under HOME when HOME and USERPROFILE differ`. env is `fixtureHomeEnv(a)` with `USERPROFILE` then overwritten to a second temp dir `b`. Assert `a/.claude-tweaks/node-path` holds `process.execPath + '\n'` and `b/.claude-tweaks/node-path` is absent. It discriminates only on win32, where `os.homedir()` reads `USERPROFILE`; on POSIX both readings pass, so Task 6's windows-latest run is its proof.
  - `hooks.sh AC3.1 round trip: the path session-start saves is the one the launcher reads`. Run session-start under node with `fixtureHomeEnv(home)`, then run the launcher's `session-start` under `noNodeEnv(home)`. Assert `additionalContext` includes `INTERACTION_STYLE_DIRECTIVE` and not `restart Claude Code`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "AC10" tests/hooks-launcher.test.js`
Expected: FAIL. `node-path` is absent after the run (`ENOENT` in the content assertion).

- [ ] **Step 3: Implement `saveNodePath` and call it in `run()`** right after `parts.push(INTERACTION_STYLE_DIRECTIVE)`, as `try { saveNodePath(); } catch { /* best-effort */ }`. Add `os` and `writeFileAtomic` requires, and a comment naming #5392 and the launcher's rung. Do not use `existsSync`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-launcher.test.js tests/hooks-session-start.test.js tests/path-guard-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C "{wt}" add plugin/bin/lib/hooks/session-start.js tests/hooks-launcher.test.js
git -C "{wt}" commit -m "Save the session's node path at session start — the launcher's second rung" -m "refs #5392"
```

### Task 5: Document the launcher

**Role:** integration

**Files:**
- Modify: `docs/hooks.md:3` (intro sentence) and a new bullet directly after line 5's never-break-a-session bullet
- Modify: `docs/plugin-structure.md:16` (tail), plus a new line after `:17`
- Modify: `docs/REGISTRY.md:20` (append `plugin/bin/hooks.sh` to `docs/hooks.md`'s governed paths)
- Modify: `README.md` `## Dependencies` table (new Git Bash row after the `Node 18+` row, line 184 at plan time)
- Test: `tests/hooks-launcher.test.js`

**Interfaces:**
- **User ruling (2026-11-14, after plan writing):** accept the PowerShell-fallback regression and state Git Bash as a Windows requirement. The README Dependencies row and the `docs/hooks.md` Windows bullet's last sentence below carry it; no init check is added.
- Behavior-change prose sweep. The grep was `git grep -n -I -E 'hooks\.json|hooks\.sh|All hook registrations route through|all via plugin/bin/hooks.js' -- docs tools README.md CLAUDE.md plugin/skills ':!docs/superpowers' ':!docs/incident-log.md'`. Each hit, classified:
  - `docs/hooks.md:3`: modify.
  - `docs/plugin-structure.md:16`: modify.
  - `docs/REGISTRY.md:20`: modify.
  - `CLAUDE.md:51` ("All hook registrations route through `plugin/bin/hooks.js <event>`"): no change. It sits at exactly 24,576 of its 24,576-byte budget (`tests/claude-md-budget.test.js`, `wc -c` at plan time), and the sentence stays true because `hooks.sh` execs `hooks.js` with the same argv. It also points to `docs/hooks.md`.
  - `CLAUDE.md:24`: no change (still accurate).
  - `docs/skill-authoring.md:151`: no change (hook command strings still read `CLAUDE_PLUGIN_ROOT`).
  - `plugin/skills/_shared/policy-schema-coverage.md:19`: no change. Its figures are a dated, conditioned measurement of the node skip path, and the launcher adds the same `sh` cost to both sides of its marginal-cost argument.
  - `docs/journeys/run-shell-loops-without-a-hook-storm-3074.md:24`: no change (`exec` keeps one process per hook).
  - `docs/reference/pretooluse-agent-tool-probe.md:14`: no change (a probe's own hooks.json).
  - The `docs/journeys/*` `plugin/hooks/hooks.json` front-matter paths: no change.
- The pinned literals below are copied from this step's replacement text, never retyped. The new bullet must not contain `Every inform-tier line names its relay`, because `tests/inform-tier-relay-realpath-conformance.test.js` requires exactly one such line.

- [ ] **Step 1: Write the failing tests.**
  - `hooks.sh AC11.1 + AC12.1: docs/hooks.md documents the launcher, the saved path, the no-node behavior per event and Windows`. `text = readText(docs/hooks.md)`. Slice from the line starting `- **Node launcher (#5392):**` to the next line matching `/^- /`, asserting both anchors were found. Then assert `missingFactsOf(PATTERNS)(slice)` deep-equals `[]` and run `assertEachPatternGoesRed(slice, PATTERNS, missingFactsOf(PATTERNS))`, with these `[pattern, fact]` rows (non-global):
    - `/`sh "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.sh" <event>`/` (registration form)
    - `/`exec`s it on `hooks\.js <event>` with stdin passed through/` (exec pass-through)
    - `/`command -v node`; the path saved in `~\/\.claude-tweaks\/node-path`/` (resolution order)
    - `/`lts\/\*`, `node` or a partial version such as `22` is skipped/` (nvm literal only)
    - `/replaced by `CLAUDE_TWEAKS_NODE_CANDIDATES`/` (test seam)
    - `/writes `process\.execPath` to `~\/\.claude-tweaks\/node-path`/` (saved path)
    - `/reads stdin to EOF, always exits 0, and prints only fixed JSON literals/` (no-node invariant)
    - `/`session-start` and `user-prompt-submit` print one `hookSpecificOutput\.additionalContext`/` (warn events)
    - `/`pre-tool-use` prints a `permissionDecision: "deny"`/` (deny event)
    - `/The deny covers Bash, Edit, Write and NotebookEdit only, matched on the payload's `tool_name`/` (deny tool scope)
    - `/AskUserQuestion, Agent, Task and ExitWorktree get nothing/` (silent tools)
    - `/never parses `cwd` out of the stdin JSON/` (process cwd, Q2)
    - `/The accepted risk: after a `cd` into a different repository/` (accepted cwd risk; the shared prefix of all three `{PROBE SENTENCE}` variants)
    - `/A hit that cannot run `hooks\.js`/` (unrunnable hit)
    - `/`session-end`, `pre-compact`, `post-tool-use`, `post-tool-use-failure` and `subagent-stop` print nothing/` (silent events)
    - `/"`sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed"/` (Windows shells)
    - `/code\.claude\.com\/docs\/en\/hooks\.md, "Exec form and shell form"/` (Windows source)
    - `/Under the PowerShell fallback there is no `sh`/` (PowerShell consequence)
  - `hooks.sh AC11.1 move-out control: the Windows sentence counts only inside the launcher bullet`. Move the `**Windows:**` sub-bullet line to the end of the file in memory, and `assert.notEqual` the result to the original. The sliced check must then throw with the `Windows shells` fact named. Use `assert.throws(…, /Windows shells/)` over a wrapper that asserts `missingFactsOf(PATTERNS)(slice)` is `[]`, with the message listing the missing facts.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "AC11|AC12" tests/hooks-launcher.test.js`
Expected: FAIL with `heading not found` or `anchor not found: - **Node launcher (#5392):**`.

- [ ] **Step 3: Edit the docs.**
  - `docs/hooks.md:3` becomes: `All hook registrations route through `plugin/bin/hooks.sh`, which runs `plugin/bin/hooks.js <event>` under the `node` it finds (the Node launcher bullet below) — one dispatcher, one module per event in `plugin/bin/lib/hooks/`. Rules:`
  - Insert after line 5, verbatim:

```markdown
- **Node launcher (#5392):** every `hooks.json` registration is `sh "${CLAUDE_PLUGIN_ROOT}/bin/hooks.sh" <event>`. `plugin/bin/hooks.sh` is a POSIX `sh` script that finds `node` and `exec`s it on `hooks.js <event>` with stdin passed through, so once a node is found the hook's stdout, stderr and exit status are exactly `hooks.js`'s. Without it, a session whose PATH has no `node` (an nvm, fnm or asdf setup that resolves `node` only in an interactive shell) gets exit 127 from `/bin/sh` on every hook, which Claude Code reports only as a non-blocking error, and every gate is off for the whole session.
  - **Resolution order, first hit wins:** `command -v node`; the path saved in `~/.claude-tweaks/node-path` when it names an executable file; the nvm default alias when it names a literal version directory under `$NVM_DIR` (default `~/.nvm`; `lts/*`, `node` or a partial version such as `22` is skipped, never guessed); `~/.volta/bin/node`; `/opt/homebrew/bin/node`; `/usr/local/bin/node`; fnm's default alias. The well-known list (every rung after the saved path) is replaced by `CLAUDE_TWEAKS_NODE_CANDIDATES` when that variable is set, one absolute path per line, empty meaning no candidates: a test seam, since CI runners have a node at `/usr/local/bin`. A hit that cannot run `hooks.js` (an asdf or mise shim with no version set, a Node older than 18) is not probed and no later rung is tried: it fails as before, a non-blocking error with every guard off.
  - **Saved node path:** `session-start`, when it runs under node, writes `process.execPath` to `~/.claude-tweaks/node-path` (under `$HOME`, the home the launcher reads, and `os.homedir()` only when `HOME` is unset) only when the stored value differs, so a later session whose PATH lost `node` still finds the one this machine last ran. The write is best-effort: a failure never changes the hook's stdout or exit status.
  - **No node found:** the launcher reads stdin to EOF, always exits 0, and prints only fixed JSON literals. `session-start` and `user-prompt-submit` print one `hookSpecificOutput.additionalContext` telling the model that every claude-tweaks guard is off, to tell the user and stop repository edits, and that the fix is to restart Claude Code from a shell where `node` resolves. `pre-tool-use` prints a `permissionDecision: "deny"` naming the same fix when the main checkout's `.claude-tweaks/policy.yml` turns `worktree-always` on, read from the root `wtDetect.mainCheckoutRoot` gives (the hook's cwd when that is unresolved), with no worktree-isolation check, so it denies inside a linked worktree too. The deny covers Bash, Edit, Write and NotebookEdit only, matched on the payload's `tool_name` against fixed patterns, with no input copied into the output; AskUserQuestion, Agent, Task and ExitWorktree get nothing, so the model can still ask the user or leave the worktree, and the subagents Agent and Task spawn hit the same hook. Otherwise it prints nothing. `session-end`, `pre-compact`, `post-tool-use`, `post-tool-use-failure` and `subagent-stop` print nothing. A project without that policy is warned, never blocked, because the plugin is often enabled user-wide. The shell policy check mirrors `parseFlatLines` and `resolveWorktreeAlways`, and `tests/hooks-launcher.test.js`'s differential test pins the two to the same verdict (`[IL-133]`).
  - **Windows:** Claude Code passes a hook's command string to "`sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed" (code.claude.com/docs/en/hooks.md, "Exec form and shell form"). Git Bash ships `sh`, so the launcher runs there. Under the PowerShell fallback there is no `sh`, and every claude-tweaks hook fails as a non-blocking error where the old plain `node` registration ran: a Windows install without Git Bash runs with every guard off. `plugin/.gitattributes` keeps `hooks.sh` LF on a `core.autocrlf` checkout, since `sh` cannot run a CRLF script. claude-tweaks therefore requires Git Bash on Windows (README's Dependencies table).
  - **Working directory:** the launcher resolves the main checkout from its own process cwd and never parses `cwd` out of the stdin JSON, since escaped quotes or backslashes in a path would break a shell pattern; Claude Code runs a command hook "in the current directory" (same page, "Handler fields"). {PROBE SENTENCE}
```

  `{PROBE SENTENCE}` comes from Task 2 Step 0 and is one of three. Each carries its own accepted-risk sentence, because the risk depends on whether the process cwd follows a `cd`, and every variant keeps the `The accepted risk: after a `cd` into a different repository` prefix the PATTERNS row pins:
  - (a) "A live probe (#5392) logged the hook's process cwd equal to the payload `cwd` after a Bash `cd`. The accepted risk: after a `cd` into a different repository, the launcher reads that repository's policy, while the `session-start` and `user-prompt-submit` warning still fires."
  - (b) "A live probe (#5392) logged the hook's process cwd staying at {observed} while the payload `cwd` followed a Bash `cd`. The accepted risk: after a `cd` into a different repository, the launcher keeps reading the policy of the repository the session started in, while the `session-start` and `user-prompt-submit` warning still fires."
  - (c) The downgrade: "Not live-probed: {reason}. The accepted risk: after a `cd` into a different repository, the launcher reads the policy of whichever repository its process cwd is in, that repository's or the one the session started in, while the `session-start` and `user-prompt-submit` warning still fires."

  - `docs/plugin-structure.md:16`: change the tail `all via plugin/bin/hooks.js)` to `all via plugin/bin/hooks.sh → plugin/bin/hooks.js)`. After line 17 add `plugin/bin/hooks.sh               → POSIX sh launcher every hooks.json registration runs: finds node (PATH, ~/.claude-tweaks/node-path, well-known installs; CLAUDE_TWEAKS_NODE_CANDIDATES test seam) and execs hooks.js; with none, warns at SessionStart/UserPromptSubmit and denies Bash/Edit/Write/NotebookEdit at PreToolUse under worktree-always (#5392, docs/hooks.md)`.
  - `docs/REGISTRY.md:20`: add `` `plugin/bin/hooks.sh`, `` before `` `plugin/hooks/hooks.json` `` in the governed-paths cell.
  - `README.md` `## Dependencies`: insert directly after the `Node 18+` row, verbatim: `| Git Bash (Windows only) | Git for Windows (`winget install Git.Git`) | Yes on Windows — every hook runs through `sh` (#5392). Without Git Bash, Claude Code runs hooks under PowerShell, every claude-tweaks hook fails, and no guard runs. |`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-launcher.test.js tests/inform-tier-relay-realpath-conformance.test.js tests/dispatch-config-gate-conformance.test.js tests/dispatch-no-stash-conformance.test.js tests/reconcile-dispatch.test.js tests/timing-prose-conformance.test.js`
Expected: PASS. These are the suites that read `docs/hooks.md`, from the plan-time grep `git grep -l -E "docs', 'hooks\.md'|docs/hooks\.md|'hooks\.md'" -- tests tools`.

- [ ] **Step 5: Commit**

```bash
git -C "{wt}" add docs/hooks.md docs/plugin-structure.md docs/REGISTRY.md README.md tests/hooks-launcher.test.js
git -C "{wt}" commit -m "Document the hooks launcher — resolution order, saved path, no-node behavior, Windows shells" -m "refs #5392"
```

### Task 6: Full-suite, perf and windows-latest proof

**Role:** integration

**Files:**
- Test: `tests/hooks-launcher.test.js`. Modified only if Step 3 needs a measured win32 skip.

- [ ] **Step 1: Full suite (AC13.1).** Use a 1,200,000 ms timeout and read the tail of the file afterwards. Re-run any red file alone (`node --test {file}`) before attributing it, per CLAUDE.md's load note.

Run: `npm test -- --full > "{scratch}/npm-test-full.txt" 2>&1`
Expected: PASS (`# fail 0`)

- [ ] **Step 2: Perf (AC13.1).**

Run: `npm run test:perf > "{scratch}/perf.txt" 2>&1`
Expected: PASS, with the skip-path ceiling measured through the launcher

- [ ] **Step 3: windows-latest run (AC11.1).** After the phase-exit push, run `gh workflow run windows-regression.yml --repo thn-inc/claude-tweaks --ref {branch}` (unverified: it has no read-only form). Find the run with `gh run list --repo thn-inc/claude-tweaks --workflow windows-regression.yml --branch {branch} --limit 1 --json databaseId,status`. Wait with a Monitor until-loop on `gh run view {id} --repo thn-inc/claude-tweaks --json status`, never a foreground sleep. Then run `gh run download {id} --repo thn-inc/claude-tweaks -n verify-report -D "{scratch}/win-{id}"` (shape probed at plan time).
  - The `hooks.sh AC10.1: session-start writes under HOME when HOME and USERPROFILE differ` line must be `ok` (its only discriminating platform).
  - Pass condition: `verify-report.json`'s failing files include none of `tests/hooks-launcher.test.js`, `tests/hooks-dispatcher.test.js`, `tests/hooks-post-tool-use-failure.test.js` or `tests/payload-boundary.test.js`.
  - `grep -n -E "^(ok|not ok) [0-9]+ - hooks\.sh " "{scratch}/win-{id}/verify-logs/tests.log"` lists every launcher test as `ok`. The only `# SKIP` lines are the `[dash]` variants and any skip whose reason is true on Windows.
  - If a launcher test fails for a Windows-only reason (for example, MSYS `exec` of a `#!/bin/sh` fake node), add a per-test `{ skip: process.platform === 'win32' && '{measured reason, run {id}}' }` to that test only, push, and re-dispatch. A failure in the AC3.1 saved-path test, or in any `noNodeEnv` no-node test, is a real defect to fix and never a skip. The PR body names every Windows skip and its reason.

- [ ] **Step 4: Persist the evidence.** Run `mkdir -p "$PIPELINE_RUN_DIR/evidence"`, then copy the Step 1–3 logs there with plain redirects. Write one `AC evidence` entry per AC11.1 and AC13.1 through `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`. Each text file holds the AC id, the command shape, the pass/fail counts, and the evidence path. The AC11.1 entry also carries the run id and the `hooks.sh` ok/skip counts.

- [ ] **Step 5: Commit** any skip added in Step 3: `git -C "{wt}" add tests/hooks-launcher.test.js`, then `git -C "{wt}" commit -m "Skip {test} on win32 — {measured reason}" -m "refs #5392"`.

## Acceptance-criterion map

| AC clause | Task | Test |
|---|---|---|
| AC1.1 | 3 | `hooks.sh AC1.1: every hooks.json registration is the launcher form …` |
| AC1.2 | 3 | the 9 retargeted regexes in `hooks-dispatcher.test.js` and `hooks-post-tool-use-failure.test.js` |
| AC2.1 | 1 | `hooks.sh AC2.1: with node on PATH the output is byte-identical …` |
| AC3.1 | 1 (and 4's round trip) | `hooks.sh AC3.1: a saved node-path is used …` |
| AC4.1 | 2 | `hooks.sh AC4.1: no node: session-start and user-prompt-submit …` |
| AC5.1 | 2 | `hooks.sh AC5.1: no node + worktree-always: pre-tool-use denies …`, plus `hooks.sh: tool_name matching` |
| AC6.1 (silent tools, added by the Q1 ruling) | 2 | `hooks.sh AC6.1: … silent for AskUserQuestion, Agent, Task, ExitWorktree` |
| AC7.1 | 2 | `hooks.sh AC7.1: … silent when the policy is absent or false` |
| AC8.1 | 2 (drain in 1) | `hooks.sh AC8.1: no node: the five other events are silent` |
| AC9.1 … AC9.12 | 2 | `hooks.sh AC9: …` fixture rows AC9.1–AC9.12, plus the AC9.7 go-red control |
| AC10.1 | 4 | the four `hooks.sh AC10.1: …` tests |
| AC11.1 | 5 (docs), 6 (windows-latest), 1 (LF) | `hooks.sh AC11.1 …` tests and the Task 6 Step 3 run |
| AC12.1 | 5 | `hooks.sh AC11.1 + AC12.1: docs/hooks.md documents …` |
| AC13.1 | 3 (perf), 6 | `npm test -- --full`, `npm run test:perf` |

## Release Note

claude-tweaks hooks now find node even when it's missing from the session's PATH, and when it can't be found they warn the session, and block edits in worktree-always projects, instead of silently switching every guard off.
