# Parent-Gate CLI Implementation Plan (#4603)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Parent-Gate Procedure's Resolve / Enumerate / Self-inclusion / Evaluate steps and the below-floor close's idempotence check run as one tested CLI, `plugin/bin/parent-gate.js`, that prints one JSON verdict. `wrap-up/verification-brief-parent-gate.md` keeps each section's heading and stated rule and routes the verdict, and no longer composes any fetch or compute.

**Architecture:** There is one Node implementation of the gate. `plugin/bin/lib/issues/parent-gate.js` holds four parts: a pure `evaluateParentGate`, a gh gather `gatherGateFacts`, a gh gather `gatherIdempotenceFacts`, and a pure `evaluateIdempotence`. The gathers use the `gh` call shapes that #4599's `plugin/bin/lib/issues/below-floor-parent-close.js` already makes, with one exception. The `native` enumeration goes through the spec's paginated fetcher instead: `plugin/bin/fetch-sub-issues.js`'s exported `run`, called in-process. Task 2 refactors `closeBelowFloorParents` (the reconciler's Step 4.0b engine) to compose them, so the reconciler and the CLI share every rule. The thin CLI `plugin/bin/parent-gate.js` feeds that one evaluate path from three fact sources:
- `gh`, the default, through an injectable runner;
- `--facts-json <file>`, the gh-absent MCP path: the agent writes raw MCP results and `plugin/bin/lib/issues/mcp-parent-gate-shape.js` normalizes them and checks their shape;
- `--backend local-files`, through `local-store.js`.

The skill prose and `_shared/pr-first-merge-post-merge.md` Step 4.0b call the CLI and route on its fields.

**Tech Stack:** Node 18+ CommonJS, zero npm deps, `node --test`; Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T211744-record-4603/work/4603-spec.md` (record #4603). Its Plan Review Decisions section fixes **Reading B**: `parentIssue: false` is reported beside the prose's five verdict fields, and the no-op stays in Step 4.0b's routing prose. The pre-merge and tidy entries keep their current behavior.

**Base:** branch tip `f1304718d`, whose `plugin/`, `tests/` and `docs/` trees match `origin/main` at `0baad513d`. That commit brought in #4599, #4602, #4549 and #4600. Every line reference below was read against it.

Scope keywords: parentGateState, Enumerate the parent's sub-issues, sub_issues, below-floor-parent-close

Check B sweep (2026-10-31, rerun against `0baad513d`): every hit outside this plan's file list needs no change.
- `plugin/bin/fetch-sub-issues.js` is now consumed in-process by the shared gather (Task 1). Its only change is an exported exit-code constant, `EXIT_SUBISSUES_UNAVAILABLE`. Its CLI behavior, its prose call sites and `docs/plugin-structure.md:224`'s line are unchanged.
- Independent readers that this record does not route through the CLI: `engine-verify.js`, `record-snapshot.js`, `link.js`, `link-records.js`, `backlog-grant-gate`, `_shared/github-pr-scan*.md`, `_shared/trust-table.md`, `tidy/step-1-records.md`, `_shared/observation-plan.md` and `tidy/step-6-auto.md`'s `parentGateState` latch note.
- Files that cite the procedure's sections by name: `tidy/actions-{github-issues,local-files}.md` ("from **Enumerate the parent's sub-issues** onward"), `wrap-up/verification-brief.md:44`, `demo/entry-paths.md:255` and `docs/skill-graph.md:200,706`. Task 6 keeps every heading. It places `## Run the gate CLI` right before `## Evaluate the gate`, so every one of those "from … onward" and "through" ranges passes through it with no caller edit.
- `dispatch/settle-and-merge.md:28-30` still holds: it lists the calls the procedure makes, now made by its CLI, and says the Transport paragraph names each call's MCP tool. Task 6 keeps that paragraph naming them.
- `.claude/skills/gh-api-module-pattern/SKILL.md` and `.claude/skills/skill-prose-conformance-tests/*` cite `fetch-sub-issues.js` and the `ghCalls` ratchet. Both still hold.
- Stale claims that this plan fixes: `below-floor-parent-close.js`'s header (Task 2), `post-merge.js:5-7` (Task 2), `docs/reconcile-checks.md:579-586` (Task 3), `.claude/skills/prose-code-twin-pin/SKILL.md:253-258` (Task 3), `docs/plugin-structure.md:29` (Task 3), `.claude/skills/mcp-agent-fetch-node-compute/SKILL.md` rule 10 and its Instances table (Task 4), and `wrap-up/verification-brief.md:89-92`'s "It covers, in order" list (Task 6).

## Global Constraints

- **Read before you write.** Read these in full first: `plugin/bin/lib/issues/below-floor-parent-close.js`, `tests/bin-lib/issues/below-floor-parent-close.test.js`, `plugin/bin/lib/reconcile/post-merge.js:250-410`, `tests/bin-lib/reconcile/post-merge.test.js:870-910` (the end-to-end case that pins the exact argv), `plugin/bin/fetch-sub-issues.js`, `tests/fetch-sub-issues-cli.test.js`, `plugin/bin/lib/issues/native-dependencies.js:83-104` (`fetchNativeSubIssues`), `plugin/bin/lib/issues/record-dependencies.js:79-85` (`buildNativeSubIssuesQuery`) and `plugin/bin/lib/issues/capabilities-probe.js:58-84` (`probeSchemaStrict`).
- **The gh call shapes, in this order.** Shapes 1-3 and 5-8 are byte-identical to `below-floor-parent-close.js` today. Shape 4 replaces its single REST read with the spec's fetcher (Reading A).
  1. sub-issue → parent, `work-links: body-text`: `['issue', 'view', String(n), '--json', 'body', '-q', '.body']`, then `/^Parent: #(\d+)/m` on stdout.
  2. sub-issue → parent, `work-links: native`: `fetchNativeParent({ number: n, owner, repo, runner })` (`./native-dependencies`), which sends `['api', 'graphql', '-f', 'query=…', '-f', 'owner=…', '-f', 'repo=…']`.
  3. parent → sub-issues, `body-text`: `['issue', 'view', String(parent), '--json', 'body', '-q', '.body']`, then `parseSubIssues` (`./record`), sorted ascending.
  4. parent → sub-issues, `native`: call `require('../../fetch-sub-issues').run([String(parent), '--repo', `${owner}/${repo}`, '--resolve-retries'], deps)` in-process. The `deps` are `{ ghAvailable: () => true, remoteUrl: () => null, runner: (args) => caller.call(args), stdout, stderr }`, with `stdout` and `stderr` capturing into strings. Its runner sends, in order:
     - **4a**, the schema probe (`probeSchemaStrict`): `['api', 'graphql', '-f', 'query={ __type(name: "Issue") { fields { name } } }']`.
     - **4b**, the batched page (`fetchNativeSubIssues`): `['api', 'graphql', '-f', `query=${buildNativeSubIssuesQuery([parent])}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`]`. The query asks for `subIssues(first:100){ nodes{ number } pageInfo{ hasNextPage } }`.
     - **4c**, only when 4b's page reports `hasNextPage: true` or the alias is missing: the `--resolve-retries` REST ladder, `['api', '--paginate', `repos/${owner}/${repo}/issues/${parent}/sub_issues`, '--jq', '.[].number']`. `parseRepo('github.com/o/r')` yields host `github.com`, so no `--hostname` is added.

     The page size is 100: a parent with at most 100 sub-issues is one 4b page, and a larger one is routed through 4c's `--paginate`.

     Branch on the exit code `run` returns:
     - `0`: parse the captured stdout and take `byParent[String(parent)]`. Keep the distinct positive integers, sorted ascending. A missing key is a `GhFailure`.
     - `EXIT_SUBISSUES_UNAVAILABLE` (`4`, the probe says the `subIssues` field is unavailable): the gather makes **4d** itself through `caller.call`. 4d has the same argv as 4c. Split its output on `\n` and keep the distinct positive integers, sorted ascending.
     - Any other code: `GhFailure('fetch-sub-issues.js exit {code}: {captured stderr, trimmed}')`. A `GhFailure` thrown by the runner inside `run` is caught there and returned as exit 3, so its message survives in the captured stderr.

     `EXIT_SUBISSUES_UNAVAILABLE` is imported from `fetch-sub-issues.js` (Task 1 exports it), never retyped as `4`. That is the `cli-wrapper-contract.md` rule: "A module that calls a CLI's `run(argv, deps)` in-process and branches on one of its exit codes imports that code from the CLI".
  5. each sub-issue, ascending: `['issue', 'view', String(num), '--repo', `${owner}/${repo}`, '--json', 'state,stateReason,labels,title,closedByPullRequestsReferences']`.
  6. the parent's labels: `['issue', 'view', String(parent), '--json', 'labels', '-q', '[.labels[].name]']`, then `normalizeLabelNames`.
  7. idempotence: `['issue', 'view', String(parent), '--json', 'state,stateReason,comments']`.
  8. login: `['api', 'user', '--jq', '.login']`, read only when step 7 shows neither `CLOSED` nor `REOPENED` (both uppercased).

  Shapes 7 and 8 run only for a caller that will run **Close the parent below the floor**: the CLI's `--idempotence` flag (Task 3), and `closeBelowFloorParents`, which composes the idempotence gather itself, as it does today.

  A resolution that finds no parent stops after step 1 or 2. Failure wrapping moves verbatim from `closeBelowFloorParents` lines 95-109 into the exported `ghCaller(gh)` → `{ call, callJson }`:
  - a thrown call becomes `GhFailure('gh {first three args}: {message}')`;
  - stdout that does not parse as JSON becomes `GhFailure('gh {first three args}: unparseable output ({message})')`;
  - a `fetchNativeParent` throw that is not already a `GhFailure` becomes `GhFailure('gh api graphql (parent): {message}')`.
- **Enumeration follows the spec (Reading A).** The spec's "through the paginated fetcher" and its Key File "`plugin/bin/fetch-sub-issues.js` — the paginated enumeration to reuse" are met by shape 4: `fetch-sub-issues.js`'s own `run`, in-process, so its probe, page and retry ladder are reused, not re-derived. `stateReason` comes from shape 5. Because the gather is shared, the reconciler's `closeBelowFloorParents` enumerates the same way (Task 2). AC1.1 (more than 30 sub-issues) is proven three ways:
  - 35 numbers in one 4b page (Task 1 gather test, Task 3 CLI test);
  - 120 numbers past the 100 page size: 4b answers `hasNextPage: true`, and 4c's `--paginate` answer lists all 120 (Tasks 1 and 3);
  - 35 entries through `--facts-json` (Task 4).
- **Facts shape.** `gatherGateFacts` and the MCP normalizer both return this one object:
  `{ parent: number|null, parentLabels: string[], subIssues: [{ number, title, state, stateReason, labels: string[], closedBy: number[] }] }`.
  - `subIssues` is ascending.
  - `state` and `stateReason` are uppercased strings (`''` when absent).
  - `title` is `String(title || '').trim()`.
  - `closedBy` holds each `closedByPullRequestsReferences` entry's `number`, in order.
  - With no parent the object is `{ parent: null, parentLabels: [], subIssues: [] }`.

  Idempotence facts: `{ state, stateReason, comments, login }` (gh, MCP) or `{ state, body }` (local-files).
- **Verdict shape** (field names byte-identical in every task, emitted in this key order, exported as `VERDICT_FIELDS`):
  `{ parent, state, exceeds, closeReason, idempotence, maxTier, riskFloor, parentIssue, needs, held, subIssues, skipped }`

  **Spec deviation (additive):** the spec names five fields. Reading B adds `parentIssue`. `maxTier`, `riskFloor`, `subIssues` and `skipped` are the values Close steps 1-3 consume, and `needs` and `held` are what Step 4.0b routes on. Without them, the prose would need a second fetch.
  - `parent`: a number, or `null` when no parent resolves.
  - `state`: `'no-parent' | 'incomplete' | 'gated' | 'resolved' | 'due'`. The last four are `parentGateState`'s own values (`./acceptance`).
  - `exceeds`: `exceedsOversightFloor({ risk: maxTier }, { riskFloor, sizeFloor: null }).exceeds` when `state === 'due'`, else `null`. `sizeFloor` is the literal `null`.
  - `closeReason`: set when `state === 'due' && exceeds === false`, else `null`. It is `'completed'` if any gate sub-issue (after the closing-set override) has `stateReason === 'COMPLETED'`, otherwise `'not planned'`.
  - `idempotence`: set only for a Close-running caller (the CLI's `--idempotence`; `closeBelowFloorParents` always). When `state === 'due' && exceeds === false`, it is the first that applies of:
    1. `'already-closed'` — the parent is `CLOSED`;
    2. `'reopened'` — `stateReason === 'REOPENED'`;
    3. `'close-only'` — a counted comment carries the heading;
    4. `'comment-and-close'`.

    Otherwise, and always without `--idempotence`, it is `null`. Exported as `IDEMPOTENCE_VALUES`, in that order.
  - `maxTier`: `maxRiskTier(subIssues.map((s) => parseRecordFacets(s.labels)))`, or `null` when that is `undefined`. It is computed for every resolved parent.
  - `riskFloor`: the resolved floor string.
  - `parentIssue`: `parentLabels.includes(LABELS.PARENT_ISSUE)`, or `null` when there is no parent. This is Reading B's added field.
  - `needs`: the `parentLabels` entries that start with `needs:`, in label order.
  - `held`: enumerated sub-issue numbers that are in the caller's held/unsettled set, ascending.
  - `subIssues`: one `{ number, title, state, stateReason, pr }` per enumerated sub-issue, ascending. `state` and `stateReason` are the values the gate saw, after the override. `pr` is the merging PR when `inClosingSet && mergingPr`, else the last `closedBy` entry, else `null`. There is no same-repo filter, matching the prose ("the last one when it lists several") and today's code.
  - `skipped`: `untrustedSkipNote(c)` for each comment carrying the heading that was not counted, in comment order. Otherwise `[]`, and always `[]` without `--idempotence`.
- **Closing set.** `evaluateParentGate` takes `closingSet` (default `[]`) and `selfInclude` (default `true`). When `selfInclude && closingSet.includes(n)`, it overrides that enumerated sub-issue to `state: 'CLOSED'`, `stateReason: 'COMPLETED'`. The override never adds sub-issues. The CLI's `--closing` tokens go through `parseClosingTokens`. A token is `N` or `owner/repo#N`.
  - An unqualified `N` is taken as-is and never passes through `sameRepoNumbers`, so it holds under local-files, where `owner`/`repo` are `null`.
  - Only a qualified token is filtered. It is mapped to a `{ number, repository: { name, owner: { login } } }` ref and passed to `plugin/bin/lib/flow/closing-links.js`'s exported `sameRepoNumbers`, which drops a foreign repo case-insensitively (reused, not re-derived).
  - The result is the union of both, de-duplicated and sorted ascending. `--sub-issue N` with no `--closing` defaults to `{N}`, never `{}`. `--parent` with no `--closing` is `{}`.
- **Heading test.** `HEADING_LINE_RE = /^## Closed below the oversight floor\s*$/m` and `isCloseMarkerComment(comment, login)` move from `below-floor-parent-close.js` into `parent-gate.js` unchanged. `below-floor-parent-close.js` re-exports `isCloseMarkerComment`, so its two existing importers keep working: `tests/bin-lib/issues/below-floor-parent-close.test.js` and `_shared/github-pr-scan-acceptance.md:484`'s `node -e` scan. The move is needed: the new core needs the predicate, and importing it from `below-floor-parent-close.js` would create a require cycle once Task 2 makes that file import the core.
- **CLI exit codes (Split-1/2, `fetch-sub-issues.js`'s vocabulary):**
  - `0` — a verdict was printed (every `state`, `no-parent` included);
  - `1` — a malformed invocation, an unreadable or unparseable `--facts-json`, a facts file missing a required key, or a local-files record id the store does not hold;
  - `2` — `gh` absent on the gh path (no `--facts-json`, not `local-files`), or owner/repo unresolvable where it is needed. That is always on the gh path; under `--facts-json`, only when a qualified `--closing` token is present (otherwise no remote is read); and never under `local-files`. Under `--facts-json`, exit 2 can therefore only mean "no GitHub remote for a qualified token", and the prose routes it to fail open, never back to the gh-absent path (Task 6);
  - `3` — a `gh` call failed (a `GhFailure`, whose message goes to stderr), a facts-file entry failed its shape guard (an MCP error recorded as data), or a local-files filesystem error.

  On every non-zero exit nothing goes to stdout. The verdict is data on stdout and is never encoded in the exit code. Only `GhFailure` and `FactsError` map to exit codes; any other throw propagates as a bug (the `cli-wrapper-contract.md` rule against flattening an unrelated bug into a tidy code).
- **Governing skill `gh-api-module-pattern`.** Read `.claude/skills/gh-api-module-pattern/SKILL.md` and `cli-wrapper-contract.md` in full before Task 3. Quoted rules:
  - "Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see."
  - "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw … is try/caught into the documented exit-code contract"
  - "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe."
  - "Every malformed-input class must actually reach its malformed code — `Number('') === 0` passes `Number.isInteger`, so validate positivity and pair-structure explicitly."
  - "A value-taking flag given as the last argv element reads `undefined` … Validate the value inside `parseArgs` … and pin both the trailing bare flag and the empty-string value with their own test cases."
  - "**`GH_TIMEOUT_MS` is a resolved value, not a literal — import it, never retype its default at a new call site.**" The CLI's runner is `execFileSync('gh', args, { encoding: 'utf8', timeout: GH_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })`, with every key literal in that one options object.
  - "A CLI that replaces a prose procedure inherits every guard the reader's view of the data used to enforce — inventory them before writing it." The inventory for this CLI:
    - "already `CLOSED`" → `already-closed`
    - "`stateReason` is `REOPENED`" → `reopened`
    - "counting only a comment from a trusted author … or from the current `gh` identity" → `close-only`
    - "The set overrides state; it never adds sub-issues" → the `closing set never adds sub-issues` test
    - "default to `{the sub-issue in hand}`, never `{}`" → the `--sub-issue without --closing` test
    - "a sub-issue missing `risk` … fails closed as `unscored`" → the `unscored sibling` test
    - Step 4.0b's held parents → `held`
  - "A `gh`-absent caller hands the CLI already-fetched records as a file; the CLI never tries to reach MCP itself … That path makes **zero** `gh` calls and never probes for `gh`."
- **Governing skill `mcp-agent-fetch-node-compute`** (Task 4). Read `.claude/skills/mcp-agent-fetch-node-compute/SKILL.md` in full. Quoted rules:
  - Rule 1: "**Inject the reader, do not branch the computation.** The gh branch and the MCP branch call the same function; only the data source differs" — both sources return the one facts shape above, and both feed `evaluateParentGate`/`evaluateIdempotence`.
  - Rule 3: "**Validate the shape of every agent-written entry.** … Map such an entry to `{failure}`, never to content" — a failed guard is exit 3, never a verdict.
  - Rule 8: "**Widen the handoff shape with every field the compute reads.**" — the facts keys are an exported `FACTS_KEYS`, and Task 6 pins them in the prose.
  - Rule 9: "Normalise a differing field spelling once, at the pull boundary, and make the step a no-op on the other transport's shape."
  - Rule 10: "**Normalise enum values and label shape, not only key spelling, before a predicate that matches `gh`'s exactly.**"
- **Governing skill `skill-prose-conformance-tests`** (Task 6). Quoted rules:
  - "copy the pinned literal out of the edit's own replacement text, never from memory of what that edit says."
  - "**Retargeting existing pins: diff the assertion inventory, not the plan's prose anchor list.** … enumerate every assertion literal in the *replaced* tests and give each one an explicit verdict — moved, retargeted (naming the new literal), or retired (with its own stated reason)."
  - "Prove the assertion can go red before trusting its green"
- **Repo-wide scans the new files must pass** (each runs over `plugin/bin/**`):
  - `tests/windows-hide-spawn-conformance.test.js`.
  - `tests/bin-lib/exit-code-conformance.test.js`.
  - `tests/path-guard-conformance.test.js`: no `fs.existsSync` in a new `plugin/bin/lib/` file. Read files directly, with `ENOENT` caught.
  - `tests/accept-label-reader-conformance.test.js` (AC3.3). A `demo:` literal or a `DEMO_PENDING`/`DEMO_APPROVED`/`DEMO_CHANGES_REQUESTED` name anywhere in a new module's code fails the walk. The local-files acceptance translation therefore maps `facets.acceptance` through `LABELS.ACCEPT_PENDING`/`ACCEPT_APPROVED`/`ACCEPT_CHANGES_REQUESTED` (`dispositionState` reads both spellings), never `'demo:' + acceptance`.
  - `tests/bin-lib/repo-resolve.test.js`: `gh --version` lives only in `repo-resolve.js`, so call its `ghAvailable`.
- **`tests/bin-lib/issues/below-floor-parent-close.test.js` and `tests/bin-lib/reconcile/post-merge.test.js` allow exactly one kind of edit.** They are Task 2's equivalence proof. The only permitted change is to retarget their fake gh's enumeration answers, and any assertion that pins the enumeration calls, to shape 4's new calls (4a-4c). Every other line and assertion stays byte-identical. If anything else goes red, the refactor changed behavior: fix the code, not the test. The permitted lines, verified against today's files:
  - `below-floor-parent-close.test.js:97-103`: the fake's `api graphql` branch and its shape-4 REST line. The graphql branch dispatches on `args[3]`:
    - a query starting `query={ __type` → `{ data: { __type: { fields: [{ name: 'subIssues' }] } } }`;
    - a query containing `subIssues(first:100)` → `{ data: { repository: { [`i${p}`]: { number: p, subIssues: { nodes: subs.map((number) => ({ number })), pageInfo: { hasNextPage: false } } } } } }` from `world.subs`;
    - any other query → the existing parent answer, unchanged.

    The REST line stays as the 4c answer.
  - `below-floor-parent-close.test.js:298`: `calls.filter((c) => c.args[0] === 'api' && c.args[1] === 'graphql').length, 2`. The enumeration's 4a and 4b calls now raise that count to 4. It is retargeted to count only parent-resolution queries (`… && c.args[3].includes('parent{')`), which keeps its "one resolution per closing record" meaning at `2`.
  - `post-merge.test.js:889-893`: the e2e fake's `api graphql` branch and its shape-4 REST line, retargeted the same way, with parent `100` and sub-issues `[101, 102]`.

  Task 2's commit body lists each changed fixture line, old and new.
- **Prose size rail:** `plugin/bin/lib/skill-audit/budgets.js`'s `RAIL_BYTES` is 52,500. `verification-brief-parent-gate.md` is 39,786 bytes today, so check `wc -c` after Task 6. The fences that go should leave it at or under today's size.
- **Commits:** subject `{Verb} {what} — refs #4603` (never `closes`/`fixes`), body ending with the line `Claude-Session: https://claude.ai/code/session_01Ngy9oZcZMUZBwcH7sESiVq`. Run git as `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4603" …`, one plain command per Bash call. Never `git stash`.
- **Scope and edit discipline:** "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- **Test runs:** targeted suites only (`node --test <file> …`); the full suite runs centrally. Quote the raw `# pass`/`# fail` lines in each task report. `node --test` silently skips a path that does not exist when other paths are given, and exits 0 if those pass. Probed on 2026-10-31: a missing `parent-gate.test.js` beside `below-floor-parent-close.test.js` gave `# fail 0`, exit 0. So each Step 2 `Expected: FAIL` command names only the file or files under test, and every PASS run checks that its `# pass` count includes the new file's tests.

## Review Focus

1. **One implementation, unchanged reconciler outcomes.** After Task 2, `tests/bin-lib/issues/below-floor-parent-close.test.js` and `tests/bin-lib/reconcile/post-merge.test.js` pass. `git diff f1304718d -- <both>` touches only the enumeration fixture lines Global Constraints lists. `below-floor-parent-close.js` no longer requires `./acceptance`, `./oversight-floor`, `./native-dependencies` or `./comment-trust`, and it enumerates through `fetch-sub-issues.js`. Pinned in Task 2.
2. **A just-merged sub-issue still reads `OPEN`.** Expected: as a `--closing` member it counts `CLOSED` and `COMPLETED`, and the gate reads `due`. Pinned in Task 1 (`closing member counts CLOSED and completed`) and Task 3.
3. **A planted heading from an untrusted commenter.** Expected: `comment-and-close`, with that comment named in `skipped`. Pinned in Task 1.
4. **An unscored sibling** (no `risk:*`). Expected: `maxTier: null`, `exceeds: true`, no close. Pinned in Task 1.
5. **A `gh` failure mid-gather** (one sub-issue view throws). Expected: exit 3, nothing on stdout, stderr naming `issue view 12`, so the prose fails open. Pinned in Task 3.
6. **An MCP read error the agent wrote as data** (`{ "message": "Not Found" }` as a sub-issue entry). Expected: exit 3, never a verdict. Lowercase MCP states give the same verdict as the gh path. Pinned in Task 4.
7. **The pin inventory.** Every pin retired in Task 6 names the unit test that now covers its behavior. No `#4602` transport pin is retired without its literal staying in the Transport paragraph. Pinned in Task 6's commit body.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1: CLI; resolve via native or `Parent: #N`; paginated enumeration with `stateReason`; self-inclusion; floor; JSON verdict `{parent, state, exceeds, closeReason, idempotence}` (+ `parentIssue`, Reading B) | Tasks 1, 3, 4, 5 |
| Deliverable 1 "through the paginated fetcher" / Key File `fetch-sub-issues.js` (reused in-process as shape 4, Reading A; the reconciler shares it) | Tasks 1, 2, 3 |
| Deliverable 2 (prose calls the CLI; routing) | Task 6 |
| Deliverable 2 "keeping prose only for routing the verdict" — **deviation**: Resolve/Enumerate/Self-inclusion/Evaluate keep their headings and one-line rule statements. Other files cite them by name (tidy, `verification-brief.md`, `docs/skill-graph.md`, Step 4.0b), and callers size `$CLOSING_SUB_ISSUES` from the Self-inclusion table. Every fetch and compute instruction goes. | Task 6 |
| Verdict carries fields beyond the spec's five — **deviation** (additive, Global Constraints) | Tasks 1, 3 |
| AC1.1 (> 30 sub-issues) | Tasks 1 and 3: 35 numbers in one fetcher page; 120 numbers past the 100 page size, through the `--resolve-retries` `--paginate` ladder. Task 4: 35 facts-json entries. |
| AC1.2 (all closed not-planned) | Tasks 1, 3, 4, 5 |
| AC1.3 (cross-repo closing reference) | Tasks 1, 3 |
| AC1.4 (human-reopened parent) | Tasks 1, 3, 4 |
| AC1.5 (parent without `parent-issue`) | Tasks 1, 3 (`parentIssue: false`) + Task 6 (Step 4.0b's no-op routing) |
| AC1.6 (each case gets the prose's verdict) | Tasks 1-5. Task 4's gh-vs-facts equivalence test runs each case through both sources. |
| AC2.1 (`issues/$PARENT_NUM/sub_issues` gone from the gate file) | Task 6 |
| Key File `acceptance.js` (`parentGateState`, reused) | Task 1 (waived, read only) |
| Key File `pr-first-merge-post-merge.md` Step 4.0b (a caller) | Task 6 |

---

### Task 1: Shared gate core

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/parent-gate.js`
- Test: `tests/bin-lib/issues/parent-gate.test.js`
- Modify: `plugin/bin/fetch-sub-issues.js` — the only change is to export `EXIT_SUBISSUES_UNAVAILABLE = 4` beside `run` and use it in its own `return 4`. Its argv, output and other exit codes stay byte-identical, so `tests/fetch-sub-issues-cli.test.js` passes unchanged. The gather consumes its `run` in-process (shape 4) and treats it as a read-only interface.
- Waived `plugin/bin/lib/issues/acceptance.js`: read only. `parentGateState` is reused unchanged.
- Waived `plugin/bin/lib/issues/oversight-floor.js`, `comment-trust.js`, `record-vocabulary.js`, `native-dependencies.js`, `plugin/bin/lib/flow/closing-links.js`: read only. Their exports are reused unchanged.

**Interfaces:**
- Consumes:
  - `parentGateState` (`./acceptance`);
  - `maxRiskTier`, `exceedsOversightFloor` (`./oversight-floor`);
  - `parseRecordFacets`, `normalizeLabelNames`, `LABELS` (`./record-vocabulary`);
  - `isTrustedComment`, `untrustedSkipNote` (`./comment-trust`);
  - `fetchNativeParent` (`./native-dependencies`);
  - `parseSubIssues` (`./record`);
  - `sameRepoNumbers` (`../flow/closing-links`);
  - `POLICY_KEYS` (`../policy-schema`);
  - `run`, `EXIT_SUBISSUES_UNAVAILABLE` (`../../fetch-sub-issues`; shape 4).
- Produces (all exported):
  - `CLOSE_HEADING` (`'## Closed below the oversight floor'`), `HEADING_LINE_RE`, `isCloseMarkerComment(comment, login)`, all moved verbatim (Global Constraints).
  - `VALID_RISK_FLOORS` (the policy schema's `risk-floor` values), `VERDICT_FIELDS`, `IDEMPOTENCE_VALUES`.
  - `class GhFailure extends Error`; `ghCaller(gh) -> { call(args, input), callJson(args) }`.
  - `resolveParent({ subIssue, owner, repo, workLinks, caller }) -> number|null` — shape 1 or 2.
  - `enumerateSubIssues({ parent, owner, repo, workLinks, caller }) -> number[]`, ascending: shape 3 for body-text, or shape 4 (4a-4c, or 4d on exit 4) for native.
  - `gatherGateFacts({ subIssue, parent, owner, repo, workLinks, caller }) -> facts`. Exactly one of `subIssue`/`parent` is given. Shapes 1-6, in order. It returns early with no parent.
  - `gatherIdempotenceFacts({ parent, caller }) -> { state, stateReason, comments, login }` — shapes 7 and 8. `login` is `null` when shape 8 is not read. `comments` is `[]` when the field is not an array.
  - `evaluateParentGate({ parent, parentLabels, subIssues, closingSet = [], selfInclude = true, held = [], mergingPr = null, riskFloor }) -> verdict`. It is pure. It throws a `TypeError` when `riskFloor` is not in `VALID_RISK_FLOORS`, because a `null` floor would switch the unscored check off. With `parent == null` it returns the `no-parent` verdict: `parentIssue: null`, `exceeds`/`closeReason`/`idempotence`/`maxTier` `null`, and `needs`/`held`/`subIssues`/`skipped` `[]`. It always returns `idempotence: null` and `skipped: []`, and the caller fills them from `evaluateIdempotence`.
  - `evaluateIdempotence(facts) -> { idempotence, skipped }`. It is pure.
    - With `typeof facts.body === 'string'` (local-files), it reads `already-closed` when `facts.state === 'CLOSED'`, `close-only` when `HEADING_LINE_RE` matches the body, else `comment-and-close`, and ignores comments and login.
    - Otherwise it follows `closeBelowFloorParents` lines 192-207. A heading comment that `isCloseMarkerComment` counts makes `close-only`. Every other comment carrying the heading adds `untrustedSkipNote(comment)` to `skipped`. A note is added even when a counted comment also exists.
  - `parseClosingTokens(tokens: string[], { owner, repo }) -> { numbers: number[] } | { error: string }`.
    - A token is `N` or `owner/repo#N` (`/^\d+$/` or `/^([^/\s#]+)\/([^/\s#]+)#(\d+)$/`), with `N` a positive integer.
    - It returns `{ error }` for anything else, `0`, `''`, `#5` and `a/b#x` included, and for a qualified token when `owner` is `null` (local-files).
    - An unqualified `N` is kept as-is, never passed through `sameRepoNumbers`. Only qualified tokens are filtered through `sameRepoNumbers`. It returns the union, de-duplicated and sorted ascending.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/parent-gate.test.js`. Style follows `tests/bin-lib/issues/below-floor-parent-close.test.js`.
  - A `makeGh(world)` fake answers by exact argv: the eight shapes, with 4a/4b told apart from shape 2 by `args[3]` (`query={ __type`, `subIssues(first:100)`, `parent{`), and owner/repo `o/r`. It records `{ args }` for every call and throws `unexpected gh call: …` on anything else.
  - A `facts()` helper builds parent `10`, labels `['parent-issue']`, and two `CLOSED`/`COMPLETED` sub-issues `11` and `12` labelled `['risk:low']` with `closedBy: []`. `riskFloor` is `'high'`.

  Tests:
  - `AC1.2: all sub-issues closed not-planned close the parent as not planned` — both `NOT_PLANNED` → `{ state: 'due', exceeds: false, closeReason: 'not planned' }`.
  - `AC1.2: one completed sub-issue closes the parent completed` — `#11` `NOT_PLANNED`, `#12` `COMPLETED` → `closeReason: 'completed'`.
  - `closing member counts CLOSED and completed` — `#12` `OPEN`/`''`, `#11` `NOT_PLANNED`, `closingSet: [12]` → `state: 'due'`, `closeReason: 'completed'`, `subIssues[1]` `{ state: 'CLOSED', stateReason: 'COMPLETED' }`.
  - `selfInclude: false judges a closing member by its live state` — same input plus `selfInclude: false` → `state: 'incomplete'`.
  - `closing set never adds sub-issues` — `closingSet: [99]`, `#12` `OPEN` → `state: 'incomplete'`, `subIssues.length === 2`.
  - `AC1.5: a parent without parent-issue is reported, not skipped` — `parentLabels: ['needs:decision']` → `parentIssue: false`, `needs: ['needs:decision']`, `state: 'due'` (the field is reported, the routing stays in prose).
  - `unscored sibling fails closed` — `#12` labels `[]` → `maxTier: null`, `exceeds: true`, `closeReason: null`.
  - `above-floor risk exceeds` — `#12` `['risk:high']` → `exceeds: true`, `maxTier: 'high'`.
  - `gated and resolved parents are no-ops` — `['parent-issue', 'accept:pending']` → `'gated'`, `['parent-issue', 'demo:approved']` → `'resolved'`, both `exceeds: null`.
  - `held lists enumerated held sub-issues only` — `held: [12, 99]` → `held: [12]`.
  - `pr prefers the merging PR for closing members, else the last reference, else null` — `#11` `closedBy: [5, 7]` → `7`; `#12` in `closingSet`, `mergingPr: 40` → `40`; `#12` with `mergingPr: null`, `closedBy: []` → `null`.
  - `no parent yields the no-parent verdict` — `{ parent: null, parentLabels: [], subIssues: [] }` → `state: 'no-parent'`, every field per Global Constraints.
  - `the verdict carries VERDICT_FIELDS in order` — `Object.keys(verdict)` deep-equals `VERDICT_FIELDS`.
  - `an invalid risk floor throws` — `null`, `undefined`, `''`, `'critical'` each throw.
  - `AC1.4: a human-reopened parent is never re-closed` — `evaluateIdempotence({ state: 'OPEN', stateReason: 'REOPENED', comments: [], login: 'bot' })` → `{ idempotence: 'reopened', skipped: [] }`.
  - `an already-closed parent is a no-op, checked before reopened` — `CLOSED` + `REOPENED` → `'already-closed'`.
  - `trusted heading comment means close only` — `MEMBER` author, body `'intro\n## Closed below the oversight floor\n'` → `'close-only'`, `skipped: []`.
  - `own-login heading comment counts` — `NONE` association, `author.login === login` → `'close-only'`.
  - `untrusted heading comment is skipped and named` — `CONTRIBUTOR`, `url: 'u1'` → `'comment-and-close'`, `skipped.length === 1`, `skipped[0]` includes `'u1'`.
  - `a heading mentioned mid-line does not count` — trusted `'see ## Closed below the oversight floor'` → `'comment-and-close'`.
  - `the local-files body variant ignores comments` — `{ state: 'OPEN', body: 'x\n## Closed below the oversight floor\n', comments: [untrusted heading] }` → `'close-only'`, `skipped: []`; `{ state: 'CLOSED', body: 'x' }` → `'already-closed'`; `{ state: 'OPEN', body: 'x' }` → `'comment-and-close'`.
  - `IDEMPOTENCE_VALUES lists the four values in check order`.
  - `AC1.3: parseClosingTokens drops a cross-repo closing reference` — `(['12', 'other/r#11', 'O/R#13'], { owner: 'o', repo: 'r' })` → `{ numbers: [12, 13] }`. Each of `['0']`, `['']`, `['#5']`, `['a/b#x']` → `{ error }`. `(['o/r#3'], { owner: null, repo: null })` → `{ error }`.
  - `parseClosingTokens keeps an unqualified token with no owner/repo (local-files)` — `(['7'], { owner: null, repo: null })` → `{ numbers: [7] }`.
  - `gatherGateFacts (native, from a sub-issue) makes the call shapes in order` — the recorded argv equals shape 2, 4a, 4b, 5 (#11), 5 (#12), 6 exactly. 4b's query includes `subIssues(first:100)`. The facts equal the expected object (labels as names, `closedBy` numbers, `stateReason` uppercased, `title` trimmed).
  - `AC1.1: 35 sub-issues arrive in one fetcher page` — 4b answers 35 nodes with `hasNextPage: false` → 35 numbers, and no 4c call.
  - `AC1.1: a parent past the 100 page size goes through the --paginate ladder` — 4b answers 100 nodes with `hasNextPage: true`. The 4c `['api', '--paginate', 'repos/o/r/issues/10/sub_issues', '--jq', '.[].number']` answer lists 120 numbers (100-219) → `enumerateSubIssues` returns all 120, and the runner saw 4c exactly once.
  - `the probe's unavailable answer takes the one REST call` — 4a answers `fields: [{ name: 'title' }]` → `fetch-sub-issues` returns `EXIT_SUBISSUES_UNAVAILABLE`, the gather makes 4d once, and there is no 4b call.
  - `a failing fetcher read is a GhFailure naming the fetcher` — 4b throws → `GhFailure` whose message starts `fetch-sub-issues.js exit 3:` and includes the thrown text.
  - `EXIT_SUBISSUES_UNAVAILABLE is 4 and is the code fetch-sub-issues returns for an unavailable field` — run `require('…/fetch-sub-issues').run(['10', '--repo', 'o/r'], deps)` with the unavailable-probe fake → it returns `EXIT_SUBISSUES_UNAVAILABLE`.
  - `gatherGateFacts (body-text) reads the Parent line and the parent's task list` — `#11` body `'Intro\n\nParent: #10\n'`, `#10` body `'- [ ] #11\n- [x] #12\n'` → argv shapes 1, 3, 5, 5, 6; `parent: 10`.
  - `gatherGateFacts with no resolvable parent stops after resolution` — one recorded call; facts `{ parent: null, parentLabels: [], subIssues: [] }`.
  - `gatherGateFacts from a parent skips resolution` — `{ parent: 10 }` → the first call is shape 4a.
  - `a failing or unparseable read throws GhFailure` — shape 5 for `#12` throws → `GhFailure` whose message starts `gh issue view 12:`. Shape 5 returning `'<html>502</html>'` → message matches `/unparseable output/`. A GraphQL answer with no repository → message starts `gh api graphql (parent):`.
  - `gatherIdempotenceFacts reads the login only for an open, non-reopened parent` — `OPEN`/`''` → two calls (shapes 7, 8), `login: 'bot'`; `CLOSED` → one call, `login: null`; `OPEN`/`REOPENED` → one call, `login: null`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/issues/parent-gate'`

- [ ] **Step 3: Implement `plugin/bin/lib/issues/parent-gate.js`** with the exports above.
  - The header comment says the following. This is the one Node implementation of the Parent-Gate Procedure's Resolve / Enumerate / Self-inclusion / Evaluate rules and the below-floor close's idempotence check (#4603). The gathers keep #4599's call shapes, except that native enumeration runs through `fetch-sub-issues.js`'s `run`. `bin/parent-gate.js` and `below-floor-parent-close.js` both compose it. It replaces the prose snippets that #4466's review found eight defects in.
  - Add the `EXIT_SUBISSUES_UNAVAILABLE` export to `fetch-sub-issues.js`. Check that the require does not create a cycle: `fetch-sub-issues.js` requires only `native-dependencies`, `capabilities-probe` and `repo-resolve`.
  - Move `HEADING_LINE_RE`, `isCloseMarkerComment`, `CLOSE_HEADING`, `VALID_RISK_FLOORS`, `GhFailure` and the `call`/`callJson` closures byte-for-byte from `below-floor-parent-close.js`. Leave that file untouched in this task.
  - Order inside `evaluateParentGate`: the no-parent case; the closing-set override; `parentGateState`; `maxTier`; the floor when `due`; `closeReason` when `due && !exceeds`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js tests/bin-lib/issues/acceptance.test.js tests/bin-lib/issues/below-floor-parent-close.test.js tests/fetch-sub-issues-cli.test.js tests/fetch-sub-issues-prose-conformance.test.js tests/path-guard-conformance.test.js tests/accept-label-reader-conformance.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit** the three files: `Add the shared Parent-Gate core — refs #4603`

---

### Task 2: Compose `closeBelowFloorParents` from the core

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/below-floor-parent-close.js`
  - `closeBelowFloorParents` keeps its signature, its `invalid-risk-floor` short-circuit and its per-closing-record loop.
  - Per record, it calls `resolveParent` itself, before the `handled` check, so `two closing records sharing a parent` still makes two parent-resolution GraphQL calls.
  - It then calls `gatherGateFacts({ parent, … })`, then `evaluateParentGate({ ...facts, closingSet, selfInclude, held: unsettled, mergingPr, riskFloor })`.
  - It maps the verdict to the skip order it has today: `!parentIssue` → `not-parent-issue-labeled`, `needs.length` → `needs-label`, `held.length` → `sibling-unsettled`, `state !== 'due'` → `state`, `exceeds` → `above-floor`.
  - Then it calls `gatherIdempotenceFacts` and `evaluateIdempotence`: `already-closed` → `already-closed`, `reopened` → `reopened-by-human`.
  - It composes the comment (skipped only on `close-only`) from `verdict.subIssues`' `number`/`title`/`pr`, and `notPlanned` is `verdict.closeReason === 'not planned'`. It closes with `--reason {closeReason}` and pushes `{ parent, maxTier }` plus `notes` when `skipped` is non-empty.
  - `GhFailure` (imported) still maps to `gh-failed`, anything else to `internal-error`.
  - Keep `composeCloseComment` and `NOT_PLANNED_LINE` here. Re-export `isCloseMarkerComment` and `CLOSE_HEADING` from `./parent-gate`. Drop the now-unused requires.
  - It enumerates through `gatherGateFacts`, so through `fetch-sub-issues.js` (shape 4).
  - It still calls the idempotence gather itself, for every below-floor due parent, as it does today. It has no `--idempotence` opt-in.
  - Rewrite the header comment to say that this file is the reconciler's Step 4.0b driver over `parent-gate.js`'s shared core (the code `bin/parent-gate.js` runs for the prose). Drop "The prose is the source of truth; this file follows its order and skip rules". Keep the `selfInclude: false` / no-`#205`-default / no-default-branch-check paragraphs, which still hold.
- Modify: `plugin/bin/lib/reconcile/post-merge.js:5-7` — the header's "Step 4.0b runs lib/issues/below-floor-parent-close.js. Both stay the prose's mirrors" becomes: Step 4.0b runs `lib/issues/below-floor-parent-close.js` over `lib/issues/parent-gate.js`, the gate code the prose's `bin/parent-gate.js` CLI runs. Step 4.0 stays a `closing-links.js` run. This file only decides WHEN they run and records that they did. Change no code.
- Test: `tests/bin-lib/issues/parent-gate.test.js` (append)
- Modify (enumeration fixtures only): `tests/bin-lib/issues/below-floor-parent-close.test.js:97-103,298` and `tests/bin-lib/reconcile/post-merge.test.js:889-893`. Make exactly the retargets Global Constraints lists. Every other line of both files stays byte-identical, because they are the equivalence proof.

**Interfaces:**
- Consumes: Task 1's exports.
- Produces: `below-floor-parent-close.js` exports, unchanged in name: `CLOSE_HEADING`, `composeCloseComment`, `closeBelowFloorParents`, `isCloseMarkerComment`.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/issues/parent-gate.test.js`):
  - `closeBelowFloorParents composes the shared core (one implementation)`:
    - `require('…/below-floor-parent-close').isCloseMarkerComment` is strictly equal to `require('…/parent-gate').isCloseMarkerComment`, and `CLOSE_HEADING` is equal too.
    - `below-floor-parent-close.js`'s source includes `require('./parent-gate')`.
    - The source includes none of `require('./acceptance')`, `require('./oversight-floor')`, `require('./native-dependencies')`, `require('./comment-trust')`, or the literal `sub_issues`.
  - Then retarget the two suites' enumeration fixtures (Global Constraints). Before the refactor, the retargeted fakes answer calls the old code never makes (4a/4b) and still answer its REST read, so both suites stay green.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js`
Expected: FAIL — the appended test only: the two `isCloseMarkerComment` functions are distinct objects, and the source still requires `./acceptance`. Task 1's tests stay green.

Then, as a separate call, run `node --test tests/bin-lib/issues/below-floor-parent-close.test.js tests/bin-lib/reconcile/post-merge.test.js`. It must still pass under the old code: the retargeted fakes only add answers, and the retargeted count still reads `2`. That shows the fixture edits alone change no outcome.

- [ ] **Step 3: Implement** the refactor and the header edits listed under **Files**.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js tests/bin-lib/issues/below-floor-parent-close.test.js tests/bin-lib/reconcile/post-merge.test.js tests/reconcile.test.js tests/below-floor-parent-close-conformance.test.js tests/accept-label-reader-conformance.test.js tests/fetch-sub-issues-cli.test.js`
Expected: PASS, 0 failures. Then run `git -C "{worktree}" diff f1304718d -- tests/bin-lib/issues/below-floor-parent-close.test.js tests/bin-lib/reconcile/post-merge.test.js`. The output must touch only the lines Global Constraints lists.

- [ ] **Step 5: Commit** the five files: `Compose the reconciler's parent close from the shared gate core — refs #4603`. The body lists each changed fixture line in the two equivalence suites, old and new, and states that every other assertion is byte-identical.

---

### Task 3: `bin/parent-gate.js` CLI (gh)

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/parent-gate.js`
- Test: `tests/parent-gate-cli.test.js` (style: `tests/fetch-sub-issues-cli.test.js`)
- Modify: `docs/plugin-structure.md`
  - Add a CLI line right after `fetch-sub-issues.js`'s (line 224): usage, the verdict fields, the exit codes, and the test file.
  - In the `plugin/bin/lib/issues/` line (29), add `parent-gate.js` (the shared gate core: `evaluateParentGate`, `gatherGateFacts`, `gatherIdempotenceFacts`, `evaluateIdempotence`, `isCloseMarkerComment`; consumed by `bin/parent-gate.js` and `below-floor-parent-close.js`, #4603).
  - Reword `below-floor-parent-close.js`'s entry from "the Node mirror of …" to "the reconciler's Step 4.0b driver over `parent-gate.js`".
- Modify: `docs/reconcile-checks.md:579-586` (`## Post-merge closes (#4599)`). "The prose stays the source of truth; the module only decides when the steps run and records that they did" becomes: Step 4.0b's gate is `lib/issues/parent-gate.js`, the same code the prose runs through `bin/parent-gate.js` (#4603). The module only decides when the steps run and records that they did.
- Modify: `.claude/skills/prose-code-twin-pin/SKILL.md:253-258` (the `**Behavior-twin instance (#4599):**` paragraph). Say that since #4603 the gate's evaluation is one shared module (`plugin/bin/lib/issues/parent-gate.js`) that the prose's CLI and the reconciler both run, so the behavior twin shrinks to the close's composer. Keep the three bullets below it, which still hold.

**Interfaces:**
- Consumes: Task 1's exports (its gather already reaches `plugin/bin/fetch-sub-issues.js`'s `run` as a read-only interface); `parseRepo`, `ghAvailable`, `remoteUrl` (`./lib/repo-resolve`); `resolvePolicyKeys` (`./lib/policy-schema`); `readWorkBackend` (`./lib/work-backend`); `GH_TIMEOUT_MS` (`./lib/shared-primitives`).
- Produces: `run(argv, deps) -> exitCode`, `parseArgs(argv)`, `USAGE`. Usage:
  `parent-gate.js (--sub-issue <n> | --parent <n>) [--closing <tok>[,<tok>…]] [--held <n>[,<n>…]] [--merging-pr <n>] [--idempotence] [--work-links native|body-text] [--risk-floor low|medium|high|always] [--facts-json <file>] [--backend github-issues|local-files] [--records-dir <dir>] [--help]`
  - Exactly one of `--sub-issue`/`--parent`.
  - `--idempotence` is a boolean flag, passed only by a caller that will run **Close the parent below the floor**: Step 4.0b, tidy's parent-side entry, and a sub-issue-side entry under `local-files`. Without it, `idempotence` stays `null` and `skipped` stays `[]`, and no shape 7 or 8 read happens. Under `--facts-json`, `parentComments`/`me` are then never read or required. Every value flag validates its value in `parseArgs`: a trailing bare flag, `''` or a `--`-prefixed value is exit 1. `--held`/`--merging-pr` take positive integers. `--risk-floor` must be in `VALID_RISK_FLOORS`, and `--work-links` in the policy schema's values.
  - There is **no `--repo` flag**. Owner/repo come from `deps.remoteUrl()` through `parseRepo`, with the `.`/`..` guard copied from `fetch-sub-issues.js:94-97`. The reason: shapes 1, 3, 6 and 7 carry no `--repo`, so they read the repo of `gh`'s cwd. A `--repo` override would split the gate's reads across two repositories.
  - `--work-links`/`--risk-floor` default to `.claude-tweaks/policy.yml` at `deps.repoRoot()` (`git rev-parse --show-toplevel`, else the cwd) through `resolvePolicyKeys(['work-links', 'risk-floor'], { policyRaw: deps.readPolicyRaw(root) })`. That is the same read the prose's `resolve-policy.js --values …` made.
  - `--backend` defaults to `deps.readWorkBackend(root)`: `local-files` → local-files, anything else (`null` included) → `github-issues`. Until Task 5, `local-files` exits 1 with `--backend local-files is not supported yet`. Until Task 4, `--facts-json` is an unknown argument (exit 1).
  - `deps`: `ghAvailable`, `remoteUrl`, `runner`, `repoRoot`, `readPolicyRaw`, `readWorkBackend`, `stdout`, `stderr`. Each one that can throw is try/caught: `remoteUrl` → `null` → exit 2, `repoRoot` → cwd, `readPolicyRaw` → `null`.
  - Flow: parse → `--help` (exit 0, before any probe) → backend → `ghAvailable()` (false → exit 2, stderr names `--facts-json` as the gh-absent route) → owner/repo (else exit 2) → closing set → `gatherGateFacts` → `evaluateParentGate`. When `--idempotence` is given and `state === 'due' && exceeds === false`, it then runs `gatherIdempotenceFacts` → `evaluateIdempotence` → fills `idempotence`/`skipped`. It prints one line: `JSON.stringify` of the verdict in `VERDICT_FIELDS` order, plus `\n`. A `GhFailure` → stderr `parent-gate.js: {message}`, exit 3.

- [ ] **Step 1: Write the failing tests.** A fake runner keyed on argv answers the eight shapes (4a-4c included) from a world fixture (owner/repo `o/r`) and throws on anything else. Base deps: `ghAvailable: () => true`, `remoteUrl: () => 'git@github.com:o/r.git'`, `repoRoot: () => '/repo'`, `readPolicyRaw: () => 'work-links: native\nrisk-floor: high\n'`, `readWorkBackend: () => 'github-issues'`, and capturing `stdout`/`stderr`. Tests:
  - `AC1.1: a parent with more than 30 sub-issues is enumerated in full` — `--parent 10 --idempotence`. 4b answers 35 nodes (100-134, `hasNextPage: false`), all `CLOSED`/`COMPLETED`/`risk:low` except #130 `OPEN`. Expect `state: 'incomplete'`, `subIssues.length === 35`, one 4a call, one 4b call, no 4c, and 35 shape-5 reads. With #130 closed: `state: 'due'`, `exceeds: false`, `closeReason: 'completed'`, `idempotence: 'comment-and-close'`.
  - `AC1.1: a parent past the fetcher's 100 page size is enumerated through --paginate` — `--parent 10`. 4b answers 100 nodes with `hasNextPage: true`; 4c answers 120 numbers (100-219), all closed. Expect `subIssues.length === 120` and the runner saw `['api', '--paginate', 'repos/o/r/issues/10/sub_issues', '--jq', '.[].number']` exactly once.
  - `without --idempotence the verdict reads no comments and no login` — the same due, below-floor world without the flag → `idempotence: null`, `skipped: []`, and the runner never saw shape 7 or 8.
  - `AC1.2: all closed not-planned` — `--parent 10`, #11 and #12 `NOT_PLANNED` → `closeReason: 'not planned'`. `--sub-issue 11 --closing 11` with #11 `OPEN` and #12 `NOT_PLANNED` → `closeReason: 'completed'` (a closing member).
  - `AC1.3: a cross-repo closing token does not close this repo's sub-issue` — `--sub-issue 12 --closing other/r#11,12`, #11 `OPEN` → `state: 'incomplete'`.
  - `AC1.4: a human-reopened parent` — `--parent 10 --idempotence`, and shape 7 answers `OPEN`/`REOPENED` → `idempotence: 'reopened'`, and the runner never sees shape 8.
  - `AC1.5: a parent without parent-issue` — shape 6 answers `[]` → `parentIssue: false`, `state: 'due'`, exit 0.
  - `body-text resolves Parent: #N and the parent's task list` — `--work-links body-text` → `parent: 10`, `subIssues.length === 2`, and no GraphQL call.
  - `no resolvable parent prints no-parent` — native parent `null` → `{ parent: null, state: 'no-parent' }`, exit 0, one runner call.
  - `--sub-issue without --closing counts itself closed` — #11 `OPEN`, #12 `CLOSED` → `state: 'due'`.
  - `--held and --merging-pr reach the verdict` — `--sub-issue 11 --held 12 --merging-pr 40` → `held: [12]`, `subIssues[0].pr === 40`.
  - `the policy file supplies the floor and work-links; flags override` — `readPolicyRaw` `risk-floor: low` → `exceeds: true` for `risk:low` sub-issues. Adding `--risk-floor high` → `exceeds: false`.
  - `stdout is one JSON line in VERDICT_FIELDS order`.
  - exit codes:
    - exit 1, with nothing on stdout: no args; both selectors; `--sub-issue 0`; a trailing bare `--sub-issue`; `--closing ''`; `--closing a/b#x`; `--held x`; `--idempotence yes` (the flag takes no value, so `yes` is a stray positional); `--risk-floor bogus`; `--work-links bogus`; `--repo o/r`; an unknown flag.
    - exit 2: `ghAvailable: () => false`, with stderr naming `--facts-json`. Also exit 2: `remoteUrl` throws.
    - exit 3: the shape-5 read for #12 throws, with empty stdout and stderr including `issue view 12`.
    - exit 0: `--help`, with stdout `USAGE`, before `ghAvailable` is called (a `ghAvailable` that throws if called).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/parent-gate-cli.test.js`
Expected: FAIL — `Cannot find module '../plugin/bin/parent-gate'`

- [ ] **Step 3: Implement `plugin/bin/parent-gate.js`.**
  - Header comment: the usage, the verdict fields, the exit codes, and why there is no `--repo` flag.
  - Real deps: the runner from Global Constraints; `repoRoot` as `execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim()`; `readPolicyRaw` reading `{root}/.claude-tweaks/policy.yml` with `ENOENT` → `null`.
  - The `require.main === module` guard sets `process.exitCode = run(process.argv.slice(2), realDeps)`.
  - Add the two `docs/plugin-structure.md` edits, the `docs/reconcile-checks.md` sentence and the `prose-code-twin-pin` paragraph.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/parent-gate-cli.test.js tests/bin-lib/issues/parent-gate.test.js tests/fetch-sub-issues-cli.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/bin-lib/repo-resolve.test.js tests/accept-label-reader-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Real-input probe.** These runs go through the real fetcher: shape 4a, then 4b. No probe parent has more than 100 sub-issues, so 4c does not run. Run each line from the worktree as its own Bash call and record each printed line in the task report. These values were verified live on 2026-10-31 (`gh issue view`, `gh api --paginate …/sub_issues`, `fetchNativeParent`, and `node plugin/bin/fetch-sub-issues.js 3374 3972 4603 --resolve-retries`). A mismatch is a defect to fix before committing, not a number to adjust. If live state has since moved (for example, #3972's open sub-issues closed), re-derive the expectation from `fetch-sub-issues.js` and `gh issue view` and name the change.
  - `node plugin/bin/parent-gate.js --parent 3374`
    - The parent is `CLOSED`/`COMPLETED`, with labels `parent-issue`, `demo:approved` and `demo:approved-batch`.
    - It has 8 sub-issues: `[3375, 3376, 3377, 3378, 3379, 3380, 3381, 3386]`. All read `CLOSED` except #3381.
    - Expect `state: 'resolved'` (the disposition label wins over the open #3381), `parentIssue: true`, `exceeds: null`, `idempotence: null`, `subIssues.length === 8`.
  - `node plugin/bin/parent-gate.js --sub-issue 3375` — the native parent of #3375 is #3374. Expect `parent: 3374`, `state: 'resolved'`.
  - `node plugin/bin/parent-gate.js --parent 3972`
    - The parent is `OPEN`, labelled `parent-issue`, with no disposition.
    - It has 7 sub-issues `[3973 … 3979]`. #3973 and #3979 are closed completed; #3974-#3978 are open, all `risk:medium` except #3979, which carries no `risk:*`.
    - Expect `state: 'incomplete'`, `parentIssue: true`, `needs: []`, `subIssues.length === 7`, `maxTier: null` (#3979 is unscored).
  - `node plugin/bin/parent-gate.js --sub-issue 3974 --closing 3974` — the parent is #3972 and the other four sub-issues are still open. Expect `parent: 3972`, `state: 'incomplete'`, and `subIssues[1]` (#3974) `{ state: 'CLOSED', stateReason: 'COMPLETED' }`.
  - `node plugin/bin/parent-gate.js --sub-issue 4603` — #4603 has no native parent (`fetchNativeParent` → `null`). Expect `state: 'no-parent'`, exit 0.

- [ ] **Step 6: Commit** the five files: `Add bin/parent-gate.js — the Parent-Gate Procedure's gather and evaluate as one CLI — refs #4603`

---

### Task 4: `--facts-json` — the gh-absent MCP fact source

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/mcp-parent-gate-shape.js`
- Test: `tests/bin-lib/issues/mcp-parent-gate-shape.test.js`
- Modify: `plugin/bin/parent-gate.js`
- Test: `tests/parent-gate-cli.test.js` (append)
- Modify: `.claude/skills/mcp-agent-fetch-node-compute/SKILL.md`
  - Add an Instances row: `bin/parent-gate.js --facts-json <path>` (#4603), driven by `wrap-up/verification-brief-parent-gate.md`'s Transport paragraph. The agent fetches `issue_read` `get_parent`/`get_sub_issues`/`get`/`get_comments` and `get_me`, written unreshaped. The compute is `normalizeMcpFacts`, then the same `evaluateParentGate`/`evaluateIdempotence` the gh path runs.
  - Rule 10's last sentence currently says the agent uppercases and the Transport paragraph states the mapping. It becomes: since #4603 `mcp-parent-gate-shape.js` does that normalization in Node, and the Transport paragraph names it.

**Interfaces:**
- Produces (`mcp-parent-gate-shape.js`, pure, no I/O):
  - `FACTS_KEYS = ['parentLink', 'subIssueGet', 'subIssueList', 'parentGet', 'subIssueGets', 'parentComments', 'me']`. Each key holds one MCP result written unreshaped:
    - `parentLink` — `issue_read` `get_parent` of the sub-issue in hand, or `null` when it has none. Native, sub-issue-side entry only.
    - `subIssueGet` — `issue_read` `get` of the sub-issue in hand. Body-text, sub-issue-side entry only.
    - `subIssueList` — every `get_sub_issues` entry, all pages concatenated. Native only.
    - `parentGet` — `issue_read` `get` of the parent.
    - `subIssueGets` — `{ "<n>": issue_read get of n }`, with exactly one key per enumerated number.
    - `parentComments` — every `get_comments` entry of the parent, all pages concatenated.
    - `me` — `get_me`'s result.
  - `class FactsError extends Error` with `exit` (`1` or `3`) and `key` (the offending entry, for example `subIssueGets.12`).
  - `normalizeMcpFacts(raw, { subIssue, parent, workLinks }) -> { gate, idempotence }`.
    - `gate` is the facts shape (Global Constraints).
    - `idempotence` is `{ state, stateReason, comments, login }`. `comments` and `login` are `undefined` when their keys are absent.
    - It throws `FactsError`:
      - exit 1 for a top level that is not a plain object;
      - exit 1 for a required key that is absent, or a `subIssueGets` key set that is not exactly the enumerated numbers (a key missing or unrequested);
      - exit 3 for a present entry that fails its guard.

    The guards:
    - `parentLink` is `null` or a plain object with a positive-integer `number`.
    - `subIssueGet`/`parentGet` are plain objects whose `number` equals the expected number and whose `state` is a string. `body` is a string when body-text needs it.
    - `labels` is an array of strings or `{ name: string }`.
    - `subIssueList` is an array whose entries carry a positive-integer `number`.
    - `parentComments` is an array of plain objects with a string `body`.
    - `me` is a plain object with a non-empty string `login`.

    So an MCP error object (`{ message: 'Not Found' }`) or a wrapper written as data is exit 3, never content.

    Normalization (rules 9 and 10), a no-op on a gh-shaped entry:
    - `state` and `stateReason ?? state_reason` are uppercased (`null` → `''`).
    - Label objects become names.
    - `title` is trimmed.
    - `closedBy` comes from `closedByPullRequestsReferences`, or from `closed_by_pull_requests` given either as an array of `{ number }` or as `{ references: [{ number }] }` (the `_shared/github-write-transport.md:27` row). It is `[]` when absent; any other shape fails the guard (exit 3).
    - Each comment becomes `{ body, author: c.author || { login: c.user && c.user.login }, authorAssociation: c.authorAssociation || c.author_association, url: c.url || c.html_url }`.
    - Body-text resolution and enumeration reuse `/^Parent: #(\d+)/m` and `parseSubIssues`, the same as the gh gather.
- CLI:
  - `--facts-json <file>` reads the file with `deps.readFile`. A read error or a JSON parse failure is exit 1. It never calls `deps.ghAvailable` or `deps.runner`.
  - Owner/repo are resolved only when a qualified `--closing` token is present. In that case they come from `deps.remoteUrl()` (a git read, not `gh`), and an unresolvable remote is exit 2. Otherwise `deps.remoteUrl` is never called, because unqualified tokens skip `sameRepoNumbers` (Global Constraints).
  - `parentComments` and `me` are read only under `--idempotence`. With the flag, when `state === 'due' && exceeds === false` and the parent reads neither `CLOSED` nor `REOPENED`, a missing `parentComments` or `me` is exit 1, with stderr naming the key. Without the flag, both keys are ignored when present and never required.
  - `--facts-json` together with `--backend local-files` is exit 1.
  - `FactsError` → stderr `parent-gate.js: facts file {key}: {message}`, exit `err.exit`.
  - `deps` gains `readFile`.

- [ ] **Step 1: Write the failing tests.**
  - In `tests/bin-lib/issues/mcp-parent-gate-shape.test.js`:
    - `normalizes the MCP shape` — lowercase `closed`/`not_planned`/`reopened` become `CLOSED`/`NOT_PLANNED`/`REOPENED`; label objects become names; both `closed_by_pull_requests` forms become numbers; `user.login` → `author.login`; `author_association` → `authorAssociation`; `html_url` → `url`.
    - `is a no-op on a gh-shaped entry` — a gh-shaped input normalizes to the same facts as its MCP twin.
    - `an error object recorded as data is exit 3, named` — `subIssueGets['12'] = { message: 'Not Found' }` → `FactsError`, `exit === 3`, `key === 'subIssueGets.12'`. Same for a `parentGet` whose `number` does not match, a `subIssueList` entry with no `number`, a non-array `parentComments`, and a `me` with no `login`.
    - `a missing or unrequested key is exit 1` — `subIssueGets` lacking an enumerated number; holding an extra number; `parentGet` absent; top level `null` or `[]`.
    - `FACTS_KEYS lists the seven keys`.
  - Appended to `tests/parent-gate-cli.test.js`, with a `writeFacts(obj)` helper writing to a `t.after`-cleaned temp dir:
    - `AC1.1 (facts-json): 35 sub-issues through the MCP shape` — `subIssueList` holds 35 entries, all lowercase `closed`/`completed` except one `open` → `state: 'incomplete'`, `subIssues.length === 35`.
    - `AC1.6: the gh path and the facts-json path give the same verdict` — for each AC1.2-AC1.5 world, run with `--idempotence`. The verdict printed through the fake gh runner deep-equals the one printed through the same world rendered as an MCP facts file (lowercase enums, label objects, snake_case comments).
    - `--facts-json makes no gh call and never probes gh` — `ghAvailable` and `runner` both throw if called; exit 0.
    - `--facts-json reads no remote without a qualified closing token` — `remoteUrl` throws if called, with `--sub-issue 11 --closing 11,12` → exit 0. With `--closing other/r#11,12` and `remoteUrl` throwing → exit 2, stdout empty.
    - `a parent that reads closed needs no comments or me` — `--idempotence`, `parentGet.state: 'closed'`, no `parentComments`/`me` → exit 0, `idempotence: 'already-closed'`.
    - `an open below-floor parent without comments or me is exit 1 under --idempotence` — stderr names `parentComments`, stdout empty.
    - `without --idempotence the facts file needs no comments or me` — the same open, below-floor world without `parentComments`/`me` and without the flag → exit 0, `idempotence: null`, `skipped: []`.
    - `an unreadable or non-JSON facts file is exit 1; an error-object entry is exit 3` — stdout empty in each case.
    - `--facts-json with --backend local-files is exit 1`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/mcp-parent-gate-shape.test.js tests/parent-gate-cli.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/issues/mcp-parent-gate-shape'`. In `tests/parent-gate-cli.test.js`, only the appended tests fail (`--facts-json` is an unknown argument, exit 1). Task 3's tests stay green.

- [ ] **Step 3: Implement** the module, the CLI branch and the skill-doc edit. Then prove the guard red: temporarily make the `subIssueGets` guard accept any object, run `node --test tests/bin-lib/issues/mcp-parent-gate-shape.test.js`, see `an error object recorded as data is exit 3, named` fail, and restore the guard. This is a scratch check and is not committed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/mcp-parent-gate-shape.test.js tests/parent-gate-cli.test.js tests/bin-lib/issues/parent-gate.test.js tests/path-guard-conformance.test.js tests/accept-label-reader-conformance.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit** the five files: `Teach bin/parent-gate.js the gh-absent facts file — refs #4603`

---

### Task 5: `--backend local-files`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/parent-gate.js`
- Test: `tests/parent-gate-cli.test.js` (append)
- Modify: `docs/plugin-structure.md` — the CLI line (Task 3) gains `--facts-json` and `--backend local-files`. The `plugin/bin/lib/issues/` line gains `mcp-parent-gate-shape.js` (`normalizeMcpFacts`, `FACTS_KEYS`; consumed by `bin/parent-gate.js --facts-json`, #4603).

**Interfaces:**
- Consumes: `queryRecords`, `DEFAULT_DIR` (`./lib/issues/local-store`); `LABELS` (`./lib/issues/record-vocabulary`).
- Produces: `--backend local-files [--records-dir <dir>]`.
  - The records dir defaults to `DEFAULT_DIR`, resolved against `deps.repoRoot()`.
  - It makes no `gh` call and no `ghAvailable` or `remoteUrl` call. Closing tokens must be plain ids: `parseClosingTokens(tokens, { owner: null, repo: null })`, so a qualified token is exit 1 and an unqualified one is kept.
  - `--sub-issue N`: the sub-issue record is the open+closed listing entry with `id === N` (exit 1 when absent). Its parent is `facets.parent`: `null` → `no-parent`; set but unknown to the store → exit 1.
  - `--parent N`: the parent is the record in the open+closed listing (`queryRecords(dir, {})` plus `queryRecords(dir, { closed: true })`) with `id === N`. An absent id is exit 1. A record without `isParentIssue: true` still gets a verdict, with `parentIssue: false`. Tidy's parent-side caller behavior is unchanged: its Shape 7 scan only hands over `is-parent-issue: true` records, and the parent-side entry routes on `state`/`exceeds`, not `parentIssue`.
  - Gate facts:
    - `subIssues` is `[...queryRecords(dir, { parent }), ...queryRecords(dir, { parent, closed: true })]` mapped to `{ number: r.id, title: r.title, state: r.facets.closed ? 'CLOSED' : 'OPEN', stateReason: r.facets.closed ? (r.facets.notPlanned ? 'NOT_PLANNED' : 'COMPLETED') : '', labels: r.facets.risk ? ['risk:' + r.facets.risk] : [], closedBy: [] }`.
    - `parentLabels` is `LABELS.PARENT_ISSUE` when `facets.isParentIssue === true`, plus `{ pending: LABELS.ACCEPT_PENDING, approved: LABELS.ACCEPT_APPROVED, 'changes-requested': LABELS.ACCEPT_CHANGES_REQUESTED }[r.facets.acceptance]` when set. There is no `demo:` literal (Global Constraints).
  - Idempotence, under `--idempotence` only, as on the other sources: `evaluateIdempotence({ state: parent.facets.closed ? 'CLOSED' : 'OPEN', body: parent.body })`.
  - A filesystem error is exit 3. `deps` gains `queryRecords` (default: the real one), so tests use the real store in a temp dir.

- [ ] **Step 1: Write the failing tests.** Build records in a temp dir with the real writers: `createRecord`, then `closeRecord`, with `notPlanned: true` set through `writeRecord` on the read-back record. Never hand-write a record file. The parent has `isParentIssue: true`; two sub-issues have `parent` facets and `risk: 'low'`.
  - `local-files: all sub-issues not planned closes not planned` — both closed and `notPlanned` → `closeReason: 'not planned'`.
  - `local-files: due below the floor closes completed` — both closed, with `--idempotence` → `{ state: 'due', exceeds: false, closeReason: 'completed', idempotence: 'comment-and-close', parentIssue: true }`. Without the flag → `idempotence: null`.
  - `local-files: closing set counts the sub-issue in hand` — one open, `--sub-issue {its id}` → `state: 'due'`.
  - `local-files: an explicit --closing id counts` — one open sub-issue `{a}`, `--sub-issue {b} --closing {a},{b}`, with both ids plain → `state: 'due'`. This pins that an unqualified token survives with `owner: null`.
  - `local-files: a body heading means close only; a closed parent is a no-op` — with `--idempotence`: a parent body ending with the heading → `'close-only'`; a closed parent → `'already-closed'`.
  - `local-files: --parent` — with `--parent {id} --idempotence`:
    - a closed parent whose sub-issues are all closed → `state: 'due'`, `idempotence: 'already-closed'`;
    - an open parent with both sub-issues closed at `risk: 'low'` → `{ state: 'due', exceeds: false, idempotence: 'comment-and-close', parentIssue: true }`;
    - a record without `isParentIssue` → `parentIssue: false`;
    - an id the store does not hold → exit 1, stdout empty.
  - `local-files: the acceptance facet gates` — `acceptance: 'pending'` → `state: 'gated'`; `'approved'` → `'resolved'`.
  - `local-files: never calls gh, ghAvailable or remoteUrl` — each throws if called; exit 0.
  - `local-files: a qualified closing token or an unknown id is exit 1`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/parent-gate-cli.test.js`
Expected: FAIL — the appended tests only (exit 1, `--backend local-files is not supported yet`). Every earlier test stays green.

- [ ] **Step 3: Implement** the backend branch and the docs edits.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/parent-gate-cli.test.js tests/bin-lib/issues/parent-gate.test.js tests/accept-label-reader-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit** the three files: `Teach bin/parent-gate.js the local-files backend — refs #4603`

---

### Task 6: Route the Parent-Gate Procedure through the CLI

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md`
  - **New `## Run the gate CLI`, placed right before `## Evaluate the gate`** (after the Self-inclusion rule section).
    - Placement: every existing pointer runs through this spot with no caller edit — tidy's "from **Enumerate the parent's sub-issues** onward", Step 4.0b's "from **Resolve the parent** through **Evaluate the gate**", `verification-brief.md:44`'s "starts at **Enumerate the parent's sub-issues**", and Two entry shapes' "Run every section below in order".
    - The section says that `bin/parent-gate.js` applies the sections above (Resolve, Enumerate, Self-inclusion) and Evaluate's state and floor rules below as code, in one call made as its own Bash call.
    - Sub-issue-side fence: `node "${CLAUDE_PLUGIN_ROOT}/bin/parent-gate.js" --sub-issue {n} --closing {closing-sub-issues}`, where `{closing-sub-issues}` is `$CLOSING_SUB_ISSUES` comma-joined and sized by the table above.
    - Parent-side fence (tidy runs **Close the parent below the floor** from it): `node "${CLAUDE_PLUGIN_ROOT}/bin/parent-gate.js" --parent {parent-number} --idempotence`.
    - `--backend local-files` under that driver. A sub-issue-side entry under `local-files` also adds `--idempotence`, because it runs the close now (the `exceeds: false` bullet). The pre-merge sub-issue-side entries under `github-issues` never pass `--idempotence`; they never run the close. Step 4.0b passes it on its own command line.
    - The gh-absent path: fetch per the **Transport (#4602).** paragraph; resolve the facts file's path as its own call (`node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value parent-gate-facts.json`, with `_shared/session-tmp-root.md` cited); write the MCP results with the Write tool under the seven `FACTS_KEYS` keys, each one named with its MCP read and when it is needed. `parentComments` and `me` are needed only on an `--idempotence` call whose `parentGet` reads open and not `reopened`. Then add `--facts-json {that path}`. If any MCP read fails, write no file: that is a failing call under the Fail open paragraph.
    - One line per verdict field (`VERDICT_FIELDS`).
    - Exit routing:
      - 0 → route the verdict.
      - Under `work-backend: local-files`, any non-zero exit → report the failure and stop that entry, never fail open. This matches Close step 5 and the Fail open paragraph's local-files sentence: a filesystem error there is a real failure to report.
      - On the gh path, exit 2 with `gh` absent → take the gh-absent path once.
      - Under `--facts-json`, exit 2 can only mean no GitHub remote for a qualified `--closing` token. Route it to **Fail open on every `gh` call**, never back to the gh-absent path, so the two paths cannot loop.
      - Any other non-zero exit on the gh or facts-json path → a failing `gh` call under **Fail open on every `gh` call** (unchanged).
    - Fences hold only `node …` lines with `{…}` placeholders (no `$VAR`, no `gh`), so no `tools/guard-refusals/shapes.js` detector fires.
  - `## Resolve the parent`: keep the heading, the per-driver resolution rule and the **No parent resolvable** paragraph. Add one sentence: the CLI resolves it (`--sub-issue`) and reports `state: 'no-parent'` when it finds none.
  - `## Enumerate the parent's sub-issues`: keep the heading and every rule — parent side only; the `work-links` branches; the local-files reverse query; that each sub-issue's `state`, `stateReason`, labels, `title` and `closedByPullRequestsReferences` are read once; that the parent's labels are read fresh on both entry shapes. Delete all four fences (`WORK_LINKS=…`, the `# work-links: native` fence with its body-text half, the local-files `queryRecords` fence, the parent-labels `gh issue view` fence) and the inline `gh issue view {n} --json …` span. Say in one sentence each that the CLI performs that read.
  - `## Self-inclusion rule`: keep everything except the `**Ruling (`#205`): …**` paragraph, which gains a closing sentence: since #4603 the CLI applies the default itself (`--sub-issue {n}` with no `--closing` counts `{n}`), so an omitted set can no longer reach the gate. A wrong value still can, which is why the table stays.
  - `## Evaluate the gate`:
    - Replace "Call `parentGateState({ subIssues, parentLabels })`, where …" with: the verdict's `state` is `parentGateState(...)`'s, over the enumerated sub-issues with the Self-inclusion rule applied and the parent's labels (local-files: the `facets.acceptance` translation).
    - Keep the three state bullets.
    - Delete the `resolve-policy.js --values risk-floor size-floor` fence and the `exceedsOversightFloor(…)` fence. The CLI resolves `risk-floor` from `.claude-tweaks/policy.yml`, overridable with `--risk-floor`, and reports `riskFloor`, `maxTier` (`null` when a sub-issue is unscored) and `exceeds`.
    - Keep the **`sizeFloor` must be the literal `null`** paragraph and both `exceeds` bullets byte-identical, except for the one reconciler sentence retargeted in the inventory below. This section routes on `state` and `exceeds` only: `parentIssue`, `needs` and `held` are Step 4.0b's (Reading B).
  - `## Close the parent below the floor` step 1: replace from `**1. Idempotence — check before writing anything.**` through the end of its bullet list with this text, verbatim (rewrap only at spaces outside code spans):

    ```markdown
    **1. Idempotence — route on the verdict before writing anything.** Every entry that reaches this
    section ran **Run the gate CLI** with `--idempotence`, so it read the parent's state, `stateReason`
    and comments, and the current `gh` identity, and its `idempotence` field says what to do:

    - `already-closed`: A parent already `CLOSED` is a no-op: an earlier entry, or a human, closed it.
    - `reopened`: An open parent whose `stateReason` is `REOPENED` is a no-op too, reported in the output and never re-closed: a human reopened it after an earlier close.
    - `close-only`: a comment carries a `## Closed below the oversight floor` heading line, counting only a comment from a trusted author (`_shared/pr-run-comments.md`'s Trusted authors) or from the current `gh` identity (the CLI reads its login), since the plugin's own bot or app token can post under an untrusted author association. An earlier run posted the comment and its close then failed: run only step 3's close call, with no second comment.
    - `comment-and-close`: run steps 2 and 3. Any other comment carrying the heading reads as no comment posted, and the verdict's `skipped` names each one; name each in that section's skip notice in the output, since planting a heading must not suppress the real comment.

    Under `work-backend: local-files` the CLI reads the parent record instead: `already-closed` is a set `facets.closed`, `close-only` a body already holding the heading, and `reopened` never occurs; step 5's fence repeats both checks. Steps 2 and 3 take `{maxTier}`, `{riskFloor}`, each listing line's `{n}`, `{title}` and `{pr}` (`subIssues[]`; a `null` `pr` means no suffix) and the close reason (`closeReason`) from the same verdict.
    ```
  - Step 2's local-files sentence, "from `subIssueRecords` above (`r.id`, `r.title`)", references the Enumerate fence this task deletes. It becomes "from the verdict's `subIssues[]` (`number`, `title`)". This is the only edit to steps 2-5. Every other byte of steps 2-5, Compose and Apply stays.
  - **Transport (#4602).** paragraph: rewrite the gh-absent path so that the reads the CLI makes become MCP reads written to the facts file and handed to it with `--facts-json`. Keep, byte-identical, every literal the `#4602` tests pin there (the inventory below): `` `get_parent` ``, "`get_comments` for comments, paged per its row", "every `gh issue view` read", "`gh api user` is `get_me`", "`gh issue comment` is `add_issue_comment`", "`gh issue close` and `gh issue edit --add-label` are `issue_write`", the label-bootstrap sentence, the normalization list ("uppercase", `` `CLOSED` ``, `` `COMPLETED` ``, `` `REOPENED` ``, "label names", "the last of the references"), now stated as what the CLI's normalizer does, and the default-branch sentence. Delete the `$WRAPUP_PARENT_BODY` / `parseSubIssues` script clause. No code span may wrap across a line, and no line may end in `gh` (`brokenSpanLines`).
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md` Step 4.0b's per-record paragraph (lines 103-117, "For each record in `$CLOSING_SUB_ISSUES`, run that procedure …"). It runs `node "${CLAUDE_PLUGIN_ROOT}/bin/parent-gate.js" --sub-issue {n} --closing {closing-sub-issues} --idempotence [--merging-pr {pr-number}] [--held {held}]`, where `{held}` lists every `reopened[]` and `pendingClose[]` number and every `failed[]` and `closeFailed[]` entry's `issue`, and each optional flag is omitted when empty. It routes in the reconciler's order:
  1. **`parentIssue: false`** — keep the sentence "A parent whose labels lack `parent-issue` — the label tidy's `parent-gate` backstop selects on — is a no-op too, named in the closing summary." verbatim, then add "The verdict reports it as `parentIssue: false`."
  2. **`needs`** — the retargeted sentence below.
  3. **`held`** — a non-empty `held` is the inputs paragraph's skip: name the parent in the closing summary.
  4. Then keep verbatim: "On `due` with `exceeds: false`, run **Close the parent below the floor**.", "Every other outcome is a no-op; a record with no resolvable parent follows **Resolve the parent**'s no-parent branch.", the `gh`-absent sentence (still citing `_shared/github-write-transport.md` and the **Transport (#4602).** paragraph), "Evaluate each parent once: skip a record whose parent this step already handled, so a parent with several sub-issues in the set is closed once." (the verdict's `parent` names it), and the Return-to-Try-it / Fail-open sentence, with "A non-zero CLI exit is a failing `gh` call." appended.

  Leave every other paragraph of Step 4.0b, Step 4.0 and Step 4.1+ unchanged.
- Modify: `plugin/skills/wrap-up/verification-brief.md:89-92` — add "Run the gate CLI" between "Self-inclusion rule" and "Evaluate the gate" in the "It covers, in order:" list.
- Modify: `tests/below-floor-parent-close-conformance.test.js` — apply the inventory below, add the new tests, and add `PRE_4603_SHA = '0baad513d'`. That commit sits on `main`, so it survives the squash. `preChangeSkillFile(rel)` gains an optional `sha` parameter, defaulting to `PRE_CHANGE_SHA`.
- Modify: `tests/skill-fence-guard-shapes.test.js:157` — delete the `ratchet('wrap-up/verification-brief-parent-gate.md', 'gh-computed-input', '# work-links: native')` entry, since its fence is gone. Keep line 158's `PARENT_VERIFICATION_BRIEF=` entry (Apply the gate is untouched).
- Check, with no change expected: `tests/try-it-contract-conformance.test.js:162-189,240-249`, `tests/comment-trust-conformance.test.js:183-260` (the **Apply the gate** paragraph), `tests/accept-label-reader-conformance.test.js:455` (the `LABELS_JSON` fence in Apply), `tests/session-tmp-root-migration.test.js:66` (the file still cites `_shared/session-tmp-root.md` and holds no literal `/tmp/` path), `tests/demo-full-verification-pointer.test.js:138`, `tests/closing-links-prose-conformance.test.js:120-273` (Step 4.0b's inputs paragraph is untouched), `tests/bin-lib/issues/below-floor-parent-close.test.js` (reads step 2's template, its bare listing line and the not-planned line, all unchanged).

**Pin inventory** — every assertion literal in `tests/below-floor-parent-close-conformance.test.js` that reads a section this task changes, re-derived from today's file (994 lines). The commit body carries this table's verdicts.

| Test (lines) | Literal | Verdict |
|---|---|---|
| `AC2.2: the exceeds: false bullet…` (77-91) | `!closes cleanly`, `/no \`demo:pending\`, no brief/`, `/Step 4\.0b/`, `**Close the parent below the floor**`, `never closed ahead of the merge`, `commit the parent record with the entry's own close commit`, `never closed ahead of the merge, per that section's step 5.`, `!CLOSE_TIMING`, `!FALSE_MERGE_CLAIMS`, `/end-to-end variant/`, `/Parent-side entry/` | kept: the bullet is untouched apart from the #4599 sentence below |
| `AC1.1: the close section excludes pre-merge…` (93-125) | marker heading, `closed by PR #{pr}`, `/Never[^.]*merge SHA/`, comment-before-close order, `writeRecord`-before-`closeRecord`, `/which call failed/`, `/the entry's own close commit/`, `CLOSE_TIMING`, short-circuit sentence, `!item 5's commit`, the pre-merge exclusion opener, `$MERGING_PR`-first then fallback, `so this fallback is arbitrary but deterministic`, `!uses \`$MERGING_PR\` instead` | kept: the opener and steps 2-5 are unchanged (step 2's local-files sentence is not pinned) |
| `AC5.1: the close section is idempotent…` (127-143) | `/already \`CLOSED\`/` | kept (the `already-closed` bullet) |
| ″ | `gh issue view $PARENT_NUM --json state,stateReason,comments` | retired: shape 7 is pinned by `tests/bin-lib/issues/parent-gate.test.js`'s `gatherIdempotenceFacts reads the login only…` and by the unchanged `below-floor-parent-close.test.js` fake gh |
| ″ | `An open parent whose \`stateReason\` is \`REOPENED\` is a no-op too, reported in the output and never re-closed` | kept (the `reopened` bullet carries it verbatim) |
| ″ | `gh api user --jq .login` | retired: shape 8, pinned by `gatherIdempotenceFacts reads the login only…` and Task 3's `AC1.4: a human-reopened parent` (no login read) |
| ″ | ``counting only a comment from a trusted author (`_shared/pr-run-comments.md`'s Trusted authors) or from the current `gh` identity (the login printed above)`` | retargeted to ``counting only a comment from a trusted author (`_shared/pr-run-comments.md`'s Trusted authors) or from the current `gh` identity (the CLI reads its login)``; behavior is pinned by `own-login heading comment counts` / `trusted heading comment means close only` |
| ″ | `Any other comment carrying the heading reads as no comment posted` | kept (the `comment-and-close` bullet) |
| `AC1.1: the close reason follows… and the enumeration is paginated` (145-154) | `Close with \`--reason completed\` only when at least one sub-issue closed \`COMPLETED\``, `gh issue close $PARENT_NUM --reason "not planned"`, the not-planned line | kept (step 3 is unchanged). Rename the test to `AC1.1: the close reason follows the sub-issues' stateReason`. |
| ″ | `gh issue view {n} --json state,stateReason,labels,title,closedByPullRequestsReferences` (Enumerate) | retired: shape 5, pinned by `gatherGateFacts (native, from a sub-issue) makes the reconciler's call shapes in order` and the unchanged `below-floor-parent-close.test.js` |
| ″ | `gh api --paginate "repos/{owner}/{repo}/issues/$PARENT_NUM/sub_issues"` (Enumerate) | retired: the native enumeration is now shape 4 (`fetch-sub-issues.js`, with 4c's `--paginate` ladder). It is pinned by Task 1's `gatherGateFacts (native, from a sub-issue)…` and `AC1.1: a parent past the 100 page size…`, and by Task 3's two AC1.1 tests. The new AC2.1 test asserts its absence from the prose. |
| `AC2.2: the entry shapes name Step 4.0b…` (156-172) | entry-shapes, Return, Fail open, Self-inclusion table and Routing literals | kept (untouched sections) |
| `AC2.2: no resolvable parent is a no-op…` (174-187) | `NO_OP` in **No parent resolvable**; Step 4.0b `!as is a record with no resolvable parent` and ``a record with no resolvable parent follows **Resolve the parent**'s no-parent branch.`` | kept (that Step 4.0b sentence stays verbatim) |
| `AC2.1: Step 4.0b sits between…` (225-259) | `` `closingSet[]` ``, `git log -1 --format=%B`, `**Close the parent below the floor**`, `` `merged` ``, `work-backend: github-issues`, `$CLOSING_SUB_ISSUES`, `$MERGING_PR`, the armed-merge sentence, `LOCAL_MERGE_NO_OP` | kept |
| `AC2.1: Step 4.0b subtracts…` (261-283) | the `$CLOSING_SUB_ISSUES` subtraction sentence, the `failed[]`/`pendingClose[]` sentence, the two absences | kept (inputs paragraph untouched) |
| ″ | ``Skip a parent carrying a `needs:*` label (the parent labels **Enumerate the parent's sub-issues** fetches) and name it in the closing summary, per `_shared/work-record.md`'s Worklist rule.`` | retargeted to ``Skip a parent whose verdict lists `needs` (its `needs:*` labels) and name it in the closing summary, per `_shared/work-record.md`'s Worklist rule.``; behavior is pinned by Task 1's `AC1.5…` (`needs`) and the unchanged `below-floor-parent-close.test.js` `needs-label` case |
| `AC2.1: Step 4.0b acts only on a below-floor due gate…` (285-314) | the four Step 4.0b literals, `!A failing \`gh\` call skips that parent`, the gate's fail-open sentence, the entry-shapes sentence | kept (all four stay verbatim in the rewritten paragraph) |
| `AC2.1: Step 4.0b keeps same-repo closing records…` (316-359) | `CLOSING_SET_READ`, `SCOPED_SKIP`, `ACTIONS`, the skip sentence, the SKIP/AUTO `log-decision.js` lines, ``A parent whose labels lack `parent-issue` — the label tidy's `parent-gate` backstop selects on — is a no-op too, named in the closing summary.`` | kept (the parent-issue sentence stays verbatim, followed by the new `parentIssue: false` sentence) |
| `#4599: the Parent-Gate Procedure says the reconciler closes…` (439-448) | ``A merge no session saw land is closed by the reconciler's `post-merge` check, a code mirror of this entry (`bin/lib/issues/below-floor-parent-close.js`) except that it skips the **Self-inclusion rule**; `/claude-tweaks:tidy`'s `parent-gate` backstop catches whatever that leaves open.`` | retargeted to ``A merge no session saw land is closed by the reconciler's `post-merge` check, which runs this gate's own code (`bin/lib/issues/parent-gate.js`, through `bin/lib/issues/below-floor-parent-close.js`) except that it skips the **Self-inclusion rule**; `/claude-tweaks:tidy`'s `parent-gate` backstop catches whatever that leaves open.`` (the edit writes exactly this sentence into the `exceeds: false` bullet); `!backstop catches a merge no session saw land` kept |
| `#4599: the Self-inclusion rule names the reconciler…` (450-462) | the **One caller skips this rule** sentence | kept |
| `#4602 AC2.1: every gh call… has a mapping…` (942-970) | `brokenSpanLines(gate)`/`(step40b)` empty; `calls.length >= 10`; every call mapped and its MCP tool named in the Transport paragraph | kept. After the edit the gate keeps 7 call sites (step 3's three fences, Apply's `gh issue view … --json comments`, two `gh issue edit --add-label`, one `gh issue comment`) plus the Transport paragraph's five, and Step 4.0b keeps `gh repo view` and `gh issue reopen`: 14 ≥ 10. The implementer prints the count. |
| ″ | `` `_shared/github-write-transport.md` ``, `` `get_parent` ``, `` `_shared/label-bootstrap.md` ``, the five pairings, the six normalization literals, the two fail-open literals | kept, byte-identical in the rewritten Transport paragraph. The normalization literals now describe the CLI's normalizer, whose behavior is pinned by `tests/bin-lib/issues/mcp-parent-gate-shape.test.js`'s `normalizes the MCP shape`. |
| `#4602 AC1.1: the close section and Step 4.0b cite the MCP path` (972-980) | close section: `` `_shared/github-write-transport.md` ``, `` `state_reason` ``, `` `not_planned` ``, ``never pass `labels` `` | kept (step 3's MCP sentence is unchanged) |
| ″ | close section: `` `get_me` ``, `` `get_comments` `` | retired from the close-section list (step 1's MCP sentence goes): both stay pinned in the Transport paragraph by `#4602 AC2.1`'s pairings ``"`gh api user` is `get_me`"`` and ``"`get_comments` for comments, paged per its row"`` |
| ″ | close section: ``` `reopened` → `REOPENED` ```, `` `user.login` `` | retired: the normalization moved into Node and is pinned by `mcp-parent-gate-shape.test.js`'s `normalizes the MCP shape` (``reopened → REOPENED``, ``user.login → author.login``); the Transport paragraph keeps `` `REOPENED` `` |
| ″ | Step 4.0b: `` `_shared/github-write-transport.md` ``, `git remote show origin` | kept |
| `#4602: settle-and-merge's #205 paragraph…` (982-994) | each `ghCalls(gate)` call named in settle-and-merge's Parent-Gate sentence | kept (the gate's calls after the edit are a subset of those it makes today) |

`tests/skill-fence-guard-shapes.test.js:157`: the `'# work-links: native'` ratchet is retired, because its fence is deleted; `applyAllowlist` would otherwise report it stale. Line 158 is kept.

**Interfaces:**
- Consumes: Task 3-5's `USAGE`, `VERDICT_FIELDS`, `IDEMPOTENCE_VALUES` and `FACTS_KEYS`, verbatim.

- [ ] **Step 1: Write the failing tests** (in `tests/below-floor-parent-close-conformance.test.js`, after applying the inventory's retargets and retirements, and the fence-guard deletion):
  - `AC2.1 (#4603): the gate file no longer composes the sub-issue enumeration`:
    - Neither the raw nor the whitespace-collapsed gate text includes `issues/$PARENT_NUM/sub_issues`.
    - The `## Run the gate CLI` section includes `bin/parent-gate.js`.
    - Go-red control: the frozen `preChangeSkillFile(GATE_REL, PRE_4603_SHA)` text does include `issues/$PARENT_NUM/sub_issues`. It skips when the SHA is unreachable, as the existing controls do.
  - `#4603: the gate file and Step 4.0b invoke bin/parent-gate.js`:
    - The collapsed `## Run the gate CLI` includes `bin/parent-gate.js" --sub-issue {n} --closing`, `bin/parent-gate.js" --parent {parent-number} --idempotence`, `--facts-json` and `--backend local-files`.
    - The section's sub-issue-side fence line carries no `--idempotence`, so the pre-merge github entries never read comments or login.
    - The collapsed Step 4.0b includes `bin/parent-gate.js" --sub-issue {n}`, `--idempotence`, `--held` and `--merging-pr`.
    - The section names exit 2 under `--facts-json` as fail open, and the local-files non-zero exit as a reported failure, never fail open.
    - The section sits between `## Self-inclusion rule` and `## Evaluate the gate`.
  - `#4603: the prose names only the CLI's own flags, verdict fields and facts keys` (a prose-code twin):
    - Only command lines that run `bin/parent-gate.js` are scanned: every line, fenced or inline-span, in the `## Run the gate CLI` section and in Step 4.0b that contains `bin/parent-gate.js`. Prose mentions of a flag elsewhere (`--risk-floor` in Evaluate, `--facts-json` in the Transport paragraph) are not scanned. Every `--[a-z-]+` token on those lines appears in `require('../plugin/bin/parent-gate').USAGE`, and there are at least three such lines.
    - Every `VERDICT_FIELDS` and `FACTS_KEYS` name appears as a code span in the section.
    - Go-red: a doctored `bin/parent-gate.js` line with `--repo o/r` added fails the flag check. A doctored non-command prose line carrying `--repo` does not.
  - `#4603: Close step 1 routes on the CLI's idempotence values` — step 1 names each of `IDEMPOTENCE_VALUES` as a code span, and no longer includes `gh api user`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/below-floor-parent-close-conformance.test.js tests/skill-fence-guard-shapes.test.js`
Expected: FAIL. In the first file, the new tests and the three retargeted pins fail. In the second, `AC2.2: no shell fence…` fails: the `# work-links: native` fence offends uncovered once its ratchet entry is gone. Every other test stays green.

- [ ] **Step 3: Edit the three skill files** as listed, copying each pinned literal from the replacement text above. Then the AC check:

Run: `grep -F "issues/\$PARENT_NUM/sub_issues" plugin/skills/wrap-up/verification-brief-parent-gate.md`
Expected: no output, exit 1.

Then `wc -c plugin/skills/wrap-up/verification-brief-parent-gate.md`. It must be at most 52,500, and is expected to be at or below 39,786.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/below-floor-parent-close-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/bin-lib/issues/below-floor-parent-close.test.js tests/try-it-contract-conformance.test.js tests/comment-trust-conformance.test.js tests/accept-label-reader-conformance.test.js tests/session-tmp-root-migration.test.js tests/demo-full-verification-pointer.test.js tests/closing-links-prose-conformance.test.js tests/pr-first-merge.test.js tests/parent-gate-cli.test.js`
Expected: PASS, 0 failures. Then run `git -C "{worktree}" grep -n -F -e 'wrapup-parent-body' -e 'WRAPUP_PARENT_BODY' -e 'subIssueRecords' -- plugin/skills/wrap-up/verification-brief-parent-gate.md`. Expected: no output. Then run `git -C "{worktree}" grep -n -F -e 'Enumerate the parent' -- plugin docs` and confirm that every remaining hit still reads true.

- [ ] **Step 5: Commit** the five files: `Route the Parent-Gate Procedure through bin/parent-gate.js — refs #4603`. The body carries the pin inventory's verdicts (kept / retargeted to `{new literal}` / retired: `{covering unit test}`).
