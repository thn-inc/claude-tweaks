# hooks.js check-pass-reentry verb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `hooks.js check-pass-reentry --run <dir> [--online]`, which prints `checkPassReentry`'s verdict JSON, and point the review-console re-entry step at it so that step needs no `node -e` snippet.

**Architecture:** One new dispatcher branch in `plugin/bin/hooks.js`. It reuses the shared `resolveRunArg` anchoring every other `--run` verb uses and lazy-requires `plugin/bin/lib/flow/consolidated-pass.js`. Its stdout carries only the verdict JSON. Refusals go to stderr with exit 1. Skill prose and docs then point at the verb.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T212024-record-3553/work/3553-spec.md`

Scope keywords: check-pass-reentry, checkPassReentry

## Global Constraints

- Verb shape is exactly `check-pass-reentry --run <dir> [--online]`. `sessionId` comes from `process.env.CLAUDE_CODE_SESSION_ID`.
- The verb runs the same `--run` anchoring as the other `--run` verbs (`resolveRunArg`). An unanchored run dir exits non-zero.
- Commit messages: `{Verb} {what} — {detail}`, ending with `refs #3553` (never `closes`/`fixes`), plus the trailer line `Claude-Session: https://claude.ai/code/session_018qcLonVVg4vCyCHMdvyGqP`.
- `plugin/skills/flow/multispec-review-console.md` is at 48887 bytes against the 52500-byte `RAIL_BYTES` rail (93%). The Task 2 edit must not grow the file. Measure it with `wc -c` before and after; the replacement is shorter than the snippet it removes.

## Review Focus

1. **Stdout pollution.** The skill treats any non-JSON output as a stop, so the verb's stdout must be exactly one JSON line. A worktree-local-fallback disclosure, or any rejection text, must go to stderr. Pinned by Task 1's tests, which `JSON.parse` the whole trimmed stdout.
2. **`--run` omitted.** Other verbs fall back to guessing a run dir. This verb must refuse with exit 1 instead (`requires --run`) and print nothing on stdout. Pinned in Task 1.
3. **Misspelled `--online`** (e.g. `--onlin`). The verb is in `KNOWN_FLAGS`, so the unknown-flag guard prints the usage line. That is non-JSON output, which the skill already treats as a stop, so the run never proceeds silently offline. Pinned in Task 1.
4. **`--online` actually threaded.** Without `gh`, `--online` must surface `online PR check unavailable (gh-absent)` in `detail`, and the same run without `--online` must not. Probed 2026-10-21 on `tests/helpers/reentry-fixture.js` with a git-only PATH: online gives `detail: "online PR check unavailable (gh-absent)"`, offline gives `detail: ""`. Pinned in Task 1.
5. **Truncated JSON on exit.** `main()`'s caller does `process.exit(code)`, and macOS pipes write asynchronously. Write the JSON through `process.stdout.write(text, cb)` awaited before returning.

---

### Task 1: The `check-pass-reentry` verb + docs listing

**Files:**
- Modify: `plugin/bin/hooks.js` — the `USAGE` table (~line 105), its header comment's verb list (~line 93-97), `KNOWN_FLAGS` (~line 138), a new `if (cmd === 'check-pass-reentry')` branch placed directly after the `check-session-residue` branch (~line 1410)
- Create: `tests/hooks-check-pass-reentry.test.js`
- Modify: `tests/hooks-help-guard.test.js:84` — add `'check-pass-reentry'` to the `runAccepting` array
- Modify: `docs/hooks.md:19` — the anchored-`--run` bullet
- Modify: `docs/plugin-structure.md:17` — the `plugin/bin/hooks.js` line

**Interfaces:**
- Consumes: `checkPassReentry(runDir, { online, sessionId })` from `plugin/bin/lib/flow/consolidated-pass.js`. It returns `{ eligible: boolean, reason: string, specIds: number[], detail: string }`. Also consumes `resolveRunArg(args, cwd, env)` → `{ runDir, invalidRunArg, worktreeLocalFallback, explicit }`, already in `hooks.js`.
- Produces: CLI `node plugin/bin/hooks.js check-pass-reentry --run <dir> [--online]`. Exit 0 prints the verdict as one line, `JSON.stringify(verdict) + '\n'`, and nothing else on stdout. Exit 1 prints a stderr message and nothing on stdout. Task 2's prose relies on this contract.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-check-pass-reentry.test.js`

Use `reentryFixture()` from `tests/helpers/reentry-fixture.js` (an eligible run: `trunk` integration branch, unmerged `feat-branch` worktree, complete 11/12 manifest, `mode: auto`). Spawn with `execFileSync(process.execPath, [HOOKS, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', CLAUDE_CODE_SESSION_ID: 'cpr-test', ...env } })`. Capture `{code, stdout, stderr}` the way `tests/hooks-dispatcher.test.js`'s `runHook` does. Tests:

```js
test('AC1.1: eligible fixture -> stdout is checkPassReentry\'s verdict JSON, exit 0', () => {
  const { root, runDir } = reentryFixture();
  const expected = checkPassReentry(runDir, { sessionId: 'cpr-test' });
  assert.equal(expected.reason, 'eligible'); // fixture really is eligible
  const r = runCli(['check-pass-reentry', '--run', runDir], { cwd: root });
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout.trim()), expected);
});

test('AC1.1: ineligible fixture (console.json present) -> same verdict JSON as checkPassReentry', () => {
  // reentryFixture(), then fs.writeFileSync(path.join(runDir, 'console.json'), '{}')
  // expected.reason === 'console-exists'; CLI exit 0; JSON.parse(stdout.trim()) deepEqual expected
});

test('AC1.2: an unanchored --run exits non-zero with no JSON on stdout', () => {
  // runDir2 = <fresh non-git mkdtemp>/.claude-tweaks/pipelines/2026-08-01T090000-spec-11-12, with run-state.json + config.yml
  // run from cwd: root (the fixture repo)
  // assert.notEqual(r.code, 0); assert.equal(r.stdout, ''); assert.match(r.stderr, /--run path rejected/);
});

test('#3553: omitting --run exits non-zero, never guessing a run dir', () => {
  // runCli(['check-pass-reentry'], { cwd: root }) -> code !== 0, stdout '', stderr /requires --run/
});

test('#3553: --online is threaded through (gh absent -> degrade named in detail; absent without --online)', () => {
  // reentryFixture(); add pr: { number: 7, url: 'https://example.test/pr/7', branch: 'feat-branch' } to run-state.json
  // env PATH = a mkdtemp dir holding only a symlink to git (resolve git's path with `which git` once, in-process; skip the test when it cannot be resolved)
  // online = runCli([..., '--online'], { cwd: root, env: { PATH } }); offline = runCli([...], same)
  // assert.match(JSON.parse(online.stdout.trim()).detail, /online PR check unavailable \(gh-absent\)/);
  // assert.doesNotMatch(JSON.parse(offline.stdout.trim()).detail, /online PR check unavailable/);
});

test('#3553: an unknown flag prints the usage line, never verdict JSON', () => {
  // runCli(['check-pass-reentry', '--run', runDir, '--onlin'], { cwd: root })
  // stdout === `claude-tweaks: usage: ${USAGE['check-pass-reentry']}\n` (USAGE from require('../plugin/bin/hooks.js'))
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/hooks-check-pass-reentry.test.js`
Expected: FAIL. The verb is unrecognized, so stderr reads `unrecognized hooks.js subcommand 'check-pass-reentry'`, and `USAGE['check-pass-reentry']` is undefined.

- [ ] **Step 3: Implement the verb in `plugin/bin/hooks.js`**

- `USAGE['check-pass-reentry'] = 'check-pass-reentry --run <dir> [--online]'`, placed after `check-session-residue`. Add `check-pass-reentry` to the header comment's verb list above `USAGE`.
- `KNOWN_FLAGS['check-pass-reentry'] = ['--run', '--online']`. `--online` is boolean and is NOT added to `VALUE_FLAGS`.
- Add a branch after `check-session-residue`, in this order:
  1. `resolveRunArg(argv.slice(3), process.cwd(), process.env)`.
  2. `!explicit`: write `claude-tweaks: check-pass-reentry requires --run — pass re-entry not checked\n` to stderr and return 1.
  3. `invalidRunArg`: write `claude-tweaks: --run path rejected: ${invalidRunArg} — pass re-entry not checked\n` to stderr and return 1.
  4. `worktreeLocalFallback`: write the same disclosure text `reportWorktreeLocalFallback` prints, but to **stderr**. Do not call that helper, because it writes stdout.
  5. Lazy-require: `require('./lib/flow/consolidated-pass').checkPassReentry(runDir, { online: argv.slice(3).includes('--online'), sessionId: process.env.CLAUDE_CODE_SESSION_ID })`. Wrap it in try/catch. On a throw, write `claude-tweaks: check-pass-reentry failed — ${e.message}\n` to stderr and return 1.
  6. `await new Promise((resolve) => process.stdout.write(`${JSON.stringify(verdict)}\n`, resolve)); return 0;`

  Add a short comment explaining why this verb exits 1 on refusal while its sibling `check-*` verbs exit 0: its caller (`flow/multispec-review-console.md`'s re-entry step 2) treats a non-zero exit or non-JSON output as a stop.

- [ ] **Step 4: Update the docs listings**

- `docs/hooks.md:19`: "The twelve subcommands that accept it" becomes "The thirteen subcommands that accept it". Add `check-pass-reentry` to the list after `check-session-residue`. In the exit-code sentence, add a third exception after `resolve-console`: `` and `check-pass-reentry`, which exits 1 (and prints nothing on stdout) so its skill caller reads a refusal as a stop rather than a verdict (#3553) ``.
- `docs/plugin-structure.md:17`: add `check-pass-reentry` to the subcommand list after `check-session-residue`. Make "the twelve that accept --run (…)" read "the thirteen …" with `check-pass-reentry` added to the parenthesized list. Change "a thirteenth, narrower case" to "a fourteenth, narrower case" and "is a fourteenth:" to "is a fifteenth:". Also change "where the other twelve's --run never is" to "the other thirteen's". Add one clause: `check-pass-reentry --run <dir> [--online] (#3553) prints consolidated-pass.js's checkPassReentry verdict JSON for flow/multispec-review-console.md's re-entry step`.
- `tests/hooks-help-guard.test.js:84`: append `'check-pass-reentry'` to `runAccepting`.

Renumbering-completeness verification. Run all three. Each must show the new count and no stale one:
- `git grep -n -i "twelve" -- docs/hooks.md docs/plugin-structure.md` (cardinal word): expect no hit about the `--run` verbs.
- `git grep -n -E "thirteenth|fourteenth|fifteenth" -- docs/plugin-structure.md` (ordinals): expect `fourteenth` on sweep-shadow and `fifteenth` on adopt-run-dir.
- `git grep -n "check-session-residue, check-pass-reentry\|check-session-residue/check-pass-reentry" -- docs` (membership lists): expect a hit in both `docs/hooks.md` and `docs/plugin-structure.md`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/hooks-check-pass-reentry.test.js tests/hooks-help-guard.test.js tests/hooks-dispatcher.test.js`
Expected: PASS, 0 failures.

Go-red: temporarily make the branch ignore `--online` (pass `online: false`). The `--online` test must fail. Revert.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/hooks.js tests/hooks-check-pass-reentry.test.js tests/hooks-help-guard.test.js docs/hooks.md docs/plugin-structure.md
git commit -m "Add hooks.js check-pass-reentry verb — prints checkPassReentry's verdict JSON under the shared --run anchoring, refs #3553"
```

### Task 2: Point the re-entry step at the verb

**Files:**
- Modify: `plugin/skills/flow/multispec-review-console.md:55` — re-entry step 2
- Modify: `tests/flow-pass-reentry-conformance.test.js:66-99` — the AC1.2 token list, plus a new verb-pin test and its go-red control
- Modify: `docs/journeys/finish-a-multispec-run-after-the-parent-session-ended.md:37` — step 3's URL line
- Modify: `docs/plugin-structure.md:49` — consolidated-pass.js's "Consumed by" clause

**Interfaces:**
- Consumes: Task 1's CLI contract (verdict JSON on stdout, exit 0; exit 1 with nothing on stdout on refusal).

- [ ] **Step 1: Write the failing test** in `tests/flow-pass-reentry-conformance.test.js`

Factor a helper and use it in both a positive test and a control:

```js
const VERB_CALL = 'hooks.js" check-pass-reentry --run "{parent-run-dir}" --online';
function assertReentryVerb(section) {
  const c = collapse(section);
  assert.ok(c.includes(VERB_CALL), 're-entry section must invoke the check-pass-reentry verb');
  assert.ok(!c.includes('node -e'), 're-entry section must not carry a node -e snippet');
}
test('AC2.1: re-entry step 2 calls the check-pass-reentry verb and carries no node -e', () => {
  assertReentryVerb(reentrySection(CONSOLE));
});
test('AC2.2 #3553 negative control: a node -e snippet in the re-entry section fails the verb pin', () => {
  const doctored = reentrySection(CONSOLE) + '\n`node -e "require(1)"`\n';
  assert.throws(() => assertReentryVerb(doctored));
});
```

In the existing AC1.2 token list: replace `'online: true'` with `'--online'`, and replace `'checkPassReentry(process.argv[1]'` with `VERB_CALL`. Keep `'checkPassReentry'` and `'consolidated-pass.js'`. The new prose still names both, after step 1, so the Halt-before-eligibility ordering assertion keeps holding.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-pass-reentry-conformance.test.js`
Expected: FAIL on `AC2.1` (`must invoke the check-pass-reentry verb`) and on the AC1.2 token `hooks.js" check-pass-reentry …`.

- [ ] **Step 3: Rewrite re-entry step 2** in `plugin/skills/flow/multispec-review-console.md` to exactly:

```markdown
2. **Check eligibility.** SessionStart's banner suffix is offline evidence only; this check is the authoritative gate: `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" check-pass-reentry --run "{parent-run-dir}" --online` prints `checkPassReentry`'s verdict JSON (`bin/lib/flow/consolidated-pass.js`, with this session's `CLAUDE_CODE_SESSION_ID` as `sessionId`). A non-zero exit, or output that is not that JSON, is a stop: report it and never proceed.
```

Then update the two docs lines:
- Journey line 37 becomes: `- **URL:** the `hooks.js check-pass-reentry --run "{parent-run-dir}" --online` call in that same section, which prints `checkPassReentry`'s verdict JSON and refuses an unanchored run directory with a non-zero exit; a non-zero exit or non-JSON output is a stop; `plugin/bin/lib/flow/consolidated-pass.js`, whose offline merge evidence comes from `plugin/bin/lib/hooks/run-integrity.js`'s `checkBranchLanded``.
- `docs/plugin-structure.md:49`: "Consumed by `flow/multispec-review-console.md`'s re-entry section" becomes "Consumed by `hooks.js check-pass-reentry` (#3553), which `flow/multispec-review-console.md`'s re-entry section calls,".

Byte check: run `wc -c plugin/skills/flow/multispec-review-console.md`. It must be ≤ 48887 bytes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/flow-pass-reentry-conformance.test.js tests/hooks-check-pass-reentry.test.js`
Expected: PASS, 0 failures.

Then run every suite that reads this skill file: `git grep -l "multispec-review-console" -- tests`. Pass each to `node --test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/multispec-review-console.md tests/flow-pass-reentry-conformance.test.js docs/journeys/finish-a-multispec-run-after-the-parent-session-ended.md docs/plugin-structure.md
git commit -m "Point the review-console re-entry check at hooks.js check-pass-reentry — drops the node -e snippet, refs #3553"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (verb, sessionId, anchoring, non-zero on unanchored) | Task 1 |
| Deliverable 2 (re-entry step 2 calls the verb; docs/hooks.md names it) | Task 2 (skill), Task 1 (docs/hooks.md) |
| AC1.1 same verdict JSON, eligible + ineligible | Task 1 tests `AC1.1` ×2 |
| AC1.2 unanchored `--run` exits non-zero | Task 1 test `AC1.2` |
| AC2.1 conformance test pins the verb invocation | Task 2 test `AC2.1` |
| AC2.2 no `node -e` remains in the section | Task 2 tests `AC2.1` + `AC2.2` control |
