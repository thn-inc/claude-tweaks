# acceptance-labeling parent-gate fix (#3222) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `wrap-up-engine.js verify`'s `acceptance-labeling` check from false-failing a sub-issue whose parent's acceptance gate is not yet due.

**Architecture:** After a parent target resolves, enumerate the parent's sub-issues through the existing `deps.gh` seam, compute `parentGateState` (run-resolved records counted as CLOSED), and apply the parent-path oversight floor (`maxRiskTier` + `exceedsOversightFloor(..., { sizeFloor: null })`). Only a `due`/`gated`/`resolved` gate on an above-floor parent reaches the existing `demo:pending` + brief check; otherwise the target is skipped with a reason. An enumeration failure is a gather failure (`unknown`). Plus a one-paragraph doc note on the pre-archive `--run-dir`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T202735-record-3222/work/3222-spec.md` (materialized from GitHub issue #3222)

Scope keywords: acceptance-labeling, parentGateState

## Global Constraints

- Reuse `parentGateState` (`plugin/bin/lib/issues/acceptance.js`), `maxRiskTier`/`exceedsOversightFloor` (`plugin/bin/lib/issues/oversight-floor.js`) and `parseRecordFacets` (`plugin/bin/lib/issues/record.js`) — never re-derive gate or floor logic. `acceptance.js` is consumed, not changed.
- `exceedsOversightFloor` is called with `sizeFloor: null` — the literal `null`, never the resolved size-floor and never omitted.
- All network/git goes through `deps.gh(args, cwd)` / `deps.git(args, cwd)` (argv arrays, no shell strings). The module stays read-only.
- A sub-issue enumeration failure renders the whole check `unknown`, never `fail` — same could-not-gather convention as `resolveParent`'s failure.
- The non-parent path and the `oversightExemptSet` narrowing stay unchanged.
- `execution-and-verification.md`'s `### Verify execution` section must keep passing `tests/wrap-up-verify-execution-pin.test.js`: no backticked `git`/`gh` invocation other than the `wrap-up-engine.js verify` call.

## Review Focus

1. The run's own sub-issue still OPEN on GitHub at verify time — self-inclusion must count it CLOSED, or the last sibling's gate never reads `due` (test: Task 1 "two run sub-issues share one parent").
2. Two run sub-issues sharing one parent — the parent is enumerated and checked once, with both counted CLOSED (same test).
3. A sibling with no `risk:*` label — `maxRiskTier` returns `undefined`, the floor fails closed (`exceeds: true`), so a due parent still requires `demo:pending` (test: "unscored sibling").
4. Enumeration returning zero sub-issues for a parent this run's record claims as its parent — inconsistent data, must be `unknown`, not a silent `incomplete` skip (test: "empty enumeration").
5. An already-gated parent (`demo:pending` + trusted brief) with above-floor siblings — must still `pass` (the two existing parent-redirect tests, updated to answer the sub-issues call).

---

### Task 1: Parent-gate-aware `acceptance-labeling`

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js` (requires block ~L23-32; the `acceptance-labeling` registration, located by `registerCheck('acceptance-labeling'`; `module.exports`)
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js` (new cases beside the existing `acceptance-labeling` tests; update the two existing parent-`898` tests — "redirects to a resolvable parent…" and "queries a shared parent exactly once…" — so their `fakeGh` answers the new sub-issues call with sub-issues labelled `risk:high`)

**Interfaces:**
- Produces (exported from `engine-verify.js`): `enumerateSubIssues(parent: number, deps: {git, gh}, cwd: string) -> { ok: true, subIssues: Array<{ number: number, state: 'OPEN'|'CLOSED', labels: string[] }> } | { ok: false, error: string }`.
  - Resolves owner/repo exactly as `resolveParent` does (`deps.git(['remote', 'get-url', 'origin'], cwd)` → `parseRepo`).
  - gh argv, exactly: `['api', '--paginate', \`repos/${owner}/${repo}/issues/${parent}/sub_issues\`, '--jq', '.[] | {number, state, labels: [.labels[].name]} | @json']` — one JSON object per output line (probed live against parent #3374: `{"labels":[...],"number":3375,"state":"closed"}`). Parse each non-empty line; upper-case `state`.
  - `{ ok: false }` when: the git/gh call throws (`gh api sub_issues failed for parent #P (…)`), a line does not parse or lacks an integer `number` (`could not parse sub_issues output for parent #P`), or zero sub-issues come back (`no sub-issues enumerated for parent #P`).
- Internal: `resolveRiskFloor(repoRoot: string) -> string|undefined` — reads `{repoRoot}/.claude-tweaks/policy.yml` (missing file → `null` raw) and returns `resolvePolicyKeys(['risk-floor'], { policyRaw }).['risk-floor'].value`, or `undefined` on any error entry (which `exceedsOversightFloor` treats as the fail-safe `'high'`). `resolvePolicyKeys` is exported by `plugin/bin/lib/policy-schema.js`. Use `repoRoot` (the check fn's argument), not `cwd` — keeps tests hermetic with `makeCleanRepoRoot()`.

- [ ] **Step 1: Write the failing tests**

Add a test helper `subIssuesGh(subs)` returning `subs.map((s) => JSON.stringify({ number: s.number, state: s.state, labels: s.labels })).join('\n')` and a matcher `isSubIssuesCall(args)` = `args[0] === 'api' && args.includes('--paginate') && /issues\/\d+\/sub_issues$/.test(args[2])`. Each new test uses `writeSpecFile(runDir, …)`, `deps: { git: fakeOriginGit(), gh: fakeGh }`, `repoRoot: makeCleanRepoRoot()` (no policy → `risk-floor` default `high`), and `fakeGh` answering `--version`, GraphQL parent (`parentGraphqlResponse(parentQueryNumber(args), 898)`), the sub-issues call, and `labels,comments`.

- `AC1.1/AC1.2: acceptance-labeling skips (never fails) a sub-issue whose parent gate is incomplete` — run record 900; sub-issues 900 `open`, 901 `closed`, 902 `open`, 903 `open`, all `risk:high`; parent labels `[]`. Assert `row.result === 'skip'`, `row.detail` matches `/parent gate #898 not due — 2 sibling sub-issue\(s\) open/`, and `result.rows` has no `acceptance-labeling` fail.
- `AC2.1: acceptance-labeling still fails a due, above-floor parent missing demo:pending` — sub-issues 900 `open` (self), 901 `closed`, both `risk:high`; parent labels `[]`. Assert `fail` and `row.detail` matches `/#898: missing demo:pending label/`.
- `AC3.1: acceptance-labeling skips a due parent below the oversight floor` — same as AC2.1 but both `risk:medium`. Assert `skip`, detail matches `/parent #898 below oversight floor/`.
- `AC4.1: acceptance-labeling renders unknown when sub-issue enumeration throws` — sub-issues call throws `new Error('gh: HTTP 502')`. Assert `unknown`, detail matches `/#900: gh api sub_issues failed for parent #898/`, and no `labels,comments` call was made.
- `acceptance-labeling renders unknown when sub-issue enumeration returns nothing` — sub-issues call returns `''`. Assert `unknown`, detail matches `/no sub-issues enumerated for parent #898/`.
- `acceptance-labeling counts every run sub-issue of a shared parent as closed, enumerating that parent once` — run records 900 and 901 (`writeSpecFile` twice), both resolve to parent 898; sub-issues 900 `open`, 901 `open`, 902 `closed`, all `risk:high`; parent labels `[]`. Assert `fail` with `/#898: missing demo:pending label/` (gate read `due`, not `incomplete`) and exactly one sub-issues call.
- `acceptance-labeling fails closed on an unscored sibling when the parent gate is due` — sub-issues 900 `open` (self, `risk:low`), 901 `closed` with no `risk:*` label; parent labels `[]`. Assert `fail` with `/#898: missing demo:pending label/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: FAIL — the AC1.1/AC3.1 cases report `fail` instead of `skip`, the AC4.1/empty cases report `fail`/`pass` instead of `unknown`.

- [ ] **Step 3: Implement**

In `engine-verify.js`: require `parentGateState` (`../issues/acceptance`), `exceedsOversightFloor`/`maxRiskTier` (`../issues/oversight-floor`), `parseRecordFacets` (`../issues/record`), `resolvePolicyKeys` (`../policy-schema`); add `enumerateSubIssues` and `resolveRiskFloor` per Interfaces; export `enumerateSubIssues`.

In the `acceptance-labeling` check (signature gains `repoRoot`):
- First pass (target resolution): record each target as `{ target, parent: boolean }`. For a newly seen parent target, call `enumerateSubIssues`; on `{ ok: false }` push `#${n}: ${error}` onto `gatherFailures` (so it returns `unknown` before any label read, like a parent-resolution failure). Keep the dedupe-by-target behavior — a parent shared by two run records is enumerated once.
- Self-inclusion set: every number in `issues` (the run's resolved records, before oversight-exempt narrowing). Build the gate input as `subIssues.map((s) => ({ ...s, state: closing.has(s.number) ? 'CLOSED' : s.state }))`.
- Second pass, parent targets only, after the existing `labels,comments` read and before the `demo:pending` test: `state = parentGateState({ subIssues, parentLabels: labels.map((l) => l.name) })`. `incomplete` → push `parent gate #${target} not due — ${openCount} sibling sub-issue(s) open` (openCount = gate-input entries not `CLOSED`) onto a `skipped` list and `continue`. Otherwise compute `exceedsOversightFloor({ risk: maxRiskTier(subIssues.map((s) => parseRecordFacets(s.labels))) }, { riskFloor: resolveRiskFloor(repoRoot), sizeFloor: null })`; `exceeds: false` → push `parent #${target} below oversight floor` onto `skipped` and `continue`. Otherwise fall through to the unchanged `demo:pending` + brief check. Resolve the risk floor once per check run, not per target.
- Result: any failing line → `fail` (detail = failing + passing-ignored notes + skipped reasons); else if no target reached the brief check (all skipped) → `skip` with `skipped.join('; ')`; else `pass` with detail = ignored notes + skipped reasons (empty string when none, so the existing `row.detail === ''` assertion still holds).
- Update the two existing parent-`898` tests' `fakeGh` to answer `isSubIssuesCall` with sub-issues 900 (and 901 for the dedup test) `closed`/`open` labelled `risk:high`; their assertions stay as they are.
- Update the comment block above the check: the parent path now evaluates the Parent-Gate Procedure's gate state and oversight floor (cite `verification-brief-parent-gate.md`'s "Evaluate the gate").

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/engine-verify.js tests/bin-lib/wrap-up/engine-verify.test.js
git commit -m "Gate acceptance-labeling's parent check on the parent gate state — skip an incomplete or below-floor parent instead of failing (refs #3222)"
```

### Task 2: Pre-archive `--run-dir` note

**Files:**
- Modify: `plugin/skills/wrap-up/execution-and-verification.md` (`### Verify execution` section)
- Test: `tests/wrap-up-verify-execution-pin.test.js` (existing — must stay green; no new test)

**Interfaces:** none.

- [ ] **Step 1: Add one sentence** to the `### Verify execution` paragraph that invokes the verb: `--run-dir` takes the run's original (pre-archive) `$PIPELINE_RUN_DIR` path even after Section B archived the run — the verb resolves the archived copy itself, and passing the archive path makes `run-dir-archived` report `original path still present`. No backticked `git`/`gh` command (the pin test forbids it).

- [ ] **Step 2: Run** `node --test tests/wrap-up-verify-execution-pin.test.js` — Expected: PASS. Then `grep -n "pre-archive" plugin/skills/wrap-up/execution-and-verification.md` — Expected: one hit inside `### Verify execution` (AC5.1).

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/wrap-up/execution-and-verification.md
git commit -m "Document verify's pre-archive --run-dir requirement — passing the archive path trips run-dir-archived (refs #3222)"
```

---

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (enumerate, parentGateState, self-inclusion) | Task 1 |
| Deliverable 2 (due/gated/resolved + floor, else skip with reason) | Task 1 |
| Deliverable 3 (enumeration failure → unknown) | Task 1 |
| Deliverable 4 (pre-archive note) | Task 2 |
| AC1.1, AC1.2, AC2.1, AC3.1, AC4.1 | Task 1 tests |
| AC5.1 | Task 2 Step 2 |
| AC6.1 (`npm test` passes in full) | `/build` Common Step 5 (full suite runs centrally) |

## Self-review

- **Spec coverage:** every Deliverable and AC clause maps to a task above.
- **Placeholders:** none.
- **Type consistency:** `enumerateSubIssues` returns `state` upper-cased (`'OPEN'|'CLOSED'`), which is what `parentGateState` compares against.
