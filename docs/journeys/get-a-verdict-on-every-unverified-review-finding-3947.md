---
files:
  - plugin/skills/review/step3-tiebreak.md
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/review/step3-lens-dispatch.md
  - plugin/skills/review/step3-tier-variants.md
  - plugin/skills/review/step3-debate-and-refutation.md
  - plugin/skills/review/step3-routing.md
  - plugin/skills/review/review-summary-template.md
  - plugin/bin/review-coordination.js
  - plugin/bin/lib/tiebreak.js
---

# Get a Verdict on Every Unverified Review Finding

**Persona:** a developer who runs `/claude-tweaks:review` on a finished build, either inside a `/claude-tweaks:flow` run or on its own. Until now the Review Console handed them a pile of Low-confidence findings that one agent had reported and nobody had checked, and they had to judge each one by hand.
**Goal:** every finding that is still `unconfirmed` or `contested` after the earlier passes gets one independent verdict. The developer then sees only real findings, or findings an independent reader genuinely could not settle.
**Entry point:** `/claude-tweaks:review {N}` at any effort tier (`low` through `max`). It runs in a pipeline (`$PIPELINE_RUN_DIR` set), standalone, or inside a `/dispatch`-run reviewer.
**Success state:**
- Each listed finding has exactly one `tiebreak:{id}` verdict line.
- Confirmed findings are routed like any other confirmed finding, and refuted ones are dropped.
- Findings the tiebreak could not settle land where a person will see them: the digest for `low`/`info`, and the Review Console (or, standalone, the closing output) for `medium` and above.

## Steps

### 1. Review runs its earlier passes
- **URL:** `/claude-tweaks:review {N}` (Step 3 lens dispatch, then Steps 3.5/3.6 at higher tiers)
- **Action:** the lenses run first. Then come reproduction pairs (`medium`+), or one single-read agent per lens at `low`, followed by cross-lens corroboration, debate, refutation and the gap sweep as the tier allows. A finding only one agent reported, or that two lenses disagreed on, stays `unconfirmed` or `contested`. Its STAGED line in `decisions.md` names the lens and `{path}:{line}`.
- **Should feel:** unchanged from before. The earlier passes do the same work, and nothing is settled by the agent that reported it.
- **Should understand:**
  - A low-tier finding no longer counts as confirmed because the reviewer re-read it.
  - The reviewer no longer settles an `unconfirmed` finding by reading the source itself (a path retired in #3950). Every one goes on to Step 3.7 and gets an independent verdict.
- **Red flags:**
  - an unconfirmed finding is routed to a fix, or to the console, before Step 3.7 has run
  - one finding ends up with two verdict lines

### 2. The tiebreak judges each open finding
- **URL:** Step 3.7 (`plugin/skills/review/step3-tiebreak.md`)
- **Action:** the reviewer writes every still-open finding to `review-findings.json` (`review-coordination.js write-findings`). `review-coordination.js plan-chunks` then splits them into chunks of up to 8 findings that each hold one judge tier. An `info` finding takes a `[Use: Standard]` agent; every other severity, a null or unknown one included, takes a `[Use: Capable]` agent. The reviewer dispatches one agent per chunk, in waves of 8 chunk agents, taking each finding's id from `review-coordination.js finding-ids` on the chunk file (in a pipeline run and standalone alike).
  - Each agent sees only the diff scope and, per finding, its id, the claim, the severity and `path:line`. A contested finding also carries each side's one-line position.
  - The agent re-reads the live code and judges each finding on its own, replying `confirmed`, `refuted` or `cant-tell` in one `Id:`-headed block per finding, quoting the whole cited source line as evidence.
  - A dispatched reviewer that cannot dispatch reads each finding itself with the same template, and its verdict lines end ` Mode: inline.`.
- **Should feel:** independent. The tiebreak agent never sees the reporting agent's evidence or reasoning.
- **Should understand:**
  - Every reply goes through `resolve-tiebreak`, which checks the quoted line against the file. An unusable reply still yields a can't-tell verdict, so every finding gets a line.
  - A `standard` judge that raises a finding to `medium` or higher has not settled it. `resolve-tiebreak --tier standard` reports it as `escalated`, logs nothing, and the reviewer judges it again with one `[Use: Capable]` single-finding agent, whose verdict is the one logged. That re-judge's entry carries the raised severity as `severityFloor`. If the Capable agent settles no verdict (can't-tell, or a failed or unusable reply), the finding still lands at the raised severity, so it reaches the console and not the digest. A Capable confirm or refute settles on its own verdict. The re-judge is one judge attempt beyond the three below.
  - A vacuity claim (lens 3f) cannot be confirmed by reading. Only an executed run confirms it, so a `confirmed` reply on one counts as can't-tell.
  - A failed, empty, timed-out or non-`DONE` chunk agent is re-dispatched once as a fresh chunk agent, its valid blocks discarded. A dispatched reviewer skips that re-dispatch for a timed-out chunk agent, whose keep-alive bound is already spent, and reads each of its findings inline instead. A second failure sends each of its findings to one single-finding agent. A finding the reply left out, or answered twice, gets one single-finding agent after the chunk is settled. A finding gets at most three judge attempts, and a failed last attempt resolves can't-tell. A dispatched reviewer reads a finding inline instead of a single-finding agent after a failed chunk re-dispatch, and when it has no `Agent` tool or a single-finding agent fails, and names each inline verdict in a `Tiebreak caveat:` line.
- **Red flags:**
  - a finding is missing from the artifact
  - an agent prompt carries the reporter's evidence
  - every finding comes back can't-tell because dispatch failed and no fallback ran
  - an `info` finding a Standard judge raised to `medium` or higher ends in the digest because its Capable re-judge failed
  - a chunk holds an `info` finding together with a finding of any other severity

### 3. Read the outcome
- **URL:** the review summary's `### Tiebreak` section; `decisions.md`; the Wrap-Up Review Console (pipeline) or the closing output (standalone)
- **Action:** the developer reads the counts for confirmed, dropped, digest and console.
  - Confirmed findings appear in Step 3 Routing at the resolver's severity.
  - Can't-tell findings at `low`/`info` go to the digest with `Defer-reason: tiebreak-cant-tell`.
  - In a pipeline run, can't-tell findings at `medium` and above appear on the console as their own rows, with the tiebreak's severity and recommendation.
  - Standalone, they are listed in the closing output with the tiebreak's recommendation, and nothing is staged.
- **Should feel:** short. The console holds only what an independent reader could not settle, not every finding one agent happened to report.
- **Should understand:**
  - A verdict replaces the console item when the earlier STAGED line carries `lens "{lens}"` and `{path}:{line}`.
  - A staged review file that line names (`staged/review-contested-{N}.md`, for example) takes the verdict's outcome too, and does not linger on the console.
  - Two kinds of finding leave the console with no verdict line of their own. A finding a converged-positive cross-lens debate confirmed never reaches this step: the debate's `AUTO` line names each finding by `lens "{lens}"` and `{path}:{line}`. The partner in a contested pair, listed in the staged contested file's `## Positions` section, takes the verdict a tiebreak logged for the other position (`settle-every-review-finding-at-the-console-3949.md`).
  - The run cannot archive while a listed finding lacks a verdict line (`clear-an-archive-refusal-for-an-untiebroken-finding-3945.md`).
  - A finding has no verdict when its `resolve-tiebreak` call exits non-zero, or when its line never lands: the resolver's own append fails, and then `log-decision.js` fails twice. Standalone, it is listed as `no verdict (resolve-tiebreak exited {exit})`. In a pipeline run, the summary names it and the archive gate refuses the run.
- **Red flags:**
  - a can't-tell finding at `medium` or above appears in neither the console nor the closing output
  - a confirmed finding still shows as Low-confidence at the console
  - the compact clean-PASS summary hides a tiebreak caveat

## Origin
- Created during the build of #3947, the second step of the unconfirmed-findings tiebreak project. The first step, #3945, built the resolver, the findings artifact and the archive coverage check.
- Updated during the wrap-up of #4563: step 3 notes the two kinds of finding the console now settles with no verdict line of their own, a debate-confirmed finding and a contested pair's partner.
- Updated during the build of #5540: step 2 judges findings one agent per chunk of up to 8, settled by one `resolve-tiebreak` call per chunk, with the per-chunk then per-finding failure ladder.
- Updated during the build of #5541: step 2 plans chunks by judge tier, so `info` findings are judged at Standard and every other severity at Capable, with a raised finding judged again at Capable, whose entry carries the raised severity as a floor for a re-judge that settles nothing.
- Related journeys:
  - `clear-an-archive-refusal-for-an-untiebroken-finding-3945.md`: the archive side.
  - `settle-every-review-finding-at-the-console-3949.md`: what the Review Console then does with each can't-tell finding.
  - `keep-a-second-reader-in-a-dispatched-review-3078.md`: the dispatched-reviewer nesting this step reuses.
  - `drop-a-refuted-code-is-missing-claim-3329.md`: how a one-agent `unconfirmed` finding arises, and how a refuted absence claim is dropped before it reaches this step.
  - `trust-a-defect-several-review-lenses-flagged-3604.md`: the `medium`-tier pass that confirms some `unconfirmed` findings before this step.
