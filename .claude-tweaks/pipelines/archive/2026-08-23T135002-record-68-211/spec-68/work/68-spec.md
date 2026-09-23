---
record: 68
origin: human
risk: low
size: low
ceremony: standard
grants: [build]
surface: infra
---
# 68: Feature request: lightweight "run happened" heartbeat independent of full health-state persistence

Surface: infra

## Current State

Live routine objects carry an undocumented `notifications` field (`{"channel": {"email": true, "push": false, "slack": false}}`), confirmed writable through `RemoteTrigger create` and confirmed to fire on a legitimate no-op completion. `skills/routine/create-and-update.md` Step 6 never sets this field on any routine it creates, and Step 8's guided-creation branch never assembles the JSON body at all. All six shipped health-sweep/lifecycle routine templates therefore run today with no notification wired — a firing with nothing due writes nothing at all, so "ran fine, nothing to report" is byte-identical from outside to "hung / crashed / never fired."

## Deliverables

- [ ] **Task 0 (empirical premise-check, blocks the guided-path deliverable only):** confirm `RemoteTrigger {action: "update", trigger_id, body: {notifications: {...}}}` actually persists the field, the same way `create` was already confirmed live. Create a disabled, cron-less throwaway routine, call `update` on it with a `notifications` body, `get` it back to confirm the value stuck, then remove the throwaway by hand at claude.ai/code/routines (no delete API exists).
- [ ] `skills/routine/create-and-update.md` Step 6's `RemoteTrigger create` JSON body template gains a top-level `"notifications": {"channel": {"email": true, "push": false, "slack": false}}` field, added unconditionally for every routine this skill creates via the direct (non-guided) path.
- [ ] `skills/routine/create-and-update.md` Step 8's guided-creation branch issues an immediate follow-up `RemoteTrigger {action: "update", trigger_id, body: {notifications: {...}}}` call right after receiving `trigger_id` back from `guided-environment-creation.md`'s Create procedure, so a guided-path routine ends up with the same notification config as a direct-path one.
- [ ] Step 7's rendered preview (both the defaults-confirm render and the Customize re-render) gains one line stating the routine will send an email notification on every firing — success and no-op alike — so the user isn't surprised by the first email.
- [ ] One sentence documenting `notifications` as a field this skill sets at creation time is added next to Step 6's body template, so a future reader doesn't mistake the field for dead/unused JSON.

## Acceptance Criteria

1. A fresh `/claude-tweaks:routine create <skill>` run on the direct (non-guided) path produces a `RemoteTrigger create` call whose body includes `"notifications": {"channel": {"email": true, "push": false, "slack": false}}` as a top-level field, sibling of `cron_expression`.
2. A fresh `/claude-tweaks:routine create <skill>` run that takes the guided-creation path (`NEEDS_GUIDED_CREATION` set) results in the created routine carrying the same `notifications` value — verified with a `RemoteTrigger {action: "get"}` call against the just-created `trigger_id`.
3. Task 0's premise-check for `RemoteTrigger update`'s notifications-write runs and its result (confirmed / not confirmed) is recorded in the build. If not confirmed, AC 2's follow-up call is redesigned around whatever mechanism the probe finds actually works before AC 2 is considered met — this criterion blocks the guided-path deliverable only, never the direct-path one.
4. Step 7's rendered preview, on both the defaults-confirm path and the Customize re-render path, includes a line stating the routine will email on every firing.
5. `grep -n "notifications" skills/routine/create-and-update.md` returns at least two matches: the Step 6 body-template field and the Step 8 follow-up call.

## Technical Approach

**Direct-create path.** Extend Step 6's JSON body template with the `notifications` field, value fixed at `{"channel": {"email": true, "push": false, "slack": false}}` — email only, applied to every routine this skill creates, no per-template or per-project override.

- **Channel choice:** email, because it's the only channel confirmed both writable and firing.
- **Whether every routine needs it:** every routine, unconditionally — all six shipped templates are scheduled/unattended by construction, so singling out a subset needs a criterion this record doesn't supply.

**Guided-creation path.** `guided-environment-creation.md`'s Create procedure is pure browser automation — it never touches Step 6's JSON body. Set `notifications` via a same-session follow-up `RemoteTrigger update` call in `create-and-update.md`'s Step 8, immediately after the guided flow returns `trigger_id`, reusing the `update` action the UPDATE flow's own Step 6 already calls routinely.

**Task 0 scope.** Gates only the guided-path deliverable (AC 2/3) — the direct-create path's writability is already confirmed live.

### Key Files

- `plugin/skills/routine/create-and-update.md` — Step 6 body template, Step 7 preview, Step 8 guided branch
- `plugin/skills/routine/guided-environment-creation.md` — Create procedure (unchanged; consumed by Step 8's follow-up)

## Gotchas

- Does a routine notification fire on a crash/hang/timeout, not just a clean no-op completion — still unknown, and not directly testable (no API surfaces "was a notification sent for run X," and a true crash can't be induced on demand). Not a blocker: setting `notifications` is strictly better than not setting it under every possible answer to that question.
- No delete API for a `RemoteTrigger` — Task 0's throwaway probe routine must be removed by hand at claude.ai/code/routines after the check.
- `notifications.channel` is an object with three boolean keys (`email`/`push`/`slack`) per the live-probed shape — build the literal nested value, don't guess a shorter form.
- Existing routines created before this change ship without `notifications` set; this deliverable does not backfill them — `/claude-tweaks:routine update` already exists as the mechanism a human or a follow-up record could use for that.
- Absence-detection ceiling, decided explicitly: no separate watcher/dashboard for "did today's email arrive" is in scope. A missing email is a weak, human-attention-dependent alarm, but strictly better than the current total silence.

## Original request

Feature request: lightweight "run happened" heartbeat independent of full health-state persistence

**Unparked:** 2026-08-08. The stated blocker — "blocked today on an upstream capability that does not exist" — is now in question. See **Absorbed from #210** below: a routine-level notification mechanism exists and was never considered when this was filed. Whether it actually serves as the heartbeat is a single empirical question, not an upstream feature request.

---

**Summary:** There's no way to headlessly verify a health-skill routine's outcome — `RemoteTrigger` exposes no run-status/summary endpoint, and side-effects (GitHub issues, `health-state` commits) are silent on a legitimate "ran fine, nothing to report" firing. The only ground truth is browsing the authenticated session transcript.

**Type:** Feature request

**Affected skill/command:** code-health, harness-health, docs-health, journey-health

**Use case:** verifying a fleet of scheduled routines actually completed (vs. hung/crashed) without manual browser access to each session.

**Recommendation:** have each skill write a minimal, always-succeeds "run happened" signal through a transport guaranteed to work (independent of full cursor/dedup persistence succeeding) — e.g. a single-line timestamp update via `git push` to a well-known path.

**Environment:**
- claude-tweaks version: 6.21.0
- Reported from project: memenu-app

---
Filed via claude-tweaks-feedback (thomasholknielsen/claude-user-config).

---

## Absorbed from #210 (2026-08-08)

#210 was filed as "routines set no notifications, so a health sweep can finish silently," shaped, then found to be solution-baked on a false premise. Findings are **not** silent — every sweep files a GitHub issue (`by:{skill}-health`, `ready`). What is silent is the case this record already names. #210 is closed; its one durable contribution is the mechanism below.

### The premise re-confirmed at v6.68.1

This record was filed at v6.21.0. The gap it describes still holds 47 releases later — a firing with nothing due writes nothing at all:

| Skill | Evidence |
|---|---|
| harness-health | `skills/harness-health/SKILL.md:150` — "A firing with nothing due (`target: null`, `gapScanDue: false`) is a cheap no-op" |
| docs-health | `skills/docs-health/SKILL.md:225` — same wording |
| journey-health | `skills/journey-health/SKILL.md:269` — same wording |
| code-health | `skills/code-health/SKILL.md:349` — "run is truly a no-op for all persistence" |

Mechanism: `runs: [...current.runs, runRecord]` (`bin/lib/harness-health/cache.js:72`) is reached only through `validate-findings`, which a no-op firing never calls. So "ran fine, nothing due" and "hung / crashed / never fired" are byte-identical from outside.

### The candidate unblocker

Live routine objects carry an **undocumented** `notifications` field:

```json
"notifications": {"channel": {"email": true, "push": false, "slack": false}}
```

Observed via `RemoteTrigger list` on `memenu-app-code-health-daily` and `memenu-app-harness-health-daily`, each with an `updated_at` well after its `created_at` — i.e. set by hand in the web UI, not by `/claude-tweaks:routine`, whose CREATE Step 6 body never sets it. The field appears nowhere in the public routines documentation, which covers schedule/API/GitHub triggers, environments, and connectors only.

### The deciding question — ANSWERED YES (2026-08-08)

**Does a routine notification fire on a completion where the session did nothing?** **Yes** — confirmed by the maintainer from the two live routines that already carry `notifications.channel.email: true`, which fire daily and are frequently no-ops.

That settles it: `notifications` **is** the always-succeeds transport the Recommendation above asks for, delivered by infrastructure rather than by each skill pushing its own timestamp. It is strictly stronger than the original proposal, because a skill-written heartbeat cannot by construction report "the skill never ran."

**This supersedes the Recommendation above.** The deliverable is no longer "have each skill write a run-happened signal" — it is "have `/claude-tweaks:routine` set `notifications` on every routine it creates," which is precisely what #210 proposed. #210's framing was baked on a false premise and its deliverable was correct anyway; those are independent.

### The signal works by absence — design around that

A notification on every completion means **the failure signal is a missing notification**, not a received one. Two consequences the build must address rather than inherit:

- **A human noticing an absent daily email is a weak alarm.** It degrades silently the moment the recipient stops reading them, which is the same failure mode this record exists to fix, relocated. Decide whether absence-detection needs anything watching it, or whether "better than nothing, and free" is the accepted ceiling. Say which, explicitly — do not leave it implied.
- **Noise is the cost, and it scales with the fleet.** Six routine templates ship. A daily email each is the exact cost flagged as an unvalidated assumption when #210 was shaped. Weigh channel choice (`email` / `push` / `slack`) and whether every routine needs it, or only the unattended ones.

### Writability — RESOLVED YES (2026-08-08, tested live)

`notifications` **is** writable through `RemoteTrigger create`. Probed with a disabled, cron-less throwaway routine (`trig_01VwokvDUpW62NEe66QFDwaq`): the field was sent on `create`, and an independent `get` read it back intact rather than merely echoing the request.

```json
"notifications": {"channel": {"email": true, "push": false, "slack": false}}
```

Top-level, a sibling of `cron_expression` — not nested under `job_config`. So the deliverable is the full version ("`/claude-tweaks:routine` sets it at creation"), **not** the degraded fallback this record previously hedged toward.

### Still open

- **Does it fire on a crash, hang, or timeout?** Still unknown, and **not answerable by direct experiment** — see below. "Fires on a no-op completion" is confirmed; "fires on a session that died" is not. This is the question that decides whether absence is a trustworthy alarm: if a crashed run also emails, absence stops meaning failure and the signal weakens considerably.
- Routines have **no delete API**, so the probe routine above must be removed by hand at claude.ai/code/routines.

#### Why the crash question resisted testing

Two independent blockers, both worth recording so the next attempt does not repeat them:

1. **The observable is out of reach.** The signal is an email in the account owner's inbox. No API surfaces "was a notification sent for run X," so confirming it requires a human to check mail.
2. **A crash cannot be induced on demand.** Pointing a routine at a nonexistent repository is rejected at *config* time, not run time — `RemoteTrigger update` returns `403 permission_error: "You don't have access to a repository this routine uses."` And anything expressible in a routine's prompt produces a session that *completes* having failed its task, which is a different class from the session dying. A true crash is an infrastructure event.

That leaves two viable routes, neither a single test: **longitudinal correlation** — with notifications on, compare emails received against runs shown at claude.ai/code/routines until a real failure occurs, then check whether that run produced mail — or **ask upstream**, since the field is undocumented and this is a behavioral guarantee rather than something to reverse-engineer. The longitudinal route is effectively this record's own original trigger ("a scheduled health routine fails silently again"), which means the question resolves the next time something breaks rather than on demand.

Note for whoever picks this up: this is not a reason to block the writability work above. Setting `notifications` is strictly better than not setting it under every possible answer to the crash question — the answer only determines *how much* to trust absence, not whether the field is worth setting.

### Related

- #209 — whether routines can declare their own plugin via `enabled_plugins`/`extra_marketplaces`; same "undocumented routine config field" territory.
- #213 — `/routine` has no pause action and STATUS reports a paused routine as healthy; carries #210's residual point that STATUS Step 3.5's field-level drift check is incomplete.

## Blocked / Future Work

Implemented in this build (`2026-08-23T135002-record-68-211`): AC1 (Step 6's `notifications` field on the direct-create path), AC4 (Step 7 preview line), and the doc sentence — see `plugin/skills/routine/create-and-update.md` and the pinning test `tests/routine-notifications.test.js`.

**Not implemented — blocked:** Task 0's empirical premise-check (does `RemoteTrigger {action: "update", ...}` actually persist `notifications` the same way `create` was already confirmed live). This build session (a Claude Code CLI worktree agent dispatched by `/claude-tweaks:dispatch`) has no `RemoteTrigger` tool loaded — `ToolSearch select:RemoteTrigger` returns no match — so the throwaway-routine probe this task calls for cannot run here. Per AC3, this blocks only AC2 (the guided-path follow-up call) — the guided-path *code change* itself (Step 8's follow-up call) is implemented, on the strength of the design's own stated precedent that the same `update` action is already proven live elsewhere in this file, but its correctness for the `notifications` field specifically remains unconfirmed pending Task 0.

Tracked as ledger item #1 in `docs/plans/2026-08-23-record-68-211-ledger.md` (phase `build`, status `open`). Unblocks the same way as #211's ledger item #2: needs a session with `RemoteTrigger` available.

