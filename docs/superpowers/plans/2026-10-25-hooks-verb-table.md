# hooks.js Table-Driven Verb Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `plugin/bin/hooks.js`'s separately maintained `USAGE` map and 21-branch `if (cmd === '...')` chain with one `VERBS` table whose keys are the dispatch keys and whose entries carry each verb's usage line and handler.

**Architecture:** Each `if (cmd === 'x') { … }` body in `main()` moves verbatim (de-indented two spaces) into a top-level `async function run{X}(argv)` that returns the same exit code. A `VERBS` table at the spot `USAGE` occupies today maps each verb to `{ usage, run }`; `USAGE` is derived from it, `main()` dispatches through it, and the unrecognized/missing-verb error additionally prints a usage listing derived from it. The structural source-scan test is replaced by table-integrity and usage-output tests.

**Tech Stack:** Node 18+ (CommonJS), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T083822-record-4181/work/4181-spec.md`

## Global Constraints

- Node 18+ runtime; CI runs Node 20 — no API newer than Node 18 (`Object.hasOwn` is fine).
- No new dependencies.
- Release note: "No user-visible change." — every verb keeps its argv handling, stdout/stderr text and exit codes byte-for-byte (AC1.1); only the unknown-/missing-verb stderr gains the usage listing.
- Hand-written commit messages: `{Verb} {what} — {detail}`, ending `refs #4181` (never `closes`/`fixes`).
- Touch only what the task requires; move handler bodies verbatim — no reformatting or "improvement" of their code beyond the two-space de-indent.

## Review Focus

1. A prototype-chain name as the verb (`constructor`, `toString`, `__proto__`) must be treated as unrecognized (exit 1, "unrecognized hooks.js subcommand"), never dispatched or crash-swallowed to exit 0 — the table lookup must use own-property membership. Test: Task 1 Step 1 `prototype-chain names are unrecognized verbs`.
2. No subcommand at all (`node hooks.js` with no argv[2]) still exits 1 with "no hooks.js subcommand given", now followed by the usage listing. Test: Task 1 Step 1 `AC2.1`.
3. The harness EVENTS names (`session-start`, …) must still route to their modules and never print the usage listing. Covered by `tests/hooks-dispatcher.test.js`'s existing every-event-exits-0 invariant and `tests/hooks-help-guard.test.js`'s existing `--help on a non-USAGE-table command is not intercepted`.
4. `log-decision` keeps its specific bin/log-decision.js pointer message. Covered by `tests/hooks-dispatcher.test.js`'s existing `'log-decision' — the specific name-collision case` test.
5. Verbs with non-zero exit vocabularies (`resolve-run-dir` 1, `adopt-run-dir` 2/3, `record-worktree` 1, `resolve-console` 1) keep them through the handler's return value. Covered by their existing suites (`tests/hooks-resolve-run-dir-cli.test.js`, `tests/hooks-adopt-run-dir.test.js`, `tests/hooks-dispatcher.test.js`, `tests/hooks-resolve-console.test.js`).

---

### Task 1: VERBS table, derived USAGE, table dispatch, usage listing

**Files:**
- Modify: `plugin/bin/hooks.js`
- Modify: `tests/hooks-help-guard.test.js`
- Modify: `tests/pr-early-run-lifecycle.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (exported from `plugin/bin/hooks.js`): `VERBS` — `{ [verb: string]: { usage: string, run: (argv: string[]) => Promise<number> } }`, insertion order identical to today's `USAGE` key order; `USAGE` — `{ [verb]: usage }`, derived from `VERBS` (same keys, same order, same strings as today). `module.exports = { main, BACKGROUND_CHECKS, CLI_DEFERRED_CHECKS, USAGE, VERBS }`. Handler names are `run` + PascalCase of the verb: `runRecordWorktree`, `runResolveRunDir`, `runSweepShadow`, `runAdoptRunDir`, `runRecordPr`, `runManifestInit`, `runSpecStatus`, `runCloseRun`, `runDeleteLedger`, `runResolveLedger`, `runTeardownRun`, `runArchiveRun`, `runResolveConsole`, `runCheckResumeFreshness`, `runCheckStagedInventory`, `runCheckSessionResidue`, `runCheckPassReentry`, `runCheckSiblingSessions`, `runReconcile`, `runReconcileSummary`, `runReconcileBackground`.

- [ ] **Step 1: Write the failing tests in `tests/hooks-help-guard.test.js`**

Change `runHook` to also return `stderr` (`e.stderr || ''` on the error path; capture stderr on success by passing `stdio: ['pipe', 'pipe', 'pipe']`). Import `VERBS` beside `USAGE`. Delete the `#1143: every cmd === '...' dispatch branch in main() has a matching USAGE entry` test and the comment block above it (deliverable 3 — the table makes that drift impossible). Add:

```js
test('AC3.1: every VERBS entry carries its own usage line and a run handler, and USAGE is derived from it', () => {
  assert.ok(Object.keys(VERBS).length >= 21, 'expected at least the 21 documented verbs');
  for (const [verb, entry] of Object.entries(VERBS)) {
    assert.strictEqual(typeof entry.usage, 'string', `${verb} usage must be a string`);
    assert.ok(entry.usage === verb || entry.usage.startsWith(`${verb} `), `${verb}'s usage line must start with its own key`);
    assert.strictEqual(typeof entry.run, 'function', `${verb} must carry a run handler`);
  }
  assert.deepStrictEqual(USAGE, Object.fromEntries(Object.entries(VERBS).map(([v, e]) => [v, e.usage])));
});

test('AC3.1: every table key appears in the unknown-verb usage output', () => {
  const r = runHook(['no-such-verb'], { input: '{}' });
  assert.strictEqual(r.code, 1);
  for (const [verb, entry] of Object.entries(VERBS)) {
    assert.ok(r.stderr.includes(`\n  ${entry.usage}\n`), `usage output must list ${verb}: ${entry.usage}`);
  }
});

test('AC2.1: an unknown or missing verb prints the table-derived usage text after its error line', () => {
  for (const args of [['no-such-verb'], []]) {
    const r = runHook(args, { input: '{}' });
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /^claude-tweaks: (unrecognized hooks\.js subcommand 'no-such-verb'|no hooks\.js subcommand given)[^\n]*\nclaude-tweaks: hooks\.js usage:\n/);
  }
});

test('prototype-chain names are unrecognized verbs, never dispatched', () => {
  for (const args of [['constructor'], ['toString', '--help'], ['__proto__']]) {
    const r = runHook(args, { input: '{}' });
    assert.strictEqual(r.code, 1, `${args.join(' ')} must exit 1`);
    assert.match(r.stderr, /unrecognized hooks\.js subcommand/);
  }
});
```

In `tests/pr-early-run-lifecycle.test.js`'s `bin/hooks.js record-pr verb writes run-state.json.pr through writeRunState` test, replace `assert.match(HOOKS_JS, /if \(cmd === 'record-pr'\)/);` with:

```js
  assert.match(HOOKS_JS, /'record-pr': \{[^}\n]*\brun: runRecordPr\b/);
  assert.match(HOOKS_JS, /^async function runRecordPr\(argv\) \{/m);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/hooks-help-guard.test.js tests/pr-early-run-lifecycle.test.js`
Expected: FAIL — `VERBS` is undefined (`Object.keys(undefined)` throws), the usage listing is absent from stderr, `toString --help` exits 0, and the `runRecordPr` patterns do not match.

- [ ] **Step 3: Implement the table in `plugin/bin/hooks.js`**

1. Move each of the 21 `if (cmd === '{verb}') { … }` bodies out of `main()` into `async function run{Verb}(argv) { … }` (names per Interfaces), placed after `copyRunDirAuditFiles` and before `main()`, in the current branch order, bodies verbatim apart from the two-space de-indent. No body reads `cmd`; every body already ends in `return`.
2. Replace `const USAGE = { … }` with `const VERBS = { … }` at the same spot, same key order, one entry per line: `'record-pr': { usage: 'record-pr [--run <dir>] <number> <url>', run: runRecordPr },` (usage strings copied byte-for-byte from today's `USAGE`; function declarations are hoisted, so the table can precede them). Directly after it: `const USAGE = Object.fromEntries(Object.entries(VERBS).map(([verb, { usage }]) => [verb, usage]));`.
3. Add `function verbFor(cmd)` returning `Object.hasOwn(VERBS, cmd) ? VERBS[cmd] : null`, and `function usageText()` returning `'claude-tweaks: hooks.js usage:\n'` followed by one `  ${usage}\n` line per `VERBS` entry and a final `  <event>  (harness hook events, JSON on stdin: ${EVENTS.join(', ')})\n` line.
4. In `main()`: `const verb = verbFor(cmd);` the `--help` guard's `else if (USAGE[cmd] && …)` becomes `else if (verb && …)`, and its `if (KNOWN_FLAGS[cmd])` becomes `if (verb && Object.hasOwn(KNOWN_FLAGS, cmd))` (probed at base 853e54f: `hooks.js constructor` and `hooks.js toString --help` both exit 0 silently today — `KNOWN_FLAGS['constructor']` is the inherited `Object` function, `new Set(Object)` throws, and `main()`'s catch swallows it to exit 0; the own-property guard is what makes Review Focus 1 hold); after the guard, `if (verb) return verb.run(argv);` replaces the 21 branches.
5. In the `!EVENTS.includes(cmd)` fallthrough: write `usageText()` to stderr immediately after the existing "no hooks.js subcommand given …" and "unrecognized hooks.js subcommand …" lines (both keep their exit 1 and existing text). The `log-decision` special case is unchanged except it may now use normal operand order `cmd === 'log-decision'`; drop its comment's sentences about the removed source scan.
6. Rewrite the `#1143` comment block above the table so it describes the table (keys = dispatch keys; entries feed the `--help` guard, `USAGE`, dispatch, and the usage listing) without enumerating verbs — the table is the list. Update the `module.exports` comment to name `VERBS`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-help-guard.test.js tests/pr-early-run-lifecycle.test.js tests/hooks-dispatcher.test.js`
Expected: PASS (all tests, 0 failures)

Then the verb suites that pin argv handling and exit codes (AC1.1):
Run: `node --test tests/hooks-*.test.js tests/archive-run-verb.test.js tests/delete-ledger-verb.test.js tests/resolve-ledger-verb.test.js tests/reconcile.test.js tests/bin-lib/hooks/ tests/bin-lib/exit-code-conformance.test.js tests/payload-boundary.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/hooks.js tests/hooks-help-guard.test.js tests/pr-early-run-lifecycle.test.js
git commit -m "Drive hooks.js verb dispatch from one VERBS table — USAGE, --help guard and usage listing derive from it (refs #4181)"
```

### Task 2: Maintainer-skill prose follows the table

**Files:**
- Modify: `.claude/skills/hooks-js-verb-registration/SKILL.md`
- Modify: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`

**Interfaces:**
- Consumes: Task 1's `VERBS` entry shape `'{verb}': { usage: '{verb} …', run: run{Verb} }` and handler signature `async function run{Verb}(argv)` returning the exit code.
- Produces: nothing code-facing.

- [ ] **Step 1: Update `hooks-js-verb-registration/SKILL.md`'s registration table**

Row 1 becomes the `VERBS` table entry (`'{verb}': { usage: '{verb} --run <dir> [...]', run: run{Verb} }`), stating that `USAGE`, the `--help`/`-h` intercept, dispatch and the unknown-verb usage listing all read it, so one entry is the whole registration in `hooks.js` apart from row 2. Row 3 becomes the handler `async function run{Verb}(argv)` that returns the verb's exit code (still resolving `--run` through `resolveRunArg`). Row 8 drops the `USAGE`-comment verb list (the comment no longer enumerates verbs) and keeps only the `KNOWN_FLAGS` comment duty. Update the description's keyword list to add `VERBS`.

- [ ] **Step 2: Update `cli-wrapper-contract.md`'s multi-verb dispatcher bullet**

Replace its final "Regression risk … not just the reverse" sentence with: since #4181 the guard and the dispatch read the same `VERBS` table, so a verb cannot be dispatched without a usage line; `tests/hooks-help-guard.test.js` asserts every table entry carries a usage line starting with its key and a handler, and that the unknown-verb usage output lists every key. Change "every subcommand its `USAGE` table names" to name the `VERBS` table.

- [ ] **Step 3: Verify no stale references remain**

Run: `git grep -n -e "cmd === '" -- .claude/skills/hooks-js-verb-registration .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`
Expected: only the `code-health.js` `churn-report` example line in `cli-wrapper-contract.md` (a different CLI) — no hooks.js reference.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/hooks-js-verb-registration/SKILL.md .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md
git commit -m "Point hooks.js verb-registration prose at the VERBS table (refs #4181)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (one verb table, usage + handler per entry) | Task 1 Step 3.1–3.2, 3.4 |
| Deliverable 2 (USAGE derived from the table) | Task 1 Step 3.2 |
| Deliverable 3 (drop/simplify the structural test) | Task 1 Step 1 (deleted, replaced by AC3.1 table-integrity test) |
| AC1.1 (verbs dispatch with unchanged argv handling; existing hooks suites pass) | Task 1 Step 4 suite runs |
| AC2.1 (unknown verb prints table-derived usage) | Task 1 Step 1 `AC2.1` test |
| AC3.1 (one table entry; test asserts every key in usage output) | Task 1 Step 1 both `AC3.1` tests |
