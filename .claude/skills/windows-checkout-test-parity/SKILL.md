---
name: windows-checkout-test-parity
description: Use when writing or reviewing code or a test in this repo whose behavior differs on a Windows checkout — CRLF line endings from core.autocrlf, a .cmd/.bat launcher spawned through cmd.exe, a path separator in a display ID or a test's expected path, a win32-only path or env rule — since CI runs on ubuntu only and cannot see any of it. Covers taking `platform`/`env` as parameters, exact-string pins, CRLF inputs built from the LF text, `toPosix` at the display-ID producer with native fs paths left alone, the win32-only real-process round-trip that stays the ground truth, what a win32 path simulation on a POSIX host can and cannot show, keeping a Windows-only launch failure from reading as a real answer, and the real-runner failures outside test bodies (command-line overflow, TAP backslash doubling, checkout-vs-temp drive split). Keywords - Windows, ENAMETOOLONG, runner.temp, windows-latest, win32, CRLF, autocrlf, cmd.exe, .cmd launcher, EINVAL, platform parameter, launchSpec, line endings, path.sep, toPosix, display ID, path.resolve expected value, realpath stub, win32 simulation, Linux-only CI.
---

# Windows checkout test parity

## Overview

`.github/workflows/test.yml` runs `npm test` on `ubuntu-latest` only, and this repo's `.gitattributes` pins only `tools/upstream-drift/fixtures/**` (`-text`, so those hashed fixture bytes stay exact). A Windows checkout with Git's default `core.autocrlf=true` therefore reads every tracked text file with `\r\n` line endings (`git ls-files --eol` reports `i/lf w/crlf`), and Node spawns launchers differently on win32. Code that breaks only there is invisible to the merge gate: it stays green on every PR, then shows up as extra failures in a Windows `npm test` run or as a bug on a user's Windows machine. #3040 closed four such gaps in one build and used the same moves each time. This skill names them so the next platform branch gets its pin when it is written.

## Key Patterns

### Take `platform` and `env` as parameters, never stub `process.platform`

Put the platform translation in a function whose OS inputs are arguments:

```js
// plugin/bin/lib/impeccable-engine/index.js
function launchSpec(launcher, args, platform, env = {}) {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(launcher)) {
    return { file: launcher, args, options: {} };
  }
  // ...builds `cmd.exe /d /s /c "<escaped line>"` with windowsVerbatimArguments
}
```

`plugin/bin/lib/reconcile/reap-merged.js`'s `longPathRemovalTarget(real, platform = process.platform)`, `plugin/bin/lib/verify/run.js`'s `platform = process.platform` option, `plugin/bin/lib/hooks/post-tool-use.js`'s `ctx.platform || process.platform`, `plugin/bin/lib/atomic-write.js`'s `writeFileAtomic(..., { platform = process.platform, ... })` and `plugin/bin/session-tmp-resolve.js`'s `formatPrintedPath(resolved, { platform = process.platform, sep = path.sep } = {})` have the same shape. The comment beside `longPathRemovalTarget` gives the reason: `process.platform` is process-global, so a stub leaks into every other test in the same worker. Tests pass `'win32'` and `'linux'` explicitly (`tests/bin-lib/verify/run.test.js`, `tests/hooks-post-tool-use-worktree-staleness.test.js`).

### Inject the OS-aware stdlib module itself, not a platform string

When the branch you need to pin already lives inside a Node stdlib module — `path.win32` vs `path.posix` differ in `.sep`, `.isAbsolute`, `.parse` — there is nothing left to re-implement with a `platform` string and an internal `if`. Take the module itself as a parameter, defaulting to the platform-native one, and let the two OS-independent namespaces stand in for the real platforms on any host, including ubuntu-only CI:

```js
// tools/upstream-drift/checks.js
function splitGlobPattern(pattern, pathFlavor = path) {
  const baseDir = pathFlavor.isAbsolute(pattern) ? pathFlavor.parse(pattern).root : '.';
  // ...
}
```

```js
// tools/upstream-drift/tests/checks.test.js
splitGlobPattern('C:\\slotA\\…', path.win32); // exercises the drive-root branch on Linux CI
```

This is the same seam as `launchSpec`'s `platform` parameter above, one level down: `path.win32`/`path.posix` are OS-independent by construction, so passing one in reaches the win32-only branch without a real Windows process — no platform string, no internal branch to keep in sync with the module's own (#3069).

### Pin the win32 output with exact strings

A shape assertion (`startsWith('"')`, `includes('engine-probe')`) stays green when an escaping pass is dropped. Pin the whole output, with one input per rule. `tests/bin-lib/impeccable-engine/windows-launch.test.js` pins `launchSpec`'s `/c` payload for a space, cmd.exe metacharacters, embedded quotes, a trailing backslash and an injection attempt (`a"&echo pwned&"`):

```js
const payload = (arg) => launchSpec('C:\\x\\impeccable.cmd', [arg], 'win32', { ComSpec: 'cmd.exe' }).args[3];
assert.strictEqual(payload('trail\\'), String.raw`"C:\x\impeccable.cmd ^^^"trail\\^^^""`);
```

Before #3040, removing either caret pass or the trailing-backslash doubling left every CI test green. `String.raw` keeps the expected string readable as the bytes cmd.exe receives.

### Build CRLF inputs from the LF text

When code parses text it reads from a tracked file (a workflow, a skill's markdown, a decisions log), add a CRLF case beside the LF one. Build it from the same string with `.replace(/\n/g, '\r\n')`, so the two cases differ only in line endings:

```js
// tests/bin-lib/release-preflight/pack.test.js
const mirror = 'name: mirror-marketplace\n\non:\n  release:\n    types: [published]\n'.replace(/\n/g, '\r\n');
assert.strictEqual(await hookOf({ 'mirror-marketplace.yml': mirror }), true);
```

`tests/bin-lib/init/claude-md-conformance.test.js`, `tests/bin-lib/health-core/frontmatter-list.test.js`, `tests/bin-lib/log-decision/claim-log.test.js` and `tests/bin-lib/release-note-repair/apply.test.js` build their CRLF cases the same way. The usual fix is to split on `/\r?\n/` or write `\r?\n` in the regex. Watch for a `$` anchor after `split('\n')`: each line keeps its trailing `\r`, and `.` does not match `\r`, so `pack.js`'s `ON_LINE_RE` (`/^(?:on|"on"|'on'):[ \t]*(.*)$/`) never matched `on:\r`, and `workflowPublishesRelease` read a real release workflow as no hook.

When the text is a live skill file read by a prose test, the CRLF case tests the test's own extractor. See the fence-regex row in `skill-prose-conformance-tests`'s Anti-Patterns.

### Keep a win32-only real-process round-trip as the ground truth

Exact-string pins prove the translation did not change. They do not prove it is right. Keep one test that runs the real thing on Windows and skips elsewhere with a stated reason:

```js
test('a .cmd launcher run through defaultDeps().spawn receives every argument intact (win32 only)',
  { skip: process.platform !== 'win32' && 'win32-only: exercises cmd.exe argument parsing' }, () => {
```

It writes a throwaway `.cmd` shaped like the real launcher, spawns it through the production `defaultDeps().spawn`, and asserts every argument arrives byte-identical. Before you change a pinned string, run this test on a Windows machine. A pin should only record output the round-trip has already shown to work.

### A Windows-only launch failure must not read as a real answer

Node refuses to `execFileSync` a `.cmd`/`.bat` without a shell (CVE-2024-27980 hardening: `spawnSync` throws `EINVAL`). Before #3040, `resolve()` turned every `engine-probe` throw into `engine-not-installed`. On Windows, every install with the engine present was reported missing, with a plausible fix line (#3039). `probeFailure()` now maps only the launcher's own exit 127 to `engine-not-installed`. A timeout (`isSpawnTimeout()`) maps to `timeout`, and any other exit, signal or spawn error maps to `exec-failed` with the code in `detail`. When a `catch` turns a throw into a domain verdict, list the throws one platform produces and another does not, and give each its own reason.

### Display IDs and native paths are two contracts

A path the code shows or compares as an ID (a JSON report row, a git-style repo-relative name, a glob) is a repo-display ID and uses `/` on every OS. A path the code then opens with `fs` stays native. Normalize the first at the producer with `shared-primitives.js`'s `toPosix(p, sep = path.sep)`, and never apply it to the second:

```js
// plugin/bin/lib/skill-audit/context-cost.js (#2767)
out.push({ skill: name, file: toPosix(path.relative(dir, p)), ...measuredBytes(p) });
```

`context-cost.js` wraps its three display sites this way (`measureSubFiles`, `measureComposed`'s source IDs, `findComposeCallSites`) and leaves every `fs` path native. `toPosix`'s own win32 branch is pinned on any host with `path.win32.sep` (`tests/bin-lib/shared-primitives.test.js`). A call site that takes the default `sep` is not covered by that pin: dropping its `toPosix` stays green on Linux CI.

On the test side, the matching rule is the `path.resolve` Anti-Patterns row below. Build the expected value with `path.resolve`/`path.join` when the code under test resolves or joins the path (`tests/bin-lib/verify/report.test.js`'s `gitDir` pins, `tests/bin-lib/wrap-up/ledger-write.test.js`'s `path.join('/run', 'ledger.md')`). Fix the producer, not the expectation, when the value is a display ID: a per-fixture `.replace(/\\/g, '/')` hides a producer that is still wrong.

### A win32 path simulation on a POSIX host is evidence, not a Windows run

Swapping Node's `path` methods for `path.win32` in a scratch preload reaches separator bugs from macOS or Linux. Report it as a simulation and never as a Windows run. It cannot show drive letters, and #2767's build hit four artifacts of the harness itself:

- On POSIX `path.posix === path`, so the preload rewrites `path.posix.sep` too, and a test that pins POSIX behavior through `path.posix` fails for a reason Windows never has.
- A preload that restores posix inside module loading leaves the main module's top-level code on posix. Defer a probe's work to `setImmediate` or it prints `sep "/"`.
- `fs`-backed suites turn `mkdtemp` paths into `\var\...` names that POSIX `fs` creates in the cwd. One simulated run left 315 such files in the worktree root. Run from a scratch cwd and check `git status` afterwards.
- Plugin-root lookups and other reads through win32-joined paths fail on POSIX `fs`. Those failures are the harness, not the class under test, so diff failing sets by test name against an unsimulated run.

### A real `windows-latest` run fails outside the test bodies too

The first real runs (#3316) hit three Windows-only classes before any test assertion mattered:

- **The launcher overflows the command line.** `tools/run-tests.js` passed ~782 test paths as argv and hit Windows' 32,767-character limit (`spawnSync … ENAMETOOLONG`, probe run 39030139345). It now picks its argv in a pure `buildTestArgs(files, roots, { platform, nodeMajor })`: root globs on win32 with Node >= 22 (`node --test` globs need it), the explicit list everywhere else. That function's argv is pinned for every platform/Node pair in `tests/package-json-test-script.test.js`.
- **Node's TAP reporter doubles Windows backslashes.** A `location:` line is `inspect()`-quoted, so `D:\a\x.test.js` arrives as `D:\\a\\x.test.js`. A consumer matching a path in TAP output collapses `/\\+/g` to `/`, never a single `\` (`tools/windows-regression/file-issue.js`'s `slashes`, `plugin/bin/lib/verify/extract.js`'s `relativize`).
- **The checkout and the temp dir sit on different drives.** On `windows-latest` the checkout is on `D:` and `os.tmpdir()` on `C:`. Anything that runs one side of a comparison under tmp sees a drive-less path like `/tmp/wt-1` resolve to `D:\tmp\wt-1` at HEAD and `C:\tmp\wt-1` in verify's base scratch worktree (`tests/hooks-dispatcher.test.js`, run 39034275070). Set `TMP`/`TEMP` to `runner.temp` so both sides share the checkout's drive.

## Decision Framework

| The platform difference | Pin it with |
|---|---|
| Code branches on the OS (`.cmd` launcher, long-path prefix, case-insensitive env keys) | A `platform` parameter defaulting to `process.platform`, plus exact-string assertions for `'win32'` and one other platform |
| The branch already lives inside a stdlib module (`path.sep`, `path.isAbsolute`) | Inject the module itself (`path.win32`/`path.posix`) as a parameter, defaulting to the platform-native one — no platform string, no internal branch |
| Code parses text read from a tracked file | An LF case and a CRLF case built from the same string with `.replace(/\n/g, '\r\n')` |
| A test measures a tracked non-skill file's byte length against a budget (`tests/claude-md-budget.test.js`'s CLAUDE.md check) | Read it through `tests/helpers/read-skill.js`'s `readText()` first, so the count is of LF bytes regardless of the checkout's line endings. A shipped skill file is measured only by the rail (`context-cost.js`'s `measuredBytes`, which already strips `\r\n`), never against a number of a test's own: `tests/skill-size-single-source.test.js` forbids that shape (#3311) |
| A test extracts regions from live skill markdown | A CRLF input proving the extractor still finds the region (`skill-prose-conformance-tests`) |
| A path emitted as an ID in a report, JSON row or glob | `toPosix` at the producer, never on a path later opened with `fs` |
| Behavior only a real Windows process shows (cmd.exe parsing, file locking) | A `{ skip: process.platform !== 'win32' && '<reason>' }` real-process test, kept beside the exact-string pins |

## Project Conventions

- A platform branch with no Linux-runnable pin is untested as far as the merge gate is concerned. Add the pin in the same change as the branch.
- A Windows `npm test` run already fails files that pass on CI. Compare failing-file sets against that baseline rather than reading every red file as new. When you fix a CRLF failure, grep `tests/` for the same regex shape (for example `` ```bash\n ``) and fix or record the other instances.
- In a pipeline run, `plugin/bin/verify.js --baseline origin/main --baseline-cmd tests="node --test {file}"` makes that comparison mechanically (#3043). It re-runs each failing file at the base commit and in isolation at HEAD, and exits 0 only when no file is attributable to the branch. The exact invocation is in `plugin/skills/test/verification.md`'s Baseline adjudication. A test that is flaky on Windows can still come back `ATTRIBUTABLE`, because one passing base run proves nothing: `tests/bin-lib/declined-learning/store-concurrency.test.js` failed about 6 runs in 10 at base with an `EPERM` rename race, yet its single base run passed. Re-run such a file at the base several times before treating it as the branch's failure.
- `.github/workflows/windows-regression.yml` (#3316) runs that same `verify.js --baseline` comparison on `windows-latest` after every push to `main`, against the push's previous tip (`github.event.before`, falling back to `HEAD^1`). When a test file newly fails, `tools/windows-regression/file-issue.js` files a `type:bug` issue naming the commit, or comments on the open one. It never runs on PRs, so the merge gate is still ubuntu-only: a Windows-only break still merges green and shows up as that issue afterwards. Keep adding the Linux-runnable pins above in the same change. The guard is a backstop that names the regressing commit, not a gate. A `workflow_dispatch` run on a branch has no `github.event.before`, so its base is the merge-base with the default branch (#3568); before that it was `HEAD^1`, which already contained a branch's own earlier fix and adjudicated `pass (baseline-adjudicated ...)` against a tree that carried the fix. The step prints `Comparison base: {sha} (merge-base with origin/{branch})` so a run's base is readable from its log.
- A win32 real-process test that times out kills `cmd.exe`, but the child it launched can outlive it and hold its cwd. Spawn with `cwd: os.tmpdir()`, not the temp dir the `finally` block removes, or `rmSync` fails with `EPERM` (the hang test in `tests/bin-lib/impeccable-engine/resolve.test.js`).

## Common Operations

```bash
git ls-files --eol <path>                                              # i/lf w/crlf = CRLF in this checkout
node --test tests/bin-lib/impeccable-engine/windows-launch.test.js     # pins run on any OS; the real-process test runs on win32 only
```

## Anti-Patterns

| Pattern | Why It Fails in This Project |
|---------|------------------------------|
| Stubbing `process.platform` in a test | It is process-global, so the stub leaks into other tests in the same `node --test` worker (the comment beside `reap-merged.js`'s `longPathRemovalTarget`) |
| Pinning a win32 translation with `includes`/`startsWith` only | A dropped escaping pass still contains the token, so CI stays green while Windows breaks (`launchSpec`'s caret passes before #3040) |
| `split('\n')` followed by a `$`-anchored line regex | On a CRLF checkout each line keeps its `\r`, `(.*)$` fails, and the probe answers "absent" (`pack.js`'s hook probe before #3040) |
| Expecting a POSIX absolute literal (`'/main-checkout'`) where the code under test runs that path through `path.resolve` | On win32, `path.resolve('/main-checkout')` is `C:\main-checkout`, so the pin fails only on a Windows checkout. Wrap the expected value in `path.resolve(...)` too. A path the code passes through unresolved stays literal: `gitTargets`'s cwd `'/repo'` is one. Examples: the env `-C` pin in `tests/hooks-gate-coverage.test.js` (#3074) and the `state.worktree` pins in `tests/hooks-dispatcher.test.js` |
| An identity `realpathSync` stub (`(p) => p`) under a containment check that compares against `root + path.sep` | On win32 a POSIX literal never starts with `root + '\\'`, so every rejection test passes for the separator mismatch and never exercises containment. The stub must resolve like the real call: `(p) => path.resolve(p)` (`tests/bin-lib/wrap-up/ledger-write.test.js`'s `resolveLedgerPath` rejection tests, #2767) |
| Mapping every spawn throw to a "not installed" or "not found" verdict | A win32-only `EINVAL` then reads as a real answer with a plausible fix, so nobody looks further (`resolve()` before #3040, #3039) |
| Passing a literal `/bin/sh` to `execFileSync`/`spawnSync` | On win32 it resolves to `<drive>:\bin\sh` and throws `ENOENT`; a `catch` that reads every throw as "resolved" then turns the feature off silently, and every drop-path test passes for the wrong reason (#2633's Premise-check runner, #3563). Pick the shell through a `platform` parameter (`posixShell`) |
| Updating an exact-string pin to match new output without running the win32 round-trip | The pin then records the regression instead of catching it |
| Comparing a working-tree file's raw bytes with its committed blob to decide "unchanged" | On a CRLF checkout every LF-committed file reads as changed. Hash it with `git hash-object --path=<file>` so the clean filters apply, and compare that with `git rev-parse <sha>:<file>` (`plugin/bin/lib/verify/baseline.js`'s `sameAtBase`, #3043) |
| Measuring a tracked file against a byte budget with a raw `fs.readFileSync`/`fs.statSync` read | A CRLF checkout inflates the measured size past a budget derived from the LF blob CI actually sees — the test can fail, or silently pass a file that is genuinely over budget, only on Windows. 17 suites under `tests/` made this mistake independently before #3113 routed them through `readText()`; #3311 then deleted the skill-file ones, leaving `tests/claude-md-budget.test.js` as the instance |
| Covering a Windows-reported filesystem failure with a fixture that only reaches the same end state on POSIX, and calling the Windows case tested | The fixture proves the reporting branch, not that Windows reaches it. `teardown-run.js`'s post-prune `existsSync` (#3023) answers a Windows report of a held handle keeping the worktree directory. The test of its still-present branch (`tests/hooks-teardown-run.test.js`, AC10) deletes the worktree's `.git` link so the prune leaves the directory behind. Add a `{ skip: process.platform !== 'win32' && … }` test that holds a handle inside the directory, such as a child process whose `cwd` is there, across `teardownRun`, and keep it beside the POSIX pin |
| A test child that survives `SIGTERM` through a no-op handler, or code that relies on a daemon's own `SIGTERM` handler to write state | On win32 `process.kill(pid, 'SIGTERM')` terminates the target unconditionally and no handler runs. The child dies at once, so the test exercises a different branch than it names, and the handler's state is never written (the `server-stopped` marker behind `cmdStop` in `plugin/bin/lib/visual-decide/cli.js`; the stuck-PID test in `tests/bin-lib/visual-decide/cli.test.js`, #3130). Skip such a test off POSIX with a stated reason, and have the signalling side write the state once the PID is gone |
| Treating a CRLF fix as the whole Windows fix for a test that extracts and runs a skill's shell snippet | The CRLF read can hide a second, separate failure. After #3517's CRLF fix, `windows-latest` still failed the four snippet-running tests: the test passed a native `D:\a\…` `CLAUDE_PLUGIN_ROOT`, and the unquoted heredoc turned its backslashes into JS escapes (`Cannot find module 'D:aclaude-tweaks…'`). Pass the root with forward slashes, and dispatch `windows-regression.yml` on the branch before calling a Windows fix done |
| Searching the raw read for a `'\n\n'` paragraph end when doctoring a go-red control (`text.indexOf('\n\n', i)`, `replace(para + '\n\n', …)`) | On a CRLF checkout the search returns `-1`, `slice(i, -1)` swallows the rest of the file, and the control throws for a vanished anchor instead of the pinned reason, so it goes red on Windows only. LF-normalize the read once before doctoring (`read(f).replace(/\r\n/g, '\n')`, AC3.2 in `tests/wrap-up-record-resolution-conformance.test.js`, #3395) |
| Simulating an unreadable file or directory with `fs.chmodSync(path, 0o000)` and asserting the read fails | On win32 Node's `chmod` only toggles the read-only attribute and never denies a read, so the read succeeds and the test fails on Windows only (the two unreadable-input tests in `tests/skill-load-report-cli.test.js`, #3429). `skipUnderRoot` from `tests/helpers/root.js` does not cover it: it keys on `process.getuid() === 0`, and `getuid` is undefined on win32. Give the test a stated-reason skip, `'win32: chmod does not deny reads'`, combined with the root skip through the options object, and keep the `skipUnderRoot(` call, which `tests/permission-sim-root-skip-conformance.test.js` requires of every chmod-using file. The branch under test is platform-neutral, so POSIX CI still covers it: do not add a production seam for a throwing reader. Many other chmod-using test files share this blind spot, tracked with #2767's baseline set rather than fixed per file |
| Building a CRLF case with `.replace(/\n/g, '\r\n')` on a raw read of a tracked file (`live().replace(…)`) | On a CRLF checkout the read is already `\r\n`, so the replace yields `\r\r\n`, a `\r?\n\r?\n` split finds no paragraph break, and the test fails on Windows only (#3523, `tests/wrap-up-multispec-defer-still-live.test.js`). Read through `readText()` first and assert the built input holds `\r\n` and no `\r\r\n` |
| Fixing a `'\n\n'` paragraph search by swapping a raw read for `readText()` and trusting the green POSIX suite | On macOS/Linux the swap changes nothing, so the suite is green with or without it. `tests/helpers/read-skill.js`'s `crlfCheckoutRead(absPath)` builds the CRLF case from a file path: it returns `{ raw, text }`, where `raw` is the LF text with every `\n` turned into `\r\n` and `text` is that copy read back through `readText()`. Assert `raw.indexOf('\n\n') === -1` and `text === readText(absPath)`, then run the suite's own extractor on `text`. That pins `readText()` and the extractor, not the suite's module-level read, so only a `windows-regression.yml` dispatch on the branch proves the swap itself (#3574: eleven suites fixed, each given a CRLF case, proven by three dispatches) |

## Reference

- Code: `plugin/bin/lib/impeccable-engine/index.js` (`launchSpec`, `probeFailure`, `isSpawnTimeout`), `plugin/bin/lib/release-preflight/pack.js` (`workflowPublishesRelease`), `plugin/bin/lib/reconcile/reap-merged.js` (`longPathRemovalTarget`), `plugin/bin/lib/verify/run.js`, `plugin/bin/lib/hooks/post-tool-use.js` (`checkWindowsLongpaths`), `plugin/bin/lib/atomic-write.js` (`writeFileAtomic`), `plugin/bin/session-tmp-resolve.js` (`formatPrintedPath`), `tools/upstream-drift/checks.js` (`splitGlobPattern`), `plugin/bin/lib/shared-primitives.js` (`toPosix`), `plugin/bin/lib/skill-audit/context-cost.js` (its display-ID producers)
- Tests: `tests/bin-lib/shared-primitives.test.js` (`toPosix` under `path.win32.sep`), `tests/bin-lib/wrap-up/ledger-write.test.js` (resolving `realpathSync` stubs), `tests/bin-lib/impeccable-engine/windows-launch.test.js`, `tests/bin-lib/impeccable-engine/resolve.test.js`, `tests/bin-lib/release-preflight/pack.test.js`, `tests/design-wrapper-doctor-no-fix.test.js`, `tests/session-tmp-resolve-cli.test.js`, `tools/upstream-drift/tests/checks.test.js`, `tests/claude-md-budget.test.js` (#3113's LF-normalized measurement; per-file skill byte budgets were deleted by #3311 and must not be re-added)
- Related skills: `skill-prose-conformance-tests` (CRLF in prose-extraction regexes), `gh-api-module-pattern` (the `execFileSync` seam `launchSpec` feeds)
- Origin: #3040, which closed the Windows-only gaps left by the v6.137.0 release review; #3069, which added the module-injection pattern above; #2767, which added the display-ID and win32-simulation sections; #3316, which added the post-merge `windows-latest` guard and the outside-the-test-bodies section
