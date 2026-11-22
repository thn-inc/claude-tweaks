# Pipeline economy — design

Date: 2026-11-18. Status: draft for approval.

## Why

The maintainer's direction, 2026-11-18: the plugin uses far too many tokens and too much process to get work done, and it generates more follow-up work than it finishes. Both must change, for this repository and for every project the plugin serves, including a factory that drives many repositories through Dispatch.

Three earlier designs cut cost at the edges. The pipeline driver (`2026-11-11-pipeline-driver-design.md`) built a lane where code walks the steps. Process efficiency (`2026-11-15-process-efficiency-design.md`) cut tiebreak cost, guard refusals and polling. The run graph (`2026-11-17-standard-lane-run-graph-design.md`) gives the standard lane a selectable step list, and expects no effect on cost or time before its Phase 6. None of them sets which model does which job, widens the cheap lane, or limits the work a run files.

What the transcripts and run directories show for 8 to 18 November 2026 (method in `## Evidence`):

- All sessions in this project cost $18,851 at list prices and merged 164 pull requests: about $115 each, $78 of it in build sessions.
- Main sessions are 41% of that spend, and 81% of main-session spend falls on turns whose prompt is over 200k tokens.
- Opus is 63% of spend, Fable 24%, Sonnet 12%, Haiku 1%.
- The driver lane built three records for $0.63 to $0.76 each. It admits 11% of build-authorized records and has not run since 12 November.
- 586 records were created and 207 closed. 317 of the new records were filed by an agent deferring something out of a run.

## Goals

1. A record in the driver lane reaches a green pull request in a median of 10 minutes or less, for $1 or less at list price.
2. The driver lane admits at least 60% of this repository's build-authorized ready records, up from 11%.
3. Build-session cost per merged pull request in the standard lane falls by at least 35% from $78.
4. Records filed by runs fall from 1.9 per merged pull request to 0.5 or fewer.
5. Quality does not fall: the three guard measures in `### Quality guards` are no worse over the first 20 runs after each change.
6. Every lever is a policy value that a factory can set for all repositories and a repository can set for itself.
7. Every run records what it cost and which policy it ran under, in a file Dispatch can read.

## Non-goals

- Removing the whole-branch review or the paired lens reviewers. The evidence says both earn their cost.
- Deleting or splitting skills.
- Replacing the run graph. A rule here that leaves a step out is expressed as a `run-graph-rules` entry once that mechanism ships.
- Changing how a spec is authored, beyond `## Phase 12`.
- Real invoices. Dollars here are list-price equivalents of recorded token usage, used as one comparable unit.

## Evidence

Window: transcripts and run directories dated 2026-11-08 to 2026-11-18. Usage is the maximum per `message.id`, as `plugin/bin/lib/timing/transcript.js` reads it. Prices are the list prices of 2026-11-03, with Haiku's long-prompt rate applied per request over 100k tokens. A session's type is the first claude-tweaks skill it invoked, so a session that did several things is counted once.

### Where the money goes

| Cut | Figure |
|---|---|
| Total, 208 sessions | $18,851 |
| Main sessions / subagents | $7,668 / $11,184 |
| Opus subagents | $8,563 |
| Fable main sessions | $3,955 |
| Opus main sessions | $3,388 |
| Sonnet subagents | $1,918 |
| Haiku subagents | $104 |
| By session type | flow 40%, dispatch 28%, specify 16%, capture 12%, release 2% |
| Main-session spend on turns over 200k tokens | 81% |
| Main-session cache writes | $3,035, of which $618 follow a model switch (162 turns, about 294k tokens each) and $568 follow an hour or more without a model call |
| First-turn prompt, median | 66k main session, 51k in-session subagent, about 6k driver worker |

Per standard-lane run, from `timing.json`, window-wide: the pipeline walker (the agent that carries a dispatch call through build, test, review and wrap-up) is about $17 and implementers about $6.

The standard lane changed inside the window, so window-wide per-run figures overstate today's:

| Runs dated | Runs | Median minutes | Median round trips | Median subagents | Median cache read |
|---|---|---|---|---|---|
| 8 to 12 November | 15 | 143 | 1,022 | 52 | 207M |
| 13 to 15 November | 60 | 298 | 756 | 33 | 154M |
| 16 to 18 November | 77 | 192 | 538 | 17 | 113M |

Tiebreak judges fell from 9 to 15 per run to about 3.6 on 16 November, when judging moved to chunks of eight findings with `info` findings on Sonnet (#5540, #5541). A judge takes a median of half a minute.

### Where the time goes

- Standard lane: median 218 minutes, 718 tool round trips and 36 subagents per run. The time is the length of the chain of model-driven steps.
- An implementer on Sonnet runs 16.5 minutes. About 9.4 are active: 3.5 model, 3.7 test commands, 2.2 other commands. The rest is idle time between its report and the fix request that follows the task review.
- Driver lane: 21 to 31 minutes per record, of which the model worked 2.1 to 2.6. Each worker ran the whole suite (24,848 tests) three times, 4.5 to 10 minutes a run, with 37 to 40 failures each time. The driver's own test step then ran once more, scoped, in 2.3 to 5.3 minutes. No code reads whether the worker ran tests.

### The driver lane

- `drive.js --check` over all 142 build-authorized ready records admits 15.
- Records refused, by reason (a record can carry several): size is not low 68, protected path 68, risk is not low 57, more than three Key Files 54, ceremony is not fast-lane 49, no Key Files 18, open pull request 14, open blocker 14.
- Admitted if these stopped refusing: size and Key File count (policy values today) 24; plus ceremony 30; plus risk 40; plus protected paths 86; plus missing Key Files 104.
- No driver call site passes a model. The worker, the reviewer and both judgment workers run on the account's default model.
- 15 records are admissible today and none has been routed to the driver in six days. Dispatch routes only single-record groups. The cause of the rest is not yet known.

### What the reviews return

| Review | n | Result |
|---|---|---|
| Task review, Opus | 242 | 39% need fixes: 4 Critical, 169 Important, 391 Minor |
| Task review, Sonnet | 209 | 13.5% need fixes: 40 Important, 70 Minor |
| Whole-branch review | 103 | 70% report a Critical or Important issue after every task review passed; 2.38 Important per review |
| Plan review | 103 | 99% find gaps, 5.2 per review; 43 runs stopped to ask a human |
| Lens review | 96 runs | 799 confirmed findings, 8.3 per run; 63% fixed, 29% dismissed, 5% staged, 3% deferred |

- Applied lens fixes were 452 low severity, 99 medium, none high.
- The two lenses that run on Haiku (convention and test) produced 443 of the 799 confirmed findings. Lenses 3b and 3d produced 36 and 19 and return nothing over 70% of the time.
- One reviewer of a pair alone would have raised 63% of the confirmed findings.
- Of 453 implementation tasks, 43 went to Haiku. 91% of those were reviewed and 13% needed a fix round, against 51% for Sonnet at the same average output size. The walker chose the tier, so Haiku got tasks it judged mechanical.
- No task changed tier after a failed round.

Confounds: each lens has one fixed tier, so no Haiku-against-Sonnet comparison exists on the same lens. Opus task reviewers are given the riskier tasks.

### Work filed by runs

- Created 586, closed 207, open 804.
- 317 of the 586 carry a `Defer-reason:`; 267 of those are open.
- Reasons named: pre-existing-outside-diff 135, tangential 80, needs-human-decision 71, genuinely-larger 56, tiebreak-cant-tell 35, blocked-dependency 23, blocked-external 10.

### Effort

Measured on 2026-11-19 over 8 to 19 November, from the effort each transcript turn records.

- Every profile but Fast names effort `high` (`plugin/bin/lib/model-profiles/profiles.js`). The value reaches an agent only as a sentence in its prompt.
- 60% of subagent turns on Sonnet, Opus and Fable ran at `medium`. Over 7,159 subagents the effort followed the session, not the profile: an agent on the session's own model ran at the session's effort, and an agent on any other model ran at `medium`. Under Opus sessions at `high`, 1,573 of 1,606 Opus agents ran at `high` and all 1,215 Sonnet agents at `medium`. Under Fable sessions, 454 of 1,915 Opus agents ran at `high`, which this rule does not explain.
- Two probes on Claude Code 2.1.325, a Sonnet agent launched from a Fable session at `high`: with the launch's effort set to `low` the transcript records `low`; with no effort set and the prompt sentence asking for `high` it records `medium`.
- 132 of 7,978 agent launches set an effort. 18 turns in the window ran at `low`. No driver launch sets one.
- Output is 18% of spend and thinking is 32% of output tokens. An Opus subagent turn cost $0.077 at `medium` and $0.074 at `high`, and took 6.3 and 7.6 seconds.

By role, 14 to 18 November:

| Role | Effort | Tasks | Needed a fix round | Median minutes | Median output tokens |
|---|---|---|---|---|---|
| Opus task reviewer | high | 83 | 53% | 2.8 | 14.3k |
| Opus task reviewer | medium | 74 | 58% | 1.6 | 8.4k |
| Sonnet implementer | high | 32 | 44% | 9.6 | 19.9k |
| Sonnet implementer | medium | 184 | 50% | 10.6 | 23.9k |
| Opus implementer | high | 33 | 39% | 22.4 | 65.8k |
| Opus implementer | medium | 27 | 59% | 20.0 | 50.3k |

Confounds: nothing assigned the effort. It tracks whether the agent's model matched its session's, so each pair of rows also compares two kinds of session. A fix round means the reviewer asked for one, not that the reviewer was right.

### Quality guards

Every phase that changes a model, a lane or a review is checked against these three, over the 20 runs before and the 20 runs after:

1. The share of whole-branch reviews that report a Critical or Important issue (70% today).
2. The share of implementation tasks that pass their task review with no fix round (49% for Sonnet today).
3. Bug records filed within 14 days that name a file a merged pull request changed. No baseline exists; Phase 1 measures it.

### Not verified by the author

The policy-resolution and Dispatch facts in `## Policy model` come from a code reading by a delegated agent and were not re-checked. The review counts were re-run and matched.

## Policy model

Today a key resolves from the run's `config.yml`, then the repository's `.claude-tweaks/policy.yml`, then the schema default. Nothing sits above the repository. Keys marked `policyOnly` ignore the run config.

Dispatch already stores variables at instance, repository and environment scope and merges them into the environment of every run it starts. A job can name its model.

This design adds one layer and one rule:

- **Factory layer.** Read below the repository file and above the schema default. Delivered as an environment variable that carries the values, so it reaches cloud sandboxes, with a user-level file for interactive sessions.
- **Ceilings take the stricter value.** For keys that bound spend, model tier, record size, risk and new records, the effective value is the stricter of factory and repository. Every other key keeps repository over factory.

Every new behaviour in this design ships as a policy value whose default reproduces today. This repository opts in first. A default changes only after 20 runs with the value on show the quality guards no worse, the rule `2026-11-17-standard-lane-run-graph-design.md` sets for its own rules. Phases 2 and 3 are the exceptions: they fix defects and need no key.

Key names below are proposals; the builder settles them with `.claude/skills/policy-key-addition`.

## Phase 0 — Decisions

Made by the maintainer on 2026-11-18:

- Work a run notices is fixed in that run where the deferral gate allows. What it notices outside its diff, and ideas it has, are not fixed in the run and do not become new records. This narrows "No implicit deferrals" in `CLAUDE.md` for work a run notices.
- Review lenses are chosen per run, not fixed.
- Filing new work carries friction.
- The tiers below, in this order.
- The levers must be settable for a factory and per repository, and must suit projects other than this one.

## Tier 1 — Quick wins

## Phase 1 — Baseline report

## Phase 1: Specified

Records #5914 (spend, funnel and records sections), #5916 (the three quality guards) and #5925 (review results by role and tier), under parent #5913.

- **Builds:** `tools/pipeline-cost-report.js`, maintainer-side. It reproduces every table in `## Evidence` from transcripts, run directories and the forge: spend by session type, model, main session or subagent and prompt size; cache re-writes by cause; the driver admission funnel with each refusal reason; review results by role and tier; records created, closed and deferred by reason; and guard 3.
- **Done when:** one command prints the tables for a given window, and its output for 2026-11-08 to 2026-11-18 is committed beside this document as the baseline.
- **Expected effect:** none on cost. Every later phase names its measure from this report.
- **Not yet specified:** the report's spend and review tables split by the effort each turn recorded. It follows #5914 and #5925.

## Phase 2 — The driver worker stops running the suite

## Phase 2: Specified

Record #5915, under parent #5913.

- **Builds:** the worker prompt in `plugin/bin/lib/driver/steps.js` tells the worker to run only the test files for the files it changed, by path, and never the suite. The worker's allowed commands lose `npm test`. The driver's test step stays the gate.
- **Done when:** over five driver records, no worker transcript holds a whole-suite run and the worker step's median is five minutes or less.
- **Expected effect:** 21 to 31 minutes per record becomes 6 to 10.

## Phase 3 — Every driver role names its model

## Phase 3: Specified

Record #5917, under parent #5913.

- **Builds:** a policy map from driver role to work profile, resolved through `plugin/bin/lib/model-profiles/`, so `model-profiles` and `model-ceiling` apply. Defaults: implementer Standard, reviewer Capable, merge-check and acceptance Standard. A launch with no resolved model is refused, as the review workflow already refuses a lens with none.
- **Done when:** every `claude -p` launch in `plugin/bin/lib/driver/` carries `--model`, and a test fails when a role has no entry.
- **Expected effect:** $0.63 to $0.76 per record becomes about $0.35, and no longer depends on the account's default model.

## Phase 4 — Walker and session tiers

- **State:** not specified as a new record. #4030 already is this change and stays open.
- **Why it is not a quick win:** the first dispatch call was raised from Standard to Capable because on Standard the walker bypassed `/claude-tweaks:flow` in 6 of 10 firings (#3212, `plugin/skills/dispatch/task-prompt.md`). The second call is already Standard.
- **Builds, when #4030 is taken:** the first call's profile as a policy value, with the bypass rate as a fourth guard; and the Pipeline Config Manifesto prints the session's own model and says when it is above `model-ceiling`.
- **Expected effect:** unknown until the bypass rate is re-measured. Keeping build sessions off Fable saves about 7% of total spend; moving them to Sonnet about 23%, untested.

## Phase 5 — Tiebreak floor (withdrawn)

Withdrawn on 2026-11-18. #5540 and #5541 already cut judges to about 3.6 per run at half a minute each, about $1.30 per run. A floor would save little and would drop about five low-severity fixes per run.

## Phase 6 — Work a run may file

## Phase 6: Specified

Records #5930 (the route decided in code), #5931 (the routing sites call it), #5932 (the digest-reasons policy value and the `CLAUDE.md` rule) and #5933 (the evidence line and the per-run cap), under parent #5934.

The deferral gate (`plugin/skills/_shared/deferral-gate.md`) already makes fix-now the default and names a closed set of reasons. The materiality floor (`plugin/skills/_shared/materiality-floor.md`) already routes a deferred item to a digest when it would be filed at low size, low priority and low risk, and digest entries already expire. Two rules send agent-noticed work to new records anyway: `tangential` always files, and `pre-existing-outside-diff` files unless all three axes are low.

- **Builds:**
  - A policy value under which a deferral an agent raises with `pre-existing-outside-diff` or `tangential` goes to the digest whatever its size, priority and risk. Human-typed capture is unaffected. High and critical findings keep filing.
  - A record an agent files needs an evidence line: a failing test or a cited incident.
  - A policy value caps new records per run. Overflow goes to the digest.
  - `CLAUDE.md`'s "No implicit deferrals" is rewritten to match.
- **What the digest does with them:** three un-promoted entries in one area become one proposed "Settle N findings" record (`plugin/skills/tidy/digest-sweep.md`), and an entry un-promoted for 90 days expires. Since 8 November 16 such records bundled 111 findings, about seven each, so the 215 would become about 30 records, fewer after expiry.
- **What the filing path looks like:** no code decides the route today and no single function sees every filing; six skill sites apply the floor from prose. So the records build the decision as one command first, move the six sites onto it, and only then add the policy value, the evidence check and the cap.
- **Decided while specifying:** evidence is a named test file or an existing record or incident number, checked for form only; an item that fails a check goes to the digest, never dropped; the cap is first come, first served; high and critical findings always file.
- **Not covered:** the Review Console's can't-tell filings (`plugin/bin/console-filings.js`) follow their own rule and pass through neither the evidence check nor the cap.
- **Done when:** over 20 runs, records filed per merged pull request are 0.5 or fewer.
- **Expected effect:** the two largest deferral reasons, 215 of the reasons named, stop producing records.

## Phase 15 — A launched agent runs at the effort its profile names

## Phase 15: Specified

Records #5941 (the policy value and the launch setting for agents launched in a session) and #5942 (the same value on driver workers, blocked by #5941), under parent #5940.

Added on 2026-11-19. It sits in Tier 1 and keeps the next free number so no other phase is renumbered.

- **Builds:**
  - A policy value with two settings. `inherit`, the default, sets no effort on a launch, as today. `profile` sets the effort the resolver returns on the launch itself: the Agent tool's `effort` for an agent launched in a session, and `--effort` for a driver worker.
  - This repository sets `profile`, and sets Standard and Capable to `medium` through `model-profiles`. Frontier stays `high`. For Standard that is the effort its agents already run at. For Capable it lowers Opus agents launched from an Opus session, 1,573 of 1,606 of which ran at `high`; the maintainer chose it on 2026-11-19, to be judged over the 20 runs below.
  - The log line dispatch writes for each first call names the effort beside the model, so a bypass can be tied to the effort it ran at.
  - `plugin/skills/_shared/subagent-dispatch-core.md` stops saying the Agent tool has no effort setting.
- **Not built here:** a lower effort for any role, and a retry at a higher one. Those are Phases 9 and 14.
- **Not covered:** agents started by the opt-in review workflow (`plugin/workflows/review-lens-fanout.js`). They run at the harness default, measured `medium`, and whether a workflow script can set an effort is not known.
- **Waits for:** Phase 3 for the driver half, since a driver role has no profile until then.
- **Done when:** over 20 runs with `profile` set, every subagent transcript on Sonnet, Opus or Fable records the effort the resolver returned, the guards are no worse, and no first dispatch call bypasses `/claude-tweaks:flow`. That call drops from `high` to `medium` in an Opus session, and on Standard it bypassed in 6 of 10 firings (#3212).
- **Expected effect:** in this repository, agents on the session's own model move from `high` to `medium`. For task reviewers that was 1.6 minutes against 2.8. Opus implementers needed a fix round more often at `medium`, 59% against 39% on about 30 tasks each, which the second guard watches. Cost per turn does not move. Effort becomes a setting a later phase can change and measure.

## Tier 2 — Fast follows

## Phase 7 — Driver admission by risk and path

## Phase 7: Specified

Records #6018 (the risk ceiling, the ceremony relaxation and the `pending-review` stop for a widened admission), #6019 (the protected-path mode), #6020 (the protected-path list as an editable policy value) and #6021 (the 20-record trial), under parent #6017.

- **Builds:** two policy values: the highest risk label the driver admits, and whether a protected path refuses or requires the reviewer. With the reviewer on, a ceremony label other than fast-lane no longer refuses. A record admitted by any of these always ends at `pending-review` for a human merge. The protected-path list becomes a default a project can edit, with the factory able to set a floor.
- **Decided while specifying:**
  - The risk ceiling takes `low`, `medium` or `high`. `high` is allowed, unlike `express-driver-max-size`, because every record admitted this way waits for a human merge.
  - Ceremony relaxes only when `express-driver-review` is set to `on`, so the default `beyond-express` reproduces today without a third key.
  - The merge stop recomputes the widenings from the record's live labels and stops when the driver's own list is missing, so it fails closed.
  - Under `reviewer`, the protected paths that act at push or build time keep refusing: CI config, git hooks, `package.json` and agent settings. Only merge-time paths (hook code, shared contracts, `CODEOWNERS`, the policy and verify-scope files) pass behind the reviewer.
  - The list is fully editable, removals included, and a removal reaches the express lane too. It resolves from the main checkout, so a record cannot widen its own run by editing `policy.yml`.
  - The trial runs `/claude-tweaks:review` on each driven PR. Guard 1 compares its Critical-or-Important share with the 70% baseline, guard 3 is read 14 days after the last merge, and guard 2 does not apply.
- **Not covered:** the factory floor for the list, and the stricter-of rule for the risk ceiling. Both wait for Phase 11's factory layer.
- **Done when:** a 20-record trial in this repository runs with the reviewer on, `express-driver-max-size: medium` and a raised `express-driver-max-key-files`, and the guards are no worse than the same records' lane today.
- **Waits for:** Phases 2 and 3, both merged.
- **Expected effect:** admission rises from 11% to about 61%. Keeping the build-time paths refused may land it lower.

## Phase 8 — Admissible records reach the driver

- **Builds:** the cause of the six-day gap, found and fixed. Dispatch routes each admitted member of a bundle group, not only single-record groups.
- **Done when:** every record `drive.js --check` admits in a drain is driven or carries a logged reason.

## Phase 8: Specified

Records #6011 (keep driver-routable records out of fast-lane bundles) and #6012 (the cost report shows whether admitted records reached the driver), no parent; #5571 extended with the drain check.

The six-day gap had no code-defect cause. The 12 November driver runs were started by hand (`drive-N` run directories). Dispatch's route (#5232) first shipped in v6.171.0, which was never installed: the plugin cache went from 6.170.0 to 6.172.0 on 17 November. All 18 dispatch sessions from 15 November 23:06 to 17 November 07:27 ran v6.170.0, which has no route. No dispatch firing ran from 17 November 07:27 to 21 November, and no run directory holds a `Driver route (skipped)` line. On 21 November `drive.js --check` admitted 15 of 142 records, and a grouping replay put all 15 in singleton groups.

- **Builds:**
  - #6011: the queue pull keeps a record the driver would take out of fast-lane bundles, so it reaches the route as a singleton group.
  - #6012: the cost report's funnel section counts driver runs (dispatch-routed and standalone) and dispatch firings by plugin version, and flags admitted records that nothing routed.
  - #5571: the live drain must also drive, or log a skip for, every admitted group it selects.
- **Phase 7 depends on #6011.** Raising `express-driver-max-size` to `medium` without it bundles fast-lane records the driver would take.

## Phase 9 — Implementer tier from the record

## Phase 9: Specified

Records #5996 (the rule, the step-up, the `implementer-tier` policy value and its CLI), #5997 (the driver launches the record's profile and relaunches once one profile up), #5999 (the standard lane takes its profile from the CLI and escalates once) and #6002 (the effort ladder), under parent #5995. #5997 and #5999 are blocked by #5996; #6002 is blocked by #5941, #5942, #5997 and #5999.

- **Decided while specifying:**
  - One policy value, `implementer-tier`: `lane`, the default, keeps each lane's current rule; `record` applies this phase's rule in both lanes. This repository opts in. A `size:high` record gets Standard, not Capable.
  - One Key File counter for both lanes: distinct paths in the record's `### Key Files`; a directory entry rules out Fast.
  - Driver: only a worker that cannot complete, or red tests, triggers the relaunch; it works on top of what the first attempt left, then commits and re-tests. Ceilings stay per launch, so the worst case is three implementer launches per record.
  - Standard lane: a `BLOCKED` report, or a failed re-review of a task's first fix round, sends that task to a fresh implementer one profile up, once; `decisions.md` holds the once-per-task count.
  - Effort ladder: the starting effort follows `risk:` (`low` → `low`, `medium` → `medium`, higher → the profile's own, never above `high`). Red tests or a failed fix round raise the effort one step first; `BLOCKED` or a worker that cannot complete step the profile directly. At most two escalations.
  - Per-task `**Role:**` markers and the `profile=` token keep overriding the record rule.
- **Done-when caveat:** tasks started at `low` are `risk:low`, so the `low`-versus-`medium` comparison is made within a size band, adds a fix-rounds-per-task guard, and reads as cost per risk class rather than a pure effort effect.

- **Builds:** the implementer's profile comes from the record's labels in code: low size with one or two Key Files gets Fast, everything else Standard. A failed verify or a blocked report moves it up one profile, once. Applies to the driver, and to the standard lane's task loop through the run's config.
  - Once Phase 15 has landed, a step up may be an effort before it is a model: the first attempt runs at the lowest effort the record's labels allow, and a failed verify raises the effort, then the profile. Only an implementer gets this, because a test or a review shows its failure.
- **Waits for:** Phase 15 for the effort half.
- **Done when:** 20 tasks on Fast show a fix-round rate no higher than Standard's, and 20 tasks started at `low` show total minutes per task, retries included, no higher than tasks started at `medium`.
- **Expected effect:** Opus implementers, about $3 per run, fall to near zero; mechanical tasks cost at most $0.34.

## Phase 10 — Lenses chosen per run

## Phase 10: Specified

Records #5998 (each lens's confirmed-finding rate over its last 20 runs, and a per-run record of which lenses ran), #6001 (the selection function, its CLI and the `review-lens-selection` key), #6000 (a read-only `lens-reviewer` driver worker role and a launcher) and #6003 (`review-lens-dispatch: worker`), under parent #6005. #6001 is blocked by #5998; #6003 is blocked by #6000 and #6001; all four wait on #5825, and #6000 also on #5942.

- **Builds:**
  - A selection function, in code, from the diff's facts and each lens's confirmed-finding rate in this repository over its last 20 runs. No model chooses.
  - Lens reviewers launched as lean workers, so a Haiku lens stays under 100k tokens.
- **Waits for:** #5594.
- **Done when:** confirmed findings per run are no lower than 8.3 with fewer lens agents.
- **Expected effect:** lenses 3b and 3d run only where the diff calls for them.

## Phase 11 — Factory layer and run facts

## Phase 11: Specified

Records #6006 (the factory layer in the resolver), #6007 (every other policy reader sees it), #6008 (the ceiling rule), #6009 (tokens by model, list-price cost and minutes in the run manifest) and #6010 (model and effort per role in the run manifest), under parent #6004. #6007 is blocked by #6006, #6008 by #6006 and #6007, #6009 by #5647 and #5967, and #6010 by #6009 and #5647.

- **Decided while specifying:**
  - The factory layer is the variable `CLAUDE_TWEAKS_FACTORY_POLICY`, carrying text in `policy.yml`'s own format, and the file `~/.claude-tweaks/factory-policy.yml`. The variable wins over the file per key, and block keys merge per row.
  - The factory layer may not set `merge-authorization`, `control-mode` or `deploy-command`. Every other key is settable, `autonomy` and the trust lists included.
  - A ceiling bounds repository and run-config values, never the schema default: a factory value above the default is a deliberate override of the default.
  - The manifest stays at `v: 1`, because its Compatibility rule adds fields without a bump. Cost re-reads the transcripts' per-request rows and leaves `timing.json` unchanged. A partial cost may be replaced once by a complete one.
- **Not covered:** Dispatch reading the cost fields. Its manifest parser stores nine named fields and ignores the rest (thn-inc/dispatch #1958), so that half of the done-when is a change in thn-inc/dispatch.

- **Builds:** the layer and the ceiling rule in `## Policy model`; and in the run manifest (#5903): lane, model and effort per role, tokens by model, list-price cost, minutes and a hash of the resolved policy.
- **Done when:** a value set only in the factory layer resolves in a repository that does not set it, and Dispatch reads a run's cost from its manifest.

## Tier 3 — Longer term

## Phase 12 — The plan is made with the spec

- **Builds:** `/claude-tweaks:specify` writes the task list and runs the plan review while a human is present. A record that carries a reviewed plan skips the build's plan step.
- **Needs:** its own design.
- **Expected effect:** the plan step (12 minutes, 11.7M tokens) and the 43 mid-run stops leave the build.

## Phase 13 — The driver is the drain

- **Builds:** `drive.js --budget` gains the drain-overlap hold and stop handling it lacks, so Dispatch can run it as a script job with no model session walking the queue.
- **Waits for:** Phases 7 and 8.
- **Expected effect:** the main session's share of cost, 41% today, goes to zero for driver records.

## Phase 14 — Review replay

## Phase 14: Specified

Records #5990 (an effort key on a replay arm, and a refusal to score an agent that ran at another effort), #5991 (the lens reviewers, replayed across tiers and efforts) and #5992 (the task and whole-branch reviewers, and the task-versus-branch counterfactual), under parent #5989. #5991 is blocked by #5990 and #5992 by #5991.

- **Decided while specifying:**
  - A replay sends the archived reviewer's own prompt, rewritten to a clean two-commit repository, not a prompt rebuilt from today's templates, so an arm differs from the archive only in model and effort.
  - Findings are matched by location (same path, lines within 5), not by a model judge; a finding with no location is reported as unlocated.
  - The effort an arm asks for is checked against the effort the agent's transcript recorded, and a slot at another effort counts as not judged.
  - The live replay run is not a record: it runs from an interactive session after #5992, as #5630 does for the tiebreak replay.
- **Not covered:** choosing each review's tier and effort, which is that live run.
- **Open:** #5991 and #5992 each carry a staged question, a control arm that shows how far a replay at the archived tier reproduces the archive, and their `ready` label is cleared until it is answered.

- **Builds:** `tools/review-replay.js` arms that answer three questions on archived runs: what task reviews catch that the whole-branch review would not, how each lens performs on Haiku, Sonnet and Opus, and what each review finds at `low`, `medium` and `high` effort.
- **Why reviews get no retry:** a review that misses a finding looks like a clean review, so nothing would trigger a second attempt. A review gets one fixed effort, chosen from the replay.
- **Expected effect:** none by itself. It decides whether task reviews stay and which tier and effort each review needs.

## Calls made in this document that were not discussed

- Every new behaviour ships off by default and this repository opts in first.
- Ceiling keys resolve to the stricter of factory and repository.
- Phase 5 is withdrawn and Phase 4 is left to #4030, both on evidence found while specifying.
- The driver's reviewer defaults to Capable and its judgment workers to Standard.
- A record admitted under Phase 7 never merges by itself.
- The baseline report is a maintained tool, not the scratch scripts that produced these numbers.
- Phase 15 ships with `inherit` as the default, and this repository opts in with Standard and Capable at `medium`. Setting the launch's effort from today's table would raise most agents from `medium` to `high`.
- Retrying at a higher effort is for implementers only. Reviews get one fixed effort.
