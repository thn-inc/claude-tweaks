# Shipped-Candidate Follow-Up Exclusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `classifyShipped` from rating a record `strong` (already shipped) on a mention from a PR that was already open when the record was filed — that record is the PR's own follow-up, never its target.

**Architecture:** The batched cross-reference timeline query (`buildLinkedPRQuery`) additionally selects each source PR's `createdAt`; `fetchLinkedPRs` passes it through on every `mentions[]` entry; `classifyShipped` skips a mention whose PR `createdAt` is strictly earlier than the record's own `createdAt`. A mention with no `createdAt` (older response shape, fixtures) keeps today's behavior. Dispatch prose states the new exclusion.

**Tech Stack:** Node 18+ CommonJS, `node --test`, GitHub GraphQL (via injected runner).

**Spec:** `.claude-tweaks/pipelines/2026-10-25T160939-record-4314/work/4314-spec.md` (record #4314)

Premise-refs: plugin/bin/lib/issues/record-dependencies.js
Premise-refs: plugin/bin/lib/issues/linked-prs.js
Premise-refs: plugin/bin/lib/issues/shipped-candidate.js

## Global Constraints

- A mention with no `createdAt` keeps today's behavior (spec Deliverables, bullet 2).
- The exclusion compares the mentioning PR's `createdAt` against the record's `createdAt`: PR opened before the record was created → skip the mention entirely (it contributes no tier, not even `weak`).
- `plugin/skills/dispatch/queue-pull-script.md` is at 51674 bytes against `RAIL_BYTES` 52500 (826 bytes headroom): net growth of that file in this plan must stay ≤ 300 bytes. Remedy named up front: replace the stale sentence "When #1983's own "named target no longer exists" step lands, it inserts between the two, per that record's own ordering rule; this record does not implement #1983." in the `# #1984:` comment block (#1983 landed — its pass already sits between the two) with the new exclusion sentence.
- `plugin/skills/dispatch/SKILL.md` is at 48020 bytes (≥90% of the rail — soft flag): add at most one sentence.
- Commit messages: `{Verb} {what} — {detail}`, `refs #4314` (never closes/fixes), trailer `Claude-Session: https://claude.ai/code/session_011PxqhDJqgUgFWvEZmruaq3`.

## Verified premises (probed live 2026-10-25, before authoring)

Ran the timeline query with `createdAt` added to the `... on PullRequest` selection against `thn-inc/claude-tweaks`:
- #4135 `createdAt` 2026-10-24T12:33:49Z; PR #4035 `createdAt` 2026-10-24T08:24:28Z, `mergedAt` 2026-10-24T15:39:27Z.
- #4191 `createdAt` 2026-10-24T17:26:44Z; PR #4144 `createdAt` 2026-10-24T15:40:05Z, `mergedAt` 2026-10-24T18:52:32Z.

So `PullRequest.createdAt` resolves on a `CrossReferencedEvent.source` and the record's cited timestamps are accurate.

## Review Focus

1. A record created at the exact same instant the PR opened — not "before", so the mention still counts (strict `<`). Pinned in Task 2.
2. An unparseable `createdAt` string on the mention (`new Date(x).getTime()` → `NaN`) — must keep today's behavior, never silently drop. Pinned in Task 2.
3. A record with no `createdAt` at all — the comparison has no basis; keep today's behavior. Pinned in Task 2.
4. A record with two merged mentions, the opened-before one excluded and an independent later PR still `strong` — the exclusion is per mention, not per record. Pinned in Task 2.
5. The query pin `merged mergedAt repository \{ nameWithOwner \}` in `tests/bin-lib/issues/record.test.js` — the new field must not be inserted between those tokens (place `createdAt` after `state`). Covered by Task 1's run of `record.test.js`.

---

### Task 1: Select and pass through the mentioning PR's `createdAt`

**Files:**
- Modify: `plugin/bin/lib/issues/record-dependencies.js` (`buildLinkedPRQuery`, and its #1984 comment block)
- Modify: `plugin/bin/lib/issues/linked-prs.js` (`fetchLinkedPRs`'s `mentions` map, and the header comment's `mentions: {number, title, state, merged, mergedAt}[]` shape)
- Test: `tests/bin-lib/issues/linked-prs.test.js`
- Test: `tests/bin-lib/issues/record.test.js`

**Interfaces:**
- Produces: each `fetchLinkedPRs(...).get(n).mentions[i]` is `{ number, title, state, merged, mergedAt, createdAt }`, `createdAt` a string (ISO-8601) or `null` when the response lacks it. `buildLinkedPRQuery` selects `number title state createdAt merged mergedAt repository { nameWithOwner }` inside `... on PullRequest`.

Return-shape widening check: the only object-literal pins on a `mentions` entry are `tests/bin-lib/issues/linked-prs.test.js`'s 'a same-repo PR mention (no closing keyword) is returned in mentions' (must gain `createdAt`); `tests/resolve-linked-prs-cli.test.js` only pins `mentions: []` (unaffected — `resolve-linked-prs.js` passes `mentions` through whole).

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/issues/linked-prs.test.js`:
- Update the existing test 'a same-repo PR mention (no closing keyword) is returned in mentions' so the fixture source carries `createdAt: '2026-09-02T00:00:00Z'` and the expected mention is `{ number: 1803, title: 'Fix context.js resolveRun fallback', state: 'MERGED', merged: true, mergedAt: '2026-09-03T00:00:00Z', createdAt: '2026-09-02T00:00:00Z' }`.
- Add `test('AC3.1: #4314 fetchLinkedPRs returns the mentioning PR createdAt on each mention, null when the response lacks it', ...)`: one alias with two same-repo PR sources, one with `createdAt: '2026-10-24T08:24:28Z'` (number 4035), one without the field (number 4144); assert `mentions.map((m) => m.createdAt)` deep-equals `['2026-10-24T08:24:28Z', null]`.

In `tests/bin-lib/issues/record.test.js`, add to the existing 'buildLinkedPRQuery also requests the cross-reference timeline…' test: `assert.match(q, /\.\.\. on PullRequest \{ number title state createdAt merged mergedAt/);`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/linked-prs.test.js tests/bin-lib/issues/record.test.js`
Expected: FAIL — the updated mention assertion lacks `createdAt` in actual output, the AC3.1 test gets `[undefined, undefined]`-shaped mismatch, and the query regex does not match.

- [ ] **Step 3: Implement**

`buildLinkedPRQuery`: insert `createdAt` after `state` in the `... on PullRequest { … }` selection. Extend its #1984 comment with one line: `#4314: also selects the source PR's createdAt — classifyShipped skips a mention whose PR was already open when the record was filed.`
`fetchLinkedPRs`: add `createdAt: pr.createdAt || null` to the mention object; update the header-comment shape to `{number, title, state, merged, mergedAt, createdAt}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/linked-prs.test.js tests/bin-lib/issues/record.test.js tests/resolve-linked-prs-cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-dependencies.js plugin/bin/lib/issues/linked-prs.js tests/bin-lib/issues/linked-prs.test.js tests/bin-lib/issues/record.test.js
git commit -m "Select the mentioning PR's createdAt — linked-PR timeline query and fetchLinkedPRs pass it through, refs #4314"
```

### Task 2: `classifyShipped` skips a mention from a PR already open when the record was filed

**Files:**
- Modify: `plugin/bin/lib/issues/shipped-candidate.js` (`classifyShipped` loop + its doc comment)
- Test: `tests/bin-lib/issues/shipped-candidate.test.js`

**Interfaces:**
- Consumes: Task 1's `mention.createdAt` (string | null | absent).
- Produces: `classifyShipped(record, mentions, opts)` signature and return shape unchanged; a mention with `createdAt` parsing to a time strictly earlier than `record.createdAt` is skipped (`continue`), exactly like the existing merged-before-created skip.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/issues/shipped-candidate.test.js`. Fixture helpers: reuse the file's `withKeyFiles`. #4135-shaped record: `{ number: 4135, title: 'verify-scope declaration.js previous-release reader check', createdAt: '2026-10-24T12:33:49Z', body: withKeyFiles(['plugin/bin/lib/verify-scope/declaration.js', 'tests/verify-scope-declaration.test.js']) }`; mention `{ number: 4035, title: 'Unrelated build PR title for #4024', state: 'MERGED', merged: true, mergedAt: '2026-10-24T15:39:27Z', createdAt: '2026-10-24T08:24:28Z' }`; `prFiles = new Map([[4035, [both key files, 'docs/plugin-structure.md']]])`.

Tests (names carry the AC ids):
- `AC1.1: #4135 shape — a record filed while the mentioning PR was already open classifies none for that mention` → `assert.deepStrictEqual(classifyShipped(record, mentions, { prFiles }), { tier: 'none', pr: null, signals: [] })`.
- `AC2.1: the same signals with the record created before the PR opened still classify strong` → record `createdAt: '2026-10-24T07:00:00Z'`; expect `tier: 'strong'`, `pr: 4035`, `signals` includes `'key-files-covered'`.
- `AC2.2: a mention missing createdAt classifies exactly as today` → the #4135 record + the mention with `createdAt` deleted; expect `strong`, `pr: 4035`, `signals` deep-equal `['merged-pr-mention-after-created', 'key-files-covered']`.
- `#4314: a record created at the exact instant the PR opened is not "before" — the mention still counts` → record `createdAt` === mention `createdAt` (`'2026-10-24T08:24:28Z'`); expect `strong`.
- `#4314: an unparseable mention createdAt keeps today's behavior` → mention `createdAt: 'not-a-date'`; expect `strong`.
- `#4314: a record with no createdAt keeps today's behavior` → record without `createdAt`; expect `strong`.
- `#4314: the exclusion is per mention — an opened-before follow-up mention is skipped while a later independent PR still classifies strong` → mentions `[the 4035 mention, { number: 4400, title: <record's own title>, state: 'MERGED', merged: true, mergedAt: '2026-10-25T10:00:00Z', createdAt: '2026-10-25T09:00:00Z' }]`; expect `strong`, `pr: 4400`.

AC1.1's "goes red when the new check is reverted": proven at Step 4b below by reverting the implementation and observing AC1.1 fail (the pre-change code returns `strong`, pr 4035).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/shipped-candidate.test.js`
Expected: FAIL after Step 1 — AC1.1 gets `tier: 'strong'` (the other new tests pass already: they pin unchanged behavior).

- [ ] **Step 3: Implement the exclusion in `classifyShipped`**

Inside the mention loop, after the existing merged-before-created skip: when `recordCreatedAtMs !== null` and `mention.createdAt` is truthy, compute `prCreatedAtMs = new Date(mention.createdAt).getTime()`; `if (prCreatedAtMs < recordCreatedAtMs) continue;` (`NaN < x` is false, so an unparseable value falls through to today's behavior). Extend the function's doc comment with: the mention is skipped when its PR was already open before the record was created — a record filed during a PR's build is that PR's by-product (#4314: #4135/PR #4035, #4191/PR #4144); a mention with no `createdAt` keeps the prior behavior.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/shipped-candidate.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 4b: Prove AC1.1 discriminates**

Temporarily comment out the new `continue` line, run `node --test tests/bin-lib/issues/shipped-candidate.test.js`, confirm AC1.1 (only) fails with actual `tier: 'strong'`, restore the line, re-run to PASS. Quote both raw outputs' summary lines in the task report. Do not commit the reverted state.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/shipped-candidate.js tests/bin-lib/issues/shipped-candidate.test.js
git commit -m "Skip a shipped-candidate mention from a PR already open when the record was filed — follow-ups stop reading as shipped, refs #4314"
```

### Task 3: State the new exclusion in the dispatch prose

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (the `reason: 'shipped'` bullet near the top, and the `# #1984: shipped-candidate classification.` comment block)
- Modify: `plugin/skills/dispatch/SKILL.md` (the `**False-positive posture (#1984).**` paragraph)
- Test: `tests/dispatch-shipped-candidate-prose.test.js`

**Interfaces:**
- Consumes: Task 2's behavior (prose describes it; no code coupling).

- [ ] **Step 1: Write the failing test**

Add to `tests/dispatch-shipped-candidate-prose.test.js`:

```js
test('#4314: both dispatch files state that a mention from a PR already open when the record was filed is skipped', () => {
  const section = QUEUE_PULL.slice(QUEUE_PULL.indexOf('#1984: shipped-candidate classification'));
  assert.match(section.slice(0, 2000), /#4314/);
  assert.match(section.slice(0, 2000), /opened before the record was created/);
  assert.match(DISPATCH_SKILL, /opened before the record was created/);
  assert.match(DISPATCH_SKILL, /#4314/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-shipped-candidate-prose.test.js`
Expected: FAIL — `opened before the record was created` absent from both files.

- [ ] **Step 3: Edit the prose (byte budget: queue-pull-script.md net ≤ +300 bytes; SKILL.md one sentence)**

`queue-pull-script.md`, `# #1984:` comment block: replace the stale three-line sentence "When #1983's own "named target no longer exists" step lands, … does not implement #1983." with:
`# #4314: classifyShipped skips a mention whose PR was opened before the`
`# record was created -- a follow-up filed during that PR's build, never its target.`
`queue-pull-script.md`, `reason: 'shipped'` bullet: append ` A mention from a PR opened before the record was created never counts (#4314).`
`SKILL.md`, False-positive posture paragraph: after "two independent signals, never one alone." insert: `A mention from a PR opened before the record was created never counts (#4314): a record filed during a PR's build is that PR's follow-up, not its target.`

- [ ] **Step 4: Run tests and measure**

Run: `node --test tests/dispatch-shipped-candidate-prose.test.js` → PASS.
Run: `wc -c plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/SKILL.md` → queue-pull-script.md ≤ 51974, both < 52500.
Run: `node --test tests/skill-size-single-source.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/bin-lib/skill-audit/budgets.test.js` (rail tests) → PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/SKILL.md tests/dispatch-shipped-candidate-prose.test.js
git commit -m "State the opened-before-created shipped-candidate exclusion in dispatch prose — queue pull and False-positive posture, refs #4314"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (query selects createdAt, fetchLinkedPRs passes it) | Task 1 |
| Deliverable 2 (classifyShipped skip; no-createdAt keeps behavior) | Task 2 |
| Deliverable 3 (dispatch prose) | Task 3 |
| AC1.1 | Task 2 (test + Step 4b revert proof) |
| AC2.1, AC2.2 | Task 2 |
| AC3.1 | Task 1 |
| AC4.1 | Task 3 Step 4 (prose test); full `npm test` runs at `/build` Common Step 5 |

## Build deviations (Common Step 4.5 — classified Beneficial)

1. **Test files beyond the spec's Key Files.** `tests/bin-lib/issues/record.test.js` (pins the query selection, Deliverable 1) and `tests/dispatch-shipped-candidate-prose.test.js` (pins the prose, Deliverable 3) were extended though the spec's `### Key Files` names neither — each is the existing pin file for its deliverable, so the deliverable stays guarded.
2. **Adjacent prose accuracy, from the whole-branch review fix wave (ac6b46b82).** Beyond stating the exclusion, the queue-pull `# #1984:` comment now says the pass runs after both the #1224 open-PR and #1983 target-missing exclusions, and SKILL.md's residual-false-negative sentence names the new accepted false negative (a PR already open at filing that only says "refs #N"). Both keep the edited paragraphs truthful about the behavior this record changed.
3. **Task 3 comment layout.** The plan's two-line `# #4314:` comment split the pinned phrase across a line break; the shipped comment keeps the same wording with the phrase on one line (SDD ruling, staged as `staged/sdd-ruling-1.md`).
