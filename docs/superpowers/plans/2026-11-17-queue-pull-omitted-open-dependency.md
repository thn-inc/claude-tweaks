# Queue pull: fail closed on an omitted open dependency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `--transport files`, a record whose unresolved `Blocked by #N` dependency the agent-written `--verified-open-deps` file omits is blocked, unless the `--dep-freshness` file shows #N closed.

**Architecture:** `plugin/bin/lib/dispatch/queue-pull.js`'s `blocked-body` step reads the verified-open file as the complete list of open dependencies. It cannot be: `unresolved` holds every dependency absent from the open-numbers file, which includes closed ones, so "omitted" cannot by itself mean "open". The rule is therefore evidence-based: on the files transport an unresolved dependency counts as closed only when the agent's own dependency-freshness text carries an entry for it whose `state` is closed. Anything else counts as open and prints one Warning naming it. The gh transport is unchanged, because the CLI writes the verified-open file itself from live `gh issue view` calls.

**Tech Stack:** Node 18+, `node --test`, plain CommonJS under `plugin/bin/lib/dispatch/`.

**Spec:** `.claude-tweaks/pipelines/2026-11-17T181818-spec-5408-5722/spec-5408/work/5408-spec.md` (record #5408).

## Global Constraints

- The Warning text is exactly `Warning: verified-open-deps file omits #{N}, which the dependency-freshness file does not show closed — treated as open (fail closed) this run`, one line per such dependency, and it starts with `Warning: verified-open-deps` so the existing `warningsOf` test helper counts it.
- Files transport only. `ctx.options.transport === 'files'` gates the new rule; the gh transport's behavior is byte-for-byte unchanged.
- A fail-closed verdict is never persisted to the queue-order cache: set `state.depUnreadable = true` exactly as #5311's other fail-closed branches do.
- `state` comparison is case-insensitive (`closed`, `CLOSED`); an entry without a numeric `number` or a string `state` is ignored.
- Governing skill `dispatch-queue-exclusion-addition`, step 7, verbatim: "**Does the pass hand its verdict on through a file?** When the next pass reads a file whose empty or partial form is itself a valid answer (an empty verified-open-deps file reads as "none open"), write it once after the loop and remove it when that write fails, so the reader fails closed on a missing file." This change touches the reader only: the writer at `queue-pull.js:631-652` (gh transport) is unchanged.
- Governing skill `mcp-agent-fetch-node-compute`, rule 3, verbatim: "**Validate the shape of every agent-written entry.** The agent can record an error object, a not-found message or a `{content, sha}` wrapper as if it were data." Hence `closedDependencyNumbers` ignores any entry without an integer `number` and a string `state`, and never reads a wrapper object as evidence. Rule 8 (widen the handoff shape) needs nothing: `mcp-transport.md`'s `--dep-freshness` shape `[{number, updated_at, state}]` already carries `state`.
- Behavioral claim, with its code path: "on gh the verified-open file is complete by construction" is the `verified-open-deps` step at `queue-pull.js:630-653`, which runs only when `ctx.options.transport !== 'files'` and writes every open or unreadable unresolved dependency from live `gh issue view` calls.
- Decided by the user at plan review: the spec's deliverable to mirror the rule into `queue-pull-script.md` is dropped, and Acceptance Criterion 1 is read with the closed-evidence exception (spec's `## Plan Review Clarifications`).
- Do not edit `plugin/skills/dispatch/queue-pull-script.md`, `next-ranking.md`, or any oracle machinery's comparison logic. #5231 deletes those scripts; the rule cannot be mirrored into the bash fence because the fence never sees the agent's raw dependency-freshness text at the blocked pass (it is reset to `[]` before it on a cold cache).

## Review Focus

- A dependency-freshness file that is `[]` or absent while the verified-open file omits an unresolved number: treated as open (no evidence of closure).
- `state` spelled `CLOSED`, `Closed` or `closed`: all count as closed evidence.
- A dependency present in the verified-open file and also shown closed in freshness: still open (the file lists it; the rule only adds open numbers, never removes them).
- An entry with `state: "open"` for an omitted number (the existing `empty` fixture's shape): open, not closed.
- Two omitted dependencies on one record: two Warning lines, one per number, both named.

---

### Task 1: Evidence-based fail-closed rule in the blocked pass

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (the `blocked-body` step, around line 655-698; a helper next to `agentDepFreshness`, around line 294)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (beside the `#5227 files:` test at line 1084; retarget the `empty` case at line 1126-1128)

**Interfaces:**
- Consumes: `ctx.state.depFreshnessInput` (string or null, files transport only, the agent's raw dependency-freshness text read once at the start of `runFetch`), `ctx.options.transport`, the `unresolved` array and `openNumbers` set already local to the `blocked-body` step, `deps.stderr`, `state.depUnreadable`.
- Produces: `closedDependencyNumbers(text: string | null): Set<number>` in `queue-pull.js` (module-private), used only by the `blocked-body` step.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/dispatch/queue-pull.test.js` add `test('AC1.1, AC1.2 (#5408): files: an unresolved dependency the verified-open-deps file omits and the dependency-freshness file does not show closed is treated as open, with one Warning naming it', ...)` using the `#5227 files:` test's helpers (`S1()`, `pull`, `writeInput`, `mcpRecord`, `withBody`, `entriesOf`, `groupNumbers`, `warningsOf`, a `noGh` runner). Records 9001 (no dependency) and 9002 (`Blocked by #8000`), open-numbers `[{"number":9001},{"number":9002}]`, verified-open file written as `''`. Name a constant `OMITTED = (n) => \`Warning: verified-open-deps file omits #${n}, which the dependency-freshness file does not show closed — treated as open (fail closed) this run\``. Assert, for each case:

  - freshness `[]`: `groupNumbers` is `[[9001]]`, `entriesOf(r, 'blocked')` is `[{ reason: 'blocked', records: [9002], detail: { blockedBy: [8000] } }]`, `warningsOf(r)` is `[OMITTED(8000)]`, `r.store.written.length` is `0`.
  - freshness `[{"number":8000,"updated_at":"2026-11-09T10:00:00Z","state":"open"}]`: the same assertions.
  - freshness `[{"number":8000,"updated_at":"2026-11-09T10:00:00Z","state":"CLOSED"}]`: `groupNumbers` is `[[9001], [9002]]`, `warningsOf(r)` is `[]`.
  - two omitted dependencies (`9002` body `Blocked by #8000` and `Blocked by #8001`, freshness `[]`): `warningsOf(r)` is `[OMITTED(8000), OMITTED(8001)]`.

  Then retarget the `empty` case at line 1126-1128: its `dep.json` entry for 8000 shows `"state":"open"`, so an empty verified-open file now blocks 9002. Change that case's freshness entry to `"state":"closed"` and keep its assertions (`[[9001], [9002]]`, no warnings), and reword its message to `an empty file with the dependency shown closed is a well-formed "none open" answer`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "AC1\.1, AC1\.2 \(#5408\)" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL: the omitted-dependency cases still group 9002 and print no Warning.

- [ ] **Step 3: Implement the rule**

In `plugin/bin/lib/dispatch/queue-pull.js` add `closedDependencyNumbers(text)`: `JSON.parse` the text inside `try`/`catch`, return an empty `Set` for `null`, an unparseable value or a non-array, otherwise the numbers of entries whose `number` is an integer and whose `state` is a string equal to `closed` ignoring case. In the `blocked-body` step, after `verifiedOpen` is computed and only when `ctx.options.transport === 'files'` and the file was not `bad`, take each number of `readJson(paths['dispatch-unresolved-deps.json'])` (the step's own `unresolved` local is `[]` on that branch, `queue-pull.js:671`, so never iterate it) that is in neither `verifiedOpen` nor `closedDependencyNumbers(state.depFreshnessInput)`: add it to `openNumbers`, print the `OMITTED` line for it through `deps.stderr`, and set `state.depUnreadable = true`. Keep the order of the Warning lines the order of `unresolved`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS for the new test and the retargeted `empty` case; if any other test in the file now fails because its fixture omits a dependency without closed evidence, fix that fixture to carry the closed evidence, never the rule.

- [ ] **Step 5: Prove the tests discriminate (AC2.1)**

Remove the new block in `blocked-body` (leave the helper), run `node --test --test-name-pattern "AC1\.1, AC1\.2 \(#5408\)" tests/bin-lib/dispatch/queue-pull.test.js` and confirm it fails; restore the block and confirm it passes. Waived AC3.1: `npm test` is Common Step 5's verification of the whole branch, not a plan task.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-pull.js tests/bin-lib/dispatch/queue-pull.test.js
git commit -m "Fail closed on an omitted open dependency — queue pull, files transport (#5408)"
```

### Task 2: Keep the oracle and sibling suites green, and state the rule in the MCP transport doc

**Role:** integration

**Files:**
- Modify: `plugin/skills/dispatch/mcp-transport.md` (the `--verified-open-deps` bullet at line 84)
- Modify: `docs/journeys/select-the-dispatch-queue-with-the-queue-pull-cli-5227.md` (append the #5408 rule to the "Updated during #5311" note at line 73). Behavior-change sweep, classified: `docs/plugin-structure.md:368` and `plugin/bin/queue-pull.js` list the flag only, so no change; `queue-pull-script.md:177` is the retained oracle, not edited.
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` and the `queue-pull-parity-*.test.js` / `queue-pull-oracle-checks.test.js` fixtures, only where a files-transport pair now fails
- Test: `tests/dispatch-*.test.js` suites that pin `mcp-transport.md`'s prose

**Interfaces:**
- Consumes: Task 1's rule.
- Produces: the documented rule an MCP-path agent follows.

- [ ] **Step 1: Run the suites that read the module or the doc**

Run: `node --test tests/bin-lib/dispatch/queue-pull-parity-ac1.test.js tests/bin-lib/dispatch/queue-pull-parity-ac4.test.js tests/bin-lib/dispatch/queue-pull-parity-ac5.test.js tests/bin-lib/dispatch/queue-pull-parity-ac7.test.js tests/bin-lib/dispatch/queue-pull-parity-d1.test.js tests/bin-lib/dispatch/queue-pull-oracle-checks.test.js`
Expected: PASS, or a files-transport pair failing because its fixture has an unresolved dependency the verified-open file omits with no closed evidence in the freshness file. Then run `git grep -l -F verified-open-deps -- tests` and run every test file it lists.

- [ ] **Step 2: Fix each failing pair's fixture**

The six dependency-freshness fault rows in `FILES_FAULTS` (`tests/bin-lib/dispatch/queue-pull-fixtures.js:734-756`: `files-depFreshness-missing`, `files-depFreshness-malformed`, `files-depFreshness-missing-cold`, `files-depFreshness-wrapper`, `files-depFreshness-string`, `files-depFreshness-wrapper-cold`) run on scenario `P1`, where the closed #8001 is unresolved and absent from the verified-open file. Faulting the freshness file removes the module's only closed evidence, so the module now blocks the record and the bash oracle does not: an inherent divergence from Task 1's rule, not a fixture slip. Decided: give those six rows a scenario whose dependency is open and listed in the verified-open file (the existing `S1LiveDep`, used by the `verifiedOpenDeps` row at line 730, is the model), so both sides agree and each row still exercises its freshness fault and its warm or cold cache. Add no carve-out to `faultComparison`, do not skip a row, and do not edit the retained script. For any other pair that fails, give its fixture's dependency-freshness text a `state: "closed"` entry for the dependency its verified-open file omits. If no scenario variant keeps a row's cache semantics, stop and report `NEEDS_CONTEXT` naming the row.

- [ ] **Step 3: State the rule in `mcp-transport.md`**

In the `--verified-open-deps` bullet at line 84, add one sentence after "empty when there is none": a dependency the file omits counts as closed only when the `--dep-freshness` file shows its `state` closed; otherwise the CLI counts it open and prints a Warning naming it. Keep the file's existing wording around it, and run the prose-pinning suites `git grep -l -F verified-open-deps -- tests` found. Append the same rule, in one clause, to the "Updated during #5311" note at line 73 of `docs/journeys/select-the-dispatch-queue-with-the-queue-pull-cli-5227.md`.

- [ ] **Step 4: Run the full dispatch test set and commit**

Run: `node --test tests/bin-lib/dispatch/*.test.js`
Expected: PASS.

```bash
git add plugin/skills/dispatch/mcp-transport.md docs/journeys/select-the-dispatch-queue-with-the-queue-pull-cli-5227.md tests/bin-lib/dispatch
git add -u tests
git commit -m "State the omitted-dependency rule in the MCP transport doc, keep the oracle pairs green (#5408)"
```
