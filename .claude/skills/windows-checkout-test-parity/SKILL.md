---
name: windows-checkout-test-parity
description: Use when writing or reviewing code or a test in this repo whose behavior differs on a Windows checkout — CRLF line endings from core.autocrlf, a .cmd/.bat launcher spawned through cmd.exe, a win32-only path or env rule — since CI runs on ubuntu only and cannot see any of it. Covers taking `platform`/`env` as parameters, exact-string pins, CRLF inputs built from the LF text, the win32-only real-process round-trip that stays the ground truth, and keeping a Windows-only launch failure from reading as a real answer. Keywords - Windows, win32, CRLF, autocrlf, cmd.exe, .cmd launcher, EINVAL, platform parameter, launchSpec, line endings, Linux-only CI.
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

## Decision Framework

| The platform difference | Pin it with |
|---|---|
| Code branches on the OS (`.cmd` launcher, long-path prefix, case-insensitive env keys) | A `platform` parameter defaulting to `process.platform`, plus exact-string assertions for `'win32'` and one other platform |
| The branch already lives inside a stdlib module (`path.sep`, `path.isAbsolute`) | Inject the module itself (`path.win32`/`path.posix`) as a parameter, defaulting to the platform-native one — no platform string, no internal branch |
| Code parses text read from a tracked file | An LF case and a CRLF case built from the same string with `.replace(/\n/g, '\r\n')` |
| A test measures a tracked file's byte length against a budget/ceiling (`Buffer.byteLength(fs.readFileSync(...))`, `fs.statSync(...).size`) | Read it through `tests/helpers/read-skill.js`'s `readText()` first, so the count is of LF bytes regardless of the checkout's line endings |
| A test extracts regions from live skill markdown | A CRLF input proving the extractor still finds the region (`skill-prose-conformance-tests`) |
| Behavior only a real Windows process shows (cmd.exe parsing, file locking) | A `{ skip: process.platform !== 'win32' && '<reason>' }` real-process test, kept beside the exact-string pins |

## Project Conventions

- A platform branch with no Linux-runnable pin is untested as far as the merge gate is concerned. Add the pin in the same change as the branch.
- A Windows `npm test` run already fails files that pass on CI. Compare failing-file sets against that baseline rather than reading every red file as new. When you fix a CRLF failure, grep `tests/` for the same regex shape (for example `` ```bash\n ``) and fix or record the other instances.
- In a pipeline run, `plugin/bin/verify.js --baseline origin/main --baseline-cmd tests="node --test {file}"` makes that comparison mechanically (#3043). It re-runs each failing file at the base commit and in isolation at HEAD, and exits 0 only when no file is attributable to the branch. The exact invocation is in `plugin/skills/test/verification.md`'s Baseline adjudication. A test that is flaky on Windows can still come back `ATTRIBUTABLE`, because one passing base run proves nothing: `tests/bin-lib/declined-learning/store-concurrency.test.js` failed about 6 runs in 10 at base with an `EPERM` rename race, yet its single base run passed. Re-run such a file at the base several times before treating it as the branch's failure.
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
| Mapping every spawn throw to a "not installed" or "not found" verdict | A win32-only `EINVAL` then reads as a real answer with a plausible fix, so nobody looks further (`resolve()` before #3040, #3039) |
| Updating an exact-string pin to match new output without running the win32 round-trip | The pin then records the regression instead of catching it |
| Comparing a working-tree file's raw bytes with its committed blob to decide "unchanged" | On a CRLF checkout every LF-committed file reads as changed. Hash it with `git hash-object --path=<file>` so the clean filters apply, and compare that with `git rev-parse <sha>:<file>` (`plugin/bin/lib/verify/baseline.js`'s `sameAtBase`, #3043) |
| Measuring a byte-budget ceiling with a raw `fs.readFileSync`/`fs.statSync` read | A CRLF checkout inflates the measured size past a ceiling derived from the LF blob CI actually sees — the test can fail, or silently pass a file that is genuinely over budget, only on Windows. 17 suites under `tests/` made this mistake independently before routing through `readText()` fixed all of them the same way (`tests/release-lifecycle-byte-budget.test.js`, `tests/claude-md-budget.test.js` and siblings, #3113) |

## Reference

- Code: `plugin/bin/lib/impeccable-engine/index.js` (`launchSpec`, `probeFailure`, `isSpawnTimeout`), `plugin/bin/lib/release-preflight/pack.js` (`workflowPublishesRelease`), `plugin/bin/lib/reconcile/reap-merged.js` (`longPathRemovalTarget`), `plugin/bin/lib/verify/run.js`, `plugin/bin/lib/hooks/post-tool-use.js` (`checkWindowsLongpaths`), `plugin/bin/lib/atomic-write.js` (`writeFileAtomic`), `plugin/bin/session-tmp-resolve.js` (`formatPrintedPath`), `tools/upstream-drift/checks.js` (`splitGlobPattern`)
- Tests: `tests/bin-lib/impeccable-engine/windows-launch.test.js`, `tests/bin-lib/impeccable-engine/resolve.test.js`, `tests/bin-lib/release-preflight/pack.test.js`, `tests/design-wrapper-doctor-no-fix.test.js`, `tests/session-tmp-resolve-cli.test.js`, `tools/upstream-drift/tests/checks.test.js`, `tests/release-lifecycle-byte-budget.test.js` and 16 sibling byte-budget suites (#3113 — the normalized-measurement AC1 fixture is the instance to copy for a new byte-budget test)
- Related skills: `skill-prose-conformance-tests` (CRLF in prose-extraction regexes), `gh-api-module-pattern` (the `execFileSync` seam `launchSpec` feeds)
- Origin: #3040, which closed the Windows-only gaps left by the v6.137.0 release review; #3069, which added the module-injection pattern above
