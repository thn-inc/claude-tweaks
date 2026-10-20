# Capable Plan Review Before Task 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/build` Common Step 1.6 — one Capable reviewer reads the materialized spec and the plan once, before Task 1, and its spec-gap / undecided-behaviour / cross-task-contract findings amend the in-run spec or the plan, or stop the build at a new HARD-GATE when a human must decide.

**Architecture:** Markdown-only change to skill prose, plus `node --test` conformance suites that pin it. A short pointer step in `plugin/skills/build/SKILL.md` carries the skip gate; the full procedure lives in a new lazy sub-file `plugin/skills/build/plan-review.md`. The new `needs-human` stop is registered in the auto-mode contract's HARD-GATE row and in every file that restates that row's gate families; dispatch's Settle procedure and report gain one paragraph each so a dispatched build's stop is settled once and relayed to the human.

**Tech Stack:** Markdown skill files; Node 18+ `node --test` (no external deps).

**Spec:** `.claude-tweaks/pipelines/2026-10-19T192956-record-3377/work/3377-spec.md` (worktree copy — record #3377)

## Global Constraints

- Every grown `plugin/skills/**/*.md` file stays at or under `RAIL_BYTES` (52,500 B, `plugin/bin/lib/skill-audit/budgets.js`); `plugin/skills/build/SKILL.md` additionally stays under 51,200 B (AC1). Measured at plan time: `build/SKILL.md` 47,644 B; `_shared/auto-mode-contract.md` 42,178 B; `_shared/auto-mode-card.md` 5,259 B; `_shared/ceremony-profile.md` 11,521 B; `dispatch/settle-and-merge.md` 46,352 B; `dispatch/reporting.md` 5,725 B; `build/handoff-template.md` well under. Headroom on `build/SKILL.md`: 3,556 B against 51,200 — the new step's text must stay under ~1,200 B.
- Skill references inside instruction text use the fully-qualified `/claude-tweaks:{skill}` form; plugin-root paths use the `"${CLAUDE_PLUGIN_ROOT}/bin/..."` placeholder (never `node bin/...` or `node plugin/bin/...` — `tests/resolve-profile-invocation-conformance.test.js`).
- No model name (`opus`, `sonnet`, `haiku`, `fable`) is written in `plan-review.md`; the model comes from `resolve-profile.js capable` and is passed as the Agent tool's `model` parameter.
- Never contradict or instruct SDD (`/superpowers:subagent-driven-development`) to change its own pre-flight scan; this step runs before SDD starts.
- The live record body is never edited (`gh issue edit` never runs against it); nothing from this step is staged for the Review Console; no new staged-item kind.
- Every `plugin/skills/**/*.md` line containing both `fast-lane` and `skip` carries `roster tag \`plan-review\`` (or another rostered tag) — `tests/ceremony-profile-roster.test.js`.
- Commit messages: `{Verb} {what} — {detail}`, ending with `refs #3377` (never `closes`/`fixes`), plus the trailer `Claude-Session: https://claude.ai/code/session_019Sezsh2cmq9imQXj8wDeTd`.
- `docs/skill-graph.md` states each new edge once; no `SKILL.md` restates it.

## Review Focus

1. The reviewer returns no parseable table, no `STATUS:` line, `BLOCKED`, or `NEEDS_CONTEXT` — the controller must never read that as "No findings." (pinned in Task 2's `plan-review.md` test).
2. A spec-gap row marked `intent-resolvable` whose Evidence quotes no spec sentence — the controller treats it as `needs-human` (burden of proof enforced controller-side too; Task 2 test).
3. Several `needs-human` findings in one review — one batched question / one record comment, not one stop per finding (Task 2 test).
4. `low` / `info` findings — logged only, amend nothing; routing keys on Class and Resolution, never Severity (Task 2 test).
5. A dispatched build whose human is at the dispatching session (no `DISPATCH_HEADLESS=1`) — the Task subagent cannot call `AskUserQuestion`, so the stop must reach the human as a relayed `BLOCKED` report, and Settle must not count it against the retry ceiling or close the PR (Task 4 test).

## Spec coverage map

| AC clause | Covering test |
|---|---|
| AC1.1 | Task 2 `tests/build-plan-review-conformance.test.js` — placement/pointer and byte tests |
| AC2.1 | Task 2 — three classes, SDD-table, template and STATUS tests |
| AC3.1 | Task 2 — `resolve-profile.js capable` + explicit `model` test |
| AC3.2 | Task 2 — no hardcoded model name test |
| AC4.1 | Task 2 — ordered amend/commit/log/comment/plan-audit test |
| AC4.2 | Task 2 — no `gh issue edit`, nothing staged test |
| AC4.3 | Task 2 — standalone Step 7 handoff test |
| AC5.1 | Task 3 `tests/plan-review-hard-gate-conformance.test.js` — contract row test |
| AC5.2 | Task 3 — consumer citation and consumer-list completeness tests |
| AC6.1 | Task 1 `tests/ceremony-profile-roster.test.js` |
| AC7.1 | Task 2 — stub skip-gate test |
| AC8.1 | Task 2 — stub carries no `/claude-tweaks:dispatch`; Task 4 — single build-section edge test |
| AC9.1 | Task 5 — full `npm test` |

---

### Task 1: Ceremony roster row for the new `plan-review` skip

**Files:**
- Modify: `plugin/skills/_shared/ceremony-profile.md`
- Test: `tests/ceremony-profile-roster.test.js`

**Interfaces:**
- Produces: roster tag `plan-review` (the Step-column value of a new `## Skips by profile` row). Task 2's prose cites it as `roster tag \`plan-review\``.

- [ ] **Step 1: Update the roster test's expected tag list**

In `tests/ceremony-profile-roster.test.js`, the first test's `assert.deepStrictEqual(skipTags, [...])` gains `'plan-review'` immediately after `'plan-audit'`; rename the test from `the roster names the nine expected skip tags…` to `the roster names the ten expected skip tags and the never-skipped floor (#1926 AC1, #3377 AC6.1)`.

- [ ] **Step 2: Run the roster test to verify it fails**

Run: `node --test tests/ceremony-profile-roster.test.js`
Expected: FAIL after Step 1 — `deepStrictEqual` reports the missing `plan-review` entry.

- [ ] **Step 3: Add the roster row**

In `plugin/skills/_shared/ceremony-profile.md`'s `## Skips by profile` table, insert one row directly after the `plan-audit` row:

`| \`plan-review\` | \`fast-lane\` | Always under the profile (also, any profile: a trivial plan — Common Step 1.5's fewer than 3 file references and no \`Scope keywords:\`; design mode never runs the step) | \`build/SKILL.md\` Common Step 1.6, \`build/plan-review.md\` | A \`ceremony-check\` verdict of \`fast-lane\` is the judgment that the record is small enough for its task reviews to see whole; \`/claude-tweaks:review\`'s Step 3 lenses still judge the diff against the spec |`

- [ ] **Step 4: Run the roster test to verify it passes**

Run: `node --test tests/ceremony-profile-roster.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/ceremony-profile.md tests/ceremony-profile-roster.test.js
git commit -m "Add plan-review to the ceremony skip roster — fast-lane and trivial plans skip the Capable plan review, refs #3377"
```

---

### Task 2: The Common Step 1.6 pointer and the `plan-review.md` procedure

**Files:**
- Create: `plugin/skills/build/plan-review.md`
- Modify: `plugin/skills/build/SKILL.md` (insert between `### Common Step 1.5: Plan Audit` and `### Common Step 1.7: Design Pre-Build (frontend specs + terminal)`)
- Modify: `docs/plugin-structure.md` (the `| build |` row's file list gains `plan-review.md`)
- Modify: `plugin/skills/build/handoff-template.md` (new standalone section)
- Test: `tests/build-plan-review-conformance.test.js`

**Interfaces:**
- Consumes: roster tag `plan-review` (Task 1).
- Produces: heading `### Common Step 1.6: Plan Review (Spec Mode only)`; file `build/plan-review.md`; gate name `plan-review-needs-human` (the `{gate}` in `failed: {gate}`, the first-call `ISSUE #{n}: failed:plan-review-needs-human` line, and the HARD-GATE marker `<!-- HARD-GATE: plan-review-needs-human -->`); the phrase `plan-review needs-human spec gap` (Tasks 3 and 4 cite it); comment markers `<!-- plan-review-amendment -->` and `<!-- plan-review-question -->`; handoff heading `### Plan review amendments (standalone build, if any)`.

- [ ] **Step 1: Write the failing conformance suite**

Create `tests/build-plan-review-conformance.test.js` (style: `tests/adopted-branch-collision-prose-conformance.test.js` — `readText` from `./helpers/read-skill`, `norm = (t) => t.replace(/\s+/g, ' ')`, live corpus). Read `RAIL_BYTES` from `../plugin/bin/lib/skill-audit/budgets.js`. Factor each pin set into a `problems(text)` function returning the list of missing anchors, so each go-red control runs the same function on doctored text (`plan-authoring-checks.md`'s Go-red control check). Tests:

- `AC1.1: Common Step 1.6 sits after 1.5 and before 1.7 and 2, names Spec Mode only, and points at plan-review.md` — index of `### Common Step 1.5: Plan Audit` < index of `### Common Step 1.6: Plan Review (Spec Mode only)` < index of `### Common Step 1.7:` < index of `### Common Step 2: Execute the Plan`; the step body (heading to next `### `) includes `plan-review.md` and `Spec Mode only`, is under 1,500 bytes (pointer only), and does not contain `/claude-tweaks:dispatch` (AC8.1: no edge restated in `SKILL.md`).
- `AC1.1: build/SKILL.md stays under 51,200 bytes and the rail` — `Buffer.byteLength` < 51,200 and ≤ `RAIL_BYTES`.
- `AC7.1: the stub skips on fast-lane and on a trivial plan with a SKIP entry, and never runs in design mode` — step body includes `roster tag \`plan-review\``, `fewer than 3 file references`, `Scope keywords:`, `SKIP`, `design mode`.
- `AC2.1: plan-review.md names the three classes and inlines the output template and STATUS line in the dispatch prompt` — extract the first fenced block after the heading `## Dispatch prompt`; it contains `spec gap`, `undecided behaviour`, `cross-task contract`, `Do not repeat SDD's pre-flight conflict table`, the header row `| Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |`, `No findings.`, `+N more`, `at most 7 rows`, and `STATUS: {DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED}`.
- `AC2.1: the brief states the class boundary against SDD's pre-flight scan with one example of each` — fenced block contains `Global Constraints` and `producer/consumer`, and two `example:` occurrences.
- `AC3.1 + AC3.2: the model comes from resolve-profile.js capable and no model name is hardcoded` — file contains `"${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable` and `model`; `/\b(opus|sonnet|haiku|fable)\b/i` does not match the file.
- `AC4.1: an intent-resolvable spec gap amends, commits, logs, comments, then re-runs plan-audit, in that order` — within the section `### Spec gap — intent-resolvable`, the first occurrences of `additive`, `git commit`, `log-decision.js`, `gh issue comment`, `plan-audit.js` appear in that order; the section also contains `never edits or loosens an existing Acceptance Criterion` and `same commit`.
- `AC4.2: no gh issue edit runs against the live record and nothing is staged` — file contains `` `gh issue edit` never runs against the live record `` and `nothing is staged for the Review Console`.
- `AC4.3: standalone /build lists the amendment in the Step 7 handoff without a decision-log write` — file contains `Step 7 handoff` and `no decision-log write`; `handoff-template.md` contains `### Plan review amendments (standalone build, if any)`.
- `Review Focus 1: an unusable reviewer reply is never read as clean` — file contains `never read as "No findings."`.
- `Review Focus 2: an intent-resolvable row with no quoted spec sentence is treated as needs-human` — file contains `treated as \`needs-human\``.
- `Review Focus 3: several needs-human findings produce one question set` — file contains `one \`AskUserQuestion\` call` and `one comment`.
- `Review Focus 4: routing keys on Class and Resolution, never Severity; low and info amend nothing` — file contains `never on Severity` and `\`low\` and \`info\` findings are logged only`.
- `the needs-human stop carries the HARD-GATE marker and the three presence branches` — file contains `<!-- HARD-GATE: plan-review-needs-human -->`, `DISPATCH_HEADLESS=1`, `dispatched: true`, `bot:blocked`, `release-claim.js`, `failed: plan-review-needs-human`, `BLOCKED`.
- `go-red: each pin set fails when one anchor is removed` — for the AC2.1, AC4.1 and Review-Focus pin sets, `problems(text.replace(anchor, 'removed'))` returns exactly that anchor.
- `plan-review.md is within the rail` — byte length ≤ `RAIL_BYTES`.

- [ ] **Step 2: Run the new suite to verify it fails**

Run: `node --test tests/build-plan-review-conformance.test.js`
Expected: FAIL — `plan-review.md` does not exist (ENOENT) and `### Common Step 1.6` is absent.

- [ ] **Step 3: Insert the Common Step 1.6 pointer in `build/SKILL.md`**

Between the end of Common Step 1.5 (after its `For the full procedure … read \`plan-audit.md\`` paragraph) and `### Common Step 1.7`, add `### Common Step 1.6: Plan Review (Spec Mode only)` with one paragraph (under 1,200 B) saying: Spec Mode only — design mode has no materialized spec, so this step never runs there; after Common Step 1.5 and before Common Step 1.7 and Task 1, dispatch one Capable reviewer over the materialized spec and the plan and route its findings; the skip gate (stated here so deciding never loads the sub-file): `config.yml`'s `ceremony-profile` is `fast-lane` — roster tag `plan-review`, `_shared/ceremony-profile.md` — or the plan is trivial by Common Step 1.5's own test (fewer than 3 file references and no `Scope keywords:`); on skip write a `SKIP` entry per `_shared/auto-decision-log.md`'s degrade-trace rule (standalone: list in the Step 7 handoff); otherwise read `plan-review.md` in this skill's directory. No mention of `/claude-tweaks:dispatch`.

- [ ] **Step 4: Write `plugin/skills/build/plan-review.md`**

Sections, in order (prose in the house style of `plan-audit.md` / `adopted-branch-collision-check.md`; every fixed literal below is pinned by Step 1):

1. `# Common Step 1.6 — Plan Review` + one-paragraph purpose: catches spec gaps, undecided behaviour and cross-task contract disagreements before any code is written (#3229's measured build: 3 of 5 Important final-review findings were spec/plan gaps fixed in an 18-minute wave). Skip condition lives in `SKILL.md`'s stub (re-read cut). Not SDD's pre-flight scan; this step never tells SDD to skip or alter its own.
2. `## Inputs` — the spec is this build's materialized `work/{n}-spec.md` **in the worktree's copy** (worktree mode; `flow/materialize.md` — never `"$PIPELINE_RUN_DIR"/work/…`, which holds no `work/` until merge, the `[IL-127]` shadow-copy hazard); the plan is the file Spec Step 3 wrote. Both passed as absolute paths.
3. `## Dispatch` — one reviewer, Capable, under the Subagent Contract (`_shared/subagent-output-contract.md`, `_shared/subagent-dispatch-core.md`): resolve with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable --run-dir "$PIPELINE_RUN_DIR"` (omit `--run-dir` when none resolves; append `--unattended` when `DISPATCH_HEADLESS=1`), pass the returned value as the Agent tool's `model` parameter explicitly and append its `effortLine` to the prompt. A fresh `general-purpose` agent, never `fork`. Stays Capable even under `profile=frontier` (Frontier is reserved for contract-enumerated singleton slots). Input is the two paths only — no conversation history.
4. `## Dispatch prompt` — one fenced block, copied verbatim into the prompt, substituting the three `{…}` paths:

```
[Use: Capable]
{effortLine}

Task: review one implementation plan against its spec, once, before any task is built. Read-only.

Read:
- Spec: {absolute path to the worktree's work/{n}-spec.md}
- Plan: {absolute path to the plan file}
You may also read any file in the repository at {absolute worktree root}, read-only, to check what the plan integrates with. Do not create, modify, or delete any file; run no test suite, build, or server; make no git or gh call that writes.

Find three classes of problem, and only these:
- spec gap — the spec does not decide something the plan must decide (a value, a rule, a precedence, what happens on failure).
- undecided behaviour — an input class, failure mode, or UI state no task covers. If covering it needs a product decision the spec does not make, report it as a spec gap instead.
- cross-task contract — one task produces something another consumes (a name, a shape, an order, a file, a flag) and the two disagree or the producer is missing, or a task disagrees with the spec about it.

Do not repeat SDD's pre-flight conflict table. That scan runs later and already checks plan-internal contradictions — a task against the plan's Global Constraints, or a step the plan mandates that the review rubric forbids (example: Global Constraints say "no new dependencies" and Task 4 adds one). Your cross-task class is producer/consumer agreement between tasks, and each task against the spec (example: Task 2 returns `{ok, value}` and Task 5 reads `.result`).

For every spec-gap row, set Resolution:
- intent-resolvable — only when you can quote a spec sentence that settles it; put that sentence in Evidence. No quotable sentence means needs-human.
- needs-human — whenever settling it would alter or loosen an existing Acceptance Criterion or an observable contract, or it has two defensible readings.
Write "—" in Resolution on every other row.

OUTPUT FORMAT (required):
Return ONLY a markdown table, no preamble:

| Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |
|---|---|---|---|---|---|---|
| high | spec gap | intent-resolvable | work/42-spec.md:31 | Retry count on a 429 is unset | Spec: "Retries follow the existing gh policy." | Add: "A 429 retries per _shared/github-rate-limit.md." |
| medium | cross-task contract | — | docs/superpowers/plans/x.md:120 | Task 2 returns `{ok, value}`; Task 5 reads `.result` | Task 2 Interfaces vs Task 5 Step 3 | Task 5 reads `.value` |

Class: spec gap / undecided behaviour / cross-task contract
Severity scale: critical / high / medium / low / info
If no findings: return literal text "No findings."
Return at most 7 rows, highest severity first; if more were found, append a final row reading "+N more" with the count in place of N — never omit this row when findings exceed the cap.
Do not add narration, headers, or summaries before or after the table.

End your reply with one line, its last non-empty line: STATUS: {DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED}
```

5. `## Reading the reply` — `NEEDS_CONTEXT`: re-dispatch once with the context it names. `BLOCKED`, no status line, or a table that does not parse (after that one re-dispatch): the review is unavailable — log `SKIP` (`condition: plan reviewer returned {word|no parseable reply} → fallback: build proceeds without a plan review`) and continue; an unusable reply is never read as "No findings.". `No findings.`: log `SCANNED` (`plan review: no findings`). Routing keys on Class and Resolution, never on Severity; `low` and `info` findings are logged only and amend nothing. A spec-gap row marked `intent-resolvable` whose Evidence quotes no spec sentence is treated as `needs-human`.
6. `## Handling by class` with three `###` subsections:
   - `### Spec gap — intent-resolvable` — in order: (a) amend the worktree's copy of `work/{n}-spec.md` with an additive clarification only, appended under a `## Plan Review Clarifications` section at the end of the file (each line quotes the supporting spec sentence) — the amendment never edits or loosens an existing Acceptance Criterion; (b) apply any plan amendment from the other two classes; (c) `git commit` the spec and plan amendments in the same commit — this is what keeps the pair consistent for `SKILL.md`'s "has the spec evolved since the plan was written?" staleness rule on a resumed build; (d) log one `AUTO` entry: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --section "/build" --step "Common Step 1.6 (plan review)" --text "amended {spec|plan|spec and plan} for {N} finding(s) ({classes}); commit {sha}" --reversibility high`; (e) post the spec amendment as one comment on the record — `gh issue comment {n} --body-file {file}` (body written with the Write tool to a `bin/session-tmp-resolve.js` path, first line `<!-- plan-review-amendment -->`), or `add_issue_comment` per `_shared/github-write-transport.md` when `gh` is absent; (f) re-run `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" {plan-file} --spec {spec-file}` once and act on its result per `plan-audit.md`. `gh issue edit` never runs against the live record, and nothing is staged for the Review Console: the amended in-run spec is the one `/claude-tweaks:test`, `/claude-tweaks:review` and `/claude-tweaks:wrap-up` judge against. The plan review itself never re-runs, so the step cannot loop.
   - `### Undecided behaviour and cross-task contract` — amend the plan file (a task step, a test, an Interfaces line), commit, log the same `AUTO` entry, re-run `plan-audit.js` once as above. When a spec-gap amendment also exists, these share its single commit, log line, and audit re-run.
   - `### Spec gap — needs-human` — the HARD-GATE (registered in `_shared/auto-mode-contract.md`'s HARD-GATE / BLOCKED / STOP row as the plan-review needs-human spec gap). Branch on presence; a dispatched Task call is identified as `flow/SKILL.md` Step 1 rung 2 identifies it — `run-state.json` carrying `dispatched: true`:
     - **Someone is present in this session** (no `dispatched: true`) — every mode, including `auto`. Put `<!-- HARD-GATE: plan-review-needs-human -->` on its own line immediately above one `AskUserQuestion` call holding every needs-human finding (up to four questions per call; header `Plan review`; options: each Suggested resolution, plus `Stop the build`). Log `KEPT-PROMPT`. An answer is the human's decision: apply it through the intent-resolvable sequence above (it may refine a criterion, attributed `Decided by the user at plan review:` in the clarification and the comment). `Stop the build` stops with the HARD-GATE failure `plan-review-needs-human`.
     - **A dispatched call** (`dispatched: true`) — the Task subagent cannot call `AskUserQuestion`. Post the question(s) as one comment on the record (first line `<!-- plan-review-question -->`, then each finding, its Evidence and Suggested resolution, and the instruction: answer by editing the record's body — the next build materializes the body, not comments). Release the claim: `node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" {n} --run "$PIPELINE_RUN_DIR" --reason "failed: plan-review-needs-human" --remove-in-progress --section "/build" --step "Common Step 1.6"`. When `DISPATCH_HEADLESS=1` was set on this Task call's invocation, also: bootstrap `bot:blocked` per `_shared/label-bootstrap.md`, add it and remove every `auto:*` grant (`auto:build`, `auto:merge`, `auto:merge-pending`) — on MCP, read-merge-write via `mergeLabelNames` (`bin/lib/issues/label-write.js`) per `_shared/github-write-transport.md`'s Full-replace hazard — and send a `PushNotification` ("Record #{n} needs a human decision before it can build: {first question}"); no retry-ceiling count — the gate blocks on its first occurrence. Without `DISPATCH_HEADLESS=1` the human is at the dispatching session: labels stay, and the dispatching session relays the question (`dispatch/reporting.md`). Either way, stop with the HARD-GATE failure `plan-review-needs-human`; the first call reports `OUTCOME: build-test-blocked`, `ISSUE #{n}: failed:plan-review-needs-human`, `STATUS: BLOCKED`.
     - **Exit state** — the claim is released, the worktree and draft PR are left in place (this gate tears nothing down and closes no PR), nothing is merged, and the run reports `BLOCKED` with the question to its caller. Resume: a human answers on the record, re-grants `auto:build` at `/claude-tweaks:backlog refine`, and the next dispatch re-materializes from the answered record.
7. `## Standalone /build` — no `$PIPELINE_RUN_DIR` / `config.yml`: the step still runs and amends the spec; no decision-log write — each amendment is listed in the Step 7 handoff's `### Plan review amendments (standalone build, if any)` section; the record comment is still posted.
8. `## Skip logging` — the exact `SKIP` command: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --section "/build" --step "Common Step 1.6 (plan review)" --text "condition: {ceremony-profile=fast-lane (roster tag \`plan-review\`) | trivial plan: fewer than 3 file references and no Scope keywords:} → fallback: no plan review" --reversibility n/a`.

- [ ] **Step 5: Register the file and the handoff section**

`docs/plugin-structure.md`'s `| build |` row: append `, plan-review.md` to the file list (column 2) and a one-clause description in column 3 matching its neighbours. `plugin/skills/build/handoff-template.md`: after `### SDD rulings (standalone build, if any)` add `### Plan review amendments (standalone build, if any)` with a `- {clarification or plan change} — {class}; record comment {url}` line and an omit-rule line in the SDD-rulings shape (omit when nothing was amended or a run directory exists).

- [ ] **Step 6: Run the suite and its neighbours to verify they pass**

Run: `node --test tests/build-plan-review-conformance.test.js tests/build-dispatch-subfile-table-completeness.test.js tests/ceremony-profile-roster.test.js tests/resolve-profile-invocation-conformance.test.js tests/hard-gate-marker-conformance.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/build/plan-review.md plugin/skills/build/SKILL.md plugin/skills/build/handoff-template.md docs/plugin-structure.md tests/build-plan-review-conformance.test.js
git commit -m "Add Common Step 1.6 plan review — one Capable reviewer amends the spec or plan before Task 1, refs #3377"
```

---

### Task 3: Register the `needs-human` HARD-GATE at the contract and every restating consumer

**Files:**
- Modify: `plugin/skills/_shared/auto-mode-contract.md` (the `| HARD-GATE / BLOCKED / STOP conditions |` row, line ~208)
- Modify: `plugin/skills/_shared/auto-mode-card.md` (line 36)
- Modify: `plugin/skills/_shared/ceremony-profile.md` (`## Never skipped` → `HARD-GATEs` row)
- Modify: `CLAUDE.md` (line 110, the Strict-rule HARD-GATE parenthetical)
- Test: `tests/plan-review-hard-gate-conformance.test.js`

**Interfaces:**
- Consumes: `build/plan-review.md`, the phrase `plan-review needs-human spec gap`, gate `plan-review-needs-human` (Task 2).

Consumer derivation (run once, recorded at plan time): `git grep -n -e "plan-audit hard-fail" -e "plan validation" -- plugin docs CLAUDE.md README.md` hits exactly `auto-mode-card.md:36`, `ceremony-profile.md:37`, `auto-mode-contract.md:208`, `CLAUDE.md:110`. No hit under `plugin/skills/flow/` or `plugin/skills/dispatch/`.

- [ ] **Step 1: Write the failing suite**

`tests/plan-review-hard-gate-conformance.test.js`, with a `rowProblems(row)` helper:

- `AC5.1: the contract's HARD-GATE row names the plan-review needs-human spec gap, both behaviours, the exit state and the resume path` — the row (`split('\n').find(l => l.startsWith('| HARD-GATE / BLOCKED / STOP conditions'))`) contains `` `build/plan-review.md` ``, `plan-review needs-human spec gap`, `in every mode`, `DISPATCH_HEADLESS=1`, `bot:blocked`, `claim is released`, `worktree and draft PR are left in place`, `BLOCKED`, `/claude-tweaks:backlog refine`, `re-materializes`.
- `AC5.2: every consumer that restates the HARD-GATE families cites the new gate` — for each of `plugin/skills/_shared/auto-mode-card.md`, `plugin/skills/_shared/ceremony-profile.md`, `CLAUDE.md`: the line containing `plan validation` also contains `plan-review needs-human spec gap`.
- `AC5.2: the consumer list is complete` — `git`-free fs walk of `plugin/**/*.md` plus `CLAUDE.md`, `README.md`, `docs/**/*.md` (excluding `docs/superpowers/`): every file with a line containing `plan validation` or `plan-audit hard-fail` is in the set {contract, card, roster, CLAUDE.md}.
- `go-red: rowProblems flags each removed anchor` — doctor each anchor out of the live row and assert `rowProblems` returns exactly it.
- `grown _shared files stay within the rail` — `auto-mode-contract.md`, `auto-mode-card.md`, `ceremony-profile.md` ≤ `RAIL_BYTES`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/plan-review-hard-gate-conformance.test.js`
Expected: FAIL — the row lacks `build/plan-review.md`.

- [ ] **Step 3: Edit the four files**

- Contract row: insert, after the `/build`'s adopted-branch collision stop sentence, `` `/build` Common Step 1.6's plan-review needs-human spec gap (`build/plan-review.md`, #3377): a real stop before Task 1 in every mode when someone is present — an `AskUserQuestion` in the session, or, inside a dispatched Task call that cannot ask, a `BLOCKED` report the dispatching session relays; when `DISPATCH_HEADLESS=1`, the record goes `bot:blocked` with the question posted on it (issue comment, `bot:blocked`, every `auto:*` grant removed — the transport `/claude-tweaks:dispatch` uses for blocked records, without the retry-ceiling count). Exit state: the claim is released, the worktree and draft PR are left in place, nothing is merged, and the run reports `BLOCKED` with the question to its caller; resume: a human answers on the record, re-grants `auto:build` at `/claude-tweaks:backlog refine`, and the next dispatch re-materializes from the answered record. ``
- Card line 36: `(spec compliance, test gate, design-doc rejection, plan validation, plan-audit hard-fails, plan-review needs-human spec gap)`.
- Roster `HARD-GATEs` row Why cell: `Test failures, spec compliance blocks, structural coupling, plan validation, a plan-review needs-human spec gap stop every mode`.
- CLAUDE.md line 110: `HARD-GATEs (test failures, spec compliance, structural coupling, plan validation, plan-review needs-human spec gap)` — same line, no line added.

- [ ] **Step 4: Run it and the existing HARD-GATE-row pins to verify they pass**

Run: `node --test tests/plan-review-hard-gate-conformance.test.js tests/adopted-branch-collision-prose-conformance.test.js tests/flow-preflight-conformance.test.js tests/dispatch-mechanical-enforcement.test.js tests/ceremony-profile-roster.test.js tests/flow-dispatched-run-auto-mode.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/auto-mode-contract.md plugin/skills/_shared/auto-mode-card.md plugin/skills/_shared/ceremony-profile.md CLAUDE.md tests/plan-review-hard-gate-conformance.test.js
git commit -m "Register the plan-review needs-human HARD-GATE — contract row plus every consumer that restates the gate families, refs #3377"
```

---

### Task 4: Settle and relay a dispatched build's `needs-human` stop; state the `/build` → `/dispatch` edge

**Files:**
- Modify: `plugin/skills/dispatch/settle-and-merge.md` (new special-case paragraph after "Headless ride-along special case", before numbered step 1)
- Modify: `plugin/skills/dispatch/reporting.md` (new paragraph after the `already-shipped` paragraph)
- Modify: `docs/skill-graph.md` (`## build` table — new `/dispatch` row)
- Test: `tests/plan-review-dispatch-relay-conformance.test.js`

**Interfaces:**
- Consumes: gate `plan-review-needs-human`, file `build/plan-review.md`, marker `<!-- plan-review-question -->` (Task 2).

- [ ] **Step 1: Write the failing suite**

`tests/plan-review-dispatch-relay-conformance.test.js`:

- `Review Focus 5: Settle skips its numbered steps for the plan-review needs-human stop` — `settle-and-merge.md` contains a paragraph starting `**Plan-review needs-human special case (#3377).**` that includes `failed:plan-review-needs-human`, `build/plan-review.md`, `dispatch-retry-ceiling`, and `no PR tombstone`, and appears before the line starting `1. The CLI in step 2 performs the ownership read`.
- `Review Focus 5: the dispatching session relays the question to the human` — `reporting.md` contains `failed:plan-review-needs-human`, `plan-review-question`, and `/claude-tweaks:dispatch #{n}`.
- `AC8.1: docs/skill-graph.md states the /build → /dispatch edge once, in the build section` — the `## build` section (to the next `\n## `) has exactly one row starting `| \`/dispatch\` |` and it names `build/plan-review.md`; the `## dispatch` section has no row naming `build/plan-review.md`.
- `grown dispatch files stay within the rail` — `settle-and-merge.md`, `reporting.md` ≤ `RAIL_BYTES`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/plan-review-dispatch-relay-conformance.test.js`
Expected: FAIL — the special-case paragraph is absent.

- [ ] **Step 3: Edit the three files**

- Settle: `**Plan-review needs-human special case (#3377).** When the failure this call is settling is `/build` Common Step 1.6's plan-review stop (`ISSUE #{n}: failed:plan-review-needs-human`), `build/plan-review.md`'s own exit already posted the question on the record, released the claim, and — under `DISPATCH_HEADLESS=1` — added `bot:blocked`, removed every `auto:*` grant and sent the notification. Skip steps 1-7 for that record: no `failure-check` classification, no attempt counted against `dispatch-retry-ceiling` (the gate blocks on its first occurrence), no failure comment, and no PR tombstone — the draft PR stays open for the resumed run.`
- Reporting: `**Plan-review questions are relayed, not dropped (#3377).** When a group's first call reports `ISSUE #{n}: failed:plan-review-needs-human`, its report block quotes the record's `<!-- plan-review-question -->` comment (its link and each question) and closes with the next step: answer by editing #{n}'s body, then re-run `/claude-tweaks:dispatch #{n}` (or, when the firing was headless and the record is now `bot:blocked`, re-grant `auto:build` at `/claude-tweaks:backlog refine` first). The dispatched Task call cannot ask the human itself (no `AskUserQuestion` in a subagent) — this block is the stop's human-facing half.`
- Skill graph `## build` table: `| \`/dispatch\` | Since #3377, `build/plan-review.md`'s needs-human spec gap stops a dispatched first call with `failed:plan-review-needs-human`: the build posts the question, releases the claim, and under `DISPATCH_HEADLESS=1` applies `/dispatch`'s blocked-record transport (`bot:blocked`, every `auto:*` grant removed) without its retry-ceiling count. `dispatch/settle-and-merge.md`'s Plan-review special case skips Settle's numbered steps for that record, and `dispatch/reporting.md` relays the question to a present human. |`

- [ ] **Step 4: Run it and the skill-graph structure suites to verify they pass**

Run: `node --test tests/plan-review-dispatch-relay-conformance.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/settle-and-merge.md plugin/skills/dispatch/reporting.md docs/skill-graph.md tests/plan-review-dispatch-relay-conformance.test.js
git commit -m "Settle and relay a dispatched plan-review stop — no retry count, no PR tombstone, question reaches the human, refs #3377"
```

---

### Task 5 (verification only): Full suite

- [ ] **Step 1: Run the full test suite (AC9.1)**

Run: `npm test > /tmp/plan-review-npm-test.txt 2>&1; echo exit=$?` (redirect to a `.txt` file; the scratchpad path is fine).
Expected: `exit=0`; `# fail 0` in the output file.
