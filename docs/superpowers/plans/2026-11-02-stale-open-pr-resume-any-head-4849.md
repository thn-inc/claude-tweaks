# Stale-Open-PR Resume on Any Head Implementation Plan (#4849)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A granted record whose open closing PR sits on any head can be resumed or closed, and every surface that sees it names a remedy the next command accepts.

**Architecture:** `dispatch-resume.js` reads the record's open PR through the issue's `closedByPullRequestsReferences` connection and derives the worktree path from the PR's head. The pure verdict gains a multi-record refusal and a `disposition` the other surfaces reuse. A new `stuck-open-prs.js` runs that verdict for attention mode, and tidy's stale-claim Release states the same disposition.

**Tech Stack:** Node 18+ CommonJS, `gh api graphql`, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T232639-record-4849/work/4849-spec.md`

Scope keywords: dispatch-resume, selectResumePr, worktree-dispatch-record

## Global Constraints

- The PR is found through `closedByPullRequestsReferences`, so any head name resolves; every existing refusal keeps applying to the PR found.
- A PR closing more than one record refuses rather than resuming one member.
- The `no-pr` line appears only when no open linked PR exists.
- The marker slug check stays: `runId.slice(RUN_ID_PREFIX_LENGTH) === 'record-{N}'`. All six observed PRs (#4444, #4445, #4476, #4641, #4605, #4586) carry `record-{N}` markers, probed 2026-11-02.
- `plugin/bin` code: `process.exitCode`, never `process.exit`; `windowsHide: true` on spawns; path checks through `lib/path-guard` (`lstatType`), never `fs.existsSync`. Read `.claude/skills/gh-api-module-pattern/SKILL.md` and its `cli-wrapper-contract.md` before writing the new CLI. Prose tests follow `.claude/skills/skill-prose-conformance-tests/SKILL.md`: every presence pin has a go-red control running the same assertion on mutated text.
- `plugin/skills/tidy/scan-procedures.md` is 52,416 B against the 52,500 B rail: its one edit in Task 4 adds at most 48 B.
- Hand-written commit style `{Verb} {what} — {detail}`, with `refs #4849`, never `closes`.
- Scope and edit discipline: Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

## Verified command

Run once against the live repo (`-F query=@file`, owner `thn-inc`, repo `claude-tweaks`, issue 3942), the shape Task 2 pins; it returned PR #4444 on `worktree-record-3942`, `state: OPEN`, `isCrossRepository: false`, `closingIssuesReferences.totalCount: 1`, `hasNextPage: false`. An unknown issue number exits non-zero with `NOT_FOUND`, which `read()` maps to exit 4.

```graphql
query($owner:String!,$repo:String!,$issue:Int!){repository(owner:$owner,name:$repo){issue(number:$issue){closedByPullRequestsReferences(first:100){pageInfo{hasNextPage} nodes{url number state headRefName headRefOid isDraft isCrossRepository repository{nameWithOwner} closingIssuesReferences(first:1){totalCount} body}}}}}
```

## Review Focus

- A PR whose head holds shell metacharacters (`a$(x)`) or a leading `-` reaches resume.md's `git worktree add`: it must refuse `foreign-pr`, never produce a path or command. Task 1 pins it.
- A merged PR, or a PR in another repository, in the connection beside no open one: reads `no-pr`, not a resume target. Task 2 pins it.
- A connection past 100 entries (`hasNextPage: true`): exit 4, never a clean `no-pr`. Task 2 pins it.
- `--bound-run` with a non-`dispatch-record-` worktree: the scan compares the bound run's own stamped worktree, and a bound run with no stamp fails closed. Task 2 pins it.
- A stuck-PR verdict that could not be read (exit 2 or 4) stays visible as a row, never silently absent. Task 3 pins it.

---

### Task 1: The verdict finds any head, refuses bundles, and names a disposition

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js`
- Test: `tests/bin-lib/dispatch/resume-eligibility.test.js`

**Interfaces:**
- Produces: `worktreeNameForHead(head: string) -> string | null`; `prDisposition(reason: string) -> 'resume' | 'close'`; `selectResumePr(issue, prs)` reading `pr.closingRecords: number`; refusal reason `multi-record-pr` in `REFUSAL_REASONS` (length 25).

- [ ] **Step 1: Write the failing tests**

Add `closingRecords: 1` to the file's `prEntry` factory, then add:

```js
test('AC1.1: selectResumePr accepts an open closing PR on a non-dispatch head', () => {
  const pr = prEntry({ headRefName: 'worktree-record-4589' });
  const r = selectResumePr(N, [pr]);
  assert.equal(r.ok, true);
  assert.equal(r.pr.headRefName, 'worktree-record-4589');
  assert.equal(r.runId, RUN);
});
test('AC2.1: no-pr line names no head and offers the plain dispatch', () => {
  const r = selectResumePr(N, []);
  assert.equal(r.reason, 'no-pr');
  assert.equal(r.line, `#${N} has no open PR that closes it — nothing to resume; run /claude-tweaks:dispatch #${N}`);
});
test('a PR closing more than one record refuses multi-record-pr naming the count and a close remedy', () => {
  const r = selectResumePr(N, [prEntry({ closingRecords: 3 })]);
  assert.equal(r.reason, 'multi-record-pr');
  assert.equal(r.line, `#${N}'s PR #${PR} closes 3 records — dispatch resume restarts one record's build, never a bundle; merge or close PR #${PR} by hand, then run /claude-tweaks:dispatch #${N}`);
});
test('a missing closingRecords is invalid-input, never read as one record', () => {
  const pr = prEntry();
  delete pr.closingRecords;
  assert.equal(selectResumePr(N, [pr]).reason, 'invalid-input');
});
test('a head outside the worktree-name character set refuses foreign-pr', () => {
  for (const head of ['a$(touch x)', '-rf', 'worktree-', 'a b']) {
    assert.equal(selectResumePr(N, [prEntry({ headRefName: head })]).reason, 'foreign-pr', head);
  }
});
test('a marker naming another record still refuses foreign-pr on any head', () => {
  const other = '2026-10-30T101632-record-999';
  const r = selectResumePr(N, [prEntry({ headRefName: 'worktree-record-4589', body: `claude-tweaks-run: ${other}\n` })]);
  assert.equal(r.reason, 'foreign-pr');
});
test('worktreeNameForHead strips the worktree- prefix and passes a plain head through', () => {
  assert.equal(worktreeNameForHead('worktree-record-3942'), 'record-3942');
  assert.equal(worktreeNameForHead('worktree-dispatch-record-3977'), 'dispatch-record-3977');
  assert.equal(worktreeNameForHead('fix/thing'), 'fix/thing');
  assert.equal(worktreeNameForHead('a$(x)'), null);
  assert.equal(worktreeNameForHead('-rf'), null);
  assert.equal(worktreeNameForHead('worktree-'), null);
});
test('prDisposition: close only where resume can never accept the PR', () => {
  for (const r of ['foreign-pr', 'claim-not-resumable', 'multi-record-pr']) assert.equal(prDisposition(r), 'close', r);
  for (const r of ['dirty-worktree', 'multiple-prs', 'run-mismatch', 'branch-diverged']) assert.equal(prDisposition(r), 'resume', r);
});
```

Update the existing fixtures that assumed the fixed head: the `foreign` case near line 239 and the refusal table near line 278 (its `no-pr` lines), and `assert.equal(REFUSAL_REASONS.length, 24)` to 25.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/resume-eligibility.test.js`
Expected: FAIL after Step 1 (`worktreeNameForHead` is not a function)

- [ ] **Step 3: Implement in `plugin/bin/lib/dispatch/resume-eligibility.js`**

`selectResumePr` order: drop forks; empty -> `no-pr` with the line above; more than one -> `multiple-prs` with `#${issue} has ${k} open PRs that close it (${numbers} in ascending number order) — not resumable until only one remains; close the extra PR, then run /claude-tweaks:dispatch resume #${issue}`; `closingRecords` not a positive integer -> `invalidInput(issue, 'PR closing-record count', v)` converted to a `noPick`; `closingRecords > 1` -> `multi-record-pr`; `worktreeNameForHead(pr.headRefName) === null`, a null `runId`, or a slug mismatch -> `foreign-pr` with `openPrLine`.

`worktreeNameForHead`: strip one leading `worktree-`; return null when the remainder is empty, does not start with `[A-Za-z0-9]`, or `sanitizeWorktreeName(rest) !== rest` (`../worktree/name.js`). `prDisposition`: `close` for the frozen set `foreign-pr`, `claim-not-resumable`, `multi-record-pr`; `resume` otherwise. Export both, and add `multi-record-pr` to `REFUSAL_REASONS`. Update the header comment's refusal numbering.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/resume-eligibility.test.js`
Expected: PASS, with the "every reason is produced" test (near line 367) covering `multi-record-pr`

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/resume-eligibility.js tests/bin-lib/dispatch/resume-eligibility.test.js
git commit -m "Select the resume PR on any head — refuse bundles, name a disposition, refs #4849"
```

### Task 2: The gatherer reads the closing connection and derives the worktree from the PR

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/dispatch-resume.js`
- Test: `tests/bin-lib/dispatch/dispatch-resume-cli.test.js`
- Read only: `plugin/bin/stale-claim-pr.js`, to confirm its `record-{n}` rule still matches `selectResumePr`'s kept slug check; no change.

**Interfaces:**
- Consumes: `selectResumePr`, `worktreeNameForHead`, `prDisposition` from Task 1.
- Produces: refused stdout gains `prNumbers: number[]` and `disposition: 'resume' | 'close' | null` whenever `--issue` verdict mode refuses (`[]`/`null` for `no-pr`). Eligible stdout is unchanged, with `worktreePath` derived from the head. `module.exports` keeps `run` and `realDeps`.

- [ ] **Step 1: Write the failing tests**

In the fake `gh`, replace the `pr list` branch with `args[0] === 'api' && args[1] === 'graphql'`, returning `{data:{repository:{issue:{closedByPullRequestsReferences:{pageInfo:{hasNextPage:cfg.prMore===true},nodes:cfg.prs.map(toNode)}}}}}`, where `toNode` adds `state: 'OPEN'`, `repository:{nameWithOwner:SLUG}` and `closingIssuesReferences:{totalCount:p.closingRecords ?? 1}` unless the entry sets them. `cfg.prs` as a string returns that string; `cfg.prListThrows` still throws. Replace the argv pin at line 203 with the query pin below, and extend the exact-JSON refusal assertions (`git grep -n "deepStrictEqual(r.json" tests/bin-lib/dispatch/dispatch-resume-cli.test.js`) with `prNumbers` and `disposition`.

```js
const altHead = { headRefName: 'worktree-record-4589' };
const ALT_WT = path.join(MAIN, '.claude', 'worktrees', 'record-4589');
test('AC1.1: an open closing PR on a non-dispatch head resolves, with the worktree derived from that head', () => {
  const env = makeEnv();
  env.cfg.prs = [prEntry(altHead)];
  env.cfg.status = `## ${altHead.headRefName}...origin/${altHead.headRefName}\0`;
  env.cfg.dirs[ALT_WT] = ['x'];
  const r = exec(env);
  assert.equal(r.code, 0);
  assert.equal(r.json.prNumber, PR);
  assert.equal(r.json.headRefName, altHead.headRefName);
  assert.equal(r.json.worktreePath, ALT_WT);
});
test('the PR read is one GraphQL call over the closing connection, never a head or mention listing', () => {
  const env = makeEnv();
  exec(env);
  assert.equal(env.calls.gh.some((a) => a[0] === 'pr'), false);
  const call = env.calls.gh.find((a) => a[0] === 'api' && a[1] === 'graphql');
  const q = call.find((a) => a.startsWith('query='));
  assert.match(q, /closedByPullRequestsReferences\(first:100\)/);
  assert.doesNotMatch(q, /timelineItems|CROSS_REFERENCED/);
  assert.ok(call.includes('owner=o') && call.includes('repo=r') && call.includes(`issue=${N}`));
});
test('AC2.1: no open closing PR returns no-pr, and a mention-only PR never reaches the connection', () => {
  const env = makeEnv();
  env.cfg.prs = [];
  env.cfg.mentionOnly = [prEntry()]; // a PR that says "see #N": GitHub lists it on the timeline, not this connection
  const r = exec(env);
  assert.equal(r.code, 3);
  assert.deepStrictEqual(r.json, {
    eligible: false, issue: N, reason: 'no-pr',
    line: `#${N} has no open PR that closes it — nothing to resume; run /claude-tweaks:dispatch #${N}`,
    prNumbers: [], disposition: null,
  });
});
test('merged, closed and other-repository PRs in the connection read as no-pr', () => {
  for (const over of [{ state: 'MERGED' }, { state: 'CLOSED' }, { repository: { nameWithOwner: 'x/y' } }]) {
    const env = makeEnv();
    env.cfg.prs = [prEntry(over)];
    assert.equal(exec(env).json.reason, 'no-pr', JSON.stringify(over));
  }
});
test('a truncated connection is a failed read, exit 4, never no-pr', () => {
  const env = makeEnv();
  env.cfg.prMore = true;
  assert.equal(exec(env).code, 4);
});
test('every refusal carries the PR numbers and a disposition', () => {
  const env = makeEnv();
  env.cfg.prs = [prEntry({ closingRecords: 2 })];
  const r = exec(env);
  assert.equal(r.json.reason, 'multi-record-pr');
  assert.deepStrictEqual(r.json.prNumbers, [PR]);
  assert.equal(r.json.disposition, 'close');
});
test('--bound-run scans against the bound run\'s own stamped worktree, on any head', () => {
  const env = makeEnv();
  const rival = path.join(ROOT, '2026-10-31T110000-record-4589');
  env.cfg.runDirs = [
    { dir: NEW_RUN, state: { status: 'active', sessionId: SESSION, worktree: ALT_WT } },
    { dir: rival, state: { status: 'active', sessionId: 'other', worktree: ALT_WT, owner: { sessionId: 'other', host: 'h1', pid: 7, pidStartedAt: 'T0' } } },
  ];
  const r = exec(env, BOUND);
  assert.equal(r.code, 3);
  assert.equal(r.json.reason, 'concurrent-resume');
});
test('--bound-run with no worktree stamped on the bound run fails closed, exit 4', () => {
  const env = makeEnv();
  env.cfg.runDirs = [{ dir: NEW_RUN, state: { status: 'active', sessionId: SESSION } }];
  assert.equal(exec(env, BOUND).code, 4);
});
```

Add `{ dir: NEW_RUN, state: { status: 'active', sessionId: SESSION, worktree: WT } }` to the `--bound-run` tests whose `runDirs` omit it. Use the file's existing live-owner helper for the rival's owner block if the literal above does not probe as live.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js`
Expected: FAIL after Step 1 (`gh pr list` still called; the worktree path still `dispatch-record-4589`)

- [ ] **Step 3: Implement in `plugin/bin/dispatch-resume.js`**

- `listPrs(ctx)` runs `['api','graphql','-f',`query=${RESUME_PR_QUERY}`,'-f',`owner=${owner}`,'-f',`repo=${repo}`,'-F',`issue=${issue}`]`, owner and repo being `ctx.slug.split('/').slice(-2)` as `readOpenBlockers` does. `RESUME_PR_QUERY` is the Verified command's text. A missing `data.repository.issue`, a non-array `nodes` or `hasNextPage: true` throws `Exit(4)`. Keep nodes with `state === 'OPEN'` and `repository.nameWithOwner` equal, case-insensitively, to `owner/repo`; map each to `{url, number, headRefName, headRefOid, body, isDraft, isCrossRepository, closingRecords: closingIssuesReferences.totalCount}`.
- Delete `PR_FIELDS` and `ctx.head`. In `run()` drop `worktreePath` from `ctx`. `runVerdict` sets `ctx.worktreePath = path.join(ctx.mainRoot, '.claude', 'worktrees', ...worktreeNameForHead(pr.headRefName).split('/'))` after `selectResumePr` passes.
- Every verdict-mode refusal emits through one `refusal(ctx, prs, reason, line)` adding `prNumbers` (non-fork PRs, ascending) and `disposition` (`null` when `prNumbers` is empty, else `prDisposition(reason)`).
- `runBound` lists run dirs once, finds the entry whose `normalizePath(dir)` equals the bound dir, and sets `ctx.worktreePath` from its `state.worktree`, after the sibling check and before `boundRunConflict`; no such entry or no non-empty string throws `Exit(4, ...)` naming the bound run. Update the header comment: Usage, order, and "PR list" in the exit-4 list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/stale-claim-pr-cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/dispatch-resume.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js
git commit -m "Read the resume PR from the closing connection — derive the worktree from its head, refs #4849"
```

- [ ] **Step 6: Real-input probe, and record it**

Run from the worktree, read-only: `node plugin/bin/dispatch-resume.js --issue 3942`, then `--issue 4347` and `--issue 4849`. Reconcile each with `gh issue view {n} --json closedByPullRequestsReferences`: #3942 must not read `no-pr` (independent count: PR #4444 from the Verified command). Write the output to `{run-dir}/evidence/dispatch-resume-live.txt` (`mkdir -p` first) and log one `AC evidence` `decisions.md` entry citing AC1.1, the three verdicts and that path, per `plugin/skills/build/plan-authoring-checks.md`'s AC-evidence persistence check, using `log-decision.js --text-file`.

### Task 3: `stuck-open-prs.js` and the attention row

**Role:** integration

**Files:**
- Create: `plugin/bin/stuck-open-prs.js`
- Create: `plugin/bin/lib/dispatch/stuck-open-pr.js`
- Modify: `plugin/skills/backlog/attention-mode.md`
- Modify: `docs/plugin-structure.md`
- Test: `tests/bin-lib/dispatch/stuck-open-pr.test.js`
- Test: `tests/backlog-attention-rows.test.js`

**Interfaces:**
- Consumes: `dispatch-resume.js` `run`, `realDeps`; its stdout from Task 2; `fetchLinkedPRs` (`lib/issues/linked-prs.js`).
- Produces: `stuckCandidates(records) -> number[]` (open, `auto:build`, no `bot:*` label); `stuckRow({number, pr, code, verdict}) -> {number, pr, remedy} | null`. CLI `stuck-open-prs.js --records <path>` prints one JSON line `{rows:[{number,pr,remedy}]}`, exit 0; exit 2 malformed, repo unresolved or `gh` absent; exit 4 linked-PR read failed.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/dispatch/stuck-open-pr.test.js`:

```js
const label = (...names) => names.map((name) => ({ name }));
test('stuckCandidates keeps only open, granted records with no bot:* label', () => {
  const rs = [
    { number: 1, state: 'OPEN', labels: label('auto:build') },
    { number: 2, labels: label('auto:build', 'ready') },
    { number: 3, state: 'OPEN', labels: label('ready') },
    { number: 4, state: 'OPEN', labels: label('auto:build', 'bot:in-progress') },
    { number: 5, state: 'CLOSED', labels: label('auto:build') },
  ];
  assert.deepStrictEqual(stuckCandidates(rs), [1, 2]);
});
test('AC3.1: an eligible verdict renders the resume remedy', () => {
  assert.deepStrictEqual(stuckRow({ number: 7, pr: 70, code: 0, verdict: { eligible: true } }),
    { number: 7, pr: 70, remedy: 'run /claude-tweaks:dispatch resume #7 — restarts its stalled PR #70' });
});
test('AC3.1: a live run or a live claim renders no row', () => {
  for (const reason of ['live-claim', 'live-sibling', 'prior-run-live', 'concurrent-resume']) {
    assert.equal(stuckRow({ number: 7, pr: 70, code: 3, verdict: { reason, line: 'x', disposition: 'resume' } }), null, reason);
  }
});
test('no-pr renders no row: the PR closed between the two reads', () => {
  assert.equal(stuckRow({ number: 7, pr: 70, code: 3, verdict: { reason: 'no-pr', line: 'x', disposition: null } }), null);
});
test('a close disposition renders the close-and-redispatch steps', () => {
  assert.equal(stuckRow({ number: 7, pr: 70, code: 3, verdict: { reason: 'foreign-pr', line: 'x', disposition: 'close' } }).remedy,
    'close PR #70 (gh pr close 70), remove any worktree still holding its branch, then run /claude-tweaks:dispatch #7');
});
test('a resume disposition renders the verdict line, whose fix ends in resume', () => {
  const line = '#7 stalled worktree is dirty — commit, then run /claude-tweaks:dispatch resume #7';
  assert.equal(stuckRow({ number: 7, pr: 70, code: 3, verdict: { reason: 'dirty-worktree', line, disposition: 'resume' } }).remedy, line);
});
test('an unreadable verdict stays visible, never silently absent', () => {
  for (const code of [2, 4]) {
    assert.match(stuckRow({ number: 7, pr: 70, code, verdict: null }).remedy, /could not read #7's state \(dispatch-resume exit \d\) — run \/claude-tweaks:dispatch resume #7 to see why/);
  }
});
```

Add CLI tests through `run(argv, deps)`: a fake `linked` returning an open PR for one candidate and none for another, and a fake `resume` for that candidate; stdout carries exactly one row, `resume` is called only for the record with an open PR, and an unreadable `--records` file is exit 2. Build one fixture's candidate-labelled record from the session snapshot's field shape (`labels:[{name}]`).

`tests/backlog-attention-rows.test.js`, one assertion function plus its go-red control:

```js
function assertStuckRow(source) {
  assert.ok(source.includes('bin/stuck-open-prs.js" --records "$ST_BACKLOG_ATTENTION_SNAPSHOT_RAW"'), 'Step 1 runs the CLI over the snapshot');
  assert.ok(source.includes('| #{n} | stuck:open-pr | {createdAt, relative} | {remedy} |'), 'the rendered row');
  assert.match(source, /`stuck:open-pr` rows are never batched/);
  assert.match(source, /could not run[^.]*note/, 'a failed CLI is a note, never an empty section');
}
test('AC3.1: attention-mode.md renders the stuck:open-pr row', () => assertStuckRow(read(SKILL_DIR, 'attention-mode.md')));
test('AC3.1 control: removing the row goes red', () => {
  const source = read(SKILL_DIR, 'attention-mode.md').replace('| #{n} | stuck:open-pr | {createdAt, relative} | {remedy} |', '');
  assert.throws(() => assertStuckRow(source), /the rendered row/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/stuck-open-pr.test.js tests/backlog-attention-rows.test.js`
Expected: FAIL after Step 1 (`Cannot find module` for the lib; `assertStuckRow` on the row)

- [ ] **Step 3: Implement**

`lib/dispatch/stuck-open-pr.js` holds the two pure functions; no-row reasons are a frozen set of `live-claim`, `live-sibling`, `prior-run-live`, `concurrent-resume`, `no-pr`. `stuck-open-prs.js` follows `run(argv, deps)` with `realDeps`, resolves owner/repo with `repo-resolve`, calls `fetchLinkedPRs` once for all candidates, then `dispatchResume.run(['--issue', String(n)], {...dispatchResume.realDeps, stdout, stderr})` per record with an `openPR`, capturing stdout and parsing it (unparseable means `verdict: null`).

`attention-mode.md`: name the row in the intro paragraph; Step 1 resolves `ST_BACKLOG_ATTENTION_STUCK` through `session-tmp-resolve.js` and runs `node "${CLAUDE_PLUGIN_ROOT}/bin/stuck-open-prs.js" --records "$ST_BACKLOG_ATTENTION_SNAPSHOT_RAW" > "$ST_BACKLOG_ATTENTION_STUCK"`; a non-zero exit means the check could not run, and the render carries one note saying so. Step 2's merge script reads `rows` and pushes type `stuck:open-pr` with `stuckRemedy` (fetch order: after `bot:parked`, in the sentence that lists it). Add the table row, a prose paragraph saying the row's remedy comes from the CLI, a batch-launcher bullet (`stuck:open-pr` rows are never batched: each remedy goes in a paste block). Keep the empty-state string byte-identical (`tests/backlog-attention-rows.test.js` pins it) and append after it ` No granted record is stuck behind an open PR.`; the anti-pattern table is unchanged. Add the two files to `docs/plugin-structure.md` next to `dispatch-resume.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/stuck-open-pr.test.js tests/backlog-attention-rows.test.js tests/session-tmp-root-migration.test.js tests/skill-fence-guard-shapes.test.js tests/sweep-orchestrator.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/stuck-open-prs.js plugin/bin/lib/dispatch/stuck-open-pr.js plugin/skills/backlog/attention-mode.md docs/plugin-structure.md tests/bin-lib/dispatch/stuck-open-pr.test.js tests/backlog-attention-rows.test.js
git commit -m "Show granted records stuck behind an open PR in backlog attention, refs #4849"
```

- [ ] **Step 6: Real-input probe, and record it**

Run `gh issue list --state open --label auto:build --json number,labels,state --limit 200 > {run-dir}/evidence/stuck-records.json`, then `node plugin/bin/stuck-open-prs.js --records {that path}`, output to `{run-dir}/evidence/stuck-open-prs-live.txt`. Independent count: for #3942, #4347, #3813, #4477 and #4467, `gh pr view {pr} --json state,closingIssuesReferences` confirms the open linked PR, and each record the probe omits gets a stated reason from its verdict. Log one `AC evidence` entry for AC3.1.

### Task 4: Tidy's stale-claim Release states the PR disposition

**Role:** integration

**Files:**
- Modify: `plugin/skills/tidy/issue-claims-backstops.md`
- Modify: `plugin/skills/tidy/scan-procedures.md`
- Modify: `plugin/skills/tidy/actions-github-issues.md`
- Test: `tests/tidy-stale-claim-open-pr-conformance.test.js`

**Interfaces:**
- Consumes: `dispatch-resume.js --issue {n}`'s `prNumbers` and `disposition` from Task 2.

- [ ] **Step 1: Write the failing tests**

```js
const BACKSTOPS = read('plugin/skills/tidy/issue-claims-backstops.md');
function assertDisposition(text) {
  const flat = text.replace(/\s+/g, ' ');
  assert.ok(flat.includes('### Open linked PR on a stale-claim Release (#4849)'), 'section');
  assert.ok(flat.includes('bin/dispatch-resume.js" --issue {n}'), 'runs the verdict');
  assert.ok(flat.includes('PR #{number}: resume — /claude-tweaks:dispatch resume #{n}'), 'resume disposition');
  assert.ok(flat.includes('PR #{number}: {disposition} — {line}'), 'refused disposition');
  assert.ok(flat.includes('`{recommendation}`') && flat.includes('staged action'), 'finding and approval text');
  assert.match(flat, /exit 2 or 4[^.]*open linked PR unknown/, 'a failed read is stated');
}
test('AC4.1: the stale-claim finding names a PR disposition when an open linked PR exists', () => assertDisposition(BACKSTOPS));
test('AC4.1 control: dropping the refused disposition goes red', () => {
  assert.throws(() => assertDisposition(BACKSTOPS.replace('PR #{number}: {disposition} — {line}', '')), /refused disposition/);
});
test('AC4.1: the plain-Release sentence hands to the disposition section', () => {
  assert.ok(claimAuditSection().replace(/\s+/g, ' ').includes("means Release plus `issue-claims-backstops.md`'s PR disposition."));
});
test('the Release claim executor leaves the PR alone', () => {
  const start = ACTIONS.indexOf('## Release claim');
  const end = ACTIONS.indexOf('## Sync to GitHub');
  assert.match(ACTIONS.slice(start, end).replace(/\s+/g, ' '), /PR disposition[^.]*never closes or touches the PR/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/tidy-stale-claim-open-pr-conformance.test.js`
Expected: FAIL after Step 1 (`section`)

- [ ] **Step 3: Edit the prose**

`scan-procedures.md`: replace `means plain Release.` with `means Release plus `issue-claims-backstops.md`'s PR disposition.` (grep for this phrase across `tests plugin` returned no other hit; the file ends at most 52,464 B). `actions-github-issues.md`, in `## Release claim`: one sentence saying a row's PR disposition is the human's to act on; `release-claim.js` never closes or touches the PR.

`issue-claims-backstops.md`, a new section before `### Backstop: missed `parked` restoration`, addressed to the Issue Claims agent like its neighbours: for each stale blob Step 4.7 will recommend as a Release, run `node "${CLAUDE_PLUGIN_ROOT}/bin/dispatch-resume.js" --issue {n}`. Exit 0: append `PR #{number}: resume — /claude-tweaks:dispatch resume #{n}`. Exit 3 with reason `no-pr`: nothing. Other exit 3: append `PR #{number}: {disposition} — {line}` for the JSON's `prNumbers`. Exit 2 or 4: append `open linked PR unknown (dispatch-resume exit {code})`, which cites `_shared/github-write-transport.md` for the `gh`-absent case. The text goes at the end of the `[claim]` row's `{recommendation}`, and a row that stages as `claim-releases` carries it verbatim in the staged action, so the Approve item's text shows it. Note the verdict reads the stale claim as resumable, the same as the `swept: stale claim` tombstone the Release writes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/tidy-stale-claim-open-pr-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/tidy/issue-claims-backstops.md plugin/skills/tidy/scan-procedures.md plugin/skills/tidy/actions-github-issues.md tests/tidy-stale-claim-open-pr-conformance.test.js
git commit -m "State the open PR's disposition on tidy's stale-claim Release, refs #4849"
```

### Task 5: Resume prose states the new rule everywhere it describes the old one

**Role:** integration

**Files:**
- Modify: `plugin/skills/dispatch/resume.md`
- Modify: `plugin/skills/dispatch/open-pr-exclusion-report.md`
- Modify: `docs/journeys/resume-a-stalled-dispatched-build-4588.md`
- Modify: `docs/skill-graph.md`
- Test: `tests/dispatch-resume-prose.test.js`

**Interfaces:**
- Consumes: the Task 1 reason names and the Task 2 stdout.

- [ ] **Step 1: Write the failing tests**

```js
const RULE = /The PR is always found through the record's closing-reference connection \(`closedByPullRequestsReferences`, the one the queue's exclusion reads\), so any head name resolves/;
test('resume.md states the closing-reference rule, and the head and worktree derive from the PR', () => {
  assertPinned(RESUME, RULE, 'closing-reference rule');
  assertPinned(RESUME, /`worktreePath` derives from the PR's head/, 'worktree derivation');
});
test('resume.md Step 2 names the multi-record refusal', () => {
  assertPinned(stepParagraph(RESUME, '2'), /a PR closing more than one record \(`multi-record-pr`\)/, 'multi-record refusal');
});
test('resume.md no longer finds the PR from the fixed head', () => {
  assert.ok(!RESUME.includes('worktree-dispatch-record-'), 'the fixed head is gone');
  assert.ok(!stepParagraph(RESUME, '2').includes('no PR on the head branch'), 'the old no-pr wording is gone');
  assert.ok('the head branch `worktree-dispatch-record-{N}`'.includes('worktree-dispatch-record-'), 'control: the probe matches its own target');
});
test('open-pr report: an excluded record never reads no-pr', () => {
  assertPinned(afterBase(OPEN_PR), /same closing-reference connection[\s\S]{0,120}never `no-pr`/, 'shared connection');
});
```

The existing `resume.md` Step 2 names `(a plain dispatch applies)`; keep it on the reworded `no-pr` clause. The file must keep passing the "only `open-pr-exclusion-report.md` names the remedy form" walk, so `resume.md` gains no `/claude-tweaks:dispatch resume` literal.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/dispatch-resume-prose.test.js`
Expected: FAIL after Step 1 (`closing-reference rule: missing`)

- [ ] **Step 3: Edit the prose**

`resume.md:5`: replace the fixed-head sentence with the rule above, keeping the clause `never from the queue's exclusion file, which has no entry for a record the label pre-filter already dropped (`bot:in-progress`)`, and add that `worktreePath` derives from the PR's head (`worktree-{name}` -> `.claude/worktrees/{name}`), and the prior run from its marker. Step 2: `no open PR closes it (a plain dispatch applies)`, add `a PR closing more than one record (`multi-record-pr`)`, and note refusals now carry `prNumbers` and `disposition`. Step 6a: the check reads the worktree from the bound run's own stamp. The Step 5 text already reads `worktreePath` and `headRefName`.

`open-pr-exclusion-report.md`, after the `dispatch-resume.js` sentence: this CLI reads the same closing-reference connection as this exclusion, so a record excluded here is never `no-pr` there. The journey's Step 2 replaces "lists the head branch ..." with the connection read; add `plugin/bin/lib/dispatch/stuck-open-pr.js` to its `files:` only if a journey step describes it. `docs/skill-graph.md`, `/dispatch` row under `/backlog`'s section: add one sentence that `attention` runs `bin/stuck-open-prs.js` and renders the resume or close remedy as text for a human. Behavior-change sweep: `git grep -n -i -e "head branch" -e "worktree-dispatch-record" -- plugin/skills/dispatch docs/getting-started.md docs/journeys/resume-a-stalled-dispatched-build-4588.md`; each remaining hit is either edited here or stated in the report as unrelated (`retry-a-record-...-3887.md` describes the build's own branch and stays).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/dispatch-resume-prose.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/resume.md plugin/skills/dispatch/open-pr-exclusion-report.md docs/journeys/resume-a-stalled-dispatched-build-4588.md docs/skill-graph.md tests/dispatch-resume-prose.test.js
git commit -m "State the closing-reference resume rule in the dispatch prose, refs #4849"
```
