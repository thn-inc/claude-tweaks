# Answer a Planning-Held Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:specify #N` on a record held by specify's planning step asks only the held questions, writes the answers, amends the kept plan, and stamps `ready`.

**Architecture:** A pure reader (`plugin/bin/lib/issues/planning-hold.js`, CLI `plugin/bin/planning-hold.js`) decides from a record's comments whether it is held by `Held-by: specify-planning` and parses the held-questions block. `plan-audit.js` gains a read-only `--surface-diff` verb that reports whether an amend changed the plan's file list or its Acceptance Criteria coverage. `specify/SKILL.md` case 1 routes a held `needs:decision` record to a new sub-file, `specify/planning-answer.md`, which asks, amends, re-reviews only on a surface change, and writes in the spec's order.

**Tech Stack:** Node 18+ (`node --test`, no deps), Markdown skill prose, `gh` CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-22T204311-spec-6059/work/6059-spec.md` (record #6059)

Scope keywords: held-questions:start, planning-hold, surface-diff

## Global Constraints

- "Read the decision comment through the trusted-author rule; never act on an untrusted comment." (spec Gotchas) — reuse `plugin/bin/lib/issues/comment-trust.js`'s `isTrustedComment` and `untrustedSkipNote`; never restate the association set.
- "The held-questions block schema is #6056's `planning.md`." (spec D7) — the reader parses exactly `planning.md`'s `### Held-questions schema`; no new grammar.
- "Not-started #5560 edits `plugin/skills/specify/SKILL.md`; re-read it before editing if it lands first." (spec Gotchas) — re-read the file immediately before Task 3's edit.
- Write order (spec D10, verbatim): "Store the plan first; then write the body (the `Decided by the user at planning:` lines, then the `Plan:` line with the hash computed last); then resolve the comment and remove `needs:decision`; stamp `ready` last. A failure part-way, or a repeated `Leave for later`, leaves the record held."
- Line form (`_shared/planning-decisions.md` `## Line forms`, verbatim): "Each question the user answered is written as one line: `Decided by the user at planning: {finding} — chose {reading}; not {other reading}`."
- `tests/specify-planning-conformance.test.js`'s "no other specify file except planning.md names the planning step" test: `SKILL.md`'s new text must contain none of `plan-at-specify`, `planning.md`, `plan-store`, `Planning Decisions`, `Plan: ` (the token `planning-answer.md` does not contain `planning.md`); `planning-answer.md` joins that test's skip set (Task 4).
- Rail: `RAIL_BYTES` = 52,500 B. Merge-base sizes: `specify/SKILL.md` 41,106 B (budget ≤ +2,500 → ~8.9 KB headroom left); `specify/planning.md` 31,639 B (≤ +600); `_shared/work-record.md` 45,472 B (≤ +600 → ~6.4 KB left); new `specify/planning-answer.md` ≤ 12,000 B.
- Governing skill `gh-api-module-pattern` (`cli-wrapper-contract.md`), quoted: "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes." / "A CLI that tests call in-process meets the entry contract (#5374; `plugin/bin/resolve-policy.js` is the worked example). It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one." / "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe." / "Adding a verb to an existing multi-verb CLI needs the same sweep: every list of the CLI's verbs, and every list of the input files they read, must gain the new entry."
- Governing skill `skill-prose-conformance-tests`, quoted: "Anchor on a literal token the skill already uses — a filename pattern, a fenced heading, a table-row prefix — never a paraphrase." / "When the assertion and the prose it pins are authored in the same change … copy the pinned literal out of the edit's own replacement text, never from memory of what that edit says." / "When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself." — use `tests/helpers/conformance-asserts.js`'s `missingFactsOf` + `assertEachPatternGoesRed`, as the existing suite's `pinned()` does.
- Governing skill `prose-code-twin-pin`: the held-questions schema now has a code twin (the reader); a conformance test pins the two equal (Task 4, writer-reader test). No other `.claude/skills/` rule names these files.
- Commits: `{Verb} {what} — {detail}`, each ending `Claude-Session: https://claude.ai/code/session_01QXpjcVuMKYXkKy4dQrd1Jy`.

## Spec coverage map

| AC | Covered by |
|---|---|
| AC4.1 | Task 5 Step 1 (`npm test -- --full` exits 0) |

## Decisions this plan makes (spec silent)

- The answer path runs under `work-backend: github-issues` whenever the hold is detected, whatever `plan-at-specify` resolves: a hold is record state, and today's re-shape under `off` would resolve the comment as "promoted" and drop the held questions, which `planning.md` forbids ("Its held questions are never dropped on the way to `ready`").
- "Ambiguous" (D7) = more than one unresolved trusted decision comment on the record; "newest" = the last such comment in API order.
- D9's "Acceptance Criteria text" is read on the plan side as each AC clause's coverage status (`covered`/`waived`/`uncovered`, Check E's parse): the body's criterion text cannot change on this path, because `## Planning Decisions` "never edits an existing criterion's line" and the D8 check pins the body hash the plan was stored against.
- `Leave for later` (or an errored/timed-out/auto-answered call) on any held question writes nothing: no decided line, no plan, no label change. The record stays held with its comment as it was; answers given earlier in that run are asked again next time.
- A comma-list/range batch containing a held element fails the whole invocation, as a `needs:definition` element does today; a held element under `--chained` is refused. Bare drain never reaches it (`_shared/work-record.md`'s Worklist rule).

## Review Focus

1. A held record whose body has no `Plan:` line, or whose `plan-store.js read` fails — must re-plan with the decided lines binding, and review runs (Task 4 pins the missing/stale/failed-read branch).
2. `Leave for later` on the second of three questions after answering the first — nothing is written and the record stays held (Task 4 pins "writes nothing").
3. A record carrying a planning hold plus an unresolved `backlog-grant` decision comment — ambiguous, keeps today's behaviour with a notice (Task 1 unit test).
4. A planning-failed hold whose block holds no `- Question:` line — still a hold, zero questions; the answer path asks nothing and re-plans (Task 1 unit test, Task 4 pin).
5. A comma-list batch naming a held record — fails the whole invocation before any record is shaped (Task 3 pin).

---

### Task 1: Planning-hold reader and CLI

**Role:** integration
**Review risk:** high (decision logic: trusted/unresolved/newest selection drives routing)

**Files:**
- Create: `plugin/bin/lib/issues/planning-hold.js`
- Create: `plugin/bin/planning-hold.js`
- Test: `tests/bin-lib/issues/planning-hold.test.js`
- Test: `tests/planning-hold-cli.test.js`
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/issues/` row gains `planning-hold.js [#6059: …]`; the CLI command list gains a `node plugin/bin/planning-hold.js --comments-file <f>` line beside `plan-store.js`'s)

**Interfaces:**
- Consumes: `isTrustedComment(comment)`, `untrustedSkipNote(comment)` from `plugin/bin/lib/issues/comment-trust.js`.
- Produces: `readPlanningHold(comments) -> { verdict: 'held'|'not-held', reason: null|'no-decision-comment'|'not-planning'|'untrusted'|'unparseable'|'ambiguous', comment: null|{ id, url }, questions: [{ question, options: [recommended, other], recommended }], skipped: [string] }` and constants `HELD_BY_LINE = 'Held-by: specify-planning'`, `BLOCK_START = '<!-- held-questions:start -->'`, `BLOCK_END = '<!-- held-questions:end -->'`. CLI: `node plugin/bin/planning-hold.js --comments-file <f>` prints `readPlanningHold`'s result as one JSON line; `<f>` is `gh issue view {n} --json comments` output (`{comments:[…]}`) or an MCP `get_comments` array. Exit 0 any verdict; 1 file unreadable, not JSON, or not one of the two shapes; 2 malformed invocation (unknown flag, missing value). `module.exports = { run, realDeps }`.

Rules (from `_shared/work-record.md`'s Resolution rule and `planning.md`'s schema): a decision comment is a comment whose body contains `<!-- needs-decision: `; it is unresolved when its body has no `**Resolved:**`; only trusted ones count, and each untrusted decision comment adds its `untrustedSkipNote` to `skipped`. Zero unresolved trusted → `untrusted` when some untrusted unresolved decision comment carries the `Held-by` line, else `no-decision-comment`. More than one → `ambiguous`. Exactly one → `not-planning` unless a line equals `HELD_BY_LINE` (trimmed) and the comment carries `<!-- needs-decision: specify -->`; then parse the block: the `Held-by` line directly above `BLOCK_START`, `BLOCK_END` after it, between them zero or more groups of exactly `- Question: {q}`, `  Option: {a}`, `  Option: {b}`, `  Recommended: {r}` with `r === a`, every value non-empty — anything else is `unparseable`. `\r\n` normalized first.

- [ ] **Step 1: Write the failing unit tests** in `tests/bin-lib/issues/planning-hold.test.js` (helper `hold(questionsBlock, extra)` builds a `planning.md`-template comment; `trusted = {authorAssociation:'OWNER'}`):
  - `AC5.1: a decision comment without the Held-by line is not-planning` — one trusted `<!-- needs-decision: specify -->` comment, no `Held-by` line → `{verdict:'not-held', reason:'not-planning'}`.
  - `AC5.2: a planning comment from an untrusted author is not a hold` — same template, `authorAssociation:'CONTRIBUTOR'` → `reason:'untrusted'`, `skipped.length === 1`, `skipped[0]` equals `untrustedSkipNote(comment)`.
  - `held: two questions parse in order` → `verdict:'held'`, `questions` deep-equals the two objects, `comment.id` is the node id.
  - `Review Focus 4: an empty block is a hold with zero questions` → `verdict:'held'`, `questions: []`.
  - `Review Focus 3: a planning hold beside an unresolved backlog-grant comment is ambiguous` → `reason:'ambiguous'`.
  - `a resolved planning comment is not a hold` (body starts `**Resolved:** …`) → `reason:'no-decision-comment'`.
  - `unparseable: three Option lines / Recommended not the first option / missing end marker / Held-by not directly above the block` — four cases, each `reason:'unparseable'`.
- [ ] **Step 2: Run the unit tests to see them fail**

Run: `node --test tests/bin-lib/issues/planning-hold.test.js`
Expected: FAIL — `Cannot find module` for `plugin/bin/lib/issues/planning-hold`.
- [ ] **Step 3: Implement** `readPlanningHold` and the constants in `plugin/bin/lib/issues/planning-hold.js` (pure, no `fs`), header comment naming #6059 and `planning.md`'s schema as its source.
- [ ] **Step 4: Run** the unit tests — Expected: PASS. Then mutate once each (scratch, reverted): drop the `isTrustedComment` filter → AC5.2 red; drop the `count > 1` branch → Review Focus 3 red; drop the `r === a` check → its unparseable case red. Record the three red names in the task report.
- [ ] **Step 5: Write the CLI tests** in `tests/planning-hold-cli.test.js` (in-process `run(argv, deps)` with injected `stdout`/`stderr`/`cwd`, plus one real-process spawn): gh shape and MCP-array shape give the same JSON line; an unreadable file exits 1 naming the argument's spelling; `--comments-file` with no value exits 2; `--help` exits 0 and prints usage; a real `planning.md` hold template (read from `plugin/skills/specify/planning.md`'s `## Hold` fence, placeholders replaced) parses as `held` with one question.
- [ ] **Step 6: Run** `node --test tests/planning-hold-cli.test.js` — Expected: FAIL (module missing).
- [ ] **Step 7: Implement** `plugin/bin/planning-hold.js` per the entry contract (relative paths through `resolveAgainst(deps.cwd(), p)` from `plugin/bin/lib/health-core/io.js`), header comment documenting usage and the 0/1/2 family. Add the `docs/plugin-structure.md` lines.
- [ ] **Step 8: Run** both test files plus `node --test tests/bin-lib/exit-code-conformance.test.js tests/bin-lib/cli-entry-conformance.test.js tests/path-guard-conformance.test.js` — Expected: PASS.
- [ ] **Step 9: Commit** — `Add planning-hold reader — decide a Held-by: specify-planning hold from a record's comments`.

### Task 2: `plan-audit.js --surface-diff`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/plan-audit/args.js` (flag, USAGE, refusals)
- Modify: `plugin/bin/plan-audit.js` (header comment + verb branch)
- Modify: `plugin/bin/lib/plan-audit/checks.js` (export `surfaceDiff`)
- Test: `tests/bin-lib/plan-audit/` — add `surface-diff.test.js`; extend the existing args test file there (find it with `ls tests/bin-lib/plan-audit/`)
- Modify: `docs/plugin-structure.md` (line 423's command and its verb sentence; line 194's build row verb list)

Verb-list sweep (Step 5): every other list of plan-audit's verbs, found by `git grep -n -e '--risk-proofs' -- plugin docs tests ':!docs/superpowers/plans' ':!.claude-tweaks/pipelines'`; classify each hit as "lists the verbs → add `--surface-diff`" or "no change" in the task report.

**Interfaces:**
- Consumes: `extractFileEntries(text)` (parser.js), `checkE(specText, planText)` (checks.js).
- Produces: `surfaceDiff(specText, beforePlanText, afterPlanText) -> { changed: boolean, files: { added: string[], removed: string[] }, acCoverage: [{ id, before, after }] }` — `files` compares the sets of `path` values from `extractFileEntries` (sorted, deduped); `acCoverage` lists each clause id whose status (`covered` | `waived` | `uncovered`, from `checkE`) differs; `changed` is true when any list is non-empty. CLI: `plan-audit.js <after-plan> --surface-diff <before-plan> --spec <spec>` prints `{"surfaceDiff": …}` on one line and exits 0; an unreadable before-plan exits 2 like an unreadable plan. Refusals (UsageError, exit 2): `--surface-diff` without a value, without `--spec`, or with `--count-tasks`/`--bytes`/`--task-markers`/`--risk-proofs`.

- [ ] **Step 1: Write the failing tests** in `surface-diff.test.js`: `AC2.1: an amend that keeps the file list and AC coverage is unchanged` (identical plans → `changed:false`, all lists empty); `a new Modify: path is a file-list change` → `files.added` = that path, `changed:true`; `a removed Test: path is a file-list change` → `files.removed`; `D9: an amend that newly waives an AC clause changes coverage` → `acCoverage` = `[{id:'AC1.1', before:'covered', after:'waived'}]`; `a reworded task with the same paths and citations is unchanged`. Args tests: each refusal above throws `UsageError`; `{surfaceDiff, spec}` parse.
- [ ] **Step 2: Run the new tests to see them fail**

Run: `node --test tests/bin-lib/plan-audit/surface-diff.test.js`
Expected: FAIL — `surfaceDiff is not a function` and `unknown flag: --surface-diff`.
- [ ] **Step 3: Implement** `surfaceDiff` in checks.js, the flag in args.js, and the verb branch in plan-audit.js after the `--spec` read and before the policy read (it needs no repo root and no policy).
- [ ] **Step 4: Run** `node --test tests/bin-lib/plan-audit/` plus a CLI check: `node plugin/bin/plan-audit.js docs/superpowers/plans/2026-11-22-specify-planning-answer.md --surface-diff docs/superpowers/plans/2026-11-22-specify-planning-answer.md --spec .claude-tweaks/pipelines/2026-11-22T204311-spec-6059/work/6059-spec.md` — Expected: PASS, and the CLI prints `{"surfaceDiff":{"changed":false,"files":{"added":[],"removed":[]},"acCoverage":[]}}`.
- [ ] **Step 5: Sweep** the verb lists (grep above) and update each; update `docs/plugin-structure.md`.
- [ ] **Step 6: Commit** — `Add plan-audit --surface-diff — report whether an amend changed the plan's file list or AC coverage`.

### Task 3: Case 1 routing in `specify/SKILL.md`

**Role:** integration
**Review risk:** high (decision logic: which path a record takes)

**Files:**
- Modify: `plugin/skills/specify/SKILL.md` (Resolve-the-input case 1: a new **Planning-hold routing** paragraph after the digest-container guard and before the `needs:definition` redirect; the Batch branch; case 5's by-reference guard list)
- Modify: `plugin/skills/_shared/work-record.md` (`### Decision-comment template`: one sentence naming specify's planning hold — its `Held-by: specify-planning` line and held-questions block, written by `specify/planning.md`'s `## Hold`, read by `bin/planning-hold.js` — and that `/claude-tweaks:specify #{n}` answers it)
- Test: `tests/specify-planning-answer-conformance.test.js` (create)

**Interfaces:**
- Consumes: Task 1's CLI (`node "${CLAUDE_PLUGIN_ROOT}/bin/planning-hold.js" --comments-file "{f}"`) and its `verdict`/`reason`/`skipped` fields.
- Produces: the routing contract Task 4's file assumes — `planning-answer.md` is read only with a `held` verdict, from an interactive (not headless) single-record invocation under `work-backend: github-issues`, after the parent and digest guards passed; it receives `{n}`, the fetched body, and the verdict JSON file path `{hold-file}`.

Paragraph content (write in the file's voice; every quoted string below is pinned by the test and must appear verbatim):
- Runs under `work-backend: github-issues` only, when the fetched labels carry `needs:decision`. Fetch comments: `gh issue view {n} --json comments > "{comments-file}"` (path from `session-tmp-resolve.js --value specify-hold-comments-{n}.json`), or, with `gh` absent, `issue_read` `get_comments` (`perPage: 100`) per `_shared/github-write-transport.md`, written with the Write tool. Then `node "${CLAUDE_PLUGIN_ROOT}/bin/planning-hold.js" --comments-file "{comments-file}" > "{hold-file}"`.
- Print every `skipped` line. Verdict `held`: when the invocation is headless as `shaping-mode-stamping.md`'s `### Risk flags` step 2 defines it, refuse with the one-line reason `#{n} is held for planning question(s) — answer them with /claude-tweaks:specify #{n} where a human can reply` and stop (this is the needs-guard D5 names); otherwise read `planning-answer.md` in this skill's directory and follow it instead of shaping mode.
- Verdict `not-held` with reason `untrusted`, `unparseable` or `ambiguous`: one-line notice `#{n}'s decision comment is not a usable planning hold ({reason}) — shaping it as before`, then continue as today. Reasons `not-planning` and `no-decision-comment`: continue as today, no notice. A failed comment fetch or a non-zero CLI exit: the notice with reason `unreadable`, then today's behaviour.
- Batch branch: a `held` element fails the whole invocation like a `needs:definition` element, message `'{element}' is held for planning question(s) — run /claude-tweaks:specify #{element} on its own to answer them, then re-run the batch without it`. Case 5 applies this routing by reference, like the two guards.
- Avoid the planning tokens listed in Global Constraints.

- [ ] **Step 1: Write the failing tests** — first re-read `plugin/skills/specify/SKILL.md` (Gotcha: #5560) and `wc -c` it — in `tests/specify-planning-answer-conformance.test.js` (reuse the `lit`/`pinned` helper pattern from `tests/specify-planning-conformance.test.js`; region = SKILL.md's case 1 text from `1. **Work record reference**` to `2. **Design doc path**`): `D1: case 1 routes a held needs:decision record to planning-answer.md` (pins `planning-hold.js" --comments-file`, `read \`planning-answer.md\``, `needs:decision`); `D5: a headless invocation on a held record refuses naming the planning hold` (pins the refusal string, `### Risk flags` step 2 citation); `AC3.1 + AC5.1 + AC5.2: a record that is not a planning hold keeps today's behaviour` (pins the notice string with `{reason}`, the three reasons, and "continue as today"); `Review Focus 5: a batch with a held element fails whole` (pins the batch message); `the routing paragraph sits after the digest-container guard and before the needs:definition redirect` (index order: `**Digest-container guard` < `planning-hold.js` < `**\`needs:definition\` redirect`); `work-record.md names the planning hold` (pins `Held-by: specify-planning`, `bin/planning-hold.js`); go-red per fact via `assertEachPatternGoesRed`.
- [ ] **Step 2: Run the new tests to see them fail**

Run: `node --test tests/specify-planning-answer-conformance.test.js`
Expected: FAIL — the routing literals are absent from SKILL.md.
- [ ] **Step 3: Edit** SKILL.md and work-record.md. Copy the pinned literals from this edit's own text into the test if any wording changed.
- [ ] **Step 4: Run** `node --test tests/specify-planning-answer-conformance.test.js tests/specify-planning-conformance.test.js` and the skill-audit suites (`node --test tests/bin-lib/skill-audit/`) — Expected: PASS; `wc -c` SKILL.md ≤ 43,606 B and work-record.md ≤ 46,072 B.
- [ ] **Step 5: Commit** — `Route a planning-held record in /specify case 1 — answer path, headless refusal, today's behaviour otherwise`.

### Task 4: The answer path, `specify/planning-answer.md`

**Role:** judgment
**Review risk:** high (decision logic and ordered remote writes)

**Files:**
- Create: `plugin/skills/specify/planning-answer.md`
- Modify: `plugin/skills/specify/planning.md` (`**Re-running.**` paragraph in `## Hold`: a held record carrying `needs:decision` is now answered through `planning-answer.md`, routed from `SKILL.md`'s case 1; the re-shape sentence stays only for a hold whose label was removed by hand, which reaches shaping and the held re-review)
- Modify: `tests/specify-planning-conformance.test.js` (add `plugin/skills/specify/planning-answer.md` to the "no other specify file" test's skip set; behavior-change sweep: re-point any pin on the old `**Re-running.**` sentence — find with `git grep -n -F 're-shapes a held record' -- tests plugin`)
- Modify: `docs/plugin-structure.md` (specify sub-file row: add `planning-answer.md` to the file list and one sentence on what it holds)
- Test: `tests/specify-planning-answer-conformance.test.js`

**Interfaces:**
- Consumes: Task 3's routing contract (`{n}`, fetched body, `{hold-file}`); Task 1's `questions`/`comment.id`; Task 2's `--surface-diff`; `planning.md`'s `## Per-record step` steps 2-8, `## Planner prompt` (incl. **Amend prompt.** and **Reading the reply.**), `## Reviewer dispatch`, `## Routing`, **Asking.**, `## Hold`, and **Logging.**; `shaping-mode-stamping.md`'s live-comment resolution mechanics (`updateIssueComment`, fail closed); `_shared/planning-decisions.md`'s `## Asking` and `## Line forms`.
- Produces: outcome words for Actions Performed — `answered — {k} planning question(s), ready (Plan: {short commit})`, `held — {k} planning question(s) still open`, `held — answer failed: {reason}`, `failed — {step} ({reason}); re-run /claude-tweaks:specify #{n}` — and Next Actions `/claude-tweaks:flow #{n}` after `answered`.

Procedure the file states, in this order (sections `## Inputs`, `## Ask`, `## Kept plan`, `## Amend and change test`, `## Write`, `## Read-back and outcome`); cite `planning.md` sections by name, never restate them:
1. **Inputs.** Write the fetched body to `{held-body}` (Write tool, `session-tmp-resolve.js --value specify-answer-held-{n}.md`) and copy it to `{body}` (`specify-answer-body-{n}.md`). The kept `Plan:` line is the body's one line starting `Plan: ` above its first `##` heading; none or more than one counts as missing. This path runs none of shaping mode's steps (no framing, ceremony or risk-flag pass, no compose).
2. **Ask.** Zero questions → skip to step 3. Otherwise one batch table (`Question`, `Recommended reading`), then `planning.md`'s **Asking.** rules: one `AskUserQuestion` per set of at most four, one call per message, options recommended `(Recommended)`, other, `Leave for later`. Any `Leave for later`, or a call that errors, times out or is auto-answered: write nothing at all — no line, no plan, no label, no comment edit — outcome `held — {k} planning question(s) still open`. Otherwise add one `Decided by the user at planning:` line per answer under `{body}`'s `## Planning Decisions`, replacing a lone `No planning questions arose.` line.
3. **Kept plan.** Base and checkout per `planning.md` step 2. Write the kept line to `{plan-line-file}` and run `plan-store.js check --line-file "{plan-line-file}" --spec-file "{held-body}" --base {base}` (the held body, the one the line's hash was computed over). `{"valid": true}` → `plan-store.js read --record {n} --commit {commit} --out "{checkout}"`, copy the printed `path` to `{plan-before}` (session tmp). A missing line, any other verdict or exit, or a failed read → re-plan: `planning.md`'s `## Per-record step` steps 3-7 on `{body}` (the decided lines bind the planner), so plan review runs; skip step 4 below.
4. **Amend and change test.** Dispatch the planner with `planning.md`'s **Amend prompt.**, the decisions table holding one row per answer (`finding` = the question, `class` = `needs-human`, `decision` = its decided line); read the reply per **Reading the reply.**. Run `planning.md` step 4's audit on the amended plan. Then `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" "{plan}" --surface-diff "{plan-before}" --spec "{body}"`: `changed: false` → no plan review; `changed: true`, a non-zero exit or no JSON line → `planning.md` steps 5-7 (reviewer, routing, amend and audit). Routing that asks again follows **Asking.**; a hold there takes `planning.md`'s `## Hold` (which resolves this comment first and posts a new one), outcome `held — needs:decision ({k} planning question(s))`. A planning failure (as `planning.md` defines it) → write nothing, outcome `held — answer failed: {reason}`. The planner's report never decides whether review runs.
5. **Write**, one call each, in this order, stopping at the first failure with `failed — {step} ({reason}); re-run /claude-tweaks:specify #{n}` (every stop before (c) leaves `needs:decision` and the comment, so the record stays held): (a) `plan-store.js write --record {n} --plan-file "{plan}" --base {base} --spec-file "{body}"` — any non-zero exit stops (no no-ref fallback here); (b) put the printed `line` in `{body}` as `planning.md` step 8 places it, then `gh issue edit {n} --body-file "{body}"` (MCP per `_shared/github-write-transport.md` when `gh` is absent); (c) prepend `**Resolved:** answered via /claude-tweaks:specify — {date}` to the hold comment `comment.id` names, with `shaping-mode-stamping.md`'s live-comment mechanics, then `gh issue edit {n} --remove-label "needs:decision"` — fail closed: a failed comment edit never removes the label; (d) `gh issue edit {n} --add-label ready`. Remove the checkout on every path.
6. **Read-back and outcome.** Re-fetch `labels,body,comments`: `ready` present, `needs:decision` absent, the hold comment carries `**Resolved:**`, the body has exactly one `Plan:` line equal to the printed `line`, and `plan-store.js check` of that line against the re-fetched body and `{base}` prints `{"valid": true}`. Outcome `answered — …`; Detail adds `review re-ran: yes|no` and, on a re-plan, `re-planned: {failed check}`. Logging per `planning.md`'s **Logging.**, plus one `--status AUTO --reversibility high` entry per decided line with a run dir. Next Actions recommends `/claude-tweaks:flow #{n}`.

- [ ] **Step 1: Write the failing tests** in `tests/specify-planning-answer-conformance.test.js` (region per `## ` section of planning-answer.md via `sectionOf`): `AC1.1: the answer path asks only the held questions and ends ready, needs:decision removed, comment resolved, Plan: hash matching the body` (pins in `## Ask` and `## Read-back and outcome`); `AC2.1: no plan review runs unless --surface-diff reports a change` (pins `--surface-diff`, `` `changed: false` → no plan review ``, `The planner's report never decides whether review runs`); `D6: an answer that changes the surface re-runs review` (pins `` `changed: true` ``, `steps 5-7`); `D8: a missing or stale kept plan re-plans with the decided lines binding it` (pins the `--spec-file "{held-body}"` check and the re-plan sentence — also Review Focus 1); `D10: writes run plan, body, comment+label, ready in that order` (index-order chain over the four markers `plan-store.js write`, `--body-file "{body}"`, `--remove-label "needs:decision"`, `--add-label ready`, plus a permutation go-red); `Review Focus 2: Leave for later writes nothing` (pins `write nothing at all`); `Review Focus 4: zero questions skips asking`; `writer-reader: planning.md's hold template parses as held through planning-hold.js` (render `planning.md`'s `## Hold` fence with one question, call `readPlanningHold`, expect `held`; go-red: drop the `Held-by` line → `not-planning`); `planning-answer.md headings appear in order`; `planning-answer.md never restates the asked classes` (none of `**(a) Design-level.**`, `**(b) Hard to undo.**`, `**(c) Contradiction.**`); `planning.md's Re-running paragraph points at planning-answer.md`.
- [ ] **Step 2: Run the new tests to see them fail**

Run: `node --test tests/specify-planning-answer-conformance.test.js`
Expected: FAIL — `planning-answer.md` does not exist yet.
- [ ] **Step 3: Write** `planning-answer.md` (header: what reads it — `SKILL.md` case 1 with a `held` verdict — and that it is shaping mode's alternative for this record), edit `planning.md`'s **Re-running.**, add the skip-set entry and the plugin-structure row.
- [ ] **Step 4: Run** `node --test tests/specify-planning-answer-conformance.test.js tests/specify-planning-conformance.test.js tests/bin-lib/skill-audit/` and `wc -c plugin/skills/specify/planning-answer.md plugin/skills/specify/planning.md` — Expected: PASS; sizes within Global Constraints.
- [ ] **Step 5: Commit** — `Answer a planning-held record in /specify — ask the held questions, amend the kept plan, stamp ready`.

### Task 5: Whole-suite check

**Role:** transcription

**Files:** none (verification only).

- [ ] **Step 1: Run** `npm test -- --full > "{run-dir}/evidence/full-suite.txt" 2>&1` (create `evidence/` first) — Expected: exit 0 (AC4.1). Any failure is fixed in the owning task's files and committed as `Fix {what} — {detail}`.
