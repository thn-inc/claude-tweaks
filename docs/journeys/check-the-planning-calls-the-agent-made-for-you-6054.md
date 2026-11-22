---
files:
  - plugin/bin/lib/wrap-up/packet-gather.js
  - plugin/bin/acceptance-packet.js
  - plugin/bin/lib/run-header.js
  - plugin/skills/_shared/acceptance-packet.md
  - plugin/skills/_shared/planning-decisions.md
  - plugin/skills/wrap-up/verification-brief.md
---

# Check the Planning Calls the Agent Made for You

**Persona:** the claude-tweaks maintainer who set `planning-decisions: asked-classes`, so plan review asks them only design-level, hard-to-undo or contradictory questions and settles every detail question itself. They accept that trade only if they can see each call the agent made, once, when they accept the work. A second persona is the wrap-up agent that gathers and narrates the acceptance packet.
**Goal:** every detail question the agent settled at planning, at specify time or build time, shows up in the acceptance packet's Least confident section, so the maintainer checks each one when accepting the work.
**Entry point:** a run whose materialized spec, `{run-dir}/work/{n}-spec.md`, carries one or more `## Planning Decisions` sections holding `Settled at planning: {finding} — chose {reading}; not {other reading}` lines, reaching `/claude-tweaks:wrap-up`'s acceptance packet step.
**Success state:** the packet's Least confident section lists one item per `Settled at planning:` line, after the Review Console's low-confidence items. A run with no such lines gets a packet byte-identical to before.

## Steps

### 1. (Wrap-up agent) Gather the packet facts
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/acceptance-packet.js" gather --record {N} --out "{FACTS}" --run "{run-dir}" --spec "{spec}" …`
- **Action:** **Wrap-up agent** runs gather as `wrap-up/verification-brief.md` Step 4 composes it. The gather reads the Review Console's low-confidence items, then reads the covered record's materialized spec through `readSpec(n)`: the run dir's `work/{n}-spec.md` (live or archived, flat or under `spec-{n}/`), or, when that is absent, the `--spec` file. Every `Settled at planning:` line inside a `## Planning Decisions` section becomes one `finding` fact, numbered on from the console items.
- **Should feel:** automatic. The agent passes nothing new; the `--run` and `--spec` it already passes carry the lines.
- **Should understand:**
  - Each section ends at the next `## ` heading; every section is read, so specify's lines and a build's lines are both listed.
  - Only a column-0 line, bare or behind `- `, counts; a line inside a code fence or outside the section does not. `Decided by the user at planning:` lines are never listed, because the maintainer already made those calls.
  - A settled fact carries `source: planning-decisions`; a console finding keeps `source: review`.
  - In worktree mode the run dir under the main checkout has no `work/` until merge, so the `--spec` file (which the brief resolves to the worktree's copy first) is what supplies the lines.
  - A missing or unreadable spec lists nothing and adds no partial note. Unreadable console findings still list the settled lines, with the `review findings not read` partial note.
- **Red flags:**
  - a spec with settled lines and a facts file with no matching `finding` facts
  - a `Decided by the user at planning:` line listed as a finding
  - finding numbers restarting at 1 after the console items

### 2. (Wrap-up agent) Narrate one claim per finding
- **URL:** the `{NARRATIVE}` file `acceptance-packet.js render` validates
- **Action:** **Wrap-up agent** writes one `least-confident` claim per `finding` fact, citing its fact id, as the brief's Narrate step already requires for console findings.
- **Should feel:** no new rule. A planning call is one more finding.
- **Should understand:** claim and fact text render through the packet's untrusted-content screens, so markdown in a line (a link, a mention, a leading `#`) cannot forge structure or notify anyone.
- **Red flags:**
  - a `finding` fact no claim cites, so its planning call never reaches the packet
  - a live link or `@mention` rendered from a settled line

### 3. (Maintainer) Check the calls at acceptance
- **URL:** the acceptance packet comment on the record, opened through `/claude-tweaks:accept #{N}`
- **Action:** **Maintainer** reads Least confident: the review's low-confidence findings first, then each `Settled at planning:` line with the reading the agent chose and the one it did not. They accept, or overturn a call as an ordinary change at `/accept`.
- **Should feel:** one complete list. No planning call hides in a spec file the maintainer would have to open.
- **Should understand:** the packet only shows these calls. Overturning one is a normal change request, not an action inside the packet.
- **Red flags:**
  - a packet whose Least confident says `not applicable: no low-confidence review findings` while the spec holds settled lines
  - the same settled line listed twice

## Origin
- Created during the build of #6054 (run `2026-11-22T171233-spec-6054`): `settledPlanningLines` and the `{ records, readSpec }` parameter of `lowConfidenceFindings` in `lib/wrap-up/packet-gather.js`, the `readSpec` seam in `acceptance-packet.js`'s `readLowConfidence`, `_shared/acceptance-packet.md`'s Least confident line, and the `--run`/`--spec` clauses in `wrap-up/verification-brief.md`.
- Updated at the wrap-up of #6054: `files:` gains `plugin/bin/lib/run-header.js`, since review's fix wave made `readSpec` take every spec location `headerFileCandidates` resolves (flat or `spec-{n}/`, live or archived), the locations Step 1 names.
- Related journeys: `answer-a-plan-review-question-3377.md` covers the questions plan review still asks. `carry-undecidable-console-items-into-the-acceptance-packet-4620.md` covers the packet's Decisions left for you section. `accept-built-work-via-demo.md` covers the acceptance verdict itself.
