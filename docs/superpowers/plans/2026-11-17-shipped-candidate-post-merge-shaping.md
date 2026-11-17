# Shipped-candidate downgrade for post-merge shaping or grant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A record shaped to `ready` or granted `auto:build` after the mentioning PR merged rates `weak` at most in dispatch's shipped-candidate pass, the same way a claim release after the merge does (#4432).

**Architecture:** The queue pull's one batched linked-PR GraphQL call (`buildLinkedPRQuery`) gains an aliased `LABELED_EVENT` timeline; `fetchLinkedPRs` reduces it to `lastShapedAt` (the latest `ready`/`auto:build` label time) on each entry, and `resolve-linked-prs.js` prints it into `dispatch-linked-prs.json`. `classifyShipped` takes `opts.lastShapedAt` and marks an earlier-merged mention `predates-shaping`, capped at `weak`. The queue-pull module and its retained fence twin pass the value at both call sites and log the kept record.

**Tech Stack:** Node 18+ CommonJS, `node --test`, GitHub GraphQL via `gh api graphql`.

**Spec:** `.claude-tweaks/pipelines/2026-11-17T181818-spec-5408-5722/spec-5722/work/5722-spec.md`

## Global Constraints

- The safe direction is a downgrade; a missing or unparseable event time never downgrades and never upgrades (the #4432 rule, AC3).
- No per-record timeline call: the label events ride in `buildLinkedPRQuery`'s existing batched aliased call.
- Only the label names `ready` and `auto:build` count as shaping or grant events, from any actor (a headless or bot grant included — spec's Plan Review Clarifications).
- Reading the mention's wording was considered and not chosen: free-text negation is fragile.
- `queue-pull.js` is the live pull; `plugin/skills/dispatch/queue-pull-script.md`'s fence is its parity oracle — mirror every change into the fence (module header lines 6-8), never the other way round.
- Commit subjects `{Verb} {what} — {detail} (#5722)`; every commit ends with the line `Claude-Session: https://claude.ai/code/session_01UwjosFcjLaMeHtuk6ho4QA`.
- Worktree shell rule: one plain command per Bash call, no `&&`/`;`/`$(...)`/heredoc; use `git -C "{worktree}"` and absolute paths.

Scope keywords: lastReleasedAt, predatesClaimRelease, buildLinkedPRQuery, hasClosingPRReference

Real-input probe (done at plan time, #5689 live): `timelineItems(itemTypes:[LABELED_EVENT])` returned 22 events; `ready` at `2026-11-16T10:50:38Z`, `auto:build` at `2026-11-16T10:51:03Z`; PR #5700 `mergedAt` `2026-11-16T10:43:57Z`. A `last:20` window dropped the `ready` event (bot `fix-on-worktree-*` labels crowd it out), so the query uses `last:100`, GitHub's page maximum. Expected `lastShapedAt` for #5689: `2026-11-16T10:51:03Z`.

## Review Focus

1. A label event for any other label (`risk:low`, `bot:in-progress`, `fix-on-worktree-*`) after the merge must not downgrade — Task 1 test `#5722: lastShapedAt ignores labels other than ready and auto:build`.
2. A `LabeledEvent` whose `label` is `null` (label deleted since) or whose `createdAt` is unparseable must be skipped, not crash and not count — Task 1 test `#5722: a null label or unparseable createdAt is skipped`.
3. A response with no `labelEvents` connection (an older fixture, a partial answer) yields `lastShapedAt: null`, never a throw — Task 1 test `#5722: no labelEvents connection gives lastShapedAt null`.
4. A record both released and shaped after the merge prints the claim-release kept line (the existing #4432 text), once — Task 3 test `#5722 shipped: release and shaping both after the merge print the claim-release kept line`.
5. A shaping event at the exact merge instant is not after it, so no downgrade — Task 2 test `AC3.1: a shaping time at the exact merge instant does not downgrade`.

---

### Task 1: Fetch the latest shaping-or-grant time in the linked-PR batch

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/record-dependencies.js:329-331` (`buildLinkedPRQuery`, plus a `#5722` paragraph in the comment block above it)
- Modify: `plugin/bin/lib/issues/linked-prs.js:59-89` (`fetchLinkedPRs` entry)
- Modify: `plugin/bin/resolve-linked-prs.js:48-58` (`mapResult` adds `lastShapedAt`; update its comment)
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js:255-281` (one source of truth, `spec.lastShapedAt`: `linkedNode` emits `labelEvents: { nodes: [{ createdAt: spec.lastShapedAt, label: { name: 'auto:build' } }] }` when it is set, else `{ nodes: [] }`; `linkedOutput` emits `lastShapedAt: spec.lastShapedAt || null` — so the oracle's real CLI and the module's fake agree)
- Test: `tests/bin-lib/issues/record.test.js`
- Test: `tests/bin-lib/issues/linked-prs.test.js`
- Test: `tests/resolve-linked-prs-cli.test.js`

**Interfaces:**
- Produces: each `fetchLinkedPRs` Map entry gains `lastShapedAt: string|null` — the raw `createdAt` string of the latest-instant `LabeledEvent` whose `label.name` is `ready` or `auto:build`, or `null` when none parses. `resolve-linked-prs.js` prints `{ openPR, mentions, hasClosingPRReference, lastShapedAt }` per number, so `dispatch-linked-prs.json` entries carry `lastShapedAt`.
- Query shape: inside each `issue(number:N){…}` alias add `labelEvents: timelineItems(itemTypes:[LABELED_EVENT], last:100){ nodes{ ... on LabeledEvent { createdAt label { name } } } }` (the alias is required: the existing unaliased `timelineItems` takes different arguments).

- [ ] **Step 1: Write the failing tests**

`record.test.js`: `#5722: buildLinkedPRQuery requests the aliased LABELED_EVENT timeline (last:100) with createdAt and label name` — assert the query for `[5689]` matches `/labelEvents:\s*timelineItems\(itemTypes:\[LABELED_EVENT\], last:100\)/` and contains `... on LabeledEvent { createdAt label { name } }`.

`linked-prs.test.js` (runner returns a canned `data.repository.i{n}` node):
- `AC1.1: #5689's real label timeline gives lastShapedAt 2026-11-16T10:51:03Z` — nodes `risk:low`@`10:50:38Z`, `ready`@`10:50:38Z`, `auto:build`@`10:51:03Z`, `bot:in-progress`@`10:58:00Z` (all `2026-11-16T…Z`) → `lastShapedAt === '2026-11-16T10:51:03Z'`.
- `#5722: lastShapedAt ignores labels other than ready and auto:build` — only `bot:in-progress`/`risk:low` events → `null`.
- `#5722: a null label or unparseable createdAt is skipped` — `{createdAt:'2026-11-16T12:00:00Z', label:null}`, `{createdAt:'not-a-date', label:{name:'ready'}}`, `{createdAt:'2026-11-16T09:00:00Z', label:{name:'auto:build'}}` → `'2026-11-16T09:00:00Z'`.
- `#5722: lastShapedAt compares instants, not strings` — `ready`@`2026-11-16T13:00:00+02:00` (11:00Z) and `auto:build`@`2026-11-16T12:00:00Z` → `'2026-11-16T12:00:00Z'`.
- `#5722: no labelEvents connection gives lastShapedAt null`.

`resolve-linked-prs-cli.test.js`: `#5722: the CLI prints lastShapedAt beside openPR, mentions and hasClosingPRReference`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/linked-prs.test.js tests/resolve-linked-prs-cli.test.js`
Expected: FAIL after Step 1 — the five new tests (no `labelEvents` in the query, `lastShapedAt` undefined).

- [ ] **Step 3: Implement**

Add the aliased connection to `buildLinkedPRQuery`; in `fetchLinkedPRs` reduce `node.labelEvents && node.labelEvents.nodes` (non-array → none) to `lastShapedAt` by `new Date(createdAt).getTime()`, skipping `NaN` and non-matching or missing `label`; add it to the entry. Add `lastShapedAt` to `resolve-linked-prs.js`'s `mapResult`. Then update the existing exact-shape pins that the widened entry breaks — every `deepStrictEqual`/`deepEqual` on a whole entry in `tests/bin-lib/issues/linked-prs.test.js` (lines 14, 15, 40, 56, 82, 130) and `tests/resolve-linked-prs-cli.test.js` (lines 97, 115, 126, 146-147) gains `lastShapedAt: null`; and `queue-pull-fixtures.js`'s `linkedNode`/`linkedOutput` as listed under Files, so the oracle's real CLI output and the module's fake agree.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/linked-prs.test.js tests/resolve-linked-prs-cli.test.js tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-pull-parity-ac1.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Go-red proof (AC4.1)**

Never `git stash` (the stash is shared). For each of the three source files in turn — `plugin/bin/lib/issues/linked-prs.js` (then run `tests/bin-lib/issues/linked-prs.test.js`), `plugin/bin/lib/issues/record-dependencies.js` (then `tests/bin-lib/issues/record.test.js`), `plugin/bin/resolve-linked-prs.js` (then `tests/resolve-linked-prs-cli.test.js`) — copy the edited file to the scratchpad, write the pre-task version (`git -C "{worktree}" show HEAD:{path}`) over it with the Write tool, run that test file, see its `#5722`/`AC1.1` tests fail, then write the scratch copy back. Quote every failing test name in the task report.

- [ ] **Step 6: Commit**

`git -C "{worktree}" add plugin/bin/lib/issues/record-dependencies.js plugin/bin/lib/issues/linked-prs.js plugin/bin/resolve-linked-prs.js tests/bin-lib/dispatch/queue-pull-fixtures.js tests/bin-lib/issues/record.test.js tests/bin-lib/issues/linked-prs.test.js tests/resolve-linked-prs-cli.test.js`
Commit: `Fetch each candidate's latest ready/auto:build label time in the linked-PR batch — lastShapedAt (#5722)`

### Task 2: Downgrade a mention that predates the shaping or grant

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/shipped-candidate.js` (`classifyShipped`, `rankOf`, header comment's `opts.lastReleasedAt` paragraph gains an `opts.lastShapedAt` paragraph; export `downgradedAfterMerge`)
- Test: `tests/bin-lib/issues/shipped-candidate.test.js`

**Interfaces:**
- Consumes: `opts.lastShapedAt` — ISO string or null (Task 1's `lastShapedAt`).
- Produces: signal literal `'predates-shaping'` on a mention whose `mergedAt` instant is strictly earlier than `lastShapedAt`'s; such a mention rates `weak` at most, exactly like `'predates-claim-release'`. `downgradedAfterMerge(result) -> boolean` — true when `result.signals` holds either `'predates-claim-release'` or `'predates-shaping'`; `predatesClaimRelease` stays exported and unchanged. `rankOf(tier, downgraded)` ranks a downgraded weak below a plain weak, as today.

- [ ] **Step 1: Write the failing tests** (a `#5689` fixture block after the #4432 block)

```js
const SHAPED_RECORD = { number: 5689, title: 'Windows path test fails on the remaining case', createdAt: '2026-11-16T08:48:37Z', body: withKeyFiles(['a.js']) };
const SHAPED_MENTION = { number: 5700, title: 'Windows path test fails on the remaining case', state: 'MERGED', merged: true, createdAt: '2026-11-16T09:49:23Z', mergedAt: '2026-11-16T10:43:57Z' };
```
- `AC1.1: the #5689 shape (title match, shaped and granted after mergedAt) is not strong` — `lastShapedAt: '2026-11-16T10:51:03Z'` → `tier 'weak'`, signals include `'predates-shaping'` and `'title-similarity'`, `downgradedAfterMerge(r) === true`, `predatesClaimRelease(r) === false`.
- `AC1.1: key-files coverage with a shaping after the merge also classifies weak`.
- `AC2.1: the same fixture with no shaping or grant after mergedAt is still strong` — no `lastShapedAt`, `lastShapedAt: null`, and `lastShapedAt: '2026-11-16T10:00:00Z'` (before the merge) all → `'strong'`.
- `AC3.1: a missing or unparseable shaping time never downgrades and never upgrades` — `'not-a-date'` → strong for the title match; a plain mention (unrelated title) with `'not-a-date'` → `weak` with signals exactly `['merged-pr-mention-after-created']`.
- `AC3.1: a shaping time at the exact merge instant does not downgrade` — `'2026-11-16T10:43:57.000Z'` → strong.
- `#5722: a mention with no mergedAt is not downgraded by a shaping time`.
- `#5722: release and shaping both after the merge carry both signals, weak` — `lastReleasedAt` and `lastShapedAt` after the merge.
- `#5722: downgradedAfterMerge is true only for a downgraded result` — null, `{}`, a strong result, a release-only, a shaping-only.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/issues/shipped-candidate.test.js`
Expected: FAIL after Step 1 — `downgradedAfterMerge` is not a function; the AC1.1 cases return `strong`.

- [ ] **Step 3: Implement** `opts.lastShapedAt` the same way as `lastReleasedAt` (falsy → `NaN`, instants via `Date`), `predatesShaping = mergedAtMs < lastShapedAtMs`, tier `strong` only when `(titleMatch || filesCoverAll) && !predatesRelease && !predatesShaping`, rank with `downgraded = predatesRelease || predatesShaping`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/issues/shipped-candidate.test.js`
Expected: PASS, every existing #4432 test still green.

- [ ] **Step 5: Go-red proof (AC4.1)** — with the scratch-copy method of Task 1 Step 5, restore the pre-task `shipped-candidate.js` but keep a stub export `downgradedAfterMerge` returning `false` so the file loads; run the suite; the `AC1.1` cases must fail; restore. Then the unchanged-behaviour tests, each against its named mutant of the new code (spec's Plan Review Clarifications, AC4 Reading A), one mutant at a time, same scratch-copy method:
  - `AC2.1 … still strong` — mutant M1: downgrade whenever `lastShapedAt` is truthy (drop the `mergedAtMs <` comparison).
  - `AC3.1: a missing or unparseable shaping time …` — mutant M2: coerce a missing or unparseable `lastShapedAt` to `Infinity` (`Number.isNaN(ms) ? Infinity : ms`), so an unreadable time downgrades — the strong-half assertion must fail; the plain-mention half must also fail under mutant M2b, which adds `'predates-shaping'` unconditionally.
  - `AC3.1: a shaping time at the exact merge instant …` — mutant M3: `<=` in place of `<`.
  - `#5722: a mention with no mergedAt is not downgraded …` — mutant M4: treat a missing `mergedAt` as epoch 0 (`new Date(mention.mergedAt || 0)`).
  - `#5722: downgradedAfterMerge is true only for a downgraded result` — mutant M5: `downgradedAfterMerge` returns `predatesClaimRelease(result)` only.
  Quote each test name with the mutant that turned it red.

- [ ] **Step 6: Commit**

`git -C "{worktree}" add plugin/bin/lib/issues/shipped-candidate.js tests/bin-lib/issues/shipped-candidate.test.js`
Commit: `Rate a shipped mention weak when the record was shaped or granted after the merge — predates-shaping (#5722)`

### Task 3: Wire the shaping time through the queue pull, its fence twin and the dispatch prose

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js:1129-1186` (`runShipped`: both `classifyShipped` calls pass `lastShapedAt: entry.lastShapedAt`; probe skip and failed-probe Warning use `downgradedAfterMerge`; kept line)
- Modify: `plugin/skills/dispatch/queue-pull-script.md:466-525` (same three changes, byte-matched; **rail remedy:** the file has 18 bytes of headroom under `RAIL_BYTES`, so the fence edit must be byte-neutral or smaller — cut the bytes the new kept-line branch adds from the same section's own comments (lines 466-470 and 496-497 restate what the module header and `queue-pull-notes.md` already say; compress them to one `# #1984/#4314/#4432/#5722: …` line each), add no new comment sentence, and confirm with `wc -c` against 52500 that the file is still at or under the rail)
- Modify: `plugin/skills/dispatch/SKILL.md:124` (False-positive posture paragraph)
- Modify: `docs/plugin-structure.md` (the `shipped-candidate.js` entry: the shaping downgrade and `downgradedAfterMerge`; the `linked-prs` CLI output if listed)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js`
- Test: `tests/dispatch-shipped-candidate-prose.test.js`
- Review (scope sweep, change only where the file states the shipped tier rule or the linked-PR output shape): `plugin/skills/dispatch/queue-pull-notes.md`, `plugin/skills/dispatch/mcp-transport.md`, `plugin/bin/lib/dispatch/shipped-releases.js` (header comment names the release downgrade only — add one clause pointing at `lastShapedAt` as its sibling if it claims to be the only downgrade source), `docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md`. Consumers of `buildLinkedPRQuery`/`fetchLinkedPRs` that read named fields and are unaffected by an added field, so unchanged: `plugin/bin/lib/issues/near-duplicate.js`, `plugin/bin/lib/issues/record.js` (re-export), `plugin/bin/lib/wrap-up/engine-verify.js`, `plugin/skills/specify/shaping-mode.md`. Report each reviewed file's disposition in the task report.

**Interfaces:**
- Consumes: `dispatch-linked-prs.json` entries' `lastShapedAt` (Task 1); `downgradedAfterMerge` and `predatesClaimRelease` (Task 2).
- Kept-line text (module, second pass), chosen by `predatesClaimRelease(result)` first:
  - release (unchanged): `` ` kept: merged PR #${result.pr} predates claim release at ${releases[c.number]} — remaining work assumed` ``
  - shaping (new): `` ` kept: merged PR #${result.pr} predates ready/auto:build labeling at ${entry.lastShapedAt} — remaining work assumed` ``
  - otherwise (unchanged): `` ` mentioned by merged PR #${result.pr} without a closing keyword; dispatching anyway` ``
  The fence uses the same words in its string-concatenation form.

- [ ] **Step 1: Write the failing tests**

`queue-pull.test.js`, beside the `#5227 shipped` tests, using `FULL()`/`pull4` with `scenario.linked[{n}].lastShapedAt` set (Task 1's fixture change feeds both `linkedNode` and `linkedOutput` from it):
- `AC1.1 (#5722) shipped: a strong title match shaped after the merge stays in dispatch-groups.json, unprobed, with the shaping kept line` — `lastShapedAt: '2026-11-07T10:00:00Z'` (after `MERGED_AT`) on 9010 → 9010 in the final groups, `entriesOf(r, 'shipped')` empty, `r.cap.staged` holds no `shipped-close-9010`, AUTO line `AUTO — dispatch: #9010 kept: merged PR #5010 predates ready/auto:build labeling at 2026-11-07T10:00:00Z — remaining work assumed\n`, and `FENCE.includes("' predates ready/auto:build labeling at '")`.
- `AC2.1 (#5722) shipped: a shaping time before the merge leaves 9010 excluded and its Close proposal staged` — `lastShapedAt: '2026-11-05T09:00:00Z'` → `assertShipped(r)` holds and `shipped-close-9010` is staged.
- `#5722 shipped: release and shaping both after the merge print the claim-release kept line` — claims as in the existing release test plus `lastShapedAt` → exactly one kept line for 9010, the claim-release text.
- `#5722 shipped: a weak mention predating the shaping that shares a failed probed PR prints no Warning` — mirror of the `#5313 … predating the claim release` test with `lastShapedAt` in place of the claim.

`dispatch-shipped-candidate-prose.test.js`: `#5722: SKILL.md states the shaping-or-grant downgrade` — matches `/#5722/` and `/shaped to `ready` or granted `auto:build` after/`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js tests/dispatch-shipped-candidate-prose.test.js`
Expected: FAIL after Step 1 — the four `#5722` queue-pull tests (9010 excluded as shipped) and the prose test.

- [ ] **Step 3: Implement** the module change, then mirror it into the fence, then the prose: in SKILL.md's False-positive posture paragraph, after the #4432 sentences, add one sentence containing the literal phrase `shaped to `ready` or granted `auto:build` after the mentioning PR merged` — for example: "A record shaped to `ready` or granted `auto:build` after the mentioning PR merged also rates that mention `weak` at most (#5722), whoever added the label: someone saw that merge and kept the record open; a missing or unreadable label time never downgrades." — and widen the parenthetical "any mention that predates the latest claim release" to "any mention that predates the latest claim release or the latest `ready`/`auto:build` labeling". Keep SKILL.md under the read-limit rail (the existing rail test). Update `docs/plugin-structure.md`'s `shipped-candidate.js` entry likewise.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js tests/dispatch-shipped-candidate-prose.test.js tests/bin-lib/dispatch/queue-pull-oracle-checks.test.js tests/bin-lib/dispatch/queue-pull-parity-ac1.test.js tests/bin-lib/dispatch/queue-pull-parity-ac4.test.js tests/bin-lib/dispatch/queue-pull-parity-ac7.test.js`
Expected: PASS, 0 fail (oracle tests may skip where `oracleSkip()` says so — report skips).

- [ ] **Step 5: Go-red proof (AC4.1)** — scratch-copy revert of `queue-pull.js`'s two `lastShapedAt:` arguments only; the `AC1.1 (#5722)` queue-pull test and the `#5722 … failed probed PR prints no Warning` test must fail; restore. Then the unchanged-behaviour tests, each against its named mutant (spec's Plan Review Clarifications, AC4 Reading A), one at a time:
  - `AC2.1 (#5722) shipped: a shaping time before the merge leaves 9010 excluded …` — mutant M6: the second pass keeps any candidate whose linked entry carries a `lastShapedAt` (skip `classifyShipped` when `entry.lastShapedAt` is set).
  - `#5722 shipped: release and shaping both after the merge print the claim-release kept line` — mutant M7: when choosing the kept line, test whether `result.signals` includes `'predates-shaping'` before `predatesClaimRelease(result)` (the shaping line wins).
  - the prose test — mutant M8: drop the new `#5722` sentence from SKILL.md.
  Quote each test name with the mutant that turned it red.

- [ ] **Step 6: Commit**

`git -C "{worktree}" add plugin/bin/lib/dispatch/queue-pull.js plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/SKILL.md docs/plugin-structure.md tests/bin-lib/dispatch/queue-pull.test.js tests/dispatch-shipped-candidate-prose.test.js`
Commit: `Keep a record shaped or granted after the mentioning PR merged in the queue pull — module, fence and prose (#5722)`

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 / AC1.1 | Task 2 (unit), Task 3 (queue pull keeps it, mention as context) |
| Deliverable 2 / AC2.1 | Task 2 (unit strong), Task 3 (still stages a Close proposal) |
| Deliverable 3 | Task 3 (SKILL.md False-positive posture) |
| AC3.1 | Task 1 (unparseable label time skipped), Task 2 (missing/unparseable/exact instant) |
| AC4.1 | Step 5 of each task — the reverted change for the downgrade tests, a named mutant (M1-M8) for each unchanged-behaviour test (AC4 Reading A, decided by the user at plan review) |
| Key Files departure | The spec lists `plugin/bin/lib/dispatch/shipped-releases.js` as modified; the shaping time instead rides the linked-PR batch (the spec's per-record-call Gotcha), so the files actually modified for it are `plugin/bin/lib/issues/record-dependencies.js`, `plugin/bin/lib/issues/linked-prs.js` and `plugin/bin/resolve-linked-prs.js` (Task 1) — in scope, not scope creep; `shipped-releases.js` is reviewed in Task 3 and changed only if its header claims to be the only downgrade source |
| Gotcha: per-record call | none needed — Task 1 rides the batch; real probe recorded above |
| Gotcha: `dispatch-queue-exclusion-addition` | not applicable — no new exclusion reason; `shipped` keeps its registration |
