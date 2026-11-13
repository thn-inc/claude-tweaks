# Risk Flags at Intent Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:specify` classifies work against invisible-risk categories, records the flags on the record through one sanctioned writer, and `plan-audit` fails a plan that carries no specific proof for a kept flag.

**Architecture:** One pure module (`record-risk-flags.js`) owns the `Risk-flags:` line grammar, reader and writers. A deterministic classifier plus a thin CLI (`bin/risk-flags.js`) give `/specify` its floor and its settle step; a new gating Check G in `plan-audit` reads the same line from the materialized spec. The acceptance packet (#4611, shipped) gains a `proof` fact kind, and its validator files a claim backed only by a planned proof under `planned`, rendered in Risk proofs as not verified. Wrap-up's Phase 1 snapshot keeps a copy of the plan, and at Step 4 `risk-flags.js facts` writes the gather's `--flags` (with `unconfirmed`) and new `--proofs` inputs from the spec and that copy. Skill prose calls the CLI and never edits the line by hand.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T101348-record-4618/work/4618-spec.md`

## Global Constraints

- Line grammar, verbatim from the spec: `Risk-flags: migrations, auth` (comma-separated lowercase slugs from the built-in set `migrations`, `auth`, `public-contract`, `irreversible-side-effect` plus policy `risk-categories`) or `Risk-flags: none` (classified, nothing flagged). Absent line = unclassified legacy record, read as no flags. A present line that is malformed or names an unknown slug is read as **unknown = all four built-in categories flagged**. Optional `Risk-flags-unconfirmed: true` marks a headless-kept flag set.
- `parseRiskFlags` is the single shared parse function returning `{ flags, status: 'ok' | 'unknown' | 'unclassified' }`, which every reader uses.
- Headless means no human is reachable: `/specify --chained`, a headless `/backlog refine`, a dispatch-bound or Routine run, or any `AskUserQuestion` that errors, times out or is auto-answered. The fail direction is always keep.
- Plan proof: one plan step contains a line `Proof(<slug>): <text>` with `<text>` at least 20 characters and not merely restating the category name.
- Removal log text, verbatim (#4619 reads it): `Risk flag {slug} removed by the maintainer during shaping`.
- `risk:low|medium|high` is the scoring axis. Never reuse that label namespace or call a flag a "risk tier".
- Control mode: `_shared/policy-schema.md` states every Control-mode key "is consulted only when it is `on`", so `risk-categories` and `risk-path-globs` are read only when `isControlModeOn` (`plugin/bin/lib/policy.js`) is true. The built-in categories, the line, the writers and Check G work regardless of control mode (spec AC1, AC4 carry no such condition); forcing the acceptance target is out of scope here (spec: "Until the consumers ship").
- `plan-audit-check-addition`, verbatim: "A check is not shipped until every row below lands in the same change." "Absent input versus unreadable input. An optional input left off the command line is a `skipped` result (`checkE: {ok: true, skipped: 'no-spec'}`). A named input that cannot be read exits 2, the same as an unreadable plan. Never fall back from the second to the first." "Normalize every text input once, at the check's entry." "A read-only verb (`--bytes`, `--count-tasks`) never runs the new check, so refuse its flag beside them." "Run `git grep -nE 'Checks? A/B' -- plugin docs` before calling the change done".
- `bin-source-scan-conformance`, verbatim: "A new suite that imports the stripper is itself a caller, and two hand-written lists must name it by test-file stem: the header comment of `tests/helpers/strip-comments.js` and `parse-signal-discipline` item 15." "If the suite reads a source file as text, read it through `readText` from `tests/helpers/read-skill.js`, not a raw `fs.readFileSync`". "Assert the exact flagged line numbers, not just a count". "Walking `plugin/bin` with `fs.readdirSync(dir, { recursive: true })`" is banned: use the manual `withFileTypes` walk and a floor on files walked.
- `gh-api-module-pattern/cli-wrapper-contract.md`, verbatim: "Logic lives in an exported `run(argv, deps)`; every side effect ... goes through `deps`". "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`...)". "An existence or type check goes through `plugin/bin/lib/path-guard`'s `lstatType`, never a bare `fs.existsSync`". "A file the CLI is about to read is read directly with `ENOENT`/`ENOTDIR` caught as "absent"".
- `skill-prose-conformance-tests`: read live skill text through `readText`; a negative control runs the same assertion function as the positive test against mutated text and expects it to throw.
- `plugin/skills/build/plan-authoring-checks.md` is 52,497 B, 3 B under the rail, so this plan adds no paragraph there: the `## Gotchas` bullet `appendRiskProofGotcha` writes is what tells the planner, and Check G enforces it.
- Byte headroom against `RAIL_BYTES` (52,500, `plugin/bin/lib/skill-audit/budgets.js`), re-measured with `wc -c` after the 2026-11-03 merge of `origin/main`: `plugin/skills/build/SKILL.md` 52,235 (265 left); `plugin/skills/_shared/policy-schema.md` 52,283 (217 left); `plugin/skills/backlog/refine-mode.md` 43,379; `plugin/skills/_shared/work-record.md` 40,268; `plugin/skills/build/plan-audit.md` 28,567; `plugin/skills/specify/spec-template.md` 28,444; `plugin/skills/specify/record-creation-subissues.md` 28,300; `plugin/skills/specify/shaping-mode-stamping.md` 23,993; `plugin/skills/_shared/acceptance-packet.md` 23,162; `plugin/skills/specify/shaping-mode.md` 21,157; `plugin/skills/_shared/express-lane.md` 18,101; `plugin/skills/build/micro-plan.md` 7,809; `plugin/skills/wrap-up/verification-brief.md` 42,496 (10,004 left); `plugin/skills/wrap-up/SKILL.md` 43,070 (9,430 left).
- The packet gather's input rules, verbatim: `tests/bin-lib/wrap-up/packet-gather.test.js` line 936, "a pass-through record cannot set its own status, kind or source"; `acceptance-packet.js` header, "Every input gather can name is optional. One that will not read becomes a note in the facts' `partial` list ... so a lost input is never read as an empty one."
- The acceptance packet contract: `packet-contract.js` says "Every packet module imports these, so a value is stated here once", and `_shared/acceptance-packet.md` says "Later records extend the schema only by adding rows to the table." `tests/acceptance-packet-contract-conformance.test.js` pins the doc's `**Fact kinds:**` list and section-to-kind table equal to `FACT_KINDS` and `SECTION_KINDS`, so a constant and its doc row change in the same task.
- Task dependencies, no chain deeper than three: Task 2 on 1; Task 4 on 1 and 3; Tasks 10 and 11 on 4; Task 5 on 1 and 3; Task 6 on 5; Task 7 on 1; Task 8 on none; Task 9 on 8; Task 12 on 8; Task 13 on 1, 3, 4, 5 and 12. Task 14 is prose plus a prose suite that executes no new code, so its place after 13 is for naming the verbs 12 and 13 ship, not a build dependency; counted as one, its chain (1, 4, 13, 14) is four deep, the one exception. Each new prose suite is its own file (Tasks 6, 7, 10, 11), so no task waits on another task's test file.
- Implementers run only the targeted suites named in their task. The full suite runs centrally. Commit messages say `refs #4618`, never `closes`.

Waived AC7.1: the full suite runs centrally at Common Step 5 and through `/claude-tweaks:test`, never inside a task.
Waived `_shared/auto-mode-contract.md`: read by Task 10's step 2 of the Risk flags section; it is cited, not changed.

## Review Focus

1. A materialized spec (YAML frontmatter, then `# {n}: title`, then metadata lines) must read the same as a raw record body: Task 1's `materialized spec shape` test.
2. CRLF bodies from GitHub: Task 1's CRLF test and Task 5's CRLF plan and spec test.
3. A later section quoting `Risk-flags: none` (a `## Original request` block, a fenced example) must not defeat a real line or read as the record's own: Task 1's section-scope and fence tests.
4. A `Proof(auth): ...` line in a fenced code block, or outside any task, must not satisfy Check G: Task 5's tests.
5. A flagged record must not bypass the audit through the trivial-plan or fast-lane skip gate, the micro-plan path, or the express lane: Task 6's `--risk-proofs` tests and Task 7's express and micro-plan tests.
6. A human removal on a line that reads `status: 'unknown'` is refused at every layer, and nothing is logged: Task 1's writer tests, Task 4's `settle` and `confirm` tests, and the prose in Tasks 10 and 11.
7. A planned proof (`proof` fact, status `not-run`) never reads as verified: Task 8's validator tests and Task 9's render test and real-validator fixture.
8. An `already shaped, no-op` record gets a body write only from an explicit single-record `/specify #N`, never from a batch path: Task 10's batch-exclusion tests.
9. `unconfirmed` and a planned proof survive the real path from the record and plan to the rendered packet, and no gather input can set a proof's status: Task 12's gather tests and Task 13's end-to-end test.
10. Step 4 runs from the main checkout after cleanup, so the plan reaches it only through Phase 1's snapshot copy: Task 14's prose and its conformance pins.
11. An unconfirmed flag is labelled on every Risk-proofs line that cites it, by the renderer from the fact, so no narrator can leave it out (round 3, Reading A), and a human removal is logged `KEPT-PROMPT`, never `AUTO` (round 3, Reading B): Task 9's label tests, Task 13's end-to-end render assertion, and Task 4's removal test.
12. A logged removal does not persist, and an interactive re-shape asks about every kept flag, confirmed or not (round 4, Reading A): Task 4's `settle` kept-set computation and Task 10's prose pins.

## Decisions the spec leaves to the builder

- **A dropped policy slug versus an unknown slug.** The spec says a flag whose category was later dropped from policy stays flagged, and that an unknown slug reads as all four built-ins. They cannot be told apart without history, so `status: 'unknown'` returns `flags` = all four built-ins plus every well-formed slug the line named, in that order. Both spec sentences hold. `reason` is `'malformed'` or `'unknown-slug'`.
- **Unknown-slug versus could-not-parse in Check G.** A malformed flag line is `couldNotParse` and fails however many proofs exist. A well-formed line naming an unknown slug parsed fine: it requires a proof per flag in the widened list and is satisfiable.
- **The skip gate.** Check G is gating, so unlike Checks E and F it must not share Common Step 1.5's skip gate: a trivial plan or a fast-lane record would otherwise skip the proof. A new read-only verb `--risk-proofs` (requires `--spec`) runs Check G alone on that path. The micro-plan path and the express lane write no audited plan, so a flagged record is ineligible for both.
- **Removal on an `unknown` line (Plan Review Decisions, Reading A): the writers throw.** `removeRiskFlag` and `confirmRiskFlags` on a body whose line reads `status: 'unknown'` throw an `Error` with `code: 'RISK_FLAGS_UNKNOWN'` and a message starting `removeRiskFlag refused: unreadable Risk-flags line` (or `confirmRiskFlags refused: ...`), checked after the `humanConfirmed` refusal. Throwing, not returning the body unchanged, because an unchanged return reads exactly like a successful no-op: a caller that logs after the call would write a removal line for a flag that was never removed, and only a re-parse would tell. The CLI catches by `code`, never by message, so no `Risk-flags` literal leaves the writer module (Task 2's scan). The refusal is decided on the line as it reads when the verb starts (the body and, for `settle`, the prior body): then no `remove` or `keep` answer is applied, the widened set is kept, the marker is written or kept, and no removal is logged. **Repaired** means the line reads `ok` at entry. A malformed line is repaired by `settle`'s own `addRiskFlags` call, which rewrites it as the widened, well-formed set (adding caution, never removing), so the next interactive touch can remove. A line naming an unknown slug stays `unknown` until the slug becomes known (policy `risk-categories` with control mode on) or a human corrects the record's line, since `addRiskFlags` keeps every slug the line named.
- **A `proof` fact with status `not-run` (round 2, Reading B): a fifth validator outcome, `planned`.** The validator today has four buckets (`kept`, `moved`, `dropped`, `screened`) and routes a risk proof on its `check`/`story` facts only (`ROUTED_KINDS`). Routing a `proof` like a `check` would move every proof-only claim to Couldn't test, and Risk proofs would then render its placeholder `not applicable: no kept risk flags` on a record that keeps flags. So when a `risk-proofs` claim's only refs besides `flag` facts are `proof` facts, the claim moves to Tried to break when one of those is `failed`, otherwise it lands in `result.planned` as `{ claim, because }` when one of those is `skipped` or `not-run`, and it is kept only when every one is `passed`. A claim that also cites a `check`, `story`, `recording` or `link` keeps today's routing on those facts. The renderer lists a planned claim in Risk proofs as `- {text} (planned, not verified: cites {id} — {status}: {reason})`.
- **Round 3 (maintainer, 2026-11-03).** Reading A: `packet-render.js` appends ` (flag unconfirmed)` to every Risk-proofs line, kept or planned, that cites a `flag` fact carrying `unconfirmed: true` (Task 9). Reading B: a human removal is logged with status `KEPT-PROMPT`, the status for a decision a human answered inline, never `AUTO`; the removal text is unchanged (Task 4). The same-family decisions (planned bucket, `--proofs` input, `snapshot --plan` with its `SKIP`, the `RISK_FLAGS_UNKNOWN` throw) are accepted as this plan already has them.
- **Round 4 (maintainer, 2026-11-03).** Reading A: a logged human removal does not persist. A flag the floor detects again on a later shaping counts as detected: a headless re-shape re-adds it as unconfirmed, and the next interactive touch asks again. No `Risk-flags-removed:` line or other new line contract (Task 10's `spec-template.md` paragraph and Risk flags item 6 say so). An interactive re-shape asks about every flag in `settle`'s kept set: the floor's matches, the agent's own additions (passed with `--add`) and every flag already on the record, confirmed or not, so a confirmed flag the floor no longer detects is asked about rather than silently marked unconfirmed again (Task 10 item 3).
- **Plan review (2026-11-03, run 2026-11-03T114116).** Decided by the user: Reading A, `/backlog refine`'s Step 3.7 checks every open record in Step 1's `allRows` that carries the unconfirmed marker, under both drivers and in every lane, and writes `local-files` records through `readRecord`/`writeRecord` (Task 11). Amendments with no product decision: a kept flag no claim cites renders as `- {slug}: no proof shown`, and the no-kept-flags placeholder renders only with no `flag` fact (Task 9); `classify` prints `kept` and `entry` so Tasks 10 and 11 never read the line by eye (Task 4); `parseRiskFlags` returns an `ok` line in canonical order (Task 1); `appendRiskProofGotcha` narrows and removes the bullet with the kept set (Tasks 1 and 4); `Review risk: high` on Tasks 3, 7 and 9.
- **Logging.** `bin/risk-flags.js settle --run` appends the removal through `require('./log-decision').run` in-process (the best-effort audit-line shape `dream-scan.js` uses), reporting `logged: false` in its envelope on failure. It does not join the self-logging roster, because it never reads `append.js` directly and the skill owns the fallback.
- **Already-shaped records (round 2, Reading B).** An explicit single-record invocation runs the Risk flags step even when `compose-record.js --check` exits 0: a lone `#N`, a range whose bounds are equal (`SKILL.md`'s Range form resolves it as a single record reference), and `#N --chained` (headless, so step 4). When `settle` changes the body, the record is written through Compose-then-write-once with only the flag lines and the Gotcha bullet changed, and reports `shaped`. When it leaves the body byte-identical, the record stays `already shaped, no-op`. Every batch path leaves an exit-0 record untouched (AC6); Task 10 names each path and pins the exclusion:
  - a comma list `#N,#M` (`SKILL.md`'s Comma-list batch form, `shaping-mode.md`'s per-record loop): an exit-0 element moves on without the step;
  - a range `#A-#B` with `A < B`: it expands to a comma list before resolution, so the comma-list rule covers it;
  - bare drain (`/claude-tweaks:specify` with no first argument, `--budget`, and the deprecated `next` alias; `next-mode.md` and `next-mode-shape.md`): an exit-0 record moves on without the step;
  - `/claude-tweaks:sweep` Step 2 (`--source sweep`): the bare drain above, so the same rule;
  - `/claude-tweaks:backlog refine`, headless (`refine-headless.md`): never runs `risk-flags.js`;
  - `/claude-tweaks:backlog refine`, human present: Step 3.7 runs `risk-flags.js confirm` only on records already carrying `Risk-flags-unconfirmed: true`, with no classifier, so a record with no flag line is never touched.
  Decomposition creates new records, and its Origin-set carve-out (`record-creation-subissues.md`) shapes the origin record in place as one unit of that decomposition, so neither is a batch reclassification of an already-shaped record.
- **Gather wiring is in scope (controller ruling, 2026-11-03, intent-resolved).** The packet module (#4611) shipped after this plan was first written. Three passages settle it. The spec's Overview says the packet's Risk-proofs input is "a `flag` fact carrying `unconfirmed: true`, produced by this record into the packet gather, so no separate accept code is needed". Deliverable 4 says "A `flag` fact producer feeding the packet gather (including `unconfirmed`), and the proof fact (the `Proof(<slug>)` line) for the packet's Risk-proofs section"; its "if the packet module has not shipped" clause no longer applies. And `plugin/skills/wrap-up/verification-brief.md` line 392 says "`--dev-base-url`, `--deploy`, `--flags` and `--decision-items` are filled by the dev-target, risk-flag and control-mode records". The round-2 Q1 Reading B decision already authorizes an additive packet-contract widening for `proof`. Today `packet-gather.js`'s `passThroughFacts` writes each `--flags` entry as `{ id, kind, status: 'passed', source, text?, url? }`, dropping `unconfirmed`, and the gather has no input for `proof` facts. Tasks 12-14 wire it; the shape:
  - **Timing (Consumer-timing and Step-position checks).** `verification-brief.md`'s Step 4 runs "after wrap-up's cleanup items" (its Route-the-commit paragraph, lines 290-296): on the console's "Approve all + merge" path and `dispatch/close-out.md` step 3, item 4 "has already removed the merged run's worktree and branch and item 8 has archived its run directory, so Step 4 runs from the main checkout on the integration branch". So at Step 4 the cwd is the main checkout. The worktree's `work/{N}-spec.md` mirror and the plan may be gone. The spec still resolves through Step 4's own `--spec` chain (line 381: the current checkout's `work/{N}-spec.md`, then `{run-dir}/work/{N}-spec.md`, else the record body). The record body carries the `Risk-flags:` lines, so the flags always derive at Step 4. The plan does not: the worktree is gone on the merge path, and `superpowers-plans-retention: prune-after-wrapup` deletes it in cleanup item 1. Wrap-up Phase 1 (`wrap-up/SKILL.md` line 112's **Snapshot the packet inputs**) runs before every cleanup item, from the run's own checkout, with the worktree and plan present under `pr-first`, before the merge. That is where the plan is captured.
  - **Capture: `snapshot --plan <file>`.** `acceptance-packet.js snapshot` already exists "because ... Step 4 can run after the worktree holding them is gone" (`_shared/acceptance-packet.md`'s `## Pipeline`), and it is the sanctioned, run-dir-anchored writer of `{run-dir}/packet-inputs/`, which survives archival as `archive/{run-id}/packet-inputs/`. An optional `--plan <file>` copies the plan's text to `packet-inputs/plan.md`. The manifest gains `files.plan` (`copied` | `absent` | `unreadable`) only when `--plan` is given, so a call without it writes today's manifest byte for byte. Rejected: a producer run at Phase 1 writing straight into the run dir needs a second sanctioned run-dir writer; a session-temp file is lost when `/claude-tweaks:wrap-up resume` re-enters from another session.
  - **Producer: `risk-flags.js facts`.** `facts --spec-file <f> [--plan-file <f>] --flags-out <f> --proofs-out <f> [--repo-root <dir>]`, run at Step 4 just before the gather, with `{spec}` and the snapshot's `plan.md`. It writes the two gather input files. It is a verb on the existing CLI, not a new bin, because that CLI already owns `--repo-root` policy resolution (`readRiskPolicy`) and the exit-code contract.
  - **Gather inputs: `--flags` keeps `unconfirmed`, plus a new `--proofs`.** A `--flags` entry gains an optional boolean `unconfirmed`, carried onto the fact only when `true`, so every existing `--flags` caller's facts are byte-identical. `proof` facts arrive through a new optional `--proofs <file>` (entries `{ id, text }`). The gather, not the input, sets each proof fact's `kind: 'proof'`, `status: 'not-run'`, `reason: 'planned in the plan, not yet run'` and `source: 'proofs'`. One input per kind keeps the gather's rule "a pass-through record cannot set its own status, kind or source" (`tests/bin-lib/wrap-up/packet-gather.test.js` line 936), so no input file can plant a `passed` proof. A `--flags` that took both kinds would need an entry-level `kind`, which that rule forbids.
  - **Fail direction.** With no plan copy (no plan, an ambiguous one, a failed snapshot), `facts` writes `[]` proofs and reports `plan: 'absent'`. The flags still reach the packet. A narrated risk proof then cites no proof fact and drops visibly (`1 claim was dropped for missing evidence`), and Step 4's summary names the missing plan. It is never a silent pass.

---

### Task 1: The line grammar, reader and sanctioned writers

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/record-risk-flags.js`
- Modify: `plugin/bin/lib/issues/record.js`
- Modify: `plugin/bin/lib/issues/local-store.js`
- Test: `tests/bin-lib/issues/record-risk-flags.test.js`

**Interfaces:**
- Produces, re-exported from `record.js`:
  - `parseRiskFlags(body, { extraCategories = [] } = {}) -> { flags: string[], status: 'ok'|'unknown'|'unclassified', reason: null|'malformed'|'unknown-slug', unconfirmed: boolean, raw: string|null }`; `flags` for an `ok` line is in canonical order, built-ins first in `BUILTIN_RISK_CATEGORIES` order, then extras in line order (plan review, 2026-11-03)
  - `addRiskFlags(body, slugs, { unconfirmed = false, extraCategories = [] } = {}) -> string`
  - `removeRiskFlag(body, slug, { humanConfirmed, extraCategories = [] } = {}) -> string`; throws `Error` whose message starts `removeRiskFlag refused` unless `humanConfirmed === true`; then, when `parseRiskFlags(body, { extraCategories })` reads `status: 'unknown'`, throws `Error` with `code: 'RISK_FLAGS_UNKNOWN'` and a message starting `removeRiskFlag refused: unreadable Risk-flags line` (Reading A: nothing is removed until the line is repaired)
  - `confirmRiskFlags(body, { humanConfirmed, extraCategories = [] } = {}) -> string`; same two refusals, the second with a message starting `confirmRiskFlags refused: unreadable Risk-flags line`; drops the unconfirmed line; returns the body byte-identical when no marker exists
  - `RISK_FLAGS_UNKNOWN = 'RISK_FLAGS_UNKNOWN'`, the error `code` both refusals carry, exported so the CLI matches on it
- `addRiskFlags` on an `unknown` line writes the widened set (all four built-ins, then every well-formed slug the line named, then `slugs`) as one well-formed line, so a malformed line comes back `ok` and a line naming an unknown slug still reads `unknown`.
  - `appendRiskProofGotcha(body, slugs) -> string`
  - `RISK_FLAGS_NONE = 'none'`
- The scope rule: the reader looks only at the preamble: after an optional leading `---` frontmatter block, the lines before the first `## ` heading, ignoring fenced lines (`fencedLineMask` from `plugin/bin/lib/markdown-blocks.js`). Normalize `\r\n?` to `\n` on entry.
- Detection is deliberately wider than the grammar so a misspelling is malformed, never absent: any preamble line matching `/^\s*risk[-_ ]?flags\s*:/i` is a flag line. Only exactly `Risk-flags: {value}` at column 0 parses; every other spelling, an empty value, `none` beside a slug, a slug failing `/^[a-z0-9][a-z0-9-]*$/`, or two flag lines reads `status: 'unknown', reason: 'malformed'`.
- Marker: a preamble line matching `/^\s*risk[-_ ]?flags[-_ ]unconfirmed\s*:/i` sets `unconfirmed: true`, whatever its value other than exactly `Risk-flags-unconfirmed: false` (a misspelled marker fails toward caution).

- [ ] **Step 1: Write the failing test**

Tests in `tests/bin-lib/issues/record-risk-flags.test.js`:

```js
const { parseRiskFlags, addRiskFlags, removeRiskFlag, confirmRiskFlags, appendRiskProofGotcha, RISK_FLAGS_UNKNOWN } = require('../../../plugin/bin/lib/issues/record');
const ALL = ['migrations', 'auth', 'public-contract', 'irreversible-side-effect'];
test('AC5.1: a malformed line reads all four, never no flags', () => {
  for (const line of ['Risk-flags: Auth', 'Risk-flags:', 'Risk-flags: none, auth', 'risk-flags: none', 'Risk-Flags: none', 'Risk_flags: auth', 'Risk-flags : auth']) {
    const r = parseRiskFlags(`Surface: infra\n${line}\n\n## Overview\n`);
    assert.deepStrictEqual(r.flags.slice(0, 4), ALL, line);
    assert.strictEqual(r.status, 'unknown', line);
    assert.strictEqual(r.reason, 'malformed', line);
  }
});
test('AC5.1: a line naming an unknown slug reads all four plus the named slug', () => {
  const r = parseRiskFlags('Risk-flags: auth, pii\n');
  assert.deepStrictEqual(r, { flags: [...ALL, 'pii'], status: 'unknown', reason: 'unknown-slug', unconfirmed: false, raw: 'Risk-flags: auth, pii' });
});
test('AC5.2: an absent line reads unclassified with no flags', () => {
  assert.deepStrictEqual(parseRiskFlags('Surface: infra\n\n## Overview\n').flags, []);
  assert.strictEqual(parseRiskFlags('Surface: infra\n').status, 'unclassified');
});
test('AC5.3: Risk-flags none reads ok with an empty list', () => {
  const r = parseRiskFlags('Risk-flags: none\n');
  assert.deepStrictEqual([r.status, r.flags], ['ok', []]);
});
test('AC5.4: each of the three states is pinned by name', () => {
  assert.deepStrictEqual(['Risk-flags: Bad\n', '', 'Risk-flags: none\n'].map((b) => parseRiskFlags(b).status), ['unknown', 'unclassified', 'ok']);
});
test('a policy slug is known only when passed', () => {
  assert.strictEqual(parseRiskFlags('Risk-flags: pii\n', { extraCategories: ['pii'] }).status, 'ok');
});
test('materialized spec shape: frontmatter and H1 ahead of the metadata lines', () => {
  const r = parseRiskFlags('---\nrecord: 1\n---\n# 1: t\n\nSurface: infra\nRisk-flags: migrations\n\n## Overview\n');
  assert.deepStrictEqual([r.status, r.flags], ['ok', ['migrations']]);
});
test('section scope: a line under a later heading is not the record line', () => {
  assert.strictEqual(parseRiskFlags('Surface: x\n\n## Original request\n\nRisk-flags: none\n').status, 'unclassified');
});
test('fence: a fenced line in the preamble is not the record line', () => {
  assert.strictEqual(parseRiskFlags('```\nRisk-flags: none\n```\n\n## Overview\n').status, 'unclassified');
});
test('CRLF: a CRLF body parses and a writer round-trips it', () => {
  const body = 'Surface: x\r\nRisk-flags: auth\r\n\r\n## Overview\r\n';
  assert.deepStrictEqual(parseRiskFlags(body).flags, ['auth']);
  assert.deepStrictEqual(parseRiskFlags(addRiskFlags(body, ['migrations'])).flags, ['migrations', 'auth']);
});
test('two flag lines read malformed', () => {
  assert.strictEqual(parseRiskFlags('Risk-flags: auth\nRisk-flags: none\n').reason, 'malformed');
});
test('addRiskFlags only adds: built-in order, then extras; preserves a kept flag', () => {
  assert.strictEqual(parseRiskFlags(addRiskFlags('Risk-flags: auth\n', [])).flags.join(), 'auth');
  assert.deepStrictEqual(parseRiskFlags(addRiskFlags('Surface: x\n\n## O\n', ['auth', 'migrations'])).flags, ['migrations', 'auth']);
});
test('addRiskFlags on an unclassified body with no slugs writes Risk-flags none', () => {
  assert.strictEqual(parseRiskFlags(addRiskFlags('Surface: x\n\n## O\n', [])).status, 'ok');
});
test('addRiskFlags never narrows a malformed line: it widens to all four', () => {
  assert.deepStrictEqual(parseRiskFlags(addRiskFlags('Risk-flags: Auth\n', [])).flags, ALL);
});
test('addRiskFlags on Risk-flags none replaces it', () => {
  assert.deepStrictEqual(parseRiskFlags(addRiskFlags('Risk-flags: none\n', ['auth'])).flags, ['auth']);
});
test('addRiskFlags inserts inside the metadata block, above the first heading', () => {
  assert.strictEqual(addRiskFlags('Surface: x\nUi-stack: y\n\n## O\n', ['auth']), 'Surface: x\nUi-stack: y\nRisk-flags: auth\n\n## O\n');
  assert.strictEqual(addRiskFlags('## O\n', ['auth']), 'Risk-flags: auth\n\n## O\n');
});
test('addRiskFlags unconfirmed writes the marker right below the flag line', () => {
  assert.strictEqual(addRiskFlags('Surface: x\n\n## O\n', ['auth'], { unconfirmed: true }), 'Surface: x\nRisk-flags: auth\nRisk-flags-unconfirmed: true\n\n## O\n');
});
test('AC5.5: removeRiskFlag without humanConfirmed true refuses', () => {
  for (const opts of [undefined, {}, { humanConfirmed: false }, { humanConfirmed: 'true' }, { humanConfirmed: 1 }]) {
    assert.throws(() => removeRiskFlag('Risk-flags: auth\n', 'auth', opts), /removeRiskFlag refused/);
  }
});
test('removeRiskFlag drops one flag, writes none for the last, clears the marker', () => {
  assert.strictEqual(removeRiskFlag('Risk-flags: auth, migrations\nRisk-flags-unconfirmed: true\n', 'auth', { humanConfirmed: true }), 'Risk-flags: migrations\n');
  assert.strictEqual(removeRiskFlag('Risk-flags: auth\n', 'auth', { humanConfirmed: true }), 'Risk-flags: none\n');
});
test('confirmRiskFlags refuses without humanConfirmed, clears the marker with it', () => {
  assert.throws(() => confirmRiskFlags('Risk-flags: auth\nRisk-flags-unconfirmed: true\n'), /refused/);
  assert.strictEqual(confirmRiskFlags('Risk-flags: auth\nRisk-flags-unconfirmed: true\n', { humanConfirmed: true }), 'Risk-flags: auth\n');
});
test('Reading A: a confirmed removal on an unknown line is refused with its own code, for both unknown reasons', () => {
  for (const body of ['Risk-flags: Auth\nRisk-flags-unconfirmed: true\n', 'Risk-flags: auth, pii\nRisk-flags-unconfirmed: true\n']) {
    assert.throws(() => removeRiskFlag(body, 'auth', { humanConfirmed: true }), (e) => e.code === RISK_FLAGS_UNKNOWN && /^removeRiskFlag refused: unreadable Risk-flags line/.test(e.message), body);
    assert.throws(() => confirmRiskFlags(body, { humanConfirmed: true }), (e) => e.code === RISK_FLAGS_UNKNOWN && /^confirmRiskFlags refused: unreadable Risk-flags line/.test(e.message), body);
  }
});
test('Reading A: the humanConfirmed refusal still comes first on an unknown line', () => {
  assert.throws(() => removeRiskFlag('Risk-flags: Auth\n', 'auth', {}), (e) => e.code !== RISK_FLAGS_UNKNOWN && /^removeRiskFlag refused/.test(e.message));
});
test('Reading A: a policy slug passed in makes the line known, so the removal goes through', () => {
  assert.strictEqual(removeRiskFlag('Risk-flags: auth, pii\n', 'pii', { humanConfirmed: true, extraCategories: ['pii'] }), 'Risk-flags: auth\n');
});
test('Reading A: addRiskFlags repairs a malformed line to the widened set, and keeps an unknown slug unknown', () => {
  const repaired = parseRiskFlags(addRiskFlags('Risk-flags: Auth\n', [], { unconfirmed: true }));
  assert.deepStrictEqual([repaired.status, repaired.flags, repaired.unconfirmed], ['ok', ALL, true]);
  const still = parseRiskFlags(addRiskFlags('Risk-flags: auth, pii\n', []));
  assert.deepStrictEqual([still.status, still.reason, still.flags], ['unknown', 'unknown-slug', [...ALL, 'pii']]);
});
test('local-files parity: the flag lines survive writeRecord and readRecord', () => {
  // writeRecord + readRecord in a tmp dir; parseRiskFlags(readRecord(p).body) deep-equals parseRiskFlags(body).
});
test('appendRiskProofGotcha names each slug, is idempotent, widens in place, creates the section', () => {
  const once = appendRiskProofGotcha('## Gotchas\n\n- a\n', ['auth']);
  assert.match(once, /Proof\(auth\):/);
  assert.strictEqual(appendRiskProofGotcha(once, ['auth']), once);
  assert.match(appendRiskProofGotcha(once, ['auth', 'migrations']), /Proof\(migrations\):/);
  assert.strictEqual(appendRiskProofGotcha(once, ['auth', 'migrations']).match(/Risk proof required/g).length, 1);
  assert.match(appendRiskProofGotcha('## Overview\n\nx\n', ['auth']), /## Gotchas\n\n- Risk proof required/);
  assert.match(appendRiskProofGotcha('## Gotchas\n\n- a\n\n## Original request\n\nb\n', ['auth']), /Risk proof required[^\n]*\n\n## Original request/);
  assert.strictEqual(appendRiskProofGotcha('## O\n', []), '## O\n');
  const narrowed = appendRiskProofGotcha(appendRiskProofGotcha('## Gotchas\n\n- a\n', ['migrations', 'auth']), ['auth']);
  assert.doesNotMatch(narrowed, /Proof\(migrations\)|`migrations`/);
  assert.strictEqual(narrowed.match(/Risk proof required/g).length, 1);
  assert.doesNotMatch(appendRiskProofGotcha(narrowed, []), /Risk proof required/);
  assert.match(appendRiskProofGotcha(narrowed, []), /## Gotchas\n\n- a\n/);
});

test('parseRiskFlags returns an ok line in canonical order: built-ins first', () => {
  assert.deepStrictEqual(parseRiskFlags('Risk-flags: auth, migrations\n').flags, ['migrations', 'auth']);
});
```

Write the local-files parity test body, using `local-store.js`'s `writeRecord` and `readRecord` in an `fs.mkdtempSync` dir.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/record-risk-flags.test.js`
Expected: FAIL with `parseRiskFlags is not a function`

- [ ] **Step 3: Implement `record-risk-flags.js` and re-export it from `record.js`**

The bullet `appendRiskProofGotcha` writes starts with the literal `- Risk proof required:` and reads: `- Risk proof required: this record carries kept risk flags, so one plan step must contain, per slug, a line \`Proof(<slug>): <text>\` with a specific proof of at least 20 characters. Slugs: \`auth\`, \`migrations\`.` It is one bullet, rewritten in place to name exactly the given slugs, so it widens and narrows with the kept set, and removed (leaving the rest of `## Gotchas` intact) when given `[]` on a body that carries it; on a body without one, `[]` returns the body unchanged. Placement: end of the `## Gotchas` section; when none exists, a new `## Gotchas` section before `## Breaking Change` or `## Original request`, else at the end of the body. Builtins come from `BUILTIN_RISK_CATEGORIES` in `plugin/bin/lib/policy-schema.js`. Writers preserve the body's line ending when it is uniformly CRLF. `record.js` keeps its aggregator shape; add the sub-module to its header list. Add one sentence to `local-store.js`'s header comment naming `Risk-flags:` as a body line carried in `body`, never a `facets` key, because `parseRiskFlags` reads it for both backends.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/record-risk-flags.test.js tests/bin-lib/issues/record.test.js tests/bin-lib/issues/local-store.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-risk-flags.js plugin/bin/lib/issues/record.js plugin/bin/lib/issues/local-store.js tests/bin-lib/issues/record-risk-flags.test.js
git commit -m "Add Risk-flags line grammar and sanctioned writers — refs #4618"
```

### Task 2: The one-writer source scan

**Role:** integration

**Files:**
- Create: `tests/risk-flags-writer-conformance.test.js`
- Modify: `tests/helpers/strip-comments.js`
- Modify: `.claude/skills/parse-signal-discipline/SKILL.md`

**Interfaces:**
- Consumes: Task 1's module path. Exports `findWriterOffenders(relPath, rawSource) -> [{line, reason}]` for the self-test, inside the test file.
- The scan's rules, over keep-mode `stripComments` text, walking `plugin/bin/**/*.js` with `withFileTypes`:
  - A string, template or regex literal holding the line key followed by its colon, `/risk[-_ ]?flags(?:[-_ ]unconfirmed)?\s*:/i`, is a `line-literal` offender anywhere except `plugin/bin/lib/issues/record-risk-flags.js`. The colon is what makes it the line: a bare `risk-flags` also appears in `require('./record-risk-flags')` (`record.js`'s re-export) and in `usage: risk-flags.js ...` (`plugin/bin/risk-flags.js`'s `USAGE`), and neither writes the line.
  - A call or reference to `removeRiskFlag` or `confirmRiskFlags` is a `remover` offender except in `record-risk-flags.js`, `record.js` (re-export) and `plugin/bin/risk-flags.js` (the CLI, Task 4).
  - `stripperVerdict` other than `ok` is an offender.

- [ ] **Step 1: Write the failing test**

```js
test('AC5.6: the tree has one writer of the Risk-flags line', () => {
  const { offenders, files, sites } = scanTree();
  assert.deepStrictEqual(offenders, []);
  assert.ok(files > 300, `walked only ${files} files: the walk broke`);
  assert.ok(sites >= 3, `matched only ${sites} sites: the matcher stopped matching`);
});
test('AC5.6: a planted second writer is flagged at its exact line', () => {
  const planted = "const a = 1;\nconst body2 = `Risk-flags: ${x}`;\n";
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/x.js', planted).map((o) => [o.line, o.reason]), [[2, 'line-literal']]);
});
test('AC5.6: a planted remover call is flagged', () => {
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/accept/x.js', "const b = 1;\nremoveRiskFlag(body, 's', { humanConfirmed: true });\n").map((o) => [o.line, o.reason]), [[2, 'remover']]);
});
test('a comment naming the line is not a writer', () => {
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/x.js', '// writes Risk-flags: a\nconst a = 1;\n'), []);
});
test('a module path or CLI name holding risk-flags with no colon is not a writer', () => {
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/x.js', "const m = require('./record-risk-flags');\nconst u = 'usage: risk-flags.js classify';\n"), []);
});
test('AC5.6: a planted marker literal is flagged at its exact line', () => {
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/x.js', "const a = 1;\nconst m = 'Risk-flags-unconfirmed: true';\n").map((o) => [o.line, o.reason]), [[2, 'line-literal']]);
});
test('a planted mis-parse is an offender', () => {
  assert.ok(findWriterOffenders('plugin/bin/lib/x.js', "if (b) /'/.test(b);\nconst c = 'x';\nnot valid(((").length > 0);
});
```

Set the `files` and `sites` floors to the counts observed at landing, per the skill.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/risk-flags-writer-conformance.test.js`
Expected: FAIL with `findWriterOffenders is not defined`

- [ ] **Step 3: Implement the scan and add the stem `risk-flags-writer` to both caller lists**

The two lists are the header of `tests/helpers/strip-comments.js` and item 15 of `.claude/skills/parse-signal-discipline/SKILL.md`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/risk-flags-writer-conformance.test.js tests/strip-comments-callers-twin.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/risk-flags-writer-conformance.test.js tests/helpers/strip-comments.js .claude/skills/parse-signal-discipline/SKILL.md
git commit -m "Pin one writer of the Risk-flags line with a source scan — refs #4618"
```

### Task 3: The deterministic classifier floor

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/risk-flag-classify.js`
- Modify: `plugin/bin/lib/policy-schema.js`
- Test: `tests/bin-lib/issues/risk-flag-classify.test.js`

**Interfaces:**
- Consumes: `extractSection` (`plugin/bin/lib/markdown-blocks.js`), `isSensitivePath` (`plugin/bin/lib/issues/blast-radius.js`), `resolvePolicyKeys`, `BUILTIN_RISK_CATEGORIES` (`plugin/bin/lib/policy-schema.js`), `isControlModeOn` (`plugin/bin/lib/policy.js`).
- Produces:
  - `classifyRiskFlags(body, { extraCategories = [], pathGlobs = {} } = {}) -> { flags: [{ slug, evidence, via: 'keyword'|'path'|'path-glob' }], missingSections: string[] }`: one entry per slug (first match wins), built-ins first, then extras.
  - `inertEvidence(text) -> string`: collapses whitespace including newlines, drops control bytes, escapes `[`, `]`, `` ` ``, `<`, `>` with a backslash, and caps at 300 characters.
  - `readRiskPolicy(repoRoot, { readFile = fs.readFileSync } = {}) -> { controlMode: boolean, extraCategories: string[], pathGlobs: {}, globsInvalid: boolean }`: `.claude-tweaks/policy.yml` under `repoRoot`; `ENOENT`/`ENOTDIR` reads as control mode off; any other read error throws. Control mode off returns empty extras and globs without resolving them.
- Sections read: `## Deliverables`, `## Acceptance Criteria`, `### Key Files`. Keyword matching is word-bounded and case-insensitive over each line of the first two plus the Key Files line text. Path matching reads backticked paths from Key Files only. A missing section lands in `missingSections`; it is never read as "nothing matched" silently.
- Keyword tables, the floor (these decide the AC1 outcome; wider phrasing is the agent's job, per the spec's "agent may add"):
  - `migrations`: `migrations?`, `schema changes?`, `alter table`, `drop (table|column)`, `database schema`; path `(^|/)migrations?/` or `\.sql$`
  - `auth`: `auth(n|z|entication|orization)?`, `permissions?`, `access control`, `rbac`, `login`, `session tokens?`
  - `public-contract`: `public (api|contract)s?`, `hook payloads?`, `file formats?`, `wire format`, `breaking changes?`, `openapi`
  - `irreversible-side-effect`: `irreversibl\w*`, `permanently delet\w*`, `outbound (sends?|emails?|messages?)`, `sends? (an? )?(emails?|sms|notifications?)`, `payments?`, `refunds?`
  - A policy extra matches its own slug, hyphen or space (`data-export` matches `data export`).
  - `pathGlobs[slug]` matches Key Files paths through `isSensitivePath`, `via: 'path-glob'`.

- [ ] **Step 1: Write the failing test**

```js
const spec = (o) => `Surface: infra\n\n## Deliverables\n\n${o.d || '- [ ] x'}\n\n## Acceptance Criteria\n\n${o.a || '1. y'}\n\n## Technical Approach\n\n### Key Files\n\n${o.k || '- `a/b.js` — z'}\n`;
test('AC1.1: a Key Files migrations path yields the migrations flag', () => {
  const r = classifyRiskFlags(spec({ k: '- `db/migrations/001_add.sql` — add' }));
  assert.deepStrictEqual(r.flags.map((f) => [f.slug, f.via]), [['migrations', 'path']]);
});
test('AC1.1: a Deliverable mentioning a schema change yields the migrations flag with its sentence', () => {
  const r = classifyRiskFlags(spec({ d: '- [ ] Apply a schema change to users' }));
  assert.strictEqual(r.flags[0].slug, 'migrations');
  assert.match(r.flags[0].evidence, /schema change to users/);
});
test('each built-in floor has a positive and a word-bounded negative', () => {
  for (const [text, slug] of [['Refuse an unauthenticated login', 'auth'], ['Change a hook payload field', 'public-contract'], ['Send an email to the owner', 'irreversible-side-effect']]) {
    assert.deepStrictEqual(classifyRiskFlags(spec({ a: `1. ${text}` })).flags.map((f) => f.slug), [slug], text);
  }
  assert.deepStrictEqual(classifyRiskFlags(spec({ a: '1. the author wrote authority notes about emigration' })).flags, []);
});
test('a section other than the three is not read', () => {
  assert.deepStrictEqual(classifyRiskFlags('## Overview\n\nschema change\n\n## Deliverables\n\n- a\n\n## Acceptance Criteria\n\n1. b\n\n### Key Files\n\n- `a/b.js`\n').flags, []);
});
test('a missing section is reported, not silent', () => {
  assert.deepStrictEqual(classifyRiskFlags('## Deliverables\n\n- a\n').missingSections, ['Acceptance Criteria', 'Key Files']);
});
test('a policy extra and a path glob classify', () => {
  assert.deepStrictEqual(classifyRiskFlags(spec({ d: '- [ ] Add a data export' }), { extraCategories: ['data-export'] }).flags.map((f) => f.slug), ['data-export']);
  assert.deepStrictEqual(classifyRiskFlags(spec({ k: '- `src/secure/a.js`' }), { pathGlobs: { auth: ['src/secure/**'] } }).flags.map((f) => [f.slug, f.via]), [['auth', 'path-glob']]);
});
test('inertEvidence neutralizes hostile text', () => {
  const out = inertEvidence('a\n## Forged [x](https://evil.example) <!-- m --> `c`');
  assert.ok(!out.includes('\n'));
  assert.match(out, /\\\[x\\\]/);
  assert.match(out, /\\<!-- m --\\>/);
  assert.ok(inertEvidence('z'.repeat(500)).length <= 300);
});
test('readRiskPolicy: control mode off consults neither extra key', () => {
  const read = () => 'risk-categories: pii\nrisk-path-globs:\n  auth: [a/**]\n';
  assert.deepStrictEqual(readRiskPolicy('/r', { readFile: read }), { controlMode: false, extraCategories: [], pathGlobs: {}, globsInvalid: false });
});
test('readRiskPolicy: control mode on resolves both, a malformed block is flagged', () => {
  const on = (rest) => () => `control-mode: on\n${rest}`;
  assert.deepStrictEqual(readRiskPolicy('/r', { readFile: on('risk-categories: pii\nrisk-path-globs:\n  pii: [a/**]\n') }), { controlMode: true, extraCategories: ['pii'], pathGlobs: { pii: ['a/**'] }, globsInvalid: false });
  assert.strictEqual(readRiskPolicy('/r', { readFile: on('risk-path-globs: x\n') }).globsInvalid, true);
});
test('readRiskPolicy: an absent file is control mode off, another error throws', () => {
  const err = (code) => () => { throw Object.assign(new Error(code), { code }); };
  assert.strictEqual(readRiskPolicy('/r', { readFile: err('ENOENT') }).controlMode, false);
  assert.throws(() => readRiskPolicy('/r', { readFile: err('EACCES') }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/risk-flag-classify.test.js`
Expected: FAIL with `Cannot find module`

- [ ] **Step 3: Implement `risk-flag-classify.js`**

Evidence is `inertEvidence` of the matched line, list markers and checkboxes stripped. `risk-path-globs` is read through `resolvePolicyKeys` only, per `policy-schema.md`'s "Read it only through the resolver". A `null` value with `invalid` sets `globsInvalid: true`, `pathGlobs: {}`. No literal `Risk-flags` in this file (Task 2's scan). Add one header line to `plugin/bin/lib/policy-schema.js`'s control-mode comment (line 179 after the 2026-11-03 merge; it opens `// Control mode (#4609, human-in-control #4608)`) narrowing "Nothing reads them yet" to the twelve flat keys, naming `risk-flag-classify.js` as the reader of the two risk keys.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/risk-flag-classify.test.js tests/resolve-policy-control-mode.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/risk-flag-classify.js plugin/bin/lib/policy-schema.js tests/bin-lib/issues/risk-flag-classify.test.js
git commit -m "Add the risk-flag classifier floor — refs #4618"
```

### Task 4: The `risk-flags.js` CLI: classify, settle, confirm

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/risk-flags.js`
- Test: `tests/risk-flags-cli.test.js`
- Modify: `docs/plugin-structure.md`

**Interfaces:**
- Consumes: Tasks 1 and 3. `require('./log-decision').run(argv, deps)` for the removal line.
- Exit codes, *Payload-1/Invocation-2* plus 3 for a caller-named write, per `qa-report.js`: 0 success, 1 an unreadable body or prior-body file, 2 malformed invocation, 3 the body file could not be written. State them in the header and `USAGE`.
- Produces `run(argv, deps)` with deps `{ stdout, stderr, readFile, writeFile, cwd, policy }`, and three verbs:
  - `classify --body-file <f> [--prior-body-file <f>] [--add a,b] [--repo-root <dir>]` prints `{ flags, kept, entry, missingSections, controlMode, extraCategories, globsInvalid, known }`. `flags` is the floor only (`known` is the built-ins plus the policy extras). `kept` is exactly the union `settle` would compute from the same arguments (one shared helper, so the two cannot drift), in canonical order. `entry` is `{ status, reason, unconfirmed }` from `parseRiskFlags` on the body's own line. Writes nothing. Tasks 10 and 11 build their questions and selections from `kept` and `entry`, never by reading the line by eye (plan review, 2026-11-03); add one test asserting `classify`'s `kept` deep-equals `settle --headless`'s `flags` for the same inputs, including an `unknown` prior line.
  - `settle --body-file <f> [--prior-body-file <f>] [--add a,b] (--headless | --answers-file <f>) [--run <dir>] [--repo-root <dir>]` computes the kept set: the prior body's flags ∪ the body's own existing flags ∪ the floor ∪ `--add` (an `unknown` line contributes its widened list). Rewrites `--body-file` in place through `addRiskFlags`, `removeRiskFlag`, `confirmRiskFlags` and `appendRiskProofGotcha`. Prints `{ flags, removed, unconfirmed, status, refused, logged, logFailures }` (`logged` is `null` with no `--run`; `refused` is `null` unless the Reading A refusal below applied). Exactly one of `--headless`/`--answers-file`, else exit 2.
  - `confirm --body-file <f> --answers-file <f> [--run <dir>] [--repo-root <dir>]` is the human batch for `/backlog refine`: applies answers to the body's existing flags only, runs no classifier, adds nothing. A body with no flag line stays byte-identical, reporting `status: 'unclassified'`. Prints the same envelope as `settle`.
- `status` is the entry status: `parseRiskFlags` of `--body-file`, or `unknown` when `--prior-body-file` reads `unknown`.
- Reading A, both verbs: when the entry status is `unknown` and an answers file was given, no answer is applied. `removeRiskFlag` and `confirmRiskFlags` are never called, the widened set stays on the body, and `Risk-flags-unconfirmed: true` is kept, or written through `addRiskFlags(..., { unconfirmed: true })` when absent. Nothing is logged, and `removed` is `[]`. `refused` is `{ reason: 'malformed' | 'unknown-slug', raw, answered: [slug, ...] }`, where `answered` lists the slugs the answers file named (empty for an unreadable answers file). One stderr warning names the record's flag line as unreadable without quoting the `Risk-flags` key. Exit 0: the fail direction is keep, not a usage error. A `RISK_FLAGS_UNKNOWN` throw from a writer is caught by its `code` into the same path, so the refusal never escapes as exit 1. `confirm` on an `unknown` body that already carries the marker leaves it byte-identical. `--headless` on an `unknown` line removes nothing anyway, so `refused` stays `null` there.
- Answers file: JSON object `{ "<slug>": "keep" | "remove" }`.
- Settle semantics:
  - `--headless`: nothing removed. `unconfirmed: true` when the kept set is non-empty.
  - `--answers-file` (entry status not `unknown`; an `unknown` one takes the Reading A path above): for each flag in the kept set, `remove` calls `removeRiskFlag(..., { humanConfirmed: true })`, `keep` keeps. A flag with no answer, or an unreadable, unparseable or non-object answers file, or a value other than `keep`/`remove`, leaves the flag kept and sets `unconfirmed: true` with one stderr warning, exit 0: that is the fail direction, not a usage error. Only when every flag was answered is the marker cleared (`confirmRiskFlags`).
  - An empty kept set writes `Risk-flags: none`, no marker, no Gotcha.
  - After removals, `settle` and `confirm` always call `appendRiskProofGotcha(body, keptSet)`: a non-empty kept set rewrites the bullet to exactly its slugs, and an empty one removes it.
  - Each removal with `--run` logs `--status KEPT-PROMPT --section /specify --step "Risk flags" --text "Risk flag {slug} removed by the maintainer during shaping" --reversibility low` (round 3, Reading B: a human answered it inline, so never `AUTO`). A non-zero return or throw pushes the slug to `logFailures` and sets `logged: false`; never changes the exit code.
- `--repo-root` defaults to `git rev-parse --show-toplevel` through deps, with the `windowsHide` option, falling back to `cwd`.

- [ ] **Step 1: Write the failing test**

```js
// run(argv, deps) in-process over tmp files; helper `settle(body, args)` returns { out, body, code }.
test('AC3.1: headless shaping never drops a detected flag and writes the marker', () => {
  const { out, body } = settle(SPEC_WITH_MIGRATIONS_PATH, ['--headless']);
  assert.deepStrictEqual(out.flags, ['migrations']);
  assert.match(body, /^Risk-flags: migrations$/m);
  assert.match(body, /^Risk-flags-unconfirmed: true$/m);
  assert.match(body, /Proof\(migrations\):/);
});
test('AC3.1: headless never removes a prior flag the new text no longer implies', () => {
  const { out } = settle(CLEAN_SPEC, ['--headless', '--prior-body-file', priorWith('auth')]);
  assert.deepStrictEqual(out.flags, ['auth']);
});
test('AC2.1: a remove answer drops the flag and writes the removal entry to decisions.md', () => {
  const run = realAnchoredRunDirFixture();
  const { out, body } = settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', answers({ migrations: 'remove' }), '--run', run]);
  assert.deepStrictEqual([out.flags, out.removed, out.logged], [[], ['migrations'], true]);
  assert.match(body, /^Risk-flags: none$/m);
  assert.match(readDecisions(run), /^- KEPT-PROMPT \S+ — .*Risk flag migrations removed by the maintainer during shaping/m);
  assert.doesNotMatch(readDecisions(run), /^- AUTO .*removed by the maintainer/m);
});
test('AC2.2: a keep answer leaves the flag and clears the marker', () => {
  const { out, body } = settle(withUnconfirmed(SPEC_WITH_MIGRATIONS_PATH), ['--answers-file', answers({ migrations: 'keep' })]);
  assert.deepStrictEqual([out.flags, out.unconfirmed], [['migrations'], false]);
  assert.doesNotMatch(body, /Risk-flags-unconfirmed/);
});
test('AC5.7: an unanswered, unreadable or malformed answer keeps the flag and marks it unconfirmed', () => {
  for (const a of [answers({}), answers({ migrations: 'perhaps' }), '/nope/missing.json', rawFile('not json'), rawFile('null'), rawFile('[]')]) {
    const { out, body, code } = settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', a]);
    assert.strictEqual(code, 0, a);
    assert.deepStrictEqual([out.flags, out.unconfirmed], [['migrations'], true], a);
    assert.match(body, /^Risk-flags-unconfirmed: true$/m, a);
  }
});
test('a removal with an unanchored --run is logged:false and still exits 0', () => {
  const { out, code } = settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', answers({ migrations: 'remove' }), '--run', '/not/a/run']);
  assert.deepStrictEqual([code, out.logged, out.logFailures], [0, false, ['migrations']]);
});
test('AC6.1: confirm runs no classifier: a record with no flag lines stays byte-identical', () => {
  const { body, out } = confirm(SPEC_WITH_MIGRATIONS_PATH, answers({}));
  assert.strictEqual(body, SPEC_WITH_MIGRATIONS_PATH);
  assert.strictEqual(out.status, 'unclassified');
});
test('confirm applies a remove and a keep to existing flags only', () => {
  const { out } = confirm('Risk-flags: auth, migrations\nRisk-flags-unconfirmed: true\n', answers({ auth: 'remove', migrations: 'keep' }));
  assert.deepStrictEqual([out.flags, out.unconfirmed], [['migrations'], false]);
});
const ALL = ['migrations', 'auth', 'public-contract', 'irreversible-side-effect'];
const MALFORMED = 'Surface: infra\nRisk-flags: Auth\nRisk-flags-unconfirmed: true\n\n## Overview\n';
const UNKNOWN_SLUG = 'Surface: infra\nRisk-flags: auth, pii\nRisk-flags-unconfirmed: true\n\n## Overview\n';
// Reading A's one assertion: widened set kept, marker kept, nothing removed, no removal line.
function assertRefused({ out, body, code }, run, reason) {
  assert.strictEqual(code, 0);
  assert.deepStrictEqual([out.status, out.removed, out.unconfirmed, out.refused.reason], ['unknown', [], true, reason]);
  assert.deepStrictEqual(parseRiskFlags(body).flags.slice(0, 4), ALL);
  assert.match(body, /^Risk-flags-unconfirmed: true$/m);
  assert.doesNotMatch(readDecisions(run), /removed by the maintainer during shaping/);
}
test('Reading A: settle refuses a remove answer on a malformed line and logs nothing', () => {
  const run = realAnchoredRunDirFixture();
  const r = settle(MALFORMED, ['--answers-file', answers({ auth: 'remove' }), '--run', run]);
  assertRefused(r, run, 'malformed');
  assert.deepStrictEqual(r.out.refused.answered, ['auth']);
});
test('Reading A: settle refuses a remove answer on a line naming an unknown slug', () => {
  const run = realAnchoredRunDirFixture();
  assertRefused(settle(UNKNOWN_SLUG, ['--answers-file', answers({ pii: 'remove', auth: 'keep' }), '--run', run]), run, 'unknown-slug');
});
test('Reading A: settle refuses when only the prior body reads unknown', () => {
  const run = realAnchoredRunDirFixture();
  assertRefused(settle(SPEC_WITH_MIGRATIONS_PATH, ['--prior-body-file', rawFile(MALFORMED), '--answers-file', answers({ migrations: 'remove' }), '--run', run]), run, 'malformed');
});
test('Reading A: a keep-all answer on an unknown line does not clear the marker', () => {
  const run = realAnchoredRunDirFixture();
  assertRefused(settle(MALFORMED, ['--answers-file', answers(Object.fromEntries(ALL.map((s) => [s, 'keep']))), '--run', run]), run, 'malformed');
});
test('Reading A: confirm with a partial answer on an unknown line keeps the widened set and the marker', () => {
  const run = realAnchoredRunDirFixture();
  const r = confirm(MALFORMED, answers({ auth: 'keep' }), ['--run', run]);
  assertRefused(r, run, 'malformed');
  assert.strictEqual(r.body, MALFORMED);
});
test('Reading A: confirm with a remove answer on an unknown line keeps the widened set and the marker', () => {
  const run = realAnchoredRunDirFixture();
  const r = confirm(UNKNOWN_SLUG, answers({ auth: 'remove' }), ['--run', run]);
  assertRefused(r, run, 'unknown-slug');
  assert.strictEqual(r.body, UNKNOWN_SLUG);
});
test('Reading A: confirm writes the marker on an unknown line that lacks one', () => {
  const run = realAnchoredRunDirFixture();
  assertRefused(confirm('Risk-flags: Auth\n', answers({ auth: 'remove' }), ['--run', run]), run, 'malformed');
});
test('settle needs exactly one of --headless and --answers-file; a missing body exits 1', () => {
  assert.strictEqual(runCli(['settle', '--body-file', tmp]).code, 2);
  assert.strictEqual(runCli(['settle', '--body-file', tmp, '--headless', '--answers-file', tmp]).code, 2);
  assert.strictEqual(runCli(['settle', '--body-file', '/nope', '--headless']).code, 1);
  assert.strictEqual(runCli(['nope']).code, 2);
  assert.strictEqual(runCli(['settle', '--body-file']).code, 2);
});
test('control mode on: settle recognises a policy slug and a path glob; off, neither is consulted', () => {
  // A repo-root fixture with .claude-tweaks/policy.yml; assert out.flags both ways.
});
test('a real spawn of the bin returns the JSON envelope on stdout', () => { /* execFileSync(process.execPath, [bin, 'classify', ...]) */ });
```

`realAnchoredRunDirFixture` builds a git repo under `tests/helpers/git-fixtures.js` with `.claude-tweaks/pipelines/{run}` and passes `cwd`/`mainRoot` through the deps `log-decision.js`'s `run` reads. `readDecisions(run)` returns `''` when `decisions.md` is absent, so a refusal test proves no line was written rather than throwing. `confirm(body, answersFile, extra = [])` mirrors `settle`. The file imports `parseRiskFlags` from `plugin/bin/lib/issues/record.js`. Implementer finishes the two stubbed bodies.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/risk-flags-cli.test.js`
Expected: FAIL with `Cannot find module`

- [ ] **Step 3: Implement `plugin/bin/risk-flags.js`**

Validate each value flag inside `parseArgs` (`typeof v !== 'string' || !v.trim() || v.startsWith('--')` is a usage error; look flags up with `Object.hasOwn`). The body read and body write are both through deps and try/caught into the exit codes. Add a `docs/plugin-structure.md` command line after the `plan-audit.js` line, and a clause in the `plugin/bin/lib/issues/` paragraph naming `record-risk-flags.js` and `risk-flag-classify.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/risk-flags-cli.test.js tests/risk-flags-writer-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/risk-flags.js tests/risk-flags-cli.test.js docs/plugin-structure.md
git commit -m "Add the risk-flags CLI: classify, settle, confirm — refs #4618"
```

### Task 5: Plan-audit Check G in the full audit

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/plan-audit/parser.js`
- Modify: `plugin/bin/lib/plan-audit/checks.js`
- Modify: `plugin/bin/plan-audit.js`
- Test: `tests/bin-lib/plan-audit/parser.test.js`
- Test: `tests/bin-lib/plan-audit/checks.test.js`
- Test: `tests/bin-lib/plan-audit/cli.test.js`

This task leaves `USAGE` (`plugin/bin/lib/plan-audit/args.js`) unchanged: Check G runs whenever `--spec` is given, a flag `USAGE` already names, so `tests/plan-audit-check-e-prose.test.js` (every restated invocation names exactly `USAGE`'s flags) stays green between this task and Task 6.

**Interfaces:**
- Consumes: `parseRiskFlags` (Task 1), `readRiskPolicy` (Task 3).
- Produces:
  - `extractProofLines(planText) -> { proofs: [{ slug, text, task }], nearMisses: [{ task, raw }] }` in `parser.js`. Only lines inside `extractTaskBlocks`' task bodies, outside fences. Strict form: `/^[ \t]*(?:[-*+][ \t]+)?(?:\[[ xX]?\][ \t]+)?(?:\*\*)?Proof\(([a-z0-9][a-z0-9-]*)\):(?:\*\*)?[ \t]*(.*)$/`. A line whose start case-insensitively resembles `proof(` or `proof (` but fails the strict form is a near-miss.
  - `isSubstantiveProof(slug, text) -> null | 'too-short' | 'restates-category'` in `checks.js`: under 20 characters is `too-short`; empty after dropping the slug's hyphen-split words and the fillers `category proof risk flag the a an for of this is and covered handled` is `restates-category`.
  - `checkG(specText, planText, { extraCategories = [], planPath = null } = {})`, gating, returning one of:
    - `{ ok: true, skipped: 'unclassified' | 'no-flags' }`
    - `{ ok, status, required: string[], unconfirmed: boolean, proofs: [{slug, task}], missing: [{slug, plan, reason}], couldNotParse: [{source: 'flag-line'|'plan'|'proof-line', raw}] }`, with `ok === (missing.length === 0 && couldNotParse.length === 0)`, `reason` being `no-proof-line`, `too-short` or `restates-category`.
  - Normalize `\r\n?` in both inputs once, at `checkG`'s entry. `countTasks(plan).tasks === 0` gives `couldNotParse: [{source: 'plan', raw: 'no parseable tasks'}]`. A `status: 'unknown'` line with `reason: 'malformed'` gives `{source: 'flag-line', raw}`. A near-miss gives `{source: 'proof-line', raw}`.
  - Envelope key `checkG`; `pass` conjunction gains `report.checkG.ok`; without `--spec`, `{ ok: true, skipped: 'no-spec' }`.
  - `summaryLine` parts: `Check G: missing proof for {slugs joined ', '} in {planPath}` and `Check G: could-not-parse {N} ({sources})`.
  - `plan-audit.js` reads `readRiskPolicy(repoRoot)` only when a spec is present; a thrown policy read exits 2.

- [ ] **Step 1: Write the failing test**

`tests/bin-lib/plan-audit/checks.test.js`, appended (Expected: FAIL after Step 1):

```js
const G_SPEC = (line) => `---\nrecord: 1\n---\n# 1: t\n\nSurface: infra\n${line}\n\n## Overview\n`;
const G_PLAN = (body) => `### Task 1: x\n\n- [ ] **Step 1: y**\n\n${body}\n`;
const GOOD = 'Rehearse the migration against a copy of production data and diff row counts.';
test('AC4.1: a kept flag with no proof line fails, naming the slug and the plan', () => {
  const r = checkG(G_SPEC('Risk-flags: migrations'), G_PLAN('nothing'), { planPath: 'p.md' });
  assert.deepStrictEqual([r.ok, r.missing], [false, [{ slug: 'migrations', plan: 'p.md', reason: 'no-proof-line' }]]);
});
test('AC4.1: a proof shorter than 20 characters fails', () => {
  assert.strictEqual(checkG(G_SPEC('Risk-flags: auth'), G_PLAN('Proof(auth): too short')).missing[0].reason, 'too-short');
});
test('AC4.1: one proof per kept slug passes', () => {
  const r = checkG(G_SPEC('Risk-flags: migrations, auth'), G_PLAN(`Proof(migrations): ${GOOD}\n- Proof(auth): An unauthenticated request to the route still returns 401.`));
  assert.deepStrictEqual([r.ok, r.missing, r.couldNotParse], [true, [], []]);
});
test('AC4.1: a proof for only one of two slugs still fails on the other', () => {
  assert.deepStrictEqual(checkG(G_SPEC('Risk-flags: migrations, auth'), G_PLAN(`Proof(migrations): ${GOOD}`)).missing.map((m) => m.slug), ['auth']);
});
test('AC4.1: an unparseable flag line reports could-not-parse, however many proofs exist', () => {
  const all = ['migrations', 'auth', 'public-contract', 'irreversible-side-effect'].map((s) => `Proof(${s}): ${GOOD}`).join('\n');
  const r = checkG(G_SPEC('Risk-flags: Auth'), G_PLAN(all));
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.couldNotParse, [{ source: 'flag-line', raw: 'Risk-flags: Auth' }]);
});
test('AC4.1: an unparseable plan reports could-not-parse', () => {
  assert.deepStrictEqual(checkG(G_SPEC('Risk-flags: auth'), 'no tasks here').couldNotParse, [{ source: 'plan', raw: 'no parseable tasks' }]);
});
test('AC4.1: a near-miss proof line reports could-not-parse', () => {
  assert.strictEqual(checkG(G_SPEC('Risk-flags: auth'), G_PLAN(`proof (auth): ${GOOD}`)).couldNotParse[0].source, 'proof-line');
});
test('AC4.1: a record with no flags or unclassified does nothing', () => {
  assert.deepStrictEqual(checkG(G_SPEC('Risk-flags: none'), 'no tasks here'), { ok: true, skipped: 'no-flags' });
  assert.deepStrictEqual(checkG(G_SPEC(''), 'no tasks here'), { ok: true, skipped: 'unclassified' });
});
test('an unknown slug needs a proof for every widened flag, and can be satisfied', () => {
  const r = checkG(G_SPEC('Risk-flags: pii'), G_PLAN(`Proof(pii): ${GOOD}`));
  assert.deepStrictEqual(r.missing.map((m) => m.slug), ['migrations', 'auth', 'public-contract', 'irreversible-side-effect']);
  assert.deepStrictEqual(r.couldNotParse, []);
});
test('a policy slug passed in reads ok and needs only its own proof', () => {
  assert.strictEqual(checkG(G_SPEC('Risk-flags: pii'), G_PLAN(`Proof(pii): ${GOOD}`), { extraCategories: ['pii'] }).ok, true);
});
test('a proof that restates the category fails', () => {
  assert.strictEqual(checkG(G_SPEC('Risk-flags: public-contract'), G_PLAN('Proof(public-contract): public contract proof for the public contract')).missing[0].reason, 'restates-category');
});
test('a proof in a fence, or outside any task, does not satisfy', () => {
  assert.strictEqual(checkG(G_SPEC('Risk-flags: auth'), G_PLAN(`\`\`\`\nProof(auth): ${GOOD}\n\`\`\``)).ok, false);
  assert.strictEqual(checkG(G_SPEC('Risk-flags: auth'), `Proof(auth): ${GOOD}\n\n${G_PLAN('x')}`).ok, false);
});
test('CRLF plan and spec read the same as LF', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  assert.strictEqual(checkG(crlf(G_SPEC('Risk-flags: auth')), crlf(G_PLAN(`Proof(auth): ${GOOD}`))).ok, true);
});
test('an unconfirmed flag still requires its proof', () => {
  const r = checkG(G_SPEC('Risk-flags: auth\nRisk-flags-unconfirmed: true'), G_PLAN('x'));
  assert.deepStrictEqual([r.ok, r.unconfirmed], [false, true]);
});
```

`tests/bin-lib/plan-audit/cli.test.js`, appended: exit 1 and a summary naming the slug on a missing proof; exit 0 with `Proof` present; with no `--spec` `checkG` is `{ok: true, skipped: 'no-spec'}`. Update the existing `Object.keys(restA)` assertion at line 750 (unmoved by the 2026-11-03 merge) by destructuring `checkG` out in the same way as `checkE`/`checkF` (lines 747-748). `control-mode: on` in a fixture repo's `.claude-tweaks/policy.yml` makes `Risk-flags: pii` with `risk-categories: pii` need only its own proof; `control-mode` off makes it widen.

`tests/bin-lib/plan-audit/parser.test.js`, appended: `extractProofLines` returns slug, text and task; ignores fences; reports the near-miss.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/plan-audit/checks.test.js`
Expected: FAIL after Step 1 with `checkG is not a function`

- [ ] **Step 3: Implement Check G in the parser, the check and the envelope**

`checks.js` header and `plan-audit.js` header name Check G. `extractProofLines` goes in `parser.js` beside `extractTaskBlocks`; `checkG` and `isSubstantiveProof` in `checks.js`; the envelope key, `pass` conjunction and `summaryLine` parts in `plan-audit.js`. Leave `USAGE` alone.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/plan-audit/parser.test.js tests/bin-lib/plan-audit/checks.test.js tests/bin-lib/plan-audit/cli.test.js tests/plan-audit-check-e-prose.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/plan-audit/parser.js plugin/bin/lib/plan-audit/checks.js plugin/bin/plan-audit.js tests/bin-lib/plan-audit/parser.test.js tests/bin-lib/plan-audit/checks.test.js tests/bin-lib/plan-audit/cli.test.js
git commit -m "Add plan-audit Check G: a kept risk flag needs a Proof line — refs #4618"
```

### Task 6: The `--risk-proofs` verb and the plan-audit prose

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/plan-audit/args.js`
- Modify: `plugin/bin/plan-audit.js`
- Modify: `plugin/skills/build/plan-audit.md`
- Modify: `plugin/skills/build/SKILL.md`
- Modify: `docs/plugin-structure.md`
- Test: `tests/bin-lib/plan-audit/cli.test.js`
- Test: `tests/plan-audit-check-g-prose.test.js`

Seven files, one over the plan's ~6 target, because they cannot split: `tests/plan-audit-check-e-prose.test.js` asserts that every restated `plan-audit.js` invocation (`plan-audit.md`, `build/SKILL.md`, `docs/plugin-structure.md`) names exactly `USAGE`'s flags, so adding `--risk-proofs` to `USAGE` and the three restatements in separate tasks would leave a red suite in between.

**Interfaces:**
- Consumes: `checkG` and the envelope from Task 5.
- `--risk-proofs`: read-only verb, requires `--spec` (else `UsageError`), refused beside `--count-tasks`, `--bytes`, `--task-markers`. Prints `{"checkG": {...}}` plus a newline, exit 1 when `ok` is false, 2 on an unreadable plan or spec. `--spec` is allowed beside this verb, and beside no other read-only verb. `USAGE` gains `[--risk-proofs]`.

- [ ] **Step 1: Write the failing test**

`tests/bin-lib/plan-audit/cli.test.js`, appended: `--risk-proofs` exits 0/1 by proof presence, prints only `checkG`, exits 2 without `--spec`, exits 2 beside each other verb, exits 2 on an unreadable spec, and on a trivial two-file plan for a flagged spec still exits 1 (the skip path's bypass, Review Focus 5).

`tests/plan-audit-check-g-prose.test.js`: one assertion function, a positive and a go-red negative (same function against text with each literal removed), pinning in `plan-audit.md` the literals `Check G`, `checkG.missing`, `checkG.couldNotParse`, `--risk-proofs`, `could-not-parse`, `Proof(<slug>)`, and `**Check G does not share that gate**`; in `build/SKILL.md`, `--risk-proofs`. Assert every restated invocation (`plan-audit.md`, `build/SKILL.md`, `docs/plugin-structure.md`) names exactly `USAGE`'s flags, as `tests/plan-audit-check-e-prose.test.js` does. That file reads `USAGE` itself (`flags(USAGE)`), so it needs no edit; run it.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plan-audit-check-g-prose.test.js`
Expected: FAIL after Step 1 with an assertion naming `Check G` absent from `plan-audit.md`

- [ ] **Step 3: Implement the verb and write the prose at every registration site**

`args.js`: the flag, its refusals and `USAGE`. `plan-audit.js`: the verb's branch beside `--bytes`. `plan-audit.md`: opening enumeration; Invocation line; envelope key list; `--risk-proofs` paragraph; two `Result interpretation` bullets (`checkG.missing`: amend the plan with a real proof per slug and re-run once, in auto with an `AUTO` `Common Step 1.5 (Check G)` log line, then stop if it still fails, since this is a plan-validation HARD-GATE, never the `scope-creep` policy; `checkG.couldNotParse`: stop, name each `source` and `raw`); a `What each check covers` bullet stating gating and why; the skip-gate paragraph gains `**Check G does not share that gate**` with its reason: a trivial plan or a fast-lane record is exactly where a skipped proof would pass silently, so the skip path also runs `--risk-proofs` when a materialized spec exists. `plan-audit.md`'s claim "`Exit code is 0 iff every check's ok`" stays true. `build/SKILL.md` Common Step 1.5: invocation line gains `[--risk-proofs]`; one bullet for Check G; the skip sentence gains the `--risk-proofs --spec {spec-file}` call and its stop. SKILL.md has 265 B of rail headroom: stay under the rail, and if needed trim the parenthetical restating why a NUL is fatal at any size (plan-audit.md line 5 keeps it). `docs/plugin-structure.md`: `plan-audit.js` line and `build` table row. Then run the skill's anti-pattern sweep.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/plan-audit/cli.test.js tests/plan-audit-check-g-prose.test.js tests/plan-audit-check-e-prose.test.js`
Expected: PASS. Also `git grep -nE 'Checks? A/B' -- plugin docs` lists no enumeration that omits a check it should name.

- [ ] **Step 5: Corpus probe**

Run `plan-audit.js {plan} --risk-proofs --spec {spec}` over every committed plan and its spec pair (`git ls-files '*/work/*-spec.md'`) with a scratch script. Expected: every pair reports `skipped: 'unclassified'`, because no record carries the line yet. Write the output to `$PIPELINE_RUN_DIR/evidence/check-g-corpus.txt` (`mkdir -p` first, plain redirect) and log one `AC evidence` entry citing the count.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/plan-audit/args.js plugin/bin/plan-audit.js plugin/skills/build/plan-audit.md plugin/skills/build/SKILL.md docs/plugin-structure.md tests/bin-lib/plan-audit/cli.test.js tests/plan-audit-check-g-prose.test.js
git commit -m "Add the plan-audit --risk-proofs verb and document Check G — refs #4618"
```

### Task 7: Keep flagged records off the unaudited paths

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/express/eligibility.js`
- Modify: `plugin/skills/build/micro-plan.md`
- Modify: `plugin/skills/_shared/express-lane.md`
- Test: `tests/bin-lib/express/eligibility.test.js`
- Test: `tests/risk-flags-bypass-prose.test.js`

**Interfaces:**
- Consumes: `parseRiskFlags` (Task 1).
- `REASONS.riskFlags = 'record carries a kept risk flag'` in `eligibility.js`, pushed when `parseRiskFlags(body).flags.length > 0`.

- [ ] **Step 1: Write the failing test**

`tests/bin-lib/express/eligibility.test.js`, appended (Expected: FAIL after Step 1): an otherwise-eligible fixture with `Risk-flags: auth` in its body is `eligible: false` and names the reason; `Risk-flags: none` stays eligible; a malformed line is ineligible; no line stays eligible.

`tests/risk-flags-bypass-prose.test.js`: `micro-plan.md`'s applicability gate names `parseRiskFlags` semantics with the literal `carries a risk flag`; `express-lane.md`'s Eligibility names `kept risk flag`. One assertion function, a go-red negative for each.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/express/eligibility.test.js tests/risk-flags-bypass-prose.test.js`
Expected: FAIL after Step 1 with `eligible` true for the `Risk-flags: auth` fixture

- [ ] **Step 3: Implement**

`micro-plan.md`: add a check to the applicability gate, cheapest first: a spec body that carries a risk flag (a `Risk-flags:` line with any slug, or an unreadable one; `Risk-flags: none` and no line are fine) falls through to `/superpowers:writing-plans`, because the composed plan has no audited proof step. Update "All three must hold" (line 10) to "All four". `express-lane.md`: Eligibility gains the condition.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/express/eligibility.test.js tests/risk-flags-bypass-prose.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/express/eligibility.js plugin/skills/build/micro-plan.md plugin/skills/_shared/express-lane.md tests/bin-lib/express/eligibility.test.js tests/risk-flags-bypass-prose.test.js
git commit -m "Keep flagged records off the micro-plan path and the express lane — refs #4618"
```

### Task 8: The packet's `proof` fact kind and the planned-proof ruling

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/packet-contract.js`
- Modify: `plugin/bin/lib/wrap-up/packet-validate.js`
- Modify: `plugin/skills/_shared/acceptance-packet.md`
- Test: `tests/bin-lib/wrap-up/packet-links.test.js`
- Test: `tests/bin-lib/wrap-up/packet-validate.test.js`
- Test: `tests/acceptance-packet-contract-conformance.test.js`

**Interfaces:**
- `FACT_KINDS` gains `'proof'` appended after `'deploy'`; `SECTION_KINDS['risk-proofs']` becomes `['flag', 'check', 'story', 'recording', 'link', 'proof']`. Additive: no kind or section is renamed or removed, and `SCHEMA_VERSION` stays `1`, since a v1 facts file with no `proof` fact validates exactly as before.
- `validatePacket` returns `{ kept, moved, dropped, screened, planned }`; `planned` is `[{ claim, because }]`, `because` being the cited `proof` fact that put it there. The rule, placed in `placeClaim` after the existing risk-proof routing and before `kept.push`: for a `risk-proofs` claim whose refs other than `flag` facts are all `proof` facts, a `failed` proof moves it to `tried-to-break` (`because` that proof); else a `skipped` or `not-run` proof puts it in `planned`; else (every proof `passed`) it is kept. A claim that also cites a `check`, `story`, `recording` or `link` keeps today's routing, and its `proof` refs do not route it. `noProofFact` is unchanged: a `proof` is a proof fact, so `['flag:auth', 'proof:auth']` is not dropped.
- Consumers that pin these lists or this return shape, from `git grep -n -l -e FACT_KINDS -e SECTION_KINDS -e packet-contract -- plugin tests docs` plus `git grep -n -e validatePacket -e ROUTED_KINDS -- plugin tests`, classified:
  - `plugin/bin/lib/wrap-up/packet-validate.js`: reads both lists; gains the rule (this task).
  - `plugin/bin/lib/wrap-up/packet-render.js`: the one `validatePacket` caller in `plugin`, destructuring `{ kept, moved, dropped, screened }`. It must render `planned` or a planned claim vanishes from the packet: Task 9.
  - `tests/bin-lib/wrap-up/packet-links.test.js`: deep-equals both lists exactly (lines 263, 266-272); both literals updated (this task).
  - `tests/acceptance-packet-contract-conformance.test.js`: reads both constants and compares them to the doc's `**Fact kinds:**` list and section-to-kind table, so it follows the doc edit with no literal to change; gains one `VALIDATION_FACTS` pin for the new sentence (this task).
  - `tests/bin-lib/wrap-up/packet-validate.test.js`: `assertOnly` walks `['kept', 'moved', 'dropped', 'screened']` (line 47); it gains `'planned'` so every existing test also proves nothing landed there (this task).
  - `plugin/skills/_shared/acceptance-packet.md`: states the kinds list, the table and the validation policy (this task).
  - No consumer, checked: `plugin/bin/acceptance-packet.js` imports `CLAIM_SECTIONS, MAX_PACKET_CHARS, PACKET_MARKER, SCHEMA_VERSION`; `packet-gather.js` imports `SCHEMA_VERSION, PACKET_MARKER_RE, COMMANDS_ONLY_SURFACES, encodeFactKey`; `packet-links.js` imports `CREDENTIAL_KEYS`; `packet-post.js` imports `LOCAL_START, LOCAL_END`; `tests/acceptance-packet-cli.test.js`, `tests/bin-lib/wrap-up/packet-post.test.js` and `tests/bin-lib/wrap-up/packet-render.test.js` import neither list; `docs/plugin-structure.md` and `docs/skill-graph.md` name the module but list no kinds. No prose states a kind count (`git grep -n -i -E "(nine|9|ten) (fact )?kinds|fact kinds" -- plugin docs tests` hits only the doc's list and its pin).

- [ ] **Step 1: Write the failing test**

`tests/bin-lib/wrap-up/packet-validate.test.js`, `assertOnly`'s bucket list gains `'planned'`, and appended:

```js
const PROOF_PLANNED = fact('proof:auth', 'not-run', { reason: 'planned in the plan, not yet run' });
test('Reading B: a claim citing a flag and only a not-run proof is planned, never kept', () => {
  const result = validate([claim('risk-proofs', 'Refuses an unauthenticated request', ['flag:auth', 'proof:auth'])], {}, [PROOF_PLANNED]);
  assertOnly(result, 'planned');
  assert.equal(result.planned[0].because.id, 'proof:auth');
});
test('Reading B: verification wording does not lift a planned proof to kept', () => {
  assertOnly(validate([claim('risk-proofs', 'Auth verified', ['flag:auth', 'proof:auth'])], {}, [PROOF_PLANNED]), 'planned');
});
test('Reading B: a skipped proof is planned, a failed one moves to tried-to-break, a passed one is kept', () => {
  assertOnly(validate([claim('risk-proofs', 'x', ['flag:auth', 'proof:auth'])], {}, [fact('proof:auth', 'skipped')]), 'planned');
  assertMoved(validate([claim('risk-proofs', 'x', ['flag:auth', 'proof:auth'])], {}, [fact('proof:auth', 'failed')]), 'tried-to-break', 'proof:auth');
  assertOnly(validate([claim('risk-proofs', 'x', ['flag:auth', 'proof:auth'])], {}, [fact('proof:auth', 'passed')]), 'kept');
});
test('Reading B: a planned proof beside a passed check is kept on the check, beside a not-run check it routes on the check', () => {
  assertOnly(validate([claim('risk-proofs', 'x', ['flag:auth', 'proof:auth', 'check:unit-tests'])], {}, [PROOF_PLANNED]), 'kept');
  assertMoved(validate([claim('risk-proofs', 'x', ['flag:auth', 'proof:auth', 'story:signup'])], {}, [PROOF_PLANNED, SIGNUP_NOT_RUN]), 'couldnt-test', 'story:signup');
});
test('Reading B: a proof outside risk-proofs is an incompatible fact', () => {
  assertDropped(validate([claim('what-changed', 'x', ['proof:auth'])], {}, [PROOF_PLANNED]), 'incompatible fact proof:auth (proof) for what-changed');
});
test('Reading B: a proof fact passes the facts shape check', () => {
  assert.equal(validateFactsShape({ schemaVersion: 1, record: 1, partial: [], facts: [PROOF_PLANNED] }).ok, true);
});
```

`tests/bin-lib/wrap-up/packet-links.test.js`: the two exact lists gain `'proof'` (line 263's `FACT_KINDS`, line 271's `risk-proofs` row).

`tests/acceptance-packet-contract-conformance.test.js`: `VALIDATION_FACTS` gains `['a planned proof is not verified (round 2, Reading B)', /only `proof` facts besides its flags[^.]*`planned, not verified`/]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/wrap-up/packet-validate.test.js`
Expected: FAIL after Step 1 with `kind: must be one of` for `proof:auth`

- [ ] **Step 3: Implement**

`packet-contract.js`: the two lists, and the `SECTION_KINDS` comment names `proof` as the planned-proof kind. `packet-validate.js`: the `planned` bucket in `validatePacket`'s result and the rule in `placeClaim`, with a comment citing the round-2 decision. `acceptance-packet.md` (23,162 B, far under the rail): `proof` in the `**Fact kinds:**` list and in the `risk-proofs` table row; one sentence in `## Validation policy`, after "A risk proof citing no proof fact is dropped.": "A risk proof citing only `proof` facts besides its flags routes on them: a failed one moves it to Tried to break, a skipped or not-run one keeps it in Risk proofs labelled `planned, not verified`, and only passed ones keep it as proved." Keep every existing `VALIDATION_FACTS` sentence byte-identical (the `A risk proof citing a failed or skipped \`check\` or \`story\` proof routes ...` pin included).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/wrap-up/packet-validate.test.js tests/bin-lib/wrap-up/packet-links.test.js tests/acceptance-packet-contract-conformance.test.js tests/bin-lib/wrap-up/packet-render.test.js tests/acceptance-packet-cli.test.js`
Expected: PASS (the last two prove no existing render or CLI test reads the new kind)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/packet-contract.js plugin/bin/lib/wrap-up/packet-validate.js plugin/skills/_shared/acceptance-packet.md tests/bin-lib/wrap-up/packet-links.test.js tests/bin-lib/wrap-up/packet-validate.test.js tests/acceptance-packet-contract-conformance.test.js
git commit -m "Add the packet proof fact kind and file planned proofs apart — refs #4618"
```

### Task 9: Render planned proofs in Risk proofs

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/packet-render.js`
- Test: `tests/bin-lib/wrap-up/packet-render.test.js`

The risk-fact producer moved to Task 13, which feeds it through the real gather (Decisions: Gather wiring). This task is the renderer half of Task 8's ruling only, kept apart because Task 8 is already at six files and the render has its own reviewable behavior and test.

**Interfaces:**
- Consumes: the `planned` bucket (Task 8).
- `packet-render.js`: `renderPacket` destructures `planned` too, and the `risk-proofs` body lists kept claims, then planned ones as `- {text} (planned, not verified: cites {id} — {status}: {reason})` through the existing `inline`, `idSpan` and `statusWithReason` helpers, droppable like any item. After them, each `flag` fact that no surviving kept or planned claim cites renders as `- {slug}: no proof shown`, so a kept flag is never hidden behind the placeholder (plan review, 2026-11-03). The placeholder `not applicable: no kept risk flags` renders only when the facts hold no `flag` fact at all.
- Round 3, Reading A: every line the `risk-proofs` body renders, kept, planned or `no proof shown`, gains the suffix ` (flag unconfirmed)` when any of its claim's refs resolves (through the body context's `factsById`) to a `flag` fact whose `unconfirmed === true`. The label is decided from the fact, never from claim text, so a narrator cannot leave it out or forge it: a claim whose own text says `(flag unconfirmed)` on a confirmed flag gets no suffix. Only the Risk-proofs section carries it; a risk-proofs claim moved to Couldn't test or Tried to break renders as today.

- [ ] **Step 1: Write the failing test**

`tests/bin-lib/wrap-up/packet-render.test.js`, appended:

```js
const PLANNED = fact('proof:auth', 'not-run', { reason: 'planned in the plan, not yet run' });
test('Reading B: a planned risk proof renders in Risk proofs as not verified, after the kept claims', () => {
  const { markdown } = render([fact('flag:auth', 'passed'), fact('check:unit', 'passed'), PLANNED], [
    claim('risk-proofs', 'Auth verified', ['flag:auth', 'proof:auth']),
    claim('risk-proofs', 'Auth covered', ['flag:auth', 'check:unit']),
  ]);
  assert.match(markdown, /### Risk proofs\n- Auth covered \([^\n]*\)\n- Auth verified \(planned, not verified: cites `proof:auth` — not run: planned in the plan, not yet run\)/);
});
test('Reading B: one planned claim and no kept one does not render the no-kept-flags placeholder', () => {
  const { markdown } = render([fact('flag:auth', 'passed'), PLANNED], [claim('risk-proofs', 'Auth verified', ['flag:auth', 'proof:auth'])]);
  assert.doesNotMatch(markdown, /not applicable: no kept risk flags/);
});
test('Round 3 Reading A: a Risk-proofs line citing an unconfirmed flag is labelled, kept and planned alike', () => {
  const UNCONFIRMED = fact('flag:auth', 'passed', { unconfirmed: true });
  const { markdown } = render([UNCONFIRMED, fact('check:unit', 'passed'), PLANNED], [
    claim('risk-proofs', 'Auth covered', ['flag:auth', 'check:unit']),
    claim('risk-proofs', 'Auth verified', ['flag:auth', 'proof:auth']),
  ]);
  assert.match(markdown, /### Risk proofs\n- Auth covered \([^\n]*\) \(flag unconfirmed\)\n- Auth verified \(planned, not verified: [^\n]*\) \(flag unconfirmed\)\n/);
});
test('Round 3 Reading A: a confirmed flag gets no label, and claim text cannot forge one', () => {
  const { markdown } = render([fact('flag:auth', 'passed'), fact('check:unit', 'passed')], [
    claim('risk-proofs', 'Auth covered (flag unconfirmed)', ['flag:auth', 'check:unit']),
  ]);
  const line = markdown.split('\n').find((l) => l.startsWith('- Auth covered'));
  assert.ok(line && !/\) \(flag unconfirmed\)$/.test(line), line);
});
test('a kept flag no claim cites is listed, labelled when unconfirmed, and never hidden behind the placeholder', () => {
  const { markdown } = render([fact('flag:auth', 'passed', { unconfirmed: true }), fact('flag:migrations', 'passed')], []);
  assert.match(markdown, /### Risk proofs\n- auth: no proof shown \(flag unconfirmed\)\n- migrations: no proof shown\n/);
  assert.doesNotMatch(markdown, /not applicable: no kept risk flags/);
});
test('the no-kept-flags placeholder renders only when no flag fact exists', () => {
  const { markdown } = render([fact('check:unit', 'passed')], []);
  assert.match(markdown, /### Risk proofs\n[^\n]*not applicable: no kept risk flags/);
});
```

The slug in `- {slug}: no proof shown` is the flag fact's id after its `flag:` prefix.

`fact`, `render` and `claim` are the file's own helpers (lines 9-32: `fact(id, status, extra)` takes the kind from the id; `render(facts, claims)` wraps `renderPacket`). The regex follows `packet-render.js` line 336, which writes each section as `'', '### {heading}'` and then its body lines with no blank line between; `idSpan` renders the id as a code span and `statusWithReason` writes `not-run` as `not run`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/wrap-up/packet-render.test.js`
Expected: FAIL after Step 1 with the Risk proofs regex unmatched

- [ ] **Step 3: Implement**

`packet-render.js`: the `planned` destructure, a `plannedLine` beside `movedLine`, the `risk-proofs` body with its uncited-flag lines and flag-fact-based placeholder test, and the ` (flag unconfirmed)` suffix decided from `factsById`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/wrap-up/packet-render.test.js tests/bin-lib/wrap-up/packet-validate.test.js tests/acceptance-packet-contract-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/packet-render.js tests/bin-lib/wrap-up/packet-render.test.js
git commit -m "Render planned risk proofs as not verified and label unconfirmed flags — refs #4618"
```

### Task 10: `/specify` prose

**Role:** judgment

**Files:**
- Modify: `plugin/skills/specify/shaping-mode.md`
- Modify: `plugin/skills/specify/shaping-mode-stamping.md`
- Modify: `plugin/skills/specify/record-creation-subissues.md`
- Modify: `plugin/skills/specify/spec-template.md`
- Test: `tests/risk-flags-prose-conformance.test.js`

`tests/specify-shaping-noop-check.test.js` pins `shaping-mode.md`'s born-ready paragraph (from "Absorb the record's existing content" to `**Feedback-filing deliverable check.**`): it must still contain the `compose-record.js --check "$SPECIFY_SHAPED_BODY"` call and `Exit 0`, and match `/Any non-zero exit[^.]*\.[^.]*never report it \`already shaped, no-op\`/`. The Reading B sentences go after that paragraph's last sentence, so the test needs no edit; Step 4 runs it. `shaping-mode-readback.md` needs no edit: its `already shaped, no-op` row definition is the comma-list batch's, where the step never runs on an exit-0 record, and a single-record flag write is a landed write, which that file already handles.

**Interfaces:**
- Consumes: the CLI verbs from Task 4, the removal text from Global Constraints.
- The canonical procedure lives once, as a `### Risk flags` section of `shaping-mode-stamping.md`, placed after `### Metadata block` and before `### Stamp scoring and stage labels`. `record-creation-subissues.md` cites it, stating only its per-unit deltas. Content of the section, in order:
  1. Classify: write the composed body to the session-tmp body file; run `risk-flags.js classify --body-file`, with `--prior-body-file` when shaping an existing record. Add flags from your own reading of Deliverables, Acceptance Criteria and Key Files against the categories in `classify`'s `known` list; you may add, never drop. Evidence you quote is the CLI's neutralized `evidence`, wrapped per `_shared/untrusted-record-content.md`; your own added evidence is run through the same rule.
  2. Human reachable: define headless verbatim from Global Constraints, plus bare drain's entry path. In `auto` no new stop is added (`_shared/auto-mode-contract.md`): headless takes step 4.
  3. Interactive: render one batch table (flag, evidence), then one `AskUserQuestion` for the batch: `multiSelect: true`, one option per flag, selected means remove, none selected means keep all; more than four flags takes the "Other" free-text answer naming the ones to remove. The batch covers every flag in `settle`'s kept set (round 4): the floor's matches, your own additions, and every flag already on the record, confirmed or not. Take that set from a second `classify` run with your additions as `--add`, reading its `kept` field. When its `entry.status` is `unknown`, ask nothing: tell the human the line is unreadable and must be repaired first, and run step 4's headless `settle` instead. Write the answers file; run `settle --answers-file`, passing your own additions as `--add` and adding `--prior-body-file` (the record's current body) when shaping an existing record and `--run "$PIPELINE_RUN_DIR"` when a run dir resolved. An `AskUserQuestion` that errors, times out or is auto-answered takes step 4. When `settle` returns a non-null `refused` (Reading A), tell the human that nothing was removed or confirmed: the record's flag line was unreadable (`refused.reason`), so every flag stays kept and unconfirmed, and the line must be repaired first. For `malformed`, `settle` has already rewritten it as the widened set, so re-running `/claude-tweaks:specify #{n}` asks again. For `unknown-slug`, the slug must become known (`risk-categories`, with control mode on) or the record's line corrected by hand on the record, before a re-run. Never log a removal for a `refused` run.
  4. Headless: run `settle --headless` with the same prior-body and `--add` arguments.
  5. Removal logging: with `logged: true`, done. With no run dir or `logged: false`, post a record comment per each `removed` slug with exactly `Risk flag {slug} removed by the maintainer during shaping` (through `_shared/github-write-transport.md`; under `local-files`, append it to the body's `## Gotchas`), after the create in decomposition mode, when the number exists.
  6. All body rewrites of these lines go through `bin/risk-flags.js` (`addRiskFlags`, `removeRiskFlag` in `record.js`); never hand-edit the line. Existing backlog records are classified only when next shaped. A logged removal does not persist (round 4, Reading A): a flag the floor detects again on a later shaping is re-added, unconfirmed when headless, and asked about again at the next interactive touch. An explicit single-record `/claude-tweaks:specify #{n}` (a lone `#N`, a range with equal bounds, or `#N --chained`) runs this section even when `compose-record.js --check` exited 0, so the flag lines alone can turn an `already shaped, no-op` into a body write; a comma-list or range element and a bare-drain shape never run it on an exit-0 record (AC6).
- `shaping-mode.md`'s born-ready paragraph (line 75) gains, after its last sentence, the Reading B rule: on exit 0, an explicit single-record invocation (the three forms above) still runs `shaping-mode-stamping.md`'s `### Risk flags` on the fetched body; when `settle` changes it, the record is written through Compose-then-write-once and reports `shaped`; when the body comes back byte-identical, it stays `already shaped, no-op`. On a comma list, a range with `A < B`, and bare drain (`--budget`, the deprecated `next` alias, `/claude-tweaks:sweep`'s `--source sweep`), an exit-0 record moves on untouched, as today.
- On a comma-list or range batch, the records the batch actually shapes take one batch table and one `AskUserQuestion` for every record's flags together (`shaping-mode.md`'s "interactive decisions raised per record collapse into one batch table + one `AskUserQuestion`"), answers held per record and `settle` run in the per-record loop.
- Compose-then-write-once's assembly shows `Risk-flags: {value}` and the optional `Risk-flags-unconfirmed: true` in the metadata block, and the `compose-record.js --check` runs after settle so the checked file is the settled one.
- `record-creation-subissues.md`: a `**Risk flags**` paragraph right after `**Premise verification**` and before `**Ceremony**`. Decomposition's one question is asked in a pre-pass over every unit's composed body before the first create, so the batch gets one `AskUserQuestion`; answers are held per unit and `settle` runs inside the loop. Origin-set carve-out passes `--prior-body-file`.
- `spec-template.md`: the metadata block gains `Risk-flags: {comma-separated slugs, or none — written by /specify's Risk flags step}` and `Risk-flags-unconfirmed: {true — headless-kept flags awaiting a human; omitted otherwise}`, with one paragraph naming grammar, the unknown-reads-all-four rule, `Proof(<slug>)`, "never hand-edit", and that a removal does not persist (a re-detected flag is re-added and asked again, round 4). The `risk:*` axis is named as a different axis.
- [ ] **Step 1: Write the failing test**

Create `tests/risk-flags-prose-conformance.test.js` with one assertion function per concern, each paired with a go-red negative that runs the same function against mutated text:

```js
test('AC2.1: the interactive path shows flags in one batch question and settles a remove through the CLI', () => assertShaping(read(SHAPING)));
test('AC3.1: the headless path keeps every detected flag with no AskUserQuestion, and the error path joins it', () => assertHeadless(read(SHAPING)));
test('AC1.1: the flag line reaches the created record: settle runs before the write and before --check', () => assertOrder(read(SHAPING)));
test('AC1.1: decomposition settles per unit before the create call', () => assertDecomposition(read(SUBISSUES)));
test('Reading A: a refused settle tells the human the line must be repaired first and logs nothing', () => assertRefusedShaping(read(SHAPING)));
test('Reading B: an explicit single-record /specify #N runs the Risk flags step on an already-shaped record', () => assertSingleRecordNoop(read(SHAPING_MODE)));
test('AC6.1 AC6.2: every batch path leaves an already-shaped record untouched', () => assertBatchExclusion(read(SHAPING_MODE), read(SHAPING)));
test('AC6.1 AC6.2: no batch path classifies: classify and settle appear only under specify/', () => assertNoBatchClassify(walkSkills()));
test('the template documents both lines and the writer rule', () => assertTemplate(read(TEMPLATE)));
```

`assertShaping` pins `risk-flags.js settle`, `--answers-file`, `--prior-body-file`, `--add`, `multiSelect`, `confirmed or not` (round 4: the batch covers every kept flag), and the removal text literal. `assertTemplate` also pins `does not persist` in `spec-template.md` and in the Risk flags section (round 4, Reading A). `assertHeadless` pins `settle --headless`, `errors, times out or is auto-answered`. `assertOrder` compares offsets: the `### Risk flags` heading precedes `### Stamp scoring`, and the assembly lists `Risk-flags:` above `## Current State`. `assertRefusedShaping` pins `refused`, `must be repaired first` and `Never log a removal for a \`refused\` run`. `assertSingleRecordNoop` reads `shaping-mode.md`'s born-ready paragraph (the slice `tests/specify-shaping-noop-check.test.js` takes) and pins `explicit single-record`, `#N --chained`, `### Risk flags` and `stays \`already shaped, no-op\``, each after the existing `never report it \`already shaped, no-op\`` sentence (offset order, so the rule cannot land ahead of the no-op test it qualifies). `assertBatchExclusion` pins, in that paragraph and in the Risk flags section's item 6, each batch path by its literal: `comma list` (or `comma-list`), `range`, `bare drain`, `--budget`, `next`, `--source sweep`; its go-red deletes the bare-drain clause and expects the throw. `assertNoBatchClassify` walks `plugin/skills/**/*.md` through `readText` and asserts `risk-flags.js classify` and `risk-flags.js settle` occur only under `plugin/skills/specify/`; its go-red plants the literal in a refine-mode copy.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/risk-flags-prose-conformance.test.js`
Expected: FAIL after Step 1 with an assertion naming the absent literal

- [ ] **Step 3: Write the prose**

Follow `docs/skill-authoring.md`. Reference `/claude-tweaks:specify` fully qualified in instruction text. Use `${CLAUDE_PLUGIN_ROOT}` in command lines. Keep to the rail.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/risk-flags-prose-conformance.test.js tests/specify-shaping-noop-check.test.js tests/batch-ref-argument.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/skill-conventions.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/shaping-mode.md plugin/skills/specify/shaping-mode-stamping.md plugin/skills/specify/record-creation-subissues.md plugin/skills/specify/spec-template.md tests/risk-flags-prose-conformance.test.js
git commit -m "Wire risk-flag classification into specify — refs #4618"
```

### Task 11: `/backlog refine` and the shared record and policy docs

**Role:** judgment

**Files:**
- Modify: `plugin/skills/backlog/refine-mode.md`
- Modify: `plugin/skills/_shared/work-record.md`
- Modify: `plugin/skills/_shared/policy-schema.md`
- Test: `tests/risk-flags-refine-prose.test.js`

**Interfaces:**
- Consumes: the `confirm` verb and its `refused` envelope from Task 4, the removal text from Global Constraints. Cites Task 10's `### Risk flags` section by name for the batch-question shape and the logging rule; it does not need Task 10 to have landed for its own test.
- `refine-mode.md`: new `## Step 3.7: Unconfirmed risk flags` between Step 3.6 (line 302) and Step 4 (line 323), human-present mode only (`refine-headless.md` is never touched and this step never runs under it). Population (plan review, 2026-11-03, decided by the user: Reading A): every open record in Step 1's `allRows` snapshot, under both drivers and whatever its lane, `blocked` and `inProgress` included, whose body `risk-flags.js classify --body-file` reports with `entry.unconfirmed: true`. Only bodies containing the literal `Risk-flags-unconfirmed:` are passed to `classify` (a cheap text pre-filter that only narrows; `classify`'s `entry` decides). One batch table and one `AskUserQuestion`, same shape as `shaping-mode-stamping.md`'s Risk flags step 3. Write through `risk-flags.js confirm` on a freshly re-read body: under `github-issues`, `gh issue view {n} --json body` then `gh issue edit {n} --body-file`; under `local-files`, `readRecord` then `writeRecord` on the record's file with its `facets` unchanged. A re-read failure skips that record's write, per Step 5's fail-closed Pre-write reverify. Log removals as the Risk flags section's step 5 states. Records with no flag line are never touched: this step runs no classifier. Step 1's snapshot already carries `body` (line 38, unmoved by the 2026-11-03 merge); Step 5's Body pre-write reverify rule applies to this write, a mismatch skipping it. When `confirm` returns a non-null `refused` (Reading A), the record's row says nothing was removed or confirmed because its flag line is unreadable, every flag stays kept and unconfirmed, and the line must be repaired first: run `/claude-tweaks:specify #{n}` (which rewrites a malformed line as the widened set) or, for an unknown slug, add it to `risk-categories` with control mode on, then re-run refine. Nothing is logged for that record.
- `_shared/work-record.md`: a short subsection on the two lines, naming `parseRiskFlags` as the one reader and `bin/risk-flags.js` as the one writer path; `local-files` carries them in the body, never in `facets`.
- `_shared/policy-schema.md`: the `risk-categories` (line 239) and `risk-path-globs` (line 240) rows' consumer cell changes from `none yet (#4608)` to `` `risk-flags.js` `` plus `` `plan-audit.js` `` for `risk-categories`. 217 B of headroom after the 2026-11-03 merge: keep the net growth under 100 B.

- [ ] **Step 1: Write the failing test**

Create `tests/risk-flags-refine-prose.test.js`, one assertion function per file, each with a go-red negative that runs the same function against mutated text:

```js
test('refine surfaces unconfirmed flags through confirm, human-present only', () => assertRefine(read(REFINE), read(REFINE_HEADLESS)));
test('Reading A: a refused confirm tells the human the line must be repaired first and logs nothing', () => assertRefusedRefine(read(REFINE)));
test('AC6.1: refine runs no classifier, so a record with no flag line is never touched', () => assertNoClassifier(read(REFINE)));
test('the record contract names the one reader and the one writer path', () => assertWorkRecord(read(WORK_RECORD)));
test('the two risk policy keys name their consumers', () => assertPolicyRows(read(POLICY_SCHEMA)));
```

`assertRefine` pins `risk-flags.js confirm` and `Step 3.7`, its offset between `## Step 3.6` and `## Step 4`, `allRows`, `local-files`, `writeRecord` and `entry.unconfirmed` inside Step 3.7 (Reading A: every open record, both drivers), and that `refine-headless.md` has no `risk-flags.js`; its go-red replaces `allRows` with `fresh lane` and expects the throw. `assertRefusedRefine` pins `refused` and `must be repaired first`. `assertNoClassifier` asserts `refine-mode.md` has no `risk-flags.js classify` and no `risk-flags.js settle`. `assertWorkRecord` pins `parseRiskFlags`, `bin/risk-flags.js` and `never in \`facets\``. `assertPolicyRows` reads the two rows and asserts neither cell says `none yet (#4608)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/risk-flags-refine-prose.test.js`
Expected: FAIL after Step 1 with an assertion naming the absent literal

- [ ] **Step 3: Write the prose**

Follow `docs/skill-authoring.md`. Reference `/claude-tweaks:backlog` and `/claude-tweaks:specify` fully qualified in instruction text. Use `${CLAUDE_PLUGIN_ROOT}` in command lines. Keep to the rail.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/risk-flags-refine-prose.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/skill-conventions.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/backlog/refine-mode.md plugin/skills/_shared/work-record.md plugin/skills/_shared/policy-schema.md tests/risk-flags-refine-prose.test.js
git commit -m "Surface unconfirmed risk flags in backlog refine — refs #4618"
```

### Task 12: Widen the packet gather and snapshot for risk facts

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/acceptance-packet.js`
- Modify: `plugin/bin/lib/wrap-up/packet-gather.js`
- Modify: `plugin/skills/_shared/acceptance-packet.md`
- Modify: `docs/plugin-structure.md`
- Test: `tests/bin-lib/wrap-up/packet-gather.test.js`
- Test: `tests/acceptance-packet-cli.test.js`

**Interfaces:**
- Consumes: the `proof` kind (Task 8), so a gathered proof fact passes `validateFactsShape`.
- `gatherPacketFacts` gains an optional `proofs` input beside `flags`. `passThroughFacts(kind, source, entries, { status = 'passed', reason } = {})`:
  - `flag` entries copy `unconfirmed: true` onto the fact only when the entry's `unconfirmed === true`. With `false` or no field, the fact is exactly today's `{ id, kind, status: 'passed', source: 'flags', text?, url? }`.
  - `proof` entries become `{ id: 'proof:{key}', kind: 'proof', status: 'not-run', reason: 'planned in the plan, not yet run', source: 'proofs', text? }`. `status` and `reason` come from the call, never from the entry, so an entry's own `status`, `kind` or `source` is ignored, as for every pass-through.
- `acceptance-packet.js`:
  - `gather` gains `--proofs <file>`, read through `optionalJson('--proofs', isEntryList)`.
  - `--flags` is read through `isFlagEntryList`: `isEntryList` plus `unconfirmed` absent or boolean. A mis-shaped list is the existing `--flags input not read — treated as absent` partial.
  - `snapshot` gains `--plan <file>`. Its text is read through `deps.readFile` (any text, not JSON) and written to `packet-inputs/plan.md` with `deps.writeAtomic`. The manifest gains `files.plan`: `copied`, `absent` (`ENOENT`/`ENOTDIR`) or `unreadable`, and only when `--plan` is given, so today's manifest is unchanged without it. Both skip paths (nothing ahead of the base; an earlier snapshot from the main checkout) keep the earlier copy, as they keep the reports.
  - `USAGE`: `snapshot --run <dir> --base <ref> [--plan <file>]`, and `[--proofs <file>]` after `[--flags <file>]`. `SUBCOMMANDS.snapshot.optional` gains `--plan`, and `gather.optional` gains `--proofs`.
- Sites that pin `--flags`, `USAGE` or `passThroughFacts`, from `git grep -n -e "--flags" -e "passThroughFacts" -e "isEntryList" -e "inputs.flags" -- plugin tests docs` plus `git grep -n -e "acceptance-packet.js " -- docs plugin/skills tests`, classified:
  - `plugin/bin/acceptance-packet.js` lines 68, 83, 454-457 and 514: changed here.
  - `plugin/bin/lib/wrap-up/packet-gather.js` lines 451-461 and 512: changed here.
  - `tests/bin-lib/wrap-up/packet-gather.test.js`: lines 924-934 (pass-through shape) and 936-939 (no self-set status) stay as they are and prove old callers unchanged. Lines 968-990 ("every gathered fact carries a source") gain a `proofs` entry: line 986's exact kind list gains `'proof'`, and line 989's "every non-check/story fact is `passed`" filter also excludes `proof`, which is `not-run` by design (changed here).
  - `tests/acceptance-packet-cli.test.js`: lines 384-411 (`--flags` reaches the facts) stay; line 413's per-input partial-note loop gains `--proofs`; lines 588 and 713 deep-equal the manifest's `files` and stay green, since no `--plan` is passed; lines 107-126 (`--help`) stay green (changed here: new tests appended).
  - `plugin/skills/_shared/acceptance-packet.md`: the `## Pipeline` snapshot paragraph (lines 197-202) and the facts section (line 90) (changed here).
  - `docs/plugin-structure.md` line 186, the `acceptance-packet.js` command line naming `snapshot --run --base` and `gather` (changed here).
  - `plugin/skills/wrap-up/verification-brief.md` lines 369, 375 and 392, and `plugin/skills/wrap-up/SKILL.md` line 115: Task 14.
  - No change: `tests/acceptance-packet-contract-conformance.test.js` lists the subcommands and partial notes, and `--proofs input not read — treated as absent` is the existing `{flag} input not read — treated as absent` template, so Step 4 only runs it. `tests/acceptance-packet-wrap-up-conformance.test.js` pins the prose (Task 14). The `acceptance-packet.js --help` strings in `tests/bin-lib/wrap-up/packet-links.test.js` line 345 and `tests/bin-lib/wrap-up/packet-render.test.js` lines 397-403 are fixture text, not the `USAGE` pin.

- [ ] **Step 1: Write the failing test**

`tests/bin-lib/wrap-up/packet-gather.test.js`, appended:

```js
test('a flag entry keeps unconfirmed only when true, so old callers are unchanged', () => {
  const result = gather({ flags: [{ id: 'auth', unconfirmed: true }, { id: 'pii', unconfirmed: false }, { id: 'migrations' }] });
  assert.deepEqual(factOf(result, 'flag:auth'), { id: 'flag:auth', kind: 'flag', status: 'passed', source: 'flags', unconfirmed: true });
  assert.deepEqual(factOf(result, 'flag:pii'), { id: 'flag:pii', kind: 'flag', status: 'passed', source: 'flags' });
  assert.deepEqual(factOf(result, 'flag:migrations'), { id: 'flag:migrations', kind: 'flag', status: 'passed', source: 'flags' });
  assertShapeOk(result);
});
test('a proof entry is a not-run proof fact, whatever status, kind or source it claims', () => {
  const result = gather({ proofs: [{ id: 'auth', text: 'Refuses an unauthenticated request', status: 'passed', kind: 'check', source: 'forged' }] });
  assert.deepEqual(factOf(result, 'proof:auth'), { id: 'proof:auth', kind: 'proof', status: 'not-run', reason: 'planned in the plan, not yet run', source: 'proofs', text: 'Refuses an unauthenticated request' });
  assertShapeOk(result);
});
```

and in the "every gathered fact carries a source" test: `proofs: [{ id: 'p', text: 't' }]` in the fixture, `'proof'` in line 986's sorted list, and line 989's filter `!['check', 'story', 'proof'].includes(x.kind)`, plus `assert.equal(factOf(result, 'proof:p').status, 'not-run')`.

`tests/acceptance-packet-cli.test.js`, appended: `--flags` with `[{ id: 'f1', unconfirmed: true }]` gives `flag:f1` with `unconfirmed: true`; `[{ id: 'f1', unconfirmed: 'yes' }]` gives the `--flags input not read — treated as absent` partial; `--proofs` with `[{ id: 'auth', text: 't' }]` gives a `not-run` `proof:auth`; line 413's loop also covers `--proofs`. Snapshot: `snapshot --run --base --plan {file}` writes `packet-inputs/plan.md` byte-identical to the file and `files.plan: 'copied'`; a missing plan gives `files.plan: 'absent'` and no `plan.md`; a directory as `--plan` gives `'unreadable'`; `--plan` with no value exits 2; a re-run from the main checkout that finds an earlier manifest keeps the earlier `plan.md`. `--help` names `--proofs` and `--plan`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/wrap-up/packet-gather.test.js`
Expected: FAIL after Step 1 with `flag:auth` missing `unconfirmed`

- [ ] **Step 3: Implement**

`packet-gather.js`: the `passThroughFacts` options and the `proofs` input. `acceptance-packet.js`: `isFlagEntryList`, `--proofs`, `snapshot --plan`, `USAGE`, `SUBCOMMANDS`, and a header line naming `plan.md` among the snapshot copies. Snapshot reads every source through `deps`, so the path-guard rule holds: no bare `fs.existsSync`. `_shared/acceptance-packet.md` (23,162 B before Task 8's sentence): line 90's fact sentence names `unconfirmed` as a `flag` field; the `## Pipeline` snapshot paragraph adds "and, given `--plan`, the run's plan, which `risk-flags.js facts` reads at Step 4 for the `--proofs` input" without changing the pinned clause "an input to gather, never a packet copy any reader consults". `docs/plugin-structure.md` line 186: `snapshot --run --base [--plan]` and the `--flags`/`--proofs` pair.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/wrap-up/packet-gather.test.js tests/acceptance-packet-cli.test.js tests/acceptance-packet-contract-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/acceptance-packet.js plugin/bin/lib/wrap-up/packet-gather.js plugin/skills/_shared/acceptance-packet.md docs/plugin-structure.md tests/bin-lib/wrap-up/packet-gather.test.js tests/acceptance-packet-cli.test.js
git commit -m "Carry unconfirmed flags, planned proofs and the plan copy through the packet gather — refs #4618"
```

### Task 13: The `risk-flags.js facts` producer and the end-to-end packet test

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/risk-flag-facts.js`
- Modify: `plugin/bin/risk-flags.js`
- Modify: `docs/plugin-structure.md`
- Test: `tests/bin-lib/issues/risk-flag-facts.test.js`
- Test: `tests/risk-flags-cli.test.js`
- Test: `tests/risk-flags-packet-e2e.test.js`

**Interfaces:**
- Consumes: `parseRiskFlags` (Task 1), `inertEvidence` and `readRiskPolicy` (Task 3), the CLI's `run(argv, deps)` and exit contract (Task 4), `extractProofLines` and `isSubstantiveProof` (Task 5), the gather's `--flags`/`--proofs` inputs (Task 12).
- `riskFlagEntries(specText, planText, { extraCategories = [] } = {}) -> { status, flags: [{ id, text?, unconfirmed? }], proofs: [{ id, text }] }`:
  - `status` is `parseRiskFlags(specText, { extraCategories }).status`.
  - `flags`: one entry per parsed flag, `id` the bare slug (the gather adds `flag:` and `encodeFactKey`s it), `unconfirmed: true` only when the marker reads true, `text: 'unreadable flag line'` only when `status` is `unknown`.
  - `proofs`: per flag, the first `extractProofLines(planText).proofs` entry for that slug with `isSubstantiveProof(slug, text) === null`, as `{ id: slug, text: inertEvidence(text) }`. `planText` `null` gives `[]`.
  - `unclassified` and a clean `none` give `[]` for both.
  - The module holds no `Risk-flags` line literal (Task 2's scan): it reads through `parseRiskFlags`.
- `risk-flags.js facts --spec-file <f> [--plan-file <f>] --flags-out <f> --proofs-out <f> [--repo-root <dir>]`:
  - Writes `flags` and `proofs` as two JSON arrays.
  - Prints `{ status, flags: <count>, proofs: <count>, plan: 'read' | 'absent' }`.
  - A plan file that is absent (`ENOENT`/`ENOTDIR`), or no `--plan-file`, is `plan: 'absent'` and `[]` proofs. An unreadable spec, or a plan that fails to read for any other reason, exits 1.
  - Usage errors exit 2. An output that cannot be written exits 3 (Task 4's exit 3 widens from "the body file" to "a named output file"; the header and `USAGE` say so).
  - On any non-zero exit it removes both outputs if present (the stale-output rule `acceptance-packet.js`'s `runGather` follows), so the gather states `--flags input not read — treated as absent` instead of reading a stale or empty list as "no flags".
  - Extras come from `readRiskPolicy(repoRoot)`, as `classify` does.

- [ ] **Step 1: Write the failing test**

`tests/bin-lib/issues/risk-flag-facts.test.js`:

```js
test('flag entries carry unconfirmed only when marked, proof entries their neutralized text', () => {
  const r = riskFlagEntries('Risk-flags: auth, migrations\nRisk-flags-unconfirmed: true\n\n## O\n', '### Task 1: x\n\nProof(auth): An unauthenticated request [still](x) returns 401.\n');
  assert.deepStrictEqual(r.flags, [{ id: 'migrations', unconfirmed: true }, { id: 'auth', unconfirmed: true }]);
  assert.deepStrictEqual(r.proofs.map((p) => p.id), ['auth']);
  assert.match(r.proofs[0].text, /\\\[still\\\]/);
});
test('an unclassified or clean record produces no entries', () => {
  assert.deepStrictEqual(riskFlagEntries('Surface: x\n', ''), { status: 'unclassified', flags: [], proofs: [] });
  assert.deepStrictEqual(riskFlagEntries('Risk-flags: none\n', ''), { status: 'ok', flags: [], proofs: [] });
});
test('an unknown line produces an entry per widened flag, each saying the line is unreadable', () => {
  const r = riskFlagEntries('Risk-flags: Bad\n', null);
  assert.strictEqual(r.flags.length, 4);
  assert.ok(r.flags.every((f) => f.text === 'unreadable flag line'));
});
test('a too-short proof, a fenced proof and no plan give no proof entry', () => {
  assert.deepStrictEqual(riskFlagEntries('Risk-flags: auth\n', '### Task 1: x\n\nProof(auth): short\n').proofs, []);
  assert.deepStrictEqual(riskFlagEntries('Risk-flags: auth\n', '### Task 1: x\n\n```\nProof(auth): An unauthenticated request still returns 401.\n```\n').proofs, []);
  assert.deepStrictEqual(riskFlagEntries('Risk-flags: auth\n', null).proofs, []);
});
```

`tests/risk-flags-cli.test.js`, appended: `facts` writes both files and prints the counts; no `--plan-file` and a missing plan are both `plan: 'absent'` with `[]` proofs, exit 0; an unreadable spec exits 1 and leaves neither output (an earlier output planted first is removed); a missing `--flags-out` or `--proofs-out` exits 2; an unwritable output exits 3.

`tests/risk-flags-packet-e2e.test.js`, real subprocesses of both bins (`execFileSync(process.execPath, [bin, ...], { cwd: dir, windowsHide: true })`) in an `fs.mkdtempSync` directory, with no `--run`:

```js
test('end to end: unconfirmed and a planned proof survive the producer files, the real gather, the validator and the renderer', () => {
  const spec = writeText(dir, 'spec.md', 'Surface: infra\nRisk-flags: auth\nRisk-flags-unconfirmed: true\n\n## Acceptance Criteria\n\n1. x\n');
  const plan = writeText(dir, 'plan.md', '### Task 1: x\n\n- [ ] **Step 1: y**\n\nProof(auth): An unauthenticated request to the route still returns 401.\n');
  riskFlags(['facts', '--spec-file', spec, '--plan-file', plan, '--flags-out', FLAGS, '--proofs-out', PROOFS, '--repo-root', dir]);
  packet(['gather', '--record', '4618', '--out', FACTS, '--spec', spec, '--flags', FLAGS, '--proofs', PROOFS]);
  const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));
  assert.deepStrictEqual(facts.facts.find((f) => f.id === 'flag:auth'), { id: 'flag:auth', kind: 'flag', status: 'passed', source: 'flags', unconfirmed: true });
  const proof = facts.facts.find((f) => f.id === 'proof:auth');
  assert.deepStrictEqual([proof.kind, proof.status, proof.reason, proof.source], ['proof', 'not-run', 'planned in the plan, not yet run', 'proofs']);
  assert.deepStrictEqual(validateFactsShape(facts).errors, []);
  const narrative = { schemaVersion: 1, claims: [{ section: 'risk-proofs', text: 'Auth verified', refs: ['flag:auth', 'proof:auth'] }] };
  const result = validatePacket(facts, narrative);
  assert.deepStrictEqual([result.kept.length, result.planned.length], [0, 1]);
  assert.match(renderPacket(facts, narrative).markdown, /### Risk proofs\n- Auth verified \(planned, not verified: cites `proof:auth` — not run: planned in the plan, not yet run\) \(flag unconfirmed\)/);
});
test('end to end: a failed producer makes the gather state the lost input, never an empty flag list', () => {
  // facts on an unreadable spec exits 1 and leaves no FLAGS file; gather with --flags FLAGS then lists `--flags input not read — treated as absent` in partial.
});
```

`riskFlags` and `packet` assert exit 0 and return stdout. The gather runs outside a git checkout here, so its `partial` may hold `git changes not gathered`; the test does not assert `partial` except in the second case. The implementer finishes the second body.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/risk-flag-facts.test.js`
Expected: FAIL with `Cannot find module`

- [ ] **Step 3: Implement**

`risk-flag-facts.js` and the `facts` verb in `risk-flags.js` (parsing through the existing `parseArgs` value-flag rule, every read and write through `deps`). `docs/plugin-structure.md`: the `risk-flags.js` command line gains `facts`, and the `plugin/bin/lib/issues/` clause names `risk-flag-facts.js` as the producer of the gather's `--flags` and `--proofs` inputs.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/risk-flag-facts.test.js tests/risk-flags-cli.test.js tests/risk-flags-packet-e2e.test.js tests/risk-flags-writer-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/risk-flag-facts.js plugin/bin/risk-flags.js docs/plugin-structure.md tests/bin-lib/issues/risk-flag-facts.test.js tests/risk-flags-cli.test.js tests/risk-flags-packet-e2e.test.js
git commit -m "Add the risk-flags facts producer and prove it end to end — refs #4618"
```

### Task 14: Wire the risk facts into wrap-up

**Role:** judgment

**Files:**
- Modify: `plugin/skills/wrap-up/SKILL.md`
- Modify: `plugin/skills/wrap-up/verification-brief.md`
- Test: `tests/acceptance-packet-wrap-up-conformance.test.js`

**Interfaces:**
- Consumes: `snapshot --plan` and the gather's `--flags`/`--proofs` (Task 12), `risk-flags.js facts` (Task 13).
- Step position, from the files: Phase 1's **Snapshot the packet inputs** (`wrap-up/SKILL.md` line 112) runs before every cleanup item, from the run's own checkout (the worktree under `pr-first`, before the merge), with `work/{N}-spec.md` and the plan present. `verification-brief.md` Step 4 runs after cleanup. On the "Approve all + merge" path the worktree and branch are already gone and the run dir is archived, so its cwd is the main checkout on the integration branch (lines 290-296). The plan therefore crosses through the snapshot. The spec does not need to, because Step 4's `--spec` chain (line 381) ends at the record body, which carries the flag lines.
- `wrap-up/SKILL.md` Phase 1 (9,430 B under the rail): before the snapshot fence, resolve `{plan-file}` with `git diff --name-only --diff-filter=AM "origin/{integration-branch}...HEAD" -- docs/superpowers/plans/` as its own call. Exactly one path is `{plan-file}`. Two or more (a multi-spec branch) narrow to the one whose text names `{N}-spec.md`. None, or still not one: omit `--plan` and log one `SKIP` line through `log-decision.js` (`--text-file`). The fence appends ` --plan "{plan-file}"` after `--base "origin/{integration-branch}"`, so the pinned call (`tests/acceptance-packet-wrap-up-conformance.test.js` line 178) still matches by `includes`. `{plan-file}` is a path: none of `"`, backtick, `$`, `\` or a line break.
- `verification-brief.md` Step 4 (10,004 B under the rail):
  - The session-temp resolve (line 369) appends `FLAGS=packet-flags-{N}.json PROOFS=packet-proofs-{N}.json` after `SPEC=packet-spec-{N}.md`, so the test at line 135 still matches by `includes`.
  - A **Risk facts** paragraph and fence go just before the **Gather** paragraph (line 372), as its own Bash call: `node "${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" facts --spec-file "{spec}" --plan-file "{run-dir}/packet-inputs/plan.md" --flags-out "{FLAGS}" --proofs-out "{PROOFS}"`. `{spec}` is the same value the gather gets. `--plan-file` is passed only when `{run-dir}/packet-inputs/manifest.json`'s `files.plan` is `copied`. When the envelope says `plan: 'absent'` and `flags` is non-zero, the summary says the risk proofs were not read because no plan copy exists. A non-zero exit is reported and logged and does not stop the packet: the gather below still passes `--flags`/`--proofs`, and the missing files become its stated partial.
  - The gather fence (line 375) appends `--flags "{FLAGS}" --proofs "{PROOFS}"`. These are uppercase session-temp placeholders, which the lowercase-placeholder grammar check at test line 491 does not govern, matching `{FACTS}` and `{RECORDINGS}`. The input list gains `- \`--flags\` and \`--proofs\` — \`{FLAGS}\` and \`{PROOFS}\` from the Risk facts call above, always`.
  - Line 392's last sentence becomes: "`--dev-base-url`, `--deploy` and `--decision-items` are filled by the dev-target and control-mode records, and none is passed here; `--flags` and `--proofs` come from the Risk facts call above." The `--flags` part is the only change to it.

- [ ] **Step 1: Write the failing test**

`tests/acceptance-packet-wrap-up-conformance.test.js`, appended (each test's assertion function also run against a copy with its literal removed, expecting the throw):

```js
test('Phase 1 snapshots the run plan for the risk proofs', () => {
  const phase1 = section(read('wrap-up/SKILL.md'), '## Phase 1: ESTABLISH — what happened here?', '## Phase 2: ROUTE — where does each learning belong?');
  assert.ok(phase1.includes('snapshot --run "{run-dir}" --base "origin/{integration-branch}" --plan "{plan-file}"'));
  assert.ok(phase1.includes('--diff-filter=AM'));
  assert.ok(phase1.indexOf('--diff-filter=AM') < phase1.indexOf('acceptance-packet.js" snapshot'), 'the plan resolves before the snapshot');
});
test('Step 4 runs the risk facts producer before the gather and passes both files', () => {
  const body = step4();
  const facts = body.indexOf('risk-flags.js" facts --spec-file "{spec}"');
  assert.ok(facts !== -1 && facts < body.indexOf('acceptance-packet.js" gather'), 'producer before gather');
  const fence = between(body, 'acceptance-packet.js" gather', '\n```');
  assert.ok(fence.includes('--flags "{FLAGS}" --proofs "{PROOFS}"'), fence);
  assert.ok(body.includes('packet-inputs/plan.md'), 'the plan comes from the snapshot copy');
});
test('line 392 no longer says the risk-flag inputs go unpassed', () => {
  const sentence = flat(between(step4(), 'Pass no `--scope`', 'Gather non-zero'));
  assert.ok(!/`--flags`[^.]*passes none of them/.test(sentence), sentence);
  assert.ok(sentence.includes('`--flags` and `--proofs` come from the Risk facts call above'), sentence);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/acceptance-packet-wrap-up-conformance.test.js`
Expected: FAIL after Step 1 with the `--plan "{plan-file}"` snapshot call absent

- [ ] **Step 3: Write the prose**

Follow `docs/skill-authoring.md`. Use `${CLAUDE_PLUGIN_ROOT}` in command lines. Keep every literal the existing suite pins (lines 126-185, 268-360, 475-497 of the test file) byte-identical. Measure both files with `wc -c` after the edit and keep each under 52,500 B.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/acceptance-packet-wrap-up-conformance.test.js tests/acceptance-packet-contract-conformance.test.js tests/log-decision-text-file-sites-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/skill-conventions.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/SKILL.md plugin/skills/wrap-up/verification-brief.md tests/acceptance-packet-wrap-up-conformance.test.js
git commit -m "Feed risk flags and planned proofs into the acceptance packet at wrap-up — refs #4618"
```
