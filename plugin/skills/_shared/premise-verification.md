# Premise Verification

Authoring-time safeguard, referenced by `specify/record-creation-subissues.md`'s per-sub-issue
loop and `specify/shaping-mode.md`'s sanity-check paragraph. Runs whenever either skill composes
or edits a record's `## Current State`/`### Key Files` content, before the record is filed or
written.

## What it catches

A `## Current State`/`### Key Files` sentence asserting a fact about **this repo's existing
code** — a named file, module, subsystem, or symbol exists or is absent, or a named module
reads/writes/calls a named field or function — stated with no evidence and no verification.
Record #1769's own filing: a private-project decomposition asserted a dependency subsystem was
absent (it was present on the branch) and that an existing module already read a field it never
touched — both falsifiable with one grep, both survived to build/final-review before the true
state surfaced.

**Boundary with `_shared/dependency-narration-check.md`:** that check catches a *different*
record/PR's not-yet-merged work narrated as landed. This check is scoped to claims about the
current checkout's own existing code — never another record's planned or in-flight changes. A
sentence naming a sibling unit's future output belongs to that check, not this one.

## The check (content judgment, bounded)

After composing the body, before it is filed: read every `## Current State`/`### Key Files`
sentence and identify each one asserting existence, absence, or a read/write/call relationship
about code already in the tree. For each such claim, probe the checkout the decomposition or
shaping run is standing in (its own branch — not `main` — since that is the checkout the build
will start from):

- **Existence/absence of a file, module, or symbol** — `git ls-files -- {path}` (or `git grep -n
  -F '{symbol}'` when the claim is about a symbol rather than a path).
- **A module reads/writes/calls a named field or function** — `git grep -n -F '{field-or-fn}'
  -- {module-path}`.

**Caps** (the same shape `challenge/SKILL.md`'s bare-`#N` evidence search uses): at most 2 probes
per claim, at most 12 probes total per sub-issue/record. A claim needing more than 2 probes to
settle, or a sub-issue already at its cap, moves to the marker below rather than searching
further — this check screens, it does not verify a design.

- **Confirmed** — the sentence keeps its claim and gains an inline citation: `path:line` for a
  read/write/call claim, or the `git ls-files` hit itself for an existence claim.
- **Contradicted** — the sentence is rewritten to what the tree actually shows, before the body
  is filed. Never left as a false statement with a citation bolted on.
- **Unsettled within the caps, or genuinely unverifiable from this checkout** (a sibling unit's
  not-yet-built output, an external system, a runtime behavior no grep reaches) — move the claim
  out of `## Current State`'s declarative voice into a `## Gotchas` bullet with the literal
  prefix `ASSUMPTION — verify at build:`, followed by the claim and what would confirm it:

  ```markdown
  - ASSUMPTION — verify at build: {claim} — confirm via {what would settle it, e.g. "git grep -n
    '{symbol}' once {sibling unit} lands"}.
  ```

  The prefix is a literal string, matched by `build/SKILL.md`'s writing-plans handoff and by
  `tests/specify-premise-verification-prose.test.js` — never reuse any of the placeholder tokens
  `_shared/work-record.md`'s spec-shaped-body check rejects instead.

## Callers

| Caller | When it runs |
|---|---|
| `specify/record-creation-subissues.md`'s per-sub-issue loop | After Body/Type/Scoring compose the sub-issue's content, before the Ceremony and Framing calls — per-sub-issue, inside the decomposition loop, never against the batch's cross-reference accumulation |
| `specify/shaping-mode.md`'s sanity-check paragraph | Same point shaping mode's existing cheap-sanity-check paragraph already runs — this file states the general rule; that paragraph keeps only its human-filed-defect-report-specific delta |
