# The plan is made with the spec — design

Date: 2026-11-21. Status: draft for approval. Phase 12 of `2026-11-18-pipeline-economy-design.md`.

## Why

Two reasons, one from the economy design and one from the maintainer.

**The build's plan step is slow, and its questions stop builds.** In the economy design's window (8 to 18 November 2026), the plan step took about 12 minutes and 11.7M tokens per build, and the plan review found gaps in 99% of 103 reviews and stopped 43 runs to ask a human. #5292 measured the same gate on 2026-11-13: 157 of 714 runs logged a plan-review question, 271 questions in all, and 146 of 161 kept prompts were this one step. A dispatched build that stops leaves a worktree, a draft PR and a re-dispatch behind, and the answered record often stops again: in the drains of 31 October to 5 November, records took 2 to 6 rounds at about 15 minutes and 350k subagent tokens a round.

**Human planning time is the scarce resource** (maintainer, 2026-11-21). Some planning is vision and mental-model work, such as a brainstorming session, and there the human must drive. Most of what plan review asks is low-level detail, and the human does not want to be involved in it at all. Asking is the friction, not a cost to be made cheaper. Two questions plan review sent to the human:

- #4265: what `error` a claim release returns when no claim blob exists.
- #4786: which of two files holds a one-sentence pointer.

Today's rule (`plugin/skills/build/plan-review.md`) sends a gap to the human whenever settling it would alter an Acceptance Criterion or an observable contract, or whenever it has two defensible readings. Almost every detail question meets that test.

## Goals

1. A record that carries a reviewed plan skips the build's plan step (Spec Step 3) and plan review (Common Step 1.6).
2. The human is asked only questions in the three asked classes (`### 1. Who decides`). The agent settles every other question, writes its call and the reading it did not take into the record, and the acceptance packet shows the list.
3. No build stops at plan review on a question outside the asked classes, in any posture.
4. Plan text never enters `/claude-tweaks:specify`'s main session. Planners and reviewers are dispatched.
5. Both new behaviours are policy values whose defaults reproduce today, and this repository opts in first (the economy design's `## Policy model` rule).

## Non-goals

- Changing `/superpowers:brainstorming`, `/superpowers:writing-plans` or the plan file format.
- The driver lane (`plugin/bin/drive.js`), which writes no plan, and `/build`'s micro-plan path (`plugin/skills/build/micro-plan.md`), which composes its one-task plan in seconds. Neither gets a specify-time plan.
- `/build` on a design doc path (Design Mode). It has no record to carry a plan.
- Changing `/superpowers:subagent-driven-development` or its pre-flight scan.

## Anti-goals

- **Moving the friction instead of removing it.** If specify asks the same detail questions plan review asks today, only earlier, this has failed even if every plan is reused.
- **Building a stale plan without knowing it.** A plan whose spec or files moved must be rewritten, never trusted.
- **Plan text in specify's main session.** The economy evidence puts the costliest turns there.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Specify writes and reviews the full plan, keeps it on a hidden git ref, and the build copies it when a mechanical check says it is still valid. | Removes the plan step and the stops from the build. Costs a ref convention, a staleness check, and a plan for some records that are never built. |
| B | Specify runs only a plan-less spec-gap check, #5292 rescoped. The build still plans, but its review never stops on detail. | Smaller, with no storage. The 12 minutes and 11.7M tokens stay, and gaps that only show against a concrete plan are still found mid-build. |
| C | Specify writes a short task list into the record body, and the build expands it. | Fits in the 65,536-character issue body, but the build still plans, and two plan formats must be maintained. |

The maintainer chose A on 2026-11-21. A full plan cannot live in the record: plans in `docs/superpowers/plans/` run 17 to 91 KB.

## Design

### 1. Who decides

One rule, in one shared file (proposed: `plugin/skills/_shared/planning-decisions.md`), used by specify-time review and by every build-time plan review once the policy value is on. Decided with the maintainer on 2026-11-21.

**Asked**: these reach the human.

- **(a) Design-level.** Settling it changes what the record or its design doc says the work is for, who it serves, its shape, or a goal, non-goal or anti-goal.
- **(b) Hard to undo.** A wrong call cannot be cheaply undone once it ships: the question falls in a risk category the record keeps in its `Risk-flags:` line (`plugin/bin/lib/issues/record-risk-flags.js`: `migrations`, `auth`, `public-contract`, `irreversible-side-effect`, plus policy `risk-categories`). For example a migration, a format other projects read, a deletion, or an auth rule. When a question plainly falls in a category the record does not flag, the flag is added first (the shaping rule for risk flags already allows adding and forbids dropping), so the question is asked, and the plan then owes that flag's Check G proof. A migration found only during planning still reaches the human.
- **(c) Contradiction.** No reading keeps every Acceptance Criterion and recorded decision intact, so no default is safe. This is today's converged-round test (#4958).

**Settled by the agent**: every other question, including observable-contract details the record does not flag (an error string, an exit code within an existing vocabulary, which file holds a sentence).

- **Choosing.** Among the readings that keep every Acceptance Criterion and recorded decision intact, take the one closer to the record's stated intent. When the row came from a criterion change, that is the reading that keeps the criterion as written.
- **Writing it down.** Each settled call becomes one line, `Settled at planning: {finding} — chose {reading}; not {other reading}`, under a `## Planning Decisions` section. The section is additive and never edits an existing criterion's own line, as `## Plan Review Clarifications` works today. A human's answer is written the same way, attributed `Decided by the user at planning:`. Where the section lives depends on who wrote the line:
  - **Specify** writes it into the record body, which the build later materializes.
  - **A build** writes it into the worktree's `work/{n}-spec.md` and the record comment, as plan review does today. It never edits the live body: that would be a new write path from dispatched builds, and it would change the body hash.
  - Under `planning-decisions: asked-classes`, `## Planning Decisions` replaces `## Plan Review Clarifications` in the build. The converged-round rule and its `Settled by plan review after an answered round:` lines retire with it (`### 5`).
- **Showing it.** The acceptance packet's **Least confident** section (`plugin/skills/_shared/acceptance-packet.md`) lists every `Settled at planning:` line in the materialized spec of the record it covers. That spec holds both specify's lines and the build's, so the human sees each call once, at the point where they accept the work.

**Asking.** With a human present: one `AskUserQuestion` call per question set (at most four questions per call). Each question offers the recommended reading first, marked Recommended, then the other reading, then `Leave for later` in specify or `Stop the build` in a build. With no human present, or on `Leave for later`, a question in the asked classes holds the record:

- **In specify.** The shaped body, the settled lines and the plan ref are all written, so nothing is redone later. The record is left without `ready`: specify removes the label when the record already carries it, as capture's born-ready chain and decomposition records do. It also gets `needs:decision`. The decision comment follows `_shared/work-record.md`'s canonical shape, with `Proposed:` taking the recommended reading of every held question and `Command:` set to `/claude-tweaks:specify #{n}`. Labels are the inbox contract Dispatch surfaces (#4608).
- **In a build.** The existing `plan-review-needs-human` HARD-GATE fires, narrowed to the asked classes.

**Answering a held record.** An interactive `/claude-tweaks:specify #{n}` on a `needs:decision` record reads the held questions from its newest decision comment and asks them in one `AskUserQuestion` call. It writes `Decided by the user at planning:` lines and amends the kept plan with a dispatched planner. It re-runs the plan review only when an answer changes a file list or an Acceptance Criterion. Then it re-stores the plan, rewrites the hash, removes `needs:decision`, resolves the comment and stamps `ready`. Headless specify never picks up a `needs:*` record, as today.

### 2. When specify plans

- **Where.** Shaping mode and decomposition mode, once per record that is about to be stamped `ready`, and never for a parent record.
- **Skipped for** a record that a lane with no plan would take: the driver lane, the express lane (`_shared/express-lane.md`: "the lane composes no plan"), or `build/micro-plan.md`'s applicability gate. For the driver lane, the test is the record's lane bounds only: size, Key File count, ceremony, risk and protected paths, as policy sets them. Grants, open blockers, open PRs and `express-driver: split` parity are left out, because none is settled at specify time, and `drive.js --check` refuses on them. The test is a new predicate beside the admission code, not a call to `--check`. Once Phase 7 raises driver admission, more records skip, and specify gets cheaper.
- **Order per record (shaping mode):**
  1. compose the body;
  2. a dispatched planner writes the plan against a read-only checkout of `origin/{integration-branch}`. The planner probes the `ASSUMPTION — verify at build:` Gotchas, runs `plan-authoring-checks.md`, and stops `/superpowers:writing-plans` before its execution offer, as `/build` Spec Step 3 does today;
  3. `plan-audit.js {plan} --spec {spec}` runs every check, Check G included;
  4. a dispatched reviewer runs today's plan-review brief over the spec and the plan;
  5. specify routes each finding by `### 1`, asks what must be asked, and folds the amendments into the body and the plan;
  6. the plan is stored (`### 3`) and the body is written once, with its `Plan:` line (shaping mode's existing compose-then-write-once).
- **Decomposition mode.** Planning runs after Step 6's self-review, once every sub-issue exists (its number names the ref and the plan path) and the red-team and linking edits have landed, so the plan review sees each final body. It runs in specify's own session, never inside `mechanical-handoff.md`'s subagent, which cannot ask. Planners and reviewers are dispatched per sub-issue. Each body then gets one more write, carrying its `Planning Decisions` and `Plan:` lines. A held sub-issue loses `ready` as above.
- **Batches.** For a comma list, a range or a decomposition, planners and reviewers fan out under the Subagent Contract (`_shared/subagent-output-contract.md`), and every record's questions go into one batch table plus one `AskUserQuestion` call, per the Interaction style directive.
- **Headless** (bare drain, `--chained` from `/claude-tweaks:capture`): plans as well. With the split in place, few questions remain, and a question that does remain keeps the record out of `ready` (`### 1`). That is cheaper than a dispatched build discovering it.
- **Records with an open blocker** are planned too. The blocker's merge will probably make the plan stale, and the build will then re-plan, but the questions are answered while the human is present and the decisions stay in the body.

### 3. Where the plan lives

- **The ref.** `refs/claude-tweaks/plans/{n}`, pushed to the forge's remote. It is not a branch and opens no PR, so it does not trip queue-pull's open-PR exclusion. It points at one commit whose parent is the base the plan was written against and whose only change adds the plan at the path `/build` would have written (`docs/superpowers/plans/YYYY-MM-DD-{feature}-{n}.md`).
- **The body line.** `Plan: refs/claude-tweaks/plans/{n} {plan-commit-sha} spec-sha256:{hash}`.
- **What the hash covers.** The `##` sections the plan is built from, `## Overview` through `## Planning Decisions`. It does not cover the preamble metadata lines (`Surface:`, `Risk-flags:`, `Risk-flags-unconfirmed:`, `**Related:**`, `Blocked by`) or the `Plan:` line. `/backlog refine` and decomposition linking routinely rewrite those lines after specify, and hashing them would make nearly every plan stale before it is built. A changed risk flag is still caught: the build's check 4 re-runs `plan-audit.js --spec`, whose Check G fails a flag that has no proof. Any edit to a covered section, by a human or by automation, changes the hash, so the build re-plans, as it does today.
- **When no ref can be written**, for example when the cloud routine sandbox with `gh` absent cannot create or push the ref (to be probed; `_shared/issue-claims.md` already avoids ref-level writes there), specify still writes and reviews the plan in its scratch checkout, so the record still gets its planning decisions, but it stores nothing, writes no `Plan:` line and logs why. The build plans as today, bound by those decisions.
- **Lifetime.** A new plan for the same record replaces the ref. A record that closes, by merge or otherwise, has its ref deleted, by a new convergence check under `plugin/bin/lib/reconcile/` (`docs/reconcile-checks.md`).
- **`work-backend: local-files`.** The same ref, never pushed.

### 4. What the build does with it

A new first check in `/build`'s Spec Step 2, run when the policy value is on and the materialized spec carries a `Plan:` line. The plan is valid only when all of these hold:

1. the ref fetches and points at the named commit;
2. the hash matches the materialized spec;
3. no file the plan names in its Files sections (plan-audit's existing Check A parse) changed between the plan commit's parent and the build's base;
4. `plan-audit.js` passes, as it does today.

When every check passes, the build commits the plan file into its own worktree from the ref, logs `AUTO` with the plan commit, and skips Spec Step 3 and Common Step 1.6 (a `SKIP` entry: `plan reviewed at specify ({commit})`). The `ASSUMPTION` probes run again, since the tree moved.

When any check fails, the build logs which check failed and writes a new plan as today. The body's `Planning Decisions` lines still bind the new plan, and its review uses the `### 1` split, so it rarely has anything to ask.

### 5. Policy

Two values, so each can be measured on its own (names are proposals, settled with `.claude/skills/policy-key-addition`):

- `planning-decisions: ask-all | asked-classes`. Default `ask-all`, today's rule. `asked-classes` applies `### 1` to every plan review, in specify and in the build, and replaces the converged-round rule, whose test is class (c).
- `plan-at-specify: off | on`. Default `off`. `on` makes specify plan (`### 2`) and the build consume it (`### 4`). It requires `planning-decisions: asked-classes`: plan resolution refuses `on` with `ask-all`, because that combination moves the friction to specify (the first anti-goal).

Neither is a ceiling key under the economy design's factory-layer rule.

### 6. #5292

#5292 (open, `ready`) moves a spec-gap check into shaping and defaults most build-time gaps. This design supersedes it:

- its shaping-time check becomes specify's plan review;
- its build-time default becomes the `### 1` split;
- its low-confidence trail becomes the acceptance packet's `Settled at planning:` list;
- its two never-default classes are kept as (b) and (c), and (a) is added.

Close #5292 as superseded when this design's records are filed.

## Measures

Done when, over the first 20 records built with `plan-at-specify: on`:

- no build stopped at plan review on a question outside the asked classes;
- the build's median minutes, plan step included, fell by at least 10;
- the economy design's three quality guards are no worse;
- the share of specify-time plans the build reused is recorded. Under 50% means the staleness check or the planning moment is wrong, and the design is revisited before the default changes.

Also recorded: questions asked per specified record, against the 271-in-157-runs baseline.

## Expected effect

The plan step (12 minutes, 11.7M tokens) and the plan-review stops leave the build for records whose plan stays valid. Questions to the human fall to the asked classes, a size this design cannot predict, which is why it is measured. Specify takes longer per record, and some plans are written for records that are never built. The reuse rate measures that cost.

## Left to the builder

- Key names, the `Plan:` line grammar and the hash normalization.
- How the planner gets its read-only checkout (`_shared/scratch-worktree.md` is the likely fit).
- Whether the ref reader and writer is a new `plugin/bin/` CLI or part of an existing one.
- The decomposition into records. A likely order: the `### 1` split in build-time plan review; the ref, body line and staleness check; specify planning; the build consuming the plan; the acceptance-packet list.

## Calls made in this document that were not discussed

- Headless specify plans too, and a question in the asked classes keeps the record out of `ready` with `needs:decision`. The shaped body and plan are kept, and an interactive `/claude-tweaks:specify #{n}` asks the held questions and finishes the record.
- The driver-lane skip uses the lane bounds alone, not `drive.js --check`. The express lane is skipped as well.
- A build's settled lines stay in the worktree spec and the record comment, never the live body. The acceptance packet reads both kinds from the materialized spec.
- In decomposition mode, planning runs after Step 6 in specify's own session, at the cost of one more body write per sub-issue.
- The spec hash leaves out the preamble metadata lines. Check G covers a changed risk flag.
- A question in an unflagged risk category adds the flag and is asked.
- Where no ref can be written, the plan is reviewed but not stored.
- Records with an open blocker are planned at specify time, accepting that many will re-plan.
- Driver-admitted and micro-plan records get no specify-time plan.
- The split and the specify-time plan are two policy values, and `plan-at-specify: on` refuses `ask-all`.
- Class (b) leans on the record's `Risk-flags:` line rather than a new judgment, so "hard to undo" means a flagged category.
- Any spec edit after planning, including by automation, invalidates the plan. The error is toward today's behaviour.
- The reuse-rate floor of 50% is a revisit trigger, not a measured value.
