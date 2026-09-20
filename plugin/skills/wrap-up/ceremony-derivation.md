# Diff-derived ceremony default (auto-mode firings, #1545)

**Already `fast-lane`? Skip this file.** If `config.yml`'s `ceremony-profile` already reads
`fast-lane` (a header-set value, not a diff-derived one), there is nothing left for this
file's derivation logic to do — go straight to `_shared/fast-lane-digest.md`'s wrap-up section.
This file matters only for an `auto`-mode run whose header default is still `standard`. What each profile skips is rostered in `_shared/ceremony-profile.md`; this file only decides which profile an `auto`-mode run gets.

Cited from `SKILL.md`'s Phase 1, right before the Reflect step reads `config.yml`'s
`ceremony-profile`. flow's Manifesto computes that value by folding every record's own
`ceremony:` header label (set at `/specify` shaping time) — before any code exists to inspect —
so a headless firing whose actual diff turns out small and low-surface still ran the full
`standard` ceremony if no record's label said `fast-lane`. Evidence: Dispatch hub run #9,
2026-08-26 — a +75/-2 test file plus its own materialized spec doc ran full-mode reflect, the
complete registry pass, and a residue sweep, ~8 of the firing's 43 minutes on ceremony nothing
acted on.

Skip entirely when `config.yml`'s `mode` is not `auto` — under `confirm`, `hybrid`, or `interactive`
the Manifesto presented `ceremony-profile` as a real question and its value may be a human's answer,
never to be clobbered — or when no `config.yml` exists (standalone wrap-up). In `auto` mode the
Manifesto is a read-only FYI table (`flow/manifesto.md`'s auto-mode variant never calls
`AskUserQuestion`), so nobody could have adjusted the lever whether or not a person was watching
the run (#1932; the earlier headless-only gate left a human-present `auto` run paying the
full `standard` ceremony for a `size:low` single-module fix — 12 minutes of full-mode reflect on
#1535). The gate is `shouldDerive({mode, ceremonyProfile})` in
`bin/lib/dispatch/ceremony-derive.js` — true only when `mode` is `auto` and `ceremony-profile`
currently reads `standard`, the header-fold default (`flow/manifesto.md`'s Ceremony profile
computation), so there is nothing here to clobber:

1. Compute this run's diff facts via `node "${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/ceremony-derive.js"`'s
   `computeDiffFacts` over `git diff --numstat` against the run's own merge-base (the same facts
   shape `blast-radius-cli.js`'s `computeBlastRadius` already derives for the merge-check verdict —
   reuse `classifyDiffFiles`/`blastRadiusSummary`, don't re-derive).
2. When the diff touches zero production/implementation files — any mix of test and/or docs files
   only (`deriveCeremonyProfile`'s `lowSurface` classification; a test file plus a small amount of
   production code stays disqualified — a real behavioral change riding along with its own
   regression test must still default to `standard`) — downgrade **the ceremony requirement**, i.e.
   set `config.yml`'s `ceremony-profile` to `fast-lane` via the sanctioned writer:
   `node "${CLAUDE_PLUGIN_ROOT}/bin/set-config.js" --run "$PIPELINE_RUN_DIR" --key ceremony-profile --value fast-lane`.
3. Log: `AUTO {time} — Ceremony profile derived from diff: low-surface ({file-count} file(s), 0 production files) — header-fold default (standard) replaced with fast-lane.`

This never *upgrades* toward `standard` on its own — the diff-derived default only ever narrows a
`standard` default down to `fast-lane` for a diff this small; the Ceremony escape hatch (below
Reflect in `SKILL.md`) remains the only path back up to `standard`, and runs strictly after this
step, so a review/reflect safety finding on THIS run still overrides whatever this derivation just
set. A diff that is neither test-only nor docs-only leaves `config.yml` untouched — the
header-fold's `standard` default stands.
