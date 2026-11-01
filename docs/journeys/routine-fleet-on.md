---
files:
  - plugin/skills/routine/fleet.md
  - plugin/skills/routine/SKILL.md
  - plugin/skills/specify/routine-template.yml
  - plugin/skills/backlog/routine-template.yml
  - plugin/bin/lib/policy-schema.js
---

# Routine Fleet On

**Persona:** Project operator who wants the self-maintaining posture — scheduled finders filing records, health sweeps, and the dispatch drain — provisioned in one deliberate action instead of one `/claude-tweaks:routine create` walkthrough per routine.
**Goal:** Run `/claude-tweaks:routine fleet on` once and end with the fleet's routines live (or reconciled) on staggered cadences, with the grant unit provisioned only if the two autonomy keys are already deliberately set.

## Steps

1. **Invoke** — Type `/claude-tweaks:routine fleet on`.
   - **Action:** The skill reads the five human-owned levers from `.claude-tweaks/policy.yml` (`autonomy`, `grant-origination-enabled`, `auto-merge-max-lines`/`auto-merge-max-files`, `merge-sensitive-paths`, `fleet-daily-grant-cap`) and renders them back as a table *before* asking anything.
   - **Check:** The Fleet Config (Manifesto) table shows each lever's current value and source; the `AskUserQuestion` offers Provision with current values / Change a lever / Cancel.

2. **Confirm (or edit) the Manifesto** — Pick "Provision with current values", or "Change a lever" to edit any of the five (each re-asked individually, written to `policy.yml`, table re-rendered).
   - **Check:** Any value written here echoes again in the final summary — no silent config write.
   - **Check:** `autonomy` reaches further than the grant unit's provisioning gate. With `housekeeping-auto-merge` left unset, `trusted`/`unattended` is what its effective default derives from (#580), so the weekly tidy routine may arm `--auto` on its own green, marker-stamped housekeeping PRs instead of staging them. Writing `housekeeping-auto-merge` explicitly in `policy.yml` overrides the derivation in both directions.

3. **Cloud-parity check** — The skill verifies the environment's Setup-script reality before creating billed infrastructure.
   - **Check:** A parity note names what was verified (or what could not be), per `fleet.md` Step 2.
   - **Check:** With `declare-claude-tweaks: false` in `policy.yml` (#4847), a missing claude-tweaks declaration is no parity gap. The check prints one informational line naming the cloud consequence: fleet routines need claude-tweaks installed in the sandbox some other way. The summary uses the opt-out "OK" alternative. superpowers is still required. See `docs/journeys/opt-out-of-project-scope-claude-tweaks-declaration.md`.

4. **Provisioning loop** — The skill walks the fleet composition table (the focus-scoped code-health vertical finders, the generalist sweeps, the shaping unit, the conditional grant unit, the dispatch drain, tidy weekly), running the existing CREATE/UPDATE procedure per row with fleet-resolved crons instead of the interactive cadence picker.
   - **Check:** The conditional grant unit (`backlog refine`'s headless posture) provisions **only** when `autonomy: unattended` AND `grant-origination-enabled: true` were both already set — otherwise it is reported as skipped with the two-key reason. A repo missing a template gets a partial fleet with each skipped row named, never a refusal.
   - **Check:** Re-running `fleet on` on a fleet provisioned before a row was added (e.g. the `security-hardening` Vertical finder, daily 07:00 UTC, #3276) creates only the new routine. Every existing routine reports "reconciled, no drift", because a new row takes a free cron slot instead of shifting an existing row's cron.

5. **Summary** — One table: each row's PREFIXED_NAME, created vs adopted vs reconciled vs skipped, its cron, and every policy value the Manifesto wrote.
   - **Check:** A second `fleet on` run is an idempotent reconcile — existing routines (including any created earlier by standalone `create`) are adopted or re-synced, never duplicated.

## Outcome

The fleet is live: finders file records overnight, the shaping unit turns one of them into a `ready` spec each weekday morning (stamping `shaped:headless` — nobody reviewed that spec body), the grant unit (if unlocked) grants within its gate chain and daily cap — where a `shaped:headless` record additionally faces a fixed `medium` provenance floor on both risk and size, so a machine-shaped record above that floor is held for `/claude-tweaks:backlog refine` rather than auto-granted, and a content-level refusal (gate 4) instead stamps `needs:decision` plus a decision comment and drops the record out of both the shaping and grant units until a human resolves it — the dispatch drain builds what is granted, and tidy sweeps weekly — self-merging its own green housekeeping PRs wherever `autonomy` sits at `trusted`/`unattended` with `housekeeping-auto-merge` unset, staging them otherwise. Checking on it is `fleet status` (routine health, trust table, weekly counters); turning the posture off again is `fleet off` — pause-based, pausing every fleet-marked routine's `enabled` flag via a single-field `RemoteTrigger update` while every durable state (records, rotation cursors, wontfix suppressions, trust history) survives. See `docs/journeys/routine-fleet-status-and-off.md`.
