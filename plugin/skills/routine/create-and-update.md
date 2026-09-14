# Routine — CREATE and UPDATE

Loaded by `/claude-tweaks:routine`'s Workflow dispatch when the resolved mode is `create` or
`update`. The two modes share one file because UPDATE reuses several of CREATE's steps by name —
template load (Step 1), repo URL + `PREFIXED_NAME` derivation (Step 2), environment resolution
(Step 4), body assembly (Step 6), and Step 7's review-gate standard — so splitting them would make
an `update` run read CREATE's file anyway. `status` needs none of this and reads `status.md`
instead.

Step numbering matches `SKILL.md`'s pre-split numbering exactly, so existing cross-references from
other skills (`/claude-tweaks:init`'s Step 15 and Update Mode, `_shared/routine-diagnostic-probe.md`,
`guided-environment-creation.md`) keep pointing at the right step. Step 5's own sub-steps live in
`schedule-resolution.md` in this skill's directory.

---

## CREATE `<skill>`

**Step 0 — Worktree check (only when `.claude-tweaks/policy.yml` sets `worktree-always: true`).** This skill writes twice — Step 4's environment cache and Step 9's instantiated record — and this project's PreToolUse hook denies any `Write` issued from a non-isolated checkout under that policy, with no bookkeeping exemption; `/claude-tweaks:routine` has no pipeline orchestrator upstream to have already set one up, so nothing protects this invocation by default. Before proceeding: run `_shared/worktree-setup.md`'s "Adopt-or-create" gate — already isolated (with a clean tree) adopts the current worktree; otherwise set one up first via `/superpowers:using-git-worktrees` or `EnterWorktree`, branched from current HEAD. Either way, run the rest of this workflow, including Steps 4 and 9's writes, from inside the resulting worktree. `.claude-tweaks/routines/{PREFIXED_NAME}.yml` is meant to be committed (it's a versioned project artifact), so commit it inside the worktree as usual, then merge the branch back into the main checkout (`git merge --ff-only`) before reporting the console URL to the user — the record isn't durably part of the project until that merge lands. `.claude-tweaks/routine-environment-cache.yml` is gitignored and project-local; writing it inside the worktree is fine — it exists only to spare a second skill invocation in the same checkout from re-deriving the value. If `worktree-always` isn't set, skip this step and proceed directly to Step 1.

**Step 1 — Load the template.** Read `${CLAUDE_PLUGIN_ROOT}/skills/{skill}/routine-template.yml`; if it doesn't exist, stop: "`{skill}` has no routine-template.yml — it doesn't support routines yet." The field schema is documented once in `skills/_shared/routine-template-schema.md` — canonical for both this template and the instantiated record Step 9 writes from it, so read it there rather than inferring a field's meaning.

**Step 2 — Resolve the repo URL and derive the project-prefixed name.**

```bash
git remote get-url origin
```

Normalize to full HTTPS the same way `/schedule` does: accept `org/repo`, `git@github.com:org/repo.git`, or `https://github.com/org/repo` and produce `https://github.com/{org}/{repo}` (strip any `.git` suffix, convert the SSH form). If the command fails (no `origin` remote, not a git repo, etc.), stop and ask the user for the repo URL directly instead of proceeding with an empty or invalid value.

Derive `REPO_SLUG` from the resolved URL's `{repo}` segment: lowercase it, replace any run of characters outside `[a-z0-9]` with a single `-`, and trim leading/trailing `-`. Set `PREFIXED_NAME = "{REPO_SLUG}-{template.routine_name}"` (e.g. repo `claude-tweaks` + `routine_name: code-health-daily` → `claude-tweaks-code-health-daily`). Use `PREFIXED_NAME` everywhere the rest of this workflow refers to the routine's name or the record's filename — never the template's bare `routine_name` alone.

**Step 3 — Idempotency check.** Does a record for `{PREFIXED_NAME}` already exist for this project? Answer it against the **union** of the working checkout and the branch this project commits records to — not the working checkout alone. Run `record-freshness.md` in this skill's directory (Steps F1-F2) and read the entry for `{PREFIXED_NAME}.yml`, then apply its Step F3 CREATE disposition:

- `presence: both` or `local-only` → a record exists: stop this workflow and continue at UPDATE below, exactly as before.
- `presence: upstream-only` → **STOP** with F3's BLOCKED message. The record is committed on the integration branch and merely absent from this checkout; creating now mints a second live routine for the same project+skill, and `RemoteTrigger` has no delete counterpart to undo it (#190).
- No entry on either side → no record exists: proceed to Step 4.
- `verified: false` (offline, no remote, no such ref, no branch resolved) → fall back to the working-checkout-only existence check exactly as this step behaved before, and print `freshnessNote` once. Never stop on an unverified comparison.

Never create a second routine for the same project+skill combination.

**Step 4 — Resolve `environment_id`, or defer to guided creation.** If `--environment <id>` was passed, use it directly — skip every other source below, including the guided-creation branch (an explicit `--environment` always wins). Otherwise, if `--refresh-environment` was passed, skip the cache and both `RemoteTrigger`-backed sources too — source (a) and source (b) below — go straight to asking the user directly which environment to use (the same direct-user-input prompt Step 8's guided-flow-unavailable fallback uses below), then continue to the cache-write step below with the freshly chosen value, overwriting whatever the cache file already held. Otherwise: check `.claude-tweaks/routine-environment-cache.yml` in the current project first. If it exists and contains an `environment_id` value, use it silently — no confirmation prompt. Otherwise, try two complementary sources, in this order, and use whichever yields a value first:

(a) **Project-local records.** If `.claude-tweaks/routines/*.yml` exist for this project, call `RemoteTrigger {action: "get", trigger_id: <record.routine_id>}` for each (most-recently-created record first, stop at the first successful `get`) and read `job_config.ccr.environment_id` off it. This source is the *only* one that finds a routine created via `skills/routine/guided-environment-creation.md`'s Create procedure — those routines never populate `session_context.sources[].git_repository.url` at all (confirmed live — see that file's own Create procedure step 7), so source (b) below cannot see them regardless of pagination. Skip (don't stop on) a record whose `get` call fails — that routine was deleted out-of-band; this is a read-only resolution step, it does not offer to clean up the stale record the way STATUS does.

(b) **Account-wide `list` + repo-URL filter**, if (a) found nothing (no instantiated records yet, or all of them stale): load the tool with `ToolSearch select:RemoteTrigger`, then call `{action: "list"}`. Reuse the repo URL Step 2 already resolved above — do not re-derive it (same "already resolved, don't re-derive" precedent UPDATE Step 3 follows for the same value). Filter the returned triggers to those whose `job_config.ccr.session_context.sources[].git_repository.url` matches this project's own resolved repo URL — never a routine belonging to a different project, even if it was created more recently. If one or more match, read `job_config.ccr.environment_id` off the most recently created match and use it silently. **Known limitation, confirmed live:** `{action: "list"}` returns only its first page — the tool exposes no cursor/pagination parameter — so on an account with enough triggers to paginate (`has_more: true` in the response), a match belonging to this project could sit on a later page and go undetected. Source (a) above already covers every routine this plugin created (regardless of pagination); this residual gap only affects a routine this project's `.claude-tweaks/routines/` never recorded — e.g. one created by hand outside `/claude-tweaks:routine` entirely. No workaround exists at the skill-prose level for that remaining case; it is a genuine `RemoteTrigger` tool constraint.

If none of the sources above (cache, then source (a), then source (b)) yields a value for *this project specifically*, this routine's creation must go through `skills/routine/guided-environment-creation.md`'s Create procedure — it creates a dedicated environment **and** this routine together in one continuous browser session (it has no separate throwaway-routine step; see that file's own header for why, and its own Anti-Patterns-documented no-delete-API constraint on `RemoteTrigger`). Do not invoke it yet: set `NEEDS_GUIDED_CREATION = true` and continue to Step 5 — the guided flow needs the resolved schedule before it can run, so it is invoked from Step 8 below, once every field it needs is in hand. Skip the cache-write step immediately below in this case; Step 8 performs the equivalent write itself, once it actually has an `environment_id` to record.

After an environment is resolved (from `--environment`, the cache, source (a), source (b), or direct user input — never when `NEEDS_GUIDED_CREATION` is set), write it to `.claude-tweaks/routine-environment-cache.yml` (skip this write if `--dry-run` was passed):

```yaml
environment_id: "<resolved environment_id>"
environment_name: "<human-readable environment name, if known — omit this key entirely when unknown>"
```

`environment_name` is only ever known when the guided-creation flow (`skills/routine/guided-environment-creation.md`) resolved or confirmed it via a real browser read — no API exposes an environment's display name, only its opaque ID. Omit the key entirely (do not write an empty string) when resolution came from `--environment`, the cache's own prior `environment_id`-only value, source (a), source (b), or direct user input, none of which can supply a name. This file is project-local and must stay gitignored — it exists purely to spare a second skill in the same project from re-deriving the same environment, never to make the value portable across projects or accounts.

**Step 5 — Resolve the schedule.**

On the default forward path — reached before any Customize selection, whether or not `--defaults` was passed — skip the interactive picker entirely: use the template's `default_schedule.cron_expression` verbatim as the resolved cron. Still run 5a's classification to produce the human-readable form Step 7's preview needs (e.g. "Daily, 03:00 UTC"). The picker itself (5b-5d) is reached only when Step 7's Customize branch is selected — never on the default forward path, regardless of `--defaults`.

Read `schedule-resolution.md` in this skill's directory for 5a-5d — the cron-to-cadence classification table (5a, needed on every path through this step) and the interactive cadence picker (5b-5d, reached only via Step 7's Customize branch here, or directly from UPDATE Step 3). The default forward path always resolves a recurring cron (a template's `default_schedule` has no one-off form); the Customize branch's picker is where a one-off (`run_once_at`) cadence can be chosen instead, via 5b-i.

**Step 5.5 — Resolve the target branch.** The kernel (`_shared/routine-template-schema.md`'s `## Standard prompt kernel`) carries one branch placeholder, `{{TARGET_BRANCH}}`, which Step 6 substitutes before any `RemoteTrigger` call ever sees it. Resolve `INTEGRATION_BRANCH` per `skills/_shared/integration-branch.md`'s Resolution ladder — its rank 2 (`template.branch`) and the `--branch` argument at rank 1 are this skill's own inputs, and its Per-consumer fallback table gives this skill's rank-6 behavior. Do not restate the ladder here.

Keep track of which source won: Step 7's preview names it, and Step 9 writes the resolved value into the instantiated record.

**Step 6 — Assemble the `RemoteTrigger create` body.** Build this body whenever a `RemoteTrigger create` call will actually happen. Compute `RESOLVED_PROMPT` (the substitution table below) **unconditionally**, before the skip that follows: it depends only on Step 5.5's branch, never on `environment_id`, and Step 8's guided path consumes it whether or not a body was ever assembled. If `NEEDS_GUIDED_CREATION` is set, skip the rest of this step for now — there's no `environment_id` yet to put in a body, and the guided flow doesn't need this body at all as long as it stays on the guided path. Two places later can still need it, once an `environment_id` exists: Step 7's Customize branch, if the user overrides guided-creation with a named existing environment (clearing `NEEDS_GUIDED_CREATION`); and Step 8's guided-flow-unavailable fallback, once it resolves an environment directly. Both are pointed back to this step's body template — assemble it there, at that point, using the environment_id just resolved, before proceeding to Step 8's non-guided `RemoteTrigger create` call. Otherwise (the common case, `NEEDS_GUIDED_CREATION` not set here), assemble it now:

`cron_expression` and `run_once_at` are **mutually exclusive** top-level fields on this body — send exactly one, never both, per Step 5's resolved cadence (`_shared/routine-diagnostic-probe.md` confirms this live against the actual `RemoteTrigger` API). A recurring cadence (the default forward path, or 5b-i's Recurring branch) sends `cron_expression` exactly as before; a one-off cadence (5b-i's One-off branch) sends `run_once_at` — the ISO 8601 UTC timestamp 5c-once collected — in its place, omitting `cron_expression` entirely:

```json
{
  "name": "<PREFIXED_NAME>",
  "cron_expression": "<resolved cron, UTC — omit this field entirely and send run_once_at instead when the resolved cadence is one-off>",
  "notifications": {"channel": {"email": true, "push": false, "slack": false}},
  "job_config": {
    "ccr": {
      "environment_id": "<resolved environment_id>",
      "session_context": {
        "model": "<template.model>",
        "sources": [{"git_repository": {"url": "<resolved repo URL>"}}],
        "allowed_tools": <template.allowed_tools, verbatim — this is already an array, e.g. ["Bash", "Read", "Grep", "Glob"], do not add another layer of brackets>
      },
      "events": [{"data": {
        "uuid": "<fresh lowercase v4 UUID, generated now>",
        "session_id": "",
        "type": "user",
        "parent_tool_use_id": null,
        "message": {"content": "<RESOLVED_PROMPT — see below>", "role": "user"}
      }}]
    }
  }
}
```

`RESOLVED_PROMPT` is the schema's canonical kernel block (`skills/_shared/routine-template-schema.md`'s `## Standard prompt kernel`) with its single `{{TARGET_BRANCH}}` placeholder replaced, using Step 5.5's result (see `skills/_shared/integration-branch.md`'s Per-consumer fallback table for why the unresolved row reads as it does), and `{kickoff}` on the closing line replaced with `template.kickoff` — producing `Then: /claude-tweaks:routine-kickoff {template.kickoff}`:

| Step 5.5 outcome | Replace `{{TARGET_BRANCH}}` with |
|---|---|
| A branch resolved | the branch name wrapped in backticks — e.g. `` `dev` `` |
| Nothing resolved | ``the target branch (resolve it from `git remote show origin`'s HEAD branch line if not already obvious)`` |

Substitute before assembling the body, never after — every downstream consumer (this body, Step 8's guided-creation `instructions`) reads `RESOLVED_PROMPT`, and a literal `{{TARGET_BRANCH}}` reaching a live routine means the firing tries to check out a branch by that name, matches nothing, and proceeds on whatever the container started with. Step 9's record captures `kernel_version` (read via the documented grep), not the prompt text itself. Verify no `{{` and no literal `{kickoff}` remains in the assembled content before calling `RemoteTrigger`.

If `template.mcp_connections` is non-empty, add a top-level `mcp_connections` array with `{connector_uuid, name, url}` entries (same shape `/schedule` uses) — warn the user if a named connector isn't currently connected, and direct them to https://claude.ai/customize/connectors.

`notifications` is set unconditionally on every routine this skill creates — a top-level field, sibling of `cron_expression`. It's the only outside-session signal that a no-op firing actually ran, rather than hanging or crashing silently (#68).

**Step 7 — Preview and confirm.** Render the resolved schedule (human-readable, e.g. "Nightly at 03:00 UTC" for a recurring cadence, or "Fires once at 2026-09-15T07:00 UTC, then auto-disables — does not count against the daily routine-run cap" for a one-off cadence) as plain text, along with the template's `notes` field (if present) so the user sees any tuning guidance before confirming. Render the branch on its own line, naming which of Step 5.5's sources produced it — e.g. `branch: dev (from integration-branch in .claude-tweaks/policy.yml)`, or `branch: not pinned — each firing resolves the repo's GitHub default branch itself` when nothing resolved. When Step 5.5 discarded a worktree branch, say that too — `branch: main (the repo's GitHub default; this session's branch is an isolation worktree, not a real one)` — so the user can correct it if `main` isn't where development happens. When Step 5.5 reached source 5 outside a worktree and found the current branch differs from the GitHub default, say so on that line and name both: `branch: dev (this session's branch; the repo's GitHub default is main) — a routine audits the branch named here, so pick the one where development actually happens`. That comparison is the whole point of surfacing the branch at all; a preview that shows only the chosen value hides the one case worth reviewing. For the environment line: if `NEEDS_GUIDED_CREATION` is set, render "environment: will be created — `claude-tweaks: <REPO_SLUG>` (via a guided browser flow that creates the environment and this routine together, first time only for this project)"; otherwise render the resolved value as before (e.g. "environment `env-abc123` (cached)"). Render one further line stating the routine will send an email notification on every firing — success and no-op alike, per `notifications` above. This creates live, billed infrastructure with no delete API, so the preview must always be shown — regardless of how automated everything upstream was.

If `--dry-run` was passed: stop here — do not call `RemoteTrigger`, do not invoke the guided-creation flow, do not write an instantiated record. If `NEEDS_GUIDED_CREATION` is not set, print the assembled body (from Step 6). If `NEEDS_GUIDED_CREATION` is set, there is no assembled body to print (Step 6 skipped it) — instead print the same preview text Step 7 rendered above, plus a note that a real (non-dry-run) invocation would open a guided browser session to create both a dedicated `claude-tweaks: <REPO_SLUG>` environment and this routine together. (This check applies whether or not `--defaults` was also passed — `--dry-run` always wins.)

If `--defaults` was passed (and not `--dry-run`): skip the `AskUserQuestion` call below — proceed straight to Step 8. The preview above is still shown, as a report rather than a prompt.

Otherwise, call `AskUserQuestion` with `question`: `"Create this routine with these settings?"`, `header`: `"Confirm routine"`, `multiSelect`: `false`, and:
- Option 1 — `label`: `"Yes, create with defaults (Recommended)"`, `description`: `"Proceed with the settings shown above"`
- Option 2 — `label`: `"Customize schedule, branch, or environment"`, `description`: `"Change the cadence, time, target branch, or environment before creating"`
- Option 3 — `label`: `"Cancel"`, `description`: `"Do not create anything"`

Marking "Yes, create with defaults" as `(Recommended)` is a deliberate change from this step's earlier no-bias convention — acceptable because the full assembled preview is always shown as part of the same round-trip; the safety property (review before commit) is preserved, only the bias-avoidance styling is relaxed.

Selecting **Customize** re-asks environment (present the value resolved in Step 4 as the recommended option, still overridable — when `NEEDS_GUIDED_CREATION` is set instead, present "create a dedicated environment via guided browser flow" as the recommended option, still overridable to an existing environment the user names directly, which clears `NEEDS_GUIDED_CREATION` for the rest of this run) and *then* runs the cadence picker (5b-5d in `schedule-resolution.md`, reached for the first and only time here), producing a customized cadence — a recurring cron, or (5b-i's One-off branch) a `run_once_at` timestamp instead. Then, as a third sequential `AskUserQuestion`, re-ask the branch: present Step 5.5's resolved value as the recommended option, the GitHub default branch as a second option whenever source 5 found the two differ, and "don't pin a branch — let each firing resolve the default itself" as the option that maps back to Step 5.5's unresolved outcome. Skip this third ask entirely when Step 5.5 resolved from `--branch` or `template.branch` (both are already explicit statements of intent; re-asking them is noise). Only once the environment, the branch, and the cron are final, and only if `NEEDS_GUIDED_CREATION` is *not* set at that point (either it was never set, or the user's override just cleared it) — (re-)assemble Step 6's body using these final values, re-running Step 6's `{{TARGET_BRANCH}}` substitution against the branch just confirmed rather than reusing the string built from Step 5.5's proposal, and matching Step 6's own scoping (it never assembles a body while `NEEDS_GUIDED_CREATION` is set, since there's no `environment_id` yet). This still applies whenever the Customize path reaches it, whether or not `NEEDS_GUIDED_CREATION` was ever set to begin with, since the cadence picker can change the resolved cadence after Step 6's original assembly (if any) already ran. If `NEEDS_GUIDED_CREATION` is still set after the override (the user kept the guided-creation recommendation and only customized the cadence), there is still no body to assemble — the customized `cron_expression` (or `run_once_at`, on the One-off branch) carries forward to Step 8's guided-creation invocation instead, exactly as the non-Customize path already does, and so does the customized branch: Step 8 builds its `instructions` from `RESOLVED_PROMPT`, so re-run Step 6's substitution against the confirmed branch even on this no-body path, or the guided flow submits a routine pinned to the branch the user just overrode. Then re-render this same preview and confirm with the customized schedule/environment — but relabel Option 1 to `"Yes, create (Recommended)"` (dropping "with defaults," since the settings shown are no longer the template's defaults); Option 2 ("Customize...") and Option 3 ("Cancel") stay as before, so further adjustment remains possible. Selecting **Yes** (either the first "with defaults" render or a later customized re-render) or **Cancel** proceeds exactly as before — Step 8 (create) or stop.

**Step 8 — Create.**

If `NEEDS_GUIDED_CREATION` is set: invoke `skills/routine/guided-environment-creation.md`'s Create procedure with `project_slug = REPO_SLUG`, `repo_url` (Step 2's resolved value), `routine_name = PREFIXED_NAME`, exactly one of `cron_expression` or `run_once_at` (Step 5's resolved cadence — a recurring resolution passes `cron_expression`, a one-off resolution passes `run_once_at` instead), `instructions = RESOLVED_PROMPT` (Step 6's branch-substituted, kickoff-spliced kernel — never the raw kernel text, which still holds the `{{TARGET_BRANCH}}` and `{kickoff}` placeholders), and `connectors = template.mcp_connections` (omit if empty). On success, it returns `{trigger_id, console_url, environment_id, environment_name, connectors_pending}` — treat `trigger_id`/`console_url` exactly as the routine/trigger ID and claude.ai routine URL a normal `RemoteTrigger create` response would have given (Step 9 below reads from these either way), and additionally write `environment_id`/`environment_name` to `.claude-tweaks/routine-environment-cache.yml` now (this is the deferred cache-write Step 4 skipped). The guided flow's Create procedure never touches Step 6's JSON body, so it never sets `notifications` on its own. **Confirmed live (#1301):** a follow-up `RemoteTrigger {action: "update", ...}` call cannot set this field — `update`'s own parameter surface carries no `notifications` field at all (unlike `create`, where it is accepted and persists), and probing it live — an unsupported `notifications` value sent alongside a supported field in the same call — showed the supported field's change persisted while the unsupported `notifications` value was silently dropped, with no error surfaced either way. A follow-up `update` call here would therefore appear to succeed while doing nothing, which is worse than an honest failure. There is currently no confirmed mechanism to set `notifications` on a guided-created routine after creation. Do not issue that follow-up call. Instead, immediately after receiving `trigger_id` back, report to the user plainly that this routine was created without the email-on-every-firing notification (#68) enabled, and that they must turn it on manually at the routine's console URL (Edit routine → Notifications) if they want it. If the guided flow reports it's unavailable (no browser, or the user declined) rather than a mid-flow failure: fall back to asking the user directly which environment to use, presenting whatever names/IDs are available in context, then assemble Step 6's body now (it was skipped there since `NEEDS_GUIDED_CREATION` was set at the time, and already carries `notifications`) using this environment_id, write the cache, and proceed with the normal (non-guided) path below — no follow-up call needed here, since the body already carries the field. If the guided flow itself fails partway (a real browser-automation failure — UI structure changed, a click missed, environment created but routine submission failed), treat it like any other failed create below: report what succeeded/failed to the user and stop, do not proceed to Step 9.

Otherwise (environment already resolved in Step 4, `NEEDS_GUIDED_CREATION` not set): call `RemoteTrigger {action: "create", body: <assembled body>}`. Read the routine/trigger ID and the claude.ai routine URL from the response (the tool appends a summary line with both). If the call fails (e.g. an invalid or stale `environment_id` silently reused from `.claude-tweaks/routine-environment-cache.yml`), report the error to the user, suggest re-running with `--refresh-environment` (or deleting `.claude-tweaks/routine-environment-cache.yml` directly) to force re-resolution, and stop — do not proceed to Step 9 or write an instantiated record for a failed create.

**Step 9 — Write the instantiated record.** Resolve `kernel_version` first: `grep -m1 '^kernel_version:' "${CLAUDE_PLUGIN_ROOT}/skills/_shared/routine-template-schema.md"` (`${CLAUDE_PLUGIN_ROOT}` is a model-resolved placeholder — see `docs/skill-authoring.md`'s Plugin-root references section). If that grep yields nothing (the schema file is unreadable — plugin install missing or mangled), STOP and surface it to the user rather than writing an empty `kernel_version` into the record. Otherwise write `.claude-tweaks/routines/{PREFIXED_NAME}.yml`:

```yaml
routine_id: "<the routine/trigger ID from Step 8 — RemoteTrigger's create response, or guided-creation's returned trigger_id>"
template: <skill>
template_version: <template.template_version>
kernel_version: <the schema's current kernel_version at assembly time, resolved above>
model: "<template.model>"
created_at: "<current UTC timestamp, ISO 8601>"
cadence: <recurring|once — the class resolved at Step 5 (5b-i on the Customize path; recurring on every default-forward-path create, since a template's default_schedule has no one-off form)>
schedule: "<resolved cron_expression — omit this key entirely when cadence is once>"
run_once_at: "<resolved run_once_at, ISO 8601 UTC — omit this key entirely when cadence is recurring>"
console_url: "<the routine URL from Step 8 — RemoteTrigger's create response, or guided-creation's returned console_url>"
branch: "<Step 5.5's resolved branch — omit this key entirely when nothing resolved>"
```

`schedule` and `run_once_at` are mutually exclusive — write exactly one, matching whichever field Step 6's `RemoteTrigger` body actually sent, never both. Omit `branch` rather than writing an empty string when Step 5.5 resolved nothing: an absent key and a pinned-to-nothing key mean different things to UPDATE's resolution and to STATUS's field-level drift check, and an empty string reads as the former while behaving like a pin to `""`. Same omission rule for `schedule`/`run_once_at`: the absent one is absent, never an empty string.

If `NEEDS_GUIDED_CREATION` was set and Step 8's guided flow returned a non-empty `connectors_pending` array, also tell the user which of those connector names still need adding manually, and where (Edit routine → Connectors tab).

Report the console URL to the user.

## UPDATE `<skill>`

**Step 0 — Worktree check.** Same as CREATE Step 0 — run it here too, since `update` is often invoked directly rather than routed from CREATE's idempotency check, and Step 7 below writes the instantiated record just as CREATE Step 9 does.

**Step 1.** Load the template the same way as CREATE Step 1 (if missing, stop with the same message). Resolve the repo URL and derive `PREFIXED_NAME` the same way as CREATE Step 2.

Then run `record-freshness.md` in this skill's directory (Steps F1-F2) and apply its Step F3 UPDATE disposition **before** the require-a-record check below — that ordering is load-bearing. On a stale checkout the record does exist, just not here, so the "run `create` first" message below is wrong and sends the user into CREATE Step 3's duplicate-minting path; F3's CREATE and UPDATE stops interlock to close that loop. Stop when the comparison is `verified` **and** this record's `authority` is `upstream` **and** either its `presence` is `upstream-only` or its `fields` list is non-empty: every remaining step writes (Step 6 issues a live `RemoteTrigger update`, Step 7 rewrites the record), and both would be assembled from the stale copy (#190). A behind checkout whose copy of *this* record is identical on both sides is not a stop — that is the common case after any unrelated commit. An unverified comparison is never a stop; print `freshnessNote` once and continue.

Where the comparison is verified and this record's `authority` is `upstream`, read the record from `upstream` for the rest of this workflow rather than from the working tree.

Require an existing record for the current project (routed here automatically from CREATE's idempotency check, or invoked directly). If none exists on either side, tell the user to run `create <skill>` first and stop.

**Step 2.** Compare the template's `template_version` (already read in Step 1) against the instantiated record's `template_version` — the authoritative copy Step 1 resolved, which on a behind checkout is the integration branch's, not the working tree's. Also compare the schema's current `kernel_version` (read via `grep -m1 '^kernel_version:' "${CLAUDE_PLUGIN_ROOT}/skills/_shared/routine-template-schema.md"` — `${CLAUDE_PLUGIN_ROOT}` is a model-resolved placeholder, not a shell contract; see `docs/skill-authoring.md`'s Plugin-root references section) against the record's own `kernel_version`. If that grep yields nothing (the schema file is unreadable — plugin install missing or mangled), STOP and surface it to the user rather than judging kernel sync off an unresolved current. "Already in sync" requires both to match — a kernel bump alone, with `template_version` unchanged, is still reason to proceed with the update. If both match and the user hasn't asked to change anything else, report "already in sync" and stop.

A matching version is not on its own sufficient to stop, because the branch can change with no template edit behind it. Run Step 3's branch resolution before deciding — it is greps plus local git, no network and no `RemoteTrigger` call — and treat either of these as "something else to change," continuing to Step 3 proper: an explicit `--branch`, or a resolved branch that differs from the record's `branch` field. Without this, a project that has already re-synced to the current template and *then* adds `integration-branch` to `policy.yml` gets "already in sync" and a live routine still auditing the wrong tree — the exact migration this field exists to enable.

**Step 3.** Re-resolve environment always. For environment, follow CREATE Step 4's non-guided procedure exactly: check `.claude-tweaks/routine-environment-cache.yml` first, then its source (a) (project-local records) and source (b) (repo-matched `RemoteTrigger list`) if the cache is empty — never the instantiated record itself, since the record schema deliberately never stores `environment_id` (see `skills/_shared/routine-template-schema.md`). This routine's own record is one of source (a)'s candidates like any other, so `RemoteTrigger get` on `record.routine_id` directly (skipping straight to reading its `environment_id`) is equally valid here and cheaper — either path reaches the same value. (Repo URL and `PREFIXED_NAME` were already resolved in Step 1 — do not re-derive them.)

If `--defaults` was passed: skip schedule re-resolution entirely — keep the existing record's cadence fields (`cadence` plus whichever of `schedule`/`run_once_at` it carries) verbatim, unchanged, for the rest of this workflow. No cadence picker runs, and `schedule-resolution.md` is never read.

Otherwise, re-resolve schedule too: follow CREATE Step 5's full cadence-picker procedure (5a-5d, in `schedule-resolution.md` in this skill's directory), but parse the existing record's own cadence for the 5a pre-selection instead of the template's `default_schedule.cron_expression`. When the record's `cadence` is `once`, 5a skips cron classification and passes `run_once_at` straight through as 5c-once's pre-fill (`schedule-resolution.md` 5a's own branch for this); otherwise pass the record's `schedule` field the same way CREATE does with the template's default — the record's own currently-active value is the more relevant "what's running today" starting point on an update than the template's shipped default, which may no longer match what this project actually instantiated.

Re-resolve the branch always, `--defaults` or not (unlike schedule, which `--defaults` freezes) — follow CREATE Step 5.5's precedence with one insertion: **the existing record's `branch` field sits between source 4 and source 5.** Explicit statements of intent (`--branch`, `template.branch`, `integration-branch` in `policy.yml`, a documented branching model) still outrank it, which is what makes the #132 migration work — add `integration-branch` to `policy.yml`, run `update`, and the live routine re-points. Git inference must not outrank it: without that insertion, running `update` from the default branch would silently re-point a routine already pinned to `dev` back to `main`, which is the original bug wearing an update's clothes. A record with no `branch` key at all (every record written before the field existed) inserts nothing and falls straight through to source 5. If the resolved branch differs from the record's, Step 4's diff must show it on its own line — it's the field most likely to change what a routine actually audits, and the least visible if it changes quietly.

**Step 4.** Assemble the body the same way as CREATE's body-assembly step (Step 6 above), then show a diff between the recorded config (cadence, schedule or run_once_at as applicable, template version, kernel_version, resolved values) and the freshly assembled one — a cadence-class change (recurring ↔ once) is itself a diff line, not just a value change within one field. If nothing changed, report that and stop.

**Step 5.** Review gate — same standard as CREATE's Step 7: show the diff (Step 4's output) always, regardless of `--defaults`.

If `--dry-run` was passed: show the diff and stop. Do not call `RemoteTrigger`. Do not rewrite the instantiated record. (This check applies whether or not `--defaults` was also passed — `--dry-run` always wins, same precedent as CREATE Step 7.)

If `--defaults` was passed (and not `--dry-run`): skip the `AskUserQuestion` call below — proceed straight to Step 6. The diff above is still shown, as a report rather than a prompt.

Otherwise, call `AskUserQuestion` with `question`: `"Update this routine?"`, `header`: `"Confirm routine"`, `multiSelect`: `false`, and:
- Option 1 — `label`: `"Yes, update (Recommended)"`, `description`: `"Proceed with the assembled RemoteTrigger body shown above"`
- Option 2 — `label`: `"Cancel"`, `description`: `"Do not update anything"`

Marking "Yes, update" as `(Recommended)` follows the same reasoning as CREATE Step 7's confirm — the diff is always shown before this call, so the safety property (review before commit) is preserved even with a marked default.

**Step 6.** Call `RemoteTrigger {action: "update", trigger_id: <record.routine_id>, body: <assembled body>}`. If this call fails because `record.routine_id` no longer refers to an existing routine (e.g. deleted out-of-band at claude.ai/code/routines), report the record as stale and offer the same recourse as STATUS Step 2 (`status.md` in this skill's directory): delete `.claude-tweaks/routines/{PREFIXED_NAME}.yml` and re-run `create <skill>` instead — do not proceed to Step 7 or rewrite the instantiated record for a failed update.

**Step 7.** Rewrite the instantiated record with the resolved cadence (`cadence` plus whichever of `schedule`/`run_once_at` applies — write exactly one of the two, per CREATE Step 9's same omission rule; a cadence-class change writes the new field and drops the old one entirely rather than leaving a stale value behind), the resolved `branch` (Step 3's value — omit the key entirely when nothing resolved, per CREATE Step 9), the new `template_version` and `model` (both resolved fresh from the current template, not preserved from the old record), the new `kernel_version` (resolved fresh from the schema at assembly time, via the documented grep — Step 2 already ran it once for the sync check; reuse that result rather than re-invoking it here, and if it was unresolved, Step 2 already stopped before reaching this step), and a fresh `created_at` timestamp (this field doubles as "last written at") — preserving `routine_id`, `template`, and `console_url` from the existing record.

## PAUSE `<skill>`

Unlike CREATE/UPDATE, PAUSE writes nothing locally — it makes one live `RemoteTrigger` call and nothing else, so Step 0's worktree check does not apply here.

**Step 1 — Resolve the record.** Load the template and resolve `PREFIXED_NAME` exactly as CREATE Steps 1-2 do. Then run `record-freshness.md` in this skill's directory (Steps F1-F2) and apply its Step F3 UPDATE disposition exactly as UPDATE Step 1 does — same stale-checkout stop condition, same "read from the `upstream` authority copy when applicable" rule. Require an existing record for the current project (routed here directly — there is no idempotency-check auto-route the way CREATE has one). If none exists on either side, tell the user to run `create <skill>` first and stop.

**Step 2 — Pause.** Call `RemoteTrigger {action: "update", trigger_id: <record.routine_id>, body: {"enabled": false}}` — a body touching only `enabled`, never reassembling schedule, model, tools, or prompt the way UPDATE's Step 6 body does. If the call fails because `record.routine_id` no longer refers to an existing routine (deleted out-of-band at claude.ai/code/routines), report the record as stale and offer the same recourse as STATUS Step 2 / UPDATE Step 6: delete `.claude-tweaks/routines/{PREFIXED_NAME}.yml` and re-run `create <skill>` instead.

**Step 3 — Report.** "`{PREFIXED_NAME}` paused — it will not fire until resumed." No instantiated-record write: the record schema (`_shared/routine-template-schema.md`) carries no `enabled`/`paused` field, so there is nothing local to rewrite — `status <skill>`'s `enabled` check (`status.md` Step 3.5) reads the live state directly off `RemoteTrigger get`, not a record copy.

## RESUME `<skill>`

Mirrors PAUSE exactly, with one difference.

**Step 1 — Resolve the record.** Same as PAUSE Step 1.

**Step 2 — Resume.** Call `RemoteTrigger {action: "update", trigger_id: <record.routine_id>, body: {"enabled": true}}`. Same stale-record handling as PAUSE Step 2.

**Step 3 — Report.** "`{PREFIXED_NAME}` resumed — it will not fire on its existing schedule again." Same no-record-write rationale as PAUSE Step 3.
