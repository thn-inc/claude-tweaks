# Routine — Fleet Mode (`fleet on` / `fleet status` / `fleet off`)

Loaded by `/claude-tweaks:routine`'s Workflow dispatch when the resolved mode is `fleet on`,
`fleet status`, or `fleet off`. Turns on the self-maintaining posture in one deliberate action: a Manifesto collecting the human-owned policy decisions, then instantiation of every fleet routine from the project's already-parameterized templates, staggered so they don't collide, with an idempotent reconcile on every re-run. `on`'s own re-run **is** the reconcile path (there is no separate `fleet reconcile` verb). `fleet status` and `fleet off` live in their own sections below (#276).

This mode is a loop over the existing CREATE/UPDATE procedure (`create-and-update.md` in this skill's directory), parameterized by the composition table below — never a reimplementation of `RemoteTrigger` handling. Read `create-and-update.md` and `schedule-resolution.md` first; this file states only what fleet mode does differently (per-entry naming, fleet-resolved cron instead of the interactive picker, the reconcile marker rule, and the Manifesto/conditional-provisioning wrapper around the loop).

## Fleet composition table

Buckets, named explicitly in the `Bucket` column below (never restated elsewhere as a bare list, per this project's cardinality-drift rule — this table is the one place the fleet's membership is enumerated; anything that needs to name the fleet's composition links here instead of copying it). The phrasing is deliberately count-free: a literal bucket or row count, restated here or anywhere else, is the exact drift this rule exists to prevent.

| # | Bucket | Entry | Source template | `focus` override | Cron (UTC) | PREFIXED_NAME |
|---|---|---|---|---|---|---|
| 1 | Vertical finder | dead-code | `skills/code-health/routine-template.yml` | `dead-code` | `0 5 * * *` | `{REPO_SLUG}-code-health-dead-code` |
| 2 | Vertical finder | test-hygiene | `skills/code-health/routine-template.yml` | `test-hygiene` | `15 5 * * *` | `{REPO_SLUG}-code-health-test-hygiene` |
| 3 | Vertical finder | abstraction-police | `skills/code-health/routine-template.yml` | `abstraction-police` | `30 5 * * *` | `{REPO_SLUG}-code-health-abstraction-police` |
| 4 | Vertical finder | experiment-cleanup | `skills/code-health/routine-template.yml` | `experiment-cleanup` | `45 5 * * *` | `{REPO_SLUG}-code-health-experiment-cleanup` |
| 5 | Vertical finder | security-hardening | `skills/code-health/routine-template.yml` | `security-hardening` | `0 7 * * *` | `{REPO_SLUG}-code-health-security-hardening` |
| 6 | Generalist sweep | code-health (generalist) | `skills/code-health/routine-template.yml` | none | `0 6 * * *` | `{REPO_SLUG}-code-health-daily` |
| 7 | Generalist sweep | docs-health | `skills/docs-health/routine-template.yml` | n/a | `15 6 * * *` | `{REPO_SLUG}-docs-health-daily` |
| 8 | Generalist sweep | journey-health | `skills/journey-health/routine-template.yml` | n/a | `30 6 * * *` | `{REPO_SLUG}-journey-health-daily` |
| 9 | Generalist sweep | harness-health | `skills/harness-health/routine-template.yml` | n/a | `45 6 * * *` | `{REPO_SLUG}-harness-health-daily` |
| 10 | Shaping unit | specify | `skills/specify/routine-template.yml` | n/a | `0 8 * * 1-5` | `{REPO_SLUG}-specify-weekdays` |
| 11 | Grant unit (conditional) | backlog refine (routine) | `skills/backlog/routine-template.yml` | n/a | `0 9 * * 1-5` | `{REPO_SLUG}-backlog-grant-weekdays` |
| 12 | Dispatch drain | dispatch | `skills/dispatch/routine-template.yml` | n/a | `0 10 * * 1-5` | `{REPO_SLUG}-dispatch-weekdays` |
| 13 | Tidy | tidy weekly | `skills/tidy/routine-template.yml` | n/a | `0 11 * * 0` | `{REPO_SLUG}-tidy-weekly` |

`{REPO_SLUG}` is `create-and-update.md` CREATE Step 2's own derivation (lowercased, non-`[a-z0-9]` runs collapsed to `-`, trimmed) — resolve it once per fleet run and reuse it across every row.

**Stagger rationale (the exact defaults, settled here — not implementer-invented at some later point, per the parent record's Acceptance Criteria):** the vertical finders and generalist sweeps sit in the 05:00-07:00 UTC early-morning window at 15-minute offsets — cheap, read-only sweeps that don't compete with each other for the same repo state. The security-hardening finder takes 07:00 rather than a slot among the other vertical finders: those slots are taken, and moving an existing row's cron would read as drift on every already-provisioned fleet's next reconcile (Step 4's cron comparison), so a new finder takes the next free offset in the window instead. The shaping unit sits at 08:00, after the finder window so overnight-filed records are visible to the firing, and before the grant unit so the one record each firing shapes is grantable the same morning. The grant unit sits at 09:00, after the shaping unit has had a chance to turn a record into `ready` but before the dispatch drain would otherwise claim records nobody has reviewed. The dispatch drain sits at 10:00, after the grant unit so freshly-granted `auto:build`/`auto:merge` records are visible to it the same morning. Tidy is weekly, Sunday 11:00, clear of every daily/weekday entry above.

**Naming deviates from `create-and-update.md`'s standard `{REPO_SLUG}-{routine_name}` derivation for the Vertical finder rows only** — code-health's `routine_name` (`code-health-daily`) is fixed across every code-health instance (the Vertical finder rows and the generalist code-health row), so reusing it verbatim would collide once per vertical. The Vertical finder rows use `{REPO_SLUG}-code-health-{focus}` instead (dropping the `-daily` suffix, since a focus-scoped routine isn't the daily generalist). The generalist code-health row keeps the standard derivation unchanged — `{REPO_SLUG}-code-health-daily` is exactly what a standalone `/claude-tweaks:routine create code-health` would also produce, so a project that already ran that command before ever running `fleet on` gets that routine *adopted into* the fleet on first reconcile (Idempotent reconcile, below), not duplicated. Every other row uses the standard derivation unchanged, one instance per template.

**Composition, not exhaustiveness.** A repo missing a template (e.g. a fork of this plugin that dropped `journey-health/`) gets a **partial fleet**: provision every row whose template exists, skip the rest, and name each skipped row plus the skill it belongs to in the summary — never a refusal, never silence (per this sub-issue's own Deliverables).

## Step 1 — Manifesto

One structured message, the bookend "begin stop" for this action (`_shared/auto-mode-contract.md`'s bookend pattern — this is a single-instance bookend for one `fleet on` invocation, not a multi-step pipeline). Collects every human-owned lever `fleet on` needs, **renders each one back before writing anything** (IL-114 — a render instruction does not bind itself; this is the explicit pre-write check that closes it):

1. Read current values — `autonomy`, `grant-origination-enabled`, `auto-merge-max-lines`/`auto-merge-max-files`, `merge-sensitive-paths`, `fleet-daily-grant-cap` — in one canonical resolver call, whose per-key `{value, source}` JSON envelope is exactly what step 2's table renders:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" autonomy grant-origination-enabled auto-merge-max-lines auto-merge-max-files merge-sensitive-paths fleet-daily-grant-cap
   ```

   All of these are already schema-registered in `bin/lib/policy-schema.js` (the first two by this sub-issue's own prerequisite work in `_shared/autonomy-ceiling.md`; `auto-merge-max-lines`/`auto-merge-max-files`/`merge-sensitive-paths` predate this sub-issue; `fleet-daily-grant-cap` landed with #269 — this sub-issue reads it, never re-registers it).
2. Render every value as a table — key, current value, source (policy.yml / default; each key's envelope `source` field supplies this column directly, `policy` rendering as `policy.yml`) — **before** any `AskUserQuestion` call, so the render-then-write ordering IL-114 requires is structural, not a documentation promise:

   ```
   ### Fleet Config (Manifesto)
   | Lever | Current | Meaning |
   |---|---|---|
   | autonomy | supervised | Ceiling on autonomous action — 'unattended' + the opt-in below are both required to provision the grant unit |
   | grant-origination-enabled | false | The reserved second opt-in `_shared/autonomy-ceiling.md` names — a human sets this deliberately, no skill ever writes it except this Manifesto |
   | auto-merge-max-lines / auto-merge-max-files | 40 / 2 | Consumed by assess-agent-autonomy/dispatch/the grant gate — this Manifesto persists them, never validates their semantics |
   | merge-sensitive-paths | (none) | Same — persisted only |
   | fleet-daily-grant-cap | (unset — uncapped) | Grants-issued-per-UTC-day ceiling the grant unit's own gate chain reads (see the choke-point note below) |
   ```

3. Call `AskUserQuestion` with `question`: `"Confirm fleet configuration before provisioning?"`, `header`: `"Fleet config"`, `multiSelect`: `false`:
   - Option 1 — `label`: `"Provision with current values (Recommended)"`, `description`: `"Use the levers shown above — supervised-only fleet unless autonomy/grant-origination-enabled are already both set"`
   - Option 2 — `label`: `"Change a lever"`, `description`: `"Edit autonomy, grant-origination-enabled, auto-merge caps, merge-sensitive-paths, or fleet-daily-grant-cap before provisioning"`
   - Option 3 — `label`: `"Cancel"`, `description`: `"Don't provision anything"`

   Selecting **Change a lever** re-asks each of the five as its own follow-up (autonomy/grant-origination-enabled as enum/boolean pickers; auto-merge-max-lines/auto-merge-max-files as integers; merge-sensitive-paths as a free-text comma list; fleet-daily-grant-cap as an optional positive integer), writes every changed value to `.claude-tweaks/policy.yml` in the shape `bin/lib/policy-schema.js` expects, re-renders the table with the new values, then proceeds as if Option 1 had been chosen. Selecting **Cancel** stops here — nothing is provisioned, nothing is written.

4. **Every value this step writes echoes in the fleet summary at the end** (Step 5) — no silent config write, per this sub-issue's own Deliverables.

## Step 2 — Cloud-parity honesty check

Fleet routines are scheduled Routines — the exact case CLAUDE.md's Cloud Parity section says the Setup script is measured **not** reaching (IL-113/IL-117). This step never fixes or guarantees anything; it only reports a known gap before creating infrastructure against it, so `fleet on` never silently assumes firings will work:

1. Run the same declaration check `skills/init/bootstrap/step-14-cloud-routine-parity.md`'s Detect section runs: read this project's `.claude/settings.json#enabledPlugins`, confirm `claude-tweaks@claude-tweaks-marketplace` and `superpowers@claude-plugins-official` are both declared. First resolve `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values declare-claude-tweaks`. At `true` (the default) the check is as written. At `false`, only `superpowers@claude-plugins-official` must be declared — a missing claude-tweaks declaration is no gap and never reaches item 3's prompt. When claude-tweaks is in fact undeclared, print this line instead (it prints whatever items 2-3 find), and on a gap append it to the summary's "Gap acknowledged" line: `Cloud parity: claude-tweaks is not declared at project scope (declare-claude-tweaks: false), so cloud firings in this project will not have claude-tweaks installed by the project declaration.`
2. Confirm `scripts/claude-cloud-setup.sh` exists in this repo.
3. If either check fails, report the specific gap (which plugin is undeclared, or that the script is missing) and call `AskUserQuestion` with `question`: `"Cloud/Routine parity isn't fully configured — proceed anyway?"`, `header`: `"Parity gap"`, `multiSelect`: `false`:
   - Option 1 — `label`: `"Proceed anyway"`, `description`: `"Provision the fleet; note the gap in the summary — run /claude-tweaks:init Step 14 to close it later"`
   - Option 2 — `label`: `"Stop and fix parity first"`, `description`: `"Don't provision anything — run /claude-tweaks:init to declare plugins and generate the setup script"`

   This is neither an unconditional refusal nor a silent proceed — the explicit choice this sub-issue's Deliverables require. Record whichever was chosen in the summary (Step 5); "Proceed anyway" records the acknowledged gap verbatim.
4. Both checks passing is a silent pass-through — no prompt, proceed to Step 3; only item 1's opt-out line prints, when it applies.

## Step 3 — Conditional grant-unit provisioning

The grant unit (`backlog refine --source routine`) provisions **only when both** `autonomy: unattended` **and** `grant-origination-enabled: true` hold after Step 1 — "the unattended keys," exactly these two fields, no third, no paraphrase (per this sub-issue's own Deliverables wording). This conditional governs whether `fleet on` creates the Grant unit row's record at all, not the grant chain's own per-firing ceiling gate — the routine's kickoff runs `refine`'s headless posture, whose labeling lanes (Priority/Related/Flag-back/Dependency-repair) apply regardless of ceiling once the routine exists; only its grant chain is gated by these two keys (`refine-headless.md` Step 0).

- **Both set** → the grant unit provisions like every other row in Step 4's loop.
- **Either unset** → skip the grant unit entirely; the summary states plainly that it was withheld and names which policy change(s) would enable it (e.g. "grant unit withheld — set `autonomy: unattended` and `grant-origination-enabled: true` in `.claude-tweaks/policy.yml` to enable").
- **Downgrade on re-run** — a prior `fleet on` provisioned the grant unit (both keys were set then), and this Manifesto pass now reads `supervised` (or `grant-origination-enabled: false`): the grant unit's existing record is not silently left running unexplained. Pause the grant unit's live routine via the `pause` action's `RemoteTrigger update {"enabled": false}` call (`create-and-update.md`'s PAUSE section) and note "paused — autonomy downgraded to {ceiling}" in the summary. This is **harmless-by-construction on the grant side** even before the pause takes effect: `bin/lib/issues/grant-gate.js`'s own gate chain re-checks the ceiling on every firing and denies every candidate at `supervised` (Gate 0, per `refine-headless.md`'s own Step 0 contract) — a still-live but downgraded grant unit's grant chain finds nothing it's allowed to grant and reports a no-op via `decisions.md`. Its labeling lanes are unaffected by this downgrade and keep writing `priority:*`/`**Related:**` changes every firing regardless of ceiling (presence and ceiling are orthogonal — `backlog/SKILL.md`'s Input table; `refine-headless.md`), so a downgraded-but-still-live routine is no longer fully harmless the way the old grant-only kickoff was. State both facts explicitly in the summary so the human doesn't read "still live" as either fully dangerous or fully inert.

## Step 4 — Per-routine provisioning loop

For every row in the composition table whose source template exists on disk (Composition, not exhaustiveness — above), and that Step 3 didn't withhold:

1. **Resolve `PREFIXED_NAME`** from the table (the Vertical finder rows via this file's own `{REPO_SLUG}-code-health-{focus}` naming; every other row via `create-and-update.md` CREATE Step 2's standard derivation — both above).
2. **Idempotent reconcile marker check** (this is the loop's create-vs-update fork, and the "fleet marker" decision rule, fixed here): run `record-freshness.md` Steps F1-F2 for `{PREFIXED_NAME}.yml`, exactly as `create-and-update.md` CREATE Step 3 does.
   - `presence: none` (no local or upstream record) → before treating this as a fresh create, check for a **name collision**: call `RemoteTrigger {action: "list"}` once per fleet run (reuse across every row in this loop — don't re-list per row), filter to triggers whose `job_config.ccr.session_context.sources[].git_repository.url` matches this project's resolved repo URL (same filter as `create-and-update.md` CREATE Step 4 source (b)) **and** whose `name` equals this row's `PREFIXED_NAME`. A match here is a routine created by hand (or by a tool other than this skill) that happens to collide with the fleet's deterministic name — **detected and reported, never adopted or overwritten**: skip this row, note the collision in the summary ("`{PREFIXED_NAME}` already exists as a live routine not tracked by any record — rename it or remove it before re-running `fleet on`"), and move to the next row. No match → proceed to CREATE below.

     **Why name-prefix, not a metadata field:** `RemoteTrigger create`'s body (`create-and-update.md` Step 6) carries no field beyond `name`/`cron_expression`/`job_config`/`mcp_connections` that could hold an owner tag — confirmed against that step's own body schema. The deterministic `PREFIXED_NAME` is therefore the only marker available today; if a future `RemoteTrigger` version adds a metadata field, this check should read it directly instead of the list-and-filter above, but until then the fallback is unconditional, not merely a degraded path.
   - `presence: both` or `local-only` (a record exists) → **reconcile**, not create: run Drift detection below.
   - `presence: upstream-only` → same STOP as `create-and-update.md` CREATE Step 3 (BLOCKED — creating now would mint a duplicate live routine). Report it for this row and continue with the rest of the loop; do not abort the whole fleet run over one row.
3. **CREATE** (no record, no collision): follow `create-and-update.md` CREATE Steps 4 (environment — resolves once, reused across every row in this loop, since one project has one environment) through 9, with two fleet-specific substitutions:
   - **Step 5 (schedule) is replaced entirely** by this row's own composition-table cron — never the template's `default_schedule.cron_expression`, and never the interactive picker (5b-5d). Fleet mode supplies its own coordinated stagger; asking per-row would re-introduce the collision risk staggering exists to avoid.
   - **Step 6 (assemble body)**, for the Vertical finder rows only: append `focus=<value>` to the template's `kickoff` args (single-space join) before Step 6's kernel assembly splices it into the closing line, producing `Then: /claude-tweaks:routine-kickoff code-health focus=dead-code`, etc. — this is exactly the mechanism that field was reserved for.
   - Step 7's preview/confirm collapses into the Manifesto's own confirm (Step 1 above) for a `fleet on` run — do not re-prompt per row; render each row's assembled preview as one line in a single batch table before Step 4's loop actually calls `RemoteTrigger create` for any row (batch-table convention, not N separate confirms).
   - Step 9 writes the instantiated record exactly as documented, using this row's `PREFIXED_NAME` as the record's filename.
4. **RECONCILE** (a record exists): re-render `RESOLVED_PROMPT` fresh via CREATE Step 6's kernel assembly (current schema kernel + this run's resolved branch + the row's `kickoff`, with `focus=` appended for the Vertical finder rows) — the exact same computation Step 3 above's CREATE path would produce for this row today. Call `RemoteTrigger {action: "get", trigger_id: record.routine_id}` and read the live prompt back off `job_config.ccr.session_context.events[].data.message.content` (or the equivalent field the `get` response actually returns — same field CREATE's body assembles into). Compare:
   - **Prompt differs, or the live `cron_expression` differs from this row's composition-table cron** → drift. Run `create-and-update.md` UPDATE Steps 4-7 (assemble, diff, confirm folded into the batch table below, call `RemoteTrigger update`, rewrite the record) for this row.
   - **Both match** → no drift. Nothing to do for this row; note it in the summary as "reconciled, no drift" (AC1's exact expected wording).

   **This is re-render-and-compare, never a `template_version` check** (IL-89) — `template_version` still gets rewritten in the record on an update, but it is never itself the trigger; the byte comparison above is.

   Immediately after the kernel migration ships, every pre-migration live routine diffs as drifted (old full preamble vs newly assembled kernel) — the intended lazy-migration signal, resolved by the standard `update` path, not an error.

## Step 5 — Fleet summary

One consolidated report, closing the Manifesto's begin-stop with an end-of-action summary (not a second bookend — a single `fleet on` invocation is short enough that Manifesto-then-summary is the whole interaction):

```markdown
## Fleet: Provisioning Complete

### Config (from Step 1)
| Lever | Value | Source |
|---|---|---|
| autonomy | {value} | {policy.yml | default} |
| grant-origination-enabled | {value} | {policy.yml | default} |
| auto-merge-max-lines / auto-merge-max-files | {v}/{v} | {...} |
| merge-sensitive-paths | {list or "(none)"} | {...} |
| fleet-daily-grant-cap | {n or "(uncapped)"} | {...} |

### Cloud parity
{"OK — claude-tweaks + superpowers declared, setup script present." | "OK — superpowers declared, setup script present; claude-tweaks not declared (declare-claude-tweaks: false), so cloud firings will not have claude-tweaks installed by the project declaration." | "Gap acknowledged: {what's missing} — proceeded anyway." | "N/A — parity check not run (Step 2 was skipped)."}

### Routines
| Row | Entry | Status | Schedule | Console URL |
|---|---|---|---|---|
| {n} | dead-code | Created | 05:00 UTC daily | {url} |
| ... | ... | ... | ... | ... |
| {n} | backlog refine (routine) | Grant lane withheld — labeling lanes still run once provisioned; set autonomy: unattended + grant-origination-enabled: true to enable the grant chain | — | — |
| — | (missing template) | Skipped — {skill} has no routine-template.yml | — | — |

Status is one of: `Created`, `Updated (drift)`, `Reconciled, no drift`, `Withheld — {reason}`, `Collision — {PREFIXED_NAME} already exists, not tracked by any record`, `Skipped — {skill} has no routine-template.yml`, `BLOCKED — record exists upstream only, not in this checkout`.
```

## Fleet status (aggregation)

One screen answering "what did my codebase do to itself this week." Read-only — no
`RemoteTrigger` create/update calls, no record writes, no grants. Renders cleanly when the
fleet is partially provisioned (missing templates, withheld grant unit, zero records): absent
rows render as absent, never as errors.

**Fleet membership** is resolved from the composition table above: compute every row's
`PREFIXED_NAME` (once — same derivation Step 4.1 uses), then intersect with the instantiated
records enumerated by `record-freshness.md` Steps F1-F2 (`compareRoutineRecords`' `records[]`,
authority copy — never a bare directory listing). A record whose filename matches no
composition-table `PREFIXED_NAME` is **not** fleet-marked and is excluded from every table and
counter below; a hand-created routine sharing a skill under a name outside the composition table
is invisible here by construction. The deliberate exception is the generalist code-health row: a pre-existing
`{REPO_SLUG}-code-health-daily` created by standalone `/claude-tweaks:routine create code-health`
matches that row's standard-derivation name exactly, so it **is** fleet-marked and gets adopted
into the fleet on first reconcile (Naming deviates from `create-and-update.md`, above) — not
invisible, by construction of that same naming rule.

### Step S1 — Routine table

For each fleet-marked record, run `status.md` Steps 2-3.5 (parallel `RemoteTrigger get` calls,
per that file's own parallel-execution note). Use the `--all` branch's non-interactive disposition
throughout: a `get` call that fails outright records the **Stale** verdict in that row's Health
cell (and `—` in its Last firing cell) — never the per-skill branch's interactive
delete-and-recreate offer, which would break this section's read-only promise mid-render. Render:

| Routine | Schedule | Last firing | Health |
|---|---|---|---|
| {name} | {record.schedule} | {last-run field from `RemoteTrigger get`, or "unknown — get response carries no last-run field"} | {STATUS verdict: In sync / Drifted / Orphaned / Stale / Malformed} |

Health is exactly `status.md`'s five-verdict set — never a sixth value. When a record's `webhook_triggers` array (`_shared/routine-template-schema.md`) is non-empty, append its length to the Routine cell, e.g. `code-health-daily (+1 webhook)` — empty or absent renders nothing extra, never a literal `(+0 webhook)`.

### Step S2 — Trust table

Render the per-class trust table by running `_shared/trust-table.md`'s **Fetch** and **Render**
sections verbatim — the same shared path `/claude-tweaks:backlog overview` (Step 1.5) and
`/claude-tweaks:help` (Stage 4.8) already use. The Fetch section goes in whole, including its
`backlog-fetch-limit` and `work-links` resolution sub-sections. Never fork a third rendering
(IL-32).

### Step S3 — Weekly counters

Posture first — compute via `fleetPosture` (`bin/lib/issues/fleet-counters.js`):
`grantUnitProvisioned` = the grant unit's `{REPO_SLUG}-backlog-grant-weekdays.yml` record is
fleet-marked present; `autonomy` / `grantOriginationEnabled` from
`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values autonomy grant-origination-enabled`.
`--values` mode emits plain-text scalars, not JSON booleans, so `grant-origination-enabled`
arrives as the string `"true"`/`"false"`; `fleetPosture` accepts `'true'` verbatim (same
string-vs-boolean coercion `skills/backlog/refine-headless.md`'s Phase A script performs explicitly
for its own `$OPT_IN` shell variable), so pass the resolver's output straight through with no
extra coercion here.
A **supervised** posture renders no grant counters and states why: "supervised fleet — no grant
unit provisioned (or unattended keys unset); grant counters not applicable."

Fetch the counter inputs (REST list, never `--search` — search-index lag), then derive every
number with `deriveFleetCounters(input, Date.now())` — the window is a rolling 7×24h window
ending at render time, boundaries computed from full ISO datetimes (IL-47), and is printed in
the header line: `Week of {startIso} → {endIso}`.

| Counter | Value | Source (stated inline in the render) | Blind spot (stated inline) |
|---|---|---|---|
| Firings | {fired}/{total} routines fired | per-routine STATUS `RemoteTrigger get` last-run field | only the *last* firing is visible — a routine that fired 7× counts once; a get response with no last-run field counts as not fired |
| Findings filed | {n} | records created in-window carrying a `by:*` origin label (`gh issue list` REST, `createdAt` in-window) | only tracker-visible records are counted — a finder whose filing failed is invisible, and records predating the tracker are out of scope |
| Grants issued | {machine} machine / {human} human | in-window `auto:build`/`auto:merge` label events; machine identified by the `<!-- grant-mode-audit: ... -->` comment marker (#269), human by its absence | grants counted from audit comments cannot see pre-feature history; a human grant's timestamp comes from the label-add event, which GitHub's timeline may paginate; the machine count does not distinguish grants still inside their post-#309 veto window (pending) from fully matured ones |
| Merges | {n} | closed records whose closing event carries a merge commit, `closedAt` in-window | records closed by hand (wontfix/duplicate) are excluded; squash-merges closed without a closing keyword are invisible |
| Revocations | {n} | trust reads — negative-evidence outcomes (failure-classification markers, `bin/lib/issues/retry.js`'s shape, and detected reverts) whose evidence entered the window, counted per class-downgrade event, not per marker | evidence is read from issue comments and git history; a revert pushed without landing on the integration branch is invisible; a class downgraded more than once in the window counts once, and in-window evidence does not prove a downgrade actually occurred |

Counter honesty is structural: each cell's Source and Blind spot columns render in the output —
never a bare total over a domain the lookup can't enumerate (IL-110, IL-67).

**Posture taxonomy (defined here, since status reports it):** a **supervised** fleet has no
grant routine provisioned (or unattended keys unset); an **unattended** fleet has the grant
routine present and both unattended keys true — detected from the provisioned set plus policy.

## Fleet off (pause-based shutdown)

Pause-based shutdown that preserves all durable state — rotation cursors, wontfix
suppressions, trust history, and every instantiated record survive. `fleet off`
**never deletes anything** (`RemoteTrigger` has no delete API to call in the first place)
and **never touches a routine that is not fleet-marked** — a hand-created routine sharing
a skill under a name outside the composition table is untouched by construction. (The generalist code-health row's
adoption exception applies here too — an adopted `{REPO_SLUG}-code-health-daily` is
fleet-marked and *is* in scope for pausing, same as any other fleet member.)

1. **Enumerate** fleet-marked routines exactly as Fleet status resolves membership
   (composition-table `PREFIXED_NAME`s ∩ `record-freshness.md`'s `records[]`). Capture the
   before-list. A repo with no fleet-marked routines reports that plainly — "no fleet-marked
   routines in this project; nothing to pause" — and stops. Not an error.
2. **Pause.** Pause each fleet-marked routine via the `pause` action's `RemoteTrigger update
   {"enabled": false}` call (`create-and-update.md`'s PAUSE section) — reuse its per-row record
   resolution rather than Step 4's batch collision-list, since pausing needs no `RemoteTrigger
   list` scan. If a row's call fails because its `routine_id` no longer resolves (deleted
   out-of-band at claude.ai/code/routines), report that row stale — same recourse as
   STATUS/UPDATE (delete `.claude-tweaks/routines/{PREFIXED_NAME}.yml`, re-run `create <skill>`)
   — and continue pausing the rest of the fleet; one stale row must not abort the whole run.
   Report the paused set and what state survives (records, cursors, suppressions, trust
   history — all of it). Nothing is ever deleted (`RemoteTrigger` has no delete API to call in
   the first place) — deletion, if ever wanted, stays a manual step at claude.ai/code/routines
   (IL-69: destroying billed infrastructure must have a decided human owner).
3. **Verify scope (AC3):** list routines before and after — the after-list must show every
   fleet-marked routine paused, and every non-fleet routine byte-identical in state. Include
   both lists in the report.
4. **Round-trip note (AC4):** a paused fleet is resumed **per routine**, via
   `/claude-tweaks:routine resume <skill>` (RESUME's own `{"enabled": true}` call) — re-running
   `fleet on` alone does not resume a paused routine, since RECONCILE (Step 4 above) only
   reassembles schedule/prompt/model/tools and never touches `enabled`: a `fleet on` reconcile
   pass on an otherwise-unchanged template correctly reports "reconciled, no drift" while the
   routine stays paused. The marker semantics both provisioning and pause/resume consume are
   this file's own composition-table `PREFIXED_NAME` rule (Step 4.2) — one home, both
   consumers.

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Re-deriving repo URL / `REPO_SLUG` / environment per row | `create-and-update.md` CREATE Steps 2 and 4 resolve these once per project, not per routine — a fleet repeats the same `RemoteTrigger`/git calls once per row for values that don't change across rows |
| Comparing `template_version` to decide drift | IL-89 — a version string proves nothing about content. Re-render the prompt and compare bytes (Step 4's RECONCILE) |
| Treating a `presence: none` + live-routine-name-match as "adopt it" | The routine wasn't created by this skill (no record exists) — adopting it silently could overwrite a hand-tuned prompt with no way to recover it (`RemoteTrigger` has no delete-and-restore). Report the collision; never touch it |
| Provisioning the grant unit because `autonomy: unattended` alone is set | The reserved second opt-in (`grant-origination-enabled`) is deliberately a separate human decision — `_shared/autonomy-ceiling.md`'s whole point is that the ceiling alone never authorizes a machine-originated grant |
| Silently deleting or pausing a downgraded grant-unit routine | Deletion has no undo (`RemoteTrigger` has no delete API to call in the first place, at claude.ai/code/routines this is a manual step) — pause when the verb exists, otherwise surface prominently, never act unprompted beyond what Step 3 documents |
| Re-prompting per row for schedule/environment/confirm | Fleet mode's whole point is one deliberate action — the Manifesto (Step 1) and the batch preview (Step 4.3) are the only confirmation points; one `AskUserQuestion` call per row would defeat "one-action provisioning" |
| Treating a missing template as a fleet-wide failure | Composition, not exhaustiveness — provision what exists, name what's missing, never refuse the whole fleet over one absent template |
| Deleting (or offering to delete) routines from `fleet off` | Deletion has no API and no undo — `fleet off` is pause-based precisely so durable state survives; deletion is a human act at claude.ai/code/routines (IL-69) |
| Pausing a routine that is not fleet-marked | A hand-created routine sharing a skill under a name outside the composition table is someone else's infrastructure — membership is the composition-table `PREFIXED_NAME` intersection, never a skill-name match. (The generalist code-health row's standard-derivation name is the one deliberate exception — adopted, not treated as someone else's.) |
| Rendering grant counters on a supervised fleet | No grant unit exists to count — state the posture and why grant counters are absent instead of rendering zeros that imply a grant unit ran |
