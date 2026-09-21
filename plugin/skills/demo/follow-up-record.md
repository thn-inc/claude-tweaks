# Demo Step 3 — Filing the Follow-Up Record

Referenced by `skills/demo/SKILL.md` Step 3 (both the label-backed and the session-recall
**Request changes** branches) and Step 2's Scope-fork checkpoint ("Capture it"). Read only when a
Request-changes verdict was given or a scope-fork capture was chosen — an Approve or Skip verdict
never reads this file. Step 3's Request-changes items 2 and 3, verbatim (item 1, the label swap,
stays in `SKILL.md`); a session-recall entry runs the same procedure with no original record to
relabel, comment on, or reference, and its `Origin:` line reads `Origin: demo changes-requested
from session recall`; a scope-fork capture's `Origin:` line reads `Origin: demo scope-fork from
#{n}` (or `from session recall`).

  2. File a linked follow-up record: backlog stage (no `ready` — a one-line reason isn't
     spec-shaped), Type `bug` by default (override to `feature`/`task` when the reason clearly
     describes new scope, not a defect), no `by:*` label — instead a body line
     `Origin: demo changes-requested from #{n}` per `_shared/work-record.md`'s side-effect-record
     convention — plus the reason and a link back to the original. `work-backend: github-issues`:
     use the same `recordPayload` composition `/claude-tweaks:capture` uses
     (`bin/lib/issues/record.js`), just without invoking `/claude-tweaks:capture` itself —
     and, unlike `/claude-tweaks:capture`'s own call, **omit the `origin` field entirely** rather than passing
     `origin:'demo'`: `record.js`'s `ORIGINS` enum has no `'demo'` entry, so passing it throws;
     omitting `origin` is also what keeps this follow-up label-free, consistent with the
     "no `by:*` label" requirement above (`recordPayload` only pushes a `by:*` label when
     `origin` is set).
     `work-backend: local-files`: use `createRecord(dir, { slug, title, body, facets })` from
     `bin/lib/issues/local-store.js` — `title` is the reason text just collected, `body` is the
     reason plus the link back to the original plus the `Origin:` line above, `facets: { type,
     stage: 'backlog' }` (`type` being `bug` or the overridden type). Compute `slug` via that
     same module's `deriveSlug(title, existingSlugs)`. Never `allocateId`+`writeRecord`
     separately — same allocateId+writeRecord race `capture/SKILL.md`'s Backend Selection
     section documents (two near-simultaneous filings, e.g. two `/claude-tweaks:demo` "Request changes"
     verdicts landing in the same run, or `/claude-tweaks:demo` racing a `/claude-tweaks:capture`/`/claude-tweaks:specify` decomposition,
     can silently share one numeric id); see that section for the full call shape to mirror.
  3. Note the bidirectional link back on the original record. `work-backend: github-issues`:
     comment on the original issue with the new follow-up's issue number. `work-backend:
     local-files`: there is no comment mechanism (same constraint `verification-brief.md` and
     `_shared/work-record.md` already document) — append a short note with the follow-up's id to
     the original record's body instead, via the same `readRecord`/`writeRecord` round trip.
