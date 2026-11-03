---
files:
  - plugin/skills/specify/spec-template.md
  - plugin/skills/build/plan-review.md
---

# Close a State List Before Plan Review

**Persona:** A maintainer running `/claude-tweaks:specify` on a record whose deliverable sorts inputs into named states: an eligibility verdict, a refusal ladder or a status classifier. Later, the `/claude-tweaks:build` plan review reads the same spec.
**Goal:** Write a state list that plan review can finish, so the build does not stop once for every state the list never named.
**Entry point:** writing the `## Deliverables` section of such a record. The guidance sits in `spec-template.md`'s `## State-Classification Deliverables` section.
**Success state:** The state list has a **Closed rule** bullet beside it, stating all three parts. When plan review finds a state the list does not name, it amends the plan with that state's refusal line and the build goes on, with no `plan-review-needs-human` stop.

## Steps

### 1. Recognize a state-classification deliverable
- **URL:** the record's `## Deliverables`, while shaping it against `spec-template.md`.
- **Action:** Notice that a deliverable lists the states that make an input eligible, refused or classified one way or another, for example the claim, label, worktree, PR and run-directory states that make a stalled build resumable.
- **Should feel:** Like spotting an open list before anyone has to close it under pressure.
- **Should understand:**
  - A list of eligible states says nothing about the states it leaves out.
  - Plan review classifies a gap as `needs-human` when settling it would alter an observable contract or has two defensible readings. Every unlisted state fits that test.
- **Red flags:**
  - A state list with no sentence about what happens to a state not on it.

### 2. Write the Closed rule beside the list
- **URL:** `spec-template.md`'s `## State-Classification Deliverables`.
- **Action:** Add a **Closed rule** bullet next to the state list with its three parts: the listed states are exhaustive; an unlisted state is refused with one line naming the state and its remedy; and a plan review that finds another unlisted state applies the rule as a plan amendment, never as a `needs-human` gap.
- **Should feel:** Short and final. One bullet answers every state nobody thought of yet.
- **Should understand:**
  - #4588's eligibility verdict had no such rule. Its build stopped four times on the `plan-review-needs-human` HARD-GATE, each stop a human answer, a re-materialized spec, a plan amendment and a fresh review.
  - Once the fourth answer set added the Closed rule, the next review pass applied it to a newly found state and the build proceeded.
- **Red flags:**
  - A Closed rule missing one of its three parts, such as a refusal with no remedy named.
  - Enumerating more states instead of closing the list. The next review pass finds another one.

### 3. See plan review amend instead of escalating
- **URL:** `/claude-tweaks:build` Common Step 1.6 (`build/plan-review.md`).
- **Action:** When the plan reviewer reports a state the spec does not list, the spec's Closed rule settles it: the plan gains that state's refusal line, and no needs-human question goes back to the record.
- **Should feel:** Like the review doing its job without waiting on a person.
- **Should understand:**
  - The rule pre-empts the needs-human classification by deciding the question in the spec itself, before review asks it.
- **Red flags:**
  - A `plan-review-needs-human` stop whose open question is "what happens to state X", on a spec that names a state list.

## Origin
- Created during build of #4727, a reflect-full finding from #4588's run `2026-10-30T200217-spec-4588`.
- Pinned by `tests/specify-closed-rule.test.js`.
- Related: `prove-an-absence-grep-can-match-3571.md` and `catch-mutually-unsatisfiable-acceptance-criteria-3463.md`, other spec-authoring checks in `spec-template.md`.
