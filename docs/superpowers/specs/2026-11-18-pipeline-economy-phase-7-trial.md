# Pipeline economy — Phase 7 driver admission trial

Record: #6021. Design: `2026-11-18-pipeline-economy-design.md`, Phase 7. Status: verdict rule committed; trial not started.

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

Set in `.claude-tweaks/policy.yml` by a policy-only PR, after this file and before the first driven record:

| Key | Value | Why |
|---|---|---|
| `express-driver-review` | `on` | The reviewer step runs on every driven record. |
| `express-driver-max-size` | `medium` | |
| `express-driver-max-key-files` | `4` | The smallest limit that admits every record the pre-trial funnel refused only for the Key File limit: #3835, #3902, #4004, #4259 and #4357, each with 4 Key Files. |
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

Pending: the same command, run on `origin/main` once the policy PR has merged and before the first driven record. Its admitted set, in queue order, is the frozen candidate list. An estimate from each record's refusal reasons under the five values gives about 65 of 151 (43%); the design expected about 61%.

## Driven records

Pending.

## Replaced

None yet.

## Guard results

| Guard | Value | Baseline | Read on |
|---|---|---|---|
| 1 | pending | 70% | |
| 2 | not applicable: the driver has no task review | | |
| 3 | pending | pending (on or after 2026-12-02) | |

## Verdict

Provisional: pending. Final: pending.
