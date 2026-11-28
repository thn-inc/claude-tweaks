---
files:
  - plugin/bin/bundle-proposals.js
  - plugin/bin/lib/console/bundle.js
  - plugin/bin/lib/issues/grouping.js
  - plugin/bin/lib/issues/record-fingerprint.js
  - plugin/bin/lib/console/resolve.js
  - plugin/bin/console-resolve.js
  - plugin/bin/lib/stage-item/ledger.js
  - plugin/skills/wrap-up/proposal-bundling.md
  - plugin/skills/wrap-up/review-console.md
  - plugin/skills/wrap-up/review-console-interactive.md
  - plugin/skills/wrap-up/ledger-narrowing-auto-file.md
  - plugin/skills/flow/multispec-review-console.md
  - plugin/skills/_shared/ledger-format.md
---

# File a Run's Related Follow-ups as One Bundle

**Persona:** A claude-tweaks maintainer finishing a multi-record `/flow` run whose builds and reviews left a dozen follow-up proposals in `staged/` — several of them about the same few files. Last time they hand-merged 23 filed follow-ups into 5 records afterwards and paid one decision round per `needs:definition` record.
**Goal:** Have the Review Console file findings that touch the same files as one record with a checklist item per finding, so the backlog gets one record to shape and build instead of five, without losing any single finding and without a new stop in `auto` mode.
**Entry point:** `/claude-tweaks:wrap-up`'s Review Console (single-spec), or `/claude-tweaks:flow`'s consolidated multi-spec console, for a run whose `staged/` holds two or more record proposals in one landing class that cite a shared Key File.
**Success state:** The console's Queue writes section shows one `Q#` row titled `Bundle: {N} follow-ups touching {path}` in place of the N member rows; the created record lists every member as a `- [ ]` Deliverable with its own `Defer-reason:` and source path, carries every member's `work-fingerprint` marker, and each bundled `ledger-record-*` member's ledger row names `staged/bundle-{n}.md`. `decisions.md` holds one `AUTO` line naming the bundle, its members, and the shared path(s) that joined them.

## Steps

### 1. Let the console bundle before it files anything
- **URL:** the run's `decisions.md` under `/wrap-up`, and `{run}/staged/bundle-{n}.md`
- **Action:** Reach the console as usual. Before ledger-narrowing auto-file and before `console.json` is written, the console runs `bin/bundle-proposals.js --run {run} --records-json {session record snapshot}` (`--local` under `work-backend: local-files`) once — on the parent dir in a multi-spec run.
- **Should feel:** Invisible. No question, no new section — the Queue writes table is just shorter.
- **Should understand:** Only `ready` proposals bundle with `ready` ones and `needs:definition` with `needs:definition`; a `parked` proposal, an unrecognized `Labels:` header, a member with no valid `Defer-reason:`, and a `ledger-record-*` member whose ledger row cannot be found all stay singletons and file as before. A file cited by many open backlog records is a hub and never joins two findings; hubs are counted against the open backlog, not the run's own proposals. A group bigger than 10 splits into consecutive bundles, and each slice keeps only members that share a file inside it.
- **Red flags:** A bundle whose `AUTO` line names no shared path. A `parked` proposal inside a bundle. A member that appears both as its own `Q#` row and inside a bundle.

### 2. Read the bundle row and its checklist
- **URL:** the console's Queue writes section; `staged/bundle-{n}.md`
- **Action:** Open the bundle's staged file. Current State quotes each member's full finding (defused, in a fence); Deliverables is one checklist item per member; Acceptance Criteria (or, for a `needs:definition` bundle, `## Open Question`) is grouped per member; Key Files is the union.
- **Should feel:** Like reading one well-organized record, not a pile of pasted ones — each finding still visibly its own item.
- **Should understand:** The bundle's labels are derived, not hand-picked: the highest member `risk:*`, a `size:*` no lower than the largest member's (one tier higher for 5+ members or a doubled Key File union), the shared `Type:` else `task`, and the `Defer-reason:` most members share. The `Risk-flags:` union is written unconfirmed when any member's flags were unconfirmed or unclassified.
- **Red flags:** A member's Acceptance Criteria cut short at a `###` subheading. A bundle carrying an `auto:*` or `bot:*` label.

### 3. Approve, or un-bundle a false union
- **URL:** the console's terminal decision (Approve all / Override)
- **Action:** Approve all files the bundle like any `Q#`. If the shared file is a coincidence (a hot file the backlog under-counts), choose Override and reply `un-bundle {Q#}` — human-present only.
- **Should feel:** Reversible. One word undoes the union.
- **Should understand:** `un-bundle` runs `bundle-proposals.js --unbundle bundle-{n}.md`, which restores every member file and its original ledger Resolution and logs `un-bundled (override)`; the console then re-reads `staged/` and re-presents Queue writes with each member as its own `Q#` row — no `console-resolve.js` call. Members a human un-bundled are never re-bundled later in the same run. A Skip on the bundle row keeps its members retired in `bundled/` (nothing resurrects them).
- **Red flags:** Override text that never mentions `un-bundle`. An un-bundle that leaves a member's ledger row pointing at the deleted bundle.

### 4. Know what happens when bundling fails
- **URL:** `decisions.md`
- **Action:** If the bundler exits non-zero, the console re-runs it once (its start repairs any half-finished bundle from an earlier crash); on a second failure it logs one Degrade-trace `SKIP` naming the exit and files every proposal individually.
- **Should feel:** Safe — a failure costs the consolidation, never a finding.
- **Should understand:** A bundle's `bundled …` `AUTO` line is its commit marker; any bundle without one is rolled back on the next run. Under control mode, a bundle whose create fails or is carried settles every member's ledger row with one `console-resolve.js --set-item bundle-{n}.md --resolution carried … --ledger …` call; outside control mode a failed create follows `refused-proposals.md`'s failed-execution rewrite and the bundle stays staged.
- **Red flags:** A `SKIP` with no re-run before it. A run dir holding a `staged/bundle-*.md` with no matching `AUTO` line after the console finished.

## Origin

Record #6283 (console-time bundler, Approach A of the parent record's decisions), built 2026-11-25.
