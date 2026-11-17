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

A vocabulary step is the smallest unit the selection function may include or leave out on its own. Anything that always runs with its parent is part of the parent. Today a unit is left out in one of three ways: a profile skip in the roster, a selector outside the roster (the gates and conditions in Today's graph), or the unit's own check that it has nothing to work on, such as no `docs/REGISTRY.md` or no `## Manual Steps` section. Each of the three leaves a unit out while the rest of its skill runs, so each such unit is a step here. The 33 steps below are the closed list. Later sections use these names and no others.

A setting that changes how much of a step runs, without leaving out a unit that has its own body, is a mode of the step, not a step. Three steps have modes today. `plan` composes a one-task micro-plan in place of `/superpowers:writing-plans` (`build/micro-plan.md`). `review-code` runs at one of five review-effort tiers, which set its lens scope and whether cross-lens corroboration, debate, refutation and the gap-sweep run (`review/code-mode-steps.md` Step 2.5). `wrap-up` runs under `fast-lane` with reflect in light mode, smaller curation budgets and the ceremony escape hatch armed (`wrap-up/SKILL.md` Reflect, The registry, Ceremony escape hatch). The effort-gated review passes are not steps, because the tier that selects them also sets the lens scope, which no step name can carry.

Skill paths in this section and the two after it are relative to `plugin/skills/`.

**Names.** A name the code already uses is kept where it names the same unit. `plan`, `tasks`, `test`, `polish`, `wrap-up` and `merge` are `PHASES` names (`plugin/bin/lib/timing/derive.js`); `plan-audit`, `plan-review` and `architecture-alignment` are roster tags; `stories`, `journeys`, `visual-review` and `simplify` are skill names. Four of the `PHASES` names span more than the step, because `derivePhases` bounds each phase by events: the `plan` phase runs from `/superpowers:writing-plans` to the start of `/superpowers:subagent-driven-development`, so it also holds `plan-audit`, `plan-review` and `design-pre-build`; the `tasks` phase runs from that start to the next `verify` event, which only a `verify.js --run` call writes (`writeVerifyEvent` in `plugin/bin/verify.js`) and the per-task test runs do not pass (`build/dispatch.md`, Affected-set testing), so it holds `whole-branch-review`, `simplify`, `architecture-alignment`, `journeys` and `docs-sync` unless an earlier `--run` call ends it; the `test` phase spans the whole skill, `qa` and `design-gate` included; the `merge` phase runs from the first push after wrap-up starts to the PR's merge time. The other names differ from their source as follows:

- `worktree-setup` is build Spec Step 1 and Common Step 1, named for `build/worktree-setup.md`, which both follow.
- `manual-steps` is build Spec Step 2.5; `docs-sync` is Common Step 6.5; `operational-checklist` is Common Step 5.5; `verify` is Common Step 5 (Final Verification), not the driver's `test` step.
- `whole-branch-review` is roster tag `sdd-whole-branch-review`: the final review in `build/dispatch.md`'s "Whole-branch review model".
- `design-pre-build`, `design-gate`, `design-review` and `polish` are `/claude-tweaks:design-wrapper`'s `pre-build`, `test`, `review` and `polish` modes; `design-gate` is test Step 1.5 (Design CLI gate) and `design-review` is review Step 6.5 (Design Quality Pass).
- `qa` is `/claude-tweaks:test`'s QA story validation.
- `review-spec`, `review-promises` and `review-hindsight` are roster tags `review-step-1`, `review-step-1.6` and `review-step-4`. `review-code` is review Steps 1.5, 2, 2.5, 3 and 7, which no roster row skips. `review-simplify` is review Step 5.
- `security-hardening`, `agent-trust-scope` and `app-store-readiness` are review Steps 6.6, 6.65 and 6.66, named for the code-health focus criteria they reuse.
- `creative-survey` and `depth-survey` are `/claude-tweaks:flow` Step 5's Creative Opportunities and Depth Opportunities surveys; the first is also a policy key.

**Two process-efficiency phases already changed steps named here, and the table records the form on this commit.** Unit 4.2 (#5605, merged as `b3517f6602`) put a `skill-gate.js` call in front of `design-pre-build`, `journeys`, `design-gate`, `visual-review`, `design-review`, `polish` and `creative-survey` (`_shared/skill-load-gate.md`), so a skill with nothing to do is never loaded. The gate's verdict is an input to the selection function, not a second selector. Phase 6 (#5599, merged as `ecd6469c0e`) lets `review-code`'s agent lenses run through the plugin workflow `claude-tweaks:review-lens-fanout` when the policy key `review-lens-dispatch` resolves `workflow` (`review/step3-lens-dispatch.md`'s Workflow dispatch). The key defaults to `task` (`plugin/bin/lib/policy-schema.js`), and Task dispatch stays the fallback, so the step's unit and outputs are unchanged.

**Model profile.** "Walker" means the agent walking the run performs the step itself. Under `/claude-tweaks:dispatch` that is the first Task call, `[Use: Capable]`, for `worktree-setup` through `design-gate`, and the second, `[Use: Standard]`, for `review-spec` onward (`dispatch/task-prompt.md`, First call and Second call). In a top-level `/claude-tweaks:flow` run it is the session's model. #4030 owns the first call's profile. The column records today's profiles and this design changes none.

**Evidence.** The Evidence column names the Evidence rows that cover the step. A row's minutes are wall spans, idle time included, and its outcome counts are over the entries in which the step ran (`ranRuns`). A step that runs inside another step's span has no row of its own: it is marked "not measured separately", with the rows whose span holds it. A driver row is named as a step's driver counterpart where the driver step does the same work.

| Step | What it does | Performer | Body today | Produces | Reads | Model profile today | Evidence |
|---|---|---|---|---|---|---|---|
| `worktree-setup` | Creates the worktree, materializes the record's spec as the branch's first commit, stamps the worktree in the run state and opens the draft PR | model, calling programs | build Spec Step 1 and Common Step 1: `materialize.js`, `/superpowers:using-git-worktrees`, `build/worktree-setup.md` (Step 4.5 `record-worktree`, Step 6 `pr-early-open.js`); under `/claude-tweaks:flow`, the worktree and the materialize commit come before `/claude-tweaks:build` is invoked (`flow/SKILL.md` Step 4) | the worktree and branch; `work/{n}-spec.md`; `run-state.json`'s `worktree` and `pr`; the draft PR under `pr-first`; `staged/premise-satisfied-{n}.md` when the record's `Premise-check:` already holds at base | the record (`materialize.js`); the Manifesto's ceremony verdict for an unlabeled record (`--ceremony`); `integration-model` | walker | not measured separately (inside E-standard-call-1, E-fast-lane-call-1, and E-standard-build, E-fast-lane-build for the part `/claude-tweaks:build` runs); driver counterpart E-driver-worktree |
| `manual-steps` | Probes each `## Manual Steps` item, or each Deliverable when all are operational, for a CLI and credentials, then executes, seeds or escalates it | model | build Spec Step 2.5, `build/manual-steps.md` | executed operations; `ops` ledger rows for what it cannot run | `work/{n}-spec.md` (`## Manual Steps`, `## Deliverables`) | walker | not measured separately (inside E-standard-build, E-fast-lane-build) |
| `plan` | Checks for an existing plan and for an already-satisfied record, probes the spec's `ASSUMPTION — verify at build:` lines, writes the plan, and runs the plan audit's floor. Mode: micro-plan | model; program for the floor (`plan-audit.js --bytes`, `--risk-proofs`) | build Spec Steps 2-3 (Design Steps 1-3 in design mode): `/superpowers:writing-plans`, or `build/micro-plan.md`; Common Step 1.5's Check D and Check G, which run on its skip path too | `docs/superpowers/plans/YYYY-MM-DD-{feature}.md`; one `decisions.md` line per assumption probe; on an already-shipped record, `OUTCOME: already-shipped` and a staged Close proposal | `work/{n}-spec.md` (for micro-plan: its header's `ceremony:` and `size:`, `### Key Files`, `Risk-flags:`); the materialize envelope's `premise` and `template`; an existing plan in `docs/superpowers/plans/` | walker | E-standard-plan, E-fast-lane-plan (the phase also holds `plan-audit`, `plan-review` and `design-pre-build`; a micro-plan run has no `plan` span) |
| `plan-audit` | Audits the plan against the repository: every Files path exists, the `Scope keywords:` sweep, each task's `Expected: FAIL` pre-run, skill-file headroom, and spec coverage with `--spec`; adds missed files per the `scope-creep` policy | program (`plan-audit.js`); model routes its findings | build Common Step 1.5, `build/plan-audit.md` | the audit's JSON envelope; plan amendments | the plan file; `work/{n}-spec.md` (`--spec`); `config.yml`'s `ceremony-profile` (skip gate) | walker | not measured separately (inside E-standard-plan) |
| `plan-review` | One reviewer reads the spec and the plan before any code and returns spec gaps, undecided behaviour and the other classes `build/plan-review.md` names; a resolvable finding amends the spec and plan, a needs-human spec gap stops the run | model | build Common Step 1.6, `build/plan-review.md` | `## Plan Review Clarifications` in `work/{n}-spec.md`; plan amendments in the same commit; a record comment; a re-audit with `plan-audit.js` | the worktree's `work/{n}-spec.md`; the plan file; `config.yml`'s `ceremony-profile`; `decisions.md` (an earlier review of the same plan in this run) | Capable (`build/plan-review.md` Dispatch) | not measured separately (inside E-standard-plan) |
| `design-pre-build` | Loads Impeccable's references and the project's design context into the implementer prompts | model | build Common Step 1.7: `skill-gate.js`, then `/claude-tweaks:design-wrapper pre-build` (`build/design-prebuild.md`) | design references in the implementer prompts | the spec header's `surface:`; the design-integration setting; `PRODUCT.md` and `DESIGN.md` | walker | not measured separately (inside E-standard-plan, E-fast-lane-plan) |
| `tasks` | Executes the plan: one implementer per task, each followed by its task review; probes for a dispatch tool first and catches up with the integration branch after the last task; routes blocked work to the ledger | model | build Common Step 2 (`build/dispatch.md`: `/superpowers:subagent-driven-development`, or `/superpowers:executing-plans` under `batched`), the dispatch-capability preflight at the head of Common Step 1.5, the pre-review catch-up (`pre-review-catchup.js`), and Common Step 4 | the build's commits; `sdd-dispatch-sample.txt` (the AC-forwarding check); ledger rows for blocked work | the plan file; `work/{n}-spec.md` (the Acceptance Criteria it forwards; the header's `size:`); `plan-audit.js --task-markers`; the composed `sdd-child` context bundle | implementer by the header's `size:`: `low` Fast, `medium` Standard, `high` Capable; a task's `Role:` marker and the `profile=` token override it; task review by `Review risk:` (`build/dispatch.md`) | E-standard-tasks, E-fast-lane-tasks; driver counterpart E-driver-worker, E-driver-commit |
| `whole-branch-review` | SDD's final review of the whole branch after the last task review, with its fix wave and re-review | model | `build/dispatch.md` "Whole-branch review model" | review findings; fix-wave commits | the branch diff from the catch-up's `reviewBase`; `diff-facts.js` (`computeDiffFacts`); `config.yml`'s `ceremony-profile` and `plan-audit.js --count-tasks` (skip gate) | Capable; Standard on a diff of at most one implementation file and under 60 lines (`resolve-profile.js --diff-facts`, `build/dispatch.md`) | not measured separately (inside E-standard-tasks, E-fast-lane-tasks) |
| `simplify` | Simplifies the build's changed code and logs the simplified tree | model | build Common Step 3: `/claude-tweaks:simplify` (the `code-simplifier:code-simplifier` agent) | a simplification commit; the `decisions.md` line `Common Step 3: simplify: scope simplified at {sha}` | the files the build changed | Standard (`simplify/SKILL.md`) | not measured separately (inside E-standard-tasks, E-fast-lane-tasks, which end at `verify`) |
| `architecture-alignment` | Compares what was built with the spec and sorts each mismatch into Beneficial, Fix now or Update the spec; routes a module-level deviation to `/claude-tweaks:deepen` | model | build Common Step 4.5, `build/architecture-alignment.md` | fix commits; spec updates; ledger rows | `work/{n}-spec.md` or the design doc; the diff; `config.yml`'s `ceremony-profile` | walker | not measured separately (inside E-standard-tasks, which ends at `verify`) |
| `journeys` | Documents the user journeys the build touched | model | build Common Step 6: `skill-gate.js`, then `/claude-tweaks:journeys` | `docs/journeys/*.md` | the files the build changed; the spec | walker | not measured separately (inside E-standard-tasks, E-fast-lane-tasks, which end at `verify`) |
| `docs-sync` | Updates registered docs matching the changed files, or defers them to wrap-up | model | build Common Step 6.5, `build/docs-sync.md` | doc updates; deferrals to wrap-up | `docs/REGISTRY.md`; the changed files | walker | not measured separately (inside E-standard-tasks, E-fast-lane-tasks, which end at `verify`) |
| `verify` | Applies Category A operational fixes, catches up with a moved base, runs types, lint and tests and fixes what fails; then closes the build (Common Step 7: the bookkeeping assertion, the handoff and the phase-exit push) | program (`verify.js`, `phase-exit.js`); model fixes failures | build Common Steps 5 and 7, `test/verification.md`, `_shared/pre-verification-catchup.md` | `report.json`; the runner pass stamp; a `verify` event; `VERIFICATION_PASSED` and `VERIFICATION_SHA`; the pushed branch under `pr-first` | `.claude-tweaks/verify-scope.json`; the project's CLAUDE.md commands; the tree `journeys` and `docs-sync` wrote | walker | not measured separately (inside E-standard-build, E-fast-lane-build); driver counterpart E-driver-test, E-driver-check |
| `operational-checklist` | Runs the Category B operational tasks and writes a ledger row per operational finding (schema, env, IaC, CI, platform config), a `fixed` row per Category A fix included | model | build Common Step 5.5, `build/operational-checklist.md` | ledger rows; Category B results | the build's diff; `Category A` commits since the build started | walker | not measured separately (inside E-standard-build, E-fast-lane-build) |
| `stories` | Browses the app and writes QA story YAML for the changed UI | model | `/claude-tweaks:stories`, inserted by `/claude-tweaks:flow` after the build (`flow/SKILL.md` Automatic story generation) | `stories/*.yaml`; `STORIES_DIR` and `DEV_URL` | `docs/journeys/*.md`; the dev server URL (`_shared/dev-url-detection.md`) | walker | not measured separately (`stories` nests in the enclosing phase, `NESTED_PARENT`) |
| `test` | The test gate: the PR-bookkeeping check, verification unless `verify`'s pass still covers HEAD, the PR-check read, then `TEST_PASSED`; fix mode on a straightforward failure | program (`check-pr-bookkeeping.js`, `verify.js`, `pr-checks.js`); model in fix mode | `/claude-tweaks:test` Steps 0, 1 (the standard suite), 2 and 3 | `TEST_PASSED`; a pass stamp when it re-ran; fix commits; the phase-exit push | `VERIFICATION_PASSED` and `VERIFICATION_SHA` (from `verify`); `verify.js --stamp-status`; `run-state.json` (Step 0); the PR's checks (`_shared/pr-check-gate.md`) | walker | E-standard-test, E-fast-lane-test, E-none-test (the phase also holds `qa` and `design-gate`) |
| `qa` | Selects the stories whose `source_files` meet the changed files and runs them in a browser | model | `/claude-tweaks:test`'s QA story validation, `test/qa-procedures.md` | `{run-dir}/report.json`; the QA pass stamp; `test/qa` ledger rows | `stories/*.yaml` (from `stories`, or already in the repository); `verify.js --changed-files --ignore-stamp`; `qa-stamp.js --check`; `DEV_URL` | qa-agent workers, `[Use: Standard]` (`test/qa-prompts.md`) | not measured separately (inside E-standard-test, E-fast-lane-test) |
| `design-gate` | Runs the deterministic Impeccable CLI check on the changed frontend files; a `warning` finding fails the test gate | program (the Impeccable CLI, through the wrapper) | test Step 1.5: `skill-gate.js`, then `/claude-tweaks:design-wrapper test` (`test/design-gate.md`) | a Design CLI pass, fail or skip | `verify.js --changed-files --ignore-stamp`; `surface:` | walker | not measured separately (inside E-standard-test, E-fast-lane-test) |
| `review-spec` | Checks deliverables, acceptance criteria, Non-Goals, risk markers, the Current State's outcome and PR-body deliverables against the spec; a significant gap or an unresolved risk marker is BLOCKED | model | review Step 1 (`review/code-mode-steps.md`) | the spec-compliance verdict in the review summary | `work/{n}-spec.md`, `plan-review`'s clarifications included; `decisions.md`'s `AC evidence` entries and their `evidence/` logs; the live PR body | walker | not measured separately (inside E-standard-review) |
| `review-promises` | Updates a parent record's promise table and tracks forward assumptions | model | review Step 1.6, `review/cross-spec-promise-check.md` | updates to the parent's promise table | the parent record's `## Cross-Spec Promises` | walker | not measured separately (inside E-standard-review) |
| `review-code` | The test gate (Step 1.5), the change set and its review effort, the code-review lenses with reproduction, corroboration or debate, tiebreak, routing and fix waves, then the summary, verdict and verdict comment. Mode: the review-effort tier | model; programs for coordination (`build-review-context.js`, `review-coordination.js`) | review Steps 1.5, 2, 2.5, 3 (3.5 to 3.7 and Step 3 Routing included) and 7; `review/step3-lens-dispatch.md` | findings; fix commits; the verdict; the review summary with its Key Learnings; the verdict PR comment; the phase-exit push | `TEST_PASSED`; `verify.js --stamp-status`; the `test/qa` ledger rows and QA results; `decisions.md` (the ledger's creation, `/build`'s not-run steps); the record's `risk:*` and `size:*` labels; `run-state.json`'s `pr` | lenses 3a and 3f Fast, 3b-3e and 3g Standard, 3h Capable (`review/step3-lens-dispatch.md`); tiebreak Capable or Standard per chunk (`review/step3-tiebreak.md`); refutation Capable and gap-sweep Frontier (`review/step3-debate-and-refutation.md`) | E-standard-review, E-fast-lane-review (the phase spans the whole skill: every `review-*` step and the gated passes after them) |
| `review-hindsight` | Evaluates the approach in hindsight and applies "Change now" fixes | model | review Step 4: `/claude-tweaks:reflect` in hindsight mode | `review/hindsight` ledger rows; fix commits, each followed by a `/claude-tweaks:test` re-run | the scope Steps 2-3 analysed | walker | not measured separately (inside E-standard-review) |
| `review-simplify` | Simplifies the review's file scope when a fix touched it after `simplify` | model | review Step 5: `/claude-tweaks:simplify` | simplification commits | the `## /build` line `Common Step 3: simplify: scope simplified at {sha}` in `decisions.md` (skip test); Step 2's own-work file scope | Standard (`simplify/SKILL.md`) | not measured separately (inside E-standard-review, E-fast-lane-review) |
| `visual-review` | In code mode, a browserless recommendation naming the affected journeys; in full mode, a browser review of the running app | model | review Step 6: `skill-gate.js`, then `/claude-tweaks:visual-review` | "UI / Visual" findings, or the recommendation | Step 2's diff scope; `surface:`; `docs/journeys/*.md`; QA results; `DEV_URL` | Standard page and discover agents (`visual-review/page-mode.md`, `visual-review/discover-mode.md`) | not measured separately (inside E-standard-review, E-fast-lane-review) |
| `design-review` | Impeccable's critique and audit of the changed UI files, plus Impeccable's finish reviewer when a direction contract exists; advisory | model | review Step 6.5: `skill-gate.js`, then `/claude-tweaks:design-wrapper review` | Design Quality findings; `staged/design-decision-*.md` | the changed UI files; `surface:`; the surface brief's direction contract | walker; the finish reviewer is a third-party agent | not measured separately (inside E-standard-review, E-fast-lane-review) |
| `security-hardening` | Judges the client-side and route files in the diff against the security-hardening criterion | model | review Step 6.6, `review/focus-criterion-passes.md` | judged findings | Step 2's diff scope (pre-check: `CLIENT_DIR_RE`, `ROUTE_DIR_RE`) | walker | not measured separately (inside E-standard-review, E-fast-lane-review) |
| `agent-trust-scope` | Judges changes to `.claude/settings.json` and `.claude-tweaks/policy.yml` | model | review Step 6.65, `review/focus-criterion-passes.md` | judged findings | Step 2's diff scope (pre-check: either file touched) | walker | not measured separately (inside E-standard-review, E-fast-lane-review) |
| `app-store-readiness` | Judges the mobile-app files in the diff against the app-store-readiness criterion | model | review Step 6.66, `review/focus-criterion-passes.md` | judged findings | Step 2's diff scope (pre-check: a mobile-app signal) | walker | not measured separately (inside E-standard-review, E-fast-lane-review) |
| `polish` | Impeccable's refinement set (polish, clarify, harden) plus the commands an audit finding names, then one re-verify when it changed code | model | the `/claude-tweaks:flow` polish phase: `skill-gate.js`, then `/claude-tweaks:design-wrapper polish` (`flow/polish-execution.md`), then `/claude-tweaks:test skip-qa` | code changes; a ledger entry; `decisions.md` `AUTO` and `STAGED` lines for `commands_invoked` and `staged_suggestions`; the phase-exit push, or the PR checklist row's removal on a skip | the review verdict (PASS); `config.yml`'s `ceremony-profile`; the branch's changed files; `surface:` and `design-intent:` | walker | E-standard-polish |
| `wrap-up` | Establishes the run, reflects, routes each learning through the curation registry, settles leftovers and the ledger, runs the Review Console, executes the approved actions, then closes and archives the run. Mode: `standard` or `fast-lane` | model; programs (`wrap-up-engine.js`, `wrap-up-pack.js`, `phase-timing.js`) | `/claude-tweaks:wrap-up` Phases 1-4 | applied and staged curation items; the console's resolutions; acceptance labeling; the closing carrier commit; `close-run`; the archived run directory; the phase-trace report | the review summary (Step 1's verdict, findings, Key Learnings); `config.yml`'s `ceremony-profile` and `mode`; `decisions.md`; `staged/`; the ledger; `report.json`'s `flakyEscalation`; the plan file (the packet snapshot) | walker; curation judgment Capable per row with three or more open rows, else one Frontier agent (`wrap-up/curation-engine.md`) | E-standard-wrap-up, E-fast-lane-wrap-up, E-none-wrap-up, E-express-wrap-up |
| `merge` | With a merge authorized under `pr-first`: the `merge-check` content judgment, then `_shared/pr-first-merge.md`: acceptance labeling landed, mark ready, the merge-verification gate (CI) and `gh pr merge --auto` | model, calling programs | the Auto-merge short-circuit in wrap-up's Review Console (`wrap-up/auto-merge-short-circuit.md`), or `dispatch/settle-and-merge.md`'s Auto-merge gate; `_shared/pr-first-merge.md` | a merged or armed PR, or `pending-review` | the record's live `auto:build` and `auto:merge` labels; `wrap-up-pack.json`'s `inputs.closingRecords`; `run-state.json`'s `pr`; `verify.json`'s `acceptance-labeling` row; `engine-state.json` (the curation-apply guard); the PR's checks | walker | E-standard-merge, E-fast-lane-merge (CI and human waits included); driver counterpart E-driver-ci |
| `creative-survey` | Ranks creative Impeccable commands worth running by hand; recommends only | model | `/claude-tweaks:flow` Step 5: `skill-gate.js`, then `/claude-tweaks:design-wrapper survey` (`flow/survey.md`) | the Creative Opportunities block | the full diff's changed files; the prior-recommendations cache (decline detection) | walker | not measured separately |
| `depth-survey` | Ranks shallow-module candidates in the changed source files; recommends only | model | `/claude-tweaks:flow` Step 5: `/claude-tweaks:deepen`'s analysis-only path (`flow/survey.md`) | the Depth Opportunities block; `staged/deepen-collapse-{n}.patch` | the changed source files | walker | not measured separately |

## Not a step

These names appear in the sources the vocabulary was built from and are not steps. Each is a container of steps, the run's frame before the first step, a selector, a skill outside the run, a utility any step may call, or a stop inside a step.

| Name | Source | Reason |
|---|---|---|
| `call-1`, `call-2` | `PHASES` | A container: the span of one `/claude-tweaks:flow` invocation (`derivePhases`), which `/claude-tweaks:dispatch` makes once per Task call (`dispatch/two-call-gate.md`). It holds steps; the function selects the steps, not the call that runs them. |
| `call-3` to `call-6` | `timing.json` phases outside `PHASES` | The same container for a later `/claude-tweaks:flow` invocation in the same run directory: a context-handoff continuation (`flow/context-handoff.md`), or a resumed or repeated call. |
| `build` | Allowed Steps; `PHASES` | A skill holding the steps `worktree-setup` through `operational-checklist`. `/claude-tweaks:flow`'s step argument names it, and its phase spans the whole skill. |
| `review` | Allowed Steps; `PHASES` | A skill holding the steps `review-spec` through `app-store-readiness`. |
| `review-console` | Allowed Steps, the text under the table | A resume-only entry for a multi-spec run that re-presents the consolidated console. It re-enters `wrap-up`'s console and runs no step of its own. |
| `specify` | `timing.json` | `/claude-tweaks:specify` shapes the record before any run, and is not allowed in `/claude-tweaks:flow` (Allowed Steps). |
| `tidy`, `visualize`, `dispatch` | `timing.json`; `tidy` is also row E-standard-tidy | Skills outside a run's steps: `tidy` is not allowed in `/claude-tweaks:flow`, `visualize` is a utility skill, and `dispatch` is the queue consumer that starts runs. `derivePhases` opens a phase for any top-level skill invocation it finds in the run's events, so these phases are invocations that landed in a run directory. |
| `red-team-persona` | roster, `## Skips by profile` | A `/claude-tweaks:specify` step (`specify/red-team.md`) that runs before any run. |
| `capture` | `NESTED_PARENT` | A utility any step may call to file a follow-up record; not allowed in `/claude-tweaks:flow`. |
| `challenge` | `NESTED_PARENT` | Called from `/claude-tweaks:specify` and `/claude-tweaks:backlog`, before a run; no step of a run calls it. |
| `ledger` | `NESTED_PARENT` | A knowledge dependency the steps read and write; its own description says it is never invoked through the Skill tool. |
| `policy`, `fetch`, `eligibility`, `admission` | `STEP_NAMES` | The driver lane's entry: they decide whether a record enters the lane, which this design leaves unchanged (Non-goals). The standard lane reads policy and the record in `/claude-tweaks:flow`'s pre-flight and Manifesto, before the first step. |
| `claim`, `run-dir` | `STEP_NAMES` | The run's frame. The standard lane claims at `/claude-tweaks:flow` Step 2.8 (`flow/claim-targets.md`) and has its run directory before any step runs. |
| `review` (driver) | `STEP_NAMES` | The driver's read-only reviewer worker, whose findings count only with a red test (`docs/driver.md`, The reviewer step). No standard-lane step works that way; it stays the driver's. |
| `set-config`, `summary` | `STEP_NAMES` | Bookkeeping: `set-config` writes the run's `config.yml` from `check`'s `configSet`, and `summary` logs one decision line (`plugin/bin/lib/driver/steps.js`). |
| Ceremony-Aware Step Selection | review (`review/code-mode-steps.md`) | A selector: the `fast-lane` skip of review Steps 1, 1.6 and 4. Roster replacement covers it. |
| Diff-derived ceremony default | wrap-up (`wrap-up/SKILL.md`) | A selector: `ceremony-derive.js`'s narrowing of `standard` to `fast-lane` at wrap-up. Roster replacement covers it. |
| Common Steps 3 + 4.5 | build (`build/SKILL.md`) | An ordering rule: `simplify` finishes, its commit included, before `architecture-alignment` starts. |
| HARD-GATEs | roster, `## Never skipped` | A set of stops, each inside a step. The HARD-GATE row of `_shared/auto-mode-contract.md` lists them: review Step 1 (`review-spec`); review Step 1.5's test gate (`review-code`); `/build` Design Step 3's plan validation (`plan`); the plan audit's hard fails (`plan-audit`, with Check D in `plan`); test Step 0 (`test`); the adopted-branch collision stop (`worktree-setup`); the plan-review needs-human spec gap (`plan-review`); `/claude-tweaks:flow` Step 2.7's design-doc rejection and the multi-spec boundary-freshness escalation, both in the run's frame; and `/release` Step 4, outside any run. Never skipped places each. |

### Placement list

Every name collected for the vocabulary, mapped to a vocabulary step, to "part of" one, or to Not a step. The sources are `flow/steps-and-gates.md`'s Allowed Steps table and the text under it; the numbered step headings of `build/SKILL.md` and `test/SKILL.md`; the step headings of `review/code-mode-steps.md`; the phase headings of `wrap-up/SKILL.md` and the headings under them; `PHASES` and `NESTED_PARENT` in `plugin/bin/lib/timing/derive.js` and the `timing.json` phases outside `PHASES`; `STEP_NAMES` in `plugin/bin/lib/driver/events.js`; and the rows of the roster's `## Skips by profile` and `## Never skipped`. A driver step placed as part of a vocabulary step does that step's work in the driver lane; the driver keeps its own body.

| Name | Source | Placement |
|---|---|---|
| `build` | Allowed Steps | Not a step |
| `stories` | Allowed Steps | `stories` |
| `test` | Allowed Steps | `test` (the skill also runs `qa` and `design-gate`) |
| `review` | Allowed Steps | Not a step |
| `polish` | Allowed Steps | `polish` |
| `wrap-up` | Allowed Steps | `wrap-up` |
| `re-verify` | Allowed Steps, text | part of `polish` |
| `review-console` | Allowed Steps, text | Not a step |
| `build Spec Step 1` | `build/SKILL.md` | part of `worktree-setup` |
| `build Spec Step 2` | `build/SKILL.md` | part of `plan` |
| `build Spec Step 2.5` | `build/SKILL.md` | `manual-steps` |
| `build Spec Step 3` | `build/SKILL.md` | `plan` |
| `build Design Step 1` | `build/SKILL.md` | part of `plan` |
| `build Design Step 2` | `build/SKILL.md` | part of `plan` |
| `build Design Step 3` | `build/SKILL.md` | part of `plan` |
| `build Common Step 1` | `build/SKILL.md` | part of `worktree-setup` |
| `build Common Step 1.5` | `build/SKILL.md` | `plan-audit` (its floor, Check D and Check G, is part of `plan`; its dispatch-capability preflight is part of `tasks`) |
| `build Common Step 1.6` | `build/SKILL.md` | `plan-review` |
| `build Common Step 1.7` | `build/SKILL.md` | `design-pre-build` |
| `build Common Step 2` | `build/SKILL.md` | `tasks` (its final whole-branch review is `whole-branch-review`) |
| `build Common Steps 3 + 4.5` | `build/SKILL.md` | Not a step |
| `build Common Step 3` | `build/SKILL.md` | `simplify` |
| `build Common Step 4` | `build/SKILL.md` | part of `tasks` |
| `build Common Step 4.5` | `build/SKILL.md` | `architecture-alignment` |
| `build Common Step 6` | `build/SKILL.md` | `journeys` |
| `build Common Step 6.5` | `build/SKILL.md` | `docs-sync` |
| `build Common Step 5` | `build/SKILL.md` | `verify` |
| `build Common Step 5.5` | `build/SKILL.md` | `operational-checklist` |
| `build Common Step 7` | `build/SKILL.md` | part of `verify` (it closes the build, after `operational-checklist` when that step runs) |
| `test Step 0` | `test/SKILL.md` | part of `test` |
| `test Step 1` | `test/SKILL.md` | `test` (its QA story run is `qa`) |
| `test Step 1.5` | `test/SKILL.md` | `design-gate` |
| `test Step 2` | `test/SKILL.md` | part of `test` |
| `test Step 3` | `test/SKILL.md` | part of `test` |
| `review Ceremony-Aware Step Selection` | `review/code-mode-steps.md` | Not a step |
| `review Step 1` | `review/code-mode-steps.md` | `review-spec` |
| `review Step 1.5` | `review/code-mode-steps.md` | part of `review-code` |
| `review Step 1.6` | `review/code-mode-steps.md` | `review-promises` |
| `review Step 2` | `review/code-mode-steps.md` | part of `review-code` |
| `review Step 2.5` | `review/code-mode-steps.md` | part of `review-code` |
| `review Step 3` | `review/code-mode-steps.md` | `review-code` |
| `review 3g-cov` | `review/code-mode-steps.md` | part of `review-code` |
| `review 3h` | `review/code-mode-steps.md` | part of `review-code` |
| `review 3i` | `review/code-mode-steps.md` | part of `review-code` |
| `review 3j` | `review/code-mode-steps.md` | part of `review-code` |
| `review Cross-Lens Corroboration` | `review/code-mode-steps.md` | part of `review-code` |
| `review Step 3.5 & 3.6` | `review/code-mode-steps.md` | part of `review-code` |
| `review Step 3.7` | `review/code-mode-steps.md` | part of `review-code` |
| `review Step 3 Routing` | `review/code-mode-steps.md` | part of `review-code` |
| `review Step 4` | `review/code-mode-steps.md` | `review-hindsight` |
| `review Step 5` | `review/code-mode-steps.md` | `review-simplify` |
| `review Step 6` | `review/code-mode-steps.md` | `visual-review` |
| `review Step 6.5` | `review/code-mode-steps.md` | `design-review` |
| `review Step 6.6` | `review/code-mode-steps.md` | `security-hardening` |
| `review Step 6.65` | `review/code-mode-steps.md` | `agent-trust-scope` |
| `review Step 6.66` | `review/code-mode-steps.md` | `app-store-readiness` |
| `review Step 6.7` | `review/code-mode-steps.md` | part of `visual-review`, `design-review`, `security-hardening`, `agent-trust-scope` and `app-store-readiness` (it routes their findings once, after the last of them) |
| `review Step 7` | `review/code-mode-steps.md` | part of `review-code` |
| `wrap-up Phase 1 ESTABLISH` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Identify the work context` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Summarize completed work` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Establish the run directory` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Diff-derived ceremony default` | `wrap-up/SKILL.md` | Not a step |
| `wrap-up Reflect` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Ceremony escape hatch` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Phase 2 ROUTE` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up The registry` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Run the engine` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Phase 3 SETTLE` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Leftover work` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Efficiency budget` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Nothing left behind` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Newly unblocked records` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Phase 4 CLOSE` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Plan cleanup actions` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up Wrap-Up Review Console` | `wrap-up/SKILL.md` | part of `wrap-up` (its Auto-merge short-circuit is `merge`) |
| `wrap-up Execute approved actions` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `wrap-up The phase-trace report` | `wrap-up/SKILL.md` | part of `wrap-up` |
| `PHASES call-1` | `PHASES` | Not a step |
| `PHASES call-2` | `PHASES` | Not a step |
| `PHASES build` | `PHASES` | Not a step |
| `PHASES plan` | `PHASES` | `plan` |
| `PHASES tasks` | `PHASES` | `tasks` |
| `PHASES test` | `PHASES` | `test` |
| `PHASES review` | `PHASES` | Not a step |
| `PHASES polish` | `PHASES` | `polish` |
| `PHASES wrap-up` | `PHASES` | `wrap-up` |
| `PHASES merge` | `PHASES` | `merge` |
| `timing.json call-3` | `timing.json` | Not a step |
| `timing.json call-4` | `timing.json` | Not a step |
| `timing.json call-5` | `timing.json` | Not a step |
| `timing.json call-6` | `timing.json` | Not a step |
| `timing.json specify` | `timing.json` | Not a step |
| `timing.json visualize` | `timing.json` | Not a step |
| `timing.json dispatch` | `timing.json` | Not a step |
| `timing.json tidy` | `timing.json` (row E-standard-tidy) | Not a step |
| `NESTED_PARENT simplify` | `NESTED_PARENT` | `simplify` (the skill is also the body of `review-simplify`) |
| `NESTED_PARENT reflect` | `NESTED_PARENT` | part of `wrap-up` (the skill is also the body of `review-hindsight`) |
| `NESTED_PARENT visual-review` | `NESTED_PARENT` | `visual-review` |
| `NESTED_PARENT capture` | `NESTED_PARENT` | Not a step |
| `NESTED_PARENT design-wrapper` | `NESTED_PARENT` | part of `design-pre-build`, `design-gate`, `design-review`, `polish` and `creative-survey` (the body of each, by mode) |
| `NESTED_PARENT challenge` | `NESTED_PARENT` | Not a step |
| `NESTED_PARENT assess-agent-autonomy` | `NESTED_PARENT` | part of `merge` (its `merge-check` mode) |
| `NESTED_PARENT ledger` | `NESTED_PARENT` | Not a step |
| `NESTED_PARENT journeys` | `NESTED_PARENT` | `journeys` |
| `NESTED_PARENT stories` | `NESTED_PARENT` | `stories` |
| `NESTED_PARENT deepen` | `NESTED_PARENT` | `depth-survey` |
| `NESTED_PARENT feedback` | `NESTED_PARENT` | part of `wrap-up` (the Upstream feedback row files through it) |
| `STEP_NAMES policy` | `STEP_NAMES` | Not a step |
| `STEP_NAMES fetch` | `STEP_NAMES` | Not a step |
| `STEP_NAMES eligibility` | `STEP_NAMES` | Not a step |
| `STEP_NAMES admission` | `STEP_NAMES` | Not a step |
| `STEP_NAMES claim` | `STEP_NAMES` | Not a step |
| `STEP_NAMES run-dir` | `STEP_NAMES` | Not a step |
| `STEP_NAMES worktree` | `STEP_NAMES` | part of `worktree-setup` |
| `STEP_NAMES worker` | `STEP_NAMES` | part of `tasks` |
| `STEP_NAMES commit` | `STEP_NAMES` | part of `tasks` |
| `STEP_NAMES test` | `STEP_NAMES` | part of `verify` |
| `STEP_NAMES check` | `STEP_NAMES` | part of `verify` |
| `STEP_NAMES review` | `STEP_NAMES` | Not a step |
| `STEP_NAMES push` | `STEP_NAMES` | part of `verify` |
| `STEP_NAMES pr` | `STEP_NAMES` | part of `worktree-setup` |
| `STEP_NAMES record-pr` | `STEP_NAMES` | part of `worktree-setup` |
| `STEP_NAMES set-config` | `STEP_NAMES` | Not a step |
| `STEP_NAMES summary` | `STEP_NAMES` | Not a step |
| `STEP_NAMES ci` | `STEP_NAMES` | part of `merge` |
| `STEP_NAMES merge` | `STEP_NAMES` | `merge` |
| `roster skip review-step-1` | `## Skips by profile` | `review-spec` |
| `roster skip review-step-1.6` | `## Skips by profile` | `review-promises` |
| `roster skip review-step-4` | `## Skips by profile` | `review-hindsight` |
| `roster skip plan-audit` | `## Skips by profile` | `plan-audit` |
| `roster skip plan-review` | `## Skips by profile` | `plan-review` |
| `roster skip architecture-alignment` | `## Skips by profile` | `architecture-alignment` |
| `roster skip reflect-light-mode` | `## Skips by profile` | part of `wrap-up` (its `fast-lane` mode) |
| `roster skip red-team-persona` | `## Skips by profile` | Not a step |
| `roster skip sdd-whole-branch-review` | `## Skips by profile` | `whole-branch-review` |
| `roster skip polish` | `## Skips by profile` | `polish` |
| `roster never review Step 2` | `## Never skipped` | part of `review-code` |
| `roster never review Step 3` | `## Never skipped` | part of `review-code` |
| `roster never review Step 5` | `## Never skipped` | `review-simplify` |
| `roster never review Step 6 rendered-UI check` | `## Never skipped` | `visual-review` |
| `roster never build Common Step 5` | `## Never skipped` | `verify` |
| `roster never reflect Near-misses, Fresh-start, Friction` | `## Never skipped` | part of `wrap-up` |
| `roster never Ceremony escape hatch` | `## Never skipped` | part of `wrap-up` |
| `roster never [IL-116] cleanup floor` | `## Never skipped` | part of `wrap-up` |
| `roster never HARD-GATEs` | `## Never skipped` | Not a step |
| `roster never test Step 1.5 Design CLI gate` | `## Never skipped` | `design-gate` |
| `roster never review Step 6.5 Design Quality Pass` | `## Never skipped` | `design-review` |

The rows of the roster's `## Mentions that are not skips` are not placed here: Roster replacement covers them.

## Today's graph

The steps a run takes today, per lane, and what decides each. `standard` and `fast-lane` are `/claude-tweaks:flow` runs under that `ceremony-profile`, read from the run's `config.yml`. Prose express is `_shared/express-lane.md`'s Procedure, and driver is `drive.js`'s `STEPS` (`plugin/bin/lib/driver/steps.js`). A cell says when the step runs and cites the file that states it. "As `standard`" means the same rule from the same file. "—" means the lane has no such step: neither `_shared/express-lane.md`'s Procedure nor `STEPS` names one.

Under `/claude-tweaks:dispatch` both profiles run as two Task calls, `worktree-setup` through `design-gate` in the first and `review-spec` onward in the second (`dispatch/two-call-gate.md`), and `fast-lane` keeps the split (`_shared/ceremony-profile.md`, "The two-call split is kept"). A design-mode build, from a design doc with no record, is a standalone `/claude-tweaks:build` path, which `/claude-tweaks:flow` rejects, so it is not in the table.

| Step | `standard` | `fast-lane` | Prose express | Driver |
|---|---|---|---|---|
| `worktree-setup` | Runs; non-skippable (`build/SKILL.md` Spec Step 1) | As `standard` | The agent starts in a worktree stamped by `record-worktree`; the draft PR opens at step 7, after the push (`_shared/express-lane.md` Procedure) | `worktree`; the draft PR opens after the push, in `pr` and `record-pr` (`steps.js`) |
| `manual-steps` | Runs when the spec has `## Manual Steps`, or every Deliverable is operational (`build/SKILL.md` Spec Step 2.5) | As `standard` | — | — |
| `plan` | `/superpowers:writing-plans` (`build/SKILL.md` Spec Step 3). An already-satisfied premise or an already-shipped record ends the build here (Spec Step 2) | Micro-plan when the header has `size: low`, `### Key Files` names at most one implementation file and the body carries no risk flag; otherwise `/superpowers:writing-plans` (`build/micro-plan.md` Applicability gate). The Spec Step 2 exits as `standard` | — (step 2 edits from the record) | — (`worker` edits from the record) |
| `plan-audit` | Runs unless the plan has fewer than 3 file references and no `Scope keywords:` (`build/SKILL.md` Common Step 1.5) | Skipped (roster `plan-audit`); Check D and Check G still run (Common Step 1.5) | — | — |
| `plan-review` | Runs unless the plan is trivial by Common Step 1.5's test (`build/SKILL.md` Common Step 1.6) | Skipped (roster `plan-review`) | — | — |
| `design-pre-build` | Runs when `skill-gate.js` proceeds for `design-wrapper pre-build` (design integration on; a surface that is not absent, `backend` or `infra`) and the plan is not trivial (`_shared/skill-load-gate.md` Rules; `build/design-prebuild.md`) | As `standard` | — | — |
| `tasks` | Runs: one implementer and one task review per task (`build/SKILL.md` Common Step 2, `build/dispatch.md`) | As `standard` | Steps 2-3: edit, then commit by explicit path | `worker`, then `commit` |
| `whole-branch-review` | Runs at any task count, on Capable, or Standard on a diff of at most one implementation file and under 60 lines (`resolve-profile.js --diff-facts`, `build/dispatch.md` "Whole-branch review model") | Skipped when `plan-audit.js --count-tasks` prints `tasks: 1` and `batched: false`; otherwise as `standard` (`build/dispatch.md`, single-task fast-lane skip) | — | — |
| `simplify` | Runs (`build/SKILL.md` Common Step 3) | As `standard` | — | — |
| `architecture-alignment` | Runs unless the plan was trivial, fewer than 3 tasks with single-file changes (`build/SKILL.md` Common Step 4.5) | Skipped (roster `architecture-alignment`) | — | — |
| `journeys` | Runs when `skill-gate.js` proceeds for `journeys`: a changed file outside the no-surface set, under `docs/journeys/`, or in a journey's `files:` (`_shared/skill-load-gate.md`; `build/SKILL.md` Common Step 6) | As `standard` | — | — |
| `docs-sync` | Runs when `docs/REGISTRY.md` exists (`build/SKILL.md` Common Step 6.5) | As `standard` | — | — |
| `verify` | Runs (`build/SKILL.md` Common Step 5; roster `## Never skipped`) | As `standard` | Steps 4-5: the impacted tests, then `express-lane.js check` | `test`, then `check` |
| `operational-checklist` | Runs when the diff matches schema, env, IaC, CI or platform-config files, or Common Step 5 applied a Category A fix (`build/SKILL.md` Common Step 5.5) | As `standard` | — | — |
| `stories` | Runs when the build changed UI files (`design-wrapper/frontend-detection.md` Layer 3) and `no-stories` is not set (`flow/SKILL.md` Automatic story generation) | As `standard` | — | — |
| `test` | Runs; types, lint and tests are skipped when `VERIFICATION_SHA` equals HEAD (`test/SKILL.md` Pipeline Context Awareness) | As `standard` | — | — |
| `qa` | Runs when stories exist and the selection is non-empty: the stories whose `source_files` meet the changed files, or the full set when none match and a UI trigger file changed; a set the QA pass stamp already covers is skipped (`test/SKILL.md` Pipeline Context Awareness) | As `standard` | — | — |
| `design-gate` | Runs when `skill-gate.js` proceeds for `design-wrapper test` (`test/design-gate.md`); no profile skips it (roster `## Never skipped`) | As `standard` | — | — |
| `review-spec` | Runs (`review/code-mode-steps.md` Step 1) | Skipped (roster `review-step-1`) | — | — |
| `review-promises` | Runs when the record's parent has a `## Cross-Spec Promises` section (`review/code-mode-steps.md` Step 1.6) | Skipped (roster `review-step-1.6`) | — | — |
| `review-code` | Runs, at the review-effort tier from the record's `risk:*` × `size:*`, raised by the diff heuristic and `review-effort-floor`, and `high` when neither gives a clear tier (`review/review-effort-derivation.md`) | As `standard` | — (a sample of merged express PRs is reviewed at the end of a bare `/claude-tweaks:dispatch` drain, `_shared/express-lane.md` Post-merge sampling) | — (the driver's own `review` step runs per `express-driver-review`; under its default and the default lane bounds it does not run in a real run, `docs/driver.md` The reviewer step) |
| `review-hindsight` | Runs (`review/code-mode-steps.md` Step 4) | Skipped (roster `review-step-4`) | — | — |
| `review-simplify` | Runs unless `/build`'s `Common Step 3: simplify: scope simplified at {sha}` line covers the scope and no in-scope source file changed since (`review/code-mode-steps.md` Step 5, #4137) | As `standard` | — | — |
| `visual-review` | Runs when `skill-gate.js` proceeds for `visual-review`: a frontend file changed, or the surface is not absent, `terminal`, `backend` or `infra`. Full mode opens a browser; with no UI file in the diff it gives the recommendation instead (`review/code-mode-steps.md` Step 6; `_shared/skill-load-gate.md`) | As `standard` | — | — |
| `design-review` | Runs when `skill-gate.js` proceeds for `design-wrapper review` (`review/code-mode-steps.md` Step 6.5) | As `standard` | — | — |
| `security-hardening` | Runs when the diff touches a client-side or route file (`review/focus-criterion-passes.md` Step 6.6) | As `standard` | — | — |
| `agent-trust-scope` | Runs when the diff touches `.claude/settings.json` or `.claude-tweaks/policy.yml` (`review/focus-criterion-passes.md` Step 6.65) | As `standard` | — | — |
| `app-store-readiness` | Runs when the diff shows a mobile-app signal (`review/focus-criterion-passes.md` Step 6.66) | As `standard` | — | — |
| `polish` | Runs when the review verdict is PASS, `no-polish` is not set and `skill-gate.js` proceeds for `design-wrapper polish`, which skips a non-frontend record; re-verifies once when it changed code (`flow/steps-and-gates.md` Polish-phase decision tree) | Skipped (roster `polish`) | — | — |
| `wrap-up` | Runs at `standard` depth; narrowed to the `fast-lane` mode when `config.yml`'s `mode` is `auto`, the profile reads `standard` and the diff touches no implementation file (`ceremony-derive.js`; `wrap-up/ceremony-derivation.md`) | Runs in the `fast-lane` mode: reflect in light mode, a skills budget of 2 and a docs budget of 1, and the escape hatch armed, which raises the rest of wrap-up to `standard` on a review finding or a reflect Safety regression (`wrap-up/SKILL.md` Reflect, The registry, Ceremony escape hatch) | — (step 8 logs one summary line, step 10 reports) | — (`set-config` writes `config.yml`, `summary` logs one line) |
| `merge` | Under `pr-first`, runs when the record's live labels carry `auto:build` with `auto:merge` or a matured `auto:merge-pending`, or `merge-authorization` pre-authorizes it, and `merge-check` confirms; otherwise the PR stays `pending-review` (`wrap-up/auto-merge-short-circuit.md`, `_shared/pr-first-merge.md`). Under `local-merge` the dispatching session merges (`dispatch/settle-and-merge.md`) | As `standard` | Step 9: runs when the live labels carry `auto:merge` and `auto:build`, or the Manifesto authorization applies, after `merge-check`; CI must be green | `ci` waits for CI; `merge` runs only when that wait ended green, and `merge.js` owns the decision (`steps.js` `mergeStep`) |
| `creative-survey` | Runs unless `no-creative` is set or `creative-survey` resolves `off`, when `skill-gate.js` proceeds for `design-wrapper survey` (`flow/SKILL.md` Step 5; `flow/survey.md`) | As `standard` | — | — |
| `depth-survey` | Runs when source modules changed and `no-deepen` is not set (`flow/SKILL.md` Step 5) | As `standard` | — | — |

The selectors in the record's Current State act on these rows:

| Selector | Row | Today's rule | File |
|---|---|---|---|
| UI-changed `stories` | `stories` | Inserted after the build when it changed a Layer 3 UI file | `flow/SKILL.md` Automatic story generation |
| Non-frontend `polish` skip | `polish` | Since #5605, the skill-load gate's `design-wrapper polish` verdict; the wrapper's own `{skipped: ...}` return still stands behind it | `flow/steps-and-gates.md` Polish-phase decision tree; `_shared/skill-load-gate.md` |
| `micro-plan.md` plan-writing skip | `plan` (its mode) | `fast-lane` header, `size: low`, at most one implementation Key File, no risk flag | `build/micro-plan.md` |
| Review effort | `review-code` (its mode) | `risk:*` × `size:*`, the diff heuristic, `review-effort-floor`; upward on ambiguity | `review/review-effort-derivation.md` |
| `resolve-profile.js --diff-facts` | `whole-branch-review` | Caps the reviewer's model at Standard; leaves no step out | `build/dispatch.md` "Whole-branch review model" |
| `plan-audit.js --count-tasks` | `whole-branch-review` | Under `fast-lane` only: `tasks: 1` and `batched: false` skips the review | `build/dispatch.md` |
| `ceremony-derive.js` | `wrap-up` (its mode) | `standard` to `fast-lane` at wrap-up on a diff with no implementation file, in `auto` mode only; earlier steps have already run at `standard` | `wrap-up/ceremony-derivation.md`; `plugin/bin/lib/dispatch/ceremony-derive.js` |

"Never skipped" in the roster means that no profile skips a row; it does not mean every graph holds it. Four of its rows have a skip on facts today: review Step 5 when `simplify` already covered the scope (`review-simplify`), and review Step 6, test Step 1.5 and review Step 6.5 when `skill-gate.js` finds nothing to do (`visual-review`, `design-gate`, `design-review`).

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
