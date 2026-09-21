# 0018. This repo releases through the engine it ships, not a parallel one

- **Status:** accepted
- **Date:** 2026-09-21
- **Context:** #2259; the shipped release path it adopts — #2253 (bootstrap), #2254 (local engine), #2255 (preflight pack), #2256 (the `/claude-tweaks:release` skill), #2257 (`git describe` ancestry check), #2258 (release train)

## Context

Until this record, claude-tweaks released itself through `plugin/bin/release.js` — a
hand-rolled one-command engine (5-source collision pre-check, unnamed-merge gate,
bump + CHANGELOG + `docs/shipped-versions.tsv` in one commit, push, marketplace mirror)
that no consumer of the plugin could ever run. Meanwhile #2253–#2258 built and shipped a
second, entirely different release path for consumers: `/claude-tweaks:release` driving
release-please under `pr-first`, or `bin/release-local.js` under `local-merge`.

Two engines for one act is expensive in the specific way this repo cares about: the shipped
one was exercised only by fixture tests and other people's projects, while the maintainer's
own muscle memory and every release-shaped incident came from the unshipped one. `[IL-97]`'s
whole-branch-review lesson had to be encoded twice; `docs/releasing.md` had to carry a
standing paragraph explaining that the skill in `plugin/skills/release/` was *not* this
repo's release path. Neither engine could be retired by fiat: the shipped one could not
release this repo as it stood (no `release-please-config.json`, no `v*` tag, a first-parent
history of unconventional `{Verb} {what}` subjects, so the preflight pack degraded to
nothing-to-release), and the hand-rolled one was load-bearing until that was fixed.

## Decision

**This repo dogfoods `/claude-tweaks:release`.** release-please is bootstrapped here
(`release-please-config.json` with `release-type: simple` and `plugin/.claude-plugin/plugin.json`'s
`$.version` as an `extra-files` target, `.release-please-manifest.json`,
`.github/workflows/release-please.yml`); the marketplace mirror became
`.github/workflows/mirror-marketplace.yml` on `release: published`, preserving the two
invariants the hand-rolled mirror enforced (pinned by `sha`, never `ref`; no `version` field
in the catalog entry). `plugin/bin/release.js` and its release-only siblings — `compose.js`,
`mirror.js`, `status.js`, `unnamed-records.js`, `shipped-record.js`, `changelog-git.js` — and
`docs/shipped-versions.tsv` are deleted. A defect in the release path is now a defect every
consumer feels, which is the point: the engine gets exercised by the person best placed to
fix it.

### Pre-migration history was retro-tagged, not left untagged

Every release before the migration was recorded only in `CHANGELOG.md` and
`docs/shipped-versions.tsv`; the repo had no `v*` tags at all. The cheap option was to start
tagging from the migration forward and accept that tag-based tooling answers "unknown" for
everything older. That was rejected. #2257 replaced the `release.js status --backfill`
mechanism with a plain ancestry question —
`git describe --tags --contains --first-parent --match 'v*' <merge-sha>` — and a tool that
silently returns "not yet in a release" for every merge older than the migration is worse
than one that has no answer at all: "no containing tag yet" and "this merge genuinely predates
every tag that exists" are textually identical outcomes, and the wrong one is the
safe-looking one. So the whole history was
tagged: a one-time script resolved 276 `docs/shipped-versions.tsv` lines into **259 annotated
`v*` tags**, excluding 17 — 13 documented-but-never-committed reservations, 2
non-strict-semver `4.5.0-phase*` strings with no CHANGELOG heading of their own, and 2
`wip-never-shipped` lines whose own CHANGELOG entries say the number never reached `main`'s
tip.

The resolver's first design picked the chronologically later commit whenever two commits set
the same version. A hand cross-check against CHANGELOG headings found that rule wrong in at
least 4 of 11 collisions — the later candidate is routinely a subsequent worktree's bare
"merge origin/main" commit that inherited an already-published number. The heuristic was
dropped entirely in favour of **10 explicit per-version overrides**, each carrying its own
cited evidence (a verbatim CHANGELOG-heading match, or a reconciling merge whose message
names the renumber). The tooling that did this was deleted once it had run: it is a one-shot
migration script whose inputs (`docs/shipped-versions.tsv`) no longer exist, so keeping it
would leave an unrunnable script that reads as live tooling.

### `run.js` and `precheck.js` were kept, not retired

The retirement sweep deleted every module that existed only to serve `release.js`. Two did
not: `plugin/bin/lib/release/precheck.js` (the version-collision pre-check, parameterised by
`keySource` — the hand-rolled engine passed `'tsv'`, `release-local.js` passes `'tags'`) and
`plugin/bin/lib/release/run.js` (the branch/clean-tree guard and the
fetch → ancestry re-check → push ordering). Both are real dependencies of
`plugin/bin/release-local.js`, the consumer-facing `local-merge` engine, which ships and is
not going away. Deleting them because their *other* caller died would have been a retirement
sweep that broke a shipped consumer. `precheck.js`'s now-dead `keySource: 'tsv'` branch was
removed with the tsv itself; the module keeps only the `'tags'` path it is actually called
with. `nextVersion` was relocated out of the deleted `changelog-git.js` into
`plugin/bin/lib/changelog.js` for the same reason — one surviving consumer, so the function
moves rather than dies.

### The CHANGELOG keeps its pre-migration grammar

Entries written before the migration keep their `## vX.Y.Z — {summary}` heading form and
their bodies verbatim. They are **not** rewritten into release-please's
`## [X.Y.Z](compare-url) (date)` grammar, and the `###` labels this repo invented
("branch-numbered vX.Y.Z", "also carried in this build") stay exactly as they were.

The argument for rewriting is uniformity: one grammar, one parser, a file that reads as
though it had always been machine-generated. It is rejected on the same grounds
`docs/incident-log.md` and the ADRs are never rewritten to reflect later changes. A CHANGELOG
entry is a claim about what was documented at the time it was written, and 103 of the first
145 releases went undocumented (`[IL-94]`) — restating those reconstructions in
release-please's grammar would present them as contemporaneous machine-generated release
notes, which is exactly what they are not. The two grammars are therefore both correct, each
for its own era, and the file is to carry a comment marking the boundary between them rather
than a uniformity that would have to lie about the older half. That marker is not yet in
`CHANGELOG.md`: where release-please inserts a generated entry relative to a leading HTML
comment is not observable until the first real release-please entry lands, and a marker whose
stated orientation ("above" vs. "below") is wrong is worse than none at all.

## Alternatives considered

- **Keep both engines, dogfood nothing.** The status quo. Rejected: it is the arrangement
  that let `[IL-97]`'s lesson be encoded twice and let the shipped path go unexercised by its
  own author. The cost is paid continuously and invisibly.
- **Migrate to release-please but skip retro-tagging.** Cheaper by a day, and it would have
  worked for every release *after* the migration. Rejected for the silent-fallback reason
  above: #2257's ancestry check is now the only answer to "which release carried this merge",
  and it must not answer confidently and wrongly for the 259 releases that predate the
  migration.
- **Rewrite the CHANGELOG into release-please grammar.** Rejected above — uniformity bought
  by misrepresenting what was documented when.
- **Keep `plugin/bin/release.js` as an emergency fallback.** Rejected: a fallback nobody
  exercises is a fallback that has silently rotted by the time it is reached, and its inputs
  (`docs/shipped-versions.tsv`) are gone. The documented recovery for a failed release is
  `/claude-tweaks:release`'s own named-partial-state-plus-recovery-command contract, not a
  second engine.
