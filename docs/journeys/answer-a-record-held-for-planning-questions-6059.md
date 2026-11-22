---
files:
  - plugin/skills/specify/SKILL.md
  - plugin/skills/specify/planning-answer.md
  - plugin/skills/specify/planning.md
  - plugin/bin/planning-hold.js
  - plugin/bin/lib/issues/planning-hold.js
  - plugin/bin/plan-audit.js
  - plugin/skills/_shared/work-record.md
---

# Answer a Record Held for Planning Questions

**Persona:** A developer whose backlog record was held by `/claude-tweaks:specify`'s planning step (a headless shaping run, or someone who picked `Leave for later`), and who is now at the keyboard to answer what the planner could not settle alone.
**Goal:** Answer just the held questions and have the record finish at `ready`, its kept plan amended rather than rebuilt, without re-shaping the whole record.
**Entry point:** A record `#N` carrying `needs:decision` whose newest unresolved decision comment, from an owner, member or collaborator, carries `Held-by: specify-planning` and a held-questions block; its `Command:` reads `/claude-tweaks:specify #N`.
**Success state:** `#N` carries `ready`, no `needs:decision`, the hold comment starts `**Resolved:** answered via /claude-tweaks:specify`, `## Planning Decisions` holds one `Decided by the user at planning:` line per answer, and exactly one `Plan:` line whose hash matches the body. Or, after `Leave for later`, the answers already given are written and a fresh hold holds only the rest.

## Steps

### 1. Run the decision comment's command — slash command
- **URL:** `/claude-tweaks:specify #N`
- **Action:** Paste the `Command:` from the hold comment in an interactive session.
- **Should feel:** Like picking up a conversation the planner paused, not like re-shaping a record. No framing, ceremony or risk-flag pass runs.
- **Should understand:**
  - Case 1 reads the record's comments through `planning-hold.js`. Only a trusted, unresolved, newest `needs-decision: specify` comment with the `Held-by` line and a parseable block counts as a hold.
  - A comment that is untrusted, unparseable or ambiguous prints `#N's decision comment is not a usable planning hold ({reason}) — shaping it as before` and the record is shaped as it was before this change.
  - A headless run (`--chained`, a dispatch-bound or Routine run) refuses with `#N is held for planning question(s) — answer them with /claude-tweaks:specify #N where a human can reply`. A comma list naming a held record fails the whole batch.
- **Red flags:** A held record re-shaped from scratch. A hold comment from a non-member treated as a hold. A headless run blocking on a question.

### 2. Answer only the held questions — AskUserQuestion
- **URL:** one batch table (`Question`, `Recommended reading`) followed by `AskUserQuestion` calls
- **Action:** Pick a reading per question, or `Leave for later`.
- **Should feel:** Short. Only the questions the hold lists, recommended reading first, at most four per call. A question the body already answers is not asked again.
- **Should understand:**
  - Each answer becomes `Decided by the user at planning: {question} — chose {reading}; not {other reading}`.
  - `Leave for later` with nothing answered writes nothing at all. With some answered, those lines are written and a fresh hold posts the rest before the old hold is resolved, so the record stays held throughout.
- **Red flags:** A question not in the hold. A decided line written twice on a re-run. Answers lost after `Leave for later`.

### 3. Let the kept plan be amended — background
- **URL:** the planner dispatch and `plan-audit.js "{plan}" --surface-diff "{plan-before}" --spec "{body}"`
- **Action:** Wait while the stored plan is checked, amended with the answers, and audited.
- **Should feel:** Faster than planning from scratch. Plan review runs only when an answer actually moved the plan.
- **Should understand:**
  - `plan-store.js check` verifies the kept `Plan:` line against the held body first. A missing or stale plan is planned again with the decided lines binding it, and plan review then runs.
  - Review re-runs only when `surfaceDiff.changed` is true, meaning the plan's file list or an Acceptance Criterion's coverage status changed. The planner's own report never decides it.
- **Red flags:** Plan review running for an answer that changed nothing. A stale plan amended in place instead of re-planned.

### 4. Read the outcome — Actions Performed
- **URL:** the run's Actions Performed row and Next Actions
- **Action:** Read the record's row.
- **Should feel:** Unambiguous about what happened and what to do next.
- **Should understand:**
  - The writes run in order — plan stored, body written, hold comment resolved, `needs:decision` removed, `ready` stamped — and stop at the first failure with the record still held.
  - `answered — {k} planning question(s), ready (Plan: …)` recommends `/claude-tweaks:flow #N`.
  - When another unit's decision comment is still open, `needs:decision` stays and no `ready` is stamped. Next Actions names that comment for its owner and recommends neither `/specify` nor `/flow`, because a re-run would resolve it unanswered.
  - A failure before the hold comment is resolved says to re-run `/claude-tweaks:specify #N`. A failure after it points at checking the decision comments and removing `needs:decision` by hand.
- **Red flags:** `ready` stamped while another unit's decision is open. A re-run recommended after the hold was already resolved. Two `Plan:` lines.

## Origin

Built for record #6059 (answering a planning-held record with an interactive `/claude-tweaks:specify`). It finishes the hold written by #6056 (`plan-a-record-while-shaping-it-6056.md`, step 5) and uses the plan store from #6052 (`store-a-reviewed-plan-beside-its-record-6052.md`).
