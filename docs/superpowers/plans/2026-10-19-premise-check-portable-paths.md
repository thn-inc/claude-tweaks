# Premise-check Portable Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make harness-health `Premise-check:` commands portable across machines — repo-relative paths for in-repo targets, and `materialize.js` running the command from the checkout root.

**Architecture:** Compose side: `buildPremiseCheck(finding, targetPath, root)` swaps an in-root absolute target for its repo-relative POSIX path; `toIssuePayload` passes its existing `options.repoRoot` (already wired from `cmdValidateFindings`, #2975) as `root`. Run side: `materialize.js` resolves the checkout root once (`git rev-parse --show-toplevel` from its own cwd) through a new injectable `deps.checkoutRoot()`, and passes it as `cwd` to the shared health-core runner; an unresolvable root degrades `premise` to `null`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, POSIX `/bin/sh`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T052805-record-2857/work/2857-spec.md` (worktree copy)

Scope keywords: buildPremiseCheck, runPremiseCheck

## Global Constraints

- A target under the sweep root is composed with its repo-relative POSIX path (`/` separators, no leading `/`, no root prefix).
- A target outside the root (memory files under `--memory-dir`, any path not under `root`) keeps its absolute path, byte-identical to today's output.
- `buildPremiseCheck` called without `root` produces exactly today's output.
- Both `shQuote(targetPath)` sites (the `test -r` guard and the `grep`) use the same chosen path.
- `materialize.js` runs the premise command with `cwd` = checkout root; an unresolvable root makes `premise` `null`, never a throw.
- The author-association gate in `materialize.js` is unchanged.
- No change to `plugin/bin/harness-health.js`: `cmdValidateFindings` already passes `repoRoot: root` (absolute, `path.resolve`d at line 169) to `toIssuePayload` — verified by reading `plugin/bin/harness-health.js:285-286`. (Logged as `premise reversed` in decisions.md — the spec's Key Files listed this file.)

## Review Focus

1. A sibling directory sharing the root's string prefix (`/repo-old/x.md` with root `/repo`) must stay absolute — `path.relative` yields `../repo-old/x.md`. Pinned in Task 1.
2. A file inside the root whose name starts with `..` (`/repo/..notes.md`) is in-root and must be relative — a naive `startsWith('..')` test would misclassify it. Pinned in Task 1.
3. A target equal to the root itself (relative path `''`) must keep the absolute path, never compose an empty quoted path. Pinned in Task 1.
4. `materialize.js` invoked from a subdirectory of the checkout (not its top level) must still resolve a repo-relative path. Pinned in Task 2's cross-root test (cwd = `B/sub`).
5. `materialize.js` run outside any git checkout (`checkoutRoot` throws or returns empty) must report `premise: null` and exit 0, never run the command in some arbitrary cwd. Pinned in Task 2.

---

### Task 1: Compose in-repo Premise-check paths repo-relative

**Files:**
- Modify: `plugin/bin/lib/harness-health/issue-payload.js` (`buildPremiseCheck` ~line 67; its call in `toIssuePayload` ~line 143; header comment block above `buildPremiseCheck`)
- Test: `tests/bin-lib/harness-health/issue-payload.test.js` (append)
- Test: `tests/bin-lib/health-core/premise-self-check.test.js` (append one relative-path case)
- Modify: `tests/bin-lib/harness-health/cli-validate-findings.test.js` (~line 396-413, expected path becomes relative)
- Modify: `docs/journeys/harness-health-premise-check.md` (step 3 Red flags line, ~line 40)

**Interfaces:**
- Produces: `buildPremiseCheck(finding, targetPath, root?) -> string | undefined` — `root` optional absolute directory; exported unchanged from `issue-payload.js`.
- Consumes: `toIssuePayload(finding, verifiedAsOf, pluginVersion, options)`'s existing `options.repoRoot`.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/harness-health/issue-payload.test.js`, reusing its existing `buildPremiseCheck` import)

```js
test('AC1.1: buildPremiseCheck composes an in-root additive target with its repo-relative path', () => {
  const cmd = buildPremiseCheck({ kind: 'patch', newString: 'X' }, '/repo/.claude/skills/auth.md', '/repo');
  assert.strictEqual(cmd, "! grep -qF -- 'X' '.claude/skills/auth.md'");
});
test('AC1.1: buildPremiseCheck composes an in-root removal with the relative path at both quoted sites', () => {
  const cmd = buildPremiseCheck({ kind: 'patch', intent: 'remove', oldString: 'old' }, '/repo/CLAUDE.md', '/repo');
  assert.strictEqual(cmd, "! test -r 'CLAUDE.md' || grep -qF -- 'old' 'CLAUDE.md'");
});
test('AC2.1: an out-of-root target (memory file) keeps its absolute path, byte-identical to the no-root output, both polarities', () => {
  const mem = '/home/u/.claude/projects/x/memory/note.md';
  const add = { kind: 'patch', newString: 'X' };
  const rem = { kind: 'patch', intent: 'remove', oldString: 'old' };
  assert.strictEqual(buildPremiseCheck(add, mem, '/repo'), buildPremiseCheck(add, mem));
  assert.strictEqual(buildPremiseCheck(rem, mem, '/repo'), buildPremiseCheck(rem, mem));
  assert.ok(buildPremiseCheck(add, mem, '/repo').includes(`'${mem}'`));
});
test('AC3.1: buildPremiseCheck without root keeps the absolute path exactly as before', () => {
  assert.strictEqual(buildPremiseCheck({ kind: 'patch', newString: 'X' }, '/repo/CLAUDE.md'), "! grep -qF -- 'X' '/repo/CLAUDE.md'");
});
test('a sibling directory sharing the root prefix stays absolute', () => {
  assert.strictEqual(buildPremiseCheck({ kind: 'patch', newString: 'X' }, '/repo-old/x.md', '/repo'), "! grep -qF -- 'X' '/repo-old/x.md'");
});
test('an in-root file whose name starts with .. is still relative', () => {
  assert.strictEqual(buildPremiseCheck({ kind: 'patch', newString: 'X' }, '/repo/..notes.md', '/repo'), "! grep -qF -- 'X' '..notes.md'");
});
test('a target equal to the root keeps its absolute path', () => {
  assert.strictEqual(buildPremiseCheck({ kind: 'patch', newString: 'X' }, '/repo', '/repo'), "! grep -qF -- 'X' '/repo'");
});
test('AC1.1: toIssuePayload threads options.repoRoot into the Premise-check line', () => {
  const payload = toIssuePayload(patchFinding({ path: '/repo/.claude/skills/auth.md' }), undefined, undefined, { repoRoot: '/repo' });
  assert.match(payload.body, /^Premise-check: ! grep -qF -- '.*' '\.claude\/skills\/auth\.md'$/m);
  assert.ok(!payload.body.includes("'/repo/.claude"), 'no absolute path in the line');
});
```

(`patchFinding` is the file's existing fixture factory at the top of `issue-payload.test.js`; no `premiseSelfCheck` option is passed, so the line is kept as composed.)

Append to `tests/bin-lib/health-core/premise-self-check.test.js`:

```js
test('AC4.1: real shell: a repo-relative command composed with root resolves at filing time (cwd: root)', () => {
  const dir = tmpWithSpace();
  fs.mkdirSync(path.join(dir, '.claude', 'skills'), { recursive: true });
  const target = path.join(dir, '.claude', 'skills', 'auth.md');
  fs.writeFileSync(target, '# auth\n\nSee `src/auth/login.js`.\n');
  const command = buildPremiseCheck({ kind: 'patch', newString: 'See `src/auth/session.js`.' }, target, dir);
  assert.ok(!command.includes(dir), 'the command carries no absolute root');
  assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), true);
  fs.writeFileSync(target, '# auth\n\nSee `src/auth/session.js`.\n');
  assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/harness-health/issue-payload.test.js tests/bin-lib/health-core/premise-self-check.test.js`
Expected: FAIL — the new AC1.1/AC4.1/`..notes.md` tests fail (absolute paths still composed).

- [ ] **Step 3: Implement `buildPremiseCheck(finding, targetPath, root)` in `plugin/bin/lib/harness-health/issue-payload.js`**

After the existing guards, choose the path: when `root` is truthy, `const rel = path.relative(root, path.resolve(root, targetPath))`; use `rel.split(path.sep).join('/')` when `rel !== ''`, `!path.isAbsolute(rel)`, and `rel !== '..' && !rel.startsWith('..' + path.sep)`; otherwise keep `targetPath` unchanged. Both `shQuote` sites use the chosen path. In `toIssuePayload`, call `buildPremiseCheck(finding, finding.path, options.repoRoot)`. Update the function's header comment: the "baked-in absolute path" paragraph now says in-root targets are repo-relative (run from the checkout root by `materialize.js`), out-of-root targets stay absolute and still fail safe off-machine (#2857).

- [ ] **Step 4: Update the CLI end-to-end test** — in `tests/bin-lib/harness-health/cli-validate-findings.test.js`'s `'validate-findings: a patch finding against a real target file carries a Premise-check: line resolvable to that file'`, assert the body includes `` Premise-check: ! grep -qF -- 'See \`src/auth/session.js\`.' '.claude/skills/auth.md' `` (replacing the `expectedPath` absolute form) and add `assert.ok(!payloads[0].body.includes(root))` for the Premise-check line's absence of the temp root (check only the `Premise-check:` line, e.g. via `body.split('\n').find(l => l.startsWith('Premise-check:'))`).

- [ ] **Step 5: Update the journey's step-3 red flag** — `docs/journeys/harness-health-premise-check.md` line ~40: replace "A kept line whose target path isn't absolute." with the new contract: a kept line for an in-repo target whose path is absolute (it must be repo-relative, so it resolves from any checkout root), or an out-of-repo target (a `--memory-dir` memory file) whose path isn't absolute. Keep the following sentence about `--root` being resolved absolute first (the relative path is computed against it), and the "Every other health skill…" sentence.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/bin-lib/harness-health/issue-payload.test.js tests/bin-lib/health-core/premise-self-check.test.js tests/bin-lib/harness-health/cli-validate-findings.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/harness-health/issue-payload.js tests/bin-lib/harness-health/issue-payload.test.js tests/bin-lib/health-core/premise-self-check.test.js tests/bin-lib/harness-health/cli-validate-findings.test.js docs/journeys/harness-health-premise-check.md
git commit -m "Compose in-repo Premise-check paths repo-relative — refs #2857"
```

### Task 2: Run materialize's premise check from the checkout root

**Files:**
- Modify: `plugin/bin/materialize.js` (`runPremiseCheckDefault` ~line 123, `computePremise` ~line 137, `realDeps` ~line 205, `module.exports` ~line 578)
- Test: `tests/materialize-premise-check.test.js` (modify `fakeDeps` ~line 62 and the two inline `deps` objects ~lines 280 and 318; append new tests)
- Modify: `docs/journeys/harness-health-premise-check.md` (step 5 Red flags, ~line 54)

**Interfaces:**
- Consumes: Task 1's `buildPremiseCheck(finding, targetPath, root)` (test only).
- Produces: `deps.checkoutRoot() -> string` (throws or returns empty when unresolvable); `deps.runPremiseCheck(command, { cwd }) -> number`; exported `runPremiseCheckDefault(command, { cwd }) -> number` and `resolveCheckoutRoot() -> string`.

Dependency-caller enumeration (grep `runPremiseCheck` over `tests/` and `plugin/`): only `tests/materialize-premise-check.test.js` and `plugin/bin/materialize.js`. Every deps object in that test file that reaches `computePremise` with a command needs `checkoutRoot: () => root` (`fakeDeps`, plus the inline objects at ~280 and ~318 — the ~318 one asserts the runner is never called, add it anyway for uniformity).

- [ ] **Step 1: Write the failing tests** (in `tests/materialize-premise-check.test.js`; add `checkoutRoot` as an optional `fakeDeps` option defaulting to `() => root`, and require `runPremiseCheckDefault`, `resolveCheckoutRoot` from `../plugin/bin/materialize` and `buildPremiseCheck` from `../plugin/bin/lib/harness-health/issue-payload`)

```js
test('premise: the runner receives the resolved checkout root as cwd', () => {
  // fakeDeps(repo, { body: shapedBodyWithPremiseCheck('true'), runPremiseCheck: (c, o) => { seen.push(o); return 0; } })
  // run(...) -> assert.deepStrictEqual(seen, [{ cwd: repo }])
});
test('AC5.1: a command composed under root A reads unresolved from checkout B until B\'s file carries the anchor, then resolved', () => {
  // A = fs.mkdtempSync(...) (plain temp dir); command = buildPremiseCheck({ kind: 'patch', newString: 'ANCHOR-2857' }, path.join(A, '.claude', 'skills', 'auth.md'), A)
  // assert.ok(!command.includes(A))
  // B = gitRepo(); write B/.claude/skills/auth.md WITHOUT the anchor; mkdir B/sub
  // withCwd(path.join(B, 'sub'), () => run([...], fakeDeps(B, { body: shapedBodyWithPremiseCheck(command), runPremiseCheck: runPremiseCheckDefault, checkoutRoot: resolveCheckoutRoot })))
  // -> envelope.premise deepEquals { command, exit: 0, satisfiedAtBase: false }
  // write the anchor line into B's file, run again with a fresh runDir -> envelope.premise.satisfiedAtBase === true, exit !== 0
});
test('AC6.1: an unresolvable checkout root degrades premise to null without throwing or running the command', () => {
  // two cases: checkoutRoot: () => { throw new Error('not a git repository'); } and checkoutRoot: () => ''
  // runPremiseCheck throws if called; run(...) returns 0; envelope.premise === null
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/materialize-premise-check.test.js`
Expected: FAIL — `runPremiseCheckDefault`/`resolveCheckoutRoot` are not exported, the runner receives no `cwd`, and the unresolvable-root case still runs the command.

- [ ] **Step 3: Implement in `plugin/bin/materialize.js`**

- `function resolveCheckoutRoot()` — `String(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true })).trim()`.
- `function runPremiseCheckDefault(command, { cwd } = {})` — `runPremiseCommand(command, { cwd, timeoutMs: PREMISE_SELF_CHECK_TIMEOUT_MS })`.
- `computePremise(command, deps)` — inside its existing `try`, `const cwd = deps.checkoutRoot(); if (!cwd) return null; exit = deps.runPremiseCheck(command, { cwd });` (the existing `catch` already returns `null`). `checkoutRoot` is resolved only when a trusted Premise-check line exists — once per run, since `computePremise` runs at most once.
- `realDeps`: add `checkoutRoot: resolveCheckoutRoot`; keep `runPremiseCheck: runPremiseCheckDefault`; make the "run from the checkout root" comments accurate.
- `module.exports`: add `runPremiseCheckDefault, resolveCheckoutRoot`.

- [ ] **Step 4: Update the journey's step-5 red flag** — `docs/journeys/harness-health-premise-check.md` line ~54: replace the sentences from "The opposite failure is quiet:" through "…not a broken self-check." with the new behavior: `materialize.js` runs the command from the building checkout's root, and an in-repo target's path is repo-relative, so a finding filed from a scheduled Routine's sandbox or another machine auto-closes wherever it is built; only an out-of-repo target (a `--memory-dir` memory file) keeps its absolute path and still reads "unresolved" off the filing machine (fail-safe); records filed before #2857 keep their absolute paths and behave the same way. No "known limitation … tracked in #2857" text remains.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/materialize-premise-check.test.js tests/bin-lib/health-core/premise-self-check.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Verify the journey text (AC7.1)**

Run: `grep -n "isn't absolute\|known limitation\|tracked in #2857" docs/journeys/harness-health-premise-check.md`
Expected: no output (exit 1).

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/materialize.js tests/materialize-premise-check.test.js docs/journeys/harness-health-premise-check.md
git commit -m "Run materialize Premise-check from the checkout root — refs #2857"
```

## Read-only scope (Check B keyword hits, deliberately unmodified)

- `plugin/bin/harness-health.js` — already passes `repoRoot: root` to `toIssuePayload`; no change (see Global Constraints).
- `plugin/bin/lib/health-core/premise-self-check.js` — `defaultRunner(command, { cwd, timeoutMs })` already honors `cwd`; consumed by Task 2, not modified.

## Final verification (controller, centrally)

Waived AC8.1: not a test step — the controller's central `npm test` run is its proof.

AC8.1: `npm test` passes — run in the foreground by the controller (Common Step 5, output redirected to a scratchpad `.txt` file), never self-reported by an implementer.
