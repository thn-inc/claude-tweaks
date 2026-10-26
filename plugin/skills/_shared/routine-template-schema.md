# Routine Template Schema

Canonical schema for the two file types the routine-template mechanism uses. This file is the single source of truth — `/claude-tweaks:routine` and every skill's own `routine-template.yml` reference it rather than restating the field list.

## Why this exists

claude-tweaks is a single global plugin installed across many projects and one Anthropic account. A routine (a scheduled cloud agent, created via the `RemoteTrigger` tool) is inherently tied to one project + one account. Splitting "what's portable" from "what's per-instantiation" keeps a plugin-shipped template safe to reuse everywhere, and keeps the per-project record safe to commit.

## Template — `skills/{skill}/routine-template.yml`

Ships with the plugin. Plugin-owned, project-agnostic, account-agnostic. NEVER contains `environment_id`, a repo URL, or MCP credentials.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `template_version` | integer | yes | Bumped whenever this file's fields change. Instantiated records capture the version they were created from; `/claude-tweaks:routine status` compares the template's current version against the recorded version to detect drift. Narrowed meaning since the kernel split: bumped when *this template's own fields* change; kernel edits bump `kernel_version` instead. |
| `routine_name` | string | yes | Base name declared by the template (e.g. `code-health-daily`). At creation time, `/claude-tweaks:routine` prefixes this with a slug derived from the project's repo name (e.g. `claude-tweaks-code-health-daily`) before using it as the live routine's `name` field and the instantiated record's filename (`.claude-tweaks/routines/{prefixed-name}.yml`) — this prevents the common case of the same skill's routine colliding across every project it's instantiated in. Prefixing narrows but does not eliminate collisions (two projects with the same repo name, or repos under different orgs sharing a name, still collide) — `routine_id` remains the actual identity anchor when inspecting live routines. |
| `kickoff` | string | yes | The target-skill invocation the assembled kernel's closing line carries — whitespace-delimited tokens, the first of which must equal the owning skill's directory name (e.g. `code-health`), the rest passing through verbatim (`key=value` or flag tokens; values containing spaces unsupported — the same constraint the `focus` grammar already carries). Instantiation splices it into the kernel's `Then: /claude-tweaks:routine-kickoff {kickoff}` line; `skills/routine/fleet.md`'s per-vertical rows append `focus=<value>` to it with a single space. |
| `branch` | string | no | An explicit target branch for the kernel's `{{TARGET_BRANCH}}` placeholder. **Normally unset in a plugin-shipped template** — which branch a routine should audit is a property of the project, not of the plugin, so `/claude-tweaks:routine` resolves it per project (CREATE Step 5.5's precedence list) and this field is only the pin that outranks everything below an explicit `--branch`. Set it only in a template vendored alongside exactly one project. Unset *and* unresolvable → the placeholder falls back to the pre-`branch` wording, preserving the behavior every template had before this field existed. |
| `focus` | string | no | Names a focus vertical (e.g. `dead-code`) this instantiated routine should scope to, via the target skill's `focus=<vertical>` grammar (see `skills/code-health/focus-mode.md`). When set, instantiation appends `focus=<value>` to the template's `kickoff` value, producing `Then: /claude-tweaks:routine-kickoff {skill} focus=<value>` instead of the bare kickoff. **Unset in every plugin-shipped template file** — per-vertical instantiation is live via `/claude-tweaks:routine fleet on` (`skills/routine/fleet.md`'s composition-table Vertical finder rows instantiate code-health's template once per vertical, appending `focus=<value>` at instantiation time per this field's contract), but the committed template files themselves stay generalist: `focus` is supplied at fleet-provisioning time, never baked into a shipped template. |
| `model` | string | yes | Default model for the routine's session (e.g. `claude-sonnet-5-5`). |
| `allowed_tools` | array of strings | yes | Tool allowlist for the cloud session, e.g. `[Bash, Read, Grep, Glob]`. |
| `mcp_connections` | array of strings | no | Connector names this routine needs, if any. Each entry is a plain name string here — actual `connector_uuid`/`url` values are account-specific and resolved at instantiation time, never stored in the template. |
| `default_schedule.cron_expression` | string | yes | A UTC cron anchor (5-field, `RemoteTrigger` requires UTC, 1-hour minimum interval). This is a starting suggestion, not a guarantee it lands off-peak for whoever instantiates it — the creation flow always re-confirms against the creator's own timezone. |
| `default_schedule.description` | string | yes | Human-readable intent (e.g. "off-peak anchor, UTC — confirm against your local timezone at creation time"). |
| `notes` | string | no | Free-text guidance for whoever instantiates this (budget flags, tuning advice, links to the owning skill's own docs). |

## Standard prompt kernel

Every live routine's prompt is assembled at instantiation from the canonical kernel below: `{{TARGET_BRANCH}}` substituted per the table in the next section, and `{kickoff}` on the closing line replaced with the template's `kickoff` value. Templates carry no prompt text of their own — the firing lifecycle beyond the kernel (stale-docs guard, plugin-list dump, reconcile, target invocation and its exclusions) lives in `skills/routine-kickoff/SKILL.md` and updates with each plugin release instead of being frozen into every live prompt.

kernel_version: 1

The line above is the kernel's own version, machine-greppable via `grep -m1 '^kernel_version:' "${CLAUDE_PLUGIN_ROOT}/skills/_shared/routine-template-schema.md"` (this file is markdown; `bin/lib/routine-template-parser.js` stays uninvolved). `${CLAUDE_PLUGIN_ROOT}` is a model-resolved placeholder, not a shell contract — see `docs/skill-authoring.md`'s Plugin-root references section. **Any edit to the kernel block text below requires `kernel_version` += 1.** Enforcement is review discipline — the schema test asserts the field is a positive integer, never that it incremented; the structural mitigation is that the kernel is one file, so a bump is one edit, not seven. `template_version` now means only "this template's own fields changed."

```
Before anything else, fetch origin and confirm this checkout is on {{TARGET_BRANCH}}
and at its tip. If the container started on a different branch, check the target
branch out first (`git checkout <branch>`, creating it from `origin/<branch>` if it
isn't local yet). If it's merely behind, fast-forward via `git merge --ff-only` —
never `git reset --hard`. If it has diverged rather than just fallen behind, stop
and report that instead of proceeding on unverified state.

Before the kickoff below, print exactly one line recording which plugin build this
session resolved AND which path resolved it. Try in order, stopping at the first
that yields a readable `.claude-plugin/plugin.json`: (1) `env` —
`${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`, if that variable is set and
non-empty (it is routinely empty in a cloud Routine sandbox — never assume it).
(2) `hook-path` — the plugin root embedded in the claude-tweaks SessionStart hook's
own `node "<path>/bin/hooks.js"` line, when present in this session's context
(often absent; that is normal, not an error). (3) `cache-scan` — glob
`~/.claude/plugins/cache/*/claude-tweaks/*/.claude-plugin/plugin.json`; exactly one
match reports as `cache-scan-unique`; two or more means the highest-semver
directory is a GUESS — report it as `cache-scan-highest-of-N`, N being the
candidate count, never as a confirmed answer. (4) If nothing resolves, say
`claude-tweaks version unresolved (no CLAUDE_PLUGIN_ROOT, no hook path, no plugin
cache found)` and carry on. Format: `claude-tweaks v{version} @ {path} (resolved
via: {env | hook-path | cache-scan-unique | cache-scan-highest-of-N})`. Never
report a version without its resolution path. Diagnostic only — never a gate,
never a reason to stop.

If all four rungs came up empty (`unresolved`), the plugin cache is genuinely
empty — do not attempt the kickoff yet. Read `$HOME/claude-cloud-setup.log` (via
`tail -5 "$HOME/claude-cloud-setup.log"` or equivalent — shell expansion, not a
literal path) and print exactly one line: `claude-cloud-setup.log: absent — the
environment Setup script left no trace in this container (not executed, or its
write failed)` or `claude-cloud-setup.log: present — tail: {last 5 lines}`. Then
run `bash scripts/claude-cloud-setup.sh` to self-heal, and re-run the
resolved-build line once before proceeding to the kickoff.

If, after a successful self-heal, invoking /claude-tweaks:routine-kickoff via the
Skill tool still fails with an unknown- or unrecognized-skill error, read
`<plugin-root>/skills/routine-kickoff/SKILL.md` — the plugin root resolved above —
and follow its instructions directly as written.

Then: /claude-tweaks:routine-kickoff {kickoff}
```

`--ff-only` (not `git reset --hard`) deliberately keeps this compatible with `_shared/git-discipline.md`'s NEVER-`git reset` rule — a fresh routine firing hasn't made any commits of its own yet, so nothing is lost by refusing to proceed on a genuine divergence instead of forcing past it.

### `{{TARGET_BRANCH}}` — substituted at instantiation, never sent literally

`{{TARGET_BRANCH}}` is the kernel's only placeholder besides `{kickoff}`. The kernel ships it unsubstituted because the branch a routine should audit is a property of the project, not of the plugin. `/claude-tweaks:routine` resolves it per project (CREATE Step 5.5) and substitutes it into the `message.content` it hands to `RemoteTrigger`, so a live routine never contains the literal placeholder:

| Resolution outcome | Text substituted for `{{TARGET_BRANCH}}` |
|---|---|
| A branch resolved (say `dev`) | `` `dev` `` — the branch name, in backticks |
| Nothing resolved | ``the target branch (resolve it from `git remote show origin`'s HEAD branch line if not already obvious)`` |

The unresolved substitution reproduces this kernel's pre-`branch` wording, so a project where nothing resolves keeps exactly the behavior it had before the field existed.

**Why the placeholder exists.** That unresolved wording is only correct when a repo's active development branch *is* its GitHub default branch. On a `dev` → `staging` → `main` model where `main` is the default, every firing audited `main`: on one reported repo a tree 102 commits behind the active branch **and 51 ahead of it** — divergent, not merely stale, because urgent fixes are cherry-picked straight onto it. Findings were judged against a tree matching neither branch's current state, and fixes already merged to the active branch were re-reported as live problems on every firing, with nothing in the report indicating why (#132, confirming for all four health engines what #61 could only show for `/dispatch`). Naming the branch is only half the fix — the "check the target branch out first" sentence is the other half, since a container that starts on the wrong branch previously had no instruction to leave it.

Copying an assembled prompt by hand — into `/schedule`, or into the claude.ai routine editor — means substituting `{{TARGET_BRANCH}}` by hand too. A live routine whose prompt still shows the literal placeholder was provisioned without substitution; re-sync it per "Re-provisioning" below.

### Resolved-build line

`${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` is the only authoritative answer to "which build is this session running" — it is the directory the running skill files were loaded from, so it cannot disagree with them the way an installation record can. Three nearby surfaces are **not** substitutes:

- `claude plugin list --json`'s `version` and `installed_plugins.json` are installation *metadata*, written beside the cache directory rather than read out of it.
- `installed_plugins.json`'s `gitCommitSha` records the original **install** and is not refreshed by `claude plugin update` (confirmed live: a cross-version 6.23.7 → 6.38.1 update left the pre-update sha in place), so it can name a commit the installed files were never at.
- A successful `claude plugin update` proves nothing about content — it compares the installed version string against the *local* marketplace catalog and stops there. See `skills/init/bootstrap/step-14-cloud-routine-parity.md`'s Setup-script verify step for what that means for a sandbox, and why the generated script re-checks instead of trusting it.

Changing the kernel does not reach routines that already exist — a `RemoteTrigger`'s prompt is a frozen copy taken at creation time. Existing routines pick it up only via `/claude-tweaks:routine update {skill}`.

## Instantiated record — `.claude-tweaks/routines/{prefixed-name}.yml`

Written per-project, after a successful `RemoteTrigger create` or `update`. Project-owned. Safe to commit — deliberately excludes anything account-specific.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `routine_id` | string | yes | The trigger/routine ID from `RemoteTrigger`'s create response. Source of truth for subsequent `update`/`get`/`run` calls — never re-derive or guess this. |
| `template` | string | yes | Which skill's template this came from (matches the directory under `skills/`). |
| `template_version` | integer | yes | The template's `template_version` at the time this record was written. Compared against the template's current value to detect drift. |
| `kernel_version` | integer | yes (on new writes) | The schema's `kernel_version` at assembly time (read via the documented grep). A record without it reads as kernel-stale. Significant for `skills/routine/record-freshness.md`'s comparison — unlike `created_at`. |
| `model` | string | yes | The template's `model` value at the time this record was last written (create or update). A significant field for `skills/routine/record-freshness.md`'s comparison, so a copy naming a different model than the integration branch's is reported as drift. |
| `created_at` | string | yes | ISO 8601 UTC timestamp of creation (or last update). |
| `cadence` | string | no | `recurring` \| `once`. Always written explicitly on a new write (create or update) — never inferred later from which of `schedule`/`run_once_at` happens to be present. **Absent reads as `recurring`** — every record written before this field existed is a recurring cron routine, so this is the only reading that keeps existing CREATE/UPDATE behavior unchanged (`skills/routine/schedule-resolution.md`'s 5b cadence-class question). |
| `schedule` | string | required when `cadence` is `recurring` (or absent); omitted when `cadence` is `once` | The `cron_expression` actually chosen at instantiation (may differ from the template's `default_schedule`). |
| `run_once_at` | string | required when `cadence` is `once`; omitted otherwise | ISO 8601 UTC timestamp for a single, absolute-time firing, after which `RemoteTrigger` auto-disables the routine (the web UI marks it "Ran"). Mutually exclusive with `schedule` on this record, mirroring `cron_expression`/`run_once_at`'s mutual exclusivity on the `RemoteTrigger create`/`update` wire body (`skills/routine/create-and-update.md` Step 6) — never write both fields to the same record. A one-off firing still creates live, billed infrastructure with no delete API (`RemoteTrigger` has none) even though it self-disables after firing; "auto-disables" is not "gets cleaned up." One-off firings do not count against the account's daily routine-run cap, unlike recurring ones. |
| `console_url` | string | yes | The claude.ai routine URL from the create/update response. |
| `branch` | string | no | The branch actually substituted into this routine's live prompt. Omitted entirely when nothing resolved (the routine runs the fallback wording). `update` reuses this value as its default, so a re-sync can't silently re-point an existing routine at a different branch just because the session happens to be on one. A branch name is project-scoped, not account-scoped, so it is safe to commit — unlike the values the paragraph below bans. |
| `webhook_triggers` | array of objects | no | GitHub-event triggers attached to this routine via `RemoteTrigger {action: "create_webhook_trigger"}` (`skills/routine/webhook-trigger.md`'s WEBHOOK-TRIGGER mode). Each entry: `{webhook_trigger_id, events, filter, created_at}` — `webhook_trigger_id` is the trigger ID from the `create_webhook_trigger` response (source of truth for future reference; never re-derive or guess it); `events` is the array of GitHub event names the trigger matches; `filter` is the filter grammar's structured shape as sent on the wire (field/operator/value tuples — stored opaquely, never re-interpreted by this schema); `created_at` is an ISO 8601 UTC timestamp. Absent or empty array means the routine fires on its schedule only. Multiple entries are supported — a routine can have more than one GitHub-event trigger attached. |

A record is distinguishable as one-off or recurring by this structural shape (`cadence` plus which of `schedule`/`run_once_at` is present) — never by parsing the contents of a single overloaded field. A reader that finds no `cadence` field and no `run_once_at` field treats the record as `recurring` unconditionally, the same as it always has.

A record's `webhook_triggers` array is independent of `cadence`/`schedule`/`run_once_at` — a routine can be schedule-only, event-only-in-addition-to-its-schedule, or (after a future pause of its cadence) event-triggered exclusively. This schema does not currently support a schedule-less routine at creation time; `create_webhook_trigger` always attaches to a routine that already has a cadence from CREATE.

**Never write to this record:** `environment_id`, MCP connector credentials, or any other account secret. If a future need arises to reference the environment, store only a human-readable label the user chose, never the raw ID.

## Re-provisioning after a template change

A live routine carries a *copy* of the prompt assembled from the kernel and the template's `kickoff`, frozen when it was created. Editing either the kernel or a template here never reaches a routine that is already running — the fix looks landed while every firing keeps executing the old text. Closing that gap takes one of:

| Situation | What to run |
|---|---|
| The project has an instantiated record (`.claude-tweaks/routines/*.yml`) | `/claude-tweaks:routine update <skill>` — re-assembles the body from the current kernel and template and calls `RemoteTrigger update` on the recorded `routine_id`, replacing the live prompt in place. The routine keeps its ID, its schedule, and its console URL. |
| Several routines in one project | `/claude-tweaks:routine status --all` first — it names every record whose `template_version` or `kernel_version` is behind — then `update` each row it reports as **Drifted**. `/claude-tweaks:init`'s Update Mode already runs both in sequence. |
| The routine was created outside this skill, so no record exists | Nothing here can find it: source (b)'s `RemoteTrigger list` is unpaginated, and a hand-made routine populates no repo URL to match on anyway. Edit its prompt directly at claude.ai/code/routines, or delete it there and run `/claude-tweaks:routine create <skill>`. |

Two versions make this discoverable, and they track different drift. A template-field edit bumps `template_version`; a kernel edit bumps `kernel_version`. STATUS compares each recorded version against its current counterpart and reports the two staleness kinds distinctly — "kernel stale" versus template-field drift — inside the same **Drifted** verdict, so a reader can tell whether the fix that hasn't reached a live routine is in the kernel or in that skill's own template fields. Either way the remedy is the same one command: `/claude-tweaks:routine update {skill}`. A template edit that skips its bump, or a kernel edit that skips its bump, leaves every existing routine running the old prompt with nothing reporting it.

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Putting `environment_id` or a repo URL in a `routine-template.yml` | Templates ship with the plugin across every project and account. A baked-in environment or repo makes the template wrong everywhere except the one place it was authored. |
| Storing resolved `connector_uuid` or `url` values in a template's `mcp_connections` | Templates ship with the plugin across every project and account. A resolved connector value is account-specific and won't exist for anyone else. |
| Skipping `template_version` bumps when editing a template | `/claude-tweaks:routine status` relies on version comparison to detect drift — an unbumped version hides real changes, and a kernel edit that skips the `kernel_version` bump leaves every routine kernel-stale with nothing reporting it. |
| Storing `environment_id` in the instantiated record "for convenience" | The record is meant to be safe to commit; account-scoped identifiers don't belong in a project repo. |
| Storing MCP connector credentials in the instantiated record | The record is meant to be safe to commit — account-scoped credentials don't belong in a project repo. |
| Claiming a template's routine runs safely unattended without checking the target skill's actual auto-mode behavior | A bare routine firing has zero conversation history and no CLI arg to signal `auto` mode — per `_shared/auto-mode-card.md`'s precedence, a skill with no mode signal falls back to interactive and blocks forever on a prompt nobody answers. If a consumer skill needs `auto` mode to run unattended safely, its `notes` field (and the skill's own Routine Configuration section) must say so explicitly — don't invent new routine-specific mode-signaling to paper over it. |
| Hardcoding a project's development branch into a plugin-shipped `routine-template.yml`'s `branch` field | Same reason `environment_id` and repo URLs are banned from templates — one file ships to every project and account. `dev` is right for the repo it was authored against and wrong for the next one, and it silently outranks that project's own `integration-branch` policy. Leave `branch` unset and let `/claude-tweaks:routine` resolve it per project. |
| Sending a prompt with `{{TARGET_BRANCH}}` still in it | The placeholder is instantiation-time only. A live routine containing it tells the cloud agent to check out a branch literally named `{{TARGET_BRANCH}}`, which matches nothing — so the firing proceeds on whatever the container happened to check out, which is precisely the failure the placeholder exists to prevent. |
| Sending a prompt with `{kickoff}` still in it | The splice is assembly-time only — a live routine containing it fires `Then: /claude-tweaks:routine-kickoff {kickoff}` on every schedule tick, an invocation of nothing, with no target skill ever running. |
| Hand-provisioning a routine without the kernel | Observed in production: a CCR container started from a checkout up to a week stale. The assembled kernel is the cheap, self-contained mitigation; every live routine's prompt must open with it — assemble via `/claude-tweaks:routine`, never paste a bare kickoff into the console. |
| Granting `Edit` (or any write tool) in a template whose owning skill's `SKILL.md` documents a report-only contract | The tool allowlist is the actual enforcement boundary — a stale write grant left over from an earlier design can silently contradict the skill's own current Anti-Patterns table with no test or lint catching the mismatch. Keep the two in sync whenever either changes. |

## See also

- `skills/routine/SKILL.md` — the skill that reads templates and writes instantiated records
- `skills/code-health/routine-template.yml` — the reference template implementation (no auto-mode prerequisite — code-health has no interactive gate)
- `skills/tidy/routine-template.yml` — a template whose unattended safety genuinely depends on the target project's `auto-mode: default-on` already being set
