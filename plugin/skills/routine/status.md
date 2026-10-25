# Routine — STATUS

Loaded by `/claude-tweaks:routine`'s Workflow dispatch when the resolved mode is `status`. Kept out
of `SKILL.md` because this mode needs nothing from CREATE or UPDATE — and `status --all`, the form
`/claude-tweaks:init`'s Update Mode fires in bulk, is the highest-frequency entry point into this
skill.

Step numbering matches `SKILL.md`'s pre-split numbering exactly, so existing cross-references from
other skills (`skills/init/update-mode.md` cites STATUS Step 2) keep pointing at the right step.
Steps 1-2 mirror CREATE Steps 1-2 for the per-skill path; that procedure lives in
`create-and-update.md` in this skill's directory, but the `--all` branch below needs neither.

---

**Step 1.** Run `record-freshness.md` in this skill's directory (Steps F1-F2) first, on every path through this step — its Step F3 STATUS disposition governs everything below. STATUS never stops on a stale checkout: it is read-only, and `status --all` is what `/claude-tweaks:init`'s Update Mode fires in bulk, so a stop here would block a read path. What changes instead is *which copy of each record gets read* — always the one named by that record's `authority`, which on a behind checkout is the integration branch's rather than this checkout's (#190).

When `--all` was passed (no `<skill>` argument), skip straight to the `--all` branch below. Otherwise, load the template and resolve `PREFIXED_NAME` exactly as CREATE Steps 1-2 do (`create-and-update.md` in this skill's directory), then look up the entry for `{PREFIXED_NAME}.yml` in the comparison's `records[]`. If there is no entry on either side, report that no routine has been created for `<skill>` in this project and suggest `create <skill>`. Stop. If there is, proceed with that instance — read from its `authority` copy — for the rest of this workflow. An `upstream-only` entry is a real, live routine that this checkout simply lacks: it carries a `routine_id`, so Steps 2-3.5 all run against it normally rather than being reported as "not created."

**Step 1, `--all` branch.** Enumerate every record across the union of the working checkout and the integration branch, regardless of which skill each names — `records[]` from Step F2's comparison, not a bare directory listing. Reading the directory alone is what made a record renamed upstream report under its old filename while its new one stayed invisible:

```bash
export INTEGRATION_BRANCH="<Step F1's resolved branch, or empty if nothing resolved>"
node -e "
  const { compareRoutineRecords, freshnessNote } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/routine-template-parser.js');
  const r = compareRoutineRecords({ branch: process.env.INTEGRATION_BRANCH || undefined });
  console.log(JSON.stringify({ ...r, note: freshnessNote(r) }, null, 2));
"
```

Use each entry's `authority` copy (`upstream` when set, else `local`) wherever the steps below say "the record". When the comparison is unverified, `records[]` degrades to exactly the working checkout's own listing, so this branch behaves as it did before — print `note` verbatim and carry on.

If `records[]` is empty, report "no routines instantiated in this project yet" and stop. This branch never derives `REPO_SLUG` or calls `git remote get-url origin` for the purpose of resolving which template matches each record — every other STATUS path starts from a skill name and works forward to a record; this one starts from the records that already exist. (Step 3.5's existing field-level drift check may still call `git remote get-url origin` separately, to compare a record's live repo-url field against the project's current origin — an unrelated, pre-existing check this branch doesn't change.)

For each returned record, resolve its matching template:

First, check the record has both `template` and `routine_id` fields present (both are required per `skills/_shared/routine-template-schema.md`). If either is missing, report this record as **Malformed** (filename + which required field is absent) and move to the next record — never attempt to resolve a template or call `RemoteTrigger` for an incomplete record.

1. Check whether `${CLAUDE_PLUGIN_ROOT}/skills/{record.template}/routine-template.yml` exists. If it doesn't (the skill directory doesn't exist, or exists with no routine template at all), this record is **Orphaned** — record that verdict and move to the next record without calling `RemoteTrigger` for this one (there is no live template to compare against, so a `get` call adds nothing actionable).
2. Otherwise, that file is the matching template.

Read and parse the resolved template file's content (`template_version`, `model`, `allowed_tools`) now — Steps 3 and 3.5 below assume this has already happened, exactly as the per-skill path's own Step 1 already does. Also read the schema's current `kernel_version` once per run (`grep -m1 '^kernel_version:' "${CLAUDE_PLUGIN_ROOT}/skills/_shared/routine-template-schema.md"` — `${CLAUDE_PLUGIN_ROOT}` is a model-resolved placeholder, not a shell contract; see `docs/skill-authoring.md`'s Plugin-root references section) — Step 3 below reuses this single value for every record's kernel-staleness check rather than re-invoking the grep per row. If the grep yields nothing (the schema file is unreadable — plugin install missing or mangled), Step 3 handles that as its own unresolved case; do not treat an empty result here as "no kernel_version line."

For every record that resolved a template (i.e. not Orphaned or Malformed), continue to Steps 2-3.5 below to compute In sync / Drifted / Stale.

> **Parallel execution:** Use parallel tool calls aggressively — each non-Orphaned, non-Malformed record's Step 2 `RemoteTrigger get` call targets a different `trigger_id` and is independent of every other record's call, so issue them concurrently. Orphaned and Malformed records need no `RemoteTrigger` call at all and are already fully resolved after step 1 above.

Present one combined table across every record, regardless of skill (this is the one STATUS mode with no per-skill grouping, since `--all` never had a skill name to group by), preceded by one always-present banner line naming what the records were compared against:

```
Compared against origin/dev — this checkout is 119 commit(s) behind.

| Routine | Verdict | Detail |
|---|---|---|
| code-health | In sync | template v4, no field drift — read from origin/dev; this checkout's copy is stale |
| tidy | In sync | template v2, no field drift — read from origin/dev; not present in this checkout |
| docs-health | Drifted | template v1 → v2; schedule unchanged |
| skill-health | Orphaned | no skills/skill-health/routine-template.yml found — was this skill renamed? |
| journey-health | Stale | routine_id no longer resolves via RemoteTrigger get |
| claude-tweaks-broken (unresolved) | Malformed | claude-tweaks-broken.yml is missing required field `template` |
```

The banner reads `Compared against {ref} — this checkout is {behind} commit(s) behind` (or `— up to date`) when the comparison is verified, and `freshnessNote`'s line verbatim when it is not. Never omit it: a report that does not say which tree it describes is exactly what made the original phantom-drift run read as authoritative.

"Verdict" is one of: **In sync** (template_version matches, no field drift — Steps 3/3.5's existing checks), **Drifted** (template_version or kernel_version mismatch, and/or schedule/model/tools/repo-url diff), **Orphaned** (per step 1 above — no live template resolved), **Stale** (Step 2's `RemoteTrigger get` call fails because the routine no longer exists — same condition Step 2 already documents for the per-skill path), **Malformed** (the record is missing a required field — see above). Freshness adds no sixth value — it changes which copy the verdict is computed from, and a record already current on the integration branch now reports **In sync** where a working-tree read reported Drifted. Keeping the set at five is deliberate: `skills/init/update-mode.md` enumerates these five by name, and a sixth would silently fall outside its routing.

"Detail" carries whichever of Step 3/3.5's messages applies, or the Orphaned/Stale/Malformed explanation. Where a record's `authority` is `upstream`, suffix it with `— read from {ref}; this checkout's copy is stale` (presence `both`) or `— read from {ref}; not present in this checkout` (presence `upstream-only`), so a row's provenance is visible without cross-referencing the banner.

> **Parallel execution:** Use parallel tool calls aggressively — when more than one instantiated record exists, each instance's Step 2 `RemoteTrigger get` call targets a different `trigger_id` and is independent of every other instance's call, so issue them concurrently rather than iterating sequentially. Run each instance's Step 3/3.5 analysis and assemble the combined presentation after all `get` calls complete.

**Step 2.** Call `RemoteTrigger {action: "get", trigger_id: <record.routine_id>}` for live state — enabled/disabled, schedule, and any last/next run fields the response carries. If the `get` call fails because the routine no longer exists, report the record as stale and offer to delete `.claude-tweaks/routines/{PREFIXED_NAME}.yml` and re-run `create <skill>`.

In `--all` mode, use `record.filename` in place of `{PREFIXED_NAME}` (never derived in this branch), and record this as the **Stale** verdict in that record's row rather than presenting an interactive per-record offer — the combined table already surfaces it, and any recourse (delete + recreate) is the caller's decision, not something to prompt for mid-enumeration.

**Step 3.** Compare the record's `template_version` against the current template file's (already read in Step 1) `template_version`. If they differ, flag it: "this routine was created from template v{N}; the template is now at v{M} — run `update {skill}` to re-sync." A live routine holds a frozen *copy* of the prompt it was created from, so a version gap means every firing since has executed the old text; `skills/_shared/routine-template-schema.md`'s "Re-provisioning after a template change" section covers the cases this recourse doesn't reach (a routine with no instantiated record). Also compare the record's `kernel_version` against the schema's current one: Step 1 already read `$CURRENT` once per run via `grep -m1 '^kernel_version:' "${CLAUDE_PLUGIN_ROOT}/skills/_shared/routine-template-schema.md"`. If that grep yielded nothing (the schema file is unreadable — plugin install missing or mangled), report "kernel_version unresolved — cannot judge kernel staleness (check the plugin install)" for the whole run and skip the kernel comparison for every record — never report kernel-stale off an unresolved current. Otherwise, with `$RECORDED` = the record's own `kernel_version` field and `$CURRENT` = Step 1's grep result, run the helper rather than comparing by hand:

```bash
node -e "const {kernelFreshness}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/routine-template-parser.js');
  console.log(kernelFreshness(process.argv[1], process.argv[2]))" -- "$RECORDED" "$CURRENT"
```

When it prints `kernel-stale`, report **kernel stale (recorded `kernel_version` N < current M — run `/claude-tweaks:routine update <skill>`)** distinctly from template-field drift; a record with no `kernel_version` reports kernel-stale (the helper already treats a missing value this way). Kernel-staleness renders within the **Drifted** verdict's Detail column — never a sixth verdict (the five-verdict set is closed; `skills/init/update-mode.md` enumerates it).

**Step 3.5 — Field-level drift (best-effort).** Each field below is checked independently — the absence of one does not skip the others. If Step 2's `get` response includes a top-level `enabled` boolean (already read there for live state) and it is `false`, report it: "routine is paused (`enabled: false`) in the live console — run `/claude-tweaks:routine resume <skill>` to restore it, or leave it paused deliberately." This folds into the **Drifted** verdict, never a sixth value (this file's five-verdict set is closed — see below) — a routine can be in sync on every other field and still be Drifted solely because it is paused, including a pause performed via the claude.ai/code web UI's Repeats toggle rather than `/claude-tweaks:routine pause`, which this check has no way to distinguish from a pause of any other origin. `enabled: true` matches the implicit non-paused expectation and produces no detail line, the same as every other field-level check below when it passes. In `--all` mode this check runs unchanged per record, since that branch reaches Step 3.5 the same way the per-skill path does. Branch on the record's own `cadence` first (absent reads as `recurring`, per `_shared/routine-template-schema.md`): for a `recurring` record, if Step 2's `get` response includes a top-level `cron_expression` (a sibling of `job_config`, per the `create` body shape in CREATE Step 6 — not nested under `job_config.ccr`), diff it against `record.schedule`; for a `once` record, if the response includes a top-level `run_once_at` instead, diff it against `record.run_once_at` — never compare a `once` record's `record.run_once_at` against a live response's `cron_expression` field or vice versa, since the two are mutually exclusive on the wire (`create-and-update.md` Step 6) and comparing across them would misreport every one-off record as permanently drifted. A live response carrying neither field for a `once` record's `get` (the routine already auto-disabled and fired, so `RemoteTrigger` may no longer echo a future-fire field) is not drift — skip this particular field's comparison and note "field-level drift unavailable for run_once_at — routine may have already fired and auto-disabled" rather than reporting a mismatch. If the response includes `job_config.ccr.session_context.model`, diff it against `template.model`. If it includes `job_config.ccr.session_context.allowed_tools`, diff it against `template.allowed_tools` (set comparison, order-independent). If it includes `job_config.ccr.session_context.sources[].git_repository.url`, diff it against the project's origin (re-resolve via `git remote get-url origin` if not already available in this invocation). If it includes the routine's own prompt text (`job_config.ccr.events[].data.message.content`, per the `create` body shape in CREATE Step 6), check it three independent ways: a literal `{{TARGET_BRANCH}}` still present is always drift and always actionable — that routine instructs its cloud agent to check out a branch by that name, matches nothing, and proceeds on whatever the container started with; a literal `{kickoff}` still present is likewise always drift and always actionable — that routine fires into `/claude-tweaks:routine-kickoff {kickoff}`, an invocation of nothing; and the branch the prompt actually names should match `record.branch`, or, where the record has no `branch` key, the prompt should carry the unresolved fallback wording rather than a pinned branch. A prompt naming a branch other than the record's is the field-level mismatch most worth reporting: the routine is auditing a different tree than this project's own record claims it does. Report any per-field mismatch alongside the version-drift flag from Step 3. For any field the `get` response does not carry, skip only that field's comparison and note "field-level drift unavailable for {field} — comparing template_version only for this field" instead of assuming a response shape the tool hasn't been confirmed to return. Separately, if the record's `webhook_triggers` array (`_shared/routine-template-schema.md`'s Instantiated record schema) is non-empty, append a note to the rendered verdict: `+ {N} GitHub-event trigger(s) attached` — this is informational, never itself a Drifted/OK verdict input; a webhook trigger's own live state is not compared here. Webhook-trigger drift detection is out of scope here — no comparison surface is documented for `create_webhook_trigger` yet (no `get`/list shape confirmed against a live attached trigger).

Report both the live state and the drift check(s) together.
