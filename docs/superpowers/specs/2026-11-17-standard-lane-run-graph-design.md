# Standard-lane run graph — design

Date: 2026-11-17. Status: draft for approval.

Record: #5580. Extends `docs/superpowers/specs/2026-11-11-pipeline-driver-design.md`, as Phase 7 of `docs/superpowers/specs/2026-11-15-process-efficiency-design.md`. Written against `main` at `60464ca6b9e06ac7bb5f9ed3cd0c8da4892cd50d` (`git rev-parse origin/main` after `git fetch origin main`, 2026-11-17).

## Why

A pipeline run takes one of four lanes, and only one of them is a program.

- **Standard lane.** `/claude-tweaks:flow` runs `build`, `test`, `review`, `polish` and `wrap-up`, with `stories` inserted when the build changed UI files (`plugin/skills/flow/steps-and-gates.md`, Allowed Steps). A model walks the steps from skill prose. `/claude-tweaks:dispatch` splits the same list into two calls, `build,test` then `review,polish,wrap-up`.
- **Fast lane.** The same steps under `ceremony-profile: fast-lane`, less the skips in `plugin/skills/_shared/ceremony-profile.md`.
- **Prose express lane.** `plugin/skills/_shared/express-lane.md`: one agent, no `/claude-tweaks:flow` frame.
- **Driver lane.** `plugin/bin/drive.js` runs a fixed list of step objects (`STEPS` in `plugin/bin/lib/driver/steps.js`) in order. A step may return `skip`, but no function chooses steps from record facts: eligibility and admission decide whether a record enters the lane at all, and the lane's bounds are policy values.

Which steps a standard or fast-lane run takes is decided in several places, none of them one function. `/claude-tweaks:specify` stamps a `ceremony:*` label from a model judgment over the record's text (`assess-agent-autonomy`'s `ceremony-check` mode, decision 0006), and `plugin/bin/lib/flow/manifesto-write.js` folds it into the run's `config.yml` as `ceremony-profile`. `plugin/bin/lib/dispatch/ceremony-derive.js` narrows `standard` to `fast-lane` at wrap-up when the diff touched no implementation file, and the wrap-up Ceremony escape hatch is the only way back up. The roster in `ceremony-profile.md` lists the skips by profile, and a test pins it against every skill file. Other selectors sit outside the roster: the `stories` trigger and the `polish` skip in `flow/steps-and-gates.md`, the plan-writing skip in `plugin/skills/build/micro-plan.md`, review effort in `plugin/skills/review/review-effort-derivation.md`, `resolve-profile.js --diff-facts`, and `plan-audit.js --count-tasks`, which feeds the single-task skip of the whole-branch review.

The stops no mode may silence are the "HARD-GATE / BLOCKED / STOP conditions" row of `plugin/skills/_shared/auto-mode-contract.md`. Three of them sit inside steps the roster lets the fast lane skip: `/claude-tweaks:review` Step 1 (roster tag `review-step-1`), the plan audit's hard fails (`plan-audit`) and the plan-review spec gap (`plan-review`). A HARD-GATE today is a stop that fires when its step runs, not a promise that the step runs.

This design replaces those selectors with one function from record facts to the steps a run takes, written as code, with the steps no record may skip as assertions inside it. Its rules rest on the per-step cost and yield measured below where the numbers can carry a rule, and say so where they cannot.

## Goals

1. **Step vocabulary.** A closed list of the steps a run can take. A vocabulary step is the smallest unit the function may include or leave out on its own; anything that always runs with its parent is part of the parent.
2. **Selection function.** One function, in code, from record facts (type, size, risk, surface, changed paths, task count) to the ordered steps a run takes, chosen from the vocabulary. No input is free text. A rule that gives a record fewer steps than it gets today sits behind a policy value whose default reproduces today's graph.
3. **Assertions.** The steps no record may skip, each an assertion inside the function with its reason. For each of the three HARD-GATEs that sit inside a fast-lane skip today, the design says whether its step is now in every graph.
4. **Loops.** Every place a step may run again, each with a numeric bound and the outcome when the bound is reached.
5. **Roster replacement.** What replaces `ceremony-profile.md`'s skip roster, and how a run in flight on the previous plugin release keeps working while both forms exist.

The umbrella targets of #4031 (a median wall time of 15 minutes or less, 120 round trips or fewer) are what the phases are expected to move. Each phase states its expected effect as an expectation, not a criterion.

## Non-goals

- This document builds nothing. No file under `plugin/` changes with it; its phases are written for `/claude-tweaks:specify` to decompose.
- No model writes or edits the graph. Record text is untrusted input, so the function selects from a fixed vocabulary and nothing else.
- No change to the prose express lane (`plugin/skills/_shared/express-lane.md`) or to the driver's admission and bounds for express-sized records (`plugin/bin/lib/express/eligibility.js`, `plugin/bin/lib/driver/admission.js`, the `express-driver-max-*` policy values).
- A model-generated graph per task stays not planned, as the process-efficiency design's Not planned table records.
- No change to any step's model profile. #4030 owns the profile of the dispatched build agent.

## Evidence

Measured on 2026-11-17 over this machine's run directories with the repository's own tool. Every number in this section is a field of command C1's output unless it names another command; each other command is printed whole where it is used.

C1:

```
node tools/step-yield-report.js <main-checkout>/.claude-tweaks/pipelines --json --runs --window 100 --lane-floor 20 > yield.json
```

C1 and C5 run from the repository root. C2 and C3 read C1's `yield.json` from the directory C1 wrote it to.

C1 scanned 3,203 run directories (`runDirsScanned`), none failed (`runsFailed: 0`), and none carried a `step-yield.json` (`runsReadFromFile: 0`). Every yield in this section is derived in memory from the run directory, which is how the tool covers runs closed before #5556 shipped. The rules C1 applies are in the header comment of `tools/step-yield-report.js`.

### Lane rule

The tool assigns each run directory to one lane (`laneOf`), in this order:

1. A directory holding `driver-events.jsonl` is a `driver` run.
2. Otherwise it is an `express` run when its top-level `decisions.md` holds an `Express lane check: #N proceed` entry that no later `Express lane: escalated #N to /flow` entry for the same record cancels. This mirrors `hasProceed` in `plugin/bin/lib/express/cli.js`. A run whose express attempt escalated counts under the lane it finished in.
3. Otherwise the lane is the `ceremony-profile` value in `config.yml` (`standard` or `fast-lane`).
4. Otherwise it is `none`: no `config.yml`, or no `ceremony-profile` key in it.

A prose express run and a driver run both write `ceremony-profile: fast-lane` to `config.yml`, so the profile alone does not tell the three apart. The rule does: the driver run by its event file, the express run by its uncancelled proceed entry, and the fast-lane run by neither.

### Window

The window is the 100 most recently started closed runs, by the run id's timestamp read as UTC. A run is a candidate when its directory name matches `RUN_NAME_RE` (a `YYYY-MM-DDTHHMMSS` timestamp, then `spec-`, `record-` or `drive-`) and its `run-state.json` has `status: clean`. Its start time (`startedAt`) is that leading timestamp, read as UTC. A candidate with no readable timestamp is `undated` and never enters the window; there are 0 (`window.undated`). A lane with fewer than 20 runs in the window is widened to its own 20 most recently started candidates; a lane with fewer than 20 candidates in the whole archive, undated ones included, is reported with its count.

The window orders runs by start, not by close, because no event time is a close time: events keep landing on a run directory after it closes. The three driver runs started on 2026-11-12 and their last events are `worktree-reap-skipped` events written by the worktree reaper on 2026-11-13, hours after the work ended. C4 prints one:

```
tail -n 1 <main-checkout>/.claude-tweaks/pipelines/archive/2026-11-12T190721-drive-4351/events.jsonl
```

It prints `{"reason":"removal-failed","prNumber":5276,"ts":"2026-11-13T01:03:44.849Z","type":"worktree-reap-skipped"}`. Ordering by the latest event would move old runs into the window each time such an event lands.

The window runs from 2026-11-14T21:22:11Z (`window.oldest`) to 2026-11-17T00:50:46Z (`window.newest`), both start times. Its 100 runs are 88 `standard`, 6 `fast-lane`, 3 `express`, 3 `none` and 0 `driver` (`window.lanes.{lane}.inWindow`).

Source: C1, `window.lanes`. Oldest and newest are the start times of the runs each lane uses.

| Lane | In window | Runs used | Widened | Undated | Closed runs in archive | Below 20 in archive | Oldest used | Newest used | Null-cost runs |
|---|---|---|---|---|---|---|---|---|---|
| standard | 88 | 88 | no | 0 | 1072 | no | 2026-11-14T21:22:11Z | 2026-11-17T00:50:46Z | 3 |
| fast-lane | 6 | 20 | yes | 0 | 400 | no | 2026-11-01T19:19:25Z | 2026-11-16T18:39:40Z | 2 |
| none | 3 | 20 | yes | 0 | 225 | no | 2026-10-16T19:07:52Z | 2026-11-16T23:14:21Z | 20 |
| express | 3 | 4 | yes | 0 | 4 | yes | 2026-11-13T06:36:16Z | 2026-11-16T15:24:36Z | 3 |
| driver | 0 | 3 | yes | 0 | 3 | yes | 2026-11-12T18:15:26Z | 2026-11-12T19:07:21Z | 0 |

`fast-lane` and `none` are widened to their own 20 most recently started closed runs. `express` (4 closed runs) and `driver` (3) have fewer than 20 closed runs in the whole archive, so their tables use every closed run they have. No rule in this design rests on the `express` or `driver` numbers.

**Null cost.** A null-cost run is one whose every step has `tokens: null` (`window.lanes.{lane}.nullCost`): for the `driver` lane, every step in `driver-events.jsonl`; for every other lane, every step of the yield. A run with no step entries at all counts as null-cost. The counts are in the table above: 3 of 88 `standard`, 2 of 20 `fast-lane`, 20 of 20 `none`, 3 of 4 `express`, 0 of 3 `driver`. Runs with no yield step entries at all, per lane, from C2:

```
node -e 'const s=JSON.parse(require("fs").readFileSync("yield.json","utf8"));for(const[l,x]of Object.entries(s.window.lanes))console.log(l,x.rows.filter(r=>r.steps.length===0).length)'
```

It prints `driver 3`, `express 3`, `fast-lane 0`, `none 15`, `standard 0`. A run whose events give no phase a span has no yield steps (`docs/reference/step-yield.md`: `steps` keeps only phases that have a span). The `driver` lane is read from its own step events instead, so its 3 is expected. Three of the four `express` runs and 15 of the 20 `none` runs have no per-step numbers at all.

### What each column is

- **Runs** (`runs`): the step entries for that step across the lane's runs. It includes entries in which the step did not run.
- **Ran** (`ranRuns`): the entries in which the step ran: more than 0 minutes, or at least one event or decision line attributed to it. Every rate drawn from these tables uses Ran as its denominator, never Runs.
- **Median span minutes** (`minutes.median`, over every Runs entry): the step's span as `derivePhases` (`plugin/bin/lib/timing/derive.js`) reconstructs it from `events.jsonl`, in whole minutes, summed over the step's occurrences. A top-level skill's span runs from its `skill_invoked` event to the earliest of the next top-level skill's invocation, the start of the merge phase, or the run's end. A `call-N` span runs to the next `/claude-tweaks:flow` invocation or the run's end. The `merge` span runs from the first push after wrap-up starts to the PR's merge time. `plan`, `tasks` and `polish` have their own bounds in the same function. **This is wall clock, not work time.** It includes every idle stretch inside the span: waiting for the maintainer, for CI, for a human merge, and the gap between dispatch calls. It is also cut short when another top-level skill is invoked inside the step, and it reads 0 for a span under half a minute. `E-express-wrap-up` (5,743), `E-fast-lane-merge` (5,890) and `E-fast-lane-call-4` (21,506) are spans of about 4, 4 and 15 days: they measure how long the step stayed open, idle time included. A span with no terminal event runs to the moment of measurement, so those three values are C1's on 2026-11-17 and grow with each later run of C1. The `standard` lane's `review` ran in 54 entries, 22 of them with 0 minutes, from C3:

  ```
  node -e 'const s=JSON.parse(require("fs").readFileSync("yield.json","utf8"));const v=s.window.lanes.standard.rows.flatMap(r=>r.steps.filter(t=>t.name==="review"&&t.ran));console.log(v.length,v.filter(t=>t.minutes===0).length)'
  ```

  It prints `54 22`. The data holds no measure of a step's work time. The yield's `ownMinutes` subtracts nested spans from the same wall clock and is not in the tool's rows. Read this column as how long a step was open, never as what it cost.
- **Median tokens** (`tokens.median`, over the non-null entries): `timing.json`'s per-phase total of input, output, cache-read and cache-create tokens. An entry is `null` when the run has no `timing.json` or no row for the phase; 0 means a row whose total was 0. `n/a` means every entry was null.
- **Null-token runs** (`tokens.nullRuns`): the entries whose tokens are unknown. The tool's `tokens.sum` covers the known values only, and is `null` when there are none, so unknown cost is reported here and never folded into a sum.
- **Median agents** (`agents.median`): `timing.json`'s subagent count for the phase; `n/a` when every entry is null.
- **Confirmed-finding runs** (`outcome.confirmedRuns`): entries with at least one finding both reviewers reported or a tiebreak confirmed.
- **Verify-fail runs** (`outcome.verifyFailRuns`): entries with at least one failed `verify` event. For the `driver` lane, entries with at least one step event whose status is neither `ok` nor `skip`.
- **Fix-commit runs** (`outcome.fixCommitRuns`): entries with at least one `commit`-action commit event in a step other than `build`, `plan` and `tasks`, whose commits are the run's product. `push`, `apply`, `rm`, `mv` and `update-ref` events are not commits.
- **Outcome-changing runs** (`outcome.anyRuns`): entries with any of the three above.

A `—` marks a column the source cannot record. For the `driver` lane the tool holds 0 there by construction, because `driver-events.jsonl` carries neither findings nor commit events.

### Standard lane

Source: C1, `stepTable.standard`, over 88 runs.

| Row | Runs | Ran | Median span minutes | Median tokens | Null-token runs | Median agents | Confirmed-finding runs | Verify-fail runs | Fix-commit runs | Outcome-changing runs |
|---|---|---|---|---|---|---|---|---|---|---|
| E-standard-call-1 | 79 | 79 | 215 | 1,629,825 | 3 | 0 | 0 | 0 | 53 | 53 |
| E-standard-call-2 | 46 | 46 | 6.5 | 1,892,259 | 1 | 0 | 5 | 0 | 9 | 9 |
| E-standard-build | 82 | 82 | 129.5 | 16,699,420 | 3 | 1 | 0 | 0 | 0 | 0 |
| E-standard-plan | 61 | 61 | 12 | 11,676,149 | 1 | 1 | 0 | 0 | 0 | 0 |
| E-standard-tasks | 66 | 66 | 137 | 54,454,143 | 1 | 12 | 0 | 6 | 0 | 6 |
| E-standard-test | 70 | 56 | 1 | 1,288,824 | 1 | 0 | 0 | 1 | 2 | 2 |
| E-standard-review | 69 | 54 | 0 | 0 | 1 | 0 | 24 | 1 | 29 | 30 |
| E-standard-wrap-up | 81 | 81 | 0 | 0 | 2 | 0 | 0 | 0 | 23 | 23 |
| E-standard-merge | 68 | 67 | 0 | 0 | 1 | 0 | 0 | 0 | 9 | 9 |
| E-standard-call-3 | 37 | 37 | 21 | 146,895 | 0 | 0 | 6 | 0 | 7 | 7 |
| E-standard-call-4 | 16 | 16 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| E-standard-polish | 4 | 4 | 61 | 1,872,156 | 0 | 0 | 1 | 0 | 2 | 2 |
| E-standard-tidy | 1 | 1 | 181 | 5,114,699 | 0 | 0 | 0 | 0 | 0 | 0 |
| E-standard-call-5 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Fast lane

Source: C1, `stepTable.fast-lane`, over 20 runs (widened).

| Row | Runs | Ran | Median span minutes | Median tokens | Null-token runs | Median agents | Confirmed-finding runs | Verify-fail runs | Fix-commit runs | Outcome-changing runs |
|---|---|---|---|---|---|---|---|---|---|---|
| E-fast-lane-call-1 | 18 | 18 | 37 | 0 | 2 | 0 | 0 | 0 | 13 | 13 |
| E-fast-lane-call-2 | 16 | 16 | 4 | 86,593 | 2 | 0 | 0 | 0 | 0 | 0 |
| E-fast-lane-build | 18 | 18 | 22.5 | 1,968,802 | 2 | 0.5 | 0 | 0 | 0 | 0 |
| E-fast-lane-tasks | 18 | 18 | 17.5 | 0 | 1 | 0 | 0 | 3 | 0 | 3 |
| E-fast-lane-test | 20 | 20 | 3 | 1,115,593 | 2 | 0 | 0 | 0 | 1 | 1 |
| E-fast-lane-review | 20 | 20 | 4 | 1,179,397 | 2 | 1 | 0 | 0 | 3 | 3 |
| E-fast-lane-wrap-up | 20 | 20 | 6 | 0 | 2 | 0 | 0 | 0 | 19 | 19 |
| E-fast-lane-merge | 20 | 20 | 5890 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| E-fast-lane-call-3 | 14 | 14 | 8 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| E-fast-lane-plan | 8 | 8 | 2.5 | 3,523,812 | 1 | 0 | 0 | 0 | 0 | 0 |
| E-fast-lane-call-4 | 9 | 9 | 21506 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| E-fast-lane-call-5 | 1 | 1 | 58 | n/a | 1 | n/a | 0 | 0 | 0 | 0 |
| E-fast-lane-dispatch | 2 | 2 | 102 | n/a | 2 | n/a | 0 | 0 | 0 | 0 |
| E-fast-lane-specify | 1 | 1 | 4 | n/a | 1 | n/a | 0 | 0 | 0 | 0 |

### No profile

Source: C1, `stepTable.none`, over 20 runs (widened). 15 of the 20 have no step entries (C2).

| Row | Runs | Ran | Median span minutes | Median tokens | Null-token runs | Median agents | Confirmed-finding runs | Verify-fail runs | Fix-commit runs | Outcome-changing runs |
|---|---|---|---|---|---|---|---|---|---|---|
| E-none-wrap-up | 4 | 4 | 17019.5 | n/a | 4 | n/a | 0 | 0 | 0 | 0 |
| E-none-call-1 | 3 | 3 | 32154 | n/a | 3 | n/a | 0 | 0 | 0 | 0 |
| E-none-test | 1 | 1 | 3 | n/a | 1 | n/a | 0 | 0 | 0 | 0 |

### Prose express lane

Source: C1, `stepTable.express`, over 4 runs, below 20 in the whole archive. 3 of the 4 have no step entries (C2). No rule rests on this table.

| Row | Runs | Ran | Median span minutes | Median tokens | Null-token runs | Median agents | Confirmed-finding runs | Verify-fail runs | Fix-commit runs | Outcome-changing runs |
|---|---|---|---|---|---|---|---|---|---|---|
| E-express-wrap-up | 1 | 1 | 5743 | 9,802,401 | 0 | 0 | 0 | 0 | 0 | 0 |

### Driver lane

Source: C1, `stepTable.driver`, over 3 runs, below 20 in the whole archive. No rule rests on this table.

Driver rows are keyed by the driver's own step names, not by the yield's phases, and come from `driver-events.jsonl`: minutes are each step's summed `ms` divided by 60,000, and tokens are its summed `usage` (input, output, cache-read and cache-create). Unlike the yield's span minutes, a driver step's minutes are the durations its own events record, so they hold no idle time between steps. Lines for `final` and `budget` are not steps and are left out. In these three runs only `worker` events carry `usage`, so every other driver step's tokens are unknown. The tool records no agent count for driver steps. `review` and `merge`, two of the 19 names in `STEP_NAMES`, have no event in any of the three runs. C5 prints the names:

```
node -e 'console.log(require("./plugin/bin/lib/driver/events.js").STEP_NAMES.join(" "))'
```

It prints `policy fetch eligibility admission claim run-dir worktree worker commit test check review push pr record-pr set-config summary ci merge`. Medians below 0.01 minutes are shown as `<0.01`.

| Row | Runs | Ran | Median span minutes | Median tokens | Null-token runs | Median agents | Confirmed-finding runs | Verify-fail runs | Fix-commit runs | Outcome-changing runs |
|---|---|---|---|---|---|---|---|---|---|---|
| E-driver-policy | 3 | 3 | 0 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-fetch | 3 | 3 | 0.01 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-eligibility | 3 | 3 | <0.01 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-admission | 3 | 3 | 0.02 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-claim | 3 | 3 | 0.17 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-run-dir | 3 | 3 | <0.01 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-worktree | 3 | 3 | 0.05 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-worker | 3 | 3 | 18.0 | 508,189 | 0 | n/a | — | 0 | — | 0 |
| E-driver-commit | 3 | 3 | 0.01 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-test | 3 | 3 | 2.6 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-check | 3 | 3 | 0.01 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-push | 3 | 3 | 0.04 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-pr | 3 | 3 | 0.04 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-record-pr | 3 | 3 | <0.01 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-set-config | 3 | 3 | <0.01 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-summary | 3 | 3 | <0.01 | n/a | 3 | n/a | — | 0 | — | 0 |
| E-driver-ci | 3 | 3 | 0.07 | n/a | 3 | n/a | — | 0 | — | 0 |

### What "outcome-changing" counts and what it cannot see

An entry is outcome-changing when the step had a confirmed finding, a failed verify, or a `commit`-action commit in a step after `build`, `plan` and `tasks`. That is AC13's "a confirmed finding, a failed gate, a fix commit" as far as the run directory records it.

It cannot see a gate stop that exists only as decision-log prose: a plan-audit hard fail, a plan-review gap, a review Step 1 stop. None of those is a `verify` event, so none is counted, and no "evidenced" rule in this design rests on one.

It cannot tell a fix commit from a bookkeeping commit either. A commit event carries only `action`, `dir` and `hash` (`appendEvent(…, 'commit', …)` in `plugin/bin/lib/hooks/post-tool-use.js`), with no message. A `call-N` row holds the commits made in a dispatch call outside every nested step's span, such as one made before `build` is invoked. A `wrap-up` row holds the run's close-out commits. For the `call-N` and `wrap-up` rows, the fix-commit and outcome-changing columns say that a commit was made, not that the step changed the outcome. In every row a fix-commit count can include bookkeeping commits, so no "evidenced" rule in this design rests on a fix-commit rate alone.

### Caveats

The numbers come from one machine. Cloud routine runs are not in its run directories, and this repository's own development sessions are most of them. Consumer projects on older releases are not seen. The 100-run window spans the start times printed above, a little over two days, so a lane's numbers describe the plugin as it ran in those days. The record's Current State counts were measured on 2026-11-16 with scratch scripts and a different ordering rule; the counts in this section come from C1 and are the ones this design uses.

## Step vocabulary

<!-- filled by Task 3 -->

## Not a step

<!-- filled by Task 3 -->

## Today's graph

<!-- filled by Task 3 -->

## Inputs

<!-- filled by Task 4 -->

## Evaluation points

<!-- filled by Task 4 -->

## The selection function

<!-- filled by Task 4 -->

## Never skipped

<!-- filled by Task 4 -->

## Loops

<!-- filled by Task 5 -->

## Who walks the graph

<!-- filled by Task 6 -->

## Roster replacement

<!-- filled by Task 6 -->

## Mixed-version operation

<!-- filled by Task 6 -->

## What this design does not decide

<!-- filled by Task 7 -->

## Open records

<!-- filled by Task 7 -->

## Phase 0 — Decisions

<!-- filled by Task 7 -->

## Phase 1 — …

<!-- filled by Task 7 -->

## Left to the builder

<!-- filled by Task 7 -->

## Calls made in this document that were not discussed

<!-- filled by Task 7 -->
