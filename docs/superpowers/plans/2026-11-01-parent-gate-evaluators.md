# Parent-Gate Evaluators on the Shared Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `engine-verify.js`'s `acceptance-labeling` check and `/demo`'s Full verification pointer judge a decomposition parent through the shared Parent-Gate core (`plugin/bin/lib/issues/parent-gate.js` / `plugin/bin/parent-gate.js`) instead of their own sub-issue enumeration.

**Architecture:** `engine-verify.js` drops its own `enumerateSubIssues`/`enumerateBodyTextSubIssues` (a raw `gh api --paginate …/sub_issues` call and a body-text twin) for one `gatherParentFacts` wrapper over the core's `gatherGateFacts({ parent, … })`, and evaluates each parent target with the core's `evaluateParentGate` instead of calling `parentGateState`/`exceedsOversightFloor` by hand. The check resolves the origin repository once, through `repo-resolve.js`'s `gateOriginRepo` (the gate `bin/parent-gate.js` applies, #4933), and every read it makes for that run (parent resolution, the gate's reads, the target's `labels,comments` read, the PR comments read) names that one repository. `demo/entry-paths.md` Step 2 runs `bin/parent-gate.js --parent $PARENT_NUM` and reads `subIssues` and `state` off its verdict instead of composing the `gh api` call itself.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T104639-record-4805/work/4805-spec.md` (record #4805, Plan Review Clarifications 1-7)

**Base:** this plan is written against the branch after its catch-up merge `50b30e2a7`, which brought in #3508 (`6df94c407`). #3508 already implemented Clarification 1's floor rule on main: the floor applies to `due` only, a `gated` parent goes on to the brief check, and a `resolved` parent skips with the detail `parent #P already dispositioned` (which does not cite Step 4.0b). This plan keeps that detail text and #3508's tests, and changes only what Clarification 6 narrows.

## Global Constraints

- AC1: `grep -n "sub_issues" plugin/bin/lib/wrap-up/engine-verify.js` returns nothing. That covers comments and error strings too, not only code. Control: against the pre-change file it prints 4 matches (lines 747, 749, 759, 978).
- AC2: `grep -F "issues/\$PARENT_NUM/sub_issues" plugin/skills/demo/entry-paths.md` returns nothing. Control: against the pre-change file it matches line 274 (`` `gh api --paginate "repos/{owner}/{repo}/issues/$PARENT_NUM/sub_issues"`, every page, whose ``).
- `engine-verify.js` stays read-only and gh-CLI-only. Every gh read goes through `deps.gh(args, cwd)` and every git read through `deps.git(args, cwd)`; no new `execFileSync` (file header).
- Governing skill `gh-api-module-pattern`, `batching-failure-posture.md`, quoted verbatim: "`engine-verify.js`'s `runVerify` maps its `CHECKS` array that way and maps a throw to `fail`, not `unknown`: for a gate whose whole purpose is to block on doubt, a unit that could not determine its own state is evidence to block rather than to shrug. Pick the direction the module errs and say so beside the `catch` — the two are not interchangeable."
- Governing skill `gh-api-module-pattern`, `SKILL.md`, quoted verbatim: "**A `--repo` argument is a *slug*, and the slug is host-qualified — never hand-roll `` `${owner}/${repo}` `` at one.**" Every `--repo` value this plan adds is `repoSlug({ host, owner, repo })` over the one spec `gateOriginRepo` returned.
- Governing skill `mcp-agent-fetch-node-compute`, Anti-Patterns row, quoted verbatim: "Writing a rule that decides which facts exist once in the `gh` gatherer and again in the MCP normalizer". Applied here: engine-verify keeps its own body-text membership rule, where an empty task list is a gather failure and a non-empty list that omits the record is a mismatch. It does not re-derive any rule the core owns: sub-issue state and stateReason reads, label normalization, self-inclusion, the gate state, or the floor on `due`.
- Governing skill `skill-prose-conformance-tests` covers the prose pins in Tasks 1 and 2. Prove each new assertion can go red with a mutant of the read text (the `assertGateTableTwin` mutant pattern in `tests/bin-lib/wrap-up/engine-verify.test.js`) or the existing `countAtPreChangeOrSkip` helper in `tests/demo-full-verification-pointer.test.js`, never by mutating the tree.
- Clarification 5, the family rule: any input `bin/parent-gate.js` refuses or cannot read renders `unknown` in engine-verify, never `skip` or a default. That covers an invalid `risk-floor` or `work-links`, an unreadable `policy.yml`, a malformed sub-issue reply, an origin of `.` or `..`, and an origin host `gateOriginRepo` refuses.
- Clarification 6 is a **deliberate divergence from the CLI**: `bin/parent-gate.js` calls every `resolved` parent a no-op, while engine-verify fails a `resolved` parent that still carries a pending label. It is stated in engine-verify's comment and in the procedure's gate-state table, and #3508's test that asserted the opposite for `['demo:pending', 'demo:changes-requested']` changes with it.

## Review Focus

1. **A `resolved` parent that still carries a pending label (Clarification 6).** #3508 (merged after the clarification-6 question was posted, before it was answered) made every `resolved` parent skip, and its test `#3508 every verdict spelling and an outranked pending label skip as dispositioned` pins `['demo:pending', 'demo:changes-requested']` as a skip. Clarification 6 rules the other way: such a parent fails with `#P: pending label outranked by a verdict — run /claude-tweaks:demo #P`, above or below the floor, so a requested change stays visible at wrap-up. Expected: that label set leaves #3508's skip table and gets its own failing test; the procedure's gate-state table splits its `resolved` row in two; the journey line that says the outranked detail "never fires for a parent" is rewritten. Every other `resolved` shape (no pending label) still skips as `parent #P already dispositioned`.
2. **One repository per check run (Clarification 7).** Expected: `gateOriginRepo` runs once per check run, before any parent resolution. Every `gh issue view`/`gh pr view` read the check makes carries `--repo {slug}`; every GraphQL or REST read carries the spec's owner/repo and, off github.com, `--hostname {host}`. A refused host, an unparseable origin, or an owner/repo of `.`/`..` renders `unknown` before any gh call beyond the `--version` availability probe.
3. **Sub-issues closed as not planned (Clarification 2).** Two fixtures: the run record left out of the parent's native list (`closeReason: 'not planned'`), and the run record listed, the production shape, where self-inclusion makes `closeReason: 'completed'`. Expected: the shared core's verdict over engine-verify's gathered facts equals `bin/parent-gate.js`'s for the same input, `closeReason` included.
4. **A gh failure partway through the core's reads.** For example, one sub-issue's `issue view` throws after enumeration succeeded. Expected: the row is `unknown` with a `parent-gate gather failed for parent #P (…)` detail, never `fail` and never a partial gate.
5. **A GitHub Enterprise origin.** Expected: with `GH_HOST` naming the origin host, the core's `--repo` and `--hostname` arguments, and the check's own `--repo` arguments, carry that host.
6. **A parent shared by two run records under native links.** Expected: the parent is gathered once (one probe and one page call), as before.
7. **A malformed sub-issue reply (Clarification 3).** `state` not a string, `stateReason` present and not a string, or `labels` neither absent nor an array of `{name: string}`. Expected: `readSubIssueFacts` throws `GhFailure`, so the CLI exits 3 and engine-verify's row is `unknown`, never `skip` and never `fail` through a `TypeError`. An absent `labels` key stays an unlabeled issue.
8. **An invalid policy value (Clarifications 4 and 5).** `risk-floor: bogus`, `work-links: bogus`, or a `policy.yml` that exists and will not read. Expected: `unknown` naming the problem, with no fallback to the schema default, matching `bin/parent-gate.js`'s exit 2. A missing `policy.yml` still resolves to the schema defaults, as the CLI's does.

---

### Task 1: Route engine-verify's parent gate through the shared core

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js`: imports (lines 28-36), `resolveParent` and its comment (lines 670-727), replace `enumerateSubIssues` and `enumerateBodyTextSubIssues` (lines 729-795), the policy readers `readRepoPolicyRaw`, `resolveRiskFloor` and `resolveWorkLinks` (lines 797-819), the `acceptance-labeling` comment block (lines 866-913) and check body (lines 914-1193, including the `pr view` read near line 1108), `runVerify`'s per-check `deps` object (lines 1195-1226: forward `gateDeps: deps.gateDeps`), and `module.exports` (lines 1258-1272).
- Modify: `plugin/bin/lib/issues/parent-gate.js`: harden `readSubIssueFacts` (lines 194-217, Clarification 3); export `onHost` (line 128) so engine-verify applies the one `--hostname` rule; header comment line 10 ("bin/parent-gate.js and below-floor-parent-close.js both compose it") and the `listOmitsSubIssue` comment (lines 115-119), both naming engine-verify.js as a third composer.
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md` lines 378-386: the **What the `acceptance-labeling` row does with each gate state.** paragraph and table (Clarification 6).
- Modify: `docs/journeys/verify-wrap-ups-closure-checklist-900.md` line 69 (the sentence ending "so that detail never fires for a parent") and a new `Updated for #4805` line after line 104.
- Modify: `docs/plugin-structure.md` line 29: the `parent-gate.js (...; consumed by `bin/parent-gate.js` and `below-floor-parent-close.js`, #4603)` entry gains `wrap-up/engine-verify.js`'s acceptance-labeling check, #4805.
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js`
- Test: `tests/bin-lib/issues/parent-gate.test.js`

**Interfaces:**
- Consumes (all existing):
  - `plugin/bin/lib/issues/parent-gate.js`: `ghCaller(gh: (args) => string) -> { call, callJson }`; `GhFailure` (class); `gatherGateFacts({ parent, owner, repo, host, workLinks, caller }) -> { parent, parentLabels: string[], subIssues: [{ number, title, state, stateReason, labels: string[], closedBy }] }`; `evaluateParentGate({ parent, parentLabels, subIssues, closingSet, riskFloor }) -> verdict`, whose fields are `state` ('incomplete'|'gated'|'resolved'|'due'), `exceeds` (bool|null), `closeReason`, `maxTier`, and `subIssues[].state`; `onHost(args, host) -> args` (newly exported).
  - `plugin/bin/lib/repo-resolve.js`: `gateOriginRepo(remote, deps) -> { spec: {host, owner, repo} | null, refusal: string | null }`; `repoSlug({ host, owner, repo })`.
- Produces, exported from `engine-verify.js` in place of `enumerateSubIssues`:
  - `resolveCheckRepo(deps: {git, gateDeps?}, cwd) -> { ok: true, spec } | { ok: false, error }`
  - `gatherParentFacts(parent: number, deps: {gh}, cwd: string, workLinks: string, spec) -> { ok: true, facts } | { ok: false, error }`
  - `resolveParent(n, deps, cwd, workLinks, spec)` gains the `spec` argument.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/wrap-up/engine-verify.test.js`, add a fake-gh responder for the core's call shapes and migrate every fixture to it. Owner/repo is `org/repo`, which is what `fakeOriginGit` returns. The shapes come from `tests/parent-gate-cli.test.js`'s `SHAPE`/`makeGh`:

- `parentGateReply(args, world, { slug = 'org/repo', host = 'github.com' } = {}) -> string | undefined`, where `world = { subs: {parent: number[]}, bodies: {n: text}, issues: {n: {state, stateReason, labels}}, parentLabels: {parent: string[]}, throwWhen?: (key) => bool }`. Off github.com it first removes a `--hostname {host}` pair from the argv wherever it sits (trailing on the core's own reads, at position 2 on fetch-sub-issues.js's `['api','graphql','--hostname',host,…]`), then matches the shapes below with `--repo {slug}` in place of `--repo org/repo`, so the Clarification 7 GHE test can reach a passing row. It answers:
  - the schema probe `['api','graphql','-f','query={ __type(name: "Issue") { fields { name } } }']`
  - the `subIssues(first:100)` page, built from `buildNativeSubIssuesQuery([p])` with `-f owner=org -f repo=repo`
  - `issue view P --repo org/repo --json body -q .body`, which returns raw body text, not JSON
  - `issue view N --repo org/repo --json state,stateReason,labels,title,closedByPullRequestsReferences`
  - `issue view P --repo org/repo --json labels -q [.labels[].name]`

  It returns `undefined` for anything else, so each fixture's existing branches (`--version`, the native parent GraphQL, `labels,comments`, engine-verify's own `issue view N --repo org/repo --json body`) still answer. Call it before the generic `isGraphqlCall` parent branch: the page query also contains `issue(number:N)`.
- Every `issue view` and `pr view` call the check makes now carries `--repo org/repo` right after the number (Clarification 7). Update every fixture matcher that keys on argv positions: `isIssueViewCall` (line 2185) and `bodyTextRow`'s `args[4]` tests (lines 2210-2219) move to the position after `--repo org/repo`, or match on `args.includes(...)`. Fixtures that use `args.includes('labels,comments')` and `args[2] === 'N'` keep working unchanged.
- Migrate `subIssuesGh`/`isSubIssuesCall` (lines 106-114), `parentGateRow` (line 1840), `twoParentRow` (line 1981), `bodyTextRow` (line 2191), and every inline fake that calls `isSubIssuesCall` (lines 1798, 1821, 2491 and 2774) onto `parentGateReply`. Keep every scenario's states, labels, and expected outcome, except the one Clarification 6 changes (below). Lowercase `open`/`closed` inputs become `OPEN`/`CLOSED`. Assertions that counted the old calls now count the core's: one `subIssues(first:100)` page per native parent, and one `issue view P --repo org/repo --json body -q .body` per body-text parent. Assertions that matched the old gather texts now match `/#900: parent-gate gather failed for parent #898/`. The `no sub-issues enumerated for parent #N` text is unchanged. #3508's tests (lines 2031-2177) keep their assertions, apart from Clarification 6's change.
- Rulings on the tests that pinned engine-verify's own parser, which the core now owns:
  - `body-text enumerateSubIssues upper-cases state and reduces labels to names` (line 2252): rewrite it against `gatherParentFacts(12, deps, repoRoot, 'body-text', ORG_REPO)` (`ORG_REPO = { host: 'github.com', owner: 'org', repo: 'repo' }`), asserting `ok: true` and `facts.subIssues` holding uppercased `state` and label-name arrays.
  - Clarification 3 keeps these four tests. Migrate them onto `gatherParentFacts`/`parentGateReply`; none is deleted:
    - `body-text sub-issue with a non-string state is a gather failure`: `gatherParentFacts(12, …, 'body-text', ORG_REPO)` is `{ ok: false }` with an error naming `#21`.
    - `body-text sub-issue with a malformed labels entry renders unknown as a parse failure, not a fetch failure`: keep its table `[[null], ['risk:high'], [{ name: 7 }], [{}], null, 'x']`. Each is `unknown` and matches `/#20: parent-gate gather failed for parent #12/` and `/unexpected output/`. The core's message for a parse failure carries `unexpected output`, and a thrown read does not, so the test still tells the two apart.
    - `body-text sub-issue with a missing or empty labels key still enumerates with labels []`: assert `facts.subIssues[0].labels` is `[]` and `state` is `'OPEN'`.
    - `acceptance-labeling renders unknown when a sub-issue line carries no string state`: its native twin, now `unknown` through the core.
  - Rewrite `acceptance-labeling falls back to the default high floor when policy.yml sets an invalid risk-floor` (line 1964) as `acceptance-labeling renders unknown when policy.yml sets an invalid risk-floor` (Clarification 4): same fixture, `unknown`, detail matching `/invalid risk-floor "bogus"/`, and no `labels,comments` call. Also add a call to `require('../../../plugin/bin/parent-gate').run(['--parent','898','--work-links','native'], deps)` with `readPolicyRaw: () => 'risk-floor: bogus\n'`, asserting exit 2, so the test shows engine-verify's row and the CLI agree.
  - Rewrite the comment at line 2287, which names `enumerateBodyTextSubIssues`, a function this task deletes.
  - `AC2.1/AC2.2: body-text resolveParent reads the Parent line and targets the parent` (line 2238) calls `resolveParent(20, deps, repoRoot, 'body-text', ORG_REPO)`.
- Clarification 6 rulings on #3508's tests:
  - `#3508 every verdict spelling and an outranked pending label skip as dispositioned` (line 2065): drop `['demo:pending', 'demo:changes-requested']` from its table and rename it `#3508 every verdict spelling with no pending label skips as dispositioned`. The three remaining label sets keep their assertions.
  - New: `#4805 a resolved parent still carrying a pending label fails as outranked, on either side of the floor` (Review Focus 1). Table over parent labels `['demo:pending', 'demo:changes-requested']` and `['accept:pending', 'accept:changes-requested']`, crossed with `closedSubs3508('risk:high')` and `closedSubs3508('risk:medium')` (floor `high`) → `fail`, detail matching `/#898: pending label outranked by a verdict — run \/claude-tweaks:demo #898/`, not matching `/already dispositioned/` or `/below oversight floor/`. Also assert, for the same fixture, that `bin/parent-gate.js`'s verdict is `state: 'resolved'`: the test shows the divergence is deliberate rather than a disagreement on state.
  - The gate-state table twin (`GATE_TABLE_STATES`, line 2123, and `gateTableFixture3508`, line 2124): the `` `resolved` `` row becomes two rows, `` `resolved`, no pending label `` (fixture: `['demo:approved']`, as today) and `` `resolved`, pending label carried `` (fixture: `['demo:pending', 'demo:changes-requested']`, `closedSubs3508('risk:high')`). Add a fourth mutant to `AC3.1: #3508 the procedure's gate-state table matches the row the check emits`: drop the `` | `resolved`, pending label carried | `` row, asserting the pin throws.
- New test in `tests/bin-lib/issues/parent-gate.test.js`: `shape 5: a malformed state, stateReason or labels is a GhFailure` (Clarification 3). Through `readSubIssueFacts`, table over `{ state: null }`, `{ state: 7 }`, `{ state: 'OPEN', stateReason: 7 }`, and `labels` of `[null]`, `['risk:high']`, `[{ name: 7 }]`, `[{}]`, `null` and `'x'`, each asserting `ghFailure(/unexpected output/)`. Same test: `labels` absent reads `[]`, `stateReason` absent or `null` reads `''`, and `labels: [{ name: 'risk:low' }]` reads `['risk:low']`.
- New tests, each through `runVerify` unless named otherwise:
  - `AC3.1: engine-verify's verdict for a parent whose sub-issues are all closed not-planned matches bin/parent-gate.js's verdict`. Table-driven over two fixtures crossed with three worlds, all sharing parent 898, run record 900, and siblings 901 and 902, with `stateReason: 'NOT_PLANNED'` on every closed sibling and floor `high`. Clarification 2 fixes the two fixtures:
    - Fixture A, AC3 as written: `subs[898] = [901, 902]`, the run record left out of the native list. Under `work-links: native` run record 900 still resolves 898 through its own GraphQL `parent` link.
    - Fixture B, the production shape: `subs[898] = [900, 901, 902]`, with 900 live `OPEN`. 900 carries the same `risk:*` label as its siblings: one unscored sub-issue makes `maxRiskTier` return nothing, which exceeds the floor, so a missing label would turn world (a) into `exceeds: true`.
    - World (a): every sibling `CLOSED`/`NOT_PLANNED` with `risk:low`
    - World (b): the same with `risk:high`
    - World (c): 902 `OPEN`, the rest as (a)

    For each pair, compute two verdicts for the same input:
    - The shared core's: `gatherParentFacts(898, deps, repoRoot, 'native', ORG_REPO)` then `evaluateParentGate({ ...facts, closingSet: [900], riskFloor: 'high' })`.
    - The CLI's: `require('../../../plugin/bin/parent-gate').run(['--sub-issue','900','--closing','900','--work-links','native','--risk-floor','high'], deps)`. Its deps are `runner` (the same responder plus the parent GraphQL answer), `remoteUrl: () => 'https://github.com/org/repo.git'`, `ghAvailable: () => true`, `repoRoot: () => repoRoot`, `readPolicyRaw: () => 'work-links: native\n'`, `readWorkBackend: () => 'github-issues'`, `gateDeps: { env: {} }`, and stdout/stderr collectors. Parse its stdout as the verdict.

    Assert `deepStrictEqual` on the whole verdict, `closeReason` included. Then assert `runVerify`'s `acceptance-labeling` row for that pair follows from the verdict:
    - `state: 'incomplete'` → `skip` with `parent gate #898 not due`
    - `state: 'due'` and `exceeds: false` → `skip` with `parent #898 below oversight floor`
    - `state: 'due'` and `exceeds: true` → `fail` with `#898: missing demo:pending or accept:pending label`

    Also assert the literal values, so the table proves each case rather than assuming it: world (a) under Fixture A is `{state: 'due', exceeds: false, closeReason: 'not planned'}`; world (a) under Fixture B is `{state: 'due', exceeds: false, closeReason: 'completed'}`.
  - `a failing sub-issue read renders unknown` (Review Focus 4): `throwWhen` matches `issue view 901 --repo org/repo --json state,stateReason,labels,title,closedByPullRequestsReferences` → `unknown` with `/#900: parent-gate gather failed for parent #898/`, and no `labels,comments` call is made.
  - `gatherParentFacts threads the spec's host into the core's --repo` (Review Focus 5): call `gatherParentFacts(12, { gh }, cwd, 'body-text', { host: 'ghe.example.com', owner: 'org', repo: 'repo' })` directly and assert one gh call carries `--repo ghe.example.com/org/repo`.
  - `acceptance-labeling sends every read for one run to the origin repository` (Review Focus 2, Clarification 7): a native fixture with one run record under a due, above-floor parent carrying `demo:pending` and a PR-side brief pointer (run-state `pr: {number: 77}`), with `deps.gateDeps = { env: { GH_HOST: 'ghe.example.com' } }` and an origin of `https://ghe.example.com/org/repo.git`. Assert every `issue view`/`pr view` call carries `--repo ghe.example.com/org/repo`, and every `api` call carries `--hostname ghe.example.com`, the parent GraphQL read included. Repeat under `work-links: body-text` for the record's `--json body` read.
  - `acceptance-labeling renders unknown when the origin host is refused` (Clarification 5): origin `https://git.corp.invalid/org/repo.git`, `deps.gateDeps = { env: {}, readFile: () => { throw new Error('ENOENT'); } }` → `unknown` matching `/is not a known GitHub host/`, and no gh call beyond `--version`.
  - `acceptance-labeling renders unknown for a non-parent body-text record when the origin is refused` (spec Clarification 8): `bodyTextRow`-shaped fixture under `work-links: body-text` whose run record carries no `Parent:` line, origin `https://git.corp.invalid/org/repo.git` and the same hermetic `gateDeps` → `unknown` matching `/is not a known GitHub host/`, with no `labels,comments` call and no `--json body` call.
  - Every test that sets `gateDeps` passes it on `runVerify`'s `deps` (`deps: { git, gh, gateDeps }`); `runVerify` forwards it to the check, and the hermetic `env`/`readFile` keep the result independent of the machine's own `GH_HOST` and gh `hosts.yml`. Fixtures that set no `gateDeps` use a `github.com` origin, which `gateOriginRepo` accepts on any machine.
  - `acceptance-labeling refuses an origin of . or ..` (Clarification 5): origin `https://github.com/../repo.git` → `unknown` with `/#900: could not resolve owner\/repo/`, and no gh call beyond `--version`. The CLI's exit 2 on the same origin is pinned in `tests/parent-gate-cli.test.js` already.
  - `acceptance-labeling renders unknown when policy.yml sets an invalid work-links` (Review Focus 8): `policyRaw: 'work-links: bogus\n'` → `unknown` with `/invalid work-links "bogus"/`, and no gh call beyond the `--version` availability check.
  - `acceptance-labeling renders unknown when policy.yml will not read` (Review Focus 8): make `.claude-tweaks/policy.yml` a directory in the fixture's `repoRoot`, so the read fails with `EISDIR` → `unknown` with `/cannot read \.claude-tweaks\/policy\.yml/`. A missing file still resolves to the schema defaults: the existing `policyRaw: null` test stays as it is.
  - The existing `acceptance-labeling check renders unknown when owner/repo cannot be resolved from the git remote` (line 2904) keeps its `/#900.*could not resolve owner\/repo/` assertion.

- [ ] **Step 2: Run the suites to verify the new and migrated tests fail**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js tests/bin-lib/issues/parent-gate.test.js 2>&1 | tail -30`
Expected: FAIL. `gatherParentFacts` is not a function, the migrated parent-gate rows render `unknown` (the old code's `gh api --paginate …/sub_issues` call hits a fake that no longer answers it), the outranked-pending test reads `skip`, and `shape 5: a malformed state, stateReason or labels is a GhFailure` fails against the unhardened `readSubIssueFacts`.

- [ ] **Step 3: Harden `readSubIssueFacts`, export `onHost`, then implement the repository resolution, `gatherParentFacts` and the evaluator switch**

- In `plugin/bin/lib/issues/parent-gate.js`'s `readSubIssueFacts`, throw `GhFailure` with `gh issue view ${num}: unexpected output (…)`, the wording `gatherIdempotenceFacts` uses, when:
  - `live.state` is not a string
  - `live.stateReason` is present, non-null and not a string
  - `live.labels` is not `undefined` and is not an array whose every entry is an object with a string `name`

  An absent `labels` key is an unlabeled issue and reads `[]`, as `state,labels` did in the code this task deletes. Update the function's comment. The checks run before `normalizeLabelNames`, so a non-array can no longer reach it as a `TypeError`. Add `onHost` to `module.exports`.
- In `plugin/bin/lib/wrap-up/engine-verify.js`, replace the three policy readers with one `readParentGatePolicy(repoRoot, keys) -> { ok: true, values } | { ok: false, error }`. A read that throws with `ENOENT` or `ENOTDIR` is no policy file (`policyRaw: null`, the schema defaults), as `bin/parent-gate.js`'s `readPolicyRaw` treats it. Any other throw is `{ ok: false, error: `cannot read .claude-tweaks/policy.yml: ${err.message}` }`. A key `resolvePolicyKeys` reports `invalid` (through its `onInvalid` callback) is `{ ok: false, error: `.claude-tweaks/policy.yml: invalid ${key} ${JSON.stringify(raw)}` }`. Keep the "repo root, never the worktree cwd" comment.
- In `runVerify`, add `gateDeps: deps.gateDeps` to the `deps` object each check receives (`{ git, gh, gateDeps }`); it stays `undefined` in production.
- `resolveCheckRepo(deps, cwd)`: read `deps.git(['remote','get-url','origin'], cwd)` (a throw is `{ ok: false, error: `git remote get-url failed (${err.message})` }`), then `gateOriginRepo(remote, deps.gateDeps)`. A `refusal` is `{ ok: false, error: refusal }`. A null spec, or an owner or repo of `.` or `..` (the guard `bin/parent-gate.js` applies), is `{ ok: false, error: 'could not resolve owner/repo' }`. `deps.gateDeps` is undefined in production, so `gateOriginRepo` reads `process.env` and gh's real `hosts.yml`, as the CLI does.
- `resolveParent(n, deps, cwd, workLinks, spec)`: the body-text read becomes `issue view N --repo ${repoSlug(spec)} --json body`; the native read passes `owner`/`repo` from `spec` to `fetchNativeParent`, with a runner that applies `onHost(args, spec.host)`. It no longer reads the origin itself. Rewrite its comment: the "no `git remote` call" sentence goes, and the comment names Clarification 7 (one repository per check run).
- `gatherParentFacts(parent, deps, cwd, workLinks, spec)`:
  - Call `gatherGateFacts({ parent, owner: spec.owner, repo: spec.repo, host: spec.host, workLinks, caller: ghCaller((args) => deps.gh(args, cwd)) })`.
  - Catch only `GhFailure`, and map it to `{ ok: false, error: `parent-gate gather failed for parent #${parent} (${err.message})` }`. Any other throw propagates to `runVerify`'s catch (`fail`). Say so beside the catch, per the quoted governing rule.
  - Empty `facts.subIssues` is `{ ok: false, error: `no sub-issues enumerated for parent #${parent}` }`.
- In the check, after the gh-availability probe and the exempt filter, and before any parent resolution:
  - Read `work-links` through `readParentGatePolicy`; an `ok: false` returns `{ result: 'unknown', detail: error }`.
  - Call `resolveCheckRepo(deps, cwd)` once; an `ok: false` returns `{ result: 'unknown', detail: `#${checkIssues.join(', #')}: ${error}` }`, so the existing `/#900.*could not resolve owner\/repo/` assertion still matches.
  - Read `risk-floor` once, only when a parent target exists, through `readParentGatePolicy`; an `ok: false` returns `unknown`, before any `labels,comments` read. This is Clarifications 4 and 5.
- In the check, cache `gatherParentFacts` results per parent where `enumerations` cached `enumerateSubIssues`'s. Keep the native dedupe-before-gather and the body-text membership test, now read from `facts.subIssues`. Store the facts per parent target in place of `parentSubIssues`. Drop the `closing`-forced copy: self-inclusion is now the core's job, via `closingSet: issues`.
- Every `issue view … --json labels,comments` read and the `pr view … --json comments` read gain `--repo ${repoSlug(spec)}` right after the number.
- In the per-target loop, for a parent target, set `const verdict = evaluateParentGate({ ...facts, closingSet: issues, riskFloor })`.
  - `verdict.state === 'incomplete'` → the existing skip line, with `openCount` counted from `verdict.subIssues` (`state !== 'CLOSED'`).
  - `verdict.state === 'resolved'` and the target's `labels,comments` labels carry neither `demo:pending` nor `accept:pending` → the existing `parent #${target} already dispositioned` skip. When it carries one, fall through: the existing `dispositionState(labelNames) !== 'pending'` branch emits `#${target}: pending label outranked by a verdict — run /claude-tweaks:demo #${target}`. Comment the deliberate divergence: `bin/parent-gate.js` calls every `resolved` parent a no-op, while this check keeps a carried pending label failing so a requested change stays visible at wrap-up (#4805 Clarification 6).
  - `verdict.exceeds === false` → the existing below-floor skip line, which only `due` can reach. Comment that `exceeds` is `null` on every other state, and that a `null` must never read as below the floor, so a `gated` parent falls through to the label and brief check.
- Remove the now-unused `parentGateState`, `exceedsOversightFloor`, `maxRiskTier`, `parseRecordFacets`, `parseSubIssues` and `parseRepo` imports. Check each with grep before removing, since other checks in this file may still use one (`parseRepo` is used at lines 534 and 591); `parseParent` stays for `resolveParent`. Rewrite the comments at lines 670-693 (it names `resolveWorkLinks`), 729-740, 892-906 and 976-980 so they describe the core and no line contains `sub_issues` (AC1). Line 978's comment is one of AC1's four matches and sits inside the check body, so it needs the rewrite as much as the deleted functions do. Export `gatherParentFacts` and `resolveCheckRepo` in place of `enumerateSubIssues`.
- In `plugin/skills/wrap-up/verification-brief-parent-gate.md`, rewrite the **What the `acceptance-labeling` row does with each gate state.** paragraph: a `resolved` parent with no pending label owes nothing more; a `resolved` parent that still carries a pending label fails, as a non-parent target does, which is a deliberate divergence from `bin/parent-gate.js` (every `resolved` parent is a no-op there) so a requested change stays visible at wrap-up (#4805). Split the table's `resolved` row into `` | `resolved`, no pending label | `skip` | `parent #P already dispositioned` | `` and `` | `resolved`, pending label carried | `fail` | `#P: pending label outranked by a verdict — run /claude-tweaks:demo #P` | ``. Add a sentence that the row reads every repository it touches from the one origin `gateOriginRepo` accepts, and renders `unknown` on any input the CLI refuses — a refused or unresolvable origin included, for every target, parent or not (spec Clarification 8). Measure `wc -c` before and after; the file is 45889 bytes, well under the rail.
- In `docs/journeys/verify-wrap-ups-closure-checklist-900.md` line 69, replace "a parent carrying one resolves as `resolved` and skips instead, so that detail never fires for a parent" with the Clarification 6 rule (a `resolved` parent carrying a pending label fails with the same detail; only a `resolved` parent with no pending label skips), and add `- Updated for #4805: …` after line 104 naming the shared core, the outranked-pending fail on a parent, and the one-repository rule.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T104639-record-4805/evidence"`

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js tests/parent-gate-cli.test.js tests/bin-lib/issues/parent-gate.test.js tests/bin-lib/issues/below-floor-parent-close.test.js tests/bin-lib/reconcile/post-merge.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-conformance.test.js tests/gh-host-seam-behavior.test.js > "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T104639-record-4805/evidence/t1.txt" 2>&1; echo exit=$?`
Then: `tail -8 "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T104639-record-4805/evidence/t1.txt"`
Expected: `exit=0`, `# fail 0`.

Run: `grep -n "sub_issues" plugin/bin/lib/wrap-up/engine-verify.js`
Expected: no output, exit 1 (AC1).

- [ ] **Step 5: Live probe against a real parent**

Run a scratch node script, never committed. It calls `resolveCheckRepo({ git: defaultGit }, process.cwd())`, then `gatherParentFacts(4571, { gh: defaultGh }, process.cwd(), 'native', spec)` from the worktree, prints the sorted `facts.subIssues` numbers and states, and alongside them prints `node plugin/bin/parent-gate.js --parent 4571 --work-links native`'s `subIssues` numbers. For an independent count, also run `gh api repos/thn-inc/claude-tweaks/issues/4571/sub_issues --paginate --jq '.[].number'`. All three number lists must be equal. Write the full output to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T104639-record-4805/evidence/live-probe-4571.txt` with a Bash redirect. Then log one `AUTO` `--step "AC evidence"` entry through `log-decision.js --text-file`, naming the three counts and the evidence path.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/wrap-up/engine-verify.js plugin/bin/lib/issues/parent-gate.js plugin/skills/wrap-up/verification-brief-parent-gate.md docs/journeys/verify-wrap-ups-closure-checklist-900.md docs/plugin-structure.md tests/bin-lib/wrap-up/engine-verify.test.js tests/bin-lib/issues/parent-gate.test.js
git commit -m "Route engine-verify's parent gate through the shared core — gatherGateFacts + evaluateParentGate replace its own sub-issue enumeration, one origin repository per check run (refs #4805)"
```

### Task 2: Point /demo's Full verification pointer at bin/parent-gate.js

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/demo/entry-paths.md` lines 271-292 and 298-300 (Full verification pointer, step 2 and its closing **Fail open, visibly** paragraph)
- Modify: `docs/skill-graph.md` line 203 (the `wrap-up/verification-brief-parent-gate.md` row: "but from the sub-issue side rather than the parent side")
- Test: `tests/demo-full-verification-pointer.test.js`
- No change: `plugin/skills/_shared/observation-plan.md` lines 38-40 ("`parentGateState` is called with the record in hand included"). That stays true, because the CLI's `--parent` call evaluates the full list with every live state.

**Interfaces:**
- Consumes: `bin/parent-gate.js --parent <n>`, which prints one JSON verdict line and exits 0. Exit 2 means gh is absent, the origin host is refused, or the policy is unreadable; exit 3 means a gh call failed. The verdict's `subIssues[]` are `{number, title, state, stateReason, pr}` in number order, `state` is `parentGateState` over them and the parent's labels, and a `--parent` call with no `--closing` applies no self-inclusion. The CLI resolves `work-backend: local-files` from CLAUDE.md itself.
- Produces: nothing code-level.

- [ ] **Step 1: Write the failing prose test**

Add `test('entry-paths.md enumerates siblings through bin/parent-gate.js --parent, never a hand-composed sub_issues call', (t) => …)` to `tests/demo-full-verification-pointer.test.js`. It asserts:
- `entryPaths` matches `/bin\/parent-gate\.js" --parent \$PARENT_NUM/`
- `entryPaths` does not include the literal `issues/$PARENT_NUM/sub_issues` (AC2.1)
- `entryPaths` matches `/verdict's `state`/`, so the gate value is read off the verdict

Prove discrimination with `countAtPreChangeOrSkip(t, ENTRY_PATHS_PATH, 'bin/parent-gate.js" --parent')`, whose count must be `0`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/demo-full-verification-pointer.test.js 2>&1 | tail -15`
Expected: FAIL on the `--parent` match.

- [ ] **Step 3: Rewrite step 2 of the Full verification pointer in `plugin/skills/demo/entry-paths.md`**

Replace the per-link-model enumeration recipes (the native `gh api --paginate` call, the body-text per-number `gh issue view`, the local-files `queryRecords` read, and the separate parent-labels fetch) with one CLI call run as its own Bash call: `node "${CLAUDE_PLUGIN_ROOT}/bin/parent-gate.js" --parent $PARENT_NUM`. The new text must state four things:
- Why `--parent` and never `--sub-issue {n}`: a parent-side call applies no Self-inclusion rule, so the record in hand keeps its live state.
- The CLI reads `work-backend`/`work-links` itself.
- `Pending:` is built from the verdict's `subIssues`, with the record in hand excluded and `state !== 'CLOSED'` meaning open.
- The `parent gate {…}` value in `Pending: none — …` is the verdict's `state`, never recomputed with `parentGateState`.

Keep the "Two different lists" reasoning: the full list includes the record in hand. Keep the sizing sentence. Extend the closing **Fail open, visibly** paragraph so a non-zero exit of that call is a failing lookup in step 2, with the CLI's stderr line quoted. Do not add a `--facts-json` path: `/demo` keeps its fail-open posture when `gh` is absent.

- [ ] **Step 4: Update `docs/skill-graph.md` line 203**

Replace "but from the sub-issue side rather than the parent side" with wording that says `/demo` resolves the parent from the record in hand, then runs the same `bin/parent-gate.js` as a parent-side `--parent` call (no self-inclusion). Leave the rest of the row unchanged.

- [ ] **Step 5: Run the tests and AC greps**

Run: `node --test tests/demo-full-verification-pointer.test.js tests/try-it-contract-conformance.test.js tests/accept-label-reader-conformance.test.js tests/comment-trust-conformance.test.js tests/pr-run-comments.test.js > "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T104639-record-4805/evidence/t2.txt" 2>&1; echo exit=$?`
Then: `tail -8 "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T104639-record-4805/evidence/t2.txt"`
Expected: `exit=0`, `# fail 0`.

Run: `grep -F "issues/\$PARENT_NUM/sub_issues" plugin/skills/demo/entry-paths.md`
Expected: no output, exit 1 (AC2).

Write both AC greps' output, AC1's from Task 1 and AC2's from here, with their exit codes to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T104639-record-4805/evidence/ac-greps.txt`. Log one `AUTO` `--step "AC evidence"` entry through `log-decision.js --text-file`, naming AC1 and AC2, both commands, and `exit=1` for each.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/demo/entry-paths.md docs/skill-graph.md tests/demo-full-verification-pointer.test.js
git commit -m "Point /demo's Full verification pointer at bin/parent-gate.js — one --parent call replaces the hand-composed sub-issue enumeration (refs #4805)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 / AC1.1 (no `sub_issues` in engine-verify) | Task 1 Steps 3-4 |
| Deliverable 2 / AC2.1 (demo calls `bin/parent-gate.js`) | Task 2 Steps 1, 3, 5 |
| AC3.1 (all-not-planned equivalence unit test, both fixtures, `closeReason` compared) | Task 1 Step 1 |
| Clarification 1 (floor on `due` only; `resolved` a no-op) | Already on main via #3508; Task 1 keeps it, its tests migrated |
| Clarification 2 (AC3 both fixtures, `closeReason`) | Task 1 Step 1 |
| Clarification 3 (malformed sub-issue replies stay `unknown`) | Task 1 Steps 1, 3 |
| Clarification 4 (an invalid `risk-floor` renders `unknown`) | Task 1 Steps 1, 3 |
| Clarification 5 (the family rule: invalid `work-links`, an unreadable `policy.yml`, an origin of `.` or `..`, a refused origin host) | Task 1 Steps 1, 3 |
| Clarification 6 (a `resolved` parent carrying a pending label keeps failing; deliberate divergence from the CLI, stated and pinned) | Task 1 Steps 1, 3 |
| Clarification 7 (one repository per gate evaluation) | Task 1 Steps 1, 3 |
| Clarification 8 (plan review: a refused origin is `unknown` for non-parent targets too) | Task 1 Steps 1, 3 |
| Key File `plugin/bin/lib/issues/parent-gate.js` (reuse) | Task 1 (consumed; `readSubIssueFacts` hardened per Clarification 3; `onHost` exported) |
