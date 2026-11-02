---
name: claim-targets-stop-addition
description: Use when adding an exit code or a new stop to `plugin/bin/claim-targets.js`, or re-routing an existing claim failure to a different exit — every site the stop must land in across the CLI, `/flow`, `/dispatch` and wrap-up teardown, plus the decisions it owes (run-level or per-target, whether "never claimed" holds, whether the firing continues, how forge text travels). Keywords - claim-targets, exit code, stop, card, Settle, settle-and-merge, firing stop, two-call-gate, cleanup-only, Section E, release-claim, false release comment, keep-going, claims-registry.
---

# claim-targets.js stop addition

## Overview

`plugin/bin/claim-targets.js` has seven exit codes, and each non-zero one is read by consumers the CLI's own tests cannot see. A stop is not shipped when the CLI exits the new code; it is shipped when the card, Settle, dispatch, teardown and the docs all agree on it. #4899's spec named 8 non-test key files and its diff touched 21. Plan review, task reviews and final review each found another gap, the worst being a false "Released by run" comment on a record the run never claimed.

## Key Patterns

### The registration set

Answer the decisions below first, because they choose the rows. Rows 1-10 apply to every stop, row 3 only for the field it names; rows 11-13 say when they apply.

| # | Site | What it owes |
|---|---|---|
| 1 | `plugin/bin/lib/claim-targets/claim-targets.js` | The stop itself, `USAGE`, the `abort` comment listing its callers and codes, and the `stopOrSkip` comment's list of codes |
| 2 | `plugin/bin/claim-targets.js` | The header comment's exit list |
| 3 | `plugin/bin/lib/issues/claim-store.js` | Only if the stop needs a field the store drops today. `permissionErrorField` keeps `error` on `permission-denied` only, so every other failure's shape stays unchanged |
| 4 | `plugin/skills/flow/claim-targets.md` | The exit bullet with its `## Flow: …` card, the "On exit 3, 4, 5, 6, or 7" cleanup list, the `--keep-going` paragraph, and which transport reaches the stop |
| 5 | `plugin/skills/flow/SKILL.md` Step 2.8 | The exit summary sentence, pinned byte for byte by `tests/dispatch-resume-prose.test.js` |
| 6 | `plugin/skills/_shared/issue-claims.md` | The protocol description, the failure-posture table, and the Group-claim-all-or-abort exception |
| 7 | `docs/plugin-structure.md`, `docs/journeys/act-on-a-contested-claim.md`, `.claude/skills/gh-api-module-pattern/` | The command line's exit list; the journey's Success state, a new step and its changelog line; any exit claim the project skills restate (grep them, see Common Operations) |
| 8 | `plugin/skills/dispatch/settle-and-merge.md` Claim-contest special case | Which Settle steps run, the `flow-step-2.8-…` failing-check-name, and the "{N} different stop shapes" count. `tests/flow-claim-preflight.test.js` slices this section up to `**Open-linked-PR enrichment` |
| 9 | `plugin/skills/dispatch/task-prompt.md`, `express-prompt.md`, `plugin/skills/_shared/express-lane.md` | The exact `ISSUE #{n}: failed:{gate}` value a dispatched agent reports, and the express lane's step 1 and `blocked` outcome |
| 10 | `plugin/skills/dispatch/firing-exclusion.md`, `next-ranking.md` | Name the stop in their pre-flight stop lists |
| 11 | `plugin/skills/dispatch/two-call-gate.md` section 5, `plugin/skills/wrap-up/cleanup-procedures-execution.md` Section E, `plugin/skills/wrap-up/flags.md` | Only when teardown must not release: the phrase the `cleanup-only` call appends, Section E's skip with its log line, and the `cleanup-only` flag entry that strips the phrase before input classification |
| 12 | `plugin/skills/dispatch/reporting.md` | Only when a person must act: the relay block, since the first call's reply carries only status lines |
| 13 | `plugin/skills/dispatch/SKILL.md`, `sequential-execution.md`, `two-call-gate.md` sections 5 and 7 | Only for a firing stop: the stop paragraph, the Every-exit close-out list, the Loop's terminators (two sentences), and every "next group" move-on site |

Tests: `tests/bin-lib/claim-targets/claim-targets.test.js` (the exit and its envelope), `tests/bin-lib/issues/claim-store.test.js` (a new store field), `tests/flow-claim-preflight.test.js` (one pin per prose row above), `tests/dispatch-resume-prose.test.js` (row 5).

### Decisions each stop owes

1. **Per-target or run-level?** A failure that one target can have goes through `stopOrSkip`, so `--keep-going` downgrades it to a `skipped` entry. A failure every target would meet returns through `abort` directly, with or without `--keep-going`: `handleBranchMissing` (exit 6) and `permissionStop` (exit 7).
2. **Which transport reaches it?** The gh-absent MCP claim procedure in `flow/claim-targets.md` is prose and does not get a new exit by itself. Exit 7 is `gh` transport only, and its bullet and `issue-claims.md` both say a refusal on the MCP path stays transient. State the limit, or extend the procedure.
3. **Does "this record was never claimed" hold?** Settle's special case rests on it, and a bundle breaks it: an earlier member may already be claimed when a later one stops. Trace what `release-claim.js` would do at Settle step 2 and at Section E for this stop's blob state. On exit 6 the branch is missing, so `release.js` reports nothing to release and posts no comment. On exit 7 the branch exists, so the same call posts a false release comment, which is why both Settle and Section E skip it.
4. **Is the record at fault?** Decide the retry-ceiling attempt, failure comment, `bot:blocked` and grant changes one by one, then name them in Settle. Exit 6 skips steps 3-7; exit 7 skips steps 1-7 because the token, not the record, is at fault.
5. **Does the firing continue?** A cause specific to the record excludes it and moves on (`firing-exclusion.md`). A cause shared by every group, such as a token, ends the firing in every selection form, which brings in row 13.
6. **Does the stop carry forge text?** Build the reason with `claim-store.js`'s `refusalText`, then `oneLineReason`: a real `gh` error opens with a `Command failed:` line holding the claim payload. Text from GitHub can keep backticks, `$(` and `"`, so a headless self-report writes the body with the Write tool and passes `--body-file`, never the template's `--body` (`settle-and-merge.md`'s Claim permission denied paragraph).

## Decision Framework

| The stop is | Rows it takes |
|---|---|
| Per-target, record at fault, firing continues | 1-10 |
| Run-level, record not at fault, firing continues (exit 6) | 1-10 |
| Run-level, shared cause, teardown must not release, firing ends (exit 7) | All 13 |
| An existing failure re-routed to another code | Every row that names the old code, plus row 7's restatements of it |

## Project Conventions

- A code exists because a consumer branches on it (`cli-wrapper-contract.md`'s bullets on domain exit codes). Before allocating one, name the branch.
- The card gives one next step. A stop a retry cannot fix says what to check, never "re-run", and `tests/flow-claim-preflight.test.js` asserts that for exit 7.
- A value on the `ISSUE #{n}: failed:{gate}` line is exact, because dispatch routes on it as a self-reported line. Spell it once in `task-prompt.md` and pin it.
- Keep the skill-size literal out of the new test: `tests/skill-size-single-source.test.js` fails any `tests/` file comparing a skill's bytes against a large literal (#4899 paid one commit after a full run, `04ea01ee9`).

## Common Operations

Derive the site list from the last stop rather than trusting the table alone, since a site may have moved:

```bash
git grep -n -E 'claims-branch-missing|claim-permission-denied|Claim permission|branchMissing|permissionDenied' -- plugin docs .claude/skills tests
git grep -n -E 'On exit 3|Exit 3/4|never exits 3|flow-step-2\.8-' -- plugin/skills tests
git grep -n -o -E '.{60}(next group|group N\+1).{70}' -- plugin/skills/dispatch
git grep -n 'release-claim\.js' -- plugin/skills/dispatch plugin/skills/wrap-up
```

The third command is for a firing stop: each hit needs a verdict, since some already sit behind an earlier stop. Read the diffs for both prior stops side by side (`git show --stat 4b0d12438`, `git diff --stat cad320173..492591d74`) when a row's reason is unclear.

## Anti-Patterns

| Pattern | Why It Fails in This Project |
|---|---|
| Listing Key Files from the CLI outward at spec time | The consumers sit two calls away. #4899's spec named 8 non-test files; the other 13 arrived during the build and review, at a cost of three review rounds and four fix commits |
| Reusing Settle's "never claimed" premise for a stop that can follow a claim | Steps 1-2 and Section E release by default, so the run posts a false release comment on a record it never claimed. Plan review caught Settle; task review caught Section E afterwards |
| Stopping the skip at Settle | `two-call-gate.md` section 5 calls `cleanup-only` afterwards, and its Section E releases again. A skip has to name every release site |
| Adding the Section E phrase without declaring it in `flags.md` | The `cleanup-only` argument parser would read the parenthetical as input, not as a flag it strips |
| Testing the reason with a clean fake error | `HTTP 403: Forbidden` passes with or without `refusalText`, so a real error's `Command failed:` line and base64 payload reach the card. Use the real shape (`real-shape refusal` in `tests/bin-lib/claim-targets/claim-targets.test.js`) |
| A sweep for the old exit claim that walks only `plugin/` and `docs/` | `.claude/skills/` restates the exit table. `batching-failure-posture.md` kept a false exit 4 claim until review |
| Carving a firing stop out of the first "next group" site found | The move-on sentence is restated in `SKILL.md`, `sequential-execution.md` and two sections of `two-call-gate.md`; task reviews found them across two fix commits (`c93e99b8b`, `80be95ca4`) |

## Reference

- Exit contract: `plugin/skills/flow/claim-targets.md`, `plugin/skills/_shared/issue-claims.md`
- Worked examples: #4495 (`4b0d12438`, exit 6, firing continues), #4899 (exit 7, firing ends)
- General exit-change sweep: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`
- Failure classifier: `.claude/skills/gh-api-module-pattern/batching-failure-posture.md`
