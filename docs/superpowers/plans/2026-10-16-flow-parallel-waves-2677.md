# Flow Multi-Spec Parallel Waves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in `parallel` mode for `/claude-tweaks:flow` multi-spec runs that builds and tests mutually independent records concurrently, while dependency order, the single PR, and the single consolidated Review Console are preserved, and the default behavior is unchanged.

**Architecture:** A pure wave planner, `plugin/bin/lib/preflight-records/waves.js`, turns the run's in-run `blocked-by` DAG into ordered waves:
- Longest-path levels, each split so that no two file-overlapping records share a wave (`groupByFileOverlap` with hub paths not exempt).
- A record with no `### Key Files` gets a wave of its own.

`bin/preflight-records.js --waves` exposes the planner, and the envelope is unchanged without the flag. The new decision/procedure sub-file `plugin/skills/flow/multispec-parallel-waves.md` defines the execution model:
- A wave of one runs exactly as today.
- A larger wave builds and tests each member in its own per-spec worktree, branched from the shared branch tip, then merges back sequentially into the shared branch.
- Review, polish and wrap-up then run one record at a time in the shared worktree, as today.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T172750-spec-2775-2733-2677/spec-2677/work/2677-spec.md` (record #2677)

## Global Constraints

- Opt-in only: without the `parallel` token, `/claude-tweaks:flow` behavior is byte-for-byte unchanged (spec AC 4). Without `--waves`, the `preflight-records.js` envelope stays `{records, overlapGroups, workLinks}` (plus `mergeGate` only under `--merge-gate`).
- A strict linear chain produces only singleton waves, and a singleton wave runs exactly as today's sequential path, with no extra worktree (spec AC 3).
- The decision is recorded with its rationale in `multispec-parallel-waves.md` (spec AC 1). The merge-back step is implemented and documented, and `multispec-review-console.md` describes how per-spec results reconcile into its single-PR model (spec AC 6, model (a)-family).
- `groupByFileOverlap` (`plugin/bin/lib/issues/grouping.js`) is reused, never rebuilt; the planner passes `{ hubPathMinCount: Infinity }` so a widely shared file still separates two records.
- `plugin/skills/flow/multi-spec.md` stays ≤ 20480 bytes (`tests/run-dir-timestamp-utc.test.js` #724 pin; 19213 at base). `plugin/skills/flow/SKILL.md` stays ≤ 46080 bytes (43469 at base). `plugin/skills/flow/multispec-review-console.md` is 40199 bytes, so add one short paragraph only.
- A new flow sub-file must be listed in `docs/plugin-structure.md`'s `flow` row (`tests/flow-subfile-table-completeness.test.js`).
- Commit messages: `{Verb} {what} — {detail}`, body `refs #2677`, ending `Claude-Session: https://claude.ai/code/session_01VBD5AMkgdrgmr515Fn6fVb`. Never put close/fix/resolve directly before `#N` anywhere in the message.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

Waived AC5.1: concurrency model (b) was not chosen. The decision rejects it, in `multispec-parallel-waves.md`'s Decision section, because one shared index and working tree cannot isolate concurrent commits or test runs. So the "upgrade groupByFileOverlap to a blocking gate" clause does not apply; overlap still separates records into different waves (Task 1).

## Review Focus

1. A dependent listed before its blocker in `numbers` still lands in a later wave than the blocker. Levels come from edges, not input order.
2. Three or more records sharing one hub file (for example `docs/plugin-structure.md`) never share a wave. With default options that file would be exempt from bridging.
3. A record with an empty `keyFiles` never shares a wave, because its files are unknown and its independence can't be proven.
4. A `blockedBy` edge to a record outside the run is ignored for levels, so it doesn't push the record into a later wave.
5. A dependency cycle (which Validation should already have hard-failed) throws rather than recursing forever, and the CLI turns that into exit 2.

---

### Task 1: Wave planner module

**Files:**
- Create: `plugin/bin/lib/preflight-records/waves.js`
- Test: `tests/bin-lib/preflight-records/waves.test.js`

**Interfaces:**
- Consumes: `groupByFileOverlap(items: Array<{id:number, keyFiles:string[]}>, options?) -> number[][]` from `plugin/bin/lib/issues/grouping.js`. It returns connected components in item insertion order, singletons included.
- Produces: `planParallelWaves({ records, numbers }) -> { waves: number[][], parallel: boolean }`. `records` is `buildRecords` output keyed by string number, with `blockedBy: number[]` and `keyFiles: string[]`. `numbers` holds the run's targets in run order. `waves` are ordered so that every in-run blocker sits in an earlier wave than its dependent, and members keep run order within a wave. `parallel` is true when any wave has more than one member. A dependency cycle throws `Error('dependency cycle through #N')`.

- [ ] **Step 1: Write the failing test** — create `tests/bin-lib/preflight-records/waves.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planParallelWaves } = require('../../../plugin/bin/lib/preflight-records/waves');

const rec = (blockedBy, keyFiles) => ({ blockedBy, keyFiles });

test('AC2.1: two mutually independent records with disjoint files share one wave', () => {
  const records = { 1: rec([], ['a.js']), 2: rec([], ['b.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2] }), { waves: [[1, 2]], parallel: true });
});

test('AC3.1: a strict linear chain yields only singleton waves, in dependency order', () => {
  const records = { 1: rec([], ['a.js']), 2: rec([1], ['b.js']), 3: rec([2], ['c.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2, 3] }), { waves: [[1], [2], [3]], parallel: false });
});

test('diamond: the two middle records run together, after their blocker and before their dependent', () => {
  const records = { 1: rec([], ['a.js']), 2: rec([1], ['b.js']), 3: rec([1], ['c.js']), 4: rec([2, 3], ['d.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2, 3, 4] }).waves, [[1], [2, 3], [4]]);
});

test('a dependent listed before its blocker still lands in a later wave', () => {
  const records = { 1: rec([], ['a.js']), 2: rec([1], ['b.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [2, 1] }).waves, [[1], [2]]);
});

test('file-overlapping records at the same level are split, still running beside an independent one', () => {
  const records = { 1: rec([], ['a.js']), 2: rec([], ['a.js', 'x.js']), 3: rec([], ['c.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2, 3] }).waves, [[1, 3], [2]]);
});

test('a hub file shared by three records still separates them (hub paths do not exempt concurrency)', () => {
  const hub = 'docs/plugin-structure.md';
  const records = { 1: rec([], [hub, 'a.js']), 2: rec([], [hub, 'b.js']), 3: rec([], [hub, 'c.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2, 3] }).waves, [[1], [2], [3]]);
});

test('a record with no Key Files gets a wave of its own', () => {
  const records = { 1: rec([], ['a.js']), 2: rec([], []), 3: rec([], ['c.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2, 3] }).waves, [[1, 3], [2]]);
});

test('a blocker outside the run does not delay a record', () => {
  const records = { 1: rec([99], ['a.js']), 2: rec([], ['b.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2] }).waves, [[1, 2]]);
});

test('a dependency cycle throws instead of recursing forever', () => {
  const records = { 1: rec([2], ['a.js']), 2: rec([1], ['b.js']) };
  assert.throws(() => planParallelWaves({ records, numbers: [1, 2] }), /dependency cycle through #/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/preflight-records/waves.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/preflight-records/waves'"

- [ ] **Step 3: Write minimal implementation** — create `plugin/bin/lib/preflight-records/waves.js`:

```js
// bin/lib/preflight-records/waves.js
// Parallel-wave planner for /flow's opt-in multi-spec `parallel` mode (#2677).
// Turns the run's in-run blocked-by DAG into ordered waves: longest-path
// levels, each split so two file-overlapping records never share a wave —
// groupByFileOverlap with hub paths NOT exempt, since a widely shared file is
// exactly what conflicts at merge-back. A record with no Key Files cannot be
// proven independent, so it gets a wave of its own. A wave of one runs exactly
// as a sequential run does. Execution model: skills/flow/multispec-parallel-waves.md.
'use strict';

const { groupByFileOverlap } = require('../issues/grouping');

// records: buildRecords output ({ "<n>": { blockedBy, keyFiles } }), numbers:
// the run's targets in run order -> { waves: number[][], parallel: boolean }.
function planParallelWaves({ records, numbers }) {
  const inRun = new Set(numbers);
  const rec = (n) => records[String(n)] || {};
  const blockersOf = (n) => (rec(n).blockedBy || []).filter((b) => inRun.has(b) && b !== n);
  const keyFilesOf = (n) => rec(n).keyFiles || [];

  const level = new Map();
  const visiting = new Set();
  const levelOf = (n) => {
    if (level.has(n)) return level.get(n);
    if (visiting.has(n)) throw new Error(`dependency cycle through #${n}`);
    visiting.add(n);
    const l = blockersOf(n).reduce((max, b) => Math.max(max, levelOf(b) + 1), 0);
    visiting.delete(n);
    level.set(n, l);
    return l;
  };
  numbers.forEach(levelOf);

  const waves = [];
  const maxLevel = numbers.reduce((max, n) => Math.max(max, level.get(n)), -1);
  for (let l = 0; l <= maxLevel; l++) {
    const members = numbers.filter((n) => level.get(n) === l);
    const known = members.filter((n) => keyFilesOf(n).length > 0);
    const groups = groupByFileOverlap(known.map((n) => ({ id: n, keyFiles: keyFilesOf(n) })), { hubPathMinCount: Infinity });
    const depth = groups.reduce((max, g) => Math.max(max, g.length), 0);
    for (let i = 0; i < depth; i++) waves.push(known.filter((n) => groups.some((g) => g[i] === n)));
    for (const n of members) if (keyFilesOf(n).length === 0) waves.push([n]);
  }
  return { waves, parallel: waves.some((w) => w.length > 1) };
}

module.exports = { planParallelWaves };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/preflight-records/waves.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit** — `Add parallel-wave planner — DAG levels split by file overlap for /flow parallel mode (refs #2677)` (two files).

### Task 2: `--waves` flag on `preflight-records.js`

**Files:**
- Modify: `plugin/bin/preflight-records.js`: the header comment, `USAGE`, `parseArgs`, and the envelope build at the end of `run`.
- Test: `tests/bin-lib/preflight-records/preflight-records.test.js` (append at the end).
- Modify: `docs/plugin-structure.md`, the `node plugin/bin/preflight-records.js …` command-reference line.

**Interfaces:**
- Consumes: `planParallelWaves({ records, numbers })` from Task 1.
- Produces: with `--waves`, the envelope gains `waves: { waves: number[][], parallel: boolean }`. A thrown cycle error exits 2, with `preflight-records.js: {message}` on stderr. Without the flag the envelope is unchanged.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/preflight-records/preflight-records.test.js`, reusing its existing `issue`, `specBody`, `isIssueView`, `cliDeps`, `run` helpers):

```js
test('AC2.1, AC4.1: --waves adds a waves plan; without it the envelope has no waves key (#2677)', () => {
  const runner = (args) => {
    if (isIssueView(args, 801)) return JSON.stringify(issue({ number: 801, title: 'A', body: specBody(['a.js']) }));
    if (isIssueView(args, 802)) return JSON.stringify(issue({ number: 802, title: 'B', body: specBody(['b.js']) }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const withFlag = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['801', '802', '--waves'], withFlag.deps), 0);
  assert.deepEqual(JSON.parse(withFlag.out.join('')).waves, { waves: [[801, 802]], parallel: true });

  const without = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['801', '802'], without.deps), 0);
  assert.equal('waves' in JSON.parse(without.out.join('')), false);
});

test('--waves on a dependency cycle exits 2 naming the cycle, no stdout (#2677)', () => {
  const runner = (args) => {
    if (isIssueView(args, 811)) return JSON.stringify(issue({ number: 811, title: 'A', body: `Blocked by #812\n\n${specBody(['a.js'])}` }));
    if (isIssueView(args, 812)) return JSON.stringify(issue({ number: 812, title: 'B', body: `Blocked by #811\n\n${specBody(['b.js'])}` }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out, err } = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['811', '812', '--waves'], deps), 2);
  assert.equal(out.length, 0);
  assert.match(err.join(''), /dependency cycle through #81[12]/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js`
Expected: FAIL. `--waves` exits 2 with "unknown argument: --waves".

- [ ] **Step 3: Implement**, following the existing `--merge-gate` flag's exact pattern in the same file:
  - In `parseArgs`, add `waves: false` to the opts literal and a branch `else if (a === '--waves') opts.waves = true;`.
  - Add `[--waves]` to `USAGE` and to header line 3, right after `[--merge-gate]`. Add one header sentence: `--waves (#2677) adds waves {waves, parallel} — the opt-in multi-spec parallel-wave plan (bin/lib/preflight-records/waves.js).`
  - Add `const { planParallelWaves } = require('./lib/preflight-records/waves');` beside the merge-gate require.
  - Where the envelope is built (`const envelope = { records, overlapGroups, workLinks };` and the `mergeGate` line), add before the `deps.stdout` write:

```js
  if (opts.waves) {
    try {
      envelope.waves = planParallelWaves({ records, numbers });
    } catch (err) {
      deps.stderr(`preflight-records.js: ${err.message}\n`);
      return 2;
    }
  }
```

  - In `docs/plugin-structure.md`'s `preflight-records.js` command-reference line, add `[--waves]` after `[--merge-gate]`, and append `; --waves (#2677) adds waves {waves, parallel} — the multi-spec parallel-wave plan`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js tests/bin-lib/preflight-records/waves.test.js tests/bin-lib/preflight-records/merge-gate.test.js`
Expected: PASS, every test

- [ ] **Step 5: Commit**: `Add --waves to preflight-records.js — opt-in parallel-wave plan in the envelope (refs #2677)`

### Task 3: Decision, execution procedure, and the docs that assumed sequential-only

**Files:**
- Create: `plugin/skills/flow/multispec-parallel-waves.md`
- Modify:
  - `plugin/skills/flow/SKILL.md`: the Arguments table, after the `keep-going` row; and the `- **Shared worktree:**` bullet in "Multi-Spec Sequential Flow".
  - `plugin/skills/flow/multi-spec.md`: the Validation list, after item `4a.`; and the Execution section's `> Separate-terminal parallel runs …` blockquote.
  - `plugin/skills/flow/multispec-review-console.md`: insert before the `### Shared teardown` heading.
  - `plugin/skills/flow/multispec-progress-banner.md`: append at the end.
  - `plugin/skills/flow/multispec-failure-handling.md`: append a new section at the end.
  - `plugin/skills/flow/multispec-run-dir-layout.md`: append at the end.
  - `docs/plugin-structure.md`: the `flow` sub-file row. Add `multispec-parallel-waves.md` after `multispec-merge-gate.md` in the file list, plus one description clause.
- Test: `tests/flow-claim-preflight.test.js` (append)

**Interfaces:**
- Consumes: `preflight-records.js --waves` (Task 2) and its `waves {waves, parallel}` envelope field.
- Produces: the documented decision (AC 1), the merge-back procedure and the single-PR reconciliation (AC 6), and the opt-in `parallel` token (AC 4).

- [ ] **Step 1: Write the failing test** (append to `tests/flow-claim-preflight.test.js`; `read(p)` already exists there):

```js
test('AC1.1, AC6.1: parallel waves — decision sub-file, opt-in token, merge-back, single-PR reconciliation (#2677)', () => {
  const skill = read('plugin/skills/flow/SKILL.md');
  assert.match(skill, /\| `parallel` \|[^\n]*multispec-parallel-waves\.md/);
  assert.match(read('plugin/skills/flow/multi-spec.md'), /multispec-parallel-waves\.md/);
  assert.match(read('plugin/skills/flow/multispec-review-console.md'), /multispec-parallel-waves\.md/);
  const doc = read('plugin/skills/flow/multispec-parallel-waves.md');
  assert.match(doc, /preflight-records\.js[^\n]*--waves/);
  assert.match(doc, /merge --no-ff/);
  assert.match(doc, /merge --abort/);
  assert.match(doc, /never calls `AskUserQuestion`/);
  assert.match(doc, /spec-\{N\}\/ledger\.md/);
  assert.match(doc, /Rejected — one shared worktree/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-claim-preflight.test.js`
Expected: FAIL (no `parallel` row in SKILL.md / ENOENT on the sub-file)

- [ ] **Step 3: Create `plugin/skills/flow/multispec-parallel-waves.md`** with exactly this content:

````markdown
# Multi-Spec — Parallel Waves (`parallel`, #2677)

Loaded by `multi-spec.md`'s Validation step 4b and its Execution section, only when `/flow` was invoked with the opt-in `parallel` token on a multi-record run. Without that token none of this applies, and a multi-spec run is the sequential run `multi-spec.md` describes, unchanged.

## Decision

**Chosen — wave-parallel build and test, sequential everything after.** Mutually independent records build and test concurrently, each in its own per-spec worktree branched from the shared branch's tip. Their branches then merge back into the shared branch one at a time, and review, polish and wrap-up run one record at a time in the shared worktree, exactly as a sequential run does. The run keeps one shared branch, one draft PR, one cumulative phase checklist and one consolidated Review Console.

**Rejected — one shared worktree with parallel builds inside it.** One index and one working tree cannot isolate concurrent work. Concurrent commits contend for `index.lock`, and one run that motivated this decision hit that repeatedly, once on a lock left stale for nine minutes. Each spec's test run also sees the other spec's half-written files. Upgrading `groupByFileOverlap` from a warning to a gate prevents overlapping *edits*, but not either of those.

**Rejected — a full pipeline per spec in separate worktrees.** It multiplies PRs, phase checklists and Review Consoles, and the consolidated console would then have to reconcile N branches at the end instead of a single merged one.

The decision is derivable from the DAG and the records' Key Files, so the run never calls `AskUserQuestion` for it, in any mode.

## Waves

Validation step 3's `preflight-records.js` call adds `--waves` when `parallel` is set, and the envelope's `waves.waves` is the plan (`plugin/bin/lib/preflight-records/waves.js`):
- Records are assigned longest-path levels over the in-run `blocked-by` DAG.
- Each level is split so that no two file-overlapping records share a wave. Overlap uses `groupByFileOverlap` with hub paths **not** exempt, because a widely shared file is exactly what conflicts at merge-back.
- A record with no `### Key Files` gets a wave of its own, because its independence cannot be proven.

`waves.parallel: false`, as for a strict linear chain, means every wave has one member, and the run is the sequential run.

## Procedure, per wave, in order

1. **One member** — run that record's pipeline in the shared worktree exactly as a sequential run does. No per-spec worktree is created.
2. **Several members:**
   - For each member, create a per-spec worktree on a new branch `{shared-branch}-spec-{N}`, based on the shared branch's current tip. Use `_shared/worktree-setup.md`'s adopt-or-create naming. Never `record-worktree` it: the run's worktree stamp stays the shared one.
   - Dispatch one Task agent per member, all in one message. Each agent runs `/claude-tweaks:build #{N}` then `/claude-tweaks:test` inside its own worktree, with `PIPELINE_RUN_DIR` = `{parent}/spec-{N}/`, `MULTISPEC_SHARED_WORKTREE=1` and `MULTISPEC_PARALLEL_WAVE=1`. It writes its open-items rows to `spec-{N}/ledger.md` (the run-dir-scoped ledger, `_shared/ledger-format.md`'s Location rule) rather than the shared `docs/plans/` ledger, and never pushes.
   - Each member's `spec-status` transitions are its own, so several specs can be `running` at once.
3. **Merge back, one member at a time in run order**, from the shared worktree:
   - Run `git -C {shared-worktree} merge --no-ff {shared-branch}-spec-{N}`.
   - Then fold `spec-{N}/ledger.md`'s rows into the shared ledger, renumbering them, and commit.
   - Then remove that per-spec worktree and delete its branch.
   - **On a merge conflict:** run `git merge --abort` to restore the clean tree, keep the member's branch, and re-run that record's build and test sequentially in the shared worktree after the rest of the wave has merged. Log `AUTO {time} — Parallel waves: #{N} conflicted at merge-back ({paths}); re-run sequentially. Reversibility: high.` via `log-decision.js`. A Key Files miss is the expected cause, since Key Files are only a proxy for what a build touches.
4. **Review, polish and wrap-up** run for each merged member one at a time, in run order, in the shared worktree. Phase-exit pushes go to the shared branch only.

**Fallback — never a stop.** If a per-spec worktree cannot be created, or the session's worktree guard refuses work in it, that member runs sequentially in the shared worktree instead. Write one `SKIP` entry (`condition: per-spec worktree unavailable ({reason}) → fallback: sequential`).
````

- [ ] **Step 4: Wire the existing docs.** These are exact insertions, each a single paragraph or line:
  - **`plugin/skills/flow/SKILL.md`, Arguments table**, new row immediately after the `keep-going` row:
    `| \`parallel\` | No | **Multi-spec only, opt-in (#2677).** Build and test mutually independent records concurrently in per-spec worktrees, in dependency waves; review, polish and wrap-up stay sequential in the shared worktree, with one PR and one console. See \`multispec-parallel-waves.md\`. Without it, a multi-spec run is unchanged. |`
  - **`plugin/skills/flow/SKILL.md`, the `- **Shared worktree:**` bullet**, append to its end: ` Under the opt-in \`parallel\` token, a wave's independent records build and test in per-spec worktrees and merge back into the shared branch — see \`multispec-parallel-waves.md\`.`
  - **`plugin/skills/flow/multi-spec.md`, Validation list**, new line after the `4a.` line:
    `4b. **Parallel waves (\`parallel\` only)** — add \`--waves\` to step 3's call and plan independent-record waves from this DAG; see \`multispec-parallel-waves.md\`.`
  - **`plugin/skills/flow/multi-spec.md`, Execution section**, a new blockquote line directly after the `> Separate-terminal parallel runs …` blockquote:
    `> The opt-in \`parallel\` token (#2677) is the one in-run exception: a wave's independent records build and test in per-spec worktrees, then merge back into the shared branch before their review — \`multispec-parallel-waves.md\`.`
  - **`plugin/skills/flow/multispec-review-console.md`**, a new paragraph immediately before the `### Shared teardown` heading:
    `Under the opt-in \`parallel\` token, every wave member's per-spec branch was already merged back into the shared branch before that record's review (\`multispec-parallel-waves.md\`), and its per-spec worktree removed — so this console sees one shared branch and one PR exactly as after a sequential run; a member that conflicted at merge-back was re-run sequentially and is no different here.`
  - **`plugin/skills/flow/multispec-progress-banner.md`**, append:
    `Under the opt-in \`parallel\` token (#2677), every member of a wave transitions to \`running\` at its own build phase, so \`manifest.yml\` can hold several \`running\` specs at once and each prints its own banner; review, polish and wrap-up still transition one spec at a time.`
  - **`plugin/skills/flow/multispec-failure-handling.md`**, append a new section:
    ```
    ## Parallel waves (`parallel`, #2677)

    A HARD-GATE failure in one wave member's build or test never cancels its wave siblings mid-flight — each finishes build and test in its own worktree. Without `keep-going`, the default stop then applies at the wave boundary: no sibling is merged back and no later wave starts; each sibling's per-spec branch is named in the console's "Not run / Failed" footer for a later run. With `keep-going`, the successful siblings merge back and the run continues.
    ```
  - **`plugin/skills/flow/multispec-run-dir-layout.md`**, append:
    `Under the opt-in \`parallel\` token (#2677), a wave member's build and test also write \`spec-{N}/ledger.md\` — the run-dir-scoped ledger — which is folded into the shared ledger at merge-back (\`multispec-parallel-waves.md\`).`
  - **`docs/plugin-structure.md`, `flow` row**: add `multispec-parallel-waves.md` after `multispec-merge-gate.md` in the file list, and after the `multispec-merge-gate.md holds …;` clause add: `multispec-parallel-waves.md holds the #2677 opt-in \`parallel\` mode — the concurrency decision, the wave plan, per-spec-worktree build/test, sequential merge-back with its conflict fallback;`

- [ ] **Step 5: Run tests and size checks**

Run: `node --test tests/flow-claim-preflight.test.js tests/flow-subfile-table-completeness.test.js tests/run-dir-timestamp-utc.test.js`
Expected: PASS
Run: `wc -c plugin/skills/flow/multi-spec.md plugin/skills/flow/SKILL.md plugin/skills/flow/multispec-review-console.md`
Expected: multi-spec.md ≤ 20480; SKILL.md ≤ 46080; multispec-review-console.md ≤ 46080

- [ ] **Step 6: Commit**: `Document /flow parallel waves — opt-in concurrent build+test, sequential merge-back, one PR (refs #2677)`
