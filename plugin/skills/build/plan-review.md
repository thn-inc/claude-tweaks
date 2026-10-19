# Common Step 1.6 — Plan Review

One dispatched Capable reviewer reads the materialized spec and the plan once, before any code is written, and returns findings in three classes: spec gaps (the spec does not decide something the plan must decide), undecided behaviour (an input class, failure mode, or UI state no task covers), and cross-task contract disagreements (one task produces what another consumes, and the two disagree). In #3229's measured build, 3 of the 5 Important findings from the final whole-branch review were exactly these — spec or plan gaps found after all the code existed, fixed in an 18-minute wave plus a re-review. This step moves that catch to before Task 1. The reviewer is read-only; this session (the controller) routes each finding.

**Skip condition lives in `build/SKILL.md`'s Common Step 1.6 stub, not here** (the re-read cut: deciding skip-vs-run never loads this file). This file loads only once the step is confirmed to run.

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

Omit `--run-dir` when no run directory resolves; append `--unattended` when `DISPATCH_HEADLESS=1` was set on this Task call's invocation (`dispatch/task-prompt.md`'s first call). Pass the returned `model` value as the Agent tool's `model` parameter explicitly, and put the returned `effortLine` in the prompt where the template below shows `{effortLine}`. Dispatch a fresh `general-purpose` agent, never `fork` — a fork carries this conversation, and the reviewer's independence is the point. It stays Capable under `profile=frontier` too: Frontier is reserved for the contract-enumerated singleton slots, and this is not one. The input is the prompt below and nothing else — no conversation history.

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
| medium | cross-task contract | — | docs/superpowers/plans/{plan}.md:120 | Task 2 returns `{ok, value}`; Task 5 reads `.result` | Task 2 Interfaces vs Task 5 Step 3 | Task 5 reads `.value` |

Class: spec gap / undecided behaviour / cross-task contract
Severity scale: critical / high / medium / low / info
If no findings: return literal text "No findings."
Return at most 7 rows, highest severity first; if more were found, append a final row reading "+N more" with the count in place of N — never omit this row when findings exceed the cap.
Do not add narration, headers, or summaries before or after the table.

End your reply with one line, its last non-empty line: STATUS: {DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED}
```

## Reading the reply

- **`NEEDS_CONTEXT`** — re-dispatch once, adding the context it names.
- **`BLOCKED`, no status line, or a table that does not parse** (after that one re-dispatch) — the review is unavailable. Log `SKIP` (`--text "condition: plan reviewer returned {word|no parseable reply} → fallback: build proceeds without a plan review"`, same command shape as the Skip logging section below) and continue to Common Step 1.7. An unusable reply is never read as "No findings." — a review that did not happen is not a clean review.
- **`No findings.`** — log `SCANNED` (`--text "plan review: no findings"`, same command shape) and continue.
- **A table** — route each row by its Class and Resolution, never on Severity; `low` and `info` findings are logged only and amend nothing (they ride in the `AUTO` entry's text, or, when every row is `low`/`info`, in one `SCANNED` entry naming the count). A spec-gap row marked `intent-resolvable` whose Evidence quotes no spec sentence is treated as `needs-human` — the burden of proof is on the quote. A `+N more` row routes nothing; carry its count into the log text.

## Handling by class

When a reply carries needs-human rows beside others, settle the needs-human set first (last subsection). A present human's answers then join the other rows in one amendment sequence — one commit, one log line, one comment, one re-audit. A dispatched call that blocks applies nothing; the next build reviews the answered record afresh.

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

5. **Comment on the record.** Post the spec amendment as one comment on the record: write the body with the Write tool to a path resolved by `bin/session-tmp-resolve.js` (`eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PLAN_REVIEW_BODY=plan-review-amendment-{n}.md)"`), first line `<!-- plan-review-amendment -->`, then the clarification lines as committed; then `gh issue comment {n} --body-file "$PLAN_REVIEW_BODY"`, or `add_issue_comment` per `_shared/github-write-transport.md` when `gh` is absent. The record's history carries the amendment this way.
6. **Re-audit once.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" {plan-file} --spec {spec-file}` on the amended pair and act on its result per `plan-audit.md` (Checks A, C, D, headroom, and Check E against the amended spec).

`gh issue edit` never runs against the live record, and nothing is staged for the Review Console: the amended in-run spec is the one `/claude-tweaks:test`, `/claude-tweaks:review` and `/claude-tweaks:wrap-up` judge against, so there is no staged item to apply, decline, or leave unreached. The plan review itself never re-runs, so the step cannot loop.

### Undecided behaviour and cross-task contract

Amend the plan file — a task step, a test, an Interfaces line — commit, log the same `AUTO` entry, and re-run `plan-audit.js` once as above. When a spec-gap amendment also exists, these share its single commit, log line, and audit re-run. No record comment: the plan is not the record's contract.

### Spec gap — needs-human

The HARD-GATE: this plan-review needs-human spec gap is registered in `_shared/auto-mode-contract.md`'s HARD-GATE / BLOCKED / STOP row — a deliberate stop before Task 1 that `auto` never silences. Every needs-human finding in the reply is handled together, as one question set. Branch on presence; a dispatched Task call is identified the way `flow/SKILL.md` Step 1 rung 2 identifies it — the run directory's `run-state.json` carrying `dispatched: true` (that rung's fail-open read):

- **Someone is present in this session** (no `dispatched: true`) — in every mode, `auto` included. Stop for the human:

  <!-- HARD-GATE: plan-review-needs-human -->

  Then one `AskUserQuestion` call holding every needs-human finding (up to four questions per call — a fifth and later go in a follow-up call; header `Plan review`; options: each finding's Suggested resolution, plus `Stop the build`). Log `KEPT-PROMPT`. An answer is the human's decision: apply it through the intent-resolvable sequence above. It may refine a criterion — still appended under `## Plan Review Clarifications`, never by editing the criterion's own line — attributed `Decided by the user at plan review:` in the clarification and the comment. `Stop the build` stops with the HARD-GATE failure `plan-review-needs-human` (`failed: plan-review-needs-human`).
- **A dispatched call** (`dispatched: true`) — the Task subagent cannot call `AskUserQuestion`. Post the question set as one comment on the record: first line `<!-- plan-review-question -->`, then each finding with its Evidence and Suggested resolution, then the instruction to answer by editing the record's body — the next build materializes the body, not comments. Release the claim:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" {n} --run "$PIPELINE_RUN_DIR" \
    --reason "failed: plan-review-needs-human" --section "/build" --step "Common Step 1.6"
  ```

  When `DISPATCH_HEADLESS=1` was set on this Task call's invocation, also: bootstrap `bot:blocked` per `_shared/label-bootstrap.md`, add it, and remove every `auto:*` grant (`auto:build`, `auto:merge`, `auto:merge-pending`) — on the MCP transport, read-merge-write via `mergeLabelNames` (`bin/lib/issues/label-write.js`) per `_shared/github-write-transport.md`'s Full-replace hazard — and send a `PushNotification` ("Record #{n} needs a human decision before it can build: {first question}"). No retry-ceiling count: this gate blocks on its first occurrence. Without `DISPATCH_HEADLESS=1` the human is at the dispatching session: the labels stay, and the dispatching session relays the question (`dispatch/reporting.md`). Either way, stop with the HARD-GATE failure `plan-review-needs-human`; the first call reports `OUTCOME: build-test-blocked`, `ISSUE #{n}: failed:plan-review-needs-human`, and `STATUS: BLOCKED`.
- **Exit state** — the claim is released, the worktree and draft PR are left in place (this gate tears nothing down and closes no PR), nothing is merged, and the run reports `BLOCKED` with the question to its caller. **Resume:** a human answers on the record, re-grants `auto:build` at `/claude-tweaks:backlog refine`, and the next dispatch re-materializes the spec from the answered record.

## Standalone /build

With no `$PIPELINE_RUN_DIR` (no run directory resolves, so no `config.yml`), the step still runs and still amends the spec and plan, commits, re-audits, and posts the record comment — with no decision-log write. List each amendment in the Step 7 handoff's `### Plan review amendments (standalone build, if any)` section (`handoff-template.md`) instead.

## Skip logging

When the `SKILL.md` stub's gate fires (`ceremony-profile=fast-lane` — roster tag `plan-review` — or a trivial plan), write one `SKIP` entry:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP \
  --section "/build" --step "Common Step 1.6 (plan review)" \
  --text "condition: {ceremony-profile=fast-lane (roster tag plan-review) | trivial plan: fewer than 3 file references and no Scope keywords:} → fallback: no plan review" --reversibility n/a
```

Standalone `/build` (no run dir): list the skip in the Step 7 handoff instead (`handoff-template.md`'s inline-skip listing).
