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

`plugin/bin/lib/reconcile/reap-merged.js`'s `longPathRemovalTarget(real, platform = process.platform)`, `plugin/bin/lib/verify/run.js`'s `platform = process.platform` option and `plugin/bin/lib/hooks/post-tool-use.js`'s `ctx.platform || process.platform` have the same shape. The comment beside `longPathRemovalTarget` gives the reason: `process.platform` is process-global, so a stub leaks into every other test in the same worker. Tests pass `'win32'` and `'linux'` explicitly (`tests/bin-lib/verify/run.test.js`, `tests/hooks-post-tool-use-worktree-staleness.test.js`).

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
| Code parses text read from a tracked file | An LF case and a CRLF case built from the same string with `.replace(/\n/g, '\r\n')` |
| A test extracts regions from live skill markdown | A CRLF input proving the extractor still finds the region (`skill-prose-conformance-tests`) |
| Behavior only a real Windows process shows (cmd.exe parsing, file locking) | A `{ skip: process.platform !== 'win32' && '<reason>' }` real-process test, kept beside the exact-string pins |

## Project Conventions

- A platform branch with no Linux-runnable pin is untested as far as the merge gate is concerned. Add the pin in the same change as the branch.
- A Windows `npm test` run already fails files that pass on CI. Compare failing-file sets against that baseline rather than reading every red file as new. When you fix a CRLF failure, grep `tests/` for the same regex shape (for example `` ```bash\n ``) and fix or record the other instances.
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
| Mapping every spawn throw to a "not installed" or "not found" verdict | A win32-only `EINVAL` then reads as a real answer with a plausible fix, so nobody looks further (`resolve()` before #3040, #3039) |
| Updating an exact-string pin to match new output without running the win32 round-trip | The pin then records the regression instead of catching it |

## Reference

- Code: `plugin/bin/lib/impeccable-engine/index.js` (`launchSpec`, `probeFailure`, `isSpawnTimeout`), `plugin/bin/lib/release-preflight/pack.js` (`workflowPublishesRelease`), `plugin/bin/lib/reconcile/reap-merged.js` (`longPathRemovalTarget`), `plugin/bin/lib/verify/run.js`, `plugin/bin/lib/hooks/post-tool-use.js` (`checkWindowsLongpaths`)
- Tests: `tests/bin-lib/impeccable-engine/windows-launch.test.js`, `tests/bin-lib/impeccable-engine/resolve.test.js`, `tests/bin-lib/release-preflight/pack.test.js`, `tests/design-wrapper-doctor-no-fix.test.js`
- Related skills: `skill-prose-conformance-tests` (CRLF in prose-extraction regexes), `gh-api-module-pattern` (the `execFileSync` seam `launchSpec` feeds)
- Origin: #3040, which closed the Windows-only gaps left by the v6.137.0 release review
