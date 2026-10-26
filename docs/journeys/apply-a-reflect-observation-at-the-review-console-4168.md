---
files:
  - plugin/skills/reflect/SKILL.md
  - plugin/bin/lib/console/reflect-destination.js
  - plugin/bin/lib/console/resolve.js
  - plugin/bin/reflect-apply.js
  - plugin/bin/lib/console/reflect-apply.js
  - plugin/skills/wrap-up/review-console.md
  - plugin/skills/_shared/console-execution.md
  - plugin/bin/lib/console/backfill-dispose.js
---

# Apply a Reflect Observation at the Review Console

**Persona:** A claude-tweaks maintainer finishing an unattended `/flow` run. Reflect has staged two or three `observation`/`convention` findings, for example "this skill's step 4 keeps tripping the same quoting bug". Before #4168, every such file sat in Pending review as `non-tangential-category:observation` and blocked the run from archiving.
**Goal:** Have each reflect observation or convention land where reflect said it belongs, without hand-triaging a pile of Pending review rows: an edit to a named skill or CLAUDE.md, a backlog record carrying a `Defer-reason:`, or a recorded decline.
**Entry point:** `/claude-tweaks:wrap-up` reaching the Review Console with one or more `staged/reflect-{n}.md` files whose `**Category:**` is `observation` or `convention`. The same rows reach the PR console, where they show as checklist rows on the run's PR.
**Success state:** Every reflect observation/convention row resolves to a final outcome: edited, filed as `#{n}`, declined into the declined-learning store, or digested. Each outcome has its own `AUTO` line in `decisions.md`, and none of these rows is left as `pending` residue. If an apply fails, it is named with a paste-ready re-run command where a human will see it, not silently archived.

## Steps

### 1. Reflect writes a destination with each finding
- **URL:** the reflect step of the run (`/claude-tweaks:reflect` Step 3, under wrap-up), writing `staged/reflect-{n}.md`
- **Action:** Reflect writes exactly one `**Destination:**` line on each `observation` or `convention` file: `edit {path}` for a small change to a skill file, a `rules/` file or a `CLAUDE.md`; `record` plus a final `## Record proposal` section (`Title:`/`Type:`/`Labels:`/`Defer-reason:`, a blank line, then the body); or `decline {reason}`. A `tangential` file carries no destination and still routes to Queue writes.
- **Should feel:** Like reflect committed to an answer. The finding arrives already routed, not as an open question the maintainer has to settle.
- **Should understand:** The destination is reflect's own recommendation, and the console can still override it: an unticked or skipped row becomes a decline.
- **Red flags:** An observation file with no Destination line written after #4168 shipped; two line-start `**Destination:**` lines in one file (the parser treats that as malformed); a `record` proposal whose `Defer-reason:` is outside `_shared/deferral-gate.md`'s vocabulary.

### 2. The console sorts the rows into Skill updates
- **URL:** Review Console render, the `Skill updates` section
- **Action:** `classifyStagedItem` reads each file through `reflect-destination.js`. A valid destination classifies the row to Skill updates with stance `approve`; its Target column shows the `edit` path for an edit destination, or the staged file `staged/reflect-{n}.md` otherwise. A `record` with a bad `Defer-reason:` lands in Refused. A malformed Destination line stays in Pending review with reason `reflect-destination-invalid:{why}`.
- **Should feel:** Like these findings belong to the same family as other skill-curation changes, pre-approved and batchable, not a separate inbox.
- **Should understand:** Only `observation` and `convention` reroute. Every other non-tangential category keeps #2473's Pending review routing, and a file with no `**Category:**` classifies exactly as it did before.
- **Red flags:** A valid observation row still showing as Pending review; a bad Defer-reason record shown as approvable instead of Refused; a Target cell that is blank for a `record` or `decline` row.

### 3. Approval carries each row to its destination
- **URL:** "On approval" step 2's reflect clause (`wrap-up/review-console.md`), or on the PR console, the ticked checklist rows (`_shared/console-execution.md`)
- **Action:** The console session runs `node "${CLAUDE_PLUGIN_ROOT}/bin/reflect-apply.js" --run "{item-run-dir}"`, adding `--transport emit --out-dir {dir}` when `gh` is absent, the project uses `local-files`, or `work-types` is not `labels`. The CLI files `record` destinations itself (as `type:{Type}` plus the proposal's labels, with `auto:*`/`bot:*`/stray `type:*` stripped) and records `decline` destinations through `recordDecline`. It hands the remaining work back as `session` entries: the session makes each `edit` (folded into step 12's commit), files each emitted `record` the way step 7 files a `Q#`, or appends each `digest` line. It then reports each one back with `--item '{name}' --applied edited|filed|digested --ref …`, so the CLI writes the `AUTO` line. On the PR console, unticked reflect rows are declined first. The ticked rows then apply with `--only` naming exactly those rows, and the call is skipped when no reflect row is ticked.
- **Should feel:** Mechanical and quiet. Approving the section is the whole interaction, and each row ends with a one-line `AUTO` entry naming where it went.
- **Should understand:** A `logFailures` entry means the effect landed but its `decisions.md` line did not, so the session runs that entry's own `line` instead of re-running the apply, which would file the record twice.
- **Red flags:** A record filed twice after a log failure; an unticked PR-console row applied because the apply ran without `--only`; a `--only` call with no ticked rows exiting 2; an `edit` destination pointing at `.git/`, `node_modules/` or a path with a `.` segment being accepted.

### 4. A failed apply reaches a human
- **URL:** the run's `Needs a human` block, its `PushNotification`, and the final human-facing stop
- **Action:** For a `failed` entry (for example, a gh outage while filing a record), the session logs one Degrade-trace `SKIP` and leaves the file staged. It also carries a needs-human-action line naming `{item-run-dir}`, the failed items, and the paste-ready re-run `node "${CLAUDE_PLUGIN_ROOT}/bin/reflect-apply.js" --run "{item-run-dir}" --only '{name},…'`.
- **Should feel:** Like an honest receipt. The one thing that did not land is named, with the exact command to finish it.
- **Should understand:** `console.json` already records the row as `approve`, so `console-residue.js` will never list it as residue. This needs-human line is the only signal that anything was left undone.
- **Red flags:** A run archiving with a failed reflect apply that no notification or final stop mentions.

### 5. Legacy files with no destination settle as digest entries
- **URL:** a live console holding pre-#4168 reflect files, or `/claude-tweaks:tidy`'s console backfill over archived runs (#3950)
- **Action:** A reflect observation or convention that has no `**Destination:**` line, because it was staged before the line existed, is digested with `Defer-reason: reflect-no-destination`. This happens both on the live console (`reflect-apply.js`'s `digest` session entry) and in the backfill (`backfill-dispose.js`).
- **Should feel:** Like the old residue finally clears, not like it was silently dropped. Each file leaves a dated digest line behind.
- **Should understand:** The digest is a below-the-floor record per `_shared/materiality-floor.md`, not a backlog record. A legacy finding that still matters can be captured from its digest entry.
- **Red flags:** Legacy reflect files still counted as `pending` after a backfill; a legacy file digested under `console-backfill-unmapped-kind` instead of `reflect-no-destination`.

## Origin
- Created during build of #4168 (reflect observation/convention findings get a Destination line, a Skill-updates classification, and the `reflect-apply.js` consumer; split from #3946's Deliverable 3)
- Related journeys: `route-a-declined-reflection-insight` (the declined-learning store a `decline` destination writes to), `settle-every-review-finding-at-the-console-3949` (the sibling settle of review findings at the same console), `review-what-an-unattended-console-left-open-3370` (where residue an unattended console leaves is read back)
