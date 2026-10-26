---
files:
  - plugin/bin/console-resolve.js
  - plugin/bin/lib/console/item-resolution.js
  - plugin/bin/lib/console/residue.js
  - plugin/bin/console-residue.js
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/hooks.js
  - plugin/skills/wrap-up/refused-proposals.md
  - plugin/skills/wrap-up/review-console.md
---

# Recover a Queue Write the Unattended Console Could Not File

**Persona:** the claude-tweaks maintainer the morning after an `autonomy: unattended` run. Its Review Console auto-resolved a Queue-writes item to `apply`, but the record create then failed, or the session died between `console-resolve.js` and the can't-tell filings. A second persona is the wrap-up agent executing "On approval" in that run.
**Goal:** a queued record that never got filed comes back as unreviewed residue instead of disappearing with the run, and it carries a command that finishes the job.
**Entry point:** the run's `PushNotification` or final stop; the next SessionStart banner; or `node "{pluginRoot}/bin/hooks.js" archive-run --run {run-dir}` refusing the run.
**Success state:** the item has been filed or dropped by a human. For a planned can't-tell filing, the console dir's `decisions.md` holds its `filed as #N (work-fingerprint {fp})` or `already filed as #N …` line. Then `console-residue.js --ack --run "{dir}"` marked the run reviewed, and archival goes through.

## Steps

### 1. (Wrap-up agent) Record a failed Queue write instead of leaving it `apply`
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "{item-run-dir}" --set-item '{name}' --resolution keep-staged --reason '{why}'` (`wrap-up/refused-proposals.md`'s "A failed execution is not a refusal")
- **Action:** **Wrap-up agent**, after a record create fails or a `.shadow-dup` composer (`shadow-dup-proposal.js`) exits 2 or 3, runs the rewrite with `{why}` set to `record create failed (exit {code})` or `shadow-dup-proposal.js exited {code}`. The shadow-dup path still logs its own Degrade-trace `SKIP` line too.
- **Should feel:** one sanctioned command, not a hand edit of `console.json`. It prints `console-resolve.js: {name} rewritten apply → keep-staged in {console.json path}` and logs an `AUTO … Review Console: Console item {name} ({section}): rewritten apply → keep-staged after execution — {why}` line under `## /wrap-up`.
- **Should understand:**
  - Only `apply` → `keep-staged` is allowed. The write is atomic and holds `.console.lock`, the same lock `console-residue.js --ack` takes, and it drops a stale `residueAcknowledgedAt`.
  - It runs at any autonomy ceiling, because it only records a failure.
  - Rewriting an item that is already `keep-staged` prints `already keep-staged — nothing rewritten` and exits 0.
  - Exit 5 naming `no console.json` means a human-present console, so there is nothing to do. Any other exit 5 (an unknown or duplicate `{name}`, an item no longer `apply`) means nothing was recorded: check `{name}` against `console.json` and re-run.
  - Exit 3 after a landed rewrite means only the `decisions.md` entry failed (`… but the decisions.md entry could not be written (…)`).
- **Red flags:**
  - a failed create whose item still reads `apply` after wrap-up
  - a PR-rendered console item rewritten (refused — #4172's `filing-failed` outcome owns that path)
  - an exit-5 refusal treated as success

### 2. A planned can't-tell filing reads `filing-pending` until its filed line exists
- **URL:** `node "{pluginRoot}/bin/console-residue.js" --run "{dir}"`, or the SessionStart banner
- **Action:** the residue reader checks each `console.json` `filings` entry against that console dir's `decisions.md`. An entry with no `- AUTO … filed as #N (work-fingerprint {fp})` or `already filed as #N …` line is listed as `filing-pending`, with two extra lines: `re-run filing: node "…/bin/console-filings.js" --run "{consoleDir}" --existing <issues.json> --out-dir <dir> --only '{id}'` and a hint naming `gh issue list --state all --json number,body --limit <N>` and the log lines to write.
- **Should feel:** the run did not quietly lose a record. The block names which filing never landed and hands over the command that lands it.
- **Should understand:**
  - `filing-pending` is computed each time the files are read. It is never stored in `console.json`, so backfill does not treat it as work.
  - A filed or deduplicated item reads resolved, and a successful Queue write keeps `apply`.
  - The `PushNotification` and the run's final stop carry `console-residue.js --run` output printed after "On approval" executed. The pre-execution `Needs a human` block cannot show these items.
- **Red flags:**
  - a filed record still listed as `filing-pending`
  - a `filing-pending` item with no `re-run filing:` line
  - the PushNotification omitting an item that `console-residue.js --run` lists

### 3. Finish the filing and log it
- **URL:** the printed `re-run filing:` command, then `log-decision.js --run {consoleDir}`
- **Action:** fetch `<issues.json>` and run the printed command. For each `file` entry, create the record and log `'{item} filed as #{n} (work-fingerprint {fp})'`. The CLI logs each `deduped` entry itself; for any item its `logFailures` names, log `'{item} already filed as #{n} (work-fingerprint {fp})'`. Use the `wrap-up/review-console.md` Can't-tell filings form, and log into that console's own dir.
- **Should feel:** finite. Re-running is safe, because a session that died after the create but before the log re-runs to `deduped`, not a twin record.
- **Should understand:** the residue clears only on the logged `- AUTO` line (`FILED_LINE_RE`). Creating the record without logging it leaves the item `filing-pending`.
- **Red flags:**
  - a duplicate record from the re-run
  - a filed line logged into the parent run dir for a `spec-N` console

### 4. Clear the archival refusal
- **URL:** `node "{pluginRoot}/bin/hooks.js" archive-run --run {run-dir}` stdout, or reconcile's `console-residue` skip hint
- **Action:** the refusal names the open items, then `re-run the planned filing(s): {command}, then {log remedy}; or` the run's `console-residue.js --ack` command. Act on each item (step 3 for a filing, or open a `keep-staged` item's `cat` line and file or drop it), then ack the run and re-run `archive-run`.
- **Should feel:** the refusal says exactly what blocks the run and how to unblock it.
- **Should understand:**
  - Acking a console whose directory has moved fails with `console directory no longer exists` (exit 3) and does not recreate the directory.
  - Consoles from v6.154.x that filed can't-tell records before created entries logged a filed line read `filing-pending` once after upgrade. Re-run to `deduped`, which the CLI logs, or `--ack-all` after review.
- **Red flags:**
  - a run with a `filing-pending` or failed-execution `keep-staged` item archiving unacknowledged
  - a refusal with no re-run command for a pending filing

## Origin
- Created during the build of #4170 (run `2026-10-25T152441-record-4170`): `console-resolve.js --set-item`, `lib/console/item-resolution.js`, the derived `filing-pending` residue word, and the re-run remedy in the archival refusal.
- Related journeys: `review-what-an-unattended-console-left-open-3370.md` covers reading and acking residue in general. `keep-cant-tell-findings-through-a-console-less-auto-merge-4171.md` covers the console-less merge path's `cant-tell-unfiled` guard.
