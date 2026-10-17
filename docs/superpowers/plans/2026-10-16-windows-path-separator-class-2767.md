# Windows path-separator test class (#2767, Deliverable 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Windows path-separator class at its root: one shared separator-normalizing helper used by the producer that emits `\` into repo-display IDs, and expected values built with `path.resolve`/`path.join` (never a per-fixture `.replace`) where production legitimately returns a native filesystem path.

**Architecture:** A static map of the class (this run's investigation, recorded in the Class map section below) split it into PRODUCER rows (production writes an OS-native path where its contract is a `/` display ID — `plugin/bin/lib/skill-audit/context-cost.js`) and TEST-ONLY rows (production returns a native path it opens; only the test's expected literal hard-codes `/`). Producers get `toPosix(p, sep = path.sep)` — promoted into `plugin/bin/lib/shared-primitives.js` beside `isPathContained`, taking `sep` as a parameter so a test pins the win32 branch with `path.win32.sep` on any host (`.claude/skills/windows-checkout-test-parity`'s inject-the-stdlib-module pattern). Test-only rows build their expected values the way #3074 already did for the hooks suites.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T195708-spec-2767/work/2767-spec.md` (record #2767)

## Global Constraints

- Scope is Deliverable 2 only. Deliverable 1 (classify the Windows failing set; before/after quotes on Windows) needs a Windows checkout and is not attempted; Deliverable 3 is routed as leftover. Do not touch #2763's CRLF class.
- No fixture-by-fixture `.replace('\\', '/')` patches (record AC). Building an expected value with `path.resolve`/`path.join` is not that — it is the #3074 pattern.
- Never stub `process.platform` or mutate the `path` module in a committed test (`windows-checkout-test-parity` anti-pattern).
- Evidence on this macOS host comes from a scratch **win32 path simulation** (`/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/3400fc5c-0be5-4dd0-a151-79cf0b269c9f/scratchpad/win32sim/preload.js`: swaps Node's public `path` methods for `path.win32`'s outside module loading). It is not a Windows run and is never reported as one; fs-backed tests produce noise under it.

## Class map

The spec names `context-cost`, `hooks-git-command`, `cloud-setup-drift-check`, `verify-scope-starter` and `archive-merged` as members of the class. The static investigation for this plan sorted them, and the other suites it found, as follows:

- **Producer, fixed here:** `plugin/bin/lib/skill-audit/context-cost.js`. Three `path.relative` results are serialized as repo-display IDs (Task 2).
- **Test-only, fixed here:** these suites expected `/` where production legitimately returns a native fs path (Task 3):
  - `context-cost` (`parseComposeCallLine` sources)
  - `hooks-git-command`
  - `hooks-gate-coverage` (#3080's rows)
  - `verify-scope-starter` (fake-fs keys)
  - `ledger-write`
  - `verify/report`
- **Not this class, so routed as leftovers:**
  - `cloud-setup-drift-check` joins `PATH` with `:` where it needs `path.delimiter`, and its fixtures run shell-script stubs. Both are Windows faults, but neither is a separator fault.
  - `archive-merged` could not be classified statically. It needs a real Windows run.
  - `code-health/scope.js` (`splitOversized` key) and `residue/probes/worktrees.js` (a domain `includes` check) look like latent producer faults with no failing test.
  - `timing/transcript.js` (`isProcedurePath` input) also looks like a latent producer fault.
  - `plan-audit` and `findability` have display inconsistencies.

## Review Focus

1. A repo-display path from `path.relative` on win32 (`demo\SKILL.md`) must serialize as `demo/SKILL.md` — `context-cost.js`'s three producer sites.
2. `toPosix` with `sep` = `/` must be the identity (POSIX hosts unchanged), and with `\` must convert every separator, including a leading one.
3. A path production opens with `fs` must stay native — never `toPosix` a path that is later passed to `fs.readFileSync` (`parseComposeCallLine`'s `sources`, `git-command.js`'s resolved targets, `ledger-write.js`, `report.js`'s `gitDir`).
4. Passthrough pins that production returns verbatim (`hooks-git-command`'s `'/repo'` literal cases) stay literal — wrapping them in `path.resolve` would make them wrong on win32.
5. A fake fs keyed on `'/w/...'` must be queried with `/` keys regardless of host separator (`verify-scope-starter`'s memFs).

---

### Task 1: `toPosix` shared helper

**Files:**
- Modify: `plugin/bin/lib/shared-primitives.js`
- Test: `tests/bin-lib/shared-primitives.test.js`

**Interfaces:**
- Produces: `toPosix(p: string, sep?: string = path.sep): string` exported from `plugin/bin/lib/shared-primitives.js`.

- [ ] **Step 1: Write the failing test** — append to `tests/bin-lib/shared-primitives.test.js` (import `toPosix` alongside the file's existing `shared-primitives` import, and `path` if not already required):

```js
test('toPosix converts a win32-separated path to forward slashes (#2767)', () => {
  assert.strictEqual(toPosix('demo\\SKILL.md', path.win32.sep), 'demo/SKILL.md');
  assert.strictEqual(toPosix('wrap-up\\a\\b.md', path.win32.sep), 'wrap-up/a/b.md');
  assert.strictEqual(toPosix('\\lead\\x', path.win32.sep), '/lead/x');
});

test('toPosix is the identity under a POSIX separator (#2767)', () => {
  assert.strictEqual(toPosix('a/b/c.md', path.posix.sep), 'a/b/c.md');
  assert.strictEqual(toPosix('a\\b', path.posix.sep), 'a\\b', 'a backslash is a filename character on POSIX');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node -e "process.exit(typeof require('./plugin/bin/lib/shared-primitives.js').toPosix === 'function' ? 0 : 1)"`
Expected: FAIL (exit 1 — `toPosix` is not exported yet).

- [ ] **Step 3: Implement** — in `plugin/bin/lib/shared-primitives.js`, add near `isPathContained` and export it:

```js
// A path with every `sep` separator rewritten to `/` — the repo-display form
// (git output, JSON report IDs, globs). `sep` is a parameter so a test can pin
// the win32 branch with `path.win32.sep` on any host (#2767). Never apply it to
// a path that is then opened with fs: that one stays native.
function toPosix(p, sep = path.sep) {
  return sep === '/' ? p : p.split(sep).join('/');
}
```

- [ ] **Step 4: Run tests** — `node --test tests/bin-lib/shared-primitives.test.js` → PASS.

- [ ] **Step 5: Commit** — `git -C "$WORKTREE" add plugin/bin/lib/shared-primitives.js tests/bin-lib/shared-primitives.test.js` then commit `Add toPosix to shared-primitives — repo-display paths in forward slashes (refs #2767)`.

### Task 2: context-cost writes repo-display IDs in forward slashes

**Files:**
- Modify: `plugin/bin/lib/skill-audit/context-cost.js` (lines ~165 `measureSubFiles`, ~225 `measureComposed` source label, ~360 `findComposeCallSites`)

**Interfaces:**
- Consumes: `toPosix` from Task 1.

- [ ] **Step 1: No new test** — the existing `tests/bin-lib/skill-audit/context-cost.test.js` assertions already pin `/` (e.g. lines ~439-442, ~459-466, ~476-484); on win32 they fail today because these three sites emit `path.relative` output verbatim.

- [ ] **Step 2: Show the failure under simulation**

Run: `node --require /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/3400fc5c-0be5-4dd0-a151-79cf0b269c9f/scratchpad/win32sim/preload.js --test-reporter=tap tests/bin-lib/skill-audit/context-cost.test.js`
Expected: FAIL (simulation; 25 failing before this plan, including the `findComposeCallSites` ones).

- [ ] **Step 3: Implement** — import `toPosix` from `../shared-primitives` and wrap exactly those three `path.relative(...)` results: `file: toPosix(path.relative(dir, p))` at `measureSubFiles` and `findComposeCallSites`, and the `path:` label at `measureComposed`. Leave every `path.join`/`path.resolve` that feeds `fs` untouched.

- [ ] **Step 4: Run** `node --test tests/bin-lib/skill-audit/context-cost.test.js tests/context-cost-report-cli.test.js` → PASS natively.

- [ ] **Step 5: Commit** — `Write context-cost repo-display IDs in forward slashes on every platform (refs #2767)`.

### Task 3: expected values at the assertion boundary for native-path producers

**Files:**
- Modify: `tests/bin-lib/skill-audit/context-cost.test.js` (~402-408, ~517 — `parseComposeCallLine` `sources`)
- Modify: `tests/hooks-git-command.test.js` (the 27 assertions whose expected value is a resolved target: `resolveCd`, `skipGlobalFlags` `-C`, `resolveWriteTarget` for tee/cp/mv/mkdir/env; e.g. ~14-15, ~19-34, ~47-48, ~61-75, ~115, ~145-161)
- Modify: `tests/hooks-gate-coverage.test.js` (~333-345, #3080's `'/r/tracked-file.js'`)
- Modify: `tests/bin-lib/init/verify-scope-starter.test.js` (its `memFs` helper)
- Modify: `tests/bin-lib/wrap-up/ledger-write.test.js` (~23-27, ~56-60)
- Modify: `tests/bin-lib/verify/report.test.js` (~166-169)

**Interfaces:**
- Consumes: `toPosix` (Task 1) in `verify-scope-starter.test.js`'s `memFs` only.

Rules (apply to every site; read each assertion before editing):
- Production returns a native filesystem path → build the expected value with `path.resolve(...)` (absolute) or `path.join(...)` (relative), e.g. `path.resolve('/r', 'skills/_shared/pr-first-merge.md')`, `path.resolve('/r', 'tracked-file.js')`, `path.resolve('/repo/.git/worktrees/wt')`.
- Production returns the input verbatim (`hooks-git-command`'s `'/repo'` passthrough pins) → leave the literal.
- `verify-scope-starter.test.js`'s `memFs`: normalize each incoming path with `toPosix(p)` before the key lookup, so the fake fs keyed on `'/w/...'` answers whatever separator the producer built with. Do not touch the producer.
- `ledger-write.test.js`: build fixture keys and expected values with `path.join`/`path.resolve`; a `realpath` stub returns `path.resolve(p)`.

- [ ] **Step 1: Show the failures under simulation**

Run: `node --require /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/3400fc5c-0be5-4dd0-a151-79cf0b269c9f/scratchpad/win32sim/preload.js --test-reporter=tap tests/hooks-git-command.test.js`
Expected: FAIL (simulation; 27 failing before this task).

- [ ] **Step 2: Edit the six files per the rules above.**

- [ ] **Step 3: Run natively** — `node --test tests/bin-lib/skill-audit/context-cost.test.js tests/hooks-git-command.test.js tests/hooks-gate-coverage.test.js tests/bin-lib/init/verify-scope-starter.test.js tests/bin-lib/wrap-up/ledger-write.test.js tests/bin-lib/verify/report.test.js` → PASS (no native regression).

- [ ] **Step 4: Re-run under simulation** — the controller diffs per-test failing names against the recorded before-set; every targeted assertion must leave the failing set. Remaining simulated failures must each be attributable to fs/git noise of the simulation, named in the report.

- [ ] **Step 5: Commit** — `Build path-separator expected values at the assertion boundary (refs #2767)`.
