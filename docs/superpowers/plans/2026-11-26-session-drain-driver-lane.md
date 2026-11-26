# Session Drain Driver Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `policyOnly` policy value `express-driver-runner` (`session` default, `script`) under which dispatch's session drain never selects driver-routable singleton records, leaving them to a `drive.js --budget` script job, while the budget loop's own pull still selects them.

**Architecture:** `expressQueuePolicy` (`plugin/bin/lib/express/queue.js`) exposes its existing `driverRoutable` predicate, whether the driver half is on, and the routing value it read. The runner value is read by the pass core with its own one-key resolver call, outside `GROUPING_INPUTS`, so the queue-order fingerprint and every persisted blob stay unchanged (plan review: a grouping input would invalidate every cache on upgrade and break AC2's byte identity; a deliberate departure from the spec's "queue.js: expose … the runner value" Key Files note). A new pure pass core (`plugin/bin/lib/dispatch/driver-lane.js`) turns those plus one batched comment read (new `bin/resolve-record-comments.js` over `bin/lib/issues/record-comments.js`) into staying `driver-lane` exclusions; the queue-pull module registers it as a `PASSES` row (so `STAYING_EXCLUSION_REASONS` / `RANK_SKIP_REASONS` / budget's `UNSELECTABLE_REASONS` pick it up by derivation), and `runBudget` passes `omit: ['driver-lane']`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh api graphql`.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T085819-record-6119/work/6119-spec.md` (record #6119)

**Scope keywords:** driver-lane, express-driver-runner, STAYING_EXCLUSION_REASONS, neighbour-in-flight

## Global Constraints

- Key name `express-driver-runner`, values `session` | `script`, default `session`, `policyOnly: true`, tier `advanced`. Final, per the spec.
- Exclusion reason `driver-lane`. Final, per the spec. Staying (`removes: false`), joins `STAYING_EXCLUSION_REASONS` by derivation only, never by hand.
- `driverRoutable` is the exclusion's predicate, reused from `expressQueuePolicy`, never rebuilt.
- The exclusion runs over singleton groups only, after grouping.
- `hasDriverEscalationMarker` (`plugin/bin/lib/driver/settle.js`) is the marker check's only predicate.
- Comments are read once, batched, only for the records the exclusion would remove; a failed or partial read excludes nothing for those records.
- Under `express-driver: off` the value is ignored, with one stderr line per pull, printed only when the value is `script`.
- Under `script`, a pull that excludes records prints exactly one warn-tier line `driver-lane: left to the script job: #a, #b`.
- No staleness bound returns a record to the session pool.
- `runBudget` passes `omit: ['driver-lane']`.
- Every new test fails when its source change is reverted (revert-and-run in each task's verification step).
- Commit subjects `{Verb} {what} — {detail}` ending `refs #6119`, never `closes`/`fixes`.

## Review Focus

1. A `script` pull where `resolve-record-comments.js` exits non-zero or prints non-JSON: every candidate stays selectable, one `Warning:` line, no throw out of the pass (Task 4 test `comment read failure keeps every candidate`).
2. A record whose comment list is truncated (`totalCount` above the 100 nodes fetched): stays selectable (Task 2 `complete: false`, Task 4 `incomplete comments keep the record`).
3. A trusted-looking marker comment from a non-member (`CONTRIBUTOR`): the record is excluded, because only a trusted marker spares it (Task 4 `untrusted marker does not spare`).
4. A bundle group containing a driver-routable member (should not exist, but a persisted cache-hit blob from before the policy change could hold one): never excluded, since only singleton groups are judged (Task 4 `bundle group never excluded`).
5. `--transport files` under `script`: no CLI spawn, one Warning, nothing excluded (Task 5 `files transport fails open`).

---

### Task 1: The `express-driver-runner` policy key

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (row after `express-driver-protected-paths`, with a comment above it stating the `policyOnly` and factory-refusal decisions)
- Modify: `plugin/bin/lib/policy-factory.js` (`FACTORY_REFUSED_KEYS`)
- Modify: `plugin/skills/_shared/policy-schema-express-driver.md` (new row)
- Modify: `plugin/skills/_shared/policy-schema.md` (index row in `## Express driver`, registration sentence)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (`policyOnly` bullet)
- Modify: `plugin/skills/_shared/policy-schema-read-path.md` (Factory layer Refused keys bullet)
- Modify: `docs/journeys/resolve-a-policy-key.md` (step 3 Red flags `policyOnly` list)
- Test (AC6.1, AC6.2): `tests/policy-schema.test.js` (count 125 -> 126, `Last bump: 125 -> 126, #6119`, both assertions), `tests/policy.test.js` (pin)

**Interfaces:**
- Produces: `resolvePolicyKeys(['express-driver-runner'])` -> `{ value: 'session'|'script', source, invalid? }`; unset gives `{ value: 'session', source: 'default' }`; malformed (e.g. `Script`) gives `session` with `invalid: true`.

Decisions (state them in the comment above the row): `policyOnly` because the only consumer (the queue pull's driver-lane pass, Task 4's `readDriverRunner`) resolves with `runDir: null`, so a `--run` overlay would report a value nothing reads, and because the value decides whether autonomous machinery or a session builds records. Factory-refused because whether a script job drains a repository is a fact of that one repository: a user-wide `script` would leave every other project's driver-routable records unbuilt.

- [ ] **Step 1: Write the failing tests.** In `tests/policy.test.js` add `test('#6119 express-driver-runner: enum session|script, default session, policyOnly, factory-refused')` asserting the `POLICY_KEYS` row's `type === 'enum'`, `values` deep-equal `['session', 'script']`, `default === 'session'`, `policyOnly === true`, `tier === 'advanced'`, `FACTORY_REFUSED_KEYS.includes('express-driver-runner')`, and resolving a raw `express-driver-runner: Script` gives `value: 'session'` with `invalid: true` while `script` gives `value: 'script'`. Bump `tests/policy-schema.test.js` to 126 with the `Last bump: 125 -> 126, #6119` line.
- [ ] **Step 2: Run** `node tools/run-tests.js tests/policy.test.js tests/policy-schema.test.js` — Expected: FAIL (row missing).
- [ ] **Step 3: Add the row and the refusal.** `summary`: "Who drives driver-routable records: the dispatch session drain (session) or a drive.js --budget script job (script)." (category `merge-safety`). Docs row in `policy-schema-express-driver.md`, stating from the code: unset or malformed gives `session`; `script` takes effect only under `express-driver` `on` or `split` (under `off` it is ignored, with one queue-pull stderr line); under `script` the queue pull excludes driver-routable singleton records as `driver-lane` and `drive.js --budget` still selects them; `script` with no script job running leaves those records unbuilt, which is why the default is `session`; the accepted cost: when the comment read fails those records stay selectable, so a session drain may route one through its driver route and race the script job for it, and the claim (`claim-targets.js`) lets only one build it. `policy-schema.md`: add the index row and name `#6119` plus "the queue pull reads `express-driver-runner`" in the registration sentence. Measure `wc -c plugin/skills/_shared/policy-schema.md` first: it sits at 51,984 B of the 52,500 B rail; keep the addition under 400 B. Add the key to the `policyOnly` bullet, the Refused keys bullet (with the reason above) and the journey's Red flags list.
- [ ] **Step 4: Run** `node tools/run-tests.js tests/policy.test.js tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/resolve-policy-control-mode.test.js` — Expected: PASS. Revert the `POLICY_KEYS` row, rerun `tests/policy.test.js`, confirm red, restore (AC7.1, AC7.2).
- [ ] **Step 5: Commit** — `Add the express-driver-runner policy key — session or script job drives driver-routable records, refs #6119`

### Task 2: Batched record-comment read

**Files:**
- Create: `plugin/bin/lib/issues/record-comments.js`
- Create: `plugin/bin/resolve-record-comments.js` (on `makeNumberListCli`, as `bin/resolve-linked-prs.js` is)
- Modify: `docs/plugin-structure.md` (CLI line), `docs/skill-graph.md` (the `/dispatch` queue pull's edge to the CLI)
- Test: `tests/bin-lib/issues/record-comments.test.js`, `tests/resolve-record-comments-cli.test.js`

**Interfaces:**
- Produces: `buildRecordCommentsQuery(numbers: number[]) -> string|null` (null for an empty list); `fetchRecordComments({ numbers, owner, repo, host, runner }) -> Map<number, { comments: object[], complete: boolean }>`. The query is one aliased GraphQL call: `query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ i{n}: issue(number:{n}){ comments(last:100){ totalCount nodes{ body authorAssociation url author{login} } } } } }` (run live once while planning: works, `totalCount` and `authorAssociation` come back). `complete` is `totalCount === nodes.length`. Throws when `data.repository` is missing; a missing `i{n}` alias leaves that number out of the Map (the caller reads an absent entry as unread). `-f` for owner/repo, `--hostname` for a non-github.com host (`gh-api-module-pattern`).
- Produces CLI: `resolve-record-comments.js <n>[,<n2>...] [--repo [host/]owner/name]` prints one JSON object keyed by number to `{ comments, complete }`; exits 0/1/2/3 exactly as `resolve-linked-prs.js` documents.

- [ ] **Step 1: Write the failing tests** with a fake runner: two records, one complete with a `MEMBER` marker comment, one with `totalCount: 150` and 100 nodes -> `complete: false`; a missing alias -> absent from the Map; `repository: null` -> throws naming the numbers; argv carries `-f owner=`, `-f repo=` and `--hostname` only for a GHE host. CLI test: `run([...], fakeDeps)` prints the keyed object and exits 3 when the fetch throws.
- [ ] **Step 2: Run** `node tools/run-tests.js tests/bin-lib/issues/record-comments.test.js tests/resolve-record-comments-cli.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the module and the CLI; add the CLI's `docs/plugin-structure.md` line and its `docs/skill-graph.md` edge.
- [ ] **Step 4: Run** the two files plus any CLI-registry/source-scan conformance suite that walks `plugin/bin/` (`git grep -l "resolve-linked-prs" -- tests` lists the ones a sibling CLI is enrolled in) — Expected: PASS. Revert `record-comments.js`, confirm red, restore.
- [ ] **Step 5: Commit** — `Add a batched record-comment reader — one aliased GraphQL call for the driver-lane marker check, refs #6119`

### Task 3: Expose the driver predicate from `expressQueuePolicy`

**Files:**
- Modify: `plugin/bin/lib/express/queue.js`
- Test: `tests/bin-lib/express/queue.test.js`

**Interfaces:**
- Produces: every object `expressQueuePolicy(deps)` returns gains `driverOn: boolean`, `driverRoutable: (issue) => boolean` (never throws: a throwing check answers false) and `routing: 'off'|'split'|'on'|null` (the `express-driver` value read; `null` when the first read failed or the value is not recognised). Disabled shapes carry `driverOn: false`, `driverRoutable: () => false` and the routing read, so a consumer can tell routing `off` from a driver half that failed to build. `FIRST_KEYS`, `SECOND_KEYS` and `GROUPING_INPUTS` are unchanged: the fingerprint of every project stays byte-identical.
- A comment at `driverRoutable`'s definition names its two gates: bundling (`keepSingleton`) and the `driver-lane` exclusion.

- [ ] **Step 1: Write the failing tests:** under `express-driver: on` with a fake resolver, `driverRoutable` accepts the same record `keepSingleton` keeps and refuses a standard one; `driverOn` is true for `on`/`split`, false for `off`; on `on` with a failing second read, `driverOn` is false and `routing` is `on`; `routing` is `null` when the first read throws; the fingerprint for a fixed value set equals the one computed before this change (assert `groupingFingerprint` over the same values is unchanged and `GROUPING_INPUTS` has no `express-driver-runner`).
- [ ] **Step 2: Run** `node tools/run-tests.js tests/bin-lib/express/queue.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.** `keepSingleton`'s driver branch calls the same wrapped predicate.
- [ ] **Step 4: Run** the file — Expected: PASS. Revert, confirm red, restore.
- [ ] **Step 5: Commit** — `Expose the driver-routable predicate from expressQueuePolicy — one predicate for bundling and the driver lane, refs #6119`

### Task 4: The `driver-lane` pass core and the live-fetch audit

**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/dispatch/driver-lane.js`
- Test: `tests/bin-lib/dispatch/driver-lane.test.js`

- Read: `plugin/bin/lib/driver/settle.js` (`hasDriverEscalationMarker`), `plugin/bin/lib/dispatch/exclusions.js` (`appendExclusion`)

**Interfaces:**
- Consumes: Task 3's `{ driverOn, driverRoutable, routing }`; Task 1's key; Task 2's CLI output shape; `hasDriverEscalationMarker`.
- Produces: `readDriverRunner({ resolvePolicy, stderr }) -> 'session'|'script'` — one `resolvePolicy(['express-driver-runner'], { runDir: null })` call (default `express/policy.js`'s `defaultResolvePolicy`, no CLI spawn); a throwing read returns `session` with `Warning: express-driver-runner unreadable — treated as session this pull: {cause}\n`.
- Produces: `driverLaneExclusions({ groups, policy, runner, readComments, stderr }) -> entries[]`, each `{ reason: 'driver-lane', records: [n], detail: { runner: 'script' } }`. `readComments(numbers) -> { ok: true, byNumber: { [n]: { comments, complete } } } | { ok: false, cause: string }`. Rules, in order: `runner !== 'script'` -> `[]`, silent; `policy.routing === 'off'` -> `[]` plus `express-driver-runner: script ignored while express-driver is off; driver-routable records stay with the session drain\n`; any other `!driverOn` -> `[]` plus `Warning: driver-lane: the driver predicate is unavailable this pull — no driver-lane exclusions\n`; candidates = singleton groups whose member `driverRoutable` accepts; none -> `[]` with no read; read failed -> `[]` plus `Warning: driver-lane comment read failed — no driver-lane exclusions this pull: {cause}\n`; a candidate is excluded only when its entry exists, `complete === true` and `hasDriverEscalationMarker(comments) === false`; a non-empty result prints `driver-lane: left to the script job: #a, #b\n` once.
- Produces: `spawnCommentReader({ spawnCli, cwd, env }) -> readComments` (spawns `resolve-record-comments.js` with the comma-joined numbers; non-zero exit or unparseable stdout -> `{ ok: false, cause }`), and `runFromFiles({ groupsPath, exclusionsPath, transport })` for the retained fence (real policy, real spawn, `appendExclusion` per entry; `transport === 'files'` -> no spawn, a read reported failed with cause `comment read unavailable on the files transport`).
- Produces: `LIVE_FETCH_AUDIT` — a frozen map from every key of `ADMISSION_REASONS` (`driver/admission.js`) and of `REASONS` and `BOUND_REASONS` (`express/eligibility.js`) to one of `'driverRoutable'` (decided from pulled data by the predicate), `'pull'` (another queue-pull filter or pass removes the record first: the eligibility filter for grants/`bot:*`/open state, `blocked`/`unlanded-blocker` for blockers, `open-pr` for linked PRs) or `'live-check'` (this pass's marker read: `escalatedByDriver`, `commentsUnreadable`). Its header comment records the audit: the driver's eligibility step reads only `number,title,body,labels,state` and the policy, all in the pulled data; the admission step's live-only facts are blockers, linked PRs, state and comments, and only comments are not covered by another pass. It also names the two refusals outside the three registries: eligibility's `['not eligible']` fallback (`steps.js`, reachable only for a verdict with no reasons, which `evaluateRecordEligibility` never returns when `eligible` is false) and the reviewer reason it appends (`reviewerGateReason`, decided by the predicate); and `REASONS.escalated` is classed `driverRoutable` because `eligibilityOptions` never sets `escalated`, so the same options refuse it identically on both sides.

- [ ] **Step 1: Write the failing tests** (name each with its AC clause): `AC1.1 script excludes a driver-routable singleton and keeps a standard record`; `AC3.1 a trusted marker keeps the record selectable`; `AC3.2 a failed comment read keeps every candidate` (asserts the Warning, `[]`); `incomplete comments keep the record`; `untrusted marker does not spare`; `bundle group never excluded`; `AC5.1 express-driver off: script excludes nothing and prints one line` (and `session` under off prints nothing); `driver half unavailable under on prints the unavailable Warning, not the off line`; `readDriverRunner: a throwing resolver reads session with one Warning`; `AC9.1 the left-to-the-script-job line names every excluded record`; `no candidates makes no comment read` (the fake `readComments` records calls); `AC8.1 every eligibility and admission refusal reason is classified` — iterate `Object.keys` of the three registries and assert each maps to one of the three words, then assert the map has no extra keys.
- [ ] **Step 2: Run** `node tools/run-tests.js tests/bin-lib/dispatch/driver-lane.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS. Then revert the module (red, AC7.2), and separately add a fake key (AC8.2) to a copy of `ADMISSION_REASONS` in a scratch run (or temporarily in source) and confirm `AC8.1` goes red; restore.
- [ ] **Step 5: Commit** — `Add the driver-lane pass core — leaves driver-routable singletons to the script job, refs #6119`

### Task 5: Register `driver-lane` in the queue pull, mirror it in the retained fence

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (`PASSES` row, `RUNNERS`, `runDriverLane`, write-back omit rule, header `omit` paragraph)
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (header bullet, pass block, byte cut)
- Modify: `plugin/skills/dispatch/next-ranking.md` and `plugin/skills/dispatch/firing-exclusion.md` (the `['oversized', 'firing', 'neighbour-in-flight']` literal gains `'driver-lane'`)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js`, plus whatever parity/registry suites go red (`tests/bin-lib/dispatch/queue-pull-parity-*.test.js`, `tests/dispatch-named-form-exclusion-reasons.test.js`, `tests/dispatch-firing-exclusion.test.js`)

**Interfaces:**
- Consumes: Task 4's `driverLaneExclusions`, `spawnCommentReader`, `runFromFiles`.
- Produces: `PASSES` row `row('driver-lane', 'exclusion', 'driver-lane', false, true, true, 'open', 'fails-open')`, placed after the two `blocker-landing` rows and before `neighbour-in-flight` (after every removing pass, so a record they remove costs no comment read). `runDriverLane(ctx)`: skipped on `ctx.omit.has('driver-lane')`; reads `dispatch-groups.json`, calls `deps.expressQueuePolicy({ stderr: deps.stderr })` and `deps.readDriverRunner({ stderr: deps.stderr })` (new `defaultDeps` member, defaulting to Task 4's `readDriverRunner`, so the test harness fakes it), a `readComments` that on `files` transport reports the read unavailable and otherwise is `spawnCommentReader` over `ctx.deps.spawnCli`; appends each entry through `appendExclusion`; a thrown `appendExclusion` stops the pull with `dispatch: queue-pull stopped -- driver-lane exclusion pass hit a corrupt exclusions file: {msg}`; any other throw is a step error and the pull continues.
- Write-back rule (behaviour change): skip `writeOrder` only when the omit set holds a pass positioned before `write-back` in `PASSES` (today: `blocked`, `oversized`), since a pass after it cannot change the blob; rewrite the header's "Omit is a test-only contract (no shipped caller passes it)" sentence to name `runBudget`'s `omit: ['driver-lane']` (Task 6) and this rule.

- [ ] **Step 1: Write the failing tests** in `queue-pull.test.js`, using the existing `pull` harness with a fake `expressQueuePolicy` dep and a canned `resolve-record-comments.js` spawn: `AC1.1 script: one driver-routable singleton and one standard record — only the standard record is selectable` (exclusions list `driver-lane` for the routable one; `rankNext(groups, exclusions)` returns the standard group; the routable record is still in `dispatch-groups.json`); `AC1.2` / `AC2.1` / `AC2.2 session and unset produce byte-identical groups, exclusions and stderr` (no `resolve-record-comments.js` call; the parity suites stay green); `AC5.2 express-driver off with script: nothing excluded, the one ignored line`; `AC9.2 the left-to-the-script-job line on stderr names the excluded record`; `AC3.1/AC3.2` through the module (marker kept, failed spawn kept); `files transport fails open` (no spawn, one Warning); `omitting driver-lane keeps the records unexcluded and still writes the queue-order blob`; and keep the `AC2.1 blocked` "an omit run never persists" assertion passing. The `#5227 registry` test then covers `STAYING_EXCLUSION_REASONS`/`RANK_SKIP_REASONS` by derivation.
- [ ] **Step 2: Run** `node tools/run-tests.js tests/bin-lib/dispatch/queue-pull.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement the module side.**
- [ ] **Step 4: Mirror the fence.** `queue-pull-script.md` is at 52,458 B of the 52,500 B rail: first move the `oversized` bullet's fast-lane bundling sentences (from "Before the size guard runs" to the end of that bullet) into `queue-pull-notes.md`, leaving a one-clause pointer, then add the header bullet `` - `reason: 'driver-lane'` (`detail: {runner}`, #6119) — … These records stay IN `dispatch-groups.json` … `` and, after the unlanded-blocker block and before the neighbour-in-flight block, a pass block of one comment line plus one `node-eval-file.js` heredoc calling `driver-lane.js`'s `runFromFiles({ groupsPath: process.argv[1], exclusionsPath: process.argv[2], transport: 'gh' })` with a non-zero exit stopping as the neighbour block does. Grep `tests/` for distinctive phrases of the moved sentences before moving them (Moved-prose pin check) and update any pin. Update the two ranking literals. Confirm `wc -c` stays under 52,500 for every file touched.
- [ ] **Step 5: Run** `node tools/run-tests.js tests/dispatch-named-form-exclusion-reasons.test.js tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-pull-oracle-checks.test.js tests/bin-lib/dispatch/queue-pull-parity-ac1.test.js tests/bin-lib/dispatch/queue-pull-parity-ac4.test.js tests/bin-lib/dispatch/queue-pull-parity-ac5.test.js tests/bin-lib/dispatch/queue-pull-parity-ac7.test.js tests/bin-lib/dispatch/queue-pull-parity-d1.test.js tests/dispatch-firing-exclusion.test.js` — Expected: PASS. Revert `queue-pull.js`, confirm the new tests go red, restore (AC7.1, AC7.2).
- [ ] **Step 6: Confirm the risk proof below holds** (the AC2 test and the parity suites green).

Proof(public-contract): the default `express-driver-runner: session` leaves the queue pull's groups, exclusions and stderr byte-identical to today (Task 5's AC2 test compares a pull with the key unset and with it set to `session` against the same expected output, and the existing parity suites stay green), and `driver-lane` is additive: `removes: false`, so `dispatch-groups.json` keeps every record, named `#N` forms still dispatch them (`bypass: true`), and only the derived ranking lists read the new reason.
- [ ] **Step 7: Commit** — `Register the driver-lane queue-pull exclusion — staying reason, mirrored in the retained fence, refs #6119`

### Task 6: The budget loop keeps selecting driver-lane records

**Files:**
- Modify: `plugin/bin/lib/driver/budget.js` (`omit: ['driver-lane']`, header sentence)
- Modify: `docs/driver.md` and `docs/journeys/let-the-driver-pick-records-under-a-budget-5229.md` only where they describe the budget pull's options or what it selects
- Test: `tests/bin-lib/driver/budget.test.js`

**Interfaces:**
- Consumes: Task 5's `driver-lane` reason.

- [ ] **Step 1: Write the failing test** `AC4.1 / AC4.2 runBudget under script omits driver-lane and drives the driver-routable record`: the fake `queuePull` records its options and returns what an `omit: ['driver-lane']` pull really returns — one driver-routable singleton group and no `driver-lane` entry; assert the options deep-equal `{ …, omit: ['driver-lane'] }` and the record is driven (`driveOne` called with it). A second assertion: the same group with a `driver-lane` entry is not screened or driven, proving the omit is what lets the record through (`driver-lane` is in `UNSELECTABLE_REASONS` by derivation). Update the existing exact-options assertion (line ~211) to the new `omit`.
- [ ] **Step 2: Run** `node tools/run-tests.js tests/bin-lib/driver/budget.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS. Revert, confirm red, restore.
- [ ] **Step 5: Commit** — `Omit driver-lane from the budget loop's pull — the script job still selects the records the session drain leaves, refs #6119`

### Task 7: Dispatch prose for the new lane

**Files:**
- Create: `plugin/skills/dispatch/driver-lane-report.md` (the Step 3 report: the `driver-lane: left to the script job:` line, that bare drain skips these records, that `#N`/`#N,#M,...` still dispatch them through the driver route, and that a lane no job drains shows in every firing)
- Modify: `plugin/skills/dispatch/SKILL.md` (Step 2's queue sentence gains the condition; one Step 3 pointer line to the report, beside the neighbour-in-flight pointer). The file is at 52,349 B of the rail: cut at least as many bytes as you add in the same commit, by moving a lazy sentence to the sub-file it already cites; grep `tests/` for its phrases first
- Modify: `plugin/skills/dispatch/driver-route.md` (Closed rule row: `split` or `on` and `express-driver-runner: script`, bare drain — the route is never consulted for a driver-routable singleton, because the pull never selects it; a named form still reaches the `--check` row)
- Modify: `plugin/skills/dispatch/queue-pull-notes.md` (why the pass sits after the removing passes, that it runs on a cache hit, its fail-open posture, the accepted race cost)
- Modify: `plugin/skills/dispatch/mcp-transport.md` (on a `gh`-absent firing the comment read is unavailable: nothing excluded, one Warning)
- Test: run every test that `git grep -l -E "neighbour-in-flight-report|driver-route.md|mcp-transport.md" -- tests` lists

- [ ] **Step 1: Write the prose** above; keep every touched file under 52,500 B (`wc -c`).
- [ ] **Step 2: Run** the listed suites plus `node tools/run-tests.js tests/dispatch-queue-pull-cutover-prose.test.js tests/dispatch-per-record-groups-prose.test.js` — Expected: PASS (fix any pin the cut moved).
- [ ] **Step 3: Commit** — `Document the driver-lane exclusion in dispatch — report, route row, notes, MCP limit, refs #6119`
