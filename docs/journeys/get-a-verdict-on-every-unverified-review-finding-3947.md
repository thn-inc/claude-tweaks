---
files:
  - plugin/skills/review/step3-tiebreak.md
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/review/step3-lens-dispatch.md
  - plugin/skills/review/step3-debate-and-refutation.md
  - plugin/skills/review/step3-routing.md
  - plugin/skills/review/review-summary-template.md
  - plugin/bin/review-coordination.js
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
  - The Direct-verification override still exists. It writes a verdict line only when it confirms or drops a finding, and anything it can't settle goes on to Step 3.7.
- **Red flags:**
  - an unconfirmed finding is routed to a fix, or to the console, before Step 3.7 has run
  - one finding ends up with two verdict lines

### 2. The tiebreak judges each open finding
- **URL:** Step 3.7 (`plugin/skills/review/step3-tiebreak.md`)
- **Action:** the reviewer writes every still-open finding to `review-findings.json` (`review-coordination.js write-findings`). It then dispatches one `[Use: Capable]` agent per finding, in waves of 8.
  - Each agent sees only the claim, the severity, `path:line` and the diff scope. A contested finding also carries each side's one-line position.
  - The agent re-reads the live code and replies `confirmed`, `refuted` or `cant-tell`, quoting the whole cited source line as evidence.
  - A dispatched reviewer that cannot dispatch reads each finding itself with the same template, and its verdict lines end ` Mode: inline.`.
- **Should feel:** independent. The tiebreak agent never sees the reporting agent's evidence or reasoning.
- **Should understand:**
  - Every reply goes through `resolve-tiebreak`, which checks the quoted line against the file. An unusable reply still yields a can't-tell verdict, so every finding gets a line.
  - A vacuity claim (lens 3f) cannot be confirmed by reading. Only an executed run confirms it, so a `confirmed` reply on one counts as can't-tell.
  - A failed, empty, timed-out or non-`DONE` agent is re-dispatched once as a fresh agent, and only a second failure resolves can't-tell. A dispatched reviewer skips that re-dispatch for a timed-out agent, whose keep-alive bound is already spent, and reads the finding inline instead. It also reads inline when it has no `Agent` tool or the re-dispatch fails, and names each inline verdict in a `Tiebreak caveat:` line.
- **Red flags:**
  - a finding is missing from the artifact
  - an agent prompt carries the reporter's evidence
  - every finding comes back can't-tell because dispatch failed and no fallback ran

### 3. Read the outcome
- **URL:** the review summary's `### Tiebreak` section; `decisions.md`; the Wrap-Up Review Console (pipeline) or the closing output (standalone)
- **Action:** the developer reads the counts for confirmed, dropped, digest and console.
  - Confirmed findings appear in Step 3 Routing at the resolver's severity.
  - Can't-tell findings at `low`/`info` go to the digest with `Defer-reason: tiebreak-cant-tell`.
  - In a pipeline run, can't-tell findings at `medium` and above stay on the console through their earlier STAGED line.
  - Standalone, they are listed in the closing output with the tiebreak's recommendation, and nothing is staged.
- **Should feel:** short. The console holds only what an independent reader could not settle, not every finding one agent happened to report.
- **Should understand:**
  - A `confirmed` verdict replaces the console item when the earlier STAGED line carries `lens "{lens}"` and `{path}:{line}`.
  - A contested finding's `staged/review-contested-{N}.md` still shows until the console sub-issue lands.
  - The run cannot archive while a listed finding lacks a verdict line (`clear-an-archive-refusal-for-an-untiebroken-finding-3945.md`).
  - A finding has no verdict when its `resolve-tiebreak` call exits non-zero, or when `log-decision.js` fails twice to write its line. Standalone, it is listed as `no verdict (resolve-tiebreak exited {exit})`. In a pipeline run, the summary names it and the archive gate refuses the run.
- **Red flags:**
  - a can't-tell finding at `medium` or above appears in neither the console nor the closing output
  - a confirmed finding still shows as Low-confidence at the console
  - the compact clean-PASS summary hides a tiebreak caveat

## Origin
- Created during the build of #3947, the second step of the unconfirmed-findings tiebreak project. The first step, #3945, built the resolver, the findings artifact and the archive coverage check.
- Related journeys:
  - `clear-an-archive-refusal-for-an-untiebroken-finding-3945.md`: the archive side.
  - `keep-a-second-reader-in-a-dispatched-review-3078.md`: the dispatched-reviewer nesting this step reuses.
  - `drop-a-refuted-code-is-missing-claim-3329.md`: how a one-agent `unconfirmed` finding arises, and how a refuted absence claim is dropped before it reaches this step.
  - `trust-a-defect-several-review-lenses-flagged-3604.md`: the `medium`-tier pass that confirms some `unconfirmed` findings before this step.
