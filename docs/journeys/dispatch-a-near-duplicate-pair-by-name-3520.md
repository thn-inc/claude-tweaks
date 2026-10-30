---
files:
  - plugin/bin/lib/issues/near-duplicate.js
  - plugin/bin/lib/issues/record-payload.js
  - plugin/bin/lib/dispatch/near-dup-pairs.js
  - plugin/skills/dispatch/queue-pull-script.md
  - plugin/skills/dispatch/near-duplicate-pairs.md
  - plugin/skills/dispatch/drain-pr-overlap.md
  - plugin/skills/dispatch/reporting.md
  - plugin/skills/dispatch/SKILL.md
---

# Dispatch a Near-Duplicate Pair by Name

**Persona:** the maintainer typing an explicit list, `/claude-tweaks:dispatch #3417,#3419,#3012`, to build several records in one firing. Two of them, #3417 and #3419, describe overlapping work, and neither has a `### Key Files` section.
**Goal:** build every named record in this firing without being surprised at close-out by a PR that turned `DIRTY` because another record in the same firing edited the same files.
**Entry point:** `/claude-tweaks:dispatch #N,#M,...`, with a human present.
**Success state:** before anything dispatches, the maintainer sees which pair is predicted to conflict and which one merges first. Both records still build. An `auto:merge` group is held from merging while its near-duplicate partner's PR from this firing is still open.

## Steps

### 1. Pull the queue and record strong pairs
- **URL:** `plugin/skills/dispatch/queue-pull-script.md` (the `#1944` cross-group near-duplicate pass); `plugin/bin/lib/dispatch/near-dup-pairs.js` `nearDuplicatePairsAcrossGroups`
- **Action:** The queue pull compares every pair of records in different groups. Each pair that fires any signal prints `AUTO — dispatch: near-duplicate candidates across groups: #A / #B ({signals})` to stderr. Strong pairs are written to this firing's session-scoped `dispatch-near-dup-pairs.json` as `{records: [A, B], signals, sharedAnchors}`. A strong pair has at least 2 shared `## Current State` anchors, or a score of at least 2 (`isStrongNearDuplicate`). The file is rewritten on every pull, so an earlier pull's pairs never carry over.
- **Should feel:** Quiet. A weak pair, sharing one anchor, warns and nothing more.
- **Should understand:** #3417 and #3419 share three anchors (`docs/donts.md`, `fs.realpathSync`, `fs.realpathSync.native`), so they form a strong pair. #3417 and #3012 share one, so they only warn. A heading-shaped line inside a fenced block in Current State (a shell `# comment`, a quoted `## …`) does not end the anchor scan, and a CRLF body is read the same as an LF one (#4369).
- **Red flags:** A one-anchor pair written to the pairs file. Anchors after a fenced `# comment` in Current State missing from `sharedAnchors`. A strong pair missing from it. A pairs file still holding a previous pull's pairs.

### 2. Read the predicted-conflict line before dispatch
- **URL:** `plugin/skills/dispatch/near-duplicate-pairs.md`; `plugin/skills/dispatch/SKILL.md` (the `#N[,#M` bullet)
- **Action:** After `selectGroupsForExplicitList` and before Step 4, dispatch runs `predictedConflicts` over the selected groups that will actually dispatch, bounded by `dispatch-batch-size`. For each strong pair split across two of those groups it prints one line, `#{A} / #{B} predicted to conflict (near-duplicate: {signals}; shared: {sharedAnchors}); dispatch order #{A} then #{B}, merge #{A} first`, and logs a matching `AUTO … dispatch: predicted conflict …` line to `decisions.md`.
- **Should feel:** Forewarned rather than blocked. The merge order is named up front, so close-out holds no surprise.
- **Should understand:** Both records still dispatch, in the order already selected. Naming them explicitly is the accepted risk. The announced dispatch order is also the merge order.
- **Red flags:** No predicted-conflict line for a strong pair the firing dispatches. A line naming a record beyond `dispatch-batch-size` that will not dispatch. Dispatch skipping one of the named records because of the pair.

### 3. Hold the second group's auto-merge while the first PR is open
- **URL:** `plugin/skills/dispatch/drain-pr-overlap.md` (Step 4 re-check and Step 6 hold, explicit-list firings); `plugin/bin/lib/dispatch/near-dup-pairs.js` `drainNearDuplicateHits`
- **Action:** Before minting the later group, Step 4 checks whether its member is a strong-pair partner of a record that a PR from this firing closes. If so it renders the overlap warning with `(near-duplicate of #{partner})`. At the Auto-merge gate, while that PR is still open, Step 6 holds the group and logs `AUTO {time} — Auto-merge gate: group [{issues}] held — overlaps drain PR #{pr} (near-duplicate of #{partner}); merge order is a human call. Reversibility: n/a.`. The unattended console auto-resolver parses that line too (`DRAIN_OVERLAP_HOLD_RE`).
- **Should feel:** Safe. The second PR never auto-merges ahead of, or over, the first.
- **Should understand:** The hold is not persisted. Once the partner's PR merges or closes, the next evaluation proceeds normally. A bare drain doesn't need this source, because its neighbour-in-flight guard defers the later record on the next pull.
- **Red flags:** An `auto:merge` group merging while its near-duplicate partner's PR from this firing is open. A hold line the console resolver doesn't recognise. A hold that persists after the partner's PR merged.

### 4. Read each group's report block
- **URL:** `plugin/skills/dispatch/reporting.md`
- **Action:** **The maintainer** reads the firing's report. Each group in a strong pair carries `predicted conflict with #{partner} (PR #{pr}) — merge #{first} first`. The `(PR #{pr})` part is dropped when the partner has opened no PR yet.
- **Should feel:** Complete. Close-out has the merge order in front of it.
- **Should understand:** Merge the named record first. The second may still need a rebase, but it is expected rather than a surprise.
- **Red flags:** A strong pair split across dispatched groups with no report line on either group.

## Origin
- Created during `/claude-tweaks:build` of record #3520 (2026-10-19). On 2026-10-17 the explicit-list firing `#3417,#3419,#3012` dispatched all three. PR #3450 merged first, and PR #3485 turned `DIRTY` on three files both records had edited, costing about 20 minutes to reconcile.
- Related specs: #1944 (near-duplicate finder), #3278 (neighbour-in-flight guard), #1985 (drain-PR overlap), #2299 (console hold carve-out)
- Updated during #4369's build (run 2026-10-28T192900-record-4369): `extractCurrentStateAnchors` skips fenced heading lines and normalizes CRLF.
