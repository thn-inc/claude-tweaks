# Dependency-Narration Check

Authoring-time safeguard, referenced by `capture/SKILL.md`'s Shaped-body branch and
`specify/shaping-mode.md`'s body-edit step (that file's own Dependency-narration check
subsection). Runs whenever either skill composes or edits a record's `## Current State`/
`## Deliverables` content, before the record is filed or written.

## What it catches

A record's `## Current State` (or `## Deliverables`) narrates another record's not-yet-merged
work as an already-existing fact — "added in a #309 fix-wave follow-up", "introduced by #N's
follow-up", "will be added by #N" — with no corresponding `blocked-by:`/`Blocked by #N` edge.
Record #1315's materialized spec did exactly this against #309, which was still open and
unimplemented; nothing structural deferred the record, and `/claude-tweaks:build`'s own late
prerequisite-check grep only caught the gap three attempts deep, per the dispatch retry ceiling.

## The check (content judgment, not a keyword match)

Read the composed `## Current State` + `## Deliverables` text. Does any sentence present
another record/PR's follow-up work as **settled fact this record now depends on or builds
on** — not merely a citation ("similar to the fix in #309", "see #309 for precedent")? A hit
names a specific record/PR number `#N` whose work the sentence treats as already landed.

On a hit, verify `#N` is real and still open: `gh issue view {n} --json state,number` (or the
`local-files` equivalent). A closed/merged `#N` needs no edge — the narrated premise already
holds. No `blocked-by:`/`Blocked by #N`/native blocked-by edge on this record already names
`#N` → this is a genuine gap.

**False positive to avoid:** a record can legitimately reference another record by number
without implying a dependency. Judge intent, not the presence of a `#` token.

## Populating the edge

Branch on the project's `work-links` config key (`_shared/work-record-config.md`):

- **`work-links: native`, `work-backend: github-issues`** — once this record's own number is
  known (post-create for a fresh `/capture`; already known for a record `/specify` is shaping
  in place), run `node "${CLAUDE_PLUGIN_ROOT}/bin/link-records.js" --blocked-by
  "{this-record-num}:{n}"` — the same CLI `specify/record-creation-linking.md`'s Linking step
  uses for sub-issue dependencies. `gh` absent, or the CLI's own exit-2 no-`gh` signal → degrade
  to the `body-text` branch below via a follow-up `gh issue edit`.
- **`work-links: body-text`, `work-backend: github-issues`** — add one `Blocked by #{n}` line to
  the record's body (line-anchored, matching `record-dependencies.js`'s `DEP_RE`) before filing/writing — for
  a fresh `/capture`, fold it into the composed `header` alongside any lifted `Origin:`/
  `Defer-reason:` lines; for `/specify` shaping a record in place, add it to the metadata block
  at the top of the composed body, the same placement `Parent: #N` already uses.
- **`work-backend: local-files`** — set `facets.blockedBy` to include `{n}` on the
  `createRecord`/`writeRecord` call.

**Auto-populate always** — never a prompt, in interactive or auto/headless mode alike. The edge
is additive and reversible (removable later if the judgment call turns out wrong), and both
callers already run mostly headless. Note the outcome inline: `Detected reference to #{n}'s
not-yet-merged follow-up — added blocked-by: #{n}.`

## Callers

| Caller | When it runs |
|---|---|
| `capture/SKILL.md`'s Shaped-body branch | After determining the body is shaped, before Backend Selection's filing call — decides what to add to `header`/`facets.blockedBy`; the `native` branch's `link-records.js` call runs after the create call lands |
| `specify/shaping-mode.md`'s body-edit step | After composing `## Current State`/`## Deliverables`, before the compose-then-write-once call (`shaping-mode-stamping.md`) — this record's own number is already known, so native linking runs immediately, same call |
