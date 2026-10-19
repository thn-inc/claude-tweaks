# Stale Stamped pr.number Classification (#3543) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stamped `run-state.json` `pr.number` that names no PR classifies as `'pr-not-found'` (from GitHub's structured GraphQL error, never stderr text) and escalates through archive-merged's structurally-stuck machinery instead of skipping silently as `network-failure` forever.

**Architecture:** `pr-state.js`'s two by-number resolvers keep `gh pr view` as the primary call; only when that call classifies `'network-failure'` do they run one confirming `gh api graphql` probe and return `'pr-not-found'` on an exact structured `NOT_FOUND` match. `archive-merged.js` and `release-merged.js` treat the new string like their other failure strings (skip, never branch fallback); archive-merged adds it to `STRUCTURALLY_STUCK_REASONS`.

**Tech Stack:** Node 18+, `child_process.execFile(Sync)`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T170937-spec-3541-3543-3585/spec-3543/work/3543-spec.md`

Scope keywords: resolvePrStateByNumber, STRUCTURALLY_STUCK_REASONS, decideRelease

## Global Constraints

- Never inspect gh stderr text: `git grep -n "Could not resolve" -- plugin/bin/lib/reconcile/` must print nothing (comments included).
- Owner/name/number travel as typed GraphQL variables: `-f owner=… -f name=… -F number=…`, never spliced into the query string.
- Same `FETCH_TIMEOUT_MS`, `retryOnTimeout: true`, `windowsHide: true` as the existing `gh pr view` call; sync resolver uses `execFileSync`, async uses `execFileAsync`.
- The success path of `gh pr view` makes no extra call.
- `resolveIssueStateByNumber` is unchanged.
- Never fall back to the branch lookup for `'pr-not-found'` (#3416 misattribution).
- Commit messages: `{Verb} {what} — {detail}` style, `refs #3543` (never closes/fixes).

## Review Focus

1. A `null` `data.repository` (wrong slug / no access) with a NOT_FOUND error must stay `'network-failure'` — Task 1 test.
2. A NOT_FOUND error whose `path` is not exactly `["repository","pullRequest"]` (e.g. `["repository"]`) must stay `'network-failure'` — Task 1 test.
3. A repoRoot with no resolvable `origin` (repoSlugOf null) must stay `'network-failure'` and spawn no GraphQL call — covered by existing tests using `os.tmpdir()` as repoRoot (non-repo), which must keep passing.
4. `decideArchiveCore`/`decideRelease` given the bare string `'pr-not-found'` must not fall through to `prState.state` dereference paths that would mislabel it `pr-closed-unmerged` — Tasks 2 and 3 unit tests.
5. `gh-absent` / `invalid-arguments` from `gh pr view` must never trigger the GraphQL probe — Task 1 test (existing gh-absent test with PATH emptied keeps passing; add an argv-spy assertion that no `api graphql` call happened on success).

## Consumer enumeration (return-shape widening)

`resolvePrStateByNumber` / `resolvePrStateByNumberAsync` gain the string `'pr-not-found'`. Consumers:
- `plugin/bin/lib/reconcile/archive-merged.js:1634` `resolveRunPrState` — returns as-is → `decideArchiveCore` needs an explicit `'pr-not-found'` skip branch (Task 2), else it reads `.state` of a string and reports `pr-closed-unmerged`.
- `plugin/bin/lib/reconcile/archive-merged.js:1904` no-branch by-number fallback — gates on `typeof byNumber === 'object'`; a `'pr-not-found'` falls through to the existing `no-branch`/`no-worktree` skip, which is already in `STRUCTURALLY_STUCK_REASONS`. No change.
- `plugin/bin/lib/reconcile/release-merged.js:474` Phase 1.5 — branch-resolved candidate stores the string; `decideRelease` needs an explicit skip branch (Task 3). Branchless candidate keeps `prState` null (unchanged).
- `plugin/bin/lib/flow/consolidated-pass.js:145` — non-object → `degraded` text. No change; Task 3 adds a test (AC7.1).
- `plugin/skills/_shared/github-pr-scan.md:309` — `typeof r === 'object'` gate; no change.
- `plugin/skills/dispatch/close-out.md:42` — behavior already correct ("any string result stops"), but its prose enumerates the resolver's full string contract (pinned by `tests/close-out-pr-state-contract-conformance.test.js`) — Task 3 adds `'pr-not-found'` to it.
- Not consumers needing change (Check B hits): `CHANGELOG.md` (release-please owned), `docs/plugin-structure.md` (describes the function generically), `tests/reconcile.test.js` (decideRelease object-shape tests, unaffected — re-run in Task 3).

---

### Task 1: `'pr-not-found'` classification in pr-state.js

**Files:**
- Modify: `plugin/bin/lib/reconcile/pr-state.js` (header comment of `resolvePrStateByNumber` ~lines 149-168; `resolvePrStateByNumber` ~169-184; `resolvePrStateByNumberAsync` ~238-259)
- Test: `tests/bin-lib/reconcile/pr-state.test.js`

**Interfaces:**
- Produces: `resolvePrStateByNumber(repoRoot, number)` and `resolvePrStateByNumberAsync(repoRoot, number)` may now return `'pr-not-found'` in addition to object | null | `'gh-absent'` | `'network-failure'` | `'invalid-arguments'`. Exports unchanged.
- Internal (not exported): `isPrNotFoundBody(stdout) -> boolean`, `prNotFoundProbeArgs(repoRoot, number) -> string[] | null`, `confirmPrNotFound(repoRoot, number) -> boolean`, `confirmPrNotFoundAsync(repoRoot, number) -> Promise<boolean>`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/reconcile/pr-state.test.js`

Add a fixture helper `makeOriginRepo()` — `fs.mkdtempSync` + `git init -q` + `git remote add origin git@github.com:acme/w.git` (so `repoSlugOf` resolves `acme/w`) — and a gh wrapper script that dispatches on `$1 $2`: `pr view` → `exit 1` with nothing on stdout; `api graphql` → appends `"$@"` to an argv log, prints a supplied body, exits with a supplied code. Constant:
`NOT_FOUND_BODY = {"data":{"repository":{"pullRequest":null}},"errors":[{"type":"NOT_FOUND","path":["repository","pullRequest"],"message":"x"}]}`.

Tests (all `{ skip: PATH_STUB_SKIP }`):
- `AC1.1 AC1.2: a nonexistent stamped PR (pr view exit 1 + GraphQL NOT_FOUND) -> pr-not-found, sync and async (#3543)` — both resolvers return `'pr-not-found'`; argv log contains `-F number=3406`, `-f owner=acme`, `-f name=w`, and the `query=` arg does not contain `3406` or `acme` (typed variables, not spliced).
- `AC2.1: pr view failure + GraphQL transport failure (exit 1, empty stdout) -> network-failure, sync and async (#3543)`.
- `#3543: a non-NOT_FOUND GraphQL error -> network-failure` — body with `errors[0].type = 'FORBIDDEN'`.
- `#3543: NOT_FOUND with a null data.repository -> network-failure` — body `{"data":{"repository":null},"errors":[{"type":"NOT_FOUND","path":["repository"]}]}`.
- `#3543: NOT_FOUND on a different path -> network-failure` — `path: ["repository"]` with non-null repository.
- `#3543: a successful gh pr view makes no GraphQL call, sync and async` — `pr view` prints a PR object; argv log for `api graphql` never written.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/pr-state.test.js`
Expected: FAIL — the AC1.1 AC1.2 test gets `'network-failure'` instead of `'pr-not-found'`.

- [ ] **Step 3: Implement in `plugin/bin/lib/reconcile/pr-state.js`**

- `isPrNotFoundBody(stdout)`: `JSON.parse` in try/catch (false on throw / non-string); true only when `parsed.data.repository` is a non-null object, `parsed.data.repository.pullRequest == null`, and `parsed.errors` is an array with an entry `e.type === 'NOT_FOUND'` and `Array.isArray(e.path) && e.path.length === 2 && e.path[0] === 'repository' && e.path[1] === 'pullRequest'`.
- `prNotFoundProbeArgs(repoRoot, number)`: `repoSlugOf(repoRoot)`; null when unresolvable; else `['api', 'graphql', '-f', 'owner=' + owner, '-f', 'name=' + name, '-F', 'number=' + String(number), '-f', 'query=query($owner:String!,$name:String!,$number:Int!){ repository(owner:$owner,name:$name){ pullRequest(number:$number){ number } } }']`.
- `confirmPrNotFound`: args null → false; else `runClassified(() => execFileSync('gh', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: FETCH_TIMEOUT_MS, windowsHide: true }), (e) => (e && e.stdout) || '', { retryOnTimeout: true })` then `isPrNotFoundBody`. `gh api graphql` exits 1 on a GraphQL error but still writes the body to stdout, so the thrown error's `stdout` is the evidence.
- `confirmPrNotFoundAsync`: same with `runClassifiedAsync` + `execFileAsync` (options as the existing async call: no `stdio`).
- Each by-number resolver: capture the existing `runClassified(...)` result; `return result === 'network-failure' && confirmPrNotFound(repoRoot, number) ? 'pr-not-found' : result;` (async: `await confirmPrNotFoundAsync`).
- Header comment: add `'pr-not-found'` to the return-value list with one sentence: the primary call failed and a structured GraphQL probe confirmed the repo resolves but holds no PR with that number (#3543); never derived from stderr text.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/pr-state.test.js`
Expected: PASS (all tests, including the pre-existing `malformed gh output -> network-failure` ones).

Run: `git grep -n "Could not resolve" -- plugin/bin/lib/reconcile/` (AC3.1 AC3.2)
Expected: no output, exit 1.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/pr-state.js tests/bin-lib/reconcile/pr-state.test.js
git commit -m "Classify a nonexistent stamped PR as pr-not-found — structured GraphQL confirm, refs #3543"
```

### Task 2: archive-merged skips and escalates `'pr-not-found'`; docs

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`decideArchiveCore` ~line 320; `STRUCTURALLY_STUCK_REASONS` comment + constant ~1410-1425; `resolveRunPrState` comment ~1624-1631)
- Modify: `docs/hooks.md` (line 15, the `pr.number` sentence)
- Modify: `docs/journeys/keep-a-live-run-whose-reused-branch-backed-a-merged-pr-3416.md` (Step 2 "Should understand", Step 4 "Should understand")
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Consumes: Task 1's `'pr-not-found'` return value from `resolvePrStateByNumber`.
- Produces: `decideArchiveCore('pr-not-found', …) -> { action: 'skip', reason: 'pr-not-found' }`; `STRUCTURALLY_STUCK_REASONS.has('pr-not-found') === true`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/reconcile/archive-merged.test.js`

- Extend `installGhPrWrapper({ list, view, viewMarker, graphql })` additively: when `graphql` (`{ body, exit }`) is given, `api graphql` prints `body` and exits `exit`; otherwise unchanged (exit 1).
- `decideArchiveCore: pr-not-found skips with reason pr-not-found (#3543)` — `deepStrictEqual(decideArchiveCore('pr-not-found', 'resolved'), { action: 'skip', reason: 'pr-not-found' })`.
- `AC4.1 AC4.2: STRUCTURALLY_STUCK_REASONS has pr-not-found and not network-failure (#3543)` — import `STRUCTURALLY_STUCK_REASONS` (already exported).
- `AC5.1: a stamped pr.number resolving pr-not-found skips pr-not-found, never archives via the MERGED branch PR, and enters the stuck counter once past the TTL (#3543)` — `fixtureReusedBranchLiveRun({ runId, prNumber: 3406, consoleResolved: true })`, `git remote add origin git@github.com:acme/w.git` on root, backdate runDir by `STRUCTURALLY_STUCK_TTL_MS * 2`; wrapper `list` = MERGED #3391 with `mergeCommit.oid = featureSha`, `view: {}`, `graphql: { body: NOT_FOUND_BODY, exit: 1 }`. Assert not archived, skip reason `'pr-not-found'`, runDir exists, and `listResidueFailures(root)` has an entry `{ reason: 'structurally-stuck', path: runDir, lastError: 'stuck at pr-not-found' }`.
- `AC5.2: trackStuckSkip escalates pr-not-found exactly once past the TTL with "stuck at pr-not-found" (#3543)` — mirror the existing `trackStuckSkip: escalates exactly once…` test with reason `'pr-not-found'`; assert `calls.length === 1` and `calls[0].lastError === 'stuck at pr-not-found'`.
- `#3543: a network-failure skip never escalates, even past the TTL` — (a) `trackStuckSkip` with `'network-failure'` `RESIDUE_ESCALATE_THRESHOLD * 2` times on a backdated dir → zero escalate calls and no residue entry; (b) the AC5.1 fixture with `graphql: { body: '', exit: 1 }` → skip reason `'network-failure'` and no `structurally-stuck` residue entry for runDir.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL — `decideArchiveCore('pr-not-found', …)` returns `pr-closed-unmerged`; `STRUCTURALLY_STUCK_REASONS.has('pr-not-found')` is false.

- [ ] **Step 3: Implement**

- `decideArchiveCore`: add `if (prState === 'pr-not-found') return { action: 'skip', reason: 'pr-not-found' };` beside the other failure-string lines.
- `STRUCTURALLY_STUCK_REASONS`: add `'pr-not-found'`; extend its comment: a stamped PR number that GitHub confirms names no PR will never resolve without a human (fix or clear the stamp), and the by-number lookup deliberately never falls back to the branch (#3416), so the skip would otherwise repeat silently forever; `network-failure` stays excluded because a long genuine outage must not page (#3543).
- `resolveRunPrState` comment: name `'pr-not-found'` among the failure strings returned as-is.
- `docs/hooks.md` line 15: after "a failed by-number probe skips the run for that pass rather than falling back to the branch", add that a probe GitHub's GraphQL API confirms names no PR classifies `pr-not-found` (from the structured `NOT_FOUND` error, never gh's stderr text) and escalates through archive-merged's structurally-stuck tracking once the run dir is past its 7-day TTL.
- Journey: Step 2 "Should understand" — add `pr-not-found` to the failure list; Step 4 "Should understand" — replace "that case is tracked as a follow-up in the run's open-items ledger" with: the skip reason is `pr-not-found`, and once the run dir sits untouched past the structurally-stuck TTL the reconciler escalates it like any other stuck run (#3543). Add `plugin/bin/lib/reconcile/pr-state.js` to the frontmatter `files:` list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/reconcile/archive-merged.test.js docs/hooks.md docs/journeys/keep-a-live-run-whose-reused-branch-backed-a-merged-pr-3416.md
git commit -m "Escalate a pr-not-found archive skip as structurally stuck — stale stamp no longer silent, refs #3543"
```

### Task 3: release-merged skips `'pr-not-found'`; consolidated-pass degrade

**Files:**
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (`decideRelease` ~line 91-93; `needsIssueEvidence` comment ~114; Phase 1.5 comment ~462-470)
- Modify: `plugin/skills/dispatch/close-out.md` (step 2 "Re-check mergeability" — its enumeration of the resolver's string results is the full contract, pinned by a conformance test)
- Test: `tests/bin-lib/reconcile/release-merged.test.js`
- Test: `tests/bin-lib/flow/consolidated-pass.test.js`
- Test: `tests/close-out-pr-state-contract-conformance.test.js` (add `'pr-not-found'` to the `for (const s of [...])` list in `close-out step 2 names every string result the resolver returns`)

**Interfaces:**
- Consumes: Task 1's `'pr-not-found'` from `resolvePrStateByNumberAsync`.
- Produces: `decideRelease(cls, 'pr-not-found', …) -> { action: 'skip', reason: 'pr-not-found' }`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/reconcile/release-merged.test.js` (append), `tests/bin-lib/flow/consolidated-pass.test.js` (append), `tests/close-out-pr-state-contract-conformance.test.js` (extend list)

- `release-merged.test.js`: `decideRelease: pr-not-found skips with reason pr-not-found, even with a closed issue (#3543)` — `deepStrictEqual(decideRelease('live', 'pr-not-found', 'CLOSED', undefined), { action: 'skip', reason: 'pr-not-found' })`; and `needsIssueEvidence('pr-not-found') === false`.
- `release-merged.test.js`: `AC6.1: a branch-resolved candidate whose stamped pr.number resolves pr-not-found is never released via the branch PR (#3543)` — `writeReusedBranchFixture('reused-notfound', …)` with case clauses `*"pr view 3406"*) exit 1 ;;` and `*"api graphql"*) printf '%s' '<NOT_FOUND_BODY>'; exit 1 ;;`; assert `released.length === 0`, a skip `{ issueNumber: 3375, reason: 'pr-not-found' }`, no PUT marker, no label deletes.
- `consolidated-pass.test.js`: `AC7.1: online + pr-not-found -> no throw, degraded text names it (#3543)` — `resolvePrStateByNumber: () => 'pr-not-found'`; assert `r.detail` matches `/online PR check unavailable \(pr-not-found\)/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js tests/close-out-pr-state-contract-conformance.test.js`
Expected: FAIL — `decideRelease` returns reason `pr-closed-unmerged` for `'pr-not-found'`; close-out step 2 is missing `'pr-not-found'`.

- [ ] **Step 3: Implement**

- `decideRelease`: add `if (prState === 'pr-not-found') return { action: 'skip', reason: 'pr-not-found' };` beside the other failure strings.
- `needsIssueEvidence` comment: list `pr-not-found` among the strings decided without an issue lookup.
- `close-out.md` step 2: add `'pr-not-found'` (a stamped/queried number GitHub confirms names no PR) to the string list, keeping "Any string result (or `null`) stops this candidate" intact.
- Phase 1.5 comment: name `'pr-not-found'` (#3543) as one of the probe failure strings: a branch-resolved candidate skips on it, a branchless candidate keeps `prState` null (#3249 issue-closed path); release-merged has no stuck escalation of its own — the stale stamp surfaces through archive-merged for the same run dir.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/flow/consolidated-pass.test.js tests/close-out-pr-state-contract-conformance.test.js tests/reconcile.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/release-merged.js plugin/skills/dispatch/close-out.md tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/flow/consolidated-pass.test.js tests/close-out-pr-state-contract-conformance.test.js
git commit -m "Skip claim release on a pr-not-found stamped PR — never via the branch PR, refs #3543"
```

Waived AC8.1: `npm test` passing is verified by /build Common Step 5 and /test, not by a plan test step.
