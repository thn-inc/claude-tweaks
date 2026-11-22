# Specify — Answering a Planning Hold (#6059)

Read only from `SKILL.md`'s Resolve-the-input case 1, on a `held` verdict from `bin/planning-hold.js` in an interactive run under `work-backend: github-issues`. It is shaping mode's alternative for this record: it asks the questions `planning.md`'s `## Hold` held, amends the kept plan, and stamps `ready`. It is passed `{n}`, the fetched body and `{hold-file}`, that verdict's JSON line (`questions`, `comment.id`, `otherUnresolved`). Every step it borrows is `planning.md`'s (this skill's directory), cited by section name, and that file's rule that plan text never enters this session holds here too.

## Inputs

Write the fetched body with the Write tool to `{held-body}`, the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-answer-held-{n}.md` prints, and copy it to `{body}` (`--value specify-answer-body-{n}.md`). The kept `Plan:` line is the body's one line starting `Plan: ` above its first `##` heading; none, or more than one, counts as missing. When `{body}` lacks `## Overview` or `## Planning Decisions` (a hold whose planning failed), add them as `planning.md`'s `## Per-record step` step 1 does. This path runs none of shaping mode's steps: no framing, ceremony or risk-flag pass, and no compose.

## Ask

Ask only the questions `{hold-file}` holds, never a new one. Zero questions: ask nothing and go to `## Kept plan`. Otherwise render one batch table with columns `Question`, `Recommended reading`, then ask per `planning.md`'s **Asking.**: one `AskUserQuestion` per set of at most four questions, one call per message, each question's options its `recommended` reading labelled `(Recommended)`, then the other reading, then `Leave for later`.

Any `Leave for later`, or a call that errors, times out or is auto-answered: with no question answered yet, write nothing at all — no line, no plan, no label, no comment edit — and the outcome is `held — {k} planning question(s) still open`. With some answered, `## Kept plan` and `## Amend and change test` run on the answered ones and the record takes `## Re-hold` with the rest.

Each answer adds one `Decided by the user at planning:` line, in **Asking.**'s form with the question as its finding, under `{body}`'s `## Planning Decisions`, replacing a lone `No planning questions arose.` line.

## Kept plan

Run `planning.md`'s `## Per-record step` step 2 for `{base}` and `{checkout}`; once this record's answer ends, on every path, remove the checkout as that step says. Write the kept line with the Write tool to `{plan-line-file}` (`--value specify-plan-line-{n}.txt`), then check it against the held body, the one its hash was computed over:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" check --line-file "{plan-line-file}" --spec-file "{held-body}" --base {base}
```

`{"valid": true}` → `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" read --record {n} --commit {commit} --out "{checkout}"` (`{commit}` from the line); its printed `path` is `{plan}`, and `cp` copies it to `{plan-before}` (`--value specify-answer-plan-before-{n}.md`), never a Read. A missing line, any other verdict or exit, or a failed read re-plans: `## Per-record step` steps 3-7 on `{body}`, whose decided lines bind the planner, so plan review runs; skip `## Amend and change test`, and the Detail records `re-planned: {failed check}`.

## Amend and change test

Dispatch the planner with `planning.md`'s **Amend prompt.** on `{plan}`, its decisions table one row per answer (`finding` = the question, `class` = `needs-human`, `decision` = its decided line), and read the reply per **Reading the reply.**. Run `## Per-record step` step 4's audit on the amended plan. Then test whether the answers changed the plan's surface:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" "{plan}" --surface-diff "{plan-before}" --spec "{body}"
```

Its verdict is the printed `surfaceDiff.changed` field: `changed: false` → no plan review; `changed: true`, a non-zero exit or no JSON line → `## Per-record step` steps 5-7 (reviewer, routing, amend and audit). The planner's report never decides whether review runs.

Routing that asks again, here or on a re-plan, follows **Asking.**; a `Leave for later` there takes `## Re-hold` with the unanswered rows — never `planning.md`'s `## Hold`, whose write lives in shaping mode's Compose-then-write-once, which this path never runs. A planning failure, as `planning.md` defines it, writes nothing: the outcome is `held — answer failed: {reason}`.

## Write

One call each, in this order, stopping at the first failure with `failed — {step} ({reason}); re-run /claude-tweaks:specify #{n}`. Every stop before (c) leaves `needs:decision` and the hold comment in place, so the record stays held.

- **(a) Plan.** `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" write --record {n} --plan-file "{plan}" --base {base} --spec-file "{body}"`. Any non-zero exit stops: there is no no-ref fallback here.
- **(b) Body.** Put the printed `line` in `{body}` as `## Per-record step` step 8 places it, then `gh issue edit {n} --body-file "{body}"` (MCP per `_shared/github-write-transport.md` when `gh` is absent).
- **(c) Comment, then label.** Prepend `**Resolved:** answered via /claude-tweaks:specify — {date}` to the hold comment `comment.id` names, with `shaping-mode-stamping.md`'s live-comment mechanics (its `updateIssueComment` call by literal file paths); then, only when `otherUnresolved` is 0, `gh issue edit {n} --remove-label "needs:decision"`. Fail closed: a failed comment edit never removes the label.
- **(d) Ready.** Only when the label was removed, `gh issue edit {n} --add-label ready`.

With `otherUnresolved` above 0, stop after the comment edit: `needs:decision` and its other comments stay (`_shared/work-record.md`'s Resolution rule), no `ready`, and the outcome is `answered — {k} planning question(s); still needs:decision ({m} other decision comment(s))`.

## Re-hold

Answers kept, unanswered questions re-held. One call each, in this order, stopping at the first failure with `failed — {step} ({reason}); re-run /claude-tweaks:specify #{n}`:

- **(a) Plan.** `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" write --record {n} --plan-file "{plan}" --base {base} --spec-file "{body}"` on the plan amended for the answered rows; as in `## Write` (a), any non-zero exit stops.
- **(b) Body.** `gh issue edit {n} --body-file "{body}"` as `## Write` (b): its decided lines and the new `Plan:` line.
- **(c) Fresh hold.** Write a new hold comment, `planning.md`'s `## Hold` template and `### Held-questions schema` with its block holding only the unanswered questions, with the Write tool to `{hold-comment}`, the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-hold-{n}.md` prints, and post it with `gh issue comment {n} --body-file "{hold-comment}"` (`add_issue_comment` when `gh` is absent).
- **(d) Old hold.** Only then prepend `**Resolved:** re-held via /claude-tweaks:specify — {date}` to the old hold comment, as `## Write` (c) edits it.

Posting before resolving keeps a newest unresolved planning hold on the record whichever call fails. Labels are not touched: `needs:decision` stays and no `ready`. The outcome is `held — {j} answered, {k} re-held`.

## Read-back and outcome

After a write, re-fetch with `gh issue view {n} --json labels,body,comments` and assert:

- **Answered:** `ready` present and `needs:decision` absent; with `otherUnresolved` above 0, `needs:decision` present and no `ready`.
- **Re-held:** `needs:decision` present, no `ready`, and `planning-hold.js` on the re-fetched comments reads `held` with exactly the re-held questions.
- **Both:** the answered hold comment carries `**Resolved:**`, the body has exactly one `Plan:` line equal to the printed `line`, and `plan-store.js check` of that line against the re-fetched body and `{base}` prints `{"valid": true}`.

A failed assertion renders `failed — read-back ({what}); re-run /claude-tweaks:specify #{n}`. Otherwise the outcome is `answered — {k} planning question(s), ready (Plan: {short commit})`, or the `## Write` or `## Re-hold` outcome above; the Detail adds `review re-ran: yes|no` and, on a re-plan, `re-planned: {failed check}`. Logging is per `planning.md`'s **Logging.**, plus one `--status AUTO --reversibility high` entry per decided line with a run dir. Next Actions splits three ways:

- **`ready`:** after the `answered — …, ready` outcome, Next Actions recommends `/claude-tweaks:flow #{n}`.
- **Still needs:decision:** after `answered — {k} planning question(s); still needs:decision ({m} other decision comment(s))`, name each remaining decision comment, its URL and its `<!-- needs-decision: {unit} -->` unit, for its owner to resolve, taken from the re-fetched comments (unresolved trusted decision comments other than the one just resolved); recommend neither `/claude-tweaks:specify` nor `/claude-tweaks:flow`, because shaping would resolve those comments unanswered and the record is not `ready`.
- **Held or failed:** after a `held — …` or `failed — …` outcome, recommend `/claude-tweaks:specify #{n}`.
