---
files:
  - plugin/bin/lib/wrap-up/pack.js
  - plugin/bin/lib/wrap-up/ledger-cells.js
  - plugin/skills/wrap-up/nothing-left-behind.md
  - plugin/skills/_shared/ledger-format.md
  - plugin/skills/ledger/SKILL.md
  - plugin/skills/build/dispatch.md
  - tests/bin-lib/wrap-up/pack.test.js
---

# Close a Run Whose Ledger Holds an Incomplete Deferral

**Persona:** the agent session running `/claude-tweaks:wrap-up` after an SDD build. SDD's Finish step carried its `minor (deferred):` findings into the open-items ledger as `deferred` rows with only a triage note. A maintainer reads the Review Console afterwards to see whether any of those findings still has somewhere to go.
**Goal:** a `deferred` row only counts as resolved when it says where its work went: a staged proposal (`staged/…`) or a record (an issue/PR URL, or a `#N` that is neither this run's own record nor a `ledger item #N` cross-reference). The fast path must stop reporting "all resolved" while any row lacks that, so a parked finding is not dropped silently.
**Entry point:** `wrap-up/SKILL.md` reaches "### Nothing left behind". `wrap-up-pack.json` has been written, and every ledger row already has a terminal status, so the bulk-resolve fast path would apply.
**Success state:** every incomplete deferral has been through the resolve gate's Phase 2. Each one ends as a `deferred` row whose Resolution names `staged/ledger-record-{slug}.md` (Defer/Keep), an `accepted` row with a reason (Accept/Drop), or `fixed`. Only then does the gate report "All {N} ledger items resolved."

## Steps

### 1. Read the incomplete-deferral count from the pack
- **URL:** `jq .ledger.value "$PIPELINE_RUN_DIR/wrap-up-pack.json"`
- **Action:** Check `deferredUnstaged` and `deferredUnstagedItems`, alongside the existing `open` / `total` / `unrecognized` fields.
- **Should feel:** One number says whether the "every item is terminal" picture is trustworthy, and the ids say exactly which rows to look at. Each id has the form `docs/plans/{file}-ledger.md#4`, or `ledger.md#4` for a run-dir ledger.
- **Should understand:** A flagged row is still counted as terminal for `open` and `unrecognized`. The JSON shape is additive, so older readers are unaffected. The ids are qualified with their file because a worktree can hold several `*-ledger.md` files that reuse the same row numbers. The count reflects the ledger at pack time; if the residue sweep appends rows after the pack runs, re-check the file with the same rule. Cells are split by `splitLedgerRow` (`ledger-cells.js`, #3353), so a GFM-escaped pipe (`\|`) inside an Item stays in its cell. A row quoting `Surface: web\|mobile\|desktop` is still read by its real Status.
- **Red flags:**
  - An `open` row whose Item contains `\|` shows up under `unrecognized` (with a fragment like `mobile\` in `unrecognizedValues`) instead of `open`. That is the #3353 shape, where an open item slipped past the gate's open count.
  - A row whose Resolution reads `→ backlog https://github.com/…/issues/N` is flagged. That is a real record reference and must stay terminal.
  - A row whose only `#N` is this run's own record number is *not* flagged. That `#N` is the run's origin, not a carrying record.

### 2. Decline the fast path while any incomplete deferral remains
- **URL:** `plugin/skills/wrap-up/nothing-left-behind.md` → "Bulk-resolve fast path"
- **Action:** Apply the fast path only when every item is terminal *and* none is an incomplete deferral. Otherwise do not emit "All {N} ledger items resolved".
- **Should feel:** The fast path is honest again. Being terminal is necessary but no longer sufficient.
- **Should understand:** `_shared/ledger-format.md`'s Resolution-text requirements define an incomplete deferral once. It is a `deferred` row naming neither a staged path nor a record reference, and throughout the resolve gate it counts as `open`. This is why the Status Lifecycle lines and the Resolve Gate intro both name the exception.
- **Red flags:** "All N ledger items resolved" printed while `deferredUnstaged > 0`. This is the #3072 incident shape: seven SDD minors passed a wrap-up gate and were caught only at a later spec's gate.

### 3. Route each flagged row through Phase 2
- **URL:** `plugin/skills/_shared/ledger-format.md` → "Resolve Gate (Nothing-Left-Behind)" Phases 1–3
- **Action:** Run Phase 1 fix-exhaust and then the Phase 2 per-item drill on each incomplete deferral, exactly as for an `open` item. At `trusted`/`unattended`, `ledgerNarrowing`/`ledgerRouteRemainder` may auto-route it to a born-ready backlog proposal.
- **Should feel:** The finding gets the same attention an `open` item would. It is either decided or explicitly routed, never waved through.
- **Should understand:** The write that settles the row is its *first complete* terminal write, not a reopen of a terminal item. "Terminal statuses are final" still holds. Defer/Keep rewrite the Resolution to name `staged/ledger-record-{slug}.md`. Accept/Drop set `accepted` with the stated reason.
- **Red flags:**
  - A Defer/Keep that sets `deferred` again without adding the staged path. The row stays flagged, and the next gate (a multi-spec run's later spec) drills it again.
  - A second record staged for a row that already named one by URL.

## Origin
- Created during the build of #3327 (wrap-up: the ledger bulk-resolve fast path accepts deferred rows with no staged proposal), run `2026-10-18T203911-record-3327`.
- All steps were built in this session. The producer that motivated the work, `build/dispatch.md`'s SDD carry-forward, still writes `minor (deferred):` lines as `deferred` with no staged path or record reference. The gate catches them; the producer is unchanged by design.
- Updated during the build of #3353 (ledger row parsers ignored GFM's escaped pipe), run `2026-10-19T185754-record-3353`. Step 1 now reads cells with the escape-aware splitter, and `flipLedgerRow` and the statusline's open count use it too.
- Related: `docs/journeys/gather-the-wrap-up-fact-pack-1930.md` (the pack this reads) and `docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md` (the sibling SDD-residue path for `Ruling:` lines).
