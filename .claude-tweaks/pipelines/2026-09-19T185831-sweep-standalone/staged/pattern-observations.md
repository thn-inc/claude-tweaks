# Staged: cross-spec pattern observations (8)

Finding: `[pattern]`/`[health]` Step 5.5 scan — "Add rule to CLAUDE.md" recommendations, always
staged (CLAUDE.md is never edited autonomously).

1. **Convention** — `gh --version`-style availability checks duplicated 6+ times, drifting
   options. Extract a shared `ghAvailable()` helper.
2. **Error Handling** — blanket `catch` masks error types in several `#2254` sites. Add rule: name
   error types, `instanceof`-gate before a catch-all rethrow.
3. **Architecture** — new exports (CANDIDATE_RE, extractSection, typeOf, shapeGate/REQUIRED_SECTIONS)
   duplicate existing implementations, unaudited. Add a consolidation-audit step to code review.
4. **Convention** — prose restatements of `_shared/` contracts go stale as the contract grows
   (`#1991`/`#1992`, `#2580`/`#2581`). Add rule: cite, never restate.
5. **Testing** (low) — load-sensitive wall-clock test assertions fail under load, pass isolated.
   Add rule: avoid wall-clock assertions.
6. **Skill docs** (low) — deliberate asymmetries not checked against the record's own issue text
   before staging a fix. Enrich `review/step3-lens-dispatch.md` / `skill-authoring.md`.
7. **File responsibility** (low) — several files sit within ~1KB of the 40KB ceiling. Add a
   pre-edit `wc -c` audit habit for near-ceiling files.
8. **[health]** — 10+ specs shipped in the last 8 weeks; recurring themes above. Consolidate into
   `.claude/rules/`, prioritizing the gh-availability and error-type items.

No mechanical fix — a human judges which of these, if any, become CLAUDE.md/`.claude/rules/`
entries.
