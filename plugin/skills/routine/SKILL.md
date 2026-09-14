---
name: routine
description: Use to create, update, or check status of a Claude Code cloud Routine for a claude-tweaks skill — instantiates a project-agnostic template into a live, scheduled routine. Keywords - routine, schedule, cron, cloud agent, recurring, automation.
argument-hint: "<create|update|status|pause|resume|webhook-trigger> <skill>|--all|<fleet on|status|off> [--dry-run] [--defaults] [--branch <name>] [--environment <id>] [--refresh-environment] [--events <e1,e2,...>] [--filter <field>=<op>:<value>[,...]]"
---

# Routine — Instantiate Versioned Cloud Routines

Turns a skill's plugin-shipped routine template into a live Claude Code cloud Routine for the current project — resolving the account- and project-specific values (environment, repo) that a portable template can't hardcode, then driving the `RemoteTrigger` API directly. Skips `/schedule`'s own conversational flow entirely: the template already has the answers.

```
              [ /claude-tweaks:routine ] <- utility (no fixed lifecycle position)
                           |  reads {skill}/routine-template.yml
                           v
template + resolved project/account values -> RemoteTrigger create/update -> .claude-tweaks/routines/{name}.yml
```

## When to Use

- You want a skill's documented "Routine Configuration" to become a real, live scheduled cloud Routine instead of a manual `/schedule` walkthrough.
- You want that routine's config captured as a versioned, reproducible project artifact — not something that only exists in claude.ai's UI.
- You're setting up the same kind of routine (e.g. code-health) in a new project and want it created the same way every time, without re-answering `/schedule`'s interactive questions from scratch.
- You want the release train — a daily unattended firing of `/claude-tweaks:release --train` that ships minor and patch releases whose pre-bump review came back clean: `/claude-tweaks:routine create release` instantiates `skills/release/routine-template.yml`; it is a refused, nothing-moved `failed` stop until the project sets `release-train: true` and `autonomy: unattended` (`_shared/autonomy-ceiling.md`'s `train (Routine firing)` row).

Supports both recurring and one-off (single-fire, auto-disabling) cadences for a templated routine — the CREATE Customize path's cadence picker (`schedule-resolution.md` 5b-i) offers "One-off" alongside the recurring options. A one-off run does not count against the account's daily routine-run cap, unlike a recurring one. Not for: an ad hoc, exploratory routine you don't want captured as a versioned project artifact at all (use `/schedule` directly for that — a throwaway session, no `.claude-tweaks/routines/*.yml` record). Not a replacement for `/schedule`'s `list`/`run` conveniences or for deleting a routine — deletion has no API and always happens at claude.ai/code/routines.

## Input

`$ARGUMENTS`:

| Argument | Behavior |
|---|---|
| `create <skill>` | Instantiate `<skill>`'s routine template into a live routine for the current project. Routes to the UPDATE workflow automatically if an instantiated record already exists for this project+skill combination. |
| `update <skill>` | Re-sync an existing routine against its (possibly changed) template. |
| `pause <skill>` | Pause `<skill>`'s live routine — a single-field `RemoteTrigger update` setting `enabled: false`, nothing else reassembled or changed. Reversible via `resume`. |
| `resume <skill>` | Resume `<skill>`'s paused routine — the same single-field call, `enabled: true`. |
| `webhook-trigger <skill> --events <e1,e2,...> [--filter <field>=<op>:<value>[,...]] [--dry-run]` | Attach a GitHub-event trigger to an existing routine, via `RemoteTrigger {action: "create_webhook_trigger"}` — the routine also fires on matching GitHub activity, in addition to its schedule. See `/claude-tweaks:routine`'s WEBHOOK-TRIGGER mode in `webhook-trigger.md`. |
| `status <skill>` | Show the instantiated record for `<skill>` alongside live routine state. |
| `status --all` | Bulk drift check across every instantiated record in the project (`.claude-tweaks/routines/*.yml`), regardless of skill — no `<skill>` argument. The only entry point that can discover a record whose named skill no longer exists at all (renamed/retired), since every other path here starts from a skill name and checks that skill's own template file forward. See STATUS Step 1's `--all` branch for the full verdict table. |
| `fleet on` | Turn on the self-maintaining posture in one action: a Manifesto collecting the human-owned policy levers, then provisioning (or reconciling, on a re-run) every routine in the fleet composition table. That table — in `fleet.md`, this skill's directory — is the one place the fleet's membership is enumerated; read the buckets there rather than restating them here. |
| `fleet status` | One aggregated read-only screen for the fleet: fleet-marked routine table (schedule, last firing, health), the per-class trust table, and the weekly counters (firings, findings, grants split human/machine, merges, revocations) with each counter's source and blind spots named inline. See `fleet.md`'s Fleet status section. |
| `fleet off` | Pause-based shutdown of every fleet-marked routine — durable state (records, rotation cursors, wontfix suppressions, trust history) survives. Never deletes; never touches non-fleet routines. Pauses each fleet-marked routine via the `pause` action above. See `fleet.md`'s Fleet off section. |
| `--dry-run` (combine with `create`/`update`) | Assemble and display the `RemoteTrigger` body (on `create`, when an environment was already resolved) or a text preview (on `create`, when none was — no browser session opens, no body exists to assemble); never make a `create`/`update` call or open a guided-creation browser session (read-only `list`/`get` calls to resolve values are still permitted), never write or rewrite the instantiated record. |
| `--defaults` (combine with `create` or `update`) | On `create`: skip Step 5's interactive cadence picker (use the template's own `default_schedule.cron_expression` verbatim — always recurring, since a template's `default_schedule` has no one-off form) and Step 7's interactive confirm (proceed straight to creation once the body is assembled, or straight to the guided-creation flow if none was). On `update`: skip Step 3's schedule re-resolution entirely (keep the record's existing cadence fields — `cadence` plus whichever of `schedule`/`run_once_at` it carries — untouched, no cadence picker at all) and Step 5's interactive confirm (proceed straight to Step 6 once the body is assembled). Either way, for non-interactive/batch use. Environment still resolves via Step 4's normal sources (`--environment`, the cache, or its two fallback lookups); if none yields a value, `--defaults` does **not** suppress guided creation's own browser session (opening a browser and creating live, billed infrastructure is a bigger commitment than the batch-confirm callers like `/init` Step 15 already cover — Step 7's preview is still shown as a non-blocking report either way). |
| `--branch <name>` (combine with `create`/`update`) | Pin the branch the routine audits — substituted into the kernel's `{{TARGET_BRANCH}}` placeholder, skipping every other source in CREATE Step 5.5's precedence. Use it when the repo's active development branch isn't its GitHub default (a `dev` → `staging` → `main` model), which is otherwise the case a routine gets wrong; `integration-branch` in `.claude-tweaks/policy.yml` is the durable form of the same answer. |
| `--environment <id>` (combine with `--defaults`, or standalone) | Use this environment ID directly in Step 4, skipping every other resolution source. |
| `--refresh-environment` (combine with `create`/`update`) | Bypass the environment cache and Step 4's `RemoteTrigger`-backed lookups (both source (a) and source (b)) — go straight to asking the user directly which environment to use, then overwrite `.claude-tweaks/routine-environment-cache.yml` with the freshly chosen value. Use this to correct a stale or wrongly-inferred cached/inferred environment without already knowing its raw ID. Mutually exclusive in effect with `--environment <id>` — if both are passed, `--environment` wins (it already skips every other source, including this one) and no prompt occurs. |
| `--source <parent-skill>` | Used by a parent skill (e.g. `/claude-tweaks:init`) to identify itself as the caller; see Component-Skill Contract below. |

## Workflow

Resolve the mode from `$ARGUMENTS` (`create` | `update` | `pause` | `resume` | `webhook-trigger` | `status` | `fleet on` | `fleet status` | `fleet off`), then read exactly one procedure file from this skill's directory. The modes are mutually exclusive, and `status --all` — the form `/claude-tweaks:init`'s Update Mode fires in bulk — has no use for CREATE's or UPDATE's body at all.

| Mode | Read | Covers |
|---|---|---|
| `create <skill>` | `create-and-update.md` | CREATE Steps 0-9. Its Step 3 idempotency check routes to UPDATE automatically — same file, no second read. |
| `update <skill>` | `create-and-update.md` | UPDATE Steps 0-7. UPDATE reuses CREATE's Steps 1, 2, 4, 5.5, and 6 by name, which is why the two modes share one file rather than splitting into two that would each read the other. |
| `pause <skill>` / `resume <skill>` | `create-and-update.md` | PAUSE / RESUME — a single-field `RemoteTrigger update` (`{"enabled": false}` / `{"enabled": true}`). Reuses CREATE/UPDATE's record-resolution steps by name; no schedule or body reassembly. |
| `webhook-trigger <skill>` | `webhook-trigger.md` | WEBHOOK-TRIGGER — attaches a GitHub-event trigger to an existing routine via `create_webhook_trigger`. Kept out of `create-and-update.md` (own file, not folded in) since it needs none of CREATE's environment/schedule ceremony. |
| `status <skill>` / `status --all` | `status.md` | STATUS Steps 1-3.5, including the `--all` bulk-enumeration branch. Needs nothing from CREATE or UPDATE. |
| `fleet on / status / off` | `fleet.md` | Steps 1-5 (Manifesto, cloud-parity check, conditional grant-unit provisioning, per-routine provisioning loop, summary). Its provisioning loop itself reads `create-and-update.md` per row — same CREATE/UPDATE procedure, parameterized by `fleet.md`'s own composition table rather than a single skill argument. `fleet status` and `fleet off` are the two companion sections in the same file (aggregated dashboard; pause-based shutdown). |

`create` and `update` additionally read `schedule-resolution.md` for CREATE Step 5's sub-steps (5a's cron-to-cadence classification, 5b-5d's interactive picker — 5b-i splits recurring vs. one-off before 5b-ii's four recurring options, both within `AskUserQuestion`'s 4-option-per-question cap). `update --defaults` skips schedule re-resolution entirely and never reads it; `status` never reaches it at all.

**Every mode** reads `record-freshness.md` before touching `.claude-tweaks/routines/*.yml` — including `fleet on`'s per-row reconcile check (`fleet.md` Step 4), which runs it once per composition-table row via the same F1-F2 sub-steps CREATE Step 3 uses. Those records are a committed artifact, so the branch they are committed to — not the working checkout — is where one actually lives; reading the checkout directly reports drift that does not exist and, at CREATE Step 3, mints a duplicate live routine that `RemoteTrigger` cannot delete (#190). It is its own file precisely because every mode needs it and `status --all` must not be made to load `create-and-update.md` to get it. The check is fail-open: offline, no remote, or no branch resolved all degrade to the pre-#190 working-checkout read, so the skill stays fully usable without a network.

Step numbering inside those files is unchanged from before the split, so cross-references from other skills that name a step by number (`/claude-tweaks:init`'s Step 15 and Update Mode, `_shared/routine-diagnostic-probe.md`, `guided-environment-creation.md`) still resolve — via the three stubs below.

### CREATE `<skill>`

Steps 0-9 live in `create-and-update.md` in this skill's directory; Step 5's own 5a-5d live in `schedule-resolution.md`. The live routine's `session_context.model` is caller-overridable, not fixed to the template's declared model — see `_shared/routine-diagnostic-probe.md`'s note on that field.

### UPDATE `<skill>`

Steps 0-7 live in `create-and-update.md` in this skill's directory, after the CREATE section.

### PAUSE `<skill>`

Steps 1-3 live in `create-and-update.md` in this skill's directory, after the UPDATE section — a single-field `RemoteTrigger update` (`{"enabled": false}`) reusing CREATE/UPDATE's record-resolution steps by name.

### RESUME `<skill>`

Same file, immediately after PAUSE — the mirror call (`{"enabled": true}`).

### WEBHOOK-TRIGGER `<skill>`

Steps 0-6 live in `webhook-trigger.md` in this skill's directory — attaches a GitHub-event trigger to an existing routine via `RemoteTrigger {action: "create_webhook_trigger"}`, parallel to CREATE's `cron_expression` path but without CREATE's environment/schedule ceremony.

### STATUS `<skill>`

Steps 1-3.5, including the `--all` branch, live in `status.md` in this skill's directory.

### FLEET `on / status / off`

Steps 1-5 live in `fleet.md` in this skill's directory: the Manifesto (policy levers), a cloud-parity honesty check, conditional grant-unit provisioning (gated on the two unattended keys), a per-routine provisioning loop over the fleet composition table (driving CREATE/UPDATE per row, with its own idempotent reconcile marker rule), and a consolidated summary. Re-running `fleet on` is the reconcile path — there is no separate verb. `fleet status` (aggregation over `status.md`'s per-routine STATUS, the shared trust render, and `bin/lib/issues/fleet-counters.js`) and `fleet off` (pause-based shutdown — pauses every fleet-marked routine via the `pause` action) live in the same file.

## Next Actions

For `create`/`update`/`status <skill>`, render as plain markdown (docs/skill-authoring.md's Skill handoffs convention). Right after a `create` operation, the "Check status" line renders first, bolded, with `(recommended)`; after `update` or `status`, no line is bolded:

`/claude-tweaks:routine status <skill>` — check on a routine you just created
`/schedule` — inspect, run, or list any routine (including ones this skill created) via the built-in conversational flow. Deletion always happens at claude.ai/code/routines.
`/claude-tweaks:routine update <skill>` — re-sync after the template changes

For `fleet on`, `fleet.md`'s own Step 5 summary is the terminal output — and for `fleet status` / `fleet off`, the rendered dashboard / shutdown report is likewise terminal. Omit this block for all three.

## Component-Skill Contract

When invoked with `--source init` (used by `/claude-tweaks:init`'s Step 15, and by Update Mode's Routine Drift check for `status --all` and `update --defaults`), `/claude-tweaks:routine` is running as a component of `/init`'s bootstrap flow — omit the `## Next Actions` block, since `/init` owns the overall handoff. `/init` does not set `$PIPELINE_RUN_DIR` (it is not a `/flow`-style pipeline orchestrator), so `--source init` is the sole signal for this caller, not merely a fallback for a rare ambiguity — unlike most component-skill contracts in this plugin, `$PIPELINE_RUN_DIR` is not the primary signal here.

Standalone invocation (no `--source` flag) is the common case and renders Next Actions as usual.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Writing `environment_id` or a repo URL into a skill's `routine-template.yml` | Templates ship across every project and account — one account's environment or one project's repo makes them wrong everywhere else |
| Skipping the review gate because the assembled body "looks right" | `RemoteTrigger create` has no delete counterpart — a mistaken routine runs live until manually removed at claude.ai/code/routines |
| Creating a second routine for a project+skill that already has an instantiated record | Duplicates double-run the same work — resolve existence over the union of this checkout and the integration branch (`record-freshness.md`) first, then route to `update` |
| Reading `.claude-tweaks/routines/*.yml` straight from the working checkout | Those records are committed, so a checkout behind the integration branch reports drift that does not exist — and then feeds it into a live `RemoteTrigger update` and a record rewrite. A record committed upstream is invisible to that read entirely, which is how CREATE mints the duplicate the row above forbids (#190) |
| Gating a stop on "the checkout is behind" rather than on a verified comparison | A failed fetch means unknown, not stale. Blocking on it would make `/claude-tweaks:routine status` unusable offline — a worse regression than the misreport being fixed |
| Committing account-specific values into the instantiated record | Its schema excludes `environment_id` and MCP credentials so it stays safe to commit |
| Treating `--dry-run`'s assembled body as already created | Nothing is created, updated, or written until the non-dry-run path's final API call and record write |
| Caching `environment_id` under `~/.claude-tweaks/` | Harness-owned runtime state — use the project-local `.claude-tweaks/routine-environment-cache.yml` instead (checked before CREATE Step 4's local-records and `RemoteTrigger list` sources) |
| Using `--defaults` (on `create` or `update`) for a single ad hoc invocation the user hasn't confirmed at a higher level | It's `/init`'s non-interactive entry point for a batch already confirmed via multiSelect picklist or apply-all table (see the `/claude-tweaks:init` row below) — standalone it removes the only safety check on a billed, hard-to-revert action, for no batching benefit |
| Letting a routine's target branch default to the repo's GitHub default without checking where development happens | On a `dev` → `staging` → `main` model the default branch can be both behind *and* ahead of the active one, so every firing judges a tree matching neither — and fixes already merged get re-reported forever with nothing indicating why (#132). Step 5.5's preview line exists to make that comparison visible before the routine is created |
| Editing a `routine-template.yml` without bumping its `template_version` | The live routine holds a frozen copy of the old prompt, and STATUS's only drift signal is the version comparison — an unbumped edit leaves every existing routine running the old text with nothing reporting it |
| Editing the kernel in `_shared/routine-template-schema.md` without bumping `kernel_version`, or a template's own fields without bumping `template_version`, and treating the suite's green as confirmation | `tests/routine-template-schema.test.js` enforces only that every template matches the schema byte-for-byte and that `template_version`/`kernel_version` are positive integers — never that either *incremented*. A kernel edit reaches every existing template's assembled prompt at once, so a kernel edit with no `kernel_version` bump is a green suite and every live routine still running the old prompt, `/claude-tweaks:routine status` reporting no drift |
| Passing `--all` together with `<skill>` | `--all` takes no skill name — it enumerates every instantiated record in the project. Combining them is a contradiction, not a narrower filter; ask which was meant rather than picking one. |
