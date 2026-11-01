# Blocker-Landing Pre-flight Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/flow` stops before claiming when a closed out-of-run `blocked-by` prerequisite's closing commit never reached `origin/{integration-branch}`, or when the blocker query itself fails.

**Architecture:** A new pure-plus-injectable module `plugin/bin/lib/preflight-records/blocker-landing.js` (query builder, candidate extraction, classifier, fetch over the injected `gh` runner) is wired into `plugin/bin/preflight-records.js` behind an additive `--blocker-landing` flag that attaches `blockerLanding` to every record and exits non-zero when the blocker query fails as a whole. `materialize.js --check` gains an additive `bodyBlockedBy` field so the single-record substep can skip the call under `work-links: body-text`. `/flow`'s prose consumes both in two places — multi-spec Validation step 3's existing call, and a new single-record Step 2 substep (2.7b) — applying one verdict table that lives in `multispec-dependency-ordering.md`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh api graphql` + `gh api repos/.../compare`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T234545-record-4553/work/4553-spec.md` (revision 3 — carries all five `Decision (plan review, 2026-10-31)` criteria: Q1–Q3, the Q4 `work-backend: local-files` skip, and the closing rule; revision 2, `.claude-tweaks/pipelines/2026-10-31T164258-record-4553/work/4553-spec.md`, carried Q1–Q3 only, and this plan's Task 5 now adds the Q4 skip; the revision-1 plan was written for `.claude-tweaks/pipelines/2026-10-31T132233-record-4553/work/4553-spec.md`).

Scope keywords: blockerLanding, blocker-landing, bodyBlockedBy

## Global Constraints

- The five per-blocker verdicts are exactly `open`, `landed`, `unlanded`, `not-applicable`, `undetermined`; each result object is exactly `{ blocker, verdict, commit, via }`.
- Out-of-run blockers only: a blocker that is one of the positional record numbers never appears in `blockerLanding`.
- Without `--blocker-landing`, `preflight-records.js` output is byte-identical to today's (no `blockerLanding` key anywhere, no extra runner call).
- Reachability goes through the REST compare API (`repos/{owner}/{repo}/compare/{base}...{sha}`): `identical`/`behind` → reachable; `ahead`/`diverged` → not reachable; any error or other status → that candidate is `error`. No local `git fetch`, no `git merge-base`.
- Candidate commits are the union of the closer (merged PR's `mergeCommit.oid`, or a `Commit`'s `oid`) and every merged `closedByPullRequestsReferences` PR's `mergeCommit.oid`, closer first, deduped by sha (Decision Q2). "Landed if any candidate commit is reachable" — never "every candidate".
- **Whole-query failure is never `undetermined` (Decision Q1).** The blocker GraphQL call throwing (other than the NOT_FOUND-only recovery below), unparseable JSON, a missing `data.repository`, or any non-NOT_FOUND GraphQL error → `preflight-records.js` exits **1** with one stderr line `preflight-records.js: blocker landing query failed: {error}`. No resolvable owner/repo while the out-of-run blocker set is non-empty → exit **2** with `preflight-records.js: could not resolve owner/repo for --blocker-landing — pass --repo owner/name`. Both stop the run before Step 2.8 claims, under every `work-links` mode.
- **NOT_FOUND-only recovery.** `gh api graphql` exits 1 when any alias fails to resolve, but still prints the partial `data` (probed live, below). When the thrown error's `stdout` parses to `{data:{repository:{…}}, errors:[…]}` and every error has `type === 'NOT_FOUND'` and `path` exactly `['repository', 'b{n}']` for a requested blocker `n`, treat the call as succeeded with those aliases `null` (→ `undetermined`/`not-found` for that blocker). Anything else is a whole-query failure.
- `undetermined` is per-blocker only and never stops a run; it writes one `SKIP` decision-log line per blocker (Decision Q1's carve-out of AC7).
- `--records-json` (no `gh`) — **only closed blockers read `undetermined`; an open one still stops** (spec Deliverable 2: "every out-of-run closed blocker reads `undetermined`"; AC6: an `open` out-of-run blocker stops — plan-review clarification, spec `## Plan Review Clarifications`). The records file carries no state for a non-positional blocker, so the caller supplies it, per the `mcp-agent-fetch-node-compute` skill (agent fetches over MCP, writes a JSON file, Node computes): a new additive `--blocker-states-json <path>`, valid only with both `--records-json` and `--blocker-landing` (else exit 2), holds a JSON object keyed by blocker number to `{state, stateReason}` copied from MCP `issue_read` (`state` `open`/`closed`/`OPEN`/`CLOSED`, `stateReason` or `state_reason` `completed`/`not_planned`/`duplicate`/null — compared case-insensitively). Classification on this path (pure `classifyFromState(blocker, entry)` in Task 1's module): open → `open`/`records-json`/null; closed `NOT_PLANNED`/`DUPLICATE` → `not-applicable`/`state-reason`/null; any other closed → `undetermined`/`records-json`/null. Every union blocker absent from the states file, an unreadable/non-JSON/non-object file, or an entry with no recognisable `state` → exit 2 naming the blocker(s) (the `--records-json` input-problem rule: this path never exits 1). Without `--blocker-states-json`, every out-of-run blocker reads `undetermined`/`records-json`, and the one stderr line also says `pass --blocker-states-json to judge open blockers`; exit 0. The `/flow` prose always passes the file: a first call without it lists the union in `blockerLanding`, the agent fetches each listed blocker with MCP `issue_read`, writes the file with the Write tool, and re-runs with `--blocker-states-json` — the second call's envelope is the one the verdict table reads.
- Under `work-links: body-text` a single-record run whose `materialize.js --check` envelope reports `bodyBlockedBy: []` makes **no** `preflight-records.js` call (Decision Q3). Under `work-links: native` the call always runs, and the substep is a no-op when `blockerLanding` is `[]`.
- **Under `work-backend: local-files` the single-record substep 2.7b is skipped entirely (Decision Q4)** — the same way Step 2.8 skips itself: no `work-links` read, no `preflight-records.js` call, no decision-log line. The skip is the substep's first check, ahead of every `work-links` branch.
- **Closing rule (Decision, plan review 2026-10-31):** an edge case not settled by Q1–Q4 is the implementer's judgment; the plan or the implementing commit records the chosen behaviour, and review checks it. Edge cases already decided here: an unresolvable blocker number → `undetermined`/`not-found` (Review Focus 1); an unmerged closer PR → no candidate (Review Focus 3); a blocker that is itself in-run → excluded (Global Constraints, out-of-run only); and, from plan review (2026-10-31, run `2026-10-31T234545`):
  - **Native links unread on the gh-absent path.** An envelope carrying `nativeLinksUnchecked: true` means native-only blockers were invisible, so `blockerLanding: []` there is never "no blockers": 2.7b writes one `SKIP` (`condition: blocker landing ran under --records-json with work-links: native — native blocked-by links unread → fallback: only body-text blockers judged`) at the same point as the per-blocker `SKIP`s, and proceeds — the multi-spec precedent in `multispec-preflight-failure.md`'s `nativeLinksUnchecked` paragraph.
  - **Step-list gate.** 2.7b skips — no call, no log line — under a step list with neither `build` nor `test`, the condition Step 2.8 already skips on: a `review,polish,wrap-up` resume (dispatch's second call included) has already built, and must neither re-stop nor double-log.
  - **When the `SKIP` lines are written.** Never before Step 3 (its adoption tolerates only Step 2.8's claim lines in `decisions.md`): right after Step 3's Manifesto write or adoption (any case), or — on Step 2.9's express route, which never reaches Step 3 — right after `express-entry.md`'s Bind step. 2.7b holds them until then.
- `buildNativeDependencyQuery` in `plugin/bin/lib/issues/record-dependencies.js` stays unchanged.
- Governing skill `gh-api-module-pattern` (`.claude/skills/gh-api-module-pattern/SKILL.md`), quoted verbatim:
  - "The module takes `runner(args)`, invoked as if `gh ${args.join(' ')}`, returning stdout; a throw is a failed call."
  - "Tests never touch real `gh`: fake runners branch on the `args` shape (`isGraphQL`, `isPost`-style lazy helpers) and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled — a wrong endpoint fails loudly instead of passing silently. Record values inside the runner, assert after it returns (an `AssertionError` thrown *inside* a runner can be swallowed by the module's own try/catch)."
  - "An **already-resolved** string bound to a GraphQL `String!` variable | `-f` | `-F` type-coerces an all-numeric name (`2048`) to an Int and GraphQL rejects it (#610)"
  - "**Any `-f`/`-F` field flips `gh api`'s default method from `GET` to `POST`.**" — so the compare read passes no `-f`/`-F` field at all.
  - "**A ref name interpolated into a REST path is encoded per segment.** … builds the segment as `branch.split('/').map(encodeURIComponent).join('/')`, keeping `/` a separator"
  - "**A caller-overridable REST path has no bound-variable escape hatch.** … the interpolated `owner`/`repo` values need their own validation before they reach the path … `fetch-sub-issues.js` added a narrow `owner !== '.' && owner !== '..'` guard at its own call site"
  - "**A REST call with no `--repo`/`-R` flag needs `--hostname` instead, from the same `parseRepo` host field.** … omitted when `host` is absent or `github.com`." The same holds for `gh api graphql`: "the host travels as `--hostname {host}` placed right after `graphql`".
- Governing contract `gh-api-module-pattern/cli-wrapper-contract.md`, quoted verbatim for the `--records-json` path: "(3) Anything the `gh` path learns from a further call that the file cannot carry degrades visibly." and "That path makes **zero** `gh` calls … `preflight-records.js`'s header says outright that this path never exits 1."
- Governing skill `skill-prose-conformance-tests`, quoted verbatim for Tasks 4–5: "Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** … preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control." and, for the 2.7b ordering pin, "Build the control by **permutation, not deletion** … assert the same helper *throws* on the permuted string … Match the permuted throw to the helper's ordering message, and prove the existence half with a separate deletion control matched to its own message."
- The new module takes `runner` as a required parameter (no `defaultRunner` of its own, like `plugin/bin/lib/issues/native-dependencies.js`); the CLI passes `deps.runner`. No new `child_process`/`fs` call site is added anywhere (the windows-hide, timeout and path-guard source scans see nothing new).
- Byte budget (`RAIL_BYTES` = 52,500, measured after catching up with `origin/main` at `3438ced28`): `plugin/skills/flow/SKILL.md` 50,531 B (headroom 1,969 B — Task 5 adds ≤ 400 B net); `validation.md` 8,829; `multispec-dependency-ordering.md` 2,407; `multi-spec.md` 22,711; `multispec-preflight-failure.md` 2,843; `materialize.md` 40,210. None near the rail after the edits.
- Maturity `established`: every task modifying pre-existing behavior first runs (or adds) a characterization test of today's behavior — Task 2's AC4.1 byte-identical test and Task 3's existing `--check` envelope test serve that role.

## Live probes (Verbatim-command run-once / Derived-value checks, 2026-10-31)

Run from this worktree with the exact argv the module builds (`-f query=… -f owner=thn-inc -f repo=claude-tweaks`; owner/repo as `parseRepo` derives them from `origin`):

- Blockers `[4495, 4553]` → exit 0; `b4495` CLOSED/COMPLETED, closer `PullRequest #4723 merged baseRefName main mergeCommit 4b0d12438…`, refs `#4675 merged:false mergeCommit:null`, `#4723 merged:true`; `b4553` OPEN with empty `timelineItems.nodes`.
- Blockers `[4495, 999999]` → **exit 1**, stderr `gh: Could not resolve to an Issue with the number of 999999.`, stdout still `{"data":{"repository":{"b4495":{…},"b999999":null}},"errors":[{"type":"NOT_FOUND","path":["repository","b999999"],…}]}` — the shape the NOT_FOUND-only recovery reads.
- `gh api repos/thn-inc/claude-tweaks/compare/main...4b0d12438c61… --jq .status` → `behind`; `…/compare/main...e91592f1a480…` (an unmerged branch commit) → `diverged`; `…/compare/main...0000…0000` → exit 1 `gh: Not Found (HTTP 404)`.
- Remove-edge escape: `gh api repos/thn-inc/claude-tweaks/issues/4495 --jq .id` → `6074204892`; `gh api repos/thn-inc/claude-tweaks/issues/4553/dependencies/blocked_by --jq length` → `0` (base path exists). The `gh api -X DELETE …/dependencies/blocked_by/{id}` form has no read-only variant — **unverified**, stated as such here.

## Review Focus

1. A blocker number that does not resolve (deleted/transferred issue, a typo'd `Blocked by #N`) must read `undetermined` (`via: 'not-found'`) via the NOT_FOUND-only recovery, never stop the run or read as landed — tests in Task 1 (recovered) and the guard-discrimination pair (a mixed error list, and a NOT_FOUND on an unrequested alias, both stay whole-query failures).
2. An integration branch containing `/` or `#` (e.g. `release/v1#x`) must be encoded per segment in the compare path — test in Task 1.
3. A closer that is an unmerged PR (no `mergeCommit`) contributes no candidate; with no merged references the verdict is `undetermined` (`no-candidate`) — test in Task 1.
4. Two blockers closed by the same PR must cost one compare call, not two (dedupe by sha) — test in Task 1.
5. `--blocker-landing` with no resolvable owner/repo and a non-empty out-of-run blocker set must exit 2 (never silently `undetermined`), while the same with an empty set exits 0 with `blockerLanding: []` and no call — tests in Task 2.

---

### Task 1: blocker-landing module

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/preflight-records/blocker-landing.js`
- Test: `tests/bin-lib/preflight-records/blocker-landing.test.js`

**Interfaces:**
- Produces (all exported):
  - `buildBlockerLandingQuery(blockers: number[]) -> string|null` — `null` for empty/non-array. One aliased query `query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ … } }`, per alias exactly the live-probed text: `b{n}: issue(number:{n}){ number state stateReason timelineItems(itemTypes:[CLOSED_EVENT], last:1){ nodes{ ... on ClosedEvent { closer { __typename ... on PullRequest { number merged baseRefName mergeCommit{ oid } } ... on Commit { oid } } } } } closedByPullRequestsReferences(first:10, includeClosedPrs:true){ nodes{ number merged baseRefName mergeCommit{ oid } } } }`
  - `candidateCommits(node) -> Array<{sha: string, via: 'closer-pr'|'closer-commit'|'closing-pr-ref'}>` — closer first (`PullRequest` with `merged === true` and `mergeCommit.oid` → `closer-pr`; `Commit` with `oid` → `closer-commit`), then every reference with `merged === true` and `mergeCommit.oid` (`closing-pr-ref`), deduped by sha keeping the first.
  - `reachabilityFromStatus(status: string) -> 'reachable'|'unreachable'|'error'` (trims; `identical`/`behind` reachable, `ahead`/`diverged` unreachable, else error).
  - `compareArgs({ owner, repo, host, integrationBranch, sha }) -> string[]` — `['api', \`repos/${owner}/${repo}/compare/${encodedBase}...${sha}\`, '--jq', '.status']`, `encodedBase = integrationBranch.split('/').map(encodeURIComponent).join('/')`, plus `'--hostname', host` when `host` is set and not `github.com`. Throws on `owner`/`repo` equal to `.` or `..`.
  - `classifyBlocker(blocker: number, node: object|null, reach: Map<string, 'reachable'|'unreachable'|'error'>) -> { blocker, verdict, commit, via }`.
  - `undeterminedAll(blockers: number[], via: string) -> Array<{blocker, verdict:'undetermined', commit:null, via}>`.
  - `classifyFromState(blocker: number, entry: {state, stateReason?, state_reason?}) -> { blocker, verdict, commit: null, via } | null` — the gh-absent (`--blocker-states-json`) classifier: `state` (case-insensitive) `open` → `open`/`records-json`; `closed` with reason (`stateReason` ?? `state_reason`, case-insensitive) `not_planned`/`duplicate` → `not-applicable`/`state-reason`; any other `closed` → `undetermined`/`records-json`; `null` when `entry` is not an object or `state` is neither (the CLI turns `null` into exit 2).
  - `recoverNotFound(err, blockers: number[]) -> object|null` — the `repository` object when `err.stdout` parses and every `errors[]` entry is `type: 'NOT_FOUND'` with `path` deep-equal `['repository', 'b'+n]` for some requested `n` (and `errors` is non-empty); else `null`.
  - `fetchBlockerLanding({ blockers, owner, repo, host, integrationBranch, runner }) -> { results: Map<number, result>|null, error: string|null }` — `results` is `null` exactly when `error` is set.

**Classifier rules** (in order): `node` null → `undetermined`/`not-found`/null. `state === 'OPEN'` → `open`/`state`/null. `stateReason` `NOT_PLANNED` or `DUPLICATE` → `not-applicable`/`state-reason`/null. No candidates → `undetermined`/`no-candidate`/null. Any candidate `reachable` → `landed`, commit = first reachable sha, via = its via. Else any candidate `error` or absent from `reach` → `undetermined`/`probe-failed`, commit = first such sha. Else → `unlanded`, commit = first candidate sha, via = its via.

**Fetch rules:** empty `blockers` → `{results: new Map(), error: null}` and **zero runner calls**. One GraphQL call: `['api', 'graphql', ...(host && host !== 'github.com' ? ['--hostname', host] : []), '-f', \`query=${q}\`, '-f', \`owner=${owner}\`, '-f', \`repo=${repo}\`]`. Runner throw → `recoverNotFound(err, blockers)`; `null` → `{results: null, error: <errorText>}`. Returned stdout: unparseable JSON, missing `data.repository`, or a non-empty `errors` not satisfying the NOT_FOUND-only rule → `{results: null, error}`. Otherwise compare once per unique candidate sha of every node that is CLOSED and not NOT_PLANNED/DUPLICATE; a compare throw → `'error'` for that sha. Then `classifyBlocker` per blocker (node = `repository['b'+n]`, possibly null/absent).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/preflight-records/blocker-landing.test.js`, fake runner per the governing skill (`isGraphQL = (a) => a[0]==='api' && a[1]==='graphql'`, `isCompare = (a) => a[0]==='api' && /\/compare\//.test(a[1])`, throw `'unexpected '` otherwise; record argv, assert after). Node fixture helper `closed({ reason='COMPLETED', closer=null, refs=[] })`. Tests (names carry AC ids):
  - `AC1.1: incident — closer PR merged into production, compare diverged → unlanded with that merge commit` — closer `{__typename:'PullRequest', number:90, merged:true, baseRefName:'production', mergeCommit:{oid:'aaa111'}}`, refs `[{number:90, merged:true, baseRefName:'production', mergeCommit:{oid:'aaa111'}}]`; compare returns `'diverged\n'`; `fetchBlockerLanding({blockers:[5], owner:'acme', repo:'w', integrationBranch:'dev', runner})` → `results.get(5)` deepEqual `{blocker:5, verdict:'unlanded', commit:'aaa111', via:'closer-pr'}`; exactly one compare call.
  - `AC2.1: closer merge commit behind or identical → landed` — loop `['behind','identical']` → `{verdict:'landed', commit:'aaa111', via:'closer-pr'}`.
  - `AC2.2: NOT_PLANNED and DUPLICATE → not-applicable, no compare call`.
  - `AC2.3: COMPLETED, null closer, no merged closing PR → undetermined no-candidate` — refs `[{number:91, merged:false, mergeCommit:null}]`.
  - `AC10.1: null closer falls back to a merged closing-PR reference` — ref oid `bbb222`, `behind` → `{verdict:'landed', commit:'bbb222', via:'closing-pr-ref'}`.
  - `AC10.1, AC10.2, AC10.3: mixed candidates — closer diverged, second merged reference behind → landed (union, any-candidate rule)` — closer `aaa111` (`diverged`), ref `ccc333` (`behind`) → `{verdict:'landed', commit:'ccc333', via:'closing-pr-ref'}`.
  - `closer Commit object → candidate via closer-commit`.
  - `compare-API error → undetermined probe-failed; ahead → unlanded; unknown status → undetermined`.
  - `open blocker → open, no compare call`.
  - `Review Focus 1: NOT_FOUND-only GraphQL error is recovered — the missing alias reads undetermined not-found, the others classify` — runner throws `Object.assign(new Error('gh: Could not resolve'), { stdout: JSON.stringify({ data:{ repository:{ b5: closed(...), b999999: null } }, errors:[{ type:'NOT_FOUND', path:['repository','b999999'] }] }) })` (the live-probed shape) → `error` null, `results.get(999999)` `{verdict:'undetermined', via:'not-found', commit:null}`, `results.get(5)` classified normally.
  - `AC9.1: a NOT_FOUND mixed with another error type is a whole-query failure` and `AC9.1: a NOT_FOUND on an unrequested alias path is a whole-query failure` — both → `results === null`, `error` non-empty. (Guard discrimination: each fixture differs from the recovered one only in the one condition its guard checks; deleting the type check, or the requested-alias check, turns its own test red.)
  - `AC9.1: GraphQL throw with no parseable stdout, unparseable stdout, and data.repository null → whole-query failure, zero compare calls`.
  - `unmerged closer PR contributes no candidate` (Review Focus 3).
  - `two blockers closed by the same PR cost one compare call` (Review Focus 4).
  - `empty blockers → zero runner calls`.
  - `graphql argv: -f query/owner/repo, --hostname right after graphql only for a non-github.com host`.
  - `compareArgs encodes the integration branch per segment and adds --hostname for GHE` — `integrationBranch:'release/v1#x'` → path contains `compare/release/v1%23x...aaa111`; host `ghe.example.com` → ends `['--hostname','ghe.example.com']`; host `github.com` → no `--hostname`; no `-f`/`-F` in argv; `owner:'..'` throws (Review Focus 2).
  - `buildBlockerLandingQuery: null for [] and non-array; one b{n} alias per blocker with stateReason, CLOSED_EVENT last:1, closedByPullRequestsReferences includeClosedPrs:true`.
  - `AC6.1 (gh-absent): classifyFromState — open/OPEN → open; closed not_planned/DUPLICATE (either key spelling) → not-applicable; closed completed/null → undetermined; non-object or unknown state → null`.

- [ ] **Step 2: Run to verify fail**
  Run: `node --test tests/bin-lib/preflight-records/blocker-landing.test.js`
  Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/preflight-records/blocker-landing'`.

- [ ] **Step 3: Implement `plugin/bin/lib/preflight-records/blocker-landing.js`** per the Interfaces and rules, header comment style of `merge-gate.js` (file-path first line, purpose, `'use strict'`). Reuse `errorText` from `./preflight-records` for error messages. Header names #4553, the five verdicts, the union-of-candidates any-landed rule, the whole-query-failure-is-not-undetermined rule and the NOT_FOUND-only recovery, why compare-API rather than local git, and that `buildNativeDependencyQuery` is deliberately not reused.

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/bin-lib/preflight-records/blocker-landing.test.js`
  Expected: all pass. Then revert one rule at a time and confirm its own test goes red, restoring after each: make `behind` unreachable (`AC2.1`); drop the `type === 'NOT_FOUND'` check (the mixed-error test); drop the requested-alias check (the unrequested-path test).

- [ ] **Step 5: Commit**
  `git add plugin/bin/lib/preflight-records/blocker-landing.js tests/bin-lib/preflight-records/blocker-landing.test.js`
  `git commit -m "Add blocker-landing module — classify out-of-run blockers by integration-branch reachability (refs #4553)"`

### Task 2: `preflight-records.js --blocker-landing`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/preflight-records/preflight-records.js` (new export `outOfRunBlockers`)
- Modify: `plugin/bin/preflight-records.js` (header comment incl. exit-code paragraph, `USAGE`, `parseArgs`, `loadFromGh` return, `run`)
- Modify: `docs/plugin-structure.md` (line 61 `plugin/bin/lib/preflight-records/` entry; line 222 CLI line — the `node plugin/bin/preflight-records.js` synopsis; locate by that text, line numbers drift on catch-up merges)
- Test: `tests/bin-lib/preflight-records/preflight-records.test.js` (append a `// --- CLI: --blocker-landing (#4553)` section)

**Interfaces:**
- Consumes: Task 1's `fetchBlockerLanding`, `undeterminedAll`, `classifyFromState`.
- Produces (lib): `outOfRunBlockers(records, numbers: number[]) -> { byRecord: Map<number, number[]>, union: number[] }` in `plugin/bin/lib/preflight-records/preflight-records.js` — per record its `blockedBy` minus every positional number (order kept), `union` deduped and ascending.
- Produces (CLI): envelope `records["<n>"].blockerLanding: Array<{blocker, verdict, commit, via}>` (that record's out-of-run blockers, in `blockedBy` order; `[]` when none) — present only with `--blocker-landing`. Exit 1 on a whole blocker-query failure; exit 2 on unresolvable owner/repo with a non-empty union, on `--blocker-states-json` without both `--records-json` and `--blocker-landing`, and on any states-file problem (Global Constraints' `--records-json` bullet).

**Behavior:** `parseArgs` gains `blockerLanding: false` / `--blocker-landing`. `--integration-branch` (default `'main'`) is consumed by `--merge-gate` **and** `--blocker-landing`. `loadFromGh` additionally returns `repoSpec`. In `run`, after `buildRecords` and before any stdout write, when `opts.blockerLanding`: `const { byRecord, union } = preflight.outOfRunBlockers(records, numbers)`. Union empty → every record `blockerLanding: []`, no runner call, no repo needed. `--records-json` with `--blocker-states-json <path>` (parseArgs: `blockerStatesJson`, same missing-value check as `--records-json`; read via the existing `deps.readFile` seam the `--records-json` path uses — no new `fs` call site) → per union blocker `classifyFromState(n, states[String(n)])`; an absent entry or a `null` result → stderr `preflight-records.js: --blocker-states-json has no usable state for #a, #b\n`, **return 2**, no stdout; unreadable / non-JSON / non-object (array or null) file → stderr naming the problem, **return 2**. `--records-json` without `--blocker-states-json` → `undeterminedAll(union, 'records-json')` and one stderr line `preflight-records.js: --records-json makes no gh call — blocker landing undetermined for #a, #b (pass --blocker-states-json to judge open blockers)\n` (only when the union is non-empty), exit 0. `--blocker-states-json` without both `--records-json` and `--blocker-landing` → **return 2** (a malformed invocation, `USAGE` on stderr). gh path with no `repoSpec` → stderr `preflight-records.js: could not resolve owner/repo for --blocker-landing — pass --repo owner/name\n`, **return 2**, no stdout. Otherwise `fetchBlockerLanding({ blockers: union, owner, repo, host, integrationBranch: opts.integrationBranch || 'main', runner: deps.runner })`; a non-null `error` → stderr `preflight-records.js: blocker landing query failed: {error}\n`, **return 1**, no stdout. Header comment and `USAGE` add `[--blocker-landing] [--blocker-states-json <path>]`; header gets one paragraph describing the flag, the out-of-run rule, the `--records-json` degrade and its `--blocker-states-json` input, and the exit-code paragraph's 1/2 clauses gain the blocker-query failure and the `--blocker-landing` repo case. `docs/plugin-structure.md` line 222's exit-code and `--integration-branch` clauses get the same additions.

- [ ] **Step 1: Write the failing tests** (reuse the file's `cliDeps`, `issue`, `specBody`, `isGraphQL`, `isIssueView`; add `isCompare`):
  - `AC3.1, AC3.2: 10 11 --blocker-landing --integration-branch dev — landing for out-of-run #5 only, in-run #10 never appears` — body-text; #11 body `Blocked by #10\nBlocked by #5\n\n…`; runner answers the blocker GraphQL with `{data:{repository:{b5: <closed COMPLETED, closer PR oid 'eee555'>}}}`, records the query and asserts (after) it names `b5` and not `b10`; compare `behind`; `env.records['11'].blockerLanding` deepEqual `[{blocker:5, verdict:'landed', commit:'eee555', via:'closer-pr'}]`, `env.records['10'].blockerLanding` deepEqual `[]`, recorded compare path contains `compare/dev...eee555`.
  - `AC4.1: without --blocker-landing the envelope is byte-identical and no extra call is made` — run the same fixture with and without the flag; the no-flag stdout contains no `blockerLanding`, equals `JSON.stringify(expected, null, 2) + '\n'` built from today's keys, and makes 0 graphql / 0 compare calls.
  - `AC11.2: a native-mode record with no out-of-run blockers makes no blocker-landing query and no compare call` — `720 --blocker-landing --work-links native --repo acme/w` with the native dependency answer `blockedBy: []` → `blockerLanding: []`; the only graphql call is the native dependency one (assert no recorded query contains `CLOSED_EVENT`), compare count 0.
  - `AC9.1: --blocker-landing GraphQL failure exits 1 naming the failed query, prints no envelope` — runner throws on the `CLOSED_EVENT` query → exit 1, stderr includes `blocker landing query failed`, stdout empty.
  - `AC9.1: --blocker-landing with no resolvable repo and an out-of-run blocker exits 2` (Review Focus 5; `remoteUrl` throws, body-text, #11 `Blocked by #5`) → exit 2, stderr names `--repo`, stdout empty, zero runner calls past the issue fetch; and the same with no `Blocked by` line → exit 0, `blockerLanding: []`.
  - `AC7.1: --blocker-landing under --records-json: undetermined records-json, one stderr line, no runner call, exit 0`.
  - `AC6.1 (gh-absent): --records-json --blocker-states-json — an open out-of-run blocker reads open, a closed COMPLETED one undetermined, a NOT_PLANNED one not-applicable; zero runner calls` — states file `{"5":{"state":"OPEN"},"6":{"state":"closed","state_reason":"completed"},"7":{"state":"CLOSED","stateReason":"NOT_PLANNED"}}` via `readFile`.
  - `--blocker-states-json input problems exit 2` — a union blocker missing from the file; an entry with an unknown `state`; non-JSON; a JSON array; and the flag without `--records-json` (and without `--blocker-landing`) — each exit 2, stdout empty, zero runner calls.
  - `--help usage names --blocker-landing`.
  - `outOfRunBlockers: drops in-run numbers, keeps blockedBy order, union deduped ascending` (lib unit test).

- [ ] **Step 2: Run to verify fail**
  Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js`
  Expected: FAIL — `unknown argument: --blocker-landing`.

- [ ] **Step 3: Implement** the Behavior above; update `docs/plugin-structure.md` line 61 (add `blocker-landing.js (#4553 — fetchBlockerLanding, the out-of-run blocker reachability verdicts behind --blocker-landing; rule in plugin/skills/flow/multispec-dependency-ordering.md)` beside merge-gate.js and waves.js) and line 222 (add `[--blocker-landing] [--blocker-states-json <path>]` to the synopsis; a `--blocker-landing (#4553) adds blockerLanding [{blocker, verdict, commit, via}] per record for out-of-run blockers, exiting 1 when the blocker query fails and 2 when owner/repo is unresolvable for a non-empty blocker set; under --records-json, --blocker-states-json supplies the MCP-fetched blocker states (open still stops; a missing or unusable state is exit 2)` clause; `--integration-branch` "is consumed only with --merge-gate" → "is consumed by --merge-gate and --blocker-landing").

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/bin-lib/preflight-records/`
  Expected: all pass. Revert the in-run filter in `outOfRunBlockers` and confirm `AC3.1, AC3.2` goes red; restore.
  Real-input probe (record the output in the commit body): `node plugin/bin/preflight-records.js 4553 --blocker-landing` → expect `records["4553"].blockerLanding` `[]` (no edges, native mode — the native call runs, no `CLOSED_EVENT` query). Independent count: `gh api repos/thn-inc/claude-tweaks/issues/4553/dependencies/blocked_by --jq length` → `0`.

- [ ] **Step 5: Commit**
  `git add plugin/bin/lib/preflight-records/preflight-records.js plugin/bin/preflight-records.js tests/bin-lib/preflight-records/preflight-records.test.js docs/plugin-structure.md`
  `git commit -m "Add --blocker-landing to preflight-records — blockerLanding per record, stop on a failed blocker query (refs #4553)"`

### Task 3: `materialize.js --check` reports `bodyBlockedBy`

**Role:** integration

**Files:**
- Modify: `plugin/bin/materialize.js` (the `--check` envelope at line ~422; the header comment's `--check` shape at line ~7 and the `USAGE`/`--help` text's at line ~65 — every place that prints `{record, check: "passed", title, ceremony, surface}`)
- Modify: `plugin/skills/flow/materialize.md` (line 7, the `--check` paragraph's printed-shape sentence)
- Modify: `docs/plugin-structure.md` (the `node plugin/bin/materialize.js` synopsis line, ~232 — its `--check` printed shape; locate by text)
- Test: `tests/materialize-design-intent.test.js` (line 146's `deepStrictEqual` expectation, plus one new test)

**Interfaces:**
- Produces: `materialize.js <n> --check` prints `{record, check: 'passed', title, ceremony, surface, bodyBlockedBy}` — `bodyBlockedBy` is `parseDependencies(record.body)` (the body's `Blocked by #N` lines — the `work-links: body-text` edges; native edges are never read here). Consumed by Task 5's 2.7b.

Return-shape widening check: `git grep -n -e "check: 'passed'" -- tests` hits only `tests/materialize-design-intent.test.js:146`; no prose cites a field count.

- [ ] **Step 1: Write the failing test** — update line 146's expected object to add `bodyBlockedBy: []`, and add `AC11.1: --check reports the body's Blocked by numbers as bodyBlockedBy` — `checkWithBody(shapedBody('Design-intent: quiet') + '\nBlocked by #5\nBlocked by #7\n')` → `bodyBlockedBy` deepEqual `[5, 7]`.
- [ ] **Step 2: Run to verify fail**
  Run: `node --test tests/materialize-design-intent.test.js`
  Expected: FAIL — the envelope lacks `bodyBlockedBy`.
- [ ] **Step 3: Implement** — add `bodyBlockedBy: parseDependencies(record.body)` to the `--check` envelope (already imported); add `bodyBlockedBy` to the printed shape in `materialize.js`'s header comment and `USAGE` text and in `docs/plugin-structure.md`'s `materialize.js` synopsis (then `git grep -n -F -e 'ceremony, surface}' -- plugin docs tests` shows no five-field shape left); in `materialize.md` line 7, `It prints {record, check: "passed", title, ceremony, surface}` → `… surface, bodyBlockedBy}`, adding `and bodyBlockedBy the body's \`Blocked by #N\` numbers (body-text edges only — /flow 2.7b's call-skip input)`.
- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/materialize-design-intent.test.js tests/flow-mechanics-cli-cutover.test.js`
  Expected: all pass.
- [ ] **Step 5: Commit**
  `git add plugin/bin/materialize.js plugin/skills/flow/materialize.md docs/plugin-structure.md tests/materialize-design-intent.test.js`
  `git commit -m "Report bodyBlockedBy from materialize --check — body-text blockers for the single-record landing check (refs #4553)"`

### Task 4: multi-spec prose — verdict table, step-3 call, gh-absent paragraph

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/flow/multispec-dependency-ordering.md` (replace the "Targets with a dependency on a target NOT in the run" section body, lines 37-39; keep line 41's "The dependency check is the same regardless…" sentence)
- Modify: `plugin/skills/flow/multi-spec.md` (Validation step 3, line 16 — add `--blocker-landing` to the call, `blockerLanding` per record to the printed keys, and "or the blocker-landing query failed" to exit 1)
- Modify: `plugin/skills/flow/multispec-preflight-failure.md` (Exit 1 paragraph: a `--blocker-landing` blocker-query failure also exits 1, with no record named; Exit 2 paragraph: an unresolvable owner/repo for a non-empty `--blocker-landing` set; one new `**Blocker landing.**` paragraph)
- Modify: `docs/skill-graph.md` (`## flow` table: one row for `bin/lib/preflight-records/blocker-landing.js`, beside line 333's `waves.js` row)
- Test: `tests/flow-blocker-landing-conformance.test.js` (new)

Moved-prose pin check: `git grep -n -F -e "which is not complete and not in this run" -e "dependency satisfied" -e "workLinks, mergeGate}" -- tests plugin` hits only the files being edited — no test pins the replaced text.

**Content the prose must carry:**
- `multispec-dependency-ordering.md` out-of-run section: the blocker set comes from Validation step 3's `--blocker-landing` call (`blockerLanding` per record); a five-row table — `open` → hard fail (stop before Step 2.8 claims); `unlanded` → hard fail, stop before Step 2.8 claims, render the card below; `landed` → satisfied; `not-applicable` → satisfied (closed `NOT_PLANNED`/`DUPLICATE`, no code); `undetermined` → proceed, and once the run directory exists (after Step 3's Manifesto write, as `multispec-merge-gate.md` times its entries) write one `SKIP` per blocker:
  `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/flow" --status SKIP --step "Step 2 blocker landing (undetermined)" --text "condition: #{blocker} blocker landing undetermined (via {via}) → fallback: proceeded without confirming its closing commit reached origin/{integration-branch}" --reversibility n/a`
  One sentence after the table: a failed blocker query is not `undetermined` — the call exits non-zero and the run stops before claiming (`multispec-preflight-failure.md`).
  The unlanded stop card (fenced) names `#{n}`, `#{blocker}`, `{commit}`, `origin/{integration-branch}` and two paste-ready escapes, each command on its own line:
  1. Land it: `git fetch origin {integration-branch}` / `git switch {integration-branch}` / `git merge {commit}` / `git push origin {integration-branch}` (under `pr-first`, open a PR from a branch carrying that merge instead).
  2. Remove the edge — `work-links: native`: `gh api -X DELETE "repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by/$(gh api repos/{owner}/{repo}/issues/{blocker} --jq .id)"`; `work-links: body-text`: `gh issue edit {n}` and delete the `Blocked by #{blocker}` line.
  Plus one line: a cherry-picked landing reads `unlanded` (different sha) — confirm by hand, then take escape 2.
- `multispec-preflight-failure.md` `**Blocker landing.**`: under `--records-json` the open-blocker stop still holds — the first call (no states file) lists each out-of-run blocker in `blockerLanding` as `undetermined`/`records-json`; fetch each listed blocker with MCP `issue_read`, write `{ "{blocker}": {"state": …, "stateReason": …} }` with the Write tool (the `mcp-agent-fetch-node-compute` pattern), and re-run the same call with `--blocker-states-json {file}`. On that second envelope an open blocker reads `open` (hard fail), a `NOT_PLANNED`/`DUPLICATE` one `not-applicable`, and every other closed blocker `undetermined` (`via: records-json` — no compare API without `gh`), so the run proceeds and writes the per-blocker `SKIP` from `multispec-dependency-ordering.md`. A states-file problem (a listed blocker missing, an unusable state) is exit 2 — a STOP, like every `--records-json` input problem. A blocker-query failure on the `gh` path is exit 1, never `undetermined`.

- [ ] **Step 1: Write the failing conformance test** `tests/flow-blocker-landing-conformance.test.js` (style of `tests/multispec-preflight-failure-conformance.test.js`, `readText` from `./helpers/read-skill`). Each test's assertions live in one helper that returns its own messages; each test also proves go-red on a mutated copy of the live text, `assert.notEqual(mutated, original)` first, `assert.throws(() => helper(mutated), { message })` matched to that assertion's own message:
  - `AC5.1: the out-of-run section names all five verdicts and their outcomes` — slice from `## Targets with a dependency on a target NOT in the run` to EOF; one row per verdict matching `` /^\| `open` \|.*hard fail/m ``, `` `unlanded` …hard fail ``, `` `landed` …satisfied ``, `` `not-applicable` …satisfied ``, `` `undetermined` …proceed ``; `--blocker-landing` named.
  - `AC5.2: the unlanded card carries blocker, commit, integration branch and both escapes on their own lines` — fenced card contains `#{blocker}`, `{commit}`, `origin/{integration-branch}`, a line `git merge {commit}`, a line starting `gh api -X DELETE`; the `unlanded` row says `before Step 2.8`.
  - `AC7.1, AC7.2: undetermined proceeds and writes one SKIP per blocker, shell-safe` — the `undetermined` row says proceed; the `log-decision.js` line carries `--status SKIP --step "Step 2 blocker landing (undetermined)"`; its `--text` has no backtick; the section says `one \`SKIP\` per blocker`.
  - `AC9.1, AC9.2: a failed blocker query is not undetermined` — the out-of-run section states a failed query stops before claiming; `multispec-preflight-failure.md`'s Exit 1 paragraph names the `--blocker-landing` query failure.
  - `multi-spec.md step 3's call passes --blocker-landing`.
  - `AC6.1, AC7.1 (gh-absent): multispec-preflight-failure.md keeps the open stop under --records-json` — the `**Blocker landing.**` paragraph names `--blocker-states-json`, `issue_read`, that an open blocker reads `open`, and that a closed one reads `undetermined`; go-red by deleting the `--blocker-states-json` sentence.
- [ ] **Step 2: Run to verify fail**
  Run: `node --test tests/flow-blocker-landing-conformance.test.js`
  Expected: FAIL (every test — none of the prose exists yet).
- [ ] **Step 3: Edit the four files** per "Content the prose must carry".
- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/flow-blocker-landing-conformance.test.js tests/multispec-preflight-failure-conformance.test.js tests/integration-branch-conformance.test.js tests/bin-lib/skill-audit/`
  Expected: all pass.
- [ ] **Step 5: Commit**
  `git add plugin/skills/flow/multispec-dependency-ordering.md plugin/skills/flow/multi-spec.md plugin/skills/flow/multispec-preflight-failure.md docs/skill-graph.md tests/flow-blocker-landing-conformance.test.js`
  `git commit -m "Apply blocker landing in multi-spec pre-flight — stop before claiming on an open or unlanded out-of-run blocker (refs #4553)"`

### Task 5: single-record Step 2 substep 2.7b

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/flow/validation.md` (line 5 "Run substeps 2.5, 2.6, and 2.7 in order" → include 2.7b; new `## 2.7b — Blocker landing (single-record)` section after 2.7, at EOF)
- Modify: `plugin/skills/flow/express-entry.md` (Express path step 2, Bind: one sentence — after the `worktree recorded` line, write any per-blocker `SKIP` lines 2.7b held, per `validation.md`)
- Modify: `plugin/skills/flow/SKILL.md` (Step 2 line 139 "Four checks" → "Five checks"; new list bullet `- 2.7b — …` between the 2.7 and 2.8 bullets; line 149 "2.5-2.7's detailed procedure" → "2.5-2.7b's detailed procedure") — net ≤ 400 B (headroom after ≈ 1,570 B)
- Test: `tests/flow-blocker-landing-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 2's `--blocker-landing` envelope and exit codes; Task 3's `bodyBlockedBy`; Task 4's verdict table and SKIP line.

**Content the prose must carry:**
- `validation.md` 2.7b: applies to a single record target only (multi-spec runs use Validation step 3's call and never run 2.7b). First: under `work-backend: local-files` skip the substep entirely, the way Step 2.8 skips itself — no `preflight-records.js` call and no log line (Decision Q4); likewise skip it, with no call and no log line, under a step list with neither `build` nor `test` (Step 2.8's own skip condition — a `review,polish,wrap-up` resume has already built). Otherwise resolve `work-links` (`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values work-links`). Under `body-text`, when Step 1 item 5's `materialize.js --check` envelope reported `bodyBlockedBy: []`, the substep is a no-op — no `preflight-records.js` call. Otherwise resolve `$INTEGRATION_BRANCH` per `_shared/integration-branch.md` and run `node "${CLAUDE_PLUGIN_ROOT}/bin/preflight-records.js" {n} --blocker-landing --integration-branch "$INTEGRATION_BRANCH"`; with `gh` absent add `--records-json {file}` per `multispec-preflight-failure.md`'s Transport paragraph, then its `**Blocker landing.**` paragraph's `--blocker-states-json` re-run, so an open blocker still stops. `records["{n}"].blockerLanding: []` → no-op — except when the envelope carries `nativeLinksUnchecked: true`, which is never "no blockers": hold one `SKIP` (`condition: blocker landing ran under --records-json with work-links: native — native blocked-by links unread → fallback: only body-text blockers judged`) and proceed. Otherwise apply `multispec-dependency-ordering.md`'s out-of-run verdict table — BLOCKED on `open`/`unlanded` before Step 2.8 claims; `undetermined` proceeds with its per-blocker `SKIP`. Every `SKIP` this substep holds is written once the run directory carries more than Step 2.8's claim lines legitimately — right after Step 3's Manifesto write or adoption (any case), or, on Step 2.9's express route (which never reaches Step 3), right after `express-entry.md`'s Bind step — never before: Step 3's adoption tolerates only Step 2.8's claim lines in `decisions.md`. A non-zero exit is handled per `multispec-preflight-failure.md`'s Exit 1 and Exit 2 paragraphs — one re-run on exit 1, then a STOP before claiming quoting stderr; exit 2 STOPs at once — and is never read as "no blockers".
- `SKILL.md` bullet (≤ ~380 B): `- 2.7b — Blocker landing. Single record target only; skipped under \`work-backend: local-files\`: one \`preflight-records.js {n} --blocker-landing\` call (none under \`work-links: body-text\` when Step 1's \`--check\` reported \`bodyBlockedBy: []\`); an \`open\` or \`unlanded\` out-of-run blocker, or a failed call, stops before 2.8 claims (\`validation.md\`).`

- [ ] **Step 1: Append the failing tests** to `tests/flow-blocker-landing-conformance.test.js`, same helper-plus-mutation discipline:
  - `AC6.1: SKILL.md lists 2.7b after 2.7 and before 2.8` — `requireOrder(text, ['- 2.7 —', '- 2.7b —', '- 2.8 —'])`; go-red by **permutation**: splice the 2.7b bullet below the 2.8 bullet and assert `requireOrder` throws `/must come after/`; a separate deletion control (2.7b bullet removed) throws `/marker missing/`.
  - `AC6.1: validation.md's 2.7b runs the landing call and stops before Step 2.8` — `## 2.7b` exists after `## 2.7 —`; the section contains `preflight-records.js" {n} --blocker-landing --integration-branch "$INTEGRATION_BRANCH"`, `before Step 2.8`, `multispec-dependency-ordering.md`, `_shared/integration-branch.md`; line 5 names 2.7b.
  - `AC11.1, AC11.2, AC6.2: the call is skipped only under body-text with bodyBlockedBy: [], and native is a no-op on blockerLanding: []` — the section contains `bodyBlockedBy: []`, `work-links`, `blockerLanding: []` and `no-op`.
  - `AC9.1: a non-zero 2.7b exit stops before claiming and is never "no blockers"` — the section cites `multispec-preflight-failure.md`'s Exit 1 and Exit 2 and says `never read as "no blockers"`.
  - `plan-review: 2.7b skips on a step list with neither build nor test, writes its SKIPs after Step 3 or after express Bind, and treats nativeLinksUnchecked as never "no blockers"` — the section contains `neither \`build\` nor \`test\``, `nativeLinksUnchecked: true`, `express-entry.md`, `after Step 3`; `express-entry.md`'s Bind step names `2.7b`; go-red by deleting each clause in turn, each matched to its own message.
  - `AC12.1: under work-backend: local-files 2.7b is skipped entirely, ahead of the work-links read` — the 2.7b section contains `work-backend: local-files`, `no \`preflight-records.js\` call` and `no log line`, and `requireOrder(section, ['work-backend: local-files', 'resolve-policy.js" --values work-links'])` (the skip precedes the `work-links` read); go-red by deletion of the local-files sentence (`/marker missing/`) and by permutation (move it after the `work-links` read, `/must come after/`); the SKILL.md 2.7b bullet names `work-backend: local-files`.
- [ ] **Step 2: Run to verify fail**
  Run: `node --test tests/flow-blocker-landing-conformance.test.js`
  Expected: FAIL on the six new tests only (Task 4's tests stay green).
- [ ] **Step 3: Edit the three files** per "Content the prose must carry". Then `wc -c plugin/skills/flow/SKILL.md` — must be < 52,500 (expect ≈ 50,900).
- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/flow-blocker-landing-conformance.test.js tests/flow-claim-preflight.test.js tests/flow-preflight-conformance.test.js tests/flow-mechanics-cli-cutover.test.js tests/bin-lib/skill-audit/`
  Expected: all pass.
- [ ] **Step 5: Commit**
  `git add plugin/skills/flow/validation.md plugin/skills/flow/SKILL.md plugin/skills/flow/express-entry.md tests/flow-blocker-landing-conformance.test.js`
  `git commit -m "Add single-record blocker-landing substep 2.7b to /flow pre-flight (refs #4553)"`

### Task 6: Full suite (folded into Common Step 5)

- [ ] Covered by `/build` Common Step 5 — `verify.js` runner, not a bare `npm test`.

Waived AC8.1: no test step can assert the whole suite passes; Common Step 5's runner-stamped full-suite verification is its evidence.
Waived AC9.3: the "(Plan-review Q1.)" provenance tag carries no behavior.
Waived AC10.4: the "(Q2.)" provenance tag carries no behavior.
Waived AC11.3: the "(Q3.)" provenance tag carries no behavior.
Waived AC12.2: the "(Plan-review Q4: Reading A.)" provenance tag carries no behavior.
Waived AC13.1: the closing rule governs how plan review routes findings; it carries no code or prose behavior — Global Constraints' "Closing rule" bullet records the edge cases decided under it.
Waived AC13.2: plan-review routing rule (edge cases are implementer judgment, recorded in the plan); no code or prose behavior — honored by Global Constraints' "Closing rule" bullet.
Waived AC13.3: plan-review stop rule (only a gap contradicting an AC or decision stops the build); governs Common Step 1.6's routing, not shipped behavior.
