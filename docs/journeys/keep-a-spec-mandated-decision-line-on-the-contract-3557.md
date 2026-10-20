---
files:
  - plugin/skills/specify/shaping-mode.md
  - plugin/skills/specify/record-creation-subissues.md
  - plugin/skills/build/dispatch.md
  - plugin/skills/build/architecture-alignment.md
  - plugin/skills/_shared/auto-decision-log.md
---

# Keep a Spec-Mandated Decision Line on the Contract

**Persona:** A claude-tweaks maintainer whose record's spec quotes the exact `decisions.md` line a skill must log, for example "log `STAGED … dispatched anyway`". They shape it with `/claude-tweaks:specify` and later build it with `/claude-tweaks:flow`, and they rely on the agents to honour `_shared/auto-decision-log.md`'s Status semantics even where the spec's own wording gets it wrong.
**Goal:** A spec-mandated decision line uses the status word the contract requires, and is never kept wrong because "the spec spelled it out". This must hold without a new mid-flow question in `auto` mode.
**Entry point:** `/claude-tweaks:specify #{n}` (shaping) or a design-doc decomposition (sub-issue creation), and later the `/claude-tweaks:build` step of `/claude-tweaks:flow #{n}`.
**Success state:** The filed record's mandated line already carries a conformant status word. If a conformance gap still reaches the build, the SDD ruling sides with the contract, and the departure from the spec shows up exactly once at the Wrap-Up Review Console as an update-the-spec `build-deviation-{N}` row.

## Steps

### 1. Shape a record whose Deliverable quotes a decision line
- **URL:** `/claude-tweaks:specify #{n}` (`specify/shaping-mode.md`), or a decomposition sub-issue (`specify/record-creation-subissues.md`)
- **Action:** Write a Deliverable or Acceptance Criterion that quotes the exact `decisions.md` line a skill must log, such as `STAGED … dispatched anyway` for a warning that writes nothing to `staged/`.
- **Should feel:** Hands-off. Shaping carries on with no question about status words.
- **Should understand:** Before the record is written or stamped `ready` (or, for a decomposition, before `gh issue create` / `writeRecord`), the "Mandated decision-line status word (#3557)" check compares the quoted line against the Status semantics row for what it records. A `STAGED` line must name the `staged/` artifact it writes. A line that writes no artifact takes its matching row: `AUTO`, `SKIP`, `SCANNED`, `KEPT-PROMPT` or `FAILED`.
- **Red flags:** An `AskUserQuestion` about the status word in `auto` mode. A correct `SCANNED …` or `KEPT-PROMPT …` line rewritten to `AUTO`.

### 2. Read the corrected line in the filed record
- **URL:** the record body on GitHub (or `specs/{n}-*.md` under `local-files`)
- **Action:** Open the Deliverable. A `STAGED … dispatched anyway` line with no artifact now reads `AUTO … dispatched anyway`. A `STAGED` line that does write a file but never named it now names its `staged/` path.
- **Should feel:** Like an editor fixed a typo against the house style. The intent is unchanged; only the status word or the missing path changed.
- **Should understand:** A line that already conforms is left as written.
- **Red flags:** The rewrite changing anything other than the status word or the missing `staged/` path.

### 3. Build a spec whose literal text still conflicts with a contract
- **URL:** the `/claude-tweaks:build` step of `/claude-tweaks:flow #{n}` (`build/dispatch.md`'s SDD invocation)
- **Action:** Let SDD run. When a task or final review flags that the spec-mandated text breaks a `_shared/*.md` contract, the controller rules for the contract and ledgers `Ruling: contract-beats-spec — {contract file} over the spec's "{quoted text}" — {cost if wrong}`.
- **Should feel:** Decided, not parked. Nobody asks whether to keep the spec's wording.
- **Should understand:** The spec's text is never kept on the grounds that the spec spelled it out. The departure is an update-the-spec deviation, not an ordinary ruling.
- **Red flags:** A ruling that keeps a contract violation "because the spec requires this exact text" (the #3520 shape). A question to a human in `auto` mode.

### 4. See the departure once at the Review Console
- **URL:** the run's `staged/build-deviation-{N}.md` and the Review Console's Pending review section
- **Action:** At SDD's Finish step, the carry-forward copies the `Ruling: contract-beats-spec —` line to the ledger. It stages the line as `build-deviation-{N}` (classification `Update the spec`), not `sdd-ruling-{N}`. The ledger Item and the `STAGED` log line name `build-deviation`, and the dispositions read apply / decline. Choose apply to update the spec to the as-built wording, or decline to keep the spec text.
- **Should feel:** Like one clear item about the spec, not two items about the same decision.
- **Should understand:** Common Step 4.5's architecture alignment check never lists or stages this departure again, in any mode (`architecture-alignment.md` Check item 4). The row also reaches the console when Step 4.5 is skipped (fast-lane or a trivial plan).
- **Red flags:** Both an `sdd-ruling-{N}` and a `build-deviation-{N}` row for the same departure. A `build-deviation` row offering ratify / reverse. No row at all after a fast-lane build that made a contract-beats-spec ruling.

## Origin
- Created during build of #3557 (a spec-mandated decision line must still follow the auto-decision-log status vocabulary), run `2026-10-20T183400-record-3557`.
- Trigger: #3520, where a spec mandated `STAGED` for a line that wrote no artifact, a ruling kept it, and review fix `ccca472` on PR #3530 corrected it.
- Related: `docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md` (the ordinary `sdd-ruling-*` path this one diverges from).
