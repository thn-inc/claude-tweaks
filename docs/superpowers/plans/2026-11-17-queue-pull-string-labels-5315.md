# Queue pull: exclude one record with non-array labels (#5315) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A queue record whose `labels` is present but not an array is excluded at the eligibility step on its own — one `malformed-blocker` entry in `dispatch-exclusions.json` and one `Warning:` line — every other candidate is judged as usual, and that pull writes no queue-order cache; module and retained fence alike.

**Architecture:** One screen in front of `parseRecordFacets` in the eligibility step, written twice: `plugin/bin/lib/dispatch/queue-pull.js` (`runBlocked`'s `eligible-pre-dep` step, the live path) and the retained fence `plugin/skills/dispatch/queue-pull-script.md` (line 151, the parity mirror). The screen appends through `appendExclusion` and sets a skip flag (module `state.labelsSkipped`; fence exit 3 → shell `LABELS_SKIPPED`) that the write-back guard reads beside the three existing ones (#5309, #5310, #5311). The fence edit is byte-paid by cutting restatement, and is line-neutral (658 lines), so no `fence NNN` citation after line 198 moves.

**Tech Stack:** Node 18+ CommonJS, `node --test`, the bash parity oracle in `tests/bin-lib/dispatch/queue-pull-oracle.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5315/work/5315-spec.md`

## Global Constraints

- Spec AC1, verbatim: "In the SMalformed fixture, #9001 is eligible and the malformed record is excluded with a Warning."
- Spec Decision, verbatim: "the skipped record gets a `dispatch-exclusions.json` entry beside its Warning, reusing reason `malformed-blocker` with cause `its labels are not an array` (the entry `unlanded-blockers.js` already writes for this condition); no new exclusion reason is added. Question 2 — a pull that skipped a record for non-array `labels` does not write the queue-order cache, the same way a pull with a failed native-blockers read (#5309), a failed dependency view (#5311) or a failed dependency-freshness search (#5310) does not; every pull over such a queue therefore recomputes and prints the Warning until the record is fixed. The skipped numbers are not stored in the cache blob and no Warning is replayed on a hit."
- Spec Current State: "if the fence (`plugin/skills/dispatch/queue-pull-script.md`) has not been removed by #5231 when this lands, fix both and keep the parity row." The fence exists: module and fence change together, the AC5.2 parity rows stay.
- Entry, byte-identical both sides: `{ reason: 'malformed-blocker', records: [N], detail: { cause: 'its labels are not an array' } }` (the shape `unlanded-blockers.js:90` `malformedExclusion` writes).
- Warning, byte-identical both sides (em dash U+2014), newline-terminated: `Warning: #N excluded — its labels are not an array`.
- "Non-array labels" means `labels != null && !Array.isArray(labels)` — `unlanded-blockers.js:62`'s test. `null`/absent `labels` is not malformed (`normalizeLabelNames` reads it as `[]`): no entry, no Warning, silently ineligible as today, and the write-back still runs.
- Order per skipped record, both sides: append the entry, then print the Warning. Records in queue order.
- Size rail: `queue-pull-script.md` is 52,490 B / 658 lines at HEAD against `RAIL_BYTES` 52,500. After Task 1 it must measure exactly **52,487 B and 658 lines** (`wc -c`, `wc -l`; measured on a scratch copy with the replacements below).
- The fence's node blocks are unquoted heredocs (`<<NODE_EVAL_EOF`): added JS holds no `$` except `${CLAUDE_PLUGIN_ROOT}` and no backtick, so the Warning is built by `+` concatenation.
- `fence NNN` citations in `queue-pull.js`: the edit is line-neutral overall, and lines 152-197 shift and shift back inside the edited region, where no citation points. Only the new `#5315` comment cites new lines (151, 159, 270). Do not touch any other citation.
- Do not touch #5314's `rm-eligibility` step, its fence line 145-146 `rm -f`, or its fence line 109 empty-queue guard.
- Governing skill `.claude/skills/dispatch-queue-exclusion-addition/SKILL.md`, quoted verbatim:
  - "writes `{reason, records, detail}` entries through `plugin/bin/lib/dispatch/exclusions.js`'s `appendExclusion`, the one sanctioned writer (#3110: it refuses a corrupt file rather than clobbering earlier passes' entries)."
  - "a change to the grant filter or to what a pass assumes about a record's labels must keep `typedNumbers` records judged exactly as granted ones are."
  - "| Writing the entry with `fs.writeFileSync` instead of `appendExclusion` | It clobbers every earlier pass's entries for this firing (#3110) |"
  - "| Changing only the retained `queue-pull-script.md` | It is no longer the live path; the CLI runs the module, so the change never takes effect (#5230). Change the module, then mirror the script |"
  - "| Changing only the module, until the removal unit lands | #5227's parity test runs the script's fence and the module on the same fixtures and goes red on the drift |"
  - "| Keeping the pass's rationale in the module's or script's comments | Running the pass needs none of it, yet every reader of the code pays for it; `queue-pull-notes.md` holds it for whoever changes a pass's position or posture |"
  - Its registration table (sites 1-11) does not apply: no reason is added. Its site 6 report file `blocked-exclusion-report.md` already renders `malformed-blocker`; Task 2 adjusts that file's producer note.
- Governing skill `.claude/skills/blocker-surface-parity/SKILL.md`: does not apply — no blocker form, state rule or blocker reader changes; the cause words reuse an existing entry.
- Omit (test-only contract, `queue-pull.js` header): `malformed-blocker` maps to id `blocker-landing`. The module's append is skipped when `ctx.omit.has('blocker-landing')`; the record is still screened out (it would crash `parseRecordFacets`) and the Warning still prints.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Shell: one plain command per Bash call (no `&&`, `;`, `cd … &&`, heredoc, loop, `$(...)`); file content via Write/Edit; `git -C "<worktree>"`. Run test files in the foreground with an explicit timeout (600000-1200000 ms); never background a test run — the machine-wide suite slot can hold a background run ~45 min.

## Review Focus

1. `labels: null` (or absent): no Warning, no entry, #9001 grouped, the write-back runs (one blob). Task 1 test B.
2. `labels` an object (`{ name: 'auto:build' }`) or a number (`42`): excluded with entry and Warning, no blob. Task 1 test B.
3. A queue whose only record is malformed: no throw, `dispatch-groups.json` `[]`, one entry, one Warning. Task 1 test B.
4. `omit: ['malformed-blocker']`: the record is still screened out with its Warning, no entry is appended, #9001 grouped. Task 1 test B.
5. A typed record (`state.typedNumbers`) with string labels: excluded exactly as a granted one (the screen runs before the grant test). Task 1 test B.

---

### Task 1: Exclude a non-array-labels record at eligibility, module and fence, and skip the write-back

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` — state field beside 355-357; `eligible-pre-dep` step 592-606; `runWriteBack` guards 779-781; comment line at 586-587
- Modify: `plugin/skills/dispatch/queue-pull-script.md` — lines 3, 6, 8, 13, 147, 151, after 158, 179, 198, 256, 270
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js` — header 22-27; new tests after the test that ends at line 799 (`a normal run still writes back`); AC5.2 at 3424-3457
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` — header 32-34 (unconditional rewrite); SMalformed comment 468-474; `tailGh` call at 493 only if a run reports an unanswered or unused call

**Interfaces:**
- Consumes: `appendExclusion(file, entry)` (`exclusions.js`), `deps.stderr(string)`, `ctx.omit` (Set of ids), `state.typedNumbers`; test helpers `pull(scenario, o)` (`o.omit`, `o.before`), `groupNumbers(r)`, `entriesOf(r, reason)`, `r.store.written`, `r.json(name)`, `r.thrown`, `r.stderr`, `FENCE`, `SMalformed(only)`, `ghRecord`, `withBody`, `QUEUE_ARGV`, `OPEN_NUMBERS_ARGV`; oracle describe `R`, `sides`, `assertClean`, `assertParity`, `AC1_FILES`, `reported`, `groupedIn`, `exclusionsIn`.
- Produces: module `state.labelsSkipped: boolean`; in the test file `labelsWarning(n) => string` (fence-derived Warning line, newline included), `withQueue(scenario, records) => scenario`, and consts `LABELS_ENTRY_9020`, `NOT_SPEC_9021`, `MALFORMED_BLOCKER_9022`.

- [ ] **Step 1: Write the failing in-process tests**

After the test ending at line 799, add:

```js
// #5315: the eligibility step's Warning for a non-array labels value, read from the fence.
const LABELS_WARNING_RE = /console\.error\('(Warning: #)' \+ i\.number \+ '([^']*)'\)/;
const labelsWarning = (n) => {
  const m = FENCE.match(LABELS_WARNING_RE);
  assert.ok(m, `the fence no longer matches ${LABELS_WARNING_RE}`);
  return `${m[1]}${n}${m[2]}\n`;
};
const LABELS_ENTRY_9020 = { reason: 'malformed-blocker', records: [9020], detail: { cause: 'its labels are not an array' } };
const withQueue = (scenario, records) => ({ ...scenario, gh: scenario.gh.map((e) => (e.argv && e.argv.join() === QUEUE_ARGV.join() ? { ...e, stdout: JSON.stringify(records) + '\n' } : e)) });
const count = (hay, needle) => hay.split(needle).length - 1;
```

Test A — `AC1.1 (#5315): a record whose labels is a string is excluded as malformed-blocker with one Warning, #9001 is grouped, and no queue-order cache is written`:
- `const r = pull(SMalformed('labels'));`
- `assert.equal(r.thrown, null)`; `assert.doesNotMatch(r.stderr, /queue-pull:/)`
- `assert.equal(labelsWarning(9020), 'Warning: #9020 excluded — its labels are not an array\n')`
- `assert.equal(count(r.stderr, labelsWarning(9020)), 1)`
- `assert.deepEqual(entriesOf(r, 'malformed-blocker'), [LABELS_ENTRY_9020])`
- `assert.deepEqual(groupNumbers(r), [[9001]])`
- `assert.equal(r.store.written.length, 0)`

Test B — `#5315 Review Focus: null labels stay silent and write back; object and number labels are excluded; omit keeps the screen but drops the entry; a typed string-labels record is excluded; an all-malformed queue yields empty groups`. Let `q = (labels) => withQueue(SMalformed('labels'), [ghRecord(9001, { body: withBody(9001) }), { ...ghRecord(9020, { body: withBody(9020) }), labels }])`:
- `pull(q(null))`: `r.stderr` does not include `#9020`; `entriesOf(r, 'malformed-blocker')` is `[]`; `groupNumbers(r)` is `[[9001]]`; `r.store.written.length === 1`.
- For `{ name: 'auto:build' }` and `42`: `count(r.stderr, labelsWarning(9020)) === 1`; entries `[LABELS_ENTRY_9020]`; groups `[[9001]]`; `r.store.written.length === 0`.
- `pull(SMalformed('labels'), { omit: ['malformed-blocker'] })`: `r.thrown === null`; `count(r.stderr, labelsWarning(9020)) === 1`; entries `[]`; `groupNumbers(r).flat()` includes 9001 and not 9020.
- Typed: `pull(SMalformed('labels'), { before: (ctx) => ctx.state.typedNumbers.add(9020) })` (if `o.before` takes another argument shape, follow the existing callers of `before`): `count(...) === 1`; entries `[LABELS_ENTRY_9020]`; groups `[[9001]]`.
- All-malformed: `pull(withQueue(SMalformed('labels'), [{ ...ghRecord(9020, { body: withBody(9020) }), labels: 'auto:build' }]))`: `r.thrown === null`; `count(...) === 1`; entries `[LABELS_ENTRY_9020]`; `r.json('dispatch-groups.json')` is `[]`.

If `fakeRun` refuses an unused canned entry (the open-numbers answer still lists 9001), make `withQueue` rewrite the `OPEN_NUMBERS_ARGV` answer from `records` too; never loosen `fakeRun`.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern "#5315" tests/bin-lib/dispatch/queue-pull.test.js` (foreground, timeout 600000)
Expected: FAIL after Step 1 — `the fence no longer matches`, and the pull stops at group-building (`normalizeLabelNames`' `.map` on a string).

- [ ] **Step 3: Edit the fence, exactly these replacements (each `old` occurs once)**

1. Line 3: `, replacing five ad hoc per-reason files that each used to carry their own shape/producer/reader/report. The file is truncated` → `. The file is truncated`
2. Line 6: ` still resolve them normally — a human present, explicitly naming one, is itself the required surfacing); only bare drain's auto-selection (SKILL.md Step 3, reusing the `next`-alias ranking script) excludes an oversized group from its own candidate pool, since nobody is present there to see a table row or answer a prompt.` → ` still resolve them normally); only bare drain's auto-selection (SKILL.md Step 3, reusing the `next`-alias ranking script) excludes an oversized group from its own candidate pool.`
3. Line 8: `, running ahead of the `open-pr`/`target-missing`/`shipped` passes below so an excluded candidate costs none of their `gh` probes and gets no stray Close proposal from them — no bypass: unlike `oversized`, where a human naming a record directly is itself an accepted size-risk signal, a spec-shape failure` → `, running ahead of the `open-pr`/`target-missing`/`shipped` passes below — no bypass: a spec-shape failure`
4. Line 13, end: `every other candidate is still checked.` (line end) → `every other candidate is still checked. Eligibility writes it too, for non-array labels (#5315).`
5. Line 147: `"$DISPATCH_ELIGIBLE_PRE_DEP" "$DISPATCH_UNRESOLVED_DEPS" <<NODE_EVAL_EOF` → `"$DISPATCH_ELIGIBLE_PRE_DEP" "$DISPATCH_UNRESOLVED_DEPS" "$DISPATCH_EXCLUSIONS" <<NODE_EVAL_EOF`
6. Line 151 `  const eligiblePreDep = issues` becomes two lines:
   `  for (const i of issues.filter((i) => i.labels != null && !Array.isArray(i.labels))) { require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js').appendExclusion(process.argv[5], { reason: 'malformed-blocker', records: [i.number], detail: { cause: 'its labels are not an array' } }); console.error('Warning: #' + i.number + ' excluded — its labels are not an array'); process.exitCode = 3; }`
   `  const eligiblePreDep = issues.filter((i) => i.labels == null || Array.isArray(i.labels))`
7. Directly after that block's closing `NODE_EVAL_EOF` (old line 158), insert: `[ $? -eq 3 ] && LABELS_SKIPPED=1 || LABELS_SKIPPED=`
8. Delete old line 179: `  // #5304: after an ignored states file, the gh-absent lookup Warning is dropped (any other lookup failure stays).`
9. Delete old line 198: `      # #5309: gh (or a failed mv) fails closed; exit 3 on files too.`
10. Line 256: `#5309-#5311: skipped after a fail-closed verdict or a failed dependency search.` → `#5309-#5311, #5315: skipped after a fail-closed verdict, a failed dependency search or non-array labels.`
11. Line 270: `"$NATIVE_UNREADABLE$DEP_UNREADABLE$DEP_FRESH_FAIL"` → `"$NATIVE_UNREADABLE$DEP_UNREADABLE$DEP_FRESH_FAIL$LABELS_SKIPPED"`

Then `wc -c` and `wc -l` the file: expected `52487` and `658`.

- [ ] **Step 4: Edit the module (`plugin/bin/lib/dispatch/queue-pull.js`)**

- State, after line 357: `labelsSkipped: false, // #5315: a record with non-array labels was excluded at eligibility; nothing is written back`.
- `eligible-pre-dep`: before the `.map`, walk `issues` in order; a record with `labels != null && !Array.isArray(labels)` is dropped: unless `ctx.omit.has('blocker-landing')`, `appendExclusion(paths['dispatch-exclusions.json'], { reason: 'malformed-blocker', records: [i.number], detail: { cause: 'its labels are not an array' } })`; then `deps.stderr(\`Warning: #${i.number} excluded — its labels are not an array\n\`)`; then `state.labelsSkipped = true`. The rest of the step runs over the kept records unchanged. One comment line: `// #5315 (fence 151-152, 159): a non-array labels value is excluded on its own; the pull writes no cache.`
- `runWriteBack`, after line 781: `if (state.labelsSkipped) return; // #5315: nor a pull that excluded a non-array-labels record`.

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `node --test --test-name-pattern "#5315" tests/bin-lib/dispatch/queue-pull.test.js` (foreground, timeout 600000)
Expected: PASS, `# fail 0` (test A and test B; the oracle-backed AC5.2 test matches the pattern only after Step 6 renames it).

- [ ] **Step 6: Rewrite AC5.2 as the fixed behaviour (parity)**

Replace the AC5.2 test (3424-3457) with `AC5.2 / AC1.1 (#5315): non-array labels, a non-string body and an invalid Blocked-by number each exclude only their own record, and #9001's verdict matches the oracle's`. Move the old `expected` object's two entries to consts `NOT_SPEC_9021` and `MALFORMED_BLOCKER_9022`. One loop over this table; per pair: `assertClean(pair, name)`; both statuses `0`; `assertParity(pair.oracle, pair.module, { files: AC1_FILES })`; per side `assert.deepEqual(exclusionsIn(r), entries)`, `assert.deepEqual(groupedIn(r), [9001])`, and when `warns`, `assert.ok(reported(r.stderr).includes(labelsWarning(9020).trimEnd()))`; then `verdict(module)` equals `verdict(oracle)` equals `{ grouped: true, reasons: [] }` (keep the `verdict` helper).

| name | entries | warns |
|---|---|---|
| `SMalformed-gh-miss` | `[LABELS_ENTRY_9020, NOT_SPEC_9021, MALFORMED_BLOCKER_9022]` | yes |
| `SMalformed-labels` | `[LABELS_ENTRY_9020]` | yes |
| `SMalformed-body` | `[NOT_SPEC_9021]` | no |
| `SMalformed-blocker` | `[MALFORMED_BLOCKER_9022]` | no |

No queue-order cache on either side for the two `warns` rows: find how the #5310/#5311 parity rows assert "no cache written" on the oracle side (search the test file for the queue-order cache path or blob in a pair result) and assert the same for these two rows, plus its negation for `SMalformed-body`. If no pair result exposes the cache, say so in the report and rely on test A for the module side.

`GROUPING_STOP_RE` and `stopMapped` stay (other tests use them). If either side reports an unanswered or unused `gh` call, correct `SMalformed`'s `tailGh(numbers)` to the numbers that reach the linked-PR pass.

- [ ] **Step 7: Rewrite the defect notes**

- `tests/bin-lib/dispatch/queue-pull-fixtures.js:32-34` (unconditional): replace the three SMalformed lines with each scenario's actual final gh argv, read from a module run's recorded argv (`r.ghArgv`) — `SMalformed('labels')` now reaches the common calls and `<linked: i9001>`, not a stop.
- `queue-pull-fixtures.js:468-474`: replace "In the script, #9020's string labels throw … before #9021 or #9022 reach any pass." with: "#9020 is excluded at eligibility as malformed-blocker with one Warning (#5315), so #9021 and #9022 reach their own passes."
- `tests/bin-lib/dispatch/queue-pull.test.js:22-27`: delete the "Script defects … never fixed" heading and its bullet; add under the "(some since fixed, noted per bullet)" list: "- A candidate whose `labels` is not an array (SMalformed's #9020) threw inside the eligibility block, so one malformed record stopped every candidate; fixed by #5315: it is excluded as malformed-blocker with one Warning, the pull writes no queue-order cache, and the clean #9001 dispatches."

- [ ] **Step 8: Run the queue-pull and fence-reading suites**

Run, each in the foreground, timeout 1200000:
`node --test tests/bin-lib/dispatch/queue-pull.test.js`
`node --test tests/bin-lib/dispatch/queue-pull-shims.test.js tests/bin-lib/dispatch/unlanded-blockers.test.js tests/bin-lib/dispatch/exclusions.test.js tests/node-eval-file-heredoc-syntax.test.js tests/node-e-snippet-syntax.test.js tests/skill-fence-guard-shapes.test.js tests/dispatch-queue-pull-cutover-prose.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/hooks-dispatcher.test.js tests/session-tmp-root-migration.test.js`
Expected: `# fail 0` for each (quote the `# pass` / `# fail` / `# skipped` lines; the oracle describes run when bash >= 4 is on PATH).

- [ ] **Step 9: Commit**

Stage by explicit path and commit:

```
Exclude a queue record with non-array labels at eligibility — malformed-blocker entry and one Warning, no cache write, the rest of the pull dispatches (refs #5315)

Claude-Session: https://claude.ai/code/session_01CcCLFt4ZXj57iPy1vEWBhb
```

---

### Task 2: Name the eligibility step as a malformed-blocker writer in the docs

**Role:** transcription

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-notes.md:39`
- Modify: `plugin/skills/dispatch/blocked-exclusion-report.md:34-35`
- Modify: `docs/journeys/select-the-dispatch-queue-with-the-queue-pull-cli-5227.md:27`, `:46`
- Modify: `docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md:31`
- No change (classified): `docs/plugin-structure.md:358`, `docs/skill-graph.md:289` (they describe `dispatch-unlanded-blockers.js`, whose own screen is unchanged and still true).

**Interfaces:**
- Consumes: Task 1's Warning and entry text (Global Constraints).

- [ ] **Step 1: Edit the four files**

1. `queue-pull-notes.md:39`, after the sentence ending "a record the call names as missing from the native dependency response is dropped with the call re-run once without it.", insert: "A record whose `labels` is present but not an array never reaches the call: the eligibility step excludes it as `malformed-blocker` (cause `its labels are not an array`) with one `Warning: #N excluded — its labels are not an array` line, and that pull writes no queue-order cache, so every pull recomputes and warns until the record is fixed (#5315)."
2. `blocked-exclusion-report.md:34-35`: `#4792 —\nthe same pass)` → `#4792 —\nthe same pass, or the eligibility step for non-array labels, #5315)`.
3. Journey 5227 `:27`: `(a later step's stale session file reused, a string `labels` stopping the whole pull)` → `(a later step's stale session file reused)`. `:46`, append at the end of the paragraph: " A queue record whose `labels` is not an array is excluded as `malformed-blocker` with one `Warning: #N excluded — its labels are not an array` line, the rest of the queue is judged, and that pull writes no queue-order cache (#5315)."
4. Journey 3084 `:31`: `(the queue-pull pass that writes `unlanded-blocker` and `malformed-blocker`)` → `(the queue-pull pass that writes `unlanded-blocker` and `malformed-blocker`; the eligibility step also writes `malformed-blocker` for non-array labels, #5315)`.

- [ ] **Step 2: Run the prose suites**

Run (foreground, timeout 1200000): `node --test tests/dispatch-unlanded-blocker-consumers-conformance.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/dispatch-queue-pull-cutover-prose.test.js`
Expected: `# fail 0`.

- [ ] **Step 3: Commit**

```
Name the eligibility step as a malformed-blocker writer for non-array labels in the dispatch notes and journeys (refs #5315)

Claude-Session: https://claude.ai/code/session_01CcCLFt4ZXj57iPy1vEWBhb
```
