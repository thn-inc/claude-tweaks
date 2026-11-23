# Specify — Answering a Planning Hold (#6059)

Read only from `SKILL.md`'s Resolve-the-input case 1, on a `held` verdict from `bin/planning-hold.js` in an interactive run under `work-backend: github-issues`. It is shaping mode's alternative for this record. It is passed `{n}`, the fetched body and `{hold-file}`, that verdict's JSON line (`questions`, `comment.id`, `otherUnresolved`, `supersededHolds`). Every step it borrows is `planning.md`'s (this skill's directory), cited by section name, and that file's rule that plan text never enters this session holds here too.

## Inputs

With `gh` absent, write nothing and stop here: `## Write` (c) and `## Re-hold` (d) edit the hold comment, which `_shared/github-write-transport.md` maps no MCP call for, so every run would store the plan and rewrite the body before failing. The outcome is `held — answering needs gh (no MCP mapping for the hold-comment edit)`.

Write the fetched body with the Write tool to `{held-body}`, the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-answer-held-{n}.md` prints, and copy it to `{body}` (`--value specify-answer-body-{n}.md`). The kept `Plan:` line is the body's one line starting `Plan: ` above its first `##` heading; none, or more than one, counts as missing. When `{body}` lacks `## Overview` or `## Planning Decisions` (a hold whose planning failed), add them as `planning.md`'s `## Per-record step` step 1 does. This path runs none of shaping mode's steps: no framing, ceremony or risk-flag pass, and no compose.

## Ask

Ask only the questions `{hold-file}` holds, never a new one, and skip each one `{body}` already answers with a `Decided by the user at planning: {question} — chose` line, so no line is written twice. None left to ask (zero questions, or every one already answered): ask nothing and go to `## Kept plan`. Otherwise render one batch table with columns `Question`, `Recommended reading`, then ask per `planning.md`'s **Asking.**: one `AskUserQuestion` per set of at most four questions, one call per message, each question's options its `recommended` reading labelled `(Recommended)`, then the other reading, then `Leave for later`.

Any `Leave for later`, or a call that errors, times out or is auto-answered: with no question answered in this run or in `{body}`, write nothing at all — no line, no plan, no label, no comment edit — and the outcome is `held — {k} planning question(s) still open`. With some answered, in this run or in `{body}`, `## Kept plan` and `## Amend and change test` run on this run's answers and the record takes `## Re-hold` with the rest, so a failed re-hold is retried.

Each answer adds one `Decided by the user at planning:` line, in **Asking.**'s form with the question as its finding, under `{body}`'s `## Planning Decisions`, replacing a lone `No planning questions arose.` line.

## Kept plan

Run `planning.md`'s `## Per-record step` step 2 for `{base}` and `{checkout}`; once this record's answer ends, on every path, remove the checkout as that step says. Write the kept line with the Write tool to `{plan-line-file}` (`--value specify-plan-line-{n}.txt`), then check it against the held body:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" check --line-file "{plan-line-file}" --spec-file "{held-body}" --base {base}
```

A `{hold-file}` holding no question re-plans whatever the check prints: `planning.md`'s held planning failure writes such a hold when its capture found no block, so its questions were lost and plan review must re-derive them. `{"valid": true}` → `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" read --record {n} --commit {commit} --out "{checkout}"` (`{commit}` from the line); its printed `path` is `{plan}`, and `cp` copies it to `{plan-before}` (`--value specify-answer-plan-before-{n}.md`), never a Read. With no answer given in this run, skip `## Amend and change test` and go on with `{plan}` as read (`## Write`, or `## Re-hold` after a `Leave for later`): no amend, no change test, no review. A missing line, any other verdict or exit, or a failed read re-plans: `## Per-record step` steps 3-7 on `{body}`, whose decided lines bind the planner, so plan review runs; skip `## Amend and change test`, and the Detail records `re-planned: {failed check}`.

## Amend and change test

Dispatch the planner with `planning.md`'s **Amend prompt.** on `{plan}`, its decisions table one row per answer given in this run (`finding` = the question, `class` = `needs-human`, `decision` = its decided line), and read the reply per **Reading the reply.**. Run `## Per-record step` step 4's audit on the amended plan. Then test whether the answers changed the plan's surface:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" "{plan}" --surface-diff "{plan-before}" --spec "{body}"
```

Its verdict is the printed `surfaceDiff.changed` field: `changed: false` → no plan review; `changed: true`, a non-zero exit or no JSON line → `## Per-record step` steps 5-7 (reviewer, routing, amend and audit). The planner's report never decides whether review runs.

Routing that asks again, here or on a re-plan, follows **Asking.**; a `Leave for later` there takes `## Re-hold` with the unanswered rows — never `planning.md`'s `## Hold`. A planning failure, as `planning.md` defines it, writes nothing: the outcome is `held — answer failed: {reason}`.

## Write

One call each, in this order, stopping at the first failure. A stop before (c) resolved the hold comment renders `failed — {step} ({reason}); re-run /claude-tweaks:specify #{n}`: it leaves `needs:decision` and the hold comment in place, so the record stays held and a re-run reads `held` again. A stop after it (a later (c) edit, the label removal or (d)) renders `failed — {step} ({reason}); check the decision comments and remove needs:decision by hand once none is unresolved`: the hold is already resolved, so a re-run would shape the record and resolve another unit's comment unanswered.

- **(a) Plan.** `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" write --record {n} --plan-file "{plan}" --base {base} --spec-file "{body}"`. Any non-zero exit stops: there is no no-ref fallback here.
- **(b) Body.** Put the printed `line` in `{body}` as `## Per-record step` step 8 places it, then `gh issue edit {n} --body-file "{body}"` (gh absent: `issue_write` (update mode) per `_shared/github-write-transport.md`).
- **(c) Comment, then label.** First re-fetch the comments to `{comments-file}` and re-run `planning-hold.js` on it to `{hold-fresh}` (`--value specify-answer-hold-fresh-{n}.json`), never over `{hold-file}`, as `SKILL.md`'s case 1 routing does, and take `otherUnresolved` and `supersededHolds` from that fresh line, so a decision comment posted since routing counts; a failed fetch or exit, or a fresh verdict that is not `held` on the same `comment.id`, is the kept branch: it counts as `otherUnresolved` above 0, resolves `{hold-file}`'s `supersededHolds`, and its outcome is `answered — {k} planning question(s); needs:decision kept (decision comments could not be re-read)`. Then prepend `**Resolved:** answered via /claude-tweaks:specify — {date}` to the hold comment `comment.id` names and to each `supersededHolds` comment, with `shaping-mode-stamping.md`'s live-comment mechanics (its `updateIssueComment` call by literal file paths; `_shared/github-write-transport.md` maps no MCP call for the comment edit: with `gh` absent it fails, and the label stays); then, only when `otherUnresolved` is 0, `gh issue edit {n} --remove-label "needs:decision"` (gh absent: `issue_write` (update mode, the complete label array) per `_shared/github-write-transport.md`). Fail closed: a failed comment edit never removes the label.
- **(d) Ready.** Only when the label was removed, `gh issue edit {n} --add-label ready` (gh absent: `issue_write` (update mode, the complete label array) per `_shared/github-write-transport.md`).

With the fresh `otherUnresolved` above 0, stop after the comment edit: `needs:decision` and its other comments stay (`_shared/work-record.md`'s Resolution rule), no `ready`, and the outcome is `answered — {k} planning question(s); still needs:decision ({m} other decision comment(s))`, or the kept branch's.

## Re-hold

Answers kept, unanswered questions re-held. One call each, in this order, stopping at the first failure with `failed — {step} ({reason}); re-run /claude-tweaks:specify #{n}`, which is safe at every step: the fresh hold is posted before (d) resolves the old one, so a re-run reads `held`:

- **(a) Plan.** `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" write --record {n} --plan-file "{plan}" --base {base} --spec-file "{body}"` on the plan amended for the answered rows; as in `## Write` (a), any non-zero exit stops.
- **(b) Body.** `gh issue edit {n} --body-file "{body}"` as `## Write` (b): its decided lines and the new `Plan:` line (gh absent: `issue_write` (update mode) per `_shared/github-write-transport.md`).
- **(c) Fresh hold.** Write a new hold comment, `planning.md`'s `## Hold` template and `### Held-questions schema` with its block holding only the unanswered questions, with the Write tool to `{hold-comment}`, the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-hold-{n}.md` prints, and post it with `gh issue comment {n} --body-file "{hold-comment}"` (gh absent: `add_issue_comment` per `_shared/github-write-transport.md`, its marker-comment read-back included).
- **(d) Old hold.** Only then prepend `**Resolved:** re-held via /claude-tweaks:specify — {date}` to the old hold comment and to each `supersededHolds` comment, as `## Write` (c) edits it.

Posting before resolving keeps a newest unresolved planning hold on the record whichever call fails. Labels are not touched: `needs:decision` stays and no `ready`. The outcome is `held — {j} answered, {k} re-held`.

## Read-back and outcome

After a write, re-fetch with `gh issue view {n} --json labels,body,comments > "{readback-file}"` (`--value specify-answer-readback-{n}.json`) and write its `body` with the Write tool to `{readback-body}` (`--value specify-answer-readback-body-{n}.md`); gh absent, per `_shared/github-write-transport.md`, write `issue_read` `get_comments`'s array to `{readback-file}` and `get`'s `body` to `{readback-body}` and its `labels` to `{readback-labels}` (`--value specify-answer-readback-labels-{n}.json`), each with the Write tool. Write the printed `line` to `{plan-line-file}`, then run `plan-store.js check --line-file "{plan-line-file}" --spec-file "{readback-body}" --base {base} > "{plan-check-file}"`, writing `{plan-check-file}` (`--value specify-answer-plan-check-{n}.json`); ignore its exit, because the `readback` call below reads its verdict. After `## Re-hold`, also write the re-held question texts as a JSON array with the Write tool to `{reheld-file}` (`--value specify-answer-reheld-{n}.json`). Then read the verdict with one call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/planning-hold.js" readback --record {n} --branch {answered|kept|re-held} --readback-file "{readback-file}" --body-file "{readback-body}" [--labels-file "{readback-labels}"] --plan-line-file "{plan-line-file}" --plan-check-file "{plan-check-file}" --resolved-ids {ids} --answered {k} [--other-unresolved {m}] [--reheld-file "{reheld-file}"]
```

Pass `--branch answered` after `## Write`, with the fresh `otherUnresolved` as `--other-unresolved`; `--branch kept` on the kept branch; and `--branch re-held` after `## Re-hold`, with `{j}` as `--answered` and `--reheld-file`. `--resolved-ids`: the answered hold comment's id and each `supersededHolds` comment's (`{hold-fresh}`'s on the `## Write` path, `{hold-file}`'s on the kept branch and after `## Re-hold`), comma-joined as `{ids}`. Pass `--labels-file` only on the gh-absent path.

Exit 0 prints one JSON line: render its `outcome`, whether every assertion passed or one failed; the Detail adds `review re-ran: yes|no` and, on a re-plan, `re-planned: {failed check}`. Exit 1 or 2, or stdout that is not one JSON line, renders, after `## Re-hold`, `failed — read-back (verdict unreadable); re-run /claude-tweaks:specify #{n}`, and after `## Write`, `failed — read-back (verdict unreadable); check the decision comments and remove needs:decision by hand once none is unresolved`, because `## Write` resolved the hold comment. Logging is per `planning.md`'s **Logging.**, plus one `--status AUTO --reversibility high` entry per decided line with a run dir. Next Actions takes the bullet the verdict's `next` names — `ready`, `still-needs-decision`, `kept-needs-decision` or `held-or-failed`; an outcome rendered before the read-back (a `held — …` with nothing written, a `failed — …` from `## Write` or `## Re-hold`, a verdict-unreadable failure) takes the bullet its outcome describes:

- **`ready`:** after the `answered — …, ready` outcome, recommend `/claude-tweaks:flow #{n}`.
- **Still needs:decision:** after `answered — {k} planning question(s); still needs:decision ({m} other decision comment(s))`, name each remaining decision comment, its URL and its `<!-- needs-decision: {unit} -->` unit, for its owner to resolve, taken from the re-fetched comments (unresolved trusted decision comments other than those just resolved); recommend neither `/claude-tweaks:specify` nor `/claude-tweaks:flow`, because shaping would resolve those comments unanswered and the record is not `ready`.
- **Kept needs:decision:** after `answered — {k} planning question(s); needs:decision kept (decision comments could not be re-read)`, or a `failed — …` one ending `; check the decision comments and remove needs:decision by hand once none is unresolved`, tell the user to check the record's decision comments and remove `needs:decision` by hand once none is unresolved; recommend neither `/claude-tweaks:specify` nor `/claude-tweaks:flow`, because a re-run would shape the record and resolve another unit's comment unanswered.
- **Held or failed:** after a `held — …` outcome, or a `failed — …` one ending `; re-run /claude-tweaks:specify #{n}`, recommend `/claude-tweaks:specify #{n}`.
