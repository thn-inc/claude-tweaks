# Reconcile Budget Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a caller that names an explicit `--checks` subset run those checks without the 18 s hot-path budget skipping them, and scope dispatch's drain-termination reconcile to `release,archive,reap`.

**Architecture:** `reconcile()` gains an optional `opts.budgetMs` passed straight to `createBudget(opts.budgetMs)` (an `undefined` argument already falls back to `DEFAULT_BUDGET_MS = 18000`; `Infinity` never expires). The `hooks.js reconcile` CLI passes `Infinity` when `--checks` is non-empty and `undefined` otherwise. The SessionStart and background-pass call sites are untouched. Dispatch's second (termination) reconcile becomes `reconcile --checks release,archive,reap` with Step 1's 150000ms+ timeout.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T183605-record-3026/work/3026-spec.md` (record #3026)

## Global Constraints

- `DEFAULT_BUDGET_MS` stays `18000`; `plugin/bin/lib/reconcile/budget.js` is not modified.
- Do not reorder checks in `reconcile()`; `reap` stays dispatched last.
- SessionStart (`plugin/bin/lib/hooks/session-start.js`) and the background pass (`plugin/bin/hooks.js` `reconcile-background`, `reconcile({ cwd, checks: BACKGROUND_CHECKS, sessionId })`) call sites are unchanged.
- Dispatch Step 1's own reconcile call (`plugin/skills/dispatch/SKILL.md`, `reconcile --json`, ~line 106) is unchanged and stays unscoped.
- Anchor edits on content, not line numbers (the record's line numbers have drifted: the CLI's `checks:` forwarding line is now ~`hooks.js:1434`, `createBudget()` is ~`index.js:265`).
- Commit messages reference the record as `refs #3026`, never `closes`/`fixes`.

## Review Focus

- `--checks` given but empty/whitespace (`--checks ""`, `--checks " , "`) → `checksList` is empty → `budgetMs: undefined` (default ceiling), not `Infinity`. Covered by the existing `checksList.length ?` shape reused for both fields; Task 1's CLI test asserts the unscoped case.
- A `--checks` subset that names `reap` alone or with others must not be budget-skipped — Task 1's `opts.budgetMs` test (stubbed `createBudget` that is exhausted unless `ms === Infinity`).
- `reconcile({})` with no `budgetMs` must still create the default budget (`createBudget` receives `undefined`) — Task 1 test AC2.1.
- Other scripted `reconcile --checks …` callers now run unbounded: the only one (`_shared/pr-first-merge-post-merge.md` Step 4.2) already mandates a 150000ms+ timeout — verified at authoring time, no change needed.
- The dispatch pin test's "exactly two `hooks.js" reconcile` call sites in Steps 1-3" count must still hold after the edit — the new `hooks.js" reconcile --checks` text still matches `/hooks\.js" reconcile/g` once (Task 2).

---

### Task 1: `opts.budgetMs` in `reconcile()` and the CLI forwarding

**Files:**
- Modify: `plugin/bin/lib/reconcile/index.js` (the `// opts:` doc comment near the top, ~line 41; the `createBudget()` call, ~line 265, and its preceding comment)
- Modify: `plugin/bin/hooks.js` (the `cmd === 'reconcile'` branch's `opts` object, ~line 1430)
- Test: `tests/reconcile.test.js` (add after the existing `'reconcile(): an exhausted wall-clock budget skips every remaining check in one entry (D4)'` test)

**Interfaces:**
- Produces: `reconcile(opts: { dryRun?, checks?, cwd?, sessionId?, budgetMs?: number })` — `budgetMs` forwarded verbatim as `createBudget(opts.budgetMs)`.
- Produces: `hooks.js reconcile` CLI opts gain `budgetMs: checksList.length ? Infinity : undefined`.

- [ ] **Step 1: Write the failing tests** in `tests/reconcile.test.js`, using the same preflight-stub / `budgetMod.createBudget` monkeypatch pattern (and `pairedFixture()` + `policy.yml` `integration-model: pr-first` forcing) as the existing D4 exhausted-budget test:

  1. `test('AC1.1: reconcile(): opts.budgetMs reaches createBudget, so an unbounded explicit subset is never budget-skipped', …)` — stub `createBudget = (ms) => { seen.push(ms); return { exceeded: () => ms !== Infinity, remainingMs: () => 0 }; }`; call `reconcile({ cwd: mainDir, checks: ['mirror', 'red-tip'], budgetMs: Infinity })`; assert `seen` deep-equals `[Infinity]` and no `r.skipped` entry has `reason === 'budget-exceeded'`.
  2. `test('AC2.1: reconcile(): no opts.budgetMs passes undefined to createBudget, so the 18 s default applies', …)` — same stub; call `reconcile({ cwd: mainDir, checks: ['mirror', 'red-tip'] })`; assert `seen` deep-equals `[undefined]`, and `r.skipped` deep-equals `[{ check: 'mirror,red-tip', reason: 'budget-exceeded' }]`; also assert `require('../plugin/bin/lib/reconcile/budget').DEFAULT_BUDGET_MS === 18000`. (The existing D4 test stays byte-unchanged.)
  3. `test('AC3.1/AC3.2: hooks.js reconcile: an explicit --checks subset runs unbounded; an unscoped pass keeps the default budget', …)` — replace `require('../plugin/bin/lib/reconcile').reconcile` with a recorder `async (opts) => { calls.push(opts); return { skipped: [] }; }`, silence `process.stdout.write`, then `await main(['node', 'hooks.js', 'reconcile', '--checks', 'reap', '--json'])` and `await main(['node', 'hooks.js', 'reconcile', '--json'])` (`main` from `require('../plugin/bin/hooks')`); restore both in `finally`. Assert `calls[0].budgetMs === Infinity`, `calls[0].checks` deep-equals `['reap']`, `calls[1].budgetMs === undefined`, `calls[1].checks === undefined`.
  4. `test('AC4.1: SessionStart and background reconcile call sites pass no budgetMs (default budget)', …)` — source scan: `plugin/bin/lib/hooks/session-start.js` does not contain `budgetMs`; in `plugin/bin/hooks.js`, `budgetMs` occurs exactly once (the `reconcile` CLI branch) and the line containing `checks: BACKGROUND_CHECKS` does not contain `budgetMs`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/reconcile.test.js`
Expected: FAIL — test 1 (`seen` is `[undefined]`, not `[Infinity]`), test 3 (`calls[0].budgetMs` is `undefined`), test 4 (`budgetMs` occurs 0 times in hooks.js). Test 2 is a characterization of the unchanged default path and already passes — expected.

- [ ] **Step 3: Implement**

  - `plugin/bin/lib/reconcile/index.js`: change `require('./budget').createBudget()` to `require('./budget').createBudget(opts.budgetMs)`; extend the preceding comment with one sentence: `opts.budgetMs` overrides the default ceiling — the `reconcile` CLI passes `Infinity` for an explicit `--checks` subset, since `reap` runs last by design and the 18 s hot-path ceiling would otherwise starve exactly the check the caller named (#3026). Update the `// opts:` doc comment to `{ dryRun?: boolean, checks?: string[], cwd?: string, sessionId?: string, budgetMs?: number }`.
  - `plugin/bin/hooks.js`: in the `cmd === 'reconcile'` branch's `opts` object, add after `checks: …`: `budgetMs: checksList.length ? Infinity : undefined,` with a short comment: an explicit `--checks` subset is the caller naming exactly which checks must run — don't let the SessionStart hot-path budget (#820 D4) skip them; an unscoped pass keeps the default ceiling (#3026).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/reconcile.test.js tests/bin-lib/reconcile/budget.test.js`
Expected: PASS (0 failures)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/index.js plugin/bin/hooks.js tests/reconcile.test.js
git commit -m "Thread opts.budgetMs through reconcile — explicit --checks subsets run unbounded (refs #3026)"
```

### Task 2: Scope dispatch's drain-termination reconcile

**Files:**
- Modify: `plugin/skills/dispatch/SKILL.md` (the "At loop termination" block's "**Either way**" bullet, ~line 180)
- Test: `tests/dispatch-drain-close-run-reconcile.test.js` (the `'#2430: drain termination re-runs reconcile a second time …'` test)

**Interfaces:**
- Consumes: Task 1's CLI behavior (an explicit `--checks` subset runs with `budgetMs: Infinity`) — cited in prose only.

- [ ] **Step 1: Update the pin test** in `tests/dispatch-drain-close-run-reconcile.test.js`. In the `#2430: drain termination …` test, replace the `reconcile\` a second time` regex with `/run \`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" reconcile --checks release,archive,reap\` a second time/` (AC5.1), and add assertions on the same `section`: `assert.match(section, /same generous timeout as Step 1/)` (AC5.1). Add, on the Step 1 slice (`t.slice(t.indexOf('### Step 1: Resolve'), t.indexOf('### Step 2:'))`): `assert.match(step1, /hooks\.js" reconcile --json`/)` and `assert.doesNotMatch(step1, /reconcile --checks/)` (AC5.2). Keep the existing "exactly two reconcile call sites in Steps 1-3" count assertion unchanged. Rename the test to begin `'#2430/AC5.1/AC5.2: …'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-drain-close-run-reconcile.test.js`
Expected: FAIL — the `--checks release,archive,reap` regex does not match the current unscoped bullet.

- [ ] **Step 3: Edit `plugin/skills/dispatch/SKILL.md`** — in the "**Either way**" bullet, change `` `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile` `` to `` `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --checks release,archive,reap` ``; in the parenthetical after "a second time", add that it is scoped to the three checks this step exists for, in their load-bearing release → archive → reap order, and that an explicit `--checks` subset is never cut short by the hot-path wall-clock budget, whereas an unscoped pass on a large repo spends that budget on the shared `--prune` fetch, `archive-branches` and `remote-prune` and reports `reap` as `budget-exceeded` (#3026); before "Log the result", add the sentence `Use the same generous timeout as Step 1's call (150000ms+).` Keep "reaped now rather than left for a future session's SessionStart hook to discover" verbatim. Do not touch Step 1's call.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/dispatch-drain-close-run-reconcile.test.js tests/reconcile.test.js tests/bin-lib/reconcile/budget.test.js`
Expected: PASS (0 failures) — this is AC6.1's exact command.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/SKILL.md tests/dispatch-drain-close-run-reconcile.test.js
git commit -m "Scope dispatch drain-termination reconcile to release,archive,reap (refs #3026)"
```

## Authoring-time checks

- **Byte-pin:** `plugin/skills/dispatch/SKILL.md` is 46,852 bytes at the merge base (within 10% of the 51,200-byte ceiling); Task 2 adds ≤ ~450 bytes, leaving ≥ ~3.9 KB headroom — no split needed. Keep the added prose to the sentences named in Task 2 Step 3; re-measure `wc -c` after the edit and report it.
- **Other `reconcile --checks` callers:** only `plugin/skills/_shared/pr-first-merge-post-merge.md` Step 4.2 (`--checks mirror,release,archive`), which already mandates a 150000ms+ timeout — no edit.
- **No live timing run** (record Gotcha): a live reconcile mutates refs and the claims registry; verification is the unit tests only.
