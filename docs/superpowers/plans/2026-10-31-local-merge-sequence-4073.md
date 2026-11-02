# Local-Merge Sequence Extraction (#4073) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the local-merge finish sequence (branch guard → `compose-subject.js` + `git merge-tree` pre-merge checks → `close-run` → guarded `--no-ff` merge → explicit-branch push → `record-worktree` re-protect) into one canonical `plugin/skills/_shared/local-merge-sequence.md`. The four sites that restate it today cite that file and keep only their deltas.

**Architecture:** The new `_shared` file is a single-branch sequence (Steps 1-5) with one placeholder vocabulary. It recognizes each failure and the state it leaves, and it never routes one. Each caller keeps a `**Bindings**` paragraph, its precondition, its `--tag`/issue list, its inserted steps, and its failure routing (park, console fallback, skip-and-continue). Each pin that asserted a moved command at a site is re-pointed at the shared file. A new conformance suite pins the citations, the absence of any inline copy, and each site's delta.

**Tech Stack:** Markdown skill prose under `plugin/skills/`; `node --test` suites under `tests/` (`tests/helpers/read-skill.js`'s `readText`, `tests/helpers/git-fixtures.js`).

**Spec:** `.claude-tweaks/pipelines/2026-10-31T101111-spec-4107-4052-4070-4090-4101-4105-4106-4073/spec-4073/work/4073-spec.md` (materialized from GitHub issue #4073)

## Global Constraints

- The payload is `plugin/` only. The new contract is `plugin/skills/_shared/local-merge-sequence.md`, and `tests/`/`docs/` stay maintainer-side.
- The shared file's placeholder vocabulary is exactly `{base-branch}`, `{branch}`, `{issues}`, `{tag}`, `{run-dir}`, `{subject-dir}`, plus `{worktree-path}`. The spec omitted `{worktree-path}`, but the push and the re-protect cannot be written without it (Decisions, D1).
- The composer flags stay exactly as the sites use them today: `{issues} --tag {tag} --range {base-branch}...{branch} --out-dir "{subject-dir}" || exit 1`. **No `--keep-open`.** #4252 is unmerged and has no PR, so it rebases onto this change later.
- `close-run` is its own Bash call. It is never chained onto the merge or the push, because the `worktree-always` gate inspects the whole command string.
- `pr-first` (`_shared/pr-first-merge.md`) is out of scope. Only the `local-merge` path moves.
- A single-branch sequence must not bake in abort-on-failure. `/flow` loops it and skips a branch whose composer fails.
- Edges are stated once, in `docs/skill-graph.md`. No `SKILL.md` relationship prose changes.
- Tests read prose through `readText` and assert no byte sizes (`tests/skill-size-single-source.test.js`). The Read rail is held by the `rail:` suite. The four site files shrink; the new file is ~8.6 KB; `_shared/policy-schema.md` grows 13 B (52,118 → 52,131, leaving 369 B under `RAIL_BYTES` = 52,500) and `_shared/integration-model.md` grows slightly — all measured under the rail by plan review. Do not add any other text to `policy-schema.md`.
- Copy every pinned literal out of this plan's replacement text, never from memory (skill-prose-conformance-tests).
- Commit messages use `{Verb} {what} — {detail}`, with body line `refs #4073`, never `closes`.
- Run one plain command per Bash call. Use `git -C "<worktree>"`, never `cd … &&`.

## Review Focus

1. **The worktree path is read after `close-run` nulled it.** `{worktree-path}` comes back empty, and the push or re-stamp targets nothing. Pinned by Task 2/3's per-site read-order test in `tests/local-merge-close-run-ordering.test.js` (`siteReadOrder`).
2. **The push is chained onto the merge or onto `close-run` under `worktree-always: true`.** The whole call is denied before either half runs. Pinned by Task 1's `close-run fence is one command`, `push fence is one command`, and `never-chain rule` facts.
3. **`/flow`'s multi-branch loop reads the shared file as abort-on-failure** and stops the reconciliation on a composer failure. Pinned by Task 1's caller-outcome absence test on the shared file and Task 3's flow skip-and-continue bullet pin.
4. **A caller drops a binding.** For example, settle-and-merge loses `{worktree-path}` = `{group-worktree}`, so the re-protect stamps the wrong path. Pinned by Task 2/3's `**Bindings**` completeness test.
5. **Placeholder drift in the shared fences.** A `{integration-branch}` or `{feature-branch}` reappears, and an agent runs an unsubstituted placeholder. Pinned by Task 1's vocabulary test (foreign and unused both ways).

## Decisions the spec left open

- **D1. `{worktree-path}` is a seventh placeholder.** Step 4's `git -C "{worktree-path}" push origin {base-branch}` and Step 5's `record-worktree … "{worktree-path}"` need it. Callers bind it: settle-and-merge binds it to `{group-worktree}`, the others to the value they read from `run-state.json`.
- **D2. Sites keep their local placeholder names and bind them** (`{feature-branch}`, `{integration-branch}`, `{group-worktree}`). Renaming them would rewrite pinned log templates such as `tests/log-decision-text-file-sites-conformance.test.js` L1, `Merged {feature-branch} into {base-branch} …`. The spec's "placeholder bindings" delta reads the same way.
- **D3. `/flow` keeps its own `env -u CLAUDE_CODE_SESSION_ID` re-protect fence as its delta.** The shared Step 5 fence is the plain one the other three sites run today, so their behavior is unchanged. Step 5 says, without code, that a caller re-protecting another session's run unsets the variable.
- **D4. `/flow` stays untagged.** The shared composer line carries `--tag {tag}`. Flow binds "`{tag}` — none: drop `--tag {tag}`", which matches today's untagged flow merge.
- **D5. The E1 rationale follows the majority.** `settle-and-merge.md:375` says `close-run` runs "so the merge … isn't denied as a wrong-checkout commit (E1)". That contradicts `auto-merge-short-circuit.md:267`, `local-merge-auto-finish.md:145` and `worktree-merge.md:44`, which all say E1 does not gate `git merge`. The shared file states the majority rule, and settle-and-merge's clause retires.
- **D6. Post-push steps and logging stay caller-owned.** That covers `_shared/pr-first-merge-post-merge.md` Steps 4.0b/4.1, the `decisions.md` lines and the console FYI. The shared file never names `pending-review`, a console, a park, or a skip.
- **D7. AC2's literal `git grep -c "grep -qxF"` still counts 1 in `flow/worktree-merge.md` on the branch.** The hit is §5's scratch fast-forward (`git branch --show-current | grep -qxF '{base-branch}' && git merge --ff-only <sha>`), a different construct that `_shared/scratch-worktree.md:145` also carries. The evidence step therefore runs both the literal and the guard-block form `if ! git branch --show-current | grep -qxF`. The new suite bans the guard-block form.
- **D8. No compose bundle change.** The `merge` bundle composes only `pr-first-merge.md` and `pr-checklist-refresh.md`, for the `pr-first` path. `auto-merge-short-circuit.md` is read directly (cited from `review-console.md`), and none of the four files carries a `when:` fence. Each site therefore gets a direct "read it" citation.
- **D9. The retirement sweep reaches past the Key Files.** It covers stale "four local-merge fences" claims in shipped prose and code comments: `plugin/skills/_shared/policy-schema.md:142`, `plugin/skills/_shared/integration-model.md:54`, `plugin/bin/lib/compose-subject.js:49-54`, `plugin/bin/lib/release/subject.js:2-5`, and two journeys. `docs/decisions/0025-*.md` is a point-in-time record and stays unchanged.
- **D10. `docs/plugin-structure.md` gets the new file folded into its curated `_shared` row.** AC5 requires the listing. That row is the only `_shared` registration site, so no new row is added.

## Sizing

The scope is 1 new skill file, 4 site files, 4 modified test files plus 1 new one, and 7 doc/sweep files. That is at the agent-sized ceiling the spec warns about, but each test change is data-driven: a `SITES`/`LOCAL_FENCE_FILES` entry is removed or added, plus one opener string. Splitting the work so each task carries both the prose and the pins it moves keeps it to four tasks without half-migrating. **No split is needed.** If Task 3's review rejects the flow rewrite, the fallback is to land Tasks 1-2 and capture Task 3 plus the matching half of Task 4 as a follow-up via `/claude-tweaks:capture`. A half-migrated `SITES` list is never committed.

## File structure

| File | Responsibility |
|---|---|
| `plugin/skills/_shared/local-merge-sequence.md` (new) | The canonical single-branch sequence, its bindings and order rationale, and failure recognition. No routing. |
| `plugin/skills/_shared/local-merge-auto-finish.md` | Precondition, default policy, steps 1-2 reads, bindings, step 6 verify (inserted between merge and push), Park routing |
| `plugin/skills/wrap-up/auto-merge-short-circuit.md` | Verdict backstop, worktree/branch/integration-branch reads, bindings (`{tag}`), console fallback, FYI, post-push 4.0b/4.1 |
| `plugin/skills/dispatch/settle-and-merge.md` | Content-judgment re-check, integration-branch resolution, bindings (two-issue `{issues}`, `auto-merge`, `{group-worktree}`), cleanup, parking |
| `plugin/skills/flow/worktree-merge.md` | Multi-branch loop, run discovery, per-step routing (skip-and-continue), conflict path, push once, owner-preserving `### Re-protect` |
| `tests/local-merge-sequence-conformance.test.js` (new) | Shared-file facts and vocabulary, caller-outcome absence, per-site citation, block absence, deltas, bindings, roster |
| `tests/local-merge-close-run-ordering.test.js` | Ordering and extract-and-run, re-pointed at the shared file. Per-site read-order and flow owner pins. |
| `tests/merge-subject-composer-conformance.test.js` | Composer and `-F` merge-form pins re-pointed at the shared file. Stale-form absence kept over the shared file and the sites. |
| `tests/below-floor-parent-close-conformance.test.js` | Short-circuit push-site opener retargeted |

---

### Task 1: Create the shared sequence and pin it

**Files:**
- Create: `plugin/skills/_shared/local-merge-sequence.md`
- Create: `tests/local-merge-sequence-conformance.test.js`
- Modify: `tests/local-merge-close-run-ordering.test.js:2-13` (header), `:43-104` (`SITES` gains a fifth entry)
- Modify: `tests/merge-subject-composer-conformance.test.js:17-23` (constants), `:127-140` (per-site loop split), `:191-198` (sweep reach)
- Waived `plugin/skills/wrap-up/auto-merge-short-circuit.md`: read-only source of the frozen `PRE_4073_BLOCK` lines (current `:303`, `:307`, `:308`, `:319`)
- Waived `plugin/bin/lib/compose-subject.js`: read-only. Confirms `--tag` is optional (`USAGE`, `:73`) and that `--keep-open` exists but is not used by local sites.
- Waived `plugin/skills/_shared/pr-first-merge.md`: read-only — the `pr-first` merge path, out of scope (spec Technical Approach); confirms the composed `merge` bundle serves only that path (decision D8)
- Waived `plugin/bin/compose-context.js`: read-only — the composed-bundle builder; no bundle change is needed because the local-merge sites read files directly (decision D8)

**Interfaces:**
- Produces the file `plugin/skills/_shared/local-merge-sequence.md` with headings `## Bindings`, `## Why the order is load-bearing`, `## Step 1: Pre-merge checks — from the main checkout, nothing mutated`, `## Step 2: Close the run — only once Step 1 passed, its own Bash call`, `## Step 3: Merge — from the main checkout`, `## Step 4: Push — from inside the linked worktree, its own Bash call`, `## Step 5: Re-protect — after any failure that follows Step 2`. Later tasks cite "`_shared/local-merge-sequence.md` Step N" and "the sequence's Step N".
- Produces in the new suite: `SEQUENCE`, `CITATION = '_shared/local-merge-sequence.md'`, `VOCAB`, `BOUND`, `fencesOf`, `stripLoose`, `SITES = []` (Tasks 2-3 append), `BLOCK`, `PRE_4073_BLOCK`, `inlineBlockParts`.
- Produces in `merge-subject-composer-conformance.test.js`: `LOCAL_SEQUENCE` and `LOCAL_FENCE_FILES = [LOCAL_SEQUENCE, ...LOCAL_SITES]` (Tasks 2-3 narrow it).

- [ ] **Step 1: Write the new suite's shared-file tests (failing)**

Create `tests/local-merge-sequence-conformance.test.js`:

```js
'use strict';
// Conformance suite for record #4073: the local-merge finish sequence (branch guard,
// compose-subject.js + git merge-tree pre-merge checks, close-run, guarded merge, explicit-branch
// push, re-protect) lives once in plugin/skills/_shared/local-merge-sequence.md. Its callers cite
// it and keep only their deltas (bindings, --tag/issue list, inserted steps, failure routing).
// Live-corpus read: a convention enforced against every future edit (skill-prose-conformance-tests'
// Decision Framework). Whitespace collapsed on haystack and needle, absence checks included
// [IL-66]; each fact is proved red on a doctored in-memory copy, matched to its own name [IL-105].
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const collapse = (s) => s.replace(/\s+/g, ' ');
const read = (rel) => readText(path.join(ROOT, rel));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Remove one occurrence of `lit` even when the prose wraps it across lines.
const stripLoose = (text, lit) => text.replace(new RegExp(lit.split(/\s+/).map(esc).join('\\s+')), '');

const SEQUENCE = 'plugin/skills/_shared/local-merge-sequence.md';
const CITATION = '_shared/local-merge-sequence.md';
const VOCAB = ['base-branch', 'branch', 'issues', 'tag', 'run-dir', 'subject-dir', 'worktree-path'];
const BOUND = VOCAB.filter((v) => v !== 'subject-dir'); // {subject-dir} resolves per pr-first-merge.md Step 3

const fencesOf = (text) => [...text.replace(/\r\n/g, '\n').matchAll(/^([ \t]*)```bash\n([\s\S]*?)\n[ \t]*```/gm)]
  .map((m) => m[2].split('\n').map((l) => (l.startsWith(m[1]) ? l.slice(m[1].length) : l)).join('\n'));
const fenceCount = (t, pred) => fencesOf(t).filter(pred).length;

const PRE_MERGE = [
  "if ! git branch --show-current | grep -qxF '{base-branch}'; then",
  'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issues} --tag {tag} --range {base-branch}...{branch} --out-dir "{subject-dir}" || exit 1',
  'git merge-tree --write-tree --name-only {base-branch} {branch} || exit 1',
];
const CLOSE_RUN = 'node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "{run-dir}"';
const MERGE = 'git merge --no-ff {branch} -F "{subject-dir}/message.txt"';
const PUSH = 'git -C "{worktree-path}" push origin {base-branch}';
const REPROTECT = 'node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}" "{worktree-path}"';

const PROSE = {
  'never-chain rule': 'never chain the push onto the merge or onto `close-run`',
  'whole-command-string reason': 'the gate inspects the whole command string up front',
  'single-branch loop': 'A caller that merges several branches loops Steps 1-3 once per branch',
  'push once after the loop': 'A caller that merges several branches runs Step 4 once, after its last merge',
  'inserted caller step': 'A caller may run its own step between Step 3 and Step 4',
  'routing stays with the caller': 'it never decides what the caller does next',
  'read worktree before close-run': "Read it from `{run-dir}/run-state.json`'s `worktree` field **before Step 2**",
  'pre-check vs conflict': 'Record it as `pre-check failed: {first stderr line}`, never as a conflict',
  'push failure keeps the merge': 'Never `git merge --abort` and never undo the local merge',
  're-stamp output logged': 'is never ignored — the caller logs it',
};
const FACTS = {
  'pre-merge fence': (t) => fenceCount(t, (f) => PRE_MERGE.every((l) => f.includes(l))) === 1,
  'close-run fence is one command': (t) => fenceCount(t, (f) => f.trim() === CLOSE_RUN) === 1,
  'merge fence': (t) => fenceCount(t, (f) => f.includes(PRE_MERGE[0]) && f.trim().endsWith(MERGE)) === 1,
  'push fence is one command': (t) => fenceCount(t, (f) => f.trim() === PUSH) === 1,
  're-protect fence': (t) => fenceCount(t, (f) => f.trim() === REPROTECT) === 1,
  ...Object.fromEntries(Object.entries(PROSE).map(([n, lit]) => [n, (t) => collapse(t).includes(collapse(lit))])),
};
const missingFacts = (t) => Object.entries(FACTS).filter(([, ok]) => !ok(t)).map(([n]) => n);
const DOCTORS = {
  'pre-merge fence': (t) => t.replace(PRE_MERGE[2], 'git merge-tree --write-tree --name-only {base-branch} {branch}'),
  'close-run fence is one command': (t) => t.replace(CLOSE_RUN, `${CLOSE_RUN} && ${PUSH}`),
  'merge fence': (t) => t.replace(MERGE, 'git merge --no-ff {branch}'),
  'push fence is one command': (t) => t.replace(`${PUSH}\n`, `git merge --no-ff {branch} && ${PUSH}\n`),
  're-protect fence': (t) => t.replace(REPROTECT, 'node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}"'),
  ...Object.fromEntries(Object.entries(PROSE).map(([n, lit]) => [n, (t) => stripLoose(t, lit)])),
};

test('local-merge-sequence.md states every fact of the sequence', () => {
  assert.deepEqual(missingFacts(read(SEQUENCE)), []);
});

test('go-red: each sequence fact, doctored alone, is the only one reported', () => {
  const live = read(SEQUENCE);
  for (const name of Object.keys(FACTS)) {
    const doctored = DOCTORS[name](live);
    assert.notEqual(doctored, live, `${name}: the doctor matched nothing`);
    assert.deepEqual(missingFacts(doctored), [name], name);
  }
});

function placeholderReport(text) {
  const used = new Set();
  for (const f of fencesOf(text)) for (const m of f.matchAll(/\{([a-z-]+)\}/g)) used.add(m[1]);
  return { foreign: [...used].filter((u) => !VOCAB.includes(u)).sort(), unused: VOCAB.filter((v) => !used.has(v)) };
}

test('the sequence fences use exactly the one placeholder vocabulary', () => {
  assert.deepEqual(placeholderReport(read(SEQUENCE)), { foreign: [], unused: [] });
});

test('go-red: a foreign placeholder and a dropped one are both reported', () => {
  const live = read(SEQUENCE);
  assert.deepEqual(placeholderReport(live.replace(PRE_MERGE[0], PRE_MERGE[0].replace('{base-branch}', '{integration-branch}'))),
    { foreign: ['integration-branch'], unused: [] });
  assert.deepEqual(placeholderReport(live.split('{issues}').join('{issue}')), { foreign: ['issue'], unused: ['issues'] });
});

// The contract owns recognition; callers own outcomes (shared-contract-extraction).
const CALLER_OUTCOMES = ['pending-review', 'skip this branch', 'fall back to rendering the console', '**Park**', 'Review Console'];
const callerOutcomesIn = (t) => CALLER_OUTCOMES.filter((o) => collapse(t).includes(o));

test('the sequence names no caller outcome', () => {
  assert.deepEqual(callerOutcomesIn(read(SEQUENCE)), []);
});

test('go-red: each caller outcome, appended alone, is the only one reported', () => {
  const live = read(SEQUENCE);
  for (const o of CALLER_OUTCOMES) assert.deepEqual(callerOutcomesIn(`${live}\n${o}\n`), [o]);
});

test('the sequence cites the integration-model fragment and the pr-first-merge subject-dir definition', () => {
  const flat = collapse(read(SEQUENCE));
  assert.ok(flat.includes('`_shared/integration-model.md`'));
  assert.ok(flat.includes('`{subject-dir}` — resolves per `_shared/pr-first-merge.md` Step 3'));
});
```

The site-side half (`SITES`, `BLOCK`, `PRE_4073_BLOCK`, `inlineBlockParts`, and the citation/absence/delta/bindings tests) is added in Tasks 2-4. Declare `const SITES = [];` now so Tasks 2-3 append entries without restructuring.

- [ ] **Step 2: Add the shared file to the two existing suites (failing)**

`tests/local-merge-close-run-ordering.test.js`:
- Header (`:2-13`): append a line: `// #4073 moved the sequence into plugin/skills/_shared/local-merge-sequence.md; the four callers cite it, so the ordering, extract-and-run and re-protect pins run there.`
- Append to `SITES` (after the `worktree-merge.md` entry at `:103`):

```js
  {
    label: 'local-merge-sequence.md',
    file: 'plugin/skills/_shared/local-merge-sequence.md',
    readsWorktree: false,
    logNeedle: 'any other line',
    worktreeVar: 'worktree-path',
    vars: {
      'base-branch': 'main',
      branch: 'feat',
      issues: '1 2',
      tag: 'fast-lane',
      'subject-dir': posix(SUBJECT_DIR),
      'worktree-path': posix(WORKTREE),
    },
  },
```

- Append at the end of the file (spec AC4 names this suite as the one that pins the "never chained onto the push" half; the new suite's `FACTS` pin it too, which is fine):

```js
// #4073 AC4: the shared sequence runs close-run as its own Bash call — one command line, never
// chained onto the merge or the push (the worktree-always gate inspects the whole command string).
function closeRunChainErrors(text) {
  const body = extractFence(text, CLOSE_RUN_NEEDLE).trim();
  const errors = [];
  if (body.includes('\n')) errors.push('the close-run fence holds more than one line');
  if (/&&|\|\||;/.test(body)) errors.push('the close-run command is chained');
  if (body.includes('git push') || body.includes(MERGE_NEEDLE)) errors.push('the close-run fence also merges or pushes');
  return errors;
}

test('#4073 AC4: local-merge-sequence.md runs close-run as its own one-command Bash call, never chained onto the push', () => {
  const text = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'local-merge-sequence.md'));
  assert.deepStrictEqual(closeRunChainErrors(text), []);
  const chained = text.replace(/(bin\/hooks\.js" close-run --run [^\n]*)/, '$1 && git -C "{worktree-path}" push origin {base-branch}');
  assert.notStrictEqual(chained, text, 'doctoring must change the text');
  assert.ok(closeRunChainErrors(chained).length > 0, 'a close-run chained onto the push must fail the check');
});
```

`tests/merge-subject-composer-conformance.test.js`:
- After `LOCAL_SITES` (`:23`), add:

```js
// #4073: the composer and --no-ff merge fences live once in the shared sequence; the four
// LOCAL_SITES cite it. LOCAL_FENCE_FILES lists the files that still carry the fences.
const LOCAL_SEQUENCE = 'plugin/skills/_shared/local-merge-sequence.md';
const LOCAL_FENCE_FILES = [LOCAL_SEQUENCE, ...LOCAL_SITES];
```

- Replace the single loop at `:127-140` with two loops. The first is `for (const rel of LOCAL_FENCE_FILES)` and runs the three positive assertions: `LOCAL_COMPOSER_CALL`, `LOCAL_MERGE_FORM`, and the `{subject-dir}` pointer `` '`{subject-dir}` resolves per `_shared/pr-first-merge.md` Step 3' ``. For the shared file, that pointer reads `` `{subject-dir}` — resolves per `_shared/pr-first-merge.md` Step 3 ``, so match it with the regex ``/`\{subject-dir\}`(?: —)? resolves per `_shared\/pr-first-merge\.md` Step 3/``. Title: `` `${path.basename(rel)}: the --no-ff merge sources -F from the composer` ``. The second is `for (const rel of [LOCAL_SEQUENCE, ...LOCAL_SITES])` and runs the absence assertions unchanged: `STALE_LOCAL_FORM`, the `eval "$SUBJECT_EXPORTS"`, `SUBJECT_EXPORTS=`, `--shell` and `$SUBJECT_TITLE` counts. Title: `` `${path.basename(rel)}: no free-form -m subject and no eval of the composer output` ``.
- Add a test: `go-red: a local-merge-sequence.md copy whose composer line loses --range fails LOCAL_COMPOSER_CALL`. It reads `LOCAL_SEQUENCE`, removes `' --range {base-branch}...{branch}'`, asserts `notEqual`, then asserts `doesNotMatch(doctored, LOCAL_COMPOSER_CALL)`.
- `:194`: change the sweep-reach list to `[PR_FIRST, LOCAL_SEQUENCE, ...LOCAL_SITES]`.

- [ ] **Step 3: Run the three suites and see them red**

Run: `node --test tests/local-merge-sequence-conformance.test.js tests/local-merge-close-run-ordering.test.js tests/merge-subject-composer-conformance.test.js`
Expected: FAIL. The new suite and the close-run-ordering suite fail on `ENOENT … local-merge-sequence.md` (module-scope read in the latter). merge-subject's `local-merge-sequence.md:` tests fail with ENOENT, and so does the existing sweep test `AC1.1: no fenced block anywhere…` (`:191-198`, "sweep reached …") because `LOCAL_SEQUENCE` now sits in its sweep list — it goes green at Step 4 once the file exists. Every other pre-existing test there still passes.

- [ ] **Step 4: Create `plugin/skills/_shared/local-merge-sequence.md` with exactly this content**

````markdown
# Local-Merge Sequence — one branch, guard to push

Canonical for merging one feature branch into the integration branch from the main checkout
under `integration-model: local-merge` (`_shared/integration-model.md`): the branch guard, the
pre-merge checks, `close-run`, the guarded merge, the explicit-branch-name push, and the
re-protect a failure after `close-run` owes. `pr-first` merges never run it — they go through
`_shared/pr-first-merge.md`.

It is a **single-branch** sequence. A caller that merges several branches loops Steps 1-3 once
per branch. This file recognizes each failure and says what state it leaves; it never decides
what the caller does next. Aborting, parking, falling back to a console, or skipping the branch
and continuing with the next one is the caller's routing, stated in the caller's own file.

## Bindings

The caller binds every placeholder before Step 1 and substitutes each value **literally** into
every call. Shell state does not survive between separate Bash calls — a variable set in one is
empty in the next, so never carry a value in a shell variable across calls.

- `{base-branch}` — the integration branch the caller resolved (`_shared/integration-branch.md`),
  never whatever branch the main checkout happens to have checked out: a concurrent session can
  switch that, and the branch guard exists to catch it (`[IL-05]`).
- `{branch}` — the feature branch to merge.
- `{issues}` — the record numbers this merge closes, space-separated: the composer's positional
  arguments, one `Fixes #N` line each ("Close-via-merge" in `_shared/issue-claims.md`).
- `{tag}` — the composer's body tag, rendered as `[{tag}]`. A caller that names no tag drops
  `--tag {tag}` from Step 1's composer line.
- `{run-dir}` — the absolute run directory whose run protects `{branch}`'s worktree
  (`_shared/pipeline-run-dir.md`). A caller with no run for this branch skips Steps 2 and 5.
- `{subject-dir}` — resolves per `_shared/pr-first-merge.md` Step 3.
- `{worktree-path}` — a linked worktree to push from; for a single branch, the one that has
  `{branch}` checked out. Read it from `{run-dir}/run-state.json`'s `worktree` field **before
  Step 2**: `close-run` nulls that field, so a later read returns nothing.

## Why the order is load-bearing

`close-run` clears the run's protection — its worktree assignment and `active` status, the
teardown guard an unmerged branch still needs — so every check that can fail without touching
the tree runs before it (Step 1). The merge and the push necessarily follow it, and any failure
after it re-protects the run (Step 5). A failure in Step 1 leaves the run exactly as it was.

The working-directory hook (E1) does not gate `git merge`, so the merge needs nothing closed
first: `close-run` is the run finishing, not a merge prerequisite. Under `worktree-always: true`
the separate, run-independent gate (`checkWorktreeRequired` in `bin/lib/hooks/pre-tool-use.js`)
still denies `git push` and `git commit` from the main checkout, but never `git merge`, and
`close-run` does nothing for it. So the merge runs from the main checkout and the push from
inside a linked worktree. Run `close-run`, the merge and the push as three separate Bash calls —
never chain the push onto the merge or onto `close-run`: the gate inspects the whole command
string up front, so a compound call is denied before either half runs.
`_shared/policy-schema-coverage.md`'s `worktree-always` block lists what the gate intercepts.

## Step 1: Pre-merge checks — from the main checkout, nothing mutated

```bash
if ! git branch --show-current | grep -qxF '{base-branch}'; then
  echo "Main checkout is not on '{base-branch}' — a concurrent session switched it. Abort, do not merge." >&2
  exit 1
fi
node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issues} --tag {tag} --range {base-branch}...{branch} --out-dir "{subject-dir}" || exit 1
git merge-tree --write-tree --name-only {base-branch} {branch} || exit 1
```

`git merge-tree` writes only unreferenced objects — never the working tree, the index, or a ref.
Any non-zero exit means nothing was merged and `close-run` has not run, so there is nothing to
undo and nothing to re-protect. Tell the failures apart by their output:

- **The branch guard aborted** — stderr ends `Abort, do not merge.`: the checkout moved
  underneath the caller.
- **The composer failed** — `compose-subject.js` printed its reason on stderr. A record with no
  resolvable Type, or a `breaking` label with no `## Breaking Change` section, is a shaping
  defect to fix on the record, not a merge problem. A malformed `commit-scope-paths` entry, a
  `commit-scope` token the composer rejects, a failed `--range` diff, or a call passing no
  `--range` while `commit-scope-paths` is set is a policy or invocation fault to fix in
  `policy.yml` or in this fence.
- **A predicted conflict** — a `CONFLICT` line on `git merge-tree`'s stdout.
- **The pre-check could not run** — a stderr error with no `CONFLICT` line (git older than 2.38
  lacks `--write-tree`, or an unknown ref). Record it as `pre-check failed: {first stderr line}`,
  never as a conflict. The `|| exit 1` collapses every `git merge-tree` failure to exit 1, so the
  output is the only way to tell this case from the one above.

## Step 2: Close the run — only once Step 1 passed, its own Bash call

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "{run-dir}"
```

It marks the run `clean`, so its worktree is released for teardown once the branch lands, and
nulls `run-state.json`'s `worktree` field. Close only this branch's run, never a sweep of
`.claude-tweaks/pipelines/*/`. Fail-open by design: it never blocks the merge below, whatever its
own outcome.

## Step 3: Merge — from the main checkout

The guard repeats Step 1's check as the race backstop — a concurrent session may have switched
the checkout since:

```bash
if ! git branch --show-current | grep -qxF '{base-branch}'; then
  echo "Main checkout is not on '{base-branch}' — a concurrent session switched it. Abort, do not merge." >&2
  exit 1
fi
git merge --no-ff {branch} -F "{subject-dir}/message.txt"
```

`--no-ff` guarantees a real merge commit even when the branch would fast-forward: the commit the
composer's `[{tag}]` paragraph and `Fixes #N` lines land on.

**On failure** — the guard aborted (no merge started), or `git merge` exited non-zero for any
reason (a conflict that appeared only after Step 1's prediction, the race it cannot rule out; a
dirty working tree; unrelated histories): if a `MERGE_HEAD` exists, run `git merge --abort` as
its own call; otherwise the merge never started and the checkout is unchanged. Never attempt
resolution here. `close-run` already ran, so Step 5 applies.

## Step 4: Push — from inside the linked worktree, its own Bash call

```bash
git -C "{worktree-path}" push origin {base-branch}
```

Name the branch explicitly: a bare `git push` from the worktree pushes the *feature* branch,
since that is what is checked out there. Both checkouts share one `.git`, so pushing
`{base-branch}` from the worktree publishes exactly what the main checkout just merged.

A caller that merges several branches runs Step 4 once, after its last merge. A caller may run
its own step between Step 3 and Step 4 — verifying the merged result, say; a failure there
follows Step 2 too, so Step 5 applies.

**On push failure** (a rejected fast-forward, a network or permission error): the merge landed
locally but nothing reached `origin`. Never `git merge --abort` and never undo the local merge —
a human resuming the run needs that commit to push it. Step 5 applies.

## Step 5: Re-protect — after any failure that follows Step 2

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}" "{worktree-path}"
```

One Bash call per closed run, with the `{worktree-path}` read before Step 2 (`run-state.json` no
longer holds it). `record-worktree` restores the worktree assignment and `active` status, so the
parked run is not reap-eligible while it waits (`bin/lib/hooks/pre-tool-use.js`'s teardown gate).
It prints `claude-tweaks: worktree recorded for …` when it worked; any other line (the run dir may
have been archived underneath) is never ignored — the caller logs it. A failure in Step 1 never
re-protects: nothing was closed.

`record-worktree` stamps the calling session's id into the run as its owner. A caller
re-protecting a run another session owns keeps that owner by running this call under
`env -u CLAUDE_CODE_SESSION_ID`.
````

- [ ] **Step 5: Run the three suites plus the corpus sweeps the new file enters, and see them green**

Run: `node --test tests/local-merge-sequence-conformance.test.js tests/local-merge-close-run-ordering.test.js tests/merge-subject-composer-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/integration-model.test.js tests/integration-branch-conformance.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/skill-prose-plugin-root-invocations.test.js`
Expected: PASS. The close-run-ordering loop now runs its 8 per-site tests five times, and the new entry's permutation go-red and extract-and-run red cases exercise the shared fences. If the `go-red` fact test reports more than `[name]` for a doctor, a pinned literal occurs twice or wraps unexpectedly. Fix the prose, never the predicate.

- [ ] **Step 6: Commit**

```bash
git -C "<worktree>" add plugin/skills/_shared/local-merge-sequence.md tests/local-merge-sequence-conformance.test.js tests/local-merge-close-run-ordering.test.js tests/merge-subject-composer-conformance.test.js
git -C "<worktree>" commit -m "Add the shared local-merge sequence — one single-branch guard-to-push procedure with one placeholder vocabulary" -m "refs #4073"
```

---

### Task 2: Migrate the two `/wrap-up`-side sites (`local-merge-auto-finish.md`, `auto-merge-short-circuit.md`)

**Review risk: high.** This task moves text that `tests/local-merge-close-run-ordering.test.js`, `tests/merge-subject-composer-conformance.test.js` and `tests/below-floor-parent-close-conformance.test.js` pin.

**Files:**
- Modify: `plugin/skills/_shared/local-merge-auto-finish.md:55-70`, `:95-182`, `:193-199`, `:230-242`
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md:262-269`, `:295`, `:300-363`, `:371-397`
- Modify: `tests/local-merge-sequence-conformance.test.js` (site half, two entries)
- Modify: `tests/local-merge-close-run-ordering.test.js:43-104` (two `SITES` entries out), add `CITING_SITES` and `siteReadOrder`
- Modify: `tests/merge-subject-composer-conformance.test.js` (`LOCAL_FENCE_FILES` narrowed)
- Modify: `tests/below-floor-parent-close-conformance.test.js:392-413`
- Test: `tests/local-merge-auto-finish.test.js`. Runs unchanged: its pins (Precondition, Default policy, `never attempt … resolution`, `log-decision.js`/`outcome: merged`/`outcome: pending-review`, Interactive section, Section C, review-console, contract, skill-graph) sit on text that does not move.
- Test: `tests/pr-first-merge.test.js`. Unchanged: `:114` pins the short-circuit's own `run-state.json` read, which stays.
- Test: `tests/auto-merge-short-circuit-dispatch-call.test.js`. Unchanged: AC7.1 `:106` pins `the branch guard aborts … fall back to rendering the console normally`, kept in the failure paragraph below.
- Test: `tests/auto-merge-short-circuit-cant-tell.test.js`. Unchanged: `:117` counts the `--fyi` sentence, kept verbatim on one line.
- Test: `tests/auto-merge-short-circuit-verdict-backstop.test.js`, `tests/auto-merge-short-circuit-ledger-deletion.test.js`, `tests/archive-run-verb.test.js`, `tests/log-decision-text-file-sites-conformance.test.js`. Run unchanged: they pin the backstop snippet, ledger deletion, log templates, and the L1/L2 text-file contents, none of which move — and `verdict-backstop`'s `local-merge branch ordering` pin (`:116-119`, `run the Verdict backstop above first[\s\S]{0,300}?before merging, clear this run's worktree`) stays green because Step 4.1's new opener keeps that phrase.

**Interfaces:**
- Consumes: Task 1's step headings, `CITATION`, `BLOCK`/`PRE_4073_BLOCK` (added here), `SITES`.
- Produces (for Task 3): `CITING_SITES` and `siteReadOrder(text, { readsWorktree, closeAnchor }) -> string[]` in close-run-ordering, `bindingsGaps(text) -> string[]` and `deltaGaps(text, deltas) -> string[]` in the new suite, and the `assertLocalPushSite(text, rel, opener)` helper in below-floor.

- [ ] **Step 1: Write the site pins (failing)**

In `tests/local-merge-sequence-conformance.test.js`, add after Task 1's tests:

```js
// The block no caller may carry inline (collapsed, so a line-wrapped copy is still caught).
const BLOCK = [
  ['branch guard', 'if ! git branch --show-current | grep -qxF'],
  ['composer call', 'bin/compose-subject.js" '],
  ['merge-tree pre-check', 'git merge-tree --write-tree --name-only'],
  ['close-run call', 'bin/hooks.js" close-run --run'],
];
// Frozen pre-#4073 lines from wrap-up/auto-merge-short-circuit.md (its pre-merge fence and close-run fence).
const PRE_4073_BLOCK = {
  'branch guard': "if ! git branch --show-current | grep -qxF '{integration-branch}'; then",
  'composer call': 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} --tag {tag} --range {integration-branch}...{branch} --out-dir "{subject-dir}" || exit 1',
  'merge-tree pre-check': 'git merge-tree --write-tree --name-only {integration-branch} {branch} || exit 1',
  'close-run call': 'node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "$RUN_DIR"',
};
const inlineBlockParts = (t) => BLOCK.filter(([, needle]) => collapse(t).includes(collapse(needle))).map(([name]) => name);

// Each caller's **Bindings** paragraph binds every placeholder but {subject-dir}: `{x}` = … or `{x}` — none.
function bindingsGaps(text) {
  const start = text.indexOf('**Bindings');
  if (start < 0) return ['no **Bindings** paragraph'];
  const end = text.indexOf('\n\n', start);
  const para = collapse(end < 0 ? text.slice(start) : text.slice(start, end));
  return BOUND.filter((p) => !new RegExp('`\\{' + esc(p) + '\\}` (?:=|— none)').test(para));
}
const deltaGaps = (text, deltas) => Object.entries(deltas).filter(([, lit]) => !collapse(text).includes(collapse(lit))).map(([n]) => n);

test('the anchor: the sequence itself carries every block part', () => {
  assert.deepEqual(inlineBlockParts(read(SEQUENCE)), BLOCK.map(([n]) => n));
});

function siteTests(site) {
  test(`${site.label}: cites ${CITATION}`, () => {
    const live = read(site.file);
    assert.ok(collapse(live).includes(CITATION));
    const doctored = live.split(CITATION).join('_shared/zzz-no-such-sequence-4073.md'); // a nonsense token: a hit means re-pick it
    assert.ok(!collapse(doctored).includes(CITATION), 'go-red: an uncited site must fail');
  });
  test(`${site.label}: carries no inline copy of the guard, composer, merge-tree or close-run block`, () => {
    const live = read(site.file);
    assert.deepEqual(inlineBlockParts(live), []);
    for (const [name] of BLOCK) {
      const wrapped = PRE_4073_BLOCK[name].replace(' ', '\n   '); // a line-wrapped copy is still caught [IL-66]
      assert.deepEqual(inlineBlockParts(`${live}\n${wrapped}\n`), [name], `go-red: ${name}`);
    }
  });
  test(`${site.label}: binds every placeholder the sequence needs`, () => {
    const live = read(site.file);
    assert.deepEqual(bindingsGaps(live), []);
    const doctored = live.replace(/`\{worktree-path\}` =/, '`{worktree-path}` is');
    assert.notEqual(doctored, live);
    assert.deepEqual(bindingsGaps(doctored), ['worktree-path'], 'go-red: a dropped binding');
  });
  test(`${site.label}: keeps its own deltas`, () => {
    const live = read(site.file);
    assert.deepEqual(deltaGaps(live, site.deltas), []);
    for (const [name, lit] of Object.entries(site.deltas)) {
      const doctored = stripLoose(live, lit);
      assert.notEqual(doctored, live, `${name}: the strip matched nothing`);
      assert.deepEqual(deltaGaps(doctored, site.deltas), [name], `go-red: ${name}`);
    }
  });
}
```

Append these entries to `SITES` and finish the file with `for (const site of SITES) siteTests(site);`:

```js
  { label: 'local-merge-auto-finish.md', file: 'plugin/skills/_shared/local-merge-auto-finish.md', deltas: {
    'tag auto-finish': '`{tag}` = `auto-finish`',
    'single issue': '`{issues}` = `{issue}`',
    'feature-branch binding': '`{branch}` = `{feature-branch}`',
    'verification between merge and push': '6. **Verify on the merged result**',
    're-stamp output logged': "carry it into the log call's `{text-file}`",
  } },
  { label: 'auto-merge-short-circuit.md', file: 'plugin/skills/wrap-up/auto-merge-short-circuit.md', deltas: {
    'own tag': "`{tag}` = this file's own `{tag}`",
    'single issue': '`{issues}` = `{issue}`',
    'integration-branch binding': '`{base-branch}` = `{integration-branch}`',
    're-stamp output logged': 'log its output line to `decisions.md`',
  } },
```

In `tests/local-merge-close-run-ordering.test.js`, add after the `SITES` loop (`:403`):

```js
// #4073: each caller reads run-state.json's `worktree` (when it reads it) before the step that runs the
// sequence's close-run, since close-run nulls the field. `closeAnchor` is that step's literal, on one line.
const CITING_SITES = [
  { label: 'local-merge-auto-finish.md', file: 'plugin/skills/_shared/local-merge-auto-finish.md', readsWorktree: true, closeAnchor: '4. **Close the run**' },
  { label: 'auto-merge-short-circuit.md', file: 'plugin/skills/wrap-up/auto-merge-short-circuit.md', readsWorktree: true, closeAnchor: "Run the sequence's Steps 1-4 in order" },
];
function siteReadOrder(text, { readsWorktree, closeAnchor }) {
  const flat = collapse(text);
  const C = flat.indexOf(collapse(closeAnchor));
  const W = flat.lastIndexOf(WORKTREE_READ_NEEDLE);
  const errors = [];
  if (C < 0) errors.push('close anchor missing');
  if (readsWorktree && W < 0) errors.push('worktree read missing');
  if (C >= 0 && W >= 0 && W > C) errors.push('worktree read follows the close step');
  return errors;
}
for (const site of CITING_SITES) {
  test(`${site.label}: the run-state.json worktree read precedes the step that closes the run`, () => {
    const live = readText(path.join(ROOT, site.file));
    assert.deepStrictEqual(siteReadOrder(live, site), []);
    const noAnchor = live.split(site.closeAnchor).join('');
    assert.notStrictEqual(noAnchor, live);
    assert.deepStrictEqual(siteReadOrder(noAnchor, site), ['close anchor missing']);
    const moved = `${live.split(WORKTREE_READ_NEEDLE).join('')}\n${WORKTREE_READ_NEEDLE}\n`;
    assert.deepStrictEqual(siteReadOrder(moved, site), ['worktree read follows the close step'], 'go-red: the order comparison');
    if (site.readsWorktree) {
      assert.deepStrictEqual(siteReadOrder(live.split(WORKTREE_READ_NEEDLE).join(''), site), ['worktree read missing']);
    }
  });
}
```

In `tests/below-floor-parent-close-conformance.test.js:392-413`, extract the loop body into `function assertLocalPushSite(text, rel, opener)`, with the same three assertions using `paragraph(text, opener)`. Change the short-circuit entry's opener to `'After a successful push, run `_shared/pr-first-merge-post-merge.md`'`. Loop with `assertLocalPushSite(read(rel), rel, opener)`. Add:

```js
test('go-red: the retargeted short-circuit push-site paragraph fails without Step 4.0b', () => {
  const rel = 'wrap-up/auto-merge-short-circuit.md';
  const live = read(rel);
  const doctored = live.replace('Step 4.0b against the pushed merge commit', 'against the pushed merge commit');
  assert.notStrictEqual(doctored, live);
  assert.throws(() => assertLocalPushSite(doctored, rel, LOCAL_MERGE_SITES.find(([r]) => r === rel)[1]), /Step 4\.0b \(-1\)/);
});
```

- [ ] **Step 2: Run and see red**

Run: `node --test tests/local-merge-sequence-conformance.test.js tests/local-merge-close-run-ordering.test.js tests/below-floor-parent-close-conformance.test.js`
Expected: FAIL. In the new suite, both sites fail citation, absence (all four parts present), bindings (`no **Bindings** paragraph`), and deltas. close-run-ordering fails `close anchor missing` for both. below-floor fails `paragraph not found` for the short-circuit's new opener.

- [ ] **Step 3: Rewrite `plugin/skills/_shared/local-merge-auto-finish.md`**

1. Replace `:55-66` (the "Reuses the git mechanics…" paragraph and the "The order is load-bearing…" paragraph) with:

```markdown
Steps 3-5 and 7 run `_shared/local-merge-sequence.md` — the single-branch local-merge sequence
(pre-merge checks, `close-run`, guarded merge, explicit-branch push, re-protect) and why its order
is load-bearing; read it before step 3. This file keeps its bindings, the merged-result
verification it runs between the sequence's merge and push (step 6), and what each failure the
sequence recognizes means here. It reaches that sequence through a different, ungated gate from
`wrap-up/auto-merge-short-circuit.md`'s — the Precondition above, not a `merge-check` verdict or
an `auto:merge` label — so this auto branch never invokes `finishing-a-development-branch`'s own
interactive Step 4 menu. A failure before step 4's `close-run` parks with nothing to undo; a
failure after it re-protects the run in the **Park** branch below.
```

2. At `:69-70` (the anchor wraps across the two lines: `…across calls (same warning` / `` `auto-merge-short-circuit.md` states for its own separate calls).``), replace `(same warning`⏎`` `auto-merge-short-circuit.md` states for its own separate calls)`` with ``(the same rule`⏎`` `_shared/local-merge-sequence.md`'s Bindings section states)`` — keep the line break where it is; the Edit `old_string` must include the newline.
3. Replace step 3 (`:95-140`, through the end of the "On a predicted conflict" paragraph) with:

```markdown
3. **Pre-merge checks** — `_shared/local-merge-sequence.md` Step 1, from the main checkout.

   **Bindings:** `{base-branch}` = step 1's value, `{branch}` = `{feature-branch}`, `{issues}` = `{issue}`, `{tag}` = `auto-finish`, `{run-dir}` = `$RUN_DIR`'s value, `{worktree-path}` = step 2's value.

   Nothing has been merged and `close-run` has not run on any failure here, so each goes to the
   **Park** branch below with no re-stamp, its `log-decision.js` call taking
   `{conflict|failed verification}` replaced as follows, and reports `pending-review` — never a
   bare non-zero exit with no logged outcome, per this file's own invariant that every run ends in
   an explicit, logged outcome:

   - **The branch guard aborted** — `main checkout switched to '{current-branch}' underfoot`
     (`{current-branch}` is what `git branch --show-current` prints, run as its own call and
     substituted literally).
   - **The composer failed** — `"composer failed: {first stderr line}"`.
   - **A predicted conflict** — `"predicted conflict: {first CONFLICT line}"`; never attempt
     resolution.
   - **The pre-check could not run** — `"pre-check failed: {first stderr line}"`.
```

4. Replace step 4 (`:142-153`) with:

```markdown
4. **Close the run** — `_shared/local-merge-sequence.md` Step 2, only once step 3 passed. The run
   is finishing: `close-run` marks it `clean` so its worktree is released for teardown once the
   branch lands.
```

5. Replace step 5 (`:155-182`) with:

```markdown
5. **Merge** — `_shared/local-merge-sequence.md` Step 3, from the main checkout. Its `--no-ff`
   merge commit carries the composer's `Fixes #{issue}` closing keyword and `[auto-finish]` body
   tag — the same reason `cleanup-procedures-execution.md` Section C step 2's own carrier commit
   exists. That carrier commit already guarantees closure regardless, so this is
   redundant-but-safe, never harmful.

   **On any failure** (the step's guard aborts, or `git merge` exits non-zero for any reason):
   after that step's own `git merge --abort` rule, this is the one point in this procedure that
   must never attempt resolution — `_shared/auto-mode-contract.md`'s "does NOT silence" table
   states plainly: "Resolution of merge conflicts in worktree finishing | Conflict resolution
   requires intent the model cannot infer." Go to the **Park** branch below, with
   `{conflict|failed verification}` replaced by `conflict` for a merge conflict, or by
   `merge aborted: {first stderr line}` for the guard abort or any other failure.
```

6. Replace step 7's head and fence (`:193-199`) with the line below. Keep `:201-211` verbatim: the "After a successful push…" paragraph (pinned by below-floor `:408-412`) and the "On push failure" paragraph.

```markdown
7. **Push** — `_shared/local-merge-sequence.md` Step 4, from inside the worktree step 2 read.
```

7. Replace the Park re-stamp (`:230-242`, from `**If the park was reached after step 4**` through `…so nothing was closed.`) with the paragraph below. Then the existing "Then log the outcome:" fence follows unchanged.

```markdown
**If the park was reached after step 4** (a merge failure from step 5, a red verification from step 6,
or a push failure from step 7), re-protect the run first — `_shared/local-merge-sequence.md` Step 5,
with the `{worktree-path}` step 2 read. When it does not print `worktree recorded`, its output line
is not ignored — carry it into the log call's `{text-file}` below. A park reached from step 2 or
step 3 runs no re-stamp: `close-run` has not fired, so nothing was closed.
```

- [ ] **Step 4: Rewrite `plugin/skills/wrap-up/auto-merge-short-circuit.md`'s local-merge branch**

1. Replace `:262-269` with:

```markdown
**`integration-model: local-merge`:** run the Verdict backstop above first (anything but `{n}=1`,
stop here and go to "Any layer fails" below). Then read the values below and — after the
pre-merge checks, before merging, clear this run's worktree assignment — run
`_shared/local-merge-sequence.md`, the single-branch local-merge sequence (pre-merge checks,
`close-run`, guarded merge, explicit-branch push, re-protect) and why its order is load-bearing,
with this branch's bindings and failure routing. The run is finishing, as in
`flow/worktree-merge.md`'s reconciliation: the sequence's `close-run` marks it `clean` so its
worktree is released for teardown once the branch lands.
```

(The phrase `before merging, clear this run's worktree` is kept on purpose:
`tests/auto-merge-short-circuit-verdict-backstop.test.js:116-119` pins it within 300 characters
after `run the Verdict backstop above first`. Task 2 Step 6's run of that suite is the check.)

2. Keep `:271-298` (shell-state warning, the read fence, the #299 paragraph). At `:295`, change `precisely what the guard below catches` to `precisely what the sequence's branch guard catches`.
3. Replace `:300-352`, from `**Pre-merge checks — from the main checkout, nothing mutated.**` through `…leaves it stranded locally.`, with the text below. The second paragraph must stay on one line, since it carries a `closeAnchor`.

```markdown
**Bindings:** `{base-branch}` = `{integration-branch}`, `{branch}` = the feature branch read above, `{issues}` = `{issue}`, `{tag}` = this file's own `{tag}` (see `manifesto-authorized-merge.md`'s Tag selection section), `{run-dir}` = `$RUN_DIR`'s value, `{worktree-path}` = the worktree path read above.

Run the sequence's Steps 1-4 in order: Step 1 and Step 3 from the main checkout, Step 2 only once Step 1 passed, Step 4 from inside the worktree as its own Bash call.
```

4. Replace `:354-363`, from `The explicit `--no-ff` guarantees…` through `…with `--ref {integration-branch}` (staged file + closing-report line only).`, with the two paragraphs below. Keep the `--fyi` span on one line (`tests/auto-merge-short-circuit-cant-tell.test.js:117` counts it raw).

```markdown
Still generate this console's full content (Auto-applied / Skill updates / Configuration updates sections, per `review-console-interactive.md`'s "Present the console", plus the finding sections `node "${CLAUDE_PLUGIN_ROOT}/bin/console-filings.js" --run "$PIPELINE_RUN_DIR" --fyi` prints — Low-confidence, Contested, Dropped by tiebreak) and attach it to a `PushNotification` as a non-blocking FYI. Nothing this console would have shown is discarded — only the wait for a live approval is skipped.

After a successful push, run `_shared/pr-first-merge-post-merge.md` Step 4.0b against the pushed merge commit (no PR, so `$MERGING_PR` is empty). Then run `_shared/pr-first-merge-post-merge.md` Step 4.1 with `--ref {integration-branch}` (staged file + closing-report line only).
```

5. Keep `:365-368` ("Console content is not all of Phase 4's execution step…").
6. Replace `:371-397` (both failure paragraphs and the re-stamp fence) with:

```markdown
**If a pre-merge check fails** (the sequence's Step 1 — the composer exits non-zero, `git merge-tree`
predicts a conflict or cannot merge a ref, or the branch guard aborts): nothing was merged and
`close-run` has not run, so there is nothing to undo and no re-stamp to do — fall back to rendering
the console normally, exactly as an `auto:build`-only record would, logging why the auto-merge path
was abandoned (conflict resolution requires judgment a headless run can't supply); a pre-check git
could not run is logged the way that step names it, not as a conflict.

**If the merge call's guard aborts, `git merge` fails, or the push fails** (the sequence's Steps 3
and 4): take that step's own failure rule — `git merge --abort` only when a merge is in progress,
never on a push failure, and never undo the local merge. Then re-protect the run: the sequence's
Step 5, with the `{worktree-path}` read above; when it does not print `worktree recorded`, log its
output line to `decisions.md` rather than ignoring it. Then fall back to rendering the console
normally, exactly as for a failed pre-merge check, logging why the auto-merge path was abandoned —
for a push failure, that the local merge commit exists but is unpushed. Steps 4.0b and 4.1 above
are not run when the push failed.
```

Keep the `Log to decisions.md:` line (`:399-401`) and everything after it.

- [ ] **Step 5: Narrow the re-pointed suites for the two migrated sites**

- `tests/local-merge-close-run-ordering.test.js`: delete the `auto-merge-short-circuit.md` and `local-merge-auto-finish.md` entries from `SITES` (`:44-58`, `:74-87`).
- `tests/merge-subject-composer-conformance.test.js`: `LOCAL_FENCE_FILES = [LOCAL_SEQUENCE, 'plugin/skills/dispatch/settle-and-merge.md', 'plugin/skills/flow/worktree-merge.md']`, with a comment saying Task 3 narrows it to `[LOCAL_SEQUENCE]`.

- [ ] **Step 6: Verify each pinned literal occurs once, then run green**

Run: `grep -c "After a successful push, run" plugin/skills/wrap-up/auto-merge-short-circuit.md`. Expected: `1`.
Run: `grep -c "Step 4.0b against the pushed merge commit" plugin/skills/wrap-up/auto-merge-short-circuit.md`. Expected: `1`.
Run: `node --test tests/local-merge-sequence-conformance.test.js tests/local-merge-close-run-ordering.test.js tests/merge-subject-composer-conformance.test.js tests/below-floor-parent-close-conformance.test.js tests/local-merge-auto-finish.test.js tests/pr-first-merge.test.js tests/auto-merge-short-circuit-dispatch-call.test.js tests/auto-merge-short-circuit-cant-tell.test.js tests/auto-merge-short-circuit-verdict-backstop.test.js tests/auto-merge-short-circuit-ledger-deletion.test.js tests/archive-run-verb.test.js tests/log-decision-text-file-sites-conformance.test.js tests/skill-fence-guard-shapes.test.js`
Expected: PASS, with every `go-red` assertion inside them exercised.

- [ ] **Step 7: Commit**

```bash
git -C "<worktree>" add plugin/skills/_shared/local-merge-auto-finish.md plugin/skills/wrap-up/auto-merge-short-circuit.md tests/local-merge-sequence-conformance.test.js tests/local-merge-close-run-ordering.test.js tests/merge-subject-composer-conformance.test.js tests/below-floor-parent-close-conformance.test.js
git -C "<worktree>" commit -m "Cite the shared local-merge sequence from auto-finish and the short-circuit — keep their bindings, tag and failure routing" -m "refs #4073"
```

---

### Task 3: Migrate `/dispatch`'s local-merge fallback and `/flow`'s Merge Procedure

**Review risk: high.** This task moves text that `tests/local-merge-close-run-ordering.test.js` (the flow re-protect and owner pins) and `tests/merge-subject-composer-conformance.test.js` pin.

**Files:**
- Modify: `plugin/skills/dispatch/settle-and-merge.md:346`, `:348`, `:357`, `:359-395`, `:411`, `:413-419`
- Modify: `plugin/skills/flow/worktree-merge.md:48`, `:59`, `:70-108`, `:125-132`, `:141`, `:145`
- Modify: `tests/local-merge-sequence-conformance.test.js` (two entries, the flow skip pin, the roster)
- Modify: `tests/local-merge-close-run-ordering.test.js` (last two `SITES` entries out, `CITING_SITES` gains two, the flow owner test, the `logFenceErrors` anchor)
- Modify: `tests/merge-subject-composer-conformance.test.js` (`LOCAL_FENCE_FILES` = `[LOCAL_SEQUENCE]`)
- Test: `tests/merge-verification-gate-conformance.test.js`. Runs unchanged: `:128` needs `Merge-verification gate` in `worktree-merge.md`'s pr-first paragraph, which stays.
- Test: `tests/below-floor-parent-close-conformance.test.js`. The dispatch and flow openers (`'After a successful push, run `_shared/pr-first-merge-post-merge.md`'`, `'6. **Push the base branch once'`) survive verbatim.
- Test: `tests/pr-first-merge.test.js` (`:93-103`, `:126-132`), `tests/dispatch-settle-and-merge-lazy-read.test.js`, `tests/flow-claim-preflight.test.js`, `tests/dispatch-mechanical-enforcement.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js`. Run unchanged.

**Interfaces:**
- Consumes: Task 2's `siteTests`, `CITING_SITES`, `siteReadOrder`.
- Produces: final `SITES` (4 entries) and a roster test, both in the new suite.

- [ ] **Step 1: Write the site pins (failing)**

In `tests/local-merge-sequence-conformance.test.js`, append to `SITES`:

```js
  { label: 'settle-and-merge.md', file: 'plugin/skills/dispatch/settle-and-merge.md', deltas: {
    'two-issue composer call': '`{issues}` = `{issue} {second-issue}`',
    'tag auto-merge': '`{tag}` = `auto-merge`',
    'integration-branch resolution': 'node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values integration-branch',
    'remote-show fallback': "git remote show origin | sed -n '/HEAD branch/s/.*: //p'",
    'group worktree': '`{worktree-path}` = `{group-worktree}`',
    're-stamp output logged': 'log any other line it prints to `{run-dir}/decisions.md`',
  } },
  { label: 'worktree-merge.md', file: 'plugin/skills/flow/worktree-merge.md', deltas: {
    'no tag': '`{tag}` — none: drop `--tag {tag}`',
    'two-issue composer call': '`{issues}` = `{issue} {second-issue}`',
    'no-record branch': "A branch with no record drops the sequence's composer line",
    'push once': '6. **Push the base branch once',
    'owner-preserving re-protect': 'env -u CLAUDE_CODE_SESSION_ID node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}" "{worktree-path}"',
  } },
```

Add:

```js
test("worktree-merge.md: a composer failure skips the branch and continues (AC3)", () => {
  const SKIP = 'skip this branch, and continue with the next one';
  const bullet = (t) => t.split('\n').find((l) => l.trimStart().startsWith('- **The composer failed**'));
  const live = read('plugin/skills/flow/worktree-merge.md');
  assert.ok(bullet(live), 'composer-failed bullet missing');
  assert.ok(bullet(live).includes(SKIP));
  const doctored = live.replace(SKIP, 'stop the reconciliation');
  assert.notEqual(doctored, live);
  assert.ok(!bullet(doctored).includes(SKIP), 'go-red: an aborting composer bullet must fail');
});

// Roster, both directions: every plugin/skills file citing the sequence is a SITES entry or a MENTIONS
// entry (a file that names the sequence without running it), and every entry still cites it.
// Task 4 adds the two mention-only files its sweep creates; an entry that stops citing fails with "shrink the list".
const MENTIONS = new Map();
function citers(root) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md') && collapse(readText(p)).includes(CITATION)) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
  } };
  walk(root);
  return out.sort();
}
test('the SITES roster is exactly the files citing the sequence', () => {
  assert.equal(SITES.length, 4);
  assert.deepEqual(citers(path.join(ROOT, 'plugin/skills')).filter((f) => f !== SEQUENCE && !MENTIONS.has(f)), SITES.map((s) => s.file).sort());
  for (const m of MENTIONS.keys()) assert.ok(collapse(read(m)).includes(CITATION), `stale MENTIONS entry ${m}: shrink the list`);
});
```

The roster's go-red is the `${site.label}: cites` doctor (an entry that stops citing) together with the citation test, plus a stray-citer proof. In the roster test, call `citers` over a `fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lms-roster-'))` tree holding one `.md` that cites `CITATION`, and assert it returns that one file. Remove the temp tree in `finally`.

In `tests/local-merge-close-run-ordering.test.js`:
- Append to `CITING_SITES`:

```js
  { label: 'settle-and-merge.md', file: 'plugin/skills/dispatch/settle-and-merge.md', readsWorktree: false, closeAnchor: "Run the sequence's Steps 1-4 in order" },
  { label: 'worktree-merge.md', file: 'plugin/skills/flow/worktree-merge.md', readsWorktree: true, closeAnchor: "3. **Close this branch's run" },
```

- Extract the loop's restore body (`:367-385`) into `function assertReprotectRestores(fence, vars, worktreeVar)`, and call it from the loop. Add a flow-only test:

```js
test("worktree-merge.md: its owner-preserving re-protect fence restores the run and keeps its owner", () => {
  const live = readText(path.join(ROOT, 'plugin/skills/flow/worktree-merge.md'));
  const fence = extractFence(live, REPROTECT_NEEDLE);
  const site = { vars: { 'worktree-path': posix(WORKTREE) }, worktreeVar: 'worktree-path' };
  assertReprotectRestores(fence, site.vars, site.worktreeVar);
  assertKeepsOwner(fence, site);
  assert.ok(fence.includes(REPROTECT_OWNER_CLAUSE), 'the fence unsets CLAUDE_CODE_SESSION_ID');
  const mutated = fence.replace(REPROTECT_OWNER_CLAUSE, '');
  assert.notStrictEqual(mutated, fence);
  assert.throws(() => assertKeepsOwner(mutated, site), /re-stamped the reconciler/, 'go-red: a fence that inherits CLAUDE_CODE_SESSION_ID must fail');
});
```

- `logFenceErrors` (`:480-489`): change `fenceIndex(text, REPROTECT_NEEDLE, fenceIndex(text, MERGE_NEEDLE))` to `fenceIndex(text, REPROTECT_NEEDLE)`, and return `['no re-protect fence']` when it is `-1`. Flow no longer has a merge fence.

- [ ] **Step 2: Run and see red**

Run: `node --test tests/local-merge-sequence-conformance.test.js tests/local-merge-close-run-ordering.test.js`
Expected: FAIL. settle-and-merge and worktree-merge fail citation, absence, bindings and deltas. The roster test fails (2 citers vs 4 entries). Both fail `close anchor missing`. The flow composer bullet still passes (its text exists today). The owner test passes, because flow's fence is unchanged.

- [ ] **Step 3: Rewrite `plugin/skills/dispatch/settle-and-merge.md`'s Dispatching-session merge execution**

1. `:346` bullet: replace `They are `bin/compose-subject.js`'s positional arguments below; the composer derives the subject and body itself.` with ``They bind `{issues}` below — the composer's positional arguments; it derives the subject and body itself.``
2. Replace `:348` with: ``The merge runs `_shared/local-merge-sequence.md` — the single-branch local-merge sequence (pre-merge checks, `close-run`, guarded merge, explicit-branch push, re-protect) and why its order is load-bearing — with the bindings and failure routing below.``
3. `:357`: change `which the guard below exists to catch` to `which the sequence's branch guard exists to catch`.
4. Replace `:359-395`, from `**Pre-merge checks — from the main checkout, nothing mutated.**` through `…so no separate carrier commit is needed.`, with the text below. Each paragraph is on one line, as the file's other paragraphs are.

```markdown
**Bindings:** `{base-branch}` = `{integration-branch}`, `{branch}` = the group's branch, `{issues}` = `{issue} {second-issue}` — every group member's issue number, `{tag}` = `auto-merge`, `{run-dir}` = the group's run directory (`{run-dir}` above), `{worktree-path}` = `{group-worktree}`.

Run the sequence's Steps 1-4 in order: Step 1 and Step 3 from the main checkout, Step 2 only once Step 1 passed, Step 4 from inside `{group-worktree}` as its own Bash call. The `[auto-merge]` tag and one `Fixes #{issue}` line per record land on the `--no-ff` merge commit, so no separate carrier commit is needed.
```

5. Keep `:398-409` (the Step 4.0b/4.1 paragraph that below-floor pins, success cleanup, log line, lever paragraph, FYI, and the acceptance-labeling note).
6. Replace `:411` with: ``**If a pre-merge check fails** (the sequence's Step 1 — composer non-zero, a `git merge-tree` conflict or unmergeable ref, or the first guard aborts): nothing was merged and `close-run` has not run — nothing to undo or re-stamp. Log the failure the way that step names it (`pre-check failed: {first stderr line}` when git could not run the pre-check). Park as below.``
7. Replace `:413-419` (paragraph, fence, and the `record-worktree restores…` paragraph) with: ``**If the merge call's guard aborts, `git merge` fails, or the push fails** (the sequence's Steps 3 and 4): take that step's own failure rule — `git merge --abort` only when a merge is in progress, never on a push failure, and never undo the local merge: a human resuming the run needs the merge commit to push it. Then re-protect the run (`close-run` already ran, leaving it unprotected): the sequence's Step 5, with the `{group-worktree}` bound above; log any other line it prints to `{run-dir}/decisions.md` (the run dir may be archived). On a push failure also log the merge commit as unpushed; Steps 4.0b and 4.1 and the success cleanup do not run. Park as below.``

- [ ] **Step 4: Rewrite `plugin/skills/flow/worktree-merge.md`'s local-merge Merge Procedure**

1. Replace `:48` with: ``Two consequences for the sequence below, both stated in `_shared/local-merge-sequence.md`: **`git merge` is not gated**, so the merge runs from the main checkout normally; **`git push` is**, so it runs from inside a linked worktree as its own Bash call. The gate also bites on a merge **conflict**: resolving one means editing files in the main checkout and then committing there, both denied since the main checkout is never a linked worktree. See the conflict branch of the Merge Procedure below and `_shared/git-discipline.md`.``
2. Replace `:59` (`For each completed branch (in order):`) with the two paragraphs below. Each is on one line. The Bindings paragraph comes before step 1, so its `{run-dir}`/`{worktree-path}` values point forward to step 1.

```markdown
For each completed branch (in order), run `_shared/local-merge-sequence.md`'s Steps 1-3 — the single-branch local-merge sequence and why its order is load-bearing; read it before step 1 — with the bindings below and this file's own routing at each step, then its Step 4 once after the loop (step 6 below).

**Bindings**, per branch: `{base-branch}` = the base branch being reconciled into, `{branch}` = this branch, `{issues}` = `{issue} {second-issue}` — one per record, for record-derived runs (any materialized file under `{run-dir}/work/` on the branch carries a `record:` field in its header — see `materialize.md`; one closing line per issue, per "Close-via-merge" in `_shared/issue-claims.md`), `{tag}` — none: drop `--tag {tag}` from the sequence's composer line, `{run-dir}` = the run directory step 1 finds, `{worktree-path}` = the worktree step 1 reads. A branch with no record drops the sequence's composer line and its merge's `-F "{subject-dir}/message.txt"`.
```

3. Keep step 1 (`:61-68`) verbatim. Its fence carries the `run-state.json` read that `tests/local-merge-close-run-ordering.test.js:499` executes.
4. Replace step 2 (`:70-86`) with:

```markdown
2. **Pre-merge checks** — the sequence's Step 1, from the main checkout. The issues close when step 6 pushes the base branch to the default remote branch.

   Nothing is closed yet, so every way that step stops leaves the run exactly as it was:
   - **The branch guard aborted** — stop the reconciliation; the checkout moved underneath it. Then run step 6 for the branches already merged (push, or re-protect on push failure).
   - **The composer failed** (nothing merged): record the composer's stderr, skip this branch, and continue with the next one — the sequence's Step 1 says whether it is a shaping defect to fix on the record or a policy or invocation fault.
   - **A predicted conflict** — a `CONFLICT` line on `git merge-tree`'s stdout: go to step 5. When the pre-check could not run (the sequence's Step 1 tells the two apart), record it and skip this branch.
```

5. Replace step 3 (`:88-94`) with: ``3. **Close this branch's run — only now, once its pre-merge checks passed** — the sequence's Step 2, with this branch's `{run-dir}`.``
6. Replace step 4's head and fence (`:96-104`) with ``4. **Merge** — the sequence's Step 3, from the main checkout. Its guard repeats step 2's check as the race backstop.``, followed by a blank line. Keep the three bullets `:106-108` **verbatim**: `REPROTECT_SITES` and the AC3 mutation strings pin them.
7. Step 5 (`:125-132`), in-place edits only:
   - `run step 3's fence for it` → `run step 3 for it`
   - `then close it with step 3's fence,` → `then close it with step 3,`
   - `Re-run step 4's fence and, on the conflict,` → `Re-run step 4's merge (the sequence's Step 3) and, on the conflict,`
   - `re-run step 4's merge (`git merge --no-ff {branch} -F "{subject-dir}/message.txt"`) there` → ``re-run the sequence's Step 3 `git merge` line there, without its guard``
   - `(`[IL-05]`; same shape as the precedent in `dispatch/settle-and-merge.md`'s local-merge fallback)` → ``(`[IL-05]`; the same guard as `_shared/local-merge-sequence.md`'s)``
   - Keep the `git branch --show-current | grep -qxF '{base-branch}' && git merge --ff-only <sha>` fence (D7).
8. Step 6 (`:141`): replace `— from inside a linked worktree (the `worktree-always` gate) and as its own Bash call: `git -C "{worktree-path}" push origin {base-branch}`, with any reconciled branch's worktree that still exists.` with ``— the sequence's Step 4, once, with `{worktree-path}` = any reconciled branch's worktree that still exists.`` Keep the rest of the line verbatim: `**On push failure**`, `re-protect every run step 3 closed`, Step 4.0b, and Step 4.1 with `--ref {integration-branch}`.
9. `### Re-protect` (`:145`): replace `re-stamp that branch's run with the `{worktree-path}` step 1 read (`run-state.json` no longer holds it), one Bash call per run:` with ``re-stamp that branch's run — `_shared/local-merge-sequence.md` Step 5 — with the `{worktree-path}` step 1 read (`run-state.json` no longer holds it), one Bash call per run, keeping the run's original owner:`` Keep the fence, the `env -u` paragraph and the log fence verbatim.

- [ ] **Step 5: Narrow the re-pointed suites to the shared file**

- `tests/local-merge-close-run-ordering.test.js`: delete the `settle-and-merge.md` and `worktree-merge.md` entries from `SITES`. Only `local-merge-sequence.md` remains. Update the header line `One SITES entry per procedure; a new site is data only.` to `SITES holds the one procedure, _shared/local-merge-sequence.md (#4073); CITING_SITES holds its callers' read-order anchors.`
- `tests/merge-subject-composer-conformance.test.js`: `LOCAL_FENCE_FILES = [LOCAL_SEQUENCE]`. Remove the "narrowed by Task 3" comment.

- [ ] **Step 6: Run green**

Run: `node --test tests/local-merge-sequence-conformance.test.js tests/local-merge-close-run-ordering.test.js tests/merge-subject-composer-conformance.test.js tests/below-floor-parent-close-conformance.test.js tests/merge-verification-gate-conformance.test.js tests/pr-first-merge.test.js tests/dispatch-settle-and-merge-lazy-read.test.js tests/flow-claim-preflight.test.js tests/dispatch-mechanical-enforcement.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/skill-fence-guard-shapes.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C "<worktree>" add plugin/skills/dispatch/settle-and-merge.md plugin/skills/flow/worktree-merge.md tests/local-merge-sequence-conformance.test.js tests/local-merge-close-run-ordering.test.js tests/merge-subject-composer-conformance.test.js
git -C "<worktree>" commit -m "Cite the shared local-merge sequence from dispatch and flow — keep integration-branch resolution, skip-and-continue and owner-preserving re-protect" -m "refs #4073"
```

---

### Task 4: Register the edges, sweep retired restatements, prove AC2, run the full suite

**Files:**
- Modify: `docs/skill-graph.md` (new row after `:263`, the `_shared/express-lane.md` row in `## dispatch`; rewrite `:705`; target cell of `:590`)
- Modify: `docs/plugin-structure.md:129`
- Modify: `docs/journeys/merge-a-record-with-a-conventional-subject-2251.md:2-19` (frontmatter `files:`), `:26`
- Modify: `docs/journeys/finish-a-local-merge-run-without-a-human.md:2-9` (frontmatter `files:`)
- Modify: `plugin/skills/_shared/policy-schema.md:139`
- Modify: `plugin/skills/_shared/integration-model.md:54`
- Modify: `plugin/bin/lib/compose-subject.js:49-54` (comment only)
- Modify: `plugin/bin/lib/release/subject.js:2-5` (comment only)
- Modify: `tests/local-merge-sequence-conformance.test.js` (skill-graph and plugin-structure registration pins)
- Waived `docs/decisions/0025-merge-subject-scope-is-repo-policy-resolved-in-the-composer.md`: a point-in-time decision record. Its "four local-merge fences" was true when written.
- Modify: `.claude/skills/driver-skill-outcome-taxonomy/SKILL.md:96` — the `close-run` row restates the retired D5 rationale ("so the main-checkout merge is not denied") and says the three local-merge procedures are pinned by `tests/local-merge-close-run-ordering.test.js`, which after Task 3 pins only the shared file (Step 4.7 below)
- Modify: `docs/plugin-structure.md:64` — the `compose-subject.js` row's "every merge site in … calls the CLI" list (Step 3 below)
- Waived `.claude/skills/skill-prose-conformance-tests/SKILL.md`, `.claude/skills/merge-shape-landed-proof/SKILL.md`: their citations of `tests/local-merge-close-run-ordering.test.js`'s `makeRepo()` and of `local-merge-auto-finish.md` stay true (`makeRepo` is unchanged, and the file still exists and still owns its outcomes).

**Interfaces:**
- Consumes: the final file set from Tasks 1-3.

- [ ] **Step 1: Write the registration pins (failing)**

Append to `tests/local-merge-sequence-conformance.test.js`:

```js
test('docs register the new _shared file (AC5)', () => {
  const graph = readText(path.join(ROOT, 'docs/skill-graph.md'));
  const row = graph.split('\n').find((l) => l.startsWith('| `_shared/local-merge-sequence.md` |'));
  assert.ok(row, 'skill-graph.md has no row for _shared/local-merge-sequence.md');
  for (const s of ['/flow', '/wrap-up', 'local-merge-auto-finish.md', 'auto-merge-short-circuit.md', 'worktree-merge.md']) assert.ok(row.includes(s), `row names ${s}`);
  const autoFinish = graph.split('\n').find((l) => l.startsWith('| `_shared/local-merge-auto-finish.md` |'));
  assert.ok(autoFinish.includes('`_shared/local-merge-sequence.md`'), 'the auto-finish row cites the sequence');
  assert.ok(!collapse(autoFinish).includes("Reuses `wrap-up/auto-merge-short-circuit.md`'s own local-merge git mechanics"), 'the retired reuse clause is gone');
  const structure = readText(path.join(ROOT, 'docs/plugin-structure.md'));
  const shared = structure.split('\n').find((l) => l.startsWith('| _shared |'));
  assert.ok(shared.split(' | ')[1].includes('local-merge-sequence.md'), 'plugin-structure.md curated _shared row lists it');
});
```

Go-red, in the same test: `graph.replace('| `_shared/local-merge-sequence.md` |', '| `_shared/zzz-4073.md` |')` makes the row lookup return `undefined`. Assert that with `assert.equal(…find(…), undefined)`.

Also, in the same file, replace Task 3's `const MENTIONS = new Map();` with the two mention-only citers Step 4 creates. Each names the sequence in a consumer column and runs nothing. Seeing the roster go red here, before Step 4, is the stale-check's own go-red proof:

```js
const MENTIONS = new Map([
  ['plugin/skills/_shared/policy-schema.md', 'commit-scope row names the composer call site; runs nothing'],
  ['plugin/skills/_shared/integration-model.md', 'consumer table names the local-merge path; runs nothing'],
]);
```

Run: `node --test tests/local-merge-sequence-conformance.test.js`. Expected: FAIL. There is no skill-graph row, and the roster's stale-check fails "shrink the list" for both `MENTIONS` entries until Step 4 adds the citations.

- [ ] **Step 2: `docs/skill-graph.md`**

1. Insert after the `_shared/express-lane.md` row (`:263`). One line, no `|` inside cells:

```markdown
| `_shared/local-merge-sequence.md` | Since #4073, the Dispatching-session merge execution (local-merge fallback) runs this file's single-branch `local-merge` sequence — branch guard, `bin/compose-subject.js` and `git merge-tree` pre-merge checks, `close-run` as its own Bash call, guarded `--no-ff` merge, explicit-branch-name push from the group's worktree, `record-worktree` re-protect — binding `{issues}` to the group's issue numbers, `{tag}` to `auto-merge` and `{worktree-path}` to `{group-worktree}`, and keeps only its integration-branch resolution and `pending-review` parking. Shared with `/flow` (`worktree-merge.md`'s Merge Procedure, which loops Steps 1-3 per branch, pushes once, skips a branch whose composer fails and continues, and re-protects under `env -u CLAUDE_CODE_SESSION_ID`) and `/wrap-up` (`auto-merge-short-circuit.md`'s local-merge branch, `{tag}` per `manifesto-authorized-merge.md` and a console fallback on failure; and `_shared/local-merge-auto-finish.md`, `{tag}` = `auto-finish`, which runs its merged-result verification between the merge and the push and parks to `pending-review`) — owned here as the alphabetically-first of the three citing skills. The file recognizes failures and never routes them; `pr-first` merges never reach it (`_shared/pr-first-merge.md`). `tests/local-merge-sequence-conformance.test.js` pins the citations, the absence of any inline copy, and each caller's delta. |
```

2. `:705`: replace `Reuses `wrap-up/auto-merge-short-circuit.md`'s own local-merge git mechanics (worktree-path/branch resolution, the branch guard, composer and `git merge-tree` pre-checks, then close-run, explicit-branch-name push, and a `record-worktree` re-stamp when a park follows close-run) through a different, ungated precondition, and cites` with ``Runs `_shared/local-merge-sequence.md`'s single-branch sequence (the branch guard, composer and `git merge-tree` pre-checks, then `close-run`, the guarded merge, explicit-branch-name push, and a `record-worktree` re-protect when a park follows `close-run`) through a different, ungated precondition from `wrap-up/auto-merge-short-circuit.md`'s, binding `{tag}` to `auto-finish` and running its merged-result verification between the merge and the push; it resolves the worktree path and feature branch itself, and cites``.
3. `:590` target cell: replace `` (via `_shared/pr-first-merge.md`, `_shared/local-merge-auto-finish.md`, `wrap-up/auto-merge-short-circuit.md`, `dispatch/settle-and-merge.md`, `flow/worktree-merge.md`) `` with `` (via `_shared/pr-first-merge.md` and `_shared/local-merge-sequence.md`, which `_shared/local-merge-auto-finish.md`, `wrap-up/auto-merge-short-circuit.md`, `dispatch/settle-and-merge.md` and `flow/worktree-merge.md` run) ``.

- [ ] **Step 3: `docs/plugin-structure.md:64` and `:130`** (line numbers at the post-#4609 tree; re-locate by the quoted text)

At `:64` (the `plugin/bin/lib/compose-subject.js` row), replace `every merge site in _shared/pr-first-merge.md, _shared/local-merge-auto-finish.md, wrap-up/auto-merge-short-circuit.md, dispatch/settle-and-merge.md and flow/worktree-merge.md calls the CLI` with `every merge site in _shared/pr-first-merge.md and _shared/local-merge-sequence.md (which _shared/local-merge-auto-finish.md, wrap-up/auto-merge-short-circuit.md, dispatch/settle-and-merge.md and flow/worktree-merge.md run) calls the CLI`.

At `:130`, in cell 2, append `, local-merge-sequence.md` after `express-lane.md`. At the end of cell 3, before the closing ` |`, append: `` local-merge-sequence.md (#4073): the single-branch `local-merge` finish — branch guard, `compose-subject.js` + `git merge-tree` pre-merge checks, `close-run` as its own Bash call, guarded `--no-ff` merge, explicit-branch push, `record-worktree` re-protect — under one placeholder vocabulary; it recognizes failures and never routes them, and each caller (`local-merge-auto-finish.md`, `wrap-up/auto-merge-short-circuit.md`, `dispatch/settle-and-merge.md`, `flow/worktree-merge.md`) keeps its bindings and failure routing; consumer edges in `docs/skill-graph.md`. `` No `|` inside the text.

- [ ] **Step 4: Retirement sweep (shipped prose, code comments, journeys)**

1. `plugin/skills/_shared/policy-schema.md:142` (post-#4609; re-locate by the quoted text): replace `(`_shared/pr-first-merge.md` Step 3 and the four local-merge fences)` with ``(`_shared/pr-first-merge.md` Step 3 and `_shared/local-merge-sequence.md` Step 1)``.
2. `plugin/skills/_shared/integration-model.md:54`: replace `vs. each file's own retained local-checkout merge procedure` with ``vs. `_shared/local-merge-sequence.md`'s local-checkout merge sequence, which each file runs with its own bindings``.
3. `plugin/bin/lib/compose-subject.js:49-54`: rewrite the comment's site list to `site (pr-first-merge.md's two squash sites, and the one local-merge fence in _shared/local-merge-sequence.md — merge-subject-composer-conformance.test.js's LOCAL_SEQUENCE — that four callers run)`. Change `six merge-site fences would need editing` to `three merge-site fences would need editing`. Comment only.
4. `plugin/bin/lib/release/subject.js:2-5`: replace `and the four local-merge `git merge --no-ff -m` sites (settle-and-merge.md, auto-merge-short-circuit.md, local-merge-auto-finish.md, worktree-merge.md)` with `and the local-merge `git merge --no-ff -F` fence in _shared/local-merge-sequence.md (run by settle-and-merge.md, auto-merge-short-circuit.md, local-merge-auto-finish.md, worktree-merge.md)`. The old `-m` was already stale. Comment only.
5. `docs/journeys/merge-a-record-with-a-conventional-subject-2251.md`: add `  - plugin/skills/_shared/local-merge-sequence.md` to `files:`. At `:26`, replace `or one of the four `git merge --no-ff` fences (`_shared/local-merge-auto-finish.md`, `wrap-up/auto-merge-short-circuit.md`, `dispatch/settle-and-merge.md`, `flow/worktree-merge.md`)` with ``or `_shared/local-merge-sequence.md` Step 3's `git merge --no-ff` fence, which `_shared/local-merge-auto-finish.md`, `wrap-up/auto-merge-short-circuit.md`, `dispatch/settle-and-merge.md` and `flow/worktree-merge.md` all run``.
6. `docs/journeys/finish-a-local-merge-run-without-a-human.md`: add `  - plugin/skills/_shared/local-merge-sequence.md` to `files:`.
7. `.claude/skills/driver-skill-outcome-taxonomy/SKILL.md:96`: in the first cell replace `clears its worktree assignment so the main-checkout merge is not denied` with `clears its worktree assignment and E1 protection`; in the second cell replace `The three local-merge procedures (`plugin/skills/wrap-up/auto-merge-short-circuit.md`, `plugin/skills/dispatch/settle-and-merge.md`, `plugin/skills/_shared/local-merge-auto-finish.md`) do this, pinned by `tests/local-merge-close-run-ordering.test.js` (#3762)` with ``The local-merge callers do this by running `plugin/skills/_shared/local-merge-sequence.md`, whose ordering `tests/local-merge-close-run-ordering.test.js` pins (#3762, #4073)``.
8. Sweep for anything left (expect no hits outside this plan file, the shared file, ADR 0025 and `.claude/skills/`):

Run: `grep -rnE "four local-merge|restate the commands|Reuses the git mechanics|same two-call shape|identical call\)|retained local-checkout merge procedure|local-merge push step states" plugin docs README.md`
Expected: hits only in `docs/decisions/0025-*.md` (waived), `docs/superpowers/plans/` (this run's own plan, deleted at wrap-up), and `plugin/skills/init/update-mode.md:477` ("this identical call)" — an unrelated sentence the `identical call\)` alternative also matches; leave it).

Run: `grep -rn "git merge-tree --write-tree --name-only" plugin/skills`
Expected: exactly one hit, `plugin/skills/_shared/local-merge-sequence.md`.

- [ ] **Step 5: AC2 evidence — `git grep` on `origin/main`, then on the branch**

Run: `git -C "<worktree>" fetch origin main`
Run: `git -C "<worktree>" grep -c "grep -qxF" origin/main -- plugin/skills/_shared/local-merge-auto-finish.md plugin/skills/wrap-up/auto-merge-short-circuit.md plugin/skills/dispatch/settle-and-merge.md plugin/skills/flow/worktree-merge.md`
Expected: `…local-merge-auto-finish.md:2`, `…auto-merge-short-circuit.md:2`, `…settle-and-merge.md:2`, `…worktree-merge.md:3` (seen to match).
Run: `git -C "<worktree>" grep -c "grep -qxF" HEAD -- plugin/skills/_shared/local-merge-auto-finish.md plugin/skills/wrap-up/auto-merge-short-circuit.md plugin/skills/dispatch/settle-and-merge.md plugin/skills/flow/worktree-merge.md`
Expected: only `…worktree-merge.md:1`, which is §5's scratch fast-forward (D7), not the guard block. The task report must say AC2's literal `git grep -c "grep -qxF"` command is NOT fully met (one hit remains, a different construct) and cite D7 plus the guard-block-form evidence below — never claim AC2's literal command is satisfied. The controller ledgers this as an SDD ruling.
Run: `git -C "<worktree>" grep -c -F "if ! git branch --show-current | grep -qxF" HEAD -- plugin/skills/_shared/local-merge-auto-finish.md plugin/skills/wrap-up/auto-merge-short-circuit.md plugin/skills/dispatch/settle-and-merge.md plugin/skills/flow/worktree-merge.md`
Expected: no output (exit 1): no inline guard block in any site. Quote both outputs in the task report.

- [ ] **Step 6: Run the targeted suites, then the full suite**

Run: `node --test tests/local-merge-sequence-conformance.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js tests/policy-schema-metadata.test.js tests/integration-model.test.js tests/bin-lib/compose-subject.test.js`
Expected: PASS.
Run: `npm test > "<scratchpad>/npm-test-4073.txt" 2>&1`, then `echo exit=$?` in the same call, then `tail -15 "<scratchpad>/npm-test-4073.txt"`.
Expected: `exit=0`, `# fail 0`. A varying failure count is load. Re-run only the failing file in isolation before concluding anything.

- [ ] **Step 7: Commit**

```bash
git -C "<worktree>" add docs/skill-graph.md docs/plugin-structure.md docs/journeys/merge-a-record-with-a-conventional-subject-2251.md docs/journeys/finish-a-local-merge-run-without-a-human.md plugin/skills/_shared/policy-schema.md plugin/skills/_shared/integration-model.md plugin/bin/lib/compose-subject.js plugin/bin/lib/release/subject.js tests/local-merge-sequence-conformance.test.js
git -C "<worktree>" commit -m "Register the shared local-merge sequence — skill-graph edges, plugin-structure listing, and retired four-site restatements swept" -m "refs #4073"
```

---

## Self-review

### Plan review (opus, verdict amend) — applied

Simulated against copies of every touched file at the post-#4609 tree (634/636 green; the two reds below). Applied:
- **high** — Task 2 Step 4.1's opener dropped `before merging, clear this run's worktree`, which `tests/auto-merge-short-circuit-verdict-backstop.test.js:116-119` pins → the phrase is kept in the new opener (controller checked the pin regex matches the planned text).
- **medium** — `.claude/skills/driver-skill-outcome-taxonomy/SKILL.md:96` restated D5's retired rationale and the old pin claim → moved from Waived to Modify (Task 4 Step 4.7).
- **low** — `docs/plugin-structure.md:64`'s merge-site list added to the sweep (Task 4 Step 3); the `identical call\)` sweep hit at `plugin/skills/init/update-mode.md:477` named as expected; the wrapped `local-merge-auto-finish.md:69-70` anchor given in wrapped form; post-#4609 line numbers (`policy-schema.md:142`, `plugin-structure.md:130`); Task 1 Step 3's Expected now names the sweep test that is red until Step 4; AC2's literal command reported as not fully met (D7, an SDD ruling); AC4's never-chained half now also pinned in `local-merge-close-run-ordering.test.js` (Task 1 Step 2).
- Confirmed: D5 (the hook never gates `git merge`, `git-command.js:1003/1012/1117` — only a wrong rationale is retired), D1 (needed), D2-D4 (AC1/AC2 intact), Check C false positives, byte rails (`policy-schema.md` +13 B → 369 B headroom; the new shared file is ~8.6 KB, not ~6 KB).

### Spec coverage

| Spec item | Where |
|---|---|
| Deliverable 1: one canonical file, one vocabulary (guard, pre-merge, `close-run` ordering as its own call, guarded merge, explicit push, re-protect) | Task 1 Step 4 (full content). Vocabulary pinned in Task 1 Step 1. |
| Deliverable 2: four sites cite it and keep their deltas | Task 2 Steps 3-4 (auto-finish, short-circuit), Task 3 Steps 3-4 (settle-and-merge, worktree-merge) |
| Deliverable 3: skill-graph edges, the auto-finish row rewritten, plugin-structure listing | Task 4 Steps 2-3 |
| Deliverable 4: every pin on a moved command re-pointed | Task 1 Step 2 and Task 2/3 Step 5 (close-run-ordering, merge-subject). Task 2 Step 1 (below-floor). See the Pins migrated table. |
| Deliverable 5: a conformance test that sites cite the file and carry no inline block | Task 2 Step 1 (`siteTests`: citation, `inlineBlockParts`), finished by Task 3's roster |
| AC1: the shared file holds the full sequence once | Task 1 `FACTS` (each fence exactly once). Task 2 anchor test (`inlineBlockParts(SEQUENCE)` = all four). Task 4 Step 4 grep (one `merge-tree` hit). |
| AC2: `git grep` on `origin/main` matches, on the branch finds no guard block; each site cites | Task 4 Step 5 (with D7's caveat). Task 2/3 citation tests. |
| AC3: deltas survive (flow skip-and-continue, dispatch two-issue and integration-branch resolution, `--tag auto-finish`, the short-circuit's `{tag}`) | Task 2/3 `deltas` maps plus Task 3's flow composer-bullet test |
| AC4: `close-run` ordering stated once, pinned in close-run-ordering | Task 1 (`SITES` shared entry: ordering, permutation go-red, pre-merge fence free of close-run). Never-chained: Task 1 Step 2's `#4073 AC4` test in close-run-ordering (with its doctored go-red), plus the new suite's `FACTS`. Sites carry no close-run call: Task 2/3 `BLOCK`. |
| AC5: skill-graph edges and plugin-structure listing | Task 4 Steps 1-3 |
| AC6: `npm test` passes | Task 4 Step 6 |
| Gotcha #4252 (keep the composer flags as today) | Global Constraints. `PRE_MERGE[1]` pins the exact composer line, without `--keep-open`. |
| Gotcha: single-branch, no baked-in abort | Task 1 `CALLER_OUTCOMES` absence and the `single-branch loop` / `routing stays with the caller` facts |
| Gotcha: bundle read path | D8 (no bundle change; direct citations) |

### Placeholder scan

`<worktree>` and `<scratchpad>` stand for the run's absolute worktree path and scratchpad directory, resolved by the executor. They are not plan gaps. Line numbers are those of the tree at `ccde9d42e`. Re-locate each edit by its quoted text if an upstream merge shifts them. No "TBD" or "handle edge cases" remains.

### Placeholder-name consistency

The shared vocabulary is `{base-branch}`, `{branch}`, `{issues}`, `{tag}`, `{run-dir}`, `{subject-dir}` and `{worktree-path}`. It is used identically in Task 1's file, `VOCAB`/`BOUND`, the close-run-ordering `vars`, every site's `**Bindings**` paragraph, the skill-graph row, and the plugin-structure text. Site-local names appear only on the right-hand side of a binding (`{feature-branch}`, `{integration-branch}`, `{group-worktree}`, `{issue} {second-issue}`). The `closeAnchor` literals (`4. **Close the run**`, `Run the sequence's Steps 1-4 in order`, `3. **Close this branch's run`) and every `deltas` literal are copied from the replacement text in Tasks 2-3.

### Pins migrated

| Old pin (file:line, asserted string) | Disposition |
|---|---|
| `local-merge-close-run-ordering.test.js:43-104` `SITES` ×4 | Re-pointed. The `local-merge-sequence.md` entry is added in Task 1, and the four site entries are removed in Tasks 2-3. |
| `…:293` ordering P<C<M<R, per site | Re-pointed at the shared file (sequence entry) |
| `…:297` permutation go-red, per site | Re-pointed at the shared file |
| `…:306` worktree read precedes close-run (`readsWorktree`) | Re-pointed to `siteReadOrder` per caller (`closeAnchor`), with anchor, moved-read and removed-read go-reds |
| `…:319` CRLF fences and ordering | Re-pointed at the shared file |
| `…:326` pre-merge fence has no close-run or merge | Re-pointed at the shared file |
| `…:332` pre-merge fence extract-and-run (guard, conflict, composer and unknown-ref red cases) | Re-pointed at the shared file (`issues: '1 2'`) |
| `…:366` re-protect fence restores, plus flow `preservesOwner` | Restore re-pointed at the shared file. Flow's owner pin moved to a flow-only test via `assertReprotectRestores` (Task 3). |
| `…:396` fallback logs the re-stamp (`logNeedle` per site) | Shared window re-pointed (`any other line`). Per-site log clause moved to the new suite's `re-stamp output logged` deltas (auto-finish, short-circuit, settle-and-merge). Flow keeps its own via `…:450`/`…:491`. |
| `…:217` frozen `PRE_CHANGE` go-red | Kept |
| `…:417` AC2.1 Skip/Abort keep run | Kept (flow bullets verbatim) |
| `…:450` AC3 `### Re-protect` triggers and failure sites | Kept (bullets and section verbatim) |
| `…:471` Skip never closed | Kept |
| `…:491` log fence via `--text-file` | Kept. The anchor changes from after-merge-fence to the re-protect fence (Task 3). |
| `…:499` run-state read takes `{run-dir}` as argv | Kept (flow step 1 verbatim) |
| `…:514` "Not fixed here; there is no" sweep | Kept |
| `merge-subject-composer-conformance.test.js:127-140` `LOCAL_COMPOSER_CALL`, `LOCAL_MERGE_FORM`, `{subject-dir}` pointer ×4 | Re-pointed at `LOCAL_SEQUENCE` (`LOCAL_FENCE_FILES`), with a doctored-`--range` go-red |
| `…:127-140` `STALE_LOCAL_FORM`, `eval`, `SUBJECT_EXPORTS=`, `--shell`, `$SUBJECT_TITLE` absence ×4 | Kept over `[LOCAL_SEQUENCE, ...LOCAL_SITES]` |
| `…:142` frozen pre-change forms go-red | Kept |
| `…:191-198` sweep reaches the named files | Kept, with `LOCAL_SEQUENCE` added |
| `below-floor-parent-close-conformance.test.js:395` short-circuit opener `The explicit `--no-ff` guarantees a real merge commit exists even when the` | Retargeted to `After a successful push, run `_shared/pr-first-merge-post-merge.md``, with a go-red (Task 2) |
| `…:394` settle-and-merge opener, `…:396` flow opener, `…:408-412` auto-finish step 7 | Kept (paragraphs verbatim) |
| `local-merge-auto-finish.test.js:21-118` (all) | Kept. They pin Precondition, Default policy, `never attempt resolution`, the log outcomes, Interactive, Section C, the console, the contract and the graph, none of which move. |
| `merge-verification-gate-conformance.test.js:128` `Merge-verification gate` in worktree-merge.md | Kept (pr-first paragraph) |
| `pr-first-merge.test.js:114` short-circuit `require('$RUN_DIR/run-state.json').worktree` within 4000 chars | Kept (read fence stays right after the new local-merge opener) |
| `auto-merge-short-circuit-dispatch-call.test.js:106` AC7.1 guard abort → console fallback | Kept (failure paragraph wording preserved, within 200 chars) |
| `auto-merge-short-circuit-cant-tell.test.js:117` `--fyi` count ≥2 with sections | Kept (FYI sentence verbatim, on one line) |
| `log-decision-text-file-sites-conformance.test.js:37-38` L1/L2 | Kept (Park and merged log templates unchanged, D2) |
| `skill-fence-guard-shapes.test.js` live sweep | Kept. The new file's fences are byte-shapes the sweep already accepts. |
| `integration-model.test.js:227` consumer sweep | Kept. The new file cites `_shared/integration-model.md` (Task 1 pin). |
