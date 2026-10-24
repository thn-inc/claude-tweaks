# Common Step 1.6 — Plan Review

One dispatched Capable reviewer reads the materialized spec and the plan once, before any code is written, and returns findings in three classes: spec gaps (the spec does not decide something the plan must decide), undecided behaviour (an input class, failure mode, or UI state no task covers), and cross-task contract disagreements (one task produces what another consumes, and the two disagree). In #3229's measured build, 3 of the 5 Important findings from the final whole-branch review were exactly these — spec or plan gaps found after all the code existed, fixed in an 18-minute wave plus a re-review. This step moves that catch to before Task 1. The reviewer is read-only; this session (the controller) routes each finding.

**Skip condition lives in `build/SKILL.md`'s Common Step 1.6 stub, not here** (the re-read cut: deciding skip-vs-run never loads this file). This file loads only once the step is confirmed to run.

**A resumed build** (a still-valid plan, `build/SKILL.md` Spec Step 2) re-runs this review unless this run already recorded a completed one and neither the spec nor the plan changed after it — the decision lives in that resume branch, for the same re-read-cut reason. A review is once per plan, not once per session: a resume that already passed it does not ask the same questions twice.

**Not SDD's pre-flight scan.** `/superpowers:subagent-driven-development` scans the plan for conflicts before its own Task 1 and writes the result to its ledger; that scan runs later, unchanged. This step never tells SDD to skip or alter its scan, and the reviewer's brief tells it not to repeat that scan's conflict table.

## Inputs

- **Spec** — this build's materialized `work/{n}-spec.md` **in the worktree's copy** (worktree mode; `flow/materialize.md`: `work/` is the tracked exception that stays in the worktree). Never `"$PIPELINE_RUN_DIR"/work/…` — that path resolves to the main checkout, which holds no `work/` until merge, so reading or amending it touches nothing later phases read (`[IL-127]`, the shadow-copy hazard). In `current-branch` mode the two are the same file.
- **Plan** — the plan file Spec Step 3 wrote (or Spec Step 2 kept).

Both go to the reviewer as absolute paths.

## Dispatch

One reviewer on the Capable profile, under the Subagent Contract (`_shared/subagent-output-contract.md`, `_shared/subagent-dispatch-core.md`'s Model Selection section). Resolve the model mechanically:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable --run-dir "$PIPELINE_RUN_DIR"
```

Omit `--run-dir` when no run directory resolves; append `--unattended` when `DISPATCH_HEADLESS=1` was set on this Task call's invocation (`dispatch/task-prompt.md`'s first call). Pass the returned `model` value as the Agent tool's `model` parameter explicitly, and put the returned `effortLine` in the prompt where the template below shows `{effortLine}`. Dispatch a fresh `general-purpose` agent, never `fork` — a fork carries this conversation, and the reviewer's independence is the point. Pass `isolation: "worktree"` on the Agent call (`_shared/fork-worktree-isolation.md`'s mandate for a read-only dispatch): the reviewer reads the live spec and plan by the absolute paths in its prompt, so the throwaway copy only guards against a stray write. It stays Capable under `profile=frontier` too: Frontier is reserved for the contract-enumerated singleton slots, and this is not one. The input is the prompt below and nothing else — no conversation history.

## Dispatch prompt

Copy this block verbatim into the prompt, substituting the three `{…}` paths and `{effortLine}`:

```
[Use: Capable]
{effortLine}

Task: review one implementation plan against its spec, once, before any task is built. Read-only.

Read:
- Spec: {absolute path to the worktree's work/{n}-spec.md}
- Plan: {absolute path to the plan file}
You may also read any file in the repository at {absolute worktree root}, read-only, to check what the plan integrates with. Do not create, modify, or delete any file; run no test suite, build, or server; make no git or gh call that writes.

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

OUTPUT FORMAT (required):
Return ONLY a markdown table, no preamble:

| Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |
|---|---|---|---|---|---|---|
| high | spec gap | intent-resolvable | work/42-spec.md:31 | Retry count on a 429 is unset | Spec: "Retries follow the existing gh policy." | Add: "A 429 retries per _shared/github-rate-limit.md." |
| medium | cross-task contract | — | docs/superpowers/plans/{plan}.md:120 | Task 2 returns `{ok, value}`; Task 5 reads `.result` | Task 2 Interfaces vs Task 5 Step 3 | Task 5 reads `.value` |

Class: spec gap / undecided behaviour / cross-task contract / missing-review-risk / mischaracterized-role
Severity scale: critical / high / medium / low / info
If no findings: return literal text "No findings."
Return at most 7 rows, needs-human rows first, then highest severity first; if more were found, append a final row reading "+N more" with the count in place of N — never omit this row when findings exceed the cap.
Do not add narration, headers, or summaries before or after the table.

End your reply with one line, its last non-empty line: STATUS: {DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED}
```

## Reading the reply

- **`NEEDS_CONTEXT`** — re-dispatch once, adding the context it names; a second `NEEDS_CONTEXT` is treated as `BLOCKED` below.
- **`BLOCKED`, no status line, or a table that does not parse** (after that one re-dispatch) — the review is unavailable. Log `SKIP` (`--text "condition: plan reviewer returned {word|no parseable reply} → fallback: build proceeds without a plan review"`, same command shape as the Skip logging section below) and continue to Common Step 1.7. An unusable reply is never read as "No findings." — a review that did not happen is not a clean review.
- **`No findings.`** — log `SCANNED` (`--text "plan review: no findings"`, same command shape) and continue.
- **A table** — route each row by its Class and Resolution, never on Severity; `low` and `info` findings are logged only and amend nothing (they ride in the `AUTO` entry's text, or, when every row is `low`/`info`, in one `SCANNED` entry naming the count). That rule governs amendments only: a `needs-human` spec-gap row triggers the HARD-GATE at any severity, `low` and `info` included. A spec-gap row is treated as `needs-human` when its Resolution is anything other than the two defined values, or when it is marked `intent-resolvable` and its Evidence quotes no spec sentence or quotes one that does not appear verbatim in the worktree's `work/{n}-spec.md` (grep it before amending — a paraphrase is not a quote) — the burden of proof is on the quote. `missing-review-risk` and `mischaracterized-role` (#3378) never trigger the HARD-GATE — they route as plan amendments, same as `undecided behaviour`/`cross-task contract` below, regardless of severity. A row whose Class is none of the five is logged only, like a `low` row. A row promoted to `needs-human` here carries no Reading A / Reading B from the reviewer: write the two readings yourself from its Suggested resolution and the unamended spec text. A `+N more` row routes nothing; carry its count into the log text.

## Handling by class

When a reply carries needs-human rows beside others, settle the needs-human set first (last subsection). A present human's answers then join the other rows in one amendment sequence — one commit, one log line, one comment, one re-audit. A dispatched call or parallel-wave member that blocks applies nothing; the next build reviews the answered record afresh.

Failure paths. A failed `git commit` stops the sequence before its log line and comment: nothing is logged or posted for an amendment that is not committed, and the failure is reported to the caller. A failed record comment is logged `SKIP` (`--text "condition: plan-review record comment failed ({reason}) → fallback: the committed clarification section is the trail"`) and does not stop the step; the committed `## Plan Review Clarifications` section is still the trail. Every comment this step posts is public record text: quotes of the spec and plan and the findings' own text only, with repo-relative paths — never local absolute paths or excerpts of any other file.

### Spec gap — intent-resolvable

In order, before Task 1:

1. **Amend the spec.** Append an additive clarification to the worktree's copy of `work/{n}-spec.md`, under a `## Plan Review Clarifications` section at the end of the file (create it on first use) — one line per finding, each quoting the spec sentence from the row's Evidence that supports it. The amendment never edits or loosens an existing Acceptance Criterion; a resolution that would is a needs-human finding, whatever the reviewer's Resolution said.
2. **Amend the plan** for any undecided-behaviour or cross-task-contract rows (next subsection).
3. **Commit.** `git commit` the spec and plan amendments in the same commit — this is what keeps the pair consistent for `SKILL.md`'s Spec Step 2 staleness rule ("has the spec evolved since the plan was written?") on a resumed build.
4. **Log** one `AUTO` entry:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO \
     --section "/build" --step "Common Step 1.6 (plan review)" \
     --text "amended {spec|plan|spec and plan} for {N} finding(s) ({classes}); commit {sha}" --reversibility high
   ```

5. **Comment on the record.** Post the spec amendment as one comment on the record. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PLAN_REVIEW_BODY=plan-review-amendment-{n}.md` once and take the literal path it prints as `PLAN_REVIEW_BODY="<path>"` — the path inside the quotes (a shell variable would not survive into a later Bash call, and the Write tool needs a literal path). Write the body to that path with the Write tool — first line `<!-- plan-review-amendment -->`, then the clarification lines as committed — and pass the same literal path to `gh issue comment {n} --body-file "{path}"`, or post the body with `add_issue_comment` per `_shared/github-write-transport.md` when `gh` is absent. The record's history carries the amendment this way. Under `work-backend: local-files` there is no GitHub issue to comment on: skip the comment — the committed `## Plan Review Clarifications` section is the trail.
6. **Re-audit once.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" {plan-file} --spec {spec-file}` on the amended pair and act on its result per `plan-audit.md` (Checks A, C, D, headroom, and Check E against the amended spec).

`gh issue edit` never runs against the live record, and nothing is staged for the Review Console: the amended in-run spec is the one `/claude-tweaks:test`, `/claude-tweaks:review` and `/claude-tweaks:wrap-up` judge against, so there is no staged item to apply, decline, or leave unreached. The plan review itself never re-runs, so the step cannot loop.

### Undecided behaviour, cross-task contract, missing-review-risk, mischaracterized-role

Amend the plan file — a task step, a test, an Interfaces line, or (for the two #3378 classes) the task's own `**Review risk:** high` line (add it) or `**Role:**` line (correct it to `integration` or `judgment` per the finding's Evidence) — commit, log the same `AUTO` entry, and re-run `plan-audit.js` once as above (pass `--task-markers` too when either #3378 class fired, so the corrected markers are confirmed before dispatch). When a spec-gap amendment also exists, these share its single commit, log line, and audit re-run. No record comment: the plan is not the record's contract.

### Spec gap — needs-human

The HARD-GATE: this plan-review needs-human spec gap is registered in `_shared/auto-mode-contract.md`'s HARD-GATE / BLOCKED / STOP row — a deliberate stop before Task 1 that `auto` never silences. Every needs-human finding in the reply is handled together, as one question set. Branch on whether this session can ask — it cannot when the call is dispatched or is a `parallel`-wave member, and **it cannot whenever `AskUserQuestion` is not a tool this session holds** (a Task subagent has none): that session takes the dispatched-call branch below even when the `run-state.json` read below came back empty, because an unreadable marker must not send a subagent to a question it cannot ask. A dispatched Task call is identified the way `flow/SKILL.md` Step 1 rung 2 identifies it — `run-state.json` carrying `dispatched: true` (that rung's fail-open read) — read from `${MULTISPEC_PARENT_DIR:-$PIPELINE_RUN_DIR}/run-state.json`: in a multi-spec run `$PIPELINE_RUN_DIR` is the per-spec `{parent}/spec-{N}/`, which holds no `run-state.json`, and `MULTISPEC_PARENT_DIR` is the parent run directory `/flow` exports (`flow/multi-spec.md`). A `parallel`-wave member carries `MULTISPEC_PARALLEL_WAVE=1` and always runs inside an `Agent` subagent (`flow/multispec-parallel-waves.md`).

- **Someone is present in this session** (no `dispatched: true`, no `MULTISPEC_PARALLEL_WAVE=1`, and `AskUserQuestion` available) — in every mode, `auto` included. Stop for the human:

  <!-- HARD-GATE: plan-review-needs-human -->

  Then one `AskUserQuestion` call holding every needs-human finding (up to four questions per call — a fifth and later go in a follow-up call; header `Plan review`; options per question: the two readings the finding's Suggested resolution names, `Reading A: …` and `Reading B: …`, plus `Stop the build`). Log `KEPT-PROMPT` — `_shared/auto-decision-log.md`'s Status semantics table gives `KEPT-PROMPT` to an item on the not-silenced list:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status KEPT-PROMPT \
    --section "/build" --step "Common Step 1.6 (plan review)" \
    --text "plan review: {N} needs-human spec gap(s) asked inline" --reversibility n/a
  ```

  An answer is the human's decision: apply it through the intent-resolvable sequence above. It may refine a criterion — still appended under `## Plan Review Clarifications`, never by editing the criterion's own line — attributed `Decided by the user at plan review:` in the clarification and the comment. `Stop the build` stops with the HARD-GATE failure `plan-review-needs-human` (`failed: plan-review-needs-human`).
- **A dispatched call** (`dispatched: true`) — the Task subagent cannot call `AskUserQuestion`. Post the question set as one comment on the record, over the same transport as the intent-resolvable step's comment (body via session-tmp file, `gh issue comment --body-file`, or `add_issue_comment` when `gh` is absent): first line `<!-- plan-review-question -->`, then each finding with its Evidence and Suggested resolution, then the instruction to answer by editing the record's body — the next build materializes the body, not comments. Also put the question set in the `BLOCKED` reply itself, so a failed post or label write still reaches the dispatching session; report such a failure there as a concern, never as silence. Under `work-backend: local-files` this branch is unreachable — `/claude-tweaks:dispatch` is GitHub-only — so no question comment is posted there. The build releases no claim itself: Settle (steps 1-2) releases the claim (`dispatch/settle-and-merge.md`'s Plan-review special case), against the group run directory the claim is keyed to.

  When `DISPATCH_HEADLESS=1` was set on this Task call's invocation, also: bootstrap `bot:blocked` per `_shared/label-bootstrap.md`, add it, and remove whichever of `auto:build`, `auto:merge`, `auto:merge-pending` is present — read live labels first (`gh issue view {n} --json labels`), as Settle step 3 does; on the MCP transport, read-merge-write via `mergeLabelNames` (`bin/lib/issues/label-write.js`) per `_shared/github-write-transport.md`'s Full-replace hazard — and send a `PushNotification` ("Record #{n} needs a human decision before it can build: {first question}"). No retry-ceiling count: this gate blocks on its first occurrence. Without `DISPATCH_HEADLESS=1` the human is at the dispatching session: the labels stay, and the dispatching session relays the question (`dispatch/reporting.md`). Either way, stop with the HARD-GATE failure `plan-review-needs-human`; the first call reports `OUTCOME: build-test-blocked`, `ISSUE #{n}: failed:plan-review-needs-human`, and `STATUS: BLOCKED`.
- **A `parallel`-wave member** (`MULTISPEC_PARALLEL_WAVE=1`, no `dispatched: true`) — the member subagent cannot call `AskUserQuestion` either. Post the same `<!-- plan-review-question -->` comment (none under `work-backend: local-files`, which has no issue to carry it — the question is asked when the record next builds with someone present), stop with the HARD-GATE failure `plan-review-needs-human`, and report it to the wave orchestrator as `OUTCOME: hard-gate-failed` (the member prompt's report in `flow/multispec-parallel-waves.md`). The orchestrating `/flow`, where the human is present, surfaces it through its ordinary Failure handling and failure card. No label change and no claim release here: that card offers the release.
- **Exit state (dispatched call)** — the claim is released (by the dispatching session's Settle, steps 1-2 — never by the build), nothing is merged, and the run reports `BLOCKED` with the question to its caller. The gate itself tears nothing down and closes no PR: the gate leaves the worktree and draft PR in place, and the pushed branch and the draft PR stay after the run ends. The dispatching session's ordinary first-call-failure teardown (`dispatch/two-call-gate.md` §5) later removes the local worktree, as for every first-call failure — the resume re-materializes from the record and needs no local state. **Resume:** a human answers on the record, re-grants `auto:build` at `/claude-tweaks:backlog refine` when the headless block removed it, and the next dispatch re-materializes the spec from the answered record. (The present-human branch releases no claim — nor does the parallel-wave member branch — and has no dispatch resume: its stop is the caller's ordinary HARD-GATE stop, whose failure card offers a release and never auto-releases — `flow/failure-cards.md`.)

## Standalone /build

With no `$PIPELINE_RUN_DIR` (no run directory resolves, so no `config.yml`), the step still runs and still amends the spec and plan, commits, re-audits, and posts the record comment — with no decision-log write. List each amendment in the Step 7 handoff's `### Plan review amendments (standalone build, if any)` section (`handoff-template.md`) instead.

## Skip logging

When the `SKILL.md` stub's gate fires (`ceremony-profile=fast-lane` — roster tag `plan-review` — or a trivial plan), or Spec Step 2's resume branch skips a plan already reviewed, write one `SKIP` entry:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP \
  --section "/build" --step "Common Step 1.6 (plan review)" \
  --text "condition: {ceremony-profile=fast-lane (roster tag plan-review) | trivial plan: fewer than 3 file references and no Scope keywords: | resumed build: plan already reviewed this run, spec and plan unchanged since} → fallback: no plan review" --reversibility n/a
```

Standalone `/build` (no run dir): list the skip in the Step 7 handoff instead (`handoff-template.md`'s inline-skip listing).
