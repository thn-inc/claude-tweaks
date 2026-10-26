---
files:
  - plugin/bin/lib/console/resolve.js
  - plugin/bin/lib/console/finding-filing.js
  - plugin/bin/lib/console/backfill.js
  - plugin/bin/lib/console/backfill-dispose.js
  - plugin/bin/console-filings.js
  - plugin/bin/console-resolve.js
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/reconcile/console-execute.js
  - plugin/bin/lib/console/residue.js
  - plugin/bin/console-residue.js
  - plugin/skills/wrap-up/review-console.md
  - plugin/skills/wrap-up/console-template.md
  - plugin/skills/wrap-up/review-console-interactive.md
  - plugin/skills/_shared/console-on-pr.md
  - plugin/skills/_shared/auto-mode-contract.md
---

# Settle Every Review Finding at the Review Console

**Persona:** an operator who finishes a `/claude-tweaks:flow` or `/claude-tweaks:wrap-up` run and meets its Review Console: at a terminal, on the PR comment under `pr-first`, or not at all, because the run resolved itself at `autonomy: unattended`. Until now, Low-confidence and Contested findings sat there as `keep-staged`, with no default and nothing applying them. They were left behind in every finished run.
**Goal:** every review finding reaches a final outcome before the run closes: filed as a backlog record, or dropped. A finding nobody could settle is never quietly kept, and never quietly dropped.
**Entry point:** the Wrap-Up Review Console, reached by `/claude-tweaks:wrap-up` (or `/claude-tweaks:flow`'s consolidated multi-spec console) after `/claude-tweaks:review`'s tiebreak (Step 3.7) has logged a verdict line for every open finding.
**Success state:**
- The console shows no `pending` or `keep-staged` finding from this run.
- Each can't-tell finding is either a `needs:definition` backlog record (deduplicated by its `work-fingerprint`) or dropped by a human.
- High and critical refuted findings are listed read-only, so nothing dropped on evidence is invisible.
- The run archives, or it is refused with a named reason.

## Steps

### 1. Open the console
- **URL:** the Wrap-Up Review Console. In the terminal it renders from `console-template.md`; under `pr-first` it is the PR comment (`_shared/console-on-pr.md`).
- **Action:** the operator reads the Low-confidence and Contested sections. Their rows come from `node "${CLAUDE_PLUGIN_ROOT}/bin/console-filings.js" --run {run-dir} --list`. Each row is a finding the tiebreak could not settle, at severity medium or higher, with its lens, `path:line`, severity and the tiebreak's recommendation.
- **Should feel:** short and already decided. Every row arrives with a default: the tiebreak's recommendation.
- **Should understand:**
  - A finding the tiebreak confirmed is no longer here; it went through Step 3 Routing. A refuted one is gone too.
  - A finding logged to the digest (low/info can't-tell) is not here either.
  - The staged review file a finding's STAGED line names (`staged/review-contested-{N}.md`, for example) takes that verdict's outcome instead of lingering.
  - A row with no recommendation at all is the legacy shape: it stays undecided.
- **Red flags:**
  - a confirmed finding still shows as Low-confidence
  - one finding appears as two rows
  - a row shows no recommendation although decisions.md carries one

### 2. Read the Dropped-by-tiebreak block
- **URL:** `#### Dropped by tiebreak (read-only — no decision)`, after the Merge line.
- **Action:** the operator scans the refuted findings of severity high or critical. Each shows its `path:line`, lens, severity and the quoted source line the tiebreak cited as evidence.
- **Should feel:** auditable. Nothing to click; the evidence is on the page.
- **Should understand:**
  - Dropping a finding the tiebreak refuted with verified evidence is the one decision the auto-mode contract lets the pipeline take at any severity (`_shared/auto-mode-contract.md`'s `### Tiebreak-refuted drop (one-decision amendment)`).
  - Low and medium refuted drops are not shown; they stay in decisions.md's `AUTO … dropped` lines.
  - A refuted finding whose staged file exists also shows that file's own row, resolved `dropped`.
- **Red flags:**
  - a can't-tell finding appears in this block
  - a medium drop appears here
  - the block carries a numbered decision row

### 3. Resolve the can't-tell findings
- **URL:** the console's terminal decision (Approve all / Override), or the PR comment's checkboxes.
- **Action:**
  - **Approve all** takes each row's default: `file` (or no recommendation from a tiebreak that ran) → `filed`, `drop` → `dropped`.
  - **Override** offers `file {#}` and `drop {#}`; `skip {#}` means drop.
  - On the PR comment, a row reads `— tick = file · untick = drop`, and arrives pre-ticked unless its recommendation is `drop`.
  - Each `filed` row is filed through Queue writes (step 7). `console-filings.js --only {ids}` writes the proposal, and the existing queue-write path creates the record.
- **Should feel:** one decision, not one per finding.
- **Should understand:**
  - A human dropping a `drop`-recommended finding is a human decision. The pipeline itself never drops a can't-tell finding.
  - A filing whose fingerprint (lens + path + normalized claim, no line number) already exists on an open or closed record is not filed twice. The decisions log names the existing record instead.
  - A mistyped id refuses the whole call (exit 2) and the message lists the valid ids.
- **Red flags:**
  - a `filed` row produces no record and no `already filed as #N` line
  - a re-run files the same finding again
  - unticking Resolve on the PR comment leaves a finding row silently executed

### 4. An unattended run settles itself
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run {run-dir} --policy console-auto`, then `console-filings.js` (review-console.md's Auto-resolution short-circuit)
- **Action:** at `autonomy: unattended` the console renders in full with every row stamped `AUTO-RESOLVED` and asks nothing. Every can't-tell finding resolves `filed`, whatever its recommendation. `console-filings.js` dedups them against `gh issue list --state all` and writes the proposals, and each is filed as a `needs:definition` task with `Defer-reason: needs-human-decision`.
- **Should feel:** finished. The operator comes back to records in `/claude-tweaks:backlog attention`, not a console waiting on them.
- **Should understand:**
  - `console.json` records `filings` and `droppedByTiebreak` next to the items.
  - A filing that fails (non-zero exit) is carried into the run's `Needs a human` block with the re-run command. Once the run is archived, that command takes the `archive/{run-id}` copy.
  - Below `unattended` no human means no resolution: nothing is filed or dropped, and the console stays pending.
- **Red flags:**
  - an `AskUserQuestion` prompt during an unattended run
  - a can't-tell finding resolved `dropped` with no human present
  - a failed filing that appears only as a SKIP line

### 5. The run closes
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run {run-dir}`, or the reconciler's archive sweep
- **Action:** a console whose every item reached a final outcome archives. A resolved console that still holds an unacknowledged `pending` or `keep-staged` item, such as a legacy finding with no tiebreak verdict, is refused: `archival refused — console-residue`. So is an executed PR console (step 3's checkboxes) whose finding filing failed or whose ruling reverse failed: `resolve-console --filing-failed` / `--reverse-failed` records that item's `outcome` on `console.json`, and the refusal ends `— unresolved: {id} (filing-failed)` (#4172).
- **Should feel:** clean. A finished run leaves nothing behind, or says exactly what is left.
- **Should understand:**
  - The refusal lifts once someone reviews the items and runs `node "${CLAUDE_PLUGIN_ROOT}/bin/console-residue.js" --ack --run {run-dir}`. An unreadable console.json has to be repaired or removed instead; the refusal says which.
  - The SessionStart banner lists the same runs. A failed PR item has no `cat` line, since its id is a PR row, not a staged file; its detail is in the PR's executed reply and decisions.md.
  - The reconciler's archive sweep skips the same run as `console-residue` and carries a `hint` naming the items.
  - A PR console with only executed and dropped items archives as before.
- **Red flags:**
  - a run with an unreviewed keep-staged item archives
  - a PR console with a filing-failed item archives without a human's `--ack`
  - an acknowledged console still blocks
  - the refusal's remedy does nothing

### 6. Read a filed can't-tell record
- **URL:** the backlog record the console filed: in `/claude-tweaks:backlog attention`, or on GitHub. The same record shape comes from step 3/4's filings and from the `/claude-tweaks:tidy` console backfill, which files leftover staged `review-unconfirmed-*`/`review-contested-*` files from closed runs (`bin/console-backfill.js`).
- **Action:** the operator (or `/claude-tweaks:specify #{n}`) opens the record to decide whether the finding holds.
- **Should feel:** self-contained. The record states what was claimed and why, so nobody has to dig the archived run directory out first.
- **Should understand:**
  - A record filed from a staged finding file is titled with that file's own `Title:` line. A long title is cut on a word boundary with `…`, never mid-word.
  - Other filed records keep the `Review finding (can't-tell): {path} — {claim}` title, with the claim also cut on a word boundary.
  - `## Current State` fences the claim, then the staged file's text: its content header lines (`Invariant:`, `Lenses:`, `Target:` …), followed by its body, with the evidence and the apply/reverse dispositions.
  - The bookkeeping header lines are left out: `Title:`, `Kind:`, `Finding:`, `Staged-at:`, `Ledger:`, `Severity:`.
  - The severity shown is the staged file's own `Severity:` field. When the file states none, the record shows no severity rather than a defaulted `medium`.
  - A finding with no line number cites the path alone. It never cites `path:unknown`.
  - The fingerprint is unchanged, so a finding already filed under the old shape (#4048, for example) is still recognized and not filed again.
- **Red flags:**
  - the title is cut mid-word
  - `## Current State` holds only the `Finding:` location string
  - `:unknown` appears as a line reference
  - a `(severity medium)` appears for a staged file that states no severity
  - a re-run of the backfill files a second record for an already-filed finding

## Origin
- Created during the build of #3949, the third step of the unconfirmed-findings tiebreak project. #3945 built the resolver and the archive coverage check; #3947 built the tiebreak step itself.
- Updated during the build of #4172: a PR console's `filing-failed`/`reverse-failed` outcome now holds the run out of archival (step 5).
- Step 6 added during the build of #4136. A filed can't-tell record now carries the staged finding's title, body and own severity, and omits an absent line instead of printing `:unknown`.
- Related journeys:
  - `get-a-verdict-on-every-unverified-review-finding-3947.md`: how each finding gets the verdict this console acts on.
  - `clear-an-archive-refusal-for-an-untiebroken-finding-3945.md`: the archive refusal for a finding with no verdict line at all.
