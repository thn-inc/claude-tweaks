---
files:
  - plugin/skills/build/plan-review.md
  - plugin/skills/build/SKILL.md
  - plugin/skills/dispatch/settle-and-merge.md
  - plugin/skills/dispatch/reporting.md
  - plugin/skills/_shared/auto-mode-contract.md
---

# Answer a Plan-Review Question Before the Build Starts

**Persona:** claude-tweaks user building a spec-shaped record — typing `/claude-tweaks:flow #{n}` themselves, typing `/claude-tweaks:dispatch #{n}`, or finding a record a scheduled dispatch drain left `bot:blocked`.
**Goal:** When the plan review before Task 1 finds that the spec leaves a decision undecided, make that decision once, in the place the build will read it, so the build proceeds (or resumes) on the answer instead of guessing.
**Entry point:** A Spec Mode `/claude-tweaks:build` reaching Common Step 1.6, after the plan audit and before any implementer is dispatched.
**Success state:** Either the review amends the in-run spec or plan on its own and the build continues with no question asked, or the human sees each undecided question with its two readings, picks one (or stops), and the answer lands in the spec the later phases judge against — with the record's own history carrying it.

## Steps

### 1. Let the review run — terminal
- **URL:** the `/claude-tweaks:flow` or `/claude-tweaks:build` output, between the plan audit and the first task
- **Action:** Nothing. One Capable reviewer reads the materialized spec and the plan once and returns spec-gap, undecided-behaviour and cross-task-contract findings.
- **Should feel:** Brief and mostly invisible — a clean review or a spec-backed amendment costs the user no interaction.
- **Should understand:**
  - A gap the spec's own text settles is fixed by an additive `## Plan Review Clarifications` section in the in-run spec and posted once as a comment on the record; the record body is never edited and nothing is staged.
  - Undecided-behaviour and cross-task findings amend the plan; the plan audit re-runs once and the review itself never repeats.
  - A `fast-lane` record or a trivial plan skips the step (roster tag `plan-review`), with a `SKIP` line in the run's `decisions.md`.
- **Red flags:**
  - An existing Acceptance Criterion edited or loosened by the review.
  - A reviewer reply that could not be read being treated as "No findings."
  - The review running a second time after its own amendments.

### 2. Answer the question in the session — terminal
- **URL:** an `AskUserQuestion` prompt headed `Plan review`, in any mode including `auto`
- **Action:** For each question, pick `Reading A`, `Reading B`, or `Stop the build`.
- **Should feel:** Like a decision only the user can make, asked once, before any code exists — not a mid-build interruption over something the spec already said.
- **Should understand:** The pick becomes a clarification attributed `Decided by the user at plan review:` in the in-run spec and in one record comment; the build then continues. `Stop the build` ends the run with the HARD-GATE `plan-review-needs-human`, and the failure card offers the claim release rather than taking it.
- **Should understand:** A `parallel`-wave member of a multi-spec `/claude-tweaks:flow` run gets no prompt — it runs inside a subagent that cannot ask. It posts the same `<!-- plan-review-question -->` comment as step 3 and stops with `plan-review-needs-human`; the orchestrating `/flow` shows that stop on its failure card, and the answer goes on the record body as in step 3.
- **Red flags:** A question whose two readings are not both defensible; one prompt per finding instead of one batched prompt; the claim released without the card offering it.

### 3. Answer on the record after a dispatched stop — GitHub issue
- **URL:** the record's `<!-- plan-review-question -->` comment, linked from the dispatch report block
- **Action:** Read each question and its two readings, then edit the record's **body** to state the decision.
- **Should feel:** Self-contained — the comment carries the finding, its evidence and both readings, so the answer needs no access to the build's worktree.
- **Should understand:**
  - A dispatched build runs in a subagent that cannot ask, so it posts the question, stops before Task 1, and the dispatching session relays it; Settle releases the claim without counting a retry and the draft PR stays open.
  - The question also rides in the build's `BLOCKED` reply, so a failed comment post or label write still reaches the dispatch report — flagged there as a concern, never dropped.
  - The next build materializes the record body, not its comments — an answer left only as a comment does not reach it.
  - A headless (Routine-fired) stop also adds `bot:blocked` and removes the record's `auto:*` grants; a human-typed dispatch keeps `auto:build`, so a later drain can re-pick the record until it is answered.
- **Red flags:** The draft PR closed as a failure tombstone; an attempt counted against `dispatch-retry-ceiling`; a stop whose question appears nowhere on the record.

### 4. Resume the build — terminal
- **URL:** `/claude-tweaks:backlog refine` (only when the stop was headless), then `/claude-tweaks:dispatch #{n}`
- **Action:** Re-grant `auto:build` if the headless stop removed it, then dispatch the record again.
- **Should feel:** Like continuing, not starting over — the answered body is the new spec.
- **Should understand:** The resumed build re-materializes from the answered body; the earlier run's local worktree was removed by dispatch's ordinary first-call-failure teardown, and nothing from it is needed.
- **Red flags:** The resumed run asking the same question again after the body answered it; a `bot:blocked` record re-dispatched without the question being answered first.

## Origin
- Created during build of #3377, part of the "Build dispatch cost shape" decomposition (origin #3229) — in a measured 10-task build, 3 of the 5 Important final-review findings were spec or plan gaps found only after all the code was written.
- Pinned by `tests/build-plan-review-conformance.test.js`, `tests/plan-review-hard-gate-conformance.test.js` and `tests/plan-review-dispatch-relay-conformance.test.js`.
- Related: `merge-small-adjacent-tasks-at-plan-time-3379.md` and `add-a-fast-lane-skip-to-the-roster-1926.md`, other plan-time steps of the same build.
