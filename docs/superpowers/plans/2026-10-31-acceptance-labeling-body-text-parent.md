# Acceptance-labeling body-text parent resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `wrap-up-engine.js verify`'s `acceptance-labeling` check find a sub-issue's parent, and enumerate that parent's sub-issues, under `work-links: body-text` (the schema default) instead of only through native sub-issue links.

**Architecture:** A pure `parseParent(body)` joins the existing line-anchored parsers in `record-dependencies.js`. `engine-verify.js` resolves `work-links` once per check run from the repo root's `policy.yml` (mirroring `resolveRiskFloor`) and passes it into `resolveParent` / `enumerateSubIssues`, which keep today's native code path and add a body-text path built on `gh issue view`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, injected `deps.gh` / `deps.git` runners.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T171342-record-4551/work/4551-spec.md` (record #4551; re-materialized by the 2026-11-01 resumed run, carrying all three plan-review Decision bullets — Reading A, Reading B, and the closing rule — and superseding the `2026-10-31T171043` and `2026-10-31T133848` copies)

**Premise update (2026-11-01 catch-up):** the spec's Current State says "No code parser for the `Parent: #N` line exists today." That no longer holds: #4599/#4603's `plugin/bin/lib/issues/parent-gate.js` (merged to main after the spec was written) defines `PARENT_LINE_RE = /^Parent: #(\d+)/m` and reads it in its body-text `resolveParent`, and `mcp-parent-gate-shape.js` imports that regex for its own body-text read. This plan still adds `parseParent` (Deliverable 1, AC1), then makes it the one code reader: Task 3 moves both of those call sites onto `parseParent` and drops `PARENT_LINE_RE`, so the plugin keeps one `Parent:` parser, not three.

## Global Constraints

- `parseParent` regex is line-anchored, multiline, first match wins: `PARENT_RE = /^Parent: #(\d+)\b/m`; mid-line mentions do not count; returns a number or `null`; a `null`/empty body returns `null`.
- `work-links` is read from the **repo root's** `.claude-tweaks/policy.yml` via `resolvePolicyKeys(['work-links'], { policyRaw })` — never the worktree cwd; a missing file means the schema default `body-text`.
- `work-links` is resolved once per check run, not once per record.
- `resolveParent(n, deps, cwd, workLinks)` / `enumerateSubIssues(parent, deps, cwd, workLinks)`: a missing `workLinks` argument means `native`, so existing direct callers keep their behavior.
- Body-text gather failures (a throw, unparseable JSON) return `{ ok: false, error }` so the check renders `unknown`, never `fail`. A parent body with no task list stays a gather failure (`no sub-issues enumerated for parent #N`), never a due gate.
- A body with no `Parent:` line resolves `parent: null` (legitimate — a collapsed decomposition), never an error.
- Sub-issue `state` is upper-cased, labels are reduced to name strings — the same `{ number, state, labels }` shape `parentGateState` consumes today.
- Governing skill `gh-api-module-pattern` (quoted): "The module takes `runner(args)`, invoked as if `gh ${args.join(' ')}`, returning stdout; a throw is a failed call. … always an argv array, never a shell string (no injection surface, no quoting bugs)." All new gh calls go through `deps.gh(argvArray, cwd)`.
- **Plan-review Decisions (record AC10 Reading A + AC11 Reading B, 2026-10-31):** when a run record's `Parent: #N` line and parent #N's own task list disagree, the parent's task list wins. Sub-issues are enumerated from the parent side only. A run record whose `Parent: #N` points at a parent whose task list does not list it has **no resolvable parent**: it is not added to #N's gate input (never forced `CLOSED` into `parentSubIssues`), it takes the standalone path as its own target (so it needs its own `demo:pending`, and a missing one is reported `#{n}: missing demo:pending label`), and the mismatch is still logged in the row's detail — `#{n}: Parent: #{N} line not in #{N}'s task list — mismatch, not counted in #{N}'s gate; checked as its own target`. The mismatch check is body-text only (native resolves both sides from one relationship) and the note is appended to the detail on every return path after the gather (fail, skip, pass), never replacing the row's verdict.
- **Closing rule (record AC12):** the three decisions settle the spec; any further edge case in these areas is implementer judgment recorded in this plan. Implementer-judgment rulings this plan records: (a) a second run record that names the same parent is membership-checked on its own, so enumeration is cached per parent instead of being skipped by the target dedup; (b) when the parent's enumeration itself fails, that is a gather failure (`unknown`), never a fallback to the standalone path; (c) an unlisted record's mismatch makes it its own target even when another run record routes the parent into the gate, and the parent's gate is evaluated from its task list alone.
- `parseParent` is the plugin's one code reader of the `Parent: #N` line (Task 3 moves `parent-gate.js` and `mcp-parent-gate-shape.js` onto it). Its `\b` after the digits is stricter than the old `PARENT_LINE_RE` only for a line such as `Parent: #12abc`, which no writer produces.
- Real `gh` shapes (probed 2026-10-31 on #4551): `gh issue view N --json body` → `{"body":"..."}`; `gh issue view N --json state,labels` → `{"labels":[{"color":…,"description":…,"id":…,"name":"bug"}],"state":"OPEN"}`. Fixtures use these shapes.

## Review Focus

1. A CRLF body (`Parent: #12\r\n`) must still resolve `12` — `\b` after the digits matches before `\r`. Pinned in Task 1.
2. A body whose `gh issue view` reply is `{"body": null}` must resolve `parent: null`, not throw. Pinned in Task 1 (`parseParent(null)`) and Task 2 (body-null fixture).
3. A parent body with a task list but a sub-issue whose state fetch throws must render `unknown`, not `fail` and not a due gate. Pinned in Task 2.
4. Under explicit `work-links: native`, a sub-issue body carrying a `Parent:` line must be ignored — no `--json body` call at all. Pinned in Task 2.
5. Two run records sharing one body-text parent must enumerate that parent once (now a per-parent enumeration cache, since the target dedup moves after the membership check). Pinned in Task 2.
6. Reading B: a record whose `Parent:` line names a parent that does not list it must be checked as its own target (its own `demo:pending`), never silently dropped and never counted in the parent's gate. Pinned in Task 2 (`AC10.1/AC11.1`, `AC11.2`).

## Spec coverage map

| AC clause | Test |
|---|---|
| AC1.1 | Task 1 `AC1.1: parseParent reads a line-anchored Parent line` |
| AC1.2 | Task 1 `AC1.2: parseParent ignores a mid-line mention and a body with no Parent line` |
| AC1.3 | Task 1 `AC1.3: parseParent returns null for a null or empty body` |
| AC2.1, AC2.2 | Task 2 `AC2.1/AC2.2: body-text resolveParent reads the Parent line and targets the parent` |
| AC3.1 | Task 2 `AC3.1: body-text parent gate not due with one sibling open` |
| AC4.1 | Task 2 `AC4.1: body-text record with no Parent line is checked as its own target` |
| AC5.1 | Task 2 `AC5.1: body-text body fetch throw renders unknown, never fail` |
| AC6.1 | Task 2 fixture migration (existing native tests, unchanged assertions) + `AC6.1: explicit native issues no body fetch` |
| AC7.1 | Task 2 `AC7.1: no policy.yml takes the body-text path` |
| AC8.1 | Task 2 Step 5 (revert-to-red proof) |
| AC9.1 | `npm test`, run centrally by the pipeline's `/claude-tweaks:test` step |
| AC10.1, AC10.2, AC10.3, AC10.4 (Decision, Reading A) | Task 2 `AC10.1/AC11.1: body-text Parent line absent from the parent task list is a logged mismatch, not a gate member, checked as its own target` |
| AC11.1, AC11.2, AC11.3, AC11.4 (Decision, Reading B) | Task 2 `AC10.1/AC11.1: body-text Parent line absent from the parent task list is a logged mismatch, not a gate member, checked as its own target` + `AC11.2: a lone unlisted record with demo:pending and a confirmed brief passes with the mismatch note` |
| AC12.1, AC12.2, AC12.3 (Decision, closing rule) | Global Constraints' "Closing rule" bullet records the implementer-judgment rulings (a)-(c); Task 2 `body-text parent shared by two run records is enumerated once` pins ruling (a) |

Waived wrap-up/verification-brief-parent-gate.md: read only — its body-text prose already describes the behavior this plan mechanizes; no wording changes.
Waived _shared/work-record.md: read only — the `Parent: #N` entry is the format source; unchanged.

---

### Task 1: `parseParent` parser

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/record-dependencies.js` (add `PARENT_RE` beside `SUB_ISSUE_RE`, add `parseParent` after `parseSubIssues`, add to `module.exports`)
- Modify: `plugin/bin/lib/issues/record.js` (destructure `parseParent` from `./record-dependencies` and add it to `module.exports` next to `parseSubIssues`)
- Test: `tests/bin-lib/issues/record.test.js` (add `parseParent` to the existing require on line ~7; add tests after the `parseSubIssues` block, ~line 805)

**Interfaces:**
- Produces: `parseParent(body: string|null|undefined) -> number|null`, exported from both `plugin/bin/lib/issues/record-dependencies.js` and `plugin/bin/lib/issues/record.js`.

- [ ] **Step 1: Write the failing tests**

```js
test('AC1.1: parseParent reads a line-anchored Parent line', () => {
  assert.strictEqual(parseParent('Surface: backend\nParent: #12\n\n## Current State'), 12);
  assert.strictEqual(parseParent('Parent: #12\r\nSurface: backend'), 12);
  assert.strictEqual(parseParent('Parent: #12\nParent: #34\n'), 12);
});

test('AC1.2: parseParent ignores a mid-line mention and a body with no Parent line', () => {
  assert.strictEqual(parseParent('see Parent: #12'), null);
  assert.strictEqual(parseParent('Surface: backend\n\n## Current State'), null);
});

test('AC1.3: parseParent returns null for a null or empty body', () => {
  assert.strictEqual(parseParent(null), null);
  assert.strictEqual(parseParent(undefined), null);
  assert.strictEqual(parseParent(''), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node -e "const {parseParent}=require('./plugin/bin/lib/issues/record');if(parseParent('Parent: #12')!==12)process.exit(1)"`
Expected: FAIL — `parseParent is not a function` (then `node --test tests/bin-lib/issues/record.test.js` shows the three new tests failing)

- [ ] **Step 3: Implement `parseParent(body)` in `record-dependencies.js`**

Non-string or empty body → `null`; otherwise `body.match(PARENT_RE)` (non-global, so first match) → `Number(m[1])` or `null`. Add a one-line comment in the file's style naming the writer (`/specify`'s `Parent: #N` metadata line under `work-links: body-text`). Re-export through `record.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/record.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-dependencies.js plugin/bin/lib/issues/record.js tests/bin-lib/issues/record.test.js
git commit -m "Add parseParent body-text parser — refs #4551"
```

---

### Task 2: `work-links` branch in `acceptance-labeling`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js` — `resolveParent` (~line 683), `enumerateSubIssues` (~line 712), new `resolveWorkLinks` beside `resolveRiskFloor` (~line 739), the `acceptance-labeling` handler (~line 826); update the comment block above `resolveParent` to name both link models; import `parseParent, parseSubIssues` from `../issues/record` (it already imports from that module)
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js`
- Test: `tests/accept-label-reader-conformance.test.js` (Step 1c fixture migration only)

**Interfaces:**
- Consumes: `parseParent(body) -> number|null` (Task 1); `parseSubIssues(body) -> number[]` (existing).
- Produces:
  - `resolveWorkLinks(repoRoot: string) -> 'native'|'body-text'` (module-local)
  - `resolveParent(n: number, deps, cwd, workLinks = 'native') -> { ok: true, parent: number|null } | { ok: false, error: string }`
  - `enumerateSubIssues(parent: number, deps, cwd, workLinks = 'native') -> { ok: true, subIssues: {number, state, labels: string[]}[] } | { ok: false, error: string }`

Behavior to implement:
- `resolveParent` body-text: `deps.gh(['issue', 'view', String(n), '--json', 'body'], cwd)`, `JSON.parse`, `{ ok: true, parent: parseParent(data.body) }`. A throw or parse failure → `{ ok: false, error: \`gh issue view (body) failed for #${n} (${msg})\` }`. No `git remote` call and no GraphQL call on this path.
- `enumerateSubIssues` body-text: fetch the parent body the same way; `parseSubIssues(body)`; empty → `{ ok: false, error: \`no sub-issues enumerated for parent #${parent}\` }` (same text as native). Then one `deps.gh(['issue', 'view', String(s), '--json', 'state,labels'], cwd)` per sub-issue (per-number, not `gh issue list` — its default 30-row limit would silently truncate); a throw, unparseable JSON, or non-string `state` → `{ ok: false, error }`. Map to `{ number: s, state: state.toUpperCase(), labels: labels.map((l) => l.name) }`.
- Handler: `const workLinks = resolveWorkLinks(repoRoot);` once, after `checkIssues` is non-empty and before the resolve loop; pass it to both calls.
- Handler, resolve loop reshaped for the Decisions (Reading A + B), per run record `n`:
  1. `resolveParent(n, …, workLinks)`; `!ok` → gather failure, `continue`.
  2. When a parent `p` resolved, enumerate it through a per-parent cache (`enumerations: Map<p, result>`), so `p` is fetched once however many run records name it, and every one of those records is membership-checked (ruling (a)). `!ok` → gather failure, `continue` (ruling (b)). On success, `parentSubIssues.set(p, …)` exactly as today (run records forced `CLOSED`).
  3. Body-text only: when `p`'s enumerated list does not contain `n`, push `#${n}: Parent: #${p} line not in #${p}'s task list — mismatch, not counted in #${p}'s gate; checked as its own target` to `mismatches` and make `n` its own (non-parent) target.
  4. Otherwise the target is `p` (parent) or `n` (no parent), deduped by target as today.
  Append `mismatches` to the detail of every return after the `gatherFailures` early return (fail, all-skipped skip, pass). The gate input is untouched: the unlisted record is not in the enumerated list, so it is already absent from it. Note the dedup moves after enumeration: today a second record sharing a parent `continue`s before it is enumerated; the cache keeps the one-fetch-per-parent property.

- [ ] **Step 1: Write the failing tests (native fixture migration + body-text tests)**

**1a — migrate the existing native fixtures to an explicit native policy.** These fixtures pass a policy-less `makeCleanRepoRoot()` and would flip to the body-text default. Add a helper `writePolicy(repoRoot, raw)` (mkdir `.claude-tweaks`, write `policy.yml`) and use it so each writes `work-links: native\n` (prepended to any `policyRaw` it already takes). Assertions stay unchanged:
- `acceptance-labeling check renders unknown -- not fail -- when a parent-resolution gh call throws` (~line 385)
- `parentGateRow` (~line 1800) — always write `'work-links: native\n' + (policyRaw || '')`
- `twoParentRow` (~line 1950)
- `acceptance-labeling check runs its gh probe, issue view, and comments calls … against the injected cwd, not repoRoot` (~line 2640) — write it to `repoRoot` (policy is read from repoRoot, not cwd)

Tests that pass no `repoRoot` read `process.cwd()`'s real policy (`work-links: native` in this repo) and need no change.

**1b — body-text tests.** Add after the `twoParentRow` tests a fixture helper:

```js
// #4551: work-links body-text fixture. bodies: { [n]: body string | null };
// states: { [n]: { state, labels: string[] } } in gh's real shape.
function bodyTextRow({ records, bodies, states = {}, parentLabels = [], parentComments = [], policyRaw = 'work-links: body-text\n', bodyThrows = false }) {
  // runDir + repoRoot (writePolicy when policyRaw !== null); writeSpecFile per record;
  // fakeGh records calls and answers:
  //   ['--version'] -> 'gh version 2.0.0'
  //   isGraphqlCall -> parentGraphqlResponse(n, null)   (must not be reached on body-text)
  //   issue view N --json body -> bodyThrows ? throw : JSON.stringify({ body: bodies[N] ?? '' })
  //   issue view N --json state,labels -> JSON.stringify({ state, labels: labels.map((name) => ({ name })) })
  //   labels,comments -> JSON.stringify({ labels: parentLabels.map((name) => ({ name })), comments: parentComments })
  // returns { row, calls, deps, repoRoot }
}
```

Tests (fixture for AC2/AC3: `records: [20]`, `bodies: { 20: 'Surface: backend\nParent: #12\n', 12: '- [x] #20\n- [ ] #21\n' }`, `states: { 20: { state: 'OPEN', labels: ['risk:high'] }, 21: { state: 'open', labels: ['risk:high'] } }`):

```js
test('AC2.1/AC2.2: body-text resolveParent reads the Parent line and targets the parent', () => {
  // direct: resolveParent(20, deps, cwd, 'body-text') deepStrictEqual { ok: true, parent: 12 }
  // and calls.filter(isGraphqlCall).length === 0
  // via runVerify: assert.doesNotMatch(row.detail, /#20: missing demo:pending label/)
});
test('AC3.1: body-text parent gate not due with one sibling open', () => {
  // row.result === 'skip'; row.detail matches /parent gate #12 not due — 1 sibling sub-issue\(s\) open/
});
test('body-text enumerateSubIssues upper-cases state and reduces labels to names', () => {
  // enumerateSubIssues(12, deps, cwd, 'body-text') deepStrictEqual
  // { ok: true, subIssues: [{ number: 20, state: 'OPEN', labels: ['risk:high'] }, { number: 21, state: 'OPEN', labels: ['risk:high'] }] }
});
test('AC4.1: body-text record with no Parent line is checked as its own target', () => {
  // bodies: { 20: 'Surface: backend\n' }; resolveParent -> { ok: true, parent: null };
  // row.result === 'fail', detail matches /#20: missing demo:pending label/; the labels,comments call targets '20'
});
test('body-text record whose body is null resolves parent null', () => {
  // bodies: { 20: null } -> resolveParent(20, …, 'body-text') deepStrictEqual { ok: true, parent: null }
});
test('AC5.1: body-text body fetch throw renders unknown, never fail', () => {
  // bodyThrows: true -> row.result === 'unknown', detail matches /#20: gh issue view \(body\) failed/
});
test('body-text parent with no task list renders unknown', () => {
  // bodies: { 20: 'Parent: #12\n', 12: 'no task list' } -> 'unknown', /no sub-issues enumerated for parent #12/
});
test('body-text sub-issue state fetch failure renders unknown', () => {
  // states missing for 21 and the fake throws for it -> 'unknown', detail names #21
});
test('body-text parent shared by two run records is enumerated once', () => {
  // records: [20, 21], both bodies 'Parent: #12'; parent body '- [ ] #20\n- [ ] #21\n';
  // exactly one 'issue view 12 --json body' call
});
test('AC6.1: explicit native issues no body fetch', () => {
  // parentGateRow({ records: [900], subIssues: [...due, risk:high...] }) -> calls with '--json' 'body' count 0
  // and a sub-issue body carrying 'Parent: #12' is never read
});
test('AC7.1: no policy.yml takes the body-text path', () => {
  // bodyTextRow({ …AC2 fixture…, policyRaw: null }) -> at least one '--json body' call, zero isGraphqlCall calls,
  // and the AC3.1 skip detail
});
test('AC10.1/AC11.1: body-text Parent line absent from the parent task list is a logged mismatch, not a gate member, checked as its own target', () => {
  // records: [20, 22]; bodies: { 20: 'Parent: #12\n', 22: 'Parent: #12\n', 12: '- [x] #20\n' };
  // states: { 20: { state: 'OPEN', labels: ['risk:high'] } }; #12's labels,comments: ['demo:pending'] + a trusted confirmed brief;
  // #22's labels,comments: no labels (per-target labels/comments in the fixture: `targetLabels: { [n]: { labels, comments } }`)
  // -> detail matches /#22: Parent: #12 line not in #12's task list — mismatch, not counted in #12's gate; checked as its own target/;
  //    no 'issue view 22 --json state,labels' call (22 never enters the gate);
  //    exactly one 'issue view 12 --json body' call;
  //    the gate is due (only #20, forced CLOSED) so #12 is checked and passes;
  //    #22 IS checked as its own target: an 'issue view 22 --json labels,comments' call, and row.result === 'fail'
  //    with detail matching /#22: missing demo:pending label/ (Reading B)
});
test('AC11.2: a lone unlisted record with demo:pending and a confirmed brief passes with the mismatch note', () => {
  // records: [22]; bodies: { 22: 'Parent: #12\n', 12: '- [ ] #20\n' }; #22 labels ['demo:pending'] + trusted confirmed brief
  // -> row.result === 'pass'; detail matches the mismatch note; no 'issue view 12 --json labels,comments' call (12 is never a target)
});
```

**1c — the label-reader conformance fixture.** `tests/accept-label-reader-conformance.test.js`'s `acceptanceLabelingResult` runs `runVerify` with `repoRoot: runDir` (no `policy.yml`) and a fake `gh` that answers `''` to anything it does not know, so the new body-text default would turn its `issue view 900 --json body` call into an unparseable-JSON gather failure (`unknown`) and break every row. Write `work-links: native\n` to `{runDir}/.claude-tweaks/policy.yml` there; its assertions stay unchanged (it tests the label reader, not the link model). Then sweep: `grep -rln "runVerify\|wrap-up-engine" tests` and, for each hit whose fake `gh` reaches `acceptance-labeling`'s parent resolution (answers `--version` and resolves issue numbers), apply the same one-line policy migration; record each file touched in the task report.

Import `resolveParent, enumerateSubIssues` in the test file's existing `require('../../../plugin/bin/lib/wrap-up/engine-verify')` line.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node -e "const {resolveParent}=require('./plugin/bin/lib/wrap-up/engine-verify');const r=resolveParent(20,{gh:()=>JSON.stringify({body:'Parent: #12'}),git:()=>{throw new Error('no git')}},process.cwd(),'body-text');if(!r.ok||r.parent!==12)process.exit(1)"`
Expected: FAIL — exit 1 (today's native-only `resolveParent` calls `git remote` and returns `ok: false`). Then `node --test --test-name-pattern="body-text|AC6.1|AC7.1" tests/bin-lib/wrap-up/engine-verify.test.js` shows the body-text tests failing (AC6.1 may already pass).

- [ ] **Step 3: Implement `resolveWorkLinks`, the two body-text branches, and the handler wiring per the behavior list above**

- [ ] **Step 4: Run the whole suite file**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: PASS, 0 failures (new tests and every migrated native test)

- [ ] **Step 5: Prove revert-to-red (AC8.1)**

Temporarily make `resolveParent` and `enumerateSubIssues` ignore `workLinks` (always native), run Step 2's `node --test --test-name-pattern` command (extend the pattern with `AC10.1|AC11.2`), and record that every body-text test (AC2.1/AC2.2, AC3.1, AC4.1 own-target, AC5.1, AC7.1, AC10.1/AC11.1, AC11.2, null body, no task list, state fetch failure, shared parent, enumerate upper-case) fails; then restore. Quote the failing test names in the task report. Do not commit the revert.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/wrap-up/engine-verify.js tests/bin-lib/wrap-up/engine-verify.test.js tests/accept-label-reader-conformance.test.js
git commit -m "Resolve body-text parents in acceptance-labeling — refs #4551"
```

The full `npm test` (AC9.1) runs centrally in the pipeline's `/claude-tweaks:test` step, not inside this task.

---

### Task 3: One `Parent:` parser — move `parent-gate.js` and `mcp-parent-gate-shape.js` onto `parseParent`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/parent-gate.js` (import `parseParent` beside `parseSubIssues` from `./record`; body-text `resolveParent` returns `parseParent(String(caller.call([...])))`; delete the `PARENT_LINE_RE` constant and its `module.exports` entry; header comment shape 1 names `parseParent`)
- Modify: `plugin/bin/lib/issues/mcp-parent-gate-shape.js` (import `parseParent` from `./record`; drop `PARENT_LINE_RE` from the `./parent-gate` import; body-text `resolveParent` returns `parseParent(entry.body)`)
- Test: `tests/bin-lib/issues/parent-gate.test.js`, `tests/bin-lib/issues/mcp-parent-gate-shape.test.js`, `tests/bin-lib/issues/below-floor-parent-close.test.js` (run only; their `Parent: #10` fixtures already pin the body-text resolution)

**Interfaces:**
- Consumes: `parseParent(body) -> number|null` (Task 1).
- Produces: no new export; `PARENT_LINE_RE` leaves `parent-gate.js`'s exports (no other consumer: `grep -rn PARENT_LINE_RE plugin tests` names only these two files).

- [ ] **Step 1: Confirm the consumer set**

Run: `grep -rn "PARENT_LINE_RE" plugin tests`
Expected: hits only in `plugin/bin/lib/issues/parent-gate.js` and `plugin/bin/lib/issues/mcp-parent-gate-shape.js`.

- [ ] **Step 2: Swap both reads onto `parseParent` and delete `PARENT_LINE_RE`**

- [ ] **Step 3: Run the three suites**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js tests/bin-lib/issues/mcp-parent-gate-shape.test.js tests/bin-lib/issues/below-floor-parent-close.test.js`
Expected: PASS, 0 failures; and `grep -rn "PARENT_LINE_RE" plugin tests` prints nothing.

- [ ] **Step 4: Commit**

```bash
git add plugin/bin/lib/issues/parent-gate.js plugin/bin/lib/issues/mcp-parent-gate-shape.js
git commit -m "Read Parent lines through parseParent in the parent gate — refs #4551"
```
