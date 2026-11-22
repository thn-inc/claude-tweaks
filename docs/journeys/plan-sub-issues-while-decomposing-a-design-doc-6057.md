---
files:
  - plugin/skills/specify/planning.md
  - plugin/skills/specify/decomposition-mode-closeout.md
  - plugin/skills/specify/mechanical-handoff.md
  - plugin/skills/specify/SKILL.md
  - plugin/skills/_shared/policy-schema.md
---

# Plan Each Sub-Issue While Decomposing a Design Doc

**Persona:** A developer decomposing a design doc into sub-issues with `/claude-tweaks:specify`, in a project that runs `plan-at-specify: on` so every record reaches the backlog already planned. They want the plan reviewer's questions asked once, for all the sub-issues together, while they are still at the keyboard.
**Goal:** Decompose one design doc and have each created sub-issue (never the parent) carry a reviewed, stored plan, or be visibly held, or be skipped with a stated reason. No planning question should ever be asked inside the delegated mechanical-handoff subagent.
**Entry point:** `.claude-tweaks/policy.yml` with `plan-at-specify: on` and `planning-decisions: asked-classes`, and a design doc at `docs/superpowers/specs/{date}-{topic}-design.md`.
**Success state:** Step 9's summary carries a `### Planning` table with one row per created non-parent sub-issue, each `planned`, `held`, `skipped` or `no-ref` with its Detail. Planned sub-issues carry exactly one `Plan:` line. Held ones carry `needs:decision` and a `Held-by: specify-planning` comment. The parent carries no row and no plan.

## Steps

### 1. Decompose with the gate on — slash command
- **URL:** `/claude-tweaks:specify docs/superpowers/specs/{date}-{topic}-design.md`
- **Action:** Run decomposition mode as usual and answer its interactive steps (overlap, decomposition, collapse, design pre-steps).
- **Should feel:** Like an ordinary decomposition up to Step 6. Nothing about planning shows before the sub-issues exist, their bodies are linked, and red-team and self-review are done.
- **Should understand:**
  - Planning runs after Step 6, in specify's own session, through `planning.md`'s `## Decomposition` entry. With the key `off` (or any other output, or a failed resolve), decomposition runs exactly as before.
  - Each sub-issue's body is fetched from the forge again before planning, so Step 5's red-team edits are what the planner and reviewer read.
  - A sub-issue Step 3 resumed rather than created is not planned this pass. The origin record a 1-unit collapse shapes in place counts as created.
- **Red flags:** A planning question before Step 6. A plan made from a body that still lacks the red-team edits. A parent record planned or listed in the table.

### 2. Answer one batch of questions — AskUserQuestion
- **URL:** one batch table (`Record`, `Finding`, `Class`, `Recommended reading`) covering every sub-issue, followed by `AskUserQuestion` calls
- **Action:** Pick a reading per question, or `Leave for later`.
- **Should feel:** Like one sitting for the whole decomposition. Planners and reviewers run in parallel, and the questions from every sub-issue arrive together, at most four per call, with the recommended reading first.
- **Should understand:**
  - `Leave for later` holds only that sub-issue. A held sibling does not hold the sub-issues that depend on it.
  - With no human reachable (`/sweep`'s specify drain, a Routine), nothing is asked and every asked row holds.
- **Red flags:** One question round per sub-issue instead of one batch. A held sub-issue holding its dependents. A headless run waiting on an answer.

### 3. Delegate the mechanical range — subagent
- **URL:** `mechanical-handoff.md`'s dispatch, when the main thread hands Steps 3-9 to a subagent
- **Action:** Let the subagent create, link, red-team and self-review the sub-issues, then return its Step 9 summary.
- **Should feel:** Identical to step 1 from your side. The subagent never plans and never asks a planning question. Planning happens after it returns, in the main session.
- **Should understand:**
  - Under `on`, the subagent's prompt tells it that planning is not its job and asks for one `Resumed: #a, #b` (or `Resumed: none`) line after its summary. The caller plans the Work Units Created refs minus those.
  - A reply with no `Resumed:` line plans nothing. A `NEEDS_CONTEXT` or `BLOCKED` return plans nothing either: each created sub-issue gets a `skipped` row with Detail `handoff {status}`, because its body may not have reached Step 6.
  - The appended `### Planning` section opens with "Planned in specify's own session after the handoff returned; the handoff planned nothing."
- **Red flags:** A planning question inside the subagent. Resumed sub-issues planned. A non-DONE handoff whose sub-issues get plans anyway.

### 4. Read the Planning table — Step 9 summary
- **URL:** the decomposition run's Step 9 summary, `### Planning` section
- **Action:** Read each sub-issue's row.
- **Should feel:** Unambiguous. Every created non-parent sub-issue has exactly one row saying what happened and why.
- **Should understand:**
  - `planned`: a `Plan:` line was stored, or a valid one was kept.
  - `held`: an asked-class question is unanswered, so the sub-issue lost `ready` and gained `needs:decision` (the label edit is a separate call after the body write).
  - `skipped`: a plan-less lane took it (`{lane} lane ({reason})`), planning failed (`planning failed: {reason}`), or a write, shape check or read-back failed. A skipped sub-issue's body is written only to remove a stale `Plan:` line.
  - `no-ref`: `plan-store.js` reported no ref, so the decisions are kept with no `Plan:` line.
  - A held sub-issue whose body write, label call or comment post fails shows `## Hold`'s `failed — …; re-run /claude-tweaks:specify #{n}` row, so its questions come back on the re-run.
  - Planning never adds `ready`. A sub-issue Step 5 left without it (a staged red-team finding) is still planned but stays without `ready`.
- **Red flags:** A created sub-issue with no row. A `ready` sub-issue with an unanswered planning question. A held sub-issue listed in a `/claude-tweaks:flow` Next Actions line.

### 5. Pick the next step — Next Actions
- **URL:** the run's `## Next Actions`
- **Action:** Run the recommended line.
- **Should feel:** Like the run already knows which records can build. Held sub-issues are left out of every `/claude-tweaks:flow` command.
- **Should understand:** When every planned sub-issue is held, the recommended line is `/claude-tweaks:specify #{n}` for the first held one. Re-shaping it asks its held questions again, as `plan-a-record-while-shaping-it-6056.md`'s step 5 describes.
- **Red flags:** A `/claude-tweaks:flow` line naming a `needs:decision` sub-issue.

## Origin

Built for record #6057 (planning each sub-issue in `/claude-tweaks:specify`'s decomposition mode after self-review, under `plan-at-specify`). It extends #6056's shaping-mode planning (`plan-a-record-while-shaping-it-6056.md`), which owns the gate, the planner and reviewer dispatch, and the hold this journey reuses.
