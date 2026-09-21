---
record: 211
origin: capture
risk: medium
size: medium
ceremony: standard
grants: [build]
surface: infra
---
# 211: Wire a GitHub event trigger for cloud /review — create_webhook_trigger is unused

Surface: infra

## Current State

`/claude-tweaks:routine`'s create/update body-assembly logic (`skills/routine/create-and-update.md`) only ever populates `cron_expression` when building a `RemoteTrigger create`/`update` body. `RemoteTrigger` also exposes a `create_webhook_trigger` action (`POST /v1/code/webhook-triggers`) that attaches a GitHub event source (e.g. `pull_request.opened`) to an existing routine, with a filter grammar covering author, title, body, base branch, head branch, labels, is-draft, and is-merged — each combinable with equals / contains / starts-with / is-one-of / is-not-one-of / matches-regex (whole-value matching, e.g. `.*hotfix.*` rather than `hotfix`). This action is unused anywhere in the plugin today.

Separately, the public routines documentation states GitHub triggers are "configured from the web UI only" — a claim the tool surface appears to contradict, since `create_webhook_trigger` is a directly callable API action. One of the two is stale, and that has not been resolved.

Two preconditions gate any use of this capability: the Claude GitHub App must be installed on the target repo (`/web-setup` grants clone access but does **not** enable webhook delivery on its own), and per-routine and per-account hourly event caps apply during the research preview, with events beyond the cap dropped rather than queued.

## Deliverables

- Resolve the doc-vs-tool contradiction empirically: determine whether `create_webhook_trigger` is actually usable to attach a GitHub event source to a routine, and correct whichever side is stale — the public routines doc's "web UI only" claim, or (if the tool call turns out to be non-functional/restricted) a note explaining why the surface exists but isn't usable yet.
- Add a webhook-trigger creation path to `/claude-tweaks:routine`, alongside the existing cron-only path, so a project can wire a GitHub event trigger (e.g. `pull_request.opened`, filtered to non-draft PRs whose head branch doesn't match `claude/*`) that fires cloud-side `/claude-tweaks:review` on qualifying PRs — exposing the filter grammar's fields and match operators to the caller rather than hardcoding one filter shape.
- Update `skills/_shared/routine-template-schema.md` (or the instantiated-record schema it documents) if tracking a trigger's type/filter requires a new field, so `status`/`fleet status` can report on webhook-triggered routines the same way they report on cron-scheduled ones.
- Surface both preconditions to the user at the point they'd otherwise cause a silent no-op or a surprising cap-drop: a check/warning when the Claude GitHub App isn't installed (distinct from `/web-setup`'s clone-access grant), and a note on the hourly event cap's drop-not-queue behavior before a trigger is created.

## Acceptance Criteria

- The "web UI only" claim and the `create_webhook_trigger` tool surface no longer contradict each other in the shipped docs — whichever statement was stale is corrected, cross-referenced from every place that repeated the old claim.
- `/claude-tweaks:routine` can create a GitHub event trigger via `create_webhook_trigger`, verified against a real (or explicitly documented dry-run) call, with the filter grammar's fields and operators exposed to the caller rather than fixed to one example filter.
- Attempting to create a webhook trigger on a repo without the Claude GitHub App installed produces a clear, distinct message rather than a silent failure or a misleading "clone access is enough" assumption.
- The hourly event cap and its drop-not-queue behavior are documented somewhere a user configuring a webhook trigger will see before creating one.

## Technical Approach

Verify the `create_webhook_trigger` tool action's actual behavior (required fields, response shape, and whether the "web UI only" doc claim reflects a real restriction) before committing to skill prose — the docs are already known to be stale on at least one side, so this is exactly the kind of third-party-tool contract to confirm empirically rather than assume. Extend `skills/routine/create-and-update.md`'s body-assembly logic with a webhook-trigger mode that parallels the existing cron-resolution steps, reusing the same environment-resolution and review-before-create structure already in place for cron-based creation.

### Key Files

- `plugin/skills/routine/create-and-update.md`
- `plugin/skills/_shared/routine-template-schema.md`
- `plugin/skills/routine/SKILL.md` — Anti-Patterns table (no-delete-API note)

## Gotchas

- `RemoteTrigger` has no delete counterpart (documented in `skills/routine/SKILL.md`'s own Anti-Patterns table) — a wrongly configured webhook trigger runs live until manually removed at claude.ai/code/routines. Webhook-trigger creation needs the same review-before-create discipline the cron path already has (`create-and-update.md` Step 7's confirm), not a lighter one.
- The scope example in the original request (`pull_request.opened` filtered to non-draft, non-`claude/*` head branches) is illustrative, not mandated — the exact event choice and filter combination are a build-time decision informed by what `create_webhook_trigger` actually accepts.

## Original request

Wire a GitHub event trigger for cloud /review — create_webhook_trigger is unused

Surface: infra

## Current State

`/claude-tweaks:routine`'s create/update body-assembly logic (`skills/routine/create-and-update.md`) only ever populates `cron_expression` when building a `RemoteTrigger create`/`update` body. `RemoteTrigger` also exposes a `create_webhook_trigger` action (`POST /v1/code/webhook-triggers`) that attaches a GitHub event source (e.g. `pull_request.opened`) to an existing routine, with a filter grammar covering author, title, body, base branch, head branch, labels, is-draft, and is-merged — each combinable with equals / contains / starts-with / is-one-of / is-not-one-of / matches-regex (whole-value matching, e.g. `.*hotfix.*` rather than `hotfix`). This action is unused anywhere in the plugin today.

Separately, the public routines documentation states GitHub triggers are "configured from the web UI only" — a claim the tool surface appears to contradict, since `create_webhook_trigger` is a directly callable API action. One of the two is stale, and that has not been resolved.

Two preconditions gate any use of this capability: the Claude GitHub App must be installed on the target repo (`/web-setup` grants clone access but does **not** enable webhook delivery on its own), and per-routine and per-account hourly event caps apply during the research preview, with events beyond the cap dropped rather than queued.

## Deliverables

- Resolve the doc-vs-tool contradiction empirically: determine whether `create_webhook_trigger` is actually usable to attach a GitHub event source to a routine, and correct whichever side is stale — the public routines doc's "web UI only" claim, or (if the tool call turns out to be non-functional/restricted) a note explaining why the surface exists but isn't usable yet.
- Add a webhook-trigger creation path to `/claude-tweaks:routine`, alongside the existing cron-only path, so a project can wire a GitHub event trigger (e.g. `pull_request.opened`, filtered to non-draft PRs whose head branch doesn't match `claude/*`) that fires cloud-side `/claude-tweaks:review` on qualifying PRs — exposing the filter grammar's fields and match operators to the caller rather than hardcoding one filter shape.
- Update `skills/_shared/routine-template-schema.md` (or the instantiated-record schema it documents) if tracking a trigger's type/filter requires a new field, so `status`/`fleet status` can report on webhook-triggered routines the same way they report on cron-scheduled ones.
- Surface both preconditions to the user at the point they'd otherwise cause a silent no-op or a surprising cap-drop: a check/warning when the Claude GitHub App isn't installed (distinct from `/web-setup`'s clone-access grant), and a note on the hourly event cap's drop-not-queue behavior before a trigger is created.

## Acceptance Criteria

- The "web UI only" claim and the `create_webhook_trigger` tool surface no longer contradict each other in the shipped docs — whichever statement was stale is corrected, cross-referenced from every place that repeated the old claim.
- `/claude-tweaks:routine` can create a GitHub event trigger via `create_webhook_trigger`, verified against a real (or explicitly documented dry-run) call, with the filter grammar's fields and operators exposed to the caller rather than fixed to one example filter.
- Attempting to create a webhook trigger on a repo without the Claude GitHub App installed produces a clear, distinct message rather than a silent failure or a misleading "clone access is enough" assumption.
- The hourly event cap and its drop-not-queue behavior are documented somewhere a user configuring a webhook trigger will see before creating one.

## Technical Approach

Verify the `create_webhook_trigger` tool action's actual behavior (required fields, response shape, and whether the "web UI only" doc claim reflects a real restriction) before committing to skill prose — the docs are already known to be stale on at least one side, so this is exactly the kind of third-party-tool contract to confirm empirically rather than assume. Extend `skills/routine/create-and-update.md`'s body-assembly logic with a webhook-trigger mode that parallels the existing cron-resolution steps, reusing the same environment-resolution and review-before-create structure already in place for cron-based creation.

## Gotchas

- `RemoteTrigger` has no delete counterpart (documented in `skills/routine/SKILL.md`'s own Anti-Patterns table) — a wrongly configured webhook trigger runs live until manually removed at claude.ai/code/routines. Webhook-trigger creation needs the same review-before-create discipline the cron path already has (`create-and-update.md` Step 7's confirm), not a lighter one.
- The scope example in the original request (`pull_request.opened` filtered to non-draft, non-`claude/*` head branches) is illustrative, not mandated — the exact event choice and filter combination are a build-time decision informed by what `create_webhook_trigger` actually accepts.

## Original request

Wire a GitHub event trigger for cloud /review — create_webhook_trigger is unused

**Related:** none

Context: The `RemoteTrigger` tool exposes a `create_webhook_trigger` action (`POST /v1/code/webhook-triggers`) that attaches a GitHub event source to an existing routine. `/claude-tweaks:routine` uses only `cron_expression` and never touches it. The public routines doc states GitHub triggers are "configured from the web UI only", which the tool surface appears to contradict — worth resolving, since one of the two is stale.

Scope: A `pull_request.opened` trigger filtered to non-draft PRs whose head branch doesn't match `claude/*` would give this repo cloud-side `/claude-tweaks:review` on every PR. The filter grammar covers author, title, body, base branch, head branch, labels, is-draft, and is-merged, each with equals / contains / starts-with / is-one-of / is-not-one-of / matches-regex (whole-value: `.*hotfix.*`, not `hotfix`). Two preconditions: the Claude GitHub App must be installed on the repo (`/web-setup` grants clone access but does **not** enable webhook delivery), and per-routine and per-account hourly event caps apply during the research preview, with events beyond the cap dropped rather than queued.

## Blocked / Future Work

This build (`2026-08-23T135002-record-68-211`, dispatched as a `dispatch-record-68-211` file-overlap bundle with #68) could not implement this record's core deliverable — the `create_webhook_trigger` integration and the doc-vs-tool contradiction resolution — because the `RemoteTrigger` tool is not available in this build session. Probed via `ToolSearch select:RemoteTrigger`: no matching deferred tool found. This is a Claude Code CLI worktree agent session (dispatched by `/claude-tweaks:dispatch`), not an interactive `/claude-tweaks:routine` invocation, and `RemoteTrigger` appears to be gated to the latter.

Per this record's own Technical Approach ("verify the tool action's actual behavior... before committing to skill prose"), writing the webhook-trigger creation path without that verification would risk shipping incorrect assumptions about `create_webhook_trigger`'s required fields, response shape, and filter grammar — exactly the failure mode this record's Deliverables section exists to avoid. No implementation was attempted for that reason.

**What unblocks it:** a session with the `RemoteTrigger` tool loaded (an interactive `/claude-tweaks:routine`-capable session) needs to:
1. Call `create_webhook_trigger` against a real (or documented dry-run) routine and record its actual required fields, response shape, and any App-not-installed error behavior.
2. Resolve the doc-vs-tool contradiction (find and correct whichever of the public routines doc's "web UI only" claim or the tool surface itself is stale).
3. Extend `create-and-update.md` with the webhook-trigger creation path, informed by step 1's findings.

Tracked as ledger item #2 in `docs/plans/2026-08-23-record-68-211-ledger.md` (phase `build`, status `open`).

