# Specify — Decomposition Mode, Steps 3-9 (record creation through completion)

Continues `decomposition-mode.md` in this same directory — that file's interactive Steps 1, 2,
2.6, 2.5, and 2.5d resolve the decomposition shape, the collapse decision, and (for frontend
specs) design intent. This file picks up from there: record creation, linking, the multi-persona
red-team pass, self-review, deletion of the consumed design doc, and the Step 9 summary/commit —
every step from here on is mechanical, safe for a subagent dispatched via `mechanical-handoff.md`'s
canonical dispatch prompt to run unattended having read only this file. Step numbering matches
`decomposition-mode.md`'s own numbering exactly (Steps 1-9 together, unchanged across the split —
originally #611's Step 4/5 boundary, moved to the interactive/mechanical boundary at #832), so a
cross-reference naming a step by number still resolves regardless of which of the two files it
lands in.

---

## Step 3: Create the records

When Step 2.6 kept the parent, records are created **parent-first**: the parent's number has to exist before any sub-issue can link to it. Under collapse (Step 2.6), there is no parent — every produced record is created independently, using deterministic fingerprints for idempotent resume across partial or concurrent runs exactly as today. **Decomposition mode only** — shaping mode never reaches this step. Read `record-creation.md` in this skill's directory for the Idempotency (resume path) map and Parent record creation (skipped under collapse), then `record-creation-subissues.md` (#1346's split) for Sub-issue creation — including the origin-set carve-out where a 1-unit collapse's "create" is an in-place write onto the origin record (body composition — including the `Visual-reference:` line when Step 2.5b-ii accepted a variant — Type, Scoring, Ceremony, slug/fingerprint derivation, and both drivers' write calls), plus write-path resilience and the body size ceiling.

## Step 4: Link and order

Every record this run is going to create now has a number (a parent's, under a kept parent; every unit's own, under collapse). This pass wires the relationships between them and absorbs the last of the design doc's context, before Step 7 deletes it. Read `record-creation-linking.md` in this skill's directory (#1346's split of `record-creation.md`) for the full procedure: Linking (branches on driver and `work-links`), and Decision Rationale / Assumptions / Cross-Spec Promises absorption.

---

## Step 5: Multi-Persona Red-Team

Before deleting the design doc, dispatch persona-instantiated agents in one parallel batch per sub-issue record — not the parent, which is never built directly — to surface ambiguities, gaps, and unstated assumptions. **Persona count depends on the sub-issue's own `ceremony:*` label** (stamped in Step 3): `ceremony:fast-lane` dispatches **one** persona (Skeptical Reviewer only); `ceremony:standard` dispatches all **three** (Implementer / Maintainer / Skeptical Reviewer), unchanged from before. See `red-team.md` for which persona(s) to dispatch for each tier.

**Freshly-created sub-issues only.** Skip this dispatch for a sub-issue resumed via Step 3's Idempotency map whose fetched body already shows zero unresolved `<!-- ambiguity: -->` markers and no `## Open Questions` section — that sub-issue completed red-team and self-review in a prior run, and re-dispatching would duplicate findings against content already resolved. Dispatch normally for every sub-issue actually created in this run, and for any resumed sub-issue that still carries unresolved markers or an open `## Open Questions` table from an interrupted prior run.

Each agent's input is a record reference, never inlined content: `work-backend: github-issues` — the sub-issue's number plus a `gh issue view` read instruction; `work-backend: local-files` — the sub-issue's record file path. Never both in the same dispatch. Findings are written **back into the record body** — inline `<!-- ambiguity: ... -->` HTML comments next to flagged sentences, or rows in an appended `## Open Questions` table — via compose-then-write-once, the same discipline every write in this skill uses, after the per-persona dedup and severity floor in `red-team.md`'s write-back procedure. A decision-worthy finding (critical, or one whose resolution would change the sub-issue's Deliverables/Acceptance-Criteria scope) is staged for the Review Console with the sub-issue's `ready` cleared, rather than left for Step 6 to self-resolve. No mid-flow prompt — Step 6 Self-Review picks up everything below that bar.

Read `red-team.md` in this skill's directory for the dispatch prompt (Template A block must remain inlined verbatim in the dispatch prompt at runtime per the Subagent Contract), the persona lens questions, and the write-back procedure.

---

## Step 6: Record Self-Review

Before deleting the design doc, look at every record you wrote with fresh eyes — including the red-team findings just written in Step 5. Fix issues inline — no subagent, no separate review pass. This is also the last chance to catch content the design doc captured but no sub-issue implements.

"Wrote" means created or edited in this run. A sub-issue resumed via Step 3's Idempotency map, skipped by Step 5 (already clean), and unedited this run needs no fresh pass — its prior run completed one. Scope checks 1-5 below to sub-issues this run created, plus any resumed one Step 5 dispatched against or Step 4's linking edited.

> **Parallel execution (conditional):** When N ≥ 3 sub-issue records are produced, run scope and ambiguity checks concurrently — `gh issue view` per sub-issue under `work-backend: github-issues`, `Read` per record file under `work-backend: local-files` — plus `Grep` over the fetched bodies for placeholder patterns.

1. **Placeholder scan** — search for the failure patterns in `spec-template.md`'s "No Placeholders" section, over every record body (every sub-issue, plus the parent when Step 2.6 kept one). Any `TBD`, vague acceptance criteria, undefined types, "standard error handling", or "similar to sub-issue N" — fix them now. Also confirm every `<!-- ambiguity: ... -->` marker Step 5's red-team wrote has been resolved and **deleted**, with one exception: a marker whose finding Step 5 staged for the Review Console stays — that sub-issue's `ready` is already cleared, and its resolution is the console's decision, not this step's. On every sub-issue that remains `ready`, zero may remain: a `ready` sub-issue still carrying one fails `_shared/work-record.md`'s spec-shaped structural check, which treats `<!-- ambiguity:` as an unresolved placeholder marker exactly like `TBD`/`TODO`.
2. **Internal consistency** — across the sub-issues in this decomposition, do referenced types, model names, and endpoint signatures match? A function called `clearLayers()` in sub-issue 42 but `clearFullLayers()` in sub-issue 43 is a bug.
3. **Scope check** — is each sub-issue genuinely a single work unit (3-8 tasks)? If one is doing two things, split it now. If two are doing the same thing, merge them.
4. **Ambiguity check** — could any acceptance criterion be interpreted two different ways? Pick one and make it explicit.
5. **Design-doc coverage** — re-read the design doc with each sub-issue open. If you find a requirement the doc captured but no sub-issue implements, add it to the right sub-issue now — the doc is about to be deleted in Step 7.

When all five checks come back clean, proceed to Step 7. No need to re-review after fixing.

---

## Step 7: Delete Consumed Artifacts (only when fully decomposed)

The design doc has served its purpose **once every phase has been decomposed into sub-issue records and Step 6 Self-Review has confirmed coverage**. Behavior depends on the phase target:

| Decomposition mode | Delete design doc? |
|---|---|
| No `phase-N` argument; doc has 0 phase sections (single-phase) | Yes — fully consumed |
| No `phase-N` argument; doc has N phase sections; all decomposed in this run | Yes — fully consumed |
| `phase-N` argument; only that phase decomposed | **No** — design doc retained for remaining phases. Add a `## Phase N: Specified` marker after the phase heading instead, listing the record numbers it produced. |
| `phase-N` argument; this was the last un-specified phase | Yes — fully consumed (run delete after marker bookkeeping confirms all phases marked) |

```bash
# Full decomposition (all phases or single-phase):
git rm docs/superpowers/specs/YYYY-MM-DD-{topic}-design.md

# Partial decomposition (phase-N only): commit the marker, keep the doc
git add docs/superpowers/specs/YYYY-MM-DD-{topic}-design.md
git commit -m "Mark phase-{N} specified in design doc"
```

When fully consumed, do NOT keep these around. They create dangling references and stale artifacts. The sub-issue records are the durable artifact.

(Step 8 — the old backlog-entry deletion — is retired: a captured record is shaped in place, so there is nothing to delete.)

---

## Step 9: Summary and Commit

Present a summary. The `Collapse outcome` line below renders in every decomposition run, collapse taken or not — not only when a parent was skipped:

```markdown
## Specification: {design doc topic}

### Work Units Created
| Record | Title | Type | Blocked by | Est. tasks |
|--------|-------|------|------------|------------|
| {ref} | {title} | {type} | {refs or —} | {count} |

**Collapse outcome:** {parent kept | collapsed: 2 units, independent | collapsed: 1 unit} — {one-line reason, e.g. "no `Blocked by` or internal-conflict signal between the two units" / "single work unit, no parent needed"}

### Existing Records Modified
- {ref} "{title}" — {what was added/changed}

### Artifacts Removed
- Design doc: `docs/superpowers/specs/{filename}` (absorbed into the records this run produced)

### Teardown (optional — render only when the check below finds the branch net-empty)
{one paste-ready line, see below}

### Diagram suggestions (optional — render only when Step 2.5d emitted any)
- {one or two `**Diagram suggestion:** …` blocks emitted by Step 2.5d}
```

`{ref}` is `#{N}` under `work-backend: github-issues`, the bare record id under `local-files` — same convention as Step 1's Overlap Analysis (`overlap-resolution.md`).

**`needs:definition` origin closure.** When `$ORIGIN_RECORD_NUM` is set (this run was reached via the `needs:definition` redirect — `specify/SKILL.md`'s Resolve-the-input case 1), what happens to the origin record depends on this run's collapse decision (Step 2.6):

- **Parent kept, or 2-unit collapse** — every unit this run produced is a record distinct from the origin. Close the origin now, using the same number list the Work Units Created table above already assembled: post a comment on `$ORIGIN_RECORD_NUM` in that table's own list format, "Superseded by decomposition: #{ref1}, #{ref2}, ..." (`work-backend: github-issues`: `gh issue comment "$ORIGIN_RECORD_NUM" --body "..."` then `gh issue close "$ORIGIN_RECORD_NUM"`; `local-files`: append the note to the record body and mark it closed via `local-store.js`). This is unchanged from before collapse existed, for the parent-kept case; the 2-unit-collapse case closes the origin the identical way, just naming two ordinary records instead of a parent plus two leaves.
- **1-unit collapse** — the single work unit and the origin are the same thing, so there is no second record to point the origin at and **this step closes nothing**. Step 3 already ran its origin-set carve-out to shape the origin record in place as that unit's own create — body plus `{design-doc-slug}:{unit-slug}` fingerprint, `record-creation-subissues.md`'s Sub-issues section (#1346's split of `record-creation.md`) — so Steps 4-7 all ran against a real, existing record. The origin is never closed in this branch; it lives on, now shaped.

When `$ORIGIN_RECORD_NUM` is unset (every other entry path — cases 2-5), this whole paragraph is a no-op, unchanged from before.

### Actions Performed

| Action | Detail | Ref |
|--------|--------|-----|
| Operational | {parent kept: "Created parent record {parent-ref} + {N} sub-issue records"} / {2-unit collapse: "Created 2 independent records (no parent), cross-linked via `**Related:**` — {ref1}, {ref2}"} / {1-unit collapse, `$ORIGIN_RECORD_NUM` set: "Shaped origin record {ref} in place (no new record created)"} / {1-unit collapse, `$ORIGIN_RECORD_NUM` unset: "Created 1 standalone ready record (no parent) — {ref}"} | `{hash}` (local-files) / `—` (github-issues — creates already landed via API, no commit) |
| Operational | Deleted design doc | `{hash}` |

**Commit whatever this run wrote to disk — the skill's terminal action, run whether or not anything ends up staged.** This covers only artifacts that are files: the design-doc deletion/marker from Step 7, and — under `work-backend: local-files` — the sub-issue record files (plus the parent's, when Step 2.6 kept one) plus Step 4's linking edits, composed and written across Steps 3-4 but not yet committed. A clean `github-issues` run has nothing to commit for the records themselves — every create and edit already landed via the API in Steps 3-5, the same no-commit case Shaping mode documents — **except** any sub-issue (or the whole batch, if a kept parent itself fell back) that Step 3's write-path resilience wrote to `local-store.js` after a `gh` failure; that file needs this commit exactly like a `local-files` record does. A full (non-`phase-N`) decomposition may therefore have nothing staged beyond the design doc's `git rm`; a `phase-N` run already committed its own marker back in Step 7, so it may have nothing staged at all. None of this affects durability — a sub-issue is durable the moment its create/write call lands, not when this step commits it. What used to be true of spec files no longer applies: sub-issues don't need to exist in committed history before a pipeline can run them; `/claude-tweaks:flow #N` (or a local record id) materializes a sub-issue into a build-time file only when a pipeline actually runs it (spec 20's contract), independent of this commit.

```bash
git add specs/ docs/   # local-files driver: record files (sub-issues + any kept parent) + link edits; docs/: design-doc removal/marker
git status --porcelain   # empty is a valid outcome (github-issues, or a phase-N run) — commit only if something is staged
git commit -m "{message describing the sub-issues created}"   # skip when nothing is staged
git log --oneline -1   # verify it landed when a commit was made (see _shared/git-discipline.md)
```

By the time Next Actions renders, any commit from this step has already happened.

**Net-empty teardown line (#613).** Once the commit above lands (or confirms nothing to stage), check whether this run's own design-doc deletion left the current branch net-empty vs. its own fork point — the canonical shape when a scratch worktree/branch existed only to carry the design doc through decomposition, invisible to `/tidy`'s merged-only worktree scan (`tidy/scan-procedures.md`'s net-empty override, `tidy/step-6-auto.md`'s Delete row). Run the same check `tidy/step-6-auto.md`'s "Net-empty branches (#613)" section defines, canonically, for the paired case — that section, not this one, is the statement of record for the procedure (`_shared/integration-branch.md`-resolved `{base}`, `git diff --quiet "$(git merge-base {base} HEAD)" HEAD`, and a `merge-base` failure falling through as non-zero, never mistaken for net-empty) — applied here with `HEAD` standing in for `{branch}`. Exit 0 (no diff) → render the Teardown section above with one paste-ready line: `git branch -D {branch}` when this run ran directly on the checkout, or `git worktree remove {worktree-path} && git branch -D {branch}` when it ran inside a linked worktree (detect via `worktree-detect.js`'s `isLinkedWorktree`, `_shared/integration-branch.md` rank 5's snippet). Never run this line — Step 9 only prints it. Non-zero (real content) → omit the Teardown section entirely.
