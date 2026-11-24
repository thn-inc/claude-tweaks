# Pipeline economy — Phase 7 driver admission trial

Record: #6021. Design: `2026-11-18-pipeline-economy-design.md`, Phase 7. Status: running. As of 2026-11-24T11:52Z, 47 frozen records handled: 16 driven to a PR (16 of 20), 31 replaced.

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

## Resumed, and what else interrupted the trial

- **Resumed 2026-11-23T17:53Z.** #6162 was fixed by PR #6169 (merge commit `4d84b1e5cd`, tests only); the maintainer chose that the trial's session build and merge it. No record was driven between the pause and that merge.
- **A weekly usage limit stopped #3995** at the driver's reviewer step, after its tests and `check` were green. Since then every drive first launches one haiku, one sonnet and one opus worker with the driver's own launch flags; when any of them fails, nothing is driven and the record stays on the list. That check held the trial from 2026-11-23T20:15Z to 2026-11-24T04:40Z, while the account's login had expired. No record was lost to it.
- **The driver's test step timed out on #4310** at its 30-minute bound (`spawnSync … node ETIMEDOUT`). The cause is not established; other sessions' suite runs shared the machine and the suite slot at the time.

- **The driver changed once mid-trial.** #6161 (PR #6182, merge commit `7d33c5d66b`, 2026-11-24T06:31Z) tells the implementer that only the unchained test command runs, so a refused chained command is retried, not fatal. #4309 stopped on exactly that, and several other first attempts ended `worker could not complete` for it. Records through list #21 (#4452) were driven without the fix; list #22 (#4460) onward with it.
- **The driver merged one PR itself.** #4531 (list #29) is not widened and carried `auto:merge`, the case the Operating notes set aside, so its PR #6196 merged unattended once the driver's merge-check and acceptance workers cleared it. Its whole-branch review then found that the PR's own summary says the record's Deliverable 3 was not done. That is filed as #6198 (the merge-check cleared it) and #6199 (the undone sweep's one live finding). It is not the merge-stop defect, so the trial went on.
- **The 40-line bound refuses most `size:medium` records after they are built.** `express-driver-max-lines` stays at its default, as the record requires, so `check` stops a record whose diff has more than 40 implementation lines. The Replaced table's `out-of-bounds` rows are that.
- **The driver's merge-check declined one PR.** #4162 (list #48) is not widened and carries `auto:merge`, like #4531. Its merge-check worker returned `needs-human`, so PR #6217 stopped at `pending-review` and did not merge. Its whole-branch review then found one Critical item. #3902 (list #42), the other such record reached so far, changed no files and has no PR.
- **One record is driven out of list order.** #3986 (list #47) got no verdict from its first `drive.js --check`: `gh` timed out reading the record. A re-check admitted it, so it is driven after #4162 (list #48). Since then a check that returns no verdict is retried once, and a second failure leaves the record on the list.
- **The first `/claude-tweaks:review` that blocks a PR.** The review of #6203 (#4725) ended BLOCKED at its first gate: the failure the record names was already fixed on `main` by #5694, and the PR's one-line change weakens the assertion. Its whole-branch review had found two Critical items. The PR is for the maintainer to close or have fixed; it counts toward the 20 either way.
- **Local paths in saved reports.** A report or a driver stop message that names a path on the trial machine has the home directory written `~` and the session scratch directory written `{scratchpad}`. Two places committed earlier (one Replaced row, one line of `4244-whole-branch.md`) are rewritten that way in this update; nothing else in them changed.

The split of the driver's stops by cause is in the Replaced section.

## Driven records

16 of 20 so far. Minutes are the driver's total and its total without the CI wait. Implementer cost sums the implementer launches; the driver's own reviewer is listed beside it. Each whole-branch review ran on the head the driver pushed, before `/claude-tweaks:review` touched the branch. Reports are in `phase-7-trial-reviews/`: `{record}-whole-branch.md` (guard 1) and `{record}-review.md` (the merge gate). Each is the report as returned, except that a home-directory path is written `~` and the session scratch directory `{scratchpad}`.

| n | List # | Record | PR | Size | Risk | Widened by | Outcome | Minutes | Implementer cost | Driver reviewer | Whole-branch review (Critical / Important / Minor) | `/claude-tweaks:review` (critical / high; verdict) | Fix before merge | Merged |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 6 | #3835 | #6171 | low | low | none | `pending-review` (not-authorized), CI green | 7.8 / 3.9 | $0.15 | $0.28; 0 returned, 0 reproduced | 0 / 3 / 3 | 0 / 0; PASS | yes (4 findings) | no |
| 2 | 10 | #4108 | #6173 | medium | medium | risk, ceremony | `pending-review` (not-authorized), CI green | 12.6 / 9.2 | $1.25 | $0.41; 1 returned, 1 reproduced, fixed in one round | 0 / 1 / 4 | 0 / 0; PASS | yes (7 findings) | no |
| 3 | 11 | #4244 | #6176 | low | medium | risk, protected-path | `pending-review` (not-authorized), CI green | 9.9 / 6.6 | $0.34 | $0.61; 0 returned, 0 reproduced | 0 / 3 / 3 | 0 / 0; PASS | yes (9 findings) | no |
| 4 | 14 | #4365 | #6180 | medium | medium | risk, ceremony, protected-path | `pending-review`, CI red | 19.4 / 16.5 | $0.54 | $0.26; 0 returned, 0 reproduced | 0 / 5 / 7 | 0 / 1; PASS | yes (12 findings) | no |
| 5 | 21 | #4452 | #6189 | medium | medium | risk, protected-path | `pending-review` (not-authorized), CI green | 25.7 / 21.2 | $0.37 | $0.34; 1 returned, 1 reproduced, fixed in one round | 0 / 1 / 5 | 0 / 0; PASS | yes (4 findings) | no |
| 6 | 22 | #4460 | #6191 | low | medium | risk, protected-path | `pending-review` (not-authorized), CI green | 25.0 / 21.2 | $0.07 | $0.21; 2 returned, 2 reproduced, fixed in one round | 0 / 0 / 5 | 0 / 0; PASS | yes (8 findings) | no |
| 7 | 26 | #4472 | #6193 | low | low | protected-path | `pending-review` (not-authorized), CI green | 11.2 / 6.8 | $0.24 | $0.46; 0 returned, 0 reproduced | 0 / 3 / 2 | pending | pending | no |
| 8 | 29 | #4531 | #6196 | low | low | none | `merged` by the driver | 14.3 / 10.4 | $0.17 | $0.17; 2 returned, 2 reproduced, fixed in one round | 0 / 2 / 4 | not run yet | no: merged before /claude-tweaks:review could run | yes, 2026-11-24 (by the driver, unattended; see Operating notes and #6198) |
| 9 | 30 | #4664 | #6201 | low | low | ceremony | `pending-review` (not-authorized), CI green | 11.9 / 8.1 | $0.23 | $0.28; 1 returned, 1 reproduced, fixed in one round | 0 / 4 / 4 | pending | pending | no |
| 10 | 31 | #4725 | #6203 | low | low | protected-path | `pending-review` (not-authorized), CI green | 11.3 / 7.4 | $0.36 | $0.10; 0 returned, 0 reproduced | 2 / 3 / 1 | 0 / 0; BLOCKED. The cause named in the PR body is wrong, no Windows run exists for this branch, and the change makes the assertion weaker. The record is already fixed on main by #5694. | no | no |
| 11 | 37 | #2724 | #6209 | low | low | none | `pending-review` (not-authorized), CI green | 14.1 / 10.3 | $0.23 | $0.21; 1 returned, 1 reproduced, fixed in one round | 0 / 3 / 3 | pending | pending | no |
| 12 | 39 | #3788 | #6210 | low | low | protected-path | `pending-review` (not-authorized), CI green | 8.1 / 4.8 | $0.11 | $0.23; 0 returned, 0 reproduced | 0 / 0 / 3 | pending | pending | no |
| 13 | 40 | #3831 | #6211 | low | low | none | `pending-review` (not-authorized), CI green | 9.2 / 5.9 | $0.09 | $0.14; 0 returned, 0 reproduced | 0 / 0 / 3 | pending | pending | no |
| 14 | 44 | #3905 | #6214 | low | low | protected-path | `pending-review` (not-authorized), CI green | 10.8 / 7.0 | $0.10 | $0.16; 0 returned, 0 reproduced | 0 / 2 / 1 | pending | pending | no |
| 15 | 45 | #3914 | #6215 | low | low | protected-path | `pending-review` (not-authorized), CI green | 7.6 / 3.7 | $0.01 | $0.10; 0 returned, 0 reproduced | 0 / 0 / 7 | pending | pending | no |
| 16 | 48 | #4162 | #6217 | low | low | none | `pending-review` (verdict-not-confirmed), CI green | 15.7 / 12.4 | $0.04 | $0.36; 2 returned, 2 reproduced, fixed in one round | 1 / 1 / 3 | pending | pending | no |

The whole-branch reviewer is one read-only agent on Opus, given superpowers' `requesting-code-review/code-reviewer.md` template (the one a build's final whole-branch review is dispatched with) filled with the record body as the requirements and `merge-base(origin/main, head)..head` as the range, plus one line asking for numbered items and "None" under an empty severity. Counts are `parseReviewCounts`' own; where a report lists "declined to judge" bullets under its Minor heading the Minor count includes them, which guard 1 does not read.

## Replaced

31 so far, in the order handled: 4 not admitted at their turn (`drive.js --check` refused them and `drive.js` was not run) and 27 stopped by the driver before a PR. Of those 27 stops: 9 the 40-line bound at `check`; 5 the driver's reviewer: confirmed findings the fix round did not clear; 5 the worker changed no files; 3 a driver or test defect since fixed (#6162, #6161); 3 tests still red after the relaunch; 2 a usage limit or a timeout.

| List # | Record | Size | Risk | Widened by | What happened | Minutes | Implementer cost | Run |
|---|---|---|---|---|---|---|---|---|
| 1 | #4617 | medium | medium | risk, ceremony, protected-path | Stopped before its PR: `express-escalated` at the test step, `red tests; after one relaunch (red-tests, standard to capable)`. See #6162: one of its two tests was among the failing files. The record carries the driver's escalation comment, which keeps the driver from taking it again until the comment is deleted. | 9.6 | $0.97 | `2026-11-23T160121-drive-4617` |
| 2 | #6143 | medium | medium | risk, protected-path | Not admitted at its turn: `record has an open PR` (#6157, another session's dispatch run). | | | |
| 3 | #6145 | medium | low | ceremony | Not admitted at its turn: `record has an open PR` (#6158, another session's dispatch run). | | | |
| 4 | #6146 | medium | low | ceremony | Not admitted at its turn: `record has an open PR` (#6159, another session's dispatch run). | | | |
| 5 | #3822 | low | low | protected-path | Stopped before its PR: `express-escalated` at the worker step, `worker could not complete: My commit (c1c6a9febf) only changed subagent-dispatch-core.md, dispatch/task-prompt.md and tests/subagent-contract-clauses…`. The first run's tests were red on the two #6162 tests alone, and the relaunched worker reported it could not fix them inside the Key Files. The escalation comment failed to post (a GitHub GraphQL error), so the record carries no escalation marker. | 4.4 | $0.38 | `2026-11-23T161206-drive-3822` |
| 7 | #3875 | medium | medium | risk, ceremony, protected-path | Stopped before its PR: `express-escalated` at the test step, `red tests; after one relaunch (red-tests, standard to capable)`. The failing file was tests/local-merge-close-run-ordering.test.js, a conformance test over the prose the record changes. | 22.7 | $0.78 | `2026-11-23T180100-drive-3875` |
| 8 | #3995 | low | low | none | Stopped before its PR: `express-escalated` at the review step, `reviewer fail/exit: You've hit your weekly limit · resets Nov 29 at 10am (Europe/Copenhagen)`. Tests and check were green. A usage limit on the account, not a finding. | 8.1 | $0.29 | `2026-11-23T182418-drive-3995` |
| 9 | #4004 | low | low | none | Stopped before its PR: `express-escalated` at the review step, `fix round test: red tests: plugin/skills/design-wrapper/modes/review.md:498 The Writers block tells the agent to stage from "a scratch path" but neve…`. The reviewer returned 3 findings, all 3 reproduced by a failing test. Reviewer cost $0.35. | 10.5 | $0.50 | `2026-11-23T190452-drive-4004` |
| 12 | #4309 | low | medium | risk, protected-path | Stopped before its PR: `express-escalated` at the worker step, `worker could not complete: The fix and its test are written but unverified. A new 'joinBackslashNewlines' helper in git-command.js now feeds the unqu…`. Both workers (haiku, then sonnet) wrote the change, were denied a compound shell command, and stopped without running the one test command they are allowed: #6161, fixed by PR #6182 before list #22 was driven. | 1.5 | $0.07 | `2026-11-23T193850-drive-4309` |
| 13 | #4310 | medium | medium | risk, protected-path | Stopped before its PR: `express-escalated` at the test step, `spawnSync ~/.nvm/versions/node/v26.13.1/bin/node ETIMEDOUT; after one relaunch (cannot-complete, standard to capable)`. The 30-minute bound of the driver's test step, on the relaunch. Cause not established; other sessions' suite runs shared the machine. | 33.7 | $0.45 | `2026-11-23T194120-drive-4310` |
| 15 | #4366 | medium | medium | risk, ceremony, protected-path | Stopped before its PR: `express-escalated` at the check step, `out-of-bounds: 66 implementation lines + 2 deleted test lines > 40`. | 17.4 | $0.81 | `2026-11-24T045957-drive-4366` |
| 16 | #4429 | medium | low | ceremony | Stopped before its PR: `express-escalated` at the check step, `out-of-bounds: 44 implementation lines > 40`. | 16.2 | $0.21 | `2026-11-24T051739-drive-4429` |
| 17 | #4431 | medium | medium | risk, ceremony | Stopped before its PR: `express-escalated` at the review step, `fix round test: red tests: plugin/skills/flow/survey.md:36 Decline detection still reads the prior recommendations cache from 'docs/plans/...-recomme…`. The reviewer returned 2 findings, both reproduced. Reviewer cost $0.25. | 14.6 | $0.23 | `2026-11-24T053503-drive-4431` |
| 18 | #4442 | low | low | protected-path | Stopped before its PR: `express-escalated` at the test step, `red tests; after one relaunch (cannot-complete, standard@low to capable@medium); no relaunch: no profile above capable`. | 8.0 | $0.70 | `2026-11-24T055003-drive-4442` |
| 19 | #4443 | medium | medium | risk, ceremony | Stopped before its PR: `express-escalated` at the check step, `out-of-bounds: 46 implementation lines + 1 deleted test lines > 40`. | 10.7 | $0.76 | `2026-11-24T055817-drive-4443` |
| 20 | #4451 | low | medium | risk, protected-path | Stopped before its PR: `express-escalated` at the test step, `red tests; after two relaunches (cannot-complete, fast to standard@medium; cannot-complete, standard@medium to capable@medium)`. | 16.0 | $0.28 | `2026-11-24T060957-drive-4451` |
| 23 | #4461 | medium | medium | risk | Stopped before its PR: `express-escalated` at the check step, `out-of-bounds: 39 implementation lines + 4 deleted test lines > 40`. | 4.9 | $0.29 | `2026-11-24T071724-drive-4461` |
| 24 | #4462 | medium | medium | risk | Stopped before its PR: `express-escalated` at the check step, `out-of-bounds: 48 implementation lines + 1 deleted test lines > 40`. | 10.9 | $0.44 | `2026-11-24T072226-drive-4462` |
| 25 | #4463 | medium | medium | risk | Stopped before its PR: `express-escalated` at the check step, `out-of-bounds: 42 implementation lines + 1 deleted test lines > 40`. | 3.8 | $0.30 | `2026-11-24T073348-drive-4463` |
| 27 | #4493 | low | low | protected-path | Stopped before its PR: `express-escalated` at the commit step, `no changed files; after one relaunch (red-tests, standard@low to standard@medium)`. | 8.2 | $0.21 | `2026-11-24T074907-drive-4493` |
| 28 | #4496 | medium | medium | risk, ceremony | Stopped before its PR: `express-escalated` at the check step, `out-of-bounds: 46 implementation lines + 1 deleted test lines > 40`. | 9.5 | $0.39 | `2026-11-24T075733-drive-4496` |
| 32 | #4741 | low | low | ceremony | Stopped before its PR: `express-escalated` at the review step, `fix round test: red tests: plugin/skills/flow/multi-spec.md:125 The new per-record range rule matches only a commit whose subject is exactly 'Materia…`. The reviewer returned 1 finding, reproduced. Reviewer cost $0.20. | 11.7 | $0.03 | `2026-11-24T084548-drive-4741` |
| 33 | #4764 | low | low | none | Stopped before its PR: `express-escalated` at the commit step, `no changed files`. The worker found the fix already on main. | 2.2 | $0.02 | `2026-11-24T085749-drive-4764` |
| 34 | #4831 | medium | low | ceremony | Stopped before its PR: `express-escalated` at the commit step, `no changed files`. The worker found the work already done. | 1.6 | $0.11 | `2026-11-24T090021-drive-4831` |
| 35 | #4895 | medium | medium | risk, ceremony, protected-path | Stopped before its PR: `express-escalated` at the review step, `fix round check: out-of-bounds: 30 implementation lines + 12 deleted test lines > 40: plugin/bin/lib/hooks/worktree-reap.js:178 lockVerdict trusts V8…`. The fix for the reviewer finding took the diff past the 40-line bound. Reviewer cost $0.38. | 33.2 | $0.81 | `2026-11-24T090357-drive-4895` |
| 36 | #6142 | medium | medium | risk | Not admitted at its turn: `record lacks auto:build; record is not open; typed command not accepted: launcher` (closed as completed by another session at 2026-11-24T04:51Z, before its turn). | | | |
| 38 | #3731 | medium | medium | risk, ceremony, protected-path | Stopped before its PR: `express-escalated` at the check step, `out-of-bounds: outside Key Files: plugin/bin/lib/dev-server/dev-server.js; 116 implementation lines + 108 deleted test lines > 40`. | 19.3 | $1.58 | `2026-11-24T095857-drive-3731` |
| 41 | #3878 | medium | medium | risk, ceremony | Stopped before its PR: `express-escalated` at the check step, `out-of-bounds: 83 implementation lines + 1 deleted test lines > 40`. | 15.9 | $0.60 | `2026-11-24T103611-drive-3878` |
| 42 | #3901 | low | low | none | Stopped before its PR: `express-escalated` at the commit step, `no changed files`. | 0.7 | $0.05 | `2026-11-24T105218-drive-3901` |
| 43 | #3902 | low | low | none | Stopped before its PR: `express-escalated` at the commit step, `no changed files`. A not-widened auto:merge record. | 0.6 | $0.04 | `2026-11-24T105319-drive-3902` |
| 46 | #3963 | low | low | protected-path | Stopped before its PR: `express-escalated` at the review step, `fix round test: red tests: plugin/skills/tidy/step-6-auto.md:37 The new not-landed row puts the bare value 'Yours' in its tier cells, but 'Yours' is …`. Reviewer cost $0.48. | 17.2 | $0.87 | `2026-11-24T111258-drive-3963` |

## Guard results

| Guard | Value | Baseline | Read on |
|---|---|---|---|
| 1 | pending: 12 of 16 reviewed PRs so far have a Critical or Important item (4 to go) | 70% | |
| 2 | not applicable: the driver has no task review | | |
| 3 | pending | pending (on or after 2026-12-02) | |

## Verdict

Provisional: pending. Final: pending.
