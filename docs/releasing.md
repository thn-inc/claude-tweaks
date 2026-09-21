# Releasing

This repo dogfoods the same release engine every consumer project uses: `/claude-tweaks:release`, driving release-please under `integration-model: pr-first`.

**The whole-branch review still gates the bump** — `/claude-tweaks:release`'s Step 3 runs `/claude-tweaks:review base:{lastTag}` unconditionally, before any merge, for the same reason this always applied: a plan that schedules its version bump as the final step has, by that ordering alone, decided that any cross-task defect ships and is fixed as a patch (`[IL-97]`).

**Invocation:** `/claude-tweaks:release` (no arguments for the on-demand path; `--train` for the scheduled release-train Routine). It reads the preflight fact pack, renders one console, merges the release-please PR via `gh pr merge --squash`, verifies the resulting tag/GitHub Release/`release: published` workflow run, and books the shipped records. Full procedure: `plugin/skills/release/SKILL.md`.

**What replaced `plugin/bin/release.js`:** release-please (`googleapis/release-please-action@v4`, `.github/workflows/release-please.yml`) computes the version from Conventional Commits on `main` and opens/updates a standing release PR; merging that PR is the bump. `release-please-config.json` pins `release-type: simple` with `plugin/.claude-plugin/plugin.json`'s `$.version` as an `extra-files` target; `.release-please-manifest.json` tracks the current version. History before the migration (bootstrapped 2026-09-21) was retro-tagged onto real `v*` git tags — see `docs/decisions/0018-release-please-engine.md`.

**The marketplace mirror** is now `.github/workflows/mirror-marketplace.yml`, triggered on `release: published` — the same catalog write `plugin/bin/lib/release/mirror.js` used to perform by hand, preserving its two invariants: the catalog entry is pinned by `sha` (never `ref`), and carries no `version` field (the payload's own `plugin/.claude-plugin/plugin.json` is the single version authority).

## After the merge: which release carried it

Unchanged — `_shared/pr-first-merge-post-merge.md` Step 4.1 answers this from tag ancestry alone:

```
git describe --tags --contains --first-parent --match 'v*' <merge-sha>
```
