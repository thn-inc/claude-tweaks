---
name: work-record-facet-rename
description: Use when renaming a work-record facet or its GitHub label in this repo, or splitting one overloaded label into two — the emit/read split, the permanent legacy fallbacks, the label-bootstrap version bump, the emit-side rejection guard, the live-repo migration, and the repo-wide vocabulary sweep. Keywords - facet rename, label rename, label split, LABELS, parseRecordFacets, parseFrontmatterLines, sharedFacetDefaults, LABELS_JSON, LABEL_BOOTSTRAP_VERSION, IL-85, migrate-then-delete.
---

# Work-record facet rename

How this repo renames a work-record facet and the GitHub label / frontmatter line that carries it. Three shipped instances define the recipe: `effort:*` → `size:*` (#217), `family:parent` → `parent-issue`, and `framing:baked` → `solution:unjustified` (#677). Each left a permanent read-side fallback behind; a fourth rename should follow the same layers in the same order.

## The layers, in commit order

1. **Drivers + shared shape (one commit, TDD).** `plugin/bin/lib/issues/facet-shape.js` `sharedFacetDefaults()` is the single place the facet key is renamed — both drivers inherit it, so a missed reader surfaces as an `undefined` facet, never a silent `false`. `plugin/bin/lib/issues/record.js`: add the new `LABELS` constant, keep the retired constant commented read-side-only, emit only the new label in `recordPayload`, and let `parseRecordFacets` accept either spelling through one OR branch into the single new key. `plugin/bin/lib/issues/local-store.js`: read the new frontmatter line into the facet and set a `sawNew` flag; the legacy line only fills a fallback variable applied after the loop and only when no new line was seen; `serializeFrontmatter` writes the new line only. Update `tests/bin-lib/issues/{record,local-store,backlog}.test.js` fixtures and add: both spellings parse; emit is new-only; frontmatter precedence in BOTH line orders; migrate-on-write drops the legacy line; the facets object has no old key.
2. **Label set + bootstrap version (one commit).** Swap the row in `plugin/skills/_shared/label-bootstrap.md`'s `LABELS_JSON` fence (description ≤ 100 chars — `tests/bin-lib/issues/labels.test.js` reads the fence and enforces the cap) and bump `LABEL_BOOTSTRAP_VERSION` in the same edit — without the bump, existing repos keep the stale marker and never re-provision the new label.
3. **Contract + producer/reader prose.** `plugin/skills/_shared/work-record.md` (taxonomy row, the `Retired names:` line) and `plugin/skills/_shared/work-record-permission-matrix.md` (the permission matrix itself — extracted out of `work-record.md` in #1488, which left only a three-line pointer behind), then every skill instruction that names the label or facet key (`plugin/skills/specify/*`, `plugin/skills/help/*`, `plugin/skills/backlog/*`, `plugin/skills/capture`, `plugin/skills/feedback`, …), then `docs/getting-started.md` and `docs/skill-graph.md`. Keep a deliberate "or its pre-rename spelling `X`" clause wherever a reader must still recognise old records.
4. **Journeys and launcher commands** — table column headings, `# ⚠` annotation lines and paste-ready `/claude-tweaks:*` commands each carry the vocabulary separately.
5. **Live-repo migration, last.** Re-read the label's live carriers and the label's own existence right before writing (a spec's carrier list is a hypothesis in a multi-session repo), add the new label to every carrier, verify, then delete the old label. Never delete first. Adopter repos are covered by the read-side fallbacks, never by migration.

## Variant: splitting an overloaded label

A **split** — one label whose meaning grew two senses, one of which moves to a new label — reuses the layers above, but not all of them. `bot:blocked` → `bot:blocked` (retry ceiling, grants revoked) + `bot:parked` (merge-verification park, grants intact) is the shipped instance (#605).

- **Layers 1-4 apply unchanged**, with one addition at layer 2: add the `LABELS_JSON` row *and* narrow the surviving label's own description in the same edit, then bump `LABEL_BOOTSTRAP_VERSION` — a split adds a label, so the bump rule fires exactly as for a rename.
- **Layer 5 and the rename-only conventions do not apply**: no read-side legacy fallback, no emit-side rejection guard, nothing to delete last. The old label is not retired — it survives with a narrowed meaning, so there is no second spelling for a reader to accept.
- **The sweep asks a different question.** In a rename every hit on the old spelling is mechanical (swap it). In a split each hit must be *classified*: does this site mean the narrowed sense, the split-off sense, or both? Every site that branched on the old label needs an explicit decision about whether the new one belongs beside it — #605's were `record-buckets.js` (`isBotParked` beside `isBotBlocked`), `pending-authorization.js`, `github-pr-scan.md`'s `[pr-unarmed]` exclusion, `dispatch/queue-pull-script.md`'s eligibility filter, `tidy`'s record shapes, and `backlog/refine-mode.md`'s re-triage row. Prose lags code here: #605 left four `_shared` files still describing the merge-verification park under the old label while their own code branched on both.
- **A new finding shape needs a routing home.** A split that adds a `/tidy` finding shape must also add its `tidy/step-6-auto.md` routing row — that table is the declared source for the Yours rows' Why-not-auto column, never re-derived per render. #605 added Shape 5.6 (`[bot-parked]`) without one.
- **Live migration is mandatory here, not optional.** A rename leans on the permanent read-side fallback, so adopter repos need no migration. A split has no such cover: an existing record carrying the old label in its *wide* sense is silently read as the narrowed sense, because both spellings stay live and legitimate. Re-label the live carriers that meant the split-off sense, and say so in the spec — #605's deliverables listed every consumer site and no live-carrier pass.

## Project conventions

- **Emit one spelling, read two — forever.** Read-side fallbacks are PERMANENT cross-project support, commented `[IL-85]`-style ("removable only at a major version that drops pre-rename repo support"). `record.js` and `local-store.js` each carry all three today.
- **Held-aside precedence, not OR, in the frontmatter driver.** An explicit new line of either value must beat a legacy line whichever comes first; the OR form loses `new: false` + `legacy: true`.
- **The emit side rejects the retired parameter name.** `recordPayload` throws on `effort` and on `framing`, naming the field and the replacement, so a caller composing a payload from pre-rename facets fails loud instead of silently dropping the label. Add the guard for the newly retired name in the same commit as the rename.
- **Presence-only flags keep the "show the call without the flag" idiom** in `shaping-mode-stamping.md`'s `gh issue edit` block (`[IL-103]`) — document when to add the flag, never default it present.
- **Historical files keep the old spelling:** `CHANGELOG.md`, `docs/incident-log.md`, archived pipeline `work/*.md`, `docs/superpowers/plans/*`.

## Gotchas

- **The emit-side rejection guard is the step plans forget.** #677's plan carried every read fallback and no `framing` throw; the whole-branch review caught it.
- **Re-run the vocabulary sweep after every upstream merge.** Mid-run, merging `origin/main` brought in a brand-new file (`plugin/skills/backlog/refine-lanes.md`, from #655) carrying the retired spelling — a file no plan's file list could have named. The sweep grep: `grep -rn -i -E 'old:label|facets\.oldKey|oldline: (true|false)|OLD_CONST' plugin/bin plugin/skills docs/getting-started.md docs/skill-graph.md docs/journeys tests .claude/skills` — every hit must be a commented fallback, a test of one, or a named "pre-rename spelling" clause.
- **A dormant forward reference may already name the future spelling.** `backlog.js`'s `funnelBuckets` read `solutionUnjustified` behind a "pending #471" comment for weeks; the rename must un-dormant such consumers (retire the comment, update the prose that called them dormant), not merely swap strings.
- **The live label may already exist** (from a reverted build) with a stale description — `gh label create --force` aligns it to the canonical row; the bootstrap loop only creates and never updates.
- **Launcher commands must be runnable.** If a rename un-dormants a paste-line launcher, check the target skill accepts the form (`/claude-tweaks:challenge #N` did not exist; `--lens=1 #N` did).

## Evidence

- #677: commits `45716d42` (drivers), `dc5e90f6` (label set + bootstrap 2→3), `d74f1d51` (taxonomy + producer/reader skills), `5426d41e` (backlog overview/refine + docs), `7aab94c1` (`recordPayload` framing rejection + migrate-on-write coverage); merge `d65b3375` landed `refine-lanes.md` mid-run.
- Earlier instances: `record.js`'s `effort:*` (#217) and `family:parent` fallbacks.
- #605 (a split, not a rename): `bot:blocked` → `bot:blocked` + `bot:parked`; bootstrap 6→7; `isBotParked` beside `isBotBlocked` in `record-buckets.js`; pinned by `tests/bot-parked-label-conformance.test.js`.
