# Design: Per-record public release notes

## Problem

This repo's release output today is either a single hand-typed summary
sentence (`plugin/bin/release.js`'s `stubChangelogEntry`, used only for this
repo's own maintainer-only releases) or, once #2259 migrates this repo onto
the shipped engine, an automatically generated list of raw conventional-commit
subjects (release-please, and `bin/release-local.js` for `local-merge`
projects). Neither produces anything close to what a plugin consumer reads in
an upstream tool's release notes — e.g. Claude Code's own GitHub releases,
which are a flat list of plain-language, verb-first lines ("Added a visible
warning when memory usage is critical…", "Fixed sessions getting stuck
endlessly retrying…") with no issue numbers, file paths, or internal module
names.

Record #2250 (the design that produced the shipped release skill) explicitly
named this a non-goal: "Enriching release notes beyond what the conventional
subject carries… revisit only if consumers ask." This design is that
revisit.

## Goals

- Every merged record contributes one plain-language, verb-first note line
  to the release that ships it — no exceptions, no opt-in field to remember.
- The note is authored by whoever holds the record's context (the human or
  agent writing the spec / doing the build), not reconstructed later from a
  bare commit subject or diff.
- One authored line renders in two places at two levels of detail from one
  source: the existing maintainer-facing CHANGELOG/commit history (which
  already keeps record numbers, technical detail, and the raw conventional
  subject), and a new public-facing block containing only the plain-language
  lines, grouped by nothing but merge order.
- Works identically under both integration models this repo's design already
  supports — pr-first (release-please) and local-merge (`bin/release-local.js`).

## Non-Goals

- Retroactively backfilling notes for already-merged records. A record
  merged before this ships, or through a path that bypassed the composer,
  has no note; the renderer skips it rather than erroring.
- Grouping the public list under type-derived headings ("Features"/"Bug
  Fixes"). Claude Code's own list — the format this design targets — is a
  flat list where each line's leading word ("Added", "Fixed", "Changed",
  "Improved") carries the category. Deriving that mechanically from the
  commit's `feat`/`fix`/`chore` type would misclassify the moment a `chore`
  record is user-visible or a `fix` reads better as a "Changed". The authored
  line carries its own category by convention, not by lookup.
- Enriching or rewording the note automatically at release time (e.g. an LLM
  pass over merged PRs). The note is authored once, at merge time, by the
  agent with the most context; a release-time rewrite pass would be strictly
  worse (more expensive, further from the source, non-reproducible) than
  something already written faithfully once.
- Anything in `plugin/bin/release.js` / `plugin/bin/lib/release/{compose,run,
  status,unnamed-records,mirror}.js`. That tooling is retiring under #2259;
  building this into it would be thrown away the moment #2259 lands.

## Dependency

This design targets the **shipped** release engine
(`plugin/bin/lib/release/subject.js`'s `composeSubject`, release-please, and
`bin/release-local.js`), which is what every consuming project — including
this repo, post-migration — actually runs. The pr-first half of this design
attaches to a `release: published` workflow trigger that does not exist in
this repo until #2259 lands (`.github/workflows/mirror-marketplace.yml`).
**This work is blocked on #2259.** The local-merge half has no such
dependency and could ship independently if #2259 stalls.

## Design

### 1. Authoring: a new required spec section

`/claude-tweaks:specify`'s shaping mode already composes a fixed set of
sections into a record's body (`## Current State`, `## Deliverables`,
`## Acceptance Criteria`, …) and conditionally stamps `## Breaking Change`
when the `breaking` label is set (`shaping-mode-stamping.md`). This design
adds `## Release Note` as an **unconditionally required** section, composed
alongside the others by whoever writes the spec body (human or agent) —
one plain-language, verb-first sentence describing what a plugin user or
end consumer of the change would notice, with no record numbers, file
paths, or internal identifiers. `_shared/work-record.md`'s spec-shaped-body
check, which already verifies Current State/Deliverables/Acceptance Criteria
are present and non-empty before the authorization gate grants anything,
gains this section to the same list.

Example: a record whose title is "escalate-residue.js: structurally-stuck
resolve/escalate re-fetch…" might carry `## Release Note`: "Fixed a case
where a stuck escalation could be re-opened after it was already resolved."

The section must be a single line. This mirrors an existing constraint the
codebase already lives with silently: `BREAKING_FOOTER_RE` in
`bin/lib/release-local/commits.js` parses a `BREAKING CHANGE:` footer with
`/^BREAKING[ -]CHANGE: ?(.*)$/m`, which captures only the first line back out
regardless of how many lines `## Breaking Change` actually contained at
compose time. `Release-Note:` uses the identical single-line round trip, so
the constraint is stated explicitly here rather than left to be discovered
the same way.

### 2. Composition: `composeSubject` gains a required `releaseNote` field

`plugin/bin/lib/release/subject.js`'s `composeSubject({ ..., releaseNote })`
gains a new required string parameter, validated the same way `breaking`/
`migrationNote` already are: empty or missing throws
(`ComposeSubjectError`), citing the record number. The commit body gains one
new paragraph, `Release-Note: <line>`, inserted after the existing
summary/tag paragraph and before the `Fixes #n` footer.

`plugin/bin/lib/compose-subject.js` — the CLI wrapper that derives
`composeSubject`'s inputs from a GitHub record via `gh issue view`, the way
it already derives `migrationNote` via `extractSection(body, 'Breaking
Change')` — derives `releaseNote` via `extractSection(body, 'Release
Note')`, unconditionally (not gated behind a label the way `breaking` gates
`migrationNote`), and fails loudly with the same posture as the existing
missing-`## Breaking Change` check when the section is absent or empty.

This is the one contract change every merge site inherits: pr-first squash
merges and all four local-merge call sites that currently call
`compose-subject.js` gain a required input. No call site changes its own
logic — the composer already centralizes this per `subject.js`'s own header
comment ("the ONE merge-subject/body composer every merge site calls").

### 3. Rendering: one shared, header-free renderer

A new module, `plugin/bin/lib/release-notes.js`, exports a pure function
that takes a list of commits (each optionally carrying a `releaseNote`
string) and returns a flat Markdown bullet list, one line per commit that
has a note, in commit order, skipping any that don't:

```js
function renderReleaseNotes(commits) {
  const lines = commits.filter((c) => c.releaseNote).map((c) => `* ${c.releaseNote}`);
  return lines.length ? lines.join('\n') : null;
}
```

No headers, no type-based grouping (Non-Goals). This is deliberately the
entire module — extraction and formatting only.

### 4. Local-merge wiring

`plugin/bin/lib/release-local/commits.js`'s `parseCommit` gains a
`Release-Note: ?(.*)` footer extraction from the commit body, mirroring the
existing `BREAKING_FOOTER_RE` pattern exactly (same regex shape, same
placement in the returned commit object as a new `releaseNote` field).

`plugin/bin/lib/release-local/changelog.js`'s `renderSection` calls
`renderReleaseNotes` and, when it returns non-null, appends the block under
a new heading — e.g. `### Highlights` — placed after the existing
`### ⚠ BREAKING CHANGES` block and before the type-grouped sections, in the
same version-heading entry it already writes to CHANGELOG.md. No new
workflow: this engine runs synchronously with full commit data already
parsed in memory.

### 5. Pr-first wiring

release-please has no knowledge of this repo's custom `Release-Note:`
trailer and will not render it. Rather than depend on undocumented behavior
of editing release-please's own PR branch mid-flight (untested, and this
design makes no claim about whether such an edit would survive into the
eventual published release body), this design adds a **new step triggered
on `release: published`** — the same event #2259's `mirror-marketplace.yml`
already uses — that:

1. Resolves the previous and newly-published tags.
2. Walks first-parent commits between them (`git log --first-parent`).
3. Extracts `Release-Note:` footers with the same regex as local-merge's
   `commits.js`.
4. Renders the block via the same `renderReleaseNotes` module.
5. Applies it two ways: `gh release edit <tag> --notes-file -` (or
   equivalent) to append the block to the already-published GitHub Release
   body, and a small follow-up commit appending the same block into
   CHANGELOG.md's just-written entry for that version.

This runs after publish, against the final merged commit range, so it has
no dependency on release-please's internal PR-generation behavior — only on
`git log` and the `gh` CLI, both already used elsewhere in this repo's
tooling.

### Failure mode

A commit with no `Release-Note:` footer (pre-adoption history, or a merge
that bypassed the composer) is silently skipped by `renderReleaseNotes` —
never an error at render time. Enforcement lives entirely at authoring time
(`composeSubject` throwing) and cannot be retrofitted onto history that
already exists.

## Testing

- `subject.test.js` (kept per #2259's retention list): a `composeSubject`
  test asserting it throws on missing/empty `releaseNote`, and that a
  present one produces the `Release-Note:` body paragraph in the right
  position.
- A new `release-notes.test.js` for the shared renderer: empty input, mixed
  commits with and without notes, ordering.
- `commits.test.js`: extend with a `Release-Note:` footer fixture, mirroring
  the existing `BREAKING CHANGE:` footer test.
- `changelog-fixture.test.js`: extend the captured fixture to include a
  `### Highlights` block, re-pinned against a real rendered example.
- One new fixture test for the pr-first post-publish step (commit-range
  walk → rendered block → both apply targets), run against a fixture repo
  rather than a live release (per this repo's own rule against invoking a
  live release engine as a test).

## Open items carried forward, not decided here

- Exact heading text for the local-merge block (`### Highlights` used above
  as a placeholder) — a naming call for the implementation plan, not an
  architectural one.
- Whether the pr-first post-publish step lives in `mirror-marketplace.yml`
  itself or a sibling workflow file — both trigger on the same event; the
  implementation plan can decide based on #2259's actual file layout once
  that PR exists.
