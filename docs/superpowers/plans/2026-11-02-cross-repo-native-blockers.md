# Cross-Repository Native Blockers Implementation Plan (#4793)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native blocker linked from another repository is carried with its repository and is never looked up by number in this repository; `--blocker-landing` reads it `undetermined` with `via: 'cross-repository'`.

**Architecture:** `buildNativeDependencyQuery` projects `repository{ nameWithOwner }` on each dependent issue and on each blocker node. A pure helper, `crossRepositoryBlockers(issueNode)`, compares the two names case-insensitively. `fetchNativeDependencies` adds a `crossRepoBlockers` key only when one exists, so every same-repository entry keeps its current shape. Pre-flight's `buildRecords` drops those numbers from `blockedBy`, so the out-of-run blocker query and the DAG never see them, and copies `crossRepoBlockers` onto the record. The CLI appends one `classifyCrossRepository` result per foreign blocker to `blockerLanding`.

**Tech Stack:** Node 18+ CommonJS, `gh api graphql`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T071931-record-4793/work/4793-spec.md`

Scope keywords: buildNativeDependencyQuery, crossRepoBlockers, fetchNativeDependencies

## Global Constraints

- The spec fixes the cross-repository verdict: "undetermined with a stated `via`, never a same-number lookup here". The result shape stays exactly `{ blocker, verdict, commit, via }`: `{ blocker: n, verdict: 'undetermined', commit: null, via: 'cross-repository' }`.
- `fetchNativeDependencies`'s `blockedBy`, `openBlocker` and `openBlockerIds` keep their values for every consumer, cross-repository blockers included. A foreign OPEN blocker still blocks dispatch. `crossRepoBlockers` is present only when non-empty. That follows the precedent of preflight's `nativeLinksUnchecked: true` ("a key absent on every other run", `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`). Existing deep-equal pins in `tests/resolve-blockers-cli.test.js:175,193,212` and `tests/bin-lib/preflight-records/preflight-records.test.js:104,105,133` stay unchanged and green.
- Compare against the dependent issue's own `repository.nameWithOwner`, never the caller's `owner/repo`: an `origin` remote left on a pre-transfer name must not read every blocker as foreign. A node with no readable `nameWithOwner`, on either side, is never foreign: a response without the field keeps the old behavior.
- Quoted from `.claude/skills/gh-api-module-pattern/batching-failure-posture.md`: "The alias-query *builder* is a pure function in `plugin/bin/lib/issues/record-dependencies.js` (re-exported through `record.js`), separate from whatever runs it. … `record-dependencies.js` requires nothing at all and shells out nowhere, which is what lets `tests/bin-lib/issues/record.test.js` pin each builder with plain regex assertions and no fake runner at all". Also: "*Throw on a partial result* when partial data is unusable — `plugin/bin/lib/issues/native-dependencies.js`'s `fetchNativeDependencies` throws naming every missing `i{N}` alias (#723)". That throw posture stays unchanged.
- `.claude/skills/merge-shape-landed-proof/SKILL.md` names `blocker-landing.js` as the reusable landed proof. Its compare rules are untouched. A cross-repository blocker never reaches the compare API.
- Hand-written commits use `{Verb} {what} — {detail}` with `refs #4793`, never `closes` or `fixes`. End every commit message with `Claude-Session: https://claude.ai/code/session_01X7gPFDPBeut8Tyt6Zo6aim`. Never `git stash`. Worktree shell: one plain command per Bash call.
- Scope and edit discipline: Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

## Verified command

This was run read-only on 2026-11-02 against `thn-inc/claude-tweaks` (the slug `git remote get-url origin` resolves to) for issues 4909, 4735 and 4793, using the planned per-alias expression `issue(number:N){ number repository{ nameWithOwner } blockedBy(first:25){ nodes{ number state repository{ nameWithOwner } } } }`. It returned `errors: null`. For example, `i4909 → {"number":4909,"repository":{"nameWithOwner":"thn-inc/claude-tweaks"},"blockedBy":{"nodes":[{"number":4820,"state":"OPEN","repository":{"nameWithOwner":"thn-inc/claude-tweaks"}}]}}`. No cross-repository link exists in this repo to probe. Creating one would mutate GitHub state, so the foreign branch is covered by shape only: the field is the same one the same-repository nodes return.

## Review Focus

- The same number appears in both repositories as blockers of one record (this repo's #5 and `other/repo#5`). This repo's #5 must still be judged, and the foreign one reported separately. Task 2 pins it.
- The only blocker is foreign. Then no blocker-landing GraphQL call and no compare call are made. Task 2 pins it.
- A repository name that differs only in case is the same repository. Task 1 pins it.
- A response without `repository` fields (an older fixture or query shape) yields no `crossRepoBlockers`. Task 1 pins it.
- A foreign OPEN blocker reads `undetermined`, per the spec, not `open`. The record's `openBlocker` stays `true`, and dispatch still excludes it through `openBlockerIds`. This is stated, not changed.

---

### Task 1: Project the blocker repository and carry cross-repository blockers

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/record-dependencies.js`
- Modify: `plugin/bin/lib/issues/record.js`
- Modify: `plugin/bin/lib/issues/native-dependencies.js`
- Modify: `plugin/bin/resolve-blockers.js` (header comment only)
- Modify: `docs/plugin-structure.md` (lines 64 and 229)
- Test: `tests/bin-lib/issues/record.test.js`
- Test: `tests/bin-lib/issues/native-dependencies.test.js`
- Read only (Check B's scope-keyword hits, added by `scope-creep: add-to-plan`; Step 4b confirms each is no-change): `plugin/bin/dispatch-resume.js`, `plugin/bin/lib/compose-subject.js`, `plugin/bin/lib/issues/capabilities-probe.js`, `plugin/bin/lib/issues/linked-prs.js`, `plugin/bin/lib/number-list-cli.js`, `plugin/skills/backlog/overview-mode.md`, `plugin/skills/backlog/refine-mode.md`, `plugin/skills/dispatch/mcp-transport.md`, `plugin/skills/dispatch/queue-pull-notes.md`, `plugin/skills/flow/materialize.md`, `plugin/skills/wrap-up/unblocked-records.md`, `tests/bin-lib/dispatch/dispatch-resume-cli.test.js`, `tests/resolve-blockers-cli.test.js`. The three `docs/superpowers/plans/2026-10-*` hits are history and stay.

**Interfaces:**
- Produces: `crossRepositoryBlockers(issueNode) -> Array<{number: number, repository: string}>`, exported from `record-dependencies.js` and re-exported by `record.js`. A `fetchNativeDependencies` Map entry gains `crossRepoBlockers: Array<{number, repository}>` only when that array is non-empty.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/issues/record.test.js`, import `crossRepositoryBlockers` and replace the line-645 regex with:

```js
  assert.match(q, /i39: issue\(number:39\)\{ number repository\{ nameWithOwner \} blockedBy\(first:25\)\{ nodes\{ number state repository\{ nameWithOwner \} \} \} \}/);
```

Add:

```js
const depNode = (home, blockers) => ({ number: 1, repository: home === null ? undefined : { nameWithOwner: home }, blockedBy: { nodes: blockers } });
const blk = (number, repo) => ({ number, state: 'CLOSED', ...(repo === undefined ? {} : { repository: { nameWithOwner: repo } }) });

test('crossRepositoryBlockers lists each blocker whose repository differs from the dependent issue\'s', () => {
  assert.deepStrictEqual(crossRepositoryBlockers(depNode('acme/w', [blk(5, 'other/repo'), blk(6, 'acme/w')])), [{ number: 5, repository: 'other/repo' }]);
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
  assert.deepStrictEqual(crossRepositoryBlockers(depNode('acme/w', [blk(5, 'acme/w'), blk(5, 'other/repo')])), [{ number: 5, repository: 'other/repo' }]);
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
  const out = fetchNativeDependencies({ numbers: [11], owner: 'acme', repo: 'w', runner });
  assert.deepStrictEqual(out.get(11), {
    blockedBy: [5, 6], openBlocker: true, openBlockerIds: [5],
    crossRepoBlockers: [{ number: 5, repository: 'other/repo' }],
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
Expected: FAIL after Step 1 (`crossRepositoryBlockers is not a function`; the projection regex does not match)

- [ ] **Step 3: Implement**

In `record-dependencies.js`, change `buildNativeDependencyQuery`'s expression to the Verified command's. Update its comment: each alias also selects the dependent issue's and each blocker's `repository{ nameWithOwner }` (#4793). Add `crossRepositoryBlockers(issueNode)` beside `hasOpenNativeBlocker`, with a comment covering the case-insensitive compare, the dependent issue's own canonical name, and why an unreadable name is never foreign. A name is readable only when it is a non-empty string. Export it from `record-dependencies.js` and from `record.js`'s require list and `module.exports`. In `native-dependencies.js`, require it and set `entry.crossRepoBlockers` only when the array is non-empty. Extend the header's shape sentence and the function comment to say so.

Update the header of `resolve-blockers.js` (lines 23-27) and `docs/plugin-structure.md` (the `native-dependencies.js` line 64 and the `resolve-blockers.js` line 229). Each shape sentence becomes `{blockedBy: number[], openBlocker: boolean, openBlockerIds: number[]}`, plus `crossRepoBlockers: [{number, repository}]` when a blocker lives in another repository (#4793).

- [ ] **Step 4: Run tests to verify they pass, consumers unchanged**

Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/native-dependencies.test.js tests/resolve-blockers-cli.test.js tests/bin-lib/preflight-records/preflight-records.test.js tests/backlog-grant-gate-cli.test.js tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/wrap-up/pack.test.js tests/gh-host-seam-behavior.test.js`
Expected: PASS. AC2.1: the consumer suites pass with no edit to them.

- [ ] **Step 4b: Confirm the Read-only consumers need no change**

For each Read-only file, read every line that matches `-e buildNativeDependencyQuery -e openBlockerIds -e fetchNativeDependencies -e crossRepoBlockers`. Confirm it either reads `number`/`state`/`blockedBy`/`openBlockerIds` only, which stay unchanged, or describes the query without stating its node projection. At authoring time, the skill prose builds `blockedBy` from `nodes.filter(open).map(number)`. `capabilities-probe.js` probes for the `blockedBy` field, and `Issue.repository` is always present. `dispatch-resume.js` reads `openBlockerIds`. If a line states the entry shape or the projection verbatim, edit it to the Step 3 wording and add it to this task's commit. List each file with its verdict (`no change` or `edited`) in the task report.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-dependencies.js plugin/bin/lib/issues/record.js plugin/bin/lib/issues/native-dependencies.js plugin/bin/resolve-blockers.js docs/plugin-structure.md tests/bin-lib/issues/record.test.js tests/bin-lib/issues/native-dependencies.test.js
git commit -m "Project native blockers' repository — carry cross-repository blockers beside the number, refs #4793"
```

### Task 2: Blocker landing reads a cross-repository blocker undetermined, never by number

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/preflight-records/blocker-landing.js`
- Modify: `plugin/bin/lib/preflight-records/preflight-records.js`
- Modify: `plugin/bin/preflight-records.js`
- Modify: `docs/journeys/stop-a-run-whose-closed-blocker-never-landed-4553.md`
- Test: `tests/bin-lib/preflight-records/blocker-landing.test.js`
- Test: `tests/bin-lib/preflight-records/preflight-records.test.js`

**Interfaces:**
- Consumes: `crossRepoBlockers` on a `fetchNativeDependencies` entry (Task 1).
- Produces: `classifyCrossRepository(blocker: number) -> {blocker, verdict: 'undetermined', commit: null, via: 'cross-repository'}`, exported from `blocker-landing.js`. On a `buildRecords` record under native mode, `blockedBy` lists this repository's blockers only. `crossRepoBlockers` is copied when non-empty, and only then. The CLI's `records[n].blockerLanding` is this repository's out-of-run results in `blockedBy` order, then one `classifyCrossRepository` result per `crossRepoBlockers` entry, in that entry's order.

- [ ] **Step 1: Write the failing tests**

`blocker-landing.test.js`, import `classifyCrossRepository`:

```js
test('AC1.1: classifyCrossRepository — a blocker in another repository is undetermined via cross-repository, never classified by a lookup', () => {
  assert.deepEqual(classifyCrossRepository(5), { blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository' });
});
```

`preflight-records.test.js`:

```js
test('buildRecords: native mode — a cross-repository blocker leaves blockedBy and rides on crossRepoBlockers', () => {
  const issues = new Map([[11, issue({ number: 11, title: 'E' })], [12, issue({ number: 12, title: 'T' })]]);
  const dependencies = new Map([
    [11, { blockedBy: [5, 6, 5], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 5, repository: 'other/repo' }] }],
    [12, { blockedBy: [6], openBlocker: false, openBlockerIds: [] }],
  ]);
  const records = buildRecords({ issues, dependencies });
  assert.deepEqual(records['11'].blockedBy, [6, 5]);
  assert.deepEqual(records['11'].crossRepoBlockers, [{ number: 5, repository: 'other/repo' }]);
  assert.equal('crossRepoBlockers' in records['12'], false);
});

// Native-mode landing fixture: record 11's native blockers are given as [number, repo, state].
function nativeLandingFixture(blockers, { repository = {}, statuses = {} } = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isIssueView(args, 11)) return JSON.stringify(issue({ number: 11, title: 'Eleven', body: specBody(['b.js']) }));
    if (isGraphQL(args) && /CLOSED_EVENT/.test(gqlQuery(args))) return JSON.stringify({ data: { repository } });
    if (isGraphQL(args)) {
      return JSON.stringify({ data: { repository: { i11: { number: 11, repository: { nameWithOwner: 'acme/w' }, blockedBy: { nodes: blockers.map(([number, repo, state]) => ({ number, state, repository: { nameWithOwner: repo } })) } } } } });
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
const NATIVE = ['11', '--blocker-landing', '--work-links', 'native', '--repo', 'acme/w'];

test('AC1.1: a native blocker in another repository is never queried by number here — undetermined cross-repository; this repository\'s blocker is still judged', () => {
  const { runner, calls } = nativeLandingFixture([[5, 'other/repo', 'CLOSED'], [6, 'acme/w', 'CLOSED']], {
    repository: { b6: closedBlocker('fff666') }, statuses: { fff666: 'behind\n' },
  });
  const { deps, out } = cliDeps({ runner });
  assert.equal(run(NATIVE, deps), 0);
  const rec = JSON.parse(out.join('')).records['11'];
  assert.deepEqual(rec.blockerLanding, [
    { blocker: 6, verdict: 'landed', commit: 'fff666', via: 'closer-pr' },
    { blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository' },
  ]);
  assert.deepEqual(rec.blockedBy, [6]);
  assert.deepEqual(rec.crossRepoBlockers, [{ number: 5, repository: 'other/repo' }]);
  const landing = calls.filter((a) => isGraphQL(a) && /CLOSED_EVENT/.test(gqlQuery(a))).map(gqlQuery);
  assert.equal(landing.length, 1);
  assert.match(landing[0], /b6: issue\(number:6\)/);
  assert.doesNotMatch(landing[0], /b5: issue/);
});

test('AC1.1: a record whose only native blocker is in another repository makes no blocker-landing query and no compare call', () => {
  const { runner, calls } = nativeLandingFixture([[5, 'other/repo', 'CLOSED']]);
  const { deps, out } = cliDeps({ runner });
  assert.equal(run(NATIVE, deps), 0);
  assert.deepEqual(JSON.parse(out.join('')).records['11'].blockerLanding,
    [{ blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository' }]);
  assert.equal(calls.filter((a) => isGraphQL(a) && /CLOSED_EVENT/.test(gqlQuery(a))).length, 0);
  assert.equal(calls.filter(isCompare).length, 0);
});

test('this repository\'s #5 and another repository\'s #5 both blocking: the local one is judged, the foreign one is reported apart', () => {
  const { runner } = nativeLandingFixture([[5, 'acme/w', 'CLOSED'], [5, 'other/repo', 'OPEN']], {
    repository: { b5: closedBlocker('eee555') }, statuses: { eee555: 'diverged\n' },
  });
  const { deps, out } = cliDeps({ runner });
  assert.equal(run(NATIVE, deps), 0);
  assert.deepEqual(JSON.parse(out.join('')).records['11'].blockerLanding, [
    { blocker: 5, verdict: 'unlanded', commit: 'eee555', via: 'closer-pr' },
    { blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository' },
  ]);
});
```

`isCompare`, `gqlQuery` and `closedBlocker` are declared at lines 787-796. Put the fixture and tests after them.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/preflight-records/blocker-landing.test.js tests/bin-lib/preflight-records/preflight-records.test.js`
Expected: FAIL after Step 1 (`classifyCrossRepository is not a function`; `b5: issue(number:5)` queried)

- [ ] **Step 3: Implement**

- `blocker-landing.js`: add `classifyCrossRepository(blocker)` through the existing `result()` helper, with a comment saying that a cross-repository blocker's number names another repository's issue, so it is never queried or probed here (#4793). Add `cross-repository` to the header's `via` list. Export it.
- `preflight-records.js` lib: `buildRecords` takes `blockedBy` under native as `dep.blockedBy` with one occurrence removed per `dep.crossRepoBlockers` entry's number, preserving the remaining order. It appends `crossRepoBlockers` after `fingerprint` only when that array is non-empty. Update the function comment, and the `outOfRunBlockers` comment to note that cross-repository blockers never reach it.
- `plugin/bin/preflight-records.js`: in the `opts.blockerLanding` block, append `(records[String(n)].crossRepoBlockers || []).map((b) => classifyCrossRepository(b.number))` after the existing per-record map. Extend the header's `--blocker-landing` paragraph (lines 30-37) to say so, and add the record's `crossRepoBlockers` key under native mode.
- Journey `stop-a-run-whose-closed-blocker-never-landed-4553.md`, line 40's "Should understand", after the `not-found` sentence: "A native blocker linked from another repository reads `undetermined`/`cross-repository` and is never looked up by number in this repository."

- [ ] **Step 4: Run tests to verify they pass, and prove AC1.2**

Run: `node --test tests/bin-lib/preflight-records/blocker-landing.test.js tests/bin-lib/preflight-records/preflight-records.test.js tests/flow-blocker-landing-conformance.test.js tests/resolve-blockers-cli.test.js`
Expected: PASS

AC1.2: revert the repository check by making `crossRepositoryBlockers` in `record-dependencies.js` return `[]` in a scratch edit. Run `node --test tests/bin-lib/preflight-records/preflight-records.test.js`. Expected: both `AC1.1` CLI tests FAIL. `b5` now joins the landing query, and the fixture answers it with no alias, which is a whole-query failure, so the run exits 1. Undo the scratch edit with the Edit tool, then confirm `git diff --stat -- plugin/bin/lib/issues/record-dependencies.js` prints nothing. Record both runs' fail/pass counts in the task report.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/preflight-records/blocker-landing.js plugin/bin/lib/preflight-records/preflight-records.js plugin/bin/preflight-records.js docs/journeys/stop-a-run-whose-closed-blocker-never-landed-4553.md tests/bin-lib/preflight-records/blocker-landing.test.js tests/bin-lib/preflight-records/preflight-records.test.js
git commit -m "Read a cross-repository native blocker undetermined in blocker landing — never look it up by number, refs #4793"
```

- [ ] **Step 6: Real-input probe, and record it**

Run `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-02T071931-record-4793/evidence"`. Then, from the worktree, run `node plugin/bin/preflight-records.js 4909 4735 --blocker-landing --work-links native`, redirected to `{that dir}/preflight-native-live.txt`. Independent count, from the Verified command: #4909 is blocked by #4820 and #4735 by #4589. Both are this repository's, so both must appear in `blockedBy`, neither record carries `crossRepoBlockers`, and both `blockerLanding` entries are `open` with via `state`. Log one `AC evidence` entry with `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file`, citing AC2.1, the probe's command shape and that path.

## Spec coverage

| Spec clause | Task |
|---|---|
| Deliverable 1: project `repository { nameWithOwner }`, carry it with the number | Task 1 |
| Deliverable 2: decide the cross-repository verdict in `blocker-landing.js`, pin it in the blocker-landing suite | Task 2 (`classifyCrossRepository`, its unit test) |
| AC1.1: a native blocker whose repository differs does not query this repository's issue of the same number | Task 2, both `AC1.1` CLI tests |
| AC1.2: reverting the repository check turns it red | Task 2 Step 4 mutation |
| AC2.1: `buildNativeDependencyQuery`'s dispatch and wrap-up consumer tests pass unchanged | Task 1 Step 4 consumer suites; Task 2 Step 6 probe |
