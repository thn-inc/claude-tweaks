# Blocker-Landing Pre-flight Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/flow` stops before claiming when a closed out-of-run `blocked-by` prerequisite's closing commit never reached `origin/{integration-branch}`.

**Architecture:** A new pure-plus-injectable module `plugin/bin/lib/preflight-records/blocker-landing.js` (query builder, candidate extraction, classifier, fetch over the injected `gh` runner) is wired into `plugin/bin/preflight-records.js` behind an additive `--blocker-landing` flag that attaches `blockerLanding` to every record. `/flow`'s skill prose consumes it in two places — multi-spec Validation step 3's existing call, and a new single-record Step 2 substep (2.7b) — both applying one verdict table that lives in `multispec-dependency-ordering.md`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh api graphql` + `gh api repos/.../compare`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T132233-record-4553/work/4553-spec.md`

Scope keywords: blockerLanding, blocker-landing

## Global Constraints

- The five verdicts are exactly `open`, `landed`, `unlanded`, `not-applicable`, `undetermined`; each result object is exactly `{ blocker, verdict, commit, via }`.
- Out-of-run blockers only: a blocker that is one of the positional record numbers never appears in `blockerLanding`.
- Without `--blocker-landing`, `preflight-records.js` output is byte-identical to today's (no `blockerLanding` key anywhere, no extra runner call).
- Reachability goes through the REST compare API (`repos/{owner}/{repo}/compare/{base}...{sha}`): `identical`/`behind` → reachable; `ahead`/`diverged` → not reachable; any error or other status → undetermined for that candidate. No local `git fetch`, no `git merge-base`.
- "Landed if any candidate commit is reachable" — never "every candidate".
- `buildNativeDependencyQuery` in `plugin/bin/lib/issues/record-dependencies.js` stays unchanged.
- `undetermined` never stops a run; it writes one `SKIP` decision-log line per blocker. `open`/`unlanded` stop before Step 2.8 claims anything.
- Governing skill `gh-api-module-pattern` (`.claude/skills/gh-api-module-pattern/SKILL.md`), quoted verbatim:
  - "The module takes `runner(args)`, invoked as if `gh ${args.join(' ')}`, returning stdout; a throw is a failed call."
  - "Tests never touch real `gh`: fake runners branch on the `args` shape (`isGraphQL`, `isPost`-style lazy helpers) and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled — a wrong endpoint fails loudly instead of passing silently. Record values inside the runner, assert after it returns (an `AssertionError` thrown *inside* a runner can be swallowed by the module's own try/catch)."
  - "An **already-resolved** string bound to a GraphQL `String!` variable | `-f` | `-F` type-coerces an all-numeric name (`2048`) to an Int and GraphQL rejects it (#610)"
  - "**Any `-f`/`-F` field flips `gh api`'s default method from `GET` to `POST`.**" — so the compare read passes no `-f`/`-F` field at all.
  - "**A ref name interpolated into a REST path is encoded per segment.** … builds the segment as `branch.split('/').map(encodeURIComponent).join('/')`, keeping `/` a separator"
  - "**A caller-overridable REST path has no bound-variable escape hatch.** … the interpolated `owner`/`repo` values need their own validation before they reach the path … `fetch-sub-issues.js` added a narrow `owner !== '.' && owner !== '..'` guard at its own call site"
  - "**A REST call with no `--repo`/`-R` flag needs `--hostname` instead, from the same `parseRepo` host field.** … omitted when `host` is absent or `github.com`." The same holds for `gh api graphql`: "the host travels as `--hostname {host}` placed right after `graphql`".
- The new module takes `runner` as a required parameter (no `defaultRunner` of its own, like `plugin/bin/lib/issues/native-dependencies.js`); the CLI passes `deps.runner`. So no new `child_process` call site is added (the windows-hide/timeout source scans see nothing new).
- `plugin/skills/flow/SKILL.md` is 50,366 B against `RAIL_BYTES` 52,500 (headroom 2,134 B): Task 3's additions to it must stay under ~600 B net.

## Spec deviations (logged as `premise reversed` at build)

1. **AC6.2 "no `preflight-records.js` call" for a record with no edges.** The substep cannot know a record has no `blocked-by` edges without reading them, and under `work-links: native` (this repo's setting) the edges are only readable through the native GraphQL call `preflight-records.js` already makes — `materialize.js --check` reads body text only. Implemented behavior: the single-record substep makes exactly one `preflight-records.js {n} --blocker-landing` call; for a record with no out-of-run blockers that call makes **no** blocker-landing GraphQL query and **no** compare call (pinned by a CLI test), and the substep is otherwise a no-op.
2. **Candidate set = closer ∪ merged closing-PR references.** Deliverable 1 says the closing-PR references are a fallback for a null closer, but the Technical Approach requires "a blocker closed by a production hotfix PR and separately merged into `dev` by a second PR must pass" and AC-adjacent test "mixed candidates where one is reachable (`landed`)". Implemented: candidates are the closer's commit (if any) first, then every merged `closedByPullRequestsReferences` PR's `mergeCommit.oid`, deduped by sha. The incident fixture (closer PR into `production`, the same PR as the only reference) still yields `unlanded`.
3. **Whole-query failure.** A thrown/malformed blocker GraphQL response makes every queried blocker `undetermined` (`via: 'query-failed'`) plus one stderr line, rather than exit 1 — "undetermined = unverifiable", and an undetermined verdict never stops a run.

## Review Focus

1. A blocker number that does not resolve (deleted/transferred issue → alias `null`) must read `undetermined` (`via: 'not-found'`), never throw or read as landed — test in Task 1.
2. An integration branch containing `/` or `#` (e.g. `release/v1#x`) must be encoded per segment in the compare path — test in Task 1.
3. A closer that is an unmerged PR (no `mergeCommit`) contributes no candidate; with no merged references the verdict is `undetermined` (`no-candidate`) — test in Task 1.
4. Two blockers closed by the same PR must cost one compare call, not two (dedupe by sha) — test in Task 1.
5. `--blocker-landing` with no resolvable owner/repo (body-text, no origin) must yield `undetermined` (`via: 'repo-unresolved'`) plus one stderr line, exit 0 — test in Task 2.

---

### Task 1: blocker-landing module

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/preflight-records/blocker-landing.js`
- Test: `tests/bin-lib/preflight-records/blocker-landing.test.js`

**Interfaces:**
- Produces (all exported):
  - `buildBlockerLandingQuery(blockers: number[]) -> string|null` — `null` for empty/non-array. One aliased query, alias `b{n}`, `query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ … } }`, per alias exactly (probed live 2026-10-31 against #4486):
    `b{n}: issue(number:{n}){ number state stateReason timelineItems(itemTypes:[CLOSED_EVENT], last:1){ nodes{ ... on ClosedEvent { closer { __typename ... on PullRequest { number merged baseRefName mergeCommit{ oid } } ... on Commit { oid } } } } } closedByPullRequestsReferences(first:10, includeClosedPrs:true){ nodes{ number merged baseRefName mergeCommit{ oid } } } }`
  - `candidateCommits(node) -> Array<{sha: string, via: 'closer-pr'|'closer-commit'|'closing-pr-ref'}>` — closer first (`PullRequest` with `merged === true` and `mergeCommit.oid` → `closer-pr`; `Commit` with `oid` → `closer-commit`), then every merged reference with `mergeCommit.oid` (`closing-pr-ref`), deduped by sha keeping the first.
  - `reachabilityFromStatus(status: string) -> 'reachable'|'unreachable'|'error'`.
  - `compareArgs({ owner, repo, host, integrationBranch, sha }) -> string[]` — `['api', \`repos/${owner}/${repo}/compare/${encodedBase}...${sha}\`, '--jq', '.status']`, `encodedBase = integrationBranch.split('/').map(encodeURIComponent).join('/')`, plus `'--hostname', host` when `host` is set and not `github.com`. Throws on `owner`/`repo` equal to `.` or `..`.
  - `classifyBlocker(blocker: number, node: object|null, reach: Map<string, 'reachable'|'unreachable'|'error'>) -> { blocker, verdict, commit, via }`.
  - `undeterminedAll(blockers: number[], via: string) -> Array<{blocker, verdict:'undetermined', commit:null, via}>`.
  - `fetchBlockerLanding({ blockers, owner, repo, host, integrationBranch, runner }) -> { results: Map<number, result>, error: string|null }`.

**Classifier rules** (in order): `node` null → `undetermined`/`not-found`/commit null. `state === 'OPEN'` → `open`/`state`/null. `stateReason` `NOT_PLANNED` or `DUPLICATE` → `not-applicable`/`state-reason`/null. No candidates → `undetermined`/`no-candidate`/null. Any candidate `reachable` → `landed`, commit = first reachable sha, via = its via. Else any candidate `error` or absent from `reach` → `undetermined`/`probe-failed`, commit = first such sha. Else → `unlanded`, commit = first candidate sha, via = its via.

**Fetch rules:** empty `blockers` → `{results: new Map(), error: null}` and **zero runner calls**. One GraphQL call: `['api', 'graphql', ...(host && host !== 'github.com' ? ['--hostname', host] : []), '-f', \`query=${q}\`, '-f', \`owner=${owner}\`, '-f', \`repo=${repo}\`]`. Runner throw, unparseable JSON, or missing `data.repository` → `{results: undeterminedAll → Map, error: <message>}`. Otherwise compare once per unique candidate sha of every node that is CLOSED and not NOT_PLANNED/DUPLICATE; a compare throw → `'error'` for that sha. Then `classifyBlocker` per blocker (node = `repository['b'+n]`, possibly null).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/preflight-records/blocker-landing.test.js`, fake runner per the governing skill (`isGraphQL`, `isCompare = (a) => a[0]==='api' && /\/compare\//.test(a[1])`, throw `'unexpected '` otherwise; record argv, assert after). Node fixture helper `closed({ reason='COMPLETED', closer=null, refs=[] })`. Tests (names carry AC ids):
  - `AC1.1: incident — closer PR merged into production, compare diverged → unlanded with that merge commit` — node CLOSED/COMPLETED, closer `{__typename:'PullRequest', number:90, merged:true, baseRefName:'production', mergeCommit:{oid:'aaa111'}}`, refs `[{number:90, merged:true, baseRefName:'production', mergeCommit:{oid:'aaa111'}}]`; runner compare returns `'diverged\n'`; `fetchBlockerLanding({blockers:[5], owner:'acme', repo:'w', integrationBranch:'dev', runner})` → `results.get(5)` deepEqual `{blocker:5, verdict:'unlanded', commit:'aaa111', via:'closer-pr'}`; exactly one compare call (deduped).
  - `AC2.1: closer merge commit behind or identical → landed` — loop `['behind','identical']` → `{verdict:'landed', commit:'aaa111', via:'closer-pr'}`.
  - `AC2.2: NOT_PLANNED and DUPLICATE → not-applicable, no compare call` — both reasons → `{verdict:'not-applicable', commit:null, via:'state-reason'}`, compare count 0.
  - `AC2.3: COMPLETED, null closer, no merged closing PR → undetermined` — refs `[{number:91, merged:false, mergeCommit:null}]` → `{verdict:'undetermined', commit:null, via:'no-candidate'}`.
  - `null closer falls back to a merged closingPRs reference` — refs one merged PR oid `bbb222`, compare `behind` → `{verdict:'landed', commit:'bbb222', via:'closing-pr-ref'}`.
  - `mixed candidates: closer unreachable, second merged reference reachable → landed` — closer `aaa111` (`diverged`), ref `ccc333` (`behind`) → `{verdict:'landed', commit:'ccc333', via:'closing-pr-ref'}`.
  - `closer Commit object → candidate via closer-commit`.
  - `compare-API error → undetermined probe-failed` — compare throws → `{verdict:'undetermined', commit:'aaa111', via:'probe-failed'}`; and `ahead` → `unlanded`; unknown status `'weird'` → `undetermined`.
  - `open blocker → open, no compare call`.
  - `missing alias (null node) → undetermined not-found`.
  - `unmerged closer PR contributes no candidate` (Review Focus 3).
  - `two blockers closed by the same PR cost one compare call` (Review Focus 4).
  - `GraphQL throw → every blocker undetermined query-failed, error set` and `data.repository null → same`.
  - `empty blockers → zero runner calls`.
  - `graphql argv: -f query/owner/repo, --hostname right after graphql only for a non-github.com host`.
  - `compareArgs encodes the integration branch per segment and adds --hostname for GHE` — `integrationBranch:'release/v1#x'` → path contains `compare/release/v1%23x...aaa111`; host `ghe.example.com` → ends `['--hostname','ghe.example.com']`; host `github.com` → no `--hostname`; no `-f`/`-F` in argv; `owner:'..'` throws (Review Focus 2).
  - `buildBlockerLandingQuery: null for [] and non-array; one b{n} alias per blocker with stateReason, CLOSED_EVENT last:1, closedByPullRequestsReferences includeClosedPrs:true`.

- [ ] **Step 2: Run to verify fail**
  Run: `node --test tests/bin-lib/preflight-records/blocker-landing.test.js`
  Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/preflight-records/blocker-landing'`.

- [ ] **Step 3: Implement `plugin/bin/lib/preflight-records/blocker-landing.js`** per the Interfaces, rules and header comment style of `merge-gate.js` (file-path first line, purpose, `'use strict'`). Header names #4553, the five verdicts, the any-candidate-landed rule, why compare-API rather than local git, and that `buildNativeDependencyQuery` is deliberately not reused.

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/bin-lib/preflight-records/blocker-landing.test.js`
  Expected: all pass. Then revert one classifier rule (e.g. make `behind` unreachable) and confirm `AC2.1` goes red; restore.

- [ ] **Step 5: Commit**
  `git add plugin/bin/lib/preflight-records/blocker-landing.js tests/bin-lib/preflight-records/blocker-landing.test.js`
  `git commit -m "Add blocker-landing module — classify out-of-run blockers by integration-branch reachability (refs #4553)"`

### Task 2: `preflight-records.js --blocker-landing`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/preflight-records/preflight-records.js` (new export `outOfRunBlockers`)
- Modify: `plugin/bin/preflight-records.js` (header comment, `USAGE`, `parseArgs`, `loadFromGh` return, `run`)
- Modify: `docs/plugin-structure.md` (line 60 `plugin/bin/lib/preflight-records/` entry; line 217 CLI line)
- Test: `tests/bin-lib/preflight-records/preflight-records.test.js` (append a `// --- CLI: --blocker-landing (#4553)` section)

**Interfaces:**
- Consumes: Task 1's `fetchBlockerLanding`, `undeterminedAll`.
- Produces (lib): `outOfRunBlockers(records, numbers: number[]) -> { byRecord: Map<number, number[]>, union: number[] }` in `plugin/bin/lib/preflight-records/preflight-records.js` — per record its `blockedBy` minus every positional number (order kept), `union` deduped and ascending.
- Produces: envelope `records["<n>"].blockerLanding: Array<{blocker, verdict, commit, via}>` (out-of-run blockers of that record, in `blockedBy` order; `[]` when none) — present only with `--blocker-landing`.

**Behavior:** `parseArgs` gains `blockerLanding: false` / `--blocker-landing`. `--integration-branch` (default `'main'`) is now consumed by `--merge-gate` **and** `--blocker-landing`. `loadFromGh` additionally returns `repoSpec`. In `run`, after `buildRecords`, when `opts.blockerLanding`: `const { byRecord, union } = preflight.outOfRunBlockers(records, numbers)`. Union empty → every record `blockerLanding: []`, no runner call. `--records-json` → every out-of-run blocker `undeterminedAll(..., 'records-json')` and one stderr line `preflight-records.js: --records-json makes no gh call — blocker landing undetermined for #a, #b\n` (only when the union is non-empty). gh path with no `repoSpec` → `undeterminedAll(..., 'repo-unresolved')` + one stderr line naming it. Otherwise `fetchBlockerLanding({ blockers: union, owner, repo, host, integrationBranch: opts.integrationBranch || 'main', runner: deps.runner })`; a non-null `error` → one stderr line `preflight-records.js: blocker landing query failed — undetermined: {error}\n`. Exit code unchanged (0). Header comment and `USAGE` add `[--blocker-landing]`; header gets one paragraph describing the flag, the out-of-run rule, the `--records-json` degrade.

- [ ] **Step 1: Write the failing tests** (reuse the file's `cliDeps`, `issue`, `specBody`, `isGraphQL`, `isIssueView`; add `isCompare`):
  - `AC3.1, AC3.2: 10 11 --blocker-landing --integration-branch dev — landing for out-of-run #5 only, in-run #10 never appears` — body-text; #11 body `Blocked by #10\nBlocked by #5\n\n…`; runner answers the blocker GraphQL with `{data:{repository:{b5: <closed COMPLETED, closer PR oid 'eee555'>}}}` and asserts (after) the query names `b5` and not `b10`; compare `behind`; assert `env.records['11'].blockerLanding` deepEqual `[{blocker:5, verdict:'landed', commit:'eee555', via:'closer-pr'}]`, `env.records['10'].blockerLanding` deepEqual `[]`, recorded compare path contains `compare/dev...eee555`.
  - `AC4.1: without --blocker-landing the envelope is byte-identical and no extra call is made` — run the same fixture with and without… assert the no-flag stdout equals `JSON.stringify(expectedEnvelope, null, 2) + '\n'` built from today's keys, contains no `blockerLanding`, and makes 0 graphql / 0 compare calls; plus re-run test `(a)`'s fixture comparing to its pre-change output literal.
  - `AC6.2: a record with no out-of-run blockers makes no blocker-landing query and no compare call` — `720 --blocker-landing` with no `Blocked by` → `blockerLanding: []`, graphql count 0, compare count 0.
  - `--blocker-landing under --records-json: undetermined records-json, one stderr line, no runner call`.
  - `--blocker-landing with no resolvable repo: undetermined repo-unresolved, stderr line, exit 0` (Review Focus 5; `remoteUrl` throws, body-text).
  - `--blocker-landing GraphQL failure: undetermined query-failed, stderr line, exit 0`.
  - `--help usage names --blocker-landing`.
  - `outOfRunBlockers: drops in-run numbers, keeps blockedBy order, union deduped ascending` (lib unit test).

- [ ] **Step 2: Run to verify fail**
  Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js`
  Expected: FAIL — `unknown argument: --blocker-landing`.

- [ ] **Step 3: Implement** the Behavior above in `plugin/bin/preflight-records.js`; update `docs/plugin-structure.md` line 60 (add `blocker-landing.js (#4553 — fetchBlockerLanding, the out-of-run blocker reachability verdicts behind --blocker-landing; rule in plugin/skills/flow/multispec-dependency-ordering.md)`) and line 217 (add `[--blocker-landing]` to the synopsis and a `--blocker-landing (#4553) adds blockerLanding [{blocker, verdict, commit, via}] per record for out-of-run blockers; --integration-branch is consumed by --merge-gate and --blocker-landing` clause, replacing "is consumed only with --merge-gate").

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/bin-lib/preflight-records/`
  Expected: all pass. Revert the in-run filter in `outOfRunBlockers` and confirm `AC3.1, AC3.2` goes red; restore.
  Real-input probe: `node plugin/bin/preflight-records.js 4553 --blocker-landing` (live repo, native mode) — expect `records["4553"].blockerLanding` `[]` (no blockers); record the output in the commit message body.

- [ ] **Step 5: Commit**
  `git add plugin/bin/lib/preflight-records/preflight-records.js plugin/bin/preflight-records.js tests/bin-lib/preflight-records/preflight-records.test.js docs/plugin-structure.md`
  `git commit -m "Add --blocker-landing to preflight-records — blockerLanding per record for out-of-run blockers (refs #4553)"`

### Task 3: `/flow` prose — verdict table, multi-spec call, single-record substep

**Role:** integration

**Files:**
- Modify: `plugin/skills/flow/multispec-dependency-ordering.md` (replace the "Targets with a dependency on a target NOT in the run" section body, lines 35-41)
- Modify: `plugin/skills/flow/multi-spec.md` (Validation step 3 line — add `--blocker-landing` to the call and `blockerLanding` to the printed keys)
- Modify: `plugin/skills/flow/validation.md` (line 5 "Run substeps 2.5, 2.6, and 2.7" → include 2.7b; new `## 2.7b — Blocker landing (single-record)` section after 2.7)
- Modify: `plugin/skills/flow/SKILL.md` (Step 2: "Four checks" → "Five checks"; new list bullet `- 2.7b — …` between 2.7 and 2.8; "2.5-2.7's detailed procedure" → "2.5-2.7b's detailed procedure") — net ≤ 600 B
- Modify: `plugin/skills/flow/multispec-preflight-failure.md` (one paragraph: under `--records-json` blocker landing is `undetermined`, with the per-blocker `SKIP`)
- Modify: `docs/skill-graph.md` (`## flow` table: one row for `bin/lib/preflight-records/blocker-landing.js`)
- Test: `tests/flow-blocker-landing-conformance.test.js` (new)

**Content the prose must carry:**
- `multispec-dependency-ordering.md` out-of-run section: the blocker set comes from Validation step 3's `--blocker-landing` call (`blockerLanding` per record); a five-row table — `open` → hard fail (stop before Step 2.8 claims); `unlanded` → hard fail, stop before Step 2.8 claims, render the card below; `landed` → satisfied; `not-applicable` → satisfied (closed `NOT_PLANNED`/`DUPLICATE`, no code); `undetermined` → proceed, and once the run directory exists (after Step 3's Manifesto write, as `multispec-merge-gate.md` times its entries) write one `SKIP` per blocker:
  `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/flow" --status SKIP --step "Step 2 blocker landing (undetermined)" --text "condition: #{blocker} blocker landing undetermined (via {via}) → fallback: proceeded without confirming its closing commit reached origin/{integration-branch}" --reversibility n/a`
  The unlanded stop card (fenced) names `#{n}`, `#{blocker}`, `{commit}`, `origin/{integration-branch}` and two paste-ready escapes, each command on its own line:
  1. Land it: `git fetch origin {integration-branch}` / `git switch {integration-branch}` / `git merge {commit}` / `git push origin {integration-branch}` (under `pr-first`, open a PR from a branch carrying that merge instead).
  2. Remove the edge — `work-links: native`: `gh api -X DELETE "repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by/$(gh api repos/{owner}/{repo}/issues/{blocker} --jq .id)"`; `work-links: body-text`: `gh issue edit {n}` and delete the `Blocked by #{blocker}` line.
  Plus one line: a cherry-picked landing reads `unlanded` (different sha) — confirm by hand, then take escape 2. Keep the existing "The dependency check is the same regardless…" sentence.
- `validation.md` 2.7b: applies to a single record target only (multi-spec runs use Validation step 3's call and never run 2.7b); resolve `$INTEGRATION_BRANCH` per `_shared/integration-branch.md`; run `node "${CLAUDE_PLUGIN_ROOT}/bin/preflight-records.js" {n} --blocker-landing --integration-branch "$INTEGRATION_BRANCH"`; with `gh` absent add `--records-json {file}` per `multispec-preflight-failure.md`'s Transport paragraph; a record with no `blocked-by` edges reads `blockerLanding: []` and the substep is a no-op (the call makes no blocker query or compare call); apply `multispec-dependency-ordering.md`'s out-of-run verdict table — BLOCKED on `open`/`unlanded` before Step 2.8 claims, `undetermined` proceeds with its `SKIP` lines; a non-zero exit is a STOP before claiming quoting stderr (never read as "no blockers").
- `SKILL.md` bullet (≤ ~330 B): `- 2.7b — Blocker landing. Single record target only: one \`preflight-records.js {n} --blocker-landing\` call; an \`open\` or \`unlanded\` out-of-run blocker stops before 2.8 claims (\`validation.md\`).`
- `multispec-preflight-failure.md`: one paragraph `**Blocker landing.**` — under `--records-json` every out-of-run blocker reads `undetermined` (`via: records-json`), so the run proceeds and writes the per-blocker `SKIP` from `multispec-dependency-ordering.md`.

- [ ] **Step 1: Write the failing conformance test** `tests/flow-blocker-landing-conformance.test.js` (style of `tests/multispec-preflight-failure-conformance.test.js`, `readText` from `./helpers/read-skill`):
  - `AC5.1: the out-of-run section names all five verdicts and their outcomes` — slice from `## Targets with a dependency on a target NOT in the run` to EOF; for each verdict assert a table row matching `` /^\| `open` \|.*hard fail/m ``, `` `unlanded` …hard fail ``, `` `landed` …satisfied ``, `` `not-applicable` …satisfied ``, `` `undetermined` …proceed ``; assert `--blocker-landing` named.
  - `AC5.2: the unlanded card carries blocker, commit, integration branch and both escapes on their own lines` — fenced card contains `#{blocker}`, `{commit}`, `origin/{integration-branch}`, a line `git merge {commit}`, a line starting `gh api -X DELETE`, and `before Step 2.8` in the unlanded row.
  - `AC6.1: SKILL.md lists 2.7b before 2.8, and validation.md's 2.7b stops before Step 2.8` — index of `- 2.7b —` < index of `- 2.8 —` and > index of `- 2.7 —`; validation.md has `## 2.7b`, its section contains `preflight-records.js" {n} --blocker-landing --integration-branch "$INTEGRATION_BRANCH"`, `before Step 2.8`, `multispec-dependency-ordering.md`, `_shared/integration-branch.md`; the section's position is after `## 2.7`.
  - `AC6.2: the substep is a no-op for a record with no blocked-by edges` — 2.7b section matches `/no-op/` and `blockerLanding: \[\]`.
  - `AC7.1, AC7.2: undetermined proceeds and writes one SKIP per blocker, shell-safe` — the `undetermined` row says proceed; the `log-decision.js` line carries `--status SKIP --step "Step 2 blocker landing (undetermined)"`; its `--text` has no backtick; the section says `one \`SKIP\` per blocker`.
  - `multi-spec.md step 3's call passes --blocker-landing` and `multispec-preflight-failure.md states blocker landing is undetermined under --records-json`.
  Prove each go-red: run before editing the prose (Step 2).

- [ ] **Step 2: Run to verify fail**
  Run: `node --test tests/flow-blocker-landing-conformance.test.js`
  Expected: FAIL (every test — none of the prose exists yet).

- [ ] **Step 3: Edit the six files** per "Content the prose must carry". Then `wc -c plugin/skills/flow/SKILL.md` — must be < 52,500 (expect ≈ 50,750).

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/flow-blocker-landing-conformance.test.js tests/multispec-preflight-failure-conformance.test.js tests/integration-branch-conformance.test.js tests/flow-claim-preflight.test.js tests/flow-preflight-conformance.test.js tests/bin-lib/skill-audit/`
  Expected: all pass.

- [ ] **Step 5: Commit**
  `git add plugin/skills/flow/multispec-dependency-ordering.md plugin/skills/flow/multi-spec.md plugin/skills/flow/validation.md plugin/skills/flow/SKILL.md plugin/skills/flow/multispec-preflight-failure.md docs/skill-graph.md tests/flow-blocker-landing-conformance.test.js`
  `git commit -m "Wire blocker landing into /flow pre-flight — stop before claiming on an open or unlanded out-of-run blocker (refs #4553)"`

### Task 4: Full suite (folded into Common Step 5)

- [ ] Covered by `/build` Common Step 5 — `verify.js` runner, not a bare `npm test`.

Waived AC8.1: no test step can assert the whole suite passes; Common Step 5's runner-stamped full-suite verification is its evidence.
