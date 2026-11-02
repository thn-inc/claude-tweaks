# Cross-Repository Native Blockers Implementation Plan (#4793)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native blocker linked from another repository is carried with its repository and state, is never looked up by number in this repository, and reads `open` (native state OPEN) or `undetermined`/`cross-repository` (otherwise) in `--blocker-landing`; wrap-up's newly-unblocked check and `dispatch resume`'s refusal stop confusing it with this repository's same-numbered issue.

**Architecture:** `buildNativeDependencyQuery` projects `repository{ nameWithOwner }` on each dependent issue and each blocker node. A pure helper `crossRepositoryBlockers(issueNode)` lists foreign blockers as `{number, repository, state}`; a second pure helper `withoutCrossRepoBlockers(numbers, crossRepoBlockers)` removes one occurrence per foreign entry. `fetchNativeDependencies` adds `crossRepoBlockers` only when non-empty, leaving `blockedBy`/`openBlocker`/`openBlockerIds` unchanged. Pre-flight's `buildRecords`, wrap-up's `unblocked` probe and its skill snippet, and `dispatch-resume.js` each subtract the foreign numbers with the one helper; `blocker-landing.js` classifies each foreign entry from its native state with no lookup.

**Tech Stack:** Node 18+ CommonJS, `gh api graphql`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T205244-record-4793/work/4793-spec.md` (worktree copy; carries the `## Decisions` section this plan implements)

Scope keywords: crossRepoBlockers, withoutCrossRepoBlockers, crossRepositoryBlockers

## Global Constraints

- Spec Decisions Q1 (verbatim): "a cross-repository blocker whose native `blockedBy` node `state` is `OPEN` reads `open` (taken from the native node, no extra lookup), so `/flow` stops before the claim. Only a CLOSED cross-repository blocker reads `undetermined` with `via: cross-repository`." Any non-`OPEN` state (CLOSED, or missing) reads `undetermined`.
- Spec Decisions Q2 (verbatim): "This record also makes `plugin/bin/lib/wrap-up/pack.js` (around line 732) and `plugin/skills/wrap-up/unblocked-records.md` (around line 67) remove the `crossRepoBlockers` numbers before the `blockedBy.includes(closed)` test … Add a new test for that case; existing consumer tests stay unchanged."
- A cross-repository landing result is `{ blocker, verdict, commit: null, via: 'cross-repository', repository }` — the existing four keys plus `repository` (`owner/name`), present only on cross-repository results, so every existing result keeps its exact shape. Precedent for a key present only when it applies: preflight's `nativeLinksUnchecked: true` ("the key is absent on every other run", `plugin/bin/preflight-records.js` header).
- `fetchNativeDependencies`'s `blockedBy`, `openBlocker` and `openBlockerIds` keep their values for every consumer, foreign blockers included: a foreign OPEN blocker still excludes a record from the dispatch queue (consistent with Q1). `crossRepoBlockers` appears only when non-empty, so existing deep-equal pins (`tests/resolve-blockers-cli.test.js`, `tests/bin-lib/preflight-records/preflight-records.test.js`, `tests/bin-lib/wrap-up/pack.test.js`, `tests/bin-lib/dispatch/dispatch-resume-cli.test.js`) stay unchanged and green (AC2.1).
- Compare against the dependent issue's own `repository.nameWithOwner`, case-insensitively, never the caller's `owner/repo`: an `origin` remote left on a pre-transfer name must not read every blocker as foreign. A name is readable only when it is a non-empty string; a node with no readable name on either side is never foreign, so a response without the field keeps the old behavior.
- Quoted from `.claude/skills/gh-api-module-pattern/batching-failure-posture.md`: "The alias-query *builder* is a pure function in `plugin/bin/lib/issues/record-dependencies.js` (re-exported through `record.js`), separate from whatever runs it. … `record-dependencies.js` requires nothing at all and shells out nowhere, which is what lets `tests/bin-lib/issues/record.test.js` pin each builder with plain regex assertions and no fake runner at all". Also: "*Throw on a partial result* when partial data is unusable — `plugin/bin/lib/issues/native-dependencies.js`'s `fetchNativeDependencies` throws naming every missing `i{N}` alias (#723)". Both helpers live in `record-dependencies.js` (pure); the throw posture is unchanged.
- Quoted from `.claude/skills/merge-shape-landed-proof/SKILL.md`: "**Reuse.** `plugin/bin/lib/preflight-records/blocker-landing.js` (`fetchBlockerLanding`, `classifyBlocker`; #4553)." Their compare rules are untouched; a cross-repository blocker never reaches the GraphQL blocker query or the compare API.
- Hand-written commits use `{Verb} {what} — {detail}` with `refs #4793`, never `closes`/`fixes`, and end with `Claude-Session: https://claude.ai/code/session_01X7gPFDPBeut8Tyt6Zo6aim`. Never `git stash`. Worktree shell: one plain command per Bash call; anchor with `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4793"`.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Verified command

Run read-only on 2026-11-02 against `thn-inc/claude-tweaks` (the slug `git remote get-url origin` resolves to): `gh api graphql -f query='query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ i4909: issue(number:4909){ number repository{ nameWithOwner } blockedBy(first:25){ nodes{ number state repository{ nameWithOwner } } } } } }' -f owner=thn-inc -f repo=claude-tweaks` returned `{"data":{"repository":{"i4909":{"number":4909,"repository":{"nameWithOwner":"thn-inc/claude-tweaks"},"blockedBy":{"nodes":[{"number":4820,"state":"OPEN","repository":{"nameWithOwner":"thn-inc/claude-tweaks"}}]}}}}}`. No cross-repository link exists in this repo to probe, and creating one would mutate GitHub state, so the foreign branch is covered by shape only (stated risk): it is the same field the same-repository nodes return.

## Review Focus

- This repository's #5 and `other/repo#5` both block one record: the local #5 is still judged by landing, the foreign one is reported apart, and wrap-up/dispatch-resume subtract only one occurrence. Tasks 1-4 pin it.
- A foreign blocker whose number equals an in-run record (`/flow #10,#11`, #11 natively blocked by `other/repo#10`): it is not ordered as an in-run edge and is judged as a foreign blocker. Task 2 pins it.
- The only blocker is foreign: no blocker-landing GraphQL query and no compare call are made. Task 2 pins it.
- A repository name differing only in case is the same repository; a response without `repository` fields yields no `crossRepoBlockers`. Task 1 pins both.
- A foreign blocker's verdict text names it as `{repository}#{blocker}`, never a bare `#N` (flow stop/SKIP line, dispatch-resume refusal). Tasks 4-5 pin it.

---

### Task 1: Project the blocker repository and carry cross-repository blockers

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/record-dependencies.js`
- Modify: `plugin/bin/lib/issues/record.js`
- Modify: `plugin/bin/lib/issues/native-dependencies.js`
- Test: `tests/bin-lib/issues/record.test.js`
- Test: `tests/bin-lib/issues/native-dependencies.test.js`

Consumer classification (Consumer-enumeration check; `git grep -l -e fetchNativeDependencies -e resolve-blockers.js -e openBlockerIds -- plugin`): changed by Tasks 2-4 — `plugin/bin/lib/preflight-records/preflight-records.js`, `plugin/bin/preflight-records.js`, `plugin/bin/lib/wrap-up/pack.js`, `plugin/skills/wrap-up/unblocked-records.md`, `plugin/bin/dispatch-resume.js`; pass-through, no change — `plugin/bin/resolve-blockers.js` (its `mapResult` returns the Map value as-is, so `crossRepoBlockers` reaches its JSON), `plugin/bin/lib/number-list-cli.js`; semantics unchanged — `plugin/skills/dispatch/queue-pull-script.md` (excludes on `openBlockerIds`, so a foreign OPEN blocker still excludes; its Blocked-exclusion report names ids as bare `#N` — controller routes that naming gap at Common Step 4); mention-only comments, no change — `activity-gather.js`, `compose-brainstorm-args.js`, `fetch-sub-issues.js`, `friction-events.js`, `lib/compose-subject.js`, `lib/issues/linked-prs.js`, `resolve-linked-prs.js`, `walkthrough-encode.js`, `skills/dispatch/queue-pull-notes.md`, `skills/dispatch/mcp-transport.md`, `skills/flow/materialize.md`, `skills/review/cross-spec-promise-check.md`.

**Interfaces:**
- Produces: `crossRepositoryBlockers(issueNode) -> Array<{number: number, repository: string, state: string|null}>` and `withoutCrossRepoBlockers(numbers: number[], crossRepoBlockers?: Array<{number}>) -> number[]` (a copy of `numbers` with one occurrence removed per entry's `number`, order kept; non-array `numbers` → `[]`; non-array `crossRepoBlockers` → plain copy). Both exported from `record-dependencies.js` and re-exported by `record.js`. A `fetchNativeDependencies` Map entry gains `crossRepoBlockers` only when non-empty.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/issues/record.test.js`, import both helpers and change the line-645 projection regex to:

```js
  assert.match(q, /i39: issue\(number:39\)\{ number repository\{ nameWithOwner \} blockedBy\(first:25\)\{ nodes\{ number state repository\{ nameWithOwner \} \} \} \}/);
```

Add:

```js
const depNode = (home, blockers) => ({ number: 1, repository: home === null ? undefined : { nameWithOwner: home }, blockedBy: { nodes: blockers } });
const blk = (number, repo, state = 'CLOSED') => ({ number, state, ...(repo === undefined ? {} : { repository: { nameWithOwner: repo } }) });

test('crossRepositoryBlockers lists each blocker whose repository differs from the dependent issue\'s, with its state', () => {
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
test('crossRepositoryBlockers keeps a same-number pair apart: only the foreign one is listed', () => {
  assert.deepStrictEqual(crossRepositoryBlockers(depNode('acme/w', [blk(5, 'acme/w'), blk(5, 'other/repo')])), [{ number: 5, repository: 'other/repo', state: 'CLOSED' }]);
});
test('withoutCrossRepoBlockers removes one occurrence per foreign entry, keeping order', () => {
  assert.deepStrictEqual(withoutCrossRepoBlockers([5, 6, 5], [{ number: 5 }]), [6, 5]);
  assert.deepStrictEqual(withoutCrossRepoBlockers([5, 6], undefined), [5, 6]);
  assert.deepStrictEqual(withoutCrossRepoBlockers(undefined, [{ number: 5 }]), []);
  assert.deepStrictEqual(withoutCrossRepoBlockers([6], [{ number: 5 }]), [6]);
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

In `record-dependencies.js`: change `buildNativeDependencyQuery`'s per-alias expression to the Verified command's (`issue(number:${n}){ number repository{ nameWithOwner } blockedBy(first:25){ nodes{ number state repository{ nameWithOwner } } } }`) and extend its comment (#4793). Add `crossRepositoryBlockers` beside `hasOpenNativeBlocker` (state is the node's `state` when a string, else `null`) and `withoutCrossRepoBlockers` beside it, each with a comment covering the Global Constraints' compare rule and why an unreadable name is never foreign. Export both; add both to `record.js`'s require list and `module.exports`. In `native-dependencies.js`, require `crossRepositoryBlockers` and set `entry.crossRepoBlockers` only when non-empty; extend the header shape sentence and the function comment: "plus `crossRepoBlockers: [{number, repository, state}]` when a blocker lives in another repository (#4793)".

- [ ] **Step 4: Run tests to verify they pass, consumers unchanged**

Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/native-dependencies.test.js tests/resolve-blockers-cli.test.js tests/bin-lib/preflight-records/preflight-records.test.js tests/backlog-grant-gate-cli.test.js tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/wrap-up/pack.test.js tests/gh-host-seam-behavior.test.js`
Expected: PASS, with no edit to any consumer suite (AC2.1)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-dependencies.js plugin/bin/lib/issues/record.js plugin/bin/lib/issues/native-dependencies.js tests/bin-lib/issues/record.test.js tests/bin-lib/issues/native-dependencies.test.js
git commit -m "Project native blockers' repository — carry cross-repository blockers with their state, refs #4793"
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
- Produces: `classifyCrossRepository({number, repository, state}) -> {blocker, verdict: 'open'|'undetermined', commit: null, via: 'cross-repository', repository}`, exported from `blocker-landing.js` (`'open'` exactly when `state === 'OPEN'`). Under native mode a `buildRecords` record's `blockedBy` is `withoutCrossRepoBlockers(dep.blockedBy, dep.crossRepoBlockers)`, and `crossRepoBlockers` is copied after `fingerprint` only when non-empty. `records[n].blockerLanding` lists this repository's out-of-run results in `blockedBy` order, then one `classifyCrossRepository` result per `crossRepoBlockers` entry, in entry order.

- [ ] **Step 1: Write the failing tests**

`blocker-landing.test.js` (import `classifyCrossRepository`):

```js
test('AC1.1: classifyCrossRepository — reads open from an OPEN native state and undetermined otherwise, with no lookup', () => {
  assert.deepEqual(classifyCrossRepository({ number: 5, repository: 'other/repo', state: 'OPEN' }), { blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' });
  assert.deepEqual(classifyCrossRepository({ number: 5, repository: 'other/repo', state: 'CLOSED' }), { blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository', repository: 'other/repo' });
  assert.deepEqual(classifyCrossRepository({ number: 5, repository: 'other/repo', state: null }), { blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository', repository: 'other/repo' });
});
```

`preflight-records.test.js` — a `buildRecords` unit test, then CLI tests placed after the `closedBlocker` helper (line ~790):

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
const nativeArgs = (...nums) => [...nums, '--blocker-landing', '--work-links', 'native', '--repo', 'acme/w'];
const landingQueries = (calls) => calls.filter((a) => isGraphQL(a) && /CLOSED_EVENT/.test(gqlQuery(a))).map(gqlQuery);
```

Tests, each `assert.equal(run(…, deps), 0)` first:
1. `AC1.1: a CLOSED native blocker in another repository is never queried by number here — undetermined cross-repository; this repository's blocker is still judged` — `{ 11: [[5, 'other/repo', 'CLOSED'], [6, 'acme/w', 'CLOSED']] }`, `repository: { b6: closedBlocker('fff666') }`, `statuses: { fff666: 'behind\n' }`. Assert `blockerLanding` deep-equals `[{ blocker: 6, verdict: 'landed', commit: 'fff666', via: 'closer-pr' }, { blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository', repository: 'other/repo' }]`, `blockedBy` `[6]`, exactly one landing query, matching `/b6: issue\(number:6\)/` and not `/b5: issue/`.
2. `AC1.1: an OPEN native blocker in another repository reads open from its native state — no blocker-landing query and no compare call` — `{ 11: [[5, 'other/repo', 'OPEN']] }`. Assert `blockerLanding` `[{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]`, `landingQueries(calls).length === 0`, `calls.filter(isCompare).length === 0`.
3. `this repository's #5 and another repository's #5 both blocking: the local one is judged, the foreign one is reported apart` — `{ 11: [[5, 'acme/w', 'CLOSED'], [5, 'other/repo', 'OPEN']] }`, `repository: { b5: closedBlocker('eee555') }`, `statuses: { eee555: 'diverged\n' }`. Assert `[{ blocker: 5, verdict: 'unlanded', commit: 'eee555', via: 'closer-pr' }, { blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]`.
4. `a foreign blocker whose number is an in-run record is judged as foreign, not dropped as in-run` — `nativeArgs('10', '11')` with `{ 10: [], 11: [[10, 'other/repo', 'OPEN']] }`. Assert record 11's `blockedBy` `[]` and `blockerLanding` `[{ blocker: 10, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/preflight-records/blocker-landing.test.js tests/bin-lib/preflight-records/preflight-records.test.js`
Expected: FAIL after Step 1 (`classifyCrossRepository is not a function`; `b5: issue(number:5)` queried)

- [ ] **Step 3: Implement**

- `blocker-landing.js`: add `classifyCrossRepository` as `{ ...result(number, verdict, null, 'cross-repository'), repository }`, with a comment that the number names another repository's issue, so it is never queried or probed here, and its verdict comes from the native node's state (#4793, Decisions Q1). Add `cross-repository` to the header's `via` list and say the `open` verdict can also come from it. Export it.
- `preflight-records.js` lib: `buildRecords` sets native `blockedBy` via `withoutCrossRepoBlockers` and appends `crossRepoBlockers` after `fingerprint` only when non-empty; extend the line-114 shape comment, the `buildRecords` comment, and `outOfRunBlockers`'s comment (cross-repository blockers never reach it).
- `plugin/bin/preflight-records.js`: in the `opts.blockerLanding` block, append `(records[String(n)].crossRepoBlockers || []).map(classifyCrossRepository)` after the per-record map. Extend the header's `--blocker-landing` paragraph (lines 30-44) with the cross-repository entries and the record's `crossRepoBlockers` key under native mode.

- [ ] **Step 4: Run tests to verify they pass, and prove AC1.2**

Run: `node --test tests/bin-lib/preflight-records/blocker-landing.test.js tests/bin-lib/preflight-records/preflight-records.test.js tests/flow-blocker-landing-conformance.test.js tests/resolve-blockers-cli.test.js`
Expected: PASS

AC1.2: in a scratch edit, make `crossRepositoryBlockers` in `record-dependencies.js` return `[]`. Run `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-02T205244-record-4793/evidence"`, then `node --test tests/bin-lib/preflight-records/preflight-records.test.js` redirected to `{that dir}/ac1-2-revert.txt`. Expected: tests 1-4 FAIL (`b5`/`b10` join the landing query, which the fixture answers with no alias — a whole-query failure, exit 1). Undo with the Edit tool and confirm `git diff --stat -- plugin/bin/lib/issues/record-dependencies.js` prints nothing. Log one entry with `log-decision.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-02T205244-record-4793" --section "/build" --status AUTO --step "AC evidence" --text-file {file}` citing AC1.2, the command shape, the fail/pass counts, and the evidence path.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/preflight-records/blocker-landing.js plugin/bin/lib/preflight-records/preflight-records.js plugin/bin/preflight-records.js tests/bin-lib/preflight-records/blocker-landing.test.js tests/bin-lib/preflight-records/preflight-records.test.js
git commit -m "Judge a cross-repository native blocker from its native state in blocker landing — never look it up by number, refs #4793"
```

- [ ] **Step 6: Real-input probe**

From the worktree run `node plugin/bin/preflight-records.js 4909 4735 --blocker-landing --work-links native`, redirected to `{evidence dir}/preflight-native-live.txt`. Independent count (Verified command plus `gh issue view 4735 --json number`): #4909 is blocked by #4820, #4735 by #4589, both this repository's — so both appear in `blockedBy`, neither record carries `crossRepoBlockers`, and both `blockerLanding` entries carry no `repository` key. Log one `AC evidence` entry (AC2.1) the same way, naming the path.

### Task 3: Wrap-up's newly-unblocked check skips cross-repository blocker numbers

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js`
- Modify: `plugin/skills/wrap-up/unblocked-records.md` (7,980 B; +~300 B leaves ~44 KB under the 52,500 B rail)
- Test: `tests/bin-lib/wrap-up/pack.test.js`
- Test: `tests/wrap-up-pack-conformance.test.js`

**Interfaces:**
- Consumes: `withoutCrossRepoBlockers` from `../issues/record` (Task 1); `resolve-blockers.js` output entries now carry `crossRepoBlockers` when present (pass-through).

- [ ] **Step 1: Write the failing tests**

`pack.test.js`, beside the `#2425` native tests, two tests driving `gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['unblocked'], deps })` with `okDeps({ execFile })` answering `resolve-blockers.js` (closed record 1535, open dependent 1600 'Dependent'):
- `Q2: a dependent blocked only by another repository's #1535 is not reported unblocked when this repository closes #1535` — stdout `{ 1600: { blockedBy: [1535], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 1535, repository: 'other/repo', state: 'CLOSED' }] } }` → `pack.unblocked.value` deep-equals `[]`.
- `Q2: this repository's #1535 beside another repository's #1535 still reports the dependent unblocked` — `blockedBy: [1535, 1535]`, same single foreign entry → `[{ number: 1600, title: 'Dependent' }]`.

`wrap-up-pack-conformance.test.js`, one test plus its go-red control sharing one assertion function `assertNativeSnippetSkipsCrossRepo(text)`: the `work-links: native` snippet in `unblocked-records.md` requires `bin/lib/issues/record.js`, filters with `withoutCrossRepoBlockers(byNumber[r.number].blockedBy, byNumber[r.number].crossRepoBlockers).includes(closedNum)`, and no longer contains `byNumber[r.number].blockedBy.includes(closedNum)`. The control runs the same function on the text with the `withoutCrossRepoBlockers(` call replaced by `byNumber[r.number].blockedBy` and expects it to throw.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/wrap-up-pack-conformance.test.js`
Expected: FAIL after Step 1 (the foreign-only dependent is reported; the snippet lacks the helper)

- [ ] **Step 3: Implement**

`pack.js`: import `withoutCrossRepoBlockers` beside `parseDependencies`; the native filter becomes `withoutCrossRepoBlockers(e.blockedBy, e.crossRepoBlockers).includes(closed) && !e.openBlocker` (with `e = byNumber[r.number]`), plus a one-line comment citing #4793. `unblocked-records.md`: in the native snippet require `{ withoutCrossRepoBlockers }` from `'${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js'` and use it in the filter; append to the paragraph after the snippet: "A blocker linked from another repository shares only its number with this repository's issues, so `crossRepoBlockers` numbers are removed before the `includes(closedNum)` test (#4793) — closing this repository's #N never reports a record blocked by `other/repo#N` as unblocked."

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/wrap-up-pack-conformance.test.js tests/session-tmp-root-migration.test.js`
Expected: PASS, with every pre-existing `pack.test.js` unblocked test unchanged

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/pack.js plugin/skills/wrap-up/unblocked-records.md tests/bin-lib/wrap-up/pack.test.js tests/wrap-up-pack-conformance.test.js
git commit -m "Skip cross-repository blocker numbers in wrap-up's newly-unblocked check, refs #4793"
```

### Task 4: `dispatch resume` names a foreign open blocker by its repository

**Role:** integration

**Files:**
- Modify: `plugin/bin/dispatch-resume.js`
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js`
- Test: `tests/bin-lib/dispatch/dispatch-resume-cli.test.js`
- Test: `tests/bin-lib/dispatch/resume-eligibility.test.js`

**Interfaces:**
- Consumes: `withoutCrossRepoBlockers` from `./lib/issues/record` (Task 1).
- Produces: `readOpenBlockers` returns this repository's open blocker numbers ascending and deduplicated, followed by one `'{repository}#{number}'` string per OPEN `crossRepoBlockers` entry, in entry order. `resume-eligibility.js`'s `blocked-by` line renders a string entry verbatim and a number as `#N`.

- [ ] **Step 1: Write the failing tests**

`resume-eligibility.test.js`, a row in the line-318 table: `['open blockers with a foreign one', { openBlockers: [4500, 'other/repo#5'] }, 'blocked-by', '#4589 is blocked by open #4500, other/repo#5 — not resumable until they close; then run /claude-tweaks:dispatch resume #4589', 'resume']`.

`dispatch-resume-cli.test.js`, beside line 748:

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/dispatch/resume-eligibility.test.js`
Expected: FAIL after Step 1 (line reads `open #5 —` / `#other/repo#5`)

- [ ] **Step 3: Implement**

`dispatch-resume.js` `readOpenBlockers`: take `foreignOpen = (entry.crossRepoBlockers || []).filter((b) => b && b.state === 'OPEN')`, add `withoutCrossRepoBlockers(entry.openBlockerIds, foreignOpen)` to the number set, and return the sorted numbers followed by `foreignOpen.map((b) => \`${b.repository}#${b.number}\`)`; update its comment (#4793). `resume-eligibility.js` line 322: render each entry as `typeof b === 'string' ? b : \`#${b}\``; extend the line-250 inputs comment to say `openBlockers` may carry `owner/name#N` strings.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/dispatch/resume-eligibility.test.js tests/dispatch-resume-prose.test.js`
Expected: PASS, pre-existing tests unchanged

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/dispatch-resume.js plugin/bin/lib/dispatch/resume-eligibility.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/dispatch/resume-eligibility.test.js
git commit -m "Name a foreign open blocker by its repository in dispatch resume's refusal, refs #4793"
```

### Task 5: Flow verdict prose, journey and shape docs name the cross-repository case

**Role:** integration

**Files:**
- Modify: `plugin/skills/flow/multispec-dependency-ordering.md` (5,289 B; +~450 B, far under the 52,500 B rail)
- Test: `tests/flow-blocker-landing-conformance.test.js`
- Modify: `docs/journeys/stop-a-run-whose-closed-blocker-never-landed-4553.md` (line 40)
- Modify: `plugin/bin/resolve-blockers.js` (header lines 23-27 only)
- Modify: `docs/plugin-structure.md` (lines 64 and 231)

Moved-prose pin check: `tests/flow-blocker-landing-conformance.test.js:92` pins the existing `{text-file}` holder line byte for byte and `holderSentence` reads the first `` `{text-file}` holds one line `` occurrence — the existing sentence stays unchanged, and the new paragraph must not contain that phrase.

- [ ] **Step 1: Write the failing test**

In `flow-blocker-landing-conformance.test.js`, add `assertCrossRepositoryNaming(text)` over `outOfRunSection(text)`, asserting the section contains `` `via: cross-repository` ``, `` `{repository}#{blocker}` ``, and the literal SKIP line `` `condition: {repository}#{blocker} lives in another repository (via cross-repository) → fallback: proceeded without judging its landing — blocker landing reads only this repository's integration branch` ``, and still passes `assertUndeterminedSkip(text)`. Test `cross-repository entries are named {repository}#{blocker} in the stop line and the SKIP text (#4793)` calls it on the real file; its go-red control calls the same function on the text with `{repository}#{blocker}` replaced by `#{blocker}` and expects a throw.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-blocker-landing-conformance.test.js`
Expected: FAIL after Step 1 (the section has no cross-repository paragraph)

- [ ] **Step 3: Write the prose**

- `multispec-dependency-ordering.md`, a paragraph after the `{text-file}` paragraph: "An entry with `via: cross-repository` is a blocker linked natively from another repository; its `repository` key holds `owner/name`, and its number names that repository's issue, so write it as `{repository}#{blocker}` — in the `open` stop line, and, for `undetermined`, as the SKIP line `condition: {repository}#{blocker} lives in another repository (via cross-repository) → fallback: proceeded without judging its landing — blocker landing reads only this repository's integration branch` (#4793)."
- Journey line 40, after the `not-found` sentence: "A native blocker linked from another repository is never looked up by number in this repository: it reads `open` when its native state is OPEN and `undetermined`/`cross-repository` otherwise, named `owner/name#N`."
- `resolve-blockers.js` header and `docs/plugin-structure.md` lines 64 and 231: each shape sentence gains "plus `crossRepoBlockers: [{number, repository, state}]` when a blocker lives in another repository (#4793)".

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/flow-blocker-landing-conformance.test.js tests/resolve-blockers-cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/multispec-dependency-ordering.md tests/flow-blocker-landing-conformance.test.js docs/journeys/stop-a-run-whose-closed-blocker-never-landed-4553.md plugin/bin/resolve-blockers.js docs/plugin-structure.md
git commit -m "Name cross-repository blockers in flow's verdict prose, journey and shape docs, refs #4793"
```

## Spec coverage

| Spec clause | Task |
|---|---|
| Deliverable 1: project `repository { nameWithOwner }`, carry it with the number | Task 1 |
| Deliverable 2 + Decisions Q1: cross-repository verdict in `blocker-landing.js`, pinned in the blocker-landing suite | Task 2 (`classifyCrossRepository`, its unit test) |
| Decisions Q2: `pack.js` + `unblocked-records.md` drop `crossRepoBlockers` numbers, new test | Task 3 |
| Plan-review notes: SKIP text wrong for a foreign blocker; dispatch-resume names a foreign issue `#N` | Task 5; Task 4 |
| AC1.1: a native blocker whose repository differs does not query this repository's issue of the same number | Task 2 CLI tests 1-2 |
| AC1.2: reverting the repository check turns it red | Task 2 Step 4 mutation, logged as AC evidence |
| AC2.1: `buildNativeDependencyQuery`'s dispatch and wrap-up consumer tests pass unchanged | Task 1 Step 4 consumer suites; Task 3/4 Step 4; Task 2 Step 6 probe |
