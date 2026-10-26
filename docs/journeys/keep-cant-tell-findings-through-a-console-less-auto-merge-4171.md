---
files:
  - plugin/bin/lib/console/finding-outcomes.js
  - plugin/bin/console-filings.js
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/hooks.js
  - plugin/skills/wrap-up/auto-merge-short-circuit.md
  - plugin/skills/dispatch/settle-and-merge.md
---

# Keep Can't-Tell Findings Through a Console-Less Auto-Merge

**Persona:** a maintainer whose record carries `auto:merge` (or a run pre-authorized with `merge-authorization`), so it merges through the wrap-up auto-merge short-circuit, or a dispatch bundle merges through its Auto-merge gate, with no Review Console rendered.
**Goal:** a review finding the tiebreak could not settle (a can't-tell `console` verdict) is never lost when no console runs. Either it is filed as a backlog record before the merge, or the merge waits for a human, or the run refuses to archive and says why.
**Entry point:** `/claude-tweaks:wrap-up` reaching the auto-merge short-circuit (`wrap-up/auto-merge-short-circuit.md`), or `dispatch/settle-and-merge.md`'s bundle Auto-merge gate, on a run whose `decisions.md` holds a `Tiebreak tiebreak:{id}: … console: …` verdict line.
**Success state:**
- At `autonomy: unattended`, every can't-tell finding is a backlog record (deduplicated by `work-fingerprint`) before the merge, and the run archives.
- Below `unattended`, the run does not auto-merge. The normal Review Console renders the findings for a human.
- A run that merged anyway with a finding unfiled refuses archival under `cant-tell-unfiled`, with a paste-ready remedy.

## Steps

### 1. The short-circuit lists the findings before it merges
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-filings.js" --run "$PIPELINE_RUN_DIR" --list`
- **Action:** after the merge-check verdict backstop passes and before acceptance labeling, the short-circuit lists the run's Low-confidence and Contested rows. Rows with `cantTell: true` are the can't-tell findings. With none, it continues unchanged.
- **Should feel:** invisible on a clean run. The step only acts when a finding is actually there.
- **Should understand:**
  - The step runs for the bundle gate as well, once per `spec-{N}` dir in manifest order.
  - A legacy Low-confidence row with no tiebreak verdict is not a can't-tell finding and never triggers filing.
- **Red flags:**
  - the merge or acceptance labeling runs before the findings are listed
  - a non-zero `--list` exit read as "no findings"

### 2. At unattended, the findings are filed
- **URL:** `wrap-up/review-console.md`'s "Can't-tell filings" procedure (`console-filings.js --run {item-run-dir} --existing {issues.json} --out-dir {dir}`), then one `gh issue create` per proposal
- **Action:** when `consoleAutoResolve` is granted, every can't-tell finding is filed, whatever the tiebreak recommended. Each created record logs `AUTO … Queue write: {item} filed as #{n} (work-fingerprint {fp})`, and a finding that already has a record logs `… already filed as #{n} …` instead.
- **Should feel:** hands-off. The maintainer later finds `needs:definition` records titled `Review finding (can't-tell): {path} — {claim}`.
- **Should understand:**
  - Dedup is by `work-fingerprint` over every record, closed ones included, so a re-run never files twins.
  - The `filed as #N` lines are the evidence the archive guard reads.
- **Red flags:**
  - a can't-tell finding dropped because its tiebreak recommended `drop`
  - a created record with no `filed as` line in `decisions.md`

### 3. Below unattended, or on a failed filing, the short-circuit refuses
- **URL:** the run's `decisions.md`, then the rendered Review Console
- **Action:** the short-circuit logs `#{n} has {k} can't-tell finding(s) ({ids}) — {consoleAutoResolve not granted at {ceiling} | filing failed: {reason}}; short-circuit refused, Review Console renders normally` and falls through to "Any layer fails". The normal console then shows the findings in its Low-confidence and Contested sections.
- **Should feel:** safe. A finding nobody could judge waits for a person instead of merging past them.
- **Should understand:**
  - Agent-filed records are only authorized without a human at `unattended`. Below it, the console's Approve all or Override decides file versus drop.
  - The refusal line never says `needs-human`, so at `unattended` the fall-through console can still merge after it files.
- **Red flags:**
  - a merge after a refused filing
  - the refusal line read as a merge-check `needs-human` verdict

### 4. Read the findings in the FYI
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-filings.js" --run "$PIPELINE_RUN_DIR" --fyi`, carried in the short-circuit's `PushNotification`
- **Action:** the FYI prints a `#### Low-confidence findings` and a `#### Contested findings` table: Item, Path:Line, Severity, Lens, Recommendation, and Filed as (`#N` or `—`). Then comes the read-only `#### Dropped by tiebreak` block for high and critical refutations. A run with no findings prints nothing.
- **Should feel:** complete. Every can't-tell finding is named, alongside the record it became.
- **Should understand:**
  - `--fyi` is read-only and refuses `--existing`, `--out-dir`, `--only` and `--list` with exit 2.
  - A dispatched singleton's report replaces the `PushNotification`, so the FYI does not reach a human on that path yet. That gap is tracked as a follow-up.
- **Red flags:**
  - a can't-tell finding missing from the FYI
  - a `Filed as` cell that disagrees with `decisions.md`

### 5. Clear an archive refusal
- **URL:** `node plugin/bin/hooks.js archive-run --run {run-dir}` stdout, or reconcile's `skipped` entry
- **Action:** a console-less auto-merge run (no `console.json`, with the short-circuit's or bundle gate's merge line in `decisions.md`) that still holds a can't-tell finding with no `filed as` line refuses archival. The verb prints `archival refused — cant-tell-unfiled ({n} can't-tell finding(s) an auto-merge path never filed: {ids}) — …, then re-run archive-run`. Reconcile skips with reason `cant-tell-unfiled`, carrying `unfiled` and `hint`. The maintainer files the findings with the printed `console-filings.js` command, which already has the real run dir substituted, logs each `filed as` line, and re-runs.
- **Should feel:** specific and finite. The refusal names each id and a command to paste.
- **Should understand:**
  - A `spec-N/`-prefixed id is filed and logged with `--run {run-dir}/spec-N`, into that spec dir's own `decisions.md`.
  - An unreadable `decisions.md` refuses as `(unreadable: …)` rather than reading as "nothing unfiled".
  - A run whose console rendered (a `console.json`, or a `Review Console: terminal decision` line) is not guarded.
  - A merged run stuck here past the TTL escalates into the reconcile `structurally-stuck` record, whose remedy line names both auto-merge paths.
- **Red flags:**
  - a console-less auto-merge run archives with an unfiled can't-tell finding
  - a hint that still says `{run-dir}`
  - a run whose console rendered is refused

## Origin
- Created during the build of #4171: the short-circuit's and bundle gate's Can't-tell findings step, `console-filings.js --fyi`, `finding-outcomes.js`, and the `cant-tell-unfiled` archive guard in reconcile and `archive-run`.
- Related journeys: `settle-every-review-finding-at-the-console-3949.md` covers the same findings when a console renders. `clear-an-archive-refusal-for-an-untiebroken-finding-3945.md` covers the neighbouring `tiebreak-coverage-missing` refusal.
