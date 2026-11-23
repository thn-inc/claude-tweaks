# Pipeline economy — Phase 7 driver admission trial

Record: #6021. Design: `2026-11-18-pipeline-economy-design.md`, Phase 7. Status: paused on #6162 since 2026-11-23T16:17Z. Five frozen records handled, none driven to a PR (0 of 20).

## Verdict rule

Committed before the first driven record's PR exists (AC6). It does not change once that PR exists.

**The sample.** 20 records driven to a PR with `node plugin/bin/drive.js #N`, taken in queue order from the records the post-policy funnel (below) admits. That list is frozen when the post-policy funnel runs. A record stopped or refused before its PR exists is listed under Replaced and the next record on the frozen list takes its place. A PR that is rejected or closed still counts, with its review. If the frozen list runs out before 20 PRs exist, the shortfall is reported here and #6021 stays open; the sample is never shrunk.

**Guard 1 — review findings.** For each driven PR, run the whole-branch review `/claude-tweaks:build`'s subagent-driven development dispatches at the end of a build (the `final review` / `whole-branch review` dispatch `collectWholeBranch` in `tools/pipeline-cost-report/guards.js` counts), against `origin/main...{PR head}`. Save its final report at `docs/superpowers/specs/phase-7-trial-reviews/{N}-whole-branch.md` and count it with `parseReviewCounts` from the same file. Guard 1 is the share of driven PRs whose report has at least one Critical or Important item. No worse means at or below 70% (the design's whole-branch baseline, measured by that counter), with no margin. A report `parseReviewCounts` cannot read (it returns null) is re-run once; if it still cannot be read it is listed and left out of the share, and the denominator says so.

This is the same instrument the 70% was measured with. `/claude-tweaks:review` also runs on every driven PR, as the merge gate (a Critical finding is fixed or the PR is closed, never merged as is), and its report is saved at `docs/superpowers/specs/phase-7-trial-reviews/{N}-review.md`. It does not feed guard 1: it grades findings critical, high, medium and low in a table, which `parseReviewCounts` does not read (decision, 2026-11-23).

**Guard 2 — task-review first pass.** Not applicable: the driver has no task review.

**Guard 3 — bugs after merge.** The rate of `type:bug` records filed within 14 days of a merge that name, under `### Key Files`, a file the merged PR changed, per merged PR: `collectPostMergeBugs` in `tools/pipeline-cost-report/guards.js`. The committed baseline (`docs/reference/pipeline-economy-baseline.md`) has no guards section, so the baseline value is computed with the same function over the PRs merged 2026-11-08 to 2026-11-18, read on or after 2026-12-02 (14 days after the last of them), and recorded below with its read date (decision, 2026-11-23). The trial value is read over the 20 driven PRs that merged, on or after 14 days past the last trial merge. No worse means a trial rate at or below the baseline rate.

**Verdicts.** A provisional verdict is written once all 20 guard 1 reports exist, citing guard 1's numerator and denominator. The final verdict is written after the trial's guard 3 read, citing guard 3's count, the merged-PR count and the baseline value. If either guard is worse, the five policy values go back to their defaults in a policy-only PR before #6021 closes.

**Per driven PR, also recorded:** number, size, risk, widenings, outcome, minutes, cost, `/claude-tweaks:review` critical and high counts, whether a fix was applied before merge, merged or not.

## Trial settings

Set in `.claude-tweaks/policy.yml` by the policy-only PR #6141 (merge commit `c0bbfa519c`, merged 2026-11-23T15:40:46Z, 13 seconds before this file's own PR #6140), before the first driven record:

| Key | Value | Why |
|---|---|---|
| `express-driver-review` | `on` | The reviewer step runs on every driven record. |
| `express-driver-max-size` | `medium` | |
| `express-driver-max-key-files` | `11` | The smallest limit that admits every record refused only for the Key File limit once the other four values apply. On 2026-11-23, with those four set in a scratch clone of `main` at `a2863c1a75`, `drive.js --check` refused 27 of 153 records for "more than 3 Key Files" and nothing else; stepping the limit up left 16 at 4, 14 at 5, 10 at 6, 8 at 7, 5 at 8, 2 at 9, 1 at 10 and none at 11 (#4366 lists 11). This row first read `4`, counted under the pre-trial settings (5 records, each with 4 Key Files); #6141 had already merged with 11, and 11 is the value the trial runs under (see Operating notes). |
| `express-driver-max-risk` | `high` | |
| `express-driver-protected-paths` | `reviewer` | |

`express-driver-max-lines` stays at its default.

## Funnel before the trial

`node tools/pipeline-cost-report.js --section funnel --repo thn-inc/claude-tweaks`, run 2026-11-23 on `origin/main` at `497a4f41d4`, before any trial value was set:

```
Driver admission, run 2026-11-23, plugin 6.177.0.

Checked: 152; admitted: 14; unreadable: 0.

Driver runs: 1 (1 dispatch-routed, 0 standalone); last 2026-11-23; unreadable: 1.
Dispatch firings: 17; reached the driver route: 12; by plugin version: 6.170.0 1, 6.175.0 8, 6.176.0 7, 6.177.0 1; unreadable: 2.

| Refusal reason | Records |
|---|---|
| size is not low | 75 |
| protected path | 72 |
| risk is not low | 66 |
| more than 3 Key Files | 64 |
| ceremony is not fast-lane | 57 |
| record has an open PR | 20 |
| record has an open blocker | 19 |
| no Key Files | 18 |
| record carries a kept risk flag | 7 |
| frontend surface | 5 |
| auto:merge-pending grant matures only on the normal path | 3 |
| no type:* label | 2 |

| If these stopped refusing | Admitted |
|---|---|
| protected path | 30 |
| more than 3 Key Files | 19 |
| no Key Files | 19 |
| ceremony is not fast-lane | 18 |
| size is not low | 17 |
| auto:merge-pending grant matures only on the normal path | 16 |
| frontend surface | 15 |
| no type:* label | 15 |
| record has an open PR | 15 |
| record carries a kept risk flag | 14 |
| record has an open blocker | 14 |
| risk is not low | 14 |

Runs: 215 in the window; 11 undated.
Unreadable: 3
```

Admitted share before: 14 of 152 (9%). The design expected about 11%.

## Funnel after the policy change

`node tools/pipeline-cost-report.js --section funnel --repo thn-inc/claude-tweaks`, run 2026-11-23 from 15:48:54Z on `main` at `ccfef6d5f3`, with the five trial values set and before any record was driven. `express-driver-max-lines` was at its default for both funnels.

```
Driver admission, run 2026-11-23, plugin 6.177.0.

Checked: 160; admitted: 85; unreadable: 0.

Driver runs: 1 (1 dispatch-routed, 0 standalone); last 2026-11-23; unreadable: 0.
Dispatch firings: 21; reached the driver route: 14; by plugin version: 6.170.0 1, 6.175.0 8, 6.176.0 7, 6.177.0 5; unreadable: 0.

| Refusal reason | Records |
|---|---|
| record has an open blocker | 24 |
| record has an open PR | 19 |
| no Key Files | 18 |
| size is not low or medium | 14 |
| record carries a kept risk flag | 6 |
| frontend surface | 5 |
| auto:merge-pending grant matures only on the normal path | 3 |
| no type:* label | 2 |
| more than 11 Key Files | 1 |
| protected path | 1 |

| If these stopped refusing | Admitted |
|---|---|
| record has an open PR | 101 |
| record has an open blocker | 99 |
| no Key Files | 98 |
| frontend surface | 90 |
| auto:merge-pending grant matures only on the normal path | 88 |
| size is not low or medium | 88 |
| no type:* label | 87 |
| protected path | 86 |
| more than 11 Key Files | 85 |
| record carries a kept risk flag | 85 |

Runs: 224 in the window; 11 undated.
Unreadable: 0
```

Admitted share after: 85 of 160 (53%), against 14 of 152 (9%) before. The design expected about 61%. Between the two funnels the open `ready` + `auto:build` set grew by eight records.

### Frozen candidate list

The 85 records that run admitted, in queue order: the order dispatch's `next` ranking gives (`rankNext` in `plugin/bin/lib/dispatch/queue-pull.js`), priority high, medium, low, none, then oldest created first. Each verdict is the `drive.js --check` answer the tool itself tallied, saved per record from the same run. Labels are as read at the freeze. The trial takes records from the top; the first 20 driven to a PR are the sample.

| # | Record | Priority | Created | Size | Risk | Ceremony | auto:merge | Widened by |
|---|---|---|---|---|---|---|---|---|
| 1 | #4617 | high | 2026-10-30 | medium | medium | standard | no | risk, ceremony, protected-path |
| 2 | #6143 | high | 2026-11-23 | medium | medium | none | yes | risk, protected-path |
| 3 | #6145 | high | 2026-11-23 | medium | low | standard | yes | ceremony |
| 4 | #6146 | high | 2026-11-23 | medium | low | standard | yes | ceremony |
| 5 | #3822 | medium | 2026-10-20 | low | low | fast-lane | no | protected-path |
| 6 | #3835 | medium | 2026-10-20 | low | low | fast-lane | no | none |
| 7 | #3875 | medium | 2026-10-21 | medium | medium | standard | no | risk, ceremony, protected-path |
| 8 | #3995 | medium | 2026-10-23 | low | low | fast-lane | yes | none |
| 9 | #4004 | medium | 2026-10-24 | low | low | fast-lane | no | none |
| 10 | #4108 | medium | 2026-10-24 | medium | medium | standard | no | risk, ceremony |
| 11 | #4244 | medium | 2026-10-25 | low | medium | fast-lane | no | risk, protected-path |
| 12 | #4309 | medium | 2026-10-25 | low | medium | none | no | risk, protected-path |
| 13 | #4310 | medium | 2026-10-25 | medium | medium | none | no | risk, protected-path |
| 14 | #4365 | medium | 2026-10-26 | medium | medium | standard | no | risk, ceremony, protected-path |
| 15 | #4366 | medium | 2026-10-26 | medium | medium | standard | no | risk, ceremony, protected-path |
| 16 | #4429 | medium | 2026-10-26 | medium | low | standard | no | ceremony |
| 17 | #4431 | medium | 2026-10-26 | medium | medium | standard | no | risk, ceremony |
| 18 | #4442 | medium | 2026-10-26 | low | low | fast-lane | no | protected-path |
| 19 | #4443 | medium | 2026-10-26 | medium | medium | standard | no | risk, ceremony |
| 20 | #4451 | medium | 2026-10-26 | low | medium | none | no | risk, protected-path |
| 21 | #4452 | medium | 2026-10-26 | medium | medium | none | no | risk, protected-path |
| 22 | #4460 | medium | 2026-10-27 | low | medium | none | no | risk, protected-path |
| 23 | #4461 | medium | 2026-10-27 | medium | medium | none | no | risk |
| 24 | #4462 | medium | 2026-10-27 | medium | medium | none | no | risk |
| 25 | #4463 | medium | 2026-10-27 | medium | medium | none | no | risk |
| 26 | #4472 | medium | 2026-10-27 | low | low | fast-lane | no | protected-path |
| 27 | #4493 | medium | 2026-10-28 | low | low | fast-lane | no | protected-path |
| 28 | #4496 | medium | 2026-10-28 | medium | medium | standard | no | risk, ceremony |
| 29 | #4531 | medium | 2026-10-28 | low | low | none | yes | none |
| 30 | #4664 | medium | 2026-10-31 | low | low | standard | no | ceremony |
| 31 | #4725 | medium | 2026-10-31 | low | low | fast-lane | no | protected-path |
| 32 | #4741 | medium | 2026-10-31 | low | low | standard | no | ceremony |
| 33 | #4764 | medium | 2026-10-31 | low | low | fast-lane | no | none |
| 34 | #4831 | medium | 2026-11-01 | medium | low | standard | no | ceremony |
| 35 | #4895 | medium | 2026-11-01 | medium | medium | standard | no | risk, ceremony, protected-path |
| 36 | #6142 | medium | 2026-11-23 | medium | medium | none | yes | risk |
| 37 | #2724 | low | 2026-09-21 | low | low | fast-lane | no | none |
| 38 | #3731 | low | 2026-10-20 | medium | medium | standard | no | risk, ceremony, protected-path |
| 39 | #3788 | low | 2026-10-20 | low | low | fast-lane | no | protected-path |
| 40 | #3831 | low | 2026-10-20 | low | low | fast-lane | no | none |
| 41 | #3878 | low | 2026-10-21 | medium | medium | standard | no | risk, ceremony |
| 42 | #3901 | low | 2026-10-21 | low | low | fast-lane | no | none |
| 43 | #3902 | low | 2026-10-21 | low | low | fast-lane | yes | none |
| 44 | #3905 | low | 2026-10-21 | low | low | fast-lane | no | protected-path |
| 45 | #3914 | low | 2026-10-21 | low | low | fast-lane | no | protected-path |
| 46 | #3963 | low | 2026-10-22 | low | low | none | no | protected-path |
| 47 | #3986 | low | 2026-10-23 | low | low | none | no | none |
| 48 | #4162 | low | 2026-10-24 | low | low | fast-lane | yes | none |
| 49 | #4163 | low | 2026-10-24 | medium | medium | standard | no | risk, ceremony |
| 50 | #4191 | low | 2026-10-24 | medium | low | none | no | none |
| 51 | #4209 | low | 2026-10-24 | low | low | standard | yes | ceremony |
| 52 | #4211 | low | 2026-10-24 | low | low | none | no | protected-path |
| 53 | #4243 | low | 2026-10-25 | low | low | fast-lane | no | protected-path |
| 54 | #4245 | low | 2026-10-25 | low | low | fast-lane | yes | protected-path |
| 55 | #4247 | low | 2026-10-25 | medium | medium | none | no | risk, protected-path |
| 56 | #4248 | low | 2026-10-25 | low | low | none | no | protected-path |
| 57 | #4259 | low | 2026-10-25 | low | low | none | yes | none |
| 58 | #4264 | low | 2026-10-25 | low | low | none | no | none |
| 59 | #4269 | low | 2026-10-25 | low | low | none | no | none |
| 60 | #4271 | low | 2026-10-25 | low | low | fast-lane | yes | protected-path |
| 61 | #4284 | low | 2026-10-25 | low | low | none | yes | protected-path |
| 62 | #4312 | low | 2026-10-25 | low | low | none | no | none |
| 63 | #4330 | low | 2026-10-25 | low | low | none | no | none |
| 64 | #4337 | low | 2026-10-25 | low | low | none | no | none |
| 65 | #4353 | low | 2026-10-25 | medium | medium | standard | no | risk, ceremony, protected-path |
| 66 | #4357 | low | 2026-10-25 | low | low | none | no | none |
| 67 | #4364 | low | 2026-10-26 | medium | low | none | no | protected-path |
| 68 | #4433 | low | 2026-10-26 | medium | low | none | yes | none |
| 69 | #4447 | low | 2026-10-26 | low | low | none | no | protected-path |
| 70 | #4471 | low | 2026-10-27 | low | medium | none | no | risk, protected-path |
| 71 | #4501 | low | 2026-10-28 | medium | medium | none | no | risk |
| 72 | #4521 | low | 2026-10-28 | low | low | none | yes | protected-path |
| 73 | #4522 | low | 2026-10-28 | medium | medium | none | no | risk, protected-path |
| 74 | #4523 | low | 2026-10-28 | low | low | none | yes | protected-path |
| 75 | #4524 | low | 2026-10-28 | low | low | none | yes | protected-path |
| 76 | #4525 | low | 2026-10-28 | low | low | none | no | protected-path |
| 77 | #4526 | low | 2026-10-28 | medium | low | none | no | none |
| 78 | #4552 | low | 2026-10-29 | medium | medium | standard | no | risk, ceremony, protected-path |
| 79 | #4671 | low | 2026-10-31 | low | low | fast-lane | no | protected-path |
| 80 | #4672 | low | 2026-10-31 | low | low | none | no | none |
| 81 | #4861 | low | 2026-11-01 | medium | medium | standard | no | risk, ceremony, protected-path |
| 82 | #4931 | low | 2026-11-02 | medium | low | standard | no | ceremony, protected-path |
| 83 | #4946 | low | 2026-11-02 | low | low | fast-lane | no | protected-path |
| 84 | #4990 | low | 2026-11-02 | low | low | standard | no | ceremony |
| 85 | #5070 | low | 2026-11-03 | medium | low | fast-lane | no | none |

62 of the 85 are widened (by risk, ceremony or a protected path) and stop at `pending-review` by construction. 23 are not.

## Operating notes

Written before the first driven record. None of this changes the verdict rule above.

- **One owner.** Two sessions started this trial on 2026-11-23. `specify-p7` wrote this file's first version (PR #6140) and has stopped; `trial-6021` set the policy values (PR #6141) and runs the trial from here.
- **Two maintainer decisions amend the record body.** The guard 1 instrument and the guard 3 baseline window in the verdict rule were each chosen by the maintainer in the `specify-p7` session on 2026-11-23. The record body's own guard 1 wording (count `/claude-tweaks:review` reports with `parseReviewCounts`) cannot work: that report grades findings low, medium and high in a table with no Critical, Important or Minor heading, so the counter returns null for it.
- **A not-widened record that carries `auto:merge`.** Six of the 85 are not widened and carry `auto:merge` (#3995, #4531, #3902, #4162, #4259, #4433). The driver may merge such a record itself once its judgment workers clear it, as it did before the trial. That is not the merge-stop defect the record names. If it happens, the row says so, both reviews run on the merged PR, and the merge gate could not apply to it. A widened record that merges by itself stops the trial and is filed.
- **Skips.** A frozen record that is no longer admitted when its turn comes (an open PR appeared, a blocker opened, a claim is contested, its labels changed) is listed under Replaced with the reason `drive.js` gave, and the next record on the list takes its place. Other sessions' dispatch drains run under the same policy and may take frozen records first.
- **Review reports.** Each driven PR's two reports are saved under `docs/superpowers/specs/phase-7-trial-reviews/` as the verdict rule names them.

## Trial paused: the driver's test step is red for a reason outside the records (#6162)

Paused 2026-11-23T16:17Z, after the first two records the driver took both stopped at its test step.

Two tests on `main` pass only when `gh` has credentials: `tests/bin-lib/hooks/reconcile-background.test.js:182` and `tests/console-execute.test.js:944`. The driver runs its test step with an empty `GH_CONFIG_DIR` and no token, so any record whose impact selection includes either file stops as `red tests`, whatever it changed. CI sets `GH_TOKEN` and passes. On `main` at `4c6072baac`, the two files give 112 of 112 passing in the normal environment and 110 of 112 without credentials; the whole suite without credentials gives 35,690 passing, 2 failing and 20 skipped of 35,712.

- #3822 was stopped by exactly these two tests. Its change touched neither file, and its relaunch prompt lists both as the failing files.
- #4617 had `reconcile-background.test.js` among the four failing files of its first run. What its second run failed on cannot be read back: the driver removed the worktree that held the report.

Driving on would escalate more frozen records to the standard lane for the same reason, so no further record is driven until #6162 is fixed on `main`. The two stops stay under Replaced, as the verdict rule says; both are attributed to #6162 there, and neither says anything about the admission values.

## Driven records

None yet (0 of 20).

## Replaced

In the order handled. "Not admitted at its turn" rows cost nothing: `drive.js --check` refused them and `drive.js` was not run.

| List # | Record | Size | Risk | Widened by | What happened | Minutes | Implementer cost | Run |
|---|---|---|---|---|---|---|---|---|
| 1 | #4617 | medium | medium | risk, ceremony, protected-path | Stopped before its PR: `express-escalated` at the test step, `red tests; after one relaunch (red-tests, standard to capable)`. See #6162. The record carries the driver's escalation comment, which keeps the driver from taking it again until the comment is deleted. | 9.6 | $0.97 | `2026-11-23T160121-drive-4617` |
| 2 | #6143 | medium | medium | risk, protected-path | Not admitted at its turn: `record has an open PR` (#6157, another session's dispatch run). | | | |
| 3 | #6145 | medium | low | ceremony | Not admitted at its turn: `record has an open PR` (#6158, another session's dispatch run). | | | |
| 4 | #6146 | medium | low | ceremony | Not admitted at its turn: `record has an open PR` (#6159, another session's dispatch run). | | | |
| 5 | #3822 | low | low | protected-path | Stopped before its PR: `express-escalated` at the worker step. The first run's tests were red on the two #6162 tests alone, and the relaunched worker reported it could not fix them inside the Key Files. The escalation comment failed to post (a GitHub GraphQL error), so the record carries no escalation marker. | 4.4 | $0.38 | `2026-11-23T161206-drive-3822` |

## Guard results

| Guard | Value | Baseline | Read on |
|---|---|---|---|
| 1 | pending | 70% | |
| 2 | not applicable: the driver has no task review | | |
| 3 | pending | pending (on or after 2026-12-02) | |

## Verdict

Provisional: pending. Final: pending.
