# Release Note remediation — design

Origin: #2786. Approved in brainstorming 2026-09-29.

## Problem

The spec-shaped-body definition (`plugin/skills/_shared/work-record.md`, "Spec-shaped body") requires four non-empty sections: Current State, Deliverables, Acceptance Criteria, and Release Note. `/flow`'s Materialization hard gate (`plugin/skills/flow/materialize.md`, backed by `plugin/bin/lib/issues/materialize-format.js`'s `REQUIRED_SECTIONS`) enforces that. The Release Note requirement arrived on 2026-09-18 (#2580/#2581, merged as #2586). The merge-time composer (`plugin/bin/lib/compose-subject.js`) reads the same section into the single-line `Release-Note:` trailer.

Live audit on 2026-09-29: 110 of the 126 open `ready` records carry no `## Release Note`. 17 of those also carry `auto:build`. That leaves dispatch no buildable candidate: every dispatched group fails Materialization, uses up a `dispatch-retry-ceiling` attempt, and a `correctness`-classified failure revokes `auto:merge` in Settle (#2573 lost its grant this way, and #2663 sits at 2 of 3 attempts).

#2786 framed this as legacy content shaped before the requirement existed. The audit disproves that. All 110 carry `## Original request`, the section only `/specify` shaping mode writes. Some were shaped on 2026-09-29 by the sweep's specify drain. **The root cause is a live producer defect.** `plugin/skills/specify/shaping-mode.md`'s literal body template lists six sections and omits `## Release Note`. The requirement appears only in the prose after the template, and shaping mode never validates the composed body before stamping `ready`. Decomposition mode is unaffected: `record-creation-subissues.md` already runs `bin/compose-record.js --require-shaped`.

A second hazard compounds it. `/backlog refine` Step 3.5 (`plugin/skills/backlog/refine-mode.md`) flags back any body that fails the spec-shaped check, removing `ready` with a comment. The next refine run, human-present or inside `/sweep`, would therefore un-ready all 110 records.

The defect shipped to every consumer project, so their backlogs carry the same broken records.

## Decisions

- **Treat a missing Release Note as a scope-neutral repair, not a re-shape.** Adding a one-line Release Note derived from the record's own title and Deliverables changes nothing a grant was approved on. The repair therefore keeps every existing label: `ready`, `auto:build`, `auto:merge`, and the `risk:*`/`size:*`/`ceremony:*`/`type:*`/`priority:*` families.
- **The backfill is a shipped `/tidy` repair, not a one-off maintainer pass.** Consumer projects heal the same way this repo does. `/sweep` runs `/tidy` before `/backlog refine`, so the repair lands before refine's flag-back can fire. Running the new rule against this repo is the backfill.
- **Only the Release-Note-only failure is repaired.** A record that also fails any other structural check (another missing or empty section, or an unresolved placeholder marker) is left alone, and refine's existing flag-back owns it. A missing Current State or Acceptance Criteria is not scope-neutral.
- **Dispatch filters before it claims.** A deterministic content defect already visible in the cached body is excluded at queue pull. Discovering it inside `/flow`, after a claim, costs a retry attempt and can revoke grants.

## Rejected alternatives

- **Relax the Materialization gate for older records.** The failure would only move to merge time, where `compose-subject.js` needs the same section for the `Release-Note:` trailer. There is also no clean "pre-requirement" cutoff, because the shaper kept producing non-conforming records after the requirement existed.
- **Close or park the affected records.** They are valid work; the defect is one missing line.
- **Full re-shape of all 110 via `/claude-tweaks:specify`.** It re-runs scoring, ceremony, framing, and near-duplicate checks per record, which is costly and can change labels a human already approved.
- **Make `/backlog refine` repair instead of flagging back.** Repair would then happen only when a grant gate runs, never proactively, and it would make a grant gate write record bodies.

## Work unit 1 — Shaping mode emits and validates the Release Note

**Current state.** `plugin/skills/specify/shaping-mode.md` "Edit the body into spec shape" says "Rewrite the record's body into six sections, in this literal shape". The fenced template holds Current State, Deliverables, Acceptance Criteria, Technical Approach (with `### Key Files`), and Gotchas, with no Release Note. The compose-then-write-once call in `shaping-mode-stamping.md` writes the body and stamps `ready` with no structural check.

**Deliverables.**
- Add a `## Release Note` section to shaping mode's literal template, after `## Acceptance Criteria`, matching `spec-template.md`'s placement. Include a one-line authoring note pointing at `spec-template.md`'s Release Note guidance (plain language, verb-first, single line, no record numbers or file paths). Update the section count in the lead-in sentence.
- Before the compose-then-write-once call, validate the composed body with the same `validateShaped` that `bin/lib/compose-record/compose.js` exports. Shaping mode composes a body, not a `compose-record.js` payload, so expose a validate-only entry point. The preferred form is a `--check <body-file>` mode on `bin/compose-record.js`, reusing its exit code 4 (shape validation failed, gaps on stderr), so no new CLI appears. A failed check writes nothing and stamps no labels, and the record's Actions Performed row reports the gaps. In a batch, a failure on one record does not stop the rest, per shaping mode's existing batch rule.
- A conformance test pins that shaping mode's literal template contains every section in `compose.js`'s `REQUIRED_SECTIONS`. The test fails if the template and the requirement drift apart again.

**Acceptance criteria.**
- Shaping a record that lacks a Release Note produces a body containing a non-empty `## Release Note` section, and `materialize-format.js`'s check passes on it.
- A composed body missing any required section is never written, and the record is never stamped `ready`. The failure names the missing sections.
- The new conformance test fails when `## Release Note` is removed from the template (proven by reverting it) and passes with it present.
- `bin/compose-record.js --check` exits 0 on a conforming body and 4 on a non-conforming one, and is covered in `tests/bin-lib/compose-record/cli.test.js`.

**Release Note.** "Fixed record shaping so shaped records always include the Release Note section builds require."

**Key files.** `plugin/skills/specify/shaping-mode.md`, `plugin/skills/specify/shaping-mode-stamping.md`, `plugin/bin/compose-record.js`, `plugin/bin/lib/compose-record/compose.js`, and a conformance test under `tests/`.

## Work unit 2 — `/tidy` repairs a missing Release Note in place

**Current state.** `plugin/skills/tidy/step-1-records.md` audits open records by shape. Shape 4 covers "ready record missing scoring". No shape covers a `ready` record whose body fails the spec-shaped check.

**Deliverables.**
- A new record shape in `step-1-records.md`, placed next to Shape 4: a `ready` record whose only spec-shaped-body failure is a missing or empty `## Release Note`. Determine "only" by running the same structural check (`validateShaped`, with the `## Original request` and code-span exemptions `work-record.md` defines) and finding exactly one gap: the Release Note section. The shape applies under both `work-backend` drivers.
- The repair composes one Release Note line from the record's own title and Deliverables, per `spec-template.md`'s Release Note rules. It inserts the section immediately after `## Acceptance Criteria`, touching no other section, and writes the body back via `gh issue edit --body-file` or `writeRecord`. It changes no label.
- In `auto` mode, and under `/sweep`, the repair runs without a prompt and logs an `AUTO` entry per `_shared/auto-decision-log.md`. It is reported in tidy's summary with the record number and the composed line.
- A record with any additional structural gap is not matched by this shape.
- Run the new rule against this repository once it merges, so the backlog is repaired before the next `/backlog refine` or `/sweep` run.

**Acceptance criteria.**
- A fixture record missing only its Release Note matches the new shape. A fixture missing the Release Note and also Acceptance Criteria does not. A conforming fixture does not.
- After repair, the record body passes `materialize-format.js`'s check. The only diff against the original body is the inserted section, and the record's label set is unchanged.
- The repaired line obeys `spec-template.md`'s Release Note rules: one line, no `#` record numbers, no file paths.
- After the run against this repository, a body scan over all open `ready` records finds zero whose only structural gap is the Release Note. The run's output lists each repaired record.

**Release Note.** "Added an automatic repair that fills in a missing Release Note on ready records, so they can be built again."

**Key files.** `plugin/skills/tidy/step-1-records.md`, `plugin/skills/tidy/SKILL.md` (shape roster and summary), and the matching tidy tests under `tests/`.

## Work unit 3 — Dispatch excludes non-spec-shaped candidates at queue pull

**Current state.** `plugin/skills/dispatch/queue-pull-script.md` writes `dispatch-exclusions.json` entries under the reasons `blocked`, `oversized`, `open-pr`, `target-missing`, and `shipped`. It holds each candidate's body but never checks its shape. A non-conforming candidate is claimed, fails at `/flow`'s Materialization gate, and is counted against `dispatch-retry-ceiling`. The failure's classification can revoke `auto:merge`.

**Deliverables.**
- Queue pull runs the same structural check the Materialization gate runs (one shared implementation, not a fourth copy of the section list) on every otherwise-eligible candidate's cached body. It appends failures to `dispatch-exclusions.json` as `reason: 'not-spec-shaped'` with `detail: {missing: [section names]}`.
- An excluded candidate is never claimed, never counts against the retry ceiling, and never reaches Settle.
- Dispatch's exclusion report renders the new reason alongside the existing ones, naming each record and its missing sections, plus the one-line remedy (run `/claude-tweaks:tidy` for a Release-Note-only gap, `/claude-tweaks:specify #{n}` otherwise).

**Acceptance criteria.**
- With a non-conforming eligible candidate in the queue fixture, queue pull writes a `not-spec-shaped` exclusion for it, and the resulting `dispatch-groups.json` does not contain it.
- A conforming candidate in the same fixture is unaffected.
- The exclusion report output names the record and its missing sections.

**Release Note.** "Dispatch now skips records that are not fully shaped instead of claiming them and failing mid-build."

**Key files.** `plugin/skills/dispatch/queue-pull-script.md`, `plugin/skills/dispatch/SKILL.md` (exclusion reporting), the shared shape checker's module, and dispatch queue-pull tests under `tests/`.

## Sequencing

Units 1 and 3 are independent. Unit 2's code is independent of both, but its run against this repository should follow its merge promptly, because the next `/backlog refine` or `/sweep` run flags back every unrepaired record. Until unit 1 merges, shaping keeps producing records that unit 2's rule would then repair.

## Manual follow-ups (human-only)

- Re-issue `auto:merge` on #2573 via `/claude-tweaks:backlog refine`. Settle revoked it after the Materialization failure. Granting is human-only.
- #2663 has used 2 of 3 retry attempts on this defect. The repair does not reset retry counters, so its next failure for any reason exhausts the ceiling.
