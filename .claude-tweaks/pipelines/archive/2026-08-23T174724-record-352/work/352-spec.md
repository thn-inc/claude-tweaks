---
record: 352
origin: human
risk: low
size: low
ceremony: standard
grants: [build, merge]
surface: backend
---
# 352: Split skills/flow/SKILL.md's growing auto row into a linked sub-file

Surface: backend

## Current State

`skills/flow/SKILL.md`'s mode table carries four rows (`auto`, `confirm`, `interactive`, `hybrid`), each summarizing what that mode silences or gates. The `auto` row (currently around line 57) is the longest by a wide margin — it restates the Config Manifesto's read-only-FYI behavior, lists every silenced check (branch-divergence, shape-check, path-selection prompts), and cross-references `_shared/auto-mode-contract.md`'s silences/does-not-silence split, all inline in the table cell.

The file sits at 38,963 bytes against `tests/bin-lib/skill-audit/context-cost.test.js`'s 40 KB (40,960 byte) per-invocation ceiling — about 2 KB of headroom today, but the margin has been chronically thin: record #349's own wrap-up needed a same-task trim mid-implementation just to stay under the ceiling after its restatement-sweep fix pushed the file 122 bytes over, and by #349's own account the file was down to 17 bytes of headroom at one point. Every record that touches the auto-mode contract gravitates toward adding one more clause to this same `auto` row, since it's already the row that documents the contract's interaction with `/flow`.

A working precedent for this kind of split already exists in the repo: `skills/review/SKILL.md` extracts its Step 3 lens-scope-and-dispatch material into `skills/review/step3-lens-dispatch.md`, leaving a short pointer paragraph in `SKILL.md` itself (`skills/review/SKILL.md` lines ~179 and ~225). `skills/flow/` already has over a dozen sibling sub-files (`manifesto.md`, `steps-and-gates.md`, `validation.md`, etc.) following this same lazy-loaded-sub-file convention, so the split is consistent with the skill's existing structure — it just hasn't yet been applied to the mode table.

## Deliverables

- A new sub-file under `skills/flow/` (e.g. `mode-table.md`, exact name at implementer discretion) containing the full prose for the `auto`/`confirm`/`interactive`/`hybrid` mode-table rows currently in `SKILL.md`'s mode table (`SKILL.md` lines ~57-60), and the related Manifesto-behavior-by-mode table further down (`SKILL.md` lines ~152-157) if keeping both together keeps the split coherent — matching the scope note already present in the originating issue.
- `SKILL.md`'s mode table rows themselves stay (readers need the table at a glance) but their long-form prose per mode is trimmed to a one-line summary plus a pointer to the new sub-file, mirroring how `skills/review/SKILL.md` lines ~179 and ~225 point into `step3-lens-dispatch.md` rather than inlining Step 3's lens-dispatch contract.
- No content is dropped in the move — every fact currently in the `auto` row (and its sibling rows) must still be findable, either in the trimmed table cell or in the linked sub-file.
- All existing cross-references elsewhere in the repo that cite `skills/flow/SKILL.md`'s mode-table prose by content (not by line number) continue to resolve correctly after the move — grep the repo for phrasing lifted from the moved rows before finishing.

## Acceptance Criteria

- `skills/flow/SKILL.md`'s byte size drops meaningfully below the current ~38,963 bytes, restoring real headroom under the 40 KB ceiling rather than the ~17-122 byte margins seen historically — `npm test` (specifically `tests/bin-lib/skill-audit/context-cost.test.js`) passes with clear, not marginal, headroom for `skills/flow/SKILL.md`.
- The new sub-file itself does not exceed the 40 KB per-sub-file ceiling that the same test suite enforces (`tests/bin-lib/skill-audit/context-cost.test.js`'s "no lazy-loaded sub-file exceeds the ceiling either" test).
- The mode table in `SKILL.md` still lets a reader pick a mode (`auto`/`confirm`/`interactive`/`hybrid`) without opening the sub-file — the trimmed cell content is a summary, not a stub that discards the decision-relevant facts (e.g. which checks each mode silences).
- Every fact currently stated in the four mode rows and the Manifesto-behavior table is still present somewhere in the shipped result (either table or sub-file) — nothing is silently dropped in the extraction.
- Full `npm test` passes, including the full `context-cost.test.js` suite (both the per-`SKILL.md` and per-sub-file ceiling checks) and any existing skill-prose conformance tests that pin phrasing from the moved sections.

## Technical Approach

Follow `skills/review/SKILL.md`'s existing extraction pattern as the template: move the long-form prose out of `SKILL.md` into a new sibling `.md` file in `skills/flow/`, leave the mode table itself in place with trimmed per-row summaries, and add a short pointer sentence (naming the sub-file) near the table — matching the phrasing style of `skills/review/SKILL.md` lines ~179 and ~225. Before finishing, grep the repo for any other skill or doc that quotes or paraphrases the moved prose (cross-references naming `SKILL.md`'s mode table by content) and update those references to point at the new sub-file where appropriate.

## Gotchas

- The 40 KB ceiling test (`tests/bin-lib/skill-audit/context-cost.test.js`) checks both `SKILL.md` files AND lazy-loaded sub-files independently — moving too much prose into one oversized sub-file just relocates the problem (this is the exact failure mode the test's own comment warns about, referencing IL-70's 86 KB sub-file behind 18 stubs). Keep the new sub-file well under the ceiling, not just under it.
- `skills/flow/SKILL.md` is loaded in full on every `/flow` invocation and once per dispatched subagent, per the test file's own rationale — the split is a genuine cost reduction for the common case (most invocations don't need the full mode-table prose), not just a line-count exercise.
- The `Related: #333` reference in the original request may carry additional context on the auto-mode-contract restatement problem this record is a symptom of — worth a skim before deciding exactly where the sub-file boundary should sit.

## Original request

Split skills/flow/SKILL.md's growing auto row into a linked sub-file

## Overview

`skills/flow/SKILL.md`'s `auto`/`confirm`/`interactive`/`hybrid` mode-table row prose is chronically near `bin/lib/skill-audit/tests/context-cost.test.js`'s 40 KB per-invocation ceiling — 17 bytes of headroom as of #349's own trim (was ~26 bytes before that). Every related record's natural instinct is to add one more cross-reference clause to the same `auto` row, and #349 itself needed a same-task trim (during its Task 6 final verification) just to restore green after its own restatement-sweep fix pushed the file 122 bytes over.

## Suggested resolution

Extract the `auto` row's prose (and its sibling `confirm`/`interactive`/`hybrid` rows, if that keeps the split coherent) into a dedicated sub-file, mirroring `skills/review/SKILL.md`'s existing extraction of `step3-lens-dispatch.md`. Leave a one-line pointer in the mode table. Restores real headroom instead of another one-off trim next time a related record touches the auto-mode contract.

## Origin

Reflect finding from record #349's wrap-up (Near-misses lens, systemic causal verdict), routed via the Multi-Spec Review Console's Queue writes gate.

Origin: ledger resolve gate / reflect full-mode

**Related:** #333

