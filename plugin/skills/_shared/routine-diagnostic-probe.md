# Routine Diagnostic Probe — Shared Procedure

Single source of truth for firing an ad hoc diagnostic check against a target project's Claude Code cloud Routine environment — verifying an MCP tool exists, a dependency chain works, or general environment health — without hand-constructing a one-off `RemoteTrigger` call from scratch each time. This file has no callable surface of its own — every step below is executed by the calling skill/plan.

## Slot resolution

One reusable, deterministically-named trigger per project, not a fresh one per diagnostic (`RemoteTrigger` has no delete action — see Cleanup below):

```
{REPO_SLUG}-diagnostic-probe
```

Resolve the target repo URL and derive `REPO_SLUG` exactly as `skills/routine/SKILL.md`'s CREATE Step 2 does — both halves, repo-URL resolution and slug derivation — follow that file's own steps rather than re-deriving the logic here.

```
ToolSearch select:RemoteTrigger
RemoteTrigger {action: "list"}
```

Filter the returned (first-page) triggers to `name === "{REPO_SLUG}-diagnostic-probe"`.

**Found** — reuse it: skip straight to Body construction below with this `trigger_id`, using the **Update** branch. The `list` response for the found trigger already includes its full `job_config` — read `environment_id` directly off that found trigger's `job_config.ccr.environment_id`; no fresh resolution needed on this path.

**No match on this page** — before doing anything else, check the response's `has_more` field. If `has_more` is `true`, do NOT proceed to create: stop and tell the user directly. `RemoteTrigger {action: "list"}` returns only its first page with no cursor parameter exposed (the same tool constraint `skills/routine/SKILL.md`'s CREATE Step 4 source (b) documents, confirmed live there too), so the probe's own slot may sit on a page this call never saw — and `RemoteTrigger` has no delete action, so creating now risks a permanent, undetectable duplicate. Ask the user to either confirm no such slot exists (e.g. via the claude.ai/code/routines web UI search) or supply the `trigger_id` directly if they already know it.

Only if `has_more` is `false` (or absent) has the slot genuinely been ruled out — create it. First, attempt CREATE Step 4's non-guided procedure exactly as that file does (cache → project-local records → account-wide list-and-filter) — follow that file's own steps rather than re-deriving the logic here. Only if that whole non-guided procedure comes up empty does CREATE Step 4's own guided-creation fallback apply — and when it would, do not trigger it: stop and tell the user directly instead. There is no existing environment for this project to run a diagnostic against, and creating one is `skills/routine/guided-environment-creation.md`'s job, not this procedure's — a diagnostic probe should never be the reason a brand-new billed environment gets created.

## Body construction

```json
{
  "name": "{REPO_SLUG}-diagnostic-probe",
  "enabled": false,
  "cron_expression": "",
  "job_config": {
    "ccr": {
      "environment_id": "<resolved environment_id>",
      "session_context": {
        "model": "claude-sonnet-5-5",
        "sources": [{"git_repository": {"url": "<target project's resolved repo URL>"}}],
        "allowed_tools": ["Bash", "Read", "Grep", "Glob"]
      },
      "events": [{"data": {
        "uuid": "<fresh lowercase v4 uuid>",
        "session_id": "",
        "type": "user",
        "parent_tool_use_id": null,
        "message": {"content": "<caller's diagnostic prompt, per Prompt content below>", "role": "user"}
      }}]
    }
  },
  "mcp_connections": [{
    "connector_uuid": "bf7c680d-5fdc-5ef4-b4a0-abadb619bf0a",
    "name": "Claude_Code_Remote",
    "url": "https://api.anthropic.com/v1/code/mcp/meta",
    "transport_type": "http"
  }]
}
```

`"cron_expression": ""` (an explicit empty string, not an omitted field) plus no `run_once_at` at all is the confirmed shape of a manual-only trigger — confirmed live twice: first by reading `memenu-app`'s own pre-existing `memenu-app-env-smoke-test` trigger's stored config, then directly by `create`-ing a brand-new trigger with this exact shape (HTTP 200, no rejection), despite `/schedule`'s own docs describing "exactly one of `cron_expression`/`run_once_at`" as required.

`allowed_tools` above is the minimum — a caller whose diagnostic needs to write files adds `Write`/`Edit` itself. `session_context.model` is also overridable by the caller — the value shown is the default, not a fixed requirement. The `mcp_connections` entry is not optional: every real, working routine in this account carries it, and it is almost certainly what exposes GitHub MCP tools inside the sandbox — a diagnostic built without it may silently run with no MCP tools available at all, invalidating whatever it was trying to check.

**Create** (slot didn't exist): `RemoteTrigger {action: "create", body: <above>}`.

**Update** (slot already existed): `RemoteTrigger {action: "update", trigger_id: <found trigger_id>, body: {"job_config": <the job_config object above, with a fresh uuid>}}` — a partial update; only `job_config` needs to change, `name`/`enabled`/`cron_expression`/`mcp_connections` stay as they already are (confirmed live: an `update` call sending only `job_config` left the found trigger's `name`/`enabled`/`cron_expression`/`mcp_connections` all unchanged in the response, with only `job_config` reflecting the new content).

## Prompt content

The caller supplies the full diagnostic prompt — checks vary too much (GitHub MCP primitives, environment health, plugin invocability) for this procedure to templatize. The prompt must end with this exact reporting-convention paragraph, verbatim:

> Report one PASS/FAIL line per check. For any MCP tool call, name the exact tool and parameters used. On failure, quote the exact error message verbatim — do not paraphrase.

## Firing and waiting

`RemoteTrigger {action: "run", trigger_id: <trigger_id>}` fires immediately regardless of `enabled`/schedule state — confirmed live twice: against `memenu-app`'s own pre-existing `memenu-app-env-smoke-test` trigger, and directly against a newly-`create`-d diagnostic-probe trigger, fired for real end-to-end.

No polling mechanism exists for this. The caller waits a real interval (minutes, not seconds) before reading the result via the console URL that the `create`/`run` response includes — `RemoteTrigger {action: "get"}` and `{action: "list"}` return only trigger configuration, not run output, for this trigger shape. This is a genuine async wait; do not fabricate or assume a result before reading the real transcript. The `run` response's `session_id` starts with a `cse_` prefix, but the working console transcript URL needs a `session_` prefix instead — rewrite it: `https://claude.ai/code/session_<id-without-cse_-prefix>?pane=runs&trigger=<trigger_id>` (confirmed live: a `session_id` of `cse_01HMouZ13XPDBPvTVEfWNA4o` only resolved at `.../session_01HMouZ13XPDBPvTVEfWNA4o?...`).

## Cleanup

None needed. Leave the slot `enabled: false` (its resting state) after reading results — it stays in the account, reused by the next diagnostic against this same project. `RemoteTrigger` has no delete action; deleting the slot entirely (if ever wanted) requires the claude.ai/code/routines web UI.

## Accepted limitation

Two callers firing different diagnostics against the same project's slot concurrently race on last-write-wins for the prompt. Self-correcting, low-stakes — not worth a lock for an occasional manual diagnostic, same posture this codebase already accepts for `/claude-tweaks:backlog refine`'s own label race.

## Consumers

| Consumer | Use |
|---|---|
| Dispatch's gh-CLI/MCP bridge (was `docs/superpowers/plans/2026-08-02-dispatch-mcp-bridge.md`, deleted `d83f0720`) | Used this procedure's reusable `memenu-app-diagnostic-probe` slot to verify the gh-CLI/MCP bridge's confirmed tool primitives (Tasks 1-2) before writing any bridge documentation |
