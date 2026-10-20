---
files:
  - plugin/skills/_shared/try-it.md
  - plugin/skills/wrap-up/verification-brief.md
  - plugin/skills/wrap-up/verification-brief-parent-gate.md
  - plugin/skills/flow/summary-template.md
  - plugin/skills/flow/multispec-summary.md
  - plugin/skills/_shared/pr-run-comments.md
---

# Try What a Finished Run Built

**Persona:** A maintainer who just watched a `/claude-tweaks:flow` run (or a multi-spec bundle) merge, and now wants to open the feature and check it does what they asked — without asking the agent in chat "what did we actually complete, and how do I use it?".
**Goal:** Find, in the run's own closing output, where to go, what to do, and what to expect for each feature delivered — even when the record was low-risk and got no sign-off ceremony.
**Entry point:** The end of a successful `/claude-tweaks:flow #N` (or `#N,#M`) run in the terminal, or the run's PR on GitHub.
**Success state:** The maintainer has opened the entry point, followed the steps, and seen the expected result for every delivered feature, using only text the pipeline wrote. They never had to read the diff or ask the agent how to try it.

## Steps

### 1. Read the Pipeline Summary's Try it section — end of `/claude-tweaks:flow`
- **URL:** the terminal output of `/claude-tweaks:flow #N`, section `### Try it` (between the Step/Outcome table and `### Timing`)
- **Action:** Read one bold-named group per delivered feature: Precondition, Access, Entry point, Steps, Expected. A bundle shows one `#### Spec {N}: {title}` group per spec, in run order, then `### Try it — end to end` walking the path across them. When the run closed a decomposition parent's last open sub-issue, the parent's own end-to-end walkthrough (across its whole sub-issue set) follows too: as its own `### Try it — end to end` section after a single spec's block, or under `#### Parent #{P}` inside a bundle's end-to-end section.
- **Should feel:** Like a handoff note from a colleague: concrete, runnable, human. It is the first thing in the summary that talks about the feature rather than about gates and commits.
- **Should understand:** The section is mandatory, and the oversight floor never gates it. A below-floor record (`risk`/`size` under `risk-floor`/`size-floor`) still gets it, even though it gets no `demo:pending` label and no sign-off ceremony. The text is the block wrap-up composed for the record (`_shared/try-it.md`), read back from the session file `try-it-{N}.md`, not re-invented at summary time.
- **Red flags:** The section missing, or empty, on any successful run. Placeholder text (`TBD`, an unfilled `{...}`, "see the PR"). Agent procedure where human steps belong (`playwright-cli`, Prepare/Validate, a test command offered as the Expected result). A backend or infra record left with no block because it had no green QA stories; it should be built from the ACs and an entry-point command instead. A parent's end-to-end walkthrough folded into the spec's own group instead of rendering as its own section.

### 2. Find the same walkthrough on the PR — the run's GitHub PR
- **URL:** the run's PR (`gh pr view {n} --comments`), comment starting `<!-- run-comment: try-it -->` (`try-it:{N}` per spec in a bundle), or the `## Verification Brief` comment's `### Try it` section (`<!-- run-comment: brief:{N} -->` per spec in a bundle, else `<!-- run-comment: brief -->`)
- **Action:** Open the PR after the session has ended (or from another machine) and read the walkthrough there. An above-floor record with no parent carries it inside its Verification Brief, between `### What shipped` and `### Confirmed`. A below-floor record, or any sub-issue of a decomposed parent, carries it as its own `try-it` comment.
- **Should feel:** Durable. The walkthrough outlives the terminal session, and it is the identical text the summary showed.
- **Should understand:** A run with no PR (`local-merge`, or a degraded `pr-first` run) posts nothing, and its Pipeline Summary is the only place the walkthrough appears. A below-floor record never gets a comment on the issue: the floor still means no ceremony there. When a run closes its parent's last open sub-issue, the parent's end-to-end walkthrough is appended to the sub-issue's `try-it` comment. If the parent cleared the floor, the parent's own Verification Brief also carries it as `### Try it — end to end`.
- **Red flags:** Two specs in one bundle overwriting each other's `try-it` comment (each must carry its own `try-it:{N}` marker), or a bundled spec's demo reading a sibling's `brief:{M}` Try it section. A `try-it` comment showing different steps from the summary. A failed PR post re-routed onto the issue.

### 3. Re-open it days later — `/claude-tweaks:demo #N`
- **URL:** `/claude-tweaks:demo #N`
- **Action:** Run demo on the record; the Try it block renders before anything else. See `accept-built-work-via-demo.md` for the walkthrough and verdict that follow.
- **Should feel:** Like the same note, found again, with nothing new to learn.
- **Should understand:** Under `pr-first`, demo reads the walkthrough back from the PR: either through the issue's `Verification Brief posted to PR #…` pointer, or for a below-floor record through the PR that closed it. It composes a fresh block from the record's ACs only when no posted block can be found. Only a comment from an owner, member or collaborator counts as posted. A stranger's lookalike is skipped and named in one line (`ignore-a-planted-marker-comment-3358.md`).
- **Red flags:** Demo composing a different walkthrough while the PR still carries one. A walkthrough shown twice (once first, again inside the rendered brief).

## Origin
- Created during build of #2821 (a finished feature run never tells the human how to use or verify what was built)
- Steps 1-3 built in this session
- Related specs: #2821, #367 (the oversight floor whose gating this narrows to the label and ceremony)
- Step 3 updated during build of #3358 (demo reads back only trusted-author comments)
- Step 2 updated during build of #3333 (the brief comment's Try it section is read from the spec's own `brief:{N}` first in a bundle)
