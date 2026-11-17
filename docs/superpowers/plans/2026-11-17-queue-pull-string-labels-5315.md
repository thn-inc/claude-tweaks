# Queue pull: skip one record with non-array labels (#5315) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A queue record whose `labels` is present but not an array is skipped at the eligibility step with one `Warning:` line naming it, and every other candidate in the pull is judged as usual, in both the module and the retained fence.

**Architecture:** One filter in front of `parseRecordFacets` in the eligibility step, written twice: in `plugin/bin/lib/dispatch/queue-pull.js` (`runBlocked`'s `eligible-pre-dep` step, the live path) and in the retained fence `plugin/skills/dispatch/queue-pull-script.md` (line 151, the parity mirror). The fence edit is byte-paid by trimming three restating comments, and keeps the fence at 658 lines so no `fence NNN` citation in `queue-pull.js` moves. No new exclusion reason: the record is dropped from the eligible list, as a `bot:in-progress` record is, plus the Warning.

**Tech Stack:** Node 18+ CommonJS, `node --test`, the bash parity oracle in `tests/bin-lib/dispatch/queue-pull-oracle.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5315/work/5315-spec.md`

## Global Constraints

- Spec Current State: "if the fence (`plugin/skills/dispatch/queue-pull-script.md`) has not been removed by #5231 when this lands, fix both and keep the parity row." The fence exists, so module and fence change together and the AC5.2 parity rows stay.
- Size rail: `queue-pull-script.md` is 52,451 B against `RAIL_BYTES` 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). After this task it must measure 52,486 B (`wc -c`), at most 52,500, and exactly 658 lines (`wc -l`). Headroom left: 14 B.
- The fence's node blocks are unquoted heredocs (`<<NODE_EVAL_EOF`): the added JS must contain no `$` and no backtick, so the Warning is built by `+` concatenation, never a template literal.
- Warning text, byte-identical on both sides (the em dash is U+2014): `Warning: #{number} skipped — its labels are not an array` followed by a newline. It reuses `plugin/bin/lib/dispatch/unlanded-blockers.js:62`'s existing cause words `its labels are not an array`.
- "Malformed labels" means `labels != null && !Array.isArray(labels)` — the same test `unlanded-blockers.js:62` applies. A `null` or absent `labels` is not malformed: `normalizeLabelNames` reads it as `[]`, so the record has no grant and stays silently ineligible, as today.
- Do not touch #5314's files or behaviour (the removal of an earlier pull's eligibility files on the cache-miss path).
- Governing skill `.claude/skills/dispatch-queue-exclusion-addition/SKILL.md`, quoted: "a change to the grant filter or to what a pass assumes about a record's labels must keep `typedNumbers` records judged exactly as granted ones are." / "| Changing only the retained `queue-pull-script.md` | It is no longer the live path; the CLI runs the module, so the change never takes effect (#5230). Change the module, then mirror the script |" / "| Changing only the module, until the removal unit lands | #5227's parity test runs the script's fence and the module on the same fixtures and goes red on the drift |" / "| Keeping the pass's rationale in the module's or script's comments | Running the pass needs none of it, yet every reader of the code pays for it; `queue-pull-notes.md` holds it for whoever changes a pass's position or posture |". Its registration table (sites 1-11) does not apply: no exclusion reason is added.
- Governing skill `.claude/skills/skill-prose-conformance-tests/whole-fence-parity-oracle.md` item 8, quoted: "Compare the exit status, the files each side writes, and the reported line kinds the criterion names (`AUTO`, `Warning:`)." The new Warning starts with `Warning: `, so `REPORTED_LINE` already compares it.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Shell: one plain command per Bash call (no `&&`, `;`, `cd … &&`, heredoc, loop, `$(...)`); file content via Write/Edit. Run test files in the foreground with an explicit timeout; never background a suite run.

## Review Focus

1. A `labels: null` (or absent) record: no Warning, not eligible, the rest of the queue dispatches. Pinned in Task 1 test B.
2. `labels` as an object (`{ name: 'auto:build' }`) or a number (`42`): truthy non-arrays that `normalizeLabelNames` would also throw on — skipped with the Warning. Pinned in Task 1 test B.
3. A typed record (`state.typedNumbers` holds it, `admitNamed` #5584) whose labels are a string: skipped with the Warning exactly as a granted one. Pinned in Task 1 test B.
4. The miss now writes the queue-order cache; the write-back blob must not carry the skipped record, and a later cache hit replays the groups without re-reading labels (so the Warning prints only on the pull that computes the groups — stated in `queue-pull-notes.md`). Pinned in Task 1 test A (blob contents).
5. A queue whose only record is malformed: an empty eligible list and empty groups, the pull still completes with one Warning. Pinned in Task 1 test B.

---

### Task 1: Skip a non-array-labels record at eligibility, module and fence

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js:580-594` (the `eligible-pre-dep` step in `runBlocked`; add a `#5315` line to the comment block at 562-563)
- Modify: `plugin/skills/dispatch/queue-pull-script.md:91`, `:111`, `:121-123`, `:151`
- Modify: `plugin/skills/dispatch/queue-pull-notes.md:7` (one sentence)
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js:22-26` (header bullet), new tests after the `AC2.1 blocked` test (ends ~line 800), `:3424-3457` (AC5.2)
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js:32-34` (reach comment), `:468-474` (SMalformed comment)
- No-change (classified): `docs/journeys/select-the-dispatch-queue-with-the-queue-pull-cli-5227.md:27` — updated by `/build` Common Step 6 (`/claude-tweaks:journeys`), not this task; `plugin/bin/lib/dispatch/unlanded-blockers.js` and its `malformedRecords` label branch (still the CLI's own screen; leave); `docs/plugin-structure.md:358` (describes that CLI, still true).

**Interfaces:**
- Consumes: `parseRecordFacets(labels)` (`plugin/bin/lib/issues/record.js`), `deps.stderr(string)`, `state.typedNumbers` (Set of numbers), the test helpers `pull(scenario, o)`, `groupNumbers(r)`, `entriesOf(r, reason)`, `FENCE`, `SMalformed(only)`, `ghRecord`, `withBody`, `QUEUE_ARGV`, and in the oracle describe `R`, `sides`, `assertClean`, `assertParity`, `AC1_FILES`, `reported`, `groupedIn`, `exclusionsIn`.
- Produces: in the test file, `labelsWarning(n: number) => string` (the fence-derived Warning line for record `n`, newline included) and `withQueue(scenario, records) => scenario` (a copy whose `QUEUE_ARGV` entry answers `JSON.stringify(records) + '\n'`).

- [ ] **Step 1: Write the failing in-process tests**

After the `AC2.1 blocked` test in `tests/bin-lib/dispatch/queue-pull.test.js`, add:

```js
// #5315: the eligibility step's Warning for a non-array labels value, read from the fence.
const LABELS_WARNING_RE = /console\.error\('(Warning: #)' \+ i\.number \+ '([^']*)'\)/;
const labelsWarning = (n) => {
  const m = FENCE.match(LABELS_WARNING_RE);
  assert.ok(m, `the fence no longer matches ${LABELS_WARNING_RE}`);
  return `${m[1]}${n}${m[2]}\n`;
};
const withQueue = (scenario, records) => ({ ...scenario, gh: scenario.gh.map((e) => (e.argv && e.argv.join() === QUEUE_ARGV.join() ? { ...e, stdout: JSON.stringify(records) + '\n' } : e)) });
const count = (hay, needle) => hay.split(needle).length - 1;
```

Test A — `AC1.1 (#5315): a record whose labels is a string is skipped with one Warning and #9001 is eligible`:
- `const r = pull(SMalformed('labels'));`
- `assert.equal(r.thrown, null)`; `assert.doesNotMatch(r.stderr, /queue-pull:/)`
- `assert.equal(labelsWarning(9020), 'Warning: #9020 skipped — its labels are not an array\n')` (pins the fence copy)
- `assert.equal(count(r.stderr, labelsWarning(9020)), 1)`
- `assert.deepEqual(r.json('dispatch-eligible.json').map((c) => c.number), [9001])`
- `assert.deepEqual(groupNumbers(r), [[9001]])`
- `assert.equal(r.store.written.length, 1)` and `assert.deepEqual(r.store.written[0].blob.groups.flat().map((c) => c.number), [9001])` (Review Focus 4)

Test B — `#5315 Review Focus: null labels stay silent; object, number and typed string labels are skipped with the Warning; an all-malformed queue yields empty groups`:
- `labels: null` — `pull(withQueue(SMalformed('labels'), [ghRecord(9001, { body: withBody(9001) }), { ...ghRecord(9020, { body: withBody(9020) }), labels: null }]))`: stderr does not contain `#9020`, `groupNumbers` is `[[9001]]`.
- For each value of `{ name: 'auto:build' }` and `42`: same queue shape with that `labels`; `count(r.stderr, labelsWarning(9020)) === 1`, `groupNumbers` is `[[9001]]`.
- Typed: `pull(SMalformed('labels'), { before: (ctx) => ctx.state.typedNumbers.add(9020) })`: `count(r.stderr, labelsWarning(9020)) === 1`, `groupNumbers` is `[[9001]]`.
- All-malformed: `pull(withQueue(SMalformed('labels'), [{ ...ghRecord(9020, { body: withBody(9020) }), labels: 'auto:build' }]))`: `r.thrown === null`, `count(r.stderr, labelsWarning(9020)) === 1`, `r.json('dispatch-eligible.json')` is `[]`, `r.json('dispatch-groups.json')` is `[]`.

If `fakeRun` refuses an unused canned entry or an argv it no longer receives (the open-numbers answer still lists 9020), adjust `withQueue` to also rewrite the `OPEN_NUMBERS_ARGV` answer from `records`; do not loosen `fakeRun`.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern "#5315" tests/bin-lib/dispatch/queue-pull.test.js` (foreground, timeout 600000 ms)
Expected: FAIL — `labelsWarning` finds no match in the fence (`the fence no longer matches`), and test A's stderr carries the step error from `normalizeLabelNames`' `.map`.

- [ ] **Step 3: Edit the fence (`plugin/skills/dispatch/queue-pull-script.md`), byte-paid and line-neutral**

Exactly these four replacements, each in place (no line added or removed):

1. Line 151 `  const eligiblePreDep = issues` becomes
   `  const eligiblePreDep = issues.filter((i) => Array.isArray(i.labels ?? []) || console.error('Warning: #' + i.number + ' skipped — its labels are not an array'))`
   (`console.error` returns `undefined`, so the filter drops the record after printing.)
2. Line 111 becomes `  // persisted.excluded is {number, blockedBy}[]: convert to reason:'blocked' entries.`
3. Lines 121-123 become
   `  // #2066: a hit's persisted bundles replace the '[]' placeholder; a`
   `  // record persisted before the field existed has no 'bundles' key, so`
   `  // this falls back to [].`
4. Line 91 becomes `# Placeholder: a cache hit overwrites it with persisted.bundles (#2066).`

Then run `wc -c` and `wc -l` on the file: expected `52486` and `658`.

- [ ] **Step 4: Edit the module (`plugin/bin/lib/dispatch/queue-pull.js`)**

In the `eligible-pre-dep` step, filter `issues` before the `.map` with the same predicate: keep `i` when `i.labels == null || Array.isArray(i.labels)`; otherwise call `deps.stderr(\`Warning: #${i.number} skipped — its labels are not an array\n\`)` and drop it. The filter applies before the grant test, so a `typedNumbers` record is dropped too. Add one comment line under the step's existing comment block: `// #5315: a non-array labels value is skipped with one Warning (fence line 151); the rest of the queue is judged.` Do not change any `fence NNN` citation (the fence's line count is unchanged).

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `node --test --test-name-pattern "#5315" tests/bin-lib/dispatch/queue-pull.test.js` (foreground, timeout 600000 ms)
Expected: PASS, 2 tests.

- [ ] **Step 6: Rewrite AC5.2's non-array-labels rows as the fixed behaviour**

In the `#5227 parity (AC5, portability)` describe, replace the AC5.2 test (3424-3457) with one named `AC5.2 / AC1.1 (#5315): non-array labels, a non-string body and an invalid Blocked-by number each exclude only their own record, and #9001's verdict matches the oracle's`. One loop over this table, every pair: `assertClean(pair, name)`; `assert.equal(pair.oracle.status, 0, …)`; `assert.equal(pair.module.status, 0, …)`; `assertParity(pair.oracle, pair.module, { files: AC1_FILES })`; per side `assert.deepEqual(exclusionsIn(r), entries)`, `assert.deepEqual(groupedIn(r), [9001])`, and, when `warns`, `assert.ok(reported(r.stderr).includes(labelsWarning(9020).trimEnd()))`; then `verdict(module)` equals `verdict(oracle)` equals `{ grouped: true, reasons: [] }` (keep the existing `verdict` helper).

| name | entries | warns |
|---|---|---|
| `SMalformed-gh-miss` | `[NOT_SPEC_9021, MALFORMED_BLOCKER_9022]` (in that order: not-spec-shaped runs before blocker-landing) | yes |
| `SMalformed-labels` | `[]` | yes |
| `SMalformed-body` | `[NOT_SPEC_9021]` | no |
| `SMalformed-blocker` | `[MALFORMED_BLOCKER_9022]` | no |

`NOT_SPEC_9021` and `MALFORMED_BLOCKER_9022` are the two literal entries the old test's `expected` object held — move them to consts. The `GROUPING_STOP_RE`/`stopMapped` usage for these rows goes away; leave both helpers (other tests use them).

If the SMalformed oracle side reports an unhandled `gh` call (the pull now reaches the linked-PR pass without #9020), correct `SMalformed`'s `tailGh(numbers)` in `queue-pull-fixtures.js` to the numbers that still reach that pass, and record the new reach in the fixtures header comment (32-34).

- [ ] **Step 7: Update the defect notes**

- `tests/bin-lib/dispatch/queue-pull.test.js:22-26`: the bullet moves out of "reproduced by the module, never fixed" — rewrite it as fixed by #5315 (the record is skipped with one Warning; the clean #9001 dispatches). Keep the "Script defects …" heading only if another bullet remains under it; otherwise fold the line into the next list's heading wording ("some since fixed").
- `tests/bin-lib/dispatch/queue-pull-fixtures.js:468-474`: replace "throw inside the eligibility block … stops at the group-building check" with "#9020 is skipped at eligibility with one Warning (#5315), so #9021 and #9022 reach their own passes".
- `plugin/skills/dispatch/queue-pull-notes.md:7`: append one sentence: "A record whose `labels` is present but not an array is skipped at eligibility with one `Warning: #N skipped — its labels are not an array` line, and every other candidate is judged as usual (#5315); a queue-order cache hit replays the groups without re-reading labels, so the Warning prints on the pull that computes them."

- [ ] **Step 8: Run the whole queue-pull suites**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js` (foreground, timeout 1200000 ms)
Expected: PASS, 0 fail (the oracle describes run when bash >= 4 is on PATH; quote the `# pass` / `# fail` / `# skipped` lines).
Run: `node --test tests/bin-lib/dispatch/queue-pull-shims.test.js tests/bin-lib/dispatch/unlanded-blockers.test.js` (foreground, timeout 600000 ms)
Expected: PASS, 0 fail.

- [ ] **Step 9: Commit**

Stage by explicit path (the five files above plus `queue-pull-fixtures.js` if Step 6 touched it) and commit with the message:

```
Skip a queue record with non-array labels at eligibility — one Warning, the rest of the pull dispatches (refs #5315)

Claude-Session: https://claude.ai/code/session_01CcCLFt4ZXj57iPy1vEWBhb
```
