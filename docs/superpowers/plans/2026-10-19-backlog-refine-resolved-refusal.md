# Backlog refine: don't re-refuse a resolved grant decision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A record whose latest grant-decision comment a human resolved `keep` / `build it myself`, and whose body and labels have not changed since, is not re-refused by `/claude-tweaks:backlog refine` (human-present Grant lane or the headless gate-4 path) — one annotation line, no write.

**Architecture:** A pure evaluator plus a GraphQL fetcher in a new `plugin/bin/lib/issues/resolved-refusal.js`, wrapped by a new `plugin/bin/resolved-refusal.js` CLI that prints one JSON verdict. `grant-lane-decision.md`'s Idempotence check gains a second step that calls the CLI when the existing unresolved-comment query comes back empty; both callers (`refine-lanes.md`'s Needs-decision lane, `refine-headless.md`'s Needs-decision rows) already route through that section.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh api graphql`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T190717-record-3597/work/3597-spec.md`

Scope keywords: grant-lane-decision

Checked, no change needed (citations of `grant-lane-decision.md` that name no section this plan renames or re-shapes): `docs/journeys/refine-the-backlog-through-decision-lanes.md` (Common Step 6 updates journeys), `docs/skill-graph.md`, `plugin/skills/_shared/work-record-permission-matrix.md`, `plugin/skills/_shared/work-record.md`, `plugin/skills/backlog/attention-mode.md`, `plugin/skills/backlog/refine-closing-summary.md`, `plugin/skills/backlog/refine-mode.md`, `plugin/skills/backlog/refine-record.md`, `tests/backlog-refine-closing-render.test.js`. `tests/comment-trust-conformance.test.js` reads `grant-lane-decision.md`'s jq queries — Task 3 leaves them untouched and runs that suite.

## Global Constraints

- Suppress only for a resolved choice of `keep` or `build it myself` (Deliverable 1); any other choice, or no resolution, keeps today's behavior.
- A body edit or a label change after the resolution re-opens the record for grant-check (Deliverable 2). The resolver's own `needs:decision` removal (`refine-record.md` Step 4.4) is not a change.
- Same rule on `refine-headless.md`'s gate-4 refusal path (Deliverable 3).
- Annotation text, exactly: `#{n} — refusal resolved {choice} on {date}; not re-asked`.
- Only trusted-author comments count (`plugin/bin/lib/issues/comment-trust.js`'s `isTrustedComment`).
- gh-module conventions: `.claude/skills/gh-api-module-pattern/SKILL.md` and its `cli-wrapper-contract.md` — injectable `runner`, argv arrays, `windowsHide: true` literal in the spawn options, `timeout: GH_TIMEOUT_MS` imported from `plugin/bin/lib/shared-primitives.js`, `-f` for `String!` GraphQL vars and `-F` for the `Int!` number var, `process.exitCode` never `process.exit`.

## Design decisions (settled — do not re-derive)

- **Both grant-decision units count.** `backlog-refine` (human-present) and `backlog-grant` (headless) post the identical `**Proposed:** grant despite the flag, or build it yourself` question and are resolved by the same resolver (`refine-record.md`). The newest trusted comment carrying either marker is "the latest grant decision". Without this, the headless path would re-stamp every incident record (all resolved under `backlog-refine`).
- **Resolution time** = `{date}T00:00:00Z` from the `**Resolved:** {choice} — {date}` line — start of day, so a same-day change counts as "after" (conservative: re-ask). Not the comment's `lastEditedAt` (SDD ruling during Task 1: a later re-edit of the comment moves it forward and masks changes made in between). An event whose `createdAt` does not parse is `evidence-unavailable`.
- **Change evidence:** issue `lastEditedAt` (body edits) and `timelineItems(itemTypes:[LABELED_EVENT, UNLABELED_EVENT], last:100)`. A change is strictly `> resolvedAt`. `needs:decision` events are ignored. `gh issue view --json` exposes neither field (probed: `Unknown JSON field: "lastEditedAt"`), hence GraphQL.
- **Verbatim-command run-once (done while authoring):** the query below ran against #3214 and returned issue `lastEditedAt: 2026-10-17T17:34:56Z`; latest decision comment `IC_kwDORUwzVM8AAAABc-eDeQ`, body starting `**Resolved:** keep — 2026-10-19`, `lastEditedAt: 2026-10-19T03:38:54Z`; the only label event after that is `UnlabeledEvent needs:decision @ 2026-10-19T03:38:58Z`.
- **Degrade:** CLI non-zero exit (gh failure, gh absent) → the caller takes the Idempotence check's existing **Query failed** bullet (fail closed: skip this record this run, log). `_shared/forge-detection.md` check 2: this read has no MCP fallback (`backlog/mcp-transport.md` covers no needs-decision path), so gh-absent lands on that same bullet.

## Review Focus

1. A human edits the decision comment again later (typo fix) — `lastEditedAt` moves forward; acceptable (resolution reads later, still suppresses only on no change after it). Test: `lastEditedAt` later than the Resolved date still suppresses when nothing changed.
2. An untrusted author posts a fake resolved marker comment newer than the real one — must be ignored (Task 1 test).
3. The latest grant-decision comment is unresolved but an older one is resolved — must not suppress (`latest-unresolved`) (Task 1 test).
4. Resolved comment with no `lastEditedAt` and a same-day body edit — must not suppress (Task 1 test).
5. GraphQL response missing `repository.issue` (deleted / wrong number) — the fetcher throws, the CLI exits 1, never a `suppress:true` (Task 2 test).

---

### Task 1: Evaluator + fetcher module

**Files:**
- Create: `plugin/bin/lib/issues/resolved-refusal.js`
- Test: `tests/bin-lib/issues/resolved-refusal.test.js`

**Interfaces:**
- Produces:
  - `GRANT_DECISION_UNITS = ['backlog-refine', 'backlog-grant']`, `SUPPRESSING_CHOICES = ['keep', 'build it myself']`
  - `parseResolvedLine(body: string) -> {choice: string, date: string} | null` — matches a line `**Resolved:** {choice} — {date}` (`{date}` = `YYYY-MM-DD`, em dash `—`), anywhere in the body (multiline).
  - `evaluateResolvedRefusal({number: number, comments: Array<{body, authorAssociation, createdAt, lastEditedAt?, url?}>, bodyLastEditedAt: string|null|undefined, labelEvents: Array<{action: 'labeled'|'unlabeled', label: string, createdAt: string}>|undefined}) -> {suppress: boolean, reason: string, choice: string|null, date: string|null, resolvedAt: string|null, changes: Array<{kind: 'body'|'label', label?: string, action?: string, at: string}>, annotation: string|null, skipped: string[]}`
    - `reason` ∈ `no-decision-comment` | `latest-unresolved` | `choice-not-suppressing` | `evidence-unavailable` | `changed-since-resolution` | `unchanged`. `suppress` is `true` only for `unchanged`; `annotation` is non-null only then.
    - Latest grant decision = newest-by-`createdAt` trusted comment whose body matches `^<!-- needs-decision: (backlog-refine|backlog-grant) -->` (multiline). Untrusted marker comments contribute `untrustedSkipNote(c)` strings to `skipped`.
    - `evidence-unavailable` when `bodyLastEditedAt === undefined` or `labelEvents` is not an array (null `bodyLastEditedAt` = never edited = fine).
  - `buildResolvedRefusalQuery() -> string` — the GraphQL query: `query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ issue(number:$number){ lastEditedAt comments(last:100){ nodes{ body authorAssociation createdAt lastEditedAt url author{login} } } timelineItems(last:100, itemTypes:[LABELED_EVENT, UNLABELED_EVENT]){ nodes{ __typename ... on LabeledEvent{ createdAt label{name} } ... on UnlabeledEvent{ createdAt label{name} } } } } } }`
  - `fetchResolvedRefusalEvidence({number, owner, repo, runner}) -> {comments, bodyLastEditedAt, labelEvents}` — runner argv `['api', 'graphql', '-f', 'query=' + q, '-f', 'owner=' + owner, '-f', 'repo=' + repo, '-F', 'number=' + number]`; maps `LabeledEvent`/`UnlabeledEvent` to `action: 'labeled'|'unlabeled'`; throws when `data.repository.issue` is null/missing or the body carries `errors`.
  - `defaultRunner(args) -> string` — `execFileSync('gh', args, { encoding: 'utf8', windowsHide: true, timeout: GH_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] })`.

- [ ] **Step 1: Write the failing tests** — fixture builder `fixture(overrides)` producing the #3214 shape (trusted MEMBER comment `**Resolved:** keep — 2026-10-19\n\n<!-- needs-decision: backlog-refine -->\n## Decision needed\n...`, `createdAt 2026-10-17T19:25:48Z`, `lastEditedAt 2026-10-19T03:38:54Z`; `bodyLastEditedAt 2026-10-17T17:34:56Z`; label events including `unlabeled needs:decision @ 2026-10-19T03:38:58Z`). Tests:
  - `AC1.1: resolved keep + unchanged body renders the annotation and suppresses` — `suppress === true`, `reason === 'unchanged'`, `annotation === '#3214 — refusal resolved keep on 2026-10-19; not re-asked'`.
  - `AC2.1: a body edit after the resolution re-opens grant-check` — `bodyLastEditedAt: '2026-10-19T10:00:00Z'` → `suppress === false`, `reason === 'changed-since-resolution'`, `changes[0].kind === 'body'`.
  - `label change after resolution re-opens (risk:medium labeled)` → `changes` names `risk:medium`.
  - `needs:decision churn after resolution is not a change` (covered by the base fixture; assert `changes.length === 0`).
  - `build it myself also suppresses`; `grant anyway does not (choice-not-suppressing)`.
  - `backlog-grant unit comment counts the same as backlog-refine`.
  - `latest grant decision unresolved, older one resolved → latest-unresolved`.
  - `newer untrusted resolved marker is ignored and named in skipped` (Review Focus 2).
  - `no lastEditedAt: falls back to start of Resolved date; same-day body edit re-opens` (Review Focus 4).
  - `comment re-edited later than the Resolved date still suppresses when unchanged` (Review Focus 1).
  - `no decision comment → no-decision-comment`; `labelEvents undefined → evidence-unavailable`.
  - `parseResolvedLine` returns `{choice:'build it myself', date:'2026-10-17'}` for the real #3214 older comment head, `null` for a body with no Resolved line.
  - `fetchResolvedRefusalEvidence` with a fake runner: asserts exact argv (`-f owner=`, `-f repo=`, `-F number=3214`), maps a canned response (use the authoring-time #3214 values above) to `labelEvents` with `action`, and throws on `{"data":{"repository":{"issue":null}}}`. Fake runner throws `unexpected …` on any other argv.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/issues/resolved-refusal.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/issues/resolved-refusal.js'`

- [ ] **Step 3: Implement the module** per the Interfaces block. Header comment: purpose, the both-units decision, the start-of-day fallback, and that the fetcher has no MCP path (Design decisions above).

- [ ] **Step 4: Run to verify it passes** — same command, Expected: PASS.

- [ ] **Step 5: Commit** (`refs #3597`).

### Task 2: CLI wrapper + structure doc entry

**Files:**
- Create: `plugin/bin/resolved-refusal.js`
- Test: `tests/bin-lib/issues/resolved-refusal-cli.test.js`
- Modify: `docs/plugin-structure.md` (one `plugin/bin/lib/issues/resolved-refusal.js →` line beside the other `plugin/bin/lib/issues/*` entries, and one `node plugin/bin/resolved-refusal.js <n> [--repo owner/name]` line in the CLI command list near `backlog-grant-gate.js`)

**Interfaces:**
- Consumes: Task 1's `evaluateResolvedRefusal`, `fetchResolvedRefusalEvidence`, `defaultRunner`.
- Produces: `run(argv, deps) -> exitCode` with `deps = {runner, ghAvailable, remoteUrl, stdout, stderr}`; usage `resolved-refusal.js <n> [--repo owner/name] [--help]`. Stdout on exit 0: one JSON line `{number, ...evaluateResolvedRefusal result}`. Exit 0 verdict printed (any `reason`); 1 the `gh api graphql` call failed or returned no issue (stderr names it); 2 malformed invocation (missing/non-positive-integer `<n>`, unknown flag), `gh` absent, or owner/repo unresolvable. Repo resolution copies `plugin/bin/backlog-grant-gate.js`'s `parseRepo`/`remoteUrl` handling, including the bare-vs-host-qualified `--repo` branch from `plugin/bin/lib/number-list-cli.js`.

- [ ] **Step 1: Write the failing tests** — `exit 0 prints suppress:true verdict for the #3214 canned response`; `exit 1 when runner throws`; `exit 1 when issue is null` (Review Focus 5); `exit 2 on missing <n>`, `on '-5'`, `on unknown flag`, `when ghAvailable false`; `--help exits 0 before ghAvailable is called`; `--repo owner/name and host/owner/repo both resolve` (assert `-f owner=`/`-f repo=` argv).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/issues/resolved-refusal-cli.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/resolved-refusal.js'`

- [ ] **Step 3: Implement** per the contract; add the two `docs/plugin-structure.md` lines.

- [ ] **Step 4: Run to verify it passes** — same command → PASS. Then `node --test tests/bin-lib/exit-code-conformance.test.js tests/windows-hide-spawn-conformance.test.js` → PASS.

- [ ] **Step 5: Real-input probe** — `node plugin/bin/resolved-refusal.js 3214` must print `suppress: true`, `reason: "unchanged"`, `choice: "keep"`, `date: "2026-10-19"`, `resolvedAt: "2026-10-19T00:00:00Z"`, `changes: []`. Independent count: the authoring-time GraphQL probe (Design decisions) shows exactly one label event on or after 2026-10-19, and it is `needs:decision`. Also `node plugin/bin/resolved-refusal.js 3597` → `reason: "no-decision-comment"`. Paste both outputs into the task report.

- [ ] **Step 6: Commit** (`refs #3597`).

### Task 3: Wire the check into the skill prose

**Files:**
- Modify: `plugin/skills/backlog/grant-lane-decision.md` (Idempotence check, lines 31-57; 6,889 B → ~8.5 KB, far under the 52,500 B rail)
- Modify: `plugin/skills/backlog/refine-lanes.md:200-208` (Needs-decision population paragraph; 30,041 B)
- Modify: `plugin/skills/backlog/refine-headless.md:440-444` (Needs-decision rows) and the Audit format `decisions.md` block (~line 489; 35,715 B)
- Test: `tests/backlog-grant-lane-decision.test.js`

**Interfaces:**
- Consumes: Task 2's CLI shape and exit codes.

- [ ] **Step 1: Write the failing prose pins** in `tests/backlog-grant-lane-decision.test.js`:
  - `grant-lane-decision.md runs the resolved-refusal check when no unresolved comment exists` — flat text includes `bin/resolved-refusal.js`, `not re-asked`, `keep`, `build it myself`, and the `Empty` bullet no longer reads `lane/apply it as a fresh row` alone (assert it names the resolved-refusal check).
  - `refine-headless.md Needs-decision rows name the resolved-refusal check and its decisions.md line` — includes `resolved-refusal` and `refusal resolved`.
  - `refine-lanes.md Needs-decision lane names the resolved-refusal annotation` — the `## Needs-decision`…`## Priority` slice includes `not re-asked`.
  - Go-red control: the current `Empty` bullet text (`- **Empty** — lane/apply it as a fresh row.`) does not include `resolved-refusal`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/backlog-grant-lane-decision.test.js`
Expected: FAIL — the three new tests fail on the missing `resolved-refusal` / `not re-asked` text

- [ ] **Step 3: Edit the prose.**
  - `grant-lane-decision.md`: change the **Empty** bullet to "run the Resolved-refusal check below; lane/apply a fresh row only when it does not suppress". Add `### Resolved-refusal check (#3597)` after the bullet list: the command `node "${CLAUDE_PLUGIN_ROOT}/bin/resolved-refusal.js" "$ISSUE"`; why both units count (one sentence); `suppress: true` → render its `annotation` as a bare line under the caller's Needs-decision heading (same placement as the Non-empty bullet), write nothing; `suppress: false` → fresh row, as today (a body/label change since the resolution, a non-suppressing choice, or no resolved decision); any non-zero exit → the **Query failed** bullet above, citing `_shared/forge-detection.md` check 2 for gh-absent (no MCP fallback for this read). Keep `skipped` lines in the step's output like the jq query's second command.
  - `refine-lanes.md`: extend the population paragraph by one sentence — rows whose latest grant decision was resolved `keep`/`build it myself` with no body/label change since render the Resolved-refusal check's `not re-asked` annotation the same way.
  - `refine-headless.md` Needs-decision rows: one sentence that the Resolved-refusal check applies on this path too (Deliverable 3) and a suppressed record logs `AUTO {time} — Backlog grant: not re-asked #{n} — refusal resolved {choice} on {date}, unchanged since.`; add that line to the Audit format `decisions.md` block.

- [ ] **Step 4: Run to verify it passes** — `node --test tests/backlog-grant-lane-decision.test.js tests/comment-trust-conformance.test.js tests/backlog-refine-closing-render.test.js tests/work-record-needs-decision-conformance.test.js` → PASS; then `git grep -l "refine-headless.md\|refine-lanes.md" -- tests` and run each hit with `node --test` → PASS.

- [ ] **Step 5: Commit** (`refs #3597`).

### Task 4: Full suite

- [ ] **Step 1:** Run `npm test`, redirecting output to a `.txt` file in the session scratchpad (never `.log`, never `/tmp`), and confirm `ℹ fail 0`. Covers `AC3.1: npm test passes`. Runs centrally in /build Common Step 5, not inside an implementer dispatch.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (suppress + annotation) | Task 1 (evaluator), Task 3 (prose) |
| Deliverable 2 (body/label change re-opens) | Task 1 |
| Deliverable 3 (headless gate-4 path) | Task 3 (`refine-headless.md`) |
| AC1.1 | Task 1 test `AC1.1: …` |
| AC2.1 | Task 1 test `AC2.1: …` |
| AC3.1 | Task 4 |
