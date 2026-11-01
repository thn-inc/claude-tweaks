# Parent-Gate Evaluators on the Shared Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `engine-verify.js`'s `acceptance-labeling` check and `/demo`'s Full verification pointer judge a decomposition parent through the shared Parent-Gate core (`plugin/bin/lib/issues/parent-gate.js` / `plugin/bin/parent-gate.js`) instead of their own sub-issue enumeration.

**Architecture:** `engine-verify.js` drops its own `enumerateSubIssues`/`enumerateBodyTextSubIssues` (a raw `gh api --paginate …/sub_issues` call and a body-text twin) for one `gatherParentFacts` wrapper over the core's `gatherGateFacts({ parent, … })`, and evaluates each parent target with the core's `evaluateParentGate` instead of calling `parentGateState`/`exceedsOversightFloor` by hand. `demo/entry-paths.md` Step 2 runs `bin/parent-gate.js --parent $PARENT_NUM` and reads `subIssues` and `state` off its verdict instead of composing the `gh api` call itself.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T201332-record-4805/work/4805-spec.md` (record #4805)

## Global Constraints

- AC1: `grep -n "sub_issues" plugin/bin/lib/wrap-up/engine-verify.js` returns nothing. That covers comments and error strings too, not only code. Control: run against the pre-change file it printed 4 matches (lines 746, 748, 758, 963).
- AC2: `grep -F "issues/\$PARENT_NUM/sub_issues" plugin/skills/demo/entry-paths.md` returns nothing. Control: run against the pre-change file it matched line 257 (`` `gh api --paginate "repos/{owner}/{repo}/issues/$PARENT_NUM/sub_issues"`, every page, whose ``).
- `engine-verify.js` stays read-only and gh-CLI-only. Every gh read goes through `deps.gh(args, cwd)` and every git read through `deps.git(args, cwd)`; no new `execFileSync` (file header).
- Governing skill `gh-api-module-pattern`, `batching-failure-posture.md`, quoted verbatim: "`engine-verify.js`'s `runVerify` maps its `CHECKS` array that way and maps a throw to `fail`, not `unknown`: for a gate whose whole purpose is to block on doubt, a unit that could not determine its own state is evidence to block rather than to shrug. Pick the direction the module errs and say so beside the `catch` — the two are not interchangeable."
- Governing skill `gh-api-module-pattern`, `SKILL.md`, quoted verbatim: "**A `--repo` argument is a *slug*, and the slug is host-qualified — never hand-roll `` `${owner}/${repo}` `` at one.**" The core already builds every `--repo` value with `repoSlug({ host, owner, repo })`. `gatherParentFacts` must pass `parseRepo`'s `host` through, never drop it.
- Governing skill `mcp-agent-fetch-node-compute`, Anti-Patterns row, quoted verbatim: "Writing a rule that decides which facts exist once in the `gh` gatherer and again in the MCP normalizer". Applied here: engine-verify keeps its own body-text membership rule, where an empty task list is a gather failure and a non-empty list that omits the record is a mismatch. It does not re-derive any rule the core owns: sub-issue state and stateReason reads, label normalization, self-inclusion, the gate state, or the floor on `due`.
- Governing skill `skill-prose-conformance-tests` covers Task 2's prose pin. Prove each assertion can go red with the existing `countAtPreChangeOrSkip` helper in `tests/demo-full-verification-pointer.test.js` (its "Proving discrimination without editing the tree" pattern), never by mutating the tree.
- Scope: `engine-verify.js`'s own `resolveParent` (the sub-issue → parent step) is out of scope and stays as is. The record's Deliverables name enumeration and gate evaluation only, and `resolveParent` makes no `sub_issues` call.

## Review Focus

1. **A gated or resolved parent below the floor.** Before this change, engine-verify applied the oversight floor to every non-`incomplete` parent, so a gated or resolved parent below the floor was skipped. `evaluateParentGate` returns `exceeds: null` for any state except `due`. Expected behavior: the check keeps skipping a below-floor `gated`/`resolved` parent exactly as before, reading the floor from `verdict.maxTier` when `verdict.exceeds` is null. Task 1 Step 1 pins this with `gated parent below the floor is still skipped`.
2. **Sub-issues closed as not planned.** Every sibling CLOSED with `stateReason: NOT_PLANNED`, plus the run record self-included as COMPLETED. Expected: engine-verify's skip/fail outcome is the one the CLI verdict implies for the same input (AC3). Task 1's equivalence table covers this.
3. **A gh failure partway through the core's reads.** For example, one sub-issue's `issue view` throws after enumeration succeeded. Expected: the row is `unknown` with a `parent-gate gather failed for parent #P (…)` detail, never `fail` and never a partial gate. Task 1 Step 1 pins this with `a failing sub-issue read renders unknown`.
4. **A GitHub Enterprise origin.** Expected: the core's `--repo` and `--hostname` arguments carry the origin's host. Task 1 Step 1 pins this with `gatherParentFacts threads the origin host into the core's --repo`.
5. **A parent shared by two run records under native links.** Expected: the parent is gathered once (one probe and one page call), as before. The existing `counts every run sub-issue of a shared parent as closed, enumerating that parent once` test, migrated, pins it.

---

### Task 1: Route engine-verify's parent gate through the shared core

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js`: imports (lines 33-35), replace `enumerateSubIssues` and `enumerateBodyTextSubIssues` (lines 728-794), the `acceptance-labeling` check body (lines 936-1034), and `module.exports` (line 1232).
- Modify: `plugin/bin/lib/issues/parent-gate.js`: header comment line 10 ("bin/parent-gate.js and below-floor-parent-close.js both compose it") and the `listOmitsSubIssue` comment (lines 113-114). Comment-only edits naming engine-verify.js as a third composer.
- Modify: `docs/plugin-structure.md` line 29: the `parent-gate.js (...; consumed by `bin/parent-gate.js` and `below-floor-parent-close.js`, #4603)` entry gains `wrap-up/engine-verify.js`'s acceptance-labeling check, #4805.
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js`

**Interfaces:**
- Consumes (all existing, in `plugin/bin/lib/issues/parent-gate.js`):
  - `ghCaller(gh: (args) => string) -> { call, callJson }`
  - `GhFailure` (class)
  - `gatherGateFacts({ parent, owner, repo, host, workLinks, caller }) -> { parent, parentLabels: string[], subIssues: [{ number, title, state, stateReason, labels: string[], closedBy }] }`
  - `evaluateParentGate({ parent, parentLabels, subIssues, closingSet, riskFloor }) -> verdict`, whose fields are `state` ('incomplete'|'gated'|'resolved'|'due'), `exceeds` (bool|null), `maxTier`, and `subIssues[].state`
- Produces: `gatherParentFacts(parent: number, deps: {git, gh}, cwd: string, workLinks: string) -> { ok: true, facts } | { ok: false, error: string }`, exported from `engine-verify.js` in place of `enumerateSubIssues`.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/wrap-up/engine-verify.test.js`, add a fake-gh responder for the core's call shapes and migrate every fixture to it. Owner/repo is `org/repo`, which is what `fakeOriginGit` returns. The shapes come from `tests/parent-gate-cli.test.js`'s `SHAPE`/`makeGh`:

- `parentGateReply(args, world) -> string | undefined`, where `world = { subs: {parent: number[]}, bodies: {n: text}, issues: {n: {state, stateReason, labels}}, parentLabels: {parent: string[]}, throwWhen?: (key) => bool }`. It answers:
  - the schema probe `['api','graphql','-f','query={ __type(name: "Issue") { fields { name } } }']`
  - the `subIssues(first:100)` page, built from `buildNativeSubIssuesQuery([p])` with `-f owner=org -f repo=repo`
  - `issue view P --repo org/repo --json body -q .body`, which returns raw body text, not JSON
  - `issue view N --repo org/repo --json state,stateReason,labels,title,closedByPullRequestsReferences`
  - `issue view P --repo org/repo --json labels -q [.labels[].name]`

  It returns `undefined` for anything else, so each fixture's existing branches (`--version`, the native parent GraphQL, `labels,comments`, engine-verify's own `issue view N --json body`) still answer. Call it before the generic `isGraphqlCall` parent branch: the page query also contains `issue(number:N)`.
- Migrate `subIssuesGh`/`isSubIssuesCall`, `parentGateRow`, `twoParentRow`, `bodyTextRow`, and the inline fakes in the tests at lines 1770-1815 and 2300-2370 onto `parentGateReply`. Keep every scenario's states, labels, and expected outcome. Lowercase `open`/`closed` inputs become `OPEN`/`CLOSED`. Assertions that counted the old calls now count the core's: one `subIssues(first:100)` page per native parent, and one `issue view P --repo org/repo --json body -q .body` per body-text parent. Assertions that matched the old gather texts now match `/#900: parent-gate gather failed for parent #898/`. The `no sub-issues enumerated for parent #N` text is unchanged.
- Rulings on the tests that pinned engine-verify's own parser, which the core now owns:
  - `body-text enumerateSubIssues upper-cases state and reduces labels to names`: rewrite it against `gatherParentFacts(12, deps, repoRoot, 'body-text')`, asserting `ok: true` and `facts.subIssues` holding uppercased `state` and label-name arrays.
  - Delete `body-text sub-issue with a non-string state is a gather failure`, `body-text sub-issue with a malformed labels entry renders unknown as a parse failure, not a fetch failure`, `body-text sub-issue with a missing or empty labels key still enumerates with labels []`, and `acceptance-labeling renders unknown when a sub-issue line carries no string state`. The core reads state with `String()` and labels with `normalizeLabelNames`, and `tests/bin-lib/issues/parent-gate.test.js` owns that posture. Also delete the `enumerateBodyTextSubIssues` comment at line 2118.
- New tests, each through `runVerify` unless named otherwise:
  - `AC3.1: engine-verify's verdict for a parent whose sub-issues are all closed not-planned matches bin/parent-gate.js's verdict`. Table-driven over three worlds that share parent 898, run record 900, and siblings 901 and 902, with `stateReason: 'NOT_PLANNED'` on every closed sibling:
    - (a) every sibling `CLOSED`/`NOT_PLANNED` with `risk:low`, floor `high`
    - (b) the same with `risk:high`
    - (c) 902 `OPEN`

    For each world, run `require('../../../plugin/bin/parent-gate').run(['--sub-issue','900','--closing','900','--work-links','native','--risk-floor','high'], deps)`. Its deps are `runner` (the same responder plus the parent GraphQL answer), `remoteUrl: () => 'https://github.com/org/repo.git'`, `ghAvailable: () => true`, `repoRoot: () => repoRoot`, `readPolicyRaw: () => 'work-links: native\n'`, `readWorkBackend: () => 'github-issues'`, and stdout/stderr collectors. Parse its verdict and assert engine-verify's row follows from it:
    - `state: 'incomplete'` → `skip` with `parent gate #898 not due`
    - `state: 'due'` and `exceeds: false` → `skip` with `parent #898 below oversight floor`
    - `state: 'due'` and `exceeds: true` → `fail` with `#898: missing demo:pending label`

    Also assert world (a)'s verdict is literally `{state: 'due', exceeds: false, closeReason: 'not planned'}`, so the table proves the not-planned case rather than assuming it.
  - `gated parent below the floor is still skipped` (Review Focus 1): parent labels `['demo:pending']`, every sibling `CLOSED` `risk:medium`, floor `high` → `skip` with `parent #898 below oversight floor`.
  - `a failing sub-issue read renders unknown` (Review Focus 3): `throwWhen` matches `issue view 901 --repo org/repo --json state,stateReason,labels,title,closedByPullRequestsReferences` → `unknown` with `/#900: parent-gate gather failed for parent #898/`, and no `labels,comments` call is made.
  - `gatherParentFacts threads the origin host into the core's --repo` (Review Focus 4): call `gatherParentFacts(12, { git: () => 'https://ghe.example.com/org/repo.git', gh }, cwd, 'body-text')` directly and assert one gh call carries `--repo ghe.example.com/org/repo`.

- [ ] **Step 2: Run the suite to verify the new and migrated tests fail**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js 2>&1 | tail -30`
Expected: FAIL. `gatherParentFacts` is not a function, and the migrated parent-gate rows render `unknown`, because the old code's `gh api --paginate …/sub_issues` call hits a fake that no longer answers it.

- [ ] **Step 3: Implement `gatherParentFacts` and the evaluator switch in `plugin/bin/lib/wrap-up/engine-verify.js`**

- `gatherParentFacts(parent, deps, cwd, workLinks)`:
  - Resolve `parseRepo(deps.git(['remote','get-url','origin'], cwd))`. A git throw or a null spec is `{ ok: false }` with the existing `could not resolve owner/repo for parent #P` text. An owner or repo of `.` or `..` is the same failure, the guard `bin/parent-gate.js` applies.
  - Call `gatherGateFacts({ parent, owner, repo, host, workLinks, caller: ghCaller((args) => deps.gh(args, cwd)) })`.
  - Catch only `GhFailure`, and map it to `{ ok: false, error: `parent-gate gather failed for parent #${parent} (${err.message})` }`. Any other throw propagates to `runVerify`'s catch (`fail`). Say so beside the catch, per the quoted governing rule.
  - Empty `facts.subIssues` is `{ ok: false, error: `no sub-issues enumerated for parent #${parent}` }`.
- In the check, cache `gatherParentFacts` results per parent where `enumerations` cached `enumerateSubIssues`'s. Keep the native dedupe-before-gather and the body-text membership test, now read from `facts.subIssues`. Store the facts per parent target in place of `parentSubIssues`. Drop the `closing`-forced copy: self-inclusion is now the core's job, via `closingSet: issues`.
- In the per-target loop, for a parent target, set `const verdict = evaluateParentGate({ ...facts, closingSet: issues, riskFloor })`.
  - `verdict.state === 'incomplete'` → the existing skip line, with `openCount` counted from `verdict.subIssues` (`state !== 'CLOSED'`).
  - Otherwise use `verdict.exceeds` when it is not null, else `exceedsOversightFloor({ risk: verdict.maxTier }, { riskFloor, sizeFloor: null }).exceeds`. Comment this: a gated or resolved parent keeps the floor reading this check always applied (Review Focus 1). `false` → the existing below-floor skip line.
- Remove the now-unused `parentGateState`, `maxRiskTier`, `parseRecordFacets`, and `parseSubIssues` imports. Check each with grep before removing; `parseParent` stays for `resolveParent`. Rewrite the comments at lines 728-739 and 940-950 so no line contains `sub_issues` (AC1). Export `gatherParentFacts` in place of `enumerateSubIssues`.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js tests/parent-gate-cli.test.js tests/bin-lib/issues/parent-gate.test.js > "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T201332-record-4805/evidence/t1.txt" 2>&1; echo exit=$?; tail -8 "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T201332-record-4805/evidence/t1.txt"`
Expected: `exit=0`, `# fail 0`.

Run: `grep -n "sub_issues" plugin/bin/lib/wrap-up/engine-verify.js`
Expected: no output, exit 1 (AC1).

- [ ] **Step 5: Live probe against a real parent**

Run a scratch node script, never committed. It calls `gatherParentFacts(4571, { git: defaultGit, gh: defaultGh }, process.cwd(), 'native')` from the worktree, prints the sorted `facts.subIssues` numbers and states, and alongside them prints `node plugin/bin/parent-gate.js --parent 4571 --work-links native`'s `subIssues` numbers. For an independent count, also run `gh api repos/thn-inc/claude-tweaks/issues/4571/sub_issues --paginate --jq '.[].number'`. All three number lists must be equal. Write the full output to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T201332-record-4805/evidence/live-probe-4571.txt` (after `mkdir -p`) with a Bash redirect. Then log one `AUTO` `--step "AC evidence"` entry through `log-decision.js --text-file`, naming the three counts and the evidence path.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/wrap-up/engine-verify.js plugin/bin/lib/issues/parent-gate.js docs/plugin-structure.md tests/bin-lib/wrap-up/engine-verify.test.js
git commit -m "Route engine-verify's parent gate through the shared core — gatherGateFacts + evaluateParentGate replace its own sub-issue enumeration (refs #4805)"
```

### Task 2: Point /demo's Full verification pointer at bin/parent-gate.js

**Role:** integration

**Files:**
- Modify: `plugin/skills/demo/entry-paths.md` lines 254-274 (Full verification pointer, step 2)
- Modify: `docs/skill-graph.md` line 202 (the `wrap-up/verification-brief-parent-gate.md` row: "but from the sub-issue side rather than the parent side")
- Test: `tests/demo-full-verification-pointer.test.js`
- No change: `plugin/skills/_shared/observation-plan.md` lines 38-40 ("`parentGateState` is called with the record in hand included"). That stays true, because the CLI's `--parent` call evaluates the full list with every live state.

**Interfaces:**
- Consumes: `bin/parent-gate.js --parent <n>`, which prints one JSON verdict line and exits 0. Exit 2 means gh is absent or the policy is unreadable; exit 3 means a gh call failed. The verdict's `subIssues[]` are `{number, title, state, stateReason, pr}` in number order, `state` is `parentGateState` over them and the parent's labels, and a `--parent` call with no `--closing` applies no self-inclusion. The CLI resolves `work-backend: local-files` from CLAUDE.md itself.
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

- [ ] **Step 4: Update `docs/skill-graph.md` line 202**

Replace "but from the sub-issue side rather than the parent side" with wording that says `/demo` resolves the parent from the record in hand, then runs the same `bin/parent-gate.js` as a parent-side `--parent` call (no self-inclusion). Leave the rest of the row unchanged.

- [ ] **Step 5: Run the tests and AC greps**

Run: `node --test tests/demo-full-verification-pointer.test.js tests/try-it-contract-conformance.test.js tests/accept-label-reader-conformance.test.js tests/comment-trust-conformance.test.js tests/pr-run-comments.test.js > "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T201332-record-4805/evidence/t2.txt" 2>&1; echo exit=$?; tail -8 "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T201332-record-4805/evidence/t2.txt"`
Expected: `exit=0`, `# fail 0`.

Run: `grep -F "issues/\$PARENT_NUM/sub_issues" plugin/skills/demo/entry-paths.md`
Expected: no output, exit 1 (AC2).

Write both AC greps' output, AC1's from Task 1 and AC2's from here, with their exit codes to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T201332-record-4805/evidence/ac-greps.txt`. Log one `AUTO` `--step "AC evidence"` entry through `log-decision.js --text-file`, naming AC1 and AC2, both commands, and `exit=1` for each.

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
| AC3.1 (all-not-planned equivalence unit test) | Task 1 Step 1 |
| Key File `plugin/bin/lib/issues/parent-gate.js` (reuse) | Task 1 (consumed; comment-only edits) |
