# Specify — Planning at Shaping Time (#6056)

Read only when `shaping-mode.md`'s Planning at specify paragraph resolved `plan-at-specify` to `on` under `work-backend: github-issues`; under `off`, the default, nothing in this file runs and shaping is exactly as written. Resolution refuses `on` while `planning-decisions` resolves `ask-all`: `resolve-policy.js` then prints `off` and one stderr warning naming the conflict, never an error, and that paragraph relays the warning as a one-line notice. This file writes a plan for each record shaping mode is about to stamp `ready`, reviews it, settles or asks its questions, and stores it beside the record, all before the record's one write. Which questions reach the user, and how every other one is written down, is `_shared/planning-decisions.md`'s, cited here by section name; this session is the controller that file names.

**Plan text never enters this session.** Planners and the reviewer return paths and tables only, so never Read the plan file and never ask an agent for its text; `plan-audit.js`'s JSON and `plan-store.js`'s JSON are the only other views of it.

## Which records are planned

A record is planned when `shaping-mode-stamping.md`'s Compose-then-write-once is about to write it with `ready`: a `shaped` record, including a single-record exit-0 record whose `### Risk flags` run changed its body. A refused record, a digest container, an `already shaped, no-op` record and a body the pre-write shape check refuses are never planned.

**Plan-less lane predicate.** First ask whether a lane that composes no plan will take the record. Resolve `{lane-file}` with `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-plan-lane-{n}.json`, then write the record there, `{labels}` being the fetched labels plus this pass's stamps (`risk:*`, `size:*`, `ceremony:*`, Type, `ready`) minus its removals, comma-joined — the verdict reads those labels, and the live record does not carry them yet:

```bash
node -e "const fs=require('fs');fs.writeFileSync(process.argv[1],JSON.stringify({number:Number(process.argv[2]),body:fs.readFileSync(process.argv[3],'utf8'),labels:process.argv[4].split(',').filter(Boolean)}))" -- "{lane-file}" {n} "{body}" "{labels}"
node "${CLAUDE_PLUGIN_ROOT}/bin/express-lane.js" plan-lane --record-json "{lane-file}"
```

It prints `{number, lane, reason}`: the verdict of `needsNoPlan` (`bin/lib/driver/plan-lane.js`). A non-null `lane` means the record is not planned: no plan, no `Plan:` line and no `## Overview` insertion; its Actions Performed Detail reads `not planned: {lane} lane ({reason})`, and with a run dir it logs one `SKIP` (Logging, below). A non-zero exit, no JSON line, or `lane: null` plans the record.

**Reuse a stored plan.** When the record's fetched body already carries a `Plan:` line, run `## Per-record step`'s steps 1-2, then check the line against the new body and base:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" check --line "{plan-line}" --spec-file "{body}" --base {base}
```

`{"valid": true}` (exit 0) keeps that line: skip steps 3-8, remove the checkout, and carry the line into the write. Any other verdict or exit re-plans, and the new line replaces the old one.

**A held record re-reviews its reused plan.** When the record carries `needs:decision` and its newest unresolved decision comment from a trusted author (read as `shaping-mode-stamping.md`'s `needs:*` bullet reads it) carries `Held-by: specify-planning`, a valid check still keeps the plan, but skips only steps 3-4: fetch it with `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" read --record {n} --commit {commit} --out "{checkout}"` (`{commit}` from the `Plan:` line; its printed `path` is `{plan}`), then run steps 5-9 on it, so its questions are asked again, or held again when headless, before `ready` is stamped. A failed read re-plans.

## Per-record step

Run at the point `shaping-mode-stamping.md`'s Compose-then-write-once names: after `### Risk flags` settled the session-tmp body file, `{body}`, and before that section's pre-write shape check. In order:

1. **Body.** `{body}` is the composed body. When the fetched body held a `## Overview` or `## Planning Decisions` section this composition dropped, carry it over verbatim. When `{body}` has no `## Overview`, insert one directly above `## Current State`: one paragraph saying what the record builds and why, drawn from its own Current State and Deliverables. The plan's spec hash (`bin/lib/issues/plan-line.js`) covers `## Overview` through `## Planning Decisions` and refuses a spec with no Overview. `## Planning Decisions` goes after `## Gotchas` (and after `## Breaking Change` when present), before `## Original request`.
2. **Base and checkout.** Resolve `{integration-branch}` per `_shared/integration-branch.md`, then run each of these as its own plain call (`_shared/scratch-worktree.md` §7): `git fetch origin {integration-branch}`; `git rev-parse origin/{integration-branch}`, whose sha is `{base}`, the plan's base; `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value specify-plan-checkout-{n}`, whose path is `{checkout}`; `git worktree add --detach "{checkout}" {base}`. The checkout's tracked files are read-only: the plan is the one file written there. Once this record's planning ends, on every path, remove it with `git worktree remove --force "{checkout}"`.
3. **Planner.** Dispatch one planner on the Standard profile (`## Planner prompt`). Open Prerequisites do not skip planning.
4. **Audit.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" "{plan}" --spec "{body}" --repo-root "{checkout}"`. When it exits non-zero, or its `checkE.uncovered` or `checkF.unlisted` is non-empty, re-dispatch the planner once with the Amend prompt, passing the audit's JSON line as its findings, and run the audit again; a check whose `ok` is still `false` means planning failed.
5. **Reviewer.** Dispatch one reviewer on the Capable profile (`## Reviewer dispatch`).
6. **Route.** Route its reply (`## Routing`).
7. **Amend.** When routing produced plan amendments, settled lines, decided lines or flag additions, re-dispatch the planner with the Amend prompt, the decisions table and `{plan}`; it returns the path. Run step 4's audit once more; a failing check here means planning failed.
8. **Store.** From this session's working directory, run `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" write --record {n} --plan-file "{plan}" --base {base} --spec-file "{body}"`. Exit 0 prints `{ref, commit, specHash, line}`: insert `line` verbatim as the last line of `{body}`'s metadata block, above its first `##` heading; `bin/plan-store.js` is the line's one writer, so never type or edit it. Exit 3 is the no-ref outcome: keep every decision line, write no `Plan:` line, and record why — the Detail reads `planned, no Plan: line: plan-store exit {code} ({first stderr line})`, and with a run dir one `SKIP`. Any other non-zero exit takes the same fallback.
9. **Write.** Return to Compose-then-write-once: its pre-write shape check and its one write follow, with `## Hold`'s label changes for a held record.

**Planning failed** (the checkout cannot be made, a planner or reviewer reply is still unusable after its one re-dispatch, or an audit fails as step 4 or 7 says): remove the checkout, drop this pass's settled and decided lines, write no `Plan:` line, and let the record be written as it would be under `off`. Its Detail reads `not planned: {reason}`, and with a run dir it logs one `SKIP`. A planning failure never fails the record and never stops a batch.

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

**Amend prompt.** The same dispatch and block, with steps 1-3 replaced by: `Amend the plan at {plan path} in place: apply every row of the decisions table below, add a Proof({slug}): line for each flag listed, then run every bold-paragraph check in {plugin-root}/skills/build/plan-authoring-checks.md again. Return the same path.`, followed by the decisions table (finding, class, decision) and, when step 4 sent one, the audit's JSON line.

**Reading the reply.** `NEEDS_CONTEXT` re-dispatches once with the context it names. `BLOCKED`, no status line, no `PLAN:` line, or a `PLAN:` path outside `{checkout}`, after that one re-dispatch, means planning failed.
