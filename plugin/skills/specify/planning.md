# Specify — Planning at Shaping Time (#6056)

Read only when `shaping-mode.md`'s Planning at specify paragraph resolved `plan-at-specify` to `on` under `work-backend: github-issues`; under `off`, the default, nothing in this file runs and shaping is exactly as written. Resolution refuses `on` while `planning-decisions` resolves `ask-all`: `resolve-policy.js` then prints `off` and one stderr warning naming the conflict, never an error, and that paragraph relays the warning as a one-line notice. This file writes a plan for each record shaping mode is about to stamp `ready`, reviews it, settles or asks its questions, and stores it beside the record, all before the record's one write. Which questions reach the user, and how every other one is written down, is `_shared/planning-decisions.md`'s, cited here by section name; this session is the controller that file names.

**Plan text never enters this session.** Planners and the reviewer return paths and tables only, so never Read the plan file and never ask an agent for its text; `plan-audit.js`'s JSON and `plan-store.js`'s JSON are the only other views of it.

## Which records are planned

A record is planned when `shaping-mode-stamping.md`'s Compose-then-write-once is about to write it with `ready`: a `shaped` record, including a single-record exit-0 record whose `### Risk flags` run changed its body. A refused record, a digest container, an `already shaped, no-op` record and a body the pre-write shape check refuses are never planned.

**Plan-less lane predicate.** First ask whether a lane that composes no plan will take the record. Resolve `{lane-file}` with `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-plan-lane-{n}.json`, then write the record there, its labels being the fetched labels plus this pass's stamps (`risk:*`, `size:*`, `ceremony:*`, Type, `ready`) minus its removals — the verdict reads those labels, and the live record does not carry them yet. Label names are fetched text, so they never go on the command line: write them one per line with the Write tool to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-plan-labels-{n}.txt` prints, `{labels-file}`:

```bash
node -e "const fs=require('fs');fs.writeFileSync(process.argv[1],JSON.stringify({number:Number(process.argv[2]),body:fs.readFileSync(process.argv[3],'utf8'),labels:fs.readFileSync(process.argv[4],'utf8').split('\n').map((s)=>s.trim()).filter(Boolean)}))" -- "{lane-file}" {n} "{body}" "{labels-file}"
node "${CLAUDE_PLUGIN_ROOT}/bin/express-lane.js" plan-lane --record-json "{lane-file}"
```

It prints `{number, lane, reason}`: the verdict of `needsNoPlan` (`bin/lib/driver/plan-lane.js`). A non-null `lane` means the record is not planned: no plan, no `Plan:` line and no `## Overview` insertion, and any `Plan:` line already in `{body}` is removed before the write, whether or not the composition kept it (a stored plan describes an earlier body, and this record takes no plan); its Actions Performed Detail reads `not planned: {lane} lane ({reason})`, and with a run dir it logs one `SKIP` (Logging, below). A non-zero exit, no JSON line, or `lane: null` plans the record.

**Reuse a stored plan.** When the record's fetched body already carries a `Plan:` line, run `## Per-record step`'s steps 1-2, then check the line against the new body and base. The line is record-body text, so it never goes on the command line: write it with the Write tool to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-plan-line-{n}.txt` prints, `{plan-line-file}`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" check --line-file "{plan-line-file}" --spec-file "{body}" --base {base}
```

`{"valid": true}` (exit 0) keeps that line: skip steps 3-8, remove the checkout, and carry the line into the write. Any other verdict or exit re-plans, and the new line replaces the old one.

**A held record re-reviews its reused plan.** When the record's captured hold state (below) says it carries `needs:decision`, or says its newest unresolved decision comment from a trusted author carries `Held-by: specify-planning`, a valid check still keeps the plan, but skips only steps 3-4. Either signal alone marks the record held: a hold cleared by removing the label by hand leaves the comment, and its held questions must still be folded in before `ready`. Fetch it with `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" read --record {n} --commit {commit} --out "{checkout}"` (`{commit}` from the `Plan:` line; its printed `path` is `{plan}`), then run steps 5-9 on it, so its questions are asked again, or held again when headless, before `ready` is stamped. A failed read re-plans.

**Capture the hold state per record, before the `needs:*` bullet runs.** The record fetch carries no comments, and `shaping-mode-stamping.md`'s `needs:*` bullet and live-comment resolution prepend `**Resolved:**` to the hold comment and remove the label before this step runs. So for each record, before that bullet runs, make one call: `gh issue view {n} --json labels,comments`, or, when `gh` is absent, `issue_read` (`get` mode for the labels, `get_comments` mode for the comments, `perPage: 100`, per `_shared/github-write-transport.md`'s mapping). Keep two facts from it, either of which alone marks the record held: whether the record carries `needs:decision`, and whether the newest unresolved decision comment from a trusted author (selected by the same trusted-author and unresolved rule as that bullet's queries) has a body carrying `Held-by: specify-planning`. The held re-review above uses these captured facts, never a re-fetch after the resolve. A failed capture call counts as held for the reuse decision: a valid stored plan is still fetched and re-reviewed (steps 5-9) as the held re-review above says, so any held questions are asked again, or held again when headless, before `ready`; a record that was not actually held gets one extra review, and a failed `plan-store.js read` still re-plans.

## Per-record step

Run at the point `shaping-mode-stamping.md`'s Compose-then-write-once names: after `### Risk flags` settled the session-tmp body file, `{body}`, and before that section's pre-write shape check. In order:

1. **Body.** `{body}` is the composed body. When the fetched body held a `## Overview` or `## Planning Decisions` section this composition dropped, carry it over verbatim. When `{body}` has no `## Overview`, insert one directly above `## Current State`: one paragraph saying what the record builds and why, drawn from its own Current State and Deliverables. The plan's spec hash (`bin/lib/issues/plan-line.js`) covers `## Overview` through `## Planning Decisions` and refuses a spec with no Overview. `## Planning Decisions` goes after `## Gotchas` (and after `## Breaking Change` when present), before `## Original request`.
2. **Base and checkout.** Resolve `{integration-branch}` per `_shared/integration-branch.md`, then run each of these as its own plain call (`_shared/scratch-worktree.md` §7): `git fetch origin {integration-branch}`; `git rev-parse origin/{integration-branch}`, whose sha is `{base}`, the plan's base; `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-plan-checkout-{n}`, whose path is `{checkout}`; `git worktree add --detach "{checkout}" {base}`. The checkout's tracked files are read-only: the plan is the one file written there. Once this record's planning ends, on every path, remove it with `git worktree remove --force "{checkout}"`.
3. **Planner.** Dispatch one planner on the Standard profile (`## Planner prompt`). Open Prerequisites do not skip planning.
4. **Audit.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" "{plan}" --spec "{body}" --repo-root "{checkout}"`. When it exits non-zero, or its `checkE.uncovered` or `checkF.unlisted` is non-empty, re-dispatch the planner once with the Amend prompt, passing the audit's JSON line as its findings, and run the audit again; a check whose `ok` is still `false`, or an audit that prints no JSON line, means planning failed. `checkE` and `checkF` always report `ok: true`, so `checkE.uncovered` or `checkF.unlisted` items that survive the re-dispatch do not fail planning: pass them to the reviewer in step 5 and name them in the Actions Performed Detail.
5. **Reviewer.** Dispatch one reviewer on the Capable profile (`## Reviewer dispatch`).
6. **Route.** Route its reply (`## Routing`).
7. **Amend.** When routing produced plan amendments, settled lines, decided lines, intent-resolvable clarification lines or flag additions, re-dispatch the planner with the Amend prompt, the decisions table and `{plan}`; it returns the path. Run step 4's audit once more; a failing check, or an audit that prints no JSON line, here means planning failed, and residual `checkE.uncovered` or `checkF.unlisted` items join the Actions Performed Detail.
8. **Store.** From this session's working directory, run `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" write --record {n} --plan-file "{plan}" --base {base} --spec-file "{body}"`. Exit 0 prints `{ref, commit, specHash, line}`: insert `line` verbatim as the last line of `{body}`'s metadata block, above its first `##` heading, replacing any `Plan:` line already in `{body}`; `bin/plan-store.js` is the line's one writer, so never type or edit it. Exit 3 is the no-ref outcome: keep every decision line, write no `Plan:` line (removing any `Plan:` line already in `{body}`), and record why — the Detail reads `planned, no Plan: line: plan-store exit {code} ({first stderr line})`, and with a run dir one `SKIP`. Any other non-zero exit takes the same fallback.
9. **Write.** Return to Compose-then-write-once: its pre-write shape check and its one write follow, with `## Hold`'s label changes for a held record.

**Planning failed** (the checkout cannot be made, a planner or reviewer reply is still unusable after its one re-dispatch, or an audit fails as step 4 or 7 says): remove the checkout, drop this pass's settled and decided lines, write no `Plan:` line and remove any `Plan:` line already in `{body}`, and let the record be written as it would be under `off`. Its Detail reads `not planned: {reason}`, and with a run dir it logs one `SKIP`. A planning failure never fails the record and never stops a batch. **A held record's planning failure keeps it held.** When the record's captured hold state marks it held (a failed capture included), it takes `## Hold` instead of the `off` write, with no `Plan:` line and no settled or decided lines: its hold comment's held-questions block is the captured hold comment's block copied verbatim, or holds no `- Question:` line when the capture failed or found no block. Its outcome is `held — planning failed: {reason}`, and its read-back is the Held bullet's without the `## Overview`, `## Planning Decisions` and `Plan:` line assertions. Its held questions are never dropped on the way to `ready`.

**Logging.** With a run dir (`_shared/pipeline-run-dir.md`; bare drain's own run dir), log through `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --section "/specify" --step "Planning" --text-file "{text-file}"`, `{text-file}` written with the Write tool first, because the text quotes record and reviewer prose (`_shared/auto-decision-log.md`'s Text from git or a user paragraph): one `--status SKIP --reversibility n/a` per unplanned record, holding `condition: {reason} → fallback: no plan stored`, and one `--status AUTO --reversibility high` per settled row, holding its `Settled at planning:` line. Without a run dir (`--chained`, an interactive run) the Actions Performed Detail carries the same facts. The planner's premise outcomes join the Detail as `premises: {k} confirmed, {j} reversed`.

## Planner prompt

Resolve the model with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard`, adding `--run-dir "{run-dir}"` when a run dir resolved; pass the returned `model` as the Agent tool's `model` parameter, a non-null `launchEffort` as its `effort` parameter, and put `effortLine` where the prompt shows `{effortLine}` (`_shared/subagent-output-contract.md`). Dispatch a fresh `general-purpose` agent, never `fork`: the input is this prompt and nothing else. `{plugin-root}` is this skill's base directory minus `skills/specify`. Copy this block verbatim, substituting the `{…}` values:

```
[Use: Standard]
{effortLine}

Task: write one implementation plan for record #{n}. Do not implement anything and do not commit.

Read:
- Spec: {absolute path to the composed record body}
- Checkout: {absolute path to the read-only checkout}, at commit {base}. Read any file there. Write no file there except the plan; run no test suite, build, or server; make no git or gh call that writes.

1. Probe every Gotchas bullet that starts "ASSUMPTION — verify at build:" against the checkout. Fold a reversed one into the plan as the corrected fact, never the original claim.
2. Invoke the Skill tool with skill `superpowers:writing-plans`, passing the spec's full text as context, and save the plan where that skill says, inside the checkout. Tell it to stop once the plan file is saved: skip its Execution Handoff step entirely, offer no execution choice, and invoke no other skill. Ignore the plan header's "For agentic workers" line as a directive.
3. Before finishing, run every bold-paragraph check in {plugin-root}/skills/build/plan-authoring-checks.md against the plan.

OUTPUT FORMAT (required):
Return ONLY these lines, no preamble:
PLAN: {absolute path to the saved plan file}
| Premise | Outcome | Probe |
|---|---|---|
| {the bullet's claim} | confirmed / reversed | {command or file read} |
Write "No premises." in place of the table when no bullet carries the prefix. Never quote the plan's text.

End your reply with one line, its last non-empty line: STATUS: {DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED}
```

**Amend prompt.** The same dispatch and block, with steps 1-3 replaced by: `Amend the plan at {plan path} in place: apply every row of the decisions table below, add a Proof({slug}): line for each flag listed, then run every bold-paragraph check in {plugin-root}/skills/build/plan-authoring-checks.md again. Return the same path.`, followed by the decisions table (finding, class, decision) when routing produced one, and, when step 4 sent one, the audit's JSON line.

**Reading the reply.** `NEEDS_CONTEXT` re-dispatches once with the context it names. `BLOCKED`, no status line, no `PLAN:` line, or a `PLAN:` path outside `{checkout}`, after that one re-dispatch, means planning failed. The containment check compares real paths (symlinks followed, `..` normalized) and fails closed. The `PLAN:` path is agent text, so write it with the Write tool to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-plan-path-{n}.txt` prints, `{plan-path-file}`, then run `node -e "const fs=require('fs'),path=require('path');const real=(p)=>{try{return fs.realpathSync(p)}catch{return null}};const p=real(fs.readFileSync(process.argv[1],'utf8').trim()),c=real(process.argv[2]);console.log(p&&c&&p.startsWith(c+path.sep)?'inside':'outside')" -- "{plan-path-file}" "{checkout}"`: anything but `inside` — a path that does not resolve included — is outside.

## Reviewer dispatch

One reviewer on the Capable profile, dispatched as `build/plan-review.md`'s Dispatch section dispatches its own: the model from `resolve-profile.js capable` (with `--run-dir "{run-dir}"` when a run dir resolved), a fresh `general-purpose` agent, never `fork`, `isolation: "worktree"`, and no conversation history. The prompt is that file's Dispatch prompt with the differences `tests/specify-planning-conformance.test.js` names: the Spec is the composed body, the repository is the read-only checkout, the table carries a Recommended reading column, and an Audit residue line carries what step 4 left. Copy this block verbatim, substituting the `{…}` paths and `{effortLine}`; fill the Audit residue line's placeholder from step 4's last audit JSON (its `checkE.uncovered` and `checkF.unlisted` items, or `none`), and fill it with `none` on a held re-review, which skips step 4 and has no audit JSON:

```
[Use: Capable]
{effortLine}

Task: review one implementation plan against its spec, once, before any task is built. Read-only.

Read:
- Spec: {absolute path to the composed record body}
- Plan: {absolute path to the plan file}
- Audit residue: {the uncovered acceptance clauses and unlisted spec paths plan-audit.js still reports, one per line, or "none"} — treat each as a candidate finding.
You may also read any file in the repository at {absolute path to the read-only checkout}, read-only, to check what the plan integrates with. Do not create, modify, or delete any file; run no test suite, build, or server; make no git or gh call that writes.

Find five classes of problem, and only these:
- spec gap — the spec does not decide something the plan must decide (a value, a rule, a precedence, what happens on failure).
- undecided behaviour — an input class, failure mode, or UI state no task covers. If covering it needs a product decision the spec does not make, report it as a spec gap instead.
- cross-task contract — one task produces something another consumes (a name, a shape, an order, a file, a flag) and the two disagree or the producer is missing, or a task disagrees with the spec about it.
- missing-review-risk (#3378) — a task whose own text touches concurrency (locks, queues, async ordering, retries, transactions, shared mutable state), decision logic (branching on computed state such as permissions, eligibility, pricing, or ranking), or rendering-heavy UI (many states, layout, animation), but carries no `**Review risk:** high` line. Evidence names the signal: "touches {signal} without `Review risk: high`".
- mischaracterized-role (#3378) — a task marked `**Role:** transcription` whose own plan text does not already contain the complete code to write (a signature-plus-tests task, or one left for the implementer to derive, is `integration`, not `transcription` — `build/plan-authoring-checks.md`'s Per-task role/review-risk markers paragraph). Evidence quotes the task's own Step 1/Step 3 text showing the gap.

Do not repeat SDD's pre-flight conflict table. That scan runs later and already checks plan-internal contradictions — a task against the plan's Global Constraints, or a step the plan mandates that the review rubric forbids (example: Global Constraints say "no new dependencies" and Task 4 adds one). Your cross-task class is producer/consumer agreement between tasks, and each task against the spec (example: Task 2 returns `{ok, value}` and Task 5 reads `.result`).

For every spec-gap row, set Resolution:
- intent-resolvable — only when you can quote a spec sentence that settles it; put that sentence in Evidence. No quotable sentence means needs-human.
- needs-human — whenever settling it would alter or loosen an existing Acceptance Criterion or an observable contract, or it has two defensible readings.
Write "—" in Resolution on every other row.
On a needs-human row, Suggested resolution names both defensible readings: "Reading A: … / Reading B: …" (for a criterion change, Reading A keeps the criterion as written).
On a needs-human row, set Recommended reading to "Reading A" or "Reading B": the one that keeps every Acceptance Criterion and recorded decision and sits closer to the spec's stated intent, or "Reading A" when neither keeps them all. Write "—" in Recommended reading on every other row.

OUTPUT FORMAT (required):
Return ONLY a markdown table, no preamble:

| Severity | Class | Resolution | Recommended reading | Path:Line | Finding | Evidence | Suggested resolution |
|---|---|---|---|---|---|---|---|
| high | spec gap | intent-resolvable | — | work/42-spec.md:31 | Retry count on a 429 is unset | Spec: "Retries follow the existing gh policy." | Add: "A 429 retries per _shared/github-rate-limit.md." |
| medium | cross-task contract | — | — | docs/superpowers/plans/{plan}.md:120 | Task 2 returns `{ok, value}`; Task 5 reads `.result` | Task 2 Interfaces vs Task 5 Step 3 | Task 5 reads `.value` |

Class: spec gap / undecided behaviour / cross-task contract / missing-review-risk / mischaracterized-role
Severity scale: critical / high / medium / low / info
If no findings: return literal text "No findings."
Return at most 7 rows, needs-human rows first, then highest severity first; if more were found, append a final row reading "+N more" with the count in place of N — never omit this row when findings exceed the cap.
Do not add narration, headers, or summaries before or after the table.

End your reply with one line, its last non-empty line: STATUS: {DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED}
```

**Reading the reply** follows `build/plan-review.md`'s Reading the reply for `NEEDS_CONTEXT`, an unusable reply, `No findings.`, a `+N more` row, and the rule that promotes a spec-gap row to needs-human (a row whose Class is none of the five is logged only, like a `low` row), except that an unusable reply after the one re-dispatch means planning failed (`## Per-record step`) and every log line is this file's, never that file's `/build` entries. A table whose header lacks the Recommended reading column is unusable.

## Routing

Route every parsed row by its Class and Resolution, never on Severity:

- **`low` and `info` rows** of the four amendment classes amend nothing; they are counted in the Detail and logged. That rule governs amendments only: a needs-human row is routed below at any severity, `low` and `info` included.
- **Undecided behaviour, cross-task contract, missing-review-risk and mischaracterized-role rows** become plan amendments for step 7.
- **An intent-resolvable spec-gap row** whose Evidence sentence appears verbatim in `{body}` adds one line under `## Planning Decisions` quoting that sentence, as `build/plan-review.md`'s intent-resolvable sequence writes its clarification line.
- **Every needs-human row**, the reviewer's or one promoted, is classified against `_shared/planning-decisions.md`'s `## Asked classes` and `## Doubt rule`. The kept flags are `{body}`'s `Risk-flags:` line; the declared categories are read as `build/plan-review-asked-classes.md`'s Routing step 1 reads them. A row a recorded decision already answers takes `## Line forms`' answered-round rule: a `Decided by the user at planning:` line, never asked; it is handled as `build/plan-review-asked-classes.md`'s Routing step 2 handles it, with that step's definition of a recorded decision, under which `Decided by the user at plan review:` lines, `Decided by the user at planning:` lines, `**Decision**` paragraphs and Closed rules all count as recorded decisions; the substitution applies only to the line this step writes (`Decided by the user at planning:`) and to its log entries (this file's, never `/build`'s). That handling includes the `risk-flags.js add` and `Proof({slug}):` amendment when the answered row is class (b) and its category is not yet flagged. A row outside the asked classes takes `## Settled path`: a `Settled at planning:` line, never asked, in every posture. An unanswered class (b) row whose category `{body}` does not flag first gets `node "${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" add --body-file "{body}" --add {slug}` and a `Proof({slug}):` amendment for step 7; a non-zero exit still asks that row (a failed `add` on an answered row asks nothing). A row whose two readings cannot be written from its Suggested resolution and `{body}` is unclassifiable: it is asked, or held when headless.

**Asking.** Headless means no human is reachable, as `shaping-mode-stamping.md`'s `### Risk flags` step 2 defines it: a headless run asks nothing and takes `## Hold` for every asked row. `auto` alone does not make a run headless: that step's "`auto` takes step 4" sentence governs only its own stop, and a run in `auto` with a reachable human still asks, because these questions are build's plan-review needs-human gate moved to specify time. Otherwise render one batch table with columns `Record`, `Finding`, `Class`, `Recommended reading`, then ask per `_shared/planning-decisions.md`'s `## Asking`: one `AskUserQuestion` per question set, at most four questions per call, one call per message, each question's options the recommended reading first, labelled `(Recommended)`, then the other reading, then `Leave for later`. The recommended reading is the one `## Asking` names; the reviewer's Recommended reading cell is its input, never the verdict. Each question is asked once. An answer is written `Decided by the user at planning: {finding} — chose {reading}; not {other reading}`. `Leave for later` on any question, or a call that errors, times out or is auto-answered, takes `## Hold` for every question of that record not yet answered.

**Writing the lines.** Every `Settled at planning:`, `Decided by the user at planning:` and intent-resolvable line goes under one `## Planning Decisions` section of `{body}`, placed as step 1 says; the section never edits an existing criterion's line. A planned record always carries the section: with no line to write, it holds the one line `No planning questions arose.`

## Hold

A held record is written the same way, with its settled lines, its decided lines and its plan stored (steps 7-8 run on what was settled), and is left without `ready`. In Compose-then-write-once's call: omit `--add-label ready`, add `--remove-label ready` when the record carries it, add `--add-label "needs:decision"` (bootstrap it per `_shared/label-bootstrap.md`), and omit `--remove-label "needs:decision"`; older decision comments are still resolved first, as that file's `needs:*` bullet says. Once the edit lands, post the comment below through `_shared/github-write-transport.md`: write it with the Write tool to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-hold-{n}.md` prints, then run `gh issue comment {n} --body-file "{path}"`, or post it with `add_issue_comment` when `gh` is absent. A failed post renders the record's row `failed — hold comment not posted ({reason}); re-run /claude-tweaks:specify #{n}`, because `shaping-mode-stamping.md`'s `needs:*` bullet clears the label a failed post leaves behind. A hold entered via bare drain keeps the `shaped:headless` stamp: add `--add-label "shaped:headless"` to the same call, as `shaping-mode-readback.md` expects it on every bare-drain-shaped record. The comment is `_shared/work-record.md`'s canonical decision comment, `{unit}` = `specify`:

```
<!-- needs-decision: specify -->
## Decision needed
**Proposed:** {Q1: recommended reading; Q2: recommended reading; …}
**Why:** planning at /claude-tweaks:specify held {k} question(s) that need a human
**Command:** `/claude-tweaks:specify #{n}`
Held-by: specify-planning
<!-- held-questions:start -->
- Question: {question text}
  Option: {recommended reading}
  Option: {other reading}
  Recommended: {recommended reading}
<!-- held-questions:end -->
```

### Held-questions schema

The block is the contract a later reader parses (#6059); `tests/specify-planning-conformance.test.js` pins the template above and these rules to the same strings.

- `Held-by: specify-planning` sits on the line directly above the block and marks the comment as this step's hold.
- The block opens with `<!-- held-questions:start -->` and closes with `<!-- held-questions:end -->`, each on its own line.
- Each held question is one `- Question: ` line followed by exactly two `  Option: ` lines, the recommended reading first, and one `  Recommended: ` line, in the order the questions would have been asked.
- Every value is one line: a newline inside reviewer text becomes a space. Values quote the body, the plan and the finding with repo-relative paths, never a local absolute path.

**Re-running.** `/claude-tweaks:specify #{n}` re-shapes a held record: `shaping-mode-stamping.md`'s `needs:*` bullet resolves the hold comment and removes the label, and the held questions are asked again unless a `**Decision**` paragraph on the body now answers them (`_shared/planning-decisions.md`'s `## Line forms` answered round).

## Batches

A comma list or range defers every record's write: the per-record loop runs each record through Compose-then-write-once up to the point `## Per-record step` names, copies `{body}` to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-plan-body-{n}.md` prints, and moves on; that copy is the record's `{body}` from then on. Once every record is there, run the lane predicate per record, then the reuse check per record (`## Which records are planned`): a record with a valid stored plan skips the planner fan-out, and a held one has its stored plan fetched (`## Which records are planned`) and joins the reviewer fan-out. Then run steps 1-3 for every record still to be planned, with the planners dispatched in one message (one `Agent` call each), step 4 per record, step 5 with the reviewers dispatched in one message, and step 6 with one batch table and the chunked questions covering every record's asked rows together. A hold is per record; the rest of the batch proceeds. Each record then finishes steps 7-9 and its read-back, in list order. These dispatches are shaping mode's one fan-out, each under `_shared/subagent-output-contract.md`; `SKILL.md`'s "a loop never a fan-out" still governs the record writes.

## Decomposition

Called by `decomposition-mode-closeout.md`'s `plan-at-specify` paragraph, in specify's own session, never inside `mechanical-handoff.md`'s subagent: planning dispatches agents and may ask a human. Its input is every non-parent sub-issue Step 3 created this run, told apart by the re-fetched labels: a record carrying the `parent-issue` label is never planned and gets no outcome row. A sub-issue Step 3 resumed rather than created is not planned this pass: it gets no outcome row, and `/claude-tweaks:specify #{n}` re-shapes and plans it, because decomposition mode has no `needs:*` resolve for an earlier hold. The origin-set carve-out's in-place write onto `$ORIGIN_RECORD_NUM` (`record-creation-subissues.md`) counts as created this run, so that unit is planned. A sub-issue Step 5 left with a staged finding is planned too: its `ready` stays cleared, and resolving the finding later changes the body, so `plan-store.js check`'s spec hash makes the next shape or build re-plan rather than reuse the stale plan.

1. **Body.** Planning reads what the forge holds: re-fetch each sub-issue's body and labels from the forge (`gh issue view {n} --json body,labels`, or `issue_read` when `gh` is absent) after Step 6, or after the handoff returns, so Step 5's red-team edits are in the body the planner and reviewer read. Write the body with the Write tool to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-plan-body-{n}.md` prints; that file is the record's `{body}`. The lane file's labels are the re-fetched labels as they stand, since Step 3 already stamped them.
2. **Run.** Then run, as `## Batches` runs them, the hold-state capture, the lane predicate and the reuse check (`## Which records are planned`), then `## Per-record step`'s steps 1-8 for each sub-issue still to be planned, with one batch table and one set of chunked questions covering every sub-issue. `## Routing`'s Asking governs the questions. With no human reachable (`/sweep`'s specify drain, a Routine), the question batch is not asked: Asking's headless rule sends every asked row to `## Hold`.
3. **Write.** In place of step 9 and Compose-then-write-once's write, make one more body write per sub-issue, `gh issue edit {n} --body-file "{body}"`, or `issue_write` (update mode) when `gh` is absent, per `_shared/github-write-transport.md`. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-record.js" --check "{body}"` first, as `shaping-mode-stamping.md`'s Compose-then-write-once runs it: a non-zero exit writes nothing for that sub-issue and is a failed body write, Detail `write failed: pre-write shape check ({reason})`, `{reason}` that section's gap lines or stderr. A `skipped` sub-issue is written only to remove a `Plan:` line, otherwise not at all: that write sends the forge body re-fetched just before it with only its `Plan:` line removed, never `{body}`, which after a planning failure already carries the `## Overview` that `## Per-record step`'s step 1 inserted; write that body as step 1 above writes `{body}`, to `specify-plan-unplan-{n}.md`. A held sub-issue then, as a separate call after it lands, gets `gh issue edit {n}` with `--remove-label ready --add-label "needs:decision"` (bootstrap `needs:decision` per `_shared/label-bootstrap.md`; drop `--remove-label ready` when the sub-issue does not carry it), then `## Hold`'s comment. A held sibling does not hold the sub-issues that depend on it: each is written on its own outcome. Planning never adds `ready`: a sub-issue Step 5 left without it stays without it.
4. **Read-back** per `## Read-back and outcome`'s Planned and Held bullets, without the Held bullet's `shaped:headless` assertion, since decomposition never stamps it. A read-back mismatch is `skipped`, Detail `read-back failed: {reason}`. Step 4 also applies that section's Next Actions rule: a held sub-issue is left out of every `/claude-tweaks:flow` command `next-actions.md`'s decomposition rows render, and when every planned sub-issue is held, the recommended line is `/claude-tweaks:specify #{n}` for the first held one. Logging (above) applies unchanged.

Each sub-issue planned or not gets one of four outcomes:

- `planned` — a `Plan:` line was stored, or a valid stored one kept.
- `held` — an asked-class question is unanswered, `## Per-record step`'s held planning failure included.
- A sub-issue a plan-less lane took is `skipped`, Detail `{lane} lane ({reason})`. A planning failure is `skipped`, Detail `planning failed: {reason}`. A failed body write is `skipped`, Detail `write failed: {reason}`.
- `no-ref` — `plan-store.js write` exited non-zero.

The other rows: a held sub-issue whose comment post fails takes `## Hold`'s `failed — hold comment not posted ({reason}); re-run /claude-tweaks:specify #{n}` row. A failed label call takes the same row. A held sub-issue whose body write fails, its shape check included, takes `failed — body write failed ({reason}); re-run /claude-tweaks:specify #{n}`, and one whose read-back fails takes `failed — read-back failed ({reason}); re-run /claude-tweaks:specify #{n}`, in place of `skipped`, so the re-run asks its held questions again.

Step 9 renders them as a `### Planning` section, `| Record | Outcome | Detail |`, one row per sub-issue.

## Read-back and outcome

Read from `shaping-mode-readback.md`'s `plan-at-specify` block, per record:

- **Planned:** the re-fetched body carries `## Overview` and `## Planning Decisions` and exactly one `Plan:` line, equal to the `line` `plan-store.js write` printed, or to the kept line when a valid stored plan was reused without a write; a record planned with the no-ref outcome (exit 3 or any other non-zero exit, per step 8) carries no `Plan:` line.
- **Held:** the hold comment is posted before this read-back runs, and a held record is re-fetched with `gh issue view {n} --json labels,body,comments` in place of that file's `labels,body` fetch. The re-fetched body carries `## Overview` and `## Planning Decisions`, and exactly one `Plan:` line equal to the `line` `plan-store.js write` printed, except that it carries no `Plan:` line when `plan-store.js` took the no-ref outcome (exit 3 or any other non-zero exit, per step 8). `ready` is absent and `needs:decision` present, in place of that file's `ready`-present and no-`needs:*` assertions (its scoring-label assertions still apply), and the newest unresolved decision comment from a trusted author (filtered as `shaping-mode-stamping.md`'s `needs:*` bullet filters them) carries `Held-by: specify-planning`. A hold entered via bare drain also carries `shaped:headless`, which `## Hold` stamps and that file's first bullet still asserts.
- **Not planned:** no `Plan:` line was written this pass.

In Actions Performed, a planned or not-planned record keeps the `shaped` outcome, its Detail adding `planned (Plan: {short commit})`, `planned, no Plan: line: …` or `not planned: …`; a held record's outcome is `held — needs:decision ({k} planning question(s))`. A held record is never in a `/claude-tweaks:flow` command `SKILL.md`'s Next Actions renders; when every record is held, the recommended line is `/claude-tweaks:specify #{n}` for the first held record. Under `--chained` and bare drain the held outcome is the returned or reported outcome, and bare drain's Release reason stays `shaped: #{n}`.
