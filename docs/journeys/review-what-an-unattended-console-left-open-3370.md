---
files:
  - plugin/bin/lib/console/residue.js
  - plugin/bin/console-residue.js
  - plugin/bin/console-resolve.js
  - plugin/bin/lib/hooks/session-residue.js
  - plugin/bin/lib/hooks/session-start.js
  - plugin/bin/hooks.js
  - plugin/bin/stage-item.js
  - plugin/bin/lib/console/resolve.js
  - plugin/skills/flow/summary-template.md
  - plugin/skills/flow/multispec-summary.md
  - plugin/skills/wrap-up/review-console.md
  - tests/bin-lib/console/residue.test.js
  - tests/bin-lib/console/residue-cli.test.js
  - tests/bin-lib/hooks/session-residue.test.js
---

# Review What an Unattended Console Left Open

**Persona:** the claude-tweaks maintainer opening a fresh Claude Code session the morning after unattended `/claude-tweaks:dispatch` runs merged or parked overnight, who never saw those runs' consoles. A second persona is the skill author whose producer stages a proposal under a new `staged/` name.
**Goal:** see every staged item an `autonomy: unattended` Review Console resolved to `pending` or `keep-staged` (and therefore never applied), read each one, decide what to do with it, and mark the run reviewed, before the run's directory is forgotten in `archive/`.
**Entry point:** the run's own final stop (`/flow`'s Pipeline Summary, or the console's `PushNotification`); or the next SessionStart banner after the run closed or was archived.
**Success state:** each surfaced item has been read and acted on: applied by hand, filed with `/claude-tweaks:capture`, or dropped. `node "{pluginRoot}/bin/console-residue.js" --ack --run "{dir}"` printed `claude-tweaks: marked {n} console(s) reviewed for {run-id}`, and the next SessionStart no longer lists that run.

## Steps

### 1. Read the "Needs a human" block at the run's own final stop
- **URL:** `console-resolve.js`'s stdout after its table; `/flow`'s Pipeline Summary `### Needs a human` section (rendered from `node "{pluginRoot}/bin/console-residue.js" --run "$PIPELINE_RUN_DIR" --require-verify {base}`).
- **Action:** Read the block: `Needs a human — {k} item(s) this console did not resolve (never auto-applied):`, then one line per item (`- {id} — {section}: {resolution} ({reason})`). Each `cat "…/staged/{id}"` line points at the staged file, and a `see "…/decisions.md"` line covers a `decision:` item. An item whose staged file has since vanished is not counted; one `not counted — staged file(s) no longer on disk:` line names it.
- **Should feel:** Like a short to-do list handed over at the end of the run, not a buried log. Every item the console would not decide on its own is named, with a command that opens it.
- **Should understand:** Only `pending` (an unmapped prefix, a non-tangential reflect category, a shadow-dup copy) and `keep-staged` (contested and low-confidence findings) appear. Applied, approved and filed rows do not. Paths move when the run is archived, which is why the block ends with a `console-residue.js --run` line that re-derives the current paths. If the CLI exits non-zero, the summary renders its stderr instead of omitting the section, so a failed scan never reads as "nothing to review". A `console.json` that exists but is not valid JSON is named in the output (`! console.json is not valid JSON — any pending items in it cannot be listed`) instead of being skipped. A wrap-up resumed after the console already resolved still prints the block, because `console-resolve.js` re-renders it on that path too.
- **Also listed (#3783):** besides console items, the `--require-verify {base}` flag appends, after the console items, two lines for each checked dir with no valid `verify.json` (each `spec-*/` of a multi-spec parent, else the run dir): `- {run-id}: verify.json missing — wrap-up's Verify execution never ran, or its write failed`, then a paste-ready `run: node "…/bin/wrap-up-engine.js" verify --run-dir "…" --base {base}` line. These are not console items, so they carry no `cat` line and are not counted in `{k}`.
- **Red flags:** A `### Needs a human` section silently missing while `console.json` lists `pending` items. A resolved (`apply`/`approve`) item appearing in the block. Any item applied without a human acting on it.

### 2. Get the same list at the next SessionStart for a closed or archived run
- **URL:** the SessionStart banner `claude-tweaks: closed or archived run(s) whose unattended Review Console left item(s) no human has reviewed:`; or on demand, `node "{pluginRoot}/bin/hooks.js" check-session-residue`.
- **Action:** Relay the banner, one block per run (newest first, at most three). Each block opens with `- {run-id}: {k} item(s) no human has reviewed` and lists up to five items before an `… and {n} more` line. Items whose staged file has vanished are left out of `{k}` and named in one `not counted — staged file(s) no longer on disk:` line.
- **Should feel:** The run did not disappear when the reconciler archived it. Its open items follow you into the next session until someone looks.
- **Should understand:** The scan covers clean, not-yet-archived runs and `archive/` runs, including multi-spec `spec-*/console.json`, but only the newest 200 run names, so the hot path stays bounded. When runs were cut off, the banner adds `- … more run(s) may have unreviewed console items (newest 3 shown).` and offers the bulk `--ack-all` command. Acknowledged consoles (`residueAcknowledgedAt` set) are skipped.
- **Red flags:** The banner listing a run already acknowledged. SessionStart slowing noticeably on a large archive. A run whose items were never acked dropping out of the banner without the overflow line.

### 3. Open an item and decide on it
- **URL:** the item's own `cat "{consoleDir}/staged/{id}"` line from step 1 or 2.
- **Action:** Read the staged file and choose one: apply it by hand (a patch with `git apply`, a proposal by editing the target), file it as a record with `/claude-tweaks:capture`, or drop it.
- **Should feel:** Each item is one decision. The file carries enough context to make it without opening the run's whole `decisions.md`.
- **Should understand:** Nothing here was applied automatically. A `pending` item never matched a console stance it could resolve under, and a `keep-staged` item had no Approve-all default. The decision is genuinely yours.
- **Red flags:** A `cat` line pointing at a file that does not exist. Use `console-residue.js --run` with the old path, which falls back to `archive/`.

### 4. Mark the run reviewed
- **URL:** `node "{pluginRoot}/bin/console-residue.js" --ack --run "{dir}"`, or `--ack-all` to dismiss every unacknowledged run at once after reviewing the backlog.
- **Action:** Run the run's own `mark reviewed:` command from its block.
- **Should feel:** One command clears the run from every later SessionStart, and running it again changes nothing.
- **Should understand:** `--ack` writes only the additive `residueAcknowledgedAt` field into each unacknowledged `console.json` (and `spec-*/console.json`). Every other field is untouched, and a file that no longer parses, or was acknowledged since the scan, is never rewritten; the summary line counts those as `(N skipped — …)`. A write that fails (unwritable file, run directory moved by a concurrent archival) names the file on stderr, the remaining consoles are still tried, `(N could not be written)` joins the summary line, and the exit code is 3. A pre-archive path still works: the CLI notes the move and uses the archived copy. `--ack-all` reaches runs beyond the 200-name SessionStart window.
- **Red flags:** `marked 0 console(s)` for a run the banner just listed. Changed resolution fields in `console.json` after an ack. Exit 3 for a run that exists under `archive/`.

### 5. (Skill author) Learn at staging time that a new name will not be classified
- **URL:** `node "{pluginRoot}/bin/stage-item.js" --run "{run-dir}" --id {id} --file {path}`
- **Action:** **Skill author** stages a proposal under a new name, e.g. `--id review-13-record` with a `.md` file.
- **Should feel:** The mistake surfaces immediately, on stderr, with the canonical names to choose from. Nobody finds it hours later in a console row.
- **Should understand:** The warning reads `stage-item.js: warning: --id review-13-record matches no Review Console SECTION_MAP prefix — if a wrap-up Review Console resolves this run, it routes this item to Pending review (unmapped-prefix), never auto-resolved. Nearest canonical prefixes: …`. The file is still written and the exit code is unchanged. A canonical id, or an id made canonical by its extension such as `review-2` with a `.patch` file, prints nothing.
- **Red flags:** A canonical id printing the warning. The warning changing the exit code. The warning suggesting a prefix that is itself unmapped.

## Origin

Built by #3370 (run `2026-10-17T191422-record-3370`). It surfaces the pending and contested items #2821's unattended run left unseen. Updated by #3772: an item whose staged file has since vanished is `missing`, not counted, and named once in the `not counted —` line.
