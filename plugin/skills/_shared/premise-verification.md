# Premise Verification

Authoring-time safeguard, referenced by `specify/record-creation-subissues.md`'s per-sub-issue
decomposition loop, `specify/shaping-mode.md`'s human-filed-defect-report sanity check, and
`build/SKILL.md`'s writing-plans handoff. Runs whenever a composed record body's `## Current
State`/`### Key Files` content states a claim about *this repo's existing code* — never a claim
about a sibling record's planned, not-yet-merged work (that is `_shared/dependency-narration-check.md`'s
domain; the two checks are siblings, not overlapping).

## What it catches

`## Current State` and `### Key Files` are written in a flat declarative voice whether a claim
was actually observed in the tree or merely inferred from a design doc or prior assumption.
Nothing between composition and filing checked a claim like "module X reads field Y" or "subsystem
Z is absent" against the real checkout. Two premises in one private decomposition were wrong and
both were falsifiable with one grep: a claimed-absent dependency subsystem was present on the
branch, and a claimed field-read never actually happened (the module was write-only). Both survived
to build/review time before the true state was re-derived.

## The check (bounded, not exhaustive)

After a sub-issue's (or shaped record's) `## Current State`/`### Key Files` text is composed,
scan it for sentences that assert, about this repo's own code:

- a named file, module, subsystem, or symbol **exists** or **is absent**, or
- a named module **reads, writes, or calls** a named field or function.

For each such claim, run at most **2 probes per claim** — `git ls-files` for an existence/absence
claim, `git grep -n -F` for a reads/writes/calls claim — against the checkout the composing step is
running in (a decomposition worktree can be behind `main`; the probe answers for the checkout it
runs in, which is the checkout the build will start from — never re-point the probe at `main`).
Cap the whole pass at **12 probes per sub-issue** (or per shaped record). This is a screen,
not an exhaustive audit: it stays one step, the same bounded-cost shape `challenge/SKILL.md`'s
bare-`#N` evidence search already uses.

**Confirmed claim** — the probe corroborates the sentence. Keep the sentence, and append an inline
citation: `path:line` for a reads/writes/calls claim (the grep hit), or the bare `git ls-files`
hit for an existence claim (the file path itself is the citation for "exists"; for "is absent",
cite the negative result — "confirmed absent: `git ls-files -- {pattern}` returns nothing").

**Contradicted claim** — the probe disproves the sentence. Rewrite the sentence to what the tree
actually shows, before the body is filed — never file the false claim with a caveat appended.

**Unsettled claim** — the caps are exhausted, or the claim depends on something no probe in this
checkout can resolve (a sibling unit's not-yet-built output, an external system, a runtime
behavior no grep reaches). Move it out of `## Current State`'s declarative voice entirely, into a
`## Gotchas` bullet with the literal prefix:

```
ASSUMPTION — verify at build: {the claim} — confirm with {what probe/action would settle it}
```

`specify/spec-template.md`'s `## Gotchas` section shows the marker's exact shape, and its "No
Placeholders" self-check rejects a `## Current State`/`### Key Files` sentence that asserts a fact
about existing code with neither a citation nor this marker.

## Boundary with dependency-narration-check

This check is about the **truth of current-state claims** about code that already exists (or
doesn't) in this repo. `_shared/dependency-narration-check.md` is about a different failure: a
record narrating **another record's own not-yet-merged follow-up** as already-landed fact. A
sentence citing another record by number without implying a dependency ("similar to #309's fix")
is neither check's concern — judge intent, not the presence of a `#` token or a file path.

## Callers

| Caller | When it runs |
|---|---|
| `specify/record-creation-subissues.md`'s per-sub-issue loop | After the sub-issue's body (`## Current State`/`### Key Files`) is composed, before the Ceremony and Framing calls — this record's own number does not exist yet, same pre-numbering window those two calls already run in. A contradicted claim is rewritten before `gh issue create` / `createRecord`. |
| `specify/shaping-mode.md`'s cheap sanity check (human-filed defect reports) | Its existing paragraph — grep the named file/function/error string a defect report cites before shaping — is this check's degenerate one-claim case; the paragraph now points here instead of restating the rule, keeping its own defect-report-specific framing (a miss doesn't necessarily mean the report is wrong; it's a fact-check worth doing at shaping time rather than mid-build). |
| `build/SKILL.md`'s writing-plans handoff (Spec Step 3) | Before invoking `/superpowers:writing-plans`, every `ASSUMPTION — verify at build:` bullet in the spec's `## Gotchas` is re-verified against the worktree with the same probe forms above. The outcome (confirmed, or reversed with the probe that reversed it) is logged as one `decisions.md` line per `_shared/auto-decision-log.md`. A reversed assumption is folded into the context handed to `/superpowers:writing-plans` as the corrected fact — never silently dropped, and never left standing as the original (now-known-false) claim. |
