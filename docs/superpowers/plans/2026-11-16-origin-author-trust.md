# Origin-line author trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `Origin:` body line counts toward provenance and trust only when the issue's author is trusted (`OWNER`/`MEMBER`/`COLLABORATOR`, or a bot/app). A record with no author data keeps today's behaviour.

**Architecture:** `provenance.js` gains one pure judge, `issueAuthorTrust(record)`, which returns `'trusted' | 'untrusted' | 'unknown'`. `resolveProvenance` takes it as an optional `authorTrust` and ignores the `Origin:` line when it is `'untrusted'`. `trust.js`'s `trustRows` computes it once per record and gates both the record's class and its corrective follow-up on it. The issue author's association is not a `gh issue list --json` field (probed: `Unknown JSON field: "authorAssociation"`). So a new module, `author-association.js`, fills it in through one aliased GraphQL batch per 200 records that carry an `Origin:` line. It runs only when the session snapshot is written, from `backlog-grant-gate.js`'s `fetchAllRecords` and `_shared/record-queue-fetch.md`'s fetch block. `UNION_FIELDS` gains `author`, which carries gh's `is_bot`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh api graphql`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T020712-record-4577/work/4577-spec.md` (record #4577)

**Ceremony:** standard · **Size:** medium · **Risk:** medium

## Decision (Deliverable 1, stated here and in the PR)

**Ignore the line; do not exclude the record.** An untrusted author's `Origin:` line is treated as absent. The record resolves `human:human` and names no follow-up target, but it still forms or joins a cell like any other human-filed record. Why: an outsider record *without* an `Origin:` line already lands in `human:human` today. Excluding only the outsider records that *wrote* the line would treat the same author differently depending on whether they typed a forgeable string. Ignoring the line makes forging a no-op instead of a new code path. Excluding would also remove evidence (an outsider's real bug report is still human-filed work).

**Fail-open direction (AC3.1, stated here and in the PR):** `authorTrust === 'unknown'` keeps today's behaviour. Unknown means no association field, which happens with a snapshot written by an older plugin build, an MCP-transport fetch, a failed enrichment batch, a hand-built record, or `local-files`. Failing closed would move every legitimate side-effect record (1,560 records here carry an `Origin:` line, all of them `MEMBER` or bot authored) into `human:human` whenever one fetch path lacks the field. That would silently rewrite every trust class. The forgery risk on that path is the pre-change risk, and it mostly points toward less autonomy.

**Grant gate unchanged (stated in the PR):** `grant-gate.js`'s `resolveProvenance` call (line 85) gets no `authorTrust`. Its candidates all pass `filterCandidates`' `facets.origin !== null` filter (`backlog-grant-gate.js:65`), so they always carry a `by:*` producer label. `resolveProvenance` returns the producer before it reads any `Origin:` line.

## Global Constraints

- Trusted association set: reuse `comment-trust.js`'s `TRUSTED_AUTHOR_ASSOCIATIONS` (`OWNER`, `MEMBER`, `COLLABORATOR`) and `commentAssociation` (it reads `authorAssociation` or `author_association`). Never retype the set. Membership is exact and case-sensitive (`'member'` is untrusted).
- Bot/installed app: gh shape `author.is_bot === true`; REST/MCP shape `user.type === 'Bot'`. A bot is trusted whatever its association. Probe: #5490 (github-actions) reads `authorAssociation: "CONTRIBUTOR"`, `__typename: "Bot"`.
- Spec Release Note, verbatim: "Trust tracking now ignores provenance lines written by people outside the repository."
- gh-api-module-pattern (`.claude/skills/gh-api-module-pattern/SKILL.md`), quoted:
  - "The module takes `runner(args)`, invoked as if `gh ${args.join(' ')}`, returning stdout; a throw is a failed call. Export `defaultRunner` = `execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', windowsHide: true }))` — always an argv array, never a shell string (no injection surface, no quoting bugs)."
  - "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**"
  - "Tests never touch real `gh`: fake runners branch on the `args` shape (`isGraphQL`, `isPost`-style lazy helpers) and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled — a wrong endpoint fails loudly instead of passing silently. Record values inside the runner, assert after it returns (an `AssertionError` thrown *inside* a runner can be swallowed by the module's own try/catch)."
  - "`gh api graphql` is where two of these rows collide: a `String!` variable needs `-f`, and `-f` never expands `{owner}`/`{repo}`, so the placeholder mechanism is unavailable to a GraphQL variable. Resolve the slug locally instead"
  - (call-bounds.md) "Every batched `gh` runner outside reconcile imports `shared-primitives.js`'s `GH_BATCH_TIMEOUT_MS` … and never retypes `timeout: 30000`". A single-call `gh repo view` takes `GH_TIMEOUT_MS`.
- CLAUDE.md: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Commit style: `{Verb} {what} — {detail}`, every message ends `refs #4577`, never `closes`/`fixes`.

## Review Focus

1. A failed enrichment batch (rate limit, timeout, network) must never fail the snapshot fetch. Its records stay `unknown` (fail open), and the other batches still apply. Task 3 test.
2. `gh api graphql` exits non-zero on a partial `NOT_FOUND` (a transferred or deleted issue; probed on #4417) but still prints `data` on stdout. The batch must use `err.stdout`'s data rather than drop all 200 records. Task 3 test.
3. A REST/MCP-shaped record (`author_association`, `user.type`) is judged exactly like a gh-shaped one. Task 1 test.
4. A bot author whose association is `CONTRIBUTOR`/`NONE` stays trusted, so github-actions-filed side-effect records keep their class. Task 1 and Task 2 tests.
5. An untrusted record whose `Origin:` line is malformed (`Origin: .`) or over-long resolves `human:human`, not the `unstructured` bucket. An ignored line is ignored wholesale. Task 1 test.

---

### Task 1: `issueAuthorTrust` and the `authorTrust` gate in `resolveProvenance`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/provenance.js`
- Test: `tests/bin-lib/issues/provenance.test.js`
- Waived `plugin/bin/lib/issues/comment-trust.js`: read only; Task 1 imports `TRUSTED_AUTHOR_ASSOCIATIONS` and `commentAssociation` from it.

**Interfaces:**
- Produces: `issueAuthorTrust(record) -> 'trusted' | 'untrusted' | 'unknown'`; `resolveProvenance({ labels, body, authorTrust } = {})` (`authorTrust` optional; only `'untrusted'` changes behaviour); both exported beside the existing `PRODUCERS`.

- [ ] **Step 1: Write the failing tests** (append to `provenance.test.js`):
  - `AC1.1: an untrusted author's Origin line joins no side-effect class` — `resolveProvenance({ labels: [], body: 'Origin: demo changes-requested from #7', authorTrust: 'untrusted' })` deepEquals `{ kind: 'human', source: 'human' }`.
  - `AC2.1: a trusted author's Origin line still resolves its class`, and the same for `authorTrust: 'unknown'` and for `authorTrust` omitted (`AC3.1`). Each deepEquals `{ kind: 'side-effect', source: 'demo changes-requested' }`.
  - `a producer label still wins for an untrusted author` — `labels: ['by:capture']`, `authorTrust: 'untrusted'` gives `{ kind: 'producer', source: 'capture' }`.
  - `an untrusted malformed Origin line resolves human, not unstructured` — bodies `'Origin: .'` and `'Origin: ' + 'x'.repeat(80)` with `'untrusted'` each give `{ kind: 'human', source: 'human' }`.
  - `issueAuthorTrust` table test with these rows:
    - `{ authorAssociation: 'OWNER' }`, `'MEMBER'` and `'COLLABORATOR'` give `'trusted'`.
    - `{ authorAssociation: 'NONE' }` and `'CONTRIBUTOR'` give `'untrusted'`.
    - `{ authorAssociation: 'member' }` gives `'untrusted'`.
    - `{ author_association: 'MEMBER' }` gives `'trusted'`; `{ author_association: 'NONE' }` gives `'untrusted'`.
    - `{ authorAssociation: 'CONTRIBUTOR', author: { is_bot: true } }` gives `'trusted'`; `{ author_association: 'NONE', user: { type: 'Bot' } }` gives `'trusted'`.
    - `{ author: { is_bot: true } }` (no association) gives `'trusted'`.
    - `{}`, `{ author: { is_bot: false } }`, `null` and `{ authorAssociation: '' }` give `'unknown'`.

- [ ] **Step 2: Run to verify failure**
  Run: `node --test tests/bin-lib/issues/provenance.test.js`
  Expected: FAIL (`issueAuthorTrust is not a function`; the untrusted case returns `side-effect`)

- [ ] **Step 3: Implement** both in `provenance.js`. `issueAuthorTrust`: check bot first (`author.is_bot === true` or `user.type === 'Bot'`), then `commentAssociation(record)`. `null` gives `'unknown'`; membership in `TRUSTED_AUTHOR_ASSOCIATIONS` gives `'trusted'`; anything else gives `'untrusted'`. In `resolveProvenance`, skip the `ORIGIN_LINE` branch entirely when `authorTrust === 'untrusted'`. Extend the header comment with two sentences: who may write an `Origin:` line (and why: `by:*` needs triage access, a body line does not), and the unknown-is-fail-open rule.

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/bin-lib/issues/provenance.test.js`
  Expected: PASS, all tests

- [ ] **Step 5: Commit**
  `git add plugin/bin/lib/issues/provenance.js tests/bin-lib/issues/provenance.test.js`
  `git commit -m "Gate Origin-line provenance on the issue author's trust — refs #4577"`

### Task 2: `trustRows` honours author trust for classes and follow-ups

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/trust.js` (`correctiveFollowUpTarget` ~line 107, `trustRows` ~lines 346 and 429-437)
- Test: `tests/bin-lib/issues/trust.test.js`

**Interfaces:**
- Consumes: Task 1 `issueAuthorTrust`, `resolveProvenance({ labels, body, authorTrust })`.
- Produces: `trustRows`' signature and row shape are unchanged. Records may now carry `authorAssociation`/`author_association`/`author`/`user`.

- [ ] **Step 1: Write the failing tests** (reuse the file's existing record builders):
  - `AC1.1: an untrusted follow-up adds nothing to the record it names`. Use a closed in-window record #7 (`Origin: ledger resolve gate`, trusted `MEMBER`) and an open record #8 with body `Origin: demo changes-requested from #7` and `authorAssociation: 'NONE'`. #7's row has `followUps === 0` and `followUpRecords === 0`. Repeat with `'CONTRIBUTOR'`.
  - `AC1.1: an untrusted closed record joins no side-effect class`. A closed record with `Origin: demo changes-requested from #7` and `authorAssociation: 'NONE'` forms no `side-effect:demo changes-requested|…` row; it counts in the `human:human|elevated` row (`total` 1).
  - `AC2.1: a trusted or bot author's follow-up still counts`. The same pair with #8 as `OWNER`, `MEMBER`, `COLLABORATOR`, and `{ authorAssociation: 'CONTRIBUTOR', author: { is_bot: true } }` each gives `followUps === 1`.
  - `AC3.1: a follow-up with no author data still counts`. #8 carries no association fields, giving `followUps === 1`.
  - Guard discrimination: the untrusted-follow-up test must go red when the follow-up gate is deleted. Make #8 an open record, which forms no cell, so that only the follow-up loop decides it. State this in the test comment. There is exactly one follow-up gate (Step 3), so the deletion is unambiguous.

- [ ] **Step 2: Run to verify failure**
  Run: `node --test tests/bin-lib/issues/trust.test.js`
  Expected: FAIL (untrusted follow-up counts 1; untrusted class forms a side-effect row)

- [ ] **Step 3: Implement.** In `trustRows`, compute `issueAuthorTrust(record)` once per record. Pass it to `resolveProvenance` in the cell loop. Skip the record in the follow-up loop when it is `'untrusted'`. That skip is the one follow-up gate, and `correctiveFollowUpTarget` stays unchanged. Add one sentence to the comment above `ORIGIN_LINE_RE` saying the line is honoured only from a trusted or unknown author (provenance.js).

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/bin-lib/issues/trust.test.js tests/bin-lib/issues/provenance.test.js tests/trust-policy-keys-conformance.test.js tests/accept-label-reader-conformance.test.js tests/bin-lib/issues/grant-sampling.test.js`
  Expected: PASS

- [ ] **Step 5: Commit**
  `git commit -m "Ignore untrusted authors' Origin lines in trust rows — refs #4577"` (explicit paths)

### Task 3: `author-association.js`, the snapshot enrichment

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/author-association.js`
- Modify: `plugin/bin/lib/issues/record-snapshot.js` (`UNION_FIELDS` gains `author`)
- Modify: `plugin/bin/lib/issues/provenance.js` (export `hasOriginLine`)
- Test: `tests/bin-lib/issues/author-association.test.js` (create), `tests/bin-lib/issues/record-snapshot.test.js` (update the pinned string)

**Interfaces:**
- Consumes: provenance.js's `ORIGIN_LINE`. Export it from provenance.js in this task as `hasOriginLine(body) -> boolean`, built on the same regex. Also consumes Task 1's `issueAuthorTrust`.
- Produces:
  - `needsAssociation(record) -> boolean`: `hasOriginLine(record.body)` and `issueAuthorTrust(record) === 'unknown'`, so it excludes bots and records already carrying an association.
  - `buildAssociationQuery(numbers: number[]) -> string`: `query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){i{n}: issue(number:{n}){authorAssociation} …}}`. Integer-only numbers (filter `Number.isInteger(n) && n > 0`); `''` for none.
  - `fetchAuthorAssociations({ numbers, owner, repo, runner, batchSize = 200 }) -> { byNumber: Map<number,string>, failedBatches: number }`.
  - `attachAuthorAssociations(records, byNumber) -> records`: a new array; each matched record is `{ ...r, authorAssociation }`; unmatched records are returned unchanged.
  - `enrichRecords(records, { runner = defaultRunner, owner, repo } = {}) -> { records, failedBatches, skipped: string|null }`: resolves owner/repo via `runner(['repo','view','--json','owner,name'])` when either is missing (`owner.login`, `name`); never throws.
  - `enrichRecordsFile(file, deps) -> same envelope`: read JSON array, enrich, write back only when something attached; never throws, and an unreadable or non-array file is returned as `skipped`.
  - `defaultRunner`: per the gh-api-module-pattern quote in Global Constraints. Use `timeout: GH_BATCH_TIMEOUT_MS` for `api graphql` and `GH_TIMEOUT_MS` otherwise, inside the one options literal, with `stdio: ['ignore','pipe','pipe']`.

- [ ] **Step 1: Write the failing tests** in `author-association.test.js`, with a fake runner per the quoted rule:
  - `buildAssociationQuery` emits one `i{n}: issue(number:{n}){authorAssociation}` per integer and drops `'7; x'`, `-1` and `1.5`.
  - `fetchAuthorAssociations` with 450 numbers makes 3 `api graphql` calls (200/200/50). The recorded argv is exactly `['api','graphql','-f',`query=${…}`,'-f','owner=o','-f','repo=r']`, with `-f`, never `-F`.
  - Partial `NOT_FOUND`: the runner throws an Error carrying `stdout` = `{"data":{"repository":{"i1":{"authorAssociation":"MEMBER"},"i2":null}},"errors":[…]}`. `byNumber` holds `1 → MEMBER`, has no key 2, and `failedBatches === 0`.
  - A batch that throws with no parseable stdout counts in `failedBatches === 1`, and the other batch's numbers are still mapped (Review Focus 1).
  - `enrichRecords` only queries records with an `Origin:` line and no bot flag (`author: { is_bot: true }` is excluded), and attaches `authorAssociation`. A record with no `Origin:` line is returned byte-identical (deepStrictEqual to input).
  - `enrichRecords` resolves owner/repo from `repo view` when neither is passed. A `repo view` that throws returns `{ skipped: 'repo-unresolved' }` and the records unchanged.
  - `enrichRecordsFile` on a temp file round-trips, and on `'not json'` returns `skipped`, leaves the file untouched, and does not throw.
  - `enrichRecordsFile` writes exactly one stderr line containing `author-association enrichment incomplete` when a batch fails. It writes nothing on a clean run.
  - `UNION_FIELDS` pin in `record-snapshot.test.js` becomes `'number,title,labels,body,state,stateReason,createdAt,closedAt,comments,updatedAt,milestone,author'`.

- [ ] **Step 2: Run to verify failure**
  Run: `node --test tests/bin-lib/issues/author-association.test.js tests/bin-lib/issues/record-snapshot.test.js`
  Expected: FAIL (module not found; UNION_FIELDS mismatch)

- [ ] **Step 3: Implement** the module per the Interfaces block. Header comment: why the snapshot fetch can't carry association (`gh issue list --json` has no `authorAssociation`), why only `Origin:` records are queried, and the fail-open posture. On a thrown runner, `JSON.parse(err.stdout)` when it is a non-empty string. A missing `data.repository` counts as a failed batch.

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/bin-lib/issues/author-association.test.js tests/bin-lib/issues/record-snapshot.test.js tests/bin-lib/issues/provenance.test.js tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-conformance.test.js tests/path-guard-conformance.test.js`
  Expected: PASS

- [ ] **Step 5: Real-input probe (scratch, uncommitted)**
  Run `enrichRecords` on the live `gh issue list --state all --json "$UNION_FIELDS" --limit 5000` output with the real `defaultRunner`. Independently count, with `jq`, the non-bot records whose body matches `(?m)^Origin:`. Plan-time count: 1,560 Origin records in total, 7 bot-authored issues in the repo. Reconcile the two counts: attached plus unmatched equals the jq count, `failedBatches === 0`, and every attached value is `MEMBER` or `OWNER`. Save the output with `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T020712-record-4577/evidence"` and redirect to `…/evidence/author-association-probe.txt`. Log one `AC evidence` entry via `log-decision.js --text-file`.

- [ ] **Step 6: Commit**
  `git commit -m "Add author-association snapshot enrichment — refs #4577"` (explicit paths)

### Task 4: Wire enrichment into the snapshot writers and update the prose

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/backlog-grant-gate/backlog-grant-gate.js` (`fetchAllRecords`, lines 82-90): enrich the live fetch before `writeSnapshot`.
  - Use a wrapper of the injected `runner`: `(args) => runner(args, { timeout: args[0] === 'api' && args[1] === 'graphql' ? GH_BATCH_TIMEOUT_MS : GH_TIMEOUT_MS })`. The CLI's real runner takes an options second argument (`plugin/bin/backlog-grant-gate.js:105`) and is otherwise unbounded on purpose. Fakes ignore the argument.
  - **Never** thread `fetch.owner`/`fetch.repo`. Those come from `--repo` for the native calls, while the issue list reads cwd's repo (`backlog-grant-gate.js:106-110`). So `enrichRecords` resolves owner/repo with `repo view` on the same runner that listed the issues.
  - When the envelope has `failedBatches > 0` or `skipped` set, write one stderr warning: `backlog-grant-gate: author-association enrichment incomplete ({failedBatches} batch(es) failed | skipped: {reason}) — records without an association keep the pre-#4577 Origin-line behaviour`. `fetchAllRecords` takes an optional `stderr` (default `(s) => process.stderr.write(s)`).
- Modify: `plugin/skills/_shared/record-queue-fetch.md`:
  - In the read-fresh-or-fetch block, add one `node -e` line before `[ -n "$SNAPSHOT" ] && cp …` that calls `enrichRecordsFile('{tmp-records-file}')`. `enrichRecordsFile` itself writes the same one-line stderr warning on `failedBatches > 0` or `skipped` (an injectable `stderr` dep, default `process.stderr.write`). Then add one paragraph naming the enrichment, its fail-open posture, and the warning.
  - The Field set line (line 44) gains `,author`.
- Modify: `plugin/skills/backlog/trust-signal.md` line 60: pass `authorTrust: issueAuthorTrust(issue)`, imported from provenance.js.
- Modify: `plugin/skills/_shared/work-record.md` "Origin axis" paragraph (line 57): add one sentence saying an `Origin:` line counts only from a trusted or bot author (`provenance.js`'s `issueAuthorTrust`).
- Modify: `plugin/skills/backlog/mcp-transport.md` step 1's `--state all` bullet: keep `author_association` and `user` from `list_issues` as they arrive. They are what `issueAuthorTrust` reads, and absent means fail open.
- Test: `tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js`, `tests/backlog-grant-gate-cli.test.js`
- Waived `plugin/bin/lib/issues/grant-gate.js`: unchanged; see Decision (candidates always carry `by:*`).

**Interfaces:**
- Consumes: Task 3 `enrichRecords`, `enrichRecordsFile`; Task 1 `issueAuthorTrust`.

- [ ] **Step 1: Write the failing test** in `backlog-grant-gate.test.js`: `fetchAllRecords enriches a live fetch before caching`. A fake runner answers `issue list` with one `Origin:` record and `api graphql` with `NONE`. The returned record and the written snapshot both carry `authorAssociation: 'NONE'`. A second case answers `api graphql` by throwing: the records still return and are cached without association, and the injected `stderr` receives one `author-association enrichment incomplete` line. A third case passes `owner: 'other'` through `computeOutlook`'s `fetch` and asserts the recorded GraphQL argv carries `owner=` from the fake `repo view` answer, never `owner=other`. A fourth case asserts the wrapper passes `{ timeout: GH_BATCH_TIMEOUT_MS }` as the runner's second argument on the `api graphql` call. Then update every existing fake runner in both test files that throws on unexpected args, so it answers `api graphql` and `repo view`. Grep first: `git grep -n "unexpected" -- tests/bin-lib/backlog-grant-gate tests/backlog-grant-gate-cli.test.js`.

- [ ] **Step 2: Run to verify failure**
  Run: `node --test tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js`
  Expected: FAIL (no `authorAssociation`)

- [ ] **Step 3: Implement** the wiring and the five prose edits. Byte check: `wc -c` each edited `plugin/skills/**/*.md` against `RAIL_BYTES` (52,500). Each grows by at most a few hundred bytes.

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js tests/backlog-grant-gate-cli.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/record-queue-fetch-conformance.test.js tests/skill-fence-guard-shapes.test.js`, then `git grep -n -F "comments,updatedAt,milestone" -- tests plugin docs` and confirm every hit carries `,author`.
  Expected: PASS; no stale field-list copy

- [ ] **Step 5: Commit**
  `git commit -m "Enrich the record snapshot with issue author association — refs #4577"` (explicit paths)

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (the rule, stated with why) | Decision section, PR body; Tasks 1-2 |
| Deliverable 2 (fetch association where trust rows are built; pass to `resolveProvenance` and `trustRows`) | Tasks 3-4 (snapshot), 1-2 (consumers) |
| Deliverable 3 (outsider forged-Origin tests) | Task 1 and Task 2 Step 1 |
| AC1.1 | Task 1, Task 2 |
| AC2.1 | Task 1, Task 2 |
| AC3.1 | Task 1, Task 2; fail-open stated in Decision and PR |
| AC4.1 (`npm test` passes) | `/claude-tweaks:build` Common Step 5 (`verify.js`, run by the controller after the last task, not a plan task) and the `/claude-tweaks:test` gate |
