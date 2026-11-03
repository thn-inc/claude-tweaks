# Cross-Repository Native Blockers Implementation Plan (#4793)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native blocker linked from another repository is carried with its repository and state and never looked up by number in this repository. `--blocker-landing` reads it as `open` when its native state is OPEN or unreadable, and as `undetermined`/`cross-repository` when CLOSED. Every surface that classifies, counts or names a record's blockers treats a foreign blocker the way `/dispatch` does (open or unreadable blocks, closed does not) and names it `owner/name#N`, never as this repository's `#N`. That covers wrap-up's newly-unblocked check, `dispatch resume`, the dispatch queue's Blocked-exclusion report and unlanded-blocker pass, backlog overview/refine and the funnel's `granted`/`dispatchable` split, flow's verdict prose, and materialize's `blocked-by:` header, which also lists `Blocked by owner/name#N` body lines.

**Architecture:** `buildNativeDependencyQuery` projects `repository{ nameWithOwner }` on each dependent issue and each blocker node. Pure helpers in `record-dependencies.js` do the rest:
- `crossRepositoryBlockers(issueNode)` lists foreign blockers.
- `withoutCrossRepoBlockers` subtracts their numbers.
- `foreignBlockerBlocks`/`foreignBlockerRef` apply the fail-closed state rule and give the qualified name.
- `openBlockerRefs(entry)` and `openNativeBlockerRefs(issueNode)` give one mixed list: this repository's open blocker numbers, then qualified strings for the foreign blockers that still block.
- `parseCrossRepoDependencies(body)` reads `Blocked by owner/name#N` body lines. It is a sibling of `parseDependencies`, which stays numbers-only.

`fetchNativeDependencies` adds `crossRepoBlockers` only when the list is non-empty, and leaves `blockedBy`/`openBlocker`/`openBlockerIds` unchanged. Every consumer reaches the foreign case through one of these helpers.

**Tech Stack:** Node 18+ CommonJS, `gh api graphql`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T225844-record-4793/work/4793-spec.md` (worktree copy). Its `## Decisions` section carries round 1 (Q1-Q2), round 2 (Q3-Q5) and round 3 (Q6, Q7, the Blanket rule, Plan markers). This plan implements all of them.

**Run dir:** `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T225844-record-4793` (anchored in the main checkout). `{evidence dir}` below means its `evidence/` subdirectory.

**Task order:** Tasks 2, 3, 4, 5 and 9 follow Task 1. Tasks 6 and 11 follow Task 2. Task 11 also follows Task 5, because both edit `queue-pull-notes.md`, in different paragraphs. Task 8 follows Tasks 1 and 7, and Task 10 follows Task 9. Task 7 is independent. The longest chain is three tasks deep (for example 1 → 2 → 11, or 1 → 9 → 10).

Scope keywords: crossRepoBlockers, withoutCrossRepoBlockers, crossRepositoryBlockers, openBlockerRefs, openNativeBlockerRefs, foreignBlockerRef, parseCrossRepoDependencies

## Global Constraints

- Spec Decisions Q1 (verbatim): "a cross-repository blocker whose native `blockedBy` node `state` is `OPEN` reads `open` (taken from the native node, no extra lookup), so `/flow` stops before the claim. Only a CLOSED cross-repository blocker reads `undetermined` with `via: cross-repository`."
- Spec Decisions Q5 (verbatim): "A foreign blocker whose native state is unreadable reads `open`, not `undetermined`, consistent with Q1. The skip or refusal text says the blocker's state was unreadable (naming `owner/repo#N`), so the stop can be diagnosed and is not a silent fallback." A state is *readable* only when it is exactly `'OPEN'` or `'CLOSED'`. Anything else (missing, `null`, another string) is unreadable. A foreign blocker therefore blocks exactly when `state !== 'CLOSED'`.
- Spec Decisions Q2 (verbatim): "This record also makes `plugin/bin/lib/wrap-up/pack.js` (around line 732) and `plugin/skills/wrap-up/unblocked-records.md` (around line 67) remove the `crossRepoBlockers` numbers before the `blockedBy.includes(closed)` test … Add a new test for that case; existing consumer tests stay unchanged." The `pack.js` filter is at line 739, re-checked 2026-11-04.
- Spec Decisions Q3 (verbatim): "Every reader that names a foreign blocker as this repository's `#N` is fixed in this record: `backlog/overview-mode.md`, `backlog/refine-mode.md`, the `blocked-by:` header in `flow/materialize.md`, and the dispatch queue's Blocked-exclusion report. The rule covers the whole family: any reader or report of a blocker reference names a foreign blocker in its qualified `owner/repo#N` form. If the build finds another such site, it fixes that site too rather than asking."
- Spec Decisions Q4 (verbatim): "The test that goes red when the repository check is reverted lives in the test file of the module that holds that check (`blocker-landing.test.js` if the check is in `blocker-landing.js`). The end-to-end tests in `preflight-records.test.js` stay as well. The acceptance criterion is the revert-red property; prove it by reverting the check and showing the red run." The repository check is `crossRepositoryBlockers` in `plugin/bin/lib/issues/record-dependencies.js`. Its test file is `tests/bin-lib/issues/record.test.js`, which pins every `record-dependencies.js` export through `record.js`'s re-export, so the revert-red tests live there (Task 1). The AC1.2 revert run covers that file and `preflight-records.test.js` (Task 2 Step 4).
- Spec Decisions Q6 (verbatim): "A record whose only blocker is an open foreign-repository blocker is classified `granted` in backlog overview, not `dispatchable`, the same way `/dispatch` refuses it." Per Q5 and the Blanket rule, a foreign blocker whose state is unreadable is treated the same way (Task 7).
- Spec Decisions Q7 (verbatim): "`materialize.js` also parses `Blocked by owner/repo#N` lines from the body, and the `blocked-by:` header lists every blocker, foreign ones in the qualified `owner/repo#N` form, as Q3 states." Tasks 9 and 10 implement it. `parseDependencies` stays numbers-only, because ten numeric consumers read it (Task 9 lists them).
- Spec Decisions Blanket rule (verbatim): "every surface that classifies, counts or names a record's blockers treats a foreign blocker exactly as `/dispatch` does (open or unreadable means blocked) and names it `owner/repo#N`. If the build finds another such site, it applies this rule there without asking." The sites swept into this plan:
  - native readers: Tasks 1-5;
  - flow verdict prose and the DAG: Task 6;
  - the backlog funnel and its attachment prose: Tasks 7-8;
  - the materialize header and multi-spec's Prerequisites reader: Task 10;
  - the MCP-transport blocked-by workaround: Task 5;
  - dispatch's unlanded-blocker pass: Task 11.
- Spec Plan markers (verbatim): "Tasks 6 and 7 carry `Review risk: high`; the build fixes the Task 1 test fixture the reviewer flagged." Every task here that touches dispatch, backlog, materialize or flow behavior carries `**Review risk:** high` (Tasks 1-11). Task 1's null-state fixture passes `null` explicitly.
- The qualified form is `{repository}#{number}`, for example `other/repo#5`. An unreadable foreign blocker's form adds a literal ` (state unreadable)` suffix: `other/repo#5 (state unreadable)`. `foreignBlockerRef` is the one producer of both strings from native data, and `parseCrossRepoDependencies` produces the plain form from body text. Every renderer prints a string ref verbatim and prints a number as `#N`.
- A cross-repository landing result is `{ blocker, verdict, commit: null, via, repository }`. `via` is `cross-repository` (state OPEN or CLOSED) or `cross-repository-state-unreadable` (any other state, verdict `open`). That is the existing four keys plus `repository` (`owner/name`), present only on cross-repository results, so every existing result keeps its exact shape. Precedent for a key present only when it applies: preflight's `nativeLinksUnchecked: true` ("the key is absent on every other run", `plugin/bin/preflight-records.js` header).
- `fetchNativeDependencies`'s `blockedBy`, `openBlocker` and `openBlockerIds` keep their values for every consumer, foreign blockers included. `crossRepoBlockers` appears only when non-empty. The existing deep-equal pins therefore stay unchanged and green (AC2.1): `tests/resolve-blockers-cli.test.js`, `tests/bin-lib/preflight-records/preflight-records.test.js`, `tests/bin-lib/wrap-up/pack.test.js`, `tests/bin-lib/dispatch/dispatch-resume-cli.test.js`, and `tests/bin-lib/dispatch/unlanded-blockers.test.js`, whose native world returns no `repository` field.
- Compare against the dependent issue's own `repository.nameWithOwner`, case-insensitively, never against the caller's `owner/repo`. An `origin` remote left on a pre-transfer name must not make every blocker read as foreign. A name is readable only when it is a non-empty string. A node with no readable name on either side is never foreign, so a response without the field keeps the old behavior.
- Quoted from `.claude/skills/gh-api-module-pattern/batching-failure-posture.md`: "The alias-query *builder* is a pure function in `plugin/bin/lib/issues/record-dependencies.js` (re-exported through `record.js`), separate from whatever runs it. … `record-dependencies.js` requires nothing at all and shells out nowhere, which is what lets `tests/bin-lib/issues/record.test.js` pin each builder with plain regex assertions and no fake runner at all". Also: "*Throw on a partial result* when partial data is unusable — `plugin/bin/lib/issues/native-dependencies.js`'s `fetchNativeDependencies` throws naming every missing `i{N}` alias (#723)". Every new helper lives in `record-dependencies.js` (pure), and the throw posture is unchanged.
- Quoted from `.claude/skills/merge-shape-landed-proof/SKILL.md`: "**Reuse.** `plugin/bin/lib/preflight-records/blocker-landing.js` (`fetchBlockerLanding`, `classifyBlocker`; #4553)." Their compare rules are untouched. A cross-repository blocker never reaches the GraphQL blocker query or the compare API.
- Quoted from `.claude/skills/regex-scan-linearity/SKILL.md` for Task 9's `CROSS_REPO_DEP_RE`: "Feed the function a long run of characters its pattern accepts, without the terminator that ends a match, and time it." Its Decision Framework row: "Runs on text no caller bounds | Probe it, pin it in `perf/`". Task 9 pins it in `perf/cross-repo-dependency-linearity.test.js`. The pattern is anchored by the literal `^Blocked by `, and its two character classes exclude the `/` and `#` terminators, so each line costs one attempt. It keeps `DEP_RE`'s `/gm` line semantics, so the two parsers agree on what a line is.
- Quoted from `.claude/skills/skill-prose-conformance-tests/SKILL.md` ("New prose has no pre-change bytes"), governing every go-red control in Tasks 3, 5, 6, 8, 10 and 11: "Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control. A bare `assert.throws(() => assertBlock(mutated))` is satisfied by whichever assertion fails first, so a mutation can go red for the wrong reason while the assertion it was meant to prove stays vacuous." Give each assertion in a shared helper its own message, and match the control to it. A fact list checked with `missingFactsOf` + `assertEachPatternGoesRed` (`tests/helpers/conformance-asserts.js`) satisfies this rule, because it strips each pattern and requires exactly that fact to go missing. New conformance tests in Tasks 5, 8, 10 and 11 use it.
- Project skills checked and found not to apply: `dispatch-queue-exclusion-addition` (no new exclusion reason: Task 5 widens the existing `blocked` detail and Task 11 a stderr line); `mcp-agent-fetch-node-compute` (materialize's `--record-json` shape already carries `body`, the only field Task 10 reads); `parse-signal-discipline` (`parseCrossRepoDependencies` produces a listing, not a verdict, and a line it cannot read is not listed, the same posture as `parseDependencies`); `gh-api-module-pattern/cli-wrapper-contract.md` (Task 11 changes one `deps.stderr` line and adds no side effect).
- Byte budgets against the 52,500 B `RAIL_BYTES` (`plugin/bin/lib/skill-audit/budgets.js`, measured 2026-11-04 with `wc -c`):
  - `plugin/skills/dispatch/queue-pull-script.md` is 51,739 B, leaving 761 B. Task 5's edit to it stays at or under +100 B net (≤ 51,839 B), with every explanation going to `blocked-exclusion-report.md`/`queue-pull-notes.md`. Task 5 Step 4 measures it.
  - Every other edited skill file has more than 5 KB of headroom: `materialize.md` 40,677; `overview-mode.md` 39,811; `refine-mode.md` 43,379; `multi-spec.md` 25,797; `mcp-transport.md` 22,634; `queue-pull-notes.md` 11,500; `unblocked-records.md` 7,980; `multispec-dependency-ordering.md` 5,444; `blocked-exclusion-report.md` 2,820.
- Heredoc snippets (`node-eval-file.js <<NODE_EVAL_EOF` bodies) stay free of `$` and backticks other than the existing `${CLAUDE_PLUGIN_ROOT}` (`bin/node-eval-file.js` header). Build qualified strings inside the JS helpers, never in snippet template literals.
- Hand-written commits use `{Verb} {what} — {detail}` with `refs #4793`, never `closes`/`fixes`, and end with `Claude-Session: https://claude.ai/code/session_01X7gPFDPBeut8Tyt6Zo6aim`. Never `git stash`. Worktree shell: one plain command per Bash call. Anchor with `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4793"`. Plugin CLIs (`log-decision.js`) run from `/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.160.3/bin/`.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Verified command

Run read-only on 2026-11-02 against `thn-inc/claude-tweaks` (the slug `git remote get-url origin` resolves to):

`gh api graphql -f query='query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ i4909: issue(number:4909){ number repository{ nameWithOwner } blockedBy(first:25){ nodes{ number state repository{ nameWithOwner } } } } } }' -f owner=thn-inc -f repo=claude-tweaks`

It returned `{"data":{"repository":{"i4909":{"number":4909,"repository":{"nameWithOwner":"thn-inc/claude-tweaks"},"blockedBy":{"nodes":[{"number":4820,"state":"OPEN","repository":{"nameWithOwner":"thn-inc/claude-tweaks"}}]}}}}}`.

The query text is unchanged since that run. No cross-repository link exists in this repository to probe, and creating one would mutate GitHub state. The foreign branch is therefore covered by shape only, a stated risk: it is the same field the same-repository nodes return.

## Review Focus

- This repository's #5 and `other/repo#5` both block one record. The local #5 is still judged by landing, the foreign one is reported apart, and wrap-up, dispatch and the queue subtract only one occurrence. Tasks 1-5 pin it.
- A foreign blocker whose number equals an in-run record (`/flow #10,#11`, where #11 is natively blocked by `other/repo#10`) is not ordered as an in-run edge and is judged as a foreign blocker. Dispatch's unlanded-blocker pass never treats it as a candidate either. Tasks 2 and 11 pin it.
- When the only blocker is foreign, no blocker-landing GraphQL query and no compare call are made. Tasks 2 and 11 pin it.
- A foreign node with no readable `state` blocks everywhere it is read. Landing reads `open` with `via: cross-repository-state-unreadable`, wrap-up never reports its dependent unblocked, dispatch resume refuses, the queue excludes, and backlog overview files it under `granted`. Each surface names it `owner/name#N (state unreadable)`. Tasks 1-5 and 7 pin it.
- A body line `Blocked by other/repo#5` is listed in materialize's header as `other/repo#5`, but never reaches a numeric consumer. `parseDependencies` still returns only this repository's numbers, so dispatch's `malformed-blocker` screen never reads the line as a bad number, and `--check`'s `bodyBlockedBy` stays numbers-only. A repository name that differs only in case is the same repository, and a response without `repository` fields leaves every reader's output unchanged. Tasks 1, 9 and 10 pin these.

---

### Task 1: Project the blocker repository and add the cross-repository helpers

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/record-dependencies.js`
- Modify: `plugin/bin/lib/issues/record.js`
- Modify: `plugin/bin/lib/issues/native-dependencies.js`
- Test: `tests/bin-lib/issues/record.test.js`
- Test: `tests/bin-lib/issues/native-dependencies.test.js`

Consumer classification (Consumer-enumeration check; `git grep -l -e fetchNativeDependencies -e resolve-blockers.js -e openBlockerIds -e buildNativeDependencyQuery -e hasOpenNativeBlocker -e partitionByOpenNativeBlockers -- plugin`, re-run 2026-11-04):
- **Changed by Tasks 2-11:**
  - Task 2: `plugin/bin/lib/preflight-records/preflight-records.js`, `plugin/bin/preflight-records.js`
  - Task 3: `plugin/bin/lib/wrap-up/pack.js`, `plugin/skills/wrap-up/unblocked-records.md`
  - Task 4: `plugin/bin/dispatch-resume.js`
  - Task 5: `plugin/skills/dispatch/queue-pull-script.md`, `plugin/skills/dispatch/queue-pull-notes.md`, `plugin/skills/dispatch/mcp-transport.md`
  - Task 8: `plugin/skills/backlog/overview-mode.md`, `plugin/skills/backlog/refine-mode.md`
  - Task 10: `plugin/skills/flow/materialize.md`
- **Reached through `preflight-records.js --blocker-landing`, outside the grep:** `plugin/bin/dispatch-unlanded-blockers.js` and `plugin/bin/lib/dispatch/unlanded-blockers.js` (Task 11).
- **Changed here:** `partitionByOpenNativeBlockers`. It has no runtime caller but names blocker ids, so it moves to `openNativeBlockerRefs` under Q3's whole-family rule.
- **Pass-through, no change:** `plugin/bin/resolve-blockers.js` (its `mapResult` returns the Map value as-is, so `crossRepoBlockers` reaches its JSON; Task 6 edits only its header comment), `plugin/bin/lib/number-list-cli.js`.
- **Mention-only comments or prose, no change:** `activity-gather.js`, `compose-brainstorm-args.js`, `fetch-sub-issues.js`, `friction-events.js`, `lib/compose-subject.js`, `lib/issues/capabilities-probe.js`, `lib/issues/linked-prs.js`, `lib/health-core/dedup.js`, `lib/preflight-records/blocker-landing.js` (line 39 comment; Task 2 edits other lines), `resolve-linked-prs.js`, `walkthrough-encode.js`, `skills/review/cross-spec-promise-check.md`. Task 5 edits `skills/dispatch/mcp-transport.md` only at its #2523 workaround (lines 183-186).

**Interfaces:**
- Produces, all exported from `record-dependencies.js` and re-exported by `record.js`:
  - `crossRepositoryBlockers(issueNode) -> Array<{number: number, repository: string, state: string|null}>` — each blocker node whose readable `repository.nameWithOwner` differs, case-insensitively, from the dependent node's readable name. `state` is the node's `state` when it is a string, else `null`.
  - `withoutCrossRepoBlockers(numbers: number[], crossRepoBlockers?: Array<{number}>) -> number[]` — a copy of `numbers` with one occurrence removed per entry's `number`, order kept. A non-array `numbers` gives `[]`; a non-array `crossRepoBlockers` gives a plain copy.
  - `foreignBlockerBlocks(entry) -> boolean` — `entry.state !== 'CLOSED'`.
  - `foreignBlockerRef(entry) -> string` — `` `${entry.repository}#${entry.number}` ``, plus `' (state unreadable)'` when `entry.state` is neither `'OPEN'` nor `'CLOSED'`.
  - `openBlockerRefs({openBlockerIds, crossRepoBlockers}) -> Array<number|string>` — this repository's open blocker numbers first, then the foreign refs. The numbers are `withoutCrossRepoBlockers(openBlockerIds, <crossRepoBlockers filtered to state === 'OPEN'>)`, deduplicated in first-appearance order (a non-array `openBlockerIds` gives none). The refs are `foreignBlockerRef(b)` for each `crossRepoBlockers` entry where `foreignBlockerBlocks(b)`, in entry order.
  - `openNativeBlockerRefs(issueNode) -> Array<number|string>` — `openBlockerRefs({ openBlockerIds: <numbers of the node's OPEN blockedBy nodes>, crossRepoBlockers: crossRepositoryBlockers(issueNode) })`. A malformed or missing `blockedBy.nodes` gives `[]`.
- `partitionByOpenNativeBlockers` returns `openNativeBlockerRefs(node)` as each candidate's blocker list.
- A `fetchNativeDependencies` Map entry gains `crossRepoBlockers` only when non-empty.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/issues/record.test.js`, add the six helpers to the import list (lines 4-11). Change the line-645 projection regex to:

```js
  assert.match(q, /i39: issue\(number:39\)\{ number repository\{ nameWithOwner \} blockedBy\(first:25\)\{ nodes\{ number state repository\{ nameWithOwner \} \} \} \}/);
```

Then append the tests below. The first one is the Q4 revert-red test: it goes red when `crossRepositoryBlockers`' repository check is reverted. `blk` defaults `state` to `'CLOSED'`, so a null state is passed as `null` explicitly; `undefined` would take the default.

```js
const depNode = (home, blockers) => ({ number: 1, repository: home === null ? undefined : { nameWithOwner: home }, blockedBy: { nodes: blockers } });
const blk = (number, repo, state = 'CLOSED') => ({ number, state, ...(repo === undefined ? {} : { repository: { nameWithOwner: repo } }) });

test('AC1.1/AC1.2 (#4793): a native blocker in another repository is listed foreign with its state, so it is never read as this repository\'s same-numbered issue', () => {
  assert.deepStrictEqual(crossRepositoryBlockers(depNode('acme/w', [blk(5, 'other/repo', 'OPEN'), blk(6, 'acme/w')])), [{ number: 5, repository: 'other/repo', state: 'OPEN' }]);
});
test('crossRepositoryBlockers treats a name differing only in case as the same repository', () => {
  assert.deepStrictEqual(crossRepositoryBlockers(depNode('Acme/W', [blk(6, 'acme/w')])), []);
});
test('crossRepositoryBlockers calls nothing foreign when either name is unreadable', () => {
  assert.deepStrictEqual(crossRepositoryBlockers(depNode(null, [blk(5, 'other/repo')])), []);
  assert.deepStrictEqual(crossRepositoryBlockers(depNode('acme/w', [blk(5)])), []);
  assert.deepStrictEqual(crossRepositoryBlockers(depNode('acme/w', [blk(5, '')])), []);
  assert.deepStrictEqual(crossRepositoryBlockers(null), []);
  assert.deepStrictEqual(crossRepositoryBlockers({ number: 1, repository: { nameWithOwner: 'acme/w' }, blockedBy: { nodes: 'x' } }), []);
});
test('crossRepositoryBlockers keeps a same-number pair apart and records a non-string state as null', () => {
  assert.deepStrictEqual(crossRepositoryBlockers(depNode('acme/w', [blk(5, 'acme/w'), blk(5, 'other/repo', null)])), [{ number: 5, repository: 'other/repo', state: null }]);
});
test('withoutCrossRepoBlockers removes one occurrence per foreign entry, keeping order', () => {
  assert.deepStrictEqual(withoutCrossRepoBlockers([5, 6, 5], [{ number: 5 }]), [6, 5]);
  assert.deepStrictEqual(withoutCrossRepoBlockers([5, 6], undefined), [5, 6]);
  assert.deepStrictEqual(withoutCrossRepoBlockers(undefined, [{ number: 5 }]), []);
  assert.deepStrictEqual(withoutCrossRepoBlockers([6], [{ number: 5 }]), [6]);
});
test('Q5: foreignBlockerBlocks is false only for CLOSED; foreignBlockerRef names owner/name#N and marks an unreadable state', () => {
  assert.equal(foreignBlockerBlocks({ number: 5, repository: 'o/r', state: 'CLOSED' }), false);
  assert.equal(foreignBlockerBlocks({ number: 5, repository: 'o/r', state: 'OPEN' }), true);
  assert.equal(foreignBlockerBlocks({ number: 5, repository: 'o/r', state: null }), true);
  assert.equal(foreignBlockerRef({ number: 5, repository: 'o/r', state: 'OPEN' }), 'o/r#5');
  assert.equal(foreignBlockerRef({ number: 5, repository: 'o/r', state: 'CLOSED' }), 'o/r#5');
  assert.equal(foreignBlockerRef({ number: 5, repository: 'o/r', state: null }), 'o/r#5 (state unreadable)');
  assert.equal(foreignBlockerRef({ number: 5, repository: 'o/r', state: 'WEIRD' }), 'o/r#5 (state unreadable)');
});
test('openBlockerRefs lists this repository\'s open numbers, then each still-blocking foreign blocker by its qualified name', () => {
  const cross = [{ number: 5, repository: 'o/r', state: 'OPEN' }, { number: 7, repository: 'o/r', state: 'CLOSED' }, { number: 8, repository: 'o/r', state: null }];
  assert.deepStrictEqual(openBlockerRefs({ openBlockerIds: [5, 4, 5, 4], crossRepoBlockers: cross }), [4, 5, 'o/r#5', 'o/r#8 (state unreadable)']);
  assert.deepStrictEqual(openBlockerRefs({ openBlockerIds: [4] }), [4]);
  assert.deepStrictEqual(openBlockerRefs({ crossRepoBlockers: [{ number: 8, repository: 'o/r', state: null }] }), ['o/r#8 (state unreadable)']);
  assert.deepStrictEqual(openBlockerRefs({}), []);
});
test('openNativeBlockerRefs reads a raw node: local OPEN numbers, foreign refs, legacy nodes unchanged', () => {
  assert.deepStrictEqual(openNativeBlockerRefs(depNode('acme/w', [blk(4, 'acme/w', 'OPEN'), blk(5, 'other/repo', 'OPEN'), blk(6, 'other/repo'), blk(9, 'acme/w')])), [4, 'other/repo#5']);
  assert.deepStrictEqual(openNativeBlockerRefs({ number: 1, blockedBy: { nodes: [{ number: 4, state: 'OPEN' }, { number: 9, state: 'CLOSED' }] } }), [4]);
  assert.deepStrictEqual(openNativeBlockerRefs({ number: 1, blockedBy: { nodes: 'x' } }), []);
});
test('partitionByOpenNativeBlockers names a foreign open blocker by its qualified name (#4793)', () => {
  const { excluded } = partitionByOpenNativeBlockers([{ number: 12 }], { i12: depNode('acme/w', [blk(5, 'other/repo', 'OPEN')]) });
  assert.deepStrictEqual(excluded, [{ number: 12, blockedBy: ['other/repo#5'] }]);
});
```

In `tests/bin-lib/issues/native-dependencies.test.js`, change the line-4 import to `{ fetchNativeSubIssues, fetchNativeDependencies }` and append the tests below (the file's `resp` helper is at line 6):

```js
test('fetchNativeDependencies carries a cross-repository blocker beside unchanged blockedBy/openBlocker/openBlockerIds', () => {
  const runner = () => resp({
    i11: { number: 11, repository: { nameWithOwner: 'acme/w' }, blockedBy: { nodes: [
      { number: 5, state: 'OPEN', repository: { nameWithOwner: 'other/repo' } },
      { number: 6, state: 'CLOSED', repository: { nameWithOwner: 'acme/w' } },
    ] } },
  });
  assert.deepStrictEqual(fetchNativeDependencies({ numbers: [11], owner: 'acme', repo: 'w', runner }).get(11), {
    blockedBy: [5, 6], openBlocker: true, openBlockerIds: [5],
    crossRepoBlockers: [{ number: 5, repository: 'other/repo', state: 'OPEN' }],
  });
});
test('fetchNativeDependencies adds no crossRepoBlockers key when every blocker is this repository\'s, or the field is absent', () => {
  const same = () => resp({ i11: { number: 11, repository: { nameWithOwner: 'acme/w' }, blockedBy: { nodes: [{ number: 6, state: 'OPEN', repository: { nameWithOwner: 'ACME/w' } }] } } });
  assert.deepStrictEqual(fetchNativeDependencies({ numbers: [11], owner: 'acme', repo: 'w', runner: same }).get(11), { blockedBy: [6], openBlocker: true, openBlockerIds: [6] });
  const legacy = () => resp({ i11: { number: 11, blockedBy: { nodes: [{ number: 6, state: 'OPEN' }] } } });
  assert.deepStrictEqual(fetchNativeDependencies({ numbers: [11], owner: 'acme', repo: 'w', runner: legacy }).get(11), { blockedBy: [6], openBlocker: true, openBlockerIds: [6] });
});
test('fetchNativeDependencies compares against the dependent issue\'s canonical name, not the caller\'s owner/repo', () => {
  const runner = () => resp({ i11: { number: 11, repository: { nameWithOwner: 'new-org/w' }, blockedBy: { nodes: [{ number: 6, state: 'CLOSED', repository: { nameWithOwner: 'new-org/w' } }] } } });
  assert.equal('crossRepoBlockers' in fetchNativeDependencies({ numbers: [11], owner: 'old-org', repo: 'w', runner }).get(11), false);
});
```

The last two native tests already pass today. They pin the no-key behavior, so they are not red steps.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/native-dependencies.test.js`
Expected: FAIL after Step 1 (`crossRepositoryBlockers is not a function`; the projection regex does not match; the first native test lacks `crossRepoBlockers`)

- [ ] **Step 3: Implement**

In `record-dependencies.js`:
- Change `buildNativeDependencyQuery`'s per-alias expression (line 91) to the Verified command's: `issue(number:${n}){ number repository{ nameWithOwner } blockedBy(first:25){ nodes{ number state repository{ nameWithOwner } } } }`. Extend its comment (#4793).
- Add the six helpers beside `hasOpenNativeBlocker` (line 122), with the Interfaces signatures. Give `crossRepositoryBlockers` a comment covering the Global Constraints' compare rule and why an unreadable name is never foreign. Give `foreignBlockerBlocks`/`foreignBlockerRef` a comment citing Decisions Q5's fail-closed rule.
- Point `partitionByOpenNativeBlockers` (line 168) at `openNativeBlockerRefs(node)` and update its comment.
- Export the six, and add them to `record.js`'s require list (lines 37-41) and `module.exports` (lines 43-50).

In `native-dependencies.js`:
- Require `crossRepositoryBlockers`, and set `entry.crossRepoBlockers` only when the list is non-empty.
- Extend the header shape sentence (lines 5-6) and the function comment (lines 17-18): "plus `crossRepoBlockers: [{number, repository, state}]` when a blocker lives in another repository (#4793)".

- [ ] **Step 4: Run tests to verify they pass, consumers unchanged**

Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/native-dependencies.test.js tests/resolve-blockers-cli.test.js tests/bin-lib/preflight-records/preflight-records.test.js tests/backlog-grant-gate-cli.test.js tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/wrap-up/pack.test.js tests/bin-lib/dispatch/unlanded-blockers.test.js tests/gh-host-seam-behavior.test.js`
Expected: PASS, with no edit to any consumer suite (AC2.1)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-dependencies.js plugin/bin/lib/issues/record.js plugin/bin/lib/issues/native-dependencies.js tests/bin-lib/issues/record.test.js tests/bin-lib/issues/native-dependencies.test.js
git commit -m "Project native blockers' repository — carry cross-repository blockers and name them owner/name#N, refs #4793"
```

### Task 2: Blocker landing judges a cross-repository blocker from its native state, never by number

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/preflight-records/blocker-landing.js`
- Modify: `plugin/bin/lib/preflight-records/preflight-records.js`
- Modify: `plugin/bin/preflight-records.js`
- Test: `tests/bin-lib/preflight-records/blocker-landing.test.js`
- Test: `tests/bin-lib/preflight-records/preflight-records.test.js`

**Interfaces:**
- Consumes: `withoutCrossRepoBlockers` (from `../issues/record`) and the `crossRepoBlockers` entry key (Task 1).
- Produces: `classifyCrossRepository({number, repository, state}) -> {blocker, verdict: 'open'|'undetermined', commit: null, via: 'cross-repository'|'cross-repository-state-unreadable', repository}`, exported from `blocker-landing.js`. It returns `open`/`cross-repository` for `'OPEN'`, `undetermined`/`cross-repository` for `'CLOSED'`, and `open`/`cross-repository-state-unreadable` for anything else (Q5).
- Under native mode a `buildRecords` record's `blockedBy` is `withoutCrossRepoBlockers(dep.blockedBy, dep.crossRepoBlockers)`, and `crossRepoBlockers` is copied after `fingerprint` only when non-empty. `merge-gate.js` and `waves.js` read `blockedBy` for in-run edges, so a foreign number never becomes an in-run edge.
- `records[n].blockerLanding` lists this repository's out-of-run results in `blockedBy` order, then one `classifyCrossRepository` result per `crossRepoBlockers` entry, in entry order. Its readers: `/flow` 2.7b and multi-spec Validation step 3 (prose, Task 6), and `bin/dispatch-unlanded-blockers.js` through `landingExclusions` (Task 11). `--prefetched-json` runs the native call as the gh path does, so the unlanded-blocker pass sees these entries. `--records-json` degrades native to body-text, so it never carries them.

- [ ] **Step 1: Write the failing tests**

`blocker-landing.test.js` (add `classifyCrossRepository` to the import at lines 4-7):

```js
test('AC1.1 + Q5: classifyCrossRepository — OPEN reads open, CLOSED undetermined, an unreadable state open (fail closed), with no lookup', () => {
  assert.deepEqual(classifyCrossRepository({ number: 5, repository: 'other/repo', state: 'OPEN' }), { blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' });
  assert.deepEqual(classifyCrossRepository({ number: 5, repository: 'other/repo', state: 'CLOSED' }), { blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository', repository: 'other/repo' });
  assert.deepEqual(classifyCrossRepository({ number: 5, repository: 'other/repo', state: null }), { blocker: 5, verdict: 'open', commit: null, via: 'cross-repository-state-unreadable', repository: 'other/repo' });
  assert.deepEqual(classifyCrossRepository({ number: 5, repository: 'other/repo', state: 'WEIRD' }), { blocker: 5, verdict: 'open', commit: null, via: 'cross-repository-state-unreadable', repository: 'other/repo' });
});
```

`preflight-records.test.js`: add a `buildRecords` unit test after the native-mode `buildRecords` test (line 202). Then add CLI tests after `landingFixture` (lines 802-822). Helpers already in that file: `isCompare` (line 790), `gqlQuery` (791), `closedBlocker` (793), `cliDeps` (227), `isGraphQL`/`isIssueView` (8-9), `issue` (11), `specBody` (182).

```js
test('buildRecords: native mode — a cross-repository blocker leaves blockedBy and rides on crossRepoBlockers', () => {
  const issues = new Map([[11, issue({ number: 11, title: 'E' })], [12, issue({ number: 12, title: 'T' })]]);
  const dependencies = new Map([
    [11, { blockedBy: [5, 6, 5], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 5, repository: 'other/repo', state: 'CLOSED' }] }],
    [12, { blockedBy: [6], openBlocker: false, openBlockerIds: [] }],
  ]);
  const records = buildRecords({ issues, dependencies });
  assert.deepEqual(records['11'].blockedBy, [6, 5]);
  assert.deepEqual(records['11'].crossRepoBlockers, [{ number: 5, repository: 'other/repo', state: 'CLOSED' }]);
  assert.equal('crossRepoBlockers' in records['12'], false);
});

// Native-mode landing fixture: each record's native blockers given as [number, repo, state].
function nativeLandingFixture(blockersByRecord, { repository = {}, statuses = {} } = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    for (const n of Object.keys(blockersByRecord)) {
      if (isIssueView(args, Number(n))) return JSON.stringify(issue({ number: Number(n), title: `R${n}`, body: specBody([`f${n}.js`]) }));
    }
    if (isGraphQL(args) && /CLOSED_EVENT/.test(gqlQuery(args))) return JSON.stringify({ data: { repository } });
    if (isGraphQL(args)) {
      const repo = {};
      for (const [n, blockers] of Object.entries(blockersByRecord)) {
        repo[`i${n}`] = { number: Number(n), repository: { nameWithOwner: 'acme/w' }, blockedBy: { nodes: blockers.map(([number, r, state]) => ({ number, state, repository: { nameWithOwner: r } })) } };
      }
      return JSON.stringify({ data: { repository: repo } });
    }
    if (isCompare(args)) {
      const sha = args[1].split('...').pop();
      if (!(sha in statuses)) throw new Error(`unexpected compare ${sha}`);
      return statuses[sha];
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  return { runner, calls };
}
const nativeArgs = (...nums) => [...nums, '--blocker-landing', '--repo', 'acme/w'];
const landingQueries = (calls) => calls.filter((a) => isGraphQL(a) && /CLOSED_EVENT/.test(gqlQuery(a))).map(gqlQuery);
```

Each test builds `const d = cliDeps({ runner, workLinks: 'native' })`, asserts `assert.equal(run(nativeArgs(...), d.deps), 0)` first, and reads `JSON.parse(d.out.join(''))`:
1. `AC1.1: a CLOSED native blocker in another repository is never queried by number here — undetermined cross-repository; this repository's blocker is still judged`.
   - Input: `{ 11: [[5, 'other/repo', 'CLOSED'], [6, 'acme/w', 'CLOSED']] }`, `repository: { b6: closedBlocker('fff666') }`, `statuses: { fff666: 'behind\n' }`.
   - Assert `blockerLanding` deep-equals `[{ blocker: 6, verdict: 'landed', commit: 'fff666', via: 'closer-pr' }, { blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository', repository: 'other/repo' }]`, and `blockedBy` is `[6]`.
   - Assert exactly one landing query is made, matching `/b6: issue\(number:6\)/` and not `/b5: issue/`.
2. `AC1.1: an OPEN native blocker in another repository reads open from its native state — no blocker-landing query and no compare call`.
   - Input: `{ 11: [[5, 'other/repo', 'OPEN']] }`.
   - Assert `blockerLanding` is `[{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]`, `landingQueries(calls).length === 0`, and `calls.filter(isCompare).length === 0`.
3. `Q5: a native blocker in another repository with no readable state reads open — fail closed, no lookup`.
   - Input: `{ 11: [[5, 'other/repo', null]] }`.
   - Assert `blockerLanding` is `[{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository-state-unreadable', repository: 'other/repo' }]` and `landingQueries(calls).length === 0`.
4. `this repository's #5 and another repository's #5 both blocking: the local one is judged, the foreign one is reported apart`.
   - Input: `{ 11: [[5, 'acme/w', 'CLOSED'], [5, 'other/repo', 'OPEN']] }`, `repository: { b5: closedBlocker('eee555') }`, `statuses: { eee555: 'diverged\n' }`.
   - Assert `[{ blocker: 5, verdict: 'unlanded', commit: 'eee555', via: 'closer-pr' }, { blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]`.
5. `a foreign blocker whose number is an in-run record is judged as foreign, not dropped as in-run`.
   - Run `nativeArgs('10', '11')` with `{ 10: [], 11: [[10, 'other/repo', 'OPEN']] }`.
   - Assert record 11's `blockedBy` is `[]` and its `blockerLanding` is `[{ blocker: 10, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/preflight-records/blocker-landing.test.js tests/bin-lib/preflight-records/preflight-records.test.js`
Expected: FAIL after Step 1. `classifyCrossRepository is not a function`; CLI tests 1, 4 and 5 query `b5`/`b10`, which the fixture answers with no alias, a whole-query failure with exit 1; tests 2 and 3 make a landing query.

- [ ] **Step 3: Implement**

- `blocker-landing.js`:
  - Add `classifyCrossRepository` as `{ ...result(number, verdict, null, via), repository }` (`result` is at line 52). Its comment says the number names another repository's issue, so it is never queried or probed here, and its verdict comes from the native node's state (#4793, Decisions Q1 and Q5).
  - Add `cross-repository` and `cross-repository-state-unreadable` to the header's `via` list (lines 11-13), and say the `open` verdict can also come from them. Export it.
- `preflight-records.js` lib:
  - `buildRecords` (line 141) sets native `blockedBy` via `withoutCrossRepoBlockers` and appends `crossRepoBlockers` after `fingerprint` only when non-empty.
  - Extend the line-115 shape comment, the `buildRecords` comment (lines 134-140) and `outOfRunBlockers`'s comment (line 184; cross-repository blockers never reach it).
- `plugin/bin/preflight-records.js`:
  - In the `opts.blockerLanding` block (lines 445-454), append `(records[String(n)].crossRepoBlockers || []).map(classifyCrossRepository)` after the per-record map on line 453.
  - Extend the header's `--blocker-landing` paragraph (lines 37-51) with the cross-repository entries, both `via` values, and the record's `crossRepoBlockers` key under native mode, `--prefetched-json` included.

- [ ] **Step 4: Run tests to verify they pass, and prove AC1.2 (Q4)**

Run: `node --test tests/bin-lib/preflight-records/blocker-landing.test.js tests/bin-lib/preflight-records/preflight-records.test.js tests/flow-blocker-landing-conformance.test.js tests/resolve-blockers-cli.test.js tests/bin-lib/dispatch/unlanded-blockers.test.js`
Expected: PASS

AC1.2 revert run:
1. In a scratch edit, make `crossRepositoryBlockers` in `record-dependencies.js` return `[]`.
2. Run `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T225844-record-4793/evidence"`.
3. Run `node --test tests/bin-lib/issues/record.test.js` redirected to `{evidence dir}/ac1-2-revert-record.txt`, and `node --test tests/bin-lib/preflight-records/preflight-records.test.js` redirected to `{evidence dir}/ac1-2-revert-preflight.txt`.
   - Expected: `record.test.js` FAILS on the `AC1.1/AC1.2 (#4793)` test (the module-local revert-red test Q4 requires) and on the other foreign-listing tests.
   - Expected: `preflight-records.test.js` FAILS on CLI tests 1-5, because `b5`/`b10` join the landing query, which the fixture answers with no alias, a whole-query failure with exit 1.
4. Undo with the Edit tool and confirm `git diff --stat -- plugin/bin/lib/issues/record-dependencies.js` prints nothing.
5. Log one entry with `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.160.3/bin/log-decision.js" --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T225844-record-4793" --section "/build" --status AUTO --step "AC evidence" --text-file {file} --reversibility n/a`. It cites AC1.2, the command shapes, each file's fail/pass counts quoted from the `ℹ fail`/`ℹ pass` summary lines, and both evidence paths.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/preflight-records/blocker-landing.js plugin/bin/lib/preflight-records/preflight-records.js plugin/bin/preflight-records.js tests/bin-lib/preflight-records/blocker-landing.test.js tests/bin-lib/preflight-records/preflight-records.test.js
git commit -m "Judge a cross-repository native blocker from its native state in blocker landing — never look it up by number, refs #4793"
```

- [ ] **Step 6: Real-input probe**

From the worktree, run `node plugin/bin/preflight-records.js 4909 4735 --blocker-landing --work-links native` redirected to `{evidence dir}/preflight-native-live.txt`.

Take the independent count from the Verified command plus `gh issue view 4735 --json number`, re-read at run time. On 2026-11-02, #4909 was blocked by #4820 and #4735 by #4589, both this repository's. Expected: both blockers appear in `blockedBy`, neither record carries `crossRepoBlockers`, and neither `blockerLanding` entry carries a `repository` key. If either record has since closed or lost its blocker, substitute an open record with a native blocker and re-derive the count the same way.

Log one `AC evidence` entry (AC2.1) the same way, naming the path.

### Task 3: Wrap-up's newly-unblocked check skips cross-repository blocker numbers

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js`
- Modify: `plugin/skills/wrap-up/unblocked-records.md` (7,980 B; adding ~400 B leaves ~44 KB under the 52,500 B rail)
- Test: `tests/bin-lib/wrap-up/pack.test.js`
- Test: `tests/wrap-up-pack-conformance.test.js`

**Interfaces:**
- Consumes: `withoutCrossRepoBlockers` and `foreignBlockerBlocks` from `../issues/record` (Task 1). `resolve-blockers.js` output entries now carry `crossRepoBlockers` when present (pass-through).

- [ ] **Step 1: Write the failing tests**

In `pack.test.js`, beside the `#2425` native tests (line 484), add three tests. Each drives `gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['unblocked'], deps })`, with `okDeps({ execFile })` (line 62) answering `resolve-blockers.js` (closed record 1535, open dependent 1600 'Dependent'):
- `Q2: a dependent blocked only by another repository's #1535 is not reported unblocked when this repository closes #1535`. Stdout `{ 1600: { blockedBy: [1535], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 1535, repository: 'other/repo', state: 'CLOSED' }] } }`. Expect `pack.unblocked.value` to deep-equal `[]`.
- `Q2: this repository's #1535 beside another repository's #1535 still reports the dependent unblocked`. `blockedBy: [1535, 1535]`, the same single foreign entry. Expect `[{ number: 1600, title: 'Dependent' }]`. This one already passes today, so it is a pin, not a red step.
- `Q5: a foreign blocker with no readable state keeps the dependent blocked`. `blockedBy: [1535, 7]`, `openBlocker: false`, `openBlockerIds: []`, `crossRepoBlockers: [{ number: 7, repository: 'other/repo', state: null }]`. Expect `[]`.

In `wrap-up-pack-conformance.test.js`, add one test plus its go-red control, sharing one assertion function, `assertNativeSnippetSkipsCrossRepo(text)`. Each check below has its own message:
- the `work-links: native` snippet in `unblocked-records.md` requires `bin/lib/issues/record.js` for `{ withoutCrossRepoBlockers, foreignBlockerBlocks }`;
- it filters with `withoutCrossRepoBlockers(byNumber[r.number].blockedBy, byNumber[r.number].crossRepoBlockers).includes(closedNum)`;
- it filters with `!(byNumber[r.number].crossRepoBlockers || []).some(foreignBlockerBlocks)`;
- it no longer contains `byNumber[r.number].blockedBy.includes(closedNum)`.

The control runs the same function on the text with the `withoutCrossRepoBlockers(` call replaced by `byNumber[r.number].blockedBy`. It expects a throw with the filter check's message.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/wrap-up-pack-conformance.test.js`
Expected: FAIL after Step 1 (the foreign-only and unreadable-state dependents are reported; the snippet lacks the helpers)

- [ ] **Step 3: Implement**

`pack.js`:
- Import `withoutCrossRepoBlockers` and `foreignBlockerBlocks` beside `parseDependencies` (line 18).
- The native filter (line 739) becomes `withoutCrossRepoBlockers(e.blockedBy, e.crossRepoBlockers).includes(closed) && !e.openBlocker && !(e.crossRepoBlockers || []).some(foreignBlockerBlocks)`, with `e = byNumber[r.number]`. Keep the `byNumber[r.number] &&` existence guard.
- Add a one-line comment citing #4793 Decisions Q2/Q5.

`unblocked-records.md`:
- In the native snippet (lines 50-70), require `{ withoutCrossRepoBlockers, foreignBlockerBlocks }` from `'${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js'`, and use both in the filter (line 67).
- Append to the paragraph after the snippet (line 73): "A blocker linked from another repository shares only its number with this repository's issues, so `crossRepoBlockers` numbers are removed before the `includes(closedNum)` test, and a foreign blocker that is not CLOSED (OPEN, or state unreadable) keeps its dependent blocked (#4793) — closing this repository's #N never reports a record blocked by `other/repo#N` as unblocked."

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/wrap-up-pack-conformance.test.js tests/session-tmp-root-migration.test.js tests/node-e-snippet-syntax.test.js`
Expected: PASS, with every pre-existing `pack.test.js` unblocked test unchanged

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/pack.js plugin/skills/wrap-up/unblocked-records.md tests/bin-lib/wrap-up/pack.test.js tests/wrap-up-pack-conformance.test.js
git commit -m "Skip cross-repository blocker numbers in wrap-up's newly-unblocked check, refs #4793"
```

### Task 4: `dispatch resume` names a foreign blocker by its repository

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/dispatch-resume.js`
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js`
- Test: `tests/bin-lib/dispatch/dispatch-resume-cli.test.js`
- Test: `tests/bin-lib/dispatch/resume-eligibility.test.js`

**Interfaces:**
- Consumes: `openBlockerRefs` from `./lib/issues/record` (Task 1).
- Produces: `readOpenBlockers` (line 276) returns this repository's open blocker numbers (body-text plus native), ascending and deduplicated, followed by the string refs `openBlockerRefs(entry)` yields, in its order. `resume-eligibility.js`'s `blocked-by` line renders a string entry verbatim and a number as `#N`.

- [ ] **Step 1: Write the failing tests**

`resume-eligibility.test.js`: add a row after the `'open blockers'` row (lines 318-319):

```js
['open blockers with a foreign one', { openBlockers: [4500, 'other/repo#5', 'other/repo#6 (state unreadable)'] }, 'blocked-by', '#4589 is blocked by open #4500, other/repo#5, other/repo#6 (state unreadable) — not resumable until they close; then run /claude-tweaks:dispatch resume #4589', 'resume'],
```

`dispatch-resume-cli.test.js`: add these beside the dedup test (line 749):

```js
test('a foreign open native blocker is named by its repository, never as this repository\'s #N', () => {
  const env = makeEnv();
  env.cfg.workLinks = 'native';
  env.cfg.issue.body = 'Blocked by #5\n';
  env.cfg.depStates[5] = 'OPEN';
  env.cfg.native = new Map([[N, { blockedBy: [5, 5], openBlocker: true, openBlockerIds: [5, 5], crossRepoBlockers: [{ number: 5, repository: 'other/repo', state: 'OPEN' }] }]]);
  const r = exec(env);
  assert.equal(r.json.reason, 'blocked-by');
  assert.match(r.json.line, /open #5, other\/repo#5 —/);
});
test('a CLOSED foreign native blocker does not block resume', () => {
  const env = makeEnv();
  env.cfg.workLinks = 'native';
  env.cfg.native = new Map([[N, { blockedBy: [5], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 5, repository: 'other/repo', state: 'CLOSED' }] }]]);
  assert.equal(exec(env).code, 0);
});
test('Q5: a foreign native blocker with no readable state refuses resume, naming it as state unreadable', () => {
  const env = makeEnv();
  env.cfg.workLinks = 'native';
  env.cfg.native = new Map([[N, { blockedBy: [5], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 5, repository: 'other/repo', state: null }] }]]);
  const r = exec(env);
  assert.equal(r.json.reason, 'blocked-by');
  assert.match(r.json.line, /open other\/repo#5 \(state unreadable\) —/);
});
```

The CLOSED test already passes today, so it is a pin, not a red step.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/dispatch/resume-eligibility.test.js`
Expected: FAIL after Step 1 (the line reads `open #5 —` or `#other/repo#5`; the unreadable case resumes)

- [ ] **Step 3: Implement**

`dispatch-resume.js` `readOpenBlockers`:
- Under native, iterate `openBlockerRefs(entry)`. Add each number to the `open` set and push each string to a `foreign` array.
- Return `[...open].sort((a, b) => a - b)` followed by `foreign`.
- Update its comment (lines 274-275; #4793, Q5). Keep the existing `!Array.isArray(entry.openBlockerIds)` exit-4 guard (line 292).

`resume-eligibility.js`:
- At line 335, render each entry as `typeof b === 'string' ? b : \`#${b}\``.
- Extend the line-258 inputs comment to say `openBlockers` may carry `owner/name#N` strings, optionally suffixed ` (state unreadable)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/dispatch/resume-eligibility.test.js tests/dispatch-resume-prose.test.js`
Expected: PASS, pre-existing tests unchanged

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/dispatch-resume.js plugin/bin/lib/dispatch/resume-eligibility.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/dispatch/resume-eligibility.test.js
git commit -m "Name a foreign blocker by its repository in dispatch resume's refusal, refs #4793"
```

### Task 5: The dispatch queue excludes a foreign open or unreadable blocker and its report names it owner/name#N

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (51,739 B; net +100 B ceiling, see Global Constraints)
- Modify: `plugin/skills/dispatch/blocked-exclusion-report.md`
- Modify: `plugin/skills/dispatch/queue-pull-notes.md` (line 11 only; Task 11 edits line 39)
- Modify: `plugin/skills/dispatch/mcp-transport.md` (lines 183-186 only)
- Test: `tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js` (create)

Pin checks:
- `tests/hooks-dispatcher.test.js` lines 1120-1172 hold a frozen copy of the grouping snippet, including its `openIds` line. It is a fixture frozen from an older revision (its `buildDispatchGroups(finalEligible, { bundleCap })` line already differs from the doc), and it never re-reads the doc, so it needs no change.
- `tests/dispatch-unlanded-blocker-consumers-conformance.test.js` slices `blocked-exclusion-report.md` from `Then read the same file's \`reason: 'unlanded-blocker'\`` (line 21) for four chunks. This task's paragraph goes above that start (after line 13), so the slice and its `requireOrder` markers are unaffected.
- The cache-hit path (lines 120-126) copies the persisted `blockedBy` lists verbatim, so string refs pass through untouched.

**Interfaces:**
- Consumes: `openBlockerRefs` from `bin/lib/issues/record.js` (Task 1).
- Produces: a `reason: 'blocked'` exclusion's `detail.blockedBy` may now carry `owner/name#N` strings (optionally ` (state unreadable)`) beside numbers. Under native mode a candidate is excluded exactly when `openBlockerRefs(dep)` is non-empty. That adds a foreign blocker with an unreadable state to today's `openBlockerIds` rule (Q5).

- [ ] **Step 1: Write the failing test**

Create `tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js` on `tests/dispatch-named-target-exclusion-fixture.test.js`'s extract-and-run pattern: `readText`, a structural start/end anchor, `execFileSync('bash', ['-c', snippet], …)`, `PLUGIN_ROOT` with forward slashes, and scratch files under `os.tmpdir()`.
- Start anchor: `'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_ELIGIBLE" "$DISPATCH_NATIVE_DEPS"'` (line 204). End anchor: the first `'\nNODE_EVAL_EOF'` after it (line 248).
- Run the extracted grouping snippet with `CLAUDE_PLUGIN_ROOT` and every `DISPATCH_*` variable it names set to scratch paths.
  - Eligible: `[11, 12, 13]`, each `{ number, labels: ['ready', 'auto:build'], body: '### Key Files\n\n- `f{n}.js` (modify)' }`.
  - Group-size guard `10`; bundle cap `3`; body exclusions `[]`.
  - Native deps:
    - `11: { blockedBy: [5], openBlocker: true, openBlockerIds: [5], crossRepoBlockers: [{ number: 5, repository: 'other/repo', state: 'OPEN' }] }`
    - `12: { blockedBy: [6], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 6, repository: 'other/repo', state: null }] }`
    - `13: { blockedBy: [7], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 7, repository: 'other/repo', state: 'CLOSED' }] }`
- Test `a foreign open or unreadable-state native blocker excludes its record and is named owner/name#N in the exclusion (#4793)`. Read the exclusions file's `reason: 'blocked'` entries. Assert they deep-equal `[{ reason: 'blocked', records: [11], detail: { blockedBy: ['other/repo#5'] } }, { reason: 'blocked', records: [12], detail: { blockedBy: ['other/repo#6 (state unreadable)'] } }]`. Compare only `reason`/`records`/`detail` if the writer adds other keys. Also assert the groups stdout holds record 13 and neither 11 nor 12.
- Test `the report and the MCP workaround name a foreign blocker owner/name#N (#4793)`. It uses `missingFactsOf` + `assertEachPatternGoesRed` (`tests/helpers/conformance-asserts.js`) over two fact lists:
  - over `blocked-exclusion-report.md`: `/A `blockedBy` entry that is a string — `owner\/name#N`/` and `/renders verbatim, never with a `#` prefix/`;
  - over `mcp-transport.md`'s `## Step 2 — native blocked-by / linked-PR batching` section (`sectionOf`): `/a mention naming another repository \(`owner\/name#N`\)/` and `/open or unreadable, it blocks/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js`
Expected: FAIL (record 11 is excluded with `blockedBy: [5]`; record 12 is not excluded; neither file carries the new clauses)

- [ ] **Step 3: Implement**

- `queue-pull-script.md` grouping snippet (lines 204-248):
  - Add `const { openBlockerRefs } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');` after the `appendExclusion` require (line 207).
  - Replace the `openIds` line (214) with `const refs = dep ? openBlockerRefs(dep) : [];`, and replace `openIds` with `refs` in the push line (215).
  - In the line-5 bullet, replace `` `bin/resolve-blockers.js`'s `openBlockerIds` field `` with `` `record.js`'s `openBlockerRefs` over `bin/resolve-blockers.js`'s output (#4793) ``.
  - Add nothing else to this file.
- `blocked-exclusion-report.md`, after the `blocked by an open dependency` line template (line 13): "A `blockedBy` entry that is a string — `owner/name#N`, a blocker linked natively from another repository, optionally suffixed ` (state unreadable)` when its state could not be read (#4793) — renders verbatim, never with a `#` prefix; a number renders as `#N`."
- `queue-pull-notes.md` line 11: change "drops any candidate whose `openBlockerIds` array is non-empty — that field is the identical OPEN-state filter …" so that it says the script drops any candidate for which `record.js`'s `openBlockerRefs` is non-empty. That covers this repository's `openBlockerIds` less any foreign numbers, plus each foreign blocker that is not CLOSED, named `owner/name#N` (#4793). Keep the rest of the sentence.
- `mcp-transport.md`, at the end of the sentence that ends "a native-only dependency relationship with no matching body-text mention is invisible on this path)." (line 186), add: "A mention naming another repository (`owner/name#N`) is that repository's issue, never this repository's `#N`: read its state with `issue_read` on that owner and repository — open or unreadable, it blocks, and the exclusion names it `owner/name#N`, the way the `gh` path's `openBlockerRefs` does (#4793)."

- [ ] **Step 4: Run tests to verify they pass, and measure the rail**

Run: `node --test tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js tests/dispatch-named-target-exclusion-fixture.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/dispatch-per-record-groups-prose.test.js tests/dispatch-unlanded-blocker-consumers-conformance.test.js tests/node-eval-file-heredoc-syntax.test.js tests/hooks-dispatcher.test.js`
Expected: PASS

Run: `wc -c plugin/skills/dispatch/queue-pull-script.md`
Expected: at most 51,839 (51,739 + 100), and therefore under 52,500

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/blocked-exclusion-report.md plugin/skills/dispatch/queue-pull-notes.md plugin/skills/dispatch/mcp-transport.md tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js
git commit -m "Exclude a foreign open or unreadable native blocker in dispatch's queue pull and name it owner/name#N, refs #4793"
```

### Task 6: Flow verdict prose, the DAG, the journey and shape docs name the cross-repository case

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/flow/multispec-dependency-ordering.md` (5,444 B; adding ~900 B stays far under the 52,500 B rail)
- Test: `tests/flow-blocker-landing-conformance.test.js`
- Modify: `docs/journeys/stop-a-run-whose-closed-blocker-never-landed-4553.md` (line 43)
- Modify: `plugin/bin/resolve-blockers.js` (header line 25 only)
- Modify: `docs/plugin-structure.md` (lines 64 and 235)

Moved-prose pin check: `tests/flow-blocker-landing-conformance.test.js:89-93` pins the existing `{text-file}` holder line, and `holderSentence` (line 70) reads the first `` `{text-file}` holds one line `` occurrence. The existing sentence stays unchanged, and the new paragraph must not contain that phrase.

- [ ] **Step 1: Write the failing test**

In `flow-blocker-landing-conformance.test.js`, add `assertCrossRepositoryNaming(text)` over `outOfRunSection(text)`, with one message per check, in this order:
1. the section contains `` `{repository}#{blocker}` ``;
2. it contains `` `via: cross-repository` `` and `` `via: cross-repository-state-unreadable` ``;
3. it contains the literal SKIP line `` `condition: {repository}#{blocker} lives in another repository (via cross-repository) → fallback: proceeded without judging its landing — blocker landing reads only this repository's integration branch` ``;
4. it contains the literal stop line `"159 depends on {repository}#{blocker}, whose state was unreadable — read as open (fail closed)"`.

It must also still pass `assertUndeterminedSkip(text)` (line 78).

Add `assertDagSkipsQualified(text)`: the DAG step (the line starting `1. **Build the DAG**`, plus its continuation through the next numbered step) contains `` `owner/name#N` `` and `never adds an edge`.

The test `cross-repository entries are named {repository}#{blocker} in the stop line and the SKIP text, and a qualified blocked-by entry adds no DAG edge (#4793)` calls both functions on the real file. It has two controls:
- `assertCrossRepositoryNaming` on the text with `{repository}#{blocker}` replaced everywhere by `#{blocker}`, expecting a throw with check 1's message;
- `assertDagSkipsQualified` on the text with `never adds an edge` replaced by `adds an edge`, expecting a throw with its own message.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-blocker-landing-conformance.test.js`
Expected: FAIL after Step 1 (the section has no cross-repository paragraph and the DAG step has no qualified-entry clause)

- [ ] **Step 3: Write the prose**

- `multispec-dependency-ordering.md`:
  - **New paragraph** after the `blocker-landing` gate paragraph (line 53, "An `open` or `unlanded` verdict's stop is gate `blocker-landing`; …"):

    > An entry with `via: cross-repository` or `via: cross-repository-state-unreadable` is a blocker linked natively from another repository; its `repository` key holds `owner/name`, and its number names that repository's issue, so write it as `{repository}#{blocker}`. An `open` entry stops as the table says, its stop line naming `{repository}#{blocker}`; with `via: cross-repository-state-unreadable` the stop line reads "159 depends on {repository}#{blocker}, whose state was unreadable — read as open (fail closed)". An `undetermined` entry writes the SKIP line `condition: {repository}#{blocker} lives in another repository (via cross-repository) → fallback: proceeded without judging its landing — blocker landing reads only this repository's integration branch` (#4793, Decisions Q1 and Q5).

  - **DAG step 1** (line 9), after "from its `blocked-by:` entries":

    > — a `blocked-by:` entry written `owner/name#N` names another repository's issue and never adds an edge, whatever its number: `preflight-records.js` builds the DAG from each record's `blockedBy`, which carries this repository's numbers only (#4793)
- Journey line 43, after the `not-found` sentence: "A native blocker linked from another repository is never looked up by number in this repository: it reads `open` when its native state is OPEN or unreadable (`via: cross-repository-state-unreadable`, fail closed) and `undetermined`/`cross-repository` when CLOSED, named `owner/name#N`."
- `resolve-blockers.js` header (line 25) and `docs/plugin-structure.md` lines 64 and 235: each shape sentence gains "plus `crossRepoBlockers: [{number, repository, state}]` when a blocker lives in another repository (#4793)".

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/flow-blocker-landing-conformance.test.js tests/resolve-blockers-cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/multispec-dependency-ordering.md tests/flow-blocker-landing-conformance.test.js docs/journeys/stop-a-run-whose-closed-blocker-never-landed-4553.md plugin/bin/resolve-blockers.js docs/plugin-structure.md
git commit -m "Name cross-repository blockers in flow's verdict prose, DAG, journey and shape docs, refs #4793"
```

### Task 7: Backlog's funnel files a record blocked only by a still-blocking foreign blocker under `granted` (Q6)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/backlog.js` (`funnelBuckets`, lines 186-187 comment and lines 207/213)
- Modify: `plugin/bin/lib/issues/ranking.js` (`blockersOf` comment, lines 25-39 only)
- Test: `tests/bin-lib/issues/backlog.test.js`
- Test: `tests/bin-lib/issues/ranking.test.js`

What each site does today, checked 2026-11-04:
- `funnelBuckets` (`backlog.js:207`) keeps only blocker ids in the open record set (`blockersOf(r).filter((id) => openIds.has(id))`). A qualified string ref would never be in that set, so the record would land in `dispatchable` while `/dispatch` refuses it (Task 5).
- The numeric filter exists because a body-text `Blocked by #N` list includes closed numbers. A string ref is attached only while its blocker still blocks (`openBlockerRefs` drops a CLOSED foreign blocker, Task 1), so it counts unfiltered.
- `computeUnblocksCount` (`ranking.js:52`) credits an id only when it is a candidate id, so a string credits nothing.
- `findUnresolvedDependencyProse` (`ranking.js:94`) suppresses its flag on any non-empty list, so a natively wired record with only a foreign blocker is still counted as wired.

Consumers of `funnelBuckets`/`blockersOf` (`git grep -l -e blockersOf -e funnelBuckets -- plugin`): `backlog.js`, `ranking.js`, and backlog/help prose. `merge-gate.js` and `waves.js` define their own local `blockersOf` over preflight records, which Task 2 keeps numbers-only. `/help`'s `status-scan.md` ranks on body text only, which never yields a string.

**Interfaces:**
- Consumes: string entries in `r.blockedBy` from overview's native attach (Task 8, through `openNativeBlockerRefs`, Task 1).
- Produces: `funnelBuckets` counts every string entry of `blockersOf(r)` as a blocker. A number counts only when it is in the open input set, as today.

- [ ] **Step 1: Write the failing test**

`backlog.test.js`, after the line-364 test (`blockedBy ids outside the open input set do not demote to granted`, which stays unchanged and pins the numeric filter):

```js
test('Q6 (#4793): a ready+granted record blocked only by a still-blocking foreign ref is granted, not dispatchable — the records /dispatch refuses', () => {
  for (const ref of ['other/repo#5', 'other/repo#6 (state unreadable)']) {
    const b = funnelBuckets([rec(1, { stage: 'ready', grants: { build: true, merge: false } }, { blockedBy: [ref] })]);
    assert.deepEqual(b.granted.map((r) => r.number), [1], ref);
    assert.deepEqual(b.dispatchable, [], ref);
  }
});
```

The set deliberately holds no record #5. An implementation that parsed the ref's number and looked it up in the open set would leave the record `dispatchable` and fail this test. Deleting the new string clause turns it red.

`ranking.test.js`: one characterization test of the contract `blockersOf`'s consumers rely on. It uses the file's `candidate()` helper (line 9). All keys tie, so `rankNextToBuild`'s stable sort keeps input order unless an unblock credit moves a record. `PROSE_DEP_RE` (`ranking.js:93`, `/blocked by\b[^\n#]*#\d+/i`) matches `'Blocked by other/repo#5'`.

```js
test('a qualified foreign blocker ref (#4793) never credits this repository\'s same-numbered record, yet counts as wired', () => {
  const foreign = candidate({ id: 9, body: 'Blocked by other/repo#5', blockedBy: ['other/repo#5'] });
  const five = candidate({ id: 5 });
  assert.deepStrictEqual(rankNextToBuild([foreign, five]).map((c) => c.id), [9, 5]);
  assert.deepStrictEqual(findUnresolvedDependencyProse([foreign, five]), []);
  // Control: a bare number does credit #5 and moves it first.
  const local = candidate({ id: 9, blockedBy: [5] });
  assert.deepStrictEqual(rankNextToBuild([local, five]).map((c) => c.id), [5, 9]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/backlog.test.js tests/bin-lib/issues/ranking.test.js`
Expected: FAIL after Step 1. The Q6 test finds record 1 in `dispatchable`. The ranking test passes already: it characterizes `blockersOf`'s existing contract, which this task does not change, so it is a pin, not a red step.

- [ ] **Step 3: Implement**

`backlog.js`:
- Line 207 becomes `const blockers = blockersOf(r).filter((id) => typeof id === 'string' || openIds.has(id));`, and line 213 reads `blockers.length > 0`.
- At lines 186-187, after "Only ids within the open input set count as blockers, since an out-of-set blocker cannot be acted on from this report.", add: "A string entry is a blocker linked from another repository (`owner/name#N`, #4793), attached only while it is open or its state is unreadable — exactly the blockers `/claude-tweaks:dispatch` refuses on (Decisions Q6) — so it counts although it is never an id in this set."

`ranking.js`:
- In `blockersOf`'s comment, change `candidate -> number[]` to `candidate -> Array<number|string>`.
- Add: "A string is a foreign blocker's qualified `owner/name#N` ref (#4793): it never equals a candidate id, so `computeUnblocksCount` credits nothing for it, and it still makes the list non-empty for `findUnresolvedDependencyProse`."

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/backlog.test.js tests/bin-lib/issues/ranking.test.js`
Expected: PASS, with every pre-existing `funnelBuckets` and ranking test unchanged

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/backlog.js plugin/bin/lib/issues/ranking.js tests/bin-lib/issues/backlog.test.js tests/bin-lib/issues/ranking.test.js
git commit -m "Count a still-blocking foreign blocker in backlog's funnel — granted, not dispatchable, as dispatch refuses it, refs #4793"
```

### Task 8: Backlog's native blocked-by attachment names a foreign blocker owner/name#N

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/backlog/overview-mode.md` (39,811 B; lines 87, 89 and 203; adding ~700 B)
- Modify: `plugin/skills/backlog/refine-mode.md` (43,379 B; line 420; adding ~150 B)
- Test: `tests/cross-repo-blocker-readers-conformance.test.js` (create)

Pin check: `git grep -n -F` over `tests/` for `nodes.filter(open).map(number)`, ``attach `blockedBy: [ids]` ``, and `one aliased \`buildNativeDependencyQuery\` call over the fetched candidates` finds no hit (2026-11-04).

**Interfaces:**
- Consumes: `openNativeBlockerRefs` (Task 1) and `funnelBuckets`' string counting (Task 7).

- [ ] **Step 1: Write the failing tests**

Create `tests/cross-repo-blocker-readers-conformance.test.js` with `readText` from `./helpers/read-skill` and `missingFactsOf`/`assertEachPatternGoesRed` from `./helpers/conformance-asserts`. Write one fact list per region, and assert `missing(region)` is `[]` and `assertEachPatternGoesRed(region, FACTS, missing)` for each:
- **Overview pre-attach**: `overview-mode.md`'s paragraph starting `On \`work-links: native\`: check field availability` (line 87). Facts: `/r\.blockedBy = openNativeBlockerRefs\(node\)/` and `/qualified `owner\/name#N` string \(#4793\)/`.
- **Overview funnel note**: the paragraph starting `The funnel-computation script below then reads` (line 89). Fact: `/A qualified `owner\/name#N` entry counts too \(#4793, Decisions Q6\)/`.
- **Overview Step 3**: the bullet starting `  - **\`work-links: native\`**` (line 203). Fact: `/attach `blockedBy: openNativeBlockerRefs\(node\)`/`.
- **Refine**: `refine-mode.md`'s line starting `- Refine runs the detection itself` (line 420). Fact: `/attaching `openNativeBlockerRefs\(node\)` per candidate/`.
- Plus one absence assertion with its own message: `overview-mode.md` no longer contains `nodes.filter(open).map(number)`. That literal is present today at line 87, so the assertion is red before the change.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/cross-repo-blocker-readers-conformance.test.js`
Expected: FAIL (no site names the helper or the qualified form yet)

- [ ] **Step 3: Write the prose**

- `overview-mode.md` line 87: replace `set \`r.blockedBy = nodes.filter(open).map(number)\` using \`hasOpenNativeBlocker\`-equivalent open-state filtering (\`record.js\`)` with `set \`r.blockedBy = openNativeBlockerRefs(node)\` (\`bin/lib/issues/record.js\`) — this repository's open blocker numbers, plus each still-blocking blocker linked from another repository as its qualified \`owner/name#N\` string (#4793), which never matches a record id in this set yet still counts as wired`.
- `overview-mode.md` line 89: append "A qualified `owner/name#N` entry counts too (#4793, Decisions Q6): it is attached only while that blocker is open or its state is unreadable, so the record lands in `granted`, the same records `/claude-tweaks:dispatch` refuses." Behavioral claim: it is produced by Task 7's `funnelBuckets` string clause and Task 1's `openBlockerRefs` filter.
- `overview-mode.md` line 203: replace `attach \`blockedBy: [ids]\` (the open blockers' numbers from each alias's \`blockedBy.nodes\`)` with `attach \`blockedBy: openNativeBlockerRefs(node)\` (\`bin/lib/issues/record.js\`; open blocker numbers, with a blocker from another repository as its qualified \`owner/name#N\` string, #4793)`.
- `refine-mode.md` line 420: after `one aliased \`buildNativeDependencyQuery\` call over the fetched candidates`, add `, attaching \`openNativeBlockerRefs(node)\` per candidate (a blocker from another repository attaches as \`owner/name#N\`, #4793)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/cross-repo-blocker-readers-conformance.test.js tests/backlog-overview-foldin-no-truncation.test.js tests/backlog-refine-foldin-no-truncation.test.js tests/raw-markdown-read-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/backlog/overview-mode.md plugin/skills/backlog/refine-mode.md tests/cross-repo-blocker-readers-conformance.test.js
git commit -m "Attach foreign native blockers as owner/name#N in backlog overview and refine, refs #4793"
```

### Task 9: Teach the body parser `Blocked by owner/name#N` lines (Q7)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/record-dependencies.js`
- Modify: `plugin/bin/lib/issues/record.js`
- Test: `tests/bin-lib/issues/record.test.js`
- Test: `perf/cross-repo-dependency-linearity.test.js` (create)

Why a sibling parser rather than a wider `parseDependencies` (Consumer-enumeration check; `git grep -n -e parseDependencies -- plugin`, 2026-11-04). Every caller treats its result as this repository's issue numbers, so a string entry would break each one:
- `dispatch-resume.js:282` would `gh issue view` it;
- `backlog-grant-gate.js:52` compares the result with open numbers;
- `dispatch/unlanded-blockers.js:64` (`malformedRecords`) would exclude the record as `malformed-blocker`;
- `ranking.js:44`, `preflight-records.js:148` and `record-graph/edges.js:21` read numbers;
- `wrap-up/pack.js:746` runs `stateOf.get`;
- `materialize.js:437` (`bodyBlockedBy`) and `:630`;
- `queue-pull-script.md:170,266` and `unblocked-records.md:25` (snippets).

So `parseDependencies`/`DEP_RE` stay unchanged (as `_shared/work-record.md:379` already states), and only `materialize.js:630` reads the new sibling (Task 10).

**Interfaces:**
- Produces: `parseCrossRepoDependencies(body) -> string[]`, exported from `record-dependencies.js` and re-exported by `record.js`. It returns the qualified refs `owner/name#N` from line-anchored `Blocked by owner/name#N` lines, in order of first appearance, deduplicated on lower-cased `owner/name` plus number (the first spelling is kept). A non-string or empty body gives `[]`. The regex is `CROSS_REPO_DEP_RE = /^Blocked by ([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)#(\d+)\b/gm`, a sibling of `DEP_RE` and never a modification of it. A ref naming this repository is listed as written; nothing re-maps it to a bare number.

- [ ] **Step 1: Write the failing tests**

`record.test.js`: add `parseCrossRepoDependencies` to the import list, and add these after the `parseDependencies` tests (line 479):

```js
test('Q7 (#4793): parseCrossRepoDependencies lists line-anchored Blocked by owner/name#N refs, qualified, deduped, in order', () => {
  assert.deepStrictEqual(parseCrossRepoDependencies('Blocked by other/repo#5\nBlocked by #6\nBlocked by Other/Repo#5\nBlocked by acme/w.js#7\n'), ['other/repo#5', 'acme/w.js#7']);
  assert.deepStrictEqual(parseCrossRepoDependencies('see Blocked by other/repo#5 mid-line'), []);
  assert.deepStrictEqual(parseCrossRepoDependencies('Blocked by #5'), []);
  assert.deepStrictEqual(parseCrossRepoDependencies('Blocked by other/repo#5abc'), []);
  assert.deepStrictEqual(parseCrossRepoDependencies(undefined), []);
});
test('Q7: parseDependencies still returns this repository\'s numbers only beside a foreign line', () => {
  assert.deepStrictEqual(parseDependencies('Blocked by other/repo#5\nBlocked by #6'), [6]);
});
```

Create `perf/cross-repo-dependency-linearity.test.js` in `perf/closing-keyword-linearity.test.js`'s shape: a header comment saying it is deliberately not part of `npm test`, plus one test. The test times `parseCrossRepoDependencies` on four inputs and asserts each run takes under 200 ms, with a message naming the input:
- `` `Blocked by ${'a'.repeat(200000)}` `` (no `/`);
- `` `Blocked by a/${'a'.repeat(200000)}` `` (no `#`);
- `'Blocked by a/a\n'.repeat(20000)`;
- `'\n'.repeat(40000)`.

The second `parseDependencies` test already passes today, so it is a pin.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/record.test.js perf/cross-repo-dependency-linearity.test.js`
Expected: FAIL after Step 1 (`parseCrossRepoDependencies is not a function`)

- [ ] **Step 3: Implement**

In `record-dependencies.js`:
- Add `CROSS_REPO_DEP_RE` below `DEP_RE` (line 12), with a comment: a sibling of `DEP_RE` for a blocker in another repository (#4793, Decisions Q7). `DEP_RE` never matches it, because it needs `#` right after "Blocked by ". The character classes exclude the `/` and `#` terminators, so each line costs one attempt.
- Add `parseCrossRepoDependencies` after `parseDependencies` (line 51), with the Interfaces contract. Its comment says only `materialize.js`'s header reads it, and that `parseDependencies` stays numbers-only for its numeric consumers.
- Export it from `record-dependencies.js`, and add it to `record.js`'s require list (lines 37-41) and `module.exports` (lines 43-50).

- [ ] **Step 4: Run tests to verify they pass, numeric consumers unchanged**

Run: `node --test tests/bin-lib/issues/record.test.js perf/cross-repo-dependency-linearity.test.js tests/bin-lib/dispatch/unlanded-blockers.test.js tests/bin-lib/issues/ranking.test.js tests/backlog-grant-gate-cli.test.js tests/bin-lib/preflight-records/preflight-records.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-dependencies.js plugin/bin/lib/issues/record.js tests/bin-lib/issues/record.test.js perf/cross-repo-dependency-linearity.test.js
git commit -m "Parse Blocked by owner/name#N body lines into qualified refs beside the numbers-only parseDependencies, refs #4793"
```

### Task 10: Materialize's `blocked-by:` header lists every body blocker, a foreign one as owner/name#N (Q7)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/materialize.js` (line 630, and the header comment near line 7)
- Test: `tests/materialize-design-intent.test.js`
- Modify: `plugin/skills/flow/materialize.md` (40,677 B; lines 72, 91 and 111; adding ~700 B)
- Modify: `plugin/skills/flow/multi-spec.md` (25,797 B; line 10; adding ~350 B)
- Test: `tests/flow-cross-repo-header-conformance.test.js` (create)

Sole-site proof (Sole-site check): `git grep -n -e "composeHeader(" -e "blocked-by: \[" -- plugin` (2026-11-04) finds four hits:
- `materialize-format.js:207/217` (`composeHeader`, whose `join(', ')` already renders a string entry verbatim, so it needs no change);
- `materialize.js:622` (its only caller);
- `local-store.js:230` (the `local-files` record writer, which writes `facets.blockedBy` numbers into `specs/` files, never the run-dir `work/{n}-spec.md` file materialize writes);
- `materialize.md:72` (the pinned format).

No `plugin/bin` code parses the materialized header back. Its readers are prose: `multi-spec.md` Validation steps 2-3, and `multispec-dependency-ordering.md`'s DAG step, which Task 6 covers. The YAML stays valid: in `blocked-by: [6, other/repo#5]`, the `#` has no space before it, so it is not a comment.

Pre-existing mismatch, routed rather than folded in: `materialize.md`'s native clause describes a batched GraphQL resolution that `materialize.js` never runs (the file has no `native`/`work-links` handling). The header is composed from the body in every mode, so a natively linked foreign blocker does not reach it. This task states the native naming rule in the prose but does not implement the native read. The controller files that CLI gap as a follow-up record at Common Step 4, with a spec-shaped body and a `Defer-reason:` (it is listed in this plan's open questions).

**Interfaces:**
- Consumes: `parseCrossRepoDependencies` (Task 9).
- Produces: `composeHeader`'s `blockedBy` is `[...parseDependencies(record.body), ...parseCrossRepoDependencies(record.body)]`, so the header reads `blocked-by: [6, other/repo#5]` (this repository's numbers first). `--check`'s `bodyBlockedBy` (line 437) stays `parseDependencies(record.body)`: it is `/flow` 2.7b's call-skip input, and `preflight-records.js` judges body-text numbers only.

- [ ] **Step 1: Write the failing tests**

`materialize-design-intent.test.js`, after the `AC11.1` `--check` test (line 150):

```js
test('Q7 (#4793): blocked-by lists this repository\'s numbers, then each Blocked by owner/name#N line in its qualified form', () => {
  const { exitCode, deps } = materializeWithBody(shapedBody('Design-intent: quiet') + '\nBlocked by #6\nBlocked by other/repo#5\n');
  assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
  const written = fs.readFileSync(JSON.parse(deps.calls.stdout.join('')).file, 'utf8');
  assert.match(written, /^blocked-by: \[6, other\/repo#5\]$/m);
});
test('Q7: --check keeps bodyBlockedBy to this repository\'s numbers — the 2.7b call-skip input preflight judges', () => {
  const { exitCode, deps } = checkWithBody(shapedBody('Design-intent: quiet') + '\nBlocked by other/repo#5\n');
  assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
  assert.deepStrictEqual(JSON.parse(deps.calls.stdout.join('')).bodyBlockedBy, []);
});
```

Create `tests/flow-cross-repo-header-conformance.test.js` with `missingFactsOf`/`assertEachPatternGoesRed` over two regions:
- `materialize.md`'s line starting ``- `blocked-by` ``. Facts: `/`parseCrossRepoDependencies\(body\)`/`, `/a `Blocked by owner\/name#N` line lists as its qualified `owner\/name#N`/`, `/read by no check, as `\/claude-tweaks:dispatch` reads none/`, and `/Emit as `blocked-by: \[n1, n2, \.\.\., owner\/name#N, \.\.\.\]`/`.
- `multi-spec.md`'s line starting `2. **Prerequisites**`. Fact: `/A qualified `owner\/name#N` entry is another repository's issue — never an in-run edge and never this repository's `#N`/`.

The second `--check` test already passes today, so it is a pin.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/materialize-design-intent.test.js tests/flow-cross-repo-header-conformance.test.js`
Expected: FAIL after Step 1 (the header reads `blocked-by: [6]`; neither prose site carries the new facts)

- [ ] **Step 3: Implement and write the prose**

`materialize.js`:
- Add `parseCrossRepoDependencies` to the `record.js` require (line 47).
- Line 630 becomes `blockedBy: [...parseDependencies(record.body), ...parseCrossRepoDependencies(record.body)],`, with a one-line comment (#4793, Decisions Q7).
- Leave line 437 unchanged.

`materialize.md`:
- Line 72's pinned format becomes `blocked-by: [n1, owner/name#N]       # omitted when none — see Populating the header`.
- Line 91's `blocked-by` consumer cell gains "; a qualified `owner/name#N` entry is never an in-run edge".
- Line 111, body-text clause: replace `` `parseDependencies(body)` (`bin/lib/issues/record.js`) over the already-fetched body, no extra read `` with:

  > `parseDependencies(body)` then `parseCrossRepoDependencies(body)` (`bin/lib/issues/record.js`) over the already-fetched body, no extra read — a `Blocked by owner/name#N` line lists as its qualified `owner/name#N`, never as this repository's `n` (#4793, Decisions Q7); the entry names that blocker but is read by no check, as `/claude-tweaks:dispatch` reads none
- Line 111, native clause: after ``resolving `blockedBy` (the field `capabilities-probe.js`'s `probeSchema` checks for)``, add:

  > , a blocker linked from another repository listed as `owner/name#N` (`openNativeBlockerRefs`'s form), never as its bare number
- Line 111: replace `Emit as \`blocked-by: [n1, n2, ...]\`` with `Emit as \`blocked-by: [n1, n2, ..., owner/name#N, ...]\` (this repository's numbers first)`.

`multi-spec.md` line 10, after "is satisfied.":

> A qualified `owner/name#N` entry is another repository's issue — never an in-run edge and never this repository's `#N`; under `work-links: native` its verdict is Validation step 3's cross-repository `--blocker-landing` entry (`multispec-dependency-ordering.md`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/materialize-design-intent.test.js tests/flow-cross-repo-header-conformance.test.js tests/bin-lib/issues/materialize-format.test.js tests/materialize-premise-check.test.js tests/flow-blocker-landing-conformance.test.js tests/raw-markdown-read-conformance.test.js`
Expected: PASS (`materialize-format.test.js:290`'s `blocked-by: [1, 2]` pin is unchanged)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/materialize.js tests/materialize-design-intent.test.js plugin/skills/flow/materialize.md plugin/skills/flow/multi-spec.md tests/flow-cross-repo-header-conformance.test.js
git commit -m "List every body blocker in materialize's blocked-by header, a foreign one as owner/name#N, refs #4793"
```

### Task 11: Dispatch's unlanded-blocker pass names a CLOSED foreign blocker owner/name#N when it keeps the candidate

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/unlanded-blockers.js` (`landingExclusions`, lines 92-115)
- Modify: `plugin/bin/dispatch-unlanded-blockers.js` (the `kept` line, line 225; header comment lines 11-13)
- Test: `tests/bin-lib/dispatch/unlanded-blockers.test.js`
- Modify: `plugin/skills/dispatch/queue-pull-notes.md` (line 39, the Unlanded-blocker pass paragraph)
- Test: `tests/dispatch-unlanded-blocker-consumers-conformance.test.js`

What this pass sees after Task 2:
- A CLOSED foreign blocker reads `undetermined`/`cross-repository`. The pass keeps the candidate, which matches `/dispatch`'s rule that closed does not block, but its `AUTO` line names it `#5`.
- An OPEN or unreadable foreign blocker reads `open`, which stays the `blocked` pass's: Task 5 already removed that candidate under native.
- A foreign blocker is never `unlanded`.
- "All candidates are that call's positional numbers, so a blocker that is itself a candidate is in-run" no longer holds for a foreign number (Task 2 test 5), and the notes say so.

**Interfaces:**
- Consumes: Task 2's cross-repository landing result (its `repository` key).
- Produces: `landingExclusions`' `undetermined` entries are `{record, blocker, via}` plus `repository` exactly when the verdict carries one, so the existing deep-equal at lines 656-659 is unchanged. The `kept` line names `` `${u.repository}#${u.blocker}` `` for such an entry and `#${u.blocker}` otherwise.

- [ ] **Step 1: Write the failing tests**

`unlanded-blockers.test.js`:
- In `makeWorld`'s native branch (line 74), give each `i{n}` node `repository: { nameWithOwner: native.home }` when `native.home` is set. Existing tests pass no `home`, so their nodes are unchanged.
- Add after the `landingExclusions` test (line 641):

```js
test('landingExclusions carries a cross-repository verdict\'s repository on its undetermined entry (#4793)', () => {
  const envelope = { records: { 11: { blockerLanding: [
    { blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository', repository: 'other/repo' },
    { blocker: 6, verdict: 'open', commit: null, via: 'cross-repository-state-unreadable', repository: 'other/repo' },
  ] } } };
  assert.deepEqual(landingExclusions(envelope, [11]), {
    exclusions: [], undetermined: [{ record: 11, blocker: 5, via: 'cross-repository', repository: 'other/repo' }],
  });
});
```

- Add after the `AC3.1: an undetermined verdict keeps the candidate` test (line 207), using the real preflight-records.js through `realPreflight`:

```js
test('a CLOSED foreign native blocker keeps the candidate, its AUTO line names owner/name#N, and no landing query is made (#4793)', (t) => {
  const world = makeWorld({ native: { home: 'acme/w', edges: { 11: [{ number: 5, state: 'CLOSED', repository: { nameWithOwner: 'other/repo' } }] } } });
  const r = exec(t, { groups: [[R10], [rec(11)]], world, workLinks: 'native' });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.groups, [[R10], [rec(11)]]);
  assert.equal(r.exclusions, null);
  assert.match(r.stderr, /AUTO — dispatch: #11 kept — blocker other\/repo#5 landing undetermined \(via cross-repository\)/);
  assert.equal(world.calls.filter((a) => isGraphQL(a) && /CLOSED_EVENT/.test(queryOf(a))).length, 0);
});
```

`dispatch-unlanded-blocker-consumers-conformance.test.js`: add a fact list over `queue-pull-notes.md`'s line starting `**Unlanded-blocker pass (#4792).**`. Read the file with `readText` beside the existing constants (lines 19-22). Facts: `/A blocker linked natively from another repository is never in-run, whatever its number/` and `/its `AUTO` line naming it `owner\/name#N`/`, each proven with `assertEachPatternGoesRed`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/unlanded-blockers.test.js tests/dispatch-unlanded-blocker-consumers-conformance.test.js`
Expected: FAIL after Step 1. The unit test finds no `repository` key. The CLI test's `kept` line names `#5`, and before Task 2 the native world's `b5` makes the landing call fail as a whole, so no `kept` line prints at all. The notes lack the clause.

- [ ] **Step 3: Implement**

- `unlanded-blockers.js` `landingExclusions`: push `{ record: n, blocker: v.blocker, via: v.via, ...(v.repository ? { repository: v.repository } : {}) }`. Extend its comment (lines 92-97): a cross-repository `undetermined` is a CLOSED foreign blocker, which `/dispatch` does not count as blocking (#4793).
- `dispatch-unlanded-blockers.js` line 225: render the blocker as `u.repository ? \`${u.repository}#${u.blocker}\` : \`#${u.blocker}\``. Extend the header comment (lines 11-13) to say a cross-repository `undetermined` keeps the candidate and is named `owner/name#N`.
- `queue-pull-notes.md` line 39, after "such a blocker is open, and the `blocked` pass already removed its dependents.":

  > A blocker linked natively from another repository is never in-run, whatever its number: a CLOSED one reads `undetermined` (`via: cross-repository`) and keeps the candidate, its `AUTO` line naming it `owner/name#N`; an open or state-unreadable one is the `blocked` pass's (#4793).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/unlanded-blockers.test.js tests/dispatch-unlanded-blocker-consumers-conformance.test.js tests/dispatch-unlanded-blocker-exclusion-fixture.test.js`
Expected: PASS, with every pre-existing unlanded-blocker test unchanged

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/unlanded-blockers.js plugin/bin/dispatch-unlanded-blockers.js tests/bin-lib/dispatch/unlanded-blockers.test.js plugin/skills/dispatch/queue-pull-notes.md tests/dispatch-unlanded-blocker-consumers-conformance.test.js
git commit -m "Name a CLOSED foreign blocker owner/name#N in dispatch's unlanded-blocker pass, never in-run, refs #4793"
```

## Spec coverage

| Spec clause | Task |
|---|---|
| Deliverable 1: project `repository { nameWithOwner }`, carry it with the number | Task 1 |
| Deliverable 2 + Decisions Q1: cross-repository verdict in `blocker-landing.js`, pinned in the blocker-landing suite | Task 2 (`classifyCrossRepository` and its unit test) |
| Decisions Q2: `pack.js` + `unblocked-records.md` drop `crossRepoBlockers` numbers, with a new test | Task 3 |
| Decisions Q3: overview, refine, `materialize.md` header, dispatch queue report, whole family | Task 8 (backlog); Task 10 (materialize header); Task 5 (queue report); Task 4 (dispatch resume); Task 1 (`partitionByOpenNativeBlockers`); Task 6 (flow verdict prose) |
| Decisions Q4: revert-red test next to the check; end-to-end tests stay | Task 1 (`record.test.js` `AC1.1/AC1.2 (#4793)` test); Task 2 Step 4 revert run over both files |
| Decisions Q5: unreadable foreign state reads open, and the text says state unreadable | Task 1 (`foreignBlockerBlocks`/`foreignBlockerRef`); Task 2 (`cross-repository-state-unreadable`); Tasks 3-7 |
| Decisions Q6: a record blocked only by an open foreign blocker is `granted`, not `dispatchable` | Task 7 (`funnelBuckets` string clause + test); Task 8 (overview line 89) |
| Decisions Q7: `materialize.js` parses `Blocked by owner/repo#N`; the header lists every blocker, foreign ones qualified | Task 9 (`parseCrossRepoDependencies`); Task 10 (header, `materialize.md`, `multi-spec.md` Prerequisites) |
| Blanket rule: every surface that classifies, counts or names blockers treats a foreign one as `/dispatch` does and names it `owner/repo#N` | Tasks 1-5 (native readers, queue, report); Task 5 (`mcp-transport.md` workaround); Task 6 (verdict prose, DAG); Task 7 (funnel, ranking contract); Task 8 (attachment prose); Task 10 (header, Prerequisites reader); Task 11 (unlanded-blocker pass) |
| Plan markers: Tasks 6 and 7 `Review risk: high`; Task 1 fixture fixed | Tasks 1-11 carry `**Review risk:** high`; Task 1 Step 1 passes `null` explicitly |
| AC1.1: a native blocker whose repository differs does not query this repository's issue of the same number | Task 2 CLI tests 1-3; Task 11 CLI test |
| AC1.2: reverting the repository check turns it red | Task 2 Step 4 mutation, logged as AC evidence |
| AC2.1: `buildNativeDependencyQuery`'s dispatch and wrap-up consumer tests pass unchanged | Task 1 Step 4 consumer suites; Tasks 2-5 and 11 Step 4; Task 2 Step 6 probe |
