# Guided Environment Creation

Referenced by `/claude-tweaks:routine`'s CREATE Step 4 (when no environment exists yet for the
current project — the Create procedure below), by `/claude-tweaks:init`'s Update Mode Routine
Environment Dedication check (`skills/init/update-mode.md` — the Audit and Re-point procedures
below), and by `/claude-tweaks:init`'s Step 14 (`init/bootstrap/step-14-cloud-routine-parity.md`
— the Ensure-setup-script procedure below, which is the only one that targets the environment
interactive sessions use rather than a routine's). Not invoked directly by a human — always
reached from one of those call sites. Each
procedure's own "Takes:" line documents its exact inputs; they are not identical across the three
(Create needs the project-slug and resolved repo URL plus the routine's own fields; Audit needs only
a `trigger_id`; Re-point needs a `trigger_id` plus a `target_environment_name`, and optionally a
`create_if_missing` flag — both Audit and Re-point act on an existing routine, but only Audit's
action is fully determined by the ID alone).

No tool available to this plugin can create, list, or configure a cloud environment object
directly (`RemoteTrigger` is scoped to `/v1/code/triggers` only) — this is always a human-browser,
web-UI action. `playwright-cli` (this plugin's default `/browse` backend) has no authenticated
claude.ai session, so every procedure below drives `/claude-tweaks:browse backend=chrome`
specifically — this repo's existing documented exception for human-invoked, non-Routine browser
automation. Every procedure below is interactive-only: if claude-in-chrome is unavailable (no
extension connected, or the user declines when `/browse` offers it), fall back immediately to
printing the exact values below for the user to enter manually, and return a failure to the caller
in that procedure's own return shape (Create: `{trigger_id: null, console_url: null, environment_id:
null, environment_name: null, connectors_pending: []}`; Audit: `{environment_name: null}`; Re-point:
report failure per its own step 4; Ensure-setup-script: `{success: false, environment_name: null,
had_script: null}`) — never block the calling step's own flow waiting on a browser that isn't there.

**Extension availability is not a one-shot check.** Confirmed live: `list_connected_browsers` can
return a browser and then return `[]` moments later, so a `select_browser` call issued on a stale
listing fails with `No connected browser has deviceId "…"`. Re-list immediately before selecting,
select without an intervening call, and treat a drop mid-procedure as the unavailable case above
rather than retrying in a loop. Any claude.ai re-authentication (`reason=elevated_auth`) drops the
pairing, so a procedure that triggers one will need the user to re-pair before it can continue.

## Naming convention

An environment dedicated to a project's claude-tweaks routines is named:

```
claude-tweaks: <project-slug>
```

`<project-slug>` is the same `REPO_SLUG` value `/claude-tweaks:routine`'s CREATE Step 2 already
derives (lowercase repo name, runs of non-`[a-z0-9]` characters collapsed to a single `-`, leading/
trailing `-` trimmed) — reuse the caller's already-resolved value; never re-derive it here.

## Create procedure

**This procedure creates the caller's actual routine, not a placeholder.** There is no delete API
for a `RemoteTrigger` (confirmed: `skills/routine/SKILL.md`'s own Anti-Patterns table documents
this), so a throwaway routine created purely to surface a new environment's ID would be an orphaned,
schedule-bearing routine with no automated way to remove it. Instead, the same browser flow that
creates the environment also submits the caller's real routine directly through the web UI — one
continuous session, no throwaway, no cleanup step needed. This means the caller must have every
field the routine itself needs already resolved *before* invoking this procedure (in particular,
`/claude-tweaks:routine`'s CREATE flow must resolve its schedule (Step 5) before Step 8 invokes this
file — Step 4 only sets the deferred-invocation flag, it does not call this procedure directly).

Takes: `project_slug`, `repo_url`, `routine_name` (the caller's already-derived `PREFIXED_NAME`),
exactly one of `cron_expression` (the caller's already-resolved recurring schedule, e.g. from
CREATE Step 5's cadence picker — always a raw 5-field UTC cron string, never a natural-language
description) or `run_once_at` (the caller's already-resolved one-off firing time, ISO 8601 UTC —
from the same picker's 5b-i One-off branch), never both, `instructions`
(the routine's prompt text — the caller's `RESOLVED_PROMPT`, i.e. the schema's canonical kernel
block (`_shared/routine-template-schema.md`'s `## Standard prompt kernel`) with its
`{{TARGET_BRANCH}}` placeholder already substituted and `{kickoff}` already spliced, both per CREATE
Step 6; this procedure submits `instructions` verbatim and does no substitution of its own, so a
caller passing raw kernel text creates a routine that tries to check out a branch literally named
`{{TARGET_BRANCH}}`), and `connectors` (optional — `template.mcp_connections` names, if any; see the
connectors caveat in step 6 below).

1. Dispatch `/claude-tweaks:browse backend=chrome` with the instruction: navigate to
   `claude.ai/code`, open the Routines sidebar entry, then click the "+ New routine" button —
   confirmed live as the correct entry point (not a generic "New" sidebar affordance) — leading to
   a new-routine form that exposes the same Environment combobox the edit-routine dialog does.
2. In that form, select the repository matching `repo_url` first (the "Select a repository" control
   near the bottom of the form) — confirmed live that the Environment combobox does not open at all
   until a repository is selected. **This selection is not incidental**: step 6 below submits the
   caller's real routine on this same form, so whichever repository is selected here is the one that
   real, live, billed routine will run against — verify the picked repository matches `repo_url`
   before continuing, never "any" repository. With the correct repository selected, locate the
   "Environment" combobox (a `find` query for "Environment selector combobox" locates it reliably —
   confirmed live against both the new-routine form and the edit-routine dialog's identical
   component) and click it.
3. **Timing note, confirmed empirically during design:** the dropdown's contents do not reliably
   appear in the very next screenshot or accessibility-tree read after the click — insert an
   explicit 1-2 second `wait` action between the click and whatever comes next, every time this
   combobox is opened. Reading or clicking immediately after the open-click, with no wait, was
   observed to silently miss the open state during design verification.
4. **Check for an existing dedicated environment before creating one.** The dropdown opened in
   step 2 already lists every environment by name — read it (a `find` query for "Environment
   dropdown options" or `read_page` scoped to the open combobox works) and look for a row already
   named `claude-tweaks: <project_slug>` (the exact convention step 5 below would otherwise
   create). This exists whenever `/claude-tweaks:init`'s Step 14 (Cloud/Routine Parity Setup)
   already provisioned it for interactive sessions via the Ensure-setup-script procedure below —
   Step 14 runs before this routine-creation flow in every normal `/init` pass, precisely so this
   check finds something. **Found:** click that row to select it, skip step 5 entirely (nothing to
   create), and continue to step 6 with this environment already selected. **Not found:** click
   "+ Add environment" (the last item in the dropdown, below any existing environments) and
   continue to step 5. Skipping this check would create a second, redundant
   `claude-tweaks: <project_slug>` environment whenever Step 14 already provisioned one — a live,
   billed environment with no delete API (the same constraint this procedure's own header states
   for routines).
5. In the resulting "New cloud environment" dialog (only reached via step 4's "Not found" branch):
   set Name to `claude-tweaks: <project_slug>`,
   leave Network access at its default (`Trusted`), leave Environment variables empty, and set
   Setup script to exactly:
   ```
   { bash scripts/claude-cloud-setup.sh || bash */scripts/claude-cloud-setup.sh; } > "$HOME/claude-cloud-setup.log" 2>&1 || true
   ```
   (repo-agnostic and non-blocking by construction — the fallback path covers the field's
   workspace-root cwd, and on a repo that hasn't run `/claude-tweaks:init` the log records bash's
   no-such-file error while session start proceeds). Click "Create environment". This returns to
   the new-routine form with the new environment now selected in the Environment combobox.
6. Fill in the routine's own real fields on that same form — confirmed live against the actual
   new-routine form layout:
   - Type `routine_name` into the "Name" field.
   - Fill the "Instructions" textarea in bounded chunks rather than one unbounded `type` call.
     **Do not issue a single `type` call for the full `instructions` string.** Confirmed failure
     mode: a single-shot `type` of a multi-KB prompt (the common case — 6 of 7 shipped routine
     templates embed a multi-KB cloud self-heal preamble ahead of their `Then:
     /claude-tweaks:<skill>` kickoff line) froze the tab's renderer — `screenshot`/`read_page`
     timed out (`Script injection timed out`, then `Page still loading (executeScript waited
     45000ms for document_idle)`) for over a minute before partial recovery. Click the textarea to
     focus it, then split `instructions` into successive chunks of at most 500 characters (break
     each chunk at the nearest preceding whitespace boundary when one exists within the last 50
     characters of the cut point, so a word is not split mid-token; otherwise cut at exactly 500),
     and issue one `type` call per chunk into the already-focused field, inserting an explicit
     400ms `wait` between chunks so the renderer can catch up before the next injection. A prompt
     at or under 500 characters fits in a single chunk, so the existing single-`type`-call
     behavior for small prompts is unchanged.
   - Click the "Schedule" trigger tile. If `cron_expression` was passed, click its "Custom" sub-tab
     (alongside Once / Hourly / Daily / Weekdays / Weekly) — confirmed live that this reveals a raw
     "Cron expression" text field, pre-filled with a default derived from whatever cadence tab was
     last active. Clear it and type `cron_expression` verbatim. If `run_once_at` was passed instead,
     click the "Once" sub-tab in that same row — its existence alongside Custom is confirmed live,
     but the exact date/time field(s) it reveals were **not live-verified this pass** (unlike the
     Custom sub-tab's cron field above); the reasonable expectation is a date picker and/or a
     text field accepting the resolved UTC instant. Fill whatever the tab exposes with
     `run_once_at`'s date and time components, verifying via a screenshot or accessibility-tree
     read before clicking "Create" that the displayed value matches the resolved instant — do not
     assume the field accepted a raw ISO 8601 paste without checking.
   - **Connectors caveat, not live-verified this pass:** if `connectors` is non-empty, the form's
     Connectors section has a "+ Add connector" control, but the exact picker/search mechanism for
     selecting a *specific* named connector was not exercised during this task's live verification
     (only the default-preselected connector chip was observed). Do not guess at its mechanism —
     leave `connectors` unset on the form for now, complete routine creation without them, and
     include the skipped names in the return value's `connectors_pending` field (step 7 below) so
     the caller can tell the user which connectors still need adding via a manual follow-up (the
     same Edit-routine → Connectors tab, reachable any time after creation). This is a known,
     narrower gap than the throwaway-routine problem this procedure exists to close, and templates
     with empty `mcp_connections` (the common case) are unaffected.
   - Click "Create" to submit the routine.
7. Read the newly-created trigger's ID directly from the post-creation page URL
   (`claude.ai/code/routines/<trigger_id>`) — confirmed live that web-UI-created routines do not
   populate `session_context.sources[].git_repository.url`, so filtering `RemoteTrigger {action:
   "list"}` by `repo_url` does not work for this case. With the trigger ID in hand, call
   `RemoteTrigger {action: "get", trigger_id: <that id>}` and read `job_config.ccr.environment_id`
   off it — this is the new environment's ID. Report `{trigger_id: <that id>, console_url:
   "claude.ai/code/routines/<trigger_id>", environment_id: <that id>, environment_name:
   "claude-tweaks: <project_slug>", connectors_pending: <array of connector names skipped per step
   6's connectors caveat, or an empty array when none were skipped>}` back to the caller (the
   environment name is already known — it was just typed in step 5). The caller uses
   `trigger_id`/`console_url` in place of its own Step 8 `RemoteTrigger create` call and Step 9's
   instantiated-record write — this procedure's own routine
   creation *is* that caller's Step 8 for this one invocation, not a separate or duplicate routine.

## Ensure-setup-script procedure

Takes: `environment_name` (optional). When omitted, operate on whichever environment the session
composer currently has selected — the one a plainly-started cloud session will use. When provided,
this procedure additionally **makes that environment the composer's current selection**, creating
it first (with the canonical script already set) if no environment by that name exists yet — see
step 2's two branches below.

The Create procedure above only ever reaches an environment it is creating for a *routine* — a
project that has never run `/claude-tweaks:routine` has no dedicated environment at all yet. Left
to default, an interactive cloud session uses whichever environment happens to be selected in the
composer — commonly a long-lived, human-named one (`Default`, `General`) that no claude-tweaks flow
has ever touched. That environment having an empty Setup script is the single most common reason a
fully-declared project still reports `Unknown command` for every plugin skill. This procedure
closes that gap. When called with `environment_name` set (as `/claude-tweaks:init`'s Step 14 does,
passing the same `claude-tweaks: <project_slug>` convention routines use), it does more than patch
whatever's currently selected — it points interactive sessions at the *same* dedicated environment
routines use, so there is one Setup script to maintain per project instead of two. It is the only
procedure here that edits an environment's own fields, or (in the new-environment branch) the
composer's current selection, rather than which environment a routine points at.

The composer path below is distinct from the routine-form path Create uses — it was confirmed live
and does not go through the Routines UI at all.

1. Dispatch `/claude-tweaks:browse backend=chrome`: navigate to `claude.ai/code` and click the
   sidebar's **New** entry, which renders the composer with its chip row (environment, repository,
   branch) directly above the prompt box.
2. Click the leftmost chip — the environment chip, showing the current environment's name. A menu
   opens with `Local` / `Cloud` / `Remote Control`. Click `Cloud` to expand its submenu, which
   lists every environment with a checkmark on the selected one, plus `Add cloud environment…` as
   its last item. Apply Create step 3's 1-2 second `wait` here too.
   - **`environment_name` was passed and a row already matches it:** click that row to select it —
     this is what makes it the composer's current environment. **Confirmed live:** the click closes
     the entire chip menu — both the `Local`/`Cloud`/`Remote Control` popover and the `Cloud`
     submenu — rather than leaving a plain, still-visible row for step 3 to hover. This does not
     match the Audit procedure's collapsed-combobox precedent below (lines 245-247): that precedent
     reads a *still-rendered*, closed combobox's selection without ever opening it, whereas here
     nothing stays rendered to read — the precedent does not transfer to this control. Before step
     3's hover-for-gear action, repeat this step's open sequence (click the chip, click `Cloud`,
     apply the same 1-2 second `wait`) to bring the row back into view; a pre-existing environment
     by that name is not guaranteed to already carry the canonical script (e.g. one a human created
     by hand under the same naming convention), so it still gets the same verify/upgrade pass as
     any other target.
   - **`environment_name` was passed and no row matches it:** click `Add cloud environment…` —
     **confirmed live:** that is the composer's own exact label, and this is *not* the same control
     Create step 4 uses. Create step 4's affordance lives on the separate routine-creation form and
     is labeled `+ Add environment` — a different label on a different UI surface (consistent with
     line 190's confirmed-live note that the composer path never touches the Routines UI). The two
     are functionally equivalent (both add a new environment from the last row of their own list)
     but are distinct controls, not the same one. In the resulting "New cloud environment"
     dialog, set Name to `environment_name`, Network access to `Trusted`, leave Environment
     variables empty, and set Setup script to the canonical line (step 4 below). Click "Create
     environment" — this both creates the environment and selects it as the composer's current one
     in a single action. Skip steps 3-5 entirely (nothing to classify or upgrade on a field that
     was just typed fresh) and report `{success: true, environment_name, had_script: false,
     field_action: "created"}`.
   - **`environment_name` was omitted:** proceed as before — operate on whichever row is currently
     checkmarked; the chip menu is still open in this branch (no row was clicked to close it), so
     step 3 can hover it directly.
3. Hover the row for `environment_name` (or the checkmarked row when no name was passed) — a gear
   icon appears on hover and is not present in a screenshot taken before hovering. (When arriving
   from the row-match branch above, the chip menu was already reopened per that branch's note —
   this step still applies to that freshly reopened row.) Click the gear. This opens an **Update
   cloud environment** dialog with Name, Network access, Environment variables, Setup script, and
   `Archive` / `Cancel` / `Save changes` controls.
4. Read the Setup script field. Record whether it was non-empty as `had_script`. Classify it into
   exactly one of the four branches below. The canonical line, restated here rather than cited
   from Create's step 5 deliberately (the two are the same string today but reach different
   environment classes, and a future change to one is not automatically correct for the other):

   ```
   { bash scripts/claude-cloud-setup.sh || bash */scripts/claude-cloud-setup.sh; } > "$HOME/claude-cloud-setup.log" 2>&1 || true
   ```

   The upgrade decision keys on one exact, checkable rule: does the field's
   `claude-cloud-setup.sh` invocation line contain the substring `claude-cloud-setup.log`?
   - **Canonical/current** — the field contains a `claude-cloud-setup.sh` invocation that
     redirects into a `claude-cloud-setup.log` file: click `Cancel` (never `Save changes` — same
     read-only discipline as the Audit procedure) and report success without editing
     (`field_action: unchanged`).
   - **Old form** — the field contains a `claude-cloud-setup.sh` invocation with **no**
     `claude-cloud-setup.log` redirect (with or without `2>/dev/null`): replace that line with the
     canonical line above, leaving any other field content untouched (`field_action: upgraded`).
   - **Empty**: click into the field and type exactly the canonical line above — repo-agnostic,
     safe on a repo that has never run `/claude-tweaks:init` (`field_action: typed`); the
     canonical line always writes `$HOME/claude-cloud-setup.log` on every session start (created
     or truncated fresh each time), the intended evidence trail.
   - **Unrelated content** — no `claude-cloud-setup.sh` invocation at all: **do not overwrite
     it.** Append the canonical line on its own new line after the existing content
     (`field_action: appended`). An
     environment shared with other work can carry a setup script this plugin knows nothing about,
     and replacing it silently breaks that work.
5. Click `Save changes` (skip when step 4's Canonical/current branch already cancelled). The
   dialog notes that changes apply to **new** sessions only — an already-running session does not
   pick this up, so any verification must start a fresh session.
6. Report `{success: true, environment_name: <the name acted on>, had_script: <boolean>,
   field_action: <one of created|unchanged|typed|upgraded|appended>}` (`created` only ever reaches
   this step via step 2's own early report in its "not found" branch above — restated here so the
   full enum is documented in one place). On failure at any step, report the failure shape from
   this file's header and leave the environment untouched.

## Audit procedure

Takes: `trigger_id` (an existing routine's own ID — from a prior `RemoteTrigger list` call, or from a project-local `.claude-tweaks/routines/*.yml` record's `routine_id` field; the caller resolves this however its own detection logic works, this procedure doesn't care which source it came from).

Used only to *read* a routine's currently-configured environment name — never writes anything.

1. Dispatch `/claude-tweaks:browse backend=chrome`: navigate to
   `claude.ai/code/routines/<trigger_id>`, click the routine's Edit (pencil) affordance (a `find`
   query for "Edit button" locates it reliably), then locate and click the "Environment" combobox
   exactly as in Create steps 2-3 above (same 1-2 second wait requirement applies; the repository is
   already selected for an existing routine, so Create step 2's repository-selection sub-step does
   not apply here).
2. Read the combobox's currently-selected value (its displayed text, e.g. `"Default"` or
   `"claude-tweaks: memenu-app"`) — do not open the dropdown itself for a read-only audit, the
   collapsed combobox already shows the current selection.
3. Close the dialog via Cancel (never Save) — an audit must never leave a routine's own name/
   instructions/schedule fields modified, even if nothing in this procedure intentionally touched
   them.
4. Report `{environment_name: <the read value>}` back to the caller.

## Re-point procedure

Takes: `trigger_id`, `target_environment_name`, `create_if_missing` (optional boolean, default
`false`).

1. Dispatch `/claude-tweaks:browse backend=chrome`: navigate to
   `claude.ai/code/routines/<trigger_id>`, click Edit, open the Environment combobox (steps 2-3 of
   Create, same 1-2 second wait requirement; the repository is already selected for an existing
   routine, so Create step 2's repository-selection sub-step does not apply here — same caveat as
   the Audit procedure above).
2. Look for the option matching `target_environment_name` in the now-open dropdown.
   - If found: click it, then continue to step 3.
   - If not found and `create_if_missing` is `false` (the default): report failure — see step 4.
   - If not found and `create_if_missing` is `true`: click "+ Add environment" instead (the same
     option Create step 4 uses) and, in the resulting "New cloud environment" dialog, set Name to
     `target_environment_name` and every other field exactly as Create step 5 sets them (Network
     access, Environment variables, Setup script — same values, not restated here to avoid the two
     copies drifting). Click "Create environment" — this returns to the routine-edit dialog with the
     new environment now selected. Continue to step 3.
     **This is the only environment-creation path that does not also create a new routine** — it
     exists specifically for a caller (e.g. `/claude-tweaks:init`'s Update Mode migration check)
     that needs to bootstrap a dedicated environment for routines that already exist, where
     Create's own "always attach the real routine being created" design (see Create's own header
     paragraph on why it dropped the throwaway-routine approach) has nothing to attach to — this
     routine already existed before this call.
3. Click "Save" on the routine-edit dialog (not the environment sub-dialog — this step only
   changes which environment the routine references, it never edits the environment's own Setup
   script or other fields, and — when a new environment was just created via `create_if_missing` —
   this Save is also what actually attaches it to a real, already-existing routine, exactly the
   property Create's own design relies on).
4. Report back to the caller. On success: report `{success: true}` — plus, if a new environment
   was just created via `create_if_missing`, also call `RemoteTrigger {action: "get", trigger_id}`
   and read `job_config.ccr.environment_id` off it (the same discovery mechanism Create step 7
   uses, against this same already-known `trigger_id` instead of a newly-created one), and report
   `{environment_id: <that id>, environment_name: target_environment_name}` alongside `{success:
   true}` — the caller needs this to write its own environment cache, mirroring what Create
   returns. On failure (option not found and `create_if_missing` was `false`, or Save rejected, or
   the `create_if_missing` sub-flow itself fails partway), report `{success: false}` and leave the
   routine untouched — never leave a routine in a partially-edited state.
