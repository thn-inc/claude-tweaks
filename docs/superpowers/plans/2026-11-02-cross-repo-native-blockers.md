# Cross-Repository Native Blockers Implementation Plan (#4793)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native blocker linked from another repository is carried with its repository and state and never looked up by number in this repository. `--blocker-landing` reads it as `open` when its native state is OPEN or unreadable, and as `undetermined`/`cross-repository` when CLOSED. Every reader or report of a blocker reference (wrap-up's newly-unblocked check, `dispatch resume`, the dispatch queue's Blocked-exclusion report, backlog overview/refine, flow's verdict prose and `materialize.md`'s `blocked-by:` header) names a foreign blocker as `owner/name#N`, never as this repository's `#N`.

**Architecture:** `buildNativeDependencyQuery` projects `repository{ nameWithOwner }` on each dependent issue and each blocker node. Pure helpers in `record-dependencies.js` do the rest. `crossRepositoryBlockers(issueNode)` lists foreign blockers. `withoutCrossRepoBlockers` subtracts their numbers. `foreignBlockerBlocks`/`foreignBlockerRef` apply the fail-closed state rule and the qualified name. `openBlockerRefs(entry)` and `openNativeBlockerRefs(issueNode)` give one mixed list: this repository's open blocker numbers followed by qualified strings for the foreign blockers that still block. `fetchNativeDependencies` adds `crossRepoBlockers` only when non-empty and leaves `blockedBy`/`openBlocker`/`openBlockerIds` unchanged. Every consumer reaches the foreign case through one of these helpers.

**Tech Stack:** Node 18+ CommonJS, `gh api graphql`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T114006-record-4793/work/4793-spec.md` (worktree copy; carries the `## Decisions` section, round 1 Q1-Q2 and round 2 Q3-Q5, that this plan implements)

**Run dir:** `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T114006-record-4793` (main-checkout anchored; `{evidence dir}` below is its `evidence/` subdirectory)

Scope keywords: crossRepoBlockers, withoutCrossRepoBlockers, crossRepositoryBlockers, openBlockerRefs, openNativeBlockerRefs, foreignBlockerRef

## Global Constraints

- Spec Decisions Q1 (verbatim): "a cross-repository blocker whose native `blockedBy` node `state` is `OPEN` reads `open` (taken from the native node, no extra lookup), so `/flow` stops before the claim. Only a CLOSED cross-repository blocker reads `undetermined` with `via: cross-repository`."
- Spec Decisions Q5 (verbatim): "A foreign blocker whose native state is unreadable reads `open`, not `undetermined`, consistent with Q1. The skip or refusal text says the blocker's state was unreadable (naming `owner/repo#N`), so the stop can be diagnosed and is not a silent fallback." A state is *readable* only when it is exactly `'OPEN'` or `'CLOSED'`; anything else (missing, `null`, another string) is unreadable. A foreign blocker therefore blocks exactly when `state !== 'CLOSED'`.
- Spec Decisions Q2 (verbatim): "This record also makes `plugin/bin/lib/wrap-up/pack.js` (around line 732) and `plugin/skills/wrap-up/unblocked-records.md` (around line 67) remove the `crossRepoBlockers` numbers before the `blockedBy.includes(closed)` test … Add a new test for that case; existing consumer tests stay unchanged." (After the catch-up merge the `pack.js` filter is at line 739.)
- Spec Decisions Q3 (verbatim): "Every reader that names a foreign blocker as this repository's `#N` is fixed in this record: `backlog/overview-mode.md`, `backlog/refine-mode.md`, the `blocked-by:` header in `flow/materialize.md`, and the dispatch queue's Blocked-exclusion report. The rule covers the whole family: any reader or report of a blocker reference names a foreign blocker in its qualified `owner/repo#N` form. If the build finds another such site, it fixes that site too rather than asking."
- Spec Decisions Q4 (verbatim): "The test that goes red when the repository check is reverted lives in the test file of the module that holds that check (`blocker-landing.test.js` if the check is in `blocker-landing.js`). The end-to-end tests in `preflight-records.test.js` stay as well. The acceptance criterion is the revert-red property; prove it by reverting the check and showing the red run." The repository check is `crossRepositoryBlockers` in `plugin/bin/lib/issues/record-dependencies.js`. Its test file is `tests/bin-lib/issues/record.test.js`, which pins every `record-dependencies.js` export through `record.js`'s re-export, so the revert-red tests live there (Task 1). The AC1.2 revert run covers that file and `preflight-records.test.js` (Task 2 Step 4).
- The qualified form is `{repository}#{number}`, for example `other/repo#5`. An unreadable foreign blocker's form adds a literal ` (state unreadable)` suffix: `other/repo#5 (state unreadable)`. `foreignBlockerRef` is the one producer of both strings. Every renderer prints a string ref verbatim and prints a number as `#N`.
- A cross-repository landing result is `{ blocker, verdict, commit: null, via, repository }`, with `via` set to `cross-repository` (state OPEN or CLOSED) or `cross-repository-state-unreadable` (any other state, verdict `open`). That is the existing four keys plus `repository` (`owner/name`), present only on cross-repository results, so every existing result keeps its exact shape. Precedent for a key present only when it applies: preflight's `nativeLinksUnchecked: true` ("the key is absent on every other run", `plugin/bin/preflight-records.js` header).
- `fetchNativeDependencies`'s `blockedBy`, `openBlocker` and `openBlockerIds` keep their values for every consumer, foreign blockers included. `crossRepoBlockers` appears only when non-empty, so existing deep-equal pins (`tests/resolve-blockers-cli.test.js`, `tests/bin-lib/preflight-records/preflight-records.test.js`, `tests/bin-lib/wrap-up/pack.test.js`, `tests/bin-lib/dispatch/dispatch-resume-cli.test.js`) stay unchanged and green (AC2.1).
- Compare against the dependent issue's own `repository.nameWithOwner`, case-insensitively, never against the caller's `owner/repo`: an `origin` remote left on a pre-transfer name must not read every blocker as foreign. A name is readable only when it is a non-empty string. A node with no readable name on either side is never foreign, so a response without the field keeps the old behavior.
- Quoted from `.claude/skills/gh-api-module-pattern/batching-failure-posture.md`: "The alias-query *builder* is a pure function in `plugin/bin/lib/issues/record-dependencies.js` (re-exported through `record.js`), separate from whatever runs it. … `record-dependencies.js` requires nothing at all and shells out nowhere, which is what lets `tests/bin-lib/issues/record.test.js` pin each builder with plain regex assertions and no fake runner at all". Also: "*Throw on a partial result* when partial data is unusable — `plugin/bin/lib/issues/native-dependencies.js`'s `fetchNativeDependencies` throws naming every missing `i{N}` alias (#723)". Every new helper lives in `record-dependencies.js` (pure), and the throw posture is unchanged.
- Quoted from `.claude/skills/merge-shape-landed-proof/SKILL.md`: "**Reuse.** `plugin/bin/lib/preflight-records/blocker-landing.js` (`fetchBlockerLanding`, `classifyBlocker`; #4553)." Their compare rules are untouched. A cross-repository blocker never reaches the GraphQL blocker query or the compare API.
- Quoted from `.claude/skills/skill-prose-conformance-tests/SKILL.md` ("New prose has no pre-change bytes"), governing every go-red control in Tasks 3, 5, 6 and 7: "Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control. A bare `assert.throws(() => assertBlock(mutated))` is satisfied by whichever assertion fails first, so a mutation can go red for the wrong reason while the assertion it was meant to prove stays vacuous." Give each assertion in a shared helper its own message, and match the control to it.
- `plugin/skills/dispatch/queue-pull-script.md` is 52,091 B against the 52,500 B `RAIL_BYTES` rail. Task 5's edit to it must stay at or under +100 B net, with every explanation going to `blocked-exclusion-report.md`/`queue-pull-notes.md`. Its Step 4 measures `wc -c`.
- Heredoc snippets (`node-eval-file.js <<NODE_EVAL_EOF` bodies) stay free of `$` and backticks other than the existing `${CLAUDE_PLUGIN_ROOT}` (`bin/node-eval-file.js` header). Build qualified strings inside the JS helpers, never in snippet template literals.
- Hand-written commits use `{Verb} {what} — {detail}` with `refs #4793`, never `closes`/`fixes`, and end with `Claude-Session: https://claude.ai/code/session_01X7gPFDPBeut8Tyt6Zo6aim`. Never `git stash`. Worktree shell: one plain command per Bash call. Anchor with `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4793"`.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Verified command

Run read-only on 2026-11-02 against `thn-inc/claude-tweaks` (the slug `git remote get-url origin` resolves to): `gh api graphql -f query='query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ i4909: issue(number:4909){ number repository{ nameWithOwner } blockedBy(first:25){ nodes{ number state repository{ nameWithOwner } } } } } }' -f owner=thn-inc -f repo=claude-tweaks` returned `{"data":{"repository":{"i4909":{"number":4909,"repository":{"nameWithOwner":"thn-inc/claude-tweaks"},"blockedBy":{"nodes":[{"number":4820,"state":"OPEN","repository":{"nameWithOwner":"thn-inc/claude-tweaks"}}]}}}}}`. No cross-repository link exists in this repo to probe, and creating one would mutate GitHub state, so the foreign branch is covered by shape only (stated risk): it is the same field the same-repository nodes return.

## Review Focus

- This repository's #5 and `other/repo#5` both block one record. The local #5 is still judged by landing, the foreign one is reported apart, and wrap-up and dispatch subtract only one occurrence. Tasks 1-5 pin it.
- A foreign blocker whose number equals an in-run record (`/flow #10,#11`, #11 natively blocked by `other/repo#10`) is not ordered as an in-run edge and is judged as a foreign blocker. Task 2 pins it.
- When the only blocker is foreign, no blocker-landing GraphQL query and no compare call are made. Task 2 pins it.
- A foreign node with no readable `state` blocks everywhere it is read: landing reads `open` with `via: cross-repository-state-unreadable`, wrap-up never reports its dependent unblocked, dispatch resume refuses, and the queue excludes. Each surface names it `owner/name#N (state unreadable)`. Tasks 1-5 pin it.
- A repository name differing only in case is the same repository, and a response without `repository` fields yields no `crossRepoBlockers` and leaves every reader's output unchanged. Task 1 pins both; Task 7's ranking test pins that a qualified string ref never counts toward this repository's same-numbered record.

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

Consumer classification (Consumer-enumeration check; `git grep -l -e fetchNativeDependencies -e resolve-blockers.js -e openBlockerIds -e buildNativeDependencyQuery -e hasOpenNativeBlocker -e partitionByOpenNativeBlockers -- plugin`):
- **Changed by Tasks 2-7:** `plugin/bin/lib/preflight-records/preflight-records.js`, `plugin/bin/preflight-records.js`, `plugin/bin/lib/wrap-up/pack.js`, `plugin/skills/wrap-up/unblocked-records.md`, `plugin/bin/dispatch-resume.js`, `plugin/skills/dispatch/queue-pull-script.md`, `plugin/skills/backlog/overview-mode.md`, `plugin/skills/backlog/refine-mode.md`, `plugin/skills/flow/materialize.md`.
- **Changed here:** `partitionByOpenNativeBlockers`, which has no runtime caller but names blocker ids, so it moves to `openNativeBlockerRefs` under Q3's whole-family rule.
- **Pass-through, no change:** `plugin/bin/resolve-blockers.js` (its `mapResult` returns the Map value as-is, so `crossRepoBlockers` reaches its JSON), `plugin/bin/lib/number-list-cli.js`.
- **Mention-only comments or prose, no change:** `activity-gather.js`, `compose-brainstorm-args.js`, `fetch-sub-issues.js`, `friction-events.js`, `lib/compose-subject.js`, `lib/issues/linked-prs.js`, `lib/health-core/dedup.js`, `resolve-linked-prs.js`, `walkthrough-encode.js`, `skills/dispatch/mcp-transport.md`, `skills/review/cross-spec-promise-check.md`.

`skills/dispatch/queue-pull-notes.md` changes in Task 5.

**Interfaces:**
- Produces, all exported from `record-dependencies.js` and re-exported by `record.js`:
  - `crossRepositoryBlockers(issueNode) -> Array<{number: number, repository: string, state: string|null}>` — each blocker node whose readable `repository.nameWithOwner` differs, case-insensitively, from the dependent node's readable name. `state` is the node's `state` when a string, else `null`.
  - `withoutCrossRepoBlockers(numbers: number[], crossRepoBlockers?: Array<{number}>) -> number[]` — a copy of `numbers` with one occurrence removed per entry's `number`, order kept. Non-array `numbers` → `[]`; non-array `crossRepoBlockers` → plain copy.
  - `foreignBlockerBlocks(entry) -> boolean` — `entry.state !== 'CLOSED'`.
  - `foreignBlockerRef(entry) -> string` — `` `${entry.repository}#${entry.number}` ``, plus `' (state unreadable)'` when `entry.state` is neither `'OPEN'` nor `'CLOSED'`.
  - `openBlockerRefs({openBlockerIds, crossRepoBlockers}) -> Array<number|string>` — this repository's open blocker numbers first, then the foreign refs. The numbers are `withoutCrossRepoBlockers(openBlockerIds, crossRepoBlockers filtered to state === 'OPEN')`, deduplicated in first-appearance order (non-array `openBlockerIds` → none). The refs are `foreignBlockerRef(b)` for each `crossRepoBlockers` entry where `foreignBlockerBlocks(b)`, in entry order.
  - `openNativeBlockerRefs(issueNode) -> Array<number|string>` — `openBlockerRefs({ openBlockerIds: <numbers of the node's OPEN blockedBy nodes>, crossRepoBlockers: crossRepositoryBlockers(issueNode) })`. A malformed or missing `blockedBy.nodes` yields `[]`.
- `partitionByOpenNativeBlockers` returns `openNativeBlockerRefs(node)` as each candidate's blocker list.
- A `fetchNativeDependencies` Map entry gains `crossRepoBlockers` only when non-empty.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/issues/record.test.js`, import the six helpers and change the line-645 projection regex to:

```js
  assert.match(q, /i39: issue\(number:39\)\{ number repository\{ nameWithOwner \} blockedBy\(first:25\)\{ nodes\{ number state repository\{ nameWithOwner \} \} \} \}/);
```

Add (the first test is the Q4 revert-red test — it goes red when `crossRepositoryBlockers`' repository check is reverted):

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
  assert.deepStrictEqual(crossRepositoryBlockers(depNode('acme/w', [blk(5, 'acme/w'), blk(5, 'other/repo', undefined)])), [{ number: 5, repository: 'other/repo', state: null }]);
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

In `tests/bin-lib/issues/native-dependencies.test.js`, import `fetchNativeDependencies` too and add:

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

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/native-dependencies.test.js`
Expected: FAIL (`crossRepositoryBlockers is not a function`; the projection regex does not match)

- [ ] **Step 3: Implement**

In `record-dependencies.js`: change `buildNativeDependencyQuery`'s per-alias expression (line 91) to the Verified command's (`issue(number:${n}){ number repository{ nameWithOwner } blockedBy(first:25){ nodes{ number state repository{ nameWithOwner } } } }`) and extend its comment (#4793). Add the six helpers beside `hasOpenNativeBlocker` with the Interfaces signatures. Give `crossRepositoryBlockers` a comment covering the Global Constraints' compare rule and why an unreadable name is never foreign. Give `foreignBlockerBlocks`/`foreignBlockerRef` a comment citing Decisions Q5's fail-closed rule. Point `partitionByOpenNativeBlockers` at `openNativeBlockerRefs(node)` and update its comment. Export the six; add them to `record.js`'s require list and `module.exports`. In `native-dependencies.js`, require `crossRepositoryBlockers` and set `entry.crossRepoBlockers` only when non-empty. Extend the header shape sentence and the function comment: "plus `crossRepoBlockers: [{number, repository, state}]` when a blocker lives in another repository (#4793)".

- [ ] **Step 4: Run tests to verify they pass, consumers unchanged**

Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/native-dependencies.test.js tests/resolve-blockers-cli.test.js tests/bin-lib/preflight-records/preflight-records.test.js tests/backlog-grant-gate-cli.test.js tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/wrap-up/pack.test.js tests/gh-host-seam-behavior.test.js`
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
- Under native mode a `buildRecords` record's `blockedBy` is `withoutCrossRepoBlockers(dep.blockedBy, dep.crossRepoBlockers)`, and `crossRepoBlockers` is copied after `fingerprint` only when non-empty.
- `records[n].blockerLanding` lists this repository's out-of-run results in `blockedBy` order, then one `classifyCrossRepository` result per `crossRepoBlockers` entry, in entry order.

- [ ] **Step 1: Write the failing tests**

`blocker-landing.test.js` (import `classifyCrossRepository`):

```js
test('AC1.1 + Q5: classifyCrossRepository — OPEN reads open, CLOSED undetermined, an unreadable state open (fail closed), with no lookup', () => {
  assert.deepEqual(classifyCrossRepository({ number: 5, repository: 'other/repo', state: 'OPEN' }), { blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' });
  assert.deepEqual(classifyCrossRepository({ number: 5, repository: 'other/repo', state: 'CLOSED' }), { blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository', repository: 'other/repo' });
  assert.deepEqual(classifyCrossRepository({ number: 5, repository: 'other/repo', state: null }), { blocker: 5, verdict: 'open', commit: null, via: 'cross-repository-state-unreadable', repository: 'other/repo' });
  assert.deepEqual(classifyCrossRepository({ number: 5, repository: 'other/repo', state: 'WEIRD' }), { blocker: 5, verdict: 'open', commit: null, via: 'cross-repository-state-unreadable', repository: 'other/repo' });
});
```

`preflight-records.test.js`: add a `buildRecords` unit test, then CLI tests placed after `landingFixture` (line ~800; `closedBlocker` is at line 791, `isCompare`/`gqlQuery` at 788-789, `cliDeps` at 227):

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
1. `AC1.1: a CLOSED native blocker in another repository is never queried by number here — undetermined cross-repository; this repository's blocker is still judged`. Input: `{ 11: [[5, 'other/repo', 'CLOSED'], [6, 'acme/w', 'CLOSED']] }`, `repository: { b6: closedBlocker('fff666') }`, `statuses: { fff666: 'behind\n' }`. Assert `blockerLanding` deep-equals `[{ blocker: 6, verdict: 'landed', commit: 'fff666', via: 'closer-pr' }, { blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository', repository: 'other/repo' }]`, `blockedBy` is `[6]`, and exactly one landing query is made, matching `/b6: issue\(number:6\)/` and not `/b5: issue/`.
2. `AC1.1: an OPEN native blocker in another repository reads open from its native state — no blocker-landing query and no compare call`. Input: `{ 11: [[5, 'other/repo', 'OPEN']] }`. Assert `blockerLanding` is `[{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]`, `landingQueries(calls).length === 0`, and `calls.filter(isCompare).length === 0`.
3. `Q5: a native blocker in another repository with no readable state reads open — fail closed, no lookup`. Input: `{ 11: [[5, 'other/repo', null]] }`. Assert `blockerLanding` is `[{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository-state-unreadable', repository: 'other/repo' }]` and `landingQueries(calls).length === 0`.
4. `this repository's #5 and another repository's #5 both blocking: the local one is judged, the foreign one is reported apart`. Input: `{ 11: [[5, 'acme/w', 'CLOSED'], [5, 'other/repo', 'OPEN']] }`, `repository: { b5: closedBlocker('eee555') }`, `statuses: { eee555: 'diverged\n' }`. Assert `[{ blocker: 5, verdict: 'unlanded', commit: 'eee555', via: 'closer-pr' }, { blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]`.
5. `a foreign blocker whose number is an in-run record is judged as foreign, not dropped as in-run`. Run `nativeArgs('10', '11')` with `{ 10: [], 11: [[10, 'other/repo', 'OPEN']] }`. Assert record 11's `blockedBy` is `[]` and its `blockerLanding` is `[{ blocker: 10, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/preflight-records/blocker-landing.test.js tests/bin-lib/preflight-records/preflight-records.test.js`
Expected: FAIL after Step 1 (`classifyCrossRepository is not a function`; `b5: issue(number:5)` queried)

- [ ] **Step 3: Implement**

- `blocker-landing.js`: add `classifyCrossRepository` as `{ ...result(number, verdict, null, via), repository }`. Its comment says the number names another repository's issue, so it is never queried or probed here, and its verdict comes from the native node's state (#4793, Decisions Q1 and Q5). Add `cross-repository` and `cross-repository-state-unreadable` to the header's `via` list (lines 10-13), and say the `open` verdict can also come from them. Export it.
- `preflight-records.js` lib: `buildRecords` (line 140) sets native `blockedBy` via `withoutCrossRepoBlockers` and appends `crossRepoBlockers` after `fingerprint` only when non-empty. Extend the line-114 shape comment, the `buildRecords` comment (lines 133-139) and `outOfRunBlockers`'s comment (line 183; cross-repository blockers never reach it).
- `plugin/bin/preflight-records.js`: in the `opts.blockerLanding` block (line ~396), append `(records[String(n)].crossRepoBlockers || []).map(classifyCrossRepository)` after the per-record map. Extend the header's `--blocker-landing` paragraph (lines 30-44) with the cross-repository entries, both `via` values, and the record's `crossRepoBlockers` key under native mode.

- [ ] **Step 4: Run tests to verify they pass, and prove AC1.2 (Q4)**

Run: `node --test tests/bin-lib/preflight-records/blocker-landing.test.js tests/bin-lib/preflight-records/preflight-records.test.js tests/flow-blocker-landing-conformance.test.js tests/resolve-blockers-cli.test.js`
Expected: PASS

AC1.2: in a scratch edit, make `crossRepositoryBlockers` in `record-dependencies.js` return `[]`. Run `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T114006-record-4793/evidence"`. Then run `node --test tests/bin-lib/issues/record.test.js` redirected to `{evidence dir}/ac1-2-revert-record.txt`, and `node --test tests/bin-lib/preflight-records/preflight-records.test.js` redirected to `{evidence dir}/ac1-2-revert-preflight.txt`. Expected: `record.test.js` FAILS on the `AC1.1/AC1.2 (#4793)` test (the module-local revert-red test Q4 requires) and the other foreign-listing tests. `preflight-records.test.js` FAILS on CLI tests 1-5: `b5`/`b10` join the landing query, which the fixture answers with no alias, a whole-query failure with exit 1. Undo with the Edit tool and confirm `git diff --stat -- plugin/bin/lib/issues/record-dependencies.js` prints nothing. Log one entry with `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.160.0/bin/log-decision.js" --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T114006-record-4793" --section "/build" --status AUTO --step "AC evidence" --text-file {file} --reversibility n/a`. It cites AC1.2, the command shapes, each file's fail/pass counts quoted from the `ℹ fail`/`ℹ pass` summary lines, and both evidence paths.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/preflight-records/blocker-landing.js plugin/bin/lib/preflight-records/preflight-records.js plugin/bin/preflight-records.js tests/bin-lib/preflight-records/blocker-landing.test.js tests/bin-lib/preflight-records/preflight-records.test.js
git commit -m "Judge a cross-repository native blocker from its native state in blocker landing — never look it up by number, refs #4793"
```

- [ ] **Step 6: Real-input probe**

From the worktree run `node plugin/bin/preflight-records.js 4909 4735 --blocker-landing --work-links native`, redirected to `{evidence dir}/preflight-native-live.txt`. Independent count (Verified command plus `gh issue view 4735 --json number`): #4909 is blocked by #4820 and #4735 by #4589, both this repository's. So both appear in `blockedBy`, neither record carries `crossRepoBlockers`, and both `blockerLanding` entries carry no `repository` key. Log one `AC evidence` entry (AC2.1) the same way, naming the path.

### Task 3: Wrap-up's newly-unblocked check skips cross-repository blocker numbers

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js`
- Modify: `plugin/skills/wrap-up/unblocked-records.md` (7,980 B; +~400 B leaves ~44 KB under the 52,500 B rail)
- Test: `tests/bin-lib/wrap-up/pack.test.js`
- Test: `tests/wrap-up-pack-conformance.test.js`

**Interfaces:**
- Consumes: `withoutCrossRepoBlockers`, `foreignBlockerBlocks` from `../issues/record` (Task 1). `resolve-blockers.js` output entries now carry `crossRepoBlockers` when present (pass-through).

- [ ] **Step 1: Write the failing tests**

In `pack.test.js`, beside the `#2425` native tests (line ~484), add three tests. Each drives `gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['unblocked'], deps })` with `okDeps({ execFile })` answering `resolve-blockers.js` (closed record 1535, open dependent 1600 'Dependent'):
- `Q2: a dependent blocked only by another repository's #1535 is not reported unblocked when this repository closes #1535`. Stdout `{ 1600: { blockedBy: [1535], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 1535, repository: 'other/repo', state: 'CLOSED' }] } }` → `pack.unblocked.value` deep-equals `[]`.
- `Q2: this repository's #1535 beside another repository's #1535 still reports the dependent unblocked`. `blockedBy: [1535, 1535]`, same single foreign entry → `[{ number: 1600, title: 'Dependent' }]`.
- `Q5: a foreign blocker with no readable state keeps the dependent blocked`. `blockedBy: [1535, 7]`, `openBlocker: false`, `openBlockerIds: []`, `crossRepoBlockers: [{ number: 7, repository: 'other/repo', state: null }]` → `[]`.

In `wrap-up-pack-conformance.test.js`, add one test plus its go-red control, sharing one assertion function `assertNativeSnippetSkipsCrossRepo(text)`. The function checks that the `work-links: native` snippet in `unblocked-records.md` requires `bin/lib/issues/record.js` for `{ withoutCrossRepoBlockers, foreignBlockerBlocks }`, and that it filters with `withoutCrossRepoBlockers(byNumber[r.number].blockedBy, byNumber[r.number].crossRepoBlockers).includes(closedNum)` and `!(byNumber[r.number].crossRepoBlockers || []).some(foreignBlockerBlocks)`. It also checks the snippet no longer contains `byNumber[r.number].blockedBy.includes(closedNum)`. The control runs the same function on the text with the `withoutCrossRepoBlockers(` call replaced by `byNumber[r.number].blockedBy` and expects it to throw.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/wrap-up-pack-conformance.test.js`
Expected: FAIL after Step 1 (the foreign-only and unreadable-state dependents are reported; the snippet lacks the helpers)

- [ ] **Step 3: Implement**

`pack.js`: import `withoutCrossRepoBlockers` and `foreignBlockerBlocks` beside `parseDependencies` (line 18). The native filter (line 739) becomes `withoutCrossRepoBlockers(e.blockedBy, e.crossRepoBlockers).includes(closed) && !e.openBlocker && !(e.crossRepoBlockers || []).some(foreignBlockerBlocks)`, with `e = byNumber[r.number]` (keep the `byNumber[r.number] &&` existence guard). Add a one-line comment citing #4793 Decisions Q2/Q5.

`unblocked-records.md`: in the native snippet (lines 50-70), require `{ withoutCrossRepoBlockers, foreignBlockerBlocks }` from `'${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js'` and use both in the filter (line 67). Append to the paragraph after the snippet: "A blocker linked from another repository shares only its number with this repository's issues, so `crossRepoBlockers` numbers are removed before the `includes(closedNum)` test, and a foreign blocker that is not CLOSED (OPEN, or state unreadable) keeps its dependent blocked (#4793) — closing this repository's #N never reports a record blocked by `other/repo#N` as unblocked."

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
- Produces: `readOpenBlockers` (line 276) returns this repository's open blocker numbers (body-text plus native) ascending and deduplicated, followed by the string refs `openBlockerRefs(entry)` yields, in its order. `resume-eligibility.js`'s `blocked-by` line renders a string entry verbatim and a number as `#N`.

- [ ] **Step 1: Write the failing tests**

`resume-eligibility.test.js`, a row after the `'open blockers'` row (line 318): `['open blockers with a foreign one', { openBlockers: [4500, 'other/repo#5', 'other/repo#6 (state unreadable)'] }, 'blocked-by', '#4589 is blocked by open #4500, other/repo#5, other/repo#6 (state unreadable) — not resumable until they close; then run /claude-tweaks:dispatch resume #4589', 'resume']`.

`dispatch-resume-cli.test.js`, beside the dedup test (line ~748):

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

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/dispatch/resume-eligibility.test.js`
Expected: FAIL after Step 1 (line reads `open #5 —` / `#other/repo#5`; the unreadable case resumes)

- [ ] **Step 3: Implement**

`dispatch-resume.js` `readOpenBlockers`: under native, iterate `openBlockerRefs(entry)`. Add each number to the `open` set and push each string to a `foreign` array. Return `[...open].sort((a, b) => a - b)` followed by `foreign`, and update its comment (#4793, Q5). Keep the existing `!Array.isArray(entry.openBlockerIds)` exit-4 guard. `resume-eligibility.js` line 322: render each entry as `typeof b === 'string' ? b : \`#${b}\``. Extend the line-250 inputs comment to say `openBlockers` may carry `owner/name#N` strings, optionally suffixed ` (state unreadable)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/dispatch/resume-eligibility.test.js tests/dispatch-resume-prose.test.js`
Expected: PASS, pre-existing tests unchanged

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/dispatch-resume.js plugin/bin/lib/dispatch/resume-eligibility.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/dispatch/resume-eligibility.test.js
git commit -m "Name a foreign blocker by its repository in dispatch resume's refusal, refs #4793"
```

### Task 5: The dispatch queue's Blocked-exclusion report names a foreign blocker by its repository

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (52,091 B; net +100 B ceiling, see Global Constraints)
- Modify: `plugin/skills/dispatch/blocked-exclusion-report.md`
- Modify: `plugin/skills/dispatch/queue-pull-notes.md`
- Test: `tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js` (create)

**Interfaces:**
- Consumes: `openBlockerRefs` from `bin/lib/issues/record.js` (Task 1).
- Produces: a `reason: 'blocked'` exclusion's `detail.blockedBy` may now carry `owner/name#N` strings (optionally ` (state unreadable)`) beside numbers. A candidate is excluded under native mode exactly when `openBlockerRefs(dep)` is non-empty, which adds a foreign blocker with an unreadable state to today's `openBlockerIds` rule (Q5).

- [ ] **Step 1: Write the failing test**

Create `tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js` on `tests/dispatch-named-target-exclusion-fixture.test.js`'s extract-and-run pattern (`readText`, a structural start/end anchor, `execFileSync('bash', ['-c', snippet], …)`, `PLUGIN_ROOT` with forward slashes, scratch files under `os.tmpdir()`).
- Start anchor: `'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_ELIGIBLE" "$DISPATCH_NATIVE_DEPS"'`. End anchor: the first `'\nNODE_EVAL_EOF'` after it.
- Run the extracted grouping snippet with `CLAUDE_PLUGIN_ROOT` and every `DISPATCH_*` variable it names set to scratch paths. Inputs: eligible `[11, 12, 13]`, each `{ number, labels: ['ready', 'auto:build'], body: '### Key Files\n\n- `f{n}.js` (modify)' }`; group-size guard `10`; bundle cap `3`; body exclusions `[]`. Native deps:
  - `11: { blockedBy: [5], openBlocker: true, openBlockerIds: [5], crossRepoBlockers: [{ number: 5, repository: 'other/repo', state: 'OPEN' }] }`
  - `12: { blockedBy: [6], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 6, repository: 'other/repo', state: null }] }`
  - `13: { blockedBy: [7], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 7, repository: 'other/repo', state: 'CLOSED' }] }`
- Test `a foreign open or unreadable-state native blocker excludes its record and is named owner/name#N in the exclusion (#4793)`. Read the exclusions file's `reason: 'blocked'` entries. Assert they deep-equal `[{ reason: 'blocked', records: [11], detail: { blockedBy: ['other/repo#5'] } }, { reason: 'blocked', records: [12], detail: { blockedBy: ['other/repo#6 (state unreadable)'] } }]` (compare only `reason`/`records`/`detail` if the writer adds other keys), and assert the groups stdout holds record 13 and neither 11 nor 12.
- Test `blocked-exclusion-report.md renders a string blocker entry verbatim, never with a # prefix`. Assert the report text contains `` `owner/name#N` `` and the phrase `renders verbatim`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js`
Expected: FAIL (record 11 excluded with `blockedBy: [5]`; record 12 not excluded; the report has no verbatim rule)

- [ ] **Step 3: Implement**

- `queue-pull-script.md` grouping snippet (lines 201-212): add `const { openBlockerRefs } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');` after the `appendExclusion` require. Replace the `openIds` line with `const refs = dep ? openBlockerRefs(dep) : [];`, and replace `openIds` with `refs` in the push line. In the line-5 bullet, replace `` `bin/resolve-blockers.js`'s `openBlockerIds` field `` with `` `record.js`'s `openBlockerRefs` over `bin/resolve-blockers.js`'s output (#4793) ``. Add nothing else to this file.
- `blocked-exclusion-report.md`: after the rendered line template, add: "A `blockedBy` entry that is a string — `owner/name#N`, a blocker linked natively from another repository, optionally suffixed ` (state unreadable)` when its state could not be read (#4793) — renders verbatim, never with a `#` prefix; a number renders as `#N`."
- `queue-pull-notes.md` line 11: change "drops any candidate whose `openBlockerIds` array is non-empty — that field is the identical OPEN-state filter …" so that it says the script drops any candidate for which `record.js`'s `openBlockerRefs` is non-empty. That covers this repository's `openBlockerIds` less any foreign numbers, plus each foreign blocker that is not CLOSED, named `owner/name#N` (#4793). Keep the rest of the sentence.

- [ ] **Step 4: Run tests to verify they pass, and measure the rail**

Run: `node --test tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js tests/dispatch-named-target-exclusion-fixture.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/dispatch-per-record-groups-prose.test.js tests/node-eval-file-heredoc-syntax.test.js tests/hooks-dispatcher.test.js`
Expected: PASS

Run: `wc -c plugin/skills/dispatch/queue-pull-script.md`
Expected: at most 52,191 (52,091 + 100) and at most 52,500

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/blocked-exclusion-report.md plugin/skills/dispatch/queue-pull-notes.md tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js
git commit -m "Name a foreign blocker owner/name#N in dispatch's Blocked-exclusion report, refs #4793"
```

### Task 6: Flow verdict prose, journey and shape docs name the cross-repository case

**Role:** integration

**Files:**
- Modify: `plugin/skills/flow/multispec-dependency-ordering.md` (5,289 B; +~700 B, far under the 52,500 B rail)
- Test: `tests/flow-blocker-landing-conformance.test.js`
- Modify: `docs/journeys/stop-a-run-whose-closed-blocker-never-landed-4553.md` (line 40)
- Modify: `plugin/bin/resolve-blockers.js` (header lines 23-27 only)
- Modify: `docs/plugin-structure.md` (lines 64 and 233)

Moved-prose pin check: `tests/flow-blocker-landing-conformance.test.js:89-93` pins the existing `{text-file}` holder line, and `holderSentence` (line 70) reads the first `` `{text-file}` holds one line `` occurrence. The existing sentence stays unchanged, and the new paragraph must not contain that phrase.

- [ ] **Step 1: Write the failing test**

In `flow-blocker-landing-conformance.test.js`, add `assertCrossRepositoryNaming(text)` over `outOfRunSection(text)`. It asserts the section contains `` `via: cross-repository` ``, `` `via: cross-repository-state-unreadable` ``, `` `{repository}#{blocker}` ``, the literal SKIP line `` `condition: {repository}#{blocker} lives in another repository (via cross-repository) → fallback: proceeded without judging its landing — blocker landing reads only this repository's integration branch` ``, and the literal stop line `"159 depends on {repository}#{blocker}, whose state was unreadable — read as open (fail closed)"`. It must also still pass `assertUndeterminedSkip(text)`. The test `cross-repository entries are named {repository}#{blocker} in the stop line and the SKIP text (#4793)` calls it on the real file. Its go-red control calls the same function on the text with `{repository}#{blocker}` replaced by `#{blocker}` and expects a throw.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-blocker-landing-conformance.test.js`
Expected: FAIL after Step 1 (the section has no cross-repository paragraph)

- [ ] **Step 3: Write the prose**

- `multispec-dependency-ordering.md`, a paragraph after the `{text-file}` paragraph (line 52): "An entry with `via: cross-repository` or `via: cross-repository-state-unreadable` is a blocker linked natively from another repository; its `repository` key holds `owner/name`, and its number names that repository's issue, so write it as `{repository}#{blocker}`. An `open` entry stops as the table says, its stop line naming `{repository}#{blocker}`; with `via: cross-repository-state-unreadable` the stop line reads "159 depends on {repository}#{blocker}, whose state was unreadable — read as open (fail closed)". An `undetermined` entry writes the SKIP line `condition: {repository}#{blocker} lives in another repository (via cross-repository) → fallback: proceeded without judging its landing — blocker landing reads only this repository's integration branch` (#4793, Decisions Q1 and Q5)."
- Journey line 40, after the `not-found` sentence: "A native blocker linked from another repository is never looked up by number in this repository: it reads `open` when its native state is OPEN or unreadable (`via: cross-repository-state-unreadable`, fail closed) and `undetermined`/`cross-repository` when CLOSED, named `owner/name#N`."
- `resolve-blockers.js` header (line 25) and `docs/plugin-structure.md` lines 64 and 233: each shape sentence gains "plus `crossRepoBlockers: [{number, repository, state}]` when a blocker lives in another repository (#4793)".

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/flow-blocker-landing-conformance.test.js tests/resolve-blockers-cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/multispec-dependency-ordering.md tests/flow-blocker-landing-conformance.test.js docs/journeys/stop-a-run-whose-closed-blocker-never-landed-4553.md plugin/bin/resolve-blockers.js docs/plugin-structure.md
git commit -m "Name cross-repository blockers in flow's verdict prose, journey and shape docs, refs #4793"
```

### Task 7: Backlog's native blocked-by attachment and materialize's `blocked-by:` header never read a foreign blocker as #N

**Role:** integration

**Files:**
- Modify: `plugin/skills/backlog/overview-mode.md` (39,811 B; lines 87 and 203)
- Modify: `plugin/skills/backlog/refine-mode.md` (43,379 B; line 420)
- Modify: `plugin/skills/flow/materialize.md` (40,338 B; line 111)
- Test: `tests/cross-repo-blocker-readers-conformance.test.js` (create)
- Test: `tests/bin-lib/issues/ranking.test.js`

What each site does today, checked: overview's pre-attach and Step 3 bullet attach `blockedBy` as the open node numbers. `funnelBuckets` (`backlog.js:207`) keeps only ids in the open record set, `computeUnblocksCount` (`ranking.js:52`) credits each id, and `findUnresolvedDependencyProse` (`ranking.js:94`) suppresses its flag on any non-empty list. So a bare foreign number can land a record in `granted` or credit an unblock to this repository's same-numbered record, while dropping it outright would wrongly flag a natively-wired record for re-wiring. Attaching the foreign blocker as its qualified string fixes both: a string never equals a numeric id, and it still counts as wired.

`materialize.md`'s `blocked-by` bullet describes a native resolution. `plugin/bin/materialize.js:641` actually composes the header from `parseDependencies(record.body)` in every mode, and `DEP_RE` (`^Blocked by #(\d+)`) cannot match another repository's reference. The header code therefore needs no change, and the prose fix states the foreign rule for the native branch it describes. The prose/CLI mismatch itself predates this record: the controller routes it as a follow-up at Common Step 4, not here.

**Interfaces:**
- Consumes: `openNativeBlockerRefs`, `withoutCrossRepoBlockers` (Task 1).

- [ ] **Step 1: Write the failing tests**

`ranking.test.js`, one characterization test of the contract the prose now relies on. It uses the file's `candidate()` helper (line 9): all keys tie, so `rankNextToBuild`'s stable sort keeps input order unless an unblock credit moves a record. `PROSE_DEP_RE` (`ranking.js:93`, `/blocked by\b[^\n#]*#\d+/i`) matches `'Blocked by other/repo#5'`.

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

Create `tests/cross-repo-blocker-readers-conformance.test.js` (`readText` from `./helpers/read-skill`), with one assertion function per site and one go-red control per function. Each control runs the function on the text with the new helper name replaced by the old wording and expects a throw:
- `assertOverviewAttachesRefs(text)`: `overview-mode.md` names `openNativeBlockerRefs` in both the pre-attach paragraph (the one starting `**Native blocked-by pre-attach`) and Step 3's `**\`work-links: native\`**` bullet. It no longer contains `nodes.filter(open).map(number)`, and it contains `owner/name#N`.
- `assertRefineAttachesRefs(text)`: the `refine-mode.md` paragraph starting `- Refine runs the detection itself` names `openNativeBlockerRefs`.
- `assertMaterializeHeaderSkipsForeign(text)`: `materialize.md`'s `` - `blocked-by` `` bullet names `withoutCrossRepoBlockers` and `owner/name#N`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/cross-repo-blocker-readers-conformance.test.js tests/bin-lib/issues/ranking.test.js`
Expected: the conformance tests FAIL (no site names the helpers yet). The ranking test passes already, since it characterizes `blockersOf`'s existing contract, which no code here changes. It is a pin, not a red step.

- [ ] **Step 3: Write the prose**

- `overview-mode.md` line 87: replace `set \`r.blockedBy = nodes.filter(open).map(number)\` using \`hasOpenNativeBlocker\`-equivalent open-state filtering (\`record.js\`)` with `set \`r.blockedBy = openNativeBlockerRefs(node)\` (\`bin/lib/issues/record.js\`) — this repository's open blocker numbers, plus each still-blocking blocker linked from another repository as its qualified \`owner/name#N\` string (#4793), which never matches a record id in this set yet still counts as wired`.
- `overview-mode.md` line 203: replace `attach \`blockedBy: [ids]\` (the open blockers' numbers from each alias's \`blockedBy.nodes\`)` with `attach \`blockedBy: openNativeBlockerRefs(node)\` (\`bin/lib/issues/record.js\`; open blocker numbers, with a blocker from another repository as its qualified \`owner/name#N\` string, #4793)`.
- `refine-mode.md` line 420: after `one aliased \`buildNativeDependencyQuery\` call over the fetched candidates`, add `, attaching \`openNativeBlockerRefs(node)\` per candidate (a blocker from another repository attaches as \`owner/name#N\`, #4793)`.
- `materialize.md` line 111, in the native clause after `resolving \`blockedBy\` (…)`: add `minus its \`crossRepoBlockers\` numbers (\`withoutCrossRepoBlockers\`, \`bin/lib/issues/record.js\`, #4793) — a blocker linked from another repository is never this repository's \`n\`, so it stays out of \`blocked-by:\`, and \`--blocker-landing\` names it \`owner/name#N\``.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/cross-repo-blocker-readers-conformance.test.js tests/bin-lib/issues/ranking.test.js tests/backlog-overview-foldin-no-truncation.test.js tests/backlog-refine-foldin-no-truncation.test.js tests/raw-markdown-read-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/backlog/overview-mode.md plugin/skills/backlog/refine-mode.md plugin/skills/flow/materialize.md tests/cross-repo-blocker-readers-conformance.test.js tests/bin-lib/issues/ranking.test.js
git commit -m "Attach foreign native blockers as owner/name#N in backlog and keep them out of materialize's blocked-by header, refs #4793"
```

## Spec coverage

| Spec clause | Task |
|---|---|
| Deliverable 1: project `repository { nameWithOwner }`, carry it with the number | Task 1 |
| Deliverable 2 + Decisions Q1: cross-repository verdict in `blocker-landing.js`, pinned in the blocker-landing suite | Task 2 (`classifyCrossRepository`, its unit test) |
| Decisions Q2: `pack.js` + `unblocked-records.md` drop `crossRepoBlockers` numbers, new test | Task 3 |
| Decisions Q3: overview, refine, `materialize.md` header, dispatch queue report, whole family | Task 7 (backlog, materialize); Task 5 (queue report); Task 4 (dispatch resume); Task 1 (`partitionByOpenNativeBlockers`); Task 6 (flow verdict prose) |
| Decisions Q4: revert-red test next to the check; end-to-end tests stay | Task 1 (`record.test.js` `AC1.1/AC1.2 (#4793)` test); Task 2 Step 4 revert run over both files |
| Decisions Q5: unreadable foreign state reads open, text says state unreadable | Task 1 (`foreignBlockerBlocks`/`foreignBlockerRef`); Task 2 (`cross-repository-state-unreadable`); Tasks 3-6 |
| AC1.1: a native blocker whose repository differs does not query this repository's issue of the same number | Task 2 CLI tests 1-3 |
| AC1.2: reverting the repository check turns it red | Task 2 Step 4 mutation, logged as AC evidence |
| AC2.1: `buildNativeDependencyQuery`'s dispatch and wrap-up consumer tests pass unchanged | Task 1 Step 4 consumer suites; Task 3/4/5 Step 4; Task 2 Step 6 probe |
