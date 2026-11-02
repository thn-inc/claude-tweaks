# Guard-rewrite Windows native paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a Windows-native path, `plugin-root-placeholder` inlines the plugin root and `drop-redundant-cd` drops a double-quoted `cd "<cwd>" &&`, instead of both declining.

**Architecture:** `rewriteForGuard` gains a `pathImpl` option (default `path`) and reads `lstatType`/`canonicalRealpath` through `deps`, so every win32 branch runs on Linux through `path.win32`. Rule 2 inlines a forward-slashed copy of the root and keeps the native root for its `lstat`. Rule 5's double-quoted `LEADING_CD` branch admits a backslash only before a character bash keeps it literally in front of.

**Tech Stack:** Node 18+ CommonJS, `node --test`, bash and zsh for the equivalence tests.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T224644-record-4292/work/4292-spec.md`, record #4292.

**Scope keywords:** guard-rewrite, rewriteForGuard, LEADING_CD

## Global Constraints

Spec values, verbatim:

- `rewriteForGuard` takes a `pathImpl` option, defaulting to `path`, and passes it to the rules for `isAbsolute`/`sep`. It reads `lstatType`/`canonicalRealpath` through `deps`, so a `path.win32` case runs on Linux.
- `plugin-root-placeholder` inlines the root as `toPosix(pluginRoot, pathImpl.sep)`. `D:/…` passes `LITERAL_VALUE` and means the same quoted or bare. `shippedUnder` still lstat's the native join.
- `drop-redundant-cd` accepts a double-quoted target whose backslashes all precede a character other than `$`, `` ` ``, `"`, `\` or newline, so bash keeps them literally. It still requires the exact spelling of the cwd. An unquoted backslash target still declines, because bash strips those backslashes.

Governing project skills, quoted verbatim:

- `pretooluse-updatedinput-normalizer`: "A rule returns a rewritten string only when it can prove the result means the same thing under both shells the Bash tool runs, bash and zsh. On any doubt it returns `null`, and `rewriteForGuard` returns `null` on any throw. The proofs are allowlists, never denylists"
- `pretooluse-updatedinput-normalizer`: "`drop-redundant-cd` requires the literal to spell the cwd, not merely resolve to it (a symlinked spelling changes `$PWD`), and declines when the rest of the command reads `OLDPWD`."
- `pretooluse-updatedinput-normalizer`: "A new rule adds positive cases to the equivalence list, one must-decline case per bail condition, zsh-only cases marked `shells: ['zsh']` where the form is a bash syntax error, and keeps the harness self-check that the comparison can go red"
- `pretooluse-updatedinput-normalizer`: "`guard-rewrite.js` requires only `path` and `../path-guard` and keeps every scan linear in the command length, because it loads on every skip-path Bash call." This build adds `../shared-primitives`, whose top level requires only `path` and `./path-guard` (`plugin/bin/lib/shared-primitives.js:91-92`, its `./policy` requires are lazy inside functions), so the skip path stays dependency-light. Task 3 updates the sentence.
- `windows-checkout-test-parity`: "Stubbing `process.platform` in a test" is an anti-pattern: "It is process-global, so the stub leaks into other tests in the same `node --test` worker"
- `windows-checkout-test-parity`: "Pinning an extracted platform helper under `path.win32` (`segmentsOf(rel, path.win32)`) and treating its production caller as covered": "Give the caller injectable `pathImpl`/`fsImpl` and pin it under `path.win32` with a fake `lstatSync` that records the paths it sees"
- `windows-checkout-test-parity`: "Interpolating a native path into a Bash command fixture unquoted (`tee ${target}`, `cd ${parent} && …`) in a hook test": "Bash strips an unquoted backslash, so `D:\a\_temp\x` reaches the guard as `D:a_tempx`"
- `windows-checkout-test-parity`: "An identity `realpathSync` stub (`(p) => p`)": "The stub must resolve like the real call: `(p) => path.resolve(p)`"
- `regex-scan-linearity` applies to the new `LEADING_CD` branch: the alternatives `[^"$`\\]` and `\\[^$`"\\\n]` start on disjoint characters, so it cannot backtrack super-linearly. The 60 KB `returns null and does not throw on a malformed command` test already bounds the module; Task 2 adds a long-backslash input to it.

## Spec departures

- **Test line 283 changes too.** The spec lists the expected commands at `:119` and `:144`, and AC4 needs 0 failures in the file. `:281`'s `cd ${CWD}/ && ls x` interpolates a native path unquoted, which the spec itself says must decline on win32, so that line fails on Windows after the fix. Task 2 spells it `cd '${CWD}/' && ls x` (the existing single-quoted branch, no platform branch) and moves the unquoted positive to a host-independent `path.posix` pin. Log `premise reversed: tests need changes only at :119 and :144 → :281's unquoted line also changes` in Task 2's step.
- **ASSUMPTION not verified.** Blocking-verification downgrade: "the guard treats `D:/…` like the native root" needs a live win32 Claude Code session; none exists on this host (decision logged at `Spec Step 3 assumption probe`). The ledger carries it as an `ops` row. Failure mode: the guard refuses as it does today, so the change cannot make a Windows session worse. Waived spec Gotcha's "inline the native root" fallback: not built without evidence.

## Review Focus

1. A POSIX directory whose name really holds a backslash before `$`, a backtick, `"`, `\` or newline: the shell cds elsewhere, so the rule must decline. Task 2's must-decline list runs it under both shells.
2. A cwd spelled differently from the target (`cd "D:/w/cwd"` or `cd "d:\w\cwd"` with cwd `D:\w\cwd`): resolves alike, spelled differently, declines. Task 2.
3. A target ending in a backslash (`cd "D:\w\cwd\" && ls x`): the backslash escapes the quote, so the regex must not match. Task 2.
4. A win32 root holding a space, a `~`, or a UNC prefix: the space inlines only inside double quotes, `~` declines (`LITERAL_VALUE`), UNC becomes `//srv/share/root`. Task 1.
5. A rule reading the native root where the forward-slashed one belongs, or the reverse: `shippedUnder` must lstat `D:\p\root\bin\x.js`, and the command text must say `D:/p/root/bin/x.js`. Task 1's recording `lstatType` pins both.

---

### Task 1: `pathImpl` and fs deps seams, forward-slashed root inlining

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/guard-rewrite.js` (`rewriteForGuard`, `pluginRootPlaceholder`, `shippedUnder`, the require block)
- Test: `tests/bin-lib/hooks/guard-rewrite.test.js`

**Interfaces:**
- Produces: `rewriteForGuard({ command, cwd, pluginRoot, pathImpl = path, deps })`, where `deps` may carry `isLinkedWorktree`, `lstatType(p)` and `canonicalRealpath(p)`, each defaulting to the real one. Rules receive `(s, { cwd, pluginRoot, pathImpl, lstatType, canonicalRealpath })`.

- [ ] **Step 1: Write the failing tests**

Add `const { toPosix } = require('../../../plugin/bin/lib/shared-primitives');` and these fixtures:

```js
const POSIX_ROOT = toPosix(ROOT);
// A win32 session on any host: the fs answers come from the injected deps.
function win32(extra = {}) {
  const lstats = [];
  const shipped = extra.shipped || 'D:\\p\\root\\bin\\x.js';
  return {
    lstats,
    opts: {
      pathImpl: path.win32,
      cwd: 'D:\\w\\cwd',
      pluginRoot: 'D:\\p\\root',
      deps: {
        isLinkedWorktree: () => true,
        lstatType: (p) => { lstats.push(p); return { type: p === shipped ? 'file' : 'missing' }; },
        canonicalRealpath: (p) => path.win32.resolve(p),
      },
      ...extra.opts,
    },
  };
}
```

Change the expected commands at the `:119` and `:144` tests to the forward-slashed root: lines 120, 121 and 154 use `${POSIX_ROOT}`, and line 131 uses `${toPosix(spaced)}`.

New test `AC2.1, AC2.2: plugin-root-placeholder inlines a win32 root forward-slashed and lstats the native join`:

```js
const w = win32();
assert.deepStrictEqual(rewriteForGuard({ command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/x.js" a', ...w.opts }),
  { command: 'node "D:/p/root/bin/x.js" a', applied: ['plugin-root-placeholder'] });
assert.deepStrictEqual(w.lstats, ['D:\\p\\root\\bin\\x.js']);
```

New test `plugin-root-placeholder under path.win32: bare, spaced, tilde and UNC roots`:

```js
const run = (command, pluginRoot, shipped) => rewriteForGuard({ command, ...win32({ shipped, opts: { pluginRoot } }).opts });
assert.strictEqual(run('node $CLAUDE_PLUGIN_ROOT/bin/x.js', 'D:\\p\\root').command, 'node D:/p/root/bin/x.js');
assert.strictEqual(run('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', 'D:\\a b\\root', 'D:\\a b\\root\\bin\\x.js').command, 'node "D:/a b/root/bin/x.js"');
assert.strictEqual(run('node $CLAUDE_PLUGIN_ROOT/bin/x.js', 'D:\\a b\\root', 'D:\\a b\\root\\bin\\x.js'), null, 'unquoted + a space');
assert.strictEqual(run('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', 'C:\\RUNNER~1\\root', 'C:\\RUNNER~1\\root\\bin\\x.js'), null, 'a ~ is outside LITERAL_VALUE');
assert.strictEqual(run('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', '\\\\srv\\share\\root', '\\\\srv\\share\\root\\bin\\x.js').command, 'node "//srv/share/root/bin/x.js"');
assert.strictEqual(run('node "$CLAUDE_PLUGIN_ROOT/bin/x.js"', 'relative\\root'), null, 'not absolute under path.win32');
assert.strictEqual(run('$CLAUDE_PLUGIN_ROOT/bin/x.js', 'D:\\p\\root'), null, 'a drive colon is outside PLAIN_COMMAND_WORD');
```

New test `pathImpl defaults to the host path: a backslash in a POSIX root still declines`:

```js
assert.strictEqual(rw('node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"', { pluginRoot: '/opt/a\\b', pathImpl: path.posix }), null);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/hooks/guard-rewrite.test.js`
Expected: FAIL after Step 1: the new `AC2.1, AC2.2` and `bare, spaced` tests get `null`.

- [ ] **Step 3: Implement the seams and the inlining**

Require `{ toPosix }` from `../shared-primitives`. In `rewriteForGuard`, read `pathImpl = path` from `opts`, check `pathImpl.isAbsolute(cwd)`, and pass `{ cwd, pluginRoot, pathImpl, lstatType: deps.lstatType || lstatType, canonicalRealpath: deps.canonicalRealpath || canonicalRealpath }` to each rule. In `pluginRootPlaceholder(s, { pluginRoot, pathImpl, lstatType })`: `pathImpl.isAbsolute(pluginRoot)`, `const inlined = toPosix(pluginRoot, pathImpl.sep)`, test `LITERAL_VALUE` and `refsInlineSafely` and `replaceSpans` on `inlined`, and call `shippedUnder(pluginRoot, s, r.end, { pathImpl, lstatType })`, which joins with `pathImpl.join`. Parameter names shadow the module-level `lstatType`: rename the injected ones `lstat` and `realpath` if the shadowing reads badly. `isLinkedWorktree`, `guardRewriteOutput` and `DEFAULT_PLUGIN_ROOT` stay on the host `path`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/hooks/guard-rewrite.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit `tests/bin-lib/hooks/guard-rewrite.test.js` and `plugin/bin/lib/hooks/guard-rewrite.js`: `Inline a win32 plugin root forward-slashed — refs #4292`.

### Task 2: Backslash-tolerant double-quoted `LEADING_CD`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/guard-rewrite.js:642` (`LEADING_CD`), `dropRedundantCd`
- Test: `tests/bin-lib/hooks/guard-rewrite.test.js`

**Interfaces:**
- Consumes: Task 1's `win32()` fixture and rule context.

- [ ] **Step 1: Write the failing tests**

Replace line 283 with `` assert.deepStrictEqual(rw(`cd '${CWD}/' && ls x`), { command: 'ls x', applied: ['drop-redundant-cd'] }); `` and add `` assert.deepStrictEqual(rw(`cd "${CWD}/" && ls x`), { command: 'ls x', applied: ['drop-redundant-cd'] }); ``. Log the premise-reversed line named under Spec departures with `log-decision.js --status AUTO --step "Spec Step 3"`.

New test `AC2.3, AC2.4: drop-redundant-cd under path.win32`:

```js
const run = (command, extra) => rewriteForGuard({ command, ...win32({ opts: extra }).opts });
assert.deepStrictEqual(run('cd "D:\\w\\cwd" && ls x'), { command: 'ls x', applied: ['drop-redundant-cd'] });
assert.strictEqual(run('cd D:\\w\\cwd && ls x'), null, 'bash strips an unquoted backslash');
assert.strictEqual(run('cd "D:\\w\\$X" && ls x'), null, 'a backslash before $');
assert.strictEqual(run('cd "D:\\w\\cwd\\" && ls x'), null, 'a trailing backslash escapes the quote');
assert.strictEqual(run('cd "D:/w/cwd" && ls x'), null, 'the same directory, spelled differently');
assert.strictEqual(run('cd "d:\\w\\cwd" && ls x'), null, 'a re-cased drive');
assert.strictEqual(run('cd "D:\\w\\other" && ls x'), null, 'a different directory');
assert.strictEqual(run('cd "E:\\w\\cwd" && ls x'), null, 'another drive');
assert.deepStrictEqual(rewriteForGuard({ command: 'cd /w/cwd/ && ls x', cwd: '/w/cwd', pluginRoot: ROOT, pathImpl: path.posix, deps: { isLinkedWorktree: () => true, canonicalRealpath: (p) => path.posix.resolve(p) } }), { command: 'ls x', applied: ['drop-redundant-cd'] }, 'an unquoted target with no backslash');
```

New tests, each `{ skip: process.platform === 'win32' || !SHELLS.includes('bash') }`:

- `drop-redundant-cd with a literal backslash in the cwd is argv-identical under bash and zsh`: make `path.join(SANDBOX, 'bs', 'back\\slash')`, `rw` with that `cwd` and `` `cd "${dir}" && pwd && ls x` ``, assert `applied` is `['drop-redundant-cd']`, then run original and rewrite through a variant of `runIn` taking `cwd`, and `deepStrictEqual` stdout, stderr and status. Extend `runIn` with an optional `cwd` argument rather than copying it.
- `drop-redundant-cd declines each backslash the shell would consume`: for each `tail` of `` ['a\\$X', 'a\\`X', 'a\\"X', 'a\\\\X', 'a\\\nX'] ``, make the directory literally named `tail` under a fresh fixture, and the directory the shell resolves it to (`a$X`, `` a`X ``, `a"X`, `a\X`, `aX`). Assert `rw` with that cwd returns null, and that under each shell `` cd "${dir}" && pwd `` prints something other than the `pwd` of the naive rewrite, so each decline is earned.
- `drop-redundant-cd declines an unquoted backslash target`: directories `ba\c` and `bac`; `` cd ${dir} && pwd `` run from `ba\c` prints `.../bac`, `rw` returns null.
- `property: a backslash-spelled double-quoted cd drops only when the shell lands in the same directory`: `mulberry32(4292)`, 150 draws of one to three segments from `` ['a', '\\b', '\\c', '\\$x', '\\`x', '\\\\y', '\\"q', '$x', ' s'] ``, joined into a directory name created literally under `SANDBOX/prop/{n}`, as cwd. `` command = `cd "${dir}" && pwd` ``. On a rewrite, `deepStrictEqual` the rewrite's result to the original's under each shell. Assert at least 30 rewrites and at least 30 declines, and report both with `t.diagnostic`.

In `returns null and does not throw on a malformed command`, add `` `cd "${'\\a'.repeat(30000)}` `` and `` `cd "${'\\a'.repeat(30000)}" && ls` `` to the list.

Go-red control for AC1's equivalence: the must-decline test's naive-differs assertion is what keeps it honest, and it already runs the same comparison as the positive test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/hooks/guard-rewrite.test.js`
Expected: FAIL after Step 1: the first assertion of the new `AC2.3, AC2.4` and `literal backslash` tests gets `null`.

- [ ] **Step 3: Implement**

`LEADING_CD`'s double-quoted branch becomes `"((?:[^"$`\\]|\\[^$`"\\\n])*)"`, the other two branches unchanged. `dropRedundantCd(s, { cwd, pathImpl, canonicalRealpath })` uses `pathImpl.isAbsolute(target)`; the exact-spelling compare and both realpath calls keep their logic, through the injected `canonicalRealpath`. Update the comment above the rule to say why a backslash is admitted only in the double-quoted branch.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/hooks/guard-rewrite.test.js tests/hooks-pre-tool-use.test.js`
Expected: PASS (AC1.1).

- [ ] **Step 5: Commit**

Commit the same two files: `Accept a backslash-spelled double-quoted cd target — refs #4292`.

### Task 3: Prose that states the old behavior

**Role:** transcription

**Files:**
- Modify: `plugin/bin/lib/hooks/guard-rewrite.js:36-39` (module header's "requires only")
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js:30-32` (Dependency-light comment)
- Modify: `docs/hooks.md:22` ("The module requires only")
- Modify: `.claude/skills/pretooluse-updatedinput-normalizer/SKILL.md` (the "requires only" sentence; the `drop-redundant-cd` bullet gains the double-quoted backslash rule)
- Modify: `docs/reference/pretooluse-updatedinput-worktree-guard.md` ("What the plugin does with it", "Not measured")
- Test: `tests/guard-refusals/probe-doc.test.js` (read-only; must stay green)

- [ ] **Step 1: Edit the prose**

Each "requires only" sentence becomes: `path`, `../path-guard` and `../shared-primitives` (whose top level requires only `path` and `./path-guard`). `docs/hooks.md`'s contract gains one bullet after "Rules 1 and 2 decline on doubt":

`**Windows paths.** Rule 2 inlines the root forward-slashed (`toPosix`, `D:/p/root/bin/x.js`), and `shippedUnder` still lstats the native join. Rule 5 admits a backslash in a double-quoted target only before a character other than `$`, a backtick, `"`, `\` or newline, since the shell keeps it literally there; an unquoted backslash target declines. `pathImpl` and `deps` pin both on any host through `path.win32`.`

The reference doc's "Not measured" gains: `**Not measured:** a Windows session. Whether the guard treats the forward-slashed plugin root `D:/…` like a native root is unprobed; a refusal there is the same refusal an unrewritten command gets.` The "What the plugin does with it" paragraph gains the same one-line Windows sentence as the bullet's first clause.

Confirm `.claude/skills/lib-module-split/SKILL.md`'s `../path-guard` hit is not about guard-rewrite: `grep -n "guard-rewrite" .claude/skills/lib-module-split/SKILL.md` prints nothing. Confirm `plugin/bin/lib/hooks/pre-tool-use.js` and `context.js` and `resume-freshness.js` hits are their own requires.

- [ ] **Step 2: Verify**

Run: `node --test tests/guard-refusals/probe-doc.test.js tests/hooks-bash-prefilter.test.js`
Expected: PASS.
Run: `git grep -n -F "requires only" -- docs/hooks.md plugin/bin/lib/hooks/guard-rewrite.js .claude/skills/pretooluse-updatedinput-normalizer/SKILL.md`
Expected: every hit names `shared-primitives`. Control: `git grep -n -F "requires only" d94faf5c1 -- docs/hooks.md` matches the old sentence.

- [ ] **Step 3: Commit**

`Name the shared-primitives require and the Windows path rules in the normalizer prose — refs #4292`.

## Acceptance coverage

| Clause | Covered by |
|---|---|
| AC1.1 | Task 2 Step 4's command, and the equivalence and property tests it runs |
| AC2.1 | Task 1 `AC2.1, AC2.2` test |
| AC2.2 | Task 1 `AC2.1, AC2.2` test |
| AC2.3 | Task 2 `AC2.3, AC2.4` test |
| AC2.4 | Task 2 `AC2.3, AC2.4` test |
| AC3.1, AC3.2 | Controller scratch check after Task 2: revert `toPosix` to the bare root and `LEADING_CD` to its old branch one at a time, run the AC2 tests, require `null`. Evidence: `$PIPELINE_RUN_DIR/evidence/ac3-go-red.txt`, one `AC evidence` entry via `log-decision.js --text-file` |
| AC4.1 | Controller, after Common Step 3 and after any later code change: `gh workflow run windows-regression.yml --ref {branch}`, then the run's `verify-report.json` `failingFiles` plus the isolated log for `tests/bin-lib/hooks/guard-rewrite.test.js`. Evidence: `$PIPELINE_RUN_DIR/evidence/ac4-windows-run.txt`, one `AC evidence` entry |
