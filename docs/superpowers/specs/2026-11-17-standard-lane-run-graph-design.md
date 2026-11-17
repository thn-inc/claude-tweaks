# Standard-lane run graph — design

Date: 2026-11-17. Status: draft for approval.

Record: #5580. Extends `docs/superpowers/specs/2026-11-11-pipeline-driver-design.md`, as Phase 7 of `docs/superpowers/specs/2026-11-15-process-efficiency-design.md`. Written against `main` at `f88beb9ecbef1f0b2560249df0d3ae70a96b4843`, this branch's merge base with `origin/main` (`git merge-base HEAD origin/main` after `git fetch origin main`, 2026-11-17). Every file claim was read in this branch's tree, which changes nothing under `plugin/`, so the plugin it describes is that commit's. `origin/main` has moved since; a phase re-reads a claim before it relies on one.

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

C1, C5 and C11 run from the repository root. C2 and C3 read C1's `yield.json` from the directory C1 wrote it to.

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
- **Median tokens** (`tokens.median`, over the non-null entries): `timing.json`'s per-phase total of input, output, cache-read and cache-create tokens. An entry is `null` when the run has no `timing.json` or no row for the phase. A 0 is `timing.json`'s per-phase attribution, not a measured zero: tokens the attribution did not assign to that phase read 0 there. C11, from the repository root, reads archived run `2026-11-17T074410-record-5790`'s `review` step:

  ```
  node -e 'const {deriveStepYield}=require("./plugin/bin/lib/timing/step-yield");const r=deriveStepYield(process.argv[1],{now:new Date()}).steps.find(s=>s.phase==="review");console.log(r.minutes,JSON.stringify(r.tokens),r.findings&&r.findings.raised)' <main-checkout>/.claude-tweaks/pipelines/archive/2026-11-17T074410-record-5790
  ```

  It prints `15 {"input":0,"output":0,"cacheRead":0,"cacheCreate":0} 9`: a 15-minute review that raised 9 findings, with 0 tokens attributed. So the 0 medians of the `standard` lane's `review`, `wrap-up` and `merge` rows say nothing about their cost, and no rule may rest on a token cell. `n/a` means every entry was null.
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

**Two process-efficiency phases already changed steps named here, and the table records the form on this commit.** The merge shas below come from C12, from the repository root, `git log --first-parent --abbrev=10 --format="%h %s" -F --grep "(#5605)" f88beb9ecbef1f0b2560249df0d3ae70a96b4843`, which prints `b3517f6602 feat: Gate journeys, visual-review and design-wrapper before… (#5605) (#5617)`; with `(#5599)` in place of `(#5605)` it prints `ecd6469c0e feat: Run the review lens fan-out as a plugin workflow, behind… (#5599) (#5819)`. Unit 4.2 (#5605, merged as `b3517f6602`) put a `skill-gate.js` call in front of `design-pre-build`, `journeys`, `design-gate`, `visual-review`, `design-review`, `polish` and `creative-survey` (`_shared/skill-load-gate.md`), so a skill with nothing to do is never loaded. The gate's verdict is an input to the selection function, not a second selector. Phase 6 (#5599, merged as `ecd6469c0e`) lets `review-code`'s agent lenses run through the plugin workflow `claude-tweaks:review-lens-fanout` when the policy key `review-lens-dispatch` resolves `workflow` (`review/step3-lens-dispatch.md`'s Workflow dispatch). The key defaults to `task` (`plugin/bin/lib/policy-schema.js`), and Task dispatch stays the fallback, so the step's unit and outputs are unchanged.

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
| HARD-GATEs | roster, `## Never skipped` | A set of stops, each inside a step. The HARD-GATE row of `_shared/auto-mode-contract.md` lists them: review Step 1 (`review-spec`); review Step 1.5's test gate (`review-code`); `/build` Design Step 3's plan validation (`plan`); the plan audit's hard fails (`plan-audit`, with Check D in `plan`); test Step 0 (`test`); the adopted-branch collision stop (`worktree-setup`); the plan-review needs-human spec gap (`plan-review`); `/claude-tweaks:dispatch`'s second-call missing-claim fallback (`merge`); `/claude-tweaks:flow` Step 2.7's design-doc rejection, the multi-spec boundary-freshness escalation and the adopted-run PR-conflict catch-up stop, all in the run's frame; and `/release` Step 4, outside any run. Never skipped places each. |

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
| `design-pre-build` | Runs when `skill-gate.js` proceeds for `design-wrapper pre-build` (design integration on; a surface that is not absent, `backend` or `infra`) and the plan is not trivial, which `build/design-prebuild.md` states as "The plan is trivial (< 3 file references, no UI files in the plan)" (`_shared/skill-load-gate.md` Rules; `build/design-prebuild.md`, Skip this step entirely when) | As `standard` | — | — |
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
| `depth-survey` | Runs when source modules changed, `no-deepen` is not set and `depth-survey` does not resolve `off` (`flow/SKILL.md` Step 5; `flow/survey.md`) | As `standard` | — | — |

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

The function reads the facts below and nothing else. Each value comes from a closed set or is an integer, and each is parsed by the function named in its row before the function sees it. Rows 1-9 are facts about the record or the run. Rows 10-12 are settings, chosen by the project or the caller: an unset setting takes its documented default, and the function reads that default. A fact that is absent, unreadable or outside its vocabulary is read at its most cautious value, the one for which the function returns the most steps, so none of the three gives a graph with fewer steps than the most cautious present value gives. "Most cautious" here is about the step graph; where an input also feeds a step's mode, the row says how the mode reads it.

| # | Input | Source today and its parser | First known | Values | Absent, unreadable or outside the vocabulary | Most cautious value | Read by |
|---|---|---|---|---|---|---|---|
| 1 | Type | `type:*` label or native Issue Type; `typeOf` (`plugin/bin/lib/issues/record-vocabulary.js`) | before the run (`start`) | `bug`, `feature`, `task` | `null`. No rule reads type, so the graph is the same | any: every value gives the same graph | no rule |
| 2 | Size | `size:*` label, `effort:*` as its pre-rename fallback; `parseRecordFacets` (same file) | before the run (`start`) | `low`, `medium`, `high` | `null`: `parseRecordFacets` ignores a value outside its vocabulary, so `size:small` reads as no size. No step rule reads size, so the graph is the same. The modes read no size at their cautious side: no micro-plan, which needs `size: low` (`build/micro-plan.md`), and a review tier from the diff heuristic alone, which reads `high` when the diff gives nothing to classify (`review/review-effort-derivation.md` step 3) | any, for the graph | no step rule; the modes of `plan` and `review-code` (Modes, below) |
| 3 | Risk | `risk:*` label; `parseRecordFacets` | before the run (`start`) | `low`, `medium`, `high` | `null`, as for size; the review tier reads it as size does | any, for the graph | no step rule; the mode of `review-code` |
| 4 | Surface | the `Surface:` line in the body's first block; `liftMetadata` (`plugin/bin/lib/issues/materialize-format.js`), case-folded as `normalizeSurface` (`plugin/bin/lib/skill-gate/index.js`) does, legacy `frontend` read as `web` | before the run (`start`) | `web`, `mobile`, `desktop`, `terminal`, `backend`, `infra` | each rule that reads surface takes its own most cautious value: no skill-load gate `skip` is honoured (rules R5, R7-R10) | per rule: any value but `backend` or `infra` for `design-pre-build`; `web`, `mobile` or `desktop` for `visual-review`; `terminal` for `design-gate`, `design-review`, `polish` and `creative-survey`, a declared-only track the wrapper never sniffs (`layer3Applies`, `plugin/bin/lib/design-detect/index.js`) | R5, R7-R10; A7-A9 |
| 5 | Ceremony | the run's `config.yml` `ceremony-profile`, which the Manifesto writes: the `ceremony:*` label (`parseRecordFacets`) when present, else the Manifesto's `ceremony-check` verdict, a model judgment (`flow/manifesto.md` Ceremony profile computation); over a multi-record run, `fast-lane` only when every record is (`computeLevers`, `plugin/bin/lib/flow/manifesto-write.js`). An out-of-vocabulary label (`ceremony:bogus`) parses as no label and is judged, as today | before the run (`config`) | `fast-lane`, `standard` | `standard` for a missing, unreadable or out-of-vocabulary `config.yml` value. A missing label is not a missing input: the Manifesto fills the value before `config`, and a verdict with no `CEREMONY:` line already stops the run there (`flow/failure-cards.md`, gate `ceremony-check`) | `standard` | R2, R3, R9 |
| 6 | Risk flags | the `Risk-flags:` preamble line; `parseRiskFlags` (`plugin/bin/lib/issues/record-risk-flags.js`) | before the run (`start`) | `none`, or a set of `migrations`, `auth`, `public-contract`, `irreversible-side-effect` and the policy's `risk-categories` | absent: unclassified, no flags; malformed or an unknown slug: all four built-ins flagged (`parseRiskFlags`). No step rule reads it, so the graph is the same. `plan`'s micro-plan mode reads an absent line as no flags, its less cautious side, as today | any, for the graph | no step rule; the mode of `plan`, and plan-audit Check G inside `plan` and `plan-audit` |
| 7 | Changed paths | `changedFiles` (`plugin/bin/lib/verify/changed-files.js`): the committed diff from the base `resolveBase` finds to `HEAD`, plus the working tree's status, the same list `skill-gate.js` resolves from `--integration-branch`; classes in the table below, which read paths only | after the build's tasks; re-read at each later point | a set of the classes below | every class present | `frontend` present | R6, R8; A7 |
| 8 | Task count | `plan-audit.js --count-tasks` (`countTasks`, `plugin/bin/lib/plan-audit/parser.js`), which prints `{tasks, batched}` | after the plan | `tasks` a non-negative integer, `batched` a boolean; threshold `tasks === 1` | `tasks` not a non-negative integer, `batched` not a boolean, or the call fails: absent, and `whole-branch-review` stays in | any value but `tasks: 1` with `batched: false` | R3 |
| 9 | Skill-load gate verdict | `skill-gate.js` (`decide`, `plugin/bin/lib/skill-gate/index.js`; #5605, process-efficiency unit 4.2), one verdict per gated step: `design-pre-build`, `journeys`, `design-gate`, `visual-review`, `design-review`, `polish`, `creative-survey` | `design-pre-build`'s before the run (`start`), since its gate reads no diff; each other one immediately before its step | `proceed`, `skip`; a reason starting `cannot tell:` is a `proceed` | `proceed`: `_shared/skill-load-gate.md`'s Result handling reads exit 2, exit 3 and missing JSON as a gate that did not run, which proceeds; with a run directory it logs one `SKIP` as `--step "{step} (gate)"`, and exit 3 is reported in the caller's own output only | `proceed` | R4, R5, R7-R10 |
| 10 | Design integration (setting) | CLAUDE.md's `## Design integration` `design-integration:` key; `readDesignIntegrationFlag` (`plugin/bin/lib/design-detect/index.js`) | before the run (`start`) | `enabled`, `plugin-only`, `disabled` | a setting: unset or unrecognised is "not configured", which `layer1` in the same file reads as off | not applicable: a setting | R5, R7, R9, R10 |
| 11 | Survey policy values (setting) | `creative-survey`, `depth-survey` (`plugin/bin/lib/policy-schema.js`), through `resolve-policy.js` | before the run (`start`) | `off`, or unset | a setting: unset is on | not applicable | R10, R11 |
| 12 | Run flags (setting) | `/claude-tweaks:flow`'s `no-stories`, `no-polish`, `no-creative`, `no-deepen` (`flow/SKILL.md` Arguments) | before the run (`start`) | set, unset | a setting: unset | not applicable | R6, R9, R10, R11 |

The step-list argument of `/claude-tweaks:flow` is not an input. It names which part of the graph one invocation walks, as `/claude-tweaks:dispatch`'s two calls do, and `## Who walks the graph` owns it.

**Changed-path classes.** Changed paths enter the function only as the set of classes their paths fall in. Each path is in exactly one of `test`, `docs` and `impl`, the three-way split of `computeDiffFacts` (`plugin/bin/lib/dispatch/ceremony-derive.js`), which builds on `classifyDiffFiles` (`plugin/bin/lib/issues/blast-radius.js`); `frontend` is independent of the three.

| Class | A path is in it when | Function |
|---|---|---|
| `test` | `isTestPath`: a `test/` or `tests/` segment, a `.test.` or `.spec.` JS or TS suffix, `_test.go`, `test_*.py` or `*_test.py`, or YAML under `stories/`; prompt prose (markdown under `skills/`, `agents/` or `commands/`) never is | `classifyDiffFiles` |
| `docs` | not `test`, and markdown that is not prompt prose, or `docs/plans/*.html` | `isDocsPath` in `computeDiffFacts` |
| `impl` | neither `test` nor `docs`; prompt prose is `impl` | `computeDiffFacts` (`implFiles`) |
| `frontend` | `fileMatchesFrontendPredicate`: a trigger extension (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`, `.css`, `.scss`, `.sass`, `.less`, `.astro`, `.mdx`), or a `components`, `pages`, `app`, `routes`, `views` or `ui` segment outside `app/api/` and `pages/api/` | `plugin/bin/lib/design-detect/index.js`, design-wrapper's Layer 3 |

The step rules read only `frontend`. `test`, `docs` and `impl` are the classes `wrap-up`'s mode rule reads (its `lowSurface` is a diff with no `impl` path), so both read paths through the same two functions.

**Union.** Inputs combine by union: a step is in the graph when any rule that names it holds. A rule may read several inputs, as R9 does, but no input removes a step another input's rule requires.

**Not yet known is not absent.** A fact that does not exist yet at an evaluation point, such as the ceremony or the task count at `start`, is not absent. Each step is decided at the last evaluation point before it would run, from the facts that exist by then (Evaluation points).

## Evaluation points

The function is evaluated at the points below, in this run order. Each point decides the steps whose deciding facts first exist there; every other step is decided at `start`.

| Point (`at`) | When | Facts first known | Steps it decides |
|---|---|---|---|
| `start` | the first evaluation, for a record target only: right after the record passes `/claude-tweaks:flow` Step 1's `materialize.js --check` (item 5 for a record reference; a topic name resolves to a record at item 6, after item 5, which makes no `--check` call today; this design adds one for the resolved record there, and `start` runs once it passes), and before Step 2.8's mint and claim | rows 1-4, 6 and 10-12; `design-pre-build`'s gate verdict. The `--check` envelope, `{record, check, title, ceremony, surface, bodyBlockedBy}` (`plugin/bin/materialize.js`), carries row 4 only; `## Who walks the graph` says where the others come from | every step not listed below |
| `config` | after the Manifesto writes `config.yml`, before `worktree-setup` | the ceremony | R2's six steps, `whole-branch-review` under `standard`, and R9's ceremony clause |
| `plan` | after `plan`, before `plan-audit` | the task count | `whole-branch-review` |
| `journeys` | immediately before `journeys`, after its `skill-gate.js` call | its gate verdict; the changed-path classes | `journeys` |
| `build` | after the build closes (`verify`'s Common Step 7), before `stories` | the changed-path classes of the closed build | `stories` |
| `design-gate`, `visual-review`, `design-review`, `polish`, `creative-survey` | immediately before the step, after its `skill-gate.js` call | the step's gate verdict; the changed-path classes as of then | that step |

A step whose rule still depends on a fact that does not exist yet is in every earlier evaluation's output: it stays in until that fact exists. A step whose rule is already false at an earlier point, such as `polish` at `start` in a project with design integration off, is out from that point.

A later evaluation may remove only the steps that point decides, and only when no rule for them holds: R2's six and `polish` at `config` under `fast-lane`, `whole-branch-review` at `plan`, `stories` at `build`, and each gated step at its own point. It removes no other step. It never removes an asserted step: R2's six, `whole-branch-review`, `stories`, `journeys`, `polish` and `creative-survey` are in no assertion, and `design-gate`, `visual-review` and `design-review` leave only under the condition A7, A8 and A9 allow (Never skipped).

Under the rules below no later evaluation adds a step, because every step a later point decides is already in. The ceremony escape hatch's write to `config.yml` changes only `wrap-up`'s mode, and no step after it reads the profile. The union rule allows a later rule that reads a later fact to add a step. Where the remainder is kept between evaluations, and across `/claude-tweaks:dispatch`'s two calls, is in `## Who walks the graph`.

**Once per run.** Each point is evaluated at most once per run, the first time the run reaches it; a step that runs again (`## Loops`) calls the function for no point. A resumed or adopted run, a context-handoff continuation and `/claude-tweaks:dispatch`'s second call re-evaluate no point the run has passed: they reuse the stored remainder from where `## Who walks the graph` keeps it, and evaluate only the points still ahead. The one exception is a run that passed `config` with no store, such as one started on the previous release: its first call evaluates `start` and `config` late and records them as `backfilled` (`## Who walks the graph`, Fresh runs and the absent store).

## The selection function

```
selectRunGraph(facts, { at, previous }) -> string[]
```

- `facts` holds the Inputs, each already parsed into its closed form: `{ type, size, risk, surface, ceremony, riskFlags, taskCount: { tasks, batched }, pathClasses, gates, designIntegration, policy: { creativeSurvey, depthSurvey }, flags: { noStories, noPolish, noCreative, noDeepen } }`. `gates` maps a gated step's name to its verdict. The function knows from `at` which facts exist by then; one that should exist and does not is absent.
- `at` is the evaluation point: `start`, `config`, `plan`, `build`, or the name of the gated step about to run.
- `previous` is the remainder the previous evaluation returned, and `null` at `start`.
- The result is the remainder of the graph from `at` on: vocabulary step names, in the Step vocabulary table's order, with each skill keeping its own step order inside it. At `start` it is the whole graph.
- The assertions run inside the function, after the rules. A violation throws an error carrying the assertion's id and one line; `## Never skipped` says what the caller does with it at each point.

No input is free text. Every value the function reads is one of the closed values in Inputs or an integer; the record's title and body reach it only through the parsers named there.

### Rules

A step is in the graph when a rule for it holds. A step the function leaves out is one for which none holds. Each rule's leave-out carries one mark, checked against the step's row in `## Today's graph`.

| Rule | Steps | In the graph when | Decided at | Mark for the leave-out |
|---|---|---|---|---|
| R1 | `worktree-setup`, `manual-steps`, `plan`, `tasks`, `simplify`, `docs-sync`, `verify`, `operational-checklist`, `test`, `qa`, `review-code`, `review-simplify`, `security-hardening`, `agent-trust-scope`, `app-store-readiness`, `wrap-up`, `merge` | always | `start` | none: R1 leaves no step out |
| R2 | `plan-audit`, `plan-review`, `architecture-alignment`, `review-spec`, `review-promises`, `review-hindsight` | ceremony is `standard` | `config` | unchanged from today: each row's `fast-lane` cell, "Skipped (roster …)" |
| R3 | `whole-branch-review` | ceremony is `standard`; or the task count is anything but `tasks: 1` with `batched: false` | `config` under `standard`, `plan` under `fast-lane` | unchanged from today: row `whole-branch-review` |
| R4 | `journeys` | its gate verdict is `proceed` | `journeys` | unchanged from today: row `journeys` |
| R5 | `design-pre-build` | design integration is on, and its gate verdict is `proceed` or the surface is absent or unrecognised | `start` | unchanged from today for a declared surface: row `design-pre-build`. An absent surface adds the step, where today's gate skips on "no surface declared" |
| R6 | `stories` | a `frontend` path changed, and `no-stories` is unset | `build` | unchanged from today: row `stories` |
| R7 | `design-gate`, `design-review` | design integration is on, and the step's gate verdict is `proceed` or the surface is absent or unrecognised | the step's own point | unchanged from today for a recognised surface: rows `design-gate`, `design-review`. An absent or unrecognised surface adds the step, where today `evaluate()` sniffs the files |
| R8 | `visual-review` | its gate verdict is `proceed`; or the surface is absent, unrecognised, `web`, `mobile` or `desktop`; or a `frontend` path changed | `visual-review` | unchanged from today for a declared surface: row `visual-review`. An absent surface adds the step on a diff with no `frontend` path |
| R9 | `polish` | ceremony is `standard`, `no-polish` is unset, design integration is on, and its gate verdict is `proceed` or the surface is absent or unrecognised | `start` for the flag and design integration; `config` for the ceremony; `polish` for the verdict | unchanged from today: row `polish` and `flow/steps-and-gates.md`'s Polish-phase decision tree. The surface clause adds as in R7 |
| R10 | `creative-survey` | `no-creative` is unset, `creative-survey` is not `off`, design integration is on, and its gate verdict is `proceed` or the surface is absent or unrecognised | `start`; `creative-survey` for the verdict | unchanged from today: row `creative-survey`. The surface clause adds as in R7 |
| R11 | `depth-survey` | `no-deepen` is unset and `depth-survey` is not `off` | `start` | unchanged from today: row `depth-survey` |

Each step's own check that it has nothing to do stays in the step's body and is unchanged from today: no `## Manual Steps` section, no `docs/REGISTRY.md`, a trivial plan (`plan-audit`, `plan-review`, `architecture-alignment`, `design-pre-build`), a parent with no `## Cross-Spec Promises`, no matching operational file, no stories or an empty or stamp-covered selection (`qa`), a scope `simplify` already covered (`review-simplify`), the three focus passes' pre-checks, no source module changed (`depth-survey`), `plan`'s already-satisfied and already-shipped exits, and `merge`'s authorization and `merge-check`. Those checks read files, plans and run-directory lines, which are not inputs. A review verdict of BLOCKED stops the run before `polish` (`flow/steps-and-gates.md`, the gate table); that is a stop, not a rule.

**Modes.** The output carries no mode, because it is a list of step names. Each of the three modes stays with its step and is chosen by today's rule from the same inputs, unchanged from today: `plan`'s micro-plan (`build/micro-plan.md` Applicability gate), `review-code`'s effort tier (`review/review-effort-derivation.md`), and `wrap-up`'s `fast-lane` mode (`ceremony-profile`, `ceremony-derive.js`, the escape hatch). Each shortens its step. A later rule that shortens a step through its mode is a rule of this design all the same: it carries a mark, and if that mark is "evidenced" or "risk accepted" it sits behind the policy value below.

**Today's selectors.** Each selector the record's Current State lists is carried over or replaced; none is dropped.

| Selector today | In this design |
|---|---|
| The `ceremony:*` label, else the Manifesto's `ceremony-check` verdict, folded into `config.yml`'s `ceremony-profile` | carried over as the ceremony input, read by R2, R3 and R9 |
| The roster's skip rows `review-step-1`, `review-step-1.6`, `review-step-4`, `plan-audit`, `plan-review`, `architecture-alignment`, `polish` and `sdd-whole-branch-review` | replaced by R2, R3 and R9, in code. What happens to the roster itself is in `## Roster replacement` |
| The roster's `reflect-light-mode` | carried over as part of `wrap-up`'s `fast-lane` mode |
| The roster's `red-team-persona` | outside the run (`## Not a step`), not changed |
| The `stories` trigger on UI files (`flow/SKILL.md`) | replaced by R6 over the `frontend` class, the same predicate |
| The `polish` skip on a non-frontend record, the skill-load gate since #5605 | replaced by the gate verdict in R9 |
| The skill-load gates of `design-pre-build`, `journeys`, `design-gate`, `visual-review`, `design-review` and `creative-survey` (#5605) | replaced by the gate verdict input in R4, R5, R7, R8 and R10 |
| `build/micro-plan.md`'s plan-writing skip | carried over as `plan`'s mode |
| Review effort (`review/review-effort-derivation.md`) | carried over as `review-code`'s mode |
| `ceremony-derive.js` | carried over as `wrap-up`'s mode rule; it selects no step |
| `resolve-profile.js --diff-facts` | carried over outside the function: it picks the whole-branch reviewer's model and leaves no step out |
| `plan-audit.js --count-tasks` | carried over as the task-count input of R3 |

**No rule rests on a number.** No rule in this design gives a record fewer steps than it gets today, so none is marked "evidenced" or "risk accepted". The evidence cannot carry one yet. A step with no Evidence row of its own is "not measured separately", and any rule about it is unchanged from today (AC2's Decided paragraph). The steps that have rows:

| Step | Why no leave-out or shortening rests on its row |
|---|---|
| `plan` | Its outcome is not countable: its commits are the run's product, and its stops are decision-log prose (What "outcome-changing" counts). E-standard-plan shows 0 outcome-changing entries in 61 that ran, a zero that holds by construction. |
| `tasks` | The run's product. |
| `test`, `review-code`, `wrap-up` | Asserted (A4, A5, A10). E-standard-review changed the outcome in 30 of the 54 entries in which it ran, 24 of them with a confirmed finding. |
| `polish` | E-standard-polish ran in 4 entries, below 20, and `fast-lane` already leaves it out. |
| `merge` | Its body decides whether it merges. Its fix-commit counts can be bookkeeping, and its span is CI and human waits. |

The first rule that gives fewer steps than today adds one policy value with it, `run-graph-rules`: a list of rule ids that are on, empty by default, so the default reproduces today's graph. AC13's "evidenced" rate is over runs in which the step ran, so it cannot be taken over runs that had the rule on. The default changes on a different measure, the later-step outcome share: over a set of runs, the share in which a phase entry of C1's per-run `runs` rows that comes after the entry holding the left-out step changed the outcome (a confirmed finding, a failed `verify` or a fix commit). Its own entry is left out of both sides, so a step that catches defects itself cannot pass by being compared with its own catches. A rule's id moves into the default only once its later-step outcome share over at least 20 runs whose `run-graph.json` records the rule's leave-out is no higher than its baseline, the same share over at least 20 runs of the same lane in which the left-out step ran. For a step marked "not measured separately", which has no `ran` flag of its own, the entry holding it is the one its Evidence cell names, and its baseline runs are those whose `run-graph.json` remainder holds the step; that baseline counts planned steps, not walked ones, so it leans toward a pass. A pass does not show that the rule is safe: a defect the left-out step would have caught that escapes the run, or that is caught inside the same phase entry, is never counted, and nothing in the repository measures post-merge defects today. The value is removed when no rule in it is left off by default. The phase that turns a rule on for this repository waits for the release that carries it.

**What a defaulted surface adds.** R5, R7, R8, R9 and R10 read an absent surface at its most cautious value, which puts back a skill load that #5605's gate removes today: the step loads its skill, whose own check then finds nothing to do (design-wrapper's Layer 3 sniff; `visual-review`'s browserless recommendation on a diff with no UI file, `review/code-mode-steps.md` Step 6). The remedy is a `Surface:` line on the record, which `/claude-tweaks:specify` stamps; the count below measures how many ready records lack one.

### Inputs from model judgment or record text

The function's safety rests on the assertions, not on the accuracy of its inputs: each assertion holds whatever value a record-text or model-judgment input takes, with the one residual named below.

| Input | Origin | Closed values | Steps a value can remove | Asserted steps any value removes |
|---|---|---|---|---|
| Ceremony | `config.yml`'s `ceremony-profile`: the `ceremony:*` label, stamped by `/claude-tweaks:specify` from `ceremony-check`, a model judgment; or, for an unlabeled record, the Manifesto's verdict from the same mode | `fast-lane`, `standard` | `standard`: none. `fast-lane`: R2's six, R3's `whole-branch-review` (with one task), R9's `polish` | none: no assertion names a step R2, R3 or R9 decides |
| Risk flags | the `Risk-flags:` line, record text | `none`; subsets of the built-in four and the policy's `risk-categories`; an unreadable line reads as all four built-ins | none: no step rule reads it | none |
| Task count | `plan-audit.js --count-tasks` over a plan a model wrote from the record | `tasks` a non-negative integer, `batched` a boolean | `tasks: 1` with `batched: false`, under `fast-lane` only: R3's `whole-branch-review` | none: no assertion names it |
| `journeys` gate verdict | `skill-gate.js`, which reads the model-written `files:` frontmatter of `docs/journeys/*.md` | `proceed`, `skip` | `skip`: R4's `journeys` | none: no assertion names it |
| Surface | the `Surface:` line, record text | `web`, `mobile`, `desktop`, `terminal`, `backend`, `infra` | through the gate verdict, R5, R7-R10's steps | A7's `visual-review` only on a diff with no `frontend` path, which A7 allows: a wrong surface cannot remove it from a diff that changed UI files. A8's `design-gate` and A9's `design-review` with a declared `backend` or `infra` surface on a diff with UI files, where design-wrapper's own Layer 2 skips, and `design-gate` with a declared `mobile` surface, where `evaluate()`'s mode-level native skip (`TEST_NATIVE`, `plugin/bin/lib/design-detect/index.js`) does: the gate reports that skip, and A8 and A9 allow it, as today |

The type, size and risk labels are record text too, and no step rule reads them.

A wrong label is corrected outside the run. The run never rewrites the record's `ceremony:*` label (`_shared/ceremony-profile.md`, "Escape hatch and the build-side skips"). Inside the run, the wrap-up escape hatch raises the rest of `wrap-up` to `standard` on a review finding or a reflect Safety regression, and re-runs no left-out step. The next run's Manifesto reads the label again before `config`, so the correction is `/claude-tweaks:specify` re-stamping the record or a human editing the label; the same holds for `Surface:`, `size:*` and `risk:*`.

### When a left-out step's output is absent

For each step a rule can leave out, the kept steps that read its output (the Step vocabulary table's Reads column) and what each does without it:

| Left-out step | Kept readers of its output | What the reader does when it is absent | File |
|---|---|---|---|
| `plan-audit` | none read its envelope; `tasks` runs the plan file as written | `tasks` executes the unamended plan; Checks D and G have run inside `plan` | `build/SKILL.md` Common Step 1.5 (skip path) |
| `plan-review` | `review-spec` reads its clarifications and is out in the same graphs (R2); `tasks` forwards the spec's criteria | `tasks` forwards the criteria as materialized | `build/dispatch.md` |
| `design-pre-build` | `tasks` (the implementer prompts) | the prompts carry no design references; the skip is logged | `build/design-prebuild.md` On skip |
| `whole-branch-review` | none | `review-code` reviews the whole branch with its own lenses; a prior review is reused only at byte-identical scope | `review/code-mode-steps.md` Reusing a Prior Whole-Branch Review |
| `architecture-alignment` | `wrap-up` (the ledger) | settles the ledger rows that exist | `wrap-up/SKILL.md` |
| `journeys` | `stories`, `visual-review` (`docs/journeys/*.md`) | read the journeys already in the repository; `stories` browses without them when there are none | `flow/SKILL.md` Automatic story generation |
| `stories` | `qa`; `review-code` (QA results); `visual-review` (`DEV_URL`) | `qa` runs the stories already in the repository, or reports none and `test` still sets `TEST_PASSED`; `review-code`'s QA Ledger Check finds no `test/qa` rows; `visual-review` detects the dev URL itself | `test/SKILL.md` Pipeline Context Awareness; `review/code-mode-steps.md` Step 1.5; `visual-review/SKILL.md` |
| `design-gate` | none; `test` reports the result | `test` notes the skip and proceeds | `test/design-gate.md` Result handling |
| `review-spec` | `wrap-up` (the verification brief's `{AC_RESULTS}`) | writes no AC-results file and passes no `--ac-results` | `wrap-up/verification-brief.md` |
| `review-promises` | none in the run | the parent's own gate re-runs the promise check | `_shared/ceremony-profile.md`, row `review-step-1.6` |
| `review-hindsight` | `wrap-up` (the ledger) | settles the ledger rows that exist | `wrap-up/SKILL.md` |
| `visual-review` | `review-code`'s summary; `wrap-up`'s visual-review safety net | the summary's Visual Review status reads skipped; for an `app-route` or `rendered-page` plan the safety net treats that as Recommended and runs `/claude-tweaks:visual-review` | `wrap-up/verification-brief.md` Step 2.5 |
| `design-review` | `review-code`'s Step 6.7 routing; `wrap-up`'s Review Console (`staged/`) | route the findings that exist; no design decision is staged | `review/late-findings-routing.md` |
| `polish` | `wrap-up` (`decisions.md`, the ledger); the PR checklist | the walker does the skip path's bookkeeping, logging the `SKIP` and removing the polish PR row as the `fast-lane` path does today; no re-verify runs | `flow/steps-and-gates.md` Polish-phase decision tree |
| `creative-survey` | none | the Pipeline Summary omits the block | `flow/survey.md` |
| `depth-survey` | none | the Pipeline Summary omits the block; no `deepen-collapse` patch is staged | `flow/survey.md` |

### Ready records at the first evaluation

Counted on 2026-11-17 over the open `ready` records with C6 and C7, from the repository root. C6:

```
gh issue list --repo thn-inc/claude-tweaks --label ready --state open --limit 1000 --json number,labels,body > ready.json
```

C7 is `node graph-count.js < ready.json`, with `graph-count.js` as below. At `start` it applies the one leave-out rule a `start` fact can settle here, the design-integration clause of R5, R7, R9 and R10, with R5's gate rule. At `config` it adds R2's and R9's `fast-lane` clause for a labeled record; an unlabeled record's ceremony is the Manifesto's verdict, which no script can reproduce, so the script counts those records apart. It sets no run flag and no survey policy value, as neither is set in this repository's `.claude-tweaks/policy.yml`. A step a later point decides is in.

```js
// Counts open ready records by the steps selectRunGraph leaves out at `start` and at `config`. Run from the repository root.
const lib = (p) => require(require('path').resolve('plugin/bin/lib', p));
const { parseRecordFacets } = lib('issues/record-vocabulary.js');
const { liftMetadata } = lib('issues/materialize-format.js');
const { readDesignIntegrationFlagFromFile } = lib('design-detect/index.js');
const FAST_LANE_OUT = ['plan-audit', 'plan-review', 'architecture-alignment', 'review-spec', 'review-promises', 'review-hindsight', 'polish'];
const WRAPPER_STEPS = ['design-pre-build', 'design-gate', 'design-review', 'polish', 'creative-survey'];
const designOn = ['enabled', 'plugin-only'].includes(readDesignIntegrationFlagFromFile('.'));
const counts = {};
const add = (key) => { counts[key] = (counts[key] || 0) + 1; };
const list = (set) => [...set].sort().join(', ') || 'none';
for (const r of JSON.parse(require('fs').readFileSync(0, 'utf8'))) {
  const surface = String(liftMetadata(r.body).surface || '').toLowerCase();
  const out = new Set();
  if (!designOn) WRAPPER_STEPS.forEach((s) => out.add(s));
  else if (surface === 'backend' || surface === 'infra') out.add('design-pre-build');
  add(`start; left out: ${list(out)}`);
  const label = parseRecordFacets(r.labels).ceremony;
  if (label === 'fast-lane') FAST_LANE_OUT.forEach((s) => out.add(s));
  add(`config; ceremony ${label ? `${label} (label)` : 'judged by the Manifesto'}; left out: ${list(out)}`);
}
console.log('design-integration on:', designOn);
for (const [key, n] of Object.entries(counts)) console.log(n, key);
```

It prints:

```
design-integration on: false
590 start; left out: creative-survey, design-gate, design-pre-build, design-review, polish
456 config; ceremony judged by the Manifesto; left out: creative-survey, design-gate, design-pre-build, design-review, polish
95 config; ceremony standard (label); left out: creative-survey, design-gate, design-pre-build, design-review, polish
39 config; ceremony fast-lane (label); left out: architecture-alignment, creative-survey, design-gate, design-pre-build, design-review, plan-audit, plan-review, polish, review-hindsight, review-promises, review-spec
```

At `start`, the first evaluation, all 590 records get one graph: the vocabulary less the five design-wrapper steps, because this repository's CLAUDE.md sets no `design-integration:` key. At `config` they split into two: the `standard` graph for 95 to 551 records, and that graph less R2's six for 39 to 495, the ranges spanning how the Manifesto judges the 456 unlabeled ones (the script lists those with the `standard` set). Every record's graph at both points is the graph it gets today. Of the 590, 477 have no `Surface:` line (C8, from the repository root):

```
node -e 'const {liftMetadata}=require(require("path").resolve("plugin/bin/lib/issues/materialize-format.js"));const c={};for(const r of JSON.parse(require("fs").readFileSync(0,"utf8"))){const s=String(liftMetadata(r.body).surface||"absent").toLowerCase();c[s]=(c[s]||0)+1}console.log(c)' < ready.json
```

It prints `{ absent: 477, backend: 22, infra: 86, terminal: 5 }`.

**Expected effect on #4031's targets**, as an expectation and not a criterion: none from the function at its default. Every ready record keeps today's graph at the first evaluation. The one default change in this repository is R8's absent-surface clause, which adds `visual-review`, a skill load and a browserless recommendation, to a run whose record has no `Surface:` line and whose diff has no `frontend` path; for those runs both the median wall time and the round-trip count are expected to rise slightly. Movement toward 15 minutes and 120 round trips is expected from later rules, once each vocabulary step has an Evidence row of its own, not from this function's default or from its walker (`## Who walks the graph`).

Whether an unlabeled record takes the Manifesto's verdict or reads `standard` is decision 0.2 (`## Phase 0 — Decisions`).

## Never skipped

The roster's Never skipped table mixes two things: steps that must be in every graph, and stops that must fire when their step is in the graph. They are separated here. The assertions are conditions on the function's output and run at every evaluation. The stops are inside step bodies and fire whenever their step runs.

**On a violation.** At `start` on a fresh run (`## Who walks the graph`, Fresh runs and the absent store), before any step runs, a violation refuses the run with one line, `run graph: {id} violated: {assertion}`, and writes nothing. `start` comes before Step 2.8 mints a run directory or takes a claim, so the run has made nothing yet. Under `/claude-tweaks:dispatch` the dispatching session has already minted the group's run directory before `/claude-tweaks:flow` runs. In the ordinary case that is a minted run directory holding only `run-state.json` (the `dispatched: true` bind of `record-worktree --dispatch`, `dispatch/sibling-session-check.md`). After an escalated express call it also holds the express lane's claim and entries, because the lane claims at its step 1 and keeps the claim on escalation (`_shared/express-lane.md`, Procedure step 1 and Escalation). The refusal leaves that directory as it is, and the first call reports `ISSUE #{n}: failed:run-graph-refused`. This design adds a run-graph-refused special case to `dispatch/settle-and-merge.md`'s Settle, beside its No-dispatch-host and Blocker-landing special cases. Unlike No-dispatch-host, the fault is a rule defect that recurs on every attempt for the same record, so the case cannot leave the record in the queue. Its claimed case is the Blocker-landing case's: this run's `decisions.md` already carries a `Step 2.8: claimed #{n}` line, and a `decisions.md` that cannot be read counts as claimed. In the claimed case, run steps 1-2 with `--reason "failed: run-graph-refused"`, so the held claim is released; otherwise skip them. Either way skip steps 3-5: no `failure-check` classification, no attempt counted against `dispatch-retry-ceiling`, no `auto:merge` or `auto:merge-pending` revocation, no failure comment and no PR tombstone. In their place, label the record `bot:blocked`, bootstrapping the label as step 6 does, and post one comment carrying the refusal line, so no later firing pulls the record again. Under `DISPATCH_HEADLESS=1`, also follow `_shared/headless-self-report.md` with failing-check-name `flow-step-1-run-graph-refused`, as the No-dispatch-host case does. AC8's "nothing is written" concerns the run, which writes nothing here, and a record-level block is dispatch's existing stop mechanism, which Settle applies after the run has refused. A direct `/claude-tweaks:flow` refusal writes nothing at all. The dispatching session's first-call failure path (`dispatch/two-call-gate.md` §5) then makes its `cleanup-only` call. In both cases it appends the parenthetical `(run-graph-refused: skip the claim release)`, which `wrap-up/cleanup-procedures-execution.md` Section E honours as it does `blocker-landing`, because `release-claim.js` posts a release comment on an absent blob or a tombstone: a false one when this run never claimed the record, a duplicate when Settle already released it (§5, Blocker-landing stop). At a later evaluation a violation never stops or fails the run: the caller keeps `previous`, which still satisfies every assertion because no evaluation removes an asserted step, and logs one `SKIP` line naming the assertion through `log-decision.js`. Under the rules above no combination of inputs violates an assertion: each rule leaves out only steps no assertion names, or, for A7-A9, only under the condition the assertion allows. A violation therefore marks a defect in a rule, and the check keeps that defect from shortening a run.

### Assertions

| Id | Assertion on the output | Reason | Roster row or contract stop it keeps |
|---|---|---|---|
| A1 | `worktree-setup` is in | Every later step works in the branch it creates, and it holds the adopted-branch collision stop | contract: `/build`'s adopted-branch collision stop |
| A2 | `plan` is in | `tasks` executes the plan; the plan audit's Checks D and G run inside it on every profile | contract: the plan audit's hard fails, Checks D and G |
| A3 | `verify` is in | It produces `VERIFICATION_PASSED` and the runner's pass stamp, and a test failure stops the run there | roster: build Common Step 5; roster HARD-GATEs: test failures |
| A4 | `test` is in | It holds test Step 0's PR-bookkeeping stop and produces `TEST_PASSED`, which review Step 1.5 reads | contract: `/test` Step 0 |
| A5 | `review-code` is in | Review Step 2's diff shape and Step 3's lenses are the judgment every later step reasons from; it holds review Step 1.5's test gate | roster: review Steps 2 and 3; contract: `/review` Step 1.5 |
| A6 | `review-simplify` is in | Scoped to the diff already; its own covered-by-`simplify` check stays in its body | roster: review Step 5 |
| A7 | `visual-review` is in, unless the surface is `backend`, `infra` or `terminal` and no `frontend` path changed | A UI-dependent record must not reach a merge decision without a rendered check or an explicit decline (CLAUDE.md, #808) | roster: review Step 6 rendered-UI check |
| A8 | with design integration on, `design-gate` is in, unless the surface is present and recognised and the step's gate verdict is `skip` | R9's `fast-lane` leave-out of `polish` leans on it | roster: `/claude-tweaks:test` Step 1.5 Design CLI gate |
| A9 | with design integration on, `design-review` is in, under A8's condition | R9's `fast-lane` leave-out of `polish` leans on it | roster: `/claude-tweaks:review` Step 6.5 Design Quality Pass |
| A10 | `wrap-up` is in | Both of its modes keep reflect's Near-misses, Fresh-start and Friction lenses, the ceremony escape hatch and the `[IL-116]` cleanup floor | roster: reflect Near-misses, Fresh-start, Friction; Ceremony escape hatch; `[IL-116]` cleanup floor |

Every row of the roster's `## Never skipped` table is kept and none is dropped. Ten of its eleven rows map to assertions: review Steps 2 and 3 to A5, review Step 5 to A6, review Step 6 to A7, build Common Step 5 to A3, test Step 1.5 to A8, review Step 6.5 to A9, and reflect's lenses, the escape hatch and the `[IL-116]` cleanup floor to A10. The eleventh, its HARD-GATEs row, is covered by the stops below. A1, A2 and A4 keep stops from the contract's row.

### Stops

Each stop in the contract's "HARD-GATE / BLOCKED / STOP conditions" row (`_shared/auto-mode-contract.md`), with its step and whether that step is now in every graph:

| Stop | Step | In every graph |
|---|---|---|
| `/review` Step 1 spec compliance | `review-spec` (roster tag `review-step-1`) | No. R2 leaves it out under `fast-lane`, unchanged from today. The stop fires whenever the step runs |
| `/review` Step 1.5 test gate | `review-code` | Yes (A5) |
| `/build` Common Step 1.5 plan audit hard fails | Checks D and G in `plan`; Checks A, B, C and the headroom check in `plan-audit` (roster tag `plan-audit`) | `plan` yes (A2). `plan-audit` no: R2 leaves it out under `fast-lane`, and its own trivial-plan check skips it, both unchanged from today |
| `/test` Step 0 PR-bookkeeping check | `test` | Yes (A4) |
| `/build`'s adopted-branch collision stop | `worktree-setup` | Yes (A1) |
| `/build` Common Step 1.6 plan-review needs-human spec gap | `plan-review` (roster tag `plan-review`) | No. R2 leaves it out under `fast-lane`, and its own trivial-plan check skips it, both unchanged from today |
| `/claude-tweaks:dispatch`'s second-call missing-claim fallback | `merge` | In every graph by R1, and not asserted: a graph without `merge` merges nothing, which is the state the stop forces |

So of the three HARD-GATEs that sit inside a `fast-lane` skip today, none has its step in every graph: `review-spec`, `plan-audit` and `plan-review` stay out of a `fast-lane` graph, as today. Only the plan audit's Checks D and G, inside `plan`, run in every graph.

Stops dropped from the assertions, each with its reason:

- `/flow` Step 2.7 design-doc rejection: `start` runs for record targets only, a record reference after Step 1 item 5 and a topic name after item 6 resolves it, so a path argument, held to Step 2.7 and rejected there, never reaches `start`.
- `/build` Design Step 3 plan validation: a design-mode build, which `/claude-tweaks:flow` rejects, is not in the standard lane (`## Today's graph`).
- `/flow`'s multi-spec boundary-freshness escalation: it fires between two records of a multi-spec series, outside any one record's graph.
- `/flow`'s adopted-run PR-conflict catch-up stop: it fires in the adoption frame, before a resumed run's next evaluation.
- `/release` Step 4's two gates: outside any run.
- The roster HARD-GATEs row's "structural coupling", `/flow` Step 2.6's shape check: a stop in the run's frame between `start` and `config`, not in any step, and the contract's row says it is not a HARD-GATE under `auto`.

Each of these stops stays where it is; dropping it from the assertions changes none of them.

## Loops

A loop is a place where a step, or part of one, runs again in the same run. Each has a count or a time as its bound and a fixed outcome when the bound is reached. Today's bound is read from the file named, on this commit; where that file states no count, the column says so, and the proposed bound is new. Skill paths are relative to `plugin/skills/`; the SDD rows cite the installed `superpowers` 7.0.2.

**Loops**

| Loop | Steps it repeats | Proposed bound | When the bound is reached | Today's bound | File that states today's bound |
|---|---|---|---|---|---|
| Review fix wave | `test` (the wave's re-verify, `/claude-tweaks:test --source review`), after the fixes made inside `review-code` (Step 3 Routing), `review-hindsight`, `review-simplify`, and Step 6.7 for the late steps | New: 1 wave per wave point, 4 per review, each with 1 re-verify; no lens re-runs after a wave | New: unfixed findings stay STAGED for the Review Console; a red re-verify gets the `/test` fix-mode row's one attempt, then `review` is BLOCKED and the run stops at its gate | Step 6.7 only: "at most once per review"; a failing re-verify is a STOP. No count stated for the other points (Step 3 Routing, Step 4, Step 5) | `review/step3-routing.md`, Fix-wave server coordination (lines 128-130: the points, no count); `review/code-mode-steps.md`, Step 6.7: Late Findings Routing (line 366) and Step 1.5: Test Gate, its Gate table (line 117) |
| Verify retry | `verify` (build Common Step 5: fix, commit, re-run `verify.js`) | New: 2 fix-and-re-run cycles (3 runner calls) | New: the build gate's STOP with the verification failures; under `/claude-tweaks:dispatch` the failure counts toward the dispatch retry row | None stated: "If anything fails, fix it and commit the fix", with no count. The driver's counterpart has no retry: one `verify.js` run, killed at 30 minutes (`VERIFY_TIMEOUT_MS`); red tests stop the record (`failing-test`), a timeout fails it | `build/SKILL.md`, Common Step 5: Final Verification (line 287); `plugin/bin/lib/driver/steps.js`, the `VERIFY_TIMEOUT_MS` constant (line 104) and `testStep` (lines 946-959) |
| `/test` fix mode | `test` (one fix, then the scoped re-verify) | 1 fix attempt (unchanged); new: a PR-check red counts as that attempt | `staged/test-fix-{n}.patch` for the Review Console; the test gate fails and the run stops | 1 auto-fix, then "On re-verification fail or new issues, downgrade to STAGED". A PR-check red has no count: "fix forward, push, and re-run the gate" | `test/fix-mode.md`, Auto mode, "Auto-fix flow" (line 13); `_shared/pr-check-gate.md`, Routing by `state`, the `red` bullet (line 65) |
| Review test-gate re-trigger | `test`, from `review-code`'s Step 1.5 | 1 (unchanged) | STOP naming the stale stamp's cause | Re-trigger `/claude-tweaks:test` once; a second `verifiedHead: false` is a STOP, "never a second re-trigger" | `review/code-mode-steps.md`, Step 1.5: Test Gate, its Gate table (lines 113-114) |
| Plan-review rounds | `plan-review`: within a run, the reviewer's re-dispatch; across runs, a needs-human stop and its answer start a new run that reaches `plan-review` again | Within a run, unchanged: 1 review, 1 re-dispatch on `NEEDS_CONTEXT`, 1 re-audit. Across runs, new: 3 needs-human rounds per record | Within a run, a second `NEEDS_CONTEXT` is BLOCKED and the build proceeds without a review, as today. New: at the third round, needs-human rows that survive the convergence rule are not posted as a further question; the record gets `bot:blocked` and one comment sending it to `/claude-tweaks:specify` | Within a run: "once per plan", "re-dispatch once", "Re-audit once", and "The plan review itself never re-runs, so the step cannot loop". Across runs: no count, "No retry-ceiling count: this gate blocks on its first occurrence"; the converged-round rule narrows needs-human rows after one answered round but counts none | `build/plan-review.md`: the opening paragraphs before Inputs (line 7), Reading the reply (line 77), Spec gap — intent-resolvable (lines 104 and 106), Converged round (line 114), Spec gap — needs-human (line 162) |
| Polish re-verify | `test` (`skip-qa`; `design-gate` runs inside it) | 1 per run (unchanged) | STOP with the "Polish broke verification" failure card; polish is not retried | At most once per flow run, "One-cycle cap — no automatic retry" | `flow/steps-and-gates.md`, Polish-phase decision tree's "Re-verify one-cycle cap" (line 213) and Gate Behavior's `re-verify` row (line 181) |
| Driver reviewer fix round | driver steps `worker`, `commit`, `test` and `check` (the counterparts of `tasks` and `verify`) | 1 (unchanged) | The record stops pre-push and settles `express-escalated`, or keeps a propagated test or `check` result's own class | One fix round: "There is no second round" | `docs/driver.md`, The reviewer step, "One fix round" (line 150) |
| CI wait, standard lane | the check read inside `merge` (Step 2.5's bounded watch) | 15 minutes (unchanged) | Red path with reason `checks-pending-timeout`: `bot:parked`, the PR left ready, outcome `pending-review` | 15 minutes, "Fixed by design, not a policy key"; `MERGE_GATE_WATCH_SECONDS` is 900 | `_shared/pr-first-merge.md`, Step 2.5: Merge-verification gate, its Bounded watch (lines 198-199 and 241); `plugin/bin/lib/ci-health/constants.js`, the `MERGE_GATE_WATCH_SECONDS` constant (line 10) |
| CI wait, driver lane | the driver's `ci` step polls; its `merge` step's watch | `ci` 30 minutes; `merge` watch 15 minutes (unchanged) | `ci` reads `timeout` and the record ends `pending-review`; the merge watch parks as `checks-pending-timeout` | `CI_WAIT_BOUND_MS` 30 minutes, polled every 30 seconds; `MERGE_WATCH_BOUND_MS` 15 minutes | `plugin/bin/lib/driver/steps.js`, the `CI_WAIT_BOUND_MS` and `CI_POLL_INTERVAL_MS` constants (lines 108-109) and `ciStep` (line 1277); `plugin/bin/lib/driver/merge.js`, the `MERGE_WATCH_BOUND_MS` constant (line 38); `docs/driver.md`, Outcome words (line 88) and The merge step (line 190) |
| Verify's CI consult | the `verify.js` call inside `verify` or `test` | CI wait 900 seconds; 1 repeat of a timed-out subagent call; 1 re-run on exit 3 (unchanged) | The unit ends `BLOCKED` | `waitSeconds` 900 by default; "runs the same command once more"; "push and re-run once", "re-run once" | `test/verification.md`, Re-verify scoping's "Push first, and exit 3" (lines 115-124); `plugin/bin/lib/verify/declaration.js`, the `DEFAULT_CI_WAIT_SECONDS` constant (line 29) |
| Flaky retry | the failing test files inside `verify` or `test` | `flaky.maxRetries` per file, default 1, ceiling 2; then 1 isolation pass (unchanged) | The check fails (`retryFailed`) and goes to the verify retry or `/test` fix-mode row | `DEFAULT_MAX_RETRIES` 1, `MAX_RETRIES_CEILING` 2; the agent's "one isolation pass" | `plugin/bin/lib/verify/declaration.js`, the `DEFAULT_MAX_RETRIES` and `MAX_RETRIES_CEILING` constants (lines 19-20); `test/flake-handling.md`, the opening paragraphs (lines 5 and 7) and Named-file isolation (line 11) |
| SDD per-task fix loop | part of `tasks`: one fix dispatch and one scoped re-review per round | 5 rounds per task, then 1 targeted fix and 1 scoped re-review that `/build` authorizes (unchanged) | The breaker: each open finding is ruled on in SDD's ledger; a fix the last re-review does not confirm is staged as a deferral (`Defers: yes`) for the Review Console | "Five rounds maximum per task", the breaker after round 5; `/build`'s "one targeted fix dispatch plus one scoped re-review" | `superpowers` 7.0.2 `skills/subagent-driven-development/references/fix-loop.md`, The Fix Loop's round paragraph and "The breaker" (lines 21 and 59); `build/dispatch.md`, "Review findings go through the deferral gate (#3004)" (line 14) |
| Whole-branch review fix wave | part of `whole-branch-review`: one fix dispatch and one scoped re-review | 1 wave, then `/build`'s 1 targeted fix for a residual (unchanged) | As the SDD per-task fix loop row | "dispatch ONE fix subagent", "exactly one scoped re-review", "There is no second fix wave" | `superpowers` 7.0.2 `skills/subagent-driven-development/references/final-review.md`, Final Review and Finish, before Finish (lines 18, 22 and 29); `build/dispatch.md`, "Review findings go through the deferral gate (#3004)" (line 14) |
| Pre-review catch-up repair | the suite run inside `tasks` after a catch-up merge | 1 repair dispatch; 1 re-run of a CLI that exits non-zero (unchanged) | HARD-GATE stop with the merge state intact | "one implementer dispatch"; "re-run once; a second non-zero exit is a HARD-GATE stop" | `_shared/pre-review-catchup.md`, Outcomes (lines 15 and 29) |
| Context handoff | `test`, when the handed-off step is `review` (the auto-insert) | 3 handoffs per run (unchanged) | The gauge writes no handoff and the run continues in place | `HANDOFF_BOUND` 3 handoffs per run | `flow/context-handoff.md`, Reading the result (line 26); `plugin/bin/context-gauge.js`, `measure`'s `HANDOFF_BOUND` check (line 214) |
| Merge re-entry and conflict update | `merge` from its Step 2.5 or Step 3 | 1 re-entry on a moved head; 1 update-from-base (unchanged) | `pending-review`: reason `moving-target`, or the conflict comment | "one re-entry; a second change reports `pending-review`"; "Exactly one update-from-base attempt" | `_shared/pr-first-merge.md`, Step 2.5: Merge-verification gate, the `wait` row (line 187), and Conflict path (line 432) |
| Dispatch retry | every step, in a new run | 3 consecutive failed runs per record (`dispatch-retry-ceiling`, unchanged) | `bot:blocked`; the record leaves the queue | `dispatch-retry-ceiling` default 3 | `plugin/bin/lib/policy-schema.js`, the `POLICY_KEYS` entry `dispatch-retry-ceiling` (line 78); `dispatch/configuration.md`, Dispatch — Configuration, the `dispatch-retry-ceiling` row (line 7) |

The graph has no other cycle. Its steps run in the Step vocabulary table's order and every edge between two steps points forward, with each skill keeping its own step order (`## The selection function`): `wrap-up` holds `merge`, which runs inside its Review Console (the auto-merge short-circuit), before wrap-up's execute and close. So the rows above are the only places a vocabulary step, or part of one, runs again. One driver retry is left out because it repeats no vocabulary step: the driver's `pr` step retries `gh pr create` once, 15 seconds after a 5xx or a timeout (`PR_CREATE_RETRY_WAIT_MS` and `prStep` in `plugin/bin/lib/driver/steps.js`). None of the rows re-evaluates the function. Each evaluation point is evaluated once per run (`## Evaluation points`, "Once per run"); a loop repeats only steps already in the remainder the walker holds (`## Who walks the graph`) and never brings back a step the function left out. A repeated `design-gate`, inside the polish re-verify or a fix wave's `test`, may run its own `skill-gate.js` call again in its body, but that verdict does not go back to the function. The two rows that run a step again in a new run, the dispatch retry and a plan-review round after a needs-human stop, start a new graph at `start` with `previous` `null`, from the record as it then is: a sequence of runs, not a cycle in one graph.

## Who walks the graph

Skill paths in this section and the two after it are relative to `plugin/skills/`.

The function decides the steps; a walker runs them. Two walkers were compared.

| Question | (a) `drive.js` walks, with model workers for the judgment steps | (b) `/claude-tweaks:flow` calls the function and walks the result |
|---|---|---|
| Who calls the function | `drive.js`, in process | `run-graph.js`, a CLI over `selectRunGraph`, called by `/claude-tweaks:flow` and by the skill bodies at each evaluation point (table below) |
| Who runs a judgment step | a headless `claude -p` worker per step, under the driver design's Workers rules | the walking agent, through the step's skill, as today |
| Who applies a mode | the driver, which needs a second function or a mode beside each name, since the output is names only | the step's skill, by today's rule (`## The selection function`, Modes); neither the function nor the walker carries a mode |
| The user-facing stops: the Review Console, the `confirm` and `hybrid` Manifesto gate, `interactive` mode, a plan-review needs-human question | none can run in a headless worker; the driver ends the run and hands the stop to a session | in the session, as today |
| Bookkeeping inside step bodies: `gh`, labels, comments, `git` writes, `log-decision.js` | forbidden to every worker ("no worker runs `gh`, writes a label, posts a comment or merges", Workers), so every standard-lane skill body is rewritten first | unchanged |
| Nested dispatch: SDD's implementers and task reviewers, the review lenses, the qa-agents, the plan reviewer | each worker needs the `Agent` tool and wide rights, against "Narrow rights, never bypass mode" (Workers) | unchanged |
| A red test inside `verify` or `test` | the verify retry and `/test` fix mode (`## Loops`) fix it, which the driver may not do (Anti-goals, below) | unchanged |
| The resume points: dispatch's second call, `/claude-tweaks:flow #N wrap-up`, a handoff continuation | each is a `/claude-tweaks:flow` invocation on the previous release, so `drive.js` adopts a run directory `/claude-tweaks:flow` started, and the reverse | the same invocation on both releases (`## Mixed-version operation`) |
| What holds the walk to the graph | the driver's loop | a model following prose; the close check below makes a missing asserted step visible, not impossible |
| Expected effect on #4031's targets | the driver's Goals aim at them for express-sized records; for the standard lane none until the skill bodies are rewritten, and no number exists | round trips rise slightly. By a count of named calls, not a measurement, a run gains one Bash call each for `--at start`, `--at config` and `--at build` (Phase 2), and one for `--at plan`, one per roster-citing `--step` site that runs and one for the close check (Phase 3); each gated step's call (`--at {step}`, or `--step design-pre-build`), `journeys`'s included, replaces its `skill-gate.js` call one for one. Skills cite the roster beside an inline condition and never read it at run time (`_shared/ceremony-profile.md`, its opening paragraph), so no call is saved there. No number is measured |

**Choice: (b).** The standard lane's judgment steps hold the run's user-facing stops, its nested dispatch and its bookkeeping. Under (a) each needs a worker the driver's Workers rules forbid, and those rules are what contain worker-written code and record text ("The record body is untrusted input. The narrow rights and the bounds check contain the worker"). Lifting them for every judgment step redesigns the driver's safety; it does not extend it. Under (b) one program, `/claude-tweaks:flow`, walks every resume point on both releases. The choice is reversible: the function, its CLI and the store below do not depend on who walks, so a later design can move steps into `drive.js` one at a time, as each skill body sheds its bookkeeping, without changing any of them. This design reads the process-efficiency design's "extends the driver design" as taking the driver's convention and its shape, a function over facts with its state in the run directory, not its walker.

**Weakest point.** Under (b) a model still walks. The assertions guarantee the list, not that every step on it runs. The close check below reports a walk that missed an asserted step's skill; it does not prevent one.

**Driver design Non-goals and Anti-goals the choice changes.** (b) changes one Non-goal: "No change to `/claude-tweaks:flow`, the standard lane, the review lenses, or the hooks." This design changes `/claude-tweaks:flow` and the standard lane; it changes neither the review lenses nor the hooks. `drive.js` is untouched, so no Anti-goal changes. (a) would also have changed two Anti-goals: "It retries a denied action with wider rights, or tries to fix a red test run by itself.", since the standard lane's verify retry and `/test` fix mode fix red tests; and "It becomes another six-figure-byte module. Each step is a small function over an injected runner, in the shape `.claude/skills/gh-api-module-pattern` describes.", since every step a program can perform would become driver code, and every judgment step a worker launch with its modes, stops and nested dispatch.

**Convention.** The run graph has code as its statement of record and a usage page, not a prose contract with pinned tests. It takes the driver's Anti-goal as its rule: "For the driver, the code is the statement of record. It gets a usage page in `docs/` and nothing under `plugin/skills/_shared/`, and no test pins its prose." The statement of record is `selectRunGraph`, its rule and assertion tables and `run-graph.js`, under `plugin/bin/lib/run-graph/`; the usage page `docs/run-graph.md` names the CLI, the store, the exit codes and where the rules live, and copies no rule. Its tests are behaviour tests of the function and the CLI. A skill sentence that calls `run-graph.js` names the call and what to do with its answer and states no rule, so no rule has a prose twin to pin. The roster's convention, prose with a pinned test, ends with the roster (`## Roster replacement`).

### The remainder store

`run-graph.json`, in the run directory; in a multi-spec run, in each spec's `spec-{N}/` directory, the one `PIPELINE_RUN_DIR` names for that spec.

```
{ "schema": 1,
  "points": [
    { "at": "start",  "source": "evaluated", "facts": { "surface": "infra", "...": "..." }, "remainder": ["worktree-setup", "..."] },
    { "at": "config", "source": "evaluated", "facts": { "ceremony": "standard" }, "remainder": ["worktree-setup", "..."] }
  ] }
```

- `points` holds one entry per evaluation point the run has passed, in run order. The remainder in force is the last entry's. `facts` holds the closed values the function read at that point and nothing else. `source` is `evaluated`, or `backfilled` for an entry the absent-store branch wrote. An entry whose evaluation violated an assertion also carries `violation`, the assertion's id, and its remainder is the one the rule in `## Never skipped` kept.
- Writer: `run-graph.js` and nothing else. It rewrites the file atomically and appends one entry per call that evaluates a point.
- A call for a point the store already records evaluates nothing and prints the stored entry. That is how "Once per run" (`## Evaluation points`) holds in code: a repeated call is harmless.
- Readers: `run-graph.js` only. The walker asks it for a point (`--at`) and a skill asks whether a step is in the remainder (`--step`, which evaluates nothing; a step a later point still decides reads as in). With no run directory, a standalone skill invocation, a skill asks nothing and runs its steps as it does today without a `config.yml`. The close, archive and reconcile paths read nothing in the file. `archive-run` moves it with every other entry, because `archiveRunDir` (`plugin/bin/lib/reconcile/archive-merged.js`) lists the run directory with `fs.readdirSync` and moves each entry but `work/` and the `spec-*` directories, which it handles apart (`wrap-up/cleanup-procedures-execution.md` Section C step 4). The installed release 6.170.0 does the same, so a previous-release archive moves the store too. A store written by an add-stage release has no `plan`, `journeys` or gated-step entries. `--step` reads a step those points decide as in, and a migrate-stage walker continuing such a run asks about none of the passed ones: `whole-branch-review` and `journeys` run in the first call, and the gated points still ahead are evaluated as usual.

| Point | Who calls | Call | Writes |
|---|---|---|---|
| `start` | `/claude-tweaks:flow` Step 1, after the record's `--check` passes | `run-graph.js --at start --steps {resolved step list}`, with `--run "$PIPELINE_RUN_DIR"` when it is set | nothing when it prints a stored entry or evaluates dry: it prints `{at, facts, remainder}`, or, on a fresh run's violation, the one refusal line and a non-zero exit. On a run that meets the absent-store branch, the backfilled store |
| `config` | `/claude-tweaks:flow`, after Step 3's Manifesto has written or adopted `config.yml` | `run-graph.js --run … --at config --start-facts {the facts start printed}`, with `--fresh` on a fresh run only | with `--fresh`, the `evaluated` store with its `start` and `config` entries; otherwise the stored entry or the backfilled store |
| `plan`, `journeys` | `/claude-tweaks:build`, after `plan` and before `journeys` | `--at plan`, `--at journeys` | one entry |
| `build` | `/claude-tweaks:flow`, after the build closes | `--at build` | one entry |
| each gated step | the step's skill body, in place of its own `skill-gate.js` call, which the CLI makes itself (`decide`) | `--at {step}` | one entry |

**Facts at `start`.** The `--check` envelope carries row 4 (surface). `materialize.js --check` adds four fields to it, `type`, `size`, `risk` and `riskFlags` (rows 1-3 and 6), parsed by the functions the Inputs table names from the record it has already fetched, on the `--record-json` path as on the `gh` one. Fields are added and none renamed, so a previous-release reader of the envelope is unaffected. No rule reads those four today, so `start`'s output does not depend on them, but the function takes them and the store records them. Rows 10-12 `run-graph.js` reads itself: CLAUDE.md, `resolve-policy.js`, and the run flags, which the walker passes as the closed tokens Step 1 parsed. It computes `design-pre-build`'s gate verdict with `decide`.

**Start facts are relayed as facts.** A fresh run has no run directory at `start`, so the walker holds the printed facts until `config`. `--start-facts` is checked value by value against the Inputs' closed sets, an invalid value is read at its most cautious, and the function recomputes the `start` remainder from them. A relayed fact set can only yield a graph the function gives some record, which satisfies every assertion (`### Inputs from model judgment or record text`); a relayed remainder could drop an asserted step, so none is relayed.

**Fresh runs and the absent store.** Whether a run is fresh is read from run state, not from which call is made. One rule: a run is fresh when Step 3 creates its run directory through case 5's creation path, which case 4 (a stale or unanchored `PIPELINE_RUN_DIR`) falls through to; or adopts a directory `computeAdoption` (`plugin/bin/lib/flow/preflight.js`) reads as case 2 whose `decisions.md` holds no Manifesto config snapshot (`_shared/auto-decision-log.md`, File format), since the `dispatched: true` branch reads a directory with content as case 2 too; or adopts as case 3 right after this invocation's own express escalation. Each point applies it to what it can see:

- **At `start`, `run-graph.js` judges freshness itself, since Step 3 has not run yet.** A run is fresh in three cases:
  - `--run` is absent and the resolved step list includes `build`. Step 3's case 5 then creates the directory, because its resume check applies only to a list without `build` (`steps-and-gates.md`, Adopting an inherited run directory, case 5).
  - `--run` names a directory that `computeAdoption` reads as case 4, which Step 3 replaces through case 5's creation path.
  - `--run` names a directory that `computeAdoption` reads as case 2, with no Manifesto config snapshot.
  - Otherwise it is not fresh at `start` and refuses nothing, including where `start` cannot tell, as for a list without `build` and no `--run`.
- **At `config`, the walker says it, with `--fresh`.** It passes the flag when Step 3 took case 5's creation path, case 4's included, or case 2 with no Manifesto config snapshot in `decisions.md` (`flow-preflight.js`'s `adoption.value.case`). It also passes it when Step 3 took case 3 right after this same invocation's Step 2.9 took the express lane and got `express-escalated` (`flow/express-entry.md`: case 3, no `config.yml`).
  - Only that knowledge tells an escalated express run from a run whose `config.yml` was lost, which is also case 3. The run directory cannot: a previous-release escalated run carries the same `Express lane: escalated` line.
  - Under `/claude-tweaks:dispatch`, an escalated express run is re-bound `dispatched: true` before its first call (`dispatch/SKILL.md`, Express lane). Step 3 reads it as case 2, so it is fresh as well.
- **Only `--at config --fresh` creates an `evaluated` store.** Any other call whose `--run` names a directory holding `config.yml` and no `run-graph.json` meets a run that passed `config` without a store, one started on a release without the run graph or one whose `config` call never landed, and takes the absent-store branch. These are adoption case 1, case 2 with a Manifesto config snapshot, case 3 without an escalation in this invocation, and a resume adopted only at Step 3 through case 5's resume check, whose Step 1 call had no `--run`.

The branch evaluates `start` and `config`. `start` comes from the start facts its invocation passes, which every `/claude-tweaks:flow` invocation for a record target holds from its own Step 1, read as absent when none are passed. `config` comes from `config.yml`'s `ceremony-profile`. It writes both entries as `backfilled`, logs one `SKIP` line naming the missing store, and then answers its own call. A misjudged `--fresh` changes that label, that `SKIP` line and whether the close check runs, since the close check checks nothing on a backfilled store; neither call refuses.

**No refusal outside a fresh `start`.** A violation anywhere else refuses nothing. That covers a non-fresh `start`, `config`, a backfill and every later point. The entry keeps the previous entry's remainder, or, with none stored, the whole vocabulary, which holds today's graph and satisfies every assertion, and one `SKIP` names the assertion. This is AC8's later-evaluation rule, and it keeps every row of `## Mixed-version operation` from ending in a failed or restarted run. The absent-store branch is permanent. It is how a run directory that reaches the walker without a store is read, as an absent fact is read at its most cautious, so it has no removal condition.

| Case | Finds | Does |
|---|---|---|
| Dispatch's second call | the store call 1 wrote, under the same `PIPELINE_RUN_DIR` | Step 1's `--at start` and Step 3's `--at config` print the stored entries; it evaluates only the points ahead |
| A context-handoff continuation | the same directory and `handoff.json` | as the second call |
| A resumed or adopted run: adoption case 1 or 3, or a step-subset `/claude-tweaks:flow #N {steps}` adopted at Step 3 through case 5's resume check | the store, when the run passed `config` on a release that writes one | As the second call. Without a store it takes the absent-store branch: at Step 1 when `--run` names a directory holding `config.yml`; otherwise at Step 3's `--at config`, which carries no `--fresh` |
| Adoption case 2: a mint holding only claim lines or the dispatch bind, an escalated express run under dispatch included | no `config.yml` and no store | `start` evaluates dry as on a fresh run and may refuse; Step 3's `--at config --fresh` creates the store |
| `dispatch resume` | a fresh run directory, "one no earlier claim names" (`dispatch/settle-and-merge.md`, No-dispatch-host special case) | a new graph from `start` |

**Walking.** An invocation walks the remainder's steps its step list covers, in remainder order. A step-list entry covers the vocabulary steps its skill holds (`## Not a step`), and the step list keeps today's rules (`/claude-tweaks:flow` Step 1 item 4, `no-polish` included), so a flag typed on a later invocation still trims what that invocation walks. A step-list entry none of whose steps is in the remainder is passed over with one `SKIP` line naming the rule that left it out.

**Close check.** At wrap-up's close, before `close-run`, one `run-graph.js --run … --check-walk` call compares the store's remainder with the run's skill events (`events.jsonl`) at skill granularity: `/claude-tweaks:build` for A1-A3, `/claude-tweaks:test` for A4 and A8, `/claude-tweaks:review` for A5-A7 and A9. It logs one `SKIP` line per asserted step whose skill left no event, which the Review Console shows, and never fails the close. On a backfilled store, or with no store, it logs one `SKIP` and checks nothing.

The choice between (a) and (b) is decision 0.1 (`## Phase 0 — Decisions`).

## Roster replacement

Process-efficiency Decision 0.1 binds the replacement: "a change must not break a run in flight on the previous release, because live sessions run mixed plugin versions." So the new form is added beside the roster, every consumer is migrated to it, and the roster is removed under the condition at the end of `## Mixed-version operation`.

| Stage | What lands | Behaviour change |
|---|---|---|
| Add | `selectRunGraph`, `run-graph.js`, the store, the walker's calls at `start`, `config` and `build`, the four `--check` fields, and the run-graph-refused special case in dispatch's Settle and teardown. The `run-graph-refused: skip the claim release` phrase lands where its sibling phrases are declared and pinned: `dispatch/two-call-gate.md` §5, `wrap-up/flags.md`'s `cleanup-only` entry, `wrap-up/cleanup-procedures-execution.md` Section E, `tests/dispatch-prompt-cli-prose.test.js` and `tests/settle-blocker-landing-stop-conformance.test.js` | none: the walker records the store and walks as today, and no skill reads the store yet |
| Migrate | each sentence that skips a step by citing the roster asks `run-graph.js --step` instead; the walk follows the remainder (Walking, above); `/claude-tweaks:build` calls `--at plan` and `--at journeys`; each gated step's `skill-gate.js` call becomes its `--at {step}` call; the close check | at the default, only the absent-surface additions (`## The selection function`, What a defaulted surface adds). Each skip keeps today's `decisions.md` line, `--step` label and text included, because a previous-release session may read the log |
| Remove | the roster file and its test, then a sweep of the citations C9 does not scope: `docs/plugin-structure.md`, `docs/skill-graph.md`, `docs/journeys/add-a-fast-lane-skip-to-the-roster-1926.md`, `docs/journeys/answer-a-plan-review-question-3377.md`, `docs/journeys/merge-small-adjacent-tasks-at-plan-time-3379.md`, and the `SKILL.md` of `.claude/skills/removal-condition-execution`, `.claude/skills/shared-contract-extraction` and `.claude/skills/skill-prose-conformance-tests` | none |

| Item | Fate | By what, or under what condition |
|---|---|---|
| The roster's `## Skips by profile` | replaced, then removed | R2, R3 and R9 in code (`### Rules`). `reflect-light-mode` becomes part of `wrap-up`'s `fast-lane` mode, stated in `reflect/light-mode.md`; `red-team-persona`, a `/claude-tweaks:specify` step (`## Not a step`), is stated in `specify/red-team.md`. Removed at the remove stage |
| The roster's `## Never skipped` | replaced, then removed | A1-A10 in code; the stops stay in their step bodies (`### Stops`). Removed at the remove stage |
| The roster's `## Mentions that are not skips` | removed | It indexes the mentions `tests/ceremony-profile-roster.test.js` must not read as skips, so it goes with that test |
| The `ceremony:*` labels | kept | the ceremony input's source (Inputs row 5); `/claude-tweaks:specify` stamps them |
| The `config.yml` `ceremony-profile` key | kept | the ceremony input. `wrap-up`'s mode, the efficiency-budget ceilings (`plugin/bin/lib/timing/budget.js`), the absent-store branch and a previous-release session continuing a new run all read it |
| The `ceremony-check` mode | kept | it stamps the label and gives the Manifesto's verdict for an unlabeled record |
| `plugin/bin/lib/dispatch/ceremony-derive.js` | kept | `wrap-up`'s mode rule; it selects no step |
| The wrap-up Ceremony escape hatch | kept | A10 names it; it changes only `wrap-up`'s mode |
| `tests/ceremony-profile-roster.test.js` | replaced, then removed | by behaviour tests of `selectRunGraph` (each rule, each assertion, each most-cautious read) and of `run-graph.js` (the store, the repeated call, the absent-store branch, the relayed facts). Removed with the roster tables, which it pins while they exist |
| `docs/decisions/0006-ceremony-tiering-owned-by-specify.md` | kept, with a note | Its decision, that `/claude-tweaks:specify` computes and stamps the label, stands. The migrate stage adds a dated note in the file's own form saying that step selection now reads the label through the run graph, and adds a decision record for the run graph itself |

The roster file's text outside its tables moves to the files it describes before the remove stage:
- The opening paragraph's account of how the profile is stamped, folded, narrowed and raised moves to `docs/run-graph.md`, under the ceremony input; its description of the pin goes with the test.
- The value-collision decision moves to `_shared/policy-schema.md`'s `design-ceremony` row.
- The escape-hatch paragraph moves to `wrap-up/SKILL.md`'s Ceremony escape hatch.
- "The two-call split is kept" moves to `dispatch/two-call-gate.md`.
- `## Express lane` moves to `_shared/express-lane.md`.

## Mixed-version operation

Each session reads the skill files and CLIs of the release it has installed. What crosses releases is the run directory and the record. "Previous release" is the last release without the add stage; "new code" is a release with the migrate stage. A release with the add stage alone walks as today and also writes the store, so it reads a run as the previous release does.

| Case | What the reader finds in the run directory | What it does |
|---|---|---|
| Started on the previous release; dispatch's second call runs the new code | `run-state.json`, `config.yml`, `decisions.md`, the worktree's commits; no `run-graph.json` | The absent-store branch backfills `start` and `config`, the ceremony from `config.yml`, then walks `review,polish,wrap-up` within that remainder: the previous release's graph for those steps, plus the absent-surface additions. The run completes |
| Started on the previous release; `/claude-tweaks:flow #N wrap-up` on the new code | the same | With `PIPELINE_RUN_DIR` carried forward, it takes the same backfill at Step 1. Without it, Step 1's `--at start` has no `--run` and a list with no `build`, so it is not fresh and refuses nothing; Step 3's case 5 resume check adopts the run as case 1, and `--at config`, which carries no `--fresh`, backfills. It walks `wrap-up` |
| Started on the previous release; a context-handoff continuation on the new code | the same, and `handoff.json` | the same backfill at the continuation's first `run-graph.js` call |
| Started on the previous release; the close path (`hooks.js close-run`, wrap-up Section C) and the reconcile path (`hooks.js reconcile`'s reap and archive checks) on the new code | the same | They read nothing of the graph. The close check logs one `SKIP` for the missing store and checks nothing; `archive-run` moves the directory's entries as today |
| Started on the previous release, its `config.yml` lost; adopted by the new code (adoption case 3) | `decisions.md` and run content, no `config.yml`, no store | Step 1's `--at start` finds a directory that `computeAdoption` reads as case 3, so it is not fresh: it evaluates dry and refuses nothing. Case 3 rewrites `config.yml` from the config snapshot as today. The walker passes no `--fresh`, because this invocation did not escalate, so `--at config` backfills |
| Started on the new code; dispatch's second call, `/claude-tweaks:flow #N wrap-up` or a handoff continuation in a previous-release session | `run-graph.json` beside `config.yml` | The previous release ignores the file, reads `ceremony-profile` and its own roster, and walks today's graph. It does not make the absent-surface additions, so A7-A9's absent-surface clauses are not enforced in that session; no step is missing that today's graph holds, because at the default no rule leaves one out. The run completes |
| Started on the new code; closed or reconciled by previous-release code | `run-graph.json` among the entries | `close-run` reads nothing of it; `archive-run` moves it with the rest, since `archiveRunDir` lists the directory's entries rather than a fixed set (`### The remainder store`) |
| A prose express run escalated into `/claude-tweaks:flow` on the new code (the lane is unchanged, Non-goals) | the express lane's run content, no `config.yml`, no store | A direct run is adoption case 3 right after this invocation's Step 2.9 escalation (`flow/express-entry.md`): `start` was evaluated before Step 2.8's claim, and `--at config --fresh` creates the `evaluated` store. Under dispatch the run is re-bound `dispatched: true`, so it is case 2 and fresh. Its `start` may refuse while the express lane's claim is held, and Settle then releases that claim (`## Never skipped`, On a violation) |
| A record labelled `ceremony:fast-lane` before the change and built after it | a new run directory; the Manifesto folds the label into `config.yml` as today | R2, R3 and R9 read `fast-lane`: today's fast-lane graph, plus the absent-surface additions |
| This repository's `policy.yml` sets `run-graph-rules`; a previous-release session reads it | the policy line, not the run directory | A previous-release resolver never requests the key, so that session walks today's graph. The opt-in phase waits for the release that carries the rule (`## The selection function`) |

Under the rules no row fails or restarts a run; a fresh run's `start` refuses only on a rule defect, before any step, and the one fresh case among the rows then releases the claim it holds (`failed:run-graph-refused`, `## Never skipped`). The absent-store branch refuses nothing, and a previous-release session ignores the store.

**Removal condition.** The old form is the roster: `_shared/ceremony-profile.md`'s three tables and every sentence that skips a step by citing them. Removing it breaks no run in flight, because no run reads the new release's copy of it. A previous-release session reads the roster of the release it has installed, which the removal does not touch; a new-release session reads a store-less run through the absent-store branch, which reads `config.yml`, not the roster. So the condition counts files, not runs: the remove stage lands when no file under `plugin/` or `tests/` cites the roster by name or by tag, except the roster, its own test and `build/plan-review.md`, whose plan-review `SKIP` text, `(roster tag plan-review)`, is read as a log line, not a citation. C9, from the repository root:

```
git grep -l -E "ceremony-profile\.md|roster tag" -- plugin tests
```

On 2026-11-17, at the base (`git grep -l -E "ceremony-profile\.md|roster tag" f88beb9ecbef1f0b2560249df0d3ae70a96b4843 -- plugin tests`), it prints 24 paths: the roster, its test, 18 other skill files and 4 other test files (`tests/build-plan-review-conformance.test.js`, `tests/express-lane-prose.test.js`, `tests/log-decision-text-file-sites-conformance.test.js`, `tests/plan-review-hard-gate-conformance.test.js`). The migrate stage drives the 4 tests and 17 of the skill files to none. It rewrites `build/plan-review.md`'s prose citation (its line 172) but keeps the `SKIP` text, so 3 paths remain: the roster, its test and `build/plan-review.md`. The remove stage deletes the first 2 and drops the parenthetical from the third (Phase 4). Data source: `git grep` over this repository, which sees every file in it and nothing outside it. It cannot see cloud routine runs, other machines, or consumer projects on an older release, and the condition does not need to: each of those reads the roster of the release it has installed, and a consumer that upgrades past the remove stage with a run open reaches the absent-store branch.

The absent-store branch has no removal condition (`### The remainder store`). Its load on this machine, counted with C10, `node store-count.js <main-checkout>/.claude-tweaks/pipelines`, where `store-count.js` is:

```js
// Run directories directly under a pipelines root (archive/ left out) whose run-state.json status is not
// `clean` and which hold config.yml: how many hold run-graph.json, and the oldest and newest run id.
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const out = { open: 0, withConfig: 0, withStore: 0, withoutStore: 0, ids: [] };
for (const name of fs.readdirSync(root).sort()) {
  const d = path.join(root, name);
  if (name === 'archive' || !fs.statSync(d).isDirectory()) continue;
  let status = null;
  try { status = JSON.parse(fs.readFileSync(path.join(d, 'run-state.json'), 'utf8')).status; } catch {}
  if (status === 'clean') continue;
  out.open += 1;
  if (!fs.existsSync(path.join(d, 'config.yml'))) continue;
  out.withConfig += 1;
  out.ids.push(name);
  if (fs.existsSync(path.join(d, 'run-graph.json'))) out.withStore += 1; else out.withoutStore += 1;
}
console.log(JSON.stringify({ ...out, ids: undefined, oldest: out.ids[0], newest: out.ids[out.ids.length - 1] }));
```

On 2026-11-17 it printed `{"open":293,"withConfig":20,"withStore":0,"withoutStore":20,"oldest":"2026-09-01T123248-record-1664","newest":"2026-11-17T080323-spec-5844"}`. A run directory left open since 2026-09-01 is why the branch stays: a count that must reach zero could wait on abandoned runs indefinitely. The count falls as wrap-up closes and archives runs and as the reaper and `/claude-tweaks:tidy` clear abandoned ones; once the add stage is the installed plugin, only a run whose `config` call never landed adds one. Data source: this machine's pipelines root. It cannot see cloud routine runs, whose run directories live in the sandbox and end with it, other machines' run directories, or consumer projects on an older release, whose open runs reach the branch when they upgrade.

## What this design does not decide

- It builds nothing. No file under `plugin/` changes with this document. Its phases are for `/claude-tweaks:specify` to decompose, and this record files no record for any of them.
- The prose express lane (`_shared/express-lane.md`) and the driver's admission and bounds for express-sized records (`plugin/bin/lib/express/eligibility.js`, `plugin/bin/lib/driver/admission.js`, the `express-driver-max-*` policy values) are unchanged. No phase touches `plugin/bin/drive.js` or `plugin/bin/lib/driver/`.
- It sets no rule that gives a record fewer steps than today, because none exists: every rule in `### Rules` is unchanged from today, and no step has an Evidence row that can carry one. Phase 6 is the form such a rule takes. Which rule comes first, and the number it rests on, is for a later record.
- Whether `drive.js` later walks some standard-lane steps. Decision 0.1 recommends `/claude-tweaks:flow` as the walker. The function, its CLI and the store do not depend on the walker, so that question stays open.
- The rules of the three modes (`plan`'s micro-plan, `review-code`'s effort tier, `wrap-up`'s `fast-lane` mode), the `ceremony-check` judgment, who stamps `ceremony:*` (decision 0006), the skill-load gate's own rules (`decide`, #5605) and the review lens dispatch path (`review-lens-dispatch`, #5599). Each stays as it is today.
- Any step's model profile (#4030).
- Whether the 477 ready records without a `Surface:` line get one. Reading an absent surface at its most cautious value adds `visual-review` loads (`## The selection function`, What a defaulted surface adds). A backfill through `/claude-tweaks:specify` would remove that cost; it is decision 0.5, and no phase here does it.

## Open records

Looked up on 2026-11-17 with `gh issue view {n} --repo thn-inc/claude-tweaks --json state,title,labels,closedAt`. The sub-issues of #5225 came from `gh api repos/thn-inc/claude-tweaks/issues/5225/sub_issues`, and the process-efficiency records from `gh issue list --repo thn-inc/claude-tweaks --state all --search "process-efficiency in:body" --limit 100 --json number,title,state`. This record edits none of them.

| Record | State | Title | Disposition | Reason |
|---|---|---|---|---|
| #3381 | open | Decide /flow's double whole-branch review from measured per-dispatch cost | waited for by Phase 4 | Its Outcomes 1 and 2 change the roster and its pin test, and Phase 4 deletes both. Phase 4 waits until #3381 closes, or until it is reshaped so its skip lands as a `run-graph-rules` rule (Phase 6) |
| #5292 | open | Plan review's needs-human question is the largest mid-flow stop: raise spec gaps at /specify | waited for by Phases 4 and 5 | Its Key Files include `ceremony-profile.md`, which Phase 4 deletes. It also narrows the plan-review stop whose rounds Phase 5 counts |
| #5262 | open | The express lane never admits a /capture-born record — no ceremony label until /specify | independent | It changes the express lane's admission, which this design leaves unchanged |
| #4118 | open | /capture's born-ready branch files `ready` records with no `ceremony:*` label, so every one pays /flow's ceremony-check fallback | independent | It changes where the ceremony value comes from. The function reads `config.yml`'s `ceremony-profile` either way (Inputs row 5) |
| #5232 | closed | Route driver-admitted singletons from /claude-tweaks:dispatch to drive.js | independent | Closed on 2026-11-16 (`closedAt` `2026-11-16T08:27:53Z`), before this design's base. No phase touches `drive.js` or the dispatch route |
| #5225 | open | Pipeline driver, Phase 5: queue selection in the driver | independent | Sub-issues #5227, #5229 and #5230 are closed; #5231 (Remove the embedded queue-pull and ranking scripts) is open. Queue selection picks which record runs, not which steps it takes |
| #4030 | open | Re-measure and move build,test dispatch agents to the Standard profile once ceremony is deterministic | independent | No phase changes a step's profile. Ceremony does not become deterministic here, because the label and the Manifesto's verdict stay its source |
| #5594 | open | Process efficiency Phase 6: review fan-out as a plugin workflow | independent | Its five sub-issues, #5595 to #5599, are closed. The dispatch path changes neither `review-code`'s unit nor its outputs (`## Step vocabulary`) |
| #5825 | open, `parked` | Measure the workflow review lens dispatch against the Task dispatch before flipping its default | independent | It holds the check for flipping the default of process-efficiency Phase 6's key; same reason as #5594 |
| #5783 | open, `parked` | Measure sleep-led subagent Bash calls 30 days after the wait-for.js prose shipped (#5604) | independent | It holds the check for process-efficiency unit 4.1, whose waits are not steps |

Process-efficiency Phase 4 has no other open record. #5600 and its sub-issues #5601, #5602, #5604 and #5605 (unit 4.2) are closed. #5605's gate verdict is Inputs row 9, and Phase 3 moves its call into `run-graph.js`.

## Order and file sizes

- Phase 0 is decisions. Each is needed only by the phase that names it.
- Phases 1 to 4 run in order: add (1 and 2), migrate (3) and remove (4), the stages of `## Roster replacement`. Phases 1 and 2 change no behaviour. Phase 3 changes it at the default only through the absent-surface additions.
- Phase 5, the new loop bounds, is independent of Phases 1 to 4.
- Phase 6 needs a rule that does not exist yet. Phase 7 waits for the release that carries Phase 6.
- Phases 2, 3, 4 and 5 reword the roster or files that cite it or are pinned by tests. Each must pass the full suite, and each names `.claude/skills/skill-prose-conformance-tests` and `.claude/skills/shared-contract-extraction` for its builder. Phases 4 and 6 add a removal or a policy key, so they name `.claude/skills/removal-condition-execution` and `.claude/skills/policy-key-addition`. No phase adds a driver step, so `.claude/skills/driver-step-addition` applies to none.

Skill prose is read whole only up to 52,500 bytes. A phase that adds text to a skill file of 47,250 bytes or more says what it removes from that file. Every phase is done only when each skill file it edits is still under 52,500 bytes, and each file of 47,250 bytes or more is no larger than at the phase's base. Two edited files sit within about 2 KB of the threshold: `wrap-up/SKILL.md` (45,115 bytes, Phase 3) and `review/code-mode-steps.md` (below). Sizes from `wc -c {file}` at this design's base:

| File | Bytes | Phases that edit it |
|---|---|---|
| `plugin/skills/build/plan-authoring-checks.md` | 52,497 | 3 |
| `plugin/skills/flow/SKILL.md` | 51,924 | 2, 3 |
| `plugin/skills/dispatch/SKILL.md` | 51,675 | none |
| `plugin/skills/dispatch/settle-and-merge.md` | 51,106 | 2 |
| `plugin/skills/_shared/policy-schema.md` | 49,849 | 3, 6 |
| `plugin/skills/build/SKILL.md` | 49,340 | 3, 5 |
| `plugin/skills/wrap-up/cleanup-procedures-execution.md` | 49,084 | 2 |
| `plugin/skills/_shared/auto-mode-contract.md` | 47,500 | 5, only if its plan-review text needs it |
| `plugin/skills/review/code-mode-steps.md` | 46,443 | 3, 5 |

The record's Gotchas gave `review/code-mode-steps.md` as 52,358 bytes. At this base it is 46,443, below the threshold. The other four the Gotchas name are within 413 bytes of their stated sizes.

## Phase 0 — Decisions

No build. The maintainer answers; the answer is written into this section.

**0.1 Who walks the graph.** This design compares two walkers (`## Who walks the graph`) and takes (b), `/claude-tweaks:flow` calling `run-graph.js`. The repository also supports (a), `drive.js` walking with model workers for the judgment steps. The process-efficiency design's Phase 7 calls this "a design doc that extends the driver design to the standard lane". The driver design makes `drive.js` the program that walks a run: "The driver inverts control. A program owns the steps that need no judgment and starts a model only for the steps that do." Record #5580's Technical Approach leaves the reading open: "AC12's comparison settles whether that means `drive.js` walks the standard-lane graph." Recommendation: (b) for this design's phases. Its weakest point is that (b) leaves a model walking, where (a)'s walk would be code. Choosing (a) later reuses the function, `run-graph.js` and the store unchanged, but it first needs the skill bodies to shed their bookkeeping, and no phase here does that. Needed before Phase 2.

**0.2 An unlabeled record's ceremony.** The ceremony input takes the Manifesto's `ceremony-check` verdict for a record with no `ceremony:*` label, as today. The stricter reading treats an absent label as `standard`. That adds R2's six steps, and `whole-branch-review` on a one-task plan, to each unlabeled record the Manifesto would judge `fast-lane`: up to 456 of today's 590 ready records. Recommendation: keep the verdict. Neither value removes an asserted step, so the stricter reading strengthens no assertion, and the verdict comes from the same `ceremony-check` mode that stamps the label. The weakest point is that a headless Manifesto verdict has no human on it, while `/claude-tweaks:specify`'s stamp can have one. The stricter reading gives more steps, so it would need no policy value. Needed before Phase 1.

**0.3 Plan-review rounds across runs.** Today nothing counts them. A needs-human stop blocks on its first occurrence. The human answers, and the next run may ask again. The converged-round rule (#4958) narrows the needs-human rows after one answered round, but it counts no rounds (`build/plan-review.md`). `## Loops` proposes 3 needs-human rounds per record. At the third round, rows that survive the convergence rule are not posted as another question. Instead the record gets `bot:blocked` and one comment sending it to `/claude-tweaks:specify`. Only the maintainer can set this, because it ends a question-and-answer exchange with a human on a record. Recommendation: 3. The weakest point is that no measured distribution of rounds per record backs the number. Needed before Phase 5.

**0.4 `review-spec` under `fast-lane`.** R2 leaves `review-spec` out of a `fast-lane` graph, as today, so review Step 1's spec-compliance stop is not in every graph (`### Stops`). Making the step unconditional adds a step, so it would need no policy value. `[IL-145]` records a defect this skip let through: a fast-lane build hand-edited a generated file, and the skipped Step 1 is the check that compares the spec's Key Files with what the diff touched. Recommendation: keep today's leave-out in these phases. Nothing measures how often `review-spec` changes an outcome: it has no Evidence row of its own, and its stop is decision-log prose the tool does not count (`### What "outcome-changing" counts and what it cannot see`). The weakest point is that one recorded miss is evidence, and an absent count is not evidence of no misses. If the maintainer makes the step unconditional, R1 takes `review-spec`, an assertion holds it, and Phase 1 builds both. Needed before Phase 1.

**0.5 Records with no `Surface:` line.** An absent surface is read at its most cautious value (`## The selection function`, What a defaulted surface adds), which puts back the skill loads #5605's gate removes: R5, R7, R9 and R10 with design integration on, and in this repository, where it is off, R8's `visual-review`. 477 of the 590 ready records have no `Surface:` line (C8), so from Phase 3 on the runs of most ready records move #4031's targets the wrong way. The options are to backfill a `Surface:` line on each ready record that lacks one, through `/claude-tweaks:specify`, before Phase 3 ships, or to accept the cost. Recommendation: backfill. With the line present, R5 and R7-R10 read today's gate verdict, so those records keep today's graph. The weakest point is that a backfilled surface is a judgment over record text: a wrong `backend` or `infra` on a record whose diff changes UI files lets A8 and A9 allow the gate's skip of `design-gate` and `design-review`, as a declared surface does today (`### Inputs from model judgment or record text`), though it cannot remove `visual-review` from that diff (A7). Needed before Phase 3.

## Phase 1 — The function and its CLI

- **Builds:**
  - `selectRunGraph`, with rules R1 to R11, assertions A1 to A10, the parsing of each Inputs row and the changed-path classes, under `plugin/bin/lib/run-graph/`.
  - `plugin/bin/run-graph.js`, with `--at`, `--step`, `--start-facts`, `--fresh` and `--check-walk`, the `run-graph.json` store and the absent-store branch (`## Who walks the graph`).
  - The four `materialize.js --check` fields.
  - The usage page `docs/run-graph.md`, and a decision record for the run graph.
  - No skill calls the CLI yet.
- **Files:** new `plugin/bin/lib/run-graph/`, `plugin/bin/run-graph.js`, `docs/run-graph.md` and a file in `docs/decisions/`; `plugin/bin/materialize.js`; `docs/plugin-structure.md`; their tests. No skill file. Phase 1 also updates `docs/plugin-structure.md`'s `tools/step-yield-report.js` usage line to the `--runs`/`--window`/`--lane-floor` flags this record added.
- **Done when:**
  - Behaviour tests cover each rule; each assertion; each Inputs row's absent, unreadable and out-of-vocabulary reads, `size:small` among them; a repeated `--at` call; the backfill; and the validation of relayed facts.
  - A forced violation at a fresh `start` exits non-zero with one line, `run graph: {id} violated: {assertion}`. Anywhere else, it keeps the previous remainder, or the whole vocabulary, and logs one `SKIP`.
  - The `--check` envelope keeps its six fields and adds four.
  - Run over C6's `ready.json` at `start` and `config`, with an unlabeled record's ceremony set to `standard` as C7 lists it, `selectRunGraph` gives the counts C7 prints for the same file.
- **Waits for:** decisions 0.2 and 0.4.
- **Expected effect on #4031:** none, because nothing calls it yet.
- **Builder skills:** `.claude/skills/gh-api-module-pattern`, whose CLI wrapper contract covers a run-directory writer.

## Phase 2 — The walker records the graph

- **Builds:**
  - The add stage's walker calls in `/claude-tweaks:flow`: Step 1's `--at start`, including the `--check` call for a topic resolved at item 6; Step 3's `--at config`, with `--fresh` as `## Who walks the graph` rules; and `--at build` after the build closes.
  - The run-graph-refused case in Settle, its `two-call-gate.md` §5 parenthetical, Section E's skip and the `wrap-up/flags.md` entry (`## Never skipped`, On a violation).
  - The walk itself does not change: no skill reads the store yet.
- **Files:**
  - `flow/SKILL.md` and a new `flow/run-graph-calls.md`.
  - `dispatch/settle-and-merge.md`, a new `dispatch/settle-special-cases.md` and `dispatch/two-call-gate.md`.
  - `wrap-up/flags.md` and `wrap-up/cleanup-procedures-execution.md`.
  - `tests/dispatch-prompt-cli-prose.test.js`, `tests/settle-blocker-landing-stop-conformance.test.js`, and the tests that pin any text this phase moves.
- **Removes from near-limit files:**
  - `flow/SKILL.md` gets one pointer sentence into `flow/run-graph-calls.md` at each of the three sites. It moves `### Examples` (2,226 bytes, `sed -n '87,107p' plugin/skills/flow/SKILL.md | wc -c`) to `flow/examples.md`.
  - `dispatch/settle-and-merge.md` moves Step 6's Plan-review needs-human, No-dispatch-host and Blocker-landing special cases (4,119 bytes, `sed -n '113,117p' plugin/skills/dispatch/settle-and-merge.md | wc -c`), with the new case, into `dispatch/settle-special-cases.md`, behind one pointer line.
  - `wrap-up/cleanup-procedures-execution.md` folds Section E's four `skip the claim release` paragraphs (2,990 bytes, `sed -n '334,341p' plugin/skills/wrap-up/cleanup-procedures-execution.md | wc -c`) and the new fifth into one table.
  - The byte counts come from those commands, run from the repository root on this design's base, and include each block's trailing newline.
- **Done when:**
  - A fresh run writes an `evaluated` store with `start`, `config` and `build` entries.
  - A run started on the previous release completes through the backfill at each resume point in `## Mixed-version operation`.
  - Under `/claude-tweaks:dispatch`, a forced refusal releases the claim when the run holds one, labels the record `bot:blocked` with one comment, and skips Settle steps 3 to 5.
  - Each of the three files above is no larger than at the phase's base.
  - The full suite passes.
- **Waits for:** Phase 1 merged, and decision 0.1.
- **Expected effect on #4031:** three more Bash calls per run, a count of the calls this phase adds (`--at start`, `--at config`, `--at build`), not a measurement. No change to wall time is expected.
- **Builder skills:** `.claude/skills/skill-prose-conformance-tests`, `.claude/skills/shared-contract-extraction`.

## Phase 3 — Steps read the graph

- **Builds:**
  - The migrate stage. Each sentence that skips a step by citing the roster asks `run-graph.js --step` instead, and keeps its `decisions.md` line, `--step` label and text.
  - `/claude-tweaks:flow` walks the remainder (`## Who walks the graph`, Walking), and `/claude-tweaks:build` calls `--at plan`.
  - In `_shared/skill-load-gate.md`, the invocation becomes the matching `run-graph.js` call whenever the run directory holds `run-graph.json`, with the same arguments: `--at {step}`, or `--step design-pre-build`, whose verdict `start` already holds. So `journeys` and the other gated steps change at that one site, and their callers keep their argument lists.
  - The close check, decision 0006's dated note, and the moves of the roster's text outside its tables to the five places `## Roster replacement` names.
  - At the default, the only change in behaviour is the absent-surface additions.
- **Files:**
  - The 18 skill files and 4 tests C9 lists, besides the roster and its test.
  - `_shared/skill-load-gate.md`.
  - `wrap-up/SKILL.md`, which takes the close check beside its "Every exit runs the close-out" paragraph.
  - `_shared/express-lane.md`, `dispatch/two-call-gate.md` and `flow/run-graph-calls.md`.
  - `docs/run-graph.md` and `docs/decisions/0006-ceremony-tiering-owned-by-specify.md`.
- **Removes from near-limit files:**
  - `build/SKILL.md`: Common Steps 1.5, 1.6 and 4.5 lose the `config.yml` `ceremony-profile` clause and the roster citation that the `--step` ask replaces. That pays for the `--at plan` sentence.
  - `flow/SKILL.md`: Step 4's polish clause, "`ceremony-profile` is not `fast-lane` — roster tag `polish`, `_shared/ceremony-profile.md`", becomes one pointer to the walking rule in `flow/run-graph-calls.md`.
  - `build/plan-authoring-checks.md`: the two `sdd-whole-branch-review` citations shorten to the rule id. The example that cites the roster test's exemption table is dropped, or replaced by a shorter one.
  - `_shared/policy-schema.md`: the `design-ceremony` row's pointer to the roster's note becomes the value-collision decision itself, in one sentence no longer than the pointer.
- **Done when:**
  - C9 prints only the roster, its test and `build/plan-review.md`, whose plan-review `SKIP` text, `(roster tag plan-review)`, is read as a log line, not a citation. This phase rewrites that file's prose citation (line 172) and keeps the log text.
  - Each near-limit file is no larger than at the phase's base.
  - A `fast-lane` run and a `standard` run each walk the graph `## Today's graph` gives them, plus the absent-surface additions.
  - The close check logs no `SKIP` on a run that walked every asserted step.
  - The full suite passes.
- **Waits for:** Phase 2 merged, and decision 0.5, with the backfill done if it is chosen. Phases 2 and 3 may ship in one release, because a run with no store reaches the absent-store branch either way.
- **Expected effect on #4031:** both targets move slightly the wrong way. By a count of named calls, not a measurement, a run gains one Bash call for `--at plan`, one for each `--step` site that runs and one for the close check; the gated steps' calls replace their `skill-gate.js` calls one for one. Records with no `Surface:` line and no `frontend` path also gain `visual-review` loads. No movement toward the targets is expected from this phase.
- **Builder skills:** `.claude/skills/skill-prose-conformance-tests`, `.claude/skills/shared-contract-extraction`.

## Phase 4 — Remove the roster

- **Builds:**
  - The remove stage. It deletes `_shared/ceremony-profile.md` and `tests/ceremony-profile-roster.test.js`.
  - It drops `(roster tag plan-review)` from `build/plan-review.md`'s `SKIP` text. First it checks that no reader matches it: `git grep -n -F "roster tag" -- plugin/bin tests`.
  - It sweeps the eight citations C9 does not scope, as listed in `## Roster replacement`'s Remove row.
- **Files:** the two deleted files; `build/plan-review.md`; `docs/plugin-structure.md`, `docs/skill-graph.md` and the three journeys; the `SKILL.md` of `.claude/skills/removal-condition-execution`, `.claude/skills/shared-contract-extraction` and `.claude/skills/skill-prose-conformance-tests`.
- **Removes from near-limit files:** none, since this phase edits none of them.
- **Done when:**
  - C9 prints nothing.
  - `git grep -l -F "ceremony-profile.md" -- plugin tests docs .claude/skills` prints only dated records under `docs/decisions/`, `docs/plans/` and `docs/superpowers/`.
  - The full suite passes.
- **Waits for:**
  - Phase 3 merged, and the removal condition in `## Mixed-version operation` met. C9 prints only the roster, its test and `build/plan-review.md`, whose plan-review `SKIP` text, `(roster tag plan-review)`, is read as a log line, not a citation.
  - #3381 and #5292 (`## Open records`).
- **Expected effect on #4031:** none expected, because skills cite the roster and do not read it while running.
- **Builder skills:** `.claude/skills/removal-condition-execution`, `.claude/skills/skill-prose-conformance-tests`, `.claude/skills/shared-contract-extraction`.

## Phase 5 — Loop bounds

- **Builds:** the four bounds `## Loops` proposes where today's files state none, each with the outcome that table gives at the bound:
  - the verify retry: 2 fix-and-re-run cycles;
  - the review fix wave: 1 per wave point and 4 per review, each with 1 re-verify;
  - a PR-check red, which counts as `/test` fix mode's one attempt;
  - per decision 0.3, the plan-review round count across runs, read in code from the record's `<!-- plan-review-question -->` comments.
- **Files:**
  - `build/SKILL.md` (Common Step 5), `review/step3-routing.md` and `review/code-mode-steps.md` (Step 6.7).
  - `test/fix-mode.md` and `_shared/pr-check-gate.md`.
  - `build/plan-review.md`, `dispatch/settle-special-cases.md` (the third-round block under dispatch), the CLI that counts rounds, and their tests.
  - `_shared/auto-mode-contract.md`, only if its plan-review text, as #5292 leaves it, restates the round behaviour.
- **Removes from near-limit files:**
  - `build/SKILL.md`: Common Step 5's unbounded "If anything fails, fix it and commit the fix" becomes the bounded sentence, no longer than the one it replaces.
  - `_shared/auto-mode-contract.md`, if this phase edits it: the plan-review row's restated exit state and resume text become a pointer to `build/plan-review.md`, which states them.
- **Done when:**
  - Each bound has a test that reaches it and asserts the outcome `## Loops` gives.
  - Each near-limit file is no larger than at the phase's base.
  - The full suite passes.
- **Waits for:** decision 0.3 (for the plan-review count only), and #5292.
- **Expected effect on #4031:** no change to the median. The bounds cut the tail, since a run that loops today stops at the bound. No number exists for this.
- **Builder skills:** `.claude/skills/skill-prose-conformance-tests`, `.claude/skills/shared-contract-extraction`.

## Phase 6 — The first rule that gives fewer steps

No such rule exists yet. Every rule in `### Rules` is unchanged from today. This phase is the form the first "evidenced" or "risk accepted" rule takes, and it is built only once a record names that rule.

- **Builds:**
  - The rule in `selectRunGraph`, with its mark. An "evidenced" rule carries the rate it rests on, over at least 20 runs in which the step ran, and the command that measured it (AC13).
  - The policy value `run-graph-rules`: a list of rule ids, empty by default, so the default reproduces today's graph.
  - Its removal condition, from `### Rules`. A rule's id moves into the default only once its later-step outcome share over at least 20 runs whose `run-graph.json` records the rule's leave-out is no higher than its baseline, the same share over at least 20 runs of the same lane in which the left-out step ran. The value is removed when no rule in it is left off by default.
- **Files:** `plugin/bin/lib/run-graph/`, `plugin/bin/lib/policy-schema.js`, `_shared/policy-schema.md` and a `_shared/policy-schema-*.md` sub-file, `docs/run-graph.md`, and their tests. No skill that asks `--step` changes, because skills state no rule.
- **Removes from near-limit files:** `_shared/policy-schema.md` gets only a key-only row, `` | `run-graph-rules` | ``, and the full row goes in the sub-file, the split `## Model profiles` uses. The same file loses at least as many bytes as the phase adds there, and the record names them from the file as it then is. At this base, one candidate is the `## Model profiles` paragraph's split-out history, "(split out per IL-70 — merged branch content pushed this file over its ceiling)", 82 bytes with its leading space (`grep -o " (split out per IL-70 — merged branch content pushed this file over its ceiling)" plugin/skills/_shared/policy-schema.md | tr -d '\n' | wc -c`).
- **Done when:**
  - With `run-graph-rules` unset, every Phase 1 test passes unchanged, and so does the C7 comparison.
  - With the rule's id set, the function leaves out the rule's step and no assertion fires.
- **Waits for:**
  - A record that names the rule, its mark and its number, with the maintainer's acceptance for a "risk accepted" rule.
  - Phase 3 merged, so the walk follows the remainder.
- **Expected effect on #4031:** the first phase expected to move a target. Its effect is the share of wall time and round trips the left-out step takes in the runs the rule covers, and only in projects that opt in. This repository sees none before Phase 7.
- **Builder skills:** `.claude/skills/policy-key-addition`, `.claude/skills/removal-condition-execution`.

## Phase 7 — Opt this repository in

- **Builds:**
  - `.claude-tweaks/policy.yml` sets `run-graph-rules` to the Phase 6 rule's id.
  - One parked measurement record, filed through `/claude-tweaks:capture` in the form of #5825. Its check is the default change from `### Rules`: a rule's id moves into the default only once its later-step outcome share over at least 20 runs whose `run-graph.json` records the rule's leave-out is no higher than its baseline, the same share over at least 20 runs of the same lane in which the left-out step ran. Its bound is those 20 runs with the rule on.
- **Files:** `.claude-tweaks/policy.yml`.
- **Done when:** `resolve-policy.js` returns the id in this repository, a run's `run-graph.json` shows the rule's leave-out, and the parked record exists.
- **Waits for:** the release that carries Phase 6, as the installed plugin in this repository's sessions (`## The selection function`; `## Mixed-version operation`, last row).
- **Expected effect on #4031:** as for Phase 6, in this repository, from the first run on that release.

## Left to the builder

- The layout of `plugin/bin/lib/run-graph/`, beyond `selectRunGraph` and `run-graph.js`.
- `run-graph.js`'s exit-code numbers, whether `--start-facts` is a file or an argument, and how the store is written atomically.
- The new decision record's number, and the wording of decision 0006's dated note.
- Which block leaves a near-limit file when the block a phase names has gone by build time, provided the file ends no larger than at the phase's base.
- Which CLI holds Phase 5's round count.
- Tests sized like the neighbouring suites.

## Calls made in this document that were not discussed

Each was made under the record's decision rule for a gap. Those only the maintainer can make are also in `## Phase 0 — Decisions`.

1. The window orders runs by start time, read from the run id, not by close time, because events keep landing after a run closes (`### Window`).
2. A fix commit is a `commit`-action event in a step other than `build`, `plan` and `tasks`. A failed gate is a failed `verify` event. Gate stops recorded only as decision-log prose are not counted (`### What "outcome-changing" counts and what it cannot see`).
3. A prose express run is one whose proceed entry no later escalation cancels (`### Lane rule`).
4. No "evidenced" rule rests on a fix-commit rate alone, because commit events carry no message.
5. Modes stay with their steps and are not in the function's output. The effort-gated review passes are not steps (`## Step vocabulary`).
6. Settings take their documented default when unset, not their most cautious value (`## Inputs`).
7. An absent or unrecognised `Surface:` is read at each rule's most cautious value, as AC5 requires. This puts back skill loads that #5605 removes; in this repository it adds `visual-review` for records with no `Surface:` line and no `frontend` path. Whether to backfill the missing lines first is decision 0.5.
8. A step's own nothing-to-do check stays in its body and is not an input.
9. `design-pre-build`'s gate verdict is taken at `start`, earlier than today's Common Step 1.7.
10. `start` runs before Step 2.8's claim, and a `--check` call is added for a record resolved from a topic (`## Evaluation points`).
11. `review-spec`, `plan-audit` and `plan-review` keep their `fast-lane` leave-out (decision 0.4 for `review-spec`).
12. `merge` is in every graph by R1, but no assertion holds it.
13. The step-list argument of `/claude-tweaks:flow` is not an input.
14. New loop bounds where today's files state none: the verify retry at 2 cycles; the review fix wave at 1 per wave point and 4 per review, each with 1 re-verify; a PR-check red counted as `/test` fix mode's one attempt; and plan-review rounds at 3 per record across runs, then `bot:blocked` and a comment sending the record to `/claude-tweaks:specify` (decision 0.3).
15. The walker is `/claude-tweaks:flow` with `run-graph.js` (decision 0.1).
16. The store is `run-graph.json`, with `run-graph.js` its only writer. Start facts are relayed as validated facts, never as a remainder.
17. `materialize.js --check` gains four fields. They are added, and none is renamed.
18. The run-graph-refused Settle case labels the record `bot:blocked` with one comment, skips Settle steps 3 to 5 and releases a claim the run holds. AC8's "nothing is written" is read as being about the run, not the record.
19. When a backfill violates an assertion and nothing is stored, the whole vocabulary is the fallback.
20. Freshness is keyed on run state, by one rule at both points: `--fresh` goes on the `config` call only for adoption case 2 with no Manifesto config snapshot, case 5's creation path (case 4's included), or an express escalation in the same invocation.
21. The absent-store branch is permanent and has no removal condition.
22. The roster's removal condition counts the files that cite it (C9), not runs.
23. Decision 0006 is kept with a dated note, beside a new decision record.
24. The run graph takes the driver's convention: code is its statement of record and it has a usage page, with no prose contract and no pinned prose.
25. The migrate stage keeps each skip's `decisions.md` text. Phase 4 drops the one roster tag left in a log literal, after checking that no reader matches it.
26. The run-graph refusal is a pre-flight stop like the blocker-landing stop. It is not added to `_shared/auto-mode-contract.md`'s HARD-GATE row, so no phase edits that file for it.
27. The gated steps migrate at `_shared/skill-load-gate.md` alone, and their callers keep their argument lists.
28. The close check goes in `wrap-up/SKILL.md`, which is below the threshold, rather than in `wrap-up/cleanup-procedures-execution.md`.
29. Each phase names its removal from a near-limit file: the move of `### Examples`, the special-cases sub-file, the Section E table, and the key-only policy row.
30. Phase 5 counts plan-review rounds in code, from the record's question comments.
31. The header names this branch's merge base, not `origin/main` as it stood while the doc was written, because the branch's tree is what the file claims were checked against.
