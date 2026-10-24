---
files:
  - plugin/skills/specify/red-team.md
  - plugin/skills/review/step3-lens-dispatch.md
---

# State Every Failure Branch of a Fail-Closed Guard

**Persona:** A maintainer shaping or reviewing a record whose deliverable is a guard written in skill prose that must fail closed. Examples: "never arm unless every record carries `demo:pending`", or "hold when the verify stamp is missing". The rule's text reads correctly, but its behaviour on an empty, unreadable or malformed input has never been written down.
**Goal:** The guard's failure branches are stated before anyone builds or merges it. That covers an empty input set, an unreadable source and a malformed value. A fail-open edge should surface as a spec question, not as a fix wave after review.
**Entry point:** `/claude-tweaks:specify` reaching Step 5's multi-persona red-team for a sub-issue record. At review time, `/claude-tweaks:review`'s lens 3c (Error Handling) reading the built diff.
**Success state:** At shaping time, every missing class lands as a `critical` `Fail-Closed Guard Check` finding in the record's `## Open Questions`, and is staged or asked per the write-back. At review time, lens 3c asks whether an `every`/`all` quantifier holds over an empty set and whether a failed read is a hold.

## Steps

### 1. The red-team pass detects a fail-closed guard before the personas run
- **URL:** N/A (skill step: `/specify` Step 5, `specify/red-team.md`'s "Fail-closed guard detection" section)
- **Action:** After the path/URI guard scan and the Cross-AC literal check, the red-team scans the sub-issue's composed Acceptance Criteria and Deliverables. It looks for a prose rule that holds, stops or refuses unless a condition is met.
- **Should feel:** Invisible on a record with no such guard. No finding, no prompt, nothing added.
- **Should understand:** The trigger is a rule whose job is to fail closed. A record that only mentions a check does not fire it.
- **Red flags:** A `Fail-Closed Guard Check` finding on a record that contains no hold/stop/refuse rule.

### 2. Each of the three input classes is checked for a stated outcome
- **URL:** N/A
- **Action:** For a detected guard, the check confirms the record states the outcome for each of three classes. **Empty input set:** an `every`/`all` condition over zero items is vacuously true. **Unreadable source:** a failed label, comment, file or API read. **Malformed value:** present but unparseable or out of shape, including an undefined placeholder.
- **Should feel:** Precise. It names the exact class that is missing, not a generic "handle edge cases".
- **Should understand:** An unreadable source must hold, never pass. An empty set's answer is a decision the record has to make explicitly.
- **Red flags:** A guard reaching `ready` whose `every` clause says nothing about zero items.

### 3. A missing class lands as an Open Questions row and is staged or asked
- **URL:** N/A (the sub-issue's GitHub body, `## Open Questions` table)
- **Action:** Each missing class becomes a `critical` finding (persona column `Fail-Closed Guard Check`) that flows through the red-team write-back. It adds a branch to the guard's test list, so it is decision-worthy: staged for the Review Console in auto mode, or asked in interactive mode.
- **Should feel:** Like a cheap catch. One row now, instead of #3877's review fix wave and six added pins.
- **Should understand:** Resolving the row means writing the branch into the AC, and therefore into the plan's test list.
- **Red flags:** A missing class silently dropped, or resolved without a human ruling.

### 4. Review's lens 3c asks the same question of the built guard
- **URL:** N/A (skill step: `/review` Step 3, `review/step3-lens-dispatch.md` lens 3c)
- **Action:** The Error Handling lens asks of any fail-closed prose guard in the diff whether an `every`/`all` quantifier still holds over an empty set, and whether a failed read is a hold rather than a pass.
- **Should feel:** Like a backstop for guards that entered without passing through `/specify`'s red-team.
- **Should understand:** The shaping-time step and this lens question are paired. The lens cites the red-team step rather than restating its list.
- **Red flags:** A guard whose empty-set case passes reaching merge with no lens 3c finding.

## Origin
- Created during build of #3965 (fail-closed guard failure-branch checks in `/specify`'s red-team and `/review`'s lens 3c)
- Motivating incident: #3877, whose tidy `## Arm ready PR` guard pinned only that its rule text existed and needed a review fix wave for its empty-set, failed-read and undefined-placeholder edges
