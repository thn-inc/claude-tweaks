# Flow Multi-Spec Merge-State Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/flow`'s multi-spec pre-flight detects a target whose body demands that an in-run `blocked-by` prerequisite already be merged into the integration branch, and resolves it without asking: the target and its in-run transitive dependents are split out of the run before claiming, logged, and given a re-run command.

**Architecture:** A new pure module `plugin/bin/lib/preflight-records/merge-gate.js` scans each fetched record body's `## Deliverables` / `## Prerequisites` lines for a strict integration-branch merge-state demand that names one of that record's own in-run `blockedBy` prerequisites, then closes the deferred set over in-run dependents. `bin/preflight-records.js` exposes it behind an additive `--merge-gate` flag, so that every existing caller's envelope stays byte-identical (the claim step's own call passes non-run open issues, so the split can't be computed implicitly). A new sub-file `plugin/skills/flow/multispec-merge-gate.md` records the decision and the procedure. `multi-spec.md`'s Validation list and `flow/SKILL.md`'s Pre-flight enrichments each gain one pointer line.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/archive/2026-10-16T172750-spec-2775-2733-2677/spec-2733/work/2733-spec.md` (record #2733)

## Global Constraints

- Under default `auto`, the resolution makes no `AskUserQuestion` call (spec AC 2). The split is derivable from record text, so it is not asked in any mode.
- A documented decision exists in `multi-spec.md` (via its sub-file) for this case (spec AC 1).
- `npm test` passes (spec AC 3).
- `plugin/skills/flow/multi-spec.md` stays ≤ 20480 bytes (`tests/run-dir-timestamp-utc.test.js` `#724` pin). It is 18783 bytes at base, so add only the pointer line.
- `plugin/skills/flow/SKILL.md` is 43199 bytes against the 46080-byte (45 KB) per-file ceiling, so add one bullet only (≤ 320 bytes).
- Without `--merge-gate`, the `preflight-records.js` envelope stays exactly `{records, overlapGroups, workLinks}` for every existing caller (dispatch queue pull, `/help`, the flow claim-step overlap check).
- Signal regex, verbatim: `/\bactually\s+merged\b|\bmerge[sd]?\s+(?:in)?to\s+(?:`?(?:origin\/)?main\b`?|the\s+integration\s+branch\b)/i`.
- Commit messages: `{Verb} {what} — {detail}`, body `refs #2733`, ending `Claude-Session: https://claude.ai/code/session_01VBD5AMkgdrgmr515Fn6fVb`. Never `closes`/`fixes`.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

Waived AC3.1: `npm test` passing is verified by `/claude-tweaks:build` Common Step 5's full-suite `verify.js` run, not by a test step in this plan.

## Evidence (decision basis, from the corpus probe logged in `spec-2733/decisions.md`)

These figures come from 2087 issue bodies:

- **Any line** in Deliverables or Prerequisites naming a ref together with "merged": 75 records. This is noisy: `'MERGED'` state literals, titles like "gated on the merged ceiling", residue-table rows.
- **Merge-requirement verb forms**: 40 records. These are mostly decomposition-family rows ("#620 must be merged first"). The shared branch satisfies them by content, because the prerequisite is built earlier in the same branch.
- **Strict integration-branch merge-state class** (this plan's regex): 6 records, 5 of them genuine after the in-run blocked-by filter. They are #2682 (the incident), #1989, #2466, #530 and #595. The sixth, #1698, is a residue row naming a PR, which can never be an in-run blocker.

## Review Focus

1. A `## Deliverables (Phase 1)`-style heading with trailing text still opens the section. An H3 inside Deliverables does not close it; only the next H2 does.
2. A ref inside a code span (`` `#2670` ``, exactly #2682's shape) still counts.
3. A CRLF body (`\r\n`) still splits into lines, so the strict line is found.
4. A strict line naming a ref that isn't in the record's `blockedBy`, or that is a blocker but not in the run, gates nothing.
5. A dependent of a deferred record is deferred too, even when its own body has no strict line; a non-dependent stays in `kept`.

---

### Task 1: merge-gate module

**Files:**
- Create: `plugin/bin/lib/preflight-records/merge-gate.js`
- Test: `tests/bin-lib/preflight-records/merge-gate.test.js`

**Interfaces:**
- Consumes: the `records` object `buildRecords` returns (`{ "<n>": { blockedBy: number[], … } }`), and `issues: Map<number, {number, body}>`.
- Produces:
  - `MERGE_STATE_RE` (RegExp)
  - `mergeStateDemands(body: string, candidates: number[]) -> Array<{requires: number, line: string}>`
  - `planMergeGateSplit({ issues, records, numbers }) -> { gates: Array<{record: number, requires: number[], line: string}>, deferred: number[], kept: number[], rerun: string|null }`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MERGE_STATE_RE, mergeStateDemands, planMergeGateSplit,
} = require('../../../plugin/bin/lib/preflight-records/merge-gate');

const issue = (number, body) => ({ number, title: `T${number}`, body, labels: [] });
function fixture(entries) {
  const issues = new Map(entries.map(([n, body]) => [n, issue(n, body)]));
  return issues;
}

test('MERGE_STATE_RE: strict integration-branch merge-state forms match; content-satisfiable forms do not', () => {
  for (const s of [
    'confirm `#2670` and `#2681` are actually merged (not merely `CLOSED`)',
    'must be merged to the integration branch before starting',
    'After #1811 merges to `main`, re-confirm',
    'once #12 is merged into main',
    'until it is merged to origin/main',
  ]) assert.match(s, MERGE_STATE_RE, s);
  for (const s of [
    '| #620 | deferral gate contract | must be merged first |',
    'do not start until #533 is merged',
    'Batch ledger drills, gated on the merged ceiling',
    "extend the fallback to recognize `byNumber.state === 'MERGED'`",
    'must be merged into this leaf\'s build base',
  ]) assert.doesNotMatch(s, MERGE_STATE_RE, s);
});

test('mergeStateDemands: only Deliverables/Prerequisites lines, only candidate refs, code-span refs count', () => {
  const body = [
    '## Current State', 'Once #10 is actually merged this matters.',
    '## Deliverables (Phase 1)', '### Sub-heading stays in section',
    '- [ ] confirm `#10` is actually merged before touching anything',
    '- [ ] #11 is actually merged too (not a candidate)',
    '## Gotchas', '- #10 must be merged to the integration branch (outside the section)',
  ].join('\r\n');
  const got = mergeStateDemands(body, [10]);
  assert.deepEqual(got.map((d) => d.requires), [10]);
  assert.match(got[0].line, /confirm `#10` is actually merged/);
});

test('mergeStateDemands: a Prerequisites table row with the strict form gates its named prerequisite', () => {
  const body = ['## Prerequisites', '| Spec | Title | Status |', '|---|---|---|',
    '| #528 | routine-kickoff wrapper skill | must be merged to the integration branch before starting |'].join('\n');
  assert.deepEqual(mergeStateDemands(body, [528, 529]).map((d) => d.requires), [528]);
});

test('AC2.1: planMergeGateSplit: #2682 shape — gated target and its in-run dependent deferred, independent kept, rerun composed', () => {
  const issues = fixture([
    [2670, '## Deliverables\n- [ ] do the thing'],
    [2682, '## Deliverables\n- [ ] confirm `#2670` is actually merged (not merely CLOSED)'],
    [2690, '## Deliverables\n- [ ] builds on #2682'],
    [2700, '## Deliverables\n- [ ] unrelated'],
  ]);
  const records = {
    2670: { blockedBy: [] }, 2682: { blockedBy: [2670] }, 2690: { blockedBy: [2682] }, 2700: { blockedBy: [] },
  };
  const split = planMergeGateSplit({ issues, records, numbers: [2670, 2682, 2690, 2700] });
  assert.deepEqual(split.gates, [{ record: 2682, requires: [2670], line: '- [ ] confirm `#2670` is actually merged (not merely CLOSED)' }]);
  assert.deepEqual(split.deferred, [2682, 2690]);
  assert.deepEqual(split.kept, [2670, 2700]);
  assert.equal(split.rerun, '/claude-tweaks:flow #2682,#2690');
});

test('planMergeGateSplit: generic "must be merged first" decomposition family proceeds — nothing deferred', () => {
  const issues = fixture([
    [620, '## Deliverables\n- [ ] contract'],
    [621, '## Prerequisites\n| #620 | deferral gate contract | must be merged first |'],
  ]);
  const records = { 620: { blockedBy: [] }, 621: { blockedBy: [620] } };
  const split = planMergeGateSplit({ issues, records, numbers: [620, 621] });
  assert.deepEqual(split, { gates: [], deferred: [], kept: [620, 621], rerun: null });
});

test('planMergeGateSplit: strict line naming a blocker NOT in the run, or an in-run record that is NOT a blocker, gates nothing', () => {
  const issues = fixture([
    [1, '## Deliverables\n- [ ] confirm #99 is actually merged'],
    [2, '## Deliverables\n- [ ] confirm #1 is actually merged'],
  ]);
  const records = { 1: { blockedBy: [99] }, 2: { blockedBy: [] } };
  const split = planMergeGateSplit({ issues, records, numbers: [1, 2] });
  assert.deepEqual(split.deferred, []);
  assert.deepEqual(split.kept, [1, 2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/preflight-records/merge-gate.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/preflight-records/merge-gate'"

- [ ] **Step 3: Write minimal implementation**

```js
// bin/lib/preflight-records/merge-gate.js
// Multi-spec merge-state gate (#2733). A target whose own ## Deliverables /
// ## Prerequisites text demands that an in-run blocked-by prerequisite be
// merged into the integration branch can never be satisfied inside one shared
// multi-spec branch — the prerequisite is built there, not merged. Such a
// target and its in-run transitive dependents are split out of the run before
// claiming. Content-satisfiable phrasings ("must be merged first", "until #N
// is merged") deliberately don't match: the shared branch already carries the
// prerequisite's content ahead of the dependent's build. Decision + corpus
// evidence: skills/flow/multispec-merge-gate.md.
'use strict';

const MERGE_STATE_RE = /\bactually\s+merged\b|\bmerge[sd]?\s+(?:in)?to\s+(?:`?(?:origin\/)?main\b`?|the\s+integration\s+branch\b)/i;
const SECTION_RE = /^##\s+(?:Deliverables|Prerequisites)\b/i;
const H2_RE = /^##\s/;
const REF_RE = /#(\d+)\b/g;

// body, candidate prerequisite numbers -> [{requires, line}] — one entry per
// (strict line, candidate ref) pair, in body order, candidates deduped per line.
function mergeStateDemands(body, candidates) {
  const wanted = new Set(candidates);
  const out = [];
  let inSection = false;
  for (const raw of String(body || '').split(/\r?\n/)) {
    if (H2_RE.test(raw)) { inSection = SECTION_RE.test(raw); continue; }
    if (!inSection || !MERGE_STATE_RE.test(raw)) continue;
    const seen = new Set();
    for (const m of raw.matchAll(REF_RE)) {
      const n = Number(m[1]);
      if (wanted.has(n) && !seen.has(n)) { seen.add(n); out.push({ requires: n, line: raw.trim() }); }
    }
  }
  return out;
}

// issues: Map<number, {body}>, records: buildRecords output, numbers: the run's
// targets in run order -> { gates, deferred, kept, rerun }.
function planMergeGateSplit({ issues, records, numbers }) {
  const inRun = new Set(numbers);
  const blockersOf = (n) => ((records[String(n)] || {}).blockedBy || []).filter((b) => inRun.has(b) && b !== n);
  const gates = [];
  for (const n of numbers) {
    const issue = issues.get(n);
    const demands = mergeStateDemands(issue ? issue.body : '', blockersOf(n));
    if (demands.length === 0) continue;
    gates.push({ record: n, requires: [...new Set(demands.map((d) => d.requires))], line: demands[0].line });
  }
  const deferredSet = new Set(gates.map((g) => g.record));
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of numbers) {
      if (!deferredSet.has(n) && blockersOf(n).some((b) => deferredSet.has(b))) { deferredSet.add(n); grew = true; }
    }
  }
  const deferred = numbers.filter((n) => deferredSet.has(n));
  const kept = numbers.filter((n) => !deferredSet.has(n));
  const rerun = deferred.length ? `/claude-tweaks:flow ${deferred.map((n) => `#${n}`).join(',')}` : null;
  return { gates, deferred, kept, rerun };
}

module.exports = { MERGE_STATE_RE, mergeStateDemands, planMergeGateSplit };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/preflight-records/merge-gate.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git -C "$WORKTREE" add plugin/bin/lib/preflight-records/merge-gate.js tests/bin-lib/preflight-records/merge-gate.test.js
git -C "$WORKTREE" commit -F {msg-file}   # "Add merge-state gate module — strict integration-branch merge demand splits a multi-spec target (refs #2733)"
```

### Task 2: `--merge-gate` flag on `preflight-records.js`

**Files:**
- Modify: `plugin/bin/preflight-records.js:1-14` (header comment), the `USAGE` constant, `parseArgs`, and the envelope write at the end of `run`
- Test: `tests/bin-lib/preflight-records/preflight-records.test.js` (append after the existing `(a)` CLI test)
- Modify: `docs/plugin-structure.md:174` (command reference line)

**Interfaces:**
- Consumes: `planMergeGateSplit({ issues, records, numbers })` from Task 1.
- Produces: with `--merge-gate`, the CLI envelope becomes `{records, overlapGroups, workLinks, mergeGate}` with `mergeGate = {gates, deferred, kept, rerun}`. Without the flag the envelope is unchanged.

- [ ] **Step 1: Write the failing test** (append to `tests/bin-lib/preflight-records/preflight-records.test.js`)

```js
test('#2733: --merge-gate adds mergeGate to the envelope; without it the envelope keys are unchanged', () => {
  const runner = (args) => {
    if (isIssueView(args, 2670)) return JSON.stringify(issue({ number: 2670, title: 'P', body: specBody(['a.js']) }));
    if (isIssueView(args, 2682)) return JSON.stringify(issue({ number: 2682, title: 'D', body: `Blocked by #2670\n\n## Deliverables\n- [ ] confirm \`#2670\` is actually merged\n\n${specBody(['b.js'])}` }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const gated = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['2670', '2682', '--merge-gate'], gated.deps), 0);
  const env = JSON.parse(gated.out.join(''));
  assert.deepEqual(env.mergeGate.deferred, [2682]);
  assert.deepEqual(env.mergeGate.kept, [2670]);
  assert.equal(env.mergeGate.rerun, '/claude-tweaks:flow #2682');

  const plain = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['2670', '2682'], plain.deps), 0);
  assert.deepEqual(Object.keys(JSON.parse(plain.out.join(''))).sort(), ['overlapGroups', 'records', 'workLinks']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js`
Expected: FAIL — `--merge-gate` exits 2 with "unknown argument" (or `env.mergeGate` is undefined)

- [ ] **Step 3: Implement**
  - In `parseArgs`, add `mergeGate: false` to the opts literal and a branch `else if (a === '--merge-gate') opts.mergeGate = true;`, in the same style as the existing flag branches.
  - Extend `USAGE` to `'usage: preflight-records.js <n> [<n> ...] [--work-links native|body-text] [--repo owner/name] [--merge-gate] [--help]\n'`. Extend header line 3 to match, and add one header sentence: `--merge-gate (#2733) treats the positional numbers as one /flow run's targets and adds mergeGate {gates, deferred, kept, rerun} (bin/lib/preflight-records/merge-gate.js).`
  - Add `const { planMergeGateSplit } = require('./lib/preflight-records/merge-gate');` beside the existing `preflight` require.
  - Replace the final envelope write with:

```js
  const envelope = { records, overlapGroups, workLinks };
  if (opts.mergeGate) envelope.mergeGate = planMergeGateSplit({ issues, records, numbers });
  deps.stdout(`${JSON.stringify(envelope, null, 2)}\n`);
```

  - In `docs/plugin-structure.md:174`, change the invocation to `... [--repo owner/name] [--merge-gate]` and append: `; --merge-gate (#2733) adds mergeGate {gates, deferred, kept, rerun} — the multi-spec merge-state split`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js tests/bin-lib/preflight-records/merge-gate.test.js`
Expected: PASS, every test

- [ ] **Step 5: Commit** — `Add --merge-gate to preflight-records.js — opt-in mergeGate split in the envelope (refs #2733)`

### Task 3: Decision doc and flow wiring

**Files:**
- Create: `plugin/skills/flow/multispec-merge-gate.md`
- Modify: `plugin/skills/flow/multi-spec.md` (Validation list: add item 4a after item 4; the line starting `4. **Dependency-aware ordering**`)
- Modify: `plugin/skills/flow/SKILL.md` (the `**Pre-flight enrichments (v4.6.4+):**` bullet list, after the `Dependency-aware ordering` bullet)
- Test: `tests/flow-claim-preflight.test.js` (append one test)

**Interfaces:**
- Consumes: the `--merge-gate` envelope from Task 2.
- Produces: the documented decision (spec AC 1) and the runtime procedure flow follows.

- [ ] **Step 1: Write the failing test** (append to `tests/flow-claim-preflight.test.js`; it already defines `read(p)`)

```js
test('AC1.1, AC2.1: multi-spec Validation cites the merge-state gate sub-file, which records a no-ask auto split (#2733)', () => {
  assert.match(read('plugin/skills/flow/multi-spec.md'), /multispec-merge-gate\.md/);
  assert.match(read('plugin/skills/flow/SKILL.md'), /multispec-merge-gate\.md/);
  const gate = read('plugin/skills/flow/multispec-merge-gate.md');
  assert.match(gate, /preflight-records\.js[^\n]*--merge-gate/);
  assert.match(gate, /never calls `AskUserQuestion`/);
  assert.match(gate, /before Step 2\.8/);
  assert.match(gate, /must be merged first/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-claim-preflight.test.js`
Expected: FAIL — ENOENT on `plugin/skills/flow/multispec-merge-gate.md` (or no match in `multi-spec.md`)

- [ ] **Step 3: Write `plugin/skills/flow/multispec-merge-gate.md`** with exactly these sections:

```markdown
# Multi-Spec — Merge-State Gate (#2733)

Loaded by `multi-spec.md`'s Validation step 4a, after dependency-aware ordering and before Step 2.8's claim.

## Decision

A target whose own `## Deliverables` or `## Prerequisites` text demands that one of its **in-run** `blocked-by` prerequisites already be **merged into the integration branch** cannot be satisfied inside a multi-spec run: every spec commits into one shared, unmerged branch, so that prerequisite is built there, never merged, before the dependent's build reads the demand. `/flow` therefore resolves the case itself — it never calls `AskUserQuestion` for it, in any mode — by splitting the target, and every in-run record that transitively depends on it, out of this run. The decision is derivable from record text, which is `_shared/auto-mode-contract.md`'s bar for resolving rather than asking.

Not split: the generic content-dependency phrasings — "must be merged first", "until #N is merged", "merged into this leaf's build base". Inside the shared branch the prerequisite's content lands ahead of the dependent's build, which is what those records need, and their builds re-verify by content. Splitting them would make decomposition families — multi-spec's main use — unrunnable as a batch.

Evidence (2087-record corpus, 2026-10-16): any ref-plus-"merged" line matched 75 records (state literals, titles, residue rows); merge-requirement verb forms 40, mostly decomposition-family rows; the strict class below 6, five genuine once restricted to in-run blockers — #2682 (the incident: "confirm #2670 and #2681 are actually merged (not merely CLOSED)"), #1989, #2466, #530, #595.

## Signal

`plugin/bin/lib/preflight-records/merge-gate.js`'s `MERGE_STATE_RE` — "actually merged", or "merge(s/d) to/into main / origin/main / the integration branch" — on a line inside the target's `## Deliverables` or `## Prerequisites` section that names one of the target's own `blocked-by` prerequisites that is also in this run.

## Procedure

1. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/preflight-records.js" {targets in run order} --merge-gate [--repo owner/name]` — the run's targets only, never the claim step's open-queue extras — and read `mergeGate`.
2. `deferred` empty → no-op, write nothing.
3. Otherwise, before Step 2.8 claims anything: continue with `kept` as the run's target list (one remaining record → an ordinary single-record run). Once the run directory exists, write one `AUTO` entry per `_shared/auto-decision-log.md`: `AUTO {time} — Step 1: merge-state gate split #{deferred…} out of the run (#{record} requires #{requires} merged to the integration branch). Re-run after the merge: {rerun}. Reversibility: high.`
4. Print the same re-run command as a Pipeline Preview footer line: `Deferred until #{requires} merges: {rerun}`.

A deferred record is never claimed, so nothing needs releasing.
```

- [ ] **Step 4: Wire the pointers**
  - In `plugin/skills/flow/multi-spec.md`, insert after the Validation list's item 4 line:
    `4a. **Merge-state gate** — a target demanding an in-run prerequisite already be merged to the integration branch is split out before claiming, never asked; see \`multispec-merge-gate.md\` in this skill's directory.`
  - In `plugin/skills/flow/SKILL.md`, insert after the `- **Dependency-aware ordering** — …` bullet:
    `- **Merge-state gate (#2733)** — a target whose text requires an in-run prerequisite already merged to the integration branch is split out (with its in-run dependents) before claiming, logged, and given a re-run command — never asked; see \`multispec-merge-gate.md\`.`

- [ ] **Step 5: Run tests and size checks**

Run: `node --test tests/flow-claim-preflight.test.js tests/run-dir-timestamp-utc.test.js`
Expected: PASS
Run: `wc -c plugin/skills/flow/multi-spec.md plugin/skills/flow/SKILL.md`
Expected: multi-spec.md ≤ 20480; SKILL.md ≤ 46080

- [ ] **Step 6: Commit** — `Document multi-spec merge-state gate — split strict merge-demand targets before claiming, never ask (refs #2733)`
