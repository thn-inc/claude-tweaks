---
files:
  - plugin/skills/build/plan-authoring-checks.md
  - plugin/skills/specify/spec-template.md
  - plugin/skills/reflect/SKILL.md
  - plugin/skills/wrap-up/leftover-routing.md
  - plugin/skills/_shared/ledger-format.md
---

# Prove an Absence Grep Can Match

**Persona:** An author writing a record or a plan: a maintainer running `/claude-tweaks:specify`, a `/claude-tweaks:build` session finalizing a plan, or an agent composing a `specShapedBody` record from `/reflect`, `/wrap-up` leftover routing or the ledger resolve gate. They want to write a check of the form "this grep returns nothing".
**Goal:** Ship an absence criterion that can actually fail, so that "nothing matches" means the target is gone and not that the search was broken.
**Entry point:** writing a criterion or a plan step that says a search "returns nothing", "prints no lines" or "exits 1". The guidance sits in `plan-authoring-checks.md`'s **Absence-grep control check**, in `spec-template.md`'s `## Acceptance Criteria` and Delete + Tombstone sections, and in the specShapedBody mappings in `reflect/SKILL.md`, `leftover-routing.md` and `ledger-format.md`.
**Success state:** The plan or record says the absence search was run once against a tree that still holds its target, and that it matched there. Literal code text uses `grep -F`.

## Steps

### 1. Recognize an absence criterion
- **URL:** the record's `## Acceptance Criteria` (`spec-template.md`'s section of that name), the plan step being written (`plan-authoring-checks.md`'s **Absence-grep control check**), or the `acceptanceCriteria` mapping an agent composes a `specShapedBody` record from (`reflect/SKILL.md`, `wrap-up/leftover-routing.md`, `_shared/ledger-format.md`).
- **Action:** Notice that the check passes when a search finds nothing. Typical wording is "returns nothing", "prints no lines", "exits 1", "zero matches" or "no longer appears".
- **Should feel:** Like a known trap, spotted before the criterion is pinned.
- **Should understand:**
  - A search that cannot match its own target passes before the change and after it. Every reviewer who reads it agrees with it, so nothing downstream catches it.
- **Red flags:**
  - An absence grep copied from another record, or composed as an escaped string, that nobody has run.

### 2. Run the control once
- **URL:** a file or commit that still contains the target: the pre-change file (`git show {base}:{path}`), or the tree before the deletion.
- **Action:** Run the exact command against it and confirm it matches. Write that match into the plan or the record. Use `grep -F` (or `git grep -F`) for literal code text. For a commit, pipe `git show {base}:{path}` into the same search, or run `git grep -F {pattern} {base} -- {path}`.
- **Should feel:** Quick and decisive. One command answers whether the criterion can ever go red.
- **Should understand:**
  - In a basic regex, the brackets, backslashes and `*` of a code fragment turn into operators.
  - #3536's AC1.1 grep `\[\s\S\]` was a literal `[`, a whitespace class, a non-whitespace class and a literal `]`. So it exited 1 on the unfixed `tests/bin-lib/exit-code-conformance.test.js` too.
  - `grep -rnF` matched line 56 of the old file and nothing at HEAD.
- **Red flags:**
  - A control run against the already-fixed tree, which proves nothing.
  - A regex grep kept for literal code text when `-F` would do.

### 3. Scope out a tombstone
- **URL:** `spec-template.md`'s `## Delete + Tombstone Acceptance Criteria`.
- **Action:** When the same change leaves a tombstone comment naming the deleted symbol, scope the grep to exclude the tombstone. Then run that scoped grep against the pre-deletion tree and confirm it still matches the symbol. When the tombstone is instead worded without the symbol name, the grep stays bare, and that bare grep gets the same control run.
- **Should feel:** Like the same rule applied a second time, not a new one.
- **Should understand:**
  - The tombstone exclusion (`| grep -v "// removed:"`) is a second place where the search can silently stop matching.
  - Either way the grep, scoped or bare, is an absence grep.
- **Red flags:**
  - A scoped grep that has only ever been run after the deletion.
  - A bare grep skipped because only the scoped form seemed to need the control.

## Origin
- Created during build of #3571, a reflect-light finding from #3536. #3536's AC1.1 could never fail. Its plan copied it into Global Constraints and Task 2, plan audit passed it, and only the Task 2 implementer caught it at dispatch.
- Updated during wrap-up of #3571: Steps 2-3 brought in line with the review fixes in d9746b834, the recipe for running the control against a commit and the bare tombstone grep.
- Pinned by `tests/absence-grep-control-check-prose.test.js`.
- Related: `derive-a-reader-inventory-from-read-call-sites-3397.md`, another plan-authoring check that `/claude-tweaks:build` applies before a plan is finalized.
